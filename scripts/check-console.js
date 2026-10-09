#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 *  check-console.js —— 把界面点一遍，收集浏览器控制台里的每一条错误
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎为什么要这一条：本项目的所有检查都在断言"我预期会发生的事发生了没有"，
 *   而有一整类缺陷是**我没预期到的**：某个分支只在特定顺序下才抛错、
 *   某条日志一直是 error 但没人看控制台。这类东西冒烟测不到（假 DOM 没有 console.error 语义），
 *   截图也看不出（错误只在 DevTools 里）。
 * ▎做法：订阅 CDP 的 Runtime.exceptionThrown / Log.entryAdded / Runtime.consoleAPICalled，
 *   然后把界面按"真人会走的顺序"点一遍，最后要求 error 与未捕获异常为 0。
 * ▎白名单是显式列出的，每条都写清楚为什么可以忽略 ——
 *   "过滤掉所有 warning"那种写法会把真错误一起滤掉，等于没测。
 * ▎跑法：npm run check:console */
const path = require('path');
const { Cdp } = require(path.join(__dirname, '..', 'agent', 'cdp.js'));

const BASE = process.env.CHECK_URL || 'http://localhost:3001/';
const URL_ = BASE + (BASE.includes('?') ? '&' : '?') + 'nosw=1';
const results = [];
const ok = (name, pass, extra) => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 可以忽略的条目（每条都要写清"为什么这不是缺陷"） */
const BENIGN = [
  [/favicon\.ico/i, '没配 favicon 的 404（PWA 图标在 /icons/ 下，浏览器另有一条 manifest 声明）'],
  [/AudioContext was not allowed to start|autoplay/i, '无头环境没有用户手势，AudioContext 被策略拦（真人点过之后不会）'],
  [/getUserMedia.*Permission|Permission denied/i, '无头浏览器的摄像头是假设备，部分版本仍会报权限'],
  [/WebSocket.*ERR_/i, '无头网络抖动导致的一次信令重连（socket.io 自己会退避重试）'],
];
const isBenign = (text) => BENIGN.some((re) => re[0].test(text));

