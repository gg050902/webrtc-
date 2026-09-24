// ════════════════════════════════════════════════════════════════
// sfu/protocol.js —— SFU 版信令事件总表（改 server.js / client.js 前先看这份）
//
// ▎和 Mesh 版最大的区别：
//   Mesh 版靠 offer / answer / ice-candidate 让"浏览器 ↔ 浏览器"直接协商；
//   SFU 版媒体全部"浏览器 ↔ 服务器"，所以协商变成下面这套请求-应答。
//
// ▎两种消息格式：
//   1) 请求-应答（一问一答）：客户端 emit(事件, 数据, 回调)，
//      服务器处理完调用 回调({ data }) 或 回调({ error })。
//   2) 广播（服务器主动推）：服务器 io.to(房间).emit(事件, 数据)。
// ════════════════════════════════════════════════════════════════

module.exports = {
  /* ── ★ 09-16 基础功能补全：登录/注册（零依赖用户体系）──
   * ▎存储：sfu/users.json（scrypt 哈希+盐，绝不存明文密码）；token 在内存 Map（重启失效
   *   是教学取舍，真实产品用数据库+长期 refreshToken）。身份绑在 socket 连接上——
   *   之后的聊天广播/成员快照自动带昵称，不用每条消息自带身份（服务端会话的意义）。
   * ▎昵称贯通：room-state members[].name、chat-message name、SCTP 聊天消息 name；
   *   未登录（游客）为 null/undefined → 前端回退"成员 xxxx"。 */
  AUTH_REGISTER: 'auth-register', // C→S { username, password, displayName? } 应答 { user:{username,displayName}, token }
  AUTH_LOGIN: 'auth-login',       // C→S { username, password } 应答 { user, token }（错误统一"用户名或密码不对"）
  AUTH_VERIFY: 'auth-verify',     // C→S { username, token } 应答 { user }（localStorage 存档自动恢复登录态）

  /* ── 房间（与 Mesh 版一致，沿用语义） ─────────────────────── */
  CREATE_ROOM: 'create-room',           // C→S 可带 { password }；应答 { roomNumber }
  JOIN_ROOM: 'join-room',               // C→S { roomNumber, password }；应答 { roomNumber }
  ROOM_CREATED: 'room-created',         // S→C { roomNumber }（服务器先广播，再应答）
  ROOM_NOT_FOUND: 'room-not-found',     // S→C { roomNumber }
  ROOM_WRONG_PASSWORD: 'room-wrong-password', // S→C { roomNumber }
  ROOM_FULL: 'room-full',               // S→C { max }
  ROOM_MEMBERS: 'room-members',         // S→C { roomNumber, members:[{id, producers:[{producerId,kind,appData}]}] }
  NEW_MEMBER: 'new-member',             // S→C 广播 { id }
  PEER_LEFT: 'peer-left',               // S→C 广播 { id }

  /* ── ★ D4 升级（2026-09-11）：房间成员状态机（成员列表 / 静音态 / 踢人）────
   * ▎为什么要服务器管成员状态？"谁在房间里、谁静音、谁在共享"是**全房一致**的信息，
   *   必须由唯一权威（服务器）持有并广播；每个浏览器各算一份必然对不上。
   * ▎和 room-members 的分工：room-members 只在"我进房那一刻"发一次（带我该订阅的 Producer 清单）；
   *   room-state 是**每次变化都全房广播的快照**（进/退/静音/开关摄像头/共享/被踢）。 */
  MEMBER_STATE: 'member-state',  // C→S { patch:{ muted?, camOff?, sharing?, hand? } }（hand=举手，★ 09-13 F4 白名单新增）
  ROOM_STATE: 'room-state',      // S→C 全房广播 { roomNumber, members:[{id,owner,muted,camOff,sharing,hand}], hostId, controllerId, expiresAt }
  KICK_MEMBER: 'kick-member',    // C→S { to }（仅房主可用）→ 服务器踢人
  KICKED: 'kicked',              // S→C 定向 { by, reason }（你被房主移出房间）

  /* ── ★ D2 升级（2026-09-11）：服务器端说话人检测（mediasoup AudioLevelObserver）────
   * ▎Mesh 版做不到这个：没有服务器，只能在每个浏览器里各算各的音量（client-side analyser）。
   *   SFU 版可以让 mediasoup 直接在服务器上量每一路音频的能量——
   *   一份数据、全房一致、还不占客户端 CPU（面试讲点：SFU 天然是"全房状态"的权威）。
   * ▎volume 单位 dB（-127~0），threshold 由房间的 Observer 决定（本 Demo -55dB）。 */
  AUDIO_LEVELS: 'audio-levels',  // S→C 广播 { levels:[{id, volume}], top }（top = 当前最大声的人；silence 时 levels=[] top=null）

  /* ── ★ D1 升级（2026-09-11）：Simulcast 分层 + 消费者选层（SFU 深水区）────
   * ▎背景：Producer 上传时用 simulcast 同时发"低/中/高三档"（encodings 里三个 rid），
   *   服务器按订阅者的网络质量只转发其中一层（setPreferredLayers）——
   *   这就是腾讯会议"弱网自动糊一点但不卡"的实现骨架。
   * ▎谁来决定层？本 Demo 让**服务器**读 consumer.getStats()（丢包率）自动升降层（权威且统一），
   *   同时允许客户端手动指定（教学演示用）。 */
  SET_PREFERRED_LAYERS: 'set-preferred-layers', // C→S { consumerId, spatialLayer }（null = 交回服务器自动）
  LAYER_CHANGED: 'layer-changed',               // S→C 定向 { consumerId, producerId, spatialLayer, layerCount, auto, reason }

  /* ── ★ A3 升级（2026-09-11）：剪贴板同步（双向，仍受控制关系门禁约束）────
   * ▎为什么单独一个事件、不复用 remote-input？因为剪贴板是**双向**的：
   *   控制端 → 被控端（粘贴本机剪贴板到对方工作台）、被控端 → 控制端（把工作台里的内容带回本机）。
   *   而 remote-input 的门禁是单向的（只放行在册控制端），反向会被拦。
   * ▎门禁规则：只有"正在互相控制的那一对"能互发剪贴板，其他人一律丢弃。 */
  CLIPBOARD_SYNC: 'clipboard-sync', // C→S { to, text }；S→C 定向 { from, text }

  /* ── ★ A4 升级（2026-09-11）：文件传输（服务器定向分块中继）────
   * ▎为什么 SFU 版不走 DataChannel？mediasoup 确实有 DataProducer/DataConsumer（SCTP 数据通道），
   *   但它是**广播**语义（一路 DataProducer 全房都能收），要"发给某个人"得在应用层加目标头；
   *   而信令通道是**定向**的、还能顺手做配额校验，教学演示更快到位。
   *   取舍写在这里，面试可讲："数据通道广播 vs 信令定向 + 为什么真产品用对象存储"。
   * ▎服务器做两件事：定向转发 + **配额校验**（收到的字节数不得超过 offer 里报的 size，
   *   防止有人借文件传输灌流量）。 */
  FILE_OFFER: 'file-offer',   // C→S { to, fileId, name, size, mime }；S→C 定向 { from, fileId, name, size, mime }
  FILE_ANSWER: 'file-answer', // C→S { to, fileId, ok }；S→C 定向 { from, fileId, ok }
  FILE_CHUNK: 'file-chunk',   // C→S { to, fileId, seq, data:ArrayBuffer }；S→C 定向 { from, fileId, seq, data }
  FILE_END: 'file-end',       // C→S { to, fileId }；S→C 定向 { from, fileId, received }
  FILE_ABORT: 'file-abort',   // C→S/S→C { to, fileId, reason }（拒绝 / 超配额 / 取消）

  /* ── 媒体协商（SFU 新增，全部走"请求-应答"） ──────────────── */
  GET_RTP_CAPABILITIES: 'get-router-rtp-capabilities', // C→S 应答 { rtpCapabilities }
  CREATE_TRANSPORT: 'create-webrtc-transport',         // C→S { direction:'send'|'recv' } 应答 { transportId, iceParameters, iceCandidates, dtlsParameters, sctpParameters (★ D+1) }
  TRANSPORT_CONNECT: 'transport-connect',              // C→S { transportId, dtlsParameters }（DTLS 握手）
  PRODUCE: 'produce',             // C→S { transportId, kind, rtpParameters, appData } 应答 { producerId }
  CLOSE_PRODUCER: 'close-producer', // C→S { producerId }（如停止共享屏幕）
  CONSUME: 'consume',             // C→S { transportId, producerId, rtpCapabilities } 应答 { consumerId, producerId, kind, rtpParameters, appData }

  /* ── 媒体事件（服务器主动广播） ───────────────────────────── */
  NEW_PRODUCER: 'new-producer',   // S→C 广播 { producerId, kind, appData, from }
  PRODUCER_CLOSED: 'producer-closed', // S→C 广播 { producerId, from }
  CONSUMER_CLOSED: 'consumer-closed', // S→C 定向 { consumerId, producerId }（我订阅的那路被关了）

  /* ── 聊天（SFU 版：★ D+1 起双路径 = SCTP 数据通道主路 + 本信令兜底，前端按 msgId 去重）── */
  CHAT_MESSAGE: 'chat-message',   // C→S { text, msgId? }；S→C 广播 { from, text, ts, msgId? }

  /* ── ★ D+1 升级（2026-09-12）：SFU 数据通道（SCTP DataProducer/DataConsumer）────
   * ▎这是"聊天/文件走信令"这一教学妥协的正统升级：房间内广播消息改走媒体连接里的
   *   SCTP 数据通道（和音视频同一条 DTLS/ICE 链路，服务器只做 mediasoup 转发、
   *   不占信令带宽）。第一个应用 = 聊天主路（信令 CHAT_MESSAGE 保留为兜底，双发去重）。
   * ▎与媒体协商事件一一对应：produce→produce-data、consume→consume-data、
   *   new-producer→new-data-producer、producer-closed→data-producer-closed。
   *   ⚠️ 客户端事件名是 'producedata'（完整词）——曾错写成 'procedata' 导致
   *   "no producedata listener" 报错（09-14 实修）。
   * ▎语义注意：mediasoup 数据通道是**广播**的——一个人 produceData，全房订阅者都收得到；
   *   "只发给某人"要在应用层给消息加 to 字段自己过滤（A4 文件传输若迁移即是如此，
   *   但信令版保留：定向转发 + 配额校验在服务器侧更顺手，取舍见 A4 注释）。
   * ▎传输前提：create-webrtc-transport 已开 enableSctp（应答多带 sctpParameters，
   *   浏览器 createSendTransport/createRecvTransport 必须原样带上）。 */
  PRODUCE_DATA: 'produce-data',         // C→S { transportId, sctpStreamParameters, label, appData } 应答 { dataProducerId }
  CONSUME_DATA: 'consume-data',         // C→S { transportId, dataProducerId } 应答 { dataConsumerId, dataProducerId, label, protocol, sctpStreamParameters }
  CLOSE_DATA_PRODUCER: 'close-data-producer', // C→S { dataProducerId }（关掉我的广播频道）
  NEW_DATA_PRODUCER: 'new-data-producer',     // S→C 广播 { dataProducerId, label, from }（"我开了频道，快来订阅"）
  DATA_PRODUCER_CLOSED: 'data-producer-closed', // S→C 广播 { dataProducerId, from }（频道关了，退订）

  /* ── 远程协助（后续升级方向 A1：SFU 版同款 H5 远程协助）
   * ▎和 Mesh 版的本质区别（面试考点）：Mesh 的鼠标键盘走 P2P ctrl_ DataChannel；
   *   SFU 的浏览器之间没有 P2P 连接，控制输入也走服务器定向转发（remote-input）。
   *   服务器还顺势多了一道"输入门禁"：只有登记在册的控制端才转发。 ── */
  REMOTE_REQUEST: 'remote-request', // C→S { to }；S→C 定向 { from }；忙时回申请者 remote-answer { ok:false, reason:'busy' }
  REMOTE_ANSWER: 'remote-answer',   // C→S { to, ok, reason }；S→C 定向 { from, ok, reason }（denied/busy/not-sharing）
  REMOTE_STATE: 'remote-state',     // S→C 全房广播 { hostId, controllerId|null, expiresAt|null }（null = 无人被控）
  REMOTE_RELEASE: 'remote-release', // C→S {}（被控端收回 / 控制端放弃）
  // ★ A6 升级（2026-09-11）：授权可以"限时"。被控端在授权卡片上选 60s/5min/不限，
  //   remote-answer 带上 durationMs；服务器把 expiresAt 记进 remoteCtl，
  //   到点自动清表并再广播一次 remote-state（前端据此收起控制层/工作台状态）。
  //   附带 remote-ended 事件把"为什么结束"告诉当事双方（自己收回 / 超时）。
  REMOTE_ENDED: 'remote-ended',     // S→C 定向 { reason:'expired'|'released'|'peer-left', hostId, controllerId }
  // A2/A5 升级后 event 的三种形态（服务器只认"在册控制端"，不解析内容，原样透传）：
  //   · 普通对象：键盘 { type:'input', kind:'keydown'|'keyup', key, code, ...修饰键 }
  //              中文整段 { type:'input', kind:'input-text', text }（A2，compositionend 的最终文本，
  //              kind 名沿用规划 4.3 的预留位）
  //   · ArrayBuffer：16 字节定长鼠标/滚轮帧（A5①）——socket.io 当二进制附件搬运，
  //     到服务器变 Node Buffer（Object.keys 会数出 16 个下标，轻量过滤必须放行二进制），
  //     到浏览器端还原成 ArrayBuffer，解码见 sfu/public/client.js 的 decodeCtlFrame。
  //   帧布局：[0]kind [1]flags [2..3]预留 [4..7]x(F32) [8..11]y(F32) [12..15]wheel(I32)
  REMOTE_INPUT: 'remote-input',     // C→S { to, event }；S→C 定向 { event }（服务器校验"我正在控制 to"才转发）

  /* ── ★ F2 升级（2026-09-12）：每成员网络质量广播 ──
   * ▎数据源：服务器每 3 秒对房间每个成员"正在订阅的每路 Consumer"调一次 getStats()，
   *   取最差丢包率映射等级（<1% 好 / <5% 中 / 其余差），**有变化才广播**（省信令）。
   * ▎信任模型和 D1 选层一致：网络好不好由服务器量，不听客户端自报；
   *   和 D2 说话人检测同理——"全房都要显示的信息"放中心点算一份最省。
   * ▎等级含义：0=良好(绿●) 1=一般(黄●) 2=较差(红●) null=暂无数据（还没收过媒体包，灰○）。 */
  NET_LEVELS: 'net-levels', // S→C 广播 { levels: {[id]:0|1|2|null}, bwe:{[id]:bps|null} }
  //   ★ D+3（09-14）：payload 增加 bwe —— 服务器侧 transport-cc 对每人下行的带宽估计
  //   （availableOutgoingBitrate，bps；没有估计值=null）。前端网络点悬浮提示展示，
  //   服务器选层监控同时用它做 bweCap 封顶（丢包 + 带宽双维度 ABR）。

  /* ── ★ 09-13 升级："真实有用"三件套（F4 表情回应 / 举手 / 发言占比）──
   * ▎talk-stats：D2 说话人检测的"记账版"。AudioLevelObserver 每 400ms 报一次"谁在说话"，
   *   服务器顺手给每人记 0.4 秒账；与 net-levels 同一条 3s 心跳**有变化才广播**。
   *   前端画成成员行的占比细条——"谁主导了这场会"一眼可见（会议复盘的真实需求）。 */
  TALK_STATS: 'talk-stats',      // S→C 广播 { stats: [{ id, sec, share }] }（sec=累计发言秒数，share=百分比）

  /* ── ★ 09-13 观测面板（可观测性）──
   * ▎不是 socket 信令，是普通 HTTP：GET /api/rooms 返回全景快照 JSON
   *   （房间/成员/每路 Producer 的累计字节与健康分/发言时长/控制权/Worker PID），
   *   GET /dashboard 是吃这份 JSON 的零依赖面板页（2 秒轮询，页面自己算码率）。
   * ▎字节计数是累计值——和浏览器 getStats 一个哲学：服务器给真相，展示层做差。 */
  // GET /api/rooms → { now, worker:{pid}, rooms:[{ roomNumber, createdAt, durationSec,
  //                    members:[{id,shortId,owner,muted,camOff,sharing,hand,talkSec,consumers,transports}],
  //                    media:[{producerId,kind,source,owner,byteCount,score,layers}],
  //                    counts:{members,producers,consumers}, control:{hostId,controllerId} }] }
  // GET /dashboard  → 面板页（sfu/public/dashboard.html）
  // GET /config.json → { iceServers }（★ 可达性：config.json 里的 STUN/TURN 下发给浏览器）

  /* ── ★ 09-17e 值守归档（C3-N1 过夜值守 ≥7h，前端第 30 步）──
   * ▎字幕账本的"服务器权威副本"：浏览器内存只留最近 500 条（环形），溢出旧段攒批走这里落盘。
   *   POST /api/captions  body { room, entries:[{ts,from,name,text}] } → { saved:n }
   *     → append 到 sfu/captions/cap-<房间号>-<UTC日期>.jsonl（每行一条 JSON；房间号 6 位白名单）
   *   GET  /api/captions?room=130525&format=txt|json → 全档回读（跨文件按 ts 排序）
   *     （txt 给前端「⬇ 记录」合并导出；json 给将来 G2 的 LLM 纪要吃） */

  /* ── ★ 09-13 数据通道上的消息分家（应用层，非信令）──
   *   { type:'chat', msgId, text } 聊天（第 11 步）
   *   { type:'react', msgId, emoji } 表情回应（第 26b 步，全房飞屏）
   * ▎D+1 数据通道是广播语义，"一类消息一个 type"就是它上的"频道"。 */
  /* ── ★ 09-14 数据通道消息 v2：升级为**两条 SCTP 流并存**（多频道）──
   * ▎D+1 起是一条 'chat' 频道按 type 分家；09-14 起聊天/回应之外新增**专用 'annot' 频道**
   *   （F5 协作批注）：聊天刷屏不会挤掉批注笔迹，mediasoup 的 numSctpStreams 正是为此设计。
   *   频道 'chat'（label:'chat'）：
   *     { type:'chat',  msgId, text }   聊天（第 11 步，双路径 + msgId 去重）
   *     { type:'react', msgId, emoji }  表情回应（第 26b 步，全房飞屏）
   *   频道 'annot'（label:'annot'，第 26c 步）：
   *     { type:'annot', msgId, to, op, x?, y?, color }
   *       to    = 定向头：屏幕归属者 socketId（mediasoup 广播，应用层过滤——只画
   *               "我有他的屏幕格"的那条；这是"广播语义下做定向"的标准答案）
   *       op    = 'start'|'draw'|'end'|'undo'|'clear'（增量事件，各端用同一个
   *               applyAnnotOp 重放出完整画面 = 事件溯源；坐标 0~1 归一化，窗口无关）
   *       color = 笔迹颜色（= 谁画的，colorFor(id) 从成员 id 稳定算出）
   *   频道 'board'（label:'board'，★ 09-15 F7 独立协作白板，第 26d 步）：
   *     { type:'board', msgId, op:'start|draw|end|undo|clear', x, y, color }
   *     与批注同一套事件溯源模型，但**没有 to 定向头**——白板是房间级共享画布，
   *     全场一份、人人可画（批注跟着某块屏幕走、白板独立存在，语义不同频道不同）。
   *     浅底月白 → 笔迹用深色系 BOARD_COLORS（与批注的亮色板区分）。
   * ▎订阅端按 DataConsumer.label 路由：'annot'→handleAnnotMessage、
   *   'board'→handleBoardMessage、其余（'chat'）→ handleDataMessage。 */
  DATA_REACT: '(data) react', // 占位说明条目：表情回应走 'chat' 频道；批注走 'annot' 频道，均不走信令

  /* ── ★ 09-14 带宽估计可视化（D+3 前置）──
   *   浏览器 getStats 的 selected candidate-pair 上有 availableOutgoing/IncomingBitrate
   *   （transport-cc/REMB 的输出）——client 第 13 步读出后挂进「🔗 连接方式」徽标的悬浮提示
   *   （"可用带宽估计 ≈ X Mbps"）。先看得见，下一步才能让服务器据此选层（D+3）。 */
  DATA_BWE: '(getStats) availableBitrate', // 占位说明条目：带宽估计走浏览器统计，不走信令

  /* ── ★ D+2 升级（2026-09-15）：服务器侧录制（浏览器录制 D5 的"真产品"对照）──
   * ▎record-start { memberId } → { recordId }；record-stop { recordId } → { file }。
   *   服务器对该成员的 camera/mic 各建一条 PlainTransport（纯 RTP 旁路，connect 到本机
   *   ffmpeg 的端口对 50000+），consume+resume 后生成 SDP 喂给 ffmpeg（-c copy 无重编码）
   *   → recordings/ 落盘（webm；H264 落 mkv）。产物经 GET /recordings/<file> 下载。
   * ▎ffmpeg 是外部依赖：启动时探测，未安装时 record-start 返回明确安装提示。
   * ▎对比 D5 浏览器录制：D5 录"合成画面"，掉线就断；服务器录制与浏览器无关——
   *   "谁掉线都不影响"正是真实产品把录制放服务器的原因（面试讲点）。 */
  RECORD_START: 'record-start', // C→S { memberId } 应答 { recordId }；错误路径：未装 ffmpeg / 成员无媒体
  RECORD_STOP: 'record-stop',   // C→S { recordId } 应答 { file }

  /* ── ★ 09-14 D+3：config.json 新增 videoSvc（VP9 SVC 开关）──
   *   videoSvc:false（默认）= 摄像头 simulcast 三路独立编码（q/h/f）；
   *   videoSvc:true = 摄像头改用 VP9 SVC L3T3 单路分层（Router 已加 VP9 编解码，
   *   协商失败自动回退 simulcast→单层）。经 /config.json 下发，client 第 7 步消费。 */
  /* ── ★ 09-13 可达性（E1/E2 自助版）：config.json ──
   *   sfu/config.json（可选）统一管：port/maxMembers/listenIp/announcedIp/rtcMin~MaxPort/
   *   iceServers（STUN/TURN，经 /config.json 下发到两条 Transport 的底层 PC）/
   *   https:{enabled,port,cert,key,autoSelfSigned}（自动起 HTTPS+wss，证书缺失时
   *   用 openssl 现场自签）。部署步骤见 README「跨网络部署」。 */

  /* ══ ★ 09-24 AI 会议助理（第四类：AI 信令 + 统一 Provider 契约）══
   * ▎AI_JOIN / AI_LEAVE：任何成员都能邀请/送走 AI 助理（教学版权限从宽，G6 分级可收紧）；
   *   bot 在 room-state 里以 `isBot:true` 的虚拟成员出现（无 socket、无媒体、只"听"）。
   * ▎AI_ASK：向助理提问。回执**先**给 `{ started, streamId }`（前端立刻立"思考中"气泡），
   *   随后两路下发：① `ai-stream` 增量（SSE 逐段，打字机手感，可被丢弃）；
   *   ② 终态 `chat-message`（带同一个 streamId 与 `ai:{mock,tokens}`，**去重 + 兜底**——
   *   中途进房或丢过流事件的人靠它拿到完整答案）。这也呼应全项目的双路哲学：
   *   字幕"容忍丢"（无兜底）、问答"不容忍丢"（必然兜底）。
   *   ★ 助理缺位时自动邀请入会（不等成员先点按钮）——少一步仪式感，多一分像助手。
   * ▎AI_MINUTES：把该房间的字幕账本合成 markdown 纪要，落 sfu/minutes/<房间>/，
   *   应答 `{ file, path, mock }`；经 GET /minutes/<房间>/<file> 下载（双白名单防穿越）。
   *   触发三处：手动、值守定时器分段（每 config.minutesIntervalSec）、助理送走/房间销毁终稿。
   * ▎AI_OP：C1 AI 远程操作员——服务器自己开一条 socket.io 客户端连上来，走与人类完全相同的
   *   remote-request → 授权卡 → remote-input 门禁 → remote-release。**授权绝不豁免**。
   * ▎AI 双轨契约（全项目统一）：有 DEEPSEEK_API_KEY → 真模型；无 key / 超时 / 限流 →
   *   本地规则兜底，输出带 `[Mock]` 前缀。真相写在返回值的 `mock` 字段与 UI 徽标上，
   *   **不许假装自己是 LLM**。密钥永不下发到浏览器（/config.json 只有 aiEnabled 布尔值）。 */
  AI_JOIN: 'ai-join',     // C→S {} 应答 { aiBot }
  AI_LEAVE: 'ai-leave',   // C→S {} 应答 { aiBot }
  AI_ASK: 'ai-ask',       // C→S { question } 应答 { started, streamId } → S→C ai-stream* + chat-message
  AI_STREAM: 'ai-stream', // S→C { id, delta, done, mock? }（流式增量；done=true 为收尾帧）
  AI_MINUTES: 'ai-minutes', // C→S { type:'segment'|'final', since? } 应答 { file, path, mock }
  AI_OP: 'ai-op',         // C→S { goal } 应答 { started, goal }（后续走既有远程协助五信令）
};
