/* agent/index.js —— 被控端桌面代理（真·远程桌面）
 * =====================================================================================
 *
 * ▎它是什么？
 *   一个跑在**被控电脑**上的本地程序。启动后它会：
 *     ① 拉起一个真实的 Chromium 窗口（Chrome/Edge，用户看得见、能自己用）
 *     ② 用 socket.io-client 连上会议服务器，以"🖥️ 桌面代理"的身份进房
 *     ③ 有人申请控制它时 —— 在**本机终端**弹出确认（或 --auto-allow 自动放行）
 *     ④ 被控期间：把真实画面按帧推给控制端；把控制端的鼠标键盘注入真实浏览器
 *
 * ▎为什么必须是"本地程序"而不是网页？
 *   浏览器的安全底线决定了网页**不能**移动真实光标、敲真实键盘、截别的程序。
 *   这不是技术不足，是设计如此（否则任何网页都能偷看你的屏幕、替你点确认）。
 *   商业远程桌面（AnyDesk / 向日葵 / TeamViewer）全都要装"被控端"，原因就在这里。
 *   本项目把这一层做成**零新依赖**的 Node 脚本，一条命令起。
 *
 * ▎安全模型（三条，都是"最小权限"的体现）
 *   ① **授权绝不豁免**：走的还是服务器那套 remote-request → remote-answer 门禁，
 *      和人类被控端一字不差。服务器不认识"agent 特权"，只认识"登记在册的控制关系"。
 *   ② **终端确认**：默认每次接入都要在本机按 y —— 被控端本人有最终否决权。
 *      无人值守场景才用 --auto-allow（文档里会写清风险）。
 *   ③ **能力面收窄**：只暴露 CDP 能碰的东西（浏览器内部）。
 *      导航白名单挡掉 file:// —— 否则远端能读被控端的本地文件（这是真实产品栽过的坑）。
 *
 * ▎用法
 *   node agent/index.js --room 123456                 # 连本机 3001，需终端确认
 *   node agent/index.js --room 123456 --auto-allow    # 演示用：自动放行
 *   node agent/index.js --room 123456 --url https://www.bing.com --headless
 */

'use strict';

const os = require('os');
const readline = require('readline');
const { io } = require('socket.io-client');
const { Cdp, findBrowserBin } = require('./cdp');

/* =====================================================================================
 *  一、命令行参数
 * ===================================================================================== */
function parseArgs(argv) {
  const out = {
    server: 'http://127.0.0.1:3001',
    room: '',
    password: '',
    name: os.hostname() || '我的电脑',
    url: 'about:blank',
    headless: false,
    autoAllow: false,
    port: 9333,
    quality: 55,
    fps: 12,
    durationMs: 30 * 60 * 1000, // 单次授权时长，默认 30 分钟（和限时授权 A6 一致）
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--server': out.server = next(); break;
      case '--room': out.room = String(next() || '').trim(); break;
      case '--password': out.password = next() || ''; break;
      case '--name': out.name = next() || out.name; break;
      case '--url': out.url = next() || out.url; break;
      case '--port': out.port = Number(next()) || 9333; break;
      case '--quality': out.quality = Math.max(20, Math.min(90, Number(next()) || 55)); break;
      case '--fps': out.fps = Math.max(2, Math.min(30, Number(next()) || 12)); break;
      case '--minutes': out.durationMs = Math.max(1, Number(next()) || 30) * 60 * 1000; break;
      case '--headless': out.headless = true; break;
      case '--auto-allow': out.autoAllow = true; break;
      case '-h': case '--help': out.help = true; break;
      default: break;
    }
  }
  return out;
}

