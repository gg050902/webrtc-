/* ════════════════════════════════════════════════════════════════
 * server.js —— 简易版腾讯会议 · 信令服务器（多人会议 Mesh 版 · 房间化）
 *
 * ▎这个文件到底在干什么？（先看这一段）
 *
 * 房间化之前：全服务器只有一个写死的房间（"会议A"），所有人挤在一起。
 * 房间化之后：像腾讯会议一样，用"房间号"开门——
 *   - 「创建房间」：服务器生成一个没人占用的 6 位数字房间号，发给创建者
 *   - 「加入房间」：必须输入别人创建出来的房间号；号不存在就回 room-not-found
 *   - 「自动回收」：房间里人走光就销毁，号码回到号码池可再次被生成
 *
 * 服务器的职责变成四件：
 *   1) 托管前端页面（public/ 目录）
 *   2) 房间号的发放、校验、回收（房间化）
 *   3) 房间密码的设置与校验（第 2.9 节：入会密码）
 *   4) 转发信令消息（offer / answer / ice-candidate），管理"谁在哪个房间"
 *
 * ▎房间化 + 密码相关的信令消息：
 *   create-room       客户端 → 服务器："帮我开个新房间"，可带 { password }（设密码）
 *   room-created      服务器 → 创建者："房间号是 xxx"（前端显示在右上角 = 房间号输出）
 *   join-room         客户端 → 服务器："我要进 xxx 房间"，带 { roomNumber, password }
 *   room-not-found    服务器 → 加入者："这个房间号不存在（输错/已散会）"
 *   room-wrong-password 服务器 → 加入者："房间在，但密码不对/没填"（第 2.9 节新增）
 *   room-members      服务器 → 新人："房间里现在有这些人，去连他们吧"
 *   new-member        服务器 → 老成员："来了个新人，为他准备一个连接"
 * ════════════════════════════════════════════════════════════════ */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const PORT = 3000;
// 房间最多几个人？Mesh 架构下 3 人 = 每人 2 条连接，够演示了
// （4 人 = 每人 3 条连接，5 人 = 每人 4 条……人越多带宽越炸，这就是 Mesh 的局限）
const MAX_MEMBERS = 3;

/* ──────────────────────────────────────────────────────────────
 * ★ 09-24 跨网部署升级：可选的 mesh.config.json（没有就用默认值）
 *
 * ▎为什么加这一层？——"跨网络连不上"的根因位就在这里。
 *   Mesh 版是 P2P：媒体不经过服务器，所以**服务器能力再强也救不了 NAT**。
 *   真正决定"两台不同网络的电脑能不能连上"的是浏览器的 ICE 配置：
 *     · 只有 STUN  → 双方都在对称型/严格 NAT（公司网、4G/5G、酒店 WiFi）时打洞失败；
 *     · 配上 TURN  → 打洞失败就退回中继，一定能连上（代价是流量过 TURN 服务器）。
 *   而原来的实现把 ICE 硬编码在 public/client.js 里（只带一条 Google STUN），
 *   想配 TURN 就只能改代码——改代码就不能"一键发布"，也不能一台机器一套配置。
 *
 * ▎所以：把 ICE 配置**从代码里挪到配置里**，由服务器通过 /config.json 下发。
 *   这套做法和 SFU 版完全一致（对照着看 sfu/server.js 的 /config.json 路由），
 *   是同一份经验的第二次应用。
 *
 * ▎配置项（都可不写）：
 *   { "port": 8081,                 // 监听端口（部署/穿透时常用环境变量 PORT 覆盖）
 *     "host": "0.0.0.0",            // 监听地址
 *     "iceServers": [ ... ],        // STUN/TURN 列表，直接下发给浏览器
 *     "publicUrl": "https://xxx"    // 你发布出去的公网地址（只用于页面提示，不参与逻辑）
 *   }
 *   ▎优先级：环境变量 PORT/HOST > mesh.config.json > 代码默认值。
 * ────────────────────────────────────────────────────────────── */
const CONFIG_FILE = path.join(__dirname, 'mesh.config.json');
let CONFIG = {};
try {
  if (fs.existsSync(CONFIG_FILE)) {
    CONFIG = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    console.log('📄 已加载 mesh.config.json');
  }
} catch (err) {
  console.log(`⚠️ mesh.config.json 解析失败，改用默认值：${err.message}`);
}
const LISTEN_PORT = Number(process.env.PORT || CONFIG.port || PORT);
const LISTEN_HOST = process.env.HOST || CONFIG.host || '0.0.0.0';

