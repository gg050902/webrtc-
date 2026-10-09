'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
 *  scripts/bench-asr-multi.js —— 多人会议下"整句重转"到底要付多少钱（H5，2026-10-07 夜）
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎为什么要这台量具（不是"感觉一下"）：
 *   10-07 上线的**整句重转**把每一句定稿的音频再喂回模型一次。所有实测数字都是**单人**的
 *   （一句 6s 音频重转 0.5s）。而真实会议是 8 个人轮流说，`ASR_CONCURRENCY` 只有 2，
 *   worker 又是**单进程串行**的——这正是坑 89 的形状：
 *   "一次失控推理独占整个 worker，后面所有人排队"。
 *   ▸ 不量就不知道的那件事：重转是"多花 30%"还是"多花 300%"。
 *     前者可以留着，后者必须改成"只给要送给 AI 的那句做整句"（字幕用拼接、问答用整句）。
 *     而这个决定**不能拍**——它要拿数字来（路线图 0.6 的 H5 就是为 H1 前置的这条）。
 *
 * ▎测的是哪一段：真实的 qwen-local 常驻 worker（同一个进程、同一个 GPU、同一份模型），
 *   不走 WebRTC——因为要问的是"并发下的排队与耗时"，不是"音频进没进系统"
 *   （后者已由 test:asr-live / test:e2e-asr 覆盖）。省掉信令与 RTP 这一层，
 *   换来的是可以把并发数当成一个**可控自变量**扫一遍。
 *   ▸ 诚实边界：真实会议里还有 whisper 兜底与能量闸分流，这里只量主引擎的串行成本；
 *     数字是"这一路 worker 的账"，不是"整台服务器的账"。
 *
 * ▎为什么默认用**合成语音**而不是真人录音：这台量具要比的是"同一批音频、不同并发"的
 *   相对形状，绝对准确率不在它的量程内（那是 H3 的事，且等用户拍板）。
 *
 * 用法：
 *   npm run bench:asr-multi                     # 默认扫 1/2/4/8 路并发
 *   npm run bench:asr-multi -- --levels 1,4,8   # 指定并发档
 *   npm run bench:asr-multi -- --sentences 3    # 每路几句
 *   ASR_QWEN_LOCAL=0 时这台量具会明确拒绝跑（宁可红得清楚，不要测了一条根本没生效的路，坑 57）
 * 零依赖：只用 Node 内置 + 项目内模块。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
/* ★ 模型目录必须在 **require 之前**指过去（这条已经咬过两次，第二次是今晚的探针白等 90s）：
 *   `asr_qwen_local` 启动时若不认识 `QWEN_ASR_MODEL`，会去 HuggingFace 找模型名下载——
 *   本机没网/慢网时表现为"卡住"而不是"报错"。生产是在 sfu/server.js 里按项目根解析后
 *   设进环境变量的（`server.js:7399`），量具必须做同一件事，否则量的不是生产的那条路（坑 57）。
 *   ▸ 路径按**项目根**算，不是 `__dirname` 的上一级之外——历史上这里错过一次（找 sfu/models）。 */
/* ★ 2026-10-09 模型目录的判据搬进了 asr_qwen_local.resolveModelDir()（今天写
 *   bench:asr-golden 时才暴露：这段知识原来在 server.js 里，独立进程要复用就只能抄一份路径，
 *   而"抄的那一份"正是本项目反复踩的第二个来源。下面这行只是把同一个值显式落到 env 上，
 *   让本脚本后面几处读 process.env.QWEN_ASR_MODEL 的日志与判据继续成立。 */
const Qwen = require(path.join(ROOT, 'sfu', 'ai', 'asr_qwen_local.js'));
if (!process.env.QWEN_ASR_MODEL) process.env.QWEN_ASR_MODEL = Qwen.resolveModelDir();
const Fix = require(path.join(__dirname, 'voice-fixture.js'));

