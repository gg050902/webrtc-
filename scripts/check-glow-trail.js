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

(async () => {
  const cdp = new Cdp({ headless: true, startUrl: START_URL });
  await cdp.launch();
  await cdp.waitForLoad(15000);
  await sleep(1500);

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
     *   那是检查的错不是代码的错（第一版红就是这么来的）。 */
    for (let i = 0; i <= 20; i++) {
      await cdp.mouse('mouseMoved', 0.2 + i * 0.015, 0.5);
      await sleep(30);
    }
    await sleep(120);
    return 0.2 + 20 * 0.015;
  };

  /* ────── 阶段一：登录屏（#authOverlay 在上，只跑 auth 轨） ────── */
  const aAlive0 = await cdp.evaluate('authGlowTrail.alive()');
  const pAlive0 = await cdp.evaluate('glowTrail.alive()');
  ok('初始（登录屏在上）：只跑 auth 轨、prejoin 轨让位停着（两条都跑=叠影+双倍 GPU）',
    aAlive0 === true && pAlive0 === false, `auth=${aAlive0} prejoin=${pAlive0}`);

  const headX = await drag();
  const px1 = await cdp.evaluate(`authGlowTrail.sampleAt(${headX}, 0.5)`);
  const alpha1 = Array.isArray(px1) ? px1[3] : 0;
  ok('【第一屏】光标拖过后画布上真的有像素（readPixels alpha > 0）', alpha1 > 0, `rgba=${JSON.stringify(px1)}`);
  const fade1 = await cdp.evaluate('authGlowTrail.fade()');
  ok('【第一屏】淡入值已抬起来（fade 接近 1，说明它认到了输入）', fade1 > 0.5, `fade=${Number(fade1).toFixed(2)}`);

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'glow-trail-auth-on.png'), await cdp.screenshot({ format: 'png' }));

  /* 停一停：idleFade 应该把它淡回 0（不然就变成"背景一直在自己抖"的干扰）。
   *   ▎断言写成"从峰值掉下来"，而不是只写"< 0.15"——后者在"从来就没亮过"时也成立，
   *   那是一条会自我掩护的假绿（第一版跑就差点这样混过去）。 */
  await sleep(1600);
  const fadeIdle1 = await cdp.evaluate('authGlowTrail.fade()');
  ok('【第一屏】光标停 1.6s 后自动淡出（idleFade 生效，装饰不变成干扰）',
    fade1 > 0.5 && fadeIdle1 < fade1 * 0.3, `峰值 ${Number(fade1).toFixed(2)} → ${Number(fadeIdle1).toFixed(3)}`);

  await cdp.evaluate('authGlowTrail.start(); authGlowTrail.stop(); "ok"');
  await sleep(120);
  ok('【第一屏】stop() 之后 rAF 真的停了（收起登录卡后不再后台烧 GPU）',
    await cdp.evaluate('authGlowTrail.alive()') === false);
  await cdp.evaluate('authGlowTrail.start(); "ok"');
  await sleep(80);
  ok('【第一屏】start() 可以再来一次（隐藏→重新显示不会永久哑掉）',
    await cdp.evaluate('authGlowTrail.alive()') === true);

  /* ────── 阶段二：收起登录卡（classList 真操作 → MutationObserver 总闸切换） ────── */
  await cdp.evaluate(`document.getElementById('authOverlay').classList.add('hidden'); 'ok'`);
  await sleep(300);
  const aAlive1 = await cdp.evaluate('authGlowTrail.alive()');
  const pAlive1 = await cdp.evaluate('glowTrail.alive()');
  ok('收起登录卡后总闸自动切换：auth 轨停、prejoin 轨接棒（事件驱动，不靠手动调用）',
    aAlive1 === false && pAlive1 === true, `auth=${aAlive1} prejoin=${pAlive1}`);

  const headX2 = await drag();
  const px2 = await cdp.evaluate(`glowTrail.sampleAt(${headX2}, 0.5)`);
  const alpha2 = Array.isArray(px2) ? px2[3] : 0;
  ok('【第二屏】接棒后光标拖过真的有像素（readPixels alpha > 0——空缓冲切换必须是活的）',
    alpha2 > 0, `rgba=${JSON.stringify(px2)}`);
  const fade2 = await cdp.evaluate('glowTrail.fade()');
  ok('【第二屏】淡入值已抬起来（fade 接近 1）', fade2 > 0.5, `fade=${Number(fade2).toFixed(2)}`);

  fs.writeFileSync(path.join(OUT, 'glow-trail-on.png'), await cdp.screenshot({ format: 'png' }));

  /* ★ 2026-10-07 这条改成"轮询到停住"，不再睡固定 1.6s（坑 96 第四次应验，还是栽在动效上）。
   *   ▎为什么原来会红：判据要的是"光标停下后它自己淡下去"，而写法是
   *     `sleep(1600)` 后读一次——淡出本身是一条带时长的过渡，全量 check:all 的负载下
   *     1.6s 只走到 0.373（阈值 0.3），于是"产品没淡出"这个结论是**量具的睡眠**给的，
   *     不是页面给的。红的位置固定在负载最高的那一条检查上，也是这类假红的指纹。
   *   ▸ 现在读到"连续两次几乎不变"为止（上限 6s），并把用了多久一起打出来——
   *     判据本身一个字没改（淡到峰值的 30% 以下），只是不再拿一个常数去赌动画的时间。 */
  async function fadeUntilSettled(maxMs = 6000) {
    const t0 = Date.now();
    let prev = await cdp.evaluate('glowTrail.fade()');
    let last = prev;
    while (Date.now() - t0 < maxMs) {
      await sleep(200);
      last = await cdp.evaluate('glowTrail.fade()');
      if (Math.abs(last - prev) < 0.01) return { fade: last, tookMs: Date.now() - t0, settled: true };
      prev = last;
    }
    return { fade: last, tookMs: Date.now() - t0, settled: false };
  }
  const idle2 = await fadeUntilSettled();
  ok('【第二屏】光标停下后自动淡出（轮询到停住；淡到峰值的 30% 以下）',
    fade2 > 0.5 && idle2.fade < fade2 * 0.3,
    `峰值 ${Number(fade2).toFixed(2)} → ${Number(idle2.fade).toFixed(3)}（用了 ${idle2.tookMs}ms${idle2.settled ? '' : '，未完全停住'}）`);

  /* 离开登录页必须撤掉 rAF —— 这条是 GPU/续航账，看不见但真实 */
  await cdp.evaluate('glowTrail.start(); glowTrail.stop(); "ok"');
  await sleep(120);
  ok('【第二屏】stop() 之后 rAF 真的停了', await cdp.evaluate('glowTrail.alive()') === false);
  await cdp.evaluate('glowTrail.start(); "ok"');
  await sleep(80);
  ok('【第二屏】start() 可以再来一次', await cdp.evaluate('glowTrail.alive()') === true);

  /* ────── 阶段三：进会（两个遮罩都收起 → 两条全停）；再恢复登录屏（来回切不出错） ────── */
  await cdp.evaluate(`document.getElementById('prejoin').classList.add('hidden'); 'ok'`);
  await sleep(300);
  const aAlive2 = await cdp.evaluate('authGlowTrail.alive()');
  const pAlive2 = await cdp.evaluate('glowTrail.alive()');
  ok('进会（两个遮罩都收起）后两条轨全停（rAF 不留后台，没人看得见的开销必须为零）',
    aAlive2 === false && pAlive2 === false, `auth=${aAlive2} prejoin=${pAlive2}`);

  await cdp.evaluate(`document.getElementById('prejoin').classList.remove('hidden'); document.getElementById('authOverlay').classList.remove('hidden'); 'ok'`);
  await sleep(300);
  const aAlive3 = await cdp.evaluate('authGlowTrail.alive()');
  const pAlive3 = await cdp.evaluate('glowTrail.alive()');
  ok('恢复登录屏：auth 轨复活、prejoin 轨再次让位（来回切换不出错、不叠跑）',
    aAlive3 === true && pAlive3 === false, `auth=${aAlive3} prejoin=${pAlive3}`);

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