// 默认 ICE：一条公共 STUN（够应付大多数家庭宽带互连）。
// 严格 NAT 场景必须在 mesh.config.json 里补 TURN —— 见 README「跨网络部署」。
const DEFAULT_ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
function iceServersForClient() {
  const list = CONFIG.iceServers;
  return Array.isArray(list) && list.length ? list : DEFAULT_ICE;
}

/* ──────────────────────────────────────────────────────────────
 * 第 A 部分：HTTP 服务器 —— 托管 public 目录的静态文件
 * （和之前版本完全一样，没变化）
 * ────────────────────────────────────────────────────────────── */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

const httpServer = http.createServer((req, res) => {
  // ★ 用 URL 解析取纯路径（坑 15）：req.url 会带 "?room=xxx" 查询串，
  //   直接当文件路径去找会 404——邀请链接（?room=6 位号）就全挂了。
  //   new URL(相对路径, 基准).pathname = 剥掉 query 后的纯路径。
  const pathname = new URL(req.url, 'http://localhost').pathname;

  /* ★ 09-24：/config.json —— 把 ICE（STUN/TURN）下发给浏览器。
   *   ▎为什么不让前端写死？同一个前端要能在"家里直连""公司走 TURN""云主机"
   *     三种环境下跑，而环境差异只在配置。前端写死 = 换环境就得改代码重新发布。
   *   ▎必须 no-store：浏览器缓存了旧 ICE 配置，你改了 TURN 地址也不生效
   *     （这条教训本项目刚在 Service Worker 上踩过一次，同一个道理）。 */
  if (pathname === '/config.json') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({
      version: 1,
      arch: 'mesh',
      iceServers: iceServersForClient(),
      publicUrl: CONFIG.publicUrl || null,
      maxMembers: MAX_MEMBERS,
    }));
    return;
  }

  const urlPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(__dirname, 'public', urlPath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath);
    // ★ 静态资源禁缓存：和 SFU 版对齐（改了样式/脚本刷新即见，不吃启发式缓存）
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

/* ──────────────────────────────────────────────────────────────
 * 第 B 部分：房间管理（房间号的发放、校验与回收）
 *
 * ▎概念：Socket.IO 自带"房间"功能
 *   socket.join('123456')  → 这个连接加入 123456 号房间
 *   socket.to('123456')    → 给 123456 号房间里除了自己以外的人发消息
 *   io.to('123456')        → 给房间里所有人（包括自己）发消息
 *
 * 但我们还要知道"房间里都有谁"、房间要不要密码，以及哪些房间号已被占用，
 * 所以用一个 Map 自己记一份总账。为了把"成员表"和"密码"放一起，
 * 每个房间的值从"成员 Set"升级成"房间记录对象"：
 *
 *   rooms: Map<房间号(6位数字), 房间记录>
 *   房间记录 = {
 *     password: string|null,   // 入会密码：null = 这个房间没上锁（第 2.9 节）
 *     members : Set<socketId>, // 该房间所有连接的 id
 *   }
 * ────────────────────────────────────────────────────────────── */

const io = new Server(httpServer);
const rooms = new Map(); // 房间号 -> 房间记录 { password, members }

// ★ H5 远程桌面（Phase 1）：远程控制权总表
//   房间号 -> { hostId, controllerId, expiresAt, timer }
//     hostId        = 被控端（正在共享屏幕、允许别人操作的人）
//     controllerId  = 控制端（被允许操作的人），null = 当前没人被控
//     expiresAt     = ★ 升级 A6：这次授权的到期时间戳（毫秒），null = 不限时
//     timer         = ★ 升级 A6：到点自动收权的 setTimeout 句柄（用来 clearTimeout）
//   ▎为什么控制权要放在服务器？
//     房间里的"谁在控谁"必须全房唯一（互斥），而浏览器各自看不到别人——
//     服务器是房间里唯一的"权威"，由它来登记与广播（教学可讲：状态放唯一权威处）。
//
//   ▎升级 A6「限时授权」为什么要服务器也存一份 expiresAt？
//     授权是**服务器登记的**，所以"到点自动失效"也必须由服务器执行——
//     否则：被控端关掉页面/断网，浏览器里的倒计时跟着消失，控制权就"永久"留在表里，
//     后来的人永远申请不到（幽灵控制权）。服务器是权威 → 由它兜底收回，最稳。
const remoteCtl = new Map();

