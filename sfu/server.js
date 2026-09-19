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
};

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
    handleApiRooms(res);
    return;
  }

  // ★ 09-17e 值守归档（C3-N1）：字幕账本的服务器权威副本——POST=追加，GET=回读全档
  if (pathname === '/api/captions') {
    if (req.method === 'POST') {
      handleApiCaptions(req, res);
    } else {
      const q = new URL(req.url, 'http://localhost').searchParams;
      handleCaptionRead(res, String(q.get('room') || ''), q.get('format') || 'txt');
    }
    return;
  }

  // ★ 09-18 G7 可观测性：Prometheus 文本格式的指标端点（/dashboard 的"机器读"版）
  if (pathname === '/metrics') {
    handleApiMetrics(res);
    return;
  }

  // ★ 09-19c G3 录制回放：录制产物列表（recordings.html 吃它；只报可播的 .webm/.mkv）
  if (pathname === '/api/recordings') {
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
    const q = new URL(req.url, 'http://localhost').searchParams;
    const room = String(q.get('room') || '');
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
    // /minutes/<6位房间>/<文件名>.md —— 两段白名单钳住路径穿越
    const parts = pathname.split('/').filter(Boolean); // ['minutes', room, file]
    const room = parts[1] || '';
    const file = parts[2] || '';
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
      // ★ 09-16 局域网交付：announcedIp 存在时，告诉前端"发给别的电脑的邀请链接长什么样"——
      //   服务器机自己访问的是 localhost，直接复制 location.href 别的电脑打不开
      lanUrl: ANNOUNCED_IP ? `https://${ANNOUNCED_IP}:${(tlsCfg.port || 3443)}` : null,
    }));
    return;
  }

  // ★ D+2：录制产物下载（只允许纯文件名，path.basename 天然防路径穿越）
  if (pathname.startsWith('/recordings/')) {
    const fileName = path.basename(pathname);
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
    const lines = entries.map((e) => JSON.stringify({
      ts: Number(e && e.ts) || Date.now(),
      from: String((e && e.from) || '').slice(0, 64),
      name: String((e && e.name) || '').slice(0, 64),
      text: String((e && e.text) || '').slice(0, 500),
    }));
    fs.appendFileSync(file, `${lines.join('\n')}\n`);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ saved: lines.length }));
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
if (tlsCfg.enabled) {
  const certFile = tlsCfg.cert || path.join(__dirname, 'tls', 'dev-cert.pem');
  const keyFile = tlsCfg.key || path.join(__dirname, 'tls', 'dev-key.pem');
  try {
    if (!fs.existsSync(certFile) || !fs.existsSync(keyFile)) {
      if (tlsCfg.autoSelfSigned === false) throw new Error('证书文件不存在且已禁用自签');
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
      execFileSync(opensslBin,
        ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
         '-subj', '/CN=webrtc-sfu-dev', '-keyout', keyFile, '-out', certFile],
        { stdio: 'ignore' });
      console.log(`🔑 已自动生成自签开发证书（sfu/tls/，用 ${opensslBin}）`);
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
const ANNOUNCED_IP = process.env.MEDIASOUP_ANNOUNCED_IP || CONFIG.announcedIp || undefined;

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

/* ★ 09-16 基础功能补全：登录/注册（零依赖用户体系）
 * ▎存储：users.json（用户名 → scrypt 哈希 + 盐 + 昵称），演示规模直接整文件读写；
 *   密码**绝不存明文**——scrypt(+随机盐) 是 Node 内置 crypto，不引 bcrypt（零依赖铁律）。
 * ▎token：登录/注册成功发一个随机 token（内存 Map），前端存 localStorage 自动恢复登录态；
 *   重启即失效是**教学取舍**（真实产品用数据库 + 长期 refreshToken），注释里讲清楚。
 * ▎身份的用途：昵称贯通成员列表/聊天气泡/工作台状态条；不登录也能玩（游客模式）。 */
const crypto = require('crypto');
const USERS_FILE = path.join(__dirname, 'users.json');
const authTokens = new Map(); // token -> username
function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (e) { return {}; }
}
function saveUsers(users) { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}
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
  execFile(FFMPEG_BIN, ['-version'], { timeout: 500, windowsHide: true }, (err) => {
    FFMPEG_OK = !err;
    console.log(FFMPEG_OK
      ? `✅ 已检测到 ffmpeg（${FFMPEG_BIN}）：服务器侧录制（D+2）可用`
      : '⚠️ 未检测到 ffmpeg：服务器侧录制（D+2）暂不可用（首次录制时会再深扫一次 winget 目录）');
  });
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
 *   ▎策略：不一致时**大声告警**并打印本机实际可用 IP + 修复命令；不擅自改用户配置。
 */
function checkAnnouncedIp() {
  const os = require('os');
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
    }
  }
  const announced = CONFIG.announcedIp;
  if (!announced) {
    console.log(`⚠️ config.json 未设置 announcedIp：mediasoup 只会通告 ${CONFIG.listenIp || '127.0.0.1'}，`
      + `\n   本机可用 IP：${ips.join('、') || '(无)'} —— 别的电脑将看不到画面（跑 npm run start:lan 可自动写好）`);
    return;
  }
  if (!ips.includes(announced)) {
    console.log(`❌ announcedIp=${announced} 与本机网卡不匹配！当前实际 IP：${ips.join('、') || '(无)'}`);
    console.log('   ▸ 后果：本机 localhost 正常，但**其它电脑/手机进会看不到任何画面**');
    console.log('   ▸ 修复：改 sfu/config.json 的 announcedIp 为上面某个 IP，或直接跑 npm run start:lan（自动探测并重写）');
  } else {
    console.log(`✅ announcedIp=${announced} 与本机网卡一致（局域网其它设备可直连）`);
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

// bot 开/关（幂等）：改房间状态 + 拆/建管线 + 广播快照
function setAiBot(roomNumber, on) {
  const room = rooms.get(roomNumber);
  if (!room) return null;
  room.aiBot = !!on;
  if (on) {
    // 把当前所有音频路喂给管线（bot 入会晚了也能"听见"在场的每个说话人）
    for (const [pid, owner] of room.producerOwner) {
      const sock = [...room.members].find((m) => m.id === owner);
      const producer = sock && sock.producers && sock.producers.get(pid);
      if (producer && producer.kind === 'audio') startAiAudioPipe(roomNumber, producer, owner);
    }
    // ★ N2：值守分段纪要定时器（bot 在场才挂；interval = config.minutesIntervalSec，默认 1h）
    if (!room.minutesTimer) {
      const sinceMark = { ts: Date.now() }; // 每段只统计上一段之后的新字幕
      room.minutesTimer = setInterval(async () => {
        try {
          const r = await buildMinutes(roomNumber, { type: 'segment', since: sinceMark.ts });
          sinceMark.ts = Date.now();
          io.to(roomNumber).emit('chat-message', {
            from: 'ai-bot', name: '🤖 AI 助理',
            text: `🌙 值守分段纪要已生成：${r.path}（${r.mock ? '[Mock] ' : ''}本段 ${r.markdown.includes('（本时段没有字幕记录）') ? '无字幕' : '已汇总'}）`,
            ts: Date.now(),
          });
        } catch (e) { /* 定时纪要失败不打断值守，下一轮再试 */ }
      }, MINUTES_INTERVAL_MS);
    }
  } else {
    stopAiAudioPipeline(roomNumber);
    // ★ N2：送走 bot = 值守段落结束 → 清定时器 + 出终稿（异步落盘，不阻塞信令）
    if (room.minutesTimer) { clearInterval(room.minutesTimer); room.minutesTimer = null; }
    buildMinutes(roomNumber, { type: 'final' }).catch(() => {});
  }
  broadcastRoomState(roomNumber);
  logEvent('info', on ? 'ai-join' : 'ai-leave', { roomNumber });
  return room.aiBot;
}

// AI 大脑：有 key 走 DeepSeek（真答），无 key/失败走本地模板（[Mock] 标记）——AI 双轨约定
async function aiBrain(roomNumber, question) {
  const room = rooms.get(roomNumber);
  const members = room ? [...room.members] : [];
  const talkRows = room ? [...room.talk.entries()].sort((a, b) => b[1] - a[1]) : [];
  const talkTxt = talkRows.slice(0, 3).map(([id, v], i) =>
    `${i + 1}. ${aiShortId(id)} 发言约 ${Math.round(v)}s`).join('；') || '（还没有发言统计）';
  const capFiles = fs.existsSync(CAPTIONS_DIR)
    ? fs.readdirSync(CAPTIONS_DIR).filter((f) => f.startsWith(`cap-${roomNumber}-`) && f.endsWith('.jsonl')).sort() : [];
  let capTail = [];
  for (const f of capFiles) {
    for (const line of fs.readFileSync(path.join(CAPTIONS_DIR, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { capTail.push(JSON.parse(line)); } catch (e) { /* 坏行跳过 */ }
    }
  }
  capTail = capTail.slice(-40);
  const capTxt = capTail.slice(-8).map((e) => `${e.name}: ${e.text}`).join('\n') || '（还没有字幕记录）';
  const hearingTxt = (() => {
    const h = aiHearing.get(roomNumber);
    if (!h || !h.size) return '（音频管线暂无响度数据）';
    return [...h.entries()].map(([id, v]) => `${aiShortId(id)}:${v.rms}dB`).join('，');
  })();
  const dur = room ? Math.round((Date.now() - room.createdAt) / 60000) : 0;
  const context = `会议时长约 ${dur} 分钟，${members.length} 人在线（含 AI 助理）。\n发言统计：${talkTxt}\n近期字幕：\n${capTxt}\n音频响度：${hearingTxt}`;

  const key = process.env.DEEPSEEK_API_KEY;
  if (key) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: '你是简易腾讯会议的 AI 会议助理，以参会者身份入会。用简短中文回答（不超过120字），基于给的会议上下文，不要编造上下文里没有的内容。' },
            { role: 'user', content: `会议上下文：\n${context}\n\n成员提问：${question}` },
          ],
          temperature: 0.4,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        const answer = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (answer) return answer.trim();
      }
    } catch (e) { /* 掉到 Mock */ }
  }
  // ── 本地模板（[Mock] 标记 = AI 双轨约定：无 key 环境的降级路径）──
  const q = String(question || '');
  // ★ N2：问"纪要/总结"→ 直接生成并回路径（@ai 生成纪要 的入口）
  if (/纪要|总结|摘要/.test(q)) {
    const r = await buildMinutes(roomNumber, { type: 'segment' });
    return `${r.mock ? '[Mock] ' : ''}纪要已生成：${r.path} —— 要点节选：` +
      (r.markdown.split('## 关键句节选')[1] || '').split('\n').filter((l) => l.startsWith('- ')).slice(0, 3).join('；');
  }
  let ans;
  if (/你是谁|介绍.*自己|hello|hi|你好/i.test(q)) {
    ans = `我是本房间的 AI 助理（🤖），${dur} 分钟前入会，一直在听：当前 ${members.length} 人在场。问"谁发言最多/会议多久/最近说了什么"都能答；配置 DEEPSEEK_API_KEY 后我会更聪明。`;
  } else if (/谁|发言|说话/.test(q)) {
    ans = `按服务器发言统计：${talkTxt}。`;
  } else if (/多久|时长|开.*久/.test(q)) {
    ans = `这场会已开约 ${dur} 分钟（${members.length} 人在场）。`;
  } else if (/多少人|几个人|在线/.test(q)) {
    ans = `当前 ${members.length} 人在场${room && room.aiBot ? '（含我）' : ''}。`;
  } else if (/字幕|说了|提到|刚才/.test(q)) {
    ans = capTail.slice(-3).map((e) => `${e.name}："${e.text}"`).join('；') || '字幕账本还是空的——请大家打开「💬 字幕」。';
  } else {
    ans = `我在听（${members.length} 人在场，字幕 ${capTail.length} 条）。目前是 [Mock] 模式：可以问我"谁发言最多/会议多久/刚才说了什么"；配 DEEPSEEK_API_KEY 后可自由问答。`;
  }
  return '[Mock] ' + ans;
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

