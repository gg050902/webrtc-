#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 *  check-keyboard.js —— 键盘操作的真浏览器验收（第 47 步）
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎为什么必须真浏览器：冒烟桩的 document.addEventListener 是**空函数**
 *   （scripts/test-sfu-client-smoke.js 里那一行 `addEventListener() {}`），
 *   所以"按一个键会发生什么"这类事实在桩里根本没有对应物——
 *   在桩里写键盘断言，得到的只会是"我断言了我自己写的桩"。
 * ▎四件事，每件都用真按键（Input.dispatchKeyEvent），不是 element.focus()：
 *   ① Tab 走焦点时要有看得见的焦点环（:focus-visible 是"写了"与"生效"两回事）；
 *   ② Esc 一次只关最上面那一层（全部一起关 = 一次误触把用户没打算关的东西带走）；
 *   ③ 授权卡上的 Esc = **拒绝**，而且走的是按钮自己那个处理函数
 *      （判据不是"面板不见了"，而是"服务器真的收到了一条 ok:false 的答复"——
 *       面板不见也可能是被 hideAuth 之类的旁路关掉的，那不算拒绝）；
 *   ④ 登录卡在用户名框按回车会真的提交（此前只有密码框认回车）。
 * ▎跑法：npm run check:keyboard（先起服务器，或用 CHECK_URL 指到专用端口） */
const path = require('path');
const { Cdp } = require(path.join(__dirname, '..', 'agent', 'cdp.js'));

const URL_ = (process.env.CHECK_URL || 'http://localhost:3001/') + '?nosw=1';
const results = [];
const ok = (name, pass, extra) => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 在页面里架一个 emit 窃听器：判断"按钮/Esc 到底做了什么"，
   看它有没有真的往服务器发那条信令——比看界面更硬。 */
const SPY = `(function(){
  window.__EMITS__ = [];
  if (!window.__SPY_ON && typeof socket !== 'undefined' && socket && socket.emit) {
    const raw = socket.emit.bind(socket);
    socket.emit = function (ev, ...rest) { window.__EMITS__.push(String(ev)); return raw(ev, ...rest); };
    window.__SPY_ON = true;
  }
  return window.__SPY_ON === true;
})()`;
const takeEmits = `(function(){ const a = window.__EMITS__ || []; window.__EMITS__ = []; return a.join(','); })()`;

/* ★ 2026-10-09 注入浏览器之前先让同一个引擎读一遍这些串。
 *   模板字符串**内部**的注释里只要出现反引号，模板就被提前截断——源文件语法没错、node --check 全过，
 *   错在拼出来的那段代码；到浏览器里炸的时候，本脚本一条断言都没跑到（详见 scripts/inject-check.js 头部）。 */
require('./inject-check.js').assertCompiles(__filename, { SPY });

