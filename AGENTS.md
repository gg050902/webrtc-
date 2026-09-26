# AGENTS.md — 会话记忆交接（迁移到 DeepSeek Harness 用）

> 本文件是把本会话迁移到 **DeepSeek Harness（DSH）** 的"会话记忆声明"。
> 新环境里的 agent 请先读本文件 + `README.md`，需要教学细节再读 `LEARN.md`。
> 生成日期：2026-09-06；更新：生产化收尾 ✅ + **SFU 版已落地**（sfu/ 目录，mediasoup 3.26，端口 3001，与 Mesh 版并存）；09-09 第 9 节守则改省 token 版
> 09-09 定位更新：**主版本 = SFU 版**（sfu/ 3001，README 已调换主次）；Mesh 版（根目录/3000）降为"教学/对照版"；
> **09-09 大更新：H5 远程协助 P0 已全量落地（Mesh 版独有）**——Phase 2~5 全部完成（ctrl_ 通道/控制端采集/
> 被控端工作台重放/状态机收尾），回归 26/26；**下一个方向的菜单在 `后续升级方向.md`**
> （09-10 从 H5 规划第 12 节独立成文，带状态跟踪列，升级回填以它为准；H5 规划第 12 节保留为快照）
> **09-10 升级 A1 完成：SFU 版远程协助已落地**（两版同款功能：Mesh=P2P ctrl_ 通道，SFU=remote-input
> 信令转发+服务器门禁；导读 LEARN.md 5.7；回归 SFU 19/19 + Mesh 26/26）
> **09-11 升级 A2+A5 完成：中文 IME + 控制质量工程化（两版同步）**——隐藏 IME 捕获框整段发中文；
> 鼠标/滚轮 16 字节二进制帧 + RTT 自适应节流 + Mesh 版积压监控；SFU 服务器放行二进制帧（坑 16/17）；
> 导读 LEARN.md 2.12.7 + 5.7；回归 SFU 21/21 + Mesh 26/26
> **09-11 大升级（A 档 + D 档全清）：远程协助深化 + 会议本体/SFU 深究（以 SFU 为主线）**——
> A3 剪贴板双向同步 / A4 截图 + 分块文件传输（服务器配额校验）/ A6 限时授权（服务器权威计时）
> + 本地审计日志 + 拉黑 / A7 触屏；**D1 Simulcast 三档 + 服务器按丢包率自动升降层** /
> **D2 服务器端 AudioLevelObserver 说话人检测** / D3 设备热切换 / D4 成员状态机 + 房主踢人 /
> D5 canvas 合成录制 / D6 断线重连重建媒体链路。SFU 前端步骤扩到 **1~27**，协议新增
> member-state/room-state/kick/audio-levels/set-preferred-layers/clipboard-sync/file-*；
> **回归 SFU 41/41**；导读 LEARN.md **2.13**（A 档）+ **5.8**（D 档）；
> 下一个主战场 = `后续升级方向.md` 的 **D+ 档**（SFU 数据通道 / 服务器侧录制 / 带宽估计与 SVC / 房间 TTL）
> **09-12 F 档前三刀完成：对齐商业产品体验（参考声网形态、零 SDK 自研，仅 SFU 主版本）**——
> F1 宫格/演讲者双布局 + 📌钉选 + 双击全屏（大画面优先级=钉选>共享者>说话人>自己；
> 切布局只换 CSS 类 + tile-main 标记，**JS 不搬 DOM**，video 不闪黑）；F2 每成员网络质量点
> （新信令 `net-levels`：服务器每 3s 量每人最差路 Consumer 丢包率、**有变化才广播**，
> 信任模型同 D1 选层）；F3 加入前预览页（镜像预览 + 设备选择 + AnalyserNode 试音条 +
> 预静音；预览与会议共用同一条 localStream；无媒体也可进房）；SFU 前端步骤扩到 **1~26**
> （25=预览页，26=布局/网络点）；回归 SFU 41/41 + 冒烟 **31/31**（smoke 桩升级：
> querySelectorAll 支持单类选择器）；导读 LEARN.md **5.9**；路线图 `后续升级方向.md` **F 档**
> （F4~F7 待做；下一主战场仍是 D+ 档）。
> **09-12 真机验证补四修**（IAB 真浏览器双窗口实测，全部 ✅ 复验）：① 预览页遮罩关不掉
> （.prejoin 的 display:flex 压过 .hidden，坑 24）；② **SFU 邀请链接 404**——sfu 静态托管
> 没剥 ?room= 查询串就当文件名找（Mesh 版"坑 15"的修法当年复制漏了），已补 new URL().pathname
> + public 目录穿越钳制；③ .room-panel.hidden 同类 CSS 坑（进房后面板不消失）；
> ④ applyLayout 漏清 self 格的 tile-main（钉选后出现两张大画面）；
> 附带小优化：无房间号时点「进入会议」后自动聚焦房间号输入框
> **09-12 D+ 档首刀完成：D+1 SFU 数据通道（DataProducer/DataConsumer）**——
> create-webrtc-transport 开 enableSctp（应答带 sctpParameters）；新事件 produce-data/
> consume-data/close-data-producer + new-data-producer/data-producer-closed 广播；
> room-members 清单带 dataProducers；SFU 前端步骤扩到 **1~27**（27=数据通道），
> 聊天改**双路径**：SCTP 主路 + 信令兜底，msgId 去重；protocol.js 新增 D+1 段；
> 回归 SFU **50/50**（+9）+ 冒烟 **37/37**（+6）；导读 LEARN.md **5.10**；
> 下一刀 = D+2 服务器侧录制 或 D+4 房间 TTL
> **09-12 工作台桌面化升级（两版同步）**——workbench.html 从"三控件"重写成**伪桌面**
> （任务栏时钟/可拖拽图标/双击开窗/计算器/音乐播放器/文件列表滚轮滚动/自定义右键菜单/
> 白板/记事本），**全部只用"会被重放"的事件**（pointerdown/move/up、wheel、dblclick、
> contenteditable；禁 click/input/HTML5 拖放，守则写在文件头）；两版 client.js 重放时补
> **点击涟漪**（mousedown → .ctl-ripple 绿环，iframe 检查前触发）；冒烟测试抓到两个老坑：
> ① vm 跨 realm（宿主造的 ArrayBuffer 过不了 client 的 instanceof 检查，帧一直被静默跳过）；
> ② **rcRole='host' 只在点「允许」时设置**——只 emit remote-state 时四种形态重放全是
> 静默空转，断言沦为"不抛错"（已改为走真授权链路：共享→开协助→允许）；冒烟 **39/39**、
> 信令 50/50 不变；待人工验证：真浏览器两窗口看伪桌面重放效果 + 涟漪
>
> **09-13 大升级（五线并进：SFU 深化 + 可达性 + 拟真 + UI 翻新）**——
> ① **观测面板**：服务器 `/api/rooms` 全景快照（成员/每路 Producer 累计字节+健康分/发言/控制权）
>   + `/dashboard` 零依赖面板页（2s 轮询，页面做差算码率画 canvas 折线）；
> ② **F4 表情回应（D+1 通道首个非聊天应用 `{type:'react'}` 全房飞屏）+ 举手（member-state
>   白名单加 hand）+ 发言占比（AudioLevelObserver 顺手记账 → `talk-stats` 有变化才广播，
>   成员行占比条）**（SFU 第 26b 步；仅主版本）；
> ③ **可达性（E1/E2 自助版）**：`sfu/config.json`（可选，config.example.json 为模板）统一管
>   端口/监听 IP/announcedIp/ICE(STUN/TURN)/HTTPS；https.enabled 自动起 HTTPS+wss（openssl
>   自动自签到 sfu/tls/）；ICE 经 `/config.json` 下发进两条 Transport；**页面顶部「🔗 连接方式」
>   徽标**（getStats 候选类型：直连/STUN 穿墙/TURN 中继）让边界看得见；README 新增「跨网络部署」节；
> ④ **workbench v3 拟真**（两版同步）：开机动画/窗口最小化+任务栏按钮/右键换壁纸/
>   **实时字幕 HUD**（client 重放动作时向 iframe dispatch `remote-activity` CustomEvent，
>   工作台仍不知道 WebRTC）；client 新增 `emitWbActivity`（只报动作不报 mousemove）；
> ⑤ **UI 翻新**：两版 style.css 末尾追加"主题层"（CSS 变量/渐变/阴影/过渡/新组件样式，
>   类名零改动）；
> 回归：SFU 信令 **53/53**（+3：hand 白名单/api/rooms/dashboard）+ 冒烟 **44/44**（+5：回应/
> 飞屏/举手放下手/talk-stats）+ Mesh 33/33 不变；
> ⚠️ 待人工验证：观测面板真实数据、表情飞屏/举手徽标、发言占比条、HTTPS 跨机访问、
> workbench 最小化/HUD 字幕、UI 观感
>
> **09-14 深化升级（数据通道多频道 + F5 批注 + UI v2）**——
> ① **SCTP 多频道**：setupDataChannel 现在开**两条** DataProducer（label='chat' + label='annot'），
>   订阅端按 DataConsumer.label 路由（handleDataMessage / handleAnnotMessage）；
> ② **F5 协作批注落地**（第 26c 步）：屏幕格盖 .annot-canvas + 工具条（✏️/5 色/↶/🗑）；
>   笔迹消息 `{type:'annot', to, op:'start|draw|end|undo|clear', x, y, color}` ——to=定向头
>   （广播+应用层过滤）、坐标 0~1 归一化、applyAnnotOp 单一状态机（本地画与远端收同一路径
>   = 事件溯源）、colorFor(id) 按人配色；**共享者也开"我的屏幕"格**（addSelfScreenTile，
>   共享时能看到观众视角 + 批注实时落点）；resize 时按账本重放；⚠️ 已知边界：批注不落屏
>   （只存在内存，刷新即清，教学取舍已注释）；
> ③ **带宽估计可视化（D+3 前置）**：getStats 的 selected candidate-pair 里
>   availableOutgoing/IncomingBitrate → 「🔗 连接方式」徽标悬浮提示显示"≈ X Mbps"；
> ④ **消息路径徽标**：聊天气泡 🛰️ = SCTP 数据通道路，无徽标 = 信令兜底路（appendChat 第 4 参）；
> ⑤ **UI 主题 v2**（学 Radix Colors 12 级层次 + Primer 语义 token）：--bg0~3 四级背景/
>   --fg 三级前景/--border 两级/accent×(emphasis+muted)，两版 style.css 末尾追加，
>   类名零改动；控制条玻璃胶囊、房间面板悬浮卡、视频格 16:9 质感、聊天气泡分层；
> 冒烟 **49/49**（+5：双频道并存/批注层/笔迹三段/对端笔迹重放/路径徽标；新坑：冒烟桩
> window 无 addEventListener 曾中断加载——顶层 DOM API 要防御式调用）+ 信令 53/53 不变；
> 待人工验证：两窗口真实批注同步（颜色/撤销/清空）、共享者视角落点、UI v2 观感
>
> **09-14b 前端全量重构（回应"前端真丑"——前两轮"覆盖式美化"上限已到，这次动结构）**——
> sfu/public/index.html 重构为**应用壳布局**：topbar（品牌+状态 pills）/ stage（房间 hero 卡
> 居中 + 视图分段条 + 视频网格 + 底部悬浮控制坞）/ sidebar（成员+聊天双面板）/ 底部 log，
> 全部元素 **id 与 JS 契约类零改动**（client.js/冒烟测试全绿）；style.css **整份重写**
> （14 节组织：token/reset/按钮/徽标/壳/网格/坞/侧栏/日志/工作台/预览/弹层/特效/响应式），
> 根治坑 24（`.hidden{display:none !important}` 全局终审）；预览页/房间卡/toast/授权卡全部
> 重新设计；**Mesh 版样式保持不动**（对照版兼容优先，新 CSS 只上主版本）；
> 信令 53/53 + 冒烟 49/49 全绿；待人工验证：强刷新页面看观感（不满意可继续调 token）
>
> **09-14c 路线图三连（D+3 完成 / D+4 完成 / E5 完成，"各方面持续升级"）**——
> ① **D+3 ✅**：Router 加 **VP9 编解码**；config.json `videoSvc:true` 时摄像头改用
>   **VP9 SVC（L3T3 单路三层）**上传（失败自动回退 simulcast→单层，冒烟验证默认路径不变）；
>   **服务器侧带宽估计**进 ABR：collectMemberNet 并采 Consumer 丢包 + recvTransport 的
>   availableOutgoingBitrate；net-levels 广播带 `bwe`，选层监控加 **bweCap**
>   （>1.2M 允许最高层 / >500k 中层 / 否则最低，reason 'auto-down-bwe'）——
>   ABR 从"丢包事后反应"升级为"带宽事前预防"；成员行网络点悬浮提示带"下行带宽估计"；
> ② **D+4 ✅**：空房不再立刻销毁——`scheduleRoomTtl` 进**宽限期**（ROOM_TTL_MS/
>   config.roomTtlSec 默认 60s，Router 不关号码不回收，宽限内原号+密码可回归），
>   到期 `destroyRoom`（抽出的公共销毁函数，三定时器全清）；**房主迁移**：房主离开时
>   迁给 joinedAt 最早的幸存者（joinRoom 记 joinedAt）；/dashboard 空房显示
>   "⏳ 空房宽限中 · 剩 xx s"；D6 的"最后一人掉线重连不回来"已知边界就此补掉；
> ③ **E5 ✅**：`npm run start:demo`（scripts/start-demo.js 一键拉起两版+打印地址）
>   + **《演示脚本-5分钟.md》**（0:00 架构 → 会议本体 → simulcast 弱网 → 远程协助
>   → 面板/可达性 → 简历叙事，含 Q&A 弹药）；
> 信令 **56/56**（+3：VP9 能力/房主迁移/宽限期回归）+ 冒烟 49/49；坑 3 复现记牢：
> room-created/room-members 在 create-room 应答**之前**发，测试先注册监听再 emit；
> ⚠️ 待人工验证：TTL 到期真正销毁、房主迁移 UI、SVC 真协商（config.videoSvc:true）、
> bwe 数值合理性、start:demo 双服务退出
>
> **09-15 持续升级（美学 + D+2）**——
> ① **前端美学·传统色与氛围**（学 zhongguose.com + alteredqualia nebula）：token 换
>   **中国色低饱和系**（黛 #0d0d15 底 / 苍 #97a3b3 / 竹青 #86a876 强调 / 月白 #e6ecf2 文字 /
>   胭脂 #e0636f / 苍黄 #d3b877，灰阶带轻微色相不再纯灰）；**衬线中文标题 + 宽字距英文
>   小型大写**双语排版（--font-display: Noto Serif SC）；**星云氛围层**（body::before 双光晕
>   90s 漂移 + body::after SVG feTurbulence 噪点+暗角，纯 CSS 零依赖）；
> ② **D+2 服务器侧录制（代码就绪）**：record-start {memberId} → PlainTransport×2（RTP 旁路
>   connect 到 ffmpeg 端口对 50000+）→ consume+resume → 生成 SDP → ffmpeg -c copy 落盘
>   recordings/（webm，H264→mkv）→ GET /recordings/<file> 下载；成员行 ⏺/⏹ 按钮；
>   **ffmpeg 启动时探测**：未装则 record-start 返回明确安装提示（本机未装，信介试了这条
>   错误路径）；装好后重启即全功能；
> 信令 **58/58**（+2 D+2 错误路径）+ 冒烟 49/49；
> ⚠️ 待人工验证：装 ffmpeg 后端到端录制（产物可播）、批注/迁移/UI 新观感
>
> **09-15b 同构补齐 + 观测增强**——
> ① **Mesh 版 HUD 派发补齐**（真缺口）：workbench v3 两版同步了，但 Mesh client 的重放
>   没派发 remote-activity → Mesh 的实时字幕 HUD 永远不亮；现补 emitWbActivity/
>   describeWbTarget + 四处派发（mousedown/dblclick/wheel/keydown/input-text），与 SFU 逐行同构；
> ② **Mesh 连接方式徽标**：monitorNetwork 收集 local-candidate 候选类型（P2P 语义 =
>   全体 peer 汇总），顶部 🔗 徽标与 SFU 同款；
> ③ **D+2 收尾**：D6 重连清 recordingsByMember（旧会话随断连已销毁）；/api/rooms 带
>   recordingCount + media[].recorded，面板概览加"⏺ 服务器录制中"、媒体行加 ⏺ 标记；
> 回归：SFU 信令 **58/58** + 冒烟 49/49 + Mesh **33/33** 不变；
> 待人工验证：Mesh HUD 字幕（授权控制后看被控端右下角）、Mesh 🔗 徽标、面板录制标记
>
> **09-15c 三连收官（用户拍板"三步都要实现"）**——
> ① **D+2 端到端 ✅（真打通）**：winget 装 ffmpeg 9.0.1；server 探测升级（PATH + winget
>   包目录兜底，FFMPEG_BIN 绝对路径）；录制核心抽成模块级 **startRecording()**（信令与
>   自测共用）；record-start 支持 **producerId 直录某一路**；新增 **TEST_RECORD=1 自测通道**——
>   ffmpeg 当媒体源（testsrc2+libvpx，-g 15 每秒关键帧）RTP 推进 comedia PlainTransport →
>   startRecording 完整链路 → 产物 **251KB/4.0s**（ffprobe 验证）；
>   **踩坑三连**：webm copy 需关键帧起写（无 -g 则 0B）；Windows 上 stdin 'q' 无法打断
>   阻塞的 RTP demux（trailer 丢失 duration=N/A）→ **退出后 remux 补 trailer**（毫秒级 -c copy）；
>   npm 新增 `test:record`；
> ② **F7 独立协作白板 ✅（第 26d 步）**：第三条 SCTP 频道 'board'（与 chat/annot 并存）；
>   控制坞 🖌️ 白板按钮 + 月白底覆盖层（深色笔 5 色/↶/🗑/✕）；事件溯源同批注但**无 to 定向头**
>   （房间级共享画布 vs 贴在屏幕格上的笔迹，语义不同频道不同）；冒烟 49→**53**（三条频道/
>   白板开合/笔迹三段/对端重放/clear）；
> ③ **E1 TURN ✅**：config.example.json 预置 **openrelay 免费 TURN**（跨网演示开箱即用）；
>   新增 **deploy/coturn/**（docker-compose + turnserver.conf，一条命令自建 TURN）；
>   README 部署表更新；
> 回归：信令 **59/59**（+1 跨房间录制目标被拒）+ 冒烟 53/53 + Mesh 33/33 + test:record PASS；
> ⚠️ 待人工验证：浏览器双窗白板真实同步（颜色/撤销/清空）、TURN 徽标显示"中继"（跨网时）、
> 真实摄像头录制的产物（自测已验链路，浏览器路径同一段代码）
>
> **09-16 排版根治 + 登录注册补全**——
> ① **排版"乱/没字"的根因**：style.css 文件头注释写了 `.annot-*/` —— `*/` 提前终止注释，
>   `:root {...}` 整块被 Chrome 当畸形规则丢弃 → **全站 CSS 变量为空**（坑 26 详载）；
>   防守三件套：注释不写 `*/`、静态响应 `no-store`、样式引用带版本参数；
>   修复过程中顺手把面板**实底化**根治了"视频透进面板"的乱象；
> ② **玻璃质感回归（取长补短）**：用户点名要回"之前那种好看的"——顶栏/徽标/控制坞/
>   侧栏/房间卡/预览卡/弹层全面恢复**磨砂玻璃**（高不透明 .74~.92 + backdrop blur
>   12~22px + saturate）：有玻璃的高级感，但模糊兜底不会再"乱"；
> ③ **登录/注册（基础功能补全，零依赖）**：users.json + scrypt(盐) 哈希（crypto 内置，
>   不引 bcrypt）；auth-register/login/verify 三信令 + 内存 token（重启失效是教学取舍）；
>   前端登录卡（z110，可游客进入）+ localStorage 自动恢复；**昵称贯通**成员列表/
>   聊天气泡（信令与 SCTP 双路都带 name）；错密码与"用户名不存在"统一提示（不泄露）；
> 浏览器截图验证：登录卡/预览页/进房（成员显示"我 · 小张"）三屏全过；
> 回归：信令 **66/66**（+8 auth）+ 冒烟 **57/57**（+4 登录面板/存档/昵称）+ Mesh 33/33；
> ⚠️ 待人工验证：双窗不同账号昵称互见、游客与登录混用、重启服务器后 token 失效提示
>
> **09-16b 色调重塑（用户点名"要传统文化气息"）**——冷紫+竹青换**水墨丹青**：
>   墨/绢暖黑底（--bg0 #14100a）+ 宣纸白文字（#ece5d8）+ **鎏金**强调（金徽标/金线/
>   在线态）+ **朱砂**主按钮（印泥红渐变）+ 茶褐边框；顶栏/预览 logo 改 **"會"字朱砂印章**；
>   全局冷色值（紫/青/绿）清扫归零；另修**视频格溢出**（grid 行 `minmax(0,1fr)` +
>   stage overflow:hidden——aspect-ratio 撑破 1fr 行导致格子溢出遮罩，表现为"底部露出清晰视频"）；
>   style.css 版本参数 bump v=20260916；冒烟 57/57；
> ⚠️ 待人工验证：整页暖墨观感是否合意（token 集中可继续微调）
>
> **09-16c 可交付落地（"跨电脑能连"）**——
> ① **一键局域网交付**：`start-lan.bat` / `npm run start:lan`（scripts/start-lan.js）——
>   自动探测局域网 IP → 备份旧配置 → 生成 sfu/config.json（0.0.0.0+announcedIp+HTTPS
>   自签+openrelay TURN）→ 启动并打印"本机/局域网 HTTPS/跨网"三地址 + 防火墙放行命令；
> ② **ICE 可达性实测**：`npm run test:turn`（scripts/test-turn.js）——对 config 每个
>   iceServer 手搓 **STUN Binding**（20 字节 UDP）3s 验可达；TCP 分支用 net.connect；
>   **本机实测**：Google STUN 可达；openrelay **UDP 全被封但 TCP 443 可达**——
>   配置里 `?transport=tcp` 正是保底通道（浏览器 ICE 自动回退）；
> ③ **实测通过**：start-lan 生成配置 → HTTPS `https://192.168.165.194:3443` 返回 200
>   （自签证书自动落 sfu/tls/）= "另一台电脑访问"的服务端全链路已验证；
> ④ **部署手册.md**：局域网 5 分钟 / 跨网 TURN（含排查口诀）/ 公网云主机 systemd /
>   端口速查表 / 交付前自查清单；性能数据已落《性能测试报告.md》（bench.js 三档实测）；
>   工程件：LICENSE(MIT)/.gitignore/package 元数据（name/version/description/license）；
>   论文提纲按用户要求押后（"后边还要加功能"）；
> ⚠️ 待人工验证：真·第二台设备局域网进会（防火墙放行后）、跨网 🔗 徽标显示 TURN 中继
>
> **09-16d "跨电脑"体验打磨**——用户反馈"操作复杂"：① **邀请链接跨电脑化**（真缺口）：
>   服务器机自己用 localhost 访问时复制的链接别的电脑打不开——/config.json 下发
>   **lanUrl**（announcedIp+HTTPS 入口），复制逻辑自动替换 host，点房间号徽标即得
>   "发出去就能用"的链接；② start-lan **自动 netsh 放行防火墙**（失败提示管理员重跑）+
>   打印"跨电脑三步走"；③ **《跨电脑连接-操作指南.md》**：费用速查（局域网 0 元/
>   跨网 0 元公共 TURN/云机可选）+ 三步图文化 + 常见问题表；
> ⚠️ 待人工验证：局域网第二台电脑点邀请链接直接入房（本次改动的核心体验）
>
> **09-16e 端口占用友好化（用户实测踩到 EADDRINUSE 堆栈）**——
> ① server.js：http/https server 挂 error 监听，3001/3443 被占时打"人话"指引
>   （"已有实例直接用 / 重启先 taskkill"）并 exit(1)，不再甩堆栈；
> ② start-lan.js：启动前预检 3001（net.connect），已有实例直接提示"浏览器打开即可"
>   并退出，杜绝双开；三场景已验证（正常启动/二次启动友好提示/预检拦截）；
>   另：调试残留的后台实例就是用户撞 EADDRINUSE 的直接原因（我方调试进程未清）。
>
> **09-17 F6 滤镜虚拟背景 + 09-17b 实时字幕 + 09-17c 字幕深化**（详见文末第 9 节后的三条
> 更新记录与第 2 节功能表 22/23 行）——F 档收官（F1~F7 全清）、AI 线 L1 开工（C 档入场：
> 字幕账本 cap.log 就位，只差 LLM key）；**回归实测：SFU 信令 67/67、SFU 前端冒烟 76/76、
> Mesh 信令 33/33**。
>
> **09-17d 文档同步（四份主文档回填代码现状 + 公布 G 档）**——本次只改文档、不动任何代码：
> ① `README.md`：功能表补"一键局域网交付 / 压力基准数字"两行、开发历程表从 15 行补到 26 行
>   （09-13 观测面板/可达性 → 09-16c 交付与基准 → F6/字幕，并把 F6/字幕调整为末两行）、
>   回归测试节换成**本次真跑的 67/76/33 + test:record/test:turn/bench/doctor**（doctor 是本次会话内
>   由并行工作补齐的，实测 **17 通过 / 1 警告 / 0 失败**——警告为"openssl 不在 PATH，证书已存在不影响运行"）、
>   文档导航表补《部署手册.md》《跨电脑连接-操作指南.md》《性能测试报告.md》
>   《演示脚本-5分钟.md》四份、跑起来节补 `start:lan`/`start:demo` 与 **HTTPS 入口提示**、
>   项目结构树与步骤号（1~29）同步；
> ② `LEARN.md`：第 0 章阅读路线加"SFU 主版本"一条、**第 4 节进度清单从 9 条补到 16 条**
>   （09-12 ~ 09-17 每轮升级各一条并指向 5.9~5.19）、5.1 补 start:demo/start:lan 与 HTTPS
>   安全上下文提醒、5.2 文件地图补 dashboard/config/users/recordings/scripts、5.4 标题改
>   **步骤 1~29** 并补 26b/26c/26d/28/29 五条、5.5 事件速查补 D+1 数据通道/net-levels/talk-stats/
>   auth 三信令/record-*/五种数据通道消息/**四个 HTTP 接口**；
> ③ `后续升级方向.md`：第 0 节基线刷新为 09-17（回归数字、缺口三条改写、0.4 结论指向 G 档）、
>   档位总览表更新 D+/E/C 状态并加 G 档行、**F 档 F7 行 🔜 → ✅**、推荐节奏重写、
>   **新增「G 档 · 下一步新方向（2026-09-17 公布）」共 8 个候选方向**（每个含做法/价值/难度/
>   依赖代价与零依赖冲突点）；
> ④ 本文件（AGENTS.md）：顶部补本条、第 2 节补登录注册/一键交付/性能基准三行并把观测面板与
>   可达性两行补上函数名与步骤号、第 4 节文件地图与第 5 节命令块补齐、第 6 节补 09-13~09-17
>   新增事件表、第 7 节新增 **坑 31**、第 8 节把 09-12~09-16 成果补齐并把"下一步"改成真实剩余项。
> ⑤ **本次实测数字（2026-09-17，唯一权威）**：`npm run test:sfu` **67 通过 / 0 失败**、
>   `npm run test:smoke` **76 通过 / 0 失败**、`npm test`（Mesh）**33 通过 / 0 失败**；
>   文档中出现的断言数一律以这三组为准。
> **09-17e 过夜值守立项 + C3-N1 落地（"能跑一晚上最少 7 个小时"）**——AI 线新目标
> **L 线长跑：睡前开字幕挂一夜（≥7h），零人工干预，早上拿全档字幕 + 值守日志**；
> 规划落《AI部分功能计划.md》**第 3.6 节**（三个缺口/三步走 N1~N3/7 条量化验收/部署清单/成本账）
> + 路线图 **C3 行**。**N1（零依赖零费用、无需 LLM key）已随本次落地**：
> ① client.js **第 30 步**：账本溢出归档（500 条环形剪掉旧段 → POST /api/captions 服务器
>   jsonl 落盘，失败滞留 60s 兜底重发 + 成功续传；"内存=热窗口，服务器=权威副本"）、
>   network 指数退避（3 次永久停 → 30s→…→5min，12 次约 45 分钟才放弃）+ 30s 看门狗
>   setTimeout 链（巡检 cap.rec，排程句柄必须清零否则看门狗永久失效——本次修掉的隐患）、
>   值守统计（抽屉头部 capSentryStats）+ 30 分钟心跳 + 导出合并服务器全档；
> ② sfu/server.js **POST/GET /api/captions**（房间号 6 位白名单、jsonl append-only、
>   坏行跳过、单条截长；GET format=txt/json 回读）；protocol.js HTTP 段同步；
> ③ **npm run soak**（scripts/soak.js）：服务器侧耐久自测——常驻房间三类流量（信令/归档/
>   面板 GET）+ 10 分钟心跳落 sfu/logs/ + 结束对账"POST==回读"，默认 7h、--minutes 压缩；
> **回归（本次实测）**：信令 **72/72**（+5 /api/captions）+ 冒烟 **87/87**（+6 值守）+
> soak 压缩跑 **PASS**；坑：test-sfu-signaling.js 顶部 `const URL` 遮蔽全局 URL 构造器
> （新断言里别用 new URL）；⚠️ 待人工验证：真 7h 过夜（0.2 节清单：电源永不睡眠+
> 标签页前台，早上对账值守统计与 jsonl 行数）、真机断网 5 分钟后字幕自愈。
>
> **09-18 过夜全面升级（前端 v3 + 演讲人视图 + 日报 + /metrics + 清理）**——
> ① **前端美学 v3**：style.css 整份重写（选择器零丢失已 diff 校验）——全站冷蓝灰残留
>   （rgba(26,26,40,…) 族/#12151f/#2b3550/#9fb0cd 等）全部换成暖墨系 token（--glass 族）；
>   演讲者视图重构=大画面独占第一行（1fr）+其余压成底部胶片条（16:9、≤150px）；
>   说话人=鎏金呼吸金环；卡片/画面格入场动画 + prefers-reduced-motion 降级；
>   成员行 CSS 伪元素头像圆片；宫格/演讲者布局语义修正（tile-main 的全宽规则圈定在
>   演讲者视图，宫格恢复"所有人一样大"，tile-main 只剩金环标记）；
>   index.html 版本参数 v=20260918；**真浏览器截图验证**：登录卡/预览页/房间/演讲者全过；
> ② **演讲人交接迟滞补完**（并行规划的半成品收尾）：audio-levels 防抖已在（SPEAKER_HOLD_MS
>   坐稳 1.5s 才交接、含安静回退），本次修好冒烟断言的"死元素"问题（D6 段 tiles 已被
>   resetMediaState 清空，断言前要补订活格子——实修写入注释）；**顺带挖出真 bug**：
>   attachRemoteMedia 复用分支按 key 前缀抓格子会抓到屏幕格并把 source 改写成 camera
>   （元数据腐蚀，"关摄像头再开"必踩）——已改为按 box 匹配（坑 32）；
> ③ **C1 值守日报（第 31 步）**：字幕历史抽屉「📋 日报」→ 服务器归档(format=json)+内存窗口
>   合并全档 → 纯本地统计出 markdown 日报（时长/说话人占比条形/每小时活跃/值守健康），
>   Blob 下载 report-<房间>-<ts>.md；零 LLM 永远可用，与 N2（LLM 纪要）互为兜底；
> ④ **G7 /metrics 落地（零依赖版）**：GET /metrics 用 snapshotRooms() 手拼 Prometheus 文本
>   （rooms/members/producers/consumers/producer_bytes_total/recordings/uptime/rss）；
> ⑤ **dashboard.html 暖化**（冷蓝 → 暖墨 + 鎏金曲线）；
> ⑥ **项目清理**：git rm 9 个 config.json.bak-* 与 .reasonix/工具数据（已入基线可找回）、
>   删 SELFTEST 录制与运行时产物、.gitignore 补 bak/reasonix 条目、**修 start-lan.bat 路径 bug**
>   （cd /d "%~dp0.." 会跳到上级目录）；
> **回归（本次实测）**：信令 **73/73**（+1 /metrics）+ 冒烟 **91/91**（+4：日报、迟滞两拍、
> 回退）+ 浏览器截图四屏全过；坑 32 入册。
>
> **09-19 继续奔跑（丝滑化 + 跨网审计 + G7-②③）**——
> ① **演讲人视图丝滑化（用户反馈"说话人过大/切换生硬"）**：大画面从 stretch 撑满改为
>   **16:9 contain 居中**（width:100% + max-height + aspect-ratio，place-self:center）；
>   applyLayout 拆两层（applyLayoutDOM 纯标记 + applyLayout 管"布局签名"），签名变了才包
>   **View Transitions API**（document.startViewTransition，0.25s crossfade，Chrome 111+ 零依赖；
>   不支持/reduced-motion/签名没变走直通——audio-levels 每 400ms 一 tick 不产生过渡开销）；
>   全局 scroll-behavior: smooth；浏览器实测 startViewTransition=function 可用；
> ② **跨网直连审计（用户点名"跨网网络问题"）**：代码链路无 bug（listenIps/announcedIp/
>   iceServers 下发/防火墙放行全在），**根因 = announcedIp 是内网 IP + 会漂移**——
>   doctor 实测抓到 config 里 192.168.170.194 已过期（本机已变 192.168.127.194），已修；
>   **技术澄清（写进部署手册）**：SFU 媒体不走 TURN，跨网唯一决定因素 = announcedIp 跨网可达，
>   场景 B 重写为四方案：**B-1 Tailscale 组网（零成本首选）** / B-2 云机 / B-3 端口映射 / B-4 自检；
>   start:lan 输出加 Tailscale 三步提示；防火墙放行需管理员（命令已给用户）；
> ③ **G7-② 结构化日志 ✅**：logEvent(level,event,fields) → sfu/logs/app-YYYY-MM-DD.jsonl
>   （JSON Lines，console 人读照旧），8 个埋点（建房/销毁/进出/踢人/授权/录制起停）；
>   埋点踩坑：disconnect 清理作用域里房间号是 socket.roomNumber 不是 roomNumber
>   （错一次 = 服务器在成员离开时崩溃，信令回归真跑才抓到）；
> ④ **G7-③ watch.js ✅**：npm run watch（--interval/--max-rss/WATCH_WEBHOOK_URL 可配），
>   四规则（服务拉不到/健康分<4/宽限<10s/rss 超限），同类告警 5 分钟限流；首轮实测即
>   抓到 3 个测试遗留宽限房间；
> **回归（本次实测）**：信令 **74/74**（+1 G7-② 日志断言）+ 冒烟 **91/91**；
> 待用户拍板：跨网形态（Tailscale/云机/端口映射）——问题卡已留在部署手册+对话。
>
> **09-19b 三连（白板 v2 + Otter 字幕节奏 + AI Bot 参会者✅）**——
> ① **白板 v2「宣纸 editorial」**（参考 recent.design igochi 案例的黑白极简+杂志排版）：
>   色板换水墨五色（墨/朱砂/鎏金/黛蓝/竹青）、纸张=暖纸白+四缘渐晕+SVG 颗粒（纯 CSS）、
>   头部 hairline 细线；② **字幕历史抽屉改 Otter.ai 排版节奏**：连续同说话人合并成段
>   （段头=名字+段首时间，段内每句一行），最新句 .now 鎏金左线高亮——分组状态从 DOM 自身
>   推断（dataset.speaker），全量渲染与逐条追加同一条路径；冒烟断言按"段"语义重写；
> ③ **AI Bot 参会者 ✅（AI 主攻线 C 档落地第一站，零依赖）**：
>   身份=room.aiBot→room-state 注入 isBot 虚拟成员（成员列表 🤖 行"聆听中…"，控制坞
>   「🤖 AI」按钮开关、快照驱动全房同步）；**耳朵=服务端音频管线**（每路音频
>   PlainTransport→consume→本机 ffmpeg astats RTP 旁路，2s 解析 RMS 记 aiHearing——
>   服务器第一次真正拿到会议音频字节流，N2 真转写就在此插转写器）；**嘴巴=ai-ask 问答**
>   （聊天发 @ai 前缀或 ai-ask 信令→aiBrain：有 DEEPSEEK_API_KEY 走 DeepSeek 真 LLM
>   （纯 fetch），无 key/失败降级本地模板带 [Mock] 前缀（AI 双轨约定）→chat-message
>   (from=ai-bot) 金边气泡广播全房）；**实测**：信令 81/81（+7 AI 断言）+ 冒烟 95/95
>   （+4）+ 真机全流程过（邀请→🤖 行→@ai 提问→金边气泡应答）；
> **新坑 33**：浏览器端"不带回调"emit（ai-join）× 服务器 ok(callback) 无守卫 = 整服崩溃
>   （坑 13③ 变体，已把 ok/fail helper 统一加 typeof 守卫一劳永逸）；
>   另：server 没有 client 的 shortId helper——AI 块里臆造即 ReferenceError（坑 14
>   "别把两版搞混"函数级变体，已加 aiShortId 本地 helper）。
>
> **09-19c N2 纪要骨架 + G3 录制回放 ✅（持续升级）**——
> ① **N2 会议纪要（分段+终稿，DeepSeek/[Mock] 双轨）**：buildMinutes 合成器吃字幕账本
>   （loadCaptions 抽成公共函数）+ 发言统计 + **待办关键词规则抽取**（需要/记得/下周/跟进…
>   ——无 LLM 也能捞出大半待办）；有 key 走 DeepSeek 出要点/待办/结论，无 key/失败降级
>   本地模板（尾注 [Mock]）；落盘 sfu/minutes/<房间>/<时间戳>-<分段|终稿>.md；
>   **三个触发**：ai-minutes 信令（手动）/ bot 在场时每 MINUTES_INTERVAL（config.
>   minutesIntervalSec，默认 1h）自动分段纪要+聊天播报 / ai-leave 与 destroyRoom 自动终稿；
>   HTTP：GET /api/minutes?room= 列表 + GET /minutes/<room>/<file> 下载（房间号+文件名
>   双白名单钳路径穿越）；@ai 问"纪要/总结"直接生成并回路径；
> ② **G3 录制回放 ✅**：GET /api/recordings 列表 + sfu/public/recordings.html（零依赖暖墨
>   回放页：列表+<video> 播放+下载）+ dashboard 三个入口链接；真机验证：test:record 产物
>   在列表出现、点击播放 duration=4.0s 自动播——"录了能看"闭环；
> ③ **test:record 竞态修复**：媒体引擎就绪（0.1s）比 probeFfmpeg（异步 500ms）快时
>   FFMPEG_OK 还是 false → 自测误报"ffmpeg 不可用"；自测前先等探测收敛（最多 3s）+
>   深扫兜底；
> **回归（本次实测）**：信令 **86/86**（+5：纪要生成/下载含待办/列表/穿越钳制/录制列表）+
> 冒烟 **95/95** + test:record **PASS**（251KB/4.0s）。
>
> **09-19d 舒适性打磨 + 架构内存优化 + LEARN 代码地图**——
> ① **前端"去人机"打磨层**（style.css 第 23 节）：控制坞两根分组竖线（"离开"单独一档、
>   反应区单独一档）、按钮按压回弹 scale(.965)、预览/房间 hero 行高呼吸+进入按钮全宽压轴、
>   聊天输入区贴底色、字幕条边框减淡、气泡投影含蓄化、placeholder 文案口语化；
> ② **架构内存优化（长跑总纲落地）**：log() 400 行环形上限（过夜几万行曾会 O(n²) 撑爆
>   textContent）、chatList 300 条 DOM 环形上限、**日志面板可折叠**（点标题切 .collapsed +
>   .app.log-collapsed grid 行收缩 148→36px，演示给画面让位）；总纲="内存热窗口+文件权威副本"；
> ③ **LEARN 5.24「代码地图」教学章**（用户点名"详细让人学会"）：三份运行时代码职责表+
>   为什么单文件分区的架构取舍话术、四个平面数据流图（信令/媒体/SCTP/HTTP）、
>   功能速查表（功能→文件→LEARN 节）、**新功能接线七步清单**（每次升级都在走的流程），
>   按症状查的调试路径表、内存与长跑实录；
> **回归（本次实测）**：冒烟 **95/95** + 信令 **86/86**；真机：日志折叠后画面大幅扩大、
> 控制坞分组清晰。
>
> **09-19e 去 AI 味·图标化与克制化（用户反馈"AI 味还是重"，直击观感根源）**——
> ① **彩色 emoji 全面换单色线性 SVG**（重灾区）：控制坞 10 个按钮、顶栏四徽标、
>   成员行徽标六种（👑🖥️🔇🚫✋💬→crown/screen/micOff/camOff/hand/cc）、成员行小按钮
>   （⏺⏹📎🚪）、AI bot 行——统一 24 viewBox 手绘 path、stroke=currentColor 随按钮状态
>   变色；client.js 新增 `ICONS` 常量集 + `setIconBtn(btn,icon,text)`（动态改文本的按钮
>   统一走它，innerHTML=icon+span 结构，与 HTML 静态按钮同构）；reaction 区 emoji 保留
>   （表情本身就是 emoji，语义正确）；
> ② **渐变/玻璃克制化**：primary/send/danger 按钮纯色化、brand-name/auth-title 渐变字→
>   纯鎏金、印章纯色；backdrop-blur 只留顶栏/控制坞/字幕条三个真悬浮层，其余全部实底；
>   圆角收紧（radius-lg 14、video-box 10、controls 14）、border-strong .38→.26、shadow-2 减淡；
> ③ **白板色板带名字**：BOARD_COLORS 改 {v,n} 数组（墨/朱砂/鎏金/黛蓝/竹青——
>   色点 title 从"这个颜色"变成色名）；
> ④ **测试适配**：桩 innerHTML/textContent 不聚合（坑 27 家族）——4 处按钮态断言从
>   textContent 改 innerHTML（真浏览器两端语义一致）；
> **回归（本次实测）**：冒烟 **95/95** + 信令 **86/86**；DOM 断言：控制坞 10 个 .i 图标、
> 2 根分隔线、徽标纯文字全过；真机特写：单色图标+纯色朱砂按钮+分组竖线=产品感。
>
> **09-19f SFU 深造（多 Worker + 信令压测）+ 清理**——
> ① **G1-② 多 Worker 横向扩展 ✅**：workers 数组 + startOneWorker（died 摘除+5s 补位）
>   + pickWorker 轮询；CONFIG.workerCount / MEDIASOUP_WORKERS 控制，默认 1 行为不变；
>   `worker` 变量保留=workers[0]（TEST_RECORD/快照零改动）；/metrics 加 sfu_workers；
>   实测 Workers×2 三房分到两 Worker（轮询生效）；**实修坑：Router 无 .worker 引用，
>   pick 时记 room.workerPid**；② **G8-③ 信令压测 ✅**：scripts/bench-signaling.js
>   （npm run bench:signaling）——32 客户端 4 房实测连接 32/32、ping RTT p50=3ms/
>   p95=6ms/max=8ms、聊天广播放大 17.8×；诚实声明：压信令面，媒体面看 bench.js；
>   配套 ping 探活信令（RTT 探针+运维双用）；③ **清理**：recordings/minutes/captions/
>   logs 运行时产物全清（gitignore 已覆盖），临时注入脚本已删；
> **回归（本次实测）**：信令 **88/88**（+2：sfu_workers gauge/ping 回显）+ 冒烟 **95/95**。
>
> **09-19g C1 AI 远程操作员 ✅（AI 主攻线第二条主线落地）**——
> **核心设计：AI 与人类控制端协议层完全平等**——服务器自开真实 socket.io 客户端
> （botSocket），走与人类一模一样的 remote-request→授权卡→remote-answer→
> remote-input 门禁→remote-release；**授权绝不豁免**（可拒绝/限时，被控端审计照记）。
> ReAct 教学版="计划-执行"（LLM/Mock 双轨把目标翻成操作 JSON：move/click/dblclick/
> type/key；Observation 回环留升级点）；帧编码在服务器端（DataView 大端→Buffer *BE）；
> 入口=控制坞「🛰️ AI 操作」按钮 + @ai"操作/打开…"关键词；执行中 busy 互斥+30s 总
> 超时保护；实修三条：botSocket 每任务全新连接（复用=状态残留迷路）/授权等待独立 5s
> 超时（30s 等授权会占死互斥锁）/回放侧零改动（协议层平等的红利）；
> **回归（本次实测）**：信令 **93/93**（+5 C1 全链路断言：无共享拒绝/受理/真实授权/
> 输入序列含 16 字节帧/自动交还）+ 冒烟 **95/95**。
>
> **09-19h~09-26 过夜连跑（G6 安全 + G7④ 留存 + G8① 扇出基准 + 头像系统）**——
> ① **G6 安全加固 ✅**：token 生命周期（AUTH_TTL_MS 可调/滑动续期/auth-refresh 信令/
>   client 每小时续期）+ 四处固定窗口限流（register/login/join/chat）+ /config.json
>   下发 authTtlMs（回归用短 TTL 实测过期路径）；② **G7-④ ✅**：dashboard 采样
>   localStorage 留存（刷新曲线不丢，真机 5→7 点验证）；③ **G8-① ✅**：bench.js
>   加 --fans 扇出维度——16 发×32 收 18003kbps、丢包 0%、单核 6%（"1 主讲 N 观众"
>   的真实负载）；④ **bench-signaling 监听器累积 bug 修复**（chatRecv 虚高）；
> ⑤ **★ 09-26 头像系统 ✅（apple-avatar 素材集落地）**：users 表 avatar 列幂等迁移；
>   注册九色预设自选（青黛/朱砂/黛蓝/竹青/海棠/玄墨/黛紫/石青/墨竹）+ 登录/verify
>   返回 + bindIdentity 贯通 + room-state 投影；**AI 五态动态头像**（idle/thinking/
>   speaking/happy/listening）由 ai-state 广播驱动状态机——AI 格子进视频网格
>   （speaking 金环呼吸/thinking 浮动）+ 成员行动态小图，AI 助理成为"看得见的参会者"；
>   TTS 复用既有 09-25 语音系统；**LEARN 5.27 反思复盘章 + 5.28 头像系统**新增；
> **回归（本次实测）**：信令 **153/153**（G6 5 断言含短 TTL 过期实测 + 头像链路 4 断言）
> + 冒烟 **159/159**；实修坑：迁移块误插 SQL 模板串/innerHTML 重建冲掉头像 img/
> 桩 querySelector 自动造元素（坑 27 家族）/bindIdentity 子串替换吞锚点。
>
> **09-26b AI 助理深化三连（用户反馈：头像难看/字幕僵硬/要能叫名接话）**——
> ① **矢量动画头像 v2**：素材 apple-avatar/gufeng/handdraw 丫髻童子——内联 SVG
>   五态靠眼形(睁/弯)与嘴形(笑/张/平)显隐切换+CSS 呼吸/眨眼/摇头关键帧（静态 PNG
>   切换退役）；`aiAvatarSvg(st,cls)` 生成器格子/成员行共用；② **发言字幕逐字化**：
>   speaking 帧带全文（server），前端格子字幕条逐字打出（逗号 150ms/句号 320ms）——
>   Mock/LLM 两轨表现一致；实修：ai-state 监听漏传 text（逐字条静默空白）；
> ③ **唤醒词「小明」**：emitCaption 检测名字+AI 在场→整句自动 ai-ask（客户端挂点，
>   服务端音频管线无转写）；bot 显示名改「AI 小明」；断言"唯一发送点"改"两处合法
>   入口"；**回归（本次实测）**：信令 **154/154** + 冒烟 **159/159**；真机：喊小明
>   →thinking→speaking 逐字打出 RAG 诚实回答（检索不到明说，不编造）。

> **09-24b 三条新功能：真 OS 级远程桌面（B 档）+ 跨网一键发布 + SW 缓存纪律（代码已落地并已验证，本次同步文档）**——
> ① **B 档「真 OS 级远程桌面」✅（原"毕设才开、违背零依赖需拍板"作废）**：新增本地代理
>   `agent/`——`agent/cdp.js`（约 470 行，**手写 CDP 客户端**：启动真实 Chromium，`--remote-debugging-port`
>   连上，`Page.startScreencast` 抓屏 / `Input.dispatchMouseEvent`·`insertText`·`dispatchKeyEvent` 注入真输入；
>   零新 npm 依赖，用 Node 22 内置 `fetch`/`WebSocket`）+ `agent/index.js`（约 430 行，被控端主体，
>   复用根 `node_modules` 的 socket.io-client；CLI `--room --server --password --name --url --port
>   --profile --quality --fps --minutes --auto-allow --headless`；`npm run agent` 或
>   `node agent/index.js --room 123456`）。**为什么必须有本地程序**：浏览器安全模型不允许网页移动
>   真实光标 / 敲真实键盘 / 截别的窗口——所以商业远程桌面全要装被控端。CDP 只控 **Chromium 窗口内部**
>   （控不了开始菜单/记事本，定位"远程浏览器工作区"，边界已写进文档）。
> ② **新信令 + 三道闸门**（`sfu/protocol.js` 09-24 段 + `sfu/server.js`）：`agent-hello`（代理进房，
>   置 `socket.isAgent=true`、名字加 `🖥️ ` 前缀、写 agentInfo；三道校验与 join-room 一字不差，
>   **代理无特权**、人数满同样被拒）/ `remote-frame`（被控端→S→控制端，二进制 JPEG，`volatile` 发）/
>   `remote-meta`（真实 URL/标题/视口，普通 emit，状态消息不能丢）+ 控制输入**复用既有 `remote-input`**
>   （16 字节帧格式不变，agent 新增 `navigate`/`window` 两种走老通道的新语义）。
>   **服务端三道闸**：① 身份闸（`isAgent` 才准发帧，人冒充不了代理）② 授权闸（帧只发给登记的
>   host→controller 这一对，不旁路第三人）③ 体量闸（单帧 >900KB 丢 + 120 帧/秒限流 + volatile 不排队）；
>   原则一句话 **"信任 ≠ 免检查"**。授权链路与人类被控端**完全同构**（服务器不认识 agent 特权）。
> ③ **📱 手机控电脑（本次重点）**：`sfu/public/` 新增全屏 `#rdConsole`（canvas 画画面 + 地址栏 +
>   工具条 + 隐藏 IME 捕获框）；成员列表代理行带 `🖥️` 前缀 +「可被控」徽标 +「控制电脑」按钮。
>   canvas 交互**全部用 Pointer Events**（一套逻辑覆盖鼠标/触摸/触控笔）：单指=鼠标、**双指=滚轮**
>   （两指中点位移换算；自己维护"当前几根手指"账本，第 2 指落下时撤销第 1 指已发的 mousedown，
>   否则远端一直"按住"）、中文走隐藏输入框整段转发 + CDP `Input.insertText`（绕开 IME）。
>   **真机实测**：双窗验证被控端真实 URL 变 `https://example.com/`、坐标逐像素精确
>   （视口 1254×707，期望 627,297 = 实际 627,297）、手机双指让被控端 `scrollY 0→1000`、单指点击触发真实按钮。
> ④ **跨网一键发布 + ICE 下发**：根因澄清——Mesh 版是 **P2P**，"跨网连不上"的根因是 **ICE 打洞**
>   不是服务器（原来 `public/client.js` 把 ICE 硬编码成一条 Google STUN，严格 NAT 必挂）。
>   修法：根 `server.js` 加可选 `mesh.config.json`（`port`/`host`/`iceServers`/`publicUrl`，优先级
>   环境变量 > 文件 > 默认）+ `/config.json` 路由下发（带 `no-store`）+ 启动 ICE 自检（无 TURN 警告）；
>   根 `public/client.js` 加 `ICE_SERVERS`/`iceReady`（`fetch('config.json',{cache:'no-store'})`，失败回落
>   默认 STUN），**建 peer 前一律 `await iceReady`**（防"第一条 peer 用错配置"时序坑）。
>   新增 `scripts/publish.js`（`npm run publish:mesh`）四段：**生成**（白名单拷贝 + 写 package.json，
>   **每次清空重建、副本永不漂移**）→ **写 mesh.config.json**（默认 openrelay 公共 TURN）→ **体检**
>   （真起一次 PORT=18081 验 `/config.json` 下发含 TURN 的 ICE、首页/client.js 可访问、带 no-store）→
>   可选 `--tunnel`（探 cloudflared > ngrok，都没有就打印三条路）/`--bundle`（把 socket.io 拷进发布包）/
>   `--check`（只读自检、过期退出码 1）。⚠️ **隧道只解决"网页能打开"，音视频是 P2P 的，要真开会还得有 TURN**。
> ⑤ **★ 坑 40：Service Worker 缓存旧代码**（本次最有教学价值）：改了 `sfu/public/client.js`/`style.css`
>   刷新死活不生效，服务器发了 `no-store`、DevTools 也是 200，页面还跑旧代码——根因 **SW 完全不看
>   HTTP 缓存头**：旧 `sw.js` 把 client.js/style.css/workbench.html 一并 cache-first 预热，绕过了
>   `no-store`；且 SW 只在 **sw.js 自身字节变化**时重装，业务代码天天改、sw.js 不动，旧缓存一直管着页面
>   （"记得 bump 版本"寄希望于人的纪律——被忘了）。修法：按资源性质分两路——**不变的**（vendor/图标/
>   manifest）cache-first，**会变的**（client.js/style.css/页面）**network-first**（在线永远最新）；
>   版本语义随之清楚（改业务代码**不用** bump，换 vendor 才 bump），缓存名 `meeting-v1→v2`；
>   client.js 加**逃生舱** `?nosw=1`（当场注销所有 SW + 清 Cache Storage + 重载）。
>   **测试侧教训**：e2e 原本复用持久化 profile，而 **CDP 的 `Network.setCacheDisabled` 管不到 SW 的
>   Cache Storage** → 测的是缓存不是代码；修法：每次运行前清空 profile 目录。
> ⑥ **回归（本次实测）**：`npm run test:agent` **16/16**（真起 Chromium：抓屏 JPEG 魔数 + 归一化坐标
>   ±3px + 真实点击 + 中文整段 + 滚动 + 远程导航 + 撤权停帧 + 无孤儿进程）+ `npm run test:e2e`
>   **15 项全过**（真双窗 + 390×844 手机视口：双指滚动 `scrollY 0→1000`、单指点击、抽屉开合，
>   截图落 `wb-rd-shots/`）+ `npm run test:publish` **29/29**（含 `--check` 过期闸"源码改了不重发必报错"）；
>   导读 `LEARN.md` **5.29~5.32**；`sfu/protocol.js` 新增 09-24 段契约。
> ⚠️ **待人工验证（命令行/自动化验不了，已进 `后续升级方向.md` 0.2）**：**真机手机端参与会议的真实观感**、
>   **cloudflared 真实开隧道**（本机未装，`--tunnel` 只验证了"探测 + 给三条指引"）、
>   **跨运营商真机跨网通话**（ICE/TURN 终极验收）、**手机控电脑真机触屏手感**。
>
> **09-24 AI 会议助理真上线 + 三处实修（按 `后续升级方向.md` 第 1 节主攻，本次有真 LLM key）**——
> ① **密钥托管与统一 Provider（新文件 `sfu/ai/provider.js`）**：原来 server.js 里三份
>   重复的 DeepSeek fetch（aiBrain 问答 / llmPlan 操作员计划 / llmMinutes 纪要）各写各的
>   超时与降级，现在统一入口 `askLLM()` / `streamLLM()`；取值优先级 = `DEEPSEEK_API_KEY`
>   环境变量 > 项目根 `.env`（新加，已入 .gitignore）> `sfu/config.json` 的 `ai.key`；
>   **密钥永不下发浏览器**（`/config.json` 只给 `aiEnabled` 布尔值，有断言守着）；
>   内置**用量账本**（调用/成功/失败/Mock/tokens/估算花费），已并入 `/metrics`
>   （`sfu_ai_llm_*` 七组）。
> ② **三条产品化升级**：**流式打字机**（新信令 `ai-stream`，SSE 增量边吐边渲染，终态再补一条
>   chat-message 兜底去重——同"字幕容忍丢 / 问答不容忍丢"的双路哲学）；**助理缺位自动入会**
>   （以前 @ai 要成员先点「🤖 AI 助理」按钮，答不了还 fail，反直觉）；**📝 纪要入口**
>   （字幕条右侧按钮 → ai-minutes → 气泡里直接给 /minutes 下载链接）+ LLM/Mock 模式徽标与 token 用量。
> ③ **教学三件套脚本落地**（路线图 1.0 的阶段 0/1/2）：`scripts/chat.js`（终端问答）、
>   `scripts/summarize.js`（map-reduce 长文本纪要，导出 `summarize()`）、`scripts/agent.js`
>   （手写 ReAct 工具循环，带三个只读工具）+ `npm run test:ai` **双轨自检**（Mock 轨永远跑、
>   LLM 轨有 key 才跑，当前 **10/10**）；另有 `npm run ai:chat / ai:summarize / ai:agent`。
> ④ **实修三个真 bug**（都是"复现过才敢改"）：
>   - **announcedIp 漂移致命**：config.json 里 192.168.127.194，本机实际 192.168.209.194，
>     旧版只打印告警、**仍用错 IP 通告浏览器**（跨机一律黑屏，且无任何运行时报错）→
>     改为三层取值 + **自动回退本机真实网卡 IP**（私网优先），延迟满足可靠性而非可配置性；
>   - **ffmpeg 探测误判**：500ms 超时在"启动同时拉 Worker 子进程"的机器上必然超时（真复现过一次），
>     装了 ffmpeg 却宣布"未检测到"→ 超时放宽到 2.5s + 超时重试 + **区分 ENOENT（真没装）与超时**；
>   - **test:record 稳定红 EBUSY**：罪魁**不是文件锁**而是 Windows 上 Node 的 `spawnSync`
>     与未排空的子进程 stdio 相冲（同一文件在 shell 里 ffprobe 秒出）→ 改异步 `execFile` +
>     三次重试，连跑 3 次全 PASS。
>   - 顺带修一条 **AI 动作错位**：「@ai 生成纪要」原本写在 Mock 分支里，**配上 key 之后 LLM
>     抢先答一句漂亮话，纪要文件根本没生成**（用户看到的是"AI 答应了"）→ 动作型意图在进 LLM
>     之前先路由（tools-first）。
> **回归（本次实测）**：冒烟 **118/118**（+11）+ 信令 **106/106**（+8，两条轨道都绿：
> 有 key=LLM 轨、无 key=Mock 轨分别跑过）+ Mesh **33/33** + test:ai **10/10** + test:record PASS；
> 导读 LEARN.md **5.28**；⚠️ 待人工验证：真浏览器打字机观感、跨机画面（announcedIp 自动纠偏后）、
> 纪要质量（真开会 10 分钟）、操作员演示（有 key 后走 LLM 计划而非 Mock 脚本）。
>
> **09-24 账号上真数据库 + 门禁边界修正 + 房间内令牌 + 优雅退出（代码已落地，本次为文档同步）**——
> ① **存储层：Node 内置 `node:sqlite`（零新依赖）**：新增 `sfu/store.js` 取代 `sfu/users.json`——
>   库文件优先级 `DB_FILE` 环境变量 > `config.json` 的 `dbFile` > 默认 `sfu/data/meeting.db`；
>   `PRAGMA journal_mode = WAL`（读不挡写、写不挡读）；两张表 `users(username PK, salt, hash, display_name,
>   role, created_at)` + `audit(id PK AUTOINCREMENT, ts, kind, actor, detail)`（+ `idx_audit_ts`）；
>   导出 `getUser/createUser/listUsers/setUserRole/setPassword/deleteUser/countUsers/hasAdmin/appendAudit/
>   listAudit/integrityCheck/closeDb` 与常量 `DB_FILE/LEGACY_USERS_FILE`。
>   **旧 users.json 首次启动自动整表迁移**——**原样保留 salt/hash、绝不重新哈希**，搬完把旧文件改名
>   `users.json.imported-<YYYYMMDD>` 备份保留不删。实况：迁移 69 个账号（其中 **61 个是测试脚本历史遗留垃圾账号**
>   `a_XXXXXX`/显示名"爱丽丝"），清理前整库备份 `sfu/data/backup-<时间戳>-before-cleanup.db`，**现库中 9 个账号**；
>   首个管理员 **`Guoge`**（此前库里 0 个 admin，导致 `/dashboard`、`/metrics` 对所有人 401）。
> ② **口令方案抽成单一实现 `sfu/password.js`**：`SALT_BYTES/KEY_LEN/newSalt/hashPassword/verifyPassword/randomPassword`，
>   方案 `scrypt(password, salt, 32) → hex`（每账号 16 字节随机盐），校验用 `crypto.timingSafeEqual`。
>   原本 server.js 与 scripts/admin.js 各"照抄"一份，参数一漂移就导致 CLI 建的账号在网页上**永远登不上**、
>   还只报"用户名或密码不对"；现两边 require 同一份，**用结构消除漂移（而非靠"记得同步改"）**。
> ③ **管理员 CLI `scripts/admin.js`**（`admin:list/grant/revoke/adduser/passwd/purge`，注意 `--` 透传参数）：
>   `purge` **默认只干跑、显式 `--yes` 才真删**；`deleteUser` 内置**拒绝删除库里唯一管理员**的安全闸；
>   `passwd` 是"忘记密码"的本地可信通道（教学版无邮件重置）；角色存在库里，但 token 带的是"签发那一刻的角色"，
>   **提权后需重新登录**新 token 才是 admin（换来 HTTP 门禁"零数据库查询"）。
> ④ **★ HTTP 门禁边界（本轮最重要的修正）**：接口分两类——
>   **甲类·观测**（`/api/rooms`、`/metrics`、`/api/recordings`）上 `requireAdmin`；
>   **乙类·内容**（`/api/captions`、`/api/minutes`、`/minutes/<6位房>/<文件>.md`）**不加 admin 门禁**——
>   理由：本产品允许**游客进会**，而字幕归档由 `client.js` **自动**调用（游客没 token）——
>   若给乙类加 admin 门禁，游客的字幕归档会**静默失效**（功能坏了却只在控制台留一行日志）；
>   **第一版曾误加门禁，复核时发现这条已回退**。token 取法：`Authorization: Bearer <token>`（首选）/
>   `?token=<token>`（浏览器地址栏、`<video src>` 兜底，代价是进 URL 历史与访问日志）。
>   `/dashboard` 页本身不设门禁（否则页面都打不开、没法提示去登录），它调的 `/api/rooms` 才受门禁。
> ⑤ **自签证书 SAN 自愈**：浏览器早已不看 CN（RFC 6125），自签必须带 SAN——改为"**证书缺失 / 无 SAN /
>   SAN 未覆盖当前局域网 IP**"三种都重新生成（修 DHCP IP 漂移导致"只判有没有 SAN 就永不重签"），
>   SAN 写入**所有**检测到的本机 IPv4（WLAN + 有线）并保留旧证书已有 IP。实测 SAN：
>   `DNS:localhost, IP:127.0.0.1, IP:192.168.74.194, IP:192.168.116.194`（10 年期自签，`sfu/tls/`）；
>   顺带修正 `config.json` 漂移的 `announcedIp`（`192.168.127.194` → `192.168.74.194`；取值优先级
>   `MEDIASOUP_ANNOUNCED_IP` > `config.json`（须是本机某网卡 IP） > 自动探测，配过期私网 IP 会告警并自动改用真实网卡 IP）。
> ⑥ **优雅退出（此前完全没注册信号处理器）**：`SIGINT`/`SIGTERM`/`uncaughtException` → 关所有 Worker →
>   停收新连接 → `store.closeDb()`（做 WAL checkpoint）→ 正常退出；**幂等**（连按两次 Ctrl+C 第二次直接退）+
>   **5 秒保险丝**兜底。否则 Ctrl+C = 进程暴毙 → Worker 变孤儿继续占 40000-49999 端口、WAL 堆积、录制中的 ffmpeg 被硬切；
>   顺带用 `shuttingDown` 标志修掉"正常退出却被当成 Worker 崩溃"的日志噪声。Windows 上外部投递不了 SIGTERM
>   （无 POSIX 信号，`process.kill` 走 TerminateProcess 等于直接暴毙），故加自测钩子 `TEST_SHUTDOWN_AFTER_MS`
>   （沿用 `TEST_RECORD` 约定）让这条路径可自动化验证。
> ⑦ **测试隔离纪律（本次最关键的一条）**：账号类测试一律用 `DB_FILE` + `USERS_FILE_LEGACY` 指到临时目录，
>   **绝不碰真实库**（`test-store` 有硬断言自证：真实 `sfu/users.json` 逐字节一致、`sfu/data/` 下没建库）；
>   根因是此前测试直接往真实 `users.json` 注册账号、累积了 61 个垃圾账号；注册限流也挪到**写库之前**；
>   另修 `test-sfu-signaling.js` 的 `httpReq` 默认带管理员 token、会掩盖"游客视角"回归的问题，加 `noAuth` 开关。
> ⑧ **★ 房间内令牌 + 录像签名 URL（关闭"房间号可枚举"的弱能力缺口）**：④ 把乙类留在"能力 = 房间号"上，
>   而 6 位房号可枚举（10^6）——本轮补上**无状态 HMAC 房间令牌**给"在场的人"兜底，乙类不再裸奔。
>   · **令牌格式** `base64url(JSON{room,iat,exp}) + "." + base64url(hmacSHA256(payloadB64, SECRET))`；
>   `SECRET` = 32 字节随机 hex，持久化 `sfu/data/room-secret`（已 gitignore），首次运行自动生成、之后复用；
>   校验 `timingSafeEqual` + 未过期 + **room 与请求房号一致（跨房 401）**，任何异常 fail-closed。
>   · **为什么无状态**：令牌若存服务器内存 Map，服务器一重启（房间是内存结构、重启即没）→ 过夜值守攒下的
>   归档**早上就读不出来**；无状态令牌重启后依然有效。
>   · **TTL** 默认 **86400s/24h**（`config.json` 的 `roomTokenTtlSec`，env `ROOM_TOKEN_TTL_SEC` 优先）。
>   · **签发时机**：进房成功发给**本人**（`create-room`/`join-room`/`agent-hello` 的 ack +
>   该 socket 收到的 `room-members` 顶层字段）；**游客也有令牌**（否则游客字幕归档又静默失效）。
>   令牌存 **`socket.roomToken`**（**不挂成员对象**），`room-members`/`room-state` 成员列表均为**显式投影**
>   （逐字段写、非 `{...m}` 展开）、`/api/rooms` 快照亦无令牌——**结构上就放不进去，绝不广播他人令牌**。
>   · **门禁** `requireRoomAccess(req,res,room)`：① admin token（跨房巡检）或 ② 该房有效令牌；
>   令牌取法 `X-Room-Token` 头（首选）/ `?roomToken=` 兜底（`<a href>` 发不出自定义头），401 返回可读 HTML。
>   应用 `/api/captions`(GET+POST)、`/api/minutes`、`/minutes/*`；**甲类不变**。逃逸开关 `roomTokenRequired`
>   默认 `true`（设 `false` 退回旧的"开放"行为，供教学/调试）。
>   · **录像短时效签名 URL**：`/recordings/<文件名>` 改为 admin 或签名链接
>   `signRecordingUrl(fileName, ttlMs=3600000)` → `?exp=&sig=`（默认 **1 小时**），录制停止 ack 回 `url`
>   （**非管理员也能拿到自己的产物**）；**明确区分 401（没权限/签名错/过期）与 404（签名过了但文件不存在）**。
>   · **前端配套**：`client.js` 存 `myRoomToken`（`room-members` 存、离房清空）、三处 captions 请求带
>   `X-Room-Token`、AI 气泡「📄 打开纪要」链接带 `?roomToken=`。
>   · **诚实边界**：令牌是 **Bearer 语义**（不绑成员/IP）、24h 内泄露即可用；录像签名同理（1 小时窗口）；
>   两者**共用同一把 SECRET**（格式不同、实际不混淆，但严格说少了 domain separation）；
>   换掉 `room-secret` 会让**所有**已签发令牌与录像签名链接立即失效；`chmod 600` 在 **Windows 不生效**
>   （实际 `-rw-r--r--`，需靠目录 ACL）。
> **回归（2026-09-24 实测，全绿 = 440 项）**：`test:store` **49/49**（36→49）、`test:shutdown` **9/9**（新增）、
>   `test:sfu` **149/149**（134→149，新增门禁**边界** + **房间令牌**断言：无令牌→401 / 带令牌→200 /
>   跨房→401 / 签名篡改→401 / payload 篡改→401 / 过期→401 / 游客凭令牌可归档并回读正向回归 /
>   `/api/rooms`·`room-state`·`room-members` 三处不含他人令牌的泄露检查 / 录像 401 与 404 区分）、
>   `npm test`（Mesh）**36/36**、`test:smoke` **136/136**、`test:agent` **16/16**、`test:publish` **30/30**、
>   `test:e2e` **15/15**（退出码 0）；合计 **440**。导读新增 `LEARN.md` **5.33~5.38**。
>
> **09-23 G4 移动端/PWA ✅ + 毕设题目定名（"按后续升级方向升级 SFU 版"）**——
> ① **题目定名**：《基于 WebRTC 与 Mediasoup 的智能多人视频会议系统》（README 头部；
>   论文封面备选《基于 WebRTC 与大语言模型的智能多人视频会议系统的设计与实现》）；
> ② **G4 三件套（client.js 第 32 步 + style.css 第 25 节，纯前端零依赖）**：
>   **PWA 外壳**（manifest.webmanifest + sw.js cache-first/socket.io 绝不缓存/导航 network-first
>   断网兜底；图标=墨底金框朱砂會 1024px 落 sfu/public/icons/；服务器 MIME 表补
>   .webmanifest/.png/.svg/.json）；**移动端响应式**（≤980px 侧栏抽屉化——补真缺口：
>   原来侧栏移出画布后没有任何开关能拉出来，sideBtn+sideScrim+body.side-open；
>   ≤760px 控制坞 :has(.i) 收图标/网格 150px/字幕条上移/预览竖屏堆叠）；
>   **低带宽模式**（「省流」开关把所有远端画面锁 simulcast 最低层，复用
>   set-preferred-layers 服务器零改动；layer-changed 钩子把 ABR 升层纠回 0）；
> ③ **顺手修三件**：F6 冒烟 flaky（绿幕逐像素循环让桩帧率 10→28ms/帧，固定 500ms 跨不过
>   %24 刷新点，改轮询最多 3s）；updateLayerPicker 补 tile 空值守卫（D6 重连后迟到换层
>   通知不再炸）；信令测试头部补记"起服务器要带 AI_OP_STEP_MS=20，否则 09-19g 假失败"；
> **回归（本次实测）**：冒烟 **107/107**（+12）+ 信令 **98/98**；
> 新坑 34（sw.js 注释里 `**/socket.io` 的 `*/` 提前终止块注释——坑 26 家族第三例，
> node --check 抓到）；坑 35（冒烟桩 classList.toggle 不返回布尔，依赖返回值的代码
> 语义反转——toggle 后要用 contains 读回）；⚠️ 待人工验证：手机真机（扫码进会/装主屏/
> 横竖屏）、省流真实锁层、断网壳子渲染；另：本次"发布 Mesh 版为网页"落 publish-mesh/
> （qwenwork.host 已上线），**工作区另有外来未提交改动 scripts/bench.js +
> scripts/_patch-bench.py（之前会话残留，非本次产物，待作者处置）**。

> **09-19 AI 主攻拍板 + 路线图重构（本次只动文档、不动代码）**——用户从 G 档 8 候选中拍板
> **两条主线**：①纪要+问答（DeepSeek summarize + @AI 问答 + 值守 N2）②C1 AI 远程操作员
> （ReAct 工具循环 × 控制协议，授权不豁免）；确立 **Mock+真测双轨**约定（无 key 降级 Mock 带
> `[Mock]` 标记、回归永远跑 Mock、真 key 走 `npm run test:ai`）；`后续升级方向.md` 从 708 行
> 重构为聚焦版（完成档压成存档表，AI 主攻=第 1 节，其余 G 项=第 2 节备选池）；
> 基线复核实测：冒烟 **91/91**、信令 **73/73**；下一步 = AI 阶段 0（充 10 元拿 DeepSeek key 写 chat.js）。

---

## 1. 项目一句话定位

**简易版腾讯会议**——一个给"大四实习简历"用的 **WebRTC 教学项目**：
从零手写，浏览器原生 WebRTC + Node.js/Socket.IO 信令，**所有代码带中文教学注释**，
目标是让初学者（本项目作者）既**能跑**也能**面试讲清楚**。
配套知识 PDF（WebRTC-H5 学习路线）未随仓库保存，需时自行放入根目录。

---

## 2. 当前已完成功能（截至本文件日期，全部 ✅ 已验证）

| # | 功能 | 技术点 | 对应 PDF 章节 | 代码位置 |
|---|---|---|---|---|
| 1 | 1对1 视频通话（最早版本，已演进） | getUserMedia / RTCPeerConnection / SDP / ICE+STUN / 信令 | 3/5/6/7/8 | 历史 |
| 2 | 多人会议 Mesh（3 人，人满拒绝） | peers 字典、新人主动发 offer、定向转发 | 10 | client.js 第 6~14 步 |
| 3 | 屏幕共享 | getDisplayMedia + replaceTrack（换轨不重连） | 4.3 / 12 | client.js 第 5.5 步 |
| 4 | DataChannel 群聊 | createDataChannel + ondatachannel + 群聊广播 | 12.5 | client.js 第 15 步 + 聊天函数 |
| 5 | 房间化 | 创建房间生成 6 位号 / 凭号加入 / ?room= 邀请链接直达 / 空房自动销毁回收 | — | client.js 第 5 步、server.js C 段 |
| 6 | 入会密码 | rooms 值升为 `{ password, members }` 记录对象 / join-room 三关校验 / room-wrong-password | 14 | client.js 第 5 步、server.js C 段（LEARN.md 第 2.9 节） |
| 7 | getStats 网络监控 | pc.getStats() 读 inbound/outbound/remote-inbound-rtp，算丢包率/RTT/码率，顶部徽标三色分级 | 14 | client.js 第 16 步（LEARN.md 第 2.10 节） |
| 8 | **SFU 架构版**（独立目录） | mediasoup Worker/Router/Transport + Producer/Consumer（consume 后必须 resume）、屏幕 = 第二路 Producer、聊天走服务器广播 | 10.6 / 11 | sfu/server.js A~E 段、sfu/protocol.js、sfu/public/client.js 第 6~13 步（LEARN.md 第 5 节） |
| 9 | **SFU 版远程协助**（升级 A1，09-10） | 授权四信令照 Mesh；输入流改 `remote-input` 信令定向转发 + **服务器门禁**（非在册控制端丢弃）；控制层锚 peerScreens 屏幕格；采集/重放与 Mesh 同构 | 12 / 13 | sfu/server.js 事件 5.5/5.6、sfu/public/client.js **第 14 步**、sfu/public/workbench.html（09-12 桌面化改版，与 Mesh 版共用同一份设计；LEARN.md 5.7） |
| 10 | **中文 IME + 控制质量工程化**（升级 A2/A5，09-11，两版同步） | A2：隐藏 textarea 捕获框（`.ctl-ime-capture`）+ 两道 IME 闸门（composing/Process）+ `compositionend` 整段文本 ``{kind:'input-text'}`` → 被控端 `replayText` 一次插入；A5：鼠标/滚轮 16 字节 ArrayBuffer 帧 + `binaryType='arraybuffer'` + RTT 自适应节流（`ctlMoveSkip`）+ Mesh 版 bufferedAmount 积压丢帧；SFU 服务器 `ArrayBuffer.isView` 放行二进制（坑 16/17） | 12 / 14 | 两版 client.js 第 17/18 步（SFU 第 14 步）、sfu/server.js 事件 5.6、sfu/protocol.js（LEARN.md 2.12.7 + 5.7） |
| 11 | **远程协助深化**（升级 A3/A4/A6/A7，09-11，两版同步） | A3 剪贴板**双向**同步（新事件 `clipboard-sync`，门禁：仅"正在互相控制的一对"）；A4 远程截图（canvas）+ 分块文件传输（`file-offer/answer/chunk/end/abort`，**服务器配额校验**）；A6 限时授权（`durationMs` → 服务器 `expiresAt` + setTimeout 撤权 + `remote-ended`）+ 被控端本地审计日志 + 拉黑；A7 触屏（长按=右键、双指=滚轮） | 12 / 13 | sfu/server.js 事件 5.5b/5.8/5.9、sfu/public/client.js **第 20~23 步**、sfu/protocol.js（LEARN.md **2.13**） |
| 12 | **会议本体 + SFU 深究**（升级 D1~D6，09-11） | D1 Simulcast 三档上传 + **服务器 `startLayerMonitor` 按 consumer 丢包率自动升降层**（迟滞防抖）+ `set-preferred-layers` 手动锁层；D2 服务器端 **AudioLevelObserver** 说话人检测（`audio-levels` 广播）；D3 `enumerateDevices` + `producer.replaceTrack` 设备热切换；D4 `room-state` 快照 + `member-state` 上报 + 房主 `kick-member`；D5 canvas 合成 + WebAudio 混音 + MediaRecorder 录制；D6 断线重连（`resetMediaState` + 重进房 + 重建 Transport） | 10.6 / 11 / 14 | sfu/server.js（`broadcastRoomState`/`getOrCreateAudioObserver`/`startLayerMonitor` 等）、sfu/public/client.js **第 15~19 步**（LEARN.md **5.8**） |
| 13 | **对齐商业产品体验**（F1~F3，09-12，仅 SFU 主版本；参考声网形态、零 SDK 自研） | F1 宫格/演讲者**双布局**（大画面优先级=钉选📌>共享者>说话人（复用 D2 audio-levels）>自己；切布局只换容器 CSS 类 + `tile-main` 标记，JS 不搬 DOM）+ 📌钉选 + 双击全屏（原生 Fullscreen API）；F2 每成员**网络质量点**（服务器每 3s 量每人最差路 Consumer 丢包率 → `net-levels` 变化才广播）+ 成员行音量条/网络点；F3 **加入前预览页**（镜像预览 + 设备下拉复用 D3 + AnalyserNode 峰值试音条 + 预静音；预览与会议共用同一条 localStream；无媒体也可进房） | 12 / 14 | sfu/public/client.js **第 25~26 步**、sfu/server.js（`startNetLevelBroadcaster`/`collectMemberNetLevel`）、sfu/protocol.js、sfu/public/index.html + style.css F 档样式段（LEARN.md **5.9**） |
| 14 | **SFU 数据通道（D+1，09-12，主版本独有）** | `create-webrtc-transport` 开 `enableSctp`+`numSctpStreams`（应答多带 `sctpParameters`）；新事件 `produce-data`（必须带浏览器生成的 `sctpStreamParameters`）/`consume-data`/`close-data-producer` + 广播 `new-data-producer`/`data-producer-closed`；`room-members` 清单带老成员 `dataProducers`（晚到的人补订）；前端 `produceData`/`consumeData` + `procedata` 事件（第 6 步）；**聊天双路径**：SCTP 主路 + 信令兜底，`msgId` 去重（第 11 步 + 第 27 步）；mediasoup 数据通道是**广播**语义，"发给某人"要应用层加 to 字段（LEARN.md **5.10**） | 10.6 / 11 | sfu/server.js 事件 ⑤b、sfu/public/client.js **第 27 步** + 第 11 步、sfu/protocol.js D+1 段 |
| 15 | **"真实有用"三件套（09-13，仅 SFU 主版本）** | F4 表情回应：骑在 D+1 数据通道上的第二种消息 `{type:'react'}`，全房表情飞屏动画；**举手**：member-state 白名单加 `hand`，成员列表 ✋；**发言占比**：D2 说话人检测顺手记账 → `talk-stats` 有变化才广播，成员行占比细条 | 12 / 14 | sfu/public/client.js **第 26b 步**、sfu/server.js（volumes 记账 + talkTimer） |
| 16.5 | **F5 协作批注（09-14，仅 SFU 主版本）** | 屏幕格批注画布 + 工具条；笔迹走**独立 'annot' SCTP 频道**（多频道并存）+ `to` 定向头过滤 + 归一化坐标事件溯源重放；共享者开"我的屏幕"格；带宽估计挂进连接方式徽标（D+3 前置） | 12 / 14 | sfu/public/client.js **第 26c 步** + 第 27 步（双频道）+ 第 13 步（BWE） |
| 17.5 | **D+4 房间 TTL + 房主迁移（09-14）** | 空房进 60s 宽限期（ROOM_TTL_MS/config.roomTtlSec 可调，到期 destroyRoom 三定时器全清）；宽限内原号+密码可回归；房主离开迁给最早进房者（joinedAt 排序）；面板显示宽限倒计时 | 10 / 14 | sfu/server.js `scheduleRoomTtl`/`destroyRoom`/disconnect 迁移段 |
| 18 | **D+3 带宽估计 + VP9 SVC（09-14）** | Router 加 VP9；config `videoSvc:true` → 摄像头 L3T3 单路分层上传（回退链 SVC→simulcast→单层）；服务器侧 ABR = 丢包率 + availableOutgoingBitrate 双维度（bweCap 选层、net-levels 带 bwe、面板/网络点展示） | 10.6 / 11 | sfu/server.js `collectMemberNet`/`startLayerMonitor`、client 第 7/26 步 |
| 19 | **E5 演示包（09-14）** | `npm run start:demo` 一键起两版 + 《演示脚本-5分钟.md》讲稿（含 Q&A） | — | scripts/start-demo.js、演示脚本-5分钟.md |
| 20 | **D+2 服务器侧录制（09-15，代码就绪）** | PlainTransport RTP 旁路 → 本机 ffmpeg（-c copy）→ recordings/ 落盘（webm/mkv）+ /recordings/ 下载 + 成员行 ⏺/⏹；ffmpeg 启动探测，未装走明确提示 | 11 / 14 | sfu/server.js 事件 6.1 + sdpMediaSection、client renderMembers |
| 21 | **F7 独立协作白板（09-15，主版本独有）** | 第三条 SCTP 频道 'board'；控制坞 🖌️ 按钮开月白底覆盖层（深色笔 5 色/撤销/清空）；事件溯源重放（无 to 定向头——房间级共享画布 vs 屏幕格批注） | 12 / 14 | sfu/public/client.js **第 26d 步**、index.html boardOverlay、protocol.js |
| 22 | **F6 滤镜与虚拟背景（09-17，主版本独有，纯前端零依赖）** | canvas 三站流水线：GPU ctx.filter 滤镜 5 档 → 1/4 画布低清模糊放大=磨皮 → 绿幕/蓝幕色键逐像素抠像（墨/绢/鎏金/图片背景）；captureStream(24) 出轨 → **处理后轨顶替进 localStream**（publishTracks/关摄像头/D6 重连零改动）；switchCamera "绕着管线走"；每帧 EMA 耗时徽标（CPU 账）；预览页所见即所得 | 14 | sfu/public/client.js **第 28 步**、index.html fxPanel、style.css 第 17 节；LEARN.md 5.18 |
| 23 | **实时字幕（09-17b，AI 线 L1，主版本独有）** | Web Speech API 识别自己麦克风；interim 半句只本地跳动、final 经 SCTP chat 频道广播（type:caption，无信令兜底——可靠性按内容价值定价）；onend 自动续命 + network 降级；字幕账本 cap.log = C2 的 LLM 输入 + txt 导出 | 12 / 14 / 27 | sfu/public/client.js **第 29 步**、handleDataMessage caption 分支、captionBar UI |
| 16 | **SFU 实时观测面板（09-13，仅 SFU 主版本）** | `GET /api/rooms` 全景快照（成员/每路 Producer 累计字节+健康分/发言时长/控制权/Worker PID）+ `GET /dashboard` 零依赖面板页（2s 轮询、页面做差算实时码率、canvas 折线）；"可观测性"= 把 SFU 内部状态摆出来 | 14 | sfu/server.js `snapshotRooms()`（+ `/api/rooms`、`/dashboard` 路由在 A 段托管里）、sfu/public/dashboard.html；实测断言见 `scripts/test-sfu-signaling.js`（快照字段齐全 + 面板页 200） |
| 17 | **可达性（09-13 E1/E2 自助版 + 09-15c E1 落地 + 09-16c 一键交付）** | `sfu/config.json` 统一配置（端口/listenIp/announcedIp/ICE/HTTPS/roomTtlSec/videoSvc）；https.enabled 自动 HTTPS+wss（openssl 自签落 sfu/tls/）；ICE 经 `/config.json` 下发进两条 Transport；「🔗 连接方式」徽标（直连/STUN/TURN，悬浮显示 BWE）；`npm run start:lan` 一键局域网交付 + `npm run test:turn` 实测 ICE 可达 | 7 / 14 | sfu/server.js 配置段（`CONFIG`/loadConfig）+ HTTPS 段、sfu/public/client.js `initSFU()`/`monitorNetwork()`、scripts/start-lan.js、scripts/test-turn.js；文档《部署手册.md》《跨电脑连接-操作指南.md》 |
| 24 | **登录/注册（09-16，主版本独有，零依赖）** | users.json + 内置 `crypto` 的 scrypt(盐) 哈希（**不引 bcrypt**）；`auth-register`/`auth-login`/`auth-verify` 三信令 + 内存 token（重启失效是教学取舍）；前端登录卡（可"游客进入"）+ localStorage 自动恢复；**昵称贯通**成员列表/聊天气泡（信令与 SCTP 双路都带 name）；错密码与"用户名不存在"统一提示（不泄露） | — | sfu/server.js `authTokens` Map + 事件 `auth-register/login/verify`、sfu/public/client.js 第 2.5 步（登录卡）+ 昵称透传、authOverlay UI |
| 25 | **E1/E2 一键跨电脑交付（09-15c/09-16c/09-16d）** | openrelay 免费 TURN 预置（config.example.json）+ `deploy/coturn/` 自建包；`npm run start:lan`：探局域网 IP → 备份旧配置 → 生成 config（0.0.0.0+announcedIp+HTTPS 自签+TURN）→ 自动 netsh 放行防火墙 → 打印三地址；`/config.json` 下发 `lanUrl` 让邀请链接跨机可用 | — | scripts/start-lan.js、deploy/coturn/*、start-lan.bat；实测：HTTPS `https://<局域网IP>:3443` 返回 200 |
| 26 | **E4 性能基准数字（09-16c）** | 三档（4/8/16 路）媒体转发实测：16 发 16 收 8263 kbps、单核 6%、零丢包；ffmpeg 合成源 → PlainTransport → mediasoup 转发 → dgram 真收包统计（不依赖浏览器） | — | scripts/bench.js（`npm run bench`）、性能测试报告.md |
| 27 | **过夜值守 C3-N1（09-17e，AI 线 L 线长跑，主版本独有）** | 睡前开字幕挂 ≥7h：账本溢出归档（内存热窗口 + `sfu/captions/cap-<房间>-<日期>.jsonl` 权威副本 = G2 的 LLM 输入）；network 指数退避 + 30s 看门狗自愈；值守统计/心跳；导出合并全档；`npm run soak` 耐久自测（默认 7h/可压缩/对账一条不丢） | 12 / 27 | sfu/public/client.js **第 30 步**、sfu/server.js `/api/captions`、scripts/soak.js（LEARN.md 5.19.5） |
| 28 | **G4 移动端 / PWA（09-23，主版本独有，纯前端零依赖）** | PWA：manifest（.webmanifest 扩展名避开 /config.json 特殊路由）+ sw.js Service Worker（预热缓存/cache-first/socket.io 绝不碰/导航 network-first 断网兜底/版本号自清）+ 图标 icons/icon-1024.png + 服务器 MIME 表补四条；移动端：≤980px 侧栏抽屉（sideBtn 开关+sideScrim 遮罩+body.side-open 状态位——补真缺口：原侧栏移出画布后无开关）、≤760px 紧凑档（:has(.i) 图标化/网格 150px/字幕条上移/预览竖屏堆叠）；低带宽模式：「省流」开关所有远端画面锁 simulcast 最低层（复用 set-preferred-layers 服务器零改动；layer-changed 钩子纠回 ABR 升层） | — | client.js **第 32 步**、style.css 第 25 节、sfu/public/{manifest.webmanifest,sw.js,icons/}、sfu/server.js MIME 表（LEARN.md 5.27） |

