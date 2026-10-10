/* ════════════════════════════════════════════════════════════════
 * scripts/test-sfu-client-smoke.js —— SFU 版**浏览器端代码**的无头冒烟测试
 *
 * ▎为什么需要它？（补上"命令行验不了界面"的短板）
 *   `npm run test:sfu` 验的是**服务器**信令；`node --check` 只验语法。
 *   本脚本用"最小 DOM + 假 mediasoup-client + 假 socket.io"把 sfu/public/client.js
 *   **真的执行起来**，抓那些只有跑起来才会暴露的错（元素找不到、TDZ、undefined、
 *   事件回调里的渲染异常）——中文教学项目里这种错最容易被漏掉。
 *
 * ▎它验什么（76 项断言）：
 *   ① 顶层执行：全部元素查找 / 顶层监听注册 / startLocalMedia 链路；
 *   ② 媒体链路：initSFU → publishTracks（★ 断言摄像头 produce 带了 3 层 simulcast encodings）
 *      → subscribe（consume → 画面格 → peerScreens）；
 *   ③ D4 成员列表渲染 / D2 音量高亮 / D1 换层通知；
 *   ③b ★ F 档（2026-09-12）：视图切换（宫格/演讲者）、tile-main 大画面标记、钉选/取消、
 *      说话人行 speaking 高亮、net-levels 网络点、预览页「进入会议」；
 *   ③g ★ F6（2026-09-14）：滤镜管线（点档位 → 处理后轨顶替上行 → CPU 账徽标 →
 *      绿幕抠像 getImageData 路径 → 关滤镜还原原始轨 → 面板开合）；
 *   ③h ★ 实时字幕（2026-09-17，第 29 步）：远端字幕入条、识别器启动/自动重启、
 *      interim 半句只本地跳动不广播、成稿经 SCTP 广播、账本导出、开关关闭；
 *   ④ 远程协助全流程：授权 → 控制层 → 采集鼠标/滚轮**二进制帧**、触屏长按=右键、双指=滚轮、
 *      控制层四个工具按钮（截图/粘贴/复制/发文件）；
 *   ④b ★ D+1（2026-09-12）：SCTP 数据通道接线（produceData 带 sctpStreamParameters）、
 *      订阅老成员频道（consumeData）、SCTP 消息→聊天气泡、双发 msgId 去重、sendChat 双路径；
 *   ④c ★ 09-13：表情回应（数据通道 {type:react} + 飞屏）、举手（member-state.hand）、
 *      talk-stats 占比条、mousedown 涟漪；
 *   ④d ★ 09-14 F5：多频道 SCTP（chat+annot）、批注笔迹走独立频道（带 to 定向头）、
 *      对端笔迹账本重放、聊天路径徽标；
 *   ④e ★ 09-15 F7：白板（第三条 'board' 频道、覆盖层开合、笔迹三段、对端重放、clear）；
 *   ⑤ A4 文件分块发送、A3 剪贴板、A6 审计与重放、D5 录制按钮、D3 设备切换、D6 断线重连；
 *   ⑥ 任何回调抛异常都会被收集成"异常"并让脚本以非 0 退出（CI 友好）。
 *
 * ▎怎么跑（零新依赖，不需要起服务器）：
 *   npm run test:smoke        # 或 node scripts/test-sfu-client-smoke.js
 * ════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 用相对路径定位前端文件（换电脑/换目录都能跑）
const CLIENT = path.join(__dirname, '..', 'sfu', 'public', 'client.js');
const code = fs.readFileSync(CLIENT, 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};
const problems = [];
const guard = (label, fn) => { try { fn(); } catch (err) { problems.push(`${label}: ${err.message}\n${err.stack}`); } };

/* ---------- DOM 桩 ---------- */
const elementCache = new Map();
const createdEls = [];
function makeEl(id) {
  const listeners = new Map();
  const el = {
    id, children: [],
    /* ★ 2026-10-03 第 40 步：style 必须有 setProperty（真实 CSSStyleDeclaration 一直有）。
     *   桩里缺它，ringPulse 会在测试环境抛 TypeError，而我很可能顺手给生产代码加一句
     *   `if (r.style.setProperty)` 去"兼容"——**那是让代码适配失真的桩**（坑 51 家族）。
     *   规矩：桩要像真的，不是代码要像测试。closest() 同理：桩没有父子链，
     *   如实返回 null（= 没找到），而不是让调用方去猜"这个 API 可能不存在"。 */
    style: {
      setProperty(k, v) { this[k] = v; },
      removeProperty(k) { delete this[k]; },
      /* 同上：真 CSSStyleDeclaration 有 getPropertyValue。第 43 步的断言要读回自己写进去的
       *   几何变量（--pr-d 等），桩里没有它就只能报 "is not a function" —— 那是桩缺件，不是代码错。 */
      getPropertyValue(k) { return k in this ? String(this[k]) : ''; },
    },
    dataset: {}, files: [], value: '',
    closest() { return null; },
    textContent: '', innerHTML: '', disabled: false, checked: false,
    scrollTop: 0, scrollHeight: 0, offsetWidth: 1, srcObject: null,
    /* ★ 2026-10-05：clientWidth/clientHeight 也是真 DOM 一直有的几何读取器（与 offsetWidth 同族）。
     *   fitMainTile 会用 clientWidth 算可用宽；桩缺它时靠"行高量不出→提前 clear"侥幸不崩——
     *   侥幸不是语义，补上它，量得出几何的代码路径在桩里才走得通。 */
    clientWidth: 300, clientHeight: 150,
    videoWidth: 640, videoHeight: 360, readyState: 4,
    isContentEditable: false, tagName: 'DIV',
    /* ★ 09-24：className 与 classList 必须是**同一份真相**（真实 DOM 就是这样）。
     *   原先桩里 className 是独立字符串、classList 是另一个 Set，
     *   于是"用 className 赋类、再用 classList.contains 查"的代码在测试里查不到类名，
     *   断言失败了却怪不到代码头上 —— 桩不真实，就是在骗自己（或者冤枉好代码）。 */
    get className() { return [...this.classList._s].join(' '); },
    set className(v) { this.classList._s = new Set(String(v == null ? '' : v).split(/\s+/).filter(Boolean)); },
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(c, f) { if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { f ? this._s.add(c) : this._s.delete(c); } },
      contains(c) { return this._s.has(c); },
    },
    addEventListener(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, []); listeners.get(ev).push(fn); },
    removeEventListener(ev, fn) { const l = listeners.get(ev) || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
    /* ★ 2026-10-03 第 40 步：appendChild 记父、remove 真的从父的 children 里摘掉。
     *   原先 remove() 是空操作，于是"换文案不冲掉图标""环演完自己拆台（防长跑漏节点）"
     *   这两条保证**在测试里根本验不了**——断言只能数到一个永远不减的 children 数组。
     *   同上一条规矩：桩不真实，测的就是桩。
     * ★ 2026-10-04 第 43 步补两点（都是为了让"把子节点搬进新容器"这段真实代码能在桩里跑）：
     *   ① appendChild 要**真的搬走**（DOM 语义：一个节点同时只能有一个父），
     *      否则 `while (el.firstChild) stack.appendChild(el.firstChild)` 会原地打转——
     *      在真浏览器里它是移动的，在桩里不移动就是死循环；
     *   ② 补 firstChild 取值器：桩里没有它，上面那个 while 会一次都不进，
     *      于是"内容被搬进两层标签"这件事在测试里静默不成立（假绿）。 */
    appendChild(c) {
      const old = c.parentNode;
      if (old && old !== this) {
        const j = old.children.indexOf(c);
        if (j >= 0) old.children.splice(j, 1);
      }
      c.parentNode = this; this.children.push(c); return c;
    },
    get firstChild() { return this.children[0] || null; },
    /* ★ 2026-10-06 第 48 步补 insertBefore：真 DOM 一直有它（衬底层要插到最前面）。
     *   桩缺它的后果不是"测试红"，是"代码为了迁就桩而改写"——那是让产品适配失真的桩（坑 51）。
     *   语义照真的来：目标节点不存在就等价于 appendChild；存在就插到它前面；同样要搬走父节点。 */
    insertBefore(node, ref) {
      const old = node.parentNode;
      if (old && old !== this) {
        const j = old.children.indexOf(node);
        if (j >= 0) old.children.splice(j, 1);
      }
      node.parentNode = this;
      const at = ref ? this.children.indexOf(ref) : -1;
      if (at < 0) this.children.push(node); else this.children.splice(at, 0, node);
      return node;
    },
    remove() {
      const p = this.parentNode;
      if (!p) return;
      const i = p.children.indexOf(this);
      if (i >= 0) p.children.splice(i, 1);
      this.parentNode = null;
    }, click() { this.dispatch('click'); }, focus() {}, blur() {},
    setAttribute(k, v) { (this.__attrs || (this.__attrs = {}))[k] = v; },
    getAttribute(k) { return this.__attrs && k in this.__attrs ? this.__attrs[k] : null; },
    /* ★ 2026-10-03 第 41 步：补 removeAttribute / hasAttribute。
     *   桩原先只有 set/get —— 真实元素一直四个都有。缺它时思考条一调用就抛
     *   "b.removeAttribute is not a function"，看着像产品 bug，其实是桩不真实。
     *   同一条规矩：**先怀疑桩，再怀疑代码**（但要用"真实 DOM 到底有没有这个 API"来判）。 */
    removeAttribute(k) { if (this.__attrs) delete this.__attrs[k]; },
    hasAttribute(k) { return !!(this.__attrs && k in this.__attrs); },
    querySelector(sel) {
      const key = `${id}|${sel}`;
      if (!elementCache.has(key)) elementCache.set(key, makeEl(key));
      return elementCache.get(key);
    },
    querySelectorAll(sel) {
      /* ★ F 档起需要真的"找出子元素"：client.js 里 applyLevels/applyNetDots 会
       *   memberListEl.querySelectorAll('.member-row') 遍历成员行再逐行刷高亮/网络点。
       *   这里支持"单一 class 选择器"：只看直接子元素的 className（够用且最简单），
       *   复杂选择器（如 '.vol-bar > i'）仍返回 []。 */
      if (typeof sel !== 'string' || !sel.startsWith('.') || sel.includes(' ') || sel.includes('>')) return [];
      const cls = sel.slice(1);
      return this.children.filter((c) => String(c.className).split(/\s+/).includes(cls));
    },
    getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 360 }; },
    /* 2D 上下文桩：D5 录制 + 09-14 F5 批注都要用；lineTo/beginPath 计数给"真画了"断言。
     * ★ 09-14 F6：补 getImageData/putImageData（返回全 0 像素）——滤镜管线的色键路径
     *   在无头环境也能整条跑通（client.js 用 typeof 探测这两个 API，有就走抠像分支）。 */
    getContext() {
      return {
        drawImage() {}, fillRect() {}, fillStyle: '', clearRect() {},
        filter: 'none', globalAlpha: 1,
        getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
        putImageData() {},
        createLinearGradient() { return { addColorStop() {} }; },
        setTransform() {}, beginPath() { rec.canvasOps++; }, moveTo() {},
        lineTo() { rec.canvasOps++; }, stroke() {}, fill() {}, arc() {}, closePath() {},
        lineCap: '', lineJoin: '',
      };
    },
    toBlob(cb) { cb(null); },
    /* ★ 09-14 F6：captureStream 返回带一条视频轨的流（真浏览器行为）——
     *   滤镜管线要拿 getVideoTracks()[0] 当"处理后的轨"，返回空流会让管线起不来。 */
    captureStream() { return new MediaStreamStub([trackStub('video')]); },
    getSelection() { return { toString: () => '', modify() {} }; },
    execCommand() { return true; },
    contentDocument: null,
    dispatch(ev, arg) {
      const base = { preventDefault() {}, clientX: 100, clientY: 80, key: 'a', code: 'KeyA',
        altKey: false, ctrlKey: false, shiftKey: false, metaKey: false, pointerId: 1, pointerType: 'mouse', button: 0, deltaY: 0, target: null };
      const fake = Object.assign(base, arg || {});
      if (typeof fake.preventDefault !== 'function') fake.preventDefault = () => {};
      (listeners.get(ev) || []).forEach((fn) => fn(fake));
    },
    __listeners: listeners,
  };
  createdEls.push(el);
  return el;
}

/* ★ 2026-10-04 speechSynthesis 桩的记账容器（下面 window 桩里的 speak/cancel 写它） */
const speechStub = { spoken: [], utterances: [], cancels: 0, voices: [] };

const documentStub = {
  getElementById(id) { if (!elementCache.has(id)) elementCache.set(id, makeEl(id)); return elementCache.get(id); },
  querySelector(sel) { return makeEl(`doc|${sel}`); },
  querySelectorAll() { return []; },
  createElement(tag) { return makeEl(`new|${tag}`); },
  addEventListener() {}, removeEventListener() {},
  body: makeEl('body'),
  /* ★ 2026-10-07 第 49 步（明暗主题）补 documentElement：真浏览器里它永远存在，
   *   而主题的**唯一状态来源**就是 `<html data-theme>`。桩里没有它时，
   *   client.js 的 currentTheme() 直接抛错——而顶层抛错会把后面所有初始化一起砍掉
   *   （坑 69 那个形状），报出来的是一串与主题无关的红。
   *   ▸ 判据同 2026-10-06 那条：**先怀疑桩，再怀疑代码**，但要按"真实 DOM 有没有这个 API"判。 */
  documentElement: makeEl('html'),
  activeElement: null,
};

/* ---------- 媒体桩 ---------- */
class MediaStreamStub {
  constructor(tracks = []) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video'); }
  getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio'); }
  addTrack(t) { this.tracks.push(t); }
  removeTrack(t) { this.tracks = this.tracks.filter((x) => x !== t); }
}
const trackStub = (kind) => ({ kind, enabled: true, stop() {}, getSettings: () => ({ deviceId: kind === 'video' ? 'cam1' : 'mic1' }) });
/* ★ 09-17：Web Speech API 识别器桩——测试可驱动 onresult/onend，验证字幕全链路 */
class FakeRecognition {
  constructor() { rec.capInstances.push(this); this.lang = ''; this.continuous = false; this.interimResults = false; }
  start() { rec.capStarts++; }
  stop() { rec.capStops++; if (this.onend) this.onend(); } // 真 Chrome：stop() 会触发 onend
  abort() {}
}

/* ---------- 假 mediasoup-client（记录 produce 参数，验证 simulcast 接线）---------- */
const rec = {
  produceCalls: [], remoteInputs: 0, fileChunks: 0, clipboardSends: 0, fileOffers: 0, emits: [],
  dataProduceCalls: [],   // ★ D+1：produceData 的调用参数
  dataConsumeCalls: [],   // ★ D+1：consumeData 的调用参数
  sctpSends: [],          // ★ D+1：DataProducer.send 发出的原始消息
  dataMessageHandler: null, // ★ D+1：订阅成功后挂上的"收到 SCTP 消息"回调
  canvasOps: 0,             // ★ 09-14：2D 桩的作画次数（批注断言用）
  capInstances: [], capStarts: 0, capStops: 0, // ★ 09-17：字幕识别器桩的记录
  remoteInputPayloads: [],  // ★ 09-24：remote-input 的完整载荷（要验 16 字节帧/navigate 命令）
  remoteRequestTo: null,    // ★ 09-24：remote-request 的目标成员 id
  roomControlAcks: [],      // ★ 2026-10-06：room-control-ack 的载荷（要验"回执报的是状态成没成"）
  logouts: [],              // ★ 2026-10-09 第 52 步：auth-logout 的载荷（退出必须把票带出去）
  chatSignals: [],          // ★ 2026-10-09：chat-message 信令兜底那一路的载荷（双路径要两条都看得见）
  boardSignals: [],         // ★ 2026-10-10：board-signal 兜底载荷（要验"主路发不出去时兜底真的跑了"）
  dataProducers: [],        // ★ 2026-10-10：所有建出来的数据通道桩（测试要能把某一条改成 connecting）
};
class FakeProducer {
  constructor(id, appData) { this.id = id; this.appData = appData; this.closed = false; }
  async replaceTrack({ track }) { rec.lastReplaced = track; } // ★ F6：记录"上行轨换成了哪条"
  close() { this.closed = true; }
}
class FakeConsumer {
  constructor(id, kind) { this.id = id; this.kind = kind; this.producerId = 'up-' + id; this.track = trackStub(kind); }
  async resume() {} close() {}
}
/* ★ D+1：数据通道桩——send 记录消息；DataConsumer 的 on('message') 把回调交给 rec，
 *   测试里就能"冒充 mediasoup 送来一条 SCTP 消息"驱动 handleDataMessage。
 * ★ 2026-10-10 补两件事，为的是让"频道还没 open"那条分支第一次可测（坑 83 的反面用法）：
 *   ① 记下 label 并把自己推进 rec.dataProducers —— 否则测试拿不到那个对象，
 *      "把白板频道设成 connecting"这件事根本做不到；
 *   ② send() 在 readyState!=='open' 时**照浏览器那样同步抛**
 *      （真实链路里 mediasoup-client 的 send 只判自己有没有 close 过，
 *      然后把调用转给底层 RTCDataChannel —— 抛错的是浏览器，报错里的接口名就是它。
 *      桩不模仿这一句，客户端的守卫就永远测不到，代码写错也不会红）。 */
class FakeDataProducer {
  constructor(id, label) {
    this.id = id; this.label = label || ''; this.closed = false; this.readyState = 'open';
    rec.dataProducers.push(this);
  }
  send(str) {
    if (this.readyState !== 'open') {
      const e = new Error(`Failed to execute 'send' on 'RTCDataChannel': RTCDataChannel.readyState is not 'open'`);
      e.name = 'InvalidStateError';
      throw e;
    }
    if (this.throwOnSend) throw new Error('桩：故意让这一次 send 失败（模拟瞬间断开）');
    rec.sctpSends.push(str);
  }
  close() { this.closed = true; this.readyState = 'closed'; }
}
class FakeDataConsumer {
  constructor(id, params) {
    this.id = id; this.dataProducerId = (params || {}).dataProducerId; this.label = (params || {}).label || 'chat';
  }
  on(ev, fn) { if (ev === 'message') rec.dataMessageHandler = fn; }
  close() {}
}
class FakeTransport {
  constructor(kind) { this.kind = kind; this.id = 'transport-' + kind; this.handlers = {}; }
  on(ev, fn) { this.handlers[ev] = fn; }
  async produce(opts) {
    rec.produceCalls.push({ kind: opts.track.kind, encodings: opts.encodings, appData: opts.appData });
    // ★ F6：记下"摄像头上行的原始轨"引用（屏幕共享也是 video，要按 appData.source 区分）
    if (opts.track.kind === 'video' && opts.appData && opts.appData.source === 'camera') {
      rec.camUpstreamTrack = opts.track;
    }
    return new FakeProducer('producer-' + rec.produceCalls.length, opts.appData);
  }
  async consume({ id, kind }) { return new FakeConsumer(id, kind); }
  /* ★ D+1：produceData 要像真 mediasoup-client 一样先触发 'producedata' 事件
   *   （客户端代码会在里面 emit produce-data 问服务器要 dataProducerId），再返回 DataProducer */
  async produceData(opts) {
    rec.dataProduceCalls.push(opts);
    return new Promise((resolve) => {
      const h = this.handlers.producedata;
      const finish = (arg) => resolve(new FakeDataProducer((arg && arg.id) || 'dp-local', opts && opts.label));
      if (h) {
        h({ sctpStreamParameters: { streamId: 0, ordered: true }, label: opts.label, appData: opts.appData },
          (arg) => finish(arg), () => finish(null));
      } else finish(null);
    });
  }
  async consumeData(params) { rec.dataConsumeCalls.push(params); return new FakeDataConsumer('dc-' + rec.dataConsumeCalls.length, params); }
  async connect() {} close() {}
}
const sendT = new FakeTransport('send');
const recvT = new FakeTransport('recv');
const mediasoupStub = {
  Device: class {
    async load() {}
    get rtpCapabilities() { return { codecs: [] }; }
    createSendTransport() { return sendT; }
    createRecvTransport() { return recvT; }
  },
};

/* ---------- 假 socket ---------- */
const socketHandlers = new Map();
let consumeSeq = 0;
const PEER = 'PEERMEMBERID7777';
const socketStub = {
  id: 'FAKESOCKETID0001',
  /* ★ 2026-10-09 补上 connected（真 socket.io 一直有这个布尔）。
   *   桩里没有它 = 两条依赖它的分支**永久不测**（坑 83）：
   *   ① doLogout 的"发信令 vs 直接本地清"分岔，② 白板信令兜底 board-signal。
   *   补上之后第一次跑到这两条路，冒烟当场多抓出一处真缺陷（退出时断网那一路少了反馈）。 */
  connected: true,
  on(ev, fn) { if (!socketHandlers.has(ev)) socketHandlers.set(ev, []); socketHandlers.get(ev).push(fn); },
  off() {}, once(ev, fn) { this.on(ev, fn); },
  emit(ev, payload, cb) {
    rec.emits.push(ev);
    if (ev === 'remote-input') { rec.remoteInputs++; rec.remoteInputPayloads.push(payload); }
    if (ev === 'remote-request') rec.remoteRequestTo = payload && payload.to;   // ★ 09-24
    if (ev === 'desk-connect') {                                                // ★ 09-30 设备码直连
      rec.lastDeskConnect = payload;
      return cb({ data: { granted: false, hostId: 'DEVICEGRANTHOST1', hostName: '🖥️ 客厅电脑' } });
    }
    if (ev === 'clipboard-sync') rec.clipboardSends++;
    /* ★ 2026-10-10：兜底那条路的**载荷**也要看得见，只记事件名查不出"发的是不是同一条笔迹"
     *   （msgId 去重靠的就是同一条；两条内容不一样就等于各画各的）。 */
    if (ev === 'board-signal') rec.boardSignals.push(payload);
    if (ev === 'file-chunk') rec.fileChunks++;
    if (ev === 'file-offer') { rec.fileOffers++; rec.lastFileOffer = payload; }
    if (ev === 'remote-answer') rec.lastAllowAnswer = payload;
    if (ev === 'member-state') rec.lastMemberState = payload; // ★ 09-13：举手断言用
    if (ev === 'room-control-ack') rec.roomControlAcks.push(payload); // ★ 2026-10-06：AI 房间动作回执断言用
    if (ev === 'set-preferred-layers') rec.lastLayerPref = payload; // ★ G4：省流锁层断言用
    if (ev === 'files-view') { (rec.filesViews || (rec.filesViews = [])).push(payload); }
    if (ev === 'files-delete') {
      (rec.filesDeletes || (rec.filesDeletes = [])).push(payload);
      return cb({ data: { ok: true, name: payload && payload.name } });
    }
    if (ev === 'files-list') return cb({ data: { files: [], view: null } });
    if (ev === 'auth-login' || ev === 'auth-register') {
      rec.lastAuth = payload;
      return cb({ data: { user: { username: payload.username, displayName: payload.displayName || payload.username }, token: 'tok-test-123' } });
    }
    if (ev === 'auth-logout') {                                   // ★ 2026-10-09 第 52 步：退出登录
      rec.logouts.push(payload);
      return cb({ data: { ok: true } });
    }
    if (ev === 'chat-message') rec.chatSignals.push(payload);      // ★ 09-16 兜底路（署名来自服务器 socket 身份）
    if (ev === 'auth-verify') return cb({ error: '登录态已失效' }); // 冒烟环境无存档，不应触发
    if (typeof cb !== 'function') return;
    // 模拟服务器的请求-应答
    if (ev === 'get-router-rtp-capabilities') return cb({ data: { rtpCapabilities: { codecs: [] } } });
    if (ev === 'create-webrtc-transport') return cb({ data: { transportId: 'transport-' + (payload.direction), iceParameters: {}, iceCandidates: [], dtlsParameters: {} } });
    if (ev === 'transport-connect') return cb({ data: {} });
    if (ev === 'produce') return cb({ data: { producerId: 'server-producer' } });
    // ★ D+1：数据通道的请求-应答（produce-data 由 wireTransport 的 'producedata' 处理器发出）
    if (ev === 'produce-data') return cb({ data: { dataProducerId: 'server-dp-' + rec.dataProduceCalls.length } });
    if (ev === 'consume-data') return cb({ data: { dataConsumerId: 'server-dc-' + (++consumeSeq), dataProducerId: payload.dataProducerId, label: String(payload.dataProducerId).includes('annot') ? 'annot' : String(payload.dataProducerId).includes('board') ? 'board' : 'chat', protocol: '', sctpStreamParameters: { streamId: 1, ordered: true } } });
    if (ev === 'consume') return cb({ data: { consumerId: 'consumer-' + (++consumeSeq), producerId: payload.producerId, kind: payload.kind, rtpParameters: {}, appData: { source: 'screen' } } });
    return cb({ data: {} });
  },
  disconnect() {},
};

const ctx = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: (fn) => setTimeout(fn, 0), cancelAnimationFrame: (id) => clearTimeout(id),
  performance,
  URL: Object.assign(class extends URL {}, { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} }),
  URLSearchParams,
  Blob: class { constructor(parts) { this.parts = parts; this.size = 0; } },
  TextEncoder, TextDecoder,
  MediaStream: MediaStreamStub,
  MediaRecorder: class { static isTypeSupported() { return true; } start() {} stop() {} },
  AudioContext: class { createMediaStreamDestination() { return { stream: new MediaStreamStub() }; } createMediaStreamSource() { return { connect() {} }; } close() {} },
  io: () => socketStub,
  mediasoupClient: mediasoupStub,
  /* ★ 2026-10-04 补 speechSynthesis 桩——为了关掉一块真实的测试盲区。
   * ▎症状：`speakStreamPart()` 里写了 `answerTs: id`，而那个作用域根本没有 `id` 变量，
   *   每次流式切出一整句就抛一次 ReferenceError（真浏览器控制台抓到 3 次）。
   *   而冒烟连跑了两天全绿——因为桩里没有 speechSynthesis，`SPEECH_OK=false`，
   *   那一行**从来没被执行过**。
   * ▎教训（与坑 57/65/76 同族）：**桩里缺一个能力，等于那条分支永久不测**；
   *   而且它比"断言写错"更隐蔽，因为没有任何东西变红。
   *   现在 speak() 把文本记进 speechStub.spoken，可以真的断言"哪一句上了嘴"。 */
  SpeechSynthesisUtterance: class {
    constructor(text) { this.text = text; this.lang = ''; this.rate = 1; this.pitch = 1; this.volume = 1; }
  },
  speechSynthesis: {
    speaking: false, pending: false,
    /* ★ 2026-10-04 speak() 之后要依次回调 onstart / onend，否则桩只"收下"永远不"念完"：
     *   分句朗读的泵是靠 onend 接力到下一句的（client.js 的 speakNext），
     *   桩里不回调就等于队列永远只念第一句，"多句排队"那条路仍然测不到。
     *   真浏览器里被 cancel 的那句走 onerror，而泵有"代号"守卫（aiSpeakGen），
     *   所以这里统一回调 onend 是安全的——旧泵的闭包看一眼代号就静默退出。 */
    speak(u) {
      speechStub.spoken.push(String((u && u.text) || ''));
      speechStub.utterances.push(u);
      setTimeout(() => { try { if (u.onstart) u.onstart(); } catch (e) {} }, 0);
      setTimeout(() => { try { if (u.onend) u.onend(); } catch (e) {} }, 0);
    },
    cancel() { speechStub.cancels += 1; },
    getVoices() { return speechStub.voices; },
    onvoiceschanged: null,
  },
  SpeechRecognition: FakeRecognition,
  webkitSpeechRecognition: FakeRecognition,
  navigator: {
    mediaDevices: {
      getUserMedia: async () => new MediaStreamStub([trackStub('video'), trackStub('audio')]),
      getDisplayMedia: async () => new MediaStreamStub([trackStub('video')]),
      enumerateDevices: async () => [
        { kind: 'videoinput', deviceId: 'cam1', label: 'Fake Cam' },
        { kind: 'audioinput', deviceId: 'mic1', label: 'Fake Mic' },
      ],
      addEventListener() {},
    },
    clipboard: { readText: async () => 'clip-text', writeText: async () => {} },
  },
  document: documentStub,
  location: { origin: 'http://localhost:3001', search: '', reload: () => {} },
  alert: () => {},
};
ctx.window = ctx; ctx.globalThis = ctx;
// ★ 09-16：localStorage 桩（登录态存取）；真实浏览器有，无头环境必须补
const storageData = {};
ctx.localStorage = {
  getItem: (k) => (k in storageData ? storageData[k] : null),
  setItem: (k, v) => { storageData[k] = String(v); },
  removeItem: (k) => { delete storageData[k]; },
};
ctx.innerWidth = 1280; ctx.innerHeight = 720; ctx.isSecureContext = true;
/* ★ 2026-10-05 补 getComputedStyle 桩——为"大画面等比适配"（fitMainTile）兜底。
 * ▎规矩同 speechSynthesis 那条（坑 83）：**桩里缺一个宿主能力 = 那条分支永久不测**；
 *   而 fitMainTile 每个布局变化都会走（applyLayoutDOM 尾部），缺它整个冒烟当场 ReferenceError。
 * ▎形态与真浏览器同语义，不是给代码开后门：
 *   · display/visibility —— layerIsUp（Esc 关层用）本来就是这么判的；
 *   · gridTemplateRows 返回空串 —— 假 DOM 量不出真实行高，fitMainTile 据此走 clear 分支
 *     （不写 CSS 变量），与真浏览器"量不出就不写"完全同一个语义。 */
ctx.getComputedStyle = (el) => ({
  display: (el && el.classList && typeof el.classList.contains === 'function' && el.classList.contains('hidden')) ? 'none' : 'block',
  visibility: 'visible',
  gridTemplateRows: '',
});
ctx.window.mediasoupClient = mediasoupStub;
ctx.SPEAKER_HOLD_MS = 30; // ★ 09-18 演讲人交接迟滞的坐稳阈值——桩里缩短，测试才不用等 1.5 秒
/* ★ 09-17e 值守（C3-N1，第 30 步）：fetch 桩——归档上传/全档拉取走全局 fetch，
 *   无头环境本来没有它（client 防御式跳过），要断言"溢出真的发了 POST"就必须给桩。
 *   桩把每次调用记录进 rec.fetchCalls，POST 的 saved 按载荷里的条数如实应答。 */
rec.fetchCalls = [];
ctx.fetch = async (url, opts = {}) => {
  rec.fetchCalls.push({ url: String(url), method: (opts.method || 'GET').toUpperCase(), body: opts.body || null });
  // ★ 09-27d：/config.json 返回 asrEnabled:true——覆盖"Web Speech 失败立即降级"路径
  if (String(url).includes('/config.json')) {
    return { ok: true, status: 200, json: async () => ({ iceServers: [], asrEnabled: true, authTtlMs: 86400000 }) };
  }
  let saved = 0;
  try { saved = (JSON.parse(opts.body || '{}').entries || []).length; } catch (e) { saved = 0; }
  /* ★ 2026-10-07 第 51 步：共享文件的两条 GET。
   * ▎为什么要在桩里补真能力（而不是让 client.js 走"FV 不在 / fetch 失败"的降级分支）：
   *   桩里缺一种能力 = 那条分支永久不测，而且**没有任何东西会变红**（坑 83 的原话）。
   *   "打开一份文档 → 内核渲染"是这一步的主路径，不给这两条桩它就一次都没跑过。
   * ▎arrayBuffer 必须在 **vm 世界里**造（跨 realm 坑，见上面 newFrame 那段注释：
   *   宿主世界的 ArrayBuffer 过不了 client.js 里的 instanceof / byteOffset 语义）。 */
  if (String(url).includes('/api/files')) {
    return {
      ok: true, status: 200,
      json: async () => ({
        files: (rec.filesData || []).map((f) => ({ name: f.name, size: f.size || 12, ts: f.ts || Date.now(), byId: f.byId || null, byName: f.byName || '小张' })),
        view: rec.filesView || null,
        limits: { maxFileBytes: 41943040, maxRoomBytes: 419430400, maxCount: 60 },
      }),
    };
  }
  if (String(url).includes('/files/')) {
    const bytes = Array.from(Buffer.from(rec.fileContent || '# 评审会\n\n- 第一项\n', 'utf8'));
    return {
      ok: true, status: 200,
      blob: async () => ({
        arrayBuffer: async () => newUint8From(bytes).buffer,
        size: bytes.length,
      }),
    };
  }
  return {
    ok: true, status: 200,
    text: async () => '[07:00:01] 小张: 服务器归档的一句',
    json: async () => ({ saved }),
  };
};

/* ★ 09-13：预置表情回应按钮——真实 DOM 来自 index.html，假 DOM 里手动挂上。
 * client.js 加载时就对 .react-btn 绑监听，所以必须在 runInContext 之前挂好。 */
const reactBarEl = documentStub.getElementById('reactBar');
for (const emo of ['👍', '❤️', '😂', '🎉', '👏', '🤔']) {
  const b = makeEl('react-' + emo);
  b.className = 'react-btn';
  b.dataset.emoji = emo;
  reactBarEl.children.push(b);
  createdEls.push(b);
}

/* ★ 09-14 F6：预置滤镜面板的三组 chip——client.js 加载时对 .fx-chip 绑监听
 *   （querySelectorAll 单类选择器只认直接 children），必须在 runInContext 之前挂好。 */
const fxChipDefs = {
  fxPresets: [['none', '原图'], ['natural', '自然'], ['cool', '冷白'], ['warm', '暖阳'], ['mono', '水墨']],
  fxKeys: [['green', '绿幕'], ['blue', '蓝幕']],
  fxBgs: [['ink', '墨色'], ['silk', '绢色'], ['gold', '鎏金'], ['image', '图片']],
};
for (const [boxId, defs] of Object.entries(fxChipDefs)) {
  const box = documentStub.getElementById(boxId);
  for (const [val, label] of defs) {
    const b = makeEl(`${boxId}-${val}`);
    b.className = `fx-chip${val === 'none' || val === 'green' || val === 'ink' ? ' active' : ''}`;
    b.dataset[boxId === 'fxPresets' ? 'preset' : boxId === 'fxKeys' ? 'key' : 'bg'] = val;
    b.textContent = label;
    box.children.push(b);
    createdEls.push(b);
  }
}
/* 滤镜面板的初始态：真浏览器里 HTML 写的是 class="fx-panel hidden"（关着的），
 * 假 DOM 不会从 HTML 初始化 classList —— 不补上这条，toggle 开合语义就反了（点一下反而关上）。
 * ★ 09-17b：字幕历史抽屉同款（cap-history hidden）。 */
documentStub.getElementById('fxPanel').classList.add('hidden');
documentStub.getElementById('capHistoryPanel').classList.add('hidden');

vm.createContext(ctx);
/* ★ 2026-10-07 第 51 步：把共享文件的渲染内核也装进同一个上下文。
 * ▎为什么必须装：index.html 里 fileview.js 排在 client.js 之前，两边是**一起加载**的。
 *   桩里没有它，client.js 的"打开文件"那条路就永久走的是"FV 不存在"降级分支——
 *   正是坑 83 说的形状：**假环境缺一种能力，那条分支就永远不测，而测试照样全绿**。
 *   桩的 window === 上下文本身（上面第 408 行），所以内核的 root.FV 直接就是裸 FV。 */
const FILEVIEW = path.join(__dirname, '..', 'sfu', 'public', 'fileview.js');
try {
  vm.runInContext(fs.readFileSync(FILEVIEW, 'utf8'), ctx, { filename: 'fileview.js' });
  ok('共享文件渲染内核（fileview.js）能在同一上下文里加载并挂上 FV',
     vm.runInContext('typeof FV === "object" && typeof FV.render === "function"', ctx));
  ok('内核版本号存在（排障时能一眼看出跑的是哪一版）',
     /^\d{4}-\d{2}-\d{2}/.test(String(vm.runInContext('FV.version', ctx))));
} catch (err) {
  ok('共享文件渲染内核能加载', false, err.message);
  problems.push(`fileview.js 加载: ${err.stack}`);
}
// ★ 跨 realm 坑：client.js 在 vm 世界里做 `event instanceof ArrayBuffer`，
//   宿主（本脚本）世界造的帧过不了这个检查（instanceof 比对的是各自身上的构造器），
//   帧会被静默跳过。所以测试用的二进制帧必须在 vm 世界里造——这个 helper 就是干这个的。
const newFrame = vm.runInContext('(n) => new ArrayBuffer(n)', ctx);
const newUint8From = vm.runInContext('(arr) => Uint8Array.from(arr)', ctx);
try {
  vm.runInContext(code, ctx, { filename: 'client.js' });
  ok('顶层执行通过（元素查找 / 顶层监听 / startLocalMedia 链路无异常）', true);
} catch (err) {
  ok('顶层执行通过', false, err.message);
  problems.push(`顶层执行: ${err.stack}`);
}

const emit = (ev, payload) => {
  const list = socketHandlers.get(ev) || [];
  if (!list.length) { problems.push(`事件 ${ev} 没有监听器`); return; }
  list.forEach((fn) => guard(`事件 ${ev} 回调`, () => fn(payload)));
};

(async () => {
  await new Promise((r) => setTimeout(r, 120)); // 等 startLocalMedia / refreshDeviceList

  /* ---- ② 媒体链路：room-members → initSFU → publishTracks → subscribe ---- */
  emit('room-members', {
    roomNumber: '123456',
    members: [{ id: PEER, producers: [{ producerId: 'up-screen', kind: 'video', appData: { source: 'screen' } }],
      dataProducers: [{ dataProducerId: 'peer-dp-1', label: 'chat' }] }], // ★ D+1：老成员的数据通道清单
  });
  await new Promise((r) => setTimeout(r, 300));

  const cam = rec.produceCalls.find((p) => p.appData && p.appData.source === 'camera');
  const mic = rec.produceCalls.find((p) => p.appData && p.appData.source === 'mic');
  ok('D1 publishTracks 上传了麦克风 + 摄像头各一路', !!cam && !!mic);
  ok('D1 摄像头 produce 带 3 层 simulcast encodings（q/h/f）',
    !!cam && Array.isArray(cam.encodings) && cam.encodings.length === 3 &&
    cam.encodings.map((e) => e.rid).join('') === 'qhf',
    cam ? JSON.stringify((cam.encodings || []).map((e) => e.rid)) : 'camera 未上传');
  ok('D1 simulcast 三档码率/缩放符合设计（150k/500k/1500k）',
    !!cam && cam.encodings[0].maxBitrate === 150000 && cam.encodings[1].maxBitrate === 500000 && cam.encodings[2].maxBitrate === 1500000);
  ok('摄像头单层 fallback 未被触发（说明 encodings 路径成功）',
    rec.produceCalls.filter((p) => p.appData && p.appData.source === 'camera').length === 1);

  /* ---- ③ 成员列表 / 音量 / 换层 ---- */
  emit('room-state', {
    roomNumber: '123456',
    members: [
      { id: socketStub.id, owner: true, muted: false, camOff: false, sharing: false },
      { id: PEER, owner: false, muted: true, camOff: false, sharing: true },
    ],
    hostId: null, controllerId: null, expiresAt: null,
  });
  ok('D4 room-state 渲染不抛错（成员列表重建）', true);
  emit('audio-levels', { levels: [{ id: PEER, volume: -20 }], top: PEER });
  emit('audio-levels', { levels: [], top: null });
  ok('D2 音量广播处理不抛错（高亮 + 音量条）', true);
  emit('layer-changed', { consumerId: 'consumer-1', producerId: 'up-screen', spatialLayer: 1, layerCount: 3, auto: true, reason: 'auto-down' });
  ok('D1 换层通知处理不抛错（写入 layerState + 选层器）', true);

  /* ---- ③b ★ F 档（2026-09-12）：视图切换 / 钉选 / 说话人行 / 网络点 / 预览页 ----
   * ▎说明：假 DOM 里 createElement 造的按钮和 querySelector 查到的"同名"元素是两个对象，
   *   所以点击走 createdEls 里的真按钮（监听器挂在它身上），而 refreshPinBtns/
   *   applyNetDots 更新的是 box.querySelector 查出来的缓存元素 —— 断言要按各自路径取。 */
  const videoGridEl = documentStub.getElementById('videoGrid');
  emit('new-producer', { producerId: 'up-cam', kind: 'video', appData: { source: 'camera' }, from: PEER });
  await new Promise((r) => setTimeout(r, 120)); // 等订阅 + 建主画面格（含「钉选」按钮）

  const viewSpeakerBtn = documentStub.getElementById('viewSpeakerBtn');
  guard('F1 切演讲者视图', () => viewSpeakerBtn.dispatch('click'));
  ok('F1 演讲者视图：网格容器有 layout-speaker 类', videoGridEl.classList.contains('layout-speaker'));
  ok('F1 大画面已标 tile-main（跟随共享者：room-state 里 PEER 在共享）',
    createdEls.some((e) => e.classList.contains('tile-main')));

  emit('audio-levels', { levels: [{ id: PEER, volume: -20 }], top: PEER });
  const peerRow = createdEls.find((e) => e.dataset && e.dataset.id === PEER);
  ok('F1/D2 说话人所在成员行有 speaking 高亮（renderMembers 重构后 D2 仍工作）',
    !!peerRow && peerRow.classList.contains('speaking'));

  const pinBtn = createdEls.find((e) => e.className === 'pin-btn');
  guard('F1 点击钉选', () => pinBtn && pinBtn.dispatch('click'));
  const pinHtml = () => String((elementCache.get('new|div|.pin-btn') || {}).innerHTML || '');
  ok('F1 钉选后按钮更新为已钉选（refreshPinBtns 路径；图标与文案同出一次 setIconBtn）',
    !!pinBtn && /已钉选/.test(pinHtml()) && /class="i/.test(pinHtml()));
  guard('F1 取消钉选', () => pinBtn && pinBtn.dispatch('click'));
  ok('F1 取消钉选后文案还原（图标还在、只有"已"字消失）',
    !/已钉选/.test(pinHtml()) && /钉选/.test(pinHtml()) && /class="i/.test(pinHtml()));
  guard('F1 切回宫格视图', () => documentStub.getElementById('viewGalleryBtn').dispatch('click'));
  ok('F1 宫格视图：layout-speaker 类已移除', !videoGridEl.classList.contains('layout-speaker'));

  guard('F2 收到 net-levels 广播', () => emit('net-levels', { levels: { [PEER]: 2 } }));
  ok('F2 网络点按等级变色（PEER 丢包差 → net-2 红）',
    String((elementCache.get('new|div|.m-net') || {}).className || '').includes('net-2'));

  guard('F3 预览页「进入会议」', () => documentStub.getElementById('pjEnterBtn').dispatch('click'));
  ok('F3 点击后预览页隐藏（stopPrejoinMeter + 预静音路径不抛错）',
    documentStub.getElementById('prejoin').classList.contains('hidden'));

  /* ---- ④b ★ D+1（2026-09-12）：SCTP 数据通道 ---- */
  const dpCall = rec.dataProduceCalls[0];
  ok('D+1 进房后 produceData 开了聊天频道（label=chat）',
    !!dpCall && dpCall.label === 'chat' && rec.emits.includes('produce-data'));
  ok('D+1 订阅了老成员的数据频道（consumeData 带 dataProducerId）',
    rec.dataConsumeCalls.some((c) => c.dataProducerId === 'peer-dp-1'));

  // SCTP 收到的消息 → 聊天气泡；同 msgId 的信令重复消息被去重
  const chatListEl = documentStub.getElementById('chatList');
  const chatCountBefore = chatListEl.children.length;
  const sctpMsg = JSON.stringify({ type: 'chat', msgId: 'msg-smoke-1', text: 'SCTP 你好' });
  guard('D+1 模拟收到 SCTP 消息', () => rec.dataMessageHandler && rec.dataMessageHandler(sctpMsg));
  const afterSctp = chatListEl.children.length;
  emit('chat-message', { from: PEER, text: 'SCTP 你好', ts: Date.now(), msgId: 'msg-smoke-1' });
  emit('chat-message', { from: PEER, text: 'SCTP 你好', ts: Date.now(), msgId: 'msg-smoke-1' });
  ok('D+1 SCTP 消息渲染成聊天气泡（+1 条）', afterSctp === chatCountBefore + 1);
  ok('D+1 同 msgId 的信令重复消息被去重（不再 +1）',
    chatListEl.children.length === afterSctp &&
    chatListEl.children.some((c) => String(c.innerHTML).includes('SCTP 你好')));

  // sendChat 双路径：SCTP 主路发出 + 信令兜底（两条路带同一个 msgId）
  const sctpSendsBefore = rec.sctpSends.length;
  documentStub.getElementById('chatInput').value = '数据通道你好';
  guard('D+1 点击发送', () => documentStub.getElementById('chatSendBtn').dispatch('click'));
  const sent = rec.sctpSends.slice(sctpSendsBefore).map((s) => JSON.parse(s));
  ok('D+1 sendChat 主路走 SCTP（消息带 msgId）',
    sent.some((m) => m.text === '数据通道你好' && typeof m.msgId === 'string'));
  const echo = sent[0];
  emit('chat-message', { from: socketStub.id, text: echo.text, ts: Date.now(), msgId: echo.msgId });
  ok('D+1 信令兜底路到达时被 msgId 去重（自己不重复显示）',
    chatListEl.children.length === afterSctp + 1); // 只多 SCTP 路自己那一帧去重后 +1（自己 via 信令 echo 显示一次）

  /* ---- ③c ★ 09-13："真实有用"三件套（表情回应 / 举手 / 发言占比）---- */
  const sctpBeforeReact = rec.sctpSends.length;
  const reactBtn = createdEls.find((e) => e.className === 'react-btn' && e.dataset.emoji === '🎉');
  guard('F4 点击表情回应', () => reactBtn.dispatch('click'));
  ok('F4 表情回应走 D+1 数据通道（{type:react} 带表情）',
    rec.sctpSends.slice(sctpBeforeReact).some((x) => {
      try { const m = JSON.parse(x); return m.type === 'react' && m.emoji === '🎉'; } catch (e) { return false; }
    }));
  guard('F4 收到对端回应 → 飞屏', () => rec.dataMessageHandler && rec.dataMessageHandler(JSON.stringify({ type: 'react', emoji: '👍' })));
  ok('F4 对端回应渲染成本地飞屏元素（.react-fly）',
    createdEls.some((e) => e.classList && e.classList.contains('react-fly')));

  guard('F4 举手', () => documentStub.getElementById('handBtn').dispatch('click'));
  ok('F4 举手 → member-state 上报 hand:true',
    !!(rec.lastMemberState && rec.lastMemberState.patch && rec.lastMemberState.patch.hand === true));
  guard('F4 放下手', () => documentStub.getElementById('handBtn').dispatch('click'));
  ok('F4 放下手 → member-state 上报 hand:false',
    !!(rec.lastMemberState && rec.lastMemberState.patch && rec.lastMemberState.patch.hand === false));
  guard('F4 收到 talk-stats 广播', () => emit('talk-stats', { stats: [{ id: PEER, sec: 42, share: 30 }] }));
  ok('F4 talk-stats 处理不抛错（占比条刷新）', true);

  /* ---- ③d ★ 09-14 F5：协作批注（多频道 SCTP + 定向头）---- */
  ok('F5/F7 三条 SCTP 频道并存（chat + annot + board）',
    rec.dataProduceCalls.length === 3 &&
    rec.dataProduceCalls[0].label === 'chat' && rec.dataProduceCalls[1].label === 'annot' &&
    rec.dataProduceCalls[2].label === 'board');
  ok('D+1 聊天消息带路径徽标（msg-via 🛰️）',
    chatListEl.children.some((c) => String(c.innerHTML).includes('msg-via')));

  // 本地画：PEER 的屏幕格上开笔 → 走 annot 频道广播 start/draw/end
  const annotCanvasEl = createdEls.find((e) => e.className === 'annot-canvas');
  const annotPenBtn = createdEls.find((e) => String(e.className).includes('annot-pen'));
  ok('F5 屏幕格挂了批注层 + 工具条', !!annotCanvasEl && !!annotPenBtn);
  /* ★ 2026-10-05 问题⑥（用户："共享会议屏幕比例还是有点不协调"）：
   *   屏幕共享格的视频必须 contain（看全），而摄像头格保持 cover（填满）——
   *   判据落在"类名与 CSS 规则成对出现"：只挂类不写规则 = 改了没生效，
   *   只写规则不挂类 = 永远不命中（坑 47 家族：一个概念只能有一个来源，这里是有两半）。 */
  const screenBoxEl = createdEls.find((e) => String(e.className).includes('video-box') && String(e.innerHTML).includes('的屏幕'));
  ok('2026-10-05 远端屏幕格挂 source-screen 类（问题⑥：共享内容 contain 不裁边）',
    !!(screenBoxEl && screenBoxEl.classList.contains('source-screen')));
  const cssScreenSrc = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'style.css'), 'utf8');
  /* ★★ 2026-10-07 坑 26 的那条**结构性红线**：注释必须成对闭合。
   *   ▎为什么现在才加：坑 26（CSS 注释里写出了"星杠"闭合串，把 `:root{}` 整块吞掉 ⇒ 全站 CSS 变量为空）
   *     是本项目**最贵的一次排版事故**，而当时的防守是"注释里绝不写那个序列"这条**人的纪律**——
   *     纪律会被忘掉，正如坑 40 那条注释里写的"记得 bump 版本"被忘过一样。
   *   ▎本轮加浅色主题时扫这条，当场抓到一处**从 2026-10-02 就存在**的未闭合注释
   *     （`git show HEAD:style.css` 复核过，不是我这次改出来的）：第 27 节那行的注释
   *     结尾只有装饰横线、少了那对"星杠"闭合符，
   *     于是它把**下一个小节头**一起吞成了注释。这次恰好没吞掉规则（被吞的也是注释），
   *     所以两年没人看见——**"这次没坏"不是"这写法安全"**，下一个规则排在它后面就会静默失效。
   *   ▸ 判据：从头扫一遍，深度必须归零；且不许出现"深度为 0 时闭合"（过早闭合会吞掉后面整块）。 */
  {
    let depth = 0, firstUnclosedLine = 0, premature = 0;
    const src = cssScreenSrc;
    for (let i = 0; i < src.length; i++) {
      if (src[i] === '/' && src[i + 1] === '*') { if (depth === 0) firstUnclosedLine = src.slice(0, i).split('\n').length; depth++; i++; }
      else if (src[i] === '*' && src[i + 1] === '/') { depth--; i++; if (depth < 0) { premature = src.slice(0, i).split('\n').length; depth = 0; } }
    }
    ok('2026-10-07 style.css 的块注释成对闭合（坑 26 的结构红线：深度归零、且没有过早闭合）',
      depth === 0 && premature === 0,
      depth ? `未闭合的注释起于第 ${firstUnclosedLine} 行（它会把后面所有规则一起吞掉）`
        : premature ? `第 ${premature} 行有孤立的 */（会提前终止上一个注释）` : '');
  }
  /* ★ 2026-10-09 L6-lite：断言助手的**参数顺序**也要有常驻守卫（坑 110）。
   *   本仓库同时存在 ok(名字, 条件)（多数文件）与 ok(条件, 名字)（test-watch.js），
   *   复制粘贴就会写出"永真断言"——而且它不报错，只是永远绿。
   *   现在两种约定都接了 scripts/assert-order-guard.js；这条结构红线钉的是：
   *   **凡是自己定义 ok 的 test-*.js，都必须引用那个守卫**（新增测试文件漏接 = 当场红）。
   *   ▸ 为什么判"引用"而不是判"内容像不像守卫"：正则去猜一段防护代码写没写对，
   *     本身就是坑 63/126 那种"探针猜被测对象"的做法；引用是一个可 grep 的事实。 */
  {
    const dirs = path.join(__dirname);
    const files = fs.readdirSync(dirs).filter((f) => /^test-.*\.js$/.test(f));
    const missing = [];
    let withOk = 0;
    for (const f of files) {
      const src = fs.readFileSync(path.join(dirs, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (!/(^|\n)\s*(const|function)\s+ok\s*[=(]/.test(src)) continue;
      const body = (src.match(/(^|\n)\s*(?:const|function)\s+ok[\s\S]{0,420}/) || [''])[0];
      // 只钉"这是台断言报告器"的文件（会打 PASS）；同名局部变量不算（test-ai-brain 里就有一个）
      if (!/PASS/.test(body)) continue;
      withOk++;
      const guarded = src.includes('assert-order-guard')
        || /typeof\s+(?:name|n|a)\s*!==\s*'string'/.test(body)
        || /typeof\s+cond\s*!==\s*'boolean'/.test(body);
      if (!guarded) missing.push(f);
    }
    ok(`2026-10-09 L6：每台断言报告器都接了参数顺序守卫（坑 110；扫到 ${withOk} 个文件）`,
      missing.length === 0 && withOk >= 12,
      missing.length ? `没接守卫的：${missing.join(' , ')}` : `withOk=${withOk}`);
    /* 守卫本身也要被测到——"防错的代码"没人测，等于没有（坑 41/56 那条老账）。
     *   最要紧的是第三例：坑 110 那次真实写出来的形状（ok(true, '名字') 混进 ok('名字', 条件) 的文件）。 */
    const guardMod = require(path.join(__dirname, 'assert-order-guard.js'));
    ok('L6 守卫：name-first 文件里把 (条件, 名字) 复制过来 ⇒ 必须报（坑 110 的原形状）',
      typeof guardMod.guard('name-first', true, '这条测的是别的东西') === 'string',
      JSON.stringify(guardMod.guard('name-first', true, 'x')));
    ok('L6 守卫：名字位上出现 "true"/纯数字 ⇒ 必须报（那正是"9 条全绿"的露馅方式）',
      typeof guardMod.guard('name-first', 'true', false) === 'string'
      && typeof guardMod.guard('name-first', '42', false) === 'string');
    ok('L6 守卫：cond-first 文件里反过来写 ok(名字, 条件) ⇒ 必须报',
      typeof guardMod.guard('cond-first', '这条测的是别的东西', false) === 'string');
    ok('L6 守卫：两种约定的**正确写法**都不许报（守卫自己误伤，比不装更糟——它会教人把它删掉）',
      guardMod.guard('name-first', '正常一条断言', 1 === 1) === null
      && guardMod.guard('name-first', '条件是字符串也算合法真值', '非空') === null
      && guardMod.guard('cond-first', 2 + 2 === 4, '正常一条断言') === null);
  }
  /* ★ 2026-10-06 下面这一组 CSS 判据全部跑在**剥掉注释的源码**上，两个理由缺一不可：
   *   ① 被注释掉的一条规则不该算"写了"（那正是坑 76 那一族：机制在，但从不生效）；
   *   ② 反过来，注释里为了讲历史而写出的字面串（比如"原先这里是 #0a0805"）
   *     不该被"不许再出现硬编码"那条判据当成违规——本项目已经因为注释里的字面串红过一次。
   *   剥注释这件事本身就是踩出来的：留着历史说明的注释是资产，不该被断言惩罚。 */
  const cssCode = cssScreenSrc.replace(/\/\*[\s\S]*?\*\//g, '');
  /* ★★ 2026-10-09 L7：把"浮层必须有高度上界"从一次修复升级成**全仓红线**。
   *   ▎起因是一条只有全量回归才会露出来的真缺陷：邀请面板高度是内容撑的，
   *     跨网自检从 5 条长到 7 条 ⇒ 733px 涨到 762px，矮窗口里最后一行连同
   *     "可复制的修复命令"掉到屏幕外面，而浮层没有滚动条（零报错、用户不知道自己丢了东西）。
   *   ▸ 判据的形状（每条都对应一类误报，所以都必要）：
   *     · 只看 **锚定式浮层**：有 `position: fixed` 且写了 `top:` 或 `bottom:`；
   *     · **豁免**三类，它们的高度天然不是问题：整屏层（有 `inset:`）、
   *       上下双锚（`top` + `bottom` ⇒ 高度由视口定）、装饰/标记层（`pointer-events: none`）、
   *       以及本来就 1px 的隐形辅助件（有显式 `height:`）；
   *     · 按**选择器聚合**再判（同一组件的基础规则与媒体查询覆盖是两处，
   *       只看单条规则会把"基础规则已有界、只在窄屏改位置"的合法写法判红）；
   *     · **覆盖面要点名**（坑 105）：至少扫到 5 个"该有上界的浮层"，
   *       否则正则一旦失配，这条红线就永远绿——那是白装。 */
  {
    const agg = {};
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    let mm;
    while ((mm = ruleRe.exec(cssCode))) {
      const sel = mm[1].trim().replace(/\s+/g, ' ');
      if (/^@/.test(sel)) continue;                 // @media 的"选择器"是条件本身，跳过（里面的规则已被单独抓到）
      agg[sel] = (agg[sel] || '') + ';' + mm[2];
    }
    const need = [], viol = [];
    for (const [sel, body] of Object.entries(agg)) {
      if (!/position:\s*fixed/.test(body)) continue;
      if (/inset:/.test(body)) continue;                                  // 整屏层
      if (/pointer-events:\s*none/.test(body)) continue;                   // 装饰/标记层，内容由动画给
      const anchored = /(^|;)\s*(top|bottom):/.test(body);
      if (!anchored) continue;
      if (/(^|;)\s*top:/.test(body) && /(^|;)\s*bottom:/.test(body)) continue;  // 上下双锚：高度由视口定
      if (/(^|;)\s*height:\s*(1px|\d+d?vh|100%)/.test(body)) continue;         // 显式高度（含 1px 隐形输入件）
      need.push(sel);
      if (!/max-height:/.test(body)) viol.push(sel);
    }
    ok('2026-10-09 L7：锚定式浮层必须有上界（max-height）——邀请面板那次是被它顶出屏幕的（结构红线）',
      viol.length === 0, viol.length ? `缺上界的浮层：${viol.join(' , ')}` : `已扫到 ${need.length} 个这类浮层`);
    ok('2026-10-09 L7 的覆盖面哨兵：确实扫到了足够多个"该有上界的浮层"（正则失配不许让红线白装）',
      need.length >= 5 && need.includes('.invite-panel') && need.includes('.remote-ask'),
      `扫到 ${need.length} 个：${need.slice(0, 8).join(' , ')}`);
  }
  ok('2026-10-05 style.css 有屏幕格 video { object-fit: contain }（类名与规则成对）',
    /\.video-box\.source-screen > video\s*\{[^}]*object-fit:\s*contain/.test(cssCode));
  /* ★ 2026-10-06 第 48 步「模糊衬底」三条结构判据。
   *   ▎最要紧的是**第二条**：主画面元素自己必须透明。video 元素的 background 会画满
   *     整个元素矩形，contain 留出来的那圈边就是它的背景色——压在衬底上面就把模糊层
   *     整个盖掉了。这个坏法不会有任何报错、也不会让任何功能变红，只会"改了个寂寞"（坑 76）。
   *     所以它必须有一条断言，而不是"我记得挪走了"。 */
  ok('2026-10-06 屏幕格主画面元素自己必须是透明的（否则它的背景会盖掉整层模糊衬底）',
    /\.video-box\.source-screen > video\s*\{[^}]*background:\s*transparent/.test(cssCode));
  ok('2026-10-06 衬底层规则齐备：cover + blur + 不吃点击 + 在主画面之下',
    /\.video-box\.source-screen > video\.tile-blur\s*\{[^}]*object-fit:\s*cover/.test(cssCode)
    && /\.video-box\.source-screen > video\.tile-blur\s*\{[^}]*filter:\s*blur\(/.test(cssCode)
    && /\.video-box\.source-screen > video\.tile-blur\s*\{[^}]*pointer-events:\s*none/.test(cssCode)
    && /\.video-box\.source-screen > video:not\(\.tile-blur\)\s*\{[^}]*z-index:\s*1/.test(cssCode));
  /* 客户端两处屏幕格挂点都要真的叫 ensureScreenBackdrop（只写函数不接线 = 永远不生效，坑 56） */
  ok('2026-10-06 远端屏幕格与本地屏幕格两处挂点都调了 ensureScreenBackdrop（含函数定义共三处）',
    (() => {
      const s = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'client.js'), 'utf8');
      return (s.match(/ensureScreenBackdrop\(/g) || []).length === 3
        && /function ensureScreenBackdrop\(box, sharp\)/.test(s);
    })(),
    `调用+定义处数=${(fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'client.js'), 'utf8').match(/ensureScreenBackdrop\(/g) || []).length}`);
  /* 画中画那两处按位置取 video 的写法必须排掉衬底。
   *   ▎这条断言的来历：衬底第一版是 insertBefore 到最前面的，于是 .tile-main video
   *     拿到的是糊的那块——**画中画会弹出一窗模糊画面，而且不报任何错**。
   *     改成追加之后按位置取是安全的，但"排掉衬底"这个写法保留（两道防线都比"记得"便宜）。 */
  ok('2026-10-06 画中画按位置取画面时排掉了 .tile-blur（弹出一窗糊画面是不报错的坏法）',
    (() => {
      const s = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'client.js'), 'utf8');
      return /\.tile-main video:not\(\.tile-blur\)/.test(s)
        && !/querySelector\('\.tile-main video'\)/.test(s)
        && !/querySelector\('\.video-box video'\)/.test(s);
    })());
  /* ★ 2026-10-06 问题⑥续的两条结构判据（"多大"与"什么颜色"）：
   *   ▎为什么钉在源码上而不是只靠真浏览器：真浏览器那条（check:screenshare）要起服务、
   *     要浏览器，日常改一行 CSS 不会有人去跑；冒烟这条便宜到每次都会跑，
   *     足以拦住"把 var 又换回硬编码十六进制"这种最常见的回退。 */
  ok('2026-10-06 画面格的两档黑来自 token（规则里不再出现硬编码 #0a0805，底色挪到了格子上）',
    /--tile-bg:\s*#171209/.test(cssCode) && /--tile-blank:\s*#100d08/.test(cssCode)
    && /\.video-box\.source-screen \{\s*background:\s*var\(--tile-blank\)/.test(cssCode)
    && !/#0a0805/.test(cssCode));
  ok('2026-10-06 共享格占宽消费的是 JS 量出来的 --screen-span，且**横竖同倍数**（只放大一轴会把行拉歪——截图抓到的）',
    /grid-column:\s*span var\(--screen-span, 1\);\s*\n\s*grid-row:\s*span var\(--screen-span, 1\);/.test(cssScreenSrc)
    && /setProperty\('--screen-span'/.test(fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'client.js'), 'utf8')));
  ok('2026-10-06 applyScreenSpan 在布局刷新与网格尺寸变化两处都被调（列数随舞台宽度变，两个时机都得重量）',
    (() => {
      const c = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'client.js'), 'utf8');
      return /fitMainTile\(\);\s*\n\s*applyScreenSpan\(\);/.test(c)
        && /new ResizeObserver\(\(\) => \{ fitMainTile\(\); applyScreenSpan\(\); \}\)/.test(c);
    })());
  /* ★ 2026-10-06 一条**结构红线**：按钮文字不是状态机。
   *   ▎真事故：`newTrack.enabled = muteBtn.textContent === '静音'`（换麦克风后保持静音状态）
   *     与摄像头那处同写法。第 43 步给按钮加了"两层同样的字"之后，textContent 变成
   *     「静音静音」/「关摄像头关摄像头」，相等判断**永远 false** ⇒ 用户换过一次设备，
   *     麦克风/摄像头就自己关了，而日志写着"已切换（成功）"。
   *     这就是"加入会议后识别失败 / 用一会儿就不行"的一条独立成因。
   *   ▸ 为什么钉成结构断言而不是只修这两处：按钮文字是给人看的，它会随图标/动效改版；
   *     下一次再有人拿 `xxxBtn.textContent === '...'` 当状态判据，这条会当场红。
   *     （注释里保留着旧写法作教训，所以只扫非注释行。） */
  ok('2026-10-06 全文件没有任何"按钮文字 === 某状态"的判据（状态一律来自轨道/变量，坑 77 家族）',
    (() => {
      const c = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'client.js'), 'utf8');
      const bad = c.split('\n')
        .map((l, i) => ({ l, n: i + 1 }))
        .filter(({ l }) => !/^\s*(\*|\/\/)/.test(l))
        .filter(({ l }) => /(Btn|button)\w*\.textContent\s*===/.test(l));
      if (bad.length) console.log('   违规行：' + bad.map((b) => `${b.n}: ${b.l.trim()}`).join(' | '));
      return bad.length === 0;
    })());
  /* ★ 第 37 节"光标聚光"的接线判据（真浏览器那半在 check:visual，这里守的是别悄悄退化）：
   *   ▎最可能的退化方式不是写错，是**有人在 pointermove 里直接量 rect**——
   *     那是白板当年的强制同步布局事故（坑 59），一次划过网格就是几百次 reflow。
   *     行为断言测不出"慢"，所以这条结构断言专门钉它：move 处理体内不许出现 getBoundingClientRect。 */
  ok('2026-10-06 聚光效果：CSS 有环状遮罩规则 + JS 写 --mx/--my，且 move 处理里不量 rect（坑 59 防线）',
    (() => {
      const c = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'client.js'), 'utf8');
      const fn = /function initTileSpotlight\(\) \{([\s\S]{0,2200}?)\n\}/.exec(c);
      if (!fn) return false;
      const body = fn[1];
      // rect 只允许出现在"进入这一块"的分支里（缓存），move 的主路径直接读缓存
      return /setProperty\('--mx'/.test(body) && /setProperty\('--my'/.test(body)
        && /requestAnimationFrame\(flush\)/.test(body)
        && body.split('getBoundingClientRect()').length === 2 // 恰好一处（缓存点）
        && /try \{ rect = t\.getBoundingClientRect\(\); \}/.test(body);
    })()
    && /mask-composite:\s*exclude/.test(cssScreenSrc)
    && /\.video-box:hover::before\s*\{[^}]*opacity:\s*1/.test(cssScreenSrc));
  const annotSendsBefore = rec.sctpSends.length;
  guard('F5 开批注模式', () => annotPenBtn.dispatch('pointerdown'));
  guard('F5 落笔', () => annotCanvasEl.dispatch('pointerdown', { clientX: 64, clientY: 36, button: 0 }));
  guard('F5 拖笔', () => annotCanvasEl.dispatch('pointermove', { clientX: 128, clientY: 72 }));
  guard('F5 收笔', () => annotCanvasEl.dispatch('pointerup', {}));
  const annotSent = rec.sctpSends.slice(annotSendsBefore).map((x) => { try { return JSON.parse(x); } catch (e) { return {}; } });
  ok('F5 笔迹走独立 annot 频道（start/draw/end，带 to 定向头与归一化坐标）',
    annotSent.some((m) => m.type === 'annot' && m.op === 'start' && m.to === PEER && m.x <= 1) &&
    annotSent.some((m) => m.type === 'annot' && m.op === 'draw') &&
    annotSent.some((m) => m.type === 'annot' && m.op === 'end'));

  // 收别人的笔迹：annot 频道订阅 → 按 label 路由 → 账本重放（2D 桩计数 > 0）
  guard('F5 订阅对端标注频道', () => emit('new-data-producer', { dataProducerId: 'annot-dp-peer-1', label: 'annot', from: PEER }));
  await new Promise((r) => setTimeout(r, 80)); // 订阅是异步的：等 consumeData 微任务跑完、handler 换成 annot 路由
  guard('F5 收到笔迹 start', () => rec.dataMessageHandler(JSON.stringify({ type: 'annot', to: PEER, op: 'start', x: 0.2, y: 0.2, color: '#ff8f8f' })));
  const opsBefore = rec.canvasOps;
  guard('F5 收到笔迹 draw', () => rec.dataMessageHandler(JSON.stringify({ type: 'annot', to: PEER, op: 'draw', x: 0.5, y: 0.6 })));
  ok('F5 对端笔迹重放到画布（2D 桩 lineTo 计数增加）', rec.canvasOps > opsBefore);

  /* ---- ③e ★ 09-15 F7：独立协作白板（第三条 'board' 频道）---- */
  guard('F7 打开白板', () => documentStub.getElementById('boardBtn').dispatch('click'));
  const boardCanvasEl = documentStub.getElementById('boardCanvas'); // HTML 里的元素走 elementCache
  ok('F7 白板覆盖层打开（boardBtn.active + overlay 显示）',
    !!(elementCache.get('boardOverlay') || documentStub.getElementById('boardOverlay')));
  const boardSendsBefore = rec.sctpSends.length;
  guard('F7 白板落笔', () => boardCanvasEl.dispatch('pointerdown', { clientX: 60, clientY: 30, button: 0 }));
  guard('F7 白板拖笔', () => boardCanvasEl.dispatch('pointermove', { clientX: 120, clientY: 60 }));
  guard('F7 白板收笔', () => boardCanvasEl.dispatch('pointerup', {}));
  const boardSent = rec.sctpSends.slice(boardSendsBefore).map((x) => { try { return JSON.parse(x); } catch (e) { return {}; } });
  ok('F7 笔迹走独立 board 频道（start/draw/end，归一化坐标 + color）',
    boardSent.some((m) => m.type === 'board' && m.op === 'start' && m.x <= 1 && m.color) &&
    boardSent.some((m) => m.type === 'board' && m.op === 'draw') &&
    boardSent.some((m) => m.type === 'board' && m.op === 'end'));
  guard('F7 订阅对端白板频道', () => emit('new-data-producer', { dataProducerId: 'board-dp-peer', label: 'board', from: PEER }));
  await new Promise((r) => setTimeout(r, 80)); // 等订阅微任务把 handler 换成 board 路由
  const boardOpsBefore = rec.canvasOps;
  guard('F7 收对端 start', () => rec.dataMessageHandler(JSON.stringify({ type: 'board', op: 'start', x: 0.1, y: 0.1, color: '#2471a3' })));
  guard('F7 收对端 draw', () => rec.dataMessageHandler(JSON.stringify({ type: 'board', op: 'draw', x: 0.4, y: 0.4 })));
  ok('F7 对端笔迹重放到白板（2D 桩计数增加）', rec.canvasOps > boardOpsBefore);
  const clearOpsBefore = rec.canvasOps;
  guard('F7 清空白板', () => rec.dataMessageHandler(JSON.stringify({ type: 'board', op: 'clear', color: '#2471a3' })));
  ok('F7 clear 处理不抛错（账本清空 + 重绘）', rec.canvasOps >= clearOpsBefore);

  /* ---- ★ 2026-10-10 SCTP 频道还在 connecting 时：不许炸、更不许把兜底一起吞掉 ----
   * ▎这是一条**真产品缺陷**的回归，不是补覆盖率：全量 check:all 里 check:board 报
   *   "页面脚本异常：Uncaught"、check:console 同一趟抓出
   *   `RTCDataChannel.readyState is not 'open'` —— 两把尺指向同一处：
   *   客户端五处 `.send(` 的守卫都写成 `!dp || dp.closed`，而 mediasoup-client 的
   *   DataProducer.send() 只在**自己 close 过**时拦，否则把调用转给底层
   *   RTCDataChannel —— 频道处于 connecting（刚 produce、SCTP 关联还没建完）时
   *   `closed` 是 false，守卫放行，浏览器同步抛。
   * ▎比抛错更糟的一半在顺序：`board-signal` 那条信令兜底写在 `.send()` **之后**，
   *   于是这一路既抛了异常、兜底又一条没发出去——而 10-04f 加兜底的理由
   *   恰恰是"晚到的人永久错过笔迹"（坑 76：机制在 ≠ 机制在该起作用时跑得起来）。
   * ▸ 三条各配一个变异，都能红（见本轮 A/B 记录）：
   *   ① 把 dcOpen 的 readyState 判据摘掉 → 红在"落笔不抛错"；
   *   ② 把 board-signal 挪回 send 之后并在前面加 `if (viaSctp)` → 红在"兜底真的跑了"；
   *   ③ 让 sendOnDc 吃掉异常但返回 true → 红在"批注那条要说实话"。 */
  {
    const bdp = rec.dataProducers.find((p) => p.label === 'board');
    const adp = rec.dataProducers.find((p) => p.label === 'annot');
    const cdpChat = rec.dataProducers.find((p) => p.label === 'chat');
    ok('2026-10-10 三条 SCTP 频道都建出来了（拿不到这三根句柄，下面几条就是在测空气）',
      !!bdp && !!adp && !!cdpChat,
      `board=${!!bdp} annot=${!!adp} chat=${!!cdpChat}`);
    /* 一次"落笔/点按钮"跑完之后拿到的异常信息（null = 没抛）。
     *   ▸ 为什么这里不用文件开头那个 guard()：它把异常收进 problems、返回 undefined，
     *     而这几条断言要**就地**说清"是哪一步抛的、抛了什么"——
     *     guard 的账要等到文件末尾才结算，那时候再报就查不出是哪一条了。 */
    const runAndCatch = (fn) => { try { fn(); return null; } catch (e) { return String((e && e.message) || e); } };
    const toastText = () => String(documentStub.getElementById('toast').textContent || '');
    if (bdp && adp && cdpChat) {
      /* ★ 先钉"桩自己会抛"这条前提（M1 变异教出来的，不写就等于留一个假绿面）：
       *   客户端 dcOpen 里的 try/catch **单独也能**挡住抛错，所以"落笔不抛"这一条
       *   并不能证明 readyState 判据有效——判据真正的价值是"发不出去要被**判出来**"
       *   （于是兜底那条才跑得起来、界面才说得出话）。前提不成立时，
       *   后面几条"没走主路"都只是巧合。这条断言量的就是桩有没有冒充浏览器。 */
      let stubThrows = false;
      try { bdp.readyState = 'connecting'; bdp.send('probe'); } catch (e) { stubThrows = true; }
      bdp.readyState = 'open';
      ok('2026-10-10 桩在 connecting 时**照浏览器那样抛**（不抛就是桩在冒充被测对象，后面几条全都作废）',
        stubThrows);

      /* ① 白板：connecting 落笔 */
      const sendsBefore = rec.sctpSends.length;
      const sigBefore = rec.boardSignals.length;
      bdp.readyState = 'connecting';
      const bc = documentStub.getElementById('boardCanvas');
      const err1 = runAndCatch(() => {
        bc.dispatch('pointerdown', { clientX: 70, clientY: 40, button: 0 });
        bc.dispatch('pointermove', { clientX: 130, clientY: 80 });
        bc.dispatch('pointerup', {});
      });
      bdp.readyState = 'open';
      ok('2026-10-10 SCTP connecting：白板落笔不抛未捕获异常（旧写法在这里同步抛 DOMException）',
        err1 === null, err1 || '');
      ok('2026-10-10 SCTP connecting：白板笔迹没走主路（说明"没发出去"是被判出来的，不是碰巧没跑到）',
        rec.sctpSends.length === sendsBefore, `多发了 ${rec.sctpSends.length - sendsBefore} 条`);
      ok('2026-10-10 SCTP connecting：信令兜底真的跑了（这一条就是"晚到的人能不能看见这笔"）',
        rec.boardSignals.length > sigBefore, `兜底新增 ${rec.boardSignals.length - sigBefore} 条`);
      const lastSig = rec.boardSignals[rec.boardSignals.length - 1] || {};
      ok('2026-10-10 兜底带的是同一条笔迹（type/op/msgId 齐全，收件端去重才有依据）',
        lastSig.type === 'board' && !!lastSig.msgId && ['start', 'draw', 'end'].includes(lastSig.op),
        JSON.stringify({ type: lastSig.type, op: lastSig.op, 有msgId: !!lastSig.msgId }));

      /* ② 批注：只有 SCTP 一条路 ⇒ 发不出去必须**说出来**，不能静默（静默会让人以为自己画错了）。
       *   动线与上面 F5 那组一致（开笔模式 → 落笔 → 收笔），复用同一批句柄；
       *   区别只有"频道此刻是 connecting"——这正是真机上"刚开共享就画第一笔"的那几百毫秒。 */
      adp.readyState = 'connecting';
      const sigBefore2 = rec.sctpSends.length;
      const err2 = annotCanvasEl
        ? runAndCatch(() => {
          if (annotPenBtn) annotPenBtn.dispatch('pointerdown', {});
          annotCanvasEl.dispatch('pointerdown', { clientX: 20, clientY: 20, button: 0 });
          annotCanvasEl.dispatch('pointermove', { clientX: 40, clientY: 44 });
          annotCanvasEl.dispatch('pointerup', {});
        })
        : '没有批注画布（这条没跑到）';
      ok('2026-10-10 SCTP connecting：批注落笔不抛未捕获异常', err2 === null, err2 || '');
      ok('2026-10-10 SCTP connecting：批注这条路没硬塞给主路（发了几条 = ' + (rec.sctpSends.length - sigBefore2) + '）',
        rec.sctpSends.length === sigBefore2);
      adp.readyState = 'open';

      /* ③ 表情回应：主路失败不许留下"本地飞屏"冒充成功 —— 界面不许撒谎 */
      const flyBefore = createdEls.filter((e) => e.classList && e.classList.contains('react-fly')).length;
      cdpChat.readyState = 'connecting';
      const rBtn = createdEls.find((e) => e.className === 'react-btn' && e.dataset.emoji === '🎉');
      const err3 = rBtn ? runAndCatch(() => rBtn.dispatch('click', {})) : '没有表情按钮';
      const flyAfter = createdEls.filter((e) => e.classList && e.classList.contains('react-fly')).length;
      ok('2026-10-10 SCTP connecting：点表情回应不抛异常', err3 === null, err3 || '');
      ok('2026-10-10 回应没发出去时不留下飞屏冒充成功（"已回应"要等真发出去才算）',
        flyAfter === flyBefore, `飞屏 ${flyBefore} → ${flyAfter}`);
      ok('2026-10-10 发不出去这件事说在界面上（提示条里看得见原因）',
        /未就绪|没发出去/.test(toastText()), toastText());
      cdpChat.readyState = 'open';
    }
  }

  /* ---- ★ 2026-10-10 结构红线：SCTP 发送判据只许写在一处 ----
   *   ▎为什么钉这个：本轮修的是"同一个错误守卫被抄了五遍"。下次加第六条频道的人
   *   一定会"照着旁边那段写"（这就是坑 47 说的漂移），所以把"别的地方不许直接 .send("
   *   变成机器判据，而不是靠代码评审的记性。注释里保留旧写法作教训 ⇒ 只扫非注释行。
   *   ▸ 本地读一份源码，不往后那行 `const clientSrc`（顶层调用有顺序依赖，
   *     在 TDZ 里用它 = 整段静默不跑，本项目踩过四次）。 */
  {
    const srcNow = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'client.js'), 'utf8');
    const noComment = srcNow.split('\n').filter((l) => !/^\s*\*/.test(l) && !/^\s*\/\//.test(l)).join('\n');
    const bareSends = noComment.match(/\w*DataProducer\.send\(/g) || [];
    ok('2026-10-10 客户端不许再出现裸的 `xxxDataProducer.send(`（一律走 sendOnDc）',
      bareSends.length === 0, bareSends.join(','));
    ok('2026-10-10 全文件唯一那条 `.send(` 在 sendOnDc 里面（判据真的只有一处，不是被删光了）',
      /function sendOnDc[\s\S]{0,400}?\bdp\.send\(/.test(noComment));
    /* 顺序红线：兜底那条 emit 不许再挪回主路"成功之后"——本轮的真缺陷就是这个顺序。 */
    const body = (srcNow.match(/function sendBoard\([\s\S]*?\n}/) || [''])[0];
    ok('2026-10-10 白板兜底那条 emit 不在 `if (主路成功)` 里面（发不出去也必须双发）',
      body.length > 0 && !/if\s*\(\s*viaSctp\s*\)[\s\S]{0,160}board-signal/.test(body),
      body ? '' : '没找到 sendBoard 的函数体');
  }

  /* ---- ★ 2026-10-04 白板导出 PNG（第 48 步）----
   * ▎"屏幕上的白板"与"导出的白板"必须**结构上不可能不一致**：
   *   两者都调用同一个 drawBoardStrokes（线宽、起笔圆点、归一化坐标换算只有一份实现）。
   *   分开写两份的结局一定是"导出来的和看到的不一样"——本项目为这类坑写过三次复盘。
   * ▎真浏览器那一半（PNG 文件头、像素里真有笔迹、文件名带房间号）在 npm run check:board。 */
  /* ▎本地读一份源码，不用后面才声明的 clientSrc（那是 1400 行处的 const）——
   *   在它之前引用它就是 TDZ 崩套件，这条纪律本文件已经写过一次，我又踩了一次。 */
  const dir48 = path.join(__dirname, '..', 'sfu', 'public');  // PUB 在 1251 行才声明，这里用本地路径（同一个 TDZ 教训）
  const clientSrc48 = fs.readFileSync(path.join(dir48, 'client.js'), 'utf8');
  const htmlSrc48 = fs.readFileSync(path.join(dir48, 'index.html'), 'utf8');
  ok('48 笔迹"怎么画"只有一个实现（重绘与导出共用 drawBoardStrokes）',
    /function drawBoardStrokes\(ctx, w, h\)/.test(clientSrc48) &&
    (clientSrc48.match(/drawBoardStrokes\(/g) || []).length === 3 &&   // 1 定义 + redrawBoard + exportBoardPng
    !/ctx\.arc\(s\.pts\[0\]\.x \* w/.test(clientSrc48.replace(/function drawBoardStrokes[\s\S]*?\n\}/, '')));
  ok('48 导出按钮在 HTML 里且已接线（用 click 而非 pointerdown：下载要真实手势）',
    htmlSrc48.includes('id="boardPngBtn"') &&
    /\$\('boardPngBtn'\)\.addEventListener\('click', exportBoardPng\)/.test(clientSrc48));
  ok('48 Blob URL 延后释放（立刻 revoke 会让部分浏览器下载失败，不释放则每次导出漏一个）',
    /setTimeout\(\(\) => URL\.revokeObjectURL\(url\)/.test(clientSrc48) &&
    !/URL\.revokeObjectURL\(url\);\s*\n\s*\}\, 'image\/png'\)/.test(clientSrc48));
  ok('48 导出文件名带房间号与时间（一张没有出处的草图第二天没人认得）',
    /whiteboard-\$\{myRoom \|\| 'room'\}-/.test(clientSrc48));

  /* ---- ③f ★ 09-14 F6：滤镜与虚拟背景（管线启动 → 上行轨替换 → CPU 账 → 色键 → 还原）----
   * 全程走真实调用链：点 chip → syncFxPipeline → 处理后轨顶替进 localStream →
   * producer.replaceTrack 上行。rec.lastReplaced / rec.camUpstreamTrack 记录两端。 */
  const fxPanelEl = documentStub.getElementById('fxPanel');
  const fxCostEl = documentStub.getElementById('fxCost');
  guard('F6 打开滤镜面板', () => documentStub.getElementById('fxBtn').dispatch('click'));
  ok('F6 控制坞入口能打开滤镜浮层（fxPanel 可见）', !fxPanelEl.classList.contains('hidden'));

  const naturalChip = documentStub.getElementById('fxPresets').children.find((b) => b.dataset.preset === 'natural');
  guard('F6 选「自然」滤镜档', () => naturalChip.dispatch('click'));
  await new Promise((r) => setTimeout(r, 40)); // syncFxPipeline 是 async：等 replaceTrack 落地
  ok('F6 管线启动：档位按钮点亮（active 状态与 fx.preset 同步）',
    naturalChip.classList.contains('active') && !documentStub.getElementById('fxPresets').children.find((b) => b.dataset.preset === 'none').classList.contains('active'));
  ok('F6 处理后轨已顶替上行（replaceTrack 收到的不是原始摄像头轨）',
    !!rec.lastReplaced && rec.lastReplaced !== rec.camUpstreamTrack);

  await new Promise((r) => setTimeout(r, 500)); // rAF 桩=每帧一个 setTimeout：冒烟环境约 9ms/帧，500ms≈50 帧，必跨过 %24 的徽标刷新点
  ok('F6 CPU 账徽标在统计每帧耗时（x.x ms/帧）', /ms\/帧/.test(fxCostEl.textContent) && !/-- ms/.test(fxCostEl.textContent));

  const chromaChk = documentStub.getElementById('fxChromaChk');
  chromaChk.checked = true;
  guard('F6 打开绿幕抠像', () => chromaChk.dispatch('change'));
  /* ★ 2026-09-23 修既有 flaky（坑 28 家族）：绿幕开启后每帧要跑 640×360 逐像素色键循环，
   *   桩帧率从 ~10ms/帧掉到 ~28ms/帧——固定等 500ms 可能只跑 ~18 帧，跨不过 %24 的
   *   徽标刷新点，断言随机器快慢时好时坏（09-19h 基线 95/95 在部分机器上复现为 94/95）。
   *   改成轮询（最多 3s）：跨过刷新点即成功，快机器零等待。 */
  let chromaShown = false;
  for (let wi = 0; wi < 60 && !chromaShown; wi++) {
    await new Promise((r) => setTimeout(r, 50));
    chromaShown = fxCostEl.textContent.includes('CPU');
  }
  ok('F6 抠像开启后管线切到 CPU 抠像模式（getImageData 路径无异常）', chromaShown);

  chromaChk.checked = false;
  guard('F6 关闭绿幕', () => chromaChk.dispatch('change'));
  const noneChip = documentStub.getElementById('fxPresets').children.find((b) => b.dataset.preset === 'none');
  guard('F6 点「原图」关滤镜', () => noneChip.dispatch('click'));
  await new Promise((r) => setTimeout(r, 40));
  ok('F6 关滤镜后上行轨还原为原始摄像头轨（replaceTrack 回原轨）', rec.lastReplaced === rec.camUpstreamTrack);

  guard('F6 关闭面板', () => documentStub.getElementById('fxCloseBtn').dispatch('click'));
  ok('F6 关闭按钮收起浮层', fxPanelEl.classList.contains('hidden'));

  /* ---- ③h ★ 09-17 实时字幕（第 29 步）：远端字幕入条 → 开关 → 本地识别成稿广播 →
   *   interim 不广播 → 自动重启 → 导出 → 关闭。全链路驱动真代码路径。 ---- */
  const capBarEl = documentStub.getElementById('captionBar');
  const capTextEl = documentStub.getElementById('captionText');
  // ⓪ F7 断言时 rec.dataMessageHandler 已被 board 频道覆盖——重订一条 chat 频道把路由刷回来
  guard('字幕：订阅对端 chat 频道（刷新消息路由）', () => emit('new-data-producer', { dataProducerId: 'cap-chat-peer', label: 'chat', from: PEER }));
  await new Promise((r) => setTimeout(r, 10)); // 订阅是 async（consume-data 应答→consumeData→on('message')），等微任务落地
  // ① 先验远端字幕接收（不依赖本地开关：别人开着字幕，我也能看到）
  guard('字幕：收到对端 caption', () => rec.dataMessageHandler(JSON.stringify({ type: 'caption', from: PEER, name: '小张', text: '我们开始吧' })));
  ok('字幕：对端成稿上字幕条（名字 + 文本）',
    !capBarEl.classList.contains('hidden') && capTextEl.innerHTML.includes('小张') && capTextEl.innerHTML.includes('我们开始吧'));

  // ② 本地开字幕 → 识别器启动 + member-state 上报 caption（房间状态机，成员列表 💬 数据源）
  /* ★ 09-28：字幕路径契约变了——装了 whisper 时默认走**服务端转写**（用户点名
   *   "不要再用浏览器的了"）。而下面这一大段验的是**浏览器兜底路径**，
   *   所以用 client 的显式覆盖口（window.__SFU_ASR__）把路径钉死为 'browser'。
   *   服务端模式本身在 ③h3b 里单独验。 */
  ctx.__SFU_ASR__ = false;
  const capBtnEl = documentStub.getElementById('capBtn');
  guard('字幕：点开开关', () => capBtnEl.dispatch('click'));
  ok('字幕：识别器已启动且按钮进入开启态', rec.capStarts === 1 && capBtnEl.innerHTML.includes('关字幕'));
  ok('字幕：开字幕上报 member-state.caption=true', !!(rec.lastMemberState && rec.lastMemberState.patch && rec.lastMemberState.patch.caption === true));

  // ③ 本地识别半句（interim）→ 只本地跳动，不广播（"可靠性按内容价值定价"）
  const myRec = rec.capInstances[rec.capInstances.length - 1];
  const sendsBeforeInterim = rec.sctpSends.length;
  guard('字幕：识别半句 interim', () => myRec.onresult({ resultIndex: 0, results: [{ 0: { transcript: '今天我们讨论' }, isFinal: false }] }));
  ok('字幕：interim 半句本地显示（半透明）且不广播',
    capTextEl.classList.contains('interim') && rec.sctpSends.length === sendsBeforeInterim);

  // ④ 识别成稿（final）→ 经 SCTP 广播（骑 chat 频道，不做信令兜底）
  guard('字幕：识别成稿 final', () => myRec.onresult({ resultIndex: 0, results: [{ 0: { transcript: '今天我们讨论字幕功能' }, isFinal: true }] }));
  const capSend = rec.sctpSends.map((x) => { try { return JSON.parse(x); } catch (e) { return null; } }).find((m) => m && m.type === 'caption');
  ok('字幕：成稿经 SCTP 广播（chat 频道，type=caption 带文本）', !!capSend && capSend.text === '今天我们讨论字幕功能');

  // ⑤ 识别器自动断（Chrome 每 ~60s 断一次）→ 开关开着就自动拉起（300ms 防抖）
  const startsBeforeRestart = rec.capStarts;
  guard('字幕：模拟识别器自动断开', () => myRec.onend());
  await new Promise((r) => setTimeout(r, 420));
  ok('字幕：onend 后自动重启识别器（continuous 拉起）', rec.capStarts === startsBeforeRestart + 1);

  // ⑥ 导出字幕记录（账本非空，Blob 下载路径不抛错）
  guard('字幕：导出记录', () => documentStub.getElementById('capExportBtn').dispatch('click'));
  ok('字幕：导出路径无异常（Blob 下载）', true);

  // ⑥b ★ 09-17b 字幕历史抽屉：开（渲染账本尾部）→ 新字幕追加滚底 → 关
  const capHistPanelEl = documentStub.getElementById('capHistoryPanel');
  const capHistListEl = documentStub.getElementById('capHistoryList');
  guard('字幕：打开历史抽屉', () => documentStub.getElementById('capHistoryBtn').dispatch('click'));
  const rowsBefore = capHistListEl.children.length;
  // ★ 09-19 Otter 节奏：连续同说话人合并成段——此刻小张 1 段 + 我 1 段 = 2 段
  ok('字幕：抽屉打开并渲染账本（Otter 段结构：小张 + 我 = 2 段）',
    !capHistPanelEl.classList.contains('hidden') && rowsBefore === 2);
  guard('字幕：抽屉开着时再来一条对端字幕', () => rec.dataMessageHandler(JSON.stringify({ type: 'caption', from: PEER, name: '小张', text: '追加的一句' })));
  // 中间隔了"我"的发言——Otter 节奏下小张新句应开新段（连续同人才合并），全 3 段
  ok('字幕：隔段发言开新段（3 段）且最新段带 now 高亮',
    capHistListEl.children.length === rowsBefore + 1 &&
    capHistListEl.children[2].dataset.speaker === '小张' &&
    capHistListEl.children[2].children[1].children.length === 1 &&
    capHistListEl.children[2].children[1].children[0].classList.contains('now'));
  guard('字幕：收起抽屉', () => documentStub.getElementById('capHistoryCloseBtn').dispatch('click'));
  ok('字幕：抽屉已收起', capHistPanelEl.classList.contains('hidden'));

  // ⑦ 再点开关 → 停识别器（stop 触发 onend，但开关已关不再拉起）+ member-state 复位
  guard('字幕：点关开关', () => capBtnEl.dispatch('click'));
  ok('字幕：识别器已停且不再自动重启', rec.capStops >= 1 && capBtnEl.innerHTML.includes('字幕') && !capBtnEl.innerHTML.includes('关字幕'));
  ok('字幕：关字幕上报 member-state.caption=false', !!(rec.lastMemberState && rec.lastMemberState.patch && rec.lastMemberState.patch.caption === false));

  /* ---- ③h2 ★ 09-17c 字幕可用性修复：
   *   用户反馈"字幕不好用、是不是被浏览器拦了"——这里把三条新能力都验一遍：
   *     ① 不安全上下文（http + IP）必须**拦在点击那一刻**并弹出带"怎么修"的自检卡；
   *     ② 手动字幕兜底：打字也能进账本 + 上字幕条（ASR 不可用时会议记录不中断）；
   *     ③ 状态徽标：随时点开自检报告。 ---- */
  const capStatusEl = documentStub.getElementById('capStatus');
  const capDiagEl = documentStub.getElementById('capDiagBox');
  const diagListEl = documentStub.getElementById('capDiagList');
  capDiagEl.classList.add('hidden'); // 桩不继承 HTML 初始类（坑 27），手动补
  // ① 手动字幕：输入 + 发送 → 上条 + 进账本（账本条数用历史抽屉渲染行数间接验证）
  const capManualEl = documentStub.getElementById('capManualInput');
  capManualEl.value = '这是手动兜底的一条字幕';
  guard('字幕：手动发送', () => documentStub.getElementById('capManualSend').dispatch('click'));
  ok('字幕：手动字幕上条（名字 + 文本）且输入框清空',
    capTextEl.innerHTML.includes('这是手动兜底的一条字幕') && capManualEl.value === '');
  // ② 不安全上下文 → 开字幕被拦（不启动识别器），并弹自检卡（每条带"怎么修"）
  const ctxWin = ctx; // 冒烟桩的 window（= vm 上下文本身）
  const secureBak = ctxWin.isSecureContext;
  ctxWin.isSecureContext = false; // 模拟"用 http://192.168.x.x 打开"
  const startsBeforeUnsafe = rec.capStarts;
  guard('字幕：不安全上下文下点开关', () => capBtnEl.dispatch('click'));
  ok('字幕：不安全上下文被拦（识别器未启动）', rec.capStarts === startsBeforeUnsafe);
  // 注意：假 DOM 的 textContent 不会聚合子节点文本（坑 27 同源），所以查子元素
  const diagText = () => diagListEl.children.map((c) => c.textContent || '').join(' | ');
  ok('字幕：弹出三段自检卡且写明安全上下文不过关',
    !capDiagEl.classList.contains('hidden') && diagText().includes('安全上下文'));
  ctxWin.isSecureContext = secureBak; // 还原：后面的用例还要正常开合
  guard('字幕：点状态徽标看自检', () => capStatusEl.dispatch('click'));
  ok('字幕：状态徽标可开关自检卡', diagText().includes('怎么修'));

  /* ---- ③h3 ★ 09-17e 过夜值守（C3-N1，第 30 步）：
   *   ① 账本溢出归档：内存环形只留 500 条，溢出旧段 POST /api/captions 服务器落盘（不丢账）；
   *   ② 值守统计：字幕历史抽屉头部一行读数（时长/条数/重启/已归档）；
   *   ③ network 退避：连续失败不再"3 次永久停"，改指数退避（约 45 分钟才放弃）；
   *   ④ 导出合并：先拉服务器全档（GET /api/captions?format=txt）再拼内存段。
   *   （"挂一夜不丢账"的真 7 小时验证归 0.2 节人工清单；这里验逻辑链路全通。） ---- */
  const capSentryEl = documentStub.getElementById('capSentryStats');
  guard('值守：重新开字幕（③h2 拦截用例把字幕关着）', () => capBtnEl.dispatch('click'));
  ok('值守：识别器再次启动（开字幕即值守计时开始）', rec.capStarts >= 3 && capBtnEl.innerHTML.includes('关字幕'));
  // ① 灌 501 条对端字幕：内存环形(500)装不下，溢出的旧段应触发一次归档 POST
  guard('值守：灌 501 条对端字幕（触发溢出）', () => {
    for (let i = 0; i < 501; i++) {
      rec.dataMessageHandler(JSON.stringify({ type: 'caption', from: PEER, name: '小张', text: `长跑第 ${i} 句` }));
    }
  });
  await new Promise((r) => setTimeout(r, 60)); // 归档上传是 async（fetch 桩），等微任务落地
  const capPosts = rec.fetchCalls.filter((c) => c.method === 'POST' && c.url.includes('/api/captions'));
  const capPostTotal = capPosts.reduce((n, c) => {
    try { return n + JSON.parse(c.body).entries.length; } catch (e) { return n; }
  }, 0);
  /* ★ 09-25 断言改写（原为 `capPostTotal === 5`）。为什么改：
   *   那条断言写的是**旧实现的一个细节**——"内存环形装不下时，把溢出的旧段上传"，
   *   所以灌 505 条只发 5 条（505 - 500）。但本轮为了让服务端 AI 能实时参与会议，
   *   把"保留历史"和"上传队列"拆开了（见 client.js capPushLog 的长注释），
   *   上传改为按队列阈值成批发送 → 同样灌 505 条，会发 500 条、队列里还剩 5 条。
   *   两条路**最终送达的总量完全一样**，只是拿货的那一端变了。
   *   所以真正该守的不变量不是"发几条"，而是：
   *     ① **一条不少**：已上传 + 仍在队列 === 全部入账；
   *     ② **一条不重**：两条上传路径（队列溢出 / 定时兜底）不得重复投递同一条。
   *   这两条比原来的 `=== 5` 更强——原来那条既挡不住重复，也挡不住丢账。 */
  const capPending = vm.runInContext('cap.sentry.queue.length', ctx);
  const capIngested = vm.runInContext('cap.sentry.total', ctx);
  ok('值守：账本溢出触发归档 POST /api/captions（已分批上传）', capPosts.length >= 1);
  ok('值守：归档"一条不少"（已上传 + 仍在队列 = 全部入账）',
    capPostTotal + capPending === capIngested, `已传 ${capPostTotal} + 待传 ${capPending} ≠ 入账 ${capIngested}`);
  const capTexts = capPosts.flatMap((c) => {
    try { return JSON.parse(c.body).entries.map((e) => e.text); } catch (e) { return []; }
  });
  ok('值守：归档"一条不重"（两条上传路径不重复投递）',
    new Set(capTexts).size === capTexts.length, `${capTexts.length} 条里有 ${capTexts.length - new Set(capTexts).size} 条重复`);
  const capPostBody = (() => { try { return JSON.parse(capPosts[0].body); } catch (e) { return null; } })();
  ok('值守：归档载荷带房间号（room=123456）',
    !!capPostBody && capPostBody.room === '123456');
  // ② 值守统计：开抽屉 → 头部一行读数（时长/条数/重启/已归档）
  guard('值守：打开字幕历史抽屉', () => documentStub.getElementById('capHistoryBtn').dispatch('click'));
  ok('值守：抽屉头部出现值守统计读数（🌙 值守 + 已归档计数）',
    !capHistPanelEl.classList.contains('hidden') && capSentryEl.textContent.includes('🌙 值守') &&
    capSentryEl.textContent.includes('已归档 5'));
  guard('值守：收起抽屉', () => documentStub.getElementById('capHistoryCloseBtn').dispatch('click'));
  // ③ ★ 09-27d 降级：fetch 桩返回 asrEnabled:true——network **第 1 次失败立即降级**
  //   （浏览器云端不可达是稳定状态，退避 45 分钟毫无意义；此为用户实测反馈的重构）。
  const liveRec = rec.capInstances[rec.capInstances.length - 1];
  guard('值守：模拟 network 失败 1 次', () => liveRec.onerror({ error: 'network' }));
  ok('值守：network 失败 1 次即自动降级（字幕自动关闭+徽标切服务器转写模式）',
    capBtnEl.innerHTML.includes('字幕') && !capBtnEl.innerHTML.includes('关字幕') &&
    capStatusEl.innerHTML.includes('服务器转写模式'));
  // 降级后重新开字幕 → 再失败 → 仍稳定降级（不反复报错）
  guard('降级：重新开字幕', () => capBtnEl.dispatch('click'));
  guard('降级：再次 network 失败', () => { const r2 = rec.capInstances[rec.capInstances.length - 1]; r2 && r2.onerror && r2.onerror({ error: 'network' }); });
  ok('降级：重复失败仍稳定降级（不反复弹错）',
    capStatusEl.innerHTML.includes('服务器转写模式'));

  /* ---- ③h3b ★ 09-28 服务端转写模式（首选路径，"不要再用浏览器的了"）：
   *   ① whisper 可用时点字幕 → **绝不再启动浏览器识别器**（看门狗也不许偷偷拉起）；
   *   ② AI 不在场时自动邀请（服务端转写挂在 AI 的音频管线上，"AI 参会"就是它的耳朵）；
   *   ③ asr-caption 进来 → 上字幕条 + 进本地历史，但**不回传服务器**（服务器已落盘，防重复）。 ---- */
  ctx.__SFU_ASR__ = true;
  // 把 AI 请出房间：用来验证"开字幕会自动邀请 AI"
  emit('room-state', { roomNumber: '123456', members: [{ id: socketStub.id, owner: true }], hostId: null, controllerId: null, expiresAt: null });
  const startsBeforeServer = rec.capStarts;
  const aiJoinsBefore = rec.emits.filter((e) => e === 'ai-join').length;
  guard('服务端字幕：点开开关（whisper 可用）', () => capBtnEl.dispatch('click'));
  ok('服务端字幕：不启动浏览器识别器（capStarts 不变）', rec.capStarts === startsBeforeServer);
  ok('服务端字幕：按钮与徽标进入服务端模式',
    capBtnEl.innerHTML.includes('服务端字幕') && capStatusEl.innerHTML.includes('服务器转写'));
  ok('服务端字幕：自动邀请 AI 入会（它是服务端转写的耳朵）',
    rec.emits.filter((e) => e === 'ai-join').length === aiJoinsBefore + 1);
  // asr-caption → 上字幕条 + 进历史 + 不回传 SCTP
  const sctpBeforeAsr = rec.sctpSends.length;
  const capLogBefore = vm.runInContext('cap.log.length', ctx);
  guard('服务端字幕：收到 asr-caption', () => emit('asr-caption', { name: '小张', text: '服务器转写的一句话' }));
  ok('服务端字幕：上字幕条（说话人 + 文本）',
    !capBarEl.classList.contains('hidden') && capTextEl.innerHTML.includes('小张') && capTextEl.innerHTML.includes('服务器转写的一句话'));
  // 账本是 500 条环形（前面灌过 501 条），所以断言"最新一条是它"，不能断长度 +1
  ok('服务端字幕：进本地历史账本（最新一条，带 asr 标记）',
    vm.runInContext('cap.log[cap.log.length - 1].text', ctx) === '服务器转写的一句话' &&
    vm.runInContext('cap.log[cap.log.length - 1].asr', ctx) === true);
  ok('服务端字幕：不回传 SCTP（服务器已落盘，避免重复入库）', rec.sctpSends.length === sctpBeforeAsr);

  /* ---- ★ 2026-10-03b 半句/定稿样式跟随真实标志 ----
   * ▎原来 showCaptionBar 的第三参写死 true——**定稿也永远带着半句(interim)样式**，
   *   "这句话定稿没有"在界面上永远说不清（真浏览器 e2e 抓到：⏱ 读数出现了，
   *   interim 类却从不摘掉）。 */
  ok('字幕样式：定稿（无 interim 标志）不带半句类', !capTextEl.classList.contains('interim'));
  guard('字幕样式：半句带 interim 标志', () => emit('asr-caption', { name: '小张', text: '正在说的半句', interim: true }));
  ok('字幕样式：interim=true 时半句类真的挂上', capTextEl.classList.contains('interim'));
  guard('字幕样式：再收一条定稿', () => emit('asr-caption', { name: '小张', text: '定稿的一句' }));
  ok('字幕样式：定稿后 interim 类摘掉（界面上"定稿"看得见）', !capTextEl.classList.contains('interim'));

  /* ---- ★ 2026-10-03 第 37 步：字幕延迟读数（"说完→上字幕"实测显示） ----
   * ▎断言重点不是"数字对不对"（那是服务器的事），而是**客户端绝不编数**：
   *   没有 latMs、脏 latMs、半句 interim 三种情况下读数必须保持不动。
   *   一个会自己瞎填的读数比没有读数更糟——它会让人据此判断"延迟还可以"。 */
  const capLatEl = documentStub.getElementById('capLat');
  const capLatNum = documentStub.getElementById('capLatNum');
  ok('延迟读数：服务器没带 latMs 时不编数（读数子节点从未被写过）', capLatNum.textContent === '');
  guard('延迟读数：定稿带 2400ms', () => emit('asr-caption', { name: '小张', text: '第二句', latMs: 2400 }));
  ok('延迟读数：定稿带 latMs → 显示 2.4s 且上三色（≤3s 为 ok）',
    capLatNum.textContent === '2.4s' && /\bcap-lat ok\b/.test(capLatEl.className));
  guard('延迟读数：半句 interim 也带 latMs', () => emit('asr-caption', { name: '小张', text: '半句', interim: true, latMs: 500 }));
  ok('延迟读数：半句(interim)不刷新——只有定稿才是"说完"', capLatNum.textContent === '2.4s');
  guard('延迟读数：偏慢 4500ms', () => emit('asr-caption', { name: '小张', text: '第三句', latMs: 4500 }));
  ok('延迟读数：3~6s 判 warn（偏慢要看得见）', /\bcap-lat warn\b/.test(capLatEl.className));
  guard('延迟读数：很差 9000ms', () => emit('asr-caption', { name: '小张', text: '第四句', latMs: 9000 }));
  ok('延迟读数：>6s 判 bad（胭脂红，与项目三色惯例一致）', /\bcap-lat bad\b/.test(capLatEl.className));
  const capLatBeforeDirty = capLatNum.textContent;
  guard('延迟读数：脏值 0 / 非数字 / 超 120s', () => {
    emit('asr-caption', { name: '小张', text: '第五句', latMs: 0 });
    emit('asr-caption', { name: '小张', text: '第六句', latMs: 'abc' });
    emit('asr-caption', { name: '小张', text: '第七句', latMs: 999999 });
  });
  ok('延迟读数：三种脏值一律不刷新（服务器判为不可靠就不显示，别拿假数字糊弄人）',
    capLatNum.textContent === capLatBeforeDirty);
  /* ★ 2026-10-05 夜 第四种脏值：**小到不可能**。真机实锤（房间 283648）字幕条显示
   *   「⏱ 0.0s」，而同一句的真实等待是 ~10 秒——那是"人还在说就被保险丝强制收口"
   *   量出来的十几毫秒。物理上"说完→分段边界→静音判定→转写"不可能低于一个 RMS 窗的量级，
   *   所以 <200ms 必然是量错了，宁可不显示。（服务器侧同步收紧：只有 silence 定稿才产读数。） */
  guard('延迟读数：十几毫秒（物理上不可能的快）', () => emit('asr-caption', {
    name: '小张', text: '第七句之二', latMs: 15,
  }));
  ok('延迟读数：小于 200ms 也判不可靠，不刷新、不显示"0.0s"这种撒谎的读数',
    capLatNum.textContent === capLatBeforeDirty, `读数=${capLatNum.textContent}`);

  ok('延迟读数：悬浮提示给出均值与最慢值（本地窗口只用于显示，权威统计在 /metrics）',
    capLatEl.title.includes('均值') && capLatEl.title.includes('最慢'));
  /* ★ 拆分读数：只有总数就没法指导优化——"4s"到底是模型慢还是在等静音，处方完全相反。 */
  guard('延迟拆分：带 stage 的定稿', () => emit('asr-caption', {
    name: '小张', text: '第八句', latMs: 4200, stage: { wait: 1500, trans: 2700 },
  }));
  ok('延迟拆分：悬浮提示摊开"等待 + 转写"两段（慢在哪一段要能一眼看出）',
    capLatEl.title.includes('等待(静音判定+封口+调度) 1.5s') && capLatEl.title.includes('转写 2.7s'));
  guard('延迟拆分：老服务器不带 stage', () => emit('asr-caption', { name: '小张', text: '第九句', latMs: 2000 }));
  ok('延迟拆分：没有 stage 时不编拆分（只显示总数，功能不降级也不虚报）',
    capLatNum.textContent === '2.0s' && !capLatEl.title.includes('拆分：'));
  /* ★ 2026-10-10（D1）六格拆分到界面：服务器已经算出六块时，提示必须**逐块报出来**，
   *   否则这次拆分只有复盘工具读得到，用户侧仍然是"4s 但不知道慢在哪"（守则 11：改好了还要被看到）。 */
  guard('延迟拆分：v2 服务器带六块', () => emit('asr-caption', {
    name: '小张', text: '第十句', latMs: 4261,
    stage: { v: 2, wait: 17, trans: 3162, silence: 1200, tail: 300, queue: 3, refine: 686, gate: 395 },
  }));
  ok('延迟拆分：六块齐时逐块摊开（等静音判定/等封口/调度/转写/整句重转/等成句闸）',
    ['等静音判定 1.2s', '等封口 0.3s', '调度 0.0s', '转写 3.2s', '整句重转 0.7s', '等成句闸 0.4s']
      .every((s) => capLatEl.title.includes(s)), capLatEl.title.replace(/\n/g, ' | ').slice(0, 220));
  ok('延迟拆分：三块子等待齐了就不再显示整块 wait（同一段等待不许在提示里数两遍）',
    !capLatEl.title.includes('等待(静音判定+封口+调度)'));
  /* 「0 计入、缺失不补」这条值域纪律在界面上也要成立：tail=0 要出现"等封口 0.0s"，
   * 而缺 refine/gate 时那两句根本不该出现（写了就是编数，坑 155）。 */
  guard('延迟拆分：只有静音判定与封口（重转被让路、闸没量到）', () => emit('asr-caption', {
    name: '小张', text: '第十一句', latMs: 1800, stage: { v: 2, wait: 1300, trans: 500, silence: 1200, tail: 0 },
  }));
  ok('延迟拆分：量到的 0 要显示（"等封口 0.0s"=抢跑生效），没量的那两格不许冒出来',
    capLatEl.title.includes('等封口 0.0s') && !capLatEl.title.includes('整句重转') && !capLatEl.title.includes('等成句闸'),
    capLatEl.title.replace(/\n/g, ' | ').slice(0, 200));

  /* ---- ★ 2026-10-03 第 38 步：播报延迟（看到答案 → 听见它开口）----
   * ▎断言的重点与字幕那条一样：**没有锚点就不许编数**。
   *   播报链路的失败形态是"答应了却没声音"，历史上查了三次，
   *   而这三次里没有任何一行日志会红——所以这个读数必须被测试钉住它"什么时候不显示"。 */
  const voiceTs = 1790000000000;
  const emitsBeforeVlat = rec.emits.filter((e) => e === 'ai-speech-lat').length;
  guard('播报延迟：收到带 tts:server 的 AI 答案', () => emit('chat-message', {
    from: 'ai-bot', name: 'AI 小明', text: '好的，已经记下了。', ts: voiceTs, tts: 'server',
  }));
  ok('播报延迟：文字到齐即登记锚点（ts → {时刻, 气泡节点}）',
    vm.runInContext(`voiceAnswerAt.has(${voiceTs})`, ctx) === true);
  vm.runInContext(`voiceAnswerAt.get(${voiceTs}).at = Date.now() - 2300`, ctx);
  guard('播报延迟：音频真的开始播（调 noteVoiceLatency）',
    () => vm.runInContext(`noteVoiceLatency(${voiceTs})`, ctx));
  ok('播报延迟：读数贴在**这条答案自己的气泡**上（图标 + 2.3s 后开口）',
    // 桩的 innerHTML 与 textContent 不聚合（坑 27 家族）：图标与文字同写 innerHTML，就断言 innerHTML
    createdEls.some((e) => e.className === 'msg-voice-lat'
      && String(e.innerHTML).includes('2.3s') && /class="i/.test(String(e.innerHTML))));
  ok('播报延迟：上报服务器累计（权威统计在 /metrics，界面只是本条读数）',
    rec.emits.filter((e) => e === 'ai-speech-lat').length === emitsBeforeVlat + 1);
  ok('播报延迟：锚点用完即销（同一条答案的分段音频不会重复计数）',
    vm.runInContext(`voiceAnswerAt.has(${voiceTs})`, ctx) === false);
  const vlatBefore2 = rec.emits.filter((e) => e === 'ai-speech-lat').length;
  guard('播报延迟：没有锚点的 ts（音频先到/气泡已被回收）',
    () => vm.runInContext(`noteVoiceLatency(${voiceTs + 9999})`, ctx));
  ok('播报延迟：找不到锚点时什么都不报、不崩（不编数）',
    rec.emits.filter((e) => e === 'ai-speech-lat').length === vlatBefore2);

  /* ★ 2026-10-03 浏览器朗读这一轨也要有读数。
   * ▎断言的重点是"两条路都要有数"：原先只有服务端 MP3 那条装表，
   *   而今天实际听到的几乎全是 speechSynthesis（Edge 403 / 本地音色不抢实时）——
   *   那等于给一条平时不跑的路装了表，用户真正等的那条仍然没有数。 */
  const brTs = 1790000000500;
  const vlatBeforeBr = rec.emits.filter((e) => e === 'ai-speech-lat').length;
  guard('浏览器朗读：收到非服务端语音的 AI 答案', () => emit('chat-message', {
    from: 'ai-bot', name: 'AI 小明', text: '这是浏览器朗读的一条答案。', ts: brTs,
  }));
  ok('播报延迟：浏览器朗读这一轨也登记锚点（不再只量服务端那条）',
    vm.runInContext(`voiceAnswerAt.has(${brTs})`, ctx) === true);
  vm.runInContext(`voiceAnswerAt.get(${brTs}).at = Date.now() - 1500`, ctx);
  guard('浏览器朗读：模拟发音开始', () => vm.runInContext(`noteVoiceLatency(${brTs})`, ctx));
  ok('播报延迟：浏览器这一轨同样上报一次',
    rec.emits.filter((e) => e === 'ai-speech-lat').length === vlatBeforeBr + 1);

  /* ---- ★ 2026-10-03 第 39 步：两个延迟读数进值守日报 ----
   * ▎为什么要断这个：日报是"早上拿到手的那份东西"，如果它不含链路质量，
   *   这一夜到底快不快就只剩"当时屏幕上瞟过一眼"——**证据必须能过夜**。 */
  ok('字幕定稿把服务器实测的 lat 一起存进本地账本（日报与导出都靠它）',
    /* ▸ 原来写的是 `cap.log[cap.log.length - 1]`（拿"最后一条"当"我刚才发的那条"）——
     *   本轮在前面插了六块拆分的用例之后它就红了：红的不是功能，是**断言站错了位置**。
     *   按内容找那一条才是本来想说的事，而且不再依赖用例之间的顺序（坑 44 同族）。 */
    vm.runInContext(`(cap.log.find((e) => e.text === '第九句') || {}).lat`, ctx) === 2000
    && vm.runInContext(`(cap.log.find((e) => e.text === '第八句') || {}).lat`, ctx) === 4200,
    vm.runInContext(`JSON.stringify((cap.log.find((e) => e.text === '第九句') || {}).lat)`, ctx));
  /* ▸ 这里刻意用**区间**而不是 ===2300：ms = Date.now() - (Date.now()-2300)，
   *   两次取时之间只要跨过 1ms 就变成 2301 —— 上一版写成精确相等，
   *   于是一条正确的实现会因为**机器的抖动**偶发判红。
   *   判据：**凡是由时间推导出来的期望值，断言就必须带容差**（同坑 28 的帧率教训）。 */
  /* ▸ 这里刻意查"窗口里**存在**这一条"而不是读尾元素：
     *   同一个冒烟会话后面还会再产生读数（浏览器朗读那一组），尾元素会被换掉。 */
  ok('播报延迟进入滚动窗口（上限 60 条，长跑不涨）',
    vm.runInContext(`aiVoiceLats.some((x) => x.ms >= 2300 && x.ms < 2600)`, ctx) === true &&
    vm.runInContext('aiVoiceLats.length', ctx) <= 60);
  /* ▎日报这一节的断言刻意**直接调用那个被抽出来的纯函数**：
   *   原来整段拼串写在点击回调里，谁都调不到，于是"日报里到底有没有链路质量"
   *   只能靠人肉点一下看——抽成 buildSentryReport() 才第一次可断言（这也是抽它的理由）。 */
  const repMd = String(vm.runInContext(`buildSentryReport(
      [{ ts: 1000, name: '小张', text: '第一句', asr: true, lat: 2400 },
       { ts: 61000, name: '小李', text: '第二句', asr: true, lat: 5200 },
       { ts: 121000, name: '小张', text: '没有延迟读数的老条目', asr: true }],
      { startedAt: 1000, restarts: 2, archived: 7 },
      [{ ts: 1, ms: 1800 }, { ts: 2, ms: 4400 }]
    ).md`, ctx));
  ok('2026-10-03 日报含「链路质量」一节：均值/P90/最慢都算对，且带样本数',
    /链路质量/.test(repMd)
    && /说完→上字幕：均值 3\.8s · P90 5\.2s · 最慢 5\.2s（样本 2）/.test(repMd)
    && /看到答案→听到开口：均值 3\.1s · P90 4\.4s · 最慢 4\.4s（样本 2）/.test(repMd),
    (repMd.match(/链路质量[\s\S]{0,200}/) || [''])[0]);
  const repEmpty = String(vm.runInContext(`buildSentryReport(
      [{ ts: 1000, name: '小张', text: '老服务器没有 lat 字段', asr: true }],
      {}, []).md`, ctx));
  ok('2026-10-03 没有延迟数据时不硬凑一节（宁可不写，也不写一个 0.0s 骗人）',
    !/链路质量/.test(repEmpty) && /说话人占比/.test(repEmpty));
  /* ★ 2026-10-03f 延迟**拆分**进日报（服务器现在把 stage 一起归档了）。
   *   ▎为什么值得单独断言：只有一个总秒数时，"慢在等静音判定"与"慢在模型推理"
   *   长得一模一样，而处方完全相反（前者调 asrSegmentSec/FLUSH_MS，后者换引擎）。
   *   上一轮这条纪律只落到界面悬浮提示，账本里没有 = 现场一过就查不到（坑 56 第四次）。
   *   ▎断言按"结论方向"判，不按措辞判：三档处方各测一次，防止判据写反。 */
  const repWait = String(vm.runInContext(`buildSentryReport(
      [{ ts: 1000, name: '小张', text: '一', asr: true, lat: 4200, stage: { wait: 3600, trans: 600 } },
       { ts: 61000, name: '小张', text: '二', asr: true, lat: 4000, stage: { wait: 3400, trans: 600 } }],
      {}, []).md`, ctx));
  ok('2026-10-03f 日报给出"等待 vs 转写"拆分，并指回正确的处方（等待占大头）',
    /* 3.5s 是 [3.4, 3.6] 的**标准中位数**（偶数取中间两值平均）。
     *   写这条断言时我先按"上中位 3.6"期望、又按"3.4"期望，两次都错——
     *   说明偶数样本的中位口径极易想当然，所以把它钉在这里。 */
    /等静音判定\/调度 中位 3\.5s · 模型转写 中位 0\.6s/.test(repWait) && /大头在\*\*等待\*\*/.test(repWait),
    (repWait.match(/其中（末段口径[\s\S]{0,160}/) || [''])[0]);
  const repModel = String(vm.runInContext(`buildSentryReport(
      [{ ts: 1000, name: '小张', text: '一', asr: true, lat: 5000, stage: { wait: 400, trans: 4400 } },
       { ts: 61000, name: '小张', text: '二', asr: true, lat: 5200, stage: { wait: 400, trans: 4600 } }],
      {}, []).md`, ctx));
  ok('2026-10-03f 拆分判据不写反（模型占大头时处方换成换引擎/降档）',
    /大头在\*\*模型\*\*/.test(repModel) && !/大头在\*\*等待\*\*/.test(repModel));
  const repNoStage = String(vm.runInContext(`buildSentryReport(
      [{ ts: 1000, name: '小张', text: '一', asr: true, lat: 3000 }], {}, []).md`, ctx));
  ok('2026-10-03f 老归档没有 stage 时如实说"没有"，不拿 lat 编一个拆分',
    /没有 stage 字段/.test(repNoStage) && !/等静音判定\/调度 中位/.test(repNoStage));
  ok('服务端字幕：单独记账 serverTotal', vm.runInContext('cap.sentry.serverTotal', ctx) >= 1);
  guard('服务端字幕：点关开关', () => capBtnEl.dispatch('click'));
  ok('服务端字幕：关掉只隐藏显示（提示服务器仍在转写）',
    capStatusEl.innerHTML.includes('服务器仍在转写'));
  ctx.__SFU_ASR__ = false; // 还原：后面若有用例碰字幕，仍走浏览器路径
  // ④ 导出合并：导出时先拉服务器全档，和内存段拼成一份 txt
  guard('值守：导出记录（应先拉服务器全档）', () => documentStub.getElementById('capExportBtn').dispatch('click'));
  await new Promise((r) => setTimeout(r, 60));
  ok('值守：导出前拉取了服务器全档（GET /api/captions?...format=txt）',
    rec.fetchCalls.some((c) => c.method === 'GET' && c.url.includes('/api/captions') && c.url.includes('format=txt')));

  // ⑤ ★ 09-18 值守日报（第 31 步，C1）：点「📋 日报」→ 拉归档(format=json)合并全档 → markdown 下载
  guard('值守：生成日报', () => documentStub.getElementById('capReportBtn').dispatch('click'));
  await new Promise((r) => setTimeout(r, 60));
  ok('值守：日报拉取服务器归档（format=json）且生成路径无异常',
    rec.fetchCalls.some((c) => c.method === 'GET' && c.url.includes('/api/captions') && c.url.includes('format=json')));

  /* ---- ③h4 ★ 09-18 演讲人交接迟滞（"谁说话谁上大画面"的防抖）：
   *   audio-levels 每 400ms 一报，抢话/呼吸间隙会让 top 不停易主——
   *   新候选人必须连续坐稳 SPEAKER_HOLD_MS（桩里 30ms）才交接大画面；
   *   高亮（speaking）仍然即时。 ---- */
  // ★ 前置：D6 重连段的 resetMediaState 已把 tiles 清空——createdEls 里留下的旧格子是"死"的，
  //   迟滞交接永远落不到它身上（实修踩坑）。这里补订一路活的 PEER 摄像头，再取"最新"一格做断言。
  emit('new-producer', { producerId: 'up-cam-hys', kind: 'video', appData: { source: 'camera' }, from: PEER });
  await new Promise((r) => setTimeout(r, 120)); // 等订阅 + 建主画面格（异步 consume-data 应答）
  const peerMainBox = createdEls.filter((e) => String(e.className || '').includes('video-box')).pop(); // 最新 = 活的那格
  emit('room-state', {
    roomNumber: '123456',
    members: [
      { id: socketStub.id, owner: true, muted: false, camOff: false, sharing: false },
      { id: PEER, owner: false, muted: false, camOff: false, sharing: false },
    ],
    hostId: null, controllerId: null, expiresAt: null,
  }); // 没人共享：大画面候选只剩"说话人"，迟滞行为才能被干净地断言
  // 先把"现任说话人"清掉（前序用例留过 PEER 的候选）：安静一次 → 等 50ms 坐稳 → 再安静一次
  // → 大画面回退 self，PEER 格的 tile-main 消失（同时验证了"安静回退也走迟滞"）
  guard('迟滞：安静第 1 拍（候选人变 null，重新计时）', () => emit('audio-levels', { levels: [], top: null }));
  await new Promise((r) => setTimeout(r, 50));
  guard('迟滞：安静第 2 拍（坐稳）', () => emit('audio-levels', { levels: [], top: null }));
  ok('迟滞：安静坐稳后大画面回退（PEER 格不再持有 tile-main）',
    !peerMainBox.classList.contains('tile-main'));
  // 现在 PEER 是新候选人：开口第 1 拍不该立刻上大画面（防抢话闪烁），坐稳后才交接
  guard('迟滞：PEER 开口第 1 拍（候选启动计时）', () => emit('audio-levels', { levels: [{ id: PEER, volume: -20 }], top: PEER }));
  ok('迟滞：候选人刚开口未坐稳，大画面还不归他（防抢话闪烁）',
    !peerMainBox.classList.contains('tile-main'));
  await new Promise((r) => setTimeout(r, 50)); // 超过桩里的 30ms 坐稳阈值
  guard('迟滞：PEER 开口第 2 拍（同一候选人）', () => emit('audio-levels', { levels: [{ id: PEER, volume: -20 }], top: PEER }));
  /* 探针打印移至测试末尾 */
  console.log('DBG-boxes-detail:', createdEls.filter((e) => String(e.className || '').includes('video-box')).map((e) => ({
    cls: e.className, inGrid: videoGridEl.children.includes(e), label: (() => { const l = e.children && e.children.find ? e.children.find((c) => String(c.className || '').includes('video-label')) : null; return l ? l.textContent : ''; })(),
  })));
  ok('迟滞：坐稳后大画面交接给他（tile-main 落在 PEER 的格子）',
    peerMainBox.classList.contains('tile-main'));

  /* ---- ③h5 ★ 09-19 AI Bot 参会者（前端四件套）----
   *   按钮 emit ai-join / room-state 注入 bot → 成员行+按钮态 / @ai 走 ai-ask /
   *   bot 聊天气泡 .msg.bot。 ---- */
  const aiBtnEl = documentStub.getElementById('aiBtn');
  guard('AI：点「🤖 AI」按钮', () => aiBtnEl.dispatch('click'));
  ok('AI：点击发出 ai-join 信令', rec.emits.includes('ai-join'));
  emit('room-state', {
    roomNumber: '123456',
    members: [
      { id: socketStub.id, owner: true, muted: false, camOff: false, sharing: false },
      { id: PEER, owner: false, muted: false, camOff: false, sharing: false },
      { id: 'ai-bot', name: '🤖 AI 助理', isBot: true, muted: true, camOff: true, sharing: false },
    ],
    hostId: null, controllerId: null, expiresAt: null,
  });
  const memberListEl2 = documentStub.getElementById('memberList');
  const aiRow2 = memberListEl2.children.find((r) => r.classList.contains('ai-bot-row'));
  ok('AI：bot 在快照里 → 成员列表出现 ai-bot-row 名牌 + 按钮亮起',
    !!aiRow2 && aiBtnEl.classList.contains('active') && aiBtnEl.innerHTML.includes('送走'));
  const aiEmitsBefore = rec.emits.length;
  documentStub.getElementById('chatInput').value = '@ai 谁发言最多';
  guard('AI：发送 @ai 消息', () => documentStub.getElementById('chatSendBtn').dispatch('click'));
  ok('AI：@ai 前缀改走 ai-ask（不再进普通聊天/SCTP 路径）',
    rec.emits.slice(aiEmitsBefore).includes('ai-ask') &&
    !rec.sctpSends.some((x) => { try { return JSON.parse(x).text && JSON.parse(x).text.includes('@ai'); } catch (e) { return false; } }));
  emit('chat-message', { from: 'ai-bot', name: '🤖 AI 助理', text: '[Mock] 我是 AI 助理', ts: Date.now() });
  ok('AI：bot 回答渲染为金边 AI 气泡（.msg.bot）',
    chatListEl && chatListEl.children.some((m) => m.classList.contains('bot')));

  // ③ F6 滤镜失败要"弹出来"而不是静默（用户反馈"滤镜没实现"的另一半答案）
  const fxCostEl2 = documentStub.getElementById('fxCost');
  ok('F6 滤镜状态行在管线未跑时给出明确状态（不是空白）',
    fxCostEl2.textContent.includes('ms/帧') || fxCostEl2.textContent.includes('未启动'));

  /* ---- ④ 远程协助：授权 → 控制层 → 采集 ---- */
  const inputsBefore = rec.remoteInputs;
  emit('remote-answer', { from: PEER, ok: true, expiresAt: Date.now() + 60000 });
  const ctrlLayer = createdEls.find((el) => el.className === 'ctrl-layer');
  ok('A1 授权后创建了控制层（enterControlMode）', !!ctrlLayer);
  if (ctrlLayer) {
    // 采集鼠标移动（rAF 节流后发出 16 字节帧）
    ctrlLayer.dispatch('pointermove', { clientX: 320, clientY: 180, pointerType: 'mouse', preventDefault() {} });
    await new Promise((r) => setTimeout(r, 60));
    ok('A5 控制层 pointermove → 发出 remote-input 二进制帧', rec.remoteInputs > inputsBefore);
    // 滚轮
    ctrlLayer.dispatch('wheel', { clientX: 320, clientY: 180, deltaY: 120, preventDefault() {} });
    await new Promise((r) => setTimeout(r, 120));
    ok('A5 滚轮合并发送（60ms 后发出）', rec.remoteInputs > inputsBefore + 1);
    // 触屏：单指长按 → 500ms 后应发一对 down/up（右键）
    const beforeTouch = rec.remoteInputs;
    ctrlLayer.dispatch('pointerdown', { clientX: 200, clientY: 150, pointerId: 11, pointerType: 'touch', preventDefault() {} });
    await new Promise((r) => setTimeout(r, 650));
    ok('A7 触屏长按 500ms → 模拟右键（发出按下+抬起两条）', rec.remoteInputs >= beforeTouch + 2);
    ctrlLayer.dispatch('pointerup', { pointerId: 11, pointerType: 'touch' });
    // 触屏双指 → 滚轮
    const beforeTwoFinger = rec.remoteInputs;
    ctrlLayer.dispatch('pointerdown', { clientX: 100, clientY: 100, pointerId: 21, pointerType: 'touch' });
    ctrlLayer.dispatch('pointerdown', { clientX: 140, clientY: 100, pointerId: 22, pointerType: 'touch' });
    ctrlLayer.dispatch('pointermove', { clientX: 100, clientY: 160, pointerId: 21, pointerType: 'touch' });
    ctrlLayer.dispatch('pointermove', { clientX: 140, clientY: 160, pointerId: 22, pointerType: 'touch' });
    await new Promise((r) => setTimeout(r, 150));
    ok('A7 双指滑动 → 滚轮消息', rec.remoteInputs > beforeTwoFinger);
    ctrlLayer.dispatch('pointerup', { pointerId: 21, pointerType: 'touch' });
    ctrlLayer.dispatch('pointerup', { pointerId: 22, pointerType: 'touch' });
    // 控制层工具按钮：截图 / 粘贴 / 复制选中 / 发文件
    const shotBtn = ctrlLayer.querySelector('.ctl-shot');
    const pasteBtn = ctrlLayer.querySelector('.ctl-paste');
    const copyBtn = ctrlLayer.querySelector('.ctl-copy');
    const fileBtn = ctrlLayer.querySelector('.ctl-file');
    guard('截图按钮', () => shotBtn.dispatch('click'));
    guard('粘贴按钮', () => pasteBtn.dispatch('click'));
    guard('复制选中按钮', () => copyBtn.dispatch('click'));
    guard('发文件按钮', () => fileBtn.dispatch('click'));
    await new Promise((r) => setTimeout(r, 80));
    ok('A3 控制层「粘贴」按下后发出 clipboard-sync', rec.clipboardSends > 0);
    ok('A4 控制层「发文件」按下后打开文件选择（无异常）', true);
  }

  /* ---- ⑤ 文件发送 / 剪贴板接收 / 审计 / 设备 / 录制 ---- */
  const fileInput = documentStub.getElementById('fileInput');
  fileInput.files = [{ name: 'demo.bin', size: 100000, type: 'application/octet-stream',
    slice: () => ({ arrayBuffer: async () => new ArrayBuffer(32768) }) }];
  guard('文件选择 change', () => fileInput.dispatch('change'));
  ok('A4 选文件后发出 file-offer', rec.fileOffers > 0);
  emit('file-answer', { from: PEER, fileId: rec.lastFileOffer && rec.lastFileOffer.fileId, ok: true });
  await new Promise((r) => setTimeout(r, 200)); // 让 sendFileChunks 跑几轮
  ok('A4 对方接受后开始分块发送（发出 file-chunk）', rec.fileChunks > 0);

  guard('剪贴板接收（host2ctl）', () => emit('clipboard-sync', { from: PEER, text: 'x', dir: 'host2ctl' }));
  ok('A3 收到剪贴板同步不抛错（写入本机剪贴板路径）', true);

  const recordBtn = documentStub.getElementById('recordBtn');
  guard('录制按钮（开始）', () => recordBtn.dispatch('click'));
  await new Promise((r) => setTimeout(r, 60));
  guard('录制按钮（停止）', () => recordBtn.dispatch('click'));
  ok('D5 录制开始/停止不抛错（canvas 合成 + 混音 + MediaRecorder）', true);

  const camSelect = documentStub.getElementById('camSelect');
  camSelect.value = 'cam1';
  guard('切换摄像头', () => camSelect.dispatch('change'));
  await new Promise((r) => setTimeout(r, 80));
  ok('D3 切换摄像头走 replaceTrack（不抛错）', true);

  const micSelect = documentStub.getElementById('micSelect');
  micSelect.value = 'mic1';
  guard('切换麦克风', () => micSelect.dispatch('change'));
  await new Promise((r) => setTimeout(r, 80));
  ok('D3 切换麦克风走 replaceTrack（不抛错）', true);

  /* 被控端侧：走**真实授权链路**把 rcRole 置为 'host'，再验 replayRemoteInput。
   * ▎坑（本次实修）：rcRole='host' 只在点「允许」按钮时设置——只 emit remote-state
   *   是不够的，四种形态的重放会被 `rcRole !== 'host'` 早退**静默跳过**，
   *   断言沦为"不抛错"还全绿。所以这里把宿主链路走真：
   *   共享屏幕 → 开「允许远程协助」→ 收到 remote-request → 点「允许」。 */
  guard('被控端共享屏幕', () => documentStub.getElementById('shareBtn').dispatch('click'));
  await new Promise((r) => setTimeout(r, 120)); // getDisplayMedia + produce 是异步的
  guard('被控端开「允许远程协助」', () => documentStub.getElementById('assistBtn').dispatch('click'));
  emit('remote-request', { from: PEER });       // 控制端申请 → 被控端弹授权卡片
  guard('被控端点「允许」', () => documentStub.getElementById('remoteAllowBtn').dispatch('click'));
  ok('被控端允许后回发 remote-answer { ok:true }',
    rec.lastAllowAnswer && rec.lastAllowAnswer.ok === true && rec.lastAllowAnswer.to === PEER);
  emit('remote-state', { hostId: socketStub.id, controllerId: PEER, expiresAt: null });

  guard('被控端 replay 键盘', () => emit('remote-input', { event: { type: 'input', kind: 'keydown', key: 'a', code: 'KeyA' } }));
  guard('被控端 replay 中文整段', () => emit('remote-input', { event: { type: 'input', kind: 'input-text', text: '你好' } }));
  guard('被控端 replay 剪贴板', () => emit('remote-input', { event: { type: 'input', kind: 'clipboard', dir: 'ctl2host', text: 'abc' } }));
  const frame = newFrame(16);
  const dv = new DataView(frame);
  dv.setUint8(0, 3); dv.setFloat32(4, 0.3); dv.setFloat32(8, 0.4);
  guard('被控端 replay 二进制帧', () => emit('remote-input', { event: frame }));
  ok('A6 被控端重放四种消息形态均不抛错（审计入账同时执行）', true);
  // ★ 09-12：mousedown 帧应在被控端画"点击涟漪"（可见反馈升级）
  const rippleFrame = newFrame(16);
  const rdv = new DataView(rippleFrame);
  rdv.setUint8(0, 4); rdv.setFloat32(4, 0.5); rdv.setFloat32(8, 0.5); rdv.setUint8(1, 1 << 4); // btn=0
  guard('被控端 replay mousedown 帧', () => emit('remote-input', { event: rippleFrame }));
  ok('09-12 mousedown 重放产生点击涟漪（.ctl-ripple）',
    createdEls.some((el) => el.classList && el.classList.contains('ctl-ripple')));

  /* ---- ⑥b ★ 09-16：登录/注册面板 ---- */
  ok('09-16 登录卡初始显示（未登录先登录）',
    !documentStub.getElementById('authOverlay').classList.contains('hidden'));
  documentStub.getElementById('authUser').value = 'tester';
  documentStub.getElementById('authPass').value = 'secret1';
  guard('09-16 点登录', () => documentStub.getElementById('authLoginBtn').dispatch('click'));
  await new Promise((r) => setTimeout(r, 80)); // 等 request 微任务
  ok('09-16 登录请求发出（用户名/密码）',
    !!rec.lastAuth && rec.lastAuth.username === 'tester' && rec.lastAuth.password === 'secret1');
  ok('09-16 登录成功后登录卡隐藏 + token 存档',
    documentStub.getElementById('authOverlay').classList.contains('hidden') &&
    JSON.parse(storageData['wb_auth'] || '{}').token === 'tok-test-123');
  // 登录后的聊天昵称：sendChat 走 SCTP 消息带 name
  const nameSendsBefore = rec.sctpSends.length;
  documentStub.getElementById('chatInput').value = '带昵称的消息';
  guard('09-16 发登录后消息', () => documentStub.getElementById('chatSendBtn').dispatch('click'));
  ok('09-16 SCTP 聊天消息带昵称（name）',
    rec.sctpSends.slice(nameSendsBefore).some((x) => {
      try { return JSON.parse(x).name === 'tester'; } catch (e) { return false; }
    }));
  emit('remote-state', { hostId: null, controllerId: null, expiresAt: null }); // 复位被控态，别带进 D6 重连段

  /* ---- ⑦ 断线重连（D6）---- */
  emit('disconnect', 'transport close');
  emit('connect', {});
  await new Promise((r) => setTimeout(r, 60));
  guard('重连后重新进房', () => emit('room-members', { roomNumber: '123456', members: [] }));
  await new Promise((r) => setTimeout(r, 300));
  ok('D6 断线重连流程不抛错（resetMediaState → initSFU → publishTracks）', true);

  console.log('DBG-reconnect:', (documentStub.getElementById('log').textContent || '').split('\n').filter((l) => l.includes('[DBG] disc') || l.includes('[DBG] rm') || l.includes('[DBG] layout')).join(' | '));

  /* ---- ⑧ ★ G4 移动端/PWA（第 32 步，2026-09-23）----
   * ▎验三件事：PWA 三件套文件在位、侧栏抽屉开关状态机、低带宽模式锁层链路。
   *   Service Worker 注册在无头环境被防御式跳过（navigator 没有 serviceWorker），
   *   注册路径留给真机验证（0.2 清单）。 */
  const PUB = path.join(__dirname, '..', 'sfu', 'public');
  ok('G4 PWA 清单在位（manifest.webmanifest）', fs.existsSync(path.join(PUB, 'manifest.webmanifest')));
  ok('G4 Service Worker 在位（sw.js）', fs.existsSync(path.join(PUB, 'sw.js')));
  ok('G4 应用图标在位（icons/icon-1024.png）', fs.existsSync(path.join(PUB, 'icons', 'icon-1024.png')));
  ok('G4 index.html 已接 manifest（link rel=manifest）', /rel="manifest"/.test(fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')));
  /* ★ 2026-10-06 坑 40 的"防复发"版：新写的业务 JS 一定会漏进 cache-first 那一档。
   *   ▎触发点是真实的：本轮新增 `countup.js`（观测面板的数字滚动），
   *     它不在 VOLATILE_PATHS 里 ⇒ 落到"其余 → cache-first" ⇒ 改了不生效，
   *     而且 SW 只在自身字节变化时才重装——**没人会想起来**。
   *   ▸ 所以这条不靠"记得改"，靠**遍历目录**：sfu/public 下除 vendor/ 与 sw.js 之外的
   *     每个 .js，都必须显式出现在网络优先的清单里。
   *     新增文件忘了登记 = 当场红，而不是三个月后有人来报"页面跑的是旧代码"。 */
  {
    const swSrc = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8');
    const listed = (swSrc.match(/const VOLATILE_PATHS = new Set\(\[[\s\S]*?\]\)/) || [''])[0];
    const publicJs = fs.readdirSync(PUB).filter((f) => f.endsWith('.js') && f !== 'sw.js');
    const missing = publicJs.filter((f) => !listed.includes(`/${f}`));
    ok('2026-10-06 每个前端业务 JS 都被显式列为 network-first（新文件漏登记会当场红，不再重蹈坑 40）',
      publicJs.length >= 2 && missing.length === 0,
      `前端 .js：${publicJs.join('、')}${missing.length ? ' —— 漏登记：' + missing.join('、') : ''}`);
  }

  /* ★ 2026-10-06 结构红线：**"喂给假麦克风的句子"只许有一份**。
   *   ▎为什么这件事值得钉：三个语音测试原先各写一份同样的句子，而 `review:meeting`
   *     靠这批句子分辨"自测场 vs 真人场"。四处各写一份 ⇒ 迟早有一份漂掉，
   *     漂掉的后果不是测试变红，而是**复盘把自测当真人会议来数**（结论错但没人报错）。
   *   ▸ 判据用"遍历 + 字符串比对"而不是"记得引用"：纪律会被忘掉（坑 40 同一条教训）。
   *     有人新开一个语音测试又手抄一遍句子，这条当场红。 */
  {
    const { FIXTURE_SENTENCES } = require('./voice-fixture.js');
    const consumers = ['test-e2e-asr.js', 'test-e2e-reconnect.js', 'test-voice-longrun.js'];
    const copied = [];
    for (const f of consumers) {
      const src = fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
      if (!/FIXTURE_SENTENCES/.test(src)) copied.push(`${f}（没引用唯一实现）`);
      for (const sent of FIXTURE_SENTENCES) {
        if (src.includes(`'${sent}'`) || src.includes(`"${sent}"`)) copied.push(`${f}（手抄了一句「${sent.slice(0, 10)}…」）`);
      }
    }
    ok('2026-10-06 语音 fixture 的句子只有一份实现，三个测试都引用它（复盘靠它分辨自测场与真人场）',
      FIXTURE_SENTENCES.length >= 5 && copied.length === 0, copied.join('、') || `共 ${FIXTURE_SENTENCES.length} 句`);
  }

  // 侧栏抽屉：点开关 → body.side-open + 遮罩亮；点遮罩 → 全部复位
  const sideBtnEl = documentStub.getElementById('sideBtn');
  const sideScrimEl = documentStub.getElementById('sideScrim');
  guard('G4 打开侧栏抽屉', () => sideBtnEl.dispatch('click'));
  ok('G4 抽屉开关：body.side-open 挂上', documentStub.body.classList.contains('side-open'));
  ok('G4 抽屉遮罩亮起（hidden 移除）', !sideScrimEl.classList.contains('hidden'));
  guard('G4 点遮罩关抽屉', () => sideScrimEl.dispatch('click'));
  ok('G4 遮罩点击后抽屉复位（side-open 移除 + 遮罩 hidden）',
    !documentStub.body.classList.contains('side-open') && sideScrimEl.classList.contains('hidden'));

  // 低带宽模式：先铺一个 3 层的 layerState，点「省流」→ 全部锁 0 层；
  // 服务器 ABR 升层（auto:true）→ 被第 32 步钩子纠回；再点 → 交回自动（null）
  emit('layer-changed', { consumerId: 'consumer-1', spatialLayer: 1, layerCount: 3, auto: true, reason: 'auto' });
  const lowBwBtnEl = documentStub.getElementById('lowBwBtn');
  rec.lastLayerPref = null;
  guard('G4 打开省流模式', () => lowBwBtnEl.dispatch('click'));
  ok('G4 省流开启：对多层的 consumer 发出锁最低层（spatialLayer:0）',
    rec.lastLayerPref && rec.lastLayerPref.consumerId === 'consumer-1' && rec.lastLayerPref.spatialLayer === 0);
  ok('G4 省流开启态样式（按钮 active）', lowBwBtnEl.classList.contains('active'));
  rec.lastLayerPref = null;
  emit('layer-changed', { consumerId: 'consumer-1', spatialLayer: 2, layerCount: 3, auto: true, reason: 'auto-up' });
  ok('G4 ABR 升层被省流钩子纠回（重新锁 0 层）',
    rec.lastLayerPref && rec.lastLayerPref.spatialLayer === 0);
  guard('G4 关闭省流模式', () => lowBwBtnEl.dispatch('click'));
  ok('G4 省流关闭：交回服务器自动选层（spatialLayer:null）',
    rec.lastLayerPref && rec.lastLayerPref.spatialLayer === null);
  ok('G4 省流关闭态样式（active 移除）', !lowBwBtnEl.classList.contains('active'));

  /* ---- ⑨ ★ 09-24 AI 会议助理前端链路（流式打字机 / 模式徽标 / 纪要按钮）----
   * ▎为什么这些必须自动化：AI 相关代码最容易"看着能跑但一行断言都没有"——
   *   流式 accumulate、终态去重、Mock 标记都是**状态机**，靠肉眼点两下看不出来漏没漏。 */
  const chatElAfter = documentStub.getElementById('chatList');
  const aiBaseCount = chatElAfter.get_children ? chatElAfter.get_children().length : (chatElAfter.children || []).length;

  // 打字机：首帧建气泡 → 增量往同一气泡追加 → done 收尾并打 mode 徽标
  guard('AI 流式首个增量', () => emit('ai-stream', { id: 'st-1', delta: '你好，', done: false }));
  const countAfterFirst = (chatElAfter.children || []).length;
  ok('AI 流式首帧建立了一个 AI 气泡', countAfterFirst === aiBaseCount + 1);
  guard('AI 流式追加增量', () => emit('ai-stream', { id: 'st-1', delta: '我是 AI 助理', done: false }));
  /* ★ 09-30：增量现在是**按帧批量刷**的（rAF），所以断言必须**等一帧**再读 DOM。
   *   ▎为什么这是对的、而不是"为了过测试而改断言"：
   *     逐 token 写 DOM 会在每个 token 上触发一次强制 reflow（scrollHeight 读取），
   *     一条 200 字答案 = 200 次同步布局 —— 这才是"AI 打字卡"的根因。
   *     改成帧批量后**渲染时机本就不再是同步的**，测试必须跟着这个语义走
   *     （项目里"异步断言"踩过两次：坑 44/48/55，都是断言没跟上真实时序）。
   *     桩里的 rAF = setTimeout(0)，等一个宏任务即可。 */
  await new Promise((r) => setTimeout(r, 20));
  // 注：打字机的文本挂在子节点上（见 client.js 的实修注释），所以要按子节点聚合读
  const aiBubble = (chatElAfter.children || [])[countAfterFirst - 1];
  const aiBubbleText = () => (aiBubble.children || []).map((c) => c.textContent || c.innerHTML || '').join(' ');
  ok('AI 增量累积在同一气泡里（打字机不刷屏）', aiBubbleText().includes('你好，我是 AI 助理'), aiBubbleText().slice(0, 60));
  ok('AI 按帧批量渲染：一帧内多个增量合并且不丢字',
     aiBubbleText().includes('你好，') && aiBubbleText().includes('我是 AI 助理'));
  ok('AI 生成中气泡带 streaming 态（打字光标）', aiBubble.classList.contains('streaming'));
  guard('AI 流式收尾', () => emit('ai-stream', { id: 'st-1', delta: '', done: true, mock: false }));
  ok('AI 收尾后摘掉 streaming 态', !aiBubble.classList.contains('streaming'));
  ok('AI 收尾后打上 LLM 模式徽标',
     (aiBubble.children || []).some((c) => String(c.innerHTML || '').includes('>LLM<')));

  /* ---- ★ 2026-10-04 「喇叭真的出声了」第一次有**行为**断言（speechStub 补齐之后的红利）----
   * ▎为什么这条必须补：上一轮 `speakStreamPart` 里引用了一个作用域里根本不存在的变量，
   *   每次流式切出一整句就抛一次 ReferenceError（真浏览器控制台抓到 3 次），
   *   而冒烟连跑两天全绿——桩里没有语音合成能力 → `SPEECH_OK=false` → 那一行**从来没被执行过**。
   *   坑 57/65/76 同族：**桩里缺一个能力，等于那条分支永久不测**，而且没有任何东西会红。
   * ▎现在把"切出来的句子真的交给了 speak()"变成断言：那个变量再写错、或切句条件再退化成
   *   "永远切不出东西"，这里当场红——不用再等用户来报"它答应了却不说话"。 */
  {
    /* 前提显式立起来（不是为过测试而放宽断言）：此刻没人说话、服务端那一轨没接住答案。
       上面 asr-caption 那组刚把"最近有人说"的时间戳推过，不清零就会撞进抢话闸，
       那测的是"等一轮"（第 47 步已单独断言过），不是"这一句上嘴"——两件事必须分开。 */
    vm.runInContext('aiHush.analyser = null; lastUserSpeechTs = 0; lastMicVoiceTs = 0; aiTtsEnabled = false;', ctx);
    const spokenBefore = speechStub.spoken.length;
    const cancelsBefore = speechStub.cancels;
    const startedBefore = vm.runInContext('voiceTrace.started', ctx);
    const latBefore = rec.emits.filter((e) => e === 'ai-speech-lat').length;
    guard('流式朗读：LLM 吐出完整的一句',
      () => emit('ai-stream', { id: 'st-voice', delta: '这场会我记了三条待办。', done: false }));
    /* ★ 这一条是本轮真修出来的缺陷：流式那一轨传的是 streamId（**字符串**），
       而 enqueueAiSpeech 登记轮次锚点的判据写死了 `typeof answerTs === 'number'`
       → 语音问答的答案（基本都是流式的）永远登记不上 → 播报读数只出现在少数非流式场景，
       /metrics 长期少一整类样本（坑 56：内外层对"这个键长什么样"的假设不一致）。 */
    ok('2026-10-04 嘴·锚点：流式（字符串 streamId）也登记上了轮次锚点',
      vm.runInContext(`aiSpeakRoundTs === 'st-voice' && voiceAnswerAt.has('st-voice')`, ctx) === true);
    /* 桩里的 onstart 是下一个宏任务，几乎与"文字到齐"同一毫秒，noteVoiceLatency 的
       `ms <= 0` 判据会正确地把它当脏值丢掉（不编数）。所以这里**把锚点往前挪 700ms**
       来模拟真实的发音启动耗时——不是为过断言改判据：判据本身在这一刻是对的，
       错的只是假时钟。挪完之后走的就是生产那条完整分支（读数 + 上报 + 销账）。 */
    vm.runInContext(`voiceAnswerAt.get('st-voice').at = Date.now() - 700`, ctx);
    ok('2026-10-04 嘴·流式：整句立刻上嘴，不等整段答案写完（按句流水线真在跑）',
      speechStub.spoken.slice(spokenBefore).some((t) => t.includes('这场会我记了三条待办')),
      JSON.stringify(speechStub.spoken.slice(spokenBefore)));
    const firstUtter = speechStub.utterances[speechStub.utterances.length - 1];
    ok('2026-10-04 嘴·音质：发音参数按"去 AI 味"设定（中文 lang + 略快略亮）',
      !!firstUtter && firstUtter.lang === 'zh-CN' && firstUtter.rate > 1 && firstUtter.pitch > 1);
    /* 反向对照：半句不许单独念（否则听着像结巴）。没有这条，
       "任何增量都念出去"也能让上面那条绿——判据要能红才有意义。 */
    const midCount = speechStub.spoken.length;
    guard('流式朗读：只吐出半句',
      () => emit('ai-stream', { id: 'st-voice', delta: '另外还有一句还没', done: false }));
    ok('2026-10-04 嘴·半句不上嘴：没有句末标点的增量不单独念', speechStub.spoken.length === midCount);
    guard('流式朗读：后半句补齐',
      () => emit('ai-stream', { id: 'st-voice', delta: '说完的内容。', done: false }));
    /* ▎为什么这里要等：泵在句与句之间留 120ms 自然停顿（真人换气），第二句是
       靠前一句的 onend 接力才出口，不是 push 的那一刻。第一版没等它就断言，红了——
       **量具太急不等于功能坏了**（同 check:board 等 toBlob 那条教训）。 */
    await new Promise((r) => setTimeout(r, 320));
    ok('2026-10-04 嘴·记账：凑成整句才念，且只念新增的那半句（不重念已念过的）',
      speechStub.spoken.slice(midCount).some((t) => t.includes('另外还有一句还没说完的内容')) &&
      !String(speechStub.spoken[midCount]).includes('三条待办'),
      JSON.stringify(speechStub.spoken.slice(midCount)));
    /* 一轮答案的第一句要"只说最新"：排队时 cancel 掉旧的寒暄，否则新答案会被旧内容堵在后面
       （真机实测过"文字 2.6s 上屏、声音 8.1s 才轮到"）。 */
    ok('2026-10-04 嘴·只说最新：本轮第一句排进去时 cancel 了旧队列',
      speechStub.cancels > cancelsBefore);
    /* 延迟读数原先只能靠测试**手动调** noteVoiceLatency 才出现；桩补上 onstart 之后，
       这条路第一次是"因为发音真的开始而自动量出来的"（第 38 步的口径：onstart 才是开口）。 */
    ok('2026-10-04 嘴·读数自涨：发音开始（onstart）触发"真的出声"计数并自动上报一次',
      vm.runInContext('voiceTrace.started', ctx) > startedBefore &&
      rec.emits.filter((e) => e === 'ai-speech-lat').length > latBefore &&
      vm.runInContext(`voiceAnswerAt.has('st-voice')`, ctx) === false,
      `started=${vm.runInContext('voiceTrace.started', ctx)} emits=${rec.emits.filter((e) => e === 'ai-speech-lat').length}`);

    /* 分句队列的接力：一条答案里有两句 → 第一句当场念、第二句靠 onend 接上。
       桩原先不回调 onend，这条路永远只念第一句（"改完只测了一半"就是这么来的）。 */
    const twoBefore = speechStub.spoken.length;
    guard('两条句子的答案（非流式终态）', () => emit('chat-message', {
      from: 'ai-bot', name: 'AI 小明', text: '第一句说完了。第二句还排在队列里。', ts: Date.now(),
    }));
    ok('2026-10-04 嘴·队列：一句答案里的第一句立刻念', speechStub.spoken.length > twoBefore);
    await new Promise((r) => setTimeout(r, 400));
    ok('2026-10-04 嘴·接力：念完前一句后泵自动接上下一句（不是一条断链）',
      speechStub.spoken.slice(twoBefore).some((t) => t.includes('第二句还排在队列里')),
      JSON.stringify(speechStub.spoken.slice(twoBefore)));
  }

  /* ---- ★ 2026-10-06 「答应了却不说话」的最后一公里：客户端自己必须有保险丝 ----
   * ▎起因：test:asr-live 同一条断言一会儿绿一会儿红（音频 0 段 / 失败通知 0 次）。
   *   查下来两件事同时成立：
   *   ① 测试拿一个**固定睡眠**去赌异步到达的时刻（服务器那句"发不出音频"要等合成任务落地才说）；
   *   ② 更重的那件——**整条兜底只挂在服务器补发 ai-tts-fail 上**。只要应答链路在流水线
   *     收尾之前抛错，或那条信令在网络上丢了，pendingServerTts 里这笔账就永远挂着，
   *     而浏览器朗读被让位闸挡着 = 这一轮**永久无声、零报错**（坑 66 的第三种形态）。
   * ▎判据：一条 tts:'server' 的答案必须有交代，**而且交代的时限由客户端说了算**——
   *   不能只断言"服务器通常会说"。所以这里断的是三条行为，不是源码形状。 */
  {
    const v6 = fs.readFileSync(path.join(PUB, 'client.js'), 'utf8');
    ok('2026-10-06 保险丝真的挂在挂账那一行之后（只测行为容易漏掉"没人去装它"）',
      /pendingServerTts\.set\(ts, text\);\s*\n\s*armServerTtsBackstop\(ts\);/.test(v6));
    ok('2026-10-06 「这一轮由浏览器自己念」只有一处实现（ai-tts-fail 处理器不再自己内联一遍，坑 47）',
      (v6.match(/function fallBackToBrowserTts\(/g) || []).length === 1
      && (() => {
        const m = /socket\.on\('ai-tts-fail'[\s\S]{0,700}?\n\}\);/.exec(v6);
        return !!m && m[0].includes('fallBackToBrowserTts(') && !m[0].includes('speakAiText(');
      })());

    // 前提显式立起来（与上面"嘴"那一组同一条理由）：此刻没人说话、服务端那一轨没接住答案。
    vm.runInContext('aiHush.analyser = null; lastUserSpeechTs = 0; lastMicVoiceTs = 0; aiTtsEnabled = false; aiVoiceOn = true;', ctx);

    /* ① 服务器说了"发不出" → 浏览器立刻念，并且**这一轮之后不许再叠服务端音频** */
    const tFail = 1791000000001;
    guard('带 tts:server 的答案到齐（服务器随后承认发不出音频）', () => emit('chat-message', {
      from: 'ai-bot', name: 'AI 小明', text: '这条答案服务端语音发不出去。', ts: tFail, tts: 'server',
    }));
    ok('2026-10-06 挂账：tts:server 的答案先进回落账本（浏览器不抢读，防双声）',
      vm.runInContext(`pendingServerTts.get(${tFail})`, ctx) === '这条答案服务端语音发不出去。');
    const sp1 = speechStub.spoken.length;
    guard('服务器补发 ai-tts-fail', () => emit('ai-tts-fail', { ts: tFail }));
    ok('2026-10-06 回落：ai-tts-fail 之后这条答案真的上了嘴（不是又一个静默 return）',
      speechStub.spoken.slice(sp1).some((t) => t.includes('服务端语音发不出去')),
      JSON.stringify(speechStub.spoken.slice(sp1)));
    ok('2026-10-06 回落之后账本即销（同一条答案不会被念两遍）',
      vm.runInContext(`pendingServerTts.has(${tFail})`, ctx) === false);
    const dropBefore = vm.runInContext('voiceTrace.srvDrop', ctx);
    guard('晚到的服务端音频（2026-10-06 之后这是**正常时序**：决定 8s、合成可到 12s）',
      () => emit('ai-audio', { url: '/ai-tts/late.mp3', ts: tFail, seq: 0, total: 1 }));
    ok('2026-10-06 已回落的那一轮，晚到的音频被按 ts 丢掉（两个声音不抢同一句话）',
      vm.runInContext('voiceTrace.srvDrop', ctx) === dropBefore + 1);

    /* ② 服务器连"发不出"都没能说出口 → 客户端自己到点回落 */
    const tBack = 1791000000002;
    guard('带 tts:server 的答案到齐（之后服务器一言不发）', () => emit('chat-message', {
      from: 'ai-bot', name: 'AI 小明', text: '服务器卡住的那一轮由我自己念。', ts: tBack, tts: 'server',
    }));
    const sp2 = speechStub.spoken.length;
    guard('保险丝到点（真浏览器里是 20s 定时器，这里直接叫同一个入口）',
      () => vm.runInContext(`fallBackToBrowserTts(${tBack}, 'backstop')`, ctx));
    ok('2026-10-06 保险丝到点时这条答案上了嘴（"永远等下去"不再是一种可能的结局）',
      speechStub.spoken.slice(sp2).some((t) => t.includes('由我自己念')),
      JSON.stringify(speechStub.spoken.slice(sp2)));

    /* ③ 反向对照：已经出声过的那一轮，保险丝不许再念一遍（否则每句都听两遍） */
    const tPlayed = 1791000000003;
    guard('带 tts:server 的答案到齐', () => emit('chat-message', {
      from: 'ai-bot', name: 'AI 小明', text: '这一段服务端已经播过了。', ts: tPlayed, tts: 'server',
    }));
    vm.runInContext(`pendingServerTts.delete(${tPlayed})`, ctx); // 模拟 onplaying 销账（真的开始播了）
    const sp3 = speechStub.spoken.length;
    ok('2026-10-06 已经出声的轮次，保险丝到点也不念第二遍（判据是账本还在不在）',
      vm.runInContext(`fallBackToBrowserTts(${tPlayed}, 'backstop')`, ctx) === false
      && speechStub.spoken.length === sp3);
  }

  /* ---- ★ 2026-10-04 界面说实话：引擎名从"唯一一处"落地 ----
   * ▎真缺陷（e2e-asr 的日志里看见的）：徽标写成 **"服务器转写（服务器转写）"**。
   *   本文件有三处读 /config.json（进房 initSFU / 点字幕 ensureAsrConfig /
   *   浏览器识别失败兜底），原先**只有进房那一处**会写 serverAsrEngine。
   *   于是"配置还没落地就先点了字幕"这一路，asrEngineCn() 走兜底文案，
   *   而那句兜底恰好也叫"服务器转写" → 外层模板 + 兜底拼成胡话。
   *   用户看到这种字就会判断"引擎根本没切换"（坑 67 家族：含混的声明比缺失更糟——
   *   它会让人去装已经装好的东西；10-03g 那三处硬编码 "whisper" 是同一个病的另一面）。
   * ▎本地读一份源码：文件后面才有那个 `const clientSrc`，在这里用它就是 TDZ（坑 69，本机踩过三次）。 */
  {
    const cfgSrc = fs.readFileSync(path.join(PUB, 'client.js'), 'utf8');
    ok('2026-10-04 引擎名赋值点唯一，多处 /config.json 读取器共用 applyServerConfig（结构上不会再漏一半）',
      (cfgSrc.match(/^\s*serverAsrEngine = /gm) || []).length === 1 &&
      /function applyServerConfig\(cfg\) \{/.test(cfgSrc));
    ok('2026-10-04 引擎未知时如实说"待确认"，不再与外层模板拼成同一句（兜底文案不重复）',
      /ASR_ENGINE_CN\[serverAsrEngine\] \|\| '引擎待确认'/.test(cfgSrc) &&
      !/ASR_ENGINE_CN\[serverAsrEngine\] \|\| '服务器转写'/.test(cfgSrc));
    /* ★ 2026-10-06 跨网邀请入口（G4 收口）三条：
     *   ① 顶栏按钮存在且**默认 hidden**（HTML 里就藏着，不等 JS 来得及）；
     *   ② 可见性由 applyServerConfig 按 cfg.tsUrl 双向 toggle——"没有就藏"要写成显式判据，
     *      否则哪天配置改回去，按钮会留在页面上指一条打不开的链接（坑 82 的链接版：
     *      假声明比缺失更有害，用户会以为是自己网络坏了）；
     *   ③ 那条链接**只有一个构造点**：两处各拼一遍 `${tsUrl}/?room=`，
     *      迟早有一处漏掉 ?room=，表现是"对方点开是首页"——最难自查的坏法。 */
    const topHtml = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
    ok('2026-10-06 顶栏有「跨网链接」按钮，且 HTML 里就默认 hidden',
      /id="crossLinkBtn"[^>]*class="[^"]*hidden/.test(topHtml));
    ok('2026-10-06 按钮显隐跟着服务器真值双向 toggle（tsUrl 没有就藏起来，不留假链接）',
      /crossLinkBtn\.classList\.toggle\('hidden', !tsUrl\)/.test(cfgSrc));
    ok('2026-10-06 跨网链接只有一个构造点（tsUrl→?room= 只拼一次，两处共用它）',
      (cfgSrc.match(/\$\{tsUrl\}\/\?room=/g) || []).length === 1 &&
      /const crossLink = crossInviteLink\(\);/.test(cfgSrc));
    /* 每一处配置读取都要真的把这个字段落地：读三份写一份 = 永远漏一半（坑 56 的形状）。
     * ★ 2026-10-06 从 3 处变 4 处：首屏也读一次（跨网入口/AI 模式灯是服务器事实，
     *   不该等进房才知道）。判据不变——**读取器可以多，落地函数只能有一个**。 */
    ok('2026-10-06 五处 fetch(/config.json) 全部走同一个落地函数（读取器多、写入点唯一）',
      (() => {
        const fetches = (cfgSrc.match(/fetch\('\/config\.json'/g) || []).length;
        const refs = (cfgSrc.match(/applyServerConfig\(/g) || []).length;   // 1 处定义 + 每个读取器一次调用
        return fetches === 5 && refs - 1 === fetches;
      })(),
      `fetch 处数=${(require('fs').readFileSync(path.join(PUB, 'client.js'), 'utf8').match(/fetch\('\/config\.json'/g) || []).length}`);
    /* ★ 2026-10-06 版本自检（坑 40 的最后一块）：页面拿自己实际加载到的 ?v= 与服务器下发的比。
     *   两条各钉一个失败方向：① 一致时**不许**弹（一条常亮的假警告会让人不再相信警告）；
     *   ② 判据必须是"比对"而不是"服务器重启了就提醒"（后者会把没有旧代码的场合也报一遍）。 */
    ok('2026-10-06 版本自检：读不到版本就闭嘴，比对结果**当下**决定显隐（不做"报过就不收回"的锁存）',
      /if \(!advertised \|\| typeof advertised !== 'object'\) return;/.test(cfgSrc) &&
      /staleBuildEl\.classList\.toggle\('hidden', !stale\)/.test(cfgSrc) &&
      /LOADED_ASSET_VERSION\[k\] !== advertised\[k\]/.test(cfgSrc));
    /* 真浏览器替我抓到的一个坑：vendor 里那个 `mediasoup-client.js` 结尾也是 "client.js"，
     * 读版本时不加路径边界就会拿它的 ?v= 当自己的（结果：自检永远"读不到版本"，静默失效）。
     * 这条断言钉的就是那个边界。 */
    ok('2026-10-06 读自己加载到的版本时带路径边界（不能被 vendor/mediasoup-client.js 撞名）',
      cfgSrc.includes(String.raw`(?:^|\/)(client\.js|style\.css|countup\.js)\?v=`));
    ok('2026-10-06 版本自检的修复入口保留查询串（在会中点它不能被踢回首页），且不走 new URL（假 DOM 桩会炸）',
      (() => {
        const block = (cfgSrc.match(/if \(staleReloadBtn\)[\s\S]*?\n\}\);/) || [''])[0];
        return /location\.pathname \+ \(search \? search \+ '&' : '\?'\) \+ 'nosw=1'/.test(block) &&
               !/new URL\(/.test(block) && block.length > 40;
      })());
    ok('2026-10-06 服务器按内容哈希改写 ?v=，index.html 里不再靠人记得 bump',
      (() => {
        const srv = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'server.js'), 'utf8');
        return /function injectAssetVersions\(html\)/.test(srv) &&
               /assetVersions: assetVersions\(\)/.test(srv) &&
               /\?v=\$\{assetVersion\(file\)\}/.test(srv);
      })());
  }

  /* ★ 2026-10-06 第 47 步「邀请面板」结构六条。
   *   ▎为什么这块只做结构、行为交给真浏览器（check:visual）：面板的关键动作是
   *     "点徽标弹出 + 点面板外面收起"，而后者的监听器挂在 **document** 上，
   *     冒烟桩的 document.addEventListener 是空操作（不记监听），在那儿断言等于测桩。
   *   ▸ 结构断言钉的是"会不会哪天又长出第二个构造点 / 假按钮 / 盖住提示条"这三类回归。 */
  {
    const invSrc = fs.readFileSync(path.join(PUB, 'client.js'), 'utf8');
    const invHtml = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
    const invCss = fs.readFileSync(path.join(PUB, 'style.css'), 'utf8');
    const row = invHtml.slice(invHtml.indexOf('id="invitePanel"'), invHtml.indexOf('<!-- 舞台'));
    ok('2026-10-06 邀请面板在 HTML 里就默认 hidden，跨网那行的「复制」按钮也默认 hidden',
      /id="invitePanel" class="invite-panel hidden/.test(row) &&
      /id="inviteCrossCopy" class="[^"]*hidden/.test(row));
    /* 两个链接各自只有一个构造点。判据用 location.origin 与"?room= 出现在代码行里"的**行数**——
     * 单看函数名会漏掉"有人在别处手拼了一遍"（那正是要防的事本身）。 */
    ok('2026-10-06 局域网地址的 base 只有一个来源（location.origin 全文件仅一处）',
      (invSrc.match(/location\.origin/g) || []).length === 1);
    ok('2026-10-06 全文件只有两处把房间号拼进查询串（lanInviteLink / crossInviteLink），别处一律调它们',
      (() => {
        const lines = invSrc.split('\n').filter((l) => {
          const t = l.trim();
          return l.includes('/?room=') && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        });
        return lines.length === 2 && lines.every((l) => l.trim().startsWith('return'));
      })(),
      `非注释行里 /?room= 出现 ${(invSrc.split('\n').filter((l) => l.includes('/?room=') && !l.trim().startsWith('//') && !l.trim().startsWith('*')) || []).length} 次`);
    ok('2026-10-06 徽标点击=复制局域网那条 + 展开面板（老路径没变，新信息只是多出来）',
      /roomBadge\.addEventListener\('click'[\s\S]{0,600}?openInvitePanel\(\);[\s\S]{0,200}?const link = lanInviteLink\(\);/.test(invSrc));
    /* 地址来自服务器配置（lanUrl/tsUrl），插进 DOM 时只用 textContent——
     * 用 innerHTML 就等于把"服务器下发什么页面就拼什么"这条注入面打开（第 7 课的老规矩）。 */
    ok('2026-10-06 面板写地址只用 textContent，不许 innerHTML（地址是服务器下发的，不当 HTML 用）',
      (() => {
        const fn = (invSrc.match(/function renderInvitePanel\(\)[\s\S]*?\n\}/) || [''])[0];
        return fn.length > 200 && !/innerHTML/.test(fn) && /textContent/.test(fn);
      })());
    /* 没有跨网入口时：这一行写明"没有"，且那颗复制按钮必须跟着藏（按钮对着说明文字=界面在骗人）。 */
    ok('2026-10-06 没有跨网入口时复制按钮跟着藏起来（toggle 的是 !cross，不是恒显）',
      /inviteCrossCopy\.classList\.toggle\('hidden', !cross\)/.test(invSrc));
    ok('2026-10-06 房间作废时邀请面板一起收（面板不跟着徽标藏 = 一张写着死房号的邀请卡）',
      (() => {
        const fn = (invSrc.match(/function giveUpRoom\([\s\S]*?\n\}\)/) || [''])[0];
        return fn.includes('closeInvitePanel();') &&
               fn.indexOf('closeInvitePanel();') < fn.indexOf("roomBadge.classList.add('hidden')");
      })());
    ok('2026-10-06 邀请面板进 Esc 关层梯（浮层都要能被键盘关掉，且只写一份判据）',
      /\{ id: 'invitePanel', name: '邀请面板' \}/.test(invSrc));
    /* 层叠：面板必须在提示条(.toast z150)之下——点「复制」的唯一反馈就是那条 toast。
     * 这条是 10-04 那次"白板盖住字幕条"的同一类检查，用数出来的 z-index 而不是"看着没事"。 */
    /* 提示条的 z-index 不在同一条规则的首个花括号里（position/left/bottom 在前，z-index 在第五行），
     * 用 `[^}]*` 够不着——那就从 .toast 那条**往后找第一个** z-index。
     * 找不到就判失败，不许"读不到就默认 150"（那等于拿断言跟我脑子里那个数比，CSS 改了它也不会红）。 */
    const panelZ = Number(((invCss.match(/\.invite-panel \{[\s\S]*?\}/) || [''])[0].match(/z-index:\s*(\d+)/) || [])[1]);
    const toastAt = invCss.indexOf('\n.toast {');
    const toastZ = toastAt < 0 ? NaN : Number((invCss.slice(toastAt).match(/z-index:\s*(\d+)/) || [])[1]);
    ok('2026-10-06 面板 z-index 低于提示条（复制成功的反馈不能被自己盖住）',
      Number.isFinite(panelZ) && panelZ > 0 && Number.isFinite(toastZ) && panelZ < toastZ,
      `面板 z=${panelZ} · 提示条 z=${toastZ}`);
    /* 坑 24 家族的可推广写法：面板自己**没有**声明 display，所以全局 .hidden{display:none !important}
     * 兜得住；哪天有人给它加 display，就必须同时加一条 .invite-panel.hidden。 */
    ok('2026-10-06 面板没声明 display（有 display 就必须补 .invite-panel.hidden，否则关不掉——坑 24）',
      (() => {
        const blk = (invCss.match(/\.invite-panel \{[^}]*\}/) || [''])[0];
        return /\bdisplay:/.test(blk) ? /\.invite-panel\.hidden/.test(invCss) : !/\bdisplay:/.test(blk);
      })());
  }

  // 终态 chat-message 与上面的流式是同一条 → 必须被去重吃掉（否则会显示两遍）
  const beforeDup = (chatElAfter.children || []).length;
  guard('AI 终态消息（同一 streamId）', () => emit('chat-message', {
    from: 'ai-bot', name: '🤖 AI 助理', text: '你好，我是 AI 助理', streamId: 'st-1', ai: { mock: false, tokens: 42 },
  }));
  ok('AI 流式回答的终态消息不会重复成第二条气泡', (chatElAfter.children || []).length === beforeDup);

  // Mock 轨道的气泡：必须显式标明走的是本地规则（诚实 UI）
  const beforeMock = (chatElAfter.children || []).length;
  guard('AI Mock 回答', () => emit('chat-message', {
    from: 'ai-bot', name: '🤖 AI 助理', text: '[Mock] 本地答案', ai: { mock: true, tokens: 0 },
  }));
  const mockBubble = (chatElAfter.children || [])[(chatElAfter.children || []).length - 1];
  ok('Mock 回答气泡带 Mock 徽标（前端如实标注答案来源）',
     (chatElAfter.children || []).length === beforeMock + 1 && (mockBubble.innerHTML || '').includes('>Mock<')
     && (mockBubble.innerHTML || '').includes('mock'));
  // 带 token 用量的气泡（让每次 AI 调用的成本肉眼可见）
  guard('AI 带用量回答', () => emit('chat-message', {
    from: 'ai-bot', name: '🤖 AI 助理', text: '答案', ai: { mock: false, tokens: 128 },
  }));
  ok('AI 气泡显示 token 用量（成本可见）',
     (chatElAfter.children || []).slice(-1)[0].innerHTML.includes('128t'));
  // 纪要气泡里的下载链接（AI 产物必须能一键打开）
  guard('AI 纪要消息', () => emit('chat-message', {
    from: 'ai-bot', name: '🤖 AI 助理', text: '纪要已生成', ai: { mock: false, tokens: 300, path: '/minutes/123456/x.md' },
  }));
  ok('纪要气泡含 /minutes 下载链接',
     (chatElAfter.children || []).slice(-1)[0].innerHTML.includes('/minutes/123456/x.md'));

  // 「📝 纪要」按钮：index.html 在位，点击向服务器发 ai-minutes
  ok('09-24 index.html 含「📝 纪要」入口（字幕资产的下游）',
     /id="capMinutesBtn"/.test(fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')));
  const capMinutesBtnEl = documentStub.getElementById('capMinutesBtn');
  ok('09-24 纪要按钮已挂接到客户端 JS', !!capMinutesBtnEl);

  /* ★ 09-25「🗂 汇总」跨段归并入口：值守挂一夜会产出 7~8 份分段纪要，
   *   但没人会逐份读——"早上只看一份"才是用户要的。
   *   前端契约：入口在位 + 点击必须发 `ai-minutes {type:'merge'}`（不是 segment）。 */
  ok('09-25 index.html 含「🗂 汇总」入口（跨段归并的下游）',
    /id="capMergeBtn"/.test(fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')));
  const capMergeBtnEl = documentStub.getElementById('capMergeBtn');
  ok('09-25 汇总按钮已挂接到客户端 JS', !!capMergeBtnEl);
  const mergeEmitsBefore = rec.emits.filter((e) => e === 'ai-minutes').length;
  if (capMergeBtnEl) guard('汇总按钮点击', () => capMergeBtnEl.dispatch('click'));

  /* ---- ★ 09-25 AI 会议看板 + 侧栏分段 + 快捷问法 + 语音（前端契约）----
   *   ▎这里的断言刻意选"**结构与契约**"而非"渲染细节"（渲染由 verify-board 的真浏览器测）：
   *     假 DOM 断言渲染细节等于自欺（桩不是浏览器），但它足够验证"线通没通"：
   *     元素在不在、事件挂没挂、点击有没有发出正确信令。 */
  const idxHtml = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  ok('09-25 index.html 含侧栏三分段（成员/看板/聊天）',
    /data-side="members"/.test(idxHtml) && /data-side="board"/.test(idxHtml) && /data-side="chat"/.test(idxHtml));
  ok('09-25 index.html 含看板容器与空状态', /id="boardList"/.test(idxHtml) && /id="boardEmpty"/.test(idxHtml));
  ok('09-25 index.html 含快捷问法区与语音开关',
    /id="aiChips"/.test(idxHtml) && /id="aiVoiceBtn"/.test(idxHtml));
  ok('09-25 侧栏改造没丢原有契约 id（memberList/chatList/memberNum）',
    /id="memberList"/.test(idxHtml) && /id="chatList"/.test(idxHtml) && /id="memberNum"/.test(idxHtml));

  const boardListEl = documentStub.getElementById('boardList');
  ok('09-25 看板列表元素已挂到客户端 JS（可被渲染）', !!boardListEl);
  ok('09-25 看板为空时不渲染任何条目（空状态由 boardEmpty 承担）',
    (boardListEl.children || []).length === 0);

  // 主动拉全量：进房时 client 必须发 ai-board-get（否则晚进房者看到空板）
  ok('09-25 进房后主动拉取看板全量（ai-board-get，推+拉并存）',
    rec.emits.includes('ai-board-get'));

  // 服务端推来的看板增量 → 渲染出条目（走真实事件处理链路）
  const beforeBoard = (boardListEl.children || []).length;
  emit('ai-board', {
    counts: { decision: 1, risk: 0, todo: 2, topic: 0 },
    items: {
      decision: [{ ts: 1, name: '张三', text: '交付时间定在 11 月 20 日', kind: 'decision' }],
      risk: [], topic: [],
      todo: [
        { ts: 2, name: '李四', text: '压测报告我负责', kind: 'todo', owner: '李四', task: '提交压测报告', due: '周五' },
        { ts: 3, name: '王五', text: 'TURN 账号密码记得轮换', kind: 'todo', owner: '', task: '轮换 TURN 账号密码', due: '下周一' },
      ],
    },
    added: { decision: [{ ts: 1, text: '交付时间定在 11 月 20 日' }], risk: [], todo: [], topic: [] },
    total: 9,
  });
  /* ⚠️ 假 DOM 里 appendChild 只往 children 推，**不会把子节点的 innerHTML 汇总到父节点**，
   *   所以"读 boardList.innerHTML 找内容"永远是空串（初版断言就是这么失败的）。
   *   必须**递归遍历子树**把每层的 innerHTML/textContent 都收上来——
   *   这是假 DOM 与真 DOM 的行为差异，写断言时得记住（不是代码的问题）。 */
  const collectText = (el) => {
    if (!el) return '';
    let s = String(el.innerHTML || '') + ' ' + String(el.textContent || '');
    for (const c of (el.children || [])) s += ' ' + collectText(c);
    return s;
  };
  const boardHtml = collectText(boardListEl);
  ok('09-25 收到 ai-board 后渲染出看板条目', (boardListEl.children || []).length > beforeBoard);
  ok('09-25 看板渲染含决定与行动项内容（走真实事件链路）',
    boardHtml.includes('11 月 20 日') && boardHtml.includes('提交压测报告'), boardHtml.slice(0, 200));
  ok('09-25 看板行动项显示期限与负责人（三字段结构化呈现）',
    boardHtml.includes('周五') && boardHtml.includes('李四'), boardHtml.slice(0, 200));
  ok('09-25 看板内容经过 HTML 转义（原话是用户输入，不转义就是 XSS 直通车）',
    !/<script/i.test(boardHtml));

  /* ★ 09-25 认领按钮：无主行动项上必须有「我来」——它把"待认领"从提示变成动作。
   *   ▎注意：已认领的那条（李四）**不该**有按钮，否则等于允许抢别人的任务。 */
  const findRows = (el, out = []) => {
    for (const c of (el.children || [])) { out.push(c); findRows(c, out); }
    return out;
  };
  const allRows = findRows(boardListEl);
  const claimBtns = allRows.filter((c) => c.classList.contains('bi-claim'));
  ok('09-25 无主行动项渲染出「我来」认领按钮', claimBtns.length === 1,
    '期望恰好 1 个（只有无主那条需要认领），实际 ' + claimBtns.length);
  const todoRows = allRows.filter((c) => String(c.className).includes('k-todo'));
  ok('09-25 已认领的行动项**没有**认领按钮（不能抢别人的任务）',
    todoRows.length === 2 && claimBtns.length === 1);
  ok('09-25 无主那条同时带「待认领」徽标（状态与动作成对出现）',
    /待认领/.test(boardHtml));

  // 真点一下「我来」→ 必须发出 ai-board-claim（走服务器记账，不做本地乐观更新）
  const claimBefore = rec.emits.filter((e) => e === 'ai-board-claim').length;
  if (claimBtns.length) guard('认领按钮点击', () => claimBtns[0].dispatch('click'));
  const claimAfter = rec.emits.filter((e) => e === 'ai-board-claim').length;
  ok('09-25 点「我来」发出 ai-board-claim（认领由服务器记账，保证全房一致）',
    claimAfter === claimBefore + 1, `发出次数 ${claimBefore} → ${claimAfter}`);

  /* 快捷问法：必须与手打 @ai 走**完全相同**的信令（不给快捷方式开特例分支）。
   * 断言方式：源码里发 ai-ask 的分支只能有一处（在 sendAiQuestion 里），
   * 若某天有人给 chips 复制了一份发送逻辑，这条会红。 */
  const clientSrc = fs.readFileSync(path.join(PUB, 'client.js'), 'utf8');
  const askEmits = (clientSrc.match(/emit\('ai-ask'/g) || []).length;
  ok('09-25 快捷问法与手打 @ai 共用 sendAiQuestion；09-26b 唤醒词「小明」是合法的第二入口',
    askEmits === 2 && /function sendAiQuestion/.test(clientSrc) && /AI_NICKNAME/.test(clientSrc));

  // 语音播报：默认关（绝不默认出声），且不支持时安全降级
  // ★ 09-27d 取舍演化：用户点名"语音对话"——默认开（格子有醒目开关可关；localStorage 持久化）
  ok('09-27d AI 语音默认开（语音对话的核心；开关可关且 localStorage 持久化）',
    /let aiVoiceOn = true/.test(clientSrc) && /sfuAiVoice/.test(clientSrc));
  ok('09-25 AI 语音有不支持检测（speechSynthesis 缺失时按钮置灰，不做"点了没反应"）',
    /SPEECH_OK/.test(clientSrc) && /ai-voice-na/.test(clientSrc));
  ok('09-25 AI 语音会先洗掉 markdown 再念（不念出星号与表格竖线）',
    /function speakableText/.test(clientSrc) && /\\\*\\\*\(\[\^\*\]\*\)\\\*\\\*/.test(clientSrc));

  /* ---- ★ 2026-10-02 "AI 后来不出声"的两条死锁：钉住**接线形状** ----
   * ▎为什么这里只能断言源码（诚实交代）：冒烟桩里没有 speechSynthesis、也没有 Audio 元素，
   *   真播放分支走不到——所以行为级覆盖放在 `npm run test:asr-live` 的"语音交付"断言里
   *   （那条真的检查"声明了 tts:'server' 就必须给出 ai-audio 或 ai-tts-fail"）。
   *   这里钉的是形状：让位闸必须有例外、回落必须带 force、队列与销账时机必须成立——
   *   这几条错一条，用户侧症状都是同一个"它答应了却没声音"（且没有任何报错）。 */
  ok('2026-10-02 让位闸留了例外口（ai-tts-fail 的回落不再被自己挡住）',
    /function speakAiText\(text, \{ force = false(, answerTs)? \} = \{\}\)/.test(clientSrc) &&  /* 2026-10-03 加了可选 answerTs：浏览器朗读也要量延迟 */
    /* ★ 2026-10-03f：这一行现在还要记一笔"为什么没说"（noteVoiceGate('server-yield')），
     *   判据跟着改成"带例外口 **且** 带观测计数"——例外口本身没动，别误以为放松了。 */
    /if \(aiTtsEnabled && !force\) \{ noteVoiceGate\('server-yield'\); return; \}/.test(clientSrc));
  ok('2026-10-02 回落调用真的带 force: true（不带走闸等于白回落）',
    /* 2026-10-03：回落调用现在还额外带 answerTs（浏览器这一轨也要量延迟），
     *   所以判据改成"两处回落都带 force 且都带轮次锚点"——比原来更严，不是放松。 */
    (clientSrc.match(/speakAiText\(t, \{ force: true, answerTs: [^}]+ \}\)/g) || []).length >= 2);
  ok('2026-10-02 服务端音频走顺序队列（按句流水线分段到达，不再互相掐）',
    /const serverTtsQueue = \[\]/.test(clientSrc) && /function playNextServerTts/.test(clientSrc));
  ok('2026-10-02 销账时机=真的开始播（onplaying），取不到文件有 onerror 回落',
    /\.onplaying =/.test(clientSrc) && /\.onerror =/.test(clientSrc));
  ok('2026-10-02 打断(hush)会清空待播队列并释放 busy（不留"永远不播"的新死锁）',
    /serverTtsQueue\.length = 0;[\s\S]{0,80}serverTtsBusy = false;/.test(clientSrc));
  /* ---- ★ 2026-10-02 第二次实修："回答的时候不说话"的**另一半**根因 ----
   * ▎第一半（让位闸挡死回落）已在上面钉住；这一半更隐蔽：hush 之后开的 8 秒静默窗
   *   把**这次提问的答案**也一起吞了。真实时序 = 「用户说完 → 字幕到达(hush,开窗)
   *   → 1.5~6s 后答案的音频到达」——答案永远落在自己开的窗里，且 pendingServerTts
   *   的回落账本被顺手销掉 = 既没有服务端声音、也没有浏览器兜底、还没有任何报错。
   * ▎修法与坑 47 同源："认人别认时间"——拉黑的是**被打断那一轮答案的 ts**
   *   （同一轮流水线分段共用 ts），新一轮是新 ts，天然放行；不依赖两端时钟对齐。 */
  ok('2026-10-02 打断改成按 ts 拉黑"那一轮"（新一轮答案不再被静默窗吞掉）',
    /const serverTtsDropped = new Set\(\)/.test(clientSrc) &&
    /serverTtsDropped\.has\(ts\)/.test(clientSrc) &&
    /serverTtsDropped\.add\(serverTtsPlayingTs\)/.test(clientSrc));
  ok('2026-10-02 时间窗只作"段没带 ts"时的兜底（不再当主判据）',
    /Date\.now\(\) < serverTtsIgnoreUntil/.test(clientSrc) &&
    /\? serverTtsDropped\.has\(ts\)\s*:\s*Date\.now\(\) < serverTtsIgnoreUntil/.test(clientSrc));
  /* ▎浏览器那一轨同源问题：抢话闸曾用"2.5s 内到过字幕"，后来收到 700ms 仍然误杀——
   *   因为"字幕刚到"说明的是**1~3 秒前**有人在说话，而答案恰恰总是紧跟在自己的字幕
   *   后面 1~3 秒到达（每轮必撞闸）。唯一能代表"此刻在说"的信号是麦克风（130ms 级）。
   *   字幕窗只保留给"根本没有麦克风可量"的场景（拒绝授权/无设备/另一台设备在说话）。 */
  ok('2026-10-02 抢话闸以麦克风即时信号为主判据（字幕只在无麦克风时兜底）',
    /* ★ 2026-10-03f：这条判据原先在 speakAiText 与 speakStreamPart 里**各写一份内联三元**，
     *   而 asr-caption 处理器里还留着第三种（更错的）用法——拿滞后的字幕当"此刻在说话"。
     *   现在收口成 humanTalkingNow() 一个函数（坑 47：一个概念只有一个来源），
     *   所以断言同时要求"新函数在"与"旧的内联写法已经绝迹"。 */
    /function humanTalkingNow\(\) \{[\s\S]{0,200}aiHush\.analyser[\s\S]{0,140}lastMicVoiceTs[\s\S]{0,140}lastUserSpeechTs/.test(clientSrc) &&
    !/const talkingNow = aiHush\.analyser/.test(clientSrc));
  ok('2026-10-02 看门狗持续量麦克风（不再只在 AI 说话时才量——那样"此刻在说"根本拿不到）',
    /* 判据拆成两条小断言，不再用"隔 1200 字符"那种脆距离（2026-10-03f 给回声本底加了
     *   一段注释，距离就漂了——**距离型断言一旦要靠调数字才通过，它已经在说谎**）。
     *   ① 采样语句在 `const speaking = aiIsSpeaking()` **之前** → 量麦不以"AI 在说话"为前提；
     *   ② 掐话仍包在 `if (speaking)` 里 → AI 没出声时没什么可掐（不会白清队列）。 */
    /aiHush\.analyser\.getFloatTimeDomainData\(aiHush\.buf\);[\s\S]{0,900}?const speaking = aiIsSpeaking\(\)/.test(clientSrc) &&
    /if \(speaking\) \{\s*\n\s*lastUserSpeechTs = Date\.now\(\);\s*\n\s*hushAiSpeech\(\);/.test(clientSrc));
  /* ══ 2026-10-03f「听不见声音」那一轮的防回退断言 ═════════════════════════
   *   用户第 N 次反馈"听不见声音 / 延迟很大"。取证结果：
   *     · 真实会议（房间 603646）字幕定稿延迟 中位 3.9s / p90 7.3s / 最大 8.2s
   *       ——比文档里写的 1.4~2.5s 差得多，说明"受控自测过了"≠"真人节奏下也够快"；
   *     · 播报相关埋点 **0 条**（asr-wake-answer 却有 193 条）→ 为什么没出声无从判断；
   *     · 根因在 asr-caption 处理器里那句**无条件** hushAiSpeech()：
   *       asrSegmentSec=2 把一句话切成 2~3 条字幕、相隔 1~2 秒到达，AI 跟着第一条开始念，
   *       第二条到达时用户早已闭嘴 1.5 秒，照样被掐 + 整轮 ts 被拉黑 = 这一轮彻底无声，
   *       而气泡上写着"0.1s 后开口"（onstart 真的来过）。
   *   ▎冒烟桩里没有 speechSynthesis / Audio（见 1363 行的诚实交代），所以这一组只能断源码形状；
   *   ▎"声音真的出来了"要真浏览器 + 环回采集，那是 test:e2e-media 的活（见路线图任务 #3）。 */
  ok('2026-10-03f 字幕到达不再无条件掐播报（本轮根因那一行）',
    /if \(aiIsSpeaking\(\) && humanTalkingNow\(\)\) hushAiSpeech\(\);/.test(clientSrc) &&
    /* 负向判据要**精确钉那一处旧代码块**：原先写成"lastUserSpeechTs 赋值后紧跟 hush"，
     *   结果误伤了看门狗里那条正确的调用（它外面包着 if (speaking)）——
     *   断言过宽会把"对的"也判成红的，和本项目反复讲的"边界要划在问题上"同一条。 */
    !/ai-bot\/i\.test\(name \|\| ''\)\) \{\s*\n\s*lastUserSpeechTs = Date\.now\(\);\s*\n\s*hushAiSpeech\(\);/.test(clientSrc));
  ok('2026-10-03f 打断要两条判据同时成立（AI 真在出声 + 麦克风此刻真有人声）',
    /function aiIsSpeaking\(\)[\s\S]{0,320}serverTtsBusy/.test(clientSrc) &&
    /voiceTrace\.saved\+\+/.test(clientSrc));   // "字幕到了但人没在说"救回来的次数 = 这条修复的触发证据

  /* ══ ★ 2026-10-04 「等一轮再说」：抢话闸从"永久丢弃"改成"排队等对方说完" ══════
   * ▎怎么发现的：把 e2e-asr 里那行"未采到 🔊 读数，不判失败"的 console.log 提成断言，
   *   第一次跑就红了，计数摆出真相：asked=1 / started=0 / gated.talking-now=1 ——
   *   **判据没错，处置错了**：用户此刻在说话确实不该插嘴，但直接 return 等于这一轮
   *   答案的声音永远不会出现，而气泡上明明写着答案。这正是用户报的"它答应了却不说话"。
   * ▎所以这组断言钉的是"丢了"变成"等了"：等到了要真的念（resumed），等不到要留下计数
   *   （turn-timeout），而不是像以前那样静默消失。 */
  ok('47 抢话闸不再永久丢弃这一轮（speakAiText 里没有"命中闸就 return"的旧形状）',
    /function waitForTurnThen\(/.test(clientSrc) &&
    !/noteVoiceGate\('talking-now'\); return;/.test(clientSrc) &&
    /if \(humanTalkingNow\(\)\) \{ waitForTurnThen\('answer', speakNow\); return; \}/.test(clientSrc));
  ok('47 排队链路有触发证据（deferred / resumed / turn-timeout 三个计数都在）',
    /voiceTrace\.deferred \+= 1/.test(clientSrc) && /voiceTrace\.resumed \+= 1/.test(clientSrc) &&
    /noteVoiceGate\(`turn-timeout-/.test(clientSrc));
  {
    /* 行为断言：真把 run() 排进去、真在"对方说完"那一刻跑出来（桩里跑的是真计时器）。
       ▸ 判据窗口是 700ms（humanTalkingNow 的无麦克风兜底），所以"说完"必须**显式**
         把时间戳清零来表达 —— 靠等 700ms 让它自然过期是在跟边界赛跑，
         第一版就是这么写的，结果 ran=0 时红时绿。 */
    const before = vm.runInContext('voiceTrace.deferred', ctx);
    vm.runInContext('ranAfterWait = 0; aiHush.analyser = null; lastUserSpeechTs = Date.now();' +
      ' waitForTurnThen("spec", function () { ranAfterWait = (ranAfterWait || 0) + 1; });', ctx);
    ok('47 有人正在说时：立刻计数 deferred，但**不当场开口**',
      vm.runInContext('voiceTrace.deferred', ctx) === before + 1 && vm.runInContext('ranAfterWait', ctx) === 0);
    vm.runInContext('lastUserSpeechTs = 0;', ctx);      // 对方说完了
    await new Promise((r) => setTimeout(r, 600));       // 轮询间隔 400ms，留一拍余量
    ok('47 对方说完之后：排着的那一句真的念了出来（resumed +1 且回调真执行）',
      vm.runInContext('ranAfterWait', ctx) === 1 && vm.runInContext('voiceTrace.resumed', ctx) >= 1,
      `ran=${vm.runInContext('ranAfterWait', ctx)}`);
    /* 反面对照：新一轮等待要作废上一轮的等待（"只说最新"），否则用户问到第三句时
       机器还在补第一句的话 —— 那比不出声更烦人。 */
    vm.runInContext('ranAfterWait = 0; lastUserSpeechTs = Date.now();' +
      ' waitForTurnThen("a", function () { ranAfterWait = 1; });' +
      ' waitForTurnThen("b", function () { ranAfterWait = 2; });', ctx);
    vm.runInContext('lastUserSpeechTs = 0;', ctx);
    await new Promise((r) => setTimeout(r, 600));
    ok('47 后到的那一轮会作废前一轮的等待（只说最新，不排成长队）',
      vm.runInContext('ranAfterWait', ctx) === 2, `ran=${vm.runInContext('ranAfterWait', ctx)}`);
    /* 等不到时不能静默消失：超时要留下一个可查的计数（"为什么没出声"的第 N 种答案）。
       ▸ 这一条第一版写错了：我在等满 6s 之前就把时间戳清零了，于是"认输"永远不发生、
         断言恒红——**测超时就得让"对方一直在说"这个前提真的持续整个预算期**。 */
    vm.runInContext('ranAfterWait = 0; lastUserSpeechTs = Date.now() + 999999;' +
      ' waitForTurnThen("c", function () { ranAfterWait = 1; });', ctx);
    await new Promise((r) => setTimeout(r, 6600));      // 预算 6s + 一拍轮询余量
    ok('47 对方一直说不停时：到点认输并留下 turn-timeout 计数（不是无声消失）',
      vm.runInContext('ranAfterWait', ctx) === 0 &&
      Object.keys(vm.runInContext('voiceTrace.gated', ctx)).some((k) => /^turn-timeout/.test(k)),
      Object.keys(vm.runInContext('voiceTrace.gated', ctx)).join(','));
    vm.runInContext('lastUserSpeechTs = 0;', ctx);
    await new Promise((r) => setTimeout(r, 800));
    ok('47 认输之后不会又突然开口（放弃是终态，不是"晚点再说"）',
      vm.runInContext('ranAfterWait', ctx) === 0);
    vm.runInContext('aiHush.analyser = null; lastUserSpeechTs = 0; lastMicVoiceTs = 0;', ctx);
  }
  /* ▎行为断言（不是形状断言）：判据抽成纯函数 voiceBargeIn 之后，可以直接拿四组数字问它
   *   "这算不算打断"。这是坑 60 的规矩——控制律不可穷举 = 只能"跑起来看着还行"，
   *   而"声音忽有忽无"在真机上极难复现，等用户报修是最低效的验证方式。 */
  const bargeIn = (peak, floor, speaking) =>
    vm.runInContext(`voiceBargeIn(${peak}, ${floor}, ${speaking})`, ctx);
  ok('2026-10-03f 判据·恒定回声不算打断（外放时 AI 不再掐死自己 = 本轮根因）',
    bargeIn(0.20, 0.20, true) === false && bargeIn(0.30, 0.20, true) === false);
  ok('2026-10-03f 判据·真人明显压过回声仍然算打断（礼仪没丢）',
    bargeIn(0.9, 0.2, true) === true);
  ok('2026-10-03f 判据·AI 静默时用固定阈值（陈旧本底不得抬高无人期的灵敏度）',
    bargeIn(0.06, 0.9, false) === true && bargeIn(0.04, 0, false) === false);
  ok('2026-10-03f 判据·本底还没采到时退回固定阈值（第一轮开口不至于完全失去打断能力）',
    bargeIn(0.2, 0, true) === true);
  ok('2026-10-03f 回声采样窗 500ms（窗开太短=采不到本底=修了等于没修）',
    /const AI_HUSH_ECHO_WINDOW_MS = 500;/.test(clientSrc) &&
    /Date\.now\(\) \+ AI_HUSH_ECHO_WINDOW_MS/.test(clientSrc));
  /* 另外两条"此刻"判据同样做行为断言：它们决定 AI 开不开口、掐不掐，
   *   此前只能靠真机碰运气——而"运气"正是用户反复报"时灵时不灵"的来源。 */
  ok('2026-10-03f humanTalkingNow 只信麦克风的"此刻"（字幕那条仅在无麦时兜底）',
    vm.runInContext(`(function () {
      const bakA = aiHush.analyser, bakM = lastMicVoiceTs, bakU = lastUserSpeechTs;
      try {
        aiHush.analyser = { fake: 1 };
        lastMicVoiceTs = Date.now() - 100; lastUserSpeechTs = 0;
        if (humanTalkingNow() !== true) return 'mic-fresh';
        lastMicVoiceTs = Date.now() - 900;
        if (humanTalkingNow() !== false) return 'mic-stale';      // 字幕再新也不作数
        aiHush.analyser = null;
        lastUserSpeechTs = Date.now() - 100;
        if (humanTalkingNow() !== true) return 'caption-fallback';
        return 'ok';
      } finally { aiHush.analyser = bakA; lastMicVoiceTs = bakM; lastUserSpeechTs = bakU; }
    })()`, ctx) === 'ok');
  ok('2026-10-03f aiIsSpeaking 覆盖两条轨（服务端音频同样能被真人打断）',
    vm.runInContext(`(function () {
      const bak = serverTtsBusy;
      try {
        serverTtsBusy = false;
        if (aiIsSpeaking() !== false) return 'idle';
        serverTtsBusy = true;
        if (aiIsSpeaking() !== true) return 'busy';
        return 'ok';
      } finally { serverTtsBusy = bak; }
    })()`, ctx) === 'ok');
  /* ══ 2026-10-03 第 40 步：开关的运动语言（移植 reactbits BellToggle，零依赖）══════
   *   ▎BellToggle 值得搬的不是"炫"，是三件被它做对的事：① 开/关两套文案叠在同一格交叉淡入
   *   （换状态不跳宽度）；② 按下时从图标支点扩散几圈环 + 图标自己摆一下（把"我按到了"
   *   还给用户）；③ 未读数弹跳而不是无声变化。它是 React 组件，本项目红线零依赖，
   *   所以只搬设计语言：CSS 关键帧（style.css 第 29 节）+ 三个原生 helper。
   *   ▎断言分两层：行为（假 DOM 上真调 helper、数节点）+ 结构（CSS 只能读文件钉住）。
   *   其中"环演完自拆台"这条是**长跑不漏节点**的保证（09-19d detachTileGain 同一条纪律），
   *   而它只有在桩的 remove() 是真的之后才可能被验证——见 DOM 桩那段注释。 */
  const motionCss = fs.readFileSync(path.join(PUB, 'style.css'), 'utf8');
  ok('2026-10-03 第 40 步·ringPulse 造出 N 圈环，带错峰索引与图标支点坐标',
    /* ▎诚实交代覆盖范围：桩的 querySelector 会"自动造元素"（坑 27 家族），
     *   所以这里取的是生产代码拿到的同一个容器对象，能验"造了几圈、参数对不对、
     *   pinged 类有没有加"，但**验不了容器真的挂在按钮上**——
     *   把 querySelector 改诚实会连带打破 11 条依赖"innerHTML 不生成子节点"的老断言
     *   （本轮试过并回退，代价是补一个 HTML 解析器，不属本轮）。
     *   容器挂载与真实观感由真浏览器那条检查兜（scripts/check-toggle-motion.js）。 */
    vm.runInContext(`(function () {
      const b = document.createElement('ringbtn'); b.className = 'btn tgl';
      ringPulse(b, { waves: 3 });
      const layer = b.querySelector('.tgl-rings');
      const rings = layer ? layer.children : [];
      return rings.length === 3 && rings[0].style['--i'] === '0' && rings[2].style['--i'] === '2'
        && /^\\d+(\\.\\d+)?px$/.test(String(rings[0].style['--rx'])) && b.classList.contains('pinged');
    })()`, ctx) === true);
  ok('2026-10-03 第 40 步·环演完自己拆台（三圈全落回后容器清空，长跑不漏节点）',
    vm.runInContext(`(function () {
      const b = document.createElement('ringbtn2'); b.className = 'btn tgl';
      ringPulse(b, { waves: 3 });
      const layer = b.querySelector('.tgl-rings');
      if (!layer || layer.children.length !== 3) return 'no-rings';
      layer.children.slice().forEach(r => r.dispatch('animationend'));
      return layer.children.length === 0 ? 'ok' : 'leak:' + layer.children.length;
    })()`, ctx) === 'ok');
  ok('2026-10-03 第 40 步·环数有上限（连点不会攒出一堆节点）',
    vm.runInContext(`(function () {
      const b = document.createElement('ringbtn3'); b.className = 'btn tgl';
      ringPulse(b, { waves: 99 });
      const layer = b.querySelector('.tgl-rings');
      return layer.children.length === 5;   // 钳到 5（对应 BellToggle 的 ringPasses 上限）
    })()`, ctx) === true);
  ok('2026-10-03 第 40 步·AI 语音按钮改走双层文案，源码里不再 textContent 覆写',
    /setToggleLabels\(btn, 'AI 语音', '会说话'\)/.test(clientSrc) &&
    !/btn\.textContent = aiVoiceOn/.test(clientSrc) &&
    /id="aiVoiceBtn" class="btn tgl"/.test(fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')));
  ok('2026-10-03 第 40 步·未读角标只在"从无到有"弹一次（连续来消息不变成骚扰）',
    vm.runInContext(`(function () {
      const el = $('chatUnread');
      chatUnread = 0; chatUnreadShown = false; renderChatUnread();
      chatUnread = 1; renderChatUnread();
      const firstPop = el.classList.contains('pop');
      el.classList.remove('pop');
      chatUnread = 2; renderChatUnread();
      return firstPop === true && el.classList.contains('pop') === false;
    })()`, ctx) === true);
  ok('2026-10-03 第 40 步·CSS 有环/摆/弹三组关键帧，且 reduced-motion 全部兜掉',
    /@keyframes tglRing/.test(motionCss) && /@keyframes tglSwing/.test(motionCss) &&
    /@keyframes badgePop/.test(motionCss) &&
    /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,300}\.tgl-ring \{ display: none; \}/.test(motionCss));
  ok('2026-10-03 第 40 步·双层文案叠在同一格（切换不跳宽度），环不吃点击',
    /\.tgl-txt > span \{[\s\S]{0,120}grid-area: 1 \/ 1/.test(motionCss) &&
    /\.tgl-rings \{[^}]*pointer-events: none/.test(motionCss));
  /* ══ 2026-10-03 第 41 步：AI 思考条（移植 reactbits ThoughtLine，零依赖）════════
   *   ▎这一节最重要的一条是**接线**：服务器从 09-30 起就在 ai-state 里带 phase，
   *   客户端 setAiState 也留了第三个参数，但监听器只解构 {state, text} ——
   *   于是"正在翻会议记录…"这类有信息量的阶段提示**从上线起一次都没显示过**。
   *   两边代码单看都对，只有"端到端能看到那句话"的断言抓得到（坑 56 第五次）。
   *   呼吸/微光/折叠这些 CSS 层的东西由 npm run check:think 在真浏览器里量 getComputedStyle。 */
  ok('2026-10-03f 第 41 步·ai-state 监听器把 phase 解构出来并传下去（根因那条）',
    /socket\.on\('ai-state', \(\{ state, text, phase \}\) => setAiState\(state, text, phase\)\)/.test(clientSrc) &&
    !/socket\.on\('ai-state', \(\{ state, text \}\) => setAiState\(state, text\)\)/.test(clientSrc));
  ok('2026-10-03f 第 41 步·状态文案不再 textContent 覆写徽标（那会连思考条子树一起清掉）',
    !/label\.textContent = thinkLabel/.test(clientSrc) &&
    /tlPhase\(thinkLabel \|\| AI_STATE_LABEL\.thinking\)/.test(clientSrc));
  ok('2026-10-03f 第 41 步·阶段去重（同一 phase 反复上报不攒清单）',
    vm.runInContext(`(function () {
      const tile = document.createElement('aitile');
      buildThinkLine(tile);
      tlStart(); tlPhase('正在翻会议记录…'); tlPhase('正在翻会议记录…'); tlPhase('换个说法再找…');
      const n = tlLine.steps.length;
      tlReset();
      return n;
    })()`, ctx) === 2);
  ok('2026-10-03f 第 41 步·清单有上限（一场长会反复问答不能无限攒节点）',
    vm.runInContext(`(function () {
      const tile = document.createElement('aitile2');
      buildThinkLine(tile);
      tlStart();
      for (let i = 0; i < 40; i++) tlPhase('阶段' + i);
      const n = tlLine.steps.length;
      tlReset();
      return n;
    })()`, ctx) === 6);
  ok('2026-10-03f 第 41 步·定稿必撤计时器并折叠清单（不停 interval = 每轮问答漏一个）',
    vm.runInContext(`(function () {
      const tile = document.createElement('aitile3');
      buildThinkLine(tile);
      tlStart(); tlPhase('正在翻会议记录…');
      const running = tlLine.timer !== 0 && tlLine.working === true;
      tlStop();
      return running && tlLine.timer === 0 && tlLine.working === false && tlLine.open === false;
    })()`, ctx) === true);
  ok('2026-10-03f 第 41 步·格子消失时思考条连引用一起松手（不留死节点）',
    /tlLine\.tile = null;/.test(clientSrc) && /tlReset\(\);/.test(clientSrc));
  ok('2026-10-03f 第 41 步·CSS 有呼吸/扫光/脉冲三组关键帧且 reduced-motion 兜掉',
    /@keyframes tlBreath/.test(motionCss) && /@keyframes tlShimmer/.test(motionCss) &&
    /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,400}\.tl-pulse \{ animation: none/.test(motionCss));
  /* ══ 2026-10-03 第 42 步：登录页光标辉光（移植 reactbits GlowCursor，裸 WebGL）══════
   *   ▎这一组断言钉的是两个**零报错的静默失败**：
   *     ① 顶点 stride 写成 8*4（应为 4*4）→ 三角形退化成垃圾，画面全黑、控制台干净；
   *     ② 监听挂在 #prejoin 上，而登录时鼠标停在 .auth-overlay（它的兄弟节点）→ 永远收不到事件。
   *   两个都只能靠真浏览器读像素发现（scripts/check-glow-trail.js），这里补结构断言防回退。 */
  ok('2026-10-03f 第 42 步·顶点 stride 按"每顶点 4 个 float"算（错一位就整幅空白且零报错）',
    /const STRIDE_FLOATS = 4;/.test(clientSrc) &&
    /gl\.vertexAttribPointer\(loc, size, gl\.FLOAT, false, STRIDE_FLOATS \* 4, offset \* 4\)/.test(clientSrc));
  ok('2026-10-03f 第 42 步·指针事件挂 window（登录卡是 prejoin 的兄弟，挂 host 收不到）',
    /window\.addEventListener\('pointermove', onMove\)/.test(clientSrc) &&
    !/host\.addEventListener\('pointermove', onMove\)/.test(clientSrc));
  ok('2026-10-03f 第 42 步·数组 uniform 兼容 uPoints[0] 取法（取不到是静默 no-op）',
    /getUniformLocation\(prog, k \+ '\[0\]'\)/.test(clientSrc));
  ok('2026-10-03f 第 42 步·减弱动态与无 WebGL 都不起 rAF；进会必停（后台烧 GPU 没人看得见）',
    /prefers-reduced-motion/.test(clientSrc.split('function initGlowTrail')[1].slice(0, 900)) &&
    /if \(glowTrail\) glowTrail\.stop\(\);/.test(clientSrc) &&
    /canvas\.setAttribute\('data-off', ''\)/.test(clientSrc));
  ok('2026-10-03f 第 42 步·顶层调用在文件最末尾且 try 包住（坑 69：一断全断）',
    clientSrc.lastIndexOf('glowTrail = initGlowTrail') > clientSrc.lastIndexOf('initHero();') &&
    /try \{\s*\n?\s*glowTrail = initGlowTrail/.test(clientSrc));
  /* ══ 2026-10-04i 第 42b 步：第一屏（登录卡）也挂一条辉光轨 + 两条轨的启停总闸 ══════
   *   ▎用户原话："第一个界面要有第二个页面那个滑动光线的效果，要自然"。
   *     真相是 #prejoin 那条一直画得好好的，但 .auth-overlay 是**实底**背景把它 100% 盖住——
   *     与此同时 window 级 pointermove 还在驱动它：既看不见、又白烧 GPU。
   *   ▎修法 = 登录卡自己挂一条（同一个 initGlowTrail 实现）；启停由 syncGlowTrails 总闸管，
   *     判据只有一处来源（两遮罩的 .hidden 状态），接线走 MutationObserver
   *     （不散点改 5 处调用点——漏一处就是"进会后还在烧 GPU"/"收起登录卡光没了"的静默失败）。 */
  ok('2026-10-04i 第 42b 步·第一屏（登录卡）自己挂一条辉光轨（auth-overlay 实底曾把 prejoin 那条整个盖住）',
    /authGlowTrail = initGlowTrail\(\$\('authOverlay'\)/.test(clientSrc) &&
    clientSrc.lastIndexOf('authGlowTrail = initGlowTrail') > clientSrc.lastIndexOf('initHero();') &&
    /try \{\s*\n?\s*authGlowTrail = initGlowTrail/.test(clientSrc));
  ok('2026-10-04i 第 42b 步·两条轨由 syncGlowTrails 总闸治理（判据=两遮罩 .hidden 单一来源）',
    /function syncGlowTrails\(\)/.test(clientSrc) &&
    /!authOverlay\.classList\.contains\('hidden'\)/.test(clientSrc) &&
    /!prejoinEl\.classList\.contains\('hidden'\)/.test(clientSrc) &&
    /if \(wantAuth\) authGlowTrail\.start\(\); else authGlowTrail\.stop\(\);/.test(clientSrc) &&
    /if \(wantPrejoin\) glowTrail\.start\(\); else glowTrail\.stop\(\);/.test(clientSrc));
  ok('2026-10-04i 第 42b 步·接线走 MutationObserver 盯两个遮罩的 class（散点接线漏一处=静默故障）',
    /typeof MutationObserver === 'function'/.test(clientSrc) &&
    /new MutationObserver\(\(\) => \{ try \{ syncGlowTrails\(\); \}/.test(clientSrc) &&
    /glowMo\.observe\(authOverlay, \{ attributes: true, attributeFilter: \['class'\] \}\)/.test(clientSrc) &&
    /glowMo\.observe\(prejoinEl, \{ attributes: true, attributeFilter: \['class'\] \}\)/.test(clientSrc));
  ok('2026-10-04i 第 42b 步·登录屏画布走负 z-index：光在实底背景之上、登录卡之下（绘制顺序=背景→负层→内容）',
    /\.auth-overlay > \.hero-trail \{ z-index: -1; \}/.test(motionCss));
  guard('2026-10-04i 第 42b 步·总闸三态行为（登录屏只跑 auth 轨 / 收起后只跑 prejoin 轨 / 进会都停）', () => {
    // 桩里两条轨都是 null（无 WebGL）；注入假对象直接驱动总闸——备份现场、跑三态、原样恢复
    const bAuth = vm.runInContext('authGlowTrail', ctx);
    const bPre = vm.runInContext('glowTrail', ctx);
    const origAuthHidden = vm.runInContext("!!(authOverlay && authOverlay.classList.contains('hidden'))", ctx);
    const origPreHidden = vm.runInContext("!!(prejoinEl && prejoinEl.classList.contains('hidden'))", ctx);
    const setHidden = (v, on) => vm.runInContext(
      `${v} && ${v}.classList.${on ? "add('hidden')" : "remove('hidden')"}`, ctx);
    const runs = [];
    vm.runInContext(`(() => {
      const mk = () => ({ _run: false, start() { this._run = true; return true; }, stop() { this._run = false; } });
      authGlowTrail = mk(); glowTrail = mk();
    })()`, ctx);
    setHidden('authOverlay', false); setHidden('prejoinEl', false);
    vm.runInContext('syncGlowTrails()', ctx);          // 登录屏：auth 在上
    runs.push(vm.runInContext('authGlowTrail._run === true && glowTrail._run === false', ctx));
    setHidden('authOverlay', true);
    vm.runInContext('syncGlowTrails()', ctx);          // 收起登录卡：只剩 prejoin
    runs.push(vm.runInContext('authGlowTrail._run === false && glowTrail._run === true', ctx));
    setHidden('prejoinEl', true);
    vm.runInContext('syncGlowTrails()', ctx);          // 进会：都停（后台烧 GPU 没人看得见）
    runs.push(vm.runInContext('authGlowTrail._run === false && glowTrail._run === false', ctx));
    // 现场恢复：class 原样 + 真对象换回（将来桩若有 WebGL 也不会被这组断言破坏）
    setHidden('authOverlay', origAuthHidden);
    setHidden('prejoinEl', origPreHidden);
    ctx.__glowBA = bAuth; ctx.__glowBP = bPre;
    vm.runInContext('authGlowTrail = __glowBA; glowTrail = __glowBP; delete __glowBA; delete __glowBP;', ctx);
    ok('2026-10-04i 第 42b 步·总闸三态行为：登录屏只跑 auth 轨 / 收起后只跑 prejoin 轨 / 进会都停',
      runs[0] && runs[1] && runs[2], `runs=${JSON.stringify(runs)}`);
  });
  ok('2026-10-03f 品牌已改为「云会议」，可见处不再出现旧名',
    /<div class="auth-title">云会议<\/div>/.test(idxHtml) &&
    /<div class="brand-name">云会议<\/div>/.test(idxHtml) &&
    !/简易腾讯会议/.test(idxHtml));
  /* ══ 2026-10-03 第 43 步：胶囊"液体上涨"hover（移植 reactbits PillNav，零依赖）══════
   *   ▎原组件用 GSAP 时间轴驱动一个**解出来的圆**：R=((w²/4)+h²)/(2h)，圆从按钮底部正中涨起，
   *   弧面恰好经过底边两角。移植做法：几何由 JS 算成 CSS 变量、动画交给 CSS transition
   *   （hover/focus-visible/:disabled 全部由 CSS 状态机管，JS 不再监听 mouseenter）。
   *   ▎桩里没有布局也没有 CSS 引擎，所以这里只断"公式与结构"；
   *   **圆到底盖没盖住顶角、过渡是不是真的有中间态**由 npm run check:pill 在真浏览器里量。 */
  ok('2026-10-03f 第 43 步·几何按原组件同款公式解（R/D/delta/originY 一个来源）',
    /const R = \(\(w \* w\) \/ 4 \+ h \* h\) \/ \(2 \* h\);/.test(clientSrc) &&
    /const delta = Math\.ceil\(R - Math\.sqrt\(Math\.max\(0, R \* R - \(w \* w\) \/ 4\)\)\) \+ 1;/.test(clientSrc) &&
    /set\('--pr-origin', D - delta\)/.test(clientSrc));
  ok('2026-10-03f 第 43 步·CSS 消费的是同一批变量（不在两处各算一份）',
    /width: calc\(var\(--pr-d, 0\) \* 1px\)/.test(motionCss) &&
    /transform-origin: 50% calc\(var\(--pr-origin, 0\) \* 1px\)/.test(motionCss) &&
    /bottom: calc\(var\(--pr-delta, 0\) \* -1px\)/.test(motionCss));
  ok('2026-10-03f 第 43 步·pillRise 幂等且建出"圆 + 两层文字"（重复调用不长第二套）',
    vm.runInContext(`(function () {
      const b = document.createElement('pillbtn'); b.className = 'pill solid';
      pillRise(b); pillRise(b);
      const circles = b.children.filter(c => String(c.className).split(/\\s+/).includes('pill-rise__circle')).length;
      const stacks = b.children.filter(c => String(c.className).split(/\\s+/).includes('pill-rise__stack')).length;
      const stack = b.children.find(c => String(c.className).split(/\\s+/).includes('pill-rise__stack'));
      return b.classList.contains('pill-rise') && circles === 1 && stacks === 1
        && stack.children.length === 2 && Number(b.style.getPropertyValue('--pr-d')) > 0;
    })()`, ctx) === true);
  ok('2026-10-03f 第 43 步·尺寸变了要重解（resize + 字体加载完成 + 兜一次延时）',
    /window\.addEventListener\('resize', remeasure\)/.test(clientSrc) &&
    /document\.fonts\.ready\.then\(remeasure\)/.test(clientSrc));
  ok('2026-10-03f 第 43 步·减弱动态下不涨圆（改底色给反馈），且时长是有意偏离原版的 2s',
    /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,300}\.pill-rise__circle \{ display: none/.test(motionCss) &&
    /--pr-dur, \.62s/.test(motionCss));
  /* ══ 2026-10-03f 「ASR_QWEN_LOCAL=0 让服务器启动即自杀」的防回退断言 ══
   *   跑本轮回归时按文档推荐的并行配法起服务器（AGENTS 坑 76：显存争用时关掉本地引擎），
   *   结果它 1 秒内 uncaughtException 退出：`getQwenLocalAsr().warm()` 对 null 调方法。
   *   ▎讽刺点在于这条配法本身就是为"别再抢显存"写的——排障工具把服务弄死了。
   *   ▎根因是三个读者两套口径：asrEngineMode()/serverAsrEngineLabel() 不看那个开关，
   *     只有 getQwenLocalAsr() 看（坑 47）。修法：判据收口成 qwenLocalUsable()，
   *     调用点改用"先拿实例、拿到才 warm"。 */
  const serverSrc2 = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'server.js'), 'utf8');
  ok('2026-10-03f qwen-local 预热不再对 null 调方法（启动即自杀那条）',
    /const qAsrWarm = getQwenLocalAsr\(\);/.test(serverSrc2) &&
    /if \(asrEngineMode\(\) === 'qwen-local' && qAsrWarm\)/.test(serverSrc2) &&
    !/getQwenLocalAsr\(\)\.warm\(\)/.test(serverSrc2) &&
    !/getQwenLocalAsr\(\)\.device/.test(serverSrc2));
  ok('2026-10-03f 「qwen-local 此刻可用」判据只有一个来源（label 与预热共用，坑 47）',
    /function qwenLocalUsable\(\)/.test(serverSrc2) &&
    /if \(m === 'qwen-local'\) return qwenLocalUsable\(\)/.test(serverSrc2) &&
    (serverSrc2.match(/ASR_QWEN_LOCAL === '0'/g) || []).length === 1);
  ok('2026-10-03f 关掉本地引擎时不打"落 whisper/无转写"这种未收敛的结论（坑 67/71）',
    /以下面那行 🎙 服务端转写 与 \/config\.json 为准/.test(serverSrc2) &&
    !/字幕落 \$\{WHISPER/.test(serverSrc2));
  ok('2026-10-03f 回声本底只在 AI 出声期间有效（静默与撤岗都清零，不留陈旧读数）',
    (clientSrc.match(/voiceTrace\.echoFloor = 0;/g) || []).length >= 2);
  ok('2026-10-03f 播报有触发计数（为什么没出声从此看得见，坑 76）',
    /const voiceTrace = \{/.test(clientSrc) &&
    /window\.__SFU_AI_VOICE__ = voiceTrace/.test(clientSrc) &&
    /voiceTrace\.started\+\+/.test(clientSrc) &&
    /voiceTrace\.killed\+\+/.test(clientSrc) &&
    (clientSrc.match(/noteVoiceGate\('/g) || []).length >= 5);
  ok('2026-10-02 服务器 ASR 启动日志说真话（主引擎名 + whisper 只是兜底）',
    /主引擎 = \$\{primary\}/.test(fs.readFileSync(path.join(__dirname, '..', 'sfu', 'server.js'), 'utf8')));
  /* ▎浏览器界面上那行"由本机 whisper 识别"是**用户唯一看得见的引擎声明**，
   *   而它当时是硬编码的——引擎早已切成 qwen-local，界面还在说 whisper。
   *   用户据此判断"没切换成功"，这一行字比任何后端日志都有说服力（坑 67 的 UI 版）。 */
  ok('2026-10-02 界面不再硬编码引擎名（状态/提示/日志三处都取 /config.json 的 asrEngine）',
    /function asrEngineCn\(\)/.test(clientSrc) &&
    /renderCapStatus\(`服务器转写（\$\{asrEngineCn\(\)\}）`/.test(clientSrc) &&
    /showToast\(`服务端转写已开启[\s\S]{0,60}\$\{asrEngineCn\(\)\}/.test(clientSrc) &&
    /log\(`💬 已启用服务端转写[\s\S]{0,80}\$\{asrEngineCn\(\)\}/.test(clientSrc) &&
    /serverAsrEngine = String\(cfg\.asrEngine/.test(clientSrc));
  /* ---- ★ 2026-10-02 流式答案"按句上嘴"：朗读不再等整段写完 ----
   * ▎为什么这是一条真缺口而不是锦上添花：ai-stream 每 12 字就吐一次增量，但增量只进
   *   气泡不上嘴——一定要等终态 chat-message 才开口。长答案 LLM 要写 3~8 秒，
   *   用户听到的"它答应了却半天没声"里有一段就是这么攒的（与服务器上 makeSpeakPipeline
   *   同一个思路，这一刀落在浏览器那一轨）。
   * ▎断言按"接线"来写（坑 56 的老账：模块写对了、调用方没接）：
   *   ① delta 分支真的调了 speakStreamPart；② 追加路径绝不 cancel（自己掐自己上一句）；
   *   ③ 终态只补尾巴且前缀对不上时退回整段（宁重不漏）；④ 队列只有一条泵在跑。 */
  ok('2026-10-02 流式增量真的接上了按句朗读（不是写了个没人调的函数）',
    /speakStreamPart\(box, box\.rawAll\)/.test(clientSrc));
  /* ▎本轮最隐蔽的一处：DOM 增量渲染用的是**攒批后会被清空**的 box.buf（applyStreamBuf
   *   刷完就 box.buf = ''）。朗读若也读这个缓冲，永远只能看到一帧内的三五个字，
   *   句末标点根本不可能出现 → 函数写得完全正确、调用点也接上了，**但永远无事发生**。
   *   判据：账本与攒批缓冲必须是两个变量。 */
  ok('2026-10-02 朗读读的是不被消费的全文副本（rawAll），不是攒批后会清空的 buf',
    /box\.rawAll = \(box\.rawAll \|\| ''\) \+ delta;/.test(clientSrc) &&
    /speakStreamPart\(box, box\.rawAll\)/.test(clientSrc) &&
    !/speakStreamPart\(box, box\.buf\)/.test(clientSrc));
  /* ▎泵按"代"作废：cancel 掉的那一句会**迟到地**回调 onerror，若它动到新队列，
   *   表现就是"第一轮问候语念完之后 AI 再也不出声"——一个只有真机跑得出来的死法。 */
  ok('2026-10-02 朗读泵有代号，旧泵回调不会动新队列',
    /let aiSpeakGen = 0/.test(clientSrc) &&
    /const gen = \+\+aiSpeakGen/.test(clientSrc) &&
    /if \(gen !== aiSpeakGen\) return;/.test(clientSrc));
  /* ▎?nosw=1 是"排障开关"，可它自己写成了 `location.reload()`——reload **保留查询串**，
   *   于是下一次加载又命中同一个条件 → 每 400ms 刷一次页面。**排障工具变成故障源**
   *   是最糟的一类 bug（用户为了"看看是不是缓存的锅"点开它，然后就再也关不掉了）。 */
  ok('2026-10-02 一轮答案的第一句"只说最新"（旧寒暄不会把新答案堵在队尾）',
    /const firstOfThisAnswer = !box\.spokeFirst;/.test(clientSrc) &&
    /enqueueAiSpeech\(say, \{ replace: firstOfThisAnswer(, answerTs: box\.id)? \}\)/.test(clientSrc));
  /* ★ 2026-10-04 这条钉的是"轮次锚点必须取得到"：speakStreamPart(box, rawBuf) 里没有
   *   id 这个变量，写 answerTs: id 就是 ReferenceError —— 真浏览器控制台抓到三次
   *   （流式每切出一整句抛一次），而冒烟/信令全绿。
   *   ▎为什么冒烟当时测不出来：桩里 speakStreamPart 只在"流式 + 有完整一句"时才走到那一行，
   *     而断言集里没有一个用例同时满足这两个条件 —— **没被执行到的行，语法对也没用**。
   *     所以补这条结构断言，另配 npm run check:console 在真浏览器里点一遍。 */
  ok('2026-10-04 流式朗读的轮次锚点取自 box（不是作用域里不存在的 id）',
    !/answerTs: id\b/.test(clientSrc) && /answerTs: box\.id/.test(clientSrc) &&
    /box = \{ node, nameEl, textEl, timeEl, id \}/.test(clientSrc));
  /* ▎记账位必须推进：不推进 = 每个增量都把同一句重新入队（症状是"AI 鬼打墙一样重复半句"，
   *   与本轮用户投诉的"一直收到重复的一句话"字面一样，但根因完全不同）。 */
  ok('2026-10-02 朗读记账位会推进（spokenChars = cut，不会同一句重念）',
    /box\.spokenChars = cut;/.test(clientSrc) &&
    (clientSrc.match(/box\.spokenChars = cut;/g) || []).length >= 2);
  ok('2026-10-02 ?nosw=1 不再自我循环（跳回去掉 nosw 的地址，其余参数保留）',
    /location\.replace\(location\.pathname \+ \(keep \? '\?' \+ keep : ''\)/.test(clientSrc) &&
    !/setTimeout\(\(\) => location\.reload\(\), 400\)/.test(clientSrc));
  /* ★ 2026-10-04 这个排障开关还有一层自我伤害：**每次**带 ?nosw=1 打开都会跳一趟，
   *   而全部界面检查都按坑 40 的纪律带着它开头 → 每次测量都在跟自己那趟导航赛跑
   *   （check:dock 连开 11 台浏览器时 1920/1280/1152 轮流红，报的都是"target navigated"）。
   *   干净 profile 下没有 SW 也没有缓存，那一趟跳转什么都换不来。
   *   ▸ 形状断言 + 行为哨兵在 check:dock 里（它数"页面停稳轮了几轮"）。 */
  ok('2026-10-04 ?nosw=1 只在真的清掉了东西时才重载（没得可清就别自己跳）',
    /const cleared = regs\.length \+ keys\.length;/.test(clientSrc) &&
    /if \(!cleared\) \{/.test(clientSrc));
  /* ---- ★ 2026-10-02 "一直弹这个"：模态框 + 永不作废的 myRoom = 无限弹窗 ----
   * ▎用户实测被原生 alert 循环卡住：服务器重启 → 房间（内存结构）没了 →
   *   D6 自动重连拿旧 myRoom 再 join → room-not-found → alert 阻塞主线程 →
   *   点确定 → 又重连 → 又弹。两个错叠加：① 用**阻塞式模态**报一个会重复发生的事件；
   *   ② `myRoom` 从来没有作废路径（进过房就永远自认为在房里）。
   * ▎断言按"结构上不可能再循环"来写：room-not-found 里必须出现 giveUpRoom（清 myRoom），
   *   且全文件不再有任何 alert( 调用。 */
  ok('2026-10-02 房间类提示不再用阻塞式 alert（模态框会把重连状态机冻在中间）',
    (clientSrc.match(/\balert\s*\(/g) || []).length === 0);
  /* ▎为什么把 Mesh 对照版一起测：这是本项目自己写下的纪律（坑 57）——
   *   "同项目同一个坑只修一半 = 半迁移 = 等于没修"。
   *   弹窗循环那次只修了 sfu/，根目录 Mesh 版仍是旧行为；
   *   断言只盯主版本，就会让对照版长期带着同一个 bug 漂移。 */
  const meshSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'client.js'), 'utf8');
  ok('2026-10-03 Mesh 对照版同步：两版都不许有阻塞式 alert（半迁移=没迁移）',
    (meshSrc.match(/\balert\s*\(/g) || []).length === 0 &&
    /function giveUpRoom\(why\)/.test(meshSrc) &&
    /if \(myRoom\) \{[\s\S]{0,300}?giveUpRoom\(/.test(meshSrc));
  ok('2026-10-02 「房间没了」是一次状态迁移（清 myRoom + 回加入页），不是一句提示',
    /function giveUpRoom\(why\)/.test(clientSrc) &&
    /if \(myRoom\) \{[\s\S]{0,300}?giveUpRoom\(/.test(clientSrc) &&
    /myRoom = null;/.test(clientSrc));

  /* ---- ★ 2026-10-10 B4「只有正向没有反向」：客户端三处撤销 + 一条结构红线 ----
   * ▎这一组的形状与第 52 步（退出登录）完全一样：动作写得很完整，反面一行没写。
   *   三条都是**行为断言**（真的调状态、真的读回来），不是"源码里有那行字"——
   *   源码断言挡不住"写了但没接到正确位置"（坑 41/56 那一族已经栽过太多次）。 */
  {
    /* ① 拉黑要有解禁。名单键是 socket.id，而 blockedPeers 原先只有 add 没有 delete ⇒
     *   单向门；同时"拉黑之后那一行的样子"也从来没人重绘过（拉黑的是本地状态，
     *   服务器不知道，不会广播 room-state，所以不主动重画就一直不出现）。 */
    vm.runInContext('blockedPeers.add("peer-block-me")', ctx);
    emit('room-state', {
      roomNumber: '123456',
      members: [{ id: socketStub.id, owner: true }, { id: 'peer-block-me', name: '被拉黑的' }],
      hostId: null, controllerId: null, expiresAt: null,
    });
    const rows = (documentStub.getElementById('memberList').children || []).filter((r) => r.dataset && r.dataset.id === 'peer-block-me');
    const unBtn = rows.length && (rows[0].children || []).find((c) => String(c.className).includes('m-unblock'));
    ok('B4 ★ 拉黑之后成员行出现「解禁」（单向门的第一半：让撤销看得见）',
      !!unBtn, `rows=${rows.length} btn=${unBtn && unBtn.textContent}`);
    if (unBtn) unBtn.click();
    ok('B4 ★ 点「解禁」真的把 TA 从名单里删掉（不是只藏了按钮）',
      vm.runInContext('blockedPeers.has("peer-block-me")', ctx) === false);
    /* ▸ 判据按"那颗按钮的处理器函数体"取，而不是按"两行之间隔了多少字符"：
     *   中间夹的教学注释长度会变，用窗口长度当判据迟早红成一次假故障（坑 96 那条"量具跟自己赛跑"的文字版）。 */
    const blockHandler = (clientSrc.match(/remoteBlockBtn\.addEventListener\('click', \(\) => \{[\s\S]*?\n\}\);/) || [''])[0];
    ok('B4 拉黑这条动作路径会主动重绘成员列表（本地状态服务器不广播，不重绘就一直不出现）',
      /blockedPeers\.add\(who\)/.test(blockHandler) && /renderMembers\(lastMembers\)/.test(blockHandler),
      `handlerLen=${blockHandler.length}`);
    /* ② 房间作废要把挂着的"待回落朗读账"一起销掉。
     *   每笔账都配了一根 20s 的客户端保险丝，而它只认"账在不在"、不认"房间在不在"——
     *   所以不销账的后果是：人已经退回加入页，20 秒后 AI 在首页把死房间里那条答案念出来。 */
    vm.runInContext('myRoom = "123456"; pendingServerTts.set(Date.now(), "死房间里的一条答案");', ctx);
    emit('room-not-found', { roomNumber: '123456' });
    ok('B4 ★ 房间作废时挂着的回落朗读账被清空（否则 20s 保险丝会在加入页朗读死房间的答案）',
      vm.runInContext('pendingServerTts.size', ctx) === 0);
    /* ③ 每路音量那本 localStorage 账要有上限：键是 socket.id，而 socket.id 每次连接都换，
     *   所以它天然只会攒"再也不会被读到的条目"——原来那句注释甚至声称"换场会还认得"（过期声明）。 */
    vm.runInContext('for (let i = 0; i < 80; i++) rememberVolume("peer" + i, 0.5);', ctx);
    ok('B4 音量账有上限（键是每次连接都换的 socket.id，不剪就只涨不清）',
      vm.runInContext('Object.keys(storedVolumes()).length', ctx) <= 60,
      `条数=${vm.runInContext('Object.keys(storedVolumes()).length', ctx)}`);
    /* ④ 结构红线：不许再有"写了没人读"的存储键。
     *   `sfuLastRoom` 就是这么活下来的——一行 setItem，全仓库零个读者；
     *   它真正的问题是**看起来像**一个机制（下一个人会以为死房号被记住了，于是去依赖它）。
     *   ▸ 判据跑在**剥掉块注释**的源码上：我在原地留的那段教训注释里就写着这个键名，
     *     不剥注释的话这条红线会被自己的教训判红（坑 103 那条"注释也会打脸断言"的第三次应验）。 */
    ok('B4 结构红线：client.js 的代码里不许出现只写不读的 sfuLastRoom（本轮清掉的死键）',
      !/sfuLastRoom/.test(clientSrc.replace(/\/\*[\s\S]*?\*\//g, '')));
  }
  /* ---- ★ 2026-10-02 首页 hero 化（第 35 步 + style.css 第 28 节）----
   * ▎这一屏改的是"用户第一眼"，所以断言盯三件最容易坏的事：
   *   ① **id 契约**：打字机与胶囊是新东西，但 pjEnterBtn/pjFxBtn 这些老 id 一旦被"顺手改名"，
   *      client.js 与既有断言会一起瞎（本项目前端契约就是 id）；
   *   ② **零依赖红线**：参考稿靠外链视频 + 外链字体，本项目是离线 PWA——
   *      所以"页面里不许出现任何外链资源"要有一条测试钉住，不然哪天有人"照抄回来"就破功了；
   *   ③ **裁剪 + 垂直居中的组合**：实测把文案顶到 y=-101 过（放不进就必须能滚）。 */
  const heroHtml = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  const heroCss = fs.readFileSync(path.join(PUB, 'style.css'), 'utf8');
  ok('2026-10-02 hero 结构在位且老 id 契约未破（pjEnterBtn/pjFxBtn/preVideo… 一个都不能改名）',    /id="heroTyped"/.test(heroHtml) && /id="heroCaret"/.test(heroHtml) && /id="heroPills"/.test(heroHtml) &&
    ['pjEnterBtn', 'pjFxBtn', 'preVideo', 'pjCamSelect', 'pjMicSelect', 'pjMeterBar', 'pjStatus']
      .every((id) => heroHtml.includes('id="' + id + '"')));
  ok('2026-10-02 零依赖红线：首页不引入任何外链资源（字体/视频一律本地或 CSS）',
    !/(href|src)\s*=\s*["']https?:\/\//i.test(heroHtml) &&
    !/@import\s+url\(|url\(["']?https?:/i.test(heroCss));

  /* ---- ★ 2026-10-03b 语音识别"时灵时不灵"的三个服务器侧结构断言 ----
   * ▎来源：test:e2e-asr（真浏览器假麦克风）抓到的真缺陷。行为级复现要控引擎探测时序，
   *   成本太高；这里用源文本钉住关键结构，防回退：
   *   ① 耳朵竞态：管线启动先等"任意转写能力"就绪——不再拿 attach 瞬间的 WHISPER
   *     探测结果定终身（否则服务器刚启动就进会的人，耳朵永远哑，零报错）；
   *   ② 句内去重：重复/碎片片段不再无条件拼进同一句（账本不再被抢跑半截污染）。
   *      ★ 2026-10-05 升级：从"双向 isDupOrFragment 三分支"换成 **mergeTranscript
   *      纯函数归并**（旧三分支把"封口后更全的版本"判成碎片吞掉：「把白板打」+「把白板打开」
   *      → 丢「开」）。断言随之改钉新契约——调用点 + 实现 + 导出**三半成对**
   *      （同 source-screen 那套"有两半缺一不可"的纪律；本文件自己踩过断言慢半拍的账）。
   *   ③ 静音确认即成句：说完 → 字幕定稿不再白等 1.5s 成句间隙（e2e 实测 7.7s→2.2s）。 */
  const asrServerSrc = fs.readFileSync(path.join(PUB, '..', 'server.js'), 'utf8');
  const asrModSrc = fs.readFileSync(path.join(PUB, '..', 'ai', 'asr.js'), 'utf8');
  ok('语音竞态：听觉管线等转写能力就绪再定形态（aiAsrCapableNow 谓词 + 等待循环）',
    /function aiAsrCapableNow\(\)/.test(asrServerSrc) && /while \(!aiAsrCapableNow\(\)/.test(asrServerSrc));
  ok('语音竞态：等待判据与形态判定共用同一个谓词（一个概念只有一个来源）',
    /if \(aiAsrCapableNow\(\)\)/.test(asrServerSrc));
  ok('语音去重：句内累积走 mergeTranscript 归并（调用点 + 实现 + 导出三半成对）',
    /Asr\.mergeTranscript\(u\.text, text\)/.test(asrServerSrc) &&
    /function mergeTranscript\(accRaw, segRaw\)/.test(asrModSrc) &&
    /^\s+mergeTranscript,/m.test(asrModSrc));
  ok('语音延迟：静音确认即成句（同一段静音不判两次）',
    /silenceConfirmed = lastVoiceTs && now - lastVoiceTs > FLUSH_MS/.test(asrServerSrc));
  ok('语音预热：qwen-local warm 含首次空推理（第一句字幕不再付 11s 推理图初始化）',
    /qwen-asr-warm-/.test(fs.readFileSync(path.join(PUB, '..', 'ai', 'asr_qwen_local.js'), 'utf8')));

  /* ---- ★ 2026-10-04h 续会识别 + 字幕搜索 + 页面外通知（结构断言防回退） ----
   * ▎背景：用户报"跟 AI 对话一段时间字幕断了"（端口落动态区已修，见坑/10-04g）；
   *   顺藤补上"重启不失忆"三件套与两条体验项。 */
  ok('续会：create-room 接受原号续开（6 位校验 + 被占明确拒绝，绝不静默换号）',
    /const wanted = String\(want \|\| ''\)\.trim\(\);/.test(asrServerSrc) &&
    /if \(rooms\.has\(wanted\)\).*?房间.*?已存在/.test(asrServerSrc));
  ok('续会：账本时间线回溯定会议起点（间隔 10 分钟 / 新鲜度 30 分钟双闸）',
    /const RESUME_GAP_MS = 10 \* 60000;/.test(asrServerSrc) &&
    /const RESUME_FRESH_MS = 30 \* 60000;/.test(asrServerSrc) &&
    /function meetingStartFromLedger/.test(asrServerSrc));
  ok('续会：Brain 会话记忆从账本回放 + 看板一次性重建（重启不失忆）',
    /function rebuildBrainFromLedger/.test(asrServerSrc) &&
    /getRoomBoard[\s\S]{0,600}?b\.ingest\(caps\)/.test(asrServerSrc));
  ok('续会：客户端退房自动填回原号 + 建房带上 roomNumber（原号续开入口）',
    /resumeRoomNumber = gone \|\| null;/.test(clientSrc) &&
    /roomNumber: want \}/.test(clientSrc));
  ok('字幕搜索：历史抽屉有搜索框（过滤本地账本 + 命中计数 + 无匹配提示）',
    /id="capSearchInput"/.test(fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')) &&
    /function capEntryMatches/.test(clientSrc) &&
    /capSearchCount/.test(clientSrc));
  ok('页面外通知：AI 回答在后台时走系统通知（权限搭 AI 语音开关的便车，致辞不打扰）',
    /function notifyAiAnswer/.test(clientSrc) &&
    /Notification\.permission !== 'granted'/.test(clientSrc) &&
    /大家好，我是会议 AI 助理\|已接入/.test(clientSrc));
  ok('端口段：AI 听觉 26000 起 + 录制 27000 起（都在 Windows 动态区 49152+ 之外）',
    /ASR_PIPE_PORT_BASE = Number\(process\.env\.ASR_PIPE_PORT_BASE\)\s*\|\|\s*Number\(CONFIG\.asrPipePortBase\) \|\| 26000/.test(asrServerSrc) &&
    /const RECORD_BASE_PORT = 27000;/.test(asrServerSrc));
  ok('2026-10-02 打字机与 CTA 是两条独立时间线（胶囊 400ms 出现，不等打字打完）',
    /setTimeout\(\(\) => \{ if \(pills\) pills\.classList\.add\('shown'\); \}, 400\)/.test(clientSrc) &&
    /startDelay = 600/.test(clientSrc));
  ok('2026-10-02 减弱动效降级：全文直出 + 光标节点不进 DOM（动效不能变成读不到的门槛）',
    /heroReducedMotion\(\)[\s\S]{0,220}?el\.textContent = text;[\s\S]{0,120}?caret\.remove\(\)/.test(clientSrc) &&
    /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,400}?\.hero-pills \{ transition: none/.test(heroCss));
  ok('2026-10-02 hero 分层照表（氛围 0 / 内容 1 / 文案 10 / 顶栏 20），且放不下必须能滚',
    /\.hero-bg \{[^}]*z-index: 0/.test(heroCss) && /\.hero \{[\s\S]{0,80}?z-index: 1/.test(heroCss) &&
    /\.hero-copy \{[^}]*z-index: 10/.test(heroCss) && /\.hero-nav \{[\s\S]{0,40}?z-index: 20/.test(heroCss) &&
    /\.prejoin \{[\s\S]{0,160}?overflow: auto/.test(heroCss));
  /* ---- ★ 2026-10-02 第 36 步：AI 操作会议实体（跨文件一致性）----
   * ▎这是本项目反复踩到的**"内层算出来了、外层没带出来"**（坑 56）的新变体：
   *   服务器 ROOM_ACTIONS 有 6 个动作，客户端 room-control 表如果少写一个分支，
   *   表现是"AI 说它做了、界面毫无反应"，而**两边各自的测试都会绿**。
   *   所以这里断的是**两个集合相等**，不是"客户端有处理逻辑"。
   * ▎另一半是边界守卫：这张表**绝不能**出现动用户设备的动作。 */
  const srvSrc = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'server.js'), 'utf8');
  /* ★ 2026-10-05：三张表搬到 sfu/ai/roomActions.js（纯函数才能拿电池穷举断言）。
   *   这条"两张表一一对应"的断言**读的必须是新文件**——继续读 server.js 会解析到空串，
   *   于是 srvActions=[] → 长度门槛失败（红得对），但更糟的是若哪天有人把门槛也放宽，
   *   它会变成"空集合 === 空集合"的**假绿**（坑 65 家族：断言读错了对象比读不到更危险）。 */
  const roomActSrc = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'ai', 'roomActions.js'), 'utf8');
  const srvActions = (roomActSrc.match(/const ROOM_ACTIONS = \{([\s\S]*?)\n\};/) || [, ''])[1]
    .split('\n').map((l) => (l.match(/^\s*'([a-z-]+)'\s*:/) || [])[1]).filter(Boolean);
  const rcBlock = (clientSrc.match(/socket\.on\('room-control'([\s\S]*?)\n\}\);/) || [, ''])[1];
  /* ★ 2026-10-06 去重：这个闭包里现在有**两处**提到动作名——执行分支（8 条）与
   *   回执的"期望态"表（6 条状态型动作）。断言的本意是"两边的动作**集合**相等"，
   *   不是"每条只出现一次"，所以取 Set（不去重会让一条正确实现被判红）。 */
  const cliActions = [...new Set((rcBlock.match(/action === '([a-z-]+)'/g) || []).map((s) => s.replace(/.*'([a-z-]+)'.*/, '$1')))];
  ok('2026-10-02 服务器白名单与客户端处理表**一一对应**（少一个分支=AI 说了但没做）',
     srvActions.length >= 8 &&
     srvActions.slice().sort().join(',') === cliActions.slice().sort().join(','));
  ok('2026-10-02 房间级动作表里没有"动用户设备/动别人内容"的事（摄像头/共享/静音别人一律不走这条路）',
     /* ★ 2026-10-07 改动：禁的是**动词**，不是"file"这个子串。
      *   ▎原来那份名单里写的是 `file`，本意是"发文件给某人"（A4 那套点对点传输，
      *   AI 没有别人的 socket 可发，属于越权）。而第 51 步的 files-open 是
      *   **打开房间级的文件面板**——它是合法的房间级共享状态，却被那个子串一起禁掉了。
      *   ▸ 这就是"用子串表达语义"的代价：它挡的范围永远比你想的大一点，
      *     而多挡的那部分要等到有人做对功能时才发现（表现为一条莫名其妙的红）。
      *   ▸ 现在钉的是真正危险的那几个动作：碰设备、碰别人的内容、碰权限。 */
     !/camera|screen|share|mute|kick|clipboard|upload|download|delete|send|remove|record/i
       .test(srvActions.join(',')) &&
    /record/i.test(srvSrc));   // 断言本身有效的前提：这个正则真的能命中"录制"这类词（防变量名写错把断言变成空转）
  /* ★ 2026-10-07 共享文件这条线上，AI 只能开/关面板，**不能**碰内容与权限。
   *   单独钉一条，免得将来有人"顺手"把 files-upload / files-delete 加进白名单——
   *   上传是往这场会里塞内容、删除有"只有上传者/房主能删"的门禁，两者都不是房间级开关。 */
  ok('2026-10-07 共享文件只开放"面板开关"两个动作（上传/删除带内容与权限，不走这条路）',
    srvActions.filter((a) => /^files-/.test(a)).sort().join(',') === 'files-close,files-open',
    srvActions.filter((a) => /^files-/.test(a)).join(','));
  /* ▎录制为什么也**不在**这张表里（有意为之，不是漏掉）：record-start 有角色门禁
   *   （游客不能录），而 AI 本身没有身份角色——让它直接开录等于给它越权，
   *   与 C1「授权绝不豁免」是同一条纪律。所以 record 单独钉一条，防止将来"顺手加上"。 */
  ok('2026-10-03 房间动作表不含录制（AI 没有角色，不能替人越权录制）',
    !/record/i.test(srvActions.join(',')));

  /* ★★ 2026-10-08 这条是本轮最值钱的一条红线：**客户端那条 C1 入口正则不许把房间动作抢走**。
   *   ▎真缺陷（从 09-19g 活到今天，用户报了五次"AI 操控实体还是实现的不行"，这是其中一条成因）：
   *   ▎  `sendAiQuestion` 里原先写的是 `/^(操作|打开|点击|帮我操作|远程)/`——只看句首动词。
   *   ▎  于是「@ai 打开白板」「@ai 打开共享文件面板」在**客户端**就被改发成 `ai-op`
   *   ▎  （远程操作别人电脑那条链路），房间里没有被控端时服务器回一句
   *   ▎  "先有人共享屏幕并打开「允许远程协助」…"——界面一个字没动，而那句回话听起来完全正常。
   *   ▎为什么所有测试都没抓到：电池与 e2e 用的说法恰好全是「把白板打开」「开启实时字幕」
   *   ▎  「切到宫格」，**没有一条以"打开"开头**（坑 106：一条只会绿的电池测的是记忆不是能力）。
   *   ▸ 判据换成"提到哪台机器 × 要做什么动作"两条各管一半（见 client.js 那三条常量）。
   *   ▸ 这里断的是**三件事**，缺一都会留洞：
   *     ① 服务器每条动作的中文名（就是 AI 自己说出口的那句）不被截走；
   *     ② 一批自然说法不被截走（含"打开 + 房间实体"这个最危险组合）；
   *     ③ **正例必须仍然走 ai-op**——只断"不截走"会把这条链路整个堵死而全绿。
   *   ▸ 正则从 client.js **源码里抓**，不在测试里重抄一份（重抄的那份漂了就是假绿，坑 47）。 */
  const opReLits = ['AI_OP_CTX_RE', 'AI_OP_VERB_RE', 'AI_OP_EXPLICIT_RE'].map((n) => {
    const m = clientSrc.match(new RegExp('const ' + n + ' = (/(?:[^/\\\\]|\\\\.)*/[a-z]*)'));
    return m ? m[1] : null;
  });
  ok('2026-10-08 三条 C1 入口正则都从 client.js 里抓到了（抓不到=改名了，下面的判断会空转）',
    opReLits.every(Boolean), JSON.stringify(opReLits.map((x) => x || '(未抓到)')));
  const OP_CTX = eval('(' + opReLits[0] + ')');
  const OP_VERB = eval('(' + opReLits[1] + ')');
  const OP_EXPLICIT = eval('(' + opReLits[2] + ')');
  const hijackedByOperator = (q) => OP_EXPLICIT.test(q) || (OP_CTX.test(q) && OP_VERB.test(q));
  /* 服务器那份 ROOM_ACTIONS 的 cn：AI 回话里就是这几个字，它们被截走=说了没做。 */
  const actionNames = (roomActSrc.match(/'([a-z-]+)'\s*:\s*\{\s*cn:\s*'([^']+)'/g) || [])
    .map((s) => (s.match(/cn:\s*'([^']+)'/) || [])[1]).filter(Boolean);
  const stolenNames = actionNames.filter(hijackedByOperator);
  ok('2026-10-08 ★ 服务器每个房间动作的中文名都不会被客户端的 C1 入口截走（说了没做的源头之一）',
    actionNames.length >= 10 && stolenNames.length === 0,
    `抓到 ${actionNames.length} 个名字，被截走：${stolenNames.join(',') || '无'}`);
  const roomPhrases = ['打开白板', '打开共享文件面板', '打开文件面板', '把白板打开', '开启实时字幕',
    '切到演讲者视图', '关闭文件面板', '共享资料那块弄出来', '打开实时白板', '把字幕关掉', '撤销白板那一笔'];
  const stolenPhrases = roomPhrases.filter(hijackedByOperator);
  ok('2026-10-08 ★ 房间动作的自然说法（含最危险的"打开 + 房间实体"）一条都不被截走',
    stolenPhrases.length === 0, stolenPhrases.join('、') || '全部 ok');
  const opPhrases = ['在他电脑上打开记事本', '打开他电脑上的计算器', '帮我操作', '远程控制一下', '操作那台机器'];
  const missedOps = opPhrases.filter((q) => !hijackedByOperator(q));
  ok('2026-10-08 ★★ 反向对照：真正要操作别人电脑的说法**仍然**走 ai-op（只堵不疏=把 C1 整条链路弄没了）',
    missedOps.length === 0, missedOps.join('、') || '全部仍走 ai-op');
  /* 第三头：客户端不截走之后，服务器**得真的认**这些说法——
   *   否则只是把"静默不做"从一个地方搬到另一个地方（坑 76：机制在≠机制生效）。 */
  const RA51 = require(path.join(__dirname, '..', 'sfu', 'ai', 'roomActions.js'));
  const notDetected = roomPhrases.filter((q) => !RA51.detectRoomActions(q).length);
  ok('2026-10-08 ★★ 两头都要认：客户端放过之后，服务器规则确实把这些说法读成动作',
    notDetected.length === 0, notDetected.join('、') || '全部读到动作');

  /* 执行回执：报的是**"要的状态现在成没成"**，不是"我有没有动手"，也不是"我收到了"。
   * ▎2026-10-06 这条从结构断言升级成**行为断言**（直接驱动 room-control 回调、读 emit 出去的载荷）。
   *   旧写法 `/ok: !!done/.test(clientSrc)` 会把"白板本来就开着时那句 ⚠️ 没人执行"
   *   的瞎报**永久锁死**——断言在保护一个错的判据，这比没有断言更糟（坑 91 附带教训：
   *   "要求变好"的假断言是假红制造机；这里是"要求变精确"的反面样本）。
   * ▸ 三种情形各钉一条：动作生效 / 状态本来就对（不许报失败）/ 未知动作（必须报失败，
   *   它是"服务器表与本表漂移"的唯一运行时信号）。 */
  rec.roomControlAcks.length = 0;
  emit('room-control', { action: 'board-open' });      // 白板是关着的 → 真的执行
  emit('room-control', { action: 'board-open' });      // 第二次已经开着 → 没动手，但状态成立
  emit('room-control', { action: 'captions-off' });    // 字幕本来就关着 → 同上
  emit('room-control', { action: 'camera-off' });      // 白名单外的动作 → 必须算没执行
  const acks = rec.roomControlAcks;
  ok('2026-10-06 回执逐条对齐：执行/本来就是这个状态/未知动作，三种情形报得各不相同',
    acks.length === 4 &&
    acks[0].action === 'board-open' && acks[0].ok === true &&
    acks[1].action === 'board-open' && acks[1].ok === true &&
    acks[2].action === 'captions-off' && acks[2].ok === true &&
    acks[3].action === 'camera-off' && acks[3].ok === false,
    `实收：${acks.map((a) => `${a.action}=${a.ok}`).join(' ')}`);
  emit('room-control', { action: 'board-close' });     // 收尾：把白板恢复成关，别影响后面的断言
  ok('收尾：board-close 也回执 ok:true（白板真的恢复了，不是"发了个事件没人管"）',
    ((rec.roomControlAcks[rec.roomControlAcks.length - 1] || {}).action) === 'board-close' &&
    rec.roomControlAcks[rec.roomControlAcks.length - 1].ok === true);
  /* ★ 2026-10-07 第 51 步：AI 开/关共享文件面板——**行为**断言（界面真的动了），
   *   不是"回复措辞像做了"。这正是用户反复说"操控实体不行"时真正缺的那一类证据。 */
  // 注意：这里不能用第 51 步那个块里的 g()（它是块级 const，在这儿还没进作用域）
  vm.runInContext('setFilesOpen(false);', ctx);
  rec.roomControlAcks.length = 0;
  emit('room-control', { action: 'files-open', byName: 'AI 小明' });
  ok('2026-10-07 「files-open」真的把共享文件面板打开了（不是只回了句话术）',
    vm.runInContext('filesOn', ctx) === true && !documentStub.getElementById('filesOverlay').classList.contains('hidden'));
  emit('room-control', { action: 'files-open' });      // 第二次：已经开着 → 没动手但状态成立
  ok('2026-10-07 面板已开着再收到 files-open → 不许报"没人执行"（误报的告警比沉默更糟）',
    rec.roomControlAcks.length === 2 && rec.roomControlAcks[1].ok === true,
    JSON.stringify(rec.roomControlAcks.map((a) => `${a.action}=${a.ok}`)));
  emit('room-control', { action: 'files-close' });
  ok('2026-10-07 「files-close」真的收起面板，并顺手把跟随关掉（与用户点关闭同一条路径）',
    vm.runInContext('filesOn', ctx) === false && vm.runInContext('filesFollow', ctx) === false);
  vm.runInContext('setFilesFollow(true);', ctx);
  /* ★ 2026-10-05 判据换成**下标比较**：原来用 `[\s\S]{0,400}?classifyIntent` 这种
   *   "字符距离"当"顺序"的代理——今天往中间插了一段越界拒绝逻辑（+14 行）就把一条
   *   **顺序仍然正确**的断言判红了。距离是易碎量，顺序才是本意（坑 53 同一条：
   *   判"够不够格"的量要尺度无关）。 */
  const iRoute = srvSrc.indexOf('const roomActions = detectRoomActions(q);');
  const iIntent = srvSrc.indexOf("intent: 'room-action'");
  const iDeny = srvSrc.indexOf('detectOutOfScopeCommand(q)');
  const iCls = srvSrc.indexOf('await Brain.classifyIntent(q)');
  ok('2026-10-02 动作路由排在 LLM 之前，且真的带 room-action 意图回执（不只是调了函数）',
     iRoute > -1 && iCls > -1 && iRoute < iIntent && iIntent < iCls);
  ok('2026-10-05 越界拒绝也排在 LLM 之前、且在动作路由之后（先做能做的，再明确拒不该做的）',
     iDeny > iRoute && iDeny < iCls);
  ok('2026-10-02 中文规则把"关"排在"开"前面判（否则「把白板关掉」会命中"打开白板"）',     (() => {
       const rules = (roomActSrc.match(/const ROOM_ACTION_RULES = \[([\s\S]*?)\n\];/) || [, ''])[1];
       return rules.indexOf('board-close') > -1 && rules.indexOf('board-close') < rules.indexOf('board-open') &&
              rules.indexOf('captions-off') > -1 && rules.indexOf('captions-off') < rules.indexOf('captions-on');
     })());
  /* ★ 2026-10-06 「说了没做」的看门狗必须**按房间挂**（这一条行为断言抓不到，只能钉结构）。
   *   ▎第一版我写成"比全局计数 COLLAB.roomApplied 有没有涨"——单房测试全绿，
   *     但两间房同时开白板时 A 房的回执会把 B 房的告警一起消掉，于是真实部署里
   *     **告警永远不响**。test:sfu 那组两相断言只有一间房，测不出这个差别，
   *     所以这里用结构断言把"键里必须带房间号"钉住（坑 66：清理动作的作用域比它看起来更大）。 */
  ok('2026-10-06 看门狗按「房间|动作」挂账，撤销走 clearTimeout 而不是比全局计数',
    srvSrc.includes('const pendingRoomActionAcks = new Map();') &&
    srvSrc.includes('const ackKey = `${roomNumber}|${action}`;') &&
    srvSrc.includes('const key = `${socket.roomNumber}|${action}`;') &&
    srvSrc.includes('clearTimeout(timer);'));
  ok('2026-10-06 房间销毁时把这一房未回执的看门狗一起收走（destroyRoom 的"定时器全清"约定）',
    srvSrc.includes('for (const [key, timer] of pendingRoomActionAcks)'));
  /* ---- ★ 2026-10-04 语音答案与 @ai 答案必须同构（用户截图：同一句答案出现两条气泡、
   *   名字一条「AI 助理」一条「AI 小明」）----
   * ▎根因不在前端：服务器语音通路把终态 chat-message 的 `streamId` 写死成 undefined，
   *   前端靠 streamId 判"这一轮增量已经渲染过了"，拿不到就再插一条气泡。
   * ▎断言放在服务器源码侧，因为**这是通路之间的一致性**，前端行为断言抓不到"服务器没发"。 */
  ok('2026-10-04 语音应答的终态带 streamId（不带就会与流式气泡各留一条 = 用户看到的重复刷屏）',
    !/streamId:\s*undefined/.test(srvSrc) &&
    (srvSrc.match(/from: 'ai-bot', name: 'AI 小明'[\s\S]{0,400}?streamId,/g) || []).length === 2);
  ok('2026-10-04 两条通路的披露信息共用同一份实现（证据链文案与 ai 元信息不再各写一遍）',
    /function aiTraceParts\(r\)/.test(srvSrc) && /function aiAnswerMeta\(r\)/.test(srvSrc) &&
    /* 各 3 次 = 1 处定义 + 2 处调用（@ai 与语音两条通路）。写成 >=2 会放过"只有一条通路接上"。 */
    (srvSrc.match(/aiTraceParts\(r\)/g) || []).length === 3 &&
    (srvSrc.match(/aiAnswerMeta\(r\)/g) || []).length === 3 &&
    !/const traceParts = \[\]/.test(srvSrc));
  ok('2026-10-04 AI 的名字在前端也只有一个来源（流式气泡不再写死「AI 助理」）',
    /function aiBotName\(\)/.test(clientSrc) &&
    (clientSrc.match(/aiBotName\(\)/g) || []).length >= 2 &&
    !/innerHTML = ICONS\.bot \+ '<span>AI 助理<\/span>/.test(clientSrc));


  /* ---- ★ 2026-10-03 屏幕共享补 simulcast（会议本体的最后一处单层上传）----
   * ▎摄像头 09-11 就分了三档、服务器 ABR 的守卫是 `layerCount>1`，
   *   而共享一直是**单层全分辨率**——弱网观众只能"卡成幻灯片或什么都看不见"二选一。
   *   这是坑 47"同一个概念只能有一个来源"的另一面：分层这件事摄像头有、共享没有，
   *   两套口径长期漂移。断言按"真的把 encodings 传下去了"来写（坑 56 的接线纪律）。 */
  ok('2026-10-03 屏幕共享走三层 simulcast（把 encodings 真的传进 produce）',
    /const SCREEN_SIMULCAST_ENCODINGS = \[/.test(clientSrc) &&
    /track: screenTrack,\s*encodings: SCREEN_SIMULCAST_ENCODINGS,/.test(clientSrc));
  ok('2026-10-03 共享分层有单层兜底（协商失败不能把共享整个弄没）',
    /屏幕分层协商失败[\s\S]{0,200}?sendTransport\.produce\(\{ track: screenTrack/.test(clientSrc));
  ok('2026-10-03 共享码率档高于摄像头（屏幕是文字线条，压狠了看不清等于没共享）',
    Number((clientSrc.match(/SCREEN_SIMULCAST_ENCODINGS = \[[\s\S]*?maxBitrate: (\d+), scaleResolutionDownBy: 1/) || [, '0'])[1]) >
    Number((clientSrc.match(/SIMULCAST_ENCODINGS = \[[\s\S]*?maxBitrate: (\d+), scaleResolutionDownBy: 1/) || [, '0'])[1]));
  /* ---- ★ 2026-10-03 白板持久化（第 26d 步的下游）----
   * ▎实时笔迹仍走 SCTP（延迟一点没变），只有"画完的一笔"报给服务器记账。
   *   这里钉的是两件事：① **别把中间的 draw 点也复制一份到信令上**
   *   （那就是把刚按帧合并掉的流量原样退回 300 倍，坑 58 刚修过的东西）；
   *   ② 恢复画布时**颜色要再校验一次**——账本来自服务器，但服务器数据同样不可信任到
   *   可以直接拼进 strokeStyle 的程度（双端各一道闸，任何一道漏了另一道兜住）。 */
  ok('2026-10-03 白板只上报"整笔/撤销/清空"，不逐点上报（否则等于把 SCTP 流量复制进信令）',
    /if \(op === 'end'\) \{[\s\S]{0,400}?socket\.emit\('board-record'[\s\S]{0,200}?op: 'stroke'/.test(clientSrc) &&
    /else if \(op === 'undo' \|\| op === 'clear'\) \{\s*socket\.emit\('board-record', \{ op \}\);/.test(clientSrc) &&
    !/op: 'draw'/.test(clientSrc));
  ok('2026-10-03 恢复白板时颜色再校验一次（服务器数据也不许直接拼进 strokeStyle）',
    /socket\.on\('board-state'[\s\S]{0,700}?\/\^#\[0-9a-fA-F\]\{3,8\}\$\/\.test\(String\(s\.color/.test(clientSrc) &&
    /socket\.on\('board-state'[\s\S]{0,900}?redrawBoard\(\)/.test(clientSrc));
  /* ▎色板 09-19e 改成 {v,n} 之后，初值漏了 `.v`：`ctx.strokeStyle = 对象` 被浏览器**静默忽略**，
   *   于是"进白板的第一笔永远是黑的"，点过一次色点又正常 —— 只有真去读账本才发现。
   *   钉法：白板这条路上所有会流进 strokeStyle 的颜色，初值与兜底都必须是 `.v`。 */
  ok('2026-10-03 白板颜色初值与兜底都是 hex 字符串（strokeStyle 收到对象会被静默忽略）',
    /let boardColor = BOARD_COLORS\[0\]\.v;/.test(clientSrc) &&
    /return BOARD_COLORS\[h % BOARD_COLORS\.length\]\.v;/.test(clientSrc));
  /* ▎观测面板也要有守卫：它的"沉默故障"是**整块新指标不显示**，
   *   而这恰好是最不容易被发现的一类（没有报错、旧数字还在）。 */
  const dashSrc = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'dashboard.html'), 'utf8');
  ok('2026-10-03 观测面板渲染语音与协作四组新指标（且 collab 缺失时不炸）',
    /const cb = data\.collab \|\| \{\}/.test(dashSrc) &&
    /转写引擎/.test(dashSrc) && /AI 应答次数/.test(dashSrc) &&
    /房间动作/.test(dashSrc) && /白板归档笔数/.test(dashSrc));
  /* ---- ★ 2026-10-03 密钥分域（补掉 AGENTS 写着的最后一条诚实边界）----
   * ▎"一把密钥只干一件事"。房间令牌与录像签名过去共用主密钥，
   *   任何一处被攻破另一处一起塌。现在各派生一把子密钥。
   * ▎断言为什么是结构式的：跨域拒绝这件事**没法只靠 HTTP 造出来**
   *   （要能拿旧密钥签一个合法 payload，就等于已经攻破密钥了）。
   *   能钉住的是三条真实的形状：① 每次 HMAC 都必须显式带 key（漏一个参数就会
   *   静默用错密钥，而 Node 不会报错）；② 两个用途字符串必须不同；
   *   ③ 过渡期的双验必须**先试新域再试旧密钥**（反过来会让新令牌走旧路径校验）。 */
  ok('2026-10-03 密钥分域：每次 HMAC 都显式带密钥（漏参数会静默用错密钥）',
    !/hmacSha256\((?![^,]*,)/.test(srvSrc.replace(/const hmacSha256 = [^\n]*\n/g, '')) &&
    /deriveTokenKey\('room-token'\)/.test(srvSrc) && /deriveTokenKey\('recording-url'\)/.test(srvSrc));
  ok('2026-10-03 分域是"签发立刻换、校验过渡期双收"（不把别人手里的旧链接一夜作废）',
    /hmacSha256\(payloadB64, ROOM_TOKEN_KEY\)/.test(srvSrc) &&
    /\[ROOM_TOKEN_KEY, LEGACY_TOKEN_KEY\]/.test(srvSrc) &&
    /\[RECORDING_URL_KEY, LEGACY_TOKEN_KEY\]/.test(srvSrc));
  ok('2026-10-02 同一轮的后半句是"追加"（replace:false，绝不 cancel 掉正在念的上一句）',
    /function enqueueAiSpeech\(say, \{ replace = true(, answerTs)? \}/.test(clientSrc) &&
    /if \(replace\) \{[\s\S]{0,600}?window\.speechSynthesis\.cancel\(\);[\s\S]{0,200}?aiSpeakPumping = false;/.test(clientSrc));
  ok('2026-10-02 终态只补念剩下的尾巴；前缀对不上就整段重念（宁可重复也不漏声）',
    /startsWith\(spoken\)/.test(clientSrc) &&
    /slice\(spoken\.length\)/.test(clientSrc) &&
    /\}\s*else \{\s*speakAiText\(text, \{ answerTs: ts \}\);/.test(clientSrc));  /* 2026-10-03 带上轮次锚点，浏览器这一轨才有读数 */
  ok('2026-10-02 朗读队列只有一条泵（流式追加时不会两条链抢同一个队列）',
    /let aiSpeakPumping = false/.test(clientSrc) && /if \(aiSpeakPumping\) return;\s*aiSpeakPumping = true;/.test(clientSrc));
  ok('2026-10-02 服务端那一轨在时浏览器不抢（aiTtsEnabled 直接不念，防双声）',
    /function speakStreamPart\(box, rawBuf\) \{\s*if \(!aiVoiceOn \|\| !SPEECH_OK \|\| aiTtsEnabled\) return;/.test(clientSrc));
  ok('2026-10-02 服务端语音状态翻转有监听（不再只信进房那一次的快照）',
    /socket\.on\('ai-tts-state'/.test(clientSrc));
  ok('2026-10-02 唤醒自动提问有同句去重（Web Speech 重出同一句不再重复提问）',
    /dupWake/.test(clientSrc) && /lastWakeAskText/.test(clientSrc));

  /* ---- ★ 2026-10-02 AI 头像"重影 + 一直重复一个动作"的重做 ----
   * ▎为什么这次连 style.css 一起读进来断言：本项目最贵的一次排版事故（坑 26：CSS 注释里
   *   写了星号斜杠吞掉整站 CSS 变量）**所有 JS 测试都测不到**——CSS 从来没被任何测试读过。
   *   而头像的"重影"恰好又是同一类跨文件问题：素材自带残影 + CSS 再叠一层缩放节奏，
   *   两边各演各的。只在 JS 里断言等于没断言，所以这里两边都钉。 */
  const cssSrc = fs.readFileSync(path.join(PUB, 'style.css'), 'utf8');
  /* ---- ★ 2026-10-04 白板盖住字幕条与控制坞（用户报"让 AI 调白板后字幕不可用了"）----
   * ▎字幕那套状态机一个字没错，坏的是层叠：白板 inset:0 + z-index:6 把 z-index:5 的
   *   .bottom-stack 整个盖住。这里钉"白板必须给底部那一列让位"，真浏览器命中测试在
   *   scripts/check-layer-cover.js（npm run check:layers）——结构断言只能防回退，
   *   证明"确实能点到"还得靠量。 */
  ok('2026-10-04 白板层不再盖住会议级控件（z-index 低于底部那一列 + 底边按真实高度让位）',
    /\.board-overlay \{[\s\S]{0,420}z-index: 4/.test(cssSrc) &&
    /bottom: calc\(var\(--stack-h, \d+px\) \+ \d+px\)/.test(cssSrc) &&
    /setProperty\('--stack-h'/.test(clientSrc));
  ok('2026-10-04 底部高度只有一个测量者（没有第二处再写一个猜的 bottom 数）',
    (clientSrc.match(/setProperty\('--stack-h'/g) || []).length === 1 &&
    !/\.caption-bar \{[^}]*bottom: \d+px/.test(cssSrc));

  /* ══ ★ 2026-10-03 补一块一直没人检查过的代码：dashboard.html 的内联 JS ══
   * ▎为什么现在才想到：面板是"一个页面 + 一段内联脚本"，既不在 node --check 的清单里，
   *   也不在冒烟的执行范围里（冒烟只跑 client.js）。于是**改错一个括号，面板就是一张
   *   永远不动的空白页，而回归全绿**——本轮刚好动了它（加播报延迟那一格），
   *   动的同时把这块盲区补上，成本 3 行、收益是"以后每次动面板都有人管"。
   * ▎手法：把 <script> 块抠出来交给 new Function() 只做**语法**检查（不执行——
   *   执行需要 document/fetch，那是 e2e 的活），语法错会以异常形式抛出来。
   * ▸ 复用上面那个 dashSrc（同一个文件读两遍是浪费，也是两个来源）。 */
  const dashJs = (dashSrc.match(/<script>([\s\S]*?)<\/script>/g) || [])
    .map((b) => b.replace(/^<script>/, '').replace(/<\/script>$/, '')).join('\n');
  let dashErr = '';
  try { new Function(dashJs); } catch (e) { dashErr = e.message; }
  ok('2026-10-03 观测面板的内联脚本语法过得去（这块此前没有任何测试覆盖）',
    dashJs.length > 400 && !dashErr, dashErr);
  ok('2026-10-03 面板两条延迟读数共用一个算法（口径不会各漂各的）',
    /const latCell = \(c\)/.test(dashSrc) &&
    (dashSrc.match(/latCell\(cb\./g) || []).length >= 2);
  ok('2026-10-07 五代：形象 = 内联 SVG 矢量脸（client.js 里不再有任何 xiaoming 位图资源）',
    /function aiAvatarSvg\(\)/.test(clientSrc) &&
    !/(src|href)\s*=\s*.?["'`][^"'`]*xiaoming-/.test(clientSrc));
  ok('2026-10-07 格子与成员行共用同一个 aiAvatarSvg()（一个概念只有一个来源）',
    (clientSrc.match(/aiAvatarSvg\(\)/g) || []).length >= 3);
  ok('2026-10-02 .ai-face 的常驻动画只有一条（两套节奏叠加就是重影）',
    (cssSrc.match(/\.ai-tile \.ai-face \{[^}]*animation: aiBreath/g) || []).length === 1);
  ok('2026-10-02 小动作池 ≥5 个且都是一次性动画（infinite 循环正是"机器感"的来源）',
    /AI_GESTURES = \[/.test(clientSrc) &&
    (cssSrc.match(/\.ai-face\.g-[a-z-]+\s*\{[^}]*animation: \w+ [\d.]+s [a-z-]+ 1;/g) || []).length >= 5);
  ok('2026-10-02 思考/开心各有自己的律动（不同状态不同动作）',
    /\.ai-tile\.thinking \.ai-face \{ animation: aiThinkLook/.test(cssSrc) &&
    /\.ai-tile\.happy \.ai-face \{ animation: aiHappyPop/.test(cssSrc));
  /* ★ 2026-10-07 五代（SVG 矢量脸）：一代整脸换 talk.webp 死于"嘴没张开"，
   *   二代重排口型帧死于"重影太多"，三代"底脸常驻+嘴部贴片"仍被用户评
   *   "能不能做得像个人做的"——问题在素材本身（AI 生成的 Q 版位图有生成图味）。
   *   五代换掉素材层：眼/眉/嘴/腮红是独立 SVG 元素，状态 = CSS 类驱动变形。
   * ▸ 这组断言钉新平衡：① 说话嘴是元素动画（avTalk），贴片素材整体退役；
   *   ② 眨眼常驻（avBlink，说话时人也眨眼）；③ 思考/开心走五官走位，
   *   且 SVG 元素变形必须 transform-box: fill-box（否则参照整条视口，眨眼变整张脸在跳）。 */
  ok('2026-10-07 说话嘴 = .av-mouth 的 avTalk 变形动画，口型贴片素材与 setAiPortrait 整体退役',
    /\.ai-tile\.speaking \.ai-face \.av-mouth/.test(cssSrc) &&
    /@keyframes avTalk/.test(cssSrc) &&
    !/AI_MOUTH/.test(clientSrc) && !/setAiPortrait/.test(clientSrc) && !/\.ai-mouth/.test(cssSrc));
  ok('2026-10-07 眨眼常驻慢循环（avBlink；双眼错开 20ms——齐眨像机器，错开像生物）',
    /@keyframes avBlink/.test(cssSrc) &&
    /\.ai-face \.av-eye(-r)?\s*\{[^}]*animation: avBlink/.test(cssSrc));
  ok('2026-10-07 思考/开心走五官走位（瞳孔上抬+眉毛下压 / 笑眼藏瞳孔+嘴咧开），元素变形以自身为参照系',
    /\.ai-tile\.thinking \.av-pupil/.test(cssSrc) &&
    /\.ai-tile\.thinking \.av-brow-l/.test(cssSrc) &&
    /\.ai-tile\.happy \.av-eye-bg/.test(cssSrc) &&
    /\.ai-tile\.happy \.av-mouth/.test(cssSrc) &&
    /transform-box: fill-box/.test(cssSrc));
  ok('2026-10-07 结构上不存在叠印源：没有 .ai-face-l 待命层、没有贴片层（重影的结构性根治）',
    !/ai-face-l/.test(clientSrc) && !/ai-face-l/.test(cssSrc) &&
    !/\.ai-tile \.ai-mouth/.test(cssSrc));
  ok('2026-10-02 无障碍：prefers-reduced-motion 下头像动画全部停掉',
    /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,400}animation: none !important/.test(cssSrc));
  ok('2026-10-02 调度器只在 idle/listening 演小动作，格子移除时一并停表',
    /state !== 'idle' && aiAvatar\.state !== 'listening'/.test(clientSrc) &&
    (clientSrc.match(/clearAiGesture\(\)/g) || []).length >= 2);
  /* ★ 2026-10-06 小动作排程不能被"同一条状态重复广播"饿死（check:avatar 间歇红的真因）。
   *   ▎症状：安静期 36 秒内一次小动作都没演出来，用户看到的正是"动态效果没有变化"。
   *   ▎根因不在动画，在**接线**：armAiGestures() 第一件事是清掉正在等的定时器，而它原先挂在
   *     每一条 ai-state 消息上；服务器每建一条听觉管线广播一次 listening（每人一次、
   *     重连一次、换 producer 一次）→ 广播间隔短于 7 秒时，等待永远从头再来。
   *   ▸ 判据写成两条结构断言：① 重排的条件里必须出现"状态变了"或"手上没有排程"；
   *     ② 定时器回调一进门要把 gestureTimer 归零（否则"有没有排程"这个判据读的是旧值，
   *        条件①就形同虚设——这是这条修复里最容易只做一半的地方）。 */
  ok('2026-10-06 小动作只在状态真的换了（或没有排程）时重排，不是每条 ai-state 都重排',
    /if \(st !== aiAvatar\.prevState \|\| !aiAvatar\.gestureTimer\) armAiGestures\(\);/.test(clientSrc) &&
    /aiAvatar\.prevState = st;/.test(clientSrc));
  ok('2026-10-06 定时器一进门就把 gestureTimer 归零（"手上有没有排程"必须读得到真话）',
    /aiAvatar\.gestureTimer = 0;\s*\/\/ ★ 2026-10-06/.test(clientSrc));
  /* 配对的另一半：格子建出来时要**补排一次**。
   * ai-state 常早于格子存在（点「AI」→ 服务器先播状态，room-state 才建格子），
   * 定时器到点时 .ai-face 还不存在就 return，此后没人再排 → 头像从此不做小动作。 */
  {
    const syncBlock = (clientSrc.match(/function syncAiTile\(present\)[\s\S]*?\n\}/) || [, ''])[0];
    ok('2026-10-06 格子建好时补排一次小动作（开局顺序 race 不能再让头像永远静止）',
      /armAiGestures\(\)/.test(syncBlock));
  }

  /* ---- ★ 2026-10-03 第 44 步：AI 的"在听"改成真实音量驱动 ----
   * ▎用户两次说"头像动态效果差、没有状态变化"，根因不在动画多少，而在**它动的时机是假的**：
   *   波形只在 AI 自己 speaking 时出现，且是一组 infinite 循环——房间里谁在说话、
   *   说多大声，它一概不反应。而"听"正是这个角色的全部工作。
   * ▎所以这一组断言钉的是三件事：① 电平换算只有一个来源（画面格的音量条与这颗耳朵
   *   同口径，改阈值不会只改一处）；② 有声音才有波形（安静/无数据必须归零，不许装忙）；
   *   ③ AI 自己说话时不抢这条波形（两个来源抢同一个执行器 = 坑 62）。 */
  const ear = (v) => vm.runInContext(`dbToLevel(${v})`, ctx);
  ok('44 电平换算：-55dB 及以下算安静、0dB 满格（与画面格音量条同一处定义）',
    ear(-55) === 0 && ear(-90) === 0 && ear(0) === 1 && ear(-27.5) > 0.45 && ear(-27.5) < 0.55);
  ok('44 电平换算：脏输入按"安静"处理而不是 NaN（NaN 进 CSS 会让波形整个消失且无人报错）',
    vm.runInContext('dbToLevel(NaN)', ctx) === 0 &&
    vm.runInContext('dbToLevel(undefined)', ctx) === 0 &&
    vm.runInContext('dbToLevel("-20")', ctx) === 0);
  ok('44 全仓只有一处 dB→电平 的算术（第二处迟早会漂）',
    (clientSrc.match(/\+\s*55\s*\)\s*\/\s*55/g) || []).length === 0 &&
    /function dbToLevel\(volume\)/.test(clientSrc) &&
    /const SPEAK_FLOOR_DB = -55;/.test(clientSrc));
  vm.runInContext(`lastMembers = [{ id: '${PEER}', name: '小张' }];
    aiAvatar.state = 'listening'; syncAiTile(true);`, ctx);
  const earOn = vm.runInContext(`(function(){
    applyAiListening([{ id: '${PEER}', volume: -22 }]);
    return { cls: aiTileEl.classList.contains('listening-active'),
             v: aiTileEl.style.getPropertyValue('--ai-ear'),
             who: (aiTileEl.querySelector('.ai-ear') || {}).textContent };
  })()`, ctx);
  ok('44 有人说话：波形现身 + 电平进 CSS 变量 + 说出"在听谁"（名字来自 room-state，不编）',
    earOn.cls === true && Number(earOn.v) > 0.5 && /在听.*小张/.test(String(earOn.who)),
    `--ai-ear=${earOn.v} 文案=${earOn.who}`);
  const earOff = vm.runInContext(`(function(){
    applyAiListening([{ id: '${PEER}', volume: -80 }]);
    return { cls: aiTileEl.classList.contains('listening-active'),
             v: aiTileEl.style.getPropertyValue('--ai-ear'),
             who: (aiTileEl.querySelector('.ai-ear') || {}).textContent };
  })()`, ctx);
  ok('44 安静下来：波形与"在听谁"一起收掉（没声音还亮着就是装忙）',
    earOff.cls === false && Number(earOff.v) === 0 && earOff.who === '',
    `--ai-ear=${earOff.v} 文案="${earOff.who}"`);
  const earSpeak = vm.runInContext(`(function(){
    setAiState('speaking', '好的，我记下了');
    applyAiListening([{ id: '${PEER}', volume: -12 }]);
    return aiTileEl.classList.contains('listening-active');
  })()`, ctx);
  ok('44 AI 自己发言时不抢这条波形（那时它说的是"我在说"，不是"我在听"）',
    earSpeak === false);
  vm.runInContext(`setAiState('idle'); syncAiTile(false);`, ctx);
  ok('44 波形两种形态在样式里各有归属（listening 按真实电平缩放、不叠 infinite 假动作）',
    /\.ai-tile\.listening-active \.ai-waves i \{[\s\S]{0,240}animation: none/.test(cssSrc) &&
    /scaleY\(calc\(var\(--ai-ear, 0\)/.test(cssSrc));
  ok('44 CSS 里最后一颗 emoji（💭 思考泡泡）换成了三点记号',
    !/content:\s*'[\u{1F300}-\u{1FAFF}]/u.test(cssSrc) &&
    /\.ai-tile\.thinking::after \{[\s\S]{0,120}radial-gradient/.test(cssSrc));

  /* ---- ★ 2026-10-02 Piik 取长①：定向回应（只对某个人比表情） ----
   * ▎数据通道是广播语义，所以"发给某人"只能靠消息带定向头 + 接收方各自过滤
   *   （与 F5 批注的 to 同一套做法）。这里钉的是三件事：发的时候带 to、
   *   收的时候过滤、定向状态会过期且发完即清——少一条都会变成"对着空气比心"。 */
  ok('2026-10-02 定向回应：发送带 to 字段（复用批注那套定向头）',
    /type: 'react'[\s\S]{0,160}to: t \? t\.id : undefined/.test(clientSrc));
  ok('2026-10-02 定向回应：接收端过滤掉不是发给自己的（别人不刷屏）',
    /if \(msg\.to && msg\.to !== socket\.id\) return;/.test(clientSrc));
  ok('2026-10-02 定向状态会过期（目标离开不会一直定向）+ 发完自动取消',
    /REACT_TARGET_TTL_MS/.test(clientSrc) && /Date\.now\(\) > reactTarget\.until/.test(clientSrc) &&
    /setReactTarget\(null\); \/\/ 一次一发/.test(clientSrc));
  ok('2026-10-02 定向入口在成员行（人 + AI 都有），不是只给一半人',
    (clientSrc.match(/addReactTargetBtn\(/g) || []).length >= 3);

  /* ---- ★ 2026-10-02 Piik 取长②：只听不看（服务器 pause 才真省下行） ----
   * ▎关键区别要钉住：前端 display:none **不省流量**（包还在收），必须让服务器 pause。
   *   所以断言的是"确实发了 set-consumer-paused 且带的是这一格的视频 consumer"。 */
  ok('2026-10-02 「不看」按钮发 set-consumer-paused（不是只把画面藏起来）',
    /request\('set-consumer-paused'/.test(clientSrc) && /tile\.videoConsumerId/.test(clientSrc));
  ok('2026-10-02 按钮只挂在视频路（音频不能被"不看"停掉——只听不看）',
    /if \(kind === 'video'\) addWatchBtn\(/.test(clientSrc));
  ok('2026-10-02 一格一个按钮（幂等靠 dataset，重复订阅不叠按钮）',
    /box\.dataset\.watchBtn/.test(clientSrc));
  ok('2026-10-02 暂停态有可见遮罩（不是"黑一下什么也没说"）',
    /\.video-box\.paused-view::after/.test(cssSrc) && /\.watch-btn \{ left: 8px; top: 40px; \}/.test(cssSrc));

  /* ---- ★ 2026-10-02 Piik 取长①：每路独立音量 + 超过 100% 的增强 ----
   * ▎安全分层是这块设计的全部要点，所以逐条钉：
   *   0~100% 走 video.volume（不需要用户手势、不可能把会议搞没声）；
   *   只有 >100% 才挂 WebAudio GainNode，此时**必须**把 <video> 静音，
   *   否则"元素出声 + 音频图出声"= 双重回声；增强不可用要回落 100% 而不是静音。
   * ▎还有一条最容易漏的：replaceTrack / 重连会给同一格换一条**新的 MediaStream**，
   *   而 GainNode 还接在旧流上——旧流已停 + 元素被静音 = "调大音量反而没声音"。
   *   所以流身份必须判、删格子必须拆图（长跑不泄漏节点）。 */
  ok('2026-10-02 音量分层：0~100% 用 video.volume，不碰音频图',
    /if \(v <= 1\) \{ detachTileGain\(video\); video\.volume = v; return v; \}/.test(clientSrc));
  ok('2026-10-02 增强时把元素静音（否则双重出声）',
    /video\.muted = true; \/\/ 声音改由音频图负责/.test(clientSrc));
  ok('2026-10-02 增强不可用 → 回落 100% 而不是静音',
    (clientSrc.match(/video\.volume = 1;\s*\n?\s*return 1;/g) || []).length >= 2);
  ok('2026-10-02 流换对象会重挂增益（坑 32 的音频版）',
    /n\.stream !== video\.srcObject/.test(clientSrc) && /stream: video\.srcObject/.test(clientSrc));
  ok('2026-10-02 三条删格路径都拆音频图（长跑不泄漏节点）',
    (clientSrc.match(/detachTileGain\(tile\.video\)/g) || []).length >= 3);
  ok('2026-10-02 音量偏好按成员持久化（换场还认得谁吵）',
    /sfu\.tileVol\.v1/.test(clientSrc) && /function rememberVolume/.test(clientSrc) && /function storedVolumes/.test(clientSrc));
  ok('2026-10-02 音量控件悬停才出现且挡住双击全屏（不抢格子手势）',
    /\.video-box:hover \.vol-ctl/.test(cssSrc) && /stopPropagation\(\)/.test(clientSrc));

  /* ---- ★ 2026-10-02 Piik 取长④：进房前 ICE 预检 ----
   * ▎这条补的是"沉默故障"的可见性（坑 36）：跨网连不上时过去只有"转圈 + 黑屏"，
   *   而 doctor/test:turn 都在服务器上，普通用户不会跑。现在预览页当场给一句人话。 */
  ok('2026-10-02 ICE 自检用的是服务器下发的同一批 ICE 服务器（不是另配一套）',
    /iceServersForProbe[\s\S]{0,200}sfuIceServers/.test(clientSrc));
  ok('2026-10-02 判定优先级 relay > srflx > host > 无（中继最稳，故最先认）',
    /types\.has\('relay'\) \? 'relay' : types\.has\('srflx'\) \? 'stun' : types\.has\('host'\) \? 'lan' : 'blocked'/.test(clientSrc));
  ok('2026-10-02 自检不阻塞进会（延迟触发 + 幂等挂载）',
    /function initIcePrecheck\(\)[\s\S]{0,260}getElementById\('iceProbe'\)\) return/.test(clientSrc) &&
    /setTimeout\(async/.test(clientSrc));
  ok('2026-10-02 结论写清诚实边界（SFU 媒体不经 TURN，不自称"保证能连"）',
    /不经 TURN 转发/.test(clientSrc) && /不代表与会议服务器一定连通/.test(clientSrc));
  ok('2026-10-02 UDP 被堵时给可执行的下一步（指回部署手册，而不是只报错）',
    /blocked[\s\S]{0,220}Tailscale/.test(clientSrc));

  /* ---- ★ 09-30 远程画面自适应帧率：把**控制律**钉死 ----
   * ▎为什么这类性能逻辑必须单测：它是整个自适应机制里唯一会"调错"的地方，
   *   调错的表现是画面忽快忽慢（比固定帧率更难受），而在真机上极难复现。
   *   抽成纯函数 `rdDecideFps` 后就能穷举边界——性能代码同样需要确定性。 */
  const ctxRun = (expr) => vm.runInContext(expr, ctx);
  ok('09-30 自适应控制律已抽成纯函数（可断言，不靠"跑起来看着还行"）',
    typeof ctxRun('typeof rdDecideFps') === 'string' && ctxRun('typeof rdDecideFps') === 'function');
  // 链路好（帧率跟得上 + RTT 低）→ 升
  ok('09-30 跟得上且 RTT 低 → 升 2 帧', ctxRun('rdDecideFps({actualFps:12, targetFps:12, rttMs:30})') === 14);
  // 明显跟不上 → 降
  ok('09-30 帧率只有目标 60% 以下 → 降 2 帧', ctxRun('rdDecideFps({actualFps:5, targetFps:12, rttMs:30})') === 10);
  // RTT 高 → 降（即使帧率看着还行）
  ok('09-30 RTT > 250ms → 降（高延迟下提帧率只会让延迟更糟）',
    ctxRun('rdDecideFps({actualFps:12, targetFps:12, rttMs:400})') === 10);
  // 死区：跟不上不下、也不升（防震荡）
  ok('09-30 处于死区（60%~90%）→ 保持不动（防震荡是自适应的生命线）',
    ctxRun('rdDecideFps({actualFps:9, targetFps:12, rttMs:50})') === 12);
  // RTT 未测到（null）时按"链路未知"处理：跟得上就允许升
  ok('09-30 RTT 未知时也安全（有样本就按帧率判，不因缺数据卡死）',
    ctxRun('rdDecideFps({actualFps:12, targetFps:12, rttMs:null})') === 14);
  // 上下界钳制
  ok('09-30 上限钳制在 24fps', ctxRun('rdDecideFps({actualFps:30, targetFps:24, rttMs:10})') === 24);
  ok('09-30 下限钳制在 6fps（再低就不叫"实时画面"了）',
    ctxRun('rdDecideFps({actualFps:1, targetFps:6, rttMs:500})') === 6);
  // 门禁：控制端发出的帧率建议必须被限制在合法区间（服务器与代理各钳一次）
  ok('09-30 建议值经服务器与代理双重钳制（控制端不能传任意值改被控端行为）',
    /Math\.max\(2, Math\.min\(24/.test(fs.readFileSync(path.join(__dirname, '..', 'sfu', 'server.js'), 'utf8'))
    && /Math\.max\(2, Math\.min\(24/.test(fs.readFileSync(path.join(__dirname, '..', 'agent', 'index.js'), 'utf8')));

  /* ════════════════════════════════════════════════════════════════
   * ★ 09-24 真远程桌面（控制端控制台）—— 前端契约断言
   *   ▎这一组守的是"两条控制路径不能串"：控制代理 = 真远程桌面控制台（canvas + 真注入），
   *     控制人类 = 工作台重放（iframe + 合成事件）。串了会出很难查的怪象：
   *     比如授权通过却打开了错误的界面，或者关掉之后画面还在偷偷刷新。
   * ════════════════════════════════════════════════════════════════ */
  console.log('\n--- 09-24 真远程桌面（前端）---');

  const RD = 'AGENTMEMBERID8888';
  guard('代理在场快照', () => emit('room-state', {
    members: [
      { id: socketStub.id, name: '我', owner: true },
      { id: PEER, name: '普通成员', owner: false },
      { id: RD, name: '🖥️ 我的电脑', owner: false, agent: true, agentInfo: { platform: 'win32', browser: 'Edg/153' } },
    ],
  }));

  // 桩的 textContent='' 不清 children，渲染是累加的 → 取"最后一次渲染出来的那一行"
  const rowsWith = (cls) => (documentStub.getElementById('memberList').children || []).filter((r) => r.classList.contains(cls));
  const agentRow = rowsWith('agent-row').slice(-1)[0];
  ok('09-24 代理成员渲染成独立 agent-row（人/机一眼可辨）', !!agentRow);
  const agentBtn = agentRow && (agentRow.children || []).find((c) => c.classList.contains('m-ctrl-btn'));
  ok('09-24 代理行带「控制电脑」按钮', !!agentBtn);

  const humanRow = (documentStub.getElementById('memberList').children || [])
    .filter((r) => String(r.dataset.id) === PEER).slice(-1)[0];
  const humanBtn = humanRow && (humanRow.children || []).find((c) => c.classList.contains('m-ctrl-btn'));
  ok('09-24 人类成员行**没有**「控制电脑」按钮（两条控制路径不混淆）', !!humanRow && !humanBtn);

  // 点「控制电脑」→ 走的是和人类一模一样的 remote-request 授权链路（没有第二条捷径）
  rec.emits.length = 0;
  rec.remoteRequestTo = null;
  if (agentBtn) guard('点控制电脑', () => agentBtn.dispatch('click'));
  ok('09-24 点「控制电脑」发出 remote-request（授权链路一字未改）', rec.emits.includes('remote-request'));
  ok('09-24 remote-request 的目标正是那台代理（不会发错人）', rec.remoteRequestTo === RD);

  // 授权成功且对象是代理 → 打开远程桌面控制台（而不是工作台重放模式）
  const rdEl = documentStub.getElementById('rdConsole');
  rdEl.classList.add('hidden');
  guard('授权回执', () => emit('remote-answer', { from: RD, ok: true }));
  ok('09-24 代理授权后打开远程桌面控制台（不是工作台重放）', !rdEl.classList.contains('hidden'));
  ok('09-24 打开控制台时给 body 挂 rd-mode（后台页面不再滚动）',
     documentStub.body.classList.contains('rd-mode'));

  // 真画面帧 → 状态更新（冒烟环境没有 createImageBitmap，走"只记状态"的降级分支 ——
  // 这正是把绘制与状态分开写换来的好处：解码不可用时，逻辑依然可断言）
  const rdStateEl = documentStub.getElementById('rdState');
  rdStateEl.textContent = '';
  guard('画面帧', () => emit('remote-frame', { frame: new ArrayBuffer(2048) }));
  await new Promise((r) => setTimeout(r, 60));
  ok('09-24 收到画面帧后状态转为「实时画面」（帧数放进 title，不拿数字困惑用户）',
     /实时画面/.test(rdStateEl.textContent || '') && /1 帧/.test(rdStateEl.title || ''));

  // 地址栏显示对方浏览器的真实 URL
  const rdUrlEl = documentStub.getElementById('rdUrl');
  guard('元信息', () => emit('remote-meta', { url: 'https://example.com/a', title: '示例' }));
  ok('09-24 地址栏显示对方真实 URL（remote-meta 回传，不是假的）', rdUrlEl.value === 'https://example.com/a');

  // 地址栏回车 → navigate 命令（复用 remote-input 通道 = 复用同一道服务器门禁）
  rec.remoteInputPayloads.length = 0;
  rdUrlEl.value = 'bilibili.com';
  guard('地址栏回车', () => rdUrlEl.dispatch('keydown', { key: 'Enter' }));
  const navMsg = rec.remoteInputPayloads.find((p) => p && p.event && p.event.kind === 'navigate');
  ok('09-24 地址栏回车发出 navigate 命令（能远程开任意真实网站）',
     !!navMsg && navMsg.event.url === 'bilibili.com' && navMsg.to === RD);

  // 工具条「最大化」→ window/maximized
  rec.remoteInputPayloads.length = 0;
  guard('最大化', () => documentStub.getElementById('rdMax').dispatch('click'));
  const winMsg = rec.remoteInputPayloads.find((p) => p && p.event && p.event.kind === 'window');
  ok('09-24 工具条可远程最大化对方窗口（真·全屏桌面感）', !!winMsg && winMsg.event.state === 'maximized');

  // 鼠标：canvas 上的操作 → 16 字节二进制帧，坐标是归一化 0.5（桩 rect 是 640×360，点在正中）
  rec.remoteInputPayloads.length = 0;
  guard('canvas 点击', () => {
    const c = documentStub.getElementById('rdCanvas');
    c.dispatch('pointerdown', { clientX: 320, clientY: 180, button: 0 });
    c.dispatch('pointerup', { clientX: 320, clientY: 180, button: 0 });
  });
  const binFrame = rec.remoteInputPayloads.map((p) => p && p.event).find((e) => e && e.byteLength === 16);
  ok('09-24 canvas 上的鼠标操作打成 16 字节帧（与远程协助同一套线格式）', !!binFrame);
  if (binFrame) {
    const dv = new DataView(binFrame);
    ok('09-24 帧内 kind=mousedown(4) 且坐标已归一化到 0.5',
       dv.getUint8(0) === 4 && Math.abs(dv.getFloat32(4) - 0.5) < 0.02 && Math.abs(dv.getFloat32(8) - 0.5) < 0.02);
  } else {
    ok('09-24 帧内 kind=mousedown(4) 且坐标已归一化到 0.5', false);
  }

  // 撤权 → 控制台自动收起（不留一屏"定格画面"骗人）
  guard('控制结束', () => emit('remote-ended', { reason: 'released' }));
  ok('09-24 控制结束后控制台自动关闭', rdEl.classList.contains('hidden'));
  ok('09-24 控制结束后 body 的 rd-mode 摘掉', !documentStub.body.classList.contains('rd-mode'));

  // 关掉之后再来的帧必须丢弃（"关了还偷偷接着画"是最容易留的后门）
  rdStateEl.textContent = '';
  guard('关门后的帧', () => emit('remote-frame', { frame: new ArrayBuffer(1024) }));
  await new Promise((r) => setTimeout(r, 50));
  ok('09-24 控制台关闭后丢弃画面帧（不再更新状态）', rdStateEl.textContent === '');

  // 房间里已经有代理 → "怎么启动代理"的指引卡片收起（别对着已经用上的人唠叨）
  ok('09-24 房内有代理时收起「怎么启动代理」指引',
     documentStub.getElementById('agentHint').classList.contains('hidden'));
  ok('09-24 指引卡片里的启动命令带真实房间号（复制即用）',
     String(documentStub.getElementById('agentCmd').textContent).includes('--room'));

  /* ════════════════════════════════════════════════════════════
   * ★ 09-30 设备码直连 + 画质档（前端）—— 取长补短自 billd-desk
   *   ▎断言重点：① 入口是"另一条路"，但**授权之后共用同一个控制台**（不许长出第二套 UI）；
   *              ② 画质档必须真的从 remote-input 老通道发出去（复用门禁），
   *                 且手动档与自动档互斥（两个来源抢一个执行器的症状就是"按钮亮着但没生效"）。
   * ════════════════════════════════════════════════════════════ */
  console.log('\n--- 09-30 设备码直连 + 画质档（前端）---');

  // ① 登录卡上的「用设备码远程控电脑」→ 打开设备码面板（不经过会议）
  const deskOv = documentStub.getElementById('deskOverlay');
  const authOv = documentStub.getElementById('authOverlay');
  authOv.classList.remove('hidden');
  deskOv.classList.add('hidden');
  guard('点设备码入口', () => documentStub.getElementById('authDeskBtn').dispatch('click'));
  ok('09-30 登录卡有设备码入口，点击后打开直连面板（不用先进会）',
     !deskOv.classList.contains('hidden') && authOv.classList.contains('hidden'));

  // ② 码格式不对 → 本地就拦下（不发信令，省一次无谓往返，也避免把脏输入送进服务器）
  rec.lastDeskConnect = null;
  const deskCodeEl = documentStub.getElementById('deskCode');
  const deskPassEl = documentStub.getElementById('deskPass');
  const deskMsgEl = documentStub.getElementById('deskMsg');
  deskCodeEl.value = '12';
  guard('提交短设备码', () => documentStub.getElementById('deskConnectBtn').dispatch('click'));
  ok('09-30 设备码非 6 位时本地拦截（不发 desk-connect）',
     rec.lastDeskConnect === null && /6 位/.test(String(deskMsgEl.textContent)));

  // ③ 正常提交 → desk-connect {deviceCode, password}
  rec.lastDeskConnect = null;
  deskCodeEl.value = '246810';
  deskPassEl.value = 'pw123';
  guard('提交设备码', () => documentStub.getElementById('deskConnectBtn').dispatch('click'));
  await new Promise((r) => setTimeout(r, 30));
  ok('09-30 设备码+连接密码提交到服务器（一条信令替代"建房→进房→申请控制"三步）',
     !!rec.lastDeskConnect && rec.lastDeskConnect.deviceCode === '246810' && rec.lastDeskConnect.password === 'pw123');
  // 桩回的 ack 是 granted:false（需人工确认）→ 面板给出确定提示，而不是"点了没反应"
  ok('09-30 需人工确认时给出等待提示（不静默）',
     /等待对方/.test(String(deskMsgEl.textContent)));

  // ④ 授权到达（模拟被控端确认/无人值守）→ **同一个真桌面控制台**被打开、面板收起
  rdEl.classList.add('hidden');
  deskOv.classList.remove('hidden');
  guard('设备码授权', () => emit('desk-granted', { hostId: RD, hostName: '🖥️ 客厅电脑', unattended: true }));
  ok('09-30 desk-granted 打开的是同一个远程桌面控制台（不长出第二套 UI）',
     !rdEl.classList.contains('hidden') && deskOv.classList.contains('hidden'));
  ok('09-30 控制台副标题显示设备名（来自 desk-register 的 🖥️ 前缀名）',
     /客厅电脑/.test(String(documentStub.getElementById('rdMeta').textContent)));

  // ⑤ 画质档：点「高清」→ 走 remote-input 老通道发 {kind:'quality'}（复用同一道服务器门禁）
  rec.remoteInputPayloads.length = 0;
  const qHd = documentStub.getElementById('rdQHD');
  const qAuto = documentStub.getElementById('rdQAuto');
  qAuto.classList.add('is-on');
  guard('点高清档', () => qHd.dispatch('click'));
  /* 找的是**整条载荷**（含 to），不是里面的 event —— 一开始写成 .map(p=>p.event).find(...)
   *  再去读 qMsg.to 就永远是 undefined（"断言写得像真的，其实读了个空气"）。
   *  与坑 51 同源：冒烟里读嵌套结构，每一层都要明确自己在读哪一层。 */
  const qMsg = rec.remoteInputPayloads.find((p) => p && p.event && p.event.kind === 'quality' && p.event.preset === 'hd');
  ok('09-30 切画质档走 remote-input（不新造事件 = 复用门禁与限流）',
     !!qMsg && qMsg.to === RD);
  /* ★ 手动档与自动档**互斥**是这里最该钉住的一条：
   *   两套逻辑同时调帧率会互相拉扯（用户点了高清、3 秒后自动档又拖回标准），
   *   表现为"按钮亮着但画面没变"。所以点手动档必须把 is-on 从"自动"摘掉。 */
  ok('09-30 手动档生效时自动档标记被摘掉（两个来源不会抢一个执行器）',
     qHd.classList.contains('is-on') && !qAuto.classList.contains('is-on'));

  // ⑥ 回到自动档 → 重新发一次当前档（让对端状态与界面一致），并恢复自动标记
  rec.remoteInputPayloads.length = 0;
  guard('点自动档', () => qAuto.dispatch('click'));
  ok('09-30 回到自动档时自动标记恢复且当前档重发一次（界面与对端不错位）',
     qAuto.classList.contains('is-on') &&
     rec.remoteInputPayloads.some((p) => p && p.event && p.event.kind === 'quality'));

  // ⑦ 静态契约：HTML 里四颗档按钮与设备码面板控件都在（前端改名会静默断线，这里钉住）
  const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'index.html'), 'utf8');
  ok('09-30 index.html 含 自动/流畅/标准/高清 四档按钮',
     ['rdQAuto', 'rdQSmooth', 'rdQStd', 'rdQHD'].every((id) => htmlSrc.includes('id="' + id + '"')));
  ok('09-30 index.html 含设备码面板（码/密码/连接/返回）与登录卡入口',
     ['deskOverlay', 'deskCode', 'deskPass', 'deskConnectBtn', 'deskBackBtn', 'authDeskBtn']
       .every((id) => htmlSrc.includes('id="' + id + '"')));

  // ⑧ 撤权收起控制台，别让后面的断言带着"仍在控制"的状态跑
  guard('收尾释放', () => { try { documentStub.getElementById('rdRelease').dispatch('click'); } catch (e) {} });

  /* ⑧b ★ 2026-10-06 G6：两个 reactbits 移植的可测化（CountUp 纯函数 + 看板错峰入场）。
   * ▎为什么 CountUp 要抽成纯函数再单测：滚动最容易出的三件事——收尾停在 41.9、
   *   进度越界变 NaN 进 DOM、第一次出现时从 0 骗人——在浏览器里量都要等动画、还受 rAF 时机影响；
   *   抽出来之后每一条都是 1 毫秒的穷举断言（同 rdDecideFps / Asr.mergeTranscript 那条纪律）。 */
  {
    const COUNTUP = require(path.join(__dirname, '..', 'sfu', 'public', 'countup.js'));
    const { countStep } = COUNTUP;
    ok('CountUp 纯函数：进度到 1 必须正好落终值（观测面板不许停在 41.9 这种事）',
      countStep(0, 42, 1) === '42' && countStep(37, 42, 1) === '42' && countStep(1.2, 5.1, 1, 1) === '5.1');
    ok('CountUp 纯函数：递增序列单调（缓动来回跳=观感上的"抽搐"）',
      (() => {
        let prev = -1;
        for (let i = 0; i <= 20; i++) {
          const v = Number(countStep(0, 100, i / 20));
          if (v < prev) return false;
          prev = v;
        }
        return prev === 100;
      })());
    ok('CountUp 纯函数：脏输入不进 DOM（progress 越界或缺失一律钳住，绝不产出 NaN）',
      countStep(0, 10, 5) === '10' && countStep(0, 10, -3) === '0' &&
      countStep(0, 10, undefined) === '0' && countStep(undefined, 7, 0.5) === '7');
    ok('CountUp 纯函数：没有数值时给空串（面板自己渲染 "--"），不编一个 0 出来',
      countStep(3, null, 0.5) === '' && countStep(3, undefined, 0.5) === '' &&
      countStep(3, NaN, 1) === '' && countStep(3, '', 0.5) === '');
    /* 这一条是上一条的同源教训写成 API：Number(null)=0、Number('')=0，
     * 所以"是不是一个数"必须问 isNum，不能自己写 Number.isFinite(Number(x))——
     * 面板里 data-v="" 的那一格就会滚成一个 0。 */
    ok('CountUp 的 isNum 挡住 null / 空串 / NaN（"是不是数"只有一个判据）',
      COUNTUP.isNum(0) && COUNTUP.isNum('7') &&
      !COUNTUP.isNum(null) && !COUNTUP.isNum('') && !COUNTUP.isNum(NaN) && !COUNTUP.isNum(undefined));
    const dash = fs.readFileSync(path.join(PUB, 'dashboard.html'), 'utf8');
    ok('观测面板真的接了这套算法（引入 countup.js 且逐帧走 countStep，不是另写一份缓动）',
      /src="countup\.js/.test(dash) && /COUNTUP\.countStep\(/.test(dash) &&
      /class="cnt" data-k=/.test(dash) && /runCountUps\(\);/.test(dash));
    ok('观测面板的上一值存在 JS 的 Map 里，不写在被整块重写的 DOM 上（否则每次轮询都从 0 滚一遍）',
      /const countLast = new Map\(\)/.test(dash) && /countLast\.get\(key\)/.test(dash));
  }
  /* 看板错峰入场（AnimatedContent 移植）。判据拆两半，因为这一类缺陷有两种形状：
   *   ① 类挂上了但 CSS 没写（看不见效果）；② CSS 写了但每个元素 --i 都是 0（一起动=不是错峰）。 */
  {
    ok('2026-10-06 看板错峰：JS 按 DOM 顺序写 --i，切换时先摘类再强制重排（连切两次也要重播）',
      /acView\.querySelectorAll\('\.board-sec'\)\.forEach\(\(el, i\) => \{ el\.style\.setProperty\('--i', String\(i\)\); \}\);/.test(clientSrc) &&
      /acView\.classList\.remove\('ac-in'\)/.test(clientSrc) &&
      /acView\.classList\.add\('ac-in'\)/.test(clientSrc));
    ok('2026-10-06 看板错峰：CSS 只有一条 delay 公式，且 reduced-motion 下整条关掉',
      /animation-delay: calc\(var\(--i, 0\) \* 45ms\)/.test(cssSrc) &&
      /\.side-view\.ac-in \.board-sec \{ animation: none; \}/.test(cssSrc));
  }

  /* ⑨ ★ 2026-10-04 元断言：**每一条"量界面"的检查都必须先说明它量的是哪一版**。
   * ▎为什么值得钉住这一类：本轮给 check:layers 补指纹、给 check:console 补指纹时发现，
   *   13 件套里"有没有做版本指纹"完全靠自觉——而**没有指纹的检查测的是缓存不是代码**（坑 40），
   *   它报出来的绿灯与本轮改动毫无关系。这类"新增的东西没人检查它存不存在"的缺陷，
   *   正好用一条遍历文件的断言封死（同坑 76："机制存在 ≠ 机制生效"的检验要能自动化）。
   * ▎两种形式都算合格：① `no-store` 拉源码比对指纹；② 直接问页面全局函数在不在
   *   （check:think 用的是这种——它其实更强，因为它量的是**真跑起来的那一份**）。
   * ▸ ★ 2026-10-10 加第三种合格形态：**这台根本不开浏览器**（`scripts/check-scripts.js` 是静态审计，
   *   没有"页面加载了哪一版"这件事可问，要它写版本指纹就是让判据问一个不存在的问题）。
   *   ▸ 但**豁免必须是文件自己声明的**，而且要当场核对声明是不是真的——
   *     只在断言里按文件名/关键词猜"哪些是静态的"，下一个不开浏览器的检查就会撞红（今晚就是这样红的），
   *     而随便写一句"我是静态的"就能逃过指纹检查，这条红线就废了。两头都堵：
   *     声明了静态 ⇒ 必须真的碰不到浏览器（不出现 cdp/headless/launch/navigate）。 */
  {
    const dir = path.join(__dirname);
    const list = fs.readdirSync(dir).filter((f) => /^check-.*\.js$/.test(f) && f !== 'check-all.js');
    const STATIC_DECL = /静态审计[^\n]{0,40}不开浏览器/;
    const BROWSER_TOUCH = /cdp|headless|launch\(|Page\.navigate|remote-debugging/;
    const naked = [];
    const declaredStatic = [];
    for (const f of list) {
      const s = fs.readFileSync(path.join(dir, f), 'utf8');
      if (STATIC_DECL.test(s)) { declaredStatic.push(f); continue; }
      if (!/cache:\s*'no-store'/.test(s) && !/typeof\s+\w+\s*===?\s*"function"/.test(s)) naked.push(f);
    }
    ok('2026-10-04 每条界面检查都有版本指纹（共 ' + list.length + ' 条，其中声明"静态审计·不开浏览器"的 ' + declaredStatic.length + ' 条）',
      list.length >= 13 && naked.length === 0,
      naked.length ? '没指纹的：' + naked.join(',') : '');
    /* 反向对照（没有这一条，"声明"就成了万能逃生舱）：真碰浏览器的文件不许用这句话躲过去。 */
    const lying = declaredStatic.filter((f) =>
      BROWSER_TOUCH.test(fs.readFileSync(path.join(dir, f), 'utf8')));
    ok('2026-10-10 声明"静态审计·不开浏览器"的文件必须真的不开浏览器（谎报就红——否则这条豁免会把红线掏空）',
      lying.length === 0, lying.length ? '声明了却碰浏览器：' + lying.join(',') : declaredStatic.join(',') || '（没有声明者）');
  }

  /* ★ 2026-10-10（D3）：一条"跳过清单必须与挂前提的断言一一对应"的结构红线。
   *   ▎为什么值得单独钉：check:pill 加了"事件有没有送到页面"这条前提之后，
   *     依赖它的断言被 `if (hoverTriggered)` 挂住，而 SKIP 名单是**手抄的第二份**——
   *     我写完就少列了一条（挂住 5 条、名单只有 4 条）。
   *     少列的那条在前提不成立时**既没有 PASS 也没有 SKIP**，看报告的人会以为它跑了
   *     （坑 76/123：没跑过不等于通过，而"静默没跑"比红更难发现）。
   *   ▸ 判据：两份清单的数量必须相等——不靠"下次记得同步"（坑 40：纪律会被忘掉）。 */
  {
    const src = fs.readFileSync(path.join(__dirname, 'check-pill-rise.js'), 'utf8');
    const gated = (src.match(/if \(hoverTriggered\) ok\(/g) || []).length;
    const skipBlock = /const SKIP = \[([\s\S]*?)\];/.exec(src);
    const listed = skipBlock ? (skipBlock[1].match(/^\s*['\x27]/gm) || []).length : -1;
    ok('2026-10-10 check:pill 的 SKIP 名单与"挂了前提的断言"数量一致（少一条就是静默没跑）',
      gated > 0 && listed === gated, `挂前提 ${gated} 条 · SKIP 名单 ${listed} 条`);
  }


  /* ═════ 2026-10-07 第 51 步：共享文件浏览（前端）═════ */
  console.log('\n--- 第 51 步 共享文件浏览（前端）---');
  {
    const g = (expr) => vm.runInContext(expr, ctx);
    const clientSrc51 = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'client.js'), 'utf8');
    const cssSrc51 = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'style.css'), 'utf8');
    const html51 = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'index.html'), 'utf8');
    const overlayEl = documentStub.getElementById('filesOverlay');
    const fBtn = documentStub.getElementById('filesBtn');

    ok('51 index.html 有「文件」按钮与面板骨架（清单/阅读器/工具条/拖拽遮罩）',
      ['filesBtn', 'filesOverlay', 'filesList', 'filesStage', 'filesFollowBtn', 'filesUploadBtn',
       'filesPick', 'filesDropVeil', 'filesPrevBtn', 'filesZoomInBtn', 'filesDlBtn', 'filesQuota']
        .every((id) => html51.indexOf('id="' + id + '"') >= 0),
      ['filesBtn', 'filesOverlay'].filter((i) => html51.indexOf('id="' + i + '"') < 0).join(','));

    // 进房前不该能点
    g('myRoom=null;myRoomToken=null;setFilesOpen(false);filesBtn.disabled=true;');
    fBtn.dispatch('click');
    ok('51 没进房时点「文件」不开面板（也不弹原生对话框——弹窗会阻塞主线程，坑 69）',
      g('filesOn') === false);

    // 进房后按钮该亮
    /* ★ 必须先清 myRoom 再调 enterRoom：它开头就是 `if (myRoom) return;`
     *   （room-created 与 room-members 会各触发一次，靠这个守卫去重）。
     *   第一版我先设了 myRoom 再调，等于调了一次空函数——**症状是"按钮没亮"，
     *   而真相是我压根没执行到那一行**（坑 55：测之前先确认自己真站在那个状态上）。 */
    g("myRoom=null;myRoomToken=null;enterRoom('123456');myRoomToken='tok';");
    ok('51 进房后「文件」按钮解除禁用（不依赖摄像头）', fBtn.disabled === false,
      `disabled=${String(fBtn.disabled)}`);

    // 开关面板
    g('setFilesOpen(true)');
    ok('51 点开后面板从 hidden 里出来', !overlayEl.classList.contains('hidden') && g('filesOn') === true);
    g('setFilesOpen(false)');
    ok('51 再点一次关掉面板', g('filesOn') === false && overlayEl.classList.contains('hidden'));

    // 与白板互斥（两块"接管舞台"的覆盖层不该叠着）
    g('setBoardOpen(true);setFilesOpen(true);');
    ok('51 开着白板时打开文件面板 → 白板自动收起（互斥，不叠层）',
      g('boardOn') === false && g('filesOn') === true);
    g('setFilesOpen(false);setBoardOpen(true);');
    ok('51 反向也成立吗？不必——白板是"画"，打开它不该吞掉正在看的文档（只要求不同时可见）',
      g('boardOn') === true);
    g('setBoardOpen(false)');

    // 清单渲染 + XSS
    const MY_SID51 = String(g('socket.id'));
    /* 清单走**进房补发**这条路喂进来（emit('files-state')），而不是直接改客户端变量：
     *   既让 files-state 这条链路真被跑到，也不会出现"测试替代码赋了个值，
     *   而真实路径从来没产生过那个值"的假绿。配额也顺带落地（renderFilesQuota 要读它）。 */
    emit('files-state', {
      files: [
        { name: '评审会材料.md', size: 2048, ts: Date.now(), byId: MY_SID51, byName: '小张' },
        { name: 'Q3 预算.xlsx', size: 40000, ts: Date.now(), byId: '别人', byName: '小李' },
        { name: '<img src=x onerror=alert(1)>.pdf', size: 1, ts: Date.now(), byId: '别人', byName: '攻击者' },
        { name: '坏"名字.pdf', size: 1, ts: Date.now(), byId: '别人', byName: '攻击者' },
      ],
      view: null,
      limits: { maxFileBytes: 41943040, maxRoomBytes: 419430400, maxCount: 60 },
    });
    rec.filesData = [];
    /* isOwnerOrAdmin() 的口径是"从 room-state 权威快照里找我那一行"（与 D4 踢人按钮同源）。
     *   前面几段测试已经往 lastMembers 里放过成员数据，所以这里显式钉成普通成员。 */
    g("lastMembers=[{id:socket.id,owner:false,role:'member'},{id:'别人',owner:true,role:'member'}];renderFilesList();")
    const listHtml = String(documentStub.getElementById('filesList').innerHTML);
    ok('51 清单渲染出文件名、大小与上传者',
      listHtml.indexOf('评审会材料.md') >= 0 && listHtml.indexOf('2.0 KB') >= 0
      && listHtml.indexOf('39 KB') >= 0 && listHtml.indexOf('小李') >= 0,
      (listHtml.match(/file-meta[^<]*<[^>]*>[^<]*/) || [''])[0]);
    ok('51 ★ 恶意文件名不会变成标签（文本上下文转义）',
      listHtml.indexOf('<img src=x') < 0 && listHtml.indexOf('&lt;img') >= 0);
    /* 属性上下文的核心风险不是"字样出现"，而是引号把属性劈开：
     *   `data-name="a" onerror="..."` 才是洞；`data-name="&lt;img onerror=...&gt;"` 完全无害。
     *   所以喂一个真带引号的文件名进去、断言它变成 &quot; —— 这才是"转义真做了"的证据。
     *   只搜 onerror 字样会把安全的输出判成不安全，是假红制造机。 */
    ok('51 ★★ 文件名里的引号被转义成 &quot;（劈不开属性 = 接不上 onerror）',
      listHtml.indexOf('data-name="坏&quot;名字.pdf"') >= 0,
      (listHtml.match(/data-name="坏.{0,40}/) || [''])[0]);
    ok('51 我自己传的那一行标了"我"、别人的那一行不标',
      /评审会材料\.md[\s\S]{0,220}?· 我</.test(listHtml)
      && !/Q3 预算\.xlsx[\s\S]{0,220}?· 我</.test(listHtml));
    ok('51 删除按钮只给"上传者本人"那一行显示（我是普通成员、不是房主）',
      (listHtml.match(/data-act="del"/g) || []).length === 1,
      `找到 ${((listHtml.match(/data-act="del"/g) || []).length)} 个，我=${MY_SID51}`);
    /* 反向对照：换成房主要每一行都出现删除按钮。只测"少显示"不测"多显示"，
     * 判据就只有一侧——写成"永远不给我按钮"也能绿（坑 106/109 同一条）。 */
    g("lastMembers=[{id:socket.id,owner:true,role:'member'}];renderFilesList();");
    const listHtmlOwner = String(documentStub.getElementById('filesList').innerHTML);
    ok('51 换成房主身份后每一行都给出删除入口（同一条判据的反向对照）',
      (listHtmlOwner.match(/data-act="del"/g) || []).length === 4,
      String((listHtmlOwner.match(/data-act="del"/g) || []).length));
    g("lastMembers=[{id:socket.id,owner:false,role:'member'}];");

    // 配额行
    const quotaHtml = String(documentStub.getElementById('filesQuota').textContent || '');
    ok('51 配额行把"已用/上限/个数/单文件上限"摊开（用户撞上限时要能自己看懂）',
      quotaHtml.indexOf('40.0 MB') >= 0 && quotaHtml.indexOf('4/60') >= 0
      && quotaHtml.indexOf('已用') >= 0, quotaHtml);

    const emitCount = (ev) => rec.emits.filter((e) => e === ev).length;
    const toastText = () => String(documentStub.getElementById('toast').textContent || '');

    // 打开一份 Markdown —— 真走 fileview.js 那条路
    rec.fileContent = '# 标题\n\n**重点** 内容\n\n| a | b |\n|:-:|--:|\n| 1 | 2 |\n';
    await (async () => { guard('51 打开 md', () => g('openFileByName("评审会材料.md")')); })();
    await new Promise((r) => setTimeout(r, 60));
    const stageHtml = String(documentStub.getElementById('filesStage').innerHTML || '');
    ok('51 ★ 文档渲染真的走内核（FV 在桩里是活的，不是永久不测那条降级分支）',
      stageHtml.indexOf('<strong>重点</strong>') >= 0 && stageHtml.indexOf('fv-tbl') >= 0,
      stageHtml.slice(0, 160));
    ok('51 工具条出现文件名与类型徽标，且 md 显示缩放不显示翻页',
      String(documentStub.getElementById('filesDocName').textContent).indexOf('评审会材料.md') >= 0
      && !documentStub.getElementById('filesZoomInBtn').classList.contains('hidden')
      && documentStub.getElementById('filesPrevBtn').classList.contains('hidden'));
    /* ★ 前提要显式摆出来（坑 55/63）：广播这条动作只在"我在同步环里"时发生，
     *   而上面几步为了测"关面板"把跟随一起关了（那是**正确的产品行为**：
     *   关面板=明确说这块地方我不要看）。原先这里直接调 emitFileView 就断言载荷，
     *   测的是"跟着的人"，站的却是"自由浏览的人"——本轮给 emitFileView 加了
     *   "不跟随就不发"的守卫之后它当场红，红的正是这个没说出口的前提。 */
    g('setFilesOpen(true);openFileByName("评审会材料.md");');
    await new Promise((r) => setTimeout(r, 60));
    ok('51 前提：此刻面板开着、跟随开着（"我要跟大家一起看"这个人才能带动大家）',
      g('filesOn') === true && g('filesFollow') === true,
      JSON.stringify({ on: g('filesOn'), follow: g('filesFollow') }));
    g('emitFileView(true)');
    const lastView51 = (rec.filesViews || []).slice(-1)[0] || {};
    ok('51 广播出去的载荷指向我正在看的这一份（跟随时别人要知道看哪份）',
      lastView51.name === '评审会材料.md' && lastView51.page >= 1
      && typeof lastView51.scroll === 'number' && lastView51.zoom > 0,
      JSON.stringify(lastView51));
    ok('51 点列表那一行 = 打开 + 立刻广播（两个动作绑在同一个处理器里，不靠"记得调用"）',
      /openFileByName\(name\);\s*\n\s*emitFileView\(true\);/.test(clientSrc51));

    // 比例而不是像素
    const payload51 = g('currentViewPayload()');
    ok('51 滚动位置用 0~1 的比例（传像素会在别人的窗口高度上滚过头）',
      typeof payload51.scroll === 'number' && payload51.scroll >= 0 && payload51.scroll <= 1,
      JSON.stringify(payload51));
    ok('51 载荷带 name/page/zoom 三项（跟随要够用的那三样）',
      !!payload51.name && payload51.page >= 1 && payload51.zoom > 0, JSON.stringify(payload51));

    // 跟随：别人换文件 → 我跟上
    g('filesData=filesData.concat([{name:"Q3 预算.xlsx",size:40000,byId:"别人",byName:"小李"}]);renderFilesList();');
    g('setFilesOpen(false);setFilesFollow(true);');
    g('applyRemoteView({name:"Q3 预算.xlsx",page:2,scroll:0.25,zoom:1,byId:"别人",byName:"小李"})');
    await new Promise((r) => setTimeout(r, 60));
    ok('51 ★ 跟随开着：别人换文件 → 我的面板自动起来并打开同一份',
      g('filesOn') === true && g('filesOpen') && g('filesOpen.name') === 'Q3 预算.xlsx',
      String(g('filesOpen') && g('filesOpen.name')));
    ok('51 "谁在带大家看"徽标写的是别人而不是我（同步这件事必须看得见）',
      String(documentStub.getElementById('filesWho').textContent).indexOf('小李') >= 0
      && !documentStub.getElementById('filesWho').classList.contains('hidden'),
      String(documentStub.getElementById('filesWho').textContent));

    // 断环：应用别人状态的那段时间不许往外广播
    const beforeEmit51 = emitCount('files-view');
    g('applyingRemote=true;emitFileView(true);applyingRemote=false;');
    ok('51 ★★ 应用远端状态期间不再广播（否则两个客户端会把彼此推到死循环）',
      emitCount('files-view') === beforeEmit51,
      `${beforeEmit51} → ${emitCount('files-view')}`);
    ok('51 自己发的视角不回环给自己（byId===我 时不动界面）',
      g('applyRemoteView({name:"评审会材料.md",byId:socket.id,page:9})') === undefined
      && g('filesOpen.name') === 'Q3 预算.xlsx');

    // 关掉跟随：别人再动我也不跟
    g('setFilesFollow(false)');
    ok('51 跟随关掉后文案变"自由浏览"，且只写内层那个 span（图标不会被抹掉——坑 77）',
      String(documentStub.getElementById('filesFollowTxt').textContent) === '自由浏览'
      && documentStub.getElementById('filesFollowTxt') !== documentStub.getElementById('filesFollowBtn'));
    ok('51 跟随按钮的图标写在 HTML 的静态节点里（不靠 JS innerHTML 重建，所以刷新前后同一份）',
      /id="filesFollowBtn"[\s\S]{0,400}<svg/.test(html51));
    g('applyRemoteView({name:"评审会材料.md",byId:"别人",byName:"小李"})');
    await new Promise((r) => setTimeout(r, 40));
    ok('51 跟随关着：别人换文件我不跟（但我看得见是谁在带）',
      g('filesOpen.name') === 'Q3 预算.xlsx'
      && String(documentStub.getElementById('filesWho').textContent).indexOf('小李') >= 0);

    // 关闭面板 = 不再跟随（一条规则，不设"60 秒不弹"的定时器）
    g('setFilesOpen(false)');
    ok('51 ★ 关闭面板顺手关掉跟随（关面板就是明确说"这块地方我不要看"）',
      g('filesFollow') === false);

    // 服务器广播：我正在看的那份被删
    /* ★ 先重开面板并重新打开一份文件——上一步"关闭面板"已经把 filesOpen 清成 null 了
     *   （那是**正确的产品行为**：关面板要撤销 blob URL、别把内存挂着）。
     *   第一版我直接在关掉之后去断言"删掉正在看的会提示"，条件根本不成立，
     *   红的是我测的顺序，不是代码（坑 55/80：先确认自己站在哪个状态上、再看有没有毛病）。 */
    /* 重开面板会**自己去拉一次清单**（setFilesOpen 里那句 !filesData.length → fetchFilesList），
     *   所以先把 fetch 桩的清单喂回去——顺便这就是"重开面板清单会刷新"这条行为被跑到了。 */
    rec.filesData = [
      { name: '评审会材料.md', size: 2048, byId: MY_SID51, byName: '小张' },
      { name: 'Q3 预算.xlsx', size: 40000, byId: '别人', byName: '小李' },
    ];
    g('filesData=[];setFilesOpen(true);');
    await new Promise((r) => setTimeout(r, 60));
    ok('51 重开面板会重新拉清单（不是拿一份陈到发臭的本地缓存糊弄）',
      g('filesData.length') === 2, String(g('filesData.length')));
    ok('51 重开面板会重新打开跟随（"关面板=不跟随 / 开面板=要跟大家一起看"是同一条规则的两半）',
      g('filesFollow') === true);
    g('openFileByName("评审会材料.md")');
    await new Promise((r) => setTimeout(r, 80));
    ok('51 重新打开的那一份进了 filesOpen', !!g('filesOpen') && g('filesOpen.name') === '评审会材料.md');
    emit('files-updated', { files: [], change: 'remove', name: '评审会材料.md' });
    ok('51 别人删掉我正在看的那一份 → 明说并清屏，而不是留一片"加载失败"',
      g('filesOpen') === null && toastText().indexOf('已被删除') >= 0, toastText());
    emit('files-state', { files: [{ name: '只有这一份.txt', size: 3, ts: Date.now(), byName: '小张' }], view: null, limits: { maxFileBytes: 41943040, maxRoomBytes: 419430400, maxCount: 60 } });
    ok('51 files-state（进房补发）会把清单与配额都接住',
      g('filesData.length') === 1 && !!g('filesLimits') && g('filesLimits').maxCount === 60);

    // 房间没了要一起作废
    g('setFilesOpen(true);');
    g('giveUpRoom("自测：房间被回收")');
    ok('51 ★ 房间没了 → 面板关掉、按钮禁用、清单清空（不留一张指向死房间的表格）',
      g('filesOn') === false && g('filesData').length === 0 && fBtn.disabled === true);

    // 结构红线
    ok('51 面板登记进 Esc 分层表（Esc 关的是最上面那一层，不能漏新加的这层）',
      /id: 'filesOverlay', name: '共享文件'/.test(clientSrc51));
    ok('51 CSS 让出 --stack-h 且 z-index 停在画面格之上、底部那一列之下（坑 80/114 同一条）',
      /\.files-overlay \{[\s\S]{0,600}?bottom: calc\(var\(--stack-h, 118px\) \+ 10px\);[\s\S]{0,120}?z-index: 4;/.test(cssSrc51));
    ok('51 上传用 XHR 而不是 fetch（fetch 报不了上传进度，界面会一动不动）',
      /new XMLHttpRequest\(\)/.test(clientSrc51) && /xhr\.upload\.onprogress/.test(clientSrc51));
    ok('51 blob: URL 有撤销路径（开一场会翻十几份大 PPT 不能一直占着内存）',
      (clientSrc51.match(/URL\.revokeObjectURL/g) || []).length >= 2);
    /* 剥掉注释再判：我自己那条注释里就写着"?roomToken= 塞进链接"作为反面说明，
     * 直接扫源码会被**自己的注释**判红（坑 103 末段那条纪律：计数型断言会算上注释）。
     * 剥注释同时还堵住了另一个洞：被注释掉的规则不该算"写了"（坑 76 那一族）。 */
    const onlyCode51 = clientSrc51.slice(clientSrc51.indexOf('共享文件浏览（全房间同时看同一份文档）'))
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    ok('51 取字节只走请求头带令牌，不把令牌拼进 URL（查询串会进浏览器历史与访问日志）',
      !/roomToken=/.test(onlyCode51) && /X-Room-Token/.test(onlyCode51),
      (onlyCode51.match(/.{0,50}roomToken=.{0,20}/) || [''])[0]);
    ok('51 客户端与服务器**共用**同一条 URL 形状（/files/<房>/<名>，两端各写一份就必须钉住）',
      /pathname\.startsWith\('\/files\/'\)/.test(fs.readFileSync(path.join(__dirname, '..', 'sfu', 'server.js'), 'utf8'))
      && /`\/files\/\$\{encodeURIComponent/.test(clientSrc51));
    ok('51 渲染只走 FV 一条路（client.js 里不许出现第二套 zip/xml/markdown 解析）',
      !/DecompressionStream|inflateRaw|DOMParser/.test(clientSrc51));

    /* ★ 2026-10-08（I1）PDF 换页的形状：这一条留在冒烟里是因为它**不需要浏览器就能挡住回退**。
     *   真凶是"只改 iframe.src 的片段"——浏览器把它当成同一文档内的片段跳转，
     *   内置 PDF 插件只在**加载文档**时读 #page=，于是翻页按钮点了没反应、还零报错
     *   （两页像素量出来一字不差：58.9% vs 58.9%）。真浏览器那条像素断言在 check:files 里，
     *   这里钉的是**代码形状**：换页只能走 mountPdf（重建挂载），不许再出现 `fr.src =`。
     *   ▸ 为什么不在这里断言"children 里恰好一个 iframe"：桩的 querySelector 是**自动造元素**的
     *     （坑 27 家族），它不去 children 里找真节点——那是桩的边界，硬凑断言只会测到桩。 */
    const setPageBody51 = (clientSrc51.match(/function setPage\(p\) \{[\s\S]*?\n\}/) || [''])[0];
    const setPageQuietBody51 = (clientSrc51.match(/function setPageQuiet\(p\) \{[\s\S]*?\n\}/) || [''])[0];
    ok('51 ★ 两处换页都走 mountPdf（重建挂载，不是只改片段）',
      setPageBody51.indexOf('mountPdf(') >= 0 && setPageQuietBody51.indexOf('mountPdf(') >= 0,
      JSON.stringify({ setPage: setPageBody51.indexOf('mountPdf(') >= 0, quiet: setPageQuietBody51.indexOf('mountPdf(') >= 0 }));
    ok('51 ★ 换页路径里不许再出现"只改 fr.src"那种写法（它看起来对、实际不翻页）',
      !/fr\.src\s*=/.test(setPageBody51) && !/fr\.src\s*=/.test(setPageQuietBody51));
    ok('51 mountPdf 用内核的 pdfSrc 拼片段（#page= 的形状全项目只有一处）',
      /function mountPdf[\s\S]{0,900}?FV\.pdfSrc\(/.test(clientSrc51));
    ok('51 mountPdf 带"同一页别重建"的守卫（否则每次跟随都闪一下阅读器）',
      /getAttribute\('src'\)\s*===\s*want/.test(clientSrc51));
    /* ★ 结构红线：**"我打开一份文件"这件事只许有一个用户入口**。
     *   `openFileByName()` 只管"我屏幕上出现它"，"把视角播给全房间"是第二个动作，
     *   原先这两行写在两个调用点后面（列表点击 / 回车键）——那就是"记得写两行"的纪律，
     *   而纪律会被忘掉（坑 40 的原话）。忘了的症状还**不报错**，是"别人屏幕上静默不跟"，
     *   正是用户会报的那句"不同步"。本轮我写这条真浏览器检查时自己就漏了一次广播，
     *   所以这条红线是拿来挡下一个加入口的人的。
     *   ▸ 判据：裸 `openFileByName(` 只许出现 3 次 = 定义 / openFileAsMine 内部 /
     *     applyRemoteView（跟着别人看时**故意不广播**，否则跟随者把"谁在带"抢走）。
     *     第 4 次就是有人加了新入口没走 openFileAsMine。 */
    const bareOpen51 = (onlyCode51.match(/\bopenFileByName\s*\(/g) || []).length;
    ok('51 ★ 打开文件只有一个用户入口：裸 openFileByName 只许 3 处（定义 / 唯一入口内部 / 跟随应用）',
      bareOpen51 === 3, `实得 ${bareOpen51} 处`);
    ok('51 列表点击与键盘回车都走 openFileAsMine（少一个就是"点了别人不跟"）',
      (onlyCode51.match(/\bopenFileAsMine\s*\(/g) || []).length === 3
      && /openFileAsMine\(name\)/.test(onlyCode51));

    /* ★ 2026-10-08 下半场：「跟随」的解耦必须是**双向**的（真浏览器 S 组量出来的方向性缺陷）。
     *   实测原景：B 关掉跟随只想自己翻一翻 → 一翻页**全房被 B 拽走**；
     *   B 再点一下那颗写着「跟随主讲」的按钮 → 代码走的是 `emitFileView(true)`，
     *   等于 B 宣布"接下来由我带大家看"，而 A 侧徽标变成"跟着 某位成员"、屏幕被换掉。
     *   ▸ 用户说"我只想看自己那份"时，**只能他这一边动**——做错方向比少做一个功能更糟
     *     （与 10-06 那条"别切宫格，把白板打开"是同一种病：把用户的意思做反）。
     *   ▸ 修法两条，各自钉一条：① `emitFileView` 加"不跟随就不发"的守卫；
     *     ② 那颗按钮改调 `rejoinPresenterView()`——它复用 applyRemoteView 那条正路
     *       （面板没开要开 / 同一份只调页码与滚动 / 主讲关了就别抽走我的屏），不写第二份（坑 47）。
     *   ▸ 下面三条 emit 计数是**同一个参照点**：从"自由浏览"到"跳回主讲"整段路，
     *     对外广播次数一次都不许涨——涨了就是抢主讲（行为断言，比读源码硬）。 */
    rec.filesData = [
      { name: '评审会材料.md', size: 2048, byId: '别人', byName: '小李' },
      { name: '只有这一份.txt', size: 3, byId: '小张', byName: '小张' },
    ];
    /* vm 里的 filesData 也要摆平（openFileByName 第一步就是"清单里有没有这一行"，
     *   缺这条它会直接 toast 拒绝——那测的就是我的夹具不是产品了，坑 55）。
     *   ▸ 同理 myRoom/myRoomToken：上面那条"房间没了"的用例把它们清了，
     *     不补回来的话 openFileByName 会在门口就 return，症状是"跟随没跳回来"（本轮就这么红过一次）。 */
    g('myRoom="123456";myRoomToken="tok51";'
      + 'filesData=[{name:"评审会材料.md",size:2048,byId:"别人",byName:"小李"},'
      + '{name:"只有这一份.txt",size:3,byId:"小张",byName:"小张"}];renderFilesList();setFilesOpen(true);');
    await new Promise((r) => setTimeout(r, 60));
    ok('51 前提：面板开着、跟随开着（只有"此刻在同步环里"的人才该带动大家）',
      g('filesOn') === true && g('filesFollow') === true,
      JSON.stringify({ on: g('filesOn'), follow: g('filesFollow') }));
    /* ★ 下面**两下都真点那颗按钮**（桩的 dispatch 会跑注册在它上面的监听）。
     *   第一版这里写的是直接调 `setFilesFollow()` / `rejoinPresenterView()`，
     *   于是 A/B 变异（把处理器改回旧的 `emitFileView(true)`）只红了结构那条、
     *   行为断言跟着绿——"按钮里究竟写的是哪一行"没人测（坑 41/56：接线必须被断言覆盖）。 */
    const followBtn51 = documentStub.getElementById('filesFollowBtn');
    followBtn51.dispatch('click');
    ok('51 第一下：这颗按钮把跟随关掉了（进入自由浏览）',
      g('filesFollow') === false, String(g('filesFollow')));
    g('openFileByName("只有这一份.txt");');
    await new Promise((r) => setTimeout(r, 100));
    g('filesView={name:"评审会材料.md",page:1,scroll:0,zoom:1,byId:"别人",byName:"小李"};');
    const beforeFreeEmit51 = emitCount('files-view');
    g('emitFileView(true);setPage(3);');
    ok('51 ★★ 跟随关着时**不往外广播**（只挡"收"不挡"发"就会把全房拽走——实测过的方向缺陷）',
      emitCount('files-view') === beforeFreeEmit51, `${beforeFreeEmit51} → ${emitCount('files-view')}`);
    followBtn51.dispatch('click');
    await new Promise((r) => setTimeout(r, 160));
    ok('51 ★★ 重新打开跟随 = 我跳回主讲那一份（这颗按钮的意思是"我跟上去"，不是"你们跟我"）',
      !!g('filesOpen') && g('filesOpen.name') === '评审会材料.md',
      JSON.stringify({ open: g('filesOpen') && g('filesOpen.name'), on: g('filesOn'),
        room: g('myRoom'), tok: !!g('myRoomToken'), rows: g('filesData.length'),
        view: g('filesView') && g('filesView').name, toast: toastText() }));
    ok('51 ★★ 反向对照：这一趟"跳回来"走的是跟的那条路，广播次数一次都没涨（主讲权没有换手）',
      emitCount('files-view') === beforeFreeEmit51, `${beforeFreeEmit51} → ${emitCount('files-view')}`);
    ok('51 跟上之后徽标仍写明"跟着 小李"（我跳过去不等于我成了主讲，谁在带要说得出人）',
      String(documentStub.getElementById('filesWho').textContent).indexOf('小李') >= 0,
      String(documentStub.getElementById('filesWho').textContent));
    const emitBody51 = (clientSrc51.match(/function emitFileView\(immediate\) \{[\s\S]*?\n\}/) || [''])[0];
    ok('51 emitFileView 里那条"不跟随就不发"的守卫还在（它是方向性缺陷的守门人，不是冗余）',
      /if \(!filesFollow\) return/.test(emitBody51),
      emitBody51.replace(/\s+/g, ' ').slice(0, 100));
    /* 抓那颗按钮的处理器：`if (filesFollowBtn) filesFollowBtn.addEventListener(...)` ——
     * 用 `filesFollowBtn)` 去锚会被那句 if 的括号骗到（第一版就是这么抓到 0 字符的），
     * 直接锚 `filesFollowBtn.addEventListener(` 到行首的 `});` 这一段。 */
    const followHandler51 = (onlyCode51.match(/filesFollowBtn\.addEventListener\([\s\S]{0,600}?\n\}\);/) || [''])[0];
    ok('51 ★ 结构红线：那颗按钮的处理器里不许出现 emitFileView(（一按就抢主讲，实测过）',
      followHandler51.length > 60 && !/emitFileView\s*\(/.test(followHandler51),
      `抓到 ${followHandler51.length} 字符`);
    ok('51 「回到主讲」只有一条路：rejoinPresenterView 定义一次 + 被那颗按钮调用一次',
      (onlyCode51.match(/\brejoinPresenterView\s*\(/g) || []).length === 2
      && /function rejoinPresenterView\(\) \{/.test(onlyCode51),
      `计数 ${(onlyCode51.match(/\brejoinPresenterView\s*\(/g) || []).length}`);
    /* ★ 另一条同源红线：**"人在会里"必然蕴含"首屏那层收起了"**。
     *   真事故：#prejoin 是 .app 的兄弟、z100 的整屏遮罩，原先只有点「进入会议」才收；
     *   任何别的进房路径都留下"landing 盖着会议界面"这个点不到任何东西的状态，
     *   而 DOM 属性全对——只有命中测试看得见（本轮靠它抓到，见 check-files.js 那段注释）。 */
    ok('51 ★ 进房路径里收了首屏遮罩（dismissPrejoin 由 enterRoom 调用，不只在按钮处理里）',
      /function enterRoom[\s\S]{0,1200}?dismissPrejoin\(\)/.test(clientSrc51)
      && /function dismissPrejoin/.test(clientSrc51));
  }

  /* ════════════════════════════════════════════════════════════════
   * ★ 2026-10-09 第 52 步：账号（身份牌 / 退出登录 / 忘记密码 / 治理台）
   * ▎用户原话三件事："没有退出登录的效果""没有忘记密码的效果""管理员没有实质的区别"。
   *   审计定位到的根因不是"少三颗按钮"：
   *   ① 登录卡的开合是**单向**的——全文件只有 hideAuth()，登录后没有任何路径能回到登录卡；
   *   ② 登录态散在四个落点（localStorage 的 wb_auth、模块级昵称、头像、每小时续期定时器），
   *      没有一条统一的撤销路径——所以"退出"缺的是反面，不是一颗按钮；
   *   ③ 管理员的独占能力（观测面板 / 录像 / 金标准 / metrics 四个 HTTP 端点）**只在文档里**，
   *      界面上和普通成员一模一样。
   * ▎这一档的断言重点因此是**状态迁移**而不是外观：
   *   点两下那颗按钮之后，四个落点必须**全部**归零，且聊天署名、身份牌、治理台一起跟着变。
   *   判据一律读变量（myAuth / myDisplayName），不读按钮文字（坑 97 那条事故：
   *   给人看的字符串当机器判据，改版那天就静默反转）。
   * ════════════════════════════════════════════════════════════════ */
  console.log('\n--- 第 52 步 账号：退出登录 / 身份可见（前端）---');
  {
    const src49 = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'client.js'), 'utf8');
    const code49 = src49.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const css49 = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'style.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const html49 = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'index.html'), 'utf8');
    const V = (expr) => vm.runInContext(expr, ctx);
    const el49 = (id) => documentStub.getElementById(id);
    const hid = (id) => el49(id).classList.contains('hidden');
    const toast49 = () => String(el49('toast').textContent || '');
    const logoutEmits = () => rec.logouts.length;

    /* 前提（坑 55/63：先断言"我确实站在你以为的那个状态里"，否则后面的红都在说假话）。
     *   09-16 那段已经用真路径登录过（tester / tok-test-123）。 */
    ok('52 前提：上面那次登录真的落地了（myAuth + localStorage 两处一致）',
      V('myAuth.username') === 'tester' && JSON.parse(storageData.wb_auth || '{}').token === 'tok-test-123',
      JSON.stringify({ u: V('myAuth.username'), stored: storageData.wb_auth && '有' }));

    // ① 身份牌：登录后它写的就是我的名字，且"登录中"这一态看得见
    V('renderAccount()');
    ok('52 身份牌显示我的昵称（文字只是 myAuth 的一个视图）',
      String(el49('userChipTxt').textContent) === 'tester' && V('myAuth.displayName') === 'tester',
      String(el49('userChipTxt').textContent));
    ok('52 登录后身份牌进 active 态、idle 态摘掉（两态互斥，不是叠着）',
      el49('userChip').classList.contains('active') && !el49('userChip').classList.contains('idle'),
      [...el49('userChip').classList._s].join(','));

    // ② 面板开合：点身份牌开、再点关；关闭键也关（这一对互相印证，防止"监听根本没挂"换来回绿）
    el49('accountPanel').classList.add('hidden');
    guard('点开身份牌', () => el49('userChip').dispatch('click'));
    ok('52 点身份牌打开账号面板，aria-expanded 跟着说真话',
      !hid('accountPanel') && el49('userChip').getAttribute('aria-expanded') === 'true');
    guard('再点一次身份牌', () => el49('userChip').dispatch('click'));
    ok('52 再点一次收起（同一颗按钮是开也是关，不许只进不出）',
      hid('accountPanel') && el49('userChip').getAttribute('aria-expanded') === 'false');
    guard('重新打开面板', () => el49('userChip').dispatch('click'));

    // ③ 管理员的"实质区别"第一次可见：治理台只随服务器投影的 role 出现
    ok('52 普通成员看不到治理台（role 来自服务器快照，不是本地猜用户名）',
      hid('accountAdminBox'), String(V('!!(myRoomState() && myRoomState().role)')));
    guard('管理员快照', () => emit('room-state', {
      roomNumber: '123456', members: [{ id: V('socket.id'), owner: false, role: 'admin' }],
      hostId: null, controllerId: null, expiresAt: null,
    }));
    ok('52 role=admin 的快照一到，治理台现身并列出四个管理员专属页面',
      !hid('accountAdminBox') && (html49.match(/class="account-link"/g) || []).length === 4,
      `链接 ${(html49.match(/class="account-link"/g) || []).length} 个`);
    ok('52 治理台里那四条正是服务器 requireAdmin 的那四个路径（入口与门禁成对，不写假链接）',
      ['/dashboard', '/recordings.html', '/golden', '/metrics'].every((p) => html49.includes(`href="${p}"`)));

    // ④ 退出是两步确认：第一下只"上膛"，什么都不撤销、不发信令
    const beforeOut = logoutEmits();
    guard('退出第一下', () => el49('accountLogoutBtn').dispatch('click'));
    ok('52 第一下只把按钮变成待确认：不发 auth-logout、登录态一处没动',
      logoutEmits() === beforeOut && el49('accountLogoutBtn').dataset.armed === '1'
      && V('myAuth.username') === 'tester' && !!storageData.wb_auth,
      String(el49('accountLogoutBtn').textContent));

    // ⑤ 第二下：票发回服务器作废，四个落点**一起**清零——这就是"退出登录的效果"
    guard('退出第二下', () => el49('accountLogoutBtn').dispatch('click'));
    await new Promise((r) => setTimeout(r, 60));
    ok('52 第二下把这张票发回服务器（auth-logout 带 token，服务器才谈得上作废它）',
      logoutEmits() === beforeOut + 1 && rec.logouts[rec.logouts.length - 1].token === 'tok-test-123',
      JSON.stringify({ n: logoutEmits(), tok: rec.logouts[rec.logouts.length - 1] && '有' }));
    ok('52 ★ 落点一：localStorage 的 wb_auth 被清掉（dashboard / 录像 / 金标准三页共读它）',
      storageData.wb_auth === undefined, String(storageData.wb_auth));
    ok('52 ★ 落点二三四一起清：myAuth / 昵称 / 头像 / 续期定时器（少清一个就还有一个地方认为我是那位用户）',
      V('myAuth.username') === null && V('myDisplayName') === null
      && V('myAvatar') === null && !V('window.__authRefreshTimer'),
      JSON.stringify({ auth: V('myAuth.username'), name: V('myDisplayName'), timer: !!V('window.__authRefreshTimer') }));
    ok('52 退出后身份牌回到未登录态（active 摘掉、idle 回来），治理台也跟着消失',
      String(el49('userChipTxt').textContent) === '未登录'
      && !el49('userChip').classList.contains('active') && el49('userChip').classList.contains('idle')
      && hid('accountAdminBox'),
      String(el49('userChipTxt').textContent));
    ok('52 本地没登录态时不再采信旧快照里的 role（票都没了还挂着"管理员"就是界面在撒谎）',
      V('myRoomState()') === null);
    ok('52 退出 ≠ 离开会议：人还在房里（游客本来就可以在场，做成踢人就没人敢点退出）',
      V('myRoom') === '123456', String(V('myRoom')));
    ok('52 退出给出页内反馈（toast + 面板提示），不弹阻塞式原生弹窗（冒烟有全文件 alert 红线）',
      /退出/.test(toast49()) && /游客/.test(String(el49('accountHint').textContent)),
      JSON.stringify({ toast: toast49(), hint: String(el49('accountHint').textContent) }));

    // ⑥ 退出之后聊天署名回退：这是"效果"里最容易被漏的一格——只清了 localStorage 也会绿
    const sctpBefore49 = rec.sctpSends.length;
    const sigBefore49 = rec.chatSignals.length;
    el49('chatInput').value = '退出之后发的消息';
    guard('退出后发消息', () => el49('chatSendBtn').dispatch('click'));
    /* 两条路都要查：主路 SCTP 的 name 来自本地 myDisplayName，兜底信令的署名来自**服务器 socket 身份**。
     *   所以"退出有没有真的生效"必须两边都断言——只清本地而服务器不 dropIdentity，
     *   别人看到的名字仍然不变（服务器那半边由 test:sfu 钉）。 */
    ok('52 退出后消息发得出去（前提：这条断言量的是一次真发送）',
      rec.sctpSends.length > sctpBefore49 || rec.chatSignals.length > sigBefore49,
      JSON.stringify({ sctp: rec.sctpSends.length - sctpBefore49, sig: rec.chatSignals.length - sigBefore49 }));
    ok('52 ★ 主路 SCTP 不再带旧昵称（myDisplayName 是真判据，不是只清了存档）',
      rec.sctpSends.slice(sctpBefore49).every((x) => {
        try { return JSON.parse(x).name === undefined; } catch (e) { return false; }
      }), JSON.stringify(rec.sctpSends.slice(sctpBefore49).map((x) => { try { return JSON.parse(x).name; } catch (e) { return '坏'; } })));

    // ⑦ 真缺口那半边：登录后原来没有任何路径能回到登录卡——现在从面板能回去
    ok('52 退出后「登录 / 注册」这颗按钮回来了（它按 myAuth 显隐，不按文字）',
      !hid('accountLoginBtn') && hid('accountLogoutBtn'));
    el49('authOverlay').classList.add('hidden');
    guard('从面板去登录', () => el49('accountLoginBtn').dispatch('click'));
    ok('52 ★ 点「登录 / 注册」把登录卡重新打开并收起面板（showAuth 是这个文件里登录卡的唯一开入口）',
      !hid('authOverlay') && hid('accountPanel'));
    el49('authOverlay').classList.add('hidden');

    // ⑧ 忘记密码：不许编一个"重置链接已发送"的假样子（本项目没有邮件/短信通道）
    const emitsBefore49 = rec.emits.length;
    guard('点忘记密码', () => el49('authForgotBtn').dispatch('click'));
    const forgotMsg = String(el49('authMsg').textContent || '');
    ok('52 忘记密码明说"没有邮件/短信找回"（先否认假路径，再给真路）',
      /没有邮件/.test(forgotMsg) && /admin:passwd/.test(forgotMsg) && /npm run admin:passwd/.test(forgotMsg),
      forgotMsg.slice(0, 60));
    /* ★ 反向对照禁的是**假动作的措辞**，不是"邮件"这三个字——
     *   第一版把 邮件 整个拉进黑名单，于是它把自己那句诚实的"没有邮件/短信找回"判成红。
     *   要挡的是"重置链接已发送 / 请查收"这种让人去查一个不存在的邮箱的说法（坑 82：界面不许撒谎）。 */
    ok('52 ★ 反向对照：不许出现"已发送 / 请查收 / 重置链接已发"这类假动作',
      !/已发送|已发到|请查收|链接已发|重置链接已|发送到您/.test(forgotMsg), forgotMsg.slice(0, 60));
    ok('52 给管理员那条路（服务器不在自己机器上时，用户唯一能找的人）',
      /管理员/.test(forgotMsg));
    ok('52 点它不发任何信令（找回是本地/线下动作，不做假动作）',
      rec.emits.length === emitsBefore49, `${emitsBefore49} → ${rec.emits.length}`);

    // ⑨ 结构与接线红线：这三条防的是"下次有人把这处合并掉/漏掉一半"
    ok('52 wb_auth 的撤销只有一处：removeItem 只出现在 clearAuthState 里（两处各清 = 迟早漂）',
      (code49.match(/removeItem\('wb_auth'\)/g) || []).length === 1
      && /function clearAuthState[\s\S]{0,400}removeItem\('wb_auth'\)/.test(code49),
      `计数 ${(code49.match(/removeItem\('wb_auth'\)/g) || []).length}`);
    ok('52 接线一：auth-refresh 判失败时走 clearAuthState（原来只往折叠的日志里写一行=没效果）',
      /'auth-refresh'[\s\S]{0,700}resp\.error[\s\S]{0,200}clearAuthState\(/.test(code49));
    ok('52 接线二：room-state 一到就 renderAccount()（角色来自服务器投影，不主动重画就永远显示旧的）',
      /function renderMembers[\s\S]{0,120}renderAccount\(\)/.test(code49)
      || /lastMembers = members[\s\S]{0,300}renderAccount\(\)/.test(code49));
    ok('52 接线三：退出状态时那个 IIFE（存档失效）也走同一个收口，不再自己 removeItem',
      /catch \(err\) \{[\s\S]{0,600}?clearAuthState\('登录态已失效'\)/.test(code49));
    ok('52 账号面板登记进 Esc 分层表（浮层都要能被键盘关掉，新加的一层不许漏）',
      /\{\s*id:\s*'accountPanel'/.test(code49));
    ok('52 ★ 结构红线：不许用身份牌的文字判状态（坑 97 同款；判据一律是 myAuth）',
      !/userChipTxt\.textContent\s*===/.test(code49) && !/accountLogoutBtn\.textContent\s*===/.test(code49));

    // ⑩ CSS 两条：浮层上界由 L7 全仓红线管，这里钉它另两半 + 图标尺寸（坑 78）
    const panelCss49 = (css49.match(/\.account-panel\s*\{[^}]*\}/) || [''])[0];
    ok('52 CSS：治理台浮层自己滚动且不把滚动传给页面（overscroll 不夹住，滚到底会把整页带走）',
      /overflow-y:\s*auto/.test(panelCss49) && /overscroll-behavior:\s*contain/.test(panelCss49),
      panelCss49.replace(/\s+/g, ' ').slice(0, 90));
    ok('52 CSS：身份牌那颗 svg 有显式尺寸（它不是 .btn，兜不到 .btn .i；没尺寸的 svg 按 300×150 渲染撑爆顶栏）',
      /\.user-chip \.i\s*\{[^}]*width:/.test(css49));

    /* ★★ 两条今晚被真实事故逼出来的结构判据（事故形状：HTML 注释用 CSS 的收尾序列写了最后一行）：
     *   我写"忘记密码"那段注释时，收尾写成了 CSS 的那两个字符——HTML 注释不认它，
     *   于是 `<!--` 一直吞到文件里下一个合法闭合处，#authForgotBtn 与 #authMsg 双双"消失"、
     *   页面后半屏几何全是 0。**node --check 与冒烟一条都不红**（它们不看 HTML 注释），
     *   红的是 check:login 那条"11 个 id 一个没丢"——真浏览器 + 契约才抓得住。
     *   ▸ 所以这里补两条静态的：① 那条契约的静态版（不依赖起浏览器，改坏了第一时间红）；
     *     ② 坑 26/34 那条"注释里绝不写那个序列"的 HTML 版（今天实测：全文件 105 条注释、0 处误伤）。 */
    {
      const stripHtmlComments = (s) => s.replace(/<!--[\s\S]*?(-->|$)/g, '');
      const visible = stripHtmlComments(html49);
      const needIds = ['authUser', 'authPass', 'authName', 'authLoginBtn', 'authRegisterBtn',
        'authGuestBtn', 'authDeskBtn', 'authForgotBtn', 'authMsg', 'userChip',
        'accountPanel', 'accountName', 'accountRole', 'accountHint', 'accountAdminBox', 'roomInput'];
      const lost = needIds.filter((x) => !visible.includes(`id="${x}"`));
      ok('52 ★ id 契约（静态版）：这些 id 必须出现在**注释之外**（被注释吞掉时只有真浏览器看得见）',
        lost.length === 0, lost.length ? `被吞掉的 id：${lost.join(', ')}` : `已核对 ${needIds.length} 个 id`);
      const bodies = [];
      let cur = 0;
      for (;;) {
        const a = html49.indexOf('<!--', cur); if (a < 0) break;
        const b = html49.indexOf('-->', a + 4);
        bodies.push(b < 0 ? html49.slice(a + 4) : html49.slice(a + 4, b));
        cur = b < 0 ? html49.length : b + 3;
      }
      const badClose = bodies.filter((x) => /\*\//.test(x)).length;
      ok('52 ★ 结构红线：HTML 注释里不许出现 CSS 的收尾序列（写它=忘了闭合，整段页面会被吞进注释）',
        badClose === 0, `${bodies.length} 条注释里 ${badClose} 条含那个序列`);
    }
  }

  /* ★ 2026-10-10（B4「只有正向没有反向」审计）两张新账 + 三条结构红线。
   * ▎为什么这一批要写成红线而不是"我记得删了"：本轮改的四处撤销（发言账/数据通道订阅/
   *   房间录制会话/登录票）全都长在**同一条形状**上——正向写得很完整，反向只在"用户主动取消"
   *   那一条路径上做了，其余三条路径（断开/换 producer/房间销毁）各漏各的。
   *   这类缺陷的症状永远是"某个人莫名算不进比例""频道早关了台账还在"，而它**不报错**，
   *   只有把"必须有人删这一行"变成机器判据，下一个新调用点才会被拦下来（坑 40：纪律会被忘掉）。 */
  {
    const Talk = require(path.join(__dirname, '..', 'sfu', 'talk.js'));
    /* ① 分母只算在场的人：幽灵条目（已离开却没被清掉的 id）不许稀释剩下所有人的占比。
     *    这正是这条链原来的坏法——talk 表 5 条而成员 3 人时，在场三人各 20% 会被报成 12%。 */
    const t1 = Talk.talkShares(new Map([['a', 60], ['b', 60], ['c', 60], ['ghost1', 60], ['ghost2', 60]]), ['a', 'b', 'c']);
    ok('B4 发言占比：分母只算在场成员（幽灵条目不许把每个人的占比稀释下去）',
      t1.length === 3 && t1.every((r) => r.share === 33), JSON.stringify(t1));
    /* ② 没说过话的人在场上 ⇒ 仍然要出现一条 0（前端按人画格子；漏了这个人就是"名单上没他"）。 */
    const t2 = Talk.talkShares(new Map([['a', 30]]), ['a', 'b']);
    ok('B4 发言占比：在场但没说话的人有一条 0，而不是从名单里消失',
      t2.length === 2 && t2.some((r) => r.id === 'b' && r.share === 0), JSON.stringify(t2));
    /* ③ 没人说话 / 账本为空 / 账本不是 Map ⇒ 全 0，**不许出 NaN**。
     *    NaN 进了 room-talk-stats 会一路画成一条宽度 NaN 的进度条（CSS 静默丢掉样式，界面表现为"格子塌了"）。 */
    ok('B4 发言占比：total=0 与空账本都给全 0（NaN 进广播会把成员行的占比条整个弄塌）',
      Talk.talkShares(new Map(), ['a', 'b']).every((r) => r.share === 0)
      && Talk.talkShares(null, ['a']).every((r) => r.share === 0)
      && Talk.talkShares({}, ['a']).every((r) => r.share === 0));
    /* ④ 排序稳定 + 不改动入参：同一份账本两次调用必须给同样顺序（服务器"有变化才广播"
     *    靠的是 JSON 比对；顺序漂一次就多发一整轮广播，而面板会以为"有人在说话"）。 */
    const src = new Map([['a', 5], ['b', 40], ['c', 40]]);
    const kBefore = [...src.keys()].join(',');
    const r1 = Talk.talkShares(src, ['a', 'b', 'c']);
    const r2 = Talk.talkShares(src, ['a', 'b', 'c']);
    ok('B4 发言占比：同输入同输出（顺序漂 = 广播多一轮）且不写回账本',
      JSON.stringify(r1) === JSON.stringify(r2) && [...src.keys()].join(',') === kBefore && src.get('a') === 5,
      JSON.stringify(r1));
    /* ⑤ 负数与脏值按 0 处理：AudioLevelObserver 偶发给负秒数（时钟回拨/进程重启）时，
     *    一个负的条目会把总数压小、让别人占比超过 100%。 */
    const t5 = Talk.talkShares(new Map([['a', -100], ['b', 50], ['c', NaN]]), ['a', 'b', 'c']);
    ok('B4 发言占比：负值/NaN 当 0（否则总时长被压小、别人占比会超过 100%）',
      t5.find((r) => r.id === 'b').share === 100 && t5.find((r) => r.id === 'a').share === 0
      && t5.find((r) => r.id === 'c').share === 0, JSON.stringify(t5));
  }
  {
    const srvB4Raw = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'server.js'), 'utf8');
    /* ▎判据跑在**剥掉块注释**的源码上，理由与 CSS 那组同一条（本轮第一次跑就撞上）：
     *   我在 destroyRoom 里留着"这里原来是裸 remoteCtl.delete"的历史说明，
     *   而未剥注释的版本把那句**注释**读成了一次调用 ⇒ 一条正确的代码被判红。
     *   反过来也一样成立：被注释掉的清理调用不该算"写了"（坑 76：机制在、从不生效）。
     *   留着历史说明的注释是资产，不该被断言惩罚——所以要惩罚的是代码，不是文字。 */
    const srvB4 = srvB4Raw.replace(/\/\*[\s\S]*?\*\//g, '');
    /* ① destroyRoom 必须走两个收口函数，而不是裸 delete 那张表。
     *    ▸ 现存三条路径都先经过 disconnect 的 clearRemoteCtl，所以这**不是一条活缺陷**（我先证伪过）；
     *      但它值一条红线：将来谁加第四条销毁路径（比如管理员强制散会），
     *      裸 delete 会留下 ffmpeg 孤儿进程与 recordSessions 幽灵条目，而界面看起来"房间没了"。 */
    const dz = (srvB4.match(/function destroyRoom[\s\S]*?\n}/) || [''])[0];
    ok('B4 结构红线：destroyRoom 里必须调 stopRoomRecordings + clearRemoteCtl（不许裸删 remoteCtl）',
      /stopRoomRecordings\(/.test(dz) && /clearRemoteCtl\(/.test(dz) && !/remoteCtl\.delete\(/.test(dz),
      `dzLen=${dz.length}`);
    /* ② 发言账本要有"删掉这个人"那一步：room.talk 原先只有正向（每 400ms 攒秒数），
     *    没有任何删除路径 ⇒ 离开的人永久留在分母里，留下的人占比一起被压低。 */
    ok('B4 结构红线：成员断开时删自己的发言条目（只有攒账没有销账 = 幽灵把所有人的占比稀释）',
      /room\.talk\.delete\(socket\.id\)/.test(srvB4));
    /* ③ 断线要真的 close 数据通道订阅：原先只 clear 本地 Map，mediasoup 侧的 Consumer 没人关——
     *    长跑里每次重连都在服务端漏一个对象，而症状要等房间卡死才看得见。 */
    ok('B4 结构红线：断线清理里对每条 dataConsumer 真的调用 close()（不是只把台账清空）',
      /dataConsumers\.values\(\)\)[\s\S]{0,120}?\.close\(\)/.test(srvB4));
    /* ★ 2026-10-10（坑 145）一条只花三行的红线，防的是"占位符当凭据"这类**排查起来最贵**的错：
     *   我新写的快照助手把 Authorization 的值写成 `'***' + token`（记事过程里带出来的占位串），
     *   于是 /api/rooms 连续四轮 401，而四轮里我依次怀疑的是"票被删/TTL 被改短/请求写法/端口上有旧实例"——
     *   **全都错**，而且每一步看起来都有道理。
     *   ▸ 判据落地前先量了误伤面（坑 141 那条纪律）：全仓 scripts/ 与 agent/ 里 Authorization
     *     一共 19 处，值**全部**以 "Bearer " 开头 ⇒ 这条可以做成硬红线，不会拦任何人。
     *   ▸ 只查"以 Bearer 开头"，不查"等于某个变量"：后者会把合法写法管太死，太严的判据会被下一个人删掉。 */
    {
      const authFiles = ['scripts', 'agent'].flatMap((d) => {
        try {
          return fs.readdirSync(path.join(__dirname, '..', d))
            .filter((f) => f.endsWith('.js'))
            .map((f) => [d + '/' + f, fs.readFileSync(path.join(__dirname, '..', d, f), 'utf8')]);
        } catch (e) { return []; }
      });
      const bads = [];
      let seen = 0;
      for (const [rel, src] of authFiles) {
        /* 只认"值以引号/反引号开头"的那些：判据自己的源码里也写着 `Authorization:\s*(...`，
         * 若不排除，它会匹配到自己（下一行不是引号 ⇒ 跳过）。这属于坑 103 那一族——
         * 一条红线如果读得到"它自己的定义"，它就会把自己判成违规，而下一个人删的是红线不是代码。 */
        for (const m of src.matchAll(/Authorization:\s*(['"`])([^'"`]*)/g)) {
          seen++;
          const v = m[2];
          if (!v.startsWith('Bearer ')) bads.push(`${rel}: ${v.slice(0, 40)}`);
        }
      }
      ok(`B4 结构红线：测试与代理里的 Authorization 值必须以 "Bearer " 开头（扫到 ${seen} 处，占位串会伪装成凭据）`,
        seen >= 15 && bads.length === 0, bads.join(' | '));
    }
  }

  /* ★ 2026-10-09 这里本来要放一条全仓红线："模板字符串内部的注释不许出现反引号"。
   *   起因是今晚我给 check-theme 的注入代码 OPEN_OVERLAYS 写注释时用反引号包了两个类名，
   *   模板被提前截断 → 页面里炸 ReferenceError，而 node --check 全过（错在拼出来的字符串，不在源文件语法）。
   * ▸ 第一版判据扫 40+ 个文件报了 17 处，逐条看过去**全是误伤**：中文注释里包代码名是这本仓库的常规写法，
   *   要区分"注释在模板内部"必须连正则字面量一起解析（一个含单引号的正则会把我那个小状态机带偏），
   *   成本明显高于收益。而一条会误伤 17 处的红线，下一个人遇到就直接删掉——比不装更糟（坑 110 那条纪律）。
   * ▸ 所以换成**精确的那把尺**：谁拼代码给别的运行时执行，谁就在交付前让同一个引擎读一遍自己
   *   （见 scripts/check-theme.js 里那段 new Function 自检，以及 2026-10-08 同类的一处做法）。
   *   教训记在 AGENTS 第 7 节坑 26/141：同一个错误会换个载体复发（CSS 注释的闭合序列 → 模板的反引号）。 */

  // 用一段可执行的自检把这条纪律钉住：注入代码模板必须能被编译（写坏了当场红，不等浏览器）
  {
    const injectFiles = fs.readdirSync(__dirname).filter((f) => /^check-.*.js$/.test(f));
    const noGuard = injectFiles.filter((f) => {
      const s = fs.readFileSync(path.join(__dirname, f), "utf8");
      return /const [A-Z_]+ = `.?(async )?.?function/.test(s) && !s.includes('inject-check.js');
    });
    ok('★ 结构红线：每个拼装「注入浏览器的代码」的 check 脚本都要自带编译自检（模板被截断时 node --check 是不红的）',
      noGuard.length === 0, '缺自检：' + (noGuard.join(' , ') || '已扫 ' + injectFiles.length + ' 个 check 脚本'));
    /* 防错的机制如果没人测，它就只是一个装饰（坑 110 那条）——给这台守卫自己两条断言：
     *   正向：合法代码不许拦（会误伤的守卫会被下一个人删掉）；
     *   反向：坏代码必须让进程非 0 退出（只会打印警告的守卫等于没有）。 */
    const InjectCheck = require(path.join(__dirname, 'inject-check.js'));
    ok('inject-check 不许误伤：一段合法代码照常通过',
      InjectCheck.assertCompiles('self-test', { OK: '(function(){ return 1; })()' }) === true);
    const child = require('child_process').spawnSync(process.execPath, ['-e',
      "require(process.argv[1]).assertCompiles('self-test', { BAD: '(function(){ return ; })(((' });",
      path.join(__dirname, 'inject-check.js')], { encoding: 'utf8' });
    ok('inject-check 拦得住坏代码：子进程非 0 退出并把话说清楚（含"反引号"那条指路）',
      child.status === 1 && /编译不过/.test(child.stderr || '') && /反引号/.test(child.stderr || ''),
      JSON.stringify({ status: child.status, err: String(child.stderr || '').split('\n')[0] }));
  }

  /* ★ 2026-10-10 C3：服务器能发出的意图枚举 与 客户端那张"给人看的文案表"必须对得上。
   *   ▎为什么用断言而不是收成一处：一个在 `sfu/server.js`、一个在浏览器里的 `client.js`，
   *     跨运行时做不到单一来源（与"三张唤醒表逐字比对"是同一条做法，坑 91 末段）。
   *   ▎触发它的现场：新增 `room-undo` 之后，气泡徽标直接印出内部 id「🎯 room-undo」——
   *     用户读到的是一句像坏了的英文。漏配文案不会让任何功能变红，只会让界面少个人话。
   *   ▸ 兜底 `|| ai.intent` 有意保留：将来加新意图忘了配文案，宁可露原词也不要露空。 */
  {
    const fs2 = require('fs');
    const path2 = require('path');
    const srvSrc = fs2.readFileSync(path2.join(__dirname, '..', 'sfu', 'server.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const intents = new Set();
    const re = /intent: '([a-z-]+)'/g;
    let mm;
    while ((mm = re.exec(srvSrc)) !== null) intents.add(mm[1]);
    const chipSrc = clientSrc.replace(/\/\*[\s\S]*?\*\//g, '');
    ok('C3 结构红线：服务器每个 intent 枚举在客户端徽标表里都有人话文案（漏配不会让功能变红，只会让界面露出内部 id）',
      intents.has('room-undo') && intents.has('room-action')
        && [...intents].every((it) => chipSrc.includes(`'${it}':`) || it === 'question' || it === 'chat'
          || /^(minutes|recap|operator|search|followup)$/.test(it)),
      `服务器侧意图：${[...intents].join(', ')}`);
    ok('C3 反向对照：徽标兜底仍然露出原词而不是露空（露空比一个英文 id 更误导）',
      /\)\[ai\.intent\] \|\| ai\.intent \}/.test(chipSrc));
  }

  if (problems.length) {
    console.log(`\n⚠️ 捕获到 ${problems.length} 个运行时异常：`);
    problems.forEach((p, i) => console.log(`\n--- 异常 ${i + 1} ---\n${p}`));
  }
  console.log(`\n结果: ${pass} 通过, ${fail + problems.length} 失败`);
  process.exit(fail + problems.length ? 1 : 0);
})();
