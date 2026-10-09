#!/usr/bin/env node
/* ★ 2026-10-10（B2 / 路线图 H8b）噪声底估计的**真人分布量具**（npm run bench:voice-floor）
 *
 * ▎为什么要有这一条命令，而不是直接改 `sfu/ai/asr.js` 里那个 `silentDb=−80`：
 *   H8b 挂着的那句是"真静音（−99/−inf）不参与底噪估计 ⇒ 噪声底**系统性偏高**"。
 *   这句话当年是从推理得出的，而这条线上的推理已经错过两次
 *   （H2 的"~4KB 成块"、坑 115 的"与修前一字不差"）——所以先量，量完再说要不要动。
 *   ▸ 更关键的是**用什么样本量**：10-05e 之后立过一条纪律——
 *     "不拿合成/假设备音频调生产阈值"。今天有 20 句**真人录音**（`/golden` 录的），
 *     这是这条线第一次能拿真人分布做决定。
 *
 * ▎它到底量什么（不是准确率，是"这台机器的静音判定尺子落在哪"）：
 *   对每一份录音，用**生产那一条 ffmpeg 滤镜链**（`astats=metadata=1:reset=8` +
 *   `ametadata=print:key=lavfi.astats.1.RMS_level:file=-:direct=1`）取出 0.5s 窗的 RMS 序列，
 *   再把这条序列喂给 `Asr.createVoiceTracker` 的几种候选配置，报：
 *     floor        = 估计出来的噪声底（第 20 百分位）
 *     threshold    = 真正生效的"有人在说话"线（钳位之后）
 *     voiced%      = 有多少窗被判成有声 ← **blob（三句粘成一句）就长在这个数上**
 *     excluded%    = 被 `silentDb` 排除掉不参与估计的窗（就是 H8b 说的那一批）
 *   ▸ 报的是"这台机器上这份音频会让尺子停在哪"，不是"这份音频说了什么"（**不打印任何内容**）。
 *
 * ▎诚实边界（先写在这里，表里也会印）：
 *   ① 单句录音不是真实会议——会议里有**连续多人说话 + 房间底噪 + AGC**，
 *      这里量的是"这一句 + 它自带的尾静音"，所以它能量出**排除规则的作用方向**，
 *      不能直接外推成"真人会议里阈值该设成多少"。
 *   ② 录制时**有意关掉** AEC/降噪/AGC（`sfu/public/golden.html`），所以这批的噪声底
 *      是"这个房间本来的声音"，而不是会议里实际会送进管线的那份。
 *
 * 用法：
 *   npm run bench:voice-floor                      # 有真人金标准就跑，没有就 SKIP 并说清为什么
 *   npm run bench:voice-floor -- --variants=80,120 # 只比 silentDb=−80（现状）与 −120（全收）
 *   npm run bench:voice-floor -- --dir=sfu/voice-golden
 *   npm run bench:voice-floor -- --selftest        # 自检：合成序列必须能红（工具自己也要被验）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const Asr = require('../sfu/ai/asr.js');
const Golden = require('../sfu/golden.js');

const ROOT = path.join(__dirname, '..');

/* ── 候选配置：一条是**生产现状**，其余是要比较的变体 ──
 * ▸ 现状的 silentDb/loudCap/minSamples/... **不写在这里**：从一个不带参的 tracker 读
 *   `params`（生产默认值的唯一所有者）。这里若再抄一份 -80，生产哪天改了而量具没改，
 *   报告会继续替一个已经不存在的参数辩护（坑 47；与 modelGainDb/asrMinPeakDb 同一条纪律）。 */
const NOW_PARAMS = Asr.createVoiceTracker().params;
const VARIANTS = [
  { key: 'now', label: `现状 silentDb=${NOW_PARAMS.silentDb}`, opts: {} },
  { key: 'all', label: '全收 silentDb=−120', opts: { silentDb: -120 } },
  { key: 'strict', label: '更严 silentDb=−70', opts: { silentDb: -70 } },
];

function argvOf(name, dflt) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split('=')[1] : dflt;
}

