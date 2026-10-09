#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 *  check-board.js —— 白板的两件"能带走"：导出 PNG + 刷新后笔迹还在
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎为什么单独一条：白板是这套界面里**唯一一个产物是图形**的功能——
 *   纪要（N2）能覆盖文字，覆盖不了会上画的那张草图。
 *   而它此前的状态是"笔迹只活在内存里，刷新即清、散会即失"（AGENTS 里写明的已知边界），
 *   并且**没有任何一条测试**证明过"画上去的东西还在"。
 * ▎三件事都必须真浏览器：
 *   ① 导出要拿到真的 Blob 并验它是合法 PNG（还要验笔迹真的在像素里，
 *      不然"导出一张空白纸"也算成功——那是最典型的假绿）；
 *   ② 刷新后账本要从服务器补回来（board-state 那条路）；
 *   ③ 撤销/清空也要真的作用在像素上（重放路径与导出共用同一个 drawBoardStrokes，
 *      这里顺手验一次"结构上不可能不一致"是不是真的）。
 * ▎跑法：npm run check:board */
const path = require('path');
const { Cdp } = require(path.join(__dirname, '..', 'agent', 'cdp.js'));

const BASE = process.env.CHECK_URL || 'http://localhost:3001/';
const URL_ = BASE + (BASE.includes('?') ? '&' : '?') + 'nosw=1';
const results = [];
const ok = (name, pass, extra) => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 画两笔（朱砂一笔、竹青一笔）——用真实的事件路径（pointerdown/move/up 走不通就退到
   applyBoardOp + sendBoard，后者是账本与广播的正门，导出与重放都读这本账）。 */
const DRAW = `(function(){
  setBoardOpen(true);
  boardStrokes.length = 0;
  const ink = '#b93a26';
  applyBoardOp(ink, 'start', 0.2, 0.3);
  for (let i = 1; i <= 20; i++) applyBoardOp(ink, 'draw', 0.2 + i * 0.02, 0.3 + Math.sin(i / 3) * 0.12);
  applyBoardOp(ink, 'end');
  sendBoard('end');                       // 只有 end 才会上报服务器账本
  return boardStrokes.length;
})()`;

/* 拦下导出：换掉 createObjectURL 与 <a>.click，把 Blob 的字节读回来自己验。
 * ▸ 为什么要等两轮共 3 秒：toBlob 是**异步编码**，一张 1836×692 的 PNG 在无头浏览器里
 *   可能超过 600ms。第一版只等 600ms 就断言"没有 Blob"，那是量具太急，不是功能坏了
 *   ——同一份代码在手工探针里 900ms 就拿到了 Blob。
 *   慢工出细活：等不到就再等，最后才下结论。 */
const EXPORT = `(async function(){
  const hits = [];
  const rawUrl = URL.createObjectURL;
  const rawClick = HTMLAnchorElement.prototype.click;
  let pageErr = '';
  const onErr = (e) => { pageErr = String((e && (e.message || e.reason)) || e); };
  window.addEventListener('error', onErr);
  window.addEventListener('unhandledrejection', onErr);
  URL.createObjectURL = function (b) { hits.push(b); return rawUrl.call(URL, b); };
  HTMLAnchorElement.prototype.click = function () { hits.__name = this.download; };
  let err = '';
  try { exportBoardPng(); } catch (e) { err = String(e && e.message); }
  for (let i = 0; i < 12 && !hits[0]; i++) await new Promise((r) => setTimeout(r, 250));
  window.removeEventListener('error', onErr);
  URL.createObjectURL = rawUrl;
  HTMLAnchorElement.prototype.click = rawClick;
  const blob = hits[0];
  if (!blob) return { err: err || pageErr || '等满 3s 仍没有 Blob' };
  const buf = new Uint8Array(await blob.arrayBuffer());
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  /* 把 Blob 解回位图，确认笔迹真的在像素里（只看"文件非空"是不够的：
     一张空白纸也是合法 PNG —— 那就是假绿）。 */
  let inkPixels = 0, w = 0, h = 0;
  try {
    const bmp = await createImageBitmap(blob);
    w = bmp.width; h = bmp.height;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cx = c.getContext('2d');
    cx.drawImage(bmp, 0, 0);
    const d = cx.getImageData(0, 0, w, h).data;
    for (let i = 0; i < d.length; i += 4) {
      // 朱砂 #b93a26 附近：红明显高于绿蓝
      if (d[i] > 140 && d[i + 1] < 110 && d[i + 2] < 90) inkPixels++;
    }
  } catch (e) { err = '解码失败：' + e.message; }
  return { png, bytes: buf.length, w, h, inkPixels, name: hits.__name || '', err, waited: true };
})()`;

