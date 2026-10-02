/* ════════════════════════════════════════════════════════════════
 * client.js —— 浏览器端代码（多人会议 Mesh 版 · 房间化）
 *
 * ▎这个文件到底在干什么？（先看这一段，心里有个地图）
 *
 * 房间化之前的进入方式：所有人点同一个「加入房间」，挤进写死的"会议A"。
 * 房间化之后的进入方式（两条路，对应页面上的房间面板）：
 *   ① 点「创建房间」→ 服务器生成 6 位房间号发回来 → 显示在右上角（房间号输出）
 *   ② 输入别人的房间号点「加入房间」→ 号对就进房，号错弹"房间不存在"
 *   进房以后的事情（Mesh 建连）和之前完全一样，一行没改。
 *
 * ▎关键约定（Mesh 建连策略，记住这一条就懂了）：
 *   「新人主动 connect 所有老成员」
 *   —— 新来的人对房间里的每个人 createOffer（当 caller），
 *      老成员只要坐着等 offer、回 answer 就行。
 *      这样永远不会出现"两个人同时发 offer"的冲突。
 *
 * ▎代码执行顺序（页面打开后）：
 *   ① 连接服务器 → ② 打开摄像头 → ③ 创建房间 或 输房间号加入 →
 *   ④ 新人连所有老成员 / 老成员等新人 offer → ⑤ 互发 ICE 地址
 *   → ⑥ 全员连通，每人的画面都显示出来
 * ════════════════════════════════════════════════════════════════ */

/* ──────────────────────────────────────────────────────────────
 * 第 1 步：找网页元素 + 快捷方式
 * （$ 就是 document.getElementById 的简写）
 * ────────────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

const localVideo = $('localVideo');   // 显示"我自己"画面的 <video>
const videoGrid = $('videoGrid');     // 装所有人视频的容器（网格）
const logPanel = $('log');            // 日志区
const connBadge = $('connBadge');     // 顶上的连接状态
const netBadge = $('netBadge');       // 顶上的网络质量徽标（第 16 步 getStats 定时刷新）
const connType = $('connType');       // ★ 09-15 同构补齐：P2P 直连/STUN 穿墙/TURN 中继徽标
const memberCount = $('memberCount'); // 显示房间人数
const roomBadge = $('roomBadge');     // ★ 房间号徽标（进房后显示，点击复制邀请链接）
const roomPanel = $('roomPanel');     // 房间面板（创建/加入那一条）
const createBtn = $('createBtn');     // 「创建房间」按钮
const roomInput = $('roomInput');     // 房间号输入框
const roomPasswordInput = $('roomPasswordInput'); // 房间密码框（创建者设锁 / 加入者开锁，可留空）
const joinRoomBtn = $('joinRoomBtn'); // 「加入房间」按钮
const leaveBtn = $('leaveBtn');       // 「离开房间」按钮
const muteBtn = $('muteBtn');
const camBtn = $('camBtn');
const shareBtn = $('shareBtn');       // 「共享屏幕」按钮

// ★ H5 远程桌面（Phase 4）：被控端工作台 + 允许协助开关（元素清单见 index.html 注释）
const assistBtn = $('assistBtn');           // 「允许远程协助」开关（共享时才出现）
const workbenchArea = $('workbenchArea');   // 工作台容器（工具条 + iframe）
const workbenchFrame = $('workbenchFrame'); // 工作台 iframe（事件重放目标）
const wbStatus = $('wbStatus');             // 工作台工具条上的状态文字
const wbReclaimBtn = $('wbReclaimBtn');     // 「收回控制」（正在被控时显示）
const wbAssistOffBtn = $('wbAssistOffBtn'); // 「关闭远程协助」（收工作台，共享继续）
const wbStopShareBtn = $('wbStopShareBtn'); // 「停止共享」（工具条内的等效按钮）
const remoteCursorEl = $('remoteCursor');   // 远程光标（被控端显示"控制端的鼠标"）

// 聊天侧边栏元素
const chatList = $('chatList');       // 聊天消息列表容器
const chatInput = $('chatInput');     // 聊天输入框
const chatSendBtn = $('chatSendBtn'); // 「发送」按钮

/* ★ 升级 A3/A4/A6/D2/D3 新增元素清单
 * ▎为什么统一在"第 1 步"一次性取好？
 *   元素引用集中在一处，后面任何一段代码想用就直接用变量，
 *   不用满文件散落 $('xxx')——教学项目里"找元素"这件事越集中越好讲。 */
const wbClipBtn = $('wbClipBtn');           // A3：被控端「把剪贴板发给控制端」
const wbAuditBtn = $('wbAuditBtn');         // A6：被控端「审计日志」
const wbExpire = $('wbExpire');             // A6：被控端倒计时显示
const remoteDuration = $('remoteDuration'); // A6：授权时长下拉（60秒/5分钟/不限）
const remoteBlockBtn = $('remoteBlockBtn'); // A6：「不再允许 TA」（本地黑名单）
const fileAskBox = $('fileAskBox');         // A4：文件接收询问卡片
const fileAskText = $('fileAskText');       // A4：询问卡片文字
const fileAcceptBtn = $('fileAcceptBtn');   // A4：「接受」
const fileDenyBtn = $('fileDenyBtn');       // A4：「拒绝」
const filePanel = $('filePanel');           // A4：传输进度 / 下载链接面板
const auditPanel = $('auditPanel');         // A6：审计日志面板
const auditList = $('auditList');           // A6：日志条目容器
const auditFoot = $('auditFoot');           // A6：日志条数
const auditExportBtn = $('auditExportBtn'); // A6：导出 .txt
const auditClearBtn = $('auditClearBtn');   // A6：清空
const auditCloseBtn = $('auditCloseBtn');   // A6：关闭面板
const camSelect = $('camSelect');           // D3：摄像头下拉框
const micSelect = $('micSelect');           // D3：麦克风下拉框
const selfBox = $('selfBox');               // D2：自己的视频格（说话高亮用）
const memberListEl = $('memberList');       // 成员列表容器
const memberCount2 = $('memberCount2');     // 成员列表标题上的人数

/* ──────────────────────────────────────────────────────────────
 * 第 2 步：日志工具
 * ────────────────────────────────────────────────────────────── */
function log(msg) {
  const time = new Date().toLocaleTimeString();
  logPanel.textContent += `[${time}] ${msg}\n`;
  logPanel.scrollTop = logPanel.scrollHeight;
}

/* ──────────────────────────────────────────────────────────────
 * 第 3 步：连接信令服务器
 * ────────────────────────────────────────────────────────────── */
const socket = io();
log('正在连接信令服务器...');

socket.on('connect', () => {
  log(`✅ 信令服务器已连接（我的 id: ${socket.id}）`);
  connBadge.textContent = '已连服务器';
  connBadge.className = 'badge connected';
  renderMemberList(); // ★ 成员列表：连上才知道我的 id，这时候把"我"那行刷新成真实 id
});

/* ──────────────────────────────────────────────────────────────
 * 第 4 步：打开摄像头 + 麦克风
 * ────────────────────────────────────────────────────────────── */
let localStream = null;
let cameraTrack = null;   // ★ 记录"原始摄像头轨"：切回摄像头时要换回来
let sharingScreen = false; // 当前是否在共享屏幕

/* ★ 09-24 跨网部署升级：ICE（STUN/TURN）改为"服务器下发 + 本地兜底"
 *
 * ▎这一步解决的是"跨网络连不上"最硬的那块：Mesh 版是 P2P，
 *   能不能连上完全取决于 ICE 打洞。只带 STUN 时，双方都在严格 NAT
 *   （公司网 / 4G/5G / 酒店 WiFi）就打不通；配上 TURN 才能一定连上。
 *   以前 ICE 写死在这里（只一条 Google STUN），换环境就得改代码——
 *   于是"发布到公网"这件事永远做不干净。现在改成启动时问服务器要。
 *
 * ▎拿不到怎么办？——**保持可用**：请求失败（离线 / 老服务器）就用默认 STUN，
 *   绝不因为一个配置请求把整个会议卡住。这是"配置是增强，不是依赖"。
 * ▎注意：下面所有建连都会 await iceReady，保证第一条 peer 用的就是正确配置。
 */
const ICE_FALLBACK = [{ urls: 'stun:stun.l.google.com:19302' }];
let ICE_SERVERS = ICE_FALLBACK;
const iceReady = fetch('config.json', { cache: 'no-store' })
  .then((r) => (r.ok ? r.json() : null))
  .then((cfg) => {
    if (cfg && Array.isArray(cfg.iceServers) && cfg.iceServers.length) {
      ICE_SERVERS = cfg.iceServers;
    }
    const stun = ICE_SERVERS.filter((s) => String(s.urls).startsWith('stun:')).length;
    const turn = ICE_SERVERS.filter((s) => String(s.urls).startsWith('turn')).length;
    log(`🧊 ICE 配置就绪：STUN ${stun} 条 / TURN ${turn} 条` +
      (turn === 0 ? '（无 TURN：跨网络遇到严格 NAT 可能连不上）' : '（打洞失败可退回中继，跨网更稳）'));
    return ICE_SERVERS;
  })
  .catch(() => {
    log('🧊 没能取到服务器 ICE 配置，改用默认 STUN（不影响局域网/普通家庭宽带）');
    return ICE_SERVERS;
  });


async function startLocalMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    // 把"摄像头视频轨"存起来，供屏幕共享结束后 replaceTrack 换回
    cameraTrack = localStream.getVideoTracks()[0];
    localVideo.srcObject = localStream;
    log('✅ 本地媒体就绪（摄像头 + 麦克风）');
    createBtn.disabled = false;   // 有摄像头了才能建房/进房
    joinRoomBtn.disabled = false; // （建连时要把本地流 addTrack 给每个成员）
    roomInput.disabled = false;
    roomPasswordInput.disabled = false; // 密码框同理，等媒体就绪才可编辑
    muteBtn.disabled = false;
    camBtn.disabled = false;
    shareBtn.disabled = false; // 有摄像头了才能共享

    // ★ 升级 D3：媒体就绪后才列设备——因为 enumerateDevices() 的 label（"HD WebCam"这种
    //   人类可读的名字）**只有在拿到权限之后才有值**，没权限时返回的是一堆空 label。
    //   顺序很重要：先 getUserMedia（拿到权限）→ 再列设备 → label 才是全的。
    loadDevices();
    // ★ 升级 D2：给"本地麦克风流"建音量分析器（说话人指示器的本地那一路）。
    //   键名固定用 'self' 而不是 socket.id：本地那一路不属于任何"远端成员"，
    //   而且页面刚加载时 socket 可能还没连上（拿不到 id），用固定键最稳。
    ensureAudioCtx();
    attachAnalyser('self', localStream, selfBox);

    // ★ URL 里带了房间号（比如别人发给你的邀请链接 ?room=123456）
    //   → 不用再手输，直接自动加入（这就是"复制邀请链接"的接收端）
    if (pendingRoom) {
      log(`🔗 从链接识别到房间号 ${pendingRoom}，自动加入...`);
      socket.emit('join-room', { roomNumber: pendingRoom });
      createBtn.disabled = true;
      joinRoomBtn.disabled = true;
    }
  } catch (err) {
    log(`❌ 拿不到摄像头/麦克风：${err.name}（请允许权限）`);
  }
}

/* ──────────────────────────────────────────────────────────────
 * 第 5 步：⭐ 房间面板 —— 创建房间 / 凭号加入（房间化核心 · 第 2.8/2.9 节）
 *
 * ▎进房的两条路（和腾讯会议一个套路）：
 *   ① 创建：emit('create-room') → 服务器发 6 位新号回来（room-created）
 *           → 显示到右上角徽标，把号告诉别人就能邀请
 *   ② 加入：输入 6 位号 emit('join-room') → 服务器查有这个房就放进来
 *           → 查不到回 room-not-found（输错了/已散会）
 *
 * ▎密码框（第 2.9 节）一个框两种用法：
 *   创建者：先填密码再点「创建房间」= 给新房间上锁（房间号 + 密码都要给别人才进得来）
 *   加入者：填别人告诉你的密码再点「加入房间」= 开锁进门
 *   密码留空：创建 = 不设锁；加入 = 只能进"本来就没锁"的房间
 *   密码输错 → 服务器回 room-wrong-password（新事件）
 *
 * ▎进房后统一走 enterRoom()：显示房间号、藏起面板、点亮「离开」。
 *   再往后就是老流程：room-members → 新人主动连所有人。
 * ────────────────────────────────────────────────────────────── */

// 从地址栏读 ?room=123456（URLSearchParams 是浏览器自带的取参数工具）
// 先校验格式再存，脏参数直接当没有
const pendingRoom = (() => {
  const r = new URLSearchParams(location.search).get('room');
  return /^\d{6}$/.test(r || '') ? r : null;
})();

let myRoom = null; // 我所在的房间号（null = 还没进任何房间）

// 进房成功的公共收尾：显示房间号 + 藏面板 + 点亮「离开房间」
function enterRoom(roomNumber) {
  if (myRoom) return;      // 已在房间里（room-created 和 room-members 会各触发一次）
  myRoom = roomNumber;
  roomBadge.textContent = `🏠 房间号 ${roomNumber}`;
  roomBadge.classList.remove('hidden');
  roomPanel.classList.add('hidden'); // 创建/加入面板用不上了，收起来
  leaveBtn.disabled = false;
  log(`🏠 已进入房间「${roomNumber}」。把房间号或右上角链接发给别人即可邀请`);
}

// 加房失败（不存在/已满/密码不对）后：把创建/加入按钮点亮，允许再试
function resetRoomButtons() {
  if (myRoom) return; // 已在房间里就不用恢复了
  createBtn.disabled = false;
  joinRoomBtn.disabled = false;
  roomInput.disabled = false;
  roomPasswordInput.disabled = false;
}

// ① 创建房间：让服务器发一个新号（可顺带设密码，第 2.9 节）
createBtn.addEventListener('click', () => {
  // ★ 升级 D2：浏览器规定 AudioContext 必须在"用户手势"里才能出声/跑起来
  //   （自动播放策略，防网页静默监听）。这个点击就是最自然的解锁时机。
  ensureAudioCtx();
  const password = roomPasswordInput.value.trim();
  log(password
    ? `🏢 正在创建新房间（并设置密码 ${password}）...`
    : '🏢 正在创建新房间...');
  // 带密码创建：服务器会把这个密码记在房间上；以后别人想进必须答对
  socket.emit('create-room', password ? { password } : {});
  createBtn.disabled = true;
  joinRoomBtn.disabled = true;
});

// 服务器回：房间号是 xxx（马上显示出来，随后 room-members 会触发建连）
socket.on('room-created', ({ roomNumber }) => {
  log(`✅ 房间创建成功！你的房间号：${roomNumber}（右上角可点击复制邀请链接）`);
  enterRoom(roomNumber);
});

// ② 凭号加入：先本地校验格式，再发给服务器查"有没有这个房"
//    （同时把密码一起发过去——没填就发空串，服务器据此判断"要不要密码"）
function tryJoinRoom() {
  ensureAudioCtx(); // ★ 升级 D2：同样是用户手势，顺手解锁 AudioContext（见 createBtn 注释）
  const num = roomInput.value.trim();
  if (!/^\d{6}$/.test(num)) {
    log('⚠️ 房间号是 6 位数字，请检查输入');
    return;
  }
  const password = roomPasswordInput.value.trim();
  log(password
    ? `👋 正在加入房间 ${num}（携带密码）...`
    : `👋 正在加入房间 ${num}...`);
  socket.emit('join-room', { roomNumber: num, password });
  createBtn.disabled = true;
  joinRoomBtn.disabled = true;
}

joinRoomBtn.addEventListener('click', tryJoinRoom);
// 在输入框里按回车 = 点「加入房间」
roomInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tryJoinRoom();
});
// 密码框里按回车也一样（顺手填完密码就能直接进）
roomPasswordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tryJoinRoom();
});

/* ★ 2026-10-03 与主版本（sfu/）同步的一条修复（AGENTS 坑 57 的"半迁移"纪律：
 *   同一个坑只修一半 = 等于没修）。SFU 那边先修的，症状是用户被原生弹窗循环卡住：
 *   服务器重启 → 房间（内存结构）没了 → 重连拿旧 myRoom 再 join → room-not-found
 *   → **原生模态框阻塞主线程** → 点掉 → 又重连 → 又弹。
 *   两个错叠加：① 用阻塞模态报一个会重复发生的事件；② `myRoom` 从来没有作废路径
 *   （进过房就永远自认为在房里，徽标还挂着死房号）。
 *   Mesh 版没有 D6 那套"重连自动重回房间"的状态机，所以循环风险比 SFU 低，
 *   但**"房间已经没了、界面还以为在房里"这个错状态两边都有**，因此一并修。
 * ▎Mesh 的 enterRoom 只动了三样东西（徽标/面板/离开按钮），这里就对称地复原三样，
 *   不去发明新状态（对照版保持简单是它的教学价值）。 */
function giveUpRoom(why) {
  const gone = myRoom;
  myRoom = null;
  roomBadge.classList.add('hidden');
  roomPanel.classList.remove('hidden');
  leaveBtn.disabled = true;
  resetRoomButtons();
  log(`🚪 房间 ${gone || '(无)'} 已经不在了：${why} —— 已退回加入页，不会再自动去敲这扇门`);
}

// 房间号不存在（输错了 / 房间已散会 / 格式不对）
socket.on('room-not-found', ({ roomNumber }) => {
  log(`❌ 房间 ${roomNumber || '(空)'} 不存在：可能输错了，或对方已结束会议`);
  if (myRoom) {
    giveUpRoom('这个号已经不存在（多半是服务器重启过，或最后一人离开后房间被回收）');
    showToast(`房间 ${roomNumber || ''} 已不存在——请核对房间号，或直接创建一个新房间`, 'error');
    return;
  }
  resetRoomButtons();
  if (roomInput) { roomInput.value = ''; roomInput.focus(); }
  showToast(`房间 ${roomNumber || ''} 不存在，请核对房间号（或点「创建房间」开一个新的）`, 'error');
});

// 房间在，但需要密码 / 密码不对（第 2.9 节新增事件）
socket.on('room-wrong-password', ({ roomNumber }) => {
  log(`🔒 房间 ${roomNumber || ''} 需要密码：密码为空或不对，进不去`);
  resetRoomButtons();                       // 按钮点亮，允许补填密码再试
  if (!myRoom && roomNumber) {
    roomInput.value = roomNumber;           // 邀请链接直达失败时：房间号已填好，只差密码
    roomPasswordInput.focus();              // 光标直接放到密码框，输入完回车即可
  }
  showToast(`房间 ${roomNumber || ''} 需要密码，请输入正确密码后再加入`, 'error');
});

// ③ 点右上角房间号徽标 → 复制邀请链接（对方打开即自动进房）
roomBadge.addEventListener('click', async () => {
  if (!myRoom) return;
  const link = `${location.origin}/?room=${myRoom}`;
  try {
    await navigator.clipboard.writeText(link);
    log(`📋 邀请链接已复制：${link}（发给别人，打开就自动进你的房间）`);
  } catch (err) {
    log(`📋 自动复制失败，请手动复制：${link}`);
  }
});

// 「离开房间」：断开连接（服务器会通知其他人 peer-left）+ 刷新页面归零
leaveBtn.addEventListener('click', () => {
  socket.disconnect();
  location.reload();
});

muteBtn.addEventListener('click', () => {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    muteBtn.textContent = audioTrack.enabled ? '静音' : '取消静音';
    log(audioTrack.enabled ? '🔊 声音已开启' : '🔇 已静音');
    renderMemberList(); // ★ 成员列表：我的 🎤/🔇 要立刻跟着变（同一个状态的两种视图）
  }
});

camBtn.addEventListener('click', () => {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    camBtn.textContent = videoTrack.enabled ? '关摄像头' : '开摄像头';
    log(videoTrack.enabled ? '📷 摄像头已开启' : '🚫 摄像头已关闭');
  }
});

/* ──────────────────────────────────────────────────────────────
 * 第 5.5 步：⭐ 屏幕共享（PDF 第 4.3 / 12 章）
 *
 * ▎关键概念：replaceTrack（换轨，连接不重开）
 *   想换共享内容时，**不需要重新握手/重建连接**。
 *   只要：找到这条 pc 上"发送视频"的那个 sender，然后
 *   sender.replaceTrack(新轨道)  —— 浏览器会立刻换成发送新内容。
 *   这是屏幕共享/切摄像头最优雅、也是面试最值得讲的点。
 *
 * ▎流程：
 *   点「共享屏幕」
 *     → getDisplayMedia() 拿到屏幕流（浏览器会弹"选哪个窗口/整个屏幕"）
 *     → 把屏幕的视频轨 replaceTrack 到「每个成员」的连接上
 *     → 本地预览也换成屏幕（自己能看到共享的内容）
 *   再点「停止共享」
 *     → 把原始的摄像头轨 replaceTrack 回去
 * ────────────────────────────────────────────────────────────── */
