#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 *  check-login-screen.js —— 第一屏（登录卡）的真浏览器验收
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎为什么单独一条：这一屏是**别人打开你链接时看到的第一个画面**，
 *   而它改的全是"看得见的东西"——品牌头、图标前缀、焦点环、次要入口分层。
 *   冒烟桩没有 CSS 引擎，它只能证明源码里写了这些规则（第 34/37 节那些），
 *   证不了浏览器真的算出了这些值；而本项目吃过的大亏恰恰是"代码全对、界面塌了"（坑 26）。
 * ▎还钉一件更要紧的事：**id 契约没破**。登录/注册/游客/设备码四条路径全靠 id 找元素，
 *   结构重排最容易弄丢一个 id —— 那不会报错，只会让按钮静默失灵（坑 69 同族）。
 * ▎跑法：npm run check:login（先起服务器，或用 CHECK_URL 指到专用端口） */
const fs = require('fs');
const path = require('path');
const { Cdp } = require(path.join(__dirname, '..', 'agent', 'cdp.js'));

const URL_ = (process.env.CHECK_URL || 'http://localhost:3001/') + '?nosw=1';
const OUT = process.env.CHECK_OUT || path.join(__dirname, '..', 'wb-rd-shots');
const results = [];
const ok = (name, pass, extra) => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const cdp = new Cdp({ headless: true, startUrl: URL_, windowSize: { width: 1280, height: 900 } });
  await cdp.launch();
  await cdp.waitForLoad(15000);
  await sleep(1200);

  const fp = await cdp.evaluate(`(async () => {
    const css = await (await fetch('style.css', { cache: 'no-store' })).text();
    return css.includes('.auth-field') && css.includes('.auth-seal');
  })()`);
  ok('样式是本轮的（第 37 节的登录卡规则在位）', fp === true);

  /* ① id 契约：结构重排最容易弄丢一个，而丢了不会报错、只会按钮静默失灵 */
  const ids = await cdp.evaluate(`(function(){
    const want = ['authOverlay','authUser','authPass','authName','authAvatars','authLoginBtn',
      'authRegisterBtn','authGuestBtn','authDeskBtn','authMsg','authPassEye'];
    return want.filter((i) => !document.getElementById(i));
  })()`);
  ok('★ 登录卡的 11 个 id 一个没丢（重排结构的安全网）', ids.length === 0, ids.join(','));

  /* ② 品牌头 */
  const brand = await cdp.evaluate(`(function(){
    const seal = document.querySelector('.auth-seal');
    const title = document.querySelector('.auth-title');
    const r = seal && seal.getBoundingClientRect();
    const cs = seal && getComputedStyle(seal);
    return { seal: !!seal, w: r && Math.round(r.width), radius: cs && cs.borderTopLeftRadius,
             color: cs && cs.backgroundColor, title: title && title.textContent.trim(),
             sameRow: !!(seal && title) && Math.abs(seal.getBoundingClientRect().top - title.getBoundingClientRect().top) < 40 };
  })()`);
  ok('品牌头：朱砂印章 + 标题并排（第一眼先回答"这是什么产品"）',
    brand.seal === true && brand.w >= 36 && brand.sameRow === true && /云会议/.test(brand.title || ''),
    `印章 ${brand.w}px 标题「${brand.title}」`);

  /* ③ 图标前缀输入框：三行都要有，且图标真的按 15px 渲染（没写尺寸规则会撑成 300×150） */
  const fields = await cdp.evaluate(`(function(){
    const fs2 = Array.from(document.querySelectorAll('.auth-field'));
    return {
      n: fs2.length,
      withIcon: fs2.filter(f => !!f.querySelector(':scope > svg.i')).length,
      withInput: fs2.filter(f => !!f.querySelector('input')).length,
      maxW: Math.max(...fs2.map(f => { const s = f.querySelector('svg.i'); return s ? Math.round(s.getBoundingClientRect().width) : 0; })),
    };
  })()`);
  ok('三行输入各带一个线性图标前缀', fields.n === 3 && fields.withIcon === 3 && fields.withInput === 3,
    `字段=${fields.n} 带图标=${fields.withIcon}`);
  ok('图标尺寸在规矩内（不是"加了图标忘写尺寸"的 300×150）', fields.maxW > 10 && fields.maxW <= 18,
    `最宽 ${fields.maxW}px`);

  /* ④ 焦点环：真用鼠标点一次输入框，再量 box-shadow 变没变。
   *    ▸ 为什么不用 element.focus()：无头浏览器的窗口本身没有系统焦点，
   *      focus() 常常不产生 :focus-within —— 于是"没变化"会被误读成"CSS 没生效"。
   *      （第一版就是这么假红的；换成真实鼠标事件后才量到真的焦点环。）
   *    ▸ :focus-within 这类规则"写了"与"生效"是两件事，只能靠算出来的值分辨。 */
  const ringBefore = await cdp.evaluate(`(function(){
    const f = document.querySelector('.auth-field');
    const r = f.getBoundingClientRect();
    return { shadow: getComputedStyle(f).boxShadow, border: getComputedStyle(f).borderColor,
             nx: (r.left + r.width / 2) / innerWidth, ny: (r.top + r.height / 2) / innerHeight };
  })()`);
  await cdp.mouse('mouseMoved', ringBefore.nx, ringBefore.ny);
  await cdp.mouse('mousePressed', ringBefore.nx, ringBefore.ny);
  await cdp.mouse('mouseReleased', ringBefore.nx, ringBefore.ny);
  await sleep(250);
  const ring = await cdp.evaluate(`(function(){
    const f = document.querySelector('.auth-field');
    const cs = getComputedStyle(f);
    return { shadow: cs.boxShadow, border: cs.borderColor, changed: cs.boxShadow !== '${ringBefore.shadow}',
             focused: document.activeElement && document.activeElement.id };
  })()`);
  ok('聚焦输入框时整框出现鎏金焦点环（:focus-within 真的算出来了）',
    ring.changed === true && ring.shadow !== 'none' && ring.focused === 'authUser',
    `焦点元素=${ring.focused} border=${ring.border}`);

  /* ⑤ 密码可见切换：type 与图标二选一都要跟着翻 */
  const eye = await cdp.evaluate(`(function(){
    const inp = document.getElementById('authPass');
    const btn = document.getElementById('authPassEye');
    const shown0 = getComputedStyle(btn.querySelectorAll('svg.i')[0]).display;
    const hidden0 = getComputedStyle(btn.querySelectorAll('svg.i')[1]).display;
    btn.click();
    const t1 = inp.type;
    const shown1 = getComputedStyle(btn.querySelectorAll('svg.i')[0]).display;
    const hidden1 = getComputedStyle(btn.querySelectorAll('svg.i')[1]).display;
    btn.click();
    return { t0: 'password', t1, back: inp.type, shown0, hidden0, shown1, hidden1 };
  })()`);
  ok('密码眼睛按钮切换 type（password ⇄ text）并换回原状',
    eye.t1 === 'text' && eye.back === 'password', `点一次=${eye.t1} 再点=${eye.back}`);
  ok('两颗图标靠状态属性互换（不是 JS 换 innerHTML 重建按钮）',
    eye.shown0 !== 'none' && eye.hidden0 === 'none' && eye.shown1 === 'none' && eye.hidden1 !== 'none',
    `初始 ${eye.shown0}/${eye.hidden0} → 点后 ${eye.shown1}/${eye.hidden1}`);

  /* ⑥ 主次分层：三个次要出口应在同一行、且在主按钮之下
   *   （★ 2026-10-09 加了第三颗「忘记密码？」——它是纯页内提示、不改变任何状态，
   *     分量与"游客进入""设备码直连"同级，所以收进同一行而不是做成第四个主按钮。） */
  const links = await cdp.evaluate(`(function(){
    const g = document.getElementById('authGuestBtn').getBoundingClientRect();
    const d = document.getElementById('authDeskBtn').getBoundingClientRect();
    const f = document.getElementById('authForgotBtn').getBoundingClientRect();
    const lb = document.getElementById('authLoginBtn').getBoundingClientRect();
    const row = Math.abs(g.top - d.top) < 8 && Math.abs(g.top - f.top) < 8;
    return { row, belowPrimary: g.top > lb.bottom, or: !!document.querySelector('.auth-or'),
             n: document.querySelectorAll('.auth-guest').length,
             guestText: document.getElementById('authGuestBtn').textContent.trim() };
  })()`);
  ok('三个次要出口收进一行、在主按钮之下（第一屏只有一个主操作）',
    links.row === true && links.belowPrimary === true && links.or === true && links.n === 3,
    `同行=${links.row} 在主按钮下方=${links.belowPrimary} 次要出口数=${links.n}`);

  /* ⑥b ★ 2026-10-09 忘记密码：这句话必须是"能照着做"的，不许是假动作。
   *   量的是点击后的真实文本（不是 grep 源码）——源码里写着正确文案，
   *   接错元素/接不上监听时界面照样是空的（坑 41/56 那条老账）。 */
  await cdp.evaluate(`document.getElementById('authForgotBtn').click()`);
  await sleep(120);
  const forgot = await cdp.evaluate(`(function(){
    const m = document.getElementById('authMsg');
    return { txt: String(m.textContent || ''), shown: m.offsetParent !== null || String(m.textContent).length > 0 };
  })()`);
  ok('点「忘记密码？」当场给出两条真路（含可复制的 npm run admin:passwd）',
    /npm run admin:passwd/.test(forgot.txt) && /管理员/.test(forgot.txt), forgot.txt.slice(0, 70));
  ok('★ 这句提示里不许出现"已发送 / 请查收"这类假动作（本项目没有邮件通道）',
    !/已发送|请查收|链接已发|发送到您/.test(forgot.txt), forgot.txt.slice(0, 70));

  /* ⑦ 这一屏不该再有彩色 emoji（表情回应条不在这屏，无需排除） */
  const emo = await cdp.evaluate(`(function(){
    const t = (document.querySelector('.auth-card') || document.body).textContent.replace(/[★▸▎→✕或]/g, '');
    const hits = [...new Set(t.match(/[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]/gu) || [])];
    return hits.slice(0, 6).join(' ');
  })()`);
  ok('登录卡可见文字里没有彩色 emoji', emo === '', emo);

  /* ⑧ 手机形态：第一屏在手机上也不能横向溢出 */
  const mob = await cdp.evaluate(`(function(){ return { vw: innerWidth, over: document.documentElement.scrollWidth - innerWidth }; })()`);
  ok('当前视口下没有横向溢出', mob.over <= 1, `视口 ${mob.vw} 溢出 ${mob.over}px`);

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'login-screen.png'), await cdp.screenshot({ format: 'png' }));
  await cdp.evaluate(`(function(){ const b=document.getElementById('authRegisterBtn'); if(b) b.click(); return 'ok'; })()`);
  await sleep(400);
  fs.writeFileSync(path.join(OUT, 'login-screen-msg.png'), await cdp.screenshot({ format: 'png' }));
  console.log('  截图落盘：wb-rd-shots/login-screen.png（+ 点注册后的提示行）');

  cdp.kill();
  const bad = results.filter((x) => !x.pass).length;
  console.log(bad ? `\n❌ ${bad} 项未过` : '\n🎉 第一屏在真浏览器里全部成立');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(`\n❌ 检查失败：${e && e.message}`); process.exit(1); });
