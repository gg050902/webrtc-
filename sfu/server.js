/* ════════════════════════════════════════════════════════════════
 * sfu/server.js —— SFU 版信令 + 媒体服务器（基于 mediasoup）
 *
 * ▎这个文件到底在干什么？（先看这一段，心里有个地图）
 *
 * 这是 Mesh 版的"架构升级版"（对照根目录 server.js 阅读）：
 *
 *   Mesh 版：浏览器之间直接 P2P 连，服务器只当"信令邮局"
 *   SFU 版 ：浏览器只连服务器，服务器用 mediasoup 把每一路媒体
 *            **选择性转发**给房间里其他所有人（腾讯会议同款架构）
 *
 * 因此这个文件比 Mesh 版多了一大块职责：
 *   ① 启动一个 mediasoup Worker（真正的媒体转发内核）
 *   ② 每个会议房间 = 一个 Router（媒体"独立房间"，互相隔离）
 *   ③ 每个参会者 = 两条 WebRtcTransport（一条发 send、一条收 recv）
 *      自己发言 = 在这条通道上 produce（变成 Producer）
 *      听别人  = 订阅对方的 Producer（变成 Consumer）
 *
 * ▎为什么 media 不走"offer/answer 互发"了？
 *   Mesh 是浏览器对浏览器协商，所以需要 offer/answer/ICE 互传；
 *   SFU 是浏览器对服务器协商，所以事件变成一套新的"请求-应答"：
 *     要能力 → get-router-rtp-capabilities
 *     要通道 → create-webrtc-transport
 *     通道握手 → transport-connect
 *     上传   → produce（服务器建 Producer，广播给其他人）
 *     订阅   → consume（服务器建 Consumer，把对方媒体发给我）
 *   协议总表见 sfu/protocol.js，动手改事件前先看它。
 *
 * ▎代码分区（和根 server.js 一样的习惯，一段一段读）：
 *   第 A 部分：HTTP 托管 sfu/public 静态页面
 *   第 B 部分：mediasoup 初始化（Worker + 房间 Router + 媒体参数）
 *   第 C 部分：房间管理（6 位房间号 + 密码，从 Mesh 版复制改造）
 *   第 D 部分：信令事件（房间进出 + 媒体协商，SFU 版核心）
 *   第 E 部分：启动
 * ════════════════════════════════════════════════════════════════ */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const mediasoup = require('mediasoup');
// ★ 09-24 AI Provider：所有 LLM 调用的唯一入口（密钥托管 + 双轨降级 + 用量记账）
const AI = require('./ai/provider');
/* ★ 09-24e AI 智能内核：检索（RAG）+ 会话记忆 + 意图分类 + 行动项结构化
 * ▎为什么单独一个模块：让 Assistant 从"只喂最近 8 条字幕的关键词模板"升级为
 *   "全档检索 + 多轮记忆 + 真意图理解"。改造前的具体缺陷与修法见 brain.js 文件头。 */
const Brain = require('./ai/brain');
/* ★ 09-25 AI 实时会议看板（Live Digest）：让助理从"被问才答"变为"边听边消化"。
 *   字幕持续流入 → 实时抽成「决定 / 风险 / 行动项 / 议题」四类 → 汇成一块看板广播给全房。
 *   与 brain.js 的分工：brain = 按需检索+归纳（深但不实时）；digest = 持续抽取+原样呈现
 *   （实时但不归纳）。两者互补，详见 digest.js 文件头。 */
const Digest = require('./ai/digest');
/* ★ 09-24 账号存储层：node:sqlite（零新依赖的真数据库）
 * ▎从"整文件 JSON 读写"换成 SQLite 的原因见 sfu/store.js 文件头。
 * ▎require 即完成：建库建表 + PRAGMA WAL + 旧 users.json 自动迁移（都在 store.js 里）。 */
const store = require('./store');

/* ★ 09-13 可达性升级（对应路线图 E1/E2 的"自助版"）：配置文件 config.json
 * ▎硬边界是什么？这套系统之前只能"同机/同局域网"玩：
 *   · 页面是 http://localhost —— getUserMedia 要安全上下文，跨机访问直接被浏览器拒；
 *   · 媒体监听 127.0.0.1，别的机器根本连不进来；
 *   · 想穿 NAT（跨家庭/公司网络）需要 TURN，而 ICE 服务器之前是写死的。
 * ▎解法（零新依赖，把"口子"全部打开）：
 *   ① sfu/config.json（可选，没有就用默认值）统一管：端口 / 人数 / 监听 IP /
 *     announcedIp / RTC 端口段 / ICE 服务器（STUN/TURN）；
 *   ② https.enabled = true 时自动起 HTTPS（证书缺失且有 openssl 时自动自签），
 *     页面走 https/wss，跨机访问不再要浏览器豁免；
 *   ③ ICE 服务器通过 /config.json 下发给浏览器（createTransport 时带上），
 *     换 TURN 只改配置文件，一行代码不动。
 * ▎完整部署步骤见 README「跨网络部署」一节。
 */
let CONFIG = {};
try {
  CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  console.log('📄 已加载 sfu/config.json');
} catch (e) { /* 没有配置文件 = 全用默认值（本机演示模式） */ }

const PORT = Number(process.env.PORT) || Number(CONFIG.port) || 3001; // ★ SFU 版单独端口，避免和 Mesh 版(3000)打架
// SFU 后人数不再受"每人连所有人"的带宽墙限制，改成受"服务器带宽"限制。
// 演示机开 8 人足够；云服务器人多时按实际带宽再调小/大。
const MAX_MEMBERS = Number(CONFIG.maxMembers) || 8;

/* ★ D+4 升级（2026-09-14）：空房宽限期（房间 TTL）
 * ▎问题：之前"最后一个人离开/掉线"→ 房间立刻销毁、号码回收 → 掉线者重连时
 *   收到 room-not-found（D6 断线重连的已知边界：房间里只剩自己时重连不回来）。
 * ▎解法：人走光后房间**保留 TTL 宽限期**（默认 60s，可用环境变量 ROOM_TTL_MS
 *   或 config.json 的 roomTtlSec 调整），Router 不关、号码不回收——
 *   宽限期内原号可重新加入（掉线重连、出去倒杯水都涵盖）。到期才真正销毁。
 */
const ROOM_TTL_MS =
  Number(process.env.ROOM_TTL_MS) ||
  (Number(CONFIG.roomTtlSec) ? Number(CONFIG.roomTtlSec) * 1000 : 0) ||
  60000;

/* ──────────────────────────────────────────────────────────────
 * 第 A 部分：HTTP 服务器 —— 托管 sfu/public 目录的静态文件
 * （和根 server.js 的 A 段几乎一样，只是换了个目录）
 * ────────────────────────────────────────────────────────────── */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  // ★ G4 移动端/PWA（第 32 步）：manifest 与图标的正确 MIME——
  //   manifest 用 .webmanifest 扩展名（避开 /config.json 特殊路由），图标给 image/png
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

/* ★ 09-24 G8-①：HTTP 层管理员门禁
 * ▎要解决什么：/api/rooms、/metrics 这些接口此前**完全裸奔**——
 *   任何人都能看到"哪个房间里有谁、每路媒体跑了多少字节、谁在远程控制谁"。
 *   演示时没人管，但只要服务挂在公网上，这就是一份免费的情报面板。
 *
 * ▎★ 门禁边界（本节是复审后的最终版，答辩会被问，先讲清楚"为什么不是全加"）：
 *   本服务把 HTTP 接口分**两类**，只有第一类上 admin 门禁——
 *
 *   【甲类·观测】跨房间聚合 / 实时全景。知道它 = 掌握全局，且与"是否参会"无关。
 *     /api/rooms     房间×成员×媒体字节×控制权关系  → requireAdmin
 *     /metrics       上面那堆的 Prometheus 文本版    → requireAdmin
 *     /api/recordings 全服务器录像清单（跨房枚举）    → requireAdmin
 *
 *   【乙类·内容】单场会议的产物，**能力 = 房间内令牌 / 短时效签名 URL**
 *     （★ 09-24 C4 本轮补齐：见下面 requireRoomAccess 与 signRecordingUrl）：
 *     /api/captions  字幕归档——client.js 自动 POST，游客也在用 → requireRoomAccess
 *     /api/minutes、/minutes/<房>/<文件>  纪要列表与正文      → requireRoomAccess
 *     /recordings/<文件名>  单个录像文件                      → admin 或签名 URL
 *   ▎核心理由一句话：**本产品允许游客进会**（登录卡有「游客进入」）。给乙类加 admin
 *     门禁 = 游客的字幕归档静默失效，功能坏了还不报错——这比"少一层鉴权"更糟。
 *     所以门禁不靠"登录"，靠**进房时给每个成员（含游客）发一张房间内令牌**。
 *   ▎回填历史缺口（为什么本轮要做）：C4 之前乙类只靠"能力 = 6 位房间号"，
 *     而房间号空间只有 10^6、可被暴力枚举，属**弱能力**——知道房号就能读别人的会议记录。
 *     本轮补上房间内令牌（无状态 HMAC）+ 录像签名 URL，把"知道房号"与"能读内容"解耦。
 *   ▎诚实边界（不吹成完美方案）：房间令牌是 **Bearer 语义**（拿到即用，不绑定成员身份/IP）、
 *     TTL 默认 24h；换掉 SECRET 会让所有已签发令牌立即失效。详见 requireRoomAccess 注释。
 *
 * ▎token 从哪取（两种都支持，各有各的场景）：
 *   ① Authorization: Bearer <token> —— 首选。脚本 / Prometheus / curl 的标准姿势。
 *   ② ?token=<token>              —— 兜底。浏览器直接打开 /metrics、/recordings/x.webm
 *      这类"地址栏/资源标签"场景发不出自定义头（<video src> 也发不出）。
 *      ▎权衡（必须讲清）：查询串会进浏览器历史、服务器访问日志、Referer——
 *      所以它只是兜底，能发头就发头。真产品应该用短时效的"下载票据"换掉它。
 * ▎返回值：{ ok: true, username } 或 { ok: false }（后者已把 401 写回响应）。
 *   调用方一律写成 `if (!requireAdmin(req, res).ok) return;`——门禁是"写响应 + 返回状态"，
 *   比"返回布尔让调用方自己写 401"更难漏。 */
function extractAuthToken(req) {
  const auth = req.headers && req.headers['authorization'];
  if (typeof auth === 'string') {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1].trim();
  }
  try {
    const t = new URL(req.url, 'http://localhost').searchParams.get('token');
    return t || null;
  } catch (e) { return null; }
}
function adminGateHtml(reason) {
  // 401 页面给人看，所以是 HTML 而不是 JSON（浏览器直接打开 /metrics 时能看懂）
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>401 需要管理员身份</title></head>
<body style="font-family:system-ui,'Microsoft YaHei',sans-serif;background:#14100a;color:#ece5d8;padding:40px;line-height:1.7">
  <h1>🔒 401 需要管理员身份</h1>
  <p>${reason || '这个接口只对管理员开放。'}</p>
  <p>带 token 的两种方式：</p>
  <ul>
    <li><code>Authorization: Bearer &lt;token&gt;</code>（脚本 / Prometheus 抓取首选）</li>
    <li><code>?token=&lt;token&gt;</code>（浏览器直接打开时的兜底，URL 会进历史/日志，尽量少用）</li>
  </ul>
  <p>token 从哪来：在会议页用管理员账号登录后，浏览器控制台执行
     <code>JSON.parse(localStorage.wb_auth).token</code> 即可取到；</p>
  <p>账号还不是管理员？让管理员执行 <code>npm run admin:grant -- &lt;用户名&gt;</code>。</p>
  <p><a href="/" style="color:#d8b36a">← 回会议页登录</a> ·
     <a href="/dashboard" style="color:#d8b36a">观测面板</a></p>
</body></html>`;
}
function requireAdmin(req, res) {
  const v = verifyToken(extractAuthToken(req));
  if (!v || v.role !== 'admin') {
    res.writeHead(401, {
      'Content-Type': 'text/html; charset=utf-8',
      'WWW-Authenticate': 'Bearer realm="sfu-admin"',
      'Cache-Control': 'no-store',
    });
    res.end(adminGateHtml(v ? '当前账号不是管理员（role=' + v.role + '）。' : '缺少或无效的管理员 token。'));
    return { ok: false };
  }
  return { ok: true, username: v.username };
}

/* ★ 09-24 C4（本轮）：房间内令牌门禁 —— requireRoomAccess（与上面 requireAdmin 并列的第二种门禁）
 *
 * ▎要解决什么（上一轮复审留下的缺口）：/api/captions、/api/minutes、/minutes/* 这些
 *   "会议内容"接口此前只靠"能力 = 6 位房间号"，而房间号空间只有 10^6、可被暴力枚举——
 *   知道房号就能读别人的字幕/纪要，属**弱能力**。本轮给它补一张"进房时才发的令牌"。
 *
 * ▎为什么是"房间内令牌"而不是"要求登录"？（这是上一轮踩过的坑，绝不能违反）
 *   本产品**允许游客进会**（登录卡上的「游客进入」按钮，client.js 的 authGuestBtn），
 *   游客没有登录 token；而 /api/captions 是浏览器端 client.js **自动**调用的
 *   （capSentryFlush POST 归档、导出/日报 GET 回读）。所以令牌必须在**进房那一刻
 *   发给每一个成员（含游客）**，否则游客的字幕归档会静默失效——功能坏了却不报错。
 *
 * ▎放行条件（满足其一即可）：
 *   ① 带**管理员 token**（requireAdmin 那套，Authorization: Bearer 或 ?token=）——
 *      admin 不受房间限制，跨房巡检/排障都要它；
 *   ② 带**有效的房间内令牌**，且该令牌的 room 与请求的房间号一致（跨房必须 401）。
 * ▎令牌两种取法（与现有 admin token 风格保持一致）：
 *   · X-Room-Token: <token>  请求头（首选，干净、不进 URL 历史/日志）
 *   · ?roomToken=<token>     查询串兜底——因为 <a href="/minutes/..."> 这类"导航链接"
 *     发不出自定义请求头（AI 气泡里「📄 打开纪要」就是这种链接，只能走查询串）。
 *
 * ▎返回值：{ ok: true, via } 或 { ok: false }（后者已把 401 写回响应），
 *   调用方一律写成 `if (!requireRoomAccess(req, res, 房间号).ok) return;`——
 *   与 requireAdmin 同一约定："门禁 = 写响应 + 返回状态"，比"返回布尔让调用方自己写 401"更难漏。
 *
 * ▎诚实边界（答辩会被问，先讲清楚）：
 *   · 房间令牌是 **Bearer 语义**：拿到令牌的任何人都能用，不绑定成员身份/IP（教学取舍）；
 *   · TTL 默认 24h，期间一直有效（无状态令牌无法单独吊销，只能等过期或轮换 SECRET）；
 *   · SECRET 轮换 = 所有已签发令牌立即失效（对过夜值守的归档是"要重新进房拿新令牌"）。
 *   这些都能写成"更进一步"的扩展点，但本教学版如实停在这里，不假装是终端方案。
 */
function extractRoomToken(req) {
  // ① 请求头（首选）：Node 把请求头名一律小写，这里两种写法都兜一下，避免踩大小写坑
  const h = req.headers && (req.headers['x-room-token'] || req.headers['X-Room-Token']);
  if (typeof h === 'string' && h.trim()) return h.trim();
  // ② 查询串兜底（导航链接用）
  try {
    const t = new URL(req.url, 'http://localhost').searchParams.get('roomToken');
    return t || null;
  } catch (e) { return null; }
}
function roomGateHtml(reason) {
  // 401 页面给人看，所以是 HTML 而不是 JSON（浏览器直接打开 /minutes/... 时能看懂）
  // 风格照抄上面 adminGateHtml——两种门禁的 401 长得一致，用户不会以为是两个系统。
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>401 需要房间内令牌</title></head>
<body style="font-family:system-ui,'Microsoft YaHei',sans-serif;background:#14100a;color:#ece5d8;padding:40px;line-height:1.7">
  <h1>🔑 401 需要房间内令牌</h1>
  <p>${reason || '这是会议内容接口，需要房间内令牌。'}</p>
  <p>房间内令牌在你**进入房间时自动获取**（每场会一张，只对本房间有效，游客也有）——
     请回到会议页重新进入房间，再点这个链接。</p>
  <p>带令牌的两种方式：</p>
  <ul>
    <li><code>X-Room-Token: &lt;roomToken&gt;</code>（脚本 / fetch 首选）</li>
    <li><code>?roomToken=&lt;roomToken&gt;</code>（浏览器直接打开 / 导航链接的兜底，URL 会进历史，尽量少用）</li>
  </ul>
  <p>管理员不受房间限制：改用管理员 token（<code>Authorization: Bearer</code> 或 <code>?token=</code>）即可跨房访问。</p>
  <p><a href="/" style="color:#d8b36a">← 回会议页登录/进会</a></p>
</body></html>`;
}
function recordingGateHtml() {
  // 录像门禁的 401 页面：管理员可以直接带 token；非管理员需要"签名 URL"（录制停止时前端会给）
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>401 需要管理员或签名链接</title></head>
<body style="font-family:system-ui,'Microsoft YaHei',sans-serif;background:#14100a;color:#ece5d8;padding:40px;line-height:1.7">
  <h1>🎬 401 录制文件需要管理员或签名链接</h1>
  <p>服务器上的录制文件不再"知道文件名就能下"，需要**短时效签名链接**（录制停止时自动给出，默认 1 小时有效）。</p>
  <p>带令牌的两种方式：</p>
  <ul>
    <li>管理员：<code>Authorization: Bearer &lt;admin token&gt;</code> 或 <code>?token=&lt;admin token&gt;</code></li>
    <li>录制者：用录制结束时拿到的签名链接（形如 <code>/recordings/xxx.webm?exp=…&amp;sig=…</code>）</li>
  </ul>
  <p>签名过了但文件不存在会返回 404（两者是两件事：401 = 没权限，404 = 文件不在）。</p>
  <p><a href="/recordings" style="color:#d8b36a">← 回录像列表（需管理员）</a></p>
</body></html>`;
}
function requireRoomAccess(req, res, room) {
  // ★ 逃逸开关（教学/调试）：roomTokenRequired === false → 退回"开放"旧行为。
  //   用途：本地调试接口、或做"关掉门禁前后对比"的教学演示。默认 true（安全默认值）。
  if (CONFIG.roomTokenRequired === false) return { ok: true, via: 'disabled' };
  // ① 管理员 token：不受房间限制（跨房巡检/排障）。走与 requireAdmin 完全相同的取法。
  const v = verifyToken(extractAuthToken(req));
  if (v && v.role === 'admin') return { ok: true, via: 'admin', username: v.username };
  // ② 房间内令牌：签名有效、未过期、且**房间号一致**（令牌只对签发它的房间有效）。
  //    room 为空/不是 6 位也没关系：verifyRoomToken 里 String(room) 比对自然不通过。
  if (verifyRoomToken(extractRoomToken(req), room)) return { ok: true, via: 'room' };
  res.writeHead(401, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(roomGateHtml(v ? '当前账号不是管理员（role=' + v.role + '），且未提供本房间的令牌。' : '缺少或无效的房间内令牌。'));
  return { ok: false };
}

/* 请求处理器（命名函数）：HTTP 和 HTTPS 两个服务器共用同一份逻辑 */
async function requestHandler(req, res) {
  // ★ 坑 15（Mesh 版当年踩过，SFU 复制时漏带了）：req.url 会带 "?room=xxx" 查询串，
  //   直接当文件路径去找会 404——邀请链接（/?room=6 位号）就全挂了。
  //   new URL(相对路径, 基准).pathname = 剥掉 query 后的纯路径。
  const pathname = new URL(req.url, 'http://localhost').pathname;

  /* ★ 09-13 观测面板 API：GET /api/rooms —— 房间/成员/媒体的全景快照（JSON）
   * ▎这是什么？给 /dashboard 面板页（和任何监控工具）吃的实时数据接口。
   *   之前 SFU 的运行状态只能靠 console.log"隔着墙听"，现在有了一个官方窗口：
   *   服务器自己把它知道的每件事（谁在房里、每路媒体的字节计数/健康分、发言时长）
   *   摆出来——这就是"可观测性"，真实产品的运维面板就是这条思路。
   * ▎字节计数是**累计值**，面板页负责两次采样相减算出实时码率（画成曲线）。
   */
  if (pathname === '/api/rooms') {
    // ★ 09-24 G8：管理员门禁（能看到全房成员/媒体字节/控制权关系，属敏感信息）
    if (!requireAdmin(req, res).ok) return;
    handleApiRooms(res);
    return;
  }

  // ★ 09-17e 值守归档（C3-N1）：字幕账本的服务器权威副本——POST=追加，GET=回读全档
  if (pathname === '/api/captions') {
    /* ★ 09-24 G8 复审修订 + ★ 09-24 C4 本轮补齐：这里**不加 admin 门禁**，改加**房间内令牌门禁** ——
     *   它属"会议内容"类，不是"观测"类。
     * ▎为什么不能加 requireAdmin：本接口由浏览器端 client.js **自动**调用（内存溢出时归档 POST、
     *   导出/日报回读 GET），而本产品**允许游客模式进会**（登录卡上的「游客进入」，authGuestBtn），
     *   游客根本没有登录 token。若加 requireAdmin，字幕归档会对所有非管理员**静默失效**。
     * ▎那靠什么保护：**房间内令牌**——进房成功时发给每个成员（含游客）一张只对本房间有效的
     *   HMAC 签名令牌。GET 走查询串的 room，POST 的 room 在 body 里（读出来后再判，见 handleApiCaptions）。
     * ▎诚实边界：令牌是 Bearer 语义、TTL 24h，SECRET 轮换会让所有已签发令牌失效。 */
    if (req.method === 'POST') {
      // POST 的房间号在 JSON body 里，门禁放到 handleApiCaptions 读完 body 之后判（见那里）
      handleApiCaptions(req, res);
    } else {
      const q = new URL(req.url, 'http://localhost').searchParams;
      const room = String(q.get('room') || '');
      if (!requireRoomAccess(req, res, room).ok) return;
      handleCaptionRead(res, room, q.get('format') || 'txt');
    }
    return;
  }

  // ★ 09-18 G7 可观测性：Prometheus 文本格式的指标端点（/dashboard 的"机器读"版）
  if (pathname === '/metrics') {
    if (!requireAdmin(req, res).ok) return;
    handleApiMetrics(res);
    return;
  }

  // ★ 09-19c G3 录制回放：录制产物列表（recordings.html 吃它；只报可播的 .webm/.mkv）
  if (pathname === '/api/recordings') {
    if (!requireAdmin(req, res).ok) return;
    try {
      const dir = path.join(__dirname, 'recordings');
      const list = fs.existsSync(dir)
        ? fs.readdirSync(dir)
            .filter((f) => f.endsWith('.webm') || f.endsWith('.mkv'))
            .map((f) => {
              const st = fs.statSync(path.join(dir, f));
              return { name: f, size: st.size, mtime: st.mtimeMs };
            })
            .sort((a, b) => b.mtime - a.mtime)
        : [];
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(list));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ★ 09-19c N2：纪要列表 + 纪要下载（房间号 6 位白名单 + 文件名白名单，路径穿越进不来）
  if (pathname === '/api/minutes') {
    // ★ 09-24 G8 复审修订 + ★ 09-24 C4：归"会议内容"类 → **房间内令牌**门禁（理由同 /api/captions）
    const q = new URL(req.url, 'http://localhost').searchParams;
    const room = String(q.get('room') || '');
    if (!requireRoomAccess(req, res, room).ok) return;
    if (!/^\d{6}$/.test(room)) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('房间号必须是 6 位数字');
      return;
    }
    const dir = path.join(MINUTES_DIR, room);
    const list = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => {
          const st = fs.statSync(path.join(dir, f));
          return { name: f, size: st.size, mtime: st.mtimeMs };
        }).sort((a, b) => b.mtime - a.mtime)
      : [];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(list));
    return;
  }
  if (pathname.startsWith('/minutes/')) {
    // ★ 09-24 G8 复审修订 + ★ 09-24 C4：纪要正文 = 会议内容类 → **房间内令牌**门禁。
    //   这是 AI 助理气泡里「📄 打开纪要」的落点——普通参会者和游客都要能点开（client.js 会给
    //   href 补 ?roomToken=，因为导航链接发不出自定义请求头）。
    // /minutes/<6位房间>/<文件名>.md —— 两段白名单钳住路径穿越（门禁在前，白名单在后）
    const parts = pathname.split('/').filter(Boolean); // ['minutes', room, file]
    const room = parts[1] || '';
    const file = parts[2] || '';
    if (!requireRoomAccess(req, res, room).ok) return;
    if (!/^\d{6}$/.test(room) || !/^\w[\w.-]*\.md$/.test(file) || file.includes('..')) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return;
    }
    const fp = path.join(MINUTES_DIR, room, file);
    if (fs.existsSync(fp)) {
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(fp, 'utf8'));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('纪要不存在');
    }
    return;
  }

  // ★ 09-13 可达性：把 ICE 服务器配置下发给浏览器（客户端 fetch 后建 Transport 用）
  if (pathname === '/config.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      iceServers: Array.isArray(CONFIG.iceServers) ? CONFIG.iceServers : [],
      videoSvc: !!CONFIG.videoSvc, // ★ D+3：VP9 SVC 开关（true = 摄像头改用单路 SVC 上传）
      authTtlMs: AUTH_TTL_MS, // ★ G6：token TTL（回归用它开短 TTL 实测过期路径）
      // ★ 09-16 局域网交付：announcedIp 存在时，告诉前端"发给别的电脑的邀请链接长什么样"——
      //   服务器机自己访问的是 localhost，直接复制 location.href 别的电脑打不开
      lanUrl: ANNOUNCED_IP ? `https://${ANNOUNCED_IP}:${(tlsCfg.port || 3443)}` : null,
      // ★ 09-24 AI 模式：**只下发布尔值**——前端据此显示「LLM / Mock」状态灯。
      //   密钥本身绝不下发（连末四位都不给）：浏览器是公开可下载的资源，任何回显都是泄露。
      aiEnabled: AI.aiEnabled(),
      // ★ 09-24 真远程桌面：告诉前端"本服务器支持桌面代理（agent/index.js）"。
      //   前端据此决定要不要显示「🖥️ 控制电脑」按钮和 agent 相关指引。
      remoteDesktop: true,
      // 代理启动命令模板：前端把它显示在页面上，用户复制到终端就能起代理（省得记参数）
      agentCommand: `node agent/index.js --room ${'{房间号}'}`,
    }));
    return;
  }

  // ★ D+2：录制产物下载（只允许纯文件名，path.basename 天然防路径穿越）
  if (pathname.startsWith('/recordings/')) {
    /* ★ 09-24 C4 本轮修订：单个录制文件 = 内容类，改 **admin 或短时效签名 URL** 才放行。
     * ▎为什么不再是"能力 = 文件名"：文件名形如 rec-<6位房号>-<毫秒时间戳>.webm，
     *   房号只有 6 位可枚举、时间戳可估——等于没门（弱能力）。改成签名 URL 后，
     *   链接自带过期时间（signRecordingUrl 默认 1 小时），泄露也只在一个窗口内。
     * ▎401 与 404 必须分清：**签名/管理员不过 → 401**；**通过了但文件不存在 → 404**
     *   （后者是业务判断，不是权限问题——把两者混成一句会让"链接过期"和"文件被删"无法区分）。
     * ▎admin 仍直接放行（巡检/排障不受限）；roomTokenRequired===false 时退回旧行为（开放）。
     * ▎path.basename 仍保留——它防的是路径穿越，与门禁是两件事，不能因为开放就撤掉。
     *   签名 URL 里文件名是 encodeURIComponent 过的，所以先 decode 再 basename（basename 在 decode 之后，
     *   顺序不能反：先 basename 再 decode 会让 %2F 解出斜杠、绕过单段限制）。 */
    let fileName;
    try { fileName = path.basename(decodeURIComponent(pathname)); }
    catch (e) { fileName = path.basename(pathname); } // 畸形转义：退化为按原样取 basename
    if (CONFIG.roomTokenRequired !== false) {
      const v = verifyToken(extractAuthToken(req));
      const isAdmin = !!(v && v.role === 'admin');
      const q = new URL(req.url, 'http://localhost').searchParams;
      const sigOk = verifyRecordingSig(fileName, q.get('exp'), q.get('sig'));
      if (!isAdmin && !sigOk) {
        res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(recordingGateHtml());
        return;
      }
    }
    const filePath = path.join(__dirname, 'recordings', fileName);
    if (fs.existsSync(filePath)) {
      res.writeHead(200, {
        'Content-Type': fileName.endsWith('.mkv') ? 'video/x-matroska' : 'video/webm',
      });
      res.end(fs.readFileSync(filePath)); // 教学版整读；生产应改流式/对象存储
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('录制文件不存在（可能仍在录制或已被清理）');
    }
    return;
  }

  const urlPath = pathname === '/' ? '/index.html'
    : pathname === '/dashboard' ? '/dashboard.html' // 观测面板的短地址
    : pathname;
  const filePath = path.normalize(path.join(__dirname, 'public', urlPath));
  // ★ 安全钳制：解析后的真实路径必须还在 public 目录里，
  //   否则 /../server.js 这种路径能读到目录外的任意文件（路径穿越）
  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath);
    // ★ 静态资源禁缓存（排版实修）：页面样式迭代频繁，启发式缓存会让浏览器吃旧 CSS——
    //   "改了样式不生效"比慢加载可怕得多（演示项目无带宽压力，no-store 一劳永逸）
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

const httpServer = http.createServer(requestHandler);

/* ★ D+2：把一路 Consumer 翻译成 SDP 的一个 m-line（ffmpeg 的收流说明书）*/
function sdpMediaSection(consumer, kind, port) {
  const codec = consumer.rtpParameters.codecs[0];
  const pt = codec.payloadType;
  const name = codec.mimeType.split('/')[1];
  const lines = [
    `m=${kind} ${port} RTP/AVP ${pt}`,
    'c=IN IP4 127.0.0.1',
    `a=rtpmap:${pt} ${name}/${codec.clockRate}${kind === 'audio' ? '/' + (codec.channels || 2) : ''}`,
  ];
  if (codec.parameters && Object.keys(codec.parameters).length) {
    lines.push(`a=fmtp:${pt} ` + Object.entries(codec.parameters).map(([k, v]) => `${k}=${v}`).join(';'));
  }
  lines.push('a=recvonly'); // ffmpeg 只收不发
  return lines.join('\r\n');
}

/* ★ 09-13 观测面板的取数函数：把 rooms Map 翻译成一份 JSON 快照
 * ▎为什么单独一个函数？/api/rooms 路由只管 HTTP 收发；"看懂服务器内部状态"的
 *   逻辑放这里，好读好测。async 是因为要逐路 Producer 调 getStats()（拿字节计数
 *   和健康分 score——mediasoup 会给每路媒体打 1~10 分，分数低 = 网络差/编码跟不上）。
 */
async function snapshotRooms() {
  // ★ 09-15 观测增强：录制中的媒体一览（D+2 的 producerId 集合）——面板上标 ⏺
  const recordingProducerIds = new Set();
  for (const rec of recordSessions.values()) {
    for (const c of rec.consumers) recordingProducerIds.add(c.producerId);
  }
  const list = [];
  for (const [roomNumber, room] of rooms) {
    const media = [];
    const members = [];
    for (const m of room.members) {
      // 每路 Producer：问 mediasoup 要实时统计（累计字节 + 健康分 + 层数）
      for (const p of m.producers.values()) {
        let byteCount = null, score = null;
        try {
          const stats = await p.getStats();
          for (const s of stats) {
            byteCount = (byteCount || 0) + (s.byteCount || 0);
            if (typeof s.score === 'number') {
              score = score === null ? s.score : Math.min(score, s.score); // 多层取最差
            }
          }
        } catch (e) { /* Producer 刚被关等竞态：留空即可 */ }
        media.push({
          producerId: p.id,
          kind: p.kind,
          source: (p.appData && p.appData.source) || '?',
          owner: m.id.slice(-4),
          byteCount,   // 累计发送字节（面板做差 → 实时码率）
          score,       // 1~10 健康分（10 = 最好）
          layers: (p.rtpParameters && p.rtpParameters.encodings || []).length || 1,
          recorded: recordingProducerIds.has(p.id), // ★ D+2：这路正在被服务器录制
        });
      }
      members.push({
        id: m.id,
        shortId: m.id.slice(-4),
        owner: m.id === room.ownerId,
        muted: !!(m.state && m.state.muted),
        camOff: !!(m.state && m.state.camOff),
        sharing: !!(m.state && m.state.sharing),
        hand: !!(m.state && m.state.hand),
        talkSec: Math.round(room.talk.get(m.id) || 0), // ★ 发言时长统计
        consumers: m.consumers.size,                   // 他订阅了几路
        transports: (m.sendTransport ? 1 : 0) + (m.recvTransport ? 1 : 0),
      });
    }
    const ctl = remoteCtl.get(roomNumber);
    list.push({
      roomNumber,
      createdAt: room.createdAt,
      durationSec: Math.round((Date.now() - room.createdAt) / 1000),
      // ★ D+4：空房宽限期状态（面板显示"空房宽限中 · 剩 xx s"）
      emptySince: room.emptySince || null,
      ttlRemainingSec: (room.emptySince && room.members.size === 0)
        ? Math.max(0, Math.round((room.emptySince + ROOM_TTL_MS - Date.now()) / 1000))
        : null,
      members,
      media,
      counts: {
        members: members.length,
        producers: media.length,
        consumers: members.reduce((a, m) => a + m.consumers, 0),
      },
      control: { hostId: (ctl && ctl.hostId) || null, controllerId: (ctl && ctl.controllerId) || null },
    });
  }
  return {
    now: Date.now(),
    worker: { pid: worker ? worker.pid : null, count: workers.length }, // count = 多 Worker 池大小（09-19f）
    recordingCount: recordSessions.size, // ★ D+2：全服务器进行中的录制数
    rooms: list,
  };
}

/* ★ 09-18 G7 可观测性：GET /metrics —— Prometheus 文本格式（零依赖手拼字符串）
 * ▎数据源就是现成的 snapshotRooms()（面板吃它，监控也吃它——"同一份真相"）；
 *   再补进程自身的 rss / 运行时长。Grafana / 任何 Prometheus 兼容抓取端直接认。
 * ▎格式纪律：# HELP/# TYPE 注释 + key{label} value 行；字节/秒数一律累计值（counter）。
 */