shareBtn.addEventListener('click', async () => {
  if (!cameraTrack) return;
  shareBtn.disabled = true;   // 防止连点

  try {
    if (!sharingScreen) {
      // ① 获取屏幕流（getDisplayMedia 会弹系统选窗口框）
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,      // 屏幕画面
        audio: false,     // 屏幕上放出的声音，先不采集（简化）
      });
      const screenTrack = screenStream.getVideoTracks()[0];

      // ② 屏幕停止分享时（用户点系统栏"停止共享"）自动清理
      screenTrack.onended = () => stopSharing();

      // ③ 对每个成员：把他们的 video sender 换成屏幕轨
      replaceVideoOnAll(screenTrack);

      // ④ 本地预览也换成屏幕（这样自己知道在共享什么）
      localVideo.srcObject = screenStream;

      sharingScreen = true;
      shareBtn.textContent = '停止共享';
      camBtn.disabled = true; // 共享屏幕时关摄像头按钮暂时无效
      // ★ H5 远程桌面：共享中出现「允许远程协助」开关（规划第 9 节决策点 1 的推荐形态：
      //   共享者主动开 = 最像真实产品；不共享时不可被请求，见 remote-request 的自动拒绝）
      assistBtn.classList.remove('hidden');
      assistBtn.disabled = false;
      log('🖥️ 已开始共享屏幕！所有成员将看到你的屏幕');
    } else {
      // 从共享回到摄像头
      stopSharing();
    }
  } catch (err) {
    log(`⛔ 取消或无法共享屏幕：${err.name}（可能是用户点了"取消"）`);
    shareBtn.disabled = false;
  }
});

// 停止共享：把每个成员的 video sender 换回摄像头轨
function stopSharing() {
  if (!sharingScreen) return;
  // ★ H5 远程桌面：不共享 = 不再存在"可被控的桌面" → 自动关闭远程协助（坑 #8 清理路径之一）
  //   turnOffAssist 内部会：结束进行中的控制 + 收工作台 + 复位开关 UI
  if (assistOn) turnOffAssist();
  assistBtn.classList.add('hidden');
  assistBtn.disabled = true;
  replaceVideoOnAll(cameraTrack);          // 换回原来的摄像头
  localVideo.srcObject = localStream;      // 本地预览换回摄像头
  sharingScreen = false;
  shareBtn.textContent = '共享屏幕';
  camBtn.disabled = false;
  log('📷 已切回摄像头');
}

// 核心：对所有 peer 的连接，把"视频发送器"换成 targetTrack
function replaceVideoOnAll(targetTrack) {
  if (!targetTrack) return;
  Object.values(peers).forEach((peer) => {
    // pc.getSenders() = 这条连接上所有"我发出的轨道"的发送器
    // track.kind === 'video' → 找到视频发送器
    const videoSender = peer.pc
      .getSenders()
      .find((s) => s.track && s.track.kind === 'video');
    if (videoSender) {
      // 换轨！浏览器立刻用新轨道发给对方，不用重建连接
      videoSender.replaceTrack(targetTrack);
    }
  });
}

/* ──────────────────────────────────────────────────────────────
 * 第 6 步：⭐ 核心数据结构 —— peers 字典
 *
 * ▎概念：什么是"字典"？
 *   一种"名字 → 东西"的对应表。这里就是：远端成员的 id → 他的连接。
 *
 *   peers = {
 *     'Ab3xYz' : { pc, video, box },   // 成员 Ab3xYz 的连接 + 视频框
 *     'Cd9Qwe' : { pc, video, box },   // 成员 Cd9Qwe 的连接 + 视频框
 *     ...
 *   }
 *
 * ▎为什么多人版必须用字典？
 *   1对1 版只有一个人，一个 pc 就够了；
 *   3 人会议每个人要连 2 个人 = 维护 2 条独立的 pc，
 *   每条 pc 都是独立的 P2P 连接，互不干扰。
 *   所以用 remoteId 当"钥匙"，把每条连接单独存放、单独管理。
 *
 * ▎每个成员在字典里的值存三样东西：
 *   pc    —— RTCPeerConnection（这条连接）
 *   video —— 显示这个成员的 <video> 元素
 *   box   —— 装这个 video 的容器（离开时要整个删掉）
 * ────────────────────────────────────────────────────────────── */

const peers = {}; // remoteId -> { pc, video, box }
// ★ 聊天 DataChannel：remoteId -> 那条连接上用于聊天传文本的 RTCDataChannel
//   （DataChannel 走 P2P，不经服务器；每条连接单独一条通道）
const channels = {};

// ★ H5 远程桌面（Phase 2）：远程控制 DataChannel 字典（与聊天通道并存，label 前缀区分）
//   同一条 P2P 连接（SCTP 隧道）上可以开多条通道，按 label 分流：chat_xxx 传聊天、
//   ctrl_xxx 传鼠标键盘控制命令——"同隧道、不同流"，互不干扰。
const ctrlChannels = {}; // remoteId -> ctrl RTCDataChannel

// ★ 远程控制状态机（Phase 5 · P0 规则：一个房间同时只有一对"被控-控制"关系）
//   rcRole   = 我此刻的角色：'host'（我的屏幕被控）/ 'controller'（我在控制别人）/ null
//   rcPeerId = 对端的 socket id（host 视角 = 控制端；controller 视角 = 被控端）
//   assistOn = 我是否打开了「允许远程协助」开关（成为 host 资格的本地开关）
//   ctrlReady = 控制端视角：ctrl 通道是否已 open（open 后才开始采集输入，坑 #3）
let rcRole = null;
let rcPeerId = null;
let assistOn = false;
let ctrlReady = false;

// 工具函数：socket id 很长（比如 "Ab3xYz9fQ1..."），只取后 4 位当"名字"
function shortId(id) {
  return id.slice(-4);
}

// 更新页面上的"房间人数"显示（本地 1 人 + 每个远端 1 人）
//   ★ 升级（成员列表）：顺带重绘成员列表——人数和成员列表本来就是同一份数据的两种视图，
//     放一起更新最不容易"两边不一致"（一个变了另一个忘刷）。
function updateMemberCount() {
  memberCount.textContent = `👥 ${1 + Object.keys(peers).length} 人`;
  renderMemberList();
}

/* ──────────────────────────────────────────────────────────────
 * ⭐ DataChannel 聊天（PDF 第 12.5 章）
 *
 * ▎先建立概念：信令 vs DataChannel
 *   1) 信令（我们做的 offer/answer/ICE）= 建连接前"找人和找路"的商量
 *      它必须走服务器，因为那时还没有 P2P。
 *   2) DataChannel = 连接建好之后，同一条 P2P 隧道里再开一条"文本通道"
 *      用来传聊天文字。它不需要服务器，直接 P2P 传。
 *
 * ▎谁建通道、谁收通道？
 *   每一条 P2P 连接上，DataChannel 有个约定：
 *   - 主动 createDataChannel('chat') 的一端（新人/发起方）
 *     会把这条通道的"开通信息"随着 SDP 一起告诉对端
 *   - 另一端只要监听 pc.ondatachannel 事件，就能"收到"这条通道
 *   - 对应我们 Mesh 的策略：新人主动建连 → 新人 createDataChannel；
 *     老成员在 createPeerFor 里挂 ondatachannel 接收。
 */
function appendChat(text, sender, isMe) {
  const item = document.createElement('div');
  // 系统消息（sender==='system'）用别的样式区分，否则显示成员名或"我"
  if (sender === 'system') {
    item.className = 'msg system';
    item.innerHTML =
      `<div class="msg-name">💬 系统</div>` +
      `<div class="msg-text">${escapeHtml(text)}</div>`;
  } else {
    item.className = isMe ? 'msg me' : 'msg other';
    item.innerHTML =
      `<div class="msg-name">${isMe ? '我' : shortId(sender)}</div>` +
      `<div class="msg-text">${escapeHtml(text)}</div>` +
      `<div class="msg-time">${new Date().toLocaleTimeString()}</div>`;
  }
  chatList.appendChild(item);
  chatList.scrollTop = chatList.scrollHeight; // 滚到底
}

// 聊天内容可能是 HTML 特殊字符（如 <script>），转义防止被当成代码执行
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ★ 处理收到的对端通道：挂 onmessage，把文本显示到聊天区
//   channel 属于哪个成员，由参数 sender 决定（发送者的 id）
function watchIncomingChannel(channel, sender) {
  channel.onmessage = (e) => {
    appendChat(e.data, sender, false);
  };
}

/* ──────────────────────────────────────────────────────────────
 * 第 7 步：⭐ 为一个远端成员创建连接（Mesh 的核心函数）
 *
 * 这个函数被两个场景共用：
 *   场景 A（我是新人）：对每个老成员调用 → 创建 pc + 主动发 offer
 *   场景 B（我是老成员）：新成员加入时调用 → 只创建 pc，等对方 offer
 *
 * 返回创建的连接对象，方便外面继续"发 offer"或"处理 answer"。
 * ────────────────────────────────────────────────────────────── */
function createPeerFor(remoteId) {
  // 如果已经连过这个人，直接返回旧连接（防止重复创建）
  if (peers[remoteId]) return peers[remoteId];

  // ① 动态创建一个视频框（HTML 里没有，用 JS 现场造）
  //    document.createElement('div') = 造一个 div 标签
  //    box.innerHTML = '...' = 往 div 里塞内容（video + 名字标签）
  //    videoGrid.appendChild(box) = 把 div 挂到页面的网格容器里
  const box = document.createElement('div');
  box.className = 'video-box';
  box.innerHTML =
    `<video autoplay playsinline></video>` +
    `<div class="video-label">成员 ${shortId(remoteId)}</div>` +
    // ★ 升级 D2：音量条（说话人指示器）——宽度由每秒多次的音量分析驱动
    `<div class="vol-bar"><i></i></div>` +
    // ★ H5 远程桌面（Phase 1 占位）：每个远端视频框右上角一个"请求控制"小按钮
    //   点它 = 申请控制"这个视频对应的人"（被控端会弹窗确认，见第 17 步）
    `<button class="remote-ctl-btn" title="请求远程控制该成员">🖱️ 请求控制</button>`;
  videoGrid.appendChild(box);
  const video = box.querySelector('video'); // 从 box 里取出那个 <video>
  // 绑定"请求控制"按钮：把点击转成对服务器的 remote-request（to = 这个成员的 id）
  box.querySelector('.remote-ctl-btn').addEventListener('click', () => {
    requestRemoteControl(remoteId);
  });

  // ② 创建这条 P2P 连接（RTCPeerConnection）
  //   ★ 09-24：ICE 来自服务器下发的配置（见上方 iceReady），
  //     不再写死——这样"同一个前端 + 不同 TURN 配置"就能在任意网络环境部署。
  const pc = new RTCPeerConnection({
    iceServers: ICE_SERVERS,
  });

  // 把本地媒体接进这条连接（对每个人都要接一次）
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  // 回调 1：这个成员的画面到了 → 显示到他自己的 video 里
  // ▎注意：因为 pc 是"每人一条"，ontrack 自然只属于这个人
  pc.ontrack = (event) => {
    video.srcObject = event.streams[0];
    log(`✅ 成员 ${shortId(remoteId)} 的画面已收到`);
    // ★ 升级 D2 说话人指示器（Mesh 版）：远端音频轨到达时，为"这条流"建一个
    //   AudioContext 分析器——Mesh 版每个 peer 的音频都是 P2P 直达我这里的，
    //   所以我能在**浏览器本地**直接算音量（对比 SFU 版：音频在服务器上转发，
    //   服务器顺路就能算，两端实现路径完全不同——这正是两版对照的教学点）。
    if (event.track && event.track.kind === 'audio') {
      attachAnalyser(remoteId, event.streams[0], box);
    }
  };

  // 回调 2：找到候选地址 → 定向发给这个成员（注意多了 to: remoteId）
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      const ip = event.candidate.candidate.split(' ')[3] || '?';
      log(`📮 给 ${shortId(remoteId)} 发候选地址（IP: ${ip}）`);
      socket.emit('ice-candidate', { to: remoteId, candidate: event.candidate });
    }
  };

  // 回调 3：这条连接的状态变化（每条连接独立汇报）
  pc.onconnectionstatechange = () => {
    log(`🔗 与 ${shortId(remoteId)} 的连接: ${pc.connectionState}`);
    if (pc.connectionState === 'connected') {
      log(`🎊 与成员 ${shortId(remoteId)} 的 P2P 已连通！`);
    }
  };

  // 回调 4（新）：对端通过 SDP 主动开了一条 DataChannel → 我们收到了
  //   ▎本端是"老成员/接听方"时才会触发（主动方是自己 createDataChannel）
  //   ★ H5 远程桌面（Phase 2）改造：按 label 前缀分流（坑 #2——原来只认 chat，
  //     不分流的话 ctrl 通道会被吞掉或覆盖聊天通道字典）：
  //     chat_xxx → 聊天逻辑；ctrl_xxx → 存进 ctrlChannels，挂控制协议监听。
  //     ctrl 通道由"被控端允许后"创建（见第 5.6 步 openCtrlChannel），
  //     所以收到 ctrl 通道的必然是"控制端"，角色固定为 'controller'。
  pc.ondatachannel = (event) => {
    const ch = event.channel;
    if (ch.label && ch.label.startsWith('chat')) {
      if (!channels[remoteId]) {
        channels[remoteId] = ch;
        watchIncomingChannel(ch, remoteId);
        ch.onopen = () => log(`💬 与成员 ${shortId(remoteId)} 的聊天通道已开通`);
        log(`💬 收到成员 ${shortId(remoteId)} 发来的 chat 通道`);
      }
    } else if (ch.label && ch.label.startsWith('ctrl')) {
      if (!ctrlChannels[remoteId]) {
        ctrlChannels[remoteId] = ch;
        watchCtrlChannel(ch, remoteId, 'controller');
        log(`🖱️ 收到成员 ${shortId(remoteId)} 的远程控制通道，等待开通...`);
      }
    }
  };

  // ③ 存进字典，返回
  peers[remoteId] = { pc, video, box };
  updateMemberCount();
  log(`🔧 已为成员 ${shortId(remoteId)} 创建连接`);
  return peers[remoteId];
}

/* ──────────────────────────────────────────────────────────────
 * 第 8 步：⭐ 新人视角 —— 主动去连所有老成员
 *
 * 服务器发来 room-members（房间里现在有谁）时，我是新人。
 * 策略：对每个人都调用 connectToPeer（建连接 + 发 offer）。
 *
 * ▎为什么让新人当 caller？
 *   offer/answer 是"一问一答"。如果两个人都抢着发 offer，
 *   会出现"两个人同时问"的尴尬（这叫 glare 冲突）。
 *   约定"新人主动、老人被动"，就永远不会冲突。
 * ────────────────────────────────────────────────────────────── */
socket.on('room-members', async ({ roomNumber, members }) => {
  enterRoom(roomNumber); // 进房收尾（创建者和加入者都从这条消息拿到房间号）

  if (members.length === 0) {
    log('🏠 我是这个房间的第 1 个人，等别人用房间号进来');
  } else {
    log(`🏠 房间里现有老成员 ${members.length} 人，我作为新人主动连接他们`);
    // ★ 09-24：建连前先等 ICE 配置到位——否则第一条 peer 会用到兜底的 STUN，
    //   配了 TURN 的严格 NAT 环境就正好"第一条连不上"（最容易被忽略的时序坑）
    await iceReady;
    members.forEach((remoteId) => connectToPeer(remoteId));
  }
});

// 建连接 + 主动发 offer（两步合一，只给"新人连老人"用）
async function connectToPeer(remoteId) {
  const peer = createPeerFor(remoteId);      // ① 建连接

  // ② 我是主动建连方：开一条 DataChannel 用于聊天
  //    ▎必须在 makeOffer/createOffer 之前调用，这样这条通道的
  //      "开通信息"（会写进 SDP）才能一并传给对端
  if (!channels[remoteId]) {
    const ch = peer.pc.createDataChannel('chat' + '_' + Math.random().toString(36).slice(2, 6), {
      // label 加个随机尾巴，避免多个连接标签重复
    });
    channels[remoteId] = ch;
    // 我是通道的发起方：挂 onopen（连通后提示）+ onmessage（接收对端上行文字）。
    // 对端（老成员）那端无需主动建，浏览器会通过 ondatachannel 把这条通道"吐"给它。
    watchIncomingChannel(ch, remoteId);
    // onopen 提示：这条 P2P 通道和媒体在同一连接上，连通后才可 send
    ch.onopen = () => log(`💬 与成员 ${shortId(remoteId)} 的聊天通道已开通`);
  }

  const offer = await peer.pc.createOffer(); // ③ 生成能力清单
  await peer.pc.setLocalDescription(offer);  // ④ 本地确认
  socket.emit('offer', { to: remoteId, offer }); // ⑤ 定向发给这个成员
  log(`📨 已向成员 ${shortId(remoteId)} 发送 offer`);
}

/* ──────────────────────────────────────────────────────────────
 * 第 9 步：老成员视角 —— 新成员来了，坐着等 offer
 *
 * 服务器广播 new-member 时，我是老成员：
 * 只要创建连接（挂好 ontrack 等回调），然后等新人发 offer 过来。
 * ────────────────────────────────────────────────────────────── */
socket.on('new-member', async ({ id }) => {
  log(`🆕 新成员 ${shortId(id)} 加入了房间，为他准备连接...`);
  await iceReady;      // ★ 同上：先等 ICE 配置，再建 peer
  createPeerFor(id);   // 只建连接，不发 offer（等对方开口）
});

/* ──────────────────────────────────────────────────────────────
 * 第 10 步：收到 offer → 回 answer（和 1对1 版几乎一样）
 *
 * ▎唯一变化：offer 消息里多了 from（谁发来的），
 *   我们要把 answer 定向发回给 from 这个人。
 * ────────────────────────────────────────────────────────────── */
socket.on('offer', async ({ from, offer }) => {
  log(`📥 收到成员 ${shortId(from)} 的 offer`);
  // 保险起见：如果还没为这个人建连接，现建一个
  await iceReady;
  const peer = createPeerFor(from);

  await peer.pc.setRemoteDescription(offer);      // 记住对方能力
  const answer = await peer.pc.createAnswer();    // 生成我的回应
  await peer.pc.setLocalDescription(answer);      // 本地确认
  socket.emit('answer', { to: from, answer });    // 定向发回
  log(`📨 已向成员 ${shortId(from)} 回复 answer`);
});

/* ──────────────────────────────────────────────────────────────
 * 第 11 步：收到 answer → 协商完成（多了 from）
 * ────────────────────────────────────────────────────────────── */
socket.on('answer', async ({ from, answer }) => {
  const peer = peers[from];
  if (!peer) return; // 理论上不会发生，防御一下
  await peer.pc.setRemoteDescription(answer);
  log(`📥 收到成员 ${shortId(from)} 的 answer，与他的协商完成 ✅`);
});

/* ──────────────────────────────────────────────────────────────
 * 第 12 步：收到 ICE 候选 → 加入对应那条连接
 *
 * ▎候选地址必须加入"对的那个人"的 pc，
 *   所以要用 from 从字典里把对应的连接取出来。
 * ────────────────────────────────────────────────────────────── */
socket.on('ice-candidate', async ({ from, candidate }) => {
  const peer = peers[from];
  if (!peer) return;
  try {
    await peer.pc.addIceCandidate(candidate);
  } catch (err) {
    console.warn('addIceCandidate 失败（可忽略）:', err);
  }
});

/* ──────────────────────────────────────────────────────────────
 * 第 13 步：有人离开 → 关掉他的连接，删掉他的视频框
 * ────────────────────────────────────────────────────────────── */
socket.on('peer-left', ({ id }) => {
  log(`👋 成员 ${shortId(id)} 已离开，清理他的连接和画面`);
  // ★ H5 远程桌面（Phase 5）：先做远程控制清理（坑 #8：离开=该对控制关系必然作废）
  cleanupRemoteCtrlForPeer(id);
  // ★ A4：正在和他握手/传输的文件一律作废（人走了，通道也没了）
  cancelFileWithPeer(id);
  const peer = peers[id];
  if (peer) {
    peer.pc.close();     // 关闭这条 P2P 连接
    peer.box.remove();   // 从页面删除他的视频框
    delete peers[id];    // 从字典里删掉
    if (channels[id]) { channels[id].close(); delete channels[id]; } // 关掉对应聊天通道
    detachAnalyser(id);  // ★ D2：拆掉这个成员的音量分析器（不然会说"幽灵话"）
    updateMemberCount(); // 内部会重绘成员列表
  }
});

/* ──────────────────────────────────────────────────────────────
 * 第 14 步：房间已满（服务器拒绝加入）
 * ────────────────────────────────────────────────────────────── */
socket.on('room-full', ({ max }) => {
  log(`❌ 房间已满（最多 ${max} 人），请稍后再试`);
  resetRoomButtons(); // 允许重新尝试（换房间号或创建新的）
  showToast(`房间已满（最多 ${max} 人），请稍后再试`, 'error');
});

/* ──────────────────────────────────────────────────────────────
 * 第 15 步：发送聊天消息（群聊广播）
 *
 * ▎群聊怎么发？
 *   用户敲一句话 → 对所有"已开通"的聊天通道广播（每个成员一条通道）
 *   → 每个成员的通道都把它送到 → 对方收到显示。自己也在本地回显一条。
 *
 * ▎注意通道状态：
 *   channel.readyState === 'open'  才表示通道可用可以 send
 *   （还没 open 的说明连接还在建立中，忽略）
 * ────────────────────────────────────────────────────────────── */
