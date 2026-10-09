#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 *  check-files.js —— 共享文件的**真浏览器**回归（2026-10-07，第 51 步）
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎为什么必须两条浏览器：这一步的卖点是一句话——
 *   **"房间里所有人同时看到同一页"**。
 *   单条浏览器只能证明"我能渲染"，证明不了"别人屏幕上出现了什么"；
 *   而信令回归（test:sfu）只证明"事件到了两个客户端"，也证明不了 DOM 真的跟着变了。
 *   ▸ 本项目吃过太多次这种"每一层各自都绿、接起来不成立"的亏（坑 41/56/76），
 *     所以这一条断言直接读**第二个人页面上的文字**。
 *
 * ▎它同时验四件最容易坏的事：
 *   ① 层叠：面板开着时不许盖住字幕条与控制坞（坑 80 用 elementFromPoint 问页面，
 *      而不是读 z-index 猜——那是这一整个项目最贵的一次教训）；
 *   ② 渲染内核在真浏览器里真的跑通（DecompressionStream 是浏览器原生件，
 *      Node 里我走的是 zlib 注入那条路，**两条都要有证据**，同坑 57"装了≠用上了"）；
 *   ③ 陌生人上传的字节不能变成可执行标签（XSS 探针）；
 *   ④ 跟随是双向的：A 换文件 B 跟上、A 滚动 B 的滚动条跟着动，
 *      而且**不会回声成死循环**（B 跟随产生的滚动不许再广播回 A）。
 *
 * ▎跑法：npm run check:files
 *        （或 CHECK_URL=http://localhost:3021/ npm run check:files —— check:all 就是这么指的）
 * ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const { Cdp } = require(path.join(__dirname, '..', 'agent', 'cdp.js'));
const FX = require('./ooxml-fixture.js');
/* ★ 2026-10-10（C5）形状类别清单与分类判据（与 npm run review:office 同一份，坑 47）。 */
const Shapes = require('./office-shapes.js');

const BASE = process.env.CHECK_URL || 'http://localhost:3001/';
const URL_ = BASE + (BASE.includes('?') ? '&' : '?') + 'nosw=1';
const results = [];
const ok = (name, pass, extra) => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 取值失败重试：无头浏览器在负载下会偶发一次 Runtime.evaluate 超时（坑 86/87：
 * 量具的超时不是被测对象的属性），一次抖动不该把整条检查判死。 */
async function ev(cdp, expr, tries = 6) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try { return await cdp.evaluate(expr); } catch (e) { last = e; await sleep(700); }
  }
  throw last;
}
/** 轮询到条件成立为止（读一个会动的东西不能靠固定 sleep——坑 96/104 第四次应验）。 */
async function until(cdp, expr, timeoutMs = 8000) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await cdp.evaluate(expr); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) return false;
    await sleep(150);
  }
}

/* 把字节塞进页面并走**生产的上传函数**（uploadFiles 是「上传」按钮与拖拽共用的正门）。
 * ▸ 不用 CDP 的 DOM.setFileInputFiles：那条路要另一套权限域握手，而它测的仍是
 *   "文件进了 input"，不是"文件进了房间"。真点按钮要造原生文件选择对话框，无头里点不动。
 *   所以这里让页面自己造 File 对象调同一个函数——进度条、XHR、服务器落盘一步不少。 */
function b64Inject(name, buf, mime) {
  return `(async function(){
    const b64 = ${JSON.stringify(buf.toString('base64'))};
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const f = new File([u], ${JSON.stringify(name)}, { type: ${JSON.stringify(mime || '')} });
    await uploadFiles([f]);
    return { sent: filesData.length, names: filesData.map((x) => x.name) };
  })()`;
}

/* 用**清单里的那一行**当入口（= 用户真正做的事）。
 * ▸ 为什么不用 openFileByName()：生产的用户路径是"点行"，而这一件事做**两半**——
 *   打开 + 把视角广播给全房间。测试直接调内层函数就把第二半从被测范围里擦掉了，
 *   于是"别人不跟"这种最要命的坏法永远测不到（坑 63：测试的触发条件本身也要被验证）。 */
/* ★ 2026-10-10（C5）"这份文件在界面上到底走到哪一步"的**唯一**判据。
 *   ▸ 为什么提到模块作用域共用：批量那一处原来是 `chars > 40`——一条**尺度相关**的判据
 *     （两页的 PPT 只有 39 个非空白字，被报成"白屏"；见 pptx-notes 那次红，坑 53/91）。
 *     单文件那一处（REAL_OFFICE_FILE）用的是同一个数，还少写了一个反斜杠——
 *     `/\s+/` 在模板串里掉成一个反斜杠就变成"剥掉字母 s"，字数一直虚高、从不报白屏。
 *     同一个判据两份副本，一份尺度相关、一份算错，各自都"绿"（坑 47 + 坑 82）。
 *   ▸ 现在判的是结构信号：**有内容**（fv-doc/fv-slide/table/img/pdf 框架，且不在转圈）
 *     或**明确说不行**（fv-unsupported）。字数只当观察值打印，不再当判据。
 *   ▸ STAGE_FN 是一段"页面里的函数文本"，轮询与红场取证都拼它——一个概念一个来源。 */
const STAGE_FN = `function(){
  const s = document.getElementById('filesStage');
  /* 非空白字符数用 ch.trim() 数，不写反斜杠 s：这段要交给浏览器执行，
   *   少一个反斜杠就变成 /s+/g（剥掉的是字母 s 而不是空白）。 */
  const t = s.textContent || '';
  let n = 0;
  for (const ch of t) { if (ch.trim()) n++; }
  return { chars: n,
    content: !!s.querySelector('.fv-doc, .fv-slide, table, img, iframe.files-pdf')
      && !s.querySelector('.files-busy'),
    unsupported: !!s.querySelector('.fv-unsupported'),
    busy: !!s.querySelector('.files-busy'),
    empty: !!s.querySelector('.files-empty'),
    legacy: !!s.querySelector('.fv-legacy-note'),
    tables: s.querySelectorAll('table').length };
}`;
/** 轮询用的条件式：还没走到终态时返回空串（falsy），until 才继续等。 */
const STAGE_STATE = `(function(){ const x = (${STAGE_FN})(); return (x.content || x.unsupported) ? x : ''; })()`;

function clickRowSrc(name) {
  return `(function(){
    const rows = Array.prototype.slice.call(document.querySelectorAll('.file-row'));
    const want = ${JSON.stringify(name)};
    const row = rows.filter(function (r) { return r.getAttribute('data-name') === want; })[0];
    if (!row) return { clicked: false, why: '清单里没有这一行',
      rows: rows.map(function (r) { return r.getAttribute('data-name'); }) };
    row.click();
    return { clicked: true, doc: (document.getElementById('filesDocName') || {}).textContent || '' };
  })()`;
}

/* 游客进房（A 建房）——走**真实那一串点击**：登录卡「游客进入」→ 首屏「进入会议」→「创建房间」。
 * ▎中间那一步原来被我省掉了，结果命中测试量出来是 `MAIN.hero`：
 *   `#prejoin` 是 `.app` 的**兄弟**、z-index:100 的整屏遮罩，没点「进入会议」它就还盖在上面，
 *   而 `.click()` 这种编程点击**不受遮挡**（浏览器只拦真鼠标），于是界面是" landing 页盖着会议页"
 *   这种真人到不了的状态——下面的层叠/命中断言量的就是这个假状态。
 *   ▸ 判据（坑 55/63 同一条）：**用真实路径进到会里，别用后门**；
 *     "能点到"这件事本身就是被测内容，绕开遮挡去点按钮等于把考题擦了。 */
async function enterAsGuestA(cdp) {
  await cdp.evaluate(`(function(){ const g=document.getElementById('authGuestBtn'); if (g) g.click(); return 1; })()`);
  await sleep(700);
  await cdp.evaluate(`(function(){ const p=document.getElementById('pjEnterBtn'); if (p) p.click(); return 1; })()`);
  await sleep(600);
  await cdp.evaluate(`(function(){ document.getElementById('createBtn').click(); return 1; })()`);
  const room = await until(cdp, `(function(){ return /^\\d{6}$/.test(String(myRoom||'')) ? String(myRoom) : ''; })()`, 15000);
  return room;
}
/* 第二个游客凭号加入（B）——同样是真路径：填号 → 首屏「进入会议」，
 * ▎`enterFromPrejoin()` 看到输入框里有房号就顺手加入（邀请链接预填走的也是这一条），
 *   所以这里**不再另点一次**「加入会议」——多点那一下等于让测试走了一条用户走不到的路。 */
async function joinAsGuestB(cdp, room) {
  await cdp.evaluate(`(function(){ const g=document.getElementById('authGuestBtn'); if (g) g.click(); return 1; })()`);
  await sleep(700);
  await cdp.evaluate(`(function(){
    const i = document.getElementById('roomInput'); if (i) i.value = ${JSON.stringify(room)};
    const p = document.getElementById('pjEnterBtn'); if (p) p.click(); return 1;
  })()`);
  const inRoom = await until(cdp, `(function(){ return String(myRoom||'') === ${JSON.stringify(room)} && !!myRoomToken; })()`, 15000);
  return !!inRoom;
}

/* 命中测试：这块地方浏览器会把事件给谁（不是"看起来在上面"，是"点得到"）
 * ▎测的是**收得到点击的那一层**，不是 z-index 的大小——坑 80 的原话：
 *   "界面坏了有时不是逻辑坏了，是被另一层盖住了"。 */
const HIT_TEST = `(function(){
  const hit = (sel, byId) => {
    const el = byId ? document.getElementById(sel) : document.querySelector(sel);
    if (!el) return '(没有这个元素)';
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return '(零尺寸)';
    const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!t) return '(点不到)';
    // 命中的可能是子节点，往上找有 id 的那一层才说得出"是哪个浮层收走了点击"
    let n = t;
    while (n && n !== document.body && !(n.id && n.classList.length > 0)) n = n.parentElement;
    return (n && (n.id || n.className)) || t.tagName;
  };
  return {
    // captionBar 关着时是 hidden（零尺寸），那一条不算证据，所以下面两个"永远在屏上"的
    // 目标才承担真正的判定：按钮本身 + 整排控制坞的中心。
    caption: hit('captionBar', true),
    dock: hit('filesBtn', true),
    row: hit('.controls', false),
    overlayShown: !document.getElementById('filesOverlay').classList.contains('hidden'),
  };
})()`;

