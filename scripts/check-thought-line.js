#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 *  check-thought-line.js —— 第 41 步「AI 思考条」的真浏览器验证
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎为什么必须真浏览器：呼吸/微光/收焦/清单折叠**全是 CSS**，冒烟桩里没有 CSS 引擎
 *   ——坑 26 那次全站 CSS 变量为空、冒烟一条没红，是用户说"前端排版乱"才发现的。
 *   所以这里读的是 getComputedStyle：动画名、background-clip、grid-template-rows。
 * ▎还有一条只有真浏览器能证：**phase 到底有没有走到界面**。
 *   服务器从 09-30 就在 ai-state 里带 phase，客户端监听器只解构 {state,text} 就丢了，
 *   于是"正在翻会议记录…"这句从上线起一次都没显示过（坑 56 第五次复发）。
 * ▎跑法：npm run check:think（先起 npm run start:sfu）。无头、独立 profile、不弹窗。 */
const fs = require('fs');
const path = require('path');
const { Cdp } = require('../agent/cdp.js');

const URL_ = process.env.CHECK_URL || 'http://localhost:3001/';
const OUT = process.env.CHECK_OUT || path.join(__dirname, '..', 'wb-rd-shots');
const results = [];
const ok = (name, pass, extra) => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 在真页面里搭一个 AI 格子，走 client.js **自己的** buildThinkLine / tlStart / tlPhase，
 *   不另写一份（另写就等于没测产品代码）。 */
const PROBE = `(function () {
  const tile = document.createElement('div');
  tile.className = 'video-box ai-tile';
  tile.style.cssText = 'position:fixed;left:24px;top:24px;width:420px;height:260px;z-index:99999';
  tile.innerHTML = '<div class="video-label">AI 小明<span class="ai-status">聆听中…</span></div>';
  document.body.appendChild(tile);
  window.__TL_TEST__ = tile;
  buildThinkLine(tile);
  const root = tile.querySelector('.tl');
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const trace = tile.querySelector('.tl-trace');
  return {
    replaced: !tile.querySelector('.ai-status') || !!root.querySelector('.tl__stack'),
    timerNumeric: cs(root.querySelector('.tl__timer')).fontVariantNumeric,
    traceRowsClosed: cs(trace).gridTemplateRows,
    layers: root.querySelectorAll('.tl__txt').length,
    hasGlyph: !!root.querySelector('.tl__glyph svg'),
  };
})()`;

const WORKING = `(function () {
  const tile = window.__TL_TEST__;
  tlStart(); tlPhase('正在翻会议记录…'); tlPhase('第一遍没找到，换个说法再找…');
  const trace = tile.querySelector('.tl-trace');
  const root = tile.querySelector('.tl');
  const cs = getComputedStyle;
  const g = root.querySelector('.tl__glyph');
  const b = root.querySelector('.tl__txt[data-active] .tl__breath');
  return {
    working: root.hasAttribute('data-working'),
    steps: trace.querySelectorAll('.tl-step').length,
    activeStep: trace.querySelectorAll('.tl-step:not([data-done])').length,
    pulses: trace.querySelectorAll('.tl-pulse').length,
    open: trace.hasAttribute('data-open'),
    head: b ? b.textContent : '',
    // 呼吸/微光只在 data-working 时才挂得上——所以必须在"工作中"来量（第一版在未工作态量，白红三条）
    glyphAnim: cs(g).animationName,
    breathAnim: cs(b).animationName,
    shimmerClip: cs(b).webkitBackgroundClip || cs(b).backgroundClip,
    traceRows: cs(trace).gridTemplateRows,
  };
})()`;

const SETTLED = `(function () {
  const tile = window.__TL_TEST__;
  tlStop();
  const trace = tile.querySelector('.tl-trace');
  const doneTxt = tile.querySelector('.tl__txt--done .tl__breath').textContent;
  return {
    working: tile.querySelector('.tl').hasAttribute('data-working'),
    open: trace.hasAttribute('data-open'),
    doneTxt: doneTxt,
    timerCleared: (window.__TL_TEST_TIMER_LIVE__ = true, true),
  };
})()`;