function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;

  // 本地回显我自己的消息
  appendChat(text, socket.id, true);

  // 广播给所有已开通的通道
  let sent = 0;
  Object.entries(channels).forEach(([id, ch]) => {
    if (ch.readyState === 'open') {
      ch.send(text); // 通过 DataChannel 直接 P2P 发给这个成员
      sent++;
    } else {
      log(`⚠️ 与成员 ${shortId(id)} 的通道未就绪（${ch.readyState}），暂无法发送`);
    }
  });
  if (sent === 0) {
    appendChat('（当前无已连通的成员，消息只显示给你自己）', 'system', false);
  }
  chatInput.value = ''; // 清空输入框
}

chatSendBtn.addEventListener('click', sendChat);
// 在输入框里回车也能发送（按 Enter 且不是 Shift+Enter 换行）
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

/* ──────────────────────────────────────────────────────────────
 * 第 16 步：getStats 网络监控（生产化 · PDF 第 14 章）
 *
 * ▎要解决什么问题？
 *   视频通了之后，网络好不好用户是看不见的。真实会议软件会在角落显示
 *   "网络良好/一般/较差"。原理：每隔几秒调一次 pc.getStats()，
 *   让浏览器把这条连接的真实统计吐出来，挑几个关键的报告类型看：
 *
 *   inbound-rtp         ← 我"收"到的媒体统计（packetsReceived 收包数 /
 *                         packetsLost 丢包数 / bytesReceived 收到字节）
 *   outbound-rtp        ← 我"发"出的媒体统计（bytesSent 发出字节）
 *   remote-inbound-rtp  ← 对方发给我的接收报告（roundTripTime = 往返延迟 RTT）
 *
 * ▎为什么能算"码率"？
 *   浏览器只给"累计字节数"。这一轮 1000 字节、上一轮 800 字节、相隔 3 秒，
 *   → 每秒多传 200 字节 → 码率 ≈ (200 × 8) / 3 ≈ 533 bps。
 *   所以要先存上一轮的字节数（lastStatsSample），每轮做减法。
 * ▎Mesh 多人怎么算？把每条连接的统计全加起来，看"总的网络健康度"。
 * ────────────────────────────────────────────────────────────── */

// 上一轮统计快照：t=取样时刻, sent=发出的累计字节, recv=收到的累计字节
let lastStatsSample = null;

// ★ A5② 自适应节流的数据源：把每一轮测到的 RTT 存到全局，
//   供第 17 步的"控制端发送节流"读取（网络越差 → 发得越稀）。
//   为什么不直接传参？因为 getStats 每 3 秒才跑一次，而控制事件每帧都发——
//   一个"慢变量"（网络质量）驱动一个"快变量"（发送频率），全局变量最直白。
let netRttMs = null; // null = 还没测到过

async function monitorNetwork() {
  const pcs = Object.values(peers).map((p) => p.pc);
  if (pcs.length === 0) {
    // 还没进会 / 还没有任何连接对象 → 徽标显示占位
    netBadge.textContent = '📶 网络 --';
    netBadge.className = 'badge idle';
    return;
  }

  // 汇总所有连接：收包 / 丢包 / 收发字节 / 延迟
  let received = 0, lost = 0, recvBytes = 0, sentBytes = 0;
  let rttMs = -1; // -1 = 还没收到对方反馈，显示"待测"
  const candTypes = new Set(); // ★ 09-15：连接方式可视化（P2P 里是与每个peer的候选类型汇总）

  for (const pc of pcs) {
    let stats;
    try {
      stats = await pc.getStats(); // 让浏览器吐这条连接的真实统计
    } catch (err) {
      continue; // 连接刚好在关闭（有人离开）时报错，跳过这一条即可
    }
    stats.forEach((r) => {
      if (r.type === 'inbound-rtp' && r.kind === 'video') {
        // 我收到的视频：丢包 = 对方发来但我没接住的数据包
        received  += r.packetsReceived || 0;
        lost      += r.packetsLost || 0;
        recvBytes += r.bytesReceived || 0;
      } else if (r.type === 'outbound-rtp' && r.kind === 'video') {
        // 我发出的视频
        sentBytes += r.bytesSent || 0;
      } else if (r.type === 'local-candidate' && r.candidateType) {
        candTypes.add(r.candidateType); // ★ 09-15：host=同网直连 / srflx=STUN / relay=TURN
      } else if (r.type === 'remote-inbound-rtp' && r.kind === 'video') {
        // 对方告诉我的：我发过去的包他们隔多久才收到（roundTripTime 单位是秒）
        if (typeof r.roundTripTime === 'number') {
          rttMs = Math.max(rttMs, r.roundTripTime * 1000); // 秒 → 毫秒
        }
      }
    });
  }

  // 还没有任何媒体数据（刚建连 / 还没画面）→ 提示"采集中"，这次不算码率
  if (received === 0 && sentBytes === 0) {
    netBadge.textContent = '📶 网络采集中…';
    netBadge.className = 'badge idle';
    lastStatsSample = null; // 基线清空，下次从干净状态开始算
    return;
  }

  // 丢包率 = 丢掉的包 ÷ (收到的包 + 丢掉的包)
  const lossRatio = (received + lost) > 0 ? lost / (received + lost) : 0;

  // 码率：这轮的累计字节 − 上一轮的累计字节 = 这段时间多传的量，换算成 kbps
  let upKbps = 0, downKbps = 0;
  const now = performance.now();
  if (lastStatsSample) {
    const dt = Math.max((now - lastStatsSample.t) / 1000, 0.001); // 距上一轮几秒
    upKbps   = Math.round(((sentBytes - lastStatsSample.sent) / dt) * 8 / 1000);
    downKbps = Math.round(((recvBytes - lastStatsSample.recv) / dt) * 8 / 1000);
  }
  lastStatsSample = { t: now, sent: sentBytes, recv: recvBytes };

  // 定级：丢包越多 / 延迟越高 → 网络越差（阈值是经验值，真实产品按 SLA 定）
  let level, word;
  if (lossRatio >= 0.03 || rttMs >= 400) {
    level = 'poor';   word = '网络较差';
  } else if (lossRatio >= 0.005 || rttMs >= 150) {
    level = 'medium'; word = '网络一般';
  } else {
    level = 'good';   word = '网络良好';
  }

  const rttText = rttMs >= 0 ? `${Math.round(rttMs)}ms` : '--';
  if (rttMs >= 0) netRttMs = rttMs; // ★ A5②：同步给控制端的自适应节流（第 17 步）
  netBadge.textContent =
    `📶 ${word} · 丢包${(lossRatio * 100).toFixed(1)}% · 延迟${rttText} · ↑${upKbps} ↓${downKbps}kbps`;
  netBadge.className = `badge ${level}`; // 背景色随状态变：绿=好 黄=中 红=差

  /* ★ 09-15：连接方式徽标（与 SFU 版同构）。Mesh 是 P2P——候选类型是全体 peer 的汇总：
   * 有 relay 说明某条连接在走 TURN 中继；全是 host/srflx = 直连/打洞成功。 */
  if (connType && candTypes.size) {
    const label = candTypes.has('relay') ? 'TURN 中继'
      : candTypes.has('srflx') ? 'STUN 穿墙' : '直连';
    connType.textContent = `🔗 ${label}`;
    connType.className = 'badge connected';
    connType.title = 'P2P 连接方式（全体 peer 汇总）：' + [...candTypes].join(' / ');
  }
}

// 每 3 秒体检一次（间隔太短费 CPU、太长反应慢，3 秒是常见选择）
setInterval(monitorNetwork, 3000);

/* ──────────────────────────────────────────────────────────────
 * H5 远程桌面 · Phase 1：控制权信令（占位版）
 *
 * ▎本段做什么？（对应 H5远程桌面-规划.md Phase 1 —— 只做"谁能控制谁"的信令）
 *   屏幕共享只解决"画面给你看"；远程桌面还要"我的鼠标键盘能控制你"。
 *   控制权必须由被控方授权、且同一时刻只能有一个人控制——本段实现"申请→确认"：
 *
 *     [控制端] 点视频框上的「请求控制」→ 发 remote-request {to: 被控端}
 *     [服务器] 检查该房间是否已被别人控制（busy）→ 转发给被控端
 *     [被控端] 页面弹出授权卡片 → 允许则发 remote-answer {ok:true}，拒绝则 {ok:false}
 *     [服务器] 登记"谁控谁" → 广播 remote-state 给全房间（含旁观者）
 *
 * ▎为什么控制器不自己记"我在控制谁"？
 *   互斥必须全房间唯一，浏览器各自看不见别人——所以由服务器管（唯一权威），
 *   前端只按 remote-state 显示状态。真正的鼠标键盘事件流走 ctrl_ DataChannel，
 *   是 Phase 2+ 的事（本段只到"拿到控制权"为止，是纯信令、无媒体）。
 * ────────────────────────────────────────────────────────────── */

// 控制端：点「请求控制」按钮 → 向服务器申请控制某位成员
//   remoteId = 被控端的 socket id（视频框是谁的，按钮就管谁）
function requestRemoteControl(remoteId) {
  if (!socket.id || !remoteId) return;
  // 防御：我已经在某个控制会话里（正在控别人/正被控）→ 不再发新请求
  if (rcRole) {
    showToast('你已在远程控制会话中，请先释放再请求', 'info');
    return;
  }
  log(`🖱️ 正在请求控制成员 ${shortId(remoteId)}...`);
  socket.emit('remote-request', { to: remoteId });
}

/* ---- 页面内嵌 UI：授权卡片 + toast ----
 * ▎为什么不用 confirm() 或任何原生模态框？
 *   浏览器原生弹窗在"页面失焦 / 用户勾过'阻止此页面再弹窗'"时会静默返回 false，
 *   表现为"点了允许却收到拒绝"——教学演示不可靠。这里全部换成页面里的 DOM，
 *   一定弹得出来、一定点得到。这也是真实软件的做法（自己的 UI 自己画）。
 */
const remoteAskBox = $('remoteAskBox');     // 授权卡片容器（被控端用）
const remoteAskText = $('remoteAskText');   // 卡片里的文字
const remoteAllowBtn = $('remoteAllowBtn'); // 「允许」按钮
const remoteDenyBtn = $('remoteDenyBtn');   // 「拒绝」按钮
const toastEl = $('toast');                 // 一次性轻提示

// 轻提示：右上角浮现 3 秒（type: ''成功 / 'error'失败 / 'info'普通）
let toastTimer = null;
function showToast(msg, type = '') {
  toastEl.textContent = msg;
  toastEl.className = `toast ${type}`;      // 重置动画（先移除再强制重排）
  void toastEl.offsetWidth;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3000);
}

// 被控端视角：收到别人的控制申请
//   ★ H5 远程桌面（Phase 4）规则（规划 3.2）：没共享屏幕 / 没开「允许远程协助」
//     = 没有"可被控的桌面" → 直接自动拒绝（reason: not-sharing），连弹窗都不弹；
//     只有"共享中 + 协助已开"才弹授权卡片等人决定。
let pendingFrom = null;
// ★ 升级 A6：「不再允许 TA」黑名单。为什么用 Set？
//   Set = "不重复的集合"，判断"在不在里面"是 O(1)，正是黑名单需要的语义
//   （名单里加同一个人两次没有意义）。黑名单只存在**被控端浏览器内存**里，
//   不上服务器、不落库——授权是被控端的权利，拒授权同样是被控端的权利。
const blockedPeers = new Set();

socket.on('remote-request', ({ from }) => {
  // ★ 升级 A6 第一关：本地黑名单（优先于一切判断——拉黑过的人连卡片都不弹）
  if (blockedPeers.has(from)) {
    log(`🚫 成员 ${shortId(from)} 在黑名单里，已自动拒绝其控制申请`);
    socket.emit('remote-answer', { to: from, ok: false, reason: 'blocked' });
    auditPush('拒绝申请', `来自 ${shortId(from)}（黑名单自动拒绝）`);
    return;
  }
  if (!sharingScreen || !assistOn) {
    log(`🖱️ 成员 ${shortId(from)} 请求控制，但你未开启远程协助 → 已自动拒绝`);
    socket.emit('remote-answer', { to: from, ok: false, reason: 'not-sharing' });
    auditPush('拒绝申请', `来自 ${shortId(from)}（未开启远程协助）`);
    return;
  }
  log(`🖱️ 成员 ${shortId(from)} 想控制你的屏幕...`);
  auditPush('收到控制申请', `来自 ${shortId(from)}`);
  pendingFrom = from;
  remoteAskText.textContent = `成员 ${shortId(from)} 想远程控制你的屏幕，是否允许？`;
  remoteAskBox.classList.remove('hidden');
});

remoteAllowBtn.addEventListener('click', () => {
  if (!pendingFrom) return;
  const requester = pendingFrom; // 先存下来，下面要把 pendingFrom 清空
  // ★ 升级 A6：把"授权时长"一起发过去。0 = 不限时（服务器把 expiresAt 记成 null）。
  const durationMs = Number(remoteDuration.value) || 0;
  socket.emit('remote-answer', { to: requester, ok: true, durationMs }); // 允许（信令先行，坑 #3：
  //   先回执让对端准备，ctrl 通道随后由我这边建立，open 后对端才开始采输入）
  remoteAskBox.classList.add('hidden');
  pendingFrom = null;
  const durText = durationMs ? `（限时 ${Math.round(durationMs / 1000)} 秒）` : '（不限时）';
  log(`🖱️ 已允许远程控制${durText}`);
  auditPush('允许控制', `来自 ${shortId(requester)}${durText}`);
  // ★ H5 远程桌面（Phase 2/4）：授权方握有主动权 —— 由被控端在「我与控制端的
  //   那条 P2P 连接」上建立 ctrl_ DataChannel（坑 #1：只有这一端建，对端只收），
  //   并把页面切到工作台视图（协助开关已开，工作台已在共享画面里）。
  rcRole = 'host';
  rcPeerId = requester;
  openCtrlChannel(requester);
  setWbStatus(`🖱️ 成员 ${shortId(requester)} 正在控制你的工作台`);
  wbReclaimBtn.classList.remove('hidden');
  showToast('✅ 已允许远程控制，可随时点「收回控制」');
});

remoteDenyBtn.addEventListener('click', () => {
  if (!pendingFrom) return;
  socket.emit('remote-answer', { to: pendingFrom, ok: false }); // 拒绝
  log(`🖱️ 已拒绝成员 ${shortId(pendingFrom)} 的控制申请`);
  auditPush('拒绝申请', `来自 ${shortId(pendingFrom)}（手动拒绝）`);
  remoteAskBox.classList.add('hidden');
  pendingFrom = null;
});

// ★ 升级 A6：「不再允许 TA」——拒绝这一次，并且以后都自动拒绝
remoteBlockBtn.addEventListener('click', () => {
  if (!pendingFrom) return;
  const requester = pendingFrom;
  blockedPeers.add(requester); // 本地黑名单（Set）
  socket.emit('remote-answer', { to: requester, ok: false, reason: 'blocked' });
  remoteAskBox.classList.add('hidden');
  pendingFrom = null;
  log(`🚫 已把成员 ${shortId(requester)} 加入黑名单，之后 TA 的控制申请会被自动拒绝`);
  auditPush('拉黑成员', `${shortId(requester)} 加入黑名单`);
  showToast(`🚫 已不再允许成员 ${shortId(requester)} 控制你的屏幕`, 'info');
});

// 控制端视角：收到服务器/被控端回执 → ok / busy / not-sharing / 拒绝 四种结果
socket.on('remote-answer', ({ from, ok, reason }) => {
  if (ok) {
    log(`🎉 成员 ${shortId(from)} 已允许你控制！等待控制通道开通...`);
    showToast(`✅ 成员 ${shortId(from)} 已允许你控制他的屏幕`);
    // ★ H5 远程桌面（Phase 3）：授权成功 → 进入"控制模式"。
    //   ctrl 通道由被控端建，我这边等 ondatachannel 收到并 open 后才开始采集
    //   （enterControlMode 内部会显示"等待通道开通"提示，见第 17 步）。
    enterControlMode(from);
  } else if (reason === 'busy') {
    log('❌ 对方正在被其他人控制中（busy），请稍后再试');
    showToast('❌ 对方正在被其他人控制中，暂时无法控制', 'error');
  } else if (reason === 'not-sharing') {
    log('❌ 对方未开启远程协助（需要对方正在共享屏幕并打开允许开关）');
    showToast('❌ 对方未开启远程协助，无法请求控制', 'error');
  } else if (reason === 'blocked') {
    // ★ 升级 A6：被控端把你拉黑了（或把你的申请拉黑了）——文案要和"手动拒绝"区分开，
    //   否则用户会以为"再求一次就能过"，反复申请骚扰对方。
    log('🚫 对方已设置不再允许你控制（黑名单），请勿反复申请');
    showToast('🚫 对方已设置不再允许你控制他的屏幕', 'error');
  } else {
    log(`❌ 成员 ${shortId(from)} 拒绝了你的控制请求`);
    showToast(`❌ 成员 ${shortId(from)} 拒绝了你的控制请求`, 'error');
  }
});

// 全房间视角：服务器广播"现在谁在控制谁" → 更新状态（角标 + 双方 UI 联动）
//   hostId       = 被控端（屏幕被控制的人）
//   controllerId = 控制端；null = 当前没人被控制
// ★ Phase 5：这条广播是"权威状态"——不管哪条路径开始/结束了控制，
//   三端（被控/控制/旁观）都以它为准复位 UI，幂等执行（重复到达也不会乱）。
socket.on('remote-state', ({ hostId, controllerId, expiresAt }) => {
  // 先清掉所有视频框上的"控制中/被控中"角标（重建式更新，最不容易漏）
  Object.values(peers).forEach((p) => p.box.classList.remove('rc-host', 'rc-ctrl'));
  // ★ 成员列表：记下"谁控谁"，列表里给这两行加角色角标（数据同源，不额外发信令）
  rcStateIds = { hostId: hostId || null, controllerId: controllerId || null };
  renderMemberList();

  if (hostId && controllerId) {
    if (peers[hostId]) peers[hostId].box.classList.add('rc-host');       // 角标：被控中
    if (peers[controllerId]) peers[controllerId].box.classList.add('rc-ctrl'); // 角标：控制中
    log(`🖱️ 成员 ${shortId(controllerId)} 正在控制成员 ${shortId(hostId)} 的屏幕`);

    // ★ 升级 A6：限时授权倒计时。服务器把**绝对到期时刻** expiresAt 广播过来，
    //   两端各自和本机时钟比一比就能画出剩余秒数（不用每秒问服务器）。
    //   不限时时 expiresAt 为 null → 不显示倒计时。
    startCtlCountdown(expiresAt);

    // 我是被控端 → 工作台状态条显示"谁在控我" + 点亮「收回控制」
    if (hostId === socket.id) {
      setWbStatus(`🖱️ 成员 ${shortId(controllerId)} 正在控制你的工作台`);
      wbReclaimBtn.classList.remove('hidden');
    }
    // 我是控制端 → 幂等进入控制模式（通常 remote-answer ok 已先进过了）
    if (controllerId === socket.id && rcRole !== 'controller') {
      enterControlMode(hostId);
    }
  } else {
    log('🖱️ 远程控制已结束（当前无人被控制）');
    // ★ A6：授权结束 → 倒计时立刻停（谁结束的都要停：手动释放 / 到点自动 / 掉线）
    stopCtlCountdown();
    // 我是控制端 → 退出控制模式（release 由发起方发过就不重复发信令）
    if (rcRole === 'controller') exitControlMode(false);
    // 我是被控端 → 复位被控状态（工作台保持开着，等下一次请求）
    if (rcRole === 'host') endHostControl();
  }
});

/* ════════════════════════════════════════════════════════════════
 * H5 远程桌面 · Phase 2~5：控制通道 + 控制端采集 + 被控端重放
 *
 * ▎三段各自的职责（对应 H5远程桌面-规划.md 第 5 节改动点地图）：
 *   第 5.6 步 —— ctrl_ DataChannel 的建立与收发（Phase 2）
 *   第 17 步  —— 控制端：捕获输入 → 归一化 → 节流 → 发送（Phase 3）
 *   第 18 步  —— 被控端：工作台挂载 + 事件重放 + 远程光标（Phase 4）
 *   清理矩阵  —— 全路径收尾（Phase 5，坑 #8）
 * ════════════════════════════════════════════════════════════════ */

