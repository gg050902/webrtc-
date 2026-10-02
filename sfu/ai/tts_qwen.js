/* ══════════════════════════════════════════════════════════════
 * sfu/ai/tts_qwen.js —— Qwen3-TTS **本地**常驻合成器（Node 侧，★ 2026-10-01）
 *
 * ▎为什么：Edge 神经语音在本机网络出口 403（外部不可控）、浏览器 TTS 音色"AI 味"——
 *   Qwen3-TTS-0.6B 本地推理给出第三条路：服务器自持音色、零外部依赖（模型下载一次）。
 * ▎与 ASR worker 同款常驻协议（JSONL）+ 同款安全形态（spawn 全字面量、动态数据走 env）。
 * ▎链路定位：speakAnswerForRoom 的引擎顺序 = **Qwen 本地（活着就优先）→ Edge（探测通过）
 *   → 浏览器 TTS（前端兜底）**。CPU 生成较慢（一句 5~20s，诚实边界）——
 *   `TTS_QWEN=0` 可整体关闭；回答文字照常进气泡，语音只是慢一点/没有。
 * ══════════════════════════════════════════════════════════════ */
'use strict';

const { spawn } = require('child_process');

const state = {
  py: null, usePython3: false, child: null, ready: false, seq: 0, buf: '',
  pending: new Map(), dead: false, crashStreak: 0, lastError: null,
};

function failPending(why) {
  for (const [, p] of state.pending) {
    clearTimeout(p.timer);
    p.resolve(null);
  }
  state.pending.clear();
  if (why) state.lastError = why;
}

function handleLine(chunk) {
  state.buf += chunk.toString('utf8');
  let idx;
  while ((idx = state.buf.indexOf('\n')) >= 0) {
    const line = state.buf.slice(0, idx).trim();
    state.buf = state.buf.slice(idx + 1);
    if (!line) continue;
    let msg = null;
    try { msg = JSON.parse(line); } catch (e) { continue; }
    if (msg.ready) { state.ready = true; state.crashStreak = 0; continue; }
    if (msg.fatal) { state.lastError = msg.fatal; failPending('fatal'); continue; }
    const p = state.pending.get(msg.id);
    if (!p) continue;
    state.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.wav_b64) {
      try { p.resolve({ buf: Buffer.from(msg.wav_b64, 'base64'), type: 'wav' }); }
      catch (e) { p.resolve(null); }
    } else p.resolve(null);
  }
}

function start() {
  if (state.dead || state.child) return;
  state.ready = false;
  state.buf = '';
  const childOpts = {
    cwd: __dirname,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      QWEN_TTS_MODEL: String(process.env.QWEN_TTS_MODEL || 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice'),
      QWEN_TTS_SPEAKER: String(process.env.QWEN_TTS_SPEAKER || 'Vivian'),
      QWEN_TTS_LANGUAGE: String(process.env.QWEN_TTS_LANGUAGE || 'Chinese'),
    },
  };
  if (state.usePython3) state.child = spawn('python3', ['qwen_tts_worker.py'], childOpts);
  else state.child = spawn('python', ['qwen_tts_worker.py'], childOpts);
  state.child.stdout.on('data', handleLine);
  state.child.stderr.on('data', () => { /* 进度静默 */ });
  state.child.on('exit', () => {
    state.child = null;
    state.ready = false;
    failPending('worker-exit');
    if (!state.dead) {
      state.crashStreak += 1;
      if (state.crashStreak >= 3) state.dead = true;
    }
  });
  state.child.on('error', () => { /* spawn 失败交给 exit */ });
}

/* ★ 2026-10-02 同 asr_qwen_local：`import qwen_tts` 实测 18.4s > 旧的 15s 上限，
 *   一冷就误判"没装"→ QwenTts.alive 永远 false → 神经音色整条不生效。
 *   判据统一交给 pyprobe（区分"真没装"与"此刻没答上来"，超时重试一趟长的）。 */
async function pythonNameForWorker() {
  const { probePythonModule } = require('./pyprobe');
  const r = await probePythonModule('qwen_tts');
  if (!r.bin) state.lastError = r.reason;
  return r.bin;
}

async function boot() {
  if (state.dead) return false;
  if (state.child && state.ready) return true;
  if (!state.py) {
    state.py = await pythonNameForWorker();
    if (!state.py) { state.dead = true; state.lastError = 'no-python-with-qwen_tts'; return false; }
    state.usePython3 = state.py === 'python3';
  }
  start();
  const t0 = Date.now();
  while (!state.ready && Date.now() - t0 < 180000) {
    if (!state.child) return false;
    await new Promise((r) => setTimeout(r, 300));
  }
  return state.ready;
}

/* 合成一句 → {buf, type:'wav'} | null（失败/超时）。CPU 慢，超时默认 90s。 */
async function synthesize(text, opts = {}) {
  if (state.dead) return null;
  const say = String(text || '').trim();
  if (!say) return null;
  const okBoot = await boot();
  if (!okBoot || !state.child || !state.ready) return null;
  const id = ++state.seq;
  return await new Promise((resolve) => {
    const timer = setTimeout(() => { state.pending.delete(id); resolve(null); }, opts.timeoutMs || 90000);
    state.pending.set(id, { resolve, timer });
    try {
      state.child.stdin.write(JSON.stringify({ id, text: say.slice(0, 300) }) + '\n');
    } catch (e) {
      state.pending.delete(id);
      clearTimeout(timer);
      resolve(null);
    }
  });
}

function kill() {
  state.dead = true;
  failPending('killed');
  try { if (state.child) { state.child.stdin.end(); state.child.kill(); } } catch (e) { /* 忽略 */ }
  state.child = null;
}

/* 非阻塞预热：开机加载模型（未就绪时播报链直接落 Edge/浏览器 TTS）。
 * ★ 2026-10-02 返回 boot() 结果，调用方据此决定打不打"🔥 已预热"——
 *   原来恒 undefined，失败也报成功（假绿）。 */
async function warm() { try { return await boot(); } catch (e) { return false; } }

module.exports = {
  synthesize,
  warm,
  kill,
  get alive() { return !state.dead && !!state.child && state.ready; },
  get lastError() { return state.lastError; },
};
