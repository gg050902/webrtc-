# 🎥 會 · 基于 WebRTC 与 Mediasoup 的智能多人视频会议系统

> **毕业设计题目**：《基于 WebRTC 与 Mediasoup 的智能多人视频会议系统》
> （论文封面备选全称：《基于 WebRTC 与大语言模型的智能多人视频会议系统的设计与实现》；
> "智能"来自已落地的 AI 会议助理线：实时字幕 → 会议纪要 → @AI 问答 → AI 远程操作员）
>
> 一个**从零手写、带逐步教学**的视频会议项目：房间号创建/加入 + 多人实时音视频 + 屏幕共享 +
> 群聊 + **入会密码** + **网络质量监控**。
> 学完它，你能把 WebRTC 从信令到 P2P、从 Mesh 到 SFU（mediasoup 服务器转发）的整条链路**讲清楚、能过面试**。

> 目标：用一条**最简链路**（浏览器原生 WebRTC + Node.js/Socket.IO 信令 + mediasoup）跑通"像腾讯会议"的核心功能，
> 并把每一步代码用**中文教学注释**写清楚，让你既能跑也能讲。

> 🏗️ **版本定位（重要）**：本仓库以 **SFU 版为主版本**（`sfu/` 目录，端口 3001，mediasoup
> **服务器转发**，与腾讯会议同款架构，最多 8 人）；**Mesh 版**（根目录，端口 3000，浏览器
> P2P 直连，最多 3 人）是**教学对照/历史演进版**——它把"浏览器直连"讲明白后，才更容易理解
> SFU 为什么更接近真实产品。两个版本并存、互不干扰，别改混（见下文结构树）。

---

## 📦 想跨电脑连？几条路（详见《部署手册.md》《跨电脑连接-操作指南.md》）

| 场景 | 一句话 | 命令/入口 |
|---|---|---|
| 局域网两台电脑 | **0 元三步走**：服务器机复制邀请链接 → 微信发对方 → 打开即入房（《跨电脑连接-操作指南.md》） | `start-lan.bat` 或 `npm run start:lan` |
| 跨网络（不同 WiFi） | ★ 先认清一件事：**SFU 的媒体不经 TURN**（TURN 只救 Mesh 版的 P2P），所以"别人进不来"的决定因素是**服务器自己被不被连得上**——固定端口（UDP+TCP 同端口）+ 通告地址可达 + Tailscale 组网是零成本首选。先跑自检看这台缺哪一步 | `npm run test:crossnet`（本机入口是否具备）→ `npm run test:turn`（ICE 可达性）→《部署手册.md》B-1~B-4 |
| 公网云主机 | systemd 常驻 + 自建 coturn | 《部署手册.md》场景 C |
| **一键发布公网链接** | 一条命令：**生成发布包 → 体检 → 可选开隧道拿公网地址**（三段拆开，不装隧道工具也能跑完前两段） | `npm run publish:mesh`（可选 `--tunnel` / `--bundle` / `--check`） |
| **内网穿透（无公网 IP）** | cloudflared 隧道最推荐（免费免注册，`--tunnel` 会自动探测）；其次 ngrok / 云主机 | `npm run publish:mesh --tunnel`（需先装 cloudflared 或 ngrok） |

> ⚠️ **一句话记住边界**：隧道只解决"**网页能打开**"；音视频在 Mesh 版是 **P2P** 的，
> 两台不同网络的电脑要**真能开会，还得有 TURN**（发布脚本第 2 步会写进 `mesh.config.json` 并体检报警）。

## 🚀 功能一览（当前已完成 · 以 SFU 主版本为准）

> 🎨 **2026-09-14**：SFU 主版本前端已全量重构（应用壳布局 + 全新设计系统样式表，
> 参考 Radix/Primer 设计方法论）；Mesh 对照版保持原样（兼容优先）。

| 功能 | 说明 | 用的技术 |
|---|---|---|
| 🏢 房间化 | 创建房间生成 6 位房间号，凭号加入，邀请链接直达（?room=） | create-room / join-room + 房间号回收 |
| 🔒 入会密码 | 创建房间可设密码上锁，加入时密码对才放行 | 房间记录 password + join-room 三关校验 |
| 🎥 多人实时音视频 | 3~8 人，浏览器只连服务器、服务器选择性转发 | mediasoup SFU（Producer/Consumer） |
| 🖥️ 屏幕共享 | 一键把屏幕加为第二路 Producer，摄像头不中断 | getDisplayMedia + 再 produce 一路 |
| 💬 群聊 | 实时文字聊天（走服务器广播，方案 A） | Socket.IO `chat-message` |
| 📶 网络质量监控 | 顶部徽标实时显示丢包率/延迟/上下行码率，绿黄红分级 | Transport/Producer getStats() |
| 🖱️ H5 远程协助 | 共享屏幕者可授权他人遥控：控制端鼠标键盘实时作用到被控端工作台（画线/打字/拖球），全房可见"谁控谁"；支持**中文输入** | 授权四信令 + remote-input 定向转发（服务器门禁）+ 坐标归一化 + 事件重放 + 隐藏 IME 捕获框整段发文本（两版都有，形态见下注） |
| ⚡ 控制质量工程化 | 控制命令流量瘦身 + 弱网自适应：鼠标/滚轮走 16 字节二进制帧（省 80%+ 字节），按 getStats 的 RTT 自动降发送频率，Mesh 版另有通道积压丢帧 | ArrayBuffer/DataView 定长帧 + binaryType='arraybuffer' + RTT 自适应节流 + bufferedAmount 监控（A5，两版同构） |
| 📋 剪贴板双向同步 | 控制端 `Ctrl+V` 把本机剪贴板粘进对方工作台；被控端一键把剪贴板送回控制端；只有"正在互相控制的一对"能互发 | 独立双向事件 `clipboard-sync` + 控制关系门禁 + Clipboard API 权限兜底（A3） |
| 📎 远程截图 + 文件传输 | 控制端一键截图被控端屏幕（PNG 下载）；任意成员间可分块传文件（进度显示 + 接收方确认） | canvas 抓帧 + `file-offer/answer/chunk/end` 四步 + **服务器配额校验**（超申报大小即掐断）（A4） |
| 🔐 限时授权 + 审计 + 拉黑 | 授权可选 60 秒 / 5 分钟 / 不限，到点自动收回并显示倒计时；被控端本地记录每条控制操作（可导出 txt）；可把某人拉黑 | 服务器权威计时（`expiresAt` + setTimeout 撤权）+ 环形缓冲审计日志 + 本地黑名单（A6） |
| 👥 成员列表与房主踢人 | 右侧成员栏实时显示谁在房间、谁静音、谁在共享、谁在说话；房主可把成员移出房间 | 服务器 `room-state` 快照广播 + `member-state` 上报（白名单）+ `kick-member` 权限校验（D4） |
| 🎙️ 说话人指示器 | 谁在说话，他的画面格与成员行一起亮绿框 + 音量条 | **服务器端** mediasoup `AudioLevelObserver` 量 dB 音量 → 广播 `audio-levels`（D2，SFU 独有） |
| 🎚️ Simulcast 分层与选层 | 摄像头一次上传低/中/高三档，服务器按网络质量自动转发合适的层（弱网变糊但不卡），也可手动锁定画质层 | 三档 `encodings`(rid) + 服务器读 `consumer.getStats()` 丢包率自动升降层（迟滞防抖）+ `setPreferredLayers`（D1，SFU 独有） |
| 🎥 设备切换 / 会议录制 | 下拉框实时切换摄像头/麦克风（不重连）；一键录制"画面网格 + 混音"并下载 webm | `enumerateDevices` + `producer.replaceTrack`（D3）；canvas `captureStream` + WebAudio 混音 + `MediaRecorder`（D5） |
| 🔁 断线重连 | 网络抖动/服务器重启后自动回到房间并重建整条媒体链路，无需手动刷新 | socket.io 自动重连 → 重新 join-room → `resetMediaState()` → 重建 Device/Transport → 重新推拉流（D6） |
| ▦ 宫格/演讲者双布局 | 一键切换"所有人一样大"和"大画面 + 小格"两种视图；大画面自动跟随共享者与说话人，也可 📌 钉选固定某人；双击任意画面全屏 | 切布局只换容器 CSS 类 + `tile-main` 标记（JS 不搬 DOM，画面不闪黑）+ 原生 Fullscreen API（F1，SFU 主版本） |
| 🌐 每成员网络质量点 | 成员列表每人一个 ●：绿/黄/红指示对方网络，灰○=暂无数据；成员行同步出说话音量条 | 服务器每 3s 量每人 Consumer 丢包率 → `net-levels` **有变化才广播**（信任模型同 D1 选层）（F2，SFU 主版本） |
| 🎪 加入前预览页 | 进会先看镜像预览、选好摄像头/麦克风、试音条会动，可预勾"入会静音/关摄像头"；没摄像头也能进 | 预览与会议共用同一条 localStream + 复用 D3 设备切换 + AnalyserNode 峰值试音条（F3，SFU 主版本） |
| ✋ 举手 / 🎉 表情回应 | 举手后成员列表亮 ✋；点表情全房"飞屏"动画 | 举手 = `member-state` 白名单加 hand 字段；回应 = 骑在 D+1 SCTP 数据通道上的第二种消息 `{type:'react'}`（09-13，SFU 主版本） |
| 📊 发言占比条 | 成员列表每人一根占比细条，"谁主导了会议"一眼可见；观测面板同步展示 | D2 服务器说话人检测顺手记账（AudioLevelObserver 每 400ms 报一次 → 累计秒数）→ `talk-stats` 有变化才广播（09-13，SFU 主版本） |
| 📈 SFU 实时观测面板 | `/dashboard`：房间/成员/每路媒体实时码率与 mediasoup 健康分/发言占比/控制权，2 秒刷新 | 服务器 `GET /api/rooms` 全景快照 + 零依赖 canvas 折线（累计字节做差 = 实时码率）（09-13，SFU 主版本） |
| 🎚️ Simulcast/SVC 双策略 + 服务器侧 ABR | 摄像头默认三路 simulcast；config 开 `videoSvc` 改 VP9 SVC 单路分层（失败自动回退）；服务器选层 = **丢包率 + 带宽估计双维度**（网络点悬浮显示"下行带宽估计"） | Router 加 VP9 + `collectMemberNet` 并采两维 + `bweCap` 封顶选层（D+3，SFU 主版本） |
| 🖥️ 服务器侧录制（D+2） | 成员行 ⏺ 一键录"TA 的摄像头+麦克风"：服务器 PlainTransport RTP 旁路 → ffmpeg 无重编码落盘 → /recordings/ 下载（需服务器装 ffmpeg，未装走明确提示） | PlainTransport + SDP 生成 + `spawn ffmpeg -c copy`（D+2，SFU 主版本） |
| 🎨 传统色美学 | 黛/苍/竹青/月白低饱和色板 + 衬线中文标题 + 宽字距英文小帽 + 星云噪点氛围层（纯 CSS） | 学 zhongguose.com 与 alteredqualia 手法，收敛进设计 token（09-15） |
| ⏳ 房间 TTL 与房主迁移 | 人走光后房间保留 60s 宽限期（可配置），掉线重连不再 room-not-found；房主离开自动迁给最早进房者 | `scheduleRoomTtl`/`destroyRoom` + `joinedAt` 排序迁移（D+4，SFU 主版本） |
| 🎬 演示包 | `npm run start:demo` 一键起两版；5 分钟演示讲稿（含 Q&A） | scripts/start-demo.js + 《演示脚本-5分钟.md》（E5） |
| 👤 登录/注册 · **退出与身份可见**（第 52 步） | 用户名+密码注册登录（游客可进）；昵称贯通成员列表与聊天气泡，登录态自动恢复；★ 顶栏**身份牌**（未登录 / 成员 / 房主 / 平台管理员）+ 账号面板：**两步确认的退出登录**（四个落点一次清完，人仍留在会里）+「忘记密码？」给**两条真路**（本机 `npm run admin:passwd` / 找管理员，**不演"邮件已发送"**）+ admin 专属的**治理台四链接** | node:sqlite 账号库 `sfu/data/meeting.db` + 内置 scrypt 哈希（零依赖；09-24 由旧 users.json 自动迁移、原样保留 salt/hash）+ auth-register/login/verify 三信令 + token 存档（09-16，SFU 主版本；09-24 换存储） |
| 🛡️ 管理员门禁 · 观测类（09-24） | **甲类·观测**接口只对 admin 开放：`/api/rooms`（房间×成员×媒体字节×控制权全景）、`/metrics`（Prometheus 文本版）、`/api/recordings`（全服务器录像清单，跨房枚举）；带 token 两种方式——`Authorization: Bearer <token>`（脚本首选）/ `?token=<token>`（浏览器地址栏、`<video src>` 兜底，代价是 token 进 URL 历史与访问日志）；`/dashboard` 页面本身不设门禁（否则页面都打不开、没法提示去登录），它调的 `/api/rooms` 才受门禁 | 首个注册账号（或 `config.json` 的 adminUsername）自动成为 admin；token 里带 role；`scripts/watch.js`/`doctor.js`/`soak.js` 支持 `ADMIN_TOKEN` 环境变量（09-24，SFU 主版本） |
| 🔐 内容类接口 · 房间内令牌 + 录像签名 URL（09-24） | **乙类·内容**不再靠"能力 = 房间号"裸奔：进房成功时给**本人**签发一张**无状态 HMAC 房间令牌**（`base64url(JSON{room,iat,exp}) + "." + base64url(hmacSHA256(payloadB64, SECRET))`），`/api/captions`（字幕归档 POST/GET）、`/api/minutes` + `/minutes/<6位房号>/<文件名>.md`（纪要列表与正文）校验它（`X-Room-Token` 头首选 / `?roomToken=` 兜底）；`/recordings/<文件名>`（单个录像）改用 **admin 或短时效签名 URL**（`signRecordingUrl`，默认 1 小时）。令牌发给**本人**、存在 **socket 上**（非成员对象）、成员列表是**显式投影**，故绝不会广播他人令牌；**游客也有令牌**（否则游客字幕归档会静默失效） | SECRET 持久化在 `sfu/data/room-secret`（已 gitignore），首次运行自动生成；TTL 默认 **86400s/24h**（`roomTokenTtlSec` / `ROOM_TOKEN_TTL_SEC`）；逃逸开关 `roomTokenRequired`（默认 `true`，设 `false` 退回旧"开放"行为，供教学对比）；诚实边界：仍是 **Bearer 语义**（不绑成员/IP）、与录像签名**共用同一把 SECRET**、Windows 上 `chmod 600` 不生效（靠目录 ACL）（09-24，SFU 主版本） |
| 🗄️ 账号存储 · node:sqlite（09-24） | 账号从 JSON 文件换成 **Node 内置 `node:sqlite`**（**零新依赖**）：库文件优先级 `DB_FILE` 环境变量 > `config.json` 的 `dbFile` > 默认 `sfu/data/meeting.db`；开启 **WAL**（读不挡写、写不挡读）；两张表 users / audit + `idx_audit_ts` 索引；**旧 `users.json` 首次启动自动整表迁移**（原样保留 salt/hash、**绝不重新哈希**），旧文件改名 `users.json.imported-<日期>` 保留不删 | 口令方案抽成单一实现 `sfu/password.js`（scrypt + 每账号 16 字节随机盐 + `timingSafeEqual`），服务器与 CLI **require 同一份**——用结构消除"两处照抄、参数漂移导致 CLI 建的账号登不上"的隐患（09-24，SFU 主版本） |
| 🛑 优雅退出（09-24） | `SIGINT`/`SIGTERM`/`uncaughtException` → 关所有 mediasoup Worker → 停收新连接 → `closeDb()` 做 WAL checkpoint → 退出；**幂等**（连按两次 Ctrl+C 第二次直接退）+ **5 秒保险丝**兜底。此前完全没注册信号处理器，Ctrl+C = 进程暴毙（Worker 变孤儿占 RTC 端口、WAL 堆积、正在录制的 ffmpeg 被硬切） | `shuttingDown` 标志顺带修掉"正常退出却被当成 Worker 崩溃"的日志噪声；自测钩子 `TEST_SHUTDOWN_AFTER_MS`（Windows 上投递不了 SIGTERM，靠它自动化验证）（`npm run test:shutdown` ★ 9/9，09-24，SFU 主版本） |
| 🔐 自签证书 SAN 自愈（09-24） | 浏览器早已不看 CN（RFC 6125），自签证书必须带 **SAN**，否则手机常连"继续访问"都不给；且 DHCP 换 IP 后"只判有没有 SAN"永远不重签——现改为**证书缺失 / 无 SAN / SAN 未覆盖当前局域网 IP 三种都重新生成**，SAN 写入所有检测到的本机 IPv4 并保留旧证书已有 IP | 实测 `DNS:localhost, IP:127.0.0.1, IP:192.168.74.194, IP:192.168.116.194`（10 年期自签，`sfu/tls/`）；顺带修正漂移的 `announcedIp`（09-24，SFU 主版本） |
| 🖌️ 协作白板（F7） | 全场共享一块白板：5 色深笔/撤销/清空，笔迹按人配色、实时同步 | 第三条 'board' SCTP 频道（与聊天/批注并存）+ 归一化事件溯源重放（09-15，SFU 主版本） |
| ✏️ 协作批注（F5） | 共享屏幕上所有人可画笔迹（5 色/撤销/清空），笔迹按人配色、全房实时同步，共享者同步可见 | **独立 `annot` SCTP 数据频道**（与聊天频道并存互不挤占）+ `to` 定向头过滤 + 归一化坐标事件溯源重放（09-14，SFU 主版本） |
| 📶 带宽估计 / 消息路径 | 「🔗 连接方式」徽标悬浮显示"可用带宽估计 ≈ X Mbps"（transport-cc）；聊天气泡 🛰️ = 走了数据通道路 | `getStats` 的 selected candidate-pair + appendChat 路径徽标（09-14，D+3 前置可视化） |
| 🌐 可达性（跨机/跨网部署） | 局域网/公网部署三件事一份配置解决：监听 IP、HTTPS/wss 自签、ICE(STUN/TURN) 下发；页面顶部「🔗 连接方式」徽标实时显示直连/穿墙/中继；★ 2026-10-07~09 再补一层——**"这台机器能不能被外面连上、缺什么、下一步敲哪条命令"直接显示在邀请面板里**（含「媒体端口只 UDP」warn 与「通告地址只有一个」info 两项） | `sfu/config.json`（可选）+ 自动 HTTPS + `/config.json` 下发 ICE + `netCheck`（判据唯一实现 `sfu/nets.js`：`diagnose()` / `announceIps()`，server/doctor/watch/三个测试共用）；实测 `test:nets` **42/42**、`check:invite` **12/12**（09-13 E1/E2 自助版 → 10-07 自检进界面 → 10-09 固定端口与多地址） |
| ✨ 滤镜 / 虚拟背景（F6） | 美颜滤镜 5 档（原图/自然/冷白/暖阳/水墨）+ 磨皮滑条 + 绿幕/蓝幕色键抠像换背景（墨/绢/鎏金/自定义图片）；预览页所见即所得；面板实时显示每帧 CPU 账 | canvas 三站流水线（GPU filter 滤镜 → 低清模糊磨皮 → getImageData 色键抠像）+ captureStream → replaceTrack 上行，处理后轨顶替进 localStream 故 publishTracks/关摄像头/重连零改动（09-17，纯前端零依赖，SFU 主版本） |
| ⚡ 一键局域网交付 | `npm run start:lan` 一条命令：自动探测局域网 IP → 生成配置（0.0.0.0 + announcedIp + HTTPS 自签 + openrelay TURN）→ 自动放行防火墙 → 打印"本机/局域网/跨网"三个地址；邀请链接自动换成局域网 HTTPS 地址，发给第二台电脑点开就能进 | scripts/start-lan.js + /config.json 下发 `lanUrl`（09-16c/09-16d，见《部署手册.md》《跨电脑连接-操作指南.md》） |
| 📊 压力基准数字 | 三档（4/8/16 路）媒体转发实测：16 发 16 收 8263 kbps、单核仅占 6%、零丢包 | scripts/bench.js（ffmpeg 合成源 → PlainTransport → mediasoup 转发 → dgram 真收包统计）；数据表见《性能测试报告.md》（E4，`npm run bench`） |
| 💬 实时字幕（AI 线 L1） | 说话内容实时转字幕：本地字幕条半句跳动、整句定稿广播全房；字幕账本（时间戳/说话人/文本）一键导出 txt——即 AI 会议纪要/问答（C2）的输入 | **★ 09-28 起默认走服务端 whisper 转写**（`sfu/ai/asr.js`：本机推理、不上云、不吃本页 CPU，字幕与 AI 的"耳朵"同一条链路）；浏览器 Web Speech 仅在服务器没装 whisper 时兜底；**AI 在场时说话即上字幕**（音频管线就是 AI 的耳朵）；"小明"唤醒 + **20s 追问窗口**（免唤醒多轮对话）；字幕账本（时间戳/说话人/文本）一键导出 txt；历史抽屉（Otter 分段排版）；开关进房间状态机（💬 徽标）（09-17 起步 / 09-28 服务端化，SFU 主版本） |
| 🌙 过夜值守（AI 线 C3-N1） | 睡前开字幕挂一夜（≥7 小时），零人工干预：字幕账本溢出自动归档到服务器（jsonl，一条不丢）、识别器网络故障指数退避自愈 + 看门狗、值守统计（时长/条数/重启/已归档）与心跳日志、导出 txt 自动合并服务器全档 | 规划见《AI部分功能计划.md》第 3.6 节；client.js 第 30 步 + `/api/captions` + `npm run soak`（服务器耐久自测，默认 7h 可压缩）；零依赖零费用，不需要 LLM key（09-17e，SFU 主版本） |
| 📋 值守日报（AI 线 C1） | 字幕历史抽屉「📋 日报」一键生成 markdown 日报：时长/说话人占比条形图/每小时活跃分布/值守健康（识别器重启次数）——服务器归档+内存窗口合并全档，纯本地统计 | 零 LLM 零费用永远可用，与 N2（LLM 纪要）互为兜底；client.js 第 31 步（09-18，SFU 主版本） |
| 📈 Prometheus 指标端点 | `GET /metrics` 输出 Prometheus 文本格式：房间/成员/Producer/Consumer 总数、每路媒体累计字节、录制数、进程 uptime/rss——Grafana 直接可抓 | 复用观测面板同一份 snapshotRooms() 数据源，零依赖手拼（G7 首刀，09-18，SFU 主版本） |
| 📜 结构化日志（G7-②） | 关键事件 JSON Lines 落 `sfu/logs/app-日期.jsonl`（建房/销毁/成员进出/踢人/授权/录制起停），console 人读照旧——机器可检索（jq/脚本直吃） | logEvent 零依赖，只埋低频关键事件、绝不埋 3s/400ms tick（09-19，SFU 主版本） |
| 🚨 值守告警（G7-③） | `npm run watch` 定时拉 /api/rooms + /metrics：服务拉不到/媒体健康分低/房间宽限告急/内存超限四规则告警，同类 5 分钟限流，可选企业微信/钉钉 webhook；**09-24 起这两个接口要管理员 token → 用 `ADMIN_TOKEN=<token> npm run watch` 启动**，缺 token 时会明确提示而不是静默 401 | 零依赖脚本 scripts/watch.js，一次 fetch POST 即接 webhook（09-19，09-24 加门禁） |
| 📱 移动端 / PWA（G4） | 手机可开会：侧栏抽屉化（顶栏开关 + 遮罩）、控制坞收成图标、竖屏预览页堆叠；页面可**安装到主屏**（manifest + Service Worker，静态壳断网可开）；「省流」开关一键把所有远端画面锁到 simulcast 最低层（弱网/流量敏感场景） | manifest.webmanifest + sw.js（cache-first，socket.io 绝不缓存）+ client.js 第 32 步 + style.css 第 25 节；低带宽模式复用 set-preferred-layers 信令，服务器零改动（09-23，纯前端零依赖） |
| 🤖 AI Bot 参会者（AI 线 C 档） | AI 助理以参会者身份入会：成员列表 🤖 行、控制坞一键邀请/送走；**服务端音频管线**（每路音频 PlainTransport→ffmpeg astats RTP 旁路，服务器第一次真正"听到"会议）；聊天 @ai 提问（DeepSeek 真 LLM / 无 key [Mock] 模板双轨），金边气泡广播 | 零依赖；管线是 N2 真转写的现成插入口（09-19b，SFU 主版本） |
| 🖌️ 白板 v2「宣纸 editorial」 | 参考 recent.design igochi 案例：水墨五色板（墨/朱砂/鎏金/黛蓝/竹青）、暖纸白+渐晕+颗粒纸面、hairline 头部排版 | 纯 CSS 零依赖（09-19b） |
| 📝 会议纪要（N2，09-24 接通真 LLM） | 字幕账本 → markdown 纪要（要点/待办/结论）：字幕条右侧「📝 纪要」一键生成，落 `sfu/minutes/<房间>/`，气泡里直接给下载链接；另有值守定时分段 + 送走 bot/房间销毁自动终稿；`@ai 生成纪要` 同款 | LLM（DeepSeek）/[Mock] 双轨；`/minutes` 下载双白名单防穿越、`/api/minutes` 列表（09-19c 骨架 + 09-24 接通，SFU 主版本） |
| ⌨️ AI 问答 · 流式打字机（09-24） | 聊天里 `@ai 问题`：AI 助理**边想边吐字**（不再憋 3~8 秒整段才出），气泡上标 LLM/[Mock] 来源与本次 token 用量；断网也丢不了——增量之后必补一条终态消息 | SSE 增量 `ai-stream` + 终态 chat-message 按 streamId 去重；统一 provider `sfu/ai/provider.js`（零 SDK，Node 内置 fetch） |
| 🛠️ AI 教学三件套脚本（09-24） | `npm run ai:chat`（终端问答）/ `ai:summarize`（文本→纪要，长文本分段 map-reduce）/ `ai:agent`（手写 ReAct 工具循环）；既是路线图阶段 0~2 的学习产物，也是调 prompt 的离线实验室 | 零依赖；共用同一个 provider 与同一套双轨降级（`[Mock]` 标记） |
| 📼 录制回放（G3） | /api/recordings 列表 + recordings.html 回放页（点开即播+下载）——D+2 从"能录"变"录了能看" | 零依赖暖墨页；dashboard 有入口（09-19c） |
| 💬 字幕 Otter 式排版 | 字幕历史按说话人分组成段（段头名字+时间、段内逐句、最新句鎏金高亮）——Otter.ai 的转写排版节奏 | 纯前端重排（09-19b） |
| 🖥️ 真 OS 级远程桌面（B 档） | 控制端在**网页里**操作被控电脑上**真实的浏览器窗口**：开任意真实网站、点真实按钮、滚真实页面，地址栏显示对方真实 URL | 本地代理 `agent/`：手写 **CDP** 客户端（`Page.startScreencast` 抓屏 + `Input.*` 注入真输入，零新依赖）；新信令 `agent-hello`/`remote-frame`/`remote-meta` + 复用 `remote-input`；三道闸门（身份/授权/体量），原则"**信任 ≠ 免检查**"（09-24，SFU 主版本） |
| 📱 手机控电脑 | 手机上也能控被控电脑：单指 = 鼠标（移动/点击/拖拽），**双指 = 滚轮**，中文整段输入绕开 IME；成员行有 `🖥️` 前缀 +「可被控」徽标 +「控制电脑」按钮 | 控制台 canvas 交互**全部用 Pointer Events**（一套逻辑覆盖鼠标/触摸/触控笔，自己维护"当前几根手指"账本）；隐藏 IME 捕获框整段转发 + CDP `Input.insertText`（09-24，真机实测双指滚动让被控端 `scrollY 0→1000`） |
| 🔑 设备码配对直连（B 档补刀，09-30） | 被控电脑 `npm run agent` 启动即得一个 **6 位设备码**；控制端在登录页「🖥️ 用设备码远程控电脑」输码 + 连接口令**直接连那台电脑**——**不用建房、不用进会议** | `desk-register`/`desk-connect`/`desk-granted`/`desk-pending`；**设备码 = 私有 `isDesk` 房间的房号**（画面帧三道闸门与 16 字节控制帧零改动复用），控制端 `deskEnterRoom()` 轻量进房；**安全口令=无人值守直接授权 / 连接口令=对方终端按 y**，两路径同发 `desk-granted`（借鉴 `billd-desk` 的交互模型，不取 Electron 原生客户端；`LEARN.md` 5.39） |
| 🎚️ 真桌面画质档 + 三层帧率（09-30） | 控制台四颗：自动 / 流畅(6fps) / 标准(12) / 高清(20)，切档**同时改 JPEG 质量、帧率与长边上限**；"自动"档弱网自己降、链路稳了再升 | 走 `remote-input` 的 `{kind:'quality'}`（**老通道新语义** = 复用门禁与限流）；代理 `applyQuality` → `cdp.setScreencast()` 重开抓屏（监听器只绑一次）；**档位定中枢 → 闭环 ±2 微调 → 硬钳 2~24** 三层分工（策略线与安全线分开，坑 62） |
| 🚀 一键发布公网链接 | 一条命令把 Mesh 版打成"别人点开就能进"的发布包：生成 → 体检 → 可选开隧道拿公网地址 | `scripts/publish.js`（`npm run publish:mesh`）：白名单拷贝 + **每次清空重建（副本永不漂移）** + 真起一次验证 `/config.json` 下发 TURN + `--tunnel`/`--bundle`/`--check`（09-24） |
| 🧊 跨网 ICE 下发（Mesh） | Mesh 版"跨网连不上"的根因是 ICE 打洞：把 ICE 从代码挪进 `mesh.config.json`，由服务器 `/config.json` 下发 | 根 `server.js` 加 `/config.json` 路由（带 `no-store`）+ 启动 ICE 自检；根 `public/client.js` 加 `ICE_SERVERS`/`iceReady`，建 peer 前一律 `await iceReady`（09-24） |
| 📴 Service Worker 缓存纪律 | 修掉"改了代码刷新不生效"：会变的资源（client.js/style.css/页面）改 **network-first**，不变的 vendor 才 cache-first；加 `?nosw=1` 逃生舱 | `sfu/public/sw.js` 按资源性质分两路 + 缓存名 `meeting-v1 → v2`；根因"SW 不看 HTTP 缓存头"（09-24） |
| 📁 **共享文件浏览（第 51 步，2026-10-08；2026-10-09 补齐"还是看不了"的那两半）** | 房间里的**所有人同时看到同一份文档的同一页**并都能操作：上传 / 打开 / 翻页 / 缩放 / 跟随主讲 / 删除。支持 **PDF、Word(.docx)、.md、PPT(.pptx)、Excel(.xlsx)、图片、CSV、TXT/JSON**；**旧版 `.doc/.xls/.ppt` 也能读出正文与逐格数据**（界面上明说"版式不还原，完整请看下载"） | ★ **零依赖读 Office**：OOXML 本质是"一个 ZIP 包里的几份 XML" ⇒ 手写 ZIP 中央目录（含 ZIP64）+ 容错 XML 解析器，解压用浏览器自带 `DecompressionStream('deflate-raw')`（**没装 pdf.js / mammoth / sheetjs**）；旧版是 **OLE2/CFB 复合文档** ⇒ 手写 CFB + Word97 **piece table**（含 CP1252/UTF-16 压缩位）+ BIFF8（SST/CONTINUE/RK/公式缓存值）+ PPT97 record tree（**也没装任何库**）。10-09 补的两半：① 新格式里"有但没画出来"的东西（从样式继承的编号 / `mc:AlternateContent` 只取一份 / 域代码只取**结果**不取指令 / 文本框 / OMML 公式 / 合并单元格 / 百分数与货币格式码 / 行号忠实）；② 旧格式整类被拒。同步 = 服务器唯一权威 `room.fileView` + **变化才广播** + 连续量节流 / 离散事件绕过节流 + **位置传比例不传像素** + 客户端断环 + 新人单播补发；安全两道 = 渲染层先转义再拼接 + 服务器对非白名单类型强制 `attachment`+`nosniff`；★ **验收的裁判不是我**：`scripts/office-oracle.py`（python-docx/openpyxl 独立写独立读）+ `scripts/legacy-oracle.ps1`（**本机真 Word/Excel/PowerPoint COM** 造文件并交出它自己认为的文字，断言"覆盖率 ≥70%"）；实测 = `test:fileview` **292** + `test:files` 59 + 冒烟 **521**（514 + L7 两条浮层上界红线 + L6 一条"报告器必须接守卫" + 4 条守卫单测）+ 信令 **270** + **两个真浏览器** `check:files` **71** 项（默认；带 `REAL_OFFICE_FILE` 那份真文件时 72。断言的是**第二个人页面上的文字**，含真旧版文件）+ 长跑 `soak` 把文件算进第四类流量。教学导读 **LEARN.md 5.56 / 5.56.11 / 5.57** |

> **本表最后一栏的字母 = 升级编号**（A3/A4/A6 = 远程协助深化；D1~D6 = 会议本体 + SFU 深究；
> D+1~D+4 = SFU 深水区；E1/E2/E4/E5 = 工程化与可交付；F1~F7 = 对齐商业产品的产品体验，
> 参考声网形态、零 SDK 自研；L1 = AI 线实时字幕；**B 档 = 真 OS 级远程桌面（09-24b）**），
> A 档 + D 档于 **2026-09-11**、F 档于 **2026-09-12 ~ 09-17**、D+ 档于 **09-12 ~ 09-15**、
> E 档于 **09-14 ~ 09-16** 以 **SFU 主版本**实现（Mesh 对照版同步可行部分）；
> 教学导读见 `LEARN.md` 第 **2.13 节**（A 档）、**5.8 节**（D 档）、**5.9~5.19 节**
> （F/D+/E/C 档逐项导读）、**5.29~5.32 节**（09-24b：CDP 远程桌面 / Pointer Events / SW 缓存坑 / 一键发布），
> 路线图与**下一步新方向（G 档）**见 `后续升级方向.md`。

> **Mesh 对照版差异**（为什么它叫"教学版"）：媒体/聊天走浏览器 **P2P 直连**（不经服务器，服务器
> 只是信令邮局），人数上限 3；屏幕共享是 `replaceTrack` 换轨。SFU 版把这两点都换成了
> "服务器转发"——差异对照、逐行导读见 `LEARN.md`（第 2.5/2.11 节概念、第 5 节代码导读）。
> ⭐ **H5 远程协助两版都已落地**（Mesh 版 2026-09-09、SFU 版 2026-09-10）：同一功能两种
> 传输形态——Mesh 走 P2P `ctrl_` DataChannel 直连，SFU 走 `remote-input` 信令经服务器
> 定向转发（还多一道"非在册控制端一律丢弃"的门禁）。对比表见 `LEARN.md` 第 5.7 节，
> 这也是面试讲"两种数据通道取舍"的最佳素材。