/* 截图 → 回灌页面解码 → 量一块矩形的亮度分布。
 * ▎为什么绕这一圈而不在 Node 里解 PNG：页面自己会解 PNG（一条 <img> + canvas），
 *   而 Node 里手撕 PNG 是再造一份实现（还要处理 filter/调色板）。
 *   check-ai-avatar 已经用过同一招（坑 98 那套量具的祖先）。
 * ▎darkPct = 明显暗于中灰的像素占比：这就是"浏览器真的把我这份 PDF 画出来了"的证据。 */
async function screenStats(cdp, clip) {
  let png;
  try {
    png = await cdp.screenshot({ format: 'png', clip });
  } catch (e) {
    return { err: '截图失败：' + ((e && e.message) || e) };
  }
  if (!png || !png.length) return { err: '截图为空' };
  const b64 = png.toString('base64');
  const expr = `(async function(){
    const im = new Image();
    const p = new Promise((res, rej) => { im.onload = () => res(1); im.onerror = () => rej(new Error('解码失败')); });
    im.src = 'data:image/png;base64,${b64}';
    try { await p; } catch (e) { return JSON.stringify({ err: String(e.message || e) }); }
    const c = document.createElement('canvas');
    c.width = im.width; c.height = im.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, im.width, im.height).data;
    let sum = 0, dark = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += L; n++; if (L < 90) dark++;
    }
    return JSON.stringify({ w: im.width, h: im.height, mean: +(sum / n).toFixed(1), darkPct: +(100 * dark / n).toFixed(1) });
  })()`;
  const s = await cdp.evaluate(expr, 30000).catch((e) => JSON.stringify({ err: String((e && e.message) || e) }));
  try { return JSON.parse(s); } catch (e) { return { err: '取值失败' }; }
}

/* 连续两次读数一致才算"画完了"：阅读器冷启动的时间不是常数（坑 96）。 */
async function settleStats(cdp, clip, maxTries = 12) {
  let prev = null;
  for (let i = 0; i < maxTries; i++) {
    const cur = await screenStats(cdp, clip);
    if (cur.err) return cur;
    if (prev && Math.abs(prev.darkPct - cur.darkPct) < 1.5) return cur;
    prev = cur;
    await sleep(700);
  }
  return prev || { err: '读数始终不稳定' };
}

/* ★ 2026-10-09 注入浏览器之前先让同一个引擎读一遍这些串。
 *   模板字符串**内部**的注释里只要出现反引号，模板就被提前截断——源文件语法没错、node --check 全过，
 *   错在拼出来的那段代码；到浏览器里炸的时候，本脚本一条断言都没跑到（详见 scripts/inject-check.js 头部）。 */
require('./inject-check.js').assertCompiles(__filename, { HIT_TEST });