/* ──────────────────────────────────────────────────────────────
 * 第 5.6 步：⭐ ctrl_ DataChannel —— 远程控制通道（Phase 2）
 *
 * ▎谁建通道？被控端（授权方）允许之后由**被控端**建（坑 #1）：
 *   "只有我同意才有通道"——授权方握有主动权，天然表达授权语义；
 *   控制端只坐在 pc.ondatachannel 前收（见回调 4 的 ctrl 分支）。
 *   对比聊天通道"新人建/老人收"：同一条 P2P 连接上两条通道各走各的，
 *   SCTP（DataChannel 的底层）本来就是"多流复用"的——面试可讲。
 *
 * ▎通道消息协议（A5① 升级后是"JSON + 二进制"混帧，详见规划 4.3 + 升级菜单 A5）：
 *   【JSON 字符串帧】（低频 / 带字符串字段的命令——字符串塞不进 16 字节定长帧）
 *   { type:'ping' } / { type:'pong' }        通道自检（open 后互发一轮）
 *   { type:'input', kind:'keydown'|'keyup' } 键盘事件（key/code 是字符串）
 *   { type:'input', kind:'input-text', text } A2 中文 IME：组合输入结束后的整段文本
 *                                            （kind 名沿用规划 4.3 的预留位）
 *   { type:'release' }                       控制端主动释放（P2P 快速路径；
 *                                            信令 remote-release 是权威路径，双保险）
 *   { type:'clipboard', text, dir }          ★ A3 剪贴板同步（dir 区分方向，见第 19 步）
 *   { type:'clipboard-pull' }                ★ A3 控制端 Ctrl+C 时向被控端"要"当前选区
 *   { type:'file-offer'|'file-accept'|'file-end', ... } ★ A4 文件传输握手（见第 21 步）
 *   【二进制 ArrayBuffer 帧】（A5①：高频的鼠标/滚轮命令；A4 加了文件分片）
 *   鼠标/滚轮 = 16 字节定长帧；文件分片 = 首字节 0xFE 的变长帧（魔数分流）
 *   鼠标移动 ~60次/秒是控制流量的绝对大头，JSON 一条约 100 字节、二进制只要 16 字节；
 *   布局：[0]kind [1]flags(修饰键+鼠标键) [2..3]预留 [4..7]x(F32) [8..11]y(F32) [12..15]wheel(I32)
 *   接收端靠 e.data 的类型分流：typeof === 'string' 走 JSON，ArrayBuffer 走解码器。
 * ────────────────────────────────────────────────────────────── */

// 被控端：授权后调用 —— 在"我与控制端"的那条连接上建 ctrl 通道
function openCtrlChannel(controllerId) {
  if (ctrlChannels[controllerId]) return; // 幂等：这条连接上已有 ctrl 通道
  const peer = peers[controllerId];
  if (!peer) { log('❌ 找不到与该成员的连接，无法建立控制通道'); return; }
  const ch = peer.pc.createDataChannel('ctrl_' + Math.random().toString(36).slice(2, 6));
  ctrlChannels[controllerId] = ch;
  watchCtrlChannel(ch, controllerId, 'host');
  log(`🖱️ 已为成员 ${shortId(controllerId)} 创建远程控制通道（ctrl_），等待开通...`);
}

// ctrl 通道的统一监听：role 标明我在这条通道上的角色
//   'host'       = 被控端：收 input 重放、回 pong、处理对端 release
//   'controller' = 控制端：收 pong（确认链路就绪后开始采输入）
function watchCtrlChannel(ch, remoteId, role) {
  // ★ A5① 新坑预防：DataChannel 的 binaryType 默认是 'blob'——
  //   不设的话二进制帧到达时 e.data 是 Blob，没法直接读字节。
  //   必须在收发前改成 'arraybuffer'，onmessage 才拿到 ArrayBuffer。
  ch.binaryType = 'arraybuffer';
  ch.onopen = () => {
    log(`✅ 远程控制通道已开通（与成员 ${shortId(remoteId)}）`);
    ctrlSend(remoteId, { type: 'ping' }); // 开通即自检：让对端知道我这边就绪
  };
  ch.onmessage = (e) => {
    // ★ A5① 混帧分流：字符串 = JSON 命令（键盘/文本/自检/释放），
    //   ArrayBuffer = 二进制帧。
    // ★ A4 起二进制帧又分两种，靠"首字节"再分一次：
    //     首字节 0xFE  = 文件分片（A4 新增：8 字节帧头 + 数据）
    //     其余（3~7）  = 鼠标/滚轮 16 字节控制帧（A5 原有）
    //   ▎为什么看首字节而不是看长度？控制帧的 kind 编号只用了 3~7，
    //     0xFE 永远不会出现在控制帧里 —— 这叫"魔数（magic number）分流"，
    //     是二进制协议的常规做法（PNG 文件头、TCP/IP 协议号都是这个套路）。
    if (typeof e.data !== 'string') {
      try {
        const head = new DataView(e.data).getUint8(0);
        if (head === FILE_MAGIC) { handleFileChunk(e.data); return; } // ★ A4
        replayRemoteInput(decodeCtlFrame(e.data)); // 一条坏帧不炸整条通道
      } catch (err) { console.warn('解码二进制帧失败:', err); }
      return;
    }
    let msg = null;
    try { msg = JSON.parse(e.data); } catch (err) { return; } // 非 JSON 的坏包直接丢弃
    if (msg.type === 'ping') {
      ctrlSend(remoteId, { type: 'pong' });
      log('✅ 收到对端 ping，已回 pong —— 控制链路双向就绪');
    } else if (msg.type === 'pong') {
      log('✅ 收到对端 pong —— 控制链路双向就绪');
      if (role === 'controller') markCtrlReady(); // 控制端：链路确认后才激活采集
    } else if (msg.type === 'input' && role === 'host') {
      // 重放包 try/catch：一条坏消息（字段缺失/坐标异常）不能炸掉整条控制通道
      try { replayRemoteInput(msg); }
      catch (err) { console.warn('重放控制事件失败:', err); }
    } else if (msg.type === 'clipboard') {
      // ★ 升级 A3：剪贴板同步（两向共用一种消息，靠 dir 区分方向，见第 19 步）
      handleClipboardMsg(msg, role);
    } else if (msg.type === 'clipboard-pull' && role === 'host') {
      // ★ 升级 A3 兜底路径：控制端按了 Ctrl+C 但本地读不到选区
      //   → 向被控端"要"一次它工作台里的当前选区（方向 host→ctl）
      sendHostSelection();
    } else if (msg.type === 'file-offer' && role === 'host') {
      onFileOffer(msg);      // ★ 升级 A4：有人要发文件 → 弹接受/拒绝
    } else if (msg.type === 'file-accept' && role === 'controller') {
      onFileAccept(msg);     // ★ 升级 A4：被控端接受了 → 开始分块发送
    } else if (msg.type === 'file-end' && role === 'host') {
      finishFileRecv(msg);   // ★ 升级 A4：分片收齐 → 拼成 Blob → 给下载链接
    } else if (msg.type === 'release') {
      log('🖱️ 对端已结束远程控制');
      if (role === 'host') endHostControl(); // 快速路径；信令 remote-state 随后到，幂等
    }
  };
  ch.onclose = () => {
    log(`🔌 与成员 ${shortId(remoteId)} 的控制通道已关闭`);
    if (ctrlChannels[remoteId] === ch) delete ctrlChannels[remoteId];
    // 通道断 = 控制必然中断（对端离开/连接断）：按角色收尾，幂等
    if (role === 'host' && rcRole === 'host' && rcPeerId === remoteId) endHostControl();
    if (role === 'controller' && rcRole === 'controller' && rcPeerId === remoteId) {
      exitControlMode(false);
    }
  };
}

// ctrl 通道发送统一入口：readyState 不是 open 就不发（坑 #3，沿用聊天铁律）
function ctrlSend(remoteId, obj) {
  const ch = ctrlChannels[remoteId];
  if (ch && ch.readyState === 'open') {
    ch.send(JSON.stringify(obj));
    return true;
  }
  return false;
}

/* ──────────────────────────────────────────────────────────────
 * ★ A5①：16 字节二进制帧编解码器（控制质量工程化第一刀）
 *
 * ▎为什么要二进制化？算一笔账（面试可讲）：
 *   鼠标移动是控制流量的绝对大头（人手划一圈 = 几十条 move）。
 *   JSON：{"type":"input","kind":"mousemove","x":0.5324,"y":0.1841} ≈ 60~100 字节；
 *   二进制定长帧：固定 16 字节 → **省 80%+ 带宽**。延迟敏感的实时通道里，
 *   "每个字节都是时间"——SCTP 传输的是字节流，JSON 的花括号引号全是纯开销。
 *
 * ▎帧布局（16 字节，教学生用的"填表"记忆法）：
 *   [0]      kind     Uint8  3=mousemove 4=mousedown 5=mouseup 6=dblclick 7=wheel
 *   [1]      flags    Uint8  bit0=Alt bit1=Ctrl bit2=Shift bit3=Meta bit4~5=鼠标键号
 *   [2..3]   预留     Uint16 对齐用（真实协议常留"版本号/扩展位"，面试可讲）
 *   [4..7]   x        Float32 归一化坐标（0~1，Float32 约 7 位有效数字，
 *                     对 4096px 宽的屏幕误差 <0.001px，教学场景绰绰有余）
 *   [8..11]  y        Float32
 *   [12..15] wheel    Int32  滚轮增量（其他事件填 0）
 *
 * ▎为什么键盘/文本不走二进制？
 *   键盘的 key/code 是字符串（"ArrowLeft"12 字节就爆了），
 *   要塞进定长帧得建"键码 ↔ 数字"对照表（VNC 的 keysym 就是这套）——
 *   键盘频率低、收益小、复杂度高，**取舍后留 JSON**。这本身就是 A5 要讲的
 *   "实时通道的带宽/延迟取舍"，不是偷懒。
 * ────────────────────────────────────────────────────────────── */

// kind 字符串 ↔ 帧内编号（编号即字节值，0~2 留给 JSON 侧的 ping/pong/release）
const CTL_KIND_TO_ID = { mousemove: 3, mousedown: 4, mouseup: 5, dblclick: 6, wheel: 7 };
const CTL_KIND_FROM_ID = ['', '', '', 'mousemove', 'mousedown', 'mouseup', 'dblclick', 'wheel'];

// 积压告警的节流阀：3 秒最多提醒一次，别让告警本身刷屏
let backlogWarnAt = 0;

// 编码：把一次鼠标/滚轮输入打包成 16 字节帧（e 只取修饰键，btn 可选）
function encodeCtlFrame(kind, x, y, wheel, e, btn) {
  const buf = new ArrayBuffer(16);
  const v = new DataView(buf); // DataView = 按"偏移+类型"读写字节的工具（教学：像内存填表）
  v.setUint8(0, CTL_KIND_TO_ID[kind] || 0);
  let flags = 0;
  if (e) {
    if (e.altKey) flags |= 1;
    if (e.ctrlKey) flags |= 2;
    if (e.shiftKey) flags |= 4;
    if (e.metaKey) flags |= 8;
  }
  if (typeof btn === 'number') flags |= (btn & 3) << 4; // 鼠标键号放 bit4~5
  v.setUint8(1, flags);
  v.setUint16(2, 0);        // 预留字段清零
  v.setFloat32(4, x);
  v.setFloat32(8, y);
  v.setInt32(12, wheel | 0);
  return buf;
}

// 解码：16 字节帧 → 和 JSON 消息同构的对象（补上 type:'input'），
// 这样被控端的重放入口 replayRemoteInput 对两种来源一视同仁。
function decodeCtlFrame(buf) {
  if (!buf || buf.byteLength !== 16) throw new Error('帧长度不是 16 字节');
  const v = new DataView(buf);
  const flags = v.getUint8(1);
  return {
    type: 'input',
    kind: CTL_KIND_FROM_ID[v.getUint8(0)] || 'mousemove',
    x: v.getFloat32(4),
    y: v.getFloat32(8),
    wheel: v.getInt32(12),
    btn: (flags >> 4) & 3,
    altKey: !!(flags & 1), ctrlKey: !!(flags & 2),
    shiftKey: !!(flags & 4), metaKey: !!(flags & 8),
  };
}

/* ──────────────────────────────────────────────────────────────
 * 第 17 步：⭐ 控制端 —— 捕获输入 → 归一化 → 节流 → 发送（Phase 3）
 *
 * ▎控制模式是什么？被允许后，在被控端的视频框上盖一层透明"控制层"：
 *   B 的鼠标在"看到 A 画面"的位置上操作，事件从控制层捕获，
 *   换算成归一化坐标发给 A——A 在自己屏幕的同一个相对位置重放。
 *
 * ▎⭐ 坐标归一化（面试考点）：
 *   两端窗口大小不同，绝不能传像素。基准取"视频画面内容实际显示的矩形"：
 *   视频用 object-fit: cover 显示（放大铺满、超出裁剪），所以
 *   "元素框 ≠ 画面内容"，要先算出内容矩形（getVideoDrawRect），
 *   再在内容矩形里把鼠标位置归一化成 0~1；A 端 × 自己视口尺寸还原。
 * ────────────────────────────────────────────────────────────── */

// 进入控制模式（幂等）：盖控制层 + 挂事件采集
function enterControlMode(hostId) {
  if (rcRole === 'controller' && rcPeerId === hostId) return; // 已在控制他，防重入
  const peer = peers[hostId];
  if (!peer) { log('❌ 找不到被控端的视频框，无法进入控制模式'); return; }
  if (rcRole === 'controller' && rcPeerId !== hostId) exitControlMode(false); // 换人先清

  rcRole = 'controller';
  rcPeerId = hostId;
  ctrlReady = false; // 通道 open + pong 之前不采输入（坑 #3）

  // 动态造控制层（覆盖整个视频框），顶部一条状态提示 + 工具条 + 释放按钮
  //   ★ 升级 A3/A4/A6：工具条里多了三件套——📸 截图（A4）、📁 发文件（A4）、
  //     📋 复制选区（A3），以及限时授权的倒计时（A6，由 remote-state 广播驱动）。
  const layer = document.createElement('div');
  layer.className = 'ctrl-layer';
  layer.innerHTML =
    `<div class="ctrl-tip">` +
    `<span class="ctl-status">⏳ 正在接通控制通道…</span>` +
    `<span class="ctl-expire hidden">⏳ --</span>` +
    `<span class="ctl-tools">` +
    `<button class="ctl-shot btn" title="把被控端当前画面截图保存到本机">📸 截图</button>` +
    `<button class="ctl-file btn" title="通过控制通道把文件传给被控端">📁 发文件</button>` +
    `<button class="ctl-pull btn" title="读取对方工作台里的选中文本（等同 Ctrl+C）">📋 复制选区</button>` +
    `</span>` +
    `<button class="ctl-release btn danger">释放控制（Esc）</button></div>`;
  peer.box.appendChild(layer);
  peer.box.classList.add('rc-controlling');
  layer.querySelector('.ctl-release').addEventListener('click', () => exitControlMode(true));
  layer.querySelector('.ctl-shot').addEventListener('click', () => ctlScreenshot());     // ★ A4
  layer.querySelector('.ctl-file').addEventListener('click', () => ctlPickFile());       // ★ A4
  layer.querySelector('.ctl-pull').addEventListener('click', () => controllerCopySelection()); // ★ A3
  // ★ 升级 A3/A4 的"焦点保卫战"：工具条按钮是**可聚焦元素**，点一下焦点就从
  //   IME 捕获框跑到按钮上了——之后打字（尤其是中文组合输入）就没了靶子。
  //   在 mousedown 上 preventDefault 可以"阻止焦点转移但照常触发 click"，
  //   一行解决（真实远程桌面客户端里也常见这招）。
  layer.querySelector('.ctl-tools').addEventListener('mousedown', (e) => e.preventDefault());

  // --- 鼠标/滚轮采集（挂在控制层上）---
  //   ★ A7：触屏和鼠标共用同一套 Pointer Events（统一输入模型），
  //     所以下面这几个处理器**同时**服务鼠标和手指；触摸特有的长按=右键、
  //     双指=滚轮，实现见第 22 步（处理器统一，语义分叉，这正是 A7 要讲的点）。
  layer.addEventListener('pointermove', onCtlPointerMove); // 高频 → rAF 节流（坑 #6）
  layer.addEventListener('pointerdown', onCtlPointerDown);
  layer.addEventListener('pointerup', onCtlPointerUp);
  layer.addEventListener('pointercancel', onCtlPointerUp); // 手势被系统抢走时也要收尾
  layer.addEventListener('dblclick', onCtlDblClick);
  layer.addEventListener('contextmenu', onCtlContextMenu); // 右键转发而非弹菜单
  layer.addEventListener('wheel', onCtlWheel, { passive: false });  // 高频 → 合并发送

  // --- 键盘采集（挂 document：div 默认收不到键盘）---
  //   只在控制中转发，且焦点在自己页面的输入框里时不转发——
  //   否则我在自己聊天框打字会"串"到对方屏幕上。
  document.addEventListener('keydown', onCtlKeyDown);
  document.addEventListener('keyup', onCtlKeyUp);

  // --- A2：IME 捕获框（中文输入法的关键拼图）---
  // ▎为什么需要它？中文输入法打字时 keydown 只给你 key='Process'（keyCode 229），
  //   真正的中文在**组合输入**（composition）里，而组合输入必须发生在"可编辑元素"
  //   上才触发——控制层是个普通 div，IME 在它身上组合不起来。
  // ▎解法（真实远程桌面同款，如 noVNC）：造一个看不见的 <textarea> 挂在页面里，
  //   控制期间把焦点钉在它身上：
  //     · 英文/数字直打 → 走原有 keydown 转发（textarea 只当焦点靶子，不存字）；
  //     · 中文组合输入 → compositionstart~end 发生在它身上，
  //       compositionend 的 e.data 就是"最终中文整段"，一条 text 消息发给被控端。
  //   看不见但存在：1×1 像素 + 全透明 + 固定在左上角（样式 .ctl-ime-capture）。
  imeCapture = document.createElement('textarea');
  imeCapture.className = 'ctl-ime-capture';
  imeCapture.setAttribute('aria-hidden', 'true'); // 对读屏软件隐藏（纯输入靶子）
  document.body.appendChild(imeCapture);
  imeCapture.addEventListener('compositionstart', () => { composing = true; });
  imeCapture.addEventListener('compositionend', (e) => {
    composing = false;
    const text = e.data || '';       // e.data = 本次组合输入的最终文本（可能是整句中文）
    imeCapture.value = '';           // 清空靶子，下一次组合从头开始
    if (text) sendCtlText(text);     // ★ 整段发出（A2 协议核心：不逐键、按句发）
  });
  // 非 IME 的普通打字不让 textarea 积字（字符统一由 keydown 转发通道负责）
  imeCapture.addEventListener('input', () => { if (!composing) imeCapture.value = ''; });
  // ★ 升级 A3 兜底：万一某个浏览器的 keydown preventDefault 没拦住粘贴，
  //   paste 事件照样会派发 —— 那就从事件对象里取剪贴板文本，走同一条同步路径。
  //   （两层保险：keydown 拦截 + paste 事件兜底，真实产品也这么写。）
  imeCapture.addEventListener('paste', (e) => {
    const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (!text) return;
    e.preventDefault();
    if (Date.now() - lastClipboardPasteAt < 500) return; // 同一次 Ctrl+V 已由 keydown 处理过
    lastClipboardPasteAt = Date.now();
    log(`📋 检测到粘贴操作，改为把内容同步给被控端（${text.length} 字）`);
    sendClipboardToHost(text);
  });
  imeCapture.focus(); // 把焦点钉到捕获框：之后敲键盘（含 IME）都落在这里
  log(`🖱️ 已进入对成员 ${shortId(hostId)} 的控制模式（等待通道开通...）`);
}

// 链路确认（收到 pong）：把提示从"接通中"换成"正在控制"，并开始采集
function markCtrlReady() {
  if (ctrlReady || rcRole !== 'controller') return;
  ctrlReady = true;
  const tip = document.querySelector('.ctrl-layer .ctl-status');
  if (tip) tip.textContent = `🖱️ 正在控制 成员 ${shortId(rcPeerId)}`;
  log('🎮 控制模式已激活：移动/点击/滚轮/打字将实时作用于对方工作台');
}

// pointermove 节流：每帧只发"最新位置"（丢中间帧、保实时，规划 5.4）
// ★ A2：IME 捕获框（控制期间存在，退出时移除）+ 组合输入进行中标记
let imeCapture = null; // 隐藏 textarea：给 IME 一个"可编辑焦点"当输入靶子
let composing = false; // true = 中文组合输入中（候选键不能转发给对方）

// ★ A5② 自适应节流：按 getStats 测到的 RTT 决定"每几帧发一次 move"。
//   RTT 小（<80ms）→ 每帧都发（≈60fps 跟手）；RTT 中 → 隔帧（≈30fps）；
//   RTT 大（>200ms）→ 每 4 帧一条（≈15fps）。弱网下发送方主动放慢，
//   别让过时的位置挤占本就拥挤的管道——这是"发送端拥塞控制"的最小模型。
//   数据源：第 16 步 monitorNetwork 每 3 秒更新 netRttMs。
let moveFrameTick = 0; // rAF 帧计数器（跳帧按它取模）
function ctlMoveSkip() {
  if (netRttMs == null) return 1;      // 还没测到 RTT：按最快发（首个 RTT 到了再调）
  if (netRttMs < 80) return 1;
  if (netRttMs < 200) return 2;
  return 4;
}

