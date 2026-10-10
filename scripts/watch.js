// ★ scripts/watch.js —— 零依赖值守告警（G7-③，2026-09-19）
// ▎是什么：定时拉 /api/rooms + /metrics，命中阈值就打告警（可选 webhook 推送）——
//   "异常能被发现"是可观测性的最后一环（G7-① 指标 ✅ → G7-② 日志 ✅ → 本脚本=③）。
// ▎告警规则（克制版，只挑"真值得半夜叫人"的）：
//   ① 服务器拉不到（/api/rooms 连续失败）——服务挂了/端口没了
//   ② 媒体健康分低于阈值（score<4 = 大量丢包/编码跟不上）
//   ③ 房间宽限期即将结束（<10s，提醒"空房马上回收"）
//   ④ 进程内存超限（rss > WATCH_MAX_RSS_MB，默认 512MB）
// ▎用法：
//   npm run watch                          # 默认每 10 秒一轮，Ctrl+C 退出
//   npm run watch -- --interval 30 --max-rss 400
//   ADMIN_TOKEN=<token> npm run watch      # ★ 09-24：/api/rooms 与 /metrics 现在要管理员 token
//   WATCH_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xx npm run watch
//   （webhook = 一次 fetch POST，企业微信/钉钉机器人都能收）
// ▎ADMIN_TOKEN 怎么拿：在会议页用管理员账号登录 → 浏览器控制台执行
//   JSON.parse(localStorage.wb_auth).token 取值即可（这就是服务器签发的那个 token）。
const args = process.argv.slice(2);
const argOf = (name, dft) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dft;
};
const BASE = argOf('--url', 'http://localhost:3001');
const INTERVAL = Math.max(5, parseInt(argOf('--interval', '10'), 10)) * 1000;
const MAX_RSS = parseInt(argOf('--max-rss', '512'), 10) * 1048576;
const voiceState = { asrMiss: 0, tts: null, counters: {}, fallbackRounds: 0, gapRounds: 0, capSlowRounds: 0, speakSlowRounds: 0, bootWaitRounds: 0 }; // ★ 09-30f：语音链路翻转诊断的上一轮状态；counters = 计数基准；*Rounds = 各条"连续两轮才算"的退化判据
/* ★ 2026-10-07 H6：跨网形态的上一轮观测（level 只在这里记账——判据是"变没变"，不是"是什么"）。 */
const netState = { level: null };
const WEBHOOK = process.env.WATCH_WEBHOOK_URL || null;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;   // ★ 09-24 G8：接口门禁后必须带 token
const AUTH_HEADERS = ADMIN_TOKEN ? { Authorization: `Bearer ${ADMIN_TOKEN}` } : {};
const SCORE_MIN = 4;   // mediasoup 健康分 1~10，低于 4 = 媒体质量差

const failing = { api: 0 };          // 连续失败计数（告警只报状态变化，不刷屏）
const lastAlert = new Map();         // 告警键 -> 上次触发时刻（同类告警 5 分钟限流）
const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });

async function pushWebhook(text) {
  if (!WEBHOOK) return;
  try {
    await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content: `[meeting-sfu] ${text}` } }),
    });
  } catch (e) { /* webhook 失败不影响本地告警 */ }
}

function alert(key, text) {
  const now = Date.now();
  if (now - (lastAlert.get(key) || 0) < 5 * 60000) return; // 同类 5 分钟内只报一次
  lastAlert.set(key, now);
  console.log(`[${ts()}] 🚨 告警[${key}] ${text}`);
  pushWebhook(text);
}

/* ★ 2026-10-07 H6：把"这台服务器还能不能被外面连上"变成**常驻告警**。
 * ▎为什么要这一步：`nets.diagnose()` 的结论以前只在两个地方出现过——启动日志（滚过去就没了）
 *   和邀请面板（得有人正好点开）。而跨网这件事的失效方式恰好是**沉默**的：
 *   DHCP 漂了 IP、路由器换了信道、Tailscale 掉线、HTTPS 被谁关掉——
 *   服务器自己一切正常，网页也打得开，只有"外面的人"进不来，而他是唯一会来报告的人（坑 36 的形态）。
 * ▎判据的三条纪律：
 *   ① **只在"变差"时报**，不在"一直是这样"时报。家里/办公室内网部署本来就该是 lan-only，
 *     一条天天误报的告警等于没有告警（坑 67/82 同一条）；
 *   ② **第一观测不下结论**——watch 每次启动都从零开始，若"没有上一轮"就报警，
 *     那么每次值班启动都会叫一次，那和 ① 是同一种噪音；
 *   ③ 恢复要说出来（只报坏不报好，人会开始怀疑"是不是没修好"，而实际上修好了）。
 * @param netCheck 服务器 `/config.json` 下发的 netCheck（nets.diagnose() 的返回值）；null=老服务器/读失败
 * @param prev     跨轮状态（{ level }），就地改写
 * @param now      当前时刻（可注入，方便断言）
 * @returns 告警数组 [{key, text}]
 */