const USAGE = `
被控端桌面代理 —— 让远端的手机/电脑真真切切操作你这台电脑的浏览器

用法：
  node agent/index.js --room 123456 [选项]

选项：
  --room <6位房间号>   必填。先在被控电脑的浏览器里建好房间，再把房间号填这里
  --server <地址>      会议服务器，默认 http://127.0.0.1:3001
  --password <密码>    房间密码（房间设了密码就要填）
  --name <名字>        成员列表里显示的名字，默认取本机主机名
  --url <网址>         被控浏览器启动时打开的页面，默认 about:blank
  --fps <2~30>         画面帧率上限，默认 12（公网建议 6~8）
  --quality <20~90>    JPEG 质量，默认 55（公网建议 40）
  --minutes <分钟>     单次授权时长，默认 30
  --auto-allow         自动放行控制请求（演示无人值守用；有风险，见文档）
  --headless           无头模式（不出窗口，测试用）
  -h, --help           看这段说明
`;

/* =====================================================================================
 *  二、协议层：16 字节控制帧解码 + 既有 JSON 消息处理
 * =====================================================================================
 * ▎这里刻意**复用项目已有的线格式**，没有另起一套：
 *   鼠标/滚轮 = 16 字节二进制帧（和 Mesh 版 ctrl_ DataChannel、SFU 版 remote-input 完全同构）
 *   键盘/文本 = JSON 对象（kind: 'keydown' / 'keyup' / 'input-text'）
 *   新增两种 JSON：'navigate'（地址栏）、'window'（最大化/还原）—— 老通道，新语义
 *   好处：前端只维护一份采集逻辑，agent 只是"另一种被控端实现"。
 */
const CTL_KIND_FROM_ID = ['', '', '', 'mousemove', 'mousedown', 'mouseup', 'dblclick', 'wheel'];

function decodeCtlFrame(buf) {
  // socket.io 在 Node 侧把二进制还原成 Buffer；转成 ArrayBuffer 视图才能用 DataView
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  if (ab.byteLength !== 16) return null;                 // 长度不对 = 不是我们的帧，丢弃
  const v = new DataView(ab);
  const flags = v.getUint8(1);
  return {
    type: 'input',
    kind: CTL_KIND_FROM_ID[v.getUint8(0)] || 'mousemove',
    x: v.getFloat32(4),
    y: v.getFloat32(8),
    wheel: v.getInt32(12),
    btn: (flags >> 4) & 3,                                // bit4~5：鼠标键号
    // ★ 修饰键位序注意：帧里是 alt/ctrl/shift/meta（bit0~3），
    //   而 CDP 的掩码顺序是 Alt=1,Ctrl=2,Meta=4,Shift=8 —— 顺序不同，必须映射，别直接抄。
    altKey: !!(flags & 1), ctrlKey: !!(flags & 2),
    shiftKey: !!(flags & 4), metaKey: !!(flags & 8),
  };
}

const BTN_NAME = ['left', 'middle', 'right', 'left'];    // 帧里的 btn: 0=左 1=中 2=右

/* =====================================================================================
 *  三、RemoteAgent 主体
 * ===================================================================================== */
class RemoteAgent {
  constructor(cfg) {
    this.cfg = cfg;
    this.cdp = null;
    this.sock = null;
    this.myId = null;
    this.streaming = false;
    this.controllerId = null;
    this._lastFrameAt = 0;
    this._frameGap = Math.round(1000 / cfg.fps);
    this._frameCount = 0;
    this._frameBytes = 0;
    this._statTimer = null;
    this._pendingReq = null;
    this._allowAll = cfg.autoAllow;      // 运行期间可被终端命令切换
    this.exitOnShutdown = false;         // ★ 只有 CLI 入口才置 true（被 require 时不能随便 exit）
  }

  log(...a) { console.log(...a); }

  /* ---------------- 启动：先起浏览器，再连服务器 ---------------- */
  async start() {
    const bin = findBrowserBin();
    if (!bin) throw new Error('没找到 Chrome / Edge。可设环境变量 BROWSER_BIN 指定路径。');

    this.cdp = new Cdp({
      bin,
      port: this.cfg.port,
      headless: this.cfg.headless,
      startUrl: this.cfg.url,
      log: (...a) => this.log(...a),
    });
    await this.cdp.launch();

    // 浏览器被关掉 → 没法再控 → 直接退出（比留个"假在线"的成员更好）
    this.cdp.on('Inspector.detached', () => this.shutdown('浏览器已关闭'));

    await this.connectSignaling();
    this.setupConsole();
    return this;
  }

