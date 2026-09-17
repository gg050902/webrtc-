# 🎥 简易版腾讯会议 · 多人 WebRTC 会议 —— SFU 版为主（腾讯会议同款架构）

一个**从零手写、带逐步教学**的视频会议项目：房间号创建/加入 + 多人实时音视频 + 屏幕共享 +
群聊 + **入会密码** + **网络质量监控**。
学完它，你能把 WebRTC 从信令到 P2P、从 Mesh 到 SFU（mediasoup 服务器转发）的整条链路**讲清楚、能过面试**。

> 目标：用一条**最简链路**（浏览器原生 WebRTC + Node.js/Socket.IO 信令 + mediasoup）跑通"像腾讯会议"的核心功能，
> 并把每一步代码用**中文教学注释**写清楚，让你既能跑也能讲。

> 🏗️ **版本定位（重要）**：本仓库以 **SFU 版为主版本**（`sfu/` 目录，端口 3001，mediasoup
> **服务器转发**，与腾讯会议同款架构，最多 8 人）；**Mesh 版**（根目录，端口 3000，浏览器
> P2P 直连，最多 3 人）是**教学对照/历史演进版**——它把"浏览器直连"讲明白后，才更容易理解
> SFU 为什么更接近真实产品。两个版本并存、互不干扰，别改混（见下文结构树）。

---

## 📦 想跨电脑连？三条路（详见《部署手册.md》）

| 场景 | 一句话 | 命令/入口 |
|---|---|---|
| 局域网两台电脑 | **0 元三步走**：服务器机复制邀请链接 → 微信发对方 → 打开即入房（《跨电脑连接-操作指南.md》） | `start-lan.bat` 或 `npm run start:lan` |
| 跨网络（不同 WiFi） | 需 TURN：配置已预置 openrelay（含 TCP 回退），先实测可达性 | `npm run test:turn` |
| 公网云主机 | systemd 常驻 + 自建 coturn | 《部署手册.md》场景 C |

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
| 👤 登录/注册 | 用户名+密码注册登录（游客可进）；昵称贯通成员列表与聊天气泡，登录态自动恢复 | users.json + 内置 scrypt 哈希（零依赖）；auth-register/login/verify 三信令 + token 存档（09-16，SFU 主版本） |
| 🖌️ 协作白板（F7） | 全场共享一块白板：5 色深笔/撤销/清空，笔迹按人配色、实时同步 | 第三条 'board' SCTP 频道（与聊天/批注并存）+ 归一化事件溯源重放（09-15，SFU 主版本） |
| ✏️ 协作批注（F5） | 共享屏幕上所有人可画笔迹（5 色/撤销/清空），笔迹按人配色、全房实时同步，共享者同步可见 | **独立 `annot` SCTP 数据频道**（与聊天频道并存互不挤占）+ `to` 定向头过滤 + 归一化坐标事件溯源重放（09-14，SFU 主版本） |
| 📶 带宽估计 / 消息路径 | 「🔗 连接方式」徽标悬浮显示"可用带宽估计 ≈ X Mbps"（transport-cc）；聊天气泡 🛰️ = 走了数据通道路 | `getStats` 的 selected candidate-pair + appendChat 路径徽标（09-14，D+3 前置可视化） |
| 🌐 可达性（跨机/跨网部署） | 局域网/公网部署三件事一份配置解决：监听 IP、HTTPS/wss 自签、ICE(STUN/TURN) 下发；页面顶部「🔗 连接方式」徽标实时显示直连/穿墙/中继 | `sfu/config.json`（可选）+ 自动 HTTPS + `/config.json` 下发 ICE（09-13，对应路线图 E1/E2 自助版） |
| ✨ 滤镜 / 虚拟背景（F6） | 美颜滤镜 5 档（原图/自然/冷白/暖阳/水墨）+ 磨皮滑条 + 绿幕/蓝幕色键抠像换背景（墨/绢/鎏金/自定义图片）；预览页所见即所得；面板实时显示每帧 CPU 账 | canvas 三站流水线（GPU filter 滤镜 → 低清模糊磨皮 → getImageData 色键抠像）+ captureStream → replaceTrack 上行，处理后轨顶替进 localStream 故 publishTracks/关摄像头/重连零改动（09-17，纯前端零依赖，SFU 主版本） |
| ⚡ 一键局域网交付 | `npm run start:lan` 一条命令：自动探测局域网 IP → 生成配置（0.0.0.0 + announcedIp + HTTPS 自签 + openrelay TURN）→ 自动放行防火墙 → 打印"本机/局域网/跨网"三个地址；邀请链接自动换成局域网 HTTPS 地址，发给第二台电脑点开就能进 | scripts/start-lan.js + /config.json 下发 `lanUrl`（09-16c/09-16d，见《部署手册.md》《跨电脑连接-操作指南.md》） |
| 📊 压力基准数字 | 三档（4/8/16 路）媒体转发实测：16 发 16 收 8263 kbps、单核仅占 6%、零丢包 | scripts/bench.js（ffmpeg 合成源 → PlainTransport → mediasoup 转发 → dgram 真收包统计）；数据表见《性能测试报告.md》（E4，`npm run bench`） |
| 💬 实时字幕（AI 线 L1） | 说话内容实时转字幕：本地字幕条半句跳动、整句定稿广播全房；字幕账本（时间戳/说话人/文本）一键导出 txt——即 AI 会议纪要/问答（C2）的输入 | Web Speech API（浏览器内置，零依赖零费用）；只广播 final 不广播 interim、不做信令兜底（可靠性按内容价值定价）；字幕历史抽屉（最近 100 条回看、自动滚底）；开关状态进房间状态机（成员列表 💬 徽标）；Chrome 60s 自动断 onend 续命（09-17，SFU 主版本） |
| 🌙 过夜值守（AI 线 C3-N1） | 睡前开字幕挂一夜（≥7 小时），零人工干预：字幕账本溢出自动归档到服务器（jsonl，一条不丢）、识别器网络故障指数退避自愈 + 看门狗、值守统计（时长/条数/重启/已归档）与心跳日志、导出 txt 自动合并服务器全档 | 规划见《AI部分功能计划.md》第 3.6 节；client.js 第 30 步 + `/api/captions` + `npm run soak`（服务器耐久自测，默认 7h 可压缩）；零依赖零费用，不需要 LLM key（09-17e，SFU 主版本） |
| 📋 值守日报（AI 线 C1） | 字幕历史抽屉「📋 日报」一键生成 markdown 日报：时长/说话人占比条形图/每小时活跃分布/值守健康（识别器重启次数）——服务器归档+内存窗口合并全档，纯本地统计 | 零 LLM 零费用永远可用，与 N2（LLM 纪要）互为兜底；client.js 第 31 步（09-18，SFU 主版本） |
| 📈 Prometheus 指标端点 | `GET /metrics` 输出 Prometheus 文本格式：房间/成员/Producer/Consumer 总数、每路媒体累计字节、录制数、进程 uptime/rss——Grafana 直接可抓 | 复用观测面板同一份 snapshotRooms() 数据源，零依赖手拼（G7 首刀，09-18，SFU 主版本） |

