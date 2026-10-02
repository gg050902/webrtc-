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
 *      &Sec-MS-GEC=<防滥用令牌>&Sec-MS-GEC-Version=...
 *      Sec-MS-GEC = SHA256( 按 300s 取整的 Windows 纪元 tick 数 + 固定 token ) 大写 hex；
 *   2) 先发一条 speech.config 文本帧，再发 ssml 文本帧（SSML 里带音色/语速/文本）；
 *   3) 服务端回二进制帧：前 2 字节大端 = 头部长度，其后是头 + MP3 音频分片；
 *      收到文本帧 Path:turn.end 即合成完成。
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

/* ── 协议常量（公开的固定值） ─────────────────────────────── */
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WSS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'
  + `?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
const EDGE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.68';
const CHROMIUM_VERSION = '130.0.2849.68';
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

function nowStamp() {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

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
function synthesizeOnce(text, { voice, rate, timeoutMs }) {
  return new Promise((resolve) => {
    const url = `${WSS_URL}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=1-${CHROMIUM_VERSION}`;
    let ws;
    try {
      ws = new WebSocket(url, { headers: {
        'User-Agent': EDGE_USER_AGENT,
        'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      } });
    } catch (e) { resolve(null); return; }

    const chunks = [];
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      try { if (ws && ws.readyState <= 1) ws.close(); } catch (e) { /* 已关 */ }
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), timeoutMs || 12000);

    ws.onopen = () => {
      // ① speech.config：声明输出格式（24k 48kbps mono MP3）
      ws.send(`X-Timestamp:${nowStamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n`
        + JSON.stringify({ context: { synthesis: { audio: {
          metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' },
          outputFormat: AUDIO_FORMAT,
        } } } }));
      // ② ssml：真正的合成请求（文本经 XML 转义，绝无注入面）
      const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>`
        + `<voice name='${xmlEscape(voice)}'><prosody rate='${xmlEscape(rate)}' pitch='+0Hz'>`
        + `${xmlEscape(text)}</prosody></voice></speak>`;
      ws.send(`X-RequestId:${crypto.randomUUID().replace(/-/g, '')}\r\nContent-Type:application/ssml+xml\r\n`
        + `X-Timestamp:${nowStamp()}\r\nPath:ssml\r\n\r\n${ssml}`);
    };
    ws.onmessage = (ev) => {
      const data = ev.data;
      if (typeof data === 'string') {
        if (data.includes('Path:turn.end')) finish(Buffer.concat(chunks));
        return;
      }
      // 二进制帧：[2 字节头长（大端）][头][音频分片]
      const buf = Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
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

module.exports = {
  synthesize,
  putAudio,
  getAudio,
  sweepAudio,
  secMsGec,
  DEFAULT_VOICE,
  DEFAULT_RATE,
};
