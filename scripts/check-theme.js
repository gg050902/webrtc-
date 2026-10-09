#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 *  check-theme.js —— 明暗双主题（水墨 / 宣纸）的真浏览器回归
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎为什么必须真浏览器 + 必须算对比度：换主题最容易出的三种"看起来没事"的事故是
 *   ① 某块面板还留着深色的硬编码值（只有渲染出来才看得见）；
 *   ② 强调色从深色版直接复用，在浅底上对比只剩 1.6:1（字在、读不出）；
 *   ③ 切换后刷新又跳回默认（持久化没接上）。
 *   这三种都不会让任何功能变红——所以判据是"量出来的颜色"，不是"代码里写了 var"。
 * ▎对比度公式用 WCAG 2.1 的相对亮度比（(L1+0.05)/(L2+0.05)），
 *   阈值取 4.5（正文 AA）。这不是装饰性检查：浅色主题真正的失败模式就是"灰字配浅底"。
 * ▎跑法：npm run check:theme（先起服务器，或用 CHECK_URL 指到专用端口） */
const fs = require('fs');
const path = require('path');
const { Cdp } = require(path.join(__dirname, '..', 'agent', 'cdp.js'));

const URL_ = (process.env.CHECK_URL || 'http://localhost:3001/') + '?nosw=1';
const SHOTS = path.join(__dirname, '..', 'wb-rd-shots');
const results = [];
const ok = (name, pass, extra) => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 取值重试：`?nosw=1` 这个逃生舱在"真的清掉了 SW/缓存"时会自带一趟自我导航，
 *   于是每一次加载都可能撞上 `Inspected target navigated or closed`——
 *   那是量具与自己的跳转赛跑（坑 81 实测过两轮），不是页面坏了。 */
async function evalSettled(cdp, expr, tries = 6) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try { return await cdp.evaluate(expr); }
    catch (e) { lastErr = e; await sleep(700); }
  }
  throw lastErr;
}

/* 页内量具：把"某个元素的前景色 / 它背后第一个不透明祖先的底色"算成 WCAG 对比度。
 * ▸ 为什么沿祖先链找底色而不是直接读 body：面板是半透明玻璃，真正的视觉底色是
 *   它自己那层 --fill/--glass 叠在画布上的结果——取第一个"有实际 alpha"的背景。 */
const MEASURE = `(function(){
  function parse(c){ if(!c) return null;
    const m = String(c).match(/rgba?\\(([^)]+)\\)/); if(!m) return null;
    const p = m[1].split(',').map(function(x){ return parseFloat(x); });
    return { r:p[0], g:p[1], b:p[2], a: p.length>3 ? p[3] : 1 }; }
  function lum(c){ var f=function(v){ v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); };
    return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b); }
  function over(fg, bg){ // 半透明前景叠在底色上
    var a = fg.a; return { r: fg.r*a + bg.r*(1-a), g: fg.g*a + bg.g*(1-a), b: fg.b*a + bg.b*(1-a), a: 1 }; }
  function backdrop(el){ var e = el;
    while (e && e.nodeType === 1) { var c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0.35) return c; e = e.parentElement; }
    return { r:255, g:255, b:255, a:1 }; }
  function ratio(sel){ var el = document.querySelector(sel); if(!el) return null;
    var cs = getComputedStyle(el); var f = parse(cs.color); if(!f) return null;
    var b = backdrop(el); if (f.a < 1) f = over(f, b);
    var l1 = lum(f), l2 = lum(b);
    return { ratio: +(((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)).toFixed(2)),
             color: cs.color, bg: 'rgb(' + [b.r,b.g,b.b].map(function(v){return Math.round(v);}).join(',') + ')' }; }
  function tok(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  return {
    theme: document.documentElement.getAttribute('data-theme') || 'dark',
    bodyBg: getComputedStyle(document.body).backgroundColor,
    bodyFg: getComputedStyle(document.body).color,
    page: ratio('body'),
    member: ratio('.member-row'),
    msg: ratio('.msg'),
    badge: ratio('.badge'),
    primaryBtnFg: ratio('.btn.primary'),
    fill: tok('--fill-rgb'), lift: tok('--lift-rgb'), accent: tok('--accent'),
    panelBg: (() => { const p = document.querySelector('.log-panel'); return p ? getComputedStyle(p).backgroundColor : null; })(),
    themeBtnTxt: (document.getElementById('themeBtnTxt') || {}).textContent || '',
    metaColor: (document.querySelector('meta[name="theme-color"]') || {}).content || '',
    sunShown: (() => { const s = document.querySelector('.theme-btn .i-sun'); return s ? getComputedStyle(s).display !== 'none' : false; })(),
    moonShown: (() => { const m = document.querySelector('.theme-btn .i-moon'); return m ? getComputedStyle(m).display !== 'none' : false; })(),
  };
})()`;

