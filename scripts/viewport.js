/* ═══════════════════════════════════════════════════════════════════════════
 *  viewport.js —— 「把浏览器的**布局视口**改成 w×h」的唯一实现
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎为什么要收到一处：本项目有四条检查需要"换一个屏幕宽度再量一次界面"
 *   （check:dock 扫 11 档、check:caption 的窄屏三行档、check:files 的手机形态、
 *   check:screenshare 的 390 窄高）。它们各自会做同一件事，而做错的代价是**静默量错**：
 * ▸ 用 OS 窗口尺寸（`new Cdp({windowSize:{width:w}})`）设"视口"是不行的——
 *   窗口不等于布局视口：本机实测每一档都 **−30px**，而且窗口有最小宽度，
 *   **请求 390 拿到 504**。于是"手机放不放得下"这条断言一直在一个它没要求的宽度上成立
 *   （2026-10-10 从 check:dock 量出来，见那里的 ★ 说明与 AGENTS 坑 159）。
 * ▸ 发完 `Emulation.setDeviceMetricsOverride` 立刻读也不行：覆写是异步生效的，
 *   多档连跑时会拿到**上一档**的宽度（串档）。旧写法用 `sleep(800)` 赌它生效了，
 *   而全量回归的负载下这类常数赌注就是"会移动的假红"（坑 96/120）。
 * ▸ 所以这里把两件事一起写死：**用覆写**、并且**轮询到它真的成为 w 为止**；
 *   轮询条件 = 调用方的前提断言（innerWidth === w），不是随便睡一下。
 *   返回 `{ok:false}` 时调用方**不许**继续量——拿别的宽度的读数回答这一档的问题，
 *   正是旧写法干了半年的事（坑 115：断言正确地保护了一个错误的期望）。
 * ▎跑法：不单独运行，由各 check-*.js `require('./viewport.js')`。 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} cdp  Cdp 实例（已 launch 并已拿到 pageWs）
 * @param {number} w    要求的**布局视口**宽（CSS px）
 * @param {number} h    要求的高
 * @param {object} [opts]
 * @param {boolean} [opts.mobile=false]     移动端语义（影响视口元标签与 hover 媒体查询）
 * @param {number}  [opts.deviceScaleFactor=1]
 * @param {number}  [opts.timeoutMs=6000]
 * @returns {Promise<{ok:boolean, vw:number|null, vh:number|null, tookMs:number}>}
 */
async function setViewport(cdp, w, h, opts = {}) {
  const t0 = Date.now();
  await cdp._send(cdp.pageWs, 'Emulation.setDeviceMetricsOverride', {
    width: w,
    height: h,
    deviceScaleFactor: opts.deviceScaleFactor == null ? 1 : opts.deviceScaleFactor,
    mobile: !!opts.mobile,
  });
  const deadline = t0 + (opts.timeoutMs || 6000);
  let vw = null, vh = null;
  for (;;) {
    try {
      /* 一次 evaluate 同时读宽高：分两趟的话，中间可能又插进一次别的改动。
       * 也顺带少一趟 CDP 往返（一条检查要跑十几档时这一趟并不便宜）。 */
      const r = await cdp.evaluate('({ vw: innerWidth, vh: innerHeight })');
      vw = r && r.vw; vh = r && r.vh;
    } catch (e) { /* 页面正在导航（?nosw=1 那一趟），下一拍再读 */ }
    if (vw === w) return { ok: true, vw, vh, tookMs: Date.now() - t0 };
    if (Date.now() > deadline) return { ok: false, vw, vh, tookMs: Date.now() - t0 };
    await sleep(120);
  }
}

/** 收工：清掉覆写，让这台浏览器回到它自己的尺寸。
 *  ▎为什么必须显式调：覆写是**浏览器的状态**，而 profile 目录按 CDP 端口派生并跨运行存活
 *  （坑 137 那条本机事实）——留着它，下一个用同一端口的检查首屏就是窄屏。 */
async function clearViewport(cdp) {
  try { await cdp._send(cdp.pageWs, 'Emulation.clearDeviceMetricsOverride'); } catch (e) { /* 已经没了 */ }
  try { await cdp._send(cdp.pageWs, 'Emulation.setTouchEmulationEnabled', { enabled: false }); } catch (e) { /* 同上 */ }
}

/** 一句话把"这一档到底量没量到"写成断言文本（各 check 的 ok() 直接用）。 */
function vpFail(w, got) {
  return `请求 ${w}px，实际量到 ${got === null ? '(取不到)' : got + 'px'} —— 拿这个宽度回答 ${w}px 的问题不算测到`;
}

module.exports = { setViewport, clearViewport, vpFail };