let pendingMove = null; // 最新一次 move 事件（旧的被覆盖 = 丢帧）
let moveRafId = 0;
function onCtlPointerMove(e) {
  // ★ 升级 A7：触屏的两指滑动要当"滚轮"用，绝不能当成移动——
  //   所以先问一句"这一动是不是双指滚动"（第 22 步实现），是就交给它处理。
  if (ctlTouchScroll(e)) return;
  pendingMove = e;
  if (!moveRafId) {
    moveRafId = requestAnimationFrame(() => {
      moveRafId = 0;
      moveFrameTick++;
      // 无论本帧发不发，pendingMove 都清空——"只留最新"是节流的灵魂：
      // 鼠标位置只关心"现在在哪"，中间轨迹丢了无影响。
      const pm = pendingMove;
      pendingMove = null;
      if (pm && moveFrameTick % ctlMoveSkip() === 0) {
        sendCtlInput('mousemove', pm, {});
      }
    });
  }
}

/* ★ 升级 A7：鼠标/触屏统一的按下与抬起处理
 * ▎鼠标：按下就发 mousedown，抬起就发 mouseup（点一下 = 一对事件），语义直白。
 * ▎触屏：没有"悬停"也没有"右键"，浏览器的 pointerdown 在手指落下瞬间就触发，
 *   如果照鼠标那样立刻发 mousedown，用户长按时会先点出一次左键（误操作）。
 *   所以触屏走"抬起才算一次点击"的移动端惯例：
 *     短按（<500ms 抬起）→ 补发 mousedown + mouseup（一次左键点击）
 *     长按 500ms         → 发 mousedown + mouseup（btn=2）＝右键
 *   细节见第 22 步。 */
function onCtlPointerDown(e) {
  if (e.pointerType === 'touch') { ctlTouchDown(e); return; }
  e.preventDefault();
  sendCtlInput('mousedown', e, { btn: e.button });       // 0左 / 1中 / 2右
}
function onCtlPointerUp(e) {
  if (e.pointerType === 'touch') { ctlTouchUp(e); return; }
  sendCtlInput('mouseup', e, { btn: e.button });
}
function onCtlDblClick(e) { sendCtlInput('dblclick', e, {}); }
function onCtlContextMenu(e) { e.preventDefault(); } // 右键转发而非弹菜单

// 滚轮合并：60ms 内的滚动增量合成一条消息（wheel 事件比 move 还密，且要"量"有意义）
let wheelAccum = 0;
let wheelTimer = null;
let lastWheelEvent = null;
function onCtlWheel(e) {
  e.preventDefault();
  wheelAccum += e.deltaY;
  lastWheelEvent = e; // 只留最新一条的位置
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => {
    if (lastWheelEvent) sendCtlInput('wheel', lastWheelEvent, { wheel: Math.round(wheelAccum) });
    wheelAccum = 0;
    lastWheelEvent = null;
  }, 60);
}