  connectSignaling() {
    return new Promise((resolve, reject) => {
      this.log(`🔌 连接会议服务器 ${this.cfg.server} …`);
      const sock = io(this.cfg.server, { transports: ['websocket', 'polling'], reconnectionDelay: 1500 });
      this.sock = sock;

      const onFail = (e) => reject(new Error('连不上服务器：' + (e && e.message ? e.message : e)));
      sock.once('connect_error', onFail);
      const timer = setTimeout(() => reject(new Error('连接服务器超时（服务起了吗？）')), 12000);

      sock.on('connect', () => {
        clearTimeout(timer);
        sock.off('connect_error', onFail);
        this.myId = sock.id;
        this.log(`✅ 已连接服务器（我的成员 id = ${sock.id}）`);
        this.hello();
        resolve(this);
      });

      this.bindEvents(sock);
    });
  }

  /* 以"桌面代理"身份进房 —— 服务器用 agent-hello 而不是 join-room，
   * 就是为了能在成员列表里把"机器"和"人"分开显示（🖥️ 徽标、"控制这台电脑"按钮文案）。 */
  hello() {
    this.sock.emit('agent-hello', {
      roomNumber: this.cfg.room,
      password: this.cfg.password,
      name: this.cfg.name,
      platform: `${process.platform} ${os.release()}`,
      browser: this.cdp.browserVersion || '',
    }, (res) => {
      /* ⚠️ 这里有个必须记住的约定（踩过）：socket.io 的"请求-应答"回调收到的是
       *   `{ data: ... }` 或 `{ error: '...' }` **包了一层**，
       *   不是直接的数据对象。我一开始写成 `res.roomNumber` / `res.ok === false`，
       *   结果是：**进房失败也照样打印"已就绪"，房间号还显示 undefined** ——
       *   又是一次"假成功"（同 joinRoom 那个 bug 一个家族）。
       *   教训：跨进程/跨语言的接口，第一件事是把返回结构打出来看一眼，别靠猜。 */
      if (!res || res.error) {
        this.log(`❌ 进房失败：${(res && res.error) || '无应答（服务器没回？）'}`);
        return this.shutdown('进房失败');
      }
      const data = res.data || {};
      this.roomNumber = data.roomNumber;
      this.log('');
      this.log('  ┌──────────────────────────────────────────────────────────┐');
      this.log('  │  🖥️  桌面代理已就绪，现在等控制端来连                      │');
      this.log('  └──────────────────────────────────────────────────────────┘');
      this.log(`     房间号：${data.roomNumber}      我的名字：🖥️ ${this.cfg.name}`);
      this.log(`     控制端打开会议页面 → 进入同一房间 → 点我这格的「控制电脑」`);
      this.log(`     授权方式：${this._allowAll ? '自动放行（--auto-allow）' : '每次在本终端按 y 确认'}`);
      this.log('');
      this.printHelp();
    });
  }

  printHelp() {
    this.log('  终端命令：  y = 放行控制请求   n = 拒绝   a = 切换自动放行   u = 打开网址   q = 退出');
    this.log('');
  }