/* 现场图之前把首屏遮罩再掀一次：页面自己的逻辑在"拿不到摄像头"那条路上会**重新显示**
 * 预览页（这是正确行为），于是第一版截图里全是预览卡，看不到本轮改的字幕卡与控制坞。
 * 截图是给人复核用的，它得拍到要看的东西（坑 96：布局改动的验收必须看图）。 */
/* ★ 2026-10-07 H4 要的东西不是"再点几个选择器"，而是**自动扫全页**：
 *   浅色档是这一轮新加的，样式表里还剩一大片硬编码颜色没复核过。
 *   靠人列清单一定会漏（而且会只列出"我想到要去看的那几处"——坑 106 的同一条教训）。
 *   ▸ 这个 sweep 把"每一个真的在显示文字的元素"都量一遍对比度，
 *     按 class 签名归组报最差的几组 ⇒ 修的时候有名字、有样本、有实际比值。
 *   ▸ 阈值用 WCAG 的两档：正文 4.5、大字/粗体 3.0（字号 ≥24px 或 ≥18.66px 且粗体算大字）。
 *   ▸ 背景色是**沿祖先合成**出来的近似值（真合成要考虑层叠与 backdrop-filter，
 *     那在脚本里做不到），所以这条量的判据是"**有没有明显读不出来的面**"，
 *     不是精确到小数点的合规审计。近似值判出来的红要人工看一眼截图再定案。 */
const SWEEP = `(function(){
  function parse(c){ if(!c) return null;
    const m = String(c).match(/rgba?\\(([^)]+)\\)/); if(!m) return null;
    const p = m[1].split(',').map(parseFloat);
    return { r:p[0], g:p[1], b:p[2], a: p.length>3 ? p[3] : 1 }; }
  function lum(c){ var f=function(v){ v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); };
    return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b); }
  function over(fg, bg){ var a=fg.a; return { r: fg.r*a+bg.r*(1-a), g: fg.g*a+bg.g*(1-a), b: fg.b*a+bg.b*(1-a), a:1 }; }
  function backdrop(el){ var out=[]; var e=el;
    while (e && e.nodeType===1) { var c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a>0) { out.push(c); if (c.a>=0.999) break; }
      e = e.parentElement; }
    // 从最远一层往回合成（近似：忽略层叠顺序带来的差别）
    var acc = { r:255,g:255,b:255,a:1 };
    for (var i=out.length-1;i>=0;i--) acc = over(out[i], acc);
    return acc; }
  function sig(el){ var c = (el.className && typeof el.className==='string') ? el.className.trim().split(/\\s+/) : [];
    var base = el.tagName.toLowerCase();
    return c.length ? base + '.' + c.slice(0,2).join('.') : base; }
  var seen = new Set(); var rows = [];
  var all = document.querySelectorAll('body *');
  for (var i=0;i<all.length;i++){
    var el = all[i];
    if (!el.textContent || !el.textContent.trim()) continue;
    // 只认"直接持有文字"的节点：否则一个容器会替它所有后代报一遍，噪声大到一个都修不了
    var hasOwnText = false;
    for (var j=0;j<el.childNodes.length;j++){ var n=el.childNodes[j];
      if (n.nodeType===3 && n.textContent.trim()) { hasOwnText = true; break; } }
    if (!hasOwnText) continue;
    var r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) continue;                 // 没真占地方（隐藏/零尺寸）
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.15) continue;
    var fg = parse(cs.color); if (!fg) continue;
    var b = backdrop(el); if (fg.a < 1) fg = over(fg, b);
    var l1 = lum(fg), l2 = lum(b);
    var ratio = +(((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)).toFixed(2));
    var fs = parseFloat(cs.fontSize) || 16, fw = parseInt(cs.fontWeight,10) || 400;
    var large = fs >= 24 || (fs >= 18.66 && fw >= 700);
    var need = large ? 3 : 4.5;
    var k = sig(el);
    if (seen.has(k + '|' + ratio)) continue; seen.add(k + '|' + ratio);
    rows.push({ sig: k, ratio: ratio, need: need, fs: Math.round(fs), fw: fw,
                color: cs.color, bg: 'rgb('+[b.r,b.g,b.b].map(Math.round).join(',')+')',
                text: el.textContent.trim().slice(0,22) });
  }
  rows.sort(function(a,b){ return (a.ratio/a.need) - (b.ratio/b.need); });
  return { total: rows.length,
           /* ★ 2026-10-08：把"扫到了哪些 class 签名"也带回来。
            *   ▎没有这一项，"覆盖面"就只是一句自我感觉：我可以在 OPEN_OVERLAYS 里
            *   ▎  注入共享文件面板，而它因为一个 try/catch 静默没成，扫描数照样 ≥40、照样全绿。
            *   ▎  覆盖率哨兵要问的是"**这一块**扫到了没有"，不是"总共扫到多少"。 */
           sigs: Array.from(new Set(rows.map(function (x) { return x.sig; }))),
           fails: rows.filter(function(x){ return x.ratio < x.need; }),
           worst: rows.slice(0, 8) };
})()`;

