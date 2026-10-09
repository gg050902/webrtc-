/* ═══════════════════════════════════════════════════════════════════════════
 * scripts/bench-asr-golden.js —— 语音**准确率**对照跑法（H3 的那张表）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ▎它回答的问题（此前这台机器上没有任何命令能回答）：
 *   「同一批句子，换引擎 / 换音量 / 换距离，到底谁听得更对？」
 *   路线图 H3 写着"词级准确率天花板**等用户拍板**"——三条路（云端 / 更大本地模型 /
 *   靠近麦克风）没有一张对照表就拍不了。`npm run bench:asr` 数的是关键词命中 6/9，
 *   那是下限代理：「评审会」→「庭审会」只要剩下几个字还在就算命中。
 *   这里改成**字级错误率**（`sfu/ai/accuracy.js` 是唯一的口径来源），并且把
 *   "引擎 × 距离 × 增益"三个变量摆在同一张表里。
 *
 * ▎用法
 *   npm run bench:asr-golden                     默认：本地 qwen + whisper，prod 增益档
 *   npm run bench:asr-golden -- --engines=qwen-local
 *   npm run bench:asr-golden -- --gain=off       不提音量（量"麦克风本身够不够"）
 *   npm run bench:asr-golden -- --levels=far     只量"坐得远"那一档
 *   npm run bench:asr-golden -- --compare=sfu/logs/golden-xxxx.json   改动前后对比
 *
 * ▎三条纪律，写死在代码里：
 *   ① **先自证量具**：跑引擎之前，先用「ref vs ref = 0%」「ref vs 空 = 100%」两条
 *      反向对照验算尺本身；不对就立刻退出。**尺坏了，跑出来的每一格都是假的**
 *      （坑 98：量具必须能读出 0，才有资格报"在变好"）。
 *   ② **跳过必须说话**：显存不够 / 没装 whisper / 没配云端 key → 打印 SKIP + 原因，
 *      并在结论里记成"未测"，绝不当成"通过"（坑 105）。
 *   ③ **合成场如实标注**：金标准目录（`sfu/voice-golden/`）为空时用 TTS 合成语音，
 *      表头就写 [合成场]。这句话不是客套：10-03 自测 1.4s vs 真会中位 3.9s 那次，
 *      合成数据与真人数据**给过相反答案**（`review:meeting` 的同一条教训）。
 *      ▸ 录真人声音：开着服务器，浏览器打开 `/golden`（管理员），录完这张表自动变成真人场。
 *
 * ▎零依赖：只用 Node 内置 + 仓库里现成的三个模块（accuracy / asr / voice-fixture）。
 *   TTS 走 Windows 自带 System.Speech（与 test:asr / e2e 同一份实现，不另写一份）。
 * ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const Acc = require('../sfu/ai/accuracy.js');
const Asr = require('../sfu/ai/asr.js');
const Golden = require('../sfu/golden.js');   // 句子清单与真人账本的唯一来源（录制页读同一个）
const Fx = require('./voice-fixture.js');

const ROOT = path.join(__dirname, '..');
// 金标准目录的唯一来源是 sfu/golden.js（录制端与跑表端必须指向同一个地方）
const GOLDEN_DIR = Golden.GOLDEN_DIR;
const LOG_DIR = path.join(ROOT, 'sfu', 'logs');

/* ── 内置句子：唯一来源是 sfu/golden.js 的 SENTENCES ──
 * ▎不在这里再抄一份的理由与项目里每次"收成一处"完全相同：这批句子有两个读者
 *   （录制页照着念 / 本脚本在没有真人录音时合成兜底），抄两份就会出现
 *   "录的是 A 批、跑的是 B 批"，那两张 CER 表结构上不可比（坑 47）。
 *   选句标准（每句对应一个真实翻过车的形态）也写在那一份的注释里。 */
