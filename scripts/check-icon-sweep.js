#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 *  check-icon-sweep.js —— 「控件去 emoji」的真浏览器验收
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎为什么这条必须在真浏览器里跑，冒烟桩不算：
 *   这一轮改的是**图标与它的 CSS 尺寸规则**（第 34 节）。冒烟桩没有 CSS 引擎，
 *   它能证明"源码里写了 .pin-btn .i { width:12px }"，证不了"浏览器真的把它算成 12px"。
 *   而这里最可能出的事故恰好是 CSS 侧的：**一个没有尺寸规则的 <svg> 会按默认 300×150 渲染**，
 *   于是一颗小图标把整块画面格撑爆——正是坑 26（全站 CSS 变量为空、冒烟一条没红）的镜像版：
 *   代码全对、界面塌掉，只有看得见的人才发现。所以本脚本的主检查是 B：
 *   **把页面上每一个 svg.i 的实际渲染宽度量一遍，超规矩的直接列名字**。
 * ▎跑法：npm run check:icons（先起 npm run start:sfu）。
 * ▎与 check:visual 的分工：那条看"动效真的在动"，这条看"图标真的没把布局搞坏"。 */
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
const EMOJI = '[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{26FF}\\u{2700}-\\u{27BF}]';
/* 本项目排版约定用到的几个符号不算 emoji（★ 是分节记号、▸▎ 是引用线、→ 是箭头）：
   它们在 2600 段里，一起排除掉，否则 G 会天天报"残留"而没人信这条断言。
   ✕（关闭）与 ⛶/▣/⟳（窗口控制）同理——是字形不是贴纸，没有颜色、也不显模板感。 */
const NOT_EMOJI = '★▸▎─═→↑↓←↳①②③④⑤⑥⑦⑧⑨⑩✕✖⛶▣▢▦⟳↶⌃≠≤⚙';