技术栈：`Node.js` + `Socket.IO`（信令）+ `mediasoup`（SFU 媒体中枢）+ 浏览器原生 WebRTC + 原生 JavaScript（零前端框架）。

---

## 🖥️ 真 OS 级远程桌面（控制端在网页里，操作被控电脑上真实的浏览器窗口）

> 与上文「H5 远程协助」的区别：那是**网页控网页**（被控端是同一个工作台页面，事件重放）；
> 这是**网页控真机**——被控端跑一个本地代理 `agent/`，它驱动**真实的 Chromium 窗口**，
> 控制端在网页里就能打开任意真实网站、点真实按钮、滚真实页面、看真实地址栏。

**为什么必须要一个本地代理？（面试必答）**
浏览器的安全模型**不允许网页**移动真实光标、敲真实键盘、截别的程序窗口——这不是技术不足，
是设计如此（否则任何网页都能偷看你的屏幕、替你点"确认支付"）。所以商业远程桌面（AnyDesk /
向日葵 / TeamViewer）无一例外都要在被控电脑上装"被控端"。本项目把这一层做成**零新依赖**的
Node 程序（Node 22 内置 `fetch`/`WebSocket`，不引任何 npm 包）：

| 文件 | 干什么 | 关键实现 |
|---|---|---|
| `agent/cdp.js`（约 470 行） | 手写的 **CDP（Chrome DevTools Protocol，就是 F12 背后那套协议）** 客户端：启动真实 Chromium（Edge/Chrome，`BROWSER_BIN` 可指定）→ `--remote-debugging-port` 连上去 | `Page.startScreencast` 抓屏（**帧变化才推 + `screencastFrameAck` 自带背压**）、`Input.dispatchMouseEvent` / `Input.insertText` / `Input.dispatchKeyEvent` 注入真实输入 |
| `agent/index.js`（约 430 行） | 被控端代理主体：连 socket.io 信令 → 进房（★ 09-30 起**两种用法**：设备码 `desk-register` / 老用法 `agent-hello`）→ 收到授权后推画面帧 + 执行输入指令 + `applyQuality` 切画质档 | 零新依赖（复用根目录 `node_modules` 里的 socket.io-client）；命令行 `--code --connect-password --secure-password --room --server --password --name --url --port --profile --quality --fps --minutes --auto-allow --headless` |

```bash
# ★ 09-30 推荐用法：设备码模式（不用先建房、不用进会议）
npm run agent                                        # 启动即打印一个 6 位「设备码」
node agent/index.js --connect-password 1234          # 主控端要输对连接密码才进得来
node agent/index.js --code 888888 --secure-password s3cr3t   # 固定设备码 + 无人值守（不用等对方按 y）

# 老用法：把这间电脑当成会议成员来控（先进网页建房拿到房号）
node agent/index.js --room 123456                    # 被控机终端会弹确认，按 y 才放行
node agent/index.js --room 123456 --auto-allow       # 演示用自动放行（有风险，文档已写明）
```

控制端（手机或另一台电脑的浏览器）：**登录页 → 「🖥️ 用设备码远程控电脑」→ 输 6 位码 + 密码 → 连接**，
全屏远程桌面控制台直接打开，全程不建房、不进会议。

> **★ 09-30 取长补短：借鉴开源项目 `galaxy-s10/billd-desk`**（教学见 `LEARN.md` 5.39）
>
> 取了它的**交互与安全模型**（稳定设备码 / 连接口令 / 无人值守安全口令 / 画质档），
> **没取**它的实现栈（Electron 原生客户端 + H.264/265 硬件编码——违背本项目零依赖红线），
> "常用设备列表 / 设备持久化"这一项明确押后。
>
> **核心决策 = 设备码就是一个私有桌面房间的房号**（`room.isDesk`）：
> 于是画面帧的三道闸门、16 字节控制帧编解码、canvas 控制台、手机 Pointer Events
> **一行都没改**就全部复用；控制端只做一次"轻量进房"（登记门禁，不建媒体、不广播成员）。
> 授权两条路径——口令=**安全密码** → 服务器直接授予（无人值守）；只匹配**连接密码** →
> 转发请求给被控端终端按 y——**两条路径都发同一条 `desk-granted`**，前端只有一张开控制台的代码。

**画质档 + 三层帧率**（`.rd-bar` 上四颗：自动 / 流畅 / 标准 / 高清）：

| 档 | JPEG 质量 | 目标帧率 | 长边上限 | 适用 |
|---|---|---|---|---|
| 流畅 `smooth` | 30 | 6 fps | 1280×800 | 公网 / 手机热点，滚动看视频不卡 |
| 标准 `standard` | 55 | 12 fps | 1600×1000 | 一般宽带默认 |
| 高清 `hd` | 80 | 20 fps | 1920×1200 | 局域网，读小字看细节 |

切档走的是**与鼠标键盘同一条 `remote-input` 通道**（`{kind:'quality'}`，老通道新语义 =
白拿服务器门禁与限流，且 AI 操作员/会议内控制/设备码直连三条路径同时获得该能力）。
帧率是**三层分工**：**档位定中枢**（策略 6~24）→ **闭环自适应只在中枢 ±2 微调**（实测帧间隔与
RTT 回传 `remote-quality`）→ **代理与服务器对任何请求硬钳 2~24**（安全线比策略线更宽，两层有意分开）。

> ⚠️ **能力边界要诚实说**：CDP 只能控制 **Chromium 浏览器窗口内部**，控不了开始菜单 /
> 记事本 / Excel（那需要 Win32 `SendInput` 等系统级 API，不在"零新依赖"约束内）。
> 所以本模块定位是 **"远程浏览器工作区"**——但对"远程协助 / 远程演示 / 远程帮人操作"这个场景，
> 浏览器已经是 90% 的战场。

**安全模型：三道闸门**（原则一句话：**信任 ≠ 免检查**）

1. **身份闸**：只有 `socket.isAgent` 的代理才允许发画面帧——人冒充不了代理；
2. **授权闸**：帧只能发给"当前登记的 host→controller 这一对"，不会旁路给房间里第三人围观；
3. **体量闸**：单帧 > 900KB 直接丢弃 + 120 帧/秒限流，且用 `volatile` 发（**宁可丢帧不排队**，避免积压）。

协议侧新增 `agent-hello` / `remote-frame` / `remote-meta` 三个事件，控制输入**复用既有的
`remote-input`**（见 `sfu/protocol.js` 的 09-24 段）；授权链路与人类被控端一字不差——agent 没有任何特权。

> **★ 09-30 取长补短（借鉴开源远程控制 `galaxy-s10/billd-desk`）：远程控制不再要求"先开个会"**
>
> 原来要控一台电脑，你得先建房、让被控代理进这个房、再在成员列表点「控制电脑」——
> 远程控制被强行寄生在"会议"里。现在学 billd 的**设备码配对**：
>
> ```bash
> node agent/index.js                                    # 随机生成 6 位设备码
> node agent/index.js --code 823847                      # 自己指定设备码
> node agent/index.js --connect-password 1234            # 连接口令（需被控端终端按 y 确认）
> node agent/index.js --secure-password  9999            # 安全口令（无人值守：口令对 → 服务器直接授权）
> node agent/index.js --room 123456                      # 老形态照旧：作为会议成员入会
> ```
>
> 控制端在**登录页**点「🖥️ 用设备码远程控电脑」→ 输设备码 + 口令 → 直接出画面，
> **全程不用建房、不用进会议**。
>
> **实现上最值钱的一条决策**：设备码 = **一个私有 `isDesk` 房间的房号**（无 Router、不做媒体转发）。
> 于是画面帧三道闸门、16 字节控制帧、canvas 控制台、手机 Pointer Events **一行未改全部复用**；
> 控制端只做一次**轻量进房**（`deskEnterRoom()`：只登记门禁，不建 Transport、不订媒体、不广播成员），
> 避免把整套会议逻辑拖进远程控制。代理离线 → 设备码即刻作废（不留 60s 宽限：没人应答的码留着只会占号）。
>
> **两条授权路径，前端只认一个事件**：安全口令 → 服务器直接登记 `remoteCtl` 并回
> `desk-granted{unattended:true}`；连接口令 → 转 `remote-request` 给代理等人工按 `y`，
> 确认完成后由通用授权处理器回 `desk-granted{unattended:false}`。**"要不要人在场"这个差异
> 只体现在入口，不渗进控制台**——所以开控制台全项目只有一处代码。
>

**📱 手机控电脑（本次重点）**：控制台（`sfu/public/` 新增的全屏 `#rdConsole`：canvas 画画面 +
地址栏 + 工具条 + 隐藏 IME 捕获框）的 canvas 交互**全部用 Pointer Events** 实现，一套逻辑覆盖
鼠标 / 触摸 / 触控笔：

- **单指 = 鼠标**（移动 / 点击 / 拖拽）；
- **双指 = 滚轮**（两指中点的位移换算滚动）；
- **中文输入**走隐藏输入框整段转发 + 远端 CDP `Input.insertText`（绕开 IME 组合态的坑）。

成员列表里代理成员带 `🖥️` 前缀与「可被控」徽标，附「控制电脑」按钮。

> **真机实测（本次）**：真浏览器双窗口验证——被控端真实 URL 变成 `https://example.com/`；
> 坐标换算逐像素精确（视口 1254×707，期望 627,297 = 实际 627,297）；手机双指滑动后被控端
> 页面**真的滚了**（`scrollY 0 → 1000`）；手机单指点击触发被控端真实按钮。
> 自动化回归：`npm run test:agent`（09-30 起 **24/24**，含画质档四条真机断言）、
> `npm run test:e2e`（端到端 15 项全过，出截图）。

> ⚠️ **设备码这条路的诚实边界**：设备码**只存内存**——代理重启就换码（所以还做不到 billd 的
> "常用设备列表"）；连接/安全口令在服务器内存里**明文比较**（教学级，HTTPS 自签只是传输层兜底，
> 不是存储层安全）；一台设备**同一时刻只能被一个人控**（与会议内互斥同源，有意为之）。

---

## 🖥️ 前端 vs 后端（谁跑在哪、各干什么）—— 面试必答

这个项目只有"两个进程"：**浏览器里的页面 = 前端**，**Node.js 服务器 = 后端**。它们通过
Socket.IO 收发"信令消息"，媒体在 SFU 版由服务器转发、在 Mesh 版由浏览器直连。

| | 前端（浏览器） | 后端（Node.js 服务器） |
|---|---|---|
| **跑在哪** | 每位参会者自己的浏览器标签页里 | 一台常驻的电脑/云服务器（你本机即可演示） |
| **代码位置（SFU 主版本）** | `sfu/public/`：`index.html` + `style.css` + `client.js`（**第 1~39 步**，28 = 滤镜，29 = 实时字幕，30 = 过夜值守，31 = 值守日报，32 = 移动端/PWA，33 = 安全上下文提示，34 = 进房前 ICE 预检，35 = 首页 hero，36 = AI 操作会议实体，37 = 字幕延迟读数，38 = 播报延迟读数，39 = 延迟进日报）+ `dashboard.html`（观测面板）+ `vendor/` | `sfu/server.js`（分区 A~E）+ `store.js` + `password.js` + `protocol.js` + `config.json`（可选配置） |
| **对应 Mesh 对照版** | `public/`：`client.js`（第 1~16 步 + 第 19~25 步 = A/D 档同步升级） | `server.js`（根目录，信令邮局） |
| **职责：采集** | `getUserMedia` 开摄像头/麦克风、`getDisplayMedia` 抓屏幕 | 不采集，只收浏览器送上来的媒体 |
| **职责：信令** | 发 create-room / join-room / produce / consume 等事件 | Socket.IO 接收转发：房间号生成、密码校验、协商撮合 |
| **职责：媒体** | mediasoup-client 建 Transport → Producer（上传自己）/ Consumer（订阅别人） | mediasoup Worker→Router→Transport：把每路媒体**选择性转发**给同房间其他人 |
| **职责：界面** | 视频网格、控制按钮、聊天栏、网络徽标、日志 | 把 `public/` 静态文件发给浏览器（无界面） |
| **改哪里看效果** | 改 `sfu/public/*` → 浏览器 **Ctrl+F5 强刷** | 改 `sfu/server.js` → 重启 `npm run start:sfu` |

**一句话记忆**：页面长得像腾讯会议、负责"接摄像头/放画面/点按钮"的部分都是**前端**；
管房间号/密码、收转发媒体、决定"谁听到谁"的是**后端**。前端代码浏览器执行、不开服务器也能
用浏览器 DevTools 看；后端代码 Node 执行、只在你启动 `npm run start:sfu` 后才有生命。
两版前端页面几乎一样，**真正的架构差异全在后端与媒体路径**（这也是面试要讲的点）。

---

## 📁 文档导航（重要——先看对文件）

| 文件 | 作用 | 什么时候看 |
|---|---|---|
| **`LEARN.md`** | ★ 中文零基础教学入口：JS 语法 → WebRTC 概念 → 逐行读代码 → 小测验（第 5 节 = SFU 导读） | 想学会怎么读/讲这个项目 |
| **`README.md`**（本文件） | 项目总览、主版本定位、怎么运行、结构、前后端边界 | 快速上手 |
| **`SFU设计蓝图.md`** | ★ Mediasoup SFU 迁移蓝图：目标架构、前后端职责、信令协议、分阶段落地与验收 | 想搞懂 SFU 版当初怎么从 Mesh 迁来 |
| **`EVOLUTTON.md`** | 进化方向蓝图：实习简历最吃香版 vs 毕业设计版 + 跨电脑互连实操 | 决定项目下一步往哪走 / 想在两台电脑上联调 |
| **`AI部分功能计划.md`** | AI 会议助理规划 + 未来功能方向池 | 想加 AI / 远程桌面等竞争力 |
| **`H5远程桌面-规划.md`** | ★ H5 远程桌面（远程协助）：**P0 已全部落地**（边界/架构/协议/5 Phase 落地记录 + 第 12 节后续升级方向） | 想懂远程协助怎么做 / 挑下一个升级方向 |
| **`后续升级方向.md`** | ★ **升级路线图（唯一权威）**：第 0 节当前基线（已落地 / 待人工验证 / 真实缺口）+ A/D/D+/E/F 五档菜单 + **G 档（2026-09-17 公布的新方向）** + 状态列 + 回填守则 | 决定"下一步做什么"、回填升级成果、交接进度 |
| **`部署手册.md`** | 交付指南：局域网 5 分钟 / 跨网 TURN（含排查口诀）/ 公网云主机 systemd / 端口速查表 / 交付前自查清单 | 真要把项目跑到第二台电脑或云主机上 |
| **`跨电脑连接-操作指南.md`** | 给"非技术观众"的三步图文化：费用速查（局域网 0 元 / 跨网公共 TURN 0 元 / 云机可选）+ 常见问题表 | 演示当天把链接发给别人 / 答辩前踩点 |
| **`性能测试报告.md`** | 真实压测数字：`scripts/bench.js` 三档（4/8/16 路）媒体转发实测表（码率/CPU/丢包） | 简历/论文里要写"N 人""降低 X%"时找数字 |
| **`演示脚本-5分钟.md`** | 5 分钟演示讲稿：0:00 架构 → 会议本体 → simulcast 弱网 → 远程协助 → 面板/可达性 → 简历叙事（含 Q&A 弹药） | 投简历/答辩当天照着点 |
| **`AGENTS.md`** | 会话记忆交接（给 AI agent 的进度/坑/协议速记） | agent 接手项目、或想回忆进度与踩坑 |
| **代码注释** | `sfu/public/client.js`、`sfu/server.js` 每段都带中文教学注释 | 读代码时对照 |

---

## ⚡ 主版本（SFU）两分钟跑起来

```bash
# 1. 安装依赖（已装好可跳过）
npm install

# 2. 一次性：把 mediasoup-client 打包成本地 vendor 文件（不进 CDN；已生成则跳过）
npm run build:sfu-vendor

# 3. 启动 SFU 主版本服务器（端口 3001）
npm run start:sfu

# 或：一键拉起两个版本（演示模式）
npm run start:demo

# 或：给"另一台电脑也能连"用（自动探 IP + 生成配置 + HTTPS 自签 + 放行防火墙）
npm run start:lan
```

打开浏览器（建议 Chrome）访问 `http://localhost:3001`，开 **2~8 个**窗口/标签页：

1. 各窗口弹权限 → 看到自己的预览；
2. **窗口 1 点「创建房间」** → 右上角出现 6 位房间号（点徽标可复制邀请链接）；
3. 窗口 2/3 输房间号点 **「加入房间」**（或直接打开复制的链接自动进房）→ 互相看到；
4. 任一人点 **「共享屏幕」** → 选个窗口/屏幕 → 其他人看到（此时摄像头仍开着 = 第二路 Producer）；
5. 右侧聊天栏发文字 → 其他窗口实时收到（主路走 SCTP 数据通道，🚫失败自动退回信令兜底）；
6. **（可选）入会密码**：创建前在"房间密码"框填密码 → 房间上锁，加入者密码错会收到提示；
7. 看**顶部网络徽标**：每 3 秒刷新丢包/延迟/上下行码率，绿/黄/红分级。

> 💡 若两个窗口离得近，扬声器会被麦克风重新拾取出回声，点「静音」即可——对应真实软件的 AEC 回声消除。
> Mesh 教学对照版跑法：`npm start` → 访问 `http://localhost:3000`（最多 3 人，聊天走 DataChannel P2P）。
>
> 🔐 **HTTPS 入口提示**：跑 `npm run start:lan` 时终端会打印三个地址——
> 本机 `http://localhost:3001`、局域网 `https://<你的局域网IP>:3443`（自签证书，浏览器点
> "继续访问"即可）、以及跨网用的 TURN 提示。**给别的电脑发链接一定用局域网那个 HTTPS 地址**
> （`localhost` 链接在别人机器上打不开，邀请链接已自动改写为 `lanUrl`）。
> 另注：摄像头/麦克风只在"安全上下文"（localhost 或 https）里可用，用 IP 访问必须走 HTTPS 入口。
>
> 📊 **实时观测面板**：服务器跑起来后访问 `http://localhost:3001/dashboard`——
> 房间/成员/每路媒体的实时码率与健康分/发言占比，2 秒自动刷新（零依赖手写面板）。

### 🤖 打开 AI 会议助理（可选，30 秒配置）

AI 助理（`@ai` 问答 / 📝 纪要 / 🛰️ 远程操作员）**没有密钥也能用**——会自动走本地规则降级，
输出带 `[Mock]` 标记；配上 DeepSeek key 之后同一套链路立刻换成真模型：

```bash
# 项目根建 .env（已在 .gitignore 里，永远不会提交）
echo "DEEPSEEK_API_KEY=sk-你的密钥" > .env
npm run start:sfu      # 启动日志会写明：AI 模式 = LLM 还是 [Mock]
npm run test:ai        # 双轨自检（有 key 跑满 10 项，无 key 跑 5 项并提示）
npm run test:ai-brain  # AI 内核单测：检索/记忆/意图/行动项/**会议看板**（★ 有 key 时 70/70）
npm run verify:ai      # 真服务器端到端：起真服务器 + 询真模型（★ 17/17）
npm run verify:board   # ★ 真浏览器端到端（CDP 驱动真 Edge，读真实 DOM + 截图存证）（★ 21/21）
node scripts/bench-whiteboard.js  # ★ 白板性能基线（真浏览器：量"发出多少条消息"与重绘耗时；改完复测对比）
```

- 取值优先级：`DEEPSEEK_API_KEY` 环境变量 > 项目根 `.env` > `sfu/config.json` 的 `ai.key`；
- **密钥的安全边界**：只在服务器进程里使用，**不会下发到浏览器**——`/config.json` 只给一个
  `aiEnabled` 布尔值（有自动化断言守着这条线）；不要把它写进 `sfu/config.json` 以外的任何前端能读到的文件；
- **花了多少钱**：`curl http://localhost:3001/metrics | grep sfu_ai_llm`
  （calls / errors / prompt_tokens / completion_tokens / cost_cny）。一晚值守纪要 < 1 元的账，这样核。
- 想撤销：删掉 `.env` 那一行即可，功能自动回到 `[Mock]` 轨道，不会报错。

## 🌐 跨网络部署（解决"只能本机/局域网玩"的硬边界）

WebRTC 的可达性边界 = **信令可达 + 媒体可达 + 安全上下文**，三件事用一份配置解决：

```bash
cp sfu/config.example.json sfu/config.json   # 然后按需改
npm run start:sfu
```

| 想做到 | 改哪里 | 原理 |
|---|---|---|
| 局域网另一台电脑访问 | `listenIp: "0.0.0.0"` + `announcedIp: "你的局域网IP"` | 服务器媒体面用 announcedIp 告诉对方"往哪连我" |
| 页面跨机打开（摄像头能用） | `https.enabled: true` | 自动起 HTTPS+wss（证书缺失且有 openssl 时自动自签，浏览器点"继续访问"）；getUserMedia 只在安全上下文开放 |
| 跨家庭/公司网络（穿 NAT） | ★ **不是配 TURN 就能通**：SFU 版媒体是"浏览器 ↔ 服务器"直连，**服务器不经过 TURN**（`iceServers` 里的 TURN 只救浏览器↔浏览器，即 Mesh 版）。决定因素是**服务器的 `announcedIp` 跨网可达不**：① **Tailscale 组网 = 零成本首选**（无需公网 IP、无需端口映射，两台设备各装并登录同一账号）；② 有公网 IP 就端口映射；③ 云主机。`announcedIp` 支持 `"auto"`（每次开机自挑网卡，永不过期），也可 `announceExtra:"tailscale"` 把 100.x 那条一起通告（env：`MEDIASOUP_ANNOUNCE_EXTRA` / 明示注入 `ANNOUNCE_EXTRA_IPS`） | 打不开邀请面板看不出缺什么 ⇒ **会议页点房间号徽标**，那块面板现在直接回答"外面的人能不能进来、缺什么、下一步敲哪条命令"（判据在 `sfu/nets.js` 的 `diagnose()`，一处实现同时给 `/config.json`、`doctor`、`watch` 用） |
| 媒体只放行**一个端口**、且封 UDP 的网络也能通 | `rtcServerPort: 4443`（或 `MEDIASOUP_RTC_SERVER_PORT`） | ★ 2026-10-09：**mediasoup 的 `WebRtcServer`** 把所有传输的 RTP 汇到一个固定端口，并在**同一端口再开一份 TCP** ⇒ 防火墙/安全组只放行 `4443` 的 UDP **和** TCP；封 UDP 的网络（公司 VPN、酒店、部分校园网）由 **TCP ICE 候选**兜住。实测：`npm run test:crossnet` 17/17——候选里 udp+tcp 两类都在固定端口上，且 TCP 在**每个**通告 IP 上握手成功 |
| 云服务器部署 | 上面的组合 + 防火墙放行 `port`(TCP) 与 `rtcServerPort`(UDP+TCP)（不配固定端口时才放行 `rtcMinPort~rtcMaxPort` 的 UDP 段） | 信令走 TCP，媒体走 UDP（同端口另有 TCP 兜底）；《部署手册.md》场景 C 的 systemd + coturn 步骤照旧 |

**验证连接方式**：会议页顶部新增「🔗 连接方式」徽标（直连 / STUN 穿墙 / TURN 中继），
从 `getStats()` 的 ICE 候选类型实时读出——部署是否生效一眼可见。

**Mesh 对照版也同一套做法（09-24）**：Mesh 是 P2P，媒体不经服务器，所以"跨网连不上"的根因
是 **ICE 打洞**（不是服务器）。原来根 `public/client.js` 把 ICE 硬编码成只有一条 Google STUN
→ 严格 NAT（公司网 / 4G / 酒店 WiFi）必然打不通。现在把 ICE **从代码里挪到配置里**、由服务器下发：

- 根 `server.js` 新增可选 `mesh.config.json`（`port` / `host` / `iceServers` / `publicUrl`；
  优先级：环境变量 `PORT`/`HOST` > `mesh.config.json` > 默认值），新增 `/config.json` 路由下发
  `iceServers` / `arch` / `maxMembers`（带 `Cache-Control: no-store`），静态资源也加 `no-store`，
  启动时打印 **ICE 自检**（STUN 几条 / TURN 几条，无 TURN 时警告）；
- 根 `public/client.js` 新增 `ICE_SERVERS` + `iceReady`（启动 `fetch('config.json', {cache:'no-store'})`，
  失败回落默认 STUN），**所有建 peer 的地方都改成 `await iceReady` 再建**——避免"第一条 peer 用错配置"的时序坑；
- 这与 SFU 版已有的 `/config.json` 是**同一份经验的第二次应用**；一键发布（`npm run publish:mesh`）
  正是靠它把 TURN 配置带到底层浏览器。

> ⚠️ `mesh.config.json` 可能含 TURN 的 `username`/`credential`，已加入 `.gitignore`（根目录与 `publish-mesh/` 两处）。

---

## 🗄️ 账号数据库 · 管理员 CLI · 可靠性（09-24）

> 这一节把本轮"从演示到能交付"的工程改动集中讲清：账号换成真数据库、观测接口加门禁、内容接口补上房间内令牌与录像签名 URL、
> Ctrl+C 正确退出、自签证书修好手机。教学细节见 `LEARN.md` 5.33~5.38，排查步骤见《跨电脑连接-操作指南.md》第八节。

### 存储层：Node 内置 SQLite（零新依赖）

项目有"零依赖铁律"（生产依赖只有 mediasoup + socket.io），所以没有引入 better-sqlite3，
而是用**本机 Node（v22.22.2）内置的 `node:sqlite`**——内置模块不算依赖。

- **库文件位置优先级**：环境变量 `DB_FILE` > `sfu/config.json` 的 `dbFile` > 默认 `sfu/data/meeting.db`；
- **WAL 日志模式**（`PRAGMA journal_mode = WAL`）：读不挡写、写不挡读——服务器"随时有人登录（读）、随时有人注册/审计（写）"正需要这个并发模型；
- **两张表**：`users(username PK, salt, hash, display_name, role, created_at)`、`audit(id PK AUTOINCREMENT, ts, kind, actor, detail)` + `idx_audit_ts` 索引；
- **自动迁移**：首次启动若 `sfu/users.json` 存在且 users 表为空 → 整表搬入，**原样保留 salt/hash（绝不重新哈希，否则老密码永久失效）**，搬完把旧文件改名 `users.json.imported-<YYYYMMDD>` 保留不删（留退路）；
- **口令单一实现** `sfu/password.js`：`scrypt(password, salt, …) → hex`，盐 16 字节随机、hex 存库，校验用 `crypto.timingSafeEqual`；服务器与 `scripts/admin.js` **require 同一份**——原先两边"照抄"，任一处参数漂移都会导致 CLI 建的账号在网页上永远登不上。
- **口令哈希代际 + 平滑重哈希（09-30，`npm run test:store` 55/55 实测）**：scrypt 的 cost 参数（N/r/p）是"以当下硬件为标尺"的，会随硬件发展过时。现在 **V1（默认 N=16384 / 32 字节）只用于校验存量账号**，**新哈希一律 V2（N=32768, r=8, p=1 / 64 字节）**；代际**按 hex 长度判**（不加版本前缀——库里 V1 本就没前缀，再加前缀等于多迁一次格式）；**老账号登录成功时服务器顺手用新参数重算并换新盐写回**，用户无感（密码没变），库里的哈希悄悄升级——"参数过时"这个存量问题就此自愈。
  ⚠️ 这批改动**目前还在工作区未提交**，且 `LEARN.md` 的教学导读尚未回填（与本轮"设备码 + 画质档"是两件事，交付要分开）。

### 管理员 CLI（`scripts/admin.js`）

```bash
npm run admin:list                               # 列出账号 + 角色
npm run admin:grant   -- <用户名>                 # 提权 admin
npm run admin:revoke  -- <用户名>                 # 降权 user
npm run admin:adduser -- <用户名> [密码] [昵称]    # 新建账号（缺密码则随机生成并打印一次）
npm run admin:passwd  -- <用户名> [新密码]         # 重置密码（缺密码则随机生成并打印一次）
npm run admin:purge   -- [--yes] [--match <正则>]  # 清理测试垃圾账号（默认只干跑，--yes 才真删）
```

> ⚠️ `grant`/`revoke`/`adduser`/`passwd`/`purge` 后面要加 `--`：把参数透传给脚本，而不是被 npm 吃掉。

几个能答辩讲的点：
- **`admin:purge` 默认只干跑（dry-run）**：删除不可逆，必须显式 `--yes` 才真删——把"危险"变成一次主动表达，防止手滑；
- **`deleteUser` 内置安全闸**：拒绝删除库里**唯一**的管理员（删了就再也没人进得了观测面板，而密码是不可逆哈希、没有"找回"）；
- **`admin:passwd` 存在的原因**：没有它，一次忘记密码 = 永久锁死（教学版没有邮件重置通道，只能靠"能上这台机器的人"这条本地可信通道）；
- **角色生效时机**：role 在库里，但 token 里带的是"发 token 那一刻的角色"，提权后要让对方**重新登录**——这是换来 HTTP 门禁"零数据库查询"的取舍。

### HTTP 门禁的两类边界（本轮最重要的修正）

| 类别 | 接口 | 门禁 | 理由 |
|---|---|---|---|
| **甲类·观测** | `/api/rooms`、`/metrics`、`/api/recordings` | ✅ 必须带管理员 token | 跨房聚合 / 实时全景，知道它 = 掌握全局，且与"是否参会"无关 |
| **乙类·内容** | `/api/captions`、`/api/minutes`、`/minutes/<房号>/<文件>.md` | ✅ 必须带**有效房间令牌** | 令牌在**进房成功时签发给本人**；本产品允许游客进会、且字幕归档由 `client.js` **自动**调用，所以令牌**必须发给游客**（做成"需登录"就会让游客归档**静默失效**）。用它替代原先可枚举的 6 位房号，关闭"房间号可枚举"的缺口 |
| **乙类·录像** | `/recordings/<文件名>` | ✅ admin 或**短时效签名 URL**（默认 1 小时） | 文件清单已由甲类拦住；单文件改用"谁按下 ⏺、谁拿到自己的签名链接"，链接自带过期时间 |

**一句话**：**安全不再寄望于"房间号只发给在场的人"，而是"进了这场会的人才拿得到令牌"**——6 位房号可枚举的缺口由此关闭。

**门禁怎么取令牌**：`X-Room-Token: <token>` 请求头（首选，干净、不进 URL 历史/日志）/ `?roomToken=<token>` 查询串兜底（因为 `<a href="/minutes/...">` 这类导航链接发不出自定义头）；管理员的 admin token 不受房间限制（用于跨房巡检）。

**配置项**：`config.json` 的 `roomTokenRequired`（默认 `true`，设 `false` 退回旧的"开放"行为，供教学对比/本地调试）与 `roomTokenTtlSec`（令牌有效期，默认 `86400` 秒；环境变量 `ROOM_TOKEN_TTL_SEC` 优先级更高）。

**诚实边界**（如实交代，不吹成完美方案）：令牌是 **Bearer 语义**（谁拿到谁用，**不绑成员身份 / IP**），24h 内泄露即可用；录像签名 URL 同理（1 小时内谁拿到谁下）；两者**共用同一把 `SECRET`**（数据格式不同、实际不会互相混淆，但严格说少了 domain separation）；`sfu/data/room-secret` 一旦换掉，**所有**已签发的房间令牌与录像签名链接立即失效；`chmod 600` 在 **Windows 上不生效**（文件实际是 `-rw-r--r--`，Windows 需靠目录 ACL 保护）。

### 优雅退出 与 证书 SAN 自愈

- **优雅退出**：`SIGINT`/`SIGTERM`/`uncaughtException` → 关 Worker → 停收新连接 → `closeDb()`（WAL checkpoint）→ 退出；**幂等** + **5 秒保险丝**。Windows 上外部投递不了 `SIGTERM`（无 POSIX 信号，`process.kill` 走 TerminateProcess 等于直接暴毙），故加了自测钩子 `TEST_SHUTDOWN_AFTER_MS`（沿用 `TEST_RECORD` 约定）让这条路径可自动化验证。
- **证书 SAN 自愈**：SAN 覆盖 `localhost`/`127.0.0.1` + 所有检测到的本机 IPv4；**证书缺失 / 无 SAN / SAN 未覆盖当前 IP** 三种情况都重新生成（DHCP IP 漂移自愈），并保留旧证书里已有的 IP。

---

## 🧱 项目结构

