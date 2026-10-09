#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 *  review-meeting.js —— 拿**真实开过的会**的账本，回答"这套语音到底能不能用"
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎为什么要这么一条命令（2026-10-06，用户原话："全部解决完完善目前所有功能并测试真实可用性"）：
 *   这个项目有一百多条回归，全部跑在**合成语音 + 受控节奏**上。它们能证明"代码没写错"，
 *   证明不了"真人开会时它好用"——而这两件事在本项目里已经**两次给出相反的答案**：
 *   10-03 那天受控自测说定稿 1.4s，用户真实会议的账本量出来是中位 3.9s / p90 7.3s；
 *   10-05 又是受控全绿，而真实房间里那个人的语音峰值只有 -56~-65 dBFS，被能量闸当静音删了。
 *   ▸ 所以：权威证据源不是我的测试输出，是 `sfu/captions/*.jsonl`（字幕账本）
 *     与 `sfu/logs/app-*.jsonl`（结构化事件）。这条命令就是把这两份账本读成人话。
 * ▎判据全部**复用生产代码里的同一个函数**（`sfu/ai/asr.js` 的 noiseRiffReason / isDupOrFragment）：
 *   复盘脚本自己再写一份"什么算噪声、什么算重复"，就会和线上判断漂移——
 *   那时候报告说的和系统做的不是一回事，这种报告比没有更坏（坑 47）。
 * ▎最重要的一条纪律：**每条结论都必须带样本量，样本不够就明说"不足以下结论"**。
 *   一份只有两条字幕的会议算出来的"中位延迟"没有任何意义，
 *   而它长得和意义齐全的数字一模一样（坑 53）。
 * ▸ 跑法：
 *     npm run review:meeting                 最近两天所有有转写的房间
 *     npm run review:meeting -- --room 603646 只看某一场
 *     npm run review:meeting -- --days 7 --top 8
 *     npm run review:meeting -- --json       机器可读（喂给别的工具）
 *     npm run test:review                    自检：拿合成账本验"这台量具准不准"
 */
const fs = require('fs');
const path = require('path');
const Asr = require('../sfu/ai/asr.js');
const RoomActions = require('../sfu/ai/roomActions.js');   // ★ 指令回扫复用生产那两个判据（坑 47）
const { looksLikeFixtureCaption, fixtureRoomCoverage } = require('./voice-fixture.js');   // ★ 自测场 vs 真人场：句子只有一份（坑 47）

const ROOT = path.join(__dirname, '..');
const CAP_DIR = path.join(ROOT, 'sfu', 'captions');
const LOG_DIR = path.join(ROOT, 'sfu', 'logs');

/* ────────── 阈值：全部写在这里，报告里会原样打印，不藏在代码缝里 ────────── */
const T = {
  /* 停摆：字幕之间空了这么久，**而这段时间里音频段还在到达**（有人说话却没出字）。
   * 单看字幕间隔是判不出停摆的——没人说话时间隔本来就可以无限长，那是会议不是故障。 */
  stallMs: Number(process.env.REVIEW_STALL_MS) || 60000,
  stallMinSegments: 2,
  /* 碎片：定稿里汉字数 ≤ 这个数的算碎片（2s 分段把一句话切开的典型形状）。 */
  fragChars: 2,
  /* 延迟读数可信的最低样本数——低于它就只报"样本不足"，不报中位数。 */
  minLatencySamples: 5,
  /* 连续性也要样本量：一场只有 3 条字幕的会，"没观察到停摆"几乎必然是"根本没观察到"。
   * 第一版这里写 3，于是 283648 那类"6 段被闸门当静音删掉、只剩 3 条字幕"的会**被判成 ✅**——
   * 那正是用户抱怨的那一场。判据太松的报告会替被检的东西洗白（坑 53）。 */
  minContinuitySamples: 5,
  /* 能量闸的分档边界，对应三次校准：-45（最初）→ -55（10-05）→ -62（10-05d）。
   * "-62~-55 这一带被跳过"的条数就是**旧闸会误杀、新闸放行**的那部分人。 */
  gateOld: -55,
  gateNow: -62,
  /* ★ 2026-10-10 H2（RMS 到达节奏）的三条线，各自答一个问题，不是一条"综合阈值"：
   *   firstWarnMs = 进程出生到第一条 RMS 行的可接受上限（本机实测 995ms，宽限期给 8s）；
   *   gapBadMs   = 相邻两行的最大空档——静音判定与 ⏱ 读数的锚就挂在这里；
   *   blockBytes = 单次 stdout 事件的字节数，超过它才算"管道成块交付"（实测逐行是 70~960B）。
   *   ▸ 为什么留成配置：ffmpeg 的构建/版本会改这个行为，换机器时这三个数要能当场改而不改代码。 */
  rmsFirstWarnMs: Number(process.env.REVIEW_RMS_FIRST_MS) || 2000,
  /* ★ 2026-10-10 判"管道慢"用的是这一条（第一个非空分段 → 第一条 RMS 行），不是上面那条 firstMs：
   *   firstMs 里混着"这一代出生时恰好没人开口"那段等待，实测同一套代码里 995ms 与 20230ms 都出现过。 */
  rmsPipeWarnMs: Number(process.env.REVIEW_RMS_PIPE_MS) || 1500,
  rmsGapBadMs: Number(process.env.REVIEW_RMS_GAP_MS) || 5000,
  rmsBlockBytes: Number(process.env.REVIEW_RMS_BLOCK_BYTES) || 4096,
  minRmsSamples: 3,
  /* 窗被判有声的比例超过它 ⇒ "这个房间几乎没有安静态"（要结合 fin 分布一起判，不单独当结论） */
  voicedNeverSilent: Number(process.env.REVIEW_VOICED_NEVER) || 0.9,
};

/* ────────── 读账本 ────────── */
function readJsonl(file) {
  const out = [];
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return out; }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { const o = JSON.parse(line); if (o && typeof o === 'object') out.push(o); } catch (e) { /* 坏行跳过：账本是 append-only，写一半是常态 */ }
  }
  return out;
}
function dayStamp(d) { return d.toISOString().slice(0, 10).replace(/-/g, ''); }
function recentDays(days) {
  const out = [];
  const now = Date.now();
  for (let i = 0; i < days; i++) out.push(dayStamp(new Date(now - i * 86400000)));
  return out;
}
/* 字幕文件名：cap-<房间号>-<YYYYMMDD>.jsonl
 * ▸ 取日期用 slice(-14,-6) 而不是 (-12,-6)：'.jsonl' 占 6 个字符，日期是它前面那 8 个。
 *   第一版写错成 12，于是"最近一天"永远筛出 0 个文件——**一条只会漏、不会错的过滤器**，
 *   报"今天没有会议记录"听起来完全合理，所以这种 bug 必须靠自检抓（见 selftest 的 J 组）。 */