  /* ---------------- 事件绑定 ---------------- */
  bindEvents(sock) {
    sock.on('disconnect', () => {
      // 主动退出引起的断开不是异常，别吓唬用户（日志要诚实，也要准确）
      if (this._shuttingDown) return;
      this.log('⚠️ 与服务器断开（会自动重连…）');
      this.stopStream();                    // 断线就停推流，别对着空气抓屏烧 CPU
    });
    sock.on('reconnect', () => { this.log('🔁 已重连，重新进房'); this.hello(); });

    // 有人申请控制我 —— 这是安全上最重要的一环：决定权在被控端本人手里
    sock.on('remote-request', ({ from } = {}) => this.onRemoteRequest(from));

    // 控制关系的权威广播（服务器说了算）：hostId === 我 就说明我正在被控
    sock.on('remote-state', (st = {}) => this.onRemoteState(st));

    sock.on('remote-ended', ({ reason } = {}) => {
      this.log(`🖱️ 控制已结束（${reason || 'released'}）`);
      this.stopStream();
    });

    // 控制端发来的输入（二进制帧 / JSON 命令），两种形态都从这里进
    sock.on('remote-input', ({ event } = {}) => {
      if (!event) return;
      let msg = null;
      try {
        if (Buffer.isBuffer(event) || ArrayBuffer.isView(event) || event instanceof ArrayBuffer) {
          msg = decodeCtlFrame(Buffer.isBuffer(event) ? event : Buffer.from(event));
        } else if (typeof event === 'string') {
          msg = JSON.parse(event);
        } else if (typeof event === 'object') {
          msg = event;
        }
      } catch (e) { return; }
      if (msg) this.applyInput(msg);
    });

    sock.on('room-not-found', () => this.log('❌ 房间不存在：先在浏览器里把房间建好，再启动代理'));
    sock.on('room-wrong-password', () => this.log('❌ 房间密码不对'));
    sock.on('room-full', ({ max } = {}) => this.log(`❌ 房间满了（上限 ${max} 人）`));
    sock.on('kicked', () => { this.log('🚪 被房主移出房间'); this.shutdown('被移出房间'); });
    sock.on('agent-denied', ({ reason } = {}) => this.log(`❌ 服务器拒绝代理进房：${reason || ''}`));
  }

  /* ---------------- 授权：本地终端确认 ---------------- */
  async onRemoteRequest(from) {
    if (!from) return;
    if (this._allowAll) {
      this.log(`🔓 收到控制请求（${from}）→ 自动放行（--auto-allow）`);
      return this.answer(from, true);
    }
    this._pendingReq = from;
    this.log('');
    this.log(`  🔔  有人申请控制这台电脑：${from}`);
    this.log(`      → 按 y 放行 / n 拒绝    （${this.cfg.durationMs / 60000} 分钟后自动到期）`);
    // 30 秒不回答 = 拒绝（不能让申请方无限等，也不能默认放行）
    clearTimeout(this._reqTimer);
    this._reqTimer = setTimeout(() => {
      if (this._pendingReq === from) { this._pendingReq = null; this.log('⏱ 请求超时，已按拒绝处理'); this.answer(from, false, 'timeout'); }
    }, 30000);
  }

  answer(to, ok, reason) {
    clearTimeout(this._reqTimer);
    this._pendingReq = null;
    this.sock.emit('remote-answer', { to, ok, reason, durationMs: ok ? this.cfg.durationMs : undefined });
    this.log(ok ? `✅ 已放行控制：${to}` : `⛔ 已拒绝控制：${to}`);
  }

  /* ---------------- 被控状态变化：由服务器广播驱动 ---------------- */
  onRemoteState(st) {
    const iAmHost = st.hostId === this.myId;
    const controller = st.controllerId || null;
    if (iAmHost && controller) {
      this.controllerId = controller;
      this.log(`🖱️ 正在被 ${controller} 控制`);
      this.startStream();
    } else {
      this.controllerId = null;
      this.stopStream();
    }
  }

  /* ---------------- 画面推流 ----------------
   * ▎链路：CDP screencast 帧（base64 JPEG）
   *        → Buffer（二进制走 socket.io，比 base64 字符串省 33% 带宽）
   *        → 服务器门禁转发
   *        → 控制端 canvas 画出来
   * ▎两级节流：
   *   ① 浏览器侧：screencast 自带"变化才推 + ack 背压"
   *   ② 我们侧：minFrameGap 限上限帧率；超出的帧**直接丢**（实时场景丢帧远好于堆积）
   *      配合 socket.volatile：断线期间不缓存帧，重连后不会"快进播一堆旧画面"
   */
  async startStream() {
    if (this.streaming) return;
    this.streaming = true;
    this._lastFrameAt = 0;
    this._frameCount = 0;
    this._frameBytes = 0;

    await this.cdp.startScreencast({
      quality: this.cfg.quality,
      maxWidth: 1920, maxHeight: 1200,   // 上限给足：小窗口输出小图，最大化后自动变清晰
      onFrame: (b64) => this.sendFrame(b64),
    });

    clearInterval(this._statTimer);
    this._statTimer = setInterval(() => {
      if (!this.streaming) return;
      const mbps = (this._frameBytes * 8 / 1e6).toFixed(2);
      this.log(`   📊 画面 ${this._frameCount} 帧 / 最近 5s ≈ ${mbps} Mbps`);
      this._frameCount = 0; this._frameBytes = 0;
    }, 5000);
  }

