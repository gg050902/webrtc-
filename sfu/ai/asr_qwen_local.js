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

/* ★ 2026-10-05 单次推理预算：120s → **12s**（实测依据，不是拍脑袋）。
 *   ▎为什么要改：e2e 真浏览器连跑里量到**单次推理 93.5s**（run-18）/ 36.4s（run-16），
 *   而同期 p50 只有 **0.5~0.6s**——同一个 worker、同一段 2s 音频，差 150 倍。
 *   自回归模型偶发"停不下来"（重复生成到 max_new_tokens 上界）时，120s 的预算等于
 *   **允许这个人的字幕静默两分钟才发现**，而且后面每一段都排在这次跑不完的推理后面
 *   （实测紧随其后的那段"排队 83.7s"）。用户报的"语音识别一段时间就停了"就是这条。
 *   ▸ 为什么 12s 而不是 3s：p50 0.5s、真句稳态 1.0~1.2s（10-04d GPU 实测），
 *     留 10 倍余量给冷机/其他进程抢显存的真实抖动——**误杀一段只是慢一点，
 *     漏放一次则全场静默两分钟**，两边代价不对称，预算该偏宽但不能宽到没意义。
 *   ▸ 超时之后不是"丢掉这段就完事"：见 transcribe() 里的 abandonStuckWorker——
 *     调用方（sfu/server.js:2716）在拿到空串时会回落 whisper 常驻 worker，
 *     **这段语音不会丢**；而 worker 本身必须重启，否则它还在生成，下一段照样排死。 */
const WAIT_MS = Number(process.env.ASR_TIMEOUT_MS) || 12000;

/* ★ 2026-10-07 H1：**一个常驻 worker 就是一个串行队列**——多人会议下这是容量天花板。
 *   `bench:asr-multi` 实测（同一台 RTX 4060 Laptop / 8GB）：
 *     单进程 4 路        p95 1.36s · 2.92 次/秒
 *     **两个独立进程**各跑 4 路  p95 1.84s · 各 2.4 次/秒（合计 4.78，**1.64×**）· GPU 利用率只 33%
 *     两个独立进程各跑 8 路  各 2.64 次/秒（合计 5.27）· 而 p95 仍是 ~3.0s，
 *       与"一个进程跑 8 路"的 p95 2.80~3.04s **同一档** ⇒ 同延迟下容量近似翻倍。
 *   ▸ 所以瓶颈是**单 Python 进程的 GIL + 串行推理循环**，不是显卡本身。
 *   ▸ 显存实测：一个 worker ≈ **1.9GB**（两个同时跑时 nvidia-smi 读到 5.0GB 总占用）
 *     ⇒ 8GB 卡上"2 个 ASR + 浏览器 + whisper 兜底"是紧的，
 *     所以**默认仍是 1**（今天的行为一字不变），要多人会议扩容由 `configure({workers})` 显式打开。
 *   ▸ 下面把原来的单例**整体包进 makeSlot()**：一个槽位 = 原来那套完整逻辑
 *     （有界预算 / 超时重启 / 重启冷却 / 连崩判死 / 慢复活），一字未改——
 *     这些细节是一条条事故换来的，池化不该顺手重写它们。
 *     而且 `test:asr` ③.7 那组断言是拿源码正则判的（`stallRestart`、`ABANDON_COOLDOWN_MS`、
 *     `abandonStuckWorker` 体内不许出现 `state.dead =`…），整段保留 = 它们继续有牙。 */
/* ▸ resolveModelDir() 在 makeSlot() **外面**（★ 10-09 放置位置很要紧）：它不读槽位状态，
 *   而池级 module.exports 也要导出它——写在工厂函数里面，工厂外的引用就是
 *   `ReferenceError: resolveModelDir is not defined`。这个形状今天真踩了一次：
 *   `node --check` 过得干干净净（语法没错），错的是**作用域**。 */
function resolveModelDir() {
  if (process.env.QWEN_ASR_MODEL) return process.env.QWEN_ASR_MODEL;   // 明示覆盖永远优先
  try {
    const fs = require('fs');
    const path = require('path');
    // 本文件在 sfu/ai/ 下 → 上跳两级才是项目根（10-02d 那条教训就是"少跳一级"）
    const dir = path.join(__dirname, '..', '..', 'models', 'qwen3-asr-0.6b');
    return fs.existsSync(dir) ? dir : '';
  } catch (e) { return ''; }
}