```
webrtc/
├── AGENTS.md               # ★ 会话记忆交接（给 AI agent 的进度/坑/协议速记）
├── README.md               # 本文件：总览 + 主版本定位 + 前后端边界
├── LEARN.md                # ★ 零基础教学（第 5 节 = SFU 逐文件导读）
├── SFU设计蓝图.md          # ★ Mesh→SFU 迁移蓝图（架构 + 分阶段验收）
├── EVOLUTTON.md            # 进化方向：实习简历版/毕设版 + 跨电脑互连实操
├── AI部分功能计划.md       # AI 会议助理规划 + 功能方向池
├── H5远程桌面-规划.md      # ★ H5 远程桌面开发规划（Mesh 先行、SFU 延伸）
├── 后续升级方向.md         # ★ 升级路线图 + 当前基线 + G 档新方向（唯一权威）
├── 部署手册.md             # 交付指南：局域网 / 跨网 TURN / 云主机 systemd / 自查清单
├── 跨电脑连接-操作指南.md  # 三步图文（发给非技术观众）+ 费用速查 + 常见问题
├── 性能测试报告.md         # bench 三档实测数字表（4/8/16 路）
├── 演示脚本-5分钟.md       # 5 分钟演示讲稿（含 Q&A 弹药）
├── package.json            # scripts: start / start:sfu / start:demo / start:lan / test / test:sfu /
│                           #          test:store / test:shutdown / test:smoke / test:record / test:turn /
│                           #          admin:list|grant|revoke|adduser|passwd|purge / bench / build:sfu-vendor
├── server.js               # [Mesh 对照版] 信令邮局（3000）：静态托管 + 房间/密码 + 定向转发
├── start-lan.bat           # 一键局域网交付（探 IP + 生成配置 + HTTPS + 放行防火墙）
├── deploy/coturn/          # 自建 TURN 包（docker-compose.yml + turnserver.conf）
├── scripts/
│   ├── test-signaling.js   # Mesh 信令回归（npm test，需先起 3000）★ 36/36
│   ├── test-sfu-signaling.js  # SFU 信令回归（npm run test:sfu，需先起 3001）★ 2026-10-08 实测 270/270
│   ├── test-sfu-client-smoke.js # SFU 前端无头冒烟（npm run test:smoke，零依赖不用起服务器）★ 2026-10-08 实测 499/499
│   ├── test-store.js       # ★ 09-24 账号存储层回归（node:sqlite：迁移/改密/删号安全闸/口令 V2 平滑重哈希）★ 55/55
│   ├── legacy-user-fixture.js # ★ 09-30 造一个"V1 老账号"进库（只为验证平滑重哈希，别手搓旧参数哈希）
│   ├── test-shutdown.js    # ★ 09-24 优雅退出回归（关 Worker/关库 checkpoint/幂等/5s 保险丝）★ 9/9
│   ├── admin.js            # ★ 09-24 管理员 CLI（list/grant/revoke/adduser/passwd/purge，薄封装 store）
│   ├── test-turn.js        # ICE 可达性实测（手搓 STUN Binding / TCP 探测）
│   ├── bench.js            # E4 压力基准（4/8/16 路媒体转发实测）
│   ├── start-demo.js       # 一键起两版并打印地址
│   ├── start-lan.js        # 局域网交付（生成 sfu/config.json + HTTPS 入口）
│   ├── publish.js          # ★ 09-24 一键发布公网链接（生成 publish-mesh/ → 体检 → 可选隧道；--tunnel/--bundle/--check）
│   ├── test-agent.js       # ★ 09-24 桌面代理端到端（真浏览器/真画面/真注入；09-30 增画质档断言）★ 24/24
│   ├── test-e2e-remote-desktop.js # ★ 09-24 真机远程桌面 e2e（真双窗 + 手机视口，出截图）
│   └── test-publish.js     # ★ 09-24 发布链回归（含 --check 过期闸）★ 30/30
│   #   ★ 2026-10-08~09 共享文件与跨网这一批新增（每条都是 npm script，见下一节命令表）：
│   #   test-fileview.js（渲染内核 292 项，含 Q 组"另一个实现写的文件" + L 组"旧版二进制"）·
│   #   test-files.js（存储层 59 项）· check-files.js（**两个真浏览器** 71 项，带 REAL_OFFICE_FILE 那份真文件时 72）·
│   #   ooxml-fixture.js（独立写的 ZIP 打包器：写包与读包两份实现）·
│   #   ★ office-oracle.py（python-docx/openpyxl 生成+读回，当第二个裁判）·
│   #   ★ legacy-oracle.ps1（驱动本机真 Word/Excel/PowerPoint COM 交出它自己认为的正文）·
│   #   review-office.js（真实文件回扫：只报结构统计，绝不打印内容）· bench-innerhtml.js ·
│   #   ★ test-crossnet.js（跨网入口实测 17 项：udp+tcp 候选都落固定端口、TCP 逐通告 IP 握手）·
│   #   ★ stun-probe.js（手写 STUN Binding 读反射地址；test:turn 复用；--selftest 8 项）·
│   #   test-nets.js（sfu/nets.js 判据 42 项）· check-invite.js（邀请面板 12 项，含矮窗口"浮层不许顶出屏幕"）
├── agent/                  # ★ 09-24 真 OS 级远程桌面 · 被控端代理（零新依赖）
│   ├── cdp.js              #   手写 CDP 客户端：驱动真实 Chromium（抓屏/注入输入）
│   └── index.js            #   代理主体：agent-hello 进房 → 推帧 + 执行 remote-input
├── publish-mesh/           # ★ 09-24 由 publish.js 生成的发布包（白名单拷贝，勿手工改）
├── public/                 # [Mesh 对照版] 前端（P2P 直连用）
│   ├── index.html / style.css / client.js（第 1~16 步 + 第 19~25 步 A/D 档同步）
│   └── vendor/             # 本地 socket.io 客户端库（勿动）
└── sfu/                    # ★ 主版本（SFU：mediasoup 服务器转发，端口 3001）
    ├── server.js           #   后端：静态托管 + 房间/密码 + Worker/Router/Transport 媒体中枢（分区 A~E）
    ├── protocol.js         #   信令事件总表（改 server/client 前先看）
    ├── files.js            #   ★ 2026-10-08 共享文件存储层（sfu/files/<房>/{index.json,blob/*}；名字消毒/唯一名/三档配额/台账与磁盘对账/内联白名单）
    ├── nets.js             #   ★ 2026-10-06 「本机该对外说哪个 IP」的唯一判据（挑网卡避开 VirtualBox/WSL、
    │                       #     announcedIp:"auto"、Tailscale 报出不抢主位）；★ 2026-10-09 再加
    │                       #     `announceIps()`（多地址通告：主址/Tailscale/明示注入）与 `diagnose()`
    │                       #     的「媒体端口」「通告地址」两项 —— server / doctor / watch / 三个测试共用
    ├── files/              #   ★ 共享文件产物目录（运行时生成，gitignore；房间销毁即整目录删除）
    ├── config.example.json #   配置模板（端口/人数/监听 IP/announcedIp/ICE/HTTPS/roomTtlSec/videoSvc/dbFile/adminUsername/roomTokenRequired/roomTokenTtlSec）
    ├── config.json         #   实际配置（可缺省；start:lan 会自动生成；含 lanUrl 供邀请链接改写）
    ├── store.js            #   账号/审计存储层（node:sqlite，零新依赖；WAL + 旧 users.json 自动迁移）
    ├── password.js         #   口令方案唯一实现（scrypt + 随机盐 + timingSafeEqual；服务器与 CLI 共用）
    ├── data/meeting.db     #   账号数据库（运行时生成；旧 users.json 首次启动自动迁入并改名备份）
    ├── users.json          #   【历史】旧账号文件；迁移后改名为 users.json.imported-<日期>（保留不删）
    ├── recordings/         #   D+2 服务器侧录制产物（webm/mkv，经 /recordings/<file> 下载）
    ├── tls/                #   HTTPS 自签证书（https.enabled 时自动生成）
    └── public/             #   前端：几乎同 Mesh 版，多了 mediasoup-client
        ├── index.html / style.css / client.js（**第 1~51 步**）
        ├── fileview.js       #   ★ 2026-10-08 共享文件的**零依赖渲染内核**（纯函数：手写 ZIP+XML 自己读 Office）
        ├── dashboard.html  #   实时观测面板（/dashboard，2s 轮询 /api/rooms）
        └── vendor/         # socket.io.min.js + mediasoup-client.js（本地打包，勿动）
```

> ⚠️ **别改混**：改 `sfu/` = 主版本（SFU）；改根目录 `server.js`/`public/` = Mesh 对照版，两套各一份。

---

## 📖 它是怎么工作的（30 秒版 · SFU 主版本）

```
浏览器页面（前端）                         Node 服务器（后端 sfu/server.js）
  打开页面 ──Socket.IO──▶ 连上服务器
  点「创建房间/加入」────▶ 生成/校验 6 位房间号 + 密码
  拿到房间号 ────────────▶ 加入房间广播
  开摄像头/麦克风 ───────▶ (mediasoup) 建 WebRtcTransport
  produce（上传自己的音视频）────▶ Worker→Router 登记 Producer，广播 new-producer
  别人 produce ──────────▶ consume（订阅）→ 服务器把媒体转发下来
  ▶ 看到对方画面；共享屏幕 = 再 produce 一路
  聊天文本 ──chat-message──▶ 服务器广播给全房间（主路走 SCTP 数据通道，信令兜底）
  录制 ⏺ ──record-start──▶ PlainTransport RTP 旁路 → ffmpeg 落盘 recordings/
  getStats 每 3 秒采样 → 顶部网络徽标；/api/rooms + /dashboard = 服务器内部状态可视化
  人走光 → 房间进 60s 宽限期（可配置），到期才 destroyRoom（Router 关闭、房间号回收）
```

**核心概念**（详见 `LEARN.md`）：
- **信令**（找人对齐）必须走服务器；**媒体**在 SFU 版经服务器转发、在 Mesh 版走 P2P 直连。
- **SFU = 服务器选择性转发**（腾讯会议同款），浏览器只连服务器，人数上限 3→8；
- Mesh = 每人连所有人，教学版用 P2P 讲清"信令 vs 媒体 vs DataChannel"后再理解 SFU 更顺。

---

## 🧪 运行回归测试

```bash
npm run test:sfu   # SFU 主版本信令：自起服务在 3011（不抢开发者的 3001）★ 2026-10-08 实测 270/270（含门禁边界 + 房间令牌断言：该拦的拦、该放的放、跨房/篡改/过期一律 401；09-30 +设备码配对直连与画质档断言）
npm run test:store # 账号存储层 node:sqlite：迁移保留 salt/hash、改密、删号安全闸、完整性 ★ 2026-09-30 实测 55/55（+「口令哈希 V2 / 平滑重哈希」7 项）
npm run test:shutdown # 优雅退出：关 Worker / 关库 checkpoint / 幂等 / 5s 保险丝 ★ 2026-09-30 复跑 9/9
npm test           # Mesh 对照版信令：需先 npm start（连 localhost:3000）★ 2026-09-24 实测 36/36
npm run test:smoke # SFU 前端无头冒烟（零依赖，不用起服务器）★ 2026-10-08 实测 499/499
npm run test:ai    # AI 双轨自检：无 key 只跑 Mock 轨并提示怎么配；有 key 两条都跑 ★ 10/10
npm run test:asr   # ★ 服务端语音识别自测（探测必须成功/系统 TTS 真语音转写/唤醒与追问窗口/在线 asrEnabled/配置模板可解析/★ 房间动作**泛化**电池/真实账本回扫）★ 2026-10-06 深夜实测 128 通过/1 跳过
npm run test:ai-brain # AI 内核单测（BM25 检索/会话记忆/意图分类/行动项/会议范围/实时看板）★ 70/70
npm run verify:ai  # AI 真服务器端到端（起真服务器+真信令+真模型，验检索/记忆/意图/抗幻觉/参会语义）★ 17/17
npm run verify:board # ★ AI 看板真浏览器端到端（CDP 驱动真 Edge，验真实 DOM 渲染/语音链路/证据展开/行动项认领）★ 21/21
npm run test:record # D+2 服务器侧录制端到端自测（ffmpeg 当媒体源→mediasoup→落盘，需已装 ffmpeg）
npm run test:turn  # ICE 可达性实测（对 config 里每个 STUN/TURN 手搓 STUN Binding，3s 超时）
npm run bench      # E4 压力基准（4/8/16 路，约 1 分钟，独立 Worker，不用起 3001）
npm run ai:chat    # AI 脚本：终端问答（也可 --q "问题" 单发）
npm run ai:summarize # AI 脚本：文本/文件/房间字幕 → markdown 纪要（--text/--file/--room 123456）
npm run ai:agent   # AI 脚本：手写 ReAct 工具循环（--goal "…" --maxsteps 6 --verbose）
npm run publish:mesh # ★ 一键发布 Mesh 版：生成 publish-mesh/ → 体检 → （可选）开隧道（--tunnel/--bundle/--check）
npm run test:publish # 发布链回归（含 --check 过期闸：源码改了不重新发布就必须报错）★ 2026-09-24 实测 30/30
npm run agent        # ★ 启动被控端桌面代理。两种入会方式：`--room 123456`（当会议成员）或 `--code 123456 --connect-password xxx`（设备码配对直连，不用开会）
npm run test:agent   # 桌面代理端到端（真起 Chromium：验抓屏 JPEG + 坐标注入 + 远程导航 + 画质档切档）★ 2026-09-30 实测 24/24
npm run test:e2e     # 真机远程桌面 e2e（真双窗 + 模拟手机双指滚动/单指点击，出截图）★ 2026-09-30 实测 15/15
npm run test:e2e-media # ★ 真浏览器多人音视频回归（假摄像头双页进同一房）★ 2026-10-04 实测 38/38
npm run test:e2e-asr   # ★ 语音全链路真浏览器取证（假麦克风喂 WAV→转写→字幕→唤醒→应答；双浏览器断言字幕/AI 应答广播到第二人 + AI 房间动作双端白板同步）★ 2026-10-04 实测 14/14
npm run test:e2e-reconnect # ★ 服务器重启韧性 e2e（硬杀服务→自动重连→giveUpRoom 干净退房→全程零原生弹窗→重建房间）★ 2026-10-04 实测 10/10
npm run test:asr-live  # ★ 语音闭环自测（TTS→RTP→真管线→转写→应答），带正向对照：证明音频真进去了
                       #   ★ 2026-10-09 起**默认等主引擎（本地 Qwen）就位再喂音频**——不等时这段跑的
                       #     其实是 whisper 兜底，而用户配置的是 qwen-local（测的不是那台引擎 = 假红制造机）；
                       #     要做"降级路径"的 A/B：`TEST_ASR_WAIT_WARM=0 npm run test:asr-live`
npm run test:nets      # ★ 2026-10-06 "本机该对外说哪个 IP"的判据回归（sfu/nets.js：网卡排序避开
                       #   VirtualBox/WSL 假局域网、Tailscale 报出不抢主位、announcedIp:"auto"）；
                       #   ★ 2026-10-09 加 K2 那组 11 条：多地址通告（主址+Tailscale+明示注入）、
                       #     'all' 按**网卡名**挡虚拟口（打分符号当过滤器会漏 vEthernet (WSL)）
                       #   ★ 2026-10-09 实测 42/42
npm run test:crossnet  # ★ 2026-10-09 跨网入口自检（新套件，专用端口 3019 + 固定媒体端口 3155，
                       #   端口被占明确拒绝、绝不碰 3001）：ICE 候选 **udp 与 tcp 都在且都落固定端口** /
                       #   TCP 在**每个通告 IP** 上真握手 / netCheck 的「媒体端口」「通告地址」两项与文案 /
                       #   `/metrics` 的 sfu_rtc_server_port（锚行首，坑 74）/ diagnose 反证（0 ⇒ warn 且 tcpFallback:false）
                       #   ★ 实测 17/17；末尾另印一条**只报事实不作判据**的 STUN 反射地址对照（本机在 NAT 后）
npm run test:stun      # ★ 2026-10-09 手写 STUN Binding 的解析器自检（XOR-MAPPED-ADDRESS 的 family 是 1 字节、
                       #   端口要 ^=(cookie>>>16)；Google 实测还发老式 **8 字节** MAPPED-ADDRESS，两种布局都得解）
                       #   ★ 实测 8/8（合成响应让解析器可红；test:turn 现在复用它）
npm run review:meeting # ★ 2026-10-06 真实可用性复盘：读 sfu/captions/*.jsonl + sfu/logs/app-*.jsonl 出"这场会到底怎么样"
                       #   每场 11 行结论、每条带样本量（❔=样本不足，**不是**通过）；--room <号> / --days N / --json
                       #   判据复用生产那一个函数（noiseRiffReason / isDupOrFragment / normAsrText），报告与系统不两套口径
npm run test:review    # ★ 上面那台量具的自检（合成账本 23 条：停摆要"段在到达却没字幕"、延迟只认 fin=silence、
                       #   0÷0 不许报"0% 通过"、文件名过滤器写错一位要当场红、★ "指令回扫"这台仪表自己也要能红）
                       #   ★ 2026-10-06 深夜实测 23/23
# ── ★ 2026-10-06「真浏览器验界面」十六件套 + 一条总线（量的都是浏览器算出来的值，不是源码里写了没写）──
npm run test:fileview # ★ 2026-10-08 共享文件渲染内核单测（sfu/public/fileview.js）★ 2026-10-09 实测 292/292
                      #   夹具 scripts/ooxml-fixture.js 是**独立写的 ZIP 打包器**：写包与读包两份实现，
                      #   对同一份字节达成一致才算真证据。
                      #   ★ G2 组把源码装进"没有 require 的 vm 上下文"，逼它只能走浏览器那条
                      #     DecompressionStream（坑 118：Node 全绿而真浏览器自死锁）
                      #   ★ Q 组（2026-10-09）：**另一个实现写的文件**——scripts/office-oracle.py 用
                      #     python-docx / openpyxl 独立生成"真 Office 会写出来的形状"（样式继承编号 /
                      #     AlternateContent / 域代码 / 文本框 / OMML / 合并格 / 百分数与货币格式），
                      #     又独立读回来当裁判；四条两轨逐字一致 + 内容级正向对照
                      #   ★ L 组（2026-10-09）：**旧版 .doc/.xls/.ppt**——CFB / Word97 piece table /
                      #     BIFF8（SST+CONTINUE 跨界重读 grbit、RK、公式变体结果）/ PPT97 record tree /
                      #     RTF 的 GBK 成对与 \ucN 回退 / 改名文档按内容改道；裁判是本机**真 Office COM**
                      #     （scripts/legacy-oracle.ps1 交出 Word 自己认为的正文，断言覆盖 ≥70%、
                      #      PAGE 指令不外泄、页眉不进正文、逐格值与行号对得上）
npm run test:files   # ★ 2026-10-08 共享文件存储层（sfu/files.js）★ 2026-10-09 复跑 59/59
                      #   名字消毒/穿越/三档配额/台账与磁盘对账/.part 卫生/since 下界；
                      #   自证"没把文件写进真实 sfu/files/"（与账号类测试必须用临时库同一条纪律）
npm run review:office # ★ 2026-10-08 真实 Office 样本回扫（路线图 I8）；★ 2026-10-09 认识旧版：
                      #   .doc/.xls/.ppt 一起扫，kind 列显示 legacy:doc/piece，单列「没能抽出文字」
                      #   （只报**结构统计**，绝不打印内容、绝不写文件——会议材料里可能有工资表）
npm run bench:innerhtml # ★ 2026-10-08 量"塞多长 HTML 会开始卡"（给图片上限提供实测依据）
npm run test:office  # ★ 回扫仪表自己的自检（夹具跑，不碰真实文件）★ 2026-10-09 实测 5/5
npm run check:files  # ★ 2026-10-08 **两个真浏览器**验共享文件 ★ 2026-10-09 实测 **71 项 / 0 失败**（带 `REAL_OFFICE_FILE` 时 72/72）
                      #   卖点是一句话：★★★ A 一打开文档，**B 的页面上真的出现了同一份渲染结果**
                      #   （读 B 的 DOM 文字，不是"事件到了"）；另含滚动按比例跟到底、断环、
                      #   XSS 探针（tags===0 && escaped && !boom）、晚到者补发、命中测试（坑 80/119）、
                      #   跟随方向 6 条（那颗按钮不许"抢主讲"）、390×844 手机形态、PDF 翻页换节点；
                      #   ★ 2026-10-09 加：rich.docx/rich.xlsx/**legacy.doc**/**legacy.xls** 各上传一次，
                      #     B 跟着进旧版文档看到同一份正文 + 那句"版式不还原"的说明；
                      #     另可用 `REAL_OFFICE_FILE=<单个文件>` 或 ★10-09 的 **`REAL_OFFICE_DIR=<文件夹>`**（默认 8 份）
                      #     把**你自己那些渲染不出的文件**推过同一条套件（只判"每一份都不许白屏"，不写死内容）

npm run check:all    # ★ 一条命令跑完下面 20 套：自起专用端口 3021 + 临时库 + 错峰（本地 Qwen 关掉以免抢显存）
                     #   端口被占明确拒绝；还自检"清单与 package.json 的 check:* 一一对应"（新增检查漏登记会报）
npm run check:toggle   # 11 项  控制坞开关：两层标签交叉淡入 / 环形脉冲 / 首次点击摆动
npm run check:think    # 12 项  AI 思考条：阶段清单 + 呼吸/收焦（接上一直没人用的 phase）
npm run check:glow     # 11 项  登录页光标光轨（读 gl.readPixels 量到 0.00→0.93→1.20）
npm run check:pill     # 22 项  拱形升起按钮：预览页 + 会中控制坞（改过文案外壳不丢；采样器在页面里每帧取样）
npm run check:visual   # 40 项  聊天分组 / 证据链胶囊 / 发言光晕 / 背景真的在动 / 邀请面板 / 流光与走光边框（含"只暂停这一条动画"的对照实验）
npm run check:icons    # 12 项  ★ 每个 svg.i 的实际渲染宽度 + 全页无 emoji + AI 耳朵的 scaleY
npm run check:dock     # 34 项  ★ 11 档视口下控制坞不溢出、且不与字幕条重叠（每条检查一个专属 CDP 端口）
npm run check:layers   #  5 项  ★ elementFromPoint 命中测试：白板别盖住字幕条与按钮
npm run check:login    # 11 项  ★ 第一屏：11 个 id 没丢 / 焦点环 / 密码可见切换 / 主次分层
npm run check:keyboard #  8 项  ★ 回车提交 / Esc 关最上层浮层 / 焦点可见
npm run check:board    #  9 项  ★ 白板导出 PNG（验像素里真有笔迹）+ 刷新后账本补回来
npm run check:a11y     #  4 项  ★ 减弱动效全覆盖 + 真实渲染对比度达 WCAG AA + 图标按钮有可访问名
npm run check:console  #  4 项  ★ 把界面按真人顺序点 24 步，要求控制台 0 error / 0 未捕获异常
                       #   （含一条"字幕徽标那句读起来是人话"——它抓出过"服务器转写（服务器转写）"）
npm run check:files    # 45 项  ★ 两个真浏览器验共享文件：★★★ B 的页面自己起来并渲染出同一份内容 /
                       #   滚动按比例跟到底 / 断环 / XSS 只是文字 / 晚到者补发 / 命中测试（坑 80/119）
npm run check:wake     #  9 项  ★ 不叫「小明」它就不开口：21 句真实账本喂给页面自己的 aiWakeHere，
                       #   与服务端 shouldWake 逐句对表 + 直接调 emitCaption 看它发不发 ai-ask
                       #   （★ A/B 反跑证过可红：把浏览器判据换回旧宽表，精准红在「说小命的话」「我买了个小米手机」）
npm run admin:list   # 管理员 CLI：看库里有哪些账号 / 谁是 admin（另有 grant/revoke/passwd/adduser/purge）
```

> ✅ **合计 440 项断言全绿**（2026-09-24 实测，历史基线；当前最新数字见下方各条"增量"）：SFU 信令 149 + 存储层 49 + 优雅退出 9 + 冒烟 136 +
> Mesh 36 + 桌面代理 16 + 发布链 30 + 真浏览器 e2e 15 = **440**。
>
> ★ **2026-09-28 增量（服务端 ASR 成为唯一识别路径）**：SFU 信令 **154/154**、
> 前端冒烟 **168/168**（+9 服务端字幕模式断言）、**`npm run test:asr` 15/15**（新增）；
> `npm run doctor` 的 whisper 项由"未检测到"变为 ✅ 可用。事件与取舍见 `LEARN.md` 5.30。
>
> ★ **2026-09-29 增量（G6-② 房间权限分级）**：SFU 信令 **160/160**（+6 四级角色断言）、
> 前端冒烟 **168/168**、**`npm run test:asr` 15/15**（带真服务器复测）。详见 `AGENTS.md` 09-29 条目。
>
> ★ **2026-09-30 增量（性能专项 + 取长补短：设备码配对直连 + 真桌面画质档）**：
> SFU 信令 **184/184**、前端冒烟 **189/189**、存储层 **55/55**、优雅退出 **9/9**、
> 桌面代理 **`npm run test:agent` 24/24**、真浏览器 e2e **15/15** —— 本次重跑的这 **6 组合计 476 项全绿**。
> 本轮**未重跑**：Mesh 36、发布链 30（数字仍是 09-24 的，别当今日实测引用）。
> 存储层由 49 → **55**：新添「口令哈希 V2 / 平滑重哈希」一节（scrypt 参数升档 + 老账号登录时自动升级写回）。
> 事件与取舍见 `LEARN.md` 5.39，回归纪律见 `AGENTS.md` 坑 57~63。
>
> ★ **2026-10-02 增量（语音链路根因修复 → 界面说实话 → 第三条静音死锁，四轮连跑）**：
> SFU 信令 **191/191**、前端冒烟 **237/237**、`test:asr` **28 通过/1 跳过**、
> `test:asr-live` **PASS**（qwen-local 转写实测 1.4s / 2.4s，静音期零字幕、
> ASR 2 条 / 应答 2 次，语音交付回落浏览器朗读 **1.6s**）、`test:e2e-media` **15/15**、
> `test:qwen` **10/10**、`doctor` 全绿。本轮最值得记的三条教学结论写进
> `AGENTS.md` 坑 **64~68**：**「装了 ≠ 用上了」的 UI 版**（界面硬编码 whisper 字样，
> 让用户判定引擎没切）、**「让位/静默」类闸门会把刚生成的那一轮一起挡死**
> （判据要认人不认时间）、**共享变量有两个读者时，攒批清空的那个会让另一个静默空转**。
>
> ★ **2026-10-04b 增量（后半夜：把"写了"证明成"真在跑"）**：前端冒烟 **374/374**、SFU 信令 **213/213**、
> `test:asr` **49 通过/0 失败/0 跳过**、`test:asr-live` **PASS**（两条字幕 / **应答 2 次不多不少** /
> 定稿 3.8s 与 1.3s）、`test:e2e-media` **38/38**、**`npm run check:all` 13/13 条 = 162 项界面断言**、
> `soak` 压缩 7 分钟 **PASS**（42 条归档对账一致、0 错误）。`test:e2e-asr` 这一场**没能稳定跑通**
> （机器被并行任务压满时 `Runtime.evaluate` 超时；它的设置阶段——固定名临时库——已修好），
> 跑通与否如实挂在这里，不拿"应该能过"当成绩。本轮三条教学结论进
> `AGENTS.md` 坑 **81~83**：**假环境缺一种宿主能力 = 那条分支永久不测**（补桩要补得"像真的"，
> 回调链也要补全）；**同一份配置有 N 个读取器而只有一个写入点，界面就会说胡话**
> （"服务器转写（服务器转写）"，而只查关键词的断言一直绿着）；
> **量具自己也是负载来源**（`?nosw=1` 每次加载自带一趟自我导航、13 条检查共用同一个 CDP 端口、
> 临时库用固定名把上一轮的账号数进这一轮）——红的会自己挪地方，就别去改产品代码。

> ★ **2026-10-08 增量（第 51 步：共享文件浏览 —— 零依赖读 Office + 全房间同看一页）**：
> **`npm run test:fileview` 234/234**（新；同日两轮 +44）、**`npm run test:files` 59/59**（新）、
> SFU 信令 **270/270**（+第 51 步一组 44 项）、前端冒烟 **499/499**、
> **`npm run check:all` 20/20 条 = 356 项界面断言**（新增双浏览器 `check:files` 45 项）；
> 同轮全量复跑：`test:asr` 218 · `test:nets` 31 · `test:review` 40 · `test:watch` 54 · `test:store` 55 ·
> `test:shutdown` 9 · `test:tts` 13 · `test:ai` 10 · `test:ai-brain` 75 · `test:publish` 30 · Mesh 36 ·
> `test:quiet-mic` 11 · `test:room-actions` 17 · `test:e2e` 16 · `test:e2e-reconnect` 15 · `test:e2e-media` 38 ·
> `test:agent` 24 · `test:record` PASS · `test:turn` PASS · `doctor` 24 通过/1 警告/0 失败。
> 本轮三条教学结论进 `AGENTS.md` 坑 **118~120**：
> **平台分支要分别证明被执行过**（浏览器那一轨的解压在真浏览器里**自死锁**、Node 却全绿——
> 因为 Node 18+ 也有 `DecompressionStream`，而判据顺序让单测跑的是"另一副身体"）；
> **"页面处在用户到得了的状态"本身就是被测内容**（检查走后门跳过「进入会议」，
> z100 的首屏遮罩一直盖着会议界面，DOM 断言全绿而 `elementFromPoint` 报 `MAIN#hero`）；
> **轮询条件必须等于断言条件**（轮"B 能滚了"读到的是节流窗口里的中间态，假红）。

> ★ **2026-10-08 凌晨第二轮（不加新功能面，只把这条功能自己的证据打厚；路线图 I 档 I1~I5）**：
> `test:fileview` 190 → **234**（新增 O 组「真实世界的怪形状」22 条：docx `vMerge` 与 `gridSpan` 同表混用 /
> xlsx 公式**有没有缓存值** / 自定义 numFmt 里的引号字面量 / pptx 的 `notesSlides` 备注页 / 扩展名与内容对不上时的**有意边界**，
> 每条都配一个能打红它的变异）；`check:files` 33 → **45**（★★ **PDF 翻页从来没真的翻过**：只改 `#page=` 片段
> 内置阅读器一动不动，实测两页黑占比 58.9% vs 58.9% ⇒ 改成 `mountPdf()` 重建 iframe；另加 390×844 手机形态 5 条含命中测试）；
> `test:review` 40 → **47**（「共享文件」结论行：没人传明说"不是故障"、拒绝原因摆出来、清理失败单独一行）；
> `npm run soak` 从三类流量变**四类**（上传 → 下载比字节 → 修剪 → 与服务器清单对账 → 报视角，
> 收尾多一段「房间销毁对账」：宽限期到点之后**目录真的没了**）—— 6 分钟真跑实测：
> 上传 18 份 · 删除 15 份 · 对账 18 次不平 0 · 视角 18 发 → 18 收 · 目录已随房间销毁 · **PASS**。新坑 **121/122/123**：
> **跨插件的"我设置过了"不算数**（要量对方重做了没有）；**量不稳的读数不配当判据**（无头里 PDF 插件像素
> 同一页读到 34/49/94/53% ⇒ 降为观察值 + 进人工清单）；**变异路径没被执行过的 A/B 也是假绿**
> （第一次证红时上传数没超过保留上限，被改的那行根本没跑，所以照样绿）。
> ★ **同日 I9：把"泛化量具"用到这条新功能上**（`test:asr` **222/222**）——规则表配的 15 句电池全绿，
> 另写 30 句从未进表的自然说法，首跑 **open 9/18、close 9/12**（又是坑 106 那个 50% 缺口）。
> 缺口形状很具体：名词侧写成了**字面短语清单**，而口语用**远指 + 量词**（「把文件那块弄出来」）、
> 动词会**倒装**（「文件面板亮起来」）、礼貌请求长得像**问句**（「能看下文件清单吗」）。
> 改成**成分式**规则后 open 17/18、close 12/12、反例 0/8；三组断言一起钉：
> **泛化组 / 谈论组 / 有意不接组**（「这个文档讲了什么」必须不动界面；「共享文件呢」是决定不是疏漏）。
> 新坑 **124**：加宽任何"从自然语言判意图"的规则，验收必须**同时**跑这三组。
> ★ **同日 I8：把"真实文件回扫"变成常驻仪表**（`npm run review:office`，只报结构、绝不读内容）——
> 第一次拿本机现成的 **25 份真 docx/xlsx/pptx** 过渲染内核，抓到一条**限额作用域**的真缺陷：
> 那条"一份文档 16MB"的图片上限，因为 pptx 逐页调用而实算是"每页 16MB" ⇒
> 一份 media 只有 7.5MB 的真 PPT 被渲染成 **40.4MB 的 HTML**（修完 10.7MB，并明说省略了几张）。
> 我还为它写了 `npm run bench:innerhtml`，因为**我原先以为"插入就冻住"**——实测 40MB 只要 145ms，
> 于是注释与代码一起改口（没量过的因果不写进注释）。回扫结果：**25 份 · 抛错 0 · 文字极少 0**。新坑 **125/126**。

> ★ **2026-10-08 凌晨第三轮（仍然不加功能：把证据厚到压出两条"把用户的意思做反了"的缺陷）**——
> ① **「跟随主讲」那颗按钮按下去其实是"抢主讲"**：跟随的解耦只写了一半——
>   `applyRemoteView` 有"不跟随就不收"，`emitFileView` 却没有对称的那半，
>   于是 B 关掉跟随自己翻页会**把全房拽走**；而再点一下那颗按钮，代码写的又是 `emitFileView(true)`
>   = "我宣布由我带大家看"。真浏览器双窗先量红（`A 现在=评审结论.md`、`B 现在=(没跳回来)`、
>   A 的徽标变成"跟着 某位成员"而 A 什么都没做），修完同一批断言转绿：
>   **解耦改成双向**（不跟随就不发）+ 新增唯一入口 `rejoinPresenterView()`
>   （打开跟随 = 我跳回主讲，**复用** `applyRemoteView` 那条正路，不写第二份）。新坑 **128**。
> ② ★ **「@ai 打开白板」根本没走到房间动作那一步**：聊天入口从 09-19g 就写着
>   `/^(操作|打开|点击|帮我操作|远程)/` → 命中就发 `ai-op`（远程操作**别人电脑**那条链路），
>   于是"打开 + 房间实体"这类话在**客户端**就被改道，服务器那张 `ROOM_ACTION_RULES`（排在 LLM 之前）
>   根本没机会跑；房里没有被控端时 AI 回一句"先有人共享屏幕…"——**答非所问、界面一动不动、零报错**，
>   正是用户报了五次的那句"AI 操控实体类的功能还是实现的不行"的其中一条成因。
>   ▸ **为什么 17 项真浏览器用例一条都没抓到**：那些用例全说「把白板打开」「开启实时字幕」「切到宫格」，
>     **没有一句以"打开"开头**（坑 106 原样复发）。修法不是再补一个例外，而是**换判据的维度**：
>     "提到哪台机器"（电脑/桌面/浏览器/记事本/计算器…）×"要做什么动作"，
>     房间级开关交回服务器那张表。冒烟加三条红线（含"正例必须仍然走 ai-op"的反向对照），
>     三条正则**从 client.js 源码里抓**、不在测试里重抄；旧判据复跑，红得又准又狠。新坑 **127**。
> ③ **量具两条自我纠错**（都不是产品代码错，但都会把人引向错方向）：
>   "焦点落在行上操作区会显形"第一版红在 `opacity=0` —— `.file-acts` 有 `.14s` 过渡，
>   而我在 `focus()` 之后同一个 evaluate 里取值 = 必然读到起点（"量具跟自己的动画赛跑"第六次应验）；
>   冒烟那组"跳回主讲"第一版直接调内部函数，于是变异测试只红了结构那条、**行为断言跟着绿**——
>   桩本来就支持 `dispatch('click')`，改成真点那颗按钮之后同一个变异红 4 条。
> **实测（顺序跑，全绿）**：`check:files` 45 → **58/58**（两个真浏览器）· `test:smoke` 499 → **514/514** ·
> `test:fileview` 234 → **240**（★ O 组那些**真实世界的怪形状**以前只走过 zlib 那一轨——"真正发出去的那几行代码从没渲染过它们"；现在四份形状两轨逐字一致 + 两条**内容级正向对照**，防的正是"两轨一致地什么都没渲染"这种假绿）·
> `check:theme` 25 → **26**（★ 这块新面板是 H4 那轮"掀开浮层扫一遍"之后才加的，浅色档对比度**今天之前没人量过**；
> 现在清单走生产的 `renderFilesList()`、文档区 `await` 生产的 `FV.render()`，并且**覆盖率要点名**——
> SWEEP 带回 `sigs`，新增"必须看到 ≥4 个 `file-*`/`fv-*` 签名"那条，因为总量哨兵看不见"某一块静默没注入"。
> 实测：签名 9 个 · 扫描面 57 → **68 处** · 两档不合格 **0/68** = 量过之后确认干净）·

