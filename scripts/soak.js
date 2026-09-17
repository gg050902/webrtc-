// ★ scripts/soak.js —— 服务器侧耐久自测（过夜值守 ≥7 小时，AI 线 C3-N1 的自动化验收件）
// ▎背景：C3-N1「过夜值守」把会议系统从"一小时的会"推向"挂一夜的服务"。
//   前端那一半（字幕看门狗/溢出归档/值守统计）只能真浏览器过夜验证（0.2 节待验证清单），
//   但**服务器这一半可以命令行自动验证**——本脚本就是干这个的：
//   起一个真房间常驻连接，按设定时长持续制造三类流量（信令消息 / 字幕归档 POST /
//   面板快照 GET），全程心跳采样内存，结束时出报告并对账"POST 的行数 == GET 回读的行数"。
// ▎怎么用：
//   npm run soak                      # 正经过夜：默认 7 小时，早上看报告
//   npm run soak -- --minutes 2      # 压缩自测（几分钟验证链路全通）
//   node scripts/soak.js --hours 1 --rate 20 --url http://localhost:3001
// ▎退出码：0 = 全程零错误且归档对账一致；1 = 有错误/对账不平（CI 或睡前自检可用）。
// ▎心跳落盘：sfu/logs/soak-<启动时刻>.log（每 10 分钟一行 + 结束报告），早上可回放整夜。
const path = require('path');
const fs = require('fs');
const { io } = require(path.join(__dirname, '..', 'node_modules', 'socket.io-client'));

// ---- 参数解析（手写，零依赖）-------------------------------------------------
const args = process.argv.slice(2);
const argOf = (name, dft) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dft;
};
const URL_BASE = argOf('--url', 'http://localhost:3001');
const HOURS = parseFloat(argOf('--hours', '7'));
const MINUTES = parseFloat(argOf('--minutes', '0'));
const RATE = Math.max(1, parseInt(argOf('--rate', '6'), 10)); // 每分钟模拟的字幕条数
const DURATION_MS = Math.round((MINUTES > 0 ? MINUTES * 60000 : HOURS * 3600000));

