/* ══════════════════════════════════════════════════════════════
 * sfu/ai/asr_qwen_local.js —— Qwen3-ASR **本地**常驻转写器（Node 侧，★ 2026-10-01）
 *
 * ▎与 asr.js 的 createResidentTranscriber 同款设计：常驻 Python 进程
 *   （qwen_asr_worker.py）模型只加载一次，stdin/stdout JSONL，每段只付纯转写时间。
 * ▎安全形态（同 whisper worker）：spawn 的可执行与参数全字面量（python/python3 二选一
 *   + 写死脚本名 + 固定 cwd），模型/语言等动态数据走环境变量；连崩 3 次放弃，
 *   调用方回落 whisper。
 * ▎诚实边界：CPU 推理 0.6B 音频模型，单段延迟要实测——用它之前先 bench（bench:asr）。
 * ══════════════════════════════════════════════════════════════ */
'use strict';

const { spawn } = require('child_process');

const WAIT_MS = Number(process.env.ASR_TIMEOUT_MS) || 120000;
const state = {
  py: null, usePython3: false, child: null, ready: false, seq: 0, buf: '',
  pending: new Map(), dead: false, crashStreak: 0, lastError: null,
};

function failPending(why) {
  for (const [, p] of state.pending) {
    clearTimeout(p.timer);
    p.resolve('');
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
    p.resolve(String(msg.text || '').replace(/\s+/g, ' ').trim());
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
      QWEN_ASR_MODEL: String(process.env.QWEN_ASR_MODEL || 'Qwen/Qwen3-ASR-0.6B'),
      QWEN_ASR_LANGUAGE: String(process.env.QWEN_ASR_LANGUAGE || 'Chinese'),
    },
  };
  if (state.usePython3) state.child = spawn('python3', ['qwen_asr_worker.py'], childOpts);
  else state.child = spawn('python', ['qwen_asr_worker.py'], childOpts);
  state.child.stdout.on('data', handleLine);
  state.child.stderr.on('data', () => { /* 进度/警告静默 */ });
  state.child.on('exit', () => {
    state.child = null;
    state.ready = false;
    failPending('worker-exit');
    if (!state.dead) {
      state.crashStreak += 1;
      if (state.crashStreak >= 3) state.dead = true;
    }
  });
  state.child.on('error', () => { /* spawn 失败交给 exit 分支 */ });
}

/* ★ 2026-10-02 实测坐实的误判：`import qwen_asr` 冷启动要 **21.7s**（torch 一族），
 *   而这里原先写死 `timeout: 15000` + "报错即没装" → 机器一冷就被判成"没装 Qwen"，
 *   本地引擎悄悄不启用（症状：识别还是 whisper、音色还是机械的）。
 *   判据换成 sfu/ai/pyprobe.js：区分 enoent / 没装 / 太慢，超时再给一趟长预算重试。 */
async function pythonNameForWorker() {
  const { probePythonModule } = require('./pyprobe');
  const r = await probePythonModule('qwen_asr');
  if (!r.bin) state.lastError = r.reason;
  return r.bin;
}

async function boot() {
  if (state.dead) return false;
  if (state.child && state.ready) return true;
  if (!state.py) {
    state.py = await pythonNameForWorker();
    if (!state.py) { state.dead = true; state.lastError = 'no-python-with-qwen_asr'; return false; }
    state.usePython3 = state.py === 'python3';
  }
  start();
  const t0 = Date.now();
  while (!state.ready && Date.now() - t0 < 180000) { // 本地大模型加载可能要几分钟
    if (!state.child) return false;
    await new Promise((r) => setTimeout(r, 300));
  }
  return state.ready;
}

async function transcribe(wavFile, opts = {}) {
  if (state.dead) return '';
  const okBoot = await boot();
  if (!okBoot || !state.child || !state.ready) return '';
  const id = ++state.seq;
  return await new Promise((resolve) => {
    const timer = setTimeout(() => { state.pending.delete(id); resolve(''); }, opts.timeoutMs || WAIT_MS);
    state.pending.set(id, { resolve, timer });
    try {
      state.child.stdin.write(JSON.stringify({ id, wav: String(wavFile) }) + '\n');
    } catch (e) {
      state.pending.delete(id);
      clearTimeout(timer);
      resolve('');
    }
  });
}

function kill() {
  state.dead = true;
  failPending('killed');
  try { if (state.child) { state.child.stdin.end(); state.child.kill(); } } catch (e) { /* 忽略 */ }
  state.child = null;
}

/* 非阻塞预热：触发 worker 加载但不等待（服务器开机用；未就绪时调用方走 whisper 兜底）。
 * ★ 2026-10-02 返回 boot() 的结果——原来恒返回 undefined，调用方 .then() 里无条件打
 *   "🔥 已预热"，于是**探测失败也报成功**（假绿）。现在由调用方按返回值说实话。 */
async function warm() { try { return await boot(); } catch (e) { return false; } }

module.exports = {
  transcribe,
  warm,
  kill,
  get alive() { return !state.dead && !!state.child && state.ready; },
  get lastError() { return state.lastError; },
};