const NET_RANK = { 'localhost-only': 0, 'lan-only': 1, 'tailscale': 2, 'public': 3 };
function diagnoseNetAccess(netCheck, prev, now) {
  const out = [];
  if (!netCheck || typeof netCheck.level !== 'string' || !(netCheck.level in NET_RANK)) {
    return out;                       // 读不到 = 不下结论（"读不到"≠"读到 0"，坑 71 同一条）
  }
  const level = netCheck.level;
  /* 配置漂移**先判、且不受"有没有上一轮"影响**：它是一个此刻成立的事实
     （自愈把 level 保住了，用户的配置文件仍然是错的），不需要基线就能报。
     ▸ 这一条的位置不是随便挑的：原先写在下面 `level === before` 的提前返回之后，
       于是"配置过期但 level 没变"这个**最常见**的形态一条都不会报——
       断言（test:watch H6 组最后一条）当场把它抓了出来。 */
  const drift = (netCheck.items || []).find((i) => i && i.label === '配置核对' && i.state === 'bad');
  if (drift) {
    out.push({
      key: 'net-config-drift',
      text: `config.json 里的 announcedIp 已过期，本次靠**运行时自愈**顶着：${drift.detail}`
        + (drift.fix ? `｜请把它固化下来：${drift.fix}` : '')
        + '｜自愈只保这一次运行；不写回配置是刻意的（那是用户的配置文件，工具不该改）。',
    });
  }
  const before = prev.level;
  prev.level = level;                 // ★ 先记账再判断：任何一条分支都不许漏掉这次更新
  if (!before || level === before) return out;   // 纪律 ② 与"没变不重复报"
  if (NET_RANK[level] < NET_RANK[before]) {
    const bad = (netCheck.items || []).filter((i) => i && i.state === 'bad');
    out.push({
      key: 'net-downgrade',
      text: `跨网能力**下降**：${before} → ${level}。` + (netCheck.headline || '')
        + (bad.length ? `｜现在不合格的检查：${bad.map((b) => b.label).join('、')}` : '')
        + (bad[0] && bad[0].fix ? `｜建议先试：${bad[0].fix}` : '')
        + '｜判据：sfu/nets.js 的 diagnose()，界面版在邀请面板里（点房间号徽标）。',
    });
  } else {
    console.log(`[${ts()}] ✅ 跨网能力恢复：${before} → ${level}`);
  }
  return out;
}

/* ★ 2026-10-03 语音/协作的**退化诊断**抽成纯函数。
 * ▎为什么单独抽出来：这是"判断逻辑"，判断错的代价是**要么天天误报、要么永远不报**，
 *   两种都让人很快放弃看告警。而它跑在长跑值守里，没法靠"打开浏览器看一眼"验证——
 *   所以必须能拿合成输入穷举断言（同 rdDecideFps 那条纪律：性能/判断类逻辑
 *   恰恰最需要确定性，否则只能"跑起来看着还行"）。
 * @param metricsText /metrics 的原始文本
 * @param collab      /api/rooms 里的 collab（要 asrEngine：配置期望用哪个引擎）
 * @param prev        上一轮的计数器快照（会被就地更新）
 * @param state       跨轮状态（fallbackRounds / gapRounds），同样就地更新
 * @returns {Array<{key:string, text:string}>} 本轮要报的告警
 */
