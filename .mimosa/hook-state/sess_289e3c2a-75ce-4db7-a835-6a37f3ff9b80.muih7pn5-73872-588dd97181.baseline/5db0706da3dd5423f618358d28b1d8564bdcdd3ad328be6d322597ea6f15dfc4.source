// ★ scripts/bench-signaling.js —— 信令压测（G8-③，09-19f · SFU 深造的"数字"部分）
// ▎是什么：模拟 N 个真实 socket.io 客户端（8 人/房分组建房+加入），持续做两件事：
//   ① 每 client 每 2s 发一次 ping 探活信令（服务器回显 ack）——量 RTT 分布 p50/p95/max；
//   ② 每 client 每 5s 发一条 chat-message（服务器广播回全房=8×放大量）——量事件吞吐。
// ▎用法：
//   npm run bench:signaling                          # 默认 32 客户端 / 4 房 / 20 秒
//   npm run bench:signaling -- --clients 64 --seconds 30
// ▎退出码：连接成功率 100% 且 ping p95 < 1000ms → PASS(0)，否则 FAIL(1)。
// ▎诚实声明：它压的是**信令+房间管理面**（Node 单进程），不是媒体转发面
//   （媒体面看 npm run bench —— 那个才是 16 发 16 收的 RTP 数字）。
const path = require('path');
const { io } = require(path.join(__dirname, '..', 'node_modules', 'socket.io-client'));

const args = process.argv.slice(2);
const argOf = (name, dft) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dft;
};
const BASE = argOf('--url', 'http://localhost:3001');
const CLIENTS = Math.max(8, parseInt(argOf('--clients', '32'), 10));
const SECONDS = Math.max(5, parseInt(argOf('--seconds', '20'), 10));
const ROOM_SIZE = 8; // maxMembers=8：每房 1 房主 + 7 成员

const rtt = [];
let connected = 0, connectFail = 0, chats = 0, chatsRecv = 0;
const start = Date.now();

function percentile(arr, p) {
  if (!arr.length) return -1;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

(async () => {
  console.log(`🚀 信令压测：${CLIENTS} 客户端（${Math.ceil(CLIENTS / ROOM_SIZE)} 房 × ${ROOM_SIZE} 人）× ${SECONDS}s @ ${BASE}`);
  const sockets = [];
  // ① 分批建立连接并进房（第一批建房拿号，后续凭号加入）
  let firstRoom = null;
  for (let i = 0; i < CLIENTS; i++) {
    const s = io(BASE, { transports: ['websocket'], reconnection: false });
    sockets.push(s);
    const okJoin = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 8000);
      s.on('connect', async () => {
        if (firstRoom && i % ROOM_SIZE !== 0) {
          s.emit('join-room', { roomNumber: firstRoom, password: null }, () => {});
          clearTimeout(timer); resolve(true);
        } else {
          const createdP = new Promise((r2) => s.once('room-created', (p) => r2(p)));
          s.emit('create-room', {}, () => {});
          const { roomNumber } = await createdP;
          if (!firstRoom) firstRoom = roomNumber;
          clearTimeout(timer); resolve(true);
        }
      });
      s.on('connect_error', () => { clearTimeout(timer); resolve(false); });
    });
    const ok = await okJoin;
    if (ok) { connected++; s._room = true; } else connectFail++;
    // 防止建房/加入过快击穿（教学服务器也要按住节奏）
    if (i % 16 === 15) await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`✅ 连接+进房：${connected}/${CLIENTS}（失败 ${connectFail}）`);

  // ② 流量阶段
  // ★ 09-19h 实修：chat-message 监听必须只挂一次（原实现挂在 setInterval 里，
  //   每 tick 重复叠加监听器 → chatsRecv 被重复计数，放大倍数虚高）。
  sockets.forEach((s) => s.on('chat-message', () => chatsRecv++));
  const timer = setInterval(() => {
    for (const s of sockets) {
      if (!s._room) continue;
      // ping RTT 探针
      const t0 = Date.now();
      s.emit('ping', {}, (resp) => {
        if (resp && resp.data) rtt.push(Date.now() - resp.data.t);
      });
      // 聊天广播负载（服务器 ×房间人数 放大转发）
      s.emit('chat-message', { text: `bench #${chats}`, msgId: `bench-${chats++}` });
    }
  }, 1000);

  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  clearInterval(timer);

  // ③ 报告
  const secs = (Date.now() - start) / 1000;
  const p50 = percentile(rtt, 50), p95 = percentile(rtt, 95), mx = percentile(rtt, 100);
  console.log('──────────── 信令压测报告 ────────────');
  console.log(`客户端 ${CLIENTS}（房 ${Math.ceil(CLIENTS / ROOM_SIZE)}）· 压测 ${SECONDS}s · 连接成功 ${connected}/${CLIENTS}`);
  console.log(`ping RTT：样本 ${rtt.length} · p50=${p50}ms · p95=${p95}ms · max=${mx}ms`);
  console.log(`聊天：发出 ${chats} 条 → 服务器广播回包 ${chatsRecv} 条（≈${(chatsRecv / Math.max(1, chats)).toFixed(1)}× 放大）· 吞吐 ≈${Math.round(chats / secs)}/s 发出`);
  const pass = connected === CLIENTS && p95 >= 0 && p95 < 1000;
  console.log(pass ? '✅ PASS（连接全成功且 p95 < 1s）' : '❌ FAIL（连接有失败或 p95 ≥ 1s）');
  sockets.forEach((s) => { try { s.disconnect(); } catch (e) { /* 已断 */ } });
  process.exit(pass ? 0 : 1);
})().catch((err) => {
  console.error('压测启动失败：', err.message);
  process.exit(1);
});
