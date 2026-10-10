#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 *  check-dock-fit.js —— 控制坞在真实视口宽度下"一排都看得见"的回归
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎为什么值得单开一条命令：控制坞是**唯一一个每加一个功能就变宽一点**的控件，
 *   而它一旦放不下，代价不是"难看"，是**右边的按钮没人能找到**（省流/表情/字幕/白板
 *   全在一条几乎看不见的横向滚动条后面）。这类缺陷冒烟测不出（假 DOM 没有布局引擎），
 *   截图也看不出（一张图只有一个宽度），只有把一排真实视口宽度扫一遍才会现形。
 * ▎本轮就是这么做才量出来的：1890px 视口下坞需要 1708px、可视 1528px ——
 *   连 1920 的屏都放不下，所以这不是"小屏适配问题"，是"从来没适配过"。
 * ▎跑法：npm run check:dock（先起 npm run start:sfu）
 * ▎判据：① 这一档真的量到了它自己（**前提断言**，2026-10-10 新增）；② 坞自己不横向溢出；
 *   ②b 整页没有横向溢出（2026-10-10 新增，理由见下面第二条 ★）；
 *   ③ 字幕条不被坞压住；④ 每颗按钮都有可访问名。
 *
 * ★ 2026-10-10 量具瘦身（路线图 D3）顺手抓到的两件事，都比"省 40 秒"值钱：
 * ▸ **① 旧写法从来没量到过 390。** 它是"每档起一台浏览器 + `windowSize:{width:w}`"，
 *   而 **OS 窗口不等于布局视口**：实测每一档都 −30px（请求 1920 → 量到 1890、
 *   1366 → 1336…，上面那句"1890px 视口下"就是这么来的），最窄那一档更离谱——
 *   **请求 390，量到 504**（Edge 的窗口有最小宽度，小于它就钳住）。
 *   于是"手机形态放不放得下"这条被当成在测的断言，一直在 504px 上回答 390px 的问题，
 *   而且**绿得毫无可疑**（坑 115 的形状：断言正确地保护了一个错误的期望）。
 *   现在改成"一台浏览器 + `Emulation.setDeviceMetricsOverride`"（与 check:files 第 15b 节
 *   同一手法），覆写出来的就是**布局视口**；并新增那条前提断言——
 *   覆写没生效、被钳住、或将来有人改回窗口尺寸，都会**当场点名**，而不是静默偏移 30px。
 *   ▸ 顺带把 11 次浏览器冷启动（实测每次 ≈4.5s，本机最慢一次 8~19s）省成 1 次：
 *     全量 check:all 的时间成本已经影响到"一晚能跑几轮"，这是 D3 的立项理由。
 * ▸ **② "坞不溢出"在坞拆成两行之后变成了永绿断言。** 坞现在会 `flex-wrap`，
 *   放不下就换行而不是横向溢出 ⇒ `scrollWidth == clientWidth` **恒成立**
 *   （本次实测 11 档全相等：1207/1207、974/974、621/621…）。
 *   它当年确实量出过 1708 > 1528（一行时代），今天什么都测不到。
 *   正解不是删掉它（留着仍能抓"单颗按钮比容器宽"那种畸形），而是补上
 *   **现在真正会坏的那个量**：整页有没有横向溢出
 *   （`documentElement.scrollWidth ≤ clientWidth`）——坞放不下时用户看到的是"页面能左右拖"，
 *   而那只在这一层看得见。两条各答一个问题，不合并（坑 47 的反面用法：
 *   名字相近不等于同一个概念）。 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Cdp } = require(path.join(__dirname, '..', 'agent', 'cdp.js'));

const URL_ = (process.env.CHECK_URL || 'http://localhost:3001/') + '?nosw=1';
const WIDTHS = (process.env.WIDTHS || '1920,1600,1440,1366,1280,1152,1024,960,860,760,390')
  .split(',').map((n) => Number(n)).filter(Number.isFinite);
/* 视口高度：旧写法是 `windowSize:{height:860}`，而 OS 窗口高不等于布局视口高；
   覆写之后这个数就是**真的** innerHeight（判据里"字幕条不被压住"依赖竖向空间）。 */
const VP_H = Number(process.env.VP_HEIGHT) || 860;
const results = [];
const ok = (name, pass, extra) => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 量一把：进"已经在开会"的形态，再读坞与字幕条的真实盒子。
   单独抽成常量是因为它现在要在"重试"里被用两次。 */