> `test:room-actions` 17 → **21/21** · **`check:all` 20/20 条 · 369 项界面断言** · SFU 信令 **270/270** 复跑。
> 服务器与文件层**一行没改**（全部在 `client.js` + 那颗按钮的 title + `protocol.js` 口径 + 三个测试脚本）。
>
> ★ **2026-10-09 增量（"word 还是不能观看"与"外面的人进不来"这两句查到底 —— 路线图 J 档 + K 档）**：
> ① **旧版 `.doc/.xls/.ppt` 从零读出来**（零依赖不变）：OLE2/CFB 复合文档 + Word97 piece table +
>   BIFF8（SST/CONTINUE/RK/公式变体结果）+ PPT97 record tree + RTF 的 GBK 成对解码；
>   改名的按内容**改道**。**裁判不是我自己**：`scripts/office-oracle.py`（python-docx/openpyxl 独立写独立读）
>   与 `scripts/legacy-oracle.ps1`（**本机真 Word/Excel/PowerPoint COM** 交出它自己认为的正文，
>   断言"抽出文字覆盖真值 ≥70%、`PAGE` 指令不外泄、页眉不进正文、逐格值与行号对得上"）。
> ② **新格式里"有但没画出来"的东西**：样式继承的编号（`basedOn` 链 + `numId=0` 是**否决**）、
>   `mc:AlternateContent` 只取一份、**域代码取结果不取指令**、文本框、OMML 公式、
>   Excel 的"值 + **格式码**"（百分数 ×100 / 货币千分位小数位 / `正;负;零;文本` 区段）、合并单元格、行号忠实。
> ③ **跨网那一层做实**：`WebRtcServer` 把全部媒体汇到**一个固定端口且同端口开 TCP**（封 UDP 的网络靠 TCP 候选）+
>   **多地址通告**（`announceIps()`，虚拟网卡按**名字**挡）+ `stun-probe.js` 读**反射地址**
>   ⇒ "这台在不在 NAT 后"第一次变成打印出来的事实（实测：反射地址（公网出口）≠ 通告地址（内网））。
> ④ **两处由回归自己抓出来的真缺陷**：邀请面板没有高度上界（自检从 5 条长到 7 条 ⇒ 矮窗口里最后一行
>   连同"可复制的修复命令"掉到屏幕外，修 = 结构性上界 + 内部滚动，两次 A/B 各红一条）；
>   `test:asr-live` 默认跑在**兜底引擎**上（≠ 用户配置）⇒ 把"等主引擎就位"改成默认。
> 实测（本批顺序跑）：**`test:fileview` 292**（240→292）· **`check:files` 71**（58→71，两个真浏览器，
> 含真旧版文件；带上用户自己那份真文件（`REAL_OFFICE_FILE`）跑时 72/72）· **`test:crossnet` 17（新套件）** ·
> `test:nets` **42**（31→42）· `test:stun` **8（新）** · `check:invite` **12**（8→12）·
> `test:office` 5 · `test:review` 47 · 冒烟 **521**（514 + L7 两条浮层上界红线 + L6 一条"报告器必须接守卫" + 4 条守卫单测）· 信令 **270** · `test:asr` 222 · watch 54 ·
> store 55 · shutdown 9 · tts 13 · qwen 10(+1skip) · ai 10 · quiet-mic 11 · room-actions 21 · publish 30 ·
> `doctor` **25 通过 / 1 警告 / 0 失败** · **`check:all` 20/20 条 · 388 项界面断言**（`check:theme` 26→**27**：新加"存储里的主题选择确实已清空"这条前提断言，见 AGENTS 坑 137） ·
> `test:e2e-media` 38 · `test:e2e-asr` **25** · `test:e2e-reconnect` 15 · `test:agent` 24 · `test:e2e` 16 ·
> `test:asr-live` **PASS**（默认等主引擎就位 38s ⇒ 定稿 2 条全部 `fin=silence`、⏱ 3.1/3.0s、
> **整句重转采纳 2/2 且两句逐字全对**、应答 1 次不多不少）·
> **`soak --minutes 8` PASS**（8 分钟 · 信令 239 条 · 断线重连 0 · 归档 48 条对账一致 ·
> 健康检查 16 次 0 错误 · 文件：上传 8/删除 5/对账不平 0/视角 8 发→8 收/房间销毁后目录已删）。
> ★ **L7 收尾 + 长跑复证（本批最后两条）**：把"锚定式 `position:fixed` 浮层必须有 `max-height`"升级成**冒烟结构红线**
>   （豁免整屏层 / 上下双锚 / `pointer-events:none` 的装饰层 / 1px 隐形件，且**按选择器聚合**再判——
>   只看单条规则会把"基础规则已有界、媒体查询只改位置"的合法写法判红），
>   当场补掉两处缺上界的浮层：`.remote-ask`（授权卡，文案来自远端）与 `.toast`（提示条，底部锚定 ⇒ 只往上长）；
>   两条各 A/B 证过可红：摘掉邀请面板上界 ⇒ 红线**点名 `.invite-panel`**；把扫描正则改盲 ⇒ **覆盖面哨兵**红（"扫到 0 个"）——
>   **正则失配时红线会永远绿，那就是白装**（坑 105 的自检版）。冒烟因此 **516/516**。
>   `test:voice-longrun` 这次也跑通了：**7/7**（5 分钟真浏览器 · 定稿 **39 条** · 最大字幕间隔 12s ·
>   **0 崩溃 0 永久放弃** · AI 应答 **27** 次 · 最快定稿 **1.7s**）。
> 教学结论进 `AGENTS.md` 坑 **130~134**：**签名/常量不许从记忆里写**（`wIdent` 真值 `0xA5EC`，
> 我写成 `0x01A5` ⇒ 每个 .doc 被"干净地"拒收）、**整数宽度读错**（SST 计数是 u32）、
> **漏一个 `await` 让改道路径一次都没生效**（坑 76 家族）、**"能改属性"不等于"用户够得着"**
> （JS 设 `scrollTop` 在 `overflow:hidden` 上照样成功 —— 测可达性要用真滚轮）、
> **默认值要指向用户真实配置**（要额外开关才测到真配置的测试，迟早把人引向错误的红点）。


- SFU 版测试（**2026-09-30 实测：184 通过 / 0 失败**；冒烟 **189/189**；09-24 基线为 149/136）：房间/密码复用 + mediasoup Router 能力 +
  Transport 创建与防重 + consume 错误路径 + 远程协助（授权/互斥/输入门禁/二进制与中文透传）+
  A/D 档（成员状态白名单、房主踢人、剪贴板门禁、文件配额、限时授权、切层错误路径）+
  D+ 档（`sctpParameters`/`produce-data`/`consume-data`、跨房间录制目标被拒、VP9 能力、
  房主迁移、空房 TTL 宽限期内原号回归、`/api/rooms` 与 `/dashboard`）+ 09-16 **auth 8 项**
  （注册/重复注册/错密码统一提示/登录/token 恢复/伪造 token/昵称贯通 room-state）+
  09-17b 字幕状态入册 + **09-24 门禁边界 + 房间令牌 15 项**（甲类该拦的拦；
  乙类无令牌→401、带 `X-Room-Token`/`?roomToken=`→200、跨房令牌→401、签名篡改→401、
  payload 篡改→401、过期令牌→401；`/api/rooms`/`room-state`/`room-members` 三处**不含他人令牌**的泄露检查；
  录像：签名有效但文件不存在→**404**（区别于 401）、exp 过期→401、sig 改一字符→401、管理员不签名也过→404；
  以及"**游客凭房间内令牌可归档并回读**"的正向回归）。
  ⚠️ **真实音视频、simulcast 三档、说话人检测、浏览器侧录制、触屏手势、滤镜与字幕需要浏览器人工验证**
  （命令行只到信令层）；清单见 `后续升级方向.md` 第 0.2 节。
- **账号存储层 `npm run test:store`（2026-09-24 实测：49 通过 / 0 失败）**：
  建号/查询/改密换盐/删号（含"拒绝删除唯一管理员"安全闸）/完整性自检，以及**旧 `users.json` 迁移**
  （断言原样保留 salt/hash、不重新哈希）+ **迁移不污染真实库**的硬断言自证（真实 `sfu/users.json`
  逐字节一致、`sfu/data/` 下没被建库）。
- **优雅退出 `npm run test:shutdown`（2026-09-24 实测：9 通过 / 0 失败）**：
  用 `TEST_SHUTDOWN_AFTER_MS` 主动触发退出路径，验"关 Worker → 关库 WAL checkpoint → 退出"、
  幂等、5 秒保险丝、以及正常退出不再被误报为 Worker 崩溃。
- Mesh 版测试（**2026-09-24 实测：36 通过 / 0 失败**）：建房拿号、凭号加入、room-not-found、
  new-member 广播、offer/answer/ICE 定向转发、room-full 拒绝、peer-left、空房自动销毁、
  入会密码三关校验、远程协助全链路 + 限时授权（`expiresAt`/到期自动复位/无幽灵定时器/blocked 透传）。
- **前端无头冒烟测试 `npm run test:smoke`（2026-09-24 实测：136 通过 / 0 失败，零依赖、不用起服务器）**：
  用最小 DOM + 假 mediasoup-client 把 `sfu/public/client.js` 真跑一遍——顶层执行、
  媒体链路与 **simulcast 三层 encodings 接线**、成员列表/音量/换层、远程协助控制层采集
  （含触屏长按与双指）、文件分块、剪贴板、录制、设备切换、断线重连，以及 **F7 三条 SCTP 频道、
  F6 滤镜管线、实时字幕（识别→定稿→广播→续命→导出）、登录卡与昵称、移动端/PWA 与省流**。
- **AI 双轨自检 `npm run test:ai`（2026-09-24 实测：10 通过 / 0 失败）**：
  🚧 Mock 轨（零网络零费用，永远可跑）验"降级链路没断"——provider 判定、mock 钩子、
  流式降级也分片喂出、离线纪要三小节、agent 不死循环；
  🚀 LLM 轨（检测到 key 才跑，缺 key 自动 skip 提示）验"模型真在干活"——
  答案不含 `[Mock]`、纪要事实取自输入、问答命中原文、操作员产出合法 JSON 计划、流式有增量。
  结束后打印调用次数与**估算花费**（本次自检 5 次调用 ≈ ¥0.0028）。
  服务器侧同样可核对：`curl http://localhost:3001/metrics | grep sfu_ai_llm`。
- **★ AI 看板真浏览器端到端 `npm run verify:board`（2026-09-25 实测：21 通过 / 0 失败）**：
  这一层**不是又一层 Node 断言，而是真的开一个浏览器**。为什么必须有它：
  本项目吃过「模块对、接线断」的亏（`brain.js` 的记忆忘了 `push`，单测全绿但功能是死的）。
  而这一轮新增的东西横跨四层——字幕上行 → HTTP 入库 → digest 消化 → `ai-board` 广播
  → **真实 DOM 渲染**——**第四层是纯浏览器行为，用桩 DOM 断言等于自欺**。
  做法是复用项目自带的 `agent/cdp.js`（CDP 客户端，本来就是给「真远程桌面」用的，零新依赖）：
  起真服务器（临时库，不碰生产数据）→ 开真 Edge → 走**真实 UI 流程**进房（游客 → 预览 → 加入）
  → 灌真字幕 → 在真页面里 `evaluate` 读**真实 DOM** → 真截图存证（`sfu/shots/ai-board-live.png`）。
  覆盖：看板四栏目渲染 / 闲聊绝不进板 / 行动项三字段 / 侧栏三分段 / 快捷问法**真点击**链路
  / 看板「出纪要」真落盘 / 聊天未读角标 / **语音链路**（在 `speechSynthesis.speak` 上装探针，
  断言真正交给语音引擎的文本已洗掉 markdown）/ **证据链展开**（断言证据是「决定本身」而非检索噪声）/ **行动项认领闭环**（真点「我来」→ 服务器记账 → 重复认领被拒 → 认领进入纪要）。
  另外它当场**揪出过一个真缺陷**：看板把「交付时间定在 11 月 20 日」归成了「行动项」并打「待认领」
  ——这是真截图上肉眼可见的错分，Node 侧的桩 DOM 断言永远发现不了。

- **★ AI 智能内核单测 `npm run test:ai-brain`（2026-09-24e 实测：30 通过 / 0 失败）**：
  验的是"AI 的**结构性保证**"——答得够不够好无法自动断言，但下面这些能：
  **检索**（关键信息被 25 条闲聊隔开仍能命中 Top1、无关句不进上下文、证据块有字符预算）；
  **记忆**（有界、指代时拼上一轮、长答案截断）；**意图**（"纪要"换三种说法都要认出来）；
  **行动项**（能抽出 owner/task/due、**提不到负责人必须留空而不是编造**）。
  LLM 轨另加 4 项真模型断言：意图分类认出口语说法、行动项三元组、**抗幻觉**（证据里没有的要承认"没提到"）、**隔 30 条的信息能答对**。
- **★ AI 真服务器端到端 `npm run verify:ai`（2026-09-24e 实测：6 通过 / 0 失败）**：
  它补上单测补不了的一层——**接线**。会真的起一个服务器、建一个房间、写一份"长会字幕账本"，
  然后走真信令真模型跑完：检索型问答（答案含被隔开的"11 月 20 日"）、流式打字机 + 证据链、
  追问结合上文（"那他什么时候交"→"周五之前提交"）、**换个说法触发纪要并真的落盘**、
  结构化行动项表格、抗幻觉。**为什么必须单独做这一层**：本项目吃过"模块单测全过、
  但调用方忘了接线"的亏（见 AGENTS 坑 41）——集成点只有跑起来才能验。
- **桌面代理端到端 `npm run test:agent`（2026-09-30 实测：24 通过 / 0 失败；09-24 基线 16 项）**：
  真起 Chromium + 真跑服务器 + 真授权 + 真收 JPEG 帧 + 真注入 16 字节控制帧再回页面读坐标。
  最严的一条是坐标：发归一化 (0.5, 0.5)，页面 `clientX` 必须**正好**等于视口宽一半（±3px）——
  实测视口 1254×707，期望 (627,297) = 实际 (627,297)，跨分辨率都点得准。
  09-30 新增的画质档断言走**同一条老通道**（`remote-input` 里 `{kind:'quality', preset}`）：
  切「高清」后代理确实重开抓屏（fps/quality/分辨率都变）、画面**持续推帧**（重开没把链路搞断）、
  重复切档**不堆监听器**、未知档位**忽略而不崩**。
- **真机远程桌面 e2e `npm run test:e2e`（2026-09-30 复跑：15 项全过）**：
  真浏览器双窗口走完整流程（游客进会 → 创建房间 → 起 agent → 授权 → 收真画面 → 远程导航
  到 `https://example.com/` → 切手机视口 390×844 试双指滚动与单指点击 → 退出控制），
  截图落在临时目录 `wb-rd-shots/`。**它的 profile 每次清空**——否则测的是缓存不是代码（见 LEARN.md）。
- **发布链回归 `npm run test:publish`（2026-09-24 实测：29 通过 / 0 失败）**：
  验"生成 → 体检 → 过期闸"三段：发布包与源码逐字节一致、默认 ICE 含带凭证的 TURN、
  `/config.json` 带 `no-store`、`--check` 在源码改动后**必须报错退出**（且只读、不重建）。
- ✅ **环境自检 `npm run doctor`**：17 项 / 4 组（环境·配置·端口·跨网 ICE），每项都给"怎么修"；`node scripts/doctor.js --json` 出结构化结果。交付前先跑它，再按《部署手册.md》自查清单收尾。
  手动核对（`npm run test:turn` 验 ICE 可达、端口是否被占、ffmpeg 是否在 PATH）。

---

## 🗺️ 已走完的开发历程（对应教学章节，简历按这个讲）

