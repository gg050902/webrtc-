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
const voiceState = { asrMiss: 0, tts: null, counters: {}, fallbackRounds: 0, gapRounds: 0, capSlowRounds: 0 }; // ★ 09-30f：语音链路翻转诊断的上一轮状态；counters = 计数基准；*Rounds = 各条"连续两轮才算"的退化判据
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
  const counterOf = (key) => {
    const m = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' (\\d+)').exec(metricsText);
    return m ? Number(m[1]) : 0;
  };
  const delta = (key) => { const v = counterOf(key); const d = v - (prev[key] || 0); prev[key] = v; return d; };
  const labelsOf = (base) => [...new Set(
    (metricsText.match(new RegExp(base + '\\{[^}]+\\}', 'g')) || [])
      .map((s) => /="([^"]*)"/.exec(s)).filter(Boolean).map((m) => m[1]),
  )];
  /* 带 label 的 gauge 取值（kind="avg" 这一类）：counterOf 的 `key 数字` 形态匹配不到它们。 */
  const gaugeOf = (base, kind) => {
    const m = new RegExp(base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      + '\\{kind="' + kind + '"\\} (\\d+)').exec(metricsText);
    return m ? Number(m[1]) : 0;
  };
  /* 布尔开关取值：**区分"这行不存在"与"这行是 0"**。
   * ▎反例就是这条规则自己：若把"老服务器没有 primary_ready 这一行"当成 0（=没就位），
   *   兜底告警就会在老服务器上**永远不响**——那正是我们一路在防的"静默失效"。 */
  const flagOf = (key) => {
    const m = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' (\\d+)').exec(metricsText);
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
  /* ④ ★ 2026-10-03 字幕延迟变差：avg 超阈值且**样本够**才判。
   *    ▎为什么门槛里要写 n>=3：只出过 1~2 句字幕时，均值会被一句长句完全带跑，
   *      那是统计噪声不是链路退化（同坑 53 的判据——样本太小就不要拿比例/均值下结论）。
   *    ▎为什么还要连续 2 轮：一次网络抖动或模型冷启动会抬一轮，报出来只会让人学会忽略告警。
   *    ▸ 阈值可用 WATCH_CAP_LAT_WARN_MS 调；默认 6000ms ≈ "静音判定 + 分段 + 转写"叠满的实测上沿。 */
  const capN = counterOf('sfu_ai_asr_caption_count_total');   // 无 label 的 counter，走 counterOf
  const capAvg = gaugeOf('sfu_ai_asr_caption_latency_ms', 'avg');
  const capWarnMs = Number(process.env.WATCH_CAP_LAT_WARN_MS) || 6000;
  if (capN >= 3 && capAvg > capWarnMs) {
    state.capSlowRounds = (state.capSlowRounds || 0) + 1;
    if (state.capSlowRounds === 2) {
      out.push({ key: 'caption-slow', text: `字幕延迟均值 ${(capAvg / 1000).toFixed(1)}s（最慢 ${(gaugeOf('sfu_ai_asr_caption_latency_ms', 'max') / 1000).toFixed(1)}s，样本 ${capN} 句），超过 ${capWarnMs / 1000}s 阈值`
        + ` —— 查：①引擎是否退回兜底（看上面 asr-engine-fallback）②asrSegmentSec 是否被配大 ③CPU 是否被本地模型占满` });
    }
  } else {
    if ((state.capSlowRounds || 0) >= 2) out.push({ key: 'caption-ok', text: `字幕延迟恢复正常（均值 ${(capAvg / 1000).toFixed(1)}s）` });
    state.capSlowRounds = 0;
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
  module.exports = { diagnoseVoiceAndCollab };
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