const CAP_DAY_AT = -14;
function parseCapName(f) {
  if (!/^cap-\d{6}-\d{8}\.jsonl$/.test(f)) return null;
  return { room: f.slice(4, 10), day: f.slice(CAP_DAY_AT, CAP_DAY_AT + 8) };
}
function listCaptionFiles(days) {
  if (!fs.existsSync(CAP_DIR)) return [];
  const want = new Set(recentDays(days));
  const out = [];
  for (const f of fs.readdirSync(CAP_DIR)) {
    const p = parseCapName(f);
    if (p && want.has(p.day)) out.push({ file: path.join(CAP_DIR, f), room: p.room, day: p.day });
  }
  return out;
}
function listLogFiles(days) {
  if (!fs.existsSync(LOG_DIR)) return [];
  const want = new Set(recentDays(days).map((d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`));
  return fs.readdirSync(LOG_DIR)
    .filter((f) => /^app-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && want.has(f.slice(4, 14)))
    .map((f) => path.join(LOG_DIR, f));
}
const toMs = (v) => (typeof v === 'number' ? v : Date.parse(String(v || '')) || 0);

/* ────────── 分析（纯函数，自检直接调它们） ────────── */
const cjkCount = (s) => (String(s).match(/[㐀-鿿぀-ヿ]/g) || []).length;
function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[i];
}

/**
 * 一场会的复盘。
 * @param caps   字幕条目（账本原样）
 * @param events 该房间的结构化事件
 */
function analyzeRoom(caps, events) {
  const asrCaps = caps.filter((e) => e.asr === true && !e.bot);
  const fin = asrCaps.filter((e) => e.fin);
  const ts = (list) => list.map((e) => toMs(e.ts)).filter((t) => t > 0).sort((a, b) => a - b);

  /* ① 连续性：段还在到达却没有字幕 = 停摆。
   *    每个成员的 asr-segment 是"音频进了转写器"的证据，字幕是"转出来了"的结果。
   *    只有两者一起看才分得开"没人说话"与"说了但没转出来"——这两种病的处方完全相反。 */
  const segByMember = new Map();
  for (const e of events) {
    if (e.event !== 'asr-segment') continue;
    const m = String(e.member || '?');
    if (!segByMember.has(m)) segByMember.set(m, []);
    segByMember.get(m).push(toMs(e.ts));
  }
  const capTsByMember = new Map();
  for (const e of asrCaps) {
    const m = String(e.from || '?');
    if (!capTsByMember.has(m)) capTsByMember.set(m, []);
    capTsByMember.get(m).push(toMs(e.ts));
  }
  const stalls = [];
  for (const [m, segs] of segByMember) {
    const got = (capTsByMember.get(m) || []).slice().sort((a, b) => a - b);
    segs.sort((a, b) => a - b);
    for (let i = 0; i < segs.length; i++) {
      const from = segs[i];
      const to = got.find((t) => t > from);
      const endAt = to || (got.length ? got[got.length - 1] + T.stallMs : from + T.stallMs);
      let n = 0;
      for (const s of segs) if (s >= from && s <= endAt) n++;
      if (n >= T.stallMinSegments && endAt - from >= T.stallMs) {
        stalls.push({ member: m, from, ms: endAt - from, segments: n });
        break;                                     // 每人报一次就够（多了会掩盖别的成员）
      }
    }
  }
  stalls.sort((a, b) => b.ms - a.ms);

  /* ② 碎片与重复 */
  const frags = fin.filter((e) => cjkCount(e.text) > 0 && cjkCount(e.text) <= T.fragChars);
  let dups = 0;
  const bySpeaker = new Map();
  for (const e of asrCaps) {
    const k = String(e.from || '?');
    if (!bySpeaker.has(k)) bySpeaker.set(k, []);
    bySpeaker.get(k).push(e);
  }
  for (const list of bySpeaker.values()) {
    list.sort((a, b) => toMs(a.ts) - toMs(b.ts));
    for (let i = 1; i < list.length; i++) {
      /* 喂给判据之前先按**生产同一个归一化**过一遍（normAsrText：去标点/空白、唤醒词族形近字归一）。
       * 复盘脚本直接拿原文比，就会比线上少认一批"写法漂移的重复"——报告于是系统性偏乐观。 */
      const prev = Asr.normAsrText(list[i - 1].text); const cur = Asr.normAsrText(list[i].text);
      /* 15s 内同一个人前后两句互为碎片 = 分段把一句话说两遍 */
      if (toMs(list[i].ts) - toMs(list[i - 1].ts) <= 15000 && Asr.isDupOrFragment(prev, cur)) dups++;
    }
  }

  /* ③ 延迟：**只采信 fin==='silence' 的读数**。
   *    max-open / max-age / gap 都发生在"人还在说"的时候，那时量到的十几毫秒
   *    不是"说完→上屏"（10-05d 真机实锤：显示 0.0s 的那句真实等待约 10s）。 */
  const lat = fin.filter((e) => e.fin === 'silence' && Number(e.lat) > 0).map((e) => Number(e.lat)).sort((a, b) => a - b);
  const finKinds = {};
  for (const e of fin) finKinds[e.fin] = (finKinds[e.fin] || 0) + 1;

  /* ④ 幻觉：判据用**生产代码那一个函数**，不另写一份 */
  const noise = asrCaps.filter((e) => Asr.noiseRiffReason(String(e.text || '')));

  /* ⑤ 能量闸：跳过条数按峰值分档 */
  const skipped = events.filter((e) => e.event === 'asr-silence-skipped');
  const bands = { dead: 0, floor: 0, oldGateWouldKill: 0, loud: 0 };
  for (const e of skipped) {
    const p = Number(e.peakDb);
    if (!Number.isFinite(p)) continue;
    if (p < -70) bands.dead++;
    else if (p < T.gateNow) bands.floor++;
    else if (p < T.gateOld) bands.oldGateWouldKill++;
    else bands.loud++;
  }
  /* ★ 一条可以从账本里**推出来**的事实：当前闸门是 -62dB，凡是峰值高于它却仍被跳过的段，
   *   说明那场会跑的不是现在这套参数（旧阈值更严）。
   *   这正是"我改了你那边怎么还不行"的答案——不是改错了，是那台服务器没重启。 */
  const aboveGateSkipped = skipped.filter((e) => Number(e.peakDb) >= T.gateNow).length;

  /* ⑥ 耳朵本身死没死（10-04g 那一类：进程崩溃后永久放弃 = 这个人全场没字幕） */
  const gaveUp = events.filter((e) => e.event === 'asr-recorder-gave-up');
  const respawn = events.filter((e) => e.event === 'asr-recorder-respawn');
  const crashRespawn = respawn.filter((e) => e.idle !== true);

  /* ⑥b ★ 2026-10-10 RMS 的**到达节奏**（把路线图 H2 那条口头结论变成每场都有的分布）。
   *   ▎为什么这件事属于复盘而不是自测：那条"`ametadata` 打到管道上按 ~4KB 成块交付 ⇒
   *     第一行 RMS 约 5s 才到"挂了三天，期间我拿它对生产阈值做过推断（冷启动宽限 8s 就是
   *     为它写的）。受控自测一天只跑一次，而真会议室里那台 ffmpeg 是**另一批进程**——
   *     只有记忆没有账本的结论，就没有任何人能复核它（坑 76/133：机制"在"不等于生效，
   *     而"我记的那个数"连机制都算不上）。现在每一代录音进程留一行 `asr-rms-arrival`，
   *     分布就直接长在报告里，下一次换 ffmpeg 版本/换机器会被这一行当场逮住。
   *   ▸ 四个数各答一个问题，故意不合成一个"综合分数"：
   *       firstMs     = 本代进程出生 → 第一条 RMS 行（**含"这一代出生时恰好没人说话"**，只当背景）
   *       afterByteMs = 第一个非空分段落盘 → 第一条 RMS 行（= **管道自己的耗时**，判 H2 用它）
   *       gapMaxMs    = 行与行之间的最大空档（静音判定与 ⏱ 读数的锚挂在这里）
   *       bytesMax    = 单次 stdout 事件最大字节（实测**正常突发**到过 2018B —— 流刚开始时一挤几十行；所以判线画在 4KB）
   *   ▸ 为什么必须有 afterByteMs 这个锚：实测同一套代码里 firstMs 出现过 995（一出生就有人在说）
   *     也出现过 **20230**（那一代没人说话）——同一个名字差 20 倍。
   *     我第一版就是拿着它差点去修"冷启动 20 秒"这个不存在的瓶颈（坑 75 的指标版：
   *     一个指标如果不代表它名字所说的那件事，它就会把人引向错误的诊断）。 */
  const rmsArr = events.filter((e) => e.event === 'asr-rms-arrival');
  const rmsNums = (key) => rmsArr.map((e) => Number(e[key]))
    .filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  const rmsFirst = rmsNums('firstMs');
  const rmsPipe = rmsNums('afterByteMs');
  const rmsGap = rmsArr.map((e) => Number(e.gapMaxMs) || 0).sort((a, b) => a - b);
  const rmsBytes = rmsArr.map((e) => Number(e.bytesMax) || 0).sort((a, b) => a - b);
  /* ★ 2026-10-10（H8c）同一行事件里带着"这把尺此刻停在哪"：floor 中位 / 生效阈值 / 有声占比。
   *   voiced 比例（voiced/lines）才是"这个房间分不分得开"的直接读数：
   *   接近 1 = 每一窗都判"有人在说话" ⇒ `silenceConfirmed` 永不成立 ⇒ 句子只能等保险丝 ⇒ blob。
   *   （10-07 那次 blob 的机理；当时只能靠 ASR_DEBUG 现场摊开看，现在账本里有数了。） */
  const rmsVoicedShare = rmsArr.map((e) => {
    const l = Number(e.lines); const v = Number(e.voiced);
    return (Number.isFinite(l) && l > 0 && Number.isFinite(v)) ? v / l : null;
  }).filter((x) => x !== null).sort((a, b) => a - b);
  const rmsFloor = rmsArr.map((e) => Number(e.floorMed)).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const rmsThr = rmsArr.map((e) => Number(e.voiceThr)).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);

  /* ⑦ 应答与播报 */
  const count = (name) => events.filter((e) => e.event === name).length;
  const ttsEvents = events.filter((e) => e.event === 'ai-tts');
  const engines = {};
  for (const e of ttsEvents) engines[e.engine || '?'] = (engines[e.engine || '?'] || 0) + 1;

  /* ⑧ ★ 2026-10-06 指令回扫：拿**当前**规则把这间房的人话过一遍，看多少句会被读成
   *   房间动作 / 被判成越界拒绝。
   *   ▎为什么这件事属于"可用性复盘"而不属于单元测试：test:asr 那 28 句泛化电池
   *     是"我想像中用户会说的话"，账本里的才是他们**真正说的**。本轮就是靠这次回扫
   *     抓到我自己刚写进去的一条误拒（「把这条**记录**一下」被判成"开录制"而明确拒绝，
   *     而这一句在真实账本里出现 11 次）。规则一改，这里就该重扫一遍。
   *   ▸ 判据复用生产那两个函数（detectRoomActions / detectOutOfScopeCommand），
   *     复盘脚本不另写一份"什么算指令"，否则报告说的和系统做的不是一回事（坑 47）。
   *   ▸ **口径**：上面用的 `spoken = asrCaps.filter(!bot)` 里，asrCaps 已经只收
   *     `asr === true` 的条目——也就是**麦克风真转出来的句子**。这一点必须说清：
   *     AI 自己写进账本的回答是 `asr:false`，它们不是"有人说了这句话"。
   *     我第一版混着数过，于是得出"18 句会触发、多数是 AI 回声"这个**并不存在**的现象；
 *     分开核字段之后：864 句麦克风人话里只有 3 句触发，而那 3 句全都是真命令。 */
  const spoken = asrCaps.filter((e) => !e.bot && String(e.text || '').trim().length >= 2);
  const cmdAction = [], cmdRefused = [];
  for (const e of spoken) {
    const t = String(e.text);
    const acts = RoomActions.detectRoomActions(t);
    if (acts.length) cmdAction.push({ t: t.slice(0, 34), a: acts.join(',') });
    const d = RoomActions.detectOutOfScopeCommand(t);
    if (d) cmdRefused.push({ t: t.slice(0, 34), id: d.id });
  }

  /* ★ 2026-10-06 夜二 字幕形态（每条字幕去掉标点空白后的字数）：这场会**界面上长什么样**。
   *   ▎为什么要有这个量：用户报"识别不是很准确"，而我此前只拿合成音频看这件事——那是念给
   *     我自己的稿子，测不出真实噪声与语速下的形态。"被切散"（≤4 字）与"被粘成 blob"（≥25 字）
   *     是**方向相反的两种病**，同一场会里常常同时存在，处方也相反（前者要更多上下文，
   *     后者要靠换句定稿）——所以两个数都要报，不能只报一个平均值。
   *   ▸ 有了基线，将来改 `asrSegmentSec` 才有可比的东西；没有它，任何"我调准了"都是感觉。 */
  const shapeNorm = (t) => String(t || '').replace(/[\s。，,、？！?!；;：:“”"'‘’.]/g, '');
  const shapes = asrCaps.map((e) => shapeNorm(e.text).length).filter((x) => x > 0).sort((x, y) => x - y);
  /* ★ 2026-10-07 **整句重转的生效率**（`ref:1` 是服务器在定稿时打上的"这句是整段音频一次转写"）。
   *   ▎为什么单独数这一格：机制写在代码里不等于它在用户那台机器上跑着（坑 76 的教训已经付过三次学费）。
   *     旧账本里没有 `ref` 字段 ⇒ 这一格报 unknown 并直接给出"重启 3001 才有"这句话——
   *     这就是"我改了你怎么还不行"的第一现场答案。 */
  const refinedN = asrCaps.filter((e) => e.ref === 1).length;

  /* ⑧b ★ 2026-10-06 夜二 **唤醒回扫**：按当前 `Asr.shouldWake` 把这间房的麦克风人话重放一遍。
   *   ▎为什么这条必须由真实账本来做、而不是我的语音自测：合成 fixture 是**我念给自己听的稿子**，
   *     每句都写着「小明，…」，它测不出"没叫它却被接话"这件事（2026-10-06 用户原话：
   *     "你测试的音频乱的不像话"——同一条批评的另一面就是：那种音频证明不了任何真人场景）。
   *     用户那场会 21 句人话 / AI 应答 18 次，只有这一行能把"实际发生的"和
   *     "按当前规则会发生的"并排打出来。
   *   ▸ 三档：`exact` 明确写着「小明」；`fuzzy` 同音字（鸣/名/铭/茗）；
   *     `ambig` 靠**歧义写法 + 称呼语境**醒的（小米/小命/小民…）——这一档是要盯的风险位，
   *     正常会议里应当接近 0。 */
  const wakeReplay = [];
  for (const e of spoken) {
    const t = String(e.text);
    const why = Asr.wakeReason(t);
    if (!why) continue;
    wakeReplay.push({ t: t.slice(0, 34), why: /小[明鸣名铭茗]/.test(t) ? (t.includes('小明') ? 'exact' : 'fuzzy') : 'ambig' });
  }
  /* ⑨ ★ 2026-10-06 这场会到底是**真人在开会**还是**我的自测在念稿**？
   *   ▎为什么这条必须存在：这台复盘的全部意义是回答"真人用到底行不行"，而账本里
   *     混着 test:e2e-asr / test:voice-longrun / test:e2e-reconnect 跑出来的场次——
   *     它们喂的是同一段循环合成语音。混在一起数，"可用性结论"其实掺了我自己的测试数据
   *     （原来这条边界是明写"分不出来"的诚实声明，现在有了唯一一份 fixture 句子就能分）。 */
  const fixtureHits = asrCaps.filter((e) => looksLikeFixtureCaption(String(e.text || ''))).length;
  const roomFixtureCoverage = fixtureRoomCoverage(asrCaps.map((e) => String(e.text || '')).join(' '));
  /* ▎为什么还要这个数：房间级覆盖单独用会**跑飞**。自检 M2 一接上就把一场
   *   「8 条里 3 条念稿 + 5 条真讨论」的会报成自测场——因为整场拼起来当然含有那句
   *   完整的 fixture 话。**真人会上也有人真说过「小明，帮我记一下明天下午三点的评审会」**
   *   （那正是这个产品的正常用法）。所以补判据必须限定在它要修的那个形态上：
   *   **碎片多到逐条判不了**（<6 字的小句子占多数）时，才允许靠拼接覆盖把结论抬上去。 */
  const tinyShare = (() => {
    const norm = (t) => String(t || '').replace(/[\s。，,、？！?!；;：:]/g, '');
    const n = asrCaps.filter((e) => norm(e.text).length < 6).length;
    return asrCaps.length ? n / asrCaps.length : 0;
  })();
  const all = ts(caps);
  return {
    caps: caps.length, asrCaps: asrCaps.length, finalized: fin.length,
    spanMs: all.length > 1 ? all[all.length - 1] - all[0] : 0,
    stalls, fragCount: frags.length, fragShare: fin.length ? frags.length / fin.length : 0, dups,
    lat, latN: lat.length, finKinds,
    noise: noise.length, noiseExamples: noise.slice(0, 2).map((e) => String(e.text).slice(0, 40)),
    skipped: skipped.length, bands, aboveGateSkipped,
    gaveUp: gaveUp.length, respawn: respawn.length, crashRespawn: crashRespawn.length,
    /* ★ 2026-10-10 H2 的四组分布（已在 ⑥b 解释过每个数答什么问题）。
     *   rmsN 是"有几代交出了 RMS 行"，rmsPipeN 是"其中有几个能算出管道耗时"——
     *   后者可能更小（老服务器没写 firstByteMs、或锚点还没扫到就退了），所以分开报、不硬凑。 */
    rmsN: rmsFirst.length, rmsFirst, rmsPipe: rmsPipe, rmsPipeN: rmsPipe.length,
    rmsGapMax: rmsGap[rmsGap.length - 1] || 0,
    rmsBytesMax: rmsBytes[rmsBytes.length - 1] || 0,
    /* ★ H8c：这把尺停在哪 + 有多少窗被判有声（都从同一行事件来，不另找数据源） */
    rmsVoicedShare, rmsFloorMed: rmsFloor.length ? rmsFloor[Math.floor(rmsFloor.length / 2)] : null,
    rmsThrMed: rmsThr.length ? rmsThr[Math.floor(rmsThr.length / 2)] : null,
    wake: count('asr-wake-answer'), wakeAck: count('ai-wake-ack'), nameOnly: count('ai-wake-name-only'),
    busyDrop: count('ai-answer-busy-drop'), dupDropped: count('asr-dup-dropped'), echoDropped: count('asr-ai-echo-dropped'),
    answerFailed: count('ai-answer-failed'),
    spokenN: spoken.length, cmdAction, cmdRefused, wakeReplay, shapes, fixtureHits, roomFixtureCoverage, tinyShare, refinedN,
    /* ⑨ ★ 2026-10-08（I4）共享文件：这台仪表从此认识第 51 步。
     *   ▎为什么算"可用性"而不是"存储"：上传被拒（配额 / 房间已销毁 / 名字不合法）在用户那边
     *     的表现就是"传不上去"，而它**不会留在字幕账本里**——只有事件日志看得见。
     *   ▎口径：只数**这间房**的事件（events 已按 roomNumber 过滤过），跨房不串
     *     （自检 P4 专门钉这条：别把别人的上传算成这场的功劳）。 */
    fileUp: events.filter((e) => e.event === 'file-uploaded'),
    fileRejected: events.filter((e) => e.event === 'file-upload-rejected'),
    fileDeleted: events.filter((e) => e.event === 'file-deleted'),
    fileCleanupFailed: events.filter((e) => e.event === 'files-cleanup-failed'),
    tts: ttsEvents.length, engines, ttsFailed: count('ai-tts-failed'), ttsBudget: count('ai-tts-budget'),
    control: count('room-control'), controlNoop: count('room-control-noop'),
    members: new Set(asrCaps.map((e) => e.from)).size,
  };
}

/* ★ 2026-10-08（I4）把"这间房的事件"抽成一个函数：跨房串味是这类复盘最容易犯的错
 *   （房间号会回收复用，而日志是按天一个大文件，所有房间混在一起）。
 *   抽出来不是为了好看，是因为**不抽就测不到**——自检 P4 直接拿它验"别把别人的上传算进来"。 */
function eventsForRoom(events, room) {
  const r = String(room == null ? '' : room);
  return (events || []).filter((e) => String(e.roomNumber || '') === r);
}

/* ────────── 结论：每条都带样本量，样本不足就直说 ────────── */
function fmtSec(ms) { return (ms / 1000).toFixed(ms >= 10000 ? 1 : 2) + 's'; }
/* 比例与分贝的写法各留一处（同一份报告里"64%"与"0.643"混着出现，读者会怀疑自己在看两个指标）。 */
const pct1 = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : '—');
const fmtDb1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');
function verdictLines(m) {
  const L = [];
  const add = (level, label, text) => L.push({ level, label, text });

  if (m.stalls.length) {
    /* 停摆是**正面证据**（"段到了却没出字"这件事确实发生了），所以它排在样本量那条之前：
     * 一场只有两条字幕的会，只要中间有段在到达，就足以判"这条链断了"——
     * 反过来"没停摆"才需要样本量撑着（没观察到 ≠ 观察到了没有）。 */
    add('bad', '语音连续性', `${m.stalls.length} 个人出现停摆：最长 ${fmtSec(m.stalls[0].ms)} 里到了 ${m.stalls[0].segments} 段音频却没有一条字幕`);
  } else if (m.asrCaps < T.minContinuitySamples) {
    add('unknown', '语音连续性', `样本不足（定稿 ${m.asrCaps} 条 < ${T.minContinuitySamples}），不足以下结论`);
  } else {
    add('ok', '语音连续性', `${m.members} 人 / ${m.asrCaps} 条定稿，未见"段在到达却没出字"的停摆`);
  }

  if (m.latN < T.minLatencySamples) {
    add('unknown', '定稿延迟', `可信读数只有 ${m.latN} 条（需 ≥${T.minLatencySamples}），不足以下结论`
      + `；定稿原因分布 ${Object.entries(m.finKinds).map(([k, v]) => `${k}=${v}`).join(' ') || '(无)'}`);
  } else {
    add(m.lat[Math.floor(m.latN * 0.9)] > 6000 ? 'bad' : m.latN && quantile(m.lat, 0.5) > 3000 ? 'warn' : 'ok',
      '定稿延迟', `中位 ${fmtSec(quantile(m.lat, 0.5))} · p90 ${fmtSec(quantile(m.lat, 0.9))} · 最慢 ${fmtSec(m.lat[m.latN - 1])}（n=${m.latN}，只算人真停了嘴的 silence 定稿）`);
  }

  add(m.finalized === 0 ? 'unknown' : (m.fragShare > 0.3 && m.finalized >= 8 ? 'warn' : 'ok'), '断句碎片',
    m.finalized === 0 ? '这场会没有定稿字幕，谈不上碎片率（0/0 不是"没有碎片"）'
      : `碎片 ${m.fragCount}/${m.finalized} 条定稿（${(m.fragShare * 100).toFixed(0)}%）· 15s 内重复 ${m.dups} 次`);
  add(m.noise ? 'warn' : 'ok', '噪声幻觉入账',
    m.noise ? `${m.noise} 条被生产判据认成噪声（例："${m.noiseExamples[0]}"）——它们进了账本就会被 AI 当成人说的话` : '0 条');
  add(m.gaveUp ? 'bad' : (m.crashRespawn > 3 ? 'warn' : 'ok'), '听觉进程',
    `自愈重启 ${m.respawn} 次（其中崩溃 ${m.crashRespawn}）· **永久放弃 ${m.gaveUp} 次**`);
  /* ★ 2026-10-10 H2 结案后的常驻哨兵。三种病分开报，因为它们处方完全不同：
   *   成块（bytes 大）⇒ 要动 stdout/缓冲；**管道慢**（afterByte 大）⇒ 要加宽限期；空档大 ⇒ 静音判定会卡。
   *   ▸ 判"慢"用的是 afterByte（有音频进来了才交第一行要多久），**不是** firstMs——
   *     firstMs 里混着"这一代出生时恰好没人说话"那段（实测 995ms 与 20230ms 都出现在同一套代码里），
   *     拿它判冷启动 = 拿一个不代表它名字的指标做诊断（坑 75 的指标版）。
   *   ▸ 没有样本**不许**报"没问题"（坑 105）：老服务器不写这行、或这场会没人送音频，
   *     两者都该是 ❔ 而不是 ✅——否则这台仪表在最常见的形态下永远绿。 */
  if (m.rmsN < T.minRmsSamples) {
    add('unknown', 'RMS 到达',
      `样本 ${m.rmsN} 代（<${T.minRmsSamples} 不下结论）——要么这场没人送音频，要么服务器还没写这行（重启 3001 才有）`);
  } else {
    const blk = m.rmsBytesMax >= T.rmsBlockBytes;
    const hasPipe = m.rmsPipeN >= 1;
    const slow = hasPipe && quantile(m.rmsPipe, 0.9) > T.rmsPipeWarnMs;
    const gapBad = m.rmsGapMax > T.rmsGapBadMs;
    add(gapBad ? 'bad' : (blk || slow) ? 'warn' : 'ok', 'RMS 到达',
      `管道 中位 ${hasPipe ? fmtSec(quantile(m.rmsPipe, 0.5)) : '—'} / p90 ${hasPipe ? fmtSec(quantile(m.rmsPipe, 0.9)) : '—'}`
      + `（第一个非空分段→第一条 RMS 行，n=${m.rmsPipeN}）· 行间隔最大 ${m.rmsGapMax}ms · 单次事件最大 ${m.rmsBytesMax}B · `
      + `首行(含等人开口) 中位 ${fmtSec(quantile(m.rmsFirst, 0.5))}（n=${m.rmsN} 代）⇒ `
      + (blk ? '**管道成块交付仍在**（H2 复现，要动 stdout 那条路）'
        : gapBad ? '行与行之间出现长空档 ⇒ 静音判定会跟着卡（查 ffmpeg 是否还在收 RTP）'
          : slow ? `音频进来后第一行仍要 >${T.rmsPipeWarnMs}ms ⇒ 冷启动宽限要核对`
            : hasPipe ? '逐行交付，H2 的"成块"假设在这一台上不成立（已结案）'
              : '逐行交付（这一版服务器还没交"管道"那一格，只看空档与单次字节）'));
  }
  /* ★ 2026-10-10（H8c）这个房间**分不分得开**——它是"要不要动阈值"的唯一正当依据。
   *   ▸ 有声占比（voiced/lines）接近 1 的两种读法必须分清，否则这一行会被误读：
   *       ① 真有人在连续讲（开会正常形态，尤其念稿/发言接发言）⇒ 判"分不开"是错的；
   *       ② 静音期也判有声 ⇒ `silenceConfirmed` 永不成立 ⇒ 句子等 10s 保险丝 ⇒ blob。
   *     ⇒ 所以这行**只报数 + 给下一步**，不自己充当结论；结论要把这一行与「字幕形态」
   *       （长条 %）和定稿原因分布（fin=silence 占比）**放在一起**读（坑 105：每条结论都带样本量）。
   *   ▸ 阈值中位 == −42 意味着"被钳位硬线接管"（自适应没在起作用），这本身是可操作的读数。 */
  if (m.rmsVoicedShare.length >= T.minRmsSamples) {
    const share = quantile(m.rmsVoicedShare, 0.5);
    const clamped = m.rmsThrMed !== null && Math.abs(m.rmsThrMed - (-42)) < 0.05;
    add(share > T.voicedNeverSilent ? 'warn' : 'info', '房间可分性',
      `窗被判有声 中位 ${pct1(share)} / 最差 ${pct1(m.rmsVoicedShare[m.rmsVoicedShare.length - 1])}`
      + `（n=${m.rmsVoicedShare.length} 代）· 噪声底中位 ${fmtDb1(m.rmsFloorMed)}dB · 阈值中位 ${fmtDb1(m.rmsThrMed)}dB`
      + (clamped ? ' ⇒ 阈值被 −42 硬线钳住（自适应此刻没起作用）' : '')
      + (share > T.voicedNeverSilent
        ? ' ⇒ **几乎没有"安静窗"**：静音确认可能长期不成立（要跟「字幕形态」与 fin 分布一起判，别单看这行）'
        : ''));
  } else {
    add('unknown', '房间可分性',
      `样本 ${m.rmsVoicedShare.length} 代（<${T.minRmsSamples} 不下结论）——重启 3001 之后每代录音进程才会记这条`);
  }
  add('info', '能量闸',
    `跳过 ${m.skipped} 段：纯静音(<-70dB) ${m.bands.dead} · 噪声底 ${m.bands.floor} · `
    + `**旧闸会误杀的区间(-62~-55dB) ${m.bands.oldGateWouldKill}** · 更响 ${m.bands.loud}`);
  /* 这一行是整份报告里**唯一能从账本反推"那台服务器跑的是哪一版参数"**的地方，
   * 也就是"我改了呀怎么还不行"的标准答案：不是改错了，是进程没重启。 */
  add(m.aboveGateSkipped ? 'warn' : m.skipped ? 'ok' : 'unknown', '跑的是哪套阈值',
    m.aboveGateSkipped
      ? `${m.aboveGateSkipped} 段峰值在 ${T.gateNow}dB 之上却仍被跳过 ⇒ 这场会跑的是**旧阈值**，当前配置会放行它们（要吃到修复得重启服务器）`
      : m.skipped ? `没有一段高于当前闸门(${T.gateNow}dB)还被跳过的 ⇒ 这套参数在这场会里是生效的`
        : '这场会没有跳过记录，判不了阈值版本');
  add(m.answerFailed ? 'warn' : 'ok', '唤醒与应答',
    `唤醒应答 ${m.wake} 次（光叫名字的短应答 ${m.wakeAck}）· 被节流：忙 ${m.busyDrop} · 重复句 ${m.dupDropped} · 自己的回声 ${m.echoDropped} · 应答失败 ${m.answerFailed}`);
  add(m.ttsFailed > m.tts ? 'bad' : m.ttsFailed ? 'warn' : 'ok', '播报',
    `合成 ${m.tts} 段（${Object.entries(m.engines).map(([k, v]) => `${k}=${v}`).join(' ') || '无'}）· 失败 ${m.ttsFailed} · 超字数预算 ${m.ttsBudget}`);
  add(m.controlNoop ? 'warn' : 'ok', 'AI 操控实体',
    m.control || m.controlNoop
      ? `下达 ${m.control} 次 · 没有任何客户端执行 ${m.controlNoop} 次`
        + (m.controlNoop ? '（多半是页面还是旧版：让用户硬刷新 Ctrl+F5，或地址后加 ?nosw=1 打开一次）' : '')
      : '这场会没有下达房间动作');
  /* ★ 这一行是"规则改了会不会误伤真人"的哨兵（样本量口径同坑 105：话太少不下结论）。
   *   正常形态是**极少数**几句被读成指令，而那几句确实是祈使句（"帮我开白板再白板这画"）；
   *   一旦占比跳高、或者被拒的句子里出现"记录/记一下"这类**记事求助**，就是规则写宽了。 */
  if (m.spokenN < 10) {
    add('unknown', '指令回扫', `人话只有 ${m.spokenN} 句（<10），不足以判断规则是否误伤`);
  } else {
    const share = ((m.cmdAction.length + m.cmdRefused.length) / m.spokenN * 100).toFixed(1);
    const ex = (m.cmdRefused[0] || m.cmdAction[0] || {});
    add(m.cmdRefused.length > 2 || (m.cmdAction.length + m.cmdRefused.length) / m.spokenN > 0.05 ? 'warn' : 'ok',
      '指令回扫',
      `${m.spokenN} 句人话按**当前**规则重放：读成房间动作 ${m.cmdAction.length} 句 · 判越界拒绝 ${m.cmdRefused.length} 句（合计 ${share}%）`
      + (ex.t ? ` · 例：「${ex.t}」→${ex.id || ex.a}` : ''));
  }
  /* ★ 2026-10-06 夜二 唤醒回扫（与指令回扫同一套方法论：**真人说过的话**才是判据的考卷）。
   *   ▸ 看两个数：
   *     ① `ambig` —— 靠**歧义写法**（小米/小命/小民 + 称呼语境）醒的句数。正常会议里应当≈0，
   *        它一旦上来就是"用户没叫它，它却接了"（10-05 那圈误唤醒就是这么来的）；
   *     ② **历史 vs 当前** —— 账本里"这场会 AI 实际应答了多少次"和"按现在的规则会答几次"。
   *        差值大 = 这场会跑的是旧规则（追问窗口/宽表），**要吃到修复得重启服务器**；
   *        这一行因此同时是"识别得对不对"和"我的改动到没到用户手上"两块证据。 */
  if (m.spokenN < 10) {
    add('unknown', '唤醒回扫', `人话只有 ${m.spokenN} 句（<10），不足以判断唤醒判据是否偏宽`);
  } else {
    const ambig = m.wakeReplay.filter((w) => w.why === 'ambig');
    const share = (m.wakeReplay.length / m.spokenN * 100).toFixed(1);
    const gap = m.wake - m.wakeReplay.length;
    add(ambig.length > 0 ? 'warn' : (m.wakeReplay.length / m.spokenN > 0.3 ? 'warn' : 'ok'),
      '唤醒回扫',
      `${m.spokenN} 句人话按**当前**判据会醒 ${m.wakeReplay.length} 句（${share}%）`
      + ` · 靠歧义写法（小米/小命…）醒的 ${ambig.length} 句`
      + (gap > 0 ? ` · 这场会**实际应答 ${m.wake} 次**，多出的 ${gap} 次来自已关闭的追问窗口/旧宽表 ⇒ 那场跑的是旧规则` : '')
      + (ambig.length ? ` · 例：「${ambig[0].t}」` : ''));
  }
  /* ★ 2026-10-06 夜二 字幕形态：这场会**界面上到底长什么样**。
   *   ▎为什么要有这一行：用户报"识别不是很准确"，而我此前只拿合成音频看这件事——
   *     那是念给我自己听的稿子，测不出真实噪声与语速下的形态。
   *     现在直接量真人账本：句子被切散（≤4 字）还是被粘成 blob（≥25 字），
   *     这两件事是**相反的两条病**，同一场会里往往同时存在，处方也完全不同
   *     （前者要更长分段/更多上下文，后者要靠换句定稿）。
   *   ▸ 有了这条，改 `asrSegmentSec` 之前就有基线可比；没有它，任何"我调快了/调准了"
   *     都只是感觉（坑 87：拿不能归因的样本做决定）。 */
  const shapes = m.shapes || [];
  if (shapes.length < 5) {
    add('unknown', '字幕形态', `只有 ${shapes.length} 条字幕（<5），量不出形态`);
  } else {
    const avg = shapes.reduce((s, x) => s + x, 0) / shapes.length;
    const share = (n) => (100 * shapes.filter((x) => x <= n).length / shapes.length).toFixed(0);
    const blobN = shapes.filter((x) => x >= 25).length;
    add(blobN / shapes.length > 0.15 ? 'warn' : 'ok', '字幕形态',
      `平均 ${avg.toFixed(1)} 字 · 中位 ${shapes[Math.floor(shapes.length / 2)]} 字 · 最长 ${shapes[shapes.length - 1]} 字`
      + ` · ≤4 字碎片 ${share(4)}% · ≥25 字长条 ${blobN} 条（${(100 * blobN / shapes.length).toFixed(0)}%）`
      + (blobN / shapes.length > 0.15 ? ' —— 多句被粘成一条，看「换句定稿」是否在跑（旧服务器没有这条）' : ''));
  }
  /* ★ 2026-10-07 整句重转：这场会的字幕到底是"2 秒碎片拼的"还是"整段音频一次转的"。
   *   ▎为什么要这一行：对照实验量出来的差距很大（逐字全对 1/6 → 3/6，「服务器」被切成
   *     「服务。」+「起负载」这类错全部来自分段），但**用户那台服务器没重启就还是旧的**——
   *     而旧账本里根本没有 `ref` 字段。报 0% 而不是"没问题"，才是能用的诊断。
   *   ▸ 与「唤醒回扫」同一条设计：把"当前代码 vs 那场会跑的代码"这件事摊开，
   *     省掉一轮"我改了呀怎么还不行"的来回（坑 82/105：过期声明比缺失更糟，但缺失也要说出来）。 */
  {
    const n = m.asrCaps || 0;
    if (n < 5) add('unknown', '整句重转', `定稿只有 ${n} 条，量不出占比`);
    else {
      const pct = (100 * (m.refinedN || 0) / n).toFixed(0);
      add(m.refinedN ? 'ok' : 'warn', '整句重转',
        `${m.refinedN || 0}/${n} 条（${pct}%）由整段音频一次转写`
        + (m.refinedN ? '' : ' —— 一条都没有：要么服务器还是旧版（**重启 3001 才有**），要么 config 里 asrRefine=false'),
      );
    }
  }
  /* 这一行不评价好坏，只说明**这场会的证据属于谁**——把它放在末尾，是为了让前面每一行
   * 都带着"这是自测场还是真人场"的上下文去读（同一组延迟数字，两种场的意义完全不同）。 */
  if (m.asrCaps < 5) {
    add('unknown', '谁在说话', `定稿只有 ${m.asrCaps} 条，判不出这场是自测还是真人`);
  } else {
    const share = m.fixtureHits / m.asrCaps;
    /* ▸ 为什么分三档而不是「过半就算自测场」：真实数据里撞出一个 48% 的房间
     *   （房间 204534）——按二档它会被报成"真人场"，可那里几乎每两句就有一句是念稿。
     *   一条判据在边界上给出与直觉相反的结论，说明边界画错了位置，而不是该怪那条数据
     *   （同坑 53：判据要尺度无关，别在中间硬切）。 */
    /* 房间级覆盖**只在碎片占多数时**才参与抬档：204534 那种整场被切成「的评审会。」
     *   「我记一下，明天下午三点。」的小句，逐条判不了（<6 字有意不下结论），拼起来才看得出
     *   是念稿。少了 tinyShare 这个前提就会跑飞——真会上也有人说过那句完整请求，
     *   那不代表整场是念稿（自检 M4 就是这条反例，它是先红过一次才逼出这个前提的）。 */
    const isFake = share >= 0.5
      || (m.roomFixtureCoverage >= 0.8 && share >= 0.2 && m.tinyShare >= 0.4);   // 碎成一片的念稿才抬档
    const tag = isFake ? '自测场' : share >= 0.2 ? '混合场（有念稿成分）' : '真人场';
    add('info', '谁在说话', `${tag}：${m.asrCaps} 条定稿里 ${m.fixtureHits} 条命中 fixture 句子（${(share * 100).toFixed(0)}%）、整句拼起来 ${(m.roomFixtureCoverage * 100).toFixed(0)}% 像念稿、小碎片占 ${(m.tinyShare * 100).toFixed(0)}%`
      + (share >= 0.2 ? ' —— 这场的延迟/连续性数字**不能当"真人好用"的证据**' : ''));
  }
  /* ★ 2026-10-08（I4）共享文件这一行回答三个问题：有没有人用、用得顺不顺、有没有留下垃圾。
   *   ▎"没人上传"是 **info 不是 unknown**：这不是样本不足，是这场会确实没用这个功能——
   *     把它报成 ❔ 会让人以为仪表坏了（坑 105 的另一面：过度保守也是一种说谎）。
   *   ▎被拒 > 0 就报 warn 并把**第一条原因**摊出来：配额、房间已销毁、名字不合法
   *     三者的处方完全不同，只报"失败了 3 次"等于没说（坑 76：读数要给出能行动的信息）。 */
  {
    const up = m.fileUp || [], rej = m.fileRejected || [], del = m.fileDeleted || [], cleanup = m.fileCleanupFailed || [];
    if (!up.length && !rej.length && !del.length) {
      add('info', '共享文件', cleanup.length
        ? `没人上传文件，但清理失败 ${cleanup.length} 次（磁盘上可能留有垃圾目录）：${String((cleanup[0] || {}).reason || '').slice(0, 60)}`
        : '这场会没人上传文件（共享文件是可选功能，没用人用不是故障）');
    } else {
      const byKind = {};
      for (const e of up) {
        const ext = String(e.name || '').split('.').pop().toLowerCase();
        byKind[ext || '?'] = (byKind[ext || '?'] || 0) + 1;
      }
      const kinds = Object.keys(byKind).sort((x, y) => byKind[y] - byKind[x]).slice(0, 4)
        .map((x) => `${x}×${byKind[x]}`).join(' ');
      const bytes = up.reduce((a2, e) => a2 + (Number(e.size) || 0), 0);
      const who = {};
      for (const e of up) who[e.by || '?'] = (who[e.by || '?'] || 0) + 1;
      const top = Object.keys(who).sort((x, y) => who[y] - who[x])[0];
      let txt = `上传 ${up.length} 份（${kinds || '—'}，共 ${(bytes / 1024).toFixed(0)} KB）· 删除 ${del.length} 份`
        + (up.length ? ` · 传得最多的是「${top}」${who[top]} 份` : '');
      if (rej.length) {
        const r0 = rej[0] || {};
        txt += ` · ★ 被拒 ${rej.length} 次（第一条：${String(r0.reason || '未记原因').slice(0, 70)}｜HTTP ${r0.status || '?'}）`;
      }
      if (cleanup.length) txt += ` · 清理失败 ${cleanup.length} 次`;
      add(rej.length ? 'warn' : 'ok', '共享文件', txt);
    }
  }
  return L;
}

/* ────────── 自检：拿合成账本量这台量具准不准 ────────── */
function selftest() {
  const R = [];
  const ok = (name, pass, extra) => { R.push(pass); console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`); };
  const t0 = Date.parse('2026-10-06T08:00:00.000Z');
  const cap = (min, text, extra) => Object.assign({ ts: t0 + min * 60000, from: 'm1', name: '张三', text, asr: true }, extra || {});

  /* A. 健康的一场：10 条定稿、间隔 20~40s、延迟读数 1.2~2.6s */
  const goodCaps = [1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.4, 2.6, 1.3, 1.5].map((s, i) =>
    cap(i * 0.5, `这是第${i + 1}句足够长的话`, { fin: 'silence', lat: Math.round(s * 1000) }));
  const good = analyzeRoom(goodCaps, [
    { ts: new Date(t0 + 60000).toISOString(), event: 'asr-segment', member: 'm1', chars: 8 },
    { ts: new Date(t0 + 90000).toISOString(), event: 'asr-segment', member: 'm1', chars: 8 },
  ]);
  ok('自检 A：健康会议的延迟中位/p90 落在真实读数之间', quantile(good.lat, 0.5) >= 1400 && quantile(good.lat, 0.5) <= 2000 && good.latN === 10,
    `中位=${quantile(good.lat, 0.5)}ms n=${good.latN}`);
  ok('自检 A：健康会议不该报停摆', good.stalls.length === 0, JSON.stringify(good.stalls));
  ok('自检 A：健康会议不给"语音连续性"下坏结论',
    verdictLines(good).find((l) => l.label === '语音连续性').level === 'ok');

  /* B. 真停摆：段一直到达，字幕却空了 3 分钟 */
  const stalledCaps = [cap(0, '开场的第一句话够长了', { fin: 'silence', lat: 1500 }),
    cap(4, '四分钟之后才又出来一句', { fin: 'silence', lat: 1800 })];
  const stalledEvents = [];
  for (let i = 0; i < 20; i++) stalledEvents.push({ ts: new Date(t0 + 30000 + i * 8000).toISOString(), event: 'asr-segment', member: 'm1', chars: 4 });
  const st = analyzeRoom(stalledCaps, stalledEvents);
  ok('自检 B：段在到达却没字幕要判停摆，且报出最长空档', st.stalls.length === 1 && st.stalls[0].ms >= T.stallMs,
    `stalls=${JSON.stringify(st.stalls)}`);
  ok('自检 B：停摆的结论级别必须是 bad', verdictLines(st).find((l) => l.label === '语音连续性').level === 'bad');

  /* C. 样本不足：只有 2 条定稿时**不许**报延迟结论 */
  const thin = analyzeRoom([cap(0, '只有一句', { fin: 'silence', lat: 900 }), cap(1, '两句', { fin: 'silence', lat: 1200 })], []);
  const thinLat = verdictLines(thin).find((l) => l.label === '定稿延迟');
  ok('自检 C：样本不足时只报"不足以下结论"，不报中位数', thinLat.level === 'unknown' && !/中位/.test(thinLat.text), thinLat.text);
  /* 这一条是**被真实数据逼出来的**：房间 283648（用户抱怨"识别这么乱"那一场）只有 3 条定稿，
   * 而 8 段音频被能量闸当静音删了——旧阈值下它被判成"连续性 ✅"。
   * "没观察到停摆"在样本这么稀的场合等于"没观察到"，报绿就是给被检的东西洗白。 */
  const thinCont = verdictLines(thin).find((l) => l.label === '语音连续性');
  ok('自检 C2：字幕太稀时不许把"没观察到停摆"报成通过', thinCont.level === 'unknown', thinCont.text);

  /* D. 脏读数：max-open 定稿的 lat 是"人还在说"时量的，绝不能进延迟统计 */
  const dirty = analyzeRoom([
    cap(0, '这一句是被时长闸切断的所以读数不可信', { fin: 'max-open', lat: 18 }),
    cap(1, '这一句同样是还没停嘴就定稿了', { fin: 'gap', lat: 25 }),
  ], []);
  ok('自检 D：非 silence 定稿的读数一律不进延迟统计（哪怕它看起来是个数）', dirty.latN === 0 && dirty.finalized === 2,
    `n=${dirty.latN} fin=${JSON.stringify(dirty.finKinds)}`);

  /* E. 噪声判据与生产同源：账本里那句求赞话术要被数出来 */
  const noisy = analyzeRoom([
    cap(0, '帮我打开 请在下一个视频里面打赞,许多 clic,支持、收养、多泫,看到更多 needL FI Ching', {}),
    cap(1, '我们把评审时间定在周三下午三点', {}),
  ], []);
  ok('自检 E：噪声幻觉条数按生产判据数出来（真话不误伤）', noisy.noise === 1, JSON.stringify(noisy.noiseExamples));

  /* F. 能量闸分档：-58dB 落在"旧闸会误杀"那一档 */
  const gate = analyzeRoom([cap(0, '一句足够长的正常字幕内容', { fin: 'silence', lat: 1500 })], [
    { ts: new Date(t0).toISOString(), event: 'asr-silence-skipped', member: 'm1', peakDb: -90 },
    { ts: new Date(t0).toISOString(), event: 'asr-silence-skipped', member: 'm1', peakDb: -66 },
    { ts: new Date(t0).toISOString(), event: 'asr-silence-skipped', member: 'm1', peakDb: -58 },
    { ts: new Date(t0).toISOString(), event: 'asr-silence-skipped', member: 'm1', peakDb: -40 },
  ]);
  ok('自检 F：安静麦克风落在"旧闸会误杀"那一档（这一档就是用户报的"识别失败"）',
    gate.bands.dead === 1 && gate.bands.floor === 1 && gate.bands.oldGateWouldKill === 1 && gate.bands.loud === 1,
    JSON.stringify(gate.bands));
  const gateLine = verdictLines(gate).find((l) => l.label === '跑的是哪套阈值');
  /* 期望值是 2 不是 1：-58 与 -40 都**高于当前闸门 -62**，两条都是"当时跑的是更严的阈值"的证据
   * （第一版我按"旧闸会误杀那一档只有 1 条"写成 1，把"高于闸门的跳过"漏了——
   *   漏掉的那一条恰恰是最严重的：-40dB 被当静音删掉，说明当时的闸严到会把正常说话吞了）。 */
  ok('自检 F2：峰值在 -62dB 之上却仍被跳过 ⇒ 那场会跑的是旧阈值（"我改了你那边还不行"的答案）',
    gate.bands.oldGateWouldKill === 1 && gate.aboveGateSkipped === 2 && /旧阈值/.test(gateLine.text) && gateLine.level === 'warn',
    gateLine.text);
  /* 健康那场没有"跳过"记录 ⇒ 阈值版本**判不了**，报告要如实说判不了，
   * 而不是因为"没发现问题"就报 ✅（把"没证据"当成"证据表明没事"是这类工具最常见的腐败方式）。 */
  ok('自检 F3：没有跳过记录时阈值版本报"判不了"，不冒充通过',
    verdictLines(good).find((l) => l.label === '跑的是哪套阈值').level === 'unknown');

  /* G. 耳朵死了必须报 bad（10-04g：永久放弃 = 这个人全场没字幕） */
  const dead = analyzeRoom([cap(0, '一句足够长的正常字幕内容', { fin: 'silence', lat: 1500 })], [
    { ts: new Date(t0).toISOString(), event: 'asr-recorder-gave-up', member: 'm1', code: 3199971767 },
    { ts: new Date(t0).toISOString(), event: 'asr-recorder-respawn', member: 'm1', code: 1, idle: false },
  ]);
  const deadLine = verdictLines(dead).find((l) => l.label === '听觉进程');
  ok('自检 G：听觉进程永久放弃要报 bad', deadLine.level === 'bad');
  /* G2 ★ 2026-10-10 H2 的常驻哨兵本身要能红（这台仪表装上去那天起就该自检，
   *   否则"加了观测"与"观测在工作"是两件事——坑 107 那条自检纪律的又一次应用）。
   *   ▸ 四种形态各一条：逐行交付（ok）/ 管道成块（bad）/ 首行偏慢（warn）/ 没有样本（unknown）。
   *   ▸ 前三条只差一个字段，所以它们同时也在钉"三个数各自只影响自己的判词"——
   *     如果哪天 bytesMax 也能把结论拉成 bad 而 firstMs 不行，这里就会红。 */
  const arr = (n, over) => Array.from({ length: n }, (_, i) => Object.assign(
    { ts: new Date(t0 + i * 30000).toISOString(), event: 'asr-rms-arrival', member: 'm1',
      firstMs: 995, firstByteMs: 900, afterByteMs: 95, gapMaxMs: 315, bytesMax: 959,
      lines: 76, events: 20, voiced: 50, livedMs: 22000 }, over || {}));
  const oneCap = [cap(0, '一句足够长的正常字幕内容', { fin: 'silence', lat: 1500 })];
  const rmsOk = verdictLines(analyzeRoom(oneCap, arr(5))).find((l) => l.label === 'RMS 到达');
  ok('自检 G2a：逐行交付（管道 95ms / 单次 959B）判 ok 并写明"成块假设不成立"',
    rmsOk.level === 'ok' && /逐行交付/.test(rmsOk.text) && /n=5/.test(rmsOk.text), rmsOk.text);
  const rmsBlk = verdictLines(analyzeRoom(oneCap, arr(5, { bytesMax: 8192 }))).find((l) => l.label === 'RMS 到达');
  ok('自检 G2b：单次事件 ≥8KB ⇒ 报"成块交付仍在"（这条红就是 H2 复现的信号）',
    rmsBlk.level === 'warn' || rmsBlk.level === 'bad', rmsBlk.text);
  /* ★ 反例（10-10 真 RTP 实测逼出来的）：单次事件 2018B 是**正常形态**——流刚开始那一刻
   *   一挤就是几十行。判线若画在 2KB，每场会都会红一次，而误报的告警等于没有告警（坑 67/82）。 */
  const rmsBurst = verdictLines(analyzeRoom(oneCap, arr(5, { bytesMax: 2018 }))).find((l) => l.label === 'RMS 到达');
  ok('自检 G2b2：2018B 是实测到过的正常突发，不许被判成"成块交付"',
    rmsBurst.level === 'ok' && !/成块交付仍在/.test(rmsBurst.text), rmsBurst.text);
  /* ★ G2c 钉的是"判慢用哪个数"：afterByte 大才叫管道慢；firstMs 大只说明那一代没人开口。
   *   没有这条反例，下一个人很自然会拿 firstMs 判（它名字就叫"首行"），
   *   于是每次安静的会都报一条 warn —— 误报的告警等于没有告警。 */
  const rmsPipeSlow = verdictLines(analyzeRoom(oneCap, arr(5, { afterByteMs: 4200, firstMs: 4300 })))
    .find((l) => l.label === 'RMS 到达');
  ok('自检 G2c：音频进来后第一行仍要 4.2s ⇒ 判 warn（冷启动宽限要核对）',
    rmsPipeSlow.level === 'warn' && /4\.20s/.test(rmsPipeSlow.text) && /宽限/.test(rmsPipeSlow.text), rmsPipeSlow.text);
  const rmsIdle = verdictLines(analyzeRoom(oneCap, arr(5, { firstMs: 20230, firstByteMs: -1, afterByteMs: -1 })))
    .find((l) => l.label === 'RMS 到达');
  ok('自检 G2c2：firstMs=20230 但没有"非空分段"锚点 ⇒ 不许判管道慢，也不许凭空造数（等开口的代）',
    rmsIdle.level === 'ok' && /—/.test(rmsIdle.text) && /20\.2s|20230/.test(rmsIdle.text), rmsIdle.text);
  const rmsGap = verdictLines(analyzeRoom(oneCap, arr(5, { gapMaxMs: 9000 }))).find((l) => l.label === 'RMS 到达');
  ok('自检 G2d：行间隔最大 9s 判 bad（静音判定会卡在这里）',
    rmsGap.level === 'bad' && /长空档/.test(rmsGap.text), rmsGap.text);
  const rmsNone = verdictLines(analyzeRoom(oneCap, [])).find((l) => l.label === 'RMS 到达');
  ok('自检 G2e：没有样本时报 ❔ 并说清两种可能，不许冒充"没问题"（坑 105）',
    rmsNone.level === 'unknown' && /重启 3001/.test(rmsNone.text), rmsNone.text);
  /* ★ G2f 这台仪表认识的那个事件名，必须和生产写出来的**同一个**（坑 47 的事件名版）：
   *   两边名字漂了，报告就永远"样本不足"，而它看起来像在正常工作。 */
  const srvSrcRms = require('fs').readFileSync(path.join(__dirname, '..', 'sfu', 'server.js'), 'utf8');
  ok(/logEvent\('info', 'asr-rms-arrival'/.test(srvSrcRms)
    && /firstMs: rmsSeen\.firstAtMs, firstByteMs: rmsSeen\.firstByteAtMs/.test(srvSrcRms),
    '自检 G2f：服务器真的写 asr-rms-arrival，且字段名与复盘读的一致');
  /* G3 ★「房间可分性」也按同一条纪律自检（仪表自己必须能红，否则它只是装饰，坑 107）。
   *   ▸ 三个方向各一条：几乎没有安静窗（warn）/ 一半窗是安静的（info，不许跟着喊）/
   *     阈值正好压在 −42 硬线上（要说出"自适应此刻没起作用"——这才是可操作信息）。 */
  const sepNever = verdictLines(analyzeRoom(oneCap, arr(5, { lines: 100, voiced: 98 }))).find((l) => l.label === '房间可分性');
  ok('自检 G3a：98% 的窗被判有声 ⇒ warn 并说"静音确认可能长期不成立"',
    sepNever.level === 'warn' && /98%/.test(sepNever.text) && /静音确认/.test(sepNever.text), sepNever.text);
  const sepOk = verdictLines(analyzeRoom(oneCap, arr(5, { lines: 100, voiced: 52 }))).find((l) => l.label === '房间可分性');
  ok('自检 G3b：一半窗是安静的 ⇒ 只报事实（info），不许乱报"分不开"（误报的告警等于没有告警）',
    sepOk.level === 'info' && /52%/.test(sepOk.text) && !/长期不成立/.test(sepOk.text), sepOk.text);
  const sepClamp = verdictLines(analyzeRoom(oneCap, arr(5, { voiceThr: -42, floorMed: -44 }))).find((l) => l.label === '房间可分性');
  ok('自检 G3c：阈值中位正好压在 −42 硬线 ⇒ 明说"自适应此刻没起作用"',
    /-42/.test(sepClamp.text) && /钳住/.test(sepClamp.text), sepClamp.text);
  const sepFew = verdictLines(analyzeRoom(oneCap, arr(2))).find((l) => l.label === '房间可分性');
  ok('自检 G3d：样本 <3 代报 ❔（这条数据是 10-10 才开始记的，老账本里根本没有）',
    sepFew.level === 'unknown' && /重启 3001/.test(sepFew.text), sepFew.text);
  /* 这条是**报告自己抓出来的**：第一版把计数当数组打（`${m.crashRespawn.length}`），
   * 于是每一场会都印"其中崩溃 undefined"——一个 undefined 混进结论，读者只会整行都不再信。
   * 判据：结论文本里不许出现 undefined / NaN / [object。 */
  ok('自检 G2：结论文本里不许出现 undefined / NaN / [object（一个坏值会让人整行不信）',
    verdictLines(st).concat(verdictLines(good), verdictLines(dead))
      .every((l) => !/undefined|NaN|\[object/.test(l.text)),
    String(deadLine.text));

  /* H. 答应了却不说话：失败比成功多就是 bad */
  const mute = analyzeRoom([cap(0, '一句足够长的正常字幕内容', { fin: 'silence', lat: 1500 })], [
    { ts: new Date(t0).toISOString(), event: 'ai-tts', engine: 'edge', bytes: 20000 },
    { ts: new Date(t0).toISOString(), event: 'ai-tts-failed', roomNumber: 'x' },
    { ts: new Date(t0).toISOString(), event: 'ai-tts-failed', roomNumber: 'x' },
  ]);
  ok('自检 H：播报失败多于成功时报 bad（"它答应了却不说话"的账要算得出来）',
    verdictLines(mute).find((l) => l.label === '播报').level === 'bad');

  /* I. 碎片与重复：2s 分段把一句话切开的两种形状 */
  const frag = analyzeRoom([
    cap(0, '小明', { fin: 'silence', lat: 1500 }),
    cap(0.15, '要生成一下', { fin: 'silence', lat: 1500 }),
    cap(0.3, '既要', { fin: 'silence', lat: 1500 }),
  ], []);
  ok('自检 I：短句按碎片计数（碎片率是"识别这么乱"的量化口径）', frag.fragCount === 2 && frag.finalized === 3,
    `frag=${frag.fragCount}/${frag.finalized}`);
  /* 重复句：同一个人 15 秒内把同一句说了两遍（分段边界处最常见的形状）。
   * 判据直接调生产那一个函数（Asr.isDupOrFragment），这里只数它点了几次头。 */
  const dup = analyzeRoom([
    cap(0, '小明把计要要生成', { fin: 'silence', lat: 1500 }),
    cap(0.1, '小明把计要要生成', { fin: 'silence', lat: 1500 }),
  ], []);
  ok('自检 I2：同一个人 15s 内的重复句要数得出来（"它又在刷屏"的账）', dup.dups === 1, `dups=${dup.dups}`);

  /* J. 文件名过滤器：slice 写错一位，"最近一天"就永远筛出 0 个文件，
   *    而报告会说"今天没有会议记录"——这句话听起来完全合理，所以没人会去查它。
   *    这类"只会漏、不会错"的过滤器必须单独有一条断言。 */
  const p = parseCapName('cap-763389-20261006.jsonl');
  ok('自检 J：字幕文件名解析（房间号/日期）与坏名字拒绝',
    !!p && p.room === '763389' && p.day === '20261006' && parseCapName('cap-1-2026.jsonl') === null,
    JSON.stringify(p));

  /* K. "0/0"不是"0%"：没有定稿标记的场次，碎片率只能说"谈不上"。
   *    （真实数据里就有这一场：10-05 的 283648 报了"碎片 0/0 条（0%）✅"，
   *      而那恰恰是用户抱怨"识别这么乱"的会——把没证据当成证据，报告会替被检的东西洗白。） */
  const noFin = analyzeRoom([cap(0, '一句足够长的正常字幕内容', {})], []);
  ok('自检 K：0 条定稿时碎片率报"谈不上"而不是 0% 通过',
    verdictLines(noFin).find((l) => l.label === '断句碎片').level === 'unknown' && noFin.finalized === 0);

  /* ★ 自检 L：指令回扫（2026-10-06）。这一行不是锦上添花——它就是把规则改宽之后
   *   「把这条**记录**一下」被误判成"开录制"那次事故的常驻哨兵：
   *   四条各管一件事——正常讨论不误伤、记事求助不被拒、真祈使句要数得出来（否则
   *   这行永远绿=白装一台仪表）、样本不足时必须报 unknown 而不是"没问题"（坑 105）。 */
  const plain = [];
  for (let i = 0; i < 12; i++) plain.push(cap(i, `第${i}句正常的会议讨论内容，讲的是排期和验收标准`));
  const scanClean = analyzeRoom(plain, []);
  const scanLine = (m) => verdictLines(m).find((l) => l.label === '指令回扫');
  ok('自检 L：12 句正常讨论一律不被读成指令',
    scanClean.spokenN === 12 && scanClean.cmdAction.length === 0 && scanClean.cmdRefused.length === 0
      && scanLine(scanClean).level === 'ok', JSON.stringify({ a: scanClean.cmdAction, r: scanClean.cmdRefused }));
  const scanNote = analyzeRoom(plain.concat([cap(13, '小明，帮我把这条记录一下，明天下午三点开评审会')]), []);
  ok('自检 L：「把这条记录一下」不被当成"开录制"拒绝（真实账本里出现 11 次的那句求助）',
    scanNote.cmdRefused.length === 0, JSON.stringify(scanNote.cmdRefused));
  const scanCmd = analyzeRoom(plain.concat([cap(13, '帮我开白板')]), []);
  ok('自检 L：真祈使句会被数出来（回扫不是永远绿的仪表）',
    scanCmd.cmdAction.length === 1 && scanCmd.cmdAction[0].a === 'board-open', JSON.stringify(scanCmd.cmdAction));
  const scanThin = analyzeRoom([cap(0, '把白板打开')], []);
  ok('自检 L：人话不足 10 句时报 unknown，不报"没问题"', scanLine(scanThin).level === 'unknown');

  /* ★ 自检 N：唤醒回扫（2026-10-06 夜二）。用户那句"不提到小明的名字它就不该说话"的常驻哨兵。
   *   ▎为什么必须长在复盘里而不是语音自测里：合成 fixture 的每一句都写着「小明，…」，
   *     它**结构上测不出误唤醒**——拿"念稿音频"证明"不该说话时没说话"是自相矛盾（用户原话：
   *     "你测试的音频乱的不像话"）。只有真实账本里那些没叫它的话才是这张考卷。 */
  const wakeLine = (m) => verdictLines(m).find((l) => l.label === '唤醒回扫');
  const wakeNormal = analyzeRoom(plain.concat([cap(13, '小明，把纪要生成一下')]), []);
  ok('自检 N：13 句真人式会议发言里，只有那句真叫它的会醒',
    wakeNormal.wakeReplay.length === 1 && wakeNormal.wakeReplay[0].why === 'exact'
      && wakeLine(wakeNormal).level === 'ok', JSON.stringify(wakeNormal.wakeReplay));
  const wakeLoose = analyzeRoom(plain.concat([cap(13, '说小命的话，他是最应该听见话'), cap(14, '我买了个小米手机')]), []);
  ok('自检 N：「小命」「小米」这类日常词不算叫它（旧宽表会醒，新判据 0 次）',
    wakeLoose.wakeReplay.length === 0, JSON.stringify(wakeLoose.wakeReplay));
  /* 反向对照：真发生歧义唤醒时必须报 warn，否则这台哨兵是死的（坑 107 同一条纪律） */
  const wakeAmbig = analyzeRoom(plain.concat([cap(13, '你好 小米 下面')]), []);
  ok('自检 N：靠歧义写法+称呼语境醒时要报 warn（仪表自己能红）',
    wakeAmbig.wakeReplay.length === 1 && wakeAmbig.wakeReplay[0].why === 'ambig'
      && wakeLine(wakeAmbig).level === 'warn', wakeLine(wakeAmbig).text);
  /* 历史 vs 当前：差值要说得出口——"我改了你怎么还不行"的标准答案就是那台跑的是旧规则 */
  const wakeOld = analyzeRoom(plain.concat([cap(13, '小明，把纪要生成一下')]),
    [1, 2, 3].map(() => ({ ts: new Date(t0).toISOString(), event: 'asr-wake-answer', via: 'follow-up' })));
  ok('自检 N：旧场次"实际应答多于当前规则"要写明差值（= 修复要重启才生效）',
    wakeOld.wake === 3 && /多出的 2 次/.test(wakeLine(wakeOld).text), wakeLine(wakeOld).text);
  ok('自检 N：人话不足 10 句时报 unknown，不报"没问题"', wakeLine(scanThin).level === 'unknown');
  /* N2 字幕形态：把"三句话粘成一条"与"一句被切散"做成可对比的数（用户那句"识别不准确"的仪表） */
  const shapeLine = (m) => verdictLines(m).find((l) => l.label === '字幕形态');
  const blobCaps = plain.concat([
    cap(13, '一句被粘在一起的超长字幕内容，里面塞了三四句不相干的话，还带着标点和空格分隔符'),
    cap(14, '另一句同样很长用来把长条比例抬上去的真实形态内容，讲的是昨天那个验收没通过'),
    cap(15, '第三句也是长条，用来证明这个比例不是偶然一条撑起来的，而是这场会的普遍形态'),
  ]);
  const shapeBlob = analyzeRoom(blobCaps, []);
  ok('自检 N2：≥25 字长条占比超过 15% 要报 warn（"三句话粘成一条"必须看得见）',
    shapeBlob.shapes.filter((x) => x >= 25).length === 3 && shapeLine(shapeBlob).level === 'warn',
    shapeLine(shapeBlob).text);
  ok('自检 N2：正常一句一条的场次不许报 warn（这台仪表不能一见长句就叫）',
    shapeLine(analyzeRoom(plain, [])).level === 'ok');
  ok('自检 N2：样本不足时字幕形态报 unknown', shapeLine(scanThin).level === 'unknown');

  /* N3 ★ 2026-10-07 整句重转的生效率：这台仪表专门回答"我改了呀怎么还不行"。
   *   ▎为什么必须有反向对照：机制在代码里 ≠ 在用户那台机器上跑着（坑 76 三次应验）。
   *     旧服务器写的账本**没有 ref 字段**，如果只报"0%"而不说原因，读的人会以为功能坏了；
   *     如果 0% 也报 ok，这台哨兵就是死的。 */
  const refLine = (m) => verdictLines(m).find((l) => l.label === '整句重转');
  {
    const withRef = analyzeRoom(plain.map((e, i) => Object.assign({}, e, { ref: i < 8 ? 1 : undefined })), []);
    ok('自检 N3：多数定稿带 ref:1 时报 ok 并把分数说出来',
      refLine(withRef).level === 'ok' && /8\/\d+ 条/.test(refLine(withRef).text), refLine(withRef).text);
    const noRef = analyzeRoom(plain, []);
    ok('自检 N3：一条 ref 都没有要报 warn 并写明"重启 3001 才有"（不许报成"没问题"）',
      refLine(noRef).level === 'warn' && /重启 3001/.test(refLine(noRef).text), refLine(noRef).text);
    ok('自检 N3：样本不足时报 unknown，不报 0%', refLine(scanThin).level === 'unknown');
  }

  /* ★ 自检 P（2026-10-08，I4）：共享文件这一行——这台仪表认识新功能了没有？
   *   ▎三条都要有，缺一条这行就是摆设：
   *     ① 有上传要报得出**份数 + 类型 + 谁传的**（只报"用了"没有信息量）；
   *     ② 被拒要 **warn 且带原因**（配额 / 房间没了 / 名字不合法 处方完全不同）；
   *     ③ 没人用要报 **info「不是故障」**，而不是 unknown——
   *       "这场会没人上传文件"是一个**事实**，不是"样本不足"。把它报成 ❔ 会让人以为仪表坏了
   *       （坑 105 的另一面：过度保守也是一种说谎）。 */
  const fileLine = (m) => verdictLines(m).find((l) => l.label === '共享文件');
  {
    const ev = (name, extra) => Object.assign({ ts: new Date(t0).toISOString(), event: name, roomNumber: '123456' }, extra || {});
    const usedRoom = analyzeRoom(plain, [
      ev('file-uploaded', { name: '需求.docx', size: 200000, by: '小张' }),
      ev('file-uploaded', { name: '预算.xlsx', size: 51200, by: '小张' }),
      ev('file-uploaded', { name: '说明.md', size: 1024, by: '小李' }),
      ev('file-deleted', { name: '说明.md', by: '小李' }),
    ]);
    const fl = fileLine(usedRoom);
    ok('自检 P1：有上传 ⇒ 报份数 / 类型 / 字节 / 谁传得最多 / 删除数',
      fl.level === 'ok' && /上传 3 份/.test(fl.text) && /docx×1/.test(fl.text)
      && /196 KB|246 KB/.test(fl.text) && /小张/.test(fl.text) && /删除 1 份/.test(fl.text), fl.text);

    const rejected = analyzeRoom(plain, [
      ev('file-uploaded', { name: 'a.md', size: 10, by: '小张' }),
      ev('file-upload-rejected', { name: 'big.pptx', reason: '超过单文件上限 40.0 MB', status: 413 }),
      ev('file-upload-rejected', { name: 'b.md', reason: '房间不存在或已销毁', status: 409 }),
    ]);
    const rl = fileLine(rejected);
    ok('自检 P2：有被拒 ⇒ 报 warn 并把**第一条原因**摊出来（只报次数等于没说）',
      rl.level === 'warn' && /被拒 2 次/.test(rl.text) && /40\.0 MB|单文件上限/.test(rl.text) && /413/.test(rl.text), rl.text);

    const idleRoom = analyzeRoom(plain, []);
    const il = fileLine(idleRoom);
    ok('自检 P3：没人上传 ⇒ 报 info「不是故障」，不许报 unknown / 不许冒充通过',
      il.level === 'info' && /没人上传/.test(il.text) && /不是故障/.test(il.text), il.text);

    /* P4 跨房不串：另一间房的上传**不能**算进这场。
     *   这条不是凑数——日志是按天一个大文件、房间号还会回收复用，
     *   过滤器少写一个字段，复盘就会把上一场会的功劳算到这一场头上（坑 72 的复盘版）。 */
    const mixed = [
      ev('file-uploaded', { name: '本场.docx', size: 100, by: '小张' }),
      Object.assign(ev('file-uploaded', { name: '别场.docx', size: 100, by: '小李' }), { roomNumber: '654321' }),
    ];
    ok('自检 P4：eventsForRoom 只留这间房的（别房上传不算进来，且过滤本身可红）',
      eventsForRoom(mixed, '123456').length === 1
      && String(eventsForRoom(mixed, '123456')[0].name) === '本场.docx'
      && eventsForRoom(mixed, '654321').length === 1
      && eventsForRoom([], '123456').length === 0);
    /* P5 原先我写成 `... || true` —— 那是一条**永真的假绿**（坑 110 同族，
     *   而且是我自己刚在文档里骂过的那种）。现在它是真判据：
     *   房间销毁时清理失败（EBUSY 之类）必须单独说出来，因为它意味着**磁盘上留了垃圾**，
     *   而"这场会没人上传文件"那句 info 会把它盖掉。 */
    const cleanupRoom = analyzeRoom(plain, [ev('files-cleanup-failed', { reason: 'EBUSY: resource busy or locked' })]);
    const cl = fileLine(cleanupRoom);
    ok('自检 P5：清理失败要单独说出来（磁盘留垃圾是运维要管的事，不能被"没人用"盖掉）',
      /清理失败 1 次/.test(cl.text) && /EBUSY/.test(cl.text), cl.text);
    ok('自检 P5b：正常清理（没有失败事件）时不许凭空冒出"清理失败"（反向对照）',
      /清理失败/.test(fileLine(idleRoom).text) === false, fileLine(idleRoom).text);
    ok('自检 P5c：有上传但同时清理失败 ⇒ 两个事实都要在（不许互相顶掉）',
      /上传 1 份/.test(fileLine(analyzeRoom(plain, [
        ev('file-uploaded', { name: 'x.md', size: 10, by: '小张' }),
        ev('files-cleanup-failed', { reason: 'EBUSY' }),
      ])).text) && /清理失败 1 次/.test(fileLine(analyzeRoom(plain, [
        ev('file-uploaded', { name: 'x.md', size: 10, by: '小张' }),
        ev('files-cleanup-failed', { reason: 'EBUSY' }),
      ])).text));
  }

  /* ★ 自检 M：自测场/真人场的区分（2026-10-06）。这台复盘只回答"真人用行不行"，
   *   所以它必须能把自己跑出来的场次挑出去——挑不出去，结论就掺水。 */
  const { FIXTURE_SENTENCES } = require('./voice-fixture.js');
  const fakeCaps = [];
  for (let i = 0; i < 8; i++) fakeCaps.push(cap(i, i % 2 ? FIXTURE_SENTENCES[0] : '小明，今天的服务器负载看起来怎么样？'));
  const fakeRoom = analyzeRoom(fakeCaps, []);
  const whoLine = (m) => verdictLines(m).find((l) => l.label === '谁在说话');
  ok('自检 M：念稿场次要认得出是自测场', /自测场/.test(whoLine(fakeRoom).text) && fakeRoom.fixtureHits >= 6,
    `hits=${fakeRoom.fixtureHits}/${fakeRoom.asrCaps} · ${whoLine(fakeRoom).text}`);
  const realCaps = [];
  for (let i = 0; i < 8; i++) realCaps.push(cap(i, ['这个方案我觉得还得再压测一轮', '下午的评审我先不参加了', '把排期往后挪一周吧', '客户那边催得比较急', '预算这块要不再讨论一下', '行，那我今天回去改一下文案', '这个指标的口径谁定过', '下周给客户出一个演示'][i]));
  const realRoom = analyzeRoom(realCaps, []);
  ok('自检 M：真人开会不许被误判成自测场', /真人场/.test(whoLine(realRoom).text), whoLine(realRoom).text);
  const mixCaps = [];
  for (let i = 0; i < 8; i++) mixCaps.push(cap(i, i < 3 ? FIXTURE_SENTENCES[0] : ['这个方案还得再压测一轮', '下午的评审我不参加了', '把排期往后挪一周', '客户催得比较急', '预算要不再讨论一下'][i - 3]));
  const mixRoom = analyzeRoom(mixCaps, []);
  ok('自检 M2：四成念稿不许被报成"真人场"（边界上三档而不是二档）',
    /混合场/.test(whoLine(mixRoom).text), `hits=${mixRoom.fixtureHits}/${mixRoom.asrCaps} · ${whoLine(mixRoom).text}`);
  const fragRoom = analyzeRoom([
    cap(0, '我记一下，明天下午三点。'), cap(1, '的评审会。'), cap(2, '小明，把计要生成。'),
    cap(3, '一下，小明。'), cap(4, '帮我记一下明天下午。'), cap(5, '五三点的评审会。'),
  ], []);
  ok('自检 M3：碎成一片的念稿（房间 204534 的真实形态）要认成自测场，不许 understated 成混合场',
    /自测场/.test(whoLine(fragRoom).text), `cov=${(fragRoom.roomFixtureCoverage * 100).toFixed(0)}% · ${whoLine(fragRoom).text}`);
  const oneRealAsk = analyzeRoom([
    cap(0, FIXTURE_SENTENCES[0]),
    cap(1, '这个季度的目标我们拆成三个里程碑来看'), cap(2, '客户侧的接口文档还没给到我们'),
    cap(3, '压测环境这周五之前必须准备好'), cap(4, '预算这块还得等财务那边回话'),
    cap(5, '演示视频我回去剪一版先发群里'), cap(6, '排期往后挪一周比较稳妥'),
    cap(7, '这块的责任人我们上次不是定过了吗'),
  ], []);
  ok('自检 M4：真人会里有人**真说过**一句请求，不许被房间级覆盖抬成自测场（判据跑飞的反例）',
    /真人场|混合场/.test(whoLine(oneRealAsk).text),
    `cov=${(oneRealAsk.roomFixtureCoverage * 100).toFixed(0)}% tiny=${(oneRealAsk.tinyShare * 100).toFixed(0)}% · ${whoLine(oneRealAsk).text}`);
  const tinyRoom = analyzeRoom([cap(0, FIXTURE_SENTENCES[0]), cap(1, '两句')], []);
  ok('自检 M：定稿太少时报 unknown，不硬判', whoLine(tinyRoom).level === 'unknown');

  const pass = R.filter(Boolean).length;
  console.log(`\n自检结果: ${pass} 通过, ${R.length - pass} 失败`);
  return pass === R.length ? 0 : 1;
}

/* ────────── 主流程 ────────── */
function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) process.exit(selftest());
  const argOf = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const days = Number(argOf('--days')) || 2;
  const onlyRoom = argOf('--room');
  const top = Number(argOf('--top')) || 0;
  const asJson = argv.includes('--json');

  const files = listCaptionFiles(days).filter((f) => !onlyRoom || f.room === onlyRoom);
  const eventsAll = [];
  for (const f of listLogFiles(days)) eventsAll.push(...readJsonl(f));

  const rooms = [];
  for (const f of files) {
    const caps = readJsonl(f.file);
    const evs = eventsForRoom(eventsAll, f.room);
    const m = analyzeRoom(caps, evs);
    if (m.asrCaps === 0) continue;                 // 这场会没有服务端转写，不占版面
    rooms.push({ room: f.room, day: f.day, m });
  }
  rooms.sort((a, b) => b.m.asrCaps - a.m.asrCaps);
  const shown = top ? rooms.slice(0, top) : rooms;

  if (asJson) { console.log(JSON.stringify({ days, thresholds: T, rooms: shown }, null, 2)); return; }

  console.log(`\n════ 真实会议复盘（最近 ${days} 天，${shown.length}/${rooms.length} 场有服务端转写）════`);
  console.log(`   阈值：停摆 ≥${Math.round(T.stallMs / 1000)}s 且期间到段 ≥${T.stallMinSegments} · `
    + `延迟结论需 ≥${T.minLatencySamples} 条 silence 定稿 · 碎片 ≤${T.fragChars} 字 · `
    + `闸门档位 旧${T.gateOld}dB / 今${T.gateNow}dB`);
  if (!shown.length) {
    console.log(`\n（没有可复盘的会议。要么这几天没开过会，要么服务器还没往 ${path.relative(ROOT, CAP_DIR)}/ 落账本。）`);
    return;
  }
  const ICON = { ok: '✅', warn: '⚠️', bad: '❌', unknown: '❔', info: '·' };
  const tally = { ok: 0, warn: 0, bad: 0, unknown: 0 };
  for (const r of shown) {
    const mins = (r.m.spanMs / 60000).toFixed(1);
    console.log(`\n── 房间 ${r.room}（${r.day.slice(4, 6)}-${r.day.slice(6, 8)}）：`
      + `${r.m.asrCaps} 条定稿 / ${r.m.caps} 条入账 / ${r.m.members} 人说话 / 字幕跨度 ${mins} 分钟`);
    for (const l of verdictLines(r.m)) {
      if (l.level in tally) tally[l.level]++;
      console.log(`   ${ICON[l.level] || '·'} ${l.label}：${l.text}`);
    }
  }
  console.log(`\n── 合计：✅${tally.ok} ⚠️${tally.warn} ❌${tally.bad} ❔${tally.unknown}（❔=样本不足，**不是**"通过"）`);
  /* ★ 2026-10-06 这段"分不出来"的声明**已经过期**，所以改口：
   *   现在有了唯一一份 fixture 句子（scripts/voice-fixture.js 的 FIXTURE_SENTENCES），
   *   「谁在说话」那一行会把念稿的场次标成**自测场/混合场**。
   *   ▸ 为什么仍要把判断交给人：这个标记是**基于句子像不像念稿**的启发式，
   *     而真实会议里也有人复述同一句话；误把一场真会标成自测，
   *     比不标更容易让人忽略它（坑 82：过期声明比缺失有害，**过度自信的声明同样有害**）。 */
  console.log('   「谁在说话」按 fixture 句子把场次标为 自测场 / 混合场 / 真人场（定稿 <5 条报 ❔）。'
    + '\n   这是**启发式**：真会里有人复述同一句也可能被标；要只看某一场用 --room <房间号>。'
    + '\n   这份报告只说"账本里发生了什么"。真人开麦的体感、以及账本之外的失败（比如页面根本没刷新），它看不见。\n');
}

module.exports = { analyzeRoom, verdictLines, readJsonl, eventsForRoom, T };
if (require.main === module) main();
