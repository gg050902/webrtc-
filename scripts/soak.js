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
//   默认**不需要任何 token**：值守脚本模拟的是普通参会者，用它进房拿到的房间令牌即可
//   ADMIN_TOKEN=<token> npm run soak  # 可选：加上它才会顺带核对 /api/rooms 全景快照
// ▎ADMIN_TOKEN 怎么拿：会议页用管理员账号登录 → 控制台 JSON.parse(localStorage.wb_auth).token
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
// ★ 09-24 G8：归档/快照接口已加管理员门禁，不带 token 会一路 401（看着像"服务器坏了"）
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;
const AUTH_HEADERS = ADMIN_TOKEN ? { Authorization: `Bearer ${ADMIN_TOKEN}` } : {};

// ---- 状态台账 ---------------------------------------------------------------
const state = {
  start: Date.now(),
  msgs: 0,          // 信令聊天条数（信令通路的活性证明）
  posts: 0,         // 归档 POST 次数
  archived: 0,      // 成功落盘的归档条数（按服务器应答 saved 累加）
  gets: 0,          // /api/rooms 健康检查次数
  reconnects: 0,    // 断线自动重连次数（socket.io 自动重连，这里只记账）
  errors: 0,        // 一切异常（健康检查非 200 / 归档失败 / 回读对账不平）
  /* ★ 2026-10-03 字幕延迟采样（来自服务器 collab.capLat，不在脚本里另算一份）。
   *   capLatSamples 存的是**每次心跳时的累计均值**——所以最终报告里那句"整夜均值"
   *   其实是"各次快照均值的均值"，略偏乐观（早期快样本会拉低），
   *   但趋势与超阈值次数是准的；要精确值请读 /metrics。这行注释就是为了别把它当精确值。 */
  capLatSamples: [],
  capLatOver: 0,
};
const CAP_LAT_WARN_MS = Math.max(1000, Number(process.env.SOAK_CAP_LAT_WARN_MS) || 6000);
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
  /* ★ 2026-10-03 抓**房间内令牌**（09-24 C4：进房成功时服务器单播给本人，游客也有）。
   *   soak 是"门禁上线后没人管的那批脚本"之一：它还按"归档接口不要凭证"跑，
   *   于是整条耐久自测每天 401、报"对账不平"——数字看着像服务器坏了，其实是脚本自己过期。
   *   同坑 57 那条纪律：**同一个改动只迁移一半 = 等于没迁移**。
   *   监听器必须在 create-room 之前注册（坑 3），所以这里用一次性 Promise。 */
  const tokenP = new Promise((resolve) => {
    socket.once('room-members', (p) => resolve((p && p.roomToken) || ''));
  });
  await request('create-room', {});
  const { roomNumber } = await createdP;
  const roomToken = await tokenP;
  const ROOM_HEADERS = roomToken ? { 'X-Room-Token': roomToken } : {};
  if (!roomToken) heartbeat('⚠️ 没拿到房间令牌——归档会失败（服务器版本过旧？或 roomTokenRequired 被关）');
  heartbeat(`✅ 房间已建：${roomNumber}（值守期间保持常驻连接${roomToken ? '，已取到房间令牌' : ''}）`);

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
        headers: { 'Content-Type': 'application/json', ...ROOM_HEADERS },
        body: JSON.stringify({ room: String(roomNumber), entries }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}${res.status === 401 ? '（需要 ADMIN_TOKEN）' : ''}`);
      const { saved } = await res.json();
      state.archived += saved;
      state.posts++;
    } catch (err) {
      state.errors++;
      heartbeat(`❌ 归档上传失败：${err.message}`);
    }
  };
  const healthOnce = async () => {
    /* ★ 2026-10-03 分两档：**没给 ADMIN_TOKEN 就只探"服务活着"**（/config.json 是公开端点），
     *   给了才去核对全景快照。绝不把"我没权限"报成"服务不可用"——
     *   这条区分 09-24 那轮已经写进 watch.js，当时就是漏了 soak。 */
    if (!ADMIN_TOKEN) {
      try {
        const res = await fetch(`${URL_BASE}/config.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await res.json();
        state.gets++;
      } catch (err) {
        state.errors++;
        heartbeat(`❌ 存活探测失败：${err.message}`);
      }
      return;
    }
    try {
      const res = await fetch(`${URL_BASE}/api/rooms`, { headers: AUTH_HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}${res.status === 401 ? '（需要 ADMIN_TOKEN）' : ''}`);
      const snap = await res.json();
      state.gets++;
      const mine = (snap.rooms || []).some((r) => String(r.roomNumber) === String(roomNumber));
      if (!mine) throw new Error('快照里找不到本房间（房间可能被销毁）');
      /* ★ 2026-10-03 第 39 步续：长跑期间顺手把**字幕延迟**记进心跳。
       * ▎为什么值得加：soak 原来只回答"有没有断"，答不了"通的时候有多慢"——
       *   而挂一夜最想知道的恰恰是后者（早上拿到 7 小时字幕，值不值得看取决于滞后多大）。
       *   数据来自服务器累计的 collab.capLat（与 /metrics、界面读数同一个来源，不另算一份）。
       * ▎只在**真的量到过**时记录：本自测推的是脚本归档、不是真音频，
       *   所以多数夜晚 n=0 —— 那就如实写"未采到"，绝不编一个数（同坑 57/65 的判据）。 */
      const cl = ((snap.collab || {}).capLat) || {};
      if (cl.n > 0) {
        const avg = cl.sum / cl.n;
        state.capLatSamples.push(avg);
        if (avg > CAP_LAT_WARN_MS) {
          state.capLatOver++;
          heartbeat(`⚠️ 字幕延迟均值 ${(avg / 1000).toFixed(1)}s 超阈值（${cl.n} 句，最慢 ${(cl.max / 1000).toFixed(1)}s）`);
        }
      }
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
      const res = await fetch(`${URL_BASE}/api/captions?room=${roomNumber}&format=json`, { headers: ROOM_HEADERS });
      if (res.ok) back = (await res.json()).length;
      else throw new Error(`HTTP ${res.status}${res.status === 401 ? '（需要 ADMIN_TOKEN）' : ''}`);
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
    /* ★ 2026-10-03 字幕延迟一行：**如实说"有没有采到"**。
     *   本自测推的是脚本生成的归档、不是真音频，所以多数夜晚 n=0 ——
     *   那不是失败，而是"这条指标今晚没有被 exercising"；
     *   把它写成 ❌ 会让人去查一个不存在的问题（同坑 57 的反面：假红也伤人）。
     *   真有语音时（开着 AI 助理挂一夜）这里就有数了，而且超阈值只告警不计错——
     *   延迟是"体验指标"，让它把一夜的自测判成 FAIL 会掩盖真正的可用性问题。 */
    if (state.capLatSamples.length) {
      const avgAll = state.capLatSamples.reduce((a, b) => a + b, 0) / state.capLatSamples.length;
      heartbeat(`字幕延迟：${state.capLatSamples.length} 次采样 · 快照均值 ${(avgAll / 1000).toFixed(1)}s · `
        + `最慢快照 ${(Math.max(...state.capLatSamples) / 1000).toFixed(1)}s · 超阈值(${CAP_LAT_WARN_MS / 1000}s) ${state.capLatOver} 次`
        + `  ${state.capLatOver ? '⚠️（精确值读 /metrics）' : '✅'}`);
    } else {
      heartbeat('字幕延迟：本次未采到（本自测不推真音频；要量这条请开 AI 助理说真话，或跑 npm run test:asr-live）');
    }
    heartbeat(`健康检查 ${state.gets} 次 · 错误 ${state.errors} · rss ${(mem.rss / 1048576).toFixed(0)}MB（起点 ${(rss0 / 1048576).toFixed(0)}MB）`);
    heartbeat(balanced && state.errors === 0 ? '✅ PASS（零错误且一条不丢）' : '❌ FAIL（存在错误或对账不平，见上）');
    try { socket.disconnect(); } catch (e) { /* 已断则忽略 */ }
    process.exit(balanced && state.errors === 0 ? 0 : 1);
  }
})().catch((err) => {
  console.error(`soak 启动失败：${err.message}（服务器没起？先 npm run start:sfu）`);
  process.exit(1);
});