| 29 | **AI Bot 参会者 + N2 纪要 + C1 AI 远程操作员（09-19b/09-19c/09-19g，主版本独有）** | 以参会者身份入会（room-state `isBot`，服务端 ffmpeg astats 音频管线"听"响度）；N2 纪要 `buildMinutes`（字幕账本 + 待办关键词规则层 + LLM 双轨，落 `sfu/minutes/<房间>/`，值守定时分段 + 离开出终稿，`/minutes` 双白名单防穿越）；C1 操作员：服务器开真实 socket.io 控制端连自己，**授权链路与人类完全同一套、绝不豁免**，计划-执行型 agent 把目标翻成 remote-input 序列（服务器端 16 字节帧编码） | 27 | sfu/server.js AI 基建块 + `buildMinutes` + `runAiOperator`、sfu/public/client.js AI 按钮/`@ai`/AI 操作按钮 |
| 31 | **★ AI 智能内核：RAG 检索 + 会话记忆 + 意图分类 + 结构化行动项 + 操作员 ReAct 闭环（09-24e，主版本独有，本轮重点）** | 新文件 `sfu/ai/brain.js`（零依赖，可单测）：**① BM25 检索器**（中文 **bigram 分词** + IDF/TF饱和/长度归一 + 时间衰减 + 说话人加成 + 证据块字符预算）——修掉"只喂最近 8 条字幕"导致**长会早期信息问不出来**的硬伤；**② ConversationMemory** 多轮记忆（环形上限 + 截断 + **指代时把上一轮问题一起检索**做廉价指代消解）；**③ classifyIntent** LLM 意图分类（替代正则，修掉"帮我整理下今天聊了啥"匹配不上→**纪要根本没生成**的能力错位；动作型高置信时短路省钱，未知标签 fail-safe 落回规则）；**④ extractActions** 行动项**结构化三元组** `{owner,task,due}`（LLM 理解指代/去重，规则轨**宁可留空不可编造**→ 标"待认领"；**内容交 LLM、格式交代码**，两轨格式一致）；**⑤ 操作员 ReAct 闭环**：每步收集**服务端可确定的三类观测**（转发门禁结果/控制权/执行轨迹）喂回 LLM 判断达成与修正（≤4 轮），**结论三档措辞**——出现过输入丢弃就明确报"⚠️ 可能未完全生效"，不再无条件报成功；**⑥ 证据链 UI**：气泡摊开 `📚 检索 N 条取 M 条 · 💬 第 K 轮 · 🎯 意图`（流式与非流式都带）。**本轮实修 4 个真缺陷**：`RoomBrain` 漏 `memory.push`（记忆整体失效）、行动项正则贪婪（`压测报告我负责`→owner=`压测报告我`；用 lookbehind + 集体词表修）、**基于不存在的 `remote-input-ack` 写闭环**（grep 证伪后改用转发在线状态）、验证脚本消息竞态（先清空再 emit，按 ts 过滤） | — | `sfu/ai/brain.js`、`sfu/server.js`（`aiBrain` 重构 / `getRoomBrain` / `disposeRoomBrain` / `buildMinutes` 行动项表 / `runAiOperator` 闭环 / `remote-input-fwd-result`）、`sfu/public/client.js` 证据链段、`style.css` `.msg-ai-trace`、`scripts/{test-ai-brain,verify-ai-live}.js`（AGENTS 坑 **41~44**） |