/* ── 用生产那条滤镜链把一份 wav 变成 0.5s 窗的 RMS 序列 ───────────────────── */
function rmsSeries(wavFile, rate = 16000) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-i', wavFile,
      '-af', 'astats=metadata=1:reset=8,ametadata=print:key=lavfi.astats.1.RMS_level:file=-:direct=1',
      '-f', 'null', '-',
    ];
    const p = spawn(ffmpegBin(), args, { windowsHide: true });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += String(d); });
    p.stderr.on('data', (d) => { err += String(d).slice(-400); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0 && !out) return reject(new Error(`ffmpeg 退出 ${code}：${err || '(无输出)'}`));
      /* −inf（纯数字零）在生产里映射成 −99 —— 这里必须**同口径**，否则量的是另一套判据 */
      const vals = [...out.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)]
        .map((m) => (m[1] === '-inf' ? -99 : Number(m[1])))
        .filter((v) => Number.isFinite(v));
      resolve({ vals, rate });
    });
    /* rate 目前只用于说明窗长；序列本身的粒度由 reset=8（8 帧 × 1024 采样 @16k ≈ 0.512s）决定 */
    void rate;
  });
}

let FFMPEG;
function ffmpegBin() {
  if (FFMPEG) return FFMPEG;
  for (const c of [process.env.FFMPEG_BIN, 'ffmpeg']) if (c) { FFMPEG = c; break; }
  return FFMPEG || 'ffmpeg';
}

/* ── 把一条序列喂给某个 tracker 配置，算出五个数 ───────────────────────────
 * ▸ 为什么必须有 tail*（尾静音那一组）：`floor` 与 `threshold` 本身好看没用——
 *   真正决定体验的是**说完之后那一段**能不能被判成静音：
 *     尾静音全判"有声" ⇒ `lastVoiceTs` 一直刷新 ⇒ `silenceConfirmed` 永不成立
 *     ⇒ 句子只能等 10s 保险丝收口 ⇒ 三句不相干的话粘成一条 blob（10-07 的 H8 就是这个形状）。
 *   所以一份录音里"人已经不说话了"的那一段才是这把尺子的考场；
 *   `voicedPct`（整段平均）反而没有可操作性——说话时判有声是对的。 */
function measureOne(vals, variant, windowSize) {
  const t = Asr.createVoiceTracker({ absDb: -50, windowSize, ...variant.opts });
  /* 排除口径**从 tracker 自己问**（params），不在这里重写 -80/-30：
     重写的那一份与生产漂移时，"被排除的窗数"这个数就变成量具编的（坑 47）。 */
  const P = t.params;
  let voiced = 0; let excluded = 0; let withFloor = 0;
  const floors = []; const thrs = []; const tailVoiced = []; const tailThr = []; const headVoiced = []; const tailRms = [];
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    if (v <= P.silentDb || v >= P.loudCap) excluded += 1;
    const r = t.feed(v);
    if (r.voiced) voiced += 1;
    if (Number.isFinite(r.floorDb)) { floors.push(r.floorDb); withFloor += 1; thrs.push(r.thresholdDb); }
    /* 尾部 30%：这份录音末尾本来就带着几秒静音（金标准页面要求 ≥3s），
       所以它近似"这个人已经说完话"的那段——那一段里 `voiced` 必须是几乎全 false。 */
    if (i >= Math.floor(vals.length * 0.7)) {
      tailVoiced.push(r.voiced ? 1 : 0);
      tailThr.push(r.thresholdDb);
      tailRms.push(v);
    } else headVoiced.push(r.voiced ? 1 : 0);
  }
  const q = (arr, p) => (arr.length ? arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))] : null);
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  return {
    n: vals.length,
    excludedPct: vals.length ? excluded / vals.length : 0,
    voicedPct: vals.length ? voiced / vals.length : 0,
    /* 尾部那 30% 的窗。**不能假定它是静音**——2026-10-10 第一次跑真人金标准就撞破了这个假设：
       这些 clip 末尾的 RMS 实测 −42 dBFS（近档中位），比整段的 floor 还响，
       因为录制页是"念完按停止"，末尾剩下的就是这个房间真实的活动噪声。
       ▸ 所以 tailVoicedPct 的正确读法不是"尺子把静音判成有声=坏了"，而是
         **"这个人停下来之后，房间里还剩多少窗越得过阈值"**——它衡量的是**这个房间的可分性**，
         与尺子好坏无关。报"尾RMS"就是为了让人一眼看出这个数到底代不代表"真的安静"。 */
    tailVoicedPct: tailVoiced.length ? mean(tailVoiced) : null,
    headVoicedPct: headVoiced.length ? mean(headVoiced) : null,
    tailRmsMed: q(tailRms, 0.5),
    tailThrMed: q(tailThr, 0.5),
    /* floor 的**稳态**取第 90 百分位而不是均值：会议里"这个人停下来"那一刻用的就是
     * 窗里最安静的那批样本还在的时候——把整段的 floor 平均会把暖机期（还没攒够样本）混进来。 */
    floorP90: q(floors, 0.9),
    floorMed: q(floors, 0.5),
    thrMed: q(thrs, 0.5),
    thrMax: thrs.length ? Math.max(...thrs) : null,
    coveredPct: vals.length ? withFloor / vals.length : 0,
    deafCeil: P.deafCeil,
    silentDb: P.silentDb, quantile: P.quantile, windowSize: P.windowSize,
  };
}