const PROBE = `(function(){
  for (const id of ['authOverlay', 'prejoin', 'roomPanel']) {
    const e = document.getElementById(id); if (e) e.classList.add('hidden');
  }
  const dock = document.querySelector('.controls');
  const cap = document.querySelector('.caption-bar');
  /* 字幕条平时是 hidden（没开字幕）。这里显式打开来量重叠——
     不打开就等于"没测"，而重叠恰恰只在它俩都上屏时才会发生。 */
  if (cap) {
    cap.classList.remove('hidden');
    const t = cap.querySelector('.caption-text');
    if (t) t.textContent = '这是一句用来占位的字幕';   // 只填正文，不整写 textContent（会清掉同排按钮）
  }
  const d = dock.getBoundingClientRect();
  const rows = Array.from(dock.querySelectorAll(':scope > .ctl-row'))
    .filter((r) => r.getBoundingClientRect().height > 0).length;   // 有几行是有内容的
  const out = { vw: innerWidth, vh: innerHeight, need: dock.scrollWidth, vis: dock.clientWidth,
                dockH: Math.round(d.height), rows,
                /* ★ 2026-10-10：坞会换行，所以"坞自己"永远不会横向溢出；
                   放不下时的真实表现是**整页**能左右拖。这两格量的就是那件事。 */
                docNeed: document.documentElement.scrollWidth,
                docVis: document.documentElement.clientWidth,
                dockLeft: Math.round(d.left), dockRight: Math.round(d.right),
                dockTop: Math.round(d.top), capBottom: -1, overlap: false, nameless: [] };
  /* ★ 第 46 步：小屏那条规则会把按钮文字收掉（display:none 的内容不进可访问性树），
     所以这里顺手量"有没有哪颗按钮既没可见文字、也没 aria-label"。
     桌面档文字是可见的 → 天然为空；窄屏档才是这条断言真正在管的地方。 */
  for (const b of dock.querySelectorAll('.btn')) {
    const label = b.querySelector('.pill-rise__label:not(.pill-rise__label--hover)') || b;
    const txt = String(label.textContent || '').trim();
    const visible = txt && getComputedStyle(b.querySelector('span') || b).display !== 'none';
    if (!visible && !String(b.getAttribute('aria-label') || '').trim()) {
      out.nameless.push(b.id || String(b.className).split(' ')[0]);
    }
  }
  if (cap && !cap.classList.contains('hidden')) {
    const c = cap.getBoundingClientRect();
    out.capBottom = Math.round(c.bottom);
    out.overlap = c.bottom > d.top + 1;                      // 字幕条底边压进坞里
  }
  return out;
})()`;

/* ★ 2026-10-04 教训（本轮真实踩到）：同一台机器上连跑两条检查，一条量到 aria-label 齐全、
 *   另一条例条为空 —— 差别不是代码，是**这一条没做版本指纹**，撞上了 Service Worker
 *   缓存的旧构建（坑 40）。所以：任何"量界面"的检查，开头都必须先证明
 *   "我量的是现在这份代码"，否则它测的是缓存，而且绿得毫无可疑。 */
const FINGERPRINT = `(async () => {
  const js = await (await fetch('client.js', { cache: 'no-store' })).text();
  const css = await (await fetch('style.css', { cache: 'no-store' })).text();
  return { js: js.includes('syncAriaNames') && js.includes('pillRiseShell') && js.includes('initBottomStackVar'),
           css: css.includes('.bottom-stack') && css.includes('.ctl-row'),
           page: { aria: !!(document.getElementById('leaveBtn') || {}).getAttribute,
                   risen: !!document.querySelector('.controls .btn.pill-rise') } };
})()`;

/* ▸ 等页面**停稳**之后再量（10-04 全量跑时被这条救回来的）：
 *   地址带 `?nosw=1` 时页面可能自己跳一趟（注销 Service Worker 后 replace 到去掉 nosw 的地址），
 *   evaluate 落在跳转那一刻就是 "Inspected target navigated or closed"。
 *   旧写法每档一台浏览器、11 台里每台都有机会撞上这一跳；
 *   ★ 2026-10-10 改成一档一次覆写之后，撞上的机会从 11 次降到"覆写与读值之间"那一瞬，
 *   但**没有归零**，所以这层重试照留（下面的轮询次数哨兵会说明到底有没有还在跳）。
 *   ▎治法两层，缺一不可：① client.js 改成"没什么可清就不跳转"（根因，见那里的 ★ 2026-10-04）；
 *     ② 这里不假设"加载完 == 稳定"，取值失败就重试到停（否则真需要跳转的那次运行仍然会假红）。
 *     只做②会把缺陷留在产品里；只做①则量具还在跟"会变的时间"赛跑。 */
