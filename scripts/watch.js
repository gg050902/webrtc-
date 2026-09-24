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
  try {
    const res = await fetch(`${BASE}/metrics`, { headers: AUTH_HEADERS });
    if (res.status !== 401) { // 401 已在上面①处统一提示，这里不重复刷屏
      const met = await res.text();
      const rss = met.match(/sfu_process_resident_memory_bytes (\d+)/);
      if (rss && Number(rss[1]) > MAX_RSS) {
        alert('rss', `服务器进程内存 ${(Number(rss[1]) / 1048576).toFixed(0)}MB 超过阈值 ${(MAX_RSS / 1048576).toFixed(0)}MB`);
      }
    }
  } catch (e) { /* metrics 拉不到单独不算告警（api 已覆盖） */ }
}

console.log(`👀 watch 启动：每 ${INTERVAL / 1000}s 轮询 ${BASE}` +
  (WEBHOOK ? '，webhook 已配置' : '，webhook 未配置（设 WATCH_WEBHOOK_URL 启用）') +
  '。告警规则：服务拉不到 / 健康分<' + SCORE_MIN + ' / 宽限期<10s / rss 超限。Ctrl+C 退出。');
if (!ADMIN_TOKEN) {
  console.log('⚠️  未设置 ADMIN_TOKEN —— /api/rooms 与 /metrics 现在需要管理员身份，会一直 401。');
  console.log('   用法：ADMIN_TOKEN=<token> npm run watch');
  console.log('   取 token：会议页用管理员账号登录 → 控制台 JSON.parse(localStorage.wb_auth).token');
}
tick();
setInterval(tick, INTERVAL);