const fmtDb = (v) => (v == null ? '  —  ' : `${v >= 0 ? ' ' : ''}${v.toFixed(1)}`);
const pct = (v) => `${(v * 100).toFixed(0)}%`;

function listClips() {
  const dir = argvOf('dir', null);
  if (dir) {
    const abs = path.resolve(ROOT, dir);
    const wavs = fs.existsSync(abs) ? fs.readdirSync(abs).filter((f) => f.endsWith('.wav')) : [];
    return wavs.map((f) => ({ id: f.replace(/\.wav$/, ''), dist: '?', file: path.join(abs, f) }));
  }
  try {
    /* `list()` 自带两条对账（账本里没 wav 字段的跳过、盘上没有的不列出来），
     * 所以这里拿到的每一条都保证文件真的存在——不需要我再判一次存在性。
     * ▸ wav 是**相对 GOLDEN_DIR** 的路径，直接对 ROOT 解析会指到仓库根（第一次就错在这里）。 */
    return Golden.list().map((it) => ({ id: it.id, dist: it.dist || '?', file: path.join(Golden.GOLDEN_DIR, it.wav) }));
  } catch (e) {
    return { error: e.message };
  }
}

function variantsToRun() {
  const want = argvOf('variants', null);
  if (!want) return VARIANTS;
  const keys = want.split(',').map((s) => s.trim());
  return VARIANTS.filter((v) => keys.some((k) => v.key === k || v.label.includes(k) || v.key.includes(k)));
}

/* ── 自检：合成序列。这台量具必须能红，否则它报的数字没有意义（坑 105/107 那条纪律）──
 *   ▸ 每条都写明"这个场景本来应该是什么行为"，不是"和昨天一样"（坑 115）。 */
