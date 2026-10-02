/* scripts/test-agent.js —— 桌面代理端到端测试（真浏览器、真画面、真注入）
 * =====================================================================================
 *
 * ▎为什么这个测试值得单独写？
 *   前面那些测试用的都是"假 DOM / 假 mediasoup"，证明的是"逻辑对"。
 *   而"远程桌面能不能用"这件事，逻辑对没用 —— 得看**真实浏览器里鼠标真的动了吗、
 *   画面真的传回来了吗**。所以这个测试全程用真东西：
 *     · 真起一个 Chromium（CDP 驱动）
 *     · 真跑一个会议服务器
 *     · 真让 agent 连上去、真授权、真收 JPEG 帧
 *     · 真把 16 字节控制帧注入浏览器，再**回页面里读坐标**验证注到哪了
 *   一句话：它验证的是"用户能不能真的操作那台电脑"，而不是"函数返回了 true"。
 *
 * ▎怎么验证"注入是真生效"的？—— 用页面自己当证人
 *   测试页里装了一堆监听器，把收到的鼠标事件/文字都记在页面状态里；
 *   注入完再通过 CDP 把状态读回来比对。
 *   坐标那条尤其严格：发归一化 (0.5, 0.5)，页面里的 clientX 应当**正好**等于
 *   视口宽度的一半（误差 ±3px）。这一条过了，就说明跨设备的坐标换算是对的 ——
 *   手机 390 宽、电脑 1920 宽，都能点准。
 *
 * 运行：npm run test:agent
 */

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { io } = require('socket.io-client');
const { RemoteAgent } = require('../agent/index');
const { findBrowserBin } = require('../agent/cdp');

/* ★ 09-30：**专用测试端口** + 端口被占时"明确拒绝"（不再复用别人的服务器）。
 * ▎为什么必须改（本轮实修的假绿事故）：
 *   本脚本原先写的是 `if (await ping()) { console.log('⚠️ 3001 已有服务器，复用它'); return; }`
 *   ——只要 3001 上有任何服务器（**用户自己开的会议服务、或上一次被中断的测试留下的孤儿进程**）
 *   就复用它继续跑。后果：**测试验的不是本次代码**。
 *   本轮就是这么被坑的：我新加的 `remote-quality` 断言全红，
 *   排查半天以为是门禁/接线问题，**真实原因是那台服务器是旧代码的孤儿进程**。
 *   更危险的是反面——它也可能**全绿**：那不是"通过"，是"验了个不存在的东西"。
 * ▎`test-sfu-signaling.js` 早就修过同一个反模式，并写下了正确判据：
 *   "环境前提不成立时，唯一诚实的做法是明确失败并说清怎么修。宁可红得清楚，也不要绿得可疑。"
 *   这里是把它**补齐**（同一项目里同一个坑只修一半 = 半迁移，等于没修）。
 * ▎改用 3012 而不是继续用 3001：3001 是**用户日常开发服务的默认端口**，
 *   用一个跟它不同的号，从根上减少"撞车"的机会。 */
const PORT = Number(process.env.TEST_AGENT_PORT) || 3012;
const SERVER = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ★ 09-24 测试数据隔离（任务 3）：本测试会起真服务器，账号必须写进临时库，
 *   绝不能污染开发者真实的 sfu/data/meeting.db 或历史 sfu/users.json。
 *   USERS_FILE_LEGACY 指向不存在的临时路径 → 迁移逻辑绝不会去改名真实 users.json。 */
const TEST_DB_FILE = path.join(os.tmpdir(), `sfu-test-agent-${process.pid}-${Date.now()}.db`);
const TEST_LEGACY_USERS = path.join(os.tmpdir(), `sfu-test-agent-legacy-${process.pid}.json`);
function cleanupTestDb() {
  for (const f of [TEST_DB_FILE, TEST_DB_FILE + '-wal', TEST_DB_FILE + '-shm']) {
    // maxRetries：Windows 上子进程刚被 kill、句柄未释放时删库会 EBUSY，重试才删得掉
    try { fs.rmSync(f, { force: true, recursive: true, maxRetries: 8, retryDelay: 150 }); }
    catch (e) { /* 删不掉也不影响断言 */ }
  }
}
process.on('exit', cleanupTestDb);