(async () => {
  const cdp = new Cdp({ headless: true, startUrl: URL_, windowSize: { width: 1440, height: 900 } });
  const errors = [];
  const warnings = [];
  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails || {};
    const t = (d.exception && (d.exception.description || d.exception.value)) || d.text || '';
    errors.push('未捕获异常：' + String(t).split('\n')[0]);
  });
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type !== 'error' && p.type !== 'warning') return;
    const txt = (p.args || []).map((a) => (a.value !== undefined ? String(a.value) : (a.description || a.type || ''))).join(' ');
    (p.type === 'error' ? errors : warnings).push('console.' + p.type + '：' + txt.slice(0, 160));
  });
  cdp.on('Log.entryAdded', (p) => {
    const e = p.entry || {};
    if (e.level !== 'error' && e.level !== 'warning') return;
    (e.level === 'error' ? errors : warnings).push(`页面日志[${e.source}]：${String(e.text || '').slice(0, 160)}`);
  });

  await cdp.launch();
  await cdp._send(cdp.pageWs, 'Runtime.enable').catch(() => {});
  await cdp._send(cdp.pageWs, 'Log.enable').catch(() => {});
  /* 装好监听之后**重新导航一次**：launch 时那一趟加载的错误我们没听到，
     而"页面一打开就报错"恰恰是最该抓的一类（顶层 init 链断掉就是这种，坑 69）。 */
  await cdp.navigate(URL_);
  await sleep(1800);
  /* ▸ 版本指纹（2026-10-04 补齐）。这条检查报的是"控制台干净"——
   *   如果它量的是 Service Worker 缓存里的旧构建，那"干净"是旧的干净，
   *   本轮新加的监听链一条都没跑到也照样绿。**假绿比假红危险**（坑 57），
   *   所以量之前先证明"我加载的是现在这一版"。 */
  const fp = await cdp.evaluate(`(async () => {
    const js = await (await fetch('client.js', { cache: 'no-store' })).text();
    const css = await (await fetch('style.css', { cache: 'no-store' })).text();
    return { js: js.includes('applyServerConfig') && js.includes('waitForTurnThen') && js.includes('exportBoardPng'),
             css: css.includes('.bottom-stack') && css.includes('.ctl-row'),
             /* 页面**真正跑起来**的那一份：外壳有没有装上（不是源码里有没有写） */
             risen: !!document.querySelector('.controls .btn.pill-rise, #pjEnterBtn .pill-rise') };
  })()`);
  ok('量之前先证明：页面加载的是本轮代码（源码指纹 + 外壳真的装上了）',
    fp.js === true && fp.css === true, `js=${fp.js} css=${fp.css} 升起外壳在页面上=${fp.risen}`);

  console.log('① 首屏（登录卡）已加载，开始按真人的顺序点一遍…');
  const real = errors.filter((e) => !isBenign(e));
  ok('首屏加载没有未捕获异常（顶层 init 链完整，坑 69）', real.length === 0, real.slice(0, 3).join(' ; '));

  /* ② 游客进房 → 建房 */
  await cdp.evaluate(`(function(){ document.getElementById('authGuestBtn').click(); return 1; })()`);
  await sleep(700);
  await cdp.evaluate(`(function(){ document.getElementById('createBtn').click(); return 1; })()`);
  await sleep(2500);
  const room = await cdp.evaluate(`(function(){ return String(myRoom || ''); })()`);
  ok(`建房成功（房间号 ${room}）`, /^\d{6}$/.test(room));

  /* ③ 逐个点开浮层与开关：这些是"点一下才跑"的代码路径，最容易藏 error */
  const tour = [
    ['打开白板', `document.getElementById('boardBtn').click()`],
    ['白板落笔并导出', `(function(){ setBoardOpen(true); applyBoardOp('#b93a26','start',0.3,0.3); applyBoardOp('#b93a26','draw',0.5,0.5); applyBoardOp('#b93a26','end'); sendBoard('end'); exportBoardPng(); return 1; })()`],
    ['关闭白板', `setBoardOpen(false)`],
    ['打开滤镜面板', `document.getElementById('fxBtn').click()`],
    ['切一档滤镜', `document.querySelector('#fxPresets .fx-chip').click()`],
    ['关滤镜面板', `document.getElementById('fxCloseBtn').click()`],
    ['开字幕', `document.getElementById('capBtn').click()`],
    ['点字幕状态徽标（弹自检）', `document.getElementById('capStatus').click()`],
    ['关自检', `document.getElementById('capDiagCloseBtn').click()`],
    ['开字幕历史', `document.getElementById('capHistoryBtn').click()`],
    ['关字幕历史', `document.getElementById('capHistoryCloseBtn').click()`],
    ['生成日报', `document.getElementById('capReportBtn') && document.getElementById('capReportBtn').click()`],
    ['请 AI 入会', `document.getElementById('aiBtn').click()`],
    ['切演讲者视图', `document.getElementById('viewSpeakerBtn').click()`],
    ['切回宫格', `document.getElementById('viewGalleryBtn').click()`],
    ['举手', `document.getElementById('handBtn').click()`],
    ['放下手', `document.getElementById('handBtn').click()`],
    ['省流开关', `document.getElementById('lowBwBtn').click()`],
    ['AI 语音开关切两次', `document.getElementById('aiVoiceBtn').click(); document.getElementById('aiVoiceBtn').click()`],
    ['发一条聊天', `(function(){ document.getElementById('chatInput').value='控制台检查的一条消息'; document.getElementById('chatSendBtn').click(); return 1; })()`],
    ['@ai 提一个问', `(function(){ document.getElementById('chatInput').value='@ai 你现在能做什么'; document.getElementById('chatSendBtn').click(); return 1; })()`],
    ['表情回应', `document.querySelector('.react-btn').click()`],
    ['静音 / 取消静音', `document.getElementById('muteBtn').click(); document.getElementById('muteBtn').click()`],
    ['关摄像头 / 开摄像头', `document.getElementById('camBtn').click(); document.getElementById('camBtn').click()`],
  ];
  for (const [name, js] of tour) {
    /* ★ 2026-10-04：这里原先不兜 try——一趟 CDP 往返超时（机器被另一批测试抢满时真发生过）
       会让整条检查以未捕获异常退出，于是"某一档没量到"变成"这条检查没有结论"。
       量具坏了不该伪装成被测物坏了，但更不该顺手把其余 23 步的取证一起弄丢。
       ▸ 顺带修掉一个**假绿**：旧写法是 `.then(...)` 且不 await，
         抛错记录可能落在"汇总已经打印之后"——步骤真抛了错，检查照样报干净。
         判据：断言用的账本必须在**同步await的写入点**上更新，异步补写等于漏记（坑 76 同族）。 */
    let r;
    try {
      r = await cdp.evaluate(`(function(){ try { ${js}; } catch (e) { return 'THREW:' + e.message; } return 'ok'; })()`);
    } catch (e) { r = 'CDP-ERROR:' + ((e && e.message) || e); }
    if (r && String(r).startsWith('THREW')) errors.push(`${name} 抛错：${String(r).slice(6)}`);
    else if (r && String(r).startsWith('CDP-ERROR')) errors.push(`${name} 这一跳量具没取到值：${String(r).slice(10)}`);
    await sleep(260);
  }
  /* ④ 缩放窗口：坞换行、光轨 resize、白板重排都走这条路径 */
  for (const w of [900, 1440]) {
    await cdp.evaluate(`(function(){ document.documentElement.style.setProperty('__probe', '${w}'); return 1; })()`);
    await cdp._send(cdp.pageWs, 'Browser.setWindowBounds', {
      windowId: (await cdp._send(cdp.pageWs, 'Browser.getWindowBounds', { windowId: await cdp._send(cdp.pageWs, 'Browser.getWindowForTarget', {}).then((r) => r.windowId) }).catch(() => ({}))).windowId,
      bounds: { width: w, height: 860 },
    }).catch(() => {});
    await sleep(700);
  }

  /* ⑤ 等 AI 那一轮答完（流式 + 朗读是最容易漏 catch 的一段） */
  await sleep(9000);

  /* ⑤b 界面说实话：徽标那句话必须"读起来是人话"。
   * ▎本轮的真实缺陷（e2e 日志里看见的）：徽标写成 **"服务器转写（服务器转写）"**——
   *   client.js 有三处读 /config.json，只有一处会写引擎名，没落到时兜底文案恰好也叫"服务器转写"，
   *   与外层模板拼成胡话。而 e2e 那条断言写的是"含不含服务器转写"，所以它一直是绿的：
   *   **只查关键词在不在，查不出这句话是不是人话。**
   *   这条检查跑在真人点过「字幕」之后，正好是那条路径的现场取证。 */
  const capText = String(await cdp.evaluate(
    `(document.getElementById('capStatus')||{textContent:''}).textContent`) || '');
  const claimsServer = /服务器转写/.test(capText);
  ok('字幕徽标那句是"人话"（不自我重复、不露空括号与兜底占位；说"服务器转写"就得点明是哪个引擎）',
    !/(\S{2,})（\1）/.test(capText) && !/（\s*）/.test(capText)
    && (!claimsServer || (/whisper|Qwen|云端/.test(capText) && !/引擎待确认/.test(capText))),
    `读到："${capText.trim()}"`);

  const bad = errors.filter((e) => !isBenign(e));
  ok(`★ 点完 ${tour.length} 处交互 + 缩放之后，控制台没有 error / 未捕获异常`,
    bad.length === 0, bad.length ? bad.slice(0, 4).join('\n      ') : '');
  const wb = warnings.filter((e) => !isBenign(e));
  console.log(`  ℹ️  warning ${wb.length} 条（不判失败，列出来给人看）`);
  for (const w of wb.slice(0, 6)) console.log(`     · ${w.slice(0, 150)}`);
  console.log(`  ℹ️  被白名单放过的 ${errors.filter(isBenign).length} 条（每条理由见脚本顶部 BENIGN）`);

  cdp.kill();
  const n = results.filter((x) => !x.pass).length;
  console.log(n ? `\n❌ ${n} 项未过` : '\n🎉 控制台是干净的');
  process.exit(n ? 1 : 0);
})().catch((e) => { console.error(`\n❌ 检查失败：${e && e.message}`); process.exit(1); });
