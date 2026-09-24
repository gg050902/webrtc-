/* agent/cdp.js —— CDP（Chrome DevTools Protocol）客户端：把真实 Chromium 窗口变成可远程的"桌面"
 * =====================================================================================
 *
 * ▎这个文件解决什么问题？
 *   浏览器里的网页**没有权限**驱动操作系统：JS 不能移动真实鼠标、不能敲真实键盘、
 *   不能截图别人的程序窗口。这是浏览器的安全底线，不是 bug。
 *   所以"真远程桌面"必须有一个**跑在被控电脑上的本地程序**（agent）——
 *   商业产品（AnyDesk / 向日葵 / TeamViewer）无一例外都要装被控端，原因就在这。
 *
 * ▎为什么选 CDP？
 *   CDP 是 Chromium 系浏览器（Chrome / Edge）内置的**调试协议**——就是 F12 开发者工具
 *   背后用的那套东西。开发者工具能"点页面元素、看网络、截屏"，本质就是在用 CDP。
 *   我们把同一套协议握在手里，就能：
 *     · 抓真实画面  Page.startScreencast  —— 变化才推帧 + 内置背压（比轮询截图聪明得多）
 *     · 真鼠标       Input.dispatchMouseEvent
 *     · 真键盘       Input.dispatchKeyEvent / Input.insertText
 *     · 真导航       Page.navigate（能开任意真实网站）
 *     · 真窗口       Browser.setWindowBounds（最大化 = 立刻有"远程桌面"的感觉）
 *   而且它是**协议**不是库：Node 22 自带 fetch + WebSocket，零 npm 新依赖就能用。
 *
 * ▎能力边界（必须诚实说清楚，写在文档里也要写这里）
 *   CDP 只能控制 **Chromium 浏览器窗口内部**，控制不了浏览器以外的程序
 *   （开始菜单、记事本、Excel 都动不了——那需要 Win32 SendInput / CGEvent，
 *    要 native 模块或系统级 API，不在本项目的"零新依赖"约束内）。
 *   所以本模块的定位是 **"远程浏览器工作区"**：
 *     ✅ 打开任意网站、登录、填表、看视频、拖拽、玩网页游戏、开 DevTools 之外的任何操作
 *     ❌ 操作浏览器窗口以外的桌面程序
 *   对"远程协助 / 远程演示 / 远程帮人操作"这个场景，浏览器已经是 90% 的战场。
 *
 * ▎和项目其它部分的关系
 *   cdp.js（本文件）只负责"驱动一个 Chromium"，**完全不知道 WebRTC / socket.io 的存在**。
 *   怎么把画面送到远端、怎么接收远端的坐标 —— 那是 agent/index.js 的事。
 *   分层清楚，两边都能单独测（test-agent.js 就是直接测本文件）。
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- 浏览器可执行文件探测：按平台常见路径依次找，也支持环境变量覆盖 ---- */
const BROWSER_CANDIDATES = [
  process.env.BROWSER_BIN,                                    // ① 用户显式指定优先
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

function findBrowserBin() {
  for (const p of BROWSER_CANDIDATES) {
    if (!p) continue;
    try { if (fs.existsSync(p)) return p; } catch (e) { /* 忽略 */ }
  }
  return null;
}

/* ---- 修饰键位掩码（CDP 规定：Alt=1, Ctrl=2, Meta=4, Shift=8）---- */
const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

/* ---- 特殊键映射表：把"语义键名"翻成 CDP 要的三件套 ----
 * CDP 的 dispatchKeyEvent 需要 key / code / windowsVirtualKeyCode 三个字段，
 * 少一个浏览器就可能不认（尤其 Enter / Backspace 这类"有副作用"的键）。
 * 表里只列远程控制真正用得上的键，够用就好。 */
const KEYS = {
  Enter:      { key: 'Enter',       code: 'Enter',       vk: 13, text: '\r' },
  Backspace:  { key: 'Backspace',   code: 'Backspace',   vk: 8  },
  Delete:     { key: 'Delete',      code: 'Delete',      vk: 46 },
  Tab:        { key: 'Tab',         code: 'Tab',         vk: 9,  text: '\t' },
  Escape:     { key: 'Escape',      code: 'Escape',      vk: 27 },
  ArrowUp:    { key: 'ArrowUp',     code: 'ArrowUp',     vk: 38 },
  ArrowDown:  { key: 'ArrowDown',   code: 'ArrowDown',   vk: 40 },
  ArrowLeft:  { key: 'ArrowLeft',   code: 'ArrowLeft',   vk: 37 },
  ArrowRight: { key: 'ArrowRight',  code: 'ArrowRight',  vk: 39 },
  Home:       { key: 'Home',        code: 'Home',        vk: 36 },
  End:        { key: 'End',         code: 'End',         vk: 35 },
  PageUp:     { key: 'PageUp',      code: 'PageUp',      vk: 33 },
  PageDown:   { key: 'PageDown',    code: 'PageDown',    vk: 34 },
  Space:      { key: ' ',           code: 'Space',       vk: 32, text: ' ' },
};

/* =====================================================================================
 *  Cdp 类
 * ===================================================================================== */
class Cdp {
  /**
   * @param {object} opts
   *   bin         浏览器可执行文件（默认自动探测）
   *   port        CDP 调试端口（默认 9333）
   *   profile     独立用户数据目录（默认临时目录 —— 绝不动用户日常浏览器）
   *   windowSize  { width, height } 初始窗口尺寸
   *   headless    true = 无头（自动化测试用）；false = 可见窗口（远程桌面用，默认）
   *   startUrl    启动后打开的地址
   *   log         日志函数
   */
  constructor(opts = {}) {
    this.bin = opts.bin || findBrowserBin();
    this.port = opts.port || 9333;
    this.profile = opts.profile || path.join(os.tmpdir(), 'wb-remote-desktop-profile');
    this.windowSize = opts.windowSize || { width: 1280, height: 800 };
    this.headless = opts.headless === true;   // 默认可见：用户要"看见"被控的窗口
    this.startUrl = opts.startUrl || 'about:blank';
    this.log = opts.log || ((...a) => console.log(...a));

    this.proc = null;
    this.browserWs = null;      // 浏览器级连接：Browser.* 域（窗口管理）
    this.pageWs = null;         // 页面级连接：Page.* / Input.* / Runtime.* 域
    this.targetId = null;
    this._seq = 0;
    this._pending = new Map();
    this._handlers = new Map();  // method → Set<fn>（事件订阅）
    this.viewport = { width: this.windowSize.width, height: this.windowSize.height };
    this._screencastOn = false;
    this._frameCb = null;
    this._alive = false;
  }

  /* ---- 底层：发一条 CDP 命令并等应答 ----
   * CDP 是"请求-应答"协议：每条命令带自增 id，应答带回同一个 id。
   * 超时必须有——否则浏览器卡住会把整个 agent 拖死。 */
  _send(ws, method, params = {}, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== 1) return reject(new Error('CDP 连接不可用：' + method));
      const id = ++this._seq;
      const timer = setTimeout(() => {
        if (this._pending.has(id)) { this._pending.delete(id); reject(new Error(method + ' 超时')); }
      }, timeoutMs);
      this._pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
        method,
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  _bind(ws) {
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); }
      catch (e) { return; }                              // 非 JSON 一律忽略（协议只有 JSON）
      if (msg.id && this._pending.has(msg.id)) {
        const p = this._pending.get(msg.id);
        this._pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
        else p.resolve(msg.result);
        return;
      }
      if (msg.method) {                                   // 事件：分发给订阅者
        const set = this._handlers.get(msg.method);
        if (set) for (const fn of set) { try { fn(msg.params || {}); } catch (e) { /* 订阅者自己炸不影响协议层 */ } }
      }
    };
    ws.onclose = () => {
      if (this._alive) { this.log('⚠️ CDP 连接断开（浏览器窗口被关掉了？）'); this._alive = false; }
    };
  }

  /** 订阅 CDP 事件（可多次订阅同一事件） */
  on(method, fn) {
    if (!this._handlers.has(method)) this._handlers.set(method, new Set());
    this._handlers.get(method).add(fn);
    return this;
  }

  /* ---- 启动浏览器 + 建两条连接 ---- */
  async launch() {
    if (!this.bin) {
      throw new Error('找不到 Chromium 系浏览器（Chrome / Edge）。可用 BROWSER_BIN 环境变量指定路径。');
    }
    fs.mkdirSync(this.profile, { recursive: true });

    /* 启动参数逐条都有理由，别乱删：
     *   --remote-debugging-port   CDP 入口（注意：只监听 127.0.0.1，不对外暴露）
     *   --user-data-dir           独立 profile：不复用用户登录态，也不污染用户的浏览器
     *   --no-first-run / --no-default-browser-check   跳过首次运行引导（否则窗口半天不出来）
     *   --disable-backgrounding-occluded-windows   ★ 关键：窗口被挡住/最小化时不过度降帧，
     *   --disable-renderer-backgrounding           ★ 否则远程画面会突然变成 1fps 甚至停住
     *   --disable-background-timer-throttling      ★ 后台定时器不降频（页面时钟/动画正常）
     *   --disable-features=Translate,MediaRouter   去掉用不着的干扰
     *   --window-size / --window-position          窗口可见、位置固定，用户能看见
     */
    const args = [
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${this.profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-features=Translate,MediaRouter,OptimizationHints',
      '--disable-session-crashed-bubble',
      `--window-size=${this.windowSize.width},${this.windowSize.height}`,
      '--window-position=40,40',
    ];
    if (this.headless) args.push('--headless=new', '--disable-gpu');
    args.push(this.startUrl);

    this.log(`🚀 启动被控浏览器：${path.basename(this.bin)}${this.headless ? '（无头）' : '（可见窗口）'}，CDP 端口 ${this.port}`);
    this.proc = spawn(this.bin, args, { stdio: 'ignore', windowsHide: true, detached: false });
    this.proc.on('exit', () => { this._alive = false; });

    // 等调试端口起来（冷启动可能 2~8 秒，给足 20 秒）
    let version = null;
    for (let i = 0; i < 80 && !version; i++) {
      await sleep(250);
      try {
        const r = await fetch(`http://127.0.0.1:${this.port}/json/version`);
        if (r.ok) version = await r.json();
      } catch (e) { /* 还没起来，继续等 */ }
    }
    if (!version) { this.kill(); throw new Error('浏览器调试端口未就绪（可能端口被占用或被安全软件拦截）'); }
    this.browserVersion = version.Browser;
    this.log(`✅ 浏览器已就绪：${version.Browser}`);

    // ① 浏览器级连接（Browser.* 域：窗口管理）
    this.browserWs = await this._openWs(version.webSocketDebuggerUrl);

    // ② 页面级连接（Page.* / Input.* / Runtime.*）
    await this._attachPage();

    this._alive = true;
    await this.refreshViewport();
    return this;
  }

  async _openWs(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('CDP WebSocket 连接超时')), 10000);
      ws.onopen = () => { clearTimeout(t); res(); };
      ws.onerror = () => { clearTimeout(t); rej(new Error('CDP WebSocket 连接失败')); };
    });
    this._bind(ws);
    return ws;
  }

  /** 找到页面目标并挂上页面级连接 */
  async _attachPage(retries = 20) {
    let page = null;
    for (let i = 0; i < retries && !page; i++) {
      await sleep(200);
      try {
        const list = await fetch(`http://127.0.0.1:${this.port}/json/list`).then((r) => r.json());
        page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      } catch (e) { /* 重试 */ }
    }
    if (!page) throw new Error('没找到可用的页面目标（page target）');
    this.targetId = page.id;
    this.pageWs = await this._openWs(page.webSocketDebuggerUrl);
    await this._send(this.pageWs, 'Page.enable');
    await this._send(this.pageWs, 'Runtime.enable');
    return page;
  }

  /** 浏览器还在吗（远程画面断了要能自愈） */
  isAlive() { return this._alive && this.pageWs && this.pageWs.readyState === 1; }

  /* =================================================================================
   *  画面：Page.startScreencast —— 抓屏的正确姿势
   * =================================================================================
   * ▎为什么不用"定时 Page.captureScreenshot"？
   *   captureScreenshot 每次都要浏览器**完整编码一帧**，不管画面有没有变；
   *   10fps 就是每秒 10 次全量编码，CPU 白烧，静止时也在推一样的图（浪费带宽）。
   *
   * ▎startScreencast 好在哪（这也是 DevTools 远程设备调试在用的 API）：
   *   ① **只在画面变化时推帧** —— 静止时零帧零带宽，动一下才来帧（"事件驱动"思想）
   *   ② **内置背压**：每帧必须调 screencastFrameAck 确认，浏览器才发下一帧。
   *      意义重大 —— 网络慢的时候，帧会自然堆积，ack 机制让浏览器**主动降帧率**，
   *      而不是把内存堆爆。这是"端到端流控"，比自己在应用层写丢帧逻辑优雅得多。
   *   ③ 每帧带 metadata（设备像素比、是否滚动、时间戳），前端坐标换算有据可依。
   */
  async startScreencast({ quality = 55, maxWidth = 1280, maxHeight = 800, everyNthFrame = 1, onFrame } = {}) {
    if (this._screencastOn) return this;
    this._frameCb = onFrame || null;

    this.on('Page.screencastFrame', (p) => {
      // ★ 先 ack 再回调：ack 是"我收到了"，越早越好，否则浏览器会等你
      this._send(this.pageWs, 'Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
      if (typeof this._frameCb === 'function' && p.data) {
        try { this._frameCb(p.data, p.metadata || {}); } catch (e) { /* 下游炸不影响抓屏 */ }
      }
    });

    await this._send(this.pageWs, 'Page.startScreencast', {
      format: 'jpeg', quality, maxWidth, maxHeight, everyNthFrame,
    });
    this._screencastOn = true;
    this.log(`🎬 已开始推流（jpeg q${quality}，上限 ${maxWidth}×${maxHeight}，变化才推帧）`);
    return this;
  }

  /** 换一帧回调（比如换了控制者，画面要发给别人） */
  setFrameHandler(onFrame) { this._frameCb = onFrame; }

  async stopScreencast() {
    if (!this._screencastOn) return this;
    try { await this._send(this.pageWs, 'Page.stopScreencast'); } catch (e) { /* 窗口可能已关 */ }
    this._screencastOn = false;
    this.log('⏸ 已停止推流');
    return this;
  }

  /** 视口尺寸（CSS 像素）—— 坐标换算的基准 */
  async refreshViewport() {
    const m = await this._send(this.pageWs, 'Page.getLayoutMetrics');
    const v = m.cssVisualViewport || m.cssLayoutViewport || m.visualViewport || m.layoutViewport;
    if (v && v.clientWidth) this.viewport = { width: Math.round(v.clientWidth), height: Math.round(v.clientHeight) };
    return this.viewport;
  }

  /* =================================================================================
   *  输入注入：把远端发来的"归一化坐标"翻成真鼠标真键盘
   * =================================================================================
   * ▎坐标系约定（跨端最重要的一件事，错一点就点歪）：
   *   控制端发来的是**归一化坐标** nx, ny ∈ [0, 1]（相对画面宽高的比例）。
   *   为什么用比例？手机屏 390×844、电脑屏 1920×1080、被控窗口 1280×800，
   *   三套分辨率各不相同。发比例就没有"谁的分辨率"这个问题——
   *   转成绝对像素只在**最后一步**做：× 被控端视口的 CSS 尺寸。
   *   这是所有远程桌面产品的通用做法，也是"解耦"的教科书例子。
   */
  /* ▎按下/抬起之间的 mouseMoved 必须带 buttons 位掩码 —— 这是"拖拽"的关键。
   *   否则 Chrome 认为"没在拖"，会出现：选不中文字、拖动滑杆/视频进度条失效、
   *   画板里按住画不出线。所以这里自维护一个按下状态，调用方不用操心。
   * ▎clickCount 也要带：CDP 只有看到 clickCount ≥ 1 的 down+up 才会派发 click 事件，
   *   带 0 就只派发 mousedown/mouseup —— 很多"按钮点了没反应"就是这个坑。 */
  async mouse(type, nx, ny, opts = {}) {
    const x = Math.max(0, Math.min(1, nx)) * this.viewport.width;
    const y = Math.max(0, Math.min(1, ny)) * this.viewport.height;
    let modifiers = 0;
    for (const [k, bit] of Object.entries(MOD)) if (opts[k]) modifiers |= bit;

    const button = opts.button || 'left';
    const btnBit = { left: 1, right: 2, middle: 4 }[button] || 1;   // 位掩码：1左 2右 4中

    let buttons = 0;
    if (type === 'mousePressed') { this._btnDown = button; buttons = btnBit; }
    else if (type === 'mouseReleased') { this._btnDown = null; buttons = 0; } // 抬起后"剩余按下"为 0
    else if (type === 'mouseMoved') { buttons = this._btnDown ? btnBit : 0; }

    const params = {
      type,
      x: Math.round(x), y: Math.round(y),
      button: type === 'mouseMoved' ? (this._btnDown ? button : 'none') : button,
      buttons,
      clickCount: type === 'mouseMoved' ? 0 : (opts.clickCount != null ? opts.clickCount : 1),
      modifiers,
    };
    return this._send(this.pageWs, 'Input.dispatchMouseEvent', params);
  }

  /** 滚轮：deltaX/deltaY 为"滚了多少个像素刻度"（正数向下/向右） */
  async wheel(nx, ny, deltaX, deltaY) {
    const x = Math.max(0, Math.min(1, nx)) * this.viewport.width;
    const y = Math.max(0, Math.min(1, ny)) * this.viewport.height;
    return this._send(this.pageWs, 'Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: Math.round(x), y: Math.round(y),
      deltaX: Math.round(deltaX), deltaY: Math.round(deltaY), button: 'none', buttons: 0,
    });
  }

  /* 整段文本输入：★ 中文的救星
   *   Input.insertText 是"把这段文本插进去"，不模拟逐字按键 → 天然支持中文、
   *   支持 emoji、支持粘贴长文本，完全绕过 IME 的坑。
   *   （前端的隐藏 IME 捕获框负责"把人输入的字攒成整段"，这里负责"整段落字"。） */
  async text(str) {
    if (!str) return;
    return this._send(this.pageWs, 'Input.insertText', { text: String(str) });
  }

  /** 特殊键（Enter / Backspace / 方向键 / 带修饰键的快捷键） */
  async key(name, type = 'keyDown', opts = {}) {
    const k = KEYS[name];
    if (!k) return;
    let modifiers = 0;
    for (const [key, bit] of Object.entries(MOD)) if (opts[key]) modifiers |= bit;
    const params = {
      type,
      key: k.key, code: k.code,
      windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk,
      modifiers,
    };
    // 文本要只在 keyDown 时给，且带修饰键时不给（Ctrl+C 不该插入字符）
    if (type === 'keyDown' && k.text && !modifiers) {
      params.text = k.text;
      params.unmodifiedText = k.text;
    }
    if (type === 'rawKeyDown') delete params.text;
    return this._send(this.pageWs, 'Input.dispatchKeyEvent', params);
  }

  /** 完整敲一下：按下 + 抬起 */
  async tap(name, opts = {}) {
    await this.key(name, 'rawKeyDown', opts);
    await this.key(name, 'keyUp', opts);
  }

  /** 组合键，例如 shortcut('ctrl', 'a') —— 远程协助里"全选/复制/粘贴"常用 */
  async shortcut(modifier, letter) {
    const opts = {};
    if (/^ctrl/i.test(modifier)) opts.ctrl = true;
    if (/^alt/i.test(modifier)) opts.alt = true;
    if (/^(shift)/i.test(modifier)) opts.shift = true;
    if (/^(meta|cmd|win)/i.test(modifier)) opts.meta = true;
    const ch = String(letter).toLowerCase();
    let modifiers = 0;
    for (const [k, bit] of Object.entries(MOD)) if (opts[k]) modifiers |= bit;
    const vk = ch.toUpperCase().charCodeAt(0);   // A~Z 的 ASCII 就是虚拟键码
    await this._send(this.pageWs, 'Input.dispatchKeyEvent', {
      type: 'rawKeyDown', key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: vk, modifiers,
    });
    await this._send(this.pageWs, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: vk, modifiers,
    });
  }

  /* =================================================================================
   *  导航 / 窗口 / 页面状态
   * ================================================================================= */
  async navigate(url) {
    let u = String(url || '').trim();
    if (!u) return null;
    // 智能补全：用户输 "bilibili.com" 应该能直接去，而不是被当成本地文件
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) {
      u = /^localhost(:\d+)?(\/|$)/i.test(u) || /^\d{1,3}(\.\d{1,3}){3}/.test(u)
        ? 'http://' + u
        : 'https://' + u;
    }
    // 只放行 http/https/about/data —— file:// 会把被控端的本地文件暴露给远端，必须挡
    if (!/^(https?|about|data):/i.test(u)) throw new Error('只支持 http/https 网址');
    this.log(`🌐 远程导航 → ${u}`);
    const r = await this._send(this.pageWs, 'Page.navigate', { url: u });
    await sleep(200);
    await this.refreshViewport();
    return r;
  }

  async currentUrl() {
    const r = await this._send(this.pageWs, 'Runtime.evaluate', {
      expression: 'location.href', returnByValue: true,
    }).catch(() => null);
    return r && r.result ? r.result.value : '';
  }

  async pageTitle() {
    const r = await this._send(this.pageWs, 'Runtime.evaluate', {
      expression: 'document.title', returnByValue: true,
    }).catch(() => null);
    return r && r.result ? r.result.value : '';
  }

  /** 在页面里跑一段 JS（仅本机测试用；远程通道不暴露这个能力——那是巨大的安全洞） */
  async evaluate(expression) {
    const r = await this._send(this.pageWs, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面脚本异常：' + (r.exceptionDetails.text || ''));
    return r.result ? r.result.value : undefined;
  }

  /** 窗口状态：maximized / normal / minimized / fullscreen —— "最大化"按钮就靠它 */
  async setWindowState(windowState = 'normal') {
    const w = await this._send(this.browserWs, 'Browser.getWindowForTarget', { targetId: this.targetId });
    await this._send(this.browserWs, 'Browser.setWindowBounds', {
      windowId: w.windowId, bounds: { windowState },
    });
    await sleep(300);
    await this.refreshViewport();
    return this.viewport;
  }

  /** 等页面加载完（导航后用，避免"截到白屏"） */
  async waitForLoad(timeoutMs = 15000) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(t); resolve(true); } };
      const off = (fn) => { const s = this._handlers.get('Page.loadEventFired'); if (s) s.delete(fn); };
      const fn = () => { off(fn); finish(); };
      this.on('Page.loadEventFired', fn);
      const t = setTimeout(() => { off(fn); finish(); }, timeoutMs);
      // 可能已经加载完了（事件不会再触发）→ 直接查 readyState 兜底
      this.evaluate('document.readyState').then((s) => { if (s === 'complete') { off(fn); finish(); } }).catch(() => {});
    });
  }

  /* ---- 手动抓一帧（测试用；正常流走 screencast）---- */
  async screenshot({ format = 'jpeg', quality = 60 } = {}) {
    const r = await this._send(this.pageWs, 'Page.captureScreenshot', { format, quality, optimizeForSpeed: true });
    return Buffer.from(r.data, 'base64');
  }

  kill() {
    try { this._alive = false; } catch (e) { /* ignore */ }
    try { if (this.browserWs) this.browserWs.close(); } catch (e) { /* ignore */ }
    try { if (this.pageWs) this.pageWs.close(); } catch (e) { /* ignore */ }
    try { if (this.proc && !this.proc.killed) this.proc.kill(); } catch (e) { /* ignore */ }
  }
}

