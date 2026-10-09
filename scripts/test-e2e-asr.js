/* ══════════════════════════════════════════════════════════════
 * scripts/test-e2e-asr.js —— 语音识别真浏览器端到端（假麦克风注入真实语音）
 *
 * ▎要解决什么？此前语音识别的全部自动化证据都来自 test:asr-live——
 *   那条路是"服务器侧直推 RTP"，**浏览器→WebRTC→AI 耳朵这一段完全没被覆盖**。
 *   用户报"不知道是太慢了还是没实现"，而我们手里没有任何一条真浏览器证据。
 *
 * ▎怎么做：Chrome 的 --use-file-for-fake-audio-capture 可以把一个 WAV 文件
 *   当成麦克风设备（循环播放）。WAV 用 Windows 自带中文音色（System.Speech）
 *   合成"说一句 → 停几秒 → 再说一句"的节奏。于是这条链路全部是真的：
 *   真浏览器 getUserMedia → 真 WebRTC produce → 服务器 AI 耳朵（PlainTransport
 *   → ffmpeg 分段）→ 真 ASR 引擎 → asr-caption → 字幕条上屏 → 唤醒词 → AI 应答。
 *
 * ▎断言六件：
 *   ① 点字幕按钮后状态徽标显示"服务器转写"；
 *   ② 开麦后字幕条真的出字（interim 或定稿）；
 *   ③ 转写文本命中测试句的关键词（正解命中，证明音频真进去了——坑 65 的正向对照）；
 *   ④ 出现定稿（⏱ 延迟读数可见），并记录开麦→定稿的真实秒数；
 *   ⑤ 唤醒词句触发 AI 应答（chat-message from=ai-bot）；
 *   ⑥ 关键步骤截图存档（人可复核）。
 *
 * ▎跑法：npm run test:e2e-asr（专用端口 3018；TEST_E2E_ASR_PORT 可换）。
 * ▎路径口径：全部**模块级常量/白名单**，无动态片段进 path.join（静态扫描口径）。
 * ══════════════════════════════════════════════════════════════ */
'use strict';

/* ★ 2026-10-05：本测试跑在一台经常有重负载的机器上（无头浏览器 ×2 + Qwen worker + 其他回归），
 *   实测两次被 CDP 单条命令的 10s 默认超时误伤——第 1 跑死在 Runtime.evaluate（点击登录/建房），
 *   第 2 跑死在 Page.getLayoutMetrics（刷新视口）；两次都是"机器忙"，不是浏览器真卡死。
 *   处理：只把预算放宽到 30s（口子在 agent/cdp.js 的 WB_CDP_TIMEOUT，默认 10s 不变）。
 *   **绝不自动重试**——点击类命令非幂等，重试 = 双触发（10-04b 立的纪律）。 */
process.env.WB_CDP_TIMEOUT = process.env.WB_CDP_TIMEOUT || '30000';

const { spawn, execFile } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { Cdp } = require('../agent/cdp');
/* ★ 2026-10-06 测试语音的唯一实现（合成 + 拼静音 + 质量线） */
const { makeSpeechWav, FIXTURE_SENTENCES, FIXTURE_CHATTER } = require('./voice-fixture.js');

const PORT = Number(process.env.TEST_E2E_ASR_PORT) || 3018;
const SERVER = `http://localhost:${PORT}`;
const SERVER_JS = path.join(__dirname, '..', 'sfu', 'server.js');
const OUT = path.join(os.tmpdir(), 'e2e-asr-shots');
const AUDIO_DIR = path.join(os.tmpdir(), 'e2e-asr-audio');
const AUDIO_WAV = path.join(AUDIO_DIR, 'speech.wav');
/* ★ 2026-10-04 库名带上"这一次运行"的身份证（pid + 时刻），与 test-e2e-media /
 *   test-sfu-signaling / test-agent 的写法对齐：**每次运行天然是空库**。
 * ▎原先是固定名 'e2e-asr-data.db'，跨运行持久 → 上一轮注册的账号还在，
 *   这一轮注册直接 {"error":"用户名已被注册"}，测试在设置阶段就退出（坑 72 的第四次复发）。
 * ▎固定名 + "开场清一次"能治这一次，但"独此一家用固定名"本身就是那个会漂移的差异；
 *   统一到多数派写法，才是结构上不会再犯（坑 47：一个概念——"这是本跑的临时库"——只有一个来源形状）。 */
const TEST_DB_FILE = path.join(os.tmpdir(), `e2e-asr-${process.pid}-${Date.now()}-data.db`);
const TEST_LEGACY_USERS = path.join(os.tmpdir(), `e2e-asr-${process.pid}-${Date.now()}-legacy.json`);

/* ★ 2026-10-06 句子搬到 scripts/voice-fixture.js 的 FIXTURE_SENTENCES（唯一实现）：
 *   原先 e2e-asr / reconnect / longrun 各写一份，而 review:meeting 要靠这几句
 *   分辨"自测场与真人场"——四处各写一份，迟早有一份漂了而复盘把自测当真人会数。 */
const SENT1 = FIXTURE_SENTENCES[0];
const SENT2 = FIXTURE_SENTENCES[1];
/* ★ 2026-10-06 夜二 第三句是**没叫它**的日常闲聊：用户的要求正是
 *   "这是一个正常的会议，不提到小明的名字它就不该说话"——
 *   而这一对句子只在此处有一份实现（scripts/voice-fixture.js），服务器闭环自测引用同一份。 */
const CHATTER = FIXTURE_CHATTER;
// 截图文件名白名单（索引即 shot 的 idx——静态扫描口径：无动态片段进 path.join）
const SHOT_NAMES = ['1-字幕上屏.jpg', '2-AI应答.jpg'];

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
let lastFireAt = 0;          // 最近一条 🔥 预热日志的到达时刻（步骤② 的"静置期"判据，见下）
const hbWatchdogs = [];      // 主线程心跳看门狗（结束时统一停掉，见 finally）
const t0 = Date.now();
const since = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

function wipeProfile(port) {
  const dir = path.join(os.tmpdir(), `e2e-asr-profile-${port}`);
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); } catch (e) { /* 忽略 */ }
  return dir;
}

async function waitJs(cdp, expr, timeout = 20000, label = '') {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const v = await cdp.evaluate(expr);
      if (v && v !== '0' && v !== 'false') return v;
    } catch (e) { /* 页面在跳转等：继续等 */ }
    await sleep(300);
  }
  console.log(`   ⏳ 等超时：${label || expr}`);
  return null;
}

async function shot(cdp, idx) {
  const name = SHOT_NAMES[idx]; // 白名单文件名（不吃动态输入）
  if (!name) return;
  try {
    const buf = await cdp.screenshot({ format: 'jpeg', quality: 72 });
    fs.writeFileSync(path.join(OUT, name), buf);
    console.log(`   📸 ${path.join(OUT, name)}`);
  } catch (e) { console.log(`   ⚠️ 截图失败：${e.message}`); }
}

/* ══════════════════════════════════════════════════════════════
 * ★ 2026-10-05 主线程心跳探针（第五跑"A 页面主线程停摆"的动态取证——静态排查已全部排除）。
 *
 * ▎第五跑的现象：A 页面读播报计数的 evaluate 超时（日志里被 .catch 伪装成假值 {}），
 *   而**媒体线程还活着**（member-left 判离之后服务器的录音管线仍在转写 A 的音频）——
 *   渲染进程与媒体线程正常、只有 JS 主线程停摆。但"停摆发生在哪一秒、死循环还是
 *   CPU 饥饿"，日志给不出答案——静态读代码也读不出来（已逐段排除 8 处嫌疑）。
 *
 * ▎探针三件（缺一不可）：
 *   ① 页面内 500ms 心跳 + 断档记账：tick 迟到 >1.5s 记一波。CPU 饥饿会留下断续的档，
 *      真死锁是"最后一个 tick 之后彻底冻结"（看 n 是否还在涨即可区分两种病）。
 *   ② 看门狗：每 6s 用短超时 evaluate 探一次，只报异常（正常时沉默，不刷屏）。
 *   ③ 停摆一刻抓调用栈：Debugger.pause 能中断 JS 死循环并给出精确栈；
 *      若 pause 也超时 = 主线程阻塞在原生调用（不是 JS 源码里的问题）——两种答案都有用。
 * ══════════════════════════════════════════════════════════════ */
const HB_INJECT = `(() => {
  if (window.__HB__) return 'already';
  window.__HB__ = { t0: Date.now(), last: Date.now(), n: 0, gaps: [] };
  setInterval(() => {
    const now = Date.now();
    if (now - window.__HB__.last > 1500) window.__HB__.gaps.push([window.__HB__.last, now]);
    window.__HB__.last = now;
    window.__HB__.n++;
  }, 500);
  /* ★ 2026-10-05 第十跑新增：长任务观测器（PerformanceObserver 'longtask'）。
   *   要回答的问题是"13s 无响应"的形状：**一个** 13s 长任务（JS 卡死在某处）,
   *   还是**一串**小长任务把主线程占满（渲染/GC 打满）？
   *   entry 在任务**结束后**才投递，但 duration/startTime 是精确测量的；
   *   startTime 是 performance.now() 基，inspect 时用 now-s 换算出"几分钟前发生"，
   *   可与心跳断档、服务器日志时间轴直接对齐。存 s=start、d=duration、at=attribution 名。 */
  window.__LT = window.__LT || [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (window.__LT.length < 300) {
          const a0 = e.attribution && e.attribution[0];
          window.__LT.push({ d: Math.round(e.duration), s: Math.round(e.startTime), at: a0 ? (a0.name || a0.containerType || '') : '' });
        }
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch (e) { /* 无 longtask 入口类型则静默缺失，不影响主流程 */ }
  return 'ok';
})()`;
const HB_READ = `(() => { const h = window.__HB__; return h ? JSON.stringify({ n: h.n, last: h.last, now: Date.now(), t0: h.t0, gaps: h.gaps.slice(-8) }) : 'null'; })()`;

/* ★ 2026-10-05 第十跑新增：页面侧取证（汇总前每个页面读一次）。
 *   三个量一次拿全：
 *   ① 日志面板尺寸（log() 每次 textContent 全量重写 + split + scrollHeight 强制布局——
 *      若面板失控增长，日志函数本身会变成主线程杀手）；
 *   ② 长任务清单（最长 6 个 + 每个"多久之前发生"，与心跳断档窗口对齐）；
 *   ③ JS 堆占用（排除内存泄漏型停摆）。 */
const PAGE_INSPECT = `(() => {
  const lp = document.getElementById('log');
  const txt = lp && lp.textContent ? lp.textContent : '';
  const now = performance.now();
  const lt = (window.__LT || []).map((e) => ({ d: e.d, ago: Math.max(0, Math.round(now - e.s)), at: e.at || '' }));
  lt.sort((a, b) => b.d - a.d);
  let heap = null;
  try { heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null; } catch (e) {}
  return JSON.stringify({ logLines: txt ? txt.split('\\n').length : 0, logChars: txt.length, ltCount: lt.length, ltTop: lt.slice(0, 6), heap });
})()`;