const PROCESS_START = Date.now();
function buildMetrics(snap) {
  const L = [];
  const help = (k, t, d) => L.push(`# HELP ${k} ${d}`, `# TYPE ${k} ${t}`);
  const rooms = snap.rooms || [];
  help('sfu_rooms_total', 'gauge', 'Number of rooms currently known to the SFU');
  L.push(`sfu_rooms_total ${rooms.length}`);
  help('sfu_members_total', 'gauge', 'Total members across all rooms');
  const membersTotal = rooms.reduce((a, r) => a + r.counts.members, 0);
  L.push(`sfu_members_total ${membersTotal}`);
  help('sfu_producers_total', 'gauge', 'Total producers (published media tracks)');
  L.push(`sfu_producers_total ${rooms.reduce((a, r) => a + r.counts.producers, 0)}`);
  help('sfu_consumers_total', 'gauge', 'Total consumers (server-side subscriptions)');
  L.push(`sfu_consumers_total ${rooms.reduce((a, r) => a + r.counts.consumers, 0)}`);
  /* ★ 09-24 AI 用量指标：把 LLM 调用次数/错误数/tokens/估算花费也纳入同一份 Prometheus 面。
   * ▎为什么值得：AI 功能一旦上线，"它到底有没有在被调用、失败了多少次、花了多少钱"
   *   就必须能观测——否则半夜烧钱或全量降级无人知晓。这也是 AI 从"能跑"到"可运维"的一步。 */
  const aiS = AI.getStats();
  help('sfu_ai_llm_enabled', 'gauge', '1 when a real LLM key is configured, 0 for mock-only mode');
  L.push(`sfu_ai_llm_enabled ${aiS.enabled ? 1 : 0}`);
  help('sfu_ai_llm_calls_total', 'counter', 'LLM calls attempted (excludes pure mock fallbacks before any HTTP attempt)');
  L.push(`sfu_ai_llm_calls_total ${aiS.calls}`);
  help('sfu_ai_llm_ok_total', 'counter', 'LLM calls answered by the real model');
  L.push(`sfu_ai_llm_ok_total ${aiS.ok}`);
  help('sfu_ai_llm_errors_total', 'counter', 'LLM calls that failed (timeout / HTTP error / empty completion)');
  L.push(`sfu_ai_llm_errors_total ${aiS.errors}`);
  help('sfu_ai_llm_mock_total', 'counter', 'Requests served by local mock rules (no key or degraded)');
  L.push(`sfu_ai_llm_mock_total ${aiS.mock}`);
  help('sfu_ai_llm_prompt_tokens_total', 'counter', 'Cumulative prompt tokens reported by the LLM');
  L.push(`sfu_ai_llm_prompt_tokens_total ${aiS.promptTokens}`);
  help('sfu_ai_llm_completion_tokens_total', 'counter', 'Cumulative completion tokens reported by the LLM');
  L.push(`sfu_ai_llm_completion_tokens_total ${aiS.completionTokens}`);
  help('sfu_ai_llm_cost_cny', 'gauge', 'Estimated cumulative LLM spend in CNY');
  L.push(`sfu_ai_llm_cost_cny ${aiS.costCny}`);
  help('sfu_room_members', 'gauge', 'Members per room');
  for (const r of rooms) L.push(`sfu_room_members{room="${r.roomNumber}"} ${r.counts.members}`);
  help('sfu_producer_bytes_total', 'counter', 'Cumulative bytes forwarded per producer');
  for (const r of rooms) {
    for (const m of r.media) {
      L.push(`sfu_producer_bytes_total{room="${r.roomNumber}",kind="${m.kind}",source="${m.source}"} ${m.byteCount}`);
    }
  }
  help('sfu_workers', 'gauge', 'mediasoup Worker processes in the pool');
  L.push(`sfu_workers ${workers.length}`);
  help('sfu_recordings_active', 'gauge', 'Server-side recordings currently running');
  L.push(`sfu_recordings_active ${snap.recordingCount || 0}`);
  help('sfu_process_uptime_seconds', 'gauge', 'SFU server process uptime in seconds');
  L.push(`sfu_process_uptime_seconds ${Math.round((Date.now() - PROCESS_START) / 1000)}`);
  help('sfu_process_resident_memory_bytes', 'gauge', 'SFU server process RSS in bytes');
  L.push(`sfu_process_resident_memory_bytes ${process.memoryUsage().rss}`);
  return L.join('\n') + '\n';
}
async function handleApiMetrics(res) {
  try {
    const body = buildMetrics(await snapshotRooms());
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`metrics error: ${err.message}`);
  }
}

// /api/rooms 的 HTTP 收尾：JSON 输出 + 出错别把进程带崩
async function handleApiRooms(res) {
  try {
    const body = JSON.stringify(await snapshotRooms());
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

/* ★ 09-17e 值守归档（AI 线 C3-N1，前端第 30 步）：字幕账本的「服务器权威副本」
 * ▎为什么需要它：过夜值守（≥7h）时浏览器内存里的账本只留最近 500 条（环形缓冲），
 *   溢出的旧段由前端攒批 POST 到这里，append 进 sfu/captions/cap-<房间号>-<日期>.jsonl。
 *   每行一条 JSON（jsonl 格式）：append-only、写一行落一行（断电不丢已写入的），
 *   将来 G2「LLM 会议纪要」直接吃这份文件——这就是"权威副本放服务器"的原因。
 * ▎两个方向：
 *   POST /api/captions  body { room, entries:[{ts,from,name,text}] } → { saved: n }
 *   GET  /api/captions?room=130525&format=txt|json → 该房间全部归档（跨文件按时间排序）
 *   （format=txt 给前端「⬇ 记录」合并导出用；format=json 给将来的 LLM/脚本用）
 */
const CAPTIONS_DIR = path.join(__dirname, 'captions');
fs.mkdirSync(CAPTIONS_DIR, { recursive: true }); // 启动时确保目录在（幂等，已存在不报错）

// 读 POST body 的小 helper（原生 http 没有现成的；2MB 上限防滥用——挂一夜的字幕也就几 MB）
function readJsonBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('请求体超过 2MB 上限'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        reject(new Error('不是合法的 JSON'));
      }
    });
    req.on('error', reject);
  });
}

// POST：追加归档。房间号 6 位数字白名单（文件名直接用房间号拼，必须先钳住路径穿越）；
// 单条只认 ts/from/name/text 四个字段并截长（防畸形/防滥用），坏条目不拖累整批。
async function handleApiCaptions(req, res) {
  try {
    const body = await readJsonBody(req);
    const room = String((body && body.room) || '');
    const entries = Array.isArray(body && body.entries) ? body.entries : null;
    // ★ 09-24 C4：POST 的房间号在 body 里，所以门禁在这里判（GET 在 requestHandler 里判）。
    //   注意门禁放在格式校验之前：**没权限的人不该通过"房间号格式对不对"来判断信息**。
    if (!requireRoomAccess(req, res, room).ok) return;
    if (!/^\d{6}$/.test(room)) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('房间号必须是 6 位数字');
      return;
    }
    if (!entries || !entries.length) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('entries 不能为空');
      return;
    }
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // UTC 日期做分档
    const file = path.join(CAPTIONS_DIR, `cap-${room}-${day}.jsonl`);
    const clean = entries.map((e) => ({
      ts: Number(e && e.ts) || Date.now(),
      from: String((e && e.from) || '').slice(0, 64),
      name: String((e && e.name) || '').slice(0, 64),
      text: String((e && e.text) || '').slice(0, 500),
    }));
    fs.appendFileSync(file, `${clean.map((e) => JSON.stringify(e)).join('\n')}\n`);
    /* ★ 09-25：字幕入库 = AI 的"听觉信号"到达服务器 → 顺手喂给实时看板。
     * ▎为什么挂在这里而不是新开一条信令：字幕本来就要经过这个端点落盘（复用既有通路，
     *   不新增协议），而"落盘"与"消化"用的是同一批数据、同一时刻——天然该在一起。
     * ▎为什么用 try 包住：看板是**增值功能**，它坏了绝不能影响字幕归档这条主干
     *   （归档丢了就是真的丢数据，看板丢了只是少一块辅助信息，两者严重性不对等）。 */
    try {
      feedBoard(room, clean);
    } catch (e) {
      logEvent('warn', 'ai-board-feed-failed', { roomNumber: room, reason: String(e && e.message).slice(0, 120) });
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ saved: clean.length }));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`归档失败：${err.message}`);
  }
}

// GET：回读全档。文件名带日期（字典序=时间序），读全后仍按 ts 排一次序保险；
// 单行解析失败就跳过（append 文件的断电残留只坏半行，不能让整份归档读不出来）。
function handleCaptionRead(res, room, format) {
  if (!/^\d{6}$/.test(room)) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('房间号必须是 6 位数字');
    return;
  }
  const files = fs.existsSync(CAPTIONS_DIR)
    ? fs.readdirSync(CAPTIONS_DIR)
        .filter((f) => f.startsWith(`cap-${room}-`) && f.endsWith('.jsonl'))
        .sort()
    : [];
  const entries = [];
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(CAPTIONS_DIR, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line));
      } catch (e) { /* 坏行跳过 */ }
    }
  }
  entries.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  if (format === 'json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(entries));
    return;
  }
  const text = entries
    .map((e) => `[${new Date(e.ts).toLocaleTimeString('zh-CN', { hour12: false })}] ${e.name}: ${e.text}`)
    .join('\n');
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}


/* ★ 09-13 可达性：可选的 HTTPS 服务器（config.json 的 https.enabled = true 时启动）
 * ▎为什么有它？跨机访问时页面必须是安全上下文（https），getUserMedia 才能开摄像头。
 *   证书缺失时尝试用 openssl 现场自签一张（开发机够用；正式域名请换真证书）。
 */
let httpsServer = null;
const tlsCfg = CONFIG.https || {};

/* ★ 09-24 G9：自签证书必须带 SAN —— 这是"手机用不了"的一大根因。
 * ▎为什么必须 SAN：浏览器**早就不看 CN（Common Name）了**（RFC 6125，各家 2017 年起执行）。
 *   一张只有 /CN=webrtc-sfu-dev 的证书，桌面 Chrome/Edge 报 ERR_CERT_COMMON_NAME_INVALID；
 *   手机浏览器（尤其 iOS Safari）更严格——常常连"继续访问"都不给，直接连不上。
 * ▎加了 SAN 之后：证书对 localhost / 127.0.0.1 / 本机局域网 IP 都算"名字匹配"，
 *   手机至少能弹出"继续访问"的自签警告，点进去就有安全上下文（摄像头/麦克风才可用）。
 * ▎SAN 里为什么要有局域网 IP：手机访问用的就是 https://192.168.x.x:3443，
 *   不把这个 IP 写进去，SAN 一样对不上，等于没加。
 */
function inspectCertSan(file) {
  /* 检测方式：用 Node 内置 X509Certificate 解析证书，读它的 subjectAltName。
   * ▎为什么不"在证书文件里搜字符串"？——PEM 是 base64 编码，明文串根本搜不到，
   *   那种写法会永远返回 false（然后每次启动都重签），是典型的"看起来能用其实没用"。
   * ▎解析失败（文件损坏/半截）按"没有 SAN"处理 → 触发重新生成，正好自愈。
   * ▎★ 09-24 追加：不仅要问"有没有 SAN"，还要问"**覆盖当前这个 IP 了吗**"。
   *   原因是一次真复现：这台机器 DHCP 换过三次 IP（127.194 → 116.194 → 74.194），
   *   而证书是**旧 IP 在的时候**签的——只判"有 SAN"就永远不重签，
   *   于是手机连 https://192.168.74.194:3443 依旧证书不匹配。
   *   所以这里把 SAN 里的 IP 抽出来交给调用方比对。 */
  try {
    const x = new (require('crypto').X509Certificate)(fs.readFileSync(file));
    const san = x.subjectAltName || '';
    const hasSan = san.includes('DNS:') || san.includes('IP Address:');
    const ips = [...san.matchAll(/IP Address:\s*([0-9a-fA-F:.]+)/g)].map((m) => m[1]);
    return { hasSan, san, ips };
  } catch (e) { return { hasSan: false, san: '', ips: [] }; }
}
if (tlsCfg.enabled) {
  const certFile = tlsCfg.cert || path.join(__dirname, 'tls', 'dev-cert.pem');
  const keyFile = tlsCfg.key || path.join(__dirname, 'tls', 'dev-key.pem');
  try {
    const missing = !fs.existsSync(certFile) || !fs.existsSync(keyFile);
    /* ★ 09-24：**旧证书没有 SAN 也要重新生成**，不能静默沿用——
     *   否则用户遇到的是最难排查的一类问题："我明明按说明改了，为什么没生效？"
     *   （证书是上次生成的、躺在盘上，代码改了也不会自动换新。） */
    const sanInfo = missing ? { hasSan: false, san: '', ips: [] } : inspectCertSan(certFile);
    const staleNoSan = !missing && !sanInfo.hasSan;
    /* ★ 09-24 追加：**SAN 没覆盖当前局域网 IP 也要重签**（DHCP 漂移自愈）。
     *   只判"有没有 SAN"是不够的：换过网络的开发机，证书里留着上一次的旧 IP，
     *   手机上照样是证书不匹配。这里拿当前探测到的所有 IP 去比对，缺哪个就重签。 */
    const lanIps = (detectLocalIps() || []);
    const driftedIps = missing || !sanInfo.hasSan ? [] : lanIps.filter((ip) => !sanInfo.ips.includes(ip));
    const staleIpDrift = driftedIps.length > 0;
    if (missing || staleNoSan || staleIpDrift) {
      if (tlsCfg.autoSelfSigned === false) throw new Error(staleNoSan || staleIpDrift ? '现有证书不含 SAN 或未覆盖当前 IP，且已禁用自签' : '证书文件不存在且已禁用自签');
      fs.mkdirSync(path.dirname(certFile), { recursive: true });
      /* 自签一张 10 年期开发证书。
       * ★ 09-17c（doctor 实测发现）：这台机器的 openssl **不在 PATH**（装在
       *   C:\Program Files\Git\usr\bin\openssl.exe），原来的 execSync('openssl ...') 会直接抛错 →
       *   证书一缺就起不来 HTTPS → 跨机访问没有安全上下文 → 摄像头/字幕/滤镜全不可用。
       *   所以这里改成先找可用的 openssl（PATH → Windows 上 Git 的常见安装位置），
       *   一个都找不到时给出**可操作的提示**（而不是一句英文堆栈）。
       */
      const { execFileSync } = require('child_process');
      const opensslCandidates = ['openssl',
        'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
        'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
        'C:\\Program Files (x86)\\Git\\usr\\bin\\openssl.exe',
      ];
      let opensslBin = null;
      for (const bin of opensslCandidates) {
        try { execFileSync(bin, ['version'], { stdio: 'ignore' }); opensslBin = bin; break; }
        catch (e) { /* 试下一个 */ }
      }
      if (!opensslBin) throw new Error('找不到 openssl（PATH 与 Git 目录都没有）');
      // 局域网 IP 复用文件里已有的探测逻辑（detectLocalIps 是函数声明，会提升，此处可调用）
      /* ★ 09-24：**把所有局域网 IP 都写进 SAN**，不只取第一个——
       *   一台机器常见"WLAN 一个网段 + 有线一个网段"（本机就有 WLAN 192.168.74.x），
       *   只写第一个的话，换另一张网卡访问就又不匹配了。多写几个的成本是 0。 */
      const sanParts = ['DNS:localhost', 'IP:127.0.0.1'];
      for (const ip of lanIps) sanParts.push(`IP:${ip}`);
      // 把旧证书里**已有的** IP 也保留下来：万一你现在只是插着另一张网卡，
      // 老网段将来还要用（比如回宿舍换回 Wi-Fi），保留可以让两边都能连。
      for (const ip of sanInfo.ips) {
        if (ip !== '127.0.0.1' && !sanParts.includes(`IP:${ip}`)) sanParts.push(`IP:${ip}`);
      }
      const sanValue = sanParts.join(',');
      const baseArgs = ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
        '-subj', '/CN=webrtc-sfu-dev'];
      const why = missing ? '首次生成'
        : staleNoSan ? '旧证书不含 SAN，已重新生成'
        : `旧证书未覆盖当前 IP ${driftedIps.join('/')}（换过网络），已重新生成`;
      try {
        execFileSync(opensslBin,
          [...baseArgs, '-addext', `subjectAltName=${sanValue}`, '-keyout', keyFile, '-out', certFile],
          { stdio: 'ignore' });
        console.log(`🔑 已自动生成自签开发证书（${why}；用 ${opensslBin}）`);
        console.log(`   ▸ SAN：${sanParts.join(', ')}（浏览器早就不看 CN 了，手机能否连上全看这里）`);
        if (!lanIps.length) console.log('   ⚠️ 没探测到局域网 IP，SAN 里只有 localhost/127.0.0.1 —— 手机按局域网 IP 访问仍会证书不匹配，可能连不上');
      } catch (e) {
        // 兜底：极老的 openssl（<1.1.1）不认 -addext。退回不写 SAN 的证书，但必须**明说**，
        // 而不是悄悄生成一张手机连不上的证书（那样比报错更坑）。
        execFileSync(opensslBin, [...baseArgs, '-keyout', keyFile, '-out', certFile], { stdio: 'ignore' });
        console.log('🔑 已生成自签证书，但当前 openssl 不支持 -addext，未能写入 SAN');
        console.log('   ⚠️ 无 SAN 的证书在手机上可能完全连不上（桌面浏览器可点"继续访问"）。建议升级 openssl（Git 自带的 1.1.1+ 即可）');
      }
    }
    // 同一个请求处理器挂到 HTTPS 上：HTTP/HTTPS 行为完全一致，
    // socket.io 挂上它之后 wss 也自动可用（见第 D 部分开头的 io.attach）。
    httpsServer = require('https').createServer(
      { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) },
      requestHandler
    );
    console.log(`🔒 HTTPS 已启用（端口 ${tlsCfg.port || 3443}，wss 同端口）`);
  } catch (err) {
    console.error(`⚠️ HTTPS 启用失败（退回纯 HTTP）：${err.message}`);
  }
}

/* ──────────────────────────────────────────────────────────────
 * 第 B 部分：mediasoup 初始化
 *
 * ▎层级（面试必考，由大到小）：
 *   Worker（一个进程）→ Router（一个房间）→ WebRtcTransport（一个人）
 *   → Producer（我上传的一路媒体）/ Consumer（我订阅的一路媒体）
 * ▎本 Demo 的取舍：
 *   只启动 1 个 Worker（够演示）；每房间 1 个 Router；
 *   每人 2 条 Transport（1 发 1 收，官方推荐做法）；
 *   摄像头/麦克风/屏幕 各自 = 1 个 Producer。
 * ────────────────────────────────────────────────────────────── */

// 一个 Worker 就够了：它内部能开无数个 Router
/* ★ 09-19f SFU 深造（G1-②）：单 Worker → 多 Worker 横向扩展。
 * ▎为什么值得做：mediasoup 的媒体转发跑在 Worker（C++ 子进程）里——一个 Worker
 *   只能吃满一个核。单机横向扩容的第一步就是多 Worker（多核），第二步才是多机级联。
 * ▎分配策略：**轮询**（无状态、O(1)、够用）——"按 Router 数最少"这类最少连接策略
 *   需要自己记账，教学版注释里点明扩展点即可（面试话术：无状态策略与记账策略的取舍）。
 * ▎兼容：`worker` 变量保留 = workers[0]（TEST_RECORD 自测与快照 pid 引用不变）；
 *   CONFIG.workerCount / 环境变量 MEDIASOUP_WORKERS 控制数量，默认 1（行为不变）。
 * ▎健壮：某个 Worker 挂了 → 从池里摘除 + 5 秒补位（其它 Worker 上的房间不受影响）。 */
const workers = [];
let workerIdx = 0;
let worker = null;
/* ★ 09-24：优雅退出标志。声明在这里（而不是文件末尾的退出段）是因为 Worker 的 'died'
 *   处理器要读它——退出时 Worker 是我们主动关的，不该再被当成"崩溃"报错并触发补位。
 *   放在 Worker 池之前声明，避免读到未初始化的 let（TDZ）。 */
let shuttingDown = false;

// 每个房间（Router）支持的编码。浏览器会从这里面挑一种来编码发送：
//   opus = 音频；VP8/H264 = 视频（H264 带 profile 参数是 Chrome 常见要求）
const mediaCodecs = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  { kind: 'video', mimeType: 'video/VP8', clockRate: 90000 },
  // ★ D+3：VP9（SVC 的载体）。simulcast = 三路独立编码（VP8 就能跑）；
  //   SVC = 一路编码内部分层（VP9 的 L3T3 = 3 空间 × 3 时间层）。
  //   config.json 的 videoSvc:true 时浏览器会改用 VP9 SVC 上传（见 client 第 7 步）。
  { kind: 'video', mimeType: 'video/VP9', clockRate: 90000, parameters: { 'profile-id': 0 } },
  {
    kind: 'video', mimeType: 'video/H264', clockRate: 90000,
    parameters: {
      'level-asymmetry-allowed': 1,
      'packetization-mode': 1,
      'profile-level-id': '42e01f',
    },
  },
];

// 媒体走 UDP，端口范围可调（云服务器要放行这段端口！）
//   优先级：环境变量 > config.json > 默认值
/* ★ 09-19 G7-② 结构化日志（零依赖）：
 * ▎是什么：logEvent(level, event, fields) 把关键事件追加成 JSON Lines
 *   （sfu/logs/app-YYYY-MM-DD.jsonl，按天分档）——人读的 console.log 照旧，
 *   这份是给机器读的：jq / 脚本 / 未来的告警器直接吃。
 * ▎纪律：只埋"值得回放"的关键事件（房间生命周期/成员进出/授权/录制/异常），
 *   绝不埋高频 tick（net-levels/audio-levels 那些每 3s/400ms 一发的，日志会爆炸）。
 * ▎健壮性：日志写失败绝不影响信令主路（try/catch 静默——教学项目磁盘满了也不能崩）。 */
const LOGS_DIR = path.join(__dirname, 'logs');
fs.mkdirSync(LOGS_DIR, { recursive: true });
function logEvent(level, event, fields = {}) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
    fs.appendFileSync(path.join(LOGS_DIR, `app-${day}.jsonl`), line + '\n');
  } catch (e) { /* 日志失败不干扰主路 */ }
}

const rtcMinPort = Number(process.env.MEDIASOUP_RTC_MIN_PORT) || Number(CONFIG.rtcMinPort) || 40000;
const rtcMaxPort = Number(process.env.MEDIASOUP_RTC_MAX_PORT) || Number(CONFIG.rtcMaxPort) || 49999;

// 服务器监听地址：
//   本机演示默认 127.0.0.1；局域网/云服务器要改成对外地址，例如：
//   MEDIASOUP_LISTEN_IP=0.0.0.0 MEDIASOUP_ANNOUNCED_IP=192.168.1.10 node sfu/server.js
//   （或写进 config.json 的 listenIp / announcedIp）
const LISTEN_IP = process.env.MEDIASOUP_LISTEN_IP || CONFIG.listenIp || '127.0.0.1';

/* ★ 09-24 实修「announcedIp 漂移」（跨机看不见画面的头号根因，本次真复现：
 *   config.json 里躺着 192.168.127.194，本机实际早已换成 192.168.209.194）。
 * ▎旧行为：只打印告警，**仍然用错 IP 通告给浏览器** → 同机 localhost 一切正常，
 *   别的电脑/手机进会一律黑屏，且没有任何运行时错误可循极难排查。
 * ▎新行为：三层取值，取不到有效值就**自动回退到本机真实网卡 IP**：
 *     ① 环境变量 MEDIASOUP_ANNOUNCED_IP（最高优先级，运维/容器场景）
 *     ② config.json 的 announcedIp **且与本机某个网卡一致**（有效才用）
 *     ③ 都不成立 → 自动挑一个本机对外 IPv4（私网优先），并打印醒目提示
 *   这样"IP 换了"从致命故障降级为一行提示——延迟满足 ⟨可靠性⟩ 而非 ⟨可配置性⟩。 */
function detectLocalIps() {
  const os = require('os');
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
    }
  }
  // 私网优先（192.168/10/172.16-31 才是典型的局域网可达地址）
  const priv = (ip) => /^192\.168\./.test(ip) || /^10\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  return ips.sort((a, b) => (priv(b) ? 1 : 0) - (priv(a) ? 1 : 0));
}
const ANNOUNCED_DECISION = (() => {
  const ips = detectLocalIps();
  const env = process.env.MEDIASOUP_ANNOUNCED_IP;
  if (env) return { ip: env, source: 'env', ips };
  const cfg = CONFIG.announcedIp;
  if (cfg && ips.includes(cfg)) return { ip: cfg, source: 'config', ips };
  if (cfg) return { ip: ips[0] || undefined, source: 'fallback', stale: cfg, ips };
  return { ip: ips[0] || undefined, source: 'auto', ips };
})();
const ANNOUNCED_IP = ANNOUNCED_DECISION.ip;

async function startOneWorker() {
  const w = await mediasoup.createWorker({
    logLevel: 'warn',          // 生产环境日志级别可以调成 debug 排查
    rtcMinPort,
    rtcMaxPort,
  });
  workers.push(w);
  if (!worker) worker = w; // 兼容旧引用（workers[0]）
  // Worker 是常驻 C++ 进程；万一崩了：摘出池子 → 记日志 → 5 秒补一个新槽位
  w.on('died', () => {
    const i = workers.indexOf(w);
    if (i >= 0) workers.splice(i, 1);
    /* ★ 09-24：优雅退出时**不报错也不补位**。
     *   否则 Ctrl+C 关服务会打出一行 "❌ Worker 挂了" —— 一个正常的退出被渲染成故障，
     *   演示时看到会以为程序崩了（这正是本次实跑时观察到的现象）。 */
    if (shuttingDown) return;
    console.error('❌ mediasoup Worker 挂了，5 秒后自动补位...');
    logEvent('error', 'worker-died', { pid: w.pid, remaining: workers.length });
    setTimeout(() => startOneWorker().catch((e) => console.error('Worker 补位失败：', e.message)), 5000);
  });
  return w;
}
async function createWorker() {
  const count = Math.max(1, Number(CONFIG.workerCount) || Number(process.env.MEDIASOUP_WORKERS) || 1);
  for (let i = 0; i < count; i++) await startOneWorker();
  console.log(`⚙️  mediasoup Workers×${workers.length} 已启动（端口 ${rtcMinPort}-${rtcMaxPort}）`);
  return workers[0];
}
// 轮询挑一个 Worker 挂新 Router（无状态策略；扩展点：按 Router 数最少需要记账）
function pickWorker() {
  if (!workers.length) throw new Error('没有可用的 mediasoup Worker');
  const w = workers[workerIdx % workers.length];
  workerIdx = (workerIdx + 1) % Math.max(1, workers.length * 7); // 防溢出的简单轮询
  return w;
}

/* ──────────────────────────────────────────────────────────────
 * 第 C 部分：房间管理（从 Mesh 版 server.js 复制改造）
 *
 *   rooms: Map<房间号(6位数字), 房间对象>
 *   房间对象 = {
 *     password: string|null,  // 入会密码（没有 = null）
 *     members : Set<socket>,  // 房间里的连接（存 socket 本体，读他的 Producer 要用）
 *     router  : mediasoup Router, // ★ SFU 新增：这个房间的"媒体中枢"
 *   }
 * ────────────────────────────────────────────────────────────── */

const rooms = new Map();

/* ★ 09-16 基础功能补全：登录/注册（用户体系）
 * ★ 09-24 存储升级：原来的 sfu/users.json（整文件 JSON.parse/writeFileSync）已换成
 *   node:sqlite 的 store 层（见 sfu/store.js）——调用点全部走 store，**不再有第二套实现**。
 * ▎为什么值得升级：整文件读写有三个硬伤——① 每次登录都要读+解析全文件；
 *   ② 写是"全量覆盖"，写一半崩掉文件就废；③ 想按 role 查账号只能自己遍历。
 *   换 SQLite 后这些变成一句 SQL，且**没新增任何 npm 依赖**（node:sqlite 是 Node 内置）。
 * ▎密码**绝不存明文**——scrypt(+随机盐) 是 Node 内置 crypto，不引 bcrypt（零依赖铁律）。
 * ▎token：登录/注册成功发一个随机 token（内存 Map），前端存 localStorage 自动恢复登录态；
 *   重启即失效是**教学取舍**（真实产品用数据库 + 长期 refreshToken），注释里讲清楚。
 *   现在 token 里多带一个 role（管理员门禁要用），见下面 issueToken。
 * ▎身份的用途：昵称贯通成员列表/聊天气泡/工作台状态条；不登录也能玩（游客模式）。 */
const crypto = require('crypto');
/* ★ 09-26 头像系统（参考 apple-avatar 素材集）：注册可选预设头像（key 白名单 av-01~09，
 *   文件 sfu/public/avatars/presets/av-XX.png，名字映射在前端 PRESET_AVATARS）。
 *   AI 助理五态头像（idle/listening/thinking/speaking/happy）在 avatars/ai/，
 *   由 ai-state 广播驱动前端状态机（AI 格子 + 成员行动态头像）。 */
const AVATAR_PRESETS = new Set(['av-01', 'av-02', 'av-03', 'av-04', 'av-05', 'av-06', 'av-07', 'av-08', 'av-09']);

/* ★ 09-19h G6-③ 限流（零依赖手写固定窗口计数器，~15 行）：
 * ▎防什么：撞库（login）/暴力猜 6 位房间号（join-room）/注册机刷号（register）/刷屏（chat）。
 * ▎用固定窗口而非令牌桶：实现最短、语义直白（"一分钟最多 N 次"），教学项目够用；
 *   需要平滑限流再换令牌桶（扩展点注释）。
 * ▎内存纪律：桶本身带过期，定时清理防 Map 无限涨（与日志环形上限同一总纲）。 */
const rateBuckets = new Map(); // key -> { count, windowStart }
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const b = rateBuckets.get(key);
  if (!b || now - b.windowStart >= windowMs) {
    rateBuckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  b.count += 1;
  return b.count <= max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of rateBuckets) if (now - b.windowStart > 15 * 60000) rateBuckets.delete(k);
}, 10 * 60000).unref();

/* ★ 09-19h G6-① token 生命周期（原来是无过期内存 Map——"敢公开演示"的第一道坎）：
 * ▎authTokens 值升级为 { username, displayName, expiresAt }；
 *   默认 24h（AUTH_TTL_MS 环境变量可调——信令回归用它开短 TTL 实测过期路径）；
 * ▎滑动续期：auth-verify / auth-refresh 命中即续期（真实产品的"活跃不掉线"语义）；
 *   auth-refresh = 显式续期信令（前端定时调，长期会话不中断）。 */
const AUTH_TTL_MS = Number(process.env.AUTH_TTL_MS) || 24 * 3600 * 1000;
const authTokens = new Map(); // token -> { username, role, expiresAt }
/* ★ 09-24 G8-②：token 里带上 role —— HTTP 层门禁（requireAdmin）拿 token 就能判断是不是管理员，
 *   不必再回查数据库。role 在**发 token 那一刻**从库里取（登录/注册时取一次），
 *   所以用 admin:grant 改了角色后，已发的旧 token 仍是旧角色直到重新登录——
 *   这是取舍：换来"每次 HTTP 请求零数据库查询"，代价是角色变更有轻微生效延迟。 */
function issueToken(username) {
  const u = store.getUser(username);
  const token = crypto.randomBytes(24).toString('hex');
  authTokens.set(token, { username, role: (u && u.role) || 'user', expiresAt: Date.now() + AUTH_TTL_MS });
  return token;
}
/* verifyToken —— 只凭 token 解析身份（HTTP 门禁用，不需要事先知道用户名）
 * ▎返回 { username, role } 或 null（null = 不存在/已过期）。命中即滑动续期。 */
function verifyToken(token) {
  const t = authTokens.get(token);
  if (!t) return null;
  if (Date.now() > t.expiresAt) { authTokens.delete(token); return null; }
  t.expiresAt = Date.now() + AUTH_TTL_MS; // 滑动续期：活跃会话不过期
  return { username: t.username, role: t.role };
}
/* validToken —— 信令里的用法是"这个 token 是不是这个用户的"
 * ▎返回值从"布尔"改成 { username, role } | null：调用点（auth-verify/auth-refresh）
 *   原本就当布尔用（`!validToken(...)`），对象是真值、null 是假值，语义不变；
 *   多出来的 role 让上层将来能顺手用。**改动向后兼容**，不需要改所有调用点。 */
function validToken(token, username) {
  const v = verifyToken(token);
  return v && v.username === username ? v : null;
}

/* ══════════════════════════════════════════════════════════════════
 * ★ 09-24 C4（本轮）：房间内令牌的签发/校验 + 录像签名 URL
 *
 * ▎为什么做成**无状态 HMAC 签名令牌**，而不是服务器内存里的 Map？
 *   内存 Map 看起来更简单，但有一个致命场景：服务器一重启，房间没了、Map 也空了，
 *   于是"过夜值守"归档的令牌全失效——第二天早上用户拿着昨天的链接读不出自己的纪要。
 *   无状态签名的令牌只依赖 SECRET，**重启后依然有效**（只要 SECRET 没换）。
 *   代价：无法单独吊销某张令牌（只能等过期或轮换 SECRET）——本教学版如实接受。
 *
 * ▎令牌格式（两个 base64url 段，点号分隔）：
 *     roomToken = base64url(JSON.stringify({ room, iat, exp })) + "." + base64url(hmacSHA256(payloadB64, SECRET))
 *   校验三件事：① 签名匹配（crypto.timingSafeEqual，防时序侧信道）；② 未过期；
 *   ③ token.room === 请求的房间号（跨房必须是 401）。任何解析失败一律返回 false，绝不抛。
 *
 * ▎SECRET 的存放：32 字节随机 hex，持久化到 sfu/data/room-secret（该目录已在 .gitignore 内）。
 *   首次运行自动生成（mkdir -p + 写文件 + 尝试 chmod 600），之后读取复用；
 *   启动时若生成过会打印一行日志。**换掉这个文件 = 所有已签发令牌立即失效**。
 * ══════════════════════════════════════════════════════════════════ */
const ROOM_SECRET_FILE = path.join(__dirname, 'data', 'room-secret');

/* TTL：默认 24h（86400s）。优先级：环境变量 ROOM_TOKEN_TTL_SEC > config.roomTokenTtlSec > 86400。
 * ▎为什么环境变量优先：信令回归要靠它造"已经过期"的令牌（传 -1 → exp 落在过去），
 *   这是唯一能可靠实测过期路径的办法（不去改系统时钟、也不依赖"等 24 小时"）。 */
const ROOM_TOKEN_TTL_MS = (() => {
  const env = process.env.ROOM_TOKEN_TTL_SEC;
  if (env !== undefined && env !== '' && !Number.isNaN(Number(env))) return Number(env) * 1000;
  const cfg = Number(CONFIG.roomTokenTtlSec);
  if (Number.isFinite(cfg) && cfg > 0) return cfg * 1000;
  return 86400 * 1000;
})();