function onCtlKeyDown(e) {
  if (rcRole !== 'controller') return;
  const t = e.target;
  // A2：IME 捕获框虽然也是 textarea，但它是"发给对方"的入口，必须放行；
  // 其余自己页面的输入框（聊天框等）照旧不转发。
  if (t && t !== imeCapture &&
      (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  // A2 两道 IME 闸门：
  //   ① 组合输入进行中：Backspace/Enter/空格 都是"选候选字"的按键，
  //      转发过去会让对方屏幕乱删字/换行——一律扣下；
  //   ② key='Process'（keyCode 229）：IME 吞掉原始键后发的占位键，转发无意义。
  if (composing) return;
  if (e.key === 'Process' || e.keyCode === 229) return;
  if (e.key === 'Escape') { exitControlMode(true); return; } // Esc = 快捷释放（组合中除外）
  // ★ 升级 A3：Ctrl 组合键的特殊处理（放在 IME 闸门之后、普通转发之前）
  //   ▎为什么 Ctrl+V 不能当普通按键转发？
  //     控制端按 Ctrl+V，想粘贴的是**控制端本机**的剪贴板内容；
  //     但被控端那边执行粘贴时，读的是**被控端自己**的剪贴板——两台机器两个剪贴板，
  //     转发一个"V 键"过去只会让对方粘出它自己的东西，与用户预期完全不符。
  //     真实远程桌面（RDP/VNC）的做法叫「剪贴板重定向」：本机读内容 → 过网络 →
  //     对端按内容写入。所以这里把 Ctrl+V 截下来，改走剪贴板同步协议（第 19 步）。
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    if (e.code === 'KeyV') {
      e.preventDefault();
      // 防抖：keydown 拦截 + paste 事件兜底是**两条路**，个别浏览器会两条都触发，
      // 500ms 内只处理一次，免得同一段文字被粘贴两遍（"双保险"也要防重复）。
      if (Date.now() - lastClipboardPasteAt > 500) {
        lastClipboardPasteAt = Date.now();
        pasteFromLocalClipboard();
      }
      return;
    }
    if (e.code === 'KeyC') { e.preventDefault(); controllerCopySelection(); return; }
  }
  sendCtlKey('keydown', e);
}
function onCtlKeyUp(e) {
  if (rcRole !== 'controller') return;
  const t = e.target;
  if (t && t !== imeCapture &&
      (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (composing || e.key === 'Process' || e.keyCode === 229) return; // 同 keydown 的 IME 闸门
  // ★ 升级 A3：Ctrl+V / Ctrl+C 的 keydown 已被拦（当剪贴板同步处理），
  //   对应的 keyup 也不能补发过去，否则对端的按键状态会"多一次抬起"。
  if ((e.ctrlKey || e.metaKey) && !e.altKey &&
      (e.code === 'KeyV' || e.code === 'KeyC')) return;
  sendCtlKey('keyup', e);
}

// 键盘消息：key 是"字符"（a、Enter、Shift…），code 是"物理键位"（KeyA…），都带上
function sendCtlKey(type, e) {
  if (!ctrlReady) return;
  const ch = ctrlChannels[rcPeerId];
  if (!ch || ch.readyState !== 'open') return;
  ch.send(JSON.stringify({
    type: 'input', kind: type,
    key: e.key, code: e.code,
    altKey: e.altKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, metaKey: e.metaKey,
  }));
}

// ★ A2：整段文本消息（中文 IME 的协议形态）——
//   不逐键发、按"组合输入的最终结果"发。对方 execCommand 一次插入整段。
//   为什么这样设计？组合输入过程中（选拼音、翻候选页）按键语义已经乱掉，
//   只有 compositionend 里的 e.data 才是用户真正想要的字。
function sendCtlText(text) {
  if (!ctrlReady || !text) return;
  if (ctrlSend(rcPeerId, { type: 'input', kind: 'input-text', text })) {
    log(`⌨️ 已发送文本（${text.length} 字）到对方工作台`);
  }
}

// 把一个真实事件转成 16 字节二进制帧发出（坐标在"画面内容矩形"内归一化到 0~1）
// ★ A5①：鼠标/滚轮从 JSON 换成定长二进制帧（~100B → 16B）；
// ★ A5③：发送前看一眼通道积压（bufferedAmount）——弱网下 SCTP 发不出去
//   会在本地缓冲区排队，再无脑发只会越积越陈旧。策略：move 这类
//   "过时就没价值"的消息直接丢弃；点击/滚轮不丢（操作完整性优先）。
function sendCtlInput(kind, e, extra) {
  if (!ctrlReady) return;                       // 通道没就绪不采（坑 #3）
  const ch = ctrlChannels[rcPeerId];
  if (!ch || ch.readyState !== 'open') return;  // 再验一次：open 才能 send
  const peer = peers[rcPeerId];
  if (!peer) return;
  const rect = getVideoDrawRect(peer.video);
  const x = clamp01((e.clientX - rect.left) / rect.width);
  const y = clamp01((e.clientY - rect.top) / rect.height);
  // A5③ 积压监控：超过 64KB（≈4000 条 move）说明网络明显跟不上，
  //   丢掉这条 move，并且 3 秒最多告警一次（别让告警刷屏日志）。
  if (kind === 'mousemove' && ch.bufferedAmount > 64 * 1024) {
    if (Date.now() - backlogWarnAt > 3000) {
      backlogWarnAt = Date.now();
      log('⚠️ 控制通道积压，已丢弃部分鼠标移动（网络较慢）');
    }
    return;
  }
  ch.send(encodeCtlFrame(kind, x, y, (extra && extra.wheel) || 0, e, extra && extra.btn));
}

// 算"视频画面内容实际画在元素的哪个矩形"（object-fit: cover 的裁剪修正，见步首注释）
function getVideoDrawRect(video) {
  const elRect = video.getBoundingClientRect();
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return elRect; // 还没拿到视频尺寸 → 退化为整个元素框
  const scale = Math.max(elRect.width / vw, elRect.height / vh); // cover：放大到铺满
  const drawW = vw * scale, drawH = vh * scale;
  return {
    left: elRect.left + (elRect.width - drawW) / 2,   // 超出部分左右/上下对称裁掉
    top: elRect.top + (elRect.height - drawH) / 2,
    width: drawW,
    height: drawH,
  };
}

// 把数值夹在 0~1 区间（归一化坐标的边界保护：裁剪区外的点击贴到画面边缘）
function clamp01(v) { return Math.min(1, Math.max(0, v)); }

// 退出控制模式。sendRelease=true：主动释放 → P2P release 消息 + 信令 remote-release
function exitControlMode(sendRelease) {
  const peerId = rcPeerId;
  if (sendRelease && peerId) {
    ctrlSend(peerId, { type: 'release' }); // P2P 快速通知（低延迟）
    socket.emit('remote-release');         // 信令权威通知（服务器清表 + 全房广播）
  }
  // 摘掉采集监听（引用必须和挂载时是同一个函数引用，所以都用具名函数）
  document.removeEventListener('keydown', onCtlKeyDown);
  document.removeEventListener('keyup', onCtlKeyUp);
  // A2 清理：移除 IME 捕获框（控制结束就不该再截键盘焦点了）
  if (imeCapture) { imeCapture.remove(); imeCapture = null; }
  composing = false;
  clearTimeout(wheelTimer);
  wheelAccum = 0; lastWheelEvent = null; pendingMove = null;
  if (moveRafId) { cancelAnimationFrame(moveRafId); moveRafId = 0; }
  document.querySelectorAll('.ctrl-layer').forEach((el) => el.remove()); // 撤控制层
  if (peerId && peers[peerId]) peers[peerId].box.classList.remove('rc-controlling');
  // ★ A7 清理：触屏长按定时器 / 双指滑动状态（不清会留下"僵尸长按"：手指早抬了却还发右键）
  ctlTouchReset();
  // ★ A6 清理：停掉倒计时（控制都结束了，倒计时不该继续跑）
  stopCtlCountdown();
  // ★ A4 清理：传输中被打断（对方收权/掉线）就把本地进度复位——
  //   文件流没有"断点续传"，一次传不完就整份作废，别留下半截进度条骗人。
  abortFileSend();
  rcRole = null; rcPeerId = null; ctrlReady = false;
  if (sendRelease) log('🖱️ 已释放控制');
}

/* ──────────────────────────────────────────────────────────────
 * 第 18 步：⭐ 被控端 —— 工作台 + 事件重放（Phase 4 · 本功能核心）
 *
 * ▎"重放"是什么？控制端发来的归一化输入，在 A 端还原成坐标后，
 *   用 new PointerEvent/KeyboardEvent + dispatchEvent 合成一份"假事件"
 *   扔给工作台 iframe 里的元素——监听器不知道也不关心事件是真是假
 *   （isTrusted=false 只影响"浏览器默认行为"，不影响 JS 监听器）。
 *
 * ▎三个关键手段（每个都对应一个坑）：
 *   ① 重放范围锁死 iframe 内（坑 #7）：会议 UI 绝不能被遥控；
 *   ② 合成 mousedown 不聚焦 → 命中文本框时手动 focus()（坑 #12）；
 *   ③ 合成按键不插字 → execCommand 代插（坑 #4，见 replayKey）。
 * ────────────────────────────────────────────────────────────── */

// 「允许远程协助」开关（共享中才出现，见第 5.5 步共享代码）
assistBtn.addEventListener('click', () => {
  if (assistOn) { turnOffAssist(); return; }      // 再点一次 = 关闭
  if (!sharingScreen) {
    showToast('请先共享屏幕，再开启远程协助', 'info');
    return;
  }
  assistOn = true;
  assistBtn.classList.add('on');
  assistBtn.textContent = '🖱️ 远程协助：已开启';
  openWorkbench();
  log('🖱️ 远程协助已开启：工作台已进入共享画面，等待成员请求控制');
});

// 工作台开/关：进入"工作台模式"——藏起会议主界面，iframe 铺满视口。
// A 共享的就是本标签页，所以工作台画面 = 观众看到的"桌面"。
function openWorkbench() {
  workbenchArea.classList.remove('hidden');
  document.body.classList.add('workbench-mode');
  setWbStatus('✅ 远程协助已开启，等待成员请求控制…');
}
function closeWorkbench() {
  workbenchArea.classList.add('hidden');
  document.body.classList.remove('workbench-mode');
  wbReclaimBtn.classList.add('hidden');
}
function setWbStatus(text) { wbStatus.textContent = text; }

// 关闭远程协助（工具条按钮 / 停止共享都会走到这里）
function turnOffAssist() {
  assistOn = false;
  assistBtn.classList.remove('on');
  assistBtn.textContent = '🖱️ 允许远程协助';
  if (rcRole === 'host') socket.emit('remote-release'); // 有控制在进行 → 信令收权
  endHostControl();
  closeWorkbench();
  log('🖱️ 远程协助已关闭');
}

// 被控端：结束"被控状态"（不动 assistOn/工作台，只清这一轮控制）
function endHostControl() {
  if (rcPeerId && ctrlChannels[rcPeerId]) {
    ctrlChannels[rcPeerId].close();          // 关掉 ctrl 通道（掐断输入流）
    delete ctrlChannels[rcPeerId];
  }
  remoteCursorEl.classList.add('hidden');    // 远程光标收起来
  stopCtlCountdown();                        // ★ A6：倒计时停（被控端工作台那个显示）
  cancelPendingFile();                       // ★ A4：还没被接受的传输请求作废
  rcRole = null;
  rcPeerId = null;
  if (assistOn) {
    setWbStatus('✅ 远程协助已开启，等待成员请求控制…');
    wbReclaimBtn.classList.add('hidden');
  }
}

// Phase 5 清理矩阵：某成员离开时，他卷入的控制关系全部作废（坑 #8）
function cleanupRemoteCtrlForPeer(id) {
  if (ctrlChannels[id]) { ctrlChannels[id].close(); delete ctrlChannels[id]; }
  if (rcRole === 'controller' && rcPeerId === id) {
    exitControlMode(false);        // 我正控制他 → 退出（人走了，release 发不出去了）
    socket.emit('remote-release'); // 信令清表（服务器断线清理也会兜底，双保险）
  }
  if (rcRole === 'host' && rcPeerId === id) endHostControl(); // 我正被他控
}

// ⭐重放入口：把控制端的一条 input 消息作用到工作台上
//   消息两种来源（A5①）：JSON（键盘/文本）解析后的对象、16 字节帧解码后的对象——
//   结构同构，这里一视同仁。
function replayRemoteInput(msg) {
  auditPushInput(msg); // ★ 升级 A6：先把这条控制事件记进审计日志（聚合规则见第 20 步）
  // 键盘/整段文本没有坐标，单独走（见 replayKey / replayText）
  if (msg.kind === 'keydown' || msg.kind === 'keyup') { replayKey(msg); return; }
  if (msg.kind === 'input-text') { replayText(msg); return; } // ★ A2：中文整段插入（规划 4.3 预留的 kind 名）

  // ① 归一化 → 我的视口像素坐标。为什么乘整个视口？因为 B 端看到的"画面内容"
  //    就是我的整个标签页视口被共享出去的样子——基准天然对齐。
  const px = clamp01(msg.x) * window.innerWidth;
  const py = clamp01(msg.y) * window.innerHeight;

  // ② 移动"远程光标"：合成事件不会动系统真实光标，自己画一颗给被控端看
  remoteCursorEl.classList.remove('hidden');
  remoteCursorEl.style.left = px + 'px';
  remoteCursorEl.style.top = py + 'px';

  // ★ 09-12 补：点击涟漪——被控端"可见反馈"的第二半（光标只证明"在动"，
  //   涟漪证明"在点"）。放在 iframe 检查**之前**：即使点落在工作台外，
  //   "有人点了这里"这件事本身也要看得见。
  if (msg.kind === 'mousedown') spawnCtlRipple(px, py);

  // ③ 只重放落在工作台 iframe 内的事件（坑 #7：iframe 外是会议 UI，绝不遥控）
  const rect = workbenchFrame.getBoundingClientRect();
  const lx = px - rect.left;
  const ly = py - rect.top;
  if (lx < 0 || ly < 0 || lx > rect.width || ly > rect.height) return;
  const doc = workbenchFrame.contentDocument; // 同源才能拿到（规划 2.3 表）
  if (!doc) return;                           // iframe 还没加载完，这次丢弃
  const target = doc.elementFromPoint(lx, ly); // 命中这个点上"最上层"的元素
  if (!target) return;

  // ④ 按类型派发合成事件——工作台（workbench.html）里的监听器会照常响应
  const base = { clientX: lx, clientY: ly, bubbles: true, cancelable: true };
  switch (msg.kind) {
    case 'mousemove':
      target.dispatchEvent(new PointerEvent('pointermove', base));
      break;
    case 'mousedown':
      focusTarget(target); // 合成点击不聚焦（坑 #12），命中输入区时手动补
      target.dispatchEvent(new PointerEvent('pointerdown', { ...base, button: msg.btn }));
      emitWbActivity(msg.btn === 2 ? 'ctxmenu' : 'mousedown', { label: describeWbTarget(target) }); // ★ 09-15 HUD
      break;
    case 'mouseup':
      target.dispatchEvent(new PointerEvent('pointerup', { ...base, button: msg.btn }));
      break;
    case 'dblclick':
      target.dispatchEvent(new MouseEvent('dblclick', base));
      emitWbActivity('dblclick', { label: describeWbTarget(target) }); // ★ 09-15 HUD
      break;
    case 'wheel':
      target.dispatchEvent(new WheelEvent('wheel', { ...base, deltaY: msg.wheel || 0 }));
      emitWbActivity('wheel', { delta: msg.wheel || 0, label: describeWbTarget(target) }); // ★ 09-15 HUD
      break;
  }
}

// 让"该聚焦的元素"拿到焦点——文本区聚焦了，打字才有落点
function focusTarget(el) {
  const editable = el.isContentEditable ||
    el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
  if (editable) el.focus();
}

/* ★ 09-15 同构补齐：工作台"实时字幕 HUD"派发（与 SFU 版逐行同构）。
 * Mesh 与 SFU 唯一的差别只是输入的传输层（P2P DataChannel vs 信令转发），
 * 重放后的"可见反馈"理应一致——HUD/涟漪/光标三件套两版都有才叫同构。 */
function emitWbActivity(kind, extra) {
  try {
    const doc = workbenchFrame.contentDocument;
    if (!doc) return;
    doc.dispatchEvent(new CustomEvent('remote-activity', { detail: Object.assign({ kind }, extra) }));
  } catch (e) { /* 工作台还没就绪，忽略 */ }
}
function describeWbTarget(target) {
  if (!target) return '';
  return (target.getAttribute && (target.getAttribute('data-act') || target.getAttribute('data-emoji')))
    || (target.textContent || '').trim().slice(0, 10)
    || target.className || target.tagName || '';
}

// ★ 09-12 补：点击涟漪（被控端可见反馈）。在控制端按下的位置画一圈扩散的绿环，
//   动画结束自己删掉。position:fixed + 视口坐标——因为 msg.x/y 归一化的基准
//   就是"整个视口被共享出去的样子"（见上面 ①）。样式见 style.css 的 .ctl-ripple。
function spawnCtlRipple(px, py) {
  const ripple = document.createElement('div');
  ripple.classList.add('ctl-ripple'); // 用 classList 而不是 className（教学项目一贯风格）
  ripple.style.left = px + 'px';
  ripple.style.top = py + 'px';
  document.body.appendChild(ripple);
  setTimeout(() => ripple.remove(), 600); // 与 CSS 动画时长一致，播完即删防堆积
}

// ⭐键盘重放（坑 #4 是本功能最大的"看起来简单"陷阱）：
//   合成 KeyboardEvent 能触发监听器，但不会触发浏览器默认行为——
//   "自动往输入框插字符"这个默认行为不存在，必须我们代做：
//     可打印字符 → execCommand('insertText')
//     Backspace  → execCommand('delete')
//     Enter      → execCommand('insertLineBreak')
//     方向/Home/End → Selection.modify（非标准，Chrome 支持，try/catch 兜底）
//   边界（★ A2 已解决）：中文输入法组合键 key='Process' 在控制端就被闸掉，
//   中文以"整段文本"（kind:'input-text'）消息直达，走下面的 replayText 插入——
//   键盘重放只处理英文/符号/功能键。P0 时代"不支持 IME"的限制就此解除。
function replayKey(msg) {
  const doc = workbenchFrame.contentDocument;
  if (!doc) return;
  const active = doc.activeElement || doc.body;
  // 先把按键"告知"工作台里的焦点元素（监听器能收到；默认行为没有，见上）
  active.dispatchEvent(new KeyboardEvent(msg.kind, {
    key: msg.key, code: msg.code,
    altKey: msg.altKey, ctrlKey: msg.ctrlKey,
    shiftKey: msg.shiftKey, metaKey: msg.metaKey,
    bubbles: true, cancelable: true,
  }));
  if (msg.kind === 'keydown') emitWbActivity('keydown', { key: msg.key }); // ★ 09-15 HUD
  if (msg.kind === 'keyup') return;  // keyup 只需通知
  const editable = active && (active.isContentEditable ||
    active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
  if (!editable) return;             // 焦点不在文本区：打字没有落点，忽略
  const key = msg.key || '';
  const printable = key.length === 1 && !msg.ctrlKey && !msg.metaKey && !msg.altKey;
  try {
    if (printable) {
      doc.execCommand('insertText', false, key);
    } else if (key === 'Backspace') {
      doc.execCommand('delete');
    } else if (key === 'Enter') {
      doc.execCommand('insertLineBreak');
    } else if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' ||
               key === 'ArrowDown' || key === 'Home' || key === 'End') {
      const dir = (key === 'ArrowLeft' || key === 'Home') ? 'backward' : 'forward';
      const unit = (key === 'Home' || key === 'End') ? 'lineboundary'
        : (key === 'ArrowUp' || key === 'ArrowDown') ? 'line' : 'character';
      const sel = doc.getSelection();
      if (sel && sel.modify) sel.modify('move', dir, unit);
    }
  } catch (err) { /* 个别浏览器不支持就跳过，不影响其他键 */ }
}

// ⭐整段文本重放（A2 中文 IME 的被控端半边）：
//   控制端把组合输入的最终文本整段发来，这里对"当前焦点的可编辑元素"
//   一次 execCommand('insertText') 插入——和粘贴同款通道，天然支持中文、
//   emoji、任何 UTF-8 字符，也绕开了"合成按键不插字"的坑（我们不靠按键）。
//   焦点不在文本区就忽略：打字没有落点（和 replayKey 同一个纪律）。
function replayText(msg) {
  auditPush('插入文本', `${(msg.text || '').length} 字：${(msg.text || '').slice(0, 40)}`);
  const doc = workbenchFrame.contentDocument;
  if (!doc || !msg.text) return;
  const active = doc.activeElement || doc.body;
  const editable = active && (active.isContentEditable ||
    active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
  if (!editable) return;
  try { doc.execCommand('insertText', false, msg.text); }
  catch (err) { /* 个别浏览器不支持就跳过 */ }
  emitWbActivity('input-text', { text: msg.text }); // ★ 09-15 HUD：中文整段也上字幕
}

/* ---- Phase 5：工作台工具条按钮 ---- */
// 收回控制：被控端随时结束当前控制（工作台保持开着，等下一次请求）
wbReclaimBtn.addEventListener('click', () => {
  socket.emit('remote-release'); // 信令：服务器清表 + 全房广播 → 控制端自动退出
  endHostControl();              // 本地立即复位（广播到达时再复位一遍也幂等）
  log('🖱️ 已收回控制权');
});
// 关闭远程协助：收工作台 + 结束控制（共享继续）
wbAssistOffBtn.addEventListener('click', () => turnOffAssist());
// 停止共享：与主控制区「停止共享」等效（工作台模式下主控制区被藏起来了）
wbStopShareBtn.addEventListener('click', () => stopSharing());

/* ════════════════════════════════════════════════════════════════
 * 升级 A3/A4/A6/A7 + D2/D3 + 成员列表（第 19 ~ 25 步）
 *
 * ▎这一段是"远程协助深化"和"会议体验补全"两批升级，都往 ctrl_ 通道和页面上加东西：
 *   第 19 步  A3  剪贴板同步（两向）
 *   第 20 步  A6  权限/安全增强（限时授权倒计时 + 审计日志 + 黑名单）
 *   第 21 步  A4  远程截图 + 文件传输（分块 + 背压流控）
 *   第 22 步  A7  触屏支持（长按=右键、双指=滚轮）
 *   第 23 步  D2  说话人指示器（浏览器端音量分析）
 *   第 24 步  D3  设备切换（replaceTrack 不重新协商）
 *   第 25 步      成员列表（轻量版）
 * ════════════════════════════════════════════════════════════════ */

/* ──────────────────────────────────────────────────────────────
 * 第 19 步：⭐ 升级 A3 —— 剪贴板同步（两向）
 *
 * ▎先想清楚一件事：为什么"复制粘贴"在远程桌面上是个技术活？
 *   控制端按 Ctrl+C 时，选中的文字其实在被控端那台机器上；
 *   控制端按 Ctrl+V 时，想粘贴的内容在自己这台机器的剪贴板里。
 *   而键盘事件穿过网络之后，被控端执行粘贴读的是**被控端自己的剪贴板**——
 *   两个操作系统、两份剪贴板，直接转发按键只会粘出牛头不对马嘴的东西。
 *   → 所以真实远程桌面（RDP / VNC / 向日葵）都做「剪贴板重定向」：
 *       控制端读本机剪贴板 → 把**内容**（不是按键）发过去 → 对端按内容写入。
 *     我们这一节就是把这件事用 ctrl_ DataChannel 做一遍。
 *
 * ▎协议（和现有 {type:'input'} 并列，不冲突、不改老消息）：
 *   { type:'clipboard', text, dir }   dir 省略/'ctl→host' = 控制端→被控端（粘贴）
 *                                     dir = 'host→ctl'    = 被控端→控制端（复制）
 *   { type:'clipboard-pull' }         控制端 Ctrl+C 但本地读不到选区 → 向被控端"要"一次
 *
 * ▎⭐ 本项目的"演示边界"（面试要主动讲清楚，别被面试官问倒）：
 *   真实远程桌面里，选中文本存在于**远端**，控制端本地根本读不到，
 *   必须"远端读 → 过网络 → 本地写"（也就是下面的 clipboard-pull 路径）。
 *   本项目的工作台是**同源 iframe**（workbench.html 和主页同一个 origin），
 *   所以控制端的 JS 用 contentDocument.getSelection() 就能直接读到——
 *   这让演示更方便，但**不代表真实语义**。所以两条路径我都实现了：
 *     ① 同源直读（快、本地、演示用）    ② clipboard-pull（真实语义、走网络）
 *   这才是"演示版"和"真机版"的区别所在，讲清楚反而是加分项。
 *
 * ▎健壮性要求：剪贴板 API（navigator.clipboard）受"权限 + 用户手势 + 安全上下文
 *   （https / localhost）"三重限制，随时可能抛异常。所以下面每一处都 try/catch，
 *   失败一律"中文日志 + toast 提示"，绝不把异常抛到控制台上变成未捕获错误。
 * ────────────────────────────────────────────────────────────── */

// 控制端 → 被控端：把一段文本发过去（粘贴）
//   返回 true = 已发出；false = 通道没就绪（调用方据此给用户提示）
function sendClipboardToHost(text) {
  if (!rcPeerId || !text) return false;
  return ctrlSend(rcPeerId, { type: 'clipboard', text, dir: 'ctl→host' });
}

// Ctrl+V 的防抖时间戳（详见 onCtlKeyDown 里的说明：两条拦截路径不能重复触发）
let lastClipboardPasteAt = 0;

// 写本机剪贴板：抽成小函数因为"控制端收 host→ctl"和"控制端 Ctrl+C"都要用
//   ▎为什么写失败要 toast 而不是只写日志？——用户按了 Ctrl+C，以为复制成功了，
//     结果粘贴出来是旧内容，这种"静默失败"最容易被当成 bug 报上来。
async function writeLocalClipboard(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    log(okMsg);
    showToast(okMsg, '');
    return true;
  } catch (err) {
    const why = `${err && err.name ? err.name : 'Error'}`;
    log(`📋 写入本机剪贴板失败：${why}（需要剪贴板权限，且页面要在前台/安全上下文）`);
    showToast('❌ 写入剪贴板失败，请检查浏览器剪贴板权限', 'error');
    return false;
  }
}

// 读本机剪贴板：同样是一个会失败的异步操作，调用方负责兜底
async function readLocalClipboard() {
  try {
    return await navigator.clipboard.readText();
  } catch (err) {
    const why = `${err && err.name ? err.name : 'Error'}`;
    log(`📋 读取本机剪贴板失败：${why}（浏览器会要求剪贴板读取权限/用户手势）`);
    showToast('❌ 读不到本机剪贴板，请允许剪贴板权限后重试', 'error');
    return null;
  }
}

// ⭐控制端按 Ctrl+V：读本机剪贴板 → 发给被控端 → 由被控端插进工作台
async function pasteFromLocalClipboard() {
  if (!rcPeerId) return;
  const text = await readLocalClipboard();
  if (text == null) return;                       // 读失败，上面已经提示过
  if (!text) { showToast('📋 本机剪贴板里没有文本内容', 'info'); return; }
  if (sendClipboardToHost(text)) {
    log(`📋 已把本机剪贴板（${text.length} 字）同步给对方工作台`);
    showToast(`📋 已粘贴 ${text.length} 个字符到对方工作台`);
  } else {
    showToast('❌ 控制通道未就绪，剪贴板没能发出去', 'error');
  }
}

// 读"我这边的"工作台 iframe 选区（同源才能读；读不到就返回空串）
function readWorkbenchSelection() {
  try {
    const doc = workbenchFrame.contentDocument;
    if (!doc) return '';
    const sel = doc.getSelection();
    return sel ? sel.toString() : '';
  } catch (err) {
    log(`📋 读取工作台选区失败：${err.name}（跨源 iframe 读不到，本项目同源）`);
    return '';
  }
}

// ⭐控制端按 Ctrl+C（或点工具条「📋 复制选区」）：
//   ① 同源直读本机 iframe 的选区（演示路径，见本节顶部的"演示边界"说明）
//   ② 读不到 → 发 clipboard-pull 让被控端把它那边的选区送过来（真实语义路径）
function controllerCopySelection() {
  if (!rcPeerId) return;
  const text = readWorkbenchSelection();
  if (text) {
    writeLocalClipboard(text, `📋 已复制工作台选区（${text.length} 字）到本机剪贴板`);
    return;
  }
  if (ctrlSend(rcPeerId, { type: 'clipboard-pull' })) {
    log('📋 本地读不到选区，已向被控端请求它当前的选中文本...');
    showToast('📋 已向被控端请求选中文本', 'info');
  } else {
    showToast('❌ 控制通道未就绪，无法取回选区', 'error');
  }
}

// 被控端：把"我的当前选区"回给控制端（响应 clipboard-pull 的真实语义路径）
function sendHostSelection() {
  if (!rcPeerId) return;
  const text = readWorkbenchSelection();
  if (!text) {
    log('📋 收到控制端的选区请求，但工作台当前没有选中文本');
    showToast('📋 对方想复制你工作台里选中的文字，但现在没有选中内容', 'info');
    return;
  }
  if (ctrlSend(rcPeerId, { type: 'clipboard', text, dir: 'host→ctl' })) {
    log(`📋 已把工作台选区（${text.length} 字）发给控制端`);
    auditPush('剪贴板·发送', `${text.length} 字`);
  }
}

// 被控端：「📋 把剪贴板发给控制端」按钮
//   优先发**被控端本机剪贴板**（按钮字面语义）；本机剪贴板读不到（权限/无焦点）时，
//   退化为"把工作台当前选区发过去"——两条路都能把内容送到控制端，体验不断档。
async function wbSendClipboardToController() {
  if (rcRole !== 'host' || !rcPeerId) { showToast('当前没有正在进行的远程控制', 'info'); return; }
  const text = await readLocalClipboard();
  if (text) {
    if (ctrlSend(rcPeerId, { type: 'clipboard', text, dir: 'host→ctl' })) {
      log(`📋 已把本机剪贴板（${text.length} 字）发给控制端`);
      auditPush('剪贴板·发送', `本机剪贴板 ${text.length} 字`);
      showToast(`📋 已把 ${text.length} 个字符发给控制端`);
      return;
    }
    showToast('❌ 控制通道未就绪，没发出去', 'error');
    return;
  }
  // 本机剪贴板不可用 → 退回"发工作台选区"
  log('📋 本机剪贴板读不到（可能页面不在前台），改为发送工作台选区');
  sendHostSelection();
}

// 通道收到的剪贴板消息统一入口（role 告诉我自己在这条通道上是 host 还是 controller）
function handleClipboardMsg(msg, role) {
  const text = typeof msg.text === 'string' ? msg.text : '';
  if (!text) return;
  if (msg.dir === 'host→ctl') {
    // 被控端 → 控制端：写进我（控制端）自己的剪贴板
    if (role !== 'controller') return;
    auditPush('剪贴板·收到', `${text.length} 字`);
    writeLocalClipboard(text, `📋 已把被控端的剪贴板内容（${text.length} 字）写入本机`);
    return;
  }
  // 控制端 → 被控端：直接插到工作台当前焦点元素上（复用 A2 的 replayText）
  if (role !== 'host') return;
  replayText({ text });
  showToast(`📋 控制端粘贴了 ${text.length} 个字符到工作台`, 'info');
}

wbClipBtn.addEventListener('click', wbSendClipboardToController); // ★ A3 被控端按钮

/* ──────────────────────────────────────────────────────────────
 * 第 20 步：⭐ 升级 A6 —— 权限/安全增强（限时授权 + 审计日志 + 黑名单）
 *
 * ▎安全设计的三条主线（面试可以直接背这三句）：
 *   ① 最小授权：默认只给 60 秒，而不是"一次授权一辈子"。
 *      权限给得越久，用户忘记收回的概率越大 → 风险敞口越大。
 *   ② 可审计：被控端把每一条控制事件记进本地环形缓冲（上限 500 条），
 *      随时可看、可导出、可清空，**日志不落服务器**——
 *      因为审计的目的是保护"被控的人"；日志一旦上传服务器，
 *      就变成"平台在监视你"，知情权和删除权都不在被控端手里了。
 *   ③ 可拒绝：黑名单（Set）让"不想再被控制"变成一键的事，且只存在本地。
 * ────────────────────────────────────────────────────────────── */

/* ---- ① 限时授权：倒计时显示 + 本地兜底复位 ---- */
// 服务器广播的是**绝对到期时刻**（expiresAt 时间戳），两端各自和本机时钟比大小，
// 就能画出剩余秒数——不需要每秒找服务器问一次（省流量，也天然抗抖动）。
let ctlCountdownTimer = null;

function startCtlCountdown(expiresAt) {
  stopCtlCountdown(); // 先清旧的，避免两个倒计时同时跑（幂等更新）
  const hostEl = wbExpire;                                        // 被控端工作台工具条
  const ctrlEl = document.querySelector('.ctrl-layer .ctl-expire'); // 控制端控制层
  if (!expiresAt) {
    // null = 不限时：把两个显示都藏起来
    if (hostEl) hostEl.classList.add('hidden');
    if (ctrlEl) ctrlEl.classList.add('hidden');
    return;
  }
  if (hostEl) hostEl.classList.remove('hidden');
  if (ctrlEl) ctrlEl.classList.remove('hidden');

  const tick = () => {
    const left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
    const mins = Math.floor(left / 60), secs = left % 60;
    const text = `⏳ ${mins > 0 ? mins + '分' : ''}${secs} 秒`;
    if (hostEl) hostEl.textContent = text;
    if (ctrlEl) ctrlEl.textContent = text;
    if (left <= 0) {
      // ★ 本地兜底：服务器到点一定会广播 remote-state 复位，但万一那条广播丢了
      //   （网络抖动/页面切后台被节流），本地也要自己复位，别让 UI 停在"正在控制"。
      stopCtlCountdown();
      log('⏰ 授权时间到，本地已自动结束本次远程控制（服务器也会广播复位）');
      if (rcRole === 'host') { endHostControl(); setWbStatus('⏰ 授权时间已到，控制已自动结束'); }
      if (rcRole === 'controller') exitControlMode(false);
    }
  };
  tick();                          // 先画一次，别等 500ms 才有数字
  ctlCountdownTimer = setInterval(tick, 500);
}

function stopCtlCountdown() {
  if (ctlCountdownTimer) { clearInterval(ctlCountdownTimer); ctlCountdownTimer = null; }
  wbExpire.classList.add('hidden');
  const ctrlEl = document.querySelector('.ctrl-layer .ctl-expire');
  if (ctrlEl) ctrlEl.classList.add('hidden');
}

/* ---- ② 审计日志：环形缓冲（上限 500 条） ---- */
const AUDIT_MAX = 500;   // 环形缓冲上限：满了就丢最老的一条（内存恒定，不会越跑越大）
const auditLog = [];     // 每条 = { t: 时间字符串, type: 类型, detail: 细节 }
let auditMoveCount = 0;  // 鼠标移动的聚合计数器（见下）
let auditMoveLast = { x: 0, y: 0 };
let auditMoveFlushAt = 0;

// 写一条审计
function auditPush(type, detail) {
  const entry = { t: new Date().toLocaleTimeString(), type, detail: detail || '' };
  auditLog.push(entry);
  if (auditLog.length > AUDIT_MAX) auditLog.shift();  // 环形：挤掉最老的
  if (!auditPanel.classList.contains('hidden')) {
    auditList.appendChild(auditLineEl(entry));
    auditList.scrollTop = auditList.scrollHeight;
  }
  auditFoot.textContent = `共 ${auditLog.length} 条（上限 ${AUDIT_MAX} 条，超出后自动丢弃最早的）`;
}

// 造一行 DOM：全部用 textContent —— 日志里可能含对方发来的文本/文件名，
// 那是**不可信输入**，绝不能拼 innerHTML（XSS 铁律）。
function auditLineEl(entry) {
  const line = document.createElement('div');
  line.textContent = `[${entry.t}] ${entry.type}${entry.detail ? ' · ' + entry.detail : ''}`;
  return line;
}

// 控制事件入审计（★ 关键取舍：鼠标移动是 60 次/秒，全记 8 秒就撑满 500 条缓冲）
//   ▎策略：move 不进明细，只累加计数，每 2 秒"汇总成一条"。
//     这叫"采样聚合"——审计的目的是"证明发生过什么"，不是"逐帧复刻轨迹"；
//     真实系统的日志采样、指标聚合都是这个思路（面试可讲）。
function auditPushInput(msg) {
  if (msg.kind === 'mousemove') {
    auditMoveCount++;
    auditMoveLast = { x: msg.x, y: msg.y };
    const now = Date.now();
    if (now - auditMoveFlushAt >= 2000) {
      auditMoveFlushAt = now;
      auditPush('控制输入·鼠标移动',
        `聚合 ${auditMoveCount} 条，最近坐标 x=${Number(msg.x).toFixed(3)} y=${Number(msg.y).toFixed(3)}`);
      auditMoveCount = 0;
    }
    return;
  }
  if (msg.kind === 'keydown' || msg.kind === 'keyup') {
    const mods = [msg.ctrlKey && 'Ctrl', msg.altKey && 'Alt', msg.shiftKey && 'Shift', msg.metaKey && 'Meta']
      .filter(Boolean).join('+');
    auditPush(`控制输入·${msg.kind === 'keydown' ? '按键' : '松键'}`,
      `${mods ? mods + '+' : ''}${msg.key || msg.code || '?'}`);
    return;
  }
  const names = { mousedown: '按下', mouseup: '抬起', dblclick: '双击', wheel: '滚轮' };
  let detail = typeof msg.x === 'number' ? `x=${Number(msg.x).toFixed(3)} y=${Number(msg.y).toFixed(3)}` : '';
  if (msg.kind === 'wheel') detail += ` 增量=${msg.wheel}`;
  if (typeof msg.btn === 'number' && msg.kind !== 'wheel') detail += ` 键=${msg.btn === 2 ? '右键' : msg.btn === 1 ? '中键' : '左键'}`;
  auditPush(`控制输入·${names[msg.kind] || msg.kind}`, detail.trim());
}

// 打开审计面板：把已有的 500 条一次性渲染出来（面板不常开，重建最省心）
function openAuditPanel() {
  auditList.textContent = '';
  auditLog.forEach((e) => auditList.appendChild(auditLineEl(e)));
  auditList.scrollTop = auditList.scrollHeight;
  auditFoot.textContent = `共 ${auditLog.length} 条（上限 ${AUDIT_MAX} 条，超出后自动丢弃最早的）`;
  auditPanel.classList.remove('hidden');
  log(`📜 审计日志已打开（${auditLog.length} 条，只存在本机，不上传服务器）`);
}

wbAuditBtn.addEventListener('click', openAuditPanel);
auditCloseBtn.addEventListener('click', () => auditPanel.classList.add('hidden'));
auditClearBtn.addEventListener('click', () => {
  auditLog.length = 0;
  auditMoveCount = 0;
  auditList.textContent = '';
  auditFoot.textContent = '共 0 条';
  log('📜 审计日志已清空');
});

// 导出 .txt：零依赖（Blob + 临时 <a download>，不引任何库）
auditExportBtn.addEventListener('click', () => {
  try {
    const head = [
      '远程控制审计日志（由被控端本地记录，未上传服务器）',
      `导出时间：${new Date().toLocaleString()}`,
      `共 ${auditLog.length} 条`,
      '────────────────────────────────',
    ].join('\n');
    const body = auditLog.map((e) => `[${e.t}] ${e.type}${e.detail ? ' · ' + e.detail : ''}`).join('\n');
    const blob = new Blob([head + '\n' + body + '\n'], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `远程控制审计日志-${timeStamp()}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000); // 用完释放，别把 blob 常驻内存
    log(`📜 审计日志已导出：${a.download}`);
    showToast('📜 审计日志已导出为 .txt');
  } catch (err) {
    log(`📜 导出审计日志失败：${err.name}`);
    showToast('❌ 导出失败，请重试', 'error');
  }
});

/* ──────────────────────────────────────────────────────────────
 * 第 21 步：⭐ 升级 A4 —— 远程截图 + 文件传输
 *
 * ▎截图为什么这么简单？（3 行核心代码）
 *   远程画面在控制端这边就是一个 <video>（元素里已经有解码好的帧），
 *   canvas.drawImage(video) 能直接把当前帧画到画布上，再 toBlob 就是一张 PNG。
 *   **零依赖**，不需要任何截图库——因为"浏览器已经帮我们解码好了"。
 *   （对比：如果画面是加密流/H.264 裸流，就得自己解，那才需要库。）
 *
 * ▎文件传输的难点不是"发"，是**流控（背压，backpressure）**：
 *   DataChannel 的 send() 是"扔进本地发送缓冲就返回"，不是"对方收到了"。
 *   如果你一口气把 50MB 全 send 进去：
 *     ① 缓冲爆掉 → 浏览器直接抛错/断开通道（SCTP 缓冲区有上限）；
 *     ② 内存暴涨 → 页面卡死；
 *     ③ 挤占同一条通道上的鼠标键盘事件 → 远程操作卡成幻灯片（这正是要避免的）。
 *   所以必须：每发一块就 check 一次 ch.bufferedAmount（本地待发字节数），
 *   超过高水位就**等**——等 bufferedAmountLowThreshold 触发的
 *   "bufferedamountlow" 事件（缓冲降到低水位以下）再继续。
 *   这套"高水位暂停 / 低水位唤醒"就是 TCP 滑动窗口的简化版，
 *   也是升级 A5③（积压监控）从"丢弃过时消息"升级为"主动等待"的正面用法。
 *
 * ▎⭐ 定位说明：文件传输**只在远程控制会话建立后可用**（沿 ctrl_ 通道走），
 *   不做独立的"会议文件共享"——这是"A4 远程协助深化"的一部分。
 * ────────────────────────────────────────────────────────────── */

// 二进制帧的"魔数"：首字节 0xFE = 这是文件分片（控制帧的 kind 只用了 3~7，不会撞车）
const FILE_MAGIC = 0xFE;
const FILE_HEADER = 8;                 // 帧头 8 字节：[0]魔数 [1]预留 [2..3]序号 [4..7]偏移
const FILE_CHUNK = 16 * 1024;          // 每片 16KB（SCTP 单条消息的常用安全值）
const FILE_HIGH_WATER = 1024 * 1024;   // 发送缓冲高水位 1MB：超过就停下来等
const FILE_LOW_WATER = 256 * 1024;     // 低水位 256KB：降到这个数以下再继续发
const FILE_MAX_SIZE = 50 * 1024 * 1024;// 单文件上限 50MB（浏览器内存里拼 Blob，别太大）

let fileSend = null;          // 控制端：{ file, name, size, mime, sending }
let fileRecv = null;          // 被控端：{ name, size, mime, chunks:[{offset,payload}], received }
let pendingFileOffer = null;  // 被控端：等待用户点"接受/拒绝"的那个 offer
const fileItems = {};         // 进度面板里的 DOM 条目缓存（key: 'send' / 'recv-<时间>'）

// 格式化字节数（1024 进制，"1.2 MB"这种人类可读的写法）
function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// 文件名里不能出现 \ / : * ? " < > |（Windows 限制），而且给用户看的名字要可读
function timeStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// 进度面板：新增/更新一个条目（名字一律 textContent，防 XSS）
function showFileItem(key, name, meta) {
  filePanel.classList.remove('hidden');
  let item = fileItems[key];
  if (!item) {
    item = document.createElement('div');
    item.className = 'file-item';
    const nm = document.createElement('div'); nm.className = 'fi-name';
    const bar = document.createElement('div'); bar.className = 'fi-bar';
    bar.appendChild(document.createElement('i'));
    const mt = document.createElement('div'); mt.className = 'fi-meta';
    item.appendChild(nm); item.appendChild(bar); item.appendChild(mt);
    filePanel.appendChild(item);
    fileItems[key] = item;
  }
  item.querySelector('.fi-name').textContent = name;
  item.querySelector('.fi-meta').textContent = meta;
  return item;
}
function setFileItemProgress(key, ratio) {
  const item = fileItems[key];
  if (!item) return;
  item.querySelector('.fi-bar > i').style.width = `${Math.round(ratio * 100)}%`;
}
// 传完/收完后，把条目换成"保存"链接
function setFileItemLink(key, url, filename) {
  const item = fileItems[key];
  if (!item) return;
  const meta = item.querySelector('.fi-meta');
  meta.textContent = '';
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;               // download 属性：点击直接存盘，而不是新标签页打开
  a.textContent = `💾 保存「${filename}」`; // textContent —— 文件名是对方给的，不可信
  meta.appendChild(a);
  setFileItemProgress(key, 1);
}

/* ---- ★ 远程截图（控制端）---- */
function ctlScreenshot() {
  const peer = peers[rcPeerId];
  if (!peer) { showToast('❌ 找不到被控端的画面', 'error'); return; }
  const video = peer.video;
  try {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) { showToast('❌ 还没有画面可截（等视频就绪再试）', 'error'); return; }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(video, 0, 0, w, h); // 当前帧 → 画布
    canvas.toBlob((blob) => {
      if (!blob) { showToast('❌ 截图失败（toBlob 返回空）', 'error'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const filename = `远程屏幕-${timeStamp()}.png`;
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();                       // 程序化点击 = 触发浏览器下载（零依赖的标准做法）
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      log(`📸 已截图：${filename}（${w}×${h}）`);
      auditPush('截图', `${w}×${h}`);
      showToast('📸 截图已保存到下载目录');
    }, 'image/png');
  } catch (err) {
    log(`📸 截图失败：${err.name}`);
    showToast('❌ 截图失败', 'error');
  }
}

/* ---- ★ 文件传输（控制端 → 被控端）---- */

// 控制端：点「📁 发文件」→ 现场造一个隐藏的 <input type=file> 让用户选
//   ▎为什么不写在 HTML 里？——它是"用完即弃"的一次性控件，动态造出来更干净，
//     也避免页面上多一个永远不会被看到的元素（教学项目里"少即是多"）。
function ctlPickFile() {
  if (!ctrlReady) { showToast('❌ 控制通道还没就绪，稍等再试', 'error'); return; }
  const input = document.createElement('input');
  input.type = 'file';
  input.style.display = 'none';
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    input.remove();
    if (imeCapture) imeCapture.focus(); // 文件对话框会抢走焦点，选完文件把靶子抢回来（见"焦点保卫战"）
    if (f) offerFile(f);
  });
  document.body.appendChild(input);
  input.click();
}

// 控制端：发出文件邀约（先握手，对方同意再传——不能"先斩后奏"塞满对方硬盘）
function offerFile(file) {
  if (!ctrlReady || !rcPeerId) { showToast('❌ 控制通道未就绪', 'error'); return; }
  if (file.size > FILE_MAX_SIZE) {
    showToast(`❌ 文件太大（上限 ${fmtSize(FILE_MAX_SIZE)}）`, 'error');
    return;
  }
  const mime = file.type || 'application/octet-stream';
  if (!ctrlSend(rcPeerId, { type: 'file-offer', name: file.name, size: file.size, mime })) {
    showToast('❌ 控制通道未就绪，文件没发出去', 'error');
    return;
  }
  fileSend = { file, name: file.name, size: file.size, mime, sending: false };
  showFileItem('send', `📤 ${file.name}`, `等待对方接受…（${fmtSize(file.size)}）`);
  log(`📁 已发送文件邀约：${file.name}（${fmtSize(file.size)}），等待对方接受`);
  auditPush('文件·发出邀约', `${file.name}（${fmtSize(file.size)}）`);
}

// 被控端：收到邀约 → 弹卡片问用户（未经同意绝不落盘，这是"最小惊讶"原则）
function onFileOffer(msg) {
  const name = String(msg.name || '未命名文件');
  const size = Number(msg.size) || 0;
  if (size > FILE_MAX_SIZE) {
    log(`📁 对方要发的文件太大（${fmtSize(size)}），已自动拒绝`);
    ctrlSend(rcPeerId, { type: 'file-accept', ok: false });
    return;
  }
  pendingFileOffer = { name, size, mime: msg.mime || 'application/octet-stream' };
  fileAskText.textContent = `成员 ${shortId(rcPeerId)} 想发送文件：${name}（${fmtSize(size)}），是否接收？`;
  fileAskBox.classList.remove('hidden');
  log(`📁 收到文件邀约：${name}（${fmtSize(size)}），等待你决定`);
  auditPush('文件·收到邀约', `${name}（${fmtSize(size)}）`);
}

fileAcceptBtn.addEventListener('click', () => {
  if (!pendingFileOffer) return;
  const offer = pendingFileOffer;
  pendingFileOffer = null;
  fileAskBox.classList.add('hidden');
  // 初始化接收状态：chunks 里存 {offset, payload}，按 offset 排序后拼起来
  fileRecv = { name: offer.name, size: offer.size, mime: offer.mime, chunks: [], received: 0 };
  showFileItem('recv', `📥 ${offer.name}`, `接收中… 0%（${fmtSize(offer.size)}）`);
  ctrlSend(rcPeerId, { type: 'file-accept', ok: true });
  log(`📁 已接受文件：${offer.name}，开始接收分片...`);
  auditPush('文件·接受', offer.name);
});

fileDenyBtn.addEventListener('click', () => {
  if (!pendingFileOffer) return;
  const offer = pendingFileOffer;
  pendingFileOffer = null;
  fileAskBox.classList.add('hidden');
  ctrlSend(rcPeerId, { type: 'file-accept', ok: false });
  log(`📁 已拒绝接收文件：${offer.name}`);
  auditPush('文件·拒绝', offer.name);
});

// 被控端离开/收权时：把还没决定的邀约作废（卡片收起来）
function cancelPendingFile() {
  if (!pendingFileOffer) return;
  pendingFileOffer = null;
  fileAskBox.classList.add('hidden');
}

// 某个成员离开：和他相关的传输状态全部作废
//   ▎一个房间同时只有一对"被控-控制"关系（P0 规则），所以"有人离开"时
//     无脑作废当前传输是对的——不会误伤别的会话（压根没有别的会话）。
function cancelFileWithPeer(id) {
  abortFileSend();      // 发送方：停掉循环（while 里每片都会检查 sending 标记）
  fileRecv = null;      // 接收方：丢掉拼了一半的分片
  cancelPendingFile();  // 还没决定的邀约弹窗收起来
  if (id && rcPeerId === id) log('📁 对方已离开，文件传输已取消');
}

// 控制端收到"对方接受了" → 真正开始分块发送
function onFileAccept(msg) {
  if (!fileSend) return;
  if (!msg.ok) {
    log(`📁 对方拒绝接收文件：${fileSend.name}`);
    showFileItem('send', `📤 ${fileSend.name}`, '❌ 对方拒绝接收');
    auditPush('文件·被拒绝', fileSend.name);
    fileSend = null;
    return;
  }
  log('📁 对方已接受，开始分块发送（16KB/片，带背压流控）...');
  startFileSend();
}

// ⭐分块发送主体：异步 + 背压等待 + 主动让出主线程
async function startFileSend() {
  const task = fileSend;
  const ch = ctrlChannels[rcPeerId];
  if (!task || !ch || ch.readyState !== 'open') {
    showToast('❌ 控制通道已断开，传输取消', 'error');
    return;
  }
  task.sending = true;
  // 低水位阈值必须**在开始发之前**设好：浏览器降到这个值以下才会触发 bufferedamountlow
  ch.bufferedAmountLowThreshold = FILE_LOW_WATER;

  let buf;
  try {
    buf = await task.file.arrayBuffer(); // 一次性读进内存（上限 50MB，够教学用）
  } catch (err) {
    log(`📁 读取文件失败：${err.name}`);
    showToast('❌ 读取文件失败', 'error');
    task.sending = false;
    return;
  }

  const total = buf.byteLength;
  let offset = 0;
  let seq = 0;
  try {
    while (offset < total) {
      if (!task.sending || ch.readyState !== 'open') { log('📁 传输被中断'); return; }
      // ★ 背压：本地待发字节超过高水位 → 停下来等"降到低水位"的事件
      if (ch.bufferedAmount > FILE_HIGH_WATER) {
        await waitBufferDrain(ch);
        continue; // 等完再看一眼（continue 回到 while 顶部重新判断）
      }
      const end = Math.min(offset + FILE_CHUNK, total);
      const payload = new Uint8Array(buf, offset, end - offset);
      const frame = new Uint8Array(FILE_HEADER + payload.byteLength);
      frame[0] = FILE_MAGIC;                                   // [0] 魔数：这是文件分片
      frame[1] = 0;                                             // [1] 预留（真实协议放版本号）
      new DataView(frame.buffer).setUint16(2, seq & 0xffff);    // [2..3] 序号（诊断用）
      new DataView(frame.buffer).setUint32(4, offset);          // [4..7] 本片在文件里的偏移
      frame.set(payload, FILE_HEADER);                          // [8..] 真正的内容
      ch.send(frame.buffer);
      offset = end;
      seq++;
      // ★ 进度显示 + 主动让出主线程：每 8 片（128KB）await 一次"宏任务让位"。
      //   不让位的话，这个 while 循环会一路同步跑完，期间页面**完全卡死**——
      //   连控制输入都发不出去（A4 的硬要求：传输期间不能卡住控制输入）。
      if ((seq & 7) === 0 || offset >= total) {
        setFileItemProgress('send', offset / total);
        const item = fileItems['send'];
        if (item) item.querySelector('.fi-meta').textContent =
          `发送中… ${Math.round((offset / total) * 100)}%（${fmtSize(total)}）`;
        await new Promise((r) => setTimeout(r, 0)); // 让出一次事件循环
      }
    }
    ctrlSend(rcPeerId, { type: 'file-end', name: task.name, size: total }); // 收尾信号
    setFileItemProgress('send', 1);
    showFileItem('send', `📤 ${task.name}`, `✅ 已发送完成（${fmtSize(total)}）`);
    log(`📁 文件已发送完成：${task.name}（${fmtSize(total)}）`);
    auditPush('文件·发送完成', `${task.name}（${fmtSize(total)}）`);
    showToast(`📁 文件「${task.name}」已发送完成`);
  } catch (err) {
    log(`📁 发送失败：${err.name}（${err.message}）`);
    showToast('❌ 文件发送失败', 'error');
  } finally {
    if (fileSend === task) fileSend = null;
    task.sending = false;
  }
}

// 等发送缓冲降下来：高水位→低水位 的"唤醒"
//   ▎为什么要 800ms 超时兜底？——万一某个浏览器不派发 bufferedamountlow
//     （老版本行为不一致），没有超时就会**永久卡住**在这里。
//     网络编程里"任何等待都必须有超时"是一条铁律。
function waitBufferDrain(ch) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      ch.onbufferedamountlow = null; // 事件用完就摘，避免和下一次等待打架
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, 800);
    ch.onbufferedamountlow = finish;
    if (ch.readyState !== 'open') finish(); // 通道已关，别等了
  });
}

// 被控端：收到一片 → 按 offset 存起来（不直接拼字符串，二进制用 Uint8Array 视图）
function handleFileChunk(data) {
  if (!fileRecv) return; // 没在收文件（可能刚被取消）→ 直接丢
  try {
    const v = new DataView(data);
    const offset = v.getUint32(4);
    const payload = new Uint8Array(data, FILE_HEADER); // 视图，零拷贝
    fileRecv.chunks.push({ offset, payload });
    fileRecv.received += payload.byteLength;
    const ratio = fileRecv.size ? Math.min(1, fileRecv.received / fileRecv.size) : 0;
    setFileItemProgress('recv', ratio);
    const item = fileItems['recv'];
    if (item) item.querySelector('.fi-meta').textContent =
      `接收中… ${Math.round(ratio * 100)}%（${fmtSize(fileRecv.received)} / ${fmtSize(fileRecv.size)}）`;
  } catch (err) {
    console.warn('解析文件分片失败:', err);
  }
}

// 被控端：收到 file-end → 按 offset 排序拼成 Blob → 生成下载链接（零依赖）
function finishFileRecv() {
  if (!fileRecv) return;
  const task = fileRecv;
  fileRecv = null;
  try {
    task.chunks.sort((a, b) => a.offset - b.offset); // 按偏移排序（分片理论上按序到达，但不假设）
    const blob = new Blob(task.chunks.map((c) => c.payload), { type: task.mime });
    const url = URL.createObjectURL(blob);
    setFileItemLink('recv', url, task.name); // 链接用 textContent 塞文件名
    log(`📁 文件接收完成：${task.name}（${fmtSize(blob.size)}），点进度面板里的链接保存`);
    auditPush('文件·接收完成', `${task.name}（${fmtSize(blob.size)}）`);
    showToast(`📁 已收到文件「${task.name}」，点右上角面板保存`, '');
  } catch (err) {
    log(`📁 拼接文件失败：${err.name}`);
    showToast('❌ 文件拼接失败', 'error');
  }
}

// 中断发送（对端收权/掉线/退出控制模式时调用）
function abortFileSend() {
  if (fileSend) {
    fileSend.sending = false;
    log(`📁 传输中断：${fileSend.name}`);
    fileSend = null;
  }
}

/* ──────────────────────────────────────────────────────────────
 * 第 22 步：⭐ 升级 A7 —— 触屏支持（长按=右键、双指=滚轮）
 *
 * ▎第一件事：触屏和鼠标到底差在哪？（面试常问）
 *   ① 没有"悬停"：手指不在屏幕上就没有事件，鼠标可以一直 mousemove；
 *   ② 没有"右键"：右键菜单在手机上要用"长按"替代（这是操作系统的约定）；
 *   ③ 有"多指"：双指缩放/滑动是触摸独有，鼠标没有对应的物理动作；
 *   ④ 有"手势冲突"：手指按住滑动时，浏览器默认要**滚动页面**——
 *      如果不设 CSS `touch-action: none`，你的 pointermove 会被浏览器
 *      半路"抢走"（派发 pointercancel），拖拽直接失效（CSS 里已设）。
 *
 * ▎第二件事：为什么代码看起来没分两套？（这是本节的"设计点"）
 *   Pointer Events 是一套**统一模型**：鼠标、手指、触控笔都走 pointerdown/
 *   pointermove/pointerup，只多一个 e.pointerType 字段（'mouse' / 'touch' / 'pen'）。
 *   所以第 17 步挂的那几个处理器**两种输入共用**，我们只在
 *   "语义确实不同"的地方按 pointerType 分叉：
 *     单指按下抬起 → 一次左键点击（抬起才算，符合移动端直觉）
 *     单指长按 500ms → 右键（mousedown + mouseup btn=2）
 *     双指上下滑  → 滚轮（把位移累加成 deltaY 发出去）
 * ────────────────────────────────────────────────────────────── */

const LONG_PRESS_MS = 500;      // 长按判定阈值：500ms 是移动端的通用约定（≈系统长按时长）
const TAP_MOVE_TOLERANCE = 8;   // 手指移动超过 8px 就不算"点击"（算拖拽）
const touchPoints = new Map();  // pointerId -> { x, y }（当前按在屏幕上的所有手指）
const touchState = {            // 单指手势状态机
  active: false, id: null, startX: 0, startY: 0,
  timer: null, longFired: false, moved: false,
};
let touchScrollLastY = null;    // 双指滑动的上一次平均 Y
let touchScrollAccum = 0;       // 双指滑动累计的 deltaY

// 当前所有手指的平均位置（双指滚轮用中点当"滚轮位置"）
function touchAvg() {
  let x = 0, y = 0, n = 0;
  touchPoints.forEach((p) => { x += p.x; y += p.y; n++; });
  return n ? { x: x / n, y: y / n } : { x: 0, y: 0 };
}

// 发一次"合成点击"：mousedown + mouseup 一起发（btn: 0=左键 2=右键）
//   为什么触屏要"一下发两个"？——鼠标是"按下…抬起"两个物理动作，
//   触屏的 tap 在浏览器看来只在抬手时才算完成一次点击，所以我们在抬手时补一对事件。
function sendSyntheticClick(x, y, btn) {
  const fake = { clientX: x, clientY: y, altKey: false, ctrlKey: false, shiftKey: false, metaKey: false };
  sendCtlInput('mousedown', fake, { btn });
  sendCtlInput('mouseup', fake, { btn });
}

// 手指按下：起长按定时器（双指则直接进入滚动模式，不再考虑长按）
function ctlTouchDown(e) {
  touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touchPoints.size >= 2) {   // 第二根手指落下 → 取消单指手势，改双指滚动
    ctlCancelLongPress();
    touchState.active = false;
    touchScrollLastY = touchAvg().y;
    touchScrollAccum = 0;
    return;
  }
  touchState.active = true;
  touchState.id = e.pointerId;
  touchState.startX = e.clientX;
  touchState.startY = e.clientY;
  touchState.longFired = false;
  touchState.moved = false;
  clearTimeout(touchState.timer);
  touchState.timer = setTimeout(() => {
    // 到点了还要再确认一次"手指确实还按着、且没变成多指"
    if (!touchState.active || touchPoints.size !== 1) return;
    touchState.longFired = true;
    sendSyntheticClick(touchState.startX, touchState.startY, 2); // btn=2 → 右键
    log('📱 触屏长按 500ms → 已识别为右键');
    auditPush('触屏手势', '长按 → 右键');
    if (navigator.vibrate) { try { navigator.vibrate(30); } catch (err) { /* 不支持就算了 */ } }
  }, LONG_PRESS_MS);
}

function ctlCancelLongPress() {
  clearTimeout(touchState.timer);
  touchState.timer = null;
}

// 手指抬起：长按已发过右键就不再补左键；拖动过的不算点击
function ctlTouchUp(e) {
  touchPoints.delete(e.pointerId);
  ctlCancelLongPress();
  if (!touchState.active || touchState.id !== e.pointerId) {
    if (touchPoints.size < 2) touchScrollLastY = null;
    return;
  }
  const longFired = touchState.longFired;
  const moved = touchState.moved;
  touchState.active = false;
  touchState.longFired = false;
  touchScrollLastY = null;
  touchScrollAccum = 0;
  if (longFired || moved) return;             // 已经当右键/拖拽处理过了
  sendSyntheticClick(e.clientX, e.clientY, 0); // 短按 = 左键点击
}

// 双指滑动 → 滚轮。返回值：true = 已按滚动处理（调用方不要再发 mousemove）
function ctlTouchScroll(e) {
  if (e.pointerType !== 'touch') return false;       // 鼠标走原路
  if (!touchPoints.has(e.pointerId)) return false;   // 不是我们跟踪的手指
  touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (touchPoints.size < 2) {
    // 单指拖动 = 移动鼠标：顺手标记 moved（抬手时就不算点击了）
    if (touchState.active) {
      const dx = Math.abs(e.clientX - touchState.startX);
      const dy = Math.abs(e.clientY - touchState.startY);
      if (dx > TAP_MOVE_TOLERANCE || dy > TAP_MOVE_TOLERANCE) touchState.moved = true;
    }
    return false;
  }

  // 双指：用中点位移当滚轮增量。
  //   ▎方向约定：手指向上滑（屏幕内容往上走）在浏览器里等于"往下滚"，
  //     所以 deltaY = 上一次的 Y − 这次的 Y（手指上移 → 差值为正 → deltaY 正）。
  const mid = touchAvg();
  if (touchScrollLastY != null) touchScrollAccum += (touchScrollLastY - mid.y);
  touchScrollLastY = mid.y;
  if (Math.abs(touchScrollAccum) >= 4) {
    // 复用鼠标滚轮的"合并节流"通道（onCtlWheel 内部 60ms 合并一次）
    onCtlWheel({
      deltaY: touchScrollAccum,
      clientX: mid.x,
      clientY: mid.y,
      preventDefault() { /* 合成事件没有真实默认行为，空实现即可 */ },
    });
    touchScrollAccum = 0;
  }
  return true; // 双指期间不发 mousemove（否则对方的鼠标会跟着乱飘）
}

// 清理触摸状态（退出控制模式时调用：手指早抬了却还留着长按定时器 = "僵尸右键"）
function ctlTouchReset() {
  ctlCancelLongPress();
  touchPoints.clear();
  touchState.active = false;
  touchState.id = null;
  touchState.longFired = false;
  touchState.moved = false;
  touchScrollLastY = null;
  touchScrollAccum = 0;
}

/* ──────────────────────────────────────────────────────────────
 * 第 23 步：⭐ 升级 D2 —— 说话人指示器（Mesh 版 = 浏览器端音量分析）
 *
 * ▎要解决的问题：多人会议里，"谁在说话"必须一眼看出来（腾讯会议绿框、Zoom 绿条）。
 *
 * ▎技术原理（三步）：
 *   ① AudioContext：浏览器的"音频处理引擎"，可以给任意音频流接一个"分析探针"；
 *   ② AnalyserNode：探针本体。每 1/N 秒把最近一段波形/频谱快照给你；
 *   ③ 算音量：getByteTimeDomainData() 拿到的是一串 0~255 的**波形采样**
 *      （128 = 静音中心线）。把它们减 128 归一化后求**均方根（RMS）**，
 *      就得到这段声音的能量大小——这就是"音量表"的数学定义。
 *
 * ▎⭐ 两版对照（这是 D2 最有教学价值的地方）：
 *   Mesh 版：每个人的音频都是 P2P 直达我这儿的（ontrack 里拿到远端 stream），
 *            所以分析只能在**每个浏览器本地**做，N 个人就是 N 份重复计算。
 *   SFU 版：音频本来就要在服务器上转发一遍，服务器顺手就能算出"谁在说话"，
 *            然后广播一句话给所有人——**算一次，全员受益**。
 *   → 同一功能、两种架构代价完全不同，这就是 SFU 存在的意义之一。
 *
 * ▎三个必须处理的现实问题：
 *   ① AudioContext 常常是 suspended（浏览器的自动播放策略）→ 第一次用户点击时 resume()；
 *   ② 浏览器不支持 AudioContext → 优雅降级（try/catch + 日志），绝不炸掉整个页面；
 *   ③ 千万别把 analyser 接到 ctx.destination，否则本地麦克风会被播出来变成回声。
 * ────────────────────────────────────────────────────────────── */

let audioCtx = null;        // 全局唯一的音频上下文（建多个会浪费资源）
let audioCtxUnsupported = false; // 不支持就记一笔，别每次调用都刷日志
const analysers = {};       // id('self' 或远端 socket id) -> { analyser, buf, box }
const speakingSet = new Set(); // 正在说话的 id 集合（成员列表和视频框高亮都看它）
const SPEAK_RMS_THRESHOLD = 10; // RMS 阈值（0~255 量级）：经验值，太小会把底噪当说话

// 确保 AudioContext 存在且已 resume。任何用户手势里都可以安全地重复调用。
function ensureAudioCtx() {
  try {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext; // 兼容老 Chrome 的前缀写法
      if (!Ctx) {
        if (!audioCtxUnsupported) {
          audioCtxUnsupported = true;
          log('⚠️ 本浏览器不支持 AudioContext，说话人指示器已降级关闭（其他功能不受影响）');
        }
        return null;
      }
      audioCtx = new Ctx();
      log('🔊 已创建 AudioContext（音频分析引擎）');
    }
    // 自动播放策略：没在用户手势里创建/使用的 AudioContext 会停在 'suspended'，
    // 此时 AnalyserNode 拿到的永远是静音 —— 所以每次用户点击都顺手 resume 一下。
    if (audioCtx.state === 'suspended') {
      audioCtx.resume()
        .then(() => log('🔊 AudioContext 已恢复运行，说话人指示器生效'))
        .catch((err) => log(`⚠️ AudioContext.resume 失败：${err.name}（说话人指示器可能不工作）`));
    }
    return audioCtx;
  } catch (err) {
    if (!audioCtxUnsupported) {
      audioCtxUnsupported = true;
      log(`⚠️ 初始化音频分析失败：${err.name}，说话人指示器已降级关闭`);
    }
    return null;
  }
}

// 给一路音频流建分析器。stream 可以是本地采集流，也可以是远端 ontrack 的流。
function attachAnalyser(id, stream, box) {
  if (!stream || analysers[id]) return;                       // 已经建过就不重复建
  if (!stream.getAudioTracks || stream.getAudioTracks().length === 0) return; // 没有音轨，没得分析
  try {
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    const source = ctx.createMediaStreamSource(stream); // 把流接进音频引擎
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;       // 每次分析 512 个采样点（≈ 快照粒度，够用又省 CPU）
    analyser.smoothingTimeConstant = 0.6; // 时间平滑：音量条不会抖成心电图
    source.connect(analyser);
    // ★ 注意：**不要** analyser.connect(ctx.destination)！
    //   接了就等于把声音播出来，本机麦克风会形成回声/啸叫（坑 #6 的音频版）。
    analysers[id] = { analyser, buf: new Uint8Array(analyser.fftSize), source, stream, box };
    log(`🔊 已为 ${id === 'self' ? '我' : '成员 ' + shortId(id)} 建立音量分析`);
  } catch (err) {
    // 单路失败不影响其他人（比如某个流已经被关掉）
    log(`⚠️ 建立音量分析失败（${err.name}），该成员的说话高亮不可用`);
  }
}

// 拆掉一路分析器（成员离开时调用，否则会说"幽灵话"）
function detachAnalyser(id) {
  const a = analysers[id];
  if (!a) return;
  try {
    a.source.disconnect();
    a.analyser.disconnect();
  } catch (err) { /* 已经断开就忽略 */ }
  delete analysers[id];
  speakingSet.delete(id);
}

// 定时扫描：每 200ms 把所有分析器问一遍"现在多大声"
//   ▎为什么是 200ms？——人说话的音节变化在 100ms 量级，200ms 足够跟上；
//     再快就是浪费 CPU（每次扫描要遍历 512 个采样点 × 人数）。
setInterval(() => {
  if (!audioCtx || audioCtx.state !== 'running') return; // 没跑起来就不算（安静）
  Object.keys(analysers).forEach((id) => {
    const a = analysers[id];
    try {
      a.analyser.getByteTimeDomainData(a.buf); // 波形快照：0~255，128 = 静音
      let sum = 0;
      for (let i = 0; i < a.buf.length; i++) {
        const v = (a.buf[i] - 128) / 128;      // 归一化到 -1 ~ +1
        sum += v * v;
      }
      const rms = Math.sqrt(sum / a.buf.length) * 255; // 均方根 → 0~255 的能量值
      applySpeaking(id, rms > SPEAK_RMS_THRESHOLD, rms);
    } catch (err) {
      // 单路出错（流被关了）只跳过这一路
    }
  });
}, 200);

// 把"是否在说话 + 音量"应用到 UI（视频框发光 + 音量条 + 成员列表高亮）
function applySpeaking(id, isSpeaking, rms) {
  const box = id === 'self' ? selfBox : (peers[id] && peers[id].box);
  if (box) {
    const bar = box.querySelector('.vol-bar > i');
    if (bar) bar.style.width = `${Math.min(100, Math.round((rms / 60) * 100))}%`; // 60 左右就算"满格"
    box.classList.toggle('speaking', isSpeaking);
  }
  const wasSpeaking = speakingSet.has(id);
  if (isSpeaking === wasSpeaking) return;  // 状态没变 → 不重绘列表（省 DOM 操作）
  if (isSpeaking) speakingSet.add(id); else speakingSet.delete(id);
  renderMemberList(); // 成员列表的说话高亮与视频框同源（同一个判定）
}

/* ──────────────────────────────────────────────────────────────
 * 第 24 步：⭐ 升级 D3 —— 设备切换（replaceTrack，不重新协商）
 *
 * ▎和第 5.5 步（屏幕共享）是**同一套原理**：
 *   换"发什么内容/从哪个设备发"，不需要重新走 offer/answer——
 *   找到那条 pc 上对应的 RTCRtpSender，`sender.replaceTrack(新轨)` 即可。
 *   ▎为什么 replaceTrack 不用重新协商？
 *     因为协商（SDP）确定的是"这条连接传几种媒体、什么编码"，
 *     而"轨道来自哪个摄像头"对**连接本身**是透明的——
 *     编码参数不变、中间那些转发节点（真实产品里的 SFU）也完全无感。
 *     这是 WebRTC 里最优雅的一个 API，面试必问。
 *
 * ▎两个细节坑：
 *   ① enumerateDevices() 的 label（设备名）**只有拿到权限后才有值**——
 *      所以必须在 getUserMedia 成功之后再列设备，否则下拉框里全是空白的"摄像头 1/2/3"；
 *   ② 正在共享屏幕时切摄像头：不能把屏幕轨换掉（用户还在共享），
 *      只需更新 cameraTrack（停止共享时自然切到新摄像头）。
 * ────────────────────────────────────────────────────────────── */

let camDeviceId = null; // 当前使用的摄像头 deviceId
let micDeviceId = null; // 当前使用的麦克风 deviceId

// 列出所有设备填进两个下拉框（有权限后 label 才有值，见本步注释 ①）
async function loadDevices() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      log('⚠️ 本浏览器不支持 enumerateDevices，设备切换已降级关闭');
      return;
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    fillDeviceSelect(camSelect, devices.filter((d) => d.kind === 'videoinput'), camDeviceId, '摄像头');
    fillDeviceSelect(micSelect, devices.filter((d) => d.kind === 'audioinput'), micDeviceId, '麦克风');
    // 第一次填充时，把"当前实际在用的设备"选中（localStream 里那条轨的 deviceId）
    if (!camDeviceId && localStream && localStream.getVideoTracks()[0]) {
      const s = localStream.getVideoTracks()[0].getSettings ? localStream.getVideoTracks()[0].getSettings() : {};
      if (s.deviceId) { camDeviceId = s.deviceId; camSelect.value = s.deviceId; }
    }
    if (!micDeviceId && localStream && localStream.getAudioTracks()[0]) {
      const s = localStream.getAudioTracks()[0].getSettings ? localStream.getAudioTracks()[0].getSettings() : {};
      if (s.deviceId) { micDeviceId = s.deviceId; micSelect.value = s.deviceId; }
    }
  } catch (err) {
    log(`⚠️ 枚举设备失败：${err.name}（设备切换不可用，其他功能不受影响）`);
  }
}

// 把一个 <select> 填满（全部用 textContent/DOM API，绝不 innerHTML 拼设备名）
function fillDeviceSelect(selectEl, list, currentId, fallbackName) {
  if (!selectEl) return;
  selectEl.textContent = '';
  if (list.length === 0) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = `没有可用的${fallbackName}`;
    selectEl.appendChild(o);
    selectEl.disabled = true;
    return;
  }
  list.forEach((d, i) => {
    const o = document.createElement('option');
    o.value = d.deviceId;
    // label 为空说明还没授权（浏览器出于隐私不给名字），退化成序号
    o.textContent = d.label || `${fallbackName} ${i + 1}（未授权时无名）`;
    selectEl.appendChild(o);
  });
  selectEl.disabled = false;
  if (currentId) selectEl.value = currentId;
}

// 换设备主体：拿新轨 → 对每条 pc 的 sender replaceTrack → 更新本地预览和 localStream
async function switchDevice(kind, deviceId) {
  if (!localStream || !deviceId) return;
  const constraints = kind === 'video'
    ? { video: { deviceId: { exact: deviceId } }, audio: false }
    : { video: false, audio: { deviceId: { exact: deviceId } } };
  log(`🔀 正在切换${kind === 'video' ? '摄像头' : '麦克风'}...`);
  try {
    const newStream = await navigator.mediaDevices.getUserMedia(constraints);
    const newTrack = kind === 'video' ? newStream.getVideoTracks()[0] : newStream.getAudioTracks()[0];
    if (!newTrack) throw new Error('没拿到新设备的轨道');
    const oldTrack = kind === 'video' ? localStream.getVideoTracks()[0] : localStream.getAudioTracks()[0];

    if (kind === 'video' && sharingScreen) {
      // 共享中：不能动 sender（那会把屏幕换成摄像头），只更新"待用"的摄像头轨
      log('🖥️ 正在共享屏幕，新摄像头轨先存起来，停止共享后自动生效');
    } else {
      replaceTrackOnAll(kind, newTrack); // ★ 核心：换轨不重连（和第 5.5 步同一招）
    }

    // 更新本地流与预览：MediaStream 是"轨道容器"，换轨要 removeTrack + addTrack
    if (oldTrack) { localStream.removeTrack(oldTrack); oldTrack.stop(); } // 旧轨必须 stop，否则摄像头灯不灭
    localStream.addTrack(newTrack);
    if (kind === 'video') {
      cameraTrack = newTrack;                    // 共享结束后要换回"当前摄像头"
      if (!sharingScreen) localVideo.srcObject = localStream;
    } else {
      // 音频轨换了 → 音量分析器要重挂（MediaStreamSource 绑定的是创建时的那条轨）
      detachAnalyser('self');
      attachAnalyser('self', localStream, selfBox);
    }
    log(`✅ 已切换到新的${kind === 'video' ? '摄像头' : '麦克风'}（replaceTrack，未重新协商）`);
    showToast(`✅ 已切换${kind === 'video' ? '摄像头' : '麦克风'}`);
  } catch (err) {
    log(`❌ 切换设备失败：${err.name}（${err.message}）`);
    showToast('❌ 切换设备失败，请检查设备是否被占用', 'error');
    loadDevices(); // 拉回真实设备列表，别让下拉框停在错误的选择上
  }
}

// 对每条 P2P 连接，把某种媒体（audio/video）的 sender 换成新轨
function replaceTrackOnAll(kind, track) {
  Object.values(peers).forEach((peer) => {
    const sender = peer.pc.getSenders().find((s) => s.track && s.track.kind === kind);
    if (sender) sender.replaceTrack(track); // 换轨！不重新协商、不断流
  });
}

camSelect.addEventListener('change', () => { camDeviceId = camSelect.value; switchDevice('video', camDeviceId); });
micSelect.addEventListener('change', () => { micDeviceId = micSelect.value; switchDevice('audio', micDeviceId); });

// 插拔设备（插上 USB 摄像头/拔掉耳机）时刷新列表
try {
  if (navigator.mediaDevices) {
    navigator.mediaDevices.ondevicechange = () => {
      log('🔌 检测到设备变化，正在刷新设备列表...');
      loadDevices();
    };
  }
} catch (err) { /* 不支持就算了，不影响其他功能 */ }

/* ──────────────────────────────────────────────────────────────
 * 第 25 步：⭐ 成员列表（轻量版）
 *
 * ▎为什么"不需要服务器新事件"？
 *   列表要的数据都是**本地已有的**：
 *     我自己 → socket.id（连接时就有）
 *     其他人 → peers 字典里的 key（第 6 步建的）
 *   而 peers 的增删本来就被 room-members / new-member / peer-left 驱动着。
 *   所以成员列表只是 peers 字典的**一个视图**——不新增任何信令，
 *   这也是"先想清楚数据从哪来，再决定要不要加协议"的好例子。
 *
 * ▎全部用 textContent 建 DOM：成员 id 来自服务器（可信任度也当不可信处理），
 *   一开始就养成"插 DOM 只用 textContent"的习惯，XSS 就无从下手。
 * ────────────────────────────────────────────────────────────── */

let rcStateIds = { hostId: null, controllerId: null }; // 由 remote-state 广播维护的"谁控谁"

function renderMemberList() {
  if (!memberListEl) return;
  memberListEl.textContent = '';                        // 重建式更新：最不容易漏（列表很小，代价可忽略）
  const total = 1 + Object.keys(peers).length;
  memberCount2.textContent = `${total} 人`;

  // 我自己：🎤/🔇 跟着本地音频轨的 enabled 走（点「静音」按钮后立刻反映）
  const myAudio = localStream ? localStream.getAudioTracks()[0] : null;
  memberListEl.appendChild(memberRow(
    socket.id || '我', true, !myAudio || !myAudio.enabled, speakingSet.has('self'),
    rcStateIds.hostId === socket.id ? '被控制中' : rcStateIds.controllerId === socket.id ? '控制中' : ''
  ));

  // 其他成员
  Object.keys(peers).forEach((id) => {
    memberListEl.appendChild(memberRow(
      id, false, false, speakingSet.has(id),
      rcStateIds.hostId === id ? '被控制中' : rcStateIds.controllerId === id ? '控制中' : ''
    ));
  });
}

// 造一行成员（isMe / 是否静音 / 是否在说话 / 角色角标文字）
function memberRow(id, isMe, muted, speaking, roleText) {
  const row = document.createElement('div');
  row.className = 'member-item' + (isMe ? ' me' : '') + (speaking ? ' speaking' : '');
  const icon = document.createElement('span');
  icon.textContent = muted ? '🔇' : '🎤';
  const name = document.createElement('span');
  name.className = 'm-id';
  name.textContent = (isMe ? '我（' : '') + shortId(id) + (isMe ? '）' : '');
  row.appendChild(icon);
  row.appendChild(name);
  if (roleText) {
    const r = document.createElement('span');
    r.className = 'm-role';
    r.textContent = roleText;
    row.appendChild(r);
  }
  return row;
}

/* ──────────────────────────────────────────────────────────────
 * 启动：页面一加载就打开摄像头
 * ────────────────────────────────────────────────────────────── */
renderMemberList(); // 先把成员列表画出来（此时只有我自己一行）
startLocalMedia();