  stopStream() {
    if (!this.streaming) return;
    this.streaming = false;
    this.controllerId = null;
    clearInterval(this._statTimer);
    this.cdp.stopScreencast().catch(() => {});
  }

  sendFrame(b64) {
    if (!this.streaming || !this.controllerId) return;
    const now = Date.now();
    if (now - this._lastFrameAt < this._frameGap) return;   // 超频：丢这一帧
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > 900 * 1024) return;                    // 异常大帧直接丢（保护服务器）
    this._lastFrameAt = now;
    this._frameCount++;
    this._frameBytes += buf.length;
    this.sock.volatile.emit('remote-frame', { to: this.controllerId, frame: buf });
  }

  /* ---------------- 输入注入：把一条消息作用到真实浏览器 ----------------
   * ▎这是"真控"的最后一公里。每个 kind 都对应 CDP Input 域的一个真实动作。 */
  async applyInput(msg) {
    if (!this.cdp || !this.cdp.isAlive()) return;
    const opt = { alt: msg.altKey, ctrl: msg.ctrlKey, shift: msg.shiftKey, meta: msg.metaKey };
    try {
      switch (msg.kind) {
        case 'mousemove':
          await this.cdp.mouse('mouseMoved', msg.x, msg.y, opt);
          break;

        case 'mousedown':
          await this.cdp.mouse('mousePressed', msg.x, msg.y, { ...opt, button: BTN_NAME[msg.btn] || 'left', clickCount: 1 });
          break;

        case 'mouseup':
          await this.cdp.mouse('mouseReleased', msg.x, msg.y, { ...opt, button: BTN_NAME[msg.btn] || 'left', clickCount: 1 });
          break;

        case 'dblclick':
          // 双击 = 两轮 down/up，第二轮 clickCount=2 —— Chrome 靠这个数字识别"双击"
          for (const n of [1, 2]) {
            await this.cdp.mouse('mousePressed', msg.x, msg.y, { ...opt, button: 'left', clickCount: n });
            await this.cdp.mouse('mouseReleased', msg.x, msg.y, { ...opt, button: 'left', clickCount: n });
          }
          break;

        case 'wheel':
          // 帧里的 wheel 是"滚动格数"（前端把 deltaY 累加后取整），一格 ≈ 100 CSS 像素
          await this.cdp.wheel(msg.x, msg.y, 0, (msg.wheel || 0) * 100);
          break;

        case 'keydown':
        case 'keyup':
          // 功能键（Enter/Backspace/方向键…）走真按键；可打印单字符在下面走文本通道
          if (msg.key && msg.key.length > 1) {
            await this.cdp.key(msg.key, msg.kind === 'keydown' ? 'rawKeyDown' : 'keyUp', opt);
          }
          break;

        case 'input-text':
          // ★ 中文/emoji/长文本：insertText 整段落字，完全绕开 IME
          await this.cdp.text(msg.text);
          break;

        case 'navigate':
          await this.cdp.navigate(msg.url);
          this.emitMeta();
          break;

        case 'window':
          if (['maximized', 'normal', 'minimized', 'fullscreen'].includes(msg.state)) {
            await this.cdp.setWindowState(msg.state);
            this.emitMeta();
          }
          break;

        case 'refresh':
          await this.cdp.evaluate('location.reload()').catch(() => {});
          break;

        case 'back':
          await this.cdp.evaluate('history.back()').catch(() => {});
          break;

        default:
          break;
      }
    } catch (e) {
      // 一条坏消息不该炸掉整条输入流
      if (msg.kind !== 'mousemove') this.log(`   ⚠️ 注入失败（${msg.kind}）：${e.message}`);
    }
  }

  /* 回传"当前页面信息"，让控制端的地址栏能显示真实 URL/标题（像真的浏览器一样） */
  emitMeta() {
    if (!this.controllerId) return;
    Promise.all([this.cdp.currentUrl(), this.cdp.pageTitle(), Promise.resolve(this.cdp.viewport)])
      .then(([url, title, viewport]) => {
        this.sock.volatile.emit('remote-meta', {
          to: this.controllerId,
          url, title, viewport, ts: Date.now(),
        });
      })
      .catch(() => {});
  }

  /* ---------------- 本地终端命令 ---------------- */
  setupConsole() {
    // 非交互环境（被 CI / 脚本管道启动）就不接管 stdin，避免吃掉管道数据
    if (!process.stdin.isTTY) return;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    rl.on('line', (line) => {
      const cmd = String(line).trim().toLowerCase();
      if (this._pendingReq && (cmd === 'y' || cmd === 'n')) {
        const who = this._pendingReq;
        this.answer(who, cmd === 'y');
        return;
      }
      if (cmd === 'q' || cmd === 'quit' || cmd === 'exit') return this.shutdown('用户退出');
      if (cmd === 'a') {
        this._allowAll = !this._allowAll;
        this.log(`   自动放行：${this._allowAll ? '已开启 🔓' : '已关闭 🔒'}`);
        return;
      }
      if (cmd === 'u' || cmd.startsWith('u ')) {
        const url = line.trim().slice(1).trim() || 'https://www.bing.com';
        this.cdp.navigate(url).catch((e) => this.log('   ❌ 打开失败：' + e.message));
        return;
      }
      if (cmd === 's' || cmd === 'status') {
        this.log(`   状态：房间 ${this.roomNumber || '-'}，被控 ${this.controllerId ? '是（' + this.controllerId + '）' : '否'}，推流 ${this.streaming ? '中' : '停'}`);
        return;
      }
      if (cmd) this.printHelp();
    });
  }

  shutdown(reason) {
    this._shuttingDown = true;
    this.log(`👋 代理退出（${reason || '正常退出'}）`);
    this.stopStream();
    try { if (this.sock) this.sock.disconnect(); } catch (e) { /* ignore */ }
    try { if (this.cdp) this.cdp.kill(); } catch (e) { /* ignore */ }
    // ★ 只有"以命令行方式运行"时才结束进程。被 require 当库用时（比如自动化测试
    //   同时管着服务器和浏览器），随便 exit 会把整个测试进程带走 —— 这是库的常识：
    //   谁创建了进程生命周期，谁才有权结束它。
    if (this.exitOnShutdown) setTimeout(() => process.exit(0), 300);
  }
}

/* =====================================================================================
 *  四、入口
 * ===================================================================================== */
async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  if (cfg.help) { console.log(USAGE); return; }
  if (!/^\d{6}$/.test(cfg.room)) {
    console.log(USAGE);
    console.error('❌ --room 必须是 6 位数字房间号\n');
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════╗');
  console.log('  ║   🖥️  远程桌面 · 被控端代理                               ║');
  console.log('  ╚══════════════════════════════════════════════════════════╝');
  console.log(`     房间 ${cfg.room} · 服务器 ${cfg.server} · 画质 ${cfg.quality} / 上限 ${cfg.fps}fps`);
  console.log('');

  const agent = new RemoteAgent(cfg);
  agent.exitOnShutdown = true;   // ★ CLI 身份：可以自己结束进程（被 require 时不要这么做）
  try {
    await agent.start();
  } catch (e) {
    console.error('❌ 启动失败：' + e.message);
    try { if (agent.cdp) agent.cdp.kill(); } catch (err) { /* ignore */ }
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('❌ 意外错误：', e); process.exitCode = 1; });
}

module.exports = { RemoteAgent, parseArgs, decodeCtlFrame };
