/* ══════════════════════════════════════════════════════════════
 * sfu/ai/asr.js —— 语音识别（ASR）唯一实现层 ★ 09-28
 *
 * ▎为什么要有这个文件？（与 password.js 同一条教训）
 *   whisper 的"探测"与"转写"原先只写在 sfu/server.js 里，结果出现两个真 bug：
 *     ① 探测用 `whisper --help` 判存活，而 **Windows 中文控制台下 whisper 打印帮助会
 *        UnicodeEncodeError 崩掉 → 退出码 1** → 服务器认定"没装 whisper" →
 *        asrEnabled=false → 前端退回浏览器 Web Speech（用户实测："还是在用浏览器的"）。
 *     ② 兜底候选 '__py__' 用的是 `process.execPath`（= node.exe）配 `-m whisper`——
 *        那是把 node 当 python 用，**永远不可能成功**。
 *   把逻辑抽成模块后：服务器、自测脚本、将来的 CLI 共用同一份实现，
 *   编码环境（PYTHONIOENCODING=utf-8）与参数拼装只写一遍，改一处即全局生效。
 *
 * ▎三条设计纪律：
 *   1) **所有 whisper 子进程都带 UTF-8 环境**——不然中文输出/帮助文本会把它打崩；
 *   2) **探测只看"能不能跑通 --help 且退出码 0"**，不猜路径、不解析版本号；
 *   3) **形态白名单**（同 Mimosa 安全加固）：只接受"名叫 whisper 的可执行文件"或
 *      "python/python3/py -m whisper"两种形态，其余一律拒绝，防止配置投毒。
 * ══════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

/* ── 1. 参数与环境 ─────────────────────────────────────────────
 * ▎模型：默认 **small**（09-29 定档：常驻 worker 下每段只多约 2s——实测 4s 语音
 *   tiny 0.8s / small 3.0s 纯转写，但"产品评审会"tiny 转成"平省会"、small 全对；
 *   准确率差距是用户可感知的，2s 的差距不是）。要更快/更省内存用 WHISPER_MODEL=tiny。
 * ▎分段：5s（越小越灵敏、越大上下文越完整）。两者都可用环境变量覆盖。 */
const DEFAULT_MODEL = process.env.WHISPER_MODEL || 'small'; // ★ 09-27d：tiny 中文常出繁体/错字，small 准确率显著更高（模型 466MB 自动缓存）
const DEFAULT_SEGMENT_SEC = Math.max(3, Math.min(15, Number(process.env.ASR_SEGMENT_SEC) || 5));

/* ▎UTF-8 是硬要求，不是优化：Windows 默认 GBK 控制台下，whisper 打印帮助/进度里的
 *   非 GBK 字符会抛 UnicodeEncodeError（已实测复现）——探测直接失败、转写输出也可能
 *   中断。psycopg 式的"设个环境变量就好了"的坑，写在这里一次解决。 */