// ---- 状态台账 ---------------------------------------------------------------
const state = {
  start: Date.now(),
  msgs: 0,          // 信令聊天条数（信令通路的活性证明）
  posts: 0,         // 归档 POST 次数
  archived: 0,      // 成功落盘的归档条数（按服务器应答 saved 累加）
  gets: 0,          // /api/rooms 健康检查次数
  reconnects: 0,    // 断线自动重连次数（socket.io 自动重连，这里只记账）
  errors: 0,        // 一切异常（健康检查非 200 / 归档失败 / 回读对账不平）
};
const LOG_DIR = path.join(__dirname, '..', 'sfu', 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const LOG_FILE = path.join(LOG_DIR, `soak-${stamp}.log`);
const heartbeat = (line) => {
  const text = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${line}`;
  console.log(text);
  try { fs.appendFileSync(LOG_FILE, text + '\n'); } catch (e) { /* 日志写不进不影响跑 */ }
};
const rss0 = process.memoryUsage().rss;

// ---- 主流程 ------------------------------------------------------------------
(async () => {
  heartbeat(`🌙 soak 启动：目标时长 ${DURATION_MS >= 3600000 ? (DURATION_MS / 3600000).toFixed(1) + ' 小时' : (DURATION_MS / 60000).toFixed(1) + ' 分钟'} · 归档流量 ${RATE} 条/分钟 · 服务器 ${URL_BASE} · 心跳文件 ${path.basename(LOG_FILE)}`);

  const socket = io(URL_BASE, { transports: ['websocket'], reconnection: true });
  const waitEvent = (ev) => new Promise((r) => socket.once(ev, r));
  const request = (ev, payload) => new Promise((resolve, reject) => {
    socket.emit(ev, payload, (resp) => (resp && resp.error ? reject(new Error(resp.error)) : resolve(resp)));
  });
  socket.on('disconnect', (reason) => {
    state.reconnects++;
    heartbeat(`⚠️ 连接断开（${reason}），等待 socket.io 自动重连（第 ${state.reconnects} 次）`);
  });

  // 1) 建房（拿 6 位号，同时证明信令 + 房间链路活着）
  const createdP = waitEvent('room-created');
  await request('create-room', {});
  const { roomNumber } = await createdP;
  heartbeat(`✅ 房间已建：${roomNumber}（值守期间保持常驻连接）`);

  // 2) 三类定时流量：字幕归档 POST（每分钟 rate 条）/ 面板健康 GET（每 30s）/ 心跳（每 10 分钟）
  const entryOf = (n) => ({
    ts: Date.now(),
    from: 'soak-bot',
    name: '值守模拟',
    text: `soak 模拟字幕第 ${n} 条（room ${roomNumber}）`,
  });
  const postOnce = async () => {
    const entries = [];
    for (let i = 0; i < RATE; i++) entries.push(entryOf(state.archived + i + 1));
    try {
      const res = await fetch(`${URL_BASE}/api/captions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: String(roomNumber), entries }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { saved } = await res.json();
      state.archived += saved;
      state.posts++;
    } catch (err) {
      state.errors++;
      heartbeat(`❌ 归档上传失败：${err.message}`);
    }
  };
  const healthOnce = async () => {
    try {
      const res = await fetch(`${URL_BASE}/api/rooms`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const snap = await res.json();
      state.gets++;
      const mine = (snap.rooms || []).some((r) => String(r.roomNumber) === String(roomNumber));
      if (!mine) throw new Error('快照里找不到本房间（房间可能被销毁）');
    } catch (err) {
      state.errors++;
      heartbeat(`❌ 健康检查失败：${err.message}`);
    }
  };

  const timers = [];
  timers.push(setInterval(postOnce, 60000));   // 每分钟一批归档（真实前端约这个量级）
  timers.push(setInterval(healthOnce, 30000)); // 每 30s 面板快照（等价 dashboard 的轮询）
  const hbTimer = setInterval(() => {
    const mins = (Date.now() - state.start) / 60000;
    const mem = process.memoryUsage();
    heartbeat(`🌙 心跳：已跑 ${mins.toFixed(1)} 分钟 · 信令消息 ${state.msgs} · 归档 ${state.archived} 条（${state.posts} 次 POST）· 健康检查 ${state.gets} 次 · 重连 ${state.reconnects} · 错误 ${state.errors} · rss ${(mem.rss / 1048576).toFixed(0)}MB（起点 ${(rss0 / 1048576).toFixed(0)}MB）`);
  }, 10 * 60000);
  timers.push(hbTimer);
  postOnce(); // 启动立刻来一批，别让前 60 秒空转
  healthOnce();

  // 3) 信令消息流量：每 2s 一条聊天（广播回自己 = 信令全链路持续被验证）
  timers.push(setInterval(() => {
    if (!socket.connected) return; // 断线重连期间跳过（重连本身就是被测能力之一）
    state.msgs++;
    socket.emit('chat-message', { text: `soak 心跳消息 #${state.msgs}`, msgId: `soak-${state.msgs}` });
  }, 2000));

  // 4) 到点收工：清定时器 → 对账 → 报告 → 退出码
  const deadline = setTimeout(finish, DURATION_MS);
  process.on('SIGINT', () => { heartbeat('收到 Ctrl+C，提前收工出报告'); finish(); });

  let finished = false;
  async function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(deadline);
    timers.forEach(clearInterval);
    // 对账：POST 累计的条数 == GET 回读的行数（值守"一条不丢"的核心断言）
    let back = -1;
    try {
      const res = await fetch(`${URL_BASE}/api/captions?room=${roomNumber}&format=json`);
      if (res.ok) back = (await res.json()).length;
      else throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      state.errors++;
      heartbeat(`❌ 归档回读失败：${err.message}`);
    }
    const mins = ((Date.now() - state.start) / 60000).toFixed(1);
    const mem = process.memoryUsage();
    const balanced = back === state.archived;
    heartbeat('──────────── 值守报告 ────────────');
    heartbeat(`时长 ${mins} 分钟 · 房间 ${roomNumber} · 信令消息 ${state.msgs} 条 · 断线重连 ${state.reconnects} 次`);
    heartbeat(`归档：POST ${state.posts} 次共 ${state.archived} 条 · 回读 ${back} 条 · ${balanced ? '✅ 对账一致' : '❌ 对账不平'}`);
    heartbeat(`健康检查 ${state.gets} 次 · 错误 ${state.errors} · rss ${(mem.rss / 1048576).toFixed(0)}MB（起点 ${(rss0 / 1048576).toFixed(0)}MB）`);
    heartbeat(balanced && state.errors === 0 ? '✅ PASS（零错误且一条不丢）' : '❌ FAIL（存在错误或对账不平，见上）');
    try { socket.disconnect(); } catch (e) { /* 已断则忽略 */ }
    process.exit(balanced && state.errors === 0 ? 0 : 1);
  }
})().catch((err) => {
  console.error(`soak 启动失败：${err.message}（服务器没起？先 npm run start:sfu）`);
  process.exit(1);
});