(async () => {
  const cdp = new Cdp({ headless: true, startUrl: START_URL });
  await cdp.launch();
  await cdp.waitForLoad(15000);
  await sleep(1500);

  /* A. 先证明"测的是这次的代码"：SW 会绕过 HTTP 缓存头（坑 40），
   *    所以取 nosw=1 + 让页面自己抓两份源码对指纹。 */
  const fp = await cdp.evaluate(`(async () => {
    const js = await (await fetch('client.js', { cache: 'no-store' })).text();
    const css = await (await fetch('style.css', { cache: 'no-store' })).text();
    return { js: /volMute|pin\\b[\\s\\S]{0,40}ICONS\\.pin/.test(js) && js.includes('capLatNum'),
             css: css.includes('.pin-btn .i') && css.includes('.sw-green') };
  })()`);
  ok('A 页面加载的是本轮 client.js（音量三态图标 + 读数子节点）', fp && fp.js === true);
  ok('A 样式也是本轮（第 34 节的图标尺寸与色点规则在位）', fp && fp.css === true);
  if (!(fp && fp.js && fp.css)) { cdp.kill(); process.exit(1); }

  /* 露出应用壳：登录卡与预览页是遮罩层，控件们在它们下面 */
  await cdp.evaluate(`(function(){
    for (const id of ['authOverlay','prejoin']) { const e = document.getElementById(id); if (e) e.classList.add('hidden'); }
    const bar = document.getElementById('captionBar'); if (bar) bar.classList.remove('hidden');
    return 'ok';
  })()`);
  await sleep(400);

  /* B. 主检查：每个 svg.i 的实际渲染宽度 ≤ 24px（没写尺寸规则的那一类事故）
   *    越界的一定要报出"在哪"，否则修的人还得自己找。 */
  const blown = await cdp.evaluate(`(function(){
    /* 注意用 getAttribute('class')：SVG 元素的 el.className 是 SVGAnimatedString，
       String() 会得到 "[object SVGAnimatedString]"，定位信息整个作废（本脚本自己踩过一次）。 */
    const cls = (e) => e.getAttribute ? (e.getAttribute('class') || '') : '';
    const loc = (el) => {
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const id = n.id ? '#' + n.id : (cls(n).trim() ? '.' + cls(n).trim().split(/\\s+/)[0] : '');
        if (id) return id;
      }
      return 'body';
    };
    const bad = [];
    const all = document.querySelectorAll('svg.i');
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;         // 隐藏中的控件不算（本来就 display:none）
      if (r.width > 24 || r.height > 24) bad.push(loc(el) + '@' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
    return { n: all.length, bad: bad.slice(0, 8) };
  })()`);
  ok('B 页面上每个行内图标都按规矩大小（没有"没写尺寸规则→撑爆布局"的）',
    blown.n > 0 && blown.bad.length === 0, `svg=${blown.n}${blown.bad.length ? ' 越界: ' + blown.bad.join(', ') : ''}`);

  /* C. 字幕读数：图标留在 HTML、数字由 JS 写进子节点 —— 两半都要成立 */
  const lat = await cdp.evaluate(`(function(){
    const el = document.getElementById('capLat');
    const num = document.getElementById('capLatNum');
    const before = !!el.querySelector('svg.i');
    renderCapLatency(2400, { wait: 900, trans: 1500 });
    return { before, after: !!el.querySelector('svg.i'), num: num && num.textContent,
             w: Math.round(el.getBoundingClientRect().width), cls: el.className };
  })()`);
  ok('C 延迟读数：写数字之后图标还在（老的 textContent 整写会把它抹掉）',
    lat.before === true && lat.after === true && lat.num === '2.4s' && lat.w > 20,
    `num=${lat.num} 宽=${lat.w}px ${lat.cls}`);

  /* D. 字幕徽标：图标由"此刻是哪条链路在干活"决定，且判据只有一处 */
  const st = await cdp.evaluate(`(function(){
    renderCapStatus('服务器转写（whisper）', 'live');
    const s1 = document.querySelector('#capStatus svg.i path');
    const t1 = document.getElementById('capStatus').textContent.trim();
    renderCapStatus('识别服务不可达', 'bad');
    const s2 = document.querySelector('#capStatus svg.i path');
    return { screen: s1 && s1.getAttribute('d'), alert: s2 && s2.getAttribute('d'),
             t1, t2: document.getElementById('capStatus').textContent.trim(),
             svgKept: document.querySelectorAll('#capStatus svg.i').length };
  })()`);
  ok('D 字幕徽标：服务器态与故障态换的是不同图形（不是各带一个表情）',
    !!st.screen && !!st.alert && st.screen !== st.alert && st.svgKept === 1,
    `文字="${st.t1}" → "${st.t2}"`);

  /* E. 画面格上的两颗悬浮按钮：钉选 / 请求控制（hover 才显形，但尺寸照样量得到） */
  const tile = await cdp.evaluate(`(function(){
    const box = document.createElement('div');
    box.className = 'video-box';
    box.style.cssText = 'width:320px;height:180px';
    document.getElementById('videoGrid').appendChild(box);
    addPinBtn(box, 'peer-demo');
    addCtlBtn(box, 'peer-demo');
    const pick = (sel) => {
      const btn = box.querySelector(sel);
      const svg = btn && btn.querySelector('svg.i');
      const r = svg && svg.getBoundingClientRect();
      return { has: !!svg, w: r && Math.round(r.width), txt: btn && btn.textContent.trim(),
               display: btn && getComputedStyle(btn).display };
    };
    const out = { pin: pick('.pin-btn'), ctl: pick('.remote-ctl-btn') };
    box.remove();
    return out;
  })()`);
  ok('E 钉选按钮：线性图标 + 文案同行排布，图标 12px 级',
    // 注：.pin-btn 是 position:absolute，浏览器会把 inline-flex 折成 flex —— 两者都对，
    //     要断言的是"图标和文字在同一个 flex 行里"，不是关键字本身。
    tile.pin.has === true && tile.pin.w > 8 && tile.pin.w <= 16 && tile.pin.txt === '钉选' && /flex$/.test(tile.pin.display),
    `图标=${tile.pin.w}px 显示=${tile.pin.display} 文字=${tile.pin.txt}`);
  ok('E 请求控制按钮同一形状（同一节 CSS 兜住两颗）',
    tile.ctl.has === true && tile.ctl.w > 8 && tile.ctl.w <= 16 && tile.ctl.txt === '请求控制',
    `图标=${tile.ctl.w}px 文字=${tile.ctl.txt}`);

  /* F. 抠像键色两颗：彩色 emoji → 品牌色点（形状与颜色都得真算出来）
   *    滤镜面板平时是收起来的，display:none 下量不到尺寸——先把它显出来再量。 */
  const sw = await cdp.evaluate(`(function(){
    const panel = document.querySelector('.fx-panel');
    const was = panel && panel.className;
    if (panel) panel.classList.remove('hidden');
    const e = document.querySelector('.fx-chip .sw-green');
    if (!e) return null;
    const cs = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    if (panel && was) panel.className = was;
    return { w: Math.round(r.width), h: Math.round(r.height), bg: cs.backgroundColor, radius: cs.borderTopLeftRadius };
  })()`);
  ok('F 键色色点：是个有颜色的小方块（emoji 绿方块换成 CSS 画的，颜色写在样式里不写内联）',
    !!sw && sw.w >= 8 && sw.h >= 8 && /rgb/.test(sw.bg) && !/^rgba\\(0, 0, 0, 0\\)$/.test(sw.bg),
    sw ? `${sw.w}x${sw.h} ${sw.bg} r=${sw.radius}` : '没找到 .sw-green');

  /* G. 整页可见文字里不该再有 emoji —— 表情回应条除外（那些本来就是 emoji，语义正确）。
   *    命中的时候报出**在哪个容器**，否则只有字符没人找得到地方。 */
  const left = await cdp.evaluate(`(function(){
    const keep = new RegExp('[${NOT_EMOJI}]', 'g');
    const hits = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = walk.nextNode());) {
      const p = n.parentElement;
      /* 两处按语义排除：
         · .react-bar —— 那些本来就是 emoji 表情，换成线性图标反而是错的；
         · .log-panel —— 「流程日志」是终端式文本控制台，行首 ✅/❌ 是文本记号不是控件图标。
           这一轮的对象始终是"部件上的小图标"，把日志也扫干净属于误伤（会逼出一堆没意义的改动）。 */
      if (!p || p.closest('.react-bar, .log-panel, #log, script, style')) continue;
      const t = (n.nodeValue || '').replace(keep, '');
      for (const ch of t) {                       // for..of 按码点走，代理对不会被拆坏
        const cp = ch.codePointAt(0);
        if ((cp >= 0x1F300 && cp <= 0x1FAFF) || (cp >= 0x2600 && cp <= 0x27BF)) {
          const chain = [];
          for (let e = p; e && e !== document.body && chain.length < 2; e = e.parentElement) {
            const id = e.id ? '#' + e.id : (String(e.className || '').trim() ? '.' + String(e.className).trim().split(/\\s+/)[0] : '');
            if (id) chain.push(id);
          }
          hits.push(ch + '@' + (chain.join('>') || 'body'));
        }
      }
    }
    return [...new Set(hits)].slice(0, 10).join(' ');
  })()`);
  ok('G 全页可见文字已无 emoji（表情回应条按语义保留）', left === '', left ? `残留：${left}` : '');

  /* H. 第 44 步：AI 的"在听"到底有没有变成像素——
   *    冒烟能证明"类加上了、变量写了"，证不了"浏览器真的把 scaleY 算进了波形"。
   *    而这一条的卖点恰恰是"跟着真实声音动"，量不出形变就等于没做。 */
  const ear = await cdp.evaluate(`(function(){
    lastMembers = [{ id: 'peer-ear', name: '小张' }];
    syncAiTile(true);
    setAiState('listening');
    const bar = () => {
      const i = aiTileEl.querySelector('.ai-waves i:nth-child(3)');
      const m = new DOMMatrixReadOnly(getComputedStyle(i).transform);
      return Math.round(m.m22 * 100) / 100;
    };
    applyAiListening([{ id: 'peer-ear', volume: -80 }]);   // 安静
    const quiet = { scale: bar(), on: aiTileEl.classList.contains('listening-active') };
    applyAiListening([{ id: 'peer-ear', volume: -14 }]);   // 有人大声说
    const loud = { scale: bar(), on: aiTileEl.classList.contains('listening-active'),
                   who: (aiTileEl.querySelector('.ai-ear') || {}).textContent };
    setAiState('speaking');
    applyAiListening([{ id: 'peer-ear', volume: -14 }]);   // 换成 AI 自己在说
    const mine = { on: aiTileEl.classList.contains('listening-active') };
    syncAiTile(false);
    return { quiet, loud, mine };
  })()`);
  ok('H 安静时波形不现身（没声音还动着就是装忙）', ear.quiet.on === false, JSON.stringify(ear.quiet));
  ok('H 有人说话时波形真的按电平长高（浏览器算出的 scaleY，不是源码里写了就算）',
    ear.loud.on === true && ear.loud.scale > 0.6 && /在听.*小张/.test(String(ear.loud.who)),
    JSON.stringify(ear.loud));
  ok('H AI 自己发言时这条波形让位（同一组条形不能有两个来源）', ear.mine.on === false, JSON.stringify(ear.mine));
  fs.mkdirSync(OUT, { recursive: true });
  await cdp.evaluate(`(function(){
    /* 房间面板是一块居中的卡片，会盖在舞台上面——不藏掉它，截图里根本看不到视频格，
       也就看不到本轮真正新增的那颗 AI 耳朵。（check:visual 同样藏了这一层。） */
    const rp = document.getElementById('roomPanel'); if (rp) rp.classList.add('hidden');
    const g = document.getElementById('videoGrid');
    if (g && !g.children.length) {
      for (const [name, sp] of [['小张', true], ['小李', false]]) {
        const b = document.createElement('div');
        b.className = 'video-box' + (sp ? ' speaking' : '');
        b.innerHTML = '<div class="video-ph"></div><div class="video-label">' + name + '</div>';
        addPinBtn(b, 'peer-' + name); addCtlBtn(b, 'peer-' + name);
        g.appendChild(b);
      }
    }
    /* 把 AI 格子留在"正在听小张说"这一帧上：截图要拍到本轮真正新增的东西，
       不然验完只留下一张和改动无关的页面。 */
    lastMembers = [{ id: 'peer-ear', name: '小张' }];
    syncAiTile(true); setAiState('listening');
    applyAiListening([{ id: 'peer-ear', volume: -16 }]);
    return 'ok';
  })()`);
  await sleep(500);
  fs.writeFileSync(path.join(OUT, 'icon-sweep.png'), await cdp.screenshot({ format: 'png' }));
  console.log('  截图落盘：wb-rd-shots/icon-sweep.png');

  cdp.kill();
  const bad = results.filter((x) => !x.pass).length;
  console.log(bad ? `\n❌ ${bad} 项未过` : '\n🎉 控件图标这一轮在真浏览器里大小正常、无残留 emoji');
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error(`\n❌ 检查失败：${e && e.message}`);
  process.exit(1);
});