const PY_ENV = Object.freeze({ ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' });

/* 唤醒词：中文语音识别难免把名字听岔（小明/小鸣/小名/小铭），都算叫它。
 * 注意这里只管"要不要接话"，不含"该怎么答"（那是 brain.js 的职责）。 */
const WAKE_RE = /小明|小鸣|小名|小铭/;

/* ── 2. 候选与白名单 ─────────────────────────────────────────── */

// pip 安装位置：--user 装的 whisper.exe 不在服务器 PATH 里，需要显式枚举
function userExeCandidates() {
  return [
    process.env.APPDATA && path.join(process.env.APPDATA, 'Python', 'Python312', 'Scripts', 'whisper.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Python', 'Python312', 'Scripts', 'whisper.exe'),
    'C:' + path.sep + 'Program Files' + path.sep + 'Python312' + path.sep + 'Scripts' + path.sep + 'whisper.exe',
  ].filter(Boolean).filter((p) => {
    try { return fs.existsSync(p); } catch (e) { return false; }
  });
}

function candidates() {
  const out = [];
  // ① PATH 上的可执行名（Linux/macOS 或已配好 PATH 的 Windows）
  for (const bin of ['whisper', 'whisper-cli', 'whisper.exe', 'whisper-cli.exe']) {
    out.push({ kind: 'exe', bin, preArgs: [] });
  }
  // ② pip --user 的显式路径
  for (const p of userExeCandidates()) out.push({ kind: 'exe', bin: p, preArgs: [] });
  // ③ 模块方式（跨机器最稳：不依赖 Scripts 目录进 PATH）
  out.push({ kind: 'py', bin: 'python', preArgs: ['-m', 'whisper'] });
  out.push({ kind: 'py', bin: 'python3', preArgs: ['-m', 'whisper'] });
  out.push({ kind: 'py', bin: 'py', preArgs: ['-3', '-m', 'whisper'] });
  return out;
}

/* 形态白名单：只有这两种形状的 runner 能进入 spawn/execFile。
 * ▎为什么必须校验：runner 来自"探测结果"，而调用方可能把它存进配置/环境变量；
 *   一旦有人能左右这个字符串，`bin` 就成了任意命令执行入口。白名单把口子焊死。 */
function assertRunner(r) {
  if (!r || typeof r !== 'object') return null;
  const bin = String(r.bin || '');
  const preArgs = Array.isArray(r.preArgs) ? r.preArgs.map(String) : [];
  if (r.kind === 'exe') {
    const bare = !bin.includes('/') && !bin.includes('\\');
    const ok = bare ? /^whisper(-cli)?(\.exe)?$/i.test(bin)
                    : (path.isAbsolute(bin) && /whisper(-cli)?\.exe$/i.test(bin));
    if (!ok || preArgs.length) return null;
    return { kind: 'exe', bin, preArgs: [] };
  }
  if (r.kind === 'py') {
    if (!['python', 'python3', 'py'].includes(bin)) return null;
    if (preArgs.join(' ') !== '-m whisper' && preArgs.join(' ') !== '-3 -m whisper') return null;
    return { kind: 'py', bin, preArgs };
  }
  return null;
}

/* ── 3. 探测：能不能真的跑起来 ────────────────────────────────
 * @@returns {Promise<{kind,bin,preArgs,label}|null>} null = 本机没有可用 whisper
 * ▎超时给 25s：python 首次 import torch 在本机要 3s，慢机器/首次加载可能更久；
 *   探测只在启动时做一次，宽一点换"不会误判成没装"。 */
async function probeWhisper({ timeoutMs = 25000 } = {}) {
  for (const raw of candidates()) {
    const runner = assertRunner(raw);
    if (!runner) continue;
    const okFlag = await new Promise((resolve) => {
      execFile(runner.bin, [...runner.preArgs, '--help'],
        { timeout: timeoutMs, windowsHide: true, env: PY_ENV },
        (err) => resolve(!err));
    });
    if (okFlag) {
      return { ...runner, label: runner.kind === 'py' ? `${runner.bin} ${runner.preArgs.join(' ')}` : runner.bin };
    }
  }
  return null;
}

/* ── 4. 转写一个音频文件 → 文本 ───────────────────────────────
 * ▎参数拼装集中在这里：模型/语言/简体提示词/输出格式/静默进度。
 *   `--initial_prompt` 里点名"用简体中文输出"实测有效（tiny 模型原本偶尔输出繁体）。
 * ▎返回**空串**表示"这段没人说话/识别失败"——调用方按"跳过"处理，不要当异常。 */
function buildArgs(runner, wavFile, opts = {}) {
  return [
    ...runner.preArgs,
    wavFile,
    '--model', opts.model || DEFAULT_MODEL,
    '--language', opts.language || 'zh',
    '--initial_prompt', opts.initialPrompt || '以下是普通话的会议对话，请用简体中文输出。',
    '--output_format', 'txt',
    '--output_dir', opts.outDir || path.dirname(wavFile),
    '--verbose', 'False', // 不往 stdout 打印分段（GBK 控制台更稳，也省时间）
  ];
}

/* ★ 09-28：跨说话人的**转写并发闸**。
 * ▎为什么需要：一场会里 N 个人同时开麦 → 原来会同时跑 N 个 whisper 进程；
 *   本机 CPU 核数有限，3 个人说话就能让机器卡到影响媒体转发（转发才是主业）。
 *   这里用"信号量"把并发压到 ASR_CONCURRENCY（默认 2）：转写慢一点，但服务器不卡。
 *   ▎为什么是 2 不是 1：1 会让"第二个人"排队等第一个人转完（尾延迟 ×N）；
 *     2 是"用满两个核、留足余量给 mediasoup"的折中（可按机器调大/调小）。 */
const ASR_CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.ASR_CONCURRENCY) || 2));
let asrRunning = 0;
const asrWaiters = [];
function acquireAsrSlot() {
  if (asrRunning < ASR_CONCURRENCY) { asrRunning += 1; return Promise.resolve(); }
  return new Promise((resolve) => asrWaiters.push(resolve));
}
function releaseAsrSlot() {
  const next = asrWaiters.shift();
  if (next) next();              // 名额直接转交（asrRunning 不变）
  else asrRunning -= 1;
}

