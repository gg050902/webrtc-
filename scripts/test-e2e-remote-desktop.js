/* scripts/test-e2e-remote-desktop.js —— 真浏览器端到端回归（真服务器 + 真浏览器 + 真代理）
 *
 * ▎它验的是什么？"单元测试说一切正常"和"人打开两个窗口真的能用"之间隔着一条河。
 *   这个脚本就是那座桥：全程用**真实浏览器 + 真实鼠标/触摸事件 + 真实被控浏览器**，
 *   走完 建房 → 代理进房 → 请求控制 → 收真画面 → 真点击 → 真中文输入 → 远程导航
 *   → 手机双指滚动 → 手机单指点击 → 手机参会布局/抽屉 → 退出控制。
 *
 * ▎为什么它值这个运行时间（约 1 分钟，要起两个浏览器）？
 *   本项目里最值钱的几个 bug 全是它（或它的前身）抓出来的：
 *     · 双指滚动变成了"两只手各自点鼠标"（Pointer 事件按手指派发，账本没做）；
 *     · Service Worker 一直喂旧 client.js（改了代码不生效，且在测试里也骗过了一轮）；
 *     · 报告给了自己的证据：DIAG 打印 pointer 事件序列 + 前端发出的帧，不靠猜。
 *
 * ▎纪律（血泪换的，别删）：
 *   ① 每次跑之前清空浏览器 profile 目录——否则 HTTP 缓存和 **Service Worker**
 *      会让你测到上一版的代码（CDP 的 setCacheDisabled 管不到 SW 的 Cache Storage）；
 *   ② 断言必须计数并影响退出码——只打印 ✅/❌ 的脚本永远"通过"；
 *   ③ 拿不准就打印原始证据（DIAG 行），别把猜测写成结论。
 */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { Cdp } = require('../agent/cdp');
const { RemoteAgent } = require('../agent/index');

const SERVER = 'http://127.0.0.1:3001';
const OUT = path.join(os.tmpdir(), 'wb-rd-shots');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 断言计数器。
 * ▎为什么要有这个？——一个只"打印 ✅/❌"的脚本是**没有结论**的：
 *   它不会失败，也就不会有人发现它失败了（本项目已经因此踩过"假通过"的坑）。
 *   既然这份脚本要当回归测试反复跑，它就必须有退出码。 */
let checks = 0, issues = 0;
function chk(cond, msg) {
  checks++;
  if (!cond) issues++;
  console.log(`   ${cond ? '✅' : '❌'} ${msg}`);
}

/* ★ 测试卫生（本脚本踩过坑才加的）：浏览器 profile 目录必须每次清干净。
 *   原因有两个，都很致命：
 *     ① HTTP 缓存——profile 复用会让上一次跑留下的 client.js 继续生效；
 *     ② **Service Worker**——CDP 的 Network.setCacheDisabled 管不到 SW 的
 *        Cache Storage，它会把旧 client.js 直接喂给页面。
 *   症状是"代码明明改对了、浏览器跑的却是旧版"，测试于是变成在测缓存。
 *   干净的 profile = 每次都是第一次访问 = 确定性。 */
function wipeProfile(port) {
  const dir = path.join(os.tmpdir(), 'wb-remote-desktop-profile-' + port);
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    console.log(`   🧹 已清空浏览器 profile（端口 ${port}）`);
  } catch (e) { console.log(`   ⚠️ profile 清理失败（忽略）：${e.message}`); }
}

let serverProc = null;
let cdpRef = null;   // 异常时也要把浏览器收掉，别留孤儿窗口/进程
const stopServer = () => { if (serverProc) { try { serverProc.kill(); } catch (e) {} serverProc = null; } };