> **本表最后一栏的字母 = 升级编号**（A3/A4/A6 = 远程协助深化；D1~D6 = 会议本体 + SFU 深究；
> D+1~D+4 = SFU 深水区；E1/E2/E4/E5 = 工程化与可交付；F1~F7 = 对齐商业产品的产品体验，
> 参考声网形态、零 SDK 自研；L1 = AI 线实时字幕），
> A 档 + D 档于 **2026-09-11**、F 档于 **2026-09-12 ~ 09-17**、D+ 档于 **09-12 ~ 09-15**、
> E 档于 **09-14 ~ 09-16** 以 **SFU 主版本**实现（Mesh 对照版同步可行部分）；
> 教学导读见 `LEARN.md` 第 **2.13 节**（A 档）、**5.8 节**（D 档）、**5.9~5.19 节**
> （F/D+/E/C 档逐项导读），路线图与**下一步新方向（G 档）**见 `后续升级方向.md`。

> **Mesh 对照版差异**（为什么它叫"教学版"）：媒体/聊天走浏览器 **P2P 直连**（不经服务器，服务器
> 只是信令邮局），人数上限 3；屏幕共享是 `replaceTrack` 换轨。SFU 版把这两点都换成了
> "服务器转发"——差异对照、逐行导读见 `LEARN.md`（第 2.5/2.11 节概念、第 5 节代码导读）。
> ⭐ **H5 远程协助两版都已落地**（Mesh 版 2026-09-09、SFU 版 2026-09-10）：同一功能两种
> 传输形态——Mesh 走 P2P `ctrl_` DataChannel 直连，SFU 走 `remote-input` 信令经服务器
> 定向转发（还多一道"非在册控制端一律丢弃"的门禁）。对比表见 `LEARN.md` 第 5.7 节，
> 这也是面试讲"两种数据通道取舍"的最佳素材。