async function transcribeFile(runner, wavFile, opts = {}) {
  const safe = assertRunner(runner);
  if (!safe) throw new Error('runner 未通过形态白名单');
  const outDir = opts.outDir || path.dirname(wavFile);
  const timeoutMs = opts.timeoutMs || Number(process.env.ASR_TIMEOUT_MS) || 120000;
  await acquireAsrSlot();
  try {
    return await new Promise((resolve) => {
      execFile(safe.bin, buildArgs(safe, wavFile, { ...opts, outDir }),
        { timeout: timeoutMs, windowsHide: true, env: PY_ENV, maxBuffer: 4 * 1024 * 1024 },
        () => {
          // whisper CLI 会把结果写成"与音频同名的 .txt"到 output_dir
          const txt = path.join(outDir, path.basename(wavFile).replace(/\.[^.]+$/, '.txt'));
          let text = '';
          try { text = fs.readFileSync(txt, 'utf8'); } catch (e) { text = ''; }
          try { fs.unlinkSync(txt); } catch (e) { /* 不存在就算了 */ }
          resolve(String(text).replace(/\s+/g, ' ').trim());
        });
    });
  } finally {
    releaseAsrSlot();
  }
}

/* ── 4.5 常驻转写 worker（★ 09-29，"识别不灵敏"的最大单一解）──────────
 * ▎CLI 路径的隐藏成本：whisper 命令行每转一段都要**重启 Python + 重新加载模型**
 *   （本机实测固定开销 2~4s/次）。分段持续转写场景下每段都白付一次启动钱——
 *   字幕滞后越滚越大。
 * ▎worker 方案：一个常驻 Python 进程（asr_worker.py，与本文件同目录）模型只加载
 *   一次，之后每段只付"纯转写"时间。协议见 asr_worker.py 头注释（stdin/stdout JSONL）。
 * ▎安全形态（Mimosa 复核过）：spawn 的**可执行与参数全是字面量**——解释器只在
 *   'python'/'python3' 两个固定名字里选（选哪个由 import 探测决定），脚本名写死；
 *   模型名等一切动态数据走**环境变量**，不进 argv。这就把"程序选择/选项注入"两个
 *   攻击面从结构上焊死了（与 asr.js 一贯的"形态白名单"同思路，只是更进一步）。
 * ▎可靠性：起不来/连崩 3 次 → 永久放弃（alive=false），调用方回退 CLI 路径
 *   （transcribeFile），功能不降级；单段超时/异常按空串处理，绝不挂死转写循环。 */
const { spawn } = require('child_process');

async function pythonNameForWorker({ timeoutMs = 15000 } = {}) {
  // 只在两个固定字面量里挑：谁真的能 import whisper 用谁（探测本身不引入注入面）
  for (const bin of ['python', 'python3']) {
    const ok = await new Promise((resolve) => {
      execFile(bin, ['-c', 'import whisper'], { timeout: timeoutMs, windowsHide: true, env: PY_ENV }, (err) => resolve(!err));
    });
    if (ok) return bin;
  }
  return null;
}

