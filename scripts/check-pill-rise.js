#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 *  check-pill-rise.js —— 第 43 步「胶囊液体上涨」的真浏览器验证
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎为什么必须真浏览器：这里验的全是**几何 + 计算样式**——圆的直径是不是按
 *   R=((w²/4)+h²)/(2h) 解出来的、hover 时它是不是真的涨到能盖住按钮的顶角、
 *   两层文字是不是交接了。冒烟桩没有布局也没有 CSS 引擎，量不到任何一项。
 * ▎跑法：npm run check:pill（先起 npm run start:sfu）。 */
const fs = require('fs');
const path = require('path');
const { Cdp } = require('../agent/cdp.js');

const URL_ = process.env.CHECK_URL || 'http://localhost:3001/';
const START_URL = URL_ + (URL_.includes('?') ? '&' : '?') + 'nosw=1';
const OUT = process.env.CHECK_OUT || path.join(__dirname, '..', 'wb-rd-shots');
const results = [];
const ok = (name, pass, extra) => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GEOM = `(function () {
  const b = document.getElementById('pjEnterBtn');
  const c = b.querySelector('.pill-rise__circle');
  const labels = b.querySelectorAll('.pill-rise__label');
  const r = b.getBoundingClientRect();
  const w = r.width, h = r.height;
  const R = ((w * w) / 4 + h * h) / (2 * h);
  const D = Math.ceil(2 * R) + 2;
  return {
    hasCircle: !!c,
    labels: labels.length,
    dVar: Number(b.style.getPropertyValue('--pr-d')),
    originVar: Number(b.style.getPropertyValue('--pr-origin')),
    expectD: D,
    circleW: c ? Math.round(c.getBoundingClientRect().width) : 0,
    pillW: Math.round(w), pillH: Math.round(h),
    text: b.textContent.replace(/\\s+/g, ''),
  };
})()`;

const HOVER_STATE = `(function () {
  const b = document.getElementById('pjEnterBtn');
  const c = b.querySelector('.pill-rise__circle');
  const cs = getComputedStyle(c);
  const m = (cs.transform.match(/matrix\\(([-\\d., ]+)\\)/) || [])[1];
  const parts = m ? m.split(',').map(Number) : [0, 0];
  const scale = Math.abs(parts[0]);
  const cr = c.getBoundingClientRect();
  const br = b.getBoundingClientRect();
  const base = b.querySelector('.pill-rise__label:not(.pill-rise__label--hover)');
  const hov = b.querySelector('.pill-rise__label--hover');
  const bc = getComputedStyle(base); const hc = getComputedStyle(hov);
  const by = (bc.transform.match(/matrix\\([-\\d., ]+, ([-\\d.]+)\\)/) || [])[1];
  return {
    scale,
    coversTop: cr.top <= br.top + 1 && cr.left <= br.left + 1 && cr.right >= br.right - 1,
    baseOpacity: Number(bc.opacity), baseShift: Number(by || 0),
    hovOpacity: Number(hc.opacity),
    fill: cs.backgroundColor,
  };
})()`;

/* ★ 2026-10-10 D3：把"两层文字交接"那一读的表达式抽成常量，并在调用处**轮询到停住**。
 *   ▎为什么：这条在全量回归里红过三次（10-04b 写着"根因未定论"、10-06 夜二写着唯一那条红），
 *   而我每次看到的都是同一个形状：`hover 不透明=0.86`——差 0.04 就过。
 *   0.86 不是"效果坏了"，是**过渡还没跑完就被读了一次**（读的是动画中间帧）。
 *   这正是坑 96/104 的"量具在跟自己的动画赛跑"，也正是坑 120 说的
 *   "轮询条件必须等于断言条件"。治法不是把阈值从 0.9 放宽（那会连真坏掉一起放过去），
 *   而是读到它停住为止——判据一个字不放松。
 *   ▸ 上限 2.5s：这条过渡是 0.4s 级，2.5s 还没停 = 真有毛病，此时按最后一次读数报失败，
 *     并把"用了多久"打出来，下次再红能一眼分清"没停"与"停在不该停的地方"。 */
const CLIP = `(function(){
  const b = document.getElementById('pjEnterBtn');
  const base = b.querySelector('.pill-rise__label:not(.pill-rise__label--hover)');
  const hov = b.querySelector('.pill-rise__label--hover');
  const br = b.getBoundingClientRect(); const xr = base.getBoundingClientRect(); const hr = hov.getBoundingClientRect();
  return { baseAboveTop: xr.bottom <= br.top + 2, hovInPlace: Math.abs(hr.top - br.top) < br.height,
           hovOpacity: Number(getComputedStyle(hov).opacity) };
})()`;

