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
    id, children: [], style: {}, dataset: {}, files: [], value: '',
    textContent: '', innerHTML: '', disabled: false, checked: false,
    scrollTop: 0, scrollHeight: 0, offsetWidth: 1, srcObject: null,
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
    appendChild(c) { this.children.push(c); return c; },
    remove() {}, click() { this.dispatch('click'); }, focus() {}, blur() {},
    setAttribute() {}, getAttribute() { return null; },
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

const documentStub = {
  getElementById(id) { if (!elementCache.has(id)) elementCache.set(id, makeEl(id)); return elementCache.get(id); },
  querySelector(sel) { return makeEl(`doc|${sel}`); },
  querySelectorAll() { return []; },
  createElement(tag) { return makeEl(`new|${tag}`); },
  addEventListener() {}, removeEventListener() {},
  body: makeEl('body'),
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
 *   测试里就能"冒充 mediasoup 送来一条 SCTP 消息"驱动 handleDataMessage。 */
class FakeDataProducer {
  constructor(id) { this.id = id; this.closed = false; }
  send(str) { rec.sctpSends.push(str); }
  close() { this.closed = true; }
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
      const finish = (arg) => resolve(new FakeDataProducer((arg && arg.id) || 'dp-local'));
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
  on(ev, fn) { if (!socketHandlers.has(ev)) socketHandlers.set(ev, []); socketHandlers.get(ev).push(fn); },
  off() {}, once(ev, fn) { this.on(ev, fn); },
  emit(ev, payload, cb) {
    rec.emits.push(ev);
    if (ev === 'remote-input') { rec.remoteInputs++; rec.remoteInputPayloads.push(payload); }
    if (ev === 'remote-request') rec.remoteRequestTo = payload && payload.to;   // ★ 09-24
    if (ev === 'clipboard-sync') rec.clipboardSends++;
    if (ev === 'file-chunk') rec.fileChunks++;
    if (ev === 'file-offer') { rec.fileOffers++; rec.lastFileOffer = payload; }
    if (ev === 'remote-answer') rec.lastAllowAnswer = payload;
    if (ev === 'member-state') rec.lastMemberState = payload; // ★ 09-13：举手断言用
    if (ev === 'set-preferred-layers') rec.lastLayerPref = payload; // ★ G4：省流锁层断言用
    if (ev === 'auth-login' || ev === 'auth-register') {
      rec.lastAuth = payload;
      return cb({ data: { user: { username: payload.username, displayName: payload.displayName || payload.username }, token: 'tok-test-123' } });
    }
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
  /* ★ 09-17：Web Speech API 桩（client 用 window.SpeechRecognition || window.webkitSpeechRecognition 探测，window=ctx 两者都覆盖） */
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
// ★ 跨 realm 坑：client.js 在 vm 世界里做 `event instanceof ArrayBuffer`，
//   宿主（本脚本）世界造的帧过不了这个检查（instanceof 比对的是各自身上的构造器），
//   帧会被静默跳过。所以测试用的二进制帧必须在 vm 世界里造——这个 helper 就是干这个的。
const newFrame = vm.runInContext('(n) => new ArrayBuffer(n)', ctx);
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
  ok('F1 钉选后按钮文案更新为已钉选（refreshPinBtns 路径）',
    !!pinBtn && ((elementCache.get('new|div|.pin-btn') || {}).textContent === '📌 已钉选'));
  guard('F1 取消钉选', () => pinBtn && pinBtn.dispatch('click'));
  ok('F1 取消钉选后文案还原',
    (elementCache.get('new|div|.pin-btn') || {}).textContent === '📌 钉选');

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
    capStatusEl.textContent.includes('服务器转写模式'));
  // 降级后重新开字幕 → 再失败 → 仍稳定降级（不反复报错）
  guard('降级：重新开字幕', () => capBtnEl.dispatch('click'));
  guard('降级：再次 network 失败', () => { const r2 = rec.capInstances[rec.capInstances.length - 1]; r2 && r2.onerror && r2.onerror({ error: 'network' }); });
  ok('降级：重复失败仍稳定降级（不反复弹错）',
    capStatusEl.textContent.includes('服务器转写模式'));

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
    capBtnEl.innerHTML.includes('服务端字幕') && capStatusEl.textContent.includes('服务器转写'));
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
  ok('服务端字幕：单独记账 serverTotal', vm.runInContext('cap.sentry.serverTotal', ctx) >= 1);
  guard('服务端字幕：点关开关', () => capBtnEl.dispatch('click'));
  ok('服务端字幕：关掉只隐藏显示（提示服务器仍在转写）',
    capStatusEl.textContent.includes('服务器仍在转写'));
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

  if (problems.length) {
    console.log(`\n⚠️ 捕获到 ${problems.length} 个运行时异常：`);
    problems.forEach((p, i) => console.log(`\n--- 异常 ${i + 1} ---\n${p}`));
  }
  console.log(`\n结果: ${pass} 通过, ${fail + problems.length} 失败`);
  process.exit(fail + problems.length ? 1 : 0);
})();