**双版本架构形态（主次已调换）**：**SFU 版（sfu/ 目录/3001，mediasoup 服务器转发，腾讯会议同款）为
主版本/简历主打**；Mesh 版（根目录/3000，浏览器 P2P 直连）是教学对照版——先把 P2P 讲明白，
再理解 SFU 为什么更接近真实产品。两版并存、互不干扰。教学概念见 LEARN.md 第 2.11 节，设计蓝图
`SFU设计蓝图.md` 已标注"已落地"。注意**别把两版代码搞混**：改根目录 = Mesh（对照），改 sfu/ = SFU（主版本）。

---

## 3. 技术栈与铁律

- 前端：**原生 JS + HTML + CSS，零框架**（不要引入 React/Vue）
- 信令：`socket.io`（服务端） + 本地 `public/vendor/socket.io.min.js`（客户端，不依赖外网 CDN）
- 服务端：原生 `http` + `fs` 托管静态文件（没有 express）；SFU 版额外用 `mediasoup`（npm 原生模块）
- Mesh 版：媒体/聊天都是 **P2P 直连，不经服务器**；服务器只做信令转发（邮局）
- SFU 版（sfu/）：媒体走 **mediasoup 服务器转发**（腾讯会议同款），聊天走服务器广播（方案 A）——**两版媒体路径不同，别混**
- 教学注释风格是项目灵魂：每段功能前有大段中文注释 + 「第 N 步」编号，面向零基础，**改动代码时不要删注释、不要破坏教学结构**