function diagnoseVoiceAndCollab(metricsText, collab, prev, state) {
  const out = [];
  if (!metricsText) return out;
  /* ★ 2026-10-10（B4 审计的第一条产出）：所有"从 /metrics 取一个数"的正则**一律锚行首 + 锚行尾**。
   *   ▎为什么这不是洁癖：Prometheus 文本的 `# HELP <名字> <说明>` 行里就含"名字 空格 数字"——
   *     而 `sfu_ai_asr_primary_ready` 的说明恰好写着 **"1 when the configured primary ASR engine..."**。
   *     未锚定的 `flagOf()` 于是**永远读到 1**（HELP 行先匹配上），于是 10-03 精心写的
   *     "预热期分诊"整条失效：主引擎明明还没起来，watch 却认定"起来了却不用"，
   *     开机第二轮就报 asr-engine-retreat（该沉默时刷屏）；同一未锚定写法还让 counterOf 可能
   *     把说明里的数字当成计数。**告警工具的失效方式恰好就是它要防的那种失效**（静默/误报）。
   *   ▸ 测试为什么没抓到：test-watch 的合成文本只写样本行、不写 HELP 行（坑 83——
   *     假环境缺一种形态，那条分支就永久不测）。这次给合成文本补上 HELP/TYPE 行，
   *     并把"锚定"本身变成一条能红的断言。 */
  const valRe = (key) => new RegExp('^' + String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    + '(?:\\{[^}]*\\})? (-?\\d+(?:\\.\\d+)?|NaN|-?Inf)$', 'm');
  /* 带符号/小数的读数（-1 = 还没发生、NaN = 样本不足），并**区分"读不到"与"读到 0"**（坑 71）。 */
  const numOf = (key) => {
    const m = valRe(key).exec(metricsText);
    if (!m) return null;
    const v = Number(m[1]);
    return Number.isFinite(v) ? v : null;
  };
  const counterOf = (key) => {
    const m = valRe(key).exec(metricsText);
    return m ? Number(m[1]) : 0;
  };
  const delta = (key) => { const v = counterOf(key); const d = v - (prev[key] || 0); prev[key] = v; return d; };
  const labelsOf = (base) => [...new Set(
    (metricsText.match(new RegExp('(?:^|\\n)' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{[^}]+\\}', 'g')) || [])
      .map((s) => /="([^"]*)"/.exec(s)).filter(Boolean).map((m) => m[1]),
  )];
  /* 带 label 的 gauge 取值（kind="avg" 这一类）。 */
  const gaugeOf = (base, kind) => {
    const m = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      + '\\{kind="' + kind + '"\\} (-?\\d+(?:\\.\\d+)?)$', 'm').exec(metricsText);
    return m ? Number(m[1]) : 0;
  };
  /* 布尔开关取值：**区分"这行不存在"与"这行是 0"**。
   * ▎反例就是这条规则自己：若把"老服务器没有 primary_ready 这一行"当成 0（=没就位），
   *   兜底告警就会在老服务器上**永远不响**——那正是我们一路在防的"静默失效"。 */
  const flagOf = (key) => {
    const m = valRe(key).exec(metricsText);
    return m ? Number(m[1]) === 1 : null;
  };

  /* ① 引擎退化：配置说"用 qwen-local"，而这一轮真出字幕的段**全都来自兜底引擎**。
   *    要求连续 2 轮才报——启动预热期本地 worker 没就绪，走兜底是**正确行为**，
   *    一有变化就报等于天天误报（误报的代价是以后没人看告警）。
   * ★ 2026-10-03 补上"预热期"的正面判据：本地 worker 冷启动要 ~55s，而 10s 一轮的
   *   watch 连两轮就落在窗口里 → 每次开机都可能误报。现在按 primary_ready 分成两种病：
   *     · 主引擎**还没起来**却一直在兜底 = 预热期，先耐心等（超过 N 轮才报"起不来"）；
   *     · 主引擎**已经起来**却还让兜底干活 = 真退化，按原来的两轮判据报。
   *   ▸ 老服务器不带这一行（flagOf=null）→ 退回原行为，绝不因为"读不到"就闭嘴。 */
  const expected = collab && collab.asrEngine;
  const EXPECTED_KEYS = { 'qwen-local': ['qwen-local'], qwen: ['qwen'], whisper: ['常驻', 'CLI'] };
  const want = EXPECTED_KEYS[expected] || [];
  const primaryReady = flagOf('sfu_ai_asr_primary_ready');
  const BOOT_PATIENCE_ROUNDS = Math.max(2, Number(process.env.WATCH_ASR_BOOT_ROUNDS) || 12);
  if (want.length) {
    let mine = 0; let other = 0;
    for (const eng of labelsOf('sfu_ai_asr_segments_total')) {
      const d = delta(`sfu_ai_asr_segments_total{engine="${eng}"}`);
      if (want.indexOf(eng) >= 0) mine += d; else other += d;
    }
    if (mine === 0 && other > 0) {
      if (primaryReady === false) {
        state.bootWaitRounds = (state.bootWaitRounds || 0) + 1;
        if (state.bootWaitRounds === BOOT_PATIENCE_ROUNDS) {
          out.push({ key: 'asr-engine-stuck', text: `主引擎 ${expected} 的 worker 到第 ${state.bootWaitRounds} 轮仍未就绪，字幕一直由兜底承担（慢 3~5 倍）`
            + ` —— 这不是预热而是起不来：查启动日志那行 🔥/⚠️、models/ 目录是否存在、以及 python 是否能 import qwen_asr` });
        }
      } else {
        state.bootWaitRounds = 0;
        state.fallbackRounds += 1;
        if (state.fallbackRounds === 2) {
          out.push({ key: 'asr-engine-fallback', text: `配置的主引擎是 ${expected}（它就位了却没用），连续两轮字幕都由兜底引擎转写（慢 3~5 倍）——查 worker 是否被并发闸卡住` });
        }
      }
    } else {
      if (state.fallbackRounds >= 2) out.push({ key: 'asr-engine-ok', text: `主引擎 ${expected} 已回到转写一线（兜底轮数 ${state.fallbackRounds} 结束）` });
      if ((state.bootWaitRounds || 0) >= BOOT_PATIENCE_ROUNDS) out.push({ key: 'asr-engine-ok', text: `主引擎 ${expected} 已就绪并开始承担转写` });
      state.fallbackRounds = 0;
      state.bootWaitRounds = 0;
    }
  }
  /* ② 白板归档被拒：客户端在送脏数据（非法颜色/坐标），或版本与服务器不同步。
   *    这条几乎不会误报——正常客户端只会送 hex 颜色 + 0~1 坐标。 */
  const rejected = delta('sfu_board_records_total{op="rejected"}');
  if (rejected > 0) out.push({ key: 'board-rejected', text: `白板归档有 ${rejected} 笔被服务器拒绝（颜色/坐标不合法）——客户端可能在送脏数据` });

  /* ②b 本地 Qwen ASR worker 因"单次推理超时"被换过进程（坑 89 的自愈路径）。
   *   ▎为什么值得报警但又不是故障：这条**本来就是为偶发失控准备的**，触发说明模型
   *     确实会偶尔停不下来（实测单次 93.5s / p50 0.5s），而系统靠换进程 + whisper 兜底
   *     接住了、字幕没丢。所以措辞是"知道一下"而不是"坏了"。
   *   ▎更重要的另一面：在加这条之前，这个重启路径**从来没有被真实触发过**，
   *     按坑 76 的纪律就不能声称"已验证"。有了这条告警，"到底卡死过没有"变成查得到的事实。
   *   ▸ 老服务器没有这一行时 delta 返回 0（不是 NaN）→ 静默跳过，不会误报。 */
  const restarted = delta('sfu_ai_asr_worker_restarts_total');
  if (restarted > 0) {
    out.push({ key: 'asr-worker-restart', text: `本地 Qwen ASR worker 因单次推理超预算被重启 ${restarted} 次`
      + `（预算 ${Math.round((Number(process.env.ASR_TIMEOUT_MS) || 12000) / 1000)}s）——这些段已回落 whisper 兜底、字幕没丢，`
      + `但说明模型存在偶发失控，值得看一眼显存/CPU 是否有别的东西在抢` });
  }

  /* ③ 房间动作"说了没做"：服务器发出了指令，客户端却一次都没回执。
   *    同样要连续 2 轮：回执是异步的，单轮里可能只是还没到。 */
  let issued = 0; let applied = 0;
  for (const a of labelsOf('sfu_room_control_total')) issued += delta(`sfu_room_control_total{action="${a}"}`);
  for (const a of labelsOf('sfu_room_control_applied_total')) applied += delta(`sfu_room_control_applied_total{action="${a}"}`);
  if (issued > 0 && applied === 0) {
    state.gapRounds += 1;
    if (state.gapRounds === 2) out.push({ key: 'room-control-gap', text: `房间动作发出了 ${issued} 条却没有任何客户端回执 —— 客户端的 room-control 处理表可能漏了分支（AI 说了但没做）` });
  } else {
    state.gapRounds = 0;
  }
  /* ④ ★ 2026-10-03 两条端到端延迟退化（字幕 / 播报），共用同一个判据函数。
   *    ▎为什么抽成一个函数：两组的"样本要够 + 连续两轮 + 报出 avg/max/样本数"完全同形，
   *      复制两份必然出现"字幕两轮、播报三轮"这种口径漂移（坑 47）。
   *    ▎为什么播报延迟单独一条很值：它的故障形态是"**答应了却不说话**"——
   *      历史上查过三次才查明白，而这三次都没有任何一行日志会红。
   *    ▸ 样本 <3 不下结论：一两句时均值被单个长句完全带跑，那是噪声不是退化（坑 53）。
   *    ▸ 连续 2 轮：一次网络抖动或模型冷启动会抬一轮，报出来只会让人学会忽略告警。 */
  const latRule = (stateKey, okKey, base, slowKey, cnName, warnMs, hints) => {
    const n = counterOf(`${base}_count_total`);
    const avg = gaugeOf(base, 'avg');
    if (n >= 3 && avg > warnMs) {
      state[stateKey] = (state[stateKey] || 0) + 1;
      if (state[stateKey] === 2) {
        out.push({ key: slowKey, text: `${cnName}均值 ${(avg / 1000).toFixed(1)}s`
          + `（最慢 ${(gaugeOf(base, 'max') / 1000).toFixed(1)}s，样本 ${n} 次），超过 ${warnMs / 1000}s 阈值`
          + ` —— 查：${hints}` });
      }
    } else {
      if ((state[stateKey] || 0) >= 2) out.push({ key: okKey, text: `${cnName}恢复正常（均值 ${(avg / 1000).toFixed(1)}s）` });
      state[stateKey] = 0;
    }
  };
  const CAP_WARN_MS = Math.max(1000, Number(process.env.WATCH_CAP_LAT_WARN_MS) || 6000);
  const SPK_WARN_MS = Math.max(1000, Number(process.env.WATCH_SPEAK_LAT_WARN_MS) || 8000);
  latRule('capSlowRounds', 'caption-ok', 'sfu_ai_asr_caption_latency_ms', 'caption-slow', '字幕延迟（说完→上屏）',
    CAP_WARN_MS, '①引擎是否退回兜底（看 asr-engine-* 那条）②asrSegmentSec 是否被配大 ③CPU 是否被本地模型占满');
  latRule('speakSlowRounds', 'speak-ok', 'sfu_ai_speech_latency_ms', 'speech-slow', '播报延迟（看到答案→听见开口）',
    SPK_WARN_MS, '①Edge 神经语音端点是否不可达（sfu_ai_tts_enabled）②本地 Qwen3-TTS 是否在 CPU 上合成（RTF>1，一句 ~12s）'
    + '③是否 aiTtsLocalWait=1 让慢引擎抢了实时播报 ④客户端是否根本没在播（自动播放策略拦截）');
  /* ⑤ ★ 2026-10-06 夜二「没人叫它，它却开口了」——这条产品规矩的生产端哨兵。
   * ▎为什么必须常驻而不是靠一次人工验证：用户拍板的规矩是"只有叫到小明，小明才说话"，
   *   而违反它的形态**极其安静**——AI 答得条理分明，只是没人叫它。日志不会红、
   *   界面不会报错，只有用户一次次说"它又在插话"（这次就是攒到 18/21 才发现）。
   *   任何一次改动把免唤醒窗口或宽表带回来，这一条要在下一轮值守里喊出来。
   * ▎判据（不是"有 follow-up 就报"，那样会把合法形态报成故障）：
   *   纯唤醒模式（`aiChatWindowMs === 0`）下，唯一合法的"没被叫到也答"是
   *   **被 2s 分段切断的半句**，而它每次前面必有一次 `name-only`（只叫名字的唤醒）。
   *   所以违规量 = `follow-up 增量 − name-only 增量`，累计 ≥2 才报（单轮 1 次的
   *   同音误听不值得打断人，误报的代价是以后没人看告警）。
   * ▎对话模式（用户自己把 aiChatWindowSec 设成正数）下这条**整体沉默**——
   *   那是他选的形态，不是故障；判据要用服务器交出来的事实，不是猜。 */
  const labeledCounter = (base, labelVal) => {
    /* 必须锚行首：Prometheus 的 `# HELP` 行里也含同名与标签文本，
       不加锚会把帮助文档读成一个样本值（这个坑本项目踩过一次，坑 74）。 */
    const re = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      + '\\{' + labelVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\} (\\d+)', 'm');
    const m = re.exec(metricsText);
    return m ? Number(m[1]) : null;      // null = 这行不存在（老服务器），与"读到 0"是两种语义
  };
  const labeledDelta = (key, base, labelVal) => {
    const v = labeledCounter(base, labelVal);
    if (v === null) return null;
    const d = v - (prev[key] || 0); prev[key] = v;
    return d;
  };
  const winMs = collab && typeof collab.aiChatWindowMs === 'number' ? collab.aiChatWindowMs : null;
  const dTail = labeledDelta('via|follow-up', 'sfu_ai_answer_via_total', 'via="follow-up"');
  const dName = labeledDelta('via|wake', 'sfu_ai_answer_via_total', 'via="wake"');
  const dNo = labeledDelta('throttled|name-only', 'sfu_ai_answer_throttled_total', 'reason="name-only"');
  if (winMs === 0 && dTail !== null && dName !== null && dNo !== null) {
    const excess = dTail - Math.max(0, dNo);
    state.unprompted = Math.max(0, (state.unprompted || 0) + excess);
    const MIN = Math.max(1, Number(process.env.WATCH_UNPROMPTED_MIN) || 2);
    if (state.unprompted >= MIN) {
      out.push({ key: 'ai-unprompted', text: `AI 在**没人叫它**的时候答了话：本轮免唤醒续答 ${dTail} 次`
        + `、只叫名字的唤醒 ${dNo} 次（累计超出 ${state.unprompted} 次），而服务器处于纯唤醒模式`
        + ' —— 查：①追问窗口是否被 config.aiChatWindowSec 打开成 0 以外'
        + ' ②唤醒表是否被放宽（歧义写法/称呼语境那条分层判据）③是否有客户端绕过服务器直接 ai-ask' });
    }
  } else if (winMs !== 0) {
    state.unprompted = 0;   // 对话模式 / 老服务器没有这几行：不下结论，也不留着旧账
  }

  /* ⑧ ★ 2026-10-10（D2）播报漏斗的"两头静音"哨兵。
   * ▎为什么这一条必须常驻：09-25~10-06 之间用户报了四次"它答应了却不说话"（坑 66 / 66② / 94 / 0.11），
   *   每一次的调查都是"翻一小时日志 + 猜三次方向"。10-06 把回落修成有界之后，自测里多了一条
   *   红线（声明 tts:'server' 必须给出 ai-audio 或 ai-tts-fail）——**但那条红线只在自测跑的那一次生效**。
   *   真实会议里再来一条路径漏收口，没有任何东西会喊人，而这一格的形状恰恰是全静默、零报错。
   * ▎判据：四本账里 `silent` 是唯一一个**不该非零**的数（declared 有、delivered/failed 都没有 = 漏口）。
   *   所以它涨一点就报，不必像"没人叫它却开口"那样攒到 2 次——那一条有合法形态要容忍，这一条没有。
   * ▸ 两条不下结论的边界：
   *     ① **第一观测只记基线**（服务器重启后计数带着历史值，直接当"本轮新增"报出来就是冤枉人）；
   *     ② 老服务器根本没记这四行 ⇒ labeledCounter 返回 null ⇒ 一声不吭（"读不到"≠"读到 0"，坑 71/155）。 */
  {
    const base = prev.speakFunnel || (prev.speakFunnel = {});
    const dOf = (key) => {
      const v = labeledCounter('sfu_ai_speech_funnel_total', `kind="${key}"`);
      if (v === null) return null;
      const had = Object.prototype.hasOwnProperty.call(base, key);
      const d = had ? v - base[key] : null;      // null = 第一观测，不下结论
      base[key] = v;
      return d;
    };
    const dSilent = dOf('silent');
    const dDeclared = dOf('declared');
    const dDeliv = dOf('delivered');
    const dFail = dOf('failed');
    if (dSilent !== null && dSilent > 0) {
      out.push({ key: 'ai-speech-silent', text: `AI 播报有 ${dSilent} 轮**承诺了服务端语音却毫无下文**`
        + `（本轮承诺 ${dDeclared || 0}、送达 ${dDeliv || 0}、改浏览器念 ${dFail || 0}）`
        + ' —— 服务器已当场代发送话通知把声音救回来，但这说明**有一条播报路径漏了收口**：'
        + '查 ①新加的播报口有没有走 declare/settle 那对函数'
        + ' ②合成侧是否既不 resolve 也不 reject（sfu/ai/tts.js 的超时预算）③房间是否在承诺之后被销毁' });
    }
  }

  /* ⑦ ★ 2026-10-10（B1 / H2）RMS 行的**到达节奏**——把一条挂在路线图上三天的口头结论
   *   （"ametadata 打到管道上按 ~4KB 成块交付 ⇒ 第一行 RMS 约 5s 才到"）变成会自己喊的哨兵。
   *   ▸ 为什么值得常驻：静音判定（`silenceConfirmed`）与 ⏱ 延迟读数全挂在 `lastVoiceTs` 上，
   *     而它**只随 RMS 行更新**。所以"行到不到"不是观测细节，它决定了字幕是 1.5s 定稿
   *     还是 10s 保险丝定稿（= 用户嘴里的"字幕慢 / 三句话粘成一句"）。
   *   ▸ 三个数分开判，因为处方完全不同：
   *       首行慢 → 加冷启动宽限 / 查 ffmpeg 出生；
   *       空档大 → 查是不是**没 RTP 了**（成员静音、producer 关闭）而不是管道堵了；
   *       单次事件 ≥4KB → 才是"成块交付"这个假设本身（实测**正常突发**到过 2018B：流刚开始时一挤几十行，
 *     所以线画在 4KB——误报的告警等于没有告警，坑 67/82）。
   *   ▸ **老服务器没有这三行 ⇒ 一个都不报**（numOf 返回 null；"读不到"≠"读到 0"，坑 71）。
   *     而 `first_ms = -1` 是"这条管线还没收到任何 RMS 行"，不是"0ms 就到"——那是
   *     `Number('-1') || 默认值` 那一类会把负数当真的写法（坑 54），所以这里显式判 > 0。 */
  const FIRST_WARN = Math.max(500, Number(process.env.WATCH_RMS_PIPE_MS) || 1500);
  const GAP_WARN = Math.max(1000, Number(process.env.WATCH_RMS_GAP_MS) || 5000);
  const BLOCK_BYTES = Math.max(512, Number(process.env.WATCH_RMS_BLOCK_BYTES) || 4096);
  const rmsPipe = numOf('sfu_ai_asr_rms_after_first_byte_ms');
  const rmsGap = numOf('sfu_ai_asr_rms_gap_max_ms');
  const rmsBytes = numOf('sfu_ai_asr_rms_bytes_max');
  /* ▸ 为什么这条判的是 after_first_byte 而不是 first：`sfu_ai_asr_rms_first_ms` 是
   *   "本代进程出生 → 第一条 RMS 行"，里面**混着"这一代出生时恰好没人开口"**——
   *   实测同一套代码里 995ms（一出生就有人在说）与 20230ms（安静）都出现过。
   *   拿它做告警 = 每次安静的会都喊一次，而误报的告警等于没有告警（坑 67/82 同一条）。
   *   after_first_byte 的锚是"第一个非空分段落盘"，它成立的前提就是**音频已经进来了**。 */
  if (rmsPipe !== null && rmsPipe > FIRST_WARN) {
    out.push({ key: 'rms-first-slow', text: `音频已经落盘之后，第一条 RMS 行还过了 ${rmsPipe}ms 才到`
      + `（> ${FIRST_WARN}ms）——这段时间里"有没有人在说话"没有任何信源，定稿只能靠保险丝`
      + '，字幕延迟与 ⏱ 读数会一起变差。查：这台机器的 ffmpeg 构建是否带 direct=1、CPU 是否被别的进程占满' });
  }
  if (rmsGap !== null && rmsGap > GAP_WARN) {
    out.push({ key: 'rms-gap-stall', text: `RMS 行之间出现过 ${rmsGap}ms 的空档（> ${GAP_WARN}ms）`
      + '：静音判定与 ⏱ 读数都挂在这条线上，空档期内这句话会被 10s 保险丝切而非静音确认。'
      + '先分清两种病——**没人送 RTP**（成员静音 / producer 关闭，看有没有"静音退场"日志）'
      + '与**送来了但 metadata 没出来**（那才要动管道）' });
  }
  if (rmsBytes !== null && rmsBytes >= BLOCK_BYTES) {
    out.push({ key: 'rms-blocked', text: `stdout 单次事件最大 ${rmsBytes}B（≥ ${BLOCK_BYTES}B）`
      + ' ⇒ RMS 是**成块交付**的（H2 那条假设在这台机器上复现了）：行与行之间不再均匀，'
      + '静音判定会先卡后泄。处方是给 metadata 输出换 direct/无缓冲写法，不是调阈值' });
  }
  return out;
}