function makeSlot() {
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
    if (msg.ready) { state.ready = true; state.crashStreak = 0; state.device = String(msg.device || 'cpu'); continue; }
    if (msg.fatal) { state.lastError = msg.fatal; failPending('fatal'); continue; }
    const p = state.pending.get(msg.id);
    if (!p) continue;
    state.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ms != null) state.lastModelMs = Number(msg.ms) || 0;  // ★ 2026-10-03d 模型纯推理耗时（归因排队 vs 模型）
    p.resolve(String(msg.text || '').replace(/\s+/g, ' ').trim());
  }
}

/* ▸ 模型目录的判据在 makeSlot() 之前那份（resolveModelDir），这里只调它——
 *   槽位与池共用同一个来源，别再在 spawn 的 env 里拼第二条路径。 */
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
      QWEN_ASR_MODEL: String(resolveModelDir() || 'Qwen/Qwen3-ASR-0.6B'),
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
    /* ★ 2026-10-05：**自己主动重启（因推理卡死而 kill）不算崩溃**。
     *   下面这条 crashStreak 到 3 就把引擎**永久判死**（state.dead=true，之后不再拉起）。
     *   如果不区分，"卡死→重启"这条自愈路径反而会把引擎送进死亡名单——
     *   为了治"停两分钟"而制造出"永久停"，那就修坏了（坑 66 家族：降级/清理动作比它看起来更广泛）。
     *   crashStreak 仍由下一条 ready 归零（L39），所以真崩三次照样判死。 */
    if (!state.dead && !state.stallRestart) {
      state.crashStreak += 1;
      if (state.crashStreak >= 3) { state.dead = true; state.deadAt = Date.now(); }
    }
    state.stallRestart = false;
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
  /* ★ 2026-10-04h 慢复活：连崩 3 次后的"永久放弃"改为 5 分钟冷却后允许再试一轮
   *   ——机器慢/显存紧张的坏窗口会连崩（import 47s 时 spawn 也可能超时类失败），
   *   冷却让主引擎在下一个好窗口自己回来，而不是死到重启为止。 */
  if (state.dead && state.deadAt && Date.now() - state.deadAt > 300000) {
    state.dead = false;
    state.crashStreak = 0;
    state.lastError = 'revived-after-cooldown';
  }
  if (state.dead) return false;
  if (state.child && state.ready) return true;
  if (!state.py) {
    state.py = await pythonNameForWorker();
    if (!state.py) { state.dead = true; state.lastError = 'no-python-with-qwen_asr'; return false; }
    state.usePython3 = state.py === 'python3';
  }
  start();
  const t0 = Date.now();
  while (!state.ready && Date.now() - t0 < 300000) { // 本地大模型加载可能要几分钟（★ 2026-10-04h 180s→300s：慢机器 import 47s×2 + GPU 加载实测逼近 3 分钟）
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
  const budget = opts.timeoutMs || WAIT_MS;
  return await new Promise((resolve) => {
    const timer = setTimeout(() => {
      state.pending.delete(id);
      resolve('');
      /* ★ 2026-10-05 超时**不只是"放弃这一问"**，还要把卡住的 worker 换掉——
       *   否则它仍在自回归生成，下一个请求照样排在它后面（run-18 实测排队 83.7s）。
       *   顺序要紧：先 resolve 再重启，别让我们的清理动作挂在调用方的回程上。 */
      abandonStuckWorker(budget);
    }, budget);
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

/* ★ 2026-10-05 推理卡死的处置：**换掉 worker，而不是只丢掉这一段**。
 * ▎为什么必须重启：Node 侧超时只是"我不等了"，Python 那一侧仍在生成——
 *   它是**单进程串行**的，下一段音频进来照样要排在这次跑不完的推理后面。
 *   实测一次 93.5s 的失控推理，把紧随的那一段顶到"排队 83.7s"，
 *   用户看到的就是"说了半天没字幕 / AI 不接话"——**一段时间就停了**的真身。
 * ▎为什么不会丢字：本段与排队中的段都拿空串返回，调用方 sfu/server.js:2716
 *   见空即回落 whisper 常驻 worker（10-05 夜跑的"兜底先预热"正好在这里接住）。
 * ▎为什么带冷却：重启=重新加载模型（GPU 上 ~10~20s），连续重启会互相踩；
 *   冷却期内再次超时只丢段不重启，交给 whisper——**宁可慢，不要抖**。
 * ▎不要用 kill()：那个函数会置 state.dead=true（永久判死），这里要的是"换一个人接着干"。 */
let lastAbandonAt = 0;
const ABANDON_COOLDOWN_MS = 20000;
function abandonStuckWorker(budgetMs) {
  const now = Date.now();
  const sec = Math.round((budgetMs || WAIT_MS) / 1000);
  if (state.dead || !state.child) return;
  if (now - lastAbandonAt < ABANDON_COOLDOWN_MS) {
    console.log(`⏱ [ASR/qwen-local] 又一次推理超 ${sec}s 没回，但 ${Math.round(ABANDON_COOLDOWN_MS / 1000)}s 内刚重启过`
      + ' —— 这次只丢本段走 whisper 兜底，不再重启（防重启风暴）');
    return;
  }
  lastAbandonAt = now;
  state.restarts = (state.restarts || 0) + 1;   // ★ 可观测：/metrics 与 watch 靠它回答"到底卡死过没有"
  console.log(`⏱ [ASR/qwen-local] 单次推理超过 ${sec}s 没回 → 判定卡在自回归生成里，重启 worker`
    + '（本段回落 whisper；不重启则后面每一段都排在这次推理后面）');
  state.stallRestart = true;   // 让 exit 分支别把它算进"连崩三次"（否则自愈反而把引擎判死）
  state.ready = false;
  failPending('stall-restart');  // 排队中的请求立刻拿空串 → 各自回落 whisper，不再干等
  const dying = state.child;
  try { if (dying) { dying.stdin.end(); dying.kill(); } } catch (e) { /* 已经退了 */ }
  state.child = null;
  /* 后台重新拉起。这期间 qwenLocalUsable() 为 false，调用方自动走 whisper——
   * 界面/账本都不会停，恢复本地引擎只是"变快"而不是"变能用"。 */
  boot().then((ok) => console.log(ok
    ? '✅ [ASR/qwen-local] worker 已重启并就绪（本地引擎恢复）'
    : '⚠️ [ASR/qwen-local] worker 重启失败，本场改走 whisper 兜底')).catch(() => { /* boot 内部已记错 */ });
}

function kill() {
  state.dead = true;
  failPending('killed');
  try { if (state.child) { state.child.stdin.end(); state.child.kill(); } } catch (e) { /* 忽略 */ }
  state.child = null;
}

/* 非阻塞预热：触发 worker 加载但不等待（服务器开机用；未就绪时调用方走 whisper 兜底）。
 * ★ 2026-10-02 返回 boot() 的结果——原来恒返回 undefined，调用方 .then() 里无条件打
 *   "🔥 已预热"，于是**探测失败也报成功**（假绿）。现在由调用方按返回值说实话。
 * ★ 2026-10-03b warm = boot + **一次真实推理**：真浏览器 e2e 实测，只加载模型的预热
 *   让第一句字幕付了 11.1s（第二句 9.0s，稳态才 ~2s）——模型加载完 ≠ 推理图就绪，
 *   第一次 forward 还要付初始化的钱。whisper 侧的 prewarmAsrWorker 早就有这一步，
 *   这里补齐同款：0.3s 低幅噪声 wav（非纯静音，逼模型真跑一遍解码）转写一次后删掉。 */
async function warm() {
  try {
    const okBoot = await boot();
    if (!okBoot) return false;
    try {
      const os = require('os');
      const fs = require('fs');
      const path = require('path');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-asr-warm-'));
      const wav = path.join(dir, 'warm.wav');
      const sampleRate = 16000, samples = Math.floor(sampleRate * 0.3);
      const dataBytes = samples * 2;
      const buf = Buffer.alloc(44 + dataBytes);
      buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataBytes, 4); buf.write('WAVE', 8);
      buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
      buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28);
      buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
      buf.write('data', 36); buf.writeUInt32LE(dataBytes, 40);
      for (let i = 0; i < samples; i++) buf.writeInt16LE((i % 17) - 8, 44 + i * 2); // 低幅噪声
      fs.writeFileSync(wav, buf);
      await transcribe(wav, { timeoutMs: 90000 });
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) { /* 首推理预热失败不影响引擎可用性（fail-open：最多冷一点） */ }
    return true;
  } catch (e) { return false; }
}

  return {
    transcribe,
    boot,
    kill,
    get alive() { return !state.dead && !!state.child && state.ready; },
    get dead() { return state.dead; },
    get lastError() { return state.lastError; },
    get device() { return state.device || 'cpu'; },   // ★ 2026-10-03d GPU/CPU 说实话（启动日志用）
    get lastModelMs() { return state.lastModelMs || 0; }, // ★ worker 自报的纯推理耗时（排队归因用）
    get restarts() { return state.restarts || 0; },
    get inFlight() { return state.pending.size; },
    /* ★ 2026-10-05 重启计数器对外可见。
     *   ▎为什么这条重要：坑 89 的修法（预算 12s + 超时重启）**至今没有被真实触发过**——
     *     按坑 76 的纪律，"没有触发证据"就不能写"已修好"。与其等一次运气，
     *     不如把它变成**可观测事实**：/metrics 有这条 gauge、watch 会在它 >0 时报警，
     *     于是"用户真实会议里到底有没有卡死过"从此是查得到的，而不是猜的。 */
  };
}