function loadOrCreateRoomSecret() {
  // 已存在且格式像 32 字节 hex（64 个 hex 字符）→ 直接复用
  try {
    const existing = fs.readFileSync(ROOM_SECRET_FILE, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(existing)) return existing.toLowerCase();
  } catch (e) { /* 不存在/读不了 → 下面重新生成 */ }
  const secret = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(ROOM_SECRET_FILE), { recursive: true });
    fs.writeFileSync(ROOM_SECRET_FILE, secret, { encoding: 'utf8', mode: 0o600 });
    // Windows 上 chmod 语义有限，失败可忽略；POSIX 上让密钥文件只有 owner 可读写。
    try { fs.chmodSync(ROOM_SECRET_FILE, 0o600); } catch (e) { /* 见上 */ }
    console.log('🔑 已生成房间令牌密钥 sfu/data/room-secret（32 字节随机；换掉它会让所有已签发令牌失效）');
  } catch (e) {
    // 落盘失败也不能让服务起不来：退化成"本次进程内的临时密钥"（重启即失效——不理想但可用）
    console.log(`⚠️ 房间令牌密钥落盘失败（${e.message}），改用本次进程内的临时密钥（重启后已签发令牌会失效）`);
  }
  return secret;
}
const ROOM_TOKEN_SECRET = loadOrCreateRoomSecret();

// base64url（URL 安全：+ → -、/ → _、去尾 = ）——放进 URL 查询串/请求头都不用再转义
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const hmacSha256 = (data) => crypto.createHmac('sha256', ROOM_TOKEN_SECRET).update(data).digest();

/* 给某个房间签发一张令牌 —— 只在"这个 socket 进房成功"时对**它自己**调用（绝不给别人签）。 */
function signRoomToken(room) {
  const now = Date.now();
  const payloadB64 = b64url(JSON.stringify({ room: String(room), iat: now, exp: now + ROOM_TOKEN_TTL_MS }));
  return payloadB64 + '.' + b64url(hmacSha256(payloadB64));
}
/* 校验：签名匹配 + 未过期 + room 一致。任何一步失败返回 false（不抛），供 requireRoomAccess 用。 */
function verifyRoomToken(token, room) {
  try {
    if (typeof token !== 'string' || !token) return false;
    const dot = token.indexOf('.');
    if (dot <= 0 || dot === token.length - 1) return false;
    const payloadB64 = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expect = hmacSha256(payloadB64);
    const got = fromB64url(sig);
    // timingSafeEqual 要求等长；长度不等直接判false（也顺手挡掉畸形输入）
    if (got.length !== expect.length) return false;
    if (!crypto.timingSafeEqual(got, expect)) return false;
    const obj = JSON.parse(fromB64url(payloadB64).toString('utf8'));
    if (!obj || typeof obj !== 'object') return false;
    if (typeof obj.exp !== 'number' || Date.now() > obj.exp) return false; // 过期
    if (String(obj.room) !== String(room)) return false;                   // 跨房（令牌只对签发它的房间有效）
    return true;
  } catch (e) { return false; }
}

/* ★ 录像的"短时效签名 URL"：/recordings/<文件名> 改成 admin 或签名 URL 才放行。
 * ▎为什么要它：单个录像此前只靠"能力 = 文件名"（文件名含 6 位房号 + 可估的时间戳）——
 *   同样属弱能力。改成签名 URL 后，链接自带过期时间，泄露也只在一小时窗口内。
 * ▎签名内容 fileName + '|' + exp 用同一把 SECRET 做 HMAC；exp 是绝对毫秒时间戳。
 * ▎诚实边界：签名 URL 同样是 Bearer（谁拿到谁下），只是加了"一小时过期"这道闸。
 */
function signRecordingUrl(fileName, ttlMs = 3600000) {
  const exp = Date.now() + ttlMs;
  const sig = hmacSha256(fileName + '|' + exp).toString('hex');
  return `/recordings/${encodeURIComponent(fileName)}?exp=${exp}&sig=${sig}`;
}
function verifyRecordingSig(fileName, exp, sig) {
  try {
    const e = Number(exp);
    if (!Number.isFinite(e) || Date.now() > e) return false;        // 缺失/过期
    const expect = hmacSha256(fileName + '|' + e);                  // Buffer
    const got = Buffer.from(String(sig || ''), 'hex');
    if (got.length !== expect.length) return false;
    return crypto.timingSafeEqual(got, expect);
  } catch (err) { return false; }
}
const clientIp = (socket) => (socket.handshake && socket.handshake.address) || 'unknown';
/* ★ 09-24：loadUsers/saveUsers 已删除（不留两套并行实现）。
 *   现在所有账号读写一律走 store：store.getUser / store.createUser / store.setUserRole… */
/* ★ 09-24 追加：口令哈希方案搬到 sfu/password.js，服务器与 scripts/admin.js **共用同一份**。
 *   原因见那个文件头：两处各存一份实现时，任何一边改了参数，CLI 建的账号就登不上，
 *   而且报错只会说"用户名或密码不对"，排查方向全被带偏。
 *   这里解构出来，下面原有调用点（hashPassword(pw, salt)）一个字都不用改。 */
const { hashPassword, newSalt, randomPassword } = require('./password');
function validUsername(u) {
  return typeof u === 'string' && /^[a-zA-Z0-9_一-龥]{2,16}$/.test(u);
}

// ★ 远程协助（后续升级方向 A1）：远程控制权总表 —— 和 Mesh 版同一个思路
//   房间号 -> { hostId, controllerId }
//     hostId       = 被控端（正在共享屏幕、允许别人操作的人）
//     controllerId = 控制端（被允许操作的人）
//   ▎为什么控制权要放在服务器？房间里的"谁在控谁"必须全房唯一（互斥），
//     服务器是房间里唯一的"权威"，由它来登记与广播（状态放唯一权威处）。
//   ▎SFU 版这张表还多了一层意义：Mesh 版它只管"授权"，鼠标键盘走 P2P DataChannel
//     不经服务器；SFU 版控制输入也要经服务器转发（remote-input），
//     所以这张表同时是"输入门禁"——没登记在册的人发得再快也一律丢弃。
const remoteCtl = new Map();

/* ★ A4 升级（2026-09-11）：文件传输台账 —— fileId -> { from, to, size, received }
 * ▎为什么必须放**模块级**（而不是写在每个连接的闭包里）？
 *   一次传输横跨两个连接（发送方 socket 与接收方 socket），
 *   台账必须两边都能看到，否则接收方校验"这文件是不是发给我"时会查不到记录。
 *   这也是"状态该放哪一层"的经典判断：**跨连接的状态放全局，单连接的状态挂 socket**。
 */
const fileTransfers = new Map();

/* ★ D+2 升级（2026-09-15）：服务器侧录制（"真产品的做法"，浏览器录制 D5 的对照）
 * ▎原理（官方推荐思路）：服务器为"要录的那两路媒体"各建一条 **PlainTransport**
 *   （纯 RTP/UDP，不走浏览器），consume 出来后 mediasoup 把 RTP 包直接推给
 *   **ffmpeg**（同一个进程里的外部程序），ffmpeg 按 SDP 收包 → 无重编码（-c copy）
 *   封装成 webm/mkv 落盘。浏览器录制（D5）录的是"合成画面"，掉线就断；
 *   服务器录制在服务器上跑，谁掉线都不影响——这就是真实产品的做法。
 * ▎ffmpeg 是外部依赖：启动时探测一次，没有就置 FFMPEG_OK=false，
 *   record-start 会返回明确的安装提示（信令测试也能验证这条错误路径）。
 */
let FFMPEG_OK = false;
let FFMPEG_BIN = 'ffmpeg'; // 具体可执行文件（PATH 里有就用名字；Windows winget 装在用户目录时用绝对路径）

/* ★ 09-17c 启动优化（用户反馈"后端启动不流畅"的元凶之一）：
 *   原来的 probeFfmpeg 用 execFileSync + `where /r` 递归扫 WinGet 包目录，
 *   在包目录很大的机器上会**同步阻塞事件循环数秒**，而且发生在 listen 之前——
 *   表现就是"敲了 npm run start:sfu，好几秒什么都不打印，浏览器也连不上"。
 *   现在拆成两步：
 *     ① 开机只做**快探测**（PATH 里的 ffmpeg -version，异步 + 500ms 超时），不阻塞；
 *     ② 深度扫描（where /r）挪到**真正要录制且快探测没找到**时才做（lazy，见 resolveFfmpegDeep）。
 */
function probeFfmpeg() {
  const { execFile } = require('child_process');
  const runOnce = () => new Promise((resolve) => {
    execFile(FFMPEG_BIN, ['-version'], { timeout: 2500, windowsHide: true }, (err) => {
      resolve(err
        ? { ok: false, code: err.code, killed: err.killed, msg: String(err.message || '') }
        : { ok: true });
    });
  });
  (async () => {
    /* ★ 09-24 实修「装了 ffmpeg 却说没装」（本次真复现一次，第二次又正常——典型竞态）：
     *   旧版 500ms 超时太紧——启动瞬间在拉 mediasoup Worker（C++ 子进程）的机器上，
     *   `ffmpeg -version` 冷启动可达数百毫秒，于是定时器一到就被 kill，调用方
     *   收到 err.killed=true 判成"未安装"，录音/AI 听觉管线全部被误关。
     *   现在：超时放宽到 2.5s + 超时重试一次 + **区分失败类型**——
     *   ENOENT 才是"真没装"，超时属于环境抖动，不能据此关掉功能。 */
    let r = await runOnce();
    if (!r.ok && (r.killed || /TIMEDOUT|ETIMEDOUT/i.test(r.msg))) r = await runOnce();
    if (!r.ok && (r.code === 'ENOENT' || /ENOENT/.test(r.msg))) {
      console.log('⚠️ 未检测到 ffmpeg（PATH 中无此命令）：服务器侧录制（D+2）暂不可用；首次录制时会深扫 winget 目录');
      return;
    }
    FFMPEG_OK = !!r.ok;
    console.log(FFMPEG_OK
      ? `✅ 已检测到 ffmpeg（${FFMPEG_BIN}）：服务器侧录制（D+2）/AI 听觉管线可用`
      : `⚠️ ffmpeg 探测未通过（${r.code || r.msg}）：首次录制时会深扫 winget 目录再试`);
  })();
}

// 深度扫描（只在"要录制但快探测失败"时调用；异步，绝不阻塞启动）
function resolveFfmpegDeep() {
  return new Promise((resolve) => {
    if (FFMPEG_OK) return resolve(true);
    const { execFile, exec } = require('child_process');
    const dirs = [
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages'),
      'C:\\Program Files\\WinGet\\Packages',
    ].filter(Boolean);
    const tryNext = (i) => {
      if (i >= dirs.length) {
        console.log('❌ 深扫仍未找到 ffmpeg：请先安装（winget install Gyan.FFmpeg）再重启服务器');
        return resolve(false);
      }
      exec(`where /r "${dirs[i]}" ffmpeg.exe`, { timeout: 5000, windowsHide: true }, (err, stdout) => {
        const first = !err && stdout && stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
        if (!first) return tryNext(i + 1);
        execFile(first, ['-version'], { timeout: 1000, windowsHide: true }, (e2) => {
          if (e2) return tryNext(i + 1);
          FFMPEG_BIN = first;
          FFMPEG_OK = true;
          console.log(`✅ 深扫找到 ffmpeg：${first}（服务器侧录制可用）`);
          resolve(true);
        });
      });
    };
    tryNext(0);
  });
}

/* ★ 09-17c 可达性自检（跨网连不上的头号原因）：announcedIp 必须等于本机某个真实网卡 IP。
 *   ▎为什么必须检查？mediasoup 会把 announcedIp 写进 ICE candidate 告诉浏览器"媒体发这里"；
 *     这个值一旦是旧 IP/写错，同机 localhost 能连、**别的电脑一律黑屏**（最难排查的那种）。
 *   ★ 09-24 升级：不再只是"大声告警"——实际用在信令里的 ANNOUNCED_IP 已经在上面
 *     被修正过（漂移时自动回退本机 IP），这里只负责把"用了什么、为什么"讲清楚。
 */
function checkAnnouncedIp() {
  const { ip, source, stale, ips } = ANNOUNCED_DECISION;
  if (!ip) {
    console.log(`⚠️ 没探到对外 IPv4：当前只通告 ${CONFIG.listenIp || '127.0.0.1'}，`
      + `\n   本机可用 IP：${ips.join('、') || '(无)'} —— 别的电脑将看不到画面（跑 npm run start:lan 可自动写好）`);
    return;
  }
  if (source === 'fallback') {
    console.log(`🩹 announcedIp 已自动纠偏：config.json 里的 ${stale} 不是本机网卡`
      + `（当前实际 ${ips.join('、')}）→ 本次运行改用 ${ip}`);
    console.log(`   ▸ 已经能正常跨机；想永久生效：把 config.json 的 announcedIp 改成 ${ip}（或跑 npm run start:lan 自动重写）`);
  } else if (source === 'auto') {
    console.log(`✅ 自动选用本机 IP ${ip} 作为 announcedIp（config.json 未设置）`);
  } else {
    console.log(`✅ announcedIp=${ip}（来源：${source === 'env' ? '环境变量' : 'config.json'}，与本机网卡一致）`);
  }
}
const recordSessions = new Map(); // recordId -> 会话（跨连接状态放全局：坑 18）
const RECORD_BASE_PORT = 50000;   // ffmpeg 收 RTP 的端口对从这里起（每路占 2 个，避开 RTC 段 40000~49999）

/* ★ D+2 核心：真正开一场录制（信令 record-start 与 TEST_RECORD 端到端自测共用这一份代码）
 * ▎tracks = [{ producer, kind }]：要录的媒体路数（成员的 camera+mic，或单指定一路）
 * ▎流程：每路建一条 PlainTransport（comedia=false：服务器**主动**把 RTP 推给 ffmpeg）
 *   → consume + resume → 生成 SDP → spawn ffmpeg 按 SDP 收流、-c copy 封装落盘。
 */
async function startRecording({ roomNumber, router, tracks, label }) {
  // 端口对分配：每路占 2 个（rtp/rtcp），video 从 base 起、audio 从 base+2 起（避开已占用）
  const used = new Set([...recordSessions.values()].map((r) => r.basePort));
  let basePort = RECORD_BASE_PORT;
  while (used.has(basePort)) basePort += tracks.length * 2;

  const rec = {
    id: `rec-${roomNumber}-${Date.now()}`,
    roomNumber,
    transports: [], consumers: [],
    basePort, file: null, proc: null,
  };
  const sections = []; // SDP 的各 m-line
  let i = 0;
  for (const { producer, kind } of tracks) {
    const rtpPort = basePort + i * 2;
    // PlainTransport = 纯 RTP 的"旁路出口"：不跟浏览器握手，把 RTP 原样推给指定 ip:port
    const t = await router.createPlainTransport({
      listenIp: { ip: LISTEN_IP },
      rtcpMux: false,   // RTP/RTCP 分端口（ffmpeg 的 SDP 收法）
      comedia: false,   // 服务器主动发（connect 指定目的地），不是等对端先发
    });
    await t.connect({ ip: '127.0.0.1', port: rtpPort, rtcpPort: rtpPort + 1 });
    const c = await t.consume({ producerId: producer.id, rtpCapabilities: router.rtpCapabilities });
    await c.resume(); // 坑 13①：Consumer 建完必须 resume（PlainTransport 的 Consumer 同样适用）
    rec.transports.push(t);
    rec.consumers.push(c);
    sections.push(sdpMediaSection(c, kind, rtpPort));
    i += 1;
  }

  // 生成 SDP 给 ffmpeg 当输入（-i file.sdp）
  const sdp = ['v=0', 'o=- 0 0 IN IP4 127.0.0.1', 's=mediasoup-record', 't=0 0', ...sections].join('\r\n');
  const vTrack = tracks.find((t) => t.kind === 'video');
  const vCodec = vTrack ? vTrack.producer.rtpParameters.codecs[0].mimeType.split('/')[1] : null;
  const ext = vCodec === 'H264' ? 'mkv' : 'webm'; // webm 不收 H264 → mkv
  const dir = path.join(__dirname, 'recordings');
  fs.mkdirSync(dir, { recursive: true });
  rec.file = path.join(dir, `${rec.id}.${ext}`);
  fs.writeFileSync(rec.file + '.sdp', sdp);

  // ffmpeg：按 SDP 收 RTP → 无重编码封装落盘（copy = CPU 几乎无感）
  rec.proc = require('child_process').spawn(FFMPEG_BIN, [
    '-loglevel', (process.env.TEST_RECORD === '1' ? 'info' : 'warning'),
    '-protocol_whitelist', 'file,udp,rtp',
    '-fflags', '+genpts',
    '-i', rec.file + '.sdp',
    '-c', 'copy',
    '-y', rec.file,
  ], { stdio: ['pipe', 'ignore', 'pipe'] }); // stdin 保持管道：优雅停止要往里写 'q'
  rec.proc.stderr.on('data', (d) => console.log(`⏺ [ffmpeg 收] ${d.toString().trim()}`));
  /* ★ 优雅停止：直接 kill 会让 matroska muxer 来不及写 trailer（duration=N/A）。
   *   往 stdin 写 'q'（ffmpeg 的交互退出键）→ muxer 完整收尾；2s 兜底强杀。 */
  rec.stop = () => {
    try { rec.proc.stdin.write('q\n'); } catch (e) { /* 已退出 */ } // ffmpeg 按行读 stdin 命令
    setTimeout(() => { try { rec.proc.kill(); } catch (e) { /* 已退出 */ } }, 2000);
  };

  rec.proc.on('exit', (code) => {
    // 停止（正常 kill）或秒退（端口占用等）都走这里收尾
    try { rec.consumers.forEach((c) => c.close()); rec.transports.forEach((t) => t.close()); } catch (e) { /* 已关 */ }
    try { fs.unlinkSync(rec.file + '.sdp'); } catch (e) { /* 无所谓 */ }
    let size = 0;
    try { size = fs.statSync(rec.file).size; } catch (e) { /* 没落盘 */ }
    /* ★ 收尾 remux（Windows 实修）：实时流被强杀时 matroska 没机会写 trailer
     *   （ffprobe duration=N/A、不可 seek）。复制一份 -c copy 的 remux 毫秒级完成，
     *   补全 duration/cues。Linux 上 'q' 优雅退出后 remux 也无害。 */
    try {
      if (size > 0) {
        const fixed = rec.file + '.fix.' + (rec.file.endsWith('.mkv') ? 'mkv' : 'webm');
        require('child_process').execFileSync(FFMPEG_BIN,
          ['-y', '-loglevel', 'error', '-i', rec.file, '-c', 'copy', fixed], { stdio: 'ignore' });
        fs.renameSync(fixed, rec.file);
        size = fs.statSync(rec.file).size;
      }
    } catch (e) { /* remux 失败保留原文件（仍可流式播放） */ }
    recordSessions.delete(rec.id);
    console.log(`⏹ 录制结束 ${rec.id}（exit=${code}，${(size / 1024).toFixed(1)} KB）→ ${path.basename(rec.file)}`);
  });

  recordSessions.set(rec.id, rec);
  console.log(`⏺ 开始服务器录制 ${rec.id}（${label || ''}，${tracks.map((t) => t.kind).join('+')}，RTP 端口 ${basePort}+）`);
  return rec;
}

// 公共函数：结束一个房间的远程控制，并广播 remote-state 让全房 UI 复位
//   ▎谁调用：remote-release 事件 / 有人离开房间 / 房间销毁时
//   ▎★ A6 升级（2026-09-11）：现在还要
//     ① 清掉"限时授权"的定时器（否则到点会对着已结束的会话再清一次）；
//     ② 把"为什么结束"用 remote-ended 告诉当事双方（自己收回 / 超时 / 对方离开）——
//        客户端据此弹不同的提示（"已收回" vs "授权已到期"），体验才完整。
function clearRemoteCtl(roomNumber, reason = 'released') {
  const ctl = remoteCtl.get(roomNumber);
  if (!ctl) return false;               // 没有记录 = 本来就没人在控制，什么都不用做
  if (ctl.timer) clearTimeout(ctl.timer); // ★ A6：限时授权的定时器必须清（防幽灵定时器）
  remoteCtl.delete(roomNumber);
  const payload = { hostId: null, controllerId: null, expiresAt: null };
  io.to(roomNumber).emit('remote-state', payload);
  if (ctl.hostId && ctl.controllerId) {
    io.to(ctl.hostId).emit('remote-ended', { reason, hostId: ctl.hostId, controllerId: ctl.controllerId });
    io.to(ctl.controllerId).emit('remote-ended', { reason, hostId: ctl.hostId, controllerId: ctl.controllerId });
  }
  broadcastRoomState(roomNumber);       // ★ D4：被控/控制角标也是房间状态的一部分
  console.log(`🖱️ 房间 ${roomNumber} 的远程控制已结束（${reason}）`);
  return true;
}

/* ★ D4 升级（2026-09-11）：房间状态快照 —— "谁在房间里 + 各自什么状态"
 *
 * ▎为什么要有它？（面试可讲："状态放唯一权威处"）
 *   成员人数、谁静音、谁在共享、谁被谁控制，这些信息全房必须**完全一致**。
 *   如果让每个浏览器自己拼，一定会因为消息到达顺序不同而对不上（分布式系统的老问题）。
 *   服务器是房间里唯一的权威 → 由它算一份快照广播出去，前端只负责"照单渲染"。
 *
 * ▎为什么不直接用 room-members？分工不同：
 *   room-members = "我刚进房，该订阅谁"的一次性清单（带 Producer 明细，比较重）；
 *   room-state   = "每次变化就广播"的轻量快照（谁在、什么状态、谁在控制谁）。
 */
/* ══════════════════════════════════════════════════════════════
 * ★ 09-19 AI Bot 参会者（AI 主攻线·C 档落地第一站，零依赖）
 * ▎是什么：一个以"参会者"身份入会的 AI 助理——成员列表可见、能"听"整场会议、
 *   能在聊天里被提问。三部分：
 *   ① 身份：room.aiBot 布尔 → room-state 快照注入 isBot 虚拟成员（前端渲染 🤖 行）；
 *   ② 耳朵（服务端音频管线）：对房间每路音频 Producer 建 PlainTransport→consume→
 *      本机 ffmpeg(astats) 的 RTP 旁路——服务器第一次真正"拿到"会议音频字节流，
 *      每 2s 解析 RMS 分贝记 aiHearing（谁多大声）；将来 N2 真转写(Whisper/云 ASR)
 *      就在管线插转写器即可，管线不动；
 *   ③ 嘴巴（ai-ask 问答）：读感知数据（成员/talk-stats/字幕账本 jsonl/aiHearing）→
 *      有 DEEPSEEK_API_KEY 走真 LLM（零 SDK 纯 fetch），无 key/失败降级本地模板
 *      （答案带 [Mock] 前缀——AI 双轨约定），答案以 chat-message(from='ai-bot') 广播。
 * ▎纪律：bot 没有 socket——它不是 io 连接，只是房间记录上的状态 + 服务器自己的媒体
 *   管线；所有清理路径（ai-leave/断连/房间销毁/Producer 关闭）都要拆管线防泄漏。
 * ══════════════════════════════════════════════════════════════ */
const aiShortId = (id) => String(id).slice(-4); // AI 块内的短 id（server 没有 client 的 shortId，09-19 实修）
const aiHearing = new Map();          // roomNumber -> Map(memberId -> {rms, ts})（bot 的听觉账本）
const aiAudioPipes = new Map();       // roomNumber -> Set<管线对象>

/* ★ 09-24e 每房间一个"智能体"（检索索引 + 会话记忆）的生命周期管理
 * ▎为什么放在房间级而不是全局：会话记忆必须**按房间隔离**——两个人同时在两个房间
 *   问不同的问题，记忆串了就是灾难（AI 会把 A 房间的事答进 B 房间）。
 * ▎为什么必须清理：记忆和索引都占内存，房间销毁后不删就是慢性泄漏。
 *   清理点与 aiHearing/aiAudioPipes 完全一致（房间销毁 / bot 送走），**不能漏**。
 * ▎上限的意义：一场会开 3 小时能产生几千条字幕，索引是 O(词数) 的；
 *   教学规模下这完全没问题，但"知道它会涨、知道涨到哪"是工程素养。 */
const roomBrains = new Map();         // roomNumber -> Brain.RoomBrain

function getRoomBrain(roomNumber) {
  let b = roomBrains.get(roomNumber);
  if (!b) {
    const turns = Number(CONFIG.aiMemoryTurns) || 8;   // config 可调（长会想要更长的记忆就调大）
    const room = rooms.get(roomNumber);
    /* ★ 09-25 会议范围：下界 = **房间创建时刻**（本场会议开始）。
     *   ⚠️ 这里一开始写的是"助理入会时刻"，被真浏览器测试否掉了——
     *   助理中途被请进来时会对之前整场会一无所知（"这场会都定了什么"答"没提到"），
     *   等于请来一个废人。而当初要防的真正风险是**房间号回收复用**导致的跨会议串味，
     *   那用"房间创建时刻"就能根治。完整推演见 brain.js 的 scopeEntries 注释。 */
    b = new Brain.RoomBrain(turns, { since: (room && room.createdAt) || 0 });
    roomBrains.set(roomNumber, b);
    if (process.env.AI_DEBUG_SCOPE) {
      console.log(`[scope-debug] 新建 brain since=${b.since} (${b.since ? new Date(b.since).toISOString() : '不限'})`);
    }
  }
  return b;
}

// 房间销毁/助理送走时释放智能体（记忆清空是有意的：新一轮会 = 新对话，不该继承旧记忆）
function disposeRoomBrain(roomNumber) {
  roomBrains.delete(roomNumber);
}

/* ══════════════════════════════════════════════════════════════
 * ★ 09-25 AI 实时会议看板（Live Digest）—— 让助理"边听边干活"
 *
 * ▎要解决什么：在此之前 AI 是**纯被动**的（你不问它不说）。它虽自称"参会者"，
 *   但对会议内容零贡献——像个坐在角落、戳一下才答一句的记录员。
 *   现在它持续消化字幕，实时维护一块看板（决定/风险/行动项/议题），
 *   并在**值得开口时主动说话**（待认领的任务、新发现的风险）。
 *
 * ▎为什么"一直消化"而不是"AI 在场才消化"：
 *   看板是**会议级**产物，不是 AI 的私有状态——没有 AI 时它也照样有用。
 *   而且这样 AI 入会时看板已经攒好了内容，不存在"冷启动空白期"。
 *   （与「会话范围」不冲突：那是**问答检索**的范围，管的是"我听过什么"；
 *     看板管的是"这场会里有什么"。一个约束证据来源，一个呈现会议事实。）
 *
 * ▎为什么广播要"有变化才发"：同 net-levels/talk-stats 的取舍——省信令、不闪屏。
 *   一条字幕没抽出新东西就不发，房间安静时看板也不会抖。
 * ══════════════════════════════════════════════════════════════ */
const roomBoards = new Map();          // roomNumber -> Digest.Digest
const AI_SPEAK_COOLDOWN_MS = 45000;    // AI 主动发言的最小间隔（同一条问题不追问）

function getRoomBoard(roomNumber) {
  let b = roomBoards.get(roomNumber);
  if (!b) {
    b = new Digest.Digest({ maxPerKind: Number(CONFIG.aiBoardMaxPerKind) || 20 });
    roomBoards.set(roomNumber, b);
  }
  return b;
}
function disposeRoomBoard(roomNumber) {
  roomBoards.delete(roomNumber);
}

/* AI 主动发言：**只在"有人需要知道"时才开口**，且严格节流。
 *
 * ▎产品判断（这一段是设计意图，不是技术细节）：一个会不停插话的 AI 比不说话更糟。
 *   所以开口的门槛设得很高——只报两类「不提醒就会有损失」的事：
 *     ① 出现**没人认领的行动项**（会上承诺了，但没人接 → 会后必然烂尾）
 *     ② 出现**新的风险点**（来不及/阻塞 → 越早知道越好）
 *   决定与议题**只进看板不发言**：它们是存档性质的，不需要打断会议。
 *
 * ▎为什么要节流：规则抽取难免偶有误报，若不限速，三五条误报连成一串就成了刷屏机器人。
 *   45s 冷却 + 每次只说**一条**（挑最新最要紧的那条），把噪声压到可接受。
 */
function maybeAiSpeakUp(roomNumber, added) {
  const room = rooms.get(roomNumber);
  if (!room || !room.aiBot) return;                     // 助理不在场就不说话（它得有"嘴"）
  const now = Date.now();
  if (room.aiLastSpeakAt && now - room.aiLastSpeakAt < AI_SPEAK_COOLDOWN_MS) return;

  // 挑一条最值得说的：**无主行动项**优先于风险（前者需要有人立刻行动）
  const unowned = (added.todo || []).filter((t) => !t.owner);
  const risk = (added.risk || [])[0];
  let text = null;
  if (unowned.length) {
    const t = unowned[unowned.length - 1];
    text = `📌 我记到一条行动项还没有负责人：**${t.task}**${t.due ? `（${t.due}）` : ''}——谁来认领？`;
  } else if (risk) {
    text = `⚠️ 我记到一个风险点：**${risk.text}**`;
  }
  if (!text) return;

  room.aiLastSpeakAt = now;
  emitBotSay(roomNumber, text);
  logEvent('info', 'ai-proactive-say', { roomNumber, kind: unowned.length ? 'unowned-todo' : 'risk' });
}

/* 消化一批新到的字幕（由 /api/captions 入库后调用）。
 * 纯 CPU、毫秒级、无 IO——所以可以每批都跑，不做额外节流。
 * @returns {{addedCount:number}|null} null = 该房间还没建看板（不强制创建，省内存） */
function feedBoard(roomNumber, entries) {
  const room = rooms.get(roomNumber);
  if (!room) return null;                 // 房间已销毁/号码回收：不消化（否则会凭空造一个孤儿看板）
  const board = roomBoards.get(roomNumber) || getRoomBoard(roomNumber);
  const r = board.ingest(entries);
  if (!r.addedCount) return r;            // 没抽出新东西 → 不广播（"有变化才发"）
  io.to(roomNumber).emit('ai-board', {
    ...board.snapshot(),
    added: r.added,                        // ★ 增量（前端据此做"新条目高亮"，全量在 items 里）
    ts: Date.now(),
  });
  logEvent('info', 'ai-board-update', { roomNumber, added: r.addedCount, total: r.total });
  maybeAiSpeakUp(roomNumber, r.added);
  return r;
}

// 单路音频管线：PlainTransport 把这路音频 RTP 推给本机 ffmpeg，astats 每 ~2s 吐一次 RMS
async function startAiAudioPipe(roomNumber, producer, memberId) {
  const room = rooms.get(roomNumber);
  if (!room || !room.router) return;
  try {
    const used = new Set([...(aiAudioPipes.get(roomNumber) || [])].map((x) => x.port));
    let port = 51000;
    while (used.has(port)) port += 2;
    if (port > 51998) return; // 端口段用尽（教学规模到不了）
    const t = await room.router.createPlainTransport({ listenIp: { ip: '127.0.0.1' }, rtcpMux: true, comedia: false });
    await t.connect({ ip: '127.0.0.1', port });
    const c = await t.consume({ producerId: producer.id, rtpCapabilities: room.router.rtpCapabilities });
    await c.resume(); // 坑 13①：Consumer 建完必须 resume
    // ffmpeg：按 SDP 收 RTP → astats 量响度（不落盘，落盘是 D+2 录制的职责）→ 输出丢弃
    const sdp = ['v=0', 'o=- 0 0 IN IP4 127.0.0.1', 's=ai-hear', 't=0 0',
      sdpMediaSection(c, 'audio', port)].join('\r\n');
    const sdpFile = path.join(LOGS_DIR, `ai-${roomNumber}-${producer.id}.sdp`);
    fs.writeFileSync(sdpFile, sdp);
    const proc = require('child_process').spawn(FFMPEG_BIN, [
      '-loglevel', 'error', '-protocol_whitelist', 'file,udp,rtp',
      '-fflags', '+genpts', '-i', sdpFile,
      '-af', 'astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level',
      '-f', 'null', '-',
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    let buf = '';
    proc.stderr.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/RMS_level=(-?\d+\.?\d*)/g);
      if (!m) return;
      if (buf.length > 8192) buf = buf.slice(-4096); // 防 stderr 积压
      const rms = parseFloat(m[m.length - 1].split('=')[1]);
      if (Number.isNaN(rms)) return;
      if (!aiHearing.has(roomNumber)) aiHearing.set(roomNumber, new Map());
      aiHearing.get(roomNumber).set(memberId, { rms, ts: Date.now() }); // bot 听见：某人当前 -xx dB
    });
    // 被跟的 Producer 关闭（关麦克风/断线）→ 收掉 ffmpeg（exit 回调统一清理管道）
    c.on('producerclose', () => { try { proc.kill(); } catch (e) { /* 已退 */ } });
    const pipe = { transport: t, consumer: c, proc, memberId, producerId: producer.id, port, sdpFile };
    if (!aiAudioPipes.has(roomNumber)) aiAudioPipes.set(roomNumber, new Set());
    aiAudioPipes.get(roomNumber).add(pipe);
    proc.on('exit', () => {
      const set = aiAudioPipes.get(roomNumber);
      if (set) set.delete(pipe);
      try { c.close(); t.close(); } catch (e) { /* 已关 */ }
      try { fs.unlinkSync(sdpFile); } catch (e) { /* 无所谓 */ }
    });
    console.log(`🤖 AI 管线：${aiShortId(memberId)} 的音频 → astats（端口 ${port}）`);
  } catch (err) {
    console.log(`🤖 AI 管线启动失败（${err.message}）——bot 听觉降级为音量事件（AudioLevelObserver）`);
  }
}

// 停掉某房间全部 AI 管线
function stopAiAudioPipeline(roomNumber) {
  const set = aiAudioPipes.get(roomNumber);
  if (!set) return;
  for (const pipe of set) {
    try { pipe.proc.stdin.write('q\n'); } catch (e) { /* 已退 */ }
    try { setTimeout(() => { try { pipe.proc.kill(); } catch (e) { /* 已退 */ } }, 1500); } catch (e) { /* */ }
  }
  aiAudioPipes.delete(roomNumber);
  aiHearing.delete(roomNumber);
}

/* ★ 09-25 「AI 助手参加会议」补完：入会/离会要**有声音**。
 *
 * ▎改造前是什么样：点「🤖 AI 助理」只改了 room.aiBot + 广播一份快照 + 记一条 logEvent。
 *   成员列表里**悄悄多了一行**"聆听中…"，聊天区一个字都没有。
 *   用户的真实困惑是："我点了按钮，它到底来没来？它能听见吗？我能问它什么？"
 *   现在的做法：以**参会者身份说第一句话**——报出"我是谁、我听得到什么、怎么用我"。
 *
 * ▎为什么这不是"装饰"：这是把 AI 的**能力边界**在入会那一刻交代清楚。
 *   AI 产品最大的信任问题是"用户以为它什么都会"（然后失望）；
 *   入会时明说"我只听得见音频、我看不到你屏幕"，反而让后续的诚实体感成立。
 *
 * ▎听觉状态为什么由服务器**实测**而不是写死一句话：
 *   听觉有两条真实降级路径（ffmpeg 缺失 / 管线建失败），盲写"我能听见"就是在撒谎。
 *   所以这里数一遍**真实建成的管线数**，如实报出来——这是"诚实 UI"落到最外层的一处。
 */
