/* ══════════════════════════════════════════════════════════════
 * sfu/ai/tts.js —— 服务端神经语音合成（Edge TTS 协议，★ 09-30c）
 *
 * ▎为什么要有这个文件：AI 语音播报原来用浏览器 speechSynthesis——它读的是
 *   "用户机器上装了什么音色"，多数 Windows 是老式 SAPI 音色（Huihui 一类），
 *   机械感重，正是用户反复抱怨的"AI 味/声音难听"。微软 Edge 浏览器的
 *   **神经语音**（Xiaoxiao/Yunxi 一族）是当前免费且最自然的中文音色，
 *   其合成接口是一个纯 WebSocket 协议——Node 内置 WebSocket + crypto 就能实现，
 *   **零新 npm 依赖**（本项目零依赖铁律内）。
 *
 * ▎协议要点（逆向自公开的 edge-tts 行为，无任何官方 SDK）：
 *   1) 连 wss://speech.platform.bing.com/...?TrustedClientToken=<固定值>
 *      &ConnectionId=<随机 hex>&Sec-MS-GEC=<防滥用令牌>&Sec-MS-GEC-Version=1-<Chromium完整版本>
 *      Sec-MS-GEC = SHA256( 按 300s 取整的 Windows 纪元 tick 数 + 固定 token ) 大写 hex；
 *      ★ 10-05 修复：微软 2025 起要求 **ConnectionId 参数 + Cookie:muid=<32位大写hex>**，
 *        且 Sec-MS-GEC-Version/UA 必须用"较新的 Chromium 版本"——旧实现（130 版、无 muid）
 *        被服务端 403 拒绝；同时 Node 内置 WebSocket **不支持自定义 headers**（muid 发不出去），
 *        故改为 **手写 WebSocket 升级**（https.request + Upgrade:websocket，零依赖红线内）。
 *   2) 先发一条 speech.config 文本帧，再发 ssml 文本帧（SSML 里带音色/语速/文本）；
 *   3) 服务端回二进制帧：前 2 字节大端 = 头部长度，其后是头 + MP3 音频分片；
 *      收到文本帧 Path:turn.end 即合成完成。
 *   ★ 时间戳格式：X-Timestamp 用 "Www Mmm dd yyyy hh:mm:ss GMT+0000 (Coordinated Universal Time)"
 *     风格（edge-tts 对照实现；ssml 帧尾部多一个 "Z"，上游注释确认是服务端如此要求）。
 *
 * ▎可靠性设计：
 *   · 合成失败/超时/断网 → resolve(null)，调用方回落浏览器 TTS，功能不降级；
 *   · 内存 LRU 缓存（文本+音色+语速为键）——同一句"好的，已记下"反复合成毫无意义；
 *   · 并发上限（信号量，同 ASR_CONCURRENCY 的思路）：TTS 是网络+CPU 消耗户，
 *     别让一波回答把出口带宽占满。
 * ▎安全形态（Mimosa 复核）：WebSocket 的 host 是**固定字面量**（微软公开端点），
 *   动态数据（SSML 文本）走消息体不走 URL；无 exec/spawn/eval。
 * ══════════════════════════════════════════════════════════════ */
'use strict';

const crypto = require('crypto');
const https = require('https');

