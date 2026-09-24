// SFU 版信令测试：模拟多个客户端连 sfu/server.js（端口 3001）
// 验证：房间/密码（复用）+ Router 能力 + Transport 创建/防重 + consume 的错误路径。
// （produce/consume 的真实媒体需要浏览器摄像头，无法命令行模拟——
//   这里能证明 mediasoup Worker/Router/Transport 在服务器端真的能建起来）
// 运行：npm run test:sfu
//   ★ 2026-09-23 补记：AI 操作员那组断言（09-19g）要等计划执行完，而默认步进
//     AI_OP_STEP_MS=600（7 步要 4.2s）—— 所以脚本必须让服务器跑在加速模式。
//   ★ 2026-09-24 重构：**脚本自己管服务器**（下面 ensureServer）。
//     起因是一次真实事故：手动起的服务器忘了带 AI_OP_STEP_MS，那组断言假失败，
//     排查了半天才发现"不是代码坏了，是环境没带对"。
//     教训：**回归脚本要能一条命令跑完，环境差异必须由脚本自己消除**——
//     否则"怎么跑"这件事会靠口口相传，迟早出错。
//     顺带把 AI 强制到确定性轨道（AI_FORCE_MOCK=1）：测试只测自己的代码，
//     不测外部 LLM 的网络速度（真 LLM 的连通性由 test:ai 那个专门轨道负责）。
const { io } = require('C:/Users/27418/Desktop/webrtc/node_modules/socket.io-client');
const { spawn } = require('child_process');
const nodePath = require('path');
const URL = 'http://localhost:3001';

/* ★ 09-24 测试数据隔离（任务 3）：本脚本会真注册账号，绝不能让它们落进
 *   开发者真实的 sfu/data/meeting.db 或历史 sfu/users.json。
 * ▎做法：把 DB_FILE 指到 os.tmpdir() 下的临时文件、并把 USERS_FILE_LEGACY 指到一个
 *   **不存在**的临时路径（这样迁移逻辑找不到旧文件，也就绝不会去改名真实的 users.json）。
 * ▎跑完删掉 db / wal / shm 三个文件。这是"测试不污染真实数据"的唯一可靠手段：
 *   靠"记得别用真库"这种纪律是守不住的，得让**默认行为就是隔离的**。 */
const os = require('os');
const fsClean = require('fs');
const TEST_DB_FILE = nodePath.join(os.tmpdir(), `sfu-test-sig-${process.pid}-${Date.now()}.db`);
const TEST_LEGACY_USERS = nodePath.join(os.tmpdir(), `sfu-test-sig-legacy-${process.pid}.json`); // 故意不存在
function cleanupTestDb() {
  for (const f of [TEST_DB_FILE, TEST_DB_FILE + '-wal', TEST_DB_FILE + '-shm']) {
    // ▎为什么要 maxRetries：Windows 上服务器子进程刚被 kill、句柄还没释放时删文件会 EBUSY，
    //   单次 rmSync 会静默失败（留下垃圾）。给几秒线性退避重试，才真的"跑完删干净"。
    try { fsClean.rmSync(f, { force: true, recursive: true, maxRetries: 8, retryDelay: 150 }); }
    catch (e) { /* 实在删不掉也不影响断言 */ }
  }
}
process.on('exit', cleanupTestDb);

/* ★ 09-24 C4：房间内令牌（room token）的测试工具。
 * ▎为什么要读服务器的 SECRET（sfu/data/room-secret）？
 *   "过期令牌 / 篡改 payload / 签名被改"这三条只靠真实令牌测不出来（真实令牌 24h 才过期）。
 *   拿到同一把密钥自己造令牌，是**唯一能可靠实测过期与篡改路径**的办法——不必等一天、
 *   也不必改系统时钟。这是测试对实现的"白盒"依赖，这里如实说明，不假装是纯黑盒。
 * ▎令牌算法（与 sfu/server.js 的 signRoomToken 完全一致）：
 *     base64url(JSON.stringify({room,iat,exp})) + "." + base64url(hmacSHA256(payloadB64, SECRET))
 */
const cryptoTest = require('crypto');
const ROOM_SECRET_FILE = nodePath.join(__dirname, '..', 'sfu', 'data', 'room-secret');
function loadRoomSecret() {
  try { return fsClean.readFileSync(ROOM_SECRET_FILE, 'utf8').trim(); } catch (e) { return null; }
}
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function forgeRoomToken(secret, payloadObj) {
  const payloadB64 = b64url(JSON.stringify(payloadObj));
  const sig = cryptoTest.createHmac('sha256', secret).update(payloadB64).digest();
  return payloadB64 + '.' + b64url(sig);
}
function forgeRecordingSig(secret, fileName, exp) {
  return cryptoTest.createHmac('sha256', secret).update(fileName + '|' + exp).digest('hex');
}

// ★ 09-24 G8：HTTP 接口已加管理员门禁 —— 本脚本的 HTTP 断言需要带 token。
//   取 token 的办法：临时库是全新的，所以**第一个注册的账号自动是管理员**（见 sfu/store.js）。
let adminToken = null;
// ★ 09-24 C4：房间令牌的密钥（运行期从 sfu/data/room-secret 读入，用来伪造过期/被篡改的令牌）
let roomSecret = null;

let serverProc = null;

function pingServer() {
  return new Promise((resolve) => {
    const req = require('http').get('http://localhost:3001/config.json', (r) => {
      r.resume();
      resolve(r.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

async function ensureServer() {
  if (await pingServer()) {
    console.log('⚠️  3001 端口已有服务器在跑 —— 本脚本直接用它。');
    console.log('   若那个服务器没带 AI_OP_STEP_MS=20 / AI_FORCE_MOCK=1，AI 那组断言可能假失败。');
    console.log('   ★ 09-24 G8 起还有一条：HTTP 门禁断言依赖"本脚本注册的测试账号是管理员"。');
    console.log('     若那个服务器用的是**已有管理员的正式库**，测试账号就只是普通用户，');
    console.log('     /api/rooms、/metrics 等断言会因 401 而失败——那不是代码坏了，是环境不对。');
    console.log('   想跑确定性回归：先把它关掉，让本脚本自己起一个（临时库 → 首个账号即管理员）。\n');
    return;
  }
  console.log('🚀 自起测试服务器（AI_OP_STEP_MS=20 加速 + AI_FORCE_MOCK=1 确定性轨道）…');
  serverProc = spawn(process.execPath, [nodePath.join(__dirname, '..', 'sfu', 'server.js')], {
    env: {
      ...process.env,
      AI_OP_STEP_MS: '20',
      AI_FORCE_MOCK: '1',
      DB_FILE: TEST_DB_FILE,               // ★ 任务 3：账号写进临时库，不碰真实数据
      USERS_FILE_LEGACY: TEST_LEGACY_USERS, // ★ 指向不存在的路径 → 绝不迁移/改名真实 users.json
    },
    cwd: nodePath.join(__dirname, '..'),
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  serverProc.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await pingServer()) { console.log('✅ 测试服务器已就绪\n'); return; }
  }
  throw new Error('测试服务器启动超时（看上面 [server] 输出）');
}

function stopServer() { if (serverProc) { try { serverProc.kill(); } catch (e) { /* ignore */ } serverProc = null; } }

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n); } };

function client(name) {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ['websocket'], reconnection: false });
    s.on('connect', () => resolve({ s, id: s.id }));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error(name + ' timeout')), 8000);
  });
}
const waitEvent = (s, ev) => new Promise(r => s.once(ev, r));
let authTtlMs = Infinity; // G6：TTL 在主 IIFE 里拉取（CJS 不能顶层 await）
// socket.io 请求-应答：emit(事件, 载荷, 回调)，回调收到 { data } 或 { error }
const request = (s, ev, payload) => new Promise((resolve, reject) => {
  s.emit(ev, payload, (resp) => resp && resp.error ? reject(new Error(resp.error)) : resolve(resp));
});

