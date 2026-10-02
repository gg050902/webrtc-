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
    if (ev === 'desk-connect') {                                                // ★ 09-30 设备码直连
      rec.lastDeskConnect = payload;
      return cb({ data: { granted: false, hostId: 'DEVICEGRANTHOST1', hostName: '🖥️ 客厅电脑' } });
    }
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

  /* ---- ★ 2026-10-03 第 37 步：字幕延迟读数（"说完→上字幕"实测显示） ----
   * ▎断言重点不是"数字对不对"（那是服务器的事），而是**客户端绝不编数**：
   *   没有 latMs、脏 latMs、半句 interim 三种情况下读数必须保持不动。
   *   一个会自己瞎填的读数比没有读数更糟——它会让人据此判断"延迟还可以"。 */
  const capLatEl = documentStub.getElementById('capLat');
  ok('延迟读数：服务器没带 latMs 时不编数（元素文案仍未被写过）', !String(capLatEl.textContent).includes('⏱'));
  guard('延迟读数：定稿带 2400ms', () => emit('asr-caption', { name: '小张', text: '第二句', latMs: 2400 }));
  ok('延迟读数：定稿带 latMs → 显示 ⏱ 2.4s 且上三色（≤3s 为 ok）',
    capLatEl.textContent === '⏱ 2.4s' && /\bcap-lat ok\b/.test(capLatEl.className));
  guard('延迟读数：半句 interim 也带 latMs', () => emit('asr-caption', { name: '小张', text: '半句', interim: true, latMs: 500 }));
  ok('延迟读数：半句(interim)不刷新——只有定稿才是"说完"', capLatEl.textContent === '⏱ 2.4s');
  guard('延迟读数：偏慢 4500ms', () => emit('asr-caption', { name: '小张', text: '第三句', latMs: 4500 }));
  ok('延迟读数：3~6s 判 warn（偏慢要看得见）', /\bcap-lat warn\b/.test(capLatEl.className));
  guard('延迟读数：很差 9000ms', () => emit('asr-caption', { name: '小张', text: '第四句', latMs: 9000 }));
  ok('延迟读数：>6s 判 bad（胭脂红，与项目三色惯例一致）', /\bcap-lat bad\b/.test(capLatEl.className));
  const capLatBeforeDirty = capLatEl.textContent;
  guard('延迟读数：脏值 0 / 非数字 / 超 120s', () => {
    emit('asr-caption', { name: '小张', text: '第五句', latMs: 0 });
    emit('asr-caption', { name: '小张', text: '第六句', latMs: 'abc' });
    emit('asr-caption', { name: '小张', text: '第七句', latMs: 999999 });
  });
  ok('延迟读数：三种脏值一律不刷新（服务器判为不可靠就不显示，别拿假数字糊弄人）',
    capLatEl.textContent === capLatBeforeDirty);
  ok('延迟读数：悬浮提示给出均值与最慢值（本地窗口只用于显示，权威统计在 /metrics）',
    capLatEl.title.includes('均值') && capLatEl.title.includes('最慢'));
  /* ★ 拆分读数：只有总数就没法指导优化——"4s"到底是模型慢还是在等静音，处方完全相反。 */
  guard('延迟拆分：带 stage 的定稿', () => emit('asr-caption', {
    name: '小张', text: '第八句', latMs: 4200, stage: { wait: 1500, trans: 2700 },
  }));
  ok('延迟拆分：悬浮提示摊开"等待 + 转写"两段（慢在哪一段要能一眼看出）',
    capLatEl.title.includes('等待 1.5s') && capLatEl.title.includes('转写 2.7s'));
  guard('延迟拆分：老服务器不带 stage', () => emit('asr-caption', { name: '小张', text: '第九句', latMs: 2000 }));
  ok('延迟拆分：没有 stage 时不编拆分（只显示总数，功能不降级也不虚报）',
    capLatEl.textContent === '⏱ 2.0s' && !capLatEl.title.includes('末段拆分'));

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
  ok('播报延迟：读数贴在**这条答案自己的气泡**上（🔊 2.3s 后开口）',
    createdEls.some((e) => e.className === 'msg-voice-lat' && String(e.textContent).includes('2.3s')));
  ok('播报延迟：上报服务器累计（权威统计在 /metrics，界面只是本条读数）',
    rec.emits.filter((e) => e === 'ai-speech-lat').length === emitsBeforeVlat + 1);
  ok('播报延迟：锚点用完即销（同一条答案的分段音频不会重复计数）',
    vm.runInContext(`voiceAnswerAt.has(${voiceTs})`, ctx) === false);
  const vlatBefore2 = rec.emits.filter((e) => e === 'ai-speech-lat').length;
  guard('播报延迟：没有锚点的 ts（音频先到/气泡已被回收）',
    () => vm.runInContext(`noteVoiceLatency(${voiceTs + 9999})`, ctx));
  ok('播报延迟：找不到锚点时什么都不报、不崩（不编数）',
    rec.emits.filter((e) => e === 'ai-speech-lat').length === vlatBefore2);

  /* ---- ★ 2026-10-03 第 39 步：两个延迟读数进值守日报 ----
   * ▎为什么要断这个：日报是"早上拿到手的那份东西"，如果它不含链路质量，
   *   这一夜到底快不快就只剩"当时屏幕上瞟过一眼"——**证据必须能过夜**。 */
  ok('字幕定稿把服务器实测的 lat 一起存进本地账本（日报与导出都靠它）',
    vm.runInContext('cap.log[cap.log.length - 1].lat', ctx) === 2000);
  /* ▸ 这里刻意用**区间**而不是 ===2300：ms = Date.now() - (Date.now()-2300)，
   *   两次取时之间只要跨过 1ms 就变成 2301 —— 上一版写成精确相等，
   *   于是一条正确的实现会因为**机器的抖动**偶发判红。
   *   判据：**凡是由时间推导出来的期望值，断言就必须带容差**（同坑 28 的帧率教训）。 */
  const vLast = Number(vm.runInContext('aiVoiceLats[aiVoiceLats.length - 1].ms', ctx));
  ok('播报延迟进入滚动窗口（上限 60 条，长跑不涨）',
    vm.runInContext('aiVoiceLats.length', ctx) >= 1 && vLast >= 2300 && vLast < 2600,
    `实测 ${vLast}ms`);
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

  /* ---- ★ 2026-10-02 "AI 后来不出声"的两条死锁：钉住**接线形状** ----
   * ▎为什么这里只能断言源码（诚实交代）：冒烟桩里没有 speechSynthesis、也没有 Audio 元素，
   *   真播放分支走不到——所以行为级覆盖放在 `npm run test:asr-live` 的"语音交付"断言里
   *   （那条真的检查"声明了 tts:'server' 就必须给出 ai-audio 或 ai-tts-fail"）。
   *   这里钉的是形状：让位闸必须有例外、回落必须带 force、队列与销账时机必须成立——
   *   这几条错一条，用户侧症状都是同一个"它答应了却没声音"（且没有任何报错）。 */
  ok('2026-10-02 让位闸留了例外口（ai-tts-fail 的回落不再被自己挡住）',
    /function speakAiText\(text, \{ force = false \} = \{\}\)/.test(clientSrc) &&
    /if \(aiTtsEnabled && !force\) return;/.test(clientSrc));
  ok('2026-10-02 回落调用真的带 force: true（不带走闸等于白回落）',
    (clientSrc.match(/speakAiText\(t, \{ force: true \}\)/g) || []).length >= 2);
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
    /const talkingNow = aiHush\.analyser\s*\?\s*\(Date\.now\(\) - lastMicVoiceTs < 600\)\s*:\s*\(Date\.now\(\) - lastUserSpeechTs < 700\)/.test(clientSrc));
  ok('2026-10-02 看门狗持续量麦克风（不再只在 AI 说话时才量——那样"此刻在说"根本拿不到）',
    /if \(aiHush\.analyser\) \{[\s\S]{0,600}lastMicVoiceTs = Date\.now\(\);[\s\S]{0,200}if \(window\.speechSynthesis && window\.speechSynthesis\.speaking\)/.test(clientSrc));
  ok('2026-10-02 服务器 ASR 启动日志说真话（主引擎名 + whisper 只是兜底）',
    /主引擎 = \$\{primary\}/.test(fs.readFileSync(path.join(__dirname, '..', 'sfu', 'server.js'), 'utf8')));
  /* ▎浏览器界面上那行"由本机 whisper 识别"是**用户唯一看得见的引擎声明**，
   *   而它当时是硬编码的——引擎早已切成 qwen-local，界面还在说 whisper。
   *   用户据此判断"没切换成功"，这一行字比任何后端日志都有说服力（坑 67 的 UI 版）。 */
  ok('2026-10-02 界面不再硬编码引擎名（状态/提示/日志三处都取 /config.json 的 asrEngine）',
    /function asrEngineCn\(\)/.test(clientSrc) &&
    /renderCapStatus\(`🖥️ 服务器转写（\$\{asrEngineCn\(\)\}）`/.test(clientSrc) &&
    /showToast\(`🖥️ 服务端转写已开启[\s\S]{0,60}\$\{asrEngineCn\(\)\}/.test(clientSrc) &&
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
    /enqueueAiSpeech\(say, \{ replace: firstOfThisAnswer \}\)/.test(clientSrc));
  /* ▎记账位必须推进：不推进 = 每个增量都把同一句重新入队（症状是"AI 鬼打墙一样重复半句"，
   *   与本轮用户投诉的"一直收到重复的一句话"字面一样，但根因完全不同）。 */
  ok('2026-10-02 朗读记账位会推进（spokenChars = cut，不会同一句重念）',
    /box\.spokenChars = cut;/.test(clientSrc) &&
    (clientSrc.match(/box\.spokenChars = cut;/g) || []).length >= 2);
  ok('2026-10-02 ?nosw=1 不再自我循环（跳回去掉 nosw 的地址，其余参数保留）',
    /location\.replace\(location\.pathname \+ \(keep \? '\?' \+ keep : ''\)/.test(clientSrc) &&
    !/setTimeout\(\(\) => location\.reload\(\), 400\)/.test(clientSrc));
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
  const srvActions = (srvSrc.match(/const ROOM_ACTIONS = \{([\s\S]*?)\n\};/) || [, ''])[1]
    .split('\n').map((l) => (l.match(/^\s*'([a-z-]+)'\s*:/) || [])[1]).filter(Boolean);
  const rcBlock = (clientSrc.match(/socket\.on\('room-control'([\s\S]*?)\n\}\);/) || [, ''])[1];
  const cliActions = (rcBlock.match(/action === '([a-z-]+)'/g) || []).map((s) => s.replace(/.*'([a-z-]+)'.*/, '$1'));
  ok('2026-10-02 服务器白名单与客户端处理表**一一对应**（少一个分支=AI 说了但没做）',
     srvActions.length >= 8 &&
     srvActions.slice().sort().join(',') === cliActions.slice().sort().join(','));
  ok('2026-10-02 房间级动作表里没有"动用户设备"的事（摄像头/共享/静音别人一律不走这条路）',
     !/camera|screen|share|mute|kick|file|clipboard/i.test(srvActions.join(',')) &&
    /record/i.test(srvSrc));   // 断言本身有效的前提：这个正则真的能命中"录制"这类词（防变量名写错把断言变成空转）
  /* ▎录制为什么也**不在**这张表里（有意为之，不是漏掉）：record-start 有角色门禁
   *   （游客不能录），而 AI 本身没有身份角色——让它直接开录等于给它越权，
   *   与 C1「授权绝不豁免」是同一条纪律。所以 record 单独钉一条，防止将来"顺手加上"。 */
  ok('2026-10-03 房间动作表不含录制（AI 没有角色，不能替人越权录制）',
    !/record/i.test(srvActions.join(',')));
  /* 执行回执：报的是"本地是否真的执行了"（done 非空），不是"我收到了"。
   * 只报"收到"的话，这个指标永远等于发出数、差值恒为 0 = 白做。 */
  ok('2026-10-03 房间动作回执报的是"真的执行了"（不是"我收到了"）',
    /socket\.emit\('room-control-ack', \{ action, ok: !!done \}\)/.test(clientSrc));
  ok('2026-10-02 动作路由排在 LLM 之前（tools-first：先做事再说话，坑 38）',
     /const roomAction = detectRoomAction\(q\);[\s\S]{0,600}?intent: 'room-action'[\s\S]{0,400}?classifyIntent/.test(srvSrc));
  ok('2026-10-02 中文规则把"关"排在"开"前面判（否则「把白板关掉」会命中"打开白板"）',     (() => {
       const rules = (srvSrc.match(/const ROOM_ACTION_RULES = \[([\s\S]*?)\n\];/) || [, ''])[1];
       return rules.indexOf('board-close') > -1 && rules.indexOf('board-close') < rules.indexOf('board-open') &&
              rules.indexOf('captions-off') > -1 && rules.indexOf('captions-off') < rules.indexOf('captions-on');
     })());
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
    /function enqueueAiSpeech\(say, \{ replace = true \}/.test(clientSrc) &&
    /if \(replace\) \{[\s\S]{0,600}?window\.speechSynthesis\.cancel\(\);[\s\S]{0,200}?aiSpeakPumping = false;/.test(clientSrc));
  ok('2026-10-02 终态只补念剩下的尾巴；前缀对不上就整段重念（宁可重复也不漏声）',
    /startsWith\(spoken\)/.test(clientSrc) &&
    /slice\(spoken\.length\)/.test(clientSrc) &&
    /\}\s*else \{\s*speakAiText\(text\);/.test(clientSrc));
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
  ok('2026-10-02 形象只有一张静帧（没有任何地方再把循环 WebP 当资源引用）',
    /const AI_PORTRAIT = /.test(clientSrc) && !/AI_ANIM/.test(clientSrc) &&
    !/(src|href)\s*=\s*.?["'`][^"'`]*xiaoming-(anim|talk)/.test(clientSrc));
  ok('2026-10-02 死代码已清（从未被调用的 aiAvatarSvg 不再存在）', !/function aiAvatarSvg/.test(clientSrc));
  ok('2026-10-02 成员行与视频格共用同一个形象常量（一个概念只有一个来源）',
    (clientSrc.match(/AI_PORTRAIT/g) || []).length >= 3);
  ok('2026-10-02 .ai-face 的常驻动画只有一条（两套节奏叠加就是重影）',
    (cssSrc.match(/\.ai-tile \.ai-face \{[^}]*animation: aiBreath/g) || []).length === 1);
  ok('2026-10-02 小动作池 ≥5 个且都是一次性动画（infinite 循环正是"机器感"的来源）',
    /AI_GESTURES = \[/.test(clientSrc) &&
    (cssSrc.match(/\.ai-face\.g-[a-z-]+\s*\{[^}]*animation: \w+ [\d.]+s [a-z-]+ 1;/g) || []).length >= 5);
  ok('2026-10-02 说话/思考各有自己的律动（不同状态不同动作）',
    /\.ai-tile\.speaking \.ai-face \{ animation: aiTalkBob/.test(cssSrc) &&
    /\.ai-tile\.thinking \.ai-face \{ animation: aiThinkLook/.test(cssSrc));
  ok('2026-10-02 无障碍：prefers-reduced-motion 下头像动画全部停掉',
    /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,400}animation: none !important/.test(cssSrc));
  ok('2026-10-02 调度器只在 idle/listening 演小动作，格子移除时一并停表',
    /state !== 'idle' && aiAvatar\.state !== 'listening'/.test(clientSrc) &&
    (clientSrc.match(/clearAiGesture\(\)/g) || []).length >= 2);

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

  if (problems.length) {
    console.log(`\n⚠️ 捕获到 ${problems.length} 个运行时异常：`);
    problems.forEach((p, i) => console.log(`\n--- 异常 ${i + 1} ---\n${p}`));
  }
  console.log(`\n结果: ${pass} 通过, ${fail + problems.length} 失败`);
  process.exit(fail + problems.length ? 1 : 0);
})();