/* ══ worker 池（★ H1）════════════════════════════════════════════════
 * ▎路由判据：**按成员稳定分片**，不是轮询。
 *   为什么稳定比均衡重要：同一个说话人的段必须**按顺序**回到同一句话的文本流里
 *   （句内归并 mergeTranscript、尾巴段判据、整句重转的音频账本都假设"这一段属于这个人"）。
 *   轮询会让一个人的第 2 段排在另一个 worker 上，比第 1 段先回来 ⇒ 顺序错乱，
 *   那类缺陷的症状是"字幕半句颠三倒四"，而且不会报错（坑 58/76 同族：并发要覆盖 ≥2 实体）。
 * ▎槽位死了怎么办：退到**任意活着的槽**（宁可慢，别没人转）；全都死了返回空串，
 *   由调用方（sfu/server.js）回落 whisper 常驻 worker——这段语音不会丢，那是 10-05 立的规矩。 */
const MAX_SLOTS = 4;                       // 显存账：一个 ≈1.9GB，8GB 卡最多两个还有余量
/** 一个 worker 的显存占用（MiB）。★ 本机 RTX 4060 Laptop 8GB 实测：加载完一个 ≈1.9GB，
 *   两个同时驻留时 nvidia-smi 读到 5.0GB 总占用（含 whisper 兜底与浏览器解码的那点余量）。
 *   写成常量而不是"现场量"：doctor 拿它做**预算体检**，判据要能被一眼核对。 */