function aiHearingStatus(roomNumber) {
  const room = rooms.get(roomNumber);
  const pipes = aiAudioPipes.get(roomNumber);
  const live = pipes ? pipes.size : 0;
  // 在场有麦克风的人（静音的不算——他不推音频流，bot 客观上听不见）
  const talkers = room
    ? [...room.members].filter((m) => m.producers && [...m.producers.values()].some((p) => p.kind === 'audio')).length
    : 0;
  return { live, talkers, degraded: live === 0 && talkers > 0 };
}

/* ★ 09-25 入会/离会事件以"参会者发言"的形式广播。
 * ▎为什么用 chat-message 而不是新事件：聊天台账已有的去重/导出/离线补帧
 *   都能直接复用（AGENTS 坑里反复出现的教训：能复用既有通路就别开新协议）。
 * ▎from 用 'ai-bot' 保持一致 → 前端气泡走既有的"机器同事"样式，无需新增分支。 */
function emitBotSay(roomNumber, text, extra) {
  io.to(roomNumber).emit('chat-message', {
    from: 'ai-bot', name: '🤖 AI 小明', text, ts: Date.now(),
    ...(extra || {}),
  });
}

// bot 开/关（幂等）：改房间状态 + 拆/建管线 + 广播快照
/* @param {Object} [opts] { quiet:true } = 不说入会致辞（用于 ai-ask 的自动入会）
 *
 * ▎quiet 为什么必需（这是本轮自己的端到端测试抓出来的真实缺陷）：
 *   ai-ask 在 bot 缺位时会**自动入会**，而自动入会会广播一条"大家好，我入会了"。
 *   用户的第一句话如果是 "@ai 交付时间是什么时候"，真实序列就是：
 *       入会致辞（先） → 检索（后，要等模型 2~5 秒） → 答案
 *   于是用户先看到一段与自己问题无关的寒暄。更糟的是**任何按"最后一条 ai-bot 消息"
 *   取答案的调用方（含本次的验证脚本）都会抓到那段寒暄**——症状是"AI 答非所问"，
 *   看起来像检索坏了，实际是两件事在同一个信道上抢跑。
 *   这属于典型的"两个都正确的功能叠加出错误行为"，所以要在源头分开：
 *   **被邀请就致辞（人主动请它），被顺带拉起就不致辞（人着急要答案）。** */
function setAiBot(roomNumber, on, opts = {}) {
  const room = rooms.get(roomNumber);
  if (!room) return null;
  const was = !!room.aiBot;
  room.aiBot = !!on;
  if (on) {
    /* ★ 09-25：这里原先会记 room.aiJoinedAt（检索范围的时间下界）。
     *   现在下界改为"房间创建时刻"，不再需要按入会时刻记账——
     *   助理中途入会也能答本场会的全部内容（见 getRoomBrain 的注释与 brain.js 的推演）。 */

    // 把当前所有音频路喂给管线（bot 入会晚了也能"听见"在场的每个说话人）
    for (const [pid, owner] of room.producerOwner) {
      const sock = [...room.members].find((m) => m.id === owner);
      const producer = sock && sock.producers && sock.producers.get(pid);
      if (producer && producer.kind === 'audio') startAiAudioPipe(roomNumber, producer, owner);
    }
    // ★ 09-26d 冷场暖场：AI 在场且 warmOn（默认开）时，10 分钟没人说话就主动说一句
    if (!room.warmTimer) {
      room.lastActivity = Date.now();
      room.warmOn = true;
      room.warmTimer = setInterval(async () => {
        const r = rooms.get(roomNumber);
        if (!r || !r.aiBot || !r.warmOn) return;
        if (Date.now() - (r.lastActivity || 0) < AI_WARM_MS) return;
        r.lastActivity = Date.now(); // 触发后复位，下一轮重新计时
        try {
          const caps = loadCaptions(roomNumber).slice(-5);
          let line;
          if (AI.aiEnabled() && caps.length) {
            try {
              const res = await fetch('https://api.deepseek.com/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
                body: JSON.stringify({
                  model: 'deepseek-chat', temperature: 0.8,
                  messages: [
                    { role: 'system', content: '你是会议 AI 助理小明。会议冷场了，根据最近的发言内容说一句自然的暖场话（不超过40字）：或邀请大家补充、或抛个小问题、或小结一下。直接输出这句话本身，不要引号。' },
                    { role: 'user', content: '最近发言：' + (caps.map((e) => `${e.name}：${e.text}`).join('；') || '（还没人发言）') },
                  ],
                }),
              });
              if (res.ok) line = (await res.json()).choices[0].message.content.trim();
            } catch (e) { /* 降级模板 */ }
          }
          if (!line) {
            line = caps.length
              ? `刚才聊到「${(caps[caps.length - 1].text || '').slice(0, 24)}」，大家继续呀——有结论了吗？`
              : '大家随便聊聊，我一直都在听～（提到「小明」我就会回答）';
          }
          io.to(roomNumber).emit('chat-message', { from: 'ai-bot', name: '🤖 AI 小明', text: line, ts: Date.now() });
          io.to(roomNumber).emit('ai-state', { state: 'speaking', text: line });
          setTimeout(() => io.to(roomNumber).emit('ai-state', { state: 'idle' }), Math.min(9000, 2500 + line.length * 80));
          logEvent('info', 'ai-warmup', { roomNumber });
        } catch (e) { /* 暖场失败静默，下轮再试 */ }
      }, 60000);
    }
    // ★ N2：值守分段纪要定时器（bot 在场才挂；interval = config.minutesIntervalSec，默认 1h）
    if (!room.minutesTimer) {
      const sinceMark = { ts: Date.now() }; // 每段只统计上一段之后的新字幕
      room.minutesTimer = setInterval(async () => {
        try {
          const r = await buildMinutes(roomNumber, { type: 'segment', since: sinceMark.ts });
          sinceMark.ts = Date.now();
          io.to(roomNumber).emit('chat-message', {
            from: 'ai-bot', name: '🤖 AI 小明',
            text: `🌙 值守分段纪要已生成：${r.path}（${r.mock ? '[Mock] ' : ''}本段 ${r.markdown.includes('（本时段没有字幕记录）') ? '无字幕' : '已汇总'}）`,
            ts: Date.now(),
          });
        } catch (e) { /* 定时纪要失败不打断值守，下一轮再试 */ }
      }, MINUTES_INTERVAL_MS);
    }
    /* ★ 09-25 入会致辞（仅在**首次**入会、且**不是**被 ai-ask 顺带拉起时说）。
     *   内容分三层：① 报到（我来了，以什么能力）；② 听觉实况（我能听见谁，或为什么听不见）；
     *   ③ 用法（@ai 提问 / @ai 纪要）——最后一层最重要：不说用户根本不知道该干什么。
     *   quiet=true 时跳过：见 setAiBot 的 @param 注释（避免寒暄与答案抢道）。 */
    if (!was && !opts.quiet) {
      const h = aiHearingStatus(roomNumber);
      const hear = h.degraded
        ? '⚠️ 但本机 ffmpeg 不可用，我暂时**听不见**音频——字幕转写若不开启，我只能靠已有字幕作答。'
        : h.talkers === 0
          ? '房间里现在还没人开麦，等有人说话我就能听见。'
          : `已接入 ${h.live || h.talkers} 路音频，能听见正在说话的各位。`;
      emitBotSay(roomNumber,
        `👋 大家好，我是会议 AI 助理，已作为参会者入会。\n`
        + `${hear}\n`
        + `我能做：在聊天里说 **@ai 你的问题**（我基于**本场会议**的内容作答，并会标出检索到哪几条）；`
        + `说 **@ai 生成纪要** 我整理成 markdown；字幕开启时我的"听力"最完整。`);
      logEvent('info', 'ai-join-ceremony', {
        roomNumber, pipes: h.live, talkers: h.talkers, degraded: h.degraded,
      });
    }
  } else {
    // ★ 09-25 离会告别（送出终稿是一件"耗时的事"，先说话再干活，用户不用干等）
    if (was) {
      emitBotSay(roomNumber, '👋 好的，我先退会了。正在把本次会议沉淀成终稿纪要……');
    }
    stopAiAudioPipeline(roomNumber);
    // ★ N2：送走 bot = 值守段落结束 → 清定时器 + 出终稿（异步落盘，不阻塞信令）
    if (room.warmTimer) { clearInterval(room.warmTimer); room.warmTimer = null; } // ★ 09-26d 暖场定时器一并清
    if (room.minutesTimer) { clearInterval(room.minutesTimer); room.minutesTimer = null; }
    buildMinutes(roomNumber, { type: 'final' }).then((r) => {
      if (!was || !r) return;
      emitBotSay(roomNumber,
        `📋 终稿纪要已生成：${r.path}${r.mock ? '（[Mock] 本地模板）' : '（DeepSeek 撰写）'}`
        + `${r.actions && r.actions.length ? `，含 ${r.actions.length} 条行动项` : ''}。`
        + '需要我再参会随时点 🤖。');
    }).catch(() => {});
    // ★ 09-24e：送走助理 = 本轮对话结束 → 清会话记忆（下一轮重新开始，不继承旧上下文）
    disposeRoomBrain(roomNumber);
  }
  broadcastRoomState(roomNumber);
  logEvent('info', on ? 'ai-join' : 'ai-leave', { roomNumber });
  return room.aiBot;
}

/* AI 大脑 ★ 09-24e 重构：从「关键词模板 + 最近 8 条字幕」升级为
 *   **检索增强（RAG）+ 多轮记忆 + LLM 意图分类**。三者都走 brain.js（可单测的纯逻辑层）。
 *
 * ▎改造前的两个真实缺陷（都在本节被修掉）：
 *   ① **上下文失明**：老代码 `capTail.slice(-8)` 只把最后 8 条字幕喂给模型 →
 *      会议第 3 分钟说的"交付时间 11 月 20 日"，到第 38 分钟问就答不出来。
 *      现在：`Brain.RoomBrain` 对**全档字幕**建 BM25 索引，按问题检索出最相关的 6 条。
 *   ② **动作型意图靠正则**：老代码 `/纪要|会议总结|总结一下|摘要|行动项|待办清单/.test(q)`，
 *      用户说"帮我整理下今天聊了啥"就匹配不上 → 走闲聊分支 → **纪要根本没生成**，
 *      AI 却回了一段"好的我来整理"的漂亮话。这是最恶劣的缺陷：用户以为做成了。
 *      现在：`Brain.classifyIntent`（有 key 交给 LLM 分类，无 key 走扩展规则 + 同义词典）。
 *
 * ▎返回值向后兼容：仍是 { text, mock, usage, ms, ... }，另**新增** hits/turns/intent，
 *   供 UI 摊开"这条答案是检索自哪几条字幕"（把智能做成可验证的，而不是让它变成玄学）。
 */
async function aiBrain(roomNumber, question, onDelta) {
  const room = rooms.get(roomNumber);
  const members = room ? [...room.members] : [];
  const talkRows = room ? [...room.talk.entries()].sort((a, b) => b[1] - a[1]) : [];
  const talkTxt = talkRows.slice(0, 3).map(([id, v], i) =>
    `${i + 1}. ${aiShortId(id)} 发言约 ${Math.round(v)}s`).join('；') || '（还没有发言统计）';
  const dur = room ? Math.round((Date.now() - room.createdAt) / 60000) : 0;

  const q = String(question || '');

  /* ── ① 意图分类（tools-first 的推广：先判断"这句话想让我做什么"）──
   * 为什么放在最前面：动作型意图必须走**不同的代码路径**（落盘 / 授权），
   * 一旦误判成闲聊，能力与动作就错位了（AGENTS 坑 38 的同类问题）。 */
  const cls = await Brain.classifyIntent(q);
  const intent = cls.intent;

  if (intent === 'minutes') {
    const isFinal = /终稿|最终|结束|归档/.test(q);
    const r = await buildMinutes(roomNumber, { type: isFinal ? 'final' : 'segment' });
    const picks = (r.markdown.split('## 行动项')[1] || r.markdown.split('## 关键句节选')[1] || '')
      .split('\n').filter((l) => l.startsWith('- ')).slice(0, 3).join('；');
    return {
      text: `纪要已生成：${r.path}${r.mock ? '（[Mock] 本地模板）' : '（LLM 撰写）'}${picks ? ' —— 要点节选：' + picks : ''}`,
      mock: r.mock, file: r.file, path: r.path, usage: { totalTokens: 0 }, intent,
    };
  }

  /* ── ② 取全档字幕 + 走检索型问答 ──
   * `entries` 来自 loadCaptions（服务器权威 jsonl 副本），是全量、按时间排序的。
   * RoomBrain 按**会话范围**（入会之后，见 scopeEntries）过滤后建索引，
   * 并把检索结果拼成"证据块"喂模型。 */
  const entries = loadCaptions(roomNumber);
  const brain = getRoomBrain(roomNumber);
  let extraContext = `会议时长约 ${dur} 分钟，${members.length} 人在线。发言统计：${talkTxt}`
    + (intent === 'recap' ? '\n（用户想回顾刚才讨论的内容，请按时间线归纳，不要生成正式纪要文档。）' : '');

  /* ★ 09-25：问"决定/待办/风险"这类**结构化问题**时，把看板已抽好的条目作为证据一起给模型。
   * ▎为什么必须这么做（真浏览器测试暴露）：问「这场会都定了什么？」时，
   *   光标字幕 BM25 只捞到"采用 A 方案"，**另一条决定（交付时间）就漏了** ——
   *   答案"答不全"，而这类问题的答案本该是**完整枚举**。
   *   而完整清单**本来就已经抽好了**（就是用户在看板上看到的那几条），
   *   直接交给模型即可，不该再赌检索。
   * ▎副作用是好的：用户看到的看板 = AI 回答的依据，两者**不可能不一致**。 */
  const probes = Digest.probeBoard(q);
  /* ★ 09-25 证据链必须**如实**（真浏览器截图暴露的问题）：
   *   改造后问「这场会都定了什么？」时，气泡里"看 AI 依据的 2 条原话"展开却是
   *   「李四午饭吃什么」——因为那一栏此前固定显示 BM25 检索命中，
   *   而这次答案其实**几乎完全来自看板**（BM25 那几条只是陪衬）。
   *   于是界面在无声地撒谎：它指着一句闲聊说"这是 AI 回答的依据"。
   *   用户的信任就是这么丢的——比"不显示证据"更糟（那是误导）。
   *   → 规则改为：**哪个来源真的驱动了答案，就展示哪个**。
   *     注入了看板证据 → 展示看板条目；没有 → 才展示检索命中的字幕。 */
  let boardEvidence = [];
  if (probes.length) {
    const board = roomBoards.get(roomNumber);
    if (board) {
      const parts = probes.map((k) => Digest.renderBoardEvidence(board.items[k], k));
      extraContext += '\n\n' + parts.join('\n\n')
        + '\n（以上是系统已从本场会议中结构化抽取的内容，请**完整**据此回答，不要遗漏其中的条目。）';
      // 用于证据链展示：与注入给模型的**同一份**条目（不是另取一次，避免两处不一致）
      boardEvidence = probes.flatMap((k) =>
        board.items[k].map((it) => ({ name: it.name, text: it.task || it.text, src: '看板' })));
      if (process.env.AI_DEBUG_SCOPE) console.log(`[board-evidence] probes=${probes.join(',')} 注入 ${parts.join('').length} 字`);
    }
  }

  const r = await brain.answer(q, entries, { extraContext, onDelta, topK: 6 });
  if (process.env.AI_DEBUG_SCOPE) {
    console.log(`[scope-debug] answer since=${brain.since ? new Date(brain.since).toISOString() : 0} 全档=${entries.length} 范围内=${r.totalDocs} scoped=${r.scoped}`);
  }

  return {
    text: (r.mock && AI.aiEnabled() === false ? '[Mock] ' : '') + r.text,
    mock: r.mock, usage: r.usage, ms: r.ms, reason: r.reason,
    hits: r.hits, usedHits: r.usedHits, totalDocs: r.totalDocs, turns: r.turns, intent,
    scoped: r.scoped, allDocs: r.allDocs,
    /* ★ 09-25：多查询改写信息必须**在包装层透传**，否则底层算出来了、
     *   上层证据链却读不到（实测就是这么红的：AI 答对了，但证据链没披露"我改写过"）。
     *   这类"内层有、外层没带出来"的漏接，是包装层最典型的失误。 */
    rewrites: r.rewrites,
    evidence: boardEvidence.length ? boardEvidence : (r.hits || []).map((h) => ({ name: h.name, text: h.text, src: '字幕' })),
  };
}

/* ══════════════════════════════════════════════════════════════
 * ★ 09-19g C1 AI 远程操作员（模块级：botSocket / 计划 / 执行器）
 * ▎步骤间隔与总时长可用环境变量调（测试 AI_OP_STEP_MS=20 加速）。
 * ▎Mock 桌面坐标按 workbench.html 的伪桌面布局（计算器图标在最左上）校准；
 *   被控端视口不同会有偏差——教学演示前可在 1280×800 视口校一遍。
 * ══════════════════════════════════════════════════════════════ */
const AI_OP_STEP_MS = Number(process.env.AI_OP_STEP_MS) || 600;
const AI_WARM_MS = (Number(process.env.AI_WARM_SEC) || 600) * 1000; // ★ 09-26d 冷场阈值（默认 10 分钟无发言→AI 主动暖场）
const AI_OP_MAX_MS = Number(process.env.AI_OP_MAX_MS) || 30000;
let aiOpBusy = false;      // 全服务器同一时刻只跑一个 AI 操作任务（简单互斥）
let aiOpSocket = null;     // AI 的"真实控制端"连接（连自己的信令端口）

function ensureAiOpSocket() {
  // ★ 09-19g 实修：每个任务用**全新连接**——复用旧连接会把上一轮的房间状态/监听
  //   带进来（重跑时 remote-request 迷路）。一次 TCP 握手 ~50ms，演示无感。
  if (aiOpSocket) { try { aiOpSocket.disconnect(); } catch (e) { /* 已断 */ } }
  // socket.io-client 已在 devDependencies（压测/测试都在用）——不引新依赖
  const { io: ioClient } = require('socket.io-client');
  aiOpSocket = ioClient(`http://127.0.0.1:${PORT}`, { transports: ['websocket'], reconnection: false });
  return aiOpSocket;
}
const aiSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 16 字节控制帧（与客户端 encodeCtlFrame 同一格式，DataView 默认大端 → Buffer 用 *BE）
function ctlFrame(kindId, x, y, flags = 0) {
  const b = Buffer.alloc(16);
  b.writeUInt8(kindId, 0);
  b.writeUInt8(flags, 1);
  b.writeUInt16BE(0, 2);
  b.writeFloatBE(x, 4);
  b.writeFloatBE(y, 8);
  b.writeInt32BE(0, 12);
  return b;
}
const KIND = { move: 3, down: 4, up: 5, dblclick: 6, wheel: 7 };

// 把"操作计划"翻译成 remote-input 序列并发送（工具层：click/type/key/dblclick/scroll）
function aiInput(sock, step) {
  const emit = (data) => sock.emit('remote-input', { to: step._to, event: data });
  switch (step.op) {
    case 'move': emit(ctlFrame(KIND.move, step.x, step.y)); break;
    case 'click':
      emit(ctlFrame(KIND.move, step.x, step.y));
      emit(ctlFrame(KIND.down, step.x, step.y, 0));
      emit(ctlFrame(KIND.up, step.x, step.y, 0));
      break;
    case 'dblclick':
      emit(ctlFrame(KIND.move, step.x, step.y));
      emit(ctlFrame(KIND.dblclick, step.x, step.y, 0));
      break;
    case 'type': emit({ kind: 'input-text', text: String(step.text || '') }); break;
    case 'key':
      emit({ kind: 'keydown', key: step.key, code: step.code || step.key });
      emit({ kind: 'keyup', key: step.key, code: step.code || step.key });
      break;
    case 'scroll': emit(ctlFrame(KIND.wheel, step.x || 0.5, step.y || 0.5)); break;
    default: throw new Error(`未知操作 ${step.op}`);
  }
}

// Mock 计划：目标关键词 → 确定性操作序列（LLM 不可用时的兜底，也是回归测试的固定路径）
function mockPlan(goal) {
  const g = String(goal || '');
  if (/计算器|calc|按.*7|乘/i.test(g)) {
    return [
      { op: 'move', x: 0.5, y: 0.5 },
      { op: 'dblclick', x: 0.045, y: 0.09 },   // 双击桌面"计算器"图标（workbench 最左上）
      { op: 'wait', ms: 900 },
      { op: 'click', x: 0.272, y: 0.238 },     // 计算器按钮 7
      { op: 'click', x: 0.318, y: 0.238 },     // 8
      { op: 'click', x: 0.341, y: 0.352 },     // =
    ];
  }
  if (/画|线|drag/i.test(g)) {
    return [
      { op: 'move', x: 0.35, y: 0.5 }, { op: 'move', x: 0.4, y: 0.52 },
      { op: 'click', x: 0.4, y: 0.52 }, { op: 'move', x: 0.6, y: 0.6 },
    ];
  }
  return [
    { op: 'move', x: 0.3, y: 0.3 }, { op: 'move', x: 0.6, y: 0.5 },
    { op: 'dblclick', x: 0.045, y: 0.09 }, { op: 'wait', ms: 800 },
    { op: 'type', text: 'AI 远程操作演示' },
  ];
}

// LLM 计划（有 key 才走）：把目标翻成操作 JSON；失败抛错由调用方降级 Mock
async function llmPlan(goal) {
  const tools = '可用操作（JSON 数组，每项 {op,x?,y?,text?,key?,ms?}）：' +
    'move{x,y} click{x,y} dblclick{x,y}（坐标 0~1 归一化，桌面计算器图标≈{0.045,0.09}）' +
    'type{text} key{key} wait{ms}。最多 12 步。';
  // ★ 09-24：改走统一 provider（自带 json 围栏清理 / 超时 / 降级），mock 钩子直接抛错
  //   ——本函数的契约就是"拿不到 LLM 计划就抛"，降级交给调用方走 mockPlan（保持原设计）。
  const res = await AI.askLLM([
    { role: 'system', content: '你是远程桌面 AI 操作员。只输出一个 JSON 数组（不要任何其他文字），表示完成目标的鼠标/键盘操作序列。' },
    { role: 'user', content: `${tools}\n目标：${goal}` },
  ], { label: 'ai-op-plan', temperature: 0.2, timeoutMs: 20000, json: true, mock: () => { throw new Error('LLM 不可用'); } });
  if (res.mock) throw new Error(res.reason || 'LLM 不可用');
  const plan = JSON.parse(res.text);
  if (!Array.isArray(plan)) throw new Error('LLM 计划不是数组');
  return plan.slice(0, 12);
}

// 主流程：连入 → join-room → remote-request（真实授权）→ 执行 → release
/* ══════════════════════════════════════════════════════════════
 * ★ 09-24e AI 操作员 ReAct 闭环（Observation 回环——把"开环脚本"变成"闭环智能体"）
 *
 * ▎改造前的真实状态（原注释自己都写着"教学版留作升级点"）：
 *     先让 LLM 一次性吐一个 12 步计划，然后**闷头执行完**，中间不看结果。
 *   这不是 agent，这是"录制好的宏"。后果很具体：
 *     · LLM 把计算器图标坐标猜成 {0.05, 0.10}（略偏 5 像素）→ 双击点到空白桌面 → 后面 5 步
 *       全在对着空气点 → 任务失败，但 AI 最后会报"🏁 任务完成"。**报成功而实际失败**，
 *       比报错还糟：用户不知道要重试。
 *
 * ▎ReAct 的本质 = Reason(想) → Act(做) → **Observe(看)** → 再 Reason。
 *   缺了 Observe，就退化成"一次性规划 + 盲执行"。所以闭环的关键是：**每步之后必须拿到反馈**。
 *
 * ▎Observation 从哪来（诚实版：我们没有给 AI 装眼睛，也**不假装有**）：
 *   先说我**试过并否掉**的方案，以及为什么——这段比结论更有价值：
 *     ❌ 加 `remote-input-ack`（被控端收到就回执）→ 我一度这么写了，然后 grep 全仓库发现
 *        **这个事件根本不存在**（客户端收了 remote-input 从不回 ack）。基于不存在的事件写闭环，
 *        ack 永远为 0 → 永远误判"帧未送达" → AI 会疯狂重试。**未经验证的假设必须被证伪**，
 *        这是本项目反复踩到的同一类坑（AGENTS 坑 40）。
 *     ❌ 让服务端截图 → 截图能力在**控制端浏览器**里（client.js 的 peerScreens 抓 video 帧），
 *        服务端拿不到；新增"服务端要截图"协议会破坏零协议改动前提。
 *   最终采用**服务端确实能 100% 确定的三类观测**（够用，且不含一丝编造）：
 *     ① **转发门禁结果**：服务器转发 remote-input 时会判定"目标是否还在房间"——
 *        转发成功 / 目标不在（帧被丢弃）是**服务器自己算出来的事实**，比页面回执更可靠；
 *     ② **控制权状态**：remoteCtl 是否还持有、剩余授权时长——授权被收回时立刻停手；
 *     ③ **执行轨迹**：已发操作的坐标与文本（服务器自己记的，必然准确）。
 *   把这三样拼成观察文本喂回 LLM，让它判断：目标达成了吗？坐标要不要修正？
 *   这是"在能力边界内做到真反馈"，而不是宣称"AI 能看见屏幕"——**能说清边界**才是工程。
 *
 * ▎降级纪律（三档，全部要能用）：
 *   真 LLM + 转发观测 → 真闭环 ReAct（每步后问模型"要不要调整"）
 *   无 key           → 开环 mock 计划 + 本地转发结果校验（送不到就明确报"未送达"）
 *   观测拿不到       → 退回开环，但**结论如实标注**（见下方 doneReport 的三种措辞）
 * ══════════════════════════════════════════════════════════════ */

/** LLM 基于"已有观察"决定下一步：这是 ReAct 的 Reason 位（与初始规划分开：规划是无观察的推理） */
async function llmReact(goal, done, observation) {
  const res = await AI.askLLM([
    {
      role: 'system',
      content: '你是远程桌面 AI 操作员，正在用鼠标键盘完成目标。'
        + '我会给你【已执行的操作】和【最新观察结果】。判断：目标达成了吗？需要修正吗？'
        + '只输出一个 JSON 对象，不要任何其他文字：'
        + '{"done":true|false,"next":[操作数组],"reason":"一句话说明"}。'
        + 'next 里的操作格式与规划相同：{op:"move|click|dblclick|type|key|wait",x?,y?,text?,key?,ms?}。'
        + '坐标是 0~1 归一化。如果观察显示上一步没送达或被丢弃，next 里就给**修正后**的操作。'
        + 'done 为 true 时 next 留空数组。',
    },
    { role: 'user', content: `目标：${goal}\n\n已执行的操作：\n${done}\n\n最新观察结果：\n${observation}` },
  ], {
    label: 'ai-op-react', temperature: 0.2, timeoutMs: 20000, maxTokens: 400, json: true,
    mock: () => { throw new Error('LLM 不可用'); },   // 契约与 llmPlan 一致：拿不到就抛，降级交调用方
  });
  if (res.mock) throw new Error(res.reason || 'LLM 不可用');
  const j = JSON.parse(res.text);
  return {
    done: j.done === true,
    next: Array.isArray(j.next) ? j.next.slice(0, 4) : [],   // 修正步数也要有上限，防"越修越多"
    reason: String(j.reason || '').slice(0, 160),
  };
}

/** 收集当前可用的 Observation（拿不到的一律如实写"不可得"，绝不编造状态） */
function collectObservation(roomNumber, step, delivery, executed) {
  const ctl = remoteCtl.get(roomNumber) || {};
  const parts = [];
  // ① 转发结果：服务器自己算出来的事实（不是猜的）
  parts.push(delivery.forwarded
    ? '输入投递：上一步已由服务器**成功转发给被控端**（目标在线）'
    : '输入投递：**转发失败——被控端不在房间，这一步的输入被丢弃，等于没点**');
  // ② 控制权
  parts.push(`控制权：${ctl.controllerId ? `仍持有（约剩 ${Math.max(0, Math.round(((ctl.expiresAt || 0) - Date.now()) / 1000))}s）` : '**已被收回**'}`);
  // ③ 执行轨迹（服务器自己记的，必然准确）
  parts.push(executed.length
    ? `已执行轨迹：${executed.slice(-6).join(' → ')}`
    : '已执行轨迹：（尚无）');
  parts.push(`刚执行的操作：${step.op}${step.x !== undefined ? ` @ (${step.x}, ${step.y})` : ''}${step.text ? ` 文本"${step.text}"` : ''}`);
  // ④ 坐标精度提示：mock 坐标是"按 1280×800 标定的估算值"，明确告知模型这不是实测
  parts.push('坐标来源说明：坐标来自计划中的**估算值**（非实测屏幕反馈），若未命中请按目标元素的相对位置微调');
  return parts.join('\n');
}

async function runAiOperator(roomNumber, hostId, goal) {
  const room = rooms.get(roomNumber);
  const sock = ensureAiOpSocket();
  /* ★ 09-24e 观测通道：监听服务器自己的转发结果（remote-input-fwd-result）。
   *   为什么不让被控端记 ack：见文件头「试过并否掉的方案」——客户端根本没这个回执，
   *   而**服务器在转发那一刻就知道目标在不在**，这是零协议改动的既成事实。 */
  const fwd = { last: null };
  const onFwd = (r) => { fwd.last = r; };
  sock.on('remote-input-fwd-result', onFwd);

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('AI 控制端连接超时')), 5000);
    if (sock.connected) { clearTimeout(t); resolve(); }
    else sock.once('connect', () => { clearTimeout(t); resolve(); });
    sock.once('connect_error', () => { clearTimeout(t); reject(new Error('AI 控制端连接失败')); });
  });
  // 进房（房间邀请自己的 AI：密码由房间自己给出——这不是绕过，是"主人的 AI"）
  await new Promise((resolve) => {
    sock.emit('join-room', { roomNumber, password: room.password || null }, () => resolve());
    setTimeout(resolve, 1500);
  });
  await aiSleep(300); // 等进房广播落地

  // 发起真实授权（host 前端会弹与人类控制端一模一样的授权卡，可拒绝/限时长）
  // ★ 09-19g 实修：授权等待独立 5s 超时——30s 的任务超时若用于等授权，
  //   "没人理授权卡"会把 aiOpBusy 占住半分钟（跨测试轮次表现为 busy 拒绝）。
  const granted = new Promise((resolve, reject) => {
    const onAns = (p) => {
      clearTimeout(t);
      sock.off('remote-answer', onAns);
      if (p && p.ok) resolve();
      else reject(new Error('被控端拒绝了授权' + (p && p.reason === 'busy' ? '（已有控制端在控）' : '')));
    };
    const t = setTimeout(() => {
      sock.off('remote-answer', onAns);
      reject(new Error('授权超时（5 秒内没人回应授权卡）'));
    }, Number(process.env.AI_OP_AUTH_MS) || 5000);
    sock.on('remote-answer', onAns);
  });
  sock.emit('remote-request', { to: hostId });
  await granted;
  io.to(roomNumber).emit('chat-message', {
    from: 'ai-bot', name: '🤖 AI 操作员', text: '✅ 授权通过——开始执行操作计划（被控端审计日志同步记账）', ts: Date.now(),
  });
  logEvent('info', 'ai-op-granted', { roomNumber, hostId });

  // 计划：LLM 优先，Mock 兜底（双轨）
  let plan = null;
  if (AI.aiEnabled()) {
    try { plan = await llmPlan(goal); } catch (e) { plan = null; }
  }
  const isMock = !plan;
  if (!plan) plan = mockPlan(goal);
  const deadline = Date.now() + AI_OP_MAX_MS;

  const executed = [];          // 已执行操作的文字轨迹（喂回 LLM 用）
  let reactRounds = 0;
  const maxReact = Number(process.env.AI_OP_REACT_ROUNDS) || 4;   // 闭环最多修正几轮（防无限自纠）
  let anyForwardFail = false;   // 是否出现过"输入被丢弃"（"报成功但实际失败"的探测器）

  /* 执行一步：发输入 → 等一小段 → 读取服务器转发结果，返回本步投递情况 */
  async function execStep(step) {
    if (step.op === 'wait') { await aiSleep(Math.min(Number(step.ms) || 500, 3000)); return { forwarded: true, sent: 0 }; }
    step._to = hostId;
    fwd.last = null;
    // 本步期望的帧数（click = move+down+up 三条）——用于日志统计，不影响放行判定
    const sent = step.op === 'click' ? 3 : step.op === 'dblclick' ? 2 : 1;
    try { aiInput(sock, step); } catch (e) { /* 单步失败不中断（比如坐标越界） */ }
    await aiSleep(AI_OP_STEP_MS);
    /* fwd.last 由服务器在转发那一刻同步回填：{ ok:boolean, reason:string }。
     * ★ 保守原则：**没收到结果时不判失败**（forwarded 默认 true）——
     *   宁可漏报也不误报，否则会把"一切正常"的任务报成"输入丢失"，反而制造混乱。 */
    const forwarded = fwd.last ? fwd.last.ok === true : true;
    if (!forwarded) anyForwardFail = true;
    return { forwarded, sent };
  }

  // ── 主循环：开环执行 plan，每步读取观测；LLM 可用时进入闭环修正 ──
  for (const step of plan) {
    if (Date.now() > deadline) throw new Error('执行超时保护触发');
    const ctl = remoteCtl.get(roomNumber);
    if (!ctl || !ctl.controllerId) throw new Error('授权已被收回，任务中止');

    const delivery = await execStep(step);
    executed.push(`${step.op}${step.x !== undefined ? `(${step.x},${step.y})` : ''}${step.text ? `"${step.text}"` : ''}`);

    /* ── ReAct 的 Observe → Reason：转发失败、或 LLM 可用时，问模型"要不要修正" ── */
    const needReact = (!delivery.forwarded || AI.aiEnabled()) && reactRounds < maxReact && Date.now() < deadline;
    if (!needReact) continue;
    reactRounds++;
    try {
      const obs = collectObservation(roomNumber, step, delivery, executed);
      const decision = await llmReact(goal, executed.join('\n') || '（无）', obs);
      if (decision.done) {
        io.to(roomNumber).emit('chat-message', {
          from: 'ai-bot', name: '🤖 AI 操作员',
          text: `🧠 闭环判断：目标已达成（第 ${reactRounds} 轮核对）——${decision.reason}`, ts: Date.now(),
        });
        logEvent('info', 'ai-op-react-done', { roomNumber, round: reactRounds, reason: decision.reason });
        break;
      }
      if (decision.next.length) {
        io.to(roomNumber).emit('chat-message', {
          from: 'ai-bot', name: '🤖 AI 操作员',
          text: `🔧 闭环修正（第 ${reactRounds} 轮）：${decision.reason} → 补 ${decision.next.length} 步`, ts: Date.now(),
        });
        logEvent('info', 'ai-op-react-fix', { roomNumber, round: reactRounds, steps: decision.next.length, reason: decision.reason });
        for (const s of decision.next) {
          if (Date.now() > deadline) break;
          const c2 = remoteCtl.get(roomNumber);
          if (!c2 || !c2.controllerId) break;
          await execStep(s);
          executed.push(`${s.op}(修正)${s.x !== undefined ? `(${s.x},${s.y})` : ''}`);
        }
      }
    } catch (e) {
      // 闭环本身失败（LLM 超时/JSON 坏）→ **不中断任务**，退回开环继续跑完（降级纪律）
      logEvent('warn', 'ai-op-react-skip', { roomNumber, round: reactRounds, why: String(e.message).slice(0, 120) });
    }
  }

  sock.emit('remote-release', {});
  sock.off('remote-input-fwd-result', onFwd);

  /* ── 结论必须诚实：三种措辞对应三种确定程度（绝不无条件报"任务完成"）──
   * ▎这是本文件最该被记住的一处：改造前无论实际有没有点到，一律报"🏁 任务完成"。
   *   AI 产品**报成功而实际失败**是最伤信任的缺陷——用户不会重试，只会觉得"这东西是假的"。 */
  const doneReport = anyForwardFail
    ? `⚠️ 计划已执行完（${plan.length} 步${isMock ? '，[Mock] 本地脚本' : '，LLM 计划'}），但**有输入帧因被控端不在房间被丢弃**——可能未完全生效，建议查看被控端画面确认`
    : `🏁 计划已执行完（${plan.length} 步${isMock ? '，[Mock] 本地脚本' : '，LLM 计划'}），输入已全部转发${reactRounds ? `，并经 ${reactRounds} 轮闭环核对` : ''}；控制权已交还`;
  io.to(roomNumber).emit('ai-state', { state: 'happy' }); // ★ 09-26：任务达成的"情绪帧"
  setTimeout(() => io.to(roomNumber).emit('ai-state', { state: 'idle' }), 2600);
  io.to(roomNumber).emit('chat-message', {
    from: 'ai-bot', name: '🤖 AI 操作员', text: doneReport, ts: Date.now(),
  });
  logEvent('info', 'ai-op-done', {
    roomNumber, steps: plan.length, mock: isMock, reactRounds, fwdFail: anyForwardFail, executed: executed.length,
  });
}

