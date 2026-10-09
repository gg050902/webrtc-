/* ══════════════════════════════════════════════════════════════
 * scripts/test-e2e-reconnect.js —— 服务器重启后客户端韧性的真浏览器端到端
 *
 * ▎要解决什么？用户实测撞过"服务器重启 → 弹窗死循环"（2026-10-03a 修的 giveUpRoom
 *   那一轮），当时的回归只有结构断言（全文件 0 次 alert(）；真浏览器里
 *   「kill 服务 → 自动重连 → 房间没了 → 干净退回加入页 → 能再建新房间」
 *   这条**韧性链路**从未被自动化覆盖。投入真实使用，服务器总会重启。
 *
 * ▎流程六步：
 *   ① 起服务器（专用端口 3020）+ 真 Chromium 进房建房；
 *   ② 硬杀服务器（taskkill，模拟崩溃/重启）；
 *   ③ 重启服务器；
 *   ④ 断言客户端自动重连后收到 room-not-found → **giveUpRoom 状态迁移**：
 *      回到加入页（roomPanel 可见）、房间徽标隐藏、**全程零原生弹窗**（CDP 监听
 *      javascriptDialogOpening）+ toast 提示出现；
 *   ⑤ 再建一个新房间 → 回到会中（memberNum=1、控制按钮恢复）；
 *   ⑥ 关键步骤截图。
 *
 * ▎跑法：npm run test:e2e-reconnect（专用端口 3020；TEST_E2E_RECONNECT_PORT 可换）。
 * ══════════════════════════════════════════════════════════════ */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { Cdp } = require('../agent/cdp');
/* ★ 2026-10-06 测试语音的唯一实现（与 sfu/nets.js、password.js 同一条"一件事一处写"纪律）*/
const { makeSpeechWav, FIXTURE_SENTENCES } = require('./voice-fixture.js');

const PORT = Number(process.env.TEST_E2E_RECONNECT_PORT) || 3020;
const SERVER = `http://localhost:${PORT}`;
const SERVER_JS = path.join(__dirname, '..', 'sfu', 'server.js');
const OUT = path.join(os.tmpdir(), 'e2e-reconnect-shots');
const TEST_DB_FILE = path.join(os.tmpdir(), 'e2e-reconnect-data.db');
const TEST_LEGACY_USERS = path.join(os.tmpdir(), 'e2e-reconnect-legacy.json');
// 截图文件名白名单（静态扫描口径）
const SHOT_NAMES = ['1-进房在会.jpg', '2-退回加入页.jpg', '3-新房间在会.jpg'];

