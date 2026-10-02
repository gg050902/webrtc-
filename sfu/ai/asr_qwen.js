/* ══════════════════════════════════════════════════════════════
 * sfu/ai/asr_qwen.js —— Qwen3-ASR 引擎（DashScope OpenAI 兼容口，★ 2026-10-01）
 *
 * ▎是什么：把 QwenLM/Qwen3-ASR（阿里开源的 SOTA 级 ASR，0.6B/1.7B）接进本项目的
 *   "AI 耳朵"作为 **whisper 之外的第二引擎**。取其长：52 语言/方言、复杂声学鲁棒、
 *   免本地 GPU（走 DashScope qwen3-asr-flash 云端推理）；补其短：云端要 key 且
 *   出口可达性不可控——所以做成**可插拔 + 探测双轨**：
 *     · 配了 DASHSCOPE_API_KEY 且探测通过 → 用 Qwen；
 *     · key 没配 / 探测失败 / 单段超时 → 自动回落 whisper 常驻 worker（功能不降级）。
 *
 * ▎接口（本项目只走一条 REST 路，最贴合"4s 一段"的节奏）：
 *   POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
 *   model: qwen3-asr-flash
 *   messages[0].content = [ {type:'text', text:'请转写为简体中文普通话。'},
 *                           {type:'input_audio', input_audio:{data: base64(wav), format:'wav'}} ]
 *   → choices[0].message.content = 转写文本
 *   （README 另有实时 WS 与异步 FileTrans 两种：实时要长连 WS，FileTrans 是任务轮询
 *     ——都对"每 4 秒一小段"的节奏太重，兼容口一次 HTTP 最贴合。）
 *
 * ▎SSRF 加固：端点域名走**白名单**（DashScope 官方国内/国际域，仅 https）——
 *   DASHSCOPE_BASE_URL 即便被改成内网/环回/云元数据地址也会被直接拒绝。
 *   key 只从环境/.env 读，绝不下发前端；无 exec/spawn/eval。
 * ══════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');

const BASE = (process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com').replace(/\/+$/, '');
const MODEL = process.env.ASR_QWEN_MODEL || 'qwen3-asr-flash';
const TIMEOUT_MS = Number(process.env.ASR_QWEN_TIMEOUT_MS) || 20000;
/* ★ 端点白名单：只认阿里官方两个域（国内/国际），协议必须 https——
 *   URL 里的协议/主机任意一项不满足就抛错，SSRF（含 DNS rebinding 后的内网访问）从结构上挡住。 */
const ALLOWED_HOSTS = new Set(['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com']);
function chatEndpoint() {
  const u = new URL(`${BASE}/compatible-mode/v1/chat/completions`);
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) {
    throw new Error(`不允许的 DashScope 端点：${u.protocol}//${u.hostname}（仅支持官方域名且必须 https）`);
  }
  return u.toString();
}

function readKey() {
  if (process.env.DASHSCOPE_API_KEY) return process.env.DASHSCOPE_API_KEY.trim();
  // 与 provider.js 同一条取值链：环境变量 > 项目根 .env
  try {
    const env = fs.readFileSync('.env', 'utf8');
    const m = env.match(/^\s*DASHSCOPE_API_KEY\s*=\s*(\S+)\s*$/m);
    if (m) return m[1].trim();
  } catch (e) { /* 没有 .env 就当没配 */ }
  return null;
}

/* 转写一个 wav 文件 → 文本；失败/超时返回 ''（与 whisper 路径同一约定："空串=这段没有/失败"） */
async function transcribeFile(wavPath, opts = {}) {
  const key = readKey();
  if (!key) return '';
  let b64 = '';
  try { b64 = fs.readFileSync(wavPath).toString('base64'); } catch (e) { return ''; }
  let url;
  try { url = chatEndpoint(); } catch (e) { return ''; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: opts.model || MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: '请将音频转写为简体中文普通话文本，只输出转写内容。' },
            { type: 'input_audio', input_audio: { data: b64, format: 'wav' } },
          ],
        }],
      }),
    });
    if (!res.ok) return '';
    const data = await res.json().catch(() => null);
    const text = data && data.choices && data.choices[0] && data.choices[0].message
      ? String(data.choices[0].message.content || '').trim() : '';
    return text.replace(/\s+/g, ' ');
  } catch (e) {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

/* 探测：拿 0.3s 静音 wav 真打一次接口（HTTP 200 即认为引擎可用，文本为空属正常）。
 * 结果缓存 10 分钟（同 TTS 探测口径）；调用方负责拼静音 wav（server.js 预热里已有同款）。 */
const probeState = { ok: null, at: 0, probing: false };
async function probe({ force = false } = {}) {
  if (!readKey()) return false;
  const TTL = 10 * 60000;
  if (!force && probeState.at && Date.now() - probeState.at < TTL) return !!probeState.ok;
  if (probeState.probing) return !!probeState.ok;
  probeState.probing = true;
  try {
    const sampleRate = 16000, dataBytes = Math.floor(sampleRate * 0.3) * 2;
    const buf = Buffer.alloc(44 + dataBytes);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataBytes, 4); buf.write('WAVE', 8);
    buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28);
    buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
    buf.write('data', 36); buf.writeUInt32LE(dataBytes, 40);
    const url = chatEndpoint();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${readKey()}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: [
          { type: 'text', text: '请将音频转写为简体中文普通话文本，只输出转写内容。' },
          { type: 'input_audio', input_audio: { data: buf.toString('base64'), format: 'wav' } },
        ] }],
      }),
    });
    probeState.ok = res.ok;
  } catch (e) { probeState.ok = false; }
  probeState.at = Date.now();
  probeState.probing = false;
  return !!probeState.ok;
}

module.exports = { transcribeFile, probe, readKey, chatEndpoint, MODEL, BASE };
