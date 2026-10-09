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

> **★ 2026-10-02d 语音链路根因修复（用户报"AI 一直收到重复的一句话 / 对话很混乱 / 延迟很大 /
> 后边它回答没有说话 / 刚刚都听不到声音"，五症同源）+ 仓库搬到 D 盘后的卫生收尾**——
> ① **根因**：whisper 在**纯静音段**把 `--initial_prompt` 续写成句子，账本每 2.4~4s 出现一条
>   一模一样的「请用简体中文输出。」（证据 `sfu/captions/cap-746646-20261002.jsonl`）；旧门槛
>   `size<40000` 量的是**时长**不是**能量**，4s 静音 128KB 照进转写 → 假字幕落进 20s 追问窗口
>   → 每条触发一次完整应答（风暴+账本污染）→ 又把 `lastUserSpeechTs` 刷新 → 朗读闸永久关闭。
>   **修法四件**：`Asr.measureWavLevel()` 能量闸（Node 里读 PCM 算峰值 dBFS，<-45dB 删段**连模型都不叫**）
>   + `Asr.cleanTranscript()` 语义清洗（提示词回显/「字幕by」/「谢谢大家」/纯标点→空串），
>   提示词改中性短语并**单一来源**（`Asr.ASR_PROMPT`，worker 经 `ASR_WORKER_PROMPT` 取用）
>   + 成句处**重复句闸 + AI 回声闸**（归一化包含判据，`ASR_DUP_MS` 15s / 回声 45s）
>   + 应答侧**在途锁 + 最小间隔 + 窗口只在实际接话时顺延**；客户端唤醒自动提问加 8s 同句去重。
> ② **"后来不出声"两条真死锁**（坑 66）：`speakAiText` 的让位闸把 `ai-tts-fail` 的回落也挡死
>   （`force` 例外口修好）+ `aiTtsEnabled` 进房读一次终身缓存（服务器**定期重探**补上真定时器、
>   翻转广播 `ai-tts-state`、客户端连败 2 次本地自愈）；`ai-audio` 改**顺序队列**、
>   销账时机改成"真的开始播"（onplaying）、onerror 才回落浏览器朗读、hush 连队列一起清。
> ③ **★ Qwen 双引擎"写了但从来没生效"的真相**（用户问"是没实现还是还在用 whisper"）：
>   `sfu/server.js` 找模型目录用的是 `path.join(__dirname,'models')` 而 server.js 在 sfu/ 下 →
>   它找 `<根>/sfu/models`（不存在）→ `QWEN_*_MODEL` 永不设 → 两个 `warm()` 一次都没被调用
>   （启动日志从来没有那两行 🔥）。路径改为按项目根解析后**双 worker 正常预热**；
>   `config.json` 切 `asrEngine:"qwen-local"`（whisper 自动兜底）、`announcedIp` 修成本机真实 WLAN IP；
>   `/config.json` 新增 `asrEngine` 字段且 `asrEnabled` 不再等价于"装了 whisper"（否则换引擎会谎报
>   没耳朵、前端退回浏览器识别）；`start:lan` 改为**合并式生成**保留手工字段
>   （配置被工具静默吃掉就是 qwen-local 丢失的直接原因）。
> ④ **延迟（实测数字，别凭感觉优化）**：探针量到 **Qwen3-TTS 本地 CPU 合成一句要 44s**
>   （答案 3.0s 就上屏、声音 47.0s 才到）——这就是"我跟它说话延迟很大、后边它回答没有说话"的
>   第二个独立成因。据此改策略：**实时播报默认走浏览器朗读（即时）**，本地神经音色改成
>   显式开关 `config.aiTtsLocalWait` / `AI_TTS_LOCAL_WAIT=1`（Edge 可达时它仍是又快又好听的第一选择）；
>   `speakAnswerForRoom` 顺序改成 **Edge → 本地 Qwen(需显开) → ai-tts-fail**，且整段答案
>   改**按句流水线**（`splitForTts` 最多 3 段，合成完一段立刻发一段）；
>   判据 `serverVoiceReady()` **只写一处**，`tts:` 标记 / `/config.json` 的 `aiTtsEnabled` /
>   预热后的 `ai-tts-state` 广播三处共用它（原先各判各的，会造出"页面让位、服务器不发"的两头静音）。
>   应答在锁内等完但带 30s 保险丝；静音段不再占 ASR 并发闸。
>   复测：提问→答案首字 2.8s、答案完成 3.0s、**答案上屏→通知前端回落浏览器朗读 0.0s**
>   （以前这个等待是"永远不来"）。
> ⑤ **仓库卫生（搬 D 盘后排查）**：`models/`(4.1GB) 曾被 `git add -A` 带进索引（目录自带 LFS
>   `.gitattributes`）→ 加 `.gitignore` + `git rm -r --cached`（**磁盘文件一个未动**，
>   引擎照常加载）；`.workbuddy/` 同样取消跟踪；**仍未解决**：4.1GB LFS 对象还躺在 `.git/lfs`、
>   本轮全部改动仍未提交且**仓库无 remote**（唯一副本在 D 盘）。
> **回归（2026-10-02 实测）**：`test:asr` **28 通过/1 跳过**（+10 静音幻觉清洗与能量闸）、
>   `test:asr-live` **PASS**（一条拼接音频跑完断言：**静音期零字幕、"说→停→再说"只入库 1 条、
>   AI 只应答 1 次**——修复前实测 8+ 次；并断言"声明 tts:'server' 就必须给出 ai-audio 或
>   ai-tts-fail"，杜绝无头静音）、`test:sfu` **189/189**（+2 引擎可见性/口径一致）、
>   `test:smoke` **196/196**（+7 让位闸例外、队列销账时机、hush 清队列、状态翻转监听、唤醒去重）；
>   新记 **坑 64/65/66**（坑 65 是本轮自查抓到的**我自己写的假绿**：换进程推流=换 UDP 源端口
>   =comedia transport 丢包，"0 条"绿得可疑 → 改成一条拼接 wav 一次推流）。
> **★ 2026-10-02e AI 头像重做 + Piik 四条取长 + pyprobe 收口（用户："有重影、一直重复一个动作"；
> "Piik 四条我都想实现"；"把现有问题都解决"）**——
> ① **头像重影的真相是两层节奏叠加**：形象素材是 82 帧循环 WebP，抽帧（`ffmpeg -i x.webp f%02d.png`）
>   看到 f41 头部/肩部带**半透明偏移残影**（AI 生成动画烘进帧里了），而 CSS 又对这张"本来就在动"的图
>   叠了一层 `aiFaceBreathe` 缩放 → 重影+发抖；而"一直重复一个动作"是循环素材的本性（不可能看场合变招）。
>   **修法 = 形象与动作彻底分开**：一张干净静帧（取循环起始帧 → `xiaoming-idle.png`，行与格共用同一张，
>   坑 47）+ 动作全交给 CSS；每元素同一时刻只允许一条动画（常驻呼吸在 `.ai-face`、状态律动与小动作互斥
>   由 `armAiGestures()` 保证）；idle/listening 每 7~14s 随机演**一次性**小动作（nod/tilt/peek-l/peek-r/
>   sway/breath-deep），演完摘类，`animationend` 与超时保险丝共用一个只生效一次的 finish。
>   顺手删掉从未被调用的 `aiAvatarSvg()` 及其整套 `.ai-svg*` CSS（死代码），并修圆盘尺寸：
>   旧 `width:min(76%,320px)` 在 403×227 的扁格里顶天（实测顶部留白 -3px、压名牌 -49px）→
>   改**按高度**定尺寸 `height:min(66%,224px)` + `top:43%` + `object-fit: contain`。
> ② **Piik 四条全部落地**：**(a) 每路独立音量 0~200%**——安全分层：0~100% 走 `video.volume`
>   （零风险），>100% 才挂 WebAudio `GainNode` 且此时必须 `video.muted=true`（否则双重回声），
>   增强不可用**回落 100% 而不是静音**；流换对象（replaceTrack/D6）必须重挂（`n.stream !== srcObject`，
>   否则"调大音量反而没声"）；三条删格路径都 `detachTileGain`（长跑不漏节点）；按成员 id 存 localStorage。
>   **(b) 只听不看**——新信令 `set-consumer-paused {consumerId,paused}`（服务器 `consumer.pause()`，
>   前端 display:none **不省带宽**、只有服务器停转发才省）；权限天然按 `socket.consumers` 隔离
>   （结构上关不掉别人的画面）；**ABR 守卫** `if (consumer.paused) return`（坑 21/62 同一条纪律）。
>   **(c) 定向回应**——react 消息加 `to`（复用 F5 批注的定向头语义，广播通道 + 应用层过滤），
>   成员行「只对 TA 回应」按钮 + 回应条「→ 小张」胶囊，20s 过期 + 发完即清；
>   诚实边界写进注释：**定向 ≠ 隐私**（消息仍到所有人手里）。**(d) 进房前 ICE 预检**（第 34 步）——
>   一次性 RTCPeerConnection 用**同一批下发的 ICE**收集候选，relay>srflx>host>无 四档结论 + 三色，
>   把坑 36 的"沉默故障"说成人话并指回《部署手册》；不阻塞进会。
> ③ **★ 新坑 67：探测超时被当成"没装"在 Qwen 模块上复发（三处同源已收口成 pyprobe.js）**——
>   实测 `import qwen_asr` 冷启动 **21.7s**、`import qwen_tts` **18.4s**（torch 一族），
>   而三个模块的探测都写死 `timeout: 15000` + "err 即没装" → 机器一冷就误判、本地引擎悄悄不启用；
>   更糟的是 `warm()` 恒返回 undefined，启动日志**无条件打 🔥 已预热**（假绿，没人会去怀疑一行日志）。
>   修法：新增 `sfu/ai/pyprobe.js` 作唯一实现（区分 enoent/ModuleNotFound/timeout、超时重试一趟 90s、
>   解释器逐个试），`warm()` 返回 boot() 结果、调用方按返回值说实话。
> **回归（2026-10-02 实测）**：`test:smoke` **224/224**（+28：头像 8 条、音量 7 条、只听不看 4 条、
>   定向回应 4 条、ICE 自检 5 条；本轮首次让测试读 style.css——坑 26 那类 CSS 缺陷过去无人值守）、
>   `test:sfu` **191/191**（+2 暂停门禁/错误不传染）、`test:e2e-media` **15/15**（原 5 项 →
>   真浏览器实证：暂停前解码帧 66→97、暂停后 **97→97 停增**、恢复 116→146；40% 走元素音量、
>   180% 走音频图且元素静音、回 100% 解除静音；ICE 自检实测出「打洞可用」）、
>   `test:asr` 28 通过/1 跳过、`test:asr-live` PASS、`doctor` 19/2/0；
>   仓库卫生：`.git` 从 4.4G 降到 293M（孤立 LFS 对象已确认 0 引用后删除，`models/` 权重原封未动）。
> **★ 2026-10-02f 让 Qwen 音色"能用得起"：语音流水线 + 引擎自适应字数预算**
> （用户："有没有办法用 Qwen 的音色但延迟低一点，这太高了"）——
> ① **结构性那一刀：LLM 与 TTS 重叠**（`makeSpeakPipeline`）。原来必须等整段答案生成完
>   才开始合成第一句，而 `aiBrain` 本来就是流式的（每 12 字一吐）——现在每收到一段增量就
>   切出"已完整"的句子立刻送合成，LLM 写第 2、3 句的时间与第 1 句的合成时间互相盖住。
>   配套：`answerTs` 提前生成（音频可能比 chat-message 先到，两者要靠同一个 ts 配对），
>   客户端加 `playedServerTts` 集合——**已经播过的 ts 不再挂回落账**，否则之后一条
>   `ai-tts-fail` 会把念过的答案再念一遍。
> ② **引擎自适应字数预算**（`config.aiTtsMaxChars` 默认 48）：只在"慢引擎（本地 Qwen）说话"
>   时生效，超预算的部分只以文字显示并打日志。Edge 可达时预算放宽到 500——
>   **约束要按引擎的能力定**，一刀切等于给可用引擎降级。
> ③ 播报链拆成 `synthAndEmit`（单段）+ `speakAnswerForRoom`（整段，@ai 用）+ 流水线（语音问答用），
>   三者共用同一个"要么出声、要么 ai-tts-fail"的收口（杜绝无头静音）。
> ④ 新配置键写进 `config.example.json`（复制即用）：`aiTtsLocalWait`（本地神经音色是否抢实时播报，
>   默认 false）、`aiTtsMaxChars`。实测数据：本地 Qwen3-TTS 单句 12s、整段 44s（RTF>1，
>   合成比播放慢，这是 CPU 自回归的硬账，不是 bug）。
> **回归**：冒烟 224/224、信令 191/191 复跑全绿（流水线重构后）；
> `npm run bench:tts`（`scripts/bench-tts.py`）基准在量 dtype / non_streaming_mode / 批量三句 等开关的真实收益，
> 结论回来再决定要不要改 worker 的加载参数（**不凭猜调优**）。
> ⚠️ **待人工浏览器验证**（命令行验不了）：两窗真开会时"喊小明→它只答一次、不再重复刷屏"、
>   AI 语音**听不听得见**（Edge 端点仍 403，本地 Qwen3-TTS 音色是否真的出声）、
>   说完到出字幕的体感延迟、以及"它听不到声音"是否还在发生（若还在，看服务器日志有没有
>   `🤖 AI 小明开始聆听` 与 `[ASR/qwen-local]`/`[ASR/常驻]` 两类行，能立刻定位断在哪一环）。


> **★ 2026-10-02g 「不说话」与「还在用 whisper」的最后两半（用户："还是失败了…它回答的时候不说话
> / 我要的是不乱说话不是不说话 / 你可以直接测试直到能正常使用"）**——本轮全部在**真浏览器**里取证。
> ① **"还在用 whisper"是界面在撒谎，不是引擎没切**：`config.asrEngine` 早已是 `qwen-local`、
>   转写实测 `[ASR/qwen-local] 1.4s / 2.4s`，但**三处硬编码的 "whisper" 字样**分别写在
>   字幕状态徽标、toast、流程日志，加上服务器启动那行无条件打 `whisper.exe`——
>   用户只能看见界面那行字，于是得出"根本没切换"的结论（坑 67 的 UI 版：**过期声明比缺失更糟**，
>   它会让人去装已经装好的东西）。修法：`/config.json` 的 `asrEngine` 存进 `serverAsrEngine`，
>   三处 UI 与启动日志统一走 `asrEngineCn()`，启动日志改成"主引擎 = qwen-local；whisper 仅作兜底"。
> ② **"回答时不说话"还有第三条独立死锁**（前两条已在 02d/02e 修掉）：
>   `hushAiSpeech()` 每条字幕到达都开一个 **8 秒静默窗**，而语音对话的真实时序是
>   「说完 → 字幕到（开窗）→ 1.5~6s 后**这条提问的答案**送到」——答案永远落在自己开的窗里，
>   且顺手 `pendingServerTts.delete(ts)` 把浏览器回落账也销了 = **两头静音、零报错**。
>   修法 = **认人别认时间**：拉黑"被打断那一轮的 ts"（同一流水线分段共用 ts），新一轮是新 ts 天然放行，
>   不依赖两端时钟对齐；时间窗只留作"段没带 ts"的兜底判据。
>   浏览器那一轨同源：抢话闸的 700ms 字幕窗仍然每轮误杀，因为
>   **"字幕刚到"证明的是 1~3 秒前有人在说话**，而答案恰恰紧跟在自己的字幕后面——
>   改成**以麦克风即时信号为主判据**（130ms 级），字幕窗只在"根本没有麦克风可量"时兜底。
> ③ **朗读不再等整段答案写完**：`ai-stream` 的增量只进气泡不上嘴，长答案要等终态才开口。
>   新增 `speakStreamPart` + `enqueueAiSpeech(say,{replace})` 分句泵（`aiSpeakGen` 按代作废），
>   流里一出现完整一句就念、终态只补剩下的尾巴（前缀对不上则整段重念，**宁重不漏**）。
>   本轮自己写出来又被真机抓走的两个坑：(a) 朗读读的是 `box.buf`——那是 DOM **攒批后会被清空**的缓冲，
>   函数与调用点都对，但它永远只能看到一帧内的三五个字，句子根本不可能出现（改为独立副本 `box.rawAll`）；
>   (b) `cancel()` 掉的旧句子会**迟到地**回调 `onerror`，若它先于新一轮的第一句到达就把新队列整个倒空，
>   症状正是"第一轮问候语念完之后 AI 再也不出声"（顺序改为 cancel→清队列/断泵→再 push，并加代号守卫）。
> ④ **录音进程静音自愈**：`ffmpeg` 听觉进程在约 30s 无 RTP 后自己退出（`Error during demuxing`），
>   于是"挂在那儿没说话"之后 AI 永久失聪——`spawnRecorder()` 加 `exit` 自愈重启（≤5 次、换 segDir、
>   RMS 一来就重置计数），日志 `🩹 AI 听觉管线…自愈重启`。
> **实测（全部真跑，不是推断）**：`test:smoke` **237/237**（+41）、`test:sfu` **191/191**、
>   `test:asr` **28 通过/1 跳过**、`test:asr-live` **PASS**（qwen-local 转写 1.4s/2.4s，
>   静音期零字幕、ASR 2 条 / 应答 2 次，语音交付回落浏览器朗读 **1.6s**）；
>   真浏览器（room 605280）取证三条：字幕状态显示 **「🖥️ 服务器转写（本机 Qwen3-ASR）」**、
>   抢话闸——字幕 1ms 前刚到 + 麦克风静默 → `speechSynthesis.speak` **被调用且 speaking=true**
>   （旧 2500ms 闸在此刻必然吞掉），麦克风真出声 → **被拦**（礼仪没丢）；
>   唤醒到答案 **2.7s**、答案到出声不再需要第二个等待，流式一句一 enqueue（46 次增量 → 3 句排队）。
> ⚠️ **仍需人工验证**：真人开麦两窗对谈的体感（假媒体在自动化浏览器里被拒授权，量不出真机手感）、
>   Edge 端点恢复后服务端神经语音是否切回、以及本地 Qwen3-TTS 音色（`aiTtsLocalWait`，CPU 一句 ~12s 仍未变）。

> **★ 2026-10-03a 六项连跑：弹窗循环 / 界面说实话 / AI 会操作会议实体 / 共享分层 /
> 选层器根本没出现 / 远程桌面手感延迟 2287ms→153ms**——用户点了六件事：
> ①语音彻底解决 ②前端丑 ③远程操控到底 ④会议本体完善+降延迟 ⑤AI 能操作实体（例：打开白板）
> ⑥把一份 hero 落地页提示词融进来。全部真跑取证，不是"应该没问题"。
> ① **用户被原生弹窗循环卡住（"一直弹这个"）**：服务器重启 → 内存房间没了 →
>   D6 自动重连拿旧 `myRoom` 再 join → `room-not-found` → **`alert()` 阻塞主线程** →
>   点掉 → 又重连 → 又弹。两个错叠加：**用阻塞模态报一个会重复发生的事件** +
>   **`myRoom` 从来没有作废路径**（进过房就永远自认为在房里，徽标还挂着死房号）。
>   修法是把"房间没了"做成一次**状态迁移** `giveUpRoom()`（清 myRoom/密码/令牌 + 拆媒体 +
>   回加入页），提示交给页内 toast。三条房间类 alert 全部下掉，冒烟加一条
>   **"全文件 0 次 alert( 调用"** 的结构断言（注释里也别写 `alert(`，会被自己的断言抓到）。
> ② **测试不许抢开发者的端口（用户："测试的时候不要退出 agent 啊"）**：
>   `test:sfu` 默认 3001、`test:asr-live` 也起在 3001/3443 —— 于是每跑一次回归就要先把
>   用户正在用的那一台踢掉，而"复用已有实例"又是坑 57 的假绿。改成
>   **信令 3011 / 语音自测 3017 + `SFU_NO_HTTPS=1` + 端口被占明确拒绝 + 环境变量可换**，
>   实测跑完两套回归后 3001 的 PID 一个没变。判据：**测试自起服务、自占端口**。
> ③ **"回答时不说话"的第三条独立死锁**（前两条见 02d/02e）：`hushAiSpeech()` 每条字幕
>   都开 8 秒静默窗，而语音对话的真实时序是「字幕到（开窗）→ 1.5~6s 后**这条提问的答案**到」
>   → 答案永远落在自己开的窗里，还顺手销掉 `pendingServerTts` 回落账 = **两头静音零报错**。
>   修法 = **认人别认时间**：拉黑"被打断那一轮的 ts"（同一条流水线分段共用 ts），
>   新一轮是新 ts 天然放行，不依赖两端时钟对齐。浏览器那一轨同源：抢话闸改成
>   **以麦克风即时信号为主判据**（字幕只证明"1~3 秒前有人在说话"，而答案总跟在字幕后面）。
>   顺带把朗读搬进流式：**一轮答案的第一句"只说最新"**（实测旧寒暄占满队列把新答案
>   堵到 8.1s 才出声，改完 1.97s）。
> ④ **AI 会操作会议实体（第 36 步）**：`ROOM_ACTIONS` 白名单（开/关白板、开/关字幕、
>   切演讲者/宫格）+ `detectRoomAction` 规则路由**排在 LLM 之前**（tools-first，坑 38），
>   服务器只广播 `room-control {action, byName, ts}`，客户端照表落地。
>   **边界写死**：只动"房间级共享状态"，凡动用户设备的（摄像头/共享/静音别人/发消息）
>   一律不进这张表 —— 冒烟里有一条**结构断言**：白名单里出现 camera/screen/mute/record 直接红。
>   中文规则把"关"排在"开"前面判（「把白板关掉」否则跨词命中"打开白板"），
>   动词表要覆盖同义词（第一次只写「打开字幕」，测试用「开启实时字幕」就整条不命中，
>   症状恰是"AI 回了漂亮话、什么都没做"）。断言按**事件真的到了两个客户端**写，不按回复措辞。
> ⑤ **屏幕共享补 simulcast**：共享一直是单层全分辨率上传，弱网观众只能
>   "卡成幻灯片或什么都看不见"二选一；而服务器 ABR 的守卫是 `kind==='video' && layerCount>1`
>   —— **层数>1 就自动生效，服务器零改动**。新增 `SCREEN_SIMULCAST_ENCODINGS`
>   （250k/1.2M/2.8M，比摄像头整体高一档：屏幕是文字线条，压狠了看不清等于没共享）
>   + `contentHint='detail'` + 单层兜底。
> ⑥ ★ **选层器从来没被创建出来**（写 e2e 断言才抓到的真 bug）：服务器的
>   `layer-changed(initial)` 在 consume 的 **ack 之前** emit，而格子要等 ack 回来才登记进
>   `consumerTiles` → 通知到达时 `tile` 是 undefined → `ensureLayerPicker` 直接 return →
>   DOM 里一个 `.layer-pick` 都没有（真浏览器实测：层数 3 明明在 `layerState` 里，画面却选不了）。
>   修法顺着"一个概念只有一个来源"：**`layerState` 是账本，格子一出现就照账本补渲染**，
>   不去调服务器 emit 时序。
> ⑦ ★ **远程桌面手感延迟 2287ms → 153ms（15 倍）**：控制台以前只报 RTT 与帧率，
>   而"点下去→画面动"是另一条链（输入→代理执行→重画→抓屏→编码→回传→解码）。
>   量出来才看见根因：**CDP screencast 是变化驱动的，像素没变就一帧都不发** ——
>   点了空白处 / 点了无视觉反馈的控件 / 只是移动鼠标，控制端就一直收不到画面，
>   体感"它半天才动"，而这**不是带宽慢，是没人报信**。
>   修法 = **输入回声帧** `scheduleEcho()`：注入后 120ms 复查，若抓屏没出帧就主动
>   `captureScreenshot` 补一帧；三重限流（突发合并 / 已出帧就不补 / 仍走帧间隔闸门），
>   `stopStream()` 撤权时清定时器（撤权后还去抓屏 = 多一次无谓的隐私面）。
>   回归上限从 3000ms 收到 **800ms**，让这条断言同时是"回声帧还在不在"的哨兵。
> ⑧ **`test:asr-live` 的"0 条也全绿"（坑 65 在我自己写的测试里复发）**：有一次实跑
>   `ASR 0 条 / 应答 0 次`，而下面每条断言都是"==0 / <=2" → 整组绿，绿的是"音频根本没进系统"。
>   补了**正向对照**（必须至少一条字幕真带上所说的那句 + 至少应答一次，否则直接红并列出四步排查），
>   PASS 行现在打印"正解命中 N 条（证明音频真进去了）"。
>   顺带查清自愈记账的错：ffmpeg 长时间无 RTP 会**干净退出（code=0）**，旧写法把它算进
>   5 次崩溃预算 → 预热等 65 秒就把预算烧光、真语音来时耳朵已经死了（目录里留着 -r1…-r5）。
>   改成**活过 15s 且 code=0 = 静音退场，自愈不限次**；崩溃仍 5 次封顶；
>   不再每代换目录（`-segment_start_number` 接着上一代编号写）。
> ⑨ **首页 hero 化（第 35 步 + style.css 第 28 节）**：借落地页的**编排语言**
>   （模糊引导语 → 打字机主句 → 胶囊 CTA → 严格 z-index 分层 → prefers-reduced-motion 降级），
>   **不借它的资源**——参考稿用外链视频 + 外链字体，与本项目"零依赖 + 可离线 PWA"冲突，
>   背景改纯 CSS 光晕 + SVG 噪点，字体继续本地衬线栈。顶栏三个入口全部接真功能
>   （检查设备 / 复用第 34 步那颗 ICE 按钮 / 开设备码面板），**不写假链接**；
>   冒烟新增一条**零依赖红线断言**：index.html 里出现 `href/src="http…"` 或 CSS 里出现
>   `@import url(http…)` 直接红。移动形态有意**不做汉堡菜单**（这一屏本身就是全屏遮罩，
>   再叠一层菜单遮罩只是给同一块地方放两张遮罩），理由写进 CSS 注释。
> **回归（2026-10-03 实测）**：`test:smoke` **254/254**（+17：hero 5 条、AI 房间动作 4 条、
>   共享分层 3 条、弹窗循环 2 条、朗读流水线与闸门若干）、`test:sfu` **196/196**（+5 房间动作）、
>   `test:e2e-media` **19/19**（+4：3 层 simulcast 真协商、降层真的让 videoWidth 320→160、
>   交回自动不锁死）、`test:e2e` **16/16**（+1 手感延迟 153ms）、`test:agent` **24/24**、
>   `test:asr-live` **PASS**（正解命中 1~2 条，qwen-local 转写 1.4~2.4s）、`test:asr` 28+1skip。
> **新记坑 69 / 坑 70**。
> ⚠️ **仍需人工浏览器验证**：屏幕共享的三层是否真协商（自动化浏览器里 `getDisplayMedia`
>   被拒授权 = `NotAllowedError`，这条命令行验不了；摄像头那条同一段代码已被 e2e 实证 3 层）、
>   首页 hero 在真机宽屏下的观感、AI 房间动作在第二台设备上的同步表现。


> **★ 2026-10-03b 把延迟"量出来"之后才知道之前一直在瞎猜（字幕延迟可视化 + 两个由它牵出的真缺陷）**
> ——用户诉求"延迟还要降低"，而本轮的最大收获不是降了多少秒，是**先让它可观测**：
> ① **字幕端到端延迟进界面**（client.js **第 37 步**）：服务器在定稿 `asr-caption` 带
>   `latMs`（起点=最后一个判定有声的 RMS 窗，窗长 0.5s，所以是**下限**、不虚报更快）与
>   `stage:{wait,trans}` 拆分；字幕条新增 `⏱ X.Xs` 三色读数（≤3s ok / ≤6s warn / 更慢 bad），
>   悬浮摊开"等待 vs 转写"与近 8 句均值最慢。**拆分才是可操作信息**：只有一个总数时
>   "慢在等静音判定"与"慢在模型"长得一模一样，而处方完全相反（前者调 asrSegmentSec/FLUSH_MS，
>   后者换引擎/降模型）。脏值/缺值一律**保持上一次读数**——会瞎填的读数比没有读数更糟。
>   权威统计走 `/metrics`（`sfu_ai_asr_caption_latency_ms{kind="avg|max|last"}` +
>   `sfu_ai_asr_caption_count_total`）、`/api/rooms` 的 `collab.capLat`、dashboard 单列一格
>   （**不并进"转写引擎"那格**：一格讲"谁在转写"、一格讲"多久"）；
>   另加 `sfu_ai_asr_primary_ready`（见 ③）。
> ② **真缺陷一：同一句被分段切碎 → AI 重复接话**（用户"我要的是不乱说话"的那一半）：
>   `TEST_ASR_WAIT_WARM=1`（让 qwen-local 真就位再喂音频）**第一次跑出 FAIL：3~4 条字幕 / 3 次应答**。
>   取证（`ASR_DEBUG` + `probe.onAny`）看到 4s 分段把「小明，帮我记一下明天下午三点的评审会」
>   切成「…三点的评审。」/「小明。」/「…3点的评审会。」三段**分别成句、分别唤醒**；
>   而旧三条重复句判据都要求"互相包含"，分段边界带来的 **三↔3 写法漂移 + 尾字截断**让两者互不包含 →
>   闸在此刻形同虚设。修法=新增纯函数 `Asr.isFragmentOf(prev, cur)`（**方向性** bigram 覆盖率：
>   只算"新句被旧句覆盖多少"且要求"新句几乎没有新增信息"）；方向性是必须的——先说「小明」再说
>   「小明，把纪要生成一下」是**新问句**，用对称相似度会把真问题吞掉（那比重复应答更糟）。
>   另：只比**同一个人**的前一句（两人说同样的话是两件事），短文本 bigram<3 不下结论（坑 53）。
>   实测：字幕 4→1 条、应答 3→1 次，**连跑两次都 PASS**（单次通过可能只是没撞上残留）。
> ③ **真缺陷二：自测被自己的历史污染**（一条假红查出来的）：字幕账本按 `<房间>-<UTC日期>`
>   一天一个文件、append-only，而自测固定用房间 999999，**清理只在 PASS 路径执行** →
>   上一次失败运行的残留被这一次数进断言，"本轮只产 2 条"却数出 4 条 → **从第二次运行起必然红**。
>   修法三条缺一不可：开场先清场、读取按 `ts>=本次起点` 过滤、清理挪进 `catch`（成败都收走痕迹）。
>   ▸ 判据：**回归结果不该依赖"上一次跑没跑干净"**（与账号类测试必须用临时库是同一条纪律）。
> ④ **兜底引擎预热被换引擎时悄悄砍掉**（09-30e 那把刀在 qwen-local 下失效了）：
>   09-30c 把引擎切成 qwen-local 时，whisper 的开机预热被改成"跳过"（理由：两套模型同时驻留白占内存），
>   代价实测被抓出：Qwen worker 冷启动 ~55s，这期间 `handleSegment` **现场起** whisper（带模型加载）→
>   **开机第一分钟每句字幕多等 15s**，正是当年要消灭的那个症状。
>   新策略 = **兜底先预热、主引擎就绪后 `releaseFallbackAsr()` 释放**（内存只在重叠窗口翻倍）。
>   实测首段 15.0s→11.3s、字幕延迟 **9.2s→5.3s**（whisper 路径），qwen-local 就位后 **3.5~4.0s**。
>   ▸ 顺带把 watch.js 的"引擎退回"告警**分诊**：新增 `sfu_ai_asr_primary_ready`，
>     区分"主引擎还没起来（预热期，正确行为，耐心等 N 轮）"与"起来了却不用（真退化，两轮就报）"，
>     超过 `WATCH_ASR_BOOT_ROUNDS`（默认 12 轮≈2 分钟）仍不就位改报 `asr-engine-stuck`；
>     老服务器**没有这一行**时退回旧判据——"读不到"≠"读到 0"，否则告警永远不响。
>   ▸ 另修 `test:asr-live` 的一条断言口径：抢跑代码原本排在 `pick` 的 `continue` 之后，
>     而"刚说完话"那一刻恰恰没有封口段 → **抢跑在那一刻根本执行不到**（顺序已改）。
>     诚实记录：同一 fixture 复测总延迟没立刻降（wait 4.0s vs 4.2s），因为这里的 wait 主要被
>     **上一段还在串行转写**占着（首轮单段 6.7s）；顺序仍然对，但它值不回"立刻变快"这个说法，
>     所以数字写进注释而不是写进成绩。**下一刀靶子由此明确：转写串行**（loop 里 `await handleSegment`，
>     而 `ASR_CONCURRENCY` 允许 2 路，这里一次只用一路）。
> ⑤ **协议总表补掉一整类漏写**：`sfu/protocol.js` 原来只列 C→S 请求，**语音链路的 S→C 广播全缺**
>   （`asr-caption / ai-state / ai-audio / ai-tts-fail / ai-tts-state / board-state / board-record /
>   remote-quality`）。这类"没有 ack、没有重发"的下行事件漏写，后来人只会照请求侧改，
>   客户端监听挂漏也不会报错。补的时候逐个 `grep` 证伪（坑 43），八个名字服务器与客户端都在用。
> **回归（2026-10-03 实测）**：`test:smoke` **272/272**（+9 延迟读数与拆分，含"脏值不编数"）、
>   `test:sfu` **206/206**（+2 metrics 三读数 + `/api/rooms` 与 `/metrics` 同源）、
>   `test:watch` **27/27**（+14：延迟退化判据 + 预热期分诊）、`test:asr` **36/36**（+6 碎片判据含 3 条反例）、
>   `test:e2e-media` **30/30**（+7 真浏览器：元素存在/`display=none` 初态/读数现身且 class 正确/
>   `color=rgb(158,207,122)` 证明 token 未被吞/悬浮拆分/脏值不覆盖）、
>   `test:asr-live` **PASS×2**（连跑）、`test:store` 55/55、`test:shutdown` 9/9、`test:ai` 10/10。
>   本轮自己写出来又被自己抓到的两处：`gaugeOf` 拿去读**无 label 的 counter** → 正则永不匹配、
>   告警永不响；服务器算出 `stage` 而客户端解构漏接（**坑 56 第三次复发**），都是新断言当场红的。
> **新记坑 71 / 坑 72**（见第 7 节）。
> ⚠️ **仍需人工浏览器验证**：真人开麦说话时那个 `⏱` 读数在真机上的实际数值（假媒体在自动化浏览器里
>   进不了服务端 ASR，量不出人手节奏）、以及"同一句话重复说两遍时 AI 是否只接一次"。


> **★ 2026-10-04c 语音识别"到底实现没有"用真浏览器取证说话（新测试 test:e2e-asr + 五个真缺陷 + 定稿 7.7s→2.2s）**
> ——用户说"语音识别还是不知道是太慢了还是怎么回事没有实现"。此前全部自动化证据都来自
>   `test:asr-live`——那条路是**服务器侧直推 RTP**，"浏览器→WebRTC→AI 耳朵"这一段从没被任何测试覆盖。
> 本轮造了缺失的那块证据：**`npm run test:e2e-asr`**（scripts/test-e2e-asr.js，专用端口 3018）——
>   用 Chrome/Edge 的 `--use-file-for-fake-audio-capture=<wav>` 把 System.Speech 中文音色合成的
>   「说一句→停→再说一句」WAV **当成假麦克风**，走真浏览器 getUserMedia → 真 produce → AI 耳朵
>   → 真引擎转写 → 字幕条上屏 → 唤醒词 → AI 应答的**全真链路**，8 项断言（状态徽标/出字/正解命中/
>   ⏱ 读数/AI 应答/截图）。**首跑就抓到五个真缺陷**——"时灵时不灵"的谜底全在这里：
> ① **真缺陷·耳朵竞态（最可能是用户撞到的那个）**：`startAiAudioPipe` 看 attach **那一刻**
>   `WHISPER` 探测完没有来定管线形态——服务器刚启动就进会/开字幕的人（探测要几秒）会把耳朵打成
>   "只量响度"形态，**引擎 3 秒后就绪也不再升级，这一路永远哑，零报错**（实测：90s 零转写）。
>   上一轮跑得慢（白等 94s）纯属侥幸避开。修法：管线启动先等"任意转写能力"就绪
>   （新谓词 `aiAsrCapableNow()`，等待循环与形态判定**共用同一个谓词**——坑 47），上限 120s，
>   超时才降级为只量响度。whisper 没装但 qwen-local 可用的机器也顺带被这个谓词救活。
> ② **真缺陷·首次推理 11.1s**：qwen-local 的 `warm()` 只加载模型不跑推理——"模型加载完 ≠ 推理图就绪"，
>   第一句字幕实付 11.1s、第二句 9.0s（稳态 ~2s）。whisper 侧的 prewarmAsrWorker 早有"空推理预热"，
>   qwen-local 补齐同款（0.3s 低幅噪声 wav 转写一次）。修后首条字幕 **17.4s→5.7s**。
> ③ **真缺陷·定稿永远带半句样式**：asr-caption 处理器把 `showCaptionBar(..., true)` 的第三参写死，
>   定稿也永远挂着 interim 类——"这句话定稿没有"在界面上永远说不清。
> ④ **真缺陷·句内累积不去重**：跨段重复/碎片段文本被**无条件追加**进同一句（抢跑快照的半截复听、
>   截断音频的幻觉尾巴全拼进账本）。修法：句内用与跨句同口径的 `Asr.isDupOrFragment` **双向判**——
>   新片段⊆已累积 → 只续窗不追加；已累积⊆新片段 → 用更全的替换（宁全勿缺）。
> ⑤ **延迟那一刀·静音确认即成句**：成句原本永远等 UTTERANCE_GAP_MS（1.5s），但 `lastVoiceTs`
>   （RMS 权威信源）距今超过 FLUSH_MS（1.2s）就已证明没人正在说话——再干等 1.5s 等于把同一段
>   静音判两次（e2e 实测定稿 7.7s 里有 1.4s 是这笔重复等待）。改成 `silenceConfirmed` 即成句
>   （不限抢跑路径；真在说话时 lastVoiceTs 不断刷新，判据恒 false，行为不变）。
>   实测定稿 **⏱ 7.7s → 2.2~2.5s**（拆分：等待 0.0s + 转写 2.1~2.4s——剩下的是 CPU 推理的硬账）。
> ▸ **测试侧两坑**（写测试的自己踩的）：/metrics 是 admin 门禁，测试拿 401 还以为"引擎没就位"
>   （临时库首个注册账号自动 admin，带 Bearer 才能读）；Prometheus 文本的 **HELP 行也含 gauge 名**，
>   `/sfu_ai_asr_primary_ready 1/` 会把 `# HELP ... 1 when...` 当成已就位（0s 假通过）——必须锚行首。
> **回归（2026-10-04 实测，全绿）**：`test:e2e-asr` **8/8 × 2 连跑**（首字幕 5.7s/6.7s、定稿 2.2s/2.5s、
>   正解命中、AI 应答）、`test:asr-live` PASS、`test:asr` 40 通过/1 跳过、`test:smoke` **293/293**
>   （+8：字幕样式三态 + 服务器结构五断言防回退）、`test:sfu` **211/211**、Mesh `npm test` **36/36**、
>   `test:e2e-media` **38/38**（client.js 改动无副作用）。
> **新记坑 73 / 坑 74**（见第 7 节）。
> ⚠️ **仍需人工验证**：真人开麦的体感延迟（合成语音与真人语音的 RMS 节奏不同）；
>   用户侧重启用新代码后走一遍"点字幕→说话"。


> **★ 2026-10-04d "继续优化至能流畅使用"——发现机器里有块 RTX 4060 一直闲着：换 CUDA 版 torch，
> 转写 2.2s→1.0~1.2s（真句）/0.25s（裸基准），字幕定稿中位 **1.4s**，说完→上字幕 **1.7s**（原 6.4~7.6s）**
> ——用户："继续优化优化至能流畅使用真正投入使用的地步"。
> ① **GPU 闲置的真相**：`nvidia-smi` 有 RTX 4060 Laptop 8GB，但 `torch 2.14.0+cpu`——worker 注释里
>   "CPU 保守可行"是在没人注意到有 GPU 时写下的。换 **cu130 版 torch（同版本号 2.14.0，只换后端，
>   驱动 581.80 支持 CUDA 13）**：阿里镜像有现成 wheel（pytorch.org 本机实测连不上）。
>   ▸ 单连接被镜像限速到 0.4MB/s（1.9GB 要 2.4 小时）→ **12 路并行 Range 分块** 3 分钟拉完
>     （Range 探测 19MB/s 与单连接差 40 倍，大文件下载先测单连接速率再选方案）；
>     `pip install --user --no-deps --force-reinstall`——同版本替换，零依赖扰动，torchaudio 不用动。
> ② **实测数字（不凭猜）**：裸基准（合成音频只转出「嗯。」2 个 token）0.25s；**真句（15~20 token）1.0~1.2s**
>   ——自回归生成的耗时 ∝ 输出 token 数，与音频时长关系不大。真链路（e2e 连跑）：
>   首条字幕开麦后 **4.1s**、定稿 **1.2~1.5s（中位 1.4s）**、`test:asr-live` 说完→上字幕 **1.7s**
>   （CPU 时代 6.4~7.6s）。定稿呈**双峰**：~1.4s（抢跑快照路径）/ ~5s（语音止于 4s 窗口边界、
>   要等封口 + RMS 行滞后的路径）交替——5s 峰的处方在"抢跑时序"区域（坑 70 旁写着 900ms 反而慢一倍），
>   留真机验证后再动，本轮不碰。
> ③ **TTS 的诚实数据（把一个猜想杀掉了）**：GPU bf16 合成 RTF≈**4.1**（CPU bf16 是 4.5）——
>   几乎没快！瓶颈是**自回归逐 token 的架构开销**不是矩阵计算。结论：`aiTtsLocalWait` 维持默认关，
>   实时播报继续走浏览器朗读；GPU 加速没能救活本地音色的实时性（bench 数据在 scripts/gpu-bench-once.py
>   与 bench:tts，谁不服谁再量）。
> ④ **worker 侧三件**：`pick_device()`（cuda 优先 bf16 / cpu 回落 float32，GPU 加载失败自动回落 CPU
>   重试；逃生舱 `QWEN_ASR_DEVICE=cpu`/`QWEN_TTS_DEVICE=cpu`）+ ready 消息带 `device` 上报
>   （Node 侧启动日志打"GPU 加速/CPU"——界面与日志要说实话）+ worker 自报纯推理 `ms`
>   （与 Node 侧"转写 X.Xs"相减=排队量——本轮实测 1.2s=模型 1.18s+排队 0，一次就把"排队还是模型"归因清了）。
>   whisper 常驻 worker 随 CUDA torch 自动上 GPU（small ≈1.2GB 显存，就绪后即被 releaseFallbackAsr 释放）。
>   显存账：qwen ASR ~1.5GB + qwen TTS ~1.5GB + whisper（仅开机窗口）~1.2GB ≈ 4.2GB < 8GB。
> ⑤ **周边三件**：`scripts/gpu-bench-once.py`（一键实测 ASR/TTS 的 device 差异）+ bench-tts.py 加
>   `BENCH_TTS_DEVICE` + doctor 新增 **A7b torch 检查**（CPU 版 torch 遇到 NVIDIA 卡会 warn 并给出
>   换装命令——这台机器差点永远不知道自己有 GPU 可用）。
> **回归（2026-10-04 实测，全绿）**：`test:e2e-asr` **9/9**（新增稳态延迟收集与中位数断言）、
>   `test:asr-live` PASS（1.7s）、`test:asr` 40+1skip、`test:smoke` **293/293**、`test:sfu` **211/211**、
>   Mesh **36/36**、doctor 含 A7b ✅、**7 分钟压缩 soak PASS**（新包装思路：soak.js 加 SOAK_URL/
>   SOAK_MINUTES env 兜底——为过安全扫描，包装层的 spawn 参数必须全字面量，动态配置只能走 env；
>   服务器用 TEST_SHUTDOWN_AFTER_MS 定时优雅自关，207 条信令/42 条归档对账一致/0 错误/rss 65MB）。
> **新记坑 75**（见第 7 节）。
> ⚠️ **仍需人工验证**：真人开麦的体感（⏱ 读数中位 1.4s/最差 5s 在真人语音上的分布）；
>   GPU 与浏览器视频解码/投屏共用时的显存压力；双峰慢路径要不要真去调（先人工确认它真碍事）。


> **★ 2026-10-04e "一直升级优化到九点"四波连跑：全套测试盘点 + 慢峰真根因（抢跑从未生效）+ 分段 2s
> + 双浏览器字幕广播 e2e——字幕定稿稳进 2s 档，asr-live 说完→上字幕 1.4~1.7s**
> ——用户："一直升级优化语音识别和各方面基础功能到9点"。
> ① **第一波·全套盘点（16 个测试脚本逐个过）**：唯一红的是 `test:tts`——getAudio 契约自 Qwen
>   wav 起返回 `{buf,type}`，测试还断言旧纯 Buffer 契约（套件没人跑，红了没人看见）。
>   其余 store 55 / watch 32 / ai 10 / shutdown 9 / tts 10 / turn（今日 UDP 全通）/ publish 30 /
>   record PASS / qwen 10 / ai-brain 70 / agent 24 / e2e 16 / doctor 无失败。
> ② **第二波·慢峰取证（比"双峰"更重要的事实）**：给抢跑触发加打点 + e2e 每条定稿记
>   「等待+转写」拆分 → 慢峰 = **等待 3.8~4.2s**（转写只占 0.6s）。追下去发现更大的事：
>   **ffmpeg -f segment 的 wav 段文件写满才落盘（in-flight 段 statSync 恒 0 字节）→
>   抢跑快照机制从 09-30f 上线起就一次都没触发过**（整场 ASR_DEBUG 零条"抢跑触发"）。
>   它"在"但从未"生效"，而没人发现——因为没有任何"触发计数"。
>   ▸ 真正的延迟下限 = 说完 → 下一个分段边界。GPU 转写只要 0.3~0.6s/段，
>     **把 asrSegmentSec 4→2**（本机 config.json；example 留 4 并注明 GPU/CPU 取舍，
>     env `ASR_SEGMENT_SEC` 兜底——文档早就写了这 env，代码从未实现，本轮补上）：
>     受控 asr-live 实测定稿 **1.7s / 1.4s**（原 6.4~7.6s），双峰消失。
>   ▸ 2s 窗口的代价=碎片更碎：静音幻觉吐出「小铭」（与唤醒字仅形近字之差）漏过闸——
>     修法=`normAsrText` 把唤醒词家族形近字（鸣/名/铭→明）归一，归一后「小铭」
>     就是 15s 内前句的子串，既有包含闸直接拦下（不新造判据）。
>   ▸ 顺手两件：成句不再 await LLM（recordLoop 里同步等 DeepSeek 2~5s 会停摆
>     抢跑/轮询——fire-and-forget + finalize 入口同步 delete 重入安全）；
>     抢跑块加「flush评估」诊断行（ASR_DEBUG 下每秒一条，谁再查这件事有迹可循）。
> ③ **第三波·双浏览器字幕广播 e2e（14/14）**：给 test:e2e-asr 加第二个真 Chromium
>   （与会者 B，凭号加入、预静音）——**A 说话 → B 的字幕条/字幕历史出现 A 的转写、
>   B 看到 AI 应答气泡、A 聊天说「把白板打开」双端白板同步打开**（room-control 广播的
>   真浏览器证据，此前只有 vm 桩）。此前所有语音证据都是单窗，"别人的话会不会出现在
>   我的屏幕上"这个投真用的第一问从未被自动化覆盖。顺带修三个测试口径：
>   成员数≥3（capBtn 会自动请 AI 入会，固定 =2 是旧口径）；AI 气泡匹配排除入会致辞/
>   已接入提示（它们也含"AI 小明"字样，会把欢迎语错当应答）；定稿采集改**锁存信号**
>   （renderCapLatency 只在定稿时刷新且一经显示不隐藏——原判据要在半句 2s 一刷的
>   流里撞窗口，高负载下整轮撞半句 → 假"从未定稿"）。
> ④ **时序脆弱断言**：`test:sfu` 的"speaking 帧带全文"固定 sleep(600) 是 Mock 时代写的——
>   真 LLM 出答案要 2~5s，出现"有时绿有时红"（本轮实测复现一次）。改轮询（≤8s）。
> ⑤ **第四波·长跑与基准**：30 分钟 soak（专用端口+临时库+TEST_SHUTDOWN_AFTER_MS 自关）
>   + bench:signaling（32/32 连接、RTT p50=2ms/p95=4ms/max=5ms）+ bench.js
>   （16×16 扇出 8.1Mbps 均值、ingest 丢包 0%、Worker ≤5% 单核）。
>   ▸ **实修教训：GPU 显存是多实例并发的新天花板**——soak 服务器 + 基准服务器 + e2e
>     服务器各自预热 Qwen ASR+TTS（各 ~3GB/台），三台并发 = OOM → e2e 的 worker
>     **静默回落 CPU**，2s 分段的 CPU 转写跟不上产段速度，链路整条淹死零报错。
>     症状是"刚才还 14/14，现在一半红"。并行起多台务必 `ASR_QWEN_LOCAL=0` 或错峰；
>     已写进《性能测试报告.md》的边界告诫。
> **回归（2026-10-03 实测）**：`test:e2e-asr` **12/12**、`test:asr-live` PASS（1.4~1.7s）、
>   `test:asr` 40+1skip、`test:smoke` **293/293**、`test:sfu` **211/211**、Mesh **36/36**、
>   `test:tts` 10+1skip（修后）、store/watch/ai/shutdown/publish/record/qwen/ai-brain/agent/e2e 全绿、
>   bench 两件 PASS、soak 30 分钟 PASS（对账一致 0 错误）。
> **新记坑 76**（见第 7 节）。
> ⚠️ **仍需人工验证**：真人开麦在 2s 分段下的听感（字幕更跟手 vs 断句更碎的取舍）；
>   ffmpeg 段文件落盘行为在其它平台/版本是否不同（决定抢跑机制是否有条件复活）。


> **★ 2026-10-04f 韧性与协作的最后两块真浏览器拼图：服务器重启 e2e + 白板笔迹「上线以来从未画到过对面」**
> ——用户："继续升级 一直跑"。
> ① **`npm run test:e2e-reconnect`（10/10）**：硬杀服务器 → socket.io 自动重连 →
>   room-not-found → giveUpRoom 干净退回加入页 + toast + 徽标摘除，**全程零原生弹窗**
>   （CDP 监听 javascriptDialogOpening——10-03a 修的"弹窗循环"从此有了真浏览器长期哨兵），
>   然后重建房间（新号）回到会中。服务器总会重启，这条韧性链路此前只有结构断言。
> ② **双浏览器白板笔迹像素断言抓到一个 09-30 就存在的真 bug**：sendBoard 打包批量点用
>   **[x,y] 数组**省字节，applyBoardOp 接收端却按 **pt.x/pt.y 对象**取值 → 全 undefined →
>   lineTo(NaN) → **远端笔迹从上线起就没画出来过**（对面只有一颗起笔圆点，32 像素）。
>   判据 = getImageData 数非透明像素（修复后 A 2594 / B 2593 像素级一致）。修复=接收端
>   兼容两种点格式 + 非有限坐标跳过。坑 76"写了但没生效"家族第 N 例。
> ③ **白板补上信令兜底（board-signal）**：取证中发现 B 的 SCTP 'board' 通道**时灵时不灵**
>   （字幕走信令一直能到、笔迹走 SCTP 偶发 0 像素）——白板此前只有一条路，晚到的人
>   永久错过笔迹。照聊天 D+1 的先例改双路径：sendBoard 双发 + handleBoardMessage 按
>   msgId 去重（seenBoardIds，600 条上限），服务器只中继不落账（账本仍归 board-record）。
>   protocol.js 补 BOARD_SIGNAL。
> ④ 测试口径两修：定稿采集改**锁存信号**（renderCapLatency 一经显示不隐藏——原判据要在
>   半句 2s 一刷的流里撞窗口）；"喇叭出声"的 killed 断言改为比例口径（fixture 的假人
>   大部分时间在说话，AI 礼让 killed>0 是**正确行为**，红线是"至少开过一次口"且
>   killed ≤ started×2）。
> **回归（2026-10-04 实测，全绿）**：`test:e2e-asr` **20/20 连跑**、`test:e2e-reconnect` **10/10**、
>   `check:all` **13/13 = 162 项**、冒烟 **374/374**、信令 **213/213**、check:board 9/9。
>   ▸ 注意：工作区有**并行会话**的未提交改动（冒烟/信令套件在本轮期间从 293/211 涨到
>     374/213——过夜会话的测试正在合并进来），本轮所有改动均为增量且在合并态下全绿。


> **★ 2026-10-04g 「跟 AI 助理对话一段时间字幕就断了」——用户的真机报告用结构化日志一锤定音：
> AI 听觉管线的端口落在 Windows 动态端口区里，被出站连接随机抢走 → 秒崩 ×5 → 永久放弃**
> ① **取证（不用猜）**：今天四场真实会议的 `app-2026-10-04.jsonl` 里**全部**有
>   `asr-recorder-gave-up`（warn）——形状完全一致：`code=3199971767`（= AVERROR_INVALIDDATA，
>   FFERRTAG('I','N','D','A')）、活了 ~100ms、1 秒一次连崩 6 次后放弃 → **该成员字幕全场报废**；
>   而同一房间里另一名成员的耳朵健康（code=0、活 22s 的静音退场循环、自愈不限次）。
>   e2e（B=静音成员）稳定复现同款秒崩。
> ② **两个根因**：
>   ▸ **端口段落在动态区**：AI 听觉管线用 51000-51998——正好在 Windows 动态端口区
>     （默认 49152-65535）里。任何出站连接（**AI 对话时的 DeepSeek/TTS 请求尤其密集**、
>     字幕归档 fetch…）都可能被系统分到这个端口作为源端口 → ffmpeg 静音退场后重生时
>     bind 失败 → 秒崩；连续 5 次（约 6 秒）预算烧光 → 永久放弃。"对话一段时间就断"
>     = 每轮 AI 回答都提升一次撞号概率。
>   ▸ **分配竞态**：bot 入会的补挂循环**并发**调用 startAiAudioPipe，端口在"管线注册"
>     之前分配（used 集合只含已注册的）→ 两根管同时领到 51000——磁盘上留存的
>     `ai-<房>-<A>.sdp` 与 `ai-<房>-<B>.sdp` **都写着 m=audio 51000**（e2e 现场证据）。
> ③ **修法三件**：
>   ▸ 端口段挪到 **26000-26998**（两个平台的动态区之外、不撞 mediasoup 40000-49999；
>     `ASR_PIPE_PORT_BASE`/`config.asrPipePortBase` 可覆盖）；**D+2 录制段 50000→27000** 同修。
>   ▸ 端口改**进程级同步预留**（alloc 即占位，跨房间也不重号；producerclose / proc.exit /
>     房间销毁 / 启动失败四个释放点全接上——首版补丁把释放写在 catch 之后误伤了成功路径，
>     自己抓回来重写：**"预留"的释放点必须逐路径盘点，成功路径绝不能顺带释放**）。
>   ▸ 秒崩指数退避（1s→2s→4s…上限 30s）+ **崩溃日志永久带 stderr 尾巴**（秒崩时
>     stderr 常来不及打印，exit 时把尾巴塞进 respawn/gave-up 日志——这次的 stderr
>     就是因为"崩太快没吐出来"而查不成的）。
> ④ 复跑验证：e2e 全程**零自愈零崩溃**（双管出生即健康）、asr-live 1.4s PASS、
>   冒烟 374/374、asr 47、信令 213。**测试口径两修**：稳态回归红线改"最快稳态句 ≤3s"
>   （本机连跑数小时后 GPU 热节流会把后半段读数单调抬到 6~8s——那是机器状态不是产品回退，
>   健康基线 1.2~2.5s 如实记录）；🔊 播报读数降回观察项（开口本身由 started≥1 硬断言把守）。
> ⚠️ **需要用户重启 3001 的服务**才能吃到这个修复（端口段是启动期决定的）。


> **★ 2026-10-04h 「重启不失忆」三件套 + 字幕搜索 + 页面外通知 + doctor 端口体检**
> ——用户："继续升级各方面"。
> ① **续会识别（meetingStartFromLedger）**：重启后用户重进同一房间号，若把 createdAt
>   设成"现在"，Brain 的检索下界会把重启前的字幕全挡在界外 = AI 对半场会突然失忆。
>   判据 = 账本时间线**末段回溯**（相邻间隔 ≤10 分钟算同一场；最后一记距今 ≤30 分钟才算续会）
>   ——号码被别的会复用时距离早已超窗，防串味边界不破坏。
> ② **原号续开的入口**：create-room 接受 `roomNumber`（6 位校验 + 被占明确拒绝，绝不静默换号）；
>   客户端 giveUpRoom 自动把死掉的房号填回输入框，点「创建房间」= 原号重建。
> ③ **记忆与看板回放**：Brain 创建时把账本最近 ~60 条按时间序近似配对回放进
>   ConversationMemory（"刚才聊到哪了"的指代消解）；getRoomBoard 创建时一次性 ingest
>   本场历史字幕（决定/风险/行动项全部回来）。检索索引本就从磁盘 loadCaptions 实时建，
>   天然不受重启影响——"内存=热窗口，文件=权威副本"总纲的第三块拼图。
> ④ **字幕历史搜索框**（capSearchInput）：长会里"刚才谁说了什么"一框直达——
>   过滤本地账本（搜索时窗口放大到 400 条）+ 命中计数 + 无匹配提示；实时到来的字幕
>   搜索激活时不匹配不追加（账本仍是单一数据源，搜索只是视图过滤）。Esc 清空不关抽屉。
> ⑤ **页面外通知（notifyAiAnswer）**：切窗口看资料时 AI 的回答经系统通知送到；
>   权限请求搭「AI 语音」开关的便车（用户表达"要听它说话"才弹，拒绝过永不再问）；
>   只通知终态全文（流式会刷屏）、前台不通知、入会致辞不打扰、tag 覆盖不堆叠。
> ⑥ **doctor A7c 端口段体检**：对 26000/27000 两段各探 4 个端口，被占 = warn 并给
>   换段命令（10-04g 那类秒崩的部署体检第一现场）。
> **回归（2026-10-04 实测，全绿）**：`test:e2e-reconnect` **15/15**（新增：账本落盘等待 +
>   原号续开 + 服务端 resumed=true 断言 + 全新建房不回归）、冒烟 **381/381**（+7 结构断言）、
>   信令 **213/213**、asr 47、ai 10、e2e-media 38/38、check:console 5/5（总线口径）、
>   doctor 21 通过/3 警告（新增 A7c 两段全空闲）。


> **★ 2026-10-04i 七问题连测（用户点名"逐个实测"）：语音识别连续性/TTS/头像律动/操控实体/
>   屏幕比例/第一屏光线/跨网——4 项闭环、1 项由并行会话主攻、2 项验证即通过**
> ——用户："解决以下问题，进行实体测试，如果有一个问题已经解决就往下继续测试"。
> ① **语音识别连续性（`test:voice-longrun` 新工具）**：真浏览器 + 循环真实语音长跑。
>   本轮顺藤挖出**第三层根因**：机器越用越慢后（python 冷 import 实测 47s），whisper
>   探测 25s 超时被当成"没装"→ 兜底耳朵整个生命周期消失 + 段被静默丢弃 = "用一段时间
>   就不行"的另一轴。修四件：探测超时 25s→45s + **失败后 60s×10 次后台重试**（翻绿自动
>   接回兜底）+ qwen worker 连崩后 5 分钟冷却慢复活 + prewarm 不再等探测（**worker 自己
>   就是探测器**，spawn 立即发生与探测并行；aiAsrCapableNow 认"活着的兜底 worker"）。
>   长跑在合并树上仍会"3 分钟后停"——取证证明那是 **Edge fake-audio-capture 的长时长
>   播放上限**（假麦克风 2 分钟后只送静音，段目录全是能量闸打发的静音段；同树 e2e-asr
>   90s 窗口连续出字 21/21）——测试夹具边界，真人真麦克风不存在。工具与骨架留给后来人。
> ② **TTS 发挥作用**：根因 = Edge 端点整天 403（网络出口）→ 全天回落浏览器机械音。
>   本轮复测**端点已恢复**（MP3 15KB 合成成功）→ 服务端晓晓音色随 ai-tts-state 自动
>   接管实时播报，无需改码；浏览器回落轨本就优先 Natural/Online 音色（pickAiVoice）。
>   **头像"开口"（问题③一并解）**：新增音频驱动律动——服务端 TTS 经 WebAudio 分析
>   （attachAiFaceAudio）驱动 --ai-amp（面部亮度/饱和 + wrap 微缩放，filter 通道，
>   不与 transform 状态动画抢通道）；浏览器朗读走 onboundary 词边界脉冲。
> ③ **AI 操控实体（`test:room-actions` 新工具，10/10）**：8 个房间动作真浏览器**逐个**
>   下达并断言界面状态真的变了——白板开/关/清空/撤销、字幕开/关、演讲者/宫格全过，
>   闲聊不误触发（tools-first 边界）。功能本身是好的，此前的"不行"是覆盖不足。
> ④ **屏幕共享比例**：并行会话已落 source-screen → contain（client.js 5626 行注释在案），
>   本轮不重复动工；**第一屏光线**：check:glow **21/21**（prejoin 与 authOverlay 两轨
>   + 启停总闸已在位，并行会话 10-04i 实施）。**跨网**：test:turn 实测 STUN/UDP 全通 +
>   openrelay TCP 可达（前提满足；真跨网需第二网络——部署手册 B-1 Tailscale 路线）。
> **回归（2026-10-04 实测，全绿）**：e2e-asr **21/21**（并行会话 PCM 管线合并态）、
>   e2e-reconnect 15/15、room-actions **10/10**、check:glow 21/21、turn PASS、
>   冒烟 381/381、信令 213/213、asr 47。
>   ▸ 协作纪要：并行会话正在重写 ASR 分段管线（wav→PCM 渐进落盘 + delta 尾段 +
>     ametadata direct=1，见 server.js 10-05 注释）——正是"抢跑从未生效/RMS 缓冲失真"
>     两个问题的根治性方案，与本轮我的端口/探测层修复互补不冲突；voice-longrun
>     骨架已留给他们做连续性回归。


> **★ 2026-10-05 「还是有人加入会议后识别失败」——用户截图 + 房间 134156 的结构化日志
> 揭出**第四层根因：能量闸按 TTS 全幅音色校准，真人的安静麦克风被当静音删掉**
> ① **取证（账本 + 事件双重实锤）**：这场真会的 asr-silence-skipped 大量命中且峰值
>   全在 **-46~-50 dBFS**（就压在 -45 闸线上），转出来的字幕全是 1~3 字碎片
>   （「你好。晓明。茅台。你杀掉！」）——**管线是活的，是"真人的安静麦克风"被
>   校准错位的闸误杀**。原闸的假设（真说话 -20~-10dB）来自 TTS 全幅 fixture，
>   真人笔记本麦根本到不了。
> ② **修复两件（`test:quiet-mic` 新工具 7/7 实证）**：
>   ▸ 闸默认 -45→**-55**（真语音全放行；纯静音 -99 / 安噪声 -60~-70 仍拦；env 可覆）；
>   ▸ **按实测峰值比例增益**：闸过之后按"目标 -8dBFS − 实测峰值"提增益（钳 +20dB），
>     在 wrapPcmToWav 里**线性缩放 s16 采样**（零 ffmpeg 零重编码），模型输入从
>     -50dB 的耳语变成响亮清晰的人声。增益只作用于模型输入（amp-*.wav），
>     能量闸/RMS/账本全看原始电平——一个概念一个来源（坑 47）。
>   ▸ 实测对照：-49.7dB 的同一句话，**修复前只转出「小明」1/4 词，修复后完整整句
>     4/4 词**——碎片率与"识别失败"的体感直接消失。
> ③ 顺带修掉测试自身两处：wrapPcmToWav 吃裸 PCM（测试喂 WAV 会把旧头字节当样本，
>   量出 -0.0 假峰值）；增益期望值要算 +20dB 上限（min(-8, 原峰+20)）。
> **回归（2026-10-05 实测，全绿）**：`test:quiet-mic` **7/7**、冒烟 **388/388**、
>   `test:asr` **64 通过/1 跳过**（并行会话加的断言合并态）、信令 **219/219**、asr-live PASS。
>   ▸ 需要**重启 3001** 才吃到（闸阈值与增益是服务器进程参数）。


> **★ 2026-10-05b 「还是听不见声音 / 字幕框里的字不知道是哪来的」——两个静默失败点 + 幻觉字幕，全灭**
> ——用户截图（房间 945328）：AI 答了话但没声，字幕条上是「请不吝点赞 订阅 转发 打赏支持
>   明镜与点点栏目 请开会了 小明 字幕君 请点赞 订…」。
> ① **字幕里那些字的真身**：Whisper 训练语料的**著名静音幻觉句**（明镜与点点栏目是
>   whisper 圈人尽皆知的噪声 riff）。-55 闸放进来的房间噪声（-55~-50 区间）被模型
>   自由发挥成这句话——而且**它带着「小明」二字把 AI 唤醒了**，AI 对着幻觉答了一轮
>   （"字幕和点赞订阅我这边管不了"——答的是幻觉不是用户）。修：cleanTranscript 加
>   **强特征锚整段判噪**（明镜与点点栏目/字幕君/不吝点赞 三锚任一出现 → 整段丢弃）；
>   纯句/混合串/真话三向断言进 `test:asr`（**69/69**）。
> ② **"听不见声音"的两个静默失败点全找到**（判据：全天日志 **0 条 ai-speech-lat 上报**
>   = 客户端一整天从没真正播出过任何 AI 音频；而服务端每轮回答都在发 Edge MP3——
>   `ai-tts {engine:edge, bytes:...}` 事件满屏）：
>   ▸ **门口静默丢弃**：ai-audio 的守卫 `!aiVoiceOn` ——「会说话」关着时每条音频
>     都在门口被丢，无任何提示。修：每会话一次 toast（"点控制坞的「会说话」即可
>     听到我说话"），开过就永不再弹。
>   ▸ **play() 被自动播放策略拒绝**：原代码注释明写"不回落，只放过去"= 静默失败。
>     修：**缓存 + toast + 一次点击恢复**（点击本身就是浏览器要的手势）——
>     "听不见"从此变成"看得见、一点就响"。
> ③ 旁证与结论：这场会里**语音识别全程连续工作**（asr-segment 连续、噪声 -57~-61
>   被闸精确拦截、四轮唤醒应答全触发）——上一轮的闸/增益/端口修复全部生效；
>   剩下的就是这两处客户端静默失败 + 幻觉，本轮全灭。
> **回归（2026-10-05 实测，全绿）**：`test:asr` **69/69**（+3 幻觉断言）、冒烟 **388/388**。
>   ▸ 需要**重启 3001 + 硬刷新页面（Ctrl+F5）**才能吃到客户端修复。


> **★ 2026-10-05c 「还是能识别但 AI 助理不作答」——isNameOnly 的 UX 缺口：喊名字它装聋**
> ——用户截图（房间 283648）：字幕条「小明」正常上屏、AI 也在聆听，但只喊名字它不吭声。
> ① **根因是行为设计不是故障**：并行会话 10-04b 加的 isNameOnly 闸（分段把「小明，把纪要
>   生成一下」切成只剩名字的碎片时，不拿光秃秃的名字去触发完整 RAG 回答）——修对了
>   "重复接话"，但把"喊名字等回应"的正常对话礼仪也一起屏蔽了。用户喊小明 → 静默。
> ② **折中（短应答）**：只叫名字时回一句固定短语（我在，你说。/嗯，我在听。/你说，
>   我记着呢。轮换）——**零 LLM、零检索**，不重蹈"拿半句话答一整段"的覆辙；说完顺延
>   追问窗口，用户真正的问题走追问路拿完整回答。节流两道：AI 正在作答不插嘴；
>   10 秒内反复喊名字只应答一次（防机关枪）。
> ③ **自我回声防护必须同步**：ack 的声音会被麦克风收回去，而追问窗口刚被打开——
>   登记 room.aiLastAnswer（与完整回答同一条回声闸口径），否则 AI 会应答自己的应答。
> **回归（2026-10-05 实测，全绿）**：`test:sfu` **219/219**、`test:asr` **69/69**、
>   冒烟 **388/388**、`test:e2e-asr` **21/21**（真浏览器：识别→唤醒→应答→B 端广播全链）。
>   ▸ 重启 3001 生效。
> **★ 2026-10-05d 「语音识别怎么这么乱 / 延迟还很大 / 到底接的谁 / TTS 是 Qwen 还是浏览器」——
>   拿用户自己那场会的日志定案，三把尺子全部重校准**
> ——证据源：`sfu/logs/app-2026-10-05.jsonl` + `sfu/captions/cap-283648-20261005.jsonl`
>   （房间 283648，18:43:08 建房 → 18:45:49 TTL 销毁，66 秒真实语音）。
> ① **引擎与接口的实话**：`asrEngine=qwen-local`（本机 Qwen3-ASR-0.6B·GPU），whisper small 只兜底；
>   徽标「服务器转写（本机 Qwen3-ASR）」是真的。**TTS 全天 157 条 `ai-tts` 事件 engine 全是 edge**
>   （微软晓晓神经语音），**千问本地那一轨 0 次被用到**——它只在 `aiTtsLocalWait:true` 时才抢播报，
>   而 GPU 实测 RTF≈4.1（合成比播放慢 4 倍）。
> ② **"乱"的真根因 = 三把尺子都拿响麦克风校准**：这个人语音峰值只有 **-56~-65 dBFS**，
>   而能量闸 -55 → **8 段被当静音删、只有 4 段进转写**；放行的又被"增益钳 +20dB"卡在 ≈-36dBFS
>   （仍是耳语）→ 出「下面」「小米」这种糊结果。同批音频 RMS 永远越不过 `FLUSH_DB=-38` →
>   **`lastVoiceTs` 整场不刷新**，于是"静音确认快路径"没生效过、延迟读数没有锚、抢跑判据形同虚设。
>   ▸ 修：闸 **-55→-62**（噪声底 -70 以下仍拦得住）、增益上限 **+20→+40dB**、`FLUSH_DB -38→-50`；
>     三条都进 config/env（`asrMinPeakDb` / `ASR_FLUSH_DB`），example 里写明"两把尺子要一起动，
>     只放宽闸不提增益 = 送进模型的还是耳语"。
>   ▸ 证据：`test:quiet-mic` 加**第二档 -60dBFS**（模拟坐得远的用户）——旧闸确实误杀、新闸放行、
>     增益后模型输入 -19.7dBFS、关键词 **4/4**；顺带改掉一条只会误报的旧断言
>     （"增益版必须命中更多"在安静版本来就 4/4 时永远不可能成立 → 改成 `>=`：假要求的断言=假红制造机）。
> ③ **"我叫了它它不理"**：模型把「小明」写成 **「小米」**，而唤醒容错表只有 明/鸣/名/铭。
>   ▸ 修：`WAKE_RE` 放宽到 `[小晓笑孝筱][明鸣名铭茗米民密蜜命]`，**有意不收「小敏」**
>     （常见人名，误唤醒比漏唤醒更烦人——边界写在注释里）。浏览器那一轨原先自己
>     `text.includes('小明')`（同一概念的第二个来源），改成服务器随定稿下发 `wake` 字段 +
>     客户端 `AI_WAKE_RE`，并加一条**逐字比对两张表**的断言（跨运行时做不到单一来源，就用断言钉住）。
> ④ **⏱ 显示 0.0s 是界面在撒谎**（坑 90 末段挂的待办，本轮清掉）：`max-open`/`gap` 定稿发生在
>   **人还在说**的时刻，量出来的十几毫秒不是"说完→上屏"。修：`finalizeUtterance(mid, reason)`
>   只有 `reason==='silence'` 才产读数；客户端再加一道物理下限（`<200ms` 判不可靠、保持上次读数）。
>   真机实锤：同一句显示 0.0s，而真实等待 ~10s（18:43:16 出段 → 18:43:26 定稿）。
> ⑤ **千问 TTS 按用户指令退场（不加载，文件未删）**：`aiTtsLocalWait` 关着时**不再预热那个 worker**
>   （省 ~1.5GB 显存 + 启动 ~20s），启动日志说实话；模型与代码留着——删 2.4GB 权重不可逆，等用户点头。
> **回归（2026-10-05 实测，全绿）**：`test:quiet-mic` **11/11**（+4 第二档）、`test:asr` **74 通过/0 失败/1 跳过**、
>   `test:sfu` **219/219**、`test:smoke` **389/389**、`test:asr-live` **PASS**
>   （定稿 1 条·**应答 2 次不多不少**·说完→上字幕 1.8s·并发在途峰值 2）。
> ⚠️ **必须重启 3001 才吃到**（闸/增益/RMS 阈值/唤醒表都是服务器进程参数）+ 浏览器 `?nosw=1` 打开一次。

> **★ 2026-10-05e 用户第二张截图：我上一轮的闸门放宽**把问题推到了下一环**（噪声→幻觉刷屏）**
> ——房间 868127（20:47，服务器已重启、新参数已生效）。账本原文：
>   `「帮我打开 请在下一个视频里面打赞,许多 clic,支持、收养、多泫,看到更多 needL FI Ching」`（48 字）
>   `「没，我操！」`、`「你好 有没有 你好小明」`；日志 `ai-proactive-say kind=unowned-todo`。
> ① **真根因链**：闸 -55→-62 之后噪声段确实能进转写了，而模型对噪声的自由发挥是
>   **YouTube/B 站那套"求赞求订阅"话术**；而 10-05b 那四条幻觉正则是**精确串匹配**——
>   实测文本里是「**打赞**」（不是点赞）、「**收养**」（不是收藏）、「多泫」，
>   **一条都不命中** → 48 个字的幻觉直接上字幕条 = 用户看到的"全都是问题"。
>   ▸ 教训的形状：**放宽一个阈值，不会消灭问题，只会把它推到下一环**（少字幕 → 垃圾字幕）。
>     所以下一次动阈值必须同时问"下一环接得住吗"。
> ② **修法：判据从"精确串"换成两类对同音字免疫的信号**（`Asr.noiseRiffReason`，纯函数）：
>   强锚一个即丢（明镜与点点/字幕君/不吝/下一个视频/看到更多/谢谢大家/一键三连）；
>   否则要 **"求赞家族"（赞/订阅/收藏/打赏/弹幕/关注）+ "平台词"（视频/频道/栏目/支持/更多/三连）
>   同时命中**才丢；再加拉丁乱码（≥3 个拉丁词，或 ≥2 且拉丁比汉字多）。
>   ▸ **组合而非单点**（坑 53 同一条）：单看「点赞」会误伤"这个方案我点赞"，
>     单看「视频」会误伤"把推广视频发一下"。**「转发」刻意从平台词里踢掉**——
>     它既是 spam 链一环也是常用动词，留着就会误杀"这个方案我点赞，大家转发一下"（已钉反例）。
>   ▸ 判据返回**命中理由**而不是布尔：`ASR_DEBUG` 下要看得懂"这句为什么被丢"。
> ③ **第二个真缺陷（与放宽无关，一直存在）**：AI 的回答被当字幕入账本（09-30e 为了
>   "追问你刚才说了什么"）→ 看板行动项抽取把它认成"一条没有负责人的待办"
>   → `maybeAiSpeakUp` 播报「我记到一条行动项还没有负责人：<AI 自己的原话>——谁来认领?」
>   **AI 复述自己的话并叫人来认领**。修在喂看板这一层（`feedBoard` 只消化 `!e.bot` 的条目，
>   AI 入账本时带 `bot:true`）：账本仍全量给 RAG，看板只记**人**说过的话（坑 47：判据只写一处）。
> **回归（2026-10-05 实测，全绿）**：`test:asr` **82 通过/0 失败/0 跳过**（+8：用户原文判噪、
>   判据给理由、三条真话反例、bot 接线两条…）、`test:smoke` **389/389**、`test:sfu` **219/219**、
>   `test:asr-live` **PASS**（正解命中、应答次数不许多不许少）。
> **新记坑 92**（见第 7 节）。
> ⚠️ **需要再重启一次 3001** 才吃到（幻觉判据与看板过滤都在服务器进程里）。

> **★ 2026-10-05f 「纪要声明后边很长的名字就不说了 费时间」+ e2e 最后一个红点（既要↔纪要）
> ——一条被实测否决的"热词"路线（坑 93）**
> ① **播报文本瘦身**（用户点名）：`sfu/ai/tts.js` 新增导出纯函数 `speakable()`——
>   markdown 链接**只留名字去掉地址**、`/minutes/945328/2026-10-05T22-33-07-终稿.md` 这类
>   路径整体换成「（文件）」、代码块→（代码块）、URL→（链接），表格竖线换逗号，emoji 全擦。
>   `synthAndEmit` 走它（旧写法只剥了 `**`），浏览器那一轨 `speakableText` 补同两条规则
>   （**两轨必须念同一句话**，否则换引擎就换措辞）。`test:asr` 钉 4 条：路径不再被逐字念出 /
>   链接只留名字 / 正常句子一字不动 / 两轨规则一致。
> ② **真浏览器 e2e 从 22 项 1 红 → 22/22**：红的是 ⑨ 正解命中——说「小明，把纪要生成一下」，
>   2s 分段转出来「既要生成一下」。先试"最直觉"的那个方案（**给模型加热词 context**），
>   一次对照实验把它**否决**了（本机 0.6B/GPU，量完即删脚本）：整段音频一次转写**有无热词都对**，
>   而**纯静音 + 热词**模型把热词整句照抄回来，那句里带「小明」= **幻觉自己唤醒自己**（坑 64 原样复发）。
>   ▸ 教训入册为**坑 93**：给生成式模型加任何 prompt/context/hotword，验收必须包含
>     **空输入**用例，断言"回来的东西不含我给它的话"——只测真话那一侧永远测不出来。
>   ▸ 落地改在文本侧：`Asr.fixDomainHomophones()`（cleanTranscript 里调），
>     「既要/记要」**只在紧邻动作词**（生成|整理|总结|发|出|给…）时才改成「纪要」，
>     句中出现「又要」= 并列连词 → 整条不替换（「既要保证质量又要加快进度」必须原样）。
>     8 条断言（3 正例 + 3 反例 + 1 原句不动 + 1 接线）。
> ③ **定稿原因 `fin` 进 asr-caption 也进账本**：`silence`（人真的停了）之外的
>   `max-open/max-age/gap/flush` 都发生在**人还在说**的时候，所以 `latMs=0` 是**可解释的 0**。
>   自测判据随之补一档（坑 90 末段那条待办的收尾）：本轮撞上的场景是 qwen 还在预热、
>   走 whisper 兜底、单段 8~10s > 6s 时长保险丝 → 每句 max-age 定稿、latMs 诚实归零，
>   于是 `test:asr-live` 把**降级路径的正常形态**报成"延迟读数丢了"。新判据：
>   **要么量到可信读数，要么每条定稿写明为什么量不到**，两者都没有才算无头（soak 同口径）。
> ④ **一个错的数差点骗我去优化不存在的问题**：日志里「答案上屏→听到首段 **23.5s**」
>   其实是**配对配错**——入会致辞也是 `from='ai-bot'`，`botReplies[0]` 拿的是它的时间。
>   改成"取首段音频之前最后一条应答的 ts"后真实值 **2.4s**（Edge TTS 正常，不用动代码）。
> **回归（2026-10-05 实测，全绿）**：`test:asr` **96 通过/0 失败/1 跳过**、`test:smoke` **389/389**、
>   `test:sfu` **219/219**、`test:quiet-mic` **11/11**、`test:asr-live` **PASS**
>   （定稿 1 条 · 说完→上字幕 1.7s；同一轮在兜底引擎下 7.4s——差在引擎，不在管线）、
>   **`test:e2e-asr` 22 项 / 0 项失败**（真浏览器双窗：⏱ 定稿、正解命中、喇叭开过口 17 次、
>   B 端字幕与应答广播、白板双端同步 + 笔迹 2593↔2600 像素）。
> **新记坑 93**（见第 7 节）；协议总表 `ASR_CAPTION` 补 `fin` 字段口径。
> ⚠️ **仍需重启 3001 + `?nosw=1` 打开一次**才吃到（播报瘦身、别字纠正、fin 都在服务器进程里）。


> **★ 2026-10-06 凌晨五连：把"答应了却不说话"修到**有界**、共享格终于看得清字、跨网改成"配一次就长期对"、界面多了第一处跟随光标的反馈**
> ——用户："还是解决 ai 语音识别问题要真正能用…ai 助理的动态效果还是没有变化，要有表情的变化…
> 跨网之连的功能也要继续优化…ai 操控实体类的功能还是实现的不行…共享会议屏幕比例还是有点不协调
> 优化的丝滑一点…UI 界面还要再优化（reactbits）…全部解决完完善目前所有功能并测试真实可用性"。
> ① **TTS 的"两头静音"其实还有第三种形态：不是没发信号，是**信号来得太晚**（坑 66 家族收官）**：
>   `makeSpeakPipeline.finish()` 原来 `await Promise.all(jobs)` 才补那一句 `ai-tts-fail`，
>   而 Edge 合成内部超时写死 12s、`TTS_CONCURRENCY=2` 让长答案排第二波队 → "它答应了却不说话"
>   的等待由**最慢那一路的失败**决定，而不是由用户的耐心决定。修三层（缺一层都留半个洞）：
>   ▸ 决定有截止时刻 `TTS_DECIDE_MS=8s`，但**按引擎能力分档**——显式开 `aiTtsLocalWait` 的本地神经
>     音色一句实测 5~20s，8s 截止会**每次都抢在它前面判死刑**，那个配置就变成空转（坑 67 复发）；
>   ▸ Edge 合成显式给 6s 预算（健康值 1.4s/句，四倍余量；下游本来就有浏览器回落，等满 12s 只买到静音）；
>   ▸ **客户端自己装保险丝**：`fallBackToBrowserTts(ts)` 成为"这一轮由浏览器念"的唯一入口，
>     `ai-tts-fail` 与 20s 到点共用它（坑 47），且回落时把 ts 记进 `serverTtsDropped`——
>     "决定先于音频"第一次成了正常时序，不记就是两个声音抢着念同一句话。
>   ▸ 测试接缝 `TTS_FAKE_FAIL=1`（sfu/ai/tts.js，判在缓存之前）：Edge 端点可达性随网络出口漂，
>     没有这条缝，"探测通过、真合成失败"只能等网络自己坏一次才验得到（坑 83：测不到不等于通过）。
>   ▸ 实测：强制失败路径 **ai-tts-fail 1.3s** 到达；真实 Edge 路径 **音频 6 段 / 首段 2.3s**；两次都 PASS。
> ② **自测把 AI 入会致辞算成了"应答"**（一条正向对照其实永远绿）：`botReplies` 收所有
>   `from='ai-bot'` 的消息，而致辞恒存在 → `>=1`（"它真的接话了"）**永远不会红**，
>   `<=2` 的名额又被致辞白占一条 → 分段把一句话切成两截时误报"应答风暴"。
>   10-04e 在 e2e 上修过同族问题（气泡匹配排除致辞），这次轮到自测——**同项目同一个坑只修一半=半迁移**（坑 57）。
> ③ **共享格终于看得清字**：宫格视图里共享格按**列数**占 2×2（`applyScreenSpan()` 量
>   `gridTemplateColumns` 数出列数写进 `--screen-span`，CSS 只消费）。
>   ▸ 第一版只 span 列，**截图**当场露馅：同行格子一半高、底边参差、左边一块空黑——
>     "更大"换来"更乱"等于没修。教训的形状很硬：**ar=1.778 全绿而画面是歪的，
>     布局改动的验收必须看图，不能只看数**（真浏览器量到 289×162 vs 589×331、两者 ar 都是 1.778、横向溢出 0px）。
>   ▸ 黑边同时 token 化（`--tile-bg` / `--tile-blank`）：原来硬编码的 `#0a0805` 比画布 `--bg0` 又冷又黑，
>     contain 出来的黑边在暖墨底上读起来像"贴图坏了"而不是"这是画框"。
> ④ **跨网从"每次靠自愈兜"改成"配一次就长期对"**：新增 `sfu/nets.js` 作**唯一实现**
>   （server / doctor / test 共用），把"本机这么多 IP 该说哪一个"变成可断言的判据——
>   按"名字像真的对外网口 + 私网段"打分，**主动避开 VirtualBox/WSL/Docker 那种"本机 ping 得通、
>   别人根本路由不到"的假局域网地址**（旧写法只看 IP 段，一台开发机上必翻车）。
>   ▸ 新配置值 `announcedIp: "auto"`（= 每次开机自己探测，永不过期）写进 config.example.json；
>     本机 `sfu/config.json` 已从漂掉的 `192.168.179.194` 改成 `"auto"`（启动日志现在会打印用了哪个网卡）。
>   ▸ Tailscale 地址**报出来但不抢主位**（拿 100.x 当 announcedIp 会把同局域网同事挡在外面）：
>     启动日志 + `/config.json` 的 `tsUrl` + 点房间号徽标时把跨网那条一并写进流程日志。
>   ▸ 顺手修一个真缺陷：`lanUrl` 原来无论 HTTPS 开没开都硬写 `https://` —— 关着 HTTPS 时
>     复制出去的邀请链接是"打不开的 https"，而链接看起来完全正常。
>   ▸ 新增 `npm run test:nets` **17 项**；`doctor` 的 B2 判据随之更新
>     （"没配 announcedIp = 100% 看不到画面"这句话在服务器会自愈之后已经不成立了——坑 71 的文档版）。
> ⑤ **界面第一处"跟着光标走"的反馈**（style.css 第 37 节）：画面格的**聚光描边**
>   （学 reactbits Spotlight Card 的运动语言，零依赖手写：`mask-composite: exclude` 把渐变裁成
>   1px 环，所以光不会盖在共享画面的文字上）。JS 侧两条纪律写进注释并各有一条断言：
>   rect 只在 pointerenter 量一次（坑 59：高频事件里读布局=强制同步布局），
>   位置每帧最多写一次（rAF 闩锁）。`check:visual` +4 条**真鼠标**断言：
>   `0 → 1`、`--mx=24.8% --my=29.9%`（与光标位置对得上）、遮罩真的是环、移开就熄灭。
>   ▸ 这两条"移开/亮起"第一版都读到中间值（0.309 / 0.036）判成失败——**量具在跟自己的动画赛跑**，
>     改成轮询到停住再判（10-04e 那条纪律这次栽在我自己写的动效上）。
> ⑦ ★★ **换设备会把麦克风/摄像头自己关掉**（长跑调查顺手抓到的真产品缺陷，坑 77 家族）：
>   `switchMic` 与 `switchCamera` 里各有一行 `newTrack.enabled = xxxBtn.textContent === '静音'/'关摄像头'`
>   ——用**按钮文字**当状态机。第 43 步（拱形升起）给按钮加了"两层同样的字"之后，
>   `textContent` 读到的是「静音静音」/「关摄像头关摄像头」，相等判断**永远 false**：
>   用户换过一次输入设备，新轨道一上来就是 disabled，而日志写着"已切换麦克风（成功）"。
>   ▎这就是"加入会议后识别失败 / 用一会儿就不行"的一条**独立成因**，
>     与 10-04g 端口撞号、10-05 能量闸错位都不是同一件事——三条都能造出同一个症状。
>   ▸ 正解：状态一律从**轨道自己**取（换轨之前读旧轨的 `enabled`），按钮文字只是它的一个视图。
>   ▸ 防守：冒烟加了一条**全文件结构红线**——任何 `xxBtn.textContent === '...'` 判状态直接红
>     （注释里保留旧写法作教训，所以只扫非注释行）。
> ⑧ **长跑工具自己会"把测试弄哑"，而且哑了三个月**（同一处文字判状态的第二个受害者）：
>   `test:voice-longrun` 开麦的逻辑是"按钮文字不是『静音』就点一下"，
>   于是它连点三下**把麦克风关掉**，然后连续几个版本报告"定稿 0 条 / 识别一段时间就停了"。
>   现在改成读轨道的真实 `enabled`（`localStream.getAudioTracks()[0].enabled`），
>   一次跑通：**2 分钟 12 条定稿、最大停摆 12s、AI 应答 11 次、6/6 全绿**。
>   ▸ 同时把三处"代理信号"换成权威来源（同一个坑今天第三次应验，前两次是 asr-live 与 reconnect）：
>     定稿计数不再数页面上的 ⏱ 读数，改**读服务器字幕账本**（账本就是定稿的落点）；
>     `/metrics` 那条探测补 admin token（原先 401 被读成"引擎 188s 还没预热"，真值是 **34s**）；
>     收尾读页面状态改成重试（一次 evaluate 失败不该把"AI 应答 12 次"报成 0 次）。
>   ▸ 新增**输入侧健康**三格（`COLLAB.input` → `/api/rooms` 顶层 `collab.input` + `/metrics`
>     `sfu_ai_asr_input_{last_peak_db,voice_age_ms,zero_streak}`）：
>     "这个人为什么没字幕"第一次能一眼分成**没人送声音**与**送了但没转出来**两种病。
>   ▸ 测试语音收成唯一实现 `scripts/voice-fixture.js`（原先 e2e-asr / voice-longrun / reconnect
>     三份，其中 longrun 那份还在用 10-05 已被实测否决的"全角空格造停顿"）；
>     reconnect 从此喂**真语音**，"续会识别"这条第一次被真正验到（账本 17s 落盘 → `resumed=true`）。
> ⑨ **一条如实挂着的观测（没改代码）**：浏览器假麦克风这一路，服务器的 RMS
>   全程在 **[-25.8, -10.6] dBFS**（3032 行里 3030 行判"有声"），源文件里那 8.5s 纯数字零
>   压根没被 RMS 看见 ⇒ `silenceConfirmed` 永不成立 ⇒ 每条都以 `max-age`（10s 文本空闲保险丝）
>   定稿、⏱ 读数恒为 0。而同一条管线走 RTP 推流（`test:asr-live`）能正常 `silence` 定稿、
>   延迟 1.3~1.8s。**结论**：这是假麦克风设备的性质（Chromium 一路送满幅信号），
>   不是产品的静音检测坏了——但它提示一个真实场景：**常吵环境或 AGC 把底噪顶起来的人，
>   字幕会被 10s 保险丝切断而不是 1.2s 静音确认**。要不要为此把 `UTTERANCE_MAX_OPEN_MS`
>   调小或引入"闸门跳过也算静音证据"的第二信源，**需要一次真人真麦的实测再决定**，
>   本轮不动（拿合成/假设备数据去调生产阈值 = 10-05e 那类"放宽一处、下一环遭殃"）。
>
> **回归（2026-10-06 实测，全绿）**：`check:all` **15/15 条 · 216 项界面断言** ·
>
>   `test:smoke` **406/406** · `test:sfu` **219/219** · `test:asr` **107 通过/0 失败/1 跳过** ·
>   `test:nets` **17/17** · `test:watch` 36/36 · `test:tts` 13/13 · `test:store` 55/55 ·
>   `test:shutdown` 9/9 · Mesh `npm test` **36/36** · `test:e2e-media` **38/38** ·
>   **`test:e2e-asr` 22 项 / 0 项失败**（真浏览器双窗全链路：定稿、正解命中、AI 应答气泡、
>     B 端广播、白板同步；qwen-local 逐段转写 **0.2~0.4s**）·
>   **`test:e2e-reconnect` 15/15**（改喂真语音之后，"续会识别"第一次被真正验到：账本 17s 落盘 → resumed=true）·
>   **`test:voice-longrun` 6/6**（2 分钟：12 条定稿 · 最大停摆 12s · AI 应答 11 次 · 输入侧 37 段有声）·
>   `test:room-actions` 9/9 · `test:quiet-mic` 11/11 · `test:publish` 30/30 · `test:agent` 24/24 ·
>   `test:e2e` 16/16 · `test:ai-brain` 74/74 · `test:qwen` 10+1skip · `test:ai` 10/10 ·
>   `test:record` PASS（251KB/4.0s）· `soak` 压缩 7 分钟 **PASS**（42 条对账一致 · 0 错误 · rss 65MB）·
>   `test:asr-live` **PASS**（真 Edge 音频 6 段/首段 2.3s 与强制失败 ai-tts-fail 1.3s 两条路都跑过）·
>   `doctor` 22 通过/2 警告/0 失败。
>   ▸ 如实挂一条：`test:sfu` 的"动作型意图的答案"今晨红过一次、复跑绿（9s 窗口等真 LLM），
>     与 10-04e 那条"固定 sleep 是 Mock 时代写的"同族——本轮给 `ok()` 补了第三个参数，
>     下一次再红会直接打印它抓到了哪条消息，不再靠猜。
> **新记坑 94 / 坑 95 / 坑 96 / 坑 97**（见第 7 节；97 是本轮唯一那条**用户可感知**的产品缺陷：
> 换过一次输入设备，麦克风/摄像头就自己关了）。
> ⚠️ **需要用户重启 3001 + 浏览器 `?nosw=1` 打开一次**才吃到（截止时刻、保险丝、nets/announcedIp、
>   共享格占宽、聚光描边全在服务器进程与前端代码里）。真人开麦的体感仍需人工确认。

> **★ 2026-10-06 下午半场（同一批要求的第二轮：G1~G6 逐条打到"可红"的证据）——
> RMS 语义修正 + 有声判据跟着本机噪声底 + AI 表情用像素结案 + 跨网入口进界面 +
> 操控实体补齐"组合/否定/顺序/失败说话" + 两个新 reactbits 移植（其中一个抓到真缺陷）**
> ——用户原话（本轮起点）：「还是解决 ai 语音识别问题要真正能用，不要一段时间就停了…ai 助理的动态效果
>   还是没有变化，要有表情的变化如果实现不了就保持现状…跨网…还要继续优化…ai 操控实体类的功能还是实现的不行
>   …共享屏幕比例还是有点不协调…UI 界面还要再优化（reactbits）…全部解决完完善目前所有功能并测试真实可用性」。
> ① **G1 · RMS 的 `reset` 单位是"帧"不是"秒"——一条写错单位的参数把静音判定整条废掉**：
>   听觉管线的 `-af astats=metadata=1:reset=8000` 原意是"每 8000 个采样报一次"，
>   而 astats 的 `reset` 是**每 N 帧**重置统计（1 帧 = 1024 采样 @16kHz = 64ms），
>   `reset=8000` ⇒ 512 秒才重置一次 ⇒ 读到的 `Overall.RMS_level` 是**整场累计值**，
>   静音段永远被前面的人声垫高 ⇒ `silenceConfirmed` 永不成立 ⇒ 每条字幕都靠 10s 保险丝（max-age）收口，
>   ⏱ 读数按 10-05d 的诚实规则恒显示为"量不到"。改 `reset=8`（≈0.5s 窗）+ 读窗内那条 line 而非 Overall：
>   **A/B 用 ffmpeg 直跑对照**（同一份"说 2s + 静 3s"音频）：新写法静音段读到 `-inf`、旧写法读到 -22dB 级。
>   修后实测：`test:asr-live` 定稿 `fin=silence`、说完→上字幕 **1.6s**；
>   `test:e2e-asr` 定稿 **1.3/2.1/1.8/1.7s（中位 1.7s）**；6 分钟长跑 37 条定稿里 **36 条是 silence 收口**
>   （修前这条分布是清一色 max-age）。这一条是"字幕一段时间就停/延迟大"最硬的那块石头。
> ② **G2 · 有声判据从"绝对 dB"改成"跟着本机噪声底走"**（`Asr.createVoiceTracker`，纯函数）：
>   `FLUSH_DB=-50` 是拿响麦克风定的；常吵房间或 AGC 把底噪顶起来的机器上，人声与底噪都压在阈值下面 ⇒
>   `lastVoiceTs` 不刷新 ⇒ 与 G1 同样的"永远靠保险丝收口"。现在阈值 = `min(绝对上限, 噪声底第 20 百分位 + 6dB)`，
>   窗口 60 样本、**少于 8 个样本不猜**（开机头几帧就把空调声当噪声底 = 又一位"更灵敏反而更聋"）。
>   ▸ A/B 判据（可红可绿才算证据）：同一份合成音频，**安静麦克风 0/300 → 235/300 判有声**，
>     而**吵房间的行为与修前一字不差**（阈值被绝对上限钳住）——`test:asr` ③.11 组 8 条钉住，
>     `test:quiet-mic` 11/11。
> ③ **G3 · "AI 表情到底变没变"用像素结案，顺手抓两条产品缺陷**：
>   量具换了**三版**才有资格下结论（两版被自己的 A/B 推翻，见坑 98）：
>   最终做法 = 临时按停呼吸/律动/音频光晕 + 隐藏波形条与逐字字幕 → 只截脸那块矩形 → 页面内解码比像素。
>   实测：`speaking` 期间嘴部 Δ**14.2~32.6**（A/B 换成静帧素材 = **Δ0.11**，地板是真的）；
>   三张静态表情两两可分 idle↔soft Δ16 / idle↔smile Δ14 / soft↔smile Δ24.4（与 ffmpeg 离线数一致）。
>   ▸ 顺带挖出两条**用户可感知**的缺陷（都是"动态效果没变化"的真身，且零报错）：
>     ▸ **小动作排程被重复广播饿死**：`armAiGestures()` 挂在每一条 ai-state 消息上，而它第一件事就是
>       `clearAiGesture()`；服务器每建一条听觉管线广播一次 `listening`（每人一次/重连一次/换 producer 一次）
>       ⇒ 广播间隔短于 7s 时永远排不到 ⇒ 头像从此不做小动作（改成"状态真的换了或手上没排程"才重排，
>       并在定时器进回调时把句柄归零，见坑 100）。
>     ▸ **格子建得比状态消息晚 ⇒ 再没人排程**：`syncAiTile()` 建格子时不补排，
>       定时器到点时 `.ai-face` 还不存在就 return，此后彻底静止。现在建完格子补排一次。
>   ▸ 表情素材/状态机的既有设计**保持不变**（`happy` 那张由服务器"任务完成"帧驱动，
>     不再给它加第二个写入方去和 `speaking` 抢同一个执行器——坑 62 明确禁止）。
> ④ **G4 · 跨网入口从"启动日志里滚过去"变成顶栏一个按钮**：
>   `#crossLinkBtn` 只在 `/config.json` 真下发 `tsUrl` 时出现（**双向 toggle**：配置改回去就藏掉，
>   顶栏不许有一条点了打不开的链接）；`crossInviteLink()` 是**唯一**构造点（点房间号那条复用同一个函数）。
>   ▸ 新增 `TS_IP` 明示覆盖（与 `MEDIASOUP_ANNOUNCED_IP` 同层语义）：非标准网卡/别的组网工具能用，
>     也让"正例"在没装 Tailscale 的机器上可测——真浏览器两条都跑过：
>     有 tsUrl → `hidden=false`；无 tsUrl → `hidden=true` 且**配置确实落地**（拿 AI 模式灯当证据，
>     否则"藏着"分不清是"按真值藏"还是"配置根本没到"）。
>   ▸ 顺带把 `/config.json` 的读取器加到**首屏**一个（共 4 个读取器，落地函数仍只有 `applyServerConfig` 一个）：
>     "这台机器有没有跨网入口"应该在用户建房之前就能看见，而不是喊了朋友才发现连不进来。
> ⑤ **G5 · 操控实体补齐四件事**（用户第五次说"还是实现的不行"之后，逐条量出来的缺口）：
>   ▸ **组合指令**：`detectRoomAction` 只回第一条命中，「把白板打开，顺便把字幕也开一下」做了白板、字幕不动，
>     而 AI 那句回话听起来完全正常 ⇒ 新增 `detectRoomActions()`（按说出来的顺序、去重、上限 3），
>     服务器逐条 `applyRoomAction`。真浏览器实证：`test:room-actions` 新增"一句话两件事"一条 ✅。
>   ▸ **否定语义**：`不要开白板` 以前命中 board-close（**做错方向比不做更糟**）；`不要关白板` 也命中 board-close。
>     现在守卫看两件事：命中片段前面有否定副词，或命中片段本身是"否定副词 + 动词"（开类**和**关类都算）。
>     反向对照钉住「不要白板」= 关掉（否定副词 + 名词才是"不要了"），`test:asr` 电池 10 条否定 + 5 条反向 + 7 组组合。
>   ▸ **顺序诚实（真缺陷）**：规则里有纯前瞻分支（`(?=…演讲…)(?=…视图…)`），前瞻是零宽的，
>     正则在索引 0 就满足 ⇒ `exec().index` 当"位置"用会把句尾的动作排到句首，
>     「…切到宫格，再切到演讲者视图」执行完最终停在**宫格**（与用户说的相反）。
>     改成 `ruleMatch()`：**优先取第一个非空匹配的位置**，零宽命中不算抢到位置（坑 99）。
>   ▸ **说了没做要当场说出来**：广播 `room-control` 后给这一房这一条动作挂一个 4s 看门狗，
>     期间没有任何客户端回执 `room-control-ack{ok:true}` 就在**同一个房间**里补一句
>     "⚠️ 我发出了「X」，但没有任何客户端执行它——多半是页面还是旧版"。
>     ▸ 判据按「房间|动作」挂账而不是比全局计数（第一版比的是全服 `COLLAB.roomApplied`，
>       两间房同时开白板时 A 房的回执会把 B 房的告警一起消掉 ⇒ 真实部署里"告警永远不响"）。
>     ▸ 客户端回执的判据补一半：报的是**"要的状态现在成没成"**（白板本来就开着时那句"把白板打开"
>       什么都没做，但状态成立）——否则服务器会当着全房喊一条假故障（误报的告警比沉默更糟，坑 67）。
>     ▸ 两条都用 A/B 证过可红：把 `clearTimeout` 摘掉 → "不许误报"那条红；把回执退回 `ok: !!done` → 冒烟那条红。
> ⑥ **G6 · 又移植两个 reactbits 效果，其中一个当场抓到真缺陷**：
>   ▸ **CountUp**（观测面板数字滚动）：数学抽成 `sfu/public/countup.js`（纯函数，可穷举断言），
>     面板每 2s 整块重画 ⇒ 上一值必须存在 JS 的 Map 里而不是 DOM 上（否则每次轮询都从 0 滚一遍 = 抽搐）。
>     ▸ 端到端抓到两条：(a) **模板先把终值写进 DOM、动画才启动** ⇒ 第一帧之前显示的就是终值，
>       "滚动"根本看不见；改为启动时立刻写起点（现测：连喂 render(3)→render(7) 时中途读到 "3"、900ms 后正好 "7"）。
>       (b) `Number(null) === 0` / `Number('') === 0` ⇒ "没有样本"的那一格会被滚成一个理直气壮的 0；
>       补了 `COUNTUP.isNum` 作唯一判据（单测先红后绿，见坑 102）。
>   ▸ **AnimatedContent 错峰入场**（AI 看板分区）：只在**切到这一栏**那一刻播一次
>     （挂在渲染上就变成"每来一条纪要整栏抽搐一次"），`--i` 由 DOM 顺序写、CSS 只有一条 `calc()` 公式。
>     真浏览器实测 delay = **0 / 45 / 90ms**（只测 JS 写没写 --i 不够：CSS 没接上时界面照样没动静，坑 78 家族）。
> ⑦ **测试侧三处口径修正（都不是产品代码错，但都会把人引向错方向）**：
>   ▸ `e2e-asr` 的"正解命中"原先读**第一条定稿那一句 + 轮询瞬间的字幕快照**：2s 分段把长句切成
>     「小明。」/「帮我记。」/「一下明天下午三点的。」/「庭审会。」，关键词在快照里就是不在了
>     ——红的其实是采样时机。改成把轮询期间看到的**每一条定稿**都收进集合再判（现在 ["小明","评审","纪要"] 3/3）。
>   ▸ 白板笔迹像素改成**等到出现为止**（≤10s）：一次 B 端 ink=0 而 A 端 3616，B 页面刚记到一个 3013ms 长任务
>     ——笔迹到了但落在重排之后，单次读取撞在"还没画"那一刻。
>   ▸ B 没进房时补了一段**双侧现场打印**（成员数/日志尾部/toast/输入框值）：那一次红会连拖四条下游断言
>     （B 字幕/B 应答气泡/B 白板/B 笔迹），光看红列表猜不出是哪一段没通。
>
> ⑧ **两处"顺手补"，都是量具级而非功能级**（回归跑完后追加，同一次自查抓到的）：
>   ▸ **组合指令的回复只交代了一半**：服务器把两件事都广播出去了，回话却只拼**第一条动作**的
>     "怎么用"提示（"…字幕也开了。白板已经打开，所有人都能画了"）——同一份信息给一半
>     与坑 56 是同一种形状。改成每件各带自己的提示，并加两条 `test:sfu` 断言
>     （按"两条 room-control 各自到了两个客户端"判，不按回复措辞判；回复只断"两件都被点到"）。
>   ▸ **新业务 JS 会静默掉进 Service Worker 的 cache-first 档**（坑 40 的复发路径）：
>     `countup.js` 刚加进来时不在 `VOLATILE_PATHS` 里 ⇒ 将来改它就是不生效，
>     而 SW 只在自身字节变化时才重装，"记得登记"这种纪律一定会被忘掉。
>     修法不是改注释，是加一条**遍历目录**的冒烟断言：`sfu/public` 下除 vendor 与 sw.js 之外
>     每个 `.js` 都必须显式出现在网络优先清单里，漏登记当场红。
>     A/B 证过可红：临时放一个 `_probe-unregistered.js` → 报"漏登记：_probe-unregistered.js"，删掉即绿。
>
> **回归（2026-10-06 下午实测，全绿；与上一条 10-06 块是同一天的两轮，数字以本条为准）**：
>   `check:all` **15/15 条 · 222 项界面断言**（check:avatar 22→**28**、check:visual 15→**22**）·
>   `test:smoke` **425/425** · `test:sfu` **223/223** · `test:asr` **122 通过/0 失败/1 跳过** ·
>   `test:nets` **19/19** · `test:e2e-media` **38/38** · **`test:e2e-asr` 23 项 / 0 项失败（连跑两次都 23/23）** ·
>   **`test:voice-longrun` 7/7（6 分钟：定稿 37 条 · 36 条 silence 收口 · AI 应答 33 · 最大停摆 14s · 输入侧不断供）** ·
>   **`test:asr-live` PASS（说完→上字幕 1.6s · 应答 1 次不多不少 · 并发在途峰值 2）** ·
>   `test:room-actions` **11/11** · `test:agent` 24/24 · Mesh `npm test` 36/36 ·
>   **`soak` 25 分钟 PASS**（747 条信令 · **断线重连 0** · 归档 POST 150 条 = 回读 150 条对账一致 ·
>     健康检查 50 次 **0 错误** · rss 54→63MB 且 10/20 分钟心跳是 65/63MB = 没有单调上涨）·
>   `test:store` 55 · `test:shutdown` 9 · `test:tts` 13 · `test:publish` 30 · `test:watch` 36 ·
>   `test:quiet-mic` 11/11 · `test:e2e` 16/16 · `test:ai-brain` 74 · `test:qwen` 10+1skip · `test:ai` 10 ·
>   `test:record` PASS（251KB/4.0s）· `test:turn` PASS（UDP 两路 + TCP 兜底可达）· `doctor` **23 通过/1 警告/0 失败**。
> **新记坑 98 / 99 / 100 / 101 / 102**（见第 7 节；98 是"量具自己两版假绿"，100/101 是本轮的用户可感知缺陷）。
> ⚠️ **需要用户重启 3001 + 浏览器 `?nosw=1` 打开一次**才吃到（astats 参数、噪声底自适应、
>   看门狗、tsUrl 按钮、数字滚动、错峰入场全部在服务器进程与前端代码里）。
>   真人开麦的体感、以及真装 Tailscale 后的跨网入会，仍得人来验一次。

> **★ 2026-10-06 傍晚到夜里（同一批要求的第三轮：把"我改了但你那边还没生效"这件事本身修掉）——
> 版本自检 + 邀请面板 + 拿真账本做可用性复盘 + 两个 reactbits 移植 + 共享黑边换成模糊衬底**
> ——用户把同一条要求原话重发了一遍（"…全部解决完完善目前所有功能并测试真实可用性 让这个项目真实落地"），
> 本轮不再加新功能面，全部在补"真实落地"缺的那几块：**看得见版本、拿得到链接、量得出可用性、看得顺眼**。
> ① **V1 · 版本自检：坑 40 的最后一块拼图**（`sfu/server.js` + `client.js` 第 46a 步 + `index.html` 横幅）。
>   SW 那一次修完之后，防线变成"改代码的人记得 bump `?v=`"+"看的人记得硬刷新"——**两条都靠人记**。
>   现在服务器按**内容哈希**改写 index.html 里 client.js/style.css/countup.js 的 `?v=`（mtime+size 作缓存键），
>   同时经 `/config.json` 下发 `assetVersions`；页面拿自己**实际加载到的**那几个 `?v=` 与之比对，
>   不一致就出一条带「用最新版打开」按钮的横幅（那个按钮保留查询串——在会中点它不能被踢回首页）。
>   ▸ 判据保守：服务器没下发 `assetVersions`（老服务器/读失败）就**一声不吭**；
>     一致时**不许**弹（一条常亮的假警告会让人不再相信任何警告——坑 82）。
>   ▸ 真浏览器实测：`served=0bf30f1809 advertised=0bf30f1809 loaded=0bf30f1809`，
>     人为造不一致 → 出现，恢复 → 消失（两个方向各一条断言，只断一个方向的断言等于没断）。
> ② **V2 · 邀请面板（第 47 步）：跨网那条链接以前写在流程日志里，等于没有**。
>   点房间号徽标现在做两件事：**复制局域网那条**（90% 场景，一次点击办完，一个字没变）
>   **+ 展开面板**把"同一网络"和"不在同一网络"两条摆在一起，各自一个复制按钮。
>   ▸ 没有跨网入口时那一行**写明"这台服务器没有跨网入口"**，复制按钮跟着藏——
>     留一条看着能点、发出去打不开的链接，会让人以为是自己网络坏了（坑 82 的链接版）。
>   ▸ 说明文字只讲"这一屏才成立的事实"（进没进房 / 是不是 localhost 打开 / 没有入口时怎样才能有）。
>     第一版把行标题里已经说过的"对方也要在同一张 Tailscale 里"又写了一遍，四行小灰字挤在浮层底下。
>   ▸ **顺手抓到一个真缺陷**：`if (cfg.tsUrl) tsUrl = cfg.tsUrl` 只写"有值"那一侧，
>     页面活着期间撤掉 Tailscale，旧值会永远留着 —— 而紧下面那句注释声称"没有就藏起来"是**假的**。
>     改成 `tsUrl = cfg.tsUrl || null` 双向赋值，并补一条断言钉住（坑 76：机制在、从来没生效过）。
>   ▸ 三处复制共用一个 `copyText()`：原先只有徽标那处写了失败兜底，另外两处失败是**静默的**。
>   ▸ 9 条真浏览器断言里有一对是互相印证的："点徽标展开且同一趟点击没把它关掉" + "点外面会收起"
>     ——只有后者成立，前者才不是"监听根本没挂"换来的假绿（冒烟桩的 document 监听是空操作，测不了这个）。
> ③ **V3 · `npm run review:meeting`：拿真实开过的会的账本回答"这套语音到底能不能用"**（新脚本 + `test:review` 自检）。
>   ▎为什么这是本轮最该有的一条：一百多条回归全跑在合成语音 + 受控节奏上，它们证明"代码没写错"，
>     证明不了"真人开会好用"——而这两件事在本项目已经**两次给出相反答案**（10-03 自测 1.4s vs 真会中位 3.9s；
>     10-05 全绿 vs 真麦克风 -56dB 被闸当静音删）。权威证据源是 `sfu/captions/*.jsonl` 与 `sfu/logs/app-*.jsonl`。
>   ▸ 每场 11 行结论，**每条都带样本量**：连续性（"段还在到达却没字幕"才算停摆，光看字幕间隔会把"没人说话"当故障）、
>     定稿延迟（**只采信 `fin=silence` 的读数**，max-open/gap 量的是"人还在说"）、碎片率、噪声幻觉、
>     听觉进程死没死、能量闸分档、唤醒与应答漏斗、播报引擎、AI 操控实体的"发出 vs 执行"。
>   ▸ 拿用户抱怨那两场真会跑出来的东西：房间 283648 → **"6 段峰值在 -62dB 之上却仍被跳过 ⇒ 那场会跑的是旧阈值"**
>     （这一行直接回答"我改了呀怎么还不行"：不是改错了，是那台服务器没重启）；
>     房间 868127 → 1 条 YouTube 求赞话术被生产判据认出（就是那张"全都是问题"的截图）。
>   ▸ 判据**复用生产代码那一个函数**（`Asr.noiseRiffReason` / `isDupOrFragment` / `normAsrText`），
>     复盘脚本另写一份"什么算噪声"，报告说的就和系统做的不是一回事（坑 47）。
>   ▸ 自检 19 条钉住量具本身，其中三条是被真实数据逼出来的（见坑 105）。
> ④ **V4 · 再移植两个 reactbits（style.css 第 39 节）：ShinyText 给「加入一场会议」、BorderGlow 给授权卡**。
>   ▸ 选这两处的理由不是"哪里空就往哪贴"：前者是登录后第一眼要确认的"我该点哪儿"，
>     后者那张卡**会超时**而它只有一个静态金边——用户切窗口看资料时根本不会回头看，
>     这里的动感是**催决定的信号**，不是装饰。
>   ▸ `@property --ac-angle { syntax: '<angle>' }` 是这件事的命门：不注册，浏览器把自定义属性当字符串，
>     动画"在跑"、名字对、时长对，而角度永远不插值 → 边框一动不动。实测角度 0deg → 141.66deg 才算成立。
>   ▸ 量具改了三次（三次都是它的错，见坑 104）：拿卡内部当 0 对照（磨砂玻璃内部本来就在动）→
>     拿 reduced-motion 当对照（它把环境一起停了，两个零相减）→ 拿环带平均当判据（亮头只占周长 6% 被稀释）。
>     终版：读原因（角度在长）+ **只暂停这一条动画**比峰值与热点（实测 418→0 · 682→0）+ 数环上亮像素。
>   ▸ `prefers-reduced-motion` 单独一条断言，且它停的是"动"不是"信息"：环与标题都留着。
> ⑤ **V5 · 屏幕格的"两条死黑边"换成同帧模糊衬底（第 48 步）**——用户那句"共享屏幕比例还是有点不协调"的最后一半。
>   ▸ contain 是修对的（文档边缘被裁等于没共享），但它**一定留边**，而暖墨底上的死黑边读起来像"贴图坏了"。
>     比例由对方决定（16:10 笔记本、竖着的代码窗口、4:3 老 PPT），不能为了填满去裁 → 只能让那块地方不再空着：
>     同一帧放大模糊垫在底下（Zoom/腾讯会议 fit 模式同一招）。
>   ▸ 用第二个 `<video>` 而不是 canvas 逐帧画：两个 video 共用同一条 MediaStream 时**解码只有一份**，
>     模糊与缩放全在合成器里做（filter/transform 都是合成层属性）；canvas 方案要自己跑 rAF。
>   ▸ 顺手修掉两处"按位置取子节点"会被打断的地方（画中画入口 + 检查脚本各一处），并把衬底改成**追加**而非前插，
>     层级交给 z-index；黑边底色从 video 元素**挪到格子**——不挪的话 video 的背景会画满整个元素矩形，
>     把衬底整个盖掉，改了个寂寞（见坑 103）。
>   ▸ A/B 像素实验（同一帧、同一尺寸、一块加衬底一块不加）：黑边亮度 **13 → 105 / 13 → 72**，
>     内容区 143 vs 146 不变（证明没盖住主画面），并留一张现场图 `wb-rd-shots/screen-blur-ab.png` 给人复核。
> **回归（2026-10-06 夜实测，顺序跑，全绿）**：`test:smoke` **443/443**（+14：邀请面板 10 条结构、
>   衬底与画中画 4 条）· `test:sfu` **223/223** · `test:asr` **122 通过/0 失败/1 跳过** ·
>   **`test:review` 19/19（新）** · `test:nets` **20/20**（+1 双向赋值）· `test:watch` 36 · `test:store` 55 ·
>   `test:shutdown` 9 · `test:tts` 13 · `test:ai` 10 · `test:ai-brain` 74 · `test:qwen` 10+1skip ·
>   `test:publish` 30 · `test:record` PASS（251.1KB/4.0s）· `test:turn` UDP 两路可达（openrelay UDP 仍超时、TCP 兜底在）·
>   Mesh `npm test` **36/36** · `test:agent` **24/24** ·
>   **`check:all` 15/15 条 · 245 项界面断言**（check:visual 15→**40**、check:screenshare 10→**20**）·
>   `test:e2e-media` **38/38** · **`test:e2e-asr` 23 项 / 0 项失败**（真浏览器双窗，逐段转写 0.2~0.7s）·
>   `test:room-actions` **11/11** · `test:e2e-reconnect` **15/15** · `test:quiet-mic` **11/11** ·
>   `test:asr-live` **PASS**（说完→上字幕 **1.7s** · 正解命中 · 应答 1 次不多不少 · 并发在途峰值 2 ·
>   听觉进程静音退场后 1000ms 自愈重启）· **`soak` 8 分钟压缩 PASS**（239 条信令 · **断线重连 0** ·
>   归档 POST 48 条 = 回读 48 条对账一致 · 健康检查 16 次 **0 错误** · rss 50→56MB）·
>   `test:record` PASS（251.1KB/4.0s）· `doctor` **23 通过/1 警告/0 失败**。
> ⚠️ **两条如实挂着的**：① `test:voice-longrun` 本轮**没跑通**——两次都在浏览器启动阶段 CDP 超时
>   （`Page.enable 超时` / `Runtime.evaluate 超时`），当时本机空闲物理内存只有 2.2GB（另有第二个会话的
>   `sfu/server.js` 占着 3033 端口，不属于本轮、也没去动它）。它上一轮的 7/7 数字仍然有效，
>   本轮的连续性证据改由 `test:e2e-asr`（23/23）+ `test:asr-live` + `review:meeting` 的账本复盘三条共同支撑。
>   ② 全量 `check:all` 有一次跑出 check:visual 39/1（单独复跑 40/0 两次）——**会移动的失败先怀疑量具**（坑 80），
>   已把该实验的固定 sleep 改成"轮询到出现差别为止"（坑 104 第 ④ 次应验），此后未再复现。
> ⚠️ **仍然需要用户重启 3001 + `?nosw=1` 打开一次**：本轮全部改动（版本自检、邀请面板、模糊衬底、
>   两个动效、tsUrl 双向赋值）都在服务器进程与前端代码里。**版本自检横幅正是为这件事而存在**——
>   重启之后如果谁的页面还是旧的，它会自己说出来。
>
> **★ 2026-10-06 深夜（同一批要求的第四轮：先给"不要一段时间就停了"结案，再把操控实体的
> 泛化缺口从 54% 打到 0%——顺手用真实账本抓出我自己刚写进去的一条误拒）**
> ① **上一条挂着的那块石头先落地**：`test:voice-longrun` 这次跑通了，**7/7 全绿**——
>   5 分钟真浏览器 + 循环真语音：**定稿 31 条，31 条全部 `fin=silence` 收口**（不是靠 10s 保险丝）、
>   最大停摆 **14s**（红线 60s）、听觉进程 **0 次崩溃 0 次永久放弃**、AI 应答 28 次、
>   定稿延迟 **min 1.3s / 中位 1.8s / max 3.1s（n=31）**、输入侧 104 个有声段不断供。
>   ▸ 诚实记法：**上一轮跑不通不是代码问题**，是机器只剩 2.2GB 空闲内存在浏览器启动阶段 CDP 超时；
>     本轮同样没改那台工具，只是机器空出来了（4.75GB free）——"换个时间再跑一次"本身就是排查手段（坑 87）。
> ② ★ **泛化缺口是量出来的，不是感觉出来的**（用户第五次说"AI 操控实体还是实现的不行"之后）：
>   现有电池 32 句**全绿**，而我另写 28 句**从未进过规则表**的自然口语去测泛化，
>   首跑 **13/28 = 54% 不命中**（比 10-05 那次的 26% 更严重）：「弄个白板」「白板不用了」
>   「字幕先停一下」「把刚才画的都擦掉」「刚才那一笔不要了」「把说话的人放大」……
>   补齐动词/量词/倒装/省略宾语四类分支后 **28/28**，并在真浏览器里逐条落地
>   （`test:room-actions` 11 → **17 项**，含 6 句泛化说法真的把界面动了）。见**坑 106**。
> ③ **一条"做错方向"的缺陷（比少做更严重）**：「别切宫格，把白板打开」以前会把**宫格执行掉**。
>   根因：否定副词"别"和命中点"宫格"之间夹了一个轻动词"切"，旧守卫要求"别"紧贴命中点，
>   差一个字整条守卫形同虚设。修法只在窗口里容"最多一个轻动词 + 一个插入语"，
>   **有意不做**"整小句有否定就压掉"——语音送来的句子常常没有标点，
>   「不要开白板把字幕关掉」按小句判会把后半句一起压掉（少做可补，做错方向要人改回来）。
>   A/B 用旧守卫的副本证过可红：旧 `["view-grid","board-open"]` → 新 `["board-open"]`，
>   而原有 10 条否定反例（别关字幕/不要取消字幕…）一条都没被误伤。
> ④ **越界请求的"归类"也要准**：「把推广视频发一下」曾被判成 **camera**（旧表把裸"视频"
>   当设备词），用户收到的是一句答非所问的拒绝。现在裸"视频/画面"必须与 开/关/打/闭 同现
>   才算设备请求；另外补了「把会议录下来」「共享一下我的屏幕」两种真正说法的拒绝。
> ⑤ ★★ **上面那条修法当场写坏了最常见的一句话，是真实账本把它抓出来的**：
>   为了收「把会议录下来」我写了 `录(下来|一下)`，于是「把这条**记录**一下」被判成"开录制"
>   并**明确拒绝**——拿 `sfu/captions` 的 **3332 句真人字幕**回扫，这一句出现 **11 次**，
>   是用户对 AI 说得最多的求助，而且它本来真能办（记进待办/纪要）。
>   修 = `(?<!记)录(…)`；回扫结果 **误拒 14 句 → 1 句**（剩的那句是"打赞/收养"那条噪声幻觉）。
>   ▸ 这条现在有三处常驻防守，不再是一次性动作：**坑 107** + `review:meeting` 新增
>     「**指令回扫**」一行（每间房按**当前**规则重放人话，报"读成动作 N 句 / 判越界 K 句"，
>     人话 <10 句报 unknown 而不报"没问题"）+ `test:review` 自检 **19 → 23 条**（含"真祈使句
>     必须数得出来"这条反向对照）+ `test:asr` 加两条（记事求助不被拒 / 全量账本回扫 ≤2）。
> ⑥ **一条我先把结论写错、后来被字段证伪的观察**（它比"发现一个缺陷"更值得记）：
>   回扫第一版把账本里所有**非 bot** 条目都当成"人说的话"，于是得到
>   "18/3332 句会被读成房间动作，多数是 AI 自己的话被麦克风收回去"——听起来像个真缺陷，
>   我差点为它写一条"AI 说过就不执行"的抑制。
>   ▸ 核了 `asr` 字段才发现：**其中 13 条是 AI 写进账本的存档回答**（`asr:false`、name=AI 小明），
>     压根不是"谁说了这句话"。真正的麦克风转写只有 **864 句**，其中被读成动作的 **3 句，
>     而这 3 句全都是真命令**（「帮我开白板再白板这画」「小明，你打开白板」）
>     ⇒ **误触发 0，那个"回声自触发"的现象本来就不存在**。
>   ▸ 所以修法不是加抑制，而是**把回扫口径改对**（只数 `asr===true`），并把断言从
>     "逐句金标准清单"改成**比例 + 样本量**（≤2%、样本 <50 不下结论）——清单会在
>     用户说出新命令那天变红，那是假红制造机（坑 91 同一条）。
>     review:meeting 那行的注释里现在写死了这个口径（**坑 105 的形状：口径写错会编出一个不存在的现象**）。
> ⑦ **同一个教训用在第二处语言界面：意图分类也有泛化缺口**（坑 106 的方法论复用，
>   这次换 `sfu/ai/brain.js` 的 `INTENT_RULES`）：拿 22 句从未进过规则表的说法测
>   `classifyByRules`，首跑 7 句落进 `question`，而**全部集中在 chat 这一类**——
>   「你能帮我做什么」「小明你在不在」「你现在在听吗」「你怎么又没有声音了」。
>   为什么这不只是"少省一次钱"：无 key（或 LLM 超时）时 question 的 prompt 写死
>   "只依据会议记录回答" ⇒ 它真会去检索会议内容然后答非所问，
>   正是用户报过的**"他回复的永远是会上提到了什么"换个说法又复发一次**（10-03f 那条的另一半）。
>   ▸ 修 `chat` 的能力/状态/在场三类说法 + `minutes` 补"形成文字 / 存档 / 写成" + `operator`
>     补"在他电脑上"这类**带电脑上下文**的说法；22/22 命中。
>   ▸ **一条有意的保守**：`operator` 的裸动词（输入/打字）不加进非锚定分支——
>     误判 operator 会把人推进授权链路，而漏判只是少做一次动作（有 key 时 LLM 仍会纠正）。
>     于是「这个表要输入很多数据」「把白板上的内容输入到文档里」这类**谈论**留在 question，
>     连「帮我输入验证码」也宁可留在 question：判据写在测试注释里，不装作是完美分类器。
>   ▸ 回归：`test:ai-brain` 74 → **75**（新增 22 句泛化电池）。
> ⑧ **一处"三个副本"收口 + 复盘工具改口**：`e2e-asr / voice-longrun / e2e-reconnect` 三个测试
>   各写一份"喂给假麦克风的中文句子"，而 `review:meeting` 想分辨"这场会是真人开的还是我自测跑的"
>   就得拿同一批句子当依据——四处各写一份，迟早有一份漂掉而复盘把自测当真人会数（坑 47）。
>   ▸ 句子收进 `scripts/voice-fixture.js` 的 `FIXTURE_SENTENCES`（字符串一字未改，各测试的断言照旧），
>     并导出 `looksLikeFixtureCaption()`（大元组覆盖率 ≥0.6，短碎片不下结论）。
>   ▸ `review:meeting` 因此**改口**：原先页脚写"本报告会不区分真人场与自测场（账本里没这个事实）"，
>     现在多一行「谁在说话」= 自测场 / 混合场 / 真人场 / ❔。**过期声明比缺失更糟**（坑 82 的文档版），
>     但**过度自信的声明同样有害**，所以新页脚写明这是启发式：真会里有人复述同一句也可能被标。
>   ▸ 三档而不是二档是被真实数据逼出来的：房间 204534 命中 48%，按二档会被报成"真人场"，
>     可那里几乎每两句就有一句是念稿 ⇒ 判据在边界上给出与直觉相反的结论，是边界画错了位置（坑 53）。
>   ▸ 实测：10-06 那三场（953950 / 381906 / 260573）命中 89% / 90% / 70% ⇒ 全标**自测场**；
>     754183、843896 命中 0% ⇒ **真人场**；`test:review` 自检 23 → **27**（M/M2 组 4 条，
>     含"四成念稿不许被报成真人场"和"样本太少必须报 ❔"）。
> **回归（2026-10-06 深夜实测，顺序跑，全绿）**：`test:voice-longrun` **7/7**（补见 ①）·
>   `test:asr` **130 通过/0 失败/1 跳过**（+8：泛化 28 句、否定窗口哨兵、越界归类、记事求助、账本回扫比例、谈论≠命令）· `test:ai-brain` **75/75**（+1 意图泛化 22 句）·
>   `test:room-actions` **17/17**（+6 泛化说法端到端）· `test:review` **29/29**（+4 三档 +2 抬档反例）·
>   **`check:all` 15/15 条 · 245 项界面断言**（重跑确认；check:toggle 的"轮询到停住"改版后 11/11）·
>   `test:smoke` **444/444**（+1 fixture 单一来源红线）· `test:sfu` **223/223**（roomActions 改动后复跑）·
>   复跑前查明机器无孤儿测试服务（3001 与 3033 都无监听；用户自己的 Edge 进程一个没动）。
> **新记坑 106 / 坑 107**（见第 7 节）。
> ⚠️ **本轮全部改动都在服务器进程里**（roomActions 的动词表与判据），
>   仍需用户**重启 3001** 才吃得到；页面侧一行代码都没改，`?nosw=1` 这次不是必须。








> **★ 2026-10-03f 界面这一轮：四个 reactbits 效果零依赖移植 + 控件去 emoji 收尾 + 量出来"控制坞从来没放下去过"**
> ——用户："听不见声音 / 前端丑 / 头像动态效果差 / 参考 reactbits 优化各部分 / 自己学好点子加上去 /
> 各个部件那 low 爆的小图标好好改进"。全部**零新依赖**（React 素材按 WebGL/CSS 重写移植）。
> ① **"回答时不说话"的第三条独立死锁**（前两条见 02d/02e）：`hushAiSpeech()` 每条字幕开 8s 静默窗，
>   而语音问答的真实时序是「字幕到（开窗）→ 1.5~6s 后**这条提问的答案**到」→ 答案永远落在自己开的窗里，
>   还顺手销掉 `pendingServerTts` = **两头静音零报错**。修法=**认人别认时间**（拉黑被打断那一轮的 ts，
>   新一轮天然放行，不依赖两端时钟）；浏览器那一轨改成**以麦克风即时信号为主判据**（字幕只证明
>   "1~3 秒前有人在说话"，而答案总跟在字幕后面）。另修：回声闸窗口 160ms→500ms（扬声器→麦克风
>   物理上要几百 ms，160ms 等于没修）、`voiceTrace` 触发计数（坑 76 同一条纪律：机制"在"不等于"生效"）、
>   朗读搬进流式（`speakStreamPart` + 分句泵，一轮答案第一句"只说最新"）。
> ② **AI 答非所问的真根因**（用户"他回复的永远是会上提到了什么"）：`brain.js` 的意图表**没有 `chat` 这一类**，
>   "你现在能做什么"被归成 `question` → 强制走"只根据会议记录回答"的证据约束 → 它认真检索、认真答非所问。
>   补 `chat` 规则（判据是**主语是谁**：主语是你→chat，主语是会上→question，规则排在 LLM 之前=坑 38）
>   + `answerChat()`（不受会议记录约束、给能力清单与下一步）+ `isSelfEcho()`（自己的问题不该被当成证据捞回来）。
> ③ **四个 reactbits 移植**：BellToggle→控制坞开关（两层标签交叉淡入 + 环形脉冲 + 首次点击摆动，
>   `check:toggle` 12 项）；ThoughtLine→AI 思考条（阶段清单 + 呼吸/收焦，并**接上服务器从 09-30 就在发、
>   客户端一直在门口丢掉的 `phase`**，`check:think` 13 项）；GlowCursor→登录页光轨（**手写 WebGL 而非装 ogl**：
>   全屏大三角 + 64 点折线，`preserveDrawingBuffer` 专为可测，`check:glow` 12 项量到 `0.00×7 → 0.93×3 → 1.20`）；
>   PillNav→「进入会议」按钮（拱形升起，半径由 `pillRiseMeasure()` 按按钮真实尺寸算，`check:pill` 16 项）。
>   同时把项目名"简易腾讯会议"改为**云会议**（用户点名）。
> ④ **控件去 emoji 收尾**（09-19e 那条纪律的第二半）：画面格三颗悬浮按钮、每路音量三态、看板四类与负责人
>   徽标、AI 说话人名、批注工具条、字幕状态/延迟读数、滤镜键色、审计条、远程桌面工具条、安全横幅、
>   设备码入口、ICE 自检、CSS 里那颗藏着的 `content:'💭'` 全部换单色线性 SVG/CSS 图形。
>   **一条通用判据：`el.textContent = …` 会把同节点的图标一起抹掉**——所以"图标 + 会刷新的数字"必须
>   分成静态图标 + 子节点数字（`#capLatNum`），或让 JS 连图标一起渲染（`renderCapStatus` 按
>   "此刻是哪条链路在干活"选图标，判据只写一处）。新增 `check:icons` 12 项，其中 **B 项把页面上每个
>   `svg.i` 的实际渲染宽度量一遍**——因为"加了图标忘写尺寸"的默认下场是 300×150 撑爆布局，
>   这一条当场抓到 `.member-title` 的图标按 32×32 渲染。
> ⑤ ★ **控制坞在任何桌面宽度下都放不下，右边的按钮没人能点到**（本轮最大的真发现，纯量出来的）：
>   真浏览器 11 档视口实测 1890px 溢出 180px、1570px 溢出 479px、1250px 溢出 820px——
>   连 1920 的屏都放不下，"有些功能找不到"的真相在这儿，不在功能本身。
>   修法两步：坞按功能拆两行（会议控制 / 协作与 AI，**id 与顺序一个没动**），
>   再把"字幕条 + 坞"包进 **`.bottom-stack` 一列**——原先两处各写一个 `bottom:96px/128px`
>   猜坞的高度，坞一长高两者就叠住（坑 47 的布局版：一个概念一个来源）。
>   新增 `check:dock`：每档视口断言"坞不溢出 + 字幕条不被压住"，22/22 全过。
> ⑥ **AI 的"在听"改成真实音量驱动**（第 44 步，回应用户两次"头像没有状态变化"）：
>   波形原先只在 AI 自己 speaking 时出现且是 infinite 循环——与房间里谁在说毫无关系，
>   而"听"正是这个角色的全部工作。现在 `audio-levels`（既有信令，零新增采样）喂
>   `applyAiListening()`：条形高度 = 服务器报的真实 dB 拉伸，安静就归零，AI 自己说话时让位
>   （同一组条形不能有两个来源=坑 62）。dB→电平 的算术抽成**唯一**一处 `dbToLevel()`
>   （画面格音量条与这颗耳朵共用）。`check:icons` 的 H 项在真浏览器量 `DOMMatrix.m22`：
>   安静 `on=false`、有人大声说 `scale=0.75`（=(-14+55)/55，与公式对得上）、AI 发言时让位。
> ⑦ **AI 气泡读序**：证据链胶囊原先排在正文**上面**（用户先读到"检索 12 条取 3 条"才看到答案），
>   改成正文在前、过程作注脚在下；流式那一路同步改（`box` 之前没持有 `timeEl`，插不到正文后面——
>   坑 56 的 DOM 版）。`check:visual` 新增一条按 `children` 顺序断言的读序检查。
> **回归（2026-10-03 实测）**：`test:smoke` **343/343**（+50 本轮）、`test:sfu` **211/211**、
>   `test:e2e-media` **38/38**、`test:ai-brain` 74/74、`test:ai` 10/10、
>   `check:toggle` 12 / `check:think` 13 / `check:glow` 12 / `check:pill` 16 / `check:icons` 12 /
>   `check:visual` 15 / `check:dock` 22 全绿。
> **新记坑 77 / 坑 78 / 坑 79**（见第 7 节）。
> ⚠️ **仍需人工验证**：真人开麦时"它听我说话会不会跟着动"（合成语音与真人 RMS 节奏不同）、
>   两行控制坞在真机宽屏下的观感、光轨与升起按钮在鼠标快速移动时的手感。


> **★ 2026-10-04 用户截图里的三件事：白板吃掉字幕 / 坞那一排按钮要同一套手感 / 第一屏要配得上第一眼**
> ——用户："在让他调白板后字幕不可用了；之前的组件效果我要你应用到创建会议后视频下边的那些按钮；
>   还有进入网站的第一个页面也要美化"。三件都做完，其中第一件是**功能坏了**。
> ① ★ **"字幕不可用"的真相不是字幕坏了，是白板把它盖了**：白板覆盖层 `inset:0; z-index:6`，
>   而字幕条 + 控制坞所在的 `.bottom-stack` 是 z-index:5 —— 白板一开，**字幕条和整排按钮一起被吞掉**。
>   字幕那套状态机（开关/账本/看门狗/服务端模式）一个字都没错，用户看到的却是"字幕不可用"。
>   ▸ 取证手法：`document.elementFromPoint(元素中心)` 命中测试 —— 让页面自己回答
>     "我要点这块地方，浏览器会把事件给谁"。量出来白板开着时字幕条中心与控制坞中心的接收者
>     都是 `#boardCanvas`。新增 `npm run check:layers`（5 项）把这件事变成回归。
>   ▸ 修法不是"把 z-index 调小"：那样按钮能点了，但**白板底部那块画不到**，
>     从一个毛病换成另一个毛病。正解是让位——白板仍然盖画面（它的职责），
>     但底边停在底部那一列之上（第 45 步：`--stack-h` 由 ResizeObserver 量真实高度写入，
>     不在 CSS 里再写第二个猜的数）。
> ② **语音答案出现两条气泡、一只机器人两个名字**（同一张截图里 22:33:07「AI 助理」/22:33:09「AI 小明」，
>   正文一模一样）：根因在服务器——语音问答通路的终态 `chat-message` **把 streamId 显式置空**，
>   而前端靠 streamId 判"这一轮增量已经渲染过了"，拿不到就当新消息再插一条；
>   流式气泡的名字又是客户端写死的「AI 助理」，于是两条同名不同。@ai 打字通路一直是带 streamId 的。
>   ▸ 修法：两条通路**同构**——证据链文案与 ai 元信息抽成 `aiTraceParts(r)` / `aiAnswerMeta(r)`
>     各一处，两处调用；语音通路补 streamId + trace；前端 `aiBotName()` 从 room-state 取名字，
>     取不到才退回通用称谓（坑 47/56 的第 N 次复发：**内层算出来了、外层没带出来**）。
> ③ 拱形升起（第 43 步）从预览页扩到**会中控制坞那一排**：`.controls .btn:not(.tgl)` 全部装外壳，
>   `.tgl` 那几颗**有意排除**（BellToggle 自己已经是两层标签交叉淡入，再套一层就是两套动效抢同一颗按钮）。
>   ▸ 顺带修掉一个必然出现的连锁：坞里按钮的文案是 `setIconBtn` 改的，而 `innerHTML=` 会把
>     "圆 + 两层文字"一起清掉 → 症状是"点一下静音，这颗按钮从此不会涨了"。
>     现在 `setIconBtn` 之后原地重装一次（外壳定义仍只有 `pillRiseShell` 一处）。
>   ▸ 我自己在这次重构里写反了顺序（圆先 append、再搬内容 → 圆被搬进文字层套娃），
>     被第 43 步那条**老断言**当场抓到（"重复调用不长第二套"）——断言在写之前想不到的用法上救了火。
> ④ **第一屏（登录卡）重做**：朱砂印章品牌头 + 双语排版（先回答"这是什么产品"再谈"填什么"）、
>   三行输入各挂线性图标前缀（placeholder 一输入就消失，图标不会）、
>   密码可见切换（两颗图标都在 DOM、靠 `[data-show]` 选，不用 innerHTML 重建按钮）、
>   两个次要出口收进一行用"或"分隔（四个同等分量的按钮平铺 = 一个都不突出）、聚焦时整框鎏金环。
>   **11 个 id 一个没改**（新增 `check:login` 里有一条专门钉这个）。
> ▸ 桩侧补两处真实语义（否则测的是桩不是代码）：`appendChild` 现在**真的搬走**节点
>   （DOM 语义：一个节点只能有一个父；不搬则 `while (el.firstChild)` 在桩里死循环），
>   并补 `firstChild` 取值器。
> ▸ 检查侧一条新教训：无头浏览器窗口没有系统焦点，`element.focus()` 常常不触发
>   `:focus-within` —— 第一版据此判"CSS 没生效"是**假红**。改成用 CDP 真鼠标点一次再量。
> **回归（2026-10-04 实测）**：`test:smoke` **348/348**、`test:sfu` **211/211**、
>   `test:e2e-media` **38/38**、`check:layers` 5 / `check:login` 11 / `check:pill` 21（+6 坞按钮那组）/
>   `check:dock` 22 / `check:icons` 12 / `check:visual` 15 全绿。
> **新记坑 80**（见第 7 节）。
> ⚠️ **仍需人工验证**：白板 + 字幕同时开着时的画面观感（几何上不打架了，手感还得人看）、
>   第一屏在真机上的排版（截图已验 1280，窄屏只验了不溢出）、升起效果在坞换行后的对齐。


> **★ 2026-10-04b 后半夜这半场：把"写了"变成"证明它真在跑"**（用户指令"持续升级一直跑到明早 7 点"）
> ——本轮**没有加新功能**，全部在做一件事：把已经存在的代码证明它真的被执行，并且把
> "测不到"这件事本身变成可测的。四块：
> ① **冒烟桩补上 `speechSynthesis`**（缺这一个宿主能力 = 那条分支**永久不测**）。
>   症状：`speakStreamPart` 里写了 `answerTs: id`，而那个作用域根本没有 `id` 变量，
>   每次流式切出一整句就抛一次 `ReferenceError`（真浏览器控制台 3 次），而冒烟连跑两天全绿。
>   桩补成"像真的"——`speak()` 记文本，并按真实语义回调 `onstart`/`onend`
>   （泵是靠 `onend` 接力到下一句的，不回调就只念第一句）。于是第一次有了**行为断言**：
>   哪一句真的上了嘴、半句不单独念、只念新增那半句、新一轮 cancel 掉旧队列、
>   发音参数（zh-CN + rate/pitch）、`onstart` 触发"真的出声"计数并自动上报读数——共 8 条。
>   ▸ 红利当场抓到第二条真缺陷：**流式那一轨传的是 streamId（字符串）**，而
>     `enqueueAiSpeech` 登记延迟锚点写死 `typeof answerTs === 'number'`
>     → 语音问答（基本都是流式的）播报读数**从来没量出来过**，`/metrics` 长期少一整类样本
>     （坑 56：内层把 id 传出来了，外层按 ts 的类型判）。判据应当是"能不能当配对用的键"。
> ② **界面说实话**：字幕徽标曾拼成 **"服务器转写（服务器转写）"**。根因是 `client.js` 有**三处**
>   读 `/config.json`（进房 / 点字幕 / 浏览器识别失败兜底），而 `serverAsrEngine` 只有第一处会写，
>   兜底文案又恰好与外层模板同名。修法：三处共用唯一 `applyServerConfig(cfg)`
>   （**结构上不会再漏一半**，而不是"记得同步改"）+ 兜底改"引擎待确认"（不与模板重复）。
>   ▸ 测试侧同修一条**假绿**：e2e 那条断言写的是"含不含『服务器转写』"，所以它一直是绿的——
>     只查关键词在不在，查不出这句话是不是人话。现在 `check:console` 第 4 条断的是
>     "不自我重复 / 不露空括号 / 说『服务器转写』就得到处点明是哪个引擎"（真浏览器现场取证）。
> ③ **AI 不接半句**：新纯函数 `Asr.isNameOnly(norm)`（抹掉名字表复用 `WAKE_RE`，剩不到 2 字算光叫名字）
>   + server 侧"**光叫名字不作答、但顺延追问窗口**"。分段窗口把「小明，把纪要生成一下」切成
>   只剩名字的碎片时，旧代码拿一个光秃秃的名字去问模型 → 模型复述上一轮答案（= 用户报的"它又在重复接话"）。
>   位置排在在途锁之前（碎片不该占锁、也不该算进"AI 答了几次"），计数 `throttled{name-only}` 进 `/metrics`。
>   ▸ `test:asr` +7 条（5 条纯函数 + **2 条接线断言**：闸真的存在、且真的排在锁前 / 窗口真的顺延）。
> ④ **`npm run check:all` 上线**：一条命令跑完 **13 套真浏览器界面检查**（自起 3021 + 临时库 +
>   `SFU_NO_HTTPS=1` + `ASR_QWEN_LOCAL=0` 错峰，避免多台并发把显存吃满让引擎静默回落 CPU；
>   端口被占明确拒绝；还有一条"清单与 package.json 的 `check:*` 一一对应"的自检——
>   **新增检查漏登记不会让任何功能变红，只会让那条检查从此没人跑**）。
>   ▸ 它第一次全量跑红了两条，而**两条都是量具自己造成的**（这是本轮最贵的一课）：
>     (a) `?nosw=1` **每次加载都自带一趟自我导航**（注销 SW→清缓存→重载），于是每次测量都在跟
>         自己的跳转赛跑，表现为"红的档每次都换"（1920→1280→1152，全是 `target navigated`）。
>         两层修：产品侧"真的清掉了东西才重载"（没得可清就 `history.replaceState` 静默抹参数，
>         它不产生导航）；量具侧 `evalSettled` 取值失败重试 + **开跑前删掉自己那一档的 profile**
>         （上一轮留下的 SW/缓存会决定"这一轮要不要跳"= 坑 72）。
>     (b) 13 条检查**共用默认 CDP 端口 9333 与同一个 profile 目录**——串起来跑时"前一台刚 kill、
>         后一台可能连上半死的实例"。这是真实隐患，所以 `agent/cdp.js` 的默认端口改成认环境变量
>         `WB_CDP_PORT`（显式传入优先，**真实使用里的 9333 一个字没改**），runner 给每条一个专属端口
>         （profile 按端口派生，顺带把 SW/缓存也隔离了）。
>       ▸ **但要说清：这条并不是 check:pill 那次红的原因**——我一开始这样归因，随后被自己的复测推翻
>         （隔离端口之后它又红了一次，而同样的前缀序列又绿过两次）。红的时候 `scale=0.00`（不是残留的 1.20），
>         说明**鼠标根本没落上去**，可当时的报错只说"没落在按钮上"，查不出为什么没落。
>         本轮给它补了前提断言：先轮询到按钮真的占了一块面积，再用 `elementFromPoint` 问一句
>         "这块地方的事件归谁"（坑 63/55 同一条纪律：**测试的触发条件本身也要被验证**）——
>         下一次再红会直接说清是"没显示"还是"被盖住"，而不是一句"没落上"。
>         **根因尚未定论**（会移动的失败），这一条如实挂着，不写成"已修好"。
>   ▸ 同一类第三处：`test-e2e-asr` 的临时库用**固定名**，于是"用户名已被注册"被下一轮当成设置失败——
>     改成向多数派写法对齐（库名带 `pid+时刻`，每次运行天然是空的），收尾也真的删掉它。
> ⑤ 顺手两件：`check:console` 的 24 步交互循环改成 `await`（旧写法 `.then()` 不 await，
>   抛错记录可能落在"汇总已经打印之后"= **步骤真抛了错、检查照样报干净**），并给每步兜住
>   CDP 超时（量具坏不等于被测物坏，但也不能把其余 23 步的取证一起弄丢）；
>   `cdp.evaluate` 现在**真的收第二个参数**（超时）——原先有 5 处调用传了 `5000` 而被静默丢弃。
> **回归（2026-10-04 实测）**：`test:smoke` **374/374**（+26）、`test:sfu` **213/213**、
>   `test:asr` **49 通过 / 0 失败 / 0 跳过**（+7）、`test:asr-live` **PASS**
>   （两条字幕、正解命中 2 条、**应答 2 次不多不少**、定稿 3.8s / 1.3s、并发启动 9 段·在途峰值 2·跳过 37）、
>   `test:e2e-media` **38/38**、`test:agent` **24/24**、`test:e2e` **16/16**（触摸两条改成"等到发生为止"）、
>   **`check:all` 13/13 条通过（共 162 项界面断言）**、
>   `soak` 压缩 7 分钟 **PASS**（42 条归档 POST 与回读对账一致、0 错误、rss 65MB）。
>   `test:e2e-asr` 本轮**没有稳定跑通**：机器被并行任务压满时 `Runtime.evaluate` 超时（同一句假红的另一面），
>   它的设置阶段已修好，跑通与否如实挂在这里，不拿"应该能过"当成绩。
> **新记坑 81 / 82 / 83**（见第 7 节）。
> ⚠️ **仍需人工验证（重要）**：本轮改动全在 `sfu/`，**用户那台 3001 服务器还跑着旧代码**——
>   要看到这些效果需要重启那台服务器 + 浏览器用 `?nosw=1` 打开一次；
>   真人开麦的两条体感仍得人来判断：① 一句话被切成碎片时它**只答一次**，
>   ② 喊它一声"小明"它不出声、但把后半句说完就能接住。



> **★ 2026-10-07 通宵（用户："实时字幕长度太短要整句话显示但不越线 / 识别太笨要真正能用 / 跨网继续优化 /
>   共享比例还是不协调要丝滑 / 背景要能选明亮 / UI 再优化"）——一句话总结：
>   "识别太笨"不是模型笨，是我们只给它 2 秒**
> ① **整句重转（本轮最大的结构性修正）**：管线一直把语音切成 2 秒一段**分别**转写再用
>   mergeTranscript 拼句子，而中文的词会被切在段边界上。一次对照实验（同一批生产函数、同一段音频、
>   脚本量完即删）实测：逐字全对 **1/6 → 3/6**、多余字数 6→4、模型总耗时 **4.34s → 3.22s**。
>   真跑打印过的病灶原话：「服务器」→「服务。」+「起负载」、「生成」→「升」+「乘」、
>   「评审会」→「评审。」+幻觉「怎会？」。
>   ▸ 落地：`uttAudio` 攒这一句的已封口段 PCM（上限 12s≈384KB/人，内存有界）→ 定稿前一次整句转写
>     → `Asr.preferRefined`（比例判据，宁漏修不丢字）决定采用 → 账本 `ref:1`、`asr-caption.refined`、
>     `/metrics` 三条（发起/采用/耗时）、`review:meeting` 新增「整句重转」一行（0% 时直接说"重启 3001 才有"）。
>     引擎链抽成唯一一处 `runEngines`（分段与整句共用，增益口径同一条）。`ASR_REFINE=0` 可整条关。
>   ▸ 端到端实测：`test:asr-live` 定稿两句**逐字全对**（含被丢掉的「会」）、`定稿原因分布：silence/silence`、
>     ⏱ 1.7s → **2.7~3.1s**（诚实上移，因为多了一次整句推理；换来的是完整正确的一句）。
>   ▸ ★ **但这把尺后来自己量出了一个反噬形态**（同日 `TEST_ASR_DEBUG=1` 复跑，见下面 ⑬）：
>     一次整句重转把「…明天下午三点的评审」扩成「…评审**器真不错,拍麦亚。**」——
>     变长的那条又让**下一句的正确定稿被去重闸吞掉**（账本只剩 1 条，自测当场 FAIL）。
>     于是 `preferRefined` 补了两条**只加保守**的膨胀上限（句末标点不许变多 / 长句字数不许超 1.35 倍，
>     短句豁免），四条正反向断言钉住。**机制有触发计数之后，才看得见它什么时候在帮倒忙**（坑 76 的反面）。
> ② **顺带抓到上线以来的"丢尾"缺陷**：成句闸在"装着句尾字的那一段还没被消费"时就放行
>   （`pickReadySegment` 永远跳过最新段），于是「…评审会」的「会」落进**下一句**。
>   修法 = `pendingTailSegment()`：还有"出生早于最后有声+RMS滞后且未消费"的段就不许定稿
>   （两把保险丝 max-age/max-open 保证不会饿死）。
> ③ ★ **一条被实测否决的优化 + 一次量具自伤**：想把"等尾巴段"那 ~0.5s 省掉，第一次跑出 3.7~5.4s、
>   reason 退化成 split，我把它写成"实测否决"——**真凶是我自己为跑界面检查另起的 3021 服务器**
>   （它的 whisper 常驻 worker 占着 GPU，整句推理从 0.6s 被顶到 4.3s）。清掉重测才看清：
>   延迟确实降到 ~2.2s，但账本只有一句正常字幕、AI 却先回「嗯，我在听。」再把没叫它的闲聊当"后半句"接了
>   ——省 0.5 秒买回用户明令禁止的插话，所以仍否决，但**否决的理由换成了真的那个**。坑 81/87 第五次应验。
> ④ **两条真缺陷（同一次追查里掉出来的）**：
>   ▸ `AI_ASK_TAIL_MS = Math.max(2000, 秒) * 1000` —— 下限按毫秒写、整式又乘 1000 ⇒ 6 秒变成 **33 分钟**
>     （日志实证 `tailUntil剩余=1981680`）。后果正是用户最反感的"不叫它它还是接话"：
>     只要有人只喊一声「小明」，之后半小时谁说话它都接。修成秒/毫秒两个常量（新坑 111）。
>   ▸ RMS 打到管道上仍按 ~4KB 成块交付 ⇒ 第一行 RMS 约 5 秒后才到，那段时间 `lastVoiceTs=0`
>     ⇒ gap 代理判据把开机第一句切在只含名字的「小明」上（上面那条 33 分钟窗就是被它 arm 的）。
>     修法 = 冷启动宽限 8s（`ASR_RMS_GRACE_MS`）；稳态成块这件事**如实挂成路线图的 H2**。
> ⑤ **应答归因从"时间邻近"改成"因果"**：自测原先判"闲聊句定稿后 7s 内有没有应答"，
>   而应答要等 LLM（2~5s 还要算生成纪要）⇒ 上一问的迟到答案会被错记到闲聊句头上。
>   服务器现在随每条答案带 `trig`（引发它的那条字幕时刻），判据查事实不猜窗口。
> ⑥ **字幕卡两行**（"长度太短"的另一半是布局不是识别）：正文原先 `white-space:nowrap` 与八个控件
>   挤在同一排胶囊里，真实可用宽度只有一百多像素。改成"正文独占一行（恒定两行高、超出省略号、
>   全文进 title 与历史抽屉）+ 控件落第二行"。新增 `npm run check:caption` **19 项**真浏览器量：
>   宽度 850px、`-webkit-line-clamp` 解析成 2（窄屏 3，行数只有一处来源 `--cap-lines`）、
>   超长句 scroll>client 且不越出容器、条高不随句长抖。
>   ▸ 途中自己踩到"写了没生效"：`.caption-bar` 的 `max-width` 被后面更具体的
>     `.bottom-stack > * { max-width: 100% }` 整个吃掉（computed 给 100%、条子铺满 1050px）——
>     改用 `width` 并加一条"宽屏 ≤880px"的断言钉住。
> ⑦ **明暗双主题（宣纸 / 水墨）**：23 处"深色专属"收进语义 token（`--fill-rgb` 面板填充 /
>   `--lift-rgb` 悬停方向 / `--vignette` / `--atmo-*` / `--scroll-thumb` / `--btn-bottom`），
>   浅色档**每个语义色重新定档**（鎏金 #d8b36a 在浅底上只有 1.6:1 → 压到 #8a6a15）；
>   画面格与视频上的浮层**有意保持深色**（视频帧是任意内容）。顶栏开关 + localStorage +
>   head 里 6 行内联脚本防首帧闪、`meta theme-color` 跟着翻。新增 `npm run check:theme` **18 项**，
>   含 WCAG 对比度实测（浅色档正文 14.53 / 成员行 15.71 / 气泡 16.67 / 徽标 4.97 / 主按钮 5.35，全部 ≥4.5）。
> ⑧ **共享"比例还是不协调"的真身不在比例**：`.stage` 的 `padding-bottom: 84px` 是**猜的坞高**，
>   而底部那一列早就是"两行坞 + 字幕卡"（实测 201px）⇒ 网格伸到半透明玻璃坞底下，
>   `backdrop-filter` 把身后的共享画面糊出来一大片（截图里那片"漏出来的绿"）。
>   所有几何数字当时都是对的（ar=1.778、横向零溢出），**画面是脏的**——坑 96 又一次应验。
>   修法不是把 84 改成 223，而是把那一列**放回舞台的正常布局流**（重叠在结构上不可能发生，坑 79 第三次）。
>   `check:screenshare` 18→**22 项**（新增"网格盒子与底部列零重叠""格子可见部分零重叠"两条）。
> ⑨ **UI 再优化（reactbits 移植 + 图标补齐）**：分段控件的**一块会滑的墨**（侧栏金线 + 视图底片，
>   取代每颗按钮各自画一份选中态的跳变）；视图切换的 ▦/▢ 几何字符换成全站同款单色线性 SVG。
>   `check:visual` 40→**44 项**。途中被自己的量具骗了两次：读过渡中的 rect 反推"静态位置"会越算越飞
>   （改成"临时摘掉 transform 现量一次"），以及底片断言里写了个不存在的键 `inkD.b0` 让"挪没挪"恒真（坑 110 家族）。
> ⑩ **跨网自检进界面**：`sfu/nets.js` 新增 `diagnose()`（纯函数、可穷举），把"这台机器能不能被外面连上、
>   缺什么、下一步敲哪条命令"算成一份判定随 `/config.json` 下发，渲染在邀请面板里；
>   诚实边界写在结论里（**mediasoup 媒体面不走 TURN**，公共 TURN 到不了 NAT 后的服务器）。
>   新增 `check:invite` **8 项** + `test:nets` 11→**31 项**。
> ⑪ **别字表补「计要」**：真浏览器 e2e 里唯一**活到定稿**的会议动作词别字
>   （「把计要生成一下」同一场出现 4 次、0 次对；旧表只收 既要/记要）。它直接掐掉纪要意图的
>   字面匹配 = "AI 答应了但什么都没做"。仍按"必须贴着动作词"收，**不给裸词豁免**
>   （「从长计，要不要…」是跨词真话，坑 49 第四次应验；正反向 4 条断言钉住）。
> ⑫ ★ **`test:asr-live` 在同一天由绿转红，红的是我刚上线的机制**（不是环境）：
>   上面 ① 那条"逐字全对"的 PASS 之后，`TEST_ASR_DEBUG=1` 复跑 **FAIL**——
>   诊断行摊开噪声底 **−42.9 dBFS**（自适应有声判据被顶成"几乎一直在说话"）⇒ 三句话粘成一条 utterance
>   ⇒ 整句音频里本来就含着后一句 ⇒ 重转如实转出两句 ⇒ 变长的条目让下一句正确定稿被去重吞掉（账本只剩 1 条）。
>   已修（`preferRefined` 两条膨胀上限，见 ① 的 ★ 段），**并把这条 FAIL 与修法都留在文档里**：
>   机制"触发了"与"触发得对"是两件事，只有触发计数不带这个信息。
>   ▸ 剩下的真问题如实挂着（不是本轮引入，也不是本轮能修的）：**吵房间/AGC 顶起底噪时静音确认失效**，
>     句子会粘成 blob。`review:meeting` 的「字幕形态」那行就是量这个的（≥25 字长条%），
>     处方要在真人真麦数据上定（拿合成/假设备音频调这条阈值 = 10-05e 警告过的"放宽一处、下一环遭殃"）。
> ⑬ ★★ **H8：吵房间把三句话粘成一条 blob ——「与修前一字不差」原来是一个 bug 的别名**（新记坑 115）：
>   "此刻有没有人在说话"的判据 10-06 版是 `min(绝对阈值 −50, 噪声底+6)`，**只允许更灵敏**。
>   于是吵房间（噪声底实测 −42.9 ~ −45.9）里**底噪本身就在阈值之上** ⇒ 每一帧都判"有人在说" ⇒
>   `lastVoiceTs` 永不超时 ⇒ `silenceConfirmed` 永不成立 ⇒ 句子只能等 10s 保险丝 ⇒
>   **三句不相干的话粘成一条 blob**，而且顺手把 ① 的整句重转推进反噬形态。
>   ▸ 修法 = 单边 `min()` 换成**双边钳位** `clamp(底噪+6, −74, −42)`：
>     `−42` 这条"绝不比这更迟钝"的硬线，是为了不把 10-05d 那批 −56 dBFS 的安静麦克风用户整个弄聋
>     （坑 91 的另一半）；`−74` 是"再安静也不往下追"。两条都 env 可调 + `ASR_VOICE_ADAPT=0` 整体回退。
>   ▸ **A/B 数字（同一份 fixture，可红可绿才算证据）**：吵房间（底噪 −45/语音 −28）
>     旧版 **180/180 帧底噪被判有声** → 新版 **7/180**（只剩攒够样本前的暖机帧，那几帧另有一条断言守着）；
>     中等房间（−60→−54）与安静房间（−72→−66）**与 10-06 一字不差** ⇒ **只有该变的那一档变**。
>   ▸ 真链路：`TEST_ASR_DEBUG=1 npm run test:asr-live` 定稿从"1 条 blob"回到 **2 条、全部 `fin=silence`**，
>     那句没叫它的闲聊终于自己单独成句（⑫ 那条 FAIL 的前置条件就此成立），⏱ 3.1s。
>   ▸ 当年把"吵房间行为与修前一字不差"**当卖点写进断言**——它保护的是一个 bug 整整一天。
>     ▎通用判据：**"不改变旧行为"不是安全性质**，它只是把旧行为冻结；
>       反向对照要钉的是"这个场景本来应该是什么行为"，不是"和昨天一样"。
> ⑭ **`preferRefined` 的两条膨胀上限只管"变长"——第一版把它们做成了无条件判据，杀错了对象**：
>   同一轮真跑里掉出来的反例：拼接「今天天气很大 武器真不错 拍卖呀」(13 字、没标点)
>   重转「今天天气真不错,拍麦呀!」（**更短、词全对、只是补了标点**）被"句末标点不许变多"拒了。
>   而 blob 那条是**变长**的（22→28）。判据该问的是"它听见了比这一句更多的东西吗"，
>   不是"标点多了吗"——**变短的重转结构上不可能藏着别人的句子**（坑 109 同一条：
>   为可读性动的判据，必须回头检查它有没有把自己正在保护的东西切掉）。
>   ▸ 同一轮另一条正向证据：重转给出「小明,帮我记一下会。」（截断、更短）⇒
>     被"少太多不许换"那条拒掉、保留拼接结果 ⇒ **宁漏修不丢字**这条设计意图第一次被真数据走到。
>   ▸ 如实记：这两晚 `test:asr-live` 里整句重转**采纳 1 次、拒绝 3 次**——
>     它对"尾字被切掉"是保险而非保证；采纳率的天花板就是本地 0.6B 在长音频上的稳定性（H3/H1）。
> ⑮ **H6 落地：跨网退化从此有常驻哨兵**（`scripts/watch.js` 新增纯函数 `diagnoseNetAccess`）：
>   值守每轮读 `/config.json` 的 `netCheck`（判据在 `sfu/nets.js` 算，watch **不另写一份"能不能跨网"**——坑 47），
>   `level` 变差（public→tailscale→lan-only→localhost-only 的秩）报一条并附上不合格项 + 可复制的修复命令；
>   恢复只在控制台说一句；**第一观测不下结论**（否则每次值班启动都叫一次 = 噪音）。
>   配置漂移（`announcedIp` 过期、本次靠自愈顶着）**单独一条**——它常常**不改变 level**，
>   若不单独报就正好落在"沉默"那一类里。
>   ▸ 9 条判据 + **3 条接线断言**（`tick` 真的 fetch 了、返回值真的进了 `alert()`、跨轮传的是
>     模块级 `netState` 而不是每轮新建的对象——新建就永远等于"第一观测"，告警永不响）；
>     三条接线断言都 A/B 证过可红（把 `netState` 换成 `{level:null}` → 红；把 `alert()` 摘掉 → 红）。
>   ▸ 真服务器验过一遍：`/config.json` 实下发 `level=lan-only`、`announcedIp:"auto"` 落到网卡 WLAN，
>     首轮 0 条告警、把 level 换成 localhost-only 立刻出一条 `net-downgrade`。
>   ▸ ★ 我自己在这组测试上**第二次踩了坑 110**：本仓库 `test-watch.js` 的助手是 `ok(条件, 名字)`，
>     而 `test-asr.js`/`test-sfu-signaling.js` 是 `ok(名字, 条件)`。我照熟的那个顺序写完 9 条，
>     输出全成了 `PASS true` —— **9 条全绿而一条都没测**。换序之后当场有 1 条真红，
>     并顺着它查出产品侧一个真 bug：配置漂移那条判据被写在 `level === before` 的提前返回**之后**，
>     于是"配置过期但 level 没变"这个最常见形态永远不会报（新坑 116）。
> ⑯ **H5 量完了 + H5b 顺势做掉：多人会议里整句重转会与真话抢同一个 worker**
>   （新工具 `npm run bench:asr-multi`，直接压真实的 qwen-local 常驻 worker，把"几个人在说"当自变量）：
>   | 并发 | 分段 p95：只分段 → 每句重转 | 吞吐保住 | 重转次数 |
>   |---|---|---|---|
>   | 1 路（用户现在的用法） | 0.60s → **0.37s**（没变差） | 112% | 3 |
>   | 4 路 | 1.48s → **2.02s**（×1.37） | 75% ❌ | 12 |
>   | 8 路 | 2.80s → **4.20s**（×1.50） | 75% ❌ | 24 |
>   ▸ 处方 **不是**路线图原来写的"只给要送给 AI 的那句做整句"——那会把字幕质量在多人房里整体退回去，
>     而字幕正是用户抱怨的第一件。改成 **H5b「忙时让路」**：`runEngines` 出入口各一次维护
>     **全服务器在途数** `asrEngineBusy`（分段与整句共用一个口径），定稿时若在途 >0 就用拼接结果收口、
>     不发起第二次推理，并单独记 `refine.skipped`。
>   ▸ 实测处方有效（同一台量具，三档对比）：4 路 p95 回到 **1.45s（×0.98）、吞吐 92%**；
>     8 路 **3.01s（×1.08）、94%**；而 **单人档让路 0 次、重转 3 次** ——
>     这条"单人一次都不许让"是判据的反例守卫：**让路做过头 = 功能整个不跑**，
>     而报告上看起来与"延迟修好了"一模一样。
>   ▸ 一本账不够就得第三本：`n / fixed / skipped` 三格分开，否则
>     "一直在让路所以什么都没做"与"做了但都被 preferRefined 拒了"两种病分不开（坑 76）。
>     `/metrics` 新增 `sfu_ai_asr_refine_skipped_busy_total` + `sfu_ai_asr_engine_busy`（gauge），
>     `/api/rooms` 顶层 `collab.asrBusy`；开关 `ASR_REFINE_YIELD=-1` 只撤"让路"这一个变量
>     （不是关掉重转——A/B 时要能单独看它的贡献）。6 条接线断言各自 A/B 证过可红。
>   ▸ **8 路基线自己 p95 就有 2.80s** ⇒ 那是这台单进程 worker 的容量线（归 H1/多 worker），
>     不记在整句重转的账上；判词的参考点因此是**基线**而不是一个凭空定的毫秒数——
>     第一版我设了绝对线，把"处方成功回到基线"报成了失败（坑 75 的另一种形状：判据的参照系选错）。
>   ▸ 同一轮真跑的正面证据（`TEST_ASR_WAIT_WARM=1`，两次 PASS 各采到 2/2 与 0/2 ⇒
>     **它是保险不是保证**，见下面回归那行的如实记法）：
>     「小明，帮我记一下明天下午三点的评审会。」（尾字「会」回来了）
>     与「今天天气真不错，拍卖呀！」（正是 ⑭ 那条"误杀"修好之后才被采用的那一类：更短、词对、只补标点）。
>   ▸ ★ 顺手记一条**会被误读的 FAIL**：不加 `TEST_ASR_WAIT_WARM=1` 时同一套代码会红在
>     "闲聊句一条字幕都没转写出来"，日志显示那一路走的是 **whisper 兜底**、单段转写 **10.7~11.2s**
>     ⇒ 段在排队、句子在堆积，粘成一条 blob 与阈值判据无关。判据：**看到 blob 先确认此刻是哪台引擎**
>     （`[ASR/常驻]` vs `[ASR/qwen-local]`），别把降级路径的正常形态当成产品回退（坑 57 家族）。
> ⑰ **H4 第二遍：把"浅色档还有哪些面读不出来"从猜测变成扫描**（`check:theme` 加 `SWEEP` + `OPEN_OVERLAYS`）。
>   ▎为什么不继续"我想起哪儿就看哪儿"：上一轮只点了首屏几处，扫出 10 条浅色档不合格；
>     样式表里还有一大片硬编码色，**靠人列清单只会列出我想到要看的那几处**（坑 106 同一条）。
>   ▸ 做法：把页面上**每一个真的在显示文字的元素**遍历一遍，沿祖先合成出实际背景色，按 WCAG 算比值
>     （正文 4.5、大字 3.0）；再把**浮层逐个掀开**重扫——历史抽屉/邀请面板/白板/滤镜/诊断卡/
>     版本横幅/设备码面板。覆盖面从 **23 处 → 57 处**。
>   ▸ 修掉的：浅色档 `--fg-faint`（3.8→5.86）、`--accent`（tile 底 4.13→4.90，**按最差的底定档**）、
>     日志文字 `#b3a88f` 硬编码提成 `--log-fg` token（浅底上原本 **2.29:1**）、
>     升起按钮的标签层 `color: var(--pr-hover-text, var(--fg))` → **`inherit`**
>     （"离开房间"是朱砂底 + 墨字 = 2.25:1；正解不是给 danger 再补一条变量，
>     而是**标签层不许自己发明颜色**——坑 47）；`react-btn` 从来没设过 color（浏览器默认黑），
>     emoji 时看不出来，一旦回退成文字就是黑字压黑底 ⇒ 深色档那条 1.09:1 就是它。
>   ▸ ★ **顺手挖出一个从 2026-10-02 就在的坑 26 家族隐患**：style.css 里一条注释
>     结尾只有装饰横线、**漏了闭合符**，把下一个小节头一起吞成注释（这次恰好没吞掉规则，
>     所以两年没人看见——**"这次没坏"不等于"这写法安全"**）。修好之后补了一条
>     **冒烟结构红线**：style.css 块注释深度必须归零、且不许出现孤立的闭合符；
>     两个方向都 A/B 证过可红（抽掉一个闭合 → 报出行号；多一个孤立闭合 → 报出另一行）。
>     防守从"注释里别写那个序列"这条**人的纪律**升级成了机器判据——坑 40 早就说过纪律会被忘掉。
>   ▸ 判据自身也升了一次：新增**绝对红线**"两档都 0 条不合格"（原来只有"浅色不比深色差"的相对线），
>     外加"扫到 ≥40 处"作为**浮层覆盖面的哨兵**。
>   ▸ ★ **最后一格是 `dashboard.html`：它压根不跟主题走**。会议页顶栏那个开关把选择存进
>     `localStorage('sfu-theme')`，而面板是**另一个文档**、自带一套只按深色定的内联样式——
>     用户选了宣纸、点进 /dashboard 又是一整页黑。这不是"没做"，是**产品内部不一致**：
>     界面在无声地说"那个开关只管首页"。做法：18 个色值收成 token 块 + `html[data-theme="light"]`
>     重定一档、首帧前内联读存储（与 index.html 同键）、canvas 那 3 处颜色改成
>     **运行时读计算值**（`ctx.fillStyle='var(--x)'` 不报错，只是**悄悄退回黑色**——
>     又一个"不报错的错"）；面板 2s 重绘所以换主题无需额外通知，下一帧自然新色。
>     `check:theme` 因此扩到 **25 项**：新增"面板页也跟随同一份主题状态"+"两档各扫一遍都 0 条"。
> ⑱ ★ **H1：本地 ASR 从"一条串行队列"变成"按成员分片的 worker 池"——容量这件事第一次被量出来**
>   （新工具 `npm run bench:asr-multi` 把"几个人在说"当自变量，直接压生产那套 qwen-local worker）：
>   ▸ 8 路并发 + 开着"忙时让路"实测（同一场次跑 **1→2→1** 三次）：**1 个 worker 分段 p95 3.14~3.18s /
>     吞吐 2.59~2.62 次每秒 → 2 个 worker p95 1.78s / 吞吐 4.30**（≈1.65 倍，第三次复跑落回原值
>     ⇒ 不是"GPU 越跑越快"换来的差值）。
>     这不是"重转的账"（那是 H5b 让路挡掉的），是**单进程串行**这条结构性上限。
>   ▸ 默认**仍是 1**：一个 worker 常驻 **≈1.9GB 显存**（nvidia-smi 实测两个同跑总占用 5.0GB），
>     而这台 8GB 卡上还住着浏览解码与 whisper 兜底。**显存不够的下场不是报错，是引擎静默回落 CPU**
>     （10-04e 为这件事红过一整轮）——所以"扩容"必须由人显式开（`config.asrQwenWorkers` /
>     `ASR_QWEN_WORKERS`），而 `npm run doctor` 新增 **A7d 显存预算体检**替用户算这笔账
>     （need = 配数 × 1900 MiB，与 `总显存 − 1500 MiB 余量` 比；余量是给浏览器+兜底的，env 可覆）。
>   ▸ **路由判据 = 按成员稳定分片，不是轮询**：同一个人的段必须按顺序回到同一句话的文本流里
>     （`mergeTranscript` / 尾巴段判据 / 整句重转的音频账本都假设"这一段属于这个人"）。
>     轮询会让第 2 段排在另一个 worker 上先回来 ⇒ 症状是"字幕半句颠三倒四"且零报错（坑 58 同族）。
>     槽被判死时退到**任意活着的槽**（宁可慢，别没人转）；全死返回空串，由服务器回落 whisper。
>   ▸ 三条可观测：`sfu_ai_asr_qwen_workers` / `_alive` / `_in_flight` + `/api/rooms` 的
>     `asrWorkers {configured, alive, restarts, slots[]}` —— "配了 2 个"与"活着 2 个"是两件事，
>     只看配置会把"2 号槽早就判死了"读成"扩容没效果"（坑 76）。
>   ▸ ★ **这一轮我自己产出并撤回了三个"实测"**（都写进代码注释，坑 117）：
>     ① 第一版 bench 报"加 worker 吞吐反降"——真凶是量具**没把 `key` 传到 `transcribe()`**，
>       所有请求落 0 号槽，2 号槽白占 1.9GB；② 我看到"6 个 id 里 5 个落同一槽"就把注释写成
>       "实测旧哈希分片不均"，可那 6 个 id 是**我随手编的**；换 64 个真实形状再量：两种写法都均衡，
>       5/6 只是 n=6 的正常波动；③ 第一次拿"1 worker 让路 p95 2.73s"与"2 worker 1.34s"当结论，
>       隔两小时复跑同一档却漂到 3.18s —— **绝对值随机器冷热漂**，于是改跑 1→2→1 三次，
>       只信**同场次内的比值**（第三次落回原值才敢写"≈1.65 倍"）。
>       ⇒ **写"实测"之前先问样本量是多少、样本是不是我编的、对照是不是同一场次里做的**；
>       而"扩容反而更差"这种结论，第一个要怀疑的是**扩容那条路有没有真的被走到**。
> **回归（2026-10-07 实测，顺序跑）**：冒烟 **445/445** · 信令 **225/225** · asr **214 通过/0 失败/1 跳过**（H1 那组：分片稳定/路由接线/取值判据单一来源）·
>   nets **31/31** · review **40/40** · **`check:all` 19/19 条 · 311 项界面断言**（H4 那轮之后 304→308→311）
>   （新增 caption 19 / theme 18 / invite 8 三件套；**首跑报的是"20 条 · 312 项"，那是假数**——
>   `check:invite` 在 CHECKS 清单里登记了两次，同一套检查跑两遍、断言数加两遍，
>   而去重前那条"清单与 package.json 一一对应"的自检**结构上查不出来**（它比的是 some/includes，
>   不是计数）⇒ 清单类断言除了"有没有漏"还要问"有没有多"，已补 `dupKeys` 判据并 A/B 证过可红）·
>   `test:asr-live` **PASS**（`TEST_ASR_WAIT_WARM=1` 下重转**采纳 2/2**、两句逐字全对 · ⏱ 2.9/3.0s ·
>   定稿 2 条全部 `fin=silence` · 应答 1 次不多不少 · 让路 0 次）·
>   **修完 runEngines 外壳后复跑再一次 PASS**（⏱ 3.0/3.1s、定稿 2 条全 silence、
>   账本里「小明，帮我记一下明天下午三点的评审会。」逐字全对；那一次重转**跑了但没被采用**——
>   拼接结果本身已经完整。⇒ 如实的写法是"**采纳 0~2 次/场，随拼接是否已完整而定**"，
>   它是**保险而不是保证**；只报"采纳 2/2"那一次就是挑数据。）·
>   `test:watch` **54/54**（+11：H6 跨网退化 8 条判据 + 3 条接线，均 A/B 证过可红）·
>   `bench:asr-multi`（新）三档对比出 H5 的问题与 H5b 的处方。
>   ▸ **H1a 落地后的整轮复跑（同一天深夜，全部顺序跑、一次一个）**：
>   asr-live 再 PASS（池化之后：定稿 2 条全 `fin=silence`、⏱ 3.0/3.0s、重转**采纳 2/2**、应答 1 次不多不少、
>   在途峰值 2=上限）· Mesh **36/36** · agent **24/24** · e2e **16/16** · e2e-reconnect **15/15** ·
>   room-actions **17/17** · quiet-mic **11/11** · e2e-media **38/38** · store **55/55** · shutdown **9/9** ·
>   ai **10/10** · qwen **10/10(+1skip)** · tts **13/13** · ai-brain **75/75** · publish **30/30** ·
>   record **PASS**（251.1KB/4.0s）· turn **2 条 UDP 可达 + TCP 兜底** ·
>   **doctor 24 通过/1 警告/0 失败**（新增 A7d，且用三档验过它真会翻脸：1 个 ✅ / 4 个 ⚠️ 带改小命令 /
>   余量设 0 又 ✅）· e2e-asr **25 项 / 0 项失败**（逐段转写 0.2~0.5s）。
> **新记坑 111 / 112 / 113 / 114 / 115 / 116 / 117**（见第 7 节；115 是本轮最贵的一条——
>   一条**常绿**的反向对照把"吵房间把三句粘成一条"这个 bug 冻结了一整天）。
> ⚠️ **需要用户重启 3001 + 浏览器 `?nosw=1` 开一次**才吃得到（整句重转/丢尾闸/单位修正/RMS 宽限
>   全在服务器进程里；字幕卡、双主题、滑动墨在前端）。
> ▸ **词级准确率天花板没解决**（「大木车 / 洗地皮 / 庭审会」）：本地 0.6B 在 -56~-65 dBFS 上的上限，
>   三条路（云端 / 更大模型 / 靠近麦克风）等用户拍，不拿合成音频替他调阈值。
> ▸ 下一批见 `后续升级方向.md` **0.6**：H2 RMS 成块交付（地基）→ H6 netCheck 进 watch 告警 →
>   H5 多人会议下整句重转的成本（先量化再谈 H1 流式）。

---


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
>   首个管理员 = **本机第一个注册的账号**（账号名不写进公开文档）（此前库里 0 个 admin，导致 `/dashboard`、`/metrics` 对所有人 401）。
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

> **★ 09-28 服务端 ASR 成为唯一识别路径 + AI 多轮语音对话（"whisper 装了却没用上"事故修复）**——
> 用户点名的三件事：whisper 已装 → **不要再用浏览器的** → 让 AI 参会能正常对话。
> ① **根因（装了 ≠ 用上了）**：服务器用 `whisper --help` 判存活，而 whisper CLI 在
>   **中文 Windows / GBK 控制台**下打印帮助会 UnicodeEncodeError → 退出码 1 →
>   服务器认定"未装 whisper" → `asrEnabled=false` → 前端退回 Web Speech（用户看到的现象）。
>   另一个兜底候选 `__py__` 把 `process.execPath`(node.exe) 配 `-m whisper` 用——永远失败。
> ② **修法**：新增 **`sfu/ai/asr.js`（唯一实现层，与 password.js 同一条教训）**——
>   所有 whisper 子进程带 `PYTHONIOENCODING=utf-8/PYTHONUTF8=1`；探测=「--help 退出码 0」；
>   候选含 pip --user 路径与 `python -m whisper`；**形态白名单**防注入；
>   **模型默认 tiny**（实测 4s 语音：tiny 4.2s / small 10.8s）、分段默认 5s、
>   跨说话人并发闸 `ASR_CONCURRENCY`(默认 2)；`--initial_prompt` 强制简体输出。
> ③ **多人会议真缺陷两处**：原来全体共用 `asr-<房间>/seg-%04d.wav`（**互相覆盖**）→
>   改**按 memberId 分目录**；原来会读"正在写的半截文件"（丢句尾）→
>   **跳过最新那段 + 两次采样稳定 + 收尾补转最后一段**。
> ④ **ASR 字幕补喂 AI 看板**：抽 `ingestCaptions(room, entries)`（HTTP 归档与 ASR 共用），
>   否则只用服务端转写的会里 AI 看板永远是空的。
> ⑤ **前端契约反转**：`asrEnabled` 时 `toggleCaptions` **直接进服务端模式，绝不启动浏览器识别器**；
>   配置改**记忆化 promise + 条件 await**（点击零延迟，修掉"依据未就位"）；
>   服务端模式**自动邀请 AI**（音频管线=它的耳朵）；**看门狗加模式闸门**（否则每 30s 偷拉 Web Speech）；
>   `asr-caption` 进本地历史但**不回传**（防重复入库）；AI 说话而语音没开时一次性提示开「AI 语音」。
>   测试/排障入口：`window.__SFU_ASR__ = true/false` 强制字幕路径。
> ⑥ **AI 多轮对话**：唤醒词容错（小明/小鸣/小名/小铭）+ **追问窗口**
>   `config.aiChatWindowSec`（默认 20s，窗口内免唤醒继续聊，问句带说话人昵称）。
> ⑦ **顺手修陷阱**：`config.example.json` 带 `//` 注释却被严格 `JSON.parse` 读
>   → 复制即静默失效；新增 **`sfu/jsonc.js`**（注释剥离 + 尾逗号容错），server 与 doctor 共用。
> ⑧ **回归（本次实测）**：新增 `npm run test:asr` **15/15**（探测/系统 TTS 真语音转写/唤醒与
>   追问窗口/在线 asrEnabled/模板可解析）；信令 **154/154**；冒烟 **168/168**（+9 服务端字幕断言；
>   浏览器路径用 `window.__SFU_ASR__` 覆盖后仍全绿）；`doctor` whisper 项变 ✅（16 通过/2 警告/0 失败）。
> ⑨ ⚠️ **待人工浏览器验证**：两窗互看 → 点「字幕」显示"🖥️ 服务器转写（whisper）"且**不再报浏览器识别错** →
>   说"小明，明天下午三点开会" → 5~10s 出字幕 + AI 回话（开「AI 语音」可听见）→
>   紧接着**不喊名字**说"那后天呢"应被当追问继续答（多轮窗口生效）。

> **★ 09-29 G6-② 房间权限分级（owner/admin/member/guest 四级）+ ASR 听觉管线持续分段化**——
> ① **四级角色**：`roleOf(socket, room)`（owner=建房者 > admin=平台管理员 > member=登录用户 >
>   guest=游客；owner 判定**优先于登录态**——没登录的建房者也是 owner）；
>   `broadcastRoomState` 显式投影加 `role` 字段（与 avatar 同一批，房间令牌照旧进不了投影）；
>   `bindIdentity` 加第 4 参 role，register/login/verify 三处调用点带上——socket 级身份随登录态走。
> ② **权限点（最小集）**：kick-member = owner/admin（其余 `kick-denied`，reason 'not-owner'）；
>   record-start = member 及以上（**游客不能录**——审计需要身份，fail fast 在业务校验之前）；
>   说话/字幕/白板等"会议发言权"不做分级（全员平等是产品语义，不是遗漏）。
> ③ **前端**：成员行新增 admin 盾形徽标（ICONS.shield，owner 有 crown 不重复挂）；
>   踢人按钮入口从"仅房主"放开到"房主或 admin"（服务器仍是权威校验，前端只是入口）。
> ④ **实修两处测试坑**：G8 块的 `adm` 是块级变量且 socket 早已 close——G6 断言引用它必然
>   ReferenceError；改用**新客户端 + `auth-verify`**（verify 会 bindIdentity 带回 role）恢复
>   socket 级管理员身份。`request()` 返回 `{data}` 包装——`create-room` 的房间号要取
>   `resp.data.roomNumber`（直取顶层是 undefined，join 进"undefined 房"就挂死）。
> ⑤ **回归（本次实测）**：信令 **160/160**（+6：owner/guest/member role 投影、四级各就各位、
>   admin 非房主可踢、游客 record-start 被拒）+ 冒烟 **168/168** + **test:asr 15/15**（带真服务器）。
> ⑥ **ASR 听觉管线持续分段化（本次早些时候）**：whisper 分支从"录 15s→转写→再录"（串行，
>   **转写期间语音全丢**——用户"识别不灵敏"的根因之一）改为**单 ffmpeg 持续 `-f segment` 8s 分段
>   + 轮询"写稳"段转写**（大小两次采样一致才转）；录与转并行，不再丢音频；
>   管线启动即注册 aiAudioPipes（修 TDZ：`pipe.alive` 写在 `const pipe` 声明前 = "pipe before
>   initialization" 崩溃，AI 听不见的直接根因）。
> ⑦ **★ 常驻转写 worker（"不灵敏"的最大单一解）**：CLI 每转一段都要重启 Python + 重载模型
>   （固定 2~4s+，10~14s 的段耗时里大半是这个）→ 新增 `sfu/ai/asr_worker.py`（stdin/stdout
>   JSONL 协议，模型只加载一次）+ `asr.js` 的 `createResidentTranscriber()`（分段循环优先走
>   worker，连崩 3 次自动回退 CLI，`ASR_WORKER=0` 强制关）；**spawn 安全形态**（Mimosa 复核）：
>   可执行与参数全字面量（python/python3 二选一 + 写死脚本名），模型名走环境变量不进 argv；
>   优雅退出补 kill（不关会留 python 进程占内存）。**实测**：同样 4s 语音，CLI 每段 10~14s →
>   worker 第 1 次 13.4s（含加载）**第 2 次起 0.8~3.0s**；准确率实测 small 全对
>   （"产品评审会"，tiny 转成"平省会"）→ **asrModel 默认 tiny→small**（config.example 同步）。
> ⑧ **回归（本次实测）**：信令 **160/160**（+6：owner/guest/member role 投影、四级各就各位、
>   admin 非房主可踢、游客 record-start 被拒）+ 冒烟 **168/168** + **test:asr 19/19**
>   （+4：worker 启动转写/唤醒词/二次转写提速/kill 干净退场）。
> ⑧b **★ 语音闭环端到端自测 `npm run test:asr-live`（TEST_ASR=1）**：照 TEST_RECORD 思路，
>   TTS 合成带唤醒词的中文 → ffmpeg 以 opus RTP 推进收流 PlainTransport → **真实听觉管线**
>   （startAiAudioPipe 同一段代码）→ 常驻 worker 转写 → 断言字幕账本出现 asr:true 且含语义
>   关键词的条目。**首跑 PASS：转写「小明，帮我记一下明天下午三点的评审会。」逐字全对**
>   （small 模型；首段 16.3s 含 worker 加载模型，后续段 3s 档）。房间级 ASR 管线从此有
>   自动化回归——改管线代码不再只能靠真人开麦验证。
> ⑧c **★ G6-③ 生产化 Next：密码强度 + 登录失败锁定**（路线图 0.3 第 5 条的第 2、3 缺口补掉）：
>   注册密码 ≥ passwordMinLen（默认 8，env `AUTH_PASSWORD_MINLEN`/config 可调）且**至少两类字符**
>   （字母/数字/符号——纯数字 8 位也会被拒）；只管**新注册**（老用户登录不受影响）；同一账号
>   **连错 5 次锁定** AUTH_LOCK_MS（默认 15 分钟，可调），锁定期内**正确密码也拒**
>   （防"5 错+1 对"撞库），成功即清零；**只对存在的账号计数**（对空气计数 = 锁人 DoS，
>   也不泄露"该用户名已锁定"的存在性）。测试侧为不动历史密码，测试服务器用
>   `AUTH_PASSWORD_MINLEN=6 + AUTH_LOCK_MS=2000` 让两条路径都可实测。
> ⑨ **回归（本次实测）**：信令 **165/165**（+11：角色 6 条 + 强度 3 条 + 锁定 2 条）+
>   冒烟 **168/168** + **test:asr 19/19** + **test:asr-live PASS** + **test:shutdown 9/9**
>   （含 asrWorker.kill 清理）+ **test:store 49/49**。
> ⑩ ⚠️ 待人工验证：admin 盾徽标/踢人、游客录制提示；真人开麦观感（合成语音已验完整链路）；
>   弱密码注册被拒与"连错 5 次锁定"的真实提示文案。

> **09-30 三连修复（用户反馈"AI 抢话 / 还在用浏览器识别 / 启动网址不对"）**——
> ① **AI 抢话**：AI 回答默认用浏览器 TTS 朗读，用户说完唤醒词还在继续说 → AI 声音压上来。
>   修成三层"让话"礼仪：**即时闸**（会议中 AnalyserNode 盯本地麦克风能量，峰值连续 8 帧
>   ≈130ms 超阈 = 正在说话 → 立即 `speechSynthesis.cancel()`，比等 5s 字幕段快两个数量级；
>   仅 AI 语音开着时运行、AI 没在说时空转、静音采样天然不误触发、replaceTrack 循环内重绑）
>   + **字幕闸**（asr-caption 到达即 hush，排除 AI 自己的 TTS 回声）+ **迟到不读**
>   （回答送达时用户 2.5s 内刚说过话 → 这轮不念，文字照常进气泡）。
> ② **"还在用浏览器识别"加固**：客户端 toggleCaptions 原是"配置未到才 await"（留了时序竞态）
>   → 改**无条件 await**（记忆化后只是微任务）；配置**拉取失败不再缓存失败结果**
>   （原来一次网络抖动 = 永远落进浏览器模式）→ 下次点击重拉。另注：**Mesh 版（3000）没有
>   服务器 ASR**，开到 3000 端口看到 Web Speech 是版本不对，不是 bug。
> ③ **启动网址**：监听 0.0.0.0 时把 `https://0.0.0.0:3443` 打给用户——0.0.0.0 是监听语义
>   不是访问语义，没法点（"不是本来的网址"根因）。改为一律打 `http://localhost:3001` +
>   🔒 `https://localhost:3443`，另起一行 🌐 局域网地址给真实 IP（announcedIp 自动纠偏后）。
> ④ **★ scrypt 参数升档 + 平滑重哈希（路线图 0.3 第 5 条收官）**：password.js 引入**代际**——
>   V1=scrypt(pw,salt,32)（Node 默认参数，存量账号全是它）、V2=scrypt(pw,salt,64,{N:32768,
>   maxmem:64MB})（密钥翻倍 + 成本翻倍，新哈希一律用它；**maxmem 必须显式放大**，否则正好
>   压线 Node 默认 32MB 抛 "memory limit exceeded"，本机复现）；代数判别 = 按 hex 长度
>   （64/128 字符），verifyPassword **按存量哈希自动选参数**，新老并存互不干扰；
>   **服务器登录成功后自动重哈希**（换新盐 + V2 重算写回——明文只在"刚输对"的一瞬存在，
>   错过就没有合法升级窗口），用户无感，真实库里的存量老账号下次登录即升级。
>   **顺带修掉 store.js 一个生产级缺陷**：closeDb() finalize 了预编译语句后再调用会抛
>   "statement has been finalized"（测试真实踩中）——重构为 **openDb() 惰性打开 + 可重开**，
>   "关了再用"从崩溃变成自然恢复，require 即建库语义不变。
>   **回归（本次实测）**：信令 **187/187**（+2 平滑重哈希：预置 V1 老账号登录 → 库里哈希变
>   128 字符且换盐）+ test:store **55/55**（+6 V2/代数判别/升级写回）+ 冒烟 168/168 +
>   test:shutdown **9/9**（closeDb 可重开重构后复验）。

> **★ 09-30c 服务端神经语音（Edge TTS 协议，零 npm 依赖，AI 语音去"AI 味"的主攻）**——
> 用户长期抱怨"AI 助理声音难听/AI 味"：浏览器 speechSynthesis 读的是**用户机器上装了什么音色**，
> 多数 Windows 只有老式 SAPI 音色（Huihui 一族）——本机音色天花板决定了播报质量。
> ① **新文件 `sfu/ai/tts.js`**：微软 Edge 神经语音（晓晓/云希一族，当前免费且最自然的中文音色）
>   的 WebSocket 协议纯手写实现——Sec-MS-GEC 防滥用令牌（Windows 纪元 tick 按 300s 取整 +
>   SHA256 大写）、speech.config + ssml 两段文本帧、二进制帧 2 字节大端头长 + MP3 分片、
>   Path:turn.end 收尾；**Node 内置 crypto + WebSocket 即实现，零新 npm 依赖**。
>   附 LRU 结果缓存（同一句不重复合成）+ 并发闸（TTS_CONCURRENCY=2）+ 超长文本按句切分。
> ② **双轨纪律落地**：本机经加速器实测**四变体全 403**（bing/msedgeservices 端点 × 带/无 GEC
>   ——端点可达性随网络出口而定，外部不可控）→ **启动探测**（合成"你好" 6s，10 分钟 TTL 重探）
>   通过才在 /config.json 下发 `aiTtsEnabled:true`；不可达 → 前端自动回落浏览器 speechSynthesis，
>   **功能永不降级，状态永远可见**（启动日志明说走哪条路）。AI_TTS=0 强制关。
> ③ **管线**：AI 回答（语音问答 asrWakeAndAnswer + @ai 问答两处挂点）→ 合成 MP3 → 内存货架
>   `putAudio`（128 位随机 id，30 条上限 + 30 分钟清扫）→ 广播 `ai-audio {url,ts}` → 前端
>   `<audio>` 播放；HTTP `GET /ai-tts/:id.mp3`（id 白名单闸，非法格式直接 404）。
> ④ **客户端契约**：`aiTtsEnabled=true` 时浏览器 TTS **整体让位**（防同一条答案两个声音），
>   只听 ai-audio；**抢话 hush 同样管辖服务端 MP3**（用户开口 → pause）。false 时行为与
>   之前完全一致（浏览器 TTS）。
> ⑤ **回归（本次实测）**：`npm run test:tts` **10/10**（+1 SKIP：真合成轨随网络出口，双轨约定）+
>   信令 **187/187** + 冒烟 **189/189** + test:asr **18 通过/1 跳过**；服务器启动探测日志、
>   /config.json 下发、非法 id 404 全部实测验证。
> ⑥ **TEST_ASR 升级为全闭环自测（耳朵→脑子→嘴）**：自测服务器自己连一个真实 socket.io 客户端
>   进房（join-room），断言唤醒句触发 asrWakeAndAnswer → aiBrain → **全房 chat-message(from=ai-bot)
>   真有应答**——首跑就把"嘴"也闭环了：AI 把「帮我记一下…」识别为纪要意图 → 真生成
>   `/minutes/999999/…-segment.md`（LLM 撰写）→ 回答带路径，"听→懂→做→说"四层全通。
>   **调试路上连环抓到三个 fixture 缺字段崩溃**（房间号必须 6 位数字 / 成员缺 `talk` Map =
>   aiBrain 静默崩 / 缺 `producers·dataProducers·consumers` Map = joinRoom 与 net-level 定时器崩）
>   + **修掉 asrWakeAndAnswer 的静默吞错 catch**（失败现在有 logEvent + 控制台日志，不再无头案）。
>   房间号 '999999'，诊断用 TEST_ASR_DEBUG=1。回归：test:asr-live **PASS（全闭环）** + 信令 **187/187**。

> **★ 09-30d 二次取长补短 + 语音体验工程化（用户点名"语音体验还是很差 / 继续学 billd-desk"）**——
> ① **语音最大感知项：唤醒应答流式化**。原实现等 aiBrain 完整返回才广播——说完话到看到
>   回答首字 ≈ 5s(段)+3s(转写)+2~4s(LLM 全文)≈ 10s+ 全程干等。现在 asrWakeAndAnswer 与
>   @ai 问答**同构走 ai-stream**（LLM 每 12 字吐一次，首字延迟 ≈ 5s+3s+0.5s，感知减半；
>   终态 chat-message 照发，双路哲学不变）；ai-state 的 thinking 阶段（检索中/换说法/整理）
>   同步透传。**分段默认 5s→4s**（asr.js + config.example 同步），说完平均再早 ~1s 出字幕。
> ② **远程控制三件（借鉴 billd-desk 控制台）**：
>   · **会话时长显示**——首帧起计，rdState 行带 "· mm:ss"（每帧刷新顺带更新，零定时器）；
>   · **全屏按钮 rdFull**——全屏 rdConsole 本体，切换后 rdFit 重适配；
>   · **剪贴板双向**——📋 推（读本机剪贴板 → clipboard-sync ctl2host → agent 写进对方
>     **网页**剪贴板）/ 📥 拉（remote-input {kind:'clipboard-read'} 老通道新语义 → agent 读
>     网页剪贴板 → clipboard-sync host2ctl 回来 → 复用既有 host2ctl 监听写本地）。
>     **诚实边界**：CDP 够不着 OS 系统剪贴板，覆盖的是浏览器工作区主场景（复制网页资料/
>     粘贴到网页输入框）；cdp.js 连接时 Browser.grantPermissions 预授权 clipboardReadWrite。
> ③ **TTS 端点复测仍 403**（加速器出口，外部不可控）——回落浏览器 TTS，神经语音等
>   网络出口变化后自动激活（探测 + 10min 重探在跑）。
> ④ **回归（本次实测）**：test:agent **24/24**（真 Chromium，applyInput/cdp 改动后复验）+
>   冒烟 **189/189** + 信令 **187/187**；服务器已重启。

> **★ 09-30e 全链路延迟极限化（用户点名"各方面延迟降到极限"）**——
> ① **★ ASR worker 开机预热**：worker 模型加载 ~13s，原来服务器启动后的**第一句**语音
>   要白等这 13s（"第一次识别特别慢"的元凶）。现在启动时后台合成 0.3s **静音 wav**
>   （纯内存拼 44 字节头，零 ffmpeg 依赖）喂 worker 走完"加载→推理→返回"全链路——
>   语音在线后第一句即 0.8~3s 档。**实修一坑**：预热最初在启动回调里查 WHISPER，
>   而探测是异步的 → 静默空跑（日志都不出）；改为"先等探测收敛再判断"。
> ② **写稳采样 250→150ms**：段边界判定更快（轮询"段文件大小两次一致"的间隔收紧）。
> ③ **AI 语音应答入字幕账本**（name='AI 小明'）：纪要/RAG 检索从此包含"AI 自己说过什么"
>   ——追问"你刚才说了什么"能检索到；只入账本不上字幕条（AI 的话在聊天气泡已有）。
> ④ **延迟盘点（实测）**：说完→字幕 ≈ 4s 段(均 2s)+0.15s 写稳+1~3s 转写；字幕→AI 首字
>   ≈0.5s（流式已上屏）；唤醒→应答动作（纪要/操作）同步走。远程控制帧间隔已闭环自适应
>   （2~24fps 硬钳），控制端只留最新帧渲染——链路各环节已到"教学版架构"的下限。
> ⑤ **回归（本次实测）**：test:asr-live **PASS**（转写逐字全对 + AI 纪要动作应答）+
>   信令 **187/187** + 冒烟 **189/189**；服务器已重启且预热日志 🔥 确认。
> ⑥ **★ E3-media 落地（路线图 0.4 P1，`npm run test:e2e-media` 首跑 5/5 全 PASS）**：
>   **两个真实 Chromium**（假摄像头/假授权 UI，专用端口 3016 防假绿）双页游客进同一房——
>   A 建房拿号 → B 凭号加入 → 双方成员数=2 → **双侧出现 videoWidth>0 的在流画面**
>   （produce/consume/resume/订阅绑定任何一环断了它都是 0，最硬的端到端证据）→ 双侧截图存档。
>   **"会议本体"从此有自动化回归**——音视频核心链路改坏会被一条命令抓到，不再依赖人工双窗。
>
> **★ 2026-10-01b Qwen3-ASR 第二引擎 + Piik 取长（用户点名"学 Piik + 试试 Qwen3-ASR，先备份"）**——
> ① **备份先行**：改造前的 whisper 实现（`sfu/ai/asr.js` + `asr_worker.py`）完整复制到
>   `backup/asr-whisper-20261001/`（git 历史为权威备份，此目录为"看得见的回滚点"）。
> ② **ASR 引擎可插拔（`sfu/ai/asr_qwen.js`）**：QwenLM/Qwen3-ASR（阿里开源 SOTA，52 语言/
>   方言）经 **DashScope qwen3-asr-flash** 兼容口接入——`config.asrEngine`=auto（默认）/
>   whisper/qwen；auto = 配了 `DASHSCOPE_API_KEY`（env 或 .env，与 provider 同链）且探测通过
>   就优先 Qwen，单段失败自动回落 whisper 常驻 worker（功能永不降级）；`/metrics` 加
>   `sfu_ai_asr_engine_qwen` gauge。**SSRF 白名单**：仅 https + DashScope 官方双域，
>   伪造内网端点直接抛错（test:qwen 有断言）。诚实边界：本地 vLLM/transformers 路线
>   需 GPU/较重 torch 栈，笔记本 CPU 上会慢于常驻 whisper——所以云端口是默认形态。
> ③ **`npm run test:qwen` 双轨**：Mock 轨 5/5 全过（无 key 空串约定 / 端点白名单 / probe=false）；
>   真测轨（key 就位才跑）探测+TTS 真转写。**激活方式**：`.env` 加 `DASHSCOPE_API_KEY=sk-xxx`
>   重启即用，whisper 照常兜底。
> ④ **Piik 取长两件**：① **共享带音频**——getDisplayMedia 开 `audio:true`，勾选标签页音频时
>   作为第二路 audio producer（source 'screen-audio'）推上会，停止共享随循环关闭；
>   ② **画中画按钮**（控制坞 🖼 pipBtn，借鉴 Piik"灵活观看"）——把 tile-main/共享大画面
>   requestPictureInPicture 浮窗化，零依赖。**实修坑**：pipBtn 误写成裸名（client 惯例是
>   `const x = $('x')`）→ 冒烟桩顶层 ReferenceError 连环挂 13 项——改回 $() 模式即全绿。
> ⑤ **回归（本次实测）**：test:qwen **5/5**（+1 真测轨 SKIP）+ 冒烟 **189/189** +
>   信令 **187/187**；服务器已重启。
>
> **★ 2026-10-01c Qwen3 本地双引擎全通（用户点名"一直跑到都实现"）**——
> ① **装包**：`pip install qwen-asr qwen-tts`（transformers 后端；两个 pip 并发跑会撞
>   Windows 文件锁——串行装）。SoX 警告**非致命**（qwen_tts 打印但生成照常工作）。
> ② **模型落位**：modelscope 下载 0.6B 档到 `models/qwen3-asr-0.6b`（1.8G）与
>   `models/qwen3-tts-0.6b`（2.4G）——服务器启动时发现本地目录就自动把引擎指过去
>   （免 HF 运行时下载）；磁盘剩 7G 用 0.6B 档正合适。
> ③ **两个常驻 worker**（`sfu/ai/qwen_asr_worker.py` / `qwen_tts_worker.py`，
>   与 whisper worker 同款 JSONL 协议；Node 侧 `asr_qwen_local.js` / `tts_qwen.js`，
>   spawn 全字面量安全形态）：**模型只加载一次**。
> ④ **实测（本机 CPU）**：ASR 本地转写「小明，明天下午三点开评审会。」**逐字全对还带标点**
>   （首段含加载 ~50s，纯转写 **1.9s** —— 与 whisper small worker 同档）；TTS 本地合成
>   第二句 **9.1s**（CPU 自回归生成，真实自持音色）。
> ⑤ **引擎链（带防卡死门控）**：ASR = qwen-local 只用"已就绪"的 worker（未就绪期间
>   whisper 兜底，开机 warm() 后台加载不卡字幕）；TTS = Qwen 本地（已预热才用）→ Edge
>   （探测）→ 浏览器 TTS。**config.json 已切 asrEngine=qwen-local**（用户点名切换；
>   whisper 全程自动兜底）。音频货架支持 wav/mp3 双类型（前端 <audio> 无感）。
> ⑥ **回归（本次实测）**：test:qwen **10/10**（+1 SKIP：ASR/TTS 本地双轨 + 端点白名单 +
>   第2次加速断言）+ **test:asr-live PASS**（新引擎链下全闭环）+ 信令 **187/187**。
>
> **★ 09-30f 观测扩展 + 模型评测（路线图 0.4 P4/P2，2026-10-01）**——
> ① **watch.js 语音链路告警（P4）**：消费 /metrics 新双 gauge——`sfu_ai_asr_worker_enabled=0`
>   连续 2 轮（`WATCH_ASR_WORKER_MISS` 可调）→ 告警"已退回 CLI，字幕慢 3~5 倍"；
>   `sfu_ai_tts_enabled` 翻转（true↔false）→ 即时提醒（端点可达性随出口网络漂移）。
>   长跑值守时"耳朵或嘴悄悄坏了"会自动喊人，不再无头案。
> ② **ASR 模型选型评测（P2-②，`npm run bench:asr`）**：常驻 worker 真实生产路径下
>   三档实测（3 句 TTS 中文，命中=关键词）：tiny 首段 12.1s/后续 **0.7s**/命中 6/9；
>   base 12.8s/1.1s/6/9；small 17.1s/3.1s/6/9。**结论：small 保持默认**（此前实测
>   "产品评审会"tiny 转成"平省会"而 small 全对——真词准确率差异本批 TTS 样本未复现，
>   以下限参考）；tiny 是低配机/省内存备选。诚实边界：TTS 合成≠真人嗓音，命中数是下限。
> ③ 路线图 `后续升级方向.md` 已全面刷新（0.1 六行回填 + 基线 + **0.4 满功率下一批**，
>   P1 e2e-media 标 ✅；P2-②③/P3/P4 执行后回填 ✅）。
> ④ **回归**：watch/bench 均为新增独立脚本，既有套件不受影响；`npm run bench:asr` 实测通过。
>
> **★ 09-30g 静音驱动早转写（P2-③，"各方面延迟降到极限"的最后一刀）+ 论文提纲（P3）**——
> ① **早转写**：段 ffmpeg 加 `-af astats(ametadata print)` 每 0.5s 从 stdout 吐 RMS——
>   说话（RMS>-38dB）→ 静音 1.2s → **快照转写"正在写的段"**（copyFileSync 快照是合法截断，
>   whisper 内部 ffmpeg 能解；doneSet 先占位防双跑；handleSegment 删的是副本、原文件继续写，
>   封口后由轮询清扫）。说完平均再省 **~2s**。三道防坑：`seg-` 前缀过滤（防 `f-` 副本被
>   轮询/收尾误捡=重复转写）、Windows 原文件占用删不掉下轮再试、`ASR_FLUSH=0` 逃生舱。
>   尾巴丢失窗口 ≤ 当前窗剩余且仅在"刚说完话"触发——已写进注释。
> ② **论文提纲初稿起草（P3，`论文提纲-初稿.md`）**：7 章 + 附录，每节标注素材来源与
>   实测数据（对比实验=Mesh vs SFU 双版本、性能数字=bench 系列实测、安全=代际哈希与
>   门禁边界、创新区=第 4 章 AI 助理），详略待导师意见。
> ③ **回归（本次实测）**：`test:asr-live` **PASS**（早转写路径全闭环）+ 信令 **187/187**。
>
> **★ 09-30b 取长补短：借鉴 billd-desk 落地「设备码直连」+「真桌面画质档」（远程控制主线，仅 SFU 主版本）**——
> 用户给出 `github.com/galaxy-s10/billd-desk` 要求"学其可取之处完善本项目，尤其远程控制"。
> 先读实其交互模型（**稳定设备码 + 连接口令 + 无人值守安全口令 + 常用设备 + 画质档**），
> 再按本项目的**零依赖红线**取舍：**采纳交互与安全模型，不采纳全 OS 控制与 H.264/265 硬编码**
> （那需要原生客户端/编码器），也不做设备持久化（本轮明确押后）。
> ① **设备码配对直连**（`desk-register`/`desk-connect`/`desk-granted`/`desk-pending`）：
>   **核心决策 = 设备码就是一个私有 `isDesk` 房间的房号**——于是 `remote-frame` 三道闸
>   （身份/授权在册对/体量）、16 字节帧编解码、canvas 控制台、手机 Pointer Events
>   **一行都没改**就全部复用；控制端走 `deskEnterRoom()` **轻量进房**（只登记门禁，
>   不建媒体不广播成员）。两条授权路径（安全口令=无人值守直接登记 `remoteCtl`；
>   连接口令=代理终端按 y 走 `remote-answer`）**都发同一条 `desk-granted`**，前端只听一个事件。
>   代理离线**即刻毁房**（不留 60s 宽限：没人认领的设备码留着只会占号）。
> ② **画质档 + 弱网自适应**：控制端 `.rd-bar` 四颗（自动/流畅/标准/高清）走
>   `remote-input` 的 `{kind:'quality'}`——**老通道新语义**（复用门禁与限流，不新造事件）；
>   代理 `applyQuality` → `cdp.setScreencast()` 重开抓屏（`_scListenerBound` 防监听器叠加）。
>   **★ 本轮最大的设计教训（坑 62）**：闭环自适应（`remote-quality`）先存在，画质档后加，
>   两者**都写同一个 `agent._frameGap`** → 流畅档设 5fps、自适应立刻顶回硬下限 6fps，
>   表现为"点了流畅但帧率没真降"且毫无报错。改成**三层分工**：档位只定中枢 `rdTargetFps`
>   （切档时清空采样数组，否则拿旧节奏判断新链路会立刻误降）→ 自适应只在中枢 ±2 微调
>   → 代理/服务器对任何请求**硬钳 2~24**（策略线与安全线**有意分开**）。档位 fps 下限
>   必须等于 `RD_FPS_MIN`（两处 5→6 同改，否则两来源取值区间不重叠）。
> **回归（2026-09-30 实测，本次全绿）**：`test:sfu` **184/184**（+19 设备码全链路：格式/在线/
>   错口令/busy 互斥/无人值守直授权/待确认→y 后开控制台/口令错不发 granted/**房间码在桌面房内
>   照旧受三道闸**/释放后帧流停/代理离线毁房）+ `test:smoke` **189/189**（+11：设备码入口
>   与 Overlay、桌面路径不复用会议内 remote-request 逻辑、切档发 `{kind:'quality'}`、
>   自适应只在策略区间内取值、自动档开关、未知档名降级）+ `test:agent` **24/24**（真 Chromium：
>   切档同时改到帧率**和**编码参数、切档后仍持续推帧、无重复 ack、未知档不致命）+
>   `test:e2e` **15/15**（真双窗 + 手机视口，页面自证 `client.js` 是当前版本指纹）。
>   实修三处**我自己的测试缺陷**（都不是代码错）：坑 **61**（服务器先 emit 后回 ack，
>   await 一 resolve 就断言读到 null，要等一拍 + 监听器先注册）、坑 **63**（用 `document.title`
>   当"画面变化"触发器——不动像素，screencast 就是不出帧，症状与"链路断了"一模一样）、
>   冒烟里 `payload.event` 内层没有 `to`（要查整条 payload，坑 51 家族）。
> ⚠️ **待人工浏览器验证**（命令行验不了，见交付清单）：设备码直连入口真机手感、
>   无人值守/需确认两条路径、画质档切换的观感差、弱网下自动降档是否真的降；
>   **诚实边界**：设备码只存内存（**代理重启即换码**）、口令内存明文比较（教学级，
>   HTTPS 自签为传输层兜底）、CDP 只控 Chromium 窗口内部。

> **★ 2026-10-05 夜跑（"跑到上午十点"：用户点名七件事逐一落地 + 真跑取证）**——
> 用户原话七问：①AI 语音识别要真正能用、不要一段时间就停 ②TTS 没用上（"用的还是浏览器的"）
> ③AI 助理动态效果没有变化 ④跨网连接 ⑤AI 操控实体类不行 ⑥共享画面比例不协调、要丝滑
> ⑦登录页滑动光线要自然。**全部真跑取证，没有"应该没问题"式结论**：
> ① **ASR 长跑不停（本轮最核心）**——"一段时间就停/碎句/丢尾"的三个真根因（全部探针实测）：
>   ▸ ffmpeg 默认写缓冲让**任何**段输出在进程存活期间整段滞留（wav in-flight statSync 恒 0 字节——
>     "静音抢跑快照"从 09-30f 上线起**从未真正生效过**，坑 76 死机制活体标本）；
>   ▸ `ametadata` 的 stdout 管道有 32KB 块缓冲（实测 259 行 RMS 全在进程退出那一刻才到齐 →
>     `lastVoiceTs` 失真 → 定稿 latMs 恒 0 + 真说话时反而判"静音已确认"→ 每个 2s 段被迫切句）；
>   ▸ 抢跑快照半截文本与封口全量**无条件拼接**（chop 丢尾字/重复字的老病）。
>   修法三件（一份约定三个落点，改动处均有教学注释）：分段输出 wav→**raw s16le(.pcm)** +
>   `-segment_format_options flush_packets=1`（实测 in-flight 段每 0.5s 涨 ~16KB 渐进落盘）+
>   `ametadata … file=-:direct=1`（首行 0.11s 就位，是这条管线的**生命线**）+
>   **delta 尾段快照**（抢跑重写：只转新增 delta、原段不标 doneSet、封口后全长转写兜底——
>   "宁慢勿丢"）。实测证据：soak **6/6 轮** · 自愈 7~8 次后仍在转写 · **0 次永久放弃** ·
>   定稿延迟 **1.2~1.8s**；日志首现 `抢跑触发：tail-seg-0009-1.wav（delta=40960B）`
>   （这条日志**此前从未出现过**）；`test:asr` **56/56**；启动日志如实报"每 2s 一段写入字幕账本"。
> ② **服务端 TTS 真上线**——Edge TTS WebSocket 403 的根因 = 握手缺 **ConnectionId + muid**
>   两个字段（对照官方 edge-tts 7.2.7 抓包补齐）；修后实测合成 **19152B MP3 / 1391ms**；
>   启动日志首现 `🔊 服务端神经语音可用（Edge TTS·晓晓）`；闭环实测
>   `@ai → chat-message(tts:'server') → ai-audio → GET` 拿到 **56736B** 合法 MP3。
>   （协议本身零依赖：Node 内置 crypto + WebSocket 手写 Sec-MS-GEC，见 sfu/ai/tts.js。）
> ③ **AI 助理动态**——check:avatar 修后 **22/22**：呼吸起伏量到 0.0140（scale 1.0000→1.0140）、
>   手势变化性 `g-peek-r → g-peek-l`、非单位矩阵实采样（见文末 check:avatar 修复段）。
> ④ **跨网连接**——announcedIp **运行时自愈**：config.json 里的 IP 只要不是本机任何网卡的真实地址，
>   本次运行就自动改用探测到的本机 IP 并在启动日志说实话（`sfu/server.js:2028 🩹 announcedIp 已自动纠偏`）。
>   ▸ **更正本文件的一处过度声明**（11:12 自查）：原先写"自愈并**回写 config.json**"是**不实的**——
>   运行时**不写**用户的配置文件（`sfu/server.js:494` 早立过原则：`sfu/config.json` 是**用户的**配置，
>   工具/测试不该去改它），持久生效请走 `npm run start:lan`（合并式生成、保留手工字段、自带备份）。
>   ▸ 自愈的必要性当场又验了一次：夜跑之后 DHCP **再次漂移**——config 里写着 `192.168.179.194`，
>   本机 WLAN 现为 `192.168.221.194` ⇒ 正是这条自愈在兜住"别的电脑黑屏"（坑 36 的沉默故障原样复发）。
>   `doctor` **23 通过 / 0 失败**；`test:turn` TURN **3/3 可达**；
>   Tailscale 未装但引导就绪（start:lan 输出三步提示 + 部署手册 B-1 方案）；
>   **已知边界**：防火墙入站放行需管理员权限（命令已给用户）。
> ⑤ **AI 操控实体**——chop 丢尾字修复后完整句触达：`room-control → 打开实时白板` 端到端到两个客户端；
>   唤醒词同音容错两处修复（明/鸣/名/铭）；rcT5-10 断言补齐（事件真的到了，而非"回复措辞像做了"）。
> ⑥ **共享比例**——`style.css:416 object-fit: cover → contain`：演讲者视图大画面实测
>   890×234 = **3.8:1 横向拉伸**（"比例不协调"的真身）→ 修后 416×234 · **ar=1.778**（16:9 归位）；
>   `check:screenshare` **8/8 → 10/0**（新增两条比例断言钉住）。
> ⑦ **光轨自然化**——真相不是"效果没做"，是**光轨被盖住了**：它挂在 `#prejoin`（z100，登录前预览层），
>   而登录卡 `.auth-overlay`（z110）是实底 → 用户永远看不到登录页有光轨。修 = 登录卡补**第二条光轨** +
>   启停总闸三态（进/退/重进不叠）；`check:glow` **21/21**；鎏金像素实测 `rgba=[188,150,89,144]`
>   （在动，不是死静态图）。
>
> **★ check:avatar 假红根治（修量具，不是放水断言）**——check:all 下唯一 1 红
> （"窗口 0.1s · tf 例 undefined"）：① `waitFor` 检出点在**动作第一拍**，而所有一次性手势
> 关键帧以 `0% { transform: 单位矩阵 }` 起步（style.css：峰值在 25%~45%），单样本恒为单位矩阵
> → "真的在动"被判成"加了类但没动"；② 示例值兜底索引越界取到 undefined（旧写法
> `gWin[Math.ceil(len/2)]`）。修 = 检出后 `sleep(500)` 演进到中段再取窗（500ms 小于最短动作
> g-nod 1.05s，不会等到动作消失）+ 索引 clamp。复跑 **22/22** 全绿，证据比修前硬得多：
> `g-peek-r · 窗口 0.6s · 7 样本 · tf 例 matrix(1, 0.0007, …, 0.0389, …)`（非单位矩阵真实采样）。
> **全量 check:all 重跑终态（2026-10-05 06:30）：15/15 条检查通过（共 204 项界面断言）**——
> 其中 check:avatar 22、check:dock 34、check:pill 23、check:glow 21、check:visual 15、
> check:think 12、check:icons 12、check:toggle 11、check:login 11、check:screenshare 10、
> check:board 9、check:keyboard 8、check:layers 7、check:console 5、check:a11y 4。
>
> **★ 夜跑改动全量回归补齐（2026-10-05 06:40~，顺序跑）**——`test:smoke` **388 通过/0 失败**
> （含“15 条界面检查都有版本指纹”收尾断言）；`test:sfu`(3011) **219 通过/0 失败**；
> `test:asr-live`(3017) **PASS**——定稿 1 条·说完→上字幕 **1.6s**、正解命中 1 条（证音频真进系统）、
> 静音期零字幕、重复句零刷屏（ASR 1 条/应答 2 次）、**自愈重启实测**（ffmpeg 静音退场 code=0
> → 1000ms 后自愈重启）、转写并发在途峰值 2=上限 2（跳过 38 轮）；Mesh `npm test`(3000) **36 通过/0 失败**；
> `test:agent`(3012) **24/24**（cdp.navigate 修复后复验，见下块）。`test:e2e-asr` 见下面两块。
>
> **★ e2e-asr"页面主线程停摆"诊断（坑 84~87）**——run-12 终态 19 项检查 7 红，全部集中在
> ⑩b~⑪（B 侧字幕/气泡/白板/ink=-1/截图），而核心链路（出字 ✅ / 定稿 1.5·1.9s ✅ / AI 应答 ✅ /
> 正解命中 ✅）全过、服务器侧 ASR 0.2~0.7s 不受影响。判词 = **环境级内存压力 + 争用**（高置信），
> **非产品代码**；残余不确定 = 断档里 6s 长任务的归属（如实挂着）。诊断过程自身修了两处工具缺陷
> （hbGrabStack 忘 resume = 量具自己制造停摆；silent/超时写死 = 探针自伤），教训入坑 84/86。
>
> **★ e2e-asr run-13/14 的红点查到了，而且它是产品缺陷、不只是量具（`agent/cdp.js` navigate）**——
> 两次红在同一个调用：`cdp.navigate()` 在 `Page.navigate` 应答后 200ms 就发 `Page.getLayoutMetrics`
> 刷新视口，而 **navigate 的应答只代表"导航已开始"、不代表渲染进程已换完文档**——命令正落在
> "拆旧文档 / 装新文档"的提交窗口里。机器被占满时（实测可用内存 4.04~4.94GB）渲染进程整段不再回执，
> 30s 预算烧光报 `Page.getLayoutMetrics 超时`：**页面其实正常在加载，却被判"导航失败"（假红）**。
> run-13 死在 A、run-14 死在 B、同一个调用点 ⇒ **会移动的失败点是竞态**，不是某一侧的问题（坑 80/87 延续，入坑 88）。
> ▸ 为什么这不只是测试的事：`agent/index.js:556` 控制端在地址栏输网址走的就是同一条 `cdp.navigate()`
>   ——真实使用中"打开一个慢网站"就会抛错，且后续 `emitMeta()` 不再执行，
>   手机控制台的表现是**"页面明明开了却报打开失败、地址栏不同步"**。
> ▸ 修法按**幂等性**划线（与 10-04b「点击类命令绝不自动重试」不冲突：点击重发=双触发建两个房，
>   而取一次布局度量是纯读命令，多发一次除了晚点返回没有任何副作用）：读命令**重试一次**，
>   两次都没回执则**沿用启动尺寸兜底、不中止导航**（`this.viewport` 构造时已按 windowSize 有初值）。
> ▸ 验证（全部真跑）：`test:agent` **24/24**——⑬ 远程导航真实网站 ✅、⑭ 真实 URL/标题回传 ✅、
>   ⑨ 视口仍精确量到 1254×707（坐标 ±3px 不变）；`test:e2e-asr` **run-15**：
>   A/B **双端都进房成功**（`✅ B 凭号加入成功（双人在会）`——run-14 正是死在这一步之前），
>   真浏览器全链路 ⏱ 定稿 **1.6s（等待 0.0s + 转写 0.3s）**、徽标「服务器转写（本机 Qwen3-ASR）」、
>   服务器侧逐段转写 **0.2~0.6s**、听觉管线自愈重启再次实测（code=0 → 1000ms 重启）。
>   run-15 前 12 项 ✅（走到 ⑧）之后，两台可见浏览器与 3018 服务器于 10:45 被**外部整体收走**
>   （日志留下设计好的那句 `⚠️ CDP 连接断开（浏览器窗口被关掉了？）`，9361/9362/3018 全部无监听），
>   ⑨ 正解命中 / ⑩ AI 应答 / 播报计数 三条因此"读不到页面"而红——**是取证通道没了，不是链路断了**
>   （同一刻服务器侧仍正确转写出「明天下午三点的评审」「纪要生成」）。
>   ⚠️ 所以这三条今晨**未在浏览器里复证**，如实挂着：需机器空出显存时补跑 `npm run test:e2e-asr`
>   （用户实例此刻占 5.5GB/8GB 显存，此时再起一套 Qwen 双 worker 必然 OOM → 静默回落 CPU = 白跑，
>   10-04e 同一条纪律；另注：假麦克风 wav 会被 Chromium **循环重放**，
>   20.6s 素材在几分钟里被"再说一遍"是正常现象，不是重复转写缺陷——17 段原始转写一度被误判成此事）。
>
> **★ 11:33~11:45 真浏览器连跑把"一段时间就停了"查到了底（run-16/17/18/19）**——
> 机器这次是**空的**（显存 1.0~1.2GB、可用内存 8.1GB、用户实例已停），所以红不再能推给争用：
> ① **根因 = 单次 ASR 推理失控**：run-18 量到 **模型 93.5s**（同期 p50 0.5s），
>   紧随一段"排队 83.7s"；旧默认预算 `WAIT_MS=120000` 等于**允许全场静默两分钟**，
>   而 worker 是单进程串行的——只 `resolve('')` 不重启，下一段照样排死。
>   已修（预算 12s + 超时重启 + 20s 冷却 + 主动重启不计入连崩判死 + 空串回落 whisper 不丢字），
>   `test:asr` 新增 **③.7 组 6 条断言**钉住（54+1skip → **60 通过/0 失败/1 跳过**）；
>   run-19 全程 22 段 **0.5~1.1s 无失控**——但**重启路径至今没有真实触发过**（坑 76 口径：
>   没有触发证据就不能写"已修好"，只能说"预算与处置已就位，等一次真失控验证"）。
> ② **⑩ 播报不出声的真身（新定位，未修）**：修掉量具的 `JSON.parse` 之后计数终于读出来了——
>   `asked=3, started=0, gated="server-yield=3", srvGot=0, voiceOn=true`
>   ⇒ 客户端**正确让位**给服务端神经语音（Edge TTS 今晚可用），**服务器一条音频都没发**，
>   而且**也没补发 `ai-tts-fail`** ⇒ 两头静音、零报错 = **坑 66 的原样复发**（让位闸挡住了回落，
>   只是这次断点在服务器侧：声明了 `tts:'server'` 却没走合成）。
>   这组漏斗计数是夜跑刚加的（client.js:3403 注释里写着"背景：e2e 实测 server-yield=3 而 started=0"），
>   当时只做了**能看见**，没做**修好**——现在能看见了，断点定在服务器侧，下一刀在这里。
> ③ **⑧「从未定稿」= latMs 归零**（定稿确实发生、字幕确实上屏、B 也收到了，唯独 ⏱ 读数不出现）：
>   判据是 `lastVoiceTs` 距今 <120s，而 run-15 同一判据量到 1.6s ⇒ 间歇性失效，
>   嫌疑指向 RMS `ametadata file=-:direct=1` 那条 stdout 通道在长跑中停更（这条通道是 10-05 夜跑
>   刚立的"生命线"）。**未定论，如实挂着。**
> ④ **测试侧修掉两条会误导人的断言**（比修产品更要紧，因为它决定我下一步查什么）：
>   ⑨ 正解命中原先把 `chatTail` 拼进 haystack，而 AI 入会致辞模板里就含"小明""生成纪要"
>   ⇒ **run-17 零转写（80 段全 peak=-90.3 纯静音）照样报绿命中 ["小明","纪要"]**；
>   已改成只数**转写来源** + 加"⑨ 前提：转写来源非空"，并让 ⑧ 失败时直接打印
>   "服务器转写 N 条 ⇒ 音频根本没进系统"（⑦ 的 ✅ 只证明按钮状态，不证明音频在流）。
>   另一条是上面那个 `JSON.parse(对象)` —— 结构性必抛，却把措辞写成"A 页面主线程无响应"，
>   而心跳 `n=356/一跳 258ms` + `长任务 0 个` 当场证伪：**量具的错被记成了产品缺陷**。
>
> **run-19 终态：21 项检查 / 4 项失败**（run-16 是 18/4、run-18 是 21/5）——
> 当时以为剩的 4 条归到上面 ②③ 两个服务器侧问题。**11:55~12:18 又追了两跑，结论改了**：
> ②③ 不是两个问题，是**同一个**——真正的闸口在"成句"，而"成句"的保险丝被重复语音永久重置（坑 **90**）。
> 修完 **run-21 = 21/3**（加闸诊断那一跑）、**run-22 = 21 项 / 0 项失败**：
> `成句 4`、`定稿 5`（此前恒为 **0**）、**喇叭真的开过口 10 次**（此前 0 次）、
> `B 看到 AI 应答气泡` ✅、白板双端同步 ✅、笔迹 2594↔2593 ✅。
> 复跑无回退：`test:sfu` **219/219** · `test:smoke` **388/388** · `test:asr` **64/0/1skip**（③.7 十断言）。
> 上面 ② 的"服务器声明了 tts:'server' 却没送音频"这条**随之消解**——音频不发是因为根本没走到应答；
> 而 ③ 的"latMs=0"也消解，但**换了个形态**：现在定稿走 `max-open` 保险丝，`latMs` 量到 15~20ms，
> 那是"人还在说就强制定稿"的副产物、**不是**"说完→定稿"的延迟 → 读数诚实性待办见坑 90 末段。
>
> ⚠️ **待人工浏览器验证**（命令行验不了）：真人开麦整晚体感（合成语音已全链路实证）、
> Edge TTS 在真实网络出口下的听感、跨网第二台设备（announcedIp 自愈后首次）、
> 共享画面观感、光轨手感与性能。
>
> **★ 2026-10-06b AI 表情素材强化（用户实测："说话态嘴都没有张开，思考看着也不像 太僵硬"）**——
> ① **口型循环重排**：原 xiaoming-talk.webp 41 帧里前 24 帧几乎是同一张闭嘴脸，嘴动只有一瞬
>   还伴着眨眼（用户看到的就是"嘴没张开"）；从原帧挑**全睁眼**序列重排成 20 帧两音节闭环
>   （闭→咧笑开→最大圆口→收→停顿→第二音节→闭，12fps≈1.7s，嘴部动作占循环一半），
>   ffmpeg 重编码；旧素材保留 xiaoming-talk-orig.webp；
> ② **思考脸换新**：soft 是嘟嘴（看着像闹情绪不像思考），用图生图（以 idle 为参考高保真）生成
>   "抬眼皱眉"凝神脸，Python 四边泛洪连通域抠透明底（护住眼白等封闭区）、构图对齐 idle
>   （头宽 196 vs 190 基本一致）；存 xiaoming-think.png，soft 保留未引用；
> ③ **坑 91 入册**：ffmpeg libwebp **默认 loop=1（播一遍就停）**，重编码动画 webp 必须显式
>   `-loop 0`，否则淡入后定格在最后一帧（恰是闭嘴）——check:avatar 截屏量嘴 Δ1.5 当场抓住；
> ④ check-ai-avatar.js 素材清单 soft→think、合法素材正则加 think；client.js AI_PORTRAITS
>   v=20261006；preview.html 同步；
> **回归**：冒烟 **445/445** + check:avatar 真浏览器 **28/28**（嘴部 Δ20.6、三静帧两两可分 Δ14~28）。
>
> **★ 2026-10-06d 三代重构：底脸常驻 + 嘴部贴片（用户怒评"你优化了个蛋啊"后的真修复）**——
> 前两代之死：**一代**整脸换 talk.webp（10-05）死于素材前 24 帧同一张闭嘴脸（"嘴没张开"）；
> **二代**重排口型帧（10-06b）+ 150ms 快切（10-06c）死于"重影"——整脸溶解进出说话时
> "闭嘴脸 + 咧嘴脸"必有一瞬半透明叠印，**帧内容差异太大，多短的溶解都能被看见**。
> 真修复（商业头像产品标准做法）：**把会动的嘴从脸里拆出来**。
> ① 底 = 三张静态脸（idle/think/smile）交叉溶解 450ms，只承担"脸差异小且都闭嘴"的组合——
>   溶解的安全区；素材统一收紧裁剪（原坐标 30,10~230,225，人物占满圆盘）；
> ② 嘴 = xiaoming-mouth.webp 贴片层（20 帧两音节口型，解剖框 85,145~175,215 裁出 +
>   14px 羽化，与底图共用同一裁剪框 → 对齐天然成立），speaking 时 180ms 淡入淡出——
>   **底脸完全不动，结构上不存在双脸叠印**；贴片只走 opacity 通道（10-02 纪律不叠 transform）；
> ③ 说话期间底脸继续呼吸（aiBreath），10-05 那条"speaking 底脸 animation:none"随整脸
>   切换一起退役；tf-fast 机制（10-06c）同步移除；
> ④ 全素材 *-orig 备份可回退；check-ai-avatar.js 改钉贴片语义（moOn/moSrc/moAnim +
>   量嘴框收紧到 0.36~0.64/0.66~0.90，红线 Δ10→5 按贴片嘴实测信号 Δ7.5~8.5 重标定）；
> **回归**：冒烟 **445/445** + check:avatar **28/28**；真浏览器逐帧截图人工检视：
> 张嘴/圆口清晰、底脸纹丝不动、思考脸（抬眼皱眉）在放大后辨识度合格。
>
> **★ 2026-10-07 五代重构：SVG 矢量脸替换 AI 生成位图（用户："能不能做的像个人做的"）**——
> 三代已做到"底脸常驻+嘴部贴片"，用户仍评素材本身——**AI 生成的 Q 版位图怎么修帧都有
> "生成图味"，位图路线封顶**。五代换掉素材层，动画机制（呼吸/小动作/音频律动/状态机）
> 一行没动：① `aiAvatarSvg()`（client.js 文件头，复活 09-26b 从未被调用的思路并改写）——
> 深暖炭方头+米脸板+深色胶囊眼+奶白瞳孔+天线条，眼/眉/嘴/腮红独立 SVG 元素；
> ② 状态全走 CSS：`.speaking .av-mouth` 跑 avTalk（scaleY 呼吸式开合）、`.thinking` 瞳孔上抬
> +眉毛下压内撇、`.happy` 笑眼藏瞳孔+嘴咧开、avBlink 常驻慢循环（双眼错开 20ms）；
> ③ **SVG 元素变形必须 `transform-box: fill-box`**（默认参照整条视口，眨眼会变整张脸在跳）；
> ④ **SVG 的 className 是 SVGAnimatedString**，采样/测试一律 getAttribute('class')；
> ⑤ AI_MOUTH/AI_PORTRAITS/AI_FACE_LAYERS/setAiPortrait 整块删除，类契约兼容使 JS 调度器零改动；
> ⑥ 坑 92：量具隔离不许"全开"——faceScreenFrames 按停 `.ai-face *` 会把被测信号 avTalk
> 也杀了（嘴 Δ0 假红），量 speaking 时探针 `:not(.av-mouth)` 放行被测项；
> ⑦ preview.html 重写为产品级演示页：链接生产 style.css + 运行时 fetch client.js 抽取
> aiAvatarSvg()（单一来源）；自定义 class 必须加前缀（裸用 .stage/.btn 与生产类撞名，
> .stage 被生产 CSS 改成 flex column 把演示格压成 74px）。
> **回归**：冒烟 **444/444** + check:avatar **27/27**（嘴部像素 Δ34.75 / 地板 Δ0 / 眨眼 /
> 呼吸 / 小动作 / 先想后说全绿）；CDP 截图人工验收 idle/thinking/speaking 三态观感正常。
>
> **★ 2026-10-06c 说话切换改 150ms 快切（用户实测"说话的时候重影太多了"）**——
> 嘴型素材重排后差异变大：450ms 溶解期间"闭嘴脸 + 咧嘴脸"各半透明度叠在同一位置 =
> 肉眼直读的双重曝光（旧素材两张脸几乎一样所以溶解看不出来）。修法：进/出说话态
> （任一边是口型层）挂 `.tf-fast`，`transition-duration: .15s`——低于重影感知阈值、
> 仍比硬切柔和；其余低反差组合（idle↔thinking↔happy）保留 450ms 溶解。素材本身验尸
> 干净（逐帧放大无烘焙残影），重影只来自溶解窗口。真浏览器探针实测五种切换的
> transition-duration 全部符合预期；冒烟 +1 条钉住（**446/446**）；preview.html 同步。
>
> **★ 2026-10-06 AI 表情三态交叉淡入（用户点名"静置/思考/说话衔接丝滑流畅"）**——
> 换脸机制从"单图换 src（硬切跳脸）"改为**常驻表情层 + 激活类移交**：
> ① `.ai-face-wrap` 里一次建好去重后的 4 层（idle/talk 口型循环/soft 凝神/smile 微笑，
> `AI_FACE_LAYERS`），激活层挂 `.ai-face`（opacity 1）、待命层挂 `.ai-face-l`（opacity 0），
> `setAiPortrait(st)` 只移交类、永不改 src；两层各走各的 `transition: opacity .45s` =
> 真交叉溶解，连续翻转（思考→说话→思考）也不闪；口型层隐藏时一直在播，
> 淡入即中段嘴型（没有第 0 帧硬启动）；
> ② 激活类同一时间只有一个 → 既有 CSS（呼吸/小动作/说话无光晕/音频律动 filter）只命中
> 激活层，**check-ai-avatar.js 真浏览器验证零改动全兼容**（28/28 绿）；
> ③ `clearAiGesture` 改为跨全部图层摘类（激活类移交后旧层上的动作类曾是残留，
> 再激活时 classList.add 成 no-op → 小动作静默失联）；圆盘 wrap 补
> `transition: box-shadow/filter .45s`（说话金环/思考微暗不再"啪"地闪）；
> ④ `avatars/ai/preview.html` 重写为三态演示台（图层实况条 + 自动巡演）；
> 冒烟断言"换脸判重"随机制升级改写（445/445）；真浏览器探针实测双向过渡中段
> 两层 opacity 严格介于 0~1（溶解真的发生）。

> **★ 2026-10-06 夜二「不叫小明，小明就不说话」+ 字幕不再把三句话粘成一句**（用户：
> 「识别不是很准确，这是一个正常的会议，如果不提到小明的名字小明不应该说话，
> 只有叫到小明的时候小明才会说话思考回答」）——三条成因全部拿**用户自己那场会**的账本定位，不靠猜：
> ① **证据先于结论**（`sfu/captions/cap-286716-20261006.jsonl`）：21 条麦克风转写里
>   只有 4 条提到名字，AI 却答了 **18 次**——「拍卖啊！」「咳咳。」「爱丽。」「你把手机放了吧。」全被接话。
>   三个独立成因：**(a)** 09-28 那个 20s「追问窗口」每次应答都顺延 ⇒ 常开麦的会议里**永远不关**；
>   **(b)** `maybeAiSpeakUp` 会在没人叫它时主动播报；**(c)** 唤醒表把 **小米/小命/小民** 与 小明 一视同仁
>   （本场「说**小命**的话」就是这么醒的）。
> ② **修法（判据都在 `sfu/ai/asr.js` 一处）**：`aiChatWindowSec` 默认 20 → **0**（留 config +
>   `AI_CHAT_WINDOW_SEC` env 做 A/B）；主动播报改显式开启（`aiProactiveSay`/`AI_PROACTIVE_SAY`）；
>   `shouldWake` 从"像不像名字"改成**分层**——强后缀（明鸣名铭茗）任意位置都算，
>   歧义后缀（米民密蜜命）**要有称呼语境**（你好/帮我/打开…）才算，10-05 实测的「你好 小米」不退回漏醒；
>   被 2s 分段切断的半句另开一条**一次性、不顺延**的续接（`AI_ASK_TAIL_SEC` 默认 6s）——
>   否则"纯唤醒"会把「小明。」+「把纪要生成一下。」变成"喊它它不理"（10-05c 那个老抱怨）。
>   称呼词表第一版被真账本打回：裸「在不」跨词命中「如**在不**不」⇒ 只收多字说法（坑 49 第四次应验）。
>   ▸ ★ **"答非所问"还有一多半来自提问的形状**：新纯函数 `Asr.wakeClause` 把唤醒路的提问
>     **收窄到叫它的那一小句**——真实 blob「哎，是吧？ 打开白板。 小明打开打开白板。
>     不知道，我也没印象。」以前整条丢给模型，它真去管"打开白板"以外的那两句。
>     只按句末标点切、**逗号不切**（否则把「小明，帮我把这条记一下，明天下午三点」切碎）；
>     **收窄的只是喂给模型的问题**，账本/看板/RAG 语料仍是整条——
>     "有人说了什么"与"他在要求什么"是两个概念（坑 47 的正面用法：不是合并，是分开命名）。
> ③ **「识别不准」那一半的字面证据 = blob**：静音判定被房间噪声顶住时只能靠 10s 保险丝收口，
>   三句不相干的话粘成「哦 不能往上怎么接那个 大木车是不是 你好小明」。新增纯函数
>   `Asr.startsNewSentence`（累积句以句末标点收尾 + 归一化 ≥12 字 + 新段与它无归并关系 ⇒ 就地定稿另起一句）。
>   ▸ **下限是被真跑抓回来的**：第一版没有下限，`test:asr-live` 当场把一句完整请求切成
>   「小明，帮我记一下。」+「明天下午三点的评审。」，AI 只听到前半句就答 ⇒ 用"字幕好看"
>   换了"请求不完整"，方向反了（新记**坑 109**；判据形状记**坑 108**：滚动续期的免检窗口
>   在输入源源不断时等于闸门失效）。
> ④ ★ **A/B 双向证过**（量具读得出 0，报的"在 1"才算证据）：同一段音频（说→停→**没叫它的闲聊**→停→再说）
>   跑两遍——默认配置 **PASS**（定稿 2 条 / 应答 **1 次** / 说完→上字幕 1.7~1.8s）；
>   `AI_CHAT_WINDOW_SEC=20` 复跑 → **红在一条新断言上**：
>   「那句没带名字的『今天天气真不错，拍卖啊。』被转写后 7s 内，AI 应答了」。
>   ▸ 这条断言本身也改了两次：第一版数"应答总次数 ≤ 带名字的字幕数"，把**分段续接**那次合法应答
>     也算成违规（判据错不是代码错）；改成问"闲聊句那段时间有没有换来一次应答"——两边各留 6s 静音，
>     它前后 7s 内没有带名字的字幕 ⇒ 那次应答只可能来自它自己。
>   ▸ 顺带修掉 G1 的一条**口径错**：模型把句尾「评审会」听成「**庭**审会」被判成"静音幻觉"——
>     那是听岔不是幻觉；"是否说过"改按**字组覆盖率 ≥0.5** 判（白名单永远会漏下一个错字，
>     而漏掉的那个必然以假红形式消耗下一次排查）。
> ⑤ **测试与界面**：`test:asr` 新增 14 句真实负例 + 6 句真叫它的正例 + 分层判据 + 换句 4 条 +
>   **接线断言 4 条** + `shouldWake ↔ wakeReason 同真同假`（我自己写出过"同名函数声明被提升后
>   覆盖，判据改了行为没变"）+ 三张唤醒表与 client 逐字比对；`sfu/config.json` 已改成
>   `aiChatWindowSec:0 / aiProactiveSay:false / aiAskTailSec:6`；AI 入会第一句现在明说
>   「开会时我**不插话**——要我用，喊一声「小明」＋想做的事」（规矩只在代码里 = 用户只能靠踩雷学）。
> ⑥ ★ **用户当场驳回了我一半证据**（"你测试的音频乱的不像话"）——他说得对：
>   合成 fixture 每句都写着「小明」，它**结构上测不出误唤醒**，而循环念稿 + 2s 分段
>   产出的句子本身就碎（我把原始分段切片当成结论贴了出去）。据此做两件事：
>   ▸ **停掉**"用合成音频比 2s/3s/4s 分段"的调参（那正是 10-05e 警告过的"拿合成数据调生产阈值"）；
>     真人账本里 2s 批次只有 3 场、说话人还不同，**样本不支持任何结论**，所以 `asrSegmentSec` 一行没改；
>   ▸ 把判据搬到**真人数据**上做成常驻仪表：`review:meeting` 新增两行
>     「**唤醒回扫**」（21 句人话按当前判据会醒 5 句 · 靠歧义写法醒 0 句 ·
>     而这场**实际应答 18 次** ⇒ 多出的 13 次来自已关闭的窗口/旧宽表 = "我改了你怎么还不行"的答案）
>     与「**字幕形态**」（平均/中位/最长 + ≤4字碎片% + ≥25字长条%，blob 与碎句是方向相反的两种病）。
>     `test:review` 自检 29 → **37**，其中 N 组 5 条 + N2 组 3 条，
>     含"**仪表自己必须能红**"的反向对照（把 client 判据换回旧宽表 → 精准红在
>     「说小命的话」「我买了个小米手机」两句上，实测过）。
> ⑦ **新界面检查 `npm run check:wake`（9 项，真浏览器）**：把 21 句**真实账本句子**喂给页面自己的
>   `aiWakeHere`，① 与服务端 `Asr.shouldWake` **逐句对表**（静态比正则表保证不了逻辑一致），
>   ② 负例/正例各自成组断言（两份一起错也是绿，所以必须分开钉），
>   ③ **行为断言**：直接调 `emitCaption()`，看它发不发 `ai-ask`
>   ——没叫名字 0 次、叫了名字 1 次、同句 8s 内重复仍 1 次。已登记进 `check:all` 清单。
> ⑧ ★ **把这条规矩变成生产环境的常驻告警**（不能只靠我这次手工验证）：`/metrics` 新增两本账
>   `sfu_ai_answer_via_total{via="wake"|"follow-up"}`，`/api/rooms` 交出 `collab.aiChatWindowMs`
>   （**模式事实由服务器交出来**，告警工具不去猜用户的配置）；
>   `watch.js` 规则⑤：纯唤醒模式下"免唤醒续答"超出"只叫名字的唤醒"次数、且**累计 ≥2** 才报，
>   文案直接列三条回归源（窗口被配开 / 宽表被放宽 / 客户端绕过服务器 ai-ask）。
>   ▸ 为什么用"超出量"而不是"有 follow-up 就报"：分段半句续接是**合法**的免唤醒应答，
>     一条天天误报的告警等于没有告警（坑 67/82 同一条）。
>   ▸ 计数器本身也有断言：`test:asr-live` 现在验恒等式 `answers === wake + follow-up`
>     （而不是"follow-up 必须为 0"——那会随分段形态时不时红）；
>     `test:sfu` +2 条（两本账的行都在 & 锚行首不被 `# HELP` 里的 `via="wake"` 骗，坑 74）；
>     `test:watch` +7 条（含"对话模式下整体沉默""老服务器读不到不猜"" HELP 行陷阱"）。
>     回归：**信令 225/225 · watch 43/43**（新 7 条第一版参数顺序写反=永真，见坑 110）。
> **回归（2026-10-06 夜二实测，本轮最后一次全跑）**：`test:asr` **151 通过 / 0 失败 / 1 跳过** ·
>   `test:sfu` **225/225** · `test:smoke` **446/446** · `test:review` **37/37** · `test:watch` **43/43** ·
>   `check:wake` **9/9（A/B 反跑可红）** · `check:avatar` **28/28**（并行会话修完素材后我复跑核实） ·
>   `test:asr-live` **PASS**（定稿 4 条 / 应答 **1 次** / 说完→上字幕 1.7~1.8s；
>   `AI_CHAT_WINDOW_SEC=20` 复跑**红在**"闲聊句被接了"那条）·
>   **`test:e2e-asr` 25 项 / 0 失败**（真浏览器双窗，音频里含一句没叫它的闲聊 → 插话 0 条）·
>   `check:all` **15/16 条 · 252 项**（唯一红的是 `check:pill` "hover 涨大只采到 1 个中间态"，
>   单独复跑同样红 = **不是负载抖动**；该条自 10-04b 就记着"根因未定论"，属拱形升起功能区，本轮未动）。
> ⑨ ★ **在用户自己连着的浏览器里验了一次**（browser-use，非无头）：把他正在用的页面加载到
>   `localhost:3001`，直接调用**页面自己的** `aiWakeHere` 跑那 21 句真实账本句子 —
>   **14 句闲聊全部不醒、7 句真叫它的全部醒**，且他这一份 client.js 就是新版
>   （`#staleBuild` 横幅存在但**没弹**，版本一致时不许弹 ✓ 保守判据生效）。
>   ▸ 顺手记一条我自己的探针错：第一次用 `[src*="client.js"]` 取版本参数，命中了
>   `vendor/mediasoup-client.js`（也含 "client.js" 子串），于是报"版本参数没注入"——
>   **假故障是探针造的**（坑 27/51 家族：断言读到了错误的节点）。真实 DOM 是
>   `client.js?v=afd91fa26c` 且与 `/config.json` 的 `assetVersions.clientjs` 逐字相同。
> ⑩ ★ **真浏览器双窗 e2e 加"插话"判定（`test:e2e-asr` 23 → 25 项，0 失败）**：
>   假麦克风音频里插进第三句 **没叫它的闲聊**（`FIXTURE_CHATTER`，与服务器自测同一份实现），
>   三条按顺序缺一不可：① 前提=那句闲聊真的上了字幕（否则"没接话"只是"没听见"，坑 65）
>   ② 前提=AI 至少答过一次（否则"零插话"是整条链路没通）③ 判据=**没有任何一条气泡在回应那句闲聊**
>   （内容命中 天气/拍卖 且不含正事词）。实测：闲聊句确实上字幕、气泡 2 条、回应闲聊 **0 条**。
>   ▸ 顺带一条**我自己造出来的假红**：第一次跑我为了省显存加了 `ASR_QWEN_LOCAL=0`，
>     结果 ⑨「正解命中」当场红——兜底 whisper 把「小明」听成「晓明」、「纪要」写成「记要」，
>     三关键词只剩 1 个。**那是我换掉了被测配置，不是产品回退**（用户跑 qwen-local）。
>     现在失败信息会自带这句提醒；判据：**跑保真度类测试前先确认引擎与用户配置一致**
>     （与坑 57"复用别人端口跑出的绿"、坑 87"先量机器资源"同族）。
> ⚠️ **用户那台 3001 已于 18:16 重启 ⇒ "不叫小明就不开口"这半边的产品改动已经在他机器上生效**
>   （`aiChatWindowSec=0` / 主动播报关 / 分层唤醒 / 换句下限 / 提问收窄）。
>   **但我在那之后又动了服务器代码**（`COLLAB.answerVia` 两本账 + `collab.aiChatWindowMs` 进快照，
>   只为让 watch 能常驻盯这件事）——**这部分要再重启一次 3001 才有**，
>   不重启的后果只是"没有那条告警"，不影响会议里的行为。
>   浏览器那一轨改了 `client.js`，要 `?nosw=1` 开一次才拿到，版本自检横幅会自己说谁还是旧的。
>   真人开麦仍需人工确认两件事：① 正常聊天时它**全程安静**（跑 `npm run review:meeting`
>   看「唤醒回扫」那行，"实际应答"与"会醒"两个数应当咬合，旧数据差 13 次）；
>   ② 「小明，帮我记一下…」被分段切断时它答的是**整句**不是半句。
>   **词级准确率没解决**：`大木车 / 洗地皮 / 庭审会` 这类是本地 0.6B 在他那个噪声电平
>   （-56~-65 dBFS）上的天花板；三条路（云端 DASHSCOPE / 更大本地模型 / 靠近麦克风）
>   各有权衡，等用户拍，不拿合成音频替他调阈值。

> **★ 2026-10-08 第 51 步：共享文件浏览——房间里所有人同时看到同一份文档（PDF/Word/.md/PPT/Excel/图片）**
> ——用户原话："给项目创建房间后的功能模块增加共享文件浏览的功能，让在房间的所有用户能同时看到共享文件并操作的包含 PDF word .md PPT Excel 图片等"。
> 本轮**没有加任何依赖**，所以最硬的一块是"零依赖怎么读 Word/Excel/PPT"。全部真跑取证。
> ① ★ **渲染内核 = 新文件 `sfu/public/fileview.js`（约 1200 行，纯函数、碰不到 DOM/fetch）**：
>   OOXML 的本质是"**一个 ZIP 包里的几份 XML**"，而浏览器自带 `DecompressionStream('deflate-raw')`
>   （ZIP 里的 deflate **不带 zlib 头**，用 'deflate' 直接格式错——最容易踩的一脚）；
>   于是手写 ZIP 中央目录解析（含 **ZIP64 额外字段 0x0001**）+ 一个几百行的容错 XML 解析器，
>   "不装 mammoth / sheetjs / pdf.js 也能读 Office"就成立。Node 侧同一份代码走 `zlib` 注入那条路。
>   ▸ 三种文档各还原什么：docx=标题/列表（项目符号与编号分得清）/表格（gridSpan）/内嵌图（data: URL）/超链接
>   （只有 `TargetMode="External"` 才变 `<a>`）；xlsx=sharedStrings + **日期是"数字 + 数字格式"**
>   （`xl/styles.xml` 的 cellXfs→numFmtId，内置日期 id 14~22/27~36/45~47/50~58；`m` 是月还是分钟要看
>   格式串里有没有时间串 ⇒ `datePartsOf` 先剥 `[hms:]` 再判，否则 `h:mm:ss` 被当成日期）+ 错误值原样可见；
>   pptx=幻灯片按 `p:sldSz` 的 EMU 摆版（字号用 **`cqw` + `container-type: inline-size`**，所以卡片变宽字跟着变）；
>   ▸ 旧版 `.doc/.xls/.ppt` **如实报"请下载后查看"**——那三种没有公开可解析的结构，
>     任何"零依赖渲染它们"的说法都是吹牛（`legacyHtml` 把话说清 + 给下一步）。
>   ▸ 安全：所有文字**先转义再拼接**；链接只放行 http/https/mailto/tel/相对路径，
>     `javascript:` `data:` 先删控制字符与空白再判（防 `java\tscript:`）；**属性上下文要另转引号**（`fileAttr()`）；
>     服务器第二道：非白名单类型一律 `attachment` + `application/octet-stream` + `nosniff`
>     （**SVG/HTML 有意不在放行表里**）——只有前端转义，遇到"新标签里直接打开下载链接"就漏了。
> ② **存储层 = 新文件 `sfu/files.js`**：`sfu/files/<房间>/{index.json, blob/*}`；
>   台账与磁盘**对账**（清单里有、盘上没有 → 不列出来，杜绝"点开 404"），
>   超配额**当场 `req.destroy()`**（不收下来再拒），`.part` 写完才改名（进程被杀不留半个文件），
>   启动 `sweepStaleParts()` 扫旧垃圾；Windows 上 `out.destroy()` 后立刻 `unlink` 会 **EBUSY 静默失败**
>   → 改成 `'close' 事件 + 延迟重试`，断言从固定 sleep 改成**轮询到消失为止**。
>   "这场会能看到哪些"的下界 = `room.createdAt`（**房间号会回收复用**，字幕账本同款防串味）。
> ③ **同步模型（这一步的设计核心）**：服务器持有一份权威 `room.fileView`，
>   只在**变化**时广播；滚动这类**连续量节流**（`FILE_VIEW_MIN_MS=120`），
>   换文件/翻页这类**离散事件绕过节流**（否则最该立刻同步的动作被限流吃掉）；
>   位置传**比例 0~1** 不传像素（每人窗口高度不同）；新人靠 `files-state` **单播补发**清单+视角
>   （不补发 = 晚来的人永远看不见，白板当年踩过这一脚）；客户端 `applyingRemote` **断环**
>   （照别人做的那段时间不再往外广播，否则两个跟随者互相拽着滚）。
>   界面上**写明"跟着谁"在带**——同步这件事必须看得见，不是默默跟着变。
> ④ **入口与红线**：控制坞「文件」按钮 + 全屏面板（列表/上传进度/工具条 缩放·翻页·跟随·下载）；
>   AI 房间动作加 `files-open`/`files-close`（**白名单只动房间级共享状态，
>   不许动任何人的设备/上传/删除/替某人打开某份**，冒烟有结构红线钉着）；
>   越界表原先把「打开共享文件」判成"共享屏幕"被拒 → 两条 `OUT_OF_SCOPE` 正则都补了
>   `(?!文件|资料|文档|材料|列表|面板)`；**有意不收**裸"材料/资料"（「看一下会议材料」是用户在读自己的东西）。
> ⑤ ★ **测试四层 + 真浏览器双窗，全绿**：
>   `test:fileview` **190**（新；夹具 `scripts/ooxml-fixture.js` 是**独立写的 ZIP 打包器**——
>   写包的和读包的是两份实现，它们对同一份字节达成一致才算真证据）、
>   `test:files` **59**、`test:sfu` **270**（新增第 51 步一组 44 项，自带房间与客户端）、
>   `test:smoke` **495**、`npm run check:all` **20/20 条 · 344 项**（新增 `check:files` **33 项**双浏览器）、
>   asr 218 / nets 31 / review 40 / watch 54 / store 55 / shutdown 9 / tts 13 / ai 10 / ai-brain 75 /
>   publish 30 / Mesh 36 / quiet-mic 11 / room-actions 17 / e2e 16 / e2e-reconnect 15 / e2e-media 38 /
>   agent 24 / record PASS（251.1KB/4.0s）/ turn PASS / doctor 24 通过-1 警告-0 失败。
>   ▸ `check:files` 的卖点是一句话：**第二个个人页面上真的出现了同一份渲染结果**（读 B 的 DOM 文字），
>     而不是"我这边能渲染"；另含 XSS 探针（`tags===0 && escaped && !boom`）、
>     断环（B 跟随产生的滚动没回广播）、晚到者补发、面板底边不压控制坞 + `elementFromPoint` 命中测试。
> ⑥ ★ **本轮自己写出来又被自己抓走的三处（都升级成了常驻断言）**：见**新坑 118 / 119 / 120**——
>   (a) 浏览器那一轨的解压**在真浏览器里整条 promise 永久不 settle**（TransformStream 写侧等读侧，
>     而读者在 `await close()` 的下一行才诞生 = **自死锁**），而 **Node 18+ 也有 DecompressionStream**，
>     所以 178 条单测全绿、界面却一片空白；
>   (b) 检查自己走了后门（程序化点「创建房间」却没点首屏「进入会议」）⇒ z100 的 landing 层一直盖着
>     会议界面，**DOM 断言全绿而命中测试报 `MAIN#hero`**；
>   (c) 轮询条件写成"B 的画面能滚了"而不是"B 跟到了底"⇒ 读到节流窗口里的中间态，假红。
> ▸ **顺带修掉两条与本功能无关的真缺陷**：`enterRoom()` 现在会幂等地收起首屏
>   （"人在会里"必然蕴含"landing 已收"，原先只有那个按钮的处理写这一步——新加进房路径就会漏）；
>   「我打开一份文件」收成唯一入口 `openFileAsMine()`（打开 + 广播；原先两行写在两个调用点后面，
>   漏一半的症状正是用户会报的"别人没跟上"，冒烟加了结构红线：裸 `openFileByName(` 只许 3 处）。
> ⚠️ **需要用户重启 3001 + 浏览器 `?nosw=1` 开一次**才吃得到（服务器路由/信令与全部前端代码都改了）。
> ⚠️ **诚实边界**：Office 三种只还原**文字与基本结构**（不分页、不做页眉页脚/图表/公式/条件格式/母版继承）；
>   PDF 走浏览器内置阅读器（`<iframe>`），所以 **PDF 内部的滚动读不到**、翻页靠工具条明确地做；
>   超过 `MAX_PARSE_BYTES=40MB` 的文档不解析（引导下载）；
>   真实人手用过这份面板**还没被验证**（命令行验不了"看着舒不舒服"），自动化只证明"能开、能同步、不执行别人的字节"。

> **★ 2026-10-08 凌晨下半场（同一批要求的第二轮：不加新功能面，只把这条新功能自己的证据打厚 —— 路线图 I 档 I1~I5 + I9）**
> ——用户："完成后按照后续升级方向.md 继续升级 先更新文档方向再更新深化测试功能 到今天早8点"。
> 本轮的两个新发现都是**真缺陷 / 真边界**，不是补测试补出来的安慰。
> ① ★ **PDF 翻页从来没真的翻过**（I1 的直接产物，新坑 **121**）：`renderPdf` 与两处跟随都写
>   `fr.src = blobUrl + '#page=' + n`，而内置阅读器把"同一文档只换片段"当成**页内导航**，因此一动不动。
>   实测（夹具第一页画一大块黑、第二页留白）：翻页前后黑色占比 **58.9% vs 58.9%**，而 `src` 明明变了。
>   修法 = `mountPdf(url, page)` **换节点**（旧 iframe 移除、新 iframe 带上完整片段）
>   + 一条"同一页不重建"的守卫（否则跟随每 120ms 一次就重启一次画面）；
>   拼法收成 `FV.pdfSrc()` 唯一一处，冒烟两条结构红线：client.js 里 `#page=` **0 次**、`FV.pdfSrc(` **恰好 1 次**。
> ② ★ **无头浏览器里的插件像素不可靠**（新坑 **122**）：同一页连读四次得到 34% / 49% / 94% / 53% ——
>   写成断言就是"会移动的红灯"（坑 80），放宽阈值又变成"永远绿"（坑 115）。
>   处理 = **判分只押稳定层**（元素存在 / `src` 形状 / HTTP 头 / 节点身份），
>   像素降为**打印观察值** + 留现场图；"PDF 翻页看起来对不对"进人工清单。
>   ▸ 这给 I1 一个诚实的收尾：**"PDF 在面板里真的画出来了"这句话，命令行验不了**。
> ③ **手机形态（I2）**：`check:files` 第 15b 节用 CDP `Emulation.setDeviceMetricsOverride`
>   把桌面 Chrome 装成 390×844（dsf 2 / mobile:true），5 条断言押"不横向溢出 + 那颗按钮点得到 +
>   `elementFromPoint` 命中的就是它 + 底部那一列的让位仍成立"；跑完**清掉 override**（残留会污染下一条检查）。
> ④ ★ **soak 接入文件流量（I3）**：长跑从三类流量变**四类**，每轮走完整生命周期
>   （上传 → 下载回来比字节 → 修剪最旧的 → 与服务器清单对账 → 报视角），
>   收尾加一段「房间销毁对账」：等宽限期到点 → HTTP 说房间没了 → **本机目录真的没了**。
>   实测（**6 分钟真跑**；专用端口 + 临时库 + 临时 `FILES_DIR`，收尾自动等房间宽限期）：
>   上传 18 份 · 删除 15 份 · 对账 18 次（不平 0）· 收尾在盘 3 份 · 清单广播 33 次 ·
>   视角 18 发 → 18 收 · 信令 179 条 · 断线重连 0 · rss 54→66MB · 房间销毁后目录 ✅ 已删 → **PASS**
>   （同一台工具更早那场压缩跑是 3 份 / 1 删 / 对账 3 次，数字如实留在各处历史块里，不覆盖成"最好那次"。）
>   ▸ 四条 A/B 全部证过可红（不真删→红 / 不记视角→红 / 比字节拿错参照物→红 / 修剪提前 return→红），
>     而**第一条差点骗过我**：那一轮上传数没超过保留上限，被我变异的那行根本没执行 → 照样绿
>     （新坑 **123**：**变异路径没被执行过的 A/B 也是假绿**）。
>     所以 soak 现在自己报"传了 N 份却一个都没删 = 修剪分支今晚没跑过，这条绿不算数"。
> ⑤ **`review:meeting` 认识新功能了（I4）**：新增「共享文件」一行 —— 没人传就明说"不是故障"
>   （假红也伤人），有拒绝时把**第一条拒绝原因**摆出来，清理失败单独一行；
>   `eventsForRoom` 从 `main` 抽成导出函数才可断言；自检 `test:review` 40 → **47**
>   （含"同一间房报『有 3 份』与报『0 份』必须分得开"的反向对照）。
> ⑥ ★ **渲染内核的边界（I5）**：`test:fileview` 新增 **O 组 22 条**（203 → 225，加上后面 P 组共 **234**），
>   钉的是"真实 Office 文件里才有、玩具夹具不会写的形状"：docx `w:vMerge`（缺 `val` = **继续**）、
>   `gridSpan` 与 `vMerge` **同表混用**（列号不按 span 累加就把起始格落错列 → rowspan 消失 + 多一格空白）、
>   xlsx 公式带缓存 `<v>` 就用缓存值 / **没有缓存值就整行留空**（我们不重算公式，编一个数就是撒谎）、
>   自定义 numFmt 里 `yyyy"年"m"月"` 这类**引号字面量**不许被当成日期/时间字母、
>   pptx 的 `notesSlides`（真文件每页都带）**不许成为观众看到的一页**，
>   以及"扩展名与内容对不上时**按扩展名走**"这条**有意的**边界（改成按魔数改路由会让判据当场红 —— 那是决定，不是疏忽）。
>   ▸ 每条都能被一个对应变异打红（清单在 `后续升级方向.md` I 档那张表里）；
>     顺带修掉一条**量具自己的错**：表要**按内容挑**不是按位置挑 —— `.pop()` 曾让两条断言测的是同一张表（一条白写）。
> ⑦ ★ **I9：把 10-06 那台"泛化量具"用到这条新功能上**（坑 106 在新功能上原样复发）——
>   `files-open/close` 配的 15 句电池全绿，而另写 **30 句从未进过规则表**的自然说法：
>   首跑 **open 9/18、close 9/12**，又是那个 50% 缺口。缺口的形状很具体，因为**下次还会是这样**：
>   ① 名词侧我写成**字面短语清单**（文件面板/资料面板…），可口语指代一个界面用的是
>     **远指 + 量词**（「把文件那块弄出来」「共享资料那块打开来」「文件那栏」）；
>   ② 动词**倒装到名词后面**（「文件面板亮起来」「文档窗口弹出来」）；
>   ③ 礼貌请求长得像**问句**（「能看下文件清单吗」），而问句守卫整条排在规则之前，把它一起吃掉了。
>   ▸ 修法 = 名词侧改**成分式**〔可选"共享"〕+〔文件|资料|文档|材料〕+〔可选后缀 面板/窗口/列表/清单/那栏/那块/那里〕，
>     动词两侧都收，补完 **open 17/18、close 12/12、反例 0/8**。
>   ▸ ★ 中文的**"能"有两个身份**：「能看下文件清单吗」里它是情态动词（请求），
>     「能力打开白板吗」里它和"力"是一个词（问能力）。把 `能` 直接加进礼貌标记表会把后者也判成请求，
>     所以例外写成 `/^(?:能|能否)(?!力)[^。，,]{0,3}(?:看|打开|…)/`——**句首 + 紧跟一个动作动词**，
>     并用 `(?!力)` 挡住名词化开头（把 `(?!力)` 摘掉，"有意不接"那条断言当场红）。
>   ▸ 三组一起钉进 `test:asr` 的 **FILES_GEN**（每组都有对应变异能打红，218 → **222**）：
>     **泛化组**（新说法必须接住）· **谈论组**（「这个文档讲了什么」「把这份文档发给大家」必须不动界面——
>     把裸名词也算进 `F_THING`，两条反例当场红，证明这条保守边界是**承重**的不是装饰）·
>     **有意不接组**（「共享文件呢」写成语句而不是沉默：漏一次可以重说，错一次要人改回来）。见新坑 **124**。
> ⑧ ★★ **I8：把"真实文件回扫"从一次性动作变成常驻仪表**（`npm run review:office` + `npm run bench:innerhtml`）——
>   这条功能的输入是**用户手里的文件**，而我所有断言的输入都是**我自己写的夹具**。
>   第一次拿本机现成的 25 份真 docx/xlsx/pptx 过渲染内核（只报结构，绝不读内容、绝不落盘），
>   抓到一条**限额作用域**的真缺陷：那条写着"一份文档 16MB"的图片上限，
>   因为 pptx 逐页调用 `collectImages`、计数器是函数内局部变量 ⇒ 实算是"**每页** 16MB"。
>   现场：一份 25 页、media 解压后只有 **7.5MB** 的真 PPT，被渲染成 **61 条 data URL / 40.4MB 的 HTML**。
>   ▸ 我先把动机写错了（"面板一插入就冻住"），为此写了台量具实测：
>     **0.5MB=3ms · 8MB=37ms · 16MB=63ms · 40MB=145ms** —— 字符串插入不是瓶颈，内存与解码才是。
>     于是修完的形状是：**两条账各答一个问题**（decoded=唯一图片解压字节 / emitted=每次引用都算），
>     那份 PPT 变成 21 张图 / **10.7MB** HTML，并且界面上明说"省略了 40 张，下载可看完整"（坑 82）。
>   ▸ 另钉一条不显然的：**"这格式画不了"与"预算不够被裁"不许进同一个计数**
>     （有人把 .emf 改名成 .png 是常态；混了那句"省略了 N 张"就在谎报原因）。
>   ▸ 回扫结果：25 份真文件 **抛错 0 · "成功但文字极少" 0**（那份扫描件确实没有文字层）。
>   见新坑 **125**（限额要问"计数器活在哪一层"）与 **126**（探针猜错数据结构会造出假缺陷，
>   今晚我自己踩了三次：正则 `<w:t[^>]*>` 会吞下 `<w:tbl>`、节点形状我按想象写成 {children,text}）。
> **回归（2026-10-08 凌晨实测，顺序跑，全绿）**：`test:fileview` **234/234** · `test:smoke` **499/499** ·
>   `test:sfu` **270/270** · `test:asr` **222/222**（+4：FILES_GEN 三组）· `test:review` **47/47** ·
>   **`check:all` 20/20 条 · 356 项界面断言**
>   （其中 `check:files` 33 → **45**）· `soak` 带文件流量压缩跑 **PASS**（含目录对账）。
>   新记**坑 121 / 122 / 123 / 124 / 125 / 126**；路线图 I 档 **I1~I5 + I8 + I9 全部 ✅**。
>   ▸ I8 那条"O 组只钉得住我想得到的形状"的判断，被这台仪表正面验证了一次：
>     **真实文件抓到的那条缺陷（限额作用域），不在我写过的任何一条断言里**。
> ⚠️ **仍然需要用户重启 3001 + 浏览器 `?nosw=1` 开一次**（PDF 翻页那条修在 `client.js`，其余在脚本侧）。
> ⚠️ **命令行验不了的两条**：① PDF 在面板里**真的画出来了**（无头插件像素不可靠，见坑 122）；
>   ② 手机窄屏那份面板的**手感**。

> **★ 2026-10-08 凌晨续跑（同一批要求的第三轮：把第 51 步那条新功能的证据打厚，厚到压出两条"做错方向"的缺陷）**
> ——用户指令仍是"完成后按 `后续升级方向.md` 继续升级、先更新文档方向再深化测试"。本轮**不加新功能面**，
> 全部在补"共享文件"这一档自己的证据，而证据一厚，两条用户可感知、零报错的缺陷就压不住了：
> ① ★ **「跟随主讲」那颗按钮按下去干的事是"抢主讲"**（`client.js` 第 51 步，坑 **128**）：
>   跟随关着的时候，我每一次打开/翻页/滚动**照样在往外广播**（`emitFileView` 只有断环守卫、
>   没有跟随守卫），于是"我只想自己翻一翻"变成"全房被我的屏幕拽走"；而再点一下那颗写着
>   「跟随主讲」的按钮，代码写的又是 `emitFileView(true)` = "我宣布接下来由我带大家看"。
>   ▸ **先量红再修**（真浏览器双窗，`check:files` 新增 S 组 6 条）：修前实测
>     B 自由浏览点开另一份 → **A 的画面被换成 B 那一份**；B 点"跟随主讲" → 没跳回主讲（"没跳回来"）；
>     A 侧徽标变成"跟着 某位成员"——而 B 屏幕上什么都没说出来。修后同一批断言全绿
>     （A 停在原处 · B 跳回主讲 · 徽标仍是"你在带着大家看"）。
>   ▸ 修法两条：`emitFileView` 加"不跟随就不发"（**解耦必须双向**）；那颗按钮改调
>     `rejoinPresenterView()`，它复用 `applyRemoteView` 那条正路（面板没开要开 / 同一份只调页码滚动 /
>     主讲关了就别抽走我的屏），不写第二份（坑 47）。本地没见过视角就去问一次权威副本，
>     **不猜"没人带"**（坑 67：读不到 ≠ 读到空）。
> ② ★★ **客户端一条"按句首动词判意图"的启发式，把「打开白板」「打开共享文件面板」整条截走**（坑 **127**，
>   用户那句"AI 操控实体类的功能还是实现的不行"的其中一条真成因）：
>   `sendAiQuestion` 里从 09-19g 就写着 `/^(操作|打开|点击|帮我操作|远程)/` → 命中就发 `ai-op`
>   （C1 远程操作**别人电脑**那条链路）。房间里没有被控端时服务器回一句
>   "先有人共享屏幕并打开「允许远程协助」…"——**白板一个字没动，而那句回话听起来完全正常**。
>   ▸ 为什么 17 项真浏览器电池一条都没抓到：它们的说法全是「把白板打开」「开启实时字幕」「切到宫格」，
>     **没有一条以"打开"开头**（坑 106 原样复发：电池只覆盖我想到过的说法）。
>     把它暴露出来的动作很便宜——给新功能加两条真浏览器用例时，我按**最自然的语序**写了一遍而已。
>   ▸ 修法：判据从"句首动词"换成**"提到哪台机器"×"要做什么动作"**两条各管一半
>     （`AI_OP_CTX_RE` 电脑/桌面/浏览器/记事本/计算器… × `AI_OP_VERB_RE`；另留
>     `AI_OP_EXPLICIT_RE` 给「帮我操作」「远程控制」这种没有别种读法的说法）。
>     房间级开关交回服务器的 `ROOM_ACTION_RULES`（它排在 LLM 之前，与客户端那张表一一对应）。
>   ▸ 防守三层（都在 `test:smoke`，A/B 用旧判据复跑证过可红）：
>     ① 服务器每条 `ROOM_ACTIONS` 的 **cn 名**（AI 自己说出口的那句）不许被截走 →
>       旧判据下红在"打开实时白板 / 打开共享文件面板"两条；② 11 句自然说法不许被截走；
>     ③ **正例必须仍然走 ai-op**（只堵不疏等于把 C1 整条链路弄没，那也是一种静默功能消失）。
>       三条正则**从 client.js 源码里抓**，不在测试里重抄一份（重抄那份漂了就是假绿）。
>   ▸ 顺带一条不对称（记下来免得下次误判）：语音那一轨走 `socket.emit('ai-ask')` 直达服务器，
>     **从来没被这条启发式影响过**——所以"打字说打开白板没反应、喊小明说打开白板有反应"这种怪现象，
>     根因就在这两个入口不一致（坑 47 的又一个形状）。
> ③ **量具两处自我纠错**（都不是产品代码错，但都会把人引向错方向）：
>   ▸ K 组那条"焦点落在行上操作区会显形"第一版报红，读到 `opacity=0` —— `.file-acts` 有
>     `transition: opacity .14s`，而我在 `focus()` 之后**同一个 evaluate 里**取值 = 必然读到起点。
>     改成轮询到停住（上限 2s），判据一个字没动（坑 96/104 **第六次**应验，还是栽在刚写的动效上）。
>   ▸ 冒烟那组"跳回主讲"第一版直接调 `setFilesFollow(true);rejoinPresenterView();`，
>     于是 A/B 变异（把按钮处理器改回 `emitFileView(true)`）只红了结构那条、**行为断言跟着绿**——
>     "按钮里究竟写的哪一行"没人测。桩本来就支持 `dispatch('click')`，改成真点那颗按钮之后
>     同一个变异红 4 条（坑 41/56 家族：**接线必须被断言覆盖**，而绕开入口的断言不算覆盖）。
> ④ ★ **共享文件那块新区域第一次被浅色档扫到**（`check:theme` 25 → **26 项**，`check:all` 因此 369 → **370**）：
>   H4 那次的浮层掀开清单是在第 51 步**之前**写的，所以"文件名那行灰字""类型徽标""表格边框"
>   在浅色档下对比度多少，今天之前**没有任何人量过**。补法两条一起才站得住：
>   ▸ ① 把 `filesOverlay` 加进 `OPEN_OVERLAYS`，而且清单走**生产的 `renderFilesList()`**、
>     文档区走**生产的渲染内核**（`await FV.render(...)` 真产出的那份 HTML）——
>     手写一段示例 markup 量的就是我自己那几行字，跟产品长什么样无关（坑 63）；
>     为此把 `OPEN_OVERLAYS` 改成 async IIFE，两个调用点补 `await`（不 await 就是"扫的时候还没渲染完"）。
>   ▸ ② **覆盖率要点名，不能只数总数**：那块注入外面包着 try/catch（页面没就绪时不许把整条检查弄崩），
>     而"静默没注入"在"≥40 处"这条总量哨兵下**照样全绿**。所以 SWEEP 现在带回 `sigs`，
>     新增一条断言"必须看到 ≥4 个 `file-*`/`fv-*` 签名"。实测：签名 **9 个**、
>     扫描覆盖面 **57 → 68 处**、两档不合格 **0/68**（这次是"量过之后确认干净"，不是"没量过就当没事"）。
>   ▸ 顺带一条写代码时踩到的：这段代码在一个**模板字符串**里 —— 注释里出现反引号会提前终结它，
>     而字符串里的 `\n` 会被外层模板先吃掉变成"字符串中间一个真换行"（要写 `\\n`）。
>     两处都是 `node --check` 抓不到、页面 evaluate 才炸的形状，最后用一个
>     "把生成出来的那段代码 `new Function` 编译一遍"的一次性自检挡在浏览器之前（坑 26 家族的新例子）。
> **回归（2026-10-08 凌晨续跑实测，顺序跑）**：`test:smoke` **514/514**（499 → 514：跟随双向化 10 条

>   + C1 入口红线 5 条，含两条 A/B 证过可红）· **`check:files` 58/58**（45 → 58：键盘入口 3 条 ·
>   跟随中被删文件的反应 4 条 · S 组跟随方向 6 条 + 前提断言）· **`test:room-actions` 21/21**
>   （17 → 21：共享文件面板开/关 · 句首"打开"那条 · 泛化开面板）· `test:fileview` **240/240**
>   （234 → 240：★ O 组的真实形状以前**只走过 zlib 那一轨**——"发出去的那几行代码从没渲染过这些形状"；
>   现在四份形状（vMerge+gridSpan 同表 / 公式有无缓存值 / 备注页 / 普通两页）**两轨逐字一致**，
>   外加两条**内容级正向对照**（浏览器轨也要有 `rowspan="3"`、合并标签只出现一次），
>   挡的是"两轨一致地什么都没渲染"这种假绿）· 服务器与文件层**一行没改**
>   （本轮全部在 `client.js` / `index.html` 那颗按钮的 title / `protocol.js` 口径 / 三个测试脚本）。
> **新记坑 127 / 128 / 129**（见第 7 节；129 是本轮我自己把这份文档写坏两次的记录与恢复路径）。
> ⚠️ **需要用户重启 3001 + 浏览器 `?nosw=1` 开一次**才吃得到这两条修复（都在前端代码里）；
>   版本自检横幅会自己说谁的页面还是旧的。
> ⚠️ **命令行验不了**：真人多窗时"关掉跟随自己翻，别人不动"的**手感**（几何与状态已实证，观感还得人看）。


> **★ 2026-10-09 通宵两档：J 档「共享文件真的能看 Word」+ K 档「跨网做到不同网也能进会」**
> ——用户原话："共享文件浏览的功能还行还没有完善，word 什么的还是不能观看，实现完全而且测试；
> 完善后续升级计划.md 并**按照文档要求升级**；跨网升级方向要升级到**不同网也能进入会议**的地步；跑到明早十点"。
> 本轮全部真跑取证，两条判据性事实写在下面（不是"应该没问题"）。
>
> **J 档 · Word 到底为什么"不能观看"——谜底是两类文件，不是一类**
>
> ① ★ **旧版 .doc/.xls/.ppt 整类被界面判了死刑**（用户机器上 12 份 .doc + 2 份 .xls，一句"这个文件在线看不了"）。
>   那句话**当年成立、现在不成立**：零依赖能读的是 **OLE2/CFB 复合文档外壳 + Word97 piece table +
>   BIFF8 记录流 + PPT97 record 树**，抽得出**文字**（版式/字体/图片/分页不还原，界面上当面说清）。
>   新增 `readCfb / word97Text / xls97Grid(BIFF8：SST+LABELSST+RK+MULRK+FORMULA 缓存值+MergeCells) /
>   ppt97Texts / rtfText / htmlToText`（`sfu/public/fileview.js` 第 10 节，约 480 行）。
>   ▸ **10-05 那批 .doc 里有三类根本不是 OLE2**：`{\rtf1\ansi\ansicpg936`（RTF 存成 .doc，中文要 GBK
>     **成对**解）、HTML 存成 .doc、docx 改名成 .doc → 三个入口都补了（`legacyExtract` 先按真实字节判，
>     这条"只在旧版 Office 这三个扩展名上按魔数改路由"是有意的边界，普通 .txt 仍按扩展名走）。
> ② ★ **现代 docx/xlsx 有四条真缺陷，全部长在"我夹具里没有的形状"上**——把它们逼出来的不是思考，
>   是**换数据源**：`python-docx`/`openpyxl`（另一个实现）写的文件 + **真的 Microsoft Office** 造的
>   legacy 夹具并让它自己报出认到的文字（`scripts/office-oracle.py` / `scripts/legacy-oracle.ps1`，
>   产物进仓库 ⇒ 回归不依赖 python/Office，缺产物直接红而不是静默跳过）。四条：
>   ▸ **编号来自样式**：`List Number` 的编号定义在 styles.xml 的 `w:pPr/w:numPr`，段落只写 `w:pStyle` ——
>     内核只认段落上的 numPr ⇒ **列表的圆点与序号全丢**（列表还在、字也在，就是不像 Word）；
>     补 `loadDocxStyles`（沿 `w:basedOn` 继承 + 环保护 + `numId=0` 是否决不是"没有"）；
>   ▸ **百分比/货币被读错数**：格式码 `0.00%` 存 0.25 → 我们显示 "0.25"，Excel 上是 **25.00%**；
>     `¥#,##0.00` 存 1234.5 → 我们显示 1234.5。**"少一个百分号"不是难看，是两个不同的数**；
>   ▸ **稀疏行被压扁**：xlsx 只在有内容的行写 `<row r="12">`，内核按出现顺序渲染 ⇒ 第 12 行的内容
>     显示在第 6 行的位置（数字对、**位置错**，会上说"看第 12 行"对不上号）；
>   ▸ **合并区域被忽略**（`mergeCells` 与 BIFF8 `MergeCells` 两处都不读）⇒ 合并格不跨列、整行少一格。
>   ▸ 顺带补齐三类"字不在正文流里"的容器：**文本框 `txbxContent`**（原先只画成一个〔图片〕占位）、
>     **域**（`instrText` 指令不许上屏、`fldChar/fldSimple` 的结果必须上屏）、**OMML 公式**（按线性文本给出）。
> ③ **真浏览器证据（这条功能第一次有"第二个人的屏幕"级的 Word 证据）**：`check:files` 58 → **71 项**（带 `REAL_OFFICE_FILE` 那份真文件时 72），
>   新增 8c（python 写的 docx/xlsx + Office 写的 doc/xls 走真上传→真渲染）与 10b
>   （★ A 打开那份 Word 97 的 .doc，**B 的屏幕上出现同样抽出来的文字**）。
>   ▸ 用户真文件也量了（不打印内容）：`D:/期末数模论文….doc` **1312 字上屏**、`实验三-….XLS` 1928 字/2 表、
>     `《数学建模》…docx` 2151 字/2 表、`12.doc` 916 字；`REAL_OFFICE_FILE=<路径> npm run check:files` 是常驻入口。
> ④ **判据覆盖不到的地方结论不许延伸**：`review:office` 原先只扫 docx/xlsx/pptx，"真实样本 0 抛错"
>   这句话从来没覆盖过用户那批 .doc ⇒ 现在纳入旧格式并单列"没能抽出文字"（`--max 20` 实测 20 份 · 抛错 0 · 抽不出 0）。
>
> **K 档 · 跨网：把"要转发一整段端口"改成"要转发一条"，并让局域网与 Tailscale 同时可用**
>
> ① ★ **媒体固定端口（WebRtcServer）**：默认形态是每条 Transport 在 40000-49999 **随机要一对 UDP 端口**，
>   家用路由器的端口映射做不到转整段 ⇒ 这条路实际上是死的。现在
>   `config.rtcServerPort`（`start:lan` 默认写 4443，被占自动往后试 4 个、全占退回随机段并在启动日志说实话）
>   ⇒ **全服务器共用一个号，且 UDP 与 TCP 同号**：端口映射只需一条，
>   "公司/校园网把 UDP 全封"的浏览器还能退到 TCP 候选。实测在 ICE 里成立（见 ④）。
> ② ★ **多地址通告（`announceExtra`，默认 "tailscale"）**：以前 announcedIp 只能一个地址 ⇒
>   "改成 Tailscale IP 才能让外面进来"和"同 WiFi 的同事连不上"是**同一个旋钮的两端**，用户只能选边。
>   现在一条 Transport **同时**通告局域网地址与组网地址（ICE 两条候选，各挑自己可达的那条），
>   `virtual`（VirtualBox/WSL）地址仍然挡在外面（发出去就是给对端一条连不上的候选）。
>   ▸ 本机只有一张 WLAN、也没装 Tailscale ⇒ 用 `ANNOUNCE_EXTRA_IPS=127.0.0.2` 这个明示注入把"多地址真的变成
>     多条候选"做成**可断言**的事（不要求测试机恰好有第二张网卡，也不要求谁去装工具）。
> ③ **两处"无声撒谎"被改对**（判据事实由服务器交出来，工具与文档不去各自猜）：
>   《跨电脑连接-操作指南》"配置已带 openrelay TURN，两台设备在不同 WiFi 也能连"——**对 SFU 不成立**
>   （mediasoup 媒体不走 TURN 中继），已按三条真路重写（Tailscale / 一条固定端口映射 / 云主机）；
>   `doctor` 把 `announcedIp:"auto"` 原样拼进 URL 打印 `https://auto:3443/`（谁也打不开的主机名）——
>   改成解析后的真实地址，并新增 **B1b 媒体端口形态**体检项。`allow-firewall.bat` 补 4443-4446 的 UDP+TCP。
>   ▸ `start-lan.js` 那份自带 IP 选择（无虚拟网卡罚分）删掉，接回 `sfu/nets.js` 同一份判据（坑 47）。
> ④ **新工具**：`npm run test:crossnet`（**17 项全绿**：固定端口挂上 / udp+tcp 两条候选都在且端口号对 /
>   每个通告地址上 TCP 真的 accept / `/config.json` 与 `/metrics` 同源 / 没配时给 warn 的反向对照 /
>   锚行首不被 HELP 行骗）+ 事实测量段（STUN 反射地址 vs 通告地址 ⇒ 直接说"你在 NAT 后，要转的是这一个号"）。
>   `npm run test:stun`（新，**8 项**）= 手搓 STUN 解析器自己的自测（**另一个实现写的解析器测不住真响应**：
>   Google 回的是 8 字节老 MAPPED-ADDRESS，我按 10 字节那种判长度 ⇒ 真响应被读成"没带映射属性"）。
>   实测本机：反射地址（公网出口 IP，不写进文档）≠ 通告 192.168.157.194 ⇒ 报"NAT 后，映射这一个号或走 Tailscale"。
>
> **回归（2026-10-09 实测，顺序跑、一次一个）**：`test:fileview` **292/0**（+52：Q 组真形状 + L 组旧格式，逐条 A/B 证过可红）·
>   `test:nets` **42/0**（+11 K2 判据）· `test:crossnet` **17/0**（新）· `test:stun` **8/0**（新）·
>   `test:smoke` **521/0**（514 + L7 两条浮层上界红线 + L6 一条"报告器必须接守卫" + 4 条守卫单测）· `test:sfu` **270/0** · `test:asr` **222/0(+1skip)** · `test:review` **47/0** ·
>   `test:watch` **54/0** · `test:store` **55/0** · `test:shutdown` **9/0** · Mesh **36/0** ·
>   `test:ai-brain` 75 · `test:tts` 13 · `test:qwen` 10(+1skip) · `test:ai` 10 · `test:publish` 30 ·
>   `test:quiet-mic` **11/0** · `test:room-actions` **21/0** · `test:office` 5 ·
>   **`check:all` 20/20 条 · 388 项界面断言**（`check:theme` 26→**27** 是坑 137 那条前提断言；含 `check:files` **71/0**；L6/L7 全部接完之后**又整批复跑一次，同样 20/20 · 388**（58→71；带 `REAL_OFFICE_FILE` 时 72）与 `check:invite` **12/0**（8→12））·
>   `test:e2e-media` **38/0** · `test:e2e-asr` **25/0** · `test:e2e-reconnect` **15/0** · `test:agent` **24/0** ·
>   `test:e2e` **16/0** · `test:record` PASS · `test:turn` PASS · `doctor` **25 通过/1 警告/0 失败** ·
>   **`test:asr-live` PASS**（默认等到 qwen-local 就位 38s ⇒ 定稿 2 条全部 `fin=silence`、
>   ⏱ 3.1s/3.0s、整句重转**采纳 2/2**（两句逐字全对，含尾字「会」）、应答 1 次不多不少、
>   并发在途峰值 2=上限、首段音频 2.4s）· **`soak --minutes 8` PASS**（专用 3023 + 临时库/FILES_DIR +
>   `ASR_QWEN_LOCAL=0`：8 分钟 · 信令 239 条 · 断线重连 **0** · 归档 POST 8 次 48 条 = 回读 48 条对账一致 ·
>   健康检查 16 次 **0 错误** · rss 54→66MB · 文件：上传 8 / 删除 5 / 对账 8 次不平 0 / 清单广播 13 /
>   视角 8 发→8 收 / 房间销毁后目录 ✅ 已删）。
>   ▸ **L7 收尾（本批最后一条）**：锚定式 fixed 浮层的**高度上界**写成冒烟结构红线（豁免整屏层 / 上下双锚 /
>     `pointer-events:none` 装饰层 / 1px 隐形件，**按选择器聚合**判），当场补掉 `.remote-ask` 与 `.toast` 两处缺上界；
>     两条各 A/B 证过可红（摘上界 ⇒ 点名 `.invite-panel`；把扫描正则改盲 ⇒ 覆盖面哨兵红"扫到 0 个"）⇒ 冒烟因此 **521/521**。
>   ▸ `test:voice-longrun` 也跑通了：**7/7**（5 分钟 · 定稿 **39 条** · 最大字幕间隔 12s · 0 崩溃 0 永久放弃 ·
>     AI 应答 **27** · 最快定稿 **1.7s**）——"识别一段时间就停"这条主线第一次有**当天**的长跑证据。
>   ▸ **L2 自走版**：`check:files` 除了单文件还能吃整个文件夹（`REAL_OFFICE_DIR=<目录>`，默认 8 份）——
>     本机真实语料 8 份真 .xlsx **0 白屏**；判据只判"每一份都走到**有内容**或**明确说不行**"，
>     **不写死内容**（坑 91），扫不到文件时打 SKIP 不打"通过"（坑 105）。
>   ▸ **L6-lite（测试基建债还掉一半）**：`scripts/assert-order-guard.js` 给两种 `ok()` 约定各装一个
>     "顺序写反就当场红"的守卫，接到 **12 个测试文件**；接的过程中扫描**自己发现**
>     `test-publish.js` / `test-shutdown.js` 也是 cond-first（我原以为只有 `test-watch` 一种例外——
>     坑 106 在测试基建上原样复发）。另加两条常驻防守：冒烟结构红线"每台会打 PASS 的报告器都要接守卫"
>     （扫到 15 个）+ **守卫自己的 4 条单测**（含"正确写法不许误伤"的反例——会误伤的守卫会被下一个人删掉）。
>   ▸ 同批还修掉一条**当天自己写出来的量具假红**：`check:files` 的图片那条轮的是"img 出现了"而断言是
>     "`naturalWidth>0`"——解码本来就异步 ⇒ 同一套件第四次跑出红（第一次是运气）。修法是把**轮询条件写成断言条件**
>     （坑 120 第七次应验），改完连跑两次 71/71；"跑了三次都过"不是稳定性证据，三次只是三次抽样。
>   每条新判据都做了 A/B 变异证红（wIdent 记错 / SST 表头按 2 字节读 / 不读 piece table / 不读 mergeCells /
>   RTF 的 GBK 不攒批 / 忘了 await 魔数判据 / 删掉签名闸 / 两条文案各改一条 ⇒ 只有对应那条红 /
>   浮层摘掉高度上界 ⇒ 矮窗口那条红 / `overflow-y:hidden` ⇒ 真滚轮那条红）。
> **新记坑 130 / 131 / 132 / 133 / 134 / 135 / 136**（见第 7 节；130 是本轮最值钱的一条：**自己写的夹具测的是记忆不是能力**；
>   135 是**唯一那条用户可感知**的界面缺陷：矮窗口里邀请面板把"可复制的修复命令"顶出屏幕）。
> ⚠️ **需要用户重启 3001 + 浏览器 `?nosw=1` 开一次**才吃得到（服务器与前端都改了；重启后启动日志会打印
>   "媒体走固定端口 UDP+TCP 4443"与"媒体通告地址"两行——这两行就是本次改动生效的凭据）。
> ⚠️ **命令行验不了的两条**：① 真·第二张网（手机热点/Tailscale 对端）进会看到画面——本轮把"该转几条端口"
>   从一整段降到一条，但"对方是否真能连到这一个号"必须有一台外面的设备；② 用户那份带图表/母版的真 PPT
>   在线看**顺不顺眼**（能渲染文字与表格已被证明，观感还得人看）。


---

> **★ 2026-10-09 语音这条线第一次有"准确率"这把尺（此前只有延迟有尺）+ 真人金标准录制链路**
> ——用户："把语音这条线实现完全，先定计划然后把目前的问题实现完全"。计划第一条就是**先造尺再动刀**：
> 路线图 H3 那句"词级天花板**等用户拍板**"之所以拍不了，是因为三条路（云端 / 更大模型 / 靠近麦克风）
> 没有任何一张可比表；而所有自动化证据都来自合成语音——合成语音每句都写着「小明」（结构上测不出
> 误唤醒），电平节奏也不是真人的。本轮四块落地，全部真跑取证：
> ① **`sfu/ai/accuracy.js`（新，零依赖纯函数）= 准确率唯一口径**：中文按字、拉丁数字按词切 token，
>   标点空白不参与比对，**数字默认不折算**（「十号」≠「10号」判错——量准确率不许借用 `normAsrText`
>   那套"判意图"的归一化，否则等于用尺子的刻度去改被测物；要比较两种口径就显式 `foldDigits`，
>   且口径记在结果里、`diff()` 遇到口径不同直接拒比）。输出 micro（总编辑距离/总字数）与
>   macro（逐句均值）**两个数**——只报一个就会漂移；空转写判 100% 而不是 0%，期望为空判"不可比"
>   而不进任何均值，样本 <5 判 `enough:false`（坑 105：没证据不许报通过）。
> ② **`npm run bench:asr-golden`（新）= 引擎 × 距离 × 增益的对照跑法**：跑引擎之前先自证量具
>   （ref≈ref 必须 0% / 空转写必须 100% / 空期望必须不可比 / 一字之差必须 sub=1），尺坏了立刻退出；
>   合成一律走 `voice-fixture.js` 那一个 `makeSpeechWav`（不再抄第二份 TTS）；增益走
>   `Asr.modelGainDb`（**复现生产真正喂给模型的那份音频**，不是另调一个音量）；跳过必须说话
>   （显存不够 / 没装 whisper / 没配 key 都打印 SKIP 并计入"未测"，不当成通过）；
>   明细落 `sfu/logs/golden-*.json`，`--compare=<file>` 用同一个口径出"改动前后"差值。
>   **首张表（合成场，10 句 ×2 档，micro CER）**：`qwen-local(cuda)` **2.8%**（全对 9/10）
>   vs `whisper-small` **4.9%**（全对 5/10）；`坐远（-58 dBFS → 增益钳在 +40 → 模型输入 -18.1）`
>   两档**读数没变差**——但这句结论有限定：far 档只是把同一份干净语音整体调小，
>   **房间噪声与混响没跟着进来**，所以它不能外推成"真人坐远会怎样"（表里自己这么写）。
>   whisper 的两个病灶当场可见：「负载」→「附在」（真词错）、「十月十号」→「10月10号」
>   （写法差异，折算口径下 4.9% → 3.5%，差 1.4 个百分点——"人听懂了但字面匹配会踩"第一次被量化）。
> ③ **`sfu/golden.js` + `/golden` 录制页 + `npm run check:golden`（新，真浏览器 11 项）= 真人场入口**：
>   逐句念 + 两档距离（正常/坐远），MediaRecorder → raw body POST → ffmpeg 转 16k/mono/s16le →
>   `sfu/voice-golden/manifest.jsonl`。句子清单**只有 `sfu/golden.js` 一份**（录制页与跑表两个读者共用，
>   抄两份就会出现"录的是 A 批、跑的是 B 批"，两表不可比）；门禁走 `requireAdmin`（它与房间无关，
>   `requireRoomAccess` 的签名强制要 6 位房号，硬套只会必然 401）；回包里的 `peakDb` 出自
>   **生产能量闸那一个 `Asr.measureWavLevel`** ⇒ "这句在会议里会不会被当静音删掉"录当场就看得见；
>   整目录进 `.gitignore`（本人语音 + 句子原文不该入库）；`GOLDEN_DIR` env 可整体搬到临时目录，
>   检查末尾自证"真实目录没被创建"（与账号类测试必须用临时库同一条纪律）。
>   **真浏览器跑出来 11/11**：未登录诚实空态 / 版本指纹 / 10 行清单逐行带"为什么是这句" /
>   两档按钮与 aria-pressed / 真点录→停→页面报"已存 + 峰值 -7.4 dBFS" / 磁盘 wav 实测 16000Hz 单声道
>   16bit / 页面峰值 == 磁盘峰值（±0.2）/ 同句重录只留一条 / 隔离自证。
> ④ **顺手收口与一条播报缺陷**：模型输入增益的算式原来在 server.js **内联两遍**
>   → 收成 `Asr.modelGainDb()` 一处（+ `gainTargetDb()/gainCapDb()`，日志那句"→ -8 dBFS"也跟着改口，
>   env `ASR_GAIN_TARGET_DB/ASR_GAIN_CAP_DB` 可覆）；并补**触发计数** `COLLAB.gainApplied`
>   → `/metrics sfu_ai_asr_gain_applied_total` + `/api/rooms` 的 `collab.gainApplied`
>   （分子恒 0 而 `input.voiced` 在涨 = 10-05 那条"安静麦克风的救赎"整条没跑——它上线时无人能证明它跑过）；
>   Qwen 模型目录的判据原来**只有 server.js 知道**，独立脚本起 worker 就 `boot()` 无声返回 false
>   → 搬成 `QwenLocalAsr.resolveModelDir()`，server / bench-asr-multi / test-qwen 三处抄本全接回去；
>   能量闸阈值同理收成 `asrMinPeakDb()`（录制页要读同一个数，不许再写一遍 -62）。
>   **播报那条**：流水线原来按 `aiTtsMaxChars` 把超预算的句子 `slice(0, room)` **拦腰截断**——
>   用户听到的"话说一半然后没声"就是这么来的。改成 **首句永远整句念、后续放不下就整句不念**，
>   并同步在生成侧给语音问答那一路加 `spoken` 形状约束（结论压进第一句、别超 60 字、不写路径与
>   markdown；@ai 打字那一轨不传——它只进气泡）。只改切法治不了根，只改 prompt 不保险，**两侧一起**。
> **回归（2026-10-09 实测，顺序跑）**：`test:asr` **250 通过/0 失败/1 跳过**（新增 ⑬ 组 27 条：
>   尺的正反向对照、micro/macro、样本门槛、零样本不印 0%、口径拒比、四条接线红线、增益算术 4 条、
>   播报形状 3 条）· `test:sfu` **282 通过/0 失败**（+11：/api/golden 门禁·清单·上传转码·峰值同源·
>   列表对账·重录去重·路径穿越·缺文本·0 字节·隔离自证；+1：gain 触发账锚行首）·
>   `test:smoke` **521/521** · `review` 自检 47 · `nets` 42 · `watch` 54 · `store` 55 · `tts` 13 ·
>   `shutdown` 9 · `ai-brain` **75**（brain.js 加了 systemExtra 钩子后复跑）· `check:golden` **11/11**（新）·
>   `bench:asr-golden` 出表；`check:all` 结果见本节末（同批复跑）。
> **新记坑 138 / 139 / 140**（见第 7 节；138 是我自己写的量具造出的两个假原因，
>   139 是"外部 API 的能力要当场探、响应要读对字段"，140 是重录路径删掉了刚写的新文件）。
> ⚠️ **需要用户重启 3001 + 浏览器 `?nosw=1` 开一次**（增益收口 / 触发账 / asrMinPeakDb / spoken 形状约束 /
>   `/golden` 页面与两个新端点全在服务器进程里）；重启后访问 `/golden` 录 20 句（两档各 10 句），
>   再跑 `npm run bench:asr-golden`——**那张真人场的表才是 H3 该看的**。
> ⚠️ **仍未解决**：词级准确率的真人分布（这张表会给）、云端那一列（`.env` 只有 `DEEPSEEK_API_KEY`，
>   识别要的是 **DashScope 阿里那把**，两码事；且它会把会议音频送出外网，等用户点头）、
>   H8b 底噪估计偏高、H1b 流式 ASR。改动全部未提交。

> **★ 2026-10-09 第二批（用户一句话点出三个缺口）：退出登录终于有反面、忘记密码不编邮件、管理员的实质区别第一次可见**
> ——用户："已经录好真人声音了 还有我发现**没有退出登录的效果**和**忘记密码的效果** 还有**管理员没有实质的区别**"。
> 三条都不是"少一颗按钮"，审计定位到的根因各有形状：
> ① **登录卡的开合是单向的**：全文件只有 `hideAuth()`，`remove('hidden')` 只出现在"设备码面板返回"那两条
>   误打误撞的路径上 ⇒ 登录后**没有任何路径能回到登录卡**：换不了账号、登不出来、票过期了界面也什么都不做
>   （那句"请重新登录"只往折叠的流程日志里写一行 = 等于没写）。
> ② **登录态散在四个落点**（localStorage 的 `wb_auth`、模块级昵称、头像、每小时一次的续期定时器），
>   彼此**没有一条统一的撤销路径**——所以缺的是"登录这件事的反面"，不是按钮。
>   ▸ 修法收成唯一入口 `clearAuthState(why)`（四个落点一次清完）+ `doLogout()`；
>   **两条路径（连着 / 没连着）共用同一个 finish()**：第一版把 toast 与面板提示只写在有网那一路，
>   断网时点退出界面悄悄回到"未登录"却一句反馈都没有——被冒烟逼出来（桩没有 `socket.connected`
>   = 那条分支永久不测，**坑 83 原样复发**；补上这个布尔之后白板信令 `board-signal` 也第一次被跑到）。
> ③ **服务器那半边压根没有"撤销"**：`bindIdentity` 只进不出，聊天广播的署名取自 `socket.displayName`，
>   成员投影的 role 也取自它 ⇒ 客户端退回游客、服务器仍按老身份放行录制与删除 = **两边各说各话**。
>   新增 `dropIdentity(why)` 作唯一收口，两个调用点：`auth-logout` 与 **`auth-refresh` 判失败**（配对的半边）。
>   ▸ `auth-logout` 的守卫按"这张票是不是本连接自己的"判：**传别人的票进来直接拒绝、零副作用**——
>     否则"退出登录"就是一个把管理员踢下线的 DoS 入口；被拒的请求不许顺手把自己也退了。
>   ▸ 有意保留的语义差（写进 protocol.js 与测试名里）：**不带票的退出只退这条连接，不废票**；
>     带自己的票才作废它（作废后连 `auth-verify` 都过不了，否则刷新页面就"自己又回来了"）。
> ④ **忘记密码不许演**：本项目零依赖、可完全离线，没有邮件/短信通道。
>   所以那句提示给的是两条**照着就能做**的路（本机跑 `npm run admin:passwd -- <用户名>` / 找部署那台机器的管理员），
>   并钉一条反向对照：不许出现"已发送 / 请查收 / 重置链接已发"（那会让人去查一个不存在的邮箱，坑 82）。
>   ▸ 点它**不发任何信令**：找回是本地/线下动作，做假动作等于骗界面在忙。
> ⑤ ★★ **管理员的实质区别此前只存在于文档里**：admin 独占的是四个 HTTP 端点
>   （`/dashboard` 观测面板、`/recordings.html` 录像、`/golden` 金标准、`/metrics`），普通成员打开是 401——
>   而界面上 admin 与 owner 一模一样（会中权限本来就该相等：踢人与删文件都是 owner-or-admin）。
>   所以修法是**把差别说出来**，不是新造特权：顶栏身份牌（未登录/成员/房主/平台管理员四档文案）
>   + 账号面板（我是谁 / 退出 / 治理台四链接，**治理台只随服务器投影的 role 出现**）。
>   ▸ 顺手把 `check:theme` 的浮层清单补上这块（默认收起的新区域，不点名就等于没量过）。
> ⑥ **口令判据三处收口**（注册网页 / `admin:adduser` / `admin:passwd` 原先各写一份）：
>   `sfu/password.js` 新增 `strengthError()`，CLI 与服务器共用；`/config.json` 下发 `passwordMinLen`，
>   网页那条提示里的数字来自它（**界面不许硬编码一个可能和配置不符的数**）。
> ▎**真人金标准这一批真的录上了**（用户录完 20 句）：`bench:asr-golden` 的真人场表见本节末回归块，
>   它把 H3 那句"词级天花板等用户拍板"从猜测变成看表——**真人场与合成场的差距是引擎层级的，不是阈值层级的**。
> ★ **这一批我自己制造并被断言抓走的三次事故**（都升级成常驻判据，都记进第 7 节）：
>   ▸ **坑 141**：HTML 注释的最后一行用 CSS 的收尾序列（星号斜杠）写 ⇒ `<!--` 永不闭合，
>     「忘记密码」按钮与 `#authMsg` 一起被吞进注释，页面后半屏几何全 0，
>     **`node --check` 与冒烟一条都不红**，红的是 check:login 那条"11 个 id 一个没丢"。
>     补两条静态判据：id 契约（只算注释之外的内容）+ HTML 注释里不许出现那个序列（实测 105 条注释 0 误伤）。
>   ▸ **坑 142**：给 check-theme 的注入代码模板写注释时用反引号包类名 ⇒ 模板被提前截断，
>     `node --check` 全过（错在拼出来的字符串），页面里炸 ReferenceError，那条检查 **0 条断言就跑完**。
>     试过一版全仓静态红线扫 40+ 个 js，报 17 处**全是误伤**（要区分就得连正则字面量一起解析）——
>     撤下，换成精确的那把尺：`scripts/inject-check.js` 一处实现，12 个拼代码的 check 脚本各接一行，
>     守卫自己也有两条单测（含"合法代码不许误伤"那条反例——会误伤的守卫会被下一个人直接删掉）。
>   ▸ **坑 143**：两条判据在"世界变了"之后变成**永真或永假**：
>     check:golden 的"真实目录没被创建"（用户录完音之后结构上不可能通过）、
>     test:sfu 的 `gDirExistedBefore ? true : …`（目录一旦存在就什么都不证）。
>     真问题从来是"我这批测试 id 有没有混进用户语料"——判据改成按 id 查，既诚实也不会与并行录音冲突。
> **回归（2026-10-09 第二批实测，顺序跑）**：`test:smoke` **558/558**（+37：第 52 步 33 条行为与接线、
>   inject-check 自测 2 条、HTML 两条结构红线）· `test:sfu` **298/298**（+16 第 52 步服务器那半边：
>   票作废 / DoS 拒绝且零副作用 / 广播署名退掉 / 续期失败同步撤身份 / verify 重绑 / 隔离按 id 查）·
>   两条 A/B 用旧写法与变异证过可红（摘掉 `dropIdentity('refresh-expired')` → 精准红在"续期失败也撤身份"；
>   摘掉票归属守卫 → 红在 DoS 那条并连带 4 条下游）· **`check:all` 21/21 条 · 403 项界面断言**（HTML 那处修好后整批复跑；`check:golden` 12 通过 / 0 失败）· `test:asr` 252 · `check:login` 13。
> ⚠️ **需要用户重启 3001 + 浏览器 `?nosw=1` 开一次**：`dropIdentity`/`auth-logout`/续期配对撤销、
>   `passwordMinLen` 下发都在服务器进程里；身份牌、账号面板、忘记密码那句提示在 `client.js` 与 `index.html` 里。
> ⚠️ **命令行验不了**：真机上顶栏那颗身份牌在窄屏的观感、以及"退出去 dashboard 也退出了"的跨页体感
>   （localStorage 已清是硬证据，手感还得人看）。**会中权限没动**：owner 与 admin 在会议里依旧平等，
>   要不要给 admin 加"跨房巡检/强制下线"这类真特权是产品决策，等用户点头。


> **★ 2026-10-10 通宵五批（两条口头结论结案 / 准确率第一次被文本侧买回点数 / "只有正向没有反向"全仓审计 / 真实文件回扫扩面 / 长跑四条全绿）**
> ——用户上一条指令仍是"生成一个到早上十点的升级方案"，方案落在 `后续升级方向.md` **0.11**（B1~B8 逐批时段 + 红了怎么办 + 贯穿止损规则），执行结果同文件回填。
> ① **H2「RMS 的~4KB 成块交付」结案**（B1）：这次不是打勾，是把它变成**常驻仪表**——服务器每代录音进程
>   记 `firstMs/afterFirstByteMs/gapMaxMs/bytesMax` + 退出时写一条 `asr-rms-arrival` 事件，`/metrics` 四格，
>   `watch.js` 三条告警，`review:meeting` 一行结论（**样本 <3 报 ❔ 不报"没问题"**，坑 105）。
>   真 RTP 实测：第一条 RMS **995ms**、最大空档 315ms、单次事件最大 959B（远低于 4KB）⇒ **逐行交付**，那条假设不成立。
>   ▸ 中途两个自己的错都留在代码注释里：`firstMs` 混着"等人开口"（同一套代码 995ms 与 20230ms 都出现，
>     因为人两秒后才说话）⇒ 判慢的口径迁到 `afterFirstByteMs`；`bytes_max` 判线一开始写 2048，
>     而实测**正常突发就是 2018B** ⇒ 那条会天天误报，判线按这条线自己声称的那个数（4096）。
>   ▸ ★ **结案过程中抓到一条真的生产缺陷（坑 144）**：`watch.js` 的取值正则**没锚行首**，
>     而 `# HELP …primary_ready 1 when…` 里就含"名字 + 空格 + 1" ⇒ 预热期分诊从上线那天起**恒判"引擎已就绪"**，
>     兜底退回告警永远不响。当年坑 74 立了纪律却只修了测试脚本 = 半迁移（坑 57）。
> ② **H8b「底噪估计排除 −99 纯静音 ⇒ floor 偏高」结案**（B2）：新量具 `npm run bench:voice-floor`
>   用**生产那条 astats 链**把 20 份真人录音变成 0.512s RMS 序列，喂**生产那一个** `createVoiceTracker`
>   （生效参数从 `tracker.params` 读，不再抄第二份 −80）。跑 `silentDb` = −80/−120/−70 三档：
>   floor、阈值、命中**一字不差**（差 +0.0dB，被排除的窗近档 6%、远档 0%）⇒ 这条排除规则在这批数据上量不到影响，
>   **所以一行生产阈值都没动**。同时量到更要紧的一件事：这个人停下来之后**房间并不安静**
>   （近档最差那份的末尾窗 RMS 中位 **−36.8 dBFS**，阈值 −54.6）⇒ "有多少窗被判有声"量的是**房间可分性**，
>   不是判据好坏；做成了 `review:meeting` 的「房间可分性」一行（G3 四条自检）。度量改名叫「尾窗判有声」
>   （原名"尾静音误判"把结论写进了测量里，坑 146）。
> ③ **准确率第一次被文本侧买回点数**（B3）：新纯函数 `Asr.foldTailEcho`——句尾那段"把刚说完的短语复读一遍"
>   的回声折叠（三判据同时成立：句末标点分隔 / 回声是前句结尾的**真后缀**且前句严格更长 / 回声 ≥3 字），
>   接进 `cleanTranscript` 唯一入口 + 触发账 `sfu_ai_asr_tail_echo_fold_total`。
>   真人金标准实测：**far 档 5.6% → 3.5%（买到 2.1 个百分点）、near 4.2% 不变**。
>   ▸ 两字回声**有意不折**（「我同意。同意。」是人在强调）——这条下限是被真数据逼出来的：
>     真人账本 1196 句里 2 字复读 16 对 vs 真误转 0 对 ⇒ 2 字太便宜（**"宁可漏修"在这里有价格，而且量出来了**）。
>   ▸ **第二刀（数字写法归一）用测量取消了**：先量收益——"同一句两种写法都有"= 0 句、
>     "同人 25s 内只差写法的一对"（会造重复字幕/去重失效）= **0 对** ⇒ 这条买不到东西，就不写这段代码
>     （多一条判据就多一处会漂移的地方）。
>   ▸ ★ 真正的大收获是**量具自己的口径错**：`bench:asr-golden` 之前打的是**模型原样**文本，
>     而落账/上屏的是过完 `cleanTranscript` 的那份 ⇒ **任何文本侧改动在这张表上都是零收益**，
>     "改了没变化"会把人推向"那就换模型"这个错方向。现在两列都打（`microRaw`/`micro`），
>     基线口径不同时报"清洗买到几个点"而**不报跨口径差值**。
> ④ **"只有正向没有反向"全仓审计**（B4）：服务器四处（发言账断开时删自己 / 数据通道订阅真的 close+delete /
>   房间销毁走 `clearRemoteCtl` 收口 + 新增 `stopRoomRecordings` / 登录票补清扫器 + `unref()`），
>   客户端三处（房间作废时销掉待回落朗读账 / 本地黑名单补「解禁」 / 每路音量账加上限并把"换场会还认得"
>   那句过期声明改口），另清掉一行**全仓库零读者**的 `sfuLastRoom`。
>   新 `/metrics` 的 `sfu_auth_tokens` + `/api/rooms` 的 `talkEntries`/`dataConsumerCount`：**先把条数交出来，撤销才能被断言**。
>   ▸ 两条审计结论**先证伪没动手**：`destroyRoom` 裸删在现存三条路径下都先走了 disconnect 的收口 ⇒ 不是活缺陷
>     （但红线照装，它防的是下一个调用点）；`THEME_KEY 写了没人读` 那条是假的（三个页面都读）。
>   ▸ ★ 本轮我自己造的最贵一个假故障（坑 145）：新写的 `/api/rooms` 助手把 Authorization 的值写成占位串 `'***'`，
>     于是四轮 401，而我依次怀疑的是"票被删 / TTL 被改短 / 请求写法 / 端口上有旧实例"——**全都错**。
>     让它一步断掉的是给失败信息加了**"我发的 token 前缀"** + **401 页里那句"为什么"**；
>     并补了一条全仓红线"Authorization 的值必须以 `Bearer ` 开头"（落地前先量误伤面：19 处 0 误伤，所以配当硬红线）。
> ⑤ **真实文件回扫扩面**（B5）：273 份真实 Office 文件重扫，修完分类后的诚实数字
>   **内核抛错 0 · 输入坏了 1（那份不是合法 ZIP）· 可疑 0 · 以图为主 11**。
>   `review:office` 的"文字极少"那栏原来对所有命中者都给一句"可能是内核漏了某类容器"，而真实 11 份里
>   **10 份是截图作业**；把它证伪的是一次普查（同一份文件 `w:t` vs `a:t` 字数：本机 77 份候选里
>   "字全住在 DrawingML"= **0 份**），负结果写进判据注释。**仪表给的原因比它报的数字更贵**（坑 147）。
>   ▸ 深嵌套：新夹具 `makeDocx({nested:true})`（表里套表、再用 `w:sdt` 套第三层）——这条形状以前只在脑子里成立过。
>     `test:fileview` +10 条，而变异实验给出一条值得记的判据：把单元格改成"只取第一个段落"后
>     **"两轨逐字一致"那条照样绿**（两边一致地丢内层表），红的只有内容级那几条 ⇒ **一致性 ≠ 正确性**。
>     `review:office --selftest` 5 → **10 条**（含"深度量具必须能读出 1"：第一版用 `<td><table` 找嵌套，
>     而内核首行渲染成 `<th>`，正则读不到真实嵌套）。
> ⑥ **长跑与真浏览器四条全绿**（B6）：`test:asr-live` PASS×2（定稿全 `silence`、⏱ 3.0~3.2s、重转逐字全对）·
>   **`test:e2e-asr` 26 项 / 0 项失败** · **`test:voice-longrun` 7/7**（5 分钟 38 条定稿、分布 `{silence:24,split:14}`、最大间隔 12s）·
>   **`soak --minutes 8` PASS**（信令 239 · 断线 0 · 归档 48=48 · 健康 16 次 0 错误 · rss 57→66MB · 文件对账不平 0 · 房间销毁目录已删）。
>   ▸ ★ 延迟红线 ≤3s 改到 ≤4s 是**量过之后**改的：同场次 A/B ⇒ 重转开 3.0/3.1/3.2s、`ASR_REFINE=0` 2.5/2.6s
>     ⇒ 重转净成本 ≈0.5s；而 10-04 那批 1.2~1.5s 既没重转也没有 10-07 的"尾巴段没封口不许定稿"闸
>     （那 1s 是买尾字「会」的）。留在 3s 的结果是每天红一次，而天天误报的告警等于没有告警。
>   ▸ 改这条线时抓到**一条"注释承诺了、代码没实现"的断言**：注释写"中位数口径…一半以上慢必须红"，
>     而代码只比了 `Math.min` ⇒ min 恰好看不见"最快值很好、后面一路变慢"。补上 `med ≤6s`（25 项 → 26 项）。
>   ▸ `npm run soak` 自己也是同一种病：默认端口上没服务器时它**不报错、不退出、心跳只留开头一行**
>     （`reconnection:true` + `create-room` 的 ack 永远不来）。补了"15s 连不上就明确失败、退出码 2"，
>     保留 `reconnection:true`（中途掉线重连正是被测行为）；实测死端口 3s 内退出码 2 + 一句下一步。
> **回归（2026-10-10 实测，顺序跑；全量清单见 0.11 的 B7 行）**：冒烟 **573/573** · 信令 **305/305** ·
>   asr **263 通过/0 失败/1 跳过** · fileview **302** · review 自检 **59** · watch **71** · nets **42** ·
>   files 59 · store 55 · shutdown 9 · `review:office --selftest` **10** · `bench:voice-floor --selftest` **7** ·
>   e2e-asr **26/26** · voice-longrun **7/7** · soak **PASS** · asr-live **PASS×2**。
> **新记坑 144 / 145 / 146 / 147**（见第 7 节）+ **坑 129 第四次应验**（Edit 拿相邻整行当锚点，把 B4 那行成果整行替换掉；
>   靠 `git show HEAD:文件` + 按内容签名恢复 + `git diff --stat` 确认只有 +1 行才算守住）。
> ⚠️ **需要用户重启 3001 + 浏览器 `?nosw=1` 开一次**才吃得到（回声折叠/票清扫/台账暴露都在服务器进程里；
>   「解禁」按钮、音量账上限、房间作废销朗读账在 `client.js` 里）。重启之后 `review:meeting` 里
>   那两行 ❔（RMS 到达 / 房间可分性）才会开始有样本——那是今晚新装的两把尺在真实会议里的第一手数据。
> ⚠️ **仍未解决 / 等用户点头**：词级准确率的**真人分布**要不要往云端靠（DashScope 那把 key 与"会议音频送出外网"）；
>   H1b 流式 ASR（边说边出字）；本地 Qwen TTS 去留；admin 要不要真特权；改动已全部**按批次 commit 但未 push**。

> **★ 2026-10-10 第二批（计划 0.12 前两条：把"进行中没有样本"的仪表修好 + 把定稿延迟里那 1s 买回来）**
> ——方案、时段表与"红了怎么办"都在 `后续升级方向.md` **0.12**；本块只记结果与代价。
> ① **C1：`asr-rms-arrival` 从"散会才有一条"改成"会议进行中就有读数"**（这条尺昨晚才装，
>   而它有个致命形态：只在录音进程**退出时**落一条 ⇒ 正在开的会读不到，`review:meeting` 那行永远 ❔，
>   等于"结案了但没人能复核"）。现在按 `gen`（第几代进程）滚动落账，
>   判据是**实质变化才补一条**（首行出现 / 空档或单次字节涨 ≥25% / 底噪或阈值移动 ≥2dB），
>   外加 ≥60s 的节流——否则每轮询一次就写一行日志，把磁盘当仪表盘（新坑 146 的 sibling）。
>   ▸ 实测（真链路 `test:asr-live`）：**8 代里 7 代未散会即有读数**，`gen`/`live` 字段都在。
>   ▸ 顺手补掉复盘的一个**结构性盲点**：只有事件、没有字幕账本的房间（就是"0 字幕"那种会）
>     **根本不进报告**——最需要被看见的一场会，被"按房间号找账本"的写法筛掉了。
>     现在会枚举这类房间并标 `noLedger`，把"按计数为 0 判好"的那五行降为 ❔ 并写明
>     **"没记录≠没发生"**；而 `听觉进程`（真事件）与 `RMS 到达`（真样本）**不许跟着降**——
>     把有信息的那两行一起噤声不是谨慎，是自我失明。review 自检 59 → **67**。
> ② **C2：定稿延迟从 3.1s 档进到 2.0s 档**（同场次 A/B，干净机器、主引擎就位）：
>   关 `3.3s / 3.1s` → 开 `3.3s / **2.0s**`，第二条句子提前 **1.1s** 定稿，
>   而三条红线一个没变差：**定稿 2 条 / 应答 1 次 / 逐字全对含尾字「会」**。默认开，`ASR_TAIL_RUSH=0` 撤这一个变量。
>   ▸ 这道闸门是 10-07 为「评审会」丢尾字加的（"没被消费的尾巴段不许定稿"），它保住了正确性，
>     代价是把每句都拖到封口之后。本次**不放松它的意图**，而是补上它缺的那半个事实：
>     **抢跑读过的字节也算进整句音频**（`uttTake` 水位 ⇒ 封口段只补余量，同一段不会拼两遍），
>     于是"音频已经齐了"这件事第一次**可判**；放行条件 = 音频覆盖到位（`Asr.tailCoveredByRush` 纯函数）
>     × 这一句真的会做整句重转（重转开着 / 段数够 / worker 不忙）× 这句不只叫了个名字（10-07 插话的正面对冲）。
>   ▸ ★ 三次被**实测**否掉的写法都留在代码注释里（详见坑 148）：
>     "读满当前文件才算覆盖"（文件一直在长 ⇒ 判据永不成立，机制一次不触发）、
>     "抢跑必须转出字才放行"（段边界切片与封口段自己都交回 `text=""`，尾字从来是整句重转救的）、
>     "切片缺段尾收尾点所以补静音"（量具实测：切 0.08s / 切 0.4s / 补 0.25s 假静音，
>     五种切片的转写**一字不差** ⇒ 假设是假的，据此写的"整段重读"那一版全部撤回）。
>   ▸ 观测与判据同步补齐：`COLLAB.tailRush {released, held}` → `/metrics` 两行（锚行首，坑 74）
>     + `/api/rooms` 的 `collab.tailRush` + `review:meeting` 新增「**尾巴抢跑**」一行
>     （**0 次报 ❔ 并给两种解释**："那台服务器还没重启"或"worker 一直忙 ⇒ 这次不会真重转"）；
>     `test:asr` 新增 **⑮ 组 26 条**（7 条纯函数正反例 + 4 条音频账本行为 + 15 条接线/结构红线），
>     其中"抢跑仍只读 delta""整段重读已被否决"这两条是**反向**钉法：
>     谁把那两个被否掉的直觉再实现一遍，断言当场红。
> **回归（本批实测，顺序跑）**：`test:asr` **289 通过/0 失败/1 跳过** · `test:sfu` **307/307**（+2 尾巴抢跑两本账）·
>   `test:smoke` **573/573** · `test:review` **70/70**（+3）· `test:asr-live` **PASS × 4 轮**
>   （off 两轮、on 两轮；on 的那两轮各放行 1 次且延迟 2.0s）·
>   变异验证：把覆盖判据改成恒真 ⇒ 精准红在 ⑮.2/⑮.3 两条反向对照上（改完逐字还原，`diff` 为空才算数）。
> **新记坑 148 / 坑 149**（见第 7 节；149 里还记了一条我差点写进去的**异步版永真断言**
>   ——`ok('…', await (async () => 判据)())`，Promise 是 truthy，判据再假也绿）。
> ⚠️ **需要用户重启 3001** 才吃得到本批（滚动落账、整句音频水位、放行判据、两本触发账全在服务器进程里）。

> **★ 2026-10-10 第三批（计划 0.12 的 C3：AI 第一次听得懂「刚才那个再关回去」，顺手抓出一条"空气泡"老缺陷）**
> ——用户第五次说"AI 操控实体还是实现的不行"，0.11/0.12 把泛化缺口打到 0%，剩下这一块**不是一个动词，是"最近做了什么"这个状态**：
> 「刚才那个」「撤销那一步」「恢复成之前的样子」的宾语不在句子里，规则表再宽也接不住。
> ① **房间级动作栈**：`room.actionStack`（挂在 room 上、上限 8 条、随房间一起销毁——不另开全局 Map 就少一条要记得清的账，坑 20 的根治法），
>   在 `applyRoomAction` 里 push。**零新信令**：撤销被解析成这张表里的另一个 action（逆操作），
>   仍走同一条 `room-control` 广播，客户端一个字都没改。
> ② **意图分三层，顺序就是语义**：强撤销词（撤销/关回去/算我没说/undo）> 重复词（再来一遍/重新打开）> 光杆关闭词（关掉/收起/隐藏）。
>   ▸ 为什么"重复"必须排在"光杆关闭"之前判：「把刚才那个重新打开」里的"打开"既是开启也是重复短语的一部分，
>     先判关闭就会做成"关掉刚才那个"——**做错方向比不做更糟**（10-06「别切宫格，把白板打开」同一条教训的第三种说法）。
>   ▸ 泛化电池仍按坑 106 的量法：**先让电池把红打出来再补**——第一跑 20 句只接住 14 句（70%），缺的六种形状
>     （「回到刚才那样」「刚才开的那个帮我关掉」「undo 刚才那个」「刚才那个算我没说」…）逐条补上来 → 20/20。
>   ▸ ★ 两条**我自己想错**的语义（都升级成常驻断言）：① "一族可以同时被撤出两个相反动作"——栈里"开字幕→关字幕"
>     这两步被解成 `[关, 开]`，物理上根本不可能同时成立 ⇒ 改成**一族只认最近一条**；
>     ② 回话里"撤的是哪一件"原先按 `indexOf` 配对，一旦去重就错配成"撤回刚才的「开启字幕」"其实撤的是白板
>     ⇒ `actions/targets` 改为由同一份 `items` 派生。
>   ▸ 不可逆的两条（`board-clear` / `board-undo`）**整条不做并给出理由**（「白板上的笔迹已经没了」）；
>     栈是空的就说"人手动点的按钮服务器看不见"——不许沉默，也不许交给 LLM 编一句漂亮话（坑 124）。
> ③ ★ **顺手抓到一条从 10-06 就在的空气缺陷（新坑 150）**：为了验回指的回话，我在真浏览器里加了三条文本断言，
>   三条**全红**——查下去不是回指的错：`@ai 把白板打开` 这类**规则直答、不经 LLM**的路由一个 `ai-stream` 增量都不发，
>   而客户端看到 `done` 就把随后同 `streamId` 的 `chat-message` 当重复丢掉 ⇒ 聊天里是一条**只有意图徽标的空气泡**。
>   文字并没有丢（`ai-state` 的 speaking 帧带着全文，AI 格子的逐字字幕是有的），缺的是**聊天台账**（导出/回看/晚进房补帧都靠它）。
>   ▸ 修法在服务端把全文补成一次增量（`streamFillText`，@ai 与语音**两条路都补**），**不放开客户端去重**——
>     放开就会让流式答案重新出现两条气泡（10-04 那条老账原样复发）。两侧各一条断言钉住（含"去重那行还在"的反向对照）。
>   ▸ 为什么 21 项真浏览器用例 + 6 条信令断言都没抓到：它们断的是 `room-control` 到了、`chat-message` 的**载荷**有字——
>     载荷一直是对的，坏的是**渲染契约**。**服务端断言测不到客户端显示什么**（坑 63 家族的新例子）。
> ④ 徽标露出内部 id「🎯 room-undo」也是同一次截图逮到的：客户端那张意图文案表缺两个键 ⇒ 补上，
>   并加一条冒烟结构红线"服务器每个 `intent:` 枚举在客户端都要有人话文案"（跨运行时做不到单一来源就用断言钉，同三张唤醒表那条）。
> **观测**：`COLLAB.roomUndo {done, refused}` → `/metrics` 两行（锚行首）+ `/api/rooms` 同源 +
>   `review:meeting` 的「AI 操控实体」那一行多两个数。**为什么连拒做也要数**：回指有两种正确的"没做"
>   （不可逆 / 栈是空的），没有这一格，用户报"我说刚才那个它没反应"时报告里只有"下达 0 次"，分不出是哪种。
> **回归（本批实测，顺序跑）**：`test:asr` **312 通过/0 失败/1 跳过**（新增 ⑯ 组 23 条：泛化 20 句、方向 3 类、
>   不可逆/空栈、两条"我自己想错"的反例、11 条接线红线）· `test:sfu` **308/308**（+2：流里补全文 + 撤销两本账）·
>   `test:smoke` **575/575**（+2：意图文案表同步 + 兜底不许露空）· `test:review` **73/73**（+3）·
>   **`test:room-actions` 31 项 / 0 项失败**（取反真的把字幕开回来 · 重复保持不动 · 不可逆界面不动且回话点名理由）·
>   两次变异各自证过可红（摘掉"一族只认最近一条"→ ⑯.11/⑯.11b 红；摘掉笔迹让路 → ⑯.7 红），改完 `diff` 为空。
> **新记坑 150 / 151**（见第 7 节）。
> ⚠️ **需要用户重启 3001 + 浏览器 `?nosw=1` 开一次**：动作栈与补流在服务器进程里，意图徽标文案在 `client.js` 里。
>   边界如实记着：**撤销只覆盖"通过我下达的动作"**，谁手动点的按钮服务器看不见——这句写在回话里，不装作听得懂一切。


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
| 32 | **★ 设备码配对直连 + 真桌面画质档与弱网自适应（09-30，借鉴 billd-desk，仅 SFU 主版本）** | **① 设备码直连**：被控端代理 `desk-register` 拿到一个 6 位设备码（**= 一个私有 `isDesk` 房间的房号**），控制端在登录页「🖥️ 用设备码连接」输码 + 连接口令即可 `desk-connect` 直连——**不用先建房、不用进会议**。两条授权路径：口令=**安全密码** → 服务器直接登记 `remoteCtl`（无人值守，`desk-granted{unattended:true}`）；只匹配连接密码 → 转发 `remote-request` 给代理终端按 y，确认后通用授权处理器发 `desk-granted{unattended:false}`。**核心取舍 = 设备码就是房号**：三道闸门（身份 `isAgent` / 授权在册对 / 体量 ≤900KB+120fps）、16 字节帧编解码、canvas 控制台、手机 Pointer Events **一行不改**全部复用；控制端走 `deskEnterRoom()` **轻量进房**（只 `socket.join` + `room.members.add` + `socket.roomNumber`，不建媒体、不广播成员）。**② 画质档**：`流畅/标准/高清` 三颗（`QUALITY_PRESETS`：q30/6fps/1280×800 · q55/12fps/1600×1000 · q80/20fps/1920×1200），走 `remote-input` 的 `{kind:'quality'}` **老通道新语义**（复用门禁与限流）；代理侧 `applyQuality` → `cdp.setScreencast()` **重开抓屏**（监听器 `_scListenerBound` 防叠加）。**★ 三层帧率分工（本轮最容易设计错的地方）**：策略层=档位定"中枢" `rdTargetFps`；执行层=`rdDecideFps` 闭环只在中枢附近 ±2 微调（实测帧间隔+RTT，经 `remote-quality` 回传）；硬安全层=代理/服务器对**任何**请求钳 2~24。档位 fps 下限必须等于 `RD_FPS_MIN`（曾填 5 → 客户端立刻顶回 6，两来源互相拉扯，表现为"选了流畅但帧率没真降"= 坑 47 家族）。**诚实边界**：设备码只存内存（**代理重启即换码**，billd 的"常用设备/持久化"本轮明确没做）；连接/安全口令在内存里**明文比较**（教学级，HTTPS 自签是传输层兜底）；CDP 只控 Chromium 窗口内部。 | 12 / 13 / 14 | `sfu/server.js`（`deskEnterRoom`/`desk-register`/`desk-connect` + `remote-answer` 的 `isDesk` 补发 + disconnect 的 `agent-offline` 即毁房）、`agent/index.js`（`QUALITY_PRESETS`/`applyQuality`）、`agent/cdp.js`（`setScreencast`）、`sfu/public/client.js`（`RD_PRESETS`/`setRdPreset`/`rdDecideFps`/`doDeskConnect`）、`sfu/public/index.html`（`#deskOverlay` + `.rd-bar` 画质组）、`sfu/protocol.js` 09-30 段；`scripts/{test-sfu-signaling,test-sfu-client-smoke,test-agent}.js`（AGENTS 坑 **61~63**） |
| 33 | **★ 把三条"感觉慢"做成可观测的数字（2026-10-03b/c，client.js 第 37~39 步，仅 SFU 主版本）** | **① 字幕延迟**：定稿 `asr-caption` 带 `latMs`（起点=最后一个判定有声的 RMS 窗，窗长 0.5s → 这个数是**下限**，不虚报更快）与 `stage:{wait,trans}` **拆分**；字幕条 `⏱ X.Xs` 三色读数（≤3s/≤6s/更慢），hover 摊开"等待 vs 转写"+ 近 8 句均值/最慢。**拆分才是可操作信息**——只有一个总数时"慢在等静音判定"与"慢在模型"长得一模一样，而处方完全相反。脏值/缺值保持上次读数，绝不编数。<br>**② 播报延迟**（第 38 步）：锚在 `chat-message(tts:'server')` 到达（文字到齐），终点在 `<audio>` 的 **onplaying**（真的开始播，不是"服务器说它发了"——坑 66 同一条纪律）；读数 `🔊 X.Xs 后开口` 贴在**那条答案自己的气泡**上，插在正文与时间行之间（不混进朗读文本）。新信令 `ai-speech-lat` 是**唯一一条客户端→服务器的观测上报**：自报数字只做区间钳制、不参与任何门禁。<br>**③ 执行回执**（上一轮已埋）：房间动作"发出数 vs 被执行数"的差 = AI 说了没做。<br>**④ 同源三处**：`COLLAB.capLat/speakLat` 一个对象喂 `/metrics`（`{kind=avg|max|last}` + count）、`/api/rooms`、dashboard（共用 `latCell()`，两格不合并——一格讲"谁在转写"、一格讲"多久"）；`watch.js` 加两条退化告警（`WATCH_CAP_LAT_WARN_MS`/`WATCH_SPEAK_LAT_WARN_MS`），并新增 `sfu_ai_asr_primary_ready` 做**预热期分诊**：区分"主引擎还没起来（正确行为，等 N 轮）"与"起来了却不用（真退化，两轮报）"，老服务器**没有这一行**时退回旧判据（"读不到"≠"读到 0"）。<br>**⑤ 进日报与 soak**（第 39 步）：服务器把 `lat` 写进字幕 jsonl（缺字段而不是 0），值守日报新增「链路质量（实测）」一节（均值/P90/最慢/样本数——没有样本数就不许下结论，坑 53）；拼串从点击回调抽成 `buildSentryReport()` 才第一次可断言。`soak` 报告多一行字幕延迟，**没推真音频时如实写"未采到"且不判 FAIL**（假红也伤人）。<br>**⑥ 实测数据链**：字幕 9.2s（兜底未预热）→ 5.3s（预热回归，见坑 71）→ **3.5~4.0s**（qwen-local 就位）；关键路径 ≈ FLUSH(1.2s)+尾段转写(2.2s)；**FLUSH 降到 900ms 反而 9.6s/7.1s**（实测否决，机制写进代码注释）。<br>**诚实边界**：数字来自本机单机与合成语音；播报延迟是**客户端自报**；多人会议下的碎片去重已改为"每人一条锚点"（结构保证跨人不互吞），但 `test:asr-live` 只有一个人说话，**多人路径未被端到端验证**。 | 12 / 27 / 14 | `sfu/server.js`（`bumpLat`/`asrPrimaryReady`/`releaseFallbackAsr`/`ai-speech-lat`/按人锚点）、`sfu/ai/asr.js`（`isFragmentOf`/`isDupOrFragment`）、`sfu/public/client.js` **第 37~39 步**、`index.html`+`style.css`（`.cap-lat`/`.msg-voice-lat`/字幕条手机换行）、`dashboard.html`、`scripts/{watch,test-watch,soak,test-sfu-client-smoke,test-sfu-signaling,test-e2e-media}.js`；`sfu/protocol.js` 语音下行段补全；AGENTS 坑 **71/72** |

| 34 | **★ "真实落地"那一层：版本指纹 + 邀请面板 + 真账本复盘 + 屏幕格模糊衬底（2026-10-06 傍晚到夜里）** | **① 版本自检**（坑 40 的收官）：服务器按**内容哈希**改写 index.html 里 `client.js/style.css/countup.js` 的 `?v=`（mtime+size 作缓存键），并经 `/config.json` 下发 `assetVersions`；页面拿自己**实际加载到的**版本比对，不一致就出「用最新版打开」横幅（保留查询串，会中点它不被踢回首页）。判据保守：老服务器没下发就一声不吭、**一致时不许弹**。实测 `served=advertised=loaded` 三方一致 + 造不一致→出现→恢复→消失。<br>**② 邀请面板（第 47 步）**：点房间号徽标 = 复制局域网那条（老路径不变）**+ 展开面板**把"同一网络/不在同一网络"两条摆在一起各带复制；**没有跨网入口时那一行写明"没有"、复制按钮跟着藏**（假链接比缺失更糟）。顺带把 `tsUrl` 改成**双向赋值**（原来只写有值那一侧 ⇒ 撤了 Tailscale 页面永远留着旧值，那句"没有就藏"是假的）；三处复制合并成唯一 `copyText()`（原先只有徽标写了失败兜底，另两处静默失败）。9 条真浏览器断言里有一对互相印证（"同一趟点击没把它关掉" + "点外面会收起"）。<br>**③ `npm run review:meeting`（新工具 + `test:review` 自检 19 条）**：读 `sfu/captions/*.jsonl` + `sfu/logs/app-*.jsonl` 出真实可用性复盘，**每条结论带样本量**（❔=样本不足，不是通过）。判据复用生产那一个函数（`noiseRiffReason`/`isDupOrFragment`/`normAsrText`）。亮点是**从账本反推参数版本**："N 段峰值在 -62dB 之上却仍被跳过 ⇒ 那场会跑的是旧阈值"——"我改了你怎么还不行"第一次有了不用问人的答案。实测两场用户抱怨的会：283648 → 6 段安静语音被旧闸误删；868127 → 1 条求赞话术幻觉入账本。<br>**④ 屏幕格模糊衬底（第 48 步）**：`contain` 一定留边而死黑边读起来像"贴图坏了" ⇒ 同帧放大模糊垫底（第二个 `<video>` 共用同一条 MediaStream：解码只有一份，模糊/缩放全在合成器做）。A/B 像素实验：黑边亮度 **13→105 / 13→72**，内容区 143 vs 146 不变。<br>**⑤ 再移植两个 reactbits（style.css 第 39 节）**：ShinyText 给「加入一场会议」、BorderGlow 给**会超时的授权卡**（`@property --ac-angle` 是命门——不注册则动画"在跑"而角度不插值）。实测角度 0deg→141.66deg、只暂停这条动画时环带峰值 418→0 / 热点 682→0。<br>**诚实边界**：~~`review:meeting` 不区分真人场与自测场~~（**2026-10-06 深夜已能区分**，见行 35 的 ⑧；但那是基于"句子像不像念稿"的启发式，不是账本里的硬事实）；`test:voice-longrun` 本轮因本机只剩 2.2GB 空闲内存而在浏览器启动阶段 CDP 超时，**没跑通**（上一轮 7/7 仍有效）。 | 12 / 27 / 14 | `sfu/server.js`（`assetVersion`/`injectAssetVersions`/`assetVersions`）、`sfu/public/{client.js 第 46a~48 步,index.html,style.css 第 38~39 节}`、`scripts/review-meeting.js`（新）、`scripts/{check-visual-pass,check-screenshare,test-nets,test-sfu-client-smoke}.js`；AGENTS 坑 **103/104/105**；导读 **LEARN 5.52** |
| 35 | **★ "会背题"到"会泛化"：AI 操控实体的最后一半 + 真实语料回扫（2026-10-06 深夜，`sfu/ai/roomActions.js`）** | **① 泛化缺口是量出来的**：32 句电池全绿而用户第五次说"操控实体不行"，另写 **28 句从未进过规则表**的自然口语 → 首跑 **13/28 = 54% 不命中**（「弄个白板」「白板不用了」「字幕先停一下」「把刚才画的都擦掉」「刚才那一笔不要了」「把说话的人放大」「能不能给我配个字幕」…）。补齐"动词/量词/倒装/省略宾语"四类分支 → **28/28**，并挑 6 句进**真浏览器**断言界面真的动了（`test:room-actions` 11→**17**）。<br>**② 一条"做错方向"的缺陷**：「别切宫格，把白板打开」以前会把宫格执行掉——否定副词与命中点之间夹了一个轻动词，旧守卫要求"别"紧贴命中点。修法只做**窄扩展**（窗口容一个轻动词 + 一个插入语），**有意不做**"整小句有否定就压掉"：语音常无标点，「不要开白板把字幕关掉」按小句判会把后半句一起压掉。A/B 用旧守卫副本证过可红（`[view-grid,board-open]` → `[board-open]`），10 条否定反例一条没被误伤。<br>**③ 越界"归类"也要准**：「把推广视频发一下」曾被判成 camera（裸"视频"当设备词）→ 裸视频/画面必须与 开/关/打/闭 同现；补上「把会议录下来」「共享一下我的屏幕」两种真说法的拒绝。<br>**④ ★ 真实账本回扫抓到我自己刚写进去的误拒**：`录(下来|一下)` 让「把这条**记录**一下」被判成"开录制"而明确拒绝——`sfu/captions` 的 **3332 句真人字幕**里这一句出现 **11 次**，且它本来真能办。修 = `(?<!记)`；误拒 **14 → 1**（剩的是噪声幻觉）。这件事变成**常驻三处**而不是一次性动作：`review:meeting` 新增「**指令回扫**」行 + `test:review` 19→**23** 条（含"真祈使句必须数得出来"的反向对照）+ `test:asr` 2 条（记事求助 + 全量回扫上限）。<br>**⑤ ★ 一个**我自己读错数据**的纠正：回扫第一版把账本所有非 bot 条目当"人说的话"，得到"18 句会触发动作、多数是 AI 回声"——差点为它写抑制。核 `asr` 字段才发现其中 13 条是 **AI 写进账本的存档回答**（`asr:false`），真正麦克风转写 864 句里触发 3 句而**这 3 句全是真命令** ⇒ **误触发 0，那个现象本来不存在**。修的是**口径**（只数 `asr===true`）+ 断言改成**比例 ≤2% + 样本量门槛**（逐句金标准清单会在用户说新命令那天变红）。<br>**⑥ 长跑结案**：`test:voice-longrun` 这次 **7/7**——5 分钟 **31 条定稿全部 `fin=silence`**、最大停摆 14s、0 崩溃 0 永久放弃、AI 应答 28、定稿延迟 min 1.3 / 中位 1.8 / max 3.1s（n=31）；上一轮的"没跑通"确认是机器只剩 2.2GB 内存导致浏览器启动超时，**不是代码问题**（本轮没改那台工具）。 | 12 / 27 / 14 | `sfu/ai/roomActions.js`（`NEG_RE` 窄扩展 / 8 个动作的泛化分支 / `OUT_OF_SCOPE_RE` 改 `new RegExp([...].join())` + `(?<!记)`）、`scripts/review-meeting.js`（⑧ 指令回扫 + 自检 L 组）、`scripts/{test-asr,test-room-actions}.js`；AGENTS 坑 **106/107**；导读 **LEARN 5.53** |
| 36 | **★ 共享文件浏览：房间里所有人同时看到同一份文档（2026-10-08，第 51 步，零依赖读 Office）** | **① 渲染内核 `sfu/public/fileview.js`（纯函数，无 DOM/无 fetch）**：OOXML = **一个 ZIP 包里的几份 XML**，浏览器自带 `DecompressionStream('deflate-raw')` ⇒ 手写 ZIP 中央目录（含 ZIP64 额外字段）+ 容错 XML 解析器就能读 docx/xlsx/pptx，**不装 pdf.js/mammoth/sheetjs**。docx 还原标题/列表(符号与编号)/表格(gridSpan)/内嵌图/外链；xlsx 走 sharedStrings + **"日期 = 数字 + 数字格式"**（styles.xml numFmtId，`datePartsOf` 先剥 `[hms:]` 才不把 `h:mm:ss` 当日期）；pptx 按 `p:sldSz` EMU 摆版 + 字号用 `cqw`（容器变宽字跟着变）。旧版 `.doc/.xls/.ppt` 当时**如实报"请下载后查看"**（没有公开可解析结构，不吹）。<br>▸ **★ 2026-10-09 这一句已过期**：那一轮"如实拒绝"是对的诚实，但用户手上的文件正是这种旧版 ⇒ 见下一行 **36b**（零依赖把 CFB/piece table/BIFF8/PPT97 读出来了）。<br>**② 安全两道（缺一不可）**：前端**先转义再拼接** + 链接协议白名单（`javascript:`/`data:` 先删控制字符与空白再判）+ **属性上下文另转引号**；服务器非白名单类型一律 `attachment` + `octet-stream` + `nosniff`（**SVG/HTML 有意不放行**）——只有前端转义，"新标签直接打开下载链接"就漏了。<br>**③ 存储 `sfu/files.js`**：`sfu/files/<房>/{index.json, blob/*}`；台账与磁盘**对账**、超配额**当场 destroy 请求**、`.part` 写完改名、启动扫旧垃圾；可见性下界 = `room.createdAt`（**房间号会回收复用**）。<br>**④ 同步模型**：服务器一份权威 `room.fileView`，**变化才广播**；滚动这类连续量节流、换文件/翻页这类离散事件**绕过节流**；位置传**比例 0~1** 不传像素；新人 `files-state` **单播补发**；客户端 `applyingRemote` **断环**（否则两个跟随者互相拽着滚）；界面**写明"跟着谁"在带**。<br>**⑤ 四层测试全绿**：`test:fileview` **190**（夹具是**独立写的 ZIP 打包器**：写包与读包是两份实现，一致才算证据）· `test:files` **59** · `test:sfu` **270**（第 51 步 44 项）· `test:smoke` **495** · `check:all` **20/20 条 · 344 项**（新增双浏览器 `check:files` **33 项**：★★★ B 的页面真的出现同一份内容、★★ XSS 只是文字、★★ 断环、晚到者补发、命中测试）。<br>**⑥ 顺手修掉两条无关的真缺陷**：`enterRoom()` 现在幂等收起首屏（"人在会里"必然蕴含"landing 已收"，原先只有那颗按钮写这一步）；「打开一份文件」收成唯一入口 `openFileAsMine()`（打开 + 广播；冒烟加结构红线：裸 `openFileByName(` 只许 3 处）。<br>**诚实边界**：Office 只还原文字与基本结构（不分页/无图表公式/无母版继承）；**PDF 走浏览器内置 `<iframe>` ⇒ 它内部的滚动读不到**，翻页靠工具条；>40MB 不解析。 | 12 / 14 / 27 | `sfu/public/fileview.js`（新）、`sfu/files.js`（新）、`sfu/server.js`（`/api/files` + `/files/*` + `files-list/state/delete/view` + `room.fileView` + `COLLAB.files` + `/metrics` 三组）、`sfu/public/{client.js 第 51 步,index.html,style.css 第 40 节,sw.js}`、`sfu/ai/roomActions.js`（files-open/close + 越界表窄化）、`scripts/{ooxml-fixture,test-fileview,test-files,check-files}.js`（新）、`scripts/{test-sfu-signaling,test-sfu-client-smoke,check-all}.js`；AGENTS 坑 **118~128**；导读 **LEARN 5.56**（+ 5.56.11）。<br>**★ 同日第二轮（凌晨下半场）把这条功能自己的证据打厚**：`test:fileview` 190 → **234**（O 组「真实世界的怪形状」22 条 + P 组「图片预算是文档级的账」9 条：docx `vMerge` 与 `gridSpan` 混用 / xlsx 公式有无缓存值 / numFmt 引号字面量 / pptx 备注页 / 扩展名与内容不一致的有意边界），`check:files` 33 → **45**（PDF 翻页改为**重建 iframe**——只改 `#page=` 片段内置阅读器根本不动，实测两页黑占比 58.9% vs 58.9%；另加 390×844 手机形态 5 条），冒烟 **499**（PDF 拼法收成 `FV.pdfSrc()` 一处 + 结构红线），`test:review` 40 → **47**（「共享文件」结论行），`soak` 加**第四类流量**（上传→下载比字节→修剪→对账→报视角 + 房间销毁后目录真的没了），`check:all` **20/20 条 · 356 项**；新坑 **121/122/123**（PDF fragment 不重载 / 无头插件像素不可靠故降为观察值 / **变异路径没被执行过的 A/B 也是假绿**）<br>**★ 同日第三轮（凌晨续跑）把证据厚到压出两条"做错方向"的真缺陷**：① 「跟随主讲」那颗按钮按下去其实是**抢主讲**（跟随关着时 `emitFileView` 照样往外广播 ⇒ B 自己翻页把全房拽走；再点一下又把自己的视角播出去）——修成**解耦双向**（不跟随就不发）+ 新增唯一入口 `rejoinPresenterView()`（打开跟随 = 我跳回主讲，复用 `applyRemoteView` 那条正路，不写第二份）；② 客户端那条 09-19g 的 C1 入口判据（句首是"操作/打开/点击/帮我操作/远程"就走 `ai-op`）**只看句首动词**，于是「@ai 打开白板」「@ai 打开共享文件面板」被整条改道去"远程操作别人电脑"，房间动作规则根本没机会跑——**17 项真浏览器用例一条都没抓到，因为它们没有一句以"打开"开头**（坑 106 原样复发）；换成"提到哪台机器 × 要做什么动作"两条各管一半，冒烟加三条红线（含"正例必须仍然走 ai-op"的反向对照）。`check:files` 45 → **58**（键盘入口 3 · 跟随中被删文件 4 · S 组跟随方向 6）· 冒烟 499 → **514** · `test:fileview` 234 → **240**（★ O 组那些真实形状**以前只走过 zlib 那一轨**，现在两轨逐字一致 + 内容级正向对照各钉一条）· `test:room-actions` 17 → **21**；新坑 **127/128**。 |
| 36b | **★ 2026-10-09（J 档）`.doc/.xls/.ppt` 真的能看了 + 新格式缺的那几块形状补齐** | **（共享文件这一档的第四轮）"word 还是不能观看"拆成两半：旧版二进制零依赖读出来 + 新格式里"有但没画"的形状。** 用户原话"共享文件浏览的功能还行还没有完善，**word 什么的还是不能观看**"。两句独立成因，都做完了：**① 旧版 `.doc/.xls/.ppt` 从整类被拒变成能读**——它们是 **OLE2/CFB 复合文档**：手写 CFB（DIFAT/FAT/MiniFAT/ministream + 128 字节目录项）→ Word97 **piece table**（`wIdent=0xA5EC`、`fWhichTblStm` 选 0Table/1Table、`fcClx@0x1A2`、Clx 跳 Prc 找 Pcdt、PlcPcd `n=(len-4)/12`、PCD 的 fc **bit30** 判 CP1252 单字节 vs UTF-16）→ BIFF8（SST 计数是 **u32**、**CONTINUE 跨界要重读 grbit**、LABELSST/NUMBER/RK/MULRK/BOOLERR、FORMULA 的 8 字节**变体结果**、STRING 续回上一条公式、MergeCells）→ PPT97 record tree；`.doc` 里装 docx 的**按内容改道**、RTF 按 `\ansicpg936` **成对**收 GBK（半个字节不能解）+ `\uN` 配 `\ucN` 回退 + `\bin` 按长度跳过 + 目的地组不吞正文；旧版界面**明说"版式不还原"**（不许让人以为看到全文）。**② 新格式里"文档有但我没画"的补齐**：编号从样式继承（`pStyle → 样式 numPr → numbering.xml`，沿 `w:basedOn` 链、**`numId=0` 是否决不是"没有"**、`numStyleLink/styleLink` 解引用、**段内 numPr 优先于样式**——判据顺序承重）、`mc:AlternateContent` **只取一份**（两份都画 = 同一句话出现两遍）、**域代码取结果不取指令**（`PAGE` 曾原样印在页面上）、文本框 `txbxContent` 优先于〔图片〕占位、OMML `m:t` 抽成文字、`sdt/ins/smartTag/bdo/dir/customXml/moveFrom/moveTo` 递归；Excel 的"**值 + 格式码**"（`0.00%` ⇒ ×100 带百分号、`¥#,##0.00` ⇒ 货币符+千分位+小数位、区段 `正;负;零;文本`、**只有 `0#?.,` 算占位符**其余按字面拆前后缀）、`mergeCells` → colspan/rowspan、**行号按 `row@r` 忠实**、公式无缓存值的行**仍然是数据行**。**③ ★ 裁判不是我**：`scripts/office-oracle.py`（python-docx/openpyxl **独立写 + 独立读**）+ `scripts/legacy-oracle.ps1`（**本机真 Word/Excel/PowerPoint COM** 交出它自己认为的正文；断言形状=「覆盖 ≥70% + 反例（`PAGE` 不外泄、页眉不进正文）」而不是逐字相等）。**④ 只有真文件才会暴露的三个错**（全部实修 + 各有一条断言钉死）：`wIdent` 凭印象写成 `0x01A5`（真值 `0xA5EC`）⇒ 每份 `.doc` 被**干净地**拒收（坑 **131**）；SST 计数按 u16 读 ⇒ 整张表全空；`ooxmlKindOf()` 漏一个 `await` ⇒ 改道路径**一次都没生效**（坑 76 家族）。**⑤ 两个浏览器端到端**：`check:files` 58 → **71/71**（带 `REAL_OFFICE_FILE` 那份真文件时 72/72）（rich.docx/rich.xlsx/**legacy.doc**/**legacy.xls** 各上传一次，B 跟着进旧版文档看到同一份正文与那句说明；另可用 `REAL_OFFICE_FILE=<单个文件>` / **`REAL_OFFICE_DIR=<文件夹>`**（10-09 的 L2 自走版，默认 8 份） 把**用户自己那些渲染不出的文件**推过同一条套件——本机真实语料取 8 份真 .xlsx **0 白屏**、 夹具 5 份（旧版三件）**0 白屏 + 3 条旧版横幅**；Node 侧 `review:office --max 80 --depth 5` 扫 **80 份真文件（含 legacy .xls/.doc）抛错 0、抽不出文字 0**。回归（本批顺序跑）：`test:fileview` 240 → **292/292**（Q 组真形状 + L 组旧格式，逐条 A/B 证过可红）、`test:files` 59、冒烟 **521**（L7 + L6 共 7 条）、`check:all` **20/20 条 · 388 项**。新坑 **130/132**；详见顶部 10-09 块与下一列 | 12 / 14 / 27 | `sfu/public/fileview.js`（**第 10 节 legacy**：CFB / Word97 piece table / BIFF8 / PPT97 / RTF / HTML + 格式码 `parseNumSection`·`numFmtOf` + 样式编号 `loadDocxStyles`）、`scripts/{office-oracle.py,legacy-oracle.ps1,ooxml-fixture.js}`、`scripts/{test-fileview,check-files,review-office}.js`、`sfu/public/style.css`（`.fv-legacy-note/.fv-txbx/.fv-math/.fv-merged/.fv-blankrow`）；AGENTS 坑 **130/131/132**；导读 **LEARN 5.57** |
| 36c | **★ 2026-10-09（K 档）跨网三条腿：固定端口 UDP+TCP / 多地址通告 / STUN 反射地址** | 用户："跨网升级方向要升级到**不同网也能进入会议**的地步"。先纠一句谎（同项目两份文档之一没跟着改）：**SFU 的媒体不走 TURN**，`iceServers` 里的 TURN 只救 Mesh 版 P2P ⇒ 决定成败的是"服务器自己被不被连上"。三条腿一起做：**① 一条端口转发到底**——mediasoup **`WebRtcServer`** 把所有 Transport 的 RTP 汇到**一个固定端口**并**同端口再开一份 TCP**（`config.rtcServerPort` / `MEDIASOUP_RTC_SERVER_PORT`）⇒ 防火墙/路由器只需转发 `4443` 的 **UDP+TCP**，**封 UDP 的网络**（公司 VPN/酒店）由 TCP 候选兜住；没配时保持旧的随机端口段行为。**② 多地址通告**——`sfu/nets.js` 新增 `announceIps()`：一条 Transport **同时**通告局域网地址与组网地址（`announceExtra:"tailscale"`，另有明示注入 `ANNOUNCE_EXTRA_IPS`），于是"让外面进来"与"同 WiFi 的同事连不上"**不再是同一个旋钮的两端**；`'all'` 的过滤必须按**网卡名**判（`isVirtualNic`）——第一版拿打分符号当过滤器，而 `vEthernet (WSL)` 打分是 **+10** ⇒ 虚拟口漏进来（发出去就是给对端一条连不上的候选）。**③ "我在不在 NAT 后"变成一行打印**——`scripts/stun-probe.js` 手搓 STUN Binding（`XOR-MAPPED-ADDRESS` 的 family 是 **1 字节**、端口要 `^=(cookie>>>16)`、地址被 cookie 异或；Google 实测还发老式 **8 字节** `MAPPED-ADDRESS`，**两种布局都得解**，否则真响应被读成"没带映射属性"）。**④ 界面/体检/交付一起改口**：`/config.json` 的 `netCheck` 多「媒体端口」（只有 UDP ⇒ warn + 说清"封 UDP 连不上"）与「通告地址」（只有一个 ⇒ info + 给补一个的命令）两项；`/metrics` 加 `sfu_rtc_server_port` / `_instances`；`doctor` 新增 **B1b 媒体端口体检**，并修掉它把 `announcedIp:"auto"` **原样拼进 URL** 打出 `https://auto:3443/` 的胡话（坑 **134**）；`start:lan` 写 `rtcServerPort` + `announceExtra` 并按 UDP+TCP 放行防火墙；`allow-firewall.bat` 补媒体端口段。**⑤ 文档**：《跨电脑连接-操作指南》第三节整段重写成三条诚实路线（同一 NAT 内 / Tailscale 组网 / 公网服务器）并把 `test:crossnet` 写成第一件该跑的事；《部署手册》B-1~B-4 同步。**⑥ 新增两条可红证据**：`npm run test:crossnet` **17/17**（专用端口 3019 + 固定媒体端口 3155 + 临时库/FILES_DIR，端口被占明确拒绝）——ICE 候选 udp 与 tcp **都在且都落固定端口**、TCP 在**每个通告 IP** 上真握手、`/metrics` 那行**锚行首**、反证（没配 ⇒ warn 且 `tcpFallback:false`）；`npm run test:stun` **8/8**（合成响应让解析器可红）；`test:nets` 31 → **42**。本机实测：反射地址（公网出口，值只在终端打印）≠ 通告 `192.168.157.194` ⇒ 诚实结论"这台在 NAT 后，别人要进来必须转发这一个号或走组网"。**★ 一条只有全量回归才会露出来的界面真缺陷**：邀请面板高度是**内容撑的**，自检从 5 条长到 7 条 ⇒ 矮窗口里最后一行连同"可复制的修复命令"**掉到屏幕外**且没有滚动条（零报错的失效）；修 = 给浮层**结构性上界**（`max-height: calc(100dvh - 76px)` + `overflow-y:auto` + `overscroll-behavior:contain`），**不是把某个数调小**（坑 79/114 第三次应验）；`check:invite` 8 → **12 项**，其中"用户够不够得着最后一行"**必须用真滚轮测**——第一版写 `p.scrollTop = scrollHeight`，把 CSS 改成 `overflow-y:hidden` 后**照样绿**（隐藏溢出的容器仍允许脚本改属性），换 CDP `mouseWheel` 后同一变异当场红。另修一条**量具的假红**：`test:asr-live` 默认跑在 **whisper 兜底**上（≠ 用户配置的 qwen-local）⇒ 把"等主引擎就位"改成**默认**（要测降级路径才 `TEST_ASR_WAIT_WARM=0`），并把"喂音频时引擎到没到"印进失败信息。新坑 **133 / 135 / 136**；详见顶部 10-09 块与下一列 | 7 / 14 | `sfu/server.js`（`attachRtcServer`/`mediaListenInfos`/`transportListenOptions`/`ANNOUNCE_*`/`sfu_rtc_server_*`/自测默认等主引擎）、`sfu/nets.js`（`announceIps`/`isVirtualNic`/`diagnose` 两项）、`scripts/{stun-probe,test-crossnet,test-nets,doctor,start-lan}.js`、`allow-firewall.bat`、`sfu/public/style.css`（邀请面板 `max-height: calc(100dvh - 76px)`）、`sfu/config.example.json`（`rtcServerPort` 与理由）；AGENTS 坑 **133/134/135/136**；导读 **LEARN 5.57.5~5.57.8** |
| 36d | **★ 2026-10-09 语音准确率的尺 + 真人金标准链路（H3 第一次可以被拍板）** | 这条线此前**只有延迟有尺**（`⏱`/`latMs` 拆分/`/metrics` 三读数/blob%），"这句话转得对不对"只有 `bench:asr` 的关键词命中 6/9——那是下限代理：「评审会」→「庭审会」只要还剩「评审」两个字就算命中。**没有尺的时候任何优化都是掷骰子**（H3 写"等用户拍板"、H8b 写"必须先拿真人分布"，两条都卡在同一个缺口上）。**① `sfu/ai/accuracy.js`**（新，零依赖纯函数）：中文按字、拉丁数字按词切 token；标点空白不参与（转写自带标点，算进去每档虚高）；**数字默认不折算**且口径记在结果里（`diff()` 遇口径不同直接拒比）——量准确率不许借用 `normAsrText` 那套"判意图"归一化，**那是用尺子的刻度去改被测物**；micro 与 macro 两数并列；空转写判 100%、期望为空判不可比、样本 <5 判 `enough:false`。**② `npm run bench:asr-golden`**：跑引擎前先自证量具（0%/100%/不可比/sub=1 四条），尺坏了立刻退出；TTS 复用 `voice-fixture.js` 唯一一个实现；增益走 `Asr.modelGainDb` ⇒ 量的是**生产真正喂给模型的那份音频**；跳过必须说话（SKIP 计入"未测"，不当成通过）；`--compare` 出改动前后差值。**首张表（合成场 10 句×2 档）**：qwen-local(cuda) **2.8%**（全对 9/10）vs whisper-small **4.9%**（5/10）；「负载→附在」是真词错，「十月十号→10月10号」是写法差异（折算口径 4.9%→3.5%）；far 档读数没变差，但那一档只是整体调小干净语音，**房间噪声与混响没进来 ⇒ 不能外推成"真人坐远会怎样"**（表里自己写明）。**③ 真人场入口**：`sfu/golden.js`（句子清单唯一来源 + 账本 + ffmpeg 转码 + `.part` 卫生 + `GOLDEN_DIR` 可搬临时目录）+ `/golden` 页面（逐句念 × 两档距离；麦克风三件套 `echoCancellation/noiseSuppression/autoGainControl` **有意全关**——要量的是这个房间的真实条件，而会议里正好相反要开 AEC）+ 两个端点（`GET/POST /api/golden`，`requireAdmin`：它与房间无关，`requireRoomAccess` 的签名强制要 6 位房号，硬套只会必然 401）。回包 `peakDb` 出自**生产能量闸同一个 `Asr.measureWavLevel`** ⇒ "这句在会议里会被当静音删"录当场就知道。**④ 顺手收口 4 处 + 修一条播报缺陷**：增益算式原来在 server.js 内联两遍 → `Asr.modelGainDb()` 一处 + 触发账 `COLLAB.gainApplied`/`sfu_ai_asr_gain_applied_total`（分子恒 0 而 `input.voiced` 在涨 = 那条"安静麦克风的救赎"整条没跑，它上线时无人能证明它跑过）；Qwen 模型目录判据原来**只有 server.js 知道**（独立脚本 `boot()` 于是无声返回 false）→ `resolveModelDir()`，server/`bench-asr-multi`/`test-qwen` 三处抄本全接回；能量闸阈值 → `asrMinPeakDb()`；**播报按字数拦腰截断**（`sentence.slice(0, room)`）是"话说一半然后没声"的真身 → 首句永远整句念、后续放不下就**整句不念**，同时在生成侧给语音问答那一路加 `spoken` 形状约束（结论进第一句、≤60 字、不写路径与 markdown；@ai 打字那一轨不传）——只改切法治不了根，只改 prompt 不保险，**两侧一起**。 | 12 / 27 / 14 | `sfu/ai/accuracy.js`（新）、`sfu/golden.js`（新）、`sfu/public/golden.html`（新）、`scripts/{bench-asr-golden,check-golden}.js`（新）、`sfu/ai/{asr.js,asr_qwen_local.js,brain.js}`（`modelGainDb`/`resolveModelDir`/`systemExtra` 三个钩子）、`sfu/server.js`（`asrMinPeakDb`/`COLLAB.gainApplied`/两个端点/`/golden` 短地址/流水线不切半句/`spoken` 传递）、`.gitignore`（`sfu/voice-golden/`）、`sfu/protocol.js`（金标准 HTTP 段）；`scripts/{test-asr,test-sfu-signaling,check-all}.js`（+27 / +12 / 清单 +1）；AGENTS 坑 **138/139/140**；导读 **LEARN 5.58** |
| 37 | **★ 2026-10-09（第 52 步）账号：退出登录终于有反面 / 忘记密码不许演 / 管理员的实质区别可见** | 用户一句话点了三个缺口："没有退出登录的效果和忘记密码的效果，还有管理员没有实质的区别"。审计定位到三条不同的根因，没有一条是"少一颗按钮"：**① 登录卡的开合是单向的**——全文件只有 `hideAuth()`，登录后没有任何路径能回到登录卡（换不了账号、登不出来、票过期了界面也什么都不做，那句"请重新登录"只写进折叠的流程日志 = 等于没写）；**② 登录态散在四个落点**（localStorage 的 `wb_auth`、模块级昵称、头像、每小时续期定时器），没有一条统一的撤销路径 ⇒ 收成唯一入口 `clearAuthState(why)` + `doLogout()`，**两条路径（连着/没连着）共用同一个 finish()**（第一版把 toast 与提示只写在有网那一路，断网点退出悄悄回到"未登录"却零反馈——冒烟逼出来的，而它之所以以前测不到，是桩里没有 `socket.connected` = **坑 83**；补上之后白板信令 `board-signal` 也第一次真被跑到）；**③ 服务器那半边根本没有"撤销"**：`bindIdentity` 只进不出，而聊天广播的署名取自 `socket.displayName`、成员投影的 role 也取自它 ⇒ 客户端退回游客、服务器仍按老身份放行录制与删除 = **两边各说各话**。新增 `dropIdentity(why)` 作唯一收口，两个调用点：`auth-logout` 与 **`auth-refresh` 判失败**（配对的半边，A/B 摘掉它精准红在"续期失败也撤身份"）。<br>**`auth-logout` 的守卫形状**：按"这张票是不是本连接自己的"判——**传别人的票进来明确拒绝且零副作用**（否则"退出登录"就是一个把管理员踢下线的 DoS 入口），被拒时也不顺手把自己退了。有意保留的语义差写进 protocol.js 与测试名：**不带票的退出只退这条连接、不废票**；带自己的票才作废它（作废后连 `auth-verify` 都过不了，否则刷新页面就"自己又回来了"）。<br>**忘记密码不许演**：本项目零依赖、可完全离线，没有邮件/短信通道 ⇒ 那句提示给两条照着就能做的真路（本机 `npm run admin:passwd -- <用户名>` / 找部署那台机器的管理员），并钉一条反向对照：不许出现"已发送 / 请查收 / 重置链接已发"（那会让人去查一个不存在的邮箱，坑 82）；点它**不发任何信令**。<br>**管理员的实质区别此前只在文档里**：admin 独占的是四个 HTTP 端点（`/dashboard`、`/recordings.html`、`/golden`、`/metrics`），普通成员打开是 401，而界面上 admin 与 owner 一模一样（会中权限本来就该相等：踢人/删文件都是 owner-or-admin）。所以修法是**把差别说出来**而不是新造特权：顶栏身份牌（未登录/成员/房主/平台管理员四档）+ 账号面板（我是谁 / 两步确认的退出 / 只随服务器 role 投影出现的治理台四链接）。浮层照 L7 红线带 `max-height + overflow-y + overscroll-behavior`；`check:theme` 的掀开清单点名补上这块 ⇒ 扫出深色档 `.account-note` 压在 accent-muted 底上只有 **4.03:1**（换 `--fg-muted` 后 5.56:1，两档 0 条）。<br>**口令判据三处收口**：网页注册 / `admin:adduser` / `admin:passwd` 原先各写一份 ⇒ `sfu/password.js` 新增 `strengthError()`，`/config.json` 下发 `passwordMinLen`，网页那句提示里的数字来自它（界面不许硬编码一个可能与配置不符的数）。<br>★ 这一批我自己制造并被断言抓走的三次事故都升级成常驻判据：**坑 141**（HTML 注释用 CSS 的收尾序列 ⇒ `<!--` 永不闭合，「忘记密码」按钮与 `#authMsg` 一起被吞、页面后半屏几何全 0，`node --check` 与冒烟一条都不红，红的是 check:login 那条 id 契约；补"id 必须出现在注释之外"+"HTML 注释里不许出现那个序列"两条静态判据）、**坑 142**（模板字符串内部的反引号把注入代码截断 → 那条检查 0 条断言就跑完；全仓静态红线试过、误伤 17 处、撤下，换成 `scripts/inject-check.js` 一处实现 + 12 个 check 脚本各接一行 + 守卫自己的 2 条单测含"不许误伤"反例）、**坑 143**（两条"目录没被创建"型判据在用户录完音之后变成永真/永假 ⇒ 判据要钉真正要保护的不变量："我这批 id 有没有混进真实语料" / "跑前跑后逐文件 路径|字节|mtime 快照"）。 | 12 / 14 / 27 | `sfu/public/client.js` **第 52 步**（`showAuth`/`myAuth`/`myRoomState`/`roleLabel`/`renderAccount`/`clearAuthState`/`doLogout`/两步确认/`ESC_LAYERS`）、`sfu/server.js`（`dropIdentity` 唯一收口 + `auth-logout` 守卫 + `auth-refresh` 配对 + `passwordStrengthError`→`Password.strengthError` + `/config.json` 的 `passwordMinLen`）、`sfu/public/index.html`（`#userChip` / `#authForgotBtn` / `#accountPanel`）、`sfu/public/style.css` 第 41 节、`sfu/password.js`（`strengthError`）、`scripts/admin.js`（CLI 与网页共用同一份判据）、`sfu/protocol.js`（AUTH_LOGOUT + 续期配对口径）、`scripts/inject-check.js`（新）+ 12 个 `check-*.js` 接线、`scripts/{test-sfu-client-smoke(+37),test-sfu-signaling(+16),check-login-screen(+2),check-theme(+1 点名 + 修对比度)}`；AGENTS 坑 **141/142/143**；导读 **LEARN 5.59** |
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
│   ├── server.js          #   SFU 服务器（分区 A~E）：静态托管 + 房间/密码 + 用户体系 + 媒体中枢 + 录制 + 面板 API
│   ├── files.js           #   ★ 2026-10-08 共享文件存储层（sfu/files/<房>/{index.json,blob/*}；
│   │                      #     名字消毒/唯一名/配额/台账与磁盘对账/.part 清扫/内联白名单 servePolicy）
│   ├── files/             #   ★ 共享文件产物目录（gitignore；房间销毁即整目录删除）
│   ├── golden.js          #   ★ 2026-10-09 真人语音金标准：句子清单**唯一来源** + jsonl 账本（同 id 取
│   │                      #     最后一次）+ raw body→ffmpeg 转 16k/mono/s16le + `.part` 卫生 + id 白名单
│   │                      #     + `GOLDEN_DIR` env 可整体搬去临时目录（测试隔离，同 DB_FILE/FILES_DIR）
│   ├── voice-golden/      #   ★ 金标准产物（wav + manifest.jsonl）；**已进 .gitignore**（本人语音与句子原文）
│   ├── nets.js            #   ★ 2026-10-06 「本机该对外说哪个 IP」的唯一判据（挑网卡避开虚拟口、
│   │                      #     announcedIp:"auto"、Tailscale 报出不抢主位）；★ 2026-10-09 再加
│   │                      #     announceIps()（多地址通告：主址/Tailscale/明示注入，isVirtualNic 按**名字**挡）
│   │                      #     与 diagnose() 的「媒体端口」「通告地址」两项（server/doctor/watch/测试共用）
│   ├── talk.js            #   ★ 2026-10-10（B4）发言占比的唯一算式（纯函数）：**分母只算在场成员**，
│   │                      #     幽灵条目（离开却没销账的 id）不许把每个人的占比一起稀释；
│   │                      #     total=0 / 账本缺失 / 负值与 NaN 一律当 0（NaN 进广播会把成员行占比条整个弄塌）。
│   │                      #     服务器三处读 `room.talk`：talk-stats 广播走它，而**纪要与 AI 那句"谁发言最多"**
│   │                      #     仍按全量排序——那是"这场谁说过话"，离开的人确实说过，语义有意不同（不是漏改）
│   ├── protocol.js        #   SFU 信令事件总表（房间/媒体/远程协助/A~F 各档事件 + ★ 第 51 步 FILES_*，改 sfu 前后端先看）
│   ├── ai/asr.js          #   ★ 09-28 服务端语音识别唯一实现层：whisper 探测（UTF-8 环境 + --help 口径 +
│   │                      #     形态白名单）/ 转写（tiny 默认、简体提示词、并发闸 ASR_CONCURRENCY）/ 唤醒+追问窗口纯函数
│   │                      #   ★ 2026-10-09 再加 `modelGainDb()`（模型输入峰值增益，原来在 server.js 内联两遍）
│   │                      #     与 `gainTargetDb()/gainCapDb()`（日志那句"→ -8 dBFS"跟着 env 走，不写死）
│   ├── ai/accuracy.js     #   ★ 2026-10-09 语音**准确率**唯一口径（零依赖纯函数）：中文按字/拉丁数字按词切
│   │                      #     token、标点不参与、数字默认不折算（口径记在结果里，`diff()` 口径不同拒比）、
│   │                      #     micro+macro 并列、空转写判 100%、期望为空判不可比、样本不足 `enough:false`
│   ├── jsonc.js           #   ★ 09-28 带注释 JSON 容错解析（example 模板可"复制即用"；server 与 doctor 共用）
│   ├── config.example.json#   配置模板（端口/人数/listenIp/announcedIp/ICE/HTTPS/roomTtlSec/videoSvc/asrModel/asrSegmentSec/aiChatWindowSec）
│   ├── config.json        #   实际配置（可缺省；start:lan 生成时含 lanUrl）
│   ├── users.json         #   登录注册账号存储（scrypt 哈希）
│   ├── recordings/        #   D+2 服务器侧录制产物（webm/mkv）
│   ├── tls/               #   HTTPS 自签证书（https.enabled 时自动生成）
│   └── public/
│       ├── index.html     #   SFU 页面（应用壳布局：topbar/stage/sidebar；预览页/滤镜面板/白板/字幕条/共享文件面板）
│       ├── style.css      #   主版本整份重写（40 节设计系统 + 主题层；Mesh 版样式保持不动）
│       ├── client.js      #   SFU 浏览器核心（1.1 万行，**步骤 1~51**；14=远程协助，15~24=A/D 档，
│       │                  #     25~26=F 档，26b/26c/26d=回应举手/批注/白板，27=D+1 数据通道，
│       │                  #     28=F6 滤镜虚拟背景，29~31=字幕/值守/日报，36~39=延迟读数与房间动作，
│       │                  #     43~48=升起/耳朵/版本自检/邀请面板/模糊衬底，51=共享文件浏览，52=账号（退出登录/身份牌/治理台））
│       ├── fileview.js    #   ★ 2026-10-08 共享文件的**零依赖渲染内核**（纯函数：ZIP+XML 自己读 Office）
│       ├── countup.js     #   面板数字滚动的纯函数（reactbits CountUp 移植，可穷举断言）
│       ├── dashboard.html #   观测面板页（/dashboard，跟随同一份主题）
│       ├── workbench.html #   远程协助工作台（与 Mesh 版共用同一份演示页）
│       └── vendor/        #   socket.io.min.js + mediasoup-client.js（本地打包）
├── package.json           # scripts: start/start:sfu/start:demo/start:lan/test/test:sfu/test:smoke/
│                          #          test:record/test:turn/bench/build:sfu-vendor（含 doctor）
│                          #          ★ 09-24b 新增：agent/test:agent/test:e2e/publish:mesh/test:publish
├── scripts/
│   ├── inject-check.js      #   ★ 2026-10-09 「拼代码给浏览器执行」的交付前自检（唯一实现）：模板被注释里的反引号
│                      #     截断时 node --check 不红、页面里才炸 → 进浏览器前先让同一个引擎 new Function 读一遍（12 个 check 脚本各接一行）
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
│   # ★ 2026-10-08~09 共享文件与跨网这批新增（每条都是 npm script）：
│   #   test-fileview.js（渲染内核 292 项：G2 浏览器轨 / O 组真实怪形状 / Q 组"另一个实现写的文件"
│   #     / L 组旧版二进制）· test-files.js（存储层 59）· check-files.js（**两个真浏览器** 72 项，
│   #     可用 REAL_OFFICE_FILE 指用户自己那份文件）· ooxml-fixture.js（独立写的 ZIP 打包器）·
│   #   ★ office-oracle.py（python-docx/openpyxl 独立生成+独立读回，第二个裁判）·
│   #   ★ legacy-oracle.ps1（驱动本机真 Word/Excel/PowerPoint COM 交出它自己认为的正文）·
│   #   review-office.js（真实文件回扫：只报结构统计，绝不打印内容）+ bench-innerhtml.js ·
│   #   ★ test-crossnet.js（跨网入口实测 17 项：udp+tcp 候选都落固定端口、TCP 逐通告 IP 握手）·
│   #   ★ stun-probe.js（手搓 STUN Binding 读反射地址；test:turn 复用；--selftest 8 项）·
│   #   test-nets.js（sfu/nets.js 判据 42 项）· check-invite.js（邀请面板 12 项含矮窗口"浮层不许顶出屏幕"）
├── agent/                       # ★ 09-24b 真 OS 级远程桌面 · 被控端代理（零新依赖）
│   ├── cdp.js                   #   手写 CDP 客户端（驱动真实 Chromium：抓屏/注入输入）
│   └── index.js                 #   代理主体（★ 09-30 两种进房：设备码 desk-register / 老用法 agent-hello
│                                #     → 推帧 + 执行 remote-input + applyQuality 画质档）
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
npm run test:sfu       # SFU 版信令回归（必须先起 3001，且 AI_OP_STEP_MS=20）★ 2026-09-30 实测 184/184
                       #   （3001 被占时用 `TEST_SFU_PORT=3011 npm run test:sfu`，见坑 31/57）
npm run test:store     # ★ 09-24 账号存储层回归（node:sqlite：迁移保留 salt/hash / 改密换盐 / 删号安全闸 / 完整性 / ★09-30 口令 V2 平滑重哈希）★ 55/55
npm run test:shutdown  # ★ 09-24 优雅退出回归（关 Worker / 关库 WAL checkpoint / 幂等 / 5s 保险丝）★ 09-30 复跑 9/9
npm run test:smoke     # SFU 版**前端**无头冒烟（假 DOM/假 mediasoup，零依赖不用起服务器）★ 2026-09-30 实测 189/189
npm run admin:list     # ★ 09-24 管理员 CLI（另有 grant/revoke/adduser/passwd/purge；purge 默认干跑、`--yes` 才删）
npm run test:ai        # AI 双轨自检（无 key 只跑 Mock 轨并提示，有 key 两条都跑）★ 10/10
npm run test:asr       # ★ 09-28 服务端语音识别自测（探测必须成功 / 系统 TTS 真语音转写 / 唤醒与追问窗口 / 在线 asrEnabled / 配置模板可解析）★ 15/15
npm run test:ai-brain  # ★ AI 智能内核单测（检索/记忆/意图/行动项）★ 30/30（Mock 26 + 真模型 4）
npm run verify:ai      # ★ AI 真服务器端到端（起真服务器+真信令+真模型）★ 6/6
npm run ai:chat        # AI 脚本：终端一问一答（教学阶段 0）／--q "问题" 单发
npm run ai:summarize   # AI 脚本：文本/文件/房间字幕 → markdown 纪要（--text/--file/--room）
npm run ai:agent       # AI 脚本：手写 ReAct 工具循环（--goal "…" --maxsteps 6 --verbose）
npm run test:record    # D+2 服务器侧录制端到端自测（需已装 ffmpeg；产物落 sfu/recordings/）★ 连跑 3 次 PASS
npm run test:turn      # ICE 可达性实测（对 config 每个 STUN/TURN 手搓 STUN Binding，3s 超时）
npm run soak          # C3-N1 服务器耐久自测（默认 7 小时过夜；--minutes 2 压缩自测；结束对账"一条不丢"）
                      #   ★ 2026-10-03 报告多一行「字幕延迟」（取自服务器 collab.capLat）；
                      #   没推真音频时如实写"本次未采到"，不判 FAIL（假红也伤人）
npm run test:watch   # ★ 2026-10-03 watch 的退化诊断回归（纯函数 + 合成输入穷举）★ 36/36
npm run test:nets    # ★ 2026-10-06 "本机该对外说哪个 IP"的判据回归（sfu/nets.js：网卡排序避开
                      #   VirtualBox/WSL 假局域网、Tailscale 报出不抢主位、announcedIp:"auto"）★ 2026-10-09 实测 42/42
                      #   判据：挑错网卡不会让任何功能变红，只会"本机全好、别人黑屏"（坑 36）
                      #   判据：控制律/告警逻辑错了不会让任何功能变红，只会天天误报或永远不响
npm run bench:asr-golden # ★ 2026-10-09 语音**准确率**对照跑法（新）：引擎 × 距离档 × 生产增益链，
                      #   输出 micro/macro CER、全对数、最差两句的对齐，明细落 sfu/logs/golden-*.json。
                      #   ▸ 跑引擎之前先自证量具（0%/100%/不可比/sub=1），尺坏了立刻退出；
                      #   ▸ 没有真人金标准时自动回落合成语音并在表头写明「合成场」——**跳过必须说话**；
                      #   ▸ 常用：`--engines=qwen-local,whisper,cloud` `--gain=off`（量麦克风本身）
                      #     `--levels=far` `--compare=sfu/logs/golden-xxxx.json`（改动前后差值）
                      #   判据：H3「词级天花板等用户拍板」这件事，从今天起是**看这张表选**，不是凭感觉
npm run bench:voice-floor # ★ 2026-10-10（B2）把真人录音变成"生产那条 0.512s RMS 序列"的尺（新）：
                      #   用**同一套 ffmpeg astats 链**跑真人 wav → 喂**生产那一个** createVoiceTracker，
                      #   报 floor 中位/90 分位、自适应阈值、头/尾窗判有声比例、被 -80 排除的窗占比。
                      #   ▸ 生效参数从 `tracker.params` 读——抄第二份常数就变成"测我以为的参数"（坑 47/118）；
                      #   ▸ `--selftest` 7 条，含 E1「排除规则必须能读出 0」与 E2「故意把纯静音写成 -16dB
                      #     的响噪声，排除计数必须读出 1」⇒ 只会报"排除了"的量具没有资格报"因此偏高"；
                      #   ▸ 没有真人金标准时打 SKIP（不当通过）。这条把"H8b  floor 偏高"从口头推断变成读数。
                      #   实测负结果：silentDb 设 -80/-120/-70 三档，floor 与阈值**一字不差**
                      #   ⇒ "把 -99 纯静音排除在外"这件事买不到东西，所以一行生产阈值都没动
npm run check:golden  # ★ 2026-10-09 真人金标准链路的真浏览器回归（新，11 项）：未登录诚实空态 /
                      #   版本指纹 / 句子清单渲染（前端不许抄第二份）/ 两档距离按钮 /
                      #   真点录→停→页面报出"已存 + 峰值 dBFS" / 磁盘 wav 真是 16k 单声道 16bit /
                      #   页面峰值 == Asr.measureWavLevel 实测 / 同句重录只留一条 / 真实目录没被写（隔离自证）
                      #   判据：这条链跨 4 个运行时（浏览器→HTTP→ffmpeg→jsonl），任何一段断了
                      #   页面只会停在"上传中"，而跑表会安静回落合成语音——**看起来一切正常**
npm run test:crossnet # ★ 2026-10-09 **跨网入口实测**（新套件，★ 17 通过 / 0 失败）：
                      #   自起服务器（专用 3019 + 固定媒体端口 3155 + 临时库/FILES_DIR + SFU_NO_HTTPS=1，
                      #   端口被占**明确拒绝**，绝不碰用户那台 3001）→ 断言 ICE 候选里
                      #   **udp 与 tcp 两类都在**且都落固定端口 / TCP 在**每个通告 IP** 上真握手 /
                      #   `/config.json` 的 netCheck「媒体端口」「通告地址」两项与反证（没配 ⇒ warn、
                      #   tcpFallback:false）/ `/metrics` 那行**锚行首**（坑 74）；
                      #   末尾另印一条**只报事实不作判据**的 STUN 反射地址对照 ⇒ "这台在不在 NAT 后"
npm run test:stun     # ★ 2026-10-09 手搓 STUN Binding 的解析器自检（★ 8 通过 / 0 失败）：
                      #   XOR-MAPPED-ADDRESS 的 family 是 **1 字节**、端口要 `^=(cookie>>>16)`、地址被 cookie 异或；
                      #   Google 实测还发老式 **8 字节** MAPPED-ADDRESS（RFC 那种是 10 字节）⇒ 两种都要解。
                      #   判据：**另一个实现写的解析器测不住真响应**，这里用合成响应把解析器逼到可红
npm run review:meeting # ★ 2026-10-06 真实可用性复盘：读 sfu/captions/*.jsonl + sfu/logs/app-*.jsonl
                      #   每场 11 行结论、**每条带样本量**（❔=样本不足，不是通过）；--room/--days/--json
                      #   判据复用生产那一个函数（noiseRiffReason/isDupOrFragment/normAsrText）——报告与系统不两套口径
                      #   亮点：从"峰值高于当前闸门却仍被跳过"反推 ⇒ 直接回答"我改了你怎么还不行"（= 那台没重启）
                      #   ★ 2026-10-06 深夜新增「**指令回扫**」一行：按**当前**规则重放这场会的真人句子，
                      #     报"读成房间动作 N 句 / 判越界 K 句 + 占比 + 一个例子"（人话<10 句报 ❔）——
                      #     这一行就是坑 107 那次"改宽一条规则正好写死用户最常用那句"的常驻哨兵
npm run test:review  # ★ 上面那台量具的自检（合成账本 23 条：0÷0 不许报"0% 通过"、停摆要"段在到达却没字幕"、
                      #   延迟只认 fin=silence、文件名过滤器写错一位当场红、★ 回扫仪表自己也要能红）
                      #   ★ 2026-10-06 深夜实测 23/23
npm run test:fileview # ★ 2026-10-08 共享文件的**零依赖渲染内核**单测（sfu/public/fileview.js）
                      #   ★ 240 项：类型判定/魔数、XSS 与转义、markdown、CSV、XML 解析器、ZIP（含 ZIP64/截断/坏输入）、
                      #   docx/xlsx/pptx 三种 Office 文档、render 分派、**G2 组：把源码装进没有 require 的 vm
                      #   上下文，逼它只能走浏览器那条 DecompressionStream**（坑 118）；
                      #   ★ O 组「真实世界的怪形状」22 条 + P 组「图片预算是文档级的账」9 条；
                      #   ★ 2026-10-08 第三轮：那批真实形状现在**两轨都渲染过**（4 条两轨逐字一致 +
                      #     2 条内容级正向对照，挡"两轨一致地什么都没渲染"）；结构红线。
                      #   ▸ 夹具 scripts/ooxml-fixture.js 是**独立写的 ZIP 打包器**：
                      #     写包的和读包的是两份实现，它们对同一份字节达成一致才算真证据。
                      #   判据：只在 Node 里跑绿的代码，浏览器那一轨可能一次都没被执行过
npm run test:files   # ★ 2026-10-08 共享文件存储层回归（sfu/files.js）59 项：名字消毒（穿越/控制字符/无扩展名/
                      #   台账撞名）、上传与 .part 卫生、三档配额（**一条断言只动一个变量**）、台账与磁盘对账、
                      #   since 下界（房间号回收复用）、删除与整房间清理、内联白名单 servePolicy、并发写台账、
                      #   ★ 自证"没把文件写进真实 sfu/files/"（与账号类测试必须用临时库是同一条纪律）
npm run review:office # ★ 2026-10-08 真实 Office 样本回扫（路线图 I8）：扫磁盘上现成的真 docx/xlsx/pptx，
                      #   只报**结构统计**（页/表/格/图/字符/HTML 体积/耗时/抛错原因），
                      #   **绝不打印内容、绝不写文件**——会议材料里可能有工资表，一台顺手把内容打出来的工具不能进仓库
npm run test:office  # 上面那台仪表的自检（脚本 --selftest）
npm run check:files  # ★ 2026-10-08 **两个真浏览器**验共享文件（★ 58 项）：★★★ A 一打开文档 B 的面板自己起来
                      #   并渲染出同一份内容（读 B 页面文字，不是"事件到了"）、晚到者靠 files-state 补发、
                      #   滚动按比例跟到同一行、★★ 断环（B 跟随产生的滚动不回广播）、★★ XSS 只是文字、
                      #   面板底边不压控制坞 + elementFromPoint 命中测试 + **首屏遮罩确已收起**（坑 119）；
                      #   ★ 第三轮加：键盘入口（真按 Enter）、跟随中被删文件的反应、
                      #   ★★ S 组 6 条"跟随不许抢主讲"（坑 128）、PDF 翻页、390×844 手机形态
npm run test:asr     # 服务端 ASR 单测（探测/能量闸/清洗/碎片判据 isFragmentOf/配置模板）★ 36/36
npm run test:asr-live # ★ 语音闭环端到端（TTS→RTP→真管线→转写→应答），**带正向前置对照**；
                      #   ★ 2026-10-03 开场清场 + 按 ts 过滤 + 失败也清理（此前会被上一次运行污染）
                      #   ★ 2026-10-09：**默认就等主引擎就位**（本地 Qwen worker 加载 ~55s），
                      #     因为不等时这段跑的其实是 whisper 兜底 = **不是用户配置的那台引擎**；
                      #     要跳过等待做 A/B：TEST_ASR_WAIT_WARM=0；专用端口 3017
npm run test:e2e-media # ★ 真浏览器多人音视频回归（假摄像头双页进同一房）★ 38/38
                      #   覆盖：在流画面 videoWidth>0 / 只听不看 / 每路音量 / 3 层 simulcast 降层 /
                      #   hero 手机形态 / 字幕与播报延迟读数 / 390px 全控件不越界；专用端口 3016
npm run bench:tts    # ★ 本地 Qwen3-TTS 参数档基准（float32/bf16 × 流式/非流式，量 RTF）
                      # ★ 2026-10-03f~04 「真浏览器验界面」九件套（都要先起服务器或用 CHECK_URL 指到
                      #   专用端口；每条开头都是 ?nosw=1 + 让页面自报源码指纹，防 SW 缓存假绿——坑 40）：
                      #   check:toggle 12 项  控制坞开关的两层标签/环形脉冲/首次摆动
                      #   check:think  13 项  AI 思考条（阶段清单 + 呼吸/收焦）
                      #   check:glow   12 项  登录页 WebGL 光轨（读 gl.readPixels 量到 0.00→0.93→1.20）
                      #   check:pill   21 项  拱形升起按钮：预览页那一排 + 会中控制坞那一排
                      #   check:visual 15 项  聊天分组/证据链/背景真的在动
                      #   check:icons  12 项  ★ 每个 svg.i 的实际渲染宽度 + 全页无 emoji + AI 耳朵的 scaleY
                      #   check:dock   22 项  ★ 11 档视口下控制坞不溢出且不与字幕条重叠
                      #   check:layers  5 项  ★ elementFromPoint 命中测试：白板别盖住字幕条与按钮（坑 80）
                      #   check:login  11 项  ★ 第一屏：11 个 id 没丢 / 焦点环 / 密码可见切换 / 主次分层
                      #   结论已回填《性能测试报告.md》5.3：RTF 6.1~7.4，非流式无收益 → 不改加载参数
npm run bench          # E4 压力基准（4/8/16 路，约 1 分钟，独立 Worker，不用起 3001）
npm run agent          # ★ 09-24b 启动被控端桌面代理；★ 09-30 两种用法：
                       #   不带 --room = 设备码模式（推荐，启动即打印 6 位设备码，可加
                       #   --connect-password / --secure-password(=无人值守) / --code 固定码）
                       #   带 --room 123456 = 老用法，进既有会议房
npm run test:agent     # ★ 09-24b 桌面代理端到端（真起 Chromium：抓屏 JPEG + 坐标注入 ±3px + 远程导航
                       #   + ★ 09-30 画质档 ⑥e~⑥e5）★ 2026-09-30 实测 24/24（专用端口 3012，被占明确拒绝）
npm run test:e2e       # ★ 09-24b 真机远程桌面 e2e（真双窗 + 390×844 手机视口双指/单指，出截图）★ 15/15（专用端口 3013）
npm run publish:mesh   # ★ 09-24b 一键发布 Mesh 版（生成 publish-mesh/ → 体检 → 可选 --tunnel/--bundle/--check）
npm run test:publish   # ★ 09-24b 发布链回归（含 --check 过期闸：源码改了不重发必报错）★ 2026-09-24 实测 30/30
node --check public/client.js && node --check server.js      # 改完 Mesh 版 JS 查语法
node --check sfu/public/client.js && node --check sfu/server.js  # 改完 SFU 版 JS 查语法
# ★ 09-24 全部回归合计 440 项全绿：SFU 149 + 存储 49 + 优雅退出 9 + 冒烟 136 + Mesh 36 + 代理 16 + 发布 30 + e2e 15
# ★ 09-30 远程控制本轮**实测**（6 组 476 项全绿）：SFU 184 + 冒烟 189 + 存储 55 + 优雅退出 9 + 代理 24 + e2e 15；
#   Mesh 36 / 发布 30 本轮**未重跑**（未触碰对应代码路径，数字仍是 09-24 的）。
#   存储 49→55：工作区里另有一批**未提交**的 09-30 安全改动（`sfu/password.js` 口令 V2 + 平滑重哈希、
#   `sfu/store.js` 惰性开库可重开、`scripts/legacy-user-fixture.js` 测试基建），本轮重跑 test:store/shutdown 复验为绿，
#   **但它不属于"设备码 + 画质档"这次任务**，提交与文档回填要分开对待。
```

- ✅ **`npm run doctor`**：环境自检（24 项 / 4 组：环境·配置·端口·跨网 ICE；★ 2026-10-06 实测 23 通过 / 1 警告 / 0 失败），失败项都给"怎么修"；`node scripts/doctor.js --json` 出结构化结果。换机器 / 交付前先跑一遍。
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
| C→S 应答 + S→C 定向 | `desk-register` / `desk-connect` / `desk-granted` / `desk-pending`（★ 09-30 设备码配对直连，借鉴 billd-desk） | `desk-register {name,platform,browser,connectPassword,securePassword,code?}`→`{deviceCode}`（被控端代理专用；**设备码就是房号**——建一个 `isDesk:true` 的私有房间，`router:null` 不碰媒体，同一时刻只允许它的 agent 在场，代理离线**即刻毁房**、不留 60s 宽限）；`desk-connect {deviceCode,password}`→`{granted,hostId,hostName}`（控制端**不用进会议**；校验顺序=格式→限流 10 次/分→设备在线→连接口令（连接密码**或**安全密码任一匹配）→互斥 `busy`；随后 `deskEnterRoom()` **轻量进房**：只 `socket.join`+`room.members.add`+`socket.roomNumber`，**不建 Transport、不订阅媒体、不广播成员**）；口令=安全密码 → 服务器直接登记 `remoteCtl` 并广播 `remote-state` + 发 `desk-granted{unattended:true}`；否则转 `remote-request` 给代理、给控制端发 `desk-pending`，代理确认后通用 `remote-answer` 处理器补发 `desk-granted{unattended:false}`——**两条路径前端只听一个事件**。⚠️ ack 与事件是两趟往返，断言要等一拍（坑 61） | 设备码直连远程桌面（登录页「🖥️ 用设备码连接」→ `#deskOverlay`） |
| C→S 定向（**老通道新语义**） | `remote-input` 的 `{kind:'quality', preset}` | 走**与鼠标键盘完全相同**的 `remote-input` 门禁（不新造事件 = 复用闸门与限流）；`preset` ∈ `smooth`/`standard`/`hd`，代理 `applyQuality` 改 `quality/fps/长边上限` 并 `cdp.setScreencast()` **重开抓屏**；未知档名忽略且当前档不变（拼错不致命）。**三层帧率**：档位定中枢（策略 6~24）→ `remote-quality` 闭环 ±2 微调 → 代理/服务器对任何请求硬钳 **2~24**（安全线比策略线更宽，两层有意分开） | 画质档按钮 + 弱网自适应（`#rdConsole` 的 `.rd-bar` 四颗） |

**2026-10-03 新增/扩展（语音下行观测；总表见 `sfu/protocol.js`，那里还补了原先整类漏写的 S→C 广播）**：

| 方向 | 事件 | 载荷 / 口径 | 用在哪 |
|---|---|---|---|
| S→C 广播（扩展字段） | `asr-caption` | 定稿帧新增 `latMs`（**说完→字幕定稿**的服务器实测毫秒；起点=最后一个判定有声的 RMS 窗，窗长 0.5s → 是**下限**）与 `stage:{wait,trans}`（末段口径拆分：等待=静音判定+调度，转写=模型耗时）；`latMs<=0` 或超 120s = 服务器判为不可靠，前端**保持上次读数不编数** | 字幕条 `⏱` 三色读数（client 第 37 步）/ 值守日报「链路质量」 |
| C→S（无 ack，观测上报） | `ai-speech-lat` | `{ ms }`：**唯一一条客户端→服务器的观测上报**。锚在 `chat-message(tts:'server')` 到达、止于 `<audio>` 的 `onplaying`（"真的开始播"而不是"服务器说它发了"）。**自报数字**：只做区间钳制（`<=0` 或 `>60s` 丢弃），不参与任何权限/配额——伪造它最坏只能让指标难看 | 播报延迟指标 `/metrics` 的 `sfu_ai_speech_latency_ms{kind=avg\|max\|last}` + watch 告警 |
| S→C 广播（新增 gauge） | `/metrics`、`/api/rooms` | `sfu_ai_asr_primary_ready`（主引擎此刻接得住活吗）/ `sfu_ai_asr_caption_latency_ms*` / `sfu_ai_speech_latency_ms*` / `collab.capLat`+`collab.speakLat`（**同一个对象**，两处不各算一份均值） | watch 的预热期分诊（"还没起来"vs"起来却不用"）与面板两格 |

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
    ★ **09-30 更新（根因查清 + 在线自愈路径实测打通）**：postinstall 失败的**两层根因**——
    ① Node 的 fetch（mediasoup 下载用）**不读 Windows 系统证书库**：加速器对 HTTPS 做 MITM，
    它的 CA 只装在系统库里，Node 用自带 CA 包 → `unable to verify the first certificate`；
    ② 下载失败回退 meson 本地编译，本机无 VS 工具链必挂。**开着加速器时一条命令即可在线装好**：
    `NODE_OPTIONS=--use-system-ca npm rebuild mediasoup --ignore-scripts=false --foreground-scripts`
    （Node 22.15+ 支持 `--use-system-ca`，本机 v24 实测：下载 2.0MB tgz → 校验通过 →
    替换 worker.exe → 服务器"媒体引擎就绪"。`.npmrc` 注释已记同一配方）。
    默认仍保持 ignore-scripts=true：无加速器的新机器离线也能 npm install（worker 手动放置兜底）。
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

57. **★ "装了 ≠ 用上了"：能力探测命令在该平台上必须真的成功**（09-28 实修，本次最贵一脚）**：
    whisper 装好了（openai-whisper 20250625 + tiny/small 模型已缓存），但服务器一直报
    "未检测到 whisper" → `asrEnabled=false` → 前端悄悄退回浏览器 Web Speech
    （用户实测："不要再用浏览器的了"）。根因：探测用 `whisper --help` 判存活，而 whisper CLI
    在 **Windows GBK 控制台**下打印帮助会 UnicodeEncodeError **退出码 1**；兜底候选 `__py__`
    还把 `process.execPath`(node.exe) 配 `-m whisper` 用（永远失败）。
    对策：① 探测口径固定为"命令跑通且退出码 0"，并**给所有会往 stdout 打非 ASCII 的子进程
    UTF-8 环境**（`PYTHONIOENCODING=utf-8/PYTHONUTF8=1`）；② 同一能力只保留一个实现
    （`sfu/ai/asr.js`），server / doctor / 自测共用；③ **给"能力开关"写断言**——
    本次事故任何功能单测都不会红（函数都对），红的是那条没人写的
    "`probeWhisper()` 必须返回 runner + `/config.json` 的 asrEnabled 必须为 true"。
    推广：凡是"某能力装了就该生效"的地方（ffmpeg/whisper/TURN/openssl），
    都要有一条"探测必须成功"的回归。

58. **★ 多说话人共用文件名 = 互相覆盖**（09-28 实修）**：ASR 分段录音原先所有成员共用
    `asr-<房间号>/seg-%04d.wav` —— A 的 `seg-0003.wav` 会被 B 的同名文件覆盖，
    两人同时说话时转写直接错乱/丢失（**单人测试永远发现不了**）。
    凡"每个实体各自产出一批文件"的场景，目录/文件名必须带实体标识
    （`asr/<房间>/<memberId>/`），并且**测试要覆盖 ≥2 个并发实体**。

59. **★ 读"正在被写入的文件"必须先确认它已封口**（09-28 实修）**：ffmpeg 分段录音时，
    最新那一段仍在写入，而转写循环扫到"大小 ≥ 阈值"就转 → 每句话的尾巴丢在未落盘的部分。
    对策：**跳过最新一段**（它必然在写）+ 两次采样大小一致做双保险 + 进程退出后**补转最后一段**；
    收尾路径同样要覆盖（否则会议最后一句话永远丢）。

60. **★ 复制带注释的配置模板 = 配置静默失效**（09-28 实修）**：`config.example.json` 里写满
    `//` 注释（给人读的），README 让人"复制改名"，而加载器是严格 `JSON.parse`
    → 注释成语法错 → 服务器 catch 后**按默认值继续跑**（"我明明配了却没生效"）。
    对策：`sfu/jsonc.js` 提供字符串感知的注释剥离 + 尾逗号容错，server 与 doctor 共用；
    文档模板必须能被"复制即用"，这类"照文档做反而出事"的坑要用测试钉住。

57. **★ "复用端口上已有的服务器"= 假绿（09-30 实修，本轮最严重的一处）**：
    `test-agent.js` 原先写的是：
    `if (await ping()) { console.log('⚠️ 3001 已有服务器，复用它'); return; }`
    ——只要 3001 上有任何服务器就**复用它接着跑**。后果：**测试验的不是本次代码**。
    本轮就是这么被坑的：我新加的 `remote-quality` 断言全红，排查半天怀疑门禁/接线，
    **真实原因是端口上那台是「上一次被中断的测试」留下的孤儿进程（旧代码）**。
    更危险的是反面——它也可能**全绿**，而那不是"通过"，是"验了个不存在的东西"。
    ▎`test-sfu-signaling.js` 早就修过这同一个反模式，并写下了正确判据：
      "环境前提不成立时，唯一诚实的做法是明确失败并说清怎么修。宁可红得清楚，也不要绿得可疑。"
      → 这次是把 `test-agent` 与 `test-e2e` **补齐**。
    **同项目同一个坑只修一半 = 半迁移 = 等于没修。改完一处要 grep 全仓找同类写法。**
    ▎附带：`test-e2e` 没有"复用"分支，但**隐患一样**——端口被占时 spawn 出来的服务器
      EADDRINUSE 直接退出，而 `if (await ping()) break` **照样 ping 通**（ping 到别人的服务器）。
      **"没写复用"不等于"不会复用"**，判据要看"有没有可能连上非本次起的进程"。
    ▎三个测试脚本现在都：**专用端口（3011/3012/3013 避开用户常用的 3001）+ 端口被占则明确拒绝
      + 支持环境变量换端口**（跑不了不该是唯一出路）。**假绿比假红危险得多：假红有人查，假绿没人发现。**

58. **★ 性能优化先量"真正的瓶颈量"，别量错指标（09-30 实修）**：
    用户反馈白板"卡"，我第一版基准测的是 **CPU 耗时**——900 次 pointermove 只花 16ms，
    看起来毫无问题，差点得出"白板其实不卡"的结论。
    真正该量的是 **网络消息条数**：一次 300 点拖拽 **302 条 SCTP 消息**（1:1 无合并）——
    真机 1000Hz 鼠标就是每秒上千条小消息，发送缓冲排队 + 对端逐条处理 → **延迟随拖拽累积**。
    （本地回环测不出延迟，因为回环几乎不排队——**"本地很快"不能推出"跨网没问题"**。）
    **判据：先问"用户感知的慢，是被哪个量决定的？"** ——
      计算慢 → 量 CPU；延迟累积 → 量**消息条数/排队长度**；画面顿 → 量**帧间隔中位数**。
    改完用**同一个脚本复测**：302 → 3 条（-99%）、重绘 4.3ms → 0.6ms 且不再随点数增长。

59. **★ 高频事件里两件事会强制同步布局（forced reflow），都要治（09-30 实修）**：
    ① `getBoundingClientRect()`：白板每次 `pointermove` 都调它换算坐标 →
       一次拖拽几百次强制 reflow。**改法：笔画期间缓存 rect**（一笔之内不会变；resize 时清）。
    ② `el.scrollTop = el.scrollHeight`：**读 `scrollHeight` 要求浏览器立刻算完刚改的文本布局**。
       AI 流式每个 token 都做一次 → **一条 200 字答案 = 200 次强制 reflow**，
       主线程被打断 200 次，观感就是"一顿一顿"——**不是模型慢，是渲染把它拖慢了**。
       **改法：增量攒批、按 rAF 一次刷（DOM 写入与 scrollTop 同帧）**，逐字视觉依旧连续。
    **通用手法：把"会读布局"的调用（rect/scrollHeight/offset*）从"每事件一次"降到"每帧一次"，
      并把它们与写操作放在同一帧里（读写分离，别交错）。**

60. **★ 固定参数在变化的链路上必然有一半时间是错的（09-30 实修）**：
    远程抓屏帧率是**开机参数写死的**（默认 12fps）：网好时白白浪费带宽（画面发涩），
    网差时帧持续堆积（越堆越延迟）。→ 改成**闭环自适应**：控制端实测帧到达间隔与 RTT，
    回传建议值，被控端只调本地限流间隔（下一帧即生效，无需重启抓屏）。
    ▎三条必须记住的设计约束（否则自适应会变成"震荡器"，比固定值更难受）：
      · **反馈必须来自能观测到的那一端**：发送端看自己的队列不代表链路状态；
      · **反馈要防抖动**：滞回死区（90% 才升 / 60% 才降）+ 最小调整间隔 + 样本量门槛
        （静止画面本来就不出帧，**不能当成"链路差"**）；
      · **两层范围分开**：策略范围（算法只取 6~24）与硬安全范围（任何请求都钳到 2~24）——
        以后调策略时不该顺带放宽"别人能不能给我设成 0.1fps"这条安全线。
    ▎**控制律要抽成纯函数**（`rdDecideFps`）才可穷举断言——性能逻辑同样需要确定性，
      否则只能"跑起来看着还行"，而画面忽快忽慢在真机上极难复现。

61. **★ 服务器"先发事件、后回 ack"——一拿到 ack 就断言必然读到 null**（09-30 实修，设备码轮）：
    `desk-connect` 的处理体是 `socket.emit('desk-pending', …)` / `io.to(房号).emit('remote-state'|'desk-granted', …)`
    **在前**，`return ok(callback, {granted:false})` 在**后**。测试里写成
    `const resp = await request('desk-connect', …); ok('应答里 granted 应为 false', resp.data.granted === false)`
    ——await resolve 的那一刻事件已经收到、断言却先于 ack 的**网络往返**跑，读到 `undefined`，
    三条断言全红。**代码没错，是断言站错了时间位置**（同坑 3"监听先于 emit"的镜像：
    那条讲"注册要早"，这条讲"读要晚一拍"）。
    修法：ack 断言前补 `await sleep(400)`，且**监听器一律在 `desk-connect` 之前注册**
    （`remote-state` 那一版就是因为挂监听晚了，事件飞过去、数组永远空）。
    **判据：凡是"一个信令会触发 ≥2 个出站消息（事件 + ack）"的断言，都要显式说明依赖了先后顺序。**

62. **★ 一个执行器不能有两个控制回路——档位是"策略"、自适应是"微调"，必须显式分层**（09-30 实修）：
    闭环自适应（`remote-quality` 回传 fps）已经存在之后，我又加了画质档
    （`{kind:'quality'}` 带 fps/quality/尺寸）。两者**都写同一个 `agent._frameGap`**，
    结果两条回路互相拉扯：流畅档把 `_frameGap` 设成 5fps，客户端自适应下一拍又把建议顶回
    硬下限 `RD_FPS_MIN=6` → 表现为"**点了流畅但帧率没真降下去**"，且没有任何报错。
    修法（= 坑 47"一个概念只能有一个来源"的执行版）：
      · **档位只定中枢**（`rdTargetFps`，切换时清空采样数组 `rdIntervals`/`rdLastFrameAt`，
        否则拿"切档前的旧节奏"当"新链路状态"判断，会立刻误降一档）；
      · **自适应只在中枢附近 ±2 微调**，不再自己发明目标；
      · **档位 fps 下限必须等于自适应下限**（两处 5→6 同改，`agent/QUALITY_PRESETS` 与
        `client/RD_FPS_MIN`），否则两个来源的取值区间根本不重叠；
      · **硬安全层单独保留**（代理/服务器钳 2~24）：它防"乱传参数把对端拖垮"，
        与"正常该用多少"是两层职责，**别合并**（合并后想加 3fps 超省流档就得放宽安全线）。
    **通用判据：给某个状态新增一个写入方之前，先 grep 谁还在写它。**

63. **★ 测"变化才推帧"必须制造**真的会变色**的变化——`document.title` 不算**（09-30 实修）：
    切画质档后要断言"重开 screencast 没把链路搞断"，我用
    `setInterval(() => { document.title = "t" + Date.now(); }, 50)` 当触发器，
    帧数几乎不涨 → ⑥e3 红。**症状和"链路真的断了"一模一样**，差点去查 `cdp.setScreencast` 的
    stop/start 接线（那段其实是对的，另有 ⑥e4"监听器不叠加"作证）。
    根因：CDP screencast 是**合成器级**的变化检测，改标题不动任何像素。
    正解 = 改**绘制属性**：`document.body.style.background = "hsl(...)"` 每 60ms 变一次。
    顺带把下一段 ⑦ 的重复触发器删掉（两个同写 background 的定时器只会让后面的断言
    "必然通过"，掩盖真实帧率）。
    **判据：断言"某个依赖 X 的机制还活着"之前，先确认你真的产生了 X**——
    与坑 55（测空状态前先确认你在的那个空对象）同源：**测试的触发条件本身也要被验证。**

64. **★ 外部模型"没人说话时也会还你一句话"：语义输出的门槛必须量**能量**（2026-10-02 实修，本轮最贵的一条）**：
    用户报"AI 助理一直收到重复的一句话 / 对话很混乱 / 后来它回答没有说话"——三条症状是**同一个根**。
    现场证据在 `sfu/captions/cap-746646-20261002.jsonl`：账本里每 2.4~4s 一条一模一样的
    **`请用简体中文输出。`**（`asr:true`）。那不是有人在说话，那是 whisper 在**纯静音段**
    把 `--initial_prompt` 顺着"续写"成了句子——**模型不会返回空，它会编一个看起来像输出的东西**。
    ▎为什么旧门槛挡不住：管线判的是 `size < 40000`，量的是**时长**；一段 4s 静音有 128KB，
    照样进转写。而 `transcribeFile()` 的注释白纸黑字写着"返回空串表示这段没人说话"——
    **这个假设本身就是错的**，所以全链路没有任何一处能拦住它。
    ▎放大链（一个源缺陷如何变成三个体验灾难）：假字幕 → 落进 20s 追问窗口（`isFollowUp`）
    → 每条都触发一次完整应答（流式气泡 + TTS + 再入账本）→ 应答风暴 + 账本污染（纪要也跟着错）
    → 每条假字幕又把 `lastUserSpeechTs` 往前推 → 浏览器朗读的"迟到不读"闸被永久关闭
    → 用户看到的就是"它答应了却不说话"。
    ▎修法（两道，缺一不可）：① **能量闸** `Asr.measureWavLevel()`——转写前直接读 wav 样本算峰值
    dBFS（64000 次数组遍历，亚毫秒、零进程），整段低于 -45dB 就删段不叫模型；
    ② **语义清洗** `Asr.cleanTranscript()`——擦提示词回显与经典幻句（「字幕by XXX」「谢谢大家」），
    擦完只剩标点/单字就返回空串。**并且**下游补重复句闸、AI 回声闸、在途锁与最小应答间隔。
    ▎通用判据：**凡是拿外部模型/第三方 API 的"有输出"当作"有内容"用的地方，都要问一句
    "输入为空/无效时它会还我什么？"** 这类缺陷单件测试永远不红（探测正常、转写正常、逻辑正常），
    只有"把真音频推上真管线再盯着账本"才看得见——所以本轮把断言补进了 `test:asr-live`。
    ▎顺带一条同源旧账：`--initial_prompt` 这类"给模型的指令句"要写成**不会被当成句子回显**的
    中性名词短语（现在是一个常量 `Asr.ASR_PROMPT`，Node 侧单一来源，worker 经 env 取用）。

65. **★ 换进程推流 = 换 UDP 源端口 = comedia transport 不再收包：一条"0 条"的假绿（2026-10-02 实修）**：
    为 G2（重复句）补测试时，我第二次用**新的 ffmpeg 进程**往同一个 PlainTransport 推流，
    断言"账本新增 0 条"——**通过了，但它绿得可疑**：ingest 用的是 `comedia: true`，
    它只认**第一个发包者的 addr:port**，第二个进程换了临时端口，包**整批被丢弃**。
    也就是说音频根本没进系统，"没有重复字幕"当然成立。
    ▎修法：所有需要"多段音频"的断言改成**一条拼接好的 wav、一个进程、一次推流**
    （说 → 停 6s → 再说 → 停 3s），静音与重复都待在同一条流里，断言才有意义。
    ▎通用判据：**断言"某量为 0"之前，必须先证明"输入真的进去了"**——
    与坑 57（复用端口上已有的服务器=假绿）、坑 63（触发条件本身也要被验证）同族。
    本轮还顺手记下：项目里第一次写出 G2 时我没意识到自己在测一个空转的链路，
    是"0 条 + 0 次应答"这个**过于干净**的结果让人起疑的。

66. **★ 双轨系统的"让位闸"会把回落路径一起挡死（2026-10-02 实修）**：
    AI 语音有两条轨：服务端神经语音（MP3）与浏览器 `speechSynthesis`。设计是"服务端可用 → 浏览器让位"，
    合成失败时服务器补发 `ai-tts-fail` 让浏览器**回落朗读**。但回落调用的还是同一个
    `speakAiText()`，而它开头那句 `if (aiTtsEnabled) return;` **一视同仁地把回落也挡了**——
    于是"服务器声明会有音频 → 音频没来 → 浏览器又被让位闸拦住"= **永久静音，且没有任何报错**。
    另一半原因同样致命：`aiTtsEnabled` 只在进房时从 `/config.json` 读一次（结果被
    `asrCfgPromise` 缓存），而端点可达性是**会漂的**（Edge 403 随网络出口变化）——一次性快照必然失真。
    ▎修法三件：① 让位闸加**例外口**（`speakAiText(text, {force:true})`，只有"确认服务端这条已失败"能绕）；
    ② 状态漂移要**广播**（服务器定期重探 + 翻转时 `io.emit('ai-tts-state')`，客户端当场改标志位）；
    ③ 客户端连吃两次失败就**本地临时停用**服务端轨 5 分钟（自愈，不必等服务器重探）。
    ▎附带抓到同类一处：`ai-audio` 在 `play()` **之前**就 `pendingServerTts.delete(ts)` 销账，
    404/被自动播放策略拒绝时既无声音也无回落——**销账时机应当是"真的开始播了"（onplaying）**。
    ▎通用判据：**写"降级/让位"条件时，要顺带检查"降级路径自己是否也被同一个条件挡住了"**；
    **凡是缓存下来的能力开关，都必须有一条失效或翻转时重新下发的通路。**

67. **★ 探测超时被当成"没装"——同一个坑在第三个模块上复发（2026-10-02 实修，收口成 pyprobe.js）**：
    09-24 修 ffmpeg 时立过这条纪律（坑 37：**要区分"真没装"与"此刻没答上来"**），但当时只改了 ffmpeg 一处。
    Python 模块探测在三个文件里各写了一份同样的 `execFile(python, ['-c','import X'], {timeout: 15000}, err => !err)`
    （asr.js 探 whisper、asr_qwen_local.js 探 qwen_asr、tts_qwen.js 探 qwen_tts）。
    ▎实测：`import qwen_asr` 冷启动 **21.7s**、`import qwen_tts` **18.4s**（torch 一族就是这么慢）
    → 15s 上限一冷就误判"没装" → 本地 Qwen 引擎**悄悄不启用**，用户侧表现为
    "识别还是那么慢、AI 说话还是机械音"，而且没有任何一行报错。
    ▎更糟的一半是**假日志**：`warm()` 写成 `try { await boot(); } catch {}`，恒返回 undefined，
    调用方 `.then()` 里无条件打印"🔥 已预热"——**探测失败也报成功**。
    没人会去怀疑一行自己打的 ✅/🔥，这类假绿比红更危险（同坑 57/65）。
    ▎修法：新增 `sfu/ai/pyprobe.js` 作**唯一实现**（与 password.js / jsonc.js 同一条路）：
    ① 按 errno/输出区分 `enoent` / `ModuleNotFoundError` / `timeout`；② 超时**再给一趟长预算重试**
    （冷启动只发生一次，重试几乎必中，而正常路径不被拖慢）；③ 解释器逐个试；
    ④ `warm()` 返回 `boot()` 的真实结果，调用方按返回值决定打 🔥 还是打 ⚠️。
    ▎通用判据：**外部依赖的"可用性探测"必须有失败分类与重试，且探测结论要能被下游证伪**——
    凡是"探测失败 → 关掉某功能"的地方，都要有一条"这个功能确实开着"的断言（本轮补在 test:qwen 的本地轨）。

68. **★ 共享变量有两个读者时，"攒批清空"的那一个会把另一个变成静默空转（2026-10-02 实修）**：
    给流式答案做"按句朗读"时，我写成 `speakStreamPart(box, box.buf)`——函数逻辑对、调用点接上了、
    `node --check` 过、冒烟也绿（它断言的是源码形状），但**这条通路永远无事发生**。
    根因：`box.buf` 是 DOM 增量渲染的**攒批缓冲**，`applyStreamBuf()` 每帧把它 `textContent +=` 之后
    就 `box.buf = ''`。于是朗读侧每次看到的都只是"一帧内的三五个字"，
    而"三五个字里出现句末标点"几乎不可能 → 切句永远切不出东西，`if (cut - from < 6) return;` 永远命中。
    ▎症状与"功能没做"一模一样（**AI 不出声**），但代码看起来完全正确——
    这类缺陷不在逻辑里，在**两个读者对同一个变量的假设冲突**里。
    正解：给朗读侧一份**不被消费的全文副本** `box.rawAll`（累加、只读），
    攒批缓冲继续归 DOM 用。判据：**写下"读 X 的当前值"之前，先 grep 谁还在写 X、谁会把它清空。**
    ▎同一轮另一处同源：`speechSynthesis.cancel()` 只让旧句子"**听不见**"，不让它"**不再回调**"——
    被取消的那句会迟到地触发 `onerror`，而那时新一轮的句子已经 push 进队列，
    旧回调里的 `aiSpeakQueue.length = 0` 会把**新答案的上一句整个倒空**
    （表现就是"第一轮问候语念完之后 AI 再也不出声"）。
    修法两件缺一不可：**顺序改为 cancel → 清队列/断泵 → 再 push**，
    外加"泵代号"（`aiSpeakGen`）让旧闭包一看代号不对就静默退出。
    ▎通用判据：**取消一个异步操作时，要连带取消它的回调所有权**（令牌/代号/epoch 都行），
    与坑 66"降级路径不能被同一个让位闸挡死"同族——都是"清理动作比它看起来更广泛"。


69. **★ 顶层调用写在它依赖的 const 之前 = 静默砍掉文件后面的所有代码（2026-10-03 实修）**：
    给首页加 hero 时把 `initHero()` 紧跟在 `initIcePrecheck()` 后面调用，
    而它要读的 `const HERO_TEXT` 声明在下面几十行处 —— TDZ 抛错。
    ▎真正贵的不是那行错，而是**它把本文件后面所有顶层语句一起砍掉**：
    实测 `initAiChips / initBoardActions / initAiVoice / renderBoard / renderChatUnread / renderAiChips`
    **六个初始化一个都没跑**。而页面看起来是好的（大部分初始化在更前面就做完了），
    控制台也什么都没报（脚本异常发生在加载阶段，工具里看不到红字）。
    更巧的是：同一轮用户正好在抱怨"AI 回答没声音"——`initAiVoice()` 被砍掉是它的可能成因之一。
    ▎**判据：顶层那串 `init*()` 是有顺序依赖的语句流，任何一行抛错都会截断后面全部。**
    所以：① 调用点写在它依赖的 const/函数**之后**；
    ② 新增 init 调用后，**必须在真浏览器里确认后面那几个 init 也跑了**
       （本次靠"页面元素在不在"发现，下次可以直接打印一条"尾部初始化完成"）；
    ③ 与坑 57/65 同族：**静默截断比报错危险，因为报错有人会去看。**

70. **★ 变化驱动的信源必须配"输入回声"，否则"没反应"和"反应慢"分不开（2026-10-03 实修）**：
    远程桌面控制台报"点下去 → 画面动"要 **2287ms**，而链路本身很快（RTT 低、帧率正常）。
    根因：CDP `Page.startScreencast` 是**合成器级变化检测**——像素没变就一帧都不发。
    于是"点了空白处 / 点了没有视觉反馈的控件 / 鼠标只是移动"这些情况下，
    控制端**根本收不到任何画面**，直到别处恰好有个变化。
    ▎用户描述永远是"它反应很慢"，但真相是"**没人报信**"——
    这两种病的处方完全不同：前者要加带宽/降分辨率，后者要**主动补一帧**。
    ▎修法（`agent/index.js` 的 `scheduleEcho()`）：注入输入后 120ms 复查，
    若这期间抓屏没出过帧，就主动 `Page.captureScreenshot` 补一帧推过去。
    实测 **2287ms → 153ms**。三重限流防它变成风暴：突发输入合并成一次补帧、
    抓屏已经出帧就不补、补出来的帧仍走帧间隔闸门。
    ▎**通用判据：凡是"对端只在有变化时才说话"的通道（变化检测抓屏、diff 同步、
    事件溯源广播、只在数据变化时推流的订阅），都要问一句
    "我发了请求但它那边没变化，我怎么知道请求到了？"** ——
    答案是给这条通道配一个**回声/心跳**，而不是把超时调大。
    ▎顺带一条安全纪律：`stopStream()`（撤权/断线）要把待发的回声定时器一起清掉——
    控制权已经收回还去抓屏，等于多一次无谓的隐私面。

71. **★ 一次"能力升级"会把另一项已修好的优化悄悄关掉（2026-10-03 实修，兜底预热轮回报）**：
    09-30e 为"第一次识别特别慢"加了 whisper 常驻 worker 的**开机预热**（模型加载 ~13s，
    不预热则开机后第一句白等）。09-30c 把主引擎切成 `qwen-local` 时，那段预热被改成
    "qwen-local 就跳过，省 1.5G 内存"——**理由当时完全讲得通**，而它悄悄把 09-30e 那把刀收回去了：
    Qwen worker 冷启动 ~55s，这期间 `handleSegment` 会**现场起** whisper（带模型加载），
    实测首段 15.0s → **开机后第一分钟的每一句字幕都多等 15s**，正是当年那个症状原样复发。
    ▸ 修法不是选边站，而是**让两个目标同时成立**：兜底引擎照常预热，
      `releaseFallbackAsr()` 在主引擎就绪那一刻把它 kill 掉——
      内存只在"两个都在"的重叠窗口（≈Qwen 加载时间）翻倍，首句延迟回到正常档。
      实测 9.2s → 5.3s（whisper 路径），主引擎就位后 3.5~4.0s。
    ▸ 同一条缺陷的**告警侧**：`watch.js` 的"主引擎退回"只看"这一轮是谁转写的"，
      而预热期走兜底是**正确行为** → 10s 一轮连两轮就落在 55s 的窗口里，每次开机都可能误报。
      补 `sfu_ai_asr_primary_ready` 之后才分得清两种病：
      **还没起来**（耐心等 `WATCH_ASR_BOOT_ROUNDS` 轮，超了报 `asr-engine-stuck`）
      与 **起来了却不用**（两轮就报退回）。
      ▸ 这里还有一条更容易做错的：老服务器**根本没有这一行**，
        若把"读不到"当成 0（没就位），兜底告警在老服务器上就**永远不响**——
        于是 `flagOf()` 返回 `null` 与 `0` 是两种语义，`null` 退回旧判据。
    ▎通用判据：**改引擎/改架构时，把"当初为这件事专门写的代码"列一遍**（grep 关键词与日志文案），
      逐条问"它现在还生效吗"。本次是预热，上一轮是 UI 上硬编码的 "whisper" 字样（坑 67 家族）——
      **同一处被改动会让另一处的正确性悄悄失效，而且两者都不报错。**

72. **★ 自测的历史残留会让"绿"变成"看运气"（2026-10-03 实修，append-only 归档轮回报）**：
    `test:asr-live` 固定用房间 999999，字幕账本是 `<房间>-<UTC日期>.jsonl` **一天一个文件、只追加**，
    而收尾的 `fs.rmSync(capFile)` 写在 try 的**正常路径**里——
    于是一次失败运行留下 2~3 条，下一次运行把它们数进 `allAsr.length <= 2`，
    **从第二次起必然红**，而报的错是"重复句在刷屏"（把测试设施的问题说成被测代码的缺陷）。
    第一次修完只跑了一次就 PASS，差点就此交付——**逼自己连跑两次**才看清剩下的是隔离问题。
    ▸ 三条修法缺一不可：① **开场先清场**（本次运行自己的文件）；
      ② 读取按 `ts >= 本次起点` **过滤**（万一同一分钟还有别的写入者，时间戳过滤仍成立）；
      ③ 清理挪进 `catch`（**成败都收走痕迹**，别让下一次背锅）。
    ▸ 与 09-24 那条"账号类测试必须用 `DB_FILE`/`USERS_FILE_LEGACY` 指到临时目录"是同一条纪律，
      只是这次栽在**文件型归档**上：凡是"被测代码会往持久化存储追加"的测试，
      都要问"上一次运行留下的东西会不会被我当成这一轮的产出"。
    ▎通用判据：**"某量为 0 / 不超过 N"这类上限断言，先证明你数的是本次的数据。**
      （同坑 65"断言 0 之前先证明输入真进去了"、坑 57"别复用别人留下的状态"。）

73. **★ "attach 那一刻的能力"被冻结成管线形态（2026-10-03c 实修，真浏览器 e2e 首跑抓到）**：
    `startAiAudioPipe` 用 attach 瞬间的 `WHISPER` 探测结果决定这路耳朵是"分段转写"还是"只量响度"，
    且**没有升级路径**——服务器刚启动、whisper 探测还没收敛（几秒）就进会/开字幕的用户，
    耳朵被打成只量响度形态后**永远哑**，哪怕 3 秒后引擎就绪也不复查。零报错、零日志，只有"没字幕"。
    e2e 首跑实测：90 秒零转写；上一轮跑得过纯属测试在步骤②白等了 94s（时间上躲过了探测窗口）——
    **"以前能过"和"现在能过"都不是证据，测试跑多快本身会改变被测路径**（时序敏感缺陷专挑快跑暴露）。
    ▸ 修法：开场先等"任意转写能力"就绪（新谓词 `aiAsrCapableNow()`：whisper 探测收敛 ∨
      qwen-local worker 活着 ∨ qwen-local 模型目录在位），上限 120s 超时才降级；
      **等待判据与形态判定必须共用同一个谓词**（两个 if 各写一份 = 将来改一处漏一处，坑 47）。
    ▸ 顺带救活一个潜在缺口：whisper 没装但 qwen-local 可用的机器，原来 `if (WHISPER)` 永远 false，
      管线永远只量响度——谓词化后按"有没有任何转写器"判断。
    ▎通用判据：**凡"按当时状态二选一"的形态分支，必须回答"状态后来变了怎么办"——
      要么等收敛再选，要么带升级路径；绝不允许"选错了就永远错下去"。**

74. **★ Prometheus 文本的 HELP 行会撞 gauge 正则（2026-10-03c 实修，测试 0s 假通过）**：
    `/metrics` 输出里 `# HELP sfu_ai_asr_primary_ready 1 when the configured...`——帮助文本里
    **恰好含 "gauge名 空格 1"**。测试用 `/sfu_ai_asr_primary_ready 1/` 判"引擎已就位"，
   于是 HELP 行永远命中 → **0 秒"通过"**，真正的等价后果是测试没等预热就往下跑
    （把上一步的坑 73 暴露了出来——两个坑叠在一起，假绿掩护了真缺陷）。
    ▸ 修法：锚行首 `/^sfu_ai_asr_primary_ready 1$/m`。
    ▎通用判据：**对"带自描述头的格式"（Prometheus/HTTP 头/日志）做内容断言时，
      先想清楚样本行和元数据行长得像不像——正则不加锚等于没写。**
    ▸ 同族提醒：/metrics、/api/rooms 是 admin 门禁——测试读它们必须先造管理员
      （临时库首个注册账号自动 admin），否则拿到 401 会把"没权限"误诊成"没就位"。

75. **★ 基准样本不代表真实负载，量出来的快也会骗人（2026-10-03d 实修，GPU 加速首测）**：
    给 ASR 换 CUDA 版 torch 后做裸基准：合成 4s 音频转写只要 **0.25s**（CPU 2.2s，"9 倍加速"！），
    结果真链路里每段实测 **1.0~1.2s**——差 4 倍。归因（worker 自报纯推理 ms）发现与排队无关：
    **合成音频模型只转出「嗯。」2 个 token，真句要生成 15~20 个 token**——自回归生成的耗时
    ∝ 输出 token 数，输入音频长度几乎不影响。0.25s 是真的，但它量的是"2 个字的负载"。
    ▸ 修法：把"worker 自报纯推理 ms"加进协议（Node 侧"转写 X.Xs"与它相减还能顺带把
      **排队**归因出来——本轮实测 1.2s=模型 1.18s+排队 0，一句话分清两个嫌疑人）；
      基准脚本改用**真实密度**的句子/语音。
    ▎通用判据：**性能基准的样本必须长得像真实负载**——句子的 token 数、请求的字节数、
      表的行数；"9 倍加速"这种漂亮数字尤其要多疑一层。

76. **★ 机制"存在"不等于机制"生效"——没有触发计数的前提设施缺陷永远静默（2026-10-03e 实修）**：
    "静音抢跑快照"（说完静音 1.2s 就转写正在写的段）从 09-30f 上线起就被写进了注释、
    写进了回归记录、写进了"说完再省 ~2s"的成绩单——而真浏览器 e2e 全量打点（ASR_DEBUG）
    证明它**一次都没有触发过**：ffmpeg 的 `-f segment` wav 段文件**写满才落盘**
    （in-flight 段 statSync 恒 0 字节），快照 copy 拿到的永远是"不存在/0 字节"，
    体积门槛把它静默挡掉，行为退化成纯封口路径，没有任何报错。
    更早的 asr-live"延迟改善"其实来自其他改动——**归因错位**让这个死机制一直领功劳。
    ▸ 发现路径：逐条定稿记「等待+转写」拆分（慢峰=等待 3.8~4.2s）→ 抢跑触发打点
      （整场 0 条）→ flush 评估打点（size=0 现形）。**三行诊断日志胜过三次盲改**。
    ▸ 修法是承认现实：真正砍延迟的是 asrSegmentSec 4→2（GPU 转写 0.3~0.6s/段），
      抢跑代码保留（其他平台/构建可能渐进写盘）但注释如实写"本平台从未触发"。
    ▎通用判据：**每个"自动优化"机制都要有可观测的触发证据（计数/日志/metrics），
      上线时的第一次验证必须是"它真的触发了"，而不是"指标看起来变好了"。**

77. **★ `el.textContent = …` 会把同一个节点里的图标一起抹掉（2026-10-03f 实修，一处改出三处）**：
    去 emoji 那轮给 `#capStatus`、`.pin-btn`、`#fxCost`、`.msg-voice-lat` 的 HTML 里加了静态线性图标，
    然后**刷新一次图标就没了**——因为这几处的 JS 一直是 `el.textContent = '新文字'`，
    而 textContent 赋值是"清空子树再放一个文本节点"，图标作为子节点被一起清掉。
    症状极具迷惑性：初次渲染有图标、一动就没了，而代码看起来完全正确（文字确实写进去了）。
    ▸ 两种正解，按语义选：
      ① **图标是静态装饰、数字会变** → 拆成"HTML 里的图标 + 子节点数字"，JS 只写子节点
        （`#capLat` 里的 `svg` + `b#capLatNum`）；
      ② **图标本身要随状态变**（服务器态/故障态不同图形）→ 让 JS 连图标一起渲染，
        且"选哪个图标"的判据**只写一处**（`renderCapStatus` 按 level + 文案判），
        调用方只说人话——否则 18 个调用点各带一个表情，迟早各说各话（坑 47）。
    ▸ 顺带一条测试侧的：桩的 `innerHTML` 与 `textContent` **不聚合**（坑 27 家族），
      改成 innerHTML 写法后 10 条断言要跟着改读 innerHTML；真浏览器两端语义一致，
      所以这是桩的边界不是代码的错。
    ▎通用判据：**给一个已有节点加子元素之前，先 grep 谁在用 textContent 整写它。**

78. **★ 加了图标就必须同时给它定尺寸——没有 CSS 规则的 `<svg>` 按 300×150 渲染（2026-10-03f 实修）**：
    这是坑 26（CSS 注释里的 `*/` 吞掉全站变量）的镜像版：**代码全对、界面塌掉、只有看得见的人才发现**。
    本轮一次性给 30 多处换上线性图标，其中 `.member-title` 那颗漏写尺寸规则，
    真浏览器量出 **32×32**（比同排文字高出一截），而冒烟与 `node --check` 一条都不会红。
    ▸ 修法不是"更细心"，而是把这件事变成一条**结构断言**：`check:icons` 的 B 项
      把页面上每个 `svg.i` 的 `getBoundingClientRect()` 量一遍，>24px 就报出它在哪个容器
      （定位要用 `getAttribute('class')`——SVG 元素的 `el.className` 是 SVGAnimatedString，
      `String()` 得到 `[object SVGAnimatedString]`，本脚本自己先被这一步坑过一次，报成 `.[object`）。
    ▎通用判据：**凡是"样式缺失不会报错、只会让界面变丑"的改动，都要配一条量真实盒子的检查。**

79. **★ 两处各写一个"猜对方多高"的数，就是没有来源（2026-10-03f 实修，控制坞轮）**：
    坞从一行拆成两行之后，11 档视口全部报"字幕条压在坞上面"——因为字幕条的
    `bottom: 96px` 是按**"坞只有一行"**写死的，而移动端那条规则里又写了第二个 `bottom: 128px`。
    把数改大只是把同一个雷埋深一点：控制坞是**每加一个功能就宽一点/高一点**的控件，
    而这两处高度谁都不拥有（第 36 节之前它已经溢出过 180~820px，只是没人量）。
    ▸ 正解是**换结构**：把"字幕条 + 坞"包进一个 `.bottom-stack` 列容器，
      两者改成 `position: static`，"谁在谁上面"由 flex 顺序说了算——
      加一行坞，字幕条自动抬起来，不需要任何人再猜高度。
    ▸ 同一条纪律的另一处应用：dB→电平 的换算原先埋在 `setSpeaking` 里，
      新加的"AI 耳朵"要再抄一份 → 抽成唯一的 `dbToLevel()` 给两处共用，
      否则哪天把 -55 调成 -48，画面格会亮而 AI 的耳朵不亮。
    ▎通用判据：**当你发现自己在"调一个数让它别挡住另一个东西"，那通常是缺一个容器，不是一个数。**
    ▸ 顺带记一条测试写法的错（本轮自己踩的）：断言"服务器发过 speaking 帧"时盯
      `aiStateLast.state === 'speaking'` 是错的——服务器 speaking 之后一定会补 idle，
      而 ack 可能比这两帧都晚，于是"末帧"永远是 idle、断言时红时绿。
      **等的是"事件出现过"，就把它收进数组断言 `.some()`，别盯一个会被覆盖的变量**（坑 44 同族）。

80. **★ 界面"坏了"有时不是逻辑坏了，是被另一层盖住了——用命中测试问页面（2026-10-04 实修）**：
    用户报"让 AI 调白板之后字幕不可用了"。字幕那套状态机（开关/服务端模式/账本/看门狗）
    一个字都没错，读代码也读不出问题——因为问题不在代码里，在**层叠上下文**里：
    白板覆盖层 `inset:0; z-index:6` 把 z-index:5 的字幕条与整排控制按钮整个盖住。
    ▸ 取证手法是这件事的全部价值：`document.elementFromPoint(元素中心)` 让页面自己回答
      "我要点这块地方，浏览器会把事件给谁"。量出来字幕条中心与控制坞中心的实际接收者
      都是 `#boardCanvas`，一句话定死结论，不用再猜"是不是状态没复位"。
      已固化成 `npm run check:layers`（5 项，含"关掉白板后回到原位"——防一次性修复）。
    ▸ **别只把 z-index 调小**：那样按钮能点了，但白板底部那块画不到，
      等于把一个毛病换成另一个毛病。正解是让位（白板底边停在底部那一列之上），
      而"那一列多高"要量出来（第 45 步的 `--stack-h`），见坑 79。
    ▸ 同轮两条测试侧的坑，都是"我以为在测 A，其实在测 B"：
      ① 无头浏览器窗口没有系统焦点，`element.focus()` 常常不触发 `:focus-within`
        → 第一版据此判"CSS 没生效"，是**假红**；改成用 CDP 真鼠标点一次再量。
      ② 连开 11 台无头浏览器扫视口宽度时，偶发"页面脚本异常：Uncaught"（不带任何信息），
        而且**每次红的档都不一样**——会移动的失败是负载不是代码。
        先改成"一档失败只让那一档红"（否则一档死 = 全部没结论），再加一次重试。
    ▎通用判据：**"某个控件点不动/看不见"先做命中测试，再怀疑它的状态机**；
      而"检查命令自己偶尔红"时，先看红的位置稳不稳定——不稳定就别去改产品代码。

81. **★ 排障开关自己也是被测路径：`?nosw=1` 让每次测量都注定撞上一次自我导航（2026-10-04 实修）**：
    `check:dock` 连开 11 档视口，红的档每次都换（1920 → 1280 → 1152），报的都是同一句
    "这一档量到了（浏览器起得来、页面打得开）"，底层错误是 `Runtime.evaluate: Inspected target navigated or closed`。
    ▸ 追下去不是"机器慢"这么简单：**所有界面检查都按坑 40 的纪律带 `?nosw=1`**，
      而这个逃生舱的写法是"注销 SW → 清空缓存 → `location.replace` 重载一次"。
      于是**每一次加载都自带一趟 400ms 后的自我导航**，量具是在跟自己的跳转赛跑。
      全新 profile 下其实没东西可清，那一趟跳转什么都换不来。
    ▸ 修法两层，缺一不可：① **产品侧**"真的清掉了东西才跳转"，没得可清就用
      `history.replaceState` 静默抹掉参数（不产生导航）；② **量具侧**改成"取值失败就重试到停稳"
      （`evalSettled`）+ **开跑前删掉自己这一档的 profile**（上一轮跑过会留下 SW 与缓存，
      于是"这一轮要不要跳"取决于上一轮——正是坑 72 那条纪律）。
      只做②会把缺陷留在产品里；只做①则量具仍在跟"会变的时间"赛跑。
    ▸ 同轮另一处同源教训：**我自己另起的一台测试服务器（带着 Qwen 双 worker 占 3GB 显存）
      就是那些"会移动的假红"的负载来源**。判据：**跑测量之前先问"这台机器上还有谁在干活"**，
      而不是把负载引起的红当成产品缺陷去改代码。用完的备用服务器要关掉，
      它留下的孤儿 python worker 会继续占显存（本轮实测：kill 只杀父进程时 worker 还在）。
    ▎通用判据：**当"检查自己偶尔红"时，先找检查自己注入了什么副作用**（参数、跳转、缓存、负载），
      这类红会移动、会自愈，而产品代码里根本没有那个毛病。

82. **★ 同一份配置有 N 个读取器，字段只被其中一个写——界面就会拼出自我矛盾的话（2026-10-04 实修）**：
    `test:e2e-asr` 的日志里字幕徽标写成 **"服务器转写（服务器转写）"**。
    ▸ 成因：`client.js` 有**三处**读 `/config.json`（进房 `initSFU`、点字幕 `ensureAsrConfig`、
      浏览器识别失败兜底那次现场补拉），而 `serverAsrEngine` 只有第一处会写。
      "配置还没落地就先点了字幕"这一路走的是第二处 → `asrEngineCn()` 取兜底文案，
      而那句兜底**恰好也叫"服务器转写"** → 外层模板 `服务器转写（${引擎}）` 拼成胡话。
    ▸ 两层修法：① 三处读取器共用同一个 `applyServerConfig(cfg)`（**结构上不可能再漏一半**，
      而不是"记得同步改"）；② 兜底文案改成不会与外层重复的"引擎待确认"——
      含糊比"看起来自洽"更诚实，因为自洽的胡话没人会去怀疑（坑 67 家族）。
    ▸ 测试侧更要记的一条：那条断言原先写 `chk(/服务器转写/.test(capStatus))`，**所以它一直是绿的**。
      一条"只查关键词在不在"的断言，永远查不出"这句话是不是人话"。
      判据：**界面文案类断言要断"这句话读起来成句"**（重复、空括号、占位符残留都算缺陷）。
    ▎通用判据：**同一份数据被多处读取时，数一下写入点**——写入点少于读取点，就一定会漂移。

83. **★ 假环境缺一种能力，那条分支就永久不测；补桩之后必须回头补断言（2026-10-04 实修）**：
    `speakStreamPart` 里写了 `answerTs: id`，而那个作用域根本没有 `id` 这个变量 →
    每次流式切出一整句就抛一次 `ReferenceError`（真浏览器控制台抓到 3 次），
    而 `test:smoke` **连跑两天全绿**。原因不在断言写错，在桩里**没有 `speechSynthesis`** →
    `SPEECH_OK=false` → 那一行从来没被执行过。
    ▸ 补桩（`speak()` 记文本、并按真浏览器语义回调 `onstart`/`onend`）之后才看清第二件事：
      分句朗读的泵是靠 `onend` 接力到下一句的，**桩里不回调 onend 就等于队列永远只念第一句**——
      "改了个看起来完全正确的函数，但它只测了一半"。
    ▸ 补桩红利立刻抓到第二条真缺陷：`enqueueAiSpeech` 登记延迟锚点的判据写死
      `typeof answerTs === 'number'`，而流式那一轨传的是 **streamId（字符串）** →
      语音问答（基本都是流式）的播报读数**从来没被量出来过**，`/metrics` 长期少一整类样本
      （坑 56 的形状：内层把 id 传出来了，外层按 ts 的类型判）。
    ▎通用判据：**"这段代码从没被执行过"不会自己露头**——凡是依赖宿主能力的分支，
      要问"我的假环境里有这个能力吗"；没有就是永久不测，而不是"测试通过"。

84. **★ 观测手段不得改变被测对象状态——"抓栈"把目标暂停后必须先放它走（2026-10-05 实修）**：
    为查"页面主线程是不是死了"，给探针加 `hbGrabStack()`：CDP `Debugger.pause` + 读 `callFrames`。
    第一版是 `pause → 读栈 → disable`——**忘了 resume**。Debugger disable **不会**替你继续执行，
    目标就停在断点状态：后续所有 renderer 域命令排在队里没人跑 → 全线超时，
    **症状与"页面主线程死锁"一模一样**。我一度就是拿"它制造出来的超时"当停摆证据的。
    ▸ 修法：`pause → 读栈 →`**`Debugger.resume`**` → disable`（顺序即语义）。
    ▎通用判据（海森堡）：**凡是"暂停/冻结/加锁"类的观测手法，退出路径必须成对恢复**——
      你暂停了它，就得放它走；否则探针会把你推给它的每一秒都变成"故障证据"。

85. **★ 抓栈要函数名+行号交叉归属，`f.url` 缺席时别猜（2026-10-05 实修）**：
    同一次抓栈里看到 `tickClock` 在跑，差点判成"主文档主线程没死"。核对 url 才发现：
    它是 **workbench.html iframe 里的秒定时器**（正常心跳），主文档当时是什么状态它证明不了。
    CDP 的 `callFrame.url` 对 eval/匿名脚本可能为空，`f.url || '?'` 才是诚实写法；
    归属要**函数名 grep + 行号**两路交叉——本仓库同名函数（`tickClock`/`log` 类）不止一处。
    ▎通用判据：**"某处还活着"必须先证明它属于哪个执行上下文**；
      iframe/worker/eval 里的心跳不能替主线程作证。

86. **★ CDP 命令按域分层排队——探针自己的超时会伪装成被测对象故障（2026-10-05 实修）**：
    renderer 域（`Runtime.evaluate`/抓栈）排队超时的同时，**browser 域（导航/截图类）0ms 秒回**——
    目标不是"死了"，是渲染进程在资源争用下排队。更坏的是探针两处自伤：
    ① `hbGrabStack` 默认在超时通道上打日志（silent 红鲱鱼），**探针超时先于真实响应出现**，
    被我读成"页面没响应"；② CDP 超时 15s 写死，机器一忙就全撞线。
    ▸ 修法：`cdp._openWs(url, silent=true)` 静默通道 + `WB_CDP_TIMEOUT`（测试用 30000）可调；
      判读时先看**哪些域在排队、哪些域秒回**，再谈"死没死"。
    ▎通用判据：**量具的超时不是被测对象的属性**——超时要显式可调，
      且必须能区分"我方放弃等待"与"对方真的无响应"。

87. **★ "偶发红"先对齐资源时间线——先问这台机器上还有谁在干活（2026-10-05 实修）**：
    e2e-asr run-12 的 7 条红全部集中在 ⑩b~⑪（B 侧字幕/气泡/白板/笔迹），而核心链路全过。
    三件取证把判词钉在**环境级内存压力+争用**：心跳断档序列
    `[18.4s, 3.1s, 6.0s, 3.0s, 6.4s, 74.0s, 198.7s, 141.2s]` ↔ **freeRAM 谷底 4.5GB→1.47GB**
    时间上吻合；CDP 分层（browser 域 0ms ✅ vs renderer 域排队超时）；主线程没死（tickClock 在跑）。
    残余不确定 = 断档里那几段 6s 长任务归属（未 100% 钉死，如实挂着）。
    ▎通用判据（坑 80"会移动的失败"的延续）：**失败点若全部集中在被争用的资源域
      （渲染进程/内存/GPU），先量机器资源再怀疑产品代码**——多服务器/Qwen worker 并行
      就是本项目最大的争用来源（10-04e OOM 的教训换个形状复发）。

88. **★ "导航的应答"不等于"导航完成了"——能不能重试要按幂等性划线（2026-10-05 实修，
    e2e-asr run-13/14 同一个红点）**：`agent/cdp.js` 的 `navigate()` 写成
    `Page.navigate` → `sleep(200)` → `refreshViewport()`（`Page.getLayoutMetrics`）。
    前一条的应答只代表**导航已发起**，此刻渲染进程正在"拆旧文档、装新文档"，
    这条读命令正落在提交窗口里；机器被占满时（实测可用内存 4.04~4.94GB）渲染进程整段不回回执，
    30s 预算原样烧光 → `Page.getLayoutMetrics 超时` → 整场中止。
    ▸ **最迷惑的地方：页面其实好好地在加载**（run-15 同一时刻服务器侧仍在正确转写），
      红的只是"我取不到视口尺寸"。run-13 死在 A、run-14 死在 B——**同一个调用点会移动 = 竞态**（坑 80 判据）。
    ▸ **这条不是只有测试会撞**：`agent/index.js:556` 控制端在地址栏输网址走的就是同一条 `cdp.navigate()`。
      真实使用中"打开一个慢网站"就会抛错，而且后面的 `emitMeta()` 不再执行
      ——手机控制台表现为"页面明明开了却报打开失败、地址栏不同步"。**量具暴露的产品缺陷**，
      这也是为什么不该只把超时调大了事。
    ▸ 修法按**幂等性**划线，而不是按"超时就不管"：10-04b 立的纪律是"**点击类命令绝不自动重试**"
      （点击重发 = 双触发，建两个房、进两次会），但**取一次布局度量是纯读命令**，
      多发一次除了晚一点返回没有任何副作用。所以：读命令**重试一次**；
      两次都没回执则**沿用启动尺寸兜底、不中止导航**（`this.viewport` 构造时已按 `windowSize` 有初值，
      最差只是差一个窗口装饰的坐标基准——好过把正常加载的页面判成失败）。
    ▎通用判据：**要不要重试，问"多发一次会不会改变世界"，不要问"它看起来安不安全"**；
      而跨进程/跨引擎的"发起"类应答，别当成"完成"类事实。
    ▸ 顺带记一条测试素材的真相，因为我先误判了：`--use-file-for-fake-audio-capture` 的 wav
      会被 Chromium **循环重放**——20.6s 两句素材在一场几分钟的测试里被"再说一遍"是正常现象，
      我一度把 17 段原始转写读成"同一段被转了三遍=去重闸失效"。**断言之前先确认信源的行为**。
89. **★ 外部模型偶发的"停不下来"会独占串行 worker——有界预算 + 重启才是自愈，只丢段不是（2026-10-05 实修，
    这条就是用户说的"语音识别一段时间就停了"的真身）**：
    e2e 真浏览器连跑量到 **单次 ASR 推理 93.5s**（run-18）与 **36.4s**（run-16），
    而同一个 worker 同期 **p50 只有 0.5~0.6s**——同一段 2s 音频，差 150 倍。
    Qwen3-ASR 是自回归生成，偶发进入重复循环就会一路生成到 `max_new_tokens=256` 上界；
    而 Node 侧旧默认预算写的是 **`WAIT_MS = 120000`（120 秒）**，于是：
    一次失控推理 = **这个人的字幕静默两分钟**，且因为 worker 是**单进程串行**的，
    紧随的每一段都要排队（实测下一段"排队 83.7s"）——下游的定稿、唤醒、AI 应答、播报**全部连坐变红**。
    ▸ 最迷惑的地方：**它不会报错**。worker 活着、引擎"就绪"、日志还在转写，
      只是慢到等于没有；而界面上看到的和"耳朵坏了""模型没切""内存压力"长得一模一样。
      这次能定位，全靠 10-03d 给协议补了 **worker 自报纯推理 ms**——
      没有"模型耗时 vs 排队耗时"的拆分，93s 只会被读成"机器忙"（坑 75 的那把尺子这次救了我）。
    ▸ 修法三件（缺一都留半个洞）：① 预算收到 **12s**（p50 0.5s、真句稳态 1.0~1.2s，留 10 倍余量；
      **误杀一段只是慢一点，漏放一次是全场静默两分钟——两边代价不对称，预算该偏宽但不能宽到没意义**）；
      ② 超时之后**重启 worker**（只 `resolve('')` 是"我不等了"，Python 那边还在生成，下一段照样排死）；
      ③ 重启带 **20s 冷却**（模型重新加载要 10~20s，连续重启互相踩）。
    ▸ 两个必须同时守住的副作用（都在 test:asr ③.7 钉了断言）：
      ① 主动重启**不能计入 `crashStreak`**——连崩三次会把引擎 `state.dead=true` **永久判死**，
        那样"自愈"反而制造出"永久不停"（坑 66 家族：清理动作的作用域比它看起来更大）；
      ② 超时/重启期间**这段话不能丢**——空串回到 `sfu/server.js:2716` 会自动回落 whisper 常驻 worker，
        所以"变慢"不会变成"变没有"。
    ▎通用判据：**凡是"一个外部进程串行干活 + 我方只能等它回话"的结构，
      超时预算必须显著小于用户能感知的"卡死"，而且超时必须包含"换掉那个进程"，
      不只是"放弃这一次等待"**。
90. **★ "多久有人说话"和"这句话多久没变长"是两个时钟，混用一个会把成句闸永久饿死（2026-10-05 实修，
    ①两条用户抱怨同源）**：成句闸的保险丝写的是 `now - u.lastAt > UTTERANCE_MAX_OPEN_MS`（10s），
    而 `u.lastAt` 在**每一段转写到达时都刷新**——**包括被 `Asr.mergeTranscript` 判成
    "句内碎片/重复：只续窗不追加"、一个字都没往句子里加的那些段**。
    于是"有人在不停说同样的话"= 句子永远显得不空闲 = 保险丝永远跳不到：
    ▸ 实测铁证：闸状态行里 `sinceAppend` 最高冲到 **9807ms**，离 10000ms 只差 **193ms**，
      就被一次"没加进任何新字"的重复段清零。
    ▸ 后果是一条**全静默链**：不成句 → 不定稿 → 不唤醒 → AI 永不接话 → 喇叭不出声，
      界面上就是用户报的"它听不见了 / 叫它没反应"，而日志里除了"没有 `成句：` 行"以外
      **没有任何异常**——`catch (e) { /* 成句失败不拖垮循环 */ }` 把"没执行"和"每轮抛错"
      压成了同一种样子（坑 76：机制没有触发证据就查不到）。
    ▸ 我是怎么绕远的（都记下来，下次别再重复这三个空枪）：先怀疑**计数器泄漏**
      （`segInFlight`/`tailInFlight` 都在 `finally` 里减，排除）→ 再怀疑**`continue` 顺序**
      （成句块本来就在 `continue` 之前，排除）→ 再怀疑**常量 TDZ**（`UTTERANCE_MAX_OPEN_MS`
      等都已定义，排除）。**三个假设都是猜**，直到给闸加了一行"每秒把守卫状态摊开"的诊断
      （`成句闸 segInFlight=… tail=… 句子数=… sinceVoice=… sinceAppend=…`）才一眼看见真凶。
    ▸ 修法：句子表加 `textAt`（只在 `grew` 时刷新），保险丝改看 `idleTextMs = now - (u.textAt || u.lastAt)`；
      `lastAt` 保留原义给"无 RMS"的兜底路径。验证：`test:e2e-asr` run-22 **21 项 / 0 失败**
      （修前 run-19 是 21/4）——`成句 4`、`定稿 5`（修前都是 **0**）、
      **喇叭真的开过口 10 次**（修前 0 次）、`B 看到 AI 应答气泡` ✅、白板双端同步 + 笔迹 2594↔2593 ✅。
      `test:asr` 加 **③.7 组共 10 条**钉住两个时钟与两处可见性（60 → **64 通过/0 失败/1 跳过**）。
    ▎通用判据：**一个时间戳只能回答一个问题**。凡是拿"最后一次事件"当"最后一次进展"用的地方，
      都要问一句"这次事件真的改变了状态吗"——重复投喂、幂等重试、心跳都会让"最后事件"跑得比"最后进展"快。
    ▸ 顺手记一条**读数诚实性待办**：`reason=max-open` 是在"人还在说"时强制定稿，
      此时 `latMs` 量到 15~20ms，那**不是**"说完→定稿"的延迟（循环夹具下没有真静音，全靠保险丝定稿）。
      10-03b 立的规矩是"脏值保持上次读数、不许瞎填"，所以正确修法是把 `reason` 传进
      `finalizeUtterance`，非 `silence` 定稿时 `latMs` 记 0 让前端保持上次读数。
      **本轮没做**（怕把刚跑绿的一条又搅动），如实挂在这里。
      ▸ **★ 2026-10-05 夜三已收尾**：`reason` 一路传进 `finalizeUtterance`，非 `silence` 一律
        `latMs=0`，并把定稿原因以 `fin` 同时写进 `asr-caption` 与字幕账本 —— 于是那个 0 是
        **可解释的 0**（引擎太慢被时长闸切断），与"压根没量到"分得开了；自测与 soak 的判据
        据此从"必须有可信读数"改成"要么有读数、要么有 fin"。见顶部 10-05f 块与**坑 93**。
    ▸ 顺带记一条测试素材的真相，因为我先误判了：`--use-file-for-fake-audio-capture` 的 wav
      会被 Chromium **循环重放**——20.6s 两句素材在一场几分钟的测试里被"再说一遍"是正常现象，
      我一度把 17 段原始转写读成"同一段被转了三遍=去重闸失效"。**断言之前先确认信源的行为**。

91. **★ 校准要跟着真实用户走：一把拿响麦克风定的尺子，量不到安静的人（2026-10-05 实修）**：
    语音链路上一共有**三把绝对阈值**，全都写在"能跑起来"那天定下的数值上，
    而那天喂进去的是 TTS 合成的**全幅语音**：能量闸 -45、增益上限 +20dB、
    RMS"有人在说"阈值 -38。用户真实麦克风（房间 283648，坐得远/音量小）峰值只有
    **-56 ~ -65 dBFS**——三把尺子**同时**判他"没在说话"：
    ① 66 秒里 8 段被当静音删、只有 4 段进转写（= "说了半天没字幕"）；
    ② 放行的那几段被钳在 +20dB 增益，送进模型还是耳语（= "字幕全是碎片错字"）；
    ③ RMS 永远不越 -38 → lastVoiceTs 整场不刷新 → 静音确认快路径没生效过、
      延迟读数没有锚，界面上于是能显示「⏱ 0.0s」这种撒谎的数（真实等待 ~10s）。
    ▸ 三条一起改（-62 / +40dB / -50），而且**必须成对**：只放宽闸门不提增益，
      换来的是"有字幕但全是错字"，比没字幕更让人以为功能坏了。
    ▸ 教训的形状：**凡是"绝对阈值 + 外部世界幅度"的组合，都要问一句这个数是拿什么样本定的**。
      同一处逻辑在合成语音上跑通、在真笔记本麦上失效，而它不会报错，只会静默少字幕——
      与坑 57（装了≠用上）、坑 64（模型没人说话也还你一句话）同族。
    ▸ 防守：test:quiet-mic 现在有**两档**（-48 与 -60 dBFS），第二档专门钉"坐得远的用户"：
      旧闸确实误杀 / 新闸确实放行 / 增益后模型输入 ≥ -30dBFS / 关键词 4/4。
      顺带修掉一条**只会误报的断言**：原写"增益版命中必须严格多于安静版"，
      可安静版本来就 4/4 时它永远不可能成立——"要求变好"的断言要写成"不得变差"，
      否则它不是在保护功能，而是在制造假红。
    ▸ 跨运行时的同一概念（服务端 WAKE_RE 与浏览器那一轨的唤醒判断）做不到单一来源时，
      就用一条**逐字比对两张表**的断言钉住——改了忘同步会当场红，而不是"有时理有时不理"。

92. **★ 精确串匹配的过滤器，会被同音字漂移打穿；放宽阈值只是把问题推到下一环（2026-10-05 实修）**：
    10-05b 为"噪声被模型续成 YouTube 求赞话术"写了四条幻觉正则——**全是精确串**
    （`点赞[，,、]?订阅[，,、]?转发…`）。第二天用户截图里的原文是
    「请在下一个视频里面**打赞**,许多 clic,支持、**收养**、多泫,**看到更多** needL FI Ching」：
    **打赞 ≠ 点赞、收养 ≠ 收藏**，四条一条都不命中，48 个字的幻觉照常上字幕条。
    ▸ 直接诱因是我上一轮把能量闸 -55 放宽到 -62：**噪声段终于能进转写，于是"少字幕"这个病
      变成了"垃圾字幕"那个病**。放宽一个阈值不会消灭问题，只会把它推到下一环——
      所以动阈值的那次提交，必须同时回答"下一环接得住吗"。
    ▸ 正确的判据形状（与坑 53 同一条）：**不要用"预测它说什么"，要用"这类话的分布特征"**。
      现在三类信号对同音字免疫：① 强锚（明镜与点点/字幕君/不吝/下一个视频/看到更多）一个即丢；
      ② **组合**："求赞家族"（赞/订阅/收藏/打赏/弹幕/关注）**且**"平台词"（视频/频道/栏目/支持/更多）
        同时出现才丢——单看一个词必然误伤真话；
      ③ 拉丁乱码（≥3 个拉丁词，或 ≥2 且拉丁比汉字多）。
    ▸ 两条容易做错的细节：① **「转发」必须从平台词里踢掉**——它既是 spam 链一环也是常用动词，
        留着就会误杀"这个方案我点赞，大家转发一下"（这条反例已钉进 test:asr）；
      ② 判据要**返回命中理由**而不是布尔，否则"这句为什么没了"在日志里永远是黑盒（坑 76）。
    ▸ 同一场截图里的第二个缺陷（与放宽无关，一直存在）：AI 的回答被当字幕入账本 →
      看板把它抽成"没有负责人的行动项" → AI 主动播报**自己的话**并问"谁来认领"。
      修在 `feedBoard`（只消化 `!e.bot` 的条目）：**账本可以全量（RAG 要能查到 AI 说过什么），
      但"会议内容"这个概念只包含人说的话**——同一份数据两种用途，边界要分开写，
      不能靠"抽取时记得排除"（坑 47）。
    ▎通用判据：**凡是"用字面串识别某类文本"的地方，先假设它会变形**（同音字、繁简、空格、
      标点、中英混排）；识别不了变形，就换成"多个弱信号组合 + 强锚"，并配三条反例断言。

93. **★ 给生成式模型加"热词/提示"，必须用**空输入**验收一次——它会把你给的话原样还给你（2026-10-05 实修）**：
    「纪要」在 2s 分段里被听成「既要」，最直接的两个方案是"把会议热词喂进模型的 context"。
    本机 0.6B/GPU 一次对照实验（同一份 fixture，量完即删脚本）把这条路**否决**了：
    ▸ 真话本来就已经转对：**整段音频一次转写，有无 context 都是「小明，把纪要生成一下。」**
      ——错的只是切细之后缺上下文的那一片，所以热词买不到准确率。
    ▸ 而**纯静音 + context** 模型把 context **整句照抄**回来：
      “普通话会议对话，简体中文。常见词：小明 纪要 评审 白板 字幕 共享 待办 决议 排期 延迟。”
      那句话里带「小明」= **幻觉自己唤醒自己**，正是坑 64 的原始事故（静音幻句把 AI 唤醒、
      AI 对着幻觉答一整轮）换个入口原样复发。静音下还多花 2.3s 生成这串字。
    ▸ 于是修在**文本侧**且按坑 49 只动"贴着动作词"的那一种：`既要/记要` 只有在紧邻
      生成|整理|总结|发|出|给… 时才改成「纪要」，句中出现「又要」（并列连词的信号）整条不替换——
      「既要保证质量又要加快进度」必须原样。三条反例钉在 test:asr。
    ▎通用判据：**"给模型一段指令/词表"这件事的失败模式，是它把这段内容当成输出内容**。
      所以任何 prompt/context/hotword 改动的验收都必须包含一条**空输入（静音/空白）**用例，
      断言"回来的东西不含我给它的话"——只测真话那一侧，永远测不出来。
    ▸ 同一条实验顺手量到的第二件实话：那个 23.5s 的「答案上屏→听到首段」是**配对配错了**——
      入会致辞也是 `from='ai-bot'`，`botReplies[0]` 拿的是它的时间戳，量的是"致辞→下一轮音频"。
      改成"取首段音频之前最后一条应答的 ts"后真实值是 **2.4s**（Edge TTS 正常）。
      **一个错的数比没有数更危险**：它差点让我去优化一个根本不存在的"TTS 慢 20 秒"。

94. **★ "等对方说一句道歉"的兜底，必须同时回答"对方说不出来怎么办"（2026-10-06 实修，坑 66 家族收官）**：
    AI 语音的正确性押在服务器那一句 `ai-tts-fail` 上——前端让位（不自己念）之后，
    只有收到这句话才会回落浏览器朗读。而它写在 `makeSpeakPipeline.finish()` 里，
    前面还排着 `await Promise.all(jobs)`：Edge 合成内部超时 12s、并发闸只有 2 路，
    长答案第二波要等第一波让位 → **"我答应了"到"我承认我发不出"之间可以隔 20s+**。
    更坏的一半是：应答链路在 `finish()` 之前抛错（外层 catch 只打日志）时，
    这句道歉**永远不会说出口**，`pendingServerTts` 那笔账挂着不销 = 这一轮永久无声、零报错。
    ▸ 修法分三层，缺一层就留半个洞：
      ① **决定要有截止时刻**（`TTS_DECIDE_MS=8s`），但截止时刻**按引擎能力定**——
        显式开 `aiTtsLocalWait` 的本地神经音色一句实测 5~20s，统一 8s 会每次都抢在它前面判死刑，
        那个配置就此变成空转（坑 67"写了但从来没生效"原样复发）；
      ② **合成预算显式写在调用点**（Edge 6s；健康值 1.4s/句，四倍余量）——
        下游本来就配了"发不出就让浏览器念"，等满 12s 买不到任何东西，只买到 12 秒静音；
      ③ **客户端自己有保险丝**（20s 到点没等到任何交代就自行回落），
        且回落时**把 ts 记进 `serverTtsDropped`**：修了 ①② 之后"决定先于音频"第一次成了
        正常时序，不记就是浏览器念着、服务端音频晚到又叠一层（双声）。
    ▸ 配套的两条判据：`fallBackToBrowserTts()` 是"这一轮由浏览器念"的**唯一入口**
      （`ai-tts-fail` 与保险丝共用，坑 47；冒烟有一条断言钉"处理器里不许再内联一遍"）；
      以及测试接缝 `TTS_FAKE_FAIL=1`（判在缓存之前）——端点可达性随网络出口漂，
      没有这条缝，这条最要命的路径只能等网络自己坏一次才验得到（坑 83）。
    ▎通用判据：**任何"降级/让位"设计都要有一条不依赖对方的兜底**，
      并且那条兜底的时限由**我方的耐心**决定，不是由**对方的失败速度**决定。
    ▸ 实测：强制失败路径 ai-tts-fail **1.3s** 到达；真实 Edge 路径音频 6 段、首段 2.3s。

95. **★ 计数断言里混进"恒存在的事件"，正向对照就永远绿（2026-10-06 实修）**：
    `test:asr-live` 的 `botReplies` 收的是**所有** `from='ai-bot'` 的 chat-message，
    而 AI 入会那句「🎧 已接入…正在聆听」也是这个来源。后果分两半，每一半都单独致命：
    ▸ `must(botReplies.length >= 1, "听到了唤醒词就必须真的应答过一次")` —— **致辞恒存在，
      这条永远不会红**。它自称是"AI 真接话了"的正向对照，实际什么都没证（坑 65 的镜像：
      上限断言要靠输入真的进去才有意义，这里连下限都是白送的）。
    ▸ `must(botReplies.length <= 2)` —— 名额被致辞**永久占掉一条**，于是"2s 分段把一句话
      切成两截、两截各自成句"这种正常形态会报成"应答风暴没刹住"（实测 3 条 = 致辞 + 2 答）。
      一条断言同时会假绿又会假红，是最难查的那种量具。
    ▸ 修法：入口就过滤（`isGreeting`），致辞不进计数。
    ▎同族旧账：10-04e 在 `test:e2e-asr` 上修过**一模一样**的一处（AI 气泡匹配要排除入会致辞），
      当时没顺手 grep 全仓 → 自测这一处又活了两个月。
      **同项目同一个坑只修一半 = 半迁移 = 等于没修**（坑 57 原话，这次第三次应验）。
    ▎通用判据：写"至少一次/不超过 N 次"这类计数断言之前，先问
      **这个计数器里有没有一个恒真的东西**。

96. **★ 量具不许跟自己的动画赛跑：读一个有过渡的属性要轮询到停住（2026-10-06 实修）**：
    `check:visual` 新加的"光标聚光"两条断言第一版都是红的，报的是"没亮起来 / 没熄灭"，
    而实际读到的是 **0.309** 和 **0.036** —— `opacity` 有 .18s 过渡，
    而我睡了一个"看起来够用"的固定 260ms。到达终值的时刻不是常数（rAF 闩锁 + 合成器时机），
    于是同一份代码会**移动式地红**（坑 80：红的位置不稳，就别去改产品代码）。
    ▸ 修法：两处都改成"轮询到停住，上限 2s"，判据本身一个字没动。
    ▎这条其实是 10-04e 那条"时序脆弱断言：固定 sleep 是 Mock 时代写的"的第四次应验，
      只是这次栽在**我自己刚写的动效**上——**新加过渡/动画的那一刻，
      所有读它的断言同时变成会移动的**，写断言时就要用等待而不是用睡眠。
    ▸ 同轮另一条更值得记的：**ar=1.778 全绿，画面却是歪的**。共享格第一版只 `span` 列，
      三条几何断言全过，一张截图当场露馅（同行格子一半高、底边参差、左边一块空黑）。
      判据：**布局改动的验收必须看图**，几何数字只能证明"我量过"，不能证明"它好看"。

97. **★ 按钮文字不是状态机——它一变样，拿它做判断的代码全部静默反转（2026-10-06 实修：产品缺陷与测试工具同时中招）**：
    `switchMic` / `switchCamera` 里各有一行"保持当前静音状态"：
    `newTrack.enabled = muteBtn.textContent === '静音';`（摄像头那句是 `'关摄像头'`）。
    ▸ 它坏掉的时刻是**第 43 步**（拱形升起按钮）：为了让文字升起时不跳版，按钮里放了
      **两层同样的字**（宽度取两层最大值），于是 `textContent` 读出来是「静音静音」——
      相等判断**永远 false**：换过一次输入设备的人，麦克风/摄像头一上来就是 disabled，
      而日志写着"已切换（成功）"、图标也还停在"未静音"那一套。
      这条与 10-04g 的端口撞号、10-05 的能量闸错位**不是同一个成因**，
      三条都能造出"加入会议后识别失败 / 用一会儿就不行"——它是用户那句话的第四块拼图。
    ▸ **同一处坑把测试工具弄哑了三个月**：`test:voice-longrun` 的开麦逻辑是
      "按钮文字不是『静音』就点一下"，于是它连点三下**把麦克风关掉**，
      然后一路报告"定稿 0 条 / 识别一段时间就停了"。改成读轨道的真实 `enabled` 之后一次跑通：
      2 分钟 12 条定稿、最大停摆 12s、AI 应答 11 次、6/6 全绿。
      ▸ 判据：**被测对象与测试工具共用同一套 UI，UI 的文本就不是可靠判据**——
        两边都会改版；而工具那侧出错时，被冤枉的是产品。
    ▸ 修法（两处一起）：状态的唯一来源是**轨道自己**（`track.enabled`），
      换轨之前从旧轨读、读完再 `stop()`；按钮文字只是这个状态的一个视图。
      防守补一条**全文件结构红线**：出现 `xxBtn.textContent === '…'` 当状态判据直接红
      （注释里保留旧写法作教训，所以断言只扫非注释行）。
    ▎通用判据：**给人看的字符串不许当机器的判据**（它会随图标、动效、i18n、文案改版而变）。
      与坑 77（`textContent =` 抹掉图标）、坑 82（同一份配置多个读取器）同族：
      **视图与状态混在同一个载体上，迟早互相污染。**

98. **★ 量具必须能读出 0：两版"AI 表情"量具都被自己的 A/B 推翻（2026-10-06 实修）**：
    要回答用户那句"动态效果还是没有变化"，我需要一个像素级结论。前两版量具都是**绿的，且都是假的**：
    ▸ **第一版**：截 `speaking` 时那块脸的矩形，700ms 后比像素 → Δ嘴部 38.4，看起来"在动"。
      A/B 把口型素材换成一张静帧 png（= 用户说的"定格的脸"），它**仍然报 Δ38.4**。
      真相：那块矩形里还挂着 `.ai-waves`（七根波形条 infinite 跳动）与 `.ai-speech`（逐字打出的字幕），
      动的是**别人的像素**；而 speaking 态还有 `--ai-amp` 音频驱动亮度律动，整块都在变色。
    ▸ **第二版**：改用 `ctx.drawImage(img)` 取"图元当前帧"（不受邻居污染）→ 真动图连采四次**恒为 Δ0**。
      也是假的，反方向的假：Chrome 的 drawImage 只画动画 WebP 的**第一帧**，它根本看不见屏幕上正在播的帧。
    ▸ **第三版**才可用：临时注入一条 `!important` 样式表按停呼吸/律动/光晕，隐藏波形与字幕，
      再截同一块矩形 —— 于是"静帧素材 = Δ0.11"与"真口型素材 = Δ14~33"两个读数同时成立，
      **能量出"不动"的量具，它报的"在动"才是证据**。测完在 `finally` 里把样式与 visibility 原样恢复
      （观测手段不得改变被测对象，同坑 84）。
    ▎通用判据：**任何"变化检测"型量具，先做一次"故意让它不该变"的实验**（换成静态素材/停掉输入/断掉源），
      它必须读出≈0。一条只会报"变了"的断言，报的绿灯与坑 57 那台"复用别人端口跑出来的绿"是同一种东西。
    ▸ 附带一条：跨状态差值（嘴部 − 对照组）当判据在这里**不成立**——这套素材连头一起动，
      对照组也跟着变（Δ22~28），差值被压到 7 上下，薄得像掷硬币。
      **差分类判据要问一句"干扰项是不是两边同等"**；这里"整块在闪"另有
      「speaking 时 .ai-face 不跑 CSS 动画」那条独立断言守着，各司其职比一个复合指标好。

99. **★ 零宽前瞻匹配把"位置"记成 0，组合指令的执行顺序就颠倒了（2026-10-06 实修）**：
    房间动作支持"一句话做多件事"后要按**用户说出来的顺序**排。第一版直接拿 `re.exec(s).index` 当位置，
    而规则表里有**纯前瞻**分支（`(?=.*(演讲|主讲|聚焦))(?=.*(视图|模式|…))`、board-clear 的 `(?=…全部…擦)`）——
    前瞻不消费字符，正则在**索引 0** 就能满足它。于是句尾的"演讲者视图"位置被记成 0、插到最前面：
    「把白板打开，字幕关掉，切到宫格，再切到演讲者视图」实测排成
    `[board-open, view-speaker, captions-off]` —— **宫格被上限挤掉，最终视图与用户说的正好相反**。
    ▸ 修法：`ruleMatch()` 用 `g` 标志扫一遍，**优先取第一个非空匹配的 index**；只有零宽命中才退回零宽位置
      （零宽命中仍算命中，那是"我们画个白板"这类无宾语句的兜底，只是排序时不许作弊）。
    ▎通用判据：**`match.index` 是"匹配开始的地方"，不是"内容所在的位置"**——
      凡是用匹配位置做排序/就近/窗口判据的地方，都要问一句"这条规则能不能零宽命中"。
      同坑 42/49（中文跨词）家族：**正则给的数字也要先确认它量的是你以为的东西**。

100. **★ "每条消息都重排定时器"= 重复广播把随机调度永久饿死（2026-10-06 实修，用户可感知）**：
    AI 头像的偶发小动作（7~14s 随机一次）原先挂在 `setAiState()` 上，而 `armAiGestures()` 第一件事是
    `clearAiGesture()`（清掉正在等的定时器）。问题是 ai-state **会被重复广播同一个状态**：
    服务器每建一条听觉管线就 `emit('ai-state', {state:'listening'})` 一次
    （每个开麦成员一次、重连一次、producer 替换一次）⇒ 广播间隔短于 7 秒时，
    **等待永远从头再来，小动作一次也演不出来**。症状正是用户那句"动态效果还是没有变化"，
    而状态文案、呼吸、字幕全都正常，日志里没有任何异常。
    ▸ 修法两半，缺一半都会留洞：① 只有 `状态真的换了 || 手上没有排程` 才重排；
      ② 定时器进回调时**先把句柄归零**——否则"有没有排程"这个判据读到一个已经消费掉的旧句柄，
      ① 就形同虚设（而且格子不存在时 return 掉的那条路径会留下一个永不再排的死角）。
    ▎通用判据：**幂等的"重新安排"必须是"状态发生了变化"的函数，不是"消息到达"的函数**。
      与坑 90（把"最后事件"当"最后进展"）、坑 71（清理动作作用域比看起来更大）同族：
      凡是"收到通知就重置计时器"的代码，都要问一句"通知会不会重复到？重复到时我该不该重置？"

101. **★ 格子建得比状态消息晚 ⇒ 排程链条彻底断掉（2026-10-06 实修，与坑 73 是同一形状的镜像）**：
    坑 73 修的是"按 attach 那一刻的能力定型"；这里是它的兄弟——**排程挂在状态消息上，
    而状态消息比 DOM 早到**。`syncAiTile()` 建出 AI 格子时不补排小动作，
    于是"先收到 ai-state、后建出格子"这个开局顺序下，定时器到点时 `.ai-face` 还不存在 → 直接 return
    → 这个角色的头像从此永远静止，且没有任何一行日志。
    ▸ 修法是**在建格子的那一处补排一次**（而不是把定时器改成轮询——那会多养一个循环）。
    ▎通用判据：**任何"由消息触发、但作用在某个 DOM 上"的定时任务，都要在"那个 DOM 被创建"的时刻
      重新检查一次是否该排**。两个入口（消息到达 / 元素出现）共用同一个 `armAiGestures()`，
      而不是各自发明一份调度（坑 47）。

102. **★ 动画启动前模板已经把终值写进 DOM ⇒ "滚动"根本看不见；以及 `Number(null)===0`（2026-10-06 实修）**：
    CountUp 移植的两条，都是**只有端到端才能抓到**的形状：
    ▸ (a) 面板 `innerHTML` 里印的是**新**值，之后才启动 rAF。第一帧要到下一个刷新周期才跑，
      于是那一瞬页面显示的是终值——"滚动"变成"先闪一下终值，再跳回起点，再滚"。
      真浏览器实测：连续 `render(3)` → `render(7)` 后同步读 DOM，读到的是 **"7"**。
      修法：countUp 在启动 rAF **之前先 `el.textContent = 起点值`**（同步写，不等帧）。
    ▸ (b) `Number(null)` 是 0、`Number('')` 也是 0 ⇒ "没有样本"的那一格会被滚成一个理直气壮的 0。
      这条是**单测先红逼出来的**（`countStep(3, null, 0.5)` 期望空串，实得 '2'）。
      修法：`countup.js` 里唯一判据 `num()/isNum()` 显式把 null/undefined/''/布尔 判成"不是数"，
      面板与纯函数都用它——**不许各处自己写 `Number.isFinite(Number(x))`**。
    ▎通用判据：① 任何"从旧值过渡到新值"的动效，都要问一句"这一帧之前 DOM 里是什么"；
      ② 任何"有没有值"的判断，先假设 JS 的隐式转换会把它变成 0（同坑 54：`env || 默认值` 让 0 失效是同一族）。

103. **★ 给一个已有节点加子元素，会打断所有"按位置取第一个子节点"的既有代码（2026-10-06 实修）**：
    屏幕格的模糊衬底第一版写成 `box.insertBefore(bg, box.firstChild)`（"要垫在最底下"的直觉写法）。
    它确实垫在最底下了——于是它成了格子里**第一个 `<video>`**，而项目里有好几处按位置读子节点：
    ▸ `document.querySelector('.tile-main video')`（画中画入口）→ **画中画弹出一窗模糊画面**；
    ▸ `check:screenshare` 里"共享格 video 必须 contain"那条断言 → 拿到 cover 的衬底，
      报 `object-fit=cover` 判红（**这次是断言先被抓，产品代码随后被抓**）。
    两种坏法都不报错：主画面照常渲染，只有按位置取元素的那条路悄悄指到了另一个节点上。
    ▸ 修法两件一起做：① **改成 `appendChild` 追加到末尾**，层级完全交给 z-index（衬底 0 / 主画面 1 /
      批注与按钮 2~4）——"谁在上面"本来就该是层叠的事，不是 DOM 顺序的事；
      ② 所有按位置读的地方排掉新类（`:not(.tile-blur)`），并加一条**全文件结构红线**：
      出现 `querySelector('.tile-main video')` 这种不带排他的写法直接红。
    ▎通用判据：**加子元素之前先 grep "谁在按位置读我的孩子"**（`querySelector('video')`、
      `firstChild`、`children[0]`、CSS 的 `:first-child`）；同坑 77（`textContent=` 抹掉图标）、
      坑 82（同一份配置多个读取器）——**都是"我以为只有我在看这个节点"**。
    ▸ 顺带一条同族的"注释也会打脸断言"：计数型断言（"全文件只许出现一次 `location.origin`"）
      会把**注释里复述的历史值**也算成一处（本轮第二次被自己的注释判红）。
      正解不是改注释措辞，而是**让断言跑在剥掉注释的源码上**——这同时堵住了另一个洞：
      被注释掉的规则不该算"写了"（坑 76 那一族）。

104. **★ 动效"在跑"不等于"看得见"，而对照必须只关掉被测量这一个变量（2026-10-06 实修，量具改了三次）**：
    要验的是"授权卡那一圈走光真的在画面上动"。三次写法，每一次都是**量具的错**，不是产品的：
    ▸ (a) 拿"卡内部像素"当"应当为 0 的对照" → 这张卡是 `backdrop-filter` 磨砂玻璃，
      它内部像素本来就在跟着背景的星云漂（实测 内部均差 65 > 环带 33 → 判"光不如背景吵"，假红）。
    ▸ (b) 拿 `prefers-reduced-motion` 当对照 → 它把**环境也一起停了**，两次都读回 0；
      两个零相减等于零，什么都没对照（假绿，而且绿得特别像成功）。
    ▸ (c) 拿环带**平均**变化当判据 → 亮头只占周合约 6%，4920 个像素一平均只剩 1（又是假红）。
    ▸ 终版分三层，从"原因"到"结果"各验一次：
      ① **读原因**：`getComputedStyle(el,'::after').getPropertyValue('--ac-angle')` 在不在长
        （不注册 `@property` 时它永远是字符串，动画"在跑"而角度不插值 → 边框一动不动，坑 76 的 CSS 版）；
      ② **只暂停这一条动画**（Web Animations 的 `pause()`），比较环带的**峰值差**与**热点像素数**
        ——环境照旧，差值才是这道光的净贡献（实测 峰值 418→停后 0 · 热点 682→停后 0）；
      ③ **亮像素计数**（"看得见吗"的最低门槛）+ 采样改成**轮询到出现差别为止**而不是固定 sleep
        （全量 check:all 的负载下，固定 1.2s 会撞上"两张是同一帧"，表现为"光没动"——
        坑 96 那条"量具在跟自己的动画赛跑"第四次应验，还是栽在我刚写的动效上）。
    ▎通用判据：**对照实验的"关掉"必须只关掉我在量的那一个变量**；判据别用平均（会被稀释），
      用峰值/计数；能读"原因"（角度、进度、状态）就别只读"结果"（像素）。
    ▸ 另一条实测教训：**停动效不等于删信息**。reduced-motion 下环与标题都要**留着**（只是不转/不扫），
      因为那条边框的语义是"这张卡需要你决定"，不是装饰。

105. **★ 复盘/报告类工具最容易的腐败：把"没证据"报成"通过"（2026-10-06 实修，`review:meeting`）**：
    这条命令读真实会议的字幕账本与结构化事件出"可用性复盘"。写完后拿真数据一跑，三处都在说谎：
    ▸ (a) "断句碎片 0/0 条（0%）✅" —— 那场会**根本没有定稿标记**，0÷0 被算成 0% 再通过。
      而那正是用户抱怨"识别这么乱"的房间 283648。
    ▸ (b) "语音连续性 ✅ 未见停摆" —— 判据是"没观察到停摆"，可那场只有 3 条字幕；
      **没观察到 ≠ 观察到了没有**。阈值从 3 提到 5 之后同一场改报 ❔。
    ▸ (c) 文件名过滤器 `slice(-12,-6)` 少算一位 ⇒ "最近一天"永远筛出 0 个文件，
      而报告说"今天没有会议记录"——这句话听起来完全合理，**没人会去查一个空结果**。
    ▸ 修法：① 每条结论都带样本量，样本不足一律 `unknown`（图标 ❔，并在合计行写明"❔ 不是通过"）；
      ② 正面证据与缺席证据分开——"观察到停摆"可以直接判坏（哪怕只有 2 条字幕），
      "没观察到停摆"必须有样本量撑着；③ **量具自己要有自检**（`npm run test:review` 19 条，
      含合成账本 A/B/C/D/E/F/G/H/I/J/K 组），(c) 那类"只会漏不会错"的过滤器必须单独钉一条；
      ④ 判据函数**复用生产代码那一个**（`Asr.noiseRiffReason` / `isDupOrFragment` / `normAsrText`），
      复盘脚本自己另写一份"什么算噪声"，报告说的就和系统做的不是一回事了（坑 47）。
    ▎通用判据：**任何"上限/下限/占比"型结论，先问分母是谁、样本够不够、空结果是不是过滤器造成的**；
      同坑 53（判据要尺度无关）、坑 65（断言 0 之前先证明输入真进去了）、坑 72（别把上一次残留当这一轮产出）。




---

106. **★ 背题型的电池会越测越虚：全绿 ≠ 泛化（2026-10-06 实测量到的 54%）**：
    `test:asr` 的房间动作电池有 32 句自然指令**全绿**，而用户第五次说"AI 操控实体还是实现的不行"。
    于是另写 28 句**从未进过规则表**的说法去测——首跑 **13/28 命中（54% 缺口）**，
    比 10-05 那次量出的 26% 还严重：「弄个白板」「白板不用了」「字幕先停一下」
    「把刚才画的都擦掉」「刚才那一笔不要了」「把说话的人放大」「能不能给我配个字幕」。
    ▸ 为什么会长成这样：电池和规则是**同一只手同时写的**——我为了过断言而补的那几个动词，
      自然就进了电池；电池于是只覆盖"我想到过的说法"，而用户的说法来自另一种心情
      （口语会省宾语、会倒装、会用量词、会带上"麻烦/能不能"）。
      **一条从未被执行过的说法，永远不在电池里，而它正是用户的那一句。**
    ▸ 修法里的形状（三条都可复用）：
      ① 电池分两组，一组明确标注**泛化组**（写完规则后专门塞新句子，且这些句子
        在写规则时不存在）；② 泛化组第一次跑必须**允许它红**（它就是用来暴露的）；
      ③ 泛化不能只在纯函数里绿——同一批句子挑 6 句进**真浏览器**断言界面真的动了
        （`test:room-actions` 11→17），因为"读对了 id"和"页面动了"之间还隔着广播与客户端表。
    ▸ 与坑 57（装了≠用上）、坑 76（机制在≠机制生效）同族，但方向不同：
      那两条讲"代码没跑"，这条讲**"测试只测了我记得的东西"**。
    ▎通用判据：**任何"规则表 + 断言表"同批产出的功能，都要再喂一批规则表里不存在的输入**；
      一个只会绿的电池，测的是记忆，不是能力。
    ▸ **同一天第二处应用**（`sfu/ai/brain.js` 的意图分类）：22 句新说法首跑 7 句落进 question，
      全在 chat 类（「你能帮我做什么」「小明你在不在」「你现在在听吗」）——而 question 的 prompt
      写死"只依据会议记录回答"，于是"答非所问"那个老抱怨换个说法又复发。修完 22/22。
      **一处方法论换来两处缺陷**，这就是把教训写成"判据"而不是"这次怎么修"的价值。

107. **★ 改文本判据必须拿真实语料回扫——我这次改宽一条规则，正好写死了用户最常用的那句（2026-10-06）**：
    为了收「把会议录下来」，我在越界表里加了 `录(下来|一下)`。中文没有词边界，
    「**记录**一下 / 记录下来」里的"录"被整条吃掉，于是
    **「把这条记录一下」被判成"开录制"并明确拒绝**——拿 `sfu/captions` 的
    **3332 句真人字幕**回扫，这一句出现 **11 次**，是用户对 AI 说得最多的一句求助，
    而且它本来**真能办**（记进待办/纪要）。修 = `(?<!记)录(…)`；回扫结果 **误拒 14 → 1**
    （剩下 1 句是"打赞/收养"那条噪声幻觉，不是人话）。
    ▸ 最要紧的地方：**纯电池一条都不会红**。那 28 句泛化句子里恰好没有"记录一下"，
      而 DENIED/NEG 反例组也都是"我想到过的反例"。
      把它暴露出来的是**换数据源**：把真实账本的每一句拿去过一次当前规则，数误触率。
    ▸ 所以这次把这件事变成常驻的三处，而不是"下次记得扫一遍"（纪律会被忘掉，坑 40 同一条教训）：
      ① `npm run review:meeting` 每间房新增「**指令回扫**」一行——按**当前**规则重放这场会的人话，
        报"读成房间动作 N 句 / 判越界 K 句（占比）+ 一个例子"，人话 <10 句报 `unknown`
        而不是"没问题"（坑 105 那条口径）；
      ② `test:review` 自检加 4 条（正常讨论不误伤 / 记事求助不被拒 / **真祈使句必须数得出来**
        ——没有这条的话这台仪表会永远绿=白装 / 样本不足要报 unknown）；
      ③ `test:asr` 加 2 条（4 句记事求助 + 全量账本回扫的**上限断言** `误拒 ≤ 2`）。
    ▸ 同一次回扫还抓到**我自己读错数据**的一处（值得单独记）：第一版把账本所有非 bot 条目
      当"人说的话"，得出"18 句会触发房间动作、多数是 AI 回声"。核 `asr` 字段后：
      其中 13 条是 **AI 写进账本的存档回答**（`asr:false`），真正麦克风转写只有 864 句、
      触发 3 句而**这 3 句全是真命令** ⇒ 误触发 0，那个现象本来不存在。
      于是修的是**口径**（回扫只数 `asr===true`）+ 把断言从"逐句金标准清单"改成
      **比例 ≤2% + 样本量门槛**（清单会在用户说出新命令那天变红 = 假红制造机，坑 91）。
      ▸ 通用判据（坑 105 的另一面）：**报表现象之前先确认字段语义**——
        "哪一条数据代表有人说了这句话"这种问题，答错就会去修一个不存在的 bug。
    ▎通用判据：**凡改动"从自然语言里判意图"的规则，验收必须包含一次真实语料回扫**
      （误触率 + 占比 + 样本量），并且那台回扫仪表要留在仓库里，改规则的人下次就撞得到。

108. **★ 滚动续期的"免检窗口"在输入源源不断时等于闸门失效（2026-10-06 夜二，用户一句话推翻了一个看似合理的设计）**：
    「追问窗口」的设计理由当年完全讲得通（"人跟人聊天不会每句都先叫对方名字"）。
    它坏在**前提换了场景就不成立**：那假设是"这是一场和 AI 的对话"，而正常会议的麦克风
    是**常开**的——每次应答都把窗口往后推 20s，只要有人不停说话，窗口永远不关。
    ▸ 现场证据（`sfu/captions/cap-286716-20261006.jsonl`）：21 条转写里只有 4 条提到名字，
      AI 却答了 **18 次**，「拍卖啊！」「咳咳。」「爱丽。」「你把手机放了吧。」全被接话。
      同一条链上还有第二个"没人叫它也开口"的入口：`maybeAiSpeakUp` 的主动播报
      （日志 `ai-proactive-say kind=unowned-todo`，而它 10-05e 那次已经造成过
      "AI 复述自己的话并叫人来认领"）。
    ▸ 修法不是把窗口调小，是**换成按"这一句是不是在叫它"判**（默认 0），并保留配置/env
      开关做 A/B；主动播报同理改成显式开启。判据的形状：
      ▎**"刚才发生过 X"不能当作"现在这句话与 X 有关"的证据**——凡是"一段时间内放宽判据"的
        机制（免唤醒窗口、滑动续期 token、最近活跃就免检），都要先问一句
        **"这段时间里输入是源源不断的吗？"** 是 → 窗口就从"便利"变成"闸门永久敞开"。
    ▸ 顺带记一条**同名函数声明会互相覆盖**（本轮我自己写出来的）：我在 `asr.js` 顶部按
      分层判据重写了 `shouldWake`，而文件下面那份旧的同名声明**被提升后胜出**——判据改了、
      行为一字没变，两条电池断言红得莫名其妙。`node --check` 不管、没有断言就永远看不见。
      防守：`test:asr` 加一条"两个入口对同一句必须同真同假"的断言（`shouldWake` ↔ `wakeReason`）。

109. **★ 为"可读性"动切句判据，必须给"完整性"留下限（2026-10-06 夜二，被真跑 test:asr-live 抓回来）**：
    真实账本里的 blob（「哦 不能往上怎么接那个 大木车是不是 你好小明」= 三句话被 10s 保险丝粘成一条）
    既是"识别不准"的字面证据，也是"AI 答得莫名其妙"的成因。第一版 `startsNewSentence` 只要求
    "累积句以句号收尾 + 新段与它无关"就切句——**而模型会给每一段半截话都加句号**。
    ▸ 真跑立刻暴露：一句完整请求被切成「小明，帮我记一下。」+「明天下午三点的评审。」，
      AI 只听到前半句就答了，后半句凭空丢失。**用"字幕好看一点"换了"请求不完整"，方向反了。**
    ▸ 修法：加**归一化字数下限 ≥12**（那才是一句"能独立成立的话"的量）——
      「小明，帮我记一下」8 字 → 不许切、继续等后半句；20~40 字的 blob → 该切。
      两条都钉成断言（正例 + 这条反例），并把下限留成 `ASR_SPLIT_MIN_CHARS` 可调。
      ▎通用判据：**放宽/收紧一个切分判据时，要同时写下"它会不会把我正在保护的东西切掉"**；
        只写正例的判据，等于只测了自己的想象力（坑 106 同一条）。

110. **★ 测试助手的参数顺序在两个文件里是反的：复制粘贴就写出"永真断言"（2026-10-06 夜二，我自己刚踩）**：
    `scripts/test-asr.js` 与 `test-sfu-signaling.js` 用的是 `ok(名字, 条件)`，
    而 `scripts/test-watch.js` 用的是 `ok(条件, 名字)`。我照前者的写法往 test-watch 里粘了 7 条断言，
    于是**条件位上永远是那句中文说明（truthy）**、真判据被当成消息打印出来——
    7 条全绿，而它们什么都没测。跑完我还差点把"43/43"写进汇报。
    ▸ 发现方式很廉价也很容易被跳过：输出里那几条的名字变成了 `PASS true`。
      **看到断言名字像布尔值/数字，就是签名反了**——这条形状值得刻进"跑完测试看一眼花名"的检查里。
    ▸ 通用判据：**跨文件复制测试代码之前，先看一眼目标文件里那个助手的函数签名**；
      同一个仓库里 `ok()` 有两种参数顺序，就是在等着被写反（治本的做法是把 ok 收到一个公共模块，
      但那是几十条历史断言的重构，本轮先记账；下次谁改测试可以顺手统一）。
    ▸ **2026-10-09 这条纪律升级成了机器判据**（L6-lite，没有重构那几十条断言）：
      新增 `scripts/assert-order-guard.js`，**两种约定各接一个守卫**（`name-first` / `cond-first`），
      顺序写反时那条断言自己红并说清为什么——而不是安静地打印 `PASS true`。
      接线覆盖 12 个测试文件（其中 test-files / test-fileview / test-crossnet 原本就有等价的内联检查），
      `test-publish.js` 与 `test-shutdown.js` 被这台扫描**发现也是 cond-first**（我原以为只有 test-watch 一种例外，
      这正是坑 106 的形状：我列的清单只覆盖我想到过的文件）。
      再加两条常驻防守：① 冒烟结构红线"每台会打 PASS 的断言报告器都必须接守卫"（扫到 15 个文件）；
      ② **守卫自己也被单测钉住**（4 条，含"正确写法不许误伤"那条反例——
        一个会误伤的守卫，下个遇到它的人会把守卫删掉，那比不装更糟）。
      ▸ 判据：**防错的机制如果没人测，它就只是一个装饰**（坑 41/56 那条老账的测试基建版）。
    ▸ 与坑 95（计数里混进恒真事件）、坑 57（复用别人的服务器跑出绿）同族：
      **假绿不需要代码出错，只需要断言不成立也不会红**。

111. **★ 秒与毫秒混在一个表达式里 = 窗口放大一千倍（2026-10-07 通宵，配置项读出来是 33 分钟）**：
    续接窗口（"喊了名字后半句被 2s 分段切断时，允许它不作唤醒直接接上"）的写法是
    `AI_ASK_TAIL_MS = Math.max(2000, Number(env.ASR_ASK_TAIL_SEC) || 6) * 1000`。
    下限 **2000** 是毫秒语义、括号里的 **6** 是秒语义——取 max 之后 2000 秒胜出，
    `tailUntil` 距今实测 **1981680ms ≈ 33 分钟**。症状不是"报错"而是**行为变成鬼**：
    半小时之内任何一句话都被当成"它的后半句"直接接话，用户看到的正是
    "我不叫它它也一直插嘴"（与 10-06 夜二那条"追问窗口滚动续期"是同一类病，成因不同）。
    ▸ 发现方式：不是读代码（读代码时它看起来完全合理），是加了一行
      `[asr-speak] woken=? 追问窗=? 续接窗=?` 的诊断打印，把窗口剩余时间摊开才看见 1981680。
      **配置项要打印"我最终算出来的值"，而不是假设自己算对了**（坑 76：机制在≠生效）。
    ▸ 修法：单位在名字里写死（`AI_ASK_TAIL_SEC` → `* 1000` → `AI_ASK_TAIL_MS`），
      钳制用**同单位**的下限 `Math.max(2, sec) * 1000`；并且把"env 传 0 是合法的"
      一并修掉（坑 54：`Number(env) || 默认值` 让 0 永久失效）。
    ▎通用判据：**一个表达式里不许同时出现秒和毫秒**；凡是 `* 1000`，左右两边的数
      必须都在"秒"这一侧。写下 `Math.max/min(常量, 变量)` 时先问"这个常量和变量同单位吗"。

112. **★ 我起的第二台服务器把我的测量污染了（2026-10-07 通宵，坑 81/87 第五次应验）**：
    整句重转（把一句话的 PCM 片段拼起来喂一次模型）第一版实测**从 1.5s 退到 3.7~5.4s**，
    而定稿原因变成了 `split`——我据此写了一段"这条路方向错了"的结论，
    并差点据此把它关掉。真实原因是我为了跑界面检查**自己另起的那台 3021 服务器**
    占着一个 whisper worker 在 GPU 上，转写排队从 0.6s 涨到 4.3s。
    ▸ 关掉 3021 后复测：重转本身 **0.6~1.0s**，从未构成延迟来源；
      而"识别太笨"那一半**确实是真缺陷**（固定 2s 分段把「明天下午三点的评审会」
      切掉尾字「会」），只是我这次归因归错了对象。
    ▸ 最贵的一课不是"先量机器"（这条纪律早就立过），而是**污染会让一个正确的设计
      被误判成错误的设计并写进文档**——错的结论比没有结论更难纠正，
      因为它带着实测数字。修法：测量脚本开头打印"本机现在有几个 node 在跑 sfu/server.js"，
      并且结论里写明这一批数字是在哪台机器、几个并发服务下量的。
    ▎通用判据：**"优化后变慢了"先怀疑测量环境，再否定方案**；
      尤其是"慢的量恰好是我知道的资源瓶颈那一维"（GPU 显存/单串行 worker）时。

113. **★ 绝对定位的参照物会被 backdrop-filter 换掉；用"过渡中的 rect"反推静止位置会让元素飞到千里之外（2026-10-07 通宵，滑动墨条两次写错）**：
    给分段控件做"滑块跟着 active 项滑过去"（reactbits 的滑动指示器），第一版用
    `indicator.style.left = activeBtn.offsetLeft + 'px'` —— 实测**偏 7px**。
    根因：`offsetLeft` 相对的是**最近的已定位祖先**，而容器带 `backdrop-filter`，
    它会**创建 containing block**，于是 offsetLeft 的坐标原点与我要写的 `left` 原点不是同一个。
    ▸ 第二版改用 `getBoundingClientRect()` 作差（坐标系一致了），但为了算"transform 该位移多少"，
      我读的是**上一项在过渡进行中的 rect** —— 滑块直接飞到 1350px。
      过渡中的元素几何不是它的静止位置，拿它当基准就是在跟自己的动画赛跑（坑 96 的布局版）。
    ▸ 终版：要量基准位置时**临时 `transition:none; transform:none`**，读 rect，恢复，
      强制重排（`void el.offsetWidth`），再写 delta transform。四条断言钉住
      （位置对得上/真的在动/点同一项不动/换栏后重新对齐）。
    ▎通用判据：**给一个会动的元素量"它该去哪儿"，必须先让它停下来**；
      而 `backdrop-filter` / `filter` / `transform` / `will-change` 都会改变后代的
      包含块，凡用 offsetLeft/offsetTop 做绝对定位的地方都要怀疑这一条。

114. **★ 猜别的控件多高，就是没有来源（2026-10-07 通宵，坑 79 第三次应验：共享画面被半透明坞糊住一截）**：
    "屏幕比例不协调"的另一半不是比例，是**底部那一列压进了视频网格**：
    `.stage` 写着 `padding-bottom: 84px`——那个 84 是当年"控制坞大概这么高"手填的数，
    而坞早就换成了两行 + 磨砂玻璃（`backdrop-filter`），真实占位 130px+。
    结果最后一行格子的下半截在坞**底下**，半透明玻璃把画面糊成一片，
    用户看到的正是"共享那块看着不舒服"。数字上什么都对：格子宽高比、不溢出、层叠顺序——
    **只有截图能看出来**（又是坑 96 那条：布局验收必须看图）。
    ▸ 修法不是把 84 改成 130（那还是猜，坞下次变高又错）：
      把 `.bottom-stack` 从 `position:fixed` 改回**正常流**，`.stage` 去掉那个 padding，
      "谁占多少地方"由网格自己算 —— 一个概念一个来源，坞长高时画面自动缩小，没人需要知道它多高。
      `check:dock`/`check:screenshare` 各加一条断言钉住（画面格与底部列的矩形不许重叠）。
    ▎通用判据：**当你想"把这个数改大一点让它别挡住那个东西"，那通常是缺一个布局关系，
      不是缺一个正确的数**（坑 79 原话的第三次应验，这次是 padding 版本）。

115. **★ "与修前一字不差"不是安全性质——一条把 bug 冻结下来的反向对照**（2026-10-07 夜，H8）：
    10-06 给"此刻有没有人在说话"换成自适应阈值时，判据写成 `min(绝对阈值 −50, 噪声底+6)`，
    并且**专门有一条断言**钉住"吵房间阈值仍被 −50 钳住 ⇒ 与今天一字不差"，注释把它当**卖点**写：
    "只增灵敏度，不增误判"。断言一直是绿的，绿了一整天。
    ▸ 它保护的是什么呢？吵房间噪声底实测 −42.9 ~ −45.9 ——**底噪本身就在 −50 之上**，
      于是每一帧都判"有人在说话" ⇒ `lastVoiceTs` 永不超时 ⇒ `silenceConfirmed` 永不成立 ⇒
      句子只能等 10s 保险丝收口 ⇒ **三句不相干的话粘成一条 blob**。
      用户那句"识别这么乱"的一半就是这个 blob，而一条常绿的断言正在保证它不被修好。
    ▸ 发现方式不是读代码（读代码时"只增灵敏度"听起来完全正确），是**换数据源**：
      `TEST_ASR_DEBUG=1 npm run test:asr-live` 让自测把 `voiceThr / floor / 有声帧数` 摊开，
      一眼看见 `voiceThr=-50.0 floor=-42.9`、495/1444 帧判有声、定稿只剩一条。
      （同坑 107：把它暴露出来的永远是换输入，不是加思考。）
    ▸ 修法 = 双边钳位 `clamp(噪声底+6, −74, −42)`，两边都是**硬安全线**而不是调参：
      上端 `−42` 保证"再吵也不许比这更迟钝"，因为把句子分开不能以把 10-05d 那批
      −56 dBFS 的安静麦克风用户整个弄聋为代价（坑 91 的另一半，两边必须同时守）；
      下端 `−74` 保证"再安静也不往下追"（否则一次呼吸/翻页都被当语音）。
    ▸ **新断言的形状**（这才是这条坑的重点）：不写"和昨天一样"，写"这个场景本来该是什么"——
      吵房间：底噪不许判有声（旧版 180/180 判有声 → 新版 7/180，剩下的是攒够样本前的暖机帧，
      另有一条断言单独守着它，所以不许把它当成误判）；
      中等/安静房间：阈值 −54 / −66，**与旧版逐字相同**（该不变的不变，改动的面才被钉死）。
      ▎通用判据：**反向对照要钉"期望的行为"，不是钉"旧的行为"**；
        写"与修前一致"之前，先回答"修前在这类输入上到底对不对"。
    ▸ 同族旧账：坑 57（装了≠用上）、坑 76（机制在≠生效）、坑 105（没证据≠通过）——
      这一条是第四种假绿形态：**断言正确地保护了一个错误的期望**。

116. **★ 一条独立判据被写在别人的提前返回之后 —— 它对最常见的形态永远不执行**（2026-10-07 夜，H6）：
    值守新增的 `diagnoseNetAccess(netCheck, prev)` 里有两条互不相干的判据：
    ① `level` 秩下降 ⇒ 报"跨网能力退化"；② `config.json` 的 `announcedIp` 已过期 ⇒ 报"配置漂移"。
    我把 ② 写在了函数尾部，而它上面有一句 `if (!before || level === before) return out;`。
    ▸ 于是 ② **只在 level 恰好同时变化时**才可能执行。而现实里最常见的形态是：
      **运行时自愈把 level 保住了**（探测到新的本机 IP），配置里的地址却仍然是错的 ⇒
      `level === before` ⇒ 提前返回 ⇒ 那条漂移告警**一次也不会响**。
      换句话说：我把"服务器自己扛住了但配置已经坏掉"这个**唯一需要提醒的场景**
      过滤掉了，只留下"配置坏掉且真的黑屏"那种已经显而易见的场景。
    ▸ 发现方式：写这条断言时我先按直觉把参数顺序粘错了（坑 110：本仓库 `test-watch.js` 是
      `ok(条件, 名字)`，另两个测试文件是 `ok(名字, 条件)`），改正顺序之后**当场红**。
      如果我一直留着那 9 条 `PASS true`，这个 bug 会跟着这条告警一起上线，
      而它的失效方式和所有静默故障一样——"没人收到告警"看起来和"一切正常"一模一样。
    ▸ 修法：把 ② 移到函数**前部**，并明确写下它**不需要基线**（漂移是此刻成立的事实，
      不是"相对上一轮的变化"）；同时给"读不到 config.json"那条分支加了专门一条断言：
      **读不到时不许冲掉上一轮的记账**——否则"恢复过一次、之后再降级"会被当成第一观测而永久沉默。
    ▎通用判据：**把每条独立判据放回它自己的前置条件上**——
      一个 `return` 只应该结束它那个概念，不该顺手吞掉函数里后面所有**互不相干**的判断。
      写法上的做法：判据之间若不共享结论，就**别共享提前返回**（各自 `if` 各自 push，
      最后统一返回），或者把每条判据抽成独立小函数。
    ▸ 配套纪律（同轮第二次应验）：**判据类函数必须有"接线断言"**（`tick` 真的调了吗、
      返回值真的进了 `alert()` 吗、跨轮状态是不是同一个对象），并且每条都要 A/B 证过可红。
      纯函数 51 条全绿，配上零接线断言，仍然可以让这条告警在生产里一次都不响（坑 41/56 第 N 次）。

117. **★ 量具没接线就会把"我测的方式不对"读成"这个方案更差"——同一轮里我自己造的三个假"实测"**
    （2026-10-07 夜，H1 worker 池；三条都写进了代码注释，因为**错的结论比没有结论更难纠正**）：
    ▸ **① "加 worker 之后吞吐反而降"**：`bench:asr-multi` 第一版调 `Qwen.configure({workers:2})`
      却没把 `key` 一路带到 `transcribe(wav, {key})` ⇒ 所有请求按 `slotIndexForKey(undefined)`
      **全落 0 号槽**，2 号槽加载完模型就在旁边看着（还白占 1.9GB 显存）。
      我当时把这句写进了结论："多 worker 在这台机器上不划算"。
      ▸ 真凶不是方案，是**我的量具没走那条路**——而报告上两种情况长得一模一样（吞吐没涨）。
        防守：量具里"配了 N 个"必须与"实际起了 N 个"对账（`Qwen.workerCount !== wantWorkers` 直接退出），
        并且断言"第二个槽真的被服务过"，而不是只看总数。
    ▸ **② "实测旧哈希分片不均"**：我看到 6 个 id 里 5 个落到同一个槽，就把这句写进注释当换 FNV 的理由。
      可那 6 个 id 是**我随手编的**（`AAA1/AAA2/BBB3…`——它们本来就该撞在一起）。
      换成 64 个真实形状（socket.io 那种随机 base64url 短串）再量：旧写法 36/28、FNV 28/36，
      **两种都均衡，5/6 只是 n=6 的正常波动**。换 FNV 仍然换（更标准的扩散没坏处），
      但**理由不能是一条我没测出来的"缺陷"**。
      ▸ 通用判据（坑 53/105 的同族）：**写"实测"两个字之前先问样本量是多少、样本是不是我编的**。
        小样本上的偏斜不是结论，而"我编的样本"连样本都算不上。
    ▸ **③ 绝对值随机器冷热漂，比值才站得住**：同一档（8 路 + 让路）隔两小时复跑，
      p95 从 2.73s 漂到 3.18s（本机 GPU 空闲时钟 285MHz，冷启动那一跑整段都在爬频）。
      若拿"1 worker 的旧数 2.73"比"2 worker 的新数 1.78"，我会写出"≈1.5 倍"这种**混场次**的数；
      正确做法是**同一场次内 1→2→1 跑三次**，用两端落回同值来证明顺序/冷热没有吃掉差值
      （实测 3.18 → 1.78 → 3.14，比值稳定在 ≈1.65）。
      ▸ 通用判据：**跨时间比的数不是实验结果**；对照组与实验组之间隔了多久，就要在结论里扣多少信任。
    ▸ 顺带一条**判据写错也会红**的小事（同轮）：断言里用 `RegExp.$1` 取上一个正则的捕获组，
      而同一条 `&&` 链后面还有一个**无捕获组**的正则——`RegExp.$1` 会被那次匹配清成空串，
      `Number('')=0` 于是报"常量配小了"。第一版就这么红过一次，看着像产品问题。
      写法：`const m = s.match(/…(\d+)…/)` 存进局部变量，别依赖全局正则状态。
      ▎通用判据：**假红的第一个嫌疑人是判据自己**（坑 80/110 反复应验的那条）。

118. **★ 浏览器那一轨的代码，在 Node 里永远不会被执行——而"两条路"里更常走的那条才是没测的那条**
    （2026-10-08 实修，第 51 步共享文件；这一条是本轮最贵的，因为它**红在真浏览器里、绿在 178 条单测里**）：
    `fileview.js` 读 ZIP 里的 deflate 条目有两个实现：浏览器用 `DecompressionStream('deflate-raw')`，
    Node 注入 `zlib.inflateRawSync`。第一版浏览器分支写成
    ```js
    const w = ds.writable.getWriter(); await w.write(b); await w.close();   // ← 等关闭
    const buf = await new Response(ds.readable).arrayBuffer();              // ← 读者在下一行才诞生
    ```
    ▸ **这是自死锁**：`DecompressionStream` 是 TransformStream，**写侧要等读侧把队列排空才收工**，
      而这里 `await w.close()` 卡住时，唯一会读 `ds.readable` 的那行代码还没执行到。
      症状与"文件坏了""解压格式不支持"都长得一模一样：**整条 promise 永久不 settle**——
      不抛错、不超时、控制台干干净净；`__cfErrs` 里 0 条记录，因为**根本没有异常可记**。
      我是怎么定死的：给页面发一条 `await FV.docxToHtml(bytes)` 的 `Runtime.evaluate`，
      它**超时**（不是报错）；`await` 一个永不完成的 promise，是唯一"报错也没有"的失败形态。
    ▸ 最迷惑的地方是**测试全绿**：Node 18+ **也有全局 DecompressionStream**，
      而 `typeof require === 'function'` 在 Node 里成立——原先判据顺序是"浏览器分支在前"，
      所以单测跑的其实是**那条有毛病的路的另一半**（Node 里 writer/close 的调度与浏览器不同，
      恰好能过）；真浏览器里同一份代码就是死。
      **一个运行时全绿，不能给另一个运行时作证**（坑 57"装了≠用上了"的镜像：写了≠跑的是那一版）。
    ▸ 修法三件缺一不可：① **判据顺序换过来**（能力更弱但更确定的 zlib 先判，Node 走同步那条）；
      ② 浏览器分支改成**自己拿 reader 从头排**，`write/close` **不 await**、立刻开始读，
        不依赖 `Response` 的实现细节；③ **给"卡住"上保险丝**（`withWatchdog` 12s）——
        万一将来再卡，界面上得到一句"解压卡住了"，而不是永久转圈（坑 76：机制要有可观测的失败形态）。
      另补一条安全线：解压上限 `MAX_INFLATE_BYTES=64MB`（ZIP 压缩比能做到 1000:1，
      一兆的 docx 里塞 1GB XML 完全合法），并且**上限可以用 `{maxBytes}` 压低**，
      否则这道闸只能用一份 64MB 的真文件测到——**测不到的安全线等于没有**（坑 83）。
    ▸ 防守（这才是重点，因为"再写一遍时一定会忘"）：`test:fileview` 新增 **G2 组**——
      把 `fileview.js` 装进一个**没有 `require`/`module` 的 vm 上下文**里加载，
      于是 `defaultInflateRaw()` 只能选浏览器那一支，测的是 **shipped 的那几行**而不是我另抄的一份；
      每条 await 都包在**有上限的** `within(p, 8000)` 里（旧写法在这里必然红成"8s 没回话"），
      并且同一份 docx 走两条路**逐字符一致**才算"两个运行时同一份代码"。
      ▸ 跨 realm 传字节要用**普通数组**：`Array.isArray` 按内部槽判（跨 realm 成立），
        而 `instanceof Uint8Array` 对外来 Buffer 是 false（本项目的老教训）——传错容器 `toU8` 直接抛。
    ▎通用判据：**凡"平台分支"（浏览器/Node、真机/模拟器、同步/异步），验收要分别证明每一支都被执行过**；
      一条分支只在一个运行时被覆盖，就等于另一个运行时的上线没有测试。

119. **★ 测试走了后门，整个界面处在用户到不了的状态——只有命中测试看得见（2026-10-08 实修）**
    `check:files` 的进房函数原先是：点「游客进入」→ **直接点「创建房间」**。
    中间漏了首屏那颗「进入会议」（`#pjEnterBtn`）——而 `#prejoin` 是 `.app` 的**兄弟**、
    `position:fixed; z-index:100` 的整屏遮罩，**只有那个按钮的处理会收起它**。
    于是页面进入了一个真人到不了的状态：人在会里、文件面板也真的渲染了、清单和字节全都对，
    而**首屏那层还盖着全场**。
    ▸ 为什么所有断言都没红：`.click()` 是**编程式**的，浏览器不检查遮挡；
      而 DOM 属性（类名、文本、矩形、`innerHTML`）在遮罩下面全都正确。
      唯一把它照出来的就是我新写的那条 **`elementFromPoint` 命中测试**（坑 80 的手法），
      它报的是 `MAIN#hero`——"我要点这块地方，浏览器把事件给了 landing 页"。
      换句话说：**如果那一轮我没做命中测试，这个状态会一路跟着代码进生产**，
      而用户看到的是"会议界面点不动"（比"功能坏了"更严重，且没人能说出为什么）。
    ▸ 修法两层（缺一不可，和坑 81 那条"产品侧 + 量具侧都要修"同形）：
      ① **产品侧把不变量写成结构**：`enterRoom()` 现在调用幂等的 `dismissPrejoin()`
        ——"人在会里"必然蕴含"首屏已收"，不再依赖"有人点了那颗按钮"；
        （顺带把辉光停止/试音关闭一起收进同一个函数，避免"收起了但还在烧 GPU"）。
      ② **量具侧走真路径**：`authGuestBtn` → `pjEnterBtn` → `createBtn`，
        并补一条专门断言"首屏那层已经收起来了"——**前提要断言，不能被省略**（坑 55/63）。
    ▎通用判据：**"页面处在用户到得了的状态"本身就是被测内容**。
      用编程式点击、直接改变量、绕过路由/门禁来"快速进入被测状态"，
      测到的常常是一个不存在的产品；而这类偏差只有**问页面"这块归谁收"**才会暴露。
    ▸ 同一条纪律顺手抓到的第二处（同族、更早）：「我打开一份文件」= 打开 + 广播两半，
      原先两半写在两个调用点后面。新增唯一入口 `openFileAsMine()`，并在冒烟里加结构红线
      （裸 `openFileByName(` 只许出现 3 处：定义 / 入口内部 / 跟随应用）。
      漏掉广播的症状不是报错，是**别人屏幕上静默不跟**——正是用户会报的那句"不同步"。

120. **★ 轮询条件必须**等于断言条件**，否则读到中间态判红（2026-10-08 实修，坑 96 的第 N 次应验）**
    `check:files` 的滚动同步那条：先轮"B 的画面 `scrollHeight>clientHeight`（能滚了）"，
    再读 `scrollTop/max`。第一版永远红在 `ratio:0`——因为"B 能滚"在**它刚换完文件那一刻**就成立，
    而 A 的滚动还在 150ms 节流窗口 + 服务器转发 + B 渲染之后。**量具读到的是中间态**。
    ▸ 修法：**把轮询条件写成断言本身**（"跟到了 0.85 以上"），超时再单独取一次现场当诊断信息；
      同时前置一条必须成立的断言——"A 这边这份文档确实能滚（max>0）且已滚到底"，
      否则"B 没跟上"这句话把**夹具的问题**说成了功能的问题（坑 65：断言变化之前先确认变化能发生）。
    ▸ 同一轮还有两条同形状的修正：① Markdown 夹具太短，`322>322` 让"滚到底"结构上不可能成立
      → 专门写长到 1739px；② 断言"图标只有一颗"写成 `svg===1`，
      而第 43 步的升起外壳**有意把内容复制成两层**（`svg=2` 才是正确形态）——
      改成"1~2 颗 + 每颗渲染尺寸 ≤24px"（真正的红线是没写 CSS 时按 300×150 渲染，坑 78）。
    ▎通用判据：**轮"因"不轮"果"、轮"断言"不轮"前提"**；
      凡是异步链路（节流、广播、渲染、动画）之后的读数，先问一句
      "我等的是这件事完成，还是等它开始"。
    ▸ **2026-10-09 第七次应验，就栽在我当天自己写的那一条上**：`check:files` 的图片那条轮的是
      "**`<img>` 元素出现了**"，断言却是"**`naturalWidth>0`**"——图片解码本来就是异步的。
      同一个套件当天跑出 71/71、72/72、72/72，**第四次**红在 `{"natural":0,"blob":true}`，
      看起来完全像"下载这条路坏了"（那会是真产品缺陷）。
      修法与 10-08 那条一模一样：**把轮询条件改写成断言条件本身**（`natural>=1 && blob`，上限 15s），
      超时后再补读一次现场（`complete` / `clientWidth`）当诊断，判据一个字没放松；
      改完连跑两次 **71/71 + 71/71**（"会移动的失败"消失本身就是这条修对的证据）。
      ▎教训的形状：**同一天里"跑了三次都过"不是稳定性证据**——三次只是三次抽样；
        凡是读"外部资源解码/动画/网络之后"的值，轮询条件必须逐字等于断言条件。

121. **★ 内置阅读器吃 URL fragment：改 `#page=` 不等于翻页（2026-10-08 实修，路线图 I1）**
    PDF 这一路用浏览器内置阅读器（`<iframe src="blob:…#page=3">`），我们只给页码提示。
    client 里原来的写法是 `fr.src = blobUrl + '#page=' + n` —— **第一次进 PDF 是好的，之后再改片段画面一动不动**。
    实测证据（夹具第一页画一大块黑、第二页留白，设计上差 47 个点）：翻页前后黑色占比
    **58.9% vs 58.9%**，而 DOM 里 `src` 明明变了。
    ▸ 为什么它难被发现：不报错、不崩溃、`src` 也真的改了，只有"看画面"才知道 ——
      而自动化浏览器恰恰最难看画面（见坑 122）。这次是**换一种量法**才抓到的：
      断言"翻页前后 `iframe` 必须是不同元素"，一次就红；改成重建 iframe 后转绿。
    ▸ 浏览器为什么这样：同一个文档 URL 只换片段，按规范算**页内导航**，插件因此不动。
      正解不是绕一下（先置空再赋值 = 闪两下），而是**换节点**：旧节点移除、新节点带上完整片段；
      同时必须配一条守卫"**同一页不重建**"——否则跟随每 120ms 节流一次就重启一次画面。
    ▸ 拼法收成唯一一处 `FV.pdfSrc(url, page)`（带页数上下钳制），并加两条**结构红线**：
      client.js 里 `#page=` 字面量 **0 次**、`FV.pdfSrc(` 调用点**恰好 1 次**。
      ▎写这两条的理由：第二处拼接一旦出现，下一个人就会"照着旁边那段写"，收敛等于没做（坑 47）。
    ▎通用判据：**跨引擎/跨插件的"我已经设置过了"不算数**——要量"对方因此重做了没有"；
      能读节点身份就读身份，读不到再退到观察值。

122. **★ 无头浏览器里的插件像素不可靠：量不稳的东西不许当判据（2026-10-08，坑 121 的同一天）**
    为了回答"内置阅读器到底画出来没有"，我给 `check:files` 加了像素实验（截图 → 数黑色占比）。
    同一份夹具、同一个页面，连读四次得到 **34% / 49% / 94% / 53%**。
    第一版把它写成断言，立刻变成"会移动的红灯"（坑 80）；第二版把阈值放宽到 30%，
    又变成"永远绿"（坑 115 那条：**断言正确地保护了一个错误的期望**）。
    ▸ 根因不在我们的代码：无头 Chrome 的 PDF 插件**渲染时机与合成器截图不保序**——
      它画了，但没有一帧"稳定画好"的状态留给我抓。
    ▸ 处理：**判分只押在能稳定读到的那一层**（元素存在 / `src` 形状 / HTTP 头 / 节点身份），
      像素那一层**降级为打印观察值**，并在报告里写明"这一项要人来验一次"，同时留一张现场图给人复核。
    ▎通用判据：**"能测"与"测得稳"是两件事**。一条随负载/时机变化的读数写成断言，
      就是在制造未来的假红或假绿 —— 它该去的地方是**观察值 + 人工清单**
      （与坑 96/104 同源：量具在跟自己的渲染赛跑；这次输的是浏览器内部的渲染，我更管不着）。

123. **★ 变异路径没被执行过的 A/B，同样是假绿（2026-10-08，soak 接入文件流量）**
    给 `npm run soak` 加完"文件清单对账"之后，我按纪律做 A/B：把删除改成"只从台账抹掉、不真删"，
    预期它当场红。结果 **退出码 0、一片绿**，差点就这样交付。
    ▸ 真相：那一轮只上传了 2 份，而保留上限是 3 —— `trimOnce` 开头那句
      `if (state.fileLedger.size <= FILE_KEEP) return;` 直接返回，**被我变异的那一行根本没执行**。
      绿的是"我没走进那条分支"，不是"判据不灵"。把保留上限调到 1 再跑，立刻红：
      「❌ 文件清单对账不平：服务器「soak-1.md|soak-2.md」↔ 脚本台账「soak-2.md」」。
    ▸ 更值钱的一半是让**工具自己说出来**：soak 现在多一条判据
      「上传数 > 保留上限却一个都没删 = 修剪分支今晚没被执行过，这条绿不算数」，
      并用"把 trim 提前 return"这个变异证过它会红（退出码 1）。
    ▎通用判据：**A/B 要问"我改的那一行今晚跑了吗"，不是"我改完之后它红了吗"**。
      凡是"到某个条件才走"的分支，判据里要带一个**触发计数**（坑 76 那条纪律的 A/B 版），
      否则"测试通过"与"测试没跑"在报告里长得一模一样。

124. **★ 泛化补齐必须两侧一起钉：接得住新说法，也要不吃进"只是在谈内容"（2026-10-08，I9）**
    共享文件面板上线时 `files-open/close` 的规则表配了 15 句电池，全绿。
    而另写 30 句**从未进过规则表**的自然说法去测，首跑 **open 命中 9/18、close 9/12**
    ——用户第五次报的那句"AI 操控实体类的功能还是实现的不行"，谜底还是同一个（坑 106）。
    ▸ 缺口长得很具体，值得记下来，因为**下次还会是这样**：
      ① 名词侧我写成了**字面短语清单**（文件面板 / 资料面板 / 文档面板…），
         可口语指代一个界面用的是**远指 + 量词**——「把文件那块弄出来」「共享资料那块打开来」「文件那里收起来」；
      ② 动词**倒装到名词后面**（「文件面板亮起来」「文档窗口弹出来」），旧表只认"动词在前"；
      ③ 光杆动词 + 数量/清单词（「有哪些文件」「材料清单显示一下」）；
      ④ 礼貌请求的形状是**问句**（「能看下文件清单吗」），而问句守卫整条排在规则之前 ——
        守卫本身是对的（"问一件事 ≠ 命令一件事"），但它把真正的请求一起吃掉了。
    ▸ 修法：名词侧改成**成分式**〔可选"共享"前缀〕+〔文件|资料|文档|材料〕+〔可选后缀：面板/窗口/列表/清单/那栏/那块/那里…〕，
      动词两侧都收。补完 open 17/18、close 12/12。
    ▸ ★ 真正容易做错的是**另外两侧**：
      **(a) "只是在谈内容"一句都不许动界面**——`F_THING` 刻意**没有**"裸名词"这一形态
      （必须带"共享"前缀或面板后缀之一），于是「这个文档讲了什么」「把这份文档发给大家」
      「共享文件里有没有报价」全部不触发；变异"把裸名词也算上"之后
      两条反例断言（9 句 + 10 句）**当场红**，证明这条保守边界是承重的，不是装饰。
      **(b) 中文的"能"有两个身份**——「能看下文件清单吗」里它是情态动词（= 请求），
      「能力打开白板吗」里它和"力"是一个名词（= 问能力）。
      把 `能` 直接加进礼貌标记表会把后者也判成请求，于是例外要写成
      `/^(?:能|能否)(?!力)[^。，,]{0,3}(?:看|打开|…)/`：**句首 + 紧跟一个动作动词**，
      并用 `(?!力)` 挡住名词化开头。去掉 `(?!力)` 之后"有意不接"那条断言红。
    ▸ 剩下 1 句**有意不接**并写进电池（不是漏网）：「共享文件呢」——"X 呢"太常见
      （「我的文件呢」多半在找东西），拿它去改全房的界面是猜，代价不对称。
    ▎通用判据：**加宽任何"从自然语言判意图"的规则，验收要同时跑三组**——
      泛化组（新说法必须接住）+ 谈论组（提到这个词必须不动）+ 有意不接组（把取舍写成语句，别写成沉默）；
      只跑第一组的"全绿"，等于把我当初那 50% 的缺口换个位置再犯一次。
125. **★ 限额也要问"作用域是哪一级"——一条"每份文档 16MB"的上限实算是"每页 16MB"（2026-10-08 实修，路线图 I8）**
    共享文件上线时我给内嵌图片写了 `MAX_IMG_TOTAL = 16MB`，注释写着"一份文档内嵌图片总量上限"。
    今天第一次拿**真实文件**跑它（`npm run review:office`，扫本机磁盘上现成的 Office 文档）：
    一份 25 页、`ppt/media` 解压后合计只有 **7.5MB** 的 PPT，被渲染成 **61 条 data URL / 40.4MB 的 HTML**。
    ▸ 根因不在数值而在**作用域**：`total` 是 `collectImages` 里的局部变量，而 pptx 是**逐页**调用它的
      ⇒ 每页从零开始。写的时候谁都没错，只是"文档级"这个词从来没落到实现上（坑 76：机制"在"，从未生效）。
    ▸ **我先把这条缺陷的动机写错了**：看见 40.4MB 我立刻写下"面板一插入就冻住标签页"，
      并据此想把上限调到很小。写了台量具（`npm run bench:innerhtml`）实测才知道：
      **0.5MB=3ms、8MB=37ms、16MB=63ms、40MB=145ms** —— 字符串插入根本不是瓶颈。
      于是注释与代码都改口：上限是"防无界增长的体验保险丝"，不是"超过就卡死的悬崖"。
      ▎通用判据：**"我觉得它会卡"不是证据**。凡是拿性能当理由改数值，先把那个数值对应的物理量量出来；
        量不出来就别写进注释（注释里一句没量过的因果，会被下一个人当成事实继续往下推）。
    ▸ 现在的形状：**两条账各答一个问题**——
      `decoded`（唯一图片解压字节，同一张图只算一次）管解码内存；
      `emitted`（**每次引用都算**，一张 logo 引 20 页就是 20 份字符串）管 DOM 里的字符数。
      两者天然是不同的数，硬用一个上限就会两边都判错。修完那份真 PPT 是 21 张图 / 10.7MB HTML，
      并且界面上明说"为流畅起见省略了 40 张内嵌图片，下载可看完整"（占位方块只说明"这里曾有图"，
      说明不了"为什么没有"，坑 82）。
    ▸ 还有一条容易混的：**"这格式浏览器画不了"与"预算不够被裁掉"不许进同一个计数**——
      混了那句"省略了 N 张"就在谎报原因（有人把 `.emf` 改名成 `.png` 塞进 PPT 是常态）。
      缓存里用 `{bad}` / `{over}` 两种结局分开记，`test:fileview` 有一条断言专门钉它，
      并且用"把 bad 改成 over"这个变异证过会红。
    ▎通用判据：**任何"总量上限"落地时都要回答"这根计数器活在哪一层"**（每次调用 / 每页 / 每份文档 / 每个房间）。
      答错一层的上限，比没有上限更难发现——因为它**只在足够大的输入上才暴露**，
      而"足够大的真实输入"恰恰不在我自己写的夹具里。

126. **★ 探针猜错被测数据结构，会造出一条比产品缺陷更贵的假结论（2026-10-08，同一晚踩三次）**
    今天用真实文件回扫渲染内核，第一版探针报"10516 个字的文档只渲染出 24 个字 —— 大量文字丢失"。
    我据此差点去改遍历器。三个版本之后才发现**两次都是探针自己的错**：
    ▸ ① 正则 `<w:t[^>]*>` 会把 `<w:tbl>`、`<w:tc>` 一起匹配掉（`[^>]*` 能吃掉 `bl`），
      于是"原始文本 10516 字"根本不存在（正确的写法是 `<w:t(?:\s[^>]*)?>`）。
    ▸ ② 我按想象中的节点形状 `{children, text}` 读解析器输出，而真实形状是 `{tag, attrs, kids}`、
      文本是 `kids` 里的裸字符串 ⇒ "解析器看到 w:p=0"，而渲染器明明提出了 16 段。
    ▸ ③ 顺带还有：`require('../webrtc/sfu/…')` 猜错路径、`FV.openZip(...).find()` 猜错 API、
      `{Cdp}` 猜错导出名、`cdp.close()` 猜错收工方法 —— **每一次"猜"都产生一条错误结论或一次白跑**。
    ▸ 真正的产品结论最后只剩一条（而且是被 ①② 排除掉之后才站住的）：那份"文字极少"的文档
      是真的几乎没有文字层（扫描件），不是渲染丢了。
    ▎通用判据：**用一次性脚本去"看"被测对象之前，先用被测对象自己导出的 API 看一遍**
      （这里就是 `FV.children/textOf/parseXml`，而不是我自己写的正则与 walk）。
      判据与产品不同源，报出来的"缺陷"就有一半是量具的故障 ——
      而这类假缺陷最贵的地方不是白跑，是**它会把你引向一次不必要的产品改动**
      （坑 80/110/117 今晚第四次应验，且三次都应在我自己写的工具里）。

127. **★ 按"句首动词"判意图的客户端启发式，会静默截走整类指令（2026-10-08 实修，用户第五次报"操控实体不行"的真成因之一）**：
    `sendAiQuestion`（聊天里 `@ai …` 的入口）从 09-19g 起写着
    `if (/^(操作|打开|点击|帮我操作|远程)/.test(q)) socket.emit('ai-op', {goal: q})`。
    它的本意是"帮我操作那台电脑"（C1 远程操作员），但它只看**句首动词**，不看动词的宾语属于哪一层。
    ▸ 于是「@ai 打开白板」「@ai 打开共享文件面板」这类**房间级指令**在客户端就被改道，
      服务器的房间动作规则（`ROOM_ACTION_RULES`，排在 LLM 之前 = 坑 38 的 tools-first）**根本没机会跑**。
      房间里没有被控端时 `ai-op` 回一句"先有人共享屏幕并打开「允许远程协助」…"——
      **界面一个字没动，而那句回话听起来完全正常**。
    ▸ **为什么 17 项真浏览器电池一条都没抓到**：那些用例的说法全是
      「把白板打开」「开启实时字幕」「切到宫格视图」「白板不用了」——
      **没有一条以"打开"开头**。我把同一个动作测了十遍，却每次都绕开了坏掉的那条语序（坑 106 原样复发）。
      把它暴露出来的动作便宜到值得记住：给新功能加真浏览器用例时，我按**最自然的语序**写了一遍而已。
    ▸ 修法不是给这条正则再补一个例外（那只能救我下次想到的那两句），而是**换判据的维度**：
      `AI_OP_CTX_RE`（提到哪台机器：电脑/桌面/浏览器/记事本/计算器…）**×** `AI_OP_VERB_RE`（要做什么动作），
      另留 `AI_OP_EXPLICIT_RE` 给「帮我操作」「远程控制」这种没有第二种读法的说法。
      ▸ 为什么不用一条大正则：把"电脑"和"打开"揉进同一个字面分支，就会退回到"只看句首动词"的老判据，
        而中文两种语序都常见（「在他电脑上打开记事本」/「打开他电脑上的记事本」）。
    ▸ 三层防守（`test:smoke`，都用旧判据复跑证过可红）：① 服务器每条 `ROOM_ACTIONS` 的 **cn 名**
      （= AI 自己说出口的那句）不许被截走；② 11 句自然说法不许被截走；
      ③ **正例必须仍然走 ai-op**——只断"不许截走"，把 C1 整条链路堵死也能全绿。
      三条正则**从 client.js 源码里抓**，不在测试里重抄一份（重抄那份一漂就是假绿，坑 47）。
    ▸ 顺带一条不对称，记下来免得下次误判：语音那一轨走 `socket.emit('ai-ask')` 直达服务器，
      **从来没被这条启发式影响过**。所以"打字说打开白板没反应、喊小明说打开白板有反应"这种怪现象，
      根因就是**两个入口对同一句话判据不同**（坑 82 的入口版：同一份数据多处读取，写入点却不止一处）。
    ▎通用判据：**任何"看开头几个字就改道"的分流，都要问"宾语/上下文属于哪一层"**；
      而一条按字面位置判的路由，它的测试必须包含**最自然的那句人话**，不是我最顺手写的那种语序。

128. **★ "解耦"只做了收、没做发：一颗写着「跟随主讲」的按钮，按下去是"抢主讲"（2026-10-08 实修，第 51 步）**：
    共享文件的跟随模型是"人人平等、最后动的人赢"，服务器只有一份权威 `room.fileView`。
    但客户端两条判据只写了一半：`applyRemoteView` 有 `if (!filesFollow) return;`（关跟随 → 不收），
    `emitFileView` 却**没有对称的那半**（关跟随照样往外广播）。后果是用户可感知、零报错的三件事：
    ① B 关掉跟随只想自己翻一翻 → 一翻页**全房被 B 拽走**；
    ② B 再点那颗写着「跟随主讲」的按钮 → 处理器里写的是 `emitFileView(true)` = **B 宣布由他带大家看**，
       而不是"我跳回主讲那一份"；
    ③ A 的徽标变成"跟着 某位成员"，而 A 屏幕上什么都没发生——**用户看不出谁做错了什么**。
    ▸ 真浏览器实测（`check:files` S 组，修前先跑）：`A 现在=评审结论.md`（本该停在 A 那份）、
      `B 现在=(没跳回来)`。修后同一批断言：A 停在原处 · B 跳回主讲 · A 徽标仍是"你在带着大家看"。
    ▸ 修法两条，各自都有一条断言：`emitFileView` 加"不跟随就不发"（**解耦必须是双向的**），
      那颗按钮改调 `rejoinPresenterView()`——它**复用** `applyRemoteView` 那条正路
      （面板没开要开 / 同一份只调页码与滚动 / 主讲把文件关了就别把我的屏一起抽走），不写第二份（坑 47）；
      本地从没见过视角就去问一次权威副本再跟，**不猜"没人带"**（坑 67：读不到 ≠ 读到空）。
    ▎通用判据一：**凡是"开关"式的解耦，都要当场问它挡的是单向还是双向**——
      只挡收不挡发，症状不是"没反应"，而是"我一动大家都动"，比原来更糟。
    ▎通用判据二：**按钮的文案就是契约**。写着"跟随 X"的按钮不许产生"成为 X"的效果；
      做错方向比少做一个功能更糟（与 10-06「别切宫格，把白板打开」把宫格执行掉、
      10-07「追问窗口滚动续期」是同一种病：**把用户的意思做反了**）。

129. **★ 我自己用一次性脚本把 AGENTS.md 写坏了两次（一次丢尾部、一次丢一行），记下来恢复路径与守卫（2026-10-08）**：
    今晚为了刷文档计数，我写了几个 `node -e` / `.tmp-*.js` 脚本，用 `s.slice(0,i) + add + s.slice(i+…)` 改文件。
    两次事故都不是"改错内容"，而是**切片切错了范围**：
    ▸ 第一次：`const out = s.slice(0,a) + sec.slice(0,i) + add + sec.slice(i)` —— 把 `sec` 之后的**整个尾部**
      （第 6~9 节：信令表、坑 118~128、进度 5.23~5.25、守则）一起丢了，文件从 5354 行变成 3270 行，
      而 `node --check` 与任何测试都不会红（**这是文档，没有测试覆盖它**）。
    ▸ 第二次：`head -n 2996` 想取"前 2996 行"，而最后一行**没有换行符**，`wc -l` 少算一行 ⇒ 功能表 row 36 被切掉。
    ▸ 恢复靠两条现成的路：**`.qoder/file-history/<会话>/<uuid>@vN`** 存的是每次改动**之前**的快照
      （救回第 6~9 节的骨架），以及 transcript 里 `tool_use` 带着逐字的 `old_string/new_string`（可重放）。
    ▎通用判据一：**改大文件优先用带"唯一性检查"的编辑工具**（Edit 会拒绝不唯一的 old_string），
      手搓脚本没有这层保护，切片范围错了它一声不吭。
    ▎通用判据二：**脚本改完必须立刻断言"变化量在预期之内"**——
      我最后那版恢复脚本给每一步加了增长守卫（一次插入让行数增长超过补丁自身的行数就回退），
      正是它挡住了"按行号取 transcript 条目"造成的**整文件被复制 12 遍**：
      会话被压缩时 transcript 会被重写，**行号会整体漂移**，
      所以我按行号 2218 取到的那条其实是别的 Edit。找历史条目只能按**内容签名**找。
    ▎通用判据三（本项目早就写过、这次是我自己违反的）：**"这次没坏"不等于"这写法安全"**（坑 26 原话）。
      文档没有测试覆盖，所以它的守卫只能是"改完读一遍结构"——我这次在读之前就把文件写回去了。
    ▸ **2026-10-10 第四次应验，而且是被"正规编辑工具"做出来的**：给 `后续升级方向.md` 的 0.11
      结果表追加 B5 那一行时，我用 Edit 把 **B4 那一整行**当成了 `old_string` 的锚点（只想在它后面加一行），
      于是 B4 那 1537 字的成果记录**被整行替换掉**——而 Edit 的"唯一性检查"这次一点忙都没帮：
      我的 old_string 确实唯一，只是**它本身就是我要保留的那一行**。
      ▸ 恢复路径：`git show HEAD:文件` 取回原行、按内容签名（`^| B4 `）定位、插回去，
        再 `git diff --stat` 确认**只有 +1 行**（不是 +1/-1）——这一步才是真守卫：
        **改文档之后必须看变化量**，只看"我那一行加上了"看不出另一行没了。
      ▸ 通用做法：**往表格里"追加一行"，锚点要选下一行的开头**（例如以 `## 1.` 那一段做上下文），
        而不是选相邻那一行的全文；或者干脆只写新行、不匹配旧行（old_string 用行尾空行）。
        同一个坑的四种载体已经凑齐了：切片脚本 / `head -n` 少一行 / transcript 行号漂移 / **Edit 拿整行当锚点**。

130. **★★ 自己写的夹具测的是"记忆"不是"能力"——换两个外来实现当输入，当场掉出五条缺陷（2026-10-09，J1/J2）**：
    共享文件上线时有 **240 条**渲染单测全绿，而用户说的是"word 什么的还是不能观看"。
    本轮把输入换成**别人写的实现产出的文件**，绿的电池立刻不绿了：
    ▸ **python-docx / openpyxl**（另一套 OOXML 实现）写出来的 docx：
      ① 用**列表样式**写的列表 → 圆点与序号全丢（编号定义在 `styles.xml` 的 `w:pPr/w:numPr`，
        段落只写 `w:pStyle`；内核只认段落上直接写的 `w:numPr`）；
      ② `0.00%` 存 0.25 → 显示成 "0.25"（Excel 上是 **25.00%** —— 这不是难看，是**读错数**）；
      ③ `¥#,##0.00` 存 1234.5 → 显示 1234.5（少币符、少千分位、少小数位）；
      ④ 稀疏行被压扁（xlsx 只写有内容的行并带 `r="12"`，内核按出现顺序渲染 ⇒ 第 12 行显示在第 6 行）；
      ⑤ `mergeCells` 不读 ⇒ 合并格不跨列、那一行凭空少一格；外加**文本框/域/OMML 公式**三类
      "字不在正文流里"的容器整片静默丢失。
      ▎这五条没有一条在我自己写的夹具里出现过——不是我写错了断言，是**我想不到要断言它**（坑 106 同一条）。
    ▸ **真的 Microsoft Word/Excel/PowerPoint**（`scripts/legacy-oracle.ps1`）造 .doc/.xls/.ppt 夹具：
      旧格式的失败模式是"抽出来一堆看着像话的乱码"，所以判据必须来自**造这个文件的程序自己**
      （Word 报 Content.Text，我的抽取器去对得上它），而不是我自己写的第二个解析器（自测自己 = 零价值）。
    ▸ 落地形状（下次照抄）：① 输入用**另一个实现**写的产物；② 判据用**那个实现读回来的结构**；
      ③ 产物提交进仓库（回归不依赖 python/Office），④ **缺产物时报红而不是跳过**——
      "跳过"在报告里和"通过"长得太像（坑 76）。
    ▎通用判据：**"测试全绿 + 用户说不能用"同时成立时，一定有一方是假的**；
      与其怀疑用户，不如去问"我的输入是谁生成的"。生成者不是我，这批断言才有信息量。

131. **★ 记错一个常数 = 整类输入被"沉默拒绝"；二进制格式的常数必须让真响应来证（2026-10-09 实修）**：
    Word97 的 `wIdent` 我按 `0x01A5` 判，真值是 **`0xA5EC`** —— 于是 `word97Text()` 对
    **每一份 .doc 都 return null**，界面报"这一份没能抽出文字"，而文件全都是好的。
    ▸ 同一天第二处：手搓 STUN 解析器时 XOR-MAPPED-ADDRESS 的"家族"字段我按 2 字节读
      （真值 1 字节），于是 Google 的真响应被读成"没带映射属性"；而跨网建议**恰恰依赖这个数**——
      读成 0.0.0.x 会把"你已在公网可达"和"你在 NAT 后"两个结论整个反过来。
      修的时候才发现**老属性有两种字节布局**（Google 回 8 字节那种、RFC 5389 写 10 字节那种），
      只按规范那一种判 `len >= 10` ⇒ 真响应永远不匹配，而"匹配不到"看起来像"服务器没回"。
    ▸ 这两条都不是逻辑错，是**我从记忆里抄的数**错。防守：`npm run test:stun`（自造响应验解析，8 项，
      含"真响应的 8 字节形状"一条）；二进制格式的每一处魔数/偏移都该有一条**不依赖外网**的正向对照。
    ▎通用判据：**凡是"读别人家的二进制格式"，每个常数都要有一个用例去钉它**（不是钉在注释里，
      是钉在一次真字节/自造样本的断言上）——记错的常数不会报错，只会让整类输入安静地走进 return null。

132. **★ 反向对照/文案断言必须**逐分支**覆盖：只测我看到的这一支，另一支改坏了不会红（2026-10-09）**：
    旧格式横幅有两条独立文案（二进制 OLE2 与 RTF/网页各说各的真相）。我那条
    "界面上明说不还原"的断言用 RTF 样本跑 ⇒ 变异把**二进制**那句改成"版式字体图片全部一致还原"后，
    整套测试**一条都不红**（坑 123"变异路径没被执行过"的文案版）。
    修法：两条文案各一条断言（`hHostile` 走 RTF、`hBin` 走 legacy.doc），并各证一次可红。
    ▎通用判据：**一条按分支写的说明文案，就要按分支各断一次**；
      做 A/B 变异时要顺手问一句"我改的那一行今晚跑了吗"。

133. **★ 机制一变，按旧机制形态写的探针就变成假红——回头检查所有"隐含假设"（2026-10-09，坑 80 的机制版）**：
    多地址通告 + 固定端口时，mediasoup 把每条 `listenInfo` 绑到**各自的网卡地址**（`0.0.0.0:P` 与
    `<网卡IP>:P` 会抢同一个号 → EADDRINUSE），于是服务器不再监听通配地址。
    我那条 `tcpProbe('127.0.0.1', 3155)` 立刻红——**红的是我沿用旧绑定形态的假设**。
    同一形状第二次：`/config.json` 的固定端口那条断言读的是"HTTP 200 的第一趟应答"，
    而媒体引擎比 HTTP 晚就绪几百毫秒 ⇒ 读到 `fixedMediaPort=0` 判成产品回退（坑 120 第三次应验）。
    ▸ 修法各自都是"判据不变、把量法改对"：探每个**被通告的地址**；读配置时轮询到就绪再断言。
    ▎通用判据：**改完"某件事怎么发生"，就 grep 谁在按"它以前怎么发生"读它**（探针、告警、文档、界面文案都算）。

134. **★ 工具也会无声撒谎：把配置字串原样拼进 URL、把过期结论留在手册里（2026-10-09 两处）**：
    `announcedIp` 从 10-06 起允许写 `"auto"`，而 `doctor` 直接把它拼进打印 ——
    体检报告给出 **`https://auto:3443/`**，一个谁也打不开的主机名，用户照它去试会以为是自己配坏了。
    同轮第二处：《跨电脑连接-操作指南》里"配置已带 openrelay TURN，两台设备在不同 WiFi 也能连"
    ——对 **SFU 主版本不成立**（mediasoup 的媒体不走 TURN 中继），同项目另一份《部署手册》09-19
    就已经把这句话纠正过一次，**指南没跟着改**（坑 57"同项目同一个坑只修一半 = 等于没修"的文档版）。
    ▸ 修法：URL 一律用**解析后的事实**（auto → 本次探测到的网卡地址）；
      文档里的能力声明要跟着机制走，改机制那一次就要 grep 全仓的旧说法（本轮把两份文档的三条路径重写齐了）。
    ▎通用判据：**任何"打印出去给用户照做"的字符串，都必须是可执行的事实**——
      配置字串、示例命令、手册结论都算；过期声明比缺失更糟，因为它会让人去修一个没坏的东西。

135. **★ 内容驱动高度的 fixed 浮层必须有"结构性上界"；而测"用户够不够得着"必须用真人做的那个动作
    （2026-10-09 实修，一条只有全量回归才会露出来的缺陷）**：
    邀请面板（`position:fixed; top:64px`）的高度一直是**内容撑出来的**，谁都没给它上界。
    跨网自检从 5 条长到 7 条之后，它从 733px 涨到 762px ⇒ 全量 `check:all` 里那条
    "整块在视口内"当场红——**最后一行连同"可复制的修复命令"掉到屏幕外面，而浮层没有滚动条**，
    用户看不见自己丢了什么（零报错的失效；窗口越矮越严重，笔记本 768 高正好踩）。
    ▸ 修法不是把 `top` 挪小、不是把字号调小（那还是在猜"内容大概这么高"，坑 79/114 同一条：
      **那是缺一个约束，不是缺一个正确的数**），而是：
      `max-height: calc(100dvh - 76px); overflow-y: auto; overscroll-behavior: contain;`
      （`dvh` 不用 `vh`：移动端地址栏收起时 `vh` 是最大视口，按它算会刚好溢出那一小条；
      `overscroll-behavior:contain` 防"滚到底之后把整页一起带走"）。
    ▸ ★ 真正贵的是**测试写法**：第一版我断"内容没被裁掉"用的是 `p.scrollTop = p.scrollHeight`
      然后看最后一行可不可见。A/B 把 CSS 改成 `overflow-y: hidden`（用户彻底滚不动）之后
      **这条断言照样绿**——`overflow:hidden` 的容器**仍然允许脚本改 `scrollTop`**。
      换成 CDP 真发一个 `mouseWheel` 事件，同一个变异当场红（`scrollTop=0`）。
      另外它还得配一条**前提断言**：先 `elementFromPoint(落点)` 确认滚轮真的落在这块面板上
      （登录卡 z110 盖着面板时，滚轮打在遮罩上，"滚不动"会被读成产品缺陷——坑 119 的原样复发）。
    ▎通用判据一：**凡是"内容会变长的 fixed/absolute 浮层"，上线时就欠一条高度上界**——
      加一行内容不会让任何测试变红，直到某个用户的窗口刚好矮。（L7 把这条升级成全仓扫描。）
    ▎通用判据二：**测"人能不能做到"，就要用人做的那个动作去测**。
      脚本能改的属性不等于用户能触发的行为（同坑 123"变异那行有没有跑过"、坑 63"触发条件本身要验证"）。

136. **★ 测试的默认值必须指向"用户真实配置"：需要额外开关才测到真配置的测试，就是假红制造机
    （2026-10-09 实修，全量回归自己撞的红）**：
    `test:asr-live` 这次红在一条正向对照上（"没叫它的那句闲聊一条定稿都没有"）。
    核日志才发现：那一路走的是 **whisper 兜底**（前两段转写 **8.8s / 10.9s**，而
    `🔥 Qwen3-ASR 本地 worker 已预热` 那行出现在它们**之后**），而用户 `config.json` 写的是 `qwen-local`。
    ⇒ **它测的不是用户在跑的那条路**：慢引擎把相邻句子粘成一条 blob，闲聊句自然没有自己的定稿——
    这是**降级路径的正常形态**，与阈值判据、与产品回退都无关（坑 57 家族第 N 次）。
    ▸ 以前避坑的办法是"记得加 `TEST_ASR_WAIT_WARM=1`"。**这条办法错在把责任交给记忆**：
      下一个跑回归的人（这次就是凌晨四点的我自己）一定会忘，而忘掉的代价是**一个指向错误方向的红灯**。
      修法是把方向反过来：**默认就等主引擎就位**（本地 worker 加载 ~55s，等待是有界的），
      要研究降级形态才显式 `TEST_ASR_WAIT_WARM=0`；同时失败信息里印出
      "喂音频那一刻主引擎到没到"（判据复用生产那一个谓词 `asrPrimaryReady()`，坑 47），
      这样即使它红了，红话里自带"这次是哪台引擎"。
    ▎通用判据：**默认值应该指向生产形态，例外要人主动声明。**
      凡是"要加一个环境变量才测到用户实际跑的那条路径"的测试，迟早用不上的那次把人引向错误诊断
      （与坑 87/112"先量机器上还有谁在干活"、坑 117"量具没接线就把我的测法当成结论"同族，
      只是这次藏在**默认值**里）。

137. **★ 断言"默认状态"的检查，必须自己先把状态清干净：残留会让它去测上一轮的运行（2026-10-09，两向都量过）**：
    全量 `check:all` 第二次跑时 `check:theme` 红了 10 条，第一条写着
    **"默认主题 = 水墨（深色）"读到 `theme=light 按钮="水墨"`** —— 看起来像"默认档被谁改了"的产品缺陷。
    真相是**量具自己的状态污染**：`check:theme` 中途会把主题切成浅色再切回来，而末尾那句
    `localStorage.removeItem('sfu-theme')` **写在正常路径上**；上一次运行只要中途抛错或被 timeout 掐掉，
    存储里就留下 `'light'`，而 `<head>` 里的内联脚本会在下一次首帧把它应用到 `<html data-theme>` 上 ⇒
    **这一次运行的"默认档"断言量的是上一轮的残留**（坑 72 那条纪律的检查版：回归结果不该依赖"上次跑没跑干净"）。
    ▸ 修法两行：**开跑前清档 + 重载一次**（不能只在 JS 里抹掉 `data-theme`——那恰好把"首帧不闪"
      这条被测行为绕过去了），并补一条**前提断言**："存储里的主题选择确实已清空"。
    ▸ ★ 两向 A/B（这次不靠推理）：同一个 profile、同一份残留 `light` ——
      **摘掉那两行 ⇒ 红在 `theme=light 按钮="水墨"`，16 通过 / 11 失败，与原那次全量回归一模一样**；
      **留着 ⇒ 27/27 全绿。清档那一步自己也被验过**（坑 76：机制写了不等于生效了）。
    ▸ 顺带一条决定"这类污染为什么隐蔽"的本机事实：**headless Edge 的 localStorage 跨启动存活**
      （profile 目录按 CDP 端口派生，`cdp.launch()` 只 mkdir 不删），而只有
      `check-ai-avatar` / `check-dock-fit` / `check-screenshare` 三条会在开跑前删自己的 profile，
      其余都假设"页面本来是干净的"。**凡会写持久化状态（存储、主题、SW 缓存、数据库）的检查**，
      要么开跑前清、要么结束时清**并且清在 finally 里**。
    ▎通用判据：**"默认"不是一个可以旁观的状态，是一个要先制造再断言的状态**——
      任何断言"出厂 / 默认 / 首屏 / 未登录"形状的检查，开头都要问三句：
      上一轮有没有可能已经把这里改掉了？我清了吗？我**验证**清了吗？

138. **★ 量具会自己造"原因"：先读证据再动手，别把清理动作的副作用当被测物的失败（2026-10-09，一天两次）**：
    今天写 `npm run bench:asr-golden`，第一次跑报 `SKIP：qwen-local worker 起不来：killed`。
    我差点据此去查"GPU 上的 worker 为什么崩了"。真相是**我自己在失败分支里先调了 `L.kill()` 再读 `lastError`**
    ——`kill()` 走 `failPending('killed')`，把真正的失败原因**冲掉了**。
    ▸ 顺序改成"先读 lastError 再 kill"之后，第二条真原因才露出来：
      `boot()` 返回 false 而 lastError 是 null——一个**没有原因的 false**。
    第二条原因同样是我的代码放错位置：`resolveModelDir()` 被我插进了 `makeSlot()` 的函数体内，
    而池级 `module.exports` 在函数外引用它 → `ReferenceError: resolveModelDir is not defined`。
    ▸ **`node --check` 全过**（语法没错，错的是作用域），而这条错长得像"引擎坏了"。
    ▎通用判据一：**清理/收尾动作（kill / reset / rm / clear）都可能改写它要报告的那个状态**——
      读证据的顺序必须在动手之前（与坑 84"观测手段不得改变被测对象"同族）。
    ▎通用判据二：**加辅助函数时先确认它要服务于哪一层**（槽内 / 池级 / 进程级）；
      放进工厂里的私有函数被外部导出引用，报错只会说"名字不存在"，不会说"你放错层了"。

139. **★ 外部 API 的能力要当场探一次；读响应要读对它把话放在哪个字段（2026-10-09）**：
    上一轮我告诉用户"DeepSeek 那条 provider 不支持图，所以装眼睛要另找端点"——
    那是**从记忆里抄的**（2025 年的事实）。这次拿他自己那把 key 探了三次：
    `GET /models` 返回 `deepseek-flash`/`deepseek-v4-pro`，`deepseek-chat` 是别名路由到 flash；
    带 `image_url` 的请求 **HTTP 200**，三张纯色图（红/蓝/绿）按序答对。
    ▸ **证明它"真看见"的不是那句话，是 token**：纯文字 `prompt_tokens=12` → 带三图 `572`。
      文字模型不会为图片付 token。这与坑 75（0.25s 裸基准骗人）、坑 65（"0 条"绿得可疑）同一条纪律：
      **要看那个真正决定结论的物理量**。
    ▸ 探的过程里还撞出一个静默陷阱：同一个请求打给 `deepseek-v4-pro` 时 `message.content` 是**空串**，
      全部文字在 `reasoning_content` 里。而 `sfu/ai/provider.js:144` 只读 `message.content`
      → 拿不到就 `fail('empty-completion')` → 降级 Mock。**界面上只多一个 `[Mock]` 标记**，
      看起来"AI 在回答"，实际一句真话都没问过模型（坑 67/82 的又一形状：**读错了字段不等于没数据**）。
    ▎通用判据一：**任何"某个外部能力支不支持"的判断，都必须有一次真请求作证**（探活是免费的，
      而错误的"不支持"结论会把人引去做多余的架构）。旧文档、旧注释、上一轮我自己说过的话，都算"旧结论"。
    ▎通用判据二：**接推理型模型时先打印一次原始响应体**，看清它把答案放在 `content` 还是
      `reasoning_content`；否则 `max_tokens` 给小一点就永远判"空回复"并静默降级。

140. **★ 重录路径删掉了刚写好的文件：同名覆盖时，"清旧数据"要问它删的是字节还是账（2026-10-09）**：
    `/golden` 录制页重录同一句的写法是「转码覆盖 `wav/<id>.wav` → `removeById(id)` 剔旧账 → 记新账」。
    `removeById` 按**旧记录**里的路径 `unlink` —— 而新旧路径同名，于是删掉的是**刚转好的那一份**。
    后果链：账本指向一条不存在的 wav → `list()` 的对账把它过滤掉（这条对账本身是对的）→
    页面显示"重录成功"却查无此条，零报错。
    ▸ **是回归把它抓红的**：那条断言写的是"同 id 重录后账本里有且只有一条"，实测拿到 0 条。
      修法不是放宽判据，是把动作拆开：`dropFromLedger(id)`（只动账）与 `removeById(id)`（动字节，
      留给真正的删除场景），覆盖路径只调前者。
    ▎通用判据：**"清理旧数据"的三步里（覆盖 → 清旧 → 记新），第二步删的必须只是账本引用**；
      只要新旧共用一个标识（文件名、key、房间号），按旧记录做物理删除就等于按新记录删。
      同坑 52（"同一份数据"必须真的是同一份）与坑 72（别让上一次残留决定这一次）家族。

141. **★ HTML 注释用 CSS 的收尾序列写完 = 整段页面被吞进注释；`node --check` 与冒烟一条都不红（2026-10-09 实修）**：
    给「忘记密码？」那颗按钮写注释时，最后一行我用星号+斜杠收尾（CSS/JS 块注释的写法），
    而 HTML 只认 `-->`——于是 `<!--` 一直不闭合，把后面的 `<button id="authForgotBtn">` 与
    `<div id="authMsg">` **一起吞进注释里**。全量 `check:all` 当场报出来的形状是：
    `check:login` 的"11 个 id 一个没丢"红在 `authMsg`，`check:layers` 五条命中测试全读到
    `{"zero":true,"w":0,"h":0}`，`check:keyboard` 量不到焦点环 —— 看起来像"界面全坏了"，
    实际只坏了一行注释的收尾。
    ▸ 为什么静态工具抓不到：`node --check` 不看 HTML；冒烟用的是**自己造的假 DOM**，
      它按 id 取元素时桩会自动造一个空元素补上（坑 27 那个"桩会替你无中生有"的旧问题），
      于是"元素不存在"这件事在假 DOM 里也不报错。
      **只有真浏览器 + 一条明确写着"这些 id 必须存在"的断言**能抓到这类"内容被吞"。
    ▸ 补了两条静态判据（都在 `test:smoke`，各用变异证过可红）：
      ① **id 契约的静态版**——先把注释全部剥掉，再要求 16 个关键 id 出现在**注释之外**
        （把那条注释的闭合换成星号斜杠，当场红且**点名 authForgotBtn, authMsg**，与真浏览器看到的一样）；
      ② **HTML 注释体内不许出现那个序列**——这是坑 26（CSS 注释里的 `*/` 吞掉全站变量）与
        坑 34（`sw.js` 里 `**/socket.io` 吞掉块注释）的 **HTML 版**：同一个错误换了第三个载体复发。
        实测全文件 105 条注释 0 处误伤，所以这条可以做成硬红线（判据落地前先量误伤面，
        会误伤的判据不会被人维护，只会被删掉——坑 110 那条纪律）。
    ▎通用判据：**注释的收尾序列只有一种写法**：块注释内部永远不出现那两个字，
      而"这段内容在不在页面上"要有一条不依赖真浏览器的静态判据兜住（真浏览器是终判，不是唯一判）。

142. **★ 模板字符串内部的反引号会把"注入浏览器的代码"截断；全仓静态红线试过、误伤 17 处、撤下（2026-10-09）**：
    我给 `check-theme.js` 的 `OPEN_OVERLAYS` 加注释时，用反引号包了两个类名——模板字符串当场被
    提前截断，源文件仍然语法正确（截断后拼出来的恰好是合法的成员表达式链），
    错的是那个字符串本身：跑进页面才炸 `ReferenceError: link is not defined`，
    而**这条检查一条断言都没执行**，总览里只留下"0 通过 / 0 失败 · 0.1s"这一行。
    ▸ 我先做的是一条**全仓静态红线**（小状态机扫"模板内部的块注释里有无未转义反引号"），
      扫 40+ 个 js 报 17 处，逐条看过去**全是误伤**：中文注释里用反引号包代码名是本仓库的常规写法，
      要精确区分"注释在模板内部"必须连**正则字面量**一起解析（一个含单引号的正则就把状态机带偏）。
      ▸ 于是撤下那条红线，换成**精确的那把尺**：`scripts/inject-check.js` 一处实现
        （`assertCompiles(file, {NAME: code})`，编译不过就打印是哪一段并 `exit(1)`），
        12 个"拼代码注入浏览器"的 check 脚本各接一行；冒烟里加一条结构红线
        要求"定义了注入模板的 check 脚本必须引用它"（漏接当场点名）。
        ▸ 这条红线的判据与接线脚本用**同一个正则**，否则会判出"缺自检"的假名单。
    ▸ **守卫自己也被两条单测钉住**：合法代码不许拦（会误伤的守卫会被下一个人删掉——坑 110 的原话），
      坏代码必须让子进程非 0 退出且把"多半是反引号截断"那句指路话说出来。
    ▎通用判据：**凡是"拼一段代码给别的运行时执行"，交付前要让同一个引擎先读一遍它**（2026-10-08 已经这么
      做过一次，这次是我自己忘了）；而**一条判据的误伤面必须先量出来再决定它配不配当硬红线**——
      判据写得比被测物复杂时，"精确的小尺"胜过"响亮的大尺"。

143. **★ 判据也会过期：两条"目录没被创建"在用户录完音之后变成永真 / 永假（2026-10-09）**：
    `check:golden` 的 ⑨ 写的是"真实 `sfu/voice-golden/` **没被这次检查创建**"——
    它 10-09 之前一直绿（那时目录确实不存在），而用户录完 20 句真人语音之后，
    这句话**结构上不可能再成立**：它红，而红的内容什么都没指向（检查根本没写那里）。
    更隐蔽的是同仓库的另一处（`test-sfu-signaling`）：
    `ok('隔离自证…', gDirExistedBefore ? true : !fs.existsSync(gDirReal))` ——
    为了让新情况不报红加了个三元，结果**目录一旦存在这条就永远绿**，它一条都不证了（坑 115 的形状：
    断言正确地保护了一个错误的期望）。
    ▸ 真问题一直只有一个：**"我这批测试 id 有没有混进用户的真实语料"**（混进去会污染 CER 表），
      不是"目录在不在"。判据改成按我这批 id 查（账本里不许有、`wav/<id>.wav` 不许存在），
      既诚实又不会与"有人此刻正在手动录音"打架；
      `check:golden` 那侧用**跑前/跑后的逐文件 路径|字节|mtime 快照**（它录的句子 id 与用户重叠，
      按 id 查会假红，所以量的是"我一个字节都没动"）。
    ▎通用判据：**写"某物不存在"型判据之前先问"它在什么前提下不存在"**——
      世界会变（用户录了音、生成了文件、装好了工具），一条依赖"还没有发生过"的断言
      会在它失效那天同时制造假红与假绿；判据要钉住**真正要保护的那个不变量**，
      而不是它当时看起来的样子。

144. **★ 一条纪律修在测试里、留在生产里：`watch.js` 的未锚定正则让"预热期分诊"从来没能生效（2026-10-10，坑 74 的生产版）**：
    坑 74（2026-10-03）立的判据是"对 Prometheus 文本做内容断言要**锚行首**，因为 `# HELP` 行里也含 gauge 名"，
    当年修的是**测试脚本**里的那份正则。而真正在生产的取值代码 `scripts/watch.js` 里，
    `flagOf/counterOf/gaugeOf` 四个助手**全都**写成 `new RegExp(key + ' (\\d+)')`——未锚定。
    ▸ 现场后果不是"报错"，是**告警永远不响**：`# HELP sfu_ai_asr_primary_ready 1 when the configured primary ASR engine is ready`
      这一行里就含 `sfu_ai_asr_primary_ready 1`，于是 `flagOf('sfu_ai_asr_primary_ready')` **恒为 1**；
      而"预热期分诊"的整条逻辑是拿这个 1 去区分"主引擎还没起来（正确行为，多等几轮）"
      与"起来了却不用（真退化，两轮就报）"——恒 1 意味着它**永远判成后者**，
      于是那条本是为了防误报而加的判据，从上线那天就在**制造开机误报**，
      而 5 分钟限流把误报压成了"偶尔响一次"，看起来像正常告警节奏，谁都没去查它。
    ▸ 更难受的是**为什么三个月没人发现**：`test:watch` 的合成 metrics 文本是**我自己写的**，
      里面**一行 HELP 都没有**——被测文本比真实文本干净，判据自然测不出这个错。
      这轮把 fixture 加上 HELP/TYPE 行，当场 4 条红（含两条老断言）。
    ▸ 修法：一个 `valRe(key)` 统一生成"行首 + 可选 `{labels}` + 值到行尾"的锚定正则，
      四个助手共用（**一个概念一个来源**，不再有四份各写各的机会）；
      并加一条冒烟结构红线"取值正则必须都走 `valRe`"（把 `valRe` 换回裸正则，那条当场红）。
    ▎通用判据一：**立了一条"某某要锚定/要转义/要判空"的纪律之后，grep 所有副本，不要只 grep 测试**——
      同一件事在生产代码与测试代码里各有一份实现，只修一份 = 半迁移 = 等于没修（坑 57 原话的第三次应验）。
    ▎通用判据二：**量具的合成输入必须长得像真实输入**；用"比我方产品更干净的手写 fixture"
      去验解析器，得到的是解析器的绿灯 + 生产里的红灯（与坑 130 同源：自己写的夹具测的是记忆，不是能力）。

145. **★ 排查跨进程故障时，失败信息里要带"我这边实际发出去的是什么"——一条占位符骗了我四轮回归（2026-10-10）**：
    新写的 `/api/rooms` 快照助手一直 401，套件四轮 abort。四轮里我依次怀疑并"排除"了：
      ① 票被清扫器删了（我甚至给服务器加了临时 `DEBUG_TOKEN_DEL` 打调用栈——**没有一次删除发生过**）；
      ② `AUTH_TTL_MS` 被哪份配置调短了（读了 spawn env / `.env` / config.json，都干净）；
      ③ `http.get(options)` 这种"写法差异"（写了独立复现脚本，同样写法 200）；
      ④ 端口上有旧实例（`[server]` 前缀的日志证明是我自己起的那台）。
    真相：我写的那行是 `Authorization: '***' + adminToken`——一个从记事过程里带出来的**占位串**，
    头值变成 `***090293…`，`extractAuthToken` 的 `Bearer` 正则不匹配，于是回落成"没有 token"。
    ▸ 让这件事一步就断的，是我最后给失败信息加的两个字段：**"我发的 token 前缀"** 与
      **"401 页里那句为什么（缺少或无效 / 角色不对）"**。加完之后第一次跑就看见
      "前缀 = 090293 对得上，而服务器说缺少或无效" ⇒ 唯一可能是**头没发出去**。
      前缀这个信息在最初的版本里是"长度 48"——长度对得上什么都证明不了（占位符也留着 48 个字符）。
    ▸ 顺带两条：① 那四轮里我做的临时调试改动（`DEBUG_TOKEN_DEL` 钩子）**用完立刻删了**，
        并把删除前后的 `node --check` + 复跑都留在日志里——诊断钩子留在生产代码里就是下一个故障点；
      ② 401 页面本身分两种原因（"票不在册" vs "在册但角色不对"），而我的第一版把它压成
        "响应开头 60 字符 = `<!DOCTYPE html>`"——**错误信息里最该带的是那个能分岔的字段**。
    ▎通用判据：**写跨进程/跨机器的失败信息时，把"我方发出的字节/键/枚举值"打进去**，
      而不是只打"对方的状态码"。只有状态码的报错，会把人引向"对方为什么这样"，
      而真相常是"我发出去的东西根本不是我以为的那个"（与坑 80/117 同族：**假故障的第一个嫌疑人是量具/我方自己**）。

146. **★ 度量名字会替你做判断：一次把"房间本来不安静"读成"尺子坏了"（2026-10-10，B2）**：
    给底噪估计（H8b）做真人量具时，第一版把一栏命名成**"尾静音误判"**——它量的是
    "人停下之后，末尾那些窗有多少仍被自适应判据算作有声"。这个名字预设了结论（误判 = 判据坏）。
    于是当它读出很高的比例时，我的第一反应是"排除 −99 纯静音那条规则把 floor 顶高了，得改阈值"，
    并准备据此动 `margin`。
    ▸ 同一次跑里另一个数把它推翻了：那批真人录音的**末尾窗 RMS 中位是 −36.8 dBFS**，
      而当时的自适应阈值是 −54.6 ⇒ 那个房间**根本不存在"安静的尾巴"**（风扇/键盘/空调一直在响），
      "被算作有声"是对真实声场的**正确**读数，不是误判。名字一改成「尾窗判有声」并把尾窗 RMS 同排出来，
      结论当场换了方向。
    ▸ 这条为什么值得记：**测量与判据混在同一个名字里，读数的方向就替你把结论说了**——
      而它不会报错，只会让你去修一个没坏的东西（本项目的 H8b 因此从"改阈值"改成"装常驻仪表"）。
      顺带把这条改口的**负结果**也留下：真人 20 份里"有多少窗被判有声"这个数
      **不随 `silentDb` 的排除范围改变**（−80/−120/−70 三档 floor、阈值、命中一字不差）
      ⇒ 原以为要修的那条排除规则在这批数据上量不到影响，所以**一行生产阈值都没动**。
    ▎通用判据：**度量名字里不许含结论**（误判/失败/异常/坏 = 都是结论）；
      写"X 率"就只说 X，把"判据认为…"与"事实是…"两栏并排打出来，让人自己看见它们是不是同一件事。
      （同坑 91 的另一半：尺子的读数要连着"房间的条件"一起读。）

147. **★ "两个运行时逐字一致"不等于"渲染对了"；以及仪表给的原因也要有判据（2026-10-10，B3+B5）**：
    两件事同一个形状：**一个看起来像证据的数，其实回答的是另一个问题**。
    ▸ **(a) 两轨一致那条绿着，产品却交白卷**。`test:fileview` 的"浏览器轨与 zlib 轨逐字符一致"
      一直是这条新形状（表里套表）最强的断言——直到我做变异实验：把单元格的渲染改成"只取第一个段落"，
      两轨**照样逐字一致**（两边一致地丢了内层那两张表），红的只是"最里层那三个字在不在页面上"
      这类**内容级**断言。⇒ 一致性判据防的是"两个运行时行为不同"，**它不防"两边一起错"**；
      每条"两轨一致"旁边必须配一条"这一轨真的产出了那个内容"（坑 118 当年立的正是这条，这次是我自己
      把它重新踩了一遍才看见）。
    ▸ **(b) 仪表给的原因比它报的数字更贵**。`review:office` 的"文字极少"那栏原来对所有
      命中者都写一句"可能是内核漏了某类容器"，而真实 273 份的回扫里 11 份命中、**10 份是截图作业**
      （文件 1~2MB 全是图片，`w:t` 里本来就没字）。这条错原因差点让我去实现
      "把 DrawingML/SmartArt 的文字也抓出来"——于是我先做了一次普查：
      同一份文件里 `w:t` 的字数 vs `a:t` 的字数，本机 77 份候选里"字全住在 DrawingML"的 **0 份**。
      ⇒ 判据从"`imgs >= 3`"改成"有图就先按图片作业解释，**一张图都没有**才算可疑"，
      并把这条负结果写在判据注释里（下次谁想再放宽/收紧，先撞上这个数字）。
      同时把"文件本身坏了（不是合法 ZIP）"从"内核抛错"里拆出来——混在一起的后果是
      汇总那句"273 份 · 抛错 1"读起来像内核有 1 个 bug，而实际是用户那份文件被截断了。
    ▸ 顺带一条同一个坑的小版本：同一个错误**在两处各 `bad++` 一次**（catch 里 + 报告里 +），
      汇总那行看着完全正常，只是数字翻倍——**计数器的增加点与分类判据必须在同一处**，
      否则分类永远落后于计数（坑 47 的报表版）。
    ▎通用判据：**写完一个"看起来能下结论"的数，先问它能不能被一个"两边一起坏"的场景制造出来**；
      能，就补一条内容级/单侧级的判据；不能，就把它降级成观察值（坑 122 那条纪律的另一种形态）。
      而**任何替人指出排查方向的文案，都要有它自己的断言**（正例 + 反例各一条），
      否则它就只是把人稳定地支去同一个错方向，还带着权威口气（坑 105/134 同族）。

148. **★★ 判据不许落在"会自己长"的量上；以及两次被实测否掉的直觉（2026-10-10 第二批，C2）**：
    要买回的是定稿延迟里那 ~1.4s（实测：静音判据只要 1.2s，实际定稿在 2.6~2.7s，差值全花在
    **等含尾字的那一段被 ffmpeg 封口**）。放松这道闸门的第一版判据我写成
    `抢跑读到的字节 >= 文件当前大小`（"这段全被模型听过了才放行"）——**它一次都不会成立**：
    分段文件在换段之前一直在长（16k 单声道 s16le = 32000 字节/秒），**静音也在写**，
    而抢跑的转写要 0.4~2s，回来时文件已经多了一截。机制"写了"，生产里"从来没跑过"，
    报告上看起来与"跑了但没效果"一模一样（坑 76 的第四种形态：**判据要求了一个物理上到不了的状态**）。
    ▸ 正确的问法是"**这段话说过之后，还有没有没被听过的字节？**"——把段内字节号换算成时刻
      （`第 N 字节 ≈ birthtime + N/32000 秒`），要求覆盖到 `lastVoiceTs + RMS 滞后` 为止即可，
      之后的字节**按定义是静音**。换算只写在 `Asr.tailCoveredByRush` 一个纯函数里（正反例各钉死）。
    ▸ **被否掉的第二次**：我加过一条"那次抢跑必须**真的转出了字**"（听起来当然更安全）。
      实测三轮：段边界那 1~2s 的切片交回来的全是 `text=""`，**封口段自己也一样是 `""`**——
      句尾那个「会」字从来不是那一段转出来的，是"整句音频一次重转"救回来的。
      于是这条要求把放行变成不可能，而它保护的东西本来就不由它保护。
      ▸ 拆开的写法：**音频覆盖到位**（纯函数）× **这一句真的会做整句重转**（重转开着 / 攒到的段数够 /
        worker 不忙）× **这句不只叫了个名字**（10-07 那次"省 0.5 秒买回插话"的正面对冲）——
        三个条件各管一段、各有自己的反向断言；**揉成一个"看起来更安全"的大判据，就是让它永不生效**。
    ▸ **被否掉的第三次**（顺手记，因为它差点变成"实测结论"）：我以为模型不出字是因为切片缺了
      **段尾收尾点**，写了台量具拿真人金标准 wav 切四刀验证（`full` / 切 0.08s / 切 0.08s+补 0.25s
      假静音 / 切 0.4s / 切 0.4s+补静音）——**五种切片的转写一字不差**。假设是假的，
      据此写的"整段重读"那版代码全部撤回（它只会多空跑一次推理）。
      ▸ 通用判据：**"我觉得它是因为 X"必须有一个能把它打红的实验**；量完即删脚本，但把否证写进
        断言注释（`test:asr` ⑮.4/⑮.20），否则下一个人会再把同一个直觉实现一遍。
    ▸ 默认值最后由 A/B 决定，不由感觉决定（同场次、干净机器、主引擎就位）：
      关 `3.3s / 3.1s` → 开 `3.3s / **2.0s**`，而**定稿条数(2) / 应答次数(1) / 逐字全对含尾字「会」**
      三条红线一个没变差才翻默认开，并留 `ASR_TAIL_RUSH=0` 单独撤这一个变量。
      第一句两轮都还是 3.3s —— 它被 `segInFlight===0` 那道**别的**守卫挡着，
      不许记成"本次没效果"，也不许顺手去改那道守卫（并发守卫是"重复接话"的防线）。

149. **★ 一个容器有了第二个写入方，"push 顺序 = 时间顺序"就悄悄失效（2026-10-10 第二批，C2）**：
    `uttAudio`（整句重转的音频账本）原先只有一个写入方（封口段按顺序 push），
    所以拼接直接 `Buffer.concat(chunks)` 是安全的。这次让抢跑的前缀切片**也**进这个账本
    （不这样，闸门就永远等不到"音频齐了"那一刻），于是出现第二个写入方：
    seg-0008 的 delta 会比 seg-0007 的封口余量**早到 ~150ms**（后者要过 `pickReadySegment` 的写稳采样），
    push 顺序变成 0008→0007 ⇒ 拼出来的整句音频是"后半句在前半句前"，
    **而模型照样会自信地转出文字**——不报错、不空、只是字幕读起来像喝醉了（坑 58 的音频版）。
    ▸ 修法两条：① 每个切片带**段名** `k`，拼接前按段名排序（段名 `seg-%04d.pcm` 补零 ⇒ 字典序=时间序；
      同段多次抢跑靠**稳定排序**保持先后）；② 另一个账本 `uttTake` 记"这段已经交进去多少字节"，
      封口段只补余量——否则同一段出现两遍（09-30f/10-05 那条"tail 是前缀切片别重复计入"的老账，
      这次是真的会重复，因为我们主动留了它）。
    ▸ 顺带一条**差点写进去的永真断言**（异步版坑 110）：`ok('…', await (async () => 判据)())`
      看着没问题，但**Promise 是 truthy**——判据再假也绿。凡"要先取异步数据再判"，
      一律 `const x = await …` 落在断言**之前**，再把布尔交给 `ok()`。
    ▎通用判据：**给一个已有容器增加写入方之前，先列出它原先隐含的顺序/去重/额度假设**，
      每丧失一条隐式保证，就要有一条显式判据顶上（排序、水位、按段去重的段数各一条断言）。

150. **★★ 载荷对、渲染空：服务端断言测不到客户端显示什么（2026-10-10 C3，真浏览器文本断言抓出来的老缺陷）**：
    `@ai 把白板打开` 这类**规则直答、不经 LLM**的路由（10-06 起的房间动作、越界拒绝，本次新增的回指撤销）
    从上线起在聊天里是一条**空气泡**——只有名字、模式徽标和「🎯 room-action」，正文一个字都没有。
    ▸ 机制：`ai-ask` 先发 `ai-stream{start:true}`，规则路由一个增量都不发，随后 `done` 帧到达；
      客户端 09-24 为"两条同名气泡"立的去重是`if (streamId && aiStreamDone.has(streamId)) return;`
      ——终态那条 `chat-message`（**载荷里字是齐的**）被当成重复丢掉了。
    ▸ 为什么这么久没人发现（三条各自都"看起来在验这件事"）：文字同时走 `ai-state.speaking` 的全文，
      AI 格子的逐字字幕是有的，所以"它在说话"的观感成立；`test:sfu` 断的是 `chat-message.text` 有字（服务端载荷，对的）；
      `test:room-actions` 21 项断的是界面状态动没动（也是对的）。**没有一个断"用户看得见的那条气泡里有字"**。
    ▸ 修法选择很关键：在**服务端补一次增量**（`streamFillText`，@ai 与语音两条路都补），
      **不放开客户端去重**——放开去重会让流式答案重新出现两条气泡，那是 10-04 修过的老账（同坑 57：
      改共享判据要顺着它当初要防的那件事想一遍，不能只顺着眼前这个红点）。
      两侧各一条断言：正向"两条路都补"（数量断言数**调用点**，定义那一行同前缀会多数一个）+
      反向"去重那行必须还在"（谁为了修下一个红点放开它，当场红）。
    ▸ 顺带一条同族小坑：意图徽标缺文案时会直接印内部 id（「🎯 room-undo」）。
      补了文案表，并加"服务器每个 `intent:` 枚举在客户端都得有文案"的结构红线——
      但**兜底仍保留 `|| ai.intent`**：将来加新意图忘了配，宁可露原词也不要露空（露空更像"它没听懂"，更误导）。
    ▎通用判据：**"载荷正确"不等于"用户看得见"**。凡是端到端功能，至少留一条断言读**用户那一侧的呈现**
      （聊天区文本、页面 innerText、截图像素），否则"服务端全绿 + 界面是空的"这一类缺陷可以活很久（本例活了 4 天）。

151. **★ 回指不是动词，是状态；而"撤销"必须按物理可能性拆成三类（2026-10-10 C3）**：
    规则表能接住"动词 + 宾语"，接不住「刚才那个再关回去」——宾语不在句子里，在**刚才发生过什么**里。
    所以这一档的第一件事不是加正则，是**引入状态**：`room.actionStack`（房间级、上限 8、随房间销毁）。
    ▸ 三条判据的形状，缺一条就会做错方向：
      ① **取反 vs 重复是两个相反动作**（「撤销那步」vs「再来一遍」），而它们共享同一个回指前缀；
        分层的顺序是语义的一部分：强撤销词 > 重复词 > 光杆关闭词。
        把"重新打开"当成"打开→于是关掉"，就是**做错方向**——10-06 那条「别切宫格，把白板打开」的第三种复发形态。
      ② **一族只认最近一条**（我第一版只按"逆动作相同"去重）：栈里"开字幕→关字幕"这两步
        会被解成同时广播 `[关, 开]`。物理上讲不通：一个界面在同一时刻只能是开或关，不存在"撤两步撤出两个方向"。
      ③ **不可逆就整条不做并说理由**：`board-clear` / `board-undo` 没有"之前"可回去。
        做一半（能撤的撤了、该说的没说）比全不做更难解释；而"拒做"也要有触发计数，
        否则用户报"说了没反应"时，报告里只有一条"下达 0 次"，分不出是没听懂、听懂了但拒做、还是做了没生效。
    ▸ 泛化仍然按坑 106 的量法做：**先写 20 句从未进过任何表的说法，让它红**（首跑 14/20），
      再逐种形状补判据；"刚才那个算我没说"这种**一个动词都没有**的惯用语，是只有换一批句子才会露出来的形状。
    ▸ 边界要写进回话，不能只写进注释：动作栈只记"通过我下达的动作"，
      人手动点按钮改变的界面状态服务器**看不见**——所以栈空时的答话明说这件事（坑 82：不装作听得懂一切）。
    ▎通用判据：**遇到"这个/那一步/刚才那个"这类指代，先问"我需要记住什么才能解它"**——
      需要记住的就是状态，状态要有宿主（挂在 room 上、随宿主销毁）、要有边界（上限几条）、
      要有一张"能不能反过来"的表（可逆配逆操作，不可逆给出人话理由）。

152. **★★「有没有内容」不许用绝对字数判；而同一个判据的两份副本会各自漂（2026-10-10 C5，一条红查出来两件事）**：
    `check:files` 的 REAL_OFFICE_DIR 那一处写的是 `chars > 40`（"非空白字数超过 40 就算渲染出来了"）。
    今天第一次把 `pptx-notes` 这一类推下去，它**红了 90 秒**：轮询始终读不到"有内容"，
    看起来完全像"浏览器里 pptx 渲染挂了"——而取证那一刻 `innerHTML` 有 1355 字节、两页幻灯片在界面上。
    ▸ 真相：**那份夹具的非空白字数是 39**，正好压在阈值下面。
      两页的 PPT、一行字的表格、一页满图的扫描件都会撞线，而它们都不是白屏。
      **绝对字数是一条尺度相关的判据**（坑 53 的同一条：判"够不够格"的量必须尺度无关），
      而且它把"渲染完成"这件**结构状态**问题偷换成了**内容量**问题——内容是别人的文件的属性，不是界面的状态。
    ▸ 修法不是把 40 调小（那还是猜一个数，下一份更短的文件又红），是**问界面自己**：
      `.fv-doc / .fv-slide / table / img / iframe.files-pdf` 且不在转圈 = 有内容；
      `.fv-unsupported` = 明确说不行。字数继续打印，但只当观察值。
    ▸ 顺带掉出第二条，而且它比第一条更阴：**同一判据的另一份副本（REAL_OFFICE_FILE 那一处）少写了一个反斜杠**。
      那段是要塞进模板字符串再交给浏览器执行的，`/\s+/` 掉成一个反斜杠就变成 `/s+/g`——
      **剥掉的是字母 s 而不是空白**，于是那份的字数一直虚高、结构上不可能报白屏。
      两份副本一份太严（假红）、一份太松（假绿），而两边各自都"跑过、绿过"——
      这就是坑 47 在这个仓库里第 N 次的形状：**同一个概念写两遍，两遍会朝相反的方向坏**。
    ▸ 收口做法：判据表达式提成一处 `STAGE_FN`（页面里那段函数文本），轮询条件与红场取证都拼它；
      并且把"数非空白字符"改成 `for (const ch of t) if (ch.trim()) n++`——**不带反斜杠的写法**，
      从根上取消"模板串里要不要双写"这个问题（这类问题不是靠更细心能防住的）。
    ▎通用判据一：**判"某件事完成了"要问执行者的状态，不要问产物的体积**（字数/字节数/行数都是内容属性，不是状态）。
    ▎通用判据二：**发现自己在两处写了同一个阈值/式子，就把"两份不一样的结果"当成证据**——
      它们不可能同时是对的；本次实测两份一份假红一份假绿，各自都曾经绿过。

153. **★ 样本数量给的是安全感，不是覆盖面（2026-10-10 C5：回扫从"取前 N 份"改成"每类各一份"）**：
    `npm run review:office` 上一版报"273 份里 0 抛错"，听起来很强；但它取的是**目录里前 25 份**，
    而本机 docx 占九成 ⇒ 旧版 `.ppt`、xlsx 的百分比/货币、pptx 备注页、坏 ZIP
    这些**曾经真错过**的形状可能一份都没进过样本——报告读起来同样是"0 抛错"。
    ▸ 现在的形状（`scripts/office-shapes.js` 是唯一来源，`review:office` 与 `check:files` 共用）：
      ① 九类**形状**（不是九种扩展名）：piece table / BIFF8 / PPT record 树 / RTF 冒充 .doc /
        网页冒充 .doc / docx 表里套表 / xlsx 百分比·货币 / pptx 备注页 / 坏 ZIP——
        每一条都对应 10-09 那轮真实掉出来的缺陷，不是凑数；
      ② 分类只看**字节**（magic + ZIP 成员名 + styles.xml 的格式码），不读正文，隐私那条没变；
      ③ 某一类本机没有真文件 ⇒ 用仓库夹具顶一份，**报告里写明"这是夹具，不证明用户那份没问题"**，
        并标出夹具是谁写的（"我写的"与"真 Office 生成的"是两种强度的证据，坑 130）；
      ④ 连夹具都拿不出来 ⇒ `❔ SKIP`，并且**退出码 1**——"没量到"永远不许读成"通过"（坑 105）。
    ▸ 两条必须分开的上限：**候选上限（多看几眼才找得齐形状）≠ 渲染上限（贵）**。
      上一版拿 `--max` 同时当两者，于是"看了 8 份、没认出 .xls"会被读成"这台机器上没有 .xls"——分母错了。
      另有一条反向保护：**类别样本不被 `--max` 挤掉**（P3 那条断言），否则上限一调小，
      覆盖面被一个数量参数偷偷改动，而报告仍写着"覆盖 9/9"。
    ▸ 还有两个"没读"也要说出来：跳过的大文件份数（`--probe-mb`，openZip 要看到尾巴才能判中央目录在不在，
      只读头部会把好文件误判成坏 ZIP）、以及 `stoppedEarly`（九类凑齐就停，剩下的没看）。
    ▎通用判据：**任何"N 份样本 0 问题"的结论，先问这 N 份是按什么挑的**——
      按顺序/按数量挑出来的样本，覆盖面等于目录的分布，不等于你想知的范围；
      判据应当是"**每一类形状至少一份**"，缺的那类要显式落成 SKIP，而不是让总数替它说话。



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
5.17 ✅ **2026-09-30b 远程控制取长补短（借鉴 billd-desk，仅 SFU 主版本）**——
   **设备码配对直连**（`desk-register`/`desk-connect` → 设备码 = 私有 `isDesk` 房号，
   全套授权门禁与帧闸门**零改动复用**；安全口令=无人值守直授权 / 连接口令=终端按 y，
   两条路径同发 `desk-granted`）+ **真桌面画质档**（`.rd-bar` 自动/流畅/标准/高清，
   走 `remote-input` 的 `{kind:'quality'}` 老通道新语义）+ **三层帧率分工**
   （档位定中枢 / 闭环自适应 ±2 微调 / 代理与服务器硬钳 2~24）。
   第 2 节功能表 **32** 行、协议新增 09-30 段、坑 **61~63**；导读 **LEARN.md 5.39**；
   路线图 `后续升级方向.md` **B 档 09-30 补刀**。
   **回归（本次实测）**：信令 **184/184** + 冒烟 **189/189** + `test:agent` **24/24**（真 Chromium）
   + `test:e2e` **15/15** + `test:store` **55/55** + `test:shutdown` **9/9**（6 组 476 项）；
   ⚠️ **待人工验证**：设备码直连真机手感、无人值守与需确认两路径、
   画质档观感差、弱网自动降档（另记诚实边界：设备码仅内存、口令明文比较、只控 Chromium 窗口内）。
   ▎**另记（工作区里还躺着另一批未提交改动，不属本轮任务）**：`sfu/password.js` 口令 **V2 + 平滑重哈希**
   （scrypt N 32768/r8/64B；V1 只用于校验存量；按 hex 长度判代、不加前缀）、`sfu/store.js` **惰性开库可重开**
   （`closeDb()` 后再调用不再抛 "statement has been finalized"）、`scripts/legacy-user-fixture.js` 测试基建。
   存储层因此 49 → **55**。**提交与教学导读回填要和"设备码 + 画质档"分开**，别混成一个 commit。
5.18 ✅ **2026-10-05 夜跑（七问闭环）+ e2e-asr 停摆诊断结案 + check:avatar 量具假红根治 + 全量回归补齐**——
   七问逐条见顶部「★ 2026-10-05 夜跑」块；证据链速查：soak **6/6** · 0 永久放弃 · 定稿
   **1.2~1.8s** · Edge TTS **19152B/1391ms** · doctor **23 通过/0 失败** · check:avatar **22/22** ·
   check:glow **21/21** · check:screenshare **10/0** · test:asr **56/56**；诊断方法论入坑 **84~87**。
   **收尾回归（2026-10-05 上午实测，顺序跑，全绿）**：`check:all` **15/15 条 · 204 项界面断言** ·
   `test:smoke` **388/388** · `test:sfu` **219/219** · `test:asr-live` **PASS（定稿 1.6s + 自愈重启实测）** ·
   Mesh `npm test` **36/36** · `test:agent` **24/24**；
   `test:e2e-asr` **run-22 = 21 项 / 0 项失败**（真浏览器全链路：定稿 ✅、⏱ 读数 ✅、
   正解命中 ["小明","评审","纪要"] ✅、**喇叭开过口 10 次** ✅、B 侧看到应答 ✅、白板双端同步 +
   笔迹 2594↔2593 ✅）——过程中查到并修掉**三个产品级缺陷**：
   `cdp.navigate()` 把"导航已发起"当"导航已完成"（坑 **88**）、
   ASR 单次推理失控 + 120s 预算独占串行 worker（坑 **89**）、
   "多久有人说话"与"这句话多久没变长"共用一个时钟把成句闸永久饿死（坑 **90**）；
   另修掉两条会误导人的断言（⑨ 的假绿、播报计数的假红）。
   **改动后耐久复跑**：`npm run soak -- --minutes 7`（专用 3023 + `ASR_QWEN_LOCAL=0` 错峰）
   **PASS**——7 分钟 · 信令 209 条 · **断线重连 0 次** · 归档 POST 42 条 = 回读 42 条对账一致 ·
   健康检查 14 次 **0 错误** · rss 22MB。
   **下次接着做**（★ 2026-10-06 上午全场回归之后刷新）：
   ① ~~坑 90 末段的**读数诚实性待办**~~ **已收尾**（`fin` 下发 + 非 silence 归零，见坑 93 同轮）；
   ② **最要紧的一条不在代码里**：用户那台 3001 **至今没重启**——10-05 / 10-06 两轮全部改动
     （astats 参数、噪声底自适应、看门狗、tsUrl 按钮、表情、错峰、CountUp）都还没进他的会议。
     要他重启 + `?nosw=1` 开一次，再真人开麦走一遍"说几分钟 → 字幕连续出 → 喊小明它接话"；
   ③ 本地 Qwen TTS 的**去留**：代码与 2.4GB 权重都在，但默认**不再加载**（实测全天播报 0 次用到它，
     省 1.5GB 显存）；用户点头才删；
   ④ 改动全部**未提交**（按纪律不主动 commit），工作区另有并行会话的测试套件增长；
   ⑤ `test:sfu` 那条"动作型意图的答案"今晨红过一次、复跑绿（9s 窗口等真 LLM）——
     **本轮（10-06 上午）复跑 221/221 未再红**，诊断参数（`ok()` 第三参打印抓到的消息）已就位；
   ⑥ **e2e-asr 的 B 侧偶发**：一次跑里 B 没进房 → 连拖四条下游断言（B 字幕/应答气泡/白板/笔迹）。
     同场 A 有 6.4s 长任务且成员 id 变过（说明 A 重连过）；`test:e2e-media` 同时刻 38/38 ⇒
     不是进房链路的产品缺陷。已补**双侧现场打印**，下次再红能一眼看是"谁那端没通"（坑 87 同族）；
   ⑦ 真装 Tailscale 后的跨网入会 + 共享格在真机宽屏下的观感，仍需人来验一次（命令行验不了）。

5.19 ✅ **2026-10-06 凌晨五连（TTS 兜底有界化 / 计数去恒真 / 共享格 2×2 / nets.js 跨网 / 光标聚光）**——
   逐条见顶部「★ 2026-10-06」块；新记坑 **94/95/96**；新增 `sfu/nets.js` + `npm run test:nets`（17 项）
   + `TTS_FAKE_FAIL` 测试接缝 + `announcedIp:"auto"` 配置值 + style.css 第 37 节（画面格聚光描边）；
   **回归全绿**：check:all 15/15·216 项 · 冒烟 405 · 信令 219 · asr 107 · nets 17 · watch 36 ·
   tts 13 · store 55 · shutdown 9 · Mesh 36 · e2e-media 38 · asr-live PASS（两条路）· doctor 22/2/0。
   ⚠️ 待人工：真人开麦整晚体感、跨网第二台设备（配置已改成 `"auto"`，需重启才生效）。

5.20 ✅ **2026-10-06 傍晚到夜里（版本自检 / 邀请面板 / 真账本复盘 / 两个动效 / 共享黑边换模糊衬底）**——
   逐条见顶部「★ 2026-10-06 傍晚到夜里」块；新记坑 **103 / 104 / 105**；
   新增 `npm run review:meeting`（+ `test:review` 自检 19 条）、`client.js` **第 47 步**（邀请面板）与
   **第 48 步**（`ensureScreenBackdrop` 模糊衬底）、`style.css` **第 38 节**（面板）与**第 39 节**
   （ShinyText + BorderGlow + `@property`）、服务器端 `injectAssetVersions`/`assetVersions` 版本指纹；
   **回归全绿**：冒烟 **443** · 信令 **223** · asr **122** · review **19** · nets **20** · watch 36 ·
   store 55 · shutdown 9 · tts 13 · ai 10 · ai-brain 74 · qwen 10+1skip · publish 30 · record PASS ·
   Mesh 36 · agent 24 · **check:all 15/15 · 245 项** · e2e-media 38 · **e2e-asr 23** · room-actions 11 ·
   e2e-reconnect 15 · quiet-mic 11 · asr-live PASS（1.7s）· doctor 23/1warn/0。
   ⚠️ **本轮新成的"看真实可用性"入口就是 `npm run review:meeting`**——以后判断"到底能不能用"，
   先跑它，别再拿受控自测的数字当结论（坑 105 的由来就是这两者相反过两次）。
   **下次接着做（10-06 夜刷新）**：① 用户重启 3001 + `?nosw=1` 开一次（版本自检横幅会自己说谁还是旧的）；
   ② `test:voice-longrun` 在本机内存吃紧时启动不了（2.2GB free，另有第二个会话的服务器在 3033）——
   机器空出来时补跑一次，它值 6 分钟的连续性与输入侧健康证据；
   ③ 本地 Qwen TTS 去留仍等用户点头；④ 改动全部未提交（按纪律不主动 commit）。

5.21 ✅ **2026-10-06 深夜（泛化电池 / 做错方向的否定守卫 / 越界归类 / 真实账本回扫 / 长跑结案）**——
   逐条见顶部「★ 2026-10-06 深夜」块；新记坑 **106 / 107**；
   改的是 `sfu/ai/roomActions.js`（动词表 + 否定窗口 + `(?<!记)`）与 `scripts/review-meeting.js`
   （新增「指令回扫」行 +「谁在说话」行，自检 19 → **29** 条），测试侧 `test:asr` +6、`test:room-actions` +6（11→17）；
   **回归（本次实测，顺序跑）**：`test:asr` **130/0**（+1skip）· `test:ai-brain` **75/75**（同一方法论用到意图分类，22 句泛化电池）· `test:room-actions` **17/17** ·
   `test:review` **29/29** · `test:smoke` **444/444** · `test:sfu` **223/223** ·
   **`check:all` 15/15 · 245 项**（重跑确认，check:toggle 改版后 11/11）·
   **`test:voice-longrun` 7/7**（5 分钟 · 定稿 31 条全 silence · 中位 1.8s · 停摆 14s · 0 崩溃）。
   ▸ fixture 合并成一份之后**又复跑了一次长跑**：仍 7/7，数字如实分开记——第二次定稿 28 条
     （26 silence + 2 max-age）、中位 2.1s、最大停摆 26s（红线 60s）。同一台工具两次跑出不同分布
     是机器状态差异；文档只写「最好那次」就是自欺（坑 80 的记账版）。
     ▸ 顺带把一个**会误导人的名字**改掉：长跑里那个数原本叫「最大停摆」，量的其实是
       **字幕与字幕的间隔**——而 fixture 的 8 秒静音尾段被能量闸正常拦下时，间隔自然会拉长。
       实测分叉过一次：本工具报 26s「停摆」，同一场的复盘报「未见停摆」（权威判据是
       「段在到达却没出字」）。87 段里 85 段是纯静音 ⇒ **不是链路停了，是没人说话**。
       现在工具里改叫「字幕最大间隔」并注明它是代理信号，权威定案归 review:meeting。
   ▸ **一次把数据读错的自我纠正**：先得出"18 句会触发、多数是 AI 回声"，核 `asr` 字段后
     发现其中 13 条是 AI 写进账本的存档回答 ⇒ 麦克风人话 864 句里只触发 3 句、**全是真命令**，
     误触发 0（那个现象本来不存在）。修口径 + 断言改成比例与样本量，见坑 107。
   ▸ **⑧ 语音 fixture 收成一份 + 复盘会自己标"这是自测场"**：`FIXTURE_SENTENCES` /
     `looksLikeFixtureCaption()`（`scripts/voice-fixture.js`）为唯一实现，三个语音测试改引用它，
     冒烟加一条**结构红线**防手抄复发；`review:meeting` 因此新增「谁在说话」= 自测场 / 混合场 /
     真人场 / ❔，并把页脚那句**过期声明**（"本报告不区分真人会议与自测房间"）改口——
     三档而非二档是房间 204534 的 48% 逼出来的（坑 53：判据在边界上给出反直觉结论=边界画错位置）。
     见 **LEARN 5.53.5**；`test:review` 19 → **29**。
     ▸ 中途这个房间级判据**先跑飞过**：它把「8 条里 3 条念稿 + 5 条真讨论」报成自测场——
       因为整场拼起来当然含那句完整话，而**真人会上也有人真说过那句请求**。
       是自检 M2 那条旧断言把它拦下来的（它期望"混合场"却读到"自测场"）。
       修法不是放宽断言，是给抬档加前提（小碎片占多数）+ 补一条**反例断言**（M4）钉住。
   **下次接着做（10-06 深夜刷新）**：① **用户重启 3001**（本轮改的是服务器里的动词表，
     不重启就还是旧规则；页面侧一行没改，`?nosw=1` 这次不是必须）；
   ② 真人开麦走一遍"随手说六种新说法"（`白板不用了`/`字幕先停一下`/`把刚才画的都擦掉`…），
     自动化已经逐个证过，人只需确认体感；
   ③ 本地 Qwen TTS 去留仍等用户点头；④ 改动全部未提交（按纪律不主动 commit）。

5.22 ✅ **2026-10-07 通宵到深夜（字幕整句 + 整句重转 + H8 双边钳位 + H6 常驻告警 + H5/H5b + H1a worker 池）**——
   逐条见顶部「★ 2026-10-07」块（⑱ = H1a）与 `后续升级方向.md` **0.6**（第 16 行 = H1a）；
   新记坑 **111 / 112 / 113 / 114 / 115 / 116 / 117**；导读 **LEARN 5.55**（+ 5.51.2 加了改口指针）；
   新工具/新检查：`npm run bench:asr-multi`（H5/H5b 的三档并发对比，也是 H1a 的容量量具）、
   `doctor` 新增 **A7d 显存预算体检**、
   `check:caption` 19 / `check:theme` 18→**25** / `check:invite` 8（`check:all` 因此 19 条 · 311 项）；
   **H1a 一句话**：本地 ASR 从"一条串行队列"变成"按成员稳定分片的 1..4 槽池"，
   8 路并发实测 **1 槽 3.14~3.18s / 2.6 次每秒 → 2 槽 1.78s / 4.3 次每秒（≈1.65 倍）**，
   但**默认仍是 1**（一槽 ≈1.9GB 显存，超载的后果是引擎静默回落 CPU 而不是报错）；
   取值判据 `resolveWorkers()` 收成一处，服务器与体检共用（坑 47）。
   **下次接着做（10-07 深夜刷新，优先级按 `后续升级方向.md` 0.6 的新推荐节奏）**：
   ① ★ **用户重启 3001 + 浏览器 `?nosw=1` 开一次**——本轮所有改动
     （整句重转/让路、H8 双边钳位、丢尾闸、单位修正、RMS 宽限、别字表、worker 池、字幕卡两行、
     双主题、滑动墨、跨网自检、模糊衬底）全在服务器进程与前端代码里；版本自检横幅会自己说谁还是旧的。
   ② **真人开麦两条**：a) 吵房间（开空调/AGC 顶底噪）里句子还会不会粘成一条 blob；
     b) 长句定稿后字幕条两行是否看得完整（>112 字会被省略号裁，全文在 title 与历史抽屉）。
   ③ **H8b**：底噪估计把 −99 的纯静音排除在样本池外 ⇒ 噪声底系统性偏高——
     要动它得先拿真人真麦的分布（不拿合成音频调生产阈值）。
   ④ ~~**H1 / 多 worker**~~ **✅ 10-07 深夜做完（记为 H1a）**：worker 池 + A7d 显存体检（见顶部 ⑱）。
     剩下的 **H1b = 流式 ASR**（边说边出字）：H1a 把容量抬了 ≈1.65 倍，但**没有**改"说完再听一遍"这个结构。
   ⑤ 本地 Qwen TTS 去留仍等用户点头；⑥ 改动全部未提交（按纪律不主动 commit）。

5.23 ✅ **2026-10-08 第 51 步：共享文件浏览（房间所有人同时看同一份文档，零依赖读 Office）**——
   逐条见顶部「★ 2026-10-08」块；新记坑 **118 / 119 / 120**；导读 **LEARN 5.54**；
   新文件 `sfu/public/fileview.js`（渲染内核）+ `sfu/files.js`（存储层）+
   `scripts/{ooxml-fixture,test-fileview,test-files,check-files}.js`；
   功能表第 **36** 行、协议总表 FILES_* 段（本文件第 6 节新表）、命令块三条新 npm script；
   `check:all` 因此 **19 → 20 条 · 311 → 344 项**，本轮全量回归**实测全绿**（数字见顶部 ⑤）。
   **下次接着做（10-08 刷新，优先级按 `后续升级方向.md` 新批次 I）**：
   ① ★ **用户重启 3001 + 浏览器 `?nosw=1` 开一次**——服务器路由/信令与全部前端代码都改了；
     版本自检横幅会自己说谁的页面还是旧的。
   ② **真人用过一次这个面板**（命令行验不了"看着舒不舒服"）：两份真文件（一份带图与表格的 Word、
     一份多页 PPT）→ A 打开 → B 跟随 → 翻页 / 缩放 → 第三人 C 晚进房看补发。
   ③ **I 档深化**（见 `后续升级方向.md`）：PDF 的真浏览器证据、手机 390px 形态、
     soak 接入文件流量、`review:meeting` 新增「共享文件」一行、渲染内核边界（合并单元格 / 嵌套列表 / 更多 numFmt）。
   ④ 一条**会被再次踩到的坑**留在这里：`enterRoom()` 现在会收起首屏，
     所以"绕过首屏"的旧测试路径状态更真了；哪天有检查报"点不到"，先怀疑它走了后门（坑 119）。
   ⑤ 本地 Qwen TTS 去留仍等用户点头；⑥ 改动全部未提交（按纪律不主动 commit）。

5.24 ✅ **2026-10-08 凌晨第二轮（路线图 I 档 I1~I5 + I9：给这条新功能把证据打厚，顺手抓到一条真缺陷）**——
   逐条见顶部「★ 2026-10-08 凌晨下半场」块；新记坑 **121 / 122 / 123 / 124 / 125 / 126**；导读新增 **LEARN 5.56.9**
   （五件可复用的判据）并**刷新 5.56.8 债务清单**；`后续升级方向.md` 的 I 档 I1~I5 + **I8 + I9** 全部 ✅
   （I8 当晚就做了第一轮：`npm run review:office` 扫 25 份真文件，抓到一条**限额作用域**的真缺陷）。
   **回归（本轮实测，顺序跑）**：`test:fileview` **234/234**（+22 O 组、+9 P 组）· `test:smoke` **499/499** ·
   `test:sfu` **270/270** · `test:asr` **222/222**（+4 FILES_GEN 三组）· `test:review` **47/47** ·
   **`check:all` 20/20 条 · 356 项**（`check:files` 33 → **45**）·
   `soak` 带文件流量压缩跑 **PASS**（上传 3 · 删除 1 · 对账 3 次不平 0 · 视角 3 发 3 收 · 房间销毁后目录已删）。
   **下次接着做（10-08 凌晨刷新）**：
   ① ★ **用户重启 3001 + 浏览器 `?nosw=1` 开一次**——PDF 翻页的修在 `client.js`，其余在脚本侧；
     版本自检横幅会自己说谁的页面还是旧的。
   ② ★ **命令行验不了的两条**（都进人工清单，别当成已验证）：
     a) **PDF 在面板里真的画出来了**——无头环境里插件像素不可靠（同一页读到 34/49/94/53%），所以这条只能眼看；
     b) **手机窄屏那份面板的手感**。
   ③ ★ **I8：拿真实 Word/Excel 回扫**——O 组那 22 条钉的是"我想得到的怪形状"，
     夹具是我自己写的，天花板就是我的想象力（坑 106 同一条）。
     请用户把**手头真文件**丢进会议渲染一次，渲染不出的每一处都变成一条新夹具 + 一条新断言。
   ④ **I6 是产品决策**（谁当主讲 / 退出跟随之后怎么回到主讲），要用户点头才动；I7（文件进 AI 语料）押后。
   ⑤ 本地 Qwen TTS 去留仍等用户点头；⑥ 改动全部未提交（按纪律不主动 commit）。
5.25 ✅ **2026-10-08 凌晨第三轮（把证据再打厚一层，压出两条"做错方向"的缺陷：跟随抢主讲 + 「打开 X」被 C1 截走）**——
   逐条见顶部「★ 2026-10-08 凌晨续跑」块；新记坑 **127 / 128 / 129**；导读 **LEARN 5.56.11**。
   改的产品代码只有 `sfu/public/client.js`（+ `index.html` 那颗按钮的 title + `protocol.js` 口径），
   **服务器与文件层一行没动**；`sfu/ai/roomActions.js` 那张表也没动（它一直是对的，被客户端截走了而已）。
   **回归（本轮实测，顺序跑）**：`test:smoke` **514/514**（499 → 514）·
   **`check:files` 58/58**（45 → 58，两个真浏览器）· **`test:room-actions` 21/21**（17 → 21）·
   `test:fileview` **240/240**（234 → 240：O 组的真实形状现在两轨都渲染过）·
   `check:theme` **26/26**（25 → 26：共享文件这块第一次被浅色档扫到，57 → 68 处、两档 0 不合格）·
   `test:sfu` **270/270** · `test:asr` 222 · `test:review` 47 · `test:nets` 31 · `test:watch` 54 ·
   `test:store` 55 · `test:shutdown` 9 · `test:tts` 13 · `test:ai-brain` 75 ·
   `test:e2e-media` 38 · `test:e2e-reconnect` 15 · `test:agent` 24 · `test:publish` 30 ·
   `test:record` PASS · `test:turn` PASS · `soak` 8 分钟压缩 **PASS**（含文件流量对账与房间销毁清目录）·
   `doctor` 24 通过/1 警告/0 失败 · **`check:all` 20/20 条 · 370 项界面断言**
   （`check:dock` 在全量里红过一次、单独复跑 34/34 —— 会移动的失败先怀疑量具与负载，坑 80/87）。
   三处新判据都用**旧写法/旧判据复跑证过可红**（跟随那条红在"A 的画面被换成 B 那一份"，
   C1 那条红在"打开实时白板 / 打开共享文件面板"被截走 + "在他电脑上打开记事本"反而不走 ai-op）。
   **I6 的一半顺带做掉了**：②"退出跟随后怎么回到主讲"——它不是一个政策问题，
   而是那颗按钮**原本在做与它文案相反的事**（缺陷）；
   ①"要不要把主讲让给后来的人"**仍是产品决策**，没动（现在依旧是"最后动的人赢"）。
   **下次接着做（10-08 凌晨第三轮刷新）**：
   ① ★ **用户重启 3001 + 浏览器 `?nosw=1` 开一次**——两条修复都在前端代码里；
     版本自检横幅会自己说谁的页面还是旧的。
   ② ★ **真人多窗试一次跟随**（命令行只能验几何与状态，验不了手感）：
     A 带大家看一份 → B 关掉跟随自己翻两页 → 再点回跟随，看 B 是不是"跳回来了"而 A 完全没动。
   ③ **I8 仍等真文件**：`npm run review:office` 现在只扫过我这台机器上的 25 份；
     用户手头那份"渲染不出来"的 Word/PPT 才是下一批夹具与断言的来源。
   ④ **I6-①（主讲政策）**、**I7（文件进 AI 语料 = 新的隐私面）** 都要用户点头才动。
   ⑤ 本地 Qwen TTS 去留仍等用户点头；⑥ 改动全部未提交（按纪律不主动 commit）。
5.26 ✅ **2026-10-09 通宵两档（J 档「共享文件真的能看 Word」+ K 档「跨网：不同网也能进会」）**——
   逐条见顶部「★ 2026-10-09」块与功能表 **36b/36c** 行；新记坑 **130~136**；导读 **LEARN.md 5.57**；
   路线图 **0.8**（J1~J4 / K1~K6 全部 ✅ + **L 档**七条）+ 0.1 表加一行 + 0.2 加三条人工清单。
   改的是：`sfu/public/fileview.js`（**第 10 节 legacy** + 样式编号 + 格式码 + 怪形状）、
   `sfu/server.js`（`attachRtcServer` / `mediaListenInfos` / `transportListenOptions` / `ANNOUNCE_*` /
   两条 metrics / 自测**默认等主引擎**）、`sfu/nets.js`（`announceIps` / `isVirtualNic` / `diagnose` 两项）、
   `sfu/public/style.css`（5 个新类 + 邀请面板高度上界）、`sfu/protocol.js`（`/config.json` 字段与三个新配置键）、
   新脚本 `office-oracle.py` / `legacy-oracle.ps1` / `stun-probe.js` / `test-crossnet.js`，
   以及 `doctor`（B1b + `entryHost`）/ `start-lan` / `allow-firewall.bat` / 两份部署文档。
   **回归（本次全量顺序跑，全部实测）**：`check:all` **20/20 条 · 388 项** · 冒烟 **521**（514 + L7 两条浮层上界红线 + L6 一条"报告器必须接守卫" + 4 条守卫单测）· 信令 **270** ·
   `test:fileview` **292** · `test:asr` **222** · `test:nets` **42** · `test:crossnet` **17** ·
   `test:stun` **8** · `check:files` **71**（带真文件 72）· `check:invite` **12** · quiet-mic 11 · room-actions 21 ·
   e2e-media 38 · **e2e-asr 25** · e2e-reconnect 15 · agent 24 · e2e 16 · Mesh 36 · store 55 · watch 54 ·
   shutdown 9 · tts 13 · qwen 10(+1skip) · ai-brain 75 · ai 10 · publish 30 · review 47 · office 5 ·
   record PASS · turn PASS · doctor **25/1/0** · **asr-live PASS**（qwen-local 就位后：定稿 2 条全
   `silence`、⏱ 3.0~3.1s、**整句重转采纳 2/2 且逐字全对**、应答 1 次不多不少）·
   **`soak --minutes 8` PASS**（专用 3023 + 临时库/FILES_DIR + `ASR_QWEN_LOCAL=0`：8 分钟 ·
   信令 239 条 · **断线重连 0** · 归档 POST 8 次 48 条 = 回读 48 条对账一致 · 健康检查 16 次 0 错误 ·
   rss 54→66MB · **文件流量**：上传 8 / 删除 5 / 对账 8 次不平 0 / 清单广播 13 次 / 视角 8 发→8 收 /
   房间销毁后目录 ✅ 已删）。
   **下次接着做（10-09 刷新）**：
   ① ★ **用户重启 3001 + 浏览器 `?nosw=1` 开一次**——服务器（WebRtcServer/通告地址/自测默认）与前端
     （渲染内核/浮层上界）都改了；启动日志那两行「媒体走固定端口 UDP+TCP 4443」与「媒体通告地址…」
     就是生效的凭据，版本自检横幅会自己说谁的页面还是旧的。
   ② ★ **L1 真跨网**：拿**另一张网络**（手机热点 / Tailscale 对端 / 第二台宽带）打开邀请链接进会看到画面。
     本机已把"该转几条端口"从一整段降到一条，并实测反射地址 ≠ 通告地址（在 NAT 后）——
     但"对方真连上了"这句话只有真机能证。
   ③ ★ **L2 用户那份真文件**：`REAL_OFFICE_FILE=<路径> npm run check:files` 或直接把文件丢进会议渲染；
     渲染不出的每一处 = 一条新夹具 + 一条新断言（这轮的三个缺陷全是被"别人的实现/真 Office"抓的，不是被我的电池抓的）。
   ④ **L3 旧版格式的表格与图形**（现在只出文字与逐格数据）、**I6-① 主讲政策**、**I7 文件进 AI 语料**（隐私面）：都要用户点头。
   ⑤ **词级准确率天花板**（大木车/洗地皮/庭审会）仍等用户在三条路里拍板。
   ⑥ 本地 Qwen TTS 去留仍等用户点头；⑦ 改动全部**未提交**（按纪律不主动 commit）。
5.27 ✅ **2026-10-09 同日第三批（M 档：语音"准确率"这把尺 + 真人金标准链路）**——
   逐条见顶部「★ 2026-10-09 语音这条线第一次有准确率这把尺」块与功能表 **36d** 行；
   新记坑 **138 / 139 / 140**；导读 **LEARN.md 5.58**；路线图 **0.9（M 档）** + **H3 改口**
   （从"等用户拍板"变成"看表选，但真人那一列还欠"）。
   新增：`sfu/ai/accuracy.js`（CER 唯一口径）、`sfu/golden.js`（句子清单 + 账本 + 转码 + `GOLDEN_DIR` 隔离）、
   `sfu/public/golden.html`（录制页，`/golden` 短地址）、`GET/POST /api/golden`（requireAdmin）、
   `npm run bench:asr-golden`（引擎 × 距离 × 增益，先自证量具）、`npm run check:golden`（真浏览器 11 项）。
   收口：`Asr.modelGainDb()`（原来 server 内联两遍）+ `QwenLocalAsr.resolveModelDir()`（三处抄本接回）
   + `asrMinPeakDb()` + `Asr.configureGain()` 配置桥（example 里的键必须真被读到）
   + 触发账 `COLLAB.gainApplied` → `/metrics` 与 `/api/rooms`。播报不再切半句 + 语音轨加 `spoken` 形状约束。
   **回归（本次实测，顺序跑）**：asr **252/0(+1skip)** · sfu **282/0** · 冒烟 **521/521** ·
   `check:golden` **11/11** · **`check:all` 21/21 条 · 399 项** · review 47 · nets 42 · watch 54 ·
   store 55 · tts 13 · shutdown 9 · ai-brain 75 · **`bench:asr-golden` 首张表**：
   qwen-local(cuda) micro **2.8%**（全对 9/10）vs whisper-small **4.9%**（5/10）。
   **下次接着做（10-09 刷新）**：
   ① ★ **用户重启 3001 + 浏览器 `?nosw=1` 开一次**（增益收口 / 触发账 / `asrMinPeakDb` /
     `spoken` 形状 / `/golden` 页面与两个新端点全在服务器进程里）；版本自检横幅会自己说谁的页面还是旧的。
   ② ★ **录 20 句真人金标准**（开着服务器访问 `/golden`，两档距离各 10 句，约 6 分钟）
     → `npm run bench:asr-golden` 自动变成"真人场"表 → **H3 那条"词级天花板"从此可以按表拍板**；
     顺手 `--compare` 存一份基线，以后动阈值才有"变好/变坏"的依据。
   ③ 云端那一列（`--engines=cloud`）今天**从未被真响应打过一次**：`.env` 里只有 `DEEPSEEK_API_KEY`，
     而识别要的是**阿里 DashScope 那把**（DeepSeek 的 key 不等于它）；且它会把会议音频送出外网——
     这条隐私边界等用户点头再动（配好 key 只改一列，代码不用改）。
   ④ H8b（底噪估计排除 −99 纯静音 ⇒ floor 偏高）现在**有了真人数据通道就能定**；
     H1b 流式 ASR 仍排在这把尺之后（换引擎/改结构都会污染准确率对比，顺序不能反）。
   ⑤ 本地 Qwen TTS 去留、改动全部未提交（按纪律不主动 commit）——照旧等用户。
5.28 ✅ **2026-10-09 同日第四批（用户点的三个账号缺口：退出登录 / 忘记密码 / 管理员的实质区别）**——
   逐条见顶部「★ 2026-10-09 第二批」块与功能表 **37** 行；新记坑 **141 / 142 / 143**；导读 **LEARN 5.59**；
   新文件 `scripts/inject-check.js`（"拼代码给浏览器执行"的交付前自检，一处实现、12 个 check 脚本接线）。
   改的是：`sfu/public/client.js` **第 52 步**（`showAuth` / `myAuth` / `clearAuthState` / `doLogout` / 两步确认 /
   `renderAccount` / 治理台只随服务器 role 出现）、`sfu/server.js`（`dropIdentity` 唯一收口 + `auth-logout` 归属守卫 +
   `auth-refresh` 判失败同步撤身份 + `passwordMinLen` 下发）、`index.html`（身份牌 + 账号面板 + 「忘记密码？」）、
   `style.css` 第 41 节、`sfu/password.js`（`strengthError` 三处共用）、`scripts/admin.js`、`sfu/protocol.js`。
   **回归（本批实测，顺序跑）**：`test:smoke` **558/558**（+37：第 52 步行为与接线 33 条、
   inject-check 自测 2 条含"不许误伤"反例、HTML 两条结构红线）· `test:sfu` **见下**（+16 服务器那半边）·
   `check:theme` **28/28**（点名掀开账号面板 → 扫出深色档 `.account-note` 4.03:1 → 修成两档 0 条）·
   `check:login` **13/13**（三个次要出口同一行 + 忘记密码那句的真文本双向钉）· `check:golden` **12/12**（顺手把本仓库最后一处"靠固定 sleep 读页面"改成"轮询到它成为断言条件本身"）· `check:all` 见顶部块末。
   三条新判据都用变异证过可红（摘掉 `dropIdentity('refresh-expired')` / 摘掉票归属守卫 /
   把那条 HTML 注释的闭合换成 CSS 的序列 → 各自精准红在对应断言上）。
   **下次接着做（10-09 第四批刷新）**：
   ① ★ **用户重启 3001 + 浏览器 `?nosw=1` 开一次**（`dropIdentity` / `auth-logout` / 续期配对 / `passwordMinLen`
     在服务器进程里；身份牌、账号面板、找回提示在 `client.js` 与 `index.html` 里）。
   ② ★ **一个产品决策等用户点头**：会中权限我没动（owner 与 admin 本来就该平等），
     admin 的"实质区别"目前 = 四个治理页面 + 身份可见。要不要再给 admin 真特权
     （跨房巡检操作、强制任意连接下线、改他人密码的 UI），这是**扩大攻击面**的决定，不替他做。
   ③ 真人开麦验两条：退出后去 `/dashboard` 也确实退回未登录（localStorage 已清是硬证据，跨页体感还得人看）；
     窄屏（笔记本 768 高）里账号面板与治理台四链接完整可见（浮层上界已给，观感请人确认）。
   ④ 真人金标准已录上（20 句 = 10 句 × 两档距离）→ **真人场首张表**（`bench:asr-golden`，prod 增益档，micro CER）：
     `qwen-local(cuda)` **near 4.2% / far 5.6%**（各 7/10 全对）vs `whisper-small` **11.9% / 13.3%**（4/10、2/10）
     ⇒ 两档差距都是 **7.7 个百分点**，而两把尺对"坐远"的敏感度一样是 1.4 个百分点。
     用户点名的「大木车 / 洗地皮」这一句**两档都逐字全对**——但那不构成"词级问题已解决"的结论：
     金标准是**整句一次转写 + 无房间噪声 + 关掉 AEC/NS/AGC**，而他抱怨的那些错出在**真实会议链路**
     （2s 分段 + 房间底噪 + AGC 把电平顶起来），两边不是同一个条件。
     ▸ 这张表真正能拍板的是：**whisper 兜底才是明显差的那一档**（真词错成"亚瑟报告 / 复杂了 / 排妹啊 /
       风值 / 付56 / 做得远 / 机要声称"），而 qwen-local 的残错形状已经变成
       **数字写法（-56 → 负五十六）与偶发插入（重复半句）**——这两类都有下游对策（`fixDomainHomophones` 那类
       文本侧纠正、以及"写法折算"口径），不再是"听不出词"。
     ▸ 顺手记一条**这张表的边界**：far 档只是把同一份干净录音整体调小，**房间噪声与混响没跟着进来**，
       所以"坐远掉 1.4 个百分点"不等于"在吵会议室里坐远会掉 1.4"（表头自己写明）。
     真人场的下一步是 H8b（底噪估计把 −99 纯静音排除在样本池外 ⇒ floor 系统性偏高）——
     现在有真人分布可以定了，但要在**真实会议账本**上定，不是在这张表上定。
   ⑤ 本地 Qwen TTS 去留、改动全部未提交（按纪律不主动 commit）——照旧等用户。

5.29 ✅ **2026-10-10 通宵六批（两条口头结论结案 + 准确率买回点数 + "只有正向没有反向"全仓审计 + 真实文件回扫扩面 + 长跑四条全绿）**——
   方案与逐批结果都在 `后续升级方向.md` **0.11**；详细叙述在顶部「★ 2026-10-10」块与本节；
   方法教学章 = **LEARN 5.60**；新判据/新坑 = 第 7 节 **144 / 145 / 146 / 147** + **129 第四次应验**。
   **下次接着做（10-10 刷新）**：
   ① ★ **用户重启 3001 + 浏览器 `?nosw=1` 开一次**（回声折叠 / 票清扫器 / 台账暴露都在服务器进程里；
     「解禁」按钮、音量账上限、房间作废销朗读账在 `client.js` 里）。
     ▸ 重启之后 `npm run review:meeting -- --days 1` 里那两行 ❔（**RMS 到达** 与 **房间可分性**）
       才会开始攒样本——那是今晚新装的两把尺在真实会议里的第一手数据，
       也是"H2 结案"这件事真正的收尾（**仪表装了 ≠ 有人在真实场景里读到数**）。
   ② ★ **H8b 的下一步不在代码里而在数据里**：今晚量到的更要紧的一件事是
     **这个人停下来之后房间并不安静**（近档最差那份的尾窗 RMS 中位 −36.8 dBFS，而阈值 −54.6）
     ⇒ "有多少窗被判有声"读的是**房间可分性**。要动 `margin`/分位必须拿 `review:meeting`
     的真人会议分布来定，**不要拿金标准那份安静录音定**（两个条件不是一回事）。
   ③ **词级准确率天花板仍未解决**（「大木车 / 洗地皮 / 庭审会」那一类）：三条路的代价现在都可量
     （云端要 DashScope 那把 key 且**把会议音频送出外网** = 等用户点头；换更大模型要先重新量 8GB 显存预算；
     靠近麦克风是用户动作）。今晚文本侧那一刀只买到"复读半句"这一类，不是全部。
   ④ **H1b 流式 ASR（边说边出字）** 仍排在 H2/H8b 之后最前：现在的下限是"说完 → 下一个 2s 分段边界"，
     H1a 抬的是容量不是这个等待。
   ⑤ **`test:voice-longrun` 那条 `split` 占比（今晚 14/38）**值得留意：它同时包含"三句被粘成一条后切开"
     与"一句被切开"两种形态，看之前先确认「谁在说话」那行是自测场还是真人场。
   ⑥ **Mesh 对照版 `npm test` 本轮未重跑**，理由要留下：`git diff --stat` 的 19 个改动文件
     **没有一个在根目录路径**，而 3000 端口此刻是**别人起的服务器**（跑了对它就是坑 57 的假绿）。
     哪天动了 Mesh 代码，先自己起 3000 再跑。
   ⑦ 本地 Qwen TTS 去留、admin 要不要真特权、真第二张网入会、用户那份渲染不出的真文件——照旧等用户；
     **今晚各批已按批 commit，但没有 push**；`Guoge` 仍在已推历史里（改历史要点头）。

5.30 ✅ **2026-10-10 第二批（计划 0.12：C1 仪表"进行中有读数" + C2 定稿延迟买回 1.1s）**——
   逐条见顶部「★ 2026-10-10 第二批」块；新坑 **148 / 149**；结果回填在 `后续升级方向.md` **0.12**。
   改的是：`sfu/server.js`（滚动落账 + `uttTake`/`uttOrdered`/`refineWillRun`/`scanTailSegments` 两结论 +
   `COLLAB.tailRush` 两本账 + `/metrics` 两行 + `/api/rooms` 同源）、
   `sfu/ai/asr.js`（`tailCoveredByRush` / `uttOrdered` / `uttSegmentKinds` 三个新纯函数）、
   `scripts/review-meeting.js`（「尾巴抢跑」一行 + 只有事件没有账本的房间也进报告 + 那五行降级）、
   测试侧 `test-asr`（⑮ 组 26 条）/ `test-sfu-signaling`（+2）/ `test-review`（+3）。
   **本批实测**：asr **289/0(+1skip)** · sfu **307/307** · 冒烟 **573/573** · review 自检 **70/70** ·
   `test:asr-live` **PASS×4**（off/off/on/on 同机器同场次，开的那两轮各放行 1 次、第二句 2.0s）。
   **下次接着做（10-10 第二批刷新）**：
   ① ★ **重启 3001**（本批全在服务器进程里）。重启后第一件事是
     `npm run review:meeting -- --days 1`：`RMS 到达` 那行应当不再是 ❔（进行中就有读数的效果），
     `尾巴抢跑` 那行如果报 0 次，两种解释里应当是"worker 一直忙"而不是"还没重启"。
   ② **C2 只买回了第二条句子**：第一句仍被 `segInFlight===0` 守卫挡着（那是"重复接话"的防线，
     不许顺手改）。下一次要动延迟，靶子是**并发守卫与整句重转的排队**，不是这道闸门。
   ③ ⑮.20 那条反向钉留着：谁再把"整段重读"或"抢跑必须出字"这两个被否掉的直觉实现一遍，断言当场红。
   ④ 其余照 5.29 的 ②③④⑤⑦ 未变（房间可分性的真人分布、词级天花板三条路、H1b、Mesh 未重跑的理由、
     各件等用户点头；本批同样**只 commit 未 push**）。
5.31 ✅ **2026-10-10 第三批（计划 0.12 的 C3：AI 听得懂「刚才那个再关回去」+ 抓出一条"空气泡"老缺陷）**——
   逐条见顶部「★ 2026-10-10 第三批」块；新坑 **150 / 151**；结果回填在 `后续升级方向.md` **0.12**。
   改的是：`sfu/ai/roomActions.js`（`detectUndoAnaphora` / `resolveUndo` / `ACTION_INVERSE` /
   `ACTION_IRREVERSIBLE` / `passesQuestionGate` 收成唯一实现并补 A-not-A 问句判据）、
   `sfu/server.js`（`room.actionStack` + ⓪b 回指路由 + `streamFillText` 两条路 + 两本触发账）、
   `sfu/public/client.js`（意图徽标文案 + 兜底不露空）、`sfu/protocol.js`（零新信令这件事写进总表）、
   `scripts/{test-asr,test-sfu-signaling,test-sfu-client-smoke,review-meeting,test-room-actions}.js`。
   **本批实测**：asr **312/0(+1skip)** · sfu **308/308** · 冒烟 **575/575** · review **73/73** ·
   **room-actions 真浏览器 31 项 / 0 失败**；两次变异证过可红后逐字还原（`diff` 为空）。
   **下次接着做（10-10 第三批刷新）**：
   ① ★ 重启 3001 + `?nosw=1`（动作栈与补流在服务器，徽标文案在前端）；重启后气泡里应出现人话「撤回刚才那步」。
   ② 真人验一句：开一次白板 → 说"刚才那个关回去" → 界面真的关；再手动点一次按钮 → 说同样的话，
     它应当**明说看不见手动操作**（这是边界，不是故障）。
   ③ 动作栈目前只记房间级动作；若将来给"人手动改的状态"加广播（例如成员点按钮也发一条 room-state 类事件），
     回指就能覆盖更多——但那要给客户端加信令，属于新范围，先不做。
   ④ 其余照 5.30（H8b 真人分布、词级天花板三条路、H1b、Mesh 未重跑的理由、各件等用户点头；仍只 commit 未 push）。
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
   **另有真实剩余项**（2026-10-05 上午刷新）：① 0.2 节"做完但没实测"清单（浏览器人工验证）；
   ② E3 浏览器端 e2e 已大幅补齐（test:e2e-asr / test:e2e-media / test:e2e-reconnect + check:all
   15 条界面检查），剩的是**偶发红的环境隔离**（坑 87：多服务器争用先量资源再改代码；
   坑 88 那条 `cdp.navigate()` 已修，e2e-asr 的 ⑨⑩ 仍欠一次全绿复跑）；
   ③ 论文提纲/录屏（用户明确押后）；④ ~~本轮夜跑代码改动的全量既有回归~~ **已补齐**
   （test:smoke 388 · test:sfu 219 · Mesh 36 · test:agent 24 · check:all 15/15·204 · asr-live PASS）。
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

