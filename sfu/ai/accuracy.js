/* ═══════════════════════════════════════════════════════════════════════════
 *  sfu/ai/accuracy.js —— 语音识别**准确率**的量具（唯一实现，零依赖，纯函数）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ▎为什么现在才加这个文件（这条线此前唯一缺的一维）
 *   延迟那一维早就有尺了：`⏱` 读数、`latMs` 拆分、`/metrics` 三读数、
 *   `review:meeting` 的碎片% 与 blob%。可"这句话转得**对不对**"到今天只有一台
 *   `npm run bench:asr`，而它数的是**关键词命中 6/9**——命中数是个下限代理信号：
 *   「产品评审会定在十月十号」只要转出「评审」两个字就算命中，
 *   剩下七个字全错也照样 3/3。于是出现了一件很糟的事：
 *     · 路线图 H3（词级天花板：大木车 / 洗地皮 / 庭审会）写着"**等用户拍板**"，
 *       可用户拿什么拍？云端 / 更大本地模型 / 靠近麦克风三条路没有一张对照表；
 *     · H8b（底噪估计偏高）与所有 dB 阈值的改动**不敢动**，
 *       因为改完只能看 blob% 变没变，看不出"听对没听对"。
 *   **没有尺的时候，任何优化都是掷骰子**——10-04 那次把 0.25s 裸基准当成"9 倍加速"
 *   就是这个道理的另一种画法（坑 75）。
 *
 * ▎本文件只做一件事：把 (期望文本, 实际文本) 变成一个可比较、可复测的数。
 *   音频怎么来、引擎怎么选、阈值怎么调，一律不归它管（那些在 bench-asr-golden.js）。
 *
 * ▎三个口径决定，全部写死在代码里并各有一条断言（口径不同的两个数不能互相比较）：
 *   ① **单位**：中文按**字**、拉丁与数字按**词**（连续字母数字算一个 token）。
 *      这是中文 ASR 的通行做法；不先说清单位，两份报告里的"CER"是两个东西。
 *   ② **归一化**：只留汉字/字母/数字，标点与空白一律不参与比对，拉丁统一小写。
 *      理由：转写自带标点（期望「明天三点」实际「明天三点。」），
 *      标点差异**不是识别错误**；算进去会让每一档虚高，且波动随模型的标点习惯走。
 *   ③ **数字不折算**：「十号」≠「10号」，默认判成错。
 *      ▸ 这是**有意的保守**，不是遗漏。折算能立刻把 CER 降下来，但它把
 *        "模型写法与人不一致"这件真实存在的事从指标里抹掉——而下游
 *        （纪要、待办抽取、指令回扫）恰好靠字面匹配。
 *        `Asr.normAsrText` 那套形近字归一**已经存在**，可那是"判意图"的口径，
 *        不是"量准确率"的口径；两套口径各管各的事（坑 47）：
 *        拿归一化之后的文本去量准确率 = 用尺子的刻度去改被测物。
 *      ▸ 想比较两种口径：`{foldDigits:true}` 显式开，且报告里必须写明开了。
 *
 * ▎诚实线（本项目老纪律，这里一条都不能松）：
 *   · 空转写**不许**报 0%——它是最差（100%），不是"没有错误"；
 *   · 期望文本为空**不进任何均值**（不可比 ≠ 全对）；
 *   · 样本量不足时合计返回 `enough:false`，由调用方打印 ❔ 而不是"通过"（坑 105）。
 *
 * ▎零依赖：只用内置 Array/String/Int32Array。不装 jiwer，不装分词器。
 * ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

/** CJK 基本区 + 扩展 A + 兼容表意：这些一字一 token。 */
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
/** 参与比对的全部字符（其余——标点、空白、符号——丢弃）。 */
const KEEP_RE = /[A-Za-z0-9\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
/** 拉丁/数字串（英文单词、"10" 这种数）：整串算一个 token。 */
const LATIN_RE = /[A-Za-z0-9]/;

/** 中文数字 → 阿拉伯数字（**默认不启用**，理由见文件头第 ③ 条）。 */
const DIGIT_FOLD = { 零: '0', 一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9', 十: '10' };

/* 分档阈值：不是"调出来的参数"，是**口径定义**，所以写死并在此说明依据。
 * · exact  —— 归一后一字不差；这是"能直接进纪要"的等级。
 * · usable ≤ 10% —— 一句 20 字最多错 2 字，人读起来仍是那句话；
 *   定在这个量级是因为本地 0.6B 的已知翻车形态（「评审会」→「庭审会」、「三点」丢尾字）
 *   单句误差就在 1~3 字，10% 能把"这种可接受的小错"与"大木车那种整词错掉"分开。
 * · 其余 poor —— 关键词命中可能仍为真，但字面已不可信。 */
const GRADE = { USABLE_MAX: 0.10 };
/** 合计结论的最小样本量：低于它不下结论（坑 53：判据要尺度无关，先看分母）。 */
const MIN_SAMPLES = 5;

/**
 * 切成参与比对的 token 序列。
 * @param {string} s
 * @param {{foldDigits?:boolean}} [opts]
 * @returns {string[]}
 */
function tokenize(s, opts = {}) {
  const out = [];
  let buf = '';
  const flush = () => { if (buf) { out.push(buf.toLowerCase()); buf = ''; } };
  for (const ch of String(s == null ? '' : s)) {
    if (opts.foldDigits && DIGIT_FOLD[ch]) { flush(); out.push(DIGIT_FOLD[ch]); continue; }
    if (CJK_RE.test(ch)) { flush(); out.push(ch); }              // 汉字：一字一 token
    else if (LATIN_RE.test(ch)) buf += ch;                        // 拉丁/数字：攒成串
    else flush();                                                 // 标点/空白：断词并丢弃
  }
  flush();
  return out;
}

/**
 * 对齐两条 token 序列并给出代价分类（Levenshtein + 回溯）。
 * 这里**保留整张 DP 表**而不做滚动数组：金标准句子几十字，
 * O(m·n) 的内存换来"能回溯分类 sub/ins/del"——分类是给人看的，
 * 而"错在哪一类"恰恰是决定下一步动谁（引擎/阈值/麦克风）的信息。
 * @returns {{n:number, sub:number, ins:number, del:number, err:number, ref:string, hyp:string}}
 */
function align(refTok, hypTok) {
  const m = refTok.length, k = hypTok.length;
  const dp = [];
  for (let i = 0; i <= m; i++) dp.push(new Int32Array(k + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= k; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= k; j++) {
      const cost = refTok[i - 1] === hypTok[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  let sub = 0, ins = 0, del = 0;
  let i = m, j = k;
  const diffRef = [], diffHyp = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (refTok[i - 1] === hypTok[j - 1] ? 0 : 1)) {
      if (refTok[i - 1] === hypTok[j - 1]) { diffRef.unshift(refTok[i - 1]); diffHyp.unshift(hypTok[j - 1]); }
      else { sub++; diffRef.unshift('' + refTok[i - 1]); diffHyp.unshift('' + hypTok[j - 1] + '≠'); }
      i--; j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      del++; diffRef.unshift(refTok[i - 1]); diffHyp.unshift('∅'); i--;
    } else {
      ins++; diffRef.unshift('∅'); diffHyp.unshift(hypTok[j - 1]); j--;
    }
  }
  return { n: m, sub, ins, del, err: dp[m][k], ref: diffRef.join(' '), hyp: diffHyp.join(' ') };
}

/**
 * 单句打分。
 * @param {string} ref 期望文本（金标准）
 * @param {string} hyp 实际转写
 * @param {{foldDigits?:boolean}} [opts]
 * @returns {{comparable:boolean, n:number, sub:number, ins:number, del:number, err:number,
 *            cer:number|null, exact:boolean, grade:'exact'|'usable'|'poor'|'unknown',
 *            ref:string, hyp:string}}
 */
function score(ref, hyp, opts = {}) {
  const r = tokenize(ref, opts), h = tokenize(hyp, opts);
  if (!r.length) {
    // 期望为空 → 无从比对。**报 unknown 而不是 0**：0% 会被下游当成"完美"（坑 105）
    return { comparable: false, n: 0, sub: 0, ins: 0, del: 0, err: 0, cer: null,
      exact: false, grade: 'unknown', ref: '', hyp: h.join(' ') };
  }
  const a = align(r, h);
  const cer = a.err / a.n;                       // 可以 >1（插入比原文还长），那是真话
  return {
    comparable: true,
    n: a.n, sub: a.sub, ins: a.ins, del: a.del, err: a.err,
    cer,
    exact: a.err === 0,
    grade: a.err === 0 ? 'exact' : (cer <= GRADE.USABLE_MAX ? 'usable' : 'poor'),
    ref: a.ref, hyp: a.hyp,
  };
}

/**
 * 一批样本的合计。
 * ▎两个平均值都必须给出，因为它们回答不同的问题：
 *   · **micro**（总编辑距离 ÷ 总期望字数）= 这批语料的错误率——业界口径，
 *     长句权重更大（错一个字在 8 字句里是 12.5%，在 40 字句里是 2.5%）；
 *   · **macro**（逐句 CER 的算术平均）= "随机一句典型句子有多准"——更贴近体感。
 *   只报一个就会漂移：同一份改动可以让一个降一个升（坑 47：两个口径各自命名，别合并）。
 * @param {Array<{ref:string, hyp:string}>} rows
 * @param {{foldDigits?:boolean}} [opts]
 */
function corpus(rows, opts = {}) {
  const per = (rows || []).map((x) => ({ ...x, s: score(x.ref, x.hyp, opts) }));
  const ok = per.filter((p) => p.s.comparable);
  const sumN = ok.reduce((a, p) => a + p.s.n, 0);
  const sumErr = ok.reduce((a, p) => a + p.s.err, 0);
  const cerVals = ok.map((p) => p.s.cer);
  const res = {
    samples: (rows || []).length,
    comparable: ok.length,
    /** 期望文本为空、被剔除的条数（它们不该进任何结论） */
    skipped: (rows || []).length - ok.length,
    microCer: sumN ? sumErr / sumN : null,
    macroCer: cerVals.length ? cerVals.reduce((a, b) => a + b, 0) / cerVals.length : null,
    exact: ok.filter((p) => p.s.exact).length,
    usable: ok.filter((p) => p.s.grade === 'exact' || p.s.grade === 'usable').length,
    poor: ok.filter((p) => p.s.grade === 'poor').length,
    sub: ok.reduce((a, p) => a + p.s.sub, 0),
    ins: ok.reduce((a, p) => a + p.s.ins, 0),
    del: ok.reduce((a, p) => a + p.s.del, 0),
    enough: ok.length >= MIN_SAMPLES,      // 低于这条不许下结论
    foldDigits: !!opts.foldDigits,         // 口径写进结果：两张表只有同口径才能比
    per,
  };
  // 最差两句：定位问题比看均值有用（哪一类词在翻车）
  res.worst = ok.slice().sort((a, b) => b.s.cer - a.s.cer).slice(0, 2);
  return res;
}

/** 百分数读数：没有样本就如实说没有，绝不打印 0% （坑 105 的形状：0÷0 会被读成通过）。 */
function pct(v) {
  return v === null || v === undefined || Number.isNaN(v) ? '—' : (v * 100).toFixed(1) + '%';
}

/**
 * 把 corpus() 收成一行给人读的报告。
 * `srcNote` 由调用方给（'合成场' / '真人场' / '混合场'）——**这台尺不猜音频是怎么来的**，
 * 那是 review:meeting 里 `looksLikeFixtureCaption()` 那份判据的职责（坑 47）。
 */
function line(name, c, srcNote) {
  const flag = c.comparable === 0 ? '❔ 无可比样本' : (c.enough ? '' : `❔ 样本仅 ${c.comparable} 句（<${MIN_SAMPLES}）不下结论`);
  return `${String(name).padEnd(14)} micro ${pct(c.microCer).padStart(7)} · macro ${pct(c.macroCer).padStart(7)}`
    + ` · 全对 ${c.exact}/${c.comparable} · 可用≤${pct(GRADE.USABLE_MAX)} ${c.usable}/${c.comparable}`
    + ` · 替换${c.sub}/插入${c.ins}/删除${c.del}`
    + ` · ${c.samples} 句${c.skipped ? `（${c.skipped} 句期望为空已剔除）` : ''}`
    + `${srcNote ? ` [${srcNote}]` : ''}${c.foldDigits ? ' [数字折算]' : ''}${flag ? ` ${flag}` : ''}`;
}

/** 两条合计之差（A/B 用）：同口径才允许比，口径不同直接拒绝——否则"改动有效"是假的。 */
function diff(a, b) {
  if (!a || !b) return null;
  if (a.foldDigits !== b.foldDigits) return { comparable: false, why: '两次口径不同（foldDigits 不一致），不许比' };
  if (!a.enough || !b.enough) return { comparable: false, why: `样本不足（${a.comparable} vs ${b.comparable} 句 <${MIN_SAMPLES}）` };
  const d = (b.microCer || 0) - (a.microCer || 0);
  return {
    comparable: true,
    microDeltaPctPoints: d * 100,
    // 1 个百分点以内的变化，在 30 句的样本量上就是噪声：不写"变好了/变坏了"
    verdict: Math.abs(d) < 0.01 ? '无显著变化' : (d < 0 ? '准确率提升' : '准确率下降'),
    from: a.microCer, to: b.microCer,
  };
}

module.exports = {
  tokenize, align, score, corpus, line, pct, diff,
  GRADE, MIN_SAMPLES,
};