// LLM 纪要（有 key 才走；失败抛错由调用方降级 Mock）
async function llmMinutes(seg) {
  const transcript = seg.slice(-200).map((e) => `${e.name}: ${e.text}`).join('\n');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: '你是会议纪要助手。基于会议字幕输出 markdown，只含三个小节：## 要点（不超过6条）## 待办（可执行的动作项，没有就写"（无）"）## 结论（一句话）。不要编造字幕里没有的内容。' },
          { role: 'user', content: `会议字幕：\n${transcript}` },
        ],
        temperature: 0.3,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) throw new Error('empty completion');
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
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
  // 待办关键词抽取（零 LLM 的规则层——分门别类永远有用的兜底）
  const todoRe = /(需要|待办|记得|下周|明天|得去|别忘了|安排|跟进|然后要)/;
  const todos = seg.filter((e) => todoRe.test(e.text || '')).slice(-8);

  let body = null;
  let isMock = false;
  if (process.env.DEEPSEEK_API_KEY && seg.length) {
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
    lines.push('');
    lines.push('## 待办线索（关键词规则抽取）');
    if (todos.length) for (const e of todos) lines.push(`- [ ] ${e.name}："${e.text}"`);
    else lines.push('- （未检测到含待办关键词的句子）');
    body = lines.join('\n');
  }
  const stamp = new Date(now).toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const md = [
    `# 会议纪要（${opts.type === 'final' ? '终稿' : '分段'}）· 房间 ${roomNumber}`, '',
    `- 生成时间：${new Date(now).toLocaleString()}`,
    `- 会议时长：约 ${durMin} 分钟；本${opts.type === 'final' ? '场' : '时段'}字幕 ${seg.length} 条（全档 ${entries.length} 条）`,
    `- 发言统计：${talkRows.slice(0, 3).map(([id, v]) => `${aiShortId(id)} 约 ${Math.round(v)}s`).join('、') || '无'}`,
    '', body, '',
    opts.type === 'final' ? '> 终稿：AI 助理送走 / 房间销毁时自动生成。' : '> 分段纪要：值守期间定时生成。',
    isMock ? '> [Mock] 本地模板生成（无 DEEPSEEK_API_KEY 或 LLM 失败）；配置 key 后本节由 LLM 撰写。' : '> 由 DeepSeek 撰写。',
    '',
  ].join('\n');
  const dir = path.join(MINUTES_DIR, String(roomNumber));
  fs.mkdirSync(dir, { recursive: true });
  const file = `${stamp}-${opts.type || 'segment'}.md`;
  fs.writeFileSync(path.join(dir, file), md, 'utf8');
  logEvent('info', 'minutes-generated', { roomNumber, type: opts.type || 'segment', entries: seg.length, mock: isMock });
  return { file, path: `/minutes/${roomNumber}/${file}`, markdown: md, mock: isMock };
}