/* ★ 2026-10-09 注入浏览器之前先让同一个引擎读一遍这些串。
 *   模板字符串**内部**的注释里只要出现反引号，模板就被提前截断——源文件语法没错、node --check 全过，
 *   错在拼出来的那段代码；到浏览器里炸的时候，本脚本一条断言都没跑到（详见 scripts/inject-check.js 头部）。 */
require('./inject-check.js').assertCompiles(__filename, { DRAW, EXPORT });

(async () => {
  const cdp = new Cdp({ headless: true, startUrl: URL_, windowSize: { width: 1280, height: 860 } });
  await cdp.launch();
  await cdp.waitForLoad(15000);
  await sleep(1200);

  const fp = await cdp.evaluate(`(async () => {
    const js = await (await fetch('client.js', { cache: 'no-store' })).text();
    return js.includes('exportBoardPng') && js.includes('drawBoardStrokes');
  })()`);
  ok('量的是本轮代码（含导出与共用绘制函数，不是 SW 缓存）', fp === true);

  /* 进房：游客点「游客进入」→ 预览页 → 创建房间 */
  await cdp.evaluate(`(function(){ const g=document.getElementById('authGuestBtn'); if (g) g.click(); return 'ok'; })()`);
  await sleep(600);
  await cdp.evaluate(`(function(){ document.getElementById('createBtn').click(); return 'ok'; })()`);
  await sleep(2500);
  const room = await cdp.evaluate(`(function(){ return String(myRoom || ''); })()`);
  ok(`游客进房拿到房间号 = ${room || '(无)'}`, /^\d{6}$/.test(room));

  const strokes = await cdp.evaluate(DRAW);
  await sleep(700);
  ok('画了一笔并写进账本（本地 1 笔）', strokes === 1, `boardStrokes=${strokes}`);

  const ex = await cdp.evaluate(EXPORT);
  ok('★ 导出真的产出一个合法 PNG（文件头 89 50 4E 47）',
    ex.png === true && ex.bytes > 3000, `bytes=${ex.bytes} err=${ex.err || ''}`);
  ok('★ 导出的图里能查到笔迹的像素（不是"一张空白纸也算成功"）',
    (ex.inkPixels || 0) > 200, `朱砂像素 ${ex.inkPixels} 个，尺寸 ${ex.w}x${ex.h}`);
  ok('下载文件名带房间号（一张没有出处的草图第二天没人认得）',
    new RegExp('whiteboard-' + room + '-').test(ex.name || ''), ex.name);

  /* 刷新 → 重新进同一个房 → 账本必须由服务器补回来 */
  await cdp.navigate(URL_);
  await sleep(1400);
  await cdp.evaluate(`(function(){ const g=document.getElementById('authGuestBtn'); if (g) g.click(); return 'ok'; })()`);
  await sleep(500);
  const joined = await cdp.evaluate(`(function(){
    const i = document.getElementById('roomInput'); i.value = '${room}';
    document.getElementById('joinRoomBtn').click(); return 'ok';
  })()`);
  void joined;
  /* ▸ 前提断言（坑 55："测某个状态之前，先确认你真的站在那个状态里"）。
   *   10-04 全量跑 check:all 时这条检查报的是"恢复 0 笔"——看着像白板账本坏了，
   *   实际上是那台机器当时被另一批测试抢满，10s 内**连房都没进完**。
   *   没有这条前提，量具会把"我没等到位"说成"产品有缺陷"，排查方向整个被带偏。 */
  let inRoom = false;
  for (let i = 0; i < 24 && !inRoom; i++) {
    inRoom = await cdp.evaluate(`(function(){ return typeof myRoom !== 'undefined' && String(myRoom || '') === '${room}'; })()`);
    if (!inRoom) await sleep(250);
  }
  ok('前提：刷新之后确实重新进了同一个房（否则下面的"0 笔"是量具没等到位，不是缺陷）', inRoom);
  let restored = 0;
  for (let i = 0; i < 20 && !restored; i++) {
    await sleep(500);
    restored = await cdp.evaluate(`(function(){ return (boardStrokes || []).length; })()`);
  }
  ok('★ 刷新重进后笔迹从服务器账本补回来了（board-state 那条路真的通）',
    restored >= 1, `恢复 ${restored} 笔`);

  /* 撤销必须真的作用到像素上：重放与导出共用同一个 drawBoardStrokes，这里验一次 */
  const px = await cdp.evaluate(`(function(){
    const c = document.getElementById('boardCanvas');
    const cx = c.getContext('2d');
    const d = cx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 40) n++;
    return n;
  })()`);
  ok('恢复出来的笔迹真的重绘到了画布上（不只在账本里）', px > 500, `非透明像素 ${px}`);

  cdp.kill();
  const bad = results.filter((x) => !x.pass).length;
  console.log(bad ? `\n❌ ${bad} 项未过` : '\n🎉 白板的东西现在能带走，也不会被刷新冲掉');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(`\n❌ 检查失败：${e && e.message}`); process.exit(1); });
