/* ══════════════════════════════════════════════════════════════
 * scripts/test-voice-longrun.js —— 语音识别**长跑连续性**真浏览器实测
 *
 * ▎要解决什么？用户报"语音识别要真正能用，**不要一段时间就停了**"。
 *   端口段挪出动态区（2026-10-04g）修掉了秒崩×5 的根因，但"真正能用"要拿
 *   **连续运行**证明：真浏览器 + 假麦克风（循环真实语音）连续跑 N 分钟，
 *   断言字幕定稿**持续到来、无停摆**、AI 应答持续、服务器零崩溃零放弃。
 *
 * ▎断言四件：
 *   ① 定稿总数随时间单调增长（每分钟都比上一分钟多）；
 *   ② 无停摆：**任意 60s 窗口内至少 1 条新定稿**（有音频进来就该出字）。
 *     ▸ 这是**代理信号**（字幕与字幕之间的间隔），不是权威判据。权威的那条在
 *       `review:meeting`：「**段在到达却没有出字**」——两者会在一种情况下分叉：
 *        fixture 的长静音尾段被能量闸正常打发掉（没有新段在到达），字幕间隔自然会拉长。
 *       2026-10-06 实测分叉了一次：本工具报"最大间隔 26s"，而复盘报"未见停摆"，
 *       差在 87 段里有 85 段是纯静音被闸拦下——**不是链路停了，是没人说话**。
 *       所以这里把名字改成「字幕最大间隔」，别让它冒充"停摆"（界面/报告说实话=坑 82）。
 *   ③ 服务器侧零 asr-recorder-gave-up / 零异常 respawn；
 *   ④ AI 应答（唤醒词循环出现）至少 N 条。
 *
 * ▎跑法：npm run test:voice-longrun（专用端口 3024；LONGRUN_MINUTES 可调，默认 5）。
 * ▎⚠️ 诚实边界（2026-10-04i 实测）：Edge/Chrome 的 fake-audio-capture 对**长时长**
 *   有播放上限——前 ~2 分钟有真实语音，之后假麦克风只送静音（段目录里全是被
 *   能量闸打发的静音段）。所以长跑"3 分钟后零定稿"≠产品停摆（e2e-asr 同树
 *   90s 窗口连续出字、真人用真麦克风无此边界）。它现在的价值：
 *   ① 前两分钟的连续性断言（端口修复的回归哨兵）；
 *   ② 给"假麦克风连续供声"问题的后来人一个现成的长跑骨架。
 * ══════════════════════════════════════════════════════════════ */
'use strict';

const { spawn, execFile } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { Cdp } = require('../agent/cdp');
const { makeSpeechWav, FIXTURE_SENTENCES } = require('./voice-fixture.js');

const PORT = Number(process.env.LONGRUN_PORT) || 3024;
const MINUTES = Number(process.env.LONGRUN_MINUTES) || 5;
const SERVER = `http://localhost:${PORT}`;
const SERVER_JS = path.join(__dirname, '..', 'sfu', 'server.js');
const OUT = path.join(os.tmpdir(), 'voice-longrun-shots');
const AUDIO_DIR = path.join(os.tmpdir(), 'voice-longrun-audio');
const AUDIO_WAV = path.join(AUDIO_DIR, 'speech.wav');
const TEST_DB_FILE = path.join(os.tmpdir(), 'voice-longrun-data.db');
const TEST_LEGACY_USERS = path.join(os.tmpdir(), 'voice-longrun-legacy.json');

/* ★ 2026-10-06 取自唯一实现（FIXTURE_SENTENCES 的第 3~5 句，字符串一字未改）：
 *   长跑要的是"能反复说、每句都带唤醒词、长度不一"的三句，与 e2e 那两句错开。 */
const SENTS = [FIXTURE_SENTENCES[2], FIXTURE_SENTENCES[3], FIXTURE_SENTENCES[4]];