function selftest() {
  let checks = 0; let issues = 0;
  const ok = (name, pass, extra) => {
    checks++;
    if (pass) console.log(`  PASS  ${name}${extra ? '  · ' + extra : ''}`);
    else { issues++; console.log(`  ❌ FAIL  ${name}${extra ? '  · ' + extra : ''}`); }
  };
  const speech = [-25, -24, -26, -23, -25, -27, -24, -25, -26, -23, -25, -24, -26, -25, -23, -24];
  const room = [-71, -70, -72, -70, -71, -70, -72, -71, -70, -71, -70, -72];
  const dead = Array.from({ length: 12 }, () => -99);

  /* A：纯数字零的流。现状（−80）把样本全排除 ⇒ floor 永远是 null、"自适应"整条不生效；
   *    全收（−120）则 floor=−99 但阈值被 −74 硬线钳住 ⇒ 两者最终判"无声"是一致的。
   *    ▸ 这条断言钉的是"H8b 说的偏高在这一档上**不改变行为**"——如果哪天它改变了，这里会红。 */
  const aNow = measureOne(dead, VARIANTS[0], 60);
  const aAll = measureOne(dead, VARIANTS[1], 60);
  ok('自检 A：纯静音流里两种配置的 voiced% 都是 0（差异只在 floor 有没有样本）',
    aNow.voicedPct === 0 && aAll.voicedPct === 0 && aNow.excludedPct === 1 && aAll.excludedPct === 0,
    `voiced ${pct(aNow.voicedPct)}/${pct(aAll.voicedPct)} · excluded ${pct(aNow.excludedPct)}/${pct(aAll.excludedPct)}`);
  ok('自检 A2：现状在这种流里 floor 根本没有稳态读数（自适应不生效 = H8b 的字面含义）',
    aNow.floorP90 === null && aAll.floorP90 !== null,
    `now=${fmtDb(aNow.floorP90)} all=${fmtDb(aAll.floorP90)}`);

  /* B：语音 + 房间底噪交替。两种配置都该让 floor 落在**底噪那一带**（−70 左右），
   *    并且 voiced% 与语音占比一致——这条是"排除规则没把有用样本赶走"的正向对照。 */
  const mix = []; for (let i = 0; i < 40; i++) mix.push(i % 5 === 0 ? speech[i % speech.length] : room[i % room.length]);
  const bNow = measureOne(mix, VARIANTS[0], 60);
  const bAll = measureOne(mix, VARIANTS[1], 60);
  ok('自检 B：底噪为主的流里两种配置的 floor 都落在 −75~−65（排除规则没赶走底噪样本）',
    bNow.floorP90 > -75 && bNow.floorP90 < -65 && bAll.floorP90 > -75 && bAll.floorP90 < -65,
    `now=${fmtDb(bNow.floorP90)} all=${fmtDb(bAll.floorP90)}`);

  /* C：语音为主 + 一小撮"吵房间"级别的本底（−45）。两种配置的阈值都必须被 **−42 硬线**钳住。
   *   ▸ 这一条钉的是"改排除规则不许绕过两条安全线"（坑 115 双边钳位）。
   *   ▸ 第一版我把 C 写成"90% 语音 + 10% 安静"，结果两种配置都因为"够格的样本不足 8 个"
   *     退回绝对阈值 −50，断言当场红——**红的是我对尺子的想象**：−25 那种语音本来就被
   *     `loudCap=−30` 挡在底噪池外面（比这响的不叫底噪），所以池子里只剩 5 个样本。
   *     修正后的合成必须放**足够多的 −45 本底**，才是"吵房间"这个场景。 */
  const loud = []; for (let i = 0; i < 40; i++) loud.push(-25);
  for (let i = 0; i < 10; i++) loud.push(-45);
  const cNow = measureOne(loud, VARIANTS[0], 60);
  const cAll = measureOne(loud, VARIANTS[1], 60);
  ok('自检 C：吵房间（−45 本底够多）时两种配置的阈值都被 −42 钳住（改排除规则不许绕过安全线）',
    Math.abs(cNow.thrMax - cNow.deafCeil) < 0.01 && Math.abs(cAll.thrMax - cAll.deafCeil) < 0.01,
    `thrMax now=${fmtDb(cNow.thrMax)} all=${fmtDb(cAll.thrMax)} 线=${fmtDb(cNow.deafCeil)}`);

  /* D：样本不足不许猜（暖机期）。8 个样本之前 floor 必须是 null。 */
  const d = measureOne(speech.slice(0, 5), VARIANTS[0], 60);
  ok('自检 D：样本不足时 floor=null（少于 8 个样本不猜噪声底）', d.floorP90 === null, `covered=${pct(d.coveredPct)}`);

  /* E ★ 这台量具自己的**主判据**必须能红：尾静音被误判成有声 = 静音确认永不成立 = blob。
   *   ▸ 正向：语音 12 窗 + 房间底噪 40 窗（底噪 −70，安静到不会被判有声）⇒ 尾部误判必须 ≈0。
   *   ▸ 反向（故意造一个坏尺子）：marginDb=−80 ⇒ 阈值 = floor−80 ⇒ 底噪也被判"有声"，
   *     tailVoicedPct 必须显著 >0——**量具读得出 0 也读得出 1，它报的数才有资格当结论**（坑 98）。 */
  const talkThenQuiet = speech.slice(0, 8).concat(Array.from({ length: 40 }, (_, i) => -70 + (i % 3) * 0.5));
  const eOk = measureOne(talkThenQuiet, VARIANTS[0], 60);
  ok('自检 E1：说完之后的房间底噪必须被判成静音（尾部误判 ≈0）',
    eOk.tailVoicedPct !== null && eOk.tailVoicedPct < 0.05, `尾窗判有声 ${pct(eOk.tailVoicedPct)}`);
  const eBad = measureOne(talkThenQuiet, { key: 'bad', label: '故意坏的尺子', opts: { marginDb: -80 } }, 60);
  ok('自检 E2：反向对照——阈值故意压到 floor−80 时尾部必须全被误判成"有声"（量具能读出 1）',
    eBad.tailVoicedPct > 0.9, `尾窗判有声 ${pct(eBad.tailVoicedPct)}（应当接近 100%）`);

  console.log(`\n自检结果: ${checks - issues}/${checks} 通过，${issues} 失败`);
  process.exit(issues > 0 ? 1 : 0);
}