/* ── 协议常量（公开的固定值；版本对齐 edge-tts 7.2.7 的"当前可用"组合） ── */
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WSS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'
  + `?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
const CHROMIUM_VERSION = '143.0.3650.75';       // 旧值 130 会被服务端 403（10-05 实测）
const CHROMIUM_MAJOR = CHROMIUM_VERSION.split('.')[0];
const EDGE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
  + `Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR}.0.0.0`;
const AUDIO_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
const WIN_EPOCH = 11644473600;          // 1601→1970 的秒差（Windows FILETIME 纪元）
const WINDOWS_TICKS_PER_SEC = 10000000; // FILETIME 以 100ns 为单位
const GEC_WINDOW_TICKS = 300 * WINDOWS_TICKS_PER_SEC; // Sec-MS-GEC 按 300s 窗口取整

/* 默认音色：晓晓（zh-CN-XiaoxiaoNeural）——最自然的免费中文女声之一；
 * 语速 +10%：会议助手的"陪聊感"主要来自语速过慢。 */
const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural';
const DEFAULT_RATE = '+10%';

/* ── Sec-MS-GEC 防滥用令牌（时钟对齐 300s 窗口 + SHA256） ── */
function secMsGec(nowMs = Date.now()) {
  const ticks = Math.floor((nowMs / 1000 + WIN_EPOCH) * WINDOWS_TICKS_PER_SEC);
  const rounded = ticks - (ticks % GEC_WINDOW_TICKS);
  return crypto.createHash('sha256')
    .update(`${rounded}${TRUSTED_CLIENT_TOKEN}`)
    .digest('hex')
    .toUpperCase();
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/* X-Timestamp 需 edge-tts 同款格式："Www Mmm dd yyyy hh:mm:ss GMT+0000 (Coordinated Universal Time)"。
 * ssml 帧尾部还要再加一个 "Z"（上游对照实现注释确认"服务端就是如此要求，不是笔误"），
 * 由 synthesizeOnce 里按帧类型区分——这里只产基础格式。 */
function edgeTimestamp(d = new Date()) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (n) => String(n).padStart(2, '0');
  return `${days[d.getUTCDay()]} ${mons[d.getUTCMonth()]} ${p(d.getUTCDate())} ${d.getUTCFullYear()} `
    + `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`;
}

/* ── 手写 WebSocket 客户端（★ 10-05） ──────────────────────
 * 为什么不直接用 Node 内置 WebSocket：**它不支持自定义 headers**，而新端点必须发
 * Cookie:muid=... ——内置构造器的第二参是 protocols 不是 options，headers 根本发不出去。
 * Node 的 https 模块原生支持 WebSocket 升级（Upgrade 头 → 'upgrade' 事件，返回裸 socket），
 * 帧编解码（客户端必须 mask）几十行即可——零依赖红线内，且比任何第三方实现都透明。
 * 只实现本协议用到的：文本帧发送；文本/二进制/ping/close 帧接收。 */
function wsConnect(urlStr, headers, { timeoutMs = 12000 } = {}) {
  return new Promise((resolve) => {
    const u = new URL(urlStr);
    u.protocol = 'https:';   // https.request 不认 wss: 协议头，升级靠 Upgrade 头走
    const req = https.request(u, { headers: {
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
      ...headers,
    } });
    let settled = false;
    const fail = (why) => { if (settled) return; settled = true; resolve({ ws: null, why }); };

    req.setTimeout(timeoutMs, () => { fail('timeout'); try { req.destroy(); } catch (e) { /* 已关 */ } });
    req.on('response', (res) => { res.resume(); fail(`http-${res.statusCode}`); }); // 未升级 = 服务器直接回了 HTTP
    req.on('error', (e) => fail(e.message));
    req.on('upgrade', (res, socket, head) => {
      if (settled) { try { socket.destroy(); } catch (e) { /* 已关 */ } return; }
      settled = true;
      const ws = {
        readyState: 1,
        close() {
          if (ws.readyState > 1) return;
          ws.readyState = 3;
          try { socket.write(encodeWsFrame(Buffer.alloc(0), 0x8)); } catch (e) { /* 已关 */ }
          try { socket.end(); } catch (e) { /* 已关 */ }
        },
        send(text) {
          if (ws.readyState !== 1) return;
          try { socket.write(encodeWsFrame(Buffer.from(text, 'utf8'), 0x1)); } catch (e) { /* 已关 */ }
        },
      };
      ws.onmessage = ws.onclose = ws.onerror = null;
      let buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
      socket.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        while (true) {
          if (buf.length < 2) break;
          const opcode = buf[0] & 0x0f;
          const masked = (buf[1] & 0x80) !== 0;
          let len = buf[1] & 0x7f, off = 2;
          if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          if (masked) off += 4; // 服务器→客户端按规范不 mask；防御式跳过
          if (buf.length < off + len) break;
          const payload = buf.subarray(off, off + len);
          buf = buf.subarray(off + len);
          if (opcode === 0x9) { try { socket.write(encodeWsFrame(payload, 0xA)); } catch (e) { /* 已关 */ } } // ping→pong
          else if (opcode === 0x8) { ws.readyState = 3; try { socket.end(); } catch (e) { /* 已关 */ } }
          else if ((opcode === 0x1 || opcode === 0x2) && ws.onmessage) {
            ws.onmessage({ data: opcode === 0x1 ? payload.toString('utf8') : payload });
          }
        }
      });
      socket.on('error', () => { ws.readyState = 3; if (ws.onerror) ws.onerror(new Error('socket error')); });
      socket.on('close', () => { ws.readyState = 3; if (ws.onclose) ws.onclose(); });
      resolve({ ws, why: null }); // 之后由调用方挂 onmessage 并发送 config/ssml（升级完成即可发）
    });
    req.end();
  });
}

/* 帧编码：客户端 → 服务器必须 mask（RFC 6455）；头部长度分 7/16/64 位三档 */
function encodeWsFrame(payload, opcode) {
  const mask = crypto.randomBytes(4);
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x80 | opcode, 0x80 | len]);
  else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2);
  }
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i & 3];
  return Buffer.concat([header, mask, masked]);
}

/* 最近一次合成失败原因（探测端读它写日志；成功时清空）——"机制要有证据"（坑 76） */
let lastSynthError = null;
function getLastSynthError() { return lastSynthError; }

/* ── 并发闸（同 ASR_CONCURRENCY 的思路：2 个在途，多的排队） ── */
const TTS_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.TTS_CONCURRENCY) || 2));
let ttsRunning = 0;
const ttsWaiters = [];
function acquireTtsSlot() {
  if (ttsRunning < TTS_CONCURRENCY) { ttsRunning += 1; return Promise.resolve(); }
  return new Promise((resolve) => ttsWaiters.push(resolve));
}
function releaseTtsSlot() {
  const next = ttsWaiters.shift();
  if (next) next();
  else ttsRunning -= 1;
}

/* ── 结果缓存（LRU）：同一句文本不重复花网络往返 ── */
const CACHE_MAX = Number(process.env.TTS_CACHE_MAX) || 40;
const cache = new Map(); // key → Buffer(mp3)
function cacheKey(text, voice, rate) {
  // ★ 只是缓存键不是安全设施，但统一用 sha256（弱哈希一刀切的扫描口径，没必要抬杠）
  return crypto.createHash('sha256').update(`${voice}|${rate}|${text}`).digest('hex');
}
function cacheGet(key) {
  if (!cache.has(key)) return null;
  const buf = cache.get(key);
  cache.delete(key); cache.set(key, buf); // 触碰即置顶（LRU）
  return buf;
}
function cachePut(key, buf) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value); // 淘汰最旧
  cache.set(key, buf);
}

/* ── 单次合成：建立 WS → config → ssml → 收音频 → turn.end ── */
async function synthesizeOnce(text, { voice, rate, timeoutMs }) {
  const url = `${WSS_URL}&ConnectionId=${crypto.randomUUID().replace(/-/g, '')}`
    + `&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=1-${CHROMIUM_VERSION}`;
  const { ws, why } = await wsConnect(url, {
    'User-Agent': EDGE_USER_AGENT,
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Accept-Language': 'en-US,en;q=0.9',
    'Pragma': 'no-cache',
    'Cache-Control': 'no-cache',
    'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold', // 端点认这个来源（公开逆向结论）
    'Cookie': `muid=${crypto.randomBytes(16).toString('hex').toUpperCase()};`, // ★ 10-05 起必须（旧实现 403 根因之一）
  }, { timeoutMs: timeoutMs || 12000 });
  if (!ws) { lastSynthError = why; return null; }

  return await new Promise((resolve) => {
    const chunks = [];
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      try { ws.close(); } catch (e) { /* 已关 */ }
      clearTimeout(timer);
      if (result && result.length) lastSynthError = null; else lastSynthError = lastSynthError || 'no-audio';
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), timeoutMs || 12000);

    // ① speech.config：声明输出格式（24k 48kbps mono MP3）
    ws.send(`X-Timestamp:${edgeTimestamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n`
      + JSON.stringify({ context: { synthesis: { audio: {
        metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' },
        outputFormat: AUDIO_FORMAT,
      } } } }));
    // ② ssml：真正的合成请求（文本经 XML 转义，绝无注入面）
    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>`
      + `<voice name='${xmlEscape(voice)}'><prosody rate='${xmlEscape(rate)}' pitch='+0Hz'>`
      + `${xmlEscape(text)}</prosody></voice></speak>`;
    ws.send(`X-RequestId:${crypto.randomUUID().replace(/-/g, '')}\r\nContent-Type:application/ssml+xml\r\n`
      + `X-Timestamp:${edgeTimestamp()}Z\r\nPath:ssml\r\n\r\n${ssml}`);

    ws.onmessage = (ev) => {
      const data = ev.data;
      if (typeof data === 'string') {
        if (data.includes('Path:turn.end')) finish(Buffer.concat(chunks));
        return;
      }
      // 二进制帧：[2 字节头长（大端）][头][音频分片]
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (buf.length < 2) return;
      const headerLen = buf.readUInt16BE(0);
      if (buf.length > headerLen + 2) chunks.push(buf.subarray(headerLen + 2));
    };
    ws.onerror = () => finish(null);
    ws.onclose = () => finish(chunks.length ? Buffer.concat(chunks) : null);
  });
}