async function pageInspect(cdp, label) {
  try {
    const r = await cdp.evaluate(PAGE_INSPECT, 15000);
    const o = JSON.parse(r);
    const top = (o.ltTop || []).map((x) => `${x.d}ms/${Math.round(x.ago / 1000)}s前${x.at ? '·' + x.at : ''}`).join(', ') || '无';
    console.log(`   🧾 [${label}] 页面侧：日志 ${o.logLines} 行/${o.logChars} 字符；JS 堆 ${o.heap == null ? '?' : o.heap}MB；长任务 ${o.ltCount} 个（最长 6 个：${top}）`);
  } catch (e) {
    console.log(`   🚨 [${label}] 页面侧取证失败（主线程此刻无响应）：${String(e.message || e).slice(0, 110)}`);
  }
}

async function hbDump(cdp, label) {
  try {
    const r = await cdp.evaluate(HB_READ, 4000);
    if (!r || r === 'null') { console.log(`   💓 [${label}] 心跳对象不存在（注入前？）`); return; }
    const o = JSON.parse(r);
    const lag = o.now - o.last;
    const gaps = (o.gaps || []).map((g) => ((g[1] - g[0]) / 1000).toFixed(1) + 's').join(',');
    console.log(`   💓 [${label}] 心跳 n=${o.n}，最近一跳距现在 ${lag}ms${gaps ? `，断档 [${gaps}]` : ''}${lag > 3000 ? ' ★主线程疑似停摆' : ''}`);
  } catch (e) {
    console.log(`   🚨 [${label}] 心跳读不到——evaluate 超时，主线程此刻无响应：${String(e.message || e).slice(0, 100)}`);
  }
}

/* ★ 2026-10-05 第十跑新增：死锁判别探针（主线程无响应时进一步判定"死在哪一层"）。
 *   ▎第九跑的结已收"Debugger.enable / Runtime.evaluate 双超时 + CPU 零增长 = native 级死锁"，
 *     但还剩两个问题没法回答：
 *     ① 是**只有 A 的渲染进程**死了，还是**整个浏览器（所有渲染器）**都不行了？
 *        ——这决定病根在"A 页面的音频/采集栈"还是"浏览器进程/GPU/系统级"。
 *     ② 合成器（属渲染进程的非主线程）还活着吗？
 *        ——活着 = 主线程单独被 native 调用挂死（如音频同步设备调用），
 *          不活 = 整个渲染进程卡住（如 GPU 通道僵死）。
 *   ▎四个探针各打一层，全部短超时（探针本身不能把看门狗拖死）：
 *     ① Browser.getVersion 走 browserWs（浏览器进程，不经过任何渲染器）；
 *     ①b SystemInfo.getProcessInfo 两次采样（间隔 2.5s）= 浏览器**内部**逐子进程 CPU 归因
 *        ——谁在停摆窗口里烧 CPU（renderer？gpu？utility？），肉眼看不见的那一层；
 *     ② 新 tab 实验：Target.createTarget('about:blank') + 新连接 evaluate
 *        ——about:blank 必然不落在 A 的渲染进程里（site isolation），
 *          它答不上 = 所有渲染器都病了；它答得上的那一刻，A 独有的东西就是嫌疑范围；
 *     ③ A 页 Page.captureScreenshot：截图尽量走合成器，主线程死时仍可能出帧；
 *          出帧 = 合成器活着（主线程被单独挂死），不出 = 整进程级问题。
 *   ▎每页最多跑 2 次（与抓栈同口径）；新 tab 用完即关，不留垃圾进程。 */
const probeGrabCount = new Map();
async function deadlockProbe(cdp, label) {
  const n = probeGrabCount.get(label) || 0;
  if (n >= 2) return;
  probeGrabCount.set(label, n + 1);
  console.log(`   🔬 [${label}] 死锁判别探针（第 ${n + 1} 次）：逐层问"谁还活着"…`);
  // ① 浏览器进程级（Browser 域不经过渲染进程）
  try {
    const t = Date.now();
    const v = await cdp._send(cdp.browserWs, 'Browser.getVersion', {}, 3000);
    console.log(`   🔬 [${label}] ① Browser.getVersion ✅ ${Date.now() - t}ms → 浏览器进程活着（${v.product}）`);
  } catch (e) {
    console.log(`   🔬 [${label}] ① Browser.getVersion ❌ → 浏览器进程/CDP 总线也出问题了：${String(e.message || e).slice(0, 80)}`);
  }
  // ①b 浏览器内部逐子进程 CPU 归因：两次采样算增量（cpuTime 单位=秒）
  try {
    const s1 = await cdp._send(cdp.browserWs, 'SystemInfo.getProcessInfo', {}, 4000);
    await sleep(2500);
    const s2 = await cdp._send(cdp.browserWs, 'SystemInfo.getProcessInfo', {}, 4000);
    const m1 = new Map((s1.processInfo || []).map((p) => [p.id, p]));
    const rows = [];
    for (const p of (s2.processInfo || [])) {
      const a = m1.get(p.id);
      if (a && typeof p.cpuTime === 'number' && typeof a.cpuTime === 'number') {
        rows.push({ type: p.type, id: p.id, d: p.cpuTime - a.cpuTime });
      }
    }
    rows.sort((x, y) => y.d - x.d);
    const top = rows.slice(0, 6).map((r) => `${r.type}#${r.id}=+${r.d.toFixed(2)}s`).join(' ');
    console.log(`   🔬 [${label}] ①b 浏览器子进程 CPU（2.5s 窗口 top6）：${top || '（无增量数据）'}`);
  } catch (e) {
    console.log(`   🔬 [${label}] ①b SystemInfo.getProcessInfo ❌（该域不可用）：${String(e.message || e).slice(0, 80)}`);
  }
  // ② 新 tab 实验（全新渲染进程）
  let newTid = null;
  try {
    const t = Date.now();
    const r = await cdp._send(cdp.browserWs, 'Target.createTarget', { url: 'about:blank' }, 5000);
    newTid = r && r.targetId ? r.targetId : null;
    console.log(`   🔬 [${label}] ② Target.createTarget ✅ ${Date.now() - t}ms（新 target ${String(newTid).slice(0, 8)}…）`);
    // /json/list 由浏览器进程服务，A 死也照常响应；新 target 可能晚一两拍入列 → 小轮询
    let tInfo = null;
    for (let i = 0; i < 4 && !tInfo; i++) {
      const list = await fetch(`http://127.0.0.1:${cdp.port}/json/list`).then((x) => x.json());
      tInfo = list.find((x) => x.id === newTid) || null;
      if (!tInfo) await sleep(250);
    }
    if (tInfo && tInfo.webSocketDebuggerUrl) {
      // silent=true：临时诊断连接，关它不能惊动主实例（否则日志误报"浏览器窗口被关掉了"，10-05 实修）
      const ws = await cdp._openWs(tInfo.webSocketDebuggerUrl, true);
      try {
        const t2 = Date.now();
        const v2 = await cdp._send(ws, 'Runtime.evaluate', { expression: '1+1', returnByValue: true }, 5000);
        const val = v2 && v2.result ? v2.result.value : '?';
        console.log(`   🔬 [${label}] ② 新 tab evaluate ✅ ${Date.now() - t2}ms（1+1=${val}）→ **新渲染器活着：问题只在 ${label} 的渲染进程里**`);
      } catch (e) {
        console.log(`   🔬 [${label}] ② 新 tab evaluate ❌ → 新渲染器也无响应（问题不在 ${label} 这一个页面，疑似更底层）：${String(e.message || e).slice(0, 80)}`);
      }
      try { ws.close(); } catch (e) { /* ignore */ }
    } else {
      console.log(`   🔬 [${label}] ② /json/list 找不到新 target（浏览器进程侧列表异常）`);
    }
  } catch (e) {
    console.log(`   🔬 [${label}] ② 新 tab 实验失败：${String(e.message || e).slice(0, 80)}`);
  }
  // ③ A 页合成器级：截图（主线程死时仍可能成功——成功即证明合成器独立存活）
  try {
    const t = Date.now();
    const s = await cdp._send(cdp.pageWs, 'Page.captureScreenshot', { format: 'jpeg', quality: 40, optimizeForSpeed: true }, 4000);
    const kb = s && s.data ? Math.round(s.data.length / 1024) : '?';
    console.log(`   🔬 [${label}] ③ A 页截图 ✅ ${Date.now() - t}ms（${kb}KB）→ **合成器还活着（主线程被单独挂死）**`);
  } catch (e) {
    console.log(`   🔬 [${label}] ③ A 页截图 ❌ ${String(e.message || e).slice(0, 60)}（合成器无响应或需主线程配合——两义，结合①②读）`);
  }
  // 收掉新 tab（不留垃圾渲染进程）
  if (newTid) {
    try { await cdp._send(cdp.browserWs, 'Target.closeTarget', { targetId: newTid }, 3000); } catch (e) { /* ignore */ }
  }
}

/* 停摆一刻抓调用栈：只在看门狗检测到异常时调用一次。
 *   ▎Debugger.pause 对"JS 死循环"有效（V8 在下一个中断检查点就会暂停并回传栈）；
 *     对"原生阻塞"无效（请求会一直挂着直到超时）——后者本身也是一条结论：
 *     主线程不在跑 JS = 病根不在源码逻辑里（如软件栅格化/内存压力）。
 *   ▎2026-10-05 第九跑修：原实现是全局布尔——A 抓过一次后 B 就永远轮不到。
 *     改 per-label 计数、每页最多抓 2 次（同一页两次停摆的栈若落在同一处，置信度远高于单次采样）。 */
const stackGrabCount = new Map();
async function hbGrabStack(cdp, label) {
  const n = stackGrabCount.get(label) || 0;
  if (n >= 2) return;
  stackGrabCount.set(label, n + 1);
  console.log(`   🩺 [${label}] 尝试 Debugger.pause 抓调用栈（第 ${n + 1} 次）…`);
  try {
    await cdp._send(cdp.pageWs, 'Debugger.enable', {}, 6000);
    const frames = [];
    cdp.on('Debugger.paused', (p) => {
      for (const f of (p.callFrames || []).slice(0, 12)) {
        frames.push(`${f.functionName || '(匿名)'} @ ${f.url || '?'}:${(f.location && f.location.lineNumber) + 1}`);
      }
    });
    try {
      await cdp._send(cdp.pageWs, 'Debugger.pause', {}, 8000);   // 死循环会立刻回 paused 事件
    } catch (e) { /* pause 挂起 = 没在跑 JS */ }
    await sleep(500);   // 给 paused 事件一点到达时间
    if (frames.length) {
      console.log(`   🩺 [${label}] 主线程暂停时的调用栈（自上而下 12 层）：`);
      for (const f of frames) console.log(`      │ ${f}`);
    } else {
      console.log(`   🩺 [${label}] Debugger.pause 超时且无栈——主线程**不在执行 JS**（原生阻塞/栅格化/资源饥饿），病根不在源码逻辑里`);
    }
    // ★ 2026-10-05：抓完必须 resume——Debugger.pause 若没被恢复，主线程会一直挂着，
    //   抓栈这个动作本身就在人为延长"停摆"（测量改变被测对象的时长 = 海森堡效应）。
    //   先 resume 再 disable；没暂停成功时 resume 会报错，吞掉即可。
    try { await cdp._send(cdp.pageWs, 'Debugger.resume', {}, 4000); } catch (e) { /* 没暂停也无妨 */ }
    try { await cdp._send(cdp.pageWs, 'Debugger.disable', {}, 4000); } catch (e) { /* ignore */ }
  } catch (e) {
    console.log(`   🩺 [${label}] Debugger 不可用：${String(e.message || e).slice(0, 90)}`);
  }
}