let checks = 0, issues = 0;
const chk = (cond, msg) => {
  checks++;
  if (cond) { console.log(`   ✅ ${msg}`); }
  else { issues++; console.log(`   ❌ ${msg}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let serverProc = null;
const browsers = [];
const serverLog = [];
const t0 = Date.now();
const since = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

/* ★ 2026-10-06 换成唯一实现 scripts/voice-fixture.js，并顺手修掉一个会让结论翻车的缺陷：
 *   原来这里用全角空格造句间停顿，而 10-05 在 e2e-asr 上实测证明那样**得不到真静音**
 *   （合成产物里 15/17 个能量窗都判有声，句间只有 ~0.5s）——服务器成句闸要"静音 > 1.2s"
 *   才确认一句说完，于是"长跑里识别一段时间就停了"这个结论有一半是 fixture 造成的。
 *   现在改成逐句合成 + Node 拼**数字静音**，并自检"最长静音 ≥3s"，不合格直接 throw
 *   （坑 65/72：先证明输入真的合格，再谈被测代码红不红）。 */
async function synthSpeechWav() {
  const fx = await makeSpeechWav({ dir: AUDIO_DIR, sentences: SENTS, gapSec: 4, tailSec: 8 });
  console.log(`   🔊 循环语音就绪（${fx.sizeKb}KB / ${fx.durSec}s，${SENTS.length} 句轮播，最长静音 ${fx.silSec.toFixed(1)}s）`);
}

/* 页面状态：定稿计数用 capLat 的 title（每次定稿刷新）+ 聊天区 AI 气泡数 */
const PAGE_STATE = `JSON.stringify((() => {
  const lat = document.getElementById('capLat');
  const txt = document.getElementById('captionText');
  const list = document.getElementById('chatList');
  return {
    latShown: lat ? !lat.classList.contains('hidden') : false,
    lat: lat ? lat.textContent : '',
    text: txt ? txt.textContent : '',
    aiReplies: list ? [...list.querySelectorAll('.msg')].filter((n) => /AI 小明/.test(n.textContent) && !/大家好，我是会议|已接入/.test(n.textContent)).length : 0,
  };
})())`;

(async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log(`║ 语音识别长跑实测（${MINUTES} 分钟连续对话，真浏览器）        ║`);
  console.log('╚══════════════════════════════════════════════════╝');
  fs.mkdirSync(OUT, { recursive: true });

  console.log(`① 起 SFU 服务器（专用端口 ${PORT}）…`);
  let up = false;
  try {
    up = await new Promise((resolve) => {
      require('http').get(`${SERVER}/config.json`, (r) => { r.resume(); resolve(r.statusCode === 200); })
        .on('error', () => resolve(false));
    });
  } catch (e) { up = false; }
  if (up) { console.error(`❌ ${PORT} 已被占用（LONGRUN_PORT=3025 可换）`); process.exit(1); }
  serverProc = spawn('node', [SERVER_JS], {
    env: { ...process.env, PORT: String(PORT), SFU_NO_HTTPS: '1', DB_FILE: TEST_DB_FILE, USERS_FILE_LEGACY: TEST_LEGACY_USERS, ASR_DUP_MS: '45000' },
    cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', (d) => {
    const s = String(d);
    serverLog.push(s);
    if (/聆听|ASR\/|🔥|🩹|⚠️|字幕|自愈|asr-dbg|成句闸/.test(s)) process.stdout.write('[srv] ' + s);
  });
  serverProc.stderr.on('data', (d) => process.stderr.write('[server] ' + d));

  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) {
    await sleep(250);
    try {
      ready = await new Promise((resolve) => {
        require('http').get(`${SERVER}/config.json`, (r) => { r.resume(); resolve(r.statusCode === 200); })
          .on('error', () => resolve(false));
      });
    } catch (e) { ready = false; }
  }
  if (!ready) throw new Error('服务器未就绪');
  console.log(`   ✅ 服务器就绪（${since()}）`);
  /* ★ 2026-10-06 服务器侧的**输入健康**取样（口径见 sfu/server.js 的 COLLAB.input）。
   *   ▎为什么这条是这次长跑工具最关键的一处：2026-10-06 这一跑"定稿 0 条"，
   *     而服务器日志显示 60 段全是 `peak=-90 dBFS`（纯数字零）——**假麦克风只送出了
   *     开头那一段，之后整场断供**。没有这三格读数，这条工具会把"输入没进来"
   *     报成"识别一段时间就停了"，然后人去查模型（坑 65/58：断言 0 之前先证明输入进去了）。
   *   ▸ 临时库首个注册账号自动是 admin，所以 /api/rooms 拿得到（与 test:e2e-reconnect 同一套路）。 */
  let adminToken = '';
  /* 用户名必须**固定**：临时库跨次运行是留存的，第一次注册的那个账号自动是 admin，
   *   之后每次都要拿回**同一个**账号——原先这里用随机名，第二次跑起来新账号只是普通成员，
   *   /api/rooms 直接 401（本次就是这么发现的）。所以：注册失败就改走登录。 */
  const LR_USER = 'longrun';
  const LR_PASS = 'Longrun#2026';
  const takeToken = (r) => (r && r.data && r.data.token) || '';
  const tryRegister = () => new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const { io: Client } = require('socket.io-client');
    const s = Client(SERVER, { transports: ['websocket'], reconnection: false });
    const t = setTimeout(() => { done(''); try { s.close(); } catch (e) { /* 已断 */ } }, 25000);
    s.on('connect', () => s.emit('auth-register',
      { username: LR_USER, password: LR_PASS, displayName: '长跑观测' },
      (r) => {
        clearTimeout(t);
        const tk = takeToken(r);
        if (tk) { done(tk); try { s.close(); } catch (e) { /* 已断 */ } return; }
        /* 已存在（跨次运行的临时库留着）→ 走登录拿回同一个 admin 账号 */
        s.emit('auth-login', { username: LR_USER, password: LR_PASS }, (r2) => {
          const tk2 = takeToken(r2);
          if (!tk2) console.log('   ⚠️ 注册与登录都没拿到 token：' + JSON.stringify(r2).slice(0, 120));
          done(tk2);
          try { s.close(); } catch (e) { /* 已断 */ }
        });
      }));
    s.on('connect_error', (e) => { clearTimeout(t); console.log('   ⚠️ 观测连接失败：' + (e && e.message)); done(''); });
  });
  /* 重试三次：这台机器在 qwen worker 预热期间（本机实测 188s）会被 python 冷 import 压满，
   *   ack 偶尔就是赶不上——观测工具不该和被测负载抢同一个时间窗，等不到就隔一会儿再要。 */
  for (let i = 0; !adminToken && i < 3; i++) {
    try { adminToken = await tryRegister(); }
    catch (e) { console.log('   ⚠️ 注册异常：' + (e && e.message)); }
    if (!adminToken) { console.log(`   ⏳ 第 ${i + 1} 次没拿到 admin token，20s 后重试`); await sleep(20000); }
  }
  let inputProbeErr = '';   // 为什么没读到（区分"没 token"/"取不到"/"字段不在"——报错不许甩锅给没发生的成因）
  let lrRoom = '';          // 进房后记下房间号（/api/rooms 按号挑自己那一间）
  const readInput = async () => {
    if (!adminToken) { inputProbeErr = '没拿到 admin token'; return null; }
    return await new Promise((resolve) => {
      const req = require('http').get(`${SERVER}/api/rooms?token=${encodeURIComponent(adminToken)}`, (r) => {
        let b = ''; r.on('data', (c) => (b += c));
        r.on('end', () => {
          try {
            const m = JSON.parse(b);
            /* collab 在快照的**顶层**（服务器全局计数器，与 capLat/asr 同一口径），
             *   不在每个房间下面——第一版按 rooms[i].collab 找，字段"不存在"其实是找错了路径。
             *   房间号仍然打印出来，方便对着 /api/rooms 人工核对。 */
            const inp = m.collab && m.collab.input;
            if (!inp) inputProbeErr = '/api/rooms 顶层没有 collab.input 字段（服务器代码没带上？）';
            resolve(inp || null);
          } catch (e) { inputProbeErr = `解析 /api/rooms 失败（HTTP ${r.statusCode}）：${e && e.message}`; resolve(null); }
        });
      });
      req.on('error', (e) => { inputProbeErr = '取 /api/rooms 失败：' + (e && e.message); resolve(null); });
    });
  };
  let inputLast = null; const inputSamples = [];
  if (!adminToken) console.log('   ⚠️ 拿不到 admin token：输入健康观测不可用（下面的判定会保守一些）');

  console.log('② 等主 ASR 引擎预热…');
  let prim = false;
  let lastMetricsCode = 0;   // 最后一次 /metrics 的状态码（401 与"没就位"是两种病，报错要分得开）
  for (let i = 0; i < 720 && !prim; i++) {   // ★ 冷启动在慢机器上要 2-3 分钟（import 47s + GPU 模型加载）
    await sleep(250);
    try {
      /* ★ 2026-10-06 这条请求原先不带 token，而 /metrics 是 admin 门禁（09-24 的边界）——
       *   于是 `prim` 永远为假，这个循环把 720×250ms = **180s 全部跑满**才报"预热完成（188s）❌"。
       *   报的是"引擎慢"，真相是"我 401"（坑 74 的姊妹：401 会被误诊成"没就位"）。
       *   现在带上前面的 admin token，并且把状态码打出来——下次再不对，一眼看得见是权限问题。 */
      const txt = await new Promise((resolve, reject) => {
        require('http').get(`${SERVER}/metrics${adminToken ? `?token=${encodeURIComponent(adminToken)}` : ''}`,
          (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => { lastMetricsCode = r.statusCode; resolve(b); }); })
          .on('error', reject);
      });
      prim = /^sfu_ai_asr_primary_ready 1$/m.test(txt);
    } catch (e) { /* 继续等 */ }
  }
  chk(prim, `主引擎预热完成（${since()}${lastMetricsCode && lastMetricsCode !== 200 ? ` · /metrics 返回 ${lastMetricsCode}，这是门禁不是引擎慢` : ''}）`);

  console.log('③ 合成循环语音…');
  await synthSpeechWav();

  console.log('④ 起真 Chromium…');
  const profDir = path.join(os.tmpdir(), `voice-longrun-profile-${PORT}`);
  try { fs.rmSync(profDir, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { /* */ }
  const cdp = new Cdp({
    headless: false, port: 9364, windowSize: { width: 1280, height: 820 }, startUrl: 'about:blank',
    extraArgs: [
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${AUDIO_WAV.replace(/\\/g, '/')}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  browsers.push(cdp);
  await cdp.launch();
  await cdp.navigate(SERVER);
  await cdp.waitForLoad(15000);
  await sleep(1200);
  await cdp.evaluate(`(() => { const b = document.getElementById('authGuestBtn'); if (b) b.click(); })()`);
  for (let i = 0; i < 40; i++) {
    try {
      if (await cdp.evaluate(`!document.getElementById('prejoin').classList.contains('hidden') ? 1 : 0`)) break;
    } catch (e) { /* */ }
    await sleep(300);
  }
  await sleep(1100);
  await cdp.evaluate(`(() => { const b = document.getElementById('pjEnterBtn'); if (b) b.click(); })()`);
  for (let i = 0; i < 40; i++) {
    try {
      if (await cdp.evaluate(`!document.getElementById('roomPanel').classList.contains('hidden') ? 1 : 0`)) break;
    } catch (e) { /* */ }
    await sleep(300);
  }
  await sleep(500);
  await cdp.evaluate(`(() => { document.getElementById('createBtn').click(); })()`);
  for (let i = 0; i < 50; i++) {
    try {
      if (await cdp.evaluate(`((el) => !el.classList.contains('hidden') && /\\d{6}/.test(el.textContent||'') ? 1 : 0)(document.getElementById('roomBadge'))`)) break;
    } catch (e) { /* */ }
    await sleep(300);
  }
  await sleep(1000);
  /* 把房间号**记下来**：/api/rooms 里要按号挑自己那一间（这台机器上可能同时有别的测试房）。 */
  const badgeTxt = await cdp.evaluate(`(document.getElementById('roomBadge').textContent || '')`).catch(() => '');
  lrRoom = (String(badgeTxt).match(/\d{6}/) || [])[0] || '';
  console.log(`   ✅ 在会（${since()}）房间 ${lrRoom || '(没拿到号)'}`);
  await cdp.evaluate(`(() => { document.getElementById('capBtn').click(); })()`);
  await sleep(1500);
  /* 开麦。**判据用轨道自己的 enabled，不用按钮文字**：
   *   ▎长跑工具此前一直"把测试自己弄哑"——它写的是 `if (t === '静音') break; else click()`，
   *     而第 43 步之后按钮的 textContent 是「静音静音」（两层同样的字），
   *     于是它连点三下把麦克风关到位，然后报告"识别一段时间就停了"。
   *     这就是那条红真正的成因（同一个写法在产品代码里也有一处，见 client.js 的 switchMic/switchCamera 修复）。
   *   ▸ 轨道的 enabled 才是事实；按钮文字只是它的一个视图。 */
  const micOn = () => cdp.evaluate(`(() => {
    try {
      const t = (typeof localStream !== 'undefined' && localStream && localStream.getAudioTracks)
        ? localStream.getAudioTracks()[0] : null;
      return t ? (t.enabled ? 'on' : 'off') : 'none';
    } catch (e) { return 'err:' + (e && e.message); }
  })()`).catch(() => 'err');
  let st = await micOn();
  for (let i = 0; i < 3 && st !== 'on'; i++) {
    await cdp.evaluate(`(() => { document.getElementById('muteBtn').click(); })()`);
    await sleep(500);
    st = await micOn();
  }
  if (st !== 'on') console.log(`   ⚠️ 麦克风轨道状态停在「${st}」——这一页没在送声音，长跑测不到东西（on=开 / off=静音 / none=没有音轨）`);
  else console.log('   🎤 本页麦克风已开（轨道 enabled=true）');
  console.log(`   ✅ 字幕开 + 麦克风开（${since()}）——长跑开始`);


  /* ══ 长跑主循环 ══
   * ★ 2026-10-06 定稿计数改成**读服务器那份字幕账本**，不再数页面上的 ⏱ 读数。
   *   ▎这是同一个坑今天第三次应验（前两次：test:asr-live 的判据、test:e2e-reconnect 的"账本就绪"）：
   *     ⏱ 只在"人真的停下来"那次定稿（fin=silence）才刷新，其它定稿原因下读数按坑 90 诚实归零。
   *     拿它当"定稿条数"，就会在引擎走兜底/分段被时长闸切断时**恒报 0 条**，
   *     而同一时刻 AI 已经答了 12 次（应答的前提就是成句定稿）——工具在说"识别停了"，
   *     事实是"我没数对"。账本是定稿路径的落点，它才是这件事的权威来源。 */
  const ledgerFile = () => {
    const utc = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return path.join(__dirname, '..', 'sfu', 'captions', `cap-${lrRoom}-${utc}.jsonl`);
  };
  const runStartTs = Date.now();
  const readLedger = () => {
    try {
      return fs.readFileSync(ledgerFile(), 'utf8').split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
        .filter((e) => e && e.text && typeof e.ts === 'number' && e.ts >= runStartTs && !e.bot);
    } catch (e) { return []; }
  };
  const deadline = Date.now() + MINUTES * 60000;
  const perMin = [];                 // 每分钟的定稿增量
  let lastCount = 0, lastFinalAt = Date.now(), stallMax = 0;
  const latSamples = [];
  const seenTs = new Map();          // ts → 账本条目（去重 + 收尾统计定稿原因分布）
  let lastAiReplies = 0;             // 窗口里读到过的最大应答数（收尾那次读失败也不该把结论清零）
  let windowStart = Date.now();
  let prevWindowCount = 0;
  while (Date.now() < deadline) {
    await sleep(2000);
    let st = null;
    try { st = JSON.parse(await cdp.evaluate(PAGE_STATE, 5000)); } catch (e) { continue; }
    const led = readLedger();
    for (const e of led) {
      if (seenTs.has(e.ts)) continue;
      seenTs.set(e.ts, e);
      lastCount += 1;
      lastFinalAt = Date.now();
      /* 账本里的字段名是 `lat`（缺字段表示"没量到"，而不是 0）——工具原先读 latMs，
       *   于是"延迟样本 0"其实是**读错了键**，不是没量到。同一个概念两个名字又要断言来钉。 */
      const ms = Number.isFinite(e.lat) ? e.lat : (Number.isFinite(e.latMs) ? e.latMs : NaN);
      if (Number.isFinite(ms) && ms > 0) latSamples.push(+(ms / 1000).toFixed(1));
    }
    if (typeof st.aiReplies === 'number' && st.aiReplies > lastAiReplies) lastAiReplies = st.aiReplies;
    // 间隔检测：60s 无新定稿记一次（代理信号；权威判据见文件头 ②——静音尾段也会拉长它）
    const gap = Date.now() - lastFinalAt;
    if (gap > stallMax) stallMax = gap;
    // 每分钟小结
    if (Date.now() - windowStart >= 60000) {
      const delta = lastCount - prevWindowCount;
      perMin.push(delta);
      prevWindowCount = lastCount;
      inputLast = await readInput();
      if (inputLast) inputSamples.push(inputLast);
      const inTxt = inputLast
        ? ` · 输入 peak=${inputLast.lastPeakDb}dB 有声距今 ${inputLast.voiceAgeMs == null ? '—' : (inputLast.voiceAgeMs / 1000).toFixed(0) + 's'} 连续数字零 ${inputLast.zeroStreak} 段`
        : '';
      console.log(`   ⏱ ${Math.round((Date.now() - windowStart) / 1000)}s 窗口：定稿 ${delta} 条（累计 ${lastCount}）· AI 应答 ${st.aiReplies} · 字幕最大间隔 ${(stallMax / 1000).toFixed(0)}s${inTxt}`);
      windowStart = Date.now();
    }
  }
  /* 收尾取页面状态：**重试到拿到为止**。原先一次 evaluate 拿不到就 `.catch(() => ({}))`，
   *   于是 aiReplies=0 被判成"应答链路断了"——而同一分钟窗口里明明记着 12 次应答。
   *   量具一次读失败不该变成被测物的失败（坑 86：量具的超时不是被测对象的属性）。 */
  let finalState = {};
  for (let i = 0; i < 6; i++) {
    try {
      const raw = await cdp.evaluate(PAGE_STATE, 5000);
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.aiReplies === 'number') { finalState = parsed; break; }
    } catch (e) { /* 再试 */ }
    await sleep(1000);
  }
  const finDist = {};
  for (const e of seenTs.values()) finDist[e.fin || '?'] = (finDist[e.fin || '?'] || 0) + 1;
  console.log(`   🏁 长跑结束：定稿 ${lastCount} 条 · 定稿原因分布 ${JSON.stringify(finDist)} · AI 应答 ${finalState.aiReplies} 条 · 延迟样本 ${latSamples.length}`);

  /* ══ 断言 ══ */
  /* ★ 2026-10-06 先判"输入到底进来了没有"，再判识别。
   *   ▎为什么这条排最前：这一跑实测"定稿 0 条"，而服务器的输入计数显示
   *     从第 2 段起全是 `peak=-90 dBFS` 的**纯数字零**——假麦克风断供了。
   *     如果直接报"定稿总量不足/停摆 301s"，那条红**指向被测代码**，
   *     而真正坏的是夹具（坑 65/72 同族：断言 0 之前先证明输入真的进去了）。
   *   ▸ 判据：连续数字零段数一直涨 且 距最后一次有声 > 45s ⇒ 断供。
   *     断供时下面四条与"识别/应答"有关的断言一律**跳过并大声说明**，
   *     只有"服务器侧零崩溃"这条仍然算数（它不需要输入）。 */
  const last = inputSamples[inputSamples.length - 1] || inputLast;
  const inputDead = !!last && last.zeroStreak >= 15
    && (last.voiceAgeMs === null || last.voiceAgeMs > 45000);
  /* 拿不到读数就**判红**，不能判绿：这条断言说的是"输入进来了没有"，
   *   没有读数就是"不知道"——而"不知道"写成 ✅ 是本项目反复栽过的假绿（坑 57/65）。 */
  chk(!!last,
    last
      ? (inputDead
        ? '输入侧断供（假麦克风只送出了开头几段，之后整场是纯数字零）——本次**测不到**长跑连续性，这是夹具边界不是产品退化'
        : '输入侧持续有声音送达（断供检测未触发，长跑结论可信）')
      : '拿不到输入健康读数——本次无法区分"断供"与"识别停"，结论不可信'
        + (inputProbeErr ? `（原因：${inputProbeErr}）` : '（原因未记录）'));
  if (last) {
    console.log(`   🎤 输入侧：有声段 ${last.voiced} · 连续数字零 ${last.zeroStreak} · 距最后一次有声 ${last.voiceAgeMs == null ? '—' : (last.voiceAgeMs / 1000).toFixed(0) + 's'} · 最后峰值 ${last.lastPeakDb} dBFS`);
  }
  const min1 = Math.min(...latSamples, 99);
  const skip = (msg) => console.log(`   ⏭ 跳过：${msg}（输入断供，这条本次测不到）`);
  if (inputDead) {
    skip(`定稿总量 ${lastCount} ≥ ${MINUTES * 4}`);
    skip(`字幕最大间隔 ${(stallMax / 1000).toFixed(0)}s < 60s`);
  } else {
    chk(lastCount >= MINUTES * 4, `定稿总量 ${lastCount} ≥ ${MINUTES * 4}（每分钟至少 4 条才叫"持续能识别"）`);
    chk(stallMax < 60000, `字幕最大间隔 ${(stallMax / 1000).toFixed(0)}s < 60s（代理判据：超过 60s 没出新字幕就怀疑停了；真停不停由 review:meeting 的"段在到达却没出字"定案）`);
  }
  const gaveUp = serverLog.join('').includes('asr-recorder-gave-up') || serverLog.join('').includes('停止自愈');
  const badRespawn = (serverLog.join('').match(/异常退出/g) || []).length;
  chk(!gaveUp && badRespawn === 0, `服务器侧零崩溃零放弃（异常退出 ${badRespawn} 次）`);
  if (inputDead) skip(`AI 应答 ≥ ${MINUTES}`);
  else chk(Math.max(lastAiReplies, Number(finalState.aiReplies) || 0) >= MINUTES,
    `AI 应答 ${Math.max(lastAiReplies, Number(finalState.aiReplies) || 0)} ≥ ${MINUTES}（唤醒词循环出现，应答链路活着）`);
  /* 延迟样本为 0 时不判红：本轮实测全部以 max-age 定稿（人一直没停，10s 文本空闲保险丝先跳），
   *   那种定稿的 latMs 按坑 90 的规矩诚实归零 ⇒ **没有可信读数**是"量不到"，不是"慢到超标"。
   *   报成失败会把人支去优化一个量不出来的东西；正确动作是把 fin 分布打出来让人判断。 */
  if (inputDead) skip('最快定稿 ≤ 4s');
  else if (!latSamples.length) {
    console.log(`    跳过：本次没有可信的定稿延迟读数（全部 ${lastCount} 条都由非 silence 原因切断，见上面的原因分布）——`
      + '这是"量不到"不是"慢到超标"');
  } else chk(min1 <= 4, `最快定稿 ${min1}s ≤ 4s（管线能力未退化）`);
  if (latSamples.length) {
    const sorted = [...latSamples].sort((a, b) => a - b);
    console.log(`   📊 定稿延迟：min ${sorted[0]}s / 中位 ${sorted[Math.floor(sorted.length / 2)]}s / max ${sorted[sorted.length - 1]}s（n=${latSamples.length}）`);
  }
  try {
    const buf = await cdp.screenshot({ format: 'jpeg', quality: 72 });
    fs.writeFileSync(path.join(OUT, 'longrun-end.jpg'), buf);
    console.log(`   📸 ${path.join(OUT, 'longrun-end.jpg')}`);
  } catch (e) { /* */ }

  console.log(`\n████ 语音长跑结果：${checks} 项检查，${issues} 项失败 ████`);
  process.exitCode = issues ? 1 : 0;
})().catch((e) => {
  console.error(`\n❌ 长跑异常：${e.stack || e.message}`);
  process.exitCode = 1;
}).finally(async () => {
  for (const b of browsers) { try { b.kill(); } catch (e) { /* */ } }
  if (serverProc) {
    try { serverProc.kill(); } catch (e) { /* */ }
    await sleep(800);
    try { spawn('taskkill', ['/PID', String(serverProc.pid), '/T', '/F'], { windowsHide: true }); } catch (e) { /* */ }
  }
});