const VRAM_PER_WORKER_MIB = 1900;
let wantWorkers = 1;                       // configure() 之前 = 今天的行为（单 worker）
const slots = [];

/** 「到底该开几个 worker」的**唯一**判据：env `ASR_QWEN_WORKERS` > `config.asrQwenWorkers` > 1，
 *  并钳在 1..MAX_SLOTS。
 *  ▸ 为什么这是一个导出的纯函数而不是两行内联：服务器与 `npm run doctor` 都要读它
 *    （体检报"你配了 4 个但显存只够 2 个"必须用**同一把尺**，否则界面说的和系统做的不是一回事，坑 47）。
 *  ▸ `envRaw` 用 `undefined`/空串区分"没传"——坑 54 那一族：`Number(env) || 默认` 会让 0 永久失效
 *    （这里 0 会被钳成 1，但至少"传了 0"与"没传"是可分辨的，日志能说清是谁定的档）。 */
function resolveWorkers(envRaw, cfgRaw) {
  const clamp = (n) => Math.max(1, Math.min(MAX_SLOTS, Math.round(n) || 1));
  const fromEnv = Number(envRaw);
  if (envRaw !== undefined && envRaw !== '' && Number.isFinite(fromEnv)) return clamp(fromEnv);
  const fromCfg = Number(cfgRaw);
  if (Number.isFinite(fromCfg)) return clamp(fromCfg);
  return 1;
}

function configure(o = {}) {
  if (slots.length) return;                // 已经在跑了就不改（不热插拔，免得半路换分片把顺序打乱）
  wantWorkers = resolveWorkers(o.workers);
}