/* ══════════════════════════════════════════════════════════════
 * ★ 09-19c N2 会议纪要骨架（分段 + 终稿，DeepSeek/[Mock] 双轨，零依赖）
 * ▎是什么：把一场会/一个时段的字幕账本+发言统计+待办关键词，合成一份 markdown 纪要，
 *   落盘 sfu/minutes/<房间号>/<时间戳>-<分段|终稿>.md；值守期间每 MINUTES_INTERVAL
 *   自动出一份分段纪要，AI 助理送走/房间销毁时自动出终稿。
 * ▎双轨：有 DEEPSEEK_API_KEY → 字幕喂 LLM 出要点/待办/结论；无 key/失败 → 本地模板
 *   （结构化统计 + 关键句节选 + 待办关键词抽取——"需要/记得/下周/明天/跟进…"这组
 *   规则在无 LLM 时代就已能捞出大半待办，纪要尾注带 [Mock] 标记）。
 * ▎与 N1 的衔接：字幕权威副本在 sfu/captions/*.jsonl（第 30 步归档），这里就是它的
 *   第一个"消费者"——睡觉挂一夜，早上 minutes/ 里躺着按时段排好的纪要。
 * ══════════════════════════════════════════════════════════════ */
const MINUTES_DIR = path.join(__dirname, 'minutes');
const MINUTES_INTERVAL_MS = (Number(CONFIG.minutesIntervalSec) || 3600) * 1000; // 分段间隔（config 可调）

// 读房间全部字幕账本（aiBrain 同款来源，抽成公共函数）
function loadCaptions(roomNumber) {
  const files = fs.existsSync(CAPTIONS_DIR)
    ? fs.readdirSync(CAPTIONS_DIR)
        .filter((f) => f.startsWith(`cap-${roomNumber}-`) && f.endsWith('.jsonl')).sort()
    : [];
  const out = [];
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(CAPTIONS_DIR, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch (e) { /* 坏行跳过 */ }
    }
  }
  return out.sort((a, b) => (a.ts || 0) - (b.ts || 0));
}

// LLM 纪要（有 key 才走；失败抛错由调用方降级 Mock）——★ 09-24 改走统一 provider
async function llmMinutes(seg) {
  const transcript = seg.slice(-200).map((e) => `${e.name}: ${e.text}`).join('\n');
  const res = await AI.askLLM([
    /* ★ 09-25：prompt 从"三个小节"收成"两个小节"——去掉了「风险与未决」。
     *   为什么：风险现在由**看板那套判据**统一产出（见 buildMinutes 里的 Digest）。
     *   若这里再让 LLM 写一遍"风险"，同一份纪要里就会出现两份风险清单，
     *   且两者口径不同（LLM 归纳 vs 规则抽取），互相打架——
     *   用户看到"看板说这是风险、纪要正文没提"就会怀疑整个 AI 不可信。
     *   **一个概念只能有一个来源**，这是纪要可信度的地基。 */
    { role: 'system', content: '你是会议纪要助手。基于会议字幕输出 markdown，只含两个小节：## 要点（不超过6条）## 结论（一句话）。不要编造字幕里没有的内容。行动项与风险点由其他环节单独抽取，你不要写。' },
    { role: 'user', content: `会议字幕：\n${transcript}` },
  ], { label: 'ai-minutes', temperature: 0.3, timeoutMs: 30000, maxTokens: 900, mock: () => { throw new Error('LLM 不可用'); } });
  if (res.mock) throw new Error(res.reason || 'LLM 不可用');
  return res.text;
}

// 纪要合成器：type='segment'|'final'；since=只统计该时刻之后（分段用）
async function buildMinutes(roomNumber, opts = {}) {
  const room = rooms.get(roomNumber);
  const now = Date.now();
  const entries = loadCaptions(roomNumber);
  const seg = entries.filter((e) => (e.ts || 0) >= (opts.since || 0));
  const durMin = room ? Math.round((now - room.createdAt) / 60000) : 0;
  const talkRows = room ? [...room.talk.entries()].sort((a, b) => b[1] - a[1]) : [];
  const bySpeaker = {};
  for (const e of seg) bySpeaker[e.name || '未知'] = (bySpeaker[e.name || '未知'] || 0) + 1;
  const speakers = Object.entries(bySpeaker).sort((a, b) => b[1] - a[1]);

  /* ★ 09-24e 行动项从"正则捞整句"升级为"结构化三元组 {owner, task, due}"
   * ▎为什么值得单独做：改造前的输出是 `- [ ] 张三："记得把 TURN 轮换一下"`
   *   —— 有用，但**不可执行**：没有负责人字段（得人去读句子猜）、没有期限字段。
   *   纪要里最有价值、最需要被"下一步"消费的就是行动项，它值得结构化的待遇。
   * ▎双轨：有 key 让 LLM 抽（能理解"文档我负责"里"我"=张三 这类指代与去重）；
   *   无 key 走规则（尽力抽，抽不到就留空——**宁可留空，不可编造**）。
   * ▎抽不到由 renderActions 明确写"（未识别到明确的行动项）"，不假装有。 */
  const actRes = await Brain.extractActions(seg);
  let actions = actRes.actions.slice();

  /* ★ 09-25 看板与纪要**同源**（一处判据、两处消费）。
   * ▎之前在纪要里"风险"是被抽了两遍的：mock 轨用本文件内联的 riskRe，
   *   实时看板用 digest 的 RISK_RE —— 两组正则不一样，于是同一场会里
   *   "看板显示了 3 条风险、纪要只写了 2 条"这种矛盾就会真实出现，
   *   用户看到只会得出一个结论：这套 AI 不可信。
   * ▎现在改成：纪要里的「决定 / 风险」直接取自 digest（与实时看板**同一份判据、
   *   同一份实现**），所以两边**天然一致**——不是"努力对齐"，而是结构上不可能不一致。
   *   这也是为什么值得为看板单独抽一个模块：抽出来之后它才能被两个消费者共用。 */
  const dig = new Digest.Digest({ maxPerKind: 50 });
  dig.ingest(seg);
  const decisions = dig.items.decision;
  const risks = dig.items.risk;

  /* ★ 09-25 行动项与看板合并（两件事，缺一不可）：
   *   ① **人工认领必须压过机器推断**：看板上有人点了「我来」，那是**人的决定**。
   *      若纪要重新从字幕抽一遍，这个认领就会消失——纪要里写"待认领"，
   *      而那个人明明已经认领了。**机器推断绝不能覆盖人已经做过的决定。**
   *   ② **看板有的，纪要必须有**：否则又是"看板 3 条、纪要 2 条"那种口径不一致
   *      （一个概念两个来源 → 必然漂移，AGENTS 坑 47）。
   *
   * ⚠️ 这里有一个**必须记住的陷阱**（本轮实测踩到）：
   *   上面那个 `dig` 是**新建的**（为了按 `since` 只统计本段，所以要重新 ingest），
   *   而**人工认领记在房间级的 `roomBoards` 里**——两个不同的实例！
   *   初版直接拿 `dig.items.todo` 去合并，于是"认领"信息**凭空消失**，
   *   纪要继续写"待认领"（正是要修的那个缺陷，只是换了个位置复发）。
   *   所以行动项要取**房间级实时看板**（它带着人的认领），只按 `since` 过滤时间段；
   *   房间级看板不存在时（如对历史档案离线出纪要）才退回本段的 dig。
   *   ▎教训：**"同一份数据"必须真的是同一份**——同名/同结构但不同实例，
   *     看起来像同源，实际上什么都不同步。 */
  const liveBoard = roomBoards.get(roomNumber);
  const boardTodos = liveBoard
    ? liveBoard.items.todo.filter((t) => (t.ts || 0) >= (opts.since || 0))
    : dig.items.todo;

  const actKey = (s) => String(s || '').replace(/\s+/g, '').replace(/[，。！？、；：""''（）()]/g, '');
  for (const t of boardTodos) {
    const k = actKey(t.task || t.text);
    const hit = actions.find((a) => {
      const ak = actKey(a.task);
      return ak && k && (ak === k || ak.includes(k) || k.includes(ak));
    });
    if (hit) {
      if (t.owner) hit.owner = t.owner;        // 人工认领覆盖机器推断
    } else {
      actions.push({ owner: t.owner || '', task: t.task || t.text, due: t.due || '' });
    }
  }

  let body = null;
  let isMock = false;
  if (AI.aiEnabled() && seg.length) {
    try { body = await llmMinutes(seg); } catch (e) { body = null; }
  }
  if (!body) {
    isMock = true;
    const lines = [];
    lines.push('## 发言占比');
    if (speakers.length) for (const [name, n] of speakers.slice(0, 10)) {
      lines.push(`- ${name}：${n} 条（${Math.round((n / seg.length) * 100)}%）`);
    } else lines.push('- （本时段没有字幕记录）');
    lines.push('');
    lines.push('## 关键句节选（最近 12 条）');
    if (seg.length) for (const e of seg.slice(-12)) lines.push(`- ${e.name}："${e.text}"`);
    else lines.push('- （无）');
    // ★ 09-25：「风险与未决」从这里**移除**——改由下方统一的 boardBlock 产出（同源，见上方注释）
    body = lines.join('\n');
  }

  /* ── 行动项小节统一由代码渲染（而非交给 LLM 自由发挥）──
   * ▎这是个刻意的架构决定：LLM 擅长"理解内容"，不擅长"严格遵守格式"。
   *   让它同时负责内容 + 格式，结果通常是格式走样（少字段、多寒暄）。
   *   所以分工是：**LLM 只产出结构化的 {owner,task,due}，渲染交给确定性代码**。
   *   这样无论走 LLM 轨还是 Mock 轨，行动项小节的**格式完全一致**——前端解析不用分叉。 */
  const claimedCount = actions.filter((a) => a.owner).length;
  const actBlock = [
    '', '## 行动项', renderActionTable(actions),
    (actRes.mock
      ? `> 由规则抽取（${actRes.reason === 'rules' ? '字幕条数少或未配 key' : 'LLM 未参与'}）；配置 DEEPSEEK_API_KEY 后由模型识别，可理解指代与去重。`
      : '> 由 DeepSeek 从字幕中识别（含指代消解与去重）。')
    + ' 已与会议中的「🧠 会议看板」合并——**看板上有人认领过的，以认领人为准**'
    + `（本份共 ${claimedCount} 条有负责人）。`,
    '',
  ].join('\n');

  /* ★ 09-25：时间戳精确到**秒**（原来是分钟级 slice(0,16)）。
   *   分钟级会导致同一分钟内生成的同名纪要**互相覆盖**——实测路径：
   *   送走助理出终稿 → 立刻又被请回来 → 再送走 → 第二份终稿把第一份盖掉。
   *   纪要是有留存价值的产物，静默覆盖属于数据丢失。加两位秒即可根治。
   *   （文件名格式无人解析——只被列表/下载，见 /minutes/ 路由，故改动安全。） */
  /* ── ★ 09-25「决定 / 风险」小节：与实时看板同一份判据（见上方 dig 的注释）──
   * ▎决定是**新增**的小节。在此之前纪要里没有任何地方专门记"会上定下来了什么"——
   *   而那恰恰是会后再复盘时最容易被扯皮的一件事（"当时到底定没说""我怎么记得不是这样"）。
   *   现在它会作为独立小节留档，且与会议中大家在看板上看到的**完全一致**。
   * ▎为什么只列最近 12 条：纪要是给人读的，不是数据库导出；更长会由"关键句节选"兜底，
   *   完整的看板数据另有留存。宁短勿滥，是文档类产物的基本体面。 */
  const renderInsight = (title, items) => {
    const head = ['', `## ${title}`];
    if (!items.length) return head.concat(['- （无）', '']).join('\n');
    return head.concat(items.slice(-12).map((it) =>
      `- **${it.name}**：${it.text}`)).concat(['']).join('\n');
  };
  const boardBlock = dig.total
    ? renderInsight('决定', decisions) + renderInsight('风险与未决', risks)
      + '\n> 以上两节与会议进行中的「🧠 会议看板」**同源**（同一套判据、同一份实现），口径必然一致。\n'
    : '';

  const stamp = new Date(now).toISOString().slice(0, 19).replace(/[-:T]/g, '');
  const md = [
    `# 会议纪要（${opts.type === 'final' ? '终稿' : '分段'}）· 房间 ${roomNumber}`, '',
    `- 生成时间：${new Date(now).toLocaleString()}`,
    `- 会议时长：约 ${durMin} 分钟；本${opts.type === 'final' ? '场' : '时段'}字幕 ${seg.length} 条（全档 ${entries.length} 条）`,
    `- 发言统计：${talkRows.slice(0, 3).map(([id, v]) => `${aiShortId(id)} 约 ${Math.round(v)}s`).join('、') || '无'}`,
    actBlock, boardBlock, body, '',
    opts.type === 'final' ? '> 终稿：AI 助理送走 / 房间销毁时自动生成。' : '> 分段纪要：值守期间定时生成。',
    isMock ? '> [Mock] 本地模板生成（无 DEEPSEEK_API_KEY 或 LLM 失败）；配置 key 后本节由 LLM 撰写。' : '> 由 DeepSeek 撰写。',
    '',
  ].join('\n');
  const dir = path.join(MINUTES_DIR, String(roomNumber));
  fs.mkdirSync(dir, { recursive: true });
  const file = `${stamp}-${opts.type || 'segment'}.md`;
  fs.writeFileSync(path.join(dir, file), md, 'utf8');
  logEvent('info', 'minutes-generated', {
    roomNumber, type: opts.type || 'segment', entries: seg.length,
    actions: actions.length, actionsMock: actRes.mock, mock: isMock,
  });
  return { file, path: `/minutes/${roomNumber}/${file}`, markdown: md, mock: isMock, actions, actionsMock: actRes.mock };
}

/* ══════════════════════════════════════════════════════════════
 * ★ 09-25 跨段归并（全天 / 跨时段总纪要）
 *
 * ▎要解决什么（一个此前只在离线脚本里存在的能力）：
 *   值守模式每 MINUTES_INTERVAL 出一份**分段纪要**（默认 1 小时一份），
 *   挂一夜就是 7~8 个文件。可是没有人会去逐份读 8 份纪要——
 *   用户早上想要的是一份**"昨晚到底发生了什么"**。
 *   跨段归并（map-reduce 的 reduce 半步）此前只存在于离线实验脚本
 *   `scripts/summarize.js` 里，**服务器侧与界面上都没有入口**，等于这个能力对用户不存在。
 *
 * ▎为什么是"归并已有纪要"而不是"重新吃一遍全部字幕"：
 *   ① 分段纪要已经过 LLM 归纳，token 量远小于原始字幕（一份 8 小时的会
 *      字幕可能 20 万字符，而 8 份分段纪要只有几千字符）——**成本差两个数量级**；
 *   ② 分段纪要里已经包含**人工认领过的行动项**等被加工过的信息，
 *      重吃字幕会把它们丢掉（见 buildMinutes 里"人 vs 机器"的优先级说明）；
 *   ③ 这正是 map-reduce 的本意：map 阶段做过的事不要在 reduce 重做。
 *
 * ▎降级策略（无 key / LLM 失败时**必须仍然可用**）：
 *   不编造、不假装成功——改用**确定性的拼接式合并**：按时间顺序把小节的标题与
 *   列表项合并、按正文去重。它的质量不如 LLM 归纳（不会真的"提炼"），
 *   但**该有的信息一条不少**，而且用户能从尾部标注看出这是降级产物。
 *   这比"归并失败，请稍后再试"有用得多——纪要的价值在"早上能看到"，
 *   不能因为模型不可用就什么都没有。
 * ══════════════════════════════════════════════════════════════ */
async function mergeMinutes(roomNumber) {
  const dir = path.join(MINUTES_DIR, String(roomNumber));
  const now = Date.now();
  const stamp = new Date(now).toISOString().slice(0, 19).replace(/[-:T]/g, '');

  // 收拢已有纪要：**排除已归并产物**，否则反复归并会滚雪球（把上次的合并结果再合一次）
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !f.includes('-merged')).sort()
    : [];
  if (files.length < 2) {
    const e = new Error(files.length === 0
      ? '这个房间还没有任何纪要（先开字幕、或点「📝 纪要」生成一份）'
      : '目前只有一份纪要，无需归并（等分段纪要累积到两份以上再汇总）');
    e.userFacing = true;
    throw e;
  }

  const parts = files.map((f) => ({
    file: f,
    md: fs.readFileSync(path.join(dir, f), 'utf8'),
  }));
  const joined = parts.map((p) => `===== ${p.file} =====\n${p.md}`).join('\n\n');

  let body = null;
  let isMock = true;
  try {
    if (AI.aiEnabled()) {
      const res = await AI.askLLM([
        {
          role: 'system',
          content: '你是会议纪要编辑。下面是同一场会议**按时间顺序排列的多份分段纪要**，'
            + '请把它们归并成**一份完整纪要**，输出 markdown：\n'
            + '- 保留并合并各段的关键信息，**去重**（同一件事在多段里出现只留一次，以最新表述为准）\n'
            + '- 结构：## 决定 / ## 风险与未决 / ## 行动项（表格：负责人|事项|期限）/ ## 要点（按时间线）\n'
            + '- **不要输出任何一级标题（#）**，直接从 ## 小节开始（文件头由系统另行写入，\n'
            + '  否则产出里会出现两个"# 会议纪要"标题——实测就出过这个岔子）\n'
            + '- **不要编造**分段纪要里没有的内容；信息冲突时保留两种说法并标注"（两处说法不一致）"\n'
            + '- 不要写"本次归并"之类的话，直接给纪要正文',
        },
        { role: 'user', content: joined.slice(0, 24000) },
      ], { label: 'ai-minutes-merge', temperature: 0.2, timeoutMs: 40000, maxTokens: 1600, mock: () => { throw new Error('LLM 不可用'); } });
      if (!res.mock && res.text) { body = res.text.trim(); isMock = false; }
    }
  } catch (e) {
    logEvent('warn', 'minutes-merge-llm-failed', { roomNumber, reason: String(e.message).slice(0, 120) });
  }

  if (!body) {
    /* 降级：确定性拼接。按 `## 小节` 分组收集各段的列表项，去掉重复行。
     * ▎为什么要按小节聚合而不是直接拼接全文：直接拼会得到一堆重复的标题
     *   （每份分段纪要都有"## 行动项"），读起来像 8 份文件摞在一起，
     *   那和"给用户一份纪要"的承诺不符。 */
    const buckets = new Map();   // 小节名 -> Set(行)
    const order = [];
    for (const p of parts) {
      let cur = null;
      for (const line of p.md.split('\n')) {
        const h = /^##\s+(.+?)\s*$/.exec(line);
        if (h) {
          cur = h[1].trim();
          if (!buckets.has(cur)) { buckets.set(cur, new Set()); order.push(cur); }
          continue;
        }
        if (!cur) continue;
        const t = line.trim();
        if (!t || t.startsWith('| ---') || t.startsWith('>')) continue;   // 表格分隔行/引言注释不算内容
        buckets.get(cur).add(t);
      }
    }
    const lines = ['## 归并要点（按小节合并，已去重）'];
    for (const k of order) {
      if (k === '行动项') continue;          // 行动项单独置后，避免和其它小节混在一起
      lines.push('', `### ${k}`);
      for (const v of buckets.get(k)) lines.push(v);
    }
    if (buckets.has('行动项')) {
      lines.push('', '## 行动项（各段合并去重）');
      for (const v of buckets.get('行动项')) lines.push(v);
    }
    body = lines.join('\n');
  }

  const md = [
    `# 会议纪要（跨时段归并）· 房间 ${roomNumber}`, '',
    `- 生成时间：${new Date(now).toLocaleString()}`,
    `- 归并来源：**${files.length}** 份分段/终稿纪要（${files.join('、')}）`,
    `- 说明：跨段归并 = 把按小时切开的纪要合成一份"这场会到底发生了什么"。`,
    `  分段纪要仍然保留在本目录下（归并**不删源文件**——源件是逐时段的原始记录，删了就查不到细节了）。`,
    '',
    body, '',
    isMock
      ? '> [Mock] 确定性拼接式归并（无 DEEPSEEK_API_KEY 或 LLM 失败）：**信息一条不少，但未做语义提炼**。'
      : '> 由 DeepSeek 归并撰写（含去重与跨段信息合并）。',
    '',
  ].join('\n');

  fs.mkdirSync(dir, { recursive: true });
  const file = `${stamp}-merged.md`;
  fs.writeFileSync(path.join(dir, file), md, 'utf8');
  logEvent('info', 'minutes-generated', {
    roomNumber, type: 'merged', sources: files.length, mock: isMock,
  });
  return { file, path: `/minutes/${roomNumber}/${file}`, markdown: md, mock: isMock, sources: files.length };
}

/** 行动项渲染成 markdown 表格（比清单更紧凑，且 owner/due 缺失一眼可见） */
function renderActionTable(actions) {
  const list = Array.isArray(actions) ? actions : [];
  if (!list.length) return '（未识别到明确的行动项——可能是本时段没有任务性表述）';
  const rows = list.map((a) => {
    const owner = a.owner ? a.owner : '**待认领**';
    const due = a.due ? a.due : '—';
    const task = String(a.task || '').replace(/\|/g, '\\|');   // 防表格串列
    return `| ${owner} | ${task} | ${due} |`;
  });
  return ['| 负责人 | 事项 | 期限 |', '| --- | --- | --- |', ...rows].join('\n');
}

function broadcastRoomState(roomNumber) {
  const room = rooms.get(roomNumber);
  if (!room) return;
  const ctl = remoteCtl.get(roomNumber) || {};
  // ★ 09-24 C4：下面这段是**显式投影**（一个字段一个字段写），不是 {...m} 展开——
  //   正因如此，socket 上的 roomToken 不会被顺手广播出去。改这里时务必保持"显式"。
  const members = [...room.members].map((m) => ({
    id: m.id,
    name: m.displayName || null,           // ★ 09-16：昵称（成员列表显示用）
    avatar: m.avatar || null,              // ★ 09-26：预设头像 key（前端拼 /avatars/presets/XX.png）
    owner: m.id === room.ownerId,          // 房主（建房的人）——踢人权限在他手里
    muted: !!(m.state && m.state.muted),   // 前端上报的"我静音了吗"
    camOff: !!(m.state && m.state.camOff), // 前端上报的"我关摄像头了吗"
    sharing: !!(m.state && m.state.sharing),
    hand: !!(m.state && m.state.hand),     // ★ 09-13 F4：举手（要发言）
    caption: !!(m.state && m.state.caption), // ★ 09-17b：实时字幕开关（成员列表 💬）
    // ★ 09-24 真远程桌面：是不是桌面代理（前端据此显示 🖥️ 徽标 + "控制电脑"按钮）
    agent: m.isAgent === true,
    agentInfo: m.isAgent ? (m.agentInfo || null) : null,
  }));
  // ★ 09-19 AI Bot 参会者（C 档）：bot 在场时以虚拟成员身份出现在快照里——
  //   它没有 socket/媒体，muted/camOff 都是"是"（它不推流，只"听"：见下方音频管线）
  if (room.aiBot) {
    members.push({
      id: 'ai-bot', name: '🤖 AI 小明', isBot: true, avatar: 'ai',
      owner: false, muted: true, camOff: true, sharing: false, hand: false, caption: true,
    });
  }
  io.to(roomNumber).emit('room-state', {
    roomNumber,
    members,
    hostId: ctl.hostId || null,           // 当前被控端（★ A1 远程协助）
    controllerId: ctl.controllerId || null,
    expiresAt: ctl.expiresAt || null,     // ★ A6：限时授权的到期时间戳（前端算倒计时）
  });
}

/* ★ F2 升级（2026-09-12）：每成员网络质量（net-levels 广播）
 *
 * ▎这是什么？每 3 秒对房间里**每个成员**正在订阅的每路 Consumer 调一次 getStats()，
 *   取"最差那一路"的丢包率映射成 0/1/2 三档，打包成 { [socketId]: 等级 } 广播给全房，
 *   前端在成员列表里给每人画一个小圆点（绿/黄/红）。
 *
 * ▎为什么由服务器量（和 D1 选层同一个信任模型）？
 *   下行丢包发生在"服务器 → 浏览器"这段，Consumer 就挂在服务器上，服务器量得到；
 *   客户端自报可以被夸大/漏报，而且"他网络好不好"是全房都要显示的信息——
 *   一份测量、全房一致，这正是 SFU 作为中心点的天然优势（同 D2 说话人检测）。
 *
 * ▎两个工程细节（面试可讲）：
 *   ① **有变化才广播**：把快照 JSON 和上一次比一比，没变就不发——省信令，UI 也不会闪；
 *   ② **没人收流 = null**：刚进房还没订阅到媒体、或一路包都没收到时，等级是 null，
 *      前端显示灰色 ○（"暂无数据"），不瞎猜成"网络好"。
 */
const NET_LEVEL_INTERVAL_MS = 3000;
const netLossToLevel = (loss) => (loss < 0.01 ? 0 : loss < 0.05 ? 1 : 2);

/* ★ D+3 升级（2026-09-14）：量网从"只看丢包"升级为"丢包 + 服务器侧带宽估计"
 * ▎丢包：订阅的每路 Consumer 的丢包率，取最差（最差的那路决定体感）；
 * ▎带宽估计（BWE）：recvTransport（服务器→他的下行方向）的 availableOutgoingBitrate——
 *   mediasoup 的 transport-cc 在服务器上对每条下行估出的"可用带宽"。
 *   这正是 D+3 想要的工程化 ABR 原料：以前只有丢包率一个维度，现在是两个维度。
 */
async function collectMemberNet(socket) {
  let worst = null;
  for (const consumer of socket.consumers.values()) {
    let stats;
    try { stats = await consumer.getStats(); } catch (e) { continue; } // Consumer 刚被关等竞态：跳过
    for (const s of stats) {
      const total = (s.packetCount || 0) + (s.packetsLost || 0);
      if (!total) continue; // 一包都没收过（刚开始订阅）：不算数
      const loss = (s.packetsLost || 0) / total;
      if (worst === null || loss > worst) worst = loss;
    }
  }
  const level = worst === null ? null : netLossToLevel(worst);

  // 服务器 → 他的下行带宽估计（bps）。旧版 mediasoup 没这个字段 → null（前端不显示）
  let bweBps = null;
  try {
    const tstats = await socket.recvTransport.getStats();
    for (const s of tstats) {
      const v = s.availableOutgoingBitrate;
      if (typeof v === 'number') bweBps = Math.max(bweBps || 0, v);
    }
    if (bweBps !== null) bweBps = Math.round(bweBps);
  } catch (e) { /* Transport 已关等竞态：留空 */ }
  return { level, bweBps };
}

// 房间级的"量网 + 广播"定时器（joinRoom 时启动；幂等，重复调用不会建第二个）
function startNetLevelBroadcaster(roomNumber) {
  const room = rooms.get(roomNumber);
  if (!room || room.netLevelTimer) return;
  room.netLevelTimer = setInterval(async () => {
    if (!room.members.size) return; // 人走光了等 disconnect 清理，别再广播
    const levels = {};
    const bwe = {}; // ★ D+3：每人的下行带宽估计（bps，null=没有估计值）
    for (const m of room.members) {
      const r = await collectMemberNet(m);
      levels[m.id] = r.level;
      bwe[m.id] = r.bweBps;
    }
    const json = JSON.stringify({ levels, bwe });
    if (json === room.lastNetLevelsJson) return; // ① 没变化不打扰
    room.lastNetLevelsJson = json;
    io.to(roomNumber).emit('net-levels', { levels, bwe });
  }, NET_LEVEL_INTERVAL_MS);

  // ★ 09-13 发言占比广播（talk-stats）：和量网共用一条 3s 心跳节奏（分开两个定时器，
  //   但都登记在 room 上——房间销毁时两个都要清，见 disconnect 清理段）。
  //   share = 个人发言秒数 / 全房总秒数，取整数百分比；**有变化才发**（同 net-levels）。
  //   前端把它画成成员行下面的一根细占比条——"谁主导了这场会"一眼可见。
  room.talkTimer = setInterval(() => {
    if (!room.members.size) return;
    const total = [...room.talk.values()].reduce((a, b) => a + b, 0);
    const stats = [...room.members].map((m) => {
      const sec = Math.round(room.talk.get(m.id) || 0);
      return {
        id: m.id,
        sec,
        share: total > 0 ? Math.round((sec / total) * 100) : 0,
      };
    });
    const json = JSON.stringify(stats);
    if (json === room.lastTalkStatsJson) return; // 没变化不打扰
    room.lastTalkStatsJson = json;
    io.to(roomNumber).emit('talk-stats', { stats });
  }, NET_LEVEL_INTERVAL_MS);
}


// 生成一个当前没人占用的 6 位房间号（和 Mesh 版一模一样）
function generateRoomNumber() {
  let num;
  do {
    num = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(num));
  return num;
}

// ★ SFU 新增：取一个房间的 Router，没有就现场建（懒加载）
//   Router 必须在"这个房间的媒体能力"被使用前存在；
//   第 1 个人进房时创建一次，房间销毁时一起关闭。
async function getOrCreateRouter(roomNumber) {
  // ★ 09-17c：媒体引擎可能还在后台启动——这里等一下（首次进房最多多等 ~2s，
  //   但 HTTP/登录/建房这些不依赖 Worker 的动作早就能用了）
  if (!workers.length && global.__workerReady) await global.__workerReady.catch(() => {});
  const room = rooms.get(roomNumber);
  if (!room.router) {
    const w = pickWorker();
    room.router = await w.createRouter({ mediaCodecs });
    room.workerPid = w.pid; // 记账：这个房间在哪个 Worker 上（Router 无 .worker 引用，pick 时记）
    console.log(`🎛️  房间 ${roomNumber} 的 Router 已创建（Worker ${room.workerPid}）`);
  }
  return room.router;
}

/* ★ D+4：真正销毁一个房间（Router/定时器/台账全清）。
 *   之前这段逻辑内联在 disconnect 里"人走光立即执行"；
 *   现在抽成函数，供"空房 TTL 到期"与"显式清理"共用。
 */
function destroyRoom(roomNumber, reason) {
  const room = rooms.get(roomNumber);
  if (!room) return;
  if (room.router) room.router.close();          // Router 一关，Observer/Producer/Consumer 级联释放
  if (room.netLevelTimer) clearInterval(room.netLevelTimer);
  if (room.talkTimer) clearInterval(room.talkTimer);
  if (room.ttlTimer) clearTimeout(room.ttlTimer);
  // ★ N2：房间销毁时 bot 若在场 → 终稿纪要（异步，读的账本都在文件/闭包里，不依赖 room）
  if (room.aiBot) {
    if (room.minutesTimer) { clearInterval(room.minutesTimer); room.minutesTimer = null; }
    if (room.warmTimer) { clearInterval(room.warmTimer); room.warmTimer = null; }
    buildMinutes(roomNumber, { type: 'final' }).catch(() => {});
  }
  rooms.delete(roomNumber);
  remoteCtl.delete(roomNumber);
  stopAiAudioPipeline(roomNumber); // ★ 09-19：房间销毁 → AI 管线全拆（防 ffmpeg/Transport 泄漏）
  disposeRoomBrain(roomNumber);    // ★ 09-24e：智能体（检索索引 + 会话记忆）同步释放，防内存慢性泄漏
  disposeRoomBoard(roomNumber);    // ★ 09-25：看板同步释放（它是会议级状态，房间没了就该没了）
  console.log(`🗑️ 房间 ${roomNumber} 已销毁（${reason}），号码回收`);
  logEvent('info', 'room-destroyed', { roomNumber, reason });
}

/* ★ D+4：空房进入 TTL 宽限期（不立刻销毁）。宽限期内任何人可凭原号（+密码）回归 */
function scheduleRoomTtl(roomNumber) {
  const room = rooms.get(roomNumber);
  if (!room || room.ttlTimer) return;
  room.emptySince = Date.now();
  room.ttlTimer = setTimeout(() => {
    // 到期那刻房间里可能又有人了（joinRoom 会清 ttlTimer，这里双保险再判一次）
    if (rooms.get(roomNumber) && room.members.size === 0) destroyRoom(roomNumber, 'ttl-expired');
  }, ROOM_TTL_MS);
  console.log(`⏳ 房间 ${roomNumber} 已空，进入 ${Math.round(ROOM_TTL_MS / 1000)}s 宽限期（期间可凭原号回归）`);
}

/* ★ D2 升级（2026-09-11）：服务器端"说话人检测" —— mediasoup AudioLevelObserver
 *
 * ▎这是什么？mediasoup 的"RTP 观察者"之一：把房间里的音频 Producer 挂上去，
 *   它每隔 interval 毫秒量一次每路音频的能量（dB），谁在说话一清二楚。
 * ▎为什么要在服务器做（对比 Mesh 版）？
 *   Mesh 没有服务器媒体层，只能每个浏览器自己拿 AudioContext 分析每条远端流——
 *   同一件事算 N 遍，而且各自的阈值/时机可能不同。
 *   SFU 的音频本来就在服务器上转，顺手量一下就是"全房唯一的一份真相"。
 * ▎参数取舍：maxEntries=8（最多报 8 个人）、threshold=-55dB（太小的底噪不算说话）、
 *   interval=400ms（比视频帧慢得多，够用且省 CPU）。
 */