// 公共函数：结束一个房间的远程控制，并广播 remote-state 让全房 UI 复位
//   ▎谁调用：remote-release 事件 / 限时到期 / 有人离开房间 / 房间销毁时
//   ▎返回：true = 本来确实有控制权（做了广播）；false = 本来就没有（什么都没做）
function clearRemoteCtl(roomNumber) {
  const ctl = remoteCtl.get(roomNumber);
  if (!ctl) return false;               // 没有控制权的房间不用刷 UI
  // ★ A6：掐掉到期定时器（谁先到谁生效：手动释放 vs 到点自动收权，
  //   两者都走本函数，所以这里清 timer 就保证"绝不留下幽灵定时器"）
  if (ctl.timer) clearTimeout(ctl.timer);
  remoteCtl.delete(roomNumber);
  // expiresAt 也一并复位：前端据此停掉自己的倒计时显示（两端 UI 一起归零）
  io.to(roomNumber).emit('remote-state', { hostId: null, controllerId: null, expiresAt: null });
  console.log(`🖱️ 房间 ${roomNumber} 的远程控制已结束`);
  return true;
}

/* ---- ★ 升级 A6：限时授权（到点自动收回控制权）----
 * ▎思路：授权时被控端带一个 durationMs（0/null = 不限），服务器算出一个
 *   绝对到期时刻 expiresAt 存进 remoteCtl，并用 setTimeout 到点自动 clearRemoteCtl。
 *
 * ▎为什么不存"剩余毫秒"而存"绝对时间戳"？
 *   因为绝对时间戳可以**广播给两端**，两端各自和本机时钟比较就能画出倒计时
 *   （不用每秒问服务器）。这也是所有分布式系统的通用做法：传绝对时间点，
 *   不传"还能用多久"。教学可顺带讲"时钟偏移"的风险（同机演示可忽略）。
 *
 * ▎上限保护：客户端传 durationMs 是**不可信输入**，别让它塞个 10 年的定时器
 *   （每个房间一个 timer，恶意/手滑都会长期占资源）。这里夹一个 6 小时上限。
 */
const MAX_CTL_MS = 6 * 60 * 60 * 1000; // 单次授权最长 6 小时

function scheduleRemoteExpiry(roomNumber, durationMs) {
  const ctl = remoteCtl.get(roomNumber);
  if (!ctl) return null;
  if (ctl.timer) { clearTimeout(ctl.timer); ctl.timer = null; } // 重新授权 = 重新计时

  const ms = Math.min(Math.max(Number(durationMs) || 0, 0), MAX_CTL_MS);
  if (ms <= 0) { ctl.expiresAt = null; return null; } // 0 或非法值 = 不限时（不设定时器）

  ctl.expiresAt = Date.now() + ms;
  ctl.timer = setTimeout(() => {
    // ▎幽灵定时器自杀检查：定时器只认"房间号"，但房间里可能已经换人/已释放。
    //   如果此刻表里的记录已经不是当初那一条，说明这次授权早就结束了——
    //   什么都不做直接退出（否则会把新一次授权的控制权误收掉）。
    const cur = remoteCtl.get(roomNumber);
    if (!cur || cur !== ctl) return;
    clearRemoteCtl(roomNumber);
    console.log(`⏰ 房间 ${roomNumber} 的限时授权已到期，服务器自动收回控制权`);
  }, ms);
  // unref：这个定时器不阻止 Node 进程退出（服务器本来就有 http 句柄，
  //   写上是好习惯——"业务定时器不该决定进程生死"）
  if (ctl.timer.unref) ctl.timer.unref();
  return ctl.expiresAt;
}

// 生成一个当前没人占用的 6 位房间号（100000 ~ 999999）
// ▎为什么要查重？随机数可能撞上"还没散会"的房间——
//   两个会共用一个号就串会了，所以撞上（rooms.has）就重摇一次
function generateRoomNumber() {
  let num;
  do {
    num = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(num));
  return num;
}