---

## 4. 文件地图

```
webrtc/
├── AGENTS.md              # ★ 本文件（会话记忆，DSH 自动读取）
├── README.md              # 项目总览入口（功能/运行/开发历程表；主版本=SFU）
├── LEARN.md               # ★ 零基础教学文档（JS 速成 → WebRTC 概念 → 逐行导读 → 测验；第 2.9~2.11 节=密码/getStats/SFU 预习）
├── SFU设计蓝图.md         # ★ Mediasoup SFU 迁移蓝图（架构/信令协议/目录规划/分阶段落地验收）
├── EVOLUTTON.md           # 进化方向蓝图：实习简历版 vs 毕设版 + 第 6 节跨电脑互连实操
├── AI部分功能计划.md      # AI 会议助理蓝图 + 「更好的功能方向池」
├── H5远程桌面-规划.md     # ★ H5 远程桌面开发规划（面试杀手锏；Mesh 先行、SFU 延伸，P0 已全量落地）
├── 后续升级方向.md        # ★ 升级路线图（唯一权威；第 0 节基线 + A/D/D+/E/F/G 档菜单 + 回填守则）
├── 部署手册.md            # 交付指南（局域网/跨网 TURN/云主机 systemd/端口表/自查清单；09-16c）
├── 跨电脑连接-操作指南.md # 面向非技术观众的三步图文化 + 费用速查 + 常见问题（09-16d）
├── 性能测试报告.md        # bench.js 三档实测数字表（E4，09-16c）
├── 演示脚本-5分钟.md      # 5 分钟演示讲稿 + Q&A 弹药（E5，09-14c）
├── start-lan.bat          # 一键局域网交付入口（09-16c）
├── WebRTC-H5-学习路线-深度版.pdf   # 知识来源（未随仓库保存，需时自行放入）
├── server.js              # Mesh 版信令服务器（396 行）：静态托管 + 房间/密码管理 + 定向转发
├── .npmrc                 # ignore-scripts=true（防止 npm install 重编译 mediasoup worker，见坑 #12）
├── deploy/coturn/         # 自建 TURN 包（docker-compose.yml + turnserver.conf，09-15c）
├── sfu/                   # ★ SFU 版（mediasoup，端口 3001）
│   ├── server.js          #   SFU 服务器（2036 行，分区 A~E）：静态托管 + 房间/密码 + 用户体系 + 媒体中枢 + 录制 + 面板 API
│   ├── protocol.js        #   SFU 信令事件总表（222 行；房间/媒体/远程协助/A~F 各档事件，改 sfu 前后端先看）
│   ├── config.example.json#   配置模板（端口/人数/listenIp/announcedIp/ICE/HTTPS/roomTtlSec/videoSvc）
│   ├── config.json        #   实际配置（可缺省；start:lan 生成时含 lanUrl）
│   ├── users.json         #   登录注册账号存储（scrypt 哈希）
│   ├── recordings/        #   D+2 服务器侧录制产物（webm/mkv）
│   ├── tls/               #   HTTPS 自签证书（https.enabled 时自动生成）
│   └── public/
│       ├── index.html     #   SFU 页面（应用壳布局：topbar/stage/sidebar；预览页/滤镜面板/白板/字幕条）
│       ├── style.css      #   主版本整份重写（1195 行，14 节设计系统 + 主题层；Mesh 版样式保持不动）
│       ├── client.js      #   SFU 浏览器核心（4651 行，**步骤 1~29**；14=远程协助，15~24=A/D 档，
│       │                  #     25~26=F 档，26b/26c/26d=回应举手/批注/白板，27=D+1 数据通道，
│       │                  #     28=F6 滤镜虚拟背景，29=实时字幕）
│       ├── dashboard.html #   观测面板页（/dashboard）
│       ├── workbench.html #   远程协助工作台（与 Mesh 版共用同一份演示页）
│       └── vendor/        #   socket.io.min.js + mediasoup-client.js（本地打包）
├── package.json           # scripts: start/start:sfu/start:demo/start:lan/test/test:sfu/test:smoke/
│                          #          test:record/test:turn/bench/build:sfu-vendor（含 doctor）
│                          #          ★ 09-24b 新增：agent/test:agent/test:e2e/publish:mesh/test:publish
├── scripts/
│   ├── soak.js                 #   服务器耐久自测（C3-N1，默认 7h/可压缩）
│   ├── test-signaling.js        # Mesh 信令回归（33 项，需先起 3000）
│   ├── test-sfu-signaling.js    # SFU 信令回归（67 项，需先起 3001）
│   ├── test-sfu-client-smoke.js # 前端无头冒烟（76 项，零依赖不用起服务器）
│   ├── test-turn.js             # ICE 可达性实测（STUN Binding/TCP 探测）
│   ├── bench.js                 # E4 压力基准（4/8/16 路）
│   ├── start-demo.js            # 一键起两版
│   ├── start-lan.js             # 局域网交付（生成 config + HTTPS + 防火墙放行）
│   ├── publish.js               # ★ 09-24b 一键发布公网链接（生成→体检→可选隧道；--tunnel/--bundle/--check）
│   ├── test-agent.js            # ★ 09-24b 桌面代理端到端（真 Chromium，16 项）
│   ├── test-e2e-remote-desktop.js # ★ 09-24b 真机远程桌面 e2e（真双窗 + 手机视口，出截图）
│   └── test-publish.js          # ★ 09-24b 发布链回归（29 项，含 --check 过期闸）
├── agent/                       # ★ 09-24b 真 OS 级远程桌面 · 被控端代理（零新依赖）
│   ├── cdp.js                   #   手写 CDP 客户端（驱动真实 Chromium：抓屏/注入输入）
│   └── index.js                 #   代理主体（agent-hello 进房 → 推帧 + 执行 remote-input）
├── publish-mesh/                # ★ 09-24b 由 publish.js 生成的发布包（白名单拷贝，勿手工改）
└── public/
    ├── index.html         # 布局：左主区(房间面板[含密码框]/视频网格/控制/日志) + 右聊天侧边栏
    ├── style.css          # 两列布局 + 视频网格 + 聊天气泡 + 网络徽标三色
    ├── client.js          # 浏览器核心（3085 行，步骤 1~16 + 5.5 + **第 19~25 步** A/D 档同步升级；第 16 步=getStats）
    └── vendor/            # socket.io 客户端库（勿动）
```