async function getOrCreateAudioObserver(roomNumber) {
  const room = rooms.get(roomNumber);
  if (!room || !room.router) return null;
  if (room.audioObserver) return room.audioObserver;

  const observer = await room.router.createAudioLevelObserver({
    maxEntries: 8,
    threshold: -55,
    interval: 400,
  });

  // 有人说话：把 [{producer, volume}] 翻译成 [{id: socketId, volume}] 广播给全房
  observer.on('volumes', (volumes) => {
    const levels = volumes
      .map((v) => ({ id: room.producerOwner.get(v.producer.id), volume: Math.round(v.volume) }))
      .filter((l) => l.id);
    if (!levels.length) return;

    // ★ 09-13 发言时长统计（D2 延伸，"真实有用的可视化"）：
    //   observer 每 interval(400ms) 报一次"此刻谁在说话"——顺口给每人记一笔账。
    //   这是"会议分析"的原料：发言占比、谁主导了会议，开会复盘时真实有用，
    //   而数据零额外开销（音频本来就在服务器上量）。
    const TICK = 0.4; // 与上面 createAudioLevelObserver 的 interval 一致（秒）
    for (const l of levels) room.talk.set(l.id, (room.talk.get(l.id) || 0) + TICK);

    io.to(roomNumber).emit('audio-levels', {
      levels,
      top: levels[0].id, // mediasoup 已按音量从大到小排序，第一个就是"最大声"
    });
  });

  // 全房安静：广播一次空列表，前端把所有高亮/音量条清掉
  observer.on('silence', () => {
    io.to(roomNumber).emit('audio-levels', { levels: [], top: null });
  });

  room.audioObserver = observer;
  console.log(`🎙️  房间 ${roomNumber} 的 AudioLevelObserver 已创建（说话人检测）`);
  return observer;
}

/* ★ D1 升级（2026-09-11）：Simulcast 消费者选层 —— 服务器侧的"自动降级/升级"
 *
 * ▎背景一句话：开了 simulcast 之后，一个 Producer 会同时发低/中/高三档画面
 *   （rtpParameters.encodings 里三个条目，各有 rid: 'q'/'h'/'f'）。
 *   服务器要替每个订阅者挑一层转发：网络好发高的、网络差发低的。
 *
 * ▎判断依据（全部来自服务器自己量的数据，不信任客户端上报）：
 *   consumer.getStats() 给出**每一层**的 packetsLost / packetCount / bitrate。
 *   丢包率 = 丢的 / (收的 + 丢的)。
 *
 * ▎策略（教学版，够说明问题）：
 *   丢包率 > 5%  → 立刻降一层（保流畅，宁可糊）
 *   丢包率 < 1% 且已稳定 6 秒 → 升一层（有富余就往清晰走）
 *   中间区间抖动的"迟滞带"→ 什么都不做（防抖是 ABR 的关键，面试可讲）
 *
 * ▎和客户端的关系：默认 auto（服务器说了算）；客户端手动选层后 auto=false，
 *   再点"自动"才交回服务器。当前层用 layer-changed 事件同步给订阅者显示。
 */
const LAYER_UP_COOLDOWN_MS = 6000;

function startLayerMonitor(socket, consumer, layerCount) {
  const state = { layerCount, current: layerCount - 1, auto: true, lastUpAt: 0, timer: null };

  const tick = async () => {
    if (consumer.closed) return;
    if (!state.auto) return; // ★ 手动锁定期间服务器不再插手（尊重用户的选择）
    let stats;
    try { stats = await consumer.getStats(); } catch (e) { return; }

    // stats 每条 = 一层（带 rid）；按 rid 找到"当前层"那一条
    const encodings = (consumer.rtpParameters.encodings || []);
    const curRid = (encodings[state.current] || {}).rid;
    const s = stats.find((x) => x.rid === curRid) || stats[0];
    if (!s) return;

    const total = (s.packetCount || 0) + (s.packetsLost || 0);
    const loss = total > 0 ? (s.packetsLost || 0) / total : 0;

    /* ★ D+3 升级（2026-09-14）：选层依据从"丢包率单维度"升级为"丢包率 + 带宽估计"。
     * ▎bweCap = 这条下行**带宽允许的最高层**：transport-cc 估出 >1.2Mbps 才允许最高层、
     *   >500k 允许中层、其余最多最低层。没有估计值（旧浏览器/竞态）就不设限——
     *   行为退回原来的"只看丢包"，完全向后兼容。
     * ▎为什么它比丢包率更"前瞻"？丢包是"已经坏了才反应"，BWE 是"带宽不够先降级"——
     *   这就是真实产品 ABR 的核心思想（面试讲点）。 */
    let bweCap = state.layerCount - 1;
    try {
      const tstats = await socket.recvTransport.getStats();
      for (const s2 of tstats) {
        const v = s2.availableOutgoingBitrate;
        if (typeof v === 'number') {
          bweCap = v > 1200000 ? state.layerCount - 1 : v > 500000 ? Math.min(1, state.layerCount - 1) : 0;
        }
      }
    } catch (e) { /* Transport 已关等竞态：不设限 */ }

    // ① 丢包严重 或 当前层超出带宽允许 → 降层（下限 0）
    if (state.current > 0 && (loss > 0.05 || state.current > bweCap)) {
      state.current -= 1;
      state.lastUpAt = 0; // 降级后重新计冷却
      await applyLayer(consumer, state.current, loss > 0.05 ? 'auto-down' : 'auto-down-bwe', loss);
      return;
    }
    // ② 网络好且稳定 且 带宽允许 → 谨慎升层（有冷却，避免"升上去又丢包"的抖动）
    const now = Date.now();
    if (loss < 0.01 && state.current < Math.min(state.layerCount - 1, bweCap)) {
      if (!state.lastUpAt) state.lastUpAt = now;
      else if (now - state.lastUpAt >= LAYER_UP_COOLDOWN_MS) {
        state.current += 1;
        state.lastUpAt = 0;
        await applyLayer(consumer, state.current, 'auto-up', loss);
      }
    } else {
      state.lastUpAt = 0;
    }
  };

  const applyLayer = async (target, reason, loss) => {
    try {
      await consumer.setPreferredLayers({ spatialLayer: target });
      socket.emit('layer-changed', {
        consumerId: consumer.id,
        producerId: consumer.producerId,
        spatialLayer: target,
        layerCount,
        auto: state.auto,
        reason,
        loss: Number(loss.toFixed(4)),
      });
      console.log(`🎚️ ${socket.id} 的 Consumer(${consumer.id}) → 第 ${target + 1}/${layerCount} 层（${reason}）`);
    } catch (err) {
      // 单层 Producer（没开 simulcast）或层号越界时 mediasoup 会抛错：忽略即可，不影响画面
    }
  };

  state.applyLayer = applyLayer;
  state.timer = setInterval(() => { tick(); }, 2000);
  return state;
}

/* ──────────────────────────────────────────────────────────────
 * 第 D 部分：信令事件（SFU 版核心）
 * ────────────────────────────────────────────────────────────── */

const io = new Server();      // 先建 socket.io 实例，再分别挂到 HTTP（和可选的 HTTPS）上
io.attach(httpServer);        // ws://localhost:3001
if (httpsServer) io.attach(httpsServer); // wss://...（config.json 里 https.enabled 时）

