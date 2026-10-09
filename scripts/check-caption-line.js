#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 *  check-caption-line.js —— 「整句话显示出来，但不越出线」的真浏览器回归
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎触发这件事的是用户那句话："实时字幕识别的长度太短了，要整句话能显示出来但不越出线。"
 *   量下去才发现"短"有两半，各自要各自修：
 *     ① 服务端只给 2 秒一段分别转写再拼 → 一句话被切成碎片（这一半见 sfu/server.js
 *        的"整句重转"，实测逐字全对 1/6 → 3/6）；
 *     ② 界面把正文锁在 `white-space:nowrap` 的单行胶囊里，还要与八个控件抢宽度
 *        → 哪怕服务端给出完整一句，屏幕上也只露前几个字加一个省略号。
 *   ▎② 就是本脚本的量具。为什么必须真浏览器：这是**层叠与排版**的问题，
 *   冒烟桩没有布局引擎，`-webkit-line-clamp` 生不生效、var() 有没有被吃掉、
 *   正文实际拿到多少像素宽——全都不是读源码能确定的（坑 78：样式缺失不报错，只让界面变丑；
 *   反过来"样式写对了但浏览器没照做"也一样测不出来）。
 * ▎跑法：npm run check:caption（先起服务器，或用 CHECK_URL 指到专用端口）
 *   例：CHECK_URL=http://localhost:3021/ npm run check:caption                       */
const path = require('path');
const { Cdp } = require(path.join(__dirname, '..', 'agent', 'cdp.js'));

const URL_ = (process.env.CHECK_URL || 'http://localhost:3001/') + '?nosw=1';
const results = [];
const ok = (name, pass, extra) => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 三条长度不同的句子，各管一件事（长度是按 1440 档实测的容量定的：
 *   正文可用宽度 ~639px ÷ 15px 字号 ≈ 每行 42 个汉字，预留两行 ≈ 84 字）：
 *   LONG  —— 一句真实长度的长请求（55 字）：应当**两行完整显示，不被裁**；
 *   HUGE  —— 拼接出来的超长 blob（>84 字）：应当**裁在两行内 + 省略号**，全文进 title。
 * ▸ 为什么判据要按容量定而不是随手写一句：第一版我给 LONG 写了 40 字，它在 1440 档
 *   正好落进一行，于是"排到了第二行"那条断言红得莫名其妙——**红的不是产品，是量具的
 *   样本选错了**（坑 75：基准样本必须长得像真实负载，这里要长得像被测的边界）。 */
const LONG = '小明，帮我把这条记录一下，明天下午三点开产品评审会，会议室在十二楼东边那间，另外把上周遗留的验收问题和压测报告也一起带上，别忘了同步给测试组。';
const HUGE = LONG + '还有那场周会的结论我也要同步给你，就是那个排期要等到下周才能定下来的事情，记得提醒大家把测试环境的账号先申请好，别到时候又卡在权限上没人能处理。';

/* 把字幕条摆出来并量几何：一次求值拿全所有数，避免"两次读取之间页面又变了"。
 * ▸ 走生产函数 showCaptionBar()（不是自己拼 DOM）：测的是真路径，
 *   以后 showCaptionBar 改了，这里跟着一起红，而不是"测试自己还在绿"。 */