/* 轮询计数：第一档只轮了 1 轮就取到值 = 页面根本没自我导航（正是 10-04 client.js 那一改的
   可观测后果）；轮了多轮说明 nosw=1 仍然在跳——那时这条检查随时可能撞在自己的跳转上。
   ▸ 声明写在函数**之前**：顶层那串调用有顺序依赖，函数虽然晚执行，
     但把 let 写在用到它的东西后面是本项目踩过三次的形状（坑 69），能避就避。 */
let settledRounds = 0;
async function evalSettled(cdp, expr, ms = 12000) {
  const deadline = Date.now() + ms;
  let last = '页面始终没取到值';
  for (;;) {
    settledRounds += 1;
    try {
      return await cdp.evaluate(expr);
    } catch (e) { last = String((e && e.message) || e); }
    if (Date.now() > deadline) throw new Error(last);
    await sleep(300);
  }
}

/* ★ 2026-10-09 注入浏览器之前先让同一个引擎读一遍这些串。
 *   模板字符串**内部**的注释里只要出现反引号，模板就被提前截断——源文件语法没错、node --check 全过，
 *   错在拼出来的那段代码；到浏览器里炸的时候，本脚本一条断言都没跑到（详见 scripts/inject-check.js 头部）。 */
require('./inject-check.js').assertCompiles(__filename, { PROBE });

/* 把**布局**视口改成 w×h，并等到它真的变成 w 为止。
 * ▎为什么要"等"：覆写是异步生效的，发完立刻读会拿到上一档的宽度（11 档连跑就会串档）。
 * ▎轮询条件 = 下面那条前提断言的条件（innerWidth === w）——坑 120 的纪律：
 *   轮"因"不轮"果"就会读到中间态，然后红一个不存在的产品缺陷。
 * ▸ 返回 ok:false 时**不许**继续量：拿 504 的读数回答 390 的问题，正是旧写法干了半年的事。 */