**教学阅读顺序**（LEARN.md 规定）：先 `LEARN.md` 第 0 章 → 第 1 节 JS → 第 2 节概念 →
第 2.5~2.11 节各功能 → 第 3 节读代码 → 第 4 节进阶 → **第 5 节 = SFU 版运行与逐文件导读**。

---

## 5. 运行 / 验证

```bash
npm install            # 装依赖（已装好：socket.io + mediasoup + mediasoup-client/esbuild[dev]）
npm start              # Mesh 版服务器 → http://localhost:3000
npm run start:sfu      # SFU 版服务器 → http://localhost:3001（要先 build:sfu-vendor，已生成过则不用）
npm run start:demo     # 一键起两版（Mesh 3000 + SFU 3001）并打印地址
npm run start:lan      # 局域网交付：探 IP → 生成 sfu/config.json（HTTPS 自签+announcedIp+TURN）→ 放行防火墙
npm run build:sfu-vendor  # 一次性：打包 mediasoup-client → sfu/public/vendor/（改依赖后重跑）
npm test               # Mesh 版信令回归（必须先起 3000）★ 2026-09-24 实测 36/36
npm run test:sfu       # SFU 版信令回归（必须先起 3001，且 AI_OP_STEP_MS=20）★ 2026-09-24 实测 149/149（Mock 轨 / LLM 轨各跑一遍；含门禁边界 + 房间令牌断言）
npm run test:store     # ★ 09-24 账号存储层回归（node:sqlite：迁移保留 salt/hash / 改密换盐 / 删号安全闸 / 完整性）★ 49/49
npm run test:shutdown  # ★ 09-24 优雅退出回归（关 Worker / 关库 WAL checkpoint / 幂等 / 5s 保险丝）★ 9/9
npm run test:smoke     # SFU 版**前端**无头冒烟（假 DOM/假 mediasoup，零依赖不用起服务器）★ 2026-09-24 实测 136/136
npm run admin:list     # ★ 09-24 管理员 CLI（另有 grant/revoke/adduser/passwd/purge；purge 默认干跑、`--yes` 才删）
npm run test:ai        # AI 双轨自检（无 key 只跑 Mock 轨并提示，有 key 两条都跑）★ 10/10
npm run test:ai-brain  # ★ AI 智能内核单测（检索/记忆/意图/行动项）★ 30/30（Mock 26 + 真模型 4）
npm run verify:ai      # ★ AI 真服务器端到端（起真服务器+真信令+真模型）★ 6/6
npm run ai:chat        # AI 脚本：终端一问一答（教学阶段 0）／--q "问题" 单发
npm run ai:summarize   # AI 脚本：文本/文件/房间字幕 → markdown 纪要（--text/--file/--room）
npm run ai:agent       # AI 脚本：手写 ReAct 工具循环（--goal "…" --maxsteps 6 --verbose）
npm run test:record    # D+2 服务器侧录制端到端自测（需已装 ffmpeg；产物落 sfu/recordings/）★ 连跑 3 次 PASS
npm run test:turn      # ICE 可达性实测（对 config 每个 STUN/TURN 手搓 STUN Binding，3s 超时）
npm run soak          # C3-N1 服务器耐久自测（默认 7 小时过夜；--minutes 2 压缩自测；结束对账"一条不丢"）
npm run bench          # E4 压力基准（4/8/16 路，约 1 分钟，独立 Worker，不用起 3001）
npm run agent          # ★ 09-24b 启动被控端桌面代理（--room 123456；真机远程桌面的被控端）
npm run test:agent     # ★ 09-24b 桌面代理端到端（真起 Chromium：抓屏 JPEG + 坐标注入 ±3px + 远程导航）★ 16/16
npm run test:e2e       # ★ 09-24b 真机远程桌面 e2e（真双窗 + 390×844 手机视口双指/单指，出截图）
npm run publish:mesh   # ★ 09-24b 一键发布 Mesh 版（生成 publish-mesh/ → 体检 → 可选 --tunnel/--bundle/--check）
npm run test:publish   # ★ 09-24b 发布链回归（含 --check 过期闸：源码改了不重发必报错）★ 2026-09-24 实测 30/30
node --check public/client.js && node --check server.js      # 改完 Mesh 版 JS 查语法
node --check sfu/public/client.js && node --check sfu/server.js  # 改完 SFU 版 JS 查语法
# ★ 09-24 全部回归合计 440 项全绿：SFU 149 + 存储 49 + 优雅退出 9 + 冒烟 136 + Mesh 36 + 代理 16 + 发布 30 + e2e 15
```

- ✅ **`npm run doctor`**：环境自检（17 项 / 4 组：环境·配置·端口·跨网 ICE），失败项都给"怎么修"；`node scripts/doctor.js --json` 出结构化结果。换机器 / 交付前先跑一遍。
- ⚠️ **起服务器前先查端口/进程**（见坑 31）：3001 已被占时新进程会立即退出，而测试仍会对
  **旧实例**跑出一片绿——数字是真的，但验的不是你刚改的代码。查法：`Get-NetTCPConnection -LocalPort 3001`
  或看启动输出有没有"已有实例"的友好提示。

- 人工验证 Mesh：Chrome 2~3 窗口访问 3000 → 建房/加入/共享/聊天，第 4 个被拒（room-full）。
- 人工验证 SFU：Chrome 2~8 窗口访问 3001 → 同上；**真实摄像头/共享/聊天需用户开浏览器验证**（命令行只能验信令）。
- 浏览器内部调试：`chrome://webrtc-internals`（看真实 SDP/ICE）。
- **改完前端 JS，浏览器要 Ctrl+F5 强刷**，否则读旧缓存（常见坑）。
  ⚠️ **09-24b 起注意 Service Worker**：SW 会绕过 HTTP 缓存头缓存旧 client.js/style.css（见坑 40）——
  强刷不一定够，必要时给地址加 `?nosw=1`（逃生舱：注销 SW + 清 Cache Storage + 重载）；跑 e2e 记得先清 profile。
- mediasoup Worker 是原生模块：`npm run start:sfu` 首次启动会拉起编译好的 worker（进程名 mediasoup-worker）。

---

## 6. 信令协议（改 server.js/client.js 前必看）

服务器事件（server.js C 段）：