const argOf = (name, dft) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dft;
};
const LEVELS = String(argOf('--levels', '1,2,4,8')).split(',').map((x) => Math.max(1, parseInt(x, 10) || 1));
const PER = Math.max(1, parseInt(argOf('--sentences', '2'), 10));
const CONCURRENCY = Number(process.env.ASR_CONCURRENCY) || 2;   // 与生产同一个闸（不另写一份）

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => {
  if (!arr.length) return NaN;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '—');

/* 一条"句子长度分布贴近真实会议"的样本集：短应答 + 长请求混着。
 *   ▎为什么不能全用同一句：自回归模型的耗时 ∝ **输出 token 数**（坑 75 那次就是这么被骗的：
 *     拿 2 个字的基准宣布"快 9 倍"）。所以这里刻意用不同长度，并把每条的字数一起报出来。 */
const SENTENCES = [
  '小明，帮我记一下明天下午三点的评审会。',
  '今天天气真不错，拍卖啊。',
  '这个方案的延迟还是有点大，要再压测一轮看看服务器负载。',
  '把纪要生成一下。',
  '我这边网络有点卡，等一下再说，先把白板打开。',
];

async function makeWavs() {
  /* `makeSpeechWav` 的契约（读了实现才知道，不是猜的）：它接 **sentences 数组**、
     每次调用先 `rmSync(dir)` 再合成到 `dir/outName` ⇒ **一句一个目录**，
     否则会互相把对方的成品删掉（症状是"只剩最后一句"，很容易被误读成"合成失败"）。
     单句时用不上"句间静音"那条要求（那是给成句闸用的），所以把 gap/tail/minSil 收到最小。 */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-asr-multi-'));
  const out = [];
  for (let i = 0; i < SENTENCES.length; i++) {
    const dir = path.join(root, `s${i}`);
    try {
      const r = await Fix.makeSpeechWav({
        sentences: [SENTENCES[i]], dir, outName: 's.wav',
        gapSec: 1, tailSec: 1,
        /* 选项名是 `minSilenceSec`（不是 minSil）——写错不会报错，只会静默用默认 3s，
           于是"单句合成"全部被自检判成不合格（今晚就这么红了第一次）。
           单句基准不需要句间长静音，那条要求是给成句闸用的。 */
        minSilenceSec: 0.1,
      });
      if (r && fs.existsSync(r.file) && fs.statSync(r.file).size > 4000) {
        out.push({ file: r.file, text: SENTENCES[i], chars: SENTENCES[i].length, durSec: r.durSec });
      } else {
        console.log(`   ⚠️ 第 ${i + 1} 句产物太小，跳过（不拿静音当真样本，坑 75/105）`);
      }
    } catch (e) {
      console.log(`   ⚠️ 第 ${i + 1} 句合成失败（${String(e.message).slice(0, 44)}）——跳过`);
    }
  }
  return { dir: root, wavs: out };
}

/** 一路"成员"：像生产那样交替发**分段**与**整句**两种请求（比例≈每 3 段配 1 次整句）。
 * ▸ `Qwen.transcribe()` 的返回是**纯字符串**（空串 = 没转出来 / 超时 / worker 死了），
 *   不是对象——这一点是今晚第一次跑量具时被自己抓到的：写成 `r1 && r1.text` 会
 *   让**每一次**请求都记成"失败"，而耗时的数字看起来完全正常（坑 51 家族：
 *   断言读了一个不存在的字段，于是它永远为假、也永远不响）。
 * ▸ ★ 2026-10-07 H5b：`yieldOnBusy` 那一档复刻的是生产里的让路规则
 *   （worker 有别家在途 ⇒ 这一句不做整句，直接用拼接结果定稿）。
 *   在这里复刻而不是调用生产代码，是因为这条规则的**代价只在并发下才量得出来**，
 *   而生产的并发要真开 8 个浏览器；两边的计数器语义是同一个（先读后发）。
 *   ▸ 生产的顺序读错（await 之后才读）由 `test:asr` 的 H5b 组单独钉着，不归这台量具管。 */