| 阶段 | 功能 | 技术点 |
|---|---|---|
| 1 | 1对1 视频通话 | getUserMedia / RTCPeerConnection / SDP / ICE-STUN / 信令 |
| 2 | 多人会议 (Mesh 3 人) | Mesh 概念 / 房间信令 / peers 字典 + 定向转发 |
| 3 | 屏幕共享 | getDisplayMedia + replaceTrack（Mesh 换轨） |
| 4 | DataChannel 群聊 | createDataChannel / ondatachannel（Mesh P2P） |
| 5 | 房间化 | create-room / join-room / 房间号生成与回收 / 邀请链接直达 |
| 6 | 入会密码 | 房间记录 password / join-room 三关校验 / room-wrong-password |
| 7 | 网络质量监控 | getStats 丢包率/RTT/码率（每 3 秒采样） |
| 8 | **SFU 架构版（主版本）** | mediasoup Worker/Router/Transport/Producer/Consumer、consume 后 resume、屏幕=第二路 Producer（sfu/ 目录） |
| 9 | **H5 远程协助（Mesh 版）** | ctrl_ DataChannel 控制命令流 + 授权互斥信令（remoteCtl 表）+ 坐标归一化（cover 裁剪修正）+ rAF 节流 + 同源 iframe 事件重放 + 远程光标（`public/workbench.html`） |
| 10 | **SFU 版远程协助（A1 升级）** | 授权信令照抄 Mesh；输入流改 `remote-input` 信令定向转发 + 服务器输入门禁；控制层锚定"屏幕独立格"；采集/重放与 Mesh 逐行同构（`sfu/` 目录，教学导读 LEARN.md 5.7） |
| 11 | **中文 IME + 控制质量工程化（A2/A5 升级，两版同步）** | 隐藏 IME 捕获框收 `compositionend` 整段中文（key='Process' 闸门）+ ``{kind:'input-text'}`` 一次插入；鼠标/滚轮命令 16 字节 ArrayBuffer 定长帧；RTT 自适应节流（<80ms 每帧→>200ms 每 4 帧）；Mesh 版 bufferedAmount 积压丢帧（教学导读 LEARN.md 2.12.7） |
| 12 | **远程协助深化（A3/A4/A6/A7 升级，两版同步）** | 剪贴板**双向**同步（新双向事件 + 控制关系门禁）；远程截图（canvas 抓帧）+ 分块文件传输（服务器配额校验、两版流控策略不同）；限时授权（服务器 `expiresAt` + setTimeout 撤权 + 双端倒计时）+ 被控端本地审计日志 + 拉黑；触屏长按=右键、双指=滚轮（教学导读 LEARN.md 2.13） |
| 13 | **会议本体 + SFU 深究（D1~D6 升级）** | Simulcast 三档上传 + **服务器按丢包率自动升降层**（迟滞防抖）+ 手动锁层；服务器端 **AudioLevelObserver** 说话人检测；设备热切换（replaceTrack）；`room-state` 成员状态机 + 房主踢人；canvas+WebAudio 合成录制；socket 断线后**整条媒体链路重建**（教学导读 LEARN.md 5.8） |
| 14 | **对齐商业产品体验（F1~F3，参考声网形态自研）** | 宫格/演讲者**双布局**（大画面优先级：钉选📌 > 共享者 > 说话人 > 自己；切布局只换 CSS 类不搬 DOM）+ 📌 钉选 + 双击全屏；**每成员网络质量点**（新信令 `net-levels`：服务器每 3s 量每人最差路丢包率、有变化才广播）；**加入前预览页**（镜像预览 + 设备选择 + AnalyserNode 试音条 + 预静音；无媒体也可进房）（教学导读 LEARN.md 5.9） |
| 15 | **SFU 数据通道（D+1 升级，主版本独有）** | 聊天从"全走信令"升级为 **SCTP 双路径**：`enableSctp` 开关 + `produceData/consumeData` 广播频道为主路（与音视频同链路，服务器零转发代码），信令广播兜底，接收端按 `msgId` 去重（教学导读 LEARN.md 5.10） |
| 16 | **观测面板 + 可达性自助版 + 拟真工作台（09-13 五线并进）** | `GET /api/rooms` 全景快照 + `/dashboard` 零依赖面板（2s 轮询、页面做差算实时码率、canvas 折线）；`sfu/config.json` 统一管端口/IP/ICE/HTTPS（https.enabled 自动自签）+ 「🔗 连接方式」徽标（直连/STUN/TURN 可见）；workbench v3（开机动画/最小化/换壁纸/**实时字幕 HUD**：client 派发 `remote-activity` CustomEvent，工作台仍不知道 WebRTC）；两版 CSS 主题层（教学导读 LEARN.md 5.11） |
| 17 | **F4 表情回应 / 举手 / 发言占比（09-13）** | 表情 = D+1 数据通道上的第二种消息 `{type:'react'}` 全房飞屏（数据通道首个非聊天应用）；举手 = `member-state` 白名单加 `hand`；发言占比 = D2 的 AudioLevelObserver 顺手记账 → `talk-stats` 有变化才广播（教学导读 LEARN.md 5.11.2） |
| 18 | **SCTP 多频道 + F5 协作批注 + 带宽估计可视化 + UI 主题 v2（09-14）** | `setupDataChannel` 开两条 DataProducer（'chat' + 'annot'），订阅端按 label 路由；批注 = 屏幕格 canvas 覆盖层 + `{type:'annot', to, op, x, y}` 归一化事件溯源（本地画与远端收走同一条 `applyAnnotOp`）；`availableOutgoingBitrate` 挂进连接方式徽标；Radix/Primer 式 token 体系（教学导读 LEARN.md 5.12） |
| 19 | **D+3 带宽估计与 VP9 SVC / D+4 房间 TTL 与房主迁移 / E5 演示包（09-14c）** | Router 加 VP9，`videoSvc:true` 走 L3T3 单路分层（回退链 SVC→simulcast→单层）；服务器 ABR 双维度（丢包率 + `availableOutgoingBitrate` 的 bweCap）；空房 60s 宽限期（`scheduleRoomTtl`/`destroyRoom`）+ 房主迁给最早进房者（`joinedAt`）；`npm run start:demo` + 《演示脚本-5分钟.md》（教学导读 LEARN.md 5.13） |
| 20 | **D+2 服务器侧录制（09-15 / 09-15c 端到端打通）** | PlainTransport×2 RTP 旁路 → 生成 SDP → `spawn ffmpeg -c copy` 落盘 recordings/ → `/recordings/<file>` 下载；录制核心抽成模块级 `startRecording()`（信令与自测共用）；**TEST_RECORD=1 自测通道**用 ffmpeg 当媒体源走完整链路（产物 251KB/4.0s，ffprobe 验证）；踩坑：webm 需关键帧起写、Windows 退出后 remux 补 trailer（教学导读 LEARN.md 5.14/5.16.1） |
| 21 | **F7 独立协作白板 / E1 TURN 开箱即用（09-15c）** | 第三条 SCTP 频道 'board'（房间级共享画布，无 `to` 定向头）；`config.example.json` 预置 openrelay 免费 TURN + `deploy/coturn/` 自建包（docker-compose + turnserver.conf）（教学导读 LEARN.md 5.16.2/5.16.3） |
| 22 | **登录注册 + 排版根治（09-16）** | users.json + 内置 `crypto` scrypt 哈希（不引 bcrypt）+ `auth-register/login/verify` 三信令 + 内存 token（游客可进、localStorage 自动恢复、昵称贯通成员列表与聊天气泡）；**坑 26**：style.css 注释里写 `.annot-*/` 提前闭合注释 → `:root` 整块被丢弃 → 全站 CSS 变量为空（防守三件套：注释不写 `*/`、静态响应 `no-store`、样式引用带版本参数）（教学导读 LEARN.md 5.17） |
| 23 | **一键局域网交付（E2 + 跨电脑体验，09-16c/09-16d）** | `start-lan.bat` / `npm run start:lan`：探 IP → 备份并生成配置（0.0.0.0 + announcedIp + HTTPS 自签 + openrelay TURN）→ 自动 netsh 放行防火墙 → 打印"本机/局域网/跨网"三地址；`npm run test:turn` 手搓 STUN Binding 实测 ICE 可达（本机：Google STUN 可达、openrelay UDP 被封但 TCP 443 可达）；`/config.json` 下发 `lanUrl` 让邀请链接跨机可用（《部署手册.md》《跨电脑连接-操作指南.md》） |
| 24 | **性能基准数字（E4，09-16c）** | `scripts/bench.js` 三档实测（4/8/16 路）：16 发 16 收 8263 kbps、单核 6%、零丢包；ffmpeg 合成源 → PlainTransport → mediasoup 转发 → dgram 真收包统计（《性能测试报告.md》） |
| 25 | **滤镜与虚拟背景（F6，主版本独有）** | canvas 三站流水线：GPU ctx.filter 滤镜（原图/自然/冷白/暖阳/水墨）→ 1/4 画布低清模糊放大=磨皮 → 色键（绿幕/蓝幕）逐像素抠像换背景（墨/绢/鎏金/图片）；captureStream(24) 出轨后 replaceTrack 上行，处理后轨顶替进 localStream（publishTracks/关摄像头/D6 重连零改动）；每帧 EMA 耗时徽标="CPU 账"可视化；纯前端零依赖、不引 ML 模型（教学导读 LEARN.md 5.18） |
| 26 | **实时字幕（AI 线 L1，主版本独有）** | Web Speech API 识别自己麦克风（每端识别自己=省带宽/隐私/语言跟人走）；interim 半句只本地跳动、final 成稿经 SCTP chat 频道广播（不做信令兜底——字幕容忍丢、聊天不容忍，可靠性按内容价值定价）；字幕账本 cap.log（时间戳/说话人/文本，500 条环形）= C2 会议纪要/问答的 LLM 输入，⬇ 一键导出 txt；历史抽屉（cap.log 滚动视图）+ member-state.caption 进房间状态机（成员行 💬 徽标）；onend 自动续命 + network 明确降级（教学导读 LEARN.md 5.19） |
| 27 | **过夜值守（AI 线 C3-N1，主版本独有）** | 目标="睡前启动、无人值守跑 ≥7 小时、早上拿全档字幕+值守日志"：账本溢出归档（内存 500 条热窗口 + 服务器 jsonl 权威副本）、network 3 次永久停改指数退避（约 45 分钟才放弃）+ 30s 看门狗巡检自愈、值守统计与 30 分钟心跳、导出合并服务器全档；`npm run soak` 服务器耐久自测（默认 7h、--minutes 压缩、对账"一条不丢"）；零依赖零费用不需要 key（教学导读 LEARN.md 5.19.5） |
| 28 | **过夜全面升级（09-18）** | 前端美学 v3（全站暖墨统一/演讲者视图=大画面+胶片条/说话人金环呼吸/入场动效+reduced-motion 降级，真浏览器截图四屏验证）；宫格布局语义修正（tile-main 全宽圈定演讲者视图）；演讲人交接迟滞收尾+attachRemoteMedia 元数据腐蚀真 bug 修复（坑 32）；C1 值守日报（第 31 步）；G7 /metrics 首刀；dashboard 暖化；项目清理（config 备份×9/工具会话数据/运行时产物）+ start-lan.bat 路径修复 |
| 29 | **丝滑化+跨网审计+G7-②③（09-19）** | 演讲者大画面 16:9 contain 收敛（不再撑满）+ View Transitions 布局过渡（0.25s crossfade，签名变化才触发）+ 全局平滑滚动；跨网根因澄清（SFU 媒体不走 TURN，announcedIp 可达是唯一关键）+ announcedIp 漂移实测修复 + 部署手册场景 B 重写（Tailscale 零成本方案）；结构化日志 logEvent（8 埋点 JSONL）+ watch.js 告警 |
| 30 | **白板 v2 + Otter 字幕节奏 + AI Bot 参会者（09-19b）** | 白板宣纸 editorial 化（水墨五色+颗粒纸面）；字幕抽屉按说话人分组（Otter 节奏）；**AI Bot**：身份（room-state isBot 虚拟成员）+ 服务端音频管线（PlainTransport→ffmpeg astats→aiHearing 听觉账本）+ @ai 问答（DeepSeek/[Mock] 双轨）；坑 33（无回调 emit×ok 守卫缺失=崩服，已统一守卫） |
| 31 | **N2 纪要骨架 + G3 录制回放（09-19c）** | buildMinutes 合成器（字幕账本+发言统计+待办关键词抽取，LLM/[Mock] 双轨）；三触发（ai-minutes 手动/值守定时分段/离开销毁终稿）；/minutes 下载（双白名单防穿越）+@ai 关键词直连；recordings.html 回放页真机播放验证；test:record 探测竞态修复 |
| 32 | **舒适性打磨+内存架构优化+代码地图（09-19d）** | 控制坞分组竖线/按钮按压回弹/hero 呼吸/文案口语化（"去人机"）；log 400 行环形+聊天 DOM 300 条上限（过夜内存总纲：内存热窗口+文件权威副本）；日志面板可折叠（148→36px 让位画面）；LEARN 5.24「代码地图」教学章（四平面数据流/功能速查/接线七步清单/调试路径） |
| 33 | **去 AI 味·图标化与克制化（09-19e）** | 彩色 emoji 全面换单色线性 SVG（控制坞/顶栏/成员徽标/小按钮，ICONS 常量集+setIconBtn 同构）；渐变按钮/渐变字纯色化；玻璃只留真悬浮三处；圆角描边阴影收紧一档；白板色板带色名（墨/朱砂/鎏金/黛蓝/竹青） |
| 34 | **SFU 深造：多 Worker + 信令压测（09-19f）** | mediasoup Worker 池（workerCount/MEDIASOUP_WORKERS，轮询分配新 Router，died 摘除+5s 补位，默认 1 行为不变）；实测 Workers×2 三房分到两核；npm run bench:signaling 信令压测（32 客户端/4 房实测 p95=6ms、广播放大 17.8×）；ping 探活信令；/metrics 加 sfu_workers |
| 35 | **C1 AI 远程操作员（09-19g，AI 主攻线）** | AI 以**真实控制端**身份走与人类完全相同的授权链路（授权卡可拒绝/限时，被控端审计照记）→ LLM/[Mock] 双轨把目标翻成操作序列（移动/点击/双击/打字）→ 自动执行并交还控制权；入口=控制坞「🛰️ AI 操作」+ @ai"操作…"；演示：AI 自动打开计算器按 7×8 |
| 36 | **G6 安全 + G7④ 留存 + G8① 扇出 + 头像系统（09-19h~09-26）** | token 生命周期（24h/滑动续期/auth-refresh）+ 四处限流（注册/登录/进房/聊天）；dashboard 历史曲线 localStorage 留存；bench 加 --fans 扇出维度（16 发 32 收 18003kbps/单核 6%）；**头像系统**：注册九色预设自选（sqlite 幂等迁移）+ AI 五态动态头像进视频网格（ai-state 状态机）——AI 助理成为看得见听得着的参会者 |
| 37 | **AI 助理深化：矢量动画头像/逐字字幕/唤醒词（09-26b）** | 丫髻童子内联 SVG 五态（眼嘴切换+呼吸眨眼动画，替换静态 PNG）；AI 发言字幕逐字打出（标点停顿模拟呼吸，speaking 帧带全文）；**唤醒词「小明」**——开会提到名字自动接话（字幕成稿检测+AI 在场）；bot 改名 AI 小明 |
| 36 | **G6 安全加固 + G7-④（09-19h）** | token 生命周期（AUTH_TTL_MS 可调/滑动续期/auth-refresh 信令/客户端每小时续期）+ register/login/join/chat 四处固定窗口限流 + /config.json 下发 authTtlMs + dashboard 历史曲线 localStorage 留存（刷新不丢）+ bench-signaling 监听器泄漏修复；信令 98/98 |
| 37 | **G4 移动端 / PWA（09-23）** | manifest + Service Worker（可安装到主屏、静态壳离线兜底）+ 侧栏抽屉/控制坞图标化/竖屏预览（≤980/≤760 两档响应式）+ 低带宽模式（省流开关锁最低层，复用 set-preferred-layers，服务器零改动）；顺手修 F6 冒烟 flaky 与 updateLayerPicker 守卫；冒烟 107/107 + 信令 98/98 |
| 38 | **AI 主攻收官（09-24）** | **真 DeepSeek key 接入**：`sfu/ai/provider.js` 收口三处 LLM 调用（askLLM/streamLLM，Node 内置 fetch 零 SDK），密钥三来源（env > `.env` > config 的 ai.key）且**永不下发浏览器**，用量账本并入 `/metrics`；教学三件套 `scripts/{chat,summarize,agent}.js` + `npm run test:ai` 双轨自检 10/10；产品化四项：**流式打字机**（ai-stream + 终态去重）、**助理缺位自动入会**、**📝 纪要入口**、LLM/Mock 徽标与 token 用量；**实修三 bug**：announcedIp 漂移自动纠偏（跨机黑屏元凶）、ffmpeg 探测超时误判 + test:record 的 spawnSync EBUSY、配了 key 反而生成不了纪要（动作被聊天抢答）；回归：冒烟 **118/118**、信令 **106/106**（Mock 轨/LLM 轨双绿）、Mesh 33/33、test:record 连跑 3 次 PASS |
| 39 | **真 OS 级远程桌面 + 跨网一键发布 + SW 缓存纪律（09-24b）** | **B 档落地**：本地代理 `agent/`（零新依赖手写 **CDP** 客户端，`Page.startScreencast` 抓真屏 + `Input.*` 注入真输入）驱动真实 Chromium 窗口，控制端在网页里操作被控电脑真实浏览器；新信令 `agent-hello`/`remote-frame`/`remote-meta` + 复用 `remote-input`，三道闸门（身份/授权/体量，"信任≠免检查"）；**📱 手机控电脑**——控制台 canvas 全用 **Pointer Events**（单指=鼠标、双指=滚轮、中文整段 insertText）；**跨网 ICE 下发**（Mesh 版 `mesh.config.json` + `/config.json`）；**一键发布** `npm run publish:mesh`（生成 publish-mesh/ → 真起一次体检 → 可选 cloudflared/ngrok 隧道；`--check` 过期闸）；**坑 40**：Service Worker 缓存旧代码（cache-first 绕过 HTTP `no-store`，改业务代码 sw.js 不动就一直吃旧缓存 → 按资源性质分 cache-first/network-first + `?nosw=1` 逃生舱 + e2e 每次清 profile）；回归 `test:agent` 19/19、`test:e2e` 15 项全过、`test:publish` 29/29 |
| 40 | **账号上真数据库 + 门禁边界修正 + 房间令牌 + 优雅退出（09-24）** | **存储层**：新增 `sfu/store.js`，用 Node 内置 `node:sqlite`（零新依赖）替换 JSON 文件——WAL 模式、users/audit 两表、旧 `users.json` **自动迁移（原样保留 salt/hash、绝不重新哈希）** + 旧文件改名备份；**口令单一实现** `sfu/password.js`（scrypt + 随机盐 + timingSafeEqual，服务器与 CLI 共用，消除"照抄漂移"）；**管理员 CLI** `scripts/admin.js`（list/grant/revoke/adduser/passwd/purge，purge 默认干跑、deleteUser 拒绝删唯一 admin）；**门禁边界修正**：观测类（`/api/rooms`/`/metrics`/`/api/recordings`）加 admin 门禁；**内容类加房间内令牌**——进房成功时给**本人**签发**无状态 HMAC 房间令牌**（`/api/captions`、`/api/minutes`、`/minutes/<房号>/<文件>.md` 校验，`X-Room-Token` 头首选 / `?roomToken=` 兜底），`/recordings/<文件名>` 改用 **admin 或短时效签名 URL**（默认 1 小时），关闭"6 位房号可枚举"的弱能力缺口（令牌确保**游客也有**，否则游客字幕归档会静默失效）；**优雅退出**（SIGINT/SIGTERM→关 Worker→关库 checkpoint→退出，幂等 + 5s 保险丝，`TEST_SHUTDOWN_AFTER_MS` 自测钩子）；**证书 SAN 自愈**（缺失/无 SAN/未覆盖当前 IP 都重生成，修手机连不上）；**测试隔离**（账号测试一律 `DB_FILE` 指临时目录，硬断言不碰真实库）+ 修 `test:sfu` 默认带 token 掩盖游客视角的回归；回归：SFU 信令 **149/149**（含房间令牌 15 项）、存储 **49/49**、优雅退出 **9/9**、冒烟 **136/136**、Mesh **36/36**、代理 **16/16**、发布 **30/30**、e2e **15/15** = **合计 440 全绿** |

| 41 | **★ AI 智能内核：从「关键词模板」到「真智能」（09-24e，本轮重点）** | 新文件 `sfu/ai/brain.js`（零依赖、可单测）：**① BM25 检索（RAG）**——中文 **bigram 分词** + IDF/TF饱和/长度归一 + 时间衰减 + 说话人加成 + 证据块字符预算，修掉"只喂 `slice(-8)` 最近 8 条字幕 → **长会早期信息问不出来**"的硬伤（实测 29 条含 25 条闲聊，仍答出被隔开的关键信息）；**② 多轮会话记忆**（环形上限 + 截断 + **指代时把上一轮问题一起检索**做廉价指代消解，"那他什么时候交"→ 答出"周五之前提交"）；**③ LLM 意图分类**替代正则（修掉"帮我整理下今天聊了啥"→ **纪要根本没生成**却回"好的我来整理"的能力错位；动作型高置信短路省钱、未知标签 fail-safe 落回规则）；**④ 行动项结构化** `{owner,task,due}`（LLM 理解指代与去重；规则轨**宁可留空不可编造**→ 标"待认领"；**内容交 LLM、格式交代码**，两轨格式一致）；**⑤ 操作员 ReAct 闭环**（每步收集服务端可确定的三类观测：转发门禁结果/控制权/执行轨迹 → 喂回 LLM 判断达成与修正，≤4 轮；**结论三档措辞**，出现过输入丢弃就报"⚠️ 可能未完全生效"，不再无条件报成功）；**⑥ 证据链 UI**（气泡摊开 `📚 检索 N 条取 M 条 · 💬 第 K 轮 · 🎯 意图`，流式与非流式都带）。**本轮实修 4 个真缺陷**（AGENTS 坑 41~44）：`RoomBrain` 漏 `memory.push`（记忆整体失效）、行动项正则贪婪（`压测报告我负责`→`压测报告我`）、**基于不存在的 `remote-input-ack` 写闭环**（grep 证伪后改用转发在线状态）、验证脚本消息竞态。回归：`test:ai-brain` **30/30**、`verify:ai` 真端到端 **6/6**、`test:ai` **10/10**、`test:sfu` **165/165**、`test:smoke` **136/136**、`test:store` 49/49、`test:shutdown` 9/9、`test:agent` 19/19、`test:e2e` 15/15 |
| 42 | **★ AI 参会升级：从「被问才答」到「参会者」（09-25，本轮重点）** | **① 有存在感**：入会**致辞**（报出「我是谁 / 我能听见什么（**实测**管线数）/ 怎么用我」）+ 离会告别 + 终稿纪要到场——改造前点了按钮聊天区一个字都没有，用户困惑「我点了它到底来没来」；**② 有主动性**：新文件 `sfu/ai/digest.js`（零依赖、可单测）——字幕持续流入即实时抽成「🎯决定 / ⚠️风险 / ✅行动项 / 💬议题」汇成**侧栏会议看板**，并由 `maybeAiSpeakUp` **主动开口**（45s 冷却 + 每次只说一条：不停插话的 AI 比不说话更糟）；**③ 说得的话能被核对**：证据链从**数字**变成**事实**——`🔍 看 AI 依据的 N 条`点开看到**原话**并标注来源；**④ 前提修复（最关键）**：字幕原是「攒满 500 条才上传」（`cap.log` 既是热窗口又是上传队列）→ **服务器要等一整段会议才知道发生了什么**，服务端 AI 全部滞后。拆成「保留历史 / 上传队列」两条独立的路 + 窗口自适应（AI 在场 12 条）+ 6s 定时兜底。**⑤ 前端**：侧栏改分段式（成员/看板/聊天，原 id 契约零改动 + 补聊天未读角标）、快捷问法 chips、看板「出纪要」、**AI 语音播报**（原生 `speechSynthesis` 零依赖、默认关、先洗 markdown）。**本轮最值得记的是两个自我推翻**：(a) 检索下界先设成「助理入会时刻」（听着正当），真浏览器当场打脸——助理几乎总是**中途被请进来**的，一入会就瞎 → **一请来就是个废人**；改为「房间创建时刻」后中途入会能答全本场、上一场会仍被挡住（AGENTS 坑 45/46）；(b) 证据栏固定显示检索命中 → 问「这场会都定了什么」时证据里赫然是「李四 **午饭吃什么**」——**界面在无声撒谎**，改为「哪个来源真驱动了答案就展示哪个」（坑 47）。另修复：纪要分钟级时间戳互相覆盖（数据丢失路径）、纪要/看板风险口径不一致（改为同源）、寒暄与答案抢道（加 `quiet`）、定时上行只 flush 不 spill、意图分类把「问事实」判成「要文件」、看板把「定在 X 日」错分到行动项（并加「定在 + 时间/数值」lookahead 防「固 **定在** 线」跨词命中，坑 49）。回归：`test:ai-brain` **55/55**、`verify:ai` **13/13**、**`verify:board` 真浏览器 21/21**、`test:smoke` **159/159**、`test:sfu` **165/165**、`test:store` 49/49、`test:shutdown` 9/9、`test:agent` 19/19、`test:e2e` 15/15 |
| 43 | **★ 服务端 ASR 成为唯一识别路径 + AI 多轮语音对话（09-28）** | "whisper 装了却没用上"事故修复：根因 = whisper CLI 在中文 Windows/GBK 控制台打印帮助 UnicodeEncodeError → 探测误判"未装" → 前端静默退回浏览器识别。新增 `sfu/ai/asr.js` **唯一实现层**（UTF-8 环境变量 + `--help` 退出码口径 + 形态白名单 + tiny 默认 + 简体 initial_prompt + 并发闸）；**多人会议真缺陷两处**：分段录音按 memberId 分目录（原全体共用互相覆盖）、跳过"正在写的半截文件"（丢句尾）；`ingestCaptions` 公共函数让 ASR 字幕补喂 AI 看板；**唤醒词容错 + 20s 追问窗口**（免唤醒多轮）；`sfu/jsonc.js` 容错解析带注释配置模板。回归：`test:asr` **15/15**（系统 TTS 真语音→whisper 转写闭环实测）、信令 154/154、冒烟 168/168 |
| 44 | **G6-② 房间权限分级 + ASR 常驻转写 worker（09-29）** | **四级角色** `roleOf`（owner=建房者 > admin=平台管理员 > member=登录用户 > guest=游客；owner 判定优先于登录态）随 room-state 显式投影下发；**权限点最小集**：kick=owner/admin、record-start=member 及以上（游客不能录——审计需要身份，fail fast）；前端 admin 盾形徽标 + 踢人入口放开到 admin（服务器仍是权威校验）。**听觉管线**：① 从"录 15s→转写→再录"（串行，转写期间语音全丢）改为单 ffmpeg 持续分段 + 轮询写稳段转写；② **常驻 whisper worker**（`asr_worker.py`，模型只加载一次）——CLI 每段固定 2~4s 启动开销取消，实测每段转写 10~14s → **0.8~3.0s（快约 10 倍）**；spawn 全字面量参数（模型走 env），连崩 3 次自动回退 CLI；asrModel 默认升 small（准确率可感知提升）；**`test:asr-live` 语音闭环端到端 PASS**（TTS 语音→RTP→听觉管线→转写→账本，「小明，帮我记一下明天下午三点的评审会。」逐字全对）。**G6-③ 生产化**：注册密码强度策略（下限可配 + 至少两类字符）与**登录失败锁定**（连错 5 次锁 15 分钟、正确密码也拒、只对存在账号计数防锁人 DoS）。回归：信令 **165/165**（+11 角色与安全断言）、冒烟 **168/168**、test:asr **19/19**、test:shutdown 9/9、test:store 49/49 |
| 45 | **性能与流畅度专项（09-30）** | 先量再改：白板一次 300 点拖拽 **302 条 SCTP 消息**（该量的不是 CPU，是消息条数）→ 按帧打包 **302→3 条（-99%）**、重绘 4.3ms→0.6ms 且不随点数增长；AI 流式每 token 一次 `scrollTop=scrollHeight` = **强制同步布局 ~200 次/条答案** → 改攒批按 rAF 刷（逐字依旧连续、打字不再卡顿）；远程抓屏从"开机写死 12fps"改**闭环自适应**（控制端实测帧间隔 + RTT → 回传建议 → 被控端只调本地限流间隔，下一帧即生效）；**测试基建防"假绿"**：`test:agent` / `test:e2e` 原先"3001 有服务器就复用它"→ 改专用端口（3012/3013）+ 被占明确拒绝 + 可用环境变量换端口（**假绿比假红危险得多**）。见 `AGENTS.md` 坑 57~60、`后续升级方向.md` 1.10 |
| 46 | **★ 取长补短·设备码直连 + 真桌面画质档（09-30b，借鉴开源 `billd-desk`，仅 SFU 主版本）** | **① 设备码配对直连**：被控端 `npm run agent` 启动即得 6 位设备码，控制端在登录页「🖥️ 用设备码远程控电脑」输码 + 连接口令即连，**不用建房、不用进会议**；核心决策 = **设备码就是一个私有 `isDesk` 房间的房号**，于是画面帧三道闸门 / 16 字节控制帧 / canvas 控制台 / 手机 Pointer Events **一行未改全部复用**，控制端只做一次轻量进房（`deskEnterRoom`：登记门禁，不建媒体、不广播成员）。授权两路径（**安全口令 = 无人值守**，服务器直接登记；**连接口令 = 需对方终端按 y**，走原 `remote-answer`）**都发同一条 `desk-granted`**，前端只有一张开控制台的代码。**② 画质档**：流畅(6fps/q30/1280) / 标准(12/55/1600) / 高清(20/80/1920)，走 `remote-input` 的 `{kind:'quality'}` **老通道新语义**（白拿门禁与限流，AI 操作员 / 会议内控制 / 设备码直连三条路径同时获得）；**三层帧率分工**（档位定中枢 → 闭环 ±2 微调 → 代理与服务器硬钳 2~24；策略线与安全线有意分开，坑 62「一个执行器不能有两个控制回路」）。**明确没取**：Electron 原生客户端 + H.264/265 硬编（违背零依赖红线）、常用设备列表 / 设备持久化（押后）。教学导读 **LEARN.md 5.39**；回归 信令 **184/184**（+19）+ 冒烟 **189/189**（+11）+ `test:agent` **24/24**（真 Chromium：切档后仍持续推帧 / 无重复 ack）+ `test:e2e` **15/15** |
| 47 | **★ 语音双轨工程化 + 全链路延迟极限化（09-29 ~ 09-30e，用户点名"语音真正实现/延迟降到极限"）** | **耳朵**：常驻 whisper worker（`sfu/ai/asr_worker.py`，模型只加载一次，每段转写 10~14s→**0.8~3.0s**）+ **开机预热**（静音 wav 预载模型，第一句不再等 13s）+ 分段 5s→4s + 写稳采样 150ms；**嘴巴**：服务端神经语音 Edge TTS（`sfu/ai/tts.js`，零 npm 依赖手写协议，端点探测双轨不可达回落浏览器 TTS）+ **抢话三层"让话"**（麦克风能量即时闸 ≈130ms / 字幕闸 / 迟到不读）；**体感**：唤醒应答流式化（ai-stream 逐字上屏）；**闭环自测** `test:asr-live`（TTS 语音→RTP→真实听觉管线→转写→**AI 应答断言**，实测 AI 把「帮我记一下」判成纪要意图并真落盘）。回归：test:asr 18+1、test:tts 10+1、asr-live PASS、信令 187/187、冒烟 189/189 |
| 48 | **E3-media 多人音视频真浏览器回归 + 路线图满功率化（2026-10-01）** | `npm run test:e2e-media` 首跑 **5/5**：两个真实 Chromium（假摄像头/假授权 UI，专用端口 3016）双页游客进同一房，断言成员数=2 + **双侧 `videoWidth>0` 在流画面**（音视频链路任何一环断了都是 0）+ 双侧截图。**"会议本体"从此有自动化回归**，核心链路全部不依赖人工；`后续升级方向.md` 刷新（0.1 六行回填 + 基线 + **0.4 满功率下一批** P1~P5）；watch.js 增语音链路告警（ASR worker 掉线 / 神经语音翻转）；`npm run bench:asr` 模型选型评测（tiny/base/small 延迟+命中实测） |
| 49 | **★ 语音链路根因修复：静音幻觉 / 应答风暴 / 两条"不出声"死锁（2026-10-02d）** | 用户五症（重复一句话、对话混乱、延迟大、后来不出声、听不见）**同源**：whisper 在纯静音段把 `--initial_prompt` 续写成「请用简体中文输出。」（证据在 `sfu/captions/cap-746646-*.jsonl`），旧门槛 `size<40000` 量的是**时长**不是**能量**。**四道修**：`measureWavLevel()` 能量闸（Node 读 PCM 算峰值 dBFS，没出声**连模型都不叫**）+ `cleanTranscript()` 语义清洗 + 成句处重复句/AI 回声闸 + 应答在途锁与最小间隔；"不出声"另有两条真死锁（让位闸把 `ai-tts-fail` 回落也挡死 → 加 `force` 例外；`aiTtsEnabled` 进房读一次终身缓存 → 服务器定期重探 + 翻转广播 + 客户端连败自愈）；**实测**：静音期零字幕、"说→停→再说"只入库 1 条、AI 只应答 1 次（修复前 8+） | `sfu/ai/asr.js`、`sfu/server.js`（管线/闸/播报）、`sfu/public/client.js`（音频队列与回落）、AGENTS 坑 **64/65/66** |
| 50 | **★ AI 头像重做 + Piik 四条取长 + Qwen 引擎接线收口（2026-10-02e）** | 头像"重影"= **82 帧循环 WebP 帧内残影 + CSS 又叠一层缩放**（两层节奏），"只会一个动作"= 循环素材的本性 → **形象与动作分开**：一张干净静帧 + 每元素同一时刻只一条动画 + idle 每 7~14s 随机演一次性小动作（6 种）；Piik 四条：**每路独立音量 0~200%**（0~100% 走 `video.volume`，>100% 才挂 WebAudio 增益且元素静音；流换对象必重挂）、**只听不看**（新信令 `set-consumer-paused` → 服务器 `consumer.pause()`，前端隐藏不省带宽；ABR 加 paused 守卫）、**定向回应**（react 带 `to`，广播通道 + 应用层过滤；定向 ≠ 隐私）、**进房前 ICE 预检**（第 34 步，把坑 36 的沉默故障说成人话）；另修 **Qwen 双引擎"写了从没生效"**（模型目录按项目根解析）与**探测超时被当没装**（`import qwen_asr` 实测 21.7s > 旧 15s 上限，且 `warm()` 失败也打 🔥）→ 收口成 `sfu/ai/pyprobe.js` | `sfu/public/client.js` 第 34 步、`sfu/ai/pyprobe.js`、`sfu/server.js`、`style.css` 第 27 节；AGENTS 坑 **67**；回归 冒烟 **224** / 信令 **191** / e2e-media **15**（真浏览器实证暂停后解码帧停增） |
| 51 | **★ 让 Qwen 音色「能用得起」：LLM×TTS 语音流水线 + 引擎自适应字数预算（2026-10-02f）** | 用户点名「有没有办法用 Qwen 的音色但延迟低一点」。结构性那一刀 = **让 LLM 与 TTS 重叠**：`aiBrain` 本来就是流式的（每 12 字一吐），过去却要等整段写完才开始合成第一句——现在新增 `makeSpeakPipeline`，每收到一段增量就切出「已完整」的句子立刻送合成，**LLM 写第 2、3 句的时间被第 1 句的合成时间盖住**。配套三件：`answerTs` 提前生成（音频可能比 chat-message 先到，两者靠同一个 ts 配对）、客户端 `playedServerTts` 集合（**已经播过的不再挂回落账**，否则之后一条 `ai-tts-fail` 会把念过的答案再念一遍）、`splitForTts` 按句切段（最多 3 段，合成完一段发一段）。**引擎自适应字数预算** `config.aiTtsMaxChars`（默认 48）只在「慢引擎（本地 Qwen）说话」时生效，Edge 可达时放宽到 500——**约束要按引擎的能力定**，一刀切等于给可用引擎降级。播报链拆成 `synthAndEmit`（单段）/`speakAnswerForRoom`（整段）/流水线（语音问答），三者共用同一个「**要么出声、要么 ai-tts-fail**」的收口，杜绝无头静音；判据 `serverVoiceReady()` **只写一处**（`tts:` 标记 / `/config.json` 的 `aiTtsEnabled` / 预热后的 `ai-tts-state` 广播三处共用它，原先各判各的会造出「页面让位、服务器不发」的两头静音）。实测本地 Qwen3-TTS 单句 12s、整段 44s（RTF>1，CPU 自回归的硬账，不是 bug）→ 策略定为**实时播报默认浏览器朗读**，自持音色放 `aiTtsLocalWait` 显式开关。`npm run bench:tts` 量 dtype / non_streaming_mode / 批量三句等开关的真实收益（**不凭猜调优**）| `sfu/server.js`、`sfu/public/client.js`、`sfu/config.example.json`、`scripts/bench-tts.py`；回归 冒烟 **224/224** / 信令 **191/191** |
| 52 | **★「还在用 whisper」与「回答时不说话」的最后两半：界面说实话 + 第三条静音死锁（2026-10-02g，真浏览器取证）** | ① **「还在用 whisper」是界面在撒谎，不是引擎没切**：`config.asrEngine` 早已是 `qwen-local`、实测转写 `[ASR/qwen-local] 1.4s / 2.4s`，但字幕状态徽标 / toast / 流程日志**三处硬编码 whisper 字样**、服务器启动那行也无条件打 `whisper.exe`——用户只能看见界面那行字，于是判定「根本没切换」（坑 67 的 UI 版：**过期声明比缺失更糟，它会让人去装已经装好的东西**）。修法：`/config.json` 的 `asrEngine` 存进 `serverAsrEngine`，四处统一走 `asrEngineCn()`，启动日志改口「主引擎 = qwen-local；whisper 仅作兜底」。② **第三条独立静音死锁**（前两条在 02d/02e 已修）：`hushAiSpeech()` 每条字幕到达都开一个 **8 秒静默窗**，而语音对话的真实时序是「说完 → 字幕到（开窗）→ 1.5~6s 后**这条提问的答案**送到」，答案永远落在自己开的窗里，且顺手 `pendingServerTts.delete(ts)` 把浏览器回落账也销了 = **两头静音、零报错**。修法 = **认人别认时间**：拉黑「被打断那一轮的 ts」（同一条流水线分段共用 ts），新一轮是新 ts 天然放行，**不依赖两端时钟对齐**；时间窗只留作「段没带 ts」时的兜底判据。浏览器那一轨同源：抢话闸的 700ms 字幕窗仍然每轮误杀——因为**「字幕刚到」证明的是 1~3 秒前有人在说话**，而答案恰恰紧跟在自己的字幕后面；改成**以麦克风即时信号为主判据**（130ms 级），字幕窗只在「根本没有麦克风可量」时兜底。③ **朗读不再等整段答案写完**：新增 `speakStreamPart` + `enqueueAiSpeech(say,{replace})` 分句泵（`aiSpeakGen` 按代作废），流里一出现完整一句就念、终态只补剩下的尾巴（前缀对不上则整段重念，**宁重不漏**）；本轮自己写出来又被真机抓走的两个坑记成 **坑 68**（朗读读的是 DOM 攒批后会被清空的 `box.buf` → 通路静默空转，改为独立副本 `box.rawAll`；`cancel()` 掉的旧句子会迟到回调、把新队列整个倒空）。④ **听觉进程静音自愈**：ffmpeg 约 30s 无 RTP 就自己退出 → 「挂在那儿没说话」之后 AI 永久失聪，`spawnRecorder()` 加 `exit` 自愈重启（≤5 次、换 segDir、RMS 一来就重置计数）| `sfu/public/client.js`、`sfu/server.js`；AGENTS 坑 **68**；回归 冒烟 **237/237** / 信令 **191/191** / `test:asr` **28 通过+1 跳过** / `test:asr-live` **PASS**（语音交付回落浏览器朗读实测 **1.6s**）/ 真浏览器取证：字幕状态显示「本机 Qwen3-ASR」、字幕 1ms 前刚到**仍能出声**、麦克风真出声**被拦**（礼仪没丢）|
| 53 | **★ 六项连跑：弹窗循环 / AI 会操作会议实体 / 共享分层 / 选层器根本没出现 / 远程桌面手感延迟 2287ms→153ms（2026-10-03a）** | **① 用户被原生弹窗循环卡住**（「一直弹这个」）：服务器重启 → 内存房间没了 → D6 自动重连拿旧 `myRoom` 再 join → `room-not-found` → **`alert()` 阻塞主线程** → 点掉 → 又重连 → 又弹。两个错叠加：**用阻塞模态报一个会重复发生的事件** + **`myRoom` 从来没有作废路径**。修法 = 把「房间没了」做成一次**状态迁移** `giveUpRoom()`（清 myRoom/密码/令牌 + 拆媒体 + 回加入页），提示交给页内 toast；三条房间类 alert 全下掉，冒烟加一条「全文件 0 次 alert(」的结构断言。**② 测试不许抢开发者的端口**（用户：「测试的时候不要退出 agent 啊」）：`test:sfu` 与 `test:asr-live` 原来都起在 3001/3443 → 每跑一次回归就要踢掉用户那台。改成**信令 3011 / 语音自测 3017 + `SFU_NO_HTTPS=1` + 占用即明确拒绝 + 环境变量可换**，实测跑完两套回归 3001 的 PID 一个没变。**③ AI 会操作会议实体（第 36 步）**：`ROOM_ACTIONS` 白名单（开关白板 / 开关字幕 / 切演讲者·宫格）+ `detectRoomAction` **排在 LLM 之前**路由（tools-first，坑 38），服务器只广播 `room-control {action,byName,ts}`，客户端照表落地；**边界写死**：只动房间级共享状态，动用户设备的一律不进这张表（冒烟有一条结构断言：白名单出现 camera/screen/mute/record 直接红）。中文规则把「关」排在「开」前面判，动词表要覆盖同义词（只写「打开字幕」时，「开启实时字幕」整条不命中 → 症状恰是「AI 回了漂亮话、什么都没做」）。**④ 屏幕共享补 simulcast**：共享一直是单层全分辨率，弱网观众只能「卡成幻灯片或什么都看不见」二选一；而服务器 ABR 的守卫是 `kind==='video' && layerCount>1` → **层数>1 就自动生效，服务器零改动**。新增 `SCREEN_SIMULCAST_ENCODINGS`（250k/1.2M/2.8M，比摄像头整体高一档：屏幕是文字线条）+ `contentHint='detail'` + 单层兜底。**⑤ ★ 选层器从来没被创建出来**（写 e2e 断言才抓到的真 bug）：服务器的 `layer-changed(initial)` 在 consume 的 **ack 之前** emit，而格子要等 ack 回来才登记进 `consumerTiles` → 通知到达时 `tile` 是 undefined → `ensureLayerPicker` 直接 return。修法顺着「一个概念只有一个来源」：**`layerState` 是账本，格子一出现就照账本补渲染**，不去调服务器 emit 时序。**⑥ ★ 远程桌面手感延迟 2287ms → 153ms（15 倍）**：控制台原来只报 RTT 与帧率，而「点下去→画面动」是另一条链。量出来才看见根因：**CDP screencast 是变化驱动的，像素没变就一帧都不发** ——点了空白处/无视觉反馈的控件时控制端根本收不到画面，体感「半天才动」，**这不是带宽慢，是没人报信**。修法 = **输入回声帧** `scheduleEcho()`（注入后 120ms 复查，抓屏没出帧就主动 `captureScreenshot` 补一帧；三重限流；`stopStream()` 撤权时清定时器——撤权后还去抓屏等于多一次无谓的隐私面）。回归上限从 3000ms 收到 **800ms**，让这条断言同时是「回声帧还在不在」的哨兵。**⑦ 首页 hero 化（第 35 步 + style.css 第 28 节）**：借落地页的编排语言（模糊引导语 → 打字机主句 → 胶囊 CTA → 严格 z-index 分层 → prefers-reduced-motion 降级），**不借它的资源**——参考稿用外链视频 + 外链字体，与本项目「零依赖 + 可离线 PWA」冲突，背景改纯 CSS 光晕 + SVG 噪点；顶栏三个入口全部接真功能；冒烟新增**零依赖红线断言**（index.html 出现 `href/src="http…"` 或 CSS 出现 `@import url(http…)` 直接红）。**⑧ `test:asr-live` 的「0 条也全绿」（坑 65 在我自己写的测试里复发）**：补**正向对照**（必须至少一条字幕真带上所说的那句 + 至少应答一次，否则直接红并列出四步排查）；顺带查清自愈记账错误：ffmpeg 长时间无 RTP 会**干净退出（code=0）**，旧写法把它算进 5 次崩溃预算 →  预热等 65 秒就把预算烧光、真语音来时耳朵已经死了。改成**活过 15s 且 code=0 = 静音退场不限次**，崩溃仍 5 次封顶；不再每代换目录（`-segment_start_number` 接着上一代编号写）。| `sfu/public/client.js` 第 35/36 步、`sfu/server.js`（`ROOM_ACTIONS`/`applyRoomAction`/`spawnRecorder` 自愈分类）、`agent/index.js`（`scheduleEcho`）、`style.css` 第 28 节、`sfu/protocol.js`（`room-control`）、`scripts/{run-asr-live,test-sfu-signaling,test-e2e-media,test-e2e-remote-desktop}.js`；AGENTS 坑 **69/70**；回归 冒烟 **254/254** / 信令 **196/196** / e2e-media **19/19**（真浏览器实证 3 层 + 降层让 videoWidth 320→160）/ e2e **16/16**（手感延迟实测 153ms）/ agent **24/24** / asr-live **PASS** |
| 54 | **★ 把延迟「量出来」之后才发现之前一直在瞎猜：字幕端到端延迟可视化 + 它牵出的两个真缺陷（2026-10-03b）** | 用户要"延迟还要降低"，而本轮最大的收获不是降了几秒，是**先让它可观测**（看不见就降不了）。**① 字幕延迟进界面（client.js 第 37 步）**：定稿 `asr-caption` 带 `latMs`（起点=最后一个判定有声的 RMS 窗，窗长 0.5s → 这个数是**下限**，不虚报更快）与 `stage:{wait,trans}` **拆分**，字幕条新增 `⏱ X.Xs` 三色读数 + 悬浮摊开"等待 vs 转写"与近 8 句均值/最慢。**拆分才是可操作信息**：只有一个总数时"慢在等静音判定"与"慢在模型"长得一模一样，而处方完全相反。脏值/缺值**保持上一次读数**——会瞎填的读数比没有读数更糟。权威统计同源三处：`/metrics`（`sfu_ai_asr_caption_latency_ms{kind=avg|max|last}`）、`/api/rooms` 的 `collab.capLat`、dashboard 单列一格（**不并进"转写引擎"那格**：一格讲"谁在转写"、一格讲"多久"）。**② 真缺陷一：同一句被分段切碎 → AI 重复接话**（正是用户说的"我要的是不乱说话"）：`TEST_ASR_WAIT_WARM=1` 第一次跑出 FAIL——4s 分段把一句切成三段**分别成句、分别唤醒**（实测 3~4 条字幕 / 3 次应答），而旧三条重复句判据都要求"互相包含"，分段边界带来的 **三↔3 写法漂移 + 尾字截断**让两者互不包含 → 闸形同虚设。修法=纯函数 `Asr.isFragmentOf()`（**方向性** bigram 覆盖率：只算"新句被旧句覆盖多少"且"新句几乎无新增信息"；方向性是必须的——先说「小明」再说「小明，把纪要生成一下」是新问句，对称相似度会把真问题吞掉）。实测 **4→1 条、3→1 次**。**③ 真缺陷二：自测被自己的历史污染**：字幕账本 `<房间>-<UTC日期>.jsonl` 只追加、清理只写在 PASS 路径 → 上一次失败运行的残留被这次数进断言，**从第二次起必然红**，而报的错是"重复句在刷屏"（把测试设施的问题说成被测代码的缺陷）。修：开场清场 + 按 `ts>=本次起点` 过滤 + 清理挪进 `catch`；判据=**回归结果不该依赖"上一次跑没跑干净"**。**④ 兜底引擎预热被换引擎时悄悄砍掉**（坑 71）：09-30c 切 qwen-local 时把 09-30e 的 whisper 开机预热改成"跳过"（理由：省 1.5G 内存），代价是 Qwen 冷启动 ~55s 期间**现场起 whisper 带模型加载** → 开机第一分钟每句多等 15s，正是当年要消灭的症状原样复发。新策略=**兜底先预热、主引擎就绪即 `releaseFallbackAsr()` 释放**（内存只在重叠窗口翻倍），实测首段 15.0s→11.3s、总延迟 **9.2s→5.3s**，qwen-local 就位后 **3.5~4.0s**；同时给 watch.js 补 `sfu_ai_asr_primary_ready` 做**分诊**：区分"还没起来（预热期正确行为，等 N 轮）"与"起来了却不用（真退化，两轮就报）"，老服务器没这行时**退回旧判据**（"读不到"≠"读到 0"）。**⑤ 协议总表补掉一整类漏写**：`sfu/protocol.js` 原来只列 C→S 请求，语音链路的 S→C 广播（`asr-caption/ai-state/ai-audio/ai-tts-fail/ai-tts-state/board-state/board-record/remote-quality`）**全缺**——这类无 ack 无重发的下行事件漏写，客户端监听挂漏不会报错；补时逐个 grep 证伪（坑 43）。 | `sfu/server.js`（`bumpCapLat`/`releaseFallbackAsr`/`asrPrimaryReady`/抢跑顺序）、`sfu/ai/asr.js`（`isFragmentOf`）、`sfu/public/client.js` **第 37 步**、`index.html`+`style.css`（`.cap-lat`）、`dashboard.html`、`scripts/watch.js`、`sfu/protocol.js`；AGENTS 坑 **71/72**；回归 冒烟 **272/272** / 信令 **206/206** / `test:watch` **29/29** / `test:asr` **36/36** / e2e-media **30/30**（真浏览器 7 条：`display=none` 初态 + `color=rgb(158,207,122)` 证明 CSS 变量未被吞 + 脏值不覆盖）/ asr-live **PASS×2** |
| 55 | **★ 语音识别「到底实现没有」用真浏览器取证：新测试 e2e-asr + 五个真缺陷 + 定稿 7.7s→2.2s（2026-10-03c）** | 此前的语音证据全来自服务器侧直推 RTP，"浏览器→WebRTC→AI 耳朵"这一段**从没被任何测试覆盖**。造 `npm run test:e2e-asr`：把中文 TTS 合成的"说一句→停→再说一句"当成**假麦克风**（`--use-file-for-fake-audio-capture`），走真浏览器 getUserMedia → 真 produce → 真引擎 → 字幕上屏 → 唤醒 → 应答。**首跑抓到五个真缺陷**：① 耳朵竞态（attach 那一刻的探测结果被冻结成管线形态，引擎 3 秒后就绪也不再升级 → 这一路永远哑、零报错）；② "模型加载完 ≠ 推理图就绪"，首句实付 11.1s → 补一次空推理预热，首条字幕 17.4s→5.7s；③ 定稿永远带半句样式（第三参写死）；④ 句内累积不去重；⑤ 静音确认即成句（不再干等 1.5s 的重复判定）→ **定稿 7.7s → 2.2~2.5s**。 | `scripts/test-e2e-asr.js`、`sfu/server.js`、`sfu/ai/asr_qwen_local.js`；AGENTS 坑 **73/74**；回归 e2e-asr 8/8×2 连跑 / 冒烟 293/293 / 信令 211/211 |
| 56 | **★ 机器里一直闲着的一块 RTX 4060：换 CUDA 版 torch，定稿中位 1.4s、说完→上字幕 1.7s（2026-10-03d）** | `nvidia-smi` 有卡而 `torch 2.14.0+cpu`——"CPU 保守可行"的注释是没人注意到有 GPU 时写下的。换 cu130 版 torch（同版本号只换后端）：单连接被镜像限速到 0.4MB/s，**Range 探测出 19MB/s → 12 路并行分块 3 分钟拉完**（大文件先测单连接速率再选方案）。`pick_device()` cuda 优先 bf16 / 加载失败自动回落 CPU / 逃生舱环境变量；worker 自报**纯推理 ms**，与 Node 侧"转写 X.Xs"相减就能把"排队 vs 模型"归因清楚。**TTS 的诚实数据把一个猜想杀掉**：GPU bf16 RTF≈4.1 而 CPU 是 4.5 —— 瓶颈是自回归逐 token 的架构开销不是矩阵计算，本地音色实时播报维持默认关。doctor 新增 A7b：CPU 版 torch 遇到 NVIDIA 卡会 warn 并给出换装命令。 | `sfu/ai/*_worker.py`、`scripts/{gpu-bench-once.py,doctor.js}`；AGENTS 坑 **75**；回归 e2e-asr 9/9 / asr-live 1.7s / 冒烟 293 / 信令 211 / 7 分钟 soak PASS |
| 57 | **★ 四波连跑：全套测试盘点 + 「抢跑机制从上线起从未触发」+ 分段 4s→2s + 双浏览器字幕广播（2026-10-03e）** | 16 个测试脚本逐个过，唯一红的 `test:tts` 是"套件没人跑，红了没人看见"（契约早已改成 `{buf,type}`）。给抢跑触发加打点后看清慢峰真根因：**ffmpeg `-f segment` 的 wav 段写满才落盘**（in-flight 段 statSync 恒 0 字节）→ 静音抢跑快照**一次都没触发过**，而它在成绩单里领了三天功劳（坑 76）。真正砍延迟的是 `asrSegmentSec` 4→2（GPU 一段 0.3~0.6s）：受控实测定稿 **1.7s / 1.4s，双峰消失**。代价是碎片更碎 → `normAsrText` 把唤醒词家族形近字（鸣/名/铭→明）归一，让既有包含闸能拦住。第二波给 e2e-asr 加**第二个真 Chromium**（与会者 B）：A 说话 → B 的字幕条/历史出现 A 的转写、B 看到 AI 应答、A 说"把白板打开"双端白板同步——"别人的话会不会出现在我屏幕上"这个投用第一问此前从未被自动化覆盖。 | `scripts/{test-e2e-asr.js,test-asr.js}`、`sfu/server.js`、`sfu/config.example.json`；AGENTS 坑 **76**；回归 e2e-asr 12/12 / 冒烟 293 / 信令 211 / 30 分钟 soak PASS |
| 58 | **★ 界面这一轮：四个 reactbits 零依赖移植 + 控件去 emoji 收尾 + 量出「控制坞从来没放下去过」（2026-10-03f ~ 10-04）** | **移植**（全部不引第三方库）：BellToggle→控制坞开关两层标签交叉淡入；ThoughtLine→AI 思考条（并**接上服务器从 09-30 就在发、客户端一直在门口丢掉的 `phase`**）；GlowCursor→登录页光轨（**着色器原样搬、渲染器自己写**，全屏三角形 + 64 点折线）；PillNav→「进入会议」拱形升起（半径按按钮真实尺寸解出）。**去 emoji**：画面格三颗悬浮按钮、每路音量三态、看板四类、批注/白板工具条、字幕状态与延迟读数、滤镜键色、审计条、远程桌面工具条、CSS 里那颗 `content:'💭'` 全部换线性 SVG —— 并立下一条纪律：**`el.textContent =  26` 会把同节点的图标一起抹掉**（AGENTS 坑 77）。**量出来的真缺陷**：① **控制坞在任何桌面宽度都放不下**（1890px 视口溢出 180px、1250px 溢出 820px，右边那排按钮藏在几乎看不见的横条后）→ 按功能拆两行 + 把"字幕条 + 坞"包进 `.bottom-stack` 一列（原先两处各写一个 `bottom` 猜对方高度，坑 79）。② **白板 `inset:0;z-index:6` 把字幕条和整排按钮盖了**（用户报"让 AI 调白板后字幕不可用"，而字幕逻辑一个字没错）→ 用 `elementFromPoint` 命中测试取证，改成"白板盖画面、给控件让位"，高度由 ResizeObserver 量进 `--stack-h`（坑 80）。③ **"它答应了却不说话"的第四种成因：判据对、处置错** —— 把 `test:e2e-asr` 里那行"不判失败"的日志提成断言，当场红：`asked=1 / started=0 / gated.talking-now=1`；"用户此刻在说就别插嘴"没错，错在直接 `return` 等于这一轮声音永远不出现 → 改成 `waitForTurnThen` 等一轮（最多 6s，新一轮作废旧的），修完 `started=10/10`。④ **AI 答非所问 / 同一句答案两条气泡两个名字**：意图表缺 `chat` 这一类（"你现在能做什么"被归成 question → 强制走"只根据会议记录回答"）；语音通路终态消息没带 `streamId` → 去重失效。两条通路现在共用 `aiTraceParts()/aiAnswerMeta()`。⑤ **AI 的"在听"改由真实音量驱动**（第 44 步）：波形原先只在它自己说话时循环闪，与房间谁在说毫无关系；现在吃既有 `audio-levels`，安静归零、AI 发言时让位，dB→电平 抽成唯一 `dbToLevel()`。⑥ **白板能带走了**：导出 PNG（与屏幕重绘共用同一个 `drawBoardStrokes`，导出文件名带房间号与时间）。**第一屏重做**：朱砂印章品牌头 + 图标前缀输入框 + 密码可见切换 + 次要出口收一行。**并发到底发生过没有**：给转写管线补上触发计数，实测 `启动 9 段 / 在途峰值 2 / 撞上限 32 轮` —— 从此不再靠读代码推断。 | `sfu/public/{client.js 第 40~48 步,style.css 第 29~37 节,index.html}`、`sfu/server.js`、`scripts/check-*.js`（新增 9 条真浏览器界面检查）；AGENTS 坑 **77~80**；导读 **LEARN 5.47**；回归 冒烟 **359/359** / 信令 **213/213** / e2e-media **38/38** / e2e-asr **18/18** / asr-live PASS / check 九件套 **128 项** |
| 59 | **★ 后半场：把"写了"证明成"真在跑"（补桩、界面说实话、`check:all`）（2026-10-04b）** | 本轮**不加新功能**，只做一件事——把已经存在的代码证明它真的被执行。① **冒烟桩补 `speechSynthesis`**：缺这一个宿主能力 = 那条分支**永久不测**——`speakStreamPart` 里 `answerTs: id`（作用域里没这个变量）在真浏览器抛了 3 次，而冒烟连跑两天 348 项全绿；桩补成"按真实语义回调 `onstart`/`onend`"之后第一次有了**"哪一句真的上了嘴"**的行为断言（半句不念 / 只念新增那半句 / 新一轮 cancel 旧队列 / 泵靠 onend 接力到第二句），并当场抓到第二条真缺陷：**流式那一轨的播报延迟从来没被量出来**——登记锚点写死 `typeof answerTs === 'number'`，而 streamId 是字符串（坑 56 的形状）。② **界面说实话**：字幕徽标曾拼成 **"服务器转写（服务器转写）"**，根因是 `client.js` 三处读 `/config.json` 而只有一处写 `serverAsrEngine`，兜底文案又恰好与外层模板同名 → 合并成唯一 `applyServerConfig(cfg)`（**结构上不会再漏一半**）+ 兜底改"引擎待确认"；配套把"含不含关键词"的 e2e 断言加严成"这句话读起来是不是人话"，并给 `check:console` 加第 4 条现场取证、加一条**版本指纹**断言（没有指纹的检查测的是缓存不是代码）。③ **AI 不接半句**：新纯函数 `Asr.isNameOnly` + 服务器侧"**光叫名字不作答、但顺延追问窗口**"——分段把「小明，把纪要生成一下」切成只剩名字的碎片时，旧代码拿一个光秃秃的名字去问模型，只能复述上一轮答案（= 用户报的"它又在重复接话"）；计数 `throttled{name-only}` 进 `/metrics`，`test:asr` +7 条（含 2 条**接线断言**：闸真存在且排在在途锁之前）。④ **`npm run check:all` 上线**：一条命令跑完 13 套真浏览器界面检查（自起 3021 + 临时库 + `ASR_QWEN_LOCAL=0` 错峰 + "清单与 package.json 一一对应"自检），第一次全量跑红两条，而**两条都是量具自己造成的**：`?nosw=1` 每次加载自带一趟自我导航（→ 产品侧"真清掉东西才重载"，不重载时 `history.replaceState` 静默抹参数；量具侧改成取值失败重试 + 跑前删自己那档 profile），以及 13 条检查**共用默认 CDP 端口 9333 与同一 profile**——串跑时"后一台可能连上刚 kill 的半死实例"是真实隐患（→ `agent/cdp.js` 认 `WB_CDP_PORT`，显式传入优先，**真实使用里的 9333 一个字没改**，runner 给每条一个专属端口）。▸ 诚实记录：`check:pill` 那次"五条 hover 全 0.00"**并不能归因给端口**——隔离端口后它又红过一次、同样的前缀序列又绿过两次，属于"会移动的失败"；本轮给它补了**前提断言**（先等按钮真的占面积，再用 `elementFromPoint` 问"这块地方的事件归谁"），下次再红会直接说清是"没显示"还是"被盖住"，根因如实挂着不写成已修好。⑤ 顺手收掉三处测试自身缺陷：`check:console` 的 24 步用 `.then()` 不 await（抛错可能落在汇总之后 = **步骤真抛了错、检查照样报干净**）、`cdp.evaluate` 被静默丢弃的第二个参数（5 处调用传的超时从未生效）、`test-e2e-asr` 的固定名临时库（坑 72 第四次复发：上一轮注册的账号被这一轮当成设置失败）。回归：**前端冒烟 374/374**（+25）、SFU 信令 **213/213**、`test:asr` **49 通过/0 失败/0 跳过**、`test:asr-live` **PASS**（两条字幕、**应答 2 次不多不少**、定稿 3.8s/1.3s）、`test:e2e-media` **38/38**、**`check:all` 13/13 = 162 项界面断言**、`soak` 压缩 7 分钟 **PASS**（42 条对账一致）；`test:e2e-asr` 本轮未稳定跑通（如实记录，不拿"应该能过"当成绩）。教学新增 `LEARN.md` **5.47.7~5.47.9**、`AGENTS.md` 坑 **81~83** |
| 60 | **★ 三把尺子全部重校准（安静麦克风救回来）+ 唤醒容错补「小米」+ ⏱ 读数不再撒谎（2026-10-05d）** | 用户拿 18:43 房间 283648 的截图问"识别怎么这么乱、延迟怎么这么大、到底接的谁、TTS 是 Qwen 还是浏览器"。全部用**他自己那场的日志**回答：`app-2026-10-05.jsonl` 显示 66 秒里 `asr-silence-skipped` 8 次（峰值 **-56~-65 dBFS**）vs `asr-segment` 4 次，`ai-tts` 157 条 **engine 全是 edge**（千问 0 次）。**根因是三个"绝对阈值"全拿响麦克风/合成语音校准**：能量闸 -45→-55 仍误杀安静用户、增益钳 +20dB 让放行段还是耳语、`FLUSH_DB=-38` 使 `lastVoiceTs` 整场不刷新（静音确认快路径 + 延迟锚一起失效）。**修**：闸 **-62**、增益上限 **+40dB**、`FLUSH_DB -50`，三条进 config/env 且注明"必须成对改，只放宽闸不提增益=有字幕但全错字"；**唤醒表**补 `[小晓笑孝筱][明鸣名铭茗米民密蜜命]`（模型把「小明」写成「**小米**」是常态，旧表没有米 → "我叫了它它不理"），有意不收「小敏」（误唤醒比漏唤醒更烦人），并把浏览器那一轨的 `includes('小明')` 改成服务器下发 `wake` 字段 + 一条**逐字比对两张表**的断言；**⏱ 读数诚实性**（坑 90 挂的待办）：`finalizeUtterance(mid, reason)` 只有 `silence` 定稿才产读数，客户端再加"物理下限 <200ms 判不可靠"——真机实锤是界面显示 0.0s 而真实等待 ~10s。**千问 TTS 按用户指令退场**：`aiTtsLocalWait` 关着时不再预热那个 worker（省 ~1.5GB 显存 + 启动 ~20s），代码与权重留着待确认再删。**测试**：`test:quiet-mic` 加第二档 -60dBFS（旧闸确实误杀 / 新闸确实放行 / 增益后模型输入 -19.7dBFS / 关键词 4/4），并修掉一条只会误报的旧断言（"增益版必须命中更多"在安静版已 4/4 时永远不成立 → 改 `>=`）；`test:asr` +唤醒变体/表一致性/延迟接线/校准共 11 条。回归：`test:quiet-mic` **11/11**、`test:asr` **74 通过/0 失败/1 跳过**、`test:sfu` **219/219**、`test:smoke` **389/389**、`test:asr-live` **PASS**（应答 2 次不多不少、说完→上字幕 1.8s）；教学 `AGENTS.md` 坑 **91**、`LEARN.md` **5.48** |
| 61 | **★ 第二张截图「全都是问题」：精确串过滤器被同音字打穿 + AI 认领自己的话（2026-10-05e）** | 房间 868127 账本原文：`「帮我打开 请在下一个视频里面打赞,许多 clic,支持、收养、多泫,看到更多 needL FI Ching」`——上一轮那四条幻觉正则**全是精确串**（`点赞订阅转发打赏…`），而实测是「**打赞**」「**收养**」，一条都不命中 → 48 个字的幻觉原样上字幕条。**直接诱因是我自己把能量闸 -55 放宽到 -62**：噪声段终于能进转写，"少字幕"这个病就变成了"垃圾字幕"那个病——▸ **放宽一个阈值不会消灭问题，只会把它推到下一环**（AGENTS 坑 92）。**修法**：判据从"预测它说什么"换成**分布特征**（`Asr.noiseRiffReason`，纯函数、返回命中理由）：强锚一个即丢；否则要"求赞家族"（赞/订阅/收藏/打赏/弹幕/关注）**且**"平台词"（视频/频道/栏目/支持/更多）同时命中才丢；再加拉丁乱码计数。**「转发」刻意从平台词里踢掉**——留着就会误杀"这个方案我点赞，大家转发一下"（反例已钉）。同场第二个缺陷（一直存在）：AI 的回答被当字幕入账本 → 看板抽成"没有负责人的行动项" → **AI 播报自己的话并问谁来认领**；修在 `feedBoard` 只消化 `!e.bot` 的条目（账本仍全量给 RAG，"会议内容"这个概念只包含人说的话）。 | `sfu/ai/asr.js`、`sfu/server.js`、`scripts/test-asr.js`；AGENTS 坑 **92**；回归 test:asr 82 / 冒烟 389 / 信令 219 / asr-live PASS |
| 62 | **★ 「纪要别念那么长的名字」+ e2e 最后那个红点：一条被实测否决的"热词"路线（2026-10-05f）** | ① **播报瘦身**：新导出纯函数 `Tts.speakable()`——markdown 链接**只留名字去掉地址**、`/minutes/…-终稿.md` 这类路径整体换成「（文件）」、代码块与 URL 同理、表格竖线换逗号；浏览器那一轨 `speakableText` 补同两条规则（**两轨必须念同一句话**）。② **`test:e2e-asr` 22 项 / 0 项失败**：最后一条红的是「小明，把纪要生成一下」在 2s 分段里被听成「**既要**生成一下」。最直觉的方案是**给模型加会议热词 context**，一次对照实验把它**否决**了（本机 0.6B/GPU，量完即删脚本）：整段音频**有无热词都转对了**，而**纯静音 + 热词**模型把热词**整句照抄**回来，那句里带「小明」= **幻觉自己唤醒自己**（坑 64 原样复发）。▸ 教训入册为**坑 93**：任何 prompt/context/hotword 改动，验收必须含**空输入**用例，断言"回来的东西不含我给它的话"。落地改在文本侧 `Asr.fixDomainHomophones()`：「既要/记要」**只在紧邻动作词**时才改成「纪要」，句中出现「又要」整条不替换（3 正例 + 3 反例钉住）。③ **定稿原因 `fin`** 同时进 `asr-caption` 与字幕账本：`silence` 之外的 `max-open/max-age/gap/flush` 都发生在人还在说的时候，所以 `latMs=0` 从此是**可解释的 0**；自测判据据此补一档——本轮撞上的真实场景是 qwen 预热中走 whisper 兜底、单段 8~10s > 6s 时长保险丝，于是 `test:asr-live` 把**降级路径的正常形态**报成"读数丢了"（坑 90 末段待办就此收尾）。④ 一个**错的数差点骗我去优化不存在的问题**：日志里「答案上屏→听到首段 23.5s」其实是配对配错（入会致辞也是 `from='ai-bot'`），改成"取首段音频之前最后一条应答的 ts"后真实值 **2.4s**。 | `sfu/ai/{asr.js,tts.js}`、`sfu/server.js`、`sfu/protocol.js`、`scripts/{test-asr.js,test-e2e-asr.js}`；AGENTS 坑 **93**；回归 **e2e-asr 22/22**、test:asr **96** / 冒烟 **389** / 信令 **219** / quiet-mic **11** / asr-live PASS（定稿 1.7s） |

| 63 | **★ 「答应了却不说话」修到有界 + 共享格终于看得清字 + 跨网"配一次就长期对" + 界面第一处跟着光标的反馈（2026-10-06）** | 五件事，全部真跑取证。**① TTS 兜底的第三种失效形态：不是没发信号，是信号来得太晚**（坑 94）——`finish()` 原来 `await Promise.all(jobs)` 才补那句 `ai-tts-fail`，而 Edge 内部超时 12s、并发闸 2 路 → "我答应了"到"我承认发不出"可以隔 20s+；更坏的一半是链路在收尾前抛错时这句道歉**永远说不出口** = 永久无声零报错。修三层：决定有截止时刻（`TTS_DECIDE_MS=8s`）但**按引擎能力分档**（显式开 `aiTtsLocalWait` 的本地音色一句 5~20s，统一 8s 会每次抢跑判它死刑 → 那个配置变空转，坑 67 复发）、Edge 合成显式 6s 预算（健康值 1.4s/句）、**客户端自己装 20s 保险丝**且回落时把 ts 记进"这一轮不再念"（决定先于音频第一次成了正常时序，不记就双声）。配套测试接缝 `TTS_FAKE_FAIL=1`（判在缓存之前）——端点可达性随网络出口漂，没这条缝这条最要命的路只能等网络自己坏一次。实测：强制失败 **ai-tts-fail 1.3s**；真实 Edge **音频 6 段 / 首段 2.3s**。**② 计数断言里混进恒存在的事件**（坑 95）：`test:asr-live` 把 AI 入会致辞算成"应答"，于是 `>=1` 那条正向对照**永远不会红**（它自称证明了唤醒链路，实际什么都没证），而 `<=2` 的名额被白占一条 → 正常分段被报成"应答风暴"。10-04e 在 e2e 修过同族，这次轮到自测——**同一个坑只修一半=半迁移**（坑 57 第三次应验）。**③ 共享格终于看得清字**：宫格视图按**列数**占 2×2（`applyScreenSpan()` 量 `gridTemplateColumns` 写进 `--screen-span`，CSS 只消费）。第一版只 span 列，三条几何断言全绿而**一张截图当场露馅**（同行格子一半高、底边参差）→ 教训入册：**布局改动的验收必须看图，ar=1.778 全绿不代表它好看**。黑边同时 token 化（`--tile-bg`/`--tile-blank`，原来硬编码的 `#0a0805` 比画布还冷还黑，读起来像贴图坏了）。**④ 跨网从"每次靠自愈兜"改成"配一次就长期对"**：新增 `sfu/nets.js` 作唯一实现（server/doctor/test 共用），按"名字像真的对外网口 + 私网段"打分，**主动避开 VirtualBox/WSL/Docker 那种本机通、别人路由不到的假局域网地址**；新配置值 `announcedIp:"auto"`；Tailscale 地址**报出来但不抢主位**（启动日志 + `/config.json` 的 `tsUrl` + 点房号徽标时一并写进流程日志）；顺手修 `lanUrl` 无论 HTTPS 开没开都硬写 `https://` 的真缺陷。新增 `npm run test:nets` 17 项。**⑤ 界面第一处跟着光标走的反馈**（style.css 第 37 节）：画面格**聚光描边**（学 reactbits Spotlight Card 的运动语言，零依赖手写：`mask-composite: exclude` 把渐变裁成 1px 环，所以光不盖在共享画面的文字上）；JS 侧 rect 只在 pointerenter 量一次（坑 59）、位置每帧最多写一次（rAF 闩锁），两条各有一条断言。`check:visual` +4 条**真鼠标**断言，其中两条第一版读到 0.309/0.036 判成失败——**量具在跟自己的动画赛跑**，改成轮询到停住（坑 96）。 | `sfu/ai/tts.js`（`TTS_FAKE_FAIL`）、`sfu/server.js`（`TTS_DECIDE_MS`/`decideMs`/`synthAndEmit` 超时/`Nets` 接线/`tsUrl`）、`sfu/nets.js`（新）、`sfu/public/client.js`（`fallBackToBrowserTts`/`armServerTtsBackstop`/`applyScreenSpan`/`initTileSpotlight`）、`style.css` 第 37 节 + token、`scripts/{test-nets,check-visual-pass,check-screenshare,test-asr,test-sfu-client-smoke,doctor,start-lan}.js`；AGENTS 坑 **94/95/96/97**；**★★ 长跑调查顺手抓到的真产品缺陷（坑 97）**：`switchMic`/`switchCamera` 用 `xxBtn.textContent === '静音'/'关摄像头'` 当状态判据，而第 43 步给按钮加了"两层同样的字"之后 `textContent` 变成「静音静音」——相等判断永远 false ⇒ **换过一次输入设备，麦克风/摄像头就自己关了**，日志还写着"已切换（成功）"；这是"加入会议后识别失败 / 用一会儿就不行"的第四块独立成因（与 10-04g 端口撞号、10-05 能量闸错位都不是同一件事）。同一处写法也把 `test:voice-longrun` 弄哑了三个月（它自己连点三下把麦关掉，再报"识别停了"）——修完一次跑通：**2 分钟 12 条定稿、最大停摆 12s、AI 应答 11 次、6/6 全绿**。配套新增**输入侧健康**三格（`COLLAB.input` → `/api/rooms` 的 `collab.input` + `/metrics` 的 `sfu_ai_asr_input_*`），"这个人为什么没字幕"第一次能一眼分成"没人送声音"与"送了但没转出来"；测试语音收成唯一实现 `scripts/voice-fixture.js`（三份重复、其中一份还在用已被实测否决的"全角空格造停顿"），`test:e2e-reconnect` 从此喂真语音，"续会识别"第一次被真正验到（账本 17s 落盘 → `resumed=true`，15/15）；`/metrics` 探测补 admin token 后发现"预热 188s"是 401 假象，真值 **34s**；回归 **check:all 15/15·216 项** / 冒烟 **405/405** / 信令 **219/219** / `test:asr` **107** / `test:nets` **17** / `test:watch` 36 / `test:tts` 13 / `test:store` 55 / `test:shutdown` 9 / Mesh **36/36** / `test:e2e-media` **38/38** / `test:asr-live` **PASS**（两条路）/ doctor 22·2·0 |

| 64 | **★ 把"识别一段时间就停"查到底（RMS 参数单位写错）+ 表情用像素结案 + 操控实体补齐"组合/否定/顺序/说了没做要开口"（2026-10-06 下午）** | 六条全部真跑取证，四条留下**可红可绿**的 A/B。**① `astats` 的 `reset` 单位是"帧"不是"秒"**（G1）：听觉管线写 `reset=8000`，本意"每 8000 采样"，实际是 512 秒才重置一次统计 ⇒ 读到的 `Overall.RMS_level` 是**整场累计值**，静音段永远被人声垫高 ⇒ "静音已确认"永不成立 ⇒ 每条字幕都靠 10s 保险丝收口、⏱ 读数按诚实规则恒显示"量不到"。改 `reset=8`（≈0.5s 窗）+ 读窗内那行；ffmpeg A/B：新写法静音段读到 `-inf`，旧写法 -22dB 级。修后 `test:asr-live` **1.6s 且 `fin=silence`**、`test:e2e-asr` 定稿 **中位 1.7s**、6 分钟长跑 **37 条定稿里 36 条 silence**（修前清一色 max-age）。**② 有声判据跟着本机噪声底走**（G2，新纯函数 `Asr.createVoiceTracker`）：`min(绝对上限, 噪声底第20百分位+6dB)`，样本不足 8 个不猜。A/B：安静麦克风 **0/300 → 235/300 判有声**，吵房间行为一字不差（反向对照钉住"更灵敏"不能变成"什么都算说话"）。**③ "表情到底变没变"用像素结案**（G3）：量具换了**三版**，前两版都被自己的 A/B 推翻（截屏矩形里混着波形条与逐字字幕 → 换成静帧仍报 Δ38；`ctx.drawImage` 只画动画第一帧 → 真动图报 Δ0）。最终版按停所有非脸律动后再量：**静帧 Δ0.11 / 真口型素材 Δ14~33**，三张静态表情两两可分 Δ14~24。顺带抓到两条**用户可感知**的真缺陷：小动作排程挂在每条 ai-state 上而被重复的 `listening` 广播**永久饿死**（坑 100）、格子建得比状态消息晚时**链条彻底断掉**（坑 101）。**④ 跨网入口进界面**（G4）：顶栏 `#crossLinkBtn` 只在服务器真下发 `tsUrl` 时出现（双向 toggle，配置改回去就藏掉——**点了打不开的假链接比缺失更糟**），`crossInviteLink()` 为唯一构造点；新增 `TS_IP` 明示覆盖（也让人没装 Tailscale 的机器能测正例）；`/config.json` 首屏就读（读取器 4 个、落地函数仍 1 个）。真浏览器两个分支都跑过。**⑤ AI 操控实体补齐四件事**（G5）：`detectRoomActions()` 按说出来的顺序做多件事（「把白板打开，顺便把字幕也开一下」以前只做白板）；否定守卫补上**关类动词**（`不要关白板` 以前会把白板关了——**做错方向比不做更糟**）；`ruleMatch()` 优先取非空匹配的位置（零宽前瞻以前把句尾动作记成位置 0，导致"最终视图与用户说的相反"，坑 99）；**说了没做当场自己发现并说出来**（按「房间|动作」挂 4s 看门狗，无回执就在同房补一句；回执判据从"我动手了吗"改成"要的状态成了没"，否则本来就开着白板时会当众报一条假故障）。四条 A/B 各证过可红。**⑥ 又移植两个 reactbits 效果**（G6）：CountUp 数学抽成 `sfu/public/countup.js` 纯函数（单测当场逼出 `Number(null)===0` 把"没有样本"滚成 0 的缺陷，坑 102b），端到端抓到**动画启动前模板已写终值 → 滚动根本看不见**（坑 102a）；AI 看板分区错峰入场只在"切到这一栏"那一刻播，真浏览器实测 delay **0/45/90ms**。测试侧三条口径修正（都是"红的其实是采样时机"）：`e2e-asr` 正解命中改成**累积每一条定稿**再判（2s 分段把长句切碎后快照里就是不包含关键词）、白板像素**等到出现为止**（≤10s）、B 没进房时打印**双侧现场**（一次红会连拖四条下游断言，光看红列表猜不出哪一段没通）。**⑦ 回归跑完后自查又补两处**：组合指令的回复以前只拼**第一条**动作的"怎么用"（同一份信息给一半，坑 56 形状）→ 每件各带自己的提示 + 两条信令断言；新增业务 JS `countup.js` 差点**静默掉进 SW 的 cache-first 档**（坑 40 的复发路径：改了不生效，而 SW 只在自身字节变化时才重装）→ 加一条**遍历目录**的冒烟红线（`sfu/public` 下除 vendor/sw.js 外每个 .js 必须登记为 network-first，漏登记当场红；A/B 证过：临时放一个未登记文件即红）。 | `sfu/server.js`（astats 参数/`COLLAB.input` 自适应/`createVoiceTracker` 接线/`detectRoomActions` 多动作/`pendingRoomActionAcks` 看门狗/`tsUrl`+`TS_IP`）、`sfu/ai/{asr,roomActions}.js`（`ruleMatch`/否定守卫/光杆动词）、`sfu/public/{client,countup,sw}.js`（表情量具配套修复、回执诚实、错峰、CountUp、SW 分档）、`sfu/public/{index.html,dashboard.html,style.css}`、`scripts/{test-asr,test-sfu-client-smoke,test-sfu-signaling,test-e2e-asr,test-room-actions,test-nets,check-ai-avatar,check-visual-pass}.js`；AGENTS 坑 **98~102**；回归 **check:all 15/15·222 项**（check:avatar 28、check:visual 22）/ 冒烟 **425/425** / 信令 **223/223** / `test:asr` **122** / `test:nets` **19** / Mesh **36/36** / `test:e2e-media` **38/38** / **`test:e2e-asr` 23/23 连跑两次** / **`test:voice-longrun` 7/7（6 分钟 37 条定稿·最大停摆 14s·AI 应答 33）** / **`test:asr-live` PASS（1.6s）** / `test:room-actions` **11/11** / `test:agent` 24/24 / **`soak` 25 分钟 PASS（747 条信令·重连 0·150 条对账一致·rss 无上涨）** |

| 65 | **★ 把"我改了，你那边还是旧的"这件事本身修掉 + 拿真账本回答"到底能不能用"（2026-10-06 傍晚到夜里）** | 同一批要求的第三轮，不加新功能面，全补"真实落地"缺的几块。**① 版本自检（坑 40 的最后一块）**：服务器按**内容哈希**改写 index.html 里 `client.js/style.css/countup.js` 的 `?v=`（mtime+size 作缓存键），并经 `/config.json` 下发 `assetVersions`；页面拿自己**实际加载到的**版本与之比对，不一致就出一条带「用最新版打开」的横幅（按钮保留查询串——会中点它不能被踢回首页）。判据保守：老服务器没下发就一声不吭、一致时**不许**弹（常亮的假警告会让人不再相信警告）。真浏览器实测 `served=advertised=loaded` 三方一致 + 人为造不一致→出现→恢复→消失。**② 邀请面板（第 47 步）**：跨网那条链接以前只写在流程日志里（等于没有）。现在点房间号徽标 = 复制局域网那条（老路径一次点击不变）**+ 展开面板**把两条链接摆在一起各带复制；**没有跨网入口时那一行写明"没有"、复制按钮跟着藏**（假链接比缺失更糟）；说明只讲这一屏才成立的事实。顺手抓到一个真缺陷：`if (cfg.tsUrl) tsUrl = ...` 只写有值那一侧 ⇒ 撤掉 Tailscale 后页面永远留着旧值，而下面那行注释声称"没有就藏"是**假的** → 改双向赋值 + 断言钉住（坑 76）；三处复制原先只有徽标写了失败兜底，另两处静默失败 → 合并成唯一 `copyText()`。9 条真浏览器断言里有一对互相印证：「点徽标展开且同一趟点击没把它关掉」+「点外面会收起」——只有后者成立，前者才不是"监听根本没挂"换来的假绿。**③ `npm run review:meeting`（新，含 `test:review` 自检 19 条）**：读 `sfu/captions/*.jsonl` + `sfu/logs/app-*.jsonl` 出真实可用性复盘。理由很硬：一百多条回归全跑在合成语音上，而"自测数字"与"真人会议"在本项目**相反过两次**。每场 11 行结论、**每条带样本量**：连续性（"段还在到达却没字幕"才算停摆，光看字幕间隔会把"没人说话"当故障）、定稿延迟（**只采信 `fin=silence`**）、碎片率、噪声幻觉、听觉进程死没死、能量闸分档、唤醒漏斗、播报引擎、AI 操控"发出 vs 执行"。拿用户抱怨那两场真会跑出来：283648 → **"6 段峰值在 -62dB 之上仍被跳过 ⇒ 那场会跑的是旧阈值"**（这一行直接回答"我改了怎么还不行"）；868127 → 1 条求赞话术被生产判据认出。判据**复用生产代码那一个函数**（`noiseRiffReason`/`isDupOrFragment`/`normAsrText`）。**④ 再移植两个 reactbits（style.css 第 39 节）**：ShinyText 给「加入一场会议」、BorderGlow 给**会超时的授权卡**（它以前只有一个静态金边，用户切窗口看资料时不会回头看——这里的动感是催决定的信号）。`@property --ac-angle` 是命门：不注册则浏览器把自定义属性当字符串，动画"在跑"而角度不插值。量具改了三次（拿卡内部当 0 对照 / 拿 reduced-motion 当对照 / 拿环带平均当判据），终版三层：读原因（角度 0deg→141.66deg）+ **只暂停这一条动画**比峰值与热点（418→0 · 682→0）+ 数环上亮像素（坑 104）。**⑤ 屏幕格黑边换成模糊衬底（第 48 步）**：contain 是修对的（裁掉文档边缘=没共享）但它**一定留边**，而暖墨底上的死黑边读起来像"贴图坏了"；比例由对方决定，不能为填满去裁 ⇒ 同帧放大模糊垫底（Zoom/腾讯会议 fit 模式同一招）。用第二个 `<video>` 共用同一条 MediaStream：解码只有一份，模糊与缩放全在合成器做。顺手抓两处"按位置取子节点"会被新元素打断（画中画会弹出一窗**模糊画面**、检查脚本把 contain 判成 cover）→ 改**追加**而非前插 + `:not(.tile-blur)` + 全文件结构红线（坑 103）；黑边底色从 video 元素**挪到格子**，否则它画满元素矩形把衬底整个盖掉=改了个寂寞。A/B 像素实验：黑边亮度 **13→105 / 13→72**，内容区 143 vs 146 不变，另存现场图供人复核。 | `sfu/server.js`（`assetVersion`/`injectAssetVersions`/`assetVersions`）、`sfu/public/{client.js 第 46a~48 步,index.html,style.css 第 38~39 节}`、`scripts/{review-meeting,check-visual-pass,check-screenshare,test-nets,test-sfu-client-smoke}.js`；AGENTS 坑 **103 / 104 / 105**；回归 **冒烟 443/443** / 信令 **223/223** / `test:asr` **122** / **`test:review` 19/19（新）** / `test:nets` **20** / **`check:all` 15/15·245 项**（check:visual 15→**40**、check:screenshare 10→**20**）/ e2e-media **38/38** / **e2e-asr 23/23** / room-actions **11/11** / e2e-reconnect **15/15** / quiet-mic **11/11** / asr-live **PASS（1.7s）** / Mesh 36 / agent 24 / doctor 23·1·0；⚠️ `test:voice-longrun` 本轮因本机只剩 2.2GB 空闲内存而在浏览器启动阶段 CDP 超时（**没跑通，如实挂着**，上一轮 7/7 仍有效） |
| 66 | **★ 从"会背题"到"会泛化"：AI 操控实体的最后一半，以及真实账本把我自己刚写的规则判红（2026-10-06 深夜）** | 用户第五次说"AI 操控实体类的功能还是实现的不行"，这次不再加新功能面，而是**换输入源去量**。**① 泛化缺口是量出来的**：现有 32 句电池**全绿**，另写 28 句**从未进过规则表**的自然口语 → 首跑 **13/28 = 54% 不命中**（「弄个白板」「白板不用了」「字幕先停一下」「把刚才画的都擦掉」「刚才那一笔不要了」「把说话的人放大」「能不能给我配个字幕」…）。补齐"动词/量词/倒装/省略宾语"四类分支 → **28/28**，并挑 6 句进**真浏览器**断言界面真的动了（`test:room-actions` 11→**17**）。▸ 教训=**坑 106**：电池和规则是同一只手写的，只会绿的电池测的是记忆不是能力。**② 一条"做错方向"的缺陷**：「别切宫格，把白板打开」以前会把**宫格执行掉**——否定副词与命中点之间夹了个轻动词"切"，旧守卫要求"别"紧贴命中点，差一个字整条守卫形同虚设。修法只做**窄扩展**，**有意不做**"整小句有否定就压掉"：语音送来的句子常常没有标点，「不要开白板把字幕关掉」按小句判会把后半句一起压掉。A/B 用旧守卫副本证过可红（`[view-grid,board-open]` → `[board-open]`），10 条否定反例一条没被误伤。**③ 越界的"归类"也要准**：「把推广视频发一下」曾被判成 **camera**（旧表把裸"视频"当设备词）→ 现在裸"视频/画面"必须与 开/关/打/闭 同现；另外补上「把会议录下来」「共享一下我的屏幕」两种真正说法的明确拒绝。**④ ★ 真实账本回扫抓到我自己刚写进去的误拒**：为收 ③ 写的 `录(下来|一下)` 让「把这条**记录**一下」被判成"开录制"并**明确拒绝**——拿 `sfu/captions` 的 **3332 句真人字幕**回扫，这一句出现 **11 次**，是用户对 AI 说得最多的一句求助、而且它本来真能办。修 = `(?<!记)`；**误拒 14 → 1**（剩的一句是"打赞/收养"那条噪声幻觉）。这件事变成**常驻三处**而不是"下次记得扫一遍"：`review:meeting` 新增「**指令回扫**」行（按当前规则重放人话，报占比 + 例子，<10 句报 ❔）+ `test:review` 19→**23**（含"真祈使句必须数得出来"的反向对照——没这条仪表就是白装）+ `test:asr` 2 条。**⑤ ★ 顺手纠正一次**我自己把数据读错**：回扫第一版把账本所有非 bot 条目当"人说的话"，得到"18 句会触发、多数是 AI 回声"，差点为它写抑制规则。核 `asr` 字段才发现其中 13 条是 **AI 写进账本的存档回答**（`asr:false`，不是谁说了这句）；真正的麦克风转写 **864 句里触发 3 句，而这 3 句全是真命令** ⇒ **误触发 0，那个现象本来不存在**。于是修的是**口径**（只数 `asr===true`）+ 把断言从逐句清单改成**比例 ≤2% + 样本量门槛**（**坑 107**：报表现象之前先确认字段语义）。**⑥ 长跑结案**：`test:voice-longrun` 这次 **7/7**——5 分钟 **31 条定稿全部 `fin=silence`**、最大停摆 14s、0 崩溃 0 永久放弃、AI 应答 28、定稿延迟 **min 1.3 / 中位 1.8 / max 3.1s（n=31）**；上一轮的"没跑通"确认是机器只剩 2.2GB 内存导致浏览器启动超时，**不是代码问题**（本轮没改那台工具）。 **⑧ 一处"三个副本"收口，顺手让复盘工具改口**：三个语音测试各写一份"喂假麦克风的句子"，收进 `scripts/voice-fixture.js` 的 `FIXTURE_SENTENCES`（字符串一字未改，断言照旧）+ 导出 `looksLikeFixtureCaption()`（大元组覆盖率 ≥0.6，短碎片不下结论）。于是 `review:meeting` 页脚那句**"本报告不区分真人场与自测场"过期了**（坑 82：过期声明比缺失更糟），改成新增一行「谁在说话」= 自测场 / 混合场 / 真人场 / ❔，并写明这是启发式（真会里有人复述同一句也可能被标——**过度自信的声明同样有害**）。三档不是二档是被真数据逼的：房间 204534 命中 48%，按二档会报"真人场"，可那里几乎每两句就有一句在念稿 ⇒ **判据在边界上给出反直觉结论，是边界画错了位置**（坑 53）。实测 10-06 三场命中 89% / 90% / 70% 标自测场，754183、843896 命中 0% 标真人场。▸ 这台仪表中途**先跑飞过**：房间级"整场拼起来像不像念稿"的补判据，把一场「3 条念稿 + 5 条真讨论」报成自测场——因为拼接后当然含那句完整话，而**真人会上也有人真说过那句请求**。是旧断言 M2 把它拦下来的（期望混合场却读出自测场），修法不是放宽断言，而是给抬档加前提（小碎片要占多数）+ 补一条反例 M4 钉住：**新加的判据必须先用旧断言撞一遍**。  **⑦ 同一方法论用到第二处语言界面**：`sfu/ai/brain.js` 的意图分类拿 22 句新说法测，首跑 7 句落进 `question` 且**全在 chat 类**（「你能帮我做什么」「小明你在不在」「你现在在听吗」），而无 key 时 question 的 prompt 写死"只依据会议记录回答" ⇒ 用户报的"答非所问"换个说法复发；修 `chat/minutes/operator` 三类说法后 22/22，并**有意保留**一处保守（裸"输入"不判 operator，误判要把人推进授权链路，漏判只是少做一次动作）。 | `sfu/ai/roomActions.js`、`scripts/review-meeting.js`、`scripts/{test-asr,test-room-actions}.js`；AGENTS 坑 **106/107**；导读 **LEARN 5.53**；回归 **test:asr 130/0**（+1skip）/ `test:ai-brain` **75/75**（+1 意图泛化 22 句）/ `test:room-actions` **17/17** / `test:review` **29/29**（+4：自测场/真人场分档） / `test:smoke` **444/444**（+1 结构红线）/ `test:sfu` **223/223** / **`check:all` 15/15·245 项**（重跑确认）/ **voice-longrun 7/7**；⚠️ 本轮改动**全在服务器进程里**，需**重启 3001** 才吃得到（页面侧一行没改） |
| 67 | **★ 「不叫小明，小明就不说话」+ 我自己的测试音频被用户驳回（2026-10-06 夜）** | 用户："识别不是很准确，这是一个正常的会议，如果不提到小明的名字小明不应该说话，只有叫到小明的时候小明才会说话思考回答"。**① 先拿他自己的账本定案**（`cap-286716-20261006.jsonl`）：21 句麦克风转写只有 4 句提到名字，AI 答了 **18 次**。三条独立成因各自都能单独造出同一症状：**(a)** 09-28 的 20s「追问窗口」每次应答都顺延 ⇒ 常开麦的会议里**永远不关**；**(b)** `maybeAiSpeakUp` 没人叫它也主动播报；**(c)** 唤醒表把 **小米/小命/小民** 与 小明 一视同仁（「说**小命**的话」就是这么醒的）。**② 修法**：`aiChatWindowSec` 默认 20→**0**（留 config + `AI_CHAT_WINDOW_SEC` 做 A/B）、`aiProactiveSay` 默认 **false**（看板照旧记账，关掉的只是"说"）、`Asr.shouldWake` 从"像不像名字"改成**分层**——强后缀（明鸣名铭茗）任意位置都算，歧义后缀（米民密蜜命）**要有称呼语境**才算（10-05 实测的「你好 小米」不退回漏醒）；另开一条**一次性、不顺延**的分段续接（`aiAskTailSec` 默认 6s），否则纯唤醒会把「小明。」+「把纪要生成一下。」变成"喊它它不理"。称呼词表第一版被真账本打回：裸「在不」跨词命中「如**在不**不」⇒ 只收多字说法。**③ 「识别不准」的字面证据 = blob**：静音判定被房间噪声顶住时只能靠 10s 保险丝收口，三句话粘成「哦 不能往上怎么接那个 大木车是不是 你好小明」。新增纯函数 `Asr.startsNewSentence`（句末标点 + 归一化 ≥12 字 + 新段无归并关系 ⇒ 就地定稿另起一句）。**下限是被真跑抓回来的**：第一版没下限，`test:asr-live` 当场把一句完整请求切成「小明，帮我记一下。」+「明天下午三点的评审。」，AI 只听到前半句就答 ⇒ **用"字幕好看"换了"请求不完整"**（坑 109）。**④ ★ 用户驳回了我一半证据**（"你测试的音频乱的不像话"）——他说得对：合成 fixture 每句都写着「小明」，**结构上测不出误唤醒**，而我把 2s 分段的原始切片当成了结论。据此：**停掉**"拿合成音频比 2s/3s/4s"的调参（真人批次只有 3 场、人还不同 ⇒ 样本不支持任何结论，`asrSegmentSec` 一行没改）；把判据搬回**真人数据**做成常驻仪表——`review:meeting` 新增「**唤醒回扫**」（21 句按当前判据会醒 5 句 · 歧义醒 0 句 · 而这场**实际应答 18 次** ⇒ 差 13 次来自已关闭的窗口 = "我改了你怎么还不行"的答案）与「**字幕形态**」（平均/中位/最长 + ≤4字碎片% + ≥25字长条%），`test:review` 29→**37**（含"仪表自己必须能红"的反向对照）。**⑤ 两条链路都要成立**：新增真浏览器检查 `npm run check:wake`（9 项）——把 21 句真实句子喂给**页面自己的** `aiWakeHere`，与服务端逐句对表，并**直接调 `emitCaption()` 断言发不发 `ai-ask`**（没叫 0 次 / 叫了 1 次 / 同句 8s 内重复仍 1 次）。A/B 反跑：把浏览器判据换回旧宽表 → **精准红**在「说小命的话」「我买了个小米手机」。**⑥ 界面说实话**：AI 入会第一句现在明说「开会时我**不插话**——要我用，喊一声「小明」＋想做的事」（规矩只在代码里 = 用户只能靠踩雷学）。 | `sfu/ai/asr.js`（分层 `wakeReason`/`startsNewSentence`/同名函数覆盖事故现场注释）、`sfu/server.js`（`AI_CHAT_WINDOW_MS` 默认 0 + env、`AI_PROACTIVE_SAY`、`AI_ASK_TAIL_MS` 一次性续接、`asr-sentence-split` 埋点、入会致辞）、`sfu/public/client.js`（`aiWakeHere` + 调用点）、`scripts/review-meeting.js`（唤醒回扫 + 字幕形态）、`scripts/{check-wake-scope,test-asr}.js`（新检查 + 20 句真实电池）、`sfu/config{,.example}.json`；AGENTS 坑 **108 / 109**；回归 `test:asr` **146/0**（+1skip）/ `test:sfu` **223/223** / 冒烟 **445/445** / `test:review` **37/37** / `check:wake` **9/9** / `test:asr-live` **PASS**（应答 **1 次**、1.7~1.8s；`AI_CHAT_WINDOW_SEC=20` 复跑**红**在"闲聊句被接了"）/ `test:e2e-asr` **23/23**；⚠️ 词级准确率（大木车/洗地皮/庭审会）**未解决**——本地 0.6B 在 -56~-65 dBFS 的天花板，三条路（云端 DASHSCOPE / 更大本地模型 / 靠近麦克风）等用户拍板 |

| 68 | **★ 「识别太笨」不是模型笨，是我们只给它 2 秒——整句重转 + 它牵出的三件事（2026-10-07）** | 用户："实时字幕长度太短要整句话显示但不越线 / 识别太笨要真正能用 / 跨网继续优化 / 共享比例还不协调要丝滑 / 背景要能选明亮"。**① 整句重转**（本轮最大的结构性修正）：管线一直把语音切成 2 秒一段**分别**转写再拼句子，而中文的词会被切在段边界上（实测「服务器」→「服务。」+「起负载」、「评审会」→「评审。」+幻觉「怎会？」）。一次对照实验（同一批生产函数、同一段音频）量到：逐字全对 **1/6 → 3/6**、模型总耗时 **4.34s → 3.22s**。落地 = 定稿时把这一句攒下的整段 PCM 一次喂回模型，由纯函数 `Asr.preferRefined`（比例判据）决定采不采用——**宁漏修不丢字**；引擎链抽成唯一一处 `runEngines`，账本带 `ref:1`、`/metrics` 三条计数、`review:meeting` 多一行「整句重转」。**② ★ 这把尺当天就量出自己的反噬**：`TEST_ASR_DEBUG=1 npm run test:asr-live` 复跑**由绿转红**——吵房间里拼接「…明天下午三点的评审」被重转扩成「…评审**器真不错,拍麦亚。**」，而变长的那条**把下一句的正确定稿按去重吞掉了**（账本只剩 1 条）。补两条**只管"变长"**的膨胀上限（句末标点不许变多 / 长句不许超 1.35 倍，短句豁免）。第一版把它们做成无条件判据，又杀掉一条**明显更好**的重转（更短、词全对、只是补了标点）——判据该问"它听见了比这一句更多的东西吗"，不是"标点多了吗"。**③ 静音确认在吵房间里整条失效（H8）**：判据 `min(绝对阈值 −50, 噪声底+6)` 只允许更灵敏，于是底噪 −43 本身就高于阈值 ⇒ 每帧都判"有人在说话" ⇒ 静音永不确认 ⇒ **三句话粘成一条 blob**（A/B：旧版 **180/180 帧底噪判有声** → 新版 7/180 暖机帧）。改成**双边钳位** `clamp(底噪+6, −74, −42)`，上端那条硬线是为了不把 10-05d 那批 −56 dBFS 的安静麦克风用户弄聋。▸ 最贵的一课：**当年"吵房间行为与修前一字不差"是被当成卖点写进断言的**，而它保护的就是这个 bug 本身——**"不改变旧行为"不是安全性质**（新坑 115）。**④ 顺带掉出两条真缺陷**：装句尾字的那一段还没被消费时定稿闸就放行（「会」凭空落进下一句）⇒ 新增 `pendingTailSegment()`；`AI_ASK_TAIL_MS = Math.max(2000, 秒) * 1000` 把秒和毫秒混在一个表达式里 ⇒ 6 秒变成 **33 分钟**（日志实证 `tailUntil剩余=1981680`），后果正是用户最反感的"只喊一声名字之后半小时它什么都接"。**⑤ 字幕卡两行**（"太短"的真身是单行胶囊与 8 个控件抢地方）：正文独占一行、恒定两行高、超出省略号、全文进 title 与历史抽屉。**⑥ 明暗双主题**（水墨/宣纸）+ 顶栏开关 + 首帧前落地，浅色档对比度实测 14.53 / 15.71 / 16.67 / 4.97 / 5.35 全部 ≥4.5。**⑦ 共享"比例不协调"的真身不在比例**：`.stage` 的 `padding-bottom: 84px` 是**猜的坞高**而实际 201px ⇒ 网格伸到半透明玻璃坞底下被 `backdrop-filter` 糊出来一片；所有几何数字当时都对（ar=1.778、零溢出）而**画面是脏的** ⇒ 把底部那一列**放回正常布局流**，不是把 84 改成 223。**⑧ 跨网自检进界面**：`sfu/nets.js` 新增纯函数 `diagnose()`，把"这台机器能不能被外面连上、缺什么、下一步敲哪条命令"随 `/config.json` 下发并显示在邀请面板里（诚实边界：**mediasoup 媒体面不走 TURN**）。**⑨ UI 再优化**：分段控件一块**会滑的墨** + 视图按钮的 ▦/▢ 换全站同款线性图标。**⑩ 还抓到一处假数**：`check:all` 首跑报"20 条 · 312 项"——`check:invite` 在清单里**登记了两次**，而那条"清单与 package.json 一一对应"的自检比的是 `some/includes`，**结构上查不出重复** ⇒ 真实 **19 条 · 304 项**，补 `dupKeys` 判据并 A/B 证过可红。 | `sfu/ai/{asr.js}`（`preferRefined`/`createVoiceTracker` 双边钳位/「计要」别字）、`sfu/server.js`（`runEngines`/`uttAudio`/`refineUtterance`/`pendingTailSegment`/`RMS_GRACE_MS`/`numEnvOr`/`COLLAB.refine`/`netCheck`）、`sfu/nets.js`（`diagnose`）、`sfu/public/{client.js 第 49~50 步,index.html,style.css 第 40 节}`、`scripts/{review-meeting,test-asr,test-nets,check-caption-line,check-theme,check-invite,check-all,check-screenshare,check-visual-pass}.js`；AGENTS 坑 **111 / 112 / 113 / 114 / 115**；导读 **LEARN 5.55**；回归 **冒烟 444/444** · **信令 225/225** · **`test:asr` 196/0**（+1skip）· **`test:nets` 31/31** · **`test:review` 40/40** · **`check:all` 19/19 · 304 项**（新增 caption 19 / theme 18 / invite 8）· **`test:asr-live` PASS**（定稿 2 条全部 `fin=silence`、⏱ 3.1s、应答 1 次不多不少）；⚠️ **词级准确率天花板未解决**（大木车/洗地皮/庭审会）——本地 0.6B 在 −56~−65 dBFS 的上限，三条路（云端 / 更大模型 / 靠近麦克风）等用户拍板，不拿合成音频替他调阈值 |

| 69 | **★ 半夜间续跑：一个新机制的代价要在它变贵的场景里量（H5/H5b）+ 跨网退化常驻哨兵（H6）+ 一条常绿断言保护了一个 bug（H8）** | 同一批要求的第五轮，全部是**上一轮自己量出来的下一步**。**① H8 静音确认**：`min(绝对阈值, 噪声底+6)` 只允许更灵敏 ⇒ 吵房间底噪 −43 本身就高于阈值 −50 ⇒ 每帧判"有人在说" ⇒ 静音永不确认 ⇒ **三句粘成一条 blob**（`TEST_ASR_DEBUG=1` 摊出 `voiceThr=-50.0 floor=-42.9`）。改双边钳位 `clamp(底噪+6, −74, −42)`；A/B：吵房间底噪判有声 **180/180 → 7/180**，而中等（−60→−54）与安静（−72→−66）两档**与 10-06 一字不差**。**最贵的一课**：当年"吵房间行为与修前一字不差"是被当成**卖点写进断言**的，它绿了一整天，保护的就是这个 bug 本身 ⇒ **"不改变旧行为"不是安全性质**（坑 115）。**② 重转的两条膨胀上限只管"变长"**：无条件用"句末标点不许变多"会杀掉一条**明显更好**的重转（更短、词全对、只是补了标点）——该问的是"它听见了比这一句更多的东西吗"，而变短的重转结构上不可能藏着别人的句子（坑 109 同一条）。**③ H5 量化多人成本**（新工具 `npm run bench:asr-multi`，直接压真实 qwen-local worker、三档对比）：1 路 p95 0.60→0.37s（无代价）；**4 路 1.48→2.02s、8 路 2.80→4.20s，吞吐只剩基线 75%** ⇒ 重转与真话抢的是同一个单进程 worker（顺带查清一个事实：`ASR_CONCURRENCY` 那个信号量**只包 whisper CLI**，qwen-local 的排队在 Python 侧）。**④ H5b 忙时让路**：`runEngines` 外壳维护全服务器在途数 `asrEngineBusy`（分段与整句共用一个口径），定稿时在途 >0 就用拼接结果收口并单独记 `refine.skipped` ⇒ 4 路回到 **1.45s（×0.98）/92%**、8 路 **3.01s（×1.08）/94%**，而**单人档让路 0 次 / 重转 3 次**（反例守卫：让路做过头=功能整个不跑，报告上却与"修好了"一样）。**没有**采用路线图原本写的"只给要送给 AI 的那句做整句"——那会把字幕质量在多人房里整体退回，而字幕正是用户抱怨的第一件。**⑤ H6 跨网退化常驻告警**：`watch.js` 每轮读 `/config.json` 的 `netCheck`，`level` 秩下降报一条（第一观测不下结论、没变不重复报、恢复说一句），**配置漂移单独一条**——它常常不改变 level，不单独报就正好落在沉默那一类；9 条判据 + 3 条接线断言（各 A/B 证过可红），真服务器跑过一遍。**⑥ 一条自己写的假数**：`test-watch.js` 的助手是 `ok(条件, 名字)` 而另两个测试文件是 `ok(名字, 条件)`，我照熟的顺序粘了 9 条 ⇒ **9 条全绿而一条都没测**，露馅方式是输出里名字成了 `PASS true`（坑 110 第二次应验）；换序后当场 1 条真红，顺带查出产品侧真 bug：**漂移那条判据被写在 `level === before` 的提前返回之后**，于是"配置过期但自愈保住了 level"这个最需要提醒的形态永远不报（坑 116）。**⑦ H4 从"人肉逐屏看截图"改成"机器扫全页"**：`check:theme` 新增 `SWEEP`（沿祖先合成出实际底色、按 WCAG 算每一处在显示文字的对比度）+ `OPEN_OVERLAYS`（把历史抽屉/邀请面板/白板/滤镜/诊断卡/版本横幅/设备码面板逐个掀开），覆盖面 **23 → 57 处**；扫出并修掉浅色档 10 条 + 深色档 1 条（`--fg-faint`/`--accent` 按**最差的底**重定、日志色 token 化、升起按钮标签层 `var(--fg)` → **`inherit`**、`.react-btn` 从来没设过 color）。★ 顺手抓到一条**从 10-02 就在**的坑 26 家族隐患：style.css 有条注释漏了闭合符，把下一个小节头一起吞掉（这次恰好没吞到规则 ⇒ 两年无人看见），于是补了一条**冒烟结构红线**：CSS 块注释深度必须归零、不许有孤立闭合符，两个方向都 A/B 证过可红——防守从"注释里别写那个序列"这条人的纪律升级成机器判据（坑 40：纪律会被忘掉）。最后一格是 **`dashboard.html` 压根不跟主题走**（另一个文档、自带一套只按深色定的内联样式，选了宣纸点进面板仍是一整页黑）：18 个色值收 token、浅档重定、首帧前读 `sfu-theme`、**canvas 那 3 处改成运行时读计算值**（`ctx.fillStyle='var(--x)'` 不报错，只是悄悄退回黑色）。判据同时升级成**绝对红线**"两档各 0 条不合格"——相对线看不见两边一起烂。
 **⑧ H2 前提复测不成立**：原以为 RMS 按 ~4KB 成块交付、首行要等 5s；实测第一条诊断行就是 `rms=35行/28有声`、之后每轮 +48~64 行无停摆 ⇒ **从"推荐先做"降级为"等一次真机复现"**——待办也是会过期的声明，做之前先复测它的前提。 | `sfu/public/{style.css,dashboard.html}`（H4 token 化 + 面板页跟随主题）、`sfu/ai/asr.js`（`createVoiceTracker` 双边钳位、`preferRefined` 只管变长的两条上限、「计要」别字）、`sfu/server.js`（`asrEngineBusy`/`bumpAsrBusy`/`REFINE_YIELD_ABOVE`/`refine.skipped`/`numEnvOr`/两条新 metrics）、`scripts/{watch,test-watch,bench-asr-multi,test-asr}.js`、`sfu/config.example.json`（两条安全线的 env）；AGENTS 坑 **115 / 116**；导读 **LEARN 5.55.7**；路线图 **0.6** 的 H5/H5b/H6/H8 四行结案 + H2 降级；回归 **asr 202/0**（+1skip）· **watch 54/54** · 冒烟 **445/445**（+1：CSS 块注释成对闭合的结构红线）· 信令 **225/225** · nets **31/31** · review **40/40** · `check:all` **19/19 · 311 项**（`check:theme` 18→**25**：全页 + 浮层 + 面板页自动扫对比度）· `test:asr-live` **PASS ×2**（定稿 2 条全 `silence`、⏱ 2.9~3.1s；重转采纳一场 2/2、另一场 0/2——拼接本身已完整时它就不改，**整句重转是保险不是保证**）· `test:e2e-asr` **25/25**；⚠️ **8 路基线自己 p95 就有 2.80s** ⇒ 那是单进程 worker 的容量线（归 H1/多 worker），不记在重转的账上 |
| 70 | **★ 深夜再跑：本地 ASR 从「一条串行队列」变成「按成员分片的 worker 池」（H1a）+ 显存预算体检 + 三个我自己造的假"实测"** | 容量这件事以前只能感觉：8 个人轮流说时**第 N 个人的字幕排在前面所有人后面**，因为 qwen-local 是**单进程串行**推理（`ASR_CONCURRENCY` 那个信号量只包 whisper CLI，不包这条——查清这件事本身就是本轮的一个产出）。**① 池化**：`sfu/ai/asr_qwen_local.js` 的原单例整体包成 `makeSlot()`（自愈那套预算/重启/冷却/判死一字未改），外面加 1..4 个槽；**路由判据 = 按成员稳定分片而不是轮询**——同一个人的段必须按顺序回到同一句话的文本流（`mergeTranscript`/尾巴段/整句重转的音频账本都假设"这一段属于这个人"），轮询会让第 2 段从别的 worker 先回来，症状是"字幕半句颠三倒四"而**零报错**；槽被判死时退到任意活着的槽（宁可慢别没人转），全死返回空串由服务器回落 whisper（不丢字）。**② 实测（`npm run bench:asr-multi`，8 路 + 开着忙时让路，同一场次跑 1→2→1 三次）**：1 槽 p95 **3.14~3.18s / 2.59~2.62 次每秒** → 2 槽 **1.78s / 4.30**（≈1.65 倍），第三次复跑落回原值 ⇒ 这条差值不是"GPU 越跑越快"换来的。**③ 但默认仍是 1**：一槽常驻 **≈1.9GB 显存**（两槽实测总占用 5.0GB），而 8GB 卡上还住着浏览器解码与 whisper 兜底；**显存不够的后果不是报错，是引擎静默回落 CPU**（10-04e 为这条红过一整轮）。所以扩容要人显式开（`config.asrQwenWorkers` / `ASR_QWEN_WORKERS`），而 `npm run doctor` 新增 **A7d 显存预算体检**替用户把账算在开机前（配 1 个 ok / 配 4 个 warn 并给改小命令 / 把余量设成 0 又 ok = 三档证明那根线真在做功）。取值优先级收成**唯一一个函数** `resolveWorkers()`，服务器与体检共用（两处各写一份就会报出"体检说配了 2 个、服务器实际起了 1 个"这种没人会怀疑的矛盾）。**④ 可观测**：`sfu_ai_asr_qwen_workers`/`_alive`/`_in_flight` + `/api/rooms` 的 `asrWorkers{configured,alive,restarts,slots[]}`——"配了 2 个"与"活着 2 个"是两件事，只看配置会把"2 号槽早判死了"读成"扩容没效果"。**⑤ ★ 三个我自己造出来又撤回的"实测"**（坑 117，全部写进代码注释）：① 第一版量具报"加 worker 吞吐反降"——真凶是**没把 `key` 传到 `transcribe()`**，所有请求落 0 号槽、2 号槽白占 1.9GB 在旁边看着；② 我看到 6 个 id 里 5 个落同一槽就写注释说"实测旧哈希不均"，可那 6 个 id 是**我随手编的**，换 64 个真实形状再量两种写法都均衡（5/6 只是 n=6 的正常波动）；③ 第一次把"1 槽 2.73s"与"2 槽 1.34s"当结论，隔两小时复跑同一档漂到 3.18s ⇒ **绝对值随机器冷热漂，跨时间比的数不是实验结果**，改成同场次 1→2→1。**⑥ 顺带一条判据自己写错也会红**：断言里用 `RegExp.$1` 取上一个正则的捕获组，而同一条 `&&` 链后面还有个无捕获组的正则，它会把 `$1` 清成空串、`Number('')=0`，报成"常量配小了"（假红的第一个嫌疑人是判据自己，坑 80/110）。 | `sfu/ai/asr_qwen_local.js`（`makeSlot`/`resolveWorkers`/`slotIndexForKey`/`pickSlot`/聚合 getters）、`sfu/server.js`（`runEngines(wavPath, key)` 一路带到 `transcribe({key})`、`configure` 在 `warm` 之前、三条 gauge + `asrWorkers` 快照）、`scripts/doctor.js`（**A7d** 显存预算 + `VRAM_HEADROOM_MIB`）、`scripts/bench-asr-multi.js`（配了≠起了就硬退出）、`sfu/config.example.json`（`asrQwenWorkers` 带实测表）、`scripts/test-asr.js` ③.7b（9→**12** 条：分片稳定/路由接线/单一来源）；AGENTS 坑 **117**；回归 **`test:asr` 214/0**（+1skip）· **doctor 24 通过/1 警告/0 失败**（新增 A7d）· `bench:asr-multi` 三档对比复跑一致 ⚠️ **需要重启 3001 才吃到**（池大小是启动期决定的，且**不热插拔**——半路换分片会把同一个说话人的段序打乱）|
| 71 | **★ 共享文件浏览（第 51 步）：房间里所有人同时看同一份文档** —— **零依赖读 Office**：手写 ZIP 中央目录（含 ZIP64）+ 容错 XML 解析器，解压用浏览器自带 `DecompressionStream('deflate-raw')`，于是 docx/xlsx/pptx 不用装 mammoth/sheetjs/pdf.js 也能画；同步模型 = 服务器唯一权威 `room.fileView` + 变化才广播 + 连续量节流 / 离散事件绕过节流 + **位置传比例不传像素** + 客户端 `applyingRemote` 断环 + 新人 `files-state` 单播补发；安全两道 = 渲染层先转义再拼接（链接协议白名单 + 属性另转引号）+ 服务器非白名单类型强制 `attachment`+`nosniff`（SVG/HTML 有意不放行）；旧版 .doc/.xls/.ppt **如实报"请下载后查看"**。踩到并修掉的最有教学价值的一脚：浏览器那一轨的解压**自死锁**（TransformStream 写侧等读侧），Node 单测全绿而真浏览器界面空白 ⇒ 现在把源码装进**没有 require 的 vm** 里专门测那一支（坑 118）。★ 四层测试 + 两个真浏览器（同日第二轮把证据打厚后）：`test:fileview` **240**（O 组 22 条真实形状 + P 组 9 条图片预算 + 两轨逐字一致 6 条）· `test:files` 59 · `test:sfu` 270 · `test:smoke` **514** · `check:files` **58**（含 PDF 翻页**必须重建 iframe**、跟随方向 6 条这两处真缺陷的回归）· `check:all` 20 条 · **369** 项 · `soak` 四类流量含文件。导读 **LEARN.md 5.56 / 5.56.9 / 5.56.11** |
| 72 | **★ 把"word 还是不能观看"与"外面的人进不来"这两句查到底：旧版 Office 零依赖读出来 + 媒体走一条固定端口（2026-10-08 夜 → 10-09）** ▸ 用户："共享文件浏览的功能还行还没有完善，**word 什么的还是不能观看**…**跨网要升级到不同网也能进入会议的地步**"。两句话各自指向一件**当时没有任何断言覆盖**的事，而两条都不是"少做"而是"做错方向/静默不做"。**① 旧版 .doc/.xls/.ppt 从零读出来**（这是"不能观看"的真身）：它们是 **OLE2/CFB 复合文档** ⇒ 手写 CFB（DIFAT/FAT/MiniFAT/ministream）+ Word97 **piece table**（`wIdent=0xA5EC`、`fWhichTblStm` 选 0Table/1Table、PlcPcd 的 fc **bit30** 判 CP1252 单字节 vs UTF-16）+ BIFF8（SST + **CONTINUE 跨界重读 grbit**、RK/BOOLERR/公式 8 字节变体结果）+ PPT97 record tree，**依旧零依赖**；改名的（`.doc` 里装 docx）按内容**改道**、RTF 按 `\ansicpg936` **成对**收 GBK、HTML 伪装也认。**★ 三个只有真文件才会暴露的缺陷**：签名按记忆写成 `0x01A5`（真值 `0xA5EC`）⇒ 每个 .doc 被干净拒收（坑 131）、SST 的计数字段是 **u32** 而我按 u16 读 ⇒ 整张表全空、`ooxmlKindOf()` 漏一个 `await` ⇒ 改道路径**一次都没生效**（坑 76）。**② 新格式里"有但没画出来"的东西**：编号从样式继承（`pStyle → 样式 numPr → numbering.xml`，沿 `basedOn` 链，**`numId=0` 是否决不是没有**）、`mc:AlternateContent` **只取一份**（两份都画 = 同一句话出现两遍）、**域代码只取结果不取指令**（`PAGE` 曾原样印在页面上）、文本框 `txbxContent` 优先于〔图片〕占位、OMML 公式、Excel 的"值 + **格式码**"（`0.00%` ×100、`¥#,##0.00` 千分位、区段 `正;负;零;文本`、只有 `0#?.,` 算占位符）、`mergeCells` → colspan/rowspan、行号忠实。**裁判不是我**：`scripts/office-oracle.py`（python-docx/openpyxl 独立写 + 独立读）与 `scripts/legacy-oracle.ps1`（**本机真 Word/Excel/PowerPoint COM** 交出它自己认为的正文，断言覆盖 ≥70%）。**③ 跨网"外面真能连"那一层**：mediasoup **`WebRtcServer`** 把全部媒体汇到**一个固定端口**并**同端口再开 TCP**（封 UDP 的公司网/酒店网由 TCP 候选兜住）+ **多地址通告**（`announceIps()`：主址 + Tailscale + 明示注入；`'all'` 按**网卡名**挡虚拟口——打分符号当过滤器会漏 `vEthernet (WSL)`）+ `scripts/stun-probe.js` 手写 STUN Binding 读**反射地址**（`XOR-MAPPED-ADDRESS` family 是 1 字节、端口 `^=(cookie>>>16)`，Google 还发老式 **8 字节** 布局）⇒ "这台在不在 NAT 后"第一次变成打印出来的事实（实测：反射地址（公网出口）≠ 通告地址（内网））。`/config.json` 的自检多两行（媒体端口只 UDP ⇒ warn、通告地址只有一个 ⇒ info 并给命令），`doctor` 加 B1b，`start:lan`/`allow-firewall.bat` 按 **UDP+TCP** 放行；两份手册把"装了 TURN 就能跨网"改成 **SFU 媒体不走 TURN** 的三条诚实路线。**④ 界面一处真缺陷（全量回归自己抓的）**：邀请面板高度是内容撑的，自检从 5 条长到 7 条 ⇒ 矮窗口里**最后一行连同可复制的修复命令掉到屏幕外**且没有滚动条；修 = 给浮层**结构性上界**（`max-height: calc(100dvh - 76px)` + 内部滚动），不是把某个数调小（坑 79/114）。**⑤ 一条量具的假红**：`test:asr-live` 红在正向对照，核日志发现它跑在 **whisper 兜底**（不是用户配置的引擎）⇒ 把"等主引擎就位"从 opt-in 改成**默认**，并把"喂音频时引擎到没到"印进失败信息（见 0.8 缺陷 6） | `sfu/public/fileview.js`（**第 10 节 legacy**：CFB/piece table/BIFF8/PPT97/RTF/HTML + 格式码表 `parseNumSection`/`numFmtOf` + 样式编号 `loadDocxStyles`）、`sfu/server.js`（`attachRtcServer`/`mediaListenInfos`/`transportListenOptions`/`ANNOUNCE_*`/两条 metrics/自测默认等预热）、`sfu/nets.js`（`announceIps`/`isVirtualNic`/`diagnose` 两项）、`scripts/{office-oracle.py,legacy-oracle.ps1,stun-probe.js,test-crossnet.js,review-office.js,doctor.js,start-lan.js,test-nets.js,test-turn.js,check-files.js,check-invite.js,test-fileview.js}`、`sfu/public/style.css`（`.fv-legacy-note/.fv-txbx/.fv-math/.fv-merged/.fv-blankrow` + 面板上界）、`sfu/config.example.json`（`rtcServerPort` 与理由）；AGENTS 坑 **130~134**；导读 **LEARN.md 5.57**；路线图 **0.8（J/K 档）+ 0.2 三条人工清单 + L 档**。回归（本批实测）：**`test:fileview` 292/292** · **`check:files` **71/71**（两个真浏览器；带 `REAL_OFFICE_FILE` 那份真文件时 72/72）** · **`test:crossnet` 17/17（新）** · `test:nets` **42/42** · `test:stun` **8/8** · `check:invite` **12/12** · `test:office` 5/5 · `test:review` 47/47 · 冒烟 **521/521**（514 + L7 两条浮层上界红线 + L6 一条"报告器必须接守卫" + 4 条守卫单测）· 信令 **270/270** · asr **222** · watch 54 · store 55 · shutdown 9 · tts 13 · qwen 10(+1skip) · ai 10 · quiet-mic **11/11** · room-actions **21/21** · publish 30 · doctor **25 通过/1 警告/0 失败**（**`check:all` 20/20 条 · 388 项界面断言** · `test:e2e-media` 38 · `test:e2e-asr 25 · `test:e2e-reconnect` 15 · `test:agent` 24 · `test:e2e` 16 · Mesh 36 · `test:asr-live` **PASS**（默认等主引擎 38s ⇒ 定稿 2 条全 `silence`、⏱ 3.1/3.0s、重转采纳 2/2、应答 1 次）· `soak --minutes 8` **PASS**（信令 239 · 断线 0 · 归档 48=48 · 文件对账 8 次不平 0 · 视角 8 发 8 收 · 销毁后目录已删）） |
| 73 | **★ 给"准确率"造一把尺（2026-10-09，M 档）：语音这条线第一次能量出"听对没听对"** ▸ 此前这条线**只有延迟有尺**（`⏱`/`latMs` 拆分/`/metrics` 三读数/blob%），"这句话转得对不对"只有 `bench:asr` 的关键词命中 6/9——而那是下限代理：「评审会」→「庭审会」只要还剩「评审」两个字就算命中。**没有尺的时候任何优化都是掷骰子**：路线图 H3 写着"词级天花板等用户拍板"、H8b 写着"必须先拿真人分布"，两条都卡在同一个缺口。**① `sfu/ai/accuracy.js`**（新，零依赖纯函数）：中文按字、拉丁数字按词切 token；标点空白不参与（转写自带标点，算进去每档虚高）；**数字默认不折算**且口径记在结果里（`diff()` 遇口径不同直接拒比）——量准确率不许借用 `normAsrText` 那套"判意图"的归一化，**那是用尺子的刻度去改被测物**；micro（总编辑距离/总字数）与 macro（逐句均值）**两个数并列**，只报一个就会漂移；空转写判 100%、期望为空判"不可比"、样本 <5 判 `enough:false`。**② `npm run bench:asr-golden`**（新）：跑引擎之前先自证量具（0%/100%/不可比/sub=1 四条），尺坏了立刻退出；TTS 复用 `voice-fixture.js` 唯一一个实现；增益走 `Asr.modelGainDb` ⇒ 量的是**生产真正喂给模型的那份音频**；跳过必须说话（显存不够/没装 whisper/没配 key 都打 SKIP 并计入"未测"）；`--compare=<file>` 出改动前后差值。**首张表（合成场 10 句×2 档）**：`qwen-local(cuda)` **2.8%**（全对 9/10）vs `whisper-small` **4.9%**（5/10）；「负载→附在」是真词错、「十月十号→10月10号」是写法差异（折算口径 4.9%→3.5%，**"人听懂了但字面匹配会踩"第一次被量化**）；far 档读数没变差——但那一档只是整体调小干净语音，**房间噪声与混响没进来 ⇒ 不能外推成"真人坐远会怎样"**（表里自己写明）。**③ 真人场入口 `/golden`**（`sfu/golden.js` + 页面 + `GET/POST /api/golden`，`requireAdmin`）：逐句念 × 两档距离，MediaRecorder → raw body → ffmpeg 转 16k/mono/s16le → jsonl；**句子清单只有一份**（录制页与跑表共用，抄两份就会"录 A 批跑 B 批"不可比）；回包 `peakDb` 出自**生产能量闸同一个 `Asr.measureWavLevel`** ⇒ "这句在会议里会被当静音删"录当场就知道；麦克风三件套（AEC/降噪/AGC）**有意全关**——这页要量真实房间条件，而会议里正相反。**④ 四处"一个概念两个来源"收口 + 一条播报缺陷**：增益算式原来在 server.js 内联两遍 → `Asr.modelGainDb()` 一处 + 触发账 `sfu_ai_asr_gain_applied_total`（分子恒 0 而 `input.voiced` 在涨 = 10-05 那条"安静麦克风的救赎"整条没跑过）；Qwen 模型目录判据原来**只有 server.js 知道**（独立脚本 `boot()` 于是无声返回 false）→ `resolveModelDir()` 三处抄本接回；能量闸阈值 → `asrMinPeakDb()`；**播报按字数拦腰截断**（`sentence.slice(0, room)`）就是用户报的"话说一半然后没声"的真身 → 首句永远整句念、后续放不下就**整句不念** + 语音问答那一路生成时加 `spoken` 形状约束（结论进第一句、≤60 字、不写路径与 markdown；@ai 打字那一轨不传）——**只改切法治不了根，只改 prompt 不保险，两侧一起**。★ 两条当天自己写出来又被自己/回归抓走的错：量具在失败分支里先 `kill()` 再读 `lastError`，把自己糊成"worker 起不来：killed"（坑 138）；重录路径按旧记录 unlink **同名**文件 = 删掉刚转好的那份 ⇒ "重录成功却查无此条"零报错（坑 140，被去重断言当场抓红） | `sfu/ai/accuracy.js`（新）· `sfu/golden.js`（新）· `sfu/public/golden.html`（新）· `scripts/{bench-asr-golden,check-golden}.js`（新）· `sfu/ai/{asr,asr_qwen_local,brain}.js`（`modelGainDb`/`resolveModelDir`/`systemExtra`）· `sfu/server.js`（`asrMinPeakDb`/`COLLAB.gainApplied`/两个 `/api/golden` 端点/`/golden` 短地址/流水线不切半句/`spoken` 传递）· `.gitignore`（`sfu/voice-golden/`）· `sfu/protocol.js`（金标准 HTTP 段）；AGENTS 坑 **138/139/140**；导读 **LEARN.md 5.58**；路线图 **0.9（M 档）+ H3 改口**。回归（本批实测）：**`test:asr` 252/0(+1skip)**（新增 ⑬ 组 30 条）· **`test:sfu` 282/0**（+12：/api/golden 门禁·转码契约·峰值同源·重录去重·路径穿越·0 字节·隔离自证 + gain 触发账锚行首）· 冒烟 **521/521** · **`check:golden` 11/11（新）** · **`check:all` 21/21 条 · 399 项界面断言** · review 47 · nets 42 · watch 54 · store 55 · tts 13 · shutdown 9 · ai-brain 75 · `npm run bench:asr-golden` 出首张 CER 表 |
| 74 | **★ 「登录」终于有了反面（2026-10-09，第 52 步）：退出登录 / 忘记密码 / 管理员的实质区别** ▸ 用户三句抱怨，审计定位到三个**不同的**根因，形状都是"只做了一半"：① 全文件只有 `hideAuth()`——登录后**没有任何路径能回到登录卡**（换不了账号、登不出来，票过期只往折叠的流程日志写一行 = 等于没写）；② 登录态散在**四个落点**（`localStorage.wb_auth` / 模块级昵称 / 头像 / 每小时续期定时器），没有一条统一的撤销路径；③ 服务器侧 `bindIdentity` **只进不出**，而聊天署名与成员 role 都取自服务器 socket ⇒ 客户端退回游客、服务器仍按老身份放行录制与删除 = **两边各说各话且零报错**。修法：`clearAuthState()` 一处清完四个落点 + 身份牌（未登录/成员/房主/平台管理员四档文案，文字只是视图、判据读变量，坑 97）+ **两步确认**的退出（不用阻塞式原生弹窗）+ 服务器 `dropIdentity()` 唯一收口，两个调用点：`auth-logout` 与 **`auth-refresh` 判失败**（配对的半边）。★ **守卫的形状**：传别人的票来退 → **明确拒绝且零副作用**（否则"退出登录"就是"把管理员踢下线"的 DoS 入口）；不带票的退出只退这条连接、**不废票**，带自己的票才作废（作废后连 `auth-verify` 都过不了，否则刷新页面就"自己又回来了"）——这两种语义差写进 `sfu/protocol.js` 与测试名。**忘记密码不许演**：本项目零依赖可离线、**没有邮件/短信通道**，所以那句提示给两条照着就能做的真路（本机 `npm run admin:passwd -- <用户名>` / 找部署那台机器的管理员），并钉一条反向对照：不许出现"已发送 / 请查收"，点它**不发任何信令**。**管理员的实质区别此前只在文档里**（会中权限本来就该相等：踢人/删文件都是 owner-or-admin；admin 真正独占的是 `/dashboard`、`/recordings.html`、`/golden`、`/metrics` 四个端点，别人打开 401）⇒ 修法是**把差别说出来**：一块只对 `role=admin` 出现的治理台，不新造任何特权。口令判据也收口成一处（网页注册 + CLI 两条命令共用 `Password.strengthError`，`/config.json` 下发 `passwordMinLen`，界面那句提示里的数字来自它）。★ 这一批我自己制造并被断言抓走的三次事故都升级成常驻判据：**HTML 注释用 CSS 的收尾序列写完 ⇒ `<!--` 永不闭合，整段界面被吞进注释**（`node --check` 与冒烟一条都不红，红的是真浏览器那条 id 契约；补"id 必须出现在注释之外"+"HTML 注释里不许出现那个序列"两条静态红线）、**模板字符串内部的反引号把注入浏览器的代码截断**（那条检查 0 条断言就跑完；先试全仓静态红线、扫 40+ 文件误伤 17 处 ⇒ 撤下，换成 `scripts/inject-check.js` 一处实现 + 12 个 check 脚本各接一行 + 守卫自己 2 条单测含"不许误伤"反例）、**判据过期**（"真实目录没被创建"在用户录完 20 句真人语音之后变成永真/永假 ⇒ 改问真正要保护的不变量：我这批测试 id 有没有混进真实语料）。教学导读 **LEARN.md 5.59**；实测：冒烟 **558**（+37）· 信令 **298**（+16）· `check:login` **13**（三个次要出口同一行 + 找回提示的真文本双向钉）· `check:theme` **28**（点名掀开这块新浮层 → 扫出深色档 `.account-note` 压在鎏金底上只有 4.03:1 → 按最差的底重定档，两档 0 条不合格）· `check:golden` **12**（顺手把本仓库最后一处"靠固定 sleep 读页面"改成"轮询到它成为断言条件本身"）· 三条新判据各用变异证过可红。**真人金标准也录上了**（20 句 = 10 句 × 两档距离）：真人场 micro CER `qwen-local(cuda)` **near 4.2% / far 5.6%**（各 7/10 全对）vs `whisper-small` **11.9% / 13.3%**（4/10、2/10）⇒ 差距 7.7 个百分点；用户点名的「大木车 / 洗地皮」这一句两档都逐字全对，**但这不等于"词级问题已解决"**（金标准是整句一次转写 + 无房间噪声 + 关 AEC/NS/AGC，他抱怨的那些错出在真实会议链路的 2s 分段里，两边不是同一条件）；这张表真正能拍板的是 **whisper 兜底才是明显差的那一档**，而 qwen-local 的残错形状已变成"数字写法（-56 → 负五十六）与偶发插入" |
| 75 | **★ 一夜把两条"口头结论"结案，并把一类缺陷形状当成搜索工具（2026-10-10，路线图 0.11 六批）** ▸ 这次几乎不加功能面，做的是**让可信度可复核**。**① H2「RMS 按 ~4KB 成块交付」结案**——不是打勾，是装常驻仪表：每代录音进程记首行/最大空档/单次事件字节 + 退出时写一条 `asr-rms-arrival` 事件，`/metrics` 四格、`watch.js` 三条告警、`review:meeting` 一行结论（样本 <3 报 ❔ 不报"没问题"）。真 RTP 实测 **首行 995ms、空档 ≤315ms、单次 ≤959B ⇒ 逐行交付**，那条假设不成立；顺手把 `firstMs`（混着"等人开口"——同一套代码 995ms 与 20230ms 都出现过）拆出 `afterFirstByteMs`，才分得清"管道慢"与"没人说话"。<br>**② H8b「底噪估计排除 −99 纯静音 ⇒ floor 偏高」结案**：新量具 `npm run bench:voice-floor` 用**生产那条 astats 链**把 20 份真人录音变成 0.512s RMS 序列，喂**生产那一个** `createVoiceTracker`（生效参数从 `tracker.params` 读，不抄第二份 −80）⇒ 三档 `silentDb`（−80/−120/−70）的 floor、阈值、命中**一字不差**，**所以一行生产阈值都没动**。同时量到更要紧的一件事：这个人停下来之后**房间并不安静**（尾窗 RMS 中位 −36.8dBFS，而阈值 −54.6）⇒ 那个比例量的是**房间可分性**，不是判据好坏，于是做成 `review:meeting` 的常驻一行。<br>**③ 语音准确率第一次被文本侧买回点数**：新纯函数 `Asr.foldTailEcho`（句尾复读折叠，三条判据同时成立才折 + 两字回声**有意不折**）接进 `cleanTranscript` 唯一入口 + 触发账，真人金标准实测 **far 5.6% → 3.5%**；第二刀（数字写法归一）**用测量取消**（真人账本里"同一句两种写法都有"= 0 对 ⇒ 买不到东西就不写这段代码）。★ 更大的收获是量具自己的口径错：`bench:asr-golden` 之前打的是**模型原样**文本，而落账的是过完清洗的那份 ⇒ **任何文本侧改动在这张表上都是零收益**，"改了没变化"会把人推向"那就换模型"这个错方向。<br>**④ 把「只有正向没有反向」当成一把搜索工具用在全仓**：服务器四处（发言账断开时删自己 / 数据通道订阅真的 `close()`+`delete` / 房间销毁走收口 + 停录制 / 登录票补清扫器）+ 客户端三处（房间作废时销掉待回落朗读账 / 本地黑名单补「解禁」/ 每路音量账加上限并把"换场会还认得"那句**过期声明**改口）+ 清掉一行**全仓库零读者**的 `sfuLastRoom`。修法之前先把条数交出来（`sfu_auth_tokens` + `talkEntries` + `dataConsumerCount`），因为**撤销就是"某个数变小"，而变小必须能被断言**。两条结论**先证伪没动手**（`destroyRoom` 裸删在现存路径下不是活缺陷，但红线照装；`THEME_KEY 写了没人读` 是假阳性）。<br>**⑤ 真实文件回扫扩面**：273 份真实 Office 文件重扫，修完分类后的诚实数字 **内核抛错 0 · 输入坏了 1 · 可疑 0 · 以图为主 11**——原来那栏对所有命中者都写"可能是内核漏了某类容器"，而 11 份里 **10 份是截图作业**；把它证伪的是一次普查（77 份候选里"字全住在 DrawingML"= **0 份**），负结果写进判据注释（**仪表给的原因比它报的数字更贵**）。深嵌套补了夹具（表里套表、再用 `w:sdt` 套第三层）+ 10 条断言，而变异实验给出一条判据：**"两轨逐字一致"在两边一致交白卷时照样绿** ⇒ 一致性 ≠ 正确性。<br>**⑥ 长跑与真浏览器四条全绿**：`test:e2e-asr` **26/26** · `test:voice-longrun` **7/7**（5 分钟 38 条定稿、分布 `{silence:24, split:14}`）· `soak --minutes 8` **PASS**（48 条归档对账一致、断线 0、文件对账不平 0、房间销毁目录已删）· `test:asr-live` **PASS×2**（定稿全部 `silence`、整句重转逐字全对）。延迟红线 ≤3s 按**同场次 A/B** 改到 ≤4s（重转净成本 ≈0.5s；另外那 1s 是 10-07 买尾字「会」花的），而改这条线时抓到**一条注释承诺了、代码没实现**的断言（只比了 `Math.min` ⇒ 看不见"最快值很好、后面一路变慢"），补上 `med ≤6s`。<br>★ 三次"红了先怀疑自己"：`Authorization: '***' + token`（占位符当凭据）骗了我四轮回归，最后靠"红话里打印我发的 token 前缀 + 401 页里那句为什么"一步断掉（**坑 145**）；坑 74 那条"要锚行首"当年只修了测试、**生产那份 `watch.js` 一直未锚定 ⇒ 预热期分诊恒判"引擎已就绪"、告警永不响**（**坑 144**）；`npm run soak` 在端口上没服务器时**不报错、不退出、心跳只留开头一行**（`reconnection` 无限重连 + ack 永远不来），补了"15s 连不上就明确失败"。回归：冒烟 **573** · 信令 **305** · asr **263** · fileview **302** · review 自检 **59** · watch **71** · nets **42** · e2e-asr **26** · longrun **7/7** · soak **PASS**；新坑 **144~147** + 坑 129 第四次应验（Edit 拿相邻整行当锚点，把上一行成果整行替换掉）。 |
| 76 | **★ 定稿延迟买回 1.1 秒 + 仪表在"会议进行中"就有读数（2026-10-10 第二批，路线图 0.12 的 C1+C2）** ▸ **C1**：`asr-rms-arrival` 原先只在录音进程**退出时**写一条 ⇒ 正在开的会读不到，昨晚新装的尺在真实场景里永远是 ❔（"装了仪表"与"读得到样本"是两件事）。现在按代际 `gen` **滚动落账**（只在实质变化时补一条：首行出现 / 空档或单次字节 +≥25% / 底噪或阈值移动 ≥2dB，最快 60s 一条），真链路实测 **8 代里 7 代未散会即有读数**。顺带补掉复盘的一个结构性盲点：**只有事件、没有字幕账本**的房间（正是"这个人为什么没字幕"那种 0 字幕的会）以前**根本不进报告**；现在会列出来，并把"按计数为 0 判好"的五行降成 ❔（没记录≠没发生），而有真事件的两行不许跟着降（把有信息的一起噤声是另一种撒谎）。▸ **C2**：先量价签——静音判据只要 1.2s，实际定稿 2.6~2.7s，多出来的 ~1.4s 全花在**等含尾字的那一段被 ffmpeg 封口**。处方必须两件一起做：**抢跑读过的字节也算进整句音频**（新账本 `uttTake` 记水位 ⇒ 封口段只补余量，不重不漏；切片带上段名、拼接前**按段名排序**——多一个写入方之后"push 顺序 = 时间顺序"这条隐式保证就不成立了）+ 成句闸允许"音频已覆盖到说话结束那一刻"的段放行（纯函数 `Asr.tailCoveredByRush`：把段内字节号换算成时刻，**不是**要求读满一个一直在长的文件）。**同场次 A/B**：关 `3.3s / 3.1s` → 开 `3.3s / 2.0s`（第二句省 1.1s），而**定稿条数 2 / 应答 1 次 / 逐字全对含尾字「会」**三条红线一个没变差才默认开（`ASR_TAIL_RUSH=0` 单独撤这一个变量）。三次被**实测**否掉的写法都留在断言里（AGENTS 坑 148），其中两条是**反向钉**：谁把"整段重读"或"抢跑必须转出字"这两个直觉再实现一遍，`test:asr` ⑮.2/⑮.3/⑮.20 当场红。回归：asr 289 · sfu 307 · 冒烟 573 · review 自检 70 · asr-live PASS×4 |
| 77 | **★ AI 第一次听得懂「刚才那个再关回去」（2026-10-10 第三批，路线图 0.12 的 C3）** ▸ 泛化缺口打到 0% 之后，剩下那一块**不是一个动词，是"最近做了什么"这个状态**：`room.actionStack`（房间级、上限 8 条、随房间销毁）+ 逆操作表 + 三层意图判据（强撤销词 > 重复词 > 光杆关闭词——顺序就是语义，把"重新打开"读成"关掉刚才那个"就是做错方向）。**零新信令**：撤销被解析成同一张白名单里的另一个 action，仍走 `room-control` 广播，客户端一个字没改。不可逆的两条（清空白板 / 撤一笔）**整条不做并给出理由**；栈是空的就明说"人手动点的按钮我看不见"（不装作听得懂一切）。泛化仍按坑 106 的量法：20 句从未进过任何表的说法**首跑只接住 14 句**，逐种形状补上来 → 20/20，其中两条"我自己想错"的语义（一族同时被撤出两个相反方向 / 回话按 indexOf 配错对象）各自升级成常驻断言。★ 顺手抓到一条**从 10-06 就在的空气缺陷**：规则直答的路由（不经 LLM）一个 `ai-stream` 增量都不发，而客户端看到 `done` 就把随后同 `streamId` 的终态当重复丢掉 ⇒ 聊天里只有「🎯 room-action」没有正文；文字其实走了另一条帧（AI 格子的逐字字幕有），所以"它在说话"的观感一直在、台账却是空的——**载荷对 ≠ 用户看得见**。修在**服务端补一次增量**（@ai 与语音两条路都补），**不放开客户端去重**（放开就会让流式答案重新出现两条气泡，那是 10-04 修过的老账）。回归：asr 312 · sfu 308 · 冒烟 575 · review 自检 73 · **room-actions 真浏览器 31 项 / 0 失败**；两次变异证过可红后逐字还原 |
| 78 | **★ 给"工具本身"装一台仪表，并把两条口头结论用真调用结案（2026-10-10 第四批，路线图 0.12 的 C4~C6）** ▸ 这三批**一行生产代码都没改**，做的是让可信度可复核。**C4 `npm run test:scripts`**：五层判据（每条 npm 命令指向的文件存在 / python 同理 / **孤儿脚本**——没被 npm 引用、没被 require、没进清单文档 ⇒ 报，就是 `test:tts` 红了三个月那一类的机器判据 / 头部写着"跑完即删"却没删的临时文件 / 代码里 `path.join(__dirname,'x.py')` 指到的文件必须存在）+ 一层观察（多久没人改过它，由 `git log` 给，不由记忆给）。**第一次真跑就逮到两个写着"跑完即删"留了三天的文件，其中一个会重写 `index.html`**——两者都不在 git 里，删掉就再也复核不了结论 ⇒ 挪进 `backup/one-off-20261010/` 并写明"为什么是归档不是删除"。<br>**C5 真文件回扫按类别覆盖**（新 `scripts/office-shapes.js` = 九类**形状**的唯一来源，`review:office` 与 `check:files` 的 `REAL_OFFICE_DIR` 共用一份判据）：分类只看字节（magic + ZIP 成员名 + styles.xml 的格式码，**不读正文**）；**候选上限（`--probe`）与渲染上限（`--max`）必须分开**——上一版拿 --max 当候选上限，"看了 8 份没认出 .xls"会被读成"这台机器上没有 .xls"；缺的类别用仓库夹具顶一份并**标明是谁写的**（"真 Office 生成"与"我写的"是两种强度的证据）；连夹具都缺 ⇒ `❔ SKIP` **且退出码 1**。本机九类里只有 4 类有真文件（.doc×12 / .xls×2 / RTF×1 / xlsx 百分比货币×4）。<br>★ **新的取样方式第一次把 pptx 推进真浏览器就红出一条判据缺陷**：`chars > 40` 那条"有没有内容"，而那份两页 PPT 的非空白字数正好 **39**——轮询 90 秒读不到内容，看起来完全像"浏览器里 pptx 渲染挂了"，实际 0.1 秒就画好了 1355 字节。修法不是把 40 调小（那还是猜一个数），是**问界面自己**（`.fv-doc/.fv-slide/table/img/pdf 框架` 且不在转圈 = 有内容；`.fv-unsupported` = 明确说不行）；顺带掉出第二条：同一判据的**另一份副本少写一个反斜杠**，模板串里 `/\s+/` 退化成"剥掉字母 s" ⇒ 那份字数一直虚高、结构上不可能报白屏。**两份副本一份太严（假红）一份太松（假绿），各自都曾经绿过**——现在收成一处 `STAGE_FN` 给轮询与取证共用。<br>**C6 H1b「边说边出字」结案**（`npm run bench:asr-stream`，只出结论不改生产）：三个流式方法**都在**，第一次真调用拿到 `ValueError: Streaming ASR is supported only for vLLM backend`（本机 backend=transformers、vLLM 没装：pip 查无、import 不到）⇒ **按原样做不了**，不是"还没优化"。替代形状是前缀重解码（官方实现自己也"每凑满一块就把听过的音频整段重喂"，**没有 KV 复用**）：跑两遍、n=6 句真人 near 档、本机 0.6B/CUDA ⇒ 首字出现在**句中 ~1.0s**（它与现路径唯一的真差别），代价 **≈2.9~3.0× 算力 + 字幕整行重写中位 3 次/句**，而**终稿时点一点没提前**、末步与终稿差异中位 1 ⇒ 这一档改口成"要不要句中出字"的**产品取舍**（等用户点头，不替他拍）。<br>判据被真跑退回来三次，都升级成常驻防守：只认「一次性」三个字 → 误伤三句正常描述（改认"那句删掉的承诺"）；判据读到自己文件头那句承诺 → 登记成命令的常驻工具豁免、名字像草稿的不豁免；第⑤层读到自检夹具里的假路径 → **声明式豁免 + 反向对照 + `localRefs` 覆盖面计数**（"0 问题"与"0 条被检查"在报告里长一样）。回归：scripts 自检 17/17、真跑 90 scripts / 80 文件 / 51 条本地引用 ⇒ 0 问题 · 冒烟 **576** · asr **312** · sfu **308** · fileview **302** · office 自检 **43** · review **73** · files **59** · nets **42** · watch **71** · store 55 · shutdown 9 · tts 13 · ai 10 · ai-brain 75 · qwen 10(+1skip) · publish 30 · stun 8 · Mesh **36**（`PORT=3100`：3000 被本机另一应用占着，**没去动它**）· `check:files` **73**（9 份 = 4 真 + 5 夹具、白屏 0）· record PASS · turn PASS · doctor **25/1/0**；新坑 **152 / 153 / 154** |


| 79 | **★ 定稿延迟从一个数拆成六格账（2026-10-10 第五批，路线图 0.12 的 D1）** ▸ 以前报告只有一个「中位 2.6s」，"慢在等静音判定""慢在封口""慢在排队""慢在模型""慢在整句重转""慢在成句闸"六种病**长得一模一样而处方互相冲突**。现在 `stage` 里六格分别记账并一路送到三个地方：字幕账本、`review:meeting` 的构成行、字幕条悬浮提示与值守日报。**第一次真跑就报出此前没人认领的 0.4~1.4 秒「等成句闸」**（文字早到齐了，成句闸要等下一轮轮询与 `segInFlight/tailHold` 两道守卫）⇒ 下一刀该砍哪里第一次由数据指定，而不是猜。▸ 三条判据形状：① **不重不漏**由"六块之和 == `latMs`"钉死（自洽时间线自检 + 报告侧的对账告警，和与总延迟差 >25% 就明说"有新的等待来源"）；② **量到 0 ≠ 没量到**——封口段比静音判定先到时那一格是货真价实的 0（= 抢跑生效），值域因此改成"负数排除、0 计入"并显示在界面上；③ **同一份"缺这一格"有两种病因且处方相反**（旧服务器 vs 这一句没走到），所以写进账本的是能力版本 `stage.v=2`，报告读版本而不是猜字段。▸ 同一批包含一次**我自己造成的事故**：Python 的写句柄先截断文件、再去读一个 Windows 侧看不见的 `/tmp` 备份 ⇒ `AGENTS.md` 被写成 0 字节；靠 `git show HEAD` + 会话记录按内容签名恢复，教训升级成两条常驻纪律（坑 156）。实测 `lat=4061 = wait 19 + trans 2939 + refine 704 + gate 398`（和差 1ms）；`test:review` 89、`test:smoke` 579、`test:asr` 312、`test:sfu` 308、`test:asr-live` PASS |


| 80 | **★ 播报漏斗变成会自己喊的哨兵（2026-10-10 第六批，路线图 0.12 的 D2）** ▸ "它答应了却不说话"这个症状在 09-25~10-06 之间以四种化身出现过（坑 66 / 66② / 94 / 0.11），形状都一样：服务器声明 `tts:'server'` → 前端让位不念 → 音频没来、连"我发不出去"的道歉也没来，而日志一片干净。10-06 修好回落之后，`test:asr-live` 里有那条红线——**但红线只在自测跑的那一次生效**，真实会议里再来一条路径漏收口没人会知道。现在服务器给每一轮承诺挂一本账（`declared / delivered / failed / silent`），到点没下文就**自己补发那条道歉把声音救回来**，同时计数进 `/metrics` 与 `/api/rooms`，值守 `watch` 新增规则⑧：`silent` 一涨就喊人（但第一观测只记基线，重启带着历史值不算"刚刚发生"）。自测里加了一条**恒等式** `承诺 = 送达 + 道歉 + 无下文 + 还在跑`——它比"看有没有音频"多挡住一种病：新加的播报口压根没记账，那种情况下账"平"得看不出来。▸ 顺手记一次我自己造的假红（坑 158）：为了让哨兵快点响，我把生产常量 `SPEAK_SETTLE_MS` 全局调成 2500ms，于是一次完全正常的合成（真实一轮 3~8s）被判成"无下文"。修法不是把数调回去，而是**把时长变成按调用的参数**——量具要传参覆盖，不许改写被测对象的默认值。实测：`test:watch` 78/78、`test:review` 95/95、`test:sfu` 310/310、`test:asr-live` PASS（`承诺 1 · 送达 1 · 无下文 0 · 还在跑 0`） |

**下一步方向**（`后续升级方向.md` 是唯一权威）：
- ✅ **A 档（A1~A7）与 D 档（D1~D6）已全部完成**（2026-09-11，SFU 主版本）；
- ✅ **F 档前三刀（F1 双布局 / F2 网络点 / F3 预览页）已完成**（2026-09-12，SFU 主版本，
  参考声网形态、零 SDK 自研）；
- ✅ **D+1（SFU 数据通道）已完成**（2026-09-12，SFU 主版本：聊天改 SCTP 主路 + 信令兜底双路径，
  回归 50/50，导读 LEARN.md 5.10）；
- ✅ **工作台桌面化升级已完成**（2026-09-12，两版同步：伪桌面演示页 + 被控端点击涟漪，
  冒烟 39/39，顺带修掉冒烟测试 vm 跨 realm 与"重放被静默跳过"两个老坑）；
- 🔶 **D+ 档（SFU 更深一层）**：**D+1 数据通道 ✅（09-12）→ D+2 服务器侧录制 ✅（09-15，端到端自测通过）
  → D+3 带宽估计与 VP9 SVC ✅（09-14c）→ D+4 房间 TTL 与房主迁移 ✅（09-14c）——四块全清**；
- ✅ **F 档 F4~F7 已全部完成**（表情飞屏/举手 09-13 → 批注 09-14 → 白板 09-15c → 滤镜/虚拟背景 09-17，SFU 主版本）；
- ✅ **E 档已落地四项**：E1 TURN（openrelay 预置 + coturn 自建包）/ E2 HTTPS 自签一键部署（start:lan）/
  E4 压力基准数字（bench 三档）/ E5 演示包（start:demo + 5 分钟讲稿）；**只剩 E3 浏览器端 e2e 未做**
  （现有零依赖冒烟 136 项 + `test:e2e` 15 项是可选的"零依赖版"，Playwright 属新依赖需拍板）；
- 🔶 **C 档（与 AI 线汇合）**：**L1 实时字幕 ✅（09-17b）→ AI Bot 参会者 ✅（09-19b）→ N2 纪要 ✅（09-19c 骨架）
  → C1 AI 远程操作员 ✅（09-19g）→ 09-24 接通真 DeepSeek**：统一 provider + 流式打字机 + 📝 纪要入口 +
  教学三件套脚本 + `test:ai` 双轨自检 10/10（详见 `后续升级方向.md` 第 1 节），**主攻两条线全线贯通**；
- ✅ **09-24 顺手修掉三个真 bug**（跨机可用性 / 录制自测 / AI 动作错位，见 `AGENTS.md` 坑 36~38）；
- ✅ **09-24b B 档「真 OS 级远程桌面」落地**（原"毕设才开、违背零依赖需拍板"，本次以零新依赖达成）：
  本地代理 `agent/`（手写 CDP 客户端驱动真实 Chromium）+ 手机控电脑（Pointer Events）+ 一键发布
  `npm run publish:mesh` + Mesh 版跨网 ICE 下发 + Service Worker 缓存纪律（坑 40）——详见
  `LEARN.md` 5.29~5.32 与 `AGENTS.md` 09-24b 条目；
- 🔜 **G 档 · 下一步新方向（2026-09-17 公布）**：云部署与多机 SFU 级联 / AI 会议助理落地 / 录制产物回放 /
  PWA 移动端 / 端到端自动化 / 安全加固 / 可观测性升级 / 规模与性能——8 个候选方向（含做法、难度、
  依赖代价与"零新依赖"铁律的冲突点）见 `后续升级方向.md` **G 档**；
- 跨机联调实操见 `EVOLUTTON.md` 第 6 节。

> ⚠️ **人工验证提醒**：本次升级的**真实音视频效果**（simulcast/SVC 三档协商、说话人高亮、
> 浏览器侧 D5 录制产物、服务器侧 D+2 录制回放、触屏手势、剪贴板权限、滤镜与绿幕抠像、
> 实时字幕识别、跨机 HTTPS/TURN）命令行验不了，请开浏览器按 `后续升级方向.md` 第 0.2 节清单逐条确认。
> 09-24b 三条新功能另有待人工验证项：**真机手机端参与会议的真实观感**、**cloudflared 真实开隧道**
> （本机未装，`--tunnel` 只验证了"探测 + 给指引"）、**跨运营商真机跨网通话**——同样记在 0.2 清单。

---

## 📚 参考资料

- `LEARN.md`：本项目的中文教学主线（JS → WebRTC → Mesh → SFU），阅读顺序以它为准
- 知识来源：WebRTC 学习路线 PDF（讲解顺序按其章节安排；文件未随仓库保存，需时自行放入根目录）
- MDN：`https://developer.mozilla.org/zh-CN/docs/Web/API/RTCPeerConnection`
- 调试：Chrome 地址栏 `chrome://webrtc-internals` 看真实 SDP / ICE / 统计