| 方向 | 事件 | 载荷 | 说明 |
|---|---|---|---|
| C→S | `create-room` | 可带 `{ password }` | 服务器生成 6 位房间号并建房间记录 `{password, members}`，回 `room-created` 后自动进房 |
| C→S | `join-room` | `{ roomNumber, password }` | 过三关：6 位数字格式 → 房间存在 → 密码对（无锁房间跳过第三关）；失败回 `room-not-found` / `room-wrong-password` |
| S→C | `room-created` | `{ roomNumber }` | 创建者拿到号（页面右上角徽标 + 控制台双输出） |
| S→C | `room-wrong-password` | `{ roomNumber }` | 新增：房间在但密码不对/留空 |
| S→C | `room-members` | `{ roomNumber, members: [老成员id] }` | 新人主动去连这些老成员 |
| S→C | `new-member` | `{ id }` | 广播给老成员：为新成员建 pc 等 offer |
| S→C | `room-full` | `{ max: 3 }` | 人满拒绝 |
| S→C | `room-not-found` | `{ roomNumber }` | 号不存在/格式错 |
| C→S→C | `offer` / `answer` / `ice-candidate` | 都带 `{ to }`，转发时附加 `{ from }` | 定向转发，服务器不解析内容 |
| S→C | `peer-left` | `{ id }` | 有人离开（含离开房间/断线） |

**远程协助（H5 远程桌面 Phase 1，Mesh 版）新增事件**（server.js remoteCtl 表：房间号 → { hostId 被控端, controllerId 控制端 }）：

| 方向 | 事件 | 载荷 | 说明 |
|---|---|---|---|
| C→S→C | `remote-request` | C→S `{ to }`；转发 `{ from }` | 控制端申请控制 to；若房间已有 controller → 直接回申请者 `remote-answer { ok:false, reason:'busy' }` |
| C→S→C | `remote-answer` | `{ to, ok }` | 被控端决定；ok=true → 服务器登记 + 广播 remote-state + 回执 ok:true；ok=false → 仅转回拒绝 |
| S→C | `remote-state` | `{ hostId, controllerId|null }` | 全房广播"谁控谁"（controllerId=null 表示控制结束） |
| C→S | `remote-release` | `{}` | 被控端收回 / 控制端放弃 → 服务器清 remoteCtl 并广播复位 |
| — | 断开清理 | — | hostId 或 controllerId 断开 / 房间销毁 → 自动 clearRemoteCtl（防幽灵控制权） |

**Mesh 建连铁律**：新成员（后到的）当 caller 主动发 offer；老成员只建 pc 等 offer——防 glare 冲突。
**DataChannel 铁律**：建连主动方 `pc.createDataChannel('chat_<rand>')`；对端 `pc.ondatachannel` 接收。
**群聊广播**：遍历 `channels`，只给 `readyState === 'open'` 的通道 `send(text)`；
消息是纯文本，接收端靠 channel 归属的 remoteId 判断发送者（UI 显示 shortId = id 后 4 位）。

**★ 09-24b Mesh 版跨网 ICE 下发**：根 `server.js` 新增可选 `mesh.config.json`
（`port`/`host`/`iceServers`/`publicUrl`；优先级 **环境变量 `PORT`/`HOST` > `mesh.config.json` > 默认值**）
+ `GET /config.json` 路由（下发 `iceServers`/`arch`/`maxMembers`，带 `Cache-Control: no-store`），
启动时打印 ICE 自检（无 TURN 警告）；根 `public/client.js` 加 `ICE_SERVERS` + `iceReady`
（`fetch('config.json',{cache:'no-store'})`，失败回落默认 STUN），**所有建 peer 处 `await iceReady` 再建**
（防"第一条 peer 用错配置"）。根因：Mesh 是 P2P，"跨网连不上"是 **ICE 打洞**、不是服务器；
原来 ICE 硬编码一条 Google STUN，严格 NAT 必挂。`mesh.config.json` 含 TURN 凭证已入 `.gitignore`。

**SFU 版（sfu/）协议另有一套**：房间/密码事件沿用上表，但**媒体协商全部换成请求-应答**——
`get-router-rtp-capabilities` / `create-webrtc-transport` / `transport-connect` / `produce` / `close-producer`
/ `consume`（服务器回调 `{data}` 或 `{error}`），广播事件 `new-producer` / `producer-closed` /
`consumer-closed`；聊天改 `chat-message`（服务器广播）；★ 09-10 远程协助五事件（`remote-request/answer/state/release` + `remote-input` 定向转发——服务器校验 remoteCtl 在册才转发输入）。
**09-11 A2/A5 起 `remote-input` 的 event 有两种形态**：JSON 对象（键盘 keydown/keyup、
中文整段 `{kind:'input-text', text}`）与 **16 字节 ArrayBuffer 帧**（鼠标/滚轮，socket.io 当二进制
附件搬运、服务器原样透传，但轻量过滤须用 `ArrayBuffer.isView` 放行，见坑 17）。
帧布局 `[0]kind [1]flags [2..3]预留 [4..7]x(F32) [8..11]y(F32) [12..15]wheel(I32)`，
编解码见两版 client.js 的 `encodeCtlFrame/decodeCtlFrame`。总表见 `sfu/protocol.js`，
快速表见 LEARN.md 第 5.5/5.7 节。
**注意**：sfu 的 create-room/join-room 是"不带回调"的普通 emit（浏览器端），服务端已做 callback 守卫，别在新增事件里假设一定带回调。

**09-11 大升级新增事件（SFU 版，总表见 sfu/protocol.js）**：

| 方向 | 事件 | 载荷 / 门禁 | 用在哪 |
|---|---|---|---|
| C→S | `member-state` | `{ patch:{muted?,camOff?,sharing?} }`（**白名单**，只认这三个布尔字段） | D4 我上报自己的状态 |
| S→C 广播 | `room-state` | `{ roomNumber, members:[{id,owner,muted,camOff,sharing}], hostId, controllerId, expiresAt }` | D4 房间快照（前端照单渲染成员列表） |
| C→S / S→C 定向 | `kick-member` / `kicked` / `kick-denied` | 仅 `room.ownerId` 能踢；被踢者先收 `kicked`，100ms 后服务器 `disconnect(true)` | D4 房主踢人 |
| S→C 广播 | `audio-levels` | `{ levels:[{id,volume}], top }`（volume 为 dB，-55 以上才算说话；silence 时 levels=[]） | D2 说话人指示（服务器 AudioLevelObserver） |
| C→S 应答 / S→C 定向 | `set-preferred-layers` / `layer-changed` | 前者 `{ consumerId, spatialLayer }`（null=交回自动）；后者 `{ consumerId, producerId, spatialLayer, layerCount, auto, reason }` | D1 simulcast 选层 |
| C→S / S→C 定向（**双向**） | `clipboard-sync` | `{ to, text, dir:'ctl2host'|'host2ctl' }`；门禁：**只有正在互相控制的那一对**能互发 | A3 剪贴板同步 |
| C→S / S→C 定向 | `file-offer` / `file-answer` / `file-chunk` / `file-end` / `file-abort` | 台账 `fileTransfers`（模块级）；单块 ≤64KB；**累计超 offer 申报 size 即掐断** | A4 文件传输 |
| S→C 定向 | `remote-ended` | `{ reason:'expired'|'released'|'peer-left' }` | A6 限时授权到期提示 |
| C→S | `remote-answer` | 新增可选 `durationMs`（0/缺省=不限时）；服务器记 `expiresAt` + setTimeout 到期自动 `clearRemoteCtl(roomNumber,'expired')` | A6 限时授权 |
| S→C 广播 | `net-levels`（09-12 F 档新增） | `{ levels: { [socketId]: 0|1|2|null }, bwe }`；服务器每 3s 对每人订阅的每路 Consumer `getStats()` 取**最差路丢包率**（<1% 好/<5% 中/其余差）+ recvTransport 的 `availableOutgoingBitrate`（→`bwe`，D+3）；**JSON 比对有变化才发**；null=还没收过媒体包（前端画灰○，不猜成"好"）；定时器 joinRoom 幂等启动、房间销毁必 clearInterval | F2 成员列表网络点 + D+3 ABR |

**09-13 ~ 09-17 新增事件与接口（SFU 版，总表见 sfu/protocol.js）**：

| 方向 | 事件 | 载荷 / 门禁 | 用在哪 |
|---|---|---|---|
| S→C 广播 | `talk-stats` | `{ stats: { [socketId]: 占比整数 } }`（D2 的 AudioLevelObserver 每 400ms 报一次 → 服务器累计秒数算占比；**有变化才发**） | 09-13 发言占比条 / 观测面板 |
| C→S 应答 | `auth-register` / `auth-login` / `auth-verify` | `{ username, password, displayName? }` / `{ username, password }` / `{ username, token }` → 回 `{ user:{username,displayName}, token }` 或 `{ error }`（错密码与"用户名不存在"**统一提示**） | 09-16 登录注册（users.json + scrypt + 内存 token） |
| C→S 应答 | `record-start` / `record-stop` | `record-start { memberId } 或 { producerId }` → 回 `{ recordId }`（跨房间目标被拒、无媒体走明确错误应答）；`record-stop { recordId }` → 回 `{ file }`（经 `/recordings/<file>` 下载） | D+2 服务器侧录制 |
| 数据通道应用层（非信令） | `{type:'chat'}` / `{type:'react'}` / `{type:'annot', to, op, x, y, color}` / `{type:'board', op, ...}` / `{type:'caption', text}` | 三种频道 label：`chat`（聊天 + 表情 + 字幕）/ `annot`（带 `to` 定向头的屏幕批注）/ `board`（房间级白板，无定向头）；字幕**不做信令兜底**、聊天**双路径 + msgId 去重** | D+1 / F4 / F5 / F7 / 实时字幕 |
| HTTP（非信令） | `GET /api/rooms` / `GET /dashboard` / `GET /config.json` / `GET /recordings/<file>` / `GET /minutes/<房间>/<file>` / `GET /api/minutes?room=` / `POST|GET /api/captions`（09-17e 值守归档：落盘/回读） | 观测快照 JSON / 面板页 / 下发 ICE + `lanUrl` + `aiEnabled`（**只给布尔值，密钥绝不下发**） / 录制产物下载 / 纪要 md 下载（路径穿越均已钳制、静态响应 `no-store`） | 观测面板、可达性、D+2 交付、N2 纪要 |
| C→S 应答 + S→C 广播 | `ai-join` / `ai-leave` / `ai-ask` / `ai-minutes` / `ai-op` | `ai-join`→`{aiBot}`（bot 以 `isBot` 虚拟成员进 room-state）；`ai-ask {question}`→**先回执** `{started,streamId}` 再 `ai-stream{id,delta,done}` 增量 + 终态 `chat-message{...,streamId,ai:{mock,tokens}}`（前端按 streamId 去重；助理缺位时自动邀请）；`ai-minutes {type,since}`→`{file,path,mock}`；`ai-op {goal}`→`{started}`（AI 以真实控制端走完整授权链路，不豁免） | 09-19b/c/g + **09-24 流式与双轨**（详见 `sfu/protocol.js` 的 AI 段契约） |
| C→S 应答 + S→C 定向 | `agent-hello` / `remote-frame` / `remote-meta`（★ 09-24b 真 OS 级远程桌面） | `agent-hello {roomNumber,password?,name?,platform?,browser?}`→`{roomNumber,memberId}`（置 `isAgent`、名加 `🖥️ ` 前缀；三道校验同 join-room，**代理无特权**、满员照样被拒）；`remote-frame {to,frame}` 被控端→S→控制端（二进制 JPEG，**三道闸**：①`isAgent` 身份闸 ②host→controller 授权闸 ③≤900KB + 120 帧/秒体量闸；`volatile` 发不排队）；`remote-meta {to,url,title,viewport}` 回真实地址/标题（普通 emit）；控制输入**复用 `remote-input`**（16 字节帧不变，agent 新增 `navigate`/`window` 走老通道新语义） | 真机远程桌面（本地代理 `agent/` + `sfu/public/` 的 `#rdConsole`，含手机 Pointer Events 单指/双指） |

---

## 7. 已踩过的坑（改代码时避免重踩）

1. **占位文字盖住画面**：收到 `ontrack`/`connected` 时必须隐藏 `#remotePlaceholder`，否则"等待对方加入…"永远叠在画面上（用户曾误以为没连上）。
2. **socket.io 客户端 `socket.id`**：要等 `connect` 事件之后才有值（测试脚本 `client()` 已固化此做法）。
3. **事件监听先于 emit 注册**：否则丢事件（测试脚本历史教训）。
4. **ICE candidate 解析**：`candidate.candidate.split(' ')[3]` 才是 IP（index 3，别用 2 或 4）。
5. **getUserMedia/getDisplayMedia 需要安全上下文**：localhost 或 https；且必须在用户手势（点击）里调。
6. **回声/啸叫**：同机多窗口是正常现象，点静音即可——面试可讲 AEC。
7. **聊天 XSS**：用户输入要转义再插 DOM（`textContent`，不要 `innerHTML` 拼用户消息）。
8. **房间号是 6 位纯数字**（100000~999999），`rooms` Map 空房即删、号可回收复用；测试曾用 `000000` 验证 room-not-found。
9. **本地视频框加 `muted`** 防回声；远端视频不加（要听到对方）。
10. **`rooms` 的值现在是对象不是 Set**（第 2.9 节起）：取成员要写 `rooms.get(号).members`；改 server.js 时别再用 `rooms.get(号).has/delete`。
11. **getStats 两个坑**：`remote-inbound-rtp.roundTripTime` 单位是**秒**（要 ×1000 变 ms）；算码率必须"两轮累计字节相减"，浏览器只给累计值。
12. **mediasoup worker 的安装已"特殊处理"**：本机跑 `npm install mediasoup` 的 postinstall 会因
    GitHub 拉预编译 worker / wrapdb 编译依赖失败而报错（曾实测）。当前解法：
    worker 二进制已手动放置于 `node_modules/mediasoup/worker/out/Release/mediasoup-worker(.exe)`
    （来自官方 release 预编译包），并新增 `.npmrc` 设 `ignore-scripts=true` 防止 npm install 重编译。
    **千万别删 node_modules/mediasoup 或改 .npmrc**；真重装时照此步骤：npm pack mediasoup → 解包 →
    GitHub/代理下载 `mediasoup-worker-3.26.0-win32-x64.tgz` → 放入 out/Release（两份：带 .exe 与不带）。
    媒体走 UDP，默认端口 40000~49999（sfu/server.js 顶部可用环境变量改）；
    `npm run build:sfu-vendor` 会重新打包 mediasoup-client（vendor 已生成，改依赖后才需重跑）。
13. **SFU 新手三坑**：① Consumer 建完不 `await consumer.resume()` → 永远没画面；
    ② 房间空了不 `router.close()` → mediasoup 内存泄漏；③ 前端 create-room/join-room 是"不带回调"的 emit，
    服务器处理时若无条件调用 ack 回调会崩（sfu/server.js 已加 callback 守卫，新增事件要照做）。
15. **mediasoup-client 参数字段名契约**（09-10 实修）：服务器应答里通道号叫 `transportId`，
    但 `device.createSendTransport/createRecvTransport` 要的参数名是 `id`——把应答对象原样透传会抛
    `TypeError: missing id`（浏览器报"媒体初始化失败：missing id"）。必须映射
    `{ ...params, id: params.transportId }`（consume 路径同理 `id: consumerId`）。
    信令回归测试走不到 mediasoup-client 这层，测不出来，只能浏览器真跑才发现。
14. **别把两版搞混**：房间/密码代码根目录 server.js 与 sfu/server.js 各一份，改一处不生效另一处；
    跑测试前先确认起的是 3000（Mesh）还是 3001（SFU）的服务器。
16. **DataChannel 的 binaryType 默认是 'blob'**（09-11 A5 实修）：要收二进制帧就必须在
    onopen 前 `ch.binaryType = 'arraybuffer'`，否则 onmessage 的 e.data 是 Blob，
    没法直接按字节解码。
17. **socket.io 二进制的两端形态**（09-11 A5 实修，回归测试抓出来的）：浏览器 emit 的
    ArrayBuffer 到**服务器变 Node Buffer**（共享内存池上的视图）——`Object.keys(Buffer)`
    会数出 N 个下标，sfu 服务器 remote-input 的"字段数≤12"垃圾包过滤会误杀二进制帧，
    必须先 `ArrayBuffer.isView(event)` 识别再跳过该过滤；Node 测试端读回 Buffer 时要按
    byteOffset/byteLength 拷出副本再建 DataView（直接用 event.buffer 会读到池里相邻数据；
    浏览器端没这个问题，socket.io 还原成真正的 ArrayBuffer）。
18. **跨连接的状态必须放模块级**（09-11 A4 实修）：文件传输台账 `fileTransfers` 一开始写在
    `io.on('connection')` 的闭包里 → 接收方查不到发送方建的记录（一次传输横跨两个连接）。
    规律：**单连接的状态挂 socket，跨连接的状态放全局**。
19. **A4 二进制块的单块上限**：服务器 `file-chunk` 超 64KB 直接丢弃，客户端必须用更小的块
    （当前 32KB）并**每块之间让出事件循环**——socket.io 没有 DataChannel 的 `bufferedAmount` 背压，
    不限速会把内存堆爆。
20. **限时授权的定时器要清**（09-11 A6）：`remoteCtl` 里挂的 `setTimeout` 必须在
    "手动释放 / 成员断开 / 房间销毁"三条路径上都清掉，否则到点会对已结束的会话再撤一次权
    （表现为前端莫名收到 `remote-ended`）。`clearRemoteCtl(roomNumber, reason)` 已统一处理。
21. **手动锁层期间服务器不该再插手**（09-11 D1）：`startLayerMonitor` 的 tick 开头必须判
    `if (!state.auto) return;`——否则用户手动选了低层，服务器下一轮又按丢包率把它改回去。
22. **重连必须清 void 的 Device/Transport**（09-11 D6）：socket.io 重连后 socket.id 变了，
    旧 `sendTransport` 已被服务器关掉；不调 `resetMediaState()` 直接在旧通道上 produce 会抛
    `Transport closed`，画面永远回不来。重连流程 = 重进房 → reset → initSFU → 重新推拉流。
23. **AudioLevelObserver 只给 producerId**（09-11 D2）：要翻译成"哪个人在说话"，
    必须自己维护 `room.producerOwner`（producerId → socketId）表，并在 `close-producer`/
    `disconnect` 时删除条目；`maxEntries`/`threshold`/`interval` 三个参数决定灵敏度与开销。
24. **新组件的 `display:flex/grid` 会按源顺序压过 `.hidden`**（09-12 F 档实修，第二次踩，
    第一次是 `.workbench-area.hidden`）：`.hidden{display:none}` 定义在 style.css 第 67 行，
    而 `.prejoin` 这类全屏遮罩写在文件**末尾**——同为单类选择器、后者赢，
    结果"点『进入会议』后 hidden 类加上了、遮罩却永远不消失"（外加 `.prejoin-video-hint`
    的提示永远显示，像摄像头坏了其实没坏）。**修法照 377 行惯例：在 display 声明之后
    显式补一条 `.xxx.hidden { display:none; }`**。凡是"带 display 的组件类"与 .hidden
    搭配使用，都要检查这条。**同日真机又抓到第三例 `.room-panel`**（display:flex 定义在
    70 行、紧贴 .hidden 之后）——症状是"进房后房间面板不消失"，此前一直存在没人发现。
    排查法：grep 所有被 `.hidden` 开关的类，逐个看它自己有没有 display 声明。
25. **mediasoup-client 的事件名是 `'producedata'`（完整词），不是 `'procedata'`**
    （09-14 实修，浏览器报 "no \"producedata\" listener set into this transport"、聊天退回
    信令）。给 Transport 挂数据通道监听器时照 3.x 源码写：`transport.on('producedata',
    ({sctpStreamParameters, label, appData}, callback, errback) => ...)`。grep 一次
    vendor 文件就能验证事件名（`grep -c producedata sfu/public/vendor/mediasoup-client.js`），
    这类"API 名凭记忆写错"的错 node --check 抓不到，真浏览器才炸。
26. **CSS 注释里写 `.xxx-*/` 会提前终止注释，吞掉后面整条规则**（09-15 实修，
    "前端排版乱/预览页没字"的根因）：style.css 文件头注释写了 `.annot-*/.ctrl-layer`，
    其中 `*/` 把注释提前闭合，剩余文字变成非法裸 token，Chrome 把紧随其后的
    `:root {...}` 整块当畸形规则丢弃 → **所有 CSS 变量为空** → 全站背景/颜色/尺寸
    全塌（表现为"元素叠元素、文字发灰看不清"）。node --check 和冒烟都测不到 CSS。
    排查手段：浏览器里 `getComputedStyle(document.documentElement).getPropertyValue('--bg0')`
    为空 + `document.styleSheets[0].cssRules` 里找不到 `:root` 就是这个坑。
    防守三件套：① 注释里绝不写 `*/` 序列；② 静态响应加 `Cache-Control: no-store`
    （否则改样式吃旧缓存，排查会被误导）；③ style.css 引用带版本参数（?v=日期）。
27. **假 DOM 的 classList 不从 HTML 初始化**（09-17 F6 冒烟实修）：真浏览器里
    `class="fx-panel hidden"` 的初始态，冒烟桩里 classList._s 是空 Set——依赖
    "当前是开还是关"的 toggle 类逻辑会**语义反转**（点一下反而关上）。修法：桩里
    预挂元素后手动 `classList.add('hidden')` 补初始态；纯 add/remove 的开关不受影响。
