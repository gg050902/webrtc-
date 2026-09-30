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
| 跨网络（不同 WiFi） | 需 TURN：配置已预置 openrelay（含 TCP 回退），先实测可达性 | `npm run test:turn` |
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
| 👤 登录/注册 | 用户名+密码注册登录（游客可进）；昵称贯通成员列表与聊天气泡，登录态自动恢复 | node:sqlite 账号库 `sfu/data/meeting.db` + 内置 scrypt 哈希（零依赖；09-24 由旧 users.json 自动迁移、原样保留 salt/hash）+ auth-register/login/verify 三信令 + token 存档（09-16，SFU 主版本；09-24 换存储） |
| 🛡️ 管理员门禁 · 观测类（09-24） | **甲类·观测**接口只对 admin 开放：`/api/rooms`（房间×成员×媒体字节×控制权全景）、`/metrics`（Prometheus 文本版）、`/api/recordings`（全服务器录像清单，跨房枚举）；带 token 两种方式——`Authorization: Bearer <token>`（脚本首选）/ `?token=<token>`（浏览器地址栏、`<video src>` 兜底，代价是 token 进 URL 历史与访问日志）；`/dashboard` 页面本身不设门禁（否则页面都打不开、没法提示去登录），它调的 `/api/rooms` 才受门禁 | 首个注册账号（或 `config.json` 的 adminUsername）自动成为 admin；token 里带 role；`scripts/watch.js`/`doctor.js`/`soak.js` 支持 `ADMIN_TOKEN` 环境变量（09-24，SFU 主版本） |
| 🔐 内容类接口 · 房间内令牌 + 录像签名 URL（09-24） | **乙类·内容**不再靠"能力 = 房间号"裸奔：进房成功时给**本人**签发一张**无状态 HMAC 房间令牌**（`base64url(JSON{room,iat,exp}) + "." + base64url(hmacSHA256(payloadB64, SECRET))`），`/api/captions`（字幕归档 POST/GET）、`/api/minutes` + `/minutes/<6位房号>/<文件名>.md`（纪要列表与正文）校验它（`X-Room-Token` 头首选 / `?roomToken=` 兜底）；`/recordings/<文件名>`（单个录像）改用 **admin 或短时效签名 URL**（`signRecordingUrl`，默认 1 小时）。令牌发给**本人**、存在 **socket 上**（非成员对象）、成员列表是**显式投影**，故绝不会广播他人令牌；**游客也有令牌**（否则游客字幕归档会静默失效） | SECRET 持久化在 `sfu/data/room-secret`（已 gitignore），首次运行自动生成；TTL 默认 **86400s/24h**（`roomTokenTtlSec` / `ROOM_TOKEN_TTL_SEC`）；逃逸开关 `roomTokenRequired`（默认 `true`，设 `false` 退回旧"开放"行为，供教学对比）；诚实边界：仍是 **Bearer 语义**（不绑成员/IP）、与录像签名**共用同一把 SECRET**、Windows 上 `chmod 600` 不生效（靠目录 ACL）（09-24，SFU 主版本） |
| 🗄️ 账号存储 · node:sqlite（09-24） | 账号从 JSON 文件换成 **Node 内置 `node:sqlite`**（**零新依赖**）：库文件优先级 `DB_FILE` 环境变量 > `config.json` 的 `dbFile` > 默认 `sfu/data/meeting.db`；开启 **WAL**（读不挡写、写不挡读）；两张表 users / audit + `idx_audit_ts` 索引；**旧 `users.json` 首次启动自动整表迁移**（原样保留 salt/hash、**绝不重新哈希**），旧文件改名 `users.json.imported-<日期>` 保留不删 | 口令方案抽成单一实现 `sfu/password.js`（scrypt + 每账号 16 字节随机盐 + `timingSafeEqual`），服务器与 CLI **require 同一份**——用结构消除"两处照抄、参数漂移导致 CLI 建的账号登不上"的隐患（09-24，SFU 主版本） |
| 🛑 优雅退出（09-24） | `SIGINT`/`SIGTERM`/`uncaughtException` → 关所有 mediasoup Worker → 停收新连接 → `closeDb()` 做 WAL checkpoint → 退出；**幂等**（连按两次 Ctrl+C 第二次直接退）+ **5 秒保险丝**兜底。此前完全没注册信号处理器，Ctrl+C = 进程暴毙（Worker 变孤儿占 RTC 端口、WAL 堆积、正在录制的 ffmpeg 被硬切） | `shuttingDown` 标志顺带修掉"正常退出却被当成 Worker 崩溃"的日志噪声；自测钩子 `TEST_SHUTDOWN_AFTER_MS`（Windows 上投递不了 SIGTERM，靠它自动化验证）（`npm run test:shutdown` ★ 9/9，09-24，SFU 主版本） |
| 🔐 自签证书 SAN 自愈（09-24） | 浏览器早已不看 CN（RFC 6125），自签证书必须带 **SAN**，否则手机常连"继续访问"都不给；且 DHCP 换 IP 后"只判有没有 SAN"永远不重签——现改为**证书缺失 / 无 SAN / SAN 未覆盖当前局域网 IP 三种都重新生成**，SAN 写入所有检测到的本机 IPv4 并保留旧证书已有 IP | 实测 `DNS:localhost, IP:127.0.0.1, IP:192.168.74.194, IP:192.168.116.194`（10 年期自签，`sfu/tls/`）；顺带修正漂移的 `announcedIp`（09-24，SFU 主版本） |
| 🖌️ 协作白板（F7） | 全场共享一块白板：5 色深笔/撤销/清空，笔迹按人配色、实时同步 | 第三条 'board' SCTP 频道（与聊天/批注并存）+ 归一化事件溯源重放（09-15，SFU 主版本） |
| ✏️ 协作批注（F5） | 共享屏幕上所有人可画笔迹（5 色/撤销/清空），笔迹按人配色、全房实时同步，共享者同步可见 | **独立 `annot` SCTP 数据频道**（与聊天频道并存互不挤占）+ `to` 定向头过滤 + 归一化坐标事件溯源重放（09-14，SFU 主版本） |
| 📶 带宽估计 / 消息路径 | 「🔗 连接方式」徽标悬浮显示"可用带宽估计 ≈ X Mbps"（transport-cc）；聊天气泡 🛰️ = 走了数据通道路 | `getStats` 的 selected candidate-pair + appendChat 路径徽标（09-14，D+3 前置可视化） |
| 🌐 可达性（跨机/跨网部署） | 局域网/公网部署三件事一份配置解决：监听 IP、HTTPS/wss 自签、ICE(STUN/TURN) 下发；页面顶部「🔗 连接方式」徽标实时显示直连/穿墙/中继 | `sfu/config.json`（可选）+ 自动 HTTPS + `/config.json` 下发 ICE（09-13，对应路线图 E1/E2 自助版） |
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
| 🚀 一键发布公网链接 | 一条命令把 Mesh 版打成"别人点开就能进"的发布包：生成 → 体检 → 可选开隧道拿公网地址 | `scripts/publish.js`（`npm run publish:mesh`）：白名单拷贝 + **每次清空重建（副本永不漂移）** + 真起一次验证 `/config.json` 下发 TURN + `--tunnel`/`--bundle`/`--check`（09-24） |
| 🧊 跨网 ICE 下发（Mesh） | Mesh 版"跨网连不上"的根因是 ICE 打洞：把 ICE 从代码挪进 `mesh.config.json`，由服务器 `/config.json` 下发 | 根 `server.js` 加 `/config.json` 路由（带 `no-store`）+ 启动 ICE 自检；根 `public/client.js` 加 `ICE_SERVERS`/`iceReady`，建 peer 前一律 `await iceReady`（09-24） |
| 📴 Service Worker 缓存纪律 | 修掉"改了代码刷新不生效"：会变的资源（client.js/style.css/页面）改 **network-first**，不变的 vendor 才 cache-first；加 `?nosw=1` 逃生舱 | `sfu/public/sw.js` 按资源性质分两路 + 缓存名 `meeting-v1 → v2`；根因"SW 不看 HTTP 缓存头"（09-24） |

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
| `agent/index.js`（约 430 行） | 被控端代理主体：连 socket.io 信令 → `agent-hello` 进房 → 收到授权后推画面帧 + 执行输入指令 | 零新依赖（复用根目录 `node_modules` 里的 socket.io-client）；命令行 `--room --server --password --name --url --port --profile --quality --fps --minutes --auto-allow --headless` |