function ensureSlots() {
  while (slots.length < wantWorkers) slots.push(makeSlot());
  return slots;
}
function slotIndexForKey(key) {
  const n = slots.length || wantWorkers;
  if (n <= 1) return 0;
  const s = String(key == null ? '' : key);
  if (!s) return 0;
  /* FNV-1a（标准做法：异或 + 大质数乘法，对短串的扩散比 `h = h*31 + code` 更均匀）。
   *   ▸ 这里要顺手记一条**我自己写错的"实测"**：第一次写这段时我看到"6 个 id 里 5 个落到
   *     同一个槽"，就把注释写成"实测旧哈希分片不均"。可那 6 个 id 是**我随手编的**
   *     （AAA1/AAA2/BBB3…）；换成 64 个真实形状（socket.io 那种随机 base64url 短串）再量：
   *     旧写法 36/28、FNV 28/36 —— **两种都均衡，5/6 只是 n=6 的正常波动**。
   *     换 FNV 仍然换（更标准的扩散没有坏处），但**理由不能是我没测出来的那条"缺陷"**。
   *     ▎判据：写"实测"两个字之前先问样本量是多少、样本是不是我编的；
   *       小样本上的偏斜不是结论（坑 53/105 同族：没有分母的数不许当证据）。 */
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h % n;
}
function pickSlot(key) {
  const list = ensureSlots();
  const first = list[slotIndexForKey(key)] || list[0];
  if (first && !first.dead) return first;
  /* 属于这个人的槽被判死了：先试别的槽，而不是直接放弃本地引擎。
     （不这么做会造出一种很难查的形态：一个人因为一次卡死被"绑定"在死槽上，
       他的字幕从此永远走兜底，而同房间其他人一切正常。） */
  const alt = list.find((s) => !s.dead);
  return alt || first;
}

async function transcribe(wavFile, opts = {}) {
  const slot = pickSlot(opts.key);
  if (!slot) return '';
  const text = await slot.transcribe(wavFile, opts);
  /* 归因用的"模型纯推理耗时"读**这一次真正服务了我的那个槽**：
     模块级单值会让 8 路并发下把别人的模型耗时记到我头上（原来单 worker 时不存在这个问题，
     池化之后就出现了——所以这不是"沿用旧写法"，是必须跟着改的那一类，坑 56 的并发版）。 */
  lastServedModelMs = slot.lastModelMs;
  return text;
}
let lastServedModelMs = 0;

async function warm() {
  const list = ensureSlots();
  const rs = await Promise.all(list.map((s) => s.warm ? s.warm() : s.boot()));
  return rs.some(Boolean);
}
function kill() { for (const s of slots) { try { s.kill(); } catch (e) { /* 已经退了 */ } } }

module.exports = {
  transcribe,
  warm,
  resolveModelDir,   // ★ 2026-10-09 模型目录的唯一判据（server 的启动绑定与 bench:asr-golden 都调它）
  kill,
  configure,                       // ★ server 读完 config 之后、预热之前调一次
  resolveWorkers,                  // ★ 「配了几个」的唯一判据（server 与 doctor 共用）
  MAX_SLOTS,
  VRAM_PER_WORKER_MIB,             // ★ doctor 的显存预算体检用它算
  get workerCount() { return slots.length || wantWorkers; },
  get aliveCount() { return slots.filter((s) => s.alive).length; },
  get alive() { return slots.some((s) => s.alive); },
  get lastError() { return (slots.find((s) => s.lastError) || {}).lastError || null; },
  get device() { return (slots.find((s) => s.alive) || slots[0] || {}).device || 'cpu'; },
  get lastModelMs() { return lastServedModelMs; },
  get restarts() { return slots.reduce((n, s) => n + (s.restarts || 0), 0); },
  get inFlight() { return slots.reduce((n, s) => n + (s.inFlight || 0), 0); },
  /* 诊断用：每个槽一行简述（进 /api/rooms 与 doctor），
     "为什么这个人的字幕慢"要能一眼看出是不是某个槽死了/在冷却。 */
  get slotStats() {
    return slots.map((s, i) => ({
      idx: i, alive: s.alive, dead: s.dead, device: s.device,
      restarts: s.restarts, inFlight: s.inFlight, lastError: s.lastError || null,
    }));
  },
};