const BUILTIN = Golden.SENTENCES;

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : dflt;
};
const GAIN = flag('gain', 'prod');                       // prod = 复现生产那条增益链
const ENGINE_WANT = flag('engines', 'qwen-local,whisper').split(',').map((s) => s.trim());
const LEVELS = flag('levels', 'near,far').split(',').map((s) => s.trim());
const COMPARE = flag('compare', '');
/** "坐得远"这一档的目标峰值：-58 dBFS 是 10-05d 从真实会议日志里量到的用户电平中位。 */
const FAR_PEAK_DB = Number(flag('farPeak', '-58'));
/** 跑本地 qwen 需要的最少空闲显存（一槽实测 ≈1.9GB，再留一点余量给浏览器解码）。 */
const VRAM_NEED_MIB = 2500;

/* ──────────────────────────────────────────────────────────────
 * ①  量具自证（反向对照）——不通过就别往下跑
 * ────────────────────────────────────────────────────────────── */
function selfCheck() {
  const a = Acc.score('明天三点开会', '明天三点开会。');       // 只差标点
  const b = Acc.score('明天三点开会', '');                     // 空转写
  const c = Acc.score('', '随便转出的一句话');                  // 期望为空
  const bad = [];
  if (!(a.exact && a.cer === 0)) bad.push(`ref≈ref 应当 0%，实得 ${a.cer}`);
  if (!(b.cer === 1 && !b.exact)) bad.push(`空转写应当 100%，实得 ${b.cer}`);
  if (!(c.comparable === false && c.cer === null)) bad.push('期望为空必须判"不可比"，不许算 0%');
  // 反向对照也要能"变不出 0"：把一个真错的字塞进去，读数必须离开 0
  const d = Acc.score('产品评审会', '产品庭审会');
  if (!(d.cer > 0 && d.sub === 1)) bad.push(`一字之差应当 sub=1，实得 cer=${d.cer} sub=${d.sub}`);
  if (bad.length) {
    console.log('❌ 量具自检没过，本次不跑（尺坏了，跑出来的每一格都是假的）：');
    bad.forEach((x) => console.log('   · ' + x));
    process.exit(1);
  }
  console.log('✅ 量具自检过（0% 能读到 / 空转写判 100% / 空期望判不可比 / 一字之差判 sub=1）\n');
}

/* ──────────────────────────────────────────────────────────────
 * ②  金标准来源：真人录的（sfu/voice-golden/）优先，否则 TTS 合成
 * ────────────────────────────────────────────────────────────── */
async function loadOrSynthesize(dir) {
  /* 真人金标准优先。读取一律走 sfu/golden.js 那一个 list()——它负责
   *   "同 id 只认最后一次"（重录是常态）与"台账有、盘上没有就不列出来"（杜绝点开 404）。
   *   本脚本原来自己 parse 一遍 manifest，那会数进被重录淘汰的旧条目（坑 52：
   *   "同一份数据"必须真的是同一份）。 */
  const human = Golden.list().filter((r) => LEVELS.includes(r.dist || 'near'))
    .map((r) => ({ id: r.id, text: r.text, wav: path.join(Golden.GOLDEN_DIR, r.wav),
      level: r.dist || 'near', peakRaw: r.peakDb, why: r.why || '真人录音' }));
  if (human.length) {
    return {
      source: 'human', rows: human,
      note: `真人金标准 ${human.length} 句（sfu/voice-golden/）`,
    };
  }
  /* 合成一律走 scripts/voice-fixture.js 那**一个** makeSpeechWav（e2e / 长跑 / 自测
   *   现在共用它）。这里如果再抄一份 PowerShell TTS，就会出现"量具的语音比会议的干净"
   *   ——而这类差别恰好是 10-06 那次"合成场与真人场给出相反答案"的形状。
   *   每句单独一个子目录：那个函数开头会清空它自己的 dir（防上一次残留），
   *   共用目录会把前一句删掉。 */
  const rows = [];
  for (const level of LEVELS) {
    for (let i = 0; i < BUILTIN.length; i++) {
      const b = BUILTIN[i];
      const made = await Fx.makeSpeechWav({
        sentences: [b.text],
        dir: path.join(dir, `synth-${level}-${i}`),
        outName: 's.wav',
        tailSec: 3,          // 单句不需要 8s 尾静音（那是给"过成句闸"用的），3s 足够收尾
      });
      rows.push({ id: `${level}-${i}`, text: b.text, wav: made.file, level, why: b.why, dist: level });
    }
  }
  console.log('⚠️ 没有真人金标准（sfu/voice-golden/ 为空）→ 本次用合成语音兜底。\n'
    + '   合成语音每句都写着「小明」、电平节奏也不是真人的，所以这张表是**下限参考**；\n'
    + '   要回答"真人开会能不能用"，先开 `npm run start:sfu` 后访问 /golden 录一遍。\n');
  return { source: 'synthetic', rows, note: `TTS 合成 ${BUILTIN.length} 句 × ${LEVELS.length} 档距离（★ 合成场：下限参考，不是真人结论）` };
}