(async () => {
  await ensureServer();   // ★ 09-24：一条命令跑完全套，环境差异由脚本自己抹平
  roomSecret = loadRoomSecret(); // ★ 09-24 C4：读服务器房间令牌密钥（造过期/篡改令牌用）
  // G6：读服务器 token TTL（决定过期路径断言是否实测）
  try {
    const cfgBody = await new Promise((resolve, reject) => {
      require('http').get('http://localhost:3001/config.json', (r) => {
        let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => resolve(b));
      }).on('error', reject);
    });
    authTtlMs = (JSON.parse(cfgBody).authTtlMs) || Infinity;
  } catch (e) { /* 拉不到按默认跳过 */ }

  /* ★ 09-24 G8：先弄到一个管理员 token（HTTP 门禁断言的前置条件）。
   * ▎临时库是全新的 → 第一个注册的账号被 store 自动设为 admin。 */
  {
    const admUser = `adm_${Math.random().toString(36).slice(2, 8)}`;
    const adm = await client('ADMIN');
    const reg = await request(adm.s, 'auth-register', { username: admUser, password: 'secret0', displayName: '管理员' });
    adminToken = reg.data.token;
    try { adm.s.close(); } catch (e) { /* ignore */ }
    // 自证：这个 token 确实能过门禁（否则后面的 HTTP 断言会以"全 401"的形式假失败）
    const probe = await new Promise((resolve) => {
      require('http').get('http://localhost:3001/api/rooms',
        { headers: { Authorization: 'Bearer ' + adminToken } },
        (r) => { r.resume(); resolve(r.statusCode); }).on('error', () => resolve(0));
    });
    ok('09-24 G8 管理员 token 可过 HTTP 门禁（/api/rooms 200）', probe === 200);
  }

  const A = await client('A');

  // --- A 创建房间：拿到号（同时验证 ack 应答）---
  const aCreatedP = waitEvent(A.s, 'room-created');
  const aMembersP = waitEvent(A.s, 'room-members');
  const ack = await request(A.s, 'create-room', {});
  ok('A 创建房间 ack 应答 { roomNumber }', /^\d{6}$/.test((ack.data || {}).roomNumber || ''));
  const created = await aCreatedP;
  ok('A 收到 room-created（6 位房间号）', /^\d{6}$/.test(created.roomNumber));
  const aMembers = await aMembersP; // 等 A 进房完成（Router 已建好）
  const ROOM = created.roomNumber;
  /* ★ 09-24 C4 断言①：进房载荷里**确实带** roomToken（格式 xxx.yyy、非空）。
   *   A 全程没注册/没登录 = 游客 → 它的令牌就是"游客自己的房间内令牌"，
   *   后面游客归档/回读两条正向断言都用它（证明令牌机制没有把游客路径打死）。 */
  const A_ROOM_TOKEN = (aMembers && aMembers.roomToken) || '';
  ok('09-24 C4 进房载荷 room-members 带本人 roomToken（游客也有，格式 xxx.yyy）',
     typeof A_ROOM_TOKEN === 'string' && /^[\w-]+\.[\w-]+$/.test(A_ROOM_TOKEN));
  ok('09-24 C4 创建房间 ack 也带 roomToken（不依赖是否接住 room-members 事件）',
     /^[\w-]+\.[\w-]+$/.test(String((ack.data || {}).roomToken || '')));

  // --- A 问 Router 能力 ---
  const caps = await request(A.s, 'get-router-rtp-capabilities', {});
  ok('get-router-rtp-capabilities 返回能力清单',
     !!(caps.data && caps.data.rtpCapabilities && caps.data.rtpCapabilities.codecs.length > 0));

  // --- A 创建 发送/接收 两条 Transport ---
  const sendT = (await request(A.s, 'create-webrtc-transport', { direction: 'send' })).data;
  const recvT = (await request(A.s, 'create-webrtc-transport', { direction: 'recv' })).data;
  ok('create-webrtc-transport(send) 返回完整连接参数',
     !!(sendT.transportId && sendT.iceParameters && sendT.iceCandidates && sendT.dtlsParameters));
  ok('create-webrtc-transport(recv) 与 send 是不同的 Transport',
     sendT.transportId !== recvT.transportId);

  // --- 防重：同一方向不能建第二条 ---
  let dupErr = null;
  try { await request(A.s, 'create-webrtc-transport', { direction: 'send' }); }
  catch (e) { dupErr = e.message; }
  ok('重复创建 send Transport 被拒', !!dupErr && /已存在/.test(dupErr));

  // --- consume 一个不存在的 Producer → 服务器报错（canConsume 拒绝）---
  let consumeErr = null;
  try {
    await request(A.s, 'consume', {
      transportId: recvT.transportId,
      producerId: 'fake-producer-id',
      rtpCapabilities: caps.data.rtpCapabilities,
    });
  } catch (e) { consumeErr = e.message; }
  ok('consume 不存在的 Producer 被拒（错误路径正确）', !!consumeErr);

  // --- 入会密码（复用 Mesh 版逻辑）---
  const B = await client('B');
  const bCreatedP = waitEvent(B.s, 'room-created');
  const bMembersP = waitEvent(B.s, 'room-members');
  await request(B.s, 'create-room', { password: '6666' });
  const bCreated = await bCreatedP;
  await bMembersP;
  const PRO_ROOM = bCreated.roomNumber;

  const C = await client('C');
  const cWrongP = waitEvent(C.s, 'room-wrong-password');
  C.s.emit('join-room', { roomNumber: PRO_ROOM, password: '0000' });
  ok('带密码房间 + 错误密码 → room-wrong-password', (await cWrongP).roomNumber === PRO_ROOM);

  const cOkP = waitEvent(C.s, 'room-members');
  C.s.emit('join-room', { roomNumber: PRO_ROOM, password: '6666' });
  const cMembers = await cOkP;
  ok('正确密码加入成功：room-members 老成员只有 B',
     cMembers.members.length === 1 && cMembers.members[0].id === B.id);

  // --- C 也能拿到该房间 Router 能力（Router 是每房间一个）---
  const caps2 = await request(C.s, 'get-router-rtp-capabilities', {});
  ok('另一个房间成员也能拿到 Router 能力', !!(caps2.data && caps2.data.rtpCapabilities));

  // --- 不存在的房间号 → room-not-found（用新客户端 D：C 已在房里，再 join 会被守卫拦下）---
  const D = await client('D');
  const dNfP = waitEvent(D.s, 'room-not-found');
  D.s.emit('join-room', { roomNumber: '000000' });
  ok('不存在的房间 → room-not-found', (await dNfP).roomNumber === '000000');

  // --- 远程协助（A1）：申请/授权/互斥/输入门禁/断开清理 ---
  const E = await client('E');
  const eMembersP = waitEvent(E.s, 'room-members');
  E.s.emit('join-room', { roomNumber: ROOM });
  await eMembersP; // E 进房完成（ROOM 是 A 创建的房间）

  // ① 房间外的人（D 没进过房）申请控制 → 服务器直接忽略，E 不应收到任何请求
  let eGotRequest = false;
  E.s.on('remote-request', () => { eGotRequest = true; });
  D.s.emit('remote-request', { to: E.id });
  await new Promise((r) => setTimeout(r, 300));
  ok('房间外的人申请控制被忽略', !eGotRequest);

  // ② E 申请控制 A → A 收到 remote-request { from: E }
  const aReqP = waitEvent(A.s, 'remote-request');
  E.s.emit('remote-request', { to: A.id });
  ok('成员申请控制 → 被控端收到 remote-request', (await aReqP).from === E.id);

  // ③ A 允许 → E 收到 ok 回执 + 全房广播 remote-state
  const eAnsP = waitEvent(E.s, 'remote-answer');
  const eStateP = waitEvent(E.s, 'remote-state');
  A.s.emit('remote-answer', { to: E.id, ok: true });
  const eAns = await eAnsP;
  ok('授权成功 → 控制端收到 remote-answer { ok:true }', eAns.ok === true && eAns.from === A.id);
  const eState = await eStateP;
  ok('授权成功 → 全房广播 remote-state（hostId=A，controllerId=E）',
     eState.hostId === A.id && eState.controllerId === E.id);

  // ④ 已有人在控 → 第 2 人（F）申请 → busy
  const F = await client('F');
  const fMembersP = waitEvent(F.s, 'room-members');
  F.s.emit('join-room', { roomNumber: ROOM });
  await fMembersP;
  const fBusyP = waitEvent(F.s, 'remote-answer');
  F.s.emit('remote-request', { to: A.id });
  const fBusy = await fBusyP;
  ok('有人在被控时他人申请 → busy', fBusy.ok === false && fBusy.reason === 'busy');

  // ⑤ remote-input 门禁：在册控制端 E → 定向转发到 A
  const aInputP = waitEvent(A.s, 'remote-input');
  E.s.emit('remote-input', { to: A.id, event: { type: 'input', kind: 'mousemove', x: 0.5, y: 0.5 } });
  const aInput = await aInputP;
  ok('在册控制端的 remote-input 被定向转发', !!(aInput.event && aInput.event.kind === 'mousemove'));

  // ⑤b A5①+A2：二进制帧 / 中文文本 都能穿过服务器（event 原样透传）
  //   二进制 16 字节帧到服务器会变 Node Buffer——曾被"字段数≤12"过滤误杀
  //   （Object.keys(Buffer) 数出 16 个下标），此断言防止回归。
  const aBinP = waitEvent(A.s, 'remote-input');
  const frame = new ArrayBuffer(16);
  const dv = new DataView(frame);
  dv.setUint8(0, 3);          // kind=mousemove
  dv.setFloat32(4, 0.25);     // x
  E.s.emit('remote-input', { to: A.id, event: frame });
  const aBin = await aBinP;
  // 读回时的坑：Node 端 socket.io 把二进制还原成 Buffer，而 Buffer 可能是
  // 共享内存池（8KB pool）上的视图——直接拿 event.buffer 建 DataView 会读到
  // 池里相邻数据。必须按 byteOffset/byteLength 取出字节再拷贝成独立副本。
  const raw = aBin.event;
  const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw)
    : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  const copy = new Uint8Array(bytes.length); // 拷出共享池的独立副本
  copy.set(bytes);
  ok('remote-input 携带 16 字节二进制帧原样透传（A5①）',
     bytes.length === 16 && copy[0] === 3 &&
     new DataView(copy.buffer).getFloat32(4) === 0.25);
  const aTxtP = waitEvent(A.s, 'remote-input');
  E.s.emit('remote-input', { to: A.id, event: { type: 'input', kind: 'input-text', text: '你好世界' } });
  const aTxt = await aTxtP;
  ok('remote-input 携带中文整段文本透传（A2）', !!(aTxt.event && aTxt.event.kind === 'input-text' && aTxt.event.text === '你好世界'));

  // ⑥ 非在册成员 F 冒发 remote-input → 服务器门禁拦截，A 不应收到
  let aGotFake = false;
  A.s.on('remote-input', () => { aGotFake = true; });
  F.s.emit('remote-input', { to: A.id, event: { type: 'input', kind: 'click', x: 0.1, y: 0.1 } });
  await new Promise((r) => setTimeout(r, 300));
  ok('非在册成员冒发 remote-input 被门禁拦截', !aGotFake);

  // ⑦ 控制端断开 → 自动清表 + 全房广播复位
  const fResetP = waitEvent(F.s, 'remote-state');
  E.s.disconnect();
  const fReset = await fResetP;
  ok('控制端断开 → remote-state 复位广播', fReset.hostId === null && fReset.controllerId === null);

  /* ════════════════════════════════════════════════════════════════
   * ★ 2026-09-11 升级（A3/A4/A6 + D1/D4）新增断言
   * ════════════════════════════════════════════════════════════════ */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // --- D4①：member-state 上报 → 全房 room-state 快照（含房主标记）---
  // 注意：上面 E 断开时服务器也广播过一次 room-state，可能还在路上——
  // 所以这里用"等到快照里真的出现我上报的状态"的过滤式等待，而不是裸 once（防误吃旧快照）
  const fStateP = new Promise((res) => {
    const h = (p) => {
      const row = p.members.find((m) => m.id === F.id);
      if (row && row.muted === true && row.camOff === true && row.sharing === true) {
        F.s.off('room-state', h);
        res(p);
      }
    };
    F.s.on('room-state', h);
  });
  F.s.emit('member-state', { patch: { muted: true, camOff: true, sharing: true, evil: 'ignored' } });
  const fState = await fStateP;
  const fRow = fState.members.find((m) => m.id === F.id);
  ok('D4 member-state 上报 → room-state 快照带上 muted/camOff/sharing',
     !!(fRow && fRow.muted === true && fRow.camOff === true && fRow.sharing === true));
  ok('D4 room-state 白名单过滤（未定义字段 evil 被忽略）', !(fRow && 'evil' in fRow));
  ok('D4 room-state 标出房主（A = owner）',
     !!fState.members.find((m) => m.id === A.id && m.owner === true));

  // --- D4②：非房主踢人 → 被拒 ---
  const fDeniedP = waitEvent(F.s, 'kick-denied');
  F.s.emit('kick-member', { to: A.id });
  const fDenied = await fDeniedP;
  ok('D4 非房主踢人被拒（kick-denied / not-owner）', fDenied.reason === 'not-owner');

  // --- D4③：房主踢人 → 被踢者收到 kicked 且连接被断开 ---
  const G = await client('G');
  const gMembersP = waitEvent(G.s, 'room-members');
  G.s.emit('join-room', { roomNumber: ROOM });
  await gMembersP;
  const gKickedP = waitEvent(G.s, 'kicked');
  A.s.emit('kick-member', { to: G.id });
  const gKicked = await gKickedP;
  ok('D4 房主踢人 → 被踢者收到 kicked { by }', gKicked.by === A.id && gKicked.reason === 'owner-kick');
  await sleep(400);
  ok('D4 被踢者的连接已被服务器断开', G.s.disconnected === true);

  // --- 重新建立一对控制关系（F 控 A），用于验证 A3 剪贴板门禁 ---
  const fReq2P = waitEvent(A.s, 'remote-request');
  F.s.emit('remote-request', { to: A.id });
  await fReq2P;
  const fAnsOkP = waitEvent(F.s, 'remote-answer');
  A.s.emit('remote-answer', { to: F.id, ok: true });   // 不限时
  const fAnsOk = await fAnsOkP;
  ok('重新授权成功且不带 expiresAt（不限时）', fAnsOk.ok === true && !fAnsOk.expiresAt);

  // --- A3①：控制端 → 被控端 剪贴板同步 ---
  const aClipP = waitEvent(A.s, 'clipboard-sync');
  F.s.emit('clipboard-sync', { to: A.id, text: '你好，剪贴板', dir: 'ctl2host' });
  const aClip = await aClipP;
  ok('A3 控制端→被控端剪贴板同步被转发（含 dir 与中文）',
     aClip.text === '你好，剪贴板' && aClip.dir === 'ctl2host' && aClip.from === F.id);

  // --- A3②：被控端 → 控制端 反向同步 ---
  const fClipP = waitEvent(F.s, 'clipboard-sync');
  A.s.emit('clipboard-sync', { to: F.id, text: 'host-side-text', dir: 'host2ctl' });
  const fClip = await fClipP;
  ok('A3 被控端→控制端反向剪贴板同步被转发', fClip.text === 'host-side-text' && fClip.dir === 'host2ctl');

  // --- A3③：不在控制关系里的成员冒发 → 门禁丢弃 ---
  const H = await client('H');
  const hMembersP = waitEvent(H.s, 'room-members');
  H.s.emit('join-room', { roomNumber: ROOM });
  await hMembersP;
  let aGotClip = false;
  A.s.on('clipboard-sync', () => { aGotClip = true; });
  H.s.emit('clipboard-sync', { to: A.id, text: 'spam-from-outsider' });
  await sleep(300);
  ok('A3 控制关系之外的剪贴板同步被门禁丢弃', !aGotClip);

  // --- A4①：file-offer / file-answer 定向转发 ---
  const aOfferP = waitEvent(A.s, 'file-offer');
  H.s.emit('file-offer', { to: A.id, fileId: 'f-test-1', name: 'demo.txt', size: 8, mime: 'text/plain' });
  const aOffer = await aOfferP;
  ok('A4 file-offer 定向转发（带名字/大小/类型）',
     aOffer.name === 'demo.txt' && aOffer.size === 8 && aOffer.from === H.id);
  const hAnsP = waitEvent(H.s, 'file-answer');
  A.s.emit('file-answer', { to: H.id, fileId: 'f-test-1', ok: true });
  ok('A4 file-answer 定向转发（接受）', (await hAnsP).ok === true);

  // --- A4②：二进制分块原样转发（8 字节 "abcdefgh"）---
  const aChunkP = waitEvent(A.s, 'file-chunk');
  H.s.emit('file-chunk', { to: A.id, fileId: 'f-test-1', seq: 0, data: new TextEncoder().encode('abcdefgh').buffer });
  const aChunk = await aChunkP;
  const chunkBytes = aChunk.data instanceof ArrayBuffer ? new Uint8Array(aChunk.data)
    : new Uint8Array(aChunk.data.buffer, aChunk.data.byteOffset, aChunk.data.byteLength);
  ok('A4 file-chunk 二进制块原样转发（首字节 = 97 "a"）',
     chunkBytes.length === 8 && chunkBytes[0] === 97 && aChunk.seq === 0);

  // --- A4③：file-end 带上服务器记账的字节数 ---
  const aEndP = waitEvent(A.s, 'file-end');
  H.s.emit('file-end', { to: A.id, fileId: 'f-test-1' });
  const aEnd = await aEndP;
  ok('A4 file-end 带上服务器台账记账的字节数（received=8）', aEnd.received === 8);

  // --- A4④：配额校验 —— 申报 4 字节却发 8 字节 → 服务器掐断并通知双方 ---
  const aOfferQ = waitEvent(A.s, 'file-offer');
  H.s.emit('file-offer', { to: A.id, fileId: 'f-quota', name: 'big.bin', size: 4, mime: 'application/octet-stream' });
  await aOfferQ;
  const aAbortP = waitEvent(A.s, 'file-abort');
  H.s.emit('file-chunk', { to: A.id, fileId: 'f-quota', seq: 0, data: new Uint8Array(8).buffer });
  const aAbort = await aAbortP;
  ok('A4 超申报大小 → 服务器配额校验掐断（接收方收到 file-abort）',
     aAbort.reason === 'quota-exceeded');

  /* ════════════════════════════════════════════════════════════════
   * ★ 2026-09-12 D+1 升级（SFU 数据通道）新增断言
   * ▎命令行验不了浏览器 SCTP 收发，但能验：SCTP 真的被开起来了、
   *   produce-data/consume-data 的账本与广播、错误路径。
   * ════════════════════════════════════════════════════════════════ */

  // --- D+1①：Transport 应答里带 sctpParameters（开了 enableSctp 的证据）---
  ok('D+1 create-webrtc-transport 应答带 sctpParameters（SCTP 已开启）',
     !!sendT.sctpParameters);

  // --- D+1②：produce-data → dataProducerId + 广播 new-data-producer 给房里其他人 ---
  //   E 已断开（上面 ⑦），用 F/H：H 在房里，F 在房里——让 F 开频道，H 应收到广播
  const hNewDpP = waitEvent(H.s, 'new-data-producer');
  const produceDataAck = await request(F.s, 'produce-data', {
    transportId: (await request(F.s, 'create-webrtc-transport', { direction: 'send' })).data.transportId,
    sctpStreamParameters: { streamId: 0, ordered: true },
    label: 'chat',
  });
  ok('D+1 produce-data 应答 { dataProducerId }',
     typeof (produceDataAck.data || {}).dataProducerId === 'string');
  const hNewDp = await hNewDpP;
  ok('D+1 new-data-producer 广播给房里其他人（label=chat）',
     hNewDp.dataProducerId === produceDataAck.data.dataProducerId &&
     hNewDp.from === F.id && hNewDp.label === 'chat');

  // --- D+1③：缺 sctpStreamParameters 被拒（浏览器必须带 SCTP 流参数）---
  let dpErr = null;
  try { await request(F.s, 'produce-data', { transportId: 'transport-x' }); }
  catch (e) { dpErr = e.message; }
  ok('D+1 produce-data 缺参数/错通道被拒（错误路径正确）', !!dpErr);

  // --- D+1④：consume-data → DataConsumer 参数 + 订阅不存在的频道走错误应答 ---
  const hRecvT = (await request(H.s, 'create-webrtc-transport', { direction: 'recv' })).data;
  const consumeDataAck = await request(H.s, 'consume-data', {
    transportId: hRecvT.transportId,
    dataProducerId: produceDataAck.data.dataProducerId,
  });
  ok('D+1 consume-data 应答带 dataConsumerId + sctpStreamParameters',
     typeof (consumeDataAck.data || {}).dataConsumerId === 'string' &&
     !!(consumeDataAck.data || {}).sctpStreamParameters);
  let cdErr = null;
  try { await request(H.s, 'consume-data', { transportId: hRecvT.transportId, dataProducerId: 'fake-dp' }); }
  catch (e) { cdErr = e.message; }
  ok('D+1 consume-data 不存在的频道被拒（错误路径正确）', !!cdErr);

  // --- D+1⑤：room-members 给新人的清单里包含老成员的数据通道 ---
  const I = await client('I');
  const iMembersP = waitEvent(I.s, 'room-members');
  I.s.emit('join-room', { roomNumber: ROOM });
  const iMembers = await iMembersP;
  const fRowDp = iMembers.members.find((m) => m.id === F.id);
  ok('D+1 room-members 清单包含老成员的 dataProducers',
     !!fRowDp && Array.isArray(fRowDp.dataProducers) &&
     fRowDp.dataProducers.some((d) => d.dataProducerId === produceDataAck.data.dataProducerId));

  // --- D+1⑥：close-data-producer → 广播 data-producer-closed ---
  const hDpClosedP = waitEvent(H.s, 'data-producer-closed');
  await request(F.s, 'close-data-producer', { dataProducerId: produceDataAck.data.dataProducerId });
  const hDpClosed = await hDpClosedP;
  ok('D+1 close-data-producer → data-producer-closed 广播',
     hDpClosed.dataProducerId === produceDataAck.data.dataProducerId && hDpClosed.from === F.id);

  // --- D+1⑦：聊天信令透传 msgId（双发去重的前 half）---
  const hChatP = waitEvent(H.s, 'chat-message');
  F.s.emit('chat-message', { text: '带去重号的聊天', msgId: 'msg-dedup-1' });
  const hChat = await hChatP;
  ok('D+1 chat-message 透传 msgId（前端双发去重依据）',
     hChat.msgId === 'msg-dedup-1' && hChat.from === F.id);

  // --- ★ 09-13：举手（member-state 白名单新增 hand 字段）---
  const fHandP = new Promise((res) => {
    const h = (p) => {
      const row = p.members.find((m) => m.id === F.id);
      if (row && row.hand === true) { F.s.off('room-state', h); res(p); }
    };
    F.s.on('room-state', h);
  });
  F.s.emit('member-state', { patch: { hand: true, evil2: 'x' } });
  const fHandState = await fHandP;
  const fHandRow = fHandState.members.find((m) => m.id === F.id);
  ok('09-13 member-state 上报 hand → room-state 带 ✋（白名单仍过滤任意字段）',
     !!fHandRow && fHandRow.hand === true && !('evil2' in fHandRow));

  // --- ★ 09-17b：实时字幕开关（member-state 白名单新增 caption 字段）---
  const fCapP = new Promise((res) => {
    const h = (p) => {
      const row = p.members.find((m) => m.id === F.id);
      if (row && row.caption === true) { F.s.off('room-state', h); res(p); }
    };
    F.s.on('room-state', h);
  });
  F.s.emit('member-state', { patch: { caption: true, evil3: 'x' } });
  const fCapState = await fCapP;
  const fCapRow = fCapState.members.find((m) => m.id === F.id);
  ok('09-17b member-state 上报 caption → room-state 带 💬（白名单仍过滤任意字段）',
     !!fCapRow && fCapRow.caption === true && !('evil3' in fCapRow));

  // --- ★ 09-13：/api/rooms 观测接口 + /dashboard 面板页（HTTP 层验证）---
  const http = require('http');
  const getCode = (path, headers) => new Promise((resolve, reject) => {
    http.get({ hostname: 'localhost', port: 3001, path, headers: headers || {} },
      (r) => { r.resume(); resolve(r.statusCode); }).on('error', reject);
  });
  // ★ 09-24 G8：受保护接口不带 token 必须 401（门禁真的在拦，而不是形同虚设）
  ok('09-24 G8 /api/rooms 不带 token → 401', (await getCode('/api/rooms')) === 401);
  ok('09-24 G8 /metrics 不带 token → 401', (await getCode('/metrics')) === 401);
  ok('09-24 G8 /api/rooms?token=<admin> 查询串兜底可过 → 200',
     (await getCode(`/api/rooms?token=${encodeURIComponent(adminToken)}`)) === 200);
  const apiBody = await new Promise((resolve, reject) => {
    http.get({ hostname: 'localhost', port: 3001, path: '/api/rooms',
      headers: { Authorization: 'Bearer ' + adminToken } }, (r) => {
      let b = '';
      r.on('data', (c) => (b += c));
      r.on('end', () => resolve(b));
    }).on('error', reject);
  });
  const api = JSON.parse(apiBody);
  const roomSnap = api.rooms.find((r) => r.roomNumber === ROOM);
  ok('09-13 /api/rooms 返回观测快照（成员/媒体/计数/Worker PID 齐全）',
     !!roomSnap && Array.isArray(roomSnap.members) && Array.isArray(roomSnap.media) &&
     !!roomSnap.counts && typeof api.worker.pid === 'number');
  /* ★ 09-24 C4 断言⑦：roomToken 绝不泄露给"别人"。三处都要查——
   *   ① 管理员拉的全景快照 /api/rooms 的 JSON 原文里不出现 roomToken；
   *   ② 全房广播的成员快照 room-state 里每个成员行没有 roomToken 字段；
   *   ③ room-members 里给新人的 others 列表同样没有（令牌只在"单播给自己"的顶层字段）。 */
  ok('09-24 C4 /api/rooms 快照里不出现 roomToken（不泄露任何人的令牌）',
     !/roomToken/.test(apiBody));
  const leakStateP = waitEvent(A.s, 'room-state');
  A.s.emit('member-state', { patch: {} }); // 触发一次 room-state 广播（空 patch 也走白名单 + 广播）
  const leakState = await Promise.race([leakStateP, sleep(1000).then(() => null)]);
  ok('09-24 C4 room-state 广播的成员列表不含 roomToken',
     !!leakState && Array.isArray(leakState.members)
     && leakState.members.every((mm) => !('roomToken' in mm)));
  ok('09-24 C4 room-members 的 others 成员列表不含 roomToken',
     !!aMembers && Array.isArray(aMembers.members)
     && aMembers.members.every((mm) => !('roomToken' in mm)));
  // /dashboard 页面本身**不设门禁**（否则页面都打不开、没法提示"去登录"）——必须保持 200
  ok('09-13 /dashboard 面板页可访问（200，页面本身不设门禁）', (await getCode('/dashboard')) === 200);

  /* ★ 09-24 G8 复审 + ★ 09-24 C4 本轮：门禁的**边界**与**新语义**都必须断言。
   * ▎C4 之前：内容类（captions/minutes/recordings 单文件）是"能力=房间号"→ 不带 token 也 200/404。
   * ▎C4 之后：内容类一律要"房间内令牌"（或 admin token）——**不带令牌必须 401**。
   *   注意：这里问的 token 是**管理员 token**；房间内令牌是另一套（见下面第②③④⑤⑥条）。
   * ▎该拦的必须拦、该放的必须放：观测类仍走 admin；内容类换房间令牌。 */
  ok('09-24 G8 观测类 /api/recordings 不带 token → 401（跨房录像清单属观测信息）',
     (await getCode('/api/recordings')) === 401);
  ok('09-24 C4 内容类 /api/captions 不带任何令牌 → 401（无房间令牌必须被拦）',
     (await getCode(`/api/captions?room=${ROOM}`)) === 401);
  ok('09-24 C4 内容类 /api/minutes 不带任何令牌 → 401',
     (await getCode(`/api/minutes?room=${ROOM}`)) === 401);
  ok('09-24 C4 内容类 /minutes/<房>/<文件> 不带任何令牌 → 401',
     (await getCode(`/minutes/${ROOM}/nope.md`)) === 401);
  ok('09-24 C4 录像 /recordings/<文件> 不带任何令牌 → 401（admin 或签名 URL 才放行）',
     (await getCode('/recordings/nope.webm')) === 401);

  /* ★ 09-24 C4 断言②③④⑤⑥：房间内令牌的正/反向用例。
   *   OTHER_ROOM = 与本房不同的另一个 6 位号（守住"令牌只对签发它的房间有效"）。 */
  const OTHER_ROOM = String((Number(ROOM) + 1) % 1000000).padStart(6, '0');
  ok('09-24 C4 带 X-Room-Token 可过门禁（/api/captions?room=<本房> → 200）',
     (await getCode(`/api/captions?room=${ROOM}`, { 'X-Room-Token': A_ROOM_TOKEN })) === 200);
  ok('09-24 C4 跨房不行：拿 A 房令牌请求 B 房 captions → 401（令牌只对签发房间有效）',
     (await getCode(`/api/captions?room=${OTHER_ROOM}`, { 'X-Room-Token': A_ROOM_TOKEN })) === 401);
  {
    // 断言④：把签名**第一段的首字符**改掉（首字符 6 bit 全用，必然改变字节，不会撞上 base64 尾部的填充位）
    const dot = A_ROOM_TOKEN.indexOf('.');
    const sigPart = A_ROOM_TOKEN.slice(dot + 1);
    const tamperedSig = A_ROOM_TOKEN.slice(0, dot + 1)
      + (sigPart[0] === 'A' ? 'B' : 'A') + sigPart.slice(1);
    ok('09-24 C4 签名被篡改（改 sig 首字符）→ 401',
       (await getCode(`/api/captions?room=${ROOM}`, { 'X-Room-Token': tamperedSig })) === 401);
    // 断言⑥：payload 段换成"另一个房间的 payload"，但沿用原签名 → HMAC 对不上 → 401
    const otherPayload = b64url(JSON.stringify({ room: OTHER_ROOM, iat: Date.now(), exp: Date.now() + 3600000 }));
    const swapped = otherPayload + '.' + A_ROOM_TOKEN.slice(dot + 1);
    ok('09-24 C4 payload 被篡改（换房间号 payload、沿用原签名）→ 401',
       (await getCode(`/api/captions?room=${OTHER_ROOM}`, { 'X-Room-Token': swapped })) === 401);
  }
  // 断言⑤：过期令牌。用服务器 SECRET 现造一张 exp 在过去的令牌（比"等 24 小时"可靠）。
  if (roomSecret) {
    const expiredTok = forgeRoomToken(roomSecret, { room: ROOM, iat: Date.now() - 2000, exp: Date.now() - 1000 });
    ok('09-24 C4 过期令牌被拒（exp 在过去 → 401，实测过期路径而非恒真）',
       (await getCode(`/api/captions?room=${ROOM}`, { 'X-Room-Token': expiredTok })) === 401);
  } else {
    console.log('  SKIP  09-24 C4 过期令牌被拒（读不到 sfu/data/room-secret，无法可靠造过期令牌；'
      + '不硬写可能恒真的断言）');
  }
  // 断言：查询串兜底（AI 纪要链接是 <a href>，发不出请求头，只能走 ?roomToken=）
  ok('09-24 C4 ?roomToken= 查询串兜底可过（AI「打开纪要」链接走的就是这条）',
     (await getCode(`/api/minutes?room=${ROOM}&roomToken=${encodeURIComponent(A_ROOM_TOKEN)}`)) === 200);

  // --- ★ 09-17e：/api/captions 过夜值守归档（HTTP 层：落盘 / 回读 / 坏输入拒绝）---
  // （注意：本文件顶部 const URL='http://localhost:3001' 遮蔽了全局 URL 构造器，
  //   所以这里用手写正则拆 URL，别用 new URL(...)）
  /* ★ 09-24 G8 复审：默认带管理员 token（/metrics、/api/rooms 要它），
   *   但加一个 noAuth 开关——用来**扮演游客**（无 token）验证"内容类接口没被门禁误伤"。
   *   没有这个开关，全套断言都在管理员身份下跑，恰好会漏掉游客视角的回归。
   * ★ 09-24 C4：再加一个 extraHeaders 口子——房间内令牌走 X-Room-Token 请求头，
   *   没有它就没法扮演"持房间令牌但无管理员 token"的游客。 */
  const httpReq = (method, url, body, noAuth, extraHeaders) => new Promise((resolve, reject) => {
    const m = String(url).match(/^http:\/\/([^:/]+):(\d+)(\/[^?]*)?(\?.*)?$/);
    if (!m) return reject(new Error('bad url: ' + url));
    const rq = http.request({
      hostname: m[1], port: m[2], path: (m[3] || '') + (m[4] || ''), method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(!noAuth && adminToken ? { Authorization: 'Bearer ' + adminToken } : {}),
        ...(extraHeaders || {}), // ★ C4：自定义头（如 X-Room-Token）最后合并，调用方可覆盖
      },
    }, (r) => {
      let b = '';
      r.on('data', (c) => (b += c));
      r.on('end', () => resolve({ code: r.statusCode, text: b }));
    });
    rq.on('error', reject);
    if (body) rq.write(JSON.stringify(body));
    rq.end();
  });
  const capEntries = [1, 2, 3].map((i) => ({ ts: Date.now() + i, from: 'test', name: '值守模拟', text: `归档对账第 ${i} 条` }));
  const capPost = await httpReq('POST', 'http://localhost:3001/api/captions', { room: ROOM, entries: capEntries });
  ok('09-17e POST /api/captions 归档成功（saved=条数）', capPost.code === 200 && JSON.parse(capPost.text).saved === 3);
  const capTxt = await httpReq('GET', `http://localhost:3001/api/captions?room=${ROOM}&format=txt`);
  ok('09-17e GET format=txt 回读全档（含刚归档的条目）', capTxt.code === 200 && capTxt.text.includes('归档对账第 3 条'));
  const capJson = await httpReq('GET', `http://localhost:3001/api/captions?room=${ROOM}&format=json`);
  ok('09-17e GET format=json 回读结构化全档（≥3 条）', capJson.code === 200 && JSON.parse(capJson.text).length >= 3);
  /* ★ 09-24 C4 本轮最重要的正向回归：把"游客"从"无 token"改成"**带游客自己的房间内令牌**"。
   *   意义：证明房间令牌门禁没有把游客路径打死——A 就是未登录的游客，它的 roomToken 就是
   *   "游客自己的房间内令牌"。noAuth=true 确保**不带管理员 token**，能力完全来自 X-Room-Token。 */
  const capGuest = await httpReq('POST', 'http://localhost:3001/api/captions',
    { room: ROOM, entries: [{ ts: Date.now(), from: 'guest-test', name: '游客', text: '游客归档回归' }] },
    true, { 'X-Room-Token': A_ROOM_TOKEN });
  ok('09-24 C4 游客凭房间内令牌可归档并回读：POST /api/captions 成功', capGuest.code === 200 && JSON.parse(capGuest.text).saved === 1);
  const capGuestRead = await httpReq('GET', `http://localhost:3001/api/captions?room=${ROOM}&format=txt`,
    null, true, { 'X-Room-Token': A_ROOM_TOKEN });
  ok('09-24 C4 游客凭房间内令牌可归档并回读：GET 回读得到自己刚归档的那条',
     capGuestRead.code === 200 && capGuestRead.text.includes('游客归档回归'));
  const capBad = await httpReq('POST', 'http://localhost:3001/api/captions', { room: '../../etc', entries: capEntries });
  ok('09-17e 非法房间号被拒（400，路径穿越进不来）', capBad.code === 400);
  const capNoRoom = await httpReq('GET', 'http://localhost:3001/api/captions');
  ok('09-17e GET 缺 room 参数被拒（400）', capNoRoom.code === 400);

  // --- ★ 09-18：/metrics Prometheus 文本格式（G7 可观测性，零依赖）---
  const met = await httpReq('GET', 'http://localhost:3001/metrics');
  ok('09-18 /metrics 返回 Prometheus 文本（含 rooms/members 与 bytes 计数）',
     met.code === 200 && met.text.includes('# TYPE sfu_rooms_total gauge') &&
     met.text.includes('sfu_producer_bytes_total') && /sfu_members_total \d+/.test(met.text));
  // ★ 09-24 AI 用量可观测：调用次数/错误数/tokens/估算花费在同一份 metrics 面上
  ok('09-24 /metrics 含 AI 用量指标（调用/错误/tokens/花费 四组齐备）',
     met.text.includes('sfu_ai_llm_enabled') && met.text.includes('sfu_ai_llm_calls_total')
     && met.text.includes('sfu_ai_llm_errors_total') && met.text.includes('sfu_ai_llm_prompt_tokens_total')
     && met.text.includes('sfu_ai_llm_cost_cny'));

  // --- ★ 09-19：G7-② 结构化日志（JSONL）---
  const fsLog = require('fs');
  const logDir = 'sfu/logs';
  const logFiles = fsLog.existsSync(logDir)
    ? fsLog.readdirSync(logDir).filter((f) => f.startsWith('app-') && f.endsWith('.jsonl')).sort()
    : [];
  let logLines = [];
  for (const f of logFiles) {
    logLines = logLines.concat(fsLog.readFileSync(`${logDir}/${f}`, 'utf8').split('\n').filter(Boolean));
  }
  const hasEvent = (ev) => logLines.some((l) => { try { return JSON.parse(l).event === ev; } catch (e) { return false; } });
  ok('09-19 G7-② 结构化日志落盘（room-created/member-joined/member-left 三事件可检索）',
     hasEvent('room-created') && hasEvent('member-joined') && hasEvent('member-left'));

  // --- ★ 09-19：AI Bot 参会者（ai-join/ai-ask/ai-leave + room-state 注入）---
  // 坑 3 纪律：监听先于 emit——room-state 广播发生在 ack 之前
  const aiStateP0 = waitEvent(A.s, 'room-state');
  const aiJoinAck = await request(A.s, 'ai-join', {});
  ok('09-19 ai-join 应答 { aiBot: true }', aiJoinAck.data && aiJoinAck.data.aiBot === true);
  const aiState = await Promise.race([aiStateP0, sleep(800).then(() => null)]);
  const aiRow = aiState && (aiState.members || []).find((m) => m.id === 'ai-bot');
  ok('09-19 ai-join 后 room-state 注入 isBot 虚拟成员（🤖 AI 助理）',
     !!aiRow && aiRow.isBot === true && aiRow.name.includes('AI'));
  /* ★ 09-24 AI 双轨（路线图 1.3）：信令回归必须**在两种环境下都成立**——
   *   服务器可能配了 DeepSeek key（走 LLM），也可能没配（走 [Mock] 本地规则）。
   *   断言因此分叉：正文要求"非空、来自相应轨道"，具体措辞不写死。
   *   AI_ENABLED 从 /config.json 读（服务器只下发布尔值，绝不回显密钥——下面有断言守着）。 */
  const aiCfg = await httpReq('GET', 'http://localhost:3001/config.json');
  const AI_ENABLED = aiCfg.code === 200 && JSON.parse(aiCfg.text).aiEnabled === true;
  console.log(`  （AI 双轨：服务器当前为 ${AI_ENABLED ? 'LLM 真模型轨道' : '[Mock] 本地规则轨道'}）`);
  ok('09-24 /config.json 只下发 aiEnabled 布尔值，**绝不回显密钥**',
     aiCfg.code === 200 && !/sk-|api[-_]?key|DEEPSEEK_API_KEY|da218d81/i.test(aiCfg.text));

  const aiAskP = waitEvent(A.s, 'chat-message');
  const aiStreamDeltas = [];
  A.s.on('ai-stream', (p) => { if (p && p.delta) aiStreamDeltas.push(p.delta); });
  const aiAns = await request(A.s, 'ai-ask', { question: '你好，你是谁？' });
  ok('09-24 ai-ask 先回执 streamId（流式握手，前端据此立气泡）',
     !!aiAns.data && typeof aiAns.data.streamId === 'string' && aiAns.data.streamId.startsWith('ai-'));
  const aiMsg = await Promise.race([aiAskP, sleep(8000).then(() => null)]);
  ok(`09-19 ai-ask 终态 ${AI_ENABLED ? 'LLM' : '[Mock]'} 答案广播全房（from=ai-bot）`,
     !!aiMsg && aiMsg.from === 'ai-bot' && aiMsg.text.length > 4);
  ok(`09-24 ai-ask 答案确由${AI_ENABLED ? '真模型（无 [Mock] 标记）' : '本地规则（带 [Mock] 标记）'}生成`,
     !!aiMsg && (AI_ENABLED ? !aiMsg.text.includes('[Mock]') : aiMsg.text.includes('[Mock]')));
  ok('09-24 ai-ask 广播带 ai 元信息（前端据此画 LLM/Mock 徽标与 token 用量）',
     !!aiMsg && !!aiMsg.ai && typeof aiMsg.ai.mock === 'boolean' && typeof aiMsg.ai.tokens === 'number');
  ok('09-24 流式 ai-stream 到达接收端（打字机的数据源）', aiStreamDeltas.length > 0);
  let aiErr = null;
  try { await request(A.s, 'ai-ask', { question: '' }); } catch (e) { aiErr = e.message; }
  ok('09-19 ai-ask 空问题被拒（错误路径正确）', !!aiErr);
  const aiState2P0 = waitEvent(A.s, 'room-state');
  await request(A.s, 'ai-leave', {});
  const aiState2 = await Promise.race([aiState2P0, sleep(800).then(() => null)]);
  ok('09-19 ai-leave 后 room-state 不再含 bot',
     aiState2 && !(aiState2.members || []).some((m) => m.isBot));
  /* ★ 09-24 体验改版：bot 不在房时不再冷冰冰地 fail，而是**自动邀请入会**——
   *   提问者的心智模型是"问 AI"，不是"先去按某个按钮"。断言随之改为验证这条自动链路。 */
  const aiAutoState = waitEvent(A.s, 'room-state');
  const aiAutoMsg = waitEvent(A.s, 'chat-message');
  const aiAutoAsk = await request(A.s, 'ai-ask', { question: '在吗' });
  ok('09-24 ai-ask 时助理缺位 → 自动邀它入会（不再要求成员先点按钮）',
     !!aiAutoAsk.data && aiAutoAsk.data.started === true);
  const aiAutoRow = await Promise.race([aiAutoState.then((s) => (s.members || []).find((m) => m.id === 'ai-bot')), sleep(800).then(() => null)]);
  ok('09-24 自动邀请后 room-state 真的含 bot 成员', !!aiAutoRow && aiAutoRow.isBot === true);
  const aiAutoAns = await Promise.race([aiAutoMsg, sleep(8000).then(() => null)]);
  ok('09-24 自动邀请后问题照常作答（不会因为缺这一步把提问吞掉）',
     !!aiAutoAns && aiAutoAns.from === 'ai-bot' && aiAutoAns.text.length > 2);

  // --- ★ 09-19c：N2 纪要（手动生成/下载/列表）+ G3 录制列表 ---
  // 先给房间塞 3 条字幕（N2 的原料走 /api/captions 权威副本）
  await httpReq('POST', 'http://localhost:3001/api/captions', {
    room: ROOM,
    entries: [
      { ts: Date.now(), from: A.id, name: '张三', text: '下周我们需要把部署手册补完' },
      { ts: Date.now() + 1, from: A.id, name: '张三', text: '明天记得跟进TURN服务器' },
      { ts: Date.now() + 2, from: A.id, name: '李四', text: '好的我来安排' },
    ],
  });
  const minAck = await request(A.s, 'ai-minutes', { type: 'segment' });
  ok(`09-19c ai-minutes 生成纪要（返回文件路径，${AI_ENABLED ? 'LLM' : 'Mock'} 轨道）`,
     !!minAck.data && !!minAck.data.file && minAck.data.file.endsWith('.md')
     && minAck.data.mock === !AI_ENABLED);
  const minDown = await httpReq('GET', 'http://localhost:3001' + minAck.data.path);
  ok('09-19c 纪要可经 /minutes/<room>/<file> 下载且含标题与生成器注记',
     minDown.code === 200 && minDown.text.includes('# 会议纪要')
     && (AI_ENABLED ? minDown.text.includes('由 DeepSeek 撰写') : minDown.text.includes('本地模板生成')));
  // ★ 09-24：LLM 轨道下正文少了"待办线索"结构化小节，但它仍用到了同一份字幕原料——
  //   因此这里要求**至少出现原文里的关键事实**（TURN），证明答案取自账本而非编造。
  const whom = ['TURN', '部署手册', '李四'].filter((k) => minDown.text.includes(k));
  ok(`09-24 ${AI_ENABLED ? 'LLM' : 'Mock'} 纪要内容取自字幕账本（命中原文线索 ${whom.join('/') || '无'}）`,
     whom.length > 0);
  const minList = await httpReq('GET', `http://localhost:3001/api/minutes?room=${ROOM}`);
  ok('09-19c /api/minutes 列表含刚生成的文件', minList.code === 200 &&
     JSON.parse(minList.text).some((x) => x.name === minAck.data.file));
  const minBad = await httpReq('GET', 'http://localhost:3001/minutes/../../etc/passwd');
  ok('09-19c /minutes 路径穿越被钳制（403/404，绝不定成功）', minBad.code === 403 || minBad.code === 404);
  const recList = await httpReq('GET', 'http://localhost:3001/api/recordings');
  ok('09-19c G3 /api/recordings 列表可用（200 数组）', recList.code === 200 && Array.isArray(JSON.parse(recList.text)));
  /* ★ 09-24 C4 断言⑧：录像签名 URL —— /recordings/<文件> 现在是"admin 或短时效签名 URL"。
   * ▎重点：**必须分清 401 与 404**（这是权限 vs 业务存在性两件事）：
   *     签名/管理员不过 → 401；签名通过但文件不存在 → 404。
   *   为了不往真实 recordings/ 目录塞假文件，用"签名有效 + 文件名不存在"断言 404——
   *   恰好证明"签名过了才走到业务层"。混成一条就分不清"没权限"和"文件被删/还没生成"。 */
  const REC_NAME = 'signed-test-nonexistent.webm';
  if (roomSecret) {
    const goodExp = Date.now() + 3600000;
    const goodSig = forgeRecordingSig(roomSecret, REC_NAME, goodExp);
    ok('09-24 C4 录像：签名通过的链接放行到业务层（文件不存在 → 404，而非 401）',
       (await getCode(`/recordings/${REC_NAME}?exp=${goodExp}&sig=${goodSig}`)) === 404);
    ok('09-24 C4 录像：exp 改成过期值 → 401',
       (await getCode(`/recordings/${REC_NAME}?exp=${Date.now() - 1000}&sig=${goodSig}`)) === 401);
    const badSig = (goodSig[0] === 'a' ? 'b' : 'a') + goodSig.slice(1);
    ok('09-24 C4 录像：sig 改一个字符 → 401',
       (await getCode(`/recordings/${REC_NAME}?exp=${goodExp}&sig=${badSig}`)) === 401);
    // 管理员不受签名限制（不签名也过门禁；404 = 过了门禁、只是文件不存在）
    ok('09-24 C4 录像：管理员 token 不受签名限制（不签名也过门禁 → 404）',
       (await getCode(`/recordings/${REC_NAME}`, { Authorization: 'Bearer ' + adminToken })) === 404);
  } else {
    console.log('  SKIP  09-24 C4 录像签名 URL 四条（读不到 sfu/data/room-secret，无法可靠造签名）');
  }

  // --- ★ 09-19h：G6 安全加固（滑动续期 / 聊天限流 / 过期路径）---
  let g6Tok = null;
  try { g6Tok = (await request(A.s, 'auth-login', { username: 'g6user', password: 'secret6' })).data.token; }
  catch (e) { /* 还没注册 */ }
  if (!g6Tok) {
    try { await request(A.s, 'auth-register', { username: 'g6user', password: 'secret6', displayName: 'G6测试' }); }
    catch (e) { /* 已被注册（跨轮次复跑） */ }
    try { g6Tok = (await request(A.s, 'auth-login', { username: 'g6user', password: 'secret6' })).data.token; }
    catch (e) { /* 仍失败则下面的断言会如实报告 */ }
  }
  ok('09-19h G6 登录拿到 token', !!g6Tok);
  const g6Verify = await request(A.s, 'auth-verify', { username: 'g6user', token: g6Tok });
  ok('09-19h G6 verify 通过（滑动续期已生效）', !!(g6Verify.data && g6Verify.data.user));
  const g6Refresh = await request(A.s, 'auth-refresh', { username: 'g6user', token: g6Tok });
  ok('09-19h G6 auth-refresh 返回新过期时间（expiresAt 数字）',
     !!(g6Refresh.data && typeof g6Refresh.data.expiresAt === 'number' && g6Refresh.data.expiresAt > Date.now()));
  // 聊天限流：单 socket 瞬发 60 条（>40/10s），后段应被静默丢弃
  const chatRecv = [];
  const onChatG6 = (p) => { if ((p.text || '').startsWith('g6spam')) chatRecv.push(p.text); };
  A.s.on('chat-message', onChatG6);
  for (let i = 0; i < 60; i++) A.s.emit('chat-message', { text: `g6spam-${i}`, msgId: `g6-${i}` });
  await sleep(800);
  A.s.off('chat-message', onChatG6);
  ok('09-19h G6 聊天限流生效（60 条瞬发，收到 < 45 = 后段被丢）', chatRecv.length < 45);
  // 过期路径：短 TTL 服务器（AUTH_TTL_MS=2000 启动）才实测；默认 24h 自动跳过
  if (authTtlMs <= 5000) {
    const shortLogin = await request(A.s, 'auth-login', { username: 'g6user', password: 'secret6' });
    const shortTok = (shortLogin.data || {}).token;
    await sleep(authTtlMs + 400);
    let expired = null;
    try { expired = await request(A.s, 'auth-verify', { username: 'g6user', token: shortTok }); }
    catch (e) { expired = { error: e.message }; }
    ok('09-19h G6 过期 token 被 verify 拒绝（短 TTL 实测）',
       !!expired.error && expired.error.includes('失效'));
  } else {
    ok('09-19h G6 过期路径（默认 24h TTL 跳过实测——AUTH_TTL_MS=2000 启动可验）', true);
  }

  // --- ★ 09-19f：SFU 深造（多 Worker 池 + ping 探活）---
  const met2 = await httpReq('GET', 'http://localhost:3001/metrics');
  ok('09-19f /metrics 带 sfu_workers gauge（Worker 池大小）',
     met2.code === 200 && /sfu_workers \d+/.test(met2.text));
  const pingT0 = Date.now();
  const pingResp = await new Promise((resolve) => A.s.emit('ping', {}, (r) => resolve(r)));
  ok('09-19f ping 探活信令回显 ack（RTT 探针可用）',
     !!pingResp && !!pingResp.data && typeof pingResp.data.t === 'number' && Date.now() - pingT0 < 2000);

  // --- ★ 09-19g：C1 AI 远程操作员（真实授权链路 + 输入序列 + 释放）---
  // 前置清理：清掉前段测试残留的控制态与 sharing（A6 场景会留 controllerId → AI 会被 busy 拒）
  A.s.emit('remote-release');
  for (const mem of [A, F]) {
    try { mem.s.emit('member-state', { patch: { sharing: false } }); } catch (e) { /* 已断开 */ }
  }
  await sleep(300);
  // 前置拒绝：没人共享屏幕 → AI 无被控端可操作
  let aiOpErr = null;
  try { await request(A.s, 'ai-op', { goal: '测试' }); } catch (e) { aiOpErr = e.message; }
  ok('09-19g 无共享者时 ai-op 被拒（明确提示）', !!aiOpErr);
  // A 共享屏幕（成为被控端）→ 发起 ai-op → bot 走真实授权 → A 收到输入序列 → 释放
  A.s.emit('member-state', { patch: { sharing: true } });
  await sleep(150);
  const inputs = [];
  const onInput = (p) => inputs.push(p);
  A.s.on('remote-input', onInput);
  // remote-state 在授权/释放时都会广播——持久收集，最后断言"出现过 controllerId=null"
  const aiStates = [];
  A.s.on('remote-state', (p) => aiStates.push(p));
  const reqP = waitEvent(A.s, 'remote-request'); // 被控端应收到 AI 的授权请求
  const opAck = await request(A.s, 'ai-op', { goal: '演示：打开计算器按 7×8' });
  ok('09-19g ai-op 受理（started=true）', !!opAck.data && opAck.data.started === true);
  const botReq = await Promise.race([reqP, sleep(6000).then(() => null)]);
  ok('09-19g bot 以真实控制端身份发起 remote-request（被控端弹同一张授权卡）',
     !!botReq && typeof botReq.from === 'string' && botReq.from !== A.id);
  if (!botReq) { ok('09-19g 后续：授权/输入/释放（依赖上一步，未达）', false); }
  // 被控端允许（与人类授权完全同一条信令；限时 8s 防泄漏）
  else A.s.emit('remote-answer', { to: botReq.from, ok: true, durationMs: 8000 });
  // ★ 09-24 改：等"自动交还"事件，而不是死等固定时长。
  //   固定 sleep 在慢机器 / 慢 LLM 上必然假失败，而假失败的代价最大——
  //   明明代码是对的，界面红一片，于是大家学会"红了重跑"，真问题就没人看了。
  //   事件驱动 + 超时上限，才是稳定的写法。
  const handedBackP = new Promise((res) => {
    const h = (p) => { if (p.controllerId === null) { A.s.off('remote-state', h); res(true); } };
    A.s.on('remote-state', h);
  });
  const handedBack = await Promise.race([handedBackP, sleep(8000).then(() => false)]);
  A.s.off('remote-input', onInput);
  ok('09-19g 被控端收到 AI 的 remote-input 序列（≥5 条，含 16 字节帧）',
     inputs.length >= 5 &&
     inputs.some((p) => p.event && (p.event.byteLength === 16 || p.event.length === 16)));
  ok('09-19g 任务完成后 AI 自动交还控制权（remote-state 出现过 controllerId=null）',
     handedBack && aiStates.some((p) => p.controllerId === null));

  // --- D1：对不存在的 Consumer 切层 → 走错误路径而不是崩服务 ---
  let layerErr = null;
  try { await request(F.s, 'set-preferred-layers', { consumerId: 'fake-consumer', spatialLayer: 1 }); }
  catch (e) { layerErr = e.message; }
  ok('D1 对不存在的 Consumer 切层被拒（错误路径正确）', !!layerErr);

  // --- A6：限时授权到点自动撤权（用 900ms 验证整条链路）---
  A.s.emit('remote-release');       // 先结束上一轮控制
  await sleep(200);
  const fReq3P = waitEvent(A.s, 'remote-request');
  F.s.emit('remote-request', { to: A.id });
  await fReq3P;
  const states = [];
  const onState = (p) => states.push(p);
  F.s.on('remote-state', onState);
  // "授权广播带 expiresAt"要等它真的到达（回执和广播是两条消息，不能假设同一条已处理完）
  const grantStateP = new Promise((res) => {
    const h = (p) => { if (typeof p.expiresAt === 'number') { F.s.off('remote-state', h); res(p); } };
    F.s.on('remote-state', h);
  });
  const endedP = waitEvent(F.s, 'remote-ended');
  const fAnsTimedP = waitEvent(F.s, 'remote-answer');
  A.s.emit('remote-answer', { to: F.id, ok: true, durationMs: 900 });
  const fAnsTimed = await fAnsTimedP;
  ok('A6 限时授权：回执带 expiresAt（前端据此跑倒计时）',
     typeof fAnsTimed.expiresAt === 'number' && fAnsTimed.expiresAt > Date.now());
  const grantState = await grantStateP;
  ok('A6 授权广播里也带 expiresAt（全房都能算倒计时）', typeof grantState.expiresAt === 'number');
  const ended = await endedP;
  ok('A6 到点自动撤权 → 双方收到 remote-ended(expired)', ended.reason === 'expired');
  await sleep(200);
  F.s.off('remote-state', onState);
  const lastState = states[states.length - 1];
  ok('A6 撤权后 remote-state 复位（hostId/controllerId 都为 null）',
     !!lastState && lastState.hostId === null && lastState.controllerId === null);

  /* ════════════════════════════════════════════════════════════════
   * ★ 2026-09-14：D+3（VP9/SVC 载体）+ D+4（空房 TTL + 房主迁移）断言
   * ════════════════════════════════════════════════════════════════ */

  // --- D+3①：Router 能力含 VP9（videoSvc 单路分层的载体）---
  const caps3 = await request(A.s, 'get-router-rtp-capabilities', {});
  ok('D+3 Router 能力含 VP9（videoSvc 的载体）',
     !!(caps3.data.rtpCapabilities.codecs || []).find((c) => c.mimeType === 'video/VP9'));

  // --- D+4①：房主离开 → 房主迁移给最早进房的幸存者（F 比 H/I 早进 ROOM）---
  const fOwnerP = new Promise((res) => {
    const h = (p) => {
      const row = p.members.find((m) => m.id === F.id);
      if (row && row.owner === true) { F.s.off('room-state', h); res(p); }
    };
    F.s.on('room-state', h);
  });
  A.s.disconnect(); // A 是 ROOM 的创建者/房主，也是最早的成员
  const fOwnerState = await fOwnerP;
  ok('D+4 房主离开 → 房主迁移给最早进房的幸存者（F）',
     !!fOwnerState.members.find((m) => m.id === F.id && m.owner === true));

  // --- D+4②：人走光不立刻销毁（TTL 宽限期内原号可回归）---
  const L = await client('L');
  // 时序（老教训坑 3）：room-created/room-members 都在 create-room 应答之前发出，先注册再 emit
  const lCreatedP = waitEvent(L.s, 'room-created');
  const lMembersP = waitEvent(L.s, 'room-members');
  await request(L.s, 'create-room', {});
  const lCreated = await lCreatedP;
  await lMembersP;
  L.s.disconnect();                       // 人走光 → 进入宽限期（默认 60s）
  await sleep(300);
  const M = await client('M');
  const mMembersP = waitEvent(M.s, 'room-members');
  M.s.emit('join-room', { roomNumber: lCreated.roomNumber });
  const mMembers = await mMembersP;       // 宽限期内凭原号回归成功
  ok('D+4 空房进入 TTL 宽限期，宽限期内原号可回归（掉线重连的最后一块拼图）',
     mMembers.roomNumber === lCreated.roomNumber && mMembers.members.length === 0);

  // --- D+2：服务器侧录制（无 ffmpeg 环境走"明确提示"错误路径；有 ffmpeg 则走"无媒体"错误路径）---
  let recErr = null;
  // H 与发起者 M 不同房——先验"跨房间目标被拒"；再用同房间的 I（无媒体）验"没有可录制"
  let recErr2 = null;
  try { await request(M.s, 'record-start', { memberId: F.id }); }
  catch (e) { recErr2 = e.message; }
  ok('D+2 record-start 目标不在本房间被拒', !!recErr2 && /找不到要录制的成员/.test(recErr2));
  try { await request(M.s, 'record-start', { memberId: M.s.id }); }
  catch (e) { recErr = e.message; }
  ok('D+2 record-start 无媒体走明确错误应答（ffmpeg 已装则报"没有可录制"）',
     !!recErr && (/没有可录制/.test(recErr) || /ffmpeg/.test(recErr)));
  let recStopErr = null;
  try { await request(M.s, 'record-stop', { recordId: 'not-exist' }); }
  catch (e) { recStopErr = e.message; }
  ok('D+2 record-stop 未知 recordId 被拒（错误路径正确）', !!recStopErr);

  // --- ★ 09-16 登录/注册（零依赖用户体系）---
  const uname = `a_${Math.random().toString(36).slice(2, 8)}`; // 短随机：用户名上限 16 位
  const AU = await client('AU');
  const reg = await request(AU.s, 'auth-register', { username: uname, password: 'secret1', displayName: '爱丽丝' });
  ok('09-16 注册成功返回昵称 + token',
     reg.data.user.displayName === '爱丽丝' && typeof reg.data.token === 'string' && reg.data.token.length > 20);
  let dupErr2 = null;
  try { await request(AU.s, 'auth-register', { username: uname, password: 'secret2' }); }
  catch (e) { dupErr2 = e.message; }
  ok('09-16 重复注册被拒（用户名已存在）', !!dupErr2 && /已被注册/.test(dupErr2));
  let badErr = null;
  try { await request(AU.s, 'auth-login', { username: uname, password: 'wrong!' }); }
  catch (e) { badErr = e.message; }
  ok('09-16 错误密码被拒（统一提示不泄露用户名存在性）', !!badErr && /用户名或密码不对/.test(badErr));
  const login = await request(AU.s, 'auth-login', { username: uname, password: 'secret1' });
  ok('09-16 正确密码登录成功', !!login.data.token && login.data.user.displayName === '爱丽丝');
  const ver = await request(AU.s, 'auth-verify', { username: uname, token: login.data.token });
  ok('09-16 token 恢复登录态（昵称带回）', ver.data.user.displayName === '爱丽丝');
  let verErr = null;
  try { await request(AU.s, 'auth-verify', { username: uname, token: 'forged' }); }
  catch (e) { verErr = e.message; }
  ok('09-16 伪造 token 被拒', !!verErr && /失效/.test(verErr));
  // 昵称贯通：登录后进房 → room-state 带昵称
  const auStateP = new Promise((res) => {
    const h = (p) => {
      const row = p.members.find((m) => m.id === AU.id);
      if (row) { AU.s.off('room-state', h); res(p); }
    };
    AU.s.on('room-state', h);
  });
  AU.s.emit('join-room', { roomNumber: ROOM });
  const auState = await auStateP;
  ok('09-16 昵称贯通 room-state（成员列表显示昵称）',
     (auState.members.find((m) => m.id === AU.id) || {}).name === '爱丽丝');

  /* ================= ★ 09-24 真远程桌面（桌面代理 agent / 画面帧通道）=================
   * ▎这一组测的是"真控"这条新链路的**安全闸门**，而不只是"能跑通"。
   *   因为画面通道是一条"被控端 → 控制端"的大流量单向管道，一旦门禁写漏，
   *   后果是"房间里任何人都能看到你屏幕"或"任何人能往你屏幕上灌垃圾"。
   *   所以下面每个闸门都单独测：身份闸 / 授权闸 / 体量闸 / 撤权即断。
   */
  console.log('\n--- 09-24 真远程桌面 ---');

  // 腾位置：房间上限 8 人，本段要同时站住"代理 + 控制端 + 观察者"三个连接。
  // 前面几组的客户端都已经测完，先把它们请出去（顺带也是一次真实的成员清退）。
  // 用"取值函数 + 逐个 try"是为了容忍某个变量在当前作用域不存在——测试脚本反而不能因此崩掉。
  for (const get of [() => C, () => D, () => H, () => I, () => M, () => AU]) {
    try { const c = get(); if (c && c.s) c.s.disconnect(); } catch (e) { /* 不在作用域，跳过 */ }
  }
  await sleep(900);

  const getJson = (p) => new Promise((resolve, reject) => {
    require('http').get('http://localhost:3001' + p, (r) => {
      let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });

  const cfgNow = await getJson('/config.json');
  ok('09-24 /config.json 声明支持桌面代理（前端据此显示「控制电脑」入口）', cfgNow.remoteDesktop === true);
  ok('09-24 /config.json 下发代理启动命令模板（用户复制即用）', /agent\/index\.js/.test(cfgNow.agentCommand || ''));

  /* ① 超员闸 —— 这一条是"补写的守门测试"，因为写它的时候真的抓到了一个 bug：
   *   原来 joinRoom() 满员只 `return`（返回 undefined），调用方却照旧回"进房成功"
   *   → **假成功**：代理打印"已就绪"，房间里却找不到它，控制端也无从下手。
   *   假成功比崩溃更难查（不报错、只是"怎么没反应"），所以必须有个测试盯着它。 */
  const curCount = await new Promise((res) => {
    // ★ 必须排除 isBot：AI 助理是**虚拟成员**（在快照里、但不占 socket 名额），
    //   算进人数就会多算一个 → 后面填充少一个 → "满房"测不出来（这个坑真踩了）。
    const h = (p) => { F.s.off('room-state', h); res(p.members.filter((m) => !m.isBot).length); };
    F.s.on('room-state', h);
    F.s.emit('member-state', { patch: {} });   // 空 patch 也会触发一次快照广播
  });
  const fillers = [];
  for (let i = curCount; i < 8; i++) {
    const f = await client('fill' + i);
    f.s.emit('join-room', { roomNumber: ROOM });
    fillers.push(f);
    await sleep(150);
  }
  await sleep(500);

  const FULL3 = await client('FULL3');
  let joinFullErr = null;
  FULL3.s.emit('join-room', { roomNumber: ROOM }, (r) => { joinFullErr = r; });
  await sleep(500);
  ok('09-24 房间满时 join-room 明确失败（守门：修掉"假成功"这个真 bug）',
     !!joinFullErr && !!joinFullErr.error);

  const FULL4 = await client('FULL4');
  let agentFullErr = null;
  FULL4.s.emit('agent-hello', { roomNumber: ROOM, name: 'x' }, (r) => { agentFullErr = r; });
  await sleep(500);
  ok('09-24 房间满时 agent-hello 同样明确失败（代理吃同一条人数上限）',
     !!agentFullErr && !!agentFullErr.error);
  FULL3.s.disconnect(); FULL4.s.disconnect();

  // 腾位置：把填充连接请出去，让代理正常进房（房间上限 8 人，前面测试已经占了不少）
  for (const f of fillers) { try { f.s.disconnect(); } catch (e) { /* ignore */ } }
  await sleep(800);

  // ② 代理报到：agent-hello（不是 join-room —— 房间要区分"人"和"机器"）
  const AG = await client('AG');
  let agAck = null;
  AG.s.emit('agent-hello', {
    roomNumber: ROOM, name: '测试机', platform: 'win32', browser: 'Edg/test',
  }, (r) => { agAck = r; });
  await sleep(700);
  ok('09-24 agent-hello 进房成功（返回房间号）',
     !!agAck && !agAck.error && !!(agAck.data && agAck.data.roomNumber === ROOM));

  // ③ 快照必须带 agent 标记 + 🖥️ 前缀名（前端靠它渲染徽标和按钮文案）
  //    观察者用 F（A 在房主迁移那组已经退场了，这里不能再拿它当观察点）
  const agRowP = new Promise((res) => {
    const h = (p) => { const row = p.members.find((m) => m.id === AG.id); if (row) { F.s.off('room-state', h); res(row); } };
    F.s.on('room-state', h);
  });
  AG.s.emit('member-state', { patch: { muted: false } });   // 触发一次快照广播
  const agRow = await Promise.race([agRowP, sleep(3000).then(() => null)]);
  ok('09-24 成员快照带 agent 标记（前端显示 🖥️ 徽标）', !!agRow && agRow.agent === true);
  ok('09-24 代理名字带 🖥️ 前缀（人/机一眼可辨）', !!agRow && /^🖥️/.test(agRow.name || ''));

  // ④ 代理也没有特权：房间不存在照样被拒（三道校验和 join-room 一样）
  const AG2 = await client('AG2');
  let agBad = null;
  AG2.s.emit('agent-hello', { roomNumber: '000000' }, (r) => { agBad = r; });
  await sleep(500);
  ok('09-24 agent-hello 房间不存在被拒（代理无特权）', !!agBad && !!agBad.error);
  AG2.s.disconnect();

  /* ⑤ 走真实授权链路：控制端申请 → 代理应答（一个字都没豁免）
   *   控制端用一条**新连接** CTL 而不是复用 B —— 因为要确保"控制端"和"观察者/第三人"
   *   是两个不同的人，否则授权闸那几条断言就测不出"画面会不会漏给别人"。 */
  const CTL = await client('CTL');
  let ctlJoined = null;
  CTL.s.emit('join-room', { roomNumber: ROOM }, (r) => { ctlJoined = r; });
  await sleep(700);
  ok('09-24 控制端能正常进房（代理不占用别人的进房权）', !!ctlJoined && !ctlJoined.error);

  const agentReqP = waitEvent(AG.s, 'remote-request');
  CTL.s.emit('remote-request', { to: AG.id });
  const agentReq = await Promise.race([agentReqP, sleep(3000).then(() => null)]);
  ok('09-24 控制端能向代理申请控制（复用同一张授权信令）', !!agentReq && agentReq.from === CTL.id);
  AG.s.emit('remote-answer', { to: CTL.id, ok: true, durationMs: 20000 });
  await sleep(400);

  const frames = [];
  CTL.s.on('remote-frame', (p) => frames.push(p));

  // ⑥ 身份闸：人类冒充代理灌画面 → 必须被丢
  CTL.s.emit('remote-frame', { to: CTL.id, frame: new Uint8Array(1024) });
  await sleep(400);
  ok('09-24 身份闸：非代理发画面帧被丢弃（人类冒充不了代理）', frames.length === 0);

  // ⑦ 授权闸：代理把画面发给"不在控制关系里的第三人"（F 在房间但不是控制端）→ 必须被丢
  AG.s.emit('remote-frame', { to: F.id, frame: new Uint8Array(512) });
  await sleep(400);
  ok('09-24 授权闸：画面不会旁路流给第三人（to 必须正好是控制端）', frames.length === 0);

  // ⑧ 正常路径：授权通过 → 代理的帧抵达控制端（真控闭环打通）
  AG.s.emit('remote-frame', { to: CTL.id, frame: new Uint8Array(2048).fill(7) });
  await sleep(500);
  ok('09-24 正常路径：代理画面帧抵达控制端（真控闭环打通）',
     frames.length === 1 && (frames[0].frame.byteLength || frames[0].frame.length) === 2048);

  // ⑨ 体量闸：超过 900KB 的帧被丢（防"合法身份灌流量"——信任≠免检查）
  //    ★ 帧大小要卡在"超过业务上限 900KB"和"socket.io 单消息上限 1MB"之间。
  //      一开始图省事用了 1MB，结果 socket.io 自己先把连接掐了 ——
  //      那测到的就不是我们的闸门，而是传输层的保护（测错东西比测失败更危险）。
  AG.s.emit('remote-frame', { to: CTL.id, frame: new Uint8Array(950 * 1024) });
  await sleep(500);
  ok('09-24 体量闸：超过 900KB 的帧被丢弃', frames.length === 1);
  ok('09-24 超大帧不会掐断代理连接（一条坏消息不该搞死整条通道）', AG.s.connected === true);

  // ⑩ 元信息通道：代理回报真实 URL/标题/视口 → 控制端地址栏显示真实地址
  let meta = null;
  CTL.s.on('remote-meta', (p) => { meta = p; });
  AG.s.emit('remote-meta', {
    to: CTL.id, url: 'https://example.com/a', title: '示例页', viewport: { width: 1280, height: 800 },
  });
  await sleep(400);
  ok('09-24 代理回报真实 URL/标题/视口（地址栏显示真实状态）',
     !!meta && meta.url === 'https://example.com/a' && !!meta.viewport && meta.viewport.width === 1280);

  // ⑪ 撤权即断：释放控制后画面通道立刻关闭（不能"撤了还留个后门"）
  const beforeRelease = frames.length;
  AG.s.emit('remote-release');
  await sleep(400);
  AG.s.emit('remote-frame', { to: CTL.id, frame: new Uint8Array(256) });
  await sleep(400);
  ok('09-24 撤权后画面通道立即关闭（授权撤了就不该再有帧）', frames.length === beforeRelease);

  // 清理
  AG.s.disconnect();
  CTL.s.disconnect();
  A.s.disconnect();
  AU.s.disconnect();
  B.s.disconnect();
  C.s.disconnect();
  D.s.disconnect();
  F.s.disconnect();
  H.s.disconnect();
  I.s.disconnect();
  M.s.disconnect();
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  stopServer();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('异常:', e.message); stopServer(); process.exit(1); });
