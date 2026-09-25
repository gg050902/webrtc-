/**
 * ★ 09-25 AI 会议看板 · **真浏览器**端到端验证
 *
 * ══ 为什么必须用真浏览器（而不是又一层 Node 断言）══
 * 本项目已经吃过"模块对、接线断"的亏（brain.js 的记忆忘了 push）。
 * 这一轮新增的东西横跨四层：
 *     字幕上行 → HTTP 入库 → digest 消化 → ai-board 广播 → **真实 DOM 渲染**
 * 前三层可以用 Node 测，但**第四层"渲染"是纯浏览器行为**——
 * 侧栏 tab 能不能切、看板面板会不会渲染、行动项的三字段是不是分开显示的、
 * 未读角标会不会挡住……这些在 Node 里用桩 DOM 断言等于**自欺**（桩不是浏览器）。
 *
 * ══ 怎么做到的（零新依赖）══
 * 复用项目自带的 `agent/cdp.js`（CDP 客户端，本来就是给"真远程桌面"用的）——
 * 它能启动真实 Edge/Chrome、执行 JS、真截图。于是：
 *   ① 起真服务器（临时库，端口 3111）
 *   ② 用 CDP 开真浏览器 → 走**真实 UI 流程**进房（游客 → 预览 → 创建房间）
 *   ③ 用 Node 侧 socket 触发 AI 入会（真信令）
 *   ④ 用 HTTP POST 灌入会议字幕（走的是 client 归档用的**同一个端点**）
 *   ⑤ 在真浏览器里 evaluate 读**真实 DOM**，断言看板真的长出来了
 *   ⑥ 真截图存证（肉眼可核）
 *
 * 用法：node scripts/verify-board-live.js
 *      VERIFY_HEADFUL=1 node scripts/verify-board-live.js   ← 想亲眼看浏览器操作过程时开
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { io } = require('socket.io-client');
const { Cdp } = require('../agent/cdp');

const PORT = 3111;
const BASE = `http://127.0.0.1:${PORT}`;
const CAP_DIR = path.join(__dirname, '..', 'sfu', 'captions');
const OUT_DIR = path.join(__dirname, '..', 'sfu', 'shots');
const DB_FILE = path.join(os.tmpdir(), `board-verify-db-${Date.now()}.json`);

let pass = 0; let fail = 0;
const T = (name, fn) => Promise.resolve().then(fn).then(
  () => { pass++; console.log('  ✅ ' + name); },
  (e) => { fail++; console.log('  ❌ ' + name + '\n     ' + (e && e.message)); },
);
const assert = (c, m) => { if (!c) throw new Error(m || '断言失败'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('\n══ AI 会议看板 · 真浏览器端到端验证 ══\n');

  // ── ① 起真服务器（独立临时库，绝不碰生产数据）──
  const logFile = path.join(os.tmpdir(), `board-verify-${Date.now()}.log`);
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'sfu', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), MEDIASOUP_WORKER_NUM: '1', DB_FILE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logBuf = [];
  const collect = (d) => { const s = d.toString(); logBuf.push(s); fs.appendFileSync(logFile, s); };
  srv.stdout.on('data', collect);
  srv.stderr.on('data', collect);

  let browser = null;
  let sock = null;
  let capFile = null; let hadCap = false; let capBackup = null;
  const cleanup = () => {
    try { if (browser) browser.kill(); } catch (e) { /* 已退 */ }
    try { if (sock) sock.disconnect(); } catch (e) { /* 已断 */ }
    try { srv.kill(); } catch (e) { /* 已退 */ }
    try {
      if (capFile) { if (hadCap) fs.writeFileSync(capFile, capBackup, 'utf8'); else fs.unlinkSync(capFile); }
    } catch (e) { /* 清理失败不影响结论 */ }
    try { fs.unlinkSync(DB_FILE); } catch (e) { /* 无所谓 */ }
  };

  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (logBuf.join('').includes('媒体引擎就绪')) { ready = true; break; }
    await sleep(500);
  }
  if (!ready) { console.log('❌ 服务器未就绪：' + logBuf.join('').slice(-600)); cleanup(); process.exit(1); }
  console.log('服务器就绪（端口 ' + PORT + '，临时库）\n');

  // ── ② Node 侧 socket：注册（首个账号自动 admin）→ 建房 → 邀 AI 入会（真信令）──
  /* ⚠️ 本项目的认证走的是 **socket.io 信令**（auth-register/auth-login），
   *   不是 HTTP 端点——所以必须先连上 socket 才能拿到 token（初版按 HTTP 写，直接 404）。 */
  sock = io(BASE, { transports: ['websocket'] });
  await new Promise((res, rej) => {
    sock.once('connect', res); sock.once('connect_error', rej);
    setTimeout(() => rej(new Error('socket 连接超时')), 8000);
  });
  const emitAck = (ev, payload, waitMs = 30000) => new Promise((res) => {
    let done = false;
    sock.emit(ev, payload, (r) => { done = true; res(r); });
    setTimeout(() => { if (!done) res({ error: 'ack 超时' }); }, waitMs);
  });
  const regAck = await emitAck('auth-register', { username: 'boardverify', password: 'Board#Verify2026' });
  const adminToken = regAck && regAck.data && regAck.data.token;
  assert(adminToken, '应注册成功并拿到 token：' + JSON.stringify(regAck));

  const created = await emitAck('create-room', {});
  const roomNumber = created && created.data && created.data.roomNumber;
  assert(roomNumber, '建房应成功：' + JSON.stringify(created));
  console.log('房间：' + roomNumber + '\n');

  // 灌字幕：先用"会议开始前"的时间戳写一批（供看板消化）
  capFile = path.join(CAP_DIR, `cap-${roomNumber}-20260925.jsonl`);
  hadCap = fs.existsSync(capFile);
  capBackup = hadCap ? fs.readFileSync(capFile, 'utf8') : null;
  fs.writeFileSync(capFile, '', 'utf8');   // 从空开始，避免历史残留干扰断言

  const postCaptions = async (entries) => {
    const r = await fetch(`${BASE}/api/captions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ room: roomNumber, entries }),
    });
    return r.json();
  };

  // ── ④ 启动真浏览器，走真实 UI 流程进房 ──
  console.log('── 启动真实浏览器（CDP 驱动）──');
  /* ⚠️ Cdp 的窗口参数叫 windowSize（不是 width/height），初版写错会导致窗口尺寸静默失效。
   *   额外参数用 Chromium 的**假媒体设备**：无头环境没有真摄像头/麦克风，
   *   不给假设备 getUserMedia 会挂起或报权限错，预览页就过不去。
   *   再加 auto-select 权限，避免弹权限框把流程卡死。 */
  browser = new Cdp({
    headless: !process.env.VERIFY_HEADFUL,
    windowSize: { width: 1280, height: 900 },
    extraArgs: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  await browser.launch();
  console.log('浏览器就绪（' + (process.env.VERIFY_HEADFUL ? '有头' : '无头') + '）');
  await browser.navigate(`${BASE}/`);
  await browser.waitForLoad(20000);
  await sleep(1200);

  // 游客进入 → 预览页 → 进房
  await browser.evaluate(`(() => {
    const g = document.getElementById('authGuestBtn');
    if (g) g.click();
    return true;
  })()`);
  await sleep(900);
  await browser.evaluate(`(() => {
    const b = document.getElementById('pjEnterBtn');
    if (b) b.click();
    return true;
  })()`);
  await sleep(1200);

  // 用房间号加入（Node socket 已经建好房，浏览器直接加入同一个房间）
  await browser.evaluate(`(() => {
    const inp = document.getElementById('roomInput');
    if (inp) { inp.value = '${roomNumber}'; inp.dispatchEvent(new Event('input', { bubbles: true })); }
    const btn = document.getElementById('joinRoomBtn');
    if (btn) { btn.disabled = false; btn.click(); }
    return true;
  })()`);
  await sleep(2500);

  const joined = await browser.evaluate(`(() => ({
    url: location.href,
    panelHidden: (document.getElementById('roomPanel') || {}).classList
      ? document.getElementById('roomPanel').classList.contains('hidden') : null,
    tabs: document.querySelectorAll('.side-tab').length,
  }))()`);
  console.log('浏览器状态：' + JSON.stringify(joined) + '\n');

  await T('真浏览器已进入房间（房间面板收起 = 入房成功）', () => {
    assert(joined.panelHidden === true, '房间面板应已隐藏，实际 hidden=' + joined.panelHidden);
  });
  await T('侧栏出现三个分段（成员 / 看板 / 聊天）', () => {
    assert(joined.tabs === 3, '应有 3 个 tab，实际 ' + joined.tabs);
  });

  // ── ⑤ 灌入会议字幕（走 client 归档用的同一个端点）──
  const t0 = Date.now();
  const meeting = [
    { ts: t0 + 1, name: '张三', text: '先说结论：交付时间定在 11 月 20 日，这个日期不能再动了' },
    { ts: t0 + 2, name: '李四', text: '好的我记下了' },
    { ts: t0 + 3, name: '王五', text: '我担心联调时间来不及，风险比较大' },
    { ts: t0 + 4, name: '李四', text: '压测报告我负责，周五之前提交' },
    { ts: t0 + 5, name: '张三', text: 'TURN 账号密码记得轮换，下周一之前完成' },
    { ts: t0 + 6, name: '张三', text: '下一个议题是跨网连接怎么做' },
    { ts: t0 + 7, name: '王五', text: '那就这么定了，采用 A 方案' },
    { ts: t0 + 8, name: '张三', text: '今天天气不错' },
    { ts: t0 + 9, name: '李四', text: '午饭吃什么' },
  ];
  const posted = await postCaptions(meeting);
  await T('字幕入库成功（模拟 client 归档上行）', () => {
    assert(posted && posted.saved === meeting.length, '应 saved=' + meeting.length + '，实际 ' + JSON.stringify(posted));
  });

  await sleep(1500);   // 等 ai-board 广播抵达浏览器并渲染

  // ── ⑥ 读真实 DOM：看板长出来了吗 ──
  const board = await browser.evaluate(`(() => {
    const tab = document.querySelector('.side-tab[data-side="board"]');
    if (tab) tab.click();
    const items = [...document.querySelectorAll('#boardList .board-item')];
    const secs = [...document.querySelectorAll('#boardList .board-sec-h')].map((e) => e.textContent.trim());
    return {
      emptyHidden: (document.getElementById('boardEmpty') || { classList: null }).classList
        ? document.getElementById('boardEmpty').classList.contains('hidden') : null,
      num: (document.getElementById('boardNum') || {}).textContent,
      secs,
      count: items.length,
      texts: items.map((e) => e.textContent.replace(/\\s+/g, ' ').trim()),
      classes: items.map((e) => e.className),
      todoOwnerless: [...document.querySelectorAll('#boardList .bi-ownerless')].length,
      dueChips: [...document.querySelectorAll('#boardList .bi-due')].map((e) => e.textContent.trim()),
    };
  })()`);
  console.log('看板 DOM：' + JSON.stringify({ secs: board.secs, count: board.count, num: board.num }) + '\n');

  await T('★ 看板在真浏览器里渲染出了条目', () => {
    assert(board.count >= 4, `应至少渲染 4 条看板条目，实际 ${board.count}`);
  });
  await T('★ 四个栏目按"决定/风险/行动项/议题"出现', () => {
    const joined2 = board.secs.join(' | ');
    assert(/决定/.test(joined2), '应有「决定」栏目，实际：' + joined2);
    assert(/风险/.test(joined2), '应有「风险」栏目，实际：' + joined2);
    assert(/行动项/.test(joined2), '应有「行动项」栏目，实际：' + joined2);
    assert(/议题/.test(joined2), '应有「议题」栏目，实际：' + joined2);
  });
  await T('★ 闲聊绝不出现在看板里（精度是看板的生命线）', () => {
    const all = board.texts.join(' ');
    assert(!/天气/.test(all), '闲聊"今天天气不错"不该进看板，实际：' + all);
    assert(!/午饭/.test(all), '闲聊"午饭吃什么"不该进看板，实际：' + all);
  });
  await T('★ 行动项渲染出期限徽标与「待认领」标记', () => {
    assert(board.dueChips.length >= 1, '应有期限徽标，实际 ' + JSON.stringify(board.dueChips));
    assert(board.todoOwnerless >= 1, '应有「待认领」标记（TURN 轮换那条无主），实际 ' + board.todoOwnerless);
  });
  await T('看板角标显示条目数', () => {
    const n = Number(board.num);
    assert(Number.isFinite(n) && n === board.count, `角标(${board.num}) 应等于条目数(${board.count})`);
  });
  await T('看板面板替换了空状态（空提示应已隐藏）', () => {
    assert(board.emptyHidden === true, '有条目时"空状态提示"应隐藏，实际 hidden=' + board.emptyHidden);
  });

  // ── ⑦ 真截图存证 ──
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const shot = path.join(OUT_DIR, 'ai-board-live.png');
    // ⚠️ cdp.screenshot() 直接返回 Buffer（不是 { data: base64 }）——按返回值直接用
    const buf = await browser.screenshot({ format: 'png' });
    fs.writeFileSync(shot, buf);
    console.log('\n📸 截图存证：' + shot);
  } catch (e) {
    console.log('\n（截图失败，不影响断言结论：' + e.message + '）');
  }

  // ── ⑧ AI 入会 → 看板 tab 应能收到主动提醒 ──
  console.log('\n── AI 入会与主动参与 ──');
  const botMsgs = [];
  sock.on('chat-message', (m) => { if (m.from === 'ai-bot') botMsgs.push(m); });
  const joinAck = await emitAck('ai-join', {});
  await T('AI 助理入会成功', () => {
    assert(joinAck && joinAck.data && joinAck.data.aiBot === true, 'ai-join 应成功：' + JSON.stringify(joinAck));
  });
  await sleep(1200);
  await T('★ AI 在真浏览器里发出入会致辞（气泡出现在聊天分段）', async () => {
    const r = await browser.evaluate(`(() => {
      const t = document.querySelector('.side-tab[data-side="chat"]');
      if (t) t.click();
      const msgs = [...document.querySelectorAll('#chatList .msg')];
      return msgs.map((m) => m.textContent.replace(/\\s+/g, ' ').trim());
    })()`);
    const hit = r.find((x) => /已作为参会者入会|大家好/.test(x));
    assert(hit, '聊天里应出现入会致辞，实际消息：' + JSON.stringify(r).slice(0, 300));
  });

  // 灌一条"无主行动项" → AI 应主动开口（这是"主动参会"的可见证据）
  botMsgs.length = 0;
  await postCaptions([{ ts: Date.now() + 100, name: '张三', text: '灰度发布的分支需要合并一下，尽快' }]);
  let spoke = null;
  for (let i = 0; i < 30 && !spoke; i++) {
    spoke = botMsgs.find((m) => /待认领|还没有负责人|认领/.test(m.text || ''));
    if (!spoke) await sleep(300);
  }
  await T('★ AI 主动提醒无主行动项（不再"被问才答"）', () => {
    assert(spoke, '应主动发一条"还没有负责人"的提醒，实收：' + JSON.stringify(botMsgs.map((m) => m.text).slice(0, 3)));
    console.log('     🤖 主动发言：' + spoke.text.slice(0, 100));
  });

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  console.log(`服务器日志：${logFile}`);
  cleanup();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('验证脚本异常：' + (e && e.stack || e));
  process.exit(1);
});