/** 把一段 16k 单声道 WAV 的峰值缩放到目标 dBFS（模拟"坐得远"）。 */
function attenuateTo(file, targetDb) {
  const { rate, pcm } = Fx.readWavPcm(file);
  const lvl = Asr.measureWavLevel(file);
  if (!lvl) throw new Error(`量不到电平：${file}`);
  const lin = Math.pow(10, (targetDb - lvl.peakDb) / 20);
  const out = Buffer.from(pcm);
  for (let p = 0; p + 1 < out.length; p += 2) {
    const s = Math.max(-32768, Math.min(32767, Math.round(out.readInt16LE(p) * lin)));
    out.writeInt16LE(s, p);
  }
  return { buf: Fx.buildWav(out, rate), peakBefore: lvl.peakDb };
}

/** 复现生产那条链：测峰值 → Asr.modelGainDb → 线性缩放写出模型实际吃到的 wav。
 *  ▎为什么必须复用 Asr.modelGainDb 而不是这里再写一遍算式：
 *    量具测的应当是**生产真正喂给模型的那份音频**，否则量出来的准确率与会议里的对不上
 *    （坑 47；也坑 68——同一概念两处实现迟早各说各话）。 */
function applyProdGain(inWav, outWav) {
  const lvl = Asr.measureWavLevel(inWav);
  const gainDb = Asr.modelGainDb(lvl ? lvl.peakDb : NaN);
  if (!gainDb) { fs.copyFileSync(inWav, outWav); return 0; }
  const { pcm } = Fx.readWavPcm(inWav);
  const tmpPcm = outWav.replace(/\.wav$/, '.pcm');
  fs.writeFileSync(tmpPcm, pcm);
  Asr.wrapPcmToWav(tmpPcm, outWav, { gainLin: Math.pow(10, gainDb / 20) });
  fs.unlinkSync(tmpPcm);
  return gainDb;
}

/* ──────────────────────────────────────────────────────────────
 * ③  引擎（逐个可用门禁 + 跳过必须说话）
 * ────────────────────────────────────────────────────────────── */
function freeVramMiB() {
  try {
    const out = execFileSync('nvidia-smi', ['--query-gpu=memory.free', '--format=csv,noheader,nounits'],
      { encoding: 'utf8', timeout: 6000 });
    return Math.max(0, ...out.split(/\r?\n/).map((l) => Number(l.trim()) || 0));
  } catch (e) { return null; }
}