let benchBusy = 0;      // 跨"成员"共享：与生产 asrEngineBusy 同语义（增减成对，走 finally）
/* ★ 2026-10-07 H1：`key` 必须一路带到 transcribe——worker 池**按成员稳定分片**，
 *   第一版没带，于是所有请求都落到 0 号槽（key 为空的兜底），2 号槽加载完模型站在
 *   显存里一件活也没干，测出来反而是"加 worker 让吞吐降了"。
 *   ▸ 那次误读值得记：它报的不是产品的账，是**量具没接通被测路径**的账（坑 76 同族）。 */
async function ask(wavFile, key) {
  benchBusy += 1;
  try { return await Qwen.transcribe(wavFile, { timeoutMs: 30000, key }); }
  finally { benchBusy -= 1; }
}
async function runOneLane(laneId, wavs, stopAt, opts) {
  const jobs = [];
  let n = 0;
  while (Date.now() < stopAt && n < opts.sentencesPerLane) {
    const w = wavs[n % wavs.length];
    n++;
    // ① 分段请求（2s 一段的真实粒度：取该句前 2 秒）
    const seg = await cutWav(w.file, 2.0, `${w.file}.seg${laneId}-${n}.wav`);
    const t0 = Date.now();
    const r1 = await ask(seg, 'lane-' + laneId);
    jobs.push({ kind: 'seg', ms: Date.now() - t0, chars: w.chars, ok: !!String(r1 || '').trim() });
    fs.unlink(seg, () => {});
    // ② 整句重转（三个自变量：不发 / 无条件发 / 忙时让路）
    if (opts.refine) {
      if (opts.yieldOnBusy && benchBusy > 0) { jobs.push({ kind: 'yielded', ms: 0, chars: w.chars, ok: true }); continue; }
      const t1 = Date.now();
      const r2 = await ask(w.file, 'lane-' + laneId);
      jobs.push({ kind: 'refine', ms: Date.now() - t1, chars: w.chars, ok: !!String(r2 || '').trim() });
    }
  }
  return jobs;
}

/* 用 ffmpeg 切出前 N 秒（保持与生产同样的 16k 单声道 s16 形状）。 */
const { execFile } = require('child_process');
function cutWav(src, sec, dst) {
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', src,
      '-t', String(sec), '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', dst],
    () => resolve(dst));   // 切失败也返回路径：transcribe 会拿到空/错，计成 ok:false（不假装成功）
  });
}

async function benchLevel(concurrency, wavs, opts) {
  const stopAt = Date.now() + 600000;      // 由每路的句数自然收尾
  const t0 = Date.now();
  const lanes = [];
  for (let i = 0; i < concurrency; i++) lanes.push(runOneLane(i, wavs, stopAt, opts));
  const all = (await Promise.all(lanes)).flat();
  const wall = Date.now() - t0;
  const seg = all.filter((j) => j.kind === 'seg').map((j) => j.ms);
  const ref = all.filter((j) => j.kind === 'refine').map((j) => j.ms);
  /* 吞吐只数**真发出去过的请求**（seg + refine）。把"让路"也算成一次完成，
     会让 H5b 那一档看起来吞吐暴涨——而那恰恰是它什么推理都没做的假象（坑 65 的同一条：
     "0/满"这种数要先证明它背后真有工作发生）。 */
  const done = seg.length + ref.length;
  const yielded = all.filter((j) => j.kind === 'yielded').length;
  return {
    concurrency, wall, all, done, yielded,
    seg: { n: seg.length, p50: pct(seg, 0.5), p95: pct(seg, 0.95), max: Math.max(...seg, 0) },
    ref: ref.length ? { n: ref.length, p50: pct(ref, 0.5), p95: pct(ref, 0.95), max: Math.max(...ref, 0) } : null,
    throughput: done / (wall / 1000),
    failed: all.filter((j) => !j.ok).length,
  };
}