28. **冒烟帧循环的"帧率"约 9ms/帧**（09-17 F6 实修）：rAF 桩 = 每帧一个 setTimeout(0)，
    Node 定时器链实测远慢于真浏览器 rAF——依赖"跑 N 帧后断言"的测试要把等待放宽
    （F6 的 %24 徽标刷新点等了 500ms 才跨过）。别拿真实帧率推算无头耗时。
29. **多频道并存时 dataMessageHandler 是"最后订阅者"的**（09-17 字幕冒烟实修）：F7 白板的
    `board` 订阅会把 `rec.dataMessageHandler` 覆盖成 board 路由 → 之后断言聊天/字幕的用例
    收不到消息；测试里断言某条频道前要**重新订阅该频道刷回路由**（真浏览器里三频道各有自己的
    Consumer 回调，不会互相覆盖——这是冒烟桩的简化代价，写测试时要记得）。
30. **room-state 快照序列化与 member-state 白名单是两份清单**（09-17c 实修）：加一个成员状态
    字段（如 caption）必须**同时**改 `broadcastRoomState` 的 map 和 member-state 事件的
    `for` 白名单，漏一处 = 字段永远到不了前端（测试表现：room-state 的 Promise 永不 resolve 卡死）。
31. **端口被占时新进程静默退出，回归却照跑不误**（09-17 文档同步时实测踩到）：3001 已有实例
    时 `Start-Process node sfu/server.js` 会立刻退出（09-16e 的友好提示 + exit(1)），
    而 `npm run test:sfu` 仍会对**旧实例**跑出一片绿——数字是真的，但验的不是刚改的代码
    （本次实测就是这样：旧进程是 09-16 起的，测试照过）。**纪律：起服务器后先确认
    `HasExited=False` 且端口属于自己那个 PID**（`Get-NetTCPConnection -LocalPort 3001`），
    再跑回归；关的时候只关自己起的 PID。
32. **attachRemoteMedia 的"复用已有主画面格"分支别按 key 前缀抓格子**（09-18 实修，
    冒烟迟滞断言抓出来的真 bug）：camera 重订阅（关摄像头再开 = 新 producerId）走复用分支时，
    原写法 `tiles.get(keys.find(k => k.startsWith(from::)))` 会抓到该成员**先订阅的屏幕格**
    并把 tile.source 改写成 camera——元数据腐蚀，选层器/换层通知从此指错格子。
    修法：按 box 匹配（`tiles.values().find(t => t.box === main.box)`），box 才是稳定锚点
    （key 里的 producerId 会变）。测试侧同源教训：冒烟断言引用的"死元素"（D6 reset 后
    createdEls 里残留的旧格子）永远不会被标记，断言前要补订活格子。

33. **"不带回调"的 emit × 服务器 ok(callback) 无守卫 = 整服崩溃**（09-19b AI Bot 实机抓到，
    坑 13③ 的变体）：浏览器端 ai-join 这类信令是"普通 emit"（无第三个回调参数），
    服务器处理里 `ok(callback, ...)` 无条件调用 → callback undefined → TypeError →
    服务器进程退出，表现为"一邀请 AI 全房断线"。已修：ok/fail helper 统一加
    `typeof callback === 'function'` 守卫（对全部信令生效，一劳永逸）；新增信令时
    不再需要逐个防守，但也别绕开 helper 直接裸调 callback。

34. **注释里的 `**/xxx` 序列会提前终止块注释**（09-23 sw.js 实修，坑 26 家族第三例）：
    sw.js 文件头注释写了"**/socket.io 的请求绝不碰**"——`**/` 里的 `*/` 直接把块注释
    闭合，剩余文字变裸 token，`node --check` 当场报 SyntaxError。规律同坑 26（CSS）：
    **块注释里永远不要写出 `*/` 这个序列**（markdown 加粗 `**` + 路径 `/xxx` 开头正好拼出来）。

35. **冒烟桩的 classList.toggle() 不返回布尔**（09-23 G4 实修）：真 DOM 的
    `toggle()` 返回"现在是否有这个类"，桩里返回 undefined——`const open = el.classList.toggle('x')`
    这种写法在真浏览器正常、在冒烟里走错分支且不报错（静默语义反转）。
    修法：**toggle 之后再 contains 读回**，两端语义一致。另记：信令回归要
    `AI_OP_STEP_MS=20 node sfu/server.js` 起服（默认 600ms/步 ×7 步 > 测试 2.5s 等待，
    09-19g 那组会"假失败"，测试头部已补记）。

36. **配置漂移 ≠ 报错：announcedIp 是典型的"沉默故障"**（09-24 实修）：
    config.json 里躺着旧 IP 192.168.127.194、本机早已换成 192.168.209.194 时，
    mediasoup **照旧把错 IP 写进 ICE candidate**，同机 localhost 一切正常，
    **别的电脑/手机一律黑屏**，且没有任何异常可循——是最难排查的一类"沉默故障"。
    修法：三层取值（env > config **且与本机网卡一致** > 自动挑对外 IPv4，私网优先），
    漂移时**自动回退**并在启动日志里说明用了哪个、为什么。教训可以复用：
    **本机相关的配置项要拿到"当前事实"面前核对一遍，而不是照抄配置**。

37. **外部程序探测要区分"不存在"与"此刻没答上来"**（09-24 实修）：`ffmpeg -version`
    给 500ms 超时，启动瞬间正在拉 mediasoup Worker 子进程的机器上必然超时 →
    `err.killed=true` 被判成"未安装"，录制与 AI 听觉管线被**无误关闭**。
    修法：超时放宽到 2.5s + 超时重试一次 + **ENOENT 才算真没装**。
    同一批修复还揪出了 test:record 的稳定红：它不是文件锁，而是 **Windows 上 Node 的
    `spawnSync` 与未排空的子进程 stdio 相冲时会直接返回 EBUSY**（同一文件在 shell 里
    ffprobe 秒出结果，重试 6 次也没救）→ 改异步 `execFile` 立刻恢复。
    教训：**在服务器进程里调用外部命令，优先异步，不要 `execFileSync`；
    失败要看 errno（ENOENT / EBUSY / ENODEV），别一律当"功能不可用"**。

38. **AI 功能最怕"动作被聊天抢答"**（09-24 实修）：`@ai 生成纪要` 原先写在 Mock 分支里，
    配上 DeepSeek key 之后 LLM 分支抢先回一句"好的，我来总结一下…"，
    **纪要文件根本没生成**，而用户看到的是"AI 答应了"——能力与动作错位，
    比报错更难被发现。修法：**动作型意图在进 LLM 之前先路由**（tools-first），
    聊天模型只负责聊天。同理也要注意：新加 AI 能力时，别把它藏在降级分支里。

39. **AI 回归必须写成"双轨"**（09-24 确立）：脱离 key 与否决定了断言的措辞。
    `test-sfu-signaling.js` 里凡是断言 `[Mock] 前缀 / mock === true` 的用例，
    在有 key 的环境下会全红——那是**测试写死了环境**，不是代码错。
    现在的做法：从 `/config.json` 读 `aiEnabled` 后两支断言分叉；真模型才跑的那部分
    放进 `npm run test:ai`（无 key 自动 skip 并提示）。
    **纪律：AI 相关断言不得假设"一定没有 key"**。

40. **★ Service Worker 会绕过 HTTP 缓存头，让"代码对了但页面跑旧的"**（09-24b 实修，本档最有教学价值）：
    现象是改了 `sfu/public/client.js` / `style.css` 刷新死活不生效，服务器明明发了
    `Cache-Control: no-store`、DevTools 里也是 200，页面跑的仍是旧代码。根因两层：
    ① **SW 完全不看 HTTP 缓存头**——旧 `sw.js` 把 `./client.js`、`./style.css`、
    `./workbench.html` 一并预热进 Cache Storage 然后 **cache-first** 返回，HTTP 层的
    `no-store` 被整层绕过；② SW 只在 **sw.js 自身字节变化**时才重装，业务代码天天改、
    sw.js 一动不动，旧缓存就一直管着页面（旧注释那句"记得 bump SW_CACHE_VERSION"
    是寄希望于人的纪律，而纪律会被忘掉）。修法：**按资源性质分两路**——
    不变的（vendor/图标/manifest）cache-first，会变的（client.js/style.css/页面）
    **network-first**（在线永远最新=改完刷新即见），缓存只作断网兜底；版本语义随之清楚
    （改业务代码**不用** bump，换 vendor 才 bump）；另加 **逃生舱** `?nosw=1`
    （当场注销所有 SW + 清空 Cache Storage + 重载，用来一步排除"是不是缓存的锅"）。
    **测试侧同源教训**：e2e 原本复用持久化浏览器 profile，而 **CDP 的
    `Network.setCacheDisabled` 管不到 SW 的 Cache Storage**——于是测试测的是缓存而不是代码；
    修法：**每次运行前清空 profile 目录**。
    排查方法论：最后靠"让页面自己 fetch client.js 自证版本指纹"才定死是缓存问题——
    **当"改了没生效"时，先让页面证明它加载的是哪一版，再谈改代码**。

41. **★ "模块写对了"不等于"接线对了"——集成点必须被断言覆盖**（09-24e 实修，AI 智能内核轮）：
    `brain.js` 的 `ConversationMemory` 类写得很对（有界、指代拼串、截断全对），单测也全过；
    但 `RoomBrain.answer()` **漏了一行 `this.memory.push(q, res.text)`** ——
    于是"追问不失忆"这个卖点**整体是死的**：每轮 messages 里历史永远为空，
    模块却"测试全绿"。**这类缺陷的隐蔽性在于：单测模块过、单测返回值也过，
    只有把"模块 + 调用方"放一起断言（"问答之后记忆里应该有一轮"）才会暴露。**
    纪律：**凡是有状态被写入的功能，都要有一条"写进去没有"的断言**，而不是只测纯函数的输出。

42. **★ 正则做中文抽取一定会被"贪婪"咬到**（09-24e 实修）：行动项抽取里
    `([\u4e00-\u9fff]{2,6})(?:负责|跟进)` 把 `压测报告我负责` 抓成 owner=`压测报告我`；
    `我们需要跟进` 更离谱，抓成 owner=`们需要`（因为中文没有词边界，`{2,3}` 从"们"开始切了）。
    修法两层：① **lookbehind 近似词边界** `(?<![\u4e00-\u9fff])`——只能从词首开始匹配，
    于是抓到的是完整的"我们"，再被 ② **集体词表**（我们/咱们/大家/团队/各位）拦掉。
    通用教训：**用正则处理中文时，默认它会在错误的位置切开**，必须显式约束左右边界，
    并对"抓到的东西"再做一次语义白/黑名单校验——**不要相信 extract 出来的字符串是干净的**。

43. **★ 别给不存在的能力写代码——先 grep 证伪，再动手**（09-24e 实修）：
    给 AI 操作员做 ReAct 闭环时，我"理所当然"地写了监听 `remote-input-ack`
    （假定被控端收到输入会回执）。写完例行 grep 全仓库 —— **这个事件根本不存在**，
    客户端收了 `remote-input` 从不回 ack。若照此上线：ack 恒为 0 → 恒判定"帧未送达"
    → AI 会疯狂重试并最终误报失败。**一个不存在的假设，足以让整个闭环反向工作。**
    纪律：涉及"某个事件/字段/接口存在吗"时，**先 grep 证伪再写**；
    能用"本方此刻就能确定的事实"（如服务器转发时的目标在线状态）就别依赖对方的回执。

44. **★ 等待异步结果的测试，要先清空再做动作**（09-24e 实修）：
    `verify-ai-live.js` 里写成 `emitAck(提问)` → 清空消息数组 → 等回复。
    但 `emitAck` 的**回执先到、AI 的答案后到**，于是"抓到的第一条 ai-bot 消息"
    很可能是**上一轮**的尾巴。**症状极具迷惑性：表现是"AI 记忆失效/答错"，
    实际是测试抓错了消息**——差点让我去改一个本来正确的记忆模块。
    修法：**先清空数组、再 emit、只认 `ts >= t0` 的消息**（按时间戳过滤比按顺序可靠）。
    通用教训：**异步测试里"清空"与"触发"的顺序是语义的一部分**，写反了它不会报错，只会说谎。

45. **★ "能力升级"必须配套补语义边界**（09-25 实修，本轮最有价值的一条）：
    09-24e 把 AI 从"最近 8 条字幕"升级成"全档 BM25 检索"——能力变强了，
    但它开始能翻到**还没入会时**的字幕，甚至**上一场会**的（房间号销毁后会回收复用，
    而 `loadCaptions` 按房间号读 jsonl，旧会议的文件照样会被读到）。
    **能力越强，边界越重要**；升级检索时必须同时回答"它能翻多远"。
    本轮为此加了检索下界（`RoomBrain.scopeEntries`）。
    更值得记的是下一条：这个下界我**选错了两次**。

46. **★ 边界该划在"问题本身"，而不是"实现方便的地方"**（09-25 实修，自我推翻）：
    接上条——我先把下界设成"**助理入会时刻**"，理由听起来很正当（"参会语义：只答亲耳听到的"）。
    **真浏览器测试当场打脸**：AI 入会后立刻问「这场会都定了什么？」，它答"会议里没提到"，
    因为会议内容全在它入会之前。**这不是 bug，是设计错了**：
    现实中助理几乎总是**中途被请进来**的（会开一半有人想起"叫个 AI 来记"），
    而它一入会就对之前半小时一无所知 → **一请来就是个废人**。
    重新看"当初要防什么"：不是"本场会早期内容"，而是**房间号复用导致的跨会议串味**。
    → 下界改为**房间创建时刻**，两个目标同时达成（中途入会能答全本场 + 上一场会被挡住）。
    **教训：定边界时先写清"要防的具体坏结果是什么"，再选实现——
    否则很容易把边界划在一个"讲得通但用起来荒谬"的位置上。**

47. **★ 一个概念只能有一个来源**（09-25 实修，两处同源问题）：
    ① **一致性**：同一场会里"风险"被抽了两遍（纪要内联 `riskRe` vs 看板 `digest.RISK_RE`），
       两组正则不同 → 会真实出现"看板 3 条、纪要 2 条"。用户看到只会得出一个结论：**这套 AI 不可信**。
       修法：纪要的「决定/风险」直接取自 digest → **结构上不可能不一致**（不是"努力对齐"）。
    ② **诚实性**：AI 气泡里的"证据"一栏**固定显示 BM25 检索命中**，
       而问「这场会都定了什么？」时答案其实几乎全来自看板条目 →
       证据栏里赫然是「李四**午饭吃什么**」。**界面在无声地撒谎**，
       而且**比不显示证据更糟**（那是误导）。
       修法：改成"**哪个来源真的驱动了答案，就展示哪个**"（`r.evidence`）。
    **通用判据：凡是同一个概念被两处分别计算/分别展示，就一定会漂移。
    要么合并成一处，要么让两处**结构上同源**。**

48. **★ 一个自带节流/冷却的旁路，不能用来触发你想测的功能**（09-25 实修）：
    测"AI 语音播报"时我用**主动提醒**去触发，结果念不出任何东西——
    因为主动发言有 45s 冷却，而它刚说过话，被节流掉了。
    **症状指向了错误的地方**（看起来像"语音坏了"，其实是"没到说话的时候"）。
    修法：改用**确定性触发**（直接提问 → 回答必然广播 → 必被播报）。
    **教训：测试的触发路径要尽量"无副作用、无节流、无随机"；
    若必须经过一条有状态的分支，就要在断言里说明依赖了它哪个状态。**

49. **★ 中文正则"跨词命中"防不胜防，必须连"上下文"一起约束**（09-25 实修，坑 42 的续集）：
    为让看板认出"把日期定下来"是**决定**，我给 `DECISION_RE` 加了 `定在`。
    结果「服务器**固定在**线」被命中（"固**定在**"跨词）→ 一句普通描述被判成决定。
    用 lookbehind 挡"固"不够（还会撞上"不一定在"等等），
    正解是**把词约束到它的典型搭配上**：`定在\s*(?:\d|[一二三四五六七八九十两]|下周|本周|…)`
    ——"定在"后面**必须跟时间/数值**才认。
    **通用手法：中文没有词边界，但**搭配是有分布的**。
    与其试图切出词，不如要求"词 + 它该有的邻居"同时出现（更窄、更准）。**

50. **★ 改布局前先确认"契约"在哪**（09-25 实修）：
    给侧栏加第三块面板（AI 看板）时，上下堆叠会挤到没法用 → 必须改成 tab。
    改之前先 grep 了两件事：① 冒烟测试是否解析 `index.html`（只 2 处正则）；
    ② 测试是否依赖侧栏的 DOM 结构（结论：测试用的是**自建假 DOM**，不解析 HTML）。
    → 于是"只新增 `.side-tab`/`.side-view` 外壳、**原类名与 id 一个不动**"就能安全落地。
    **教训：前端重构前先花两分钟找"契约边界"，比改完再修 20 条回归便宜得多。**
    附带一句：改布局会引入**新需求**（tab 切走后聊天看不到 → 必须补未读角标），
    不补就是体验倒退——重构的账单里要算上这些。

51. **★ 假 DOM 的 `appendChild` 不会把子节点 `innerHTML` 汇总到父节点**（09-25 实修）：
    冒烟测试里写 `boardListEl.children.map(c => c.innerHTML)` 想找渲染内容 →
    **永远是空串**，因为看板条目是 `.board-sec` 的子节点（再下一层）。
    修法：**递归遍历子树**收集 `innerHTML`/`textContent`。
    **通用教训：假 DOM 只在"你断言的那条路径"上像真 DOM。
    跨层级的读法（查父节点的 HTML）在桩上一定会失真——这不是代码错了，是断言错了。**

52. **★ "同一份数据"必须真的是同一份**（09-25 实修，本坑最隐蔽）：
    为了让纪要只统计"本时段"，`buildMinutes` 里**新建了一个** `Digest` 重新 ingest；
    而**人工认领**（看板上点「我来」）记在**房间级**的 `roomBoards` 里 —— **两个不同实例**。
    初版拿新建的 dig 去合并认领信息 → 认领**凭空消失**，纪要继续写"待认领"。
    **最扎心的是：这正是本轮要修的那个缺陷（"人做过的决定被机器推断覆盖"）换了个位置复发**——
    我修了"两个来源口径不同"，却在实现里造出了"两个实例"。症状一模一样。
    修法：行动项一律从**房间级看板**取（它带着人的认领），只按 `since` 过滤时间段。
    **通用判据：当你写下"合并 X 与 Y"时，先确认 X 和 Y 是**同一个实例**，
    还是两个长得一样的东西。后者不叫合并，叫"用一份覆盖另一份"。**
    顺带记一个同类现象：本项目"同一个概念被两处分别计算"已经踩到第三次了
    （风险口径不一致 / 证据固定显示检索命中 / 行动项认领丢失），
    **每次的症状都是"界面上两个地方说法不同"**——见到这个症状就该直接去查实例数。


53. **★ 判"够不够格"的量必须**尺度无关**（09-25 实修，连踩三坑）**：
    AI 检索要从"只认字面 bigram"升级到"口语化也能召回"，前提是别让兜底把噪音也放进来。
    我为此设计了"命中文档够不够格"的判据，**连错三版**，每版都有一个独立的教训：
    ① **绝对分下限**：量出"真命中最低 5.65 / 假阳性最高 2.44"，看着很干净——
       换到 62 条语料**直接失效**：BM25 的 IDF 随 N 增长（df=1 时 N=6→1.54、N=62→3.7），
       同一句真命中在小语料只有 0.9 分、大语料有 2.2 分。
       **凡是绝对值当阈值，都先问一句"它随规模漂移吗"。**
    ② **"共享任意 bigram 就算够格"**：仍漏——「今天股市涨了多少」靠高频 bigram
       「今天」就蹭过了（标定语料里 55/62 条都含"今天/天气"）。
       结论：**共享的那个词还得"不是人人都说"**。
    ③ **"IDF ≥ 1.0"**：又把短会误杀了——df=1 时 N=2→IDF 0.69、N=3→0.98，
       两三条字幕的短会里完美匹配也判不够格（scope 单测当场变红）。
    正解 = **占比**（`df ≤ N/2`，即"不至于是过半文档都有的口头禅"）+ **小语料豁免**（N≤3 不筛，
    因为三五条里"频率"没有统计意义）。
    **通用判据：拿"比例/占比"表达"常见与否"，不要拿分数或 IDF 的绝对值。**

54. **★ `Number(process.env.X) || 默认值` 让传 0 永久失效（09-25 实修）**：
    调参时设 `AI_SCORE_MIN=0` 想量原始分，结果阈值仍是默认的 3.0——
    因为 `Number('0')` 是 0、是 falsy，`||` 直接落到默认值。
    **最坏的地方是它完全不报错**：量出来的数据全是错的，而你看不出来
    （我一度据此推断"阈值定得很准"）。
    修法：显式判"有没有传"（`undefined` / 空串 才算没传），0 是合法值。
    **与 `||` / `??` 那条经典区别同源，只是发生在环境变量上更容易被忽略。**

55. **★ 测"空/边界状态"前，先确认你操作的**确实是那个空对象**（09-25 实修，三版才对）**：
    要测"没有可归并的源时给什么提示"，我连改三版：
    ① 主 socket 直接 `create-room` → 「已在房间里」（它早在主房间了）；
    ② 主 socket 建房 + 第二 socket 加入 → merge 却仍作用于**主 socket 的房间**（那边有纪要）；
    ③ 正解：让**第二个 socket 自己建房**（create-room 会把建房者自动放进新房间）。
    **每一版我都"以为切过去了"。** 与坑 44（异步测试清空顺序）、坑 48（用带节流的旁路触发）
    同源：**边界断言的失败原因，最常指向"测试没站在你以为的位置上"**，
    而不是被测代码错了。写这类断言时，先断言"我确实在那个空状态里"。