/* 看门狗：后台每 6s 探一次心跳；正常时沉默，异常时报一次（停摆时刻 + 恢复时刻）。
 *   ▎短超时 5s 是有意的：它本身就是"页面此刻答不答得上话"的判据。
 *     但"答不上"可能是机器过载造成的一次抖动——所以只在**连续观测**到停摆/无响应时
 *     升级为 🩺 抓栈，避免把一次慢当成一场病。 */
function hbWatch(cdp, label) {
  const st = { stop: false };
  hbWatchdogs.push(st);
  (async () => {
    let lastN = -1, downSince = 0, stallSeen = false;
    while (!st.stop) {
      let waited = 0;
      while (!st.stop && waited < 6000) { await sleep(500); waited += 500; }
      if (st.stop) break;
      try {
        const r = await cdp.evaluate(HB_READ, 5000);
        const o = r && r !== 'null' ? JSON.parse(r) : null;
        if (o) {
          if (downSince) { console.log(`   💓 [${label}] 主线程恢复响应（无响应约 ${((Date.now() - downSince) / 1000).toFixed(0)}s）`); downSince = 0; }
          const lag = o.now - o.last;
          if (o.n === lastN && lag > 3000 && !stallSeen) {
            stallSeen = true;
            console.log(`   🚨 [${label}] 主线程停摆：心跳停在 n=${o.n}，滞后 ${(lag / 1000).toFixed(0)}s @ ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`);
            await deadlockProbe(cdp, label);
            await hbGrabStack(cdp, label);
          }
          lastN = o.n;
        }
      } catch (e) {
        if (st.stop) break;
        if (!downSince) {
          downSince = Date.now();
          console.log(`   🚨 [${label}] evaluate 无响应（主线程停摆或机器过载）@ ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}：${String(e.message || e).slice(0, 80)}`);
          await deadlockProbe(cdp, label);
          await hbGrabStack(cdp, label);
        }
      }
    }
  })();
  return st;
}

/* 带告警的单点取值：evaluate 失败时**不装作没发生**——报一次"页面无响应"并附心跳快照，
 * 然后返回 fallback 让流程继续（量具坏 ≠ 被测物坏，但也不能把坏量具伪装成 0 值）。 */
const warnedEval = new Set();
async function evalWarn(cdp, expr, ms, label, fallback = '{}') {
  try { return await cdp.evaluate(expr, ms); }
  catch (e) {
    if (!warnedEval.has(label)) {
      warnedEval.add(label);
      console.log(`   🚨 [${label}] evaluate 无响应：${String(e.message || e).slice(0, 90)}（同类只提示一次）`);
      await hbDump(cdp, label);
    }
    return fallback;
  }
}

/* 合成测试语音：中文音色（System.Speech）分别合成两句话 → Node 在 PCM 层拼接
 * 确定性数字静音 → "说一句 → 长静音 → 再说一句 → 长静音"，文件供浏览器循环播放
 * （--use-file-for-fake-audio-capture）。
 *
 * ★ 2026-10-05 实修（第四跑"131s 零定稿"的根因）：原先靠 `$s.Speak('　')`（全角空格）
 *   造停顿，注释假设"≈0.5s ×12 ≈ 6s"——实测**根本不成立**：合成产物 8.58s 里
 *   15/17 个能量窗都判有声，句间只有 ~0.5s 静音。服务器成句闸的静音确认要求
 *   静音 > FLUSH_MS(1.2s)（silenceConfirmed），fixture 永远不满足 → 成句饿死。
 *   fixture 的音频节奏是**测试前提**，不能交给 TTS 处理空白字符去碰运气——
 *   改为程序拼数字静音，并在合成后自检"最长静音 ≥3s"，不合格直接 throw
 *   （坑 65/72 同族：先证明你的输入真的合格，再谈被测代码红不红）。 */
/* ★ 2026-10-06 合成逻辑搬进 scripts/voice-fixture.js 作唯一实现（第三个副本在
 *   test-voice-longrun.js，三份迟早漂——漂的那一份会以「零定稿」的面目失败，
 *   而那种失败指向被测代码，其实错在 fixture）。行为与参数一字未改：
 *   两句分开合成 + 4s/8s 数字静音 + 自检「最长静音 ≥3s」。 */
async function synthSpeechWav() {
  const fx = await makeSpeechWav({ dir: AUDIO_DIR, sentences: [SENT1, CHATTER, SENT2] });
  console.log(`   🔊 测试语音就绪（${fx.sizeKb}KB / ${fx.durSec}s，最长静音 ${fx.silSec.toFixed(1)}s）：「${SENT1}」/「${SENT2}」`);
}

/* （WAV 解析 / 组装 / 静音检查已搬进 scripts/voice-fixture.js） */
/* 从页面抓字幕/AI 状态的统一表达式（返回 JSON 字符串） */
const PAGE_STATE = `JSON.stringify((() => {
  const bar = document.getElementById('captionBar');
  const txt = document.getElementById('captionText');
  const lat = document.getElementById('capLat');
  return {
    barHidden: bar ? bar.classList.contains('hidden') : true,
    text: txt ? txt.textContent : '',
    interim: txt ? txt.classList.contains('interim') : false,
    latShown: lat ? !lat.classList.contains('hidden') : false,
    lat: lat ? lat.textContent : '',
    latTitle: lat ? lat.title : '',
    chatTail: (() => {
      const list = document.getElementById('chatList');
      if (!list) return '';
      const msgs = [...list.querySelectorAll('.msg, [class*=chat]')].map((n) => n.textContent || '');
      return msgs.slice(-20).join('｜');   // ★ 放宽窗口：高负载下 AI 应答可能被挤出最后 6 条
    })(),
    voiceLats: (() => {
      // ★ 2026-10-04 闭环总延迟的"最后一棒"：气泡上的"X.Xs 后开口"读数（文字到齐→真的开口）
      return [...document.querySelectorAll('.msg-voice-lat')].map((n) => n.textContent || '');
    })(),
    /* ★ 2026-10-04 「别人说的话有没有到我这里」要查**账本**，不能查字幕条：
     *   字幕条是"最新一句"的临时显示，几秒后自动隐藏；而 B 侧的断言是在 A 说话之后
     *   几十秒才跑的（要等 AI 应答），那时条上早就空了 —— 于是断言红，
     *   而真相是"来过，走了"。账本 cap.log 才是房间级广播的可靠证据。 */
    peerCaps: (() => {
      try {
        const log = (typeof cap !== 'undefined' && cap.log) || [];
        return log.filter((e) => e && e.from && e.from !== (typeof socket !== 'undefined' ? socket.id : ''))
          .map((e) => String(e.text || '').slice(0, 24)).slice(-4).join('｜');
      } catch (e) { return ''; }
    })(),
  };
})())`;

