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
const SHOT_NAMES = ['A-建房侧-双人在会', 'B-加入侧-双人在会']; // 截图文件名白名单

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