/* ★ 2026-10-07 H4 第二遍：把**浮层**逐个掀开再扫。
 *   ▎为什么默认那一屏不够：上一轮扫出 10 处浅色档不合格，全部在"首屏就看得见"的元素里。
 *     而真正还没复核过的是**要点了才出现**的那些：字幕历史抽屉、邀请面板、白板、滤镜面板、
 *     诊断卡、版本横幅、设备码面板——它们各自还留着一批深色专属的颜色，
 *     用户要等到点开才发现"浅色档这块读不出来"（而且换个主题就是另一批）。
 *   ▸ 做法：一次把全部浮层显出来（含最小限度的真实内容，让文字节点存在），扫完再收起。
 *     只改 class，不注入我自己写的样式——量的必须是样式表本身。 */
const OPEN_OVERLAYS = `(async function(){   /* ★ 2026-10-08：改成 async —— 共享文件那块要 await 内核真渲染出来的 HTML，见下面那段 */
  const cap = document.getElementById('capHistoryPanel');
  if (cap) {
    cap.classList.remove('hidden');
    const list = document.getElementById('capHistoryList');
    if (list && !list.children.length) {
      const g = document.createElement('div'); g.className = 'cap-seg';
      const h = document.createElement('div'); h.className = 'cap-seg-head'; h.textContent = '张三 · 09:12';
      const l = document.createElement('div'); l.className = 'cap-line2'; l.textContent = '帮我把这条记录一下，明天下午三点开评审会。';
      g.appendChild(h); g.appendChild(l); list.appendChild(g);
    }
  }
  const ip = document.getElementById('invitePanel'); if (ip) ip.classList.remove('hidden');
  const bo = document.getElementById('boardOverlay'); if (bo) bo.classList.remove('hidden');
  const fx = document.getElementById('fxPanel'); if (fx) fx.classList.remove('hidden');
  const dg = document.getElementById('capDiagBox'); if (dg) dg.classList.remove('hidden');
  const sb = document.getElementById('staleBuild'); if (sb) sb.classList.remove('hidden');
  const dk = document.getElementById('deskOverlay'); if (dk) dk.classList.remove('hidden');
  /* ★ 2026-10-09 第 52 步：账号面板（身份牌 + 治理台）第一次被扫到。
   *   它有两块别处没有的形状：治理台的链接色 与 鎏金描边 + accent-muted 底——
   *   这两处我要是不点名，浅色档就永远没人量过。
   *   治理台默认 hidden，这里连它一起掀开，否则扫到的只是半张空面板。
   *   ▸ 这段注释里**不许出现反引号**：OPEN_OVERLAYS 是一个模板字符串，
   *     注释中的反引号会提前终结它，而 node --check 全过（语法没错，错在拼出来的代码）——
   *     本项目在 2026-10-08 就为同一件事写过一条教训，这次是我自己原样复发。 */
  const ap = document.getElementById('accountPanel'); if (ap) ap.classList.remove('hidden');
  const ab = document.getElementById('accountAdminBox'); if (ab) ab.classList.remove('hidden');
  /* ★ 2026-10-08 第三轮：把第 51 步那块新区域也掀开扫一遍。
   *   ▎H4 那次的教训原话是"靠人列清单只会列出我想到要看的那几处"——而共享文件面板
   *   ▎  是在 H4 **之后**才加的，从来没进过这份清单：浅色档下"文件名那行灰字""类型徽标"
   *   ▎  "表格边框"对比度多少，今天之前没有任何人量过（这块区域有 40+ 个新 class）。
   *   ▸ 清单走**生产的 renderFilesList**（喂它一份 filesData），文档区走**生产的渲染内核**
   *     （FV.render 真产出的那份 HTML）——不是我手写一段示例 markup，
   *     否则量的就是我自己写的那几行字，跟产品长什么样无关（坑 63：测试的触发条件本身也要被验证）。 */
  const fo = document.getElementById('filesOverlay');
  if (fo) {
    fo.classList.remove('hidden');
    try {
      filesData = [
        { name: '评审结论.md', size: 2048, ts: Date.now(), byName: '张三' },
        { name: '会议材料.docx', size: 40000, ts: Date.now(), byName: '李四' },
        { name: '一个特别特别长的文件名用来试省略号.xlsx', size: 12000, ts: Date.now(), byName: '王五' },
      ];
      renderFilesList();
    } catch (e) { /* 客户端还没加载完（老页面），下面扫到的就是没有这块区域，覆盖率那条会红 */ }
    try {
      const stage = document.getElementById('filesStage');
      if (stage && !stage.children.length) {
        /* 注意这里写的是双反斜杠 n 而不是单反斜杠 n：这段代码在一个**模板字符串**里，
         * 单反斜杠会被外层模板先吃掉，落到页面代码里就成了"字符串中间一个真换行"= 语法错。
         * （而注释里也不能出现反引号——它会提前终结外层模板，就是本仓库坑 26 那一族。） */
        const md = '# 评审结论\\n\\n**下周上线**，先记三条：\\n\\n- 共享文件面板\\n- 跟随主讲\\n\\n'
          + '| 事项 | 负责人 |\\n|---|---|\\n| 上线 | 张三 |\\n\\n> 引用一行，专门量 blockquote 的对比度。\\n\\n'
          + '\\u0060inline code\\u0060 与 [一个链接](https://example.com)\\n';
        const r = await FV.render('评审结论.md', new TextEncoder().encode(md), {});
        stage.innerHTML = r.html;
      }
    } catch (e) { /* 内核没就绪：同上，靠覆盖率那条兜 */ }
  }
  const cl = document.getElementById('chatList');
  if (cl) for (const k of ['own', 'other']) {
    if (cl.querySelector('.msg.' + k)) continue;
    const m = document.createElement('div'); m.className = 'msg ' + k;
    m.innerHTML = '<div class="msg-name">张三</div><div class="msg-body">这是一条用来量对比度的消息</div>'
      + '<div class="msg-meta"><span class="msg-path">🛰️</span><span class="msg-time">09:12:03</span></div>';
    cl.appendChild(m);
  }
  const ai = document.querySelector('.msg-ai, .msg.ai');
  if (ai && !ai.querySelector('.msg-ai-trace')) {
    const t = document.createElement('div'); t.className = 'msg-ai-trace';
    t.textContent = '📚 检索 12 条取 3 条 · 💬 第 2 轮 · 🎯 意图 minutes';
    ai.appendChild(t);
  }
  const ml = document.getElementById('memberList');
  if (ml) { const r = ml.querySelector('.member-row'); if (r && !r.querySelector('.m-name')) {
    const s = document.createElement('span'); s.className = 'm-name'; s.textContent = '张三 · 主持';
    r.appendChild(s); } }
  return 1;
})()`;

