#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 *  check-layer-cover.js —— 「一个覆盖层悄悄盖住另一个」的真浏览器回归
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎触发这件事的缺陷：用户报"让 AI 调白板之后字幕不可用了"。查下去不是字幕逻辑坏了，
 *   而是白板覆盖层 .board-overlay 是 `inset:0; z-index:6`，而字幕条 + 控制坞所在的
 *   .bottom-stack 是 z-index:5 —— **白板一开，字幕条和整排按钮一起被盖住**。
 *   用户看到的现象恰好就是"字幕不可用了"，而代码里字幕那套状态机一个字都没错。
 * ▎为什么这类缺陷总能活下来：它不报错、不改变任何状态，只改变"谁在上面"。
 *   冒烟桩没有层叠上下文，测不出来；只看截图也看不出来
 *   （截图那一刻要么没开白板，要么开着的白板正好挡住了要看的东西）。
 * ▎正解是让页面自己回答："我要点这块地方，浏览器会把事件给谁？"
 *   用 document.elementFromPoint 命中测试 —— 这就是本脚本干的事。
 * ▎跑法：npm run check:layers（先起服务器，或用 CHECK_URL 指到专用端口） */
const path = require('path');
const { Cdp } = require(path.join(__dirname, '..', 'agent', 'cdp.js'));

const URL_ = (process.env.CHECK_URL || 'http://localhost:3001/') + '?nosw=1';
const results = [];
const ok = (name, pass, extra) => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`);
};

/* 命中测试：这个元素中心点的"实际接收者"是不是它自己（或它的后代）。
 * 允许后代是因为按钮中心往往落在里面的 svg/span 上。 */
const HIT = `(function(sel){
  const el = document.querySelector(sel);
  if (!el) return { miss: true };
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return { zero: true, w: Math.round(r.width), h: Math.round(r.height) };
  const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
  const top = document.elementFromPoint(x, y);
  if (!top) return { none: true, x, y };
  return { x, y, hit: top === el || el.contains(top), who: top.id ? '#' + top.id : (top.getAttribute('class') || top.tagName).split(' ')[0] };
})`;

/* ★ 2026-10-09 注入浏览器之前先让同一个引擎读一遍这些串。
 *   模板字符串**内部**的注释里只要出现反引号，模板就被提前截断——源文件语法没错、node --check 全过，
 *   错在拼出来的那段代码；到浏览器里炸的时候，本脚本一条断言都没跑到（详见 scripts/inject-check.js 头部）。 */
require('./inject-check.js').assertCompiles(__filename, { HIT });

(async () => {
  const cdp = new Cdp({ headless: true, startUrl: URL_, windowSize: { width: 1440, height: 900 } });
  await cdp.launch();
  await cdp.waitForLoad(15000);
  await new Promise((r) => setTimeout(r, 1200));

  /* ▸ 版本指纹（2026-10-04 补齐——本轮教训：**没有指纹的检查测的是缓存，不是代码**）。
   *   这条检查原先是 13 件套里唯一没做这一步的，而它量的是 CSS 层叠与容器结构——
   *   缓存里躺着任意一份旧 style.css，命中测试的结果就与本轮改动无关了，
   *   而报出来的仍然是"层叠关系正确"。判据（坑 40 + 57）：
   *   **先证明"我量的是现在这一版"，再谈命中不命中。** */
  const fp = await cdp.evaluate(`(async () => {
    const js = await (await fetch('client.js', { cache: 'no-store' })).text();
    const css = await (await fetch('style.css', { cache: 'no-store' })).text();
    return { js: js.includes('setBoardOpen') && js.includes('initBottomStackVar'),
             css: css.includes('.bottom-stack') && css.includes('.board-overlay'),
             stack: !!document.querySelector('.bottom-stack'),
             varH: getComputedStyle(document.documentElement).getPropertyValue('--stack-h').trim() };
  })()`);
  ok('页面加载的是本轮代码（client.js 有底部栈测量、style.css 有 .bottom-stack）',
    fp.js === true && fp.css === true, `js=${fp.js} css=${fp.css}`);
  /* 命中测试依赖"底部那一列真的存在"——不存在就说明布局是旧的一份，
     这时"字幕条可点"根本不算证据（坑 63：断言依赖的前提也要被验证）。 */
  ok('前提：字幕条与控制坞确实同属一个底部列容器（命中测试才有意义）',
    fp.stack === true, `--stack-h=${fp.varH || '(未量到)'}`);

  await cdp.evaluate(`(function(){
    for (const id of ['authOverlay','prejoin','roomPanel']) { const e=document.getElementById(id); if (e) e.classList.add('hidden'); }
    const bar = document.getElementById('captionBar'); if (bar) bar.classList.remove('hidden');
    const t = bar && bar.querySelector('.caption-text'); if (t) t.textContent = '这是一句正在显示的字幕';
    return 'ok';
  })()`);

  const base = await cdp.evaluate(`${HIT}('.caption-bar')`);
  ok('不开白板时，字幕条收得到自己的点击', base.hit === true, JSON.stringify(base));

  await cdp.evaluate(`(function(){ setBoardOpen(true); return 'ok'; })()`);
  await new Promise((r) => setTimeout(r, 400));
  const withBoard = await cdp.evaluate(`${HIT}('.caption-bar')`);
  const dock = await cdp.evaluate(`${HIT}('.controls')`);
  /* 这一条就是用户报的那个现象：白板是"舞台级"的内容层，不该把会议级的
     字幕条与整排控制按钮一起盖掉。 */
  ok('★ 白板打开后，字幕条仍然可见可点（用户报的"字幕不可用"就是这里）',
    withBoard.hit === true, `命中=${withBoard.who} ${JSON.stringify(withBoard)}`);
  ok('★ 白板打开后，控制坞仍然收得到点击（否则白板一开整排按钮全废）',
    dock.hit === true, `命中=${dock.who} ${JSON.stringify(dock)}`);
  /* 反过来也要成立：白板自己得能画 —— 不能为了露出字幕把画布压到别人下面 */
  const canvas = await cdp.evaluate(`${HIT}('#boardCanvas')`);
  ok('白板画布自己仍在最上层（能画）', canvas.hit === true, JSON.stringify(canvas));

  await cdp.evaluate(`(function(){ setBoardOpen(false); return 'ok'; })()`);
  await new Promise((r) => setTimeout(r, 300));
  const closed = await cdp.evaluate(`${HIT}('.caption-bar')`);
  ok('关掉白板后字幕条回到原位（不是一次性修复）', closed.hit === true, JSON.stringify(closed));

  const bad = results.filter((x) => !x.pass).length;
  cdp.kill();
  console.log(bad ? `\n❌ ${bad} 项未过` : '\n🎉 层叠关系正确：白板盖画面，但不盖会议级控件');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(`\n❌ 检查失败：${e && e.message}`); process.exit(1); });