let checks = 0, issues = 0;
const chk = (cond, msg) => {
  checks++;
  if (cond) { console.log(`   ✅ ${msg}`); }
  else { issues++; console.log(`   ❌ ${msg}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browsers = [];
let serverProc = null;
const dialogs = [];   // CDP 捕获的原生弹窗（alert/confirm/prompt）——韧性链路上一次都不许有

function startServer() {
  const p = spawn('node', [SERVER_JS], {
    env: {
      ...process.env,
      PORT: String(PORT),
      SFU_NO_HTTPS: '1',
      DB_FILE: TEST_DB_FILE,
      USERS_FILE_LEGACY: TEST_LEGACY_USERS,
    },
    cwd: path.join(__dirname, '..'), stdio: ['ignore', 'ignore', 'pipe'],
  });
  p.stderr.on('data', () => { /* 崩溃日志不刷屏 */ });
  return p;
}

async function waitServerUp(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const up = await new Promise((resolve) => {
        require('http').get(`${SERVER}/config.json`, (r) => { r.resume(); resolve(r.statusCode === 200); })
          .on('error', () => resolve(false));
      });
      if (up) return true;
    } catch (e) { /* 继续等 */ }
    await sleep(300);
  }
  return false;
}

function wipeProfile(port) {
  const dir = path.join(os.tmpdir(), `e2e-reconnect-profile-${port}`);
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); } catch (e) { /* 忽略 */ }
  return dir;
}

async function waitJs(cdp, expr, timeout = 20000, label = '') {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const v = await cdp.evaluate(expr);
      if (v && v !== '0' && v !== 'false') return v;
    } catch (e) { /* 页面在跳转等：继续等 */ }
    await sleep(400);
  }
  console.log(`   ⏳ 等超时：${label || expr}`);
  return null;
}

async function shot(cdp, idx) {
  const name = SHOT_NAMES[idx];
  if (!name) return;
  try {
    const buf = await cdp.screenshot({ format: 'jpeg', quality: 72 });
    fs.writeFileSync(path.join(OUT, name), buf);
    console.log(`   📸 ${path.join(OUT, name)}`);
  } catch (e) { console.log(`   ⚠️ 截图失败：${e.message}`); }
}

/* 游客进房三步（登录卡 → 预览页 → 进会）+ 建房。
 * ★ 房间号等待必须要求**徽标可见**：退房后徽标只是 hidden，textContent 里还挂着
 *   旧号——不查可见性会把旧号当新号（首跑实测踩中）。 */
async function guestCreate(cdp) {
  await cdp.evaluate(`(() => { const b = document.getElementById('authGuestBtn'); if (b) b.click(); })()`);
  await waitJs(cdp, `!document.getElementById('prejoin').classList.contains('hidden') ? 1 : 0`, 12000, '预览页出现');
  await sleep(1100);
  await cdp.evaluate(`(() => { const b = document.getElementById('pjEnterBtn'); if (b) b.click(); })()`);
  await waitJs(cdp, `!document.getElementById('roomPanel').classList.contains('hidden') ? 1 : 0`, 12000, '房间面板出现');
  await sleep(500);
  await cdp.evaluate(`(() => { const b = document.getElementById('createBtn'); if (b) b.click(); })()`);
  return waitJs(cdp, `((el) => { const t = el.textContent || ''; return !el.classList.contains('hidden') && t.match(/\\d{6}/) ? t : ''; })(document.getElementById('roomBadge'))`, 15000, '可见的房间号');
}

/* 在会判据：加入页隐藏 + 房间徽标可见（首跑把面板可见性写反了，记进注释防再犯） */
const IN_ROOM = `document.getElementById('roomPanel').classList.contains('hidden') && !document.getElementById('roomBadge').classList.contains('hidden') ? 1 : 0`;

(async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║ E2E-RECONNECT：服务器重启后的客户端韧性（真浏览器）   ║');
  console.log('╚════════════════════════════════════════════════════╝');
  fs.mkdirSync(OUT, { recursive: true });

  let up = false;
  try {
    up = await new Promise((resolve) => {
      require('http').get(`${SERVER}/config.json`, (r) => { r.resume(); resolve(r.statusCode === 200); })
        .on('error', () => resolve(false));
    });
  } catch (e) { up = false; }
  if (up) {
    console.log(`\n❌ ${PORT} 端口已有服务——本测试只用自己的端口。\n   换端口：TEST_E2E_RECONNECT_PORT=3023 npm run test:e2e-reconnect\n`);
    process.exit(1);
  }

  console.log(`① 起服务器（:${PORT}）…`);
  serverProc = startServer();
  chk(await waitServerUp(), '服务器就绪');

  console.log('② 真 Chromium 进房建房…');
  /* ★ 2026-10-06 假麦克风必须喂**真语音**：`--use-fake-device-for-media-stream` 送的是
   *   近乎静音的信号，而服务器第一道闸就是能量闸（-62 dBFS 以下连模型都不叫）——
   *   于是这条测试的"续会识别"从来没有真正的字幕可回溯（它原先拿页面上的 ⏱ 读数当
   *   "账本就绪"的代理，读数元素改成初态隐藏之后代理失效，才把这个空转暴露出来）。
   *   修法是把输入补上，不是把断言放宽。合成失败（没有中文音色）就如实降级：
   *   续会那两条断言会被跳过并大声打印"本次未验到"，绝不让它假装通过。 */
  let audioArg = '';
  let voiceReady = false;
  try {
    const fx = await makeSpeechWav({
      dir: path.join(os.tmpdir(), 'e2e-reconnect-audio'),
      sentences: [FIXTURE_SENTENCES[0], FIXTURE_SENTENCES[1]],   // 同一份句子，四处不复抄
    });
    audioArg = `--use-file-for-fake-audio-capture=${fx.file.replace(/\\/g, '/')}`;
    voiceReady = true;
    console.log(`   🔊 假麦克风已就位（${fx.sizeKb}KB / ${fx.durSec}s，最长静音 ${fx.silSec.toFixed(1)}s）`);
  } catch (e) {
    console.log(`   ⚠️ 测试语音合成失败（${String(e && e.message).slice(0, 60)}）——`
      + '假麦克风近乎静音，服务器会正确地不产字幕；下面的"续会"断言将如实跳过');
  }
  wipeProfile(9363);
  const cdp = new Cdp({
    headless: false, port: 9363, windowSize: { width: 1280, height: 820 }, startUrl: 'about:blank',
    extraArgs: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
      ...(audioArg ? [audioArg] : [])],
  });
  browsers.push(cdp);
  await cdp.launch();
  // 监听原生弹窗：韧性链路上一条都不许有（10-03a 修的"弹窗循环"在这里变成长期哨兵）
  cdp.on('Page.javascriptDialogOpening', () => dialogs.push(Date.now()));
  await cdp.navigate(SERVER);
  await cdp.waitForLoad(15000);
  await sleep(1200);
  const roomText = await guestCreate(cdp);
  const ROOM = (String(roomText).match(/\d{6}/) || [])[0];
  chk(!!ROOM, `建房拿到 6 位房间号 = ${ROOM || '(无)'}`);
  if (!ROOM) throw new Error('没拿到房间号');
  const inRoom = await waitJs(cdp, IN_ROOM, 8000, '在会状态');
  chk(!!inRoom, '在会（房间面板隐藏 + 徽标可见）');
  /* ★ 2026-10-04h 续会识别要靠**字幕账本**——杀服务器前先开字幕，让假麦克风的音频真转写几条进账本。
   * ★ 2026-10-06 判据换成**直接读那条 jsonl**，不再拿页面上的 ⏱ 读数当代理信号。
   *   ▎为什么必须换：⏱ 只在"人真的停下来"那次定稿（`fin==='silence'`）才刷新，
   *     而引擎走兜底 / 单段慢于时长保险丝时，每句都以 `max-age` 定稿、读数按坑 90 的规矩诚实归零
   *     ——于是"账本就绪"与"读数出现"是**两件事**，用后者证前者就会在降级路径上假红。
   *     10-05f 已经给 test:asr-live 补过这一档（要么有读数、要么写明为什么量不到），这次轮到这条。
   *   ▎直接读服务器写的那份文件，才是"续会回溯的数据源就绪"这句话的字面意思（坑 65：断言要量它声称的那个量）。 */
  console.log('②b 开字幕并等**服务器账本落盘**（续会回溯的数据源就是这条 jsonl）…');
  await cdp.evaluate(`(() => { document.getElementById('capBtn').click(); })()`);
  const capFile = () => {
    const utc = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return path.join(__dirname, '..', 'sfu', 'captions', `cap-${ROOM}-${utc}.jsonl`);
  };
  const readLedger = () => {
    try {
      return fs.readFileSync(capFile(), 'utf8').split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
        .filter((e) => e && e.text);
    } catch (e) { return []; }
  };
  const tLedger = Date.now();
  let ledger = readLedger();
  while (!ledger.length && Date.now() - tLedger < 90000) { await sleep(1000); ledger = readLedger(); }
  /* 语音没就位时这条**跳过并大声说**，不算通过也不算失败：
   *   把它记成通过 = 假绿（坑 57/65）；记成失败 = 把"fixture 造不出来"说成"续会有 bug"。
   *   跳过之后，下面依赖账本的 `resumed` 断言一并跳过（同一个前提）。 */
  const ledgerReady = ledger.length > 0;
  if (voiceReady) {
    chk(ledgerReady,
      `服务器字幕账本已落盘 ${ledger.length} 条（等了 ${((Date.now() - tLedger) / 1000).toFixed(0)}s · ${path.basename(capFile())}）`);
  } else {
    console.log(`   ⏭ 跳过（没有真语音输入）：账本 ${ledger.length} 条 —— 续会链路本次未验到`);
  }
  /* ⏱ 读数降为**观察项**：它有没有出现、为什么没出现，都打印出来但不决定成败。 */
  const latShown = await cdp.evaluate(`(() => {
    const lat = document.getElementById('capLat');
    return lat && !lat.classList.contains('hidden') ? (lat.textContent || '').trim() : '';
  })()`);
  const fins = ledger.map((e) => e.fin || '?');
  console.log(`   ⓘ ⏱ 读数${latShown ? `已出现：${latShown}` : '未出现'}；定稿原因分布：${fins.join('/')}`
    + (latShown ? '' : '（非 silence 定稿时读数按坑 90 诚实归零，不影响账本就绪）'));
  await shot(cdp, 0);

  console.log('③ 硬杀服务器（模拟崩溃/重启）…');
  try { serverProc.kill(); } catch (e) { /* 已退 */ }
  await sleep(600);
  try { spawn('taskkill', ['/PID', String(serverProc.pid), '/T', '/F'], { windowsHide: true }); } catch (e) { /* 已退 */ }
  await sleep(1500);

  console.log('④ 重启服务器（同一个端口）…');
  serverProc = startServer();
  chk(await waitServerUp(), '服务器已重新就绪');

  console.log('⑤ 等客户端自动重连 → room-not-found → giveUpRoom 干净退房…');
  /* socket.io 自动重连（指数退避）→ 重连后 D6 自动重回旧房 → 服务器回 room-not-found
   * → giveUpRoom：回加入页 + 徽标隐藏 + toast。给 45s（重连退避 + 重启窗口）。 */
  const backAtEntry = await waitJs(cdp, `!document.getElementById('roomPanel').classList.contains('hidden') ? 1 : 0`, 45000, '退回加入页');
  chk(!!backAtEntry, '客户端干净退回加入页（giveUpRoom 状态迁移）');
  const badgeGone = await cdp.evaluate(`document.getElementById('roomBadge').classList.contains('hidden') ? 1 : 0`).catch(() => 0);
  chk(!!badgeGone, '死房间徽标已摘（不再挂着过期房号）');
  const toastSeen = await cdp.evaluate(`(() => {
    const t = document.getElementById('toast');
    return t && !t.classList.contains('hidden') && /已不存在|不存在/.test(t.textContent) ? t.textContent.trim() : '';
  })()`).catch(() => '');
  chk(!!toastSeen, `toast 提示出现（非弹窗）：「${String(toastSeen).slice(0, 40)}」`);
  chk(dialogs.length === 0, `全程零原生弹窗（alert/confirm 计数 = ${dialogs.length}）`);
  await shot(cdp, 1);

  console.log('⑥ 原号续开：点「创建房间」重建同一个号（AI 记忆的恢复路径）…');
  /* giveUpRoom 已把原号填回输入框——直接点「创建房间」= create-room 带 roomNumber
   * 原号重建。断言：号没变（随机生成撞上原号的概率 1/10^6，同号=续开语义生效）。 */
  const inputVal = await cdp.evaluate(`document.getElementById('roomInput').value.trim()`);
  chk(inputVal === ROOM, `退房后输入框自动填回原号（"${inputVal}"）`);
  await cdp.evaluate(`(() => { document.getElementById('createBtn').click(); })()`);
  const sameBadge = await waitJs(cdp, `((el) => { const t = el.textContent || ''; return !el.classList.contains('hidden') && t.includes('${ROOM}') ? t : ''; })(document.getElementById('roomBadge'))`, 15000, '原号徽标回来');
  chk(!!sameBadge, `原号续开成功：房间号仍是 ${ROOM}`);
  const inRoomR = await waitJs(cdp, IN_ROOM, 8000, '续开在会');
  chk(!!inRoomR, '续开后在会（徽标可见、加入页隐藏）');
  // 服务器侧证据：临时库首个注册账号 = admin → /api/rooms 里该房的 resumed=true
  try {
    const { io: Client } = require('socket.io-client');
    const s = Client(SERVER, { transports: ['websocket'], reconnection: false });
    let token = '';
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('注册超时')), 10000);
      s.on('connect', () => {
        s.emit('auth-register', { username: 'reconn', password: 'ReConn#2026' }, (r) => {
          token = (r && r.data && r.data.token) || '';
          if (!token) { s.emit('auth-login', { username: 'reconn', password: 'ReConn#2026' }, (r2) => { token = (r2 && r2.data && r2.data.token) || ''; s.close(); resolve(); }); }
          else { s.close(); resolve(); }
        });
      });
      s.on('connect_error', (e) => { clearTimeout(t); reject(e); });
    });
    if (token) {
      const meta = await new Promise((resolve) => {
        require('http').get(`${SERVER}/api/rooms?token=${encodeURIComponent(token)}`, (r) => {
          let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { resolve(null); } });
        }).on('error', () => resolve(null));
      });
      const mine = meta && Array.isArray(meta.rooms) ? meta.rooms.find((x) => x.roomNumber === ROOM) : null;
      if (ledgerReady) {
        chk(!!mine && mine.resumed === true, `服务器识别为续会（resumed=true，createdAt=${mine ? new Date(mine.createdAt).toLocaleTimeString() : '?'}）`);
      } else {
        console.log('   ⏭ 跳过：账本没就绪（没有真语音输入），续会判据本次未验到');
      }
    } else {
      console.log('   ⚠️ 拿不到 admin token（resumed 断言跳过）');
    }
  } catch (e) { console.log(`   ⚠️ resumed 断言异常：${e.message}`); }
  await shot(cdp, 2);

  console.log('⑦ 离开后再开一个全新房间（旧行为不回归）…');
  await cdp.evaluate(`(() => { document.getElementById('leaveBtn').click(); })()`);
  await waitJs(cdp, `!document.getElementById('roomPanel').classList.contains('hidden') ? 1 : 0`, 10000, '回到加入页');
  await sleep(600);
  await cdp.evaluate(`(() => { const i = document.getElementById('roomInput'); if (i) i.value = ''; })()`);
  const roomText2 = await guestCreate(cdp);
  const ROOM2 = (String(roomText2).match(/\d{6}/) || [])[0];
  chk(!!ROOM2 && ROOM2 !== ROOM, `全新建房仍是随机新号：${ROOM2 || '(无)'}（≠ 旧号 ${ROOM}）`);
  const inRoom2 = await waitJs(cdp, IN_ROOM, 8000, '重新在会');
  chk(!!inRoom2, '重新在会（徽标可见、加入页隐藏）');
  await shot(cdp, 2);

  console.log(`\n████ E2E-RECONNECT 结果：${checks} 项检查，${issues} 项失败 ████`);
  process.exitCode = issues ? 1 : 0;
})().catch((e) => {
  console.error(`\n❌ E2E-RECONNECT 异常：${e.stack || e.message}`);
  process.exitCode = 1;
}).finally(async () => {
  for (const b of browsers) { try { b.kill(); } catch (e) { /* 已退 */ } }
  if (serverProc) {
    try { serverProc.kill(); } catch (e) { /* 已退 */ }
    await sleep(800);
    try { spawn('taskkill', ['/PID', String(serverProc.pid), '/T', '/F'], { windowsHide: true }); } catch (e) { /* 已退 */ }
  }
});
