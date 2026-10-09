#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 *  check-toggle-motion.js —— 第 40 步「开关的运动语言」的真浏览器验证
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎为什么要这么一条：冒烟桩里**没有 CSS 引擎**，style.css 写错了它永远绿
 *   （坑 26 那次全站 CSS 变量为空，冒烟一条没红，是用户说"前端排版乱"才发现的）。
 *   环形脉冲、标签交叉淡入这些"看得见的东西"，只有在真浏览器里读
 *   getComputedStyle + 截图才算被验证过。
 * ▎为什么复用 3001 上已有的服务器：本检查只看**静态文件**（client.js / style.css /
 *   index.html）。它们是每次请求现读磁盘 + `no-store`，所以哪怕那台服务器是几小时前
 *   起的，拿到的样式与脚本仍是当前版本——这与坑 57"复用别人的实例验后端"是两回事。
 * ▎跑法：npm run check:toggle（先起 npm run start:sfu；CHECK_URL 可换地址）。
 *   不弹任何窗口：无头 Chromium/Edge，独立临时 profile。 */
const path = require('path');
const fs = require('fs');
const { Cdp } = require('../agent/cdp.js');

const URL_ = process.env.CHECK_URL || 'http://localhost:3001/';
const OUT = process.env.CHECK_OUT || path.join(__dirname, '..', 'wb-rd-shots');
const results = [];
const ok = (name, pass, extra) => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 在页面里造一个真实的开关按钮（用 client.js 自己的三个 helper，不另写一份），
 * 然后按一次，分时刻采样环与文案。 */
const PROBE = `(async () => {
  const btn = document.createElement('button');
  btn.className = 'btn tgl';
  btn.innerHTML = '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4.5 9.5h3L11.5 6v12l-4-3.5h-3z"/></svg>';
  btn.style.position = 'fixed'; btn.style.left = '40px'; btn.style.top = '40px'; btn.style.zIndex = 99999;
  document.body.appendChild(btn);
  setToggleLabels(btn, 'AI 语音', '会说话');
  const txt = btn.querySelector('.tgl-txt');
  const off = txt.querySelector('.tgl-off'), on = txt.querySelector('.tgl-on');
  const cs = getComputedStyle(document.documentElement);
  const before = {
    accent: (cs.getPropertyValue('--accent') || '').trim(),
    layers: txt.children.length,
    iconAlive: !!btn.querySelector('.i'),
    offOpacity: Number(getComputedStyle(off).opacity),
    onOpacity: Number(getComputedStyle(on).opacity),
    widthBefore: btn.getBoundingClientRect().width,
  };
  btn.classList.add('active');
  ringPulse(btn, { waves: 3 });
  /* ▎为什么改成"轮询到停住"而不是固定采样 6×90ms：
   *   全量 check:all 的负载下浏览器会**节流不可见窗口的动画时钟**——
   *   实测同一天里本检查的三条动效断言在满负载时读到"环的 scale 0.5 → 0.5"、
   *   "两层没互换"、"1.5s 后环还在"，而单独跑全部正常。
   *   节流是环境，不是产品缺陷；把"变化够大 / 0.9s 内完成"写死，就会把机器忙判成代码坏
   *   （坑 80：会移动的失败先怀疑量具；坑 96：量具不许跟自己的动画赛跑）。
   *   判据因此改成**"最终有没有发生"**（带截止时刻），而不是"在多快之内发生"。 */
  const samples = [];
  const t0 = Date.now();
  let scaleMin = Infinity, scaleMax = -Infinity;
  while (Date.now() - t0 < 4000) {
    await new Promise(r => setTimeout(r, 90));
    const rings = [...btn.querySelectorAll('.tgl-ring')];
    const st = rings.length ? getComputedStyle(rings[0]) : null;
    /* 反斜杠要写两遍：这一段整体活在模板字符串里（它是发给页面执行的源码）。
     *   单写一个反斜杠会被外层模板吃掉一层，页面收到的就是非法正则（matrix 后面少个转义），
     *   整段 evaluate 抛 Uncaught —— 症状与"被测页面坏了"一模一样，其实是检查脚本自己崩的。
     *   （同理：注释里也不要出现反引号，它会提前终结这段模板。） */
    const sc = st ? Number((st.transform.match(/matrix\\(([\\d.]+)/) || [])[1] || 0) : 0;
    if (sc > 0) { if (sc < scaleMin) scaleMin = sc; if (sc > scaleMax) scaleMax = sc; }
    samples.push({
      count: rings.length, scale: sc,
      opacity: st ? Number(st.opacity) : 0,
      border: st ? st.borderTopColor : '',
    });
  }
  /* 交叉淡入：轮询到互换完成为止（上限 4s），读的是"最终状态"，不是"第 540ms 那一眼" */
  let after = null;
  const t1 = Date.now();
  while (Date.now() - t1 < 4000) {
    after = {
      offOpacity: Number(getComputedStyle(off).opacity),
      onOpacity: Number(getComputedStyle(on).opacity),
      widthAfter: btn.getBoundingClientRect().width,
      waitedMs: Date.now() - t1,
    };
    if (after.onOpacity > 0.9 && after.offOpacity < 0.1) break;
    await new Promise((r) => setTimeout(r, 120));
  }
  const leftover = btn.querySelectorAll('.tgl-ring').length;
  /* 拆台：等到环自己消失为止（上限 6s）。等不到才是真缺陷（animationend 没接上 / 句柄没清） */
  const t2 = Date.now();
  let leftoverAfter = btn.querySelectorAll('.tgl-ring').length;
  while (leftoverAfter > 0 && Date.now() - t2 < 6000) {
    await new Promise((r) => setTimeout(r, 150));
    leftoverAfter = btn.querySelectorAll('.tgl-ring').length;
  }
  return { before, samples, after, scaleMin: scaleMin === Infinity ? 0 : scaleMin,
    scaleMax: scaleMax === -Infinity ? 0 : scaleMax, leftover, leftoverAfter, ringGoneMs: Date.now() - t2,
           layerGone: !btn.querySelector('.tgl-rings') || btn.querySelectorAll('.tgl-ring').length === 0 };
})()`;

