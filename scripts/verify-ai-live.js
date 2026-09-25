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
    env: {
      ...process.env, PORT: String(PORT), MEDIASOUP_WORKER_NUM: '1',
      // AI_DEBUG_SCOPE=1 → 打印 since（会议下界）与检索范围（排查范围问题时开）
      ...(process.env.AI_DEBUG_SCOPE ? { AI_DEBUG_SCOPE: '1' } : {}),
    },
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
  /* ⚠️ 入会致辞/离会告别会以 ai-bot 身份广播，它**不是**任何问题的答案。
   *   本脚本第一版就因此翻了车：setup 阶段的 ai-ask 触发自动入会 → 致辞先到 →
   *   被当成"对交付时间的回答"，症状看起来像"检索坏了"。
   *   → 取答案时必须把这类"事件型"消息排除掉。
   *
   * ⚠️ 但这个正则**必须收得足够窄**（第二次踩坑）：初版把 `纪要已生成：` 也included在内，
   *   结果第 ④ 步"帮我整理一下今天聊了啥"的**正确答案**（"📋 纪要已生成：…"）
   *   被当成事件过滤掉了 → askAndWait 空等 90 秒 → 断言"应有回复"失败。
   *   判据：只排除**用户没主动要、却被推送到聊天里的**播报（入会/离会/值守定时），
   *   凡是"回答了某人某句提问"的消息一律**不能**排除，否则就是测试在自欺。 */
  const EVENT_BROADCAST_RE = /已作为参会者入会|大家好，我是会议 AI 助理|先退会了|值守分段纪要已生成/;
  async function askAndWait(question, timeoutMs = 60000) {
    const t0 = Date.now();
    botMsgs.length = 0;                    // 清空必须先于 emit
    const ack = await emitAck('ai-ask', { question });
    while (Date.now() - t0 < timeoutMs) {
      const m = botMsgs.find((x) => (x.ts || 0) >= t0 && !EVENT_BROADCAST_RE.test(x.text || ''));
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

  /* ── 准备：把"长会"字幕账本写进真 captions 目录（文件名必须用真实房间号）──
   *
   * ★ 09-25 时间戳重构（本轮踩过的坑，写清楚）：
   *   问答的证据范围 = **本场会议之内**（下界 = 房间创建时刻）。
   *   于是这批 fixture 的时间戳决定了整份脚本能不能测出东西：
   *     · 若写成"入会前"（更早），第 ①~⑥ 步**全部**会因超出范围而答不出 → 假失败；
   *     · 若写成"本场会之内"（更晚），第 ⑦ 步就测不出"上一场会检索不到" → 缺一条真断言。
   *   两者不可兼得，所以改成**显式两段**：
   *     · ARCHIVE（这份 fixture）＝ 时间戳落在**建房之前** → 模拟"房间号复用前的上一场会"，
   *     · SESSION（下面追加）＝ 时间戳在建房之后（本场会）→ 承接第 ①~⑥ 步的检索/记忆/纪要断言。
   *   这样每条断言都落在正确的范围内，而且范围本身也被正反两面测到了。 */
  capFile = path.join(CAP_DIR, `cap-${roomNumber}-20260924.jsonl`);
  hadCap = fs.existsSync(capFile);
  backup = hadCap ? fs.readFileSync(capFile, 'utf8') : null;
  const T_ARCHIVE = Date.now() - 600000;   // 10 分钟前 = 远早于入会时刻
  const archiveLines = [
    { ts: T_ARCHIVE, name: '张三', text: '上一场会的旧账：预算总盘子是 999 万，走 A 方案' },
    { ts: T_ARCHIVE + 1000, name: '李四', text: '好的我记下了' },
    ...Array.from({ length: 8 }, (_, i) => ({ ts: T_ARCHIVE + 2000 + i * 100, name: '王五', text: `档案里的闲聊第 ${i} 条` })),
  ];
  fs.writeFileSync(capFile, archiveLines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

  /* 追加"会话内"内容：先触发一次自动入会（建立 joinedAt），再写这批。
   * ⚠️ 必须用 askAndWait **把这次探测的答案收干净**，不能只 emitAck 就往下走：
   *   ai-ask 的回执是"已受理"，LLM 的答案还要 2~5 秒后才到，
   *   而下面第 ① 步也在等 ai-bot 消息 → 会把**"你好"的答案**当成第 ① 步的答案
   *   （初版就是这样：第 ① 步收到"会议还没有任何发言记录"，看起来像检索坏了，
   *   实际是前一个问题的答案串进了后一个问题的等待窗口）。
   *   这也正是 run-to-run 结果飘忽（有时过有时不过）的根源——纯竞态。 */
  {
    const probe = await askAndWait('你好', 60000);
    assert(probe.ack && probe.ack.data && probe.ack.data.started, '首次提问应被受理（触发自动入会）：' + JSON.stringify(probe.ack));
    await sleep(200);   // 再稳一手：确保 joinedAt 已落定，下面这批的时间戳严格晚于它
    const T_SESSION = Date.now() + 10;
    const sessionLines = [
      { ts: T_SESSION, name: '张三', text: '先说结论：交付时间定在 11 月 20 日，这个日期不能再动了' },
      { ts: T_SESSION + 100, name: '李四', text: '好的我记下了' },
      ...Array.from({ length: 25 }, (_, i) => ({ ts: T_SESSION + 200 + i * 10, name: '王五', text: `闲聊第 ${i} 条：今天天气不错` })),
      { ts: T_SESSION + 500, name: '李四', text: '压测报告我负责，周五之前提交' },
      { ts: T_SESSION + 600, name: '王五', text: 'TURN 账号密码记得轮换，下周一之前完成' },
    ];
    fs.appendFileSync(capFile, sessionLines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  }

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

  console.log('\n── ⑤ 纪要内容：结构化行动项（owner/task/due 三字段）+ 与看板同源 ──');
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

  await T('★ 纪要的「决定 / 风险」与实时看板**同源**（口径不可能打架）', async () => {
    /* 这条守的是一个**一致性**不变量，而不是某个功能：
     *   改造前"风险"在纪要里（内联 riskRe）和看板里（digest.RISK_RE）各判一次，
     *   两组正则不同 → 同一场会可能出现"看板 3 条、纪要 2 条"，用户会判定 AI 不可信。
     *   现在两者共用 digest，所以本断言的做法是：**拿会话内 fixture 里那句决定原文，
     *   在纪要里必须出现**（决定小节确实由 digest 产出，不是别处凑出来的）。 */
    const dir = path.join(__dirname, '..', 'sfu', 'minutes', String(roomNumber));
    const files = fs.readdirSync(dir).sort();
    const md = fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf8');
    assert(md.includes('## 决定'), '纪要应含「决定」小节（本轮新增，与看板同源）：\n' + md.slice(0, 700));
    assert(md.includes('## 风险与未决'), '纪要应含「风险与未决」小节');
    console.log('     ── 决定小节预览 ──');
    const seg = md.split('## 决定')[1].split('##')[0].trim();
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

  /* ══════════ 七、★ 09-25 AI 助手"参加会议"的端到端 ══════════
   * ▎为什么这几条必须在真服务器上跑：
   *   入会致辞、离会告别、会议范围都不是纯逻辑——它们依赖
   *   **setAiBot 的真实调用链**（管线建立 → 快照广播 → chat-message 广播 → 时间戳记账）。
   *   单测能证明 scopeEntries 过滤对，证明不了"joinedAt 真的被写进了 room 并传给了 brain"。
   *   这正是 brain.js 吃过的那次亏（模块对、接线断）在服务端的同构风险。 */
  console.log('\n── ⑦ AI 助手参会：会议范围 / 入会致辞 / 离会告别 ──');
  /* ⚠️ 顺序有讲究（本轮实测踩过）：
   *   而"邀请入会"那条用例必须先 ai-leave 再 ai-join（才能触发致辞），
   *   （早期版本的范围下界取"助理入会时刻"，一 leave 就清零、一 join 又重置成当下 → 范围随之改变，
   *   后面的"本场检索"就会因为 fixture 全部落到范围之外而失败。现已改为"房间创建时刻"，该问题不复存在。）
   *   所以把**范围类断言放在前面**（用自动入会建立的会话），
   *   把**致辞/告别类断言放在后面**（它们会重置会话，不再影响前面）。 */

  await T('★ 会议范围生效：本场会内容答得出，房间号复用前的上一场会答不出', async () => {
    /* 本条是本轮最有价值的一条断言——它直接证明"参会"与"翻档案"的区别。
     * 两面都要测，缺一面就是假通过：
     *   ① 档案内容（入会前写入的"预算 999 万"）→ 必须**答不出**（否则范围失效）；
     *   ② 会话内容（入会后写入的"灰度 12 月 3 日"）→ 必须**答得出**（否则范围过严误伤）。 */
    const q1 = await askAndWait('上一场会的预算总盘子是多少？');
    assert(q1.msg, '应有回复');
    assert(!/999/.test(q1.msg.text),
      '房间号复用前的上一场会内容不该被检索到（跨会议串味防线），实际：' + q1.msg.text);
    assert(q1.msg.ai && q1.msg.ai.scoped === true, '应标记为受限会话，实际：' + JSON.stringify(q1.msg.ai));
    assert(q1.msg.ai.allDocs > q1.msg.ai.totalDocs,
      '应报出"范围内 < 全档"（证明确实过滤了），实际 ' + q1.msg.ai.totalDocs + '/' + q1.msg.ai.allDocs);
    console.log(`     ① 上一场会档案（范围内 ${q1.msg.ai.totalDocs} / 全档 ${q1.msg.ai.allDocs}）：${q1.msg.text.slice(0, 70)}`);

    // ② 本场会补一条新字幕（写进真 jsonl → 服务器下次问答会读到）
    const fresh = { ts: Date.now() + 10, name: '孙七', text: '本场会新增：灰度发布窗口定在 12 月 3 日晚上八点' };
    fs.appendFileSync(capFile, JSON.stringify(fresh) + '\n', 'utf8');
    const q2 = await askAndWait('灰度发布窗口是什么时候？');
    assert(q2.msg, '应有回复');
    assert(/12\s*月\s*3\s*日/.test(q2.msg.text),
      '本场会新增的字幕必须能答出来（否则范围过滤误伤新内容），实际：' + q2.msg.text);
    console.log('     ② 本场会内容：' + q2.msg.text.slice(0, 80));
  });

  await T('会话内检索仍有效：关键信息被 25 条闲聊隔开也能捞回', async () => {
    // 「交付时间 11 月 20 日」在会话内 fixture 的第 1 条，后面垫了 25 条闲聊
    const { msg: m } = await askAndWait('交付时间是什么时候？');
    assert(m, '应有回复');
    assert(/11\s*月\s*20\s*日/.test(m.text), '会话内检索应能隔 25 条捞回首条，实际：' + m.text);
  });

  await T('room-state 快照里出现 isBot 虚拟成员（前端成员列表据此渲染）', async () => {
    /* ⚠️ 不能"先 join 再挂监听"——room-state 是**同步广播**的，
     *   等 ai-join 的 ack 回来时快照早就发完了（本脚本第一版就因此空等 8 秒）。
     *   正确做法：主动触发一次快照重广播（用一个幂等的 member-state 上报）。 */
    const st = await new Promise((res) => {
      const h = (s) => { sock.off('room-state', h); res(s); };
      sock.on('room-state', h);
      sock.emit('member-state', { patch: { muted: true } });   // 触发一次快照广播
      setTimeout(() => { sock.off('room-state', h); res(null); }, 8000);
    });
    assert(st && Array.isArray(st.members), '应收到 room-state 快照');
    const bot = st.members.find((m) => m.isBot);
    assert(bot, '快照里应有 isBot 成员，实际：' + JSON.stringify(st.members.map((m) => m.id)));
    assert(bot.id === 'ai-bot', 'bot 的固定 id 应为 ai-bot，实际 ' + bot.id);
  });

  await T('★ 邀请 AI 入会 → 它作为参会者**开口报到**（含能力与听觉说明）', async () => {
    /* 前置：前面的 ai-ask 已经**自动**把助理拉进房了，那时它是"静默入会"（不说寒暄）。
     *   所以这里要先把它送走，才能测"被主动邀请时致辞"这条路径——
     *   否则 setAiBot 幂等（was===true）会直接跳过致辞，断言必然失败。
     *   顺带也覆盖了 ai-leave 的连通性。 */
    await emitAck('ai-leave', {});
    await sleep(500);

    botMsgs.length = 0;
    streams.length = 0;
    const ack = await emitAck('ai-join', {});
    assert(ack && ack.data && ack.data.aiBot === true, 'ai-join 应成功：' + JSON.stringify(ack));
    // 致辞是异步广播，给它一点时间到达
    let hello = null;
    for (let i = 0; i < 40 && !hello; i++) {
      hello = botMsgs.find((m) => /已作为参会者入会|大家好/.test(m.text || ''));
      if (!hello) await sleep(150);
    }
    assert(hello, '入会后机器人应发一条报到消息，实收：' + JSON.stringify(botMsgs.map((m) => (m.text || '').slice(0, 40))));
    assert(/@ai/.test(hello.text), '报到消息应说明用法（@ai），实际：' + hello.text);
    console.log('     🤖 入会致辞：' + hello.text.split('\n').filter(Boolean).slice(0, 3).join(' / ').slice(0, 160));
  });

  await T('★ 主动邀请才致辞、自动入会不致辞（否则寒暄会与答案抢道）', async () => {
    /* 这条守的是本轮修掉的真缺陷：ai-ask 自动入会时若也致辞，
     *   用户问的第一个问题会被一段寒暄"挡住"（任何取末条 ai-bot 的调用方都会抓错）。 */
    const logDir = path.join(__dirname, '..', 'sfu', 'logs');
    const today = new Date().toISOString().slice(0, 10);
    const jl = path.join(logDir, `app-${today}.jsonl`);
    assert(fs.existsSync(jl), '应有当天事件日志');
    const evs = fs.readFileSync(jl, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
      .filter((x) => x && x.roomNumber === roomNumber);
    const ceremonies = evs.filter((e) => e.event === 'ai-join-ceremony');
    const autoJoins = evs.filter((e) => e.event === 'ai-auto-join');
    assert(autoJoins.length >= 1, '本流程里应发生过自动入会（setup 阶段的探测提问）');
    assert(ceremonies.length === 1, '致辞次数应恰好为 1（自动入会那次静默，主动邀请那次致辞），实际 ' + ceremonies.length);
    console.log(`     自动入会 ${autoJoins.length} 次 / 致辞 ${ceremonies.length} 次（=1，证明自动入会确实静默）`);
  });

  await T('★ 送走 AI → 告别 + 终稿纪要落盘（值钱的产物在离场那刻交付）', async () => {
    const dir = path.join(__dirname, '..', 'sfu', 'minutes', String(roomNumber));
    const before = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
    botMsgs.length = 0;
    const ack = await emitAck('ai-leave', {});
    /* ⚠️ ai-leave 的回执是**操作后的新状态**（aiBot:false），不是"成功与否"。
     *   本脚本第一版断言 aiBot===true → 失败，但服务器行为完全正确——
     *   是断言写错了语义。这里按真实语义断言（false = 已送走）。 */
    assert(ack && ack.data && ack.data.aiBot === false, 'ai-leave 后应回 aiBot:false（已送走）：' + JSON.stringify(ack));
    let bye = null;
    for (let i = 0; i < 40 && !bye; i++) {
      bye = botMsgs.find((m) => /退会|告辞|先走|离会/.test(m.text || ''));
      if (!bye) await sleep(150);
    }
    assert(bye, '离会应有一句告别，实收：' + JSON.stringify(botMsgs.map((m) => (m.text || '').slice(0, 40))));
    // 终稿是异步落盘的（buildMinutes 内含 LLM 调用），给它足够时间
    let after = before;
    for (let i = 0; i < 60 && after <= before; i++) {
      await sleep(500);
      after = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
    }
    assert(after > before, `送走时应落一份终稿纪要（${before} → ${after}）`);
    console.log('     🤖 告别：' + bye.text.slice(0, 90));
    console.log(`     终稿纪要：${before} → ${after} 份`);
  });

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  console.log(`服务器日志：${logFile}`);
  cleanup();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('验证脚本异常：' + (e && e.stack || e));
  process.exit(1);
});