(async () => {
  const cdp = new Cdp({ headless: true, startUrl: URL_, windowSize: { width: 1280, height: 900 } });
  await cdp.launch();
  await cdp.waitForLoad(15000);
  await sleep(1200);

  const fp = await cdp.evaluate(`(async () => {
    const js = await (await fetch('client.js', { cache: 'no-store' })).text();
    return js.includes('ESC_LAYERS') && js.includes('closeSideDrawer');
  })()`);
  ok('量的是本轮代码（第 47 步的 Esc 分发器在位，不是 SW 缓存）', fp === true);
  if (!fp) { cdp.kill(); process.exit(1); }
  ok('emit 窃听器架起来了', await cdp.evaluate(SPY) === true);

  /* ① 登录卡：用户名框按回车应当提交 */
  await cdp.evaluate(`(function(){ document.getElementById('authUser').value = '键盘测试'; return 'ok'; })()`);
  await cdp.evaluate(`(function(){ document.getElementById('authUser').focus(); return 'ok'; })()`);
  await cdp.evaluate(takeEmits.replace('return a.join', 'void 0; return a.join'));  // 清空基线
  await cdp.tap('Enter');
  await sleep(500);
  const e1 = await cdp.evaluate(takeEmits);
  ok('★ 在用户名框按回车会真的提交（此前只有密码框认回车）',
    /auth-login/.test(e1), `发出的信令：${e1 || '（无）'}`);

  /* 昵称框回车 = 注册（两个框各有各的语义，别都指向登录） */
  await cdp.evaluate(`(function(){ document.getElementById('authName').focus(); return 'ok'; })()`);
  await cdp.evaluate(takeEmits);
  await cdp.tap('Enter');
  await sleep(500);
  const e2 = await cdp.evaluate(takeEmits);
  ok('昵称框回车走注册（两个框各有语义，不是都提交登录）',
    /auth-register/.test(e2), `发出的信令：${e2 || '（无）'}`);

  await cdp.evaluate(`(function(){
    for (const id of ['authOverlay','prejoin','roomPanel']) { const e=document.getElementById(id); if (e) e.classList.add('hidden'); }
    return 'ok';
  })()`);
  await sleep(250);

  /* ② Tab 走焦点要有焦点环。
     ▸ 一定要用真 Tab 键：`:focus-visible` 只在"键盘造成的焦点"下成立，
       手工 element.focus() 在脚本触发时浏览器可能不算键盘 —— 那样量到 0 会误判成"没写样式"。 */
  await cdp.evaluate(`(function(){ document.body.focus(); return 'ok'; })()`);
  let ring = null;
  for (let i = 0; i < 14 && !ring; i++) {
    await cdp.tap('Tab');
    await sleep(70);
    const r = await cdp.evaluate(`(function(){
      const a = document.activeElement;
      if (!a || a === document.body) return null;
      const cs = getComputedStyle(a);
      const w = parseFloat(cs.outlineWidth || '0');
      if (!(w > 0 && cs.outlineStyle !== 'none')) return null;
      return { id: a.id || a.className.split(' ')[0], w, style: cs.outlineStyle, color: cs.outlineColor };
    })()`);
    if (r) ring = r;
  }
  ok('★ Tab 键走焦点时有看得见的焦点环（:focus-visible 真的算出来了）',
    !!ring, ring ? `${ring.id} outline=${ring.w}px ${ring.style} ${ring.color}` : '连按 14 次 Tab 都没量到');

  /* ③ Esc 一次只关最上面那一层：同时开滤镜面板与白板 */
  await cdp.evaluate(`(function(){ toggleFxPanel(true); setBoardOpen(true); return 'ok'; })()`);
  await sleep(300);
  await cdp.tap('Escape');
  await sleep(250);
  const after1 = await cdp.evaluate(`(function(){
    return { fx: !document.getElementById('fxPanel').classList.contains('hidden'),
             board: !document.getElementById('boardOverlay').classList.contains('hidden') };
  })()`);
  ok('第一次 Esc 只关掉最上面那层（滤镜面板），白板留着',
    after1.fx === false && after1.board === true, JSON.stringify(after1));
  await cdp.tap('Escape');
  await sleep(250);
  const after2 = await cdp.evaluate(`(function(){
    return { fx: !document.getElementById('fxPanel').classList.contains('hidden'),
             board: !document.getElementById('boardOverlay').classList.contains('hidden') };
  })()`);
  ok('再按一次 Esc 才关白板（一层一层退，不是一键全清）',
    after2.board === false, JSON.stringify(after2));

  /* ④ 授权卡上的 Esc = 拒绝：判据是"真的往服务器发了 ok:false 的答复"，
   *    不是"面板不见了"（面板可能被任何一条旁路 hide 掉，那不算拒绝）。
   *    ▸ 要连 pendingFrom 一起造：拒绝按钮自己的第一件事就是 `if (!pendingFrom) return;`
   *      ——只把卡片显出来而不给"要拒绝谁"，Esc 本来就该什么都不做（那是正确行为，
   *      不是测试想验的那件事）。 */
  const setup = await cdp.evaluate(`(function(){
    try { if (typeof pendingFrom !== 'undefined') pendingFrom = 'peer-keyboard-demo'; } catch (e) { return 'no-pendingFrom'; }
    document.getElementById('remoteAskBox').classList.remove('hidden');
    return 'ok';
  })()`);
  await cdp.evaluate(takeEmits);
  await cdp.tap('Escape');
  await sleep(300);
  const e3 = await cdp.evaluate(`(function(){
    const a = window.__EMITS__ || []; window.__EMITS__ = [];
    const hidden = document.getElementById('remoteAskBox').classList.contains('hidden');
    return a.join(',') + '|' + (hidden ? 'closed' : 'open');
  })()`);
  ok('★ 授权卡上按 Esc 会发出拒绝（走按钮自己那个处理函数，不是复制一份逻辑）',
    setup === 'ok' && /remote-answer/.test(e3) && /closed/.test(e3),
    `前置=${setup} 信令与状态：${e3}`);

  cdp.kill();
  const bad = results.filter((x) => !x.pass).length;
  console.log(bad ? `\n❌ ${bad} 项未过` : '\n🎉 键盘这条路是通的：能 Tab 到、能 Esc 退、回车真提交');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(`\n❌ 检查失败：${e && e.message}`); process.exit(1); });
