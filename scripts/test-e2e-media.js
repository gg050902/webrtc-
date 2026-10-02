/* ══════════════════════════════════════════════════════════════
 * scripts/test-e2e-media.js —— ★ P1/E3-media：多人音视频 CDP 真浏览器断言
 * （2026-10-01，后续升级方向.md 0.4 第 1 条，E3 的最后一块拼图）
 *
 * ▎要解决什么？此前"会议本体"（音视频收发）没有自动化回归——
 *   冒烟只到"单实例逻辑正确"，真浏览器 e2e 只测了桌面控制链路。
 *   谁改坏了音视频（produce/consume/resume/订阅绑定/编解码），
 *   只能靠人开两个窗口才知道。本脚本用**两个真实 Chromium**（假摄像头/假麦克风 +
 *   自动授权 UI），双页游客进同一房，断言"画面真的在流"。
 *
 * ▎断言五件：① A 建房拿到 6 位号；② B 凭号加入成功（双方成员数=2）；
 *   ③ A 侧出现 videoWidth>0 的远端画面；④ B 侧同样（假摄像头出绿帧 = 字节真的在流）；
 *   ⑤ 双侧截图存档（人可复核）。中途任何一步超时都算失败（退出码 1）。
 *
 * ▎跑法：npm run test:e2e-media（专用端口 3016，可 TEST_E2E_MEDIA_PORT 覆盖——
 *   与其它测试互不抢 3001，防止"复用了别人的服务器"式假绿）。
 * ══════════════════════════════════════════════════════════════ */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { Cdp } = require('../agent/cdp');

const PORT = Number(process.env.TEST_E2E_MEDIA_PORT) || 3016;
const SERVER = `http://localhost:${PORT}`;
// ★ 全部路径**模块级常量**：无动态片段进 path.join（静态扫描口径），文件名走白名单
const SERVER_JS = path.join(__dirname, '..', 'sfu', 'server.js');
const OUT = path.join(os.tmpdir(), 'e2e-media-shots');
const TEST_DB_FILE = path.join(os.tmpdir(), `e2e-media-${process.pid}-${Date.now()}.db`);
const TEST_LEGACY_USERS = path.join(os.tmpdir(), `e2e-media-legacy-${process.pid}.json`);
const SHOT_NAMES = ['A-建房侧-双人在会', 'B-加入侧-双人在会', 'B-首页hero-手机390']; // 截图文件名白名单（索引即 shot 的 idx，加档位要同步加名字）