async function makeEngine(name) {
  if (name === 'qwen-local') {
    const free = freeVramMiB();
    if (process.env.ASR_QWEN_LOCAL === '0') return { skip: 'ASR_QWEN_LOCAL=0（显式关掉）' };
    if (free !== null && free < VRAM_NEED_MIB) {
      return { skip: `空闲显存 ${free}MiB < ${VRAM_NEED_MIB}MiB（本机 8GB 卡上还有浏览器解码/别人的实例）` };
    }
    const L = require('../sfu/ai/asr_qwen_local.js');
    if (flag('workers', '1') !== '1') L.configure({ workers: Number(flag('workers')) });
    const ok = await L.warm();
    /* ★ 顺序要紧：失败时**先把 lastError 读出来再 kill()**。kill() 走 failPending('killed')
     *   会把真实失败原因冲掉——第一版就在这儿把自己糊成了"worker 起不来：killed"，
     *   而那条假结论会把下一次排查引向完全错误的方向（坑 27/51 家族：量具自己造的原因）。
     *   成功时**不要** kill：warm() 已经把 worker 拉起来了，留着自己用；
     *   它会在 close() 里收掉，所以两个引擎之间不会同时占着 1.9GB（10-04e 的 OOM 教训）。 */
    if (!ok) {
      const why = L.lastError || 'boot/warm 返回 false 且没留下原因';
      const slotView = JSON.stringify(L.slotStats || []);
      L.kill();
      return { skip: `${why}（槽位实况 ${slotView}）` };
    }
    const dev = L.device;
    if (free !== null) console.log(`   ℹ️ qwen-local 就位（device=${dev}，起跑前空闲显存 ${free}MiB）`);
    return {
      label: `qwen-local(${dev})`,
      run: (wav) => L.transcribe(wav, { key: 'golden-' + path.basename(wav) }),
      close: () => L.kill(),
    };
  }
  if (name === 'whisper' || name.startsWith('whisper-')) {
    const model = name.split('-')[1] || process.env.GOLDEN_WHISPER_MODEL || 'small';
    const runner = await Asr.probeWhisper();
    if (!runner) return { skip: 'whisper 没探到（npm run doctor 看 A 组）' };
    const w = Asr.createResidentTranscriber({ model, timeoutMs: 180000 });
    return { label: `whisper-${model}`, run: (wav) => w.transcribe(wav), close: () => w.kill() };
  }
  if (name === 'cloud') {
    const Q = require('../sfu/ai/asr_qwen.js');
    if (!Q.readKey()) return { skip: '没配 DASHSCOPE_API_KEY（云端那条路至今没被真响应打过一次）' };
    const okp = await Q.probe({ force: true });
    if (!okp) return { skip: 'DashScope 探测没过（.env 里的 key 或网络出口问题）' };
    return { label: `云端 ${Q.MODEL}`, run: (wav) => Q.transcribeFile(wav), close: () => {} };
  }
  return { skip: `不认识这个引擎名：${name}` };
}

/* ──────────────────────────────────────────────────────────────
 * ④  主流程
 * ────────────────────────────────────────────────────────────── */