async function main() {
  if (process.argv.includes('--selftest')) return selftest();
  const clips = listClips();
  const win = Number(argvOf('window', 60));
  const vs = variantsToRun();
  console.log('\n═══ 噪声底估计的真人分布（H8b / B2）═══');
  console.log(`窗长 0.512s（astats reset=8 @16k）· tracker 窗口=${win} 样本 · 分位=20% · 钳位=[−74, −42]`);
  if (clips && clips.error) { console.log(`SKIP：读金标准失败 —— ${clips.error}`); return; }
  if (!clips || !clips.length) {
    console.log('SKIP：没有真人金标准可量（`/golden` 还没录音，或 --dir 指的目录里没有 .wav）');
    console.log('     ▸ 跳过必须说话：这一行**不是**"没问题"，是"这一条结论还没数据支撑"（坑 105）。');
    return;
  }
  console.log(`样本：${clips.length} 份真人录音（近/远两档）· 判据与生产同源（Asr.createVoiceTracker）\n`);
  const rows = [];
  for (const c of clips) {
    let vals;
    try { vals = (await rmsSeries(c.file)).vals; } catch (e) { console.log(`  ⚠️ ${c.id} 取 RMS 失败：${e.message}`); continue; }
    if (vals.length < 4) { console.log(`  ⚠️ ${c.id} 窗数太少（${vals.length}），跳过`); continue; }
    const per = {};
    for (const v of vs) per[v.key] = measureOne(vals, v, win);
    rows.push({ id: c.id, dist: c.dist, n: vals.length, per });
  }
  if (!rows.length) { console.log('SKIP：所有样本都没能取出 RMS（ffmpeg 不可用？）'); return; }

  const line = (r) => vs.map((v) => {
    const m = r.per[v.key];
    /* 尾静音那一格才是结论所在的列：整段 voiced% 高不代表尺子坏了（说话时判有声是对的），
       **说完之后还判有声**才意味着静音确认永远不会成立（= blob）。 */
    return `floor${fmtDb(m.floorP90)} 阈${fmtDb(m.thrMed)} 语音${pct(m.headVoicedPct || 0)} 尾RMS${fmtDb(m.tailRmsMed)} 尾误判${pct(m.tailVoicedPct || 0)}`;
  }).join('  |  ');
  console.log('份号              档   窗数   ' + vs.map((v) => v.label.padEnd(56)).join('  |  '));
  for (const r of rows) {
    console.log(`${r.id.padEnd(16)} ${String(r.dist).padEnd(4)} ${String(r.n).padStart(5)}   ${line(r)}`);
  }

  /* 汇总：按档取 floor 的**中位**、平均有声占比、**末尾窗被判定成有声的平均比例的占比** */
  const agg = (dist) => {
    const set = rows.filter((r) => r.dist === dist);
    if (!set.length) return null;
    const med = (arr) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)];
    const out = { n: set.length };
    for (const v of vs) {
      const f = set.map((r) => r.per[v.key].floorP90).filter((x) => Number.isFinite(x));
      const tv = set.map((r) => r.per[v.key].tailVoicedPct).filter((x) => Number.isFinite(x));
      const hd = set.map((r) => r.per[v.key].headVoicedPct).filter((x) => Number.isFinite(x));
      const tr = set.map((r) => r.per[v.key].tailRmsMed).filter((x) => Number.isFinite(x));
      out[v.key] = {
        floorMed: f.length ? med(f) : null,
        floorN: f.length,
        voiced: set.reduce((a, r) => a + r.per[v.key].voicedPct, 0) / set.length,
        excluded: set.reduce((a, r) => a + r.per[v.key].excludedPct, 0) / set.length,
        tailVoiced: tv.length ? tv.reduce((a, b) => a + b, 0) / tv.length : null,
        head: hd.length ? hd.reduce((a, b) => a + b, 0) / hd.length : null,
        tailRms: tr.length ? tr.slice().sort((x, y) => x - y)[Math.floor(tr.length / 2)] : null,
        tailWorst: tv.length ? Math.max(...tv) : null,
      };
    }
    return out;
  };
  console.log('\n── 按距离档汇总（floor 中位 / 整段有声 / **尾静音被误判成有声** / 最差那一份）──');
  for (const dist of [...new Set(rows.map((r) => r.dist))]) {
    const a = agg(dist); if (!a) continue;
    console.log(`  档 ${String(dist).padEnd(6)} n=${a.n}  ` + vs.map((v) => {
      const x = a[v.key];
      return `${v.label}: floor ${fmtDb(x.floorMed)}dB(n=${x.floorN}) 语音命中 ${pct(x.head)} `
        + `尾RMS ${fmtDb(x.tailRms)} 尾误判 ${x.tailVoiced === null ? '—' : pct(x.tailVoiced)} `
        + `最差 ${x.tailWorst === null ? '—' : pct(x.tailWorst)} 排除 ${pct(x.excluded)}`;
    }).join('  |  '));
  }

  const a = agg(rows[0].dist);
  if (a) {
    const nowFloor = a[VARIANTS[0].key].floorMed;
    const allFloor = a[VARIANTS[1].key].floorMed;
    const delta = Number.isFinite(nowFloor) && Number.isFinite(allFloor) ? nowFloor - allFloor : null;
    console.log('\n── 判词（结论不许越过它自己的证据）──');
    if (delta === null) {
      console.log('  两种配置有一种根本没给出稳态 floor ⇒ 说明在这批样本上"自适应"整条没生效，');
      console.log('  这本身就是 H8b 的证据；但**先补能生效的样本**（带房间底噪的段落），再谈阈值该挪到哪。');
    } else if (Math.abs(delta) < 1.5) {
      console.log(`  floor 差 ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}dB（<1.5dB）⇒ 排除 −99 这件事在这批真人样本上`);
      console.log('  **几乎不改变尺子的位置**（钳位线 −74/−42 已经把两端接管了）。');
      console.log('  ⇒ H8b 应结案为"量过、影响在钳位噪声内"，而不是继续挂着当"待修的偏差"。');
    } else {
      console.log(`  floor 差 ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}dB ⇒ 排除规则**真的**在挪尺子。`);
      console.log('  但改之前必须先回答："它挪的是该挪的那一档，还是把安静用户往迟钝方向挪？"（坑 91/115）');
      console.log('  ⇒ 动 `silentDb` 的同时要跑 `bench:asr-golden --compare` 证明 CER 不变差。');
    }
    console.log('  ⚠️ 这批样本是"单句 + 念完就按停止、关掉 AEC/NS/AGC"，末尾**不是静音**；');
    console.log('     真实会议还有连续多人 + AGC 顶起的底噪，**最终阈值要在 review:meeting 的真人账本上定**。');
  }

  /* ★ 第二段判词：**这间房到底分不分得开**（与"排除规则"无关的另一件事，也是这次跑出来的真发现）。
   *   ▎为什么单独一段：第一版跑完我只看见"尾窗判有声 64%"，差点据此判"尺子坏了"。
   *     把尾 RMS 一起打出来之后才看清：近档末尾的 RMS 中位是 **−42 dBFS**，
   *     而 floor 也才 −49.7 —— 这个人停下来之后房间并不安静，
   *     于是"有多少窗被判有声"这个数字**衡量的不是判据好坏，而是这个房间的可分性**。
   *   ▸ 所以动阈值之前要先回答："这个房间有没有一个安静态可以量？"没有的话，
   *     任何 margin/分位/排除规则的改动都只是在一团糊的数据上挪刀（坑 91/115 同一条）。 */
  const nowKey = VARIANTS[0].key;
  const separable = rows.map((r) => ({ d: r.dist, tail: r.per[nowKey].tailRmsMed, thr: r.per[nowKey].tailThrMed, floor: r.per[nowKey].floorP90 }))
    .filter((x) => Number.isFinite(x.tail) && Number.isFinite(x.thr));
  if (separable.length) {
    const worse = separable.slice().sort((a, b) => (b.tail - b.thr) - (a.tail - a.thr))[0];
    const over = worse.tail - worse.thr;
    console.log('\n── 这个房间分不分得开 ──');
    console.log(`  最差的一份（档 ${worse.d}）：尾窗 RMS ${fmtDb(worse.tail)}dB vs 阈值 ${fmtDb(worse.thr)}dB ⇒ `
      + (over > 0 ? `**尾巴本来就比阈值响 ${over.toFixed(1)}dB**（不是尺子坏了，是这个人停下之后房间仍在响）`
        : `尾巴比阈值安静 ${(-over).toFixed(1)}dB（可分）`));
    console.log('  ▸ 含义：判"要不要动阈值"之前，先确认数据里存在一个"安静态"可量；');
    console.log('     不存在时，改 margin/分位/排除规则都只是在一团糊上挪刀（坑 91/115）。');
  }
}

main().catch((e) => { console.error(`量具失败：${e.stack || e.message}`); process.exit(1); });