/* ── 已合成音频的内存货架（HTTP 层按 id 供给客户端 <audio> 拉取） ── */
const audioStore = new Map(); // id → { buf, ts }
function putAudio(buf, type = 'mp3') {
  const id = crypto.randomBytes(16).toString('hex');
  audioStore.set(id, { buf, type, ts: Date.now() }); // ★ type：'mp3'(Edge) | 'wav'(Qwen 本地)
  if (audioStore.size > 30) {
    const oldest = audioStore.keys().next().value;
    audioStore.delete(oldest);
  }
  return id;
}
function getAudio(id) {
  const e = audioStore.get(String(id || ''));
  return e ? { buf: e.buf, type: e.type || 'mp3' } : null;
}
/* 周期清理过期音频（调用方用 setInterval 喂间隔；不喂也不膨胀——putAudio 有上限） */
function sweepAudio(maxAgeMs = 30 * 60000) {
  const cut = Date.now() - maxAgeMs;
  for (const [id, e] of audioStore) if (e.ts <= cut) audioStore.delete(id);
}

/* ── 对外入口：synthesize(text, opts) → Promise<Buffer|null>（null=失败，走回落） ── */
async function synthesize(text, opts = {}) {
  const say = String(text || '').trim();
  if (!say) return null;
  /* ★ 2026-10-06 测试接缝：TTS_FAKE_FAIL=1 = "启动探测通过、真合成失败"。
   * ▎为什么要这条缝：Edge 端点可达性随网络出口漂（403 时本机什么都改不了），
   *   而"AI 答应了却不说话"恰恰只在这条路径上发生——没有接缝就只能等网络自己坏一次，
   *   于是这条最要命的分支从来没有被确定性测过（与 window.__SFU_ASR__、TEST_RECORD 同一条思路）。
   * ▎放在缓存查询之前：否则同一句话命中缓存会绕过失败，测试测的是缓存不是链路（坑 72）。 */
  if (process.env.TTS_FAKE_FAIL === '1') return null;
  const voice = opts.voice || DEFAULT_VOICE;
  const rate = opts.rate || DEFAULT_RATE;
  const key = cacheKey(say.slice(0, 500), voice, rate);
  const hit = cacheGet(key);
  if (hit) return hit;

  await acquireTtsSlot();
  try {
    // 超长文本按句切分逐段合成再拼接（MP3 分片可直接串接）——回答通常不长，
    // 这里只防"喂进来一整段纪要"的极端情况，单段上限 800 字符。
    const parts = [];
    let rest = say.slice(0, 2000);
    while (rest.length) {
      let cut = Math.min(800, rest.length);
      if (cut < rest.length) {
        const m = rest.slice(0, 900).search(/[。！？!?；;\n]/);
        if (m > 0) cut = m + 1;
      }
      parts.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    const bufs = [];
    for (const part of parts) {
      const buf = await synthesizeOnce(part, { voice, rate, timeoutMs: opts.timeoutMs });
      if (!buf || !buf.length) return null; // 任一段失败 = 整体失败（走回落，不播半截）
      bufs.push(buf);
    }
    const out = Buffer.concat(bufs);
    cachePut(key, out);
    return out;
  } finally {
    releaseTtsSlot();
  }
}

/* ══ 念出来之前的文本清洗（2026-10-05 用户点名："纪要那个长名字就不说了，费时间"）══
 * ▎为什么不念路径：「/minutes/283648/20261005-221203-segment.md」念出来是
 *   "斜杠 minutes 斜杠 二八三四八 横杠 二零二六…"——几十秒的废话，而气泡里
 *   本来就有可以点的链接。**嘴上只说人听得懂的话，文件名交给人眼看。**
 * ▎同一套规则浏览器那一轨也要用（client.js 的 speakableText）：两处是不同运行时，
 *   做不到一份代码，所以这里导出给服务器用，并由 `test:asr` 拿同一条样例
 *   断言"两边都不会把路径念出来"（改了忘同步会当场红，而不是留下一条更难查的抱怨）。
 * ▎纯函数、零依赖，直接能被单测。 */
function speakable(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, '（代码块）')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')          // markdown 链接：留名字，去地址
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/^[#>\-\s|]+/gm, '')
    .replace(/\|/g, '，')
    .replace(/https?:\/\/\S+/g, '（链接）')
    /* 路径类：以 / 开头的多段路径，或任何 .md/.webm/.mkv/.mp3/.wav 文件名 */
    .replace(/(?:[.\/\\][\w.\-\/\\]{6,})/g, '（文件）')
    .replace(/@ai/gi, 'A I')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/（文件）[，,、]?\s*(（文件）)+/g, '（文件）')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  speakable,
  synthesize,
  putAudio,
  getAudio,
  sweepAudio,
  secMsGec,
  getLastSynthError,
  DEFAULT_VOICE,
  DEFAULT_RATE,
};
