// SFU 版信令测试：模拟多个客户端连 sfu/server.js（端口 3001）
// 验证：房间/密码（复用）+ Router 能力 + Transport 创建/防重 + consume 的错误路径。
// （produce/consume 的真实媒体需要浏览器摄像头，无法命令行模拟——
//   这里能证明 mediasoup Worker/Router/Transport 在服务器端真的能建起来）
// 运行：先起服务器（node sfu/server.js），再 npm run test:sfu
const { io } = require('C:/Users/27418/Desktop/webrtc/node_modules/socket.io-client');
const URL = 'http://localhost:3001';

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
// socket.io 请求-应答：emit(事件, 载荷, 回调)，回调收到 { data } 或 { error }
const request = (s, ev, payload) => new Promise((resolve, reject) => {
  s.emit(ev, payload, (resp) => resp && resp.error ? reject(new Error(resp.error)) : resolve(resp));
});

(async () => {
  const A = await client('A');

  // --- A 创建房间：拿到号（同时验证 ack 应答）---
  const aCreatedP = waitEvent(A.s, 'room-created');
  const aMembersP = waitEvent(A.s, 'room-members');
  const ack = await request(A.s, 'create-room', {});
  ok('A 创建房间 ack 应答 { roomNumber }', /^\d{6}$/.test((ack.data || {}).roomNumber || ''));
  const created = await aCreatedP;
  ok('A 收到 room-created（6 位房间号）', /^\d{6}$/.test(created.roomNumber));
  await aMembersP; // 等 A 进房完成（Router 已建好）
  const ROOM = created.roomNumber;

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
  const apiBody = await new Promise((resolve, reject) => {
    http.get('http://localhost:3001/api/rooms', (r) => {
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
  const dashCode = await new Promise((resolve, reject) => {
    http.get('http://localhost:3001/dashboard', (r) => resolve(r.statusCode)).on('error', reject);
  });
  ok('09-13 /dashboard 面板页可访问（200）', dashCode === 200);

  // --- ★ 09-17e：/api/captions 过夜值守归档（HTTP 层：落盘 / 回读 / 坏输入拒绝）---
  // （注意：本文件顶部 const URL='http://localhost:3001' 遮蔽了全局 URL 构造器，
  //   所以这里用手写正则拆 URL，别用 new URL(...)）
  const httpReq = (method, url, body) => new Promise((resolve, reject) => {
    const m = String(url).match(/^http:\/\/([^:/]+):(\d+)(\/[^?]*)?(\?.*)?$/);
    if (!m) return reject(new Error('bad url: ' + url));
    const rq = http.request({
      hostname: m[1], port: m[2], path: (m[3] || '') + (m[4] || ''), method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
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
  const capBad = await httpReq('POST', 'http://localhost:3001/api/captions', { room: '../../etc', entries: capEntries });
  ok('09-17e 非法房间号被拒（400，路径穿越进不来）', capBad.code === 400);
  const capNoRoom = await httpReq('GET', 'http://localhost:3001/api/captions');
  ok('09-17e GET 缺 room 参数被拒（400）', capNoRoom.code === 400);

  // --- ★ 09-18：/metrics Prometheus 文本格式（G7 可观测性，零依赖）---
  const met = await httpReq('GET', 'http://localhost:3001/metrics');
  ok('09-18 /metrics 返回 Prometheus 文本（含 rooms/members 与 bytes 计数）',
     met.code === 200 && met.text.includes('# TYPE sfu_rooms_total gauge') &&
     met.text.includes('sfu_producer_bytes_total') && /sfu_members_total \d+/.test(met.text));

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
  const aiAskP = waitEvent(A.s, 'chat-message');
  const aiAns = await request(A.s, 'ai-ask', { question: '你好，你是谁？' });
  ok('09-19 ai-ask 应答含答案（无 key 环境 = [Mock] 前缀）',
     !!aiAns.data && !!aiAns.data.answer && aiAns.data.answer.includes('[Mock]'));
  const aiMsg = await Promise.race([aiAskP, sleep(1500).then(() => null)]);
  ok('09-19 ai-ask 的回答以 chat-message(from=ai-bot) 广播全房',
     !!aiMsg && aiMsg.from === 'ai-bot');
  let aiErr = null;
  try { await request(A.s, 'ai-ask', { question: '' }); } catch (e) { aiErr = e.message; }
  ok('09-19 ai-ask 空问题被拒（错误路径正确）', !!aiErr);
  const aiState2P0 = waitEvent(A.s, 'room-state');
  await request(A.s, 'ai-leave', {});
  const aiState2 = await Promise.race([aiState2P0, sleep(800).then(() => null)]);
  ok('09-19 ai-leave 后 room-state 不再含 bot',
     aiState2 && !(aiState2.members || []).some((m) => m.isBot));
  aiErr = null;
  try { await request(A.s, 'ai-ask', { question: '在吗' }); } catch (e) { aiErr = e.message; }
  ok('09-19 bot 不在房时 ai-ask 被拒（明确提示）', !!aiErr);

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
  ok('09-19c ai-minutes 生成纪要（返回文件路径，无 key 环境 mock=true）',
     !!minAck.data && !!minAck.data.file && minAck.data.file.endsWith('.md') && minAck.data.mock === true);
  const minDown = await httpReq('GET', 'http://localhost:3001' + minAck.data.path);
  ok('09-19c 纪要可经 /minutes/<room>/<file> 下载且含统计与待办线索',
     minDown.code === 200 && minDown.text.includes('# 会议纪要') &&
     minDown.text.includes('## 待办线索') && minDown.text.includes('TURN'));
  const minList = await httpReq('GET', `http://localhost:3001/api/minutes?room=${ROOM}`);
  ok('09-19c /api/minutes 列表含刚生成的文件', minList.code === 200 &&
     JSON.parse(minList.text).some((x) => x.name === minAck.data.file));
  const minBad = await httpReq('GET', 'http://localhost:3001/minutes/../../etc/passwd');
  ok('09-19c /minutes 路径穿越被钳制（403/404，绝不定成功）', minBad.code === 403 || minBad.code === 404);
  const recList = await httpReq('GET', 'http://localhost:3001/api/recordings');
  ok('09-19c G3 /api/recordings 列表可用（200 数组）', recList.code === 200 && Array.isArray(JSON.parse(recList.text)));

  // --- ★ 09-19f：SFU 深造（多 Worker 池 + ping 探活）---
  const met2 = await httpReq('GET', 'http://localhost:3001/metrics');
  ok('09-19f /metrics 带 sfu_workers gauge（Worker 池大小）',
     met2.code === 200 && /sfu_workers \d+/.test(met2.text));
  const pingT0 = Date.now();
  const pingResp = await new Promise((resolve) => A.s.emit('ping', {}, (r) => resolve(r)));
  ok('09-19f ping 探活信令回显 ack（RTT 探针可用）',
     !!pingResp && !!pingResp.data && typeof pingResp.data.t === 'number' && Date.now() - pingT0 < 2000);

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

  // 清理
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
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('异常:', e.message); process.exit(1); });