56. **★ "内层算出来了、外层没带出来"——接线类缺陷已踩到**第三次**（09-25 实修）**：
    给多查询检索加 `rewrites`（改写是否发生）时，`RoomBrain.answer` 返回里有，
    但**包装层 `aiBrain` 构建自己的返回对象时没带出来**——
    AI 答对了、证据链却不披露"我改写过"，E2E 当场红。
    复盘一下这一类缺陷在本项目出现过的三次，症状完全一样、根因完全一样：
    ① `RoomBrain` 的 `memory` 类写对了、但 `answer()` **忘了 `memory.push`**（坑 41）；
    ② 语音播报挂在 `appendChat` 里，而流式回答的终态在**前一行就被 early-return**
       丢掉了 → 流式答案永远念不出来（09-25 实修）；
    ③ 这次的 `rewrites` 漏透传。
    **它们共同的形状：A 写好了、B 也写好了、A→B 的接线**没人测**。**
    通用对策不是"更细心"（这句话没用），而是：
    **凡是跨层传递的信息，在**最外层**设一条端到端断言**——
    这次我就是靠"证据链必须出现 🔄"这条断言抓到透传遗漏的。
    断言放在离用户最近的地方，等于在验收接线。
    顺带：新增字段/事件时，顺手 grep 一下它该出现的所有包装层
    （搜索"return {"在包装函数里），比事后靠 E2E 红一次便宜。**


---

## 8. 当前进度 & 下一步方向（重要：接着这里做）

**作者画像**：刚入门的前端学习者，教学节奏要慢、注释要细、每步可验证。
**已确认路线**（用户拍板）：先做会议功能（LEARN.md 第 4 节），AI 线后置（AI部分功能计划.md）；
进化方向两条路（实习简历版 / 毕业设计版）+ **跨电脑互连实操**见 `EVOLUTTON.md`。

LEARN.md 第 4/5 节进度（✅=已完成，🔜=待做）：
1. ✅ **入会密码**（LEARN.md 第 2.9 节，PDF 14）——rooms 值升级 + join-room 三关
2. ✅ **getStats 网络监控**（LEARN.md 第 2.10 节，PDF 14）——client.js 第 16 步
3. ✅ **切到 SFU（Mediasoup）→ 已转为主版本**：代码在 sfu/ 目录（mediasoup 3.26、端口 3001、最多 8 人）——
   服务器 sfu/server.js（A~E 分区）、浏览器 sfu/public/client.js（步骤 1~14，第 14 步=远程协助）、协议总表 sfu/protocol.js；
   运行/导读 LEARN.md 第 5 节；回归 `npm run test:sfu`。**真实音视频（摄像头/共享/聊天）需用户开浏览器验证**
4. ✅ **H5 远程桌面/远程协助**（面试杀手锏）：规划 `H5远程桌面-规划.md`——**P0 五个 Phase 已全量落地
   （Mesh 版）**：授权信令 + ctrl_ DataChannel + 控制端采集（归一化/节流）+ 被控端工作台重放
   （`public/workbench.html`，09-12 桌面化改版）+ 全路径清理；回归 26/26。
   **✅ 升级 A1：SFU 版远程协助已落地（09-10）**——授权信令照抄，输入流改 `remote-input` 信令转发
   + 服务器门禁；sfu 前端第 14 步、workbench 两版共用；导读 LEARN.md 5.7；回归 SFU 19/19。
   **真实控制操作需用户开浏览器验证**（命令行只验信令）。
   **✅ 升级 A2+A5：中文 IME + 控制质量工程化已落地（09-11，两版同步）**——
   A2：隐藏 IME 捕获框 + `compositionend` 整段中文（``{kind:'input-text'}``），key='Process' 闸门；
   A5：鼠标/滚轮 16 字节二进制帧 + RTT 自适应节流 + Mesh 版 bufferedAmount 积压丢帧；
   SFU 服务器 `ArrayBuffer.isView` 放行二进制帧（坑 16/17）。回归 SFU 21/21 + Mesh 26/26。
   **真实中文输入/二进制帧效果需用户开浏览器验证**（命令行只验信令透传）。
5. ✅ **2026-09-11 大升级：A 档（远程协助深化）+ D 档（会议本体/SFU 深究）全部落地**——
   以 **SFU 主版本**为准，Mesh 对照版同步实现可行处（见第 2 节功能表 11/12 行）：
   - **A 档**：A3 剪贴板双向同步 / A4 截图 + 分块文件传输（服务器配额校验）/
     A6 限时授权（服务器权威计时 + 双端倒计时）+ 本地审计日志 + 拉黑 / A7 触屏；
     导读 **LEARN.md 2.13**；
   - **D 档**：D1 Simulcast 三档 + 服务器按丢包率自动升降层（迟滞防抖）/ D2 服务器端
     AudioLevelObserver 说话人检测 / D3 设备热切换 / D4 成员状态机 + 房主踢人 /
     D5 canvas 合成录制 / D6 断线重连（整条媒体链路重建）；导读 **LEARN.md 5.8**；
   - **回归（2026-09-11 实测）**：SFU 信令 `npm run test:sfu` **41/41**、Mesh 信令 `npm test` **33/33**
     （新增 7 项 A6 断言，原 26 项零改动）、**SFU 前端无头冒烟 `npm run test:smoke` 23/23**
     （`scripts/test-sfu-client-smoke.js`：假 DOM + 假 mediasoup 真跑 client.js，
     断言 simulcast 三层接线/控制采集/文件分块/重连，**零依赖且不用起服务器**）；
   - **Mesh 对照版同步**：`public/client.js` 第 19~25 步（剪贴板走 ctrl 通道、文件走 DataChannel
     16KB 分片 + `bufferedAmount` 背压、说话人用浏览器端 AnalyserNode、`server.js` 新增
     `scheduleRemoteExpiry()`）；
   - ⚠️ **待人工验证**（命令行验不了）：simulcast 三档是否协商成功、说话人高亮、录制产物可播、
     剪贴板权限、触屏手势、文件大文件传输 —— 清单见 `后续升级方向.md` **第 0.2 节**。
5.5 ✅ **2026-09-12 插队完成 F 档前三刀（对齐商业产品体验，参考声网形态，仅 SFU 主版本）**——
   F1 宫格/演讲者双布局 + 钉选 + 双击全屏 / F2 每成员网络质量点（`net-levels`）/
   F3 加入前预览页（设备检查 + 试音条 + 预静音）；SFU 前端第 **25~26 步**，
   服务器新增 `startNetLevelBroadcaster`（房间销毁清定时器），协议新增 `net-levels`；
   回归 SFU 41/41 + 冒烟 **31/31**；导读 **LEARN.md 5.9**；F 档全貌与 F4~F7 见 `后续升级方向.md` F 档；
   ⚠️ **待人工验证**：预览页镜像/试音条、演讲者视图跟随、钉选常亮、双击全屏、网络点变色。
5.8 ✅ **2026-09-12 D+ 档首刀：D+1 SFU 数据通道完成**（"此后以 SFU 为主深究"的第一步）——
   `create-webrtc-transport` 开 `enableSctp`+`numSctpStreams`（应答带 `sctpParameters`，坑 15 同款
   "服务器字段名 transportId、客户端要 id" 映射照旧适用）；新事件 `produce-data`（必须带浏览器
   `sctpStreamParameters`）/`consume-data`（建好即用、**无 resume**）/`close-data-producer`
   + 广播 `new-data-producer`/`data-producer-closed`；`room-members` 清单带老成员 `dataProducers`；
   前端第 6 步 `wireTransport` 多接 `procedata`；**第 27 步** `setupDataChannel`/`subscribeData`/
   `handleDataMessage`（含排队竞态防护）；**第 11 步聊天改双路径**（SCTP 主路 + 信令兜底，msgId 去重，
   sendChat 用 `chatDataProducer.send(JSON)`）；`resetMediaState` 清数据频道（重连复用 D6）；
   protocol.js 新增 D+1 段；回归 SFU **50/50**（+9）+ 冒烟 **37/37**（+6，桩升级：
   FakeTransport 加 produceData/consumeData + FakeDataProducer/Consumer）；导读 LEARN.md **5.10**；
   ⚠️ **待人工验证**：真实 SCTP 收发（两窗口互发聊天看 `🛰️` 日志；信令兜底会重复到达一次属正常双发）。
5.10 ✅ **2026-09-17b 实时字幕（AI 线 L1，C 档入场）**——Web Speech API 零依赖零费用：
   「💬 字幕」开关 + 舞台字幕条（interim 半句本地跳动/final 成稿广播）+ 字幕账本 cap.log
   （C2 的 LLM 输入）+ txt 导出；只广播 final 不广播 interim、无信令兜底（可靠性按内容
   价值定价）；onend 续命 + network 降级；冒烟 **71/71**（+7）+ 信令 66/66 不变；
   导读 LEARN.md 5.19。至此 C2 的两份输入（字幕流+审计流）就位，只差 LLM key。
5.9 ✅ **2026-09-17 F6 滤镜与虚拟背景（F 档收官）**——纯前端零依赖不加信令：GPU 滤镜 5 档 /
   磨皮 / 绿幕蓝幕色键抠像换背景（不引 ML 模型）；处理后轨顶替进 localStream（三处旧代码零改动）
   + switchCamera 绕管线分支；CPU 账徽标（EMA ms/帧）；预览页所见即所得；冒烟 **64/64**（+7）
   + 信令 66/66 不变；导读 LEARN.md 5.18；**F 档 F1~F7 全清，至此路线图 A/D/D+/E(除 E3)/F 全部完成**。
5.11 ✅ **2026-09-13 五线并进**：观测面板（`snapshotRooms` + `/dashboard`）/ F4 回应+举手+发言占比
   （第 26b 步）/ 可达性自助版（config.json + 自动 HTTPS + ICE 下发 + 🔗 徽标）/ workbench v3 拟真
   （HUD 字幕）/ UI 主题翻新；信令 **53/53** + 冒烟 **44/44**（+Mesh 33/33 不变）；导读 LEARN.md 5.11。
5.12 ✅ **2026-09-14 深化**：SCTP 多频道（chat+annot）/ **F5 批注**（第 26c 步，`annot` 频道 + to 定向头）/
   带宽估计可视化 / UI 主题 v2；冒烟 **49/49** + 信令 53/53；新坑：冒烟桩顶层 window API 要防御式调用；
   导读 LEARN.md 5.12。**09-14b**：前端全量重构（应用壳布局 + 整份新样式表，id/契约类零改动），
   Mesh 样式保持不动。**09-14c**：**D+3 ✅**（VP9 SVC + 服务器侧 ABR 双维度）、**D+4 ✅**
   （空房 60s 宽限 + 房主迁移）、**E5 ✅**（start:demo + 5 分钟讲稿）；信令 **56/56**；导读 5.13。
5.13 ✅ **2026-09-15 持续升级 + 三连收官**：**D+2 服务器侧录制代码就绪**（PlainTransport+SDP+ffmpeg）
   → **09-15c 端到端打通**（TEST_RECORD 自测 251KB/4.0s，`npm run test:record`）；**F7 白板 ✅**（第 26d 步，
   第三条 `board` 频道）；**E1 TURN ✅**（openrelay 预置 + deploy/coturn 自建包）；前端美学（中国色 + 星云氛围）；
   Mesh 版补 HUD 派发与 🔗 徽标；信令 59/59 + 冒烟 53/53 + Mesh 33/33 + test:record PASS；导读 5.14~5.16。
5.14 ✅ **2026-09-16 可交付 + 基础功能**：**坑 26 排版根治**（CSS 注释 `*/` 陷阱）+ 玻璃质感回归；
   **登录/注册 ✅**（users.json + scrypt + auth 三信令 + 昵称贯通，第 2.5 步）；色调重塑（水墨丹青）；
   **一键局域网交付 ✅**（start:lan 探 IP/生成配置/HTTPS 自签/放行防火墙）、**test:turn ICE 实测 ✅**、
   **部署手册.md / 跨电脑连接-操作指南.md / 性能测试报告.md**、邀请链接跨电脑化、端口占用友好化；
   信令 66/66 + 冒烟 57/57；导读 5.17。
5.15 ✅ **2026-09-17 F 档收官 + AI 线开工**：**F6 滤镜与虚拟背景 ✅**（第 28 步，纯前端零依赖）；
   **实时字幕 L1 ✅**（第 29 步，Web Speech API + 字幕账本 cap.log）+ 09-17c 历史抽屉与 caption 入状态机；
   信令 **67/67** + 冒烟 **76/76**（+Mesh 33/33）；导读 5.18/5.19。5.16 ✅ **2026-09-17e 过夜值守立项 + C3-N1 落地（"能跑一晚上最少 7 个小时"）**——
   两份 AI 文档升级（AI部分功能计划.md 第 3.6 节 + 路线图 C3 行）；N1 零依赖落地：
   client.js **第 30 步**（看门狗/溢出归档/值守统计）+ `/api/captions` + `npm run soak`；
   信令 **72/72** + 冒烟 **87/87** + soak 压缩 PASS；导读 **LEARN.md 5.19.5**；
   N2 定时纪要（LLM 分段总结+终稿）等 key；真 7h 过夜在 0.2 节人工清单。

6. 🔜 **下一步 = `后续升级方向.md` 第 1 节「AI 会议助手主攻」（2026-09-24 已大幅推进，剩三条尾巴）**——
   **本次已完成**：阶段 0~2 三件套脚本（`scripts/chat.js` / `summarize.js`（map-reduce 长文本）/
   `agent.js`（手写 ReAct 循环））+ **密钥托管与统一 provider**（`sfu/ai/provider.js`，env > `.env` >
   `config.json` 的 `ai.key`，密钥永不下发）+ **流式打字机**（`ai-stream`）+ **📝 纪要入口** +
   助理缺位自动入会 + LLM/Mock 徽标与 token 用量 + `/metrics` 的 `sfu_ai_llm_*` + `npm run test:ai`
   双轨自检（10/10）；C1 AI 操作员（09-19g）在**有 key 后**已能走 LLM 计划（不再只有 Mock 脚本）。
   **还剩**：① 0.2 节人工验证清单（打字机观感 / 真开会十分钟看纪要质量 / 操作员 LLM 计划演示 /
   跨机画面）② 值守联动的**真 LLM 分段纪要**（现已连通，需一次 ≥1h 实测确认落盘与费用）
   ③ 之后接新方向：E3 浏览器端 e2e（0.3 节）或 G 档备选池（该文件第 2 节）。
   论文提纲/录屏用户明确押后。LLM 仍走 **DeepSeek API**（内置 fetch，零新依赖），
   **Mock+真测双轨**为全项目 AI 功能的统一约定（见坑 39）。
   **另有真实剩余项**：① 0.2 节"做完但没实测"清单（浏览器人工验证，10 分钟就能补一批）；
   ② E3 浏览器端 e2e（现只有零依赖冒烟 118 项）；③ 论文提纲/录屏（用户明确押后）。
   G 档其余六项（云部署/录制回放/PWA/安全/可观测/规模）压缩为该文件第 2 节备选池，做完主线再挑。
7. 🔜 排错/优化：chrome://webrtc-internals

**AI 规划（AI部分功能计划.md）**：作者已接受"申请 API 密钥 + 少量费用"，并决定**先学 agent 基础再定 AI 形态**。
学习路径：阶段 0 写 `chat.js`（调 DeepSeek API 一问一答）→ 阶段 1 `summarize.js`（会议文本总结）→
阶段 2 `agent.js`（手写 50 行工具调用循环，不学 LangChain）→ 阶段 3 接入会议（ASR + LLM）。
功能方向池见 AI部分功能计划.md 第 9 节（WebRTC 增强 / 协作差异化 / AI 类，含难度与简历价值评估）。

**简历叙事主线**：从 1对1 → Mesh 多人 → 屏幕共享 → 群聊 → 房间化 → 入会密码 → getStats 监控
→ **SFU 架构升级（主版本，sfu/ 目录）** → **H5 远程协助（Mesh P2P 版 + SFU 信令版双形态）**，
每个节点对应 PDF 章节，README 有完整历程表。
后续可选择方向：升级菜单 A3~C2（`后续升级方向.md`；A1/A2/A5 已 ✅）/ AI 会议助理（AI部分功能计划.md）/
把 SFU 版扩成毕设完整版（EVOLUTTON.md）。

---

## 9. 干活守则（省 token 版）

1. **按需读档**：本文件已是浓缩记忆，一般任务别通读 README/LEARN.md，直接打开要改的文件——代码按「第 N 步」分段，先 grep 步骤号/关键词定位，再带 offset 局部读，读懂上下文再动手。先确认改哪版：Mesh=根目录/3000，SFU=sfu/ 目录/3001（坑 14）。
2. **改完必验**：`node --check` 改过的 js → 起对应版本服务器 → `npm test`（Mesh）或 `npm run test:sfu`（SFU）。摄像头/共享/聊天命令行验不了，完成后用一行清单请用户开浏览器确认，别替用户宣称已验证。
3. **教学风格是灵魂**：中文大段注释 + 「第 N 步」编号不许删；新功能只往 LEARN.md 对应小节和 README 功能表追加相关行，别重写整份文档。
4. **红线**：不加新依赖除非必要；不动 `public/vendor/`、`sfu/public/vendor/`；不删 `node_modules/mediasoup`、不改 `.npmrc`（坑 12）。
5. **交流**：简体中文；交付标准"能跑 + 能讲 + 有验证"；汇报只给结论和关键证据，别贴大段代码/日志。
> **09-17 F6 滤镜与虚拟背景 ✅（F 档收官，F1~F7 全清）**——纯前端零依赖、不加信令：
> canvas 三站流水线（GPU ctx.filter 滤镜 5 档：原图/自然/冷白/暖阳/水墨 → 1/4 画布低清模糊
> 放大=磨皮 → 绿幕/蓝幕**色键**逐像素抠像换背景墨/绢/鎏金/图片，双画布解决 putImageData
> 连 alpha 替换问题）；**核心接线 = 处理后轨顶替进 localStream**（cameraTrack 指向 canvas 轨，
> publishTracks/关摄像头/D6 重连三处零改动）+ switchCamera 加"绕着管线走"分支（换管线输入源，
> 绝不 stop procTrack）；每帧 EMA 耗时徽标 = 路线图要求的"CPU 账"可视化；预览页所见即所得
> （pjFxBtn 与会内 fxBtn 共用浮层）；无头降级（getImageData 探测）；client.js **第 28 步**；
> 冒烟桩补 getImageData/captureStream 带轨，**64/64**（+7）+ 信令 **66/66** 不变；导读 LEARN.md **5.18**；
> 坑 27：假 DOM 的 classList 不从 HTML 初始化（toggle 开合反转）；坑 28：冒烟帧循环桩约 9ms/帧
> （setTimeout 链），断言等待要放宽；
> ⚠️ 待人工验证：滤镜观感、绿幕抠像质量（需纯色背景）、CPU 账真实量级、双窗观众端同步

> **09-17b 实时字幕 ✅（AI 线 L1 开工，C 档入场）**——Web Speech API 零依赖零费用（不需要
> LLM key）：控制坞「💬 字幕」开关；每端识别自己麦克风（省带宽/隐私/语言跟人走）；
> interim 半句只本地字幕条跳动、final 成稿经 SCTP chat 频道广播（type:caption，不做信令
> 兜底不做去重——字幕容忍丢、聊天不容忍，可靠性按内容价值定价）；Chrome 60s 自动断 →
> onend 300ms 防抖续命；network 错误明确降级；字幕账本 cap.log（ts/from/name/text，500 条）
> = C2 会议纪要/问答的 LLM 输入 +「⬇ 记录」txt 导出；client.js **第 29 步**、captionBar UI；
> 冒烟桩加 FakeRecognition（可驱动 onresult/onend），**71/71**（+7）+ 信令 66/66 不变；
> 导读 LEARN.md **5.19**；坑 29：多频道冒烟里 dataMessageHandler 是"最后订阅者"的
> （F7 board 订阅覆盖 chat 路由，字幕断言前要重订 chat 刷回）；
> ⚠️ 待人工验证：真机中文识别效果（Web Speech 依赖浏览器厂商云端，国内网络可能不可达=
> 预期降级）、双窗字幕互见、导出 txt 内容

> **09-17c 实时字幕深化**——① **字幕历史抽屉**（字幕条「⌃ 历史」开合：cap.log 滚动视图
> 最近 100 条、抽屉开着时新字幕追加一行+滚底、渲染全 createElement+textContent 防 XSS）；
> ② **字幕开关进房间状态机**：member-state 白名单加 caption → room-state 快照带 caption →
> 成员列表 💬 徽标（与 hand 同一信任模型）；冒烟 **76/76**（+5）+ 信令 **67/67**（+1）；
> **坑 30：room-state 快照序列化与 member-state 白名单是两份清单**——加状态字段必须同时改
> broadcastRoomState 的 map 和事件 5.7 的 for 白名单，漏一处 = 字段永远到不了前端
> （测试表现：room-state 的 Promise 永不 resolve，测试卡死）。