const HIDE_OVERLAYS = `(function(){
  for (const id of ['authOverlay', 'prejoin', 'roomPanel']) { const e = document.getElementById(id); if (e) e.classList.add('hidden'); }
  return 1;
})()`;
/* ★ 2026-10-09 注入代码进浏览器前的编译自检已收口到 scripts/inject-check.js（一处实现，11 个脚本共用）——
 *   这一段原来是本地写的 for 循环，现在由文件顶部那句 assertCompiles(...) 承担。 */
async function shot(cdp, name) {
  await evalSettled(cdp, HIDE_OVERLAYS);
  await sleep(250);
  fs.writeFileSync(path.join(SHOTS, name), await cdp.screenshot({ format: 'png' }));
}

/* ★ 2026-10-09 注入浏览器之前先让同一个引擎读一遍这些串。
 *   模板字符串**内部**的注释里只要出现反引号，模板就被提前截断——源文件语法没错、node --check 全过，
 *   错在拼出来的那段代码；到浏览器里炸的时候，本脚本一条断言都没跑到（详见 scripts/inject-check.js 头部）。 */
require('./inject-check.js').assertCompiles(__filename, { MEASURE, SWEEP, OPEN_OVERLAYS, HIDE_OVERLAYS });

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const cdp = new Cdp({ headless: true, startUrl: URL_, windowSize: { width: 1440, height: 900 } });
  await cdp.launch();
  await cdp.waitForLoad(15000);
  await sleep(1200);
  /* ★ 2026-10-09 先把"上一次运行留下的主题选择"清干净，再断言默认档。
   *   ▎起因：全量回归里这条检查红过一次，报的是"默认主题=水墨"读到 light——
   *     而这不是产品缺陷，是**状态污染**：这个文件末尾的"恢复默认"写在正常路径上，
   *     一旦上一次运行中途抛错（或被 timeout 掐掉），localStorage 里就留下了 'light'，
   *     于是下一次运行的"默认档"断言测的是**上一轮的残留**（坑 72 同一条：
   *     回归结果不该依赖"上一次跑没跑干净"）。
   *   ▸ 这次不是猜的，两向都量过（同一个 profile、同一份残留 'light'）：
   *     摘掉下面这两行 ⇒ 红在 `theme=light 按钮="水墨"`，16 通过 / 11 失败——
   *     **与原那次全量回归的红一模一样**；留着 ⇒ 27/27 全绿。
   *   ▸ 做法是清完**重载一次**：页面首帧的 <head> 内联脚本会重读存储，
   *     这样"默认"才是真正的默认（不是我用 JS 把 data-theme 抹成 dark——那会把
   *     "首帧不闪"这条被测行为整个绕过去）。 */
  await evalSettled(cdp, `try { localStorage.removeItem('sfu-theme'); } catch (e) {}`);
  await evalSettled(cdp, `location.reload()`);
  await sleep(1500);
  const cleared = await evalSettled(cdp, `(() => ({
    stored: (() => { try { return localStorage.getItem('sfu-theme'); } catch (e) { return 'ERR'; } })(),
    theme: document.documentElement.getAttribute('data-theme') || '(无)',
  }))()`);
  ok('前提：存储里的主题选择已清空（不这一步，下面每条"默认档"断言量的都是上一轮的残留）',
    cleared.stored === null && cleared.theme !== 'light', `stored=${cleared.stored} 首帧 data-theme=${cleared.theme}`);
  /* 摆进"已经在开会"的形态，让成员行/聊天/日志面板都有真实尺寸可量（同 check:dock）*/
  await evalSettled(cdp, `(function(){
    for (const id of ['authOverlay', 'prejoin']) { const e = document.getElementById(id); if (e) e.classList.add('hidden'); }
    const b = document.getElementById('captionBar'); if (b) b.classList.remove('hidden');
    const t = document.getElementById('captionText');
    if (t) { t.innerHTML = '<span class="caption-name">小张</span>小明，帮我把这条记录一下，明天下午三点开产品评审会。'; t.classList.remove('interim'); }
    /* ★ 对比度探针：没进房间时 .member-row / .msg 压根不存在，那两条断言就会
     *   "因为没量到而红"（或更糟：因为没量到而被当成通过）。这里用**真实类名**造两条，
     *   塞进真实容器里——量的是样式表本身，不是我自己另写的一份颜色。
     *   ▸ 输出里会写明"探针"，不假装那是运行时真的成员行（坑 105：没证据不等于证据）。 */
    const ml = document.getElementById('memberList');
    if (ml && !ml.querySelector('.member-row')) {
      const r = document.createElement('div'); r.className = 'member-row';
      r.innerHTML = '<span class="m-id">张三</span>';
      ml.appendChild(r);
    }
    const cl = document.getElementById('chatList');
    if (cl && !cl.querySelector('.msg')) {
      const m = document.createElement('div'); m.className = 'msg other';
      m.innerHTML = '<div class="msg-name">张三</div><div class="msg-body">这是一条用来量对比度的消息</div>';
      cl.appendChild(m);
    }
  })()`);
  await sleep(300);

  /* ── 0. 版本指纹：先证明量的是这一版（坑 40/57）── */
  const fp = await evalSettled(cdp, `(async () => {
    const css = await (await fetch('style.css', { cache: 'no-store' })).text();
    const js = await (await fetch('client.js', { cache: 'no-store' })).text();
    return { light: css.includes('html[data-theme="light"]'), fill: css.includes('--fill-rgb'),
             themeFn: js.includes('function currentTheme') && js.includes('sfu-theme') };
  })()`);
  ok('页面加载的是本轮代码（style.css 有浅色主题块，client.js 有主题开关）',
    fp.light === true && fp.fill === true && fp.themeFn === true, JSON.stringify(fp));

  /* ── 1. 默认仍是水墨（深色）：新加的浅色不许把默认档换掉 ── */
  const dark = await evalSettled(cdp, MEASURE);
  ok('默认主题 = 水墨（深色），且按钮写的是"点下去会变成什么"（宣纸）',
    dark.theme === 'dark' && dark.themeBtnTxt === '宣纸', `theme=${dark.theme} 按钮="${dark.themeBtnTxt}"`);
  ok('深色档正文对比度 ≥ 4.5（这是原来那一版，回归红线）',
    dark.page && dark.page.ratio >= 4.5, `body ${dark.page && dark.page.ratio}:1 ${dark.page && dark.page.bg}`);
  ok('深色档下太阳图标亮、月亮图标藏',
    dark.sunShown === true && dark.moonShown === false);
  await shot(cdp, 'theme-dark.png');

  /* ── 2. 点一下切到宣纸 ── */
  await evalSettled(cdp, `document.getElementById('themeBtn').click()`);
  await sleep(400);
  const light = await evalSettled(cdp, MEASURE);
  ok('点开关 → <html data-theme="light">（状态的唯一来源在 html 上，不在按钮里）',
    light.theme === 'light', `theme=${light.theme}`);
  ok('浅色档底色真的翻亮了（body 背景是浅的，不是"改了 token 但没人用"）',
    /^rgb\((2[0-5]\d|1[6-9]\d),\s*(2[0-5]\d|1[6-9]\d),\s*(1[5-9]\d|2[0-5]\d)\)$/.test(light.bodyBg),
    `body background=${light.bodyBg}`);
  ok('浅色档按钮文案跟着翻成"水墨"（它只是状态的一个视图）',
    light.themeBtnTxt === '水墨' && light.moonShown === true && light.sunShown === false);
  ok('浅色档 meta theme-color 同步（PWA/手机状态栏不留深色）',
    light.metaColor === '#f4efe3', `meta=${light.metaColor}`);
  /* 对比度：这是浅色主题最容易悄悄失败的地方——字在、读不出 */
  const pairs = [['正文', light.page], ['成员行', light.member], ['聊天气泡', light.msg], ['徽标', light.badge], ['主按钮文字', light.primaryBtnFg]];
  for (const [name, p] of pairs) {
    ok(`浅色档「${name}」对比度 ≥ 4.5（WCAG AA 正文）`, !!p && p.ratio >= 4.5,
      p ? `${p.ratio}:1  色=${p.color} 底=${p.bg}` : '元素没找到');
  }
  ok('浅色档的面板填充走 token（--fill-rgb 已翻成浅色，不是留着深色的 12,9,5）',
    light.fill !== dark.fill && /^255,/.test(light.fill), `深色 ${dark.fill} → 浅色 ${light.fill}`);
  ok('浅色档的悬停色方向反过来（--lift-rgb 从"提亮"变"压暗"，否则 hover 看不见）',
    light.lift !== dark.lift && !/^255,/.test(light.lift), `深色 ${dark.lift} → 浅色 ${light.lift}`);
  ok('日志面板底色在浅色档是浅的（那一处原本是硬编码 rgba(12,9,5,.92)）',
    /^rgba?\((2[0-5]\d|19\d),/.test(light.panelBg || ''), `panelBg=${light.panelBg}`);
  await shot(cdp, 'theme-light.png');

  /* ── 2b. ★ H4：自动扫全页对比度（不是再点几个我想到的选择器）──
   *   ▎为什么换成扫：样式表里还有大一片硬编码颜色没在浅色档复核过。
   *     靠人列清单只会列出"我想到要去看的那几处"——这正是要避免的那种自测（坑 106）。
   *   ▎这一条**先只报数、不设为红线**：背景是沿祖先合成的近似值，
   *     报出来的红要人工看一眼截图再定案。第一版就把"失败数必须为 0"写成断言，
   *     只会得到一堆因为近似而假红的条目，反而把真的那几条埋掉（坑 82：假警告比缺失更糟）。 */
  const sweepLight = await evalSettled(cdp, `(async()=>{ await ${OPEN_OVERLAYS}; return ${SWEEP}; })()`);
  await evalSettled(cdp, `document.getElementById('themeBtn').click()`);   // 回深色再扫一遍当对照
  await sleep(350);
  const sweepDark = await evalSettled(cdp, `(async()=>{ await ${OPEN_OVERLAYS}; return ${SWEEP}; })()`);
  /* ★ 扫完必须把档位翻回浅色**再往下走**：下面第 3 节断的是"刷新之后仍是宣纸"，
     而这一节为了做对照自己点了一次开关——不翻回来就是**检查自己把被测状态改了**（坑 84 的同一条：
     观测手段不得改变被测对象；这次是改状态而不是暂停线程，症状一模一样：红得莫名其妙）。 */
  await evalSettled(cdp, `document.getElementById('themeBtn').click()`);
  await sleep(350);
  const backToLight = await evalSettled(cdp, `document.documentElement.getAttribute('data-theme')`);
  /* 报出问题就要带上"实际算出来的两个颜色"，否则下一轮修法只能猜（这个仓库被"数字对但归因错"
     咬过太多次）。一行一条，带 class 签名、比值、字号字重、前景与合成后的背景与样本文字。 */
  const dump = (label, s) => {
    console.log(`  🔎 ${label} 不合格 ${(s.fails || []).length}/${s.total} 处：`);
    for (const f of (s.fails || []).slice(0, 12)) {
      console.log(`       ${f.ratio}:1（需 ${f.need}，${f.fs}px/w${f.fw}） ${f.sig}`
        + `  前景 ${f.color} 背景 ${f.bg}  · "${f.text}"`);
    }
  };
  const top = (s) => (s.fails || []).slice(0, 12).map((f) => `${f.sig} ${f.ratio}:1(需${f.need}) "${f.text}"`).join(' ｜ ');
  ok('对照扫描之后档位翻回浅色（检查自己不许把页面状态改了）',
    backToLight === 'light', `实际=${backToLight}`);
  ok('两档都扫到了足量文字元素（扫描本身在工作——扫到 0 个不算"没有对比度问题"，坑 105）',
    sweepLight.total >= 40 && sweepDark.total >= 40,
    `浅色档扫到 ${sweepLight.total} 处、深色档 ${sweepDark.total} 处`
    /* ▸ 40 这个数是**浮层覆盖面的哨兵**：只掀首屏那几块能扫到 23 处，把历史抽屉/邀请面板/
       白板/滤镜/诊断卡/版本横幅/设备码面板都掀开之后是 57 处。
       哪一天 OPEN_OVERLAYS 被人删了或改坏了，这条会当场红——否则覆盖面缩水没人发现，
       而"0 条不合格"仍然绿得好看（量具自己把被测面改小 = 坑 81 的同一种自伤）。 */);
  /* ★ 2026-10-08 覆盖率要**点名**，不能只数总数：共享文件那块是 H4 之后才加的新区域，
   *   注入它的代码外面包着 try/catch（页面没就绪时不许把整条检查弄崩），
   *   而"静默没注入"在这条 ≥40 的总量哨兵下**照样是绿的**——所以单独点名要看到它。 */
  const sigsOf = (s) => (s && Array.isArray(s.sigs)) ? s.sigs : [];
  const fileSigs = sigsOf(sweepLight).filter((k) => /file|fv-/.test(k));
  ok('★ 共享文件这块（第 51 步的新区域）这次**真的被扫到了**，不是 try/catch 静默跳过',
    fileSigs.length >= 4,
    `file-*/fv-* 签名 ${fileSigs.length} 个：${fileSigs.slice(0, 8).join(', ') || '(一个都没有)'}`);
  /* 同一条纪律用在 10-09 的第 52 步：账号面板是**默认收起**的浮层，
   *   它里面有两块别处没有的形状——治理台的鎏金底 + 链接色。不点名就等于没量。 */
  const acctSigs = sigsOf(sweepLight).filter((k) => /account/.test(k));
  ok('★ 账号面板这块（第 52 步的新浮层）这次真的被扫到了（治理台与链接都在浅底上）',
    acctSigs.length >= 4,
    `account-* 签名 ${acctSigs.length} 个：${acctSigs.slice(0, 8).join(', ') || '(一个都没有)'}`);
  ok('浅色档的对比度不合格处数 **不多于**深色档（同一批元素、同一把尺，两档差距不许扩大）',
    (sweepLight.fails || []).length <= (sweepDark.fails || []).length,
    `浅色 ${(sweepLight.fails || []).length} 条 / 深色 ${(sweepDark.fails || []).length} 条`);
  /* 红线收紧到"两档都为 0"——这不是理想主义，是 2026-10-07 这一轮把扫出来的
     10 条（浅色）+ 1 条（深色）逐个修完之后**实测到的状态**：
     --fg-faint / --accent 按最差的底重定、日志色 token 化、升起按钮的标签层改成 inherit、
     react-btn 补上一直没设的 color。
     留一条"只要不比另一档差就行"的相对线，等于允许两边一起烂（相对判据看不见共同退化）。 */
  ok('★ 两档的对比度不合格处数都是 0（H4 修完后的红线；相对线看不见"两边一起烂"）',
    (sweepLight.fails || []).length === 0 && (sweepDark.fails || []).length === 0,
    `浅色 ${(sweepLight.fails || []).length} 条 / 深色 ${(sweepDark.fails || []).length} 条`);
  dump('浅色档', sweepLight);
  dump('深色档', sweepDark);

  /* ── 2c. ★ H4：观测面板（/dashboard）是**另一个文档**，主题与配色都得单独量一次。
   *   ▎为什么不能只量首页：面板页是零依赖单文件、自带一套内联样式（还有 canvas 画图），
   *     首页改了 token 不会自动传过去。而它偏偏是用户从会议页点链接就进去的页面——
   *     "顶栏选了宣纸、点进面板又黑回去"是这个仓库里最容易被看见的不一致。
   *   ▸ 没有 admin token 时面板只会显示"去登录"那张卡，这**不影响对比度测量**
   *     （量的是样式，不是数据），但会影响"扫到多少处"的下限，所以阈值定得保守（≥6）。 */
  const base = (process.env.CHECK_URL || 'http://localhost:3001/').replace(/\?.*$/, '');
  const dashSweeps = {};
  for (const mode of ['light', 'dark']) {
    /* 面板页没有主题开关（它是个只读面板），所以**写存储 + 重新导航**来切档——
       与首屏那段内联脚本读的正是同一个键，正好把"两个页面共用一份状态"这件事也验了一遍。 */
    await evalSettled(cdp, `try { localStorage.setItem('sfu-theme', ${JSON.stringify(mode)}); } catch (e) {}`);
    await cdp.navigate(base + 'dashboard');
    await cdp.waitForLoad(12000);
    await sleep(700);
    const r = await evalSettled(cdp, SWEEP);
    const themeAttr = await evalSettled(cdp, `document.documentElement.getAttribute('data-theme') || 'dark'`);
    dashSweeps[mode] = { r, themeAttr };
  }
  ok('面板页跟随同一个主题状态（它是另一个文档；浅色档必须真的翻成 light）',
    dashSweeps.light.themeAttr === 'light' && dashSweeps.dark.themeAttr === 'dark',
    `浅色档=${dashSweeps.light.themeAttr} · 深色档=${dashSweeps.dark.themeAttr}`);
  ok('面板页两档都扫到了文字元素（≥6 处；扫不到说明跳转/渲染失败，不许当成"没问题"，坑 105）',
    dashSweeps.light.r.total >= 6 && dashSweeps.dark.r.total >= 6,
    `浅色 ${dashSweeps.light.r.total} 处 / 深色 ${dashSweeps.dark.r.total} 处`);
  dump('面板页·浅色档', dashSweeps.light.r);
  dump('面板页·深色档', dashSweeps.dark.r);
  ok('★ 面板页两档的对比度不合格处数都是 0（含 canvas 轴标签那类"CSS 管不到的颜色"）',
    (dashSweeps.light.r.fails || []).length === 0 && (dashSweeps.dark.r.fails || []).length === 0,
    `浅色 ${(dashSweeps.light.r.fails || []).length} 条 / 深色 ${(dashSweeps.dark.r.fails || []).length} 条`);
  /* 回到主页面之前把存储恢复成浅色：下面第 3 节断的是"刷新之后仍是宣纸"，
     留着循环结束时那个 dark 会让那条红得像是产品坏了（其实是检查自己留下的状态，坑 72）。 */
  await evalSettled(cdp, `try { localStorage.setItem('sfu-theme', 'light'); } catch (e) {}`);
  await cdp.navigate(URL_);
  await cdp.waitForLoad(15000);
  await sleep(900);

  /* ── 3. 刷新后还是浅色（持久化）；再点一次回深色 ── */
  await evalSettled(cdp, `location.reload()`);
  await cdp.waitForLoad(15000);
  await sleep(1000);
  const after = await evalSettled(cdp, MEASURE);
  ok('刷新之后仍是宣纸（localStorage 记住了，head 里的内联脚本负责首帧不闪深色）',
    after.theme === 'light', `theme=${after.theme}`);
  await evalSettled(cdp, `document.getElementById('themeBtn').click()`);
  await sleep(300);
  const back = await evalSettled(cdp, MEASURE);
  ok('再点一次回到水墨（两版都是"一等公民"，不许有回不去的方向）',
    back.theme === 'dark' && back.themeBtnTxt === '宣纸', `theme=${back.theme}`);
  /* 恢复默认档再退出，免得用户下次打开看到的是我测试留下的状态 */
  await evalSettled(cdp, `try { localStorage.removeItem('sfu-theme'); } catch (e) {}`);

  await cdp.kill();
  const bad = results.filter((r) => !r.pass).length;
  console.log(`\n结果: ${results.length - bad} 项通过 / ${bad} 项失败`);
  console.log(`  📷 现场图：${path.join(SHOTS, 'theme-dark.png')} 与 theme-light.png（两版各一张，给人复核）`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('检查异常:', e); process.exit(1); });
