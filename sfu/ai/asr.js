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
const DEFAULT_SEGMENT_SEC = Math.max(3, Math.min(15, Number(process.env.ASR_SEGMENT_SEC) || 4));

/* ▎UTF-8 是硬要求，不是优化：Windows 默认 GBK 控制台下，whisper 打印帮助/进度里的
 *   非 GBK 字符会抛 UnicodeEncodeError（已实测复现）——探测直接失败、转写输出也可能
 *   中断。psycopg 式的"设个环境变量就好了"的坑，写在这里一次解决。 */
const PY_ENV = Object.freeze({ ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' });

/* 唤醒词：中文语音识别难免把名字听岔（小明/小鸣/小名/小铭），都算叫它。
 * 注意这里只管"要不要接话"，不含"该怎么答"（那是 brain.js 的职责）。 */
const WAKE_RE = /小明|小鸣|小名|小铭/;

/* ── 1.5 静音幻觉清洗 + 能量闸（★ 2026-10-02，用户实测"AI 一直收到重复的一句话"的根因）
 *
 * ▎现场证据（sfu/captions/cap-746646-20261002.jsonl）：账本里每 2.4~4s 就有一条
 *   `asr:true` 的字幕，文本一模一样——**「请用简体中文输出。」**
 *   那不是有人在说话，那是 whisper 的 --initial_prompt 被**当成转写结果回显**了：
 *   模型遇到纯静音没有内容可写，就顺着提示词往下"续写"，把提示词尾巴吐成一句话。
 * ▎为什么旧的门槛挡不住：管线里判的是 `size < 40000`（约 1.25s 音频），
 *   它量的是**时长**不是**能量**——一段 4s 的纯静音有 128KB，照样大摇大摆进了转写。
 *   （prewarmAsrWorker 就是拿 0.3s 纯静音喂 worker 的，那条路径的结果被丢弃所以没人看见，
 *    但同一个机制在生产路径上每 4 秒制造一条假字幕。）
 * ▎后果链：假字幕 → 落进 20s 追问窗口 → 每条都触发一次完整应答（流式气泡 + TTS）
 *   → "AI 每两三秒重复回答同一句话" + "对话很混乱" + 朗读被自己的假字幕一路 hush 掉
 *   → "后边它回答没有说话"。所以这一刀是**从源头断流**，比在下游加节流更正确。
 *
 * ▎两道防线（都要，缺一不可）：
 *   ① **能量闸 measureWavLevel()**：转写之前先量这段音频有没有声——没声就直接删段，
 *      **连模型都不叫**。既治幻觉又省 CPU/降延迟（静音段不再排队的隐藏收益）。
 *   ② **文本清洗 cleanTranscript()**：真有声音时模型也可能回显提示词/吐经典幻句
 *      （"字幕by XXX"、"谢谢大家"），这层把它擦干净；擦完什么都不剩 → 返回空串，
 *      调用方按"这段没人说话"跳过（与本文件"空串=跳过"的既有约定一致）。
 * ▎为什么空串而不是抛错：转写失败与"没人说话"在业务上等价（这段没有可用信息），
 *   而抛错会让单段失败拖垮整条转写循环——这条约定从 09-28 就是这样，别改。 */

/* ▎提示词改短的**原因**（不是随手措辞）：原来那句写成祈使句「…请用简体中文输出。」，
 *   模型续写静音时就照抄这句；换成不含谓语的**中性名词短语**后，即使被回显也一眼可辨、
 *   且 cleanTranscript 的黑名单正好盯着这几个字。
 * ▎单一来源（坑 47）：asr_worker.py 原先自己写了一份同样的字符串——两处字面量迟早漂移，
 *   现在 worker 通过 ASR_WORKER_PROMPT 环境变量取这一份。 */
const ASR_PROMPT = '普通话会议对话，简体中文';

/* 会被当成"提示词回显/静音幻句"的片段。命中即从文本里擦掉（不是整条丢掉——
 * 真实句子里偶尔夹一个词被误伤的概率，比整条丢弃导致丢真话低）。 */
const HALLUCIN_FRAGS = [
  /请[用使][^，。,]{0,12}(输出|简体|中文)/g,
  /以下是普通话[^。，,]*/g,
  /普通话会议对话/g,
  /简体?中文/g,
  /^[\s]*(字幕|Subtitles?)(by|：|:)?[\w\s\byyyymmdd./-]{0,30}$/i,
  /^\s*(谢谢(大家|观看|聆听)?[。！!]?)\s*$/,
  /^\s*(The end|全文完|完)\s*$/i,
];

/* 清洗一段转写文本 → 可用的句子；返回 '' 表示"这段等于没人说话"。
 * 纯函数、无依赖，所以能被 test:asr 直接逐条断言（性能/语义逻辑都要可穷举）。 */
function cleanTranscript(raw) {
  let t = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  for (const re of HALLUCIN_FRAGS) t = t.replace(re, '');
  // 擦掉片段后会留下光秃秃的句首标点（"。明天下午三点…"），一并去掉
  t = t.replace(/^[\s，,。.、；;：:]+/, '').replace(/[\s，,、；;]+$/, '').trim();
  // 折叠"同一短句连着复读"（幻觉风暴在语句组装后会长成 A A A 的样子）
  t = t.replace(/^(.{2,20}?)([，,。.\s]*)\1(?![\w])/, '$1');
  // 擦干净后只剩标点/单字 → 当作没有内容（唤醒与账本都不需要这种条目）
  if (t.replace(/[\s，,。.、！!？?：:;；…~\-]/g, '').length < 2) return '';
  return t;
}

/* 量一段 16k/单声道/16bit PCM wav 的峰值电平（dBFS）。
 * ▎为什么在 Node 里自己算而不是问 ffmpeg：这就是 64000 个 sample 的一次遍历，
 *   亚毫秒级、零进程、零新依赖；而"再起一个 ffmpeg 探测一遍"要给每段多付一次进程钱。
 * ▎用 peak 不用 rms：安静说话的人 rms 可能低到和房间噪声分不开，peak 能分辨"有没有出声"。
 * ▎**fail-open 是硬要求**：文件读不到、格式不是我们预期的 PCM16mono，一律返回 null
 *   （= "判断不了"）→ 调用方照常转写。宁可漏掉一次静音过滤，也绝不能把真话当静音删掉。 */
function measureWavLevel(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { return null; }
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let fmt = null;
  for (let i = 12; i + 8 <= buf.length;) {
    const id = buf.toString('ascii', i, i + 4);
    const size = buf.readUInt32LE(i + 4);
    if (id === 'fmt ') {
      fmt = { audioFormat: buf.readUInt16LE(i + 8), channels: buf.readUInt16LE(i + 10), bits: buf.readUInt16LE(i + 22) };
    }
    if (id === 'data') {
      if (!fmt || fmt.audioFormat !== 1 || fmt.channels !== 1 || fmt.bits !== 16) return null; // 非预期形态：不猜
      const end = Math.min(i + 8 + size, buf.length);
      let peak = 0;
      for (let p = i + 8; p + 1 < end; p += 2) {
        const s = Math.abs(buf.readInt16LE(p));
        if (s > peak) peak = s;
      }
      return { peakDb: peak > 0 ? 20 * Math.log10(peak / 32768) : -99, samples: (end - i - 8) / 2 };
    }
    i += 8 + size + (size % 2); // chunk 按偶数字节对齐
  }
  return null;
}

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
 * ▎参数拼装集中在这里：模型/语言/提示词/输出格式/静默进度。
 * ▎提示词见 1.5 节：它必须是**不会被回显成整句**的中性短语——旧值那句祈使句
 *   在静音段被模型照抄成"请用简体中文输出。"，就是本轮"AI 收到重复一句话"的现场。
 * ▎返回**空串**表示"这段没人说话/识别失败"——调用方按"跳过"处理，不要当异常。
 *   ★ 2026-10-02 起这里真的会返回空串了：结果统一过 cleanTranscript()。 */
function buildArgs(runner, wavFile, opts = {}) {
  return [
    ...runner.preArgs,
    wavFile,
    '--model', opts.model || DEFAULT_MODEL,
    '--language', opts.language || 'zh',
    '--initial_prompt', opts.initialPrompt || ASR_PROMPT,
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
          resolve(cleanTranscript(text));
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

/* ★ 2026-10-02 探测改走 sfu/ai/pyprobe.js（唯一实现）：
 *   原来这里也是 `timeout: 15000` + "err 即没装"，与坑 37 同一个错法——
 *   只是 whisper 的导入比 torch 一族快，才没被踩到。共用一份实现，
 *   下次改判据（比如再加一趟重试）三处一起生效。 */
async function pythonNameForWorker() {
  const { probePythonModule } = require('./pyprobe');
  const r = await probePythonModule('whisper');
  return r.bin; // 'python' | 'python3' | null（null = 真不可用，调用方回退 CLI 路径）
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
      p.resolve(cleanTranscript(msg.text));
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
      env: {
        ...PY_ENV,
        ASR_WORKER_MODEL: String(model || DEFAULT_MODEL),
        ASR_WORKER_PROMPT: ASR_PROMPT, // ★ 2026-10-02 提示词单一来源（worker 侧不再自己写一份）
      },
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

/* ── 5b. ★ 2026-10-03 「这是上一句的碎片」判据（纯函数，test:asr 逐条断言） ──
 * ▎要解决的真问题：4s 分段窗口会把**一句人说出口的话**切成两个 wav 分别转写，
 *   于是同一句话在账本里出现两条、AI 也应答两次（`test:asr-live` 在 qwen-local
 *   引擎下实测到 3 条字幕 / 3 次应答，用户侧观感就是"它又在重复接话"）。
 * ▎为什么原来的"归一化包含"判据拦不住：分段边界会带来**写法漂移**——
 *   「…下午三点的评审。」与「…下午3点的评审会。」既不相等、也不互相包含
 *   （三↔3 的写法差 + 尾字被截断），而它们确实是同一句。
 * ▎判据（三个条件同时成立才算碎片，缺一会误杀真人追问）：
 *   ① **方向性**：算"新句被旧句覆盖的比例"，不是对称相似度。
 *      反向的例子必须放过：先说「小明」（打招呼）、紧跟着说「小明，把纪要生成一下」——
 *      后者包含前者，但它是一句**新的、信息更全**的话，绝不能被当成碎片丢掉。
 *   ② **有新信息就放行**：新句里没被旧句覆盖的 bigram 数量 > 4 就算"说了新东西"。
 *   ③ **只比长度够的句子**：单字/双字的归一化文本（「小」「嗯」）bigram 太少，
 *      比例在统计上没有意义，不下结论（同坑 53：样本太小就别拿占比判够不够格）。
 * ▎窗口与"同一说话人"由调用方把关（见 server 的 finalizeUtterance）：
 *   两个人先后说同样的话是两件事，不能把后一个人的字幕吞掉。 */
function bigramSet(s) {
  const t = String(s || '');
  const out = new Set();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  if (!out.size && t.length === 1) out.add(t); // 单字句退化成 unigram，避免空集判不出
  return out;
}
function isFragmentOf(prevNorm, norm) {
  const a = bigramSet(prevNorm);
  const b = bigramSet(norm);
  if (a.size < 3 || b.size < 3) return false;     // ③ 太短不下结论
  let covered = 0;
  for (const g of b) if (a.has(g)) covered += 1;
  const novel = b.size - covered;
  return covered / b.size >= 0.6 && novel <= 4;   // ① 方向 + ② 新信息门槛
}

/* ★ 2026-10-03 「这两句是不是同一句」的总判据（纯函数，test:asr 逐条断言）。
 * ▎为什么要抽出来：这四条原本是 server 里一段内联布尔表达式，**谁都测不到它**，
 *   而它正是"字幕刷屏 / AI 重复接话"的总闸——坑 57 说过：
 *   凡是"某能力装了就该生效"的地方，都要有一条"它必须成立"的回归。
 * ▎注意这里**只比文本**："同不同一个人"不该由字符串判据关心——
 *   server 把锚点存在**成员对象**上（每人一条），跨人误吞在结构上就不可能发生。
 *   能用结构消除的判据，就不要靠每次记得检查（坑 47）。
 * ▎四条：① 归一化相等；② 新句是旧句子串（尾音碎片）；
 *   ③ 旧句是新句子串且新句只多 ≤6 字（差个标点/语气词）；④ 写法漂移的碎片。 */
function isDupOrFragment(prevNorm, norm) {
  const a = String(prevNorm || '');
  const b = String(norm || '');
  if (!a || !b) return false;
  return b === a
    || (a.length >= 2 && a.includes(b))
    || (b.includes(a) && b.length <= a.length + 6)
    || isFragmentOf(a, b);
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
  cleanTranscript,   // ★ 2026-10-02 静音幻觉清洗（纯函数，test:asr 逐条断言）
  isFragmentOf,      // ★ 2026-10-03 分段碎片的"同一句话"判据（方向性 bigram 覆盖）
  isDupOrFragment,   // ★ 2026-10-03 重复句总闸（四条判据合一，server 只调用不内联）
  bigramSet,
  measureWavLevel,   // ★ 2026-10-02 段能量闸（转写前先判断有没有出声）
  ASR_PROMPT,
  DEFAULT_MODEL,
  DEFAULT_SEGMENT_SEC,
  ASR_CONCURRENCY,
  WAKE_RE,
  PY_ENV,
};