async function tick() {
  let snap;
  try {
    const res = await fetch(`${BASE}/api/rooms`, { headers: AUTH_HEADERS });
    /* ★ 09-24 G8：401 要单独判——否则会被当成"服务器挂了"连报三次假告警。
     *   这是门禁上线后最容易踩的坑：**"我没权限"和"服务不可用"是两件事**，
     *   混在一起会让人往完全错误的方向排查（去看进程，其实是没带 token）。 */
    if (res.status === 401) {
      alert('unauthorized', `接口返回 401：缺少或无效的管理员 token。`
        + (ADMIN_TOKEN ? '当前 ADMIN_TOKEN 已失效（重新登录取新的）。' : '请用 ADMIN_TOKEN=<token> npm run watch 启动。')
        + ' 取 token：会议页用管理员账号登录 → 控制台 JSON.parse(localStorage.wb_auth).token');
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    snap = await res.json();
    if (failing.api > 0) console.log(`[${ts()}] ✅ 服务器恢复（连续失败 ${failing.api} 轮后）`);
    failing.api = 0;
  } catch (err) {
    failing.api++;
    if (failing.api === 3) alert('server-down', `服务器连续 ${failing.api} 轮拉不到（${err.message}）——进程挂了？`);
    return;
  }

  // ② 媒体健康分
  for (const room of snap.rooms || []) {
    for (const m of room.media || []) {
      if (typeof m.score === 'number' && m.score < SCORE_MIN) {
        alert(`score-${m.producerId}`,
          `房间 ${room.roomNumber} 的 ${m.kind}(${m.source}) 健康分 ${m.score}（<${SCORE_MIN}，媒体质量差）`);
      }
    }
    // ③ 房间宽限期告急
    const ttl = room.ttlRemainingSec;
    if (typeof ttl === 'number' && ttl > 0 && ttl < 10 && room.counts.members === 0) {
      alert(`ttl-${room.roomNumber}`, `房间 ${room.roomNumber} 空房宽限仅剩 ${ttl}s，即将销毁回收`);
    }
  }

  // ④ 指标层面的进程内存（/metrics 是 G7-① 的成果，这里顺手消费）
  let metricsText = null;
  try {
    const res = await fetch(`${BASE}/metrics`, { headers: AUTH_HEADERS });
    if (res.status !== 401) { // 401 已在上面①处统一提示，这里不重复刷屏
      metricsText = await res.text();
      const rss = metricsText.match(/sfu_process_resident_memory_bytes (\d+)/);
      if (rss && Number(rss[1]) > MAX_RSS) {
        alert('rss', `服务器进程内存 ${(Number(rss[1]) / 1048576).toFixed(0)}MB 超过阈值 ${(MAX_RSS / 1048576).toFixed(0)}MB`);
      }
    }
  } catch (e) { /* metrics 拉不到单独不算告警（api 已覆盖） */ }

  /* ⑤ ★ 2026-10-07 H6：跨网能力退化。判据在服务器算（sfu/nets.js 的 diagnose()），
   *   这里只读结论——值守工具不该自己再写一份"能不能跨网"（坑 47：一个概念一个来源；
   *   两份判据迟早会给出两个答案，而半夜看到两个答案的人会两个都不信）。
   *   /config.json 是公开接口（不带 token 也要能读到，否则值守看不到这份判定）。 */
  try {
    const res = await fetch(`${BASE}/config.json`, { cache: 'no-store' });
    if (res.ok) {
      const cfg = await res.json();
      for (const a of diagnoseNetAccess(cfg && cfg.netCheck, netState, Date.now())) {
        alert(a.key, a.text);
      }
    }
  } catch (e) { /* 读不到 config.json 不报警：老服务器本来就没有这一项（"读不到"≠"坏了"） */ }

  /* ★ 09-30f 语音链路告警（P4）：AI 的"耳朵/嘴巴"悄悄坏掉是长跑值守最阴的故障——
   *   转写照常出文件但 worker 死了会退 CLI（字幕变慢 N 倍），没人会主动发现。
   *   这里用 /metrics 的两个 gauge 做状态翻转检测：
   *   · asr worker 0 → 连续 N 轮(默认 2，跳过预热期)才告警（启动加载期误报）；
   *   · tts 翻转（true↔false）→ 即时提醒（端点可达性随出口网络漂移，值得知道）。 */
  if (metricsText) {
    const gauge = (name) => {
      const m = metricsText.match(new RegExp(`${name} (\\d)`));
      return m ? Number(m[1]) : null;
    };
    const worker = gauge('sfu_ai_asr_worker_enabled');
    const tts = gauge('sfu_ai_tts_enabled');
    const n = Number(process.env.WATCH_ASR_WORKER_MISS) || 2;
    if (worker === 0) {
      voiceState.asrMiss += 1;
      if (voiceState.asrMiss === n) {
        alert('asr-worker', `ASR 常驻 worker 掉线（连续 ${voiceState.asrMiss} 轮）——已退回 CLI 逐段转写，字幕延迟变大约 3~5 倍（查 sfu/logs 是否 python 崩溃）`);
      }
    } else if (worker === 1) {
      if (voiceState.asrMiss >= n) alert('asr-worker-ok', 'ASR 常驻 worker 已恢复（转写速度回到常驻档）');
      voiceState.asrMiss = 0;
    }
    if (tts !== null && voiceState.tts !== null && tts !== voiceState.tts) {
      alert(`tts-${tts}`, tts
        ? '服务端神经语音（Edge TTS）变为可用——AI 语音已升级为服务器音色'
        : '服务端神经语音不可达——AI 语音已回落浏览器 TTS（本机音色）');
    }
    if (tts !== null) voiceState.tts = tts;
    /* ★ 2026-10-03 退化诊断（引擎退回兜底 / 白板归档被拒 / 房间动作没人执行）。
       判断逻辑在纯函数 diagnoseVoiceAndCollab 里，这里只负责把结果变成告警
       （限流由 alert() 的 key 去重做：同类 5 分钟内不刷屏）。 */
    for (const a of diagnoseVoiceAndCollab(metricsText, (snap && snap.collab) || null, voiceState.counters, voiceState)) {
      alert(a.key, a.text);
    }
  }
}

/* 被当模块 require 时只导出判断函数、**不打日志也不开循环**——
   这样退化诊断可以被合成输入穷举断言。
   ▎为什么非要能 require：这段逻辑跑在**长跑值守**里，判断错了的代价是要么天天误报、
   要么永远不报，两种都会让人放弃看告警；而没有别的办法验证「判断错了」这件事本身。 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { diagnoseVoiceAndCollab, diagnoseNetAccess, NET_RANK };
}
if (require.main === module) {
  console.log(`👀 watch 启动：每 ${INTERVAL / 1000}s 轮询 ${BASE}` +
    (WEBHOOK ? '，webhook 已配置' : '，webhook 未配置（设 WATCH_WEBHOOK_URL 启用）') +
    '。告警规则：服务拉不到 / 健康分<' + SCORE_MIN + ' / 宽限期<10s / rss 超限 / ASR worker 掉线 / ' +
    '神经语音翻转 / 主引擎退回兜底 / 白板归档被拒 / 房间动作无人执行。Ctrl+C 退出。');
  if (!ADMIN_TOKEN) {
    console.log('⚠️  未设置 ADMIN_TOKEN —— /api/rooms 与 /metrics 现在需要管理员身份，会一直 401。');
    console.log('   用法：ADMIN_TOKEN=<token> npm run watch');
    console.log('   取 token：会议页用管理员账号登录 → 控制台 JSON.parse(localStorage.wb_auth).token');
  }
  tick();
  setInterval(tick, INTERVAL);
}
