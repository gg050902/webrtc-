// 信令服务器测试（房间化 + 入会密码版）：模拟多个客户端，验证建房/凭号加入/定向转发/
// 满员/离开/房间号回收，以及"带密码的房间"的创建、错误密码拒绝、正确密码放行
const { io } = require('C:/Users/27418/Desktop/webrtc/node_modules/socket.io-client');
const URL = 'http://localhost:3000';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n); } };

// client(): 建立连接，resolve 为 { s: socket, id: 连接id }
//   ★ 注意 socket.io 客户端的 id 要等 connect 之后拿，所以在这里固化下来
function client(name) {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ['websocket'], reconnection: false });
    s.on('connect', () => resolve({ s, id: s.id }));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error(name + ' timeout')), 5000);
  });
}
const waitEvent = (s, ev) => new Promise(r => s.once(ev, r));

(async () => {
  const A = await client('A');
  const B = await client('B');

  // --- 加入不存在的房间号 → room-not-found ---
  //  '000000' 是合法的 6 位数字，但生成器只发 100000~999999，所以它必然不存在
  const bNotFound = waitEvent(B.s, 'room-not-found');
  B.s.emit('join-room', { roomNumber: '000000' });
  const nfData = await bNotFound;
  ok('加入不存在的房间号 → room-not-found', nfData.roomNumber === '000000');

  // --- A 创建房间：拿到 6 位房间号（房间号输出）---
  const aCreatedP = waitEvent(A.s, 'room-created');
  const aMembersP = waitEvent(A.s, 'room-members');   // 先注册再 emit，防止丢事件
  A.s.emit('create-room');
  const created = await aCreatedP;
  ok('A 创建房间，收到 6 位房间号（room-created）', /^\d{6}$/.test(created.roomNumber));
  const aMembers = await aMembersP;
  ok('A(创建者) 收到 room-members：老成员 0 人', aMembers.members.length === 0);
  const ROOM = created.roomNumber;

  // --- B 凭房间号加入：A 收 new-member；B 收 room-members（只有 A，且带同一个房间号）---
  const aNewB = waitEvent(A.s, 'new-member');
  const bMembersP = waitEvent(B.s, 'room-members');
  B.s.emit('join-room', { roomNumber: ROOM });
  const aNewBData = await aNewB;
  const bMembers = await bMembersP;
  ok('A 被通知有新人 B 加入 (new-member)', aNewBData.id === B.id);
  ok('B 收到 room-members：老成员只有 A，且房间号一致',
     bMembers.members.length === 1 && bMembers.members[0] === A.id && bMembers.roomNumber === ROOM);

  // --- B 作为新人主动发 offer 给 A，A 应收到（带 from=B）---
  const aOffer = waitEvent(A.s, 'offer');
  B.s.emit('offer', { to: A.id, offer: { type: 'offer', sdp: 'sdp-B->A' } });
  const offData = await aOffer;
  ok('offer 定向转发到 A 且来源是 B', offData.from === B.id && offData.offer.sdp === 'sdp-B->A');

  // --- A 回 answer 给 B ---
  const bAnswer = waitEvent(B.s, 'answer');
  A.s.emit('answer', { to: B.id, answer: { type: 'answer', sdp: 'sdp-A->B' } });
  const ansData = await bAnswer;
  ok('answer 定向转发到 B 且来源是 A', ansData.from === A.id && ansData.answer.sdp === 'sdp-A->B');

  // --- ICE 定向转发 ---
  const bIce = waitEvent(B.s, 'ice-candidate');
  A.s.emit('ice-candidate', { to: B.id, candidate: { candidate: 'c 1.2.3.4' } });
  const iceData = await bIce;
  ok('ice-candidate 定向转发到 B', iceData.from === A.id && iceData.candidate.candidate.includes('1.2.3.4'));

  // --- C 也凭房间号加入，A 和 B 都收到 new-member ---
  const C = await client('C');
  const aNewC = waitEvent(A.s, 'new-member');
  const bNewC = waitEvent(B.s, 'new-member');
  const cMembersP = waitEvent(C.s, 'room-members');
  C.s.emit('join-room', { roomNumber: ROOM });
  const [cOnA, cOnB] = await Promise.all([aNewC, bNewC]);
  ok('A、B 都收到新人 C 加入', cOnA.id === C.id && cOnB.id === C.id);
  const cMembers = await cMembersP;
  ok('C 收到 room-members：老成员为 A、B 共 2 人', cMembers.members.length === 2);

  // --- 第 4 名 D 加入应被拒绝 room-full ---
  const D = await client('D');
  const dFull = waitEvent(D.s, 'room-full');
  D.s.emit('join-room', { roomNumber: ROOM });
  const fullData = await dFull;
  ok('D 被拒绝：收到 room-full（max=3）', fullData.max === 3);

  // --- 有人离开，其他人收到 peer-left ---
  const aLeftB = waitEvent(A.s, 'peer-left');
  B.s.disconnect();
  const leftData = await aLeftB;
  ok('B 离开 → A 收到 peer-left(id=B)', leftData.id === B.id);

  // --- 全员走光后房间销毁：新加入者应收到 room-not-found（房间号回收验证）---
  //  顺序有讲究：先 C 走（A 还在线，能收到 C 的 peer-left），再 A 走（房里没人 → 服务器销毁房间）
  const aLeftC = waitEvent(A.s, 'peer-left');
  C.s.disconnect();
  await aLeftC;
  A.s.disconnect();
  // 等 disconnect 事件在服务器处理完（房间销毁）
  await new Promise(r => setTimeout(r, 300));
  const dNotFound = waitEvent(D.s, 'room-not-found');
  D.s.emit('join-room', { roomNumber: ROOM });
  const dNfData = await dNotFound;
  ok('房间空了自动销毁：再加入同号 → room-not-found（号码已回收）', dNfData.roomNumber === ROOM);

  D.s.disconnect();

  // ═══════════════ 入会密码（第 2.9 节）═══════════════
  // --- E 创建"带密码"的房间：create-room 携带 { password } ---
  const E = await client('E');
  const eCreatedP = waitEvent(E.s, 'room-created');
  const eMembersP = waitEvent(E.s, 'room-members');   // 先注册再 emit，防止丢事件
  E.s.emit('create-room', { password: '8888' });
  const eCreated = await eCreatedP;
  ok('E 创建带密码的房间，收到 6 位房间号', /^\d{6}$/.test(eCreated.roomNumber));
  await eMembersP; // 等 E 收到自己的 room-members（老成员 0 人），进房完成
  const PROTECTED_ROOM = eCreated.roomNumber;

  // --- F 用错误密码加入 → room-wrong-password（进不来）---
  const F = await client('F');
  const fWrong = waitEvent(F.s, 'room-wrong-password');
  F.s.emit('join-room', { roomNumber: PROTECTED_ROOM, password: '0000' });
  ok('错误密码加入 → room-wrong-password', (await fWrong).roomNumber === PROTECTED_ROOM);

  // --- F 密码留空加入 → 一样被拒（有锁的房间必须答对密码）---
  const fNoPwd = waitEvent(F.s, 'room-wrong-password');
  F.s.emit('join-room', { roomNumber: PROTECTED_ROOM });
  ok('密码留空加入 → room-wrong-password', (await fNoPwd).roomNumber === PROTECTED_ROOM);

  // --- F 用正确密码加入 → 成功进房（room-members 老成员只有 E）---
  const fOkP = waitEvent(F.s, 'room-members');
  F.s.emit('join-room', { roomNumber: PROTECTED_ROOM, password: '8888' });
  const fOk = await fOkP;
  ok('正确密码加入成功：老成员只有 E',
     fOk.members.length === 1 && fOk.members[0] === E.id && fOk.roomNumber === PROTECTED_ROOM);

  E.s.disconnect();
  F.s.disconnect();

  // ═══════════════ H5 远程桌面 · Phase 1 信令层（远程控制权）═══════════════
  // 模拟：X1 创建房间并共享（被控端），Y 申请控制被允许，Z 再来申请被 busy 拒，
  //       释放后再申请能成功——验证服务器"谁控谁"的登记/互斥/广播/清理。
  // --- X1 建房（被控端）---
  const x1 = await client('X1');
  const x1cP = waitEvent(x1.s, 'room-created');
  const x1mP = waitEvent(x1.s, 'room-members');
  x1.s.emit('create-room');
  const x1c = await x1cP;
  await x1mP;
  const R2 = x1c.roomNumber;

  // --- Y 加入（控制端）---
  const Y = await client('Y');
  const xNewY = waitEvent(x1.s, 'new-member');
  const yM = waitEvent(Y.s, 'room-members');
  Y.s.emit('join-room', { roomNumber: R2 });
  await xNewY;
  await yM;

  // --- Z 加入（旁观者，抢控制用）---
  const Z = await client('Z');
  const xNewZ = waitEvent(x1.s, 'new-member');
  const zM = waitEvent(Z.s, 'room-members');
  Z.s.emit('join-room', { roomNumber: R2 });
  await xNewZ;
  await zM;

  // ① Y 申请控制 X1 → X1 收到 remote-request（from=Y）
  const xGotReq = waitEvent(x1.s, 'remote-request');
  Y.s.emit('remote-request', { to: x1.s.id });
  const reqData = await xGotReq;
  ok('Y 申请控制 X1 → X1 收到 remote-request(from=Y)', reqData.from === Y.s.id);

  // ② X1 允许 → Y 收到 remote-answer(ok)；全房间收到 remote-state(host=X1, ctrl=Y)
  const yAnsP = waitEvent(Y.s, 'remote-answer');
  const xStateP = waitEvent(x1.s, 'remote-state');
  const yStateP = waitEvent(Y.s, 'remote-state');
  x1.s.emit('remote-answer', { to: Y.s.id, ok: true });
  const yAns = await yAnsP;
  ok('X1 允许后 → Y 收到 remote-answer(ok=true)', yAns.ok === true && yAns.from === x1.s.id);
  const [xState, yState] = await Promise.all([xStateP, yStateP]);
  ok('全房收到 remote-state：host=X1, controller=Y',
     xState.hostId === x1.s.id && xState.controllerId === Y.s.id &&
     yState.hostId === x1.s.id && yState.controllerId === Y.s.id);

  // ③ Z 也想控制 X1 → 被 busy 拒绝（remote-answer ok:false reason:busy），X1 不再收到新请求
  const zBusyP = waitEvent(Z.s, 'remote-answer');
  Z.s.emit('remote-request', { to: x1.s.id });
  const zBusy = await zBusyP;
  ok('Z 重复申请 → 被 busy 拒绝', zBusy.ok === false && zBusy.reason === 'busy');

  // ④ Y 主动释放 → 全房收到 remote-state 复位（controller=null）
  const xRelState = waitEvent(x1.s, 'remote-state');
  const zRelState = waitEvent(Z.s, 'remote-state');
  Y.s.emit('remote-release');
  const [xRel, zRel] = await Promise.all([xRelState, zRelState]);
  ok('释放后 → 全房 remote-state 复位(controllerId=null)',
     xRel.hostId === null && xRel.controllerId === null &&
     zRel.hostId === null && zRel.controllerId === null);

  // ⑤ 释放后 Z 再申请 → 这次能通过（X1 收到 remote-request from=Z）
  const zReq2P = waitEvent(x1.s, 'remote-request');
  Z.s.emit('remote-request', { to: x1.s.id });
  const zReq2 = await zReq2P;
  ok('释放后 Z 再申请 → X1 收到 remote-request(from=Z)', zReq2.from === Z.s.id);

  // ⑤-0（H5 远程桌面 Phase 4）被控端"自动拒绝"场景：前端在未开协助时回
  //     ok:false + reason:'not-sharing' → 服务器应把 reason 原样透传给申请者，
  //     申请者才能区分"被拒绝"和"对方没开协助"两种情况。
  const zDenyP = waitEvent(Z.s, 'remote-answer');
  x1.s.emit('remote-answer', { to: Z.s.id, ok: false, reason: 'not-sharing' });
  const zDeny = await zDenyP;
  ok('拒绝带 reason → 申请者收到透传的 not-sharing',
     zDeny.ok === false && zDeny.reason === 'not-sharing');

  // 让 X1 允许 Z，验证"换人控制"也能登记成功
  const zAnsP = waitEvent(Z.s, 'remote-answer');
  const xState2P = waitEvent(x1.s, 'remote-state');
  const zState2P = waitEvent(Z.s, 'remote-state');   // Z 也消费掉自己这条（避免残留影响 ⑥）
  x1.s.emit('remote-answer', { to: Z.s.id, ok: true });
  await zAnsP;
  const xState2 = await xState2P;
  const zState2 = await zState2P;   // controller=Z 那条先被消费掉
  ok('释放后允许 Z → remote-state 更新为 controller=Z',
     xState2.controllerId === Z.s.id && zState2.controllerId === Z.s.id);

  // ⑥ 被控端 X1 离开 → 控制权自动清除（Z 收 remote-state 复位）——验证"被控端走了控制作废"
  const zLeftState = waitEvent(Z.s, 'remote-state');
  const zLeftPeer = waitEvent(Z.s, 'peer-left');
  x1.s.disconnect();
  await zLeftPeer;
  const zLeftSt = await zLeftState;
  ok('被控端离开 → 控制权自动复位(controllerId=null)', zLeftSt.controllerId === null);

  Y.s.disconnect();
  Z.s.disconnect();

  // ═══════════ 升级 A6：限时授权 + 黑名单拒绝（远程协助权限增强）═══════════
  // 模拟：H 建房当被控端，C1 申请并拿到"限时授权"，C2 当旁观者统计广播次数。
  // 覆盖 5 件事：
  //   ① 带 durationMs 的授权 → remote-answer / remote-state 都带 expiresAt
  //   ② 到点 → 服务器自动收回控制权并广播 remote-state 复位（含 expiresAt=null）
  //   ③ 手动释放后定时器被清掉 → 到点不再有"幽灵广播"（防幽灵定时器）
  //   ④ 黑名单拒绝 reason='blocked' 被服务器原样透传给申请者
  //   ⑤ durationMs=0（不限时）→ expiresAt 为 null，授权照样登记成功
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // waitEventT：带超时的等待。服务器"该广播却没广播"时立刻失败，
  // 而不是让整个测试脚本永久挂住（排查问题最怕"卡死没输出"）。
  const waitEventT = (s, ev, ms = 4000) => new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('等待事件 ' + ev + ' 超时')), ms);
    s.once(ev, (d) => { clearTimeout(timer); res(d); });
  });

  const H = await client('H');
  const hCreatedP = waitEventT(H.s, 'room-created');
  const hMembersP = waitEventT(H.s, 'room-members');
  H.s.emit('create-room');
  const hCreated = await hCreatedP;
  await hMembersP;
  const R3 = hCreated.roomNumber;

  const C1 = await client('C1');
  const hNewC1 = waitEventT(H.s, 'new-member');
  const c1M = waitEventT(C1.s, 'room-members');
  C1.s.emit('join-room', { roomNumber: R3 });
  await hNewC1; await c1M;

  const C2 = await client('C2');
  const hNewC2 = waitEventT(H.s, 'new-member');
  const c2M = waitEventT(C2.s, 'room-members');
  C2.s.emit('join-room', { roomNumber: R3 });
  await hNewC2; await c2M;

  // ① C1 申请 → H 允许 1.2 秒 → 广播里必须带 expiresAt
  const hReq1 = waitEventT(H.s, 'remote-request');
  C1.s.emit('remote-request', { to: H.s.id });
  await hReq1;
  const c1Ans1P = waitEventT(C1.s, 'remote-answer');
  const c1State1P = waitEventT(C1.s, 'remote-state');  // 注意：C1 自己也会收到授权广播，先消费掉
  const hState1P = waitEventT(H.s, 'remote-state');
  const c2State1P = waitEventT(C2.s, 'remote-state');
  const tGrant = Date.now();
  H.s.emit('remote-answer', { to: C1.s.id, ok: true, durationMs: 1200 });
  const c1Ans1 = await c1Ans1P;
  await c1State1P;
  const hState1 = await hState1P;
  await c2State1P;
  ok('限时授权：remote-answer 回执带回 expiresAt（≈1.2 秒后）',
     typeof c1Ans1.expiresAt === 'number' &&
     c1Ans1.expiresAt - tGrant >= 1000 && c1Ans1.expiresAt - tGrant <= 2000);
  ok('remote-state 广播带上 expiresAt（两端各自画倒计时用）',
     typeof hState1.expiresAt === 'number' && hState1.controllerId === C1.s.id);

  // ② 到点：服务器自己收回控制权（不依赖任何前端），并广播复位
  const expiredState = await waitEventT(C1.s, 'remote-state', 4000);
  ok('限时授权到期 → 服务器自动广播 remote-state 复位（controllerId/expiresAt 都为 null）',
     expiredState.hostId === null && expiredState.controllerId === null && expiredState.expiresAt === null);

  // ③ 幽灵定时器检查：授权 0.6 秒但 0.05 秒后就手动释放，
  //    等到超过到期时刻再看——如果 clearTimeout 漏了，还会多出一条广播。
  //    ▎先 sleep 150ms "排空"②残留的广播：跨 socket 的到达顺序没有保证
  //      （C1 收到不代表 C2 也收到了），等干净了再挂计数器，基线才准。
  await sleep(150);
  const stateLog = [];
  C2.s.on('remote-state', (d) => stateLog.push(d));
  const hReq2 = waitEventT(H.s, 'remote-request');
  C1.s.emit('remote-request', { to: H.s.id });
  await hReq2;
  const c1Ans2P = waitEventT(C1.s, 'remote-answer');
  H.s.emit('remote-answer', { to: C1.s.id, ok: true, durationMs: 600 });
  await c1Ans2P;
  await sleep(50);
  const beforeRelease = stateLog.length;   // 应 = 1（授权那一条）
  const relStateP = waitEventT(C2.s, 'remote-state');
  H.s.emit('remote-release');
  await relStateP;
  await sleep(900);                        // 跨过原本 600ms 的到期时刻
  ok('限时授权广播到达旁观者 C2（基线 1 条）', beforeRelease === 1);
  ok('手动释放后到期定时器已清除（到点没有幽灵 remote-state 广播）', stateLog.length === 2);

  // ④ 黑名单路径：被控端回 reason='blocked'，服务器要原样透传
  const c1BlockedP = waitEventT(C1.s, 'remote-answer');
  H.s.emit('remote-answer', { to: C1.s.id, ok: false, reason: 'blocked' });
  const c1Blocked = await c1BlockedP;
  ok('黑名单拒绝 reason=blocked → 申请者收到透传（前端据此提示"请勿反复申请"）',
     c1Blocked.ok === false && c1Blocked.reason === 'blocked');

  // ⑤ 不限时（durationMs=0）→ expiresAt 为 null，授权照样登记成功
  const hReq3 = waitEventT(H.s, 'remote-request');
  C1.s.emit('remote-request', { to: H.s.id });
  await hReq3;
  const c1Ans3P = waitEventT(C1.s, 'remote-answer');
  const hState3P = waitEventT(H.s, 'remote-state');
  H.s.emit('remote-answer', { to: C1.s.id, ok: true, durationMs: 0 });
  const c1Ans3 = await c1Ans3P;
  const hState3 = await hState3P;
  ok('durationMs=0（不限时）→ expiresAt=null，但授权照常登记',
     hState3.expiresAt === null && hState3.controllerId === C1.s.id && c1Ans3.expiresAt === null);

  H.s.disconnect();
  C1.s.disconnect();
  C2.s.disconnect();

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('异常:', e.message); process.exit(1); });