io.on('connection', (socket) => {
  console.log(`[+] 用户已连接: ${socket.id}`);

  /* ---- 给这个连接建一本"媒体账本"（SFU 新增）----
   * 每个参会者要记：两条 Transport、自己上传的 Producer、自己订阅的 Consumer。
   * 离开房间时要靠这份账本把 mediasoup 里的资源全部释放（防内存泄漏）。
   */
  socket.username = null;      // ★ 09-16：登录后的用户名（游客为 null）
  socket.displayName = null;   // ★ 09-16：昵称（未设置时前端回退"成员 xxxx"）
  // ★ 09-24 真远程桌面：这台连接是不是"被控端桌面代理"（agent/index.js 起的本地程序）。
  //   打这个标记的唯一目的是**区分机器和人**：成员列表显示 🖥️ 徽标、控制按钮换文案、
  //   画面帧通道只认代理。所有别的权限（进房校验/授权链路）与人类一模一样，没有任何特权。
  socket.isAgent = false;
  socket.agentInfo = null;     // { platform, browser } —— 只是给 UI 显示"被控的是什么机器"
  socket.sendTransport = null;
  socket.recvTransport = null;
  socket.producers = new Map(); // producerId -> Producer（我上传的）
  socket.consumers = new Map(); // consumerId -> Consumer（我订阅的）
  // ★ D+1：数据通道账本——我上传的 DataProducer（ SCTP 版的"聊天广播频道"）
  socket.dataProducers = new Map();  // dataProducerId -> DataProducer
  socket.dataConsumers = new Map();  // dataConsumerId -> DataConsumer（我订阅别人的）

  /* ---- ★ D4 升级：给连接挂一份"我的状态"（成员列表要显示这些）----
   * 由前端 member-state 事件上报（静音/关摄像头/是否在共享），服务器只负责存储+广播。
   * 为什么不让服务器自己推断？静音是"轨道 enabled=false"，服务器看不到；共享倒是能推断
   * （有 screen Producer），但为了一致，干脆都听前端上报（真实产品也是客户端上报 + 服务器校验）。
   */
  socket.state = { muted: false, camOff: false, sharing: false, hand: false };

  // ★ D1 升级：我给每个订阅者开的"选层监控定时器"（consumerId -> state），断开时要清
  socket.layerMonitors = new Map();

  /* ---- 工具：socket.io 的"请求-应答"----
   * socket.io 允许 emit 时带最后一个回调参数，服务器处理完调用它：
   *   客户端：socket.emit('事件', 数据, (resp) => {...})
   *   服务器：(数据, callback) => callback({ data }) 或 callback({ error: '...' })
   * 这样一问一答不用额外造事件名，代码更好懂。
   */
  /* ★ 坑 13③ 守卫：浏览器端很多 emit 是"不带回调"的（create-room/join-room 传统、
   *   09-19 的 ai-join/ai-leave 也这样）——无守卫时 callback undefined 直接崩服务器
   *   （09-19 真机抓到：点「🤖 AI」按钮 → 整个服务器 transport close）。 */
  const ok = (callback, data) => { if (typeof callback === 'function') callback({ data }); };
  const fail = (callback, error) => { if (typeof callback === 'function') callback({ error }); };

  /* ---- 事件 0：★ 09-16 登录/注册/恢复登录态 ----
   * ▎三个动作共用"成功后把身份绑到 socket"的逻辑：之后的聊天广播/成员快照
   *   都能带上昵称（不用每条消息自带身份——身份在连接上，这是服务端会话的意义）。
   */
  const bindIdentity = (username, displayName, avatar) => {
    socket.username = username;
    socket.displayName = displayName;
    if (avatar) socket.avatar = avatar; // ★ 09-26：头像随身份绑定（room-state 广播用）
  };
  socket.on('auth-register', ({ username, password, displayName, avatar: avatarKey } = {}, callback) => {
    if (!callback) return;
    if (!validUsername(username)) return fail(callback, '用户名需 2~16 位（中英文/数字/下划线）');
    if (typeof password !== 'string' || password.length < 6) return fail(callback, '密码至少 6 位');
    /* ★ 09-24 修顺序 bug：限流检查必须**先于**落库。
     *   旧代码是"先 saveUsers 再 rateLimit"，于是被限流拒绝的注册请求**账号已经写进文件**了——
     *   这正是 users.json 里堆了 69 个 a_xxxxxx 之类测试账号的元凶：测试反复跑，
     *   每次都被限流挡在门外，但每条账号其实都已经落盘。先在内存里判、再落库，才对。 */
    if (!rateLimit(`reg:${clientIp(socket)}`, 30, 10 * 60000)) return fail(callback, '注册过于频繁，请稍后再试');
    if (store.getUser(username)) return fail(callback, '用户名已被注册');
    const salt = newSalt(); // ★ 09-24：盐的生成也统一走 sfu/password.js（同一个盐长度，不会漂移）
    const dn = (typeof displayName === 'string' && displayName.trim())
      ? displayName.trim().slice(0, 16) : username;
    let created;
    try {
      // 只存哈希：数据库泄露也拿不到原密码。role 不传 → 由 store 决定（首个账号 / 配置钦定 → admin）
      created = store.createUser({ username, salt, hash: hashPassword(password, salt), displayName: dn, avatar: AVATAR_PRESETS.has(avatarKey) ? avatarKey : null });
    } catch (e) {
      // 并发下唯一约束兜底（两个请求同时通过上面的 getUser 检查）
      return fail(callback, '用户名已被注册');
    }
    const token = issueToken(username);
    bindIdentity(username, created.displayName, created.avatar);
    logEvent('info', 'auth-register', { username, role: created.role, avatar: created.avatar || null });
    try { store.appendAudit('auth-register', username, { role: created.role }); } catch (e) { /* 审计失败不挡注册 */ }
    if (created.role === 'admin') {
      console.log(`🛡️ 已把 ${username} 设为首个管理员`
        + (created.autoAdmin ? '（系统还没有任何管理员，第一个注册的账号自动获得）' : '（config.json 的 adminUsername 指定）'));
    }
    console.log(`👤 注册成功: ${username}（昵称 ${created.displayName}）`);
    ok(callback, { user: { username, displayName: created.displayName, avatar: created.avatar || null }, token });
  });
  socket.on('auth-login', ({ username, password } = {}, callback) => {
    if (!callback) return;
    const u = store.getUser(username);
    // 用户不存在与密码错误给同一句提示：不向试探者泄露"用户名是否存在"
    if (!rateLimit(`login:${clientIp(socket)}`, 20, 60000)) return fail(callback, '尝试过于频繁，请一分钟后再试');
    if (!u || hashPassword(password, u.salt) !== u.hash) return fail(callback, '用户名或密码不对');
    const token = issueToken(username);
    bindIdentity(username, u.displayName, u.avatar);
    console.log(`👤 登录成功: ${username}`);
    ok(callback, { user: { username, displayName: u.displayName, avatar: u.avatar || null }, token });
  });
  socket.on('auth-verify', ({ username, token } = {}, callback) => {
    if (!callback) return;
    const u = store.getUser(username);
    if (!u || !validToken(token, username)) return fail(callback, '登录态已失效，请重新登录');
    bindIdentity(username, u.displayName, u.avatar);
    ok(callback, { user: { username, displayName: u.displayName, avatar: u.avatar || null } });
  });
  // ★ 09-19h G6-①：显式滑动续期（前端每小时调一次，长期值守不掉线）
  socket.on('auth-refresh', ({ username, token } = {}, callback) => {
    if (!callback) return;
    const u = store.getUser(username);
    if (!u || !validToken(token, username)) return fail(callback, '登录态已失效，请重新登录');
    ok(callback, { expiresAt: authTokens.get(token).expiresAt });
  });

  /* ---- 公共函数：真正把一个连接放进房间（创建/加入的"后半段"共用）---- */
  const joinRoom = async (roomNumber) => {
    const room = rooms.get(roomNumber);
    const members = room.members;

    if (members.size >= MAX_MEMBERS) {
      socket.emit('room-full', { max: MAX_MEMBERS });
      /* ★ 09-24 修 bug：这里原来只 `return;`（返回 undefined），而调用方
       *   （join-room / agent-hello）照旧回"进房成功"—— 于是出现**假成功**：
       *   桌面代理打印"已就绪"，房间里却根本没有它这个成员，控制端也找不到它。
       *   假成功是最阴的一类 bug：UI 说成功、实际没生效，用户只能靠"怎么没反应"猜。
       *   教训：**凡是"我做了某事"的函数，必须把成败如实返回给调用方**。 */
      return false;
    }

    // 进房前先把"媒体中枢 Router"准备好（第 1 个人负责把它建出来）
    await getOrCreateRouter(roomNumber);

    socket.join(roomNumber);        // socket.io 房间
    members.add(socket);            // 我们自己的成员表（存 socket 本体）
    socket.roomNumber = roomNumber;
    socket.joinedAt = Date.now();   // ★ D+4：进房次序（房主迁移要选"最早进房的幸存者"）
    socket.state = { muted: false, camOff: false, sharing: false, hand: false }; // 进房状态清零（重连也走这里）
    /* ★ 09-24 C4：给**这个成员自己**签一张房间内令牌（只对本房间有效）。
     * ▎为什么在这里签：创建/加入/代理报到三条路都汇到 joinRoom，签一次就全覆盖；
     *   断线重连（D6）会换新 socket.id 重新进房 → 自然拿到新令牌，属预期（旧的随旧 socket 作废）。
     * ▎令牌只挂在 socket 上、且**只在这个 socket 单独收到的载荷里回给它**（见下方 room-members）；
     *   所有"广播用"的成员快照（room-state / room-members 的 others 列表 / /api/rooms）都是显式投影，
     *   绝不含 roomToken——别人的令牌泄露等于把别人的会议记录给了你。 */
    socket.roomToken = signRoomToken(roomNumber);
    // ★ D+4：宽限期内有人回来/进来 → 取消销毁倒计时（房间"复活"）
    if (room.ttlTimer) {
      clearTimeout(room.ttlTimer);
      room.ttlTimer = null;
      room.emptySince = null;
      console.log(`⏳ 房间 ${roomNumber} 宽限期内有人进入，TTL 倒计时已取消`);
    }
    console.log(`[+] ${socket.id} 进入房间 ${roomNumber}（当前 ${members.size}/${MAX_MEMBERS} 人）`);
    logEvent('info', 'member-joined', { roomNumber, memberId: socket.id, count: members.size });

    // ① 告诉新人：房间里有谁 + 他们各上传了哪些媒体（Producer）。
    //    ★ 和 Mesh 不一样：新人不是去"连人"，而是去"订阅"老成员的 Producer。
    const others = [...members].filter((m) => m.id !== socket.id);
    const memberList = others.map((m) => ({
      id: m.id,
      name: m.displayName || null, // ★ 09-16：昵称贯通（未登录为 null → 前端回退"成员 xxxx"）
      producers: [...m.producers.values()].map((p) => ({
        producerId: p.id,
        kind: p.kind,
        appData: p.appData, // { source: 'mic'/'camera'/'screen' }，前端据此显示
      })),
      // ★ D+1：老成员的数据通道也一并报给新人（新人要订阅他们的"聊天频道"）
      dataProducers: [...m.dataProducers.values()].map((dp) => ({
        dataProducerId: dp.id,
        label: dp.label,
      })),
      agent: m.isAgent === true, // ★ 09-24：让新人一眼看出"这台是机器代理，可以控它电脑"
    }));   // ★ 注意：上面是**显式投影**，成员对象上的 roomToken 绝不出现在广播/他收的列表里
    /* ★ 09-24 C4：把**新人自己的** roomToken 附在这条"只发给它自己"的载荷里。
     *   room-members 是 socket.emit（单播给自己），不是 io.to(room) 广播——
     *   这就是"令牌只发给令牌所属的那个 socket"的落点，绝不用广播。 */
    socket.emit('room-members', { roomNumber, members: memberList, roomToken: socket.roomToken });

    // ② 通知老成员"来新人了"（老成员不用现在做什么，等他 produce 时会收到 new-producer）
    socket.to(roomNumber).emit('new-member', { id: socket.id });

    // ③ ★ D4 升级：全房广播最新的成员状态快照（进/退都要刷，否则成员列表停在旧人数）
    broadcastRoomState(roomNumber);

    // ④ ★ F2：房间有人了就开始"量网"定时器（幂等；成员列表的网络点用）
    startNetLevelBroadcaster(roomNumber);

    return true;   // ★ 09-24：明确回报"真的进成了"（见上面满员分支的说明）
  };

  /* ---- 房间相关事件（从 Mesh 版复制，逻辑几乎没变）---- */

  socket.on('create-room', async ({ password } = {}, callback) => {
    if (socket.roomNumber) { if (callback) return fail(callback, '已在房间里'); return; }
    const roomNumber = generateRoomNumber();
    rooms.set(roomNumber, {
      password: password || null,
      members: new Set(),
      router: null,               // Router 在 joinRoom 里懒创建
      ownerId: socket.id,         // ★ D4：房主（建房的这个人）——踢人权限只在他手里
      audioObserver: null,        // ★ D2：说话人检测观察者（第一路音频 Producer 出现时创建）
      producerOwner: new Map(),   // ★ D2/D4：producerId -> socketId（把"某路媒体"翻译回"某个人"）
      createdAt: Date.now(),      // ★ 09-13 观测面板：房间创建时间（算会议时长用）
      talk: new Map(),            // ★ 09-13 发言时长统计：socketId -> 累计发言秒数（D2 延伸）
    });
    console.log(`🆕 新房间已创建：${roomNumber}（创建者 ${socket.id}）${password ? '🔒 已设密码' : ''}`);
    logEvent('info', 'room-created', { roomNumber, by: socket.id, hasPassword: !!password });
    socket.emit('room-created', { roomNumber });
    await joinRoom(roomNumber);
    // ★ 09-24 C4：ack 也带上自己的 roomToken（前端即便没接 room-members 也能拿到）
    if (callback) ok(callback, { roomNumber, roomToken: socket.roomToken });
  });

  socket.on('join-room', async ({ roomNumber, password } = {}, callback) => {
    if (!rateLimit(`join:${socket.id}`, 20, 60000)) return; // ★ G6-③：防暴力猜 6 位房间号(静默丢弃,不给试探反馈)
    if (socket.roomNumber) { if (callback) return fail(callback, '已在房间里'); return; }
    if (!/^\d{6}$/.test(roomNumber || '')) {
      socket.emit('room-not-found', { roomNumber });
      if (callback) return fail(callback, '房间号格式不对');
      return;
    }
    const room = rooms.get(roomNumber);
    if (!room) {
      socket.emit('room-not-found', { roomNumber });
      if (callback) return fail(callback, '房间不存在');
      return;
    }
    if (room.password && room.password !== (password || '')) {
      socket.emit('room-wrong-password', { roomNumber });
      if (callback) return fail(callback, '密码不对');
      return;
    }
    const joined = await joinRoom(roomNumber);
    // ★ 09-24：joinRoom 现在会如实返回成败——满员时要明确报错，不能"假成功"
    //    ★ 09-24 C4：成功时带上本成员自己的 roomToken（只回给这个 socket，绝不广播）
    if (callback) return joined ? ok(callback, { roomNumber, roomToken: socket.roomToken }) : fail(callback, '房间已满');
  });

  /* ---- 事件 5.4b：★ 09-24 真远程桌面 —— 被控端"桌面代理"进房 ----
   *
   * ▎它解决什么？浏览器受安全沙箱限制，**不能**移动真实光标、敲真实键盘、截别的程序。
   *   所以真远程桌面必须有一个跑在被控电脑上的本地程序（agent/index.js）。
   *   这个事件就是那个本地程序的"报到"入口。
   *
   * ▎为什么不直接复用 join-room？（面试可讲的一个设计取舍）
   *   因为房间里从此有两种成员：**人**和**机器**。UI 要区分（🖥️ 徽标、"控制电脑"按钮文案），
   *   画面通道也不同（代理推的是 CDP 抓来的 JPEG 帧，不是 WebRTC 视频轨）。
   *   让服务器在报到时就打上标记，快照广播时带出去——前端照单渲染，不猜。
   *   （同 D4 的思路：状态放唯一权威处，别让每个客户端自己拼。）
   *
   * ▎安全：房间存在性 / 密码 / 人数上限，三道校验和 join-room 一字不差。
   *   **没有任何"代理特权"**——它只是"一个会自动应答授权的成员"。
   *   甚至可以说：agent 是房间里**权限最小**的成员，因为它不能推音视频、不能踢人、
   *   不能发聊天，只做"被控"这一件事。
   */
  socket.on('agent-hello', async ({ roomNumber, password, name, platform, browser } = {}, callback) => {
    if (socket.roomNumber) return fail(callback, '已在房间里');
    if (!/^\d{6}$/.test(roomNumber || '')) return fail(callback, '房间号格式不对');
    if (!rateLimit(`join:${socket.id}`, 20, 60000)) return fail(callback, '请求过于频繁');
    const room = rooms.get(roomNumber);
    if (!room) { socket.emit('room-not-found', { roomNumber }); return fail(callback, '房间不存在'); }
    if (room.password && room.password !== (password || '')) {
      socket.emit('room-wrong-password', { roomNumber }); return fail(callback, '密码不对');
    }
    if (room.members.size >= MAX_MEMBERS) {
      socket.emit('room-full', { max: MAX_MEMBERS }); return fail(callback, '房间已满');
    }

    socket.isAgent = true;
    socket.agentInfo = {
      platform: String(platform || '').slice(0, 40),
      browser: String(browser || '').slice(0, 40),
    };
    // 名字统一加 🖥️ 前缀：房间列表里"人"和"机器"一眼可辨（前端还会再画个徽标）
    socket.displayName = '🖥️ ' + (String(name || '').trim().slice(0, 20) || '桌面代理');

    const agJoined = await joinRoom(roomNumber);
    if (!agJoined) return fail(callback, '房间已满');   // ★ 09-24：满员要明确报错（防"假成功"）
    logEvent('info', 'agent-joined', { roomNumber, memberId: socket.id, name: socket.displayName });
    console.log(`🖥️ 桌面代理进房：${socket.displayName}（${socket.agentInfo.browser || '未知浏览器'}）→ 房间 ${roomNumber}`);
    // ★ 09-24 C4：代理也是"房间成员"，同样拿到自己的 roomToken（未来代理若直连内容接口也用得上）
    ok(callback, { roomNumber, memberId: socket.id, roomToken: socket.roomToken });
  });

  // 聊天（SFU 版方案 A：走服务器广播——见 SFU-BLUEPRINT.md 5.4）
  // ★ D+1 起聊天有两条路（前端双发 + 按 msgId 去重）：主路 = SCTP 数据通道（广播语义），
  //   兜底 = 这条信令广播（数据通道还没建立/建立失败的人也能收到）。服务器原样带 msgId。
  socket.on('chat-message', ({ text, msgId } = {}) => {
    if (!socket.roomNumber || typeof text !== 'string' || !text.trim()) return;
    { const _r = rooms.get(socket.roomNumber); if (_r) _r.lastActivity = Date.now(); } // ★ 09-26d 暖场计时源
    if (!rateLimit(`chat:${socket.id}`, 40, 10000)) return; // ★ G6-③：防刷屏(静默丢弃)
    // 广播给整个房间（包括自己），前端按 from 区分"我/别人"
    io.to(socket.roomNumber).emit('chat-message', {
      from: socket.id,
      name: socket.displayName || undefined, // ★ 09-16：昵称随消息广播（气泡显示用）
      text: text.slice(0, 500), // 粗暴限长，防刷屏
      ts: Date.now(),
      msgId: typeof msgId === 'string' ? msgId : undefined, // ★ D+1：去重用的消息号，原样透传
    });
  });

  /* ---- 事件 5.5：远程协助（后续升级方向 A1 · 照 Mesh 版抄一套，两处小改）----
   *
   * ▎流程（和 Mesh 版完全一致）：
   *   [控制端] 点视频框上的「请求控制」→ remote-request { to: 被控端 }
   *   [服务器] 查互斥（已有人被控 → 回 busy）→ 转发给被控端
   *   [被控端] 页面弹授权卡片 → remote-answer { ok: true/false }
   *   [服务器] 登记"谁控谁" → 全房广播 remote-state
   *
   * ▎和 Mesh 版的两处不同（面试讲点）：
   *   ① 成员校验：Mesh 的 members 存 socket id（Set<id>），直接 room.members.has(to)；
   *     SFU 的 members 存 socket 本体（读 Producer 要用），所以要现取每个人的 .id 比对。
   *   ② 输入通道：Mesh 授权后走 P2P ctrl_ DataChannel，服务器看不见鼠标键盘；
   *     SFU 浏览器之间没有连接，控制输入也得走服务器（remote-input 定向转发）——
   *     服务器顺手多了一道门禁：只转发"登记在册的控制端"发来的输入。
   */
  const isRoommate = (room, id) => [...room.members].some((m) => m.id === id);

  socket.on('remote-request', ({ to } = {}) => {
    const roomNumber = socket.roomNumber;
    const room = rooms.get(roomNumber);
    // 只有"同房间的人"才有资格申请控制（防御：防乱发给房间外的人）
    if (!room || !isRoommate(room, to)) {
      console.log(`[!] remote-request 静默拒绝：申请者 roomNumber=${roomNumber} to=${to}`);
      return;
    }

    // 互斥：这个房间已经有人在被控制 → 拒绝新申请（busy 回给申请者）
    const ctl = remoteCtl.get(roomNumber);
    if (ctl && ctl.controllerId) {
      socket.emit('remote-answer', { from: to, ok: false, reason: 'busy' });
      console.log(`[!] ${socket.id} 想控制 ${to}，但已被 ${ctl.controllerId} 控制`);
      return;
    }

    io.to(to).emit('remote-request', { from: socket.id }); // 放行：转给被控端
    console.log(`🖱️ ${socket.id} 请求控制 ${to}`);
  });

  /* ---- 事件 5.5b：★ A6 升级（2026-09-11）—— "限时授权"
   *
   * ▎被控端在授权卡片上选时长（60 秒 / 5 分钟 / 不限），允许时把 durationMs 一起传上来。
   *   服务器把到期时间戳记进 remoteCtl，并挂一个 setTimeout：
   *   到点自动 clearRemoteCtl(roomNumber, 'expired') → 全房复位 + 双方收到 remote-ended。
   *
   * ▎为什么"限时"要放服务器？（面试可讲"最小权限原则"）
   *   如果只在被控端本地计时，控制端可以无视（它只看服务器有没有收回）；
   *   把到期时间放在权威处，时间一到服务器直接撤权，任何人都赖不掉——
   *   这正是真实远程软件（向日葵/ToDesk 的"临时授权"）的做法。
   */
  socket.on('remote-answer', ({ to, ok, reason, durationMs } = {}) => {
    const roomNumber = socket.roomNumber;
    const room = rooms.get(roomNumber);
    if (!room || !isRoommate(room, to)) return;

    if (!ok) {
      // 被控端拒绝了 → 把"拒绝"转回给申请者。reason 透传：
      // 前端区分 'not-sharing'（对方没共享/没开协助）和普通拒绝；没带 reason 统一当 'denied'
      io.to(to).emit('remote-answer', { from: socket.id, ok: false, reason: reason || 'denied' });
      return;
    }

    // 允许了 → 再查一次互斥（防"两人同时被允许"的竞态），然后登记 + 全房广播
    const ctl = remoteCtl.get(roomNumber);
    if (ctl && ctl.controllerId && ctl.controllerId !== to) {
      io.to(to).emit('remote-answer', { from: socket.id, ok: false, reason: 'busy' });
      return;
    }
    if (ctl && ctl.timer) clearTimeout(ctl.timer); // 防御：旧记录的定时器先清掉

    // ★ A6：算法说明——durationMs 为 0/null/undefined = 不限时；否则算出绝对到期时间戳
    const valid = typeof durationMs === 'number' && durationMs > 0;
    const expiresAt = valid ? Date.now() + durationMs : null;
    const entry = { hostId: socket.id, controllerId: to, expiresAt, timer: null };

    if (expiresAt) {
      entry.timer = setTimeout(() => {
        // 到点：如果这一对还在，就撤权（clearRemoteCtl 会广播 remote-state + remote-ended）
        const cur = remoteCtl.get(roomNumber);
        if (cur && cur.hostId === socket.id && cur.controllerId === to) {
          clearRemoteCtl(roomNumber, 'expired');
        }
      }, durationMs);
    }
    remoteCtl.set(roomNumber, entry);
    logEvent('info', 'control-granted', { roomNumber, host: socket.id, controller: to, durationMs: durationMs || 0 });

    io.to(to).emit('remote-answer', { from: socket.id, ok: true, expiresAt });        // 回执给申请者
    io.to(roomNumber).emit('remote-state', { hostId: socket.id, controllerId: to, expiresAt }); // 广播全房
    broadcastRoomState(roomNumber);                                                   // ★ D4：快照同步
    console.log(`🖱️ 房间 ${roomNumber}：${to} 开始控制 ${socket.id}（授权方）`
      + (expiresAt ? `，${Math.round(durationMs / 1000)} 秒后自动到期` : '，不限时'));
  });

  // 释放控制：被控端收回 / 控制端主动放弃 都能触发
  socket.on('remote-release', () => {
    if (socket.roomNumber) clearRemoteCtl(socket.roomNumber);
  });

  /* ---- 事件 5.6：remote-input —— SFU 版的控制输入定向转发（Mesh 版没有这个事件）
   *
   * ▎它是什么？Mesh 版鼠标键盘走 P2P ctrl_ DataChannel；SFU 版浏览器只连服务器，
   *   所以控制端的每一条鼠标/键盘事件也要经服务器转一手才能到被控端——
   *   相当于把 Mesh 的"DataChannel 隧道"换成"信令定向转发"（比照 chat-message 改定向）。
   *
   * ▎⭐ 服务器门禁（SFU 版独有的安全点，面试可讲）：
   *   只有 remoteCtl 登记在册的"控制端"才能把输入发给登记在册的"被控端"。
   *   授权的生死簿在服务器手里，前端再怎么伪造都过不了这道门——
   *   对比 Mesh 版：DataChannel 建通后服务器就管不着了（P2P 的天性）。
   *
   * ▎轻量过滤：event 必须是"小对象"（字段数 ≤ 12）——防有人把大对象灌进来刷流量。
   *   真实产品还会加"限流"（每秒最多 N 条），教学版点到为止。
   *
   * ▎A5① 二进制帧的特别放行（重要坑，实修发现）：
   *   控制端升级后，鼠标/滚轮命令是 16 字节 ArrayBuffer 直接放进 event。
   *   socket.io 传输二进制时，到服务器手里会还原成 Node 的 Buffer（TypedArray 视图）——
   *   而 Object.keys(16 字节 Buffer) 会返回 16 个下标（"0"~"15"），照旧过滤就被误杀！
   *   所以先用 ArrayBuffer.isView 识别二进制帧，跳过字段数过滤（定长 16 字节
   *   本身就是上限，不存在大包问题）；转发原样透传，服务器不解析内容。
   */
  socket.on('remote-input', ({ to, event } = {}) => {
    if (!socket.roomNumber || !to || !event || typeof event !== 'object') return;
    // A5①：二进制帧（ArrayBuffer / TypedArray 视图）没有"字段"概念，跳过轻量过滤
    const isBinary = event instanceof ArrayBuffer || ArrayBuffer.isView(event);
    if (!isBinary && Object.keys(event).length > 12) return; // 超过 12 个字段的当垃圾包丢弃

    const ctl = remoteCtl.get(socket.roomNumber);
    if (!ctl || ctl.controllerId !== socket.id || ctl.hostId !== to) return; // 门禁

    io.to(to).emit('remote-input', { event }); // 定向转发给被控端

    /* ★ 09-24e AI 操作员闭环的观测源：把"这一次转发的结果"同步回给发送方。
     * ▎为什么服务端能给出比页面回执更可靠的信号：**在这一行，服务器自己就知道**
     *   目标 socket 还在不在房间（上面门禁已判定 hostId 匹配，这里再查一次在线状态）。
     *   如果被控端已经掉线，`io.to(to).emit` 是**静默失败**的——帧进了虚空，
     *   而调用方一无所知，于是出现最坏的情况：AI 报"任务完成"，实际一个点击都没落地。
     * ▎这条回执是给"AI 操作员自己"用的（它也是本服务器的一个 socket 客户端），
     *   对普通人类控制端无害（多收一条事件而已，前端不监听就无影响）。 */
    const targetPresent = !!rooms.get(socket.roomNumber)
      && [...rooms.get(socket.roomNumber).members].some((m) => m.id === to);
    socket.emit('remote-input-fwd-result', {
      ok: targetPresent, to, reason: targetPresent ? 'forwarded' : 'target-left', ts: Date.now(),
    });
  });

  /* ---- 事件 5.6b：★ 09-24 真远程桌面 —— 画面帧回传（方向刚好和 remote-input 相反）
   *
   * ▎方向：被控端（桌面代理）→ 服务器 → 控制端。
   *   remote-input 是"控制端 → 被控端"（发指令），这条是"被控端 → 控制端"（回画面）。
   *   两条合起来才构成闭环，也正好是真实远程桌面产品的最小骨架。
   *
   * ▎为什么不让 agent 直接把画面推给控制端？
   *   SFU 架构下浏览器之间没有直连（这正是 SFU 的定义），画面只能经服务器转。
   *   顺带好处：服务器**看得见**这条通道 —— 能限流、能计费、能审计，
   *   这是"中心化"换来的一种安全能力（Mesh 版 P2P 就给不了）。
   *
   * ▎三道门禁（比 remote-input 更严，因为这条通道流量大得多）：
   *   ① **身份闸**：发的人必须是桌面代理（isAgent）——人类浏览器没理由往这条通道灌数据；
   *   ② **授权闸**：必须是登记在册的"被控端"，且 to 必须正好是那一位控制端
   *      （防止代理把画面转给房间里的第三者围观）；
   *   ③ **体量闸**：单帧 ≤ 900KB + 帧率限流 120 帧/秒 —— 防"合法身份灌流量"。
   *      ★ 注意这里的原则：**即使是被控端自己起的可信程序，也不给超额权限**。
   *        信任 ≠ 免检查，这是纵深防御（defense in depth）的基本要求。
   */
  socket.on('remote-frame', ({ to, frame } = {}) => {
    const roomNumber = socket.roomNumber;
    if (!roomNumber || !to || !socket.isAgent) return;                   // ① 身份闸
    const isBinary = Buffer.isBuffer(frame) || ArrayBuffer.isView(frame) || frame instanceof ArrayBuffer;
    if (!isBinary) return;                                               // 只收二进制（比 base64 省 33% 带宽）
    const len = frame.byteLength || frame.length || 0;
    if (len === 0 || len > 900 * 1024) return;                           // ③ 大小闸
    if (!rateLimit(`frame:${socket.id}`, 120, 1000)) return;              // ③ 帧率闸
    const ctl = remoteCtl.get(roomNumber);
    if (!ctl || ctl.hostId !== socket.id || ctl.controllerId !== to) return; // ② 授权闸
    // volatile：控制端网络跟不上时**直接丢帧**，而不是在服务器内存里排队 ——
    //   实时画面宁可掉帧也不能延迟，这是所有实时系统的共同取舍（背压决策）。
    io.to(to).volatile.emit('remote-frame', { frame });
  });

  /* remote-meta：被控端回报"当前页面的 URL / 标题 / 视口尺寸"。
   * ▎用途：控制端的地址栏要显示**真实地址**（像真的浏览器一样），
   *   视口尺寸则让前端能把归一化坐标算得更准。
   * ▎频率很低（只在导航/窗口变化时发），所以走普通 emit（不 volatile）——
   *   状态类消息不能丢，丢一帧画面无所谓，丢一次 URL 会让地址栏停在旧地址。 */
  socket.on('remote-meta', ({ to, url, title, viewport } = {}) => {
    const roomNumber = socket.roomNumber;
    if (!roomNumber || !to || !socket.isAgent) return;
    const ctl = remoteCtl.get(roomNumber);
    if (!ctl || ctl.hostId !== socket.id || ctl.controllerId !== to) return;
    io.to(to).emit('remote-meta', {
      url: String(url || '').slice(0, 500),
      title: String(title || '').slice(0, 200),
      viewport: viewport && typeof viewport.width === 'number'
        ? { width: Math.round(viewport.width), height: Math.round(viewport.height) } : null,
      ts: Date.now(),
    });
  });

  /* ---- 事件 5.7：★ D4 升级（2026-09-11）—— 成员状态上报 + 踢人 ----
   *
   * ▎member-state：前端"我静音了/我关了摄像头/我开始共享了"时上报，服务器存下来再广播快照。
   *   为什么不信任前端？真实产品必须校验（比如"你没共享却报 sharing=true"要拦）。
   *   本 Demo 只做轻量约束：只接受这三个布尔字段，别的字段一律忽略（白名单式更新）。
   *
   * ▎kick-member：只有**房主**（建房的人）能踢。服务器不解释"为什么"，只执行：
   *   先把 kicked 通知给被踢的人（让他有时间显示提示），再断开他的连接——
   *   断开后走 disconnect 清理：关 Transport、清控制权、广播 room-state，全房人数立刻更新。
   *   ⚠️ 面试提醒：真实产品踢人还要"禁止重进"（黑名单），本 Demo 靠房间密码兜底，点到为止。
   */
  socket.on('member-state', ({ patch } = {}) => {
    if (!socket.roomNumber || !patch || typeof patch !== 'object') return;
    const next = { ...socket.state };
    // ★ 09-13：白名单新增 hand（举手，F4）——"我要发言"是全房都要看见的状态，
    //   和静音/关摄像头同一信任模型（客户端上报、服务器存储+广播）。
    // ★ 09-17b：白名单新增 caption（实时字幕开关）——"我开着字幕转写"同样是
    //   全房可见的状态（成员列表显示 💬 徽标），信任模型不变。
    for (const k of ['muted', 'camOff', 'sharing', 'hand', 'caption']) {
      if (typeof patch[k] === 'boolean') next[k] = patch[k]; // 白名单：只认这五个布尔字段
    }
    socket.state = next;
    broadcastRoomState(socket.roomNumber);
  });

  socket.on('kick-member', ({ to } = {}) => {
    const roomNumber = socket.roomNumber;
    const room = rooms.get(roomNumber);
    if (!room || !to) return;
    if (room.ownerId !== socket.id) {          // 权限门禁：不是房主 → 拒绝
      socket.emit('kick-denied', { to, reason: 'not-owner' });
      console.log(`[!] ${socket.id} 想踢 ${to}，但他不是房主`);
      return;
    }
    const target = [...room.members].find((m) => m.id === to);
    if (!target) return;
    console.log(`🚪 房主 ${socket.id} 将 ${to} 移出房间 ${roomNumber}`);
    target.emit('kicked', { by: socket.id, reason: 'owner-kick' });
    logEvent('warn', 'member-kicked', { roomNumber, by: socket.id, target: target.id });
    // 给前端 100ms 把提示画出来再断开（教学演示看得见；真实产品会直接断）
    setTimeout(() => target.disconnect(true), 100);
  });

  /* ---- 事件 5.8：★ A3 升级（2026-09-11）—— 剪贴板同步（双向，受控制关系约束）----
   *
   * ▎门禁规则（比 remote-input 更讲究）：只有当 socket 与 to 是"正在互相控制的那一对"时才转发。
   *   两种方向都放行：控制端 → 被控端（粘贴到对方工作台）、被控端 → 控制端（把内容带回本机）。
   * ▎为什么要限制？剪贴板是隐私数据，绝不能变成"房间里随便谁都能读我剪贴板"的通道。
   *   授权关系是唯一凭据——又一次"最小的权限、明确的范围"（面试话术）。
   */
  socket.on('clipboard-sync', ({ to, text, dir } = {}) => {
    const roomNumber = socket.roomNumber;
    const room = rooms.get(roomNumber);
    if (!room || !to || typeof text !== 'string' || !text) return;
    if (!isRoommate(room, to)) return;

    const ctl = remoteCtl.get(roomNumber);
    const allowedPair = ctl && (
      (ctl.controllerId === socket.id && ctl.hostId === to) ||   // 控制端 → 被控端
      (ctl.hostId === socket.id && ctl.controllerId === to)      // 被控端 → 控制端
    );
    if (!allowedPair) return; // 门禁：不在控制关系里，一律丢弃

    // dir 决定对端怎么处理（白名单式取值，别让前端塞任意字符串进来）：
    //   'ctl2host' 控制端 → 被控端（插进对方工作台）
    //   'host2ctl' 被控端 → 控制端（写进对方本机剪贴板）
    const safeDir = dir === 'host2ctl' ? 'host2ctl' : 'ctl2host';
    io.to(to).emit('clipboard-sync', { from: socket.id, text: text.slice(0, 100000), dir: safeDir }); // 限长防灌流量
    console.log(`📋 ${socket.id} → ${to} 同步剪贴板（${safeDir}，${text.length} 字）`);
  });

  /* ---- 事件 5.9：★ A4 升级（2026-09-11）—— 文件传输（服务器定向分块中继 + 配额校验）----
   *
   * ▎协议四步（和真实产品的"发送文件"流程一致）：
   *   ① file-offer  发送方告诉接收方"我想给你发个文件（名字/大小/类型）"
   *   ② file-answer 接收方接受/拒绝（拒绝就结束，发送方不浪费带宽）
   *   ③ file-chunk  逐个分块传（每块 ≤ 64KB，ArrayBuffer 二进制；socket.io 当附件搬运）
   *   ④ file-end    传完，接收方拼成 Blob 下载
   *
   * ▎⭐ 服务器在这里做两件"信令邮局做不到"的事（面试讲点）：
   *   ① **配额校验**：offer 里报了 size，服务器记住，chunk 累计超过就掐断并通知双方——
   *      防止有人挂着"小文件"的名义灌流量（真实的"防护式"设计）。
   *   ② 定向转发：只发给 to 那一个人（不像聊天是全房广播），且必须同房间。
   *
   * ▎和 Mesh 版的形态差异：Mesh 走 P2P DataChannel（点对点、不经服务器、能靠 bufferedAmount 做背压）；
   *   SFU 版浏览器之间没有连接，只能经服务器中转（多一跳，但服务器可审计/可限流）。
   */
  // 台账 fileTransfers 已在文件顶部（模块级）声明——因为它横跨两个连接，必须全局共享

  // 公共：把一个事件定向转发给房间里的某人（顺手做同房间校验）
  const relayTo = (to, event, payload) => {
    const room = rooms.get(socket.roomNumber);
    if (!room || !isRoommate(room, to)) return false;
    io.to(to).emit(event, payload);
    return true;
  };

  socket.on('file-offer', ({ to, fileId, name, size, mime } = {}) => {
    if (!socket.roomNumber || !fileId || typeof size !== 'number' || size <= 0) return;
    if (size > 200 * 1024 * 1024) { // 教学版上限 200MB，防手滑传超大文件把内存打爆
      socket.emit('file-abort', { fileId, reason: 'too-large' });
      return;
    }
    if (!relayTo(to, 'file-offer', {
      from: socket.id, fileId,
      name: String(name || 'file').slice(0, 200), // 文件名限长（防超长名字刷日志/UI）
      size, mime: String(mime || 'application/octet-stream').slice(0, 100),
    })) return;
    fileTransfers.set(fileId, { from: socket.id, to, size, received: 0 });
    console.log(`📎 ${socket.id} 要向 ${to} 发文件「${name}」（${Math.round(size / 1024)}KB）`);
  });

  socket.on('file-answer', ({ to, fileId, ok } = {}) => {
    if (!socket.roomNumber || !fileId) return;
    const t = fileTransfers.get(fileId);
    if (!t || t.to !== socket.id) return;  // 台账里没有 / 不是发给你的 → 忽略
    if (!ok) {
      fileTransfers.delete(fileId);
      io.to(t.from).emit('file-abort', { fileId, reason: 'rejected' });
      return;
    }
    fileTransfers.set(fileId, { ...t, accepted: true });
    relayTo(to, 'file-answer', { from: socket.id, fileId, ok: true });
  });

  socket.on('file-chunk', ({ to, fileId, seq, data } = {}) => {
    if (!socket.roomNumber || !fileId || !data) return;
    // 二进制块可能是 ArrayBuffer（浏览器发来）或 Buffer（Node 客户端发来），都要认
    const isBinary = data instanceof ArrayBuffer || ArrayBuffer.isView(data);
    if (!isBinary) return;
    const byteLength = data.byteLength !== undefined ? data.byteLength : data.length;
    if (byteLength > 64 * 1024) return;   // 单块上限 64KB（超了当垃圾包丢弃）

    const t = fileTransfers.get(fileId);
    if (!t || t.from !== socket.id) return;            // 台账校验：只能传自己发起的文件
    t.received += byteLength;
    if (t.received > t.size) {                          // ★ 配额校验：超发立即掐断
      fileTransfers.delete(fileId);
      io.to(t.to).emit('file-abort', { fileId, reason: 'quota-exceeded' });
      socket.emit('file-abort', { fileId, reason: 'quota-exceeded' });
      console.log(`[!] 文件 ${fileId} 超出申报大小，已掐断`);
      return;
    }
    relayTo(to, 'file-chunk', { from: socket.id, fileId, seq, data });
  });

  socket.on('file-end', ({ to, fileId } = {}) => {
    if (!socket.roomNumber || !fileId) return;
    const t = fileTransfers.get(fileId);
    if (!t || t.from !== socket.id) return;
    const received = t.received;
    fileTransfers.delete(fileId);
    relayTo(to, 'file-end', { from: socket.id, fileId, received });
    console.log(`📎 文件 ${fileId} 传输结束：${received}/${t.size} 字节`);
  });

  /* ---- 事件 6.0：★ D1 升级（2026-09-11）—— 消费者手动选层 ----
   * ▎spatialLayer:
   *   0 / 1 / 2 … = 指定第几层（0 = 最低清、数字越大越清晰）
   *   null        = 交回服务器自动（继续跑丢包率驱动的自动升降层）
   * ▎服务器要做的：① 改 consumer.setPreferredLayers；② 把该订阅者的监控状态切成手动/自动；
   *   ③ 回一个 layer-changed 让前端显示"当前实际用的层"。
   */
  /* ---- 事件 6.1：★ D+2 服务器侧录制 ----
   * ▎协议：C→S record-start { memberId | producerId } → 应答 { recordId }；
   *        C→S record-stop  { recordId } → 应答 { file }（文件名，经 /recordings/<file> 下载）。
   * ▎流程：按参数定位 Producer（成员的 camera+mic，或直接指定某一路）→ 核心逻辑在
   *   模块级 startRecording()（信令与 TEST_RECORD 端到端自测共用同一份代码）。
   */
  socket.on('record-start', async ({ memberId, producerId } = {}, callback) => {
    if (!socket.roomNumber) return fail(callback, '还没进房间');
    if (!FFMPEG_OK) {
      // ★ 09-17c：开机只做快探测（PATH），没找到时在这里才做一次深扫（winget 包目录），
      //   这样"启动慢"的问题不会转嫁到"录制永远不可用"上
      await resolveFfmpegDeep();
    }
    if (!FFMPEG_OK) {
      return fail(callback, '服务器未安装 ffmpeg，录制不可用（Windows: winget install Gyan.FFmpeg / macOS: brew install ffmpeg，装好重启）');
    }
    const room = rooms.get(socket.roomNumber);
    let tracks = [];
    if (producerId) {
      // 直接指定某一路（自测/高级用法）：在房间里找这路 Producer 的归属
      for (const m of room.members) {
        const p = m.producers.get(producerId);
        if (p) { tracks = [{ producer: p, kind: p.kind }]; break; }
      }
      if (!tracks.length) return fail(callback, '找不到这个 Producer（或不属于本房间）');
    } else {
      const target = room && [...room.members].find((m) => m.id === memberId);
      if (!target) return fail(callback, '找不到要录制的成员');
      const cam = [...target.producers.values()].find((p) => p.appData && p.appData.source === 'camera');
      const mic = [...target.producers.values()].find((p) => p.appData && p.appData.source === 'mic');
      if (!cam && !mic) return fail(callback, '该成员没有可录制的媒体（摄像头/麦克风都没开）');
      if (cam) tracks.push({ producer: cam, kind: 'video' });
      if (mic) tracks.push({ producer: mic, kind: 'audio' });
    }
    try {
      const rec = await startRecording({
        roomNumber: socket.roomNumber,
        router: room.router,
        tracks,
        label: `成员 ${memberId || producerId}`,
      });
      logEvent('info', 'record-start', { roomNumber: socket.roomNumber, recordId: rec.id, by: socket.id });
      ok(callback, { recordId: rec.id });
    } catch (err) {
      fail(callback, '录制启动失败：' + err.message);
    }
  });

  socket.on('record-stop', ({ recordId } = {}, callback) => {
    const rec = recordSessions.get(recordId);
    if (!rec) return fail(callback, '找不到这次录制（可能已结束）');
    rec.stop && rec.stop(); // 优雅收尾（写 muxer trailer），exit 回调统一清台账
    const base = rec.file ? path.basename(rec.file) : null;
    logEvent('info', 'record-stop', { recordId, by: socket.id, file: base });
    /* ★ 09-24 C4：把**短时效签名 URL** 一并回给录制者——/recordings/<文件> 已改成
     *   "admin 或签名 URL"才放行，非管理员的录制者必须靠这个 URL 才能下载自己的产物
     *   （默认 1 小时有效）。前端拿到后写进流程日志，用户可直接点/复制。 */
    ok(callback, { file: base, url: base ? signRecordingUrl(base) : null });
  });

  /* ---- ★ 09-19 AI Bot 参会者：ai-join / ai-leave / ai-ask（详见上方 AI 基建块注释）----
   * ▎ai-join/ai-leave：任何成员都能邀请/送走 AI 助理（教学版权限从宽；G6 权限分级可收紧）；
   * ▎ai-ask：向 bot 提问——应答以 chat-message(from='ai-bot') 广播全房（人人可见问答）。 */
  socket.on('ai-join', (payload = {}, callback) => {
    if (!socket.roomNumber || !rooms.get(socket.roomNumber)) return fail(callback, '先进入房间再邀请 AI 助理');
    ok(callback, { aiBot: setAiBot(socket.roomNumber, true) === true });
  });

  // ★ 09-26d：暖场开关（前端 AI 格子按钮；warmOn 存房间=全房一致）
  socket.on('ai-warm', (payload = {}, callback) => {
    const r = socket.roomNumber && rooms.get(socket.roomNumber);
    if (!r) return fail(callback, '先进入房间');
    r.warmOn = !!payload.on;
    if (r.warmOn) r.lastActivity = Date.now();
    ok(callback, { warmOn: r.warmOn });
  });

  socket.on('ai-leave', (payload = {}, callback) => {
    if (!socket.roomNumber || !rooms.get(socket.roomNumber)) return fail(callback, '不在房间里');
    ok(callback, { aiBot: setAiBot(socket.roomNumber, false) === true });
  });

  /* ★ 09-24 体验修复：以前 bot 不在房里的回答是冷冰冰的一句 fail(……需要先点 AI 助理按钮)。
   *   提问的人脑子里是"问 AI"，不是"先去按某个按钮"——自动邀请一次，才是符合直觉的助手。
   *   其余校验（不在房间 / 空问题）保持严格 fail，不放水。 */
  socket.on('ai-ask', async (payload = {}, callback) => {
    const roomNumber = socket.roomNumber;
    const room = roomNumber && rooms.get(roomNumber);
    if (!room) return fail(callback, '先进入房间再向 AI 助理提问');
    if (!room.aiBot) {
      /* quiet:true —— 人在等答案，不需要一段寒暄；
       * 否则寒暄会与答案抢同一条信道（详见 setAiBot 的 @param 注释，真缺陷）。 */
      setAiBot(roomNumber, true, { quiet: true });
      logEvent('info', 'ai-auto-join', { roomNumber, by: socket.id, why: 'ai-ask' });
    }
    const question = String(payload.question || '').trim().slice(0, 300);
    if (!question) return fail(callback, '问题不能为空');
    const streamId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    ok(callback, { started: true, streamId });   // 先回执（前线立即可渲染"思考中"气泡）

    /* ★ 流式打字机：每个增量立刻广播给全房（ai-stream），最后补一条完整 chat-message
     *   作为"权威终态"——为什么两份？流可被网络丢弃、可被晚进房的人错过，
     *   而 chat-message 走的是既有聊天台账（导出/去重/离线补帧都靠它）。
     *   增量先行保证手感，终态兜底保证不丢——和字幕"容忍丢 / 问答不容忍丢"同一套双路哲学。 */
    io.to(roomNumber).emit('ai-stream', { id: streamId, delta: '', done: false, start: true, mock: AI.aiEnabled() === false });
    io.to(roomNumber).emit('ai-state', { state: 'thinking' }); // ★ 09-26：动态头像状态机（LLM 推理期）
    const r = await aiBrain(roomNumber, question, (delta) => {
      io.to(roomNumber).emit('ai-stream', { id: streamId, delta, done: false });
    });
    /* ★ 09-24e：done 帧把"检索过程"一起送给前端（流式路径的增量期还不知道检索结果，
     *   等 aiBrain 返回才有）。前端在 done 时把它插进气泡——这样流式与一次性两条路径
     *   的信息披露完全一致（否则只有非流式能看到证据链，等于两条路径两种可信度）。 */
    const traceParts = [];
    if (r.totalDocs) {
      /* ★ 09-25：把检索范围写清楚——"本场会议 N 条"与"全档 M 条"（M>N 说明存档里还有
       *   房间号复用前 / 更早的会议记录）是两种不同强度的证据，用户有权知道。 */
      traceParts.push(r.scoped && r.allDocs > r.totalDocs
        ? `📚 本场检索 ${r.totalDocs} 条字幕取 ${(r.hits || []).length} 条（全档 ${r.allDocs} 条）`
        : `📚 检索 ${r.totalDocs} 条字幕取 ${(r.hits || []).length} 条`);
    }
    if (r.turns > 1) traceParts.push(`💬 第 ${r.turns} 轮`);
    /* ★ 09-25：把"多查询改写"写进证据链。它是**答案可信度的一部分**——
     *   "我第一遍没找到，是靠把问题改写成别的说法才找到的"与"我直接就找到了"，
     *   是两种不同的确定程度；静默处理等于偷偷降低了透明度。 */
    if (r.rewrites) {
      traceParts.push(`🔄 原问法召回不足（覆盖率 ${r.rewrites.topCoverBefore}），`
        + `已用 ${r.rewrites.used} 条改写查询融合检索`);
    }
    if (r.intent && r.intent !== 'question') {
      traceParts.push(`🎯 ${({ minutes: '生成纪要', recap: '回顾', operator: '远程操作' })[r.intent] || r.intent}`);
    }
    io.to(roomNumber).emit('ai-stream', {
      id: streamId, delta: '', done: true, mock: !!r.mock, trace: traceParts.join(' · '),
      // ★ 09-25：流式路径也要带证据原话（否则两条路径的信息披露不一致 = 两种可信度）
      hitList: r.evidence || [],
    });
    io.to(roomNumber).emit('ai-state', { state: 'speaking', text: r.text }); // ★ 09-26b：播报期带全文（前端逐字字幕）
    // 兜底归位：各端 TTS 读完本地自然回 idle；无 TTS 端按答案长度估时归位
    setTimeout(() => io.to(roomNumber).emit('ai-state', { state: 'idle' }),
      Math.min(12000, 2000 + (r.text || '').length * 90));
    io.to(roomNumber).emit('chat-message', {
      from: 'ai-bot', name: '🤖 AI 小明', text: r.text, ts: Date.now(), streamId,
      /* ★ 09-24e：把"这条答案是怎么来的"一起广播出去——检索自几千条字幕里的哪几条、
       *   这是第几轮追问、意图是什么。**智能不该是玄学**：用户能看到 AI 真的去查了会议记录，
       *   而不是凭空编了一段话。这也是最有力的"AI 不是空壳"的现场证据。
       * ★ 09-25 增 scoped/allDocs：证据的**时间范围**同样属于可信度信息。 */
      ai: {
        mock: !!r.mock, tokens: (r.usage && r.usage.totalTokens) || 0,
        file: r.file || null, path: r.path || null,
        intent: r.intent || null, turns: r.turns || 0,
        hits: (r.hits || []).length, usedHits: r.usedHits || 0, totalDocs: r.totalDocs || 0,
        scoped: !!r.scoped, allDocs: r.allDocs || 0,
        /* ★ 09-25：把**答案真正的依据**原话一起发给前端（此前只发条数，且固定取检索命中）。
         *   ▎`r.evidence` 已经是"哪个来源驱动了答案就展示哪个"（见 aiBrain 里的说明）——
         *     注入了看板证据就是那些条目，否则才是检索命中的字幕。
         *     用户能真正核对"AI 是照着我说的/看板上的哪句话回答的"：
         *     **可验证从口号变成事实**（光有数字仍然只能选择相信）。 */
        hitList: r.evidence || [],
      },
    });
    logEvent('info', 'ai-ask', {
      roomNumber, by: socket.id, qLen: question.length, mock: !!r.mock,
      tokens: (r.usage && r.usage.totalTokens) || 0, intent: r.intent || null,
      hits: (r.hits || []).length, docs: r.totalDocs || 0, turns: r.turns || 0,
    });
  });

  /* ★ 09-25：取当前会议看板快照。
   * ▎为什么需要这个"拉"的接口（而不只靠 ai-board 广播）：
   *   ai-board 是**推**模式——只在有新增时广播。晚进房的人（或刷新页面的人）
   *   会错过之前所有的广播，界面就是一块空板。所以必须有"拉一次全量"的路径。
   *   推+拉并存是这类实时看板的标准做法：推保证实时，拉保证完整。 */
  socket.on('ai-board-get', (payload = {}, callback) => {
    const roomNumber = socket.roomNumber;
    if (!roomNumber || !rooms.get(roomNumber)) return fail(callback, '先进入房间');
    const b = roomBoards.get(roomNumber);
    ok(callback, b ? b.snapshot() : { counts: { decision: 0, risk: 0, todo: 0, topic: 0 }, items: { decision: [], risk: [], todo: [], topic: [] }, total: 0 });
  });

  // ★ 09-19c N2：手动生成纪要（不需要 bot 在场——纪要吃的是字幕账本，人人可取）
  socket.on('ai-minutes', async (payload = {}, callback) => {
    if (!socket.roomNumber || !rooms.get(socket.roomNumber)) return fail(callback, '先进入房间再生成纪要');
    /* ★ 09-25：多了一种 type = 'merge'（跨段归并）。
     *   它和分段/终稿是**同一件事的不同粒度**：分段=1 小时，终稿=本次会议，
     *   归并=把已有的分段合成一份"这场会到底发生了什么"。
     *   之所以挂在同一个信令上而不是新开一个：调用方（按钮/脚本）拿到的回执结构完全一致，
     *   前端不需要为它写第二套错误处理（"只有一份纪要无需归并"这类提示直接走同一条路）。 */
    const type = payload.type === 'final' ? 'final'
      : (payload.type === 'merge' ? 'merge' : 'segment');
    const since = Number(payload.since) || 0;
    try {
      const r = type === 'merge'
        ? await mergeMinutes(socket.roomNumber)
        : await buildMinutes(socket.roomNumber, { type, since });
      const label = type === 'final' ? '终稿' : (type === 'merge' ? '跨段归并' : '分段');
      io.to(socket.roomNumber).emit('chat-message', {
        from: 'ai-bot', name: '🤖 AI 小明',
        text: `📋 ${label}纪要已生成：${r.path}${r.mock ? '（[Mock] 本地模板）' : ''}`
          + (type === 'merge' ? `（归并了 ${r.sources} 份分段纪要）` : ''),
        ts: Date.now(),
      });
      ok(callback, { file: r.file, path: r.path, mock: r.mock, sources: r.sources || 0 });
    } catch (err) {
      /* ★ 09-25：区分"用户可理解的业务拒绝"与"真出了故障"。
       *   "只有一份纪要，无需归并"这类不是失败，是**正常的业务边界**，
       *   前面挂上"纪要生成失败："会让用户以为系统坏了（实际是他点的时机不对）。
       *   mergeMinutes 用 err.userFacing 标记这类情况。 */
      fail(callback, err.userFacing ? err.message : ('纪要生成失败：' + err.message));
    }
  });

  /* ★ 09-25 认领行动项：把 AI 的抽取结果变成**可执行**的。
   * ▎为什么需要这一步：看板此前只是"看"——它明明白白写着「TURN 轮换 待认领」，
   *   而用户能做的只有"自己记住、会后再找人"。把"认领"做成一个点击动作，
   *   看板就从**信息**变成了**协作界面**——这才是"AI 参会"真正落地的地方：
   *   它提出问题，人在同一个界面里解决问题。
   * ▎为什么由服务器记账而不是前端改本地状态：认领结果必须**全房一致**
   *   （否则两个人同时认领会各自看到不同的负责人，事后必然扯皮）。
   *   服务器是房间里唯一的权威，认领这种"有争议可能"的写操作必须走它。 */
  socket.on('ai-board-claim', (payload = {}, callback) => {
    const roomNumber = socket.roomNumber;
    const room = roomNumber && rooms.get(roomNumber);
    if (!room) return fail(callback, '先进入房间再认领');
    const board = roomBoards.get(roomNumber);
    if (!board) return fail(callback, '看板上还没有行动项');
    const ts = Number(payload.ts);
    const item = board.items.todo.find((t) => t.ts === ts);
    if (!item) return fail(callback, '这条行动项已不在看板上（可能已超出保留上限）');
    /* 已被认领 → 明确告知是谁，而不是静默覆盖。
     * ▎"静默覆盖"是这类协作功能最容易埋下的坑：两个人都以为是自己，
     *   而系统只留下最后一个。宁可当场拒绝并说清，也不要制造一个隐性冲突。 */
    if (item.owner) return fail(callback, `已被 ${item.owner} 认领`);
    const who = socket.displayName || `成员 ${String(socket.id).slice(-4)}`;
    item.owner = who;
    io.to(roomNumber).emit('ai-board', { ...board.snapshot(), added: {}, ts: Date.now() });
    // AI 把认领结果**复述一遍**：既是对认领人的确认，也是给全房留一条可查的记录
    emitBotSay(roomNumber,
      `✅ 已记下：**${who}** 认领「${item.task || item.text}」${item.due ? `（期限 ${item.due}）` : ''}。`);
    logEvent('info', 'ai-board-claim', {
      roomNumber, by: socket.id, who, task: String(item.task || item.text).slice(0, 60),
    });
    ok(callback, { owner: who });
  });

  // ★ 09-19f G8-③：ping 探活（bench-signaling 的 RTT 探针；也是运维探活的轻量信令）
  socket.on('ping', (payload = {}, callback) => {
    if (typeof callback === 'function') callback({ data: { t: Date.now() } });
  });

  /* ---- ★ 09-19g C1：AI 远程操作员（ReAct 式工具循环 × 控制协议）----
   * ▎核心设计：**AI 与人类控制端在协议层完全平等**——服务器自己开一条 socket.io
   *   客户端连接（botSocket），走与人类一模一样的 remote-request → 被控端授权卡 →
   *   remote-answer → remote-input 门禁转发 → remote-release。**授权绝不豁免**：
   *   被控端可以拒绝、可以限时长，被控端的审计日志照记 AI 的每一个输入。
   * ▎为什么不"借用发起者 socket 发输入"？那会破坏门禁语义（controllerId 校验）——
   *   门禁的价值就是"只有服务器在册的那个控制端能发输入"，AI 必须在册。
   * ▎双轨：DEEPSEEK_API_KEY 存在 → LLM 把目标翻成操作 JSON 计划；无 key/失败 →
   *   本地 Mock 脚本（确定性演示：打开计算器按 7×8）。计划生成后顺序执行。
   * ▎诚实定位：教学版是"计划-执行"型 agent——ReAct 的 Observation 回环
   *   （每步之后拿屏幕状态反馈给 LLM 修正）是明确的升级点，注释里画了插口。
   */
  socket.on('ai-op', async (payload = {}, callback) => {
    const roomNumber = socket.roomNumber;
    const room = roomNumber && rooms.get(roomNumber);
    if (!room) return fail(callback, '先进入房间再召唤 AI 操作员');
    if (aiOpBusy) return fail(callback, 'AI 操作员正在执行上一个任务，稍后再试');
    // 被控端 = 正在共享屏幕并开着"允许远程协助"的人（和人类控制端找的是同一个人）
    const host = [...room.members].find((m) => m.state && m.state.sharing);
    if (!host) return fail(callback, '先有人共享屏幕并打开「允许远程协助」，AI 操作员才有用武之地');
    console.log(`🛰️ [ai-op] host=${host.id} room=${roomNumber} members=${room.members.size}`);
    const goal = String(payload.goal || '').trim().slice(0, 200) || '演示：打开计算器按 7×8';

    aiOpBusy = true;
    io.to(roomNumber).emit('ai-state', { state: 'thinking' });
    ok(callback, { started: true, goal });
    logEvent('info', 'ai-op-start', { roomNumber, by: socket.id, goal });
    io.to(roomNumber).emit('chat-message', {
      from: 'ai-bot', name: '🤖 AI 操作员', text: `🛰️ 收到目标「${goal}」——正在向被控端发起授权请求（与人类控制端同一套授权卡）`, ts: Date.now(),
    });

    try {
      await runAiOperator(roomNumber, host.id, goal);
    } catch (err) {
      io.to(roomNumber).emit('chat-message', {
        from: 'ai-bot', name: '🤖 AI 操作员', text: `⚠️ 任务中止：${err.message}`, ts: Date.now(),
      });
      logEvent('warn', 'ai-op-abort', { roomNumber, reason: err.message });
    } finally {
      aiOpBusy = false;
    }
  });

  socket.on('set-preferred-layers', async ({ consumerId, spatialLayer } = {}, callback) => {
    const consumer = socket.consumers.get(consumerId);
    if (!consumer) { if (callback) fail(callback, '找不到这个 Consumer'); return; }
    const monitor = socket.layerMonitors.get(consumerId);
    try {
      if (spatialLayer === null || spatialLayer === undefined) {
        // 回到自动：把层交还给监控逻辑（它会按丢包率自己升/降）
        if (monitor) { monitor.auto = true; monitor.lastUpAt = 0; }
        socket.emit('layer-changed', {
          consumerId, producerId: consumer.producerId,
          spatialLayer: consumer.currentLayers ? consumer.currentLayers.spatialLayer : 0,
          layerCount: monitor ? monitor.layerCount : 1,
          auto: true, reason: 'manual-auto',
        });
      } else {
        const layer = Math.max(0, Math.floor(spatialLayer));
        if (monitor) { monitor.auto = false; monitor.current = layer; }
        await consumer.setPreferredLayers({ spatialLayer: layer });
        socket.emit('layer-changed', {
          consumerId, producerId: consumer.producerId,
          spatialLayer: layer,
          layerCount: monitor ? monitor.layerCount : 1,
          auto: false, reason: 'manual',
        });
      }
      if (callback) ok(callback, {});
    } catch (err) {
      if (callback) fail(callback, `切层失败：${err.message}`);
    }
  });


  /* ---- 媒体协商事件（★ SFU 版全新的部分）----
   * 请求都用 socket.io 回调做应答：成功 ok(callback, 数据)，失败 fail(callback, 错误)。
   */

  // ① 客户端要这个房间 Router 的"能力清单"（支持哪些编码），用于初始化 mediasoup Device
  socket.on('get-router-rtp-capabilities', async (payload, callback) => {
    if (!socket.roomNumber) return fail(callback, '还没进房间');
    const room = rooms.get(socket.roomNumber);
    if (!room || !room.router) return fail(callback, '房间媒体未就绪');
    ok(callback, { rtpCapabilities: room.router.rtpCapabilities });
  });

  // ② 客户端要一条媒体通道（direction: 'send' 上传用 / 'recv' 接收用）
  socket.on('create-webrtc-transport', async ({ direction } = {}, callback) => {
    if (!socket.roomNumber) return fail(callback, '还没进房间');
    if (direction !== 'send' && direction !== 'recv') return fail(callback, 'direction 必须是 send/recv');

    const room = rooms.get(socket.roomNumber);
    const router = room.router;

    // 每个人固定两条 Transport，别重复建
    const slot = direction === 'send' ? 'sendTransport' : 'recvTransport';
    if (socket[slot]) return fail(callback, `${direction} Transport 已存在`);

    const transport = await router.createWebRtcTransport({
      listenIps: ANNOUNCED_IP
        ? [{ ip: LISTEN_IP, announcedIp: ANNOUNCED_IP }]
        : [{ ip: LISTEN_IP }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      /* ★ D+1 升级（2026-09-12）：SFU 数据通道（SCTP）
       * ▎mediasoup 的媒体走 RTP/UDP，数据（聊天/文件/自定义消息）走 SCTP——
       *   就是 WebRTC DataChannel 在 SFU 里的"正统形态"：DataProducer/DataConsumer。
       * ▎开 SCTP 只需两行：enableSctp 打开开关，numSctpStreams 声明流数量
       *   （OS = 我方发起的流数，MIS = 允许对方发起的流数，1024 足够教学用）。
       * ▎开完之后 create-webrtc-transport 的应答会多带一份 sctpParameters，
       *   浏览器端 mediasoup-client 建通道时用得上（没有它 produceData 会报错）。
       * ▎语义注意（面试讲点）：mediasoup 数据通道是**广播**的——一个人 produceData，
       *   全房订阅的人都能收到。"只发给某人"要在应用层给消息加目标头自己过滤。 */
      enableSctp: true,
      numSctpStreams: { OS: 1024, MIS: 1024 },
      appData: { direction }, // 记一下这条通道是发还是收
    });

    socket[slot] = transport;
    console.log(`🚪 ${socket.id} 创建 ${direction} Transport（${transport.id}）`);

    // 通道断了/关闭时，把它上挂的 Producer/Consumer 从账本清掉
    transport.on('close', () => {
      console.log(`🚪 ${socket.id} 的 ${direction} Transport 关闭`);
      if (socket[slot] === transport) socket[slot] = null;
    });

    // 把服务器这一端的"连接参数"回给浏览器，浏览器要用它们建 mediasoup-client Transport
    ok(callback, {
      transportId: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      // ★ D+1：SCTP 参数（开了 enableSctp 就有）——浏览器 createSendTransport 必须带上
      sctpParameters: transport.sctpParameters,
    });
  });

  // ③ DTLS 握手：浏览器拿到参数后调 transport.connect()，把参数发回来完成握手
  socket.on('transport-connect', async ({ transportId, dtlsParameters } = {}, callback) => {
    const transport = [socket.sendTransport, socket.recvTransport]
      .find((t) => t && t.id === transportId);
    if (!transport) return fail(callback, '找不到这条 Transport');
    await transport.connect({ dtlsParameters });
    ok(callback, {});
  });

  // ④ 上传：浏览器把摄像头/麦克风/屏幕轨道 produce 到服务器
  socket.on('produce', async ({ transportId, kind, rtpParameters, appData } = {}, callback) => {
    if (!socket.roomNumber) return fail(callback, '还没进房间');
    const transport = [socket.sendTransport, socket.recvTransport]
      .find((t) => t && t.id === transportId);
    if (!transport) return fail(callback, '找不到这条 Transport');
    if (kind !== 'audio' && kind !== 'video') return fail(callback, 'kind 必须是 audio/video');

    // mediasoup 在服务器这一端建 Producer（之后它负责把 RTP 转发给订阅的人）
    // ▎★ D1 注：如果客户端 produce 时带了 simulcast，低/中/高三档的信息就在
    //   rtpParameters.encodings 里（每档一个 rid），服务器**不用改一行**就能收下——
    //   "分层编码是发送端的事，服务器只负责按层转发"（这就是 SFU 的优雅之处）。
    const producer = await transport.produce({ kind, rtpParameters, appData });
    socket.producers.set(producer.id, producer);
    // ★ 09-19 AI Bot：bot 在场时新音频路自动补管线（bot 入会后才开始共享/开麦的人也能被听见）
    const aiRoom = rooms.get(socket.roomNumber);
    if (aiRoom && aiRoom.aiBot && producer.kind === 'audio') {
      startAiAudioPipe(socket.roomNumber, producer, socket.id);
    }

    // ★ D2/D4：记下"这路媒体属于谁"——AudioLevelObserver 只给 producerId，
    //   要翻译成"哪个人在说话"必须靠这张表。
    const room = rooms.get(socket.roomNumber);
    if (room) room.producerOwner.set(producer.id, socket.id);

    console.log(`📤 ${socket.id} 上传了一路 ${kind}（${producer.id}，source=${(appData || {}).source || '?'}`
      + `${(rtpParameters.encodings || []).length > 1 ? `，simulcast ${rtpParameters.encodings.length} 层` : ''}）`);

    // ★ D2：音频路挂进"说话人检测"观察者（第一次用时才创建观察者，省资源）
    if (kind === 'audio' && room) {
      try {
        const observer = await getOrCreateAudioObserver(socket.roomNumber);
        if (observer) await observer.addProducer({ producerId: producer.id });
      } catch (err) {
        console.warn('⚠️ 加入说话人检测失败（不影响通话）:', err.message);
      }
    }

    // 广播给房间里其他人："有人开新路了，快来订阅"
    socket.to(socket.roomNumber).emit('new-producer', {
      producerId: producer.id,
      kind,
      appData,
      from: socket.id,
      // ★ D1：把"有几层"告诉订阅者，前端才能画"低/中/高"选层器
      layerCount: (rtpParameters.encodings || []).length || 1,
    });

    ok(callback, { producerId: producer.id });
  });

  // ⑤ 关闭一路上传（比如停止共享屏幕）
  socket.on('close-producer', async ({ producerId } = {}, callback) => {
    const producer = socket.producers.get(producerId);
    if (!producer) return fail(callback, '找不到这个 Producer');
    producer.close();
    socket.producers.delete(producerId);
    // ★ D2/D4：这路媒体的归属台账也要清（否则"已关闭的 producerId"会一直留在表里）
    const room = rooms.get(socket.roomNumber);
    if (room) room.producerOwner.delete(producerId);
    socket.to(socket.roomNumber).emit('producer-closed', { producerId, from: socket.id });
    ok(callback, {});
  });

  /* ---- ⑤b ★ D+1 升级（2026-09-12）：SFU 数据通道（DataProducer/DataConsumer）----
   *
   * ▎为什么要有它？到目前为止聊天/文件都走信令通道（socket.io），这是教学妥协——
   *   真正的 SFU 产品里"房间内广播消息"走的是媒体连接里的 **SCTP 数据通道**：
   *   和音视频同一条 DTLS/ICE 链路、不占信令带宽、有原生的有序/重传语义。
   *
   * ▎mediasoup 的数据通道分工（和媒体 Producer/Consumer 一模一样，只是换了个名词）：
   *   · 浏览器 produceData() → 服务器 produceData() = 开一条"我的广播频道"（DataProducer）
   *   · 别人 consumeData(那个频道id) → 服务器 consumeData() = 订阅这条频道（DataConsumer）
   *   · 之后浏览器 .send() 的每条消息，mediasoup 自动转给所有订阅者——服务器不用写转发循环！
   *
   * ▎和 produce/consume 的对应关系（对照着记最好懂）：
   *   produce        ←→ produce-data        （浏览器的 'producedata' 事件带 sctpStreamParameters，
   *                                            相当于媒体的 rtpParameters，要透传给服务器）
   *   consume        ←→ consume-data        （不用 canConsume / 不用 resume——数据通道没这两步）
   *   new-producer   ←→ new-data-producer   （广播"我开了新频道，快来订阅"）
   *   producer-closed←→ data-producer-closed （关频道要通知大家退订）
   *
   * ▎语义注意：这是**广播**频道——"只发给某个人"要在应用层给消息加 to 字段，
   *   收到的人自己过滤（A4 文件传输若迁过来就是这么做的，取舍见 protocol.js 注释）。
   */
  socket.on('produce-data', async ({ transportId, sctpStreamParameters, label, appData } = {}, callback) => {
    if (!socket.roomNumber) return fail(callback, '还没进房间');
    if (!socket.sendTransport || socket.sendTransport.id !== transportId) {
      return fail(callback, '找不到这条 Transport');
    }
    // 浏览器端已生成的 SCTP 流参数必须带过来（相当于媒体的 rtpParameters）——
    //   不带的话服务器会自作主张分配流号，和浏览器对不上，消息就走不通
    if (!sctpStreamParameters || typeof sctpStreamParameters !== 'object') {
      return fail(callback, '缺少 sctpStreamParameters（应由 mediasoup-client 的 producedata 事件提供）');
    }
    const dataProducer = await socket.sendTransport.produceData({
      sctpStreamParameters,
      label: typeof label === 'string' ? label : 'chat',
      appData,
    });
    socket.dataProducers.set(dataProducer.id, dataProducer);
    console.log(`🛰️ ${socket.id} 开了一条数据通道（${dataProducer.id}，label=${dataProducer.label}）`);

    // 广播给房间里其他人："我开了广播频道，快来订阅"（和 new-producer 同理）
    socket.to(socket.roomNumber).emit('new-data-producer', {
      dataProducerId: dataProducer.id,
      label: dataProducer.label,
      from: socket.id,
    });
    ok(callback, { dataProducerId: dataProducer.id });
  });

  socket.on('consume-data', async ({ transportId, dataProducerId } = {}, callback) => {
    if (!socket.roomNumber) return fail(callback, '还没进房间');
    const transport = [socket.sendTransport, socket.recvTransport]
      .find((t) => t && t.id === transportId);
    if (!transport) return fail(callback, '找不到这条 Transport');
    if (!transport.sctpParameters) return fail(callback, '这条 Transport 没开 SCTP');
    try {
      // 建 DataConsumer：mediasoup 从此把那个频道的消息转发给这条 Transport
      const dataConsumer = await transport.consumeData({ dataProducerId });
      socket.dataConsumers.set(dataConsumer.id, dataConsumer);
      // 数据通道建好即用（没有媒体 Consumer 的"暂停-恢复"两步）
      ok(callback, {
        dataConsumerId: dataConsumer.id,
        dataProducerId: dataConsumer.dataProducerId,
        label: dataConsumer.label,
        protocol: dataConsumer.protocol,
        sctpStreamParameters: dataConsumer.sctpStreamParameters,
      });
    } catch (err) {
      // 订阅不存在的频道是用户可触发的错误，走错误应答而不是让服务器崩掉
      return fail(callback, `订阅数据通道失败：${err.message}`);
    }
  });

  socket.on('close-data-producer', ({ dataProducerId } = {}, callback) => {
    const dp = socket.dataProducers.get(dataProducerId);
    if (!dp) return fail(callback, '找不到这个 DataProducer');
    dp.close();
    socket.dataProducers.delete(dataProducerId);
    // 通知大家退订（和 producer-closed 同理）
    socket.to(socket.roomNumber).emit('data-producer-closed', { dataProducerId, from: socket.id });
    ok(callback, {});
  });

  // ⑥ 订阅：客户端想收"某个人的某一路 Producer"
  socket.on('consume', async ({ transportId, producerId, rtpCapabilities } = {}, callback) => {
    if (!socket.roomNumber) return fail(callback, '还没进房间');
    const room = rooms.get(socket.roomNumber);
    const router = room.router;

    const transport = [socket.sendTransport, socket.recvTransport]
      .find((t) => t && t.id === transportId);
    if (!transport) return fail(callback, '找不到这条 Transport');

    // 先确认：这个房间的 Router 有能力把该 Producer 的媒体转给这位订阅者
    if (!router.canConsume({ producerId, rtpCapabilities })) {
      return fail(callback, '该 Producer 无法被此客户端消费');
    }

    // 建 Consumer：mediasoup 从此把该 Producer 的媒体"转发"给这条 recv Transport
    const consumer = await transport.consume({ producerId, rtpCapabilities });
    socket.consumers.set(consumer.id, consumer);
    // 刚建出来的 Consumer 是暂停的，resume() 之后才开始真正送数据（经典坑）
    await consumer.resume();

    /* ★ D1 升级（2026-09-11）：Simulcast 自动选层
     * ▎先看这个 Producer 到底有几层（1 层 = 没开 simulcast，就不用管）。
     *   层数来自 Producer 的 rtpParameters.encodings——上传端的"分层信息"在服务器这边也看得到。
     * ▎有 2 层以上才挂"选层监控"：每 2 秒看一次丢包率，差就降层、好就升层。
     *   初始一律选**最高层**（清晰优先），网络变差再自动往下降。
     */
    let layerCount = 1;
    try {
      const owner = [...room.members].find((m) => m.producers.has(producerId));
      const up = owner && owner.producers.get(producerId);
      layerCount = up && up.rtpParameters.encodings ? up.rtpParameters.encodings.length : 1;
    } catch (e) { layerCount = 1; }

    if (consumer.kind === 'video' && layerCount > 1) {
      const monitor = startLayerMonitor(socket, consumer, layerCount);
      socket.layerMonitors.set(consumer.id, monitor);
      // 告诉订阅者"这路有 N 层、我默认给你最高的"，前端据此显示选层器
      socket.emit('layer-changed', {
        consumerId: consumer.id, producerId, spatialLayer: layerCount - 1,
        layerCount, auto: true, reason: 'initial',
      });
      console.log(`🎚️ ${socket.id} 订阅了 ${layerCount} 层 simulcast 视频（默认第 ${layerCount}/${layerCount} 层）`);
    }

    // 订阅者的上游 Producer 关了 → 通知这个客户端删画面
    consumer.on('producerclose', () => {
      socket.emit('consumer-closed', { consumerId: consumer.id, producerId });
      socket.consumers.delete(consumer.id);
      // ★ D1：顺带停掉这路 consumer 的选层监控（不停 = 定时器泄漏）
      const m = socket.layerMonitors.get(consumer.id);
      if (m && m.timer) clearInterval(m.timer);
      socket.layerMonitors.delete(consumer.id);
    });

    console.log(`📥 ${socket.id} 订阅了一路 ${consumer.kind}（Consumer ${consumer.id} ← Producer ${producerId}）`);

    // 把 Consumer 参数回给客户端，客户端用它"本地收货"
    ok(callback, {
      consumerId: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      appData: consumer.appData,
    });
  });

  /* ---- 断开：有人离开 → 释放 mediasoup 资源 + 通知其他人 ---- */
  socket.on('disconnect', () => {
    console.log(`[-] 用户断开: ${socket.id}`);

    if (socket.roomNumber) {
      const room = rooms.get(socket.roomNumber);
      if (room) {
        room.members.delete(socket);

        // ★ 远程协助清理：离开的是被控端/控制端 → 控制权作废（防幽灵控制权）
        //   （被控端走了没人可被控；控制端走了要释放位置给别人）
        //   reason='peer-left' 让另一端知道"不是我做的超时，是人走了"
        const ctl = remoteCtl.get(socket.roomNumber);
        if (ctl && (ctl.hostId === socket.id || ctl.controllerId === socket.id)) {
          clearRemoteCtl(socket.roomNumber, 'peer-left'); // 广播 remote-state 复位
        }

        // ★ D1：停掉这个订阅者的所有"选层监控"定时器（否则定时器泄漏 + 对着已销毁的 consumer 取值）
        for (const m of socket.layerMonitors.values()) {
          if (m.timer) clearInterval(m.timer);
        }
        socket.layerMonitors.clear();

        // ★ D2/D4：清掉他的媒体归属台账（AudioLevelObserver 会随 Producer 关闭自动移除）
        for (const producerId of socket.producers.keys()) room.producerOwner.delete(producerId);

        // ★ A4：他发起的/接收中的文件传输台账也要清（断开后不可能再收数据了）
        for (const [fileId, t] of fileTransfers) {
          if (t.from === socket.id || t.to === socket.id) {
            fileTransfers.delete(fileId);
            // 通知另一端"对面走了，这次传输作废"
            const other = t.from === socket.id ? t.to : t.from;
            io.to(other).emit('file-abort', { fileId, reason: 'peer-left' });
          }
        }

        // ★ SFU 特有：关掉 Transport 会级联关闭它上面的所有 Producer/Consumer，
        //   mediasoup 自动释放。手动逐条关也可以，但 transport.close() 一条就够
        if (socket.sendTransport) socket.sendTransport.close();
        if (socket.recvTransport) socket.recvTransport.close();

        socket.to(socket.roomNumber).emit('peer-left', { id: socket.id });

        /* ★ D+4 升级（2026-09-14）：D6 的"已知边界"就此补掉——
         *   以前人走光立即销毁房间，"最后一个人掉线"重连必收 room-not-found；
         *   现在房间进入 TTL 宽限期（Router 不关、号码不回收），宽限期内原号可回归。
         *   真实产品的"会议不散场"语义（掉线重连 / 暂离）由此而来。
         */
        if (room.members.size === 0) {
          scheduleRoomTtl(socket.roomNumber); // 宽限期到点才 destroyRoom
        } else {
          // ★ D+4：房主走了 → 房主位迁给"最早进房"的幸存者（分布式所有权的最小实现：
          //   规则简单、无争议、不需要选举算法——面试可讲为什么要避免复杂的领导选举）
          if (room.ownerId === socket.id) {
            const heir = [...room.members].sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))[0];
            if (heir) {
              room.ownerId = heir.id;
              console.log(`👑 房主离开，房间 ${socket.roomNumber} 房主迁移给最早进房的 ${heir.id}`);
            }
          }
          broadcastRoomState(socket.roomNumber); // ★ D4：人数/房主变了，全房刷新成员列表
          console.log(`[-] ${socket.id} 离开房间（剩 ${room.members.size} 人）`);
          logEvent('info', 'member-left', { roomNumber: socket.roomNumber, memberId: socket.id, remaining: room.members.size });
        }
      }
    }
  });
});