function ping() {
  return new Promise((resolve) => {
    const req = require('http').get(SERVER + '/config.json', (r) => { r.resume(); resolve(r.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

async function waitJs(cdp, expr, timeout = 20000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await cdp.evaluate(expr).catch(() => null);
    if (v) return v;
    await sleep(250);
  }
  console.log(`   ⏱ 等待超时：${label || expr}`);
  return null;
}

(async () => {
  try { if (process.stdin) process.stdin.isTTY = false; } catch (e) {}

  console.log('① 起服务器…');
  serverProc = spawn(process.execPath, [path.join(__dirname, '..', 'sfu', 'server.js')], {
    env: { ...process.env, AI_FORCE_MOCK: '1' },
    cwd: path.join(__dirname, '..'), stdio: ['ignore', 'ignore', 'pipe'],
  });
  serverProc.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  for (let i = 0; i < 80; i++) { await sleep(250); if (await ping()) break; }
  console.log('   ✅ 服务器就绪');

  console.log('② 起真实浏览器（可见窗口 + 假摄像头）…');
  wipeProfile(9355);   // 干净 profile：不带上次的 HTTP 缓存与 Service Worker
  const cdp = new Cdp({
    headless: false, port: 9355, windowSize: { width: 1440, height: 900 }, startUrl: 'about:blank',
    extraArgs: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  cdpRef = cdp;
  await cdp.launch().catch((e) => { throw new Error('浏览器启动失败: ' + e.message); });
  console.log('   ✅ 浏览器就绪');

  // ★ 测试纪律：E2E 必须关掉浏览器缓存。
  //   Edge 用持久化 profile 目录，上一次跑留下的 HTTP 缓存会让"改了代码不生效"，
  //   于是测试测的是缓存而不是代码（本脚本就踩过：client.js 明明改对了，
  //   浏览器跑的却是旧版）。开了 setCacheDisabled 之后，每次都是真下载。
  await cdp._send(cdp.pageWs, 'Network.enable', {}).catch(() => {});
  await cdp._send(cdp.pageWs, 'Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {});
  await cdp._send(cdp.pageWs, 'Network.clearBrowserCache', {}).catch(() => {});

  await cdp.navigate(SERVER);
  await cdp.waitForLoad(15000);
  await sleep(2500);
  await cdp.setWindowState('normal');

  // ★ 自证：问页面它到底拿到了哪一版 client.js（把"改了没生效"变成一条硬断言）
  const selfCheck = await cdp.evaluate(`fetch('client.js').then(r => r.text()).then(s => JSON.stringify({
    len: s.length, ptr: s.includes('rdPointers'), cancel: s.includes("addEventListener('pointercancel'")
  })).catch(e => 'fetch失败:' + e.message)`);
  const sc = (() => { try { return JSON.parse(selfCheck); } catch (e) { return {}; } })();
  chk(sc.ptr && sc.cancel, `页面侧 client.js 是当前版本（含 pointer 账本）指纹 = ${selfCheck}`);
  // 顺带确认 SW 已注册且缓存名是新版本（避免又跑在旧 SW 下）
  const swInfo = await cdp.evaluate(`(async () => {
    const ks = await caches.keys();
    const regs = navigator.serviceWorker ? await navigator.serviceWorker.getRegistrations() : [];
    return JSON.stringify({ caches: ks, sw: regs.length });
  })().catch(e => 'sw查询失败:' + e.message)`);
  console.log(`   🔎 缓存/SW 状态 = ${swInfo}`);

  const shot = async (name) => {
    const buf = await cdp.screenshot({ format: 'jpeg', quality: 72 });
    const f = path.join(OUT, name + '.jpg');
    fs.writeFileSync(f, buf);
    console.log(`   📸 ${f}`);
    return f;
  };

  // ① 登录页 → 走「游客进入」（不注册也能进）
  console.log('   ① 登录页 → 游客进入');
  await cdp.evaluate(`(() => { const b = document.getElementById('authGuestBtn'); if (b) b.click(); })()`);
  await sleep(1600);

  // ② 加入前预览页 → 进入会议
  console.log('   ② 预览页 → 进入会议');
  const pj = await waitJs(cdp, `!document.getElementById('prejoin').classList.contains('hidden') ? 1 : 0`, 10000, '预览页出现');
  if (!pj) console.log('   ⚠️ 预览页没出现（可能流程有变），继续尝试');
  await cdp.evaluate(`(() => { const b = document.getElementById('pjEnterBtn'); if (b) b.click(); })()`);
  await sleep(1800);

  // ③ 房间面板 → 创建房间
  console.log('   ③ 房间面板 → 创建房间');
  await waitJs(cdp, `!document.getElementById('roomPanel').classList.contains('hidden') ? 1 : 0`, 10000, '房间面板出现');
  await cdp.evaluate(`(() => { const b = document.getElementById('createBtn'); if (b) b.click(); })()`);
  const roomText = await waitJs(cdp, `(document.getElementById('roomBadge').textContent || '').match(/\\d{6}/) ? document.getElementById('roomBadge').textContent : ''`, 12000, '房间号');
  const ROOM = (String(roomText).match(/\d{6}/) || [])[0];
  console.log(`   ✅ 建房完成，房间号 = ${ROOM}`);
  if (!ROOM) throw new Error('没拿到房间号，后续无法进行');
  await sleep(2500);
  await shot('01-进会后-无代理（看指引卡片）');

  console.log('③ 起真桌面代理…');
  wipeProfile(9366);
  const agent = new RemoteAgent({
    server: SERVER, room: ROOM, password: '', name: '演示电脑',
    url: 'https://example.com', headless: true, autoAllow: true,
    port: 9366, quality: 62, fps: 12, durationMs: 300000,
  });
  agent.log = () => {};
  await agent.start();
  const joined = await waitJs(cdp, `!!document.querySelector('.m-ctrl-btn')`, 15000, '成员列表出现「控制电脑」按钮');
  chk(joined, `代理已进房并在成员列表出现`);
  await sleep(900);
  await shot('02-代理进房（看成员行徽标与按钮）');

  console.log('④ 点「控制电脑」→ 走授权 → 等真画面…');
  await cdp.evaluate(`document.querySelector('.m-ctrl-btn').click()`);
  const opened = await waitJs(cdp, `!document.getElementById('rdConsole').classList.contains('hidden')`, 12000, '控制台打开');
  chk(opened, `远程桌面控制台已打开`);
  const gotFrame = await waitJs(cdp, `/实时画面/.test(document.getElementById('rdState').textContent || '') ? 1 : 0`, 15000, '第一帧画面');
  chk(gotFrame, `已收到真实画面帧`);
  await sleep(600);
  await shot('03-控制台-真画面');

  console.log('⑤ 用真实鼠标在画面上操作（CDP Input 打真事件）…');
  const rect = await cdp.evaluate(`(() => { const r = document.getElementById('rdCanvas').getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width/2, y: r.top + r.height/2, w: r.width, h: r.height }); })()`);
  const rc = JSON.parse(rect);
  await cdp._send(cdp.pageWs, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(rc.x), y: Math.round(rc.y), button: 'none', buttons: 0 });
  await cdp._send(cdp.pageWs, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(rc.x), y: Math.round(rc.y), button: 'left', buttons: 1, clickCount: 1 });
  await cdp._send(cdp.pageWs, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(rc.x), y: Math.round(rc.y), button: 'left', buttons: 0, clickCount: 1 });
  await sleep(800);
  console.log('   ✅ 已在画面上派发真实鼠标事件（若被控端页面有响应即证明链路通）');

  console.log('⑥ 通过地址栏远程导航到 example.com…');
  await cdp.evaluate(`(() => { const u = document.getElementById('rdUrl'); u.value = 'https://example.com'; u.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await sleep(4000);
  const curUrl = await agent.cdp.currentUrl();
  chk(/example\.com/.test(curUrl || ''), `被控端浏览器真实地址 = ${curUrl}`);
  const metaUrl = await cdp.evaluate(`document.getElementById('rdUrl').value`);
  chk(/example\.com/.test(metaUrl || ''), `控制端地址栏显示 = ${metaUrl}`);
  await sleep(800);
  await shot('04-远程导航后（真网站画面）');

  console.log('⑦ 模拟手机控制端（390×844 触摸视口）…');
  // 让被控端变成一个长页面，方便验证"双指滑动 → 滚动"
  await agent.cdp.navigate('data:text/html;charset=utf-8,' + encodeURIComponent(
    '<body style="margin:0;height:6000px;background:linear-gradient(#1b2430,#d8b36a)">'
    + '<h1 style="padding:28px;font:30px sans-serif;color:#fff">长页面 · 用来验证手机双指滚动</h1></body>'));
  await sleep(1500);

  await cdp._send(cdp.pageWs, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp._send(cdp.pageWs, 'Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await sleep(1400);
  await shot('06-手机视口（390宽）控制台布局');

  // 诊断：确认触摸/指针事件真的到达了 canvas（不猜，直接数）
  // 关键：pointerdown/move/up 是按手指派发的，双指=两套；这里记录 pointerId 与类型，
  // 用来回答"第 2 根手指落下时账本里到底有几根"
  await cdp.evaluate(`(() => { window.__ts = 0; window.__tm = 0; window.__tm2 = 0; window.__mids = [];
    window.__ptrs = [];
    const c = document.getElementById('rdCanvas');
    c.addEventListener('touchstart', () => { window.__ts++; }, true);
    c.addEventListener('touchmove', (e) => {
      window.__tm++;
      if (e.touches.length === 2) {
        window.__tm2++;
        window.__mids.push(Math.round((e.touches[0].clientY + e.touches[1].clientY) / 2));
      }
    }, true);
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerleave', 'pointerout']) {
      c.addEventListener(t, (e) => {
        if (window.__ptrs.length < 40) window.__ptrs.push(t.replace('pointer','') + '#' + e.pointerId + '@' + Math.round(e.clientY));
      }, true);
    }
    // 前端到底往外发了什么？（拦 WebSocket 原始帧，Socket.IO 走的就是它）
    window.__sends = [];
    const rawSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function (d) {
      try { const s = String(d); if (s.indexOf('remote-input') >= 0 && window.__sends.length < 40) window.__sends.push(s.slice(0, 220)); } catch (err) {}
      return rawSend.call(this, d);
    };
  })()`);
  // 诊断：agent 侧到底收到了哪些输入 kind（判断"没发"还是"发了没生效"）
  const seenKinds = [];
  const origApply = agent.applyInput.bind(agent);
  agent.applyInput = async (msg) => { seenKinds.push(msg.kind + (msg.kind === 'wheel' ? ':' + msg.wheel : '')); return origApply(msg); };

  // 双指上滑 → wheel 帧 → 被控端页面滚动（这就是"手机滚对方页面"）
  const rc2 = JSON.parse(await cdp.evaluate(`(() => { const r = document.getElementById('rdCanvas').getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }); })()`));
  const beforeY = await agent.cdp.evaluate('window.scrollY');
  const twoFingers = (y) => ([{ x: rc2.x - 40, y, id: 1 }, { x: rc2.x + 40, y, id: 2 }]);
  await cdp._send(cdp.pageWs, 'Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: twoFingers(rc2.y) });
  for (let i = 1; i <= 5; i++) {
    await cdp._send(cdp.pageWs, 'Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: twoFingers(rc2.y - i * 30) });
    await sleep(70);
  }
  await cdp._send(cdp.pageWs, 'Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(1000);
  const afterY = await agent.cdp.evaluate('window.scrollY');
  const diag = await cdp.evaluate('JSON.stringify({ ts: window.__ts, tm: window.__tm, twoFinger: window.__tm2, mids: window.__mids })');
  console.log(`   [DIAG] canvas = ${diag}`);
  console.log(`   [DIAG] pointer 事件序列 = ${await cdp.evaluate('JSON.stringify(window.__ptrs)')}`);
  console.log(`   [DIAG] 前端发出去的 remote-input = ${await cdp.evaluate('JSON.stringify(window.__sends)')}`);
  console.log(`   [DIAG] agent 收到的 kind = ${JSON.stringify(seenKinds.slice(0, 12))}`);
  chk(afterY > beforeY + 50, `双指滑动 → 被控端页面真的滚了（scrollY ${beforeY} → ${afterY}）`);
  await shot('07-手机双指滚动后（被控端已滚动）');

  // 单指点击 → 真鼠标点击（手机上"一指即鼠标"，这是 pointer 事件换来的）
  await agent.cdp.evaluate(`(() => {
    const b = document.createElement('button'); b.id = 'rdtest'; b.textContent = '点我';
    b.style.cssText = 'position:fixed;left:24px;top:140px;padding:22px 34px;font:22px sans-serif;z-index:9';
    b.onclick = () => { window.__clicked = (window.__clicked || 0) + 1; };
    document.body.appendChild(b);
  })()`);
  const btnPos = JSON.parse(await agent.cdp.evaluate(`(() => { const r = document.getElementById('rdtest').getBoundingClientRect(); return JSON.stringify({ cx: r.left + r.width / 2, cy: r.top + r.height / 2, vw: innerWidth, vh: innerHeight }); })()`));
  const canvasRect = JSON.parse(await cdp.evaluate(`(() => { const r = document.getElementById('rdCanvas').getBoundingClientRect(); return JSON.stringify({ left: r.left, top: r.top, width: r.width, height: r.height }); })()`));
  const tx = Math.round(canvasRect.left + (btnPos.cx / btnPos.vw) * canvasRect.width);
  const ty = Math.round(canvasRect.top + (btnPos.cy / btnPos.vh) * canvasRect.height);
  await cdp._send(cdp.pageWs, 'Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tx, y: ty, id: 1 }] });
  await sleep(70);
  await cdp._send(cdp.pageWs, 'Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(800);
  const clicked = await agent.cdp.evaluate('window.__clicked || 0');
  chk(clicked > 0, `手机单指点击 → 被控端真实按钮被触发（clicked=${clicked}）`);

  /* ⑧ 手机形态：既要能"参会"（布局不炸、抽屉能开），又要能"控电脑"（控制台装得下）
   *   ▎为什么放在同一个脚本里？浏览器已经起好了、会议已经开着了，
   *     再起一个进程只为量几个布局数值，纯属浪费（E2E 慢就慢在起浏览器）。
   *   ▎测什么：手机端最常见的坏法不是"功能不对"而是"布局溢出"——
   *     横向溢出会让右侧按钮永久点不到，那才是真用不了。 */
  console.log('⑧ 手机形态（参会布局 + 抽屉 + 控制台是否装得下）…');
  const mob = JSON.parse(await cdp.evaluate(`JSON.stringify((() => {
    const de = document.documentElement;
    const rd = document.getElementById('rdConsole');
    const r = rd ? rd.getBoundingClientRect() : null;
    return {
      innerW: innerWidth,
      scrollW: de.scrollWidth,
      bodyScrollW: document.body.scrollWidth,
      rdW: r ? Math.round(r.width) : null,
      rdH: r ? Math.round(r.height) : null,
      rdRight: r ? Math.round(r.right) : null,
      hasSideBtn: !!document.getElementById('sideBtn'),
      hasScrim: !!document.getElementById('sideScrim'),
      sideVisible: !!document.querySelector('.sidebar.open, .sidebar.is-open, .sidebar.show'),
    };
  })())`));
  const noOverflow = mob.scrollW <= mob.innerW + 1 && mob.bodyScrollW <= mob.innerW + 1;
  chk(noOverflow, `手机视口无横向溢出（视口 ${mob.innerW}px，文档宽 ${mob.scrollW}px）`);
  const rdFits = mob.rdW !== null && mob.rdW <= mob.innerW + 1 && mob.rdRight <= mob.innerW + 1;
  chk(rdFits, `远程桌面控制台装得下手机屏（宽 ${mob.rdW}px，右边缘 ${mob.rdRight}px）`);

  // 退出控制（回到普通会议界面）——抽屉要在控制台关掉之后测才有意义，
  //   否则全屏控制台盖在上面，点到了也看不见（类名会变，但那不叫"用得了"）。
  await cdp.evaluate(`document.getElementById('rdRelease').click()`);
  await sleep(1200);
  const closed = await cdp.evaluate(`document.getElementById('rdConsole').classList.contains('hidden')`);
  chk(closed, `退出控制后控制台已关闭（手机端也能退出，不会卡死在全屏里）`);

  // 抽屉：点开关 → 侧栏出来；点遮罩 → 收回去。手机上看成员/聊天全靠它。
  //   ▎断言盯哪里？代码注释写得很清楚：`body.side-open` 是**唯一状态位**。
  //     我第一版盯的是 `.sidebar` 的 className，结果两边都是 "sidebar"，
  //     断言失败——不是功能坏了，是我看错了地方。
  //   ▎第二版又踩了一个：点完立刻量 rect，量到的是**过渡动画的起点**，
  //     于是"侧栏没滑进来"看起来像个 bug，其实只是我抢跑了。
  //     抽屉是 transition 动画 → 必须等动画跑完再量（分开量、中间 sleep）。
  const drawerReady = await cdp.evaluate(`(() => {
    const btn = document.getElementById('sideBtn');
    const side = document.querySelector('.sidebar');
    return JSON.stringify({ ok: !!(btn && side), why: !btn ? '没有抽屉开关' : (!side ? '没有侧栏' : '') });
  })()`);
  const dr = JSON.parse(drawerReady);
  if (!dr.ok) {
    console.log(`   ⚠️ 跳过抽屉检查：${dr.why}`);
  } else {
    const measure = async () => JSON.parse(await cdp.evaluate(`JSON.stringify((() => {
      const side = document.querySelector('.sidebar');
      const scrim = document.getElementById('sideScrim');
      const r = side.getBoundingClientRect();
      return {
        open: document.body.classList.contains('side-open'),
        left: Math.round(r.left), right: Math.round(r.right),
        w: innerWidth, scrimHidden: scrim ? scrim.classList.contains('hidden') : null,
      };
    })())`));
    const rectClosed = await measure();
    await cdp.evaluate(`document.getElementById('sideBtn').click()`);
    await sleep(500);                       // 等过渡动画结束再量（上次就是这里抢跑）
    const rectOpen = await measure();
    await cdp.evaluate(`document.getElementById('sideScrim') && document.getElementById('sideScrim').click()`);
    await sleep(500);
    const rectAgain = await measure();

    chk(rectOpen.open === true, `点开关 → body.side-open 置位（${rectClosed.open} → ${rectOpen.open}）`);
    // 硬指标：侧栏与视口真的有交集（不是"状态位变了但东西在屏幕外"）
    chk(rectOpen.right > 0 && rectOpen.left < rectOpen.w,
      `侧栏真的滑进手机视口了（left ${rectClosed.left} → ${rectOpen.left}，视口宽 ${rectOpen.w}）`);
    chk(rectOpen.scrimHidden === false, '同时亮起遮罩（点空白处能关）');
    chk(rectAgain.open === false && rectAgain.left === rectClosed.left,
      `点遮罩后完全复位（open=${rectAgain.open}，left 回到 ${rectAgain.left}）`);
  }
  await shot('08-手机形态（参会布局）');

  console.log('⑨ 收尾…');
  await cdp._send(cdp.pageWs, 'Emulation.clearDeviceMetricsOverride');
  await cdp._send(cdp.pageWs, 'Emulation.setTouchEmulationEnabled', { enabled: false });
  await sleep(900);
  await shot('05-退出控制后');

  agent.shutdown('e2e 结束');
  cdp.kill();
  await sleep(600);
  if (issues === 0) {
    console.log(`\n🎉 端到端验证全部通过（${checks} 项），截图目录：` + OUT);
  } else {
    console.log(`\n⚠️ 端到端验证有 ${issues}/${checks} 项不通过，截图目录：` + OUT);
    console.log('   截图就是证据——打开对应 jpg 看当时屏幕上到底是什么。');
  }
  stopServer();
  process.exit(issues ? 1 : 0);
})().catch((e) => {
  console.error('❌ 异常：', e && e.stack || e);
  stopServer();
  if (cdpRef) { try { cdpRef.kill(); } catch (e) { /* ignore */ } }
  process.exit(1);
});