/* ★ 2026-10-09 注入浏览器之前先让同一个引擎读一遍这些串。
 *   模板字符串**内部**的注释里只要出现反引号，模板就被提前截断——源文件语法没错、node --check 全过，
 *   错在拼出来的那段代码；到浏览器里炸的时候，本脚本一条断言都没跑到（详见 scripts/inject-check.js 头部）。 */
require('./inject-check.js').assertCompiles(__filename, { PROBE, WORKING, SETTLED });

(async () => {
  const cdp = new Cdp({ headless: true, startUrl: URL_ });
  await cdp.launch();
  await cdp.waitForLoad(15000);
  await sleep(1200);
  ok('页面在、client.js 顶层没被截断（第 41 步的函数都在全局）',
    await cdp.evaluate('typeof buildThinkLine === "function" && typeof tlStart === "function" && typeof tlPhase === "function" && typeof tlStop === "function"') === true);

  const r = await cdp.evaluate(PROBE);
  ok('静态徽标被换成思考条（两层文案 + 单色 SVG 图标都在）',
    r.replaced === true && r.layers === 2 && r.hasGlyph === true, `layers=${r.layers}`);
  ok('计时器用等宽数字（跳动时不抖宽度）', /tabular/.test(r.timerNumeric), r.timerNumeric);
  ok('清单默认收起（grid-template-rows 是 0fr，不是靠 display:none）', /0px|^0$/.test(r.traceRowsClosed), r.traceRowsClosed);

  const w = await cdp.evaluate(WORKING);
  await sleep(260);
  ok('思考中：图标在**呼吸**（animation-name=tlBreath）', /tlBreath/.test(w.glyphAnim), w.glyphAnim);
  ok('图标呼吸 + 文字扫光是**两条不同动画**（整块一起闪就没有层次了）',
    /tlBreath/.test(w.glyphAnim) && /tlShimmer/.test(w.breathAnim) && w.glyphAnim !== w.breathAnim,
    `glyph=${w.glyphAnim} breath=${w.breathAnim}`);
  ok('微光走 background-clip:text（鎏金扫过文字本身，不是加背景条）',
    /text/.test(w.shimmerClip), w.shimmerClip);
  ok('phase 真的走到了界面（09-30 至今第一次可见）', /换个说法再找/.test(w.head), w.head);
  ok('阶段清单展开且只有最后一条是"进行中"',
    w.working === true && w.steps === 2 && w.activeStep === 1 && w.pulses === 1 && w.open === true,
    `steps=${w.steps} active=${w.activeStep} pulses=${w.pulses}`);
  ok('展开后 grid-template-rows 真的撑开（折叠动画在动）', w.traceRows !== '0px' && w.traceRows !== '0', w.traceRows);

  const s = await cdp.evaluate(SETTLED);
  ok('定稿：停止呼吸、清单自动折叠、文案收成"想了 X.Xs"',
    s.working === false && s.open === false && /想了 \d+\.\d+s/.test(s.doneTxt), s.doneTxt);
  const timerDead = await cdp.evaluate('(tlLine.timer === 0)');
  ok('计时器已撤（否则每轮问答漏一个 interval，长跑会攒下来）', timerDead === true);

  fs.mkdirSync(OUT, { recursive: true });
  await cdp.evaluate('tlStart(); tlPhase("正在翻会议记录…"); tlPhase("第一遍没找到，换个说法再找…"); tlPhase("正在组织回答…"); tlSay("正在组织回答…", true); "ok"');
  await sleep(400);
  fs.writeFileSync(path.join(OUT, 'thought-line-working.png'), await cdp.screenshot({ format: 'png' }));
  await cdp.evaluate('tlStop(); "ok"');
  await sleep(450);
  fs.writeFileSync(path.join(OUT, 'thought-line-settled.png'), await cdp.screenshot({ format: 'png' }));
  console.log('  截图落盘：wb-rd-shots/thought-line-{working,settled}.png');

  cdp.kill();
  const bad = results.filter((x) => !x.pass).length;
  console.log(bad ? `\n❌ ${bad} 项未过` : '\n🎉 第 41 步在真浏览器里全部成立');
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error(`\n❌ 检查失败：${e && e.message}`);
  console.error('   先确认 SFU 服务器在跑：npm run start:sfu');
  process.exit(1);
});