/* ──────────────────────────────────────────────────────────────
 * 第 C 部分：信令事件（核心逻辑）
 * ────────────────────────────────────────────────────────────── */

io.on('connection', (socket) => {
  console.log(`[+] 用户已连接: ${socket.id}`);

  /* ---- 公共函数：把一个连接真正放进房间（创建/加入最后都走这里）----
   * 做四件事：人满拒绝 → 两边登记 → 通知新人(room-members) → 通知老成员(new-member)
   * 抽成函数的原因：create-room 和 join-room 的"进房后半段"完全一样，不想写两遍。
   *
   * ▎注意（第 2.9 节改造后）：
   *   房间记录（含密码）在 create-room / join-room 里**先建好、先验好**再调本函数，
   *   所以这里直接取记录就行，不用再关心密码。
   */
  const joinRoom = (roomNumber) => {
    // 取出这个房间的记录（含成员表）。房间记录在进房前已由创建/加入方建好
    const room = rooms.get(roomNumber);
    if (!room) return; // 防御：理论上走不到这里
    const members = room.members;

    // 人满了就拒绝（Mesh 架构必须限人数）
    if (members.size >= MAX_MEMBERS) {
      socket.emit('room-full', { max: MAX_MEMBERS });
      console.log(`[!] ${socket.id} 想加入房间 ${roomNumber} 但已满`);
      return;
    }

    // 加入房间：Socket.IO 房间 + 我们自己的成员表，两边都记
    socket.join(roomNumber);
    members.add(socket.id);
    socket.roomNumber = roomNumber; // 记在这个连接身上，断开时要用
    console.log(`[+] ${socket.id} 进入房间 ${roomNumber}（当前 ${members.size}/${MAX_MEMBERS} 人）`);

    // ① 告诉新人："房间里现在有这些人，你去主动连他们"
    //    （Mesh 的建连策略：新人当"发起方 caller"，主动给每个人发 offer）
    const others = [...members].filter((id) => id !== socket.id);
    socket.emit('room-members', { roomNumber, members: others });

    // ② 告诉房间里其他人："来新人了，为他准备一个连接（等他发 offer）"
    socket.to(roomNumber).emit('new-member', { id: socket.id });
  };

  /* ---- 事件 1：create-room —— "帮我开个新房间"（可顺带设密码）----
   * 第 2.9 节：create-room 现在可以带 { password }。
   * 创建者填了密码 = 给这个新房间上了锁；没填 = 不设密码（跟以前一样）。
   */
  socket.on('create-room', ({ password } = {}) => {
    if (socket.roomNumber) return; // 已经在房间里，忽略重复请求

    const roomNumber = generateRoomNumber();
    // 先建好"房间记录"（把密码存进去），再把自己放进房。
    // ▎为什么在 joinRoom 外面建？joinRoom 只负责"放人进门"，
    //   而密码是"这个房间的属性"，应该随房间诞生就定下来。
    rooms.set(roomNumber, { password: password || null, members: new Set() });
    if (password) console.log(`🔒 房间 ${roomNumber} 已设置入会密码`);
    // 房间号输出①：打到服务器控制台，方便演示时口头报号
    console.log(`🆕 新房间已创建：${roomNumber}（创建者 ${socket.id}）`);
    // 房间号输出②：发给创建者的页面，显示在右上角徽标上
    socket.emit('room-created', { roomNumber });

    joinRoom(roomNumber); // 创建者自己就是房间第 1 个人
  });

  /* ---- 事件 2：join-room —— "我要进这个房间号" ----
   * 和创建的区别：房间必须**已经存在**（号是别人创建出来的）。
   * 第 2.9 节起要过三关才放行：
   *   格式关（6 位纯数字）→ 存在关（rooms 里有这个号）→ 密码关（对不上就拒）
   */
  socket.on('join-room', ({ roomNumber, password } = {}) => {
    if (socket.roomNumber) return; // 防止同一个连接重复加入

    if (!/^\d{6}$/.test(roomNumber || '')) {
      socket.emit('room-not-found', { roomNumber }); // 格式都不对 = 必然不存在
      return;
    }
    const room = rooms.get(roomNumber);
    if (!room) {
      socket.emit('room-not-found', { roomNumber }); // 号是对的，但房间已散会/没开过
      console.log(`[!] ${socket.id} 想加入不存在的房间 ${roomNumber}`);
      return;
    }

    // 第三关：密码关。房间设了密码，就必须输入一致才能进
    //   ▎没设密码的房间（password 为 null）直接跳过，行为跟以前完全一样
    if (room.password && room.password !== (password || '')) {
      socket.emit('room-wrong-password', { roomNumber });
      console.log(`[!] ${socket.id} 想加入房间 ${roomNumber}，但密码不对`);
      return;
    }

    joinRoom(roomNumber);
  });

  /* ---- 事件 3/4/5：offer / answer / ice-candidate —— 定向转发 ----
   *
   * 每条消息都要带 to（发给谁），服务器只转给那个人。
   * 转发时再附加 from（谁发的），收消息的一方才能知道
   * "这条 offer/answer/候选地址 属于哪条连接"。
   */
  socket.on('offer', ({ to, offer }) => {
    io.to(to).emit('offer', { from: socket.id, offer });
  });

  socket.on('answer', ({ to, answer }) => {
    io.to(to).emit('answer', { from: socket.id, answer });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });

  /* ---- 事件 5.5：远程协助控制权（H5 远程桌面 Phase 1 · 信令层）----
   *
   * ▎这套事件干什么？
   *   屏幕共享只解决"画面给你看"；远程桌面还要解决"我的鼠标键盘能控制你"。
   *   控制权必须被控方授权，且同一时刻只允许一个人控制——所以服务器要管"谁在控谁"。
   *   流程：控制端 remote-request → 被控端弹窗 remote-answer(ok) →
   *         服务器记下并广播 remote-state → 两端再走 P2P DataChannel 传控制事件（Phase 2+）。
   *
   * ▎本阶段只做"信令层"：申请/授权/互斥/释放 全部走服务器，
   *   真正的鼠标键盘事件流走 ctrl_ DataChannel（浏览器直连，见 client.js Phase 2）。
   */
  socket.on('remote-request', ({ to } = {}) => {
    const roomNumber = socket.roomNumber;
    const room = rooms.get(roomNumber);
    // 只有"同房间的人"才有资格申请控制（防御：防止乱发给房间外的人）
    if (!room || !room.members.has(to)) return;

    // 互斥：这个房间已经有人在被控制 → 拒绝新申请（busy 走 remote-answer 回给申请者）
    const ctl = remoteCtl.get(roomNumber);
    if (ctl && ctl.controllerId) {
      socket.emit('remote-answer', { from: to, ok: false, reason: 'busy' });
      console.log(`[!] ${socket.id} 想控制 ${to}，但已被 ${ctl.controllerId} 控制`);
      return;
    }

    // 放行：把申请转发给被控端（to），并附上 from = 谁申请的
    io.to(to).emit('remote-request', { from: socket.id });
    console.log(`🖱️ ${socket.id} 请求控制 ${to}`);
  });

  socket.on('remote-answer', ({ to, ok, reason, durationMs } = {}) => {
    const roomNumber = socket.roomNumber;
    const room = rooms.get(roomNumber);
    if (!room || !room.members.has(to)) return;

    if (!ok) {
      // 被控端拒绝了 → 把"拒绝"转回给申请者。
      //   reason 透传（H5 远程桌面 Phase 4）：前端区分'not-sharing'
      //   （对方没共享/没开协助）和普通拒绝，给申请者不同的提示文案；
      //   被控端没带 reason 的（点了拒绝按钮）统一当 'denied'。
      //   ★ 升级 A6 新增一种 reason：'blocked'（被控端把这个人拉进了本地黑名单，
      //     以后他的申请一律自动拒绝——黑名单存在**被控端浏览器**里，不落服务器）。
      io.to(to).emit('remote-answer', { from: socket.id, ok: false, reason: reason || 'denied' });
      return;
    }

    // 允许了 → 再检查一次互斥（防"两人同时允许"的竞态），然后登记 + 全房广播
    const ctl = remoteCtl.get(roomNumber);
    if (ctl && ctl.controllerId && ctl.controllerId !== to) {
      io.to(to).emit('remote-answer', { from: socket.id, ok: false, reason: 'busy' });
      return;
    }
    // ★ 升级 A6：登记时连 expiresAt/timer 一起建（限时授权三件套）
    remoteCtl.set(roomNumber, { hostId: socket.id, controllerId: to, expiresAt: null, timer: null });
    const expiresAt = scheduleRemoteExpiry(roomNumber, durationMs);
    // 回执给申请者：带上到期时刻，控制端据此自己画倒计时
    io.to(to).emit('remote-answer', { from: socket.id, ok: true, expiresAt });
    // 广播全房：hostId / controllerId / expiresAt（null = 不限时）
    io.to(roomNumber).emit('remote-state', { hostId: socket.id, controllerId: to, expiresAt });
    const durText = expiresAt ? `，限时 ${Math.round((expiresAt - Date.now()) / 1000)} 秒` : '，不限时';
    console.log(`🖱️ 房间 ${roomNumber}：${to} 开始控制 ${socket.id}（授权方${durText}）`);
  });

  // 释放控制：被控端收回 / 控制端主动放弃 都能触发
  socket.on('remote-release', () => {
    const roomNumber = socket.roomNumber;
    if (roomNumber) clearRemoteCtl(roomNumber);
  });

  /* ---- 事件 6：disconnect —— 有人离开房间，通知其他人 ---- */
  socket.on('disconnect', () => {
    console.log(`[-] 用户断开: ${socket.id}`);

    if (socket.roomNumber) {
      const room = rooms.get(socket.roomNumber);
      if (room) {
        const members = room.members;
        members.delete(socket.id);                                    // 从成员表移除

        // ★ 远程控制清理：离开的是被控端/控制端 → 控制权作废
        //   （被控端走了没人可被控；控制端走了要释放位置给别人）
        const ctl = remoteCtl.get(socket.roomNumber);
        if (ctl && (ctl.hostId === socket.id || ctl.controllerId === socket.id)) {
          clearRemoteCtl(socket.roomNumber);                          // 广播 remote-state 复位
        }

        socket.to(socket.roomNumber).emit('peer-left', { id: socket.id }); // 通知其他人
        if (members.size === 0) {
          rooms.delete(socket.roomNumber); // 房间空了，整个删掉 → 房间号回收，以后可再被生成
          // ★ 顺带清掉该房间的控制权记录（防内存残留）。
          //   注意这里**不能**走 clearRemoteCtl()：房间都空了，广播给谁听？
          //   但定时器必须亲手 clearTimeout——否则到点还会跑一次回调（幽灵定时器）。
          const leftover = remoteCtl.get(socket.roomNumber);
          if (leftover && leftover.timer) clearTimeout(leftover.timer);
          remoteCtl.delete(socket.roomNumber);
          console.log(`🗑️ 房间 ${socket.roomNumber} 已空，自动销毁（号码回收）`);
        }
        console.log(`[-] ${socket.id} 离开房间（剩 ${members.size} 人）`);
      }
    }
  });
});