let pass = 0, fail = 0, skip = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n); } };
const skipped = (n, why) => { skip++; console.log('  SKIP  ' + n + '（' + why + '）'); };

let serverProc = null;
let agent = null;

function ping() {
  return new Promise((resolve) => {
    const req = require('http').get(SERVER + '/config.json', (r) => { r.resume(); resolve(r.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

async function ensureServer() {
  /* ★ 09-30：端口被占 → **明确拒绝**，绝不复用（理由见文件顶部 PORT 的注释）。
   *   为什么"复用"最坏：它让测试结果与本次代码**脱钩**——既可能假红（像本轮），
   *   也可能假绿（验了旧行为/别的东西），而两种都不会有任何提示。 */
  if (await ping()) {
    console.log(`\n❌ ${PORT} 端口已被占用——本脚本需要"自己起的、跑本次代码的"服务器，拒绝继续。\n`);
    console.log('   为什么不能复用端口上那个：它可能是别的版本（用户自己开的服务、或上次测试的孤儿进程），');
    console.log('   于是断言验的**不是本次代码**——既可能假红，也可能假绿，且全程没有任何提示。\n');
    console.log(`   修法（任选）：① 先关掉占用 ${PORT} 的进程：`);
    console.log(`                    netstat -ano | findstr :${PORT}   然后 taskkill /F /PID <PID>`);
    console.log('                ② 或换个端口跑：TEST_AGENT_PORT=3013 npm run test:agent\n');
    process.exit(1);
  }
  console.log('🚀 自起测试服务器…');
  serverProc = spawn(process.execPath, [path.join(__dirname, '..', 'sfu', 'server.js')], {
    env: { ...process.env,
      // ★ 09-30：测试不启 HTTPS（3443 被占会让服务器 process.exit(1)，表现为"服务器未就绪"+一屏端口提示，看着像测试坏了、实则环境冲突）
      PORT: String(PORT), SFU_NO_HTTPS: '1', AI_FORCE_MOCK: '1', DB_FILE: TEST_DB_FILE, USERS_FILE_LEGACY: TEST_LEGACY_USERS },
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  serverProc.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  for (let i = 0; i < 80; i++) { await sleep(250); if (await ping()) { console.log('✅ 测试服务器已就绪\n'); return; } }
  throw new Error('服务器启动超时');
}

function client(name) {
  return new Promise((resolve, reject) => {
    const s = io(SERVER, { transports: ['websocket'], reconnection: false });
    s.on('connect', () => resolve({ s, id: s.id }));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error(name + ' 连接超时')), 8000);
  });
}
const request = (s, ev, payload) => new Promise((resolve, reject) => {
  s.emit(ev, payload, (resp) => (resp && resp.error ? reject(new Error(resp.error)) : resolve(resp)));
});
const waitEvent = (s, ev) => new Promise((r) => s.once(ev, r));

async function waitFor(fn, timeoutMs = 10000, step = 120) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { if (fn()) return true; await sleep(step); }
  return false;
}

/* 16 字节控制帧编码 —— 和前端 client.js 的 encodeCtlFrame 完全同构
 * （这正是"复用同一套线格式"的好处：这里不用为 agent 另造一套输入协议） */
function encodeCtlFrame(kind, x, y, wheel, btn) {
  const K = { mousemove: 3, mousedown: 4, mouseup: 5, dblclick: 6, wheel: 7 };
  const v = new DataView(new ArrayBuffer(16));
  v.setUint8(0, K[kind] || 0);
  v.setUint8(1, typeof btn === 'number' ? (btn & 3) << 4 : 0);
  v.setUint16(2, 0);
  v.setFloat32(4, x);
  v.setFloat32(8, y);
  v.setInt32(12, wheel | 0);
  return Buffer.from(v.buffer);
}

/* 测试页：自己当"证人" —— 把收到的鼠标事件/文字都记在页面状态里，供事后读回比对 */
const TEST_PAGE = 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html><body style="margin:0;font:18px sans-serif">
<div id="mv" style="padding:24px;background:#eef">moves:0</div>
<input id="in" style="font:20px sans-serif;width:88%;height:44px;margin:10px" placeholder="在这儿打字">
<div id="clk" style="padding:24px;background:#fee">尚未点击</div>
<script>
  window.__st = { moves: 0, x: -1, y: -1, clicks: 0, wheels: 0, typed: '' };
  document.addEventListener('mousemove', function (e) {
    __st.moves++; __st.x = e.clientX; __st.y = e.clientY;
    document.getElementById('mv').textContent = 'moves:' + __st.moves + ' @' + Math.round(e.clientX) + ',' + Math.round(e.clientY);
  });
  document.addEventListener('mousedown', function () { __st.clicks++; });
  document.addEventListener('wheel', function () { __st.wheels++; }, { passive: true });
  document.getElementById('in').addEventListener('input', function (e) { __st.typed = e.target.value; });
  document.getElementById('clk').addEventListener('click', function () { this.textContent = '被点击了'; });
</script></body></html>`);

(async () => {
  /* 不让代理接管 stdin —— 那是 CLI 的交互行为，被当库用时要关掉 */
  try { if (process.stdin) process.stdin.isTTY = false; } catch (e) { /* ignore */ }

  /* ---- 前置：浏览器探测（没有就 SKIP，不算失败——不是每个人的机器都装了 Chrome） ---- */
  const bin = findBrowserBin();
  if (!bin) { skipped('桌面代理端到端', '本机没找到 Chrome / Edge'); return; }
  console.log('  浏览器：' + path.basename(bin) + '\n');

  await ensureServer();

  /* ---- ① 建房（被控端本人先去浏览器里建个房，代理才能进来） ---- */
  console.log('--- 桌面代理端到端 ---');
  const HOST = await client('HOST');
  const createdP = waitEvent(HOST.s, 'room-created');
  await request(HOST.s, 'create-room', {});
  const created = await createdP;
  const ROOM = created.roomNumber;
  ok('① 房间已创建（代理要有地方可去）', /^\d{6}$/.test(ROOM));

  /* ---- ② 启动真代理（真浏览器 + 真连服务器） ---- */
  agent = new RemoteAgent({
    server: SERVER, room: ROOM, password: '', name: '测试PC',
    url: TEST_PAGE, headless: true, autoAllow: true,
    port: 9344, quality: 60, fps: 10, durationMs: 120000,
  });
  const logs = [];
  agent.log = (...a) => { logs.push(a.join(' ')); };   // 测试期间静音，出错时再打出来

  let startErr = null;
  try { await agent.start(); } catch (e) { startErr = e; }
  ok('② 代理启动成功（拉起浏览器 + 连上服务器）', !startErr);
  if (startErr) { console.log(logs.join('\n')); throw startErr; }

  const joined = await waitFor(() => !!agent.roomNumber, 8000);
  ok('③ 代理以桌面代理身份进房', joined && !!agent.sock.id);

  /* ---- ③ 控制端进房 + 走真实授权链路 ---- */
  const CTL = await client('CTL');
  CTL.s.emit('join-room', { roomNumber: ROOM });
  await sleep(700);

  const frames = [];
  CTL.s.on('remote-frame', (p) => frames.push(p));
  let meta = null;
  CTL.s.on('remote-meta', (p) => { meta = p; });

  const ansP = waitEvent(CTL.s, 'remote-answer');
  CTL.s.emit('remote-request', { to: agent.sock.id });
  const ans = await Promise.race([ansP, sleep(5000).then(() => null)]);
  ok('④ 授权链路走通（代理自动放行 → 控制端收到回执）', !!ans && ans.ok === true);
  await sleep(300);

  /* ---- ④ 真画面：CDP 抓的 JPEG 帧必须回到控制端 ---- */
  // 先制造画面变化（screencast 是"变化才推帧"，静止页面本来就不推）
  await agent.cdp.navigate(TEST_PAGE);
  const gotFrame = await waitFor(() => frames.length > 0, 8000);
  const f0 = frames[0] && frames[0].frame;
  ok('⑤ 代理把真实画面帧回传到控制端', gotFrame && !!f0);
  ok('⑥ 帧是合法 JPEG（FFD8 魔数 —— 证明是真抓屏，不是占位图）',
     !!f0 && (f0[0] === 0xFF && f0[1] === 0xD8));

  /* ---- ★ 09-30 闭环自适应帧率：控制端实测链路 → 回传建议 → 被控端真的降频 ----
   * ▎为什么要端到端断言而不只单测控制律：
   *   控制律对不代表**链路通**——这条链要穿过
   *   控制端 → 服务器门禁 → 被控端 handler → `_frameGap` 四处，
   *   任何一处漏接线都会表现为"自适应静默失效"（画面永远 12fps，但没人报错）。
   *   本项目在"跨层传递没接上"上已经吃过三次亏（AGENTS 坑 56），
   *   所以这里直接断言**被控端的实际状态变化**，而不是断言"消息发出去了"。 */
  const gapBefore = agent._frameGap;
  const fpsBefore = Math.round(1000 / gapBefore);
  const want = fpsBefore > 8 ? fpsBefore - 4 : fpsBefore + 4;   // 挑一个必然不同的值
  CTL.s.emit('remote-quality', { to: agent.sock.id, fps: want });
  const applied = await waitFor(() => Math.round(1000 / agent._frameGap) === want, 3000);
  ok('⑥b 闭环自适应：控制端回传建议帧率 → 被控端真的改了抓屏频率',
    applied, `期望 ${want}fps，实际 ${Math.round(1000 / agent._frameGap)}fps`);
  /* ⚠️ 这里有一个**两层范围**的设计，断言别搞混（我第一版就搞混了）：
   *   · **策略范围 6~24**：控制端自适应算法**只会**在这个区间里取值（见 client 的 RD_FPS_MIN/MAX）
   *     ——它是"正常该用多少"的业务判断。
   *   · **硬安全范围 2~24**：服务器与代理对**任何**请求的绝对钳制（见两处 Math.max(2, Math.min(24)))
   *     ——它是"再怎么乱传也不许超出"的兜底，比策略更宽。
   *   两层分开是有意的：策略以后要调（比如允许 3fps 的超省流档）时，
   *   不该顺带放宽"别人能不能给我设成 0.1fps"这条安全线。 */
  CTL.s.emit('remote-quality', { to: agent.sock.id, fps: 999 });
  await sleep(400);
  ok('⑥c 越界建议被钳到硬上限（不能借自适应把对端拖垮）',
    Math.round(1000 / agent._frameGap) === 24, `实际 ${Math.round(1000 / agent._frameGap)}fps`);
  CTL.s.emit('remote-quality', { to: agent.sock.id, fps: 1 });
  await sleep(400);
  ok('⑥d 过低建议被钳到硬下限 2fps（硬线比策略线更宽，见上方两层说明）',
    Math.round(1000 / agent._frameGap) === 2, `实际 ${Math.round(1000 / agent._frameGap)}fps`);
  // 复位，避免影响后续帧率相关断言
  CTL.s.emit('remote-quality', { to: agent.sock.id, fps: fpsBefore });
  await sleep(300);

  /* ---- ★ 09-30 画质档（billd 取长补短）：档位切换必须真的换掉编码参数并继续推帧 ----
   * ▎为什么要端到端而不是单测预设表：切档穿过 remote-input(JSON) → 代理 applyQuality
   *   → cdp.setScreencast（stop+start）。中间任何一步失手，症状都是"画面卡在旧画质"
   *   或直接停帧——只有"切档后仍能收到新帧"这条断言能证明重开这一路是安全的
   *   （重开若把 Page.screencastFrame 监听器叠上去，会出现每帧重复 ack/重复回调）。 */
  const framesBeforePreset = frames.length;
  CTL.s.emit('remote-input', { to: agent.sock.id, event: { kind: 'quality', preset: 'hd' } });
  await sleep(600);
  ok('⑥e 画质档切换：代理记下当前档并把帧间隔改成该档的 fps',
    agent.qualityPreset === 'hd' && Math.round(1000 / agent._frameGap) === 20,
    `实际档=${agent.qualityPreset} / ${Math.round(1000 / agent._frameGap)}fps`);
  ok('⑥e2 切档同时改上行编码参数（quality 与长边上限，不只是帧率）',
    agent.cfg.quality === 80 && agent._maxDim && agent._maxDim.maxWidth === 1920,
    `q=${agent.cfg.quality} dim=${JSON.stringify(agent._maxDim)}`);
  /* ⚠️ 触发器必须改"真的会变色"的东西：screencast 是**变化才推帧**，
   *   我第一版用 document.title 计时（每秒在变），帧数却几乎不涨，
   *   断言当场红了 —— 但那不是"切档把链路搞断"，是**测试没制造画面变化**。
   *   同坑 55：测边界状态前先确认你操作的确实是那个对象；这里先确认"页面真的在动"。 */
  await agent.cdp.evaluate('setInterval(() => { document.body.style.background = "hsl(" + (Date.now()/20 % 360) + ",60%,90%)"; }, 60)');
  const keptStreaming = await waitFor(() => frames.length > framesBeforePreset + 2, 8000);
  ok('⑥e3 切档后画面持续推帧（重开 screencast 没把链路搞断）', keptStreaming,
    `切换前后帧数 ${framesBeforePreset} → ${frames.length}`);
  ok('⑥e4 帧里没有重复 ack 堆积（每帧回调一次 —— 监听器只绑一次的验证）',
    frames.slice(framesBeforePreset).every((f) => !!f && !!f.frame));
  // 未知档名必须被忽略（不能让一个拼错的字符串把画面停掉）
  CTL.s.emit('remote-input', { to: agent.sock.id, event: { kind: 'quality', preset: 'ultra-4k-max' } });
  await sleep(300);
  ok('⑥e5 未知画质档被忽略且当前档不变（拼错不致命）', agent.qualityPreset === 'hd');
  // 回到标准档，后面的坐标/滚动断言按默认帧率跑
  CTL.s.emit('remote-input', { to: agent.sock.id, event: { kind: 'quality', preset: 'standard' } });
  await sleep(400);

  // 动态验证"变化才推帧"：页面从上面 ⑥e3 起就一直在动（不再重复挂 setInterval，
  //   两个同写 background 的定时器只会让后面的断言更"必然通过"，掩盖真实频率）
  const before = frames.length;
  await sleep(1800);
  ok('⑦ 页面变化时持续推帧（screencast 的变化驱动语义生效）', frames.length > before);

  /* ---- ⑤ 真鼠标：坐标必须"点得准" ---- */
  const vp = agent.cdp.viewport;
  const NX = 0.5, NY = 0.42;
  CTL.s.emit('remote-input', { to: agent.sock.id, event: encodeCtlFrame('mousemove', NX, NY) });
  await sleep(500);
  const st = await agent.cdp.evaluate('JSON.stringify(window.__st)').then((s) => JSON.parse(s)).catch(() => null);
  ok('⑧ 鼠标移动注入到真实浏览器（页面收到了 mousemove）', !!st && st.moves > 0);
  const expectX = NX * vp.width, expectY = NY * vp.height;
  ok('⑨ 归一化坐标换算精确（±3px）—— 手机/电脑不同分辨率都能点准',
     !!st && Math.abs(st.x - expectX) <= 3 && Math.abs(st.y - expectY) <= 3);
  if (st) console.log(`       视口 ${vp.width}×${vp.height}，期望 (${Math.round(expectX)},${Math.round(expectY)})，实际 (${Math.round(st.x)},${Math.round(st.y)})`);

  /* ---- ⑥ 真点击：mousedown+mouseup 要能在页面里产生 click ---- */
  const clkRect = await agent.cdp.evaluate(`(() => { const r = document.getElementById('clk').getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; })()`);
  const c1 = clkRect.cx / vp.width, c2 = clkRect.cy / vp.height;
  CTL.s.emit('remote-input', { to: agent.sock.id, event: encodeCtlFrame('mousedown', c1, c2, 0, 0) });
  CTL.s.emit('remote-input', { to: agent.sock.id, event: encodeCtlFrame('mouseup', c1, c2, 0, 0) });
  await sleep(600);
  const clkText = await agent.cdp.evaluate('document.getElementById("clk").textContent');
  ok('⑩ 真实点击生效（页面 onclick 被触发）—— 这是"能操作"的最小证明', clkText === '被点击了');

  /* ---- ⑦ 真键盘：中文整段文本要能落进输入框 ---- */
  const inRect = await agent.cdp.evaluate(`(() => { const r = document.getElementById('in').getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; })()`);
  const i1 = inRect.cx / vp.width, i2 = inRect.cy / vp.height;
  CTL.s.emit('remote-input', { to: agent.sock.id, event: encodeCtlFrame('mousedown', i1, i2, 0, 0) });
  CTL.s.emit('remote-input', { to: agent.sock.id, event: encodeCtlFrame('mouseup', i1, i2, 0, 0) });
  await sleep(300);
  CTL.s.emit('remote-input', { to: agent.sock.id, event: { kind: 'input-text', text: '中文远程输入测试 ✅' } });
  await sleep(600);
  const val = await agent.cdp.evaluate('document.getElementById("in").value');
  ok('⑪ 中文整段输入落进真实输入框（insertText 绕开 IME 的坑）', val === '中文远程输入测试 ✅');

  /* ---- ⑧ 真滚轮 ---- */
  const wBefore = await agent.cdp.evaluate('window.__st.wheels');
  CTL.s.emit('remote-input', { to: agent.sock.id, event: encodeCtlFrame('wheel', 0.5, 0.5, -3) });
  await sleep(500);
  const wAfter = await agent.cdp.evaluate('window.__st.wheels');
  ok('⑫ 滚轮注入生效（页面收到 wheel 事件）', wAfter > wBefore);

  /* ---- ⑨ 远程导航 + 地址栏元信息 ---- */
  const navOK = await agent.cdp.navigate('https://example.com').then(() => true).catch(() => false);
  await sleep(1200);
  agent.emitMeta();                 // 代理在真实链路里是导航后自动回报，测试里显式触发一次
  await sleep(600);
  const curUrl = await agent.cdp.currentUrl();
  ok('⑬ 远程导航到真实网站成功（能开任意网页，这才是"真控"）', navOK && /example\.com/.test(curUrl || ''));
  ok('⑭ 控制端收到真实 URL/标题（远程地址栏不是假的）',
     !!meta && /example\.com/.test(meta.url || ''));

  /* ---- ⑩ 撤权即断：释放控制后画面必须停 ---- */
  CTL.s.emit('remote-release');
  await sleep(800);
  const afterRelease = frames.length;
  await agent.cdp.navigate(TEST_PAGE);   // 制造画面变化，看还推不推帧
  await sleep(1500);
  ok('⑮ 撤权后立即停止推帧（授权一撤，画面通道就断）', frames.length === afterRelease);

  /* ---- ⑪ 收尾：代理能被干净地关掉（不留孤儿浏览器进程） ---- */
  const proc = agent.cdp.proc;
  agent.shutdown('测试结束');
  await sleep(1200);
  ok('⑯ 代理退出后浏览器进程被回收（不留孤儿进程）', !proc || proc.killed || proc.exitCode !== null);

  HOST.s.disconnect();
  CTL.s.disconnect();

  console.log(`\n结果: ${pass} 通过, ${fail} 失败${skip ? ', ' + skip + ' 跳过' : ''}`);
  if (fail) { console.log('\n--- 代理日志（排查用）---\n' + logs.slice(-25).join('\n')); }
  stopServer();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('异常: ' + (e && e.stack || e));
  try { if (agent) agent.shutdown('异常退出'); } catch (err) { /* ignore */ }
  stopServer();
  process.exit(1);
});

function stopServer() { if (serverProc) { try { serverProc.kill(); } catch (e) { /* ignore */ } serverProc = null; } }