(async () => {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║ H5 多人并发下"整句重转"的成本基准          ║');
  console.log('╚══════════════════════════════════════════╝');

  /* 前提检查：**不测一条根本没生效的路**（坑 57/76）。
     qwen-local 没起来时生产会退回 whisper，那时量出来的数字与"重转的代价"无关。 */
  if (process.env.ASR_QWEN_LOCAL === '0') {
    console.log('❌ ASR_QWEN_LOCAL=0 —— 主引擎被关着，这台量具要测的那条路根本没跑。宁可红得清楚。');
    process.exit(1);
  }
  console.log('① 预热 qwen-local worker（模型加载 + 一次空推理，坑 73 那套）…');
  /* ★ 2026-10-07 H1：这台量具必须**把池配好再预热**，否则它一直量的都是单 worker，
   *   而命令行上明明写了 ASR_QWEN_WORKERS=2 —— 第一版就这么错过一次：
   *   日志里"并发闸=2"读起来像生效了，其实那是 whisper 的 ASR_CONCURRENCY，两件事不同名也不同物。
   *   ▸ 所以这里既配、也**把实际槽数打出来**（配了不等于建了，坑 76）。 */
  const wantWorkers = Number(process.env.ASR_QWEN_WORKERS) || 1;
  Qwen.configure({ workers: wantWorkers });
  const w = await Qwen.warm();
  if (!Qwen.alive) {
    console.log(`❌ worker 没起来（lastError=${Qwen.lastError || '无'}，QWEN_ASR_MODEL=${process.env.QWEN_ASR_MODEL || '(未设置)'}）——量不了。`);
    console.log('   ▸ 没设置模型目录 ⇒ 它会去网上找模型（表现为"卡住"而不是报错）；宁可红得清楚（坑 57/76）。');
    process.exit(1);
  }
  console.log(`   ✅ worker 就绪：池 = ${Qwen.workerCount} 槽（活着 ${Qwen.aliveCount}），设备=${Qwen.device}`
    + `；whisper 侧 ASR_CONCURRENCY=${CONCURRENCY}（**与池是两回事**，别混读）`);
  if (Qwen.workerCount !== wantWorkers) {
    console.log(`❌ 配了 ${wantWorkers} 个 worker，实际建了 ${Qwen.workerCount} 个 —— 结论会假，先停。`);
    process.exit(1);
  }
  /* ▎一个必须先查清的事实（查法：读 asr.js/asr_qwen_local.js 两个 transcribe 的函数体）：
       `ASR_CONCURRENCY` 那个信号量**只包着 whisper CLI**（`Asr.transcribeFile`），
       而 qwen-local 的 `Qwen.transcribe` 直接写 worker 的 stdin —— 它不排队，
       排队发生在 **Python 那一个进程的串行推理**上。
     ▸ 所以本量具直接按 N 路并发压 worker，**就是生产的样子**（不是绕开闸门）；
       而 `ASR_CONCURRENCY` 在这里只是"给报告一个参照数字"，别误读成"生产有 N 路并行"。 */

  console.log('② 合成句子…');
  const { dir, wavs } = await makeWavs();
  if (!wavs.length) { console.log('❌ 一句都没合成出来（System.Speech 不可用？）——没有样本就不许下结论（坑 105）'); process.exit(1); }
  console.log(`   ✅ ${wavs.length} 句，字数 ${wavs.map((x) => x.chars).join('/')}`);

  const results = [];
  /* 三个自变量：只分段（基线）→ 每句都重转（H5 量出的问题）→ 忙时让路（H5b 的处方）。
     少了第三档，这台量具只会报告"有个问题"而不会验证"处方真的把问题按回去了"。 */
  const MODES = [
    { key: 'no-refine', refine: false, yieldOnBusy: false, label: '只分段（基线）' },
    { key: 'refine', refine: true, yieldOnBusy: false, label: '每句都整句重转（H5 测出的那一档）' },
    { key: 'refine-yield', refine: true, yieldOnBusy: true, label: '整句重转 + 忙时让路（★ H5b 的处方）' },
  ];
  for (const m of MODES) {
    console.log(`\n=== ${m.label} ===`);
    for (const lv of LEVELS) {
      const r = await benchLevel(lv, wavs, { refine: m.refine, yieldOnBusy: m.yieldOnBusy, sentencesPerLane: PER });
      results.push({ mode: m.key, ...r });
      /* ★ 单位：`p50/p95/max` 存的是**毫秒**，打印时必须除回去。
         今晚第一次跑这份报告输出的是「分段 p50 527.0s」——数字对、单位错 1000 倍，
         而这类错不会让任何东西变红，只会让人按错了预算（坑 111 同一族的第二次应验，
         这次栽在我自己刚写的量具上）。 */
      const s = (ms) => fmt(ms / 1000, 2);
      const refTxt = r.ref ? `｜重转 n=${r.ref.n} p50 ${s(r.ref.p50)}s p95 ${s(r.ref.p95)}s 最慢 ${s(r.ref.max)}s` : '';
      console.log(`  ${lv} 路并发：总耗时 ${fmt(r.wall / 1000)}s · 完成 ${r.all.length} 次`
        + `（吞吐 ${fmt(r.throughput, 2)} 次/秒）· 分段 p50 ${s(r.seg.p50)}s p95 ${s(r.seg.p95)}s 最慢 ${s(r.seg.max)}s${refTxt}`
        + (r.failed ? ` · ⚠️ 空结果 ${r.failed} 次` : ''));
    }
  }

  /* 结论：**别看总耗时**。开了重转之后请求条数本身就翻倍，总耗时当然涨——
   *   拿它算比值会把"多做了一倍工"读成"慢了一倍"（坑 75：基准的样本要先问"它量的是不是我以为的那个量"）。
   *   用户能感觉到的是**同一批分段请求排到多久**（= 字幕延迟）与**这台 worker 一秒能吃下几次**（= 还剩多少余量），
   *   所以判据用这两个：
   *     · `segP95` —— 分段请求的 p95（含排队），这是"说完→这段转出来"的实际等待；
   *     · `throughput` —— 次/秒，掉得越多说明重转吃掉的余量越大。
   *   红线（写在明面上，可调）：4 路（半间房的人同时说话）时 `segP95 ≤ 2.5s`
   *   且吞吐不低过基线的 80% —— 越线就该把重转收窄成"只给要送给 AI 的那句做"。 */
  console.log('\n=== 结论（判据 = 分段请求的排队延迟 与 吞吐，不是总耗时）===');
  /* 两组判据，分工要写清（第一版我只设了绝对线，结果把"处方成功回到基线"报成了失败）：
     · **相对线**（处方合不合格）：与"只分段"的基线比 —— 分段 p95 ≤ ×1.15、吞吐 ≥ 90%。
       重转的代价定义就是"比不重转慢多少"，所以它只能跟基线比，不能跟一个凭空定的毫秒数比。
     · **绝对容量线**（房间容量，不是重转的账）：分段 p95 ≤ BENCH_ABS_P95_MAX_MS。
       越线要说清"基线自己也越了" ⇒ 那是这台单进程 worker 的容量问题（归 H1/多 worker），
       **不该记在整句重转头上**——把它混进处方判词，会诱使下一个读到报告的人去关掉一个已经修好的东西。 */
  const REL_P95 = Number(process.env.BENCH_REFINE_P95_RATIO) || 1.15;
  const REL_TP = Number(process.env.BENCH_REFINE_THROUGHPUT_KEEP) || 0.9;
  const ABS_P95 = Number(process.env.BENCH_ABS_P95_MAX_MS) || 2500;
  let verdict = 'ok';
  for (const lv of LEVELS) {
    const a = results.find((x) => x.mode === 'no-refine' && x.concurrency === lv);
    const b = results.find((x) => x.mode === 'refine' && x.concurrency === lv);
    const c = results.find((x) => x.mode === 'refine-yield' && x.concurrency === lv);
    if (!a || !b || !c) continue;
    const line = (tag, r) => `${tag} 分段 p95 ${(r.seg.p95 / 1000).toFixed(2)}s`
      + `（×${fmt(r.seg.p95 / a.seg.p95, 2)}）· 吞吐 ${fmt(r.throughput, 2)}（保住 ${fmt(r.throughput / a.throughput * 100, 0)}%）`
      + ` · 重转 ${r.ref ? r.ref.n : 0} 次` + (tag.indexOf('让路') >= 0 ? ` · 让路 ${r.yielded} 次` : '');
    const pass = (r) => r.seg.p95 <= a.seg.p95 * REL_P95 && r.throughput >= a.throughput * REL_TP;
    const overAbs = (r) => r.seg.p95 > ABS_P95;
    /* ★ 判词只看**处方那一档**（让路）。"每句做"越线是**问题本身**，是这台量具要证明的前提，
       不是它要判失败的对象的——把它混进 verdict 会让一份"处方有效"的报告通体报成失败，
       而下一个读报告的人就会去关一个已经修好的东西（第一版真的就这么错过一次）。 */
    if (!pass(c)) verdict = 'slow';
    console.log(`  【${lv} 路】`);
    console.log(`     ${line('基线  ', a)}${overAbs(a) ? '（注意：基线自己已超绝对容量线' + ABS_P95 + 'ms ⇒ 属 worker 容量，不是重转的账）' : ''}`);
    console.log(`     ${line('每句做', b)} ${pass(b) ? '✅ 与基线相当' : '❌ 重转确实拖慢了分段'}`);
    console.log(`     ${line('让路  ', c)} ${pass(c) ? '✅ 处方成立：回到基线水平' : '❌ 让路之后仍拖慢'}`);
    /* ★ 让路档必须**确实做过至少一次重转**才算处方成立：若它在所有档都让光，
       "延迟回到基线"其实是"功能整个不跑了"——那正是 H5b 担心的"一直让路 vs 做了没采用"
       那对分不开的病（坑 76）。单人档是这条的反例守卫：那时 worker 不该忙，一次都不许让。 */
    if (lv === 1 && c.yielded > 0) {
      verdict = 'slow';
      console.log('     ❌ 单人档出现了让路 —— 判据在"没有别家在途"时也拦，等于把重转关掉了');
    }
    if (lv > 1 && c.ref && c.ref.n >= c.yielded && c.yielded > 0) {
      verdict = 'slow';
      console.log('     ❌ 多人档几乎没让路（重转做的比让的多）—— 判据没在并发下生效，代价还在');
    }
  }
  console.log(`\n判词（只看处方那一档 = 让路；"每句做"那一档越线是**问题存在的证据**，不是失败）：`);
  console.log(verdict === 'ok'
    ? `  ✅ 整句重转在"忙时让路"下各档都回到基线水平（分段 p95 ≤×${REL_P95}、吞吐 ≥ 基线 ${REL_TP * 100}%），`
      + '且单人档一次都没让路（= 让路没有顺手把功能关掉）。'
    : `  ❌ 有档不合格（相对基线：分段 p95 >×${REL_P95} 或吞吐 <${REL_TP * 100}%，或让路/不让路的分布不对）——看上面 ❌`);
  console.log('  ▸ 如实记：本量具只量主 worker 的串行账，不含 whisper 兜底、能量闸分流与房间级并发结构；'
    + '合成语音 ≠ 真人嗓音，绝对准确率不在它的量程内（那是 H3）。');

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 临时目录清不掉不致命 */ }
  Qwen.kill();
  process.exit(0);
})().catch((e) => { console.error('❌ 基准异常：', e && e.message); try { Qwen.kill(); } catch (_) { /* 已经死了 */ } process.exit(1); });