(async () => {
  selfCheck();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asr-golden-'));
  const result = { ts: Date.now(), gain: GAIN, levels: LEVELS, foldDigits: false, textMode: 'cleaned', engines: {}, note: '' };
  try {
    const gold = await loadOrSynthesize(dir);
    result.source = gold.source;
    result.note = gold.note;
    console.log(`金标准：${gold.note}`);
    console.log(`增益档：${GAIN}${GAIN === 'prod' ? `（复现生产：目标 ${Asr.gainTargetDb()} dBFS / 上限 ${Asr.gainCapDb()} dB）` : '（原样电平）'}`);
    if (gold.source === 'synthetic') {
      console.log('提示：开着服务器，浏览器打开 /golden 录你自己的声音，这张表才会变成"真人场"结论。\n');
    }

    /* 按增益档准备"模型实际吃到的那份音频"——所有引擎共用同一份，否则不可比 */
    const feed = [];
    for (const row of gold.rows) {
      const base = path.join(dir, `base-${row.id}.wav`);
      if (row.level === 'far' && gold.source === 'synthetic') {
        const { buf, peakBefore } = attenuateTo(row.wav, FAR_PEAK_DB);
        fs.writeFileSync(base, buf);
        row.peakSource = peakBefore;    // 只是"这一档怎么造出来的"备注（TTS 原幅），不是被测电平
      } else fs.copyFileSync(row.wav, base);
      /* 「原始峰值」一律**实测 base 那一份**，不沿用合成前的数：第一版把 far 档的
         peakRaw 写成了衰减前的 -1.2 dBFS，于是表上 near 与 far 看起来一模一样，
         而模型输入那列却差 17 dB——一行自相矛盾的读数差点让我去查增益（坑 126：
         探针自己读错，会造出一条比产品缺陷更贵的假结论）。 */
      row.peakRaw = (Asr.measureWavLevel(base) || {}).peakDb;
      const modelWav = path.join(dir, `model-${row.id}.wav`);
      row.gainDb = GAIN === 'prod' ? applyProdGain(base, modelWav) : 0;
      row.feed = modelWav;
      row.peakModel = (Asr.measureWavLevel(modelWav) || {}).peakDb;
      feed.push(row);
    }

    const byLevel = {};
    for (const r of feed) (byLevel[r.level] = byLevel[r.level] || []).push(r);
    /* 档位取"实际有样本的那些"而不是配置里的 LEVELS：真人金标准只录了 near 时，
       硬跑 far 会拿空数组算出一个 null，然后被读成"这一档没问题"。 */
    const haveLevels = Object.keys(byLevel);

    for (const name of ENGINE_WANT) {
      const eng = await makeEngine(name);
      if (eng.skip) {
        console.log(`\n⏭️ ${name} —— SKIP：${eng.skip}`);
        result.engines[name] = { skip: eng.skip };
        continue;
      }
      console.log(`\n▶ ${eng.label}`);
      try {
        for (const level of haveLevels) {
          const rows = byLevel[level];
          const hyps = [];
          let ms = 0;
          for (const r of rows) {
            const t0 = Date.now();
            let raw = '';
            try { raw = String(await eng.run(r.wav) || ''); } catch (e) { raw = ''; }
            ms += Date.now() - t0;
            /* ★ 2026-10-10 量具要量**用户看到的那份文本**，不是模型刚吐出来的那份。
             *   ▎为什么这条是量具保真度而不是"顺手多加一步"：生产的每一段/每一次整句重转
             *     都要过 `Asr.cleanTranscript`（判噪、擦提示词回显、折句尾回声、纠正别字）
             *     才落账本与上屏。这一版之前直接打的是模型原始输出 ⇒
             *     任何**文本侧**的改进（今天的 foldTailEcho 就是第一个）在这张表上都是零分收益，
             *     而"改了没变化"会把人引向"那不如去换模型"——错的方向。
             *   ▸ 两列都留：raw = 模型原样（换引擎/换音频条件时看它），cleaned = 落账那份。
             *     两者不同时，表里就说出"清洗买到了几个百分点"。 */
            hyps.push({ ...r, hyp: Asr.cleanTranscript(raw), raw, ms: Date.now() - t0 });
          }
          const c = Acc.corpus(hyps.map((h) => ({ ref: h.text, hyp: h.hyp })));
          /* 第二个口径只在**读数真的不同时**才印：默认不折算「十号 vs 10号」判错，
             那是"下游字面匹配会不会踩"的口径；折算之后是"人听懂了没有"的口径。
             两个都想知道，但不许把其中一个偷偷当成结论（坑 47：分开命名，不是合并）。 */
          const cf = Acc.corpus(hyps.map((h) => ({ ref: h.text, hyp: h.hyp })), { foldDigits: true });
          const craw = Acc.corpus(hyps.map((h) => ({ ref: h.text, hyp: h.raw == null ? h.hyp : h.raw })));
          c.samples_ms = ms;
          result.engines[name] = result.engines[name] || { label: eng.label, levels: {} };
          const medPeak = (arr) => (arr.length ? arr.slice().sort((x, y) => x - y)[Math.floor(arr.length / 2)] : null);
          result.engines[name].levels[level] = {
            micro: c.microCer, macro: c.macroCer, exact: c.exact, usable: c.usable,
            microRaw: craw.microCer, macroRaw: craw.macroCer,   // 模型原样那一份（清洗前的对照）
            comparable: c.comparable, sub: c.sub, ins: c.ins, del: c.del,
            /* 把"这一档模型实际吃到的音量"一起存盘：CER 的变化只有在输入音量也记下来之后
               才可归因——否则下次看到"far 档变准了"，分不清是换了引擎还是增益钳位挪过。 */
            peakRawMed: medPeak(rows.map((r) => r.peakRaw).filter(Number.isFinite)),
            peakModelMed: medPeak(rows.map((r) => r.peakModel).filter(Number.isFinite)),
            gainedCount: rows.filter((r) => r.gainDb > 0).length,
            detail: hyps.map((h) => ({ id: h.id, ref: h.text, hyp: h.hyp, raw: h.raw, ms: h.ms })),
          };
          /* 电平两格必须印出来：这一档"模型实际吃到的音量"才是准确率差别的解释变量，
             只报"CER 高了"而不报"输入是 -36 dBFS 的耳语"，下一步就会去错改模型。 */
          const peaks = rows.map((r) => r.peakRaw).filter(Number.isFinite);
          const modelPeaks = rows.map((r) => r.peakModel).filter(Number.isFinite);
          const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN);
          console.log(`  · 档位 ${level}（${rows.length} 句）原始峰值中位 ${peaks.length ? med(peaks).toFixed(1) : '—'} dBFS`
            + ` → 模型输入中位 ${modelPeaks.length ? med(modelPeaks).toFixed(1) : '—'} dBFS`
            + `，其中 ${rows.filter((r) => r.gainDb > 0).length} 句被提过增益`);
          console.log('  ' + Acc.line(`${name}/${level}`, c, gold.source === 'human' ? '真人场' : '合成场'));
          /* ★ 清洗那一层买到多少，单独印一行（与"模型原样"同一份样本，只差过没过 cleanTranscript）。
           *   ▸ 为什么必须印出来而不是偷偷合到主数字里：主数字是"用户看到的那份文本"的准确率，
           *     而这行才说明**文本清洗**这条链值几个百分点——两者混成一个数，
           *     下次就不会有人知道该去修模型还是修清洗（第 37 步"拆分才是可操作信息"的同一条）。 */
          if (Math.abs((craw.microCer ?? 0) - (c.microCer ?? 0)) > 0.0005) {
            console.log(`      模型原样 micro ${Acc.pct(craw.microCer)} → 落账（过生产清洗）micro ${Acc.pct(c.microCer)}`
              + `（清洗这一层买到 ${(Math.abs(craw.microCer - c.microCer) * 100).toFixed(1)} 个百分点）`);
          }
          if (Math.abs((cf.microCer ?? 0) - (c.microCer ?? 0)) > 0.0005) {
            console.log(`      数字写法折算后 micro ${Acc.pct(cf.microCer)}（差 ${(Math.abs((c.microCer - cf.microCer)) * 100).toFixed(1)} 个百分点）`
              + ` —— 说明有句子的"错"主要是「十号 vs 10号」这类写法差异：人听懂了，字面匹配会踩`);
          }
          // 最差两句摊开——均值不能告诉你要改什么，具体错字才能
          c.worst.filter((w) => w.s.cer > 0).slice(0, 2).forEach((w) => {
            console.log(`      ✗ ${(w.s.cer * 100).toFixed(0)}%  期望「${String(w.ref).slice(0, 24)}」`);
            console.log(`         实得「${String(w.hyp ?? '').slice(0, 24)}」 对齐 ${w.s.ref} ↔ ${w.s.hyp}`);
          });
        }
      } finally { try { eng.close(); } catch (e) { /* 收工失败无所谓 */ } }
      await new Promise((r) => setTimeout(r, 1200));   // 给显存一点回拢时间，别和下一个引擎挤在一起
    }

    /* ── 结论区：把 H3 那个决策问题直接答出来（而不是把三行数字丢给人自己比）──
     *  ▎写这段的理由：一台只出数字的量具，最后仍要靠人决定"看哪两个数"。
     *    而"哪个引擎更准""坐远掉多少""云端有没有测到"恰好就是拍板要的那三句，
     *    所以让它自己说——但**样本不足或列缺失时必须说不成立，不许硬给结论**（坑 105）。 */
    const measured = Object.entries(result.engines).filter(([, v]) => v && v.levels);
    const rowsOf = (lv) => measured.map(([name, v]) => ({ name, ...v.levels[lv] })).filter((r) => r.micro !== null && r.comparable >= Acc.MIN_SAMPLES);
    console.log('\n结论：');
    for (const level of haveLevels) {
      const rs = rowsOf(level).sort((a, b) => a.micro - b.micro);
      if (rs.length >= 2) {
        const w = rs[rs.length - 1];
        console.log(`  · 档位 ${level}：最准 ${rs[0].name}（micro ${Acc.pct(rs[0].micro)}）`
          + `，${w.name} 差 ${(Math.abs(w.micro - rs[0].micro) * 100).toFixed(1)} 个百分点（micro ${Acc.pct(w.micro)}）`);
      } else if (rs.length === 1) {
        console.log(`  · 档位 ${level}：只有一列有数（${rs[0].name} ${Acc.pct(rs[0].micro)}）——**没有对照就不说谁更准**`);
      } else {
        console.log(`  · 档位 ${level}：可比的列不足，不下结论`);
      }
    }
    const near = rowsOf('near'), far = rowsOf('far');
    if (near.length && far.length) {
      const pick = (arr, nm) => (arr.find((r) => r.name === nm) || {}).micro;
      for (const r of near) {
        const f = pick(far, r.name);
        if (f === undefined || f === null) continue;
        console.log(`  · ${r.name} 坐远一档：${Acc.pct(r.micro)} → ${Acc.pct(f)}`
          + `（${f > r.micro ? '掉 ' + ((f - r.micro) * 100).toFixed(1) + ' 个百分点' : '没变差'}）`);
      }
    }
    const skipped = Object.entries(result.engines).filter(([, v]) => v && v.skip);
    if (skipped.length) {
      console.log('  · 本次没测到的列（**不是"没问题"，是没测**）：'
        + skipped.map(([k, v]) => `${k}（${v.skip}）`).join('；'));
    }
    if (gold.source !== 'human') {
      console.log('  · ⚠️ 整张表是合成场：每句都写着「小明」、电平节奏也不是真人的；'
        + '「坐远」那一档只是把同一份干净语音整体调小，**房间噪声与混响没有跟着进来**，'
        + '所以 far 档掉多少不能外推成"真人坐远会掉多少"。要那个答案请录 /golden。');
    }

    /* 与上一次对照（改动前后必须有同一把尺的两次读数，否则"变好了"是感觉） */    if (COMPARE && fs.existsSync(COMPARE)) {
      const prev = JSON.parse(fs.readFileSync(COMPARE, 'utf8'));
      console.log('\n与上次对照（micro CER，百分点）：');
      /* ★ 口径不同的两次读数**不许直接相减**（与 `accuracy.diff` 遇 foldDigits 不同就拒比是同一条纪律）。
       *   ▸ 为什么专门加这一段：量具从"打分模型原样"改成"打分账本里那份（过了 cleanTranscript）"，
       *     拿新读数去比旧基线，会把"量具换了口径"算成"产品变准了"——
       *     这种错最贵，因为它带着一个真实的差值（坑 47/53 的量具版）。 */
      const modeOf = (o) => (o && o.textMode) || 'raw';
      if (modeOf(prev) !== modeOf(result)) {
        console.log(`  ⚠️ 基线是「${modeOf(prev)}」口径、本次是「${modeOf(result)}」口径 —— 下面的差值**混着量具自身的改动**，`);
        console.log('     不能读成产品变好/变坏。要真比较：要么用同一口径重跑基线，要么只看本次表内"清洗买到几个点"那一行。');
      }
      for (const [name, cur] of Object.entries(result.engines)) {
        const p = prev.engines && prev.engines[name];
        if (!p || !p.levels) { console.log(`  ${name}：上次没测到，跳过`); continue; }
        for (const [level, cl] of Object.entries(p.levels)) {
          const now = cur.levels && cur.levels[level];
          if (!now) continue;
          const d = Acc.diff({ microCer: cl.micro, comparable: cl.comparable, enough: cl.comparable >= Acc.MIN_SAMPLES, foldDigits: prev.foldDigits },
            { microCer: now.micro, comparable: now.comparable, enough: now.comparable >= Acc.MIN_SAMPLES, foldDigits: result.foldDigits });
          console.log(`  ${name}/${level}: ${(cl.micro * 100).toFixed(1)}% → ${(now.micro * 100).toFixed(1)}%  ${d && d.verdict || (d && d.why) || ''}`);
        }
      }
    }

    fs.mkdirSync(LOG_DIR, { recursive: true });
    const out = path.join(LOG_DIR, `golden-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
    fs.writeFileSync(out, JSON.stringify(result, null, 1));
    console.log(`\n明细已落盘：${out}`);
    console.log('⚠️ 这个 JSON 里有句子原文。合成场无所谓；录了真人声音之后它归你管，别提交、别外发。');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Windows 上偶尔占用，下轮再清 */ }
  }
})().catch((e) => { console.error('异常:', (e && e.message) || e); process.exit(1); });