let checks = 0, issues = 0;
const chk = (cond, msg) => {
  checks++;
  if (cond) { console.log(`   ✅ ${msg}`); }
  else { issues++; console.log(`   ❌ ${msg}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let serverProc = null;
const browsers = [];

function wipeProfile(port) {
  const dir = path.join(os.tmpdir(), `e2e-media-profile-${port}`);
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); } catch (e) { /* 忽略 */ }
  return dir;
}

/* 等到页面里某 JS 表达式为真（轮询 evaluate；防"事件比 DOM 快"的时序坑） */
async function waitJs(cdp, expr, timeout = 20000, label = '') {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const v = await cdp.evaluate(expr);
      if (v && v !== '0' && v !== 'false') return v;
    } catch (e) { /* 页面在跳转等：继续等 */ }
    await sleep(300);
  }
  console.log(`   ⏳ 等超时：${label || expr}`);
  return null;
}

/* 游客进房三步（登录卡 → 预览页 → 进会）；joinRoomNo 传号则加入、不传则创建 */
async function guestEnter(cdp, joinRoomNo) {
  await cdp.evaluate(`(() => { const b = document.getElementById('authGuestBtn'); if (b) b.click(); })()`);
  await waitJs(cdp, `!document.getElementById('prejoin').classList.contains('hidden') ? 1 : 0`, 12000, '预览页出现');
  await sleep(1200); // 预览页把假摄像头/麦克风 produce 出来需要一点时间
  await cdp.evaluate(`(() => { const b = document.getElementById('pjEnterBtn'); if (b) b.click(); })()`);
  await waitJs(cdp, `!document.getElementById('roomPanel').classList.contains('hidden') ? 1 : 0`, 12000, '房间面板出现');
  await sleep(600);
  if (joinRoomNo) {
    await cdp.evaluate(`(() => {
      const i = document.getElementById('roomInput');
      i.value = ${JSON.stringify(joinRoomNo)};
      i.dispatchEvent(new Event('input', { bubbles: true }));
      const b = document.getElementById('joinRoomBtn');
      if (b) b.click();
    })()`);
  } else {
    await cdp.evaluate(`(() => { const b = document.getElementById('createBtn'); if (b) b.click(); })()`);
  }
}

/* 统计"画面真的在流"的视频：videoWidth>0 且有高度（假摄像头是固定尺寸绿帧，必有宽度） */
const VIDEO_STATS = `JSON.stringify((() => {
  const vs = [...document.querySelectorAll('video')];
  return { live: vs.filter(v => v.videoWidth > 0 && v.videoHeight > 0).length };
})())`;

(async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║ E3-media：多人音视频真浏览器端到端（P1）  ║');
  console.log('╚══════════════════════════════════════════╝');
  fs.mkdirSync(OUT, { recursive: true });

  console.log(`① 起 SFU 服务器（专用端口 ${PORT}，防"复用别人的服务器"假绿）…`);
  let up = false;
  try {
    up = await new Promise((resolve) => {
      require('http').get(`${SERVER}/config.json`, (r) => { r.resume(); resolve(r.statusCode === 200); })
        .on('error', () => resolve(false));
    });
  } catch (e) { up = false; }
  if (up) {
    console.log(`\n❌ ${PORT} 端口已有服务——需要"自己起的"服务器保证确定性。\n   修法：关掉占用者，或 TEST_E2E_MEDIA_PORT=3017 npm run test:e2e-media\n`);
    process.exit(1);
  }
  // 可执行用字面量 'node'（静态扫描口径）；脚本路径是模块级常量
  serverProc = spawn('node', [SERVER_JS], {
    env: { ...process.env, PORT: String(PORT), SFU_NO_HTTPS: '1', AI_FORCE_MOCK: '1',
      DB_FILE: TEST_DB_FILE, USERS_FILE_LEGACY: TEST_LEGACY_USERS },
    cwd: path.join(__dirname, '..'), stdio: ['ignore', 'ignore', 'pipe'],
  });
  serverProc.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    await sleep(250);
    try {
      ready = await new Promise((resolve) => {
        require('http').get(`${SERVER}/config.json`, (r) => { r.resume(); resolve(r.statusCode === 200); })
          .on('error', () => resolve(false));
      });
    } catch (e) { ready = false; }
  }
  if (!ready) throw new Error('服务器未就绪（看上方 [server] 输出）');
  console.log('   ✅ 服务器就绪');

  console.log('② 起两个真实 Chromium（假摄像头 + 自动授权 UI）…');
  const mk = async (port, label) => {
    wipeProfile(port);
    const cdp = new Cdp({
      headless: false, port, windowSize: { width: 1280, height: 860 }, startUrl: 'about:blank',
      extraArgs: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    });
    browsers.push(cdp);
    await cdp.launch();
    await cdp._send(cdp.pageWs, 'Network.enable', {}).catch(() => {});
    await cdp._send(cdp.pageWs, 'Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {});
    await cdp.navigate(SERVER);
    await cdp.waitForLoad(15000);
    await sleep(1500);
    console.log(`   ✅ 浏览器 ${label} 就绪（端口 ${port}）`);
    return cdp;
  };
  const A = await mk(9357, 'A(建房)');
  const B = await mk(9358, 'B(加入)');
  const shot = async (cdp, idx) => {
    const name = SHOT_NAMES[idx]; // 白名单文件名（不吃动态输入）
    try {
      const buf = await cdp.screenshot({ format: 'jpeg', quality: 70 });
      const f = path.join(OUT, `${idx + 1}-${name}.jpg`);
      fs.writeFileSync(f, buf);
      console.log(`   📸 ${f}`);
    } catch (e) { /* 截图失败不判失败 */ }
  };

  console.log('③ A 游客进房并创建房间…');
  await guestEnter(A, null);
  const roomText = await waitJs(A, `(document.getElementById('roomBadge').textContent || '').match(/\\d{6}/) ? document.getElementById('roomBadge').textContent : ''`, 15000, '房间号');
  const ROOM = (String(roomText).match(/\d{6}/) || [])[0];
  chk(!!ROOM, `A 建房拿到 6 位房间号 = ${ROOM || '(无)'}`);
  if (!ROOM) throw new Error('没拿到房间号，无法继续');
  await sleep(1500);

  console.log('④ B 游客进房并凭号加入…');
  await guestEnter(B, ROOM);
  await sleep(2500);

  console.log('⑤ 断言：双方都看到 2 名成员…');
  const aMembers = await waitJs(A, `((document.getElementById('memberNum')||{}).textContent === '2') ? 1 : 0`, 20000, 'A 侧成员数=2');
  chk(!!aMembers, 'A 侧成员数 = 2');
  const bMembers = await waitJs(B, `((document.getElementById('memberNum')||{}).textContent === '2') ? 1 : 0`, 20000, 'B 侧成员数=2');
  chk(!!bMembers, 'B 侧成员数 = 2');

  console.log('⑥ 断言：画面真的在流（远端 videoWidth>0）…');
  /* ▎为什么用 videoWidth 判"在流"：假摄像头出的是恒定绿帧，尺寸固定非 0；
   *   videoWidth>0 = 浏览器真的收到了**可解码的视频轨道**——链路上任何一环
   *   （produce/consume/resume/订阅绑定）断了它都是 0。这是最硬的端到端证据。 */
  const aVid = await waitJs(A, `JSON.parse(${VIDEO_STATS}).live >= 1 ? 1 : 0`, 25000, 'A 侧远端画面');
  chk(!!aVid, 'A 侧出现至少 1 路在流的画面');
  const bVid = await waitJs(B, `JSON.parse(${VIDEO_STATS}).live >= 1 ? 1 : 0`, 25000, 'B 侧远端画面');
  chk(!!bVid, 'B 侧出现至少 1 路在流的画面');
  await sleep(1200); // 稳定一下再截图
  await shot(A, 0);
  await shot(B, 1);

  /* ⑦ ★ 2026-10-02 Piik 取长②「只听不看」的正向路径
   * ▎为什么必须放在这条 e2e 里验：信令测试只能测"错 id 被拒"，而这条功能的全部价值在于
   *   "服务器真的停止转发这一路的包"——那只有真浏览器 + 真媒体流才看得见（假绿防线，坑 57/65）。
   * ▎判据用 getVideoPlaybackQuality().totalVideoFrames（**已解码帧数**），不用 currentTime：
   *   直播流的 currentTime 跟着墙钟走，暂停后照样涨，用它判会得出"没生效"的假结论。 */
  console.log('⑦ 断言：只听不看 = 服务器真的停止转发这一路（解码帧数停增）…');
  const FRAMES = `(() => { const t=[...document.querySelectorAll('.video-box')].find(v=>v.querySelector('.watch-btn')); return t? String(t.querySelector('video').getVideoPlaybackQuality().totalVideoFrames) : 'none' })()`;
  const CLICK_WATCH = `(() => { const t=[...document.querySelectorAll('.video-box')].find(v=>v.querySelector('.watch-btn')); if(!t) return 0; t.querySelector('.watch-btn').click(); return 1 })()`;
  const f1 = Number(await B.evaluate(FRAMES));
  await sleep(1500);
  const f2 = Number(await B.evaluate(FRAMES));
  chk(f2 > f1, `暂停前帧数在增长（${f1} → ${f2}，证明这一路确实在流）`);

  await B.evaluate(CLICK_WATCH);
  const paused = await waitJs(B, `document.querySelector('.video-box.paused-view') ? 1 : 0`, 8000, '格子进入暂停态');
  chk(!!paused, '点「不看」后进入暂停态（服务器 ack paused=true）');
  await sleep(1200);            // 把浏览器已缓冲的那点帧放完
  const p1 = Number(await B.evaluate(FRAMES));
  await sleep(2200);
  const p2 = Number(await B.evaluate(FRAMES));
  chk(p2 <= p1 + 2, `暂停后解码帧不再增长（${p1} → ${p2}；允许 ≤2 帧是排空已缓冲的）`);

  await B.evaluate(CLICK_WATCH);
  const resumed = await waitJs(B, `document.querySelector('.video-box.paused-view') ? 0 : 1`, 8000, '恢复接收');
  chk(!!resumed, '再点一次恢复（暂停态摘掉）');
  await sleep(1000);
  const r1 = Number(await B.evaluate(FRAMES));
  await sleep(1500);
  const r2 = Number(await B.evaluate(FRAMES));
  chk(r2 > r1, `恢复后帧数重新增长（${r1} → ${r2}，链路完好回来）`);

  /* ⑧ ★ 2026-10-02 Piik 取长①：每路独立音量（0~100% 走元素、>100% 走 WebAudio 增强）
   * ▎要防的失败模式很具体：增强时忘了把元素静音 = 双重回声；增强不可用还硬切 = 一路没声。 */
  console.log('⑧ 断言：每路独立音量控件可用（分层不弄丢声音）…');
  const hasVol = await waitJs(B, `document.querySelector('.video-box .vol-ctl input[type=range]') ? 1 : 0`, 6000, '音量滑杆存在');
  chk(!!hasVol, '远端格子上有独立音量滑杆');
  const volState = await B.evaluate(`(() => {
    const box=[...document.querySelectorAll('.video-box')].find(v=>v.querySelector('.vol-ctl input'));
    if(!box) return 'none';
    const sl=box.querySelector('.vol-ctl input'); const v=box.querySelector('video');
    sl.value='0.4'; sl.dispatchEvent(new Event('input',{bubbles:true}));
    const half=[v.volume, v.muted];
    sl.value='1.8'; sl.dispatchEvent(new Event('input',{bubbles:true}));
    const boost=[v.volume, v.muted];
    sl.value='1'; sl.dispatchEvent(new Event('input',{bubbles:true}));
    return JSON.stringify({ half, boost, back: [v.volume, v.muted] });
  })()`);
  try {
    const vs = JSON.parse(volState);
    chk(Math.abs(vs.half[0] - 0.4) < 0.06 && vs.half[1] === false, `40% 走元素音量（volume=${vs.half[0]}，未借音频图）`);
    chk(vs.boost[1] === true && vs.boost[0] === 1, `180% 走 WebAudio 增强（元素静音、由音频图出声）`);
    chk(vs.back[1] === false, `调回 100% 后元素取消静音（音频图已拆，不会一路没声）`);
  } catch (e) { chk(false, `音量状态读取失败：${volState}`); }

  /* ⑨ ★ 2026-10-02 Piik 取长④：预览页 ICE 自检真的给出了结论（不是永远转圈） */
  console.log('⑨ 断言：预览页 ICE 自检有结论…');
  const probe = await waitJs(A, `(document.getElementById('iceProbe')||{}).textContent || ''`, 14000, 'ICE 自检结论');
  chk(/网络自检/.test(String(probe)), `ICE 自检结论：${probe}`);
  /* ⑩ ★ 2026-10-03 把 D1 整条"分层 + 选层"链在真浏览器里钉死
   * ▎为什么这条值得加：信令回归只能验"set-preferred-layers 的错误路径"，
   *   冒烟只能验"源码形状对"——而**分层到底协商成功没有、降层到底有没有让画面变小**，
   *   只有真浏览器 + 真媒体流看得见（坑 57/65 那条纪律：断言"变了"之前先证明"原来在动"）。
   * ▎判据用 `video.videoWidth`：降层 = 服务器改转发哪一路 = 解码分辨率真的变小。
   *   这是"画面确实降级了"最硬的证据，比读码率省去了采样窗口。 */
  console.log('⑩ 断言：simulcast 真分层 + 锁最低层真的让画面变小…');
  const layerCounts = await waitJs(A,
    `(() => { const v = [...layerState.values()].map(s => s.layerCount); return v.length ? Math.max.apply(null, v) : 0 })()`,
    15000, 'A 侧收到的 layer-changed');
  chk(Number(layerCounts) >= 2, `A 侧订阅到的画面有 ${layerCounts} 层（服务器 layer-changed 已送达，选层器才会出现）`);
  const VW = `(() => { const t=[...document.querySelectorAll('.video-box')].find(v=>v.querySelector('.layer-pick')); return t? String(t.querySelector('video').videoWidth) : 'none' })()`;
  const wBefore = Number(await A.evaluate(VW));
  chk(wBefore > 0, `降层前画面在流（videoWidth=${wBefore}，先证明输入真的进去了）`);
  await A.evaluate(`(() => {
    const t=[...document.querySelectorAll('.video-box')].find(v=>v.querySelector('.layer-pick'));
    const sel=t.querySelector('.layer-pick select'); sel.value='0';
    sel.dispatchEvent(new Event('change',{bubbles:true})); return 1 })()`);
  let wAfter = wBefore;
  for (let i = 0; i < 12; i++) { await sleep(1000); wAfter = Number(await A.evaluate(VW)) || wAfter; if (wAfter < wBefore) break; }
  chk(wAfter < wBefore, `锁到第 1 层后画面分辨率真的变小（${wBefore} → ${wAfter}px，这就是弱网自动降层的同一条执行路径）`);
  await A.evaluate(`(() => {
    const t=[...document.querySelectorAll('.video-box')].find(v=>v.querySelector('.layer-pick'));
    const sel=t.querySelector('.layer-pick select'); sel.value='auto';
    sel.dispatchEvent(new Event('change',{bubbles:true})); return 1 })()`);
  await sleep(4000);   // 交回自动后服务器下一轮 tick（2s）会升回去，给两拍
  const wBack = Number(await A.evaluate(VW)) || 0;
  chk(wBack >= wAfter, `交回服务器自动选层后画面没被锁死在低层（videoWidth=${wBack}）`);

  /* ⑪ ★ 2026-10-03 首页 hero 的手机形态（390×844）
   * ▎为什么放到这条 e2e 里：hero 是本轮新加的、又是"用户第一眼"，
   *   而它最容易坏的地方恰恰是**小屏放不放得下**——
   *   实测就踩过一次：`.hero` 用 align-items:center + overflow:hidden，
   *   内容比屏幕高时把文案顶出容器上沿被裁掉（.hero-copy 的 y = -101），
   *   用户看到的就是"标题和打字机凭空消失"。这条断言就是那次的哨兵。 */
  console.log('⑪ 断言：首页 hero 在 390×844 下放得下、文案不被裁…');
  await B._send(B.pageWs, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await B.evaluate('location.href = "/"');
  await sleep(3500);
  const heroMobile = JSON.parse(await B.evaluate(`(() => {
    const g = (s) => document.querySelector(s);
    const pre = document.getElementById('prejoin');
    const gg = [...document.querySelectorAll('button')].find(x=>/游客进入/.test(x.textContent));
    if (gg) gg.click();
    const rect = (s) => { const e = g(s); if (!e) return null; const r = e.getBoundingClientRect(); return { y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    return JSON.stringify({
      vw: innerWidth, docW: document.documentElement.scrollWidth,
      preScroll: pre ? pre.scrollHeight > pre.clientHeight : null,
      blurb: rect('.hero-blurb'), typed: rect('.hero-typed'), pills: rect('.hero-pills'),
      typedText: (document.getElementById('heroTyped')||{}).textContent || '',
    });
  })()`));
  chk(heroMobile.docW <= heroMobile.vw + 1, `手机视口无横向溢出（视口 ${heroMobile.vw}，文档宽 ${heroMobile.docW}）`);
  chk(heroMobile.blurb && heroMobile.blurb.y >= 0, `模糊引导语在可视区内（y=${heroMobile.blurb && heroMobile.blurb.y}，被裁掉时这里是负数）`);
  chk(heroMobile.typed && heroMobile.typed.y >= 0 && heroMobile.typedText.length > 4,
    `打字机主句可见且在出字（y=${heroMobile.typed && heroMobile.typed.y}，"${String(heroMobile.typedText).slice(0, 10)}…"）`);
  chk(heroMobile.pills && heroMobile.pills.y >= 0, `胶囊 CTA 可见（y=${heroMobile.pills && heroMobile.pills.y}）`);
  await shot(A, 0);

  console.log(`\n结果：${checks - issues}/${checks} 通过，${issues} 失败（截图目录 ${OUT}）`);
  const fail = issues > 0;
  for (const b of browsers) { try { b.kill(); } catch (e) { /* 忽略 */ } }
  if (serverProc) { try { serverProc.kill(); } catch (e) { /* 忽略 */ } }
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('💥 异常：', err && err.message || err);
  for (const b of browsers) { try { b.kill(); } catch (e) { /* 忽略 */ } }
  if (serverProc) { try { serverProc.kill(); } catch (e) { /* 忽略 */ } }
  process.exit(1);
});