async function setViewport(cdp, w, h) {
  await cdp._send(cdp.pageWs, 'Emulation.setDeviceMetricsOverride',
    { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  const deadline = Date.now() + 6000;
  let vw = null;
  for (;;) {
    try { vw = await cdp.evaluate('innerWidth'); } catch (e) { /* 页面正在导航，下一拍再读 */ }
    if (vw === w) return { ok: true, vw };
    if (Date.now() > deadline) return { ok: false, vw };
    await sleep(120);
  }
}

(async () => {
  /* ★ 2026-10-10：一台浏览器跑完 11 档（旧写法每档起一台，11 次冷启动占去整条检查的大半时间）。
     profile 目录按 CDP 端口派生（agent/cdp.js:117），开跑前删掉自己那一档
     （坑 72/137：**回归结果不该依赖"上一次跑没跑干净"**——上一轮留下的 SW/缓存
     会决定"这一轮要不要为 ?nosw=1 自己跳一趟"）。 */
  const port = Number(process.env.WB_CDP_PORT) || 9340;
  try {
    fs.rmSync(path.join(os.tmpdir(), 'wb-remote-desktop-profile-' + port),
      { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
  } catch (e) { /* 删不掉不致命：最多是多等一轮 */ }
  const cdp = new Cdp({ headless: true, startUrl: URL_, port,
    windowSize: { width: 1400, height: VP_H } });
  await cdp.launch();
  await cdp.waitForLoad(15000);

  /* 版本指纹：只做一次（旧写法每档做一次，那是 11 次 no-store 拉两份源码）。
     没有这一步，"界面读起来正常"完全可能是 SW 缓存的上一版（坑 40）。 */
  let fpv = null;
  try {
    fpv = await evalSettled(cdp, FINGERPRINT);
  } catch (e) {
    fpv = { err: String((e && e.message) || e) };
  }
  ok('页面加载的是**当前** client.js/style.css（不是 SW 缓存的上一版）',
    !!(fpv.js && fpv.css && fpv.page && fpv.page.risen),
    fpv.err ? fpv.err : `js=${fpv.js} css=${fpv.css} 已装升起外壳=${fpv.page.risen}`);
  if (!(fpv.js && fpv.css && fpv.page && fpv.page.risen)) {
    console.log('\n   服务器没在跑，或页面吃的是缓存（检查开头已带 ?nosw=1，仍出现请清 profile）');
    cdp.kill(); process.exit(1);
  }
  /* 哨兵：干净 profile + "没什么可清就不跳转"那一版 client.js 下，
     指纹这一趟应当正好 1 轮。多于 1 轮 = 页面仍在为 ?nosw=1 自己跳一趟，
     那时"某一档量不到"是量具在跟自己赛跑，不是代码缺陷（两种病必须分得开）。 */
  ok('干净 profile 下 ?nosw=1 不再让页面自己跳一趟（检查不用跟自己的导航赛跑）',
    settledRounds <= 1, `evalSettled 轮询了 ${settledRounds} 轮（指纹这一趟应当正好 1 轮）`);

  try {
    for (const w of WIDTHS) {
      const v = await setViewport(cdp, w, VP_H);
      if (!v.ok) {
        ok(`${w}px：这一档真的量到了它自己（覆写生效、没被窗口最小宽度钳住）`, false,
          `innerWidth=${v.vw} —— 拿 ${v.vw} 的读数回答 ${w}px 的问题不算测到`);
        continue;
      }
      /* 一档最多读两次：机器忙时 evaluate 偶发"页面脚本异常：Uncaught"这类**不带任何信息**的失败。
         真缺陷不会挑档、也不会只在某一次运行里出现，所以重试一次再判红。 */
      let m = null;
      for (let attempt = 1; attempt <= 2 && !m; attempt++) {
        try {
          m = await evalSettled(cdp, PROBE);
        } catch (e) {
          if (attempt === 2) m = { err: String((e && e.message) || e) };
          else await sleep(600);       // 让页面把这一跳走完再来一遍
        }
      }
      if (!m || m.err) {
        ok(`${w}px：这一档量到了（页面打得开、取值没抛错）`, false, m && m.err);
        continue;
      }
      /* 覆写生效**之后**再核一次：PROBE 里的 innerWidth 必须还是这一档。
         两趟之间页面自己跳了、或别的代码动了视口，都会被这一步抓住（前提要贴着测量）。 */
      ok(`${w}px：这一档真的量到了它自己（旧写法按 OS 窗口启动：每档 −30、390 被钳成 504）`,
        m.vw === w, `innerWidth=${m.vw} × ${m.vh}`);
      const over = m.need - m.vis;
      ok(`${m.vw}px：坞自己不横向溢出（需要 ${m.need} ≤ 可视 ${m.vis}，${m.rows} 行，高 ${m.dockH}px）`, over <= 1,
        over > 1 ? `溢出 ${over}px` : '');
      /* ★ 本轮新增的那条"真正会坏的量"（坑 115：坞会换行 ⇒ 上面那条恒成立） */
      const docOver = m.docNeed - m.docVis;
      ok(`${m.vw}px：整页没有横向溢出（文档 ${m.docNeed} ≤ 视口 ${m.docVis}；坞放不下时表现为"页面能左右拖"）`,
        docOver <= 1, docOver > 1 ? `整页溢出 ${docOver}px（坞 ${m.rows} 行、左右 ${m.dockLeft}~${m.dockRight}）` : '');
      ok(`${m.vw}px：字幕条不被坞压住`, m.overlap === false,
        m.overlap ? `字幕底 ${m.capBottom} > 坞顶 ${m.dockTop}` : '');
      ok(`${m.vw}px：坞里每颗按钮都有可访问名（文字被收掉时靠 aria-label）`,
        m.nameless.length === 0, m.nameless.length ? `念不出：${m.nameless.join(',')}` : '');
    }
  } finally {
    /* 覆写是"这台浏览器的状态"，不清会留给下一个用同一 profile 的运行
       （与 check:files 第 15b 节同一条收尾纪律）。 */
    await cdp._send(cdp.pageWs, 'Emulation.clearDeviceMetricsOverride').catch(() => { });
    cdp.kill();
  }
  const bad = results.filter((x) => !x.pass).length;
  console.log(bad ? `\n❌ ${bad} 项未过` : `\n🎉 ${WIDTHS.length} 档视口宽度下控制坞都放得下、且不与字幕条重叠`);
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error(`\n❌ 检查失败：${e && e.message}`);
  process.exit(1);
});