(async () => {
  const cdp = new Cdp({ headless: true, startUrl: URL_ });
  await cdp.launch();
  await cdp.waitForLoad(15000);
  await sleep(1200);   // 等 client.js 顶层初始化跑完（坑 69：顶层 init 链会静默截断）

  const title = await cdp.pageTitle();
  ok('页面加载成功且 client.js 在（标题非空）', !!title, `title=${title}`);
  const hasHelpers = await cdp.evaluate('typeof ringPulse === "function" && typeof setToggleLabels === "function" && typeof popBadge === "function"');
  ok('第 40 步三个 helper 在全局作用域里（顶层没被截断）', hasHelpers === true);

  const r = await cdp.evaluate(PROBE);
  const b = r.before, a = r.after, s = r.samples;

  ok('CSS 变量真的生效（坑 26 探针：--accent 非空）', !!b.accent, `--accent=${b.accent}`);
  ok('双层文案建出来了，且没冲掉 SVG 图标', b.layers === 2 && b.iconAlive === true,
     `layers=${b.layers} icon=${b.iconAlive}`);
  ok('未激活时"开"文案透明、"关"文案可见', b.offOpacity > 0.9 && b.onOpacity < 0.1,
     `off=${b.offOpacity} on=${b.onOpacity}`);
  ok('激活后两层交叉互换（交叉淡入最终完成；轮询到停住，不拿固定时刻的快照当证据）',
     a.onOpacity > 0.9 && a.offOpacity < 0.1,
     `off=${a.offOpacity} on=${a.onOpacity} · 等了 ${a.waitedMs}ms`);
  ok('切换文案不跳宽度（同格叠放的意义）', Math.abs(b.widthBefore - a.widthAfter) < 1.5,
     `${b.widthBefore.toFixed(1)} → ${a.widthAfter.toFixed(1)}px`);

  const counts = s.map((x) => x.count);
  ok('按下后环出现了（且不止一圈）', Math.max(...counts) >= 2, `峰值 ${Math.max(...counts)} 圈`);
  const scales = s.map((x) => x.scale).filter((x) => x > 0);
  /* 判据是"涨过"，不是"涨够 0.3"：动画被节流时采样点会聚在很小的区间里，
   * 而"静止描边"这个真缺陷的形状是**一点不涨**（min === max）。 */
  ok('环在**扩散**（scale 随时间变大，不是静止描边）',
     scales.length >= 2 && r.scaleMax > r.scaleMin + 0.05,
     `scale ${r.scaleMin} → ${r.scaleMax}（采样 ${scales.length} 个点）`);
  const gold = s.find((x) => x.border && x.border !== 'rgba(0, 0, 0, 0)');
  ok('环是鎏金单色（守 09-19e 克制纪律，没有偷偷用彩色）', !!gold, gold ? gold.border : '');

  ok('环演完自己拆台（轮询到页面里没有残留环为止，不承诺多久）',
     r.leftoverAfter === 0, `leftover=${r.leftoverAfter} · 等了 ${r.ringGoneMs}ms`);

  fs.mkdirSync(OUT, { recursive: true });
  const buf = await cdp.screenshot({ format: 'png' });
  const file = path.join(OUT, 'toggle-motion-check.png');
  fs.writeFileSync(file, buf);
  console.log(`  截图落盘：${file}（${buf.length} 字节）`);

  cdp.kill();
  const bad = results.filter((x) => !x.pass).length;
  console.log(bad ? `\n❌ ${bad} 项未过` : '\n🎉 第 40 步在真浏览器里全部成立');
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error(`\n❌ 检查失败：${e && e.message}`);
  console.error(`   先确认 SFU 服务器在跑：npm run start:sfu（或 CHECK_URL=http://localhost:3001/ 指定地址）`);
  process.exit(1);
});