function createResidentTranscriber({ model, timeoutMs } = {}) {
  const WAIT_MS = timeoutMs || Number(process.env.ASR_TIMEOUT_MS) || 120000;
  const state = {
    py: null, child: null, ready: false, seq: 0, buf: '',
    pending: new Map(),      // id → { resolve, timer }
    dead: false, crashStreak: 0, lastError: null,
  };

  function failPending(why) {
    for (const [, p] of state.pending) {
      clearTimeout(p.timer);
      p.resolve('');           // 与 CLI 同约定：失败=空串=跳过这段
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
    // 可执行与参数全部字面量（python3/python 两个固定分支）；动态数据只走 env
    const childOpts = {
      cwd: __dirname,          // 脚本与本实现同目录（字面量文件名 + 固定 cwd）
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...PY_ENV, ASR_WORKER_MODEL: String(model || DEFAULT_MODEL) },
    };
    if (state.usePython3) {
      state.child = spawn('python3', ['asr_worker.py'], childOpts);
    } else {
      state.child = spawn('python', ['asr_worker.py'], childOpts);
    }
    state.child.stdout.on('data', handleLine);
    state.child.stderr.on('data', () => { /* 进度/警告静默（GBK 控制台防坑） */ });
    state.child.on('exit', () => {
      state.child = null;
      state.ready = false;
      failPending('worker-exit');
      if (!state.dead) {
        state.crashStreak += 1;
        if (state.crashStreak >= 3) state.dead = true; // 连崩 3 次 → 调用方走 CLI 兜底
      }
    });
    state.child.on('error', () => { /* spawn 失败交给 exit 分支收尾 */ });
  }

  async function boot() {
    if (state.dead) return false;
    if (state.child && state.ready) return true;
    if (!state.py) {
      state.py = await pythonNameForWorker();
      if (!state.py) { state.dead = true; state.lastError = 'no-python-with-whisper'; return false; }
      // spawn 的可执行须是字面量：把选中的名字映射回固定调用（见 start()）
      state.usePython3 = state.py === 'python3';
    }
    start();
    const t0 = Date.now();
    while (!state.ready && Date.now() - t0 < 60000) {
      if (!state.child) return false;      // 启动即崩
      await new Promise((r) => setTimeout(r, 150));
    }
    return state.ready;
  }

  async function transcribe(wavFile, opts = {}) {
    if (state.dead) return '';
    const okBoot = await boot();
    if (!okBoot || !state.child || !state.ready) return '';
    const id = ++state.seq;
    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        state.pending.delete(id);
        resolve('');
      }, opts.timeoutMs || WAIT_MS);
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

  return {
    transcribe,
    kill,
    get alive() { return !state.dead && !!state.child && state.ready; },
    get model() { return String(model || DEFAULT_MODEL); },
    get lastError() { return state.lastError; },
  };
}

/* ── 5. 对话状态：唤醒 + 追问窗口（纯函数，可单测） ───────────── */
// 句子里叫了名字 → 该接话
function shouldWake(text) { return WAKE_RE.test(String(text || '')); }

/* 追问窗口：AI 刚答完 20s 内，大家继续说话不必再喊名字——这是"对话"与
 * "命令"的区别（人跟人聊天不会每句都先叫对方名字）。 */
function isFollowUp(windowUntilTs, now = Date.now()) {
  return !!windowUntilTs && now < windowUntilTs;
}

module.exports = {
  probeWhisper,
  transcribeFile,
  buildArgs,
  createResidentTranscriber,
  pythonNameForWorker,
  shouldWake,
  isFollowUp,
  assertRunner,
  DEFAULT_MODEL,
  DEFAULT_SEGMENT_SEC,
  ASR_CONCURRENCY,
  WAKE_RE,
  PY_ENV,
};