const PROBE = `(function(text, interim){
  if (typeof showCaptionBar !== 'function') return { nofn: true };
  showCaptionBar('小张', text, !!interim);
  const bar = document.querySelector('.caption-bar');
  const line = document.querySelector('.cap-line');
  const ct = document.getElementById('captionText');
  const tools = document.querySelector('.cap-tools');
  const dock = document.querySelector('.controls');
  if (!bar || !line || !ct) return { miss: true };
  const cs = getComputedStyle(ct);
  const b = bar.getBoundingClientRect(), l = line.getBoundingClientRect(),
        c = ct.getBoundingClientRect(), t = tools ? tools.getBoundingClientRect() : null,
        d = dock ? dock.getBoundingClientRect() : null;
  return {
    barW: Math.round(b.width), barH: Math.round(b.height),
    lineH: Math.round(l.height), textW: Math.round(c.width), textH: Math.round(c.height),
    // 排版是否真的换行：单行的话 scrollHeight ≈ 一行高
    oneLinePx: Math.round(parseFloat(cs.lineHeight) || 0),
    scrollH: ct.scrollHeight, clientH: ct.clientHeight,
    clamp: cs.webkitLineClamp || cs.lineClamp || '(none)',
    wrap: cs.whiteSpace,
    lines: cs.lineHeight,
    title: ct.getAttribute('title') || '',
    cls: ct.className,
    toolsRow: t ? { top: Math.round(t.top), bottom: Math.round(t.bottom), w: Math.round(t.width) } : null,
    /* 条子自己是"一列"吗？（两行卡的根）——顺带把 CSS 有没有真的被应用打出来：
       本轮改的是 style.css，而坑 26 那一类"块注释里意外写出闭合序列，吞掉后面整块规则"
       的表现正是文件里规则都在、浏览器却一条都没应用，所以判据要看 computed 而不是看源码。 */
    barDisplay: getComputedStyle(bar).display,
    barDir: getComputedStyle(bar).flexDirection,
    /* 调试用：条子的 max-width 与实际父容器宽度——"为什么条子是这个宽度"这类问题
       只靠读源码猜不动，让浏览器把 computed 交出来一次就定死（坑 26/78 家族）。 */
    barMaxW: getComputedStyle(bar).maxWidth,
    parentW: bar.parentElement ? Math.round(bar.parentElement.getBoundingClientRect().width) : null,
    parentCls: bar.parentElement ? bar.parentElement.className : null,
    lineW: Math.round(l.width),
    barBottom: Math.round(b.bottom), dockTop: d ? Math.round(d.top) : null,
    // 元素是不是真的没越出它的容器（line 这一行的盒子）
    insideLine: c.bottom <= l.bottom + 1 && c.right <= l.right + 1 && c.left >= l.left - 1,
    inViewport: b.left >= -1 && b.right <= innerWidth + 1,
    docScrollX: document.documentElement.scrollWidth, innerW: window.innerWidth,
  };
})`;

/* ★ 2026-10-09 注入浏览器之前先让同一个引擎读一遍这些串。
 *   模板字符串**内部**的注释里只要出现反引号，模板就被提前截断——源文件语法没错、node --check 全过，
 *   错在拼出来的那段代码；到浏览器里炸的时候，本脚本一条断言都没跑到（详见 scripts/inject-check.js 头部）。 */
require('./inject-check.js').assertCompiles(__filename, { PROBE });

