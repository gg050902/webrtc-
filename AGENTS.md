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
>   错过就没有合法升级窗口），用户无感，真实库里 Guoge 等老账号下次登录即升级。
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
│   ├── server.js          #   SFU 服务器（分区 A~E）：静态托管 + 房间/密码 + 用户体系 + 媒体中枢 + 录制 + 面板 API
│   ├── protocol.js        #   SFU 信令事件总表（房间/媒体/远程协助/A~F 各档事件，改 sfu 前后端先看）
│   ├── ai/asr.js          #   ★ 09-28 服务端语音识别唯一实现层：whisper 探测（UTF-8 环境 + --help 口径 +
│   │                      #     形态白名单）/ 转写（tiny 默认、简体提示词、并发闸 ASR_CONCURRENCY）/ 唤醒+追问窗口纯函数
│   ├── jsonc.js           #   ★ 09-28 带注释 JSON 容错解析（example 模板可"复制即用"；server 与 doctor 共用）
│   ├── config.example.json#   配置模板（端口/人数/listenIp/announcedIp/ICE/HTTPS/roomTtlSec/videoSvc/asrModel/asrSegmentSec/aiChatWindowSec）
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
npm run test:watch   # ★ 2026-10-03 watch 的退化诊断回归（纯函数 + 合成输入穷举）★ 32/32
                      #   判据：控制律/告警逻辑错了不会让任何功能变红，只会天天误报或永远不响
npm run test:asr     # 服务端 ASR 单测（探测/能量闸/清洗/碎片判据 isFragmentOf/配置模板）★ 36/36
npm run test:asr-live # ★ 语音闭环端到端（TTS→RTP→真管线→转写→应答），**带正向前置对照**；
                      #   ★ 2026-10-03 开场清场 + 按 ts 过滤 + 失败也清理（此前会被上一次运行污染）
                      #   TEST_ASR_WAIT_WARM=1 可等主引擎就位再测；专用端口 3017
npm run test:e2e-media # ★ 真浏览器多人音视频回归（假摄像头双页进同一房）★ 38/38
                      #   覆盖：在流画面 videoWidth>0 / 只听不看 / 每路音量 / 3 层 simulcast 降层 /
                      #   hero 手机形态 / 字幕与播报延迟读数 / 390px 全控件不越界；专用端口 3016
npm run bench:tts    # ★ 本地 Qwen3-TTS 参数档基准（float32/bf16 × 流式/非流式，量 RTF）
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
| C→S 应答 + S→C 定向 | `desk-register` / `desk-connect` / `desk-granted` / `desk-pending`（★ 09-30 设备码配对直连，借鉴 billd-desk） | `desk-register {name,platform,browser,connectPassword,securePassword,code?}`→`{deviceCode}`（被控端代理专用；**设备码就是房号**——建一个 `isDesk:true` 的私有房间，`router:null` 不碰媒体，同一时刻只允许它的 agent 在场，代理离线**即刻毁房**、不留 60s 宽限）；`desk-connect {deviceCode,password}`→`{granted,hostId,hostName}`（控制端**不用进会议**；校验顺序=格式→限流 10 次/分→设备在线→连接口令（连接密码**或**安全密码任一匹配）→互斥 `busy`；随后 `deskEnterRoom()` **轻量进房**：只 `socket.join`+`room.members.add`+`socket.roomNumber`，**不建 Transport、不订阅媒体、不广播成员**）；口令=安全密码 → 服务器直接登记 `remoteCtl` 并广播 `remote-state` + 发 `desk-granted{unattended:true}`；否则转 `remote-request` 给代理、给控制端发 `desk-pending`，代理确认后通用 `remote-answer` 处理器补发 `desk-granted{unattended:false}`——**两条路径前端只听一个事件**。⚠️ ack 与事件是两趟往返，断言要等一拍（坑 61） | 设备码直连远程桌面（登录页「🖥️ 用设备码连接」→ `#deskOverlay`） |
| C→S 定向（**老通道新语义**） | `remote-input` 的 `{kind:'quality', preset}` | 走**与鼠标键盘完全相同**的 `remote-input` 门禁（不新造事件 = 复用闸门与限流）；`preset` ∈ `smooth`/`standard`/`hd`，代理 `applyQuality` 改 `quality/fps/长边上限` 并 `cdp.setScreencast()` **重开抓屏**；未知档名忽略且当前档不变（拼错不致命）。**三层帧率**：档位定中枢（策略 6~24）→ `remote-quality` 闭环 ±2 微调 → 代理/服务器对任何请求硬钳 **2~24**（安全线比策略线更宽，两层有意分开） | 画质档按钮 + 弱网自适应（`#rdConsole` 的 `.rd-bar` 四颗） |

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