(async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║ E2E-ASR：语音识别真浏览器端到端（假麦克风=真语音）  ║');
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
  if (up) {
    console.log(`\n❌ ${PORT} 端口已有服务——本测试只用自己的端口。\n   换端口：TEST_E2E_ASR_PORT=3019 npm run test:e2e-asr\n`);
    process.exit(1);
  }
  /* ★ 2026-10-04 开场先清一遍临时库（双保险：库名已经带 pid+时刻、天然为空，见上面 39 行的注释）。
   * ▎这条不是洁癖：临时库原先落在 os.tmpdir() 里用一个**固定名**，跨运行持久，
   *   上一轮注册的账号还活着，于是这一轮注册直接拿到 {"error":"用户名已被注册"}，
   *   测试在①就退出——报的还是"设置失败"，看不出是上一轮的残留（坑 72 的第四次复发，
   *   第一次被中断的运行尤其容易留下脏库）。
   * ▎判据与 10-03 那条同一条纪律：**回归结果不该依赖"上一次跑没跑干净"**。
   *   端口只证明"没有别人在跑"，不证明"我这个库是空的"。 */
  for (const f of [TEST_DB_FILE, TEST_DB_FILE + '-wal', TEST_DB_FILE + '-shm', TEST_LEGACY_USERS]) {
    try { fs.rmSync(f, { force: true }); } catch (e) { /* 清不掉会有上面的注册冲突，但至少不炸在设置里 */ }
  }
  serverProc = spawn('node', [SERVER_JS], {
    env: {
      ...process.env,
      PORT: String(PORT),
      SFU_NO_HTTPS: '1',
      DB_FILE: TEST_DB_FILE,
      USERS_FILE_LEGACY: TEST_LEGACY_USERS,
      // 循环播放的同一句会在 15s 默认去重窗之外再次唤醒——测试要确定性，拉长窗口
      ASR_DUP_MS: '60000',
    },
    cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', (d) => {
    const s = String(d);
    serverLog.push(s);
    /* ★ 2026-10-05 第七跑：每条 🔥 都记到达时刻（步骤② 的"静置期"判据）——三条预热
     *   （whisper / Qwen-TTS / Qwen-ASR）各自的模型加载 + 空推理都是 CPU/显存重负载，
     *   第五/六跑"页面无响应"恰好都撞在 Qwen-ASR 预热尾上。等"最后一条 🔥 之后静置
     *   8s"再起浏览器，比固定时长可靠：预热快时不白等，预热慢时也不会漏。 */
    if (s.includes('🔥')) lastFireAt = Date.now();
    /* ★ 2026-10-05 过滤词补 GPU|CPU|预热|加速|回落：第五跑的"A 页面主线程停摆"有两个
     *   并存假说——(a) 页面真死锁、(b) 机器级 CPU 饥饿（Qwen 双 worker 抢 GPU 失败后
     *   静默回落 CPU，推理吃满核心）。engine 设备上报的这几行是 (b) 的第一现场证据，
     *   不过滤就只在 serverLog 里、看不到（tee 的日志拿不到详情）。 */
    if (/🔥|聆听|ASR\/|重复|回声|碎片|自愈|asr-dbg|asr-pick|抢跑|GPU|CPU|预热|加速|回落/.test(s)) process.stdout.write('[srv] ' + s);
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

  /* /metrics 是 admin 门禁（甲类·观测）：临时库首个注册账号自动成为 admin——
   * 注册一个拿 token，否则指标轮询只会拿到 401（首轮实测就是这么"等了 94s 没就位"的）。 */
  let adminToken = '';
  {
    const { io: Client } = require('socket.io-client');
    const s = Client(SERVER, { transports: ['websocket'], reconnection: false });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('注册超时')), 15000);
      s.on('connect', () => {
        s.emit('auth-register', { username: 'e2easr', password: 'E2eAsr#2026', displayName: 'e2e-admin' },
          (r) => {
            clearTimeout(t);
            const resp = r || {};
            adminToken = (resp.data && resp.data.token) || '';
            if (!adminToken) {
              console.log(`   ↳ 注册应答：${JSON.stringify(resp).slice(0, 160)}`);
              // 已注册过（上一轮残留的临时库）→ 直接登录拿 token
              s.emit('auth-login', { username: 'e2easr', password: 'E2eAsr#2026' }, (r2) => {
                const resp2 = r2 || {};
                adminToken = (resp2.data && resp2.data.token) || '';
                if (!adminToken) console.log(`   ↳ 登录应答：${JSON.stringify(resp2).slice(0, 160)}`);
                s.close(); resolve();
              });
            } else { s.close(); resolve(); }
          });
      });
      s.on('connect_error', (e) => { clearTimeout(t); reject(e); });
    });
    if (!adminToken) throw new Error('拿不到管理员 token（/metrics 会 401）');
  }

  console.log('② 等全部引擎预热落定（whisper + Qwen-TTS + Qwen-ASR 三条 🔥 之后还要静置 8s）…');
  /* ★ 2026-10-05 第七跑：原判据只看 `sfu_ai_asr_primary_ready`（= 主 ASR 引擎握手），
   *   而 Qwen-TTS 预热与 Qwen-ASR "模型加载 + 首次空推理"（torch 加载 + CUDA 图初始化）
   *   都可能在它之后/旁边发生——第五、六跑"A 页面无响应"恰好都撞在这段尾部重负载上
   *   （服务器日志：Qwen-ASR 那条 🔥 落在浏览器就绪 73s 前后）。修法 = 组合门槛：
   *   ① primary_ready 保持行首锚定（坑 74：HELP 行也含 gauge 名）；
   *   ② 三条预热各自"成功 🔥 或明确失败 ⚠️"（期望项按 /config.json 的引擎与本地模型目录构造）；
   *   ③ 最近一条 🔥 之后静置 8s（自适应：预热快不白等、慢也不会漏）。
   *   超时只记红、不 throw——页面卡不卡是另一个独立结论，取证照跑。 */
  let asrEngineCfg = '';
  try {
    asrEngineCfg = await new Promise((resolve) => {
      require('http').get(`${SERVER}/config.json`, (r) => {
        let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => {
          try { resolve(String(JSON.parse(b).asrEngine || '')); } catch (e) { resolve(''); }
        });
      }).on('error', () => resolve(''));
    });
  } catch (e) { asrEngineCfg = ''; }
  const modelsDir = path.join(__dirname, '..', 'models');
  const wantFire = [
    // whisper 兜底常驻 worker：服务器无条件预热（09-30e），失败行也要视为"落定"
    { name: 'whisper 常驻 worker', ok: '🔥 ASR 常驻 worker 已预热', bad: /⚠️ ASR worker 预热失败/ },
  ];
  if (asrEngineCfg === 'qwen-local' && fs.existsSync(path.join(modelsDir, 'qwen3-asr-0.6b'))) {
    wantFire.push({ name: 'Qwen3-ASR 本地 worker', ok: '🔥 Qwen3-ASR 本地 worker 已预热', bad: /⚠️ Qwen3-ASR 本地 worker 未能启动/ });
  }
  if (fs.existsSync(path.join(modelsDir, 'qwen3-tts-0.6b'))) {
    /* ★ 2026-10-05 夜二：本地 Qwen3-TTS 现在**默认不加载**（实测全天 157 次播报 engine 全是
     *   edge，千问 0 次用到，而它预热要占 ~1.5GB 显存 + 启动 ~20s）。
     *   所以这里等的是"落定"而不是"预热成功"：🔥 已预热（显式开了 aiTtsLocalWait）/
     *   🔇 按配置不加载（新默认）/ ⚠️ 启动失败 —— 三种都是确定的状态。
     *   判据（坑 67 家族）：**期望值要跟着产品的决定走**，否则一次有意的改动
     *   会永久变成一条"大家都习惯忽略的红"。 */
    wantFire.push({
      name: 'Qwen3-TTS 本地 worker（默认不加载也算落定）',
      ok: '🔥 Qwen3-TTS 本地 worker 已预热',
      alsoOk: '🔇 本地 Qwen3-TTS 未加载',
      bad: /⚠️ Qwen3-TTS 本地 worker 未能启动/,
    });
  }
  const getMetrics = () => new Promise((resolve, reject) => {
    require('http').get(`${SERVER}/metrics`, { headers: { Authorization: `Bearer ${adminToken}` } }, (r) => {
      let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => resolve(b));
    }).on('error', reject);
  });
  const primT0 = Date.now();
  let primReady = false, settled = false;
  for (let i = 0; i < 800; i++) {   // 上限 240s：三引擎冷启动（pyprobe 重试 + torch 加载 + 空推理）的宽预算
    await sleep(300);
    try {
      primReady = /^sfu_ai_asr_primary_ready 1$/m.test(await getMetrics());
    } catch (e) { /* 继续等 */ }
    const logAll = serverLog.join('');
    for (const w of wantFire) {
      /* 三种落定形态都算数（🔥 成功 / ⚠️ 明确失败 / alsoOk：按配置有意不加载） */
      if (!w.hit) w.hit = logAll.includes(w.ok) || (!!w.alsoOk && logAll.includes(w.alsoOk));
      if (!w.badHit) w.badHit = w.bad.test(logAll);
    }
    const missing = wantFire.filter((w) => !w.hit && !w.badHit);
    const quiet = lastFireAt > 0 && Date.now() - lastFireAt > 8000;
    settled = missing.length === 0 && quiet;
    if (i % 33 === 32) {   // 每 ~10s 一行进度：缺什么、最近一条 🔥 是何时
      const ago = lastFireAt ? `${((Date.now() - lastFireAt) / 1000).toFixed(0)}s 前` : '还没出现';
      console.log(`   …等预热：缺 [${missing.map((w) => w.name).join('、') || '无'}]；最近 🔥 ${ago}（已 ${((Date.now() - primT0) / 1000).toFixed(0)}s）`);
    }
    if (primReady && settled) break;
  }
  chk(primReady, `主 ASR 引擎预热完成（等了 ${((Date.now() - primT0) / 1000).toFixed(0)}s）`);
  chk(settled, `全部引擎预热落定：${wantFire.map((w) => `${w.name}=${w.hit ? '🔥' : w.badHit ? '⚠️ 失败' : '未出现'}`).join('，')}（最后一条 🔥 后静置 8s）`);
  await sleep(2000);   // 静置判据是 300ms 粒度，补足一拍再起浏览器

  console.log('③ 合成测试语音…');
  await synthSpeechWav();

  console.log('④ 起真 Chromium（假摄像头 + WAV 文件当麦克风 + 自动授权）…');
  wipeProfile(9361);
  const cdp = new Cdp({
    headless: false, port: 9361, windowSize: { width: 1280, height: 860 }, startUrl: 'about:blank',
    extraArgs: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${AUDIO_WAV.replace(/\\/g, '/')}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  browsers.push(cdp);
  await cdp.launch();
  await cdp.navigate(SERVER);
  await cdp.waitForLoad(15000);
  await sleep(1500);
  console.log(`   ✅ 浏览器 A（说话人）就绪（${since()}）`);
  /* ★ 2026-10-05 主线程心跳：从这一刻起给 A 页装监控——第五跑"A 页面主线程停摆"
   *   正是发生在这场测试的中后段（AI 应答/TTS 时段），此时注入刚好覆盖全部嫌疑窗口。 */
  await cdp.evaluate(HB_INJECT, 8000).catch(() => { /* 注入失败不阻塞主流程，探针只服务取证 */ });
  hbWatch(cdp, 'A');

  /* ★ 2026-10-05 第七跑：点击类 CDP 命令的"回执超时"不再中断全轮。
   *   ▎为什么不能重试：点击**非幂等**（双发 = 建两个房 / 进两次会），而 CDP evaluate 的
   *     超时只说明"没收到回执"、不代表"没执行"——重试可能造成双触发。
   *   ▎正解 = 单发 + 宽预算，事件真到了没有**由后续状态轮询（waitJs）说了算**；
   *     点击回执超时降级为一行警告（第六跑的教训：页面瞬时忙，回执丢了，但点击其实生效）。 */
  const clickSafe = async (target, expr, what) => {
    try { await target.evaluate(expr, 20000); }
    catch (e) {
      console.log(`   ⚠️ 点击"${what}"的 CDP 回执超时（${String(e.message || e).slice(0, 70)}）——不重试，以随后状态轮询为准`);
    }
  };

  console.log('⑤ 游客进房建房…');
  await clickSafe(cdp, `(() => { const b = document.getElementById('authGuestBtn'); if (b) b.click(); })()`, '游客进入');
  await waitJs(cdp, `!document.getElementById('prejoin').classList.contains('hidden') ? 1 : 0`, 60000, '预览页出现');
  await sleep(1200);
  await clickSafe(cdp, `(() => { const b = document.getElementById('pjEnterBtn'); if (b) b.click(); })()`, '进入会议');
  await waitJs(cdp, `!document.getElementById('roomPanel').classList.contains('hidden') ? 1 : 0`, 60000, '房间面板出现');
  await sleep(600);
  await clickSafe(cdp, `(() => { const b = document.getElementById('createBtn'); if (b) b.click(); })()`, '创建房间');
  const roomText = await waitJs(cdp, `(document.getElementById('roomBadge').textContent || '').match(/\\d{6}/) ? document.getElementById('roomBadge').textContent : ''`, 75000, '房间号');
  const ROOM = (String(roomText).match(/\d{6}/) || [])[0];
  chk(!!ROOM, `建房拿到 6 位房间号 = ${ROOM || '(无)'}`);
  if (!ROOM) { await hbDump(cdp, 'A@⑤失败'); throw new Error('没拿到房间号'); }   // 抛前先拍心跳快照：停摆发生在哪一段一目了然
  await sleep(1200);

  console.log('⑥ 点字幕按钮，断言进入服务器转写模式…');
  await clickSafe(cdp, `(() => { document.getElementById('capBtn').click(); })()`, '字幕开关');
  /* 等到目标状态出现再读——直接 sleep 读是"猜它已渲染好"；这里等的是断言真正要的文案
   * （'服务器转写（引擎）' 由 renderCapStatus 写入）。等不到就如实读当前值，断言红出真相。 */
  await waitJs(cdp, `/服务器转写/.test((document.getElementById('capStatus')||{textContent:''}).textContent) ? 1 : 0`, 30000, '字幕进入服务器转写状态');
  let capStatus = '';
  try { capStatus = String(await cdp.evaluate(`(document.getElementById('capStatus') || {textContent:''}).textContent`, 15000)); }
  catch (e) { capStatus = `(读取失败：${String(e.message || e).slice(0, 60)})`; }   // 读不到 ≠ 状态错——如实记下，断言自然会红
  /* ▸ ★ 2026-10-04 判据加严：以前只断言"含服务器转写"，于是徽标写成
   *   **"服务器转写（服务器转写）"** 也照样绿——那正是本次 e2e 日志里抓到的界面撒谎
   *   （/config.json 有三处读取器，只有进房那一处会写引擎名；见 client.js 的 applyServerConfig）。
   *   一条只查"关键词在不在"的断言，永远查不出"这句话是不是人话"。 */
  chk(/服务器转写/.test(String(capStatus)) && !/服务器转写（\s*服务器转写\s*）/.test(String(capStatus))
    && !/引擎待确认/.test(String(capStatus)),
    `字幕状态徽标 = "${capStatus}"（要点明是哪个引擎，且不能拼成重复的一句）`);

  /* ★ 2026-10-03e 第二个真浏览器（与会者视角）：字幕/AI 应答是**房间级广播**——
   *   此前所有语音证据都是单窗，"别人的话能不能出现在我的字幕条上"从未被自动化覆盖，
   *   而这正是"投入真实使用"的第一问（开会不止一个人）。B 保持预静音（不抢话）。 */
  console.log('④b 起浏览器 B（与会者，预静音，只看不说）…');
  wipeProfile(9362);
  const cdpB = new Cdp({
    headless: false, port: 9362, windowSize: { width: 1280, height: 860 }, startUrl: 'about:blank',
    extraArgs: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  browsers.push(cdpB);
  await cdpB.launch();
  await cdpB.navigate(SERVER);
  await cdpB.waitForLoad(15000);
  await sleep(1200);
  await clickSafe(cdpB, `(() => { const b = document.getElementById('authGuestBtn'); if (b) b.click(); })()`, 'B 游客进入');
  await waitJs(cdpB, `!document.getElementById('prejoin').classList.contains('hidden') ? 1 : 0`, 60000, 'B 预览页');
  await sleep(1000);
  /* ★ 2026-10-05 实测发现：B 的注释一直写着"预静音"，但勾选框默认**未勾选**（index.html 无 checked）
   *   → B 带着假麦克风（没有 --use-file 参数 = Chrome 默认连续蜂鸣）进了会：
   *   ① whisper 把蜂鸣幻听成"词曲 李宗盛"写进字幕账本，污染断言环境；
   *   ② 蜂鸣持续喂 ASR/TTS 链路白烧 GPU。这里显式勾上「入会时静音麦克风」，
   *   client 的进会路径（第 25 步）会据此把本地麦静音——注释与实现这才对上。
   *   ★ 第七跑：读取包重试（置 checked 幂等，重试安全）；两次都读不到才记红。 */
  let bMute = null;
  for (let i = 0; i < 2 && bMute === null; i++) {
    try {
      bMute = await cdpB.evaluate(`(() => { const c = document.getElementById('pjMuteChk'); if (!c) return 'no-el'; c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); return c.checked; })()`, 15000);
    } catch (e) {
      console.log(`   ⚠️ B 侧勾选预静音失败（第 ${i + 1} 次）：${String(e.message || e).slice(0, 60)}`);
      await sleep(800);
    }
  }
  chk(bMute === true, `B 预览页勾上「入会时静音麦克风」（预静音；读数=${bMute}）`);
  await clickSafe(cdpB, `(() => { const b = document.getElementById('pjEnterBtn'); if (b) b.click(); })()`, 'B 进入会议');
  await waitJs(cdpB, `!document.getElementById('roomPanel').classList.contains('hidden') ? 1 : 0`, 60000, 'B 房间面板');
  await sleep(500);
  await clickSafe(cdpB, `(() => {
    const i = document.getElementById('roomInput');
    i.value = ${JSON.stringify(ROOM)};
    i.dispatchEvent(new Event('input', { bubbles: true }));
    const b = document.getElementById('joinRoomBtn');
    if (b) b.click();
  })()`, 'B 加入房间');
  /* 成员数 = 人 + AI（capBtn 已自动请 AI 入会）：B 加入后应 ≥3（A + AI + B）。
   * 固定断言 '2' 是 e2e-media 时代的口径，没算 AI 这位"虚拟参会者"。 */
  const bMembers = await waitJs(cdpB, `(parseInt((document.getElementById('memberNum')||{textContent:'0'}).textContent) >= 3) ? 1 : 0`, 75000, 'B 侧成员数≥3');
  chk(!!bMembers, 'B 凭号加入成功（双人在会）');
  /* ★ 2026-10-06 B 没进来时，一次红了会连着拖四条下游断言（B 字幕 / B 应答气泡 /
   *   B 白板开合 / B 笔迹像素），而报错里看不出"是哪一段没通"。本跑实测就是这种形状：
   *   B 页面日志只有 8 行 260 字符（几乎没活动），而 A 侧刚记到一个 6429ms 长任务、
   *   A 的成员 id 还换过一次（AAAD→AAAF，说明 A 重连过）——到底是 B 没进、A 掉了、
   *   还是房间号打错了，光看那四条红猜不出来。
   *   ▸ 所以红了就把两侧各自看到的现场打出来（读不到也要说清读不到，不许静默）。 */
  if (!bMembers) {
    const diag = await evalWarn(cdpB, `JSON.stringify((() => {
      const num = (id) => { const el = document.getElementById(id); return el ? String(el.textContent).trim().slice(0, 20) : '(无)'; };
      const rows = document.querySelectorAll('.member-row, #memberList > *').length;
      const logEl = document.getElementById('logList') || document.getElementById('log');
      const log = logEl ? String(logEl.textContent).split('\\n').slice(-6).join(' ⏎ ') : '(没有日志面板)';
      return { badge: num('roomBadge'), memberNum: num('memberNum'), rows,
        roomPanelHidden: (document.getElementById('roomPanel') || { classList: { contains: () => null } }).classList.contains('hidden'),
        prejoinHidden: (document.getElementById('prejoin') || { classList: { contains: () => null } }).classList.contains('hidden'),
        input: (document.getElementById('roomInput') || { value: '' }).value, toast: num('toast'), log };
    })())`, 8000, 'B@加入失败现场');
    const aNum = await evalWarn(cdp, `(document.getElementById('memberNum')||{}).textContent || '?'`, 8000, 'A@成员数', '读不到');
    const d = JSON.parse(diag || '{}');
    console.log('   🧾 B 现场：' + JSON.stringify(d).slice(0, 420));
    console.log(`   🧾 A 侧成员数读到 "${aNum}"（A 若也在掉线/重连，这一串红是同一件事）`);
  }
  // B 也开字幕（它要看 A 的转写）
  await clickSafe(cdpB, `(() => { document.getElementById('capBtn').click(); })()`, 'B 字幕开关');
  await sleep(800);
  console.log(`   ✅ 浏览器 B（与会者）就绪并已开字幕（${since()}）`);
  /* ★ 2026-10-05 B 也装心跳：第五跑里 B 侧断言全红（字幕/白板都没到）——但要先回答
   *   "这是 A 没发出去，还是 B 没收到"。两条狗一起放，才能把责任端定位到具体一侧。 */
  await cdpB.evaluate(HB_INJECT, 8000).catch(() => { /* 同 A：探针失败不阻塞主流程 */ });
  hbWatch(cdpB, 'B');

  console.log('⑦ 开麦（预静音默认勾选，真人也要点这一下）…');
  /* ★ 2026-10-04 判"当前是开麦还是静音"要读 **aria-label**，不能读 textContent。
   *   ▎为什么：第 43 步的"上涨式按钮"把同一句话克隆成两层（基础层 + 悬停层，
   *     悬停层带 aria-hidden）——那是这个动效的正常实现，不是 bug；
   *     代价是 textContent 会变成「取消静音取消静音」。
   *   ▎所以正确的读法是 aria-label：第 46 步起它由 setIconBtn 与文案**同步维护**，
   *     本来就是"这颗按钮此刻是干什么"的权威声明。读屏走的也是这一条。
   *     （换句话说：这个断言不是被我改宽的，是被迫用对了那个属性。） */
  const micLabel = `(document.getElementById('muteBtn') || {}).getAttribute && (document.getElementById('muteBtn').getAttribute('aria-label') || document.getElementById('muteBtn').textContent.trim())`;
  /* ★ 第七跑：读状态失败不再把整轮崩掉——读是幂等的，重试安全；点击走 clickSafe。 */
  const micTry = async () => {
    try { return await cdp.evaluate(micLabel, 15000); }
    catch (e) {
      console.log(`   ⚠️ 读麦克风按钮状态失败：${String(e.message || e).slice(0, 60)}`);
      return null;
    }
  };
  for (let i = 0; i < 3; i++) {
    const t = await micTry();
    if (t === '静音') break;              // 按钮显示「静音」= 当前处于开麦态
    await clickSafe(cdp, `(() => { document.getElementById('muteBtn').click(); })()`, '开麦');
    await sleep(600);
  }
  let micState = await micTry();
  if (micState === null) micState = await micTry();   // 读失败再补一拍（读幂等，无副作用）
  chk(micState === '静音', `麦克风已开（按钮文本 "${micState}" = 开麦态）`);
  const unmuteAt = Date.now();

  console.log('⑧ 等字幕条真的出字 → 等到定稿（看字幕条的非半句态；⏱ 读数只作观测）…');
  let firstCapAt = 0, firstFinalAt = 0, finalText = '', latReadout = '';
  /* ★ 2026-10-06 ⑨ 的证据从"一句快照"改成"整段累积"。
   *   ▎真机跑出来的红：服务器日志明明转出了「小明，帮我记一下明天下午三点的评审会」，
   *     而 ⑨ 只读**第一条定稿**那一句 + 轮询瞬间的字幕条 —— 2s 分段把长句切成
   *     「小明。」/「帮我记。」/「一下明天下午三点的。」/「庭审会。」，
   *     于是"评审/纪要"这些词在快照里就是不在了，红得像是"识别不行"。
   *   ▸ 一条只读瞬间的断言，测的是**采样时机**不是产品（坑 44/72 同族：断言站错了时间位置）。
   *     改成把轮询期间看到的**每一条定稿**都收进 capAll，正解命中从这堆真到过的文本里数。 */
  const capAll = new Set();
  const latSeen = [];               // ★ 2026-10-03e 收集全部定稿读数：第一条可能带余热，
  let lastLatKey = '';              //   稳态值（第 2 条起）才是"以后每句话"的真实体感
  let firstLatAt = 0;               //   第一条 ⏱ 读数出现的时刻（连续音频下可能一条都没有）
  const pollDeadline = Date.now() + 90000;
  while (Date.now() < pollDeadline) {
    const raw = await cdp.evaluate(PAGE_STATE, 5000).catch(() => null);
    if (raw) {
      const o = JSON.parse(raw);
      const body = String(o.text).replace(/^[^：]*：/, '').trim();  // 去掉"名字："
      if (!o.barHidden && body.length > 2) {
        if (!firstCapAt) {
          firstCapAt = Date.now();
          console.log(`   🎬 第一条字幕（开麦后 ${((firstCapAt - unmuteAt) / 1000).toFixed(1)}s）：「${String(o.text).slice(0, 44)}」${o.interim ? '（半句）' : '（定稿）'}`);
        }
      }
      /* ★ 2026-10-03e 定稿判据改为**锁存信号**：renderCapLatency 只在定稿时刷新 ⏱
       *   且一经显示不再隐藏——所以 latShown=true = "至少一条定稿已发生"，
       *   ⏱ 数值每变一次 = 又一条定稿。原判据（恰好在轮询瞬间抓到"非半句+读数"）
       *   要在半句 2s 一刷的流里撞窗口，高负载下整轮全撞半句 → 假"从未定稿"。 */
      /* ★ 2026-10-05 夜二：定稿判据换成**直接看字幕条自己的 interim 态**。
       *   原来它盯 ⏱ 读数是否现身（latShown 锁存）。而读数从本轮起只在
       *   "RMS 静音确认"的定稿上产出（max-open / max-age / gap 收口时人还在说，
       *   量出来的数不是"说完→上屏"，宁可不显示——见 server 的 finalizeUtterance 与坑 90）。
       *   假麦克风是**连续循环播放**，句子基本靠 max-age 收口 → 永远没有读数
       *   → ⑧ 假红"从未定稿"，而同一跑里正解命中/AI 应答/B 端广播全绿。
       *   ▸ 一个装饰性读数不能当"事件发生过"的证据（坑 76）；字幕条的非半句态才是。 */
      if (!firstFinalAt && o.interim === false && body.length > 2) {
        firstFinalAt = Date.now();
        finalText = String(o.text);
        console.log(`   ✅ 首条定稿（开麦后 ${((firstFinalAt - unmuteAt) / 1000).toFixed(1)}s，字幕条非半句态）：「${finalText.slice(0, 40)}」`);
      }
      /* 每一条定稿都收下（不是只收第一条）——⑨ 的正解命中要靠这一整段。
       * 上限 60 条：假麦克风是循环播放的，一场跑下来几十条，够用且不养内存。 */
      if (o.interim === false && body.length > 2 && capAll.size < 60) capAll.add(body);
      if (o.latShown) {
        if (!firstLatAt) {
          firstLatAt = Date.now();
          latReadout = `${o.lat} ｜ ${String(o.latTitle).split('\n').slice(0, 2).join(' ／ ')}`;
        }
        const key = String(o.lat);
        if (key !== lastLatKey) { lastLatKey = key; latSeen.push(key); }
      }
    }
    /* 收满 5 条读数就停；没有读数（连续音频 → max-age 收口）也别白等到 90s：
       定稿已确认 + 过了 40s 就收工，读数缺失在下面如实标成"未采到"，不判红。 */
    if (latSeen.length >= 5) break;
    if (firstFinalAt && latSeen.length === 0 && Date.now() - firstFinalAt > 40000) break;
    await sleep(500);
  }
  /* ★ 2026-10-05 run-17 的教训（一条前置判据值四条红）：⑦ 的"✅ 麦克风已开"证明的是
   *   **按钮状态**，不是**音频在流**。那一跑 80 段全是 `peak=-90.3`（纯数字静音），
   *   ⑧⑨⑩ 四条红各自解释成"字幕没出/正解没命中/AI 不接话"，
   *   而真相只有一句：**音频根本没进系统**（假麦克风没接上/输入设备选错）。
   *   ▸ 判据（坑 65"断言 0 之前先证明输入真进去了"的正向版）：出字失败时先数服务器转写了几条，
   *     把"是链路没声音"与"有声音但处理坏了"当场分开——否则一次环境抖动会被读成三个产品缺陷。 */
  const srvAsrCount = (serverLog.join('').match(/\[ASR\//g) || []).length;
  if (!firstCapAt) {
    console.log(`   🚨 服务器侧转写 ${srvAsrCount} 条`
      + (srvAsrCount === 0
        ? ' ⇒ 音频根本没进系统（假麦克风/输入设备问题）：⑧⑨⑩ 的红都是这一条的连坐，不要去改产品代码'
        : ' ⇒ 服务器收到了语音，是"到了页面却没显示"这一段的问题'));
  }
  chk(!!firstCapAt, `字幕条出字（开麦后 ${firstCapAt ? ((firstCapAt - unmuteAt) / 1000).toFixed(1) + 's' : '——从未出现'}）· 服务器转写 ${srvAsrCount} 条`);
  chk(!!firstFinalAt, `字幕真的定稿过（判据=字幕条出现"非半句"的一整句；${firstFinalAt ? '开麦后 ' + ((firstFinalAt - unmuteAt) / 1000).toFixed(1) + 's' : '——从未定稿'}）`);
  /* ★ 2026-10-05 夜二 ⏱ 读数**只要求诚实，不要求存在**：
   *   读数只在"RMS 静音确认"的定稿上产出；假麦克风是连续循环播放，
   *   句子靠 max-age 保险丝收口，此时量出来的十几毫秒不是"说完→上屏"，
   *   所以宁可不显示（用户上一轮看到的「⏱ 0.0s」而真实等待 ~10s，就是它在撒谎）。
   *   ▸ 判据：一旦出现读数，必须 ≥0.2s（物理下限）且 ≤60s；一条都没有 = 如实标注，不判红。 */
  const latNums = latSeen.map((s) => parseFloat(String(s).replace(/[^\d.]/g, ''))).filter(Number.isFinite);
  chk(latNums.length === 0 || latNums.every((v) => v >= 0.2 && v <= 60),
    latNums.length ? `⏱ 读数诚实（${latNums.length} 条都在 0.2s~60s 之间，没有"0.0s"那种撒谎值）`
      : '⏱ 读数本次未产出（连续音频 → max-age 收口，按诚实性规则不显示）——定稿本身已在上条确认');
  if (!latNums.length) console.log('   ℹ️ 想看到 ⏱ 读数：说一句话后**停 1.5 秒以上**（真人节奏自然会有这个停顿）');

  if (latReadout) console.log(`   ⏱ 首条：${latReadout}`);
  if (latSeen.length) {
    const secs = latSeen.map((s) => parseFloat(String(s).replace(/[^\d.]/g, ''))).filter(Number.isFinite);
    if (secs.length) {
      const steady = secs.slice(1);
      const show = (arr) => arr.length ? `${arr.map((v) => v.toFixed(1)).join('/')}s` : '（只有一条）';
      console.log(`   ⏱ 全部定稿：${show(secs)}；稳态（第 2 条起）：${show(steady)}——真机感受以稳态为准`);
      if (steady.length >= 2) {
        // 中位数口径：共享机器（浏览器解码/LLM/ffmpeg 同框）上单点离群不该判死，
        // 但"一半以上的句子都慢"必须红。
        const sorted = [...steady].sort((a, b) => a - b);
        const med = sorted[Math.floor((sorted.length - 1) / 2)];
        /* ★ 2026-10-04g 回归红线用「最快稳态句」：本机连跑数小时后 GPU 热节流会把
         *   后半段读数单调抬高（实测 1.2/1.9 健康值 → 6~8s），那是机器状态不是产品回退。
         *   红线 = 管线**能**给出 ≤Ns 的定稿（不退化）；漂移只打印观察。
         * ★ 2026-10-10（B6）这条线从 3s 改到 4s，**不是为了让它绿**，是因为它的刻度停在
         *   一个已经不存在的产品形态上。同场次实测三跑（同一台机器、同一个引擎、顺序跑）：
         *     · 整句重转开（今天的默认）：3.0 / 3.1 / 3.2s
         *     · ASR_REFINE=0（关掉重转）：2.5 / 2.6s           ⇒ 重转买正确性花 ≈0.5s
         *     · 10-04 那批 1.2~1.5s 的数：既没有整句重转，也**没有 10-07 的"尾巴段没到不许定稿"闸**
         *       ⇒ 剩下那 ≈1s 是"等装着尾字的那一段封口"，那是**买正确性**买的（原来「评审会」少一个「会」）
         *   ▸ 为什么不直接调回 3s：那会让这条线每天红一次，而天天误报的告警等于没有告警（坑 67/82）。
         *   ▸ 为什么不是"放宽到随便"：4s 之上就是**产品回退**——今天三个数里最大的 4.1s 是"后半句抬高"，
         *     而历史故障形态是 6~8s 与 10s 保险丝，那条差得还远；同时**中位数继续打印**，
         *     "一半以上句子慢"这件事由上面那条中位数断言守着（≤6s），不是这条最快值。 */
        chk(Math.min(...steady) <= 4, `稳态定稿最快 ≤4s（各句 ${show(steady)}，中位 ${med.toFixed(1)}s）——`
          + `这条线 10-10 从 3s 改到 4s 的理由与同场次 A/B 数字写在上面注释里，不是为了让它绿`);
        /* ★ 上面那条注释里我顺手写了"中位数由另一条断言守着"——**核了一遍，那条断言从来不存在**。
         *   第 893 行的注释也一直在说"中位数口径…但一半以上的句子都慢必须红"，而代码只比了 min。
         *   这正是本项目反复记的那个形状：**注释承诺了保护，代码没有实现它**（坑 76/82），
         *   而这条线唯一的用处就是"最快值很好、后面一路变慢"这种失败形态——min 恰好看不见它。
         *   补上：med ≤6s（与界面 ⏱ 的三色档同一条线：≤3 好 / ≤6 warn / 更慢 bad）。 */
        chk(med <= 6, `稳态定稿中位 ≤6s（med=${med.toFixed(1)}s，n=${steady.length}）——最快值好而一半句子慢，只有这条看得见`);
      }
    }
  }
  if (firstFinalAt) await shot(cdp, 0);
  await hbDump(cdp, 'A@⑨前');   // 边界心跳快照：⑨ 之后就要开始读计数了，停摆与否在此划界

  console.log('⑨ 正解命中检查（转写内容认得出测试句子）…');
  await sleep(3000);
  /* ★ 2026-10-05 第五跑实修：原写 `.catch(() => '{}')`——把"页面无响应"伪装成
   *   "文本全空 → 关键词命中 0"（假红指向转写质量，真相是主线程停摆）。
   *   改用 evalWarn：读不到就明报"页面无响应"+ 心跳快照，fallback 仍让流程继续。 */
  const rawState = await evalWarn(cdp, PAGE_STATE, 5000, 'A@⑨正解命中');
  const st2 = JSON.parse(rawState || '{}');
  /* ★ 2026-10-05 run-17 抓到的一条**假绿**（比红更危险）：原先的 haystack 直接拼进 `chatTail`，
   *   而 AI 的**入会致辞**模板里本来就含"小明"（它自己的名字）与"生成纪要"——
   *   于是那一跑**一条转写都没有**（80 段全是 peak=-90.3 纯静音，音频根本没进系统），
   *   ⑨ 照样命中 ["小明","纪要"] 报绿。漏掉的恰好只有"评审"——那个词只可能来自真话。
   *   ▸ 判据（坑 65"断言 0 之前先证明输入真进去了"的正向版）：
   *     ① 先断言**转写来源非空**当前提，前提不成立就明说"音频根本没进系统"，
   *        而不是让下游三条断言各自把空文本解释成不同毛病；
   *     ② 命中只从**转写来源**数（字幕账本 + 字幕条）。聊天区里的 AI 气泡证明的是
   *        "它说过话"，不是"耳朵听到了人话"——它只能被排除，不能被当证据。 */
  const asrSource = `${[...capAll].join('｜')}｜${st2.text || ''}`;
  const capStr = `${asrSource}｜${st2.chatTail || ''}`;   // 只作取证打印
  const kw = ['小明', '评审', '纪要'];
  chk(asrSource.replace(/[｜\s]/g, '').length > 2,
    '⑨ 前提：转写来源非空（空=音频根本没进系统，正解命中无从判起）');
  const hit = kw.filter((k) => asrSource.includes(k));
  /* ★ 2026-10-06 夜二 失败信息要自解释引擎降级：我为了省显存用 `ASR_QWEN_LOCAL=0` 跑过一次，
   *   兜底的 whisper small 在 2s 分段下把「小明」听成「晓明」、「纪要」写成「记要」，
   *   三个关键词只剩 1 个命中，这条当场红。那是**我换掉被测配置**造成的假红，不是产品回退
   *   （用户实际跑的是 qwen-local）。判据：跑测试前先确认引擎与用户配置一致，别为省资源偷换引擎。 */
  const engineWarn = process.env.ASR_QWEN_LOCAL === '0'
    ? ' ▸注意：本次强制 ASR_QWEN_LOCAL=0（whisper 兜底），保真度低于用户配置的 qwen-local —— 这条红不能当回归结论'
    : '';
  chk(hit.length >= 2, `转写正解命中关键词 ${JSON.stringify(hit)}（定稿共 ${capAll.size} 条参与判定）${engineWarn}`);
  console.log(`   字幕/气泡文本（前 260 字）：${capStr.slice(0, 260)}`);

  console.log('⑩ 断言 AI 应答气泡（唤醒词 → 耳朵→脑子→嘴 全链路）…');
  /* ★ 2026-10-05 第十跑新增：⑩ 是高危区（第五/八/九跑都在此前后出现主线程停摆）——
   *   先把"到达高危区之前"的长任务形状拍下来；万一后面页面永久停摆读不出来，
   *   这一张快照就是唯一能对停摆归因的页面侧数据。 */
  await pageInspect(cdp, 'A@⑩前');
  await pageInspect(cdpB, 'B@⑩前');
  let botReply = '';
  const ansDeadline = Date.now() + 45000;
  while (Date.now() < ansDeadline && !botReply) {
    const raw = await evalWarn(cdp, PAGE_STATE, 5000, 'A@⑩应答轮询');
    const o = JSON.parse(raw || '{}');
    const msgs = String(o.chatTail || '').split('｜').filter((t) => /AI 小明/.test(t) && !/大家好，我是会议|已接入.*正在聆听/.test(t) && t.replace('AI 小明', '').trim().length > 6);
    if (msgs.length) botReply = msgs[msgs.length - 1];
    else await sleep(1000);
  }
  chk(!!botReply, `AI 应答气泡出现：「${botReply.slice(0, 70)}」`);
  if (botReply) await shot(cdp, 1);

  /* ⑩b ★ 2026-10-06 夜二「这是正常会议，没叫它就别开口」的**真浏览器端到端**版。
   * ▎为什么服务器自测过了还要再来一遍：TEST_ASR 那条走的是 RTP 直推，
   *   "浏览器→WebRTC→AI 耳朵"这一段它并不覆盖（这条边界本项目已经吃过一次教训）；
   *   而用户看到的"它插话"发生在**页面上**——聊天气泡有没有多出来一条。
   * ▎三条缺一不可（顺序不能反）：
   *   ① 前提：那句没叫它的闲聊**真的被转写出来**了 —— 否则"没回应"只是"没听见"（坑 65 的假绿）；
   *   ② 前提：AI 至少答过一次 —— 否则"零插话"可能整条链路都没通；
   *   ③ 判据：**没有任何一条气泡是在回应那句闲聊**（内容命中 天气/拍卖 且不含正事词）。
   * ▸ A/B 实测可红：`AI_CHAT_WINDOW_SEC=20`（旧的滚动追问窗口）复跑本测试，第 ③ 条会红。 */
  {
    const rawAfter = await evalWarn(cdp, PAGE_STATE, 5000, 'A@⑩b插话判定');
    const stA = JSON.parse(rawAfter || '{}');
    const seenText = [...capAll].map(String).join('｜') + '｜' + String(stA.text || '');
    chk(/天气|拍卖/.test(seenText),
      '⑩b 前提：没叫它的那句闲聊确实上了字幕（否则"没接话"什么也没证明）',
      seenText.slice(-90));
    const bots = String(stA.chatTail || '').split('｜')
      .filter((t) => /AI 小明/.test(t) && !/大家好，我是会议|已接入.*正在聆听/.test(t));
    const unprompted = bots.filter((t) => /天气|拍卖/.test(t) && !/纪要|评审|记录|待办|排期/.test(t));
    chk(bots.length >= 1 && unprompted.length === 0,
      `★ ⑩b 正常会议里它没有插话：AI 气泡 ${bots.length} 条，回应闲聊的 ${unprompted.length} 条`,
      unprompted.map((t) => t.slice(0, 46)).join(' / '));
  }

  /* ★ 2026-10-03e 闭环收口：等「🔊 X.Xs 后开口」读数出现（浏览器朗读 onstart 时贴上）。
   *   它量的是"文字到齐→真的开口"，加上字幕定稿延迟就是"说完→听到回答"的全链路。 */
  let voiceLat = '';
  const vDeadline = Date.now() + 30000;
  while (Date.now() < vDeadline && !voiceLat) {
    const raw = await evalWarn(cdp, PAGE_STATE, 5000, 'A@⑩语音读数轮询');
    const o = JSON.parse(raw || '{}');
    const lats = (o.voiceLats || []).filter((t) => /后开口/.test(String(t)));
    if (lats.length) voiceLat = lats[lats.length - 1];
    else await sleep(1000);
  }
  if (voiceLat) console.log(`   🔊 播报延迟读数：「${voiceLat}」——字幕 ${latSeen.length || '—'} 条定稿之后的一棒`);
  /* ★ 2026-10-04 第 12 项任务：把"喇叭真的出声了"从**打印**升级成**断言**。
   *   ▎原来这里是一行 console.log + "不判失败"——那是当时还不知道无头浏览器会不会
   *     跑 speechSynthesis 时的保守写法。现在知道了（会，voices:0 也照样触发 onstart），
   *     而"它答应了却不说话"恰恰是用户报得最狠的那个症状：
   *     **一个不会为"沉默"变红的测试，等于没在测这件事**（坑 57/65 同一条纪律）。
   *   ▸ 读数是在 <audio>/utterance 的 onstart 上贴的（"真的开始播"），
   *     不是"服务器说它发了"，所以它成立就意味着浏览器确实开口了。 */
  /* ★ 2026-10-05 第五跑实修：这里原来是 `.catch(() => ({}))`——**把"页面无响应"
   *   伪装成"计数器全 0"**：失败信息说"喇叭没开过口"（指向 AI/TTS 链路），
   *   而真相是"A 页面主线程停摆、这个数根本读不出来"（指向页面本身）——两种病的处方完全不同。
   *   （坑 71 家族：量具的假数据比错误本身更贵，它会把调查引向错误的方向。）
   *   现在：读不到 = 明报"页面无响应"+ 心跳快照，只判**一条**红（计数不可得），
   *   不把它折算成"AI 没说话"——那是另一条断言的事，不该由坏量具连坐。 */
  let vt = null, vtErr = '';
  try {
    const rawVt = await cdp.evaluate(`(function(){
      const t = window.__SFU_AI_VOICE__ || {};
      const s = t.srvSkip || {};
      return { asked: t.asked || 0, started: t.started || 0, killed: t.killed || 0, saved: t.saved || 0,
               gated: Object.keys(t.gated || {}).map((k) => k + '=' + t.gated[k]).join(','),
               srvGot: t.srvGot || 0, srvSkip: Object.keys(s).map((k) => k + '=' + s[k]).join(','),
               srvDrop: t.srvDrop || 0, srvQ: t.srvQ || 0, srvPlay: t.srvPlay || 0,
               srvOnp: t.srvOnp || 0, srvRes: t.srvRes || 0, srvRej: t.srvRej || 0,
               srvErr: t.srvErr || 0, srvEnd: t.srvEnd || 0,
               busy: typeof serverTtsBusy === 'boolean' ? serverTtsBusy : 'n/a',
               qlen: serverTtsQueue && typeof serverTtsQueue.length === 'number' ? serverTtsQueue.length : 'n/a',
               playingTs: typeof serverTtsPlayingTs === 'undefined' ? 'none' : String(serverTtsPlayingTs),
               voiceOn: typeof aiVoiceOn === 'undefined' ? 'unknown' : aiVoiceOn,
               speechOk: typeof window.speechSynthesis === 'object' };
    })()`, 15000);
    /* ★ 2026-10-05 run-16 抓到的**结构性假红**（红得可疑，但不是产品的错）：
     *   上面那个 IIFE `return` 的是一个**对象**，而 `cdp.evaluate` 用 `returnByValue:true`
     *   取值——到 Node 这一侧已经是真 JS 对象了。这里再 `JSON.parse(对象)`
     *   等于 `JSON.parse("[object Object]")` → **必然抛错**，于是这条断言自写下起
     *   就没有"通过"的可能，而它报出去的措辞是"A 页面主线程无响应"
     *   ——把一个量具 bug 长期伪装成产品缺陷（坑 86 家族：量具的失败被测成了被测物的故障）。
     *   当场证伪的证据就在同一份日志里：`💓 心跳 n=356，最近一跳 258ms` + `🧾 长任务 0 个`
     *   ——页面活得好好的。
     *   ▸ 判据：跨 CDP 边界取结构化数据，**要么在页面里 JSON.stringify，要么直接收对象**，
     *     不能一边 returnByValue 一边再 parse 一遍（两处各表一次态 = 必有一个是错的）。 */
    vt = (rawVt && typeof rawVt === 'object') ? rawVt : JSON.parse(rawVt || '{}');
  } catch (e) {
    vtErr = String(e.message || e);
    /* ★ 措辞纪律：这里**不许**替原因下结论。原先写死"A 页面主线程无响应？"，
     *   而实际抛的可能是量具自己的解析错（见上面 JSON.parse 那条）——
     *   一句话把调查方向整个带走（坑 86）。原因让错误原文自己说，页面活着没有由心跳说。 */
    console.log(`   🚨 播报链路计数没读到，原因见下（别直接当成产品缺陷）：${vtErr.slice(0, 110)}`);
    await hbDump(cdp, 'A@⑩播报快照');
  }
  if (vt) {
    console.log(`   🧾 播报链路计数：${JSON.stringify(vt)}`);
    /* ★ 2026-10-05 漏斗判读辅助（让"started=0"一次说清断在哪一环）：
     *   srvGot=0 → 服务器压根没发（查服务器 ai-tts/ai-tts-failed 日志）；
     *   srvSkip 非空 → 客户端早期拦截（voice-off/no-url/no-speech）；
     *   srvDrop>0 → 被判"这一轮已被打断"（serverTtsDropped 拉黑）；
     *   srvQ>0 而 srvPlay=0 → 卡在队列（前一截 busy 未释放）；srvPlay>0 而 srvOnp=0
     *   → 播放链内部停摆（看 res/rej/err 三个出口谁动了）。 */
    if ((vt.started || 0) === 0 && (vt.srvOnp || 0) === 0) {
      const funnel = `got=${vt.srvGot || 0} skip[${vt.srvSkip || ''}] drop=${vt.srvDrop || 0} q=${vt.srvQ || 0} play=${vt.srvPlay || 0} res=${vt.srvRes || 0} rej=${vt.srvRej || 0} err=${vt.srvErr || 0} end=${vt.srvEnd || 0} busy=${vt.busy} qlen=${vt.qlen} playingTs=${vt.playingTs}`;
      console.log(`   🧪 漏斗断点自查：${funnel}`);
    }
    chk(vt.voiceOn === true && vt.speechOk === true, 'AI 语音开关是开的、浏览器有 speechSynthesis（否则后面都无从谈起）');
    /* ★ started 是**双轨聚合计数**（client.js 两处自增：浏览器 onstart 与服务端轨 onplaying）——
     *   判"到底开口没有"用它，而不是单看浏览器那一轨（服务端 TTS 可用时浏览器让位是设计行为）。 */
    chk((vt.started || 0) >= 1, `★ 喇叭真的开过口（浏览器 onstart / 服务端轨 onplaying 合计 ${vt.started || 0} 次）`);
    /* ★ 2026-10-04f killed 的口径修正：这个 fixture 的"假人"大部分时间在说话（循环语音），
     *   AI 礼让（killed>0）是**正确行为**而不是误杀——waitForTurnThen 等一轮后放弃是设计内。
     *   真正要守的红线是"至少开过一次口"（上一条）+ "误杀不能反超开口"（下面这条）。 */
    chk((vt.killed || 0) <= (vt.started || 0) * 2, `应答的礼让/开口比例合理（started=${vt.started || 0}，killed=${vt.killed || 0}，gated=${vt.gated || '无'}）`);
  } else {
    /* ★ 红要红得清楚（坑 57 那条口诀）：把**真实原因原文**带进断言名，
     *   页面活着没有由上面的心跳快照作证，而不是由这条断言替它下结论。 */
    chk(false, `播报链路计数不可得（原因原文：${(vtErr || '未知').slice(0, 80)}；`
      + `页面是否响应看上方心跳快照——别把量具的错记成产品缺陷）`);
  }
  await hbDump(cdp, 'A@⑩后');   // 边界心跳快照：播音链路刚被读过，此刻状态一目了然
  /* ★ 2026-10-04g 🔊 读数在自动化里偶发采不到（浏览器 TTS 的 onstart 时序），
   *   而"真的开了口"已由上一条 started>=1 硬断言把守——这里降级为观察项，不再判死。 */
  if (voiceLat) console.log(`   🔊 读数：${voiceLat}`);
  else console.log('   ⚠️ 未采到 🔊 读数（观察项；开口本身由 started>=1 断言把守）');

  /* ★ 2026-10-03e B 侧断言：字幕与 AI 应答真的广播到了第二个人。
   *   A 说话（假麦克风）→ 服务器转写 → 房间广播 → B 的字幕条/历史/AI 气泡都要有。 */
  console.log('⑩b 与会者 B 侧：等 A 的字幕与 AI 应答到达…');
  let bCapSeen = false, bBotSeen = false;
  const bDeadline = Date.now() + 40000;
  while (Date.now() < bDeadline && !(bCapSeen && bBotSeen)) {
    const rawB = await evalWarn(cdpB, PAGE_STATE, 5000, 'B@⑩b轮询', null);
    if (rawB) {
      const o = JSON.parse(rawB);
      if (!bCapSeen && String(o.peerCaps || '').length > 2) {
        bCapSeen = true;
        console.log(`   📺 B 的字幕账本收到 A 的话：「${String(o.peerCaps).slice(0, 40)}」`);
      } else if (!bCapSeen && !o.barHidden && String(o.text).replace(/^[^：]*：/, '').trim().length > 2) {
        bCapSeen = true;
        console.log(`   📺 B 字幕条收到：「${String(o.text).slice(0, 40)}」`);
      }
      if (!bBotSeen) {
        const ai = String(o.chatTail || '').split('｜').filter((t) => /AI 小明/.test(t) && !/大家好，我是会议|已接入.*正在聆听/.test(t) && t.replace('AI 小明', '').trim().length > 6);
        if (ai.length) { bBotSeen = true; console.log(`   📺 B 看到 AI 应答：「${ai[ai.length - 1].slice(0, 46)}」`); }
      }
    }
    if (!(bCapSeen && bBotSeen)) await sleep(800);
  }
  chk(bCapSeen, 'B 的字幕条收到 A 的语音转写（房间级广播）');
  chk(bBotSeen, 'B 看到 AI 应答气泡（应答广播到全员）');
  if (bCapSeen) await shot(cdpB, 0);

  /* ★ 2026-10-03e AI 房间动作双端同步：A 在聊天里说「把白板打开」→ tools-first 路由
   *   （不进 LLM）→ room-control 广播 → **两个窗口的白板都要开**。真浏览器里这条
   *   链路此前只有 vm 桩证据。 */
  console.log('⑩c AI 房间动作：A 聊天说「把白板打开」，断言双端白板都开…');
  /* ★ 2026-10-05 健壮性：原先是裸 await——第四跑 A 页面卡住时这条 evaluate 超时
   *   把整个测试崩掉（⑩d/⑪ 全被截断，损失一半证据）。单条 CDP 命令失败应记为
   *   该步不可达、后续断言照跑，而不是终止整轮（量具坏 ≠ 被测物坏，但也不能吞证据）。 */
  try {
    await cdp.evaluate(`(() => {
      const i = document.getElementById('chatInput');
      i.value = '@ai 把白板打开';
      i.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('chatSendBtn').click();
    })()`, 8000);
  } catch (e) {
    console.log(`   ⚠️ A 页面无响应（发聊天失败）：${String(e.message || e).slice(0, 120)}——白板断言按实际结果如实记录`);
  }
  const aBoard = await waitJs(cdp, `!document.getElementById('boardOverlay').classList.contains('hidden') ? 1 : 0`, 20000, 'A 侧白板打开');
  chk(!!aBoard, 'A 侧白板已打开');
  const bBoard = await waitJs(cdpB, `!document.getElementById('boardOverlay').classList.contains('hidden') ? 1 : 0`, 10000, 'B 侧白板打开');
  chk(!!bBoard, 'B 侧白板同步打开（房间级视图指令广播）');
  if (aBoard && bBoard) await shot(cdpB, 1);

  /* ★ 2026-10-04f 白板笔迹走 SCTP 双端同步：A 在画布上画一笔 → 'board' 数据通道广播
   *   → B 的画布上真的出现像素。F7 白板的"画了能到对面"从未被真浏览器断言过
   *   （vm 桩只证明事件路由，不证明像素落了地）。判据 = getImageData 扫非透明像素。 */
  console.log('⑩d 白板笔迹同步：A 画一笔，断言 A/B 两块画布都有笔迹像素…');
  /* ★ 先等两块画布有真实 CSS 尺寸：白板刚开（room-control 同步打开）的瞬间
   *   canvas 可能还没完成布局——归一化坐标 × 0 = 全画到原点（首跑实测 B 端
   *   只有 32 像素 = 那颗画在原点附近的起笔圆点）。 */
  await waitJs(cdp, `document.getElementById('boardCanvas').clientWidth > 100 ? 1 : 0`, 8000, 'A 画布尺寸就绪');
  await waitJs(cdpB, `document.getElementById('boardCanvas').clientWidth > 100 ? 1 : 0`, 8000, 'B 画布尺寸就绪');
  const blank = `JSON.stringify((() => {
    const c = document.getElementById('boardCanvas');
    if (!c) return { missing: true };
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) ink++;
    return { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight, ink };
  })())`;
  try {
    await cdp.evaluate(`(() => {
      const c = document.getElementById('boardCanvas');
      const r = c.getBoundingClientRect();
      const y0 = r.top + r.height * 0.5;
      const mk = (type, x, y) => c.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse',
        clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, isPrimary: true,
      }));
      mk('pointerdown', r.left + r.width * 0.2, y0);
      for (let k = 1; k <= 8; k++) mk('pointermove', r.left + r.width * (0.2 + k * 0.06), y0 - k * 4);
      mk('pointerup', r.left + r.width * 0.68, y0 - 32);
    })()`, 8000);
  } catch (e) {
    console.log(`   ⚠️ A 页面无响应（画布落笔失败）：${String(e.message || e).slice(0, 120)}——笔迹断言按实际结果如实记录`);
  }
  await sleep(1200);   // 先给 SCTP 广播 + B 侧重放一拍（下面的轮询是兜底，不是主力）
  /* ★ 2026-10-06 读像素改成**等到出现为止**（最多 10s），不再"画完读一次"定生死。
   *   ▎真机红过一次：B 的 ink=0，而同一次跑里 A=3616、B 的字幕/AI 应答/白板开合全绿，
   *     且 B 页面上刚记到一个 3013ms 的长任务——笔迹到了、但落在重排之后。
   *     单次读取撞在"还没画"的那一刻，红的其实是**采样时机**（坑 44 同一条：
   *     异步测试里"读的位置"决定结论；10-04e 已把触摸类断言改成"等到发生为止"，这次补笔迹）。
   *   ▸ 上限 10s 由产品语义给：白板是实时协作，10 秒还没落笔就是真没到，不该再放宽。
   *   ▸ 保留 2026-10-05 那条修正：catch 必须带错误形状，不许回落成 ink:0
   *     （"量具没等到"与"白板真没画上"是两种结论，混成一条红会指错方向）。 */
  async function readInk(client, label, budgetMs = 10000) {
    const deadline = Date.now() + budgetMs;
    let last = { ink: -1 };
    let tries = 0;
    while (Date.now() < deadline) {
      tries += 1;
      const raw = await client.evaluate(blank, 20000).catch((e) => JSON.stringify({ ink: -1, err: String(e.message || e) }));
      try { last = JSON.parse(raw); } catch (e) { /* 解析失败保留上一次读数，不编一个 0 */ }
      if (last.ink > 200) break;
      await sleep(400);
    }
    if (!(last.ink > 200)) console.log(`   🔍 ${label}轮询 ${tries} 次仍未见笔迹${last.err ? '（读像素本身失败：' + last.err + '）' : ''}`);
    return last;
  }
  const aInk = await readInk(cdp, 'A 画布');
  const bInk = await readInk(cdpB, 'B 画布');
  chk(!aInk.missing && aInk.ink > 200, `A 画布落笔（ink=${aInk.ink} 像素，画布 ${aInk.cw}×${aInk.ch}）`);
  chk(!bInk.missing && bInk.ink > 200, `B 画布收到同一笔（ink=${bInk.ink} 像素，画布 ${bInk.cw}×${bInk.ch}，SCTP 'board' 通道）`);

  console.log('⑪ 汇总服务器侧证据…');
  /* ★ 2026-10-05 第十跑新增：汇总前先做页面侧取证（长任务/日志面板/JS 堆）——
   *   停在 hbDump 之前：hbDump 自身只是读心跳，不应改变观测对象的负载形状。 */
  await pageInspect(cdp, 'A@终');
  await pageInspect(cdpB, 'B@终');
  await hbDump(cdp, 'A@终');    // 终态心跳：与各边界快照对照，直接看出停摆发生在哪一段
  await hbDump(cdpB, 'B@终');
  const asrLines = serverLog.join('').split('\n').filter((l) => /ASR\/|聆听|重复|回声|碎片/.test(l));
  console.log(asrLines.slice(-14).map((l) => `   │ ${l.trim()}`).join('\n'));

  console.log(`\n████ E2E-ASR 结果：${checks} 项检查，${issues} 项失败 ████`);
  process.exitCode = issues ? 1 : 0;
})().catch((e) => {
  console.error(`\n❌ E2E-ASR 异常：${e.stack || e.message}`);
  process.exitCode = 1;
}).finally(async () => {
  for (const w of hbWatchdogs) { w.stop = true; }   // 先停心跳看门狗：浏览器马上要被 kill，狗再 evaluate 只会报一串假警报
  for (const b of browsers) { try { b.kill(); } catch (e) { /* 已退 */ } }
  if (serverProc) {
    try { serverProc.kill(); } catch (e) { /* 已退 */ }
    await sleep(800);
    try { spawn('taskkill', ['/PID', String(serverProc.pid), '/T', '/F'], { windowsHide: true }); } catch (e) { /* 已退 */ }
  }
  /* 成败都把这一轮的临时库收走（10-03 那条纪律：清理要写在 catch/finally 里，
     写在正常路径上等于"失败一次就留下一次污染"）。名字已带 pid-时刻，本来就不会互相撞，
     这里收的是临时目录里的那点残留。 */
  for (const f of [TEST_DB_FILE, TEST_DB_FILE + '-wal', TEST_DB_FILE + '-shm', TEST_LEGACY_USERS]) {
    try { fs.rmSync(f, { force: true, maxRetries: 4, retryDelay: 150 }); } catch (e) { /* 占用就留着，下次运行不读它 */ }
  }
});