/* ──────────────────────────────────────────────────────────────
 * 第 E 部分：启动
 * ────────────────────────────────────────────────────────────── */

(async () => {
  /* ★ 09-17c 启动流程优化（用户反馈"后端启动不流畅"）：
   *   旧顺序：worker(≈1.8s) → … → 阻塞式 ffmpeg 探测(可能数秒) → listen
   *           → 期间**一行都不打印**，用户以为卡死，浏览器也连不上。
   *   新顺序：立刻打印 banner → 先 listen（HTTP/HTTPS/socket.io 秒级可用）
   *           → 后台并行拉 worker（媒体能力就绪由 workerReady 承诺把门）。
   *   收益：页面 100ms 内能打开、能登录、能建房；媒体相关操作自动等 Worker 就绪。
   */
  console.log('⏳ 正在启动会议服务（先开 HTTP，再并行准备媒体引擎）…');
  const t0 = Date.now();
  const workerReady = createWorker().then(() => {
    console.log(`⚙️  媒体引擎就绪（用时 ${((Date.now() - t0) / 1000).toFixed(2)}s）：现在可以开摄像头开会了`);
    return worker;
  }); // ← 不 await：先让 HTTP 起来
  global.__workerReady = workerReady; // 房间/媒体操作 await 它（见 getOrCreateRouter）
  workerReady.catch((err) => console.error('❌ 媒体引擎启动失败：', err.message));

  if (process.env.TEST_RECORD === '1') workerReady.then(() => runRecordSelfTest()); // ★ D+2 端到端自测（见下）
  const listenOn = LISTEN_IP === '127.0.0.1' ? 'localhost' : LISTEN_IP;
  // ★ 可交付体验：端口被占时给"人话"指引，而不是一屏堆栈（常见于 start-lan 已启动、
  //   又手动 npm run start:sfu 的双开场景）
  const friendlyPortError = (port) => (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`
❌ 端口 ${port} 已被占用——很可能已经有一个会议服务在运行。`);
      console.error(`   ✔ 直接打开现有的服务即可：  http://localhost:${PORT}  /  https://${listenOn}:${tlsCfg.port || 3443}`);
      console.error(`   ✔ 想重启服务：先关掉旧进程——  netstat -ano | findstr :${port}   然后看最后一列 PID：`);
      console.error(`                                taskkill /PID <PID> /F`);
      console.error(`   （start-lan.bat 启动的实例：关掉那个命令行窗口即可）
`);
      process.exit(1);
    }
    console.error('启动监听失败:', err);
    process.exit(1);
  };
  httpServer.on('error', friendlyPortError(PORT));
  if (httpsServer) httpsServer.on('error', friendlyPortError(tlsCfg.port || 3443));
  httpServer.listen(PORT, () => {
    console.log(`\nSFU 版已启动: http://${listenOn}:${PORT}`);
    /* ★ 09-17c：探测类工作全部挪到 listen 之后、且不阻塞（用户能立刻打开页面）：
     *   ffmpeg 快探测（异步 500ms 超时）+ 可达性自检（announcedIp 与本机网卡比对） */
    /* ★ 09-24 用眼睛先看一眼 AI 处在哪种轨道：这条日志是排障第一现场——
     *   用户报告"AI 答得像模板"时，先看这里是 [Mock] 还是 LLM，省掉一半沟通。 */
    const aiS = AI.getStats();
    console.log(aiS.enabled
      ? `🤖 AI 模式：LLM（DeepSeek ${AI.getSettings().model}）—— 问答/纪要/操作员全部走真模型`
      : '🤖 AI 模式：[Mock] —— 未配置 DEEPSEEK_API_KEY（可写进项目根 .env），全部功能走本地规则降级，链路照样跑得通');
    probeFfmpeg();
    checkAnnouncedIp();
    if (httpsServer) {
      httpsServer.listen(tlsCfg.port || 3443, () => {
        console.log(`🔒 HTTPS: https://${listenOn}:${tlsCfg.port || 3443}（自签证书，浏览器点"继续访问"即可）`);
      });
    }
    console.log(`📊 实时观测面板: http://${listenOn}:${PORT}/dashboard`);
    console.log(`（Mesh 版在 http://localhost:3000，两个版本互不干扰）`);
    console.log(`打开 2~8 个浏览器窗口：第 1 个创建房间拿号，其余凭号加入`);
    if (LISTEN_IP === '127.0.0.1') {
      console.log(`⚠️ 当前只监听本机。跨机访问请设 MEDIASOUP_LISTEN_IP=0.0.0.0 + ANNOUNCED_IP，见 README「跨网络部署」`);
    }
    console.log('');
  });
})().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});

/* ★ D+2 端到端自测（TEST_RECORD=1 时随服务器启动）：
 * ▎要解决什么？录制链路（PlainTransport → RTP → SDP → ffmpeg → webm）浏览器没法命令行验证，
 *   而录制 API 又依赖"有人开着摄像头"。自测的做法：**用 ffmpeg 自己当媒体源**——
 *   它生成一条测试视频流（testsrc2 图案），以 RTP 推进 mediasoup 的一条
 *   PlainTransport（comedia=true：等对端先发，正好匹配 ffmpeg 的单向推流），
 *   服务器拿到一路"真实在流动"的 Producer，再走 startRecording 完整链路录 7 秒。
 * ▎验证三件事：产物存在且 >10KB；ffprobe 能读出时长；时长 > 1s。
 * ▎用法：TEST_RECORD=1 TEST_RECORD_EXIT=1 node sfu/server.js（或 npm run test:record）
 */
async function runRecordSelfTest() {
  console.log('🧪 [TEST_RECORD] 服务器侧录制端到端自测开始（ffmpeg 源 → mediasoup → ffmpeg 落盘）…');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    // ★ 09-19c 实修：probeFfmpeg 是异步的（500ms），媒体引擎就绪比它快时
    //   FFMPEG_OK 还是 false——自测前先等探测收敛（最多 3s），别把"还没探到"当"没有"。
    for (let i = 0; !FFMPEG_OK && i < 30; i++) await sleep(100);
    if (!FFMPEG_OK) {
      // 快探测确实失败了 → 走一次深度扫描（winget 目录兜底）再判死刑
      await new Promise((r) => resolveFfmpegDeep ? resolveFfmpegDeep().then(r).catch(r) : r());
    }
    if (!FFMPEG_OK) throw new Error('ffmpeg 不可用');
    // ① 独立 Router + 一条"收流"PlainTransport（comedia=true：等 ffmpeg 先发 RTP）
    const router = await worker.createRouter({ mediaCodecs }); // workers[0]（兼容引用）
    const ingest = await router.createPlainTransport({
      listenIp: { ip: '127.0.0.1' },
      comedia: true,    // 等对端先发（ffmpeg -f rtp 是单向推流）
      rtcpMux: true,    // ffmpeg 的 rtp muxer 只发 RTP，复用同端口即可
    });
    const listenPort = ingest.tuple.localPort;
    console.log(`🧪 [TEST_RECORD] ingest PlainTransport 收流端口 = ${listenPort}（comedia=true）`);
    // ② 手工 rtpParameters 生产 VP8（plain transport 的常规用法：参数由外部约定）
    const producer = await ingest.produce({
      kind: 'video',
      rtpParameters: {
        codecs: [{
          mimeType: 'video/VP8', payloadType: 96, clockRate: 90000,
          parameters: {}, rtcpFeedback: [{ type: 'nack', parameter: '' }, { type: 'nack', parameter: 'pli' }],
        }],
        encodings: [{ ssrc: 22222222 }],
      },
    });
    // ③ ffmpeg 生成测试流并推进来（payloadType/SSRC 与上面约定一致）
    const sender = require('child_process').spawn(FFMPEG_BIN, [
      '-loglevel', 'error',
      '-re', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=15',
      '-c:v', 'libvpx', '-b:v', '500k', '-cpu-used', '8', '-deadline', 'realtime',
      '-g', '15', '-keyint_min', '15', // 每秒一个关键帧：webm copy 必须从关键帧起写，否则 muxer 一直等
      '-payload_type', '96', '-ssrc', '22222222',
      '-f', 'rtp', `rtp://127.0.0.1:${listenPort}`,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    sender.stderr.on('data', (d) => console.log(`🧪 [源] ${d.toString().trim()}`));
    sender.on('exit', (c) => console.log(`🧪 [TEST_RECORD] ffmpeg 源退出（code=${c}）`));
    await sleep(2500); // 让 RTP 先流起来（mediasoup 收到包后 Producer 才"活跃"）
    {
      const st = await producer.getStats();
      console.log(`🧪 [TEST_RECORD] ingest producer stats = ${JSON.stringify(st)}`);
    }
    // ④ 走真实录制链路录 7 秒
    const rec = await startRecording({
      roomNumber: 'SELFTEST', router,
      tracks: [{ producer, kind: 'video' }],
      label: 'SELFTEST',
    });
    await sleep(7000);
    const file = rec.file;
    // 优雅收尾顺序（踩坑实修）：先停源（RTP 断流 → demux 的阻塞 read 会在超时后返回，
    // 'q' 才能被命令线程处理）→ 再发 'q' → 等 exit。若源不断，'q' 可能永远等不到 demux 让位，
    // 兜底 kill 会丢 trailer（duration=N/A）。
    sender.kill();
    await sleep(400);
    rec.stop && rec.stop();
    await new Promise((r) => rec.proc.on('exit', r)); // 等 ffmpeg 真正退出（trailer 已落盘）
    await sleep(200);
    // ⑤ 验证：产物大小 + ffprobe 时长
    const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
    if (size < 10000) throw new Error(`产物过小（${size} B），RTP 链路可能没通`);
    const probeBin = FFMPEG_BIN.replace(/ffmpeg(\.exe)?$/, (m) => (m.endsWith('.exe') ? 'ffprobe.exe' : 'ffprobe'));
  /* ★ 09-24 实修「ffprobe EBUSY」（本项目自测真红过三次，而同一文件在 shell 里 ffprobe 秒出结果）：
   *   罪魁不是文件锁，是 **spawnSync 本身**——Node 在 Windows 上的同步 spawn 与未排空的
   *   子进程 stdio 管道/句柄相冲时会直接报 EBUSY（与文件是否可读无关，所以重试 6 次没救）。
   *   改异步 execFile 之后该错误消失，顺带不再阻塞事件循环（服务器进程里更该这样）。
   *   留一次重试给真正的瞬时锁，但下一次的重试必须**先 await 让出事件循环**。 */
  const probeOnce = () => new Promise((resolve, reject) => {
    require('child_process').execFile(probeBin,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
      { timeout: 8000, windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(String(stdout || '').trim())));
  });
  let probeOut = '';
  for (let i = 0; i < 3; i++) {
    try {
      probeOut = await probeOnce();
      if (probeOut) break;
    } catch (e) {
      if (i === 2) throw new Error(`ffprobe 读取失败（3 次）：${e.message}`);
      await sleep(500);
    }
  }
    const dur = parseFloat(probeOut);
    if (!(dur > 1)) throw new Error(`ffprobe 读出时长异常（${probeOut} 秒）`);
    console.log(`🧪 [TEST_RECORD] PASS —— 产物 ${(size / 1024).toFixed(1)} KB，时长 ${dur.toFixed(1)}s → ${file}`);
    if (process.env.TEST_RECORD_EXIT === '1') process.exit(0);
  } catch (err) {
    console.error(`🧪 [TEST_RECORD] FAIL —— ${err.message}`);
    if (process.env.TEST_RECORD_EXIT === '1') process.exit(1);
  }
}

/* ══════════════════════════════════════════════════════════════
 * 第 Z 部分：优雅退出（Ctrl+C / kill / 容器停止）
 *
 * ▎为什么必须做（这也是"一个完整项目该有的东西"里最常被漏掉的一件）：
 *   在此之前，进程没有注册任何信号处理器 —— Ctrl+C 等于**直接暴毙**，后果有三：
 *     ① mediasoup Worker 是独立的 C++ 子进程，父进程没了它会变**孤儿进程**，
 *        继续占着 40000-49999 的 RTC 端口；下次启动就可能撞端口、起不来；
 *     ② node:sqlite 的 WAL 不会做 checkpoint，meeting.db-wal 一直堆积
 *        （数据不丢，但文件越来越大，且下次启动要重放）；
 *     ③ 手头正在录制的 ffmpeg 被硬切，产物可能是个损坏文件。
 * ▎设计要点：
 *   · **幂等**：连按两次 Ctrl+C 不能卡住——第二次直接放弃优雅、立刻退出。
 *   · **有硬超时兜底**：优雅流程最多 5 秒。真实系统里"退出卡死"比"退得不干净"更烦人，
 *     所以必须有一条"到点强制结束"的保险丝（k8s 的 terminationGracePeriod 是同一思路）。
 *   · **顺序**：先断媒体（Worker）→ 再停收新连接（server）→ 最后关库。
 *     库必须最后关：前面几步可能还在写审计日志。
 * ══════════════════════════════════════════════════════════════ */
async function gracefulShutdown(signal) {
  if (shuttingDown) {
    console.log(`\n⚠️ 又收到 ${signal}，不再等待，直接退出。`);
    process.exit(1);
  }
  shuttingDown = true;
  console.log(`\n🛑 收到 ${signal}，正在优雅退出…`);

  // 保险丝：5 秒还没退完就强制结束（unref 让这个定时器自己不阻止进程退出）
  const hardTimer = setTimeout(() => {
    console.error('⚠️ 优雅退出超时（5s），强制结束。');
    process.exit(1);
  }, 5000);
  hardTimer.unref();

  // ① 关所有 mediasoup Worker（splice 清空池子，避免补位逻辑再塞进来）
  for (const w of workers.splice(0)) {
    try { w.close(); } catch (e) { /* 已死/已关：忽略 */ }
  }
  // ② 停收新连接（已建立的连接会自然结束；不等它们，有 5s 保险丝兜着）
  for (const s of [httpServer, httpsServer]) {
    if (s) { try { s.close(); } catch (e) { /* 忽略 */ } }
  }
  // ③ 关库：显式 close 才会做 WAL checkpoint，把 -wal 收进主库
  try { store.closeDb(); } catch (e) { /* 忽略 */ }

  clearTimeout(hardTimer);
  console.log('👋 已安全退出（Worker 已关、数据库已 checkpoint）。');
  process.exit(0);
}
process.on('SIGINT', () => { gracefulShutdown('SIGINT'); });    // Ctrl+C
process.on('SIGTERM', () => { gracefulShutdown('SIGTERM'); });  // kill / docker stop
/* 未捕获异常也不该无声暴毙：打出真实堆栈再退，方便定位（但退出路径仍走优雅那条）。
 * ⚠️ 注意：不吞异常、不假装没发生——这是"崩溃要留证据"的底线。 */
process.on('uncaughtException', (err) => {
  console.error('💥 未捕获异常：', err && err.stack || err);
  gracefulShutdown('uncaughtException');
});

/* ★ 09-24：优雅退出的**自测钩子**（沿用本项目 TEST_RECORD 的约定）。
 * ▎为什么非要有它不可：**Windows 上外部根本投递不了 SIGTERM**——Windows 没有 POSIX 信号，
 *   `process.kill(pid,'SIGTERM')` 走的是 TerminateProcess（等于直接暴毙），
 *   Git Bash 的 `timeout` 同理。所以"用 timeout 杀一下看日志"在这台机器上
 *   **测不出任何东西**：它只能证明"进程会死"，证明不了"退得干净"。
 *   用环境变量把这条路径主动触发一次，`npm run test:shutdown` 才能真正断言它。
 * ▎为什么 unref()：让这个定时器不阻止进程退出——它的职责只是"到点踢一脚"。 */
if (process.env.TEST_SHUTDOWN_AFTER_MS) {
  setTimeout(() => {
    console.log('🧪 [TEST_SHUTDOWN] 主动触发优雅退出');
    gracefulShutdown('TEST_SHUTDOWN');
  }, Number(process.env.TEST_SHUTDOWN_AFTER_MS) || 3000).unref();
}