/* ──────────────────────────────────────────────────────────────
 * 启动
 * ────────────────────────────────────────────────────────────── */

httpServer.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`\n服务已启动: http://localhost:${LISTEN_PORT}`);
  console.log(`打开 2~3 个浏览器窗口：第 1 个点「创建房间」拿房间号，`);
  console.log(`其余窗口输入房间号点「加入房间」，即可测试多人会议。`);
  // ★ 跨网自检：启动即把"这台机器打算怎么打洞"说清楚，
  //   省得连不上时还得回去翻代码看 ICE 到底配了什么。
  const ice = iceServersForClient();
  const stun = ice.filter((s) => String(s.urls).startsWith('stun:')).length;
  const turn = ice.filter((s) => String(s.urls).startsWith('turn')).length;
  console.log(`\n🧊 ICE 配置：STUN ${stun} 条 / TURN ${turn} 条` +
    (turn === 0 ? '（⚠️ 无 TURN：双方都在严格 NAT 时会连不上，见 README「跨网络部署」）' : ''));
  if (CONFIG.publicUrl) console.log(`🔗 公网地址：${CONFIG.publicUrl}`);
  console.log(`🌐 监听：${LISTEN_HOST}:${LISTEN_PORT}（配置来源：${fs.existsSync(CONFIG_FILE) ? 'mesh.config.json' : '代码默认值'}）\n`);
});