(async () => {
  const cdp = new Cdp({ headless: true, startUrl: URL_, windowSize: { width: 1440, height: 900 } });
  await cdp.launch();
  await cdp.waitForLoad(15000);
  await sleep(1200);

  /* ── 0. 版本指纹：先证明"我量的是现在这一版"，再谈几何（坑 40/57）──
   *   缓存里躺着任意一份旧 style.css，下面每一条"不越线"都与本轮改动无关。 */
  const fp = await cdp.evaluate(`(async () => {
    const css = await (await fetch('style.css', { cache: 'no-store' })).text();
    const html = await (await fetch('index.html', { cache: 'no-store' })).text();
    return { capLine: css.includes('.cap-line') && css.includes('--cap-lines'),
             clamp: css.includes('-webkit-line-clamp'),
             twoRows: html.includes('class="cap-line"') && html.includes('class="cap-tools"') };
  })()`);
  ok('页面加载的是本轮代码（style.css 有 .cap-line/--cap-lines，index.html 是两行结构）',
    fp.capLine === true && fp.clamp === true && fp.twoRows === true, JSON.stringify(fp));

  /* ── 0b. 摆进"已经在开会"的形态（与 check:dock 同一手法）──
   *   ▸ 为什么必须先做这一步：字幕条与控制坞在 .stage 里，而首屏是登录卡 + 预览页两张遮罩。
   *     不揭开的话每个盒子都是 0×0，"不越线"会**因为压根没量到东西而通过**
   *     （坑 63/55：断言依赖的前提本身要被验证）。 */
  await cdp.evaluate(`(function(){
    for (const id of ['authOverlay', 'prejoin', 'roomPanel']) {
      const e = document.getElementById(id); if (e) e.classList.add('hidden');
    }
  })()`);
  await sleep(200);

  /* ── 1. 整句上屏：两行卡给正文的宽度必须显著大于旧版那条单行胶囊 ── */
  const g = await cdp.evaluate(`${PROBE}(${JSON.stringify(LONG)}, false)`);
  if (process.env.CHECK_DEBUG) console.log('   [几何]', JSON.stringify(g));
  if (g.nofn || g.miss) {
    ok('字幕条能被生产函数摆出来', false, JSON.stringify(g));
  } else {
    /* 先证明"量具量到了真实盒子"：0×0 的条子会让下面每一条几何断言都空转通过。 */
    ok('字幕条真的占了面积（条高 > 40px，量具不是在读一个 0×0 的盒子）',
      g.barH > 40 && g.barW > 200, `条 ${g.barW}×${g.barH}`);
    /* 旧版实测正文只有 ~110px（八个控件挤在同一排）。这里要求正文拿到条宽的一半以上，
       才是"整句话有地方待"。 */
    ok('整句字幕有地方待：正文宽度 > 条宽的 50%（旧版被八个控件挤到只有一百多像素）',
      g.textW > g.barW * 0.5, `正文 ${g.textW}px / 条 ${g.barW}px`);
    ok('正文真的换行了（white-space 不是 nowrap；单行 nowrap 是"只露前几个字"的字面原因）',
      g.wrap !== 'nowrap', `white-space=${g.wrap}`);
    ok('行数上限生效：-webkit-line-clamp 解析成数字 2（var() 若没被吃掉才会是这样）',
      g.clamp === '2', `-webkit-line-clamp=${g.clamp}`);
    ok('整句真的排到了第二行（文本高度 ≈ 2 行，而不是被压成一行的省略号）',
      g.textH >= Math.round(g.oneLinePx * 1.7), `一行=${g.oneLinePx}px 实际=${g.textH}px`);
    /* CSS 写了不等于浏览器照做：源码里两条规则都在、浏览器却因为一个注释把整块吞掉，
       界面照样"看起来是旧的"（坑 26/78 的同一条形状），所以这里读 computed 而不是读文件。 */
    ok('字幕条自己是一个"列"（computed display=flex + flex-direction=column，两行结构真的生效）',
      g.barDisplay === 'flex' && g.barDir === 'column', `display=${g.barDisplay} dir=${g.barDir}`);
    ok('控件那一排没有比条子还宽（第一版实测到 1020px 压破 669px 的条，就是这里抓的）',
      !g.toolsRow || g.toolsRow.w <= g.barW + 1, `控件排 ${g.toolsRow && g.toolsRow.w}px / 条 ${g.barW}px`);
    /* ★ 条宽上限**真的生效**（不是写在文件里被后面那条 .bottom-stack>* 的 max-width 吃掉）。
     *   ▸ 这条就是本轮我自己踩出来的"写了但没生效"（坑 76）：第一版在这里写 max-width，
     *     量到 computed = 100%、条子铺满 1050px；换成 width 才落下来。
     *     判据看的是浏览器算出来的宽度，而不是源码里那行有没有——两者不一致时错的是代码。 */
    ok('宽屏下条子有上限（≤ 880px：句子不该被拉成一整行横贯屏幕，控件也不该飘太远）',
      g.barW <= 881, `条 ${g.barW}px（computed max-width=${g.barMaxW}，父容器 ${g.parentW}px）`);
  }

  /* ── 2. 不越出线：超长句子被裁在预留的两行里，容器与视口都不许溢出 ── */
  const x = await cdp.evaluate(`${PROBE}(${JSON.stringify(HUGE)}, false)`);
  if (!x.miss && !x.nofn) {
    ok('超长句不越线：正文盒子仍在"整句行"容器内（超出部分被裁而不是顶破条子）',
      x.insideLine === true, JSON.stringify({ insideLine: x.insideLine, textH: x.textH, lineH: x.lineH }));
    ok('超长句确实被裁了（scrollHeight > clientHeight）——说明这条断言有内容可判，不是空转',
      x.scrollH > x.clientH, `scroll=${x.scrollH} client=${x.clientH}`);
    ok('裁掉的字一个字不丢：全文挂进 title（悬浮即读完整句）',
      x.title.includes('记得提醒大家把测试环境的账号先申请好'), `title=${x.title.slice(0, 24)}…`);
    ok('字幕条整体没有越出视口（窄化到 1440 这一档也一样）',
      x.inViewport === true && x.docScrollX <= x.innerW + 1,
      `条在视口内=${x.inViewport} 文档宽=${x.docScrollX}/${x.innerW}`);
    /* 条高恒定是"丝滑"的关键：句子长短变化时不许把底下的控制坞顶来顶去。
     * 这里量两次的条高（短句 vs 超长句），必须一模一样。 */
    ok('条高不随句长抖动（短句与超长句量到同一个高度）',
      Math.abs(g.barH - x.barH) <= 1, `短句 ${g.barH}px vs 超长 ${x.barH}px`);
  }

  /* ── 3. 控件那一排没有压住正文，也没有压住控制坞 ── */
  if (!x.miss && !x.nofn) {
    ok('控件排落在正文之下（两行各得其所，不再挤同一排）',
      !!x.toolsRow && x.toolsRow.top >= x.lineH - 2,
      JSON.stringify(x.toolsRow));
    if (x.dockTop != null) {
      ok('字幕条底边没有压进控制坞（.bottom-stack 那一列的既有契约没被改坏）',
        x.barBottom <= x.dockTop + 1, `条底=${x.barBottom} 坞顶=${x.dockTop}`);
    }
  }

  /* ── 3b. 留一张现场图给人复核（坑 96：几何数字全绿而画面是歪的，这种事已经发生过一次。
   *   "条高恒定、不越线、控件在第二行"这些数都对，不代表它*好看*——所以截下来，
   *   连条子周围那一块一起截，让人眼当最后一道判据。 */
  try {
    const fs = require('fs');
    const path2 = require('path');
    const box = await cdp.evaluate(`(function(){
      const b = document.querySelector('.caption-bar'); if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: Math.max(0, r.left - 24), y: Math.max(0, r.top - 24),
               width: Math.min(innerWidth, r.width + 48), height: r.height + 48 };
    })()`);
    if (box) {
      const buf = await cdp.screenshot({ format: 'png', clip: box });
      const outDir = path2.join(__dirname, '..', 'wb-rd-shots');
      fs.mkdirSync(outDir, { recursive: true });
      const outFile = path2.join(outDir, 'caption-card.png');
      fs.writeFileSync(outFile, buf);
      console.log(`  📷 现场图：${outFile}（${(buf.length / 1024).toFixed(0)}KB，给人复核用）`);
    }
  } catch (e) { console.log('  （截图没拿到，不影响判定：', e.message, '）'); }

  /* ── 4. 半句（interim）与定稿在样式上分得开 ──
   *   ▸ 这条原先写成 `ok(..., true, ...)`——永真断言（坑 110 那一族：假绿不需要代码出错，
   *     只需要断言不成立也不会红）。现在真的比两次的 class。 */
  const i1 = await cdp.evaluate(`${PROBE}('小明，帮我记一下', true)`);
  const i2 = await cdp.evaluate(`${PROBE}('小明，帮我记一下明天下午三点的评审会。', false)`);
  if (!i1.miss && !i2.miss) {
    ok('半句挂 .interim、定稿不挂（"这句定稿了没有"在界面上要说得清）',
      /interim/.test(i1.cls) && !/interim/.test(i2.cls), `半句="${i1.cls}" 定稿="${i2.cls}"`);
  }

  /* ── 5. 手机那一档：正文给三行，且仍然不越线、不换出横向滚动 ──
   *   ▸ 用 CDP 的 Emulation.setDeviceMetricsOverride 改视口（与 check:screenshare 同一手法），
   *     而不是重开一台浏览器：一条媒体查询的命中情况，重开反而多 6 秒和一次缓存变量。 */
  await cdp.evaluate(`(function(){
    const bar = document.querySelector('.caption-bar'); if (bar) bar.classList.add('hidden');
  })()`);
  await cdp._send(cdp.pageWs, 'Emulation.setDeviceMetricsOverride',
    { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(500);
  const m = await cdp.evaluate(`${PROBE}(${JSON.stringify(HUGE)}, false)`);
  if (!m.miss && !m.nofn) {
    ok('窄屏（390px）三行档：行数上限解析成 3，容器高度跟着长（不是裁掉第三行看不见）',
      m.clamp === '3' && m.lineH >= Math.round(m.oneLinePx * 2.8),
      `clamp=${m.clamp} 行容器=${m.lineH}px 一行=${m.oneLinePx}px`);
    ok('窄屏不越线：正文仍在容器内且页面没有横向滚动',
      m.insideLine === true && m.docScrollX <= m.innerW + 1,
      `inside=${m.insideLine} 文档宽=${m.docScrollX}/${m.innerW}`);
  } else {
    ok('窄屏摆出字幕条', false, JSON.stringify(m));
  }

  await cdp.kill();
  const bad = results.filter((r) => !r.pass).length;
  console.log(`\n结果: ${results.length - bad} 项通过 / ${bad} 项失败`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('检查异常:', e); process.exit(1); });
