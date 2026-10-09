/* =============================================================================
 *  sfu/public/countup.js —— 数字滚动的**纯算法**（reactbits CountUp 的零依赖移植）
 * =============================================================================
 * ▎为什么单独成文件（2026-10-06）：滚动这件事看着是"动效"，实际上处处是判据——
 *   收尾必须正好落在终值（停在 41.9 这种事在观测面板里就是"数字不准"）、
 *   进度越界不许变 NaN、减速曲线必须单调（不然观感是"来回跳"）。
 *   这些拿浏览器量很贵，拿纯函数穷举断言只要几毫秒——所以把数学抽出来，
 *   DOM/rAF 那一层留在 dashboard.html 里（同 rdDecideFps / Asr.mergeTranscript 的纪律）。
 * ▎浏览器用 window.COUNTUP；Node（单测）用 module.exports —— 一份实现两个运行时，
 *   不搞"测试里再抄一遍"那份迟早会漂（坑 47）。
 */
(function (root) {
  'use strict';

  /** 把 0~1 的进度压成 easeOutCubic：起步快、收尾稳（观感上"落到"而不是"飘到"）。 */
  function easeOutCubic(p) {
    const x = Math.min(1, Math.max(0, Number(p) || 0));   // NaN/undefined 当 0，越界钳住：绝不让 NaN 进 DOM
    return 1 - Math.pow(1 - x, 3);
  }

  /* "这个值是不是一个数"——不能只写 Number.isFinite(Number(v))：
   *   Number(null) 是 0、Number('') 也是 0，于是"没有样本"的那一格会被当成"第 0 次"，
   *   面板上就出现一个理直气壮的 0（这正是这条判据被单测逼出来的原因）。 */
  function num(v) {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return NaN;
    return Number(v);
  }

  /**
   * 这一帧该显示什么。
   * @param from 上一轮的值（可能不是数字——第一次出现时由调用方决定直接落终值，见 dashboard）
   * @param to   这一轮的目标值
   * @param progress 0~1
   * @param decimals 小数位（延迟那两格用 1，计数用 0）
   *
   * ▸ 非数字一律给**空串**（NaN / null / undefined / '' 都不例外）——这条是单测逼出来的：
   *   初版写 String(to)，于是 NaN 会变成字符串 'NaN' 进 DOM；改成 Number.isFinite(Number(to))
   *   之后，null 又被 Number(null)=0 蒙混过关。观测面板的规矩是"没有样本就显示 --，
   *   由渲染那一层决定怎么写"（坑 53/65：不许编数，也不许把 NaN 放进给人看的地方）。
   */
  function countStep(from, to, progress, decimals) {
    const t = num(to);
    if (!Number.isFinite(t)) return '';
    const f0 = num(from);
    const f = Number.isFinite(f0) ? f0 : t;
    const dec = Math.max(0, Number(decimals) || 0);
    const v = f + (t - f) * easeOutCubic(progress);
    return dec ? v.toFixed(dec) : String(Math.round(v));
  }

  const COUNTUP = { easeOutCubic, countStep, isNum: (v) => Number.isFinite(num(v)) };
  root.COUNTUP = COUNTUP;
  if (typeof module !== 'undefined' && module.exports) module.exports = COUNTUP;
})(typeof window !== 'undefined' ? window : globalThis);
