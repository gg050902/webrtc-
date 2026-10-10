#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 *  check-glow-trail.js —— 第 42/42b 步「滑动光线」的真浏览器验证（三阶段）
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎为什么必须真浏览器：这是一段 WebGL 着色器，冒烟桩里 getContext('webgl') 返回 null，
 *   代码会走"优雅降级"分支——于是**桩只能证明"没报错"，证不了"画出了东西"**。
 *   本项目反复强调：假绿比假红危险（坑 57/65）。所以这里用真无头浏览器 +
 *   gl.readPixels 取像素，断言 alpha 真的非零。
 * ▎preserveDrawingBuffer:true 就是为了这一步（否则帧外读到的是空白缓冲）。
 *
 * ★ 2026-10-04i（第 42b 步）为什么重构为三阶段：
 *   给登录屏（.auth-overlay）挂了**第二条**辉光轨之后，"哪一条在跑"由 syncGlowTrails
 *   总闸按两遮罩的 .hidden 状态裁决——初始状态下 #prejoin 那条是**停着的**（让位），
 *   所以旧版"上来就读 glowTrail.sampleAt"会读到空缓冲（alpha=0），是**假红**。
 *   现在按真实用户动线走：
 *     阶段一 · 登录屏：#authOverlay 在上 → 只跑 auth 轨（像素/淡入/淡出/停启全量）；
 *     阶段二 · 收起登录卡（classList 真操作，走 MutationObserver 总闸）→ prejoin 轨接棒，
 *              同一套像素断言换到它身上再跑一遍；
 *     阶段三 · 进会（两个都收起）→ 两条全停；恢复登录屏 → auth 复活、prejoin 再次让位。
 *   另外用 elementFromPoint 做一次命中测试：登录卡中心的事件接收者必须是卡片自己
 *   （负 z-index 排错时，"光把表单吃了"是零报错事故——坑 80 同族纪律）。
 *
 * ▎跑法：npm run check:glow（先起服务器；专用端口用 CHECK_URL 指过去）。
 * ▎URL 为什么必须带 ?nosw=1：见下方 START_URL 注释（SW 缓存会让检查测到上一版代码）。 */
const fs = require('fs');
const path = require('path');
const { Cdp } = require('../agent/cdp.js');

const URL_ = process.env.CHECK_URL || 'http://localhost:3001/';
/* ★ 带 ?nosw=1 是**必须的**，不是可选：client.js/style.css 由 Service Worker 接管，
 *   而 SW 只在"网络拿得到"时才给最新代码——服务器停掉时它会拿缓存继续渲染，
 *   于是检查测的是**上一版代码**却完全不像失败（本轮真实踩到：3001 已停，页面照样出登录卡）。
 *   ?nosw=1 是 client.js 里的逃生舱：当场注销 SW + 清 Cache Storage + 重载。 */
const START_URL = URL_ + (URL_.includes('?') ? '&' : '?') + 'nosw=1';
const OUT = process.env.CHECK_OUT || path.join(__dirname, '..', 'wb-rd-shots');
const results = [];
const ok = (name, pass, extra) => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ★ 2026-10-10（路线图 D3 量具瘦身）：这条检查原来靠一串固定睡眠把"页面还没来得及"
 *   和"产品真的没做"分开，而 10-07 已经被证明这套睡眠在全量回归的负载下会假红
 *   （坑 96 第四次应验就栽在这条文件的第 158 行注释上）。现在统一换成
 *   **轮询到"它成为断言条件本身"**（坑 120 的纪律）：判据一个字不放松，
 *   只是不再拿一个常数去赌浏览器的速度。
 *   waitUntil 的语义：poll 到 `want` 为止；超时**不抛错**，把最后一次的读数交回调用方，
 *   由那条 ok() 自己判红——"等不到"本来就是那条断言要报的失败。 */
async function waitUntil(cdp, expr, want, ms = 4000, stepMs = 80) {
  const deadline = Date.now() + ms;
  let last;
  for (;;) {
    try { last = await cdp.evaluate(expr); } catch (e) { /* 正在导航/页面忙，下一拍再读 */ }
    if (last === want) return { hit: true, tookMs: Date.now() - (deadline - ms), last };
    if (Date.now() > deadline) return { hit: false, tookMs: Date.now() - (deadline - ms), last };
    await sleep(stepMs);
  }
}