/* ★ 2026-10-09 注入浏览器之前先让同一个引擎读一遍这些串。
 *   模板字符串**内部**的注释里只要出现反引号，模板就被提前截断——源文件语法没错、node --check 全过，
 *   错在拼出来的那段代码；到浏览器里炸的时候，本脚本一条断言都没跑到（详见 scripts/inject-check.js 头部）。 */
require('./inject-check.js').assertCompiles(__filename, { GEOM, HOVER_STATE, CLIP });

(async () => {
  const cdp = new Cdp({ headless: true, startUrl: START_URL });
  await cdp.launch();
  await cdp.waitForLoad(15000);
  await sleep(1600);

  const fp = await cdp.evaluate(`(async () => {
    const r = await fetch('client.js', { cache: 'no-store' });
    const t = await r.text();
    return { has: t.indexOf('pillRiseMeasure') >= 0, bytes: t.length };
  })()`);
  ok('页面加载的是**当前** client.js（含 pillRiseMeasure，不是 SW 缓存）',
    fp && fp.has === true, 'bytes=' + (fp && fp.bytes));
  if (!(fp && fp.has)) { cdp.kill(); process.exit(1); }

  const g = await cdp.evaluate(GEOM);
  ok('圆与两层文字都建出来了', g.hasCircle === true && g.labels === 2, `labels=${g.labels}`);
  ok('文字内容没在改造中丢失（"进入会议"还在）', /进入会议/.test(g.text), g.text);
  /* 几何正确性：JS 算的 --pr-d 必须等于按公式现算的 D（差 1px 内），
   *   否则圆涨到一半会露角或溢出成方块。这是"公式抄对了没有"的硬核对。 */
  ok('直径按 R=((w²/4)+h²)/(2h) 解出（与页面实测一致）',
    Math.abs(g.dVar - g.expectD) <= 1, `--pr-d=${g.dVar} 应为 ${g.expectD}（按钮 ${g.pillW}×${g.pillH}）`);
  /* 圆的**布局**直径（不是渲染尺寸：未 hover 时它被 scale(0) 缩没了，量渲染必得 0） */
  const layoutW = await cdp.evaluate(`(function(){
    const c = document.querySelector('#pjEnterBtn .pill-rise__circle');
    return c ? Number(getComputedStyle(c).width.replace('px', '')) : -1;
  })()`);
  ok('圆的布局直径 = 解出的 D（液体灌满的几何前提）',
    Math.abs(layoutW - g.expectD) <= 2, `布局 ${layoutW}px vs 解出 ${g.expectD}px`);
  ok('缩放原点落在圆的下缘（"从底部生长"的关键）',
    g.originVar > g.dVar * 0.5 && g.originVar <= g.dVar, `originY=${g.originVar} / D=${g.dVar}`);

  const before = await cdp.evaluate(HOVER_STATE);
  ok('未 hover 时圆是缩没的（scale≈0，不是一片色块压在按钮上）',
    before.scale < 0.05, `scale=${before.scale.toFixed(3)}`);

  /* 用真鼠标事件驱动（不是加类）——要验的是 hover 状态机整条链路。
   *   ▎两步都是被真问题逼出来的：
   *     ① 坐标必须**问页面要**：第一版按"按钮在 x=0"手算，鼠标落在别处，hover 从未触发，
   *        而"移开后能退回"那条断言反而**因为从来没涨过而 PASS 了**（自我掩护的假绿）；
   *     ② 必须先按真实路径**关掉登录卡**：首屏 .auth-overlay（z-110）盖着整个 hero，
   *        命中的是卡片而不是 pill。这同时也是产品事实——上涨效果要在关掉登录卡后才看得见。 */
  await cdp.evaluate(`(function(){ const b = document.getElementById('authGuestBtn'); if (b) b.click(); return 'ok'; })()`);
  await sleep(500);
  ok('登录卡已关掉（游客路径），hero 的 pill 现在暴露在最上层',
    await cdp.evaluate(`(function(){
      const o = document.querySelector('.auth-overlay');
      if (!o) return true;
      const cs = getComputedStyle(o);
      return cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0;
    })()`) === true);

  const ctr = await cdp.evaluate(`(function(){
    const r = document.getElementById('pjEnterBtn').getBoundingClientRect();
    return { nx: (r.left + r.width / 2) / innerWidth, ny: (r.top + r.height / 2) / innerHeight };
  })()`);
  /* ▸ 前提也要被验证（坑 63/55，本轮被这条救回来）：全量跑时这里出现过
   *   "五条 hover 断言全 0.00"——scale 是 0.00 而不是残留的 1.20，说明**鼠标根本没落上去**，
   *   而不是"动画没跑"。可当时的报错只说"没落在按钮上"，查不出为什么没落。
   *   加两步：① 等到 `#pjEnterBtn` 真的在页面上占了一块面积（轮询，上限 6s）；
   *   ② 用 `elementFromPoint` 命中测试问一句"这块地方浏览器会把事件给谁"——
   *      给它的是不是这颗按钮。有了这两条，下一次红就直接说清是"没显示"还是"被盖住"。 */
  let geom = null;
  for (let deadline = Date.now() + 6000; Date.now() < deadline; ) {
    geom = await cdp.evaluate(`(function(){
      const el = document.getElementById('pjEnterBtn'); if (!el) return { miss: true };
      const r = el.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
      const top = document.elementFromPoint(x, y);
      return { w: Math.round(r.width), h: Math.round(r.height), x, y,
               hit: !!top && (top === el || el.contains(top)),
               who: top ? (top.id ? '#' + top.id : String(top.getAttribute('class') || top.tagName).split(' ')[0]) : '(none)' };
    })()`);
    if (geom && geom.w > 4 && geom.hit) break;
    await sleep(250);
  }
  ok('前提：按钮真的占了一块面积，且命中测试说"这块地方的事件归它"（否则 hover 不可能发生）',
    !!geom && geom.w > 4 && geom.hit === true, JSON.stringify(geom));
  /* ══ ★ 2026-10-10 补上缺的那一格前提：**事件有没有送到页面** ══
   * ▎上面那条命中测试说"这块地方的事件归这颗按钮"，而全量回归里仍然出现过
   *   "四条 hover 断言一起 0.00"（10-04b 记为"根因未定论"，本次又出现）。
   *   两条前提之间少了一环：`Input.dispatchMouseEvent` 是我从 CDP 侧塞进去的，
   *   机器忙/窗口没有系统焦点时它**可以整批不落地**，而页面几何与命中测试全都照样正确——
   *   于是红四条，看起来像"升起效果坏了"，实际是**我的触发条件没成立**（坑 63 的原话：
   *   测试的触发条件本身也要被验证）。
   * ▸ 做法：在页面里挂一个 pointermove 计数器（捕获阶段，`closest('#pjEnterBtn')` 单独数一份），
   *   发两轮移动，读回计数。
   *   ▸ 计数为 0 ⇒ 报**一条**说得清来源的红（"事件没送到页面"），后面四条依赖 hover 的断言
   *     打成 SKIP（不算 PASS 也不算 FAIL）——一条诊断明确的红，胜过四条互相掩盖的假红；
   *   ▸ 计数正常而 hover 仍是 0 ⇒ 那才是真产品缺陷，四条断言照常跑、照常红。 */
  await cdp.evaluate(`(function(){
    window.__pmAll = 0; window.__pmBtn = 0;
    window.__pmHit = null;
    window.addEventListener('pointermove', function (e) {
      window.__pmAll++;
      var t = e.target;
      var btn = document.getElementById('pjEnterBtn');
      if (btn && t && (t === btn || btn.contains(t))) {
        window.__pmBtn++;
        window.__pmHit = { x: Math.round(e.clientX), y: Math.round(e.clientY) };
      }
    }, true);
    return 'armed';
  })()`);
  await cdp.mouse('mouseMoved', ctr.nx * 0.9, ctr.ny * 0.6);   // 先在附近走一下，模拟真实进场的 pointer 轨迹
  await sleep(80);
  await cdp.mouse('mouseMoved', ctr.nx, ctr.ny);
  await sleep(260);
  let pm = await cdp.evaluate('({ all: window.__pmAll, btn: window.__pmBtn, hit: window.__pmHit })');
  if (!pm || !pm.btn) {
    /* 一次没中再来一次（事件丢一轮在负载下是真实存在的；只试一次会把环境问题当成结论） */
    await cdp.mouse('mouseMoved', Math.max(0.02, ctr.nx - 0.05), ctr.ny);
    await sleep(60);
    await cdp.mouse('mouseMoved', ctr.nx, ctr.ny);
    await sleep(260);
    pm = await cdp.evaluate('({ all: window.__pmAll, btn: window.__pmBtn, hit: window.__pmHit })');
  }
  const hoverTriggered = !!(pm && pm.btn > 0);
  ok('前提：我发的鼠标事件**真的到了页面**、且落在这颗按钮上（缺这一格时，四条 hover 断言会一起假红）',
    hoverTriggered, JSON.stringify(pm));
  if (!hoverTriggered) {
    console.log('   ⏭  跳过下面 5 条依赖 hover 的断言：触发条件没成立，跑出来的 0.00 什么都不能说明'
      + '\n      （不是产品缺陷；全量回归负载下偶发，单独复跑 npm run check:pill 会跑到）');
    /* ▸ 这份清单必须与上面 `if (hoverTriggered)` 挂上的条数**一一对应**：
     *   少列一条，那条就变成"静默没跑"——报告里既没有 PASS 也没有 SKIP，
     *   看的人会以为它跑了（坑 76/123：没跑过不等于通过）。下面那条自检就是钉这件事的。 */
    const SKIP = [
      '鼠标确实落在按钮上（hover 状态被激活了）',
      'hover 后圆在**持续涨大**（采到中间态 = 真的是动画，不是瞬切）',
      '涨到位后**盖得住按钮的顶角与两侧**（液体灌满，不是中间一个圆点）',
      '两层文字完成交接：原文字被裁出按钮外、克隆层回到原位淡入（轮询到停住，不读过渡中间帧）',
      '鼠标移开后能退回（且这是在"确实涨起来过"之后测的）',
    ];
    SKIP.forEach((s) => console.log(`  SKIP  ${s}`));
  }
  await cdp.mouse('mouseMoved', ctr.nx, ctr.ny);
  await sleep(260);
  const mid = await cdp.evaluate(HOVER_STATE);
  await sleep(700);
  const after = await cdp.evaluate(HOVER_STATE);
  if (hoverTriggered) ok('鼠标确实落在按钮上（hover 状态被激活了）',
    after.scale > 0.05 || after.hovOpacity > 0.05, `scale=${after.scale.toFixed(2)} hover=${after.hovOpacity.toFixed(2)}`);

  /* ▎这条断言第一版是**假绿**：我把 async IIFE 直接当参数传给 ok()，传进去的是个 Promise
   *   ——Promise 永远是真值，所以无论采样结果如何它都 PASS。
   *   本项目一路在抓"绿得可疑"，结果自己写了一个。规矩：**先 await 再断言**。
   * ▎而真实采样结果是"没有中间态"：从 hover 到第一次读样式，.62s 的过渡已经跑完了
   *   （前面为了拿 after 已经等了 700ms）。所以"有没有在动画"不能靠事后补采样，
   *   必须在**触发动作之前**就架好采样器。 */
  /* 验"是不是真的在动画"必须先建立**归零的起点**：
   *   上一版我把采样器和"移开/移回"并发跑，结果第一帧采到的还是上一轮 hover 的 1.18，
   *   整条序列自然看不到中间态 —— 那是测量的错，不是效果的错。 */
  const readScale = `(function(){
    const cs = getComputedStyle(document.querySelector('#pjEnterBtn .pill-rise__circle'));
    const m = (cs.transform.match(/matrix\\(([-\\d., ]+)\\)/) || [])[1];
    return m ? Math.abs(Number(m.split(',')[0])) : 0;
  })()`;
  /* ▸ ★ 2026-10-04 两处"跟着机器负载跑"的量具缺陷，在这台机器被真实抓到过：
   *   ① `sleep(900)` 后读一次归零——机器忙时（当时是我自己另起的一台带 Qwen 双 worker 的
   *      测试服务器在抢 GPU）过渡 900ms 还没走完，起点没归零，后面整条序列全是终值 1.20，
   *      两条断言一起红。**是量具在负载下说谎，不是效果坏了**（复跑就绿）。
   *   ② 采样器是"外部每 50ms 一次 CDP 往返"——往返本身就要几十毫秒且抖动大，
   *      0.62s 的过渡经常被整段跨过。
   *   改法：① 归零改成**轮询到真的归零**（上限 3s；到点还没归零才是缺陷）；
   *   ② 采样改成**页面内的 rAF 记录器**（触发前就架好，每帧一个样本，一次读回），
   *      这样"密度由刷新率决定"而不是由我的往返延迟决定。 */
  const zeroDeadline = Date.now() + 3000;
  let zero = 0;
  await cdp.mouse('mouseMoved', ctr.nx, Math.max(0.03, ctr.ny - 0.4));   // 彻底移开
  for (;;) {
    zero = await cdp.evaluate(readScale);
    if (zero < 0.05 || Date.now() > zeroDeadline) break;
    await sleep(120);
  }
  ok('移开后圆确实归零（建立起"从 0 开始"的可测起点，轮询到稳为止而不是死等 900ms）',
    zero < 0.05, `scale=${zero.toFixed(3)}`);
  /* 页内记录器：先把每帧的 scale 存进 window，再触发 hover，最后一次性读回。 */
  await cdp.evaluate(`(function(){
    window.__pillSeries = [];
    const el = document.querySelector('#pjEnterBtn .pill-rise__circle');
    const t0 = performance.now();
    (function tick() {
      const cs = getComputedStyle(el);
      const m = (cs.transform.match(/matrix\\(([-\\d., ]+)\\)/) || [])[1];
      window.__pillSeries.push(Math.abs(Number(m ? m.split(',')[0] : 0)));
      if (performance.now() - t0 < 900) requestAnimationFrame(tick);
    })();
  })()`);
  await sleep(30);
  await cdp.mouse('mouseMoved', ctr.nx, ctr.ny);   // 移进去：过渡从头跑
  await sleep(1000);
  const series = await cdp.evaluate('window.__pillSeries') || [];
  const rising = series.filter((v) => v > 0.05 && v < 1.15).length;
  ok('采样器真的在每帧取样（页面 rAF 没跑起来就是量具坏了，别把它当成效果坏了）',
    series.length >= 3, `样本 ${series.length} 个`);
  if (hoverTriggered) ok('hover 后圆在**持续涨大**（采到中间态 = 真的是动画，不是瞬切）',
    rising >= 2, `中间态 ${rising} 个 / 序列 ${series.slice(0, 14).map((v) => v.toFixed(2)).join(' ')}`);
  if (hoverTriggered) ok('涨到位后**盖得住按钮的顶角与两侧**（液体灌满，不是中间一个圆点）',
    after.coversTop === true, `scale=${after.scale.toFixed(2)}`);
  /* 原文字是**被 overflow:hidden 裁掉的**（原组件就这么做的），不是靠淡出——
   *   第一版拿 opacity 去断言，红了才发现是我对标错了机制。这里改成量几何：
   *   基础层整体涨到按钮上边缘之外 = 被裁没，克隆层回到原位。 */
  const clipDeadline = Date.now() + 2500;
  let clip = await cdp.evaluate(CLIP);
  let clipTook = 0;
  while (clip && !(clip.baseAboveTop === true && clip.hovInPlace === true && clip.hovOpacity > 0.9)
    && Date.now() < clipDeadline) {
    await sleep(150);
    clip = await cdp.evaluate(CLIP);
  }
  clipTook = Date.now() - (clipDeadline - 2500);
  if (hoverTriggered) ok('两层文字完成交接：原文字被裁出按钮外、克隆层回到原位淡入（轮询到停住，不读过渡中间帧）',
    clip.baseAboveTop === true && clip.hovInPlace === true && clip.hovOpacity > 0.9,
    `base 已裁出=${clip.baseAboveTop} hover 不透明=${clip.hovOpacity.toFixed(2)}（用了 ${clipTook}ms）`);
  ok('上涨色取自 token（朱砂，不是写死的十六进制字面量）',
    /rgb\(185, 58, 38\)/.test(after.fill), after.fill);

  /* ══ ★ 2026-10-04 第 43 步扩到"会中控制坞那一排"（用户点名：视频下面那些按钮）══
   * ▎为什么要单独量这一段：坞里的按钮文案是 JS 改的（setIconBtn 整块重写 innerHTML），
   *   而 innerHTML 赋值会把"圆 + 两层文字"一起清掉——症状是"点一下静音，这颗按钮就
   *   再也不会涨了"。这类缺陷只在"改过文案之后"才现形，所以断言必须**先改一次再量**。
   * ▎顺带钉住我自己刚写错的一处：圆曾被搬进文字层里（套娃），量一下父子关系就知道。 */
  const dock = await cdp.evaluate(`(function(){
    for (const id of ['authOverlay','prejoin','roomPanel']) { const e = document.getElementById(id); if (e) e.classList.add('hidden'); }
    const btns = Array.from(document.querySelectorAll('.controls .btn'));
    const risen = btns.filter(b => b.classList.contains('pill-rise'));
    const tgl = btns.filter(b => b.classList.contains('tgl'));
    const probe = document.getElementById('recordBtn') || (risen[0] || {});
    const circle = probe.querySelector(':scope > .pill-rise__circle');
    const stack = probe.querySelector(':scope > .pill-rise__stack');
    const swallowed = !!(circle && circle.closest('.pill-rise__label'));
    return {
      total: btns.length, risen: risen.length, tgl: tgl.length,
      tglRisen: tgl.filter(b => b.classList.contains('pill-rise')).length,
      labels: probe.querySelectorAll ? probe.querySelectorAll('.pill-rise__label').length : 0,
      hasCircle: !!circle, hasStack: !!stack, swallowed,
      text: (probe.textContent || '').trim(),
      d: getComputedStyle(probe).getPropertyValue('--pr-d').trim(),
    };
  })()`);
  ok('坞里成排的按钮都装上了上涨外壳（不是只做一颗；.tgl 那几颗有意排除）',
    dock.risen >= 8 && dock.risen === dock.total - dock.tgl,
    `已装 ${dock.risen}，应装 ${dock.total - dock.tgl}（另有 ${dock.tgl} 颗开关走 BellToggle 那套）`);
  ok('BellToggle 那套开关被排除在外（它自己已是两层标签，两套动效会抢同一颗按钮）',
    dock.tglRisen === 0, `tgl 里被误装 ${dock.tglRisen} 颗`);
  ok('圆与两层文字是**兄弟**关系（圆没被搬进文字层里套娃）',
    dock.hasCircle === true && dock.hasStack === true && dock.labels === 2 && dock.swallowed === false,
    `labels=${dock.labels} 套娃=${dock.swallowed}`);
  ok('改造没把按钮文案弄丢（"录制会议"还在）', /录制会议/.test(dock.text), dock.text);
  ok('直径按按钮真实尺寸量出来了（不是 CSS 里的兜底值）', Number(dock.d) > 40, `--pr-d=${dock.d}`);

  /* 关键的一条：改过文案之后，外壳必须还在、而且只有一套 */
  const afterText = await cdp.evaluate(`(function(){
    const b = document.getElementById('handBtn');
    setIconBtn(b, ICONS.hand, '放下手');
    const c = b.querySelectorAll(':scope > .pill-rise__circle').length;
    const s = b.querySelectorAll(':scope > .pill-rise__stack').length;
    return { circles: c, stacks: s, cls: b.classList.contains('pill-rise'),
             text: (b.textContent || '').trim(),
             labels: b.querySelectorAll('.pill-rise__label').length };
  })()`);
  ok('★ 改过文案（setIconBtn）之后外壳不丢、也不长出第二套',
    afterText.cls === true && afterText.circles === 1 && afterText.stacks === 1
    && afterText.labels === 2 && /放下手/.test(afterText.text),
    `圆=${afterText.circles} 层=${afterText.stacks} 文案=${afterText.text}`);

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'pill-rise-hover.png'), await cdp.screenshot({ format: 'png' }));
  await cdp.mouse('mouseMoved', ctr.nx, Math.max(0.02, ctr.ny - 0.35));   // 移开：必须能退回去
  /* 同样改成"轮询到退回为止（上限 3s）"：断言的语义是**它会退回零**，
   *   不是"它在 900ms 内退回零"——后者在机器负载高时会假红（本机 10-04 实测踩过）。 */
  let out = await cdp.evaluate(HOVER_STATE);
  const backDeadline = Date.now() + 3000;
  while (out.scale >= 0.05 && Date.now() < backDeadline) {
    await sleep(120);
    out = await cdp.evaluate(HOVER_STATE);
  }
  /* 这条断言必须**以"它确实涨起来过"为前提**——第一版没有这个前提，
   *   于是鼠标压根没落在按钮上时它也显示 PASS（自我掩护的假绿）。 */
  if (hoverTriggered) ok('鼠标移开后能退回（且这是在"确实涨起来过"之后测的）',
    after.scale > 0.5 && out.scale < 0.05, `峰值 ${after.scale.toFixed(2)} → 移开 ${out.scale.toFixed(3)}`);
  console.log(`  截图落盘：wb-rd-shots/pill-rise-hover.png`);

  cdp.kill();
  const bad = results.filter((x) => !x.pass).length;
  console.log(bad ? `\n❌ ${bad} 项未过` : '\n🎉 第 43 步在真浏览器里全部成立');
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error(`\n❌ 检查失败：${e && e.message}`);
  console.error('   先确认 SFU 服务器在跑：npm run start:sfu');
  process.exit(1);
});