(async () => {
  const docx = FX.makeDocx();
  const xlsx = FX.makeXlsx();
  const png = FX.PNG_1PX;
  /* PDF 夹具是**手写的**（两页，第 1 页画一大块黑）——见 ooxml-fixture.js 里那段注释。
   * ▸ 为什么非得自己画这块黑：PDF 这一路我们**不解析**，所以唯一能证明
   *   "内置阅读器真的解码了我给的字节"的办法，就是让两页的**像素不一样**，
   *   然后去量那个差。从网上拷一份样本改不动它的像素构成，就给不出这个 A/B。 */
  const pdf = FX.makePdf();
  /* Markdown 夹具**故意写长**：滚动同步那条断言要量的是"滚到底"，
   * 内容不比可视区高就没有"底"可滚——第一版 fixture 只有一屏的四五行，
   * 量到的是 `scrollHeight === clientHeight`，那条断言结构上永远不可能成立（假绿）。
   * ▸ 判据：**测一个"变化"之前，先确认这个变化在这份数据上可能发生**（坑 65 的镜像）。 */
  const mdLong = `\n\n## 附：逐条过一遍\n\n` +
    Array.from({ length: 26 }, (_, i) => `${i + 1}. 第 ${i + 1} 条备忘：这一行存在的唯一理由是把内容撑过可视区，`
      + `于是"跟着主讲滚到同一行"这件事在真浏览器里量得出来。`).join('\n');
  const md = '# 评审结论\n\n**下周上线**，先记三条：\n\n- 共享文件面板\n- 跟随主讲\n\n| 事项 | 负责人 |\n|---|---|\n| 上线 | 小张 |\n' + mdLong;
  const mdEvil = '正常文字 <img src=x onerror=alert(1)> <script>boom()</script>\n';
  const legacy = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0, 0, 0, 0]);   // 旧版 .doc 的复合文档头

  const portA = Number(process.env.WB_CDP_PORT) || 9381;
  const portB = portA + 1;
  const A = new Cdp({ headless: true, port: portA, startUrl: URL_, windowSize: { width: 1440, height: 900 } });
  const B = new Cdp({ headless: true, port: portB, startUrl: URL_, windowSize: { width: 1280, height: 860 } });

  try {
    await A.launch();
    await A.waitForLoad(20000);
    await sleep(1500);

    /* ---- 0. 版本指纹：没有这一步，下面每一条都可能是在测 Service Worker 缓存 ---- */
    const fp = await ev(A, `(async () => {
      const js = await (await fetch('client.js', { cache: 'no-store' })).text();
      const fv = await (await fetch('fileview.js', { cache: 'no-store' })).text();
      const css = await (await fetch('style.css', { cache: 'no-store' })).text();
      return {
        client: js.includes('function openFileByName') && js.includes("socket.on('files-view-state'"),
        kernel: fv.includes('function unzip') === false && fv.includes('function openZip') && fv.includes('docxToHtml'),
        css: css.includes('.files-overlay') && css.includes('.fv-slide'),
        loaded: typeof FV === 'object' && typeof FV.render === 'function' ? FV.version : null,
        decomp: typeof DecompressionStream === 'function',
      };
    })()`);
    /* 装上异常收集器：最后一条断言要读它。
     * ▎为什么值得单列一条：这个功能最容易坏的恰恰是"点了没反应但也不报错"那一类
     *   （async 里一个 await 抛了就静默中止），只看 DOM 断言会全部绿过去（坑 69/76）。 */
    await A.evaluate(`(function(){
      window.__cfErrs = [];
      addEventListener('error', (e) => { try { window.__cfErrs.push(String(e.message || e)); } catch (x) {} });
      addEventListener('unhandledrejection', (e) => { try { window.__cfErrs.push('rejection: ' + String((e && e.reason && e.reason.message) || e)); } catch (x) {} });
      return 1;
    })()`);
    ok('A：页面加载的是本轮代码（客户端接线 + 渲染内核 + 样式都在，不是 SW 缓存）',
      fp.client === true && fp.kernel === true && fp.css === true, JSON.stringify(fp));
    ok('A：这个环境真的有 DecompressionStream（内核读 ZIP 靠它，Node 侧测的是注入的另一条路）',
      fp.decomp === true && typeof fp.loaded === 'string', `FV=${fp.loaded}`);

    /* ---- 1. 进房 ---- */
    const room = await enterAsGuestA(A);
    ok(`A：游客建房成功（房间号 ${room || '(无)'}）`, /^\d{6}$/.test(String(room)));
    /* 「一个线性图标 + 文字」这条断言为什么写成 1~2 而不是 ==1：
     * ▸ 第 43 步的拱形升起外壳会把按钮内容搬进"两层同样的字"（宽度取两层最大值，
     *   文字升起时不跳版），图标作为内容**一起被搬**，所以 DOM 里是 2 颗 svg——
     *   这是既有设计不是本轮的毛病。真正的红线只有两条（都是本项目踩出来的）：
     *     ① 看得见的那颗必须有尺寸（没写 CSS 规则的 svg 按 300×150 渲染，坑 78）；
     *     ② 不许有彩色 emoji（坑 79：去 emoji 是全站纪律）。
     *   断言写 ==1 会把"外壳复制了一层"这个正常形态报成缺陷（假红，坑 91 末段）。 */
    const able = await ev(A, `(function(){
      const b = document.getElementById('filesBtn');
      const svgs = Array.prototype.slice.call(b.querySelectorAll('svg.i'));
      const sizes = svgs.map((s) => { const r = s.getBoundingClientRect(); return Math.round(Math.max(r.width, r.height)); });
      return { dis: b.disabled, label: /文件/.test(b.textContent || ''), svg: svgs.length, sizes,
        emoji: /[$\\u2190-\\u2BFF\\uD800-\\uDFFF]/.test(b.textContent || '') };
    })()`);
    ok('A：进房后「文件」按钮可用，且是"线性图标 + 文字"（图标有真实尺寸、没有彩色 emoji）',
      able.dis === false && able.label === true && able.svg >= 1 && able.svg <= 2
      && able.sizes.some((n) => n > 0 && n <= 24) && able.emoji === false, JSON.stringify(able));

    /* ---- 2. 面板开合 + 层叠命中测试 ---- */
    await A.evaluate(`(function(){ document.getElementById('filesBtn').click(); return 1; })()`);
    await sleep(600);
    const open = await ev(A, `(function(){
      const o = document.getElementById('filesOverlay');
      const r = o.getBoundingClientRect();
      return { shown: !o.classList.contains('hidden'), z: getComputedStyle(o).zIndex,
        bottom: Math.round(r.bottom), vh: innerHeight,
        stackBottom: Math.round(document.querySelector('.bottom-stack').getBoundingClientRect().top) };
    })()`);
    ok('A：点按钮后面板出现，且底边停在底部那一列之上（不压字幕条与控制坞）',
      open.shown === true && open.bottom <= open.stackBottom + 2,
      `面板底 ${open.bottom} · 底部列顶 ${open.stackBottom} · 视口 ${open.vh}`);
    const hit = await ev(A, HIT_TEST);
    ok('A：★ 命中测试——面板开着时，控制坞那一排与这颗按钮**仍归自己收**（坑 80 的手法）',
      !/filesOverlay/i.test(String(hit.dock)) && !/filesOverlay/i.test(String(hit.row))
      && !/prejoin|hero/i.test(String(hit.dock)),
      JSON.stringify(hit));
    /* ★ 这一条差点让整份检查变成白测：第一次跑它报的是 dock 中心"命中 = MAIN#hero"——
     *   也就是那颗按钮**根本收不到点击**。查下去不是层叠写错了，是这份检查自己走错了门：
     *   它程序化地点了「创建房间」却没点首屏那颗「进入会议」，于是 z100 的整屏 landing 层
     *   一直盖在会议界面上面；除了命中测试，别的断言读的都是 DOM 属性，全都照样绿。
     *   ▸ 判据（坑 55/63）：**"页面处在用户到得了的状态"本身就是前提**，它得被断言，
     *     不能被省略。所以这里补一条专门盯这件事的断言（下面那条）。 */
    ok('A：★ 首屏那层已经收起来了（否则界面上所有东西都点不到，后面的断言全是在测假状态）',
      await ev(A, `(function(){ const p = document.getElementById('prejoin');
        return p ? (p.classList.contains('hidden') || getComputedStyle(p).display === 'none') : true; })()`) === true);

    /* ---- 3. 上传（走生产函数：XHR + 进度 + 服务器落盘） ---- */
    const up1 = await ev(A, b64Inject('评审结论.md', Buffer.from(md, 'utf8'), 'text/markdown'));
    ok('A：上传 .md 成功且服务器把它列进来了', up1.sent === 1 && up1.names[0] === '评审结论.md', JSON.stringify(up1));
    await ev(A, b64Inject('会议材料.docx', docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
    await ev(A, b64Inject('预算表.xlsx', xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
    await ev(A, b64Inject('示意图.png', png, 'image/png'));
    await ev(A, b64Inject('攻击样本.md', Buffer.from(mdEvil, 'utf8'), 'text/markdown'));
    await ev(A, b64Inject('老文件.doc', legacy, 'application/msword'));
    await ev(A, b64Inject('会议材料.pdf', pdf, 'application/pdf'));
    const listed = await ev(A, `(function(){ return { n: filesData.length, names: filesData.map(f=>f.name),
      quota: document.getElementById('filesQuota').textContent || '',
      rows: document.querySelectorAll('.file-row').length }; })()`);
    ok('A：七份文件都在清单里（.md/.docx/.xlsx/.png/.doc/.pdf 六种类型，行渲染数一致）',
      listed.n === 7 && listed.rows === 7, JSON.stringify(listed.names));
    ok('A：配额行报出真实占用（字节数是从服务器列表来的，不是前端估的）',
      /已用/.test(listed.quota) && /7\/60/.test(listed.quota), listed.quota);

    /* ---- 4. 打开 Markdown：真浏览器里走内核 ---- */
    await ev(A, clickRowSrc('评审结论.md'));
    const mdOk = await until(A, `(function(){
      const s = document.getElementById('filesStage');
      return s.innerHTML.indexOf('评审结论') >= 0 && s.innerHTML.indexOf('<table') >= 0 ? {
        strong: s.innerHTML.indexOf('<strong>下周上线</strong>') >= 0,
        th: s.innerHTML.indexOf('<th') >= 0,
        scrollH: s.scrollHeight, clientH: s.clientHeight,
      } : '';
    })()`);
    ok('A：Markdown 真的渲染出来了（标题/粗体/表格三种结构都在）',
      !!mdOk && mdOk.strong === true && mdOk.th === true, JSON.stringify(mdOk));
    ok('A：内容比可视区高，所以滚动同步这件事有得可测（scrollHeight > clientHeight）',
      !!mdOk && mdOk.scrollH > mdOk.clientH, mdOk ? `${mdOk.scrollH}>${mdOk.clientH}` : '');

    /* ---- 5. XSS 探针：陌生人上传的字节不许变成标签 ---- */
    await ev(A, clickRowSrc('攻击样本.md'));
    const xss = await until(A, `(function(){
      const s = document.getElementById('filesStage');
      if (s.innerHTML.indexOf('onerror') < 0 && s.innerHTML.indexOf('&lt;img') < 0) return '';
      return { tags: s.querySelectorAll('img,script').length, escaped: s.innerHTML.indexOf('&lt;img') >= 0,
               boom: typeof window.boom === 'function' };
    })()`);
    ok('A：★★ 恶意 .md 里的 <img>/<script> 只是文字（页面里没有真的 img/script 节点，也没有全局 boom）',
      !!xss && xss.tags === 0 && xss.escaped === true && xss.boom === false, JSON.stringify(xss));

    /* ---- 6. 打开 Word：这就是"不装任何库读 docx"的那一段，必须在真浏览器里成立 ---- */
    await ev(A, clickRowSrc('会议材料.docx'));
    const dx = await until(A, `(function(){
      const s = document.getElementById('filesStage');
      const t = s.textContent || '';
      if (t.indexOf('项目评审会') < 0) return '';
      return { h1: !!s.querySelector('h1'), strong: !!s.querySelector('strong'),
        table: !!s.querySelector('table'), img: !!s.querySelector('img'),
        li: s.querySelectorAll('li').length,
        noScript: t.indexOf('alert(1)') >= 0 && !s.querySelector('script'),
        kind: (document.getElementById('filesDocKind') || {}).textContent || '' };
    })()`);
    ok('A：★ 真浏览器里解出了 .docx（标题/粗体/列表/表格/内嵌图五种结构都在）',
      !!dx && dx.h1 === true && dx.strong === true && dx.table === true && dx.img === true && dx.li >= 3,
      JSON.stringify(dx));
    ok('A：类型徽标说实话（显示 Word 而不是"文件"）', !!dx && /Word/.test(dx.kind), dx && dx.kind);

    /* ---- 7. 打开 Excel / 图片 ---- */
    await ev(A, clickRowSrc('预算表.xlsx'));
    const xl = await until(A, `(function(){
      const s = document.getElementById('filesStage');
      const t = s.textContent || '';
      if (t.indexOf('会议预算') < 0) return '';
      return { sheets: s.querySelectorAll('.fv-sheetsec').length, rows: s.querySelectorAll('tr').length,
        date: t.indexOf('2023-07-15') >= 0, err: t.indexOf('#DIV/0!') >= 0 };
    })()`);
    ok('A：.xlsx 解出两张表、日期序列号还原成 2023-07-15、错误值原样可见',
      !!xl && xl.sheets === 2 && xl.date === true && xl.err === true, JSON.stringify(xl));
    await ev(A, clickRowSrc('示意图.png'));
    /* ★ 2026-10-09 坑 120 又在这里应验了一次（第七次）：原来的轮询条件是"**img 元素出现了**"，
     *   而断言条件是"**naturalWidth>0**"——图片解码本来就是异步的，
     *   于是这份检查会在"元素在、还没解完"那一帧读到 0 判成产品缺陷（同一个套件今天三次跑出 71/71、
     *   72/72，第四次就红了：**会移动的失败先怀疑量具**，坑 80）。
     *   ▸ 修法是把**轮询条件写成断言条件本身**（判据一个字没放松：仍然要 natural>=1），
     *     超时之后再补读一次现场（complete/clientWidth），让红话说得清"是没解出来还是被撤了 URL"。 */
    const imPoll = await until(A, `(function(){
      const i = document.querySelector('#filesStage img');
      if (!i) return '';
      const o = { natural: i.naturalWidth || 0, src: String(i.src).slice(0, 5), blob: i.src.startsWith('blob:') };
      return (o.natural >= 1 && o.blob) ? o : '';
    })()`, 15000);
    const im = imPoll || await ev(A, `(function(){
      const i = document.querySelector('#filesStage img');
      if (!i) return { natural: 0, blob: false, note: '没有 img 元素' };
      return { natural: i.naturalWidth || 0, src: String(i.src).slice(0, 5),
        blob: String(i.src).startsWith('blob:'), complete: i.complete, cssW: i.clientWidth };
    })()`);
    ok('A：图片用 blob: URL 真解码成功（naturalWidth>0 = 字节真的走通了下载这条路）',
      !!im && im.natural >= 1 && im.blob === true, JSON.stringify(im));

    /* ---- 8. 旧版 .doc：明说看不了，而不是留一片空白 ---- */
    await ev(A, clickRowSrc('老文件.doc'));
    const lg = await until(A, `(function(){
      const u = document.querySelector('#filesStage .fv-unsupported');
      return u ? { text: u.textContent, dl: !document.getElementById('filesDlBtn').classList.contains('hidden') } : '';
    })()`);
    ok('A：旧版 .doc 说清了"为什么看不了 + 下一步做什么"，并且下载按钮还在',
      !!lg && /下载/.test(lg.text) && lg.dl === true, lg ? String(lg.text).slice(0, 60) : '');

    /* ---- 8c. ★ 真形状与旧格式（2026-10-09，J1+J2）：这两类文件**不是我的夹具** ----
     * ▎rich.docx/.xlsx 由 python-docx/openpyxl 写，legacy.doc/.xls 由**真的 Microsoft
     *   Word/Excel** 写（scripts/legacy-oracle.ps1）。它们在这一节走的是用户那条路：
     *   上传 → 服务器落盘 → 页面 fetch 字节 → 浏览器里的 DecompressionStream / OLE2 解析 → DOM。
     *   单测（Q/L 组）能证明"代码算得对"，证明不了"这个界面看得见"——
     *   而用户抱怨的"word 还是不能观看"恰恰是后者（坑 41/56 那一族：接线没人测）。 */
    {
      const fxDir = path.join(__dirname, 'fixtures', 'office');
      const lDir = path.join(fxDir, 'legacy');
      const paths = [path.join(fxDir, 'rich.docx'), path.join(fxDir, 'rich.xlsx'),
        path.join(lDir, 'legacy.doc'), path.join(lDir, 'legacy.xls')];
      const missing = paths.filter((p) => !fs.existsSync(p));
      ok('8c 前提：真形状与旧格式夹具都在仓库里（缺了就跑 office-oracle.py / legacy-oracle.ps1）',
        missing.length === 0, `缺 ${missing.length} 份`);
      if (!missing.length) {
        await ev(A, b64Inject('真形状.docx', fs.readFileSync(paths[0]), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
        await ev(A, b64Inject('真形状.xlsx', fs.readFileSync(paths[1]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
        await ev(A, b64Inject('Word97.doc', fs.readFileSync(paths[2]), 'application/msword'));
        await ev(A, b64Inject('Excel97.xls', fs.readFileSync(paths[3]), 'application/vnd.ms-excel'));

        await ev(A, clickRowSrc('真形状.docx'));
        const rich = await until(A, `(function(){
          const s = document.getElementById('filesStage');
          const t = s.textContent || '';
          if (t.indexOf('项目评审会议记录') < 0) return '';
          return {
            ol: s.querySelectorAll('ol').length, ul: s.querySelectorAll('ul').length,
            li: s.querySelectorAll('li').length,
            link: !!s.querySelector('a[href="https://example.com/report"]'),
            img: s.querySelectorAll('img').length,
            txbx: t.indexOf('文本框里的字') >= 0,
            math: t.indexOf('伽马除以贝塔') >= 0,
            fldResult: t.indexOf('域结果三三七') >= 0,
            instrLeak: /\\bPAGE\\b|NUMPAGES/.test(t),
            headerLeak: t.indexOf('页眉：公司内部资料') >= 0
          };
        })()`);
        ok('A：★ 编号来自**样式**的列表，在真浏览器里也画成了 ol/ul（这条缺陷原先只在 Node 单测里看得见）',
          !!rich && rich.ol >= 1 && rich.ul >= 1 && rich.li >= 6, JSON.stringify(rich));
        ok('A：真形状 docx 的外链与内嵌图都在（rels 那条路在浏览器里也通）',
          !!rich && rich.link === true && rich.img >= 1, JSON.stringify(rich));
        ok('A：★ 文本框 / 域结果 / 公式这三种"字不在正文流里"的东西，屏幕上真的看得到',
          !!rich && rich.txbx === true && rich.fldResult === true && rich.math === true, JSON.stringify(rich));
        ok('A：域**指令**没上屏、页眉也没混进正文（界面上不许出现"给机器的话"）',
          !!rich && rich.instrLeak === false && rich.headerLeak === false, JSON.stringify(rich));

        await ev(A, clickRowSrc('真形状.xlsx'));
        const richX = await until(A, `(function(){
          const s = document.getElementById('filesStage');
          const t = s.textContent || '';
          if (t.indexOf('备考计划') < 0) return '';
          return { pct: t.indexOf('25.00%') >= 0, money: t.indexOf('¥1,234.50') >= 0,
            merged: !!s.querySelector('td[colspan]'),
            serialKept: t.indexOf('45570') >= 0,
            rows: s.querySelectorAll('tr').length };
        })()`);
        ok('A：★ 百分比与货币按格式码念出来（0.25 与 25.00% 是两个数——读错数比难看严重）',
          !!richX && richX.pct === true && richX.money === true, JSON.stringify(richX));
        ok('A：合并单元格跨列 + 稀疏行没被压扁（裁判里有内容的最后一行仍然排得下）',
          !!richX && richX.merged === true && richX.rows >= 12, JSON.stringify(richX));

        await ev(A, clickRowSrc('Word97.doc'));
        const ldoc = await until(A, `(function(){
          const s = document.getElementById('filesStage');
          const t = s.textContent || '';
          if (t.indexOf('旧格式回归样本') < 0) return '';
          return { note: !!s.querySelector('.fv-legacy-note'),
            saysRaw: t.indexOf('不还原') >= 0,
            list: t.indexOf('编号项甲') >= 0, table: t.indexOf('跨网验收') >= 0,
            txbx: t.indexOf('文本框里的字QZ3') >= 0,
            instrLeak: /\\bPAGE\\b|NUMPAGES/.test(t),
            paras: s.querySelectorAll('.fv-p').length };
        })()`);
        ok('A：★★ 真的 Word 97 .doc 在浏览器里看得见了（piece table 抽取，含表格与文本框）',
          !!ldoc && ldoc.list === true && ldoc.table === true && ldoc.txbx === true, JSON.stringify(ldoc));
        ok('A：旧格式横幅当面说清"只还原文字、版式不还原"（不把文字版说成渲染好了）',
          !!ldoc && ldoc.note === true && ldoc.saysRaw === true, JSON.stringify(ldoc));
        ok('A：.doc 的域指令同样没上屏（三种来源共用同一条纪律）',
          !!ldoc && ldoc.instrLeak === false, JSON.stringify(ldoc));

        await ev(A, clickRowSrc('Excel97.xls'));
        const lxls = await until(A, `(function(){
          const s = document.getElementById('filesStage');
          const t = s.textContent || '';
          if (t.indexOf('合并说明MX8') < 0) return '';
          return { merged: !!s.querySelector('td[colspan]'), formula: t.indexOf('1234.75') >= 0,
            num: t.indexOf('46327') >= 0, note: !!s.querySelector('.fv-legacy-note') };
        })()`);
        ok('A：★ 真的 Excel 97 .xls（BIFF8：共享字符串 + RK + 公式缓存值 + 合并区域）读通了',
          !!lxls && lxls.merged === true && lxls.formula === true && lxls.num === true, JSON.stringify(lxls));

        /* 可选：把用户手头那份真文件也过一遍（**只报结构、不打印内容**，也不设红线——
         * 那份文件不在仓库里，把它的句子写死成断言就是"明天必红的假红制造机"，坑 91）。 */
        const real = process.env.REAL_OFFICE_FILE;
        if (real && fs.existsSync(real)) {
          const buf = fs.readFileSync(real);
          const nm = `我的真文件${path.extname(real) || '.doc'}`;
          await ev(A, b64Inject(nm, buf, 'application/octet-stream'));
          await ev(A, clickRowSrc(nm));
          /* ★ 轮询条件必须 = 断言条件（坑 120 第三次应验，还是栽在"读早了"上）：
           *   第一版这里"立刻返回一个对象"，读到的是 showStageBusy 那行占位文字
           *   （十几个字符），于是报成像"这份真文件抽不出文字"——而真相是量具读早了。
           *   ▸ 2026-10-10（C5）改用共用的 STAGE_STATE（结构判据）。顺手记一条真实的漂移证据：
           *     这一处原先写的是 `replace(/\\s+/g,'')` 少反斜杠的那一份副本，在模板串里变成
           *     `/s+/g` ——**剥掉的是字母 s 而不是空白**，于是它的字数一直虚高、从不报白屏。
           *     同一个判据两份副本，一份尺度相关、一份算错，各自都"绿"（坑 47 + 坑 53）。 */
          const obs = await until(A, STAGE_STATE, 25000);
          console.log(`  OBSERVE 用户真文件（只报结构）：${JSON.stringify(obs)} · 源 ${(buf.length / 1024).toFixed(0)}KB`);
          ok('用真文件（REAL_OFFICE_FILE）至少走到"有内容"或"明确说不行"之一（不许白屏）',
            !!obs && (obs.content === true || obs.unsupported === true), JSON.stringify(obs));
        }

        /* ★ 2026-10-09（L2 的自走版）→ 2026-10-10（C5）改成**按形状类别**取样。
         *   ▎为什么值得加：`review:office` 那台回扫跑在 Node 里，而"发出去的那几行代码"在浏览器
         *     那一轨可能一次都没走过（坑 118 就是栽在这条缝上）；一份一份指文件又太累，
         *     累的工具不会被用。
         *   ▎C5 换掉的是取样方式：上一版"取目录里前 8 份"，而"8 份都渲染出来了"这句话
         *     覆盖面全看目录里恰好有什么——本机 docx 占九成时，旧版 .ppt、xlsx 的百分比格式、
         *     pptx 备注页、坏 ZIP 可能一份都没进来，报告读起来却同样是"通过"。
         *     **样本很多 ≠ 形状都到了**（判据与清单在 scripts/office-shapes.js，与回扫共用一份）。
         *   ▎判据的形状（四条都是被坑咬过之后写的）：
         *     ① **不断言内容**——别人文件夹里的句子明天就会变，写死就是假红制造机（坑 91）；
         *     ② 每一份只判"走到**有内容**或**明确说不行**"之一（白屏 = 真缺陷）；
         *     ③ 目录里没有可扫的文件 ⇒ 报"没扫到"而不是"没问题"（坑 105：没证据 ≠ 通过）；
         *     ④ 某一类本机没有真文件 ⇒ 用仓库夹具顶一份，**并写明那是夹具不是用户文件**
         *        （夹具只证明内核认得这个形状，不证明你那份没问题，坑 130）。
         *     文件名与字节数会打出来（那是要拿去加夹具的线索），**内容一个字节都不打**。 */
        const realDir = process.env.REAL_OFFICE_DIR;
        if (realDir && fs.existsSync(realDir)) {
          const OK_EXT = ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.rtf', '.md'];
            /* .rtf/.md 留在候选里：它们会被 classify 判成 not-office、当"随手扫"的余量用，
             *   删掉就等于**顺手缩小了浏览器那一轨的覆盖面**（上一版就在这两个扩展名上量过）。 */
          const cap = Math.max(1, Number(process.env.REAL_OFFICE_MAX) || 8);
          const probeCap = Math.max(cap, Number(process.env.REAL_OFFICE_PROBE) || 200);
          const found = [];
          (function walk(d, depth) {
            if (depth > 2 || found.length >= probeCap) return;
            let ents = [];
            try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
            for (const en of ents) {
              if (found.length >= probeCap) return;
              const fp = path.join(d, en.name);
              if (en.isDirectory()) { walk(fp, depth + 1); continue; }
              if (!OK_EXT.includes(path.extname(en.name).toLowerCase())) continue;
              let st = null;
              try { st = fs.statSync(fp); } catch (e) { continue; }
              if (!st.size || st.size > 40 * 1024 * 1024) continue;   // 与生产同一道保险丝（>40MB 不解析）
              found.push(fp);
            }
          })(realDir, 0);
          /* 按类别取样：九类各一份（真文件优先，缺的用夹具顶），剩余名额才给随手扫的 */
          const sel = await Shapes.selectByCategory(found, {
            probeMax: probeCap, extraMax: Math.max(cap, Shapes.CLASSES.length),
          });
          const rows = [];
          for (let i = 0; i < sel.queue.length; i++) {
            const q = sel.queue[i];
            let buf;
            try { buf = q.bytes ? Buffer.from(q.bytes) : fs.readFileSync(q.p); } catch (e) { continue; }
            const ext = path.extname(q.name).toLowerCase() || '.doc';
            const nm = `${q.fixture ? '夹具' : '真批量'}-${q.id}${ext}`;
            const up = await ev(A, b64Inject(nm, buf, 'application/octet-stream'));
            const clk = await ev(A, clickRowSrc(nm));
            const pt0 = Date.now();
            /* ★ 判据从"字符数 > 40"换成**结构信号**（这是今晚这条红的真正修法，改判据不是放水）：
             *   ▸ 红的是 pptx-notes 那份夹具——它**渲染得好好的**（htmlLen=1355），
             *     只是两页幻灯片的非空白字数是 **39**，正好压在我那条 `chars > 40` 下面，
             *     于是轮询到超时、报成"白屏"。**绝对字数当"有没有内容"的判据天生尺度相关**：
             *     两页的 PPT、一行字的表格、一页满图的扫描件都会撞线，而它们都不是白屏
             *     （坑 53"判够不够格的量必须尺度无关"+ 坑 91"假要求的断言=假红制造机"）。
             *   ▸ 现在问的是界面自己那几个状态类：有 `.fv-doc / .fv-slide / table / img / pdf 框架`
             *     之一且没有转圈的 `.files-busy` = 有内容；有 `.fv-unsupported` = 明确说不行。
             *     字数继续打印，但只当观察值，不再是判据。 */
            let o = await until(A, STAGE_STATE, Number(process.env.REAL_OFFICE_WAIT || 25000));
            const waited = Date.now() - pt0;
            /* 没走到终态就**当场把现场打出来**，否则这条红只能靠猜（与 test:room-actions 那台 chatHas
             *   同一个教训：报错要自己交代它看到了什么，坑 55/63 同一条）。
             *   ▸ 顺带分开两种以前混在一起的情况：until() 超时返回 false = "根本没量到"（deadline:true），
             *     与"量到 content=false"不是同一件事——旧写法 `|| {chars:0}` 把它们合成同一个数
             *     （今晚那条红就是这么含糊的，最后查出来是判据而不是产品）。 */
            if (!o || !o.content) {
              /* 红场取证：**状态读法与轮询共用 STAGE_FN**（坑 120：轮询条件必须等于断言条件；
               *   取证那一份如果另写一遍，读到 0 时你分不清是"内容没到"还是"我的式子读不到"）。
               *   今晚这条红最后查出来就是这一类：判据自己错，而现场看起来像产品坏。 */
              const dump = await ev(A, `(function(){
                const s = document.getElementById('filesStage');
                const rs = Array.prototype.slice.call(document.querySelectorAll('.file-row'))
                  .map(function (r) { return r.getAttribute('data-name'); });
                return Object.assign((${STAGE_FN})(), { htmlLen: (s.innerHTML || '').length,
                  htmlTail: (s.innerHTML || '').slice(-220), rows: rs.slice(0, 26),
                  doc: (document.getElementById('filesDocName') || {}).textContent || '' });
              })()`);
              o = Object.assign({ chars: 0, content: false, unsupported: false, legacy: false, tables: 0, deadline: !o }, (o || {}), { dump });
            }
            rows.push({ name: q.name, id: q.id, ext, fixture: !!q.fixture,
              /* 上传后**服务器存的名字**与点的那一行不一致时，这两栏会直接说出是谁错了
                 （以前我把 up/clk 的返回值全丢了——丢了返回值 = 红了只能猜，坑 63 同族） */
              stored: up && up.names ? up.names[0] : '', clicked: !!(clk && clk.clicked), waitedMs: waited,
              kb: Math.round(buf.length / 1024), ...o });
          }
          /* 白屏 = 真缺陷；但**故意坏的那一类例外**——它必须走到"明确说不行"（unsupported），
           * 而它的 .fv-unsupported 是真的会出现，所以照常判；这里唯一的特例是别把它算进"内核坏了"。 */
          const blank = rows.filter((r) => r.content !== true && r.unsupported !== true);
          const legacyN = rows.filter((r) => r.legacy).length;
          const realN = rows.filter((r) => !r.fixture).length;
          const cov = Shapes.coverageLines(sel.counts, sel.usedFixture);
          console.log(`  OBSERVE 批量真文件（只报结构）：${rows.length} 份（真文件 ${realN} · 夹具 ${rows.length - realN}）· `
            + `旧版横幅 ${legacyN} 份 · 白屏 ${blank.length} 份 · 看了 ${sel.probed} 份的字节做分类`
            + `${sel.skippedBig ? `（另有 ${sel.skippedBig} 份太大没读）` : ''}`);
          console.log(`  OBSERVE 明细 ${JSON.stringify(rows.map((r) => ({ f: r.name, k: r.id, x: r.ext, kb: r.kb, c: r.chars, t: r.tables, u: r.unsupported, fx: r.fixture, st: r.stored, cl: r.clicked, w: r.waitedMs })))}`);
          /* 白屏的每一行都把现场摊开：存进来的名字 / 有没有点到那一行 / 舞台尾部 HTML */
          for (const r of rows.filter((x) => x.content !== true && x.unsupported !== true)) {
            console.log(`     ↳ 白屏现场 ${r.id}：stored=${JSON.stringify(r.stored)} clicked=${r.clicked} deadline=${r.deadline === true} `
              + `waited=${r.waitedMs}ms 舞台 content=${r.dump && r.dump.content} chars=${r.dump && r.dump.chars} htmlLen=${r.dump && r.dump.htmlLen} doc=${JSON.stringify(r.dump && r.dump.doc)} 尾部=${JSON.stringify(r.dump && r.dump.htmlTail)}`);
            console.log(`       清单里的行：${JSON.stringify((r.dump && r.dump.rows || []).slice(0, 26))}`);
          }
          console.log('  ── 类别覆盖（这一栏说明上面那句"没有白屏"适用于哪些形状）──');
          for (const l of cov) console.log(`    ${l.mark} ${l.cn} —— ${l.text}`);
          if (!rows.length) {
            /* 不打"通过"——一条断言都没成立，只是没东西可量（坑 105）。 */
            console.log(`  SKIP   REAL_OFFICE_DIR 里没扫到可解析的 Office 文件（目录存在但没有 `
              + `${OK_EXT.join('/')} 类型）—— 这是"没量到"，不是"通过"`);
          } else {
            ok(`批量真文件（REAL_OFFICE_DIR）每一份都走到"有内容"或"明确说不行"（${rows.length} 份，一个都不许白屏）`,
              blank.length === 0, blank.length ? `白屏的：${JSON.stringify(blank)}` : `旧版横幅 ${legacyN} 份`);
          }
          /* ❔ 只在"连仓库夹具都拿不出来"时出现 ⇒ 那是仓库缺件，该红（不是用户没文件）。
           *   本机没有真文件只降到 ⚠️（夹具顶上），不红——但报告里必须看得见它只有夹具。 */
          const skippedCov = cov.filter((l) => l.mark === '❔');
          ok(`C5 类别覆盖：九类形状各至少一份（真文件或夹具），缺件才报 SKIP（当前 真文件 ${realN} · 夹具 ${rows.length - realN}）`,
            skippedCov.length === 0, skippedCov.length ? '彻底没样本的类别：' + skippedCov.map((l) => l.cn).join(' / ') : '');
        }
      }
    }

    /* ---- 8b. PDF 的真浏览器证据（I1，2026-10-08）：内置阅读器**真的解码了我给的字节** ----
     * ▎这一路的难点是"我们什么都不解析"，所以能断言的只有三件事：
     *   ① 元素与片段形状对不对（iframe.files-pdf + #page=N&view=FitH）；
     *   ② 服务器有没有**放行内联**（PDF 在白名单里 ⇒ Content-Type 是 application/pdf、
     *     没有 attachment；而 .md 必须相反——那才是"白名单真的在做事"的 A/B）；
     *   ③ **像素**：第 1 页我画了一块占 64% 面积的黑，第 2 页没有 ⇒
     *     两页的暗像素占比必须明显不同。如果阅读器根本没解码（空白页/错误页），
     *     两页测出来一样 ⇒ 这条当场红。这就是"内容差的断言"，比"元素存在"硬得多。 */
    const rowPdf = await ev(A, clickRowSrc('会议材料.pdf'));
    ok('A：点 PDF 那一行（走生产入口）', rowPdf.clicked === true, JSON.stringify(rowPdf));
    const pdfEl = await until(A, `(function(){
      const fr = document.querySelector('#filesStage iframe.files-pdf');
      if (!fr) return '';
      const r = fr.getBoundingClientRect();
      if (!r.width || !r.height) return '';
      return { src: String(fr.src).slice(0, 5), blob: String(fr.src).startsWith('blob:'),
        page: /#page=1(&|$)/.test(fr.src), w: Math.round(r.width), h: Math.round(r.height),
        x: Math.round(r.left), y: Math.round(r.top),
        kind: (document.getElementById('filesDocKind') || {}).textContent || '' };
    })()`, 9000);
    ok('A：★ PDF 交给浏览器内置阅读器 —— iframe 出现、src 是 blob: 且带 #page=1、类型徽标说 PDF',
      !!pdfEl && pdfEl.blob === true && pdfEl.page === true && /PDF/.test(pdfEl.kind), JSON.stringify(pdfEl));

    /* 响应头这一对是**互相印证**的：PDF 必须内联（否则内置阅读器拿不到流），
     * .md 必须强制下载（否则里面的 HTML 会被当页面执行）。只测一头，另一头漂了没人知道。 */
    const heads = await ev(A, `(async function(){
      const one = async (name) => {
        const r = await fetch(fileBlobUrl(myRoom, name), { headers: roomTokenHeader(), cache: 'no-store' });
        return { status: r.status, ct: r.headers.get('content-type') || '',
          cd: r.headers.get('content-disposition') || '', nosniff: r.headers.get('x-content-type-options') || '' };
      };
      return { pdf: await one('会议材料.pdf'), md: await one('评审结论.md') };
    })()`);
    ok('A：★★ 白名单真的在做事——PDF 内联（application/pdf、无 attachment），.md 强制下载 + nosniff',
      /^application\/pdf/i.test(heads.pdf.ct) && /^inline/i.test(heads.pdf.cd) && heads.pdf.nosniff === 'nosniff'
      && /attachment/i.test(heads.md.cd) && /octet-stream/i.test(heads.md.ct) && heads.md.nosniff === 'nosniff',
      JSON.stringify(heads));

    const clip = pdfEl ? { x: pdfEl.x, y: pdfEl.y, width: pdfEl.w, height: pdfEl.h } : null;
    /* ── PDF 换页的证据：这里有一次**量具的诚实边界**，值得整段读一遍 ──────────────
     * ▸ 我本来想用**像素**：夹具第 1 页画了一块黑、第 2 页没画 ⇒ 换页成功的话暗像素占比要掉。
     *   实测却是同一页连着量出 34% / 49% / 94% / 53% 乱跳 ——
     *   **headless 里内置 PDF 插件的合成是异步的**，`captureScreenshot` 经常抓到"还没画"的黑帧。
     *   一个自己会乱跳的读数不能当判据（坑 80：会移动的失败先怀疑量具；坑 96：量具别跟自己的动画赛跑）。
     * ▸ 于是换成两条**可靠**的断言，而它们量的正是这个缺陷的机制本身：
     *     ① 换页之后 stage 里那个 iframe 是**一个新节点**（不是同一个元素改了 src）；
     *     ② 它的 src 带着新页码。
     *   ▸ 为什么这恰好是要害：原缺陷就是"只改同一个 iframe 的片段"——
     *     浏览器把它当"同一文档内的片段跳转"，插件不重新加载，于是**翻页从来没生效过**，
     *     而 src、页码标签、日志全都"看起来对"（坑 76"机制在但从未生效"第 N 例）。
     *     节点身份变了 = 插件确实被重新加载。
     * ▸ 像素那一路降级成**观察项**（只打印不判红）；真机看一眼已写进 AGENTS 第 0.2 节的人工清单。 */
    const frameStamp = await ev(A, `(function(){
      const fr = document.querySelector('#filesStage iframe.files-pdf');
      if (!fr) return { ok: false };
      window.__cfSeq = (window.__cfSeq || 0) + 1;
      fr.__cfId = window.__cfSeq;                      // 给这个节点盖个戳，换页后看它还在不在
      return { ok: true, id: fr.__cfId, src: String(fr.getAttribute('src') || fr.src) };
    })()`);
    ok('A：打开 PDF 时挂上了一个 iframe 节点（换页拿它的身份做对照）',
      frameStamp.ok === true, JSON.stringify(frameStamp));
    await ev(A, `(function(){ document.getElementById('filesNextBtn').click(); return 1; })()`);
    const afterPage = await until(A, `(function(){
      const fr = document.querySelector('#filesStage iframe.files-pdf');
      if (!fr) return '';
      const src = String(fr.getAttribute('src') || fr.src);
      return /#page=2(&|$)/.test(src) ? { same: fr.__cfId === ${JSON.stringify(frameStamp.id)}, src } : '';
    })()`, 8000);
    ok('A：★★ 点「下一页」真的换页了 —— iframe 是**重新挂载的新节点**、src 带着 #page=2',
      !!afterPage && afterPage.same === false, JSON.stringify(afterPage));
    /* ★ 反向对照（A/B）：当场演示"旧写法"为什么量得出来不一样。
     *   原地改片段是**同一个节点** ⇒ 上面那条 `same === false` 会红。
     *   判据不亲自证一次"能红"，它就只是碰巧绿着（坑 63/80 反复立的那条规矩）。 */
    const abOld = await ev(A, `(function(){
      const fr = document.querySelector('#filesStage iframe.files-pdf');
      const before = fr;
      fr.src = FV.pdfSrc(filesOpen.blobUrl, filesOpen.page);      // 旧写法：原地改片段，不重建
      const after = document.querySelector('#filesStage iframe.files-pdf');
      return { same: before === after, hasPage2: /#page=2(&|$)/.test(String(after.getAttribute('src') || '')) };
    })()`);
    ok('A：★★ 反向对照可红：旧写法（原地改片段）节点身份**不变** ⇒ 上面那条 same===false 真有判别力',
      abOld.same === true && abOld.hasPage2 === true, JSON.stringify(abOld));
    ok('A：★ 同一页重复换页不换节点（否则每次跟随都会闪一下阅读器）',
      await ev(A, `(function(){
        const before = document.querySelector('#filesStage iframe.files-pdf');
        setPageQuiet(2);                                // 已经是第 2 页：应当原地不动
        return before === document.querySelector('#filesStage iframe.files-pdf');
      })()`) === true);
    if (clip) {
      const ob = await screenStats(A, clip);
      console.log('     （观察项，不判红）PDF 区域像素读数：' + JSON.stringify(ob)
        + ' —— headless 下内置插件的合成是异步的，同一页多次读数会跳，所以只打印。');
    }

    /* ---- 9. B 加入：清单必须由服务器补发（不是 B 自己去猜） ---- */
    await B.launch();
    await B.waitForLoad(20000);
    await sleep(1500);
    await B.evaluate(`(function(){
      window.__cfErrs = [];
      addEventListener('error', (e) => { try { window.__cfErrs.push(String(e.message || e)); } catch (x) {} });
      addEventListener('unhandledrejection', (e) => { try { window.__cfErrs.push('rejection: ' + String((e && e.reason && e.reason.message) || e)); } catch (x) {} });
      return 1;
    })()`);
    const joined = await joinAsGuestB(B, String(room));
    ok(`B：第二个游客凭号加入同一间房（${room}）`, joined === true);
    await B.evaluate(`(function(){ document.getElementById('filesBtn').click(); return 1; })()`);
    /* 判据从"等于我数过的 7 行"改成"**与主讲端一样多**"（2026-10-09，8c 之后）：
     * ▸ 前一版把行数写死，于是每往这套检查里加一份上传文件，就得回头改三个数字——
     *   那种断言测的是"我记得的文件数"，不是"补发这件事成没成"（坑 106 的断言版）。 */
    const aBase = await ev(A, `(function(){ return filesData.length; })()`);
    const bList = await until(B, `(function(){
      const n = filesData.length; return n >= ${aBase} ? { n, names: filesData.map(f=>f.name) } : '';
    })()`, 12000);
    ok('B：★ 晚进来的人靠 files-state 补发拿到同一份清单（与主讲端一样多，不是空面板）',
      !!bList && bList.n === aBase, `A=${aBase} B=${bList && bList.n}`);

    /* ---- 10. 跟随主讲：A 换文件 → B 的屏幕上出现同一份渲染结果 ----
     * ▸ 这里点的是**清单里的行**，不是直接调 openFileByName()：
     *   生产的用户入口是"点行"，而它做两件事（打开 + 广播）。测试直接调内层函数
     *   就等于把"广播"那一半从被测范围里擦掉了——正是"测的是桩不是代码"（坑 63）。 */
    await B.evaluate(`(function(){ setFilesOpen(false); setFilesFollow(true); return 1; })()`);
    const rowClicked = await ev(A, clickRowSrc('会议材料.docx'));
    ok('A：点清单里的那一行就是用户的打开动作（行存在、点得动）',
      rowClicked.clicked === true, JSON.stringify(rowClicked));
    const bFollow = await until(B, `(function(){
      const t = (document.getElementById('filesStage') || {}).textContent || '';
      return t.indexOf('项目评审会') >= 0 ? {
        open: filesOn, doc: (document.getElementById('filesDocName') || {}).textContent || '',
        who: (document.getElementById('filesWho') || {}).textContent || '',
        mine: filesView && filesView.byId === socket.id,
      } : '';
    })()`, 12000);
    ok('B：★★★ A 一打开这份文档，B 的面板自己起来并渲染出同一份内容（"同时看到"的硬证据）',
      !!bFollow && bFollow.open === true && /会议材料\.docx/.test(bFollow.doc),
      JSON.stringify(bFollow));
    ok('B：屏幕上写明是**谁**在带大家看（同步这件事必须看得见，不是默默跟着变）',
      !!bFollow && /A|成员|我/.test(String(bFollow.who)) && bFollow.mine === false,
      bFollow && bFollow.who);

    /* ---- 10b. ★ 旧格式也要有"第二个人的屏幕"这条证据（2026-10-09，J2）----
     * ▎为什么单列：.doc 这一路的价值不是"我能解析二进制"，而是"会议室里另一个人
     *   在他的屏幕上读到了同一份抽出来的文字"。只在 A 这边量过 = 一半证据（坑 41/56）。 */
    await ev(A, clickRowSrc('Word97.doc'));
    const bLegacy = await until(B, `(function(){
      const t = (document.getElementById('filesStage') || {}).textContent || '';
      return t.indexOf('编号项甲') >= 0 ? {
        doc: (document.getElementById('filesDocName') || {}).textContent || '',
        note: !!document.querySelector('#filesStage .fv-legacy-note'),
        table: t.indexOf('跨网验收') >= 0,
      } : '';
    })()`, 14000);
    ok('B：★★★ A 打开那份 Word 97 的 .doc，B 的屏幕上出现同样抽出来的文字（旧格式也过了"两个人"这一关）',
      !!bLegacy && /Word97\.doc/.test(String(bLegacy.doc)) && bLegacy.table === true,
      JSON.stringify(bLegacy));
    ok('B：跟随端同样看得见"版式不还原"那句说明（边界不能只在主讲屏幕上说一次）',
      !!bLegacy && bLegacy.note === true, JSON.stringify(bLegacy));

    /* ---- 11. 滚动同步：A 滚到底 → B 的滚动条跟过去 ----
     * ▎轮询的条件**必须就是断言的条件**。第一版这里轮的是"B 的画面能滚了(max>0)"，
     *   而那一刻 B 刚换完文件、A 的滚动还在节流窗口里没上路 → 读到 ratio=0 判红。
     *   一条"到点了就读"的断言量的是时序运气，不是功能（坑 96/104 的第 N 次应验，
     *   这次栽在我自己刚写的量具上）。现在轮的是"跟到 0.85 以上"，超时再单独取一次现场。 */
    const rowMd = await ev(A, clickRowSrc('评审结论.md'));
    ok('A：换到那份长 Markdown（这份夹具故意写长，见文件头那条注释）',
      rowMd.clicked === true, JSON.stringify(rowMd));
    await sleep(700);
    const aScroll = await ev(A, `(function(){
      const s = document.getElementById('filesStage');
      const max = s.scrollHeight - s.clientHeight;
      s.scrollTop = max;                                  // 真滚到底，触发生产的那条 scroll 监听
      return { max, top: s.scrollTop };
    })()`);
    ok('A：★ 前提——这份文档在 A 这边真的能滚（max>0）且已经滚到底（否则"跟到底"无从谈起）',
      aScroll.max > 0 && aScroll.top >= aScroll.max - 2, JSON.stringify(aScroll));
    const bScroll = await until(B, `(function(){
      const dn = (document.getElementById('filesDocName') || {}).textContent || '';
      if (dn.indexOf('评审结论') < 0) return '';           // 还没跟到这一份
      const s = document.getElementById('filesStage');
      const max = s.scrollHeight - s.clientHeight;
      if (max <= 0) return '';                            // 还没长到能量出滚动
      const ratio = s.scrollTop / max;
      return ratio > 0.85 ? { ratio, max, top: s.scrollTop, applying: applyingRemote } : '';
    })()`, 10000);
    const bScene = bScroll === false ? await ev(B, `(function(){
      const s = document.getElementById('filesStage');
      const max = s.scrollHeight - s.clientHeight;
      return { doc: (document.getElementById('filesDocName') || {}).textContent || '',
        max, top: s.scrollTop, ratio: max > 0 ? s.scrollTop / max : null,
        follow: filesFollow, view: filesView && { name: filesView.name, scroll: filesView.scroll } };
    })()`) : bScroll;
    ok('B：A 把这份文档滚到底，B 也到了底部（比例传递，所以两边窗口高度不同也对得上）',
      bScroll !== false && bScroll.ratio > 0.85, JSON.stringify(bScene));

    /* ---- 12. 回声：B 跟着滚动之后，A 的位置不许被 B 拽回去 ---- */
    const aBefore = await ev(A, `(function(){
      const s = document.getElementById('filesStage');
      s.scrollTop = 0;                                    // A 回到顶部
      return s.scrollTop;
    })()`);
    await sleep(1400);
    const aAfter = await ev(A, `(function(){ return document.getElementById('filesStage').scrollTop; })()`);
    ok('A：★★ B 跟随产生的滚动没有回广播给 A（断环成立，否则两边会互相拽着滚）',
      aBefore === 0 && aAfter === 0, `A 的 scrollTop ${aBefore} → ${aAfter}`);

    /* ---- 13. 关掉跟随之后各看各的 ---- */
    await B.evaluate(`(function(){ setFilesFollow(false); return 1; })()`);
    await ev(A, clickRowSrc('预算表.xlsx'));
    await sleep(1600);
    const bFree = await ev(B, `(function(){ return { doc: (document.getElementById('filesDocName')||{}).textContent || '', follow: filesFollow }; })()`);
    ok('B：关掉跟随后 A 再换文件，B 停在原处（"我只想看自己那份"必须被尊重）',
      /评审结论\.md/.test(bFree.doc) && bFree.follow === false, JSON.stringify(bFree));
    ok('B：但徽标仍然写明是谁在带（不跟也要知道现在归谁）',
      /成员|我/.test(String((await ev(B, `(function(){ return (document.getElementById('filesWho')||{}).textContent || ''; })()`)) || '')));

    /* ---- 14. 删除：A 删一份，B 的清单自己少一行 ---- */
    await B.evaluate(`(function(){ setFilesFollow(true); return 1; })()`);
    await ev(A, `(function(){ socket.emit('files-delete', { name: '老文件.doc' }); return 1; })()`);
    const bDel = await until(B, `(function(){ return filesData.length === ${aBase - 1} ? ${aBase - 1} : ''; })()`, 9000);
    ok(`B：A 删掉一份之后 B 的清单自己少一行（${aBase} → ${aBase - 1}，广播到了，不是各自缓存）`,
      bDel === aBase - 1, String(bDel));

    /* ---- 14b. 键盘入口：Tab 焦点 + 真按 Enter（这块新区域以前只有鼠标被证明过） ----
     * ▎为什么值得单独量：文件面板是全屏浮层，"鼠标能点到"与"键盘能用"是两件事——
     *   以前它只被**结构**断言证明过（role=button / tabindex=0 写在模板里），
     *   从未被一次真按键证明过。而这类"看起来是 a11y 装饰"的东西，坏掉的方式很安静：
     *   委托监听挂在列表上、行是重画的，某次改渲染把 tabindex 挪丢，没人会发现。
     * ▸ headless 窗口**没有系统焦点**是老坑（坑 80）：所以这里先断言"焦点真的落在这一行上"，
     *   前提不成立就明着红，而不是改用 dispatchEvent 冒充一次真按键（那是把考题擦了）。
     * ▸ ★ 操作区那一格的透明度**要轮询到停住**（坑 96/104 第六次应验，这次栽在 .14s 过渡上）：
     *   `.file-acts` 写了 `transition: opacity .14s`，而 focus() 之后**同一个 evaluate 里**读
     *   computed style，量到的必然是过渡起点 0 —— 第一版就是这样报"CSS 没生效"的假红。
     *   判据本身一个字没动（显形就是显形），改的只是"读的时刻"。 */
    const kbFocus = await ev(B, `(function(){
      const rows = Array.prototype.slice.call(document.querySelectorAll('.file-row'));
      if (!rows.length) return { focused: false, why: '清单里没有行' };
      const r = rows.filter(function (x) { return x.getAttribute('data-name') === '评审结论.md'; })[0] || rows[0];
      r.focus();
      return { focused: document.activeElement === r, name: r.getAttribute('data-name') };
    })()`);
    ok('K：Tab/焦点真的落到清单那一行上（tabindex=0 不是写在模板里的装饰）',
      kbFocus.focused === true, JSON.stringify(kbFocus));
    /* 读到 >0.9 就返回；到点还没显形则返回**最后一次实测值**（报错要说数字，不能说"没读到"）。 */
    const actsSettled = await (async () => {
      const t0 = Date.now(); let last = '';
      for (;;) {
        last = await ev(B, `(function(){
          const r = document.activeElement;
          if (!r || !r.classList || !r.classList.contains('file-row')) return '(焦点不在行上)';
          const a = r.querySelector('.file-acts');
          return a ? getComputedStyle(a).opacity : '(没有操作区)';
        })()`);
        if (Number(last) > 0.9) return { v: Number(last), ok: true };
        if (Date.now() - t0 > 2000) return { v: last, ok: false };
        await sleep(120);
      }
    })();
    ok('K：焦点落在行上时那一行的操作区会**显形**（:focus-within 那条 CSS 真的生效——键盘用户要知道「删除」在哪）',
      actsSettled.ok, `opacity=${actsSettled.v}`);
    await B.key('Enter', 'keyDown');
    await B.key('Enter', 'keyUp');
    const kbOpen = await until(B, `(function(){ return (filesOpen && filesOpen.name) ? filesOpen.name : ''; })()`, 8000);
    ok('K：真按一次 Enter 就打开了焦点那一行（键盘与鼠标走的是同一个入口，不是两条各写一遍的路）',
      kbOpen === kbFocus.name, `焦点行=${kbFocus.name}，实际打开=${kbOpen || '(没开)'}`);

    /* ---- 14c. ★ 跟随中，那份文件被删了：阅读器要关，而且要说明为什么关 ----
     * ▎服务器在删掉"正被大家看的那一份"时会顺手清空 fileView（协议里写着），
     *   但**另一端的表现**以前没人量过：如果只清 view 不关阅读器，用户会盯着一片
     *   "加载失败"以为是自己网断了（坑 82：界面在无声地撒谎）。
     * ▸ 这条用一份**专门上传来被删**的文件，不碰前面那六份 —— 后面的窄屏检查还要靠它们。 */
    await ev(A, b64Inject('临时要删的.md', Buffer.from('# 临时\n\n这一份存在的唯一理由就是被删掉，看看别人的屏幕怎么反应。\n', 'utf8'), 'text/markdown'));
    await sleep(1200);
    await ev(A, clickRowSrc('临时要删的.md'));
    const followedNew = await until(B, `(function(){ return (filesOpen && filesOpen.name === '临时要删的.md') ? 'yes' : ''; })()`, 9000);
    ok('C：先把前提验住 —— A 打开这份新文件，B 真的跟过来了（否则下面"没关"是"根本没开"）',
      followedNew === 'yes', String(followedNew));
    await ev(A, `(function(){ socket.emit('files-delete', { name: '临时要删的.md' }); return 1; })()`);
    const gone = await until(B, `(function(){
      const t = document.getElementById('toast') || {};
      const txt = String(t.textContent || '');
      return (!filesOpen && /已被删除|已经没有/.test(txt)) ? txt : '';
    })()`, 9000);
    ok('C：★★ B 正在跟随的那一份被 A 删掉 → B 的阅读器自己关掉了，并且**明说原因**（不是留一片"加载失败"）',
      !!gone, `toast="${gone}"`);
    const aGone = await until(A, `(function(){ return filesOpen ? '' : 'closed'; })()`, 6000);
    ok('C：上传者自己这一侧也收掉了阅读器（同一件事只有一个权威：清单里没有它了）',
      aGone === 'closed', String(aGone));
    const stillList = await until(B, `(function(){ return filesData.length === ${aBase - 1} ? ${aBase - 1} : ''; })()`, 8000);
    ok(`C：B 的清单回到 ${aBase - 1} 行（新加的那份来了又走，两端计数一致）`,
      stillList === aBase - 1, String(stillList));

    /* ---- 14d. ★「跟随」与「带动」是两件事：自由浏览不许把大家拽走 ----
     * ▎为什么专门量这一段：这颗按钮上写着「跟随主讲」，用户点它的理由只有一个——"我想自己翻一翻"。
     *   而原先的实现里，跟随**关着**的时候我每一次打开/翻页/滚动照样在往外广播
     *   （`emitFileView()` 没有跟随守卫），于是"我自己看看"变成"全房跟着我的屏幕走"；
     *   再点一下那颗按钮，代码写的又是 `emitFileView(true)`——第二下同样在**抢主讲**，
     *   而不是"我跳回主讲那一份"。两处都是**做错方向**（比少做更糟，与 10-06 那条否定守卫同族）。
     *   ▸ 判据（用户那句话的机器版）：他说"我只想看自己那份"时，**只能他这一边动**。
     *   ▸ 四条断言缺一不可：① 前提（B 真的跟到了 A 那份）② 自由浏览时 A 不许动
     *     ③ B 自己确实翻到了（不拽别人 ≠ 自己不能翻）④ 重新打开跟随 → B 跳回主讲，
     *     而 A 的画面与"谁在带"的徽标都没被这一次点击改写
     *     —— 少了 ④ 后半句，"跳回主讲"完全可以被"把大家拽过来"糊弄过去。 */
    await ev(A, clickRowSrc('会议材料.docx'));
    const dStart = await until(B, `(function(){ return (filesOpen && filesOpen.name === '会议材料.docx') ? 'yes' : ''; })()`, 9000);
    ok('S：前提——A 打开这一份，B（跟随中）跟过来了', dStart === 'yes', String(dStart));

    /* 真点那颗按钮（不是直接调 setFilesFollow）：语义坏在按钮上，就得从按钮量起。 */
    await ev(B, `(function(){ document.getElementById('filesFollowBtn').click(); return { follow: filesFollow }; })()`);
    await ev(B, clickRowSrc('评审结论.md'));
    await sleep(1500);   // 换文件的广播是即时的，1.5s 足够让"A 被拽走"这件事露出来
    const aAfterFree = await ev(A, `(function(){ return (filesOpen && filesOpen.name) || '(关了)'; })()`);
    ok('S：★ B 自由浏览点开另一份，**A 的画面没被拽走**（"我只想看自己那份"不该等于"我来带大家"）',
      aAfterFree === '会议材料.docx', `A 现在=${aAfterFree}`);
    const bFreeDoc = await ev(B, `(function(){ return (filesOpen && filesOpen.name) || '(关了)'; })()`);
    ok('S：B 自己确实翻到了那一份（不拽别人 ≠ 自己不能翻）',
      bFreeDoc === '评审结论.md', `B 现在=${bFreeDoc}`);

    await ev(B, `(function(){ document.getElementById('filesFollowBtn').click(); return 1; })()`);
    const bBack = await until(B, `(function(){ return (filesOpen && filesOpen.name === '会议材料.docx') ? 'yes' : ''; })()`, 9000);
    ok('S：★★ 重新打开跟随 → B 自己跳回主讲那一份（这颗按钮的意思是"我跟上去"，不是"你们跟我"）',
      bBack === 'yes', `B 现在=${bBack === 'yes' ? '会议材料.docx' : '(没跳回来)'}`);
    const aStill = await ev(A, `(function(){ return (filesOpen && filesOpen.name) || '(关了)'; })()`);
    const whoStill = await ev(A, `(function(){ return (document.getElementById('filesWho')||{}).textContent || ''; })()`);
    ok('S：★★ 反向对照：这一次点击没有把主讲换成 B —— A 仍停在原处',
      aStill === '会议材料.docx', `A 现在=${aStill}`);
    ok('S：A 侧"谁在带"的徽标也没被改写（同步这件事必须看得见，改错了人也要看得见）',
      /你在带着大家看/.test(whoStill), `A 的徽标="${whoStill}"`);

    /* ---- 15. Esc 关面板 + 控制台干净 ---- */
    await A.evaluate(`(function(){ closeTopLayer(); return 1; })()`);
    await sleep(400);
    const closed = await ev(A, `(function(){ return { on: filesOn, follow: filesFollow }; })()`);
    ok('A：Esc 关的是最上面这一层（共享文件面板），并顺手退出跟随',
      closed.on === false && closed.follow === false, JSON.stringify(closed));
    /* ---- 15b. 手机形态（390×844）：I2 —— 这块新区域以前从没在窄屏上量过 ----
     * ▎为什么值得单独量：≤760px 那一档响应式是**后来加的**，新写的文件面板没参与过它；
     *   而"窄屏溢出"这件事在桌面上一眼看不出来、在手机上却是"整排按钮点不到"。
     *   本项目为控制坞量过 11 档视口（check:dock），这一档把同样的纪律带到文件面板上。 */
    await A._send(A.pageWs, 'Emulation.setDeviceMetricsOverride',
      { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(800);
    await ev(A, `(function(){ if (!filesOn) document.getElementById('filesBtn').click(); return 1; })()`);
    await sleep(700);
    await ev(A, clickRowSrc('评审结论.md'));
    await sleep(1200);
    const mob1 = await ev(A, `(function(){
      const ov = document.getElementById('filesOverlay');
      const stack = document.querySelector('.bottom-stack');
      const rows = Array.prototype.slice.call(document.querySelectorAll('.file-row'));
      const overflowRow = rows.filter(function (r) { return r.scrollWidth > r.clientWidth + 1; }).length;
      const hitc = (id) => {
        const e = document.getElementById(id);
        if (!e) return '(没有)';
        const r = e.getBoundingClientRect();
        if (!r.width || !r.height) return '(零尺寸)';
        const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
        if (cx < 0 || cy < 0 || cx >= innerWidth || cy >= innerHeight) return '(中心出界 ' + cx + ',' + cy + ')';
        const t = document.elementFromPoint(cx, cy);
        return t ? String(t.closest('#' + id) ? id : (t.id || t.tagName)) : '(点不到)';
      };
      return {
        vw: innerWidth, vh: innerHeight,
        pageOverflow: document.documentElement.scrollWidth - innerWidth,
        ovRight: Math.round(ov.getBoundingClientRect().right),
        ovBottom: Math.round(ov.getBoundingClientRect().bottom),
        ovShown: !ov.classList.contains('hidden'),
        stackTop: Math.round(stack.getBoundingClientRect().top),
        rows: rows.length, overflowRow,
        uploadHit: hitc('filesUploadBtn'), followHit: hitc('filesFollowBtn'), closeHit: hitc('filesCloseBtn'),
        docShown: ((document.getElementById('filesDocName') || {}).textContent || '').trim(),
      };
    })()`);
    ok('M：手机 390 宽下面板是开着的、且**整页没有横向溢出**（溢出像素 ' + mob1.pageOverflow + '）',
      mob1.ovShown === true && mob1.vw <= 400 && mob1.pageOverflow <= 1, JSON.stringify(mob1));
    ok('M：面板底边仍然停在底部那一列之上（窄屏换行了也不能压住按钮）',
      mob1.ovBottom <= mob1.stackTop + 2, `面板底 ${mob1.ovBottom} · 底部列顶 ${mob1.stackTop}`);
    ok('M：清单里没有任何一行横向溢出（文件名长也只能省略号，不能撑破面板）',
      mob1.rows >= 6 && mob1.overflowRow === 0, JSON.stringify({ rows: mob1.rows, overflowRow: mob1.overflowRow }));
    ok('M：★ 窄屏上「上传 / 跟随 / 关闭」三颗都**点得到**（命中测试，不是"看起来在"）',
      mob1.uploadHit === 'filesUploadBtn' && mob1.followHit === 'filesFollowBtn' && mob1.closeHit === 'filesCloseBtn',
      JSON.stringify({ up: mob1.uploadHit, follow: mob1.followHit, close: mob1.closeHit }));
    ok('M：窄屏下文档照样打得开（手机上也能跟大家看同一份）', /评审结论/.test(mob1.docShown), mob1.docShown);
    await A._send(A.pageWs, 'Emulation.clearDeviceMetricsOverride').catch(() => {});
    await A._send(A.pageWs, 'Emulation.setTouchEmulationEnabled', { enabled: false }).catch(() => {});
    await sleep(500);

    for (const [label, cdp] of [['A', A], ['B', B]]) {
      const errs = await ev(cdp, `(function(){ return (window.__cfErrs || []).slice(0, 5); })()`) || [];
      ok(`${label}：全程没有页面异常（把 error/unhandledrejection 记进 __cfErrs）`, errs.length === 0, JSON.stringify(errs));
    }
    await A.screenshot({ format: 'jpeg', quality: 55 }).catch(() => null);
  } catch (e) {
    ok(`检查自身抛错：${(e && e.message) || e}`, false);
  } finally {
    try { A.kill(); } catch (e) { /* ignore */ }
    try { B.kill(); } catch (e) { /* ignore */ }
  }

  const bad = results.filter((x) => !x.pass).length;
  console.log(`\n${results.length - bad}/${results.length} 项通过`);
  console.log(bad ? '❌ 有未通过项' : '🎉 共享文件在真浏览器里成立：第二个人的屏幕真的出现了同一页');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(`\n❌ 检查失败：${e && e.message}`); process.exit(1); });