function broadcastRoomState(roomNumber) {
  const room = rooms.get(roomNumber);
  if (!room) return;
  const ctl = remoteCtl.get(roomNumber) || {};
  const members = [...room.members].map((m) => ({
    id: m.id,
    name: m.displayName || null,           // ★ 09-16：昵称（成员列表显示用）
    owner: m.id === room.ownerId,          // 房主（建房的人）——踢人权限在他手里
    muted: !!(m.state && m.state.muted),   // 前端上报的"我静音了吗"
    camOff: !!(m.state && m.state.camOff), // 前端上报的"我关摄像头了吗"
    sharing: !!(m.state && m.state.sharing),
    hand: !!(m.state && m.state.hand),     // ★ 09-13 F4：举手（要发言）
    caption: !!(m.state && m.state.caption), // ★ 09-17b：实时字幕开关（成员列表 💬）
  }));
  // ★ 09-19 AI Bot 参会者（C 档）：bot 在场时以虚拟成员身份出现在快照里——
  //   它没有 socket/媒体，muted/camOff 都是"是"（它不推流，只"听"：见下方音频管线）
  if (room.aiBot) {
    members.push({
      id: 'ai-bot', name: '🤖 AI 助理', isBot: true,
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
    buildMinutes(roomNumber, { type: 'final' }).catch(() => {});
  }
  rooms.delete(roomNumber);
  remoteCtl.delete(roomNumber);
  stopAiAudioPipeline(roomNumber); // ★ 09-19：房间销毁 → AI 管线全拆（防 ffmpeg/Transport 泄漏）
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
  const bindIdentity = (username, displayName) => {
    socket.username = username;
    socket.displayName = displayName;
  };
  socket.on('auth-register', ({ username, password, displayName } = {}, callback) => {
    if (!callback) return;
    if (!validUsername(username)) return fail(callback, '用户名需 2~16 位（中英文/数字/下划线）');
    if (typeof password !== 'string' || password.length < 6) return fail(callback, '密码至少 6 位');
    const users = loadUsers();
    if (users[username]) return fail(callback, '用户名已被注册');
    const salt = crypto.randomBytes(16).toString('hex');
    users[username] = {
      salt,
      hash: hashPassword(password, salt), // 只存哈希：数据库泄露也拿不到原密码
      displayName: (typeof displayName === 'string' && displayName.trim())
        ? displayName.trim().slice(0, 16) : username,
      createdAt: Date.now(),
    };
    saveUsers(users);
    const token = crypto.randomBytes(24).toString('hex');
    authTokens.set(token, username);
    bindIdentity(username, users[username].displayName);
    console.log(`👤 注册成功: ${username}（昵称 ${users[username].displayName}）`);
    ok(callback, { user: { username, displayName: users[username].displayName }, token });
  });
  socket.on('auth-login', ({ username, password } = {}, callback) => {
    if (!callback) return;
    const users = loadUsers();
    const u = users[username];
    // 用户不存在与密码错误给同一句提示：不向试探者泄露"用户名是否存在"
    if (!u || hashPassword(password, u.salt) !== u.hash) return fail(callback, '用户名或密码不对');
    const token = crypto.randomBytes(24).toString('hex');
    authTokens.set(token, username);
    bindIdentity(username, u.displayName);
    console.log(`👤 登录成功: ${username}`);
    ok(callback, { user: { username, displayName: u.displayName }, token });
  });
  socket.on('auth-verify', ({ username, token } = {}, callback) => {
    if (!callback) return;
    const users = loadUsers();
    const u = users[username];
    if (!u || authTokens.get(token) !== username) return fail(callback, '登录态已失效，请重新登录');
    bindIdentity(username, u.displayName);
    ok(callback, { user: { username, displayName: u.displayName } });
  });

  /* ---- 公共函数：真正把一个连接放进房间（创建/加入的"后半段"共用）---- */
  const joinRoom = async (roomNumber) => {
    const room = rooms.get(roomNumber);
    const members = room.members;

    if (members.size >= MAX_MEMBERS) {
      socket.emit('room-full', { max: MAX_MEMBERS });
      return;
    }

    // 进房前先把"媒体中枢 Router"准备好（第 1 个人负责把它建出来）
    await getOrCreateRouter(roomNumber);

    socket.join(roomNumber);        // socket.io 房间
    members.add(socket);            // 我们自己的成员表（存 socket 本体）
    socket.roomNumber = roomNumber;
    socket.joinedAt = Date.now();   // ★ D+4：进房次序（房主迁移要选"最早进房的幸存者"）
    socket.state = { muted: false, camOff: false, sharing: false, hand: false }; // 进房状态清零（重连也走这里）
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
    }));
    socket.emit('room-members', { roomNumber, members: memberList });

    // ② 通知老成员"来新人了"（老成员不用现在做什么，等他 produce 时会收到 new-producer）
    socket.to(roomNumber).emit('new-member', { id: socket.id });

    // ③ ★ D4 升级：全房广播最新的成员状态快照（进/退都要刷，否则成员列表停在旧人数）
    broadcastRoomState(roomNumber);

    // ④ ★ F2：房间有人了就开始"量网"定时器（幂等；成员列表的网络点用）
    startNetLevelBroadcaster(roomNumber);
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
    if (callback) ok(callback, { roomNumber });
  });

  socket.on('join-room', async ({ roomNumber, password } = {}, callback) => {
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
    await joinRoom(roomNumber);
    if (callback) ok(callback, { roomNumber });
  });

  // 聊天（SFU 版方案 A：走服务器广播——见 SFU-BLUEPRINT.md 5.4）
  // ★ D+1 起聊天有两条路（前端双发 + 按 msgId 去重）：主路 = SCTP 数据通道（广播语义），
  //   兜底 = 这条信令广播（数据通道还没建立/建立失败的人也能收到）。服务器原样带 msgId。
  socket.on('chat-message', ({ text, msgId } = {}) => {
    if (!socket.roomNumber || typeof text !== 'string' || !text.trim()) return;
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
    if (!room || !isRoommate(room, to)) return;

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
    logEvent('info', 'record-stop', { recordId, by: socket.id, file: rec.file ? path.basename(rec.file) : null });
    ok(callback, { file: rec.file ? path.basename(rec.file) : null });
  });

  /* ---- ★ 09-19 AI Bot 参会者：ai-join / ai-leave / ai-ask（详见上方 AI 基建块注释）----
   * ▎ai-join/ai-leave：任何成员都能邀请/送走 AI 助理（教学版权限从宽；G6 权限分级可收紧）；
   * ▎ai-ask：向 bot 提问——应答以 chat-message(from='ai-bot') 广播全房（人人可见问答）。 */
  socket.on('ai-join', (payload = {}, callback) => {
    if (!socket.roomNumber || !rooms.get(socket.roomNumber)) return fail(callback, '先进入房间再邀请 AI 助理');
    ok(callback, { aiBot: setAiBot(socket.roomNumber, true) === true });
  });

  socket.on('ai-leave', (payload = {}, callback) => {
    if (!socket.roomNumber || !rooms.get(socket.roomNumber)) return fail(callback, '不在房间里');
    ok(callback, { aiBot: setAiBot(socket.roomNumber, false) === true });
  });

  socket.on('ai-ask', async (payload = {}, callback) => {
    const roomNumber = socket.roomNumber;
    const room = roomNumber && rooms.get(roomNumber);
    if (!room) return fail(callback, '先进入房间再向 AI 助理提问');
    if (!room.aiBot) return fail(callback, 'AI 助理不在房间里（点控制坞「🤖 AI 助理」邀请入会）');
    const question = String(payload.question || '').trim().slice(0, 300);
    if (!question) return fail(callback, '问题不能为空');
    const answer = await aiBrain(roomNumber, question);
    io.to(roomNumber).emit('chat-message', { from: 'ai-bot', name: '🤖 AI 助理', text: answer, ts: Date.now() });
    logEvent('info', 'ai-ask', { roomNumber, by: socket.id, qLen: question.length });
    ok(callback, { answer });
  });

  // ★ 09-19c N2：手动生成纪要（不需要 bot 在场——纪要吃的是字幕账本，人人可取）
  socket.on('ai-minutes', async (payload = {}, callback) => {
    if (!socket.roomNumber || !rooms.get(socket.roomNumber)) return fail(callback, '先进入房间再生成纪要');
    const type = payload.type === 'final' ? 'final' : 'segment';
    const since = Number(payload.since) || 0;
    try {
      const r = await buildMinutes(socket.roomNumber, { type, since });
      io.to(socket.roomNumber).emit('chat-message', {
        from: 'ai-bot', name: '🤖 AI 助理',
        text: `📋 ${type === 'final' ? '终稿' : '分段'}纪要已生成：${r.path}${r.mock ? '（[Mock] 本地模板）' : ''}`,
        ts: Date.now(),
      });
      ok(callback, { file: r.file, path: r.path, mock: r.mock });
    } catch (err) {
      fail(callback, '纪要生成失败：' + err.message);
    }
  });

  // ★ 09-19f G8-③：ping 探活（bench-signaling 的 RTT 探针；也是运维探活的轻量信令）
  socket.on('ping', (payload = {}, callback) => {
    if (typeof callback === 'function') callback({ data: { t: Date.now() } });
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
    const probeOut = require('child_process').execFileSync(probeBin,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim();
    const dur = parseFloat(probeOut);
    if (!(dur > 1)) throw new Error(`ffprobe 读出时长异常（${probeOut} 秒）`);
    console.log(`🧪 [TEST_RECORD] PASS —— 产物 ${(size / 1024).toFixed(1)} KB，时长 ${dur.toFixed(1)}s → ${file}`);
    if (process.env.TEST_RECORD_EXIT === '1') process.exit(0);
  } catch (err) {
    console.error(`🧪 [TEST_RECORD] FAIL —— ${err.message}`);
    if (process.env.TEST_RECORD_EXIT === '1') process.exit(1);
  }
}