module.exports = { Cdp, findBrowserBin, KEYS, MOD };

/* ---- 直接运行本文件 = 自检（node agent/cdp.js）----
 * 不做"只打印 OK"的假自检，而是**真的启动一次浏览器、真的点、真的打字、真的截图**。
 * 这是本项目的一贯做法：测试要能证明"东西真的跑起来了"。 */
if (require.main === module) {
  (async () => {
    const cdp = new Cdp({ headless: true, startUrl: 'about:blank' });
    try {
      await cdp.launch();
      const html = '<html><body style="margin:0;font:28px sans-serif;background:#fff">'
        + '<div id="d" style="padding:20px">点我</div>'
        + '<input id="i" style="font:24px sans-serif;width:600px;height:44px">'
        + '<script>document.getElementById("d").onclick=function(){this.textContent="被点到了"};</script>'
        + '</body></html>';
      await cdp.navigate('data:text/html;charset=utf-8,' + encodeURIComponent(html));

      /* ★ 坐标换算的严谨测法：不猜坐标，而是**问页面要元素真实位置**，
       *   再换算成归一化比例发回给自己——等于完整验证了
       *   "远端归一化坐标 → 被控端 CSS 像素"这条链路算得对不对。
       *   猜坐标只能测"能不能点"，这样测才能测出"点得准不准"。 */
      const probe = await cdp.evaluate(`(() => {
        const r = document.getElementById('i').getBoundingClientRect();
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
      })()`);
      const nx = probe.cx / cdp.viewport.width;
      const ny = probe.cy / cdp.viewport.height;
      console.log(`自检·视口 ${cdp.viewport.width}×${cdp.viewport.height}，目标像素 (${Math.round(probe.cx)},${Math.round(probe.cy)}) → 归一化 (${nx.toFixed(4)},${ny.toFixed(4)})`);

      const click = async (x, y) => {
        await cdp.mouse('mouseMoved', x, y);
        await cdp.mouse('mousePressed', x, y, { button: 'left', clickCount: 1 });
        await cdp.mouse('mouseReleased', x, y, { button: 'left', clickCount: 1 });
      };

      await click(nx, ny);                       // 点输入框（用真实位置反推的比例）
      await cdp.text('中文输入 OK');
      const typed = await cdp.evaluate('document.getElementById("i").value');
      console.log('自检·输入框内容 =', JSON.stringify(typed));

      // 再点一下标题 div，验证"点击事件真的派发到页面"（onclick 会改文字）
      const dp = await cdp.evaluate(`(() => {
        const r = document.getElementById('d').getBoundingClientRect();
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
      })()`);
      await click(dp.cx / cdp.viewport.width, dp.cy / cdp.viewport.height);
      await sleep(200);
      const label = await cdp.evaluate('document.getElementById("d").textContent');
      console.log('自检·点击后文本 =', label);

      if (label !== '被点到了') throw new Error('点击没有派发到页面元素');
      if (typed !== '中文输入 OK') throw new Error('键盘输入没有落到目标输入框');
      const buf = await cdp.screenshot();
      console.log('自检·截图字节数 =', buf.length);
      console.log('🎉 cdp.js 自检通过');
    } catch (e) {
      console.error('❌ 自检失败：', e.message);
      process.exitCode = 1;
    } finally {
      cdp.kill();
      setTimeout(() => process.exit(process.exitCode || 0), 300);
    }
  })();
}