```bash
npm run agent                              # = node agent/index.js
node agent/index.js --room 123456          # 连本机 3001；被控机终端会弹确认，按 y 才放行
node agent/index.js --room 123456 --auto-allow   # 演示用自动放行（有风险，文档已写明）
```

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
> 自动化回归：`npm run test:agent`（16/16）、`npm run test:e2e`（端到端 15 项全过，出截图）。

---

## 🖥️ 前端 vs 后端（谁跑在哪、各干什么）—— 面试必答

这个项目只有"两个进程"：**浏览器里的页面 = 前端**，**Node.js 服务器 = 后端**。它们通过
Socket.IO 收发"信令消息"，媒体在 SFU 版由服务器转发、在 Mesh 版由浏览器直连。

| | 前端（浏览器） | 后端（Node.js 服务器） |
|---|---|---|
| **跑在哪** | 每位参会者自己的浏览器标签页里 | 一台常驻的电脑/云服务器（你本机即可演示） |
| **代码位置（SFU 主版本）** | `sfu/public/`：`index.html` + `style.css` + `client.js`（**第 1~33 步**，28 = 滤镜，29 = 实时字幕，30 = 过夜值守，31 = 值守日报，32 = 移动端/PWA，33 = 安全上下文提示）+ `dashboard.html`（观测面板）+ `vendor/` | `sfu/server.js`（分区 A~E）+ `store.js` + `password.js` + `protocol.js` + `config.json`（可选配置） |
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
| 跨家庭/公司网络（穿 NAT） | `iceServers` 里配 TURN | STUN 只能打洞，对称 NAT 必须中继；ICE 配置经 `/config.json` 下发。**两个选择**：① 开箱即用——`config.example.json` 已预置 openrelay 免费 TURN；② 自建——`deploy/coturn/`（docker-compose + 配置，一条命令起自己的 TURN） |
| 云服务器部署 | 上面的组合 + 防火墙放行 `port`(TCP) 与 `rtcMinPort~rtcMaxPort`(UDP) | 信令走 TCP，媒体走 UDP 端口段 |

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
- **口令单一实现** `sfu/password.js`：`scrypt(password, salt, 32) → hex`，盐 16 字节随机、hex 存库，校验用 `crypto.timingSafeEqual`；服务器与 `scripts/admin.js` **require 同一份**——原先两边"照抄"，任一处参数漂移都会导致 CLI 建的账号在网页上永远登不上。

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
│   ├── test-sfu-signaling.js  # SFU 信令回归（npm run test:sfu，需先起 3001）★ 149/149
│   ├── test-sfu-client-smoke.js # SFU 前端无头冒烟（npm run test:smoke，零依赖不用起服务器）★ 136/136
│   ├── test-store.js       # ★ 09-24 账号存储层回归（node:sqlite：迁移/改密/删号安全闸）★ 49/49
│   ├── test-shutdown.js    # ★ 09-24 优雅退出回归（关 Worker/关库 checkpoint/幂等/5s 保险丝）★ 9/9
│   ├── admin.js            # ★ 09-24 管理员 CLI（list/grant/revoke/adduser/passwd/purge，薄封装 store）
│   ├── test-turn.js        # ICE 可达性实测（手搓 STUN Binding / TCP 探测）
│   ├── bench.js            # E4 压力基准（4/8/16 路媒体转发实测）
│   ├── start-demo.js       # 一键起两版并打印地址
│   ├── start-lan.js        # 局域网交付（生成 sfu/config.json + HTTPS 入口）
│   ├── publish.js          # ★ 09-24 一键发布公网链接（生成 publish-mesh/ → 体检 → 可选隧道；--tunnel/--bundle/--check）
│   ├── test-agent.js       # ★ 09-24 桌面代理端到端（真浏览器/真画面/真注入）★ 16/16
│   ├── test-e2e-remote-desktop.js # ★ 09-24 真机远程桌面 e2e（真双窗 + 手机视口，出截图）
│   └── test-publish.js     # ★ 09-24 发布链回归（含 --check 过期闸）★ 30/30
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
    ├── config.example.json #   配置模板（端口/人数/监听 IP/announcedIp/ICE/HTTPS/roomTtlSec/videoSvc/dbFile/adminUsername/roomTokenRequired/roomTokenTtlSec）
    ├── config.json         #   实际配置（可缺省；start:lan 会自动生成；含 lanUrl 供邀请链接改写）
    ├── store.js            #   账号/审计存储层（node:sqlite，零新依赖；WAL + 旧 users.json 自动迁移）
    ├── password.js         #   口令方案唯一实现（scrypt + 随机盐 + timingSafeEqual；服务器与 CLI 共用）
    ├── data/meeting.db     #   账号数据库（运行时生成；旧 users.json 首次启动自动迁入并改名备份）
    ├── users.json          #   【历史】旧账号文件；迁移后改名为 users.json.imported-<日期>（保留不删）
    ├── recordings/         #   D+2 服务器侧录制产物（webm/mkv，经 /recordings/<file> 下载）
    ├── tls/                #   HTTPS 自签证书（https.enabled 时自动生成）
    └── public/             #   前端：几乎同 Mesh 版，多了 mediasoup-client
        ├── index.html / style.css / client.js（**第 1~33 步**）
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
npm run test:sfu   # SFU 主版本信令：需先起 3001（AI 操作员断言要 AI_OP_STEP_MS=20 node sfu/server.js）★ 2026-09-24 实测 149/149（含门禁边界 + 房间令牌断言：该拦的拦、该放的放、跨房/篡改/过期一律 401）
npm run test:store # 账号存储层 node:sqlite：迁移保留 salt/hash、改密、删号安全闸、完整性 ★ 2026-09-24 实测 49/49
npm run test:shutdown # 优雅退出：关 Worker / 关库 checkpoint / 幂等 / 5s 保险丝 ★ 2026-09-24 实测 9/9
npm test           # Mesh 对照版信令：需先 npm start（连 localhost:3000）★ 2026-09-24 实测 36/36
npm run test:smoke # SFU 前端无头冒烟（零依赖，不用起服务器）★ 2026-09-24 实测 136/136
npm run test:ai    # AI 双轨自检：无 key 只跑 Mock 轨并提示怎么配；有 key 两条都跑 ★ 10/10
npm run test:asr   # ★ 服务端语音识别自测（探测必须成功/系统 TTS 真语音转写/唤醒与追问窗口/在线 asrEnabled/配置模板可解析）★ 2026-09-28 实测 15/15
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
npm run agent        # ★ 启动被控端桌面代理（需 --room 123456；真机远程桌面的"被控端"）
npm run test:agent   # 桌面代理端到端（真起 Chromium：验抓屏 JPEG + 坐标注入 + 远程导航）★ 16/16
npm run test:e2e     # 真机远程桌面 e2e（真双窗 + 模拟手机双指滚动/单指点击，出截图）★ 2026-09-24 实测 15/15
npm run admin:list   # 管理员 CLI：看库里有哪些账号 / 谁是 admin（另有 grant/revoke/passwd/adduser/purge）
```

> ✅ **合计 440 项断言全绿**（2026-09-24 实测）：SFU 信令 149 + 存储层 49 + 优雅退出 9 + 冒烟 136 +
> Mesh 36 + 桌面代理 16 + 发布链 30 + 真浏览器 e2e 15 = **440**。
>
> ★ **2026-09-28 增量（服务端 ASR 成为唯一识别路径）**：SFU 信令 **154/154**、
> 前端冒烟 **168/168**（+9 服务端字幕模式断言）、**`npm run test:asr` 15/15**（新增）；
> `npm run doctor` 的 whisper 项由"未检测到"变为 ✅ 可用。事件与取舍见 `LEARN.md` 5.30。
>
> ★ **2026-09-29 增量（G6-② 房间权限分级）**：SFU 信令 **160/160**（+6 四级角色断言）、
> 前端冒烟 **168/168**、**`npm run test:asr` 15/15**（带真服务器复测）。详见 `AGENTS.md` 09-29 条目。

- SFU 版测试（**2026-09-24 实测：149 通过 / 0 失败**；冒烟 **136/136**）：房间/密码复用 + mediasoup Router 能力 +
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
- **桌面代理端到端 `npm run test:agent`（2026-09-24 实测：16 通过 / 0 失败）**：
  真起 Chromium + 真跑服务器 + 真授权 + 真收 JPEG 帧 + 真注入 16 字节控制帧再回页面读坐标。
  最严的一条是坐标：发归一化 (0.5, 0.5)，页面 `clientX` 必须**正好**等于视口宽一半（±3px）——
  实测视口 1254×707，期望 (627,297) = 实际 (627,297)，跨分辨率都点得准。
- **真机远程桌面 e2e `npm run test:e2e`（2026-09-24 实测：15 项全过）**：
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
| 39 | **真 OS 级远程桌面 + 跨网一键发布 + SW 缓存纪律（09-24b）** | **B 档落地**：本地代理 `agent/`（零新依赖手写 **CDP** 客户端，`Page.startScreencast` 抓真屏 + `Input.*` 注入真输入）驱动真实 Chromium 窗口，控制端在网页里操作被控电脑真实浏览器；新信令 `agent-hello`/`remote-frame`/`remote-meta` + 复用 `remote-input`，三道闸门（身份/授权/体量，"信任≠免检查"）；**📱 手机控电脑**——控制台 canvas 全用 **Pointer Events**（单指=鼠标、双指=滚轮、中文整段 insertText）；**跨网 ICE 下发**（Mesh 版 `mesh.config.json` + `/config.json`）；**一键发布** `npm run publish:mesh`（生成 publish-mesh/ → 真起一次体检 → 可选 cloudflared/ngrok 隧道；`--check` 过期闸）；**坑 40**：Service Worker 缓存旧代码（cache-first 绕过 HTTP `no-store`，改业务代码 sw.js 不动就一直吃旧缓存 → 按资源性质分 cache-first/network-first + `?nosw=1` 逃生舱 + e2e 每次清 profile）；回归 `test:agent` 16/16、`test:e2e` 15 项全过、`test:publish` 29/29 |
| 40 | **账号上真数据库 + 门禁边界修正 + 房间令牌 + 优雅退出（09-24）** | **存储层**：新增 `sfu/store.js`，用 Node 内置 `node:sqlite`（零新依赖）替换 JSON 文件——WAL 模式、users/audit 两表、旧 `users.json` **自动迁移（原样保留 salt/hash、绝不重新哈希）** + 旧文件改名备份；**口令单一实现** `sfu/password.js`（scrypt + 随机盐 + timingSafeEqual，服务器与 CLI 共用，消除"照抄漂移"）；**管理员 CLI** `scripts/admin.js`（list/grant/revoke/adduser/passwd/purge，purge 默认干跑、deleteUser 拒绝删唯一 admin）；**门禁边界修正**：观测类（`/api/rooms`/`/metrics`/`/api/recordings`）加 admin 门禁；**内容类加房间内令牌**——进房成功时给**本人**签发**无状态 HMAC 房间令牌**（`/api/captions`、`/api/minutes`、`/minutes/<房号>/<文件>.md` 校验，`X-Room-Token` 头首选 / `?roomToken=` 兜底），`/recordings/<文件名>` 改用 **admin 或短时效签名 URL**（默认 1 小时），关闭"6 位房号可枚举"的弱能力缺口（令牌确保**游客也有**，否则游客字幕归档会静默失效）；**优雅退出**（SIGINT/SIGTERM→关 Worker→关库 checkpoint→退出，幂等 + 5s 保险丝，`TEST_SHUTDOWN_AFTER_MS` 自测钩子）；**证书 SAN 自愈**（缺失/无 SAN/未覆盖当前 IP 都重生成，修手机连不上）；**测试隔离**（账号测试一律 `DB_FILE` 指临时目录，硬断言不碰真实库）+ 修 `test:sfu` 默认带 token 掩盖游客视角的回归；回归：SFU 信令 **149/149**（含房间令牌 15 项）、存储 **49/49**、优雅退出 **9/9**、冒烟 **136/136**、Mesh **36/36**、代理 **16/16**、发布 **30/30**、e2e **15/15** = **合计 440 全绿** |

| 41 | **★ AI 智能内核：从「关键词模板」到「真智能」（09-24e，本轮重点）** | 新文件 `sfu/ai/brain.js`（零依赖、可单测）：**① BM25 检索（RAG）**——中文 **bigram 分词** + IDF/TF饱和/长度归一 + 时间衰减 + 说话人加成 + 证据块字符预算，修掉"只喂 `slice(-8)` 最近 8 条字幕 → **长会早期信息问不出来**"的硬伤（实测 29 条含 25 条闲聊，仍答出被隔开的关键信息）；**② 多轮会话记忆**（环形上限 + 截断 + **指代时把上一轮问题一起检索**做廉价指代消解，"那他什么时候交"→ 答出"周五之前提交"）；**③ LLM 意图分类**替代正则（修掉"帮我整理下今天聊了啥"→ **纪要根本没生成**却回"好的我来整理"的能力错位；动作型高置信短路省钱、未知标签 fail-safe 落回规则）；**④ 行动项结构化** `{owner,task,due}`（LLM 理解指代与去重；规则轨**宁可留空不可编造**→ 标"待认领"；**内容交 LLM、格式交代码**，两轨格式一致）；**⑤ 操作员 ReAct 闭环**（每步收集服务端可确定的三类观测：转发门禁结果/控制权/执行轨迹 → 喂回 LLM 判断达成与修正，≤4 轮；**结论三档措辞**，出现过输入丢弃就报"⚠️ 可能未完全生效"，不再无条件报成功）；**⑥ 证据链 UI**（气泡摊开 `📚 检索 N 条取 M 条 · 💬 第 K 轮 · 🎯 意图`，流式与非流式都带）。**本轮实修 4 个真缺陷**（AGENTS 坑 41~44）：`RoomBrain` 漏 `memory.push`（记忆整体失效）、行动项正则贪婪（`压测报告我负责`→`压测报告我`）、**基于不存在的 `remote-input-ack` 写闭环**（grep 证伪后改用转发在线状态）、验证脚本消息竞态。回归：`test:ai-brain` **30/30**、`verify:ai` 真端到端 **6/6**、`test:ai` **10/10**、`test:sfu` **149/149**、`test:smoke` **136/136**、`test:store` 49/49、`test:shutdown` 9/9、`test:agent` 16/16、`test:e2e` 15/15 |
| 42 | **★ AI 参会升级：从「被问才答」到「参会者」（09-25，本轮重点）** | **① 有存在感**：入会**致辞**（报出「我是谁 / 我能听见什么（**实测**管线数）/ 怎么用我」）+ 离会告别 + 终稿纪要到场——改造前点了按钮聊天区一个字都没有，用户困惑「我点了它到底来没来」；**② 有主动性**：新文件 `sfu/ai/digest.js`（零依赖、可单测）——字幕持续流入即实时抽成「🎯决定 / ⚠️风险 / ✅行动项 / 💬议题」汇成**侧栏会议看板**，并由 `maybeAiSpeakUp` **主动开口**（45s 冷却 + 每次只说一条：不停插话的 AI 比不说话更糟）；**③ 说得的话能被核对**：证据链从**数字**变成**事实**——`🔍 看 AI 依据的 N 条`点开看到**原话**并标注来源；**④ 前提修复（最关键）**：字幕原是「攒满 500 条才上传」（`cap.log` 既是热窗口又是上传队列）→ **服务器要等一整段会议才知道发生了什么**，服务端 AI 全部滞后。拆成「保留历史 / 上传队列」两条独立的路 + 窗口自适应（AI 在场 12 条）+ 6s 定时兜底。**⑤ 前端**：侧栏改分段式（成员/看板/聊天，原 id 契约零改动 + 补聊天未读角标）、快捷问法 chips、看板「出纪要」、**AI 语音播报**（原生 `speechSynthesis` 零依赖、默认关、先洗 markdown）。**本轮最值得记的是两个自我推翻**：(a) 检索下界先设成「助理入会时刻」（听着正当），真浏览器当场打脸——助理几乎总是**中途被请进来**的，一入会就瞎 → **一请来就是个废人**；改为「房间创建时刻」后中途入会能答全本场、上一场会仍被挡住（AGENTS 坑 45/46）；(b) 证据栏固定显示检索命中 → 问「这场会都定了什么」时证据里赫然是「李四 **午饭吃什么**」——**界面在无声撒谎**，改为「哪个来源真驱动了答案就展示哪个」（坑 47）。另修复：纪要分钟级时间戳互相覆盖（数据丢失路径）、纪要/看板风险口径不一致（改为同源）、寒暄与答案抢道（加 `quiet`）、定时上行只 flush 不 spill、意图分类把「问事实」判成「要文件」、看板把「定在 X 日」错分到行动项（并加「定在 + 时间/数值」lookahead 防「固 **定在** 线」跨词命中，坑 49）。回归：`test:ai-brain` **55/55**、`verify:ai` **13/13**、**`verify:board` 真浏览器 21/21**、`test:smoke` **159/159**、`test:sfu` **149/149**、`test:store` 49/49、`test:shutdown` 9/9、`test:agent` 16/16、`test:e2e` 15/15 |
| 43 | **★ 服务端 ASR 成为唯一识别路径 + AI 多轮语音对话（09-28）** | "whisper 装了却没用上"事故修复：根因 = whisper CLI 在中文 Windows/GBK 控制台打印帮助 UnicodeEncodeError → 探测误判"未装" → 前端静默退回浏览器识别。新增 `sfu/ai/asr.js` **唯一实现层**（UTF-8 环境变量 + `--help` 退出码口径 + 形态白名单 + tiny 默认 + 简体 initial_prompt + 并发闸）；**多人会议真缺陷两处**：分段录音按 memberId 分目录（原全体共用互相覆盖）、跳过"正在写的半截文件"（丢句尾）；`ingestCaptions` 公共函数让 ASR 字幕补喂 AI 看板；**唤醒词容错 + 20s 追问窗口**（免唤醒多轮）；`sfu/jsonc.js` 容错解析带注释配置模板。回归：`test:asr` **15/15**（系统 TTS 真语音→whisper 转写闭环实测）、信令 154/154、冒烟 168/168 |
| 44 | **G6-② 房间权限分级 + ASR 常驻转写 worker（09-29）** | **四级角色** `roleOf`（owner=建房者 > admin=平台管理员 > member=登录用户 > guest=游客；owner 判定优先于登录态）随 room-state 显式投影下发；**权限点最小集**：kick=owner/admin、record-start=member 及以上（游客不能录——审计需要身份，fail fast）；前端 admin 盾形徽标 + 踢人入口放开到 admin（服务器仍是权威校验）。**听觉管线**：① 从"录 15s→转写→再录"（串行，转写期间语音全丢）改为单 ffmpeg 持续分段 + 轮询写稳段转写；② **常驻 whisper worker**（`asr_worker.py`，模型只加载一次）——CLI 每段固定 2~4s 启动开销取消，实测每段转写 10~14s → **0.8~3.0s（快约 10 倍）**；spawn 全字面量参数（模型走 env），连崩 3 次自动回退 CLI；asrModel 默认升 small（准确率可感知提升）；**`test:asr-live` 语音闭环端到端 PASS**（TTS 语音→RTP→听觉管线→转写→账本，「小明，帮我记一下明天下午三点的评审会。」逐字全对）。**G6-③ 生产化**：注册密码强度策略（下限可配 + 至少两类字符）与**登录失败锁定**（连错 5 次锁 15 分钟、正确密码也拒、只对存在账号计数防锁人 DoS）。回归：信令 **165/165**（+11 角色与安全断言）、冒烟 **168/168**、test:asr **19/19**、test:shutdown 9/9、test:store 49/49 |

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