技术栈：`Node.js` + `Socket.IO`（信令）+ `mediasoup`（SFU 媒体中枢）+ 浏览器原生 WebRTC + 原生 JavaScript（零前端框架）。

---

## 🖥️ 前端 vs 后端（谁跑在哪、各干什么）—— 面试必答

这个项目只有"两个进程"：**浏览器里的页面 = 前端**，**Node.js 服务器 = 后端**。它们通过
Socket.IO 收发"信令消息"，媒体在 SFU 版由服务器转发、在 Mesh 版由浏览器直连。

| | 前端（浏览器） | 后端（Node.js 服务器） |
|---|---|---|
| **跑在哪** | 每位参会者自己的浏览器标签页里 | 一台常驻的电脑/云服务器（你本机即可演示） |
| **代码位置（SFU 主版本）** | `sfu/public/`：`index.html` + `style.css` + `client.js`（**第 1~31 步**，28 = 滤镜，29 = 实时字幕，30 = 过夜值守，31 = 值守日报）+ `dashboard.html`（观测面板）+ `vendor/` | `sfu/server.js`（分区 A~E）+ `protocol.js` + `config.json`（可选配置） |
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
│                           #          test:smoke / test:record / test:turn / bench / build:sfu-vendor
├── server.js               # [Mesh 对照版] 信令邮局（3000）：静态托管 + 房间/密码 + 定向转发
├── start-lan.bat           # 一键局域网交付（探 IP + 生成配置 + HTTPS + 放行防火墙）
├── deploy/coturn/          # 自建 TURN 包（docker-compose.yml + turnserver.conf）
├── scripts/
│   ├── test-signaling.js   # Mesh 信令回归（npm test，需先起 3000）★ 33/33
│   ├── test-sfu-signaling.js  # SFU 信令回归（npm run test:sfu，需先起 3001）★ 67/67
│   ├── test-sfu-client-smoke.js # SFU 前端无头冒烟（npm run test:smoke，零依赖不用起服务器）★ 76/76
│   ├── test-turn.js        # ICE 可达性实测（手搓 STUN Binding / TCP 探测）
│   ├── bench.js            # E4 压力基准（4/8/16 路媒体转发实测）
│   ├── start-demo.js       # 一键起两版并打印地址
│   └── start-lan.js        # 局域网交付（生成 sfu/config.json + HTTPS 入口）
├── public/                 # [Mesh 对照版] 前端（P2P 直连用）
│   ├── index.html / style.css / client.js（第 1~16 步 + 第 19~25 步 A/D 档同步）
│   └── vendor/             # 本地 socket.io 客户端库（勿动）
└── sfu/                    # ★ 主版本（SFU：mediasoup 服务器转发，端口 3001）
    ├── server.js           #   后端：静态托管 + 房间/密码 + Worker/Router/Transport 媒体中枢（分区 A~E）
    ├── protocol.js         #   信令事件总表（改 server/client 前先看）
    ├── config.example.json #   配置模板（端口/人数/监听 IP/announcedIp/ICE/HTTPS/roomTtlSec/videoSvc）
    ├── config.json         #   实际配置（可缺省；start:lan 会自动生成；含 lanUrl 供邀请链接改写）
    ├── users.json          #   登录注册的用户存储（scrypt 哈希，零依赖）
    ├── recordings/         #   D+2 服务器侧录制产物（webm/mkv，经 /recordings/<file> 下载）
    ├── tls/                #   HTTPS 自签证书（https.enabled 时自动生成）
    └── public/             #   前端：几乎同 Mesh 版，多了 mediasoup-client
        ├── index.html / style.css / client.js（**第 1~29 步**）
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
npm run test:sfu   # SFU 主版本信令：需先 npm run start:sfu（连 localhost:3001）★ 本次实测 67/67
npm test           # Mesh 对照版信令：需先 npm start（连 localhost:3000）★ 本次实测 33/33
npm run test:smoke # SFU 前端无头冒烟（零依赖，不用起服务器）★ 本次实测 76/76
npm run test:record # D+2 服务器侧录制端到端自测（ffmpeg 当媒体源→mediasoup→落盘，需已装 ffmpeg）
npm run test:turn  # ICE 可达性实测（对 config 里每个 STUN/TURN 手搓 STUN Binding，3s 超时）
npm run bench      # E4 压力基准（4/8/16 路，约 1 分钟，独立 Worker，不用起 3001）
```

- SFU 版测试（**2026-09-17 实测：67 通过 / 0 失败**）：房间/密码复用 + mediasoup Router 能力 +
  Transport 创建与防重 + consume 错误路径 + 远程协助（授权/互斥/输入门禁/二进制与中文透传）+
  A/D 档（成员状态白名单、房主踢人、剪贴板门禁、文件配额、限时授权、切层错误路径）+
  D+ 档（`sctpParameters`/`produce-data`/`consume-data`、跨房间录制目标被拒、VP9 能力、
  房主迁移、空房 TTL 宽限期内原号回归、`/api/rooms` 与 `/dashboard`）+ 09-16 **auth 8 项**
  （注册/重复注册/错密码统一提示/登录/token 恢复/伪造 token/昵称贯通 room-state）+
  09-17b 字幕状态入册。
  ⚠️ **真实音视频、simulcast 三档、说话人检测、浏览器侧录制、触屏手势、滤镜与字幕需要浏览器人工验证**
  （命令行只到信令层）；清单见 `后续升级方向.md` 第 0.2 节。
- Mesh 版测试（**2026-09-17 实测：33 通过 / 0 失败**）：建房拿号、凭号加入、room-not-found、
  new-member 广播、offer/answer/ICE 定向转发、room-full 拒绝、peer-left、空房自动销毁、
  入会密码三关校验、远程协助全链路 + 限时授权（`expiresAt`/到期自动复位/无幽灵定时器/blocked 透传）。
- **前端无头冒烟测试 `npm run test:smoke`（2026-09-17 实测：76 通过 / 0 失败，零依赖、不用起服务器）**：
  用最小 DOM + 假 mediasoup-client 把 `sfu/public/client.js` 真跑一遍——顶层执行、
  媒体链路与 **simulcast 三层 encodings 接线**、成员列表/音量/换层、远程协助控制层采集
  （含触屏长按与双指）、文件分块、剪贴板、录制、设备切换、断线重连，以及 **F7 三条 SCTP 频道、
  F6 滤镜管线、实时字幕（识别→定稿→广播→续命→导出）、登录卡与昵称**。
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
  （现有零依赖冒烟 76 项是可选的"零依赖版"，Playwright 属新依赖需拍板）；
- 🔶 **C 档（与 AI 线汇合）**：**L1 实时字幕已落地**（09-17b，Web Speech API 零费用，不需要 LLM key）；A6 审计日志 + 字幕账本两份结构化输入就位，等 AI 阶段 0~2（LLM key）接 C1/C2；
- 🔜 **G 档 · 下一步新方向（2026-09-17 公布）**：云部署与多机 SFU 级联 / AI 会议助理落地 / 录制产物回放 /
  PWA 移动端 / 端到端自动化 / 安全加固 / 可观测性升级 / 规模与性能——8 个候选方向（含做法、难度、
  依赖代价与"零新依赖"铁律的冲突点）见 `后续升级方向.md` **G 档**；
- 跨机联调实操见 `EVOLUTTON.md` 第 6 节。

> ⚠️ **人工验证提醒**：本次升级的**真实音视频效果**（simulcast/SVC 三档协商、说话人高亮、
> 浏览器侧 D5 录制产物、服务器侧 D+2 录制回放、触屏手势、剪贴板权限、滤镜与绿幕抠像、
> 实时字幕识别、跨机 HTTPS/TURN）命令行验不了，请开浏览器按 `后续升级方向.md` 第 0.2 节清单逐条确认。

---

## 📚 参考资料

- `LEARN.md`：本项目的中文教学主线（JS → WebRTC → Mesh → SFU），阅读顺序以它为准
- 知识来源：WebRTC 学习路线 PDF（讲解顺序按其章节安排；文件未随仓库保存，需时自行放入根目录）
- MDN：`https://developer.mozilla.org/zh-CN/docs/Web/API/RTCPeerConnection`
- 调试：Chrome 地址栏 `chrome://webrtc-internals` 看真实 SDP / ICE / 统计
