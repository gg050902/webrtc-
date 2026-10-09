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
 * ▎判据两条：① 坞不溢出（scrollWidth ≤ clientWidth）；② 字幕条不被坞压住。
 *   第②条是第①条的连带项：坞从一行变两行之后，压在下面的字幕条就会和它重叠，
 *   而"重叠"这种毛病在只看滚动条的检查里是看不见的。 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Cdp } = require(path.join(__dirname, '..', 'agent', 'cdp.js'));

const URL_ = (process.env.CHECK_URL || 'http://localhost:3001/') + '?nosw=1';
const WIDTHS = (process.env.WIDTHS || '1920,1600,1440,1366,1280,1152,1024,960,860,760,390')
  .split(',').map((n) => Number(n)).filter(Number.isFinite);
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
  const out = { vw: innerWidth, need: dock.scrollWidth, vis: dock.clientWidth,
                dockH: Math.round(d.height), rows,
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
 *   而这条检查要连开 11 台浏览器，每开一台都有撞上导航的机会，
 *   evaluate 落在跳转那一刻就是 "Inspected target navigated or closed"
 *   ——1920/1280/1152 轮流红，红的都是同一句"这一档量到了"。
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

(async () => {
  /* 一档最多试两次：连开 11 台无头浏览器时，上一台的收尾会和下一台的启动抢资源，
     偶发拿到"页面脚本异常：Uncaught"这类**不带任何信息**的失败。
     第一版让整条命令跟着崩（一档死 = 全部没结论）；改成只让那一档红之后发现
     红的位置每次都换 —— 会移动的失败是负载不是代码，重试一次就稳了。
     真缺陷不会挑档、也不会只在某一次运行里出现。 */
  for (const [i, w] of WIDTHS.entries()) {
    let m = null;
    for (let attempt = 1; attempt <= 2 && !m; attempt++) {
      /* 每档换一个 CDP 端口：上一台刚 kill，9333 可能还在 TIME_WAIT，
         紧接着再绑同一端口就会拿到"半死的靶子"（实测第二档直接 target closed）。
         端口不同 → profile 目录也不同（cdp.js 按端口分目录），顺带把缓存隔离干净。
         ★ 2026-10-04：**重试那一趟也必须换端口**——原先两次都用 9340+i，
         第一次刚 kill 完立刻在同端口重开，正好撞上上面说的那个"半死的靶子"，
         于是两次一起失败（1920/1280 两档就是这么红的）。重试的意义是换一个干净的靶子，
         不换端口的重试等于把同一个坑再踩一次。 */
      const cdpPort = attempt === 1 ? 9340 + i : 9380 + i;
      /* ▸ 开跑前把这个端口对应的 profile 目录删掉（坑 72 的同一条纪律：
         **回归结果不该依赖"上一次跑没跑干净"**）。
         上一轮跑过之后，profile 里会留下 Service Worker 与它的 Cache Storage（页面停稳后
         会注册 sw.js），于是下一次带 ?nosw=1 打开时"确实有东西可清" → 又跳一趟 →
         首屏那两次取值就撞在自己的导航上（10-04 实测：轮询 4 轮而不是 2 轮）。
         profile 目录名的来源在 agent/cdp.js:109（按端口派生），这里刻意同规则拼一份；
         下面的"停稳轮询次数"哨兵会在命名改了、这里没跟着改时当场红。 */
      try {
        fs.rmSync(path.join(os.tmpdir(), 'wb-remote-desktop-profile-' + cdpPort),
          { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
      } catch (e) { /* 删不掉不致命：最多是那一档多等一轮 */ }
      const cdp = new Cdp({ headless: true, startUrl: URL_,
        port: cdpPort, windowSize: { width: w, height: 860 } });
      try {
        await cdp.launch();
        await cdp.waitForLoad(15000);
        const fpv = await evalSettled(cdp, FINGERPRINT);
        if (!fpv.js || !fpv.css || !fpv.page.risen) {
          m = { err: `页面不是本轮代码（js=${fpv.js} css=${fpv.css} 已装升起外壳=${fpv.page.risen}）——`
            + '八成是 Service Worker 缓存，检查开头已带 ?nosw=1，仍出现请清 profile' };
        } else {
          m = await evalSettled(cdp, PROBE);
        }
      } catch (e) {
        if (attempt === 2) m = { err: String((e && e.message) || e) };
        else await sleep(1500);            // 给上一台一点收尾时间（端口/profile 都要退干净）
      } finally {
        cdp.kill();
      }
    }
    if (!m || m.err) {
      ok(`${w}px：这一档量到了（浏览器起得来、页面打得开）`, false, m && m.err);
      continue;
    }
    /* 第一档量完之后回头看一眼轮询次数：这一档一共取过两次值（指纹 + 探针），
       没有自我导航就正好 2 轮。多于 2 轮 = 页面仍在为 ?nosw=1 自己跳一趟，
       那时"某档量不到"就不是代码缺陷而是量具在跟自己赛跑（本轮的教训要留个哨兵）。 */
    if (i === 0) ok('干净 profile 下 ?nosw=1 不再让页面自己跳一趟（检查不用跟自己的导航赛跑）',
      settledRounds <= 2, `evalSettled 轮询了 ${settledRounds} 轮`);
    const over = m.need - m.vis;
    ok(`${String(m.vw)}px：坞不溢出（需要 ${m.need} ≤ 可视 ${m.vis}，${m.rows} 行）`, over <= 1,
      over > 1 ? `溢出 ${over}px` : '');
    ok(`${String(m.vw)}px：字幕条不被坞压住`, m.overlap === false,
      m.overlap ? `字幕底 ${m.capBottom} > 坞顶 ${m.dockTop}` : '');
    ok(`${String(m.vw)}px：坞里每颗按钮都有可访问名（文字被收掉时靠 aria-label）`,
      m.nameless.length === 0, m.nameless.length ? `念不出：${m.nameless.join(',')}` : '');
    await sleep(350);
  }
  const bad = results.filter((x) => !x.pass).length;
  console.log(bad ? `\n❌ ${bad} 项未过` : `\n🎉 ${WIDTHS.length} 档视口宽度下控制坞都放得下、且不与字幕条重叠`);
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error(`\n❌ 检查失败：${e && e.message}`);
  process.exit(1);
});