/* 淡出这类"连续量自己往下走"的判据不能只轮一个布尔：轮的是**它停住了**，
 * 阈值留给断言本身（淡到峰值的 30% 以下）。上限写死在这里，
 * 超时就把最后读数交回判据——它自然红，而不是被睡眠掩护过去。 */
async function settleOf(cdp, expr, maxMs = 6000) {
  const t0 = Date.now();
  let prev = await cdp.evaluate(expr);
  let last = prev;
  while (Date.now() - t0 < maxMs) {
    await sleep(200);
    last = await cdp.evaluate(expr);
    if (Math.abs(last - prev) < 0.01) return { value: last, tookMs: Date.now() - t0, settled: true };
    prev = last;
  }
  return { value: last, tookMs: Date.now() - t0, settled: false };
}

(async () => {
  const cdp = new Cdp({ headless: true, startUrl: START_URL });
  await cdp.launch();
  await cdp.waitForLoad(15000);
  /* 旧写法是 `sleep(1500)`：赌"页面大概起来了"。全量回归的负载下这个赌注会输，
   *   而输的方式是**下面第一条断言红**（坑 96 第四次应验就栽在这条文件里）。
   *   现在轮的是它真正的前提：两个轨实例都已经在页面上活着。 */
  const boot = await waitUntil(cdp,
    '(typeof glowTrail !== "undefined" && !!glowTrail) && (typeof authGlowTrail !== "undefined" && !!authGlowTrail)',
    true, 8000);
  ok('两条辉光轨的实例已经就位（轮询到就位，不再睡 1.5s 赌一把）',
    boot.hit, `用了 ${boot.tookMs}ms`);

  /* 版本指纹：让页面自己去 no-store 拉 client.js 看它是不是当前版本。
   *   没有这一步，"页面渲染正常"完全可能是 SW 缓存的上一版（本轮就这么被骗过一次）。
   *   42b 起指纹要同时证明 authGlowTrail 在（否则新实例没上线也是"全绿"）。 */
  const fp = await cdp.evaluate(`(async () => {
    const r = await fetch('client.js', { cache: 'no-store' });
    const t = await r.text();
    return { has: t.indexOf('initGlowTrail') >= 0, hasAuth: t.indexOf('authGlowTrail') >= 0, bytes: t.length };
  })()`);
  ok('页面加载的是**当前** client.js（含 42/42b 的 authGlowTrail，不是 SW 缓存）',
    fp && fp.has === true && fp.hasAuth === true, 'bytes=' + (fp && fp.bytes));
  if (!(fp && fp.has && fp.hasAuth)) {
    console.log('\n   服务器可能没在跑，或页面吃的是缓存。先起服务：npm run start:sfu');
    cdp.kill(); process.exit(1);
  }

  /* ────── 阶段零：两条轨的存在与样式 ────── */
  ok('两条辉光轨的 canvas 都在（#prejoin 与 #authOverlay 各一条）',
    await cdp.evaluate('!!document.querySelector("#prejoin canvas.hero-trail")') === true &&
    await cdp.evaluate('!!document.querySelector("#authOverlay canvas.hero-trail")') === true);
  ok('不吃点击（两条都 pointer-events:none，装饰绝不能挡表单）',
    await cdp.evaluate('getComputedStyle(document.querySelector("#prejoin .hero-trail")).pointerEvents') === 'none' &&
    await cdp.evaluate('getComputedStyle(document.querySelector("#authOverlay .hero-trail")).pointerEvents') === 'none');
  ok('发光叠加模式是 screen（只提亮不压暗）',
    await cdp.evaluate('getComputedStyle(document.querySelector("#authOverlay .hero-trail")).mixBlendMode') === 'screen');
  ok('登录屏画布走负 z-index（光在实底背景之上、登录卡之下——绘制顺序=背景→负层→内容）',
    await cdp.evaluate('getComputedStyle(document.querySelector("#authOverlay .hero-trail")).zIndex') === '-1');
  /* 命中测试（坑 80 同族）：负 z-index 排错时"光把表单吃了"是零报错事故——
   *   让页面自己回答"我要点登录卡正中间，事件会给谁"。 */
  const hit = await cdp.evaluate(`(() => {
    const c = document.querySelector('.auth-card');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { inCard: !!(el && c.contains(el)), tag: el && el.tagName };
  })()`);
  ok('登录卡不被辉光画布挡住（命中测试：卡中心的接收者还是卡内的元素）',
    hit && hit.inCard === true, hit ? 'tag=' + hit.tag : 'no .auth-card');

  const hasGL = await cdp.evaluate(
    '(typeof authGlowTrail !== "undefined" && !!authGlowTrail) && (typeof glowTrail !== "undefined" && !!glowTrail)');
  ok('这台机器的无头浏览器给了 WebGL（否则下面全部只能验降级路径）', hasGL === true);
  if (!hasGL) {
    console.log('  ⚠️ 没有 WebGL：辉光会自动关闭（降级路径本身也算通过）');
    cdp.kill(); process.exit(0);
  }

  const drag = async () => {
    /* 用真输入事件驱动（不是直接调函数）——要验的是"鼠标动 → 屏幕亮"这条完整链路。
     *   轨迹**停在哪儿就读哪儿**：辉光只有几十像素宽，读画布中心而光标在别处必然读到 0，
     *   那是检查的错不是代码的错（第一版红就是这么来的）。
     *   ▸ 每步之间那 30ms 是**被测对象的节奏**（轨迹是按 rAF 帧攒出来的，不帧帧喂就没有线），
     *     不是量具的保险，所以留着；拖完之后不再睡固定 120ms——见 sampleUntil。 */
    for (let i = 0; i <= 20; i++) {
      await cdp.mouse('mouseMoved', 0.2 + i * 0.015, 0.5);
      await sleep(30);
    }
    return 0.2 + 20 * 0.015;
  };
  /* 轮的是**断言本身**（那一点真的有像素），而不是睡一觉赌它画完了（坑 120）。
   *   超时不抛错：把最后一次读数交回断言，"亮不起来"本来就是那条断言要报的失败。
   *   ▸ 像素与 fade **同一趟 evaluate 一起读**：分两趟的话，轮询期间淡出可能已经开始，
   *     于是"峰值"读到的是半个峰——下一条断言（淡到峰值的 30%）就会拿一个偏低的峰值去比，
   *     红得像是产品的淡出没生效。一次读两样，配对关系是结构上的而不是时序上的侥幸。 */
  async function sampleUntil(objExpr, x, y, ms = 2500) {
    const t0 = Date.now();
    let shot = null;
    for (;;) {
      try {
        shot = await cdp.evaluate(`(function(){ var o=${objExpr}; return { px: o.sampleAt(${x}, ${y}), fade: o.fade() }; })()`);
      } catch (e) { /* 页面忙，下一拍 */ }
      const a = shot && Array.isArray(shot.px) ? shot.px[3] : 0;
      if (a > 0) return { px: shot.px, alpha: a, fade: shot.fade, tookMs: Date.now() - t0, hit: true };
      if (Date.now() - t0 > ms) return { px: shot && shot.px, alpha: a, fade: shot && shot.fade, tookMs: Date.now() - t0, hit: false };
      await sleep(100);
    }
  }

  /* ────── 阶段一：登录屏（#authOverlay 在上，只跑 auth 轨） ────── */
  const aAlive0 = await cdp.evaluate('authGlowTrail.alive()');
  const pAlive0 = await cdp.evaluate('glowTrail.alive()');
  ok('初始（登录屏在上）：只跑 auth 轨、prejoin 轨让位停着（两条都跑=叠影+双倍 GPU）',
    aAlive0 === true && pAlive0 === false, `auth=${aAlive0} prejoin=${pAlive0}`);

  const headX = await drag();
  const s1 = await sampleUntil('authGlowTrail', headX, 0.5);
  const px1 = s1.px;
  const alpha1 = s1.alpha;
  ok('【第一屏】光标拖过后画布上真的有像素（readPixels alpha > 0）', alpha1 > 0,
    `rgba=${JSON.stringify(px1)}（等了 ${s1.tookMs}ms）`);
  const fade1 = s1.fade;   // 与上面那发像素同一趟读到的峰值（配对关系写在结构里，不靠时序侥幸）
  ok('【第一屏】淡入值已抬起来（fade 接近 1，说明它认到了输入）', fade1 > 0.5, `fade=${Number(fade1).toFixed(2)}`);

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'glow-trail-auth-on.png'), await cdp.screenshot({ format: 'png' }));

  /* 停一停：idleFade 应该把它淡回 0（不然就变成"背景一直在自己抖"的干扰）。
   *   ▎断言写成"从峰值掉下来"，而不是只写"< 0.15"——后者在"从来就没亮过"时也成立，
   *   那是一条会自我掩护的假绿（第一版跑就差点这样混过去）。
   *   ▸ ★ 2026-10-10：这里原来是 `sleep(1600)` 后读一次，和第二屏同一个毛病
   *     （见下面 fadeUntilSettled 那段注释：淡出是一条**带时长的过渡**，
   *     全量回归的负载下 1.6s 只走到 0.373，于是"产品没淡出"这个结论是量具的睡眠给的）。
   *     第二屏 10-07 已经改成轮询到停住，**第一屏漏了**——同一条纪律只修一半 = 半迁移（坑 57）。
   *     判据本身一个字没改（淡到峰值的 30% 以下），只是不再拿常数赌动画时间。 */
  const idle1 = await fadeUntilSettled('authGlowTrail.fade()');
  ok('【第一屏】光标停下后自动淡出（轮询到停住；淡到峰值的 30% 以下）',
    fade1 > 0.5 && idle1.fade < fade1 * 0.3,
    `峰值 ${Number(fade1).toFixed(2)} → ${Number(idle1.fade).toFixed(3)}（用了 ${idle1.tookMs}ms${idle1.settled ? '' : '，未完全停住'}）`);

  /* stop()/start() 之后"rAF 到底停没停"也要轮那个条件，而不是睡 120/80ms 再读一次
   *   （轮询条件 = 断言条件，坑 120；睡过去的读数只会制造"会移动的假红"）。 */
  await cdp.evaluate('authGlowTrail.start(); authGlowTrail.stop(); "ok"');
  const st1 = await waitUntil(cdp, 'authGlowTrail.alive()', false, 3000);
  ok('【第一屏】stop() 之后 rAF 真的停了（收起登录卡后不再后台烧 GPU）', st1.hit,
    st1.hit ? `用了 ${st1.tookMs}ms` : `还在跑（读了 ${st1.tookMs}ms）`);
  await cdp.evaluate('authGlowTrail.start(); "ok"');
  const st2 = await waitUntil(cdp, 'authGlowTrail.alive()', true, 3000);
  ok('【第一屏】start() 可以再来一次（隐藏→重新显示不会永久哑掉）', st2.hit);

  /* ────── 阶段二：收起登录卡（classList 真操作 → MutationObserver 总闸切换） ────── */
  await cdp.evaluate(`document.getElementById('authOverlay').classList.add('hidden'); 'ok'`);
  /* 这一跳等的是**总闸真的换人**（MutationObserver + 两边的 alive()），
   *   不是"过 300ms 大概换完了"——判据不变，只是把赌注换成观测。 */
  const sw = await waitUntil(cdp, '(function(){ var a=authGlowTrail.alive(), p=glowTrail.alive(); return (!a && p) ? "swapped" : ("auth="+a+" prejoin="+p); })()',
    'swapped', 5000);
  const aAlive1 = await cdp.evaluate('authGlowTrail.alive()');
  const pAlive1 = await cdp.evaluate('glowTrail.alive()');
  ok('收起登录卡后总闸自动切换：auth 轨停、prejoin 轨接棒（事件驱动，不靠手动调用）',
    aAlive1 === false && pAlive1 === true, `auth=${aAlive1} prejoin=${pAlive1}（等了 ${sw.tookMs}ms）`);

  const headX2 = await drag();
  const s2 = await sampleUntil('glowTrail', headX2, 0.5);
  const px2 = s2.px;
  const alpha2 = s2.alpha;
  ok('【第二屏】接棒后光标拖过真的有像素（readPixels alpha > 0——空缓冲切换必须是活的）',
    alpha2 > 0, `rgba=${JSON.stringify(px2)}（等了 ${s2.tookMs}ms）`);
  const fade2 = s2.fade;
  ok('【第二屏】淡入值已抬起来（fade 接近 1）', fade2 > 0.5, `fade=${Number(fade2).toFixed(2)}`);

  fs.writeFileSync(path.join(OUT, 'glow-trail-on.png'), await cdp.screenshot({ format: 'png' }));

  /* ★ 2026-10-07 这条改成"轮询到停住"，不再睡固定 1.6s（坑 96 第四次应验，还是栽在动效上）。
   *   ▎为什么原来会红：判据要的是"光标停下后它自己淡下去"，而写法是
   *     `sleep(1600)` 后读一次——淡出本身是一条带时长的过渡，全量 check:all 的负载下
   *     1.6s 只走到 0.373（阈值 0.3），于是"产品没淡出"这个结论是**量具的睡眠**给的，
   *     不是页面给的。红的位置固定在负载最高的那一条检查上，也是这类假红的指纹。
   *   ▸ 现在读到"连续两次几乎不变"为止（上限 6s），并把用了多久一起打出来——
   *     判据本身一个字没改（淡到峰值的 30% 以下），只是不再拿一个常数去赌动画的时间。
   *   ▸ ★ 2026-10-10：这个等待抽成文件顶部的 `settleOf`，两屏共用一条实现（坑 47）；
   *     以前它是内联在这第二条断言前面的，于是第一屏那份同样的睡眠没人顺手改——
   *     一条纪律落地时如果只改了"我眼前这一处"，另一处就还在原样等下一次假红。 */
  async function fadeUntilSettled(expr, maxMs = 6000) {
    const r = await settleOf(cdp, expr, maxMs);
    return { fade: r.value, tookMs: r.tookMs, settled: r.settled };
  }
  const idle2 = await fadeUntilSettled('glowTrail.fade()');
  ok('【第二屏】光标停下后自动淡出（轮询到停住；淡到峰值的 30% 以下）',
    fade2 > 0.5 && idle2.fade < fade2 * 0.3,
    `峰值 ${Number(fade2).toFixed(2)} → ${Number(idle2.fade).toFixed(3)}（用了 ${idle2.tookMs}ms${idle2.settled ? '' : '，未完全停住'}）`);

  /* 离开登录页必须撤掉 rAF —— 这条是 GPU/续航账，看不见但真实 */
  await cdp.evaluate('glowTrail.start(); glowTrail.stop(); "ok"');
  const st3 = await waitUntil(cdp, 'glowTrail.alive()', false, 3000);
  ok('【第二屏】stop() 之后 rAF 真的停了', st3.hit);
  await cdp.evaluate('glowTrail.start(); "ok"');
  const st4 = await waitUntil(cdp, 'glowTrail.alive()', true, 3000);
  ok('【第二屏】start() 可以再来一次', st4.hit);

  /* ────── 阶段三：进会（两个遮罩都收起 → 两条全停）；再恢复登录屏（来回切不出错） ────── */
  await cdp.evaluate(`document.getElementById('prejoin').classList.add('hidden'); 'ok'`);
  const allOff = await waitUntil(cdp,
    '(function(){ var a=authGlowTrail.alive(), p=glowTrail.alive(); return (!a && !p) ? "off" : ("auth="+a+" prejoin="+p); })()',
    'off', 5000);
  const aAlive2 = await cdp.evaluate('authGlowTrail.alive()');
  const pAlive2 = await cdp.evaluate('glowTrail.alive()');
  ok('进会（两个遮罩都收起）后两条轨全停（rAF 不留后台，没人看得见的开销必须为零）',
    aAlive2 === false && pAlive2 === false, `auth=${aAlive2} prejoin=${pAlive2}（等了 ${allOff.tookMs}ms）`);

  await cdp.evaluate(`document.getElementById('prejoin').classList.remove('hidden'); document.getElementById('authOverlay').classList.remove('hidden'); 'ok'`);
  const backOn = await waitUntil(cdp,
    '(function(){ var a=authGlowTrail.alive(), p=glowTrail.alive(); return (a && !p) ? "auth-only" : ("auth="+a+" prejoin="+p); })()',
    'auth-only', 5000);
  const aAlive3 = await cdp.evaluate('authGlowTrail.alive()');
  const pAlive3 = await cdp.evaluate('glowTrail.alive()');
  ok('恢复登录屏：auth 轨复活、prejoin 轨再次让位（来回切换不出错、不叠跑）',
    aAlive3 === true && pAlive3 === false, `auth=${aAlive3} prejoin=${pAlive3}（等了 ${backOn.tookMs}ms）`);

  console.log(`  截图落盘：${path.join('wb-rd-shots', 'glow-trail-auth-on.png')}（第一屏） 与 glow-trail-on.png（第二屏）`);
  cdp.kill();
  const bad = results.filter((x) => !x.pass).length;
  console.log(bad ? `\n❌ ${bad} 项未过` : '\n🎉 第 42/42b 步在真浏览器里全部成立');
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error(`\n❌ 检查失败：${e && e.message}`);
  console.error('   先确认 SFU 服务器在跑：npm run start:sfu');
  process.exit(1);
});
