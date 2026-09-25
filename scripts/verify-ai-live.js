/**
 * AI 智能升级的**真服务器端到端验证**（不是单测，是"跑起来看"）
 *
 * ══ 为什么要单独一个脚本 ══
 * 单测证明了逻辑层正确，但**证明不了接线正确**。本项目已经吃过一次这个亏：
 * brain.js 的 Memory 类单测全过，但 RoomBrain 忘了调 memory.push ——
 * 模块对了，集成点断了，"追问不失忆"整个是死的。
 * 所以这一层的任务是：**起真服务器、走真信令、看真结果**，把
 *   信令接线 → 检索 → 记忆 → 意图路由 → 纪要行动项
 * 整条链在真实进程里跑一遍。
 *
 * 用法：node scripts/verify-ai-live.js    （需要真 key；AI_OP_STEP_MS 无关）
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { io } = require('socket.io-client');

const PORT = 3111;
const ROOM = '777777';
const CAP_DIR = path.join(__dirname, '..', 'sfu', 'captions');

let pass = 0; let fail = 0;
const T = (name, fn) => Promise.resolve().then(fn).then(
  () => { pass++; console.log('  ✅ ' + name); },
  (e) => { fail++; console.log('  ❌ ' + name + '\n     ' + (e && e.message)); },
);
const assert = (c, m) => { if (!c) throw new Error(m || '断言失败'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('\n══ AI 智能升级 · 真服务器端到端验证 ══\n');

  // ── 起真服务器 ──
  const logFile = path.join(os.tmpdir(), `ai-verify-${Date.now()}.log`);
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'sfu', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), MEDIASOUP_WORKER_NUM: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logBuf = [];
  const collect = (d) => { const s = d.toString(); logBuf.push(s); fs.appendFileSync(logFile, s); };
  srv.stdout.on('data', collect);
  srv.stderr.on('data', collect);

  let sock = null;
  let capFile = null; let hadCap = false; let backup = null;
  const restore = () => {
    try {
      if (capFile) {
        if (hadCap) fs.writeFileSync(capFile, backup, 'utf8');
        else fs.unlinkSync(capFile);
      }
    } catch (e) { /* 清理失败不影响结论 */ }
  };
  const cleanup = () => {
    try { if (sock) sock.disconnect(); } catch (e) { /* 已断 */ }
    try { srv.kill(); } catch (e) { /* 已退 */ }
    restore();
  };

  // 等媒体引擎就绪（最多 40s）
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (logBuf.join('').includes('媒体引擎就绪')) { ready = true; break; }
    await sleep(500);
  }
  if (!ready) { console.log('❌ 服务器未就绪，日志：' + logBuf.join('').slice(-800)); cleanup(); process.exit(1); }
  console.log('服务器就绪（端口 ' + PORT + '）\n');

  sock = io(`http://127.0.0.1:${PORT}`, { transports: ['websocket'] });
  await new Promise((res, rej) => {
    sock.once('connect', res); sock.once('connect_error', rej); setTimeout(() => rej(new Error('连接超时')), 8000);
  });

  const chatMsgs = [];
  sock.on('chat-message', (m) => chatMsgs.push(m));
  const streams = [];
  sock.on('ai-stream', (s) => streams.push(s));
  void chatMsgs;   // 保留全量记录便于排查（断言走下面的 botMsgs + askAndWait）

  /* ★ 回执协议（本次实测踩到的坑，写清楚免得下次再错）：
   *   服务器统一用 `{ data }` 回成功、`{ error }` 回失败（见 server.js 的 ok/fail）。
   *   第一版脚本直接读 r.started → 永远 undefined → 断言全挂，而真正的原因
   *   （回执包装层）藏在"看起来像是 AI 没工作"的表象后面。**先确认协议再断言**。 */
  const emitAck = (ev, payload, waitMs = 40000) => new Promise((res) => {
    let done = false;
    sock.emit(ev, payload, (r) => { done = true; res(r); });
    setTimeout(() => { if (!done) res({ error: 'ack 超时' }); }, waitMs);
  });
  /* ★ 等待工具的正确写法（本次实测踩到的第二个坑）：
   *   第一版在 emit 之后才清空数组再等 —— 但 emitAck 的**回执先到、答案后到**，
   *   于是"抓到的第一条 ai-bot 消息"很可能是**上一轮**的尾巴。
   *   症状极具迷惑性：明明是记忆/检索的问题（答案答错了），实际是**测试抓错了消息**。
   *   正确做法：**先清空、再发请求、只认请求之后到达的消息**（按 ts 过滤）。 */
  const botMsgs = [];
  sock.on('chat-message', (m) => { if (m.from === 'ai-bot') botMsgs.push(m); });
  async function askAndWait(question, timeoutMs = 60000) {
    const t0 = Date.now();
    botMsgs.length = 0;                    // 清空必须先于 emit
    const ack = await emitAck('ai-ask', { question });
    while (Date.now() - t0 < timeoutMs) {
      const m = botMsgs.find((x) => (x.ts || 0) >= t0);
      if (m) return { ack, msg: m };
      await sleep(150);
    }
    return { ack, msg: null };
  }
  /** 等 ai-stream 的 done 帧 */
  async function waitStreamDone(timeoutMs = 45000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const f = streams.find((s) => s.done && s.id);
      if (f) return f;
      await sleep(200);
    }
    return null;
  }

  // 建房（房间号由服务器随机生成；创建者自动入房）
  const created = await emitAck('create-room', {});
  const roomNumber = created && created.data && created.data.roomNumber;
  if (!roomNumber) { console.log('❌ 建房失败：' + JSON.stringify(created)); cleanup(); process.exit(1); }
  console.log('房间：' + roomNumber + '\n');

  // ── 准备：把"长会"字幕账本写进真 captions 目录（文件名必须用真实房间号）──
  capFile = path.join(CAP_DIR, `cap-${roomNumber}-20260924.jsonl`);
  hadCap = fs.existsSync(capFile);
  backup = hadCap ? fs.readFileSync(capFile, 'utf8') : null;
  const lines = [
    { ts: Date.now() - 60000, name: '张三', text: '先说结论：交付时间定在 11 月 20 日，这个日期不能再动了' },
    { ts: Date.now() - 50000, name: '李四', text: '好的我记下了' },
    ...Array.from({ length: 25 }, (_, i) => ({ ts: Date.now() - 40000 + i * 100, name: '王五', text: `闲聊第 ${i} 条：今天天气不错` })),
    { ts: Date.now() - 5000, name: '李四', text: '压测报告我负责，周五之前提交' },
    { ts: Date.now() - 4000, name: '王五', text: 'TURN 账号密码记得轮换，下周一之前完成' },
  ];
  fs.writeFileSync(capFile, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

  console.log('── ① 检索型问答：关键信息被 25 条闲聊隔开，还能答对吗？──');
  await T('问"交付时间" → 答案包含 11 月 20 日（证明检索真的捞回了第 1 条）', async () => {
    const { ack, msg: botMsg } = await askAndWait('交付时间是什么时候？');
    assert(ack && ack.data && ack.data.started, 'ai-ask 应成功：' + JSON.stringify(ack));
    assert(botMsg, '应有 ai-bot 回复');
    assert(/11\s*月\s*20\s*日/.test(botMsg.text), '答案应含 11 月 20 日，实际：' + botMsg.text);
    assert(botMsg.ai && botMsg.ai.totalDocs >= 28, '应报告检索了全档字幕，实际：' + JSON.stringify(botMsg.ai));
    assert(botMsg.ai.hits > 0, '应有检索命中数，实际：' + JSON.stringify(botMsg.ai));
    console.log('     AI 回答：' + botMsg.text.slice(0, 100));
  });

  console.log('\n── ② 流式打字机 + 证据链元信息 ──');
  await T('ai-stream 有 start/增量/done 三段，且 done 帧带 trace', async () => {
    streams.length = 0;
    await emitAck('ai-ask', { question: '谁负责压测报告？' });
    const doneFrame = await waitStreamDone();
    assert(streams.some((s) => s.start), '应有 start 帧');
    assert(doneFrame, '应有 done 帧');
    assert(typeof doneFrame.trace === 'string' && doneFrame.trace.includes('检索'), 'done 帧应带检索证据链，实际：' + JSON.stringify(doneFrame));
    assert(streams.filter((s) => s.delta).length > 1, '应有多次增量（打字机），实际 ' + streams.filter((s) => s.delta).length + ' 次');
    console.log('     证据链：' + doneFrame.trace + '｜增量 ' + streams.filter((s) => s.delta).length + ' 次');
  });

  console.log('\n── ③ 会话记忆：追问"那他什么时候交" ──');
  await T('追问能结合上文答对（不是只数轮次——要验证记忆真的被用上）', async () => {
    const r1 = await askAndWait('压测报告谁负责？');
    assert(r1.msg, '第一问应有回复');
    const turns1 = (r1.msg.ai && r1.msg.ai.turns) || 0;
    /* ★ 这条断言是本次升级最该被守住的一条：单纯断言"轮次递增"是**假通过**——
     *   轮次只要 push 了就会涨，哪怕 messages 里压根没用上历史。
     *   所以必须断言**追问的答案内容正确**：只有记忆真的进了 prompt，
     *   模型才能知道"他"=李四、"交"=提交压测报告，从而答出"周五之前"。 */
    const r2 = await askAndWait('那他什么时候交？');
    assert(r2.msg, '追问应有回复');
    const turns2 = (r2.msg.ai && r2.msg.ai.turns) || 0;
    assert(turns2 > turns1, `追问轮次应递增（${turns1} → ${turns2}）`);
    assert(/周五/.test(r2.msg.text), '追问答案应结合上文答出"周五之前"，实际：' + r2.msg.text);
    console.log(`     轮次 ${turns1} → ${turns2}；追问答案：${r2.msg.text.slice(0, 90)}`);
  });

  console.log('\n── ④ 意图路由：换个说法也能触发纪要（老正则的失明点）──');
  await T('"帮我整理一下今天聊了啥" → 真的落盘纪要文件（不是只回一句话）', async () => {
    const dir = path.join(__dirname, '..', 'sfu', 'minutes', String(roomNumber));
    const before = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
    const { ack, msg: m } = await askAndWait('帮我整理一下今天聊了啥', 90000);
    assert(ack && ack.data, '应成功：' + JSON.stringify(ack));
    assert(m, '应有回复');
    assert(/纪要已生成|minutes\//.test(m.text), '应真的生成纪要并给出路径，实际：' + m.text);
    assert(m.ai && m.ai.path, '应回传纪要路径，实际：' + JSON.stringify(m.ai));
    assert(m.ai.intent === 'minutes', '意图应被识别为 minutes，实际：' + m.ai.intent);
    const after = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
    assert(after > before, `纪要文件应真的落盘（${before} → ${after}）`);
    console.log('     意图识别：' + m.ai.intent + '（老正则在此句会失明）');
  });

  console.log('\n── ⑤ 纪要内容：结构化行动项（owner/task/due 三字段）──');
  await T('生成的纪要含「## 行动项」表格，且能识别出负责人', async () => {
    const dir = path.join(__dirname, '..', 'sfu', 'minutes', String(roomNumber));
    const files = fs.readdirSync(dir).sort();
    assert(files.length > 0, '应有纪要文件');
    const newest = files[files.length - 1];
    const md = fs.readFileSync(path.join(dir, newest), 'utf8');
    assert(md.includes('## 行动项'), '纪要应含行动项小节：\n' + md.slice(0, 600));
    assert(md.includes('| 负责人 |') && md.includes('| 事项 |'), '行动项应是结构化表格（owner/task/due）');
    assert(/李四|王五|待认领/.test(md), '行动项应有负责人或明确的"待认领"，实际：\n' + md.slice(0, 800));
    console.log('     ── 行动项小节预览 ──');
    const seg = md.split('## 行动项')[1].split('##')[0].trim();
    console.log(seg.split('\n').map((l) => '     ' + l).join('\n'));
  });

  console.log('\n── ⑥ 抗幻觉：问证据里没有的东西 ──');
  await T('问"预算多少钱" → 应承认没提到，而不是编造数字', async () => {
    const { msg: m } = await askAndWait('这个项目预算一共多少钱？');
    assert(m, '应有回复');
    const invented = /\d+\s*(万|元|亿)/.test(m.text) && !/没提到|没有提到|未提及|没有相关|没有找到/.test(m.text);
    assert(!invented, '不该编造预算数字，实际：' + m.text);
    console.log('     AI 回答：' + m.text.slice(0, 100));
  });

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  console.log(`服务器日志：${logFile}`);
  cleanup();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('验证脚本异常：' + (e && e.stack || e));
  process.exit(1);
});
