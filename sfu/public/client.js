/* ════════════════════════════════════════════════════════════════
 * sfu/public/client.js —— SFU 版浏览器端代码（基于 mediasoup-client）
 *
 * ▎这个文件到底在干什么？（先看这一段）
 *
 * Mesh 版：浏览器之间直接 P2P 连（pc/offer/answer 全在浏览器里）。
 * SFU 版 ：浏览器只连服务器，媒体全部经服务器转发。
 *   所以浏览器的活从"自己连别人"变成四件事：
 *     ① 向服务器要本房间"能力清单"  → 初始化 mediasoup Device
 *     ② 向服务器要两条媒体通道      → 1 条发(sendTransport) + 1 条收(recvTransport)
 *     ③ 上传：麦克风/摄像头/屏幕    → sendTransport.produce() → 服务器建 Producer
 *     ④ 订阅：别人的每一路媒体      → recvTransport.consume() → 拿到 track 播放
 *
 * ▎和 Mesh 版代码的对应关系（对照着读最好懂）：
 *   Mesh 的 createPeerFor/addTrack/ontrack/offer/answer
 *   ⇩
 *   SFU 的 Device/Transport/produce/consume（服务器管转发，浏览器不再互连）
 *
 * ▎代码执行顺序（页面打开后）：
 *   连服务器 → 开摄像头 → 创建/加入房间（可设密码）
 *   → 收到 room-members → 建 Device + 两条通道 → 上传自己(produce)
 *   → 订阅老成员(consume) → 之后谁 produce 就广播通知大家来订阅
 * ════════════════════════════════════════════════════════════════ */

/* ──────────────────────────────────────────────────────────────
 * 第 1 步：找网页元素 + 快捷方式
 * ────────────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

const localVideo = $('localVideo');     // 显示"我自己"画面的 <video>
const videoGrid = $('videoGrid');       // 装所有人视频的网格
const logPanel = $('log');
const logTitle = $('logTitle');   // ★ 09-19d：日志面板折叠开关

/* ★ 09-26 头像系统（素材：apple-avatar/）：
 *  ① 注册可选预设头像 av-01~09（素材集 random-set，名=中国传统色）；
 *  ② AI 助理五态动态头像 idle/listening/thinking/speaking/happy（素材集 gufeng），
 *     由服务器 ai-state 广播驱动状态机——AI 格子(视频网格里的"虚拟参会者画面")
 *     与成员行小头像共用同一状态源。 */
const PRESET_AVATARS = [
  { key: 'av-01', name: '青黛' }, { key: 'av-02', name: '朱砂' }, { key: 'av-03', name: '黛蓝' },
  { key: 'av-04', name: '竹青' }, { key: 'av-05', name: '海棠' }, { key: 'av-06', name: '玄墨' },
  { key: 'av-07', name: '黛紫' }, { key: 'av-08', name: '石青' }, { key: 'av-09', name: '墨竹' },
];
const AI_STATES = ['idle', 'listening', 'thinking', 'speaking', 'happy'];
const aiAvatar = { state: 'idle', el: null, rowEl: null, tile: null };
const avatarUrl = (kind) => kind === 'ai' ? `/avatars/ai/idle-128.png` : `/avatars/presets/${kind}.png`;
const aiStateUrl = (st) => `/avatars/ai/${AI_STATES.includes(st) ? st : 'idle'}-128.png`;
let myAvatar = null; // 我的预设头像 key（登录/恢复后带回）

/* ★ 09-26b 唤醒词：开会时商量提到「小明」，它就接话——
 *   字幕成稿（emitCaption）里检测到名字 + AI 在场 → 自动把整句话作为提问发给 ai-ask。
 *   改名字只需改这里（+server 的 bot 显示名）。 */
const AI_NICKNAME = '小明';

/* ★ 09-26b 矢量动画头像 v2（素材：apple-avatar/gufeng/handdraw 丫髥童子）——
 *   静态 PNG 切换太僵硬，换成内联 SVG：呼吸浮动/眨眼/摇头由 CSS 关键帧驱动，
 *   五态靠眼形（睁/弯）与嘴形（笑/张/平）的显隐切换，瞬时无跳变。 */
/* [09-26c 弃用保留] 矢量小人版本,如需回退 git log 可寻 */
function aiAvatarSvg(st, cls) {
  /* ★ 09-26c 头像 v3 深度美化（用户反馈"还是不好看"）：
   *  ① 造型精修：皮肤径向渐变+柔边阴影滤镜、双眼皮+双高光眼、眉毛、发丝高光、
   *     交领双层次、腮红改柔边渐变——消除"火柴人"感；
   *  ② 丝滑：眼形/嘴形不再 display 硬切，全部 opacity 交叉淡化（transition .25s）；
   *  ③ 状态细粒度：thinking 有漂浮思考泡泡+瞳孔看斜上；speaking 嘴部开合动画；
   *     idle 偶发眨眼+轻微点头；listening 身体微前倾。 */
  const ST = { idle: 'st-idle', listening: 'st-listen', thinking: 'st-think', speaking: 'st-speak', happy: 'st-happy' }[st] || 'st-idle';
  return `<div class="ai-svg ${cls || ''} ${ST}"><svg viewBox="0 0 200 210" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="a-halo" cx="50%" cy="44%" r="55%">
        <stop offset="0%" stop-color="#d8e8df" stop-opacity=".9"/><stop offset="100%" stop-color="#d8e8df" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="a-skin" cx="46%" cy="36%" r="72%">
        <stop offset="0%" stop-color="#fdf1e0"/><stop offset="62%" stop-color="#f7e4cb"/><stop offset="100%" stop-color="#ecd2b2"/>
      </radialGradient>
      <linearGradient id="a-hair" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#4a3b2c"/><stop offset="45%" stop-color="#33291e"/><stop offset="100%" stop-color="#201912"/>
      </linearGradient>
      <linearGradient id="a-robe" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#679a90"/><stop offset="100%" stop-color="#4c7a71"/>
      </linearGradient>
      <filter id="a-soft" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="2.2"/>
      </filter>
      <filter id="a-blur1" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="1.1"/>
      </filter>
    </defs>
    <ellipse class="halo" cx="100" cy="100" rx="94" ry="94" fill="url(#a-halo)"/>
    <g class="body-grp">
      <!-- 衣领两层次：外袍 + 交领 -->
      <path d="M58 168 q42 26 84 0 l7 44 h-98 Z" fill="url(#a-robe)"/>
      <path d="M74 166 q26 20 52 0 l4 18 q-30 14 -60 0 Z" fill="#e8dcc6"/>
      <path d="M100 172 v20 M88 178 l-6 12 M112 178 l6 12" stroke="#c9b88f" stroke-width="2.6" stroke-linecap="round"/>
      <!-- 思考泡泡（仅 st-think 显示） -->
      <g class="think-bubbles">
        <circle cx="158" cy="52" r="5" fill="#d8cdb8" opacity=".85"/>
        <circle cx="172" cy="38" r="7.5" fill="#d8cdb8" opacity=".7"/>
        <circle cx="188" cy="22" r="10" fill="#d8cdb8" opacity=".55"/>
      </g>
      <!-- 头（后层柔影 + 脸） -->
      <ellipse cx="102" cy="110" rx="55" ry="59" fill="#c9a97f" opacity=".35" filter="url(#a-soft)"/>
      <ellipse cx="100" cy="106" rx="54" ry="58" fill="url(#a-skin)"/>
      <!-- 耳朵 -->
      <ellipse cx="45" cy="110" rx="7" ry="11" fill="url(#a-skin)"/>
      <ellipse cx="155" cy="110" rx="7" ry="11" fill="url(#a-skin)"/>
      <!-- 头发：主体 + 鬓角 + 发丝高光 + 丫髻 -->
      <path d="M46 104 q4 -48 54 -48 q50 0 54 48 q-12 -28 -54 -28 q-42 0 -54 28 Z" fill="url(#a-hair)"/>
      <path d="M44 100 q-8 24 1 38 q-16 -13 -13 -38 Z" fill="url(#a-hair)"/>
      <path d="M156 100 q8 24 -1 38 q16 -13 13 -38 Z" fill="url(#a-hair)"/>
      <path d="M60 84 q22 -18 42 -16 M140 84 q-20 -17 -38 -16" stroke="#6b5a41" stroke-width="2" fill="none" opacity=".7" stroke-linecap="round"/>
      <circle cx="100" cy="50" r="11" fill="url(#a-hair)"/>
      <path d="M92 44 q8 -8 16 0" stroke="#6b5a41" stroke-width="2" fill="none" opacity=".8" stroke-linecap="round"/>
      <rect x="96" y="56" width="8" height="6" rx="2" fill="#b4594c"/>
      <!-- 眉毛（thinking 时挑起） -->
      <path class="brow" d="M69 92 q10 -6 20 -2" stroke="#3b2f24" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      <path class="brow" d="M111 90 q10 -4 20 2" stroke="#3b2f24" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      <!-- 腮红（柔边渐变） -->
      <ellipse cx="68" cy="119" rx="10" ry="6" fill="#eda79c" opacity=".45" filter="url(#a-blur1)"/>
      <ellipse cx="132" cy="119" rx="10" ry="6" fill="#eda79c" opacity=".45" filter="url(#a-blur1)"/>
      <!-- 眼睛：睁眼（双眼皮+双高光；thinking 时瞳孔看斜上） -->
      <g class="eye-open">
        <path d="M69 100 q11 -5 22 0" stroke="#3b2f24" stroke-width="1.6" fill="none" opacity=".55" stroke-linecap="round"/>
        <path d="M109 100 q11 -5 22 0" stroke="#3b2f24" stroke-width="1.6" fill="none" opacity=".55" stroke-linecap="round"/>
        <g class="eye"><ellipse cx="80" cy="108" rx="7.6" ry="9.6" fill="#241c14"/>
          <circle cx="82.6" cy="104.2" r="2.7" fill="#fff"/><circle cx="77.8" cy="111" r="1.3" fill="#fff" opacity=".75"/></g>
        <g class="eye"><ellipse cx="120" cy="108" rx="7.6" ry="9.6" fill="#241c14"/>
          <circle cx="122.6" cy="104.2" r="2.7" fill="#fff"/><circle cx="117.8" cy="111" r="1.3" fill="#fff" opacity=".75"/></g>
      </g>
      <!-- 眼睛：弯眼（倾听/思考/愉悦） -->
      <g class="eye-curve">
        <path d="M70 108 q10 -10 20 0" stroke="#241c14" stroke-width="4.6" fill="none" stroke-linecap="round"/>
        <path d="M110 108 q10 -10 20 0" stroke="#241c14" stroke-width="4.6" fill="none" stroke-linecap="round"/>
      </g>
      <!-- 鼻子（一点即止） -->
      <path d="M100 116 q2.5 3 0 5" stroke="#c9a97f" stroke-width="2" fill="none" stroke-linecap="round"/>
      <!-- 嘴：三种（交叉淡化） -->
      <path class="mouth-smile" d="M89 128 q11 10 22 0" stroke="#b4594c" stroke-width="3.4" fill="none" stroke-linecap="round"/>
      <ellipse class="mouth-open" cx="100" cy="131" rx="8.5" ry="7"/>
      <path class="mouth-flat" d="M91 130 h18" stroke="#b4594c" stroke-width="3.4" fill="none" stroke-linecap="round"/>
    </g>
  </svg></div>`;
}

/* ★ 09-19e 去 AI 味·图标系统：彩色 emoji 换单色线性 SVG（stroke=currentColor 随按钮状态变色）——
 *   真产品的按钮都是单色图标+文字，彩色 emoji 堆在控件上是最大的「模板感」来源。
 *   所有图标 24 viewBox 手绘线性 path；静态按钮（index.html）与这里同款。 */
const svgIcon = (inner, cls) => `<svg class="i ${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICONS = {
  mic: svgIcon('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>'),
  micOff: svgIcon('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M4.5 4.5l15 15"/>'),
  cam: svgIcon('<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10.5l5-3v9l-5-3"/>'),
  camOff: svgIcon('<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10.5l5-3v9l-5-3M4 4l16 16"/>'),
  screen: svgIcon('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16v4"/>'),
  rec: svgIcon('<circle cx="12" cy="12" r="5.5"/>'),
  recOn: svgIcon('<circle cx="12" cy="12" r="5.5" fill="currentColor" stroke="none"/>'),
  recStop: svgIcon('<rect x="7.5" y="7.5" width="9" height="9" rx="1.5"/>'),
  hand: svgIcon('<path d="M8 12.5V6a1.3 1.3 0 0 1 2.6 0V11M10.6 11V4.8a1.3 1.3 0 0 1 2.6 0V11M13.2 11V6a1.3 1.3 0 0 1 2.6 0v6.8M15.8 12.8l1.6-2c.9-1.1 2.5.1 1.7 1.3L15.4 16.4c-1.1 1.7-2.4 2.6-4.4 2.6-2.6 0-3.6-1.5-3.6-3.4v-3.4"/>'),
  pen: svgIcon('<path d="M4 20l4.2-1.1L20 7.1a1.8 1.8 0 0 0-2.6-2.6L5.1 15.8 4 20z"/>'),
  sparkle: svgIcon('<path d="M12 4l1.8 4.7 4.7 1.8-4.7 1.8L12 17l-1.8-4.7-4.7-1.8 4.7-1.8L12 4z"/><path d="M18.5 4v3M20 5.5h-3"/>'),
  cc: svgIcon('<rect x="3" y="5" width="18" height="13" rx="2.5"/><path d="M7 11.5h4M13.5 11.5h3.5M7 15h7"/>'),
  bot: svgIcon('<rect x="5" y="8.5" width="14" height="9.5" rx="3"/><circle cx="9.5" cy="13.2" r="1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="13.2" r="1" fill="currentColor" stroke="none"/><path d="M12 8.5V5.5M9 5.5h6"/>'),
  leave: svgIcon('<path d="M14 12H5M8.5 8.5L5 12l3.5 3.5"/><path d="M13 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/>'),
  crown: svgIcon('<path d="M4.5 17.5h15L18 9l-3.8 3.2L12 6l-2.2 6.2L6 9l-1.5 8.5z"/>'),
  clip: svgIcon('<path d="M8.5 12.5l5.5-5.5a3 3 0 0 1 4.2 4.2l-7.5 7.5a5 5 0 0 1-7.1-7.1L11 4.2"/>'),
  door: svgIcon('<rect x="13" y="4" width="6" height="16" rx="1"/><path d="M3 12h7M7.5 8.5L11 12l-3.5 3.5"/>'),
  cursor: svgIcon('<path d="M5 3.5l7 16.5 2.1-6.9L21 11 5 3.5z"/>'),
};
/* 动态改文本的按钮统一走这里：icon+span 结构，与 index.html 静态按钮同构 */
function setIconBtn(btn, icon, text) { btn.innerHTML = icon + '<span>' + text + '</span>'; }
const connBadge = $('connBadge');
const netBadge = $('netBadge');         // 网络质量徽标（第 13 步）
const connType = $('connType');         // ★ 09-13 可达性：到服务器的连接方式（直连/STUN/TURN）
const handBtn = $('handBtn');           // ★ 09-13 F4：举手
const reactBar = $('reactBar');         // ★ 09-13 F4：表情回应（走 D+1 数据通道飞屏）
const memberCount = $('memberCount');
const roomBadge = $('roomBadge');
const roomPanel = $('roomPanel');
const createBtn = $('createBtn');
const roomInput = $('roomInput');
const roomPasswordInput = $('roomPasswordInput');
const joinRoomBtn = $('joinRoomBtn');
const leaveBtn = $('leaveBtn');
const muteBtn = $('muteBtn');
const camBtn = $('camBtn');
const shareBtn = $('shareBtn');

const chatList = $('chatList');
const chatInput = $('chatInput');
const chatSendBtn = $('chatSendBtn');

// ★ 远程协助（第 14 步）：工作台 + 授权卡片 + toast 元素（HTML 清单见 index.html 注释）
const assistBtn = $('assistBtn');                 // 「允许远程协助」开关（共享时才出现）
const workbenchArea = $('workbenchArea');         // 工作台容器（工具条 + iframe）
const workbenchFrame = $('workbenchFrame');       // 工作台 iframe（事件重放目标）
const wbStatus = $('wbStatus');                   // 工作台工具条上的状态文字
const wbReclaimBtn = $('wbReclaimBtn');           // 「收回控制」（正在被控时显示）
const wbAssistOffBtn = $('wbAssistOffBtn');       // 「关闭远程协助」（收工作台，共享继续）
const wbStopShareBtn = $('wbStopShareBtn');       // 「停止共享」（工具条内的等效按钮）
const remoteCursorEl = $('remoteCursor');         // 远程光标（被控端显示"控制端的鼠标"）
const remoteAskBox = $('remoteAskBox');           // 授权卡片容器（被控端用）
const remoteAskText = $('remoteAskText');         // 卡片里的文字
const remoteAllowBtn = $('remoteAllowBtn');       // 「允许」按钮
const remoteDenyBtn = $('remoteDenyBtn');         // 「拒绝」按钮
const toastEl = $('toast');                       // 一次性轻提示

/* ★ 2026-09-11 大升级新增的元素（A3/A4/A6/A7 + D1~D5，与 index.html 一一对应）
 *   按功能分组，方便对照阅读：
 *   D3 设备切换 → camSelect / micSelect
 *   D4 成员列表 → memberListEl / memberNumEl / ownerTag
 *   D5 录制     → recordBtn
 *   A4 文件传输 → fileAskBox / fileAskText / fileAcceptBtn / fileRejectBtn / fileInput
 *   A6 权限增强 → remoteDurSel（限时授权）/ remoteBlockBtn（拉黑）/ wbCountdown（倒计时）
 *                auditPanel / auditListEl / auditExportBtn / auditClearBtn / auditCloseBtn（审计日志）
 *   A3 剪贴板   → wbClipBtn（被控端反向发送剪贴板） */
const camSelect = $('camSelect');
const micSelect = $('micSelect');
const recordBtn = $('recordBtn');
const memberListEl = $('memberList');
const memberNumEl = $('memberNum');
const ownerTag = $('ownerTag');
const wbCountdown = $('wbCountdown');
const wbClipBtn = $('wbClipBtn');
const wbAuditBtn = $('wbAuditBtn');
const remoteDurSel = $('remoteDurSel');
const remoteBlockBtn = $('remoteBlockBtn');
const fileAskBox = $('fileAskBox');
const fileAskText = $('fileAskText');
const fileAcceptBtn = $('fileAcceptBtn');
const fileRejectBtn = $('fileRejectBtn');
const auditPanel = $('auditPanel');
const auditListEl = $('auditList');
const auditExportBtn = $('auditExportBtn');
const auditClearBtn = $('auditClearBtn');
const auditCloseBtn = $('auditCloseBtn');
const fileInput = $('fileInput');

/* ★ F 档升级（2026-09-12）新增元素（与 index.html 一一对应）
 *   F3 加入前预览页 → prejoin / preVideo / preVideoHint / pjCamSelect / pjMicSelect
 *                     / pjMeterBar / pjMuteChk / pjCamChk / pjEnterBtn / pjStatus
 *   F1 视图切换条   → viewGalleryBtn（宫格）/ viewSpeakerBtn（演讲者） */
const prejoinEl = $('prejoin');
const preVideoEl = $('preVideo');
const preVideoHintEl = $('preVideoHint');
const pjCamSelect = $('pjCamSelect');
const pjMicSelect = $('pjMicSelect');
const pjMeterBarEl = $('pjMeterBar');
const pjMuteChk = $('pjMuteChk');
const pjCamChk = $('pjCamChk');
const pjEnterBtn = $('pjEnterBtn');
const pjStatusEl = $('pjStatus');
const viewGalleryBtn = $('viewGalleryBtn');
const viewSpeakerBtn = $('viewSpeakerBtn');

/* ★ F6（第 28 步）新增元素：滤镜面板（预览页 pjFxBtn 与会内 fxBtn 两个入口共用一块浮层） */
const pjFxBtn = $('pjFxBtn');
const fxBtn = $('fxBtn');
const fxPanel = $('fxPanel');
const fxPresets = $('fxPresets');   // 滤镜档位按钮组（.fx-chip[data-preset]）
const fxKeys = $('fxKeys');         // 键色组（绿幕/蓝幕 .fx-chip[data-key]）
const fxBgs = $('fxBgs');           // 抠像背景组（墨/绢/金/图片 .fx-chip[data-bg]）
const fxSmooth = $('fxSmooth');     // 磨皮滑条
const fxSmoothVal = $('fxSmoothVal');
const fxChromaChk = $('fxChromaChk'); // 绿幕抠像开关
const fxChromaTol = $('fxChromaTol'); // 键色容差滑条
const fxChromaTolVal = $('fxChromaTolVal');
const fxBgFile = $('fxBgFile');     // 自定义背景图片（隐藏 file input）
const fxCost = $('fxCost');         // CPU 账徽标（x.x ms/帧）
const fxCloseBtn = $('fxCloseBtn');

/* ★ 实时字幕（第 29 步）新增元素 */
const capBtn = $('capBtn');           // 控制坞字幕开关
const captionBar = $('captionBar');   // 舞台底部字幕条
const captionText = $('captionText'); // 字幕文本（名字 + 内容）
const capExportBtn = $('capExportBtn'); // 字幕记录导出
const capHistoryBtn = $('capHistoryBtn');       // ★ 09-17b：历史抽屉开关（字幕条左侧）
const capHistoryPanel = $('capHistoryPanel');   // 历史抽屉
const capHistoryList = $('capHistoryList');     // 历史滚动列表
const capHistoryCloseBtn = $('capHistoryCloseBtn');

/* ★ 09-17c（字幕可用性修复）新增元素：自检徽标 + 诊断卡 + 手动字幕兜底
 *   起因：用户反馈"字幕不好用，是不是被浏览器拦了"——原来界面上只有一句"不可用"，
 *   用户无从判断是权限、安全上下文还是云端服务的问题。这三个元素把原因摊开：
 *     capStatus  = 常驻状态徽标（识别中 / 等待说话 / 不可达 / 环境不支持）
 *     capDiagBox = 三段自检报告（安全上下文 / API / 设备），每条带"怎么修"
 *     capManual* = 打字发字幕的兜底通道（ASR 不可用也能记录会议内容） */
const capStatus = $('capStatus');
const capDiagBox = $('capDiagBox');
const capDiagList = $('capDiagList');
const capDiagCloseBtn = $('capDiagCloseBtn');

/* ★ G4 移动端/PWA（第 32 步，2026-09-23）新增元素
 *   sideBtn   = 顶栏"成员/聊天"抽屉开关（≤980px 才显示，桌面侧栏常驻）
 *   sideScrim = 抽屉遮罩（小屏点它关抽屉）
 *   lowBwBtn  = 低带宽模式开关（把所有远端画面锁到 simulcast 最低层） */
const sideBtn = $('sideBtn');
const sideScrim = $('sideScrim');
const lowBwBtn = $('lowBwBtn');
const capManualInput = $('capManualInput');
const capManualSend = $('capManualSend');

/* ★ 09-24（第 33 步，2026-09-24）安全上下文提示横幅元素（与 index.html 一一对应）
 *   起因：用户把网址发到手机 / 别人的电脑，会出现"地址栏不安全 + 摄像头拿不到"两个现象，
 *   看起来像"手机功能没做"，其实根因是浏览器只在安全上下文（https/localhost）才给摄像头。
 *   这一组元素就是把这个原因和两种解法直接摊在页面上（逻辑见文件末尾"第 33 步"）：
 *     insecureBanner  = 横幅容器（默认 .hidden，只在非安全上下文显示）
 *     insecureCloseBtn= 关闭按钮（关闭后写 localStorage，不再自动弹）
 *     ibCmd1 / ibCopy1= 解法①『局域网自签 https』的命令与"复制命令"按钮
 *     ibCmd2 / ibCopy2= 解法②『公网受信任隧道』的命令与"复制命令"按钮 */
const insecureBanner = $('insecureBanner');
const insecureCloseBtn = $('insecureClose');
const ibCmd1 = $('ibCmd1');
const ibCopy1 = $('ibCopy1');
const ibCmd2 = $('ibCmd2');
const ibCopy2 = $('ibCopy2');

/* ──────────────────────────────────────────────────────────────
 * 第 2 步：日志工具
 * ────────────────────────────────────────────────────────────── */
/* ★ 09-19d 架构优化：日志环形上限（400 行）——过夜值守一晚能产生几万行日志，
 *   textContent 无限增长会让页面越跑越卡（每次 += 都整串重建）。
 *   环形剪掉旧行后 scrollTop 仍贴底；剪剩的小字符串替换开销可忽略。 */
const LOG_MAX_LINES = 400;
function log(msg) {
  const time = new Date().toLocaleTimeString();
  logPanel.textContent += `[${time}] ${msg}\n`;
  const lines = logPanel.textContent.split('\n');
  if (lines.length > LOG_MAX_LINES) logPanel.textContent = lines.slice(-LOG_MAX_LINES).join('\n');
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
});

/* ──────────────────────────────────────────────────────────────
 * 第 4 步：打开摄像头 + 麦克风（和 Mesh 版一样）
 * ────────────────────────────────────────────────────────────── */
let localStream = null;
let cameraTrack = null;      // 摄像头视频轨（关/开摄像头时置 enabled）
let sharingScreen = false;   // 当前是否在共享屏幕

async function startLocalMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    cameraTrack = localStream.getVideoTracks()[0];
    localVideo.srcObject = localStream;
    log('✅ 本地媒体就绪（摄像头 + 麦克风）');
    createBtn.disabled = false;
    joinRoomBtn.disabled = false;
    roomInput.disabled = false;
    roomPasswordInput.disabled = false;
    muteBtn.disabled = false;
    camBtn.disabled = false;
    shareBtn.disabled = false;
    recordBtn.disabled = false;   // ★ D5：有媒体才能录
    refreshDeviceList();          // ★ D3：授权之后再列设备（这时 label 才有值）

    // ★ F3（第 25 步）：预览页接入 —— 预览和会议用**同一条 localStream**，
    //   预览页看到的画面就是进会后的画面，不额外 getUserMedia 一路（少一次授权、少占一份设备）
    preVideoEl.srcObject = localStream;
    if (pjStatusEl) pjStatusEl.textContent = '设备就绪，点击「进入会议」';
    startPrejoinMeter(localStream);

    // 邀请链接 ?room=123456：★ F3 起改为"预填房间号"——用户在预览页点「进入会议」后再自动加入。
    //   以前是拿到摄像头立刻自动进房；现在先让用户把设备检查好，更接近真实产品的流程。
    if (pendingRoom) {
      log(`🔗 从链接识别到房间号 ${pendingRoom}，设备检查完成后点「进入会议」自动加入`);
      roomInput.value = pendingRoom;
    }
  } catch (err) {
    /* ★ 09-24（第 33 步）：把"错误名"和"真正原因"分开说 —— 这是本步最容易被忽略的一处。
     *   ⚠️ 坑：http + IP 下 getUserMedia 抛的是 **NotAllowedError**，和"用户点了拒绝"**同名**！
     *   用户一看 NotAllowedError 会以为是自己没授权，跑去系统权限/浏览器权限里白找一圈，
     *   其实真凶是安全上下文（浏览器根本不让他调用设备）。两者必须分开讲。
     *   判断沿用项目既有写法（isSecureContext !== false，桩环境无字段按安全处理）。 */
    const insecure = isInsecureContext();
    if (insecure) {
      log(`❌ 拿不到摄像头/麦克风：${err.name} —— 但真正原因**不是权限**，是安全上下文`);
      log('   当前是 http + IP 访问，浏览器**禁用**了摄像头/麦克风（地址栏的「不安全」也是这个原因）。');
      log('   这不是设备问题，也不是你点了"拒绝"。解法见页面顶部横幅，任选其一：');
      log('   ① 局域网自签 https：npm run start:lan  （浏览器会警告一次，点"高级 → 继续前往"）');
      log('   ② 公网受信任 https：cloudflared tunnel --url http://localhost:3001  （零警告，手机可直接开）');
    } else {
      log(`❌ 拿不到摄像头/麦克风：${err.name}（可在预览页直接进入，稍后重试）`);
    }
    // ★ F3：取不到媒体也允许进房（只订阅别人的画面、不发布自己）——预览页给出提示
    createBtn.disabled = false;
    joinRoomBtn.disabled = false;
    roomInput.disabled = false;
    roomPasswordInput.disabled = false;
    preVideoHintEl.classList.remove('hidden');
    if (pjStatusEl) pjStatusEl.textContent = insecure
      ? '摄像头/麦克风被浏览器禁用（非安全上下文：请用 https 或 localhost —— 见页面顶部提示）'
      : `摄像头/麦克风不可用（${err.name}），可直接进入会议`;
    // 把"解法入口"再露一次：横幅没被关过就弹出来；关过则退成一条 toast 指路（不强行弹回，尊重用户选择）
    if (insecure && !openInsecureNotice()) {
      showToast('⚠️ 摄像头被浏览器禁用（http + IP，非设备问题）——解法见下方「流程日志」', 'error');
    }
  }
}

/* ──────────────────────────────────────────────────────────────
 * 第 5 步：房间面板 —— 创建房间 / 凭号加入（含密码，和 Mesh 版一致）
 * ────────────────────────────────────────────────────────────── */

// 从地址栏读 ?room=123456（脏参数当没有）
const pendingRoom = (() => {
  const r = new URLSearchParams(location.search).get('room');
  return /^\d{6}$/.test(r || '') ? r : null;
})();

let myRoom = null;
// ★ D6 升级：把进房用的密码留一份——断线重连时要拿它重新 join-room（不然有锁的房间回不去）
let myRoomPassword = null;
/* ★ 09-24 C4：我的房间内令牌（roomToken）——进房成功时服务器随 room-members 发给我（游客也有）。
 *   用途：/api/captions、/api/minutes、/minutes/* 这些"会议内容"接口的门禁。
 * ▎生命周期：进房/断线重连（会拿新的）时更新；主动离开房间时清空。
 * ▎安全：它是**只属于我、只对我这个房间有效**的凭证——绝不写进日志、绝不发给别人。
 *   （所以三处 fetch 用请求头带它；只有"导航链接"发不出头，才退而用 ?roomToken=。） */
let myRoomToken = null;
// ★ 09-24 C4：请求头小 helper——有令牌就带上 X-Room-Token，没有就返回空对象（不发坏头）。
//   三处 captions 请求（导出 GET / 归档 POST / 日报 GET）都用它，避免各写一遍、漏一处。
function roomTokenHeader() { return myRoomToken ? { 'X-Room-Token': myRoomToken } : {}; }

function enterRoom(roomNumber) {
  if (myRoom) return; // 已在房间里（room-created 和 room-members 会各触发一次）
  myRoom = roomNumber;
  roomBadge.textContent = `房间号 ${roomNumber}`;
  roomBadge.classList.remove('hidden');
  roomPanel.classList.add('hidden');
  leaveBtn.disabled = false;
  handBtn.disabled = false;   // ★ 09-13：举手不需要摄像头也能用
  boardBtn.disabled = false;  // ★ 09-15 F7：白板同理（数据通道功能，不依赖媒体）
  fxBtn.disabled = false;     // ★ F6：会内滤镜入口（没摄像头时点了会提示，不会崩）
  capBtn.disabled = false;    // ★ 第 29 步：字幕开关（识别不依赖进房，但广播要）
  aiBtn.disabled = false;     // ★ 09-19 AI Bot：邀请助理不依赖媒体（信令功能）
  aiOpBtn.disabled = false;   // ★ 09-19g：AI 操作员入口（授权链路见服务器 ai-op）
  // ★ 09-25 AI 语音：也在这里放开（updateAiVoiceUi 内部会再判浏览器是否支持 speechSynthesis）
  updateAiVoiceUi();
  lowBwBtn.disabled = false;  // ★ 第 32 步：省流开关（订阅了别人画面才有意义，进房后放开）
  log(`🏠 已进入房间「${roomNumber}」。把房间号或右上角链接发给别人即可邀请`);
}

function resetRoomButtons() {
  if (myRoom) return;
  createBtn.disabled = false;
  joinRoomBtn.disabled = false;
  roomInput.disabled = false;
  roomPasswordInput.disabled = false;
}

createBtn.addEventListener('click', () => {
  const password = roomPasswordInput.value.trim();
  myRoomPassword = password || null;   // ★ D6：留着重连用
  log(password
    ? `🏢 正在创建新房间（并设置密码 ${password}）...`
    : '🏢 正在创建新房间...');
  socket.emit('create-room', password ? { password } : {});
  createBtn.disabled = true;
  joinRoomBtn.disabled = true;
});

socket.on('room-created', ({ roomNumber }) => {
  log(`✅ 房间创建成功！你的房间号：${roomNumber}（右上角可点击复制邀请链接）`);
  enterRoom(roomNumber);
});

function tryJoinRoom() {
  const num = roomInput.value.trim();
  if (!/^\d{6}$/.test(num)) {
    log('⚠️ 房间号是 6 位数字，请检查输入');
    return;
  }
  const password = roomPasswordInput.value.trim();
  myRoomPassword = password || null;   // ★ D6：留着重连用
  log(password
    ? `👋 正在加入房间 ${num}（携带密码）...`
    : `👋 正在加入房间 ${num}...`);
  socket.emit('join-room', { roomNumber: num, password });
  createBtn.disabled = true;
  joinRoomBtn.disabled = true;
}

joinRoomBtn.addEventListener('click', tryJoinRoom);
roomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryJoinRoom(); });
roomPasswordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryJoinRoom(); });

socket.on('room-not-found', ({ roomNumber }) => {
  log(`❌ 房间 ${roomNumber || '(空)'} 不存在：可能输错了，或对方已结束会议`);
  resetRoomButtons();
  alert(`房间 ${roomNumber || ''} 不存在，请核对房间号，或直接创建一个新房间`);
});

socket.on('room-wrong-password', ({ roomNumber }) => {
  log(`🔒 房间 ${roomNumber || ''} 需要密码：密码为空或不对，进不去`);
  resetRoomButtons();
  if (!myRoom && roomNumber) {
    roomInput.value = roomNumber;
    roomPasswordInput.focus();
  }
  alert(`房间 ${roomNumber || ''} 需要密码，请输入正确密码后再加入`);
});

socket.on('room-full', ({ max }) => {
  log(`❌ 房间已满（最多 ${max} 人），请稍后再试`);
  resetRoomButtons();
  alert(`房间已满（最多 ${max} 人）`);
});

/* ──────────────────────────────────────────────────────────────
 * 第 6 步：⭐ SFU 媒体初始化（本次架构升级的核心新增）
 *
 * ▎mediasoup 世界里浏览器要做的准备：
 *   ① new mediasoupClient.Device() + device.load(能力)  → "认识这个房间支持什么编码"
 *   ② 建两条通道：createSendTransport / createRecvTransport
 *      → 每条通道在服务器那边都有对应的 WebRtcTransport（第 D 部分 create-webrtc-transport）
 *   ③ 通道握手：浏览器准备好自己的 DTLS 参数后，服务器完成 transport.connect()
 *
 * ▎请求-应答 helper（request）：socket.io 允许 emit 带回调，
 *   服务器答 { data } 或 { error }，这里统一封装成 Promise。
 * ────────────────────────────────────────────────────────────── */

function request(event, payload) {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (resp) => {
      if (!resp) return reject(new Error('服务器无应答（resp 为空）'));
      if (resp.error) return reject(new Error(resp.error));
      resolve(resp); // resp = { data: ... }
    });
  });
}

/* ──────────────────────────────────────────────────────────────
 * 第 2.5 步：★ 09-16 登录/注册（基础功能补全）
 *
 * ▎流程：页面打开先弹登录卡（z 110 盖住预览页）——
 *   · localStorage 里有上次登录态 → 自动 auth-verify 恢复，成功直接进预览页；
 *   · 登录/注册成功 → 身份绑到 socket（服务器把昵称贯通成员列表/聊天气泡）；
 *   · 游客进入 → 跳过，昵称回退"成员 xxxx"。
 * ▎防御：localStorage 在无头测试环境不存在——顶层访问要防御式（坑 25 教训）。
 * ────────────────────────────────────────────────────────────── */
const authStore = (typeof localStorage !== 'undefined') ? localStorage : null;
let myDisplayName = null;      // 我的昵称（发聊天时随 SCTP 消息带出去）

const authOverlay = $('authOverlay');
const authUserEl = $('authUser');
const authPassEl = $('authPass');
const authNameEl = $('authName');
const authMsgEl = $('authMsg');

function showAuthMsg(text, isOk) {
  authMsgEl.textContent = text;
  authMsgEl.classList.toggle('ok', !!isOk);
}
function hideAuth() { authOverlay.classList.add('hidden'); }

function saveAuth(user, token) {
  myDisplayName = user.displayName || user.username;
  myAvatar = user.avatar || null; // ★ 09-26：头像随登录态带回
  if (authStore) authStore.setItem('wb_auth', JSON.stringify({ username: user.username, token }));
  hideAuth();
  log(`👤 已登录：${myDisplayName}`);
    // ★ 09-19h G6：每小时滑动续期（长期值守不掉线；失效则静默回登录态）
    if (window.__authRefreshTimer) clearInterval(window.__authRefreshTimer);
    window.__authRefreshTimer = setInterval(() => {
      const saved = JSON.parse(localStorage.getItem('wb_auth') || '{}');
      if (!saved.token) return;
      socket.emit('auth-refresh', { username: saved.username, token: saved.token }, (resp) => {
        if (resp && resp.error) log('👤 登录态已过期，请重新登录');
      });
    }, 60 * 60 * 1000);
}

async function doAuth(event) {
  const username = authUserEl.value.trim();
  const password = authPassEl.value;
  const displayName = authNameEl.value.trim();
  try {
    const resp = await request(event, { username, password, displayName, avatar: pickedAvatar });
    saveAuth(resp.data.user, resp.data.token);
  } catch (err) {
    showAuthMsg('❌ ' + err.message, false);
  }
}
$('authLoginBtn').addEventListener('click', () => doAuth('auth-login'));
$('authRegisterBtn').addEventListener('click', () => doAuth('auth-register'));
authPassEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth('auth-login'); });
$('authGuestBtn').addEventListener('click', () => {
  hideAuth();
  log('👤 游客模式进入（昵称将显示为"成员 xxxx"，可随时注册）');
});

// 自动恢复登录态：socket.io 会把连接前的 emit 缓冲到连接建立后（不用等 connect 事件）
(async () => {
  try {
    const saved = authStore && JSON.parse(authStore.getItem('wb_auth') || 'null');
    if (!saved || !saved.username || !saved.token) return; // 没存档：停在登录卡
    const resp = await request('auth-verify', saved);
    saveAuth(resp.data.user, saved.token);
  } catch (err) {
    // 存档失效（服务器重启过）：清掉，留在登录卡
    if (authStore) authStore.removeItem('wb_auth');
    showAuthMsg('登录态已失效，请重新登录或游客进入', false);
  }
})();

let device = null;            // mediasoup Device（浏览器端入口）
let sendTransport = null;     // 上传通道（produce 用）
let recvTransport = null;     // 接收通道（consume 用）
let deviceReady = false;
let sfuIceServers = [];       // ★ 09-13：服务器下发的 ICE 服务器（STUN/TURN），initSFU 时拉取
let sfuVideoSvc = false;      // ★ D+3：VP9 SVC 开关（config.json 的 videoSvc 下发）
let sfuAiEnabled = false;     // ★ 09-24：AI 是否接了真模型（服务器只下发布尔值，绝不回显 key）
let sfuHasBot = false;        // ★ 09-25：AI 助理当前是否在会（决定字幕上行快慢，见 capUploadWindow）
let lanUrl = null;            // ★ 09-16：局域网 HTTPS 入口（邀请链接跨电脑用）
const myProducers = new Map(); // producerId -> Producer（我上传的，如屏幕共享要用）

// 给一条 Transport 挂上"connect（握手）"回调
//   mediasoup-client 会在需要时触发，我们负责把它转发成对服务器的 transport-connect 请求
function wireTransport(transport, transportId) {
  transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
    try {
      await request('transport-connect', { transportId, dtlsParameters });
      callback();          // 告诉 mediasoup-client：握手完成，继续
    } catch (err) {
      errback(err);        // 失败则中断
    }
  });
  // ★ D+1：produceData 触发时把 SCTP 流参数交给服务器（和 produce 交 rtpParameters 同理）。
  //   没开 SCTP 的通道不会触发这个事件；接住它，transport.produceData() 才能真正建出来。
  transport.on('producedata', async ({ sctpStreamParameters, label, appData }, callback, errback) => {
    try {
      const resp = await request('produce-data', { transportId, sctpStreamParameters, label, appData });
      callback({ id: resp.data.dataProducerId }); // 回传服务器分配的 dataProducerId
    } catch (err) {
      errback(err);
    }
  });
  transport.on('connectionstatechange', (state) => {
    log(`🔌 通道(${transportId}) 状态变化: ${state}`);
  });
}

async function initSFU() {
  if (deviceReady) return;

  // ① 问服务器要这个房间的 Router 能力，加载进 Device
  const capsResp = await request('get-router-rtp-capabilities', {});
  device = new mediasoupClient.Device();
  await device.load({ routerRtpCapabilities: capsResp.data.rtpCapabilities });
  log('🧩 mediasoup Device 已加载房间能力');

  // ★ 09-13 可达性：向服务器要 ICE 配置（config.json 里的 STUN/TURN），
  //   带进两条 Transport 的底层 RTCPeerConnection——跨网部署时换 TURN 只改配置文件。
  //   /config.json 拿不到也不影响本机演示（浏览器用默认配置直连）。
  try {
    const cfg = await fetch('/config.json').then((r) => r.json());
    if (Array.isArray(cfg.iceServers)) sfuIceServers = cfg.iceServers;
    sfuVideoSvc = !!cfg.videoSvc; // ★ D+3：true = 摄像头改用 VP9 SVC 单路分层上传
    // ★ 09-24 AI 模式：服务器只给 true/false（不给 key），前端据此显示「LLM / Mock」状态灯。
    //   为什么值得显示：用户要能一眼分清"AI 真在思考"还是"在走本地模板"——
    //   把不确定性藏在黑盒里，是最容易被误解为"糊弄"的地方。
    sfuAiEnabled = !!cfg.aiEnabled;
    updateAiModeUi();
    if (cfg.lanUrl) lanUrl = cfg.lanUrl; // ★ 09-16：局域网邀请入口（跨电脑复制链接用）
  } catch (e) { /* 忽略：本机演示不需要 */ }

  // ② 建上传通道：服务器建好 WebRtcTransport 后把参数发回来
  const sendParams = (await request('create-webrtc-transport', { direction: 'send' })).data;
  // 字段名对齐：服务器应答里通道号叫 transportId，而 mediasoup-client 建通道要的参数名是 id
  //   （少做这一步映射，mediasoup-client 会抛 TypeError: missing id）
  sendTransport = device.createSendTransport({ ...sendParams, id: sendParams.transportId, iceServers: sfuIceServers });
  wireTransport(sendTransport, sendParams.transportId);

  // 上传通道的关键事件：mediasoup-client 要 produce 时，把参数交给我们发给服务器
  sendTransport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
    try {
      const resp = await request('produce', {
        transportId: sendParams.transportId,
        kind,
        rtpParameters,
        appData,
      });
      // mediasoup-client 要求回调里回传服务器分配好的 producerId
      callback({ id: resp.data.producerId });
    } catch (err) {
      errback(err);
    }
  });

  // ③ 建接收通道（只用 connect，媒体是 consume 出来的）
  const recvParams = (await request('create-webrtc-transport', { direction: 'recv' })).data;
  recvTransport = device.createRecvTransport({ ...recvParams, id: recvParams.transportId, iceServers: sfuIceServers }); // 同上，transportId → id
  wireTransport(recvTransport, recvParams.transportId);

  deviceReady = true;
  log('🔗 发送/接收两条通道已就绪');
}

/* ──────────────────────────────────────────────────────────────
 * 第 7 步：上传自己（produce）—— 麦克风 + 摄像头各一路
 *
 * ▎和 Mesh 的区别：Mesh 用 pc.addTrack 把轨道塞进"对每个人的连接"；
 *   SFU 只要往"自己唯一的上传通道" produce 一次，服务器负责转给所有人。
 *
 * ▎★ D1 升级（2026-09-11）：摄像头这一路开 **Simulcast（分层编码）**
 *   一次编码出低/中/高三档画面同时发上去（SDP 里用三个 rid = 'q'/'h'/'f' 标识），
 *   服务器按每个订阅者的网络质量只转发其中一层。
 *   面试算账：上传带宽约为三档之和（约 1.5~2.1Mbps），但换来"弱网时服务器替你降级，
 *   不用重协商、不用让对方卡住"——这就是腾讯会议/Zoom 弱网还能开会的核心机制。
 *   ⚠️ 音频不做分层（opus 码率低、收益小，真实产品用别的机制）；
 *      屏幕共享也不做（内容型画面降分辨率会糊掉文字，宁可降帧）。
 * ────────────────────────────────────────────────────────────── */

// simulcast 三档参数：scaleResolutionDownBy = 分辨率缩小倍数（4 = 1/4 边长 → 1/16 像素）
// maxBitrate 是每档的码率上限，服务器随时可以把订阅者从高档切到低档
const SIMULCAST_ENCODINGS = [
  { rid: 'q', maxBitrate: 150000, scaleResolutionDownBy: 4 }, // 低：约 320×180
  { rid: 'h', maxBitrate: 500000, scaleResolutionDownBy: 2 }, // 中：约 640×360
  { rid: 'f', maxBitrate: 1500000, scaleResolutionDownBy: 1 }, // 高：原始分辨率（上限 1.5Mbps）
];

async function publishTracks() {
  // ★ F3：预览页允许"没拿到摄像头也进房"——这时 localStream 为空，只订阅、不发布
  if (!localStream) {
    log('⚠️ 没有本地媒体（预览页已提示），本次只订阅别人的画面、不发布自己');
    return;
  }
  for (const track of localStream.getTracks()) {
    // appData.source 记下这一路是什么（服务器广播时原样带给大家，用于显示名字）
    const source = track.kind === 'audio' ? 'mic' : 'camera';
    let producer;
    if (source === 'camera') {
      /* ★ D+3：三层上传策略由 config.json 的 videoSvc 决定——
       *   false（默认）= Simulcast 三路独立编码（q/h/f 三层，VP8/H264 均可）；
       *   true = **VP9 SVC** 单路编码内部分层（L3T3 = 3 空间 × 3 时间层）。
       * ▎simulcast vs SVC（高水平面试题）：
       *   simulcast 发三路 → 上行带宽 ≈ 三档之和，服务器切层 = 换转发哪路（零解码）；
       *   SVC 发一路 → 上行只有一档码率，服务器切层 = 只转发某些层（同样零解码，
       *   粒度更细、切换更快）。带宽受限上行（手机热点）SVC 占优；兼容性 simulcast 占优。
       * ▎SVC 失败自动回退 simulcast（个别环境不支持 VP9），再回退单层。 */
      try {
        if (!sfuVideoSvc) throw new Error('svc-off'); // 开关没开就走 simulcast 老路
        producer = await sendTransport.produce({
          track,
          encodings: [{ scalabilityMode: 'L3T3', maxBitrate: 1500000, scaleResolutionDownBy: 1 }],
          codecOptions: { videoGoogleStartBitrate: 1000 },
          appData: { source },
        });
        log('📤 已上传摄像头（VP9 SVC · L3T3 单路三层）');
      } catch (err) {
        if (err.message !== 'svc-off') log(`⚠️ SVC 协商失败（${err.message}），回退 simulcast`);
        try {
          // ★ D1：摄像头上传带 encodings（三档）；codecOptions 顺手把起始码率压低一点，
          //   让它平稳爬升（真实调优参数，教学版给个合理默认值）
          producer = await sendTransport.produce({
            track,
            encodings: SIMULCAST_ENCODINGS,
            codecOptions: { videoGoogleStartBitrate: 1000 },
            appData: { source },
          });
          log(`📤 已上传摄像头（Producer ${producer.id}，simulcast ${SIMULCAST_ENCODINGS.length} 层：低/中/高）`);
        } catch (err2) {
          // 兜底：个别环境/编码器不支持 simulcast → 退回单层上传，功能不受影响
          log(`⚠️ simulcast 协商失败（${err2.message}），退回单层上传`);
          producer = await sendTransport.produce({ track, appData: { source } });
          log(`📤 已上传摄像头（Producer ${producer.id}，单层）`);
        }
      }
      myProducers.set(producer.id, producer);
    } else {
      producer = await sendTransport.produce({ track, appData: { source } });
      log(`📤 已上传 ${track.kind === 'audio' ? '麦克风' : '摄像头'}（Producer ${producer.id}）`);
    }
    myProducers.set(producer.id, producer);
  }
}

/* ──────────────────────────────────────────────────────────────
 * 第 8 步：⭐ 订阅别人（consume）—— 把远端媒体变成画面
 *
 * ▎数据结构（对应 Mesh 版的 peers 字典，但含义变了）：
 *   tiles    : Map<"对方id::producerId", {box, video}>  → 屏幕上每一格
 *   peerMains: Map<对方id, {video, stream}>             → 每个成员的"主画面"
 *              （把该成员的麦克风 + 摄像头并进同一条 MediaStream，
 *                声音和画面一起在主页面上播放）
 *   peersSeen: Set<对方id> → 只用于算"房间人数"
 * ────────────────────────────────────────────────────────────── */
const tiles = new Map();          // key -> { box, video }
const peerMains = new Map();      // 对方id -> { video, stream, box }（box 给远程协助角标/控制层用）
const peerScreens = new Map();    // ★ 远程协助（第 14 步）：对方id -> 他的"屏幕共享"格 { box, video }
                                  //   控制层的坐标基准是"他的屏幕画面"，所以要单独记住这格
const consumedProducers = new Set(); // 已订阅过的 producerId（防止重复订阅）
const peersSeen = new Set();      // 见到的远端成员
const pendingSubscriptions = [];  // 通道没建好时收到的订阅请求，先排队（见 subscribe）

/* ★ D1 升级（2026-09-11）：consumerId → 画面格 的索引
 * ▎为什么需要它？服务器换层时发来的消息是 { consumerId, spatialLayer }（服务器只知道 Consumer），
 *   要更新 UI 就得把"服务器视角的 Consumer"翻译成"我屏幕上哪一格"，这张表就是这个翻译字典。
 *   同理 AudioLevelObserver 只给 producerId，要翻成"哪个人"（服务器端有 producerOwner 表）。 */
const consumerTiles = new Map(); // consumerId -> tile（{box, video, ...}）

// 在视频网格里现场造一格（HTML 里没有，用 JS 动态插入）
function ensureTile(key, label) {
  if (tiles.has(key)) return tiles.get(key);
  const box = document.createElement('div');
  box.className = 'video-box';
  box.innerHTML =
    `<video autoplay playsinline></video>` +
    `<div class="video-label">${escapeHtml(label)}</div>` +
    // ★ D2：音量条（说话时才显示，宽度 = 服务器量到的音量）
    `<div class="vol-bar"><i></i></div>`;
  // ★ F1（第 26 步）：双击这格 = 全屏（toggleFullscreen 是函数声明，有提升，这里直接用）
  box.addEventListener('dblclick', () => toggleFullscreen(box));
  videoGrid.appendChild(box);
  const video = box.querySelector('video');
  tiles.set(key, { box, video });
  return tiles.get(key);
}

// ★ 远程协助（第 14 步）：给一个视频格加「请求控制」按钮。
//   点它 = 申请控制"这个成员"（remote-request 发给的是人，不是某一路流）
function addCtlBtn(box, remoteId) {
  if (box.querySelector('.remote-ctl-btn')) return; // 幂等：已有按钮不重复加
  const btn = document.createElement('button');
  btn.className = 'remote-ctl-btn';
  btn.title = '请求远程控制该成员';
  btn.textContent = '🖱️ 请求控制';
  btn.addEventListener('click', () => requestRemoteControl(remoteId));
  box.appendChild(btn);
}

// ★ F1（第 26 步）：给主画面格加「钉选」按钮（左上角，和右上角的「请求控制」对称）
function addPinBtn(box, remoteId) {
  // 幂等：用 dataset 做标记（比查 DOM 更稳：一格只加一次，重复订阅同一成员也不会叠按钮）
  if (box.dataset.pinBtn) return;
  box.dataset.pinBtn = '1';
  const btn = document.createElement('button');
  btn.className = 'pin-btn';
  btn.title = '钉选到演讲者视图大画面（再点一次取消）';
  btn.textContent = '📌 钉选';
  btn.addEventListener('click', () => togglePin(remoteId));
  box.appendChild(btn);
}

// 把订阅到的一路媒体"放上画面"
function attachRemoteMedia(from, source, kind, consumer, key) {
  const track = consumer.track;
  let tile;

  if (source === 'mic' || source === 'camera') {
    // 主画面：这个成员的 摄像头画面 + 麦克风声音 放同一格
    let main = peerMains.get(from);
    if (!main) {
      tile = ensureTile(key, `成员 ${shortId(from)}`);
      // ★ 远程协助：主画面格右上角挂「请求控制」按钮（每个成员必有主画面格，按钮放这最稳）
      addCtlBtn(tile.box, from);
      // ★ F1：主画面格左上角挂「钉选」按钮
      addPinBtn(tile.box, from);
      main = { video: tile.video, stream: new MediaStream(), box: tile.box };
      peerMains.set(from, main);
    } else {
      /* ★ 09-18 实修：复用分支必须按 box 找回"这个成员的主画面格"。
       *   原写法按 key 前缀抓第一格——若他还有屏幕共享格（先订阅），会抓到屏幕格
       *   并把它的 tile.source 改写成 camera（元数据腐蚀：选层/换层通知全部指错格子，
       *   "关摄像头再开"场景必踩）。key 里的 producerId 会变，box 才是稳定锚点。 */
      tile = [...tiles.values()].find((t) => t.box === main.box) || { box: main.box, video: main.video };
    }
    main.stream.addTrack(track);        // 把轨道并进这个成员的总流
    main.video.srcObject = main.stream; // 重新赋一次让浏览器播放
    // 万一主画面格还没建（只有麦克风），这里 ensureTile 会用本 key 建格；ok
  } else {
    // 屏幕共享 = 单独一格（不混进摄像头画面里）
    tile = ensureTile(key, `成员 ${shortId(from)} 的屏幕`);
    const stream = new MediaStream([track]);
    tile.video.srcObject = stream;
    peerScreens.set(from, tile); // ★ 远程协助：记住"他的屏幕"在哪格（控制层要盖在这上面）
    setupAnnotOverlay(tile, from); // ★ 09-14 F5：屏幕格上盖一层"协作批注"画布 + 工具条
  }

  /* ★ D1 升级：把"服务器视角的 consumer"和"我屏幕上的这一格"登记进索引
   *   serverConsumerId 用来接收换层通知；videoConsumerId 记下这一格的"视频"是哪个 consumer
   *   （一格里可能先后并进音频/视频两路，选层只关心视频那一路）。 */
  if (tile) {
    consumerTiles.set(consumer.id, tile);
    tile.from = from;
    tile.source = source;
    if (kind === 'video') tile.videoConsumerId = consumer.id;
    if (source === 'screen') tile.screenConsumerId = consumer.id;
  }

  peersSeen.add(from);
  updateMemberCount();
  applyLayout(); // ★ F1：新画面出现后重算布局（演讲者视图的大画面可能要换人格子）
  log(`🖥️ 已显示 ${shortId(from)} 的 ${source === 'screen' ? '屏幕' : kind}`);
}

// 订阅一个 Producer：先问服务器建 Consumer，再用返回参数本地收货
async function subscribe(from, producerId, kind, source) {
  const key = `${from}::${producerId}`;
  if (consumedProducers.has(key)) return; // 防重复订阅
  consumedProducers.add(key);

  // 竞态防护：通道还没建好就先收到"新 Producer"通知 → 排队，等 init 完再补订
  if (!recvTransport) {
    log(`⏳ 通道未就绪，先把 ${shortId(from)} 的 ${kind}(${source}) 加入待订阅队列`);
    pendingSubscriptions.push({ from, producerId, kind, source });
    return;
  }

  try {
    const resp = await request('consume', {
      transportId: recvTransport.id,
      producerId,
      rtpCapabilities: device.rtpCapabilities, // 我的接收能力，服务器判断能不能转给我
    });
    const { consumerId, rtpParameters } = resp.data;
    // 本地收货：把服务器 Consumer 参数交给 mediasoup-client，得到可播放的 track
    const consumer = await recvTransport.consume({
      id: consumerId, producerId, kind, rtpParameters,
    });
    try { await consumer.resume(); } catch (e) { /* 本地 resume 失败可忽略 */ }
    attachRemoteMedia(from, source, kind, consumer, key);
  } catch (err) {
    log(`⚠️ 订阅 ${shortId(from)} 失败：${err.message}`);
  }
}

// 辅助函数：socket id 取后 4 位当名字；HTML 转义防 XSS（同 Mesh 版）
function shortId(id) { return id.slice(-4); }
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function updateMemberCount() {
  memberCount.textContent = `${1 + peersSeen.size} 人`;
}

/* ──────────────────────────────────────────────────────────────
 * 进房后主流程（room-members 一到就执行）：
 *   建通道 → 上传自己 → 订阅房间里已有的老成员媒体
 * ────────────────────────────────────────────────────────────── */
socket.on('room-members', ({ roomNumber, members, roomToken }) => {
  // ★ 09-24 C4：进房成功时服务器**单播给我自己**的房间内令牌（游客也有；重连后会换新，直接覆盖）
  if (roomToken) myRoomToken = roomToken;
  enterRoom(roomNumber);
  /* ★ 09-25：进房后拉一次看板全量——ai-board 是推模式，晚进房/刷新页面的人
   *   会错过之前所有广播，不拉就是一块空板。（推保实时，拉保完整。） */
  requestBoard();

  (async () => {
    if (initializing) return;      // 防并发：重连与首次进房若撞在一起，只跑一次
    initializing = true;
    try {
      // ★ D6 重连：如果是"断线后重回房间"，先把上一轮的 Device/Transport/画面全部作废，
      //   否则会在已经死掉的通道上 produce（报错 "Transport closed"），画面永远回不来。
      if (reconnecting) resetMediaState();

      await initSFU();          // 第 6 步：Device + 两条通道
      await publishTracks();    // 第 7 步：上传麦克风 + 摄像头
      await setupDataChannel(); // ★ D+1 第 27 步：开我的 SCTP 广播频道（失败自动退回信令聊天）
      // 订阅老成员：room-members 里带了他们每人的 Producer 清单
      for (const m of members) {
        log(`🏠 房间里有老成员 ${shortId(m.id)}，订阅他的 ${m.producers.length} 路媒体...`);
        for (const p of m.producers) {
          await subscribe(m.id, p.producerId, p.kind, (p.appData && p.appData.source) || 'camera');
        }
        // ★ D+1：老成员的 SCTP 数据通道（聊天广播频道）也要一并订阅
        for (const dp of m.dataProducers || []) {
          await subscribeData(m.id, dp.dataProducerId);
        }
      }
      // 把"通道没建好时"排队等的订阅请求补上（竞态防护）
      for (const item of pendingSubscriptions.splice(0)) {
        await subscribe(item.from, item.producerId, item.kind, item.source);
      }
      for (const item of pendingDataSubs.splice(0)) { // ★ D+1：数据通道的排队补订
        await subscribeData(item.from, item.dataProducerId);
      }
      // ★ D4：进房/重连成功后，把我的状态上报一次（成员列表马上就有我的徽标）
      reportMyState({
        muted: !(localStream && localStream.getAudioTracks()[0] && localStream.getAudioTracks()[0].enabled),
        camOff: !(cameraTrack && cameraTrack.enabled),
        sharing: sharingScreen,
      });
      if (reconnecting) {
        reconnecting = false;
        showToast('✅ 已重连回房间，媒体链路已重建');
        log('🎉 重连完成：Device/Transport 已重建，自己已重新上传并订阅了老成员');
      } else {
        log('🎉 媒体链路就绪：自己已上传，老成员画面即将出现');
      }
    } catch (err) {
      log(`❌ 媒体初始化失败：${err.message}（刷新重试）`);
    } finally {
      initializing = false;
    }
  })();
});

/* ★ D6 升级（2026-09-11）：断线重连的状态机
 * ▎socket.io 自带"自动重连"：网络抖动/服务器重启后它会自己重连，但**会换一个新的 socket.id**，
 *   而服务器那边的房间成员、Transport、Producer 全都是按旧 id 挂在旧连接上的——
 *   重连后等于"新人进房"，必须把媒体链路整条重建。
 * ▎所以"重连"在 SFU 里 = ① 重新 join-room ② 重建 Device/两条 Transport
 *   ③ 重新 produce 自己的轨道 ④ 重新 consume 别人的（服务器 room-members 会给清单）。
 * ▎⚠️ 已知边界（写进文档、面试可讲）：如果房间里只剩我一个人，掉线时房间会被销毁、
 *   房间号回收，重连会拿到 room-not-found——真实产品会给房间加 TTL 或让房主迁移。
 */
let initializing = false;  // 媒体初始化进行中（防并发）
let reconnecting = false;  // 我正处于"断线重连"流程中
let leaving = false;       // ★ 主动离开（点「离开房间」/被踢）：别把"主动断"当成"掉线"去重连

socket.on('disconnect', (reason) => {
  log(`⚠️ 与服务器断开（${reason}），socket.io 会自动尝试重连...`);
  connBadge.textContent = '重连中…';
  connBadge.className = 'badge medium';
  if (myRoom && !leaving) {
    reconnecting = true; // 标记：下次 room-members 到达时要先重建媒体链路
  }
});

// 重连成功后的第一件事：重新进房（房间号 + 密码要留着，所以单独存一份）
socket.on('connect', () => {
  if (!reconnecting || !myRoom) return;
  log(`🔁 已重连（新 id ${shortId(socket.id)}），正在重新进入房间 ${myRoom}...`);
  connBadge.textContent = '已连服务器';
  connBadge.className = 'badge connected';
  socket.emit('join-room', { roomNumber: myRoom, password: myRoomPassword });
});

// 重置媒体状态：重连时把"上一轮"的东西全部作废（不清本地摄像头，只清与服务器相关的一切）
function resetMediaState() {
  for (const p of myProducers.values()) { try { p.close(); } catch (e) { /* 已关就忽略 */ } }
  myProducers.clear();
  for (const [key, tile] of tiles) {
    if (tile.video.srcObject) tile.video.srcObject.getTracks().forEach((t) => t.stop());
    tile.box.remove();
    tiles.delete(key);
  }
  consumerTiles.clear();
  layerState.clear();
  peerMains.clear();
  peerScreens.clear();
  peersSeen.clear();
  consumedProducers.clear();
  pendingSubscriptions.length = 0;
  // ★ D+1：上一轮的 SCTP 数据通道全部作废（重连后第 27 步会重新 produceData/consumeData）
  try { if (chatDataProducer) chatDataProducer.close(); } catch (e) { /* 已关就忽略 */ }
  chatDataProducer = null;
  try { if (annotDataProducer) annotDataProducer.close(); } catch (e) { /* 同上 */ }
  annotDataProducer = null;
  try { if (boardDataProducer) boardDataProducer.close(); } catch (e) { /* 同上 */ }
  boardDataProducer = null;
  boardStrokes.length = 0; // 白板账本随重连作废（全房同步重置由"清空"广播或重进房完成）
  for (const dc of dataConsumers.values()) { try { dc.close(); } catch (e) { /* 同上 */ } }
  dataConsumers.clear();
  pendingDataSubs.length = 0;
  seenChatIds.clear();
  recordingsByMember.clear(); // ★ D+2：重连后录制会话全失效（服务器侧 Transport 已随断连销毁）
  try { if (sendTransport) sendTransport.close(); } catch (e) { /* 服务器已清，忽略 */ }
  try { if (recvTransport) recvTransport.close(); } catch (e) { /* 同上 */ }
  sendTransport = null;
  recvTransport = null;
  device = null;
  deviceReady = false;
  // ★ F1/F2：上一轮的钉选/说话人/网络点数据全部作废（重连后按新状态重算）
  pinnedId = null;
  currentSpeakerId = null;
  pendingSpeakerId = null; // ★ 09-18：演讲人交接的候选计时一并作废（重连后重新开始统计）
  pendingSpeakerSince = 0;
  netLevelsById.clear();
  updateMemberCount();
  applyLayout();
  log('♻️ 已清空上一轮的媒体状态（等待重建通道）');
}

// 有人新上传了一路媒体（比如新成员进房后上传了摄像头，或有人开始共享屏幕）
socket.on('new-producer', ({ producerId, kind, appData, from }) => {
  if (from === socket.id) return; // 自己上传的不管（本地已有）
  const source = (appData && appData.source) || 'camera';
  log(`📨 收到通知：${shortId(from)} 新上传一路 ${kind}（${source}）`);
  subscribe(from, producerId, kind, source);
});

// 有人停止了某一路（比如停止共享屏幕）：把这格画面删掉
socket.on('producer-closed', ({ producerId }) => {
  removeTilesOfProducer(producerId);
});

// ★ D+1：有人新开了 SCTP 数据通道（进房后 produceData 会广播这条）→ 订阅它
socket.on('new-data-producer', ({ dataProducerId, from }) => {
  if (from === socket.id) return; // 自己的频道不用订（mediasoup 不会把你的消息回给你）
  subscribeData(from, dataProducerId);
});

// ★ D+1：某人的数据通道关了 → 把订阅它的 DataConsumer 关掉（防泄漏）
socket.on('data-producer-closed', ({ dataProducerId }) => {
  for (const [id, dc] of dataConsumers) {
    if (dc.dataProducerId === dataProducerId) {
      try { dc.close(); } catch (e) { /* 已关就忽略 */ }
      dataConsumers.delete(id);
    }
  }
});

// 我订阅的某一路被服务器关掉（上游 Producer 关闭）→ 同步删画面
socket.on('consumer-closed', ({ producerId }) => {
  removeTilesOfProducer(producerId);
});

// 把属于某个 Producer 的所有画面格删掉（producer-closed / consumer-closed 共用）
function removeTilesOfProducer(producerId) {
  for (const key of [...tiles.keys()]) {
    if (key.endsWith(`::${producerId}`)) {
      const tile = tiles.get(key);
      if (tile.video.srcObject) tile.video.srcObject.getTracks().forEach((t) => t.stop());
      tile.box.remove();
      tiles.delete(key);
      // ★ 远程协助：删的若是"某人的屏幕格"，同步清记录（key 格式 = "对方id::producerId"）
      const from = key.split('::')[0];
      if (peerScreens.get(from) === tile) peerScreens.delete(from);
      // ★ D1：consumer → 格子 的索引也要清（否则换层通知会往已删除的格子上写）
      for (const [cid, t] of consumerTiles) {
        if (t === tile) { consumerTiles.delete(cid); layerState.delete(cid); }
      }
    }
  }
  updateMemberCount();
  applyLayout(); // ★ F1：被删的可能正是大画面，重算一次（钉的人还在就换他别路的流，不在就回退）
}

// 有人离开房间：删掉他所有画面
socket.on('peer-left', ({ id }) => {
  log(`👋 成员 ${shortId(id)} 已离开，清理他的画面`);
  for (const key of [...tiles.keys()]) {
    if (key.startsWith(`${id}::`)) {
      const tile = tiles.get(key);
      tile.box.remove();
      tiles.delete(key);
    }
  }
  peerMains.delete(id);
  peerScreens.delete(id);
  peersSeen.delete(id);
  updateMemberCount();
  // ★ F1：离开的人可能正被钉选/正在说话——大画面的记忆要清掉，否则指向不存在的格子
  if (pinnedId === id) pinnedId = null;
  if (currentSpeakerId === id) currentSpeakerId = null;
  netLevelsById.delete(id); // ★ F2：他的网络点数据也没意义了
  applyLayout();
  cleanupRemoteCtrlForPeer(id); // ★ 远程协助：他卷入的控制关系作废（第 14 步）
});

/* ──────────────────────────────────────────────────────────────
 * 第 9 步：屏幕共享 —— SFU 里 = "再加一路 Producer"
 *
 * ▎和 Mesh 版最大的区别（面试讲点）：
 *   Mesh：replaceTrack 把摄像头轨换成屏幕轨（同一路，二选一）；
 *   SFU ：摄像头 Producer 不动，另开一路 screen Producer，
 *        服务器分别转给所有人 —— 所以共享时摄像头还开着，更接近真实产品。
 * ────────────────────────────────────────────────────────────── */
shareBtn.addEventListener('click', async () => {
  if (!cameraTrack) return;
  shareBtn.disabled = true;

  try {
    if (!sharingScreen) {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      const screenTrack = screenStream.getVideoTracks()[0];
      screenTrack.onended = () => stopSharing(); // 用户点系统"停止共享"

      const screenProducer = await sendTransport.produce({
        track: screenTrack,
        appData: { source: 'screen' },
      });
      myProducers.set(screenProducer.id, screenProducer);

      sharingScreen = true;
      setIconBtn(shareBtn, ICONS.screen, '停止共享');
      camBtn.disabled = true;
      // ★ 09-14 F5：给自己也开一个"我的屏幕"格——① 我能确认观众看到什么；
      //   ② 协作批注的"共享者视角落点"（别人在我屏幕上画，我实时看见）。
      addSelfScreenTile(screenTrack);
      // ★ 远程协助（第 14 步）：共享中出现「允许远程协助」开关。
      //   共享者主动开 = 最像真实产品；不共享 = 没有"可被控的桌面"，
      //   申请会被被控端自动拒绝（reason: not-sharing，见第 14 步）
      assistBtn.classList.remove('hidden');
      assistBtn.disabled = false;
      reportMyState({ sharing: true }); // ★ D4：成员列表要显示"谁在共享"
      log('🖥️ 已开始共享屏幕！其他人会看到你的屏幕（摄像头仍在发）');
    } else {
      stopSharing();
    }
  } catch (err) {
    log(`⛔ 取消或无法共享屏幕：${err.name}`);
    shareBtn.disabled = false;
  }
});

async function stopSharing() {
  if (!sharingScreen) return;
  // ★ 远程协助（第 14 步）：不共享 = 不再存在"可被控的桌面" → 自动关协助
  //   turnOffAssist 内部会：结束进行中的控制 + 收工作台 + 复位开关 UI
  if (assistOn) turnOffAssist();
  assistBtn.classList.add('hidden');
  assistBtn.disabled = true;
  // 找到屏幕那一路 Producer，关掉（服务器会广播 producer-closed，别人自动删画面）
  for (const [id, p] of myProducers) {
    if (p.appData && p.appData.source === 'screen') {
      try { await request('close-producer', { producerId: id }); } catch (e) { /* 忽略 */ }
      p.close();
      myProducers.delete(id);
    }
  }
  sharingScreen = false;
  setIconBtn(shareBtn, ICONS.screen, '共享屏幕');
  camBtn.disabled = false;
  removeSelfScreenTile(); // ★ 09-14 F5：撤掉"我的屏幕"格
  reportMyState({ sharing: false }); // ★ D4：同步"我不再共享了"
  log('📷 已停止共享屏幕');
}

/* ──────────────────────────────────────────────────────────────
 * 第 10 步：控制按钮 —— 静音 / 关摄像头 / 离开
 * （和 Mesh 版一样：不改 Producer，只开关轨道的 enabled）
 * ────────────────────────────────────────────────────────────── */
muteBtn.addEventListener('click', () => {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    audioTrack.enabled ? setIconBtn(muteBtn, ICONS.mic, '静音') : setIconBtn(muteBtn, ICONS.micOff, '取消静音');
    log(audioTrack.enabled ? '🔊 声音已开启' : '🔇 已静音');
    reportMyState({ muted: !audioTrack.enabled }); // ★ D4：告诉大家"我静音了"（成员列表要显示）
  }
});

camBtn.addEventListener('click', () => {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    videoTrack.enabled ? setIconBtn(camBtn, ICONS.cam, '关摄像头') : setIconBtn(camBtn, ICONS.camOff, '开摄像头');
    log(videoTrack.enabled ? '📷 摄像头已开启' : '🚫 摄像头已关闭');
    reportMyState({ camOff: !videoTrack.enabled }); // ★ D4：同步"我关了摄像头"
  }
});

leaveBtn.addEventListener('click', () => {
  leaving = true;        // ★ D6：主动离开不算断线，别触发重连流程
  myRoomToken = null;    // ★ 09-24 C4：离房即弃令牌（令牌只对"还在房里"有意义）
  socket.disconnect();   // 服务器端会释放 Transport/Producer/Router 资源
  location.reload();
});

// 复制邀请链接
roomBadge.addEventListener('click', async () => {
  if (!myRoom) return;
  // ★ 09-16 局域网交付：服务器机自己用 localhost 访问时，复制的链接别的电脑打不开——
  //   此时改用 /config.json 下发的局域网 HTTPS 入口（announcedIp + HTTPS 端口）
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  const base = (isLocal && lanUrl) ? lanUrl : location.origin;
  const link = `${base}/?room=${myRoom}`;
  try {
    await navigator.clipboard.writeText(link);
    log(`📋 邀请链接已复制（发给同一 WiFi 下的另一台电脑，浏览器打开即可）：${link}`);
    showToast('📋 邀请链接已复制——微信/QQ 发给对方，打开即入会', 'info');
  } catch (err) {
    log(`📋 自动复制失败，请手动复制：${link}`);
  }
});

/* ──────────────────────────────────────────────────────────────
 * 第 11 步：聊天 —— ★ D+1 起走"双路径"：SCTP 数据通道为主 + 信令广播兜底
 *
 * ▎为什么改？原来聊天全走服务器广播（方案 A）——能跑，但消息和"媒体连接"是两条路。
 *   D+1 把 SCTP 数据通道开起来后，聊天主路改走 mediasoup 的 DataProducer/DataConsumer：
 *   和音视频同一条 DTLS/ICE 链路，服务器只转发、不用 socket.io 扛消息。
 *
 * ▎为什么还要"兜底"？数据通道建立是异步的（晚到的人要先 consumeData），
 *   建立/订阅完成前的消息会丢——所以每条消息同时走两条路，接收端按 msgId 去重。
 *   这是工程上常见的"双发去重"做法（面试讲点：at-least-once + 幂等接收）。
 * ────────────────────────────────────────────────────────────── */
socket.on('ai-state', ({ state, text }) => setAiState(state, text)); // ★ 09-26b：text 供逐字字幕

socket.on('chat-message', ({ from, text, ts, msgId, name, ai, streamId }) => {
  // ★ D+1：同一条消息可能从 SCTP 和信令各到一次，msgId 相同的只显示第一条
  if (msgId && seenChatIds.has(msgId)) return;
  if (msgId) markSeenChatId(msgId);
  /* ★ 09-25：语音播报放在**去重判断之前**——因为流式回答的终态会在下一行被 early-return
   *   丢掉（增量已渲染过），若把播报放在 appendChat 里，流式答案就永远不会被念出来。
   *   这类"顺序错了功能静默失效"的坑，只能靠把它写在注释里记住。 */
  if (from === 'ai-bot') speakAiText(text);
  // ★ 09-24：带 streamId 的是流式回答的"终态"——增量已经在同一个气泡里渲染过了，
  //   这里再插一条就是两遍。（终态仍然必要：给中途进房/丢过流事件的人兜底）
  if (streamId && aiStreamDone.has(streamId)) return;
  appendChat(text, from, from === socket.id, 'signaling', name, ai);
});

/* ══════════════════════════════════════════════════════════════
 * ★ 09-24 AI 会议助理 · 三段式：状态灯 / 流式打字机 / 纪要入口
 * ▎状态灯：服务器只发得出 aiEnabled 布尔值（密钥绝不下发），前端据此标注当前处于
 *   LLM 还是 [Mock]——把"AI 现在到底在不在真跑"摊开写，是诚实的 UI。
 * ▎打字机：ai-stream 增量渲染。为什么要流？一次性回答要等模型憋完（常见 3~8 秒），
 *   用户会以为卡死；逐字吐出后哪怕首字要等 1 秒，也是"它在动"的确定信号。
 * ▎纪要入口：字幕账本的产物一键变成 markdown 纪要（/minutes 下载）。
 * ══════════════════════════════════════════════════════════════ */
function updateAiModeUi() {
  const btn = $('aiBtn');
  if (!btn) return;                       // 还没渲染到按钮时安全返回（首屏早于 DOM 就绪）
  btn.dataset.aiMode = sfuAiEnabled ? 'LLM' : 'Mock';
  btn.classList.toggle('ai-mock', !sfuAiEnabled);
  btn.title = sfuAiEnabled
    ? '邀请 AI 助理入会（已接 DeepSeek 真模型：全档字幕检索 + 多轮记忆 + 意图理解；聊天里 @ai 提问、@ai 生成纪要）'
    : '邀请 AI 助理入会（未配置 DEEPSEEK_API_KEY → 走本地 [Mock] 规则，检索与记忆照常可用）';
}

const aiStreamNodes = new Map();   // streamId -> 正在打字中的气泡 DOM
const aiStreamDone = new Set();    // 已靠增量渲染完成的 streamId（终态消息据此去重）
const streamTraces = new Map();    // ★ 09-24e streamId -> 待补的"检索过程"文字（done 帧到达时插入气泡）
const streamHits = new Map();      // ★ 09-25 streamId -> 待补的"证据原话"列表（同上）

socket.on('ai-stream', ({ id, delta, done, mock, trace, hitList }) => {
  let box = aiStreamNodes.get(id);
  if (trace) streamTraces.set(id, String(trace).slice(0, 200));   // 元信息先存着，done 时插入
  if (hitList) streamHits.set(id, hitList);                       // ★ 09-25：证据原话同样先存后插
  if (!box) {
    const node = document.createElement('div');
    node.className = 'msg';
    node.classList.add('bot', 'streaming');
    // ★ 09-24 实修：气泡的子节点**各自持有引用**，不用 querySelector 反复查——
    //   ① 少一次选择器开销（每条增量都查的话，长答案就是几百次无关遍历）；
    //   ② 无头回归里 querySelector 拿不到真子节点（它只能返回缓存占位元素），断言会失真。
    const nameEl = document.createElement('div');
    nameEl.className = 'msg-name';
    nameEl.innerHTML = '🤖 AI 助理<span class="msg-via">AI</span>';
    const textEl = document.createElement('div');
    textEl.className = 'msg-text typing';
    const timeEl = document.createElement('div');
    timeEl.className = 'msg-time';
    timeEl.textContent = new Date().toLocaleTimeString();
    node.appendChild(nameEl);
    node.appendChild(textEl);
    node.appendChild(timeEl);
    chatList.appendChild(node);
    while (chatList.children.length > 300) chatList.firstChild.remove();
    chatList.scrollTop = chatList.scrollHeight;
    box = { node, nameEl, textEl };
    aiStreamNodes.set(id, box);
  }
  if (delta) {
    box.textEl.classList.remove('typing');
    box.textEl.textContent += delta;          // textContent 而非 innerHTML：增量是远程文本，天然免疫 XSS
    chatList.scrollTop = chatList.scrollHeight;
  }
  if (done) {
    box.node.classList.remove('streaming');
    const mode = mock ? 'Mock' : 'LLM';
    box.nameEl.innerHTML += `<span class="msg-ai-mode${mock ? ' mock' : ''}" title="这条答案由${mock ? '本地规则（未接 LLM）' : 'DeepSeek 模型'}生成">${mode}</span>`;
    /* ★ 09-24e：流式终态也把"检索过程"补上（增量渲染时还不知道这些元信息，
     *   服务器在 done 帧里一起送来）。注意 trace 挂在 bubble 上、**不在 textEl 里**——
     *   因为 textEl 是逐字累加的正文，往里塞 HTML 会破坏打字机与文本一致性。 */
    const t = streamTraces.get(id);
    if (t) {
      const traceEl = document.createElement('div');
      traceEl.className = 'msg-ai-trace';
      traceEl.title = 'AI 得出这条答案的中间过程（可验证，非黑箱）';
      traceEl.textContent = t;
      box.node.insertBefore(traceEl, box.textEl);
      streamTraces.delete(id);
      /* ★ 09-25：紧跟着插入"可展开的证据原话"——trace 只说"取了几条"，
       *   details 让用户能真的看到那几条是什么（数字 → 事实）。 */
      const evHtml = traceEvidenceHtml(null, streamHits.get(id));
      if (evHtml) {
        const evEl = document.createElement('div');
        evEl.className = 'msg-ai-ev-wrap';
        evEl.innerHTML = evHtml;
        box.node.insertBefore(evEl, box.textEl);
        streamHits.delete(id);
      }
    }
    aiStreamNodes.delete(id);
    aiStreamDone.add(id);
    if (aiStreamDone.size > 60) aiStreamDone.delete(aiStreamDone.values().next().value); // 环形，防长会内存涨
  }
});

function appendChat(text, sender, isMe, via, name, ai) {
  const item = document.createElement('div');
  if (sender === 'system') {
    item.className = 'msg system';
    item.innerHTML = `<div class="msg-text">${escapeHtml(text)}</div>`;
  } else if (sender === 'ai-bot') {
    // ★ 09-19 AI Bot 的气泡（徽标一眼区分机器同事）+ ★ 09-24 mode/tokens/纪要下载三类元信息
    //   mode 由服务器逐条告知（这条答案到底谁写的），比前端猜更准——
    //   因为调用过程中可能中途降级：看着像 LLM 的一次会话，某一条其实走了 Mock。
    // （classList.add 而非纯 className 字符串——冒烟桩的 classList 与 className 不同步，坑 27 同源）
    const mode = ai ? (ai.mock ? 'Mock' : 'LLM') : (sfuAiEnabled ? 'LLM' : 'Mock');
    const meta = ai && ai.tokens ? `<span class="msg-ai-tok" title="本次调用的 token 用量">${ai.tokens}t</span>` : '';
    /* ★ 09-24e 把"AI 是怎么得出这条答案的"摊开给用户看：
     *   · 检索自 N 条字幕中的 M 条 → 证明它**真的查了会议记录**，不是凭空编
     *   · 第 N 轮追问 → 让用户知道它有上下文记忆
     *   · 意图标签 → 让"它把我的话理解成了什么"可被纠正（理解错了用户能立刻发现）
     *   为什么值得做：AI 最大的信任问题是"不可验证"。把中间过程暴露出来，
     *   用户才能判断该不该信这条答案——这是产品诚实的核心，也是本项目的 AI 叙事里
     *   最有说服力的一处（别人演示 AI 只给你看答案，我们给你看证据链）。 */
    const trace = [];
    if (ai && ai.totalDocs) {
      /* ★ 09-25：把检索**范围**也写出来——"本场会议 N 条"与"全档 N 条"是不同的可信度声明
       *   （全档更大说明存档里还有房间号复用前的旧会议记录，本次没有采用）。 */
      trace.push(ai.scoped && ai.allDocs > ai.totalDocs
        ? `📚 本场检索 ${ai.totalDocs} 条取 ${ai.hits || 0} 条（全档 ${ai.allDocs}）`
        : `📚 检索 ${ai.totalDocs} 条字幕取 ${ai.hits || 0} 条`);
    }
    if (ai && ai.turns > 1) trace.push(`💬 第 ${ai.turns} 轮`);
    if (ai && ai.intent && ai.intent !== 'question') {
      trace.push(`🎯 ${({ minutes: '生成纪要', recap: '回顾', operator: '远程操作' })[ai.intent] || ai.intent}`);
    }
    const traceHtml = trace.length
      ? `<div class="msg-ai-trace" title="AI 得出这条答案的中间过程（可验证，非黑箱）">${escapeHtml(trace.join(' · '))}</div>`
      : '';
    /* ★ 09-24 C4：纪要链接是 <a href> 导航，浏览器发不出自定义请求头——只能把 roomToken
     *   挂到查询串（服务端 extractRoomToken 已支持 ?roomToken= 这条兜底）。
     *   ai.path 可能已经带查询串，所以判断用 '?' 还是 '&'。文案与 DOM 结构一个字没动。 */
    const minutesHref = (ai && ai.path)
      ? ai.path + (myRoomToken ? (ai.path.includes('?') ? '&' : '?') + 'roomToken=' + encodeURIComponent(myRoomToken) : '')
      : '';
    const link = minutesHref
      ? `<a class="msg-link" href="${escapeHtml(minutesHref)}" target="_blank" rel="noopener">📄 打开纪要</a>` : '';
    item.className = 'msg';
    item.classList.add('bot');
    item.innerHTML =
      `<div class="msg-name">🤖 ${escapeHtml(name || 'AI 助理')}<span class="msg-via" title="AI 会议助理">AI</span>` +
      `<span class="msg-ai-mode${mode === 'Mock' ? ' mock' : ''}" title="这条答案由${mode === 'Mock' ? '本地规则（未接 LLM）' : 'DeepSeek 模型'}生成">${mode}</span>${meta}</div>` +
      traceHtml +
      traceEvidenceHtml(ai, null) +
      `<div class="msg-text">${escapeHtml(text)}${link ? '<br>' + link : ''}</div>` +
      `<div class="msg-time">${new Date().toLocaleTimeString()}</div>`;
  } else {
    item.className = isMe ? 'msg me' : 'msg other';
    // ★ 09-14：路径徽标——🛰️ = 这条是经 SFU 数据通道（SCTP）直达的；
    //   没有徽标 = 走的信令兜底路。聊天走哪条路，从此肉眼可查。
    const viaIcon = via === 'sctp' ? '<span class="msg-via" title="经 SFU 数据通道（SCTP）直达">🛰️</span>' : '';
    const who = isMe ? `我${myDisplayName ? ' · ' + myDisplayName : ''}` : (name || `成员 ${shortId(sender)}`);
    item.innerHTML =
      `<div class="msg-name">${escapeHtml(who)}${viaIcon}</div>` +
      `<div class="msg-text">${escapeHtml(text)}</div>` +
      `<div class="msg-time">${new Date().toLocaleTimeString()}</div>`;
  }
  chatList.appendChild(item);
  // ★ 09-25：侧栏分段后聊天可能被切走 → 非当前分段时累计未读角标（否则会漏消息）
  noteChatActivity();
  // ★ 09-19d 架构优化：聊天 DOM 环形上限（300 条）——SCTP 广播语义下长会消息不少，
  //   DOM 节点数是前端内存与重排开销的大头；超限剪最老的（字幕账本另有 jsonl 存档）。
  while (chatList.children.length > 300) chatList.firstChild.remove();
  chatList.scrollTop = chatList.scrollHeight;
}

/* 把一个问题发给 AI 助理（就是「@ai ...」走的那条路）。
 * ▎为什么抽成函数：让「快捷问法按钮」与「手打 @ai」走**完全相同**的链路。
 *   不给快捷方式开特例分支，否则两条路的行为迟早漂移——
 *   以后若给提问加上限流/去重/权限，只改一处就会漏掉另一处。
 * @returns {boolean} true = 已作为 AI 提问发出 */
function sendAiQuestion(question) {
  const q = String(question || '').trim();
  if (!q) return false;
  if (!myRoom) {
    appendChat('（还没进房间，消息发不出去）', 'system', false);
    return false;
  }
  // ★ 09-19g：@ai 后接「操作/打开/点击…」走 C1 AI 远程操作员（授权卡照弹，与人类同链路）
  if (/^(操作|打开|点击|帮我操作|远程)/.test(q)) {
    socket.emit('ai-op', { goal: q });
    return true;
  }
  /* ★ 09-19 AI Bot：提问以信令发出，回答由服务器以 chat-message(from='ai-bot') 广播回来。
   *   这里**不本地回显**问题——避免"我说的话"与"AI 的回答"分裂成两个来源，
   *   也保证房间内所有人看到的问答记录完全一致（问答是公开的，不是私聊）。 */
  socket.emit('ai-ask', { question: q });
  return true;
}

function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  // ★ 09-19 AI Bot：以「@ai」开头的消息走 ai-ask 问答（服务器应答会以 ai-bot 气泡广播回来）
  if (/^@ai\b|^@ai$/i.test(text) || text.toLowerCase().startsWith('@ai ')) {
    const question = text.replace(/^@ai\b\s*/i, '').trim() || '你好，介绍一下你自己';
    sendAiQuestion(question);
    chatInput.value = '';
    return;
  }
  if (!myRoom) {
    appendChat('（还没进房间，消息发不出去）', 'system', false);
    return;
  }
  // ★ D+1 双路径发送：主路 SCTP（mediasoup 自动广播给所有订阅者），兜底信令广播。
  //   msgId 由发送端生成（自己的 id 开头，天然不会撞），两端都按它去重。
  const msg = {
    type: 'chat',
    msgId: `${socket.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text,
    name: myDisplayName || undefined, // ★ 09-16：昵称随 SCTP 消息带出去
  };
  let viaSctp = false;
  if (chatDataProducer && !chatDataProducer.closed) {
    try {
      chatDataProducer.send(JSON.stringify(msg)); // mediasoup-client 的 send：字符串直接走 SCTP
      viaSctp = true;
    } catch (err) {
      log(`⚠️ SCTP 发送失败（退回信令）：${err.message}`);
    }
  }
  socket.emit('chat-message', { text, msgId: msg.msgId }); // 兜底路（服务器广播含自己，self 显示走这条）
  chatInput.value = '';
}

chatSendBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

/* ──────────────────────────────────────────────────────────────
 * 第 12 步：聊天系统消息（房间进出提示，可选增强）
 * ────────────────────────────────────────────────────────────── */
socket.on('new-member', ({ id }) => {
  appendChat(`成员 ${shortId(id)} 加入了房间`, 'system', false);
});

/* ──────────────────────────────────────────────────────────────
 * 第 13 步：getStats 网络监控（SFU 版）
 *
 * ▎读谁？读自己的两条 Transport 的统计：
 *   recvTransport.getStats() → 我收到了多少（下行）
 *   sendTransport.getStats() → 我发出了多少（上行）
 *   浏览器在底层还是 WebRTC，所以统计结构和 Mesh 版很像（inbound/outbound-rtp）。
 * ▎注：这里不过滤 audio/video，算的是"会议总流量"（教学简化）。
 * ────────────────────────────────────────────────────────────── */
let lastStatsSample = null;

// ★ A5② 自适应节流的数据源：把每一轮测到的 RTT 存到全局，
//   供第 14 步"控制端发送节流"读取（网络越差 → 发得越稀）。
//   与 Mesh 版同名同义——两版控制协议保持一致，面试对比时少一个变量。
let netRttMs = null; // null = 还没测到过

async function monitorNetwork() {
  if (!sendTransport && !recvTransport) {
    netBadge.textContent = '网络 --';
    netBadge.className = 'badge idle';
    return;
  }

  let received = 0, lost = 0, recvBytes = 0, sentBytes = 0;
  let rttMs = -1;
  const candTypes = new Set(); // ★ 09-13：我用什么方式到达服务器（host/srflx/relay）
  let bweBps = -1;             // ★ 09-14：带宽估计（transport-cc，单位 bps）

  // 汇总一份统计数组（transport.getStats() 返回数组）
  const collect = (list) => {
    for (const it of list) {
      if (!it) continue;
      if (it.type === 'inbound-rtp') {
        received  += it.packetsReceived || 0;
        lost      += it.packetsLost || 0;
        recvBytes += it.bytesReceived || 0;
      } else if (it.type === 'outbound-rtp') {
        sentBytes += it.bytesSent || 0;
        if (typeof it.roundTripTime === 'number') {
          rttMs = Math.max(rttMs, it.roundTripTime * 1000); // 秒 → 毫秒
        }
      } else if (it.type === 'local-candidate' && it.candidateType) {
        candTypes.add(it.candidateType); // ★ 09-13：记录"我怎么连出去的"
      } else if (it.type === 'candidate-pair' && (it.selected || it.state === 'succeeded')) {
        // ★ 09-14：带宽估计——浏览器用 transport-cc/REMB 对当前路径估出的可用带宽。
        //   这就是 D+3 想引入的"工程化 ABR 原料"：先把它可视化出来。
        if (typeof it.availableOutgoingBitrate === 'number') {
          bweBps = Math.max(bweBps, it.availableOutgoingBitrate);
        }
        if (typeof it.availableIncomingBitrate === 'number') {
          bweBps = Math.max(bweBps, it.availableIncomingBitrate);
        }
      }
    }
  };

  try { if (recvTransport) collect(await recvTransport.getStats()); } catch (e) { /* 忽略 */ }
  try { if (sendTransport) collect(await sendTransport.getStats()); } catch (e) { /* 忽略 */ }

  /* ★ 09-13 可达性可视化：把"到服务器怎么连的"显示出来——
   *   host=同机/直连，srflx=经 STUN 穿 NAT，relay=经 TURN 中继。
   *   网络可达性是这套系统的硬边界，让它**看得见**是解决它的第一步：
   *   演示跨网时一眼就能证明"现在是 TURN 中继在撑着"。 */
  if (connType && candTypes.size) {
    const label = candTypes.has('relay') ? 'TURN 中继'
      : candTypes.has('srflx') ? 'STUN 穿墙' : '直连';
    connType.textContent = label;
    connType.className = 'badge connected';
    connType.title = 'ICE 连接方式：' + [...candTypes].join(' / ');
    // ★ 09-14：带宽估计挂进悬浮提示（D+3 的"原料"，先看得见）
    if (bweBps > 0) {
      connType.title += ` · 可用带宽估计 ≈ ${(bweBps / 1e6).toFixed(2)} Mbps（transport-cc）`;
    }
  }

  if (received === 0 && sentBytes === 0) {
    netBadge.textContent = '网络采集中…';
    netBadge.className = 'badge idle';
    lastStatsSample = null;
    return;
  }

  const lossRatio = (received + lost) > 0 ? lost / (received + lost) : 0;

  let upKbps = 0, downKbps = 0;
  const now = performance.now();
  if (lastStatsSample) {
    const dt = Math.max((now - lastStatsSample.t) / 1000, 0.001);
    upKbps   = Math.round(((sentBytes - lastStatsSample.sent) / dt) * 8 / 1000);
    downKbps = Math.round(((recvBytes - lastStatsSample.recv) / dt) * 8 / 1000);
  }
  lastStatsSample = { t: now, sent: sentBytes, recv: recvBytes };

  let level, word;
  if (lossRatio >= 0.03 || rttMs >= 400)       { level = 'poor';   word = '网络较差'; }
  else if (lossRatio >= 0.005 || rttMs >= 150) { level = 'medium'; word = '网络一般'; }
  else                                          { level = 'good';   word = '网络良好'; }

  const rttText = rttMs >= 0 ? `${Math.round(rttMs)}ms` : '--';
  if (rttMs >= 0) netRttMs = rttMs; // ★ A5②：同步给控制端的自适应节流（第 14 步）
  netBadge.textContent =
    `📶 ${word} · 丢包${(lossRatio * 100).toFixed(1)}% · 延迟${rttText} · ↑${upKbps} ↓${downKbps}kbps`;
  netBadge.className = `badge ${level}`;
}

setInterval(monitorNetwork, 3000);

/* ──────────────────────────────────────────────────────────────
 * 第 14 步：⭐ 远程协助（后续升级方向 A1 · SFU 版）
 *
 * ▎流程总览（授权信令和 Mesh 版一字不差）：
 *   [控制端] 点视频框上的「请求控制」→ remote-request { to: 被控端 }
 *   [被控端] 页面弹授权卡片 → 允许发 remote-answer { ok:true }，拒绝 { ok:false }
 *   [服务器] 登记"谁控谁"（互斥）→ 全房广播 remote-state → 三端 UI 联动
 *   [输入流] 控制端采集鼠标键盘 → 每条 remote-input { to, event } 经服务器
 *            定向转发给被控端 → 被控端在工作台 iframe 里重放
 *
 * ▎⭐ 和 Mesh 版的唯一本质区别（面试必讲）：
 *   Mesh 版授权后走 **P2P ctrl_ DataChannel**：浏览器直连、不经服务器、
 *     还要 ping/pong 自检通道开通——那是"有隧道"的玩法。
 *   SFU 版浏览器之间没有连接，控制输入也走服务器：
 *     发送 = socket.emit('remote-input', { to, event })，
 *     接收 = socket.on('remote-input') 重放。
 *   所以本版没有 ctrl 通道字典、没有 readyState 检查、没有 ping/pong——
 *   信令本来就是通的（聊天也这么走），"通道建立"这一层整个消失了。
 *   代价：输入绕服务器一圈，多一跳延迟；收益：服务器能做输入门禁（见服务器端）。
 *
 * ▎采集/重放两块（归一化坐标、rAF 节流、合成事件、execCommand 代插字）
 *   与 Mesh 版逐行同构——那是"浏览器端"的活，与传输方式无关，原样复用。
 *
 * ▎A2/A5 升级后的线上消息形态（与 Mesh 版同构，只是管道不同）：
 *   【JSON 命令】键盘 keydown/keyup（key/code 是字符串）、A2 中文整段文本
 *     { type:'input', kind:'input-text', text }（kind 名沿用规划 4.3 预留位）、
 *     ping/pong/release 仅 Mesh 有（SFU 信令常通，不需要通道自检）；
 *   【16 字节二进制帧】A5①：高频鼠标/滚轮命令——ArrayBuffer 直接放进
 *     remote-input 的 event 字段，socket.io 会把它当"二进制附件"序列化，
 *     服务器原样透传，被控端拿回等长的 ArrayBuffer（浏览器端）。
 *     面试可讲：socket.io 对二进制是"附件搬运"，不解析内容，门禁照旧只看 to。
 * ────────────────────────────────────────────────────────────── */

// 远程控制状态机（一个房间同时只有一对"被控-控制"关系，服务器 remoteCtl 保证）
//   rcRole     = 我此刻的角色：'host'（我的屏幕被控）/ 'controller'（我在控制别人）/ null
//   rcPeerId   = 对端的 socket id
//   assistOn   = 我是否打开了「允许远程协助」（成为 host 资格的本地开关）
//   ctrlActive = 控制端视角：授权确认后即可采集（信令通 = 通道通，无等待环节）
let rcRole = null;
let rcPeerId = null;
let assistOn = false;
let ctrlActive = false;

/* ---- ★ A6 升级（2026-09-11）：三个安全件共用的状态 ----
 *   remoteExpiresAt : 限时授权的到期时间戳（null = 不限时）。两端都用它跑倒计时。
 *   blockedPeers    : 本地黑名单（"不再允许 TA"）——授权是我的权利，名单也由我说了算。
 *   auditLog        : 被控端的审计日志（环形缓冲，最多 500 条）。
 *                    为什么记在**被控端本地**而不上报服务器？审计的意义就是"我能证明对方做了什么"，
 *                    日志放服务器等于把证据交给别人保管（真实产品的审计日志也是本地+可导出）。
 */
let remoteExpiresAt = null;
const blockedPeers = new Set();
const auditLog = [];
const AUDIT_MAX = 500;
let countdownTimer = null;

// 控制端：点「请求控制」按钮 → 向服务器申请控制某位成员
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

// 轻提示：顶部浮现 3 秒（type: ''成功 / 'error'失败 / 'info'普通）
let toastTimer = null;
function showToast(msg, type = '') {
  toastEl.textContent = msg;
  toastEl.className = `toast ${type}`;      // 重置动画（先移除再强制重排）
  void toastEl.offsetWidth;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3000);
}

// 被控端视角：收到别人的控制申请
//   规则：没共享屏幕 / 没开「允许远程协助」= 没有"可被控的桌面" →
//   直接自动拒绝（reason: not-sharing），连弹窗都不弹；否则弹授权卡片等人决定
let pendingFrom = null;
socket.on('remote-request', ({ from }) => {
  // ★ A6：被我拉黑的人直接拒绝（连卡片都不弹）——"不再允许 TA"是本地黑名单
  if (blockedPeers.has(from)) {
    log(`🚫 成员 ${shortId(from)} 在你的黑名单里，已自动拒绝`);
    socket.emit('remote-answer', { to: from, ok: false, reason: 'blocked' });
    return;
  }
  if (!sharingScreen || !assistOn) {
    log(`🖱️ 成员 ${shortId(from)} 请求控制，但你未开启远程协助 → 已自动拒绝`);
    socket.emit('remote-answer', { to: from, ok: false, reason: 'not-sharing' });
    return;
  }
  log(`🖱️ 成员 ${shortId(from)} 想控制你的屏幕...`);
  pendingFrom = from;
  remoteAskText.textContent = `成员 ${shortId(from)} 想远程控制你的屏幕，是否允许？`;
  remoteAskText.textContent = `成员 ${shortId(from)} 想远程控制你的屏幕，是否允许？`;
  remoteAskBox.classList.remove('hidden');
});

// 授权卡片按钮（为什么不用 confirm()：原生弹窗在页面失焦/被压制时静默失败，
//   教学演示不可靠；自己的 UI 自己画，一定弹得出来、一定点得到）
remoteAllowBtn.addEventListener('click', () => {
  if (!pendingFrom) return;
  const requester = pendingFrom; // 先存下来，下面要把 pendingFrom 清空
  // ★ A6：读出"允许多久"——0 表示不限时；服务器据此挂自动到期的定时器
  const durationMs = Number(remoteDurSel.value) || 0;
  socket.emit('remote-answer', { to: requester, ok: true, durationMs }); // 允许
  remoteAskBox.classList.add('hidden');
  pendingFrom = null;
  log(`🖱️ 已允许远程控制${durationMs ? `（${Math.round(durationMs / 1000)} 秒后自动收回）` : '（不限时）'}`);
  auditPush('授权', `允许 ${shortId(requester)} 控制${durationMs ? ` ${Math.round(durationMs / 1000)}s` : '（不限时）'}`);
  // 允许即成为被控端：记录角色 + 工作台状态条亮"收回控制"
  //   （Mesh 版这里还要建 ctrl 通道；SFU 版信令本来就是通的，无事可做）
  rcRole = 'host';
  rcPeerId = requester;
  remoteExpiresAt = durationMs ? Date.now() + durationMs : null;
  startCountdown();
  setWbStatus(`🖱️ 成员 ${shortId(requester)} 正在控制你的工作台`);
  wbReclaimBtn.classList.remove('hidden');
  showToast('✅ 已允许远程控制，可随时点「收回控制」');
});

remoteDenyBtn.addEventListener('click', () => {
  if (!pendingFrom) return;
  socket.emit('remote-answer', { to: pendingFrom, ok: false }); // 拒绝
  log('🖱️ 已拒绝远程控制');
  auditPush('授权', `拒绝 ${shortId(pendingFrom)} 的控制请求`);
  remoteAskBox.classList.add('hidden');
  pendingFrom = null;
});

// ★ A6：拉黑——"授权是我的权利，名单也由我说了算"
remoteBlockBtn.addEventListener('click', () => {
  if (!pendingFrom) return;
  const who = pendingFrom;
  blockedPeers.add(who);
  socket.emit('remote-answer', { to: who, ok: false, reason: 'blocked' });
  log(`🚫 已把成员 ${shortId(who)} 加入黑名单，之后他的申请会被自动拒绝`);
  auditPush('授权', `将 ${shortId(who)} 加入黑名单并拒绝`);
  showToast(`🚫 不再允许成员 ${shortId(who)} 申请控制`, 'info');
  remoteAskBox.classList.add('hidden');
  pendingFrom = null;
});

/* ---- ★ A6：倒计时（被控端与控制端共用一套显示逻辑）----
 * ▎数据源是服务器给的**绝对时间戳**（expiresAt），而不是"还剩多少秒"——
 *   绝对时间才能对抗"消息延迟"：就算广播晚到 200ms，倒计时依然准确。
 * ▎为什么要显示？限时授权的意义在于"用户随时知道还剩多久"，
 *   否则到期突然断开会让人以为断线了（体验问题，也是面试可讲的细节）。
 */
function startCountdown() {
  clearInterval(countdownTimer);
  const render = () => {
    if (!remoteExpiresAt) {
      wbCountdown.classList.add('hidden');
      const tip = document.querySelector('.ctl-layer .ctl-countdown');
      if (tip) tip.classList.add('hidden');
      return;
    }
    const left = Math.max(0, remoteExpiresAt - Date.now());
    const text = `⏳ 授权剩余 ${Math.ceil(left / 1000)}s`;
    // 被控端：工作台工具条上的倒计时
    wbCountdown.textContent = text;
    wbCountdown.classList.toggle('hidden', !assistOn);
    // 控制端：控制层提示条上的倒计时
    const tip = document.querySelector('.ctl-layer .ctl-countdown');
    if (tip) { tip.textContent = text; tip.classList.remove('hidden'); }
    if (left <= 0) clearInterval(countdownTimer);
  };
  render();
  countdownTimer = setInterval(render, 1000);
}

function stopCountdown() {
  clearInterval(countdownTimer);
  countdownTimer = null;
  remoteExpiresAt = null;
  wbCountdown.classList.add('hidden');
  const tip = document.querySelector('.ctl-layer .ctl-countdown');
  if (tip) tip.classList.add('hidden');
}

// ★ A6：审计日志的写入与渲染（被控端本地）
function auditPush(kind, detail) {
  const line = `[${new Date().toLocaleTimeString()}] ${kind} ${detail}`;
  auditLog.push(line);
  if (auditLog.length > AUDIT_MAX) auditLog.shift(); // 环形缓冲：满了丢最早的
  if (!auditPanel.classList.contains('hidden')) renderAudit();
}
function renderAudit() {
  auditListEl.textContent = auditLog.length
    ? auditLog.join('\n')
    : '（暂无记录：被控端会在这里记下每一条来自控制端的操作）';
  auditListEl.scrollTop = auditListEl.scrollHeight;
}
// 审计面板三个按钮：打开/导出/清空
wbAuditBtn.addEventListener('click', () => {
  auditPanel.classList.toggle('hidden');
  if (!auditPanel.classList.contains('hidden')) {
    renderAudit();
    log(`📜 审计日志已打开（共 ${auditLog.length} 条）`);
  }
});
auditCloseBtn.addEventListener('click', () => auditPanel.classList.add('hidden'));
auditClearBtn.addEventListener('click', () => {
  auditLog.length = 0;
  renderAudit();
  log('📜 审计日志已清空');
});
auditExportBtn.addEventListener('click', () => {
  if (!auditLog.length) { showToast('审计日志是空的，没什么可导出', 'info'); return; }
  const header = `# 远程协助审计日志\n# 房间：${myRoom || '-'}\n# 导出时间：${new Date().toLocaleString()}\n\n`;
  const blob = new Blob([header + auditLog.join('\n')], { type: 'text/plain;charset=utf-8' });
  downloadBlob(blob, `审计日志-${myRoom || 'room'}-${Date.now()}.txt`);
  log(`📜 审计日志已导出（${auditLog.length} 条）`);
});

// 控制端视角：收到回执 → ok / busy / not-sharing / blocked / 拒绝 五种结果
socket.on('remote-answer', ({ from, ok, reason, expiresAt }) => {
  if (ok) {
    remoteExpiresAt = expiresAt || null; // ★ A6：服务器给的到期时间戳（null = 不限时）
    log(`🎉 成员 ${shortId(from)} 已允许你控制他的屏幕！`
      + (expiresAt ? `（授权 ${Math.max(1, Math.round((expiresAt - Date.now()) / 1000))} 秒后到期）` : ''));
    // ★ 09-24：授权的对象决定用哪个控制台 ——
    //   桌面代理 → 真远程桌面控制台（canvas 收真画面，输入注入真浏览器）；
    //   人类成员 → 原来的工作台重放模式（控的是他页面里的模拟桌面）。
    //   两者共用同一条 remote-request / remote-answer 授权链路，服务器一视同仁。
    if (agentPeers.has(from)) {
      showToast(`✅ 已连上成员 ${shortId(from)} 的电脑`);
      openRemoteDesk(from, agentPeers.get(from));
    } else {
      showToast(`✅ 成员 ${shortId(from)} 已允许你控制他的屏幕`);
      enterControlMode(from); // 授权成功 → 进入控制模式（信令通即通道通）
    }
    startCountdown();       // ★ A6：控制层里的倒计时开始跑
  } else if (reason === 'busy') {
    log('❌ 对方正在被其他人控制中（busy），请稍后再试');
    showToast('❌ 对方正在被其他人控制中，暂时无法控制', 'error');
  } else if (reason === 'not-sharing') {
    log('❌ 对方未开启远程协助（需要对方正在共享屏幕并打开允许开关）');
    showToast('❌ 对方未开启远程协助，无法请求控制', 'error');
  } else if (reason === 'blocked') {
    log('❌ 对方已把你列入黑名单（不再允许你申请控制）');
    showToast('❌ 对方不再允许你申请控制', 'error');
  } else {
    log(`❌ 成员 ${shortId(from)} 拒绝了你的控制请求`);
    showToast(`❌ 成员 ${shortId(from)} 拒绝了你的控制请求`, 'error');
  }
});

/* ★ A6 升级：服务器告诉我们"控制为什么结束了"
 * ▎三种 reason 的体验差别（细节见用心处）：
 *   expired   → 授权到期，自动收回（要提示"已到期"，否则用户以为是断线）
 *   released  → 对方主动收回
 *   peer-left → 对方离开房间
 */
socket.on('remote-ended', ({ reason }) => {
  const word = reason === 'expired' ? '⏰ 授权已到期，控制已自动收回'
    : reason === 'peer-left' ? '👋 对方已离开房间，控制结束'
    : '🖱️ 对方已收回控制权';
  log(word);
  showToast(word, reason === 'expired' ? 'info' : '');
  stopCountdown();
  if (rdHostId) closeRemoteDesk(false);   // ★ 09-24：远程桌面控制台跟着一起收（不留死画面）
  if (rcRole === 'host') auditPush('授权', `控制结束（${reason}）`);
});

// 全房间视角：服务器广播"现在谁在控制谁" → 更新状态（角标 + 双方 UI 联动）
//   这条广播是"权威状态"——不管哪条路径开始/结束了控制，
//   三端（被控/控制/旁观）都以它为准复位 UI，幂等执行（重复到达也不会乱）。
socket.on('remote-state', ({ hostId, controllerId, expiresAt }) => {
  // ★ A6：广播里带着"限时授权的到期时间戳"——任何一端都能算出还剩多久
  if (expiresAt) { remoteExpiresAt = expiresAt; startCountdown(); }
  if (!hostId || !controllerId) stopCountdown();
  // ★ 09-24：控制关系一消失，远程桌面控制台自动收起（任何一处撤权都能兜住，幂等安全）
  if ((!hostId || !controllerId) && rdHostId) closeRemoteDesk(false);

  // 先清掉所有视频框上的"控制中/被控中"角标（重建式更新，最不容易漏）
  for (const tile of tiles.values()) tile.box.classList.remove('rc-host', 'rc-ctrl');
  // 角标只标在"成员的主画面格"上（每个成员必有，最稳的锚点）
  const mark = (id, cls) => {
    const main = peerMains.get(id);
    if (main) main.box.classList.add(cls);
  };

  if (hostId && controllerId) {
    mark(hostId, 'rc-host');           // 角标：被控中
    mark(controllerId, 'rc-ctrl');     // 角标：控制中
    log(`🖱️ 成员 ${shortId(controllerId)} 正在控制成员 ${shortId(hostId)} 的屏幕`);

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
    // 我是控制端 → 退出控制模式（release 由发起方发过就不重复发信令）
    if (rcRole === 'controller') exitControlMode(false);
    // 我是被控端 → 复位被控状态（工作台保持开着，等下一次请求）
    if (rcRole === 'host') endHostControl();
  }
});

/* ---- 控制端：进入控制模式 → 采集输入 → 发送 ----
 * ▎控制模式是什么？被允许后，在对方"屏幕格"上盖一层透明"控制层"：
 *   我的鼠标在"看到他屏幕"的位置上操作，事件从控制层捕获，
 *   换算成归一化坐标发给服务器 → 服务器转给被控端 → 他重放。
 *
 * ▎⭐ 坐标归一化（面试考点，与 Mesh 版同构）：
 *   两端窗口大小不同，绝不能传像素。基准取"视频画面内容实际显示的矩形"：
 *   视频用 object-fit: cover 显示（放大铺满、超出裁剪），所以
 *   "元素框 ≠ 画面内容"，要先算出内容矩形（getVideoDrawRect），
 *   再在内容矩形里把鼠标位置归一化成 0~1；被控端 × 自己视口尺寸还原。
 */
function enterControlMode(hostId) {
  if (rcRole === 'controller' && rcPeerId === hostId) return; // 已在控制他，防重入
  const screen = peerScreens.get(hostId); // ★ 和 Mesh 最大的不同：锚点是"他的屏幕格"
  if (!screen) { log('❌ 找不到被控端的屏幕画面，无法进入控制模式'); return; }
  if (rcRole === 'controller' && rcPeerId !== hostId) exitControlMode(false); // 换人先清

  rcRole = 'controller';
  rcPeerId = hostId;
  ctrlActive = true; // 信令通 = 通道通，直接激活（Mesh 版这里要等通道 open + pong）

  // 动态造控制层（盖住他的屏幕格），顶部一条提示 + 一排工具按钮
  //   ★ A4：📸 截图（把对方屏幕抓成 PNG 下载）
  //   ★ A3：📋 粘贴（把本机剪贴板内容粘到对方工作台）/ 📋 复制选中（把对方工作台里选中的文字带回本机）
  //   ★ A4：📎 发文件（把文件传给他，走服务器定向分块中继）
  //   ★ A6：倒计时（限时授权时显示"还剩多久"）
  const layer = document.createElement('div');
  layer.className = 'ctrl-layer';
  layer.innerHTML =
    `<div class="ctrl-tip">` +
    `<span class="ctl-status">🖱️ 正在控制 成员 ${shortId(hostId)}</span>` +
    `<span class="ctl-countdown hidden">⏳ --</span>` +
    `<span class="ctl-tools">` +
    `<button class="ctl-shot btn" title="把对方屏幕抓成 PNG 下载">📸 截图</button>` +
    `<button class="ctl-paste btn" title="把本机剪贴板内容粘贴到对方工作台">📋 粘贴</button>` +
    `<button class="ctl-copy btn" title="复制对方工作台里选中的文字到本机剪贴板">📋 复制选中</button>` +
    `<button class="ctl-file btn" title="给被控端发文件">📎 发文件</button>` +
    `</span>` +
    `<button class="ctl-release btn danger">释放控制（Esc）</button></div>`;
  screen.box.appendChild(layer);
  screen.box.classList.add('rc-controlling');
  layer.querySelector('.ctl-release').addEventListener('click', () => exitControlMode(true));
  layer.querySelector('.ctl-shot').addEventListener('click', () => screenshotHost(hostId));
  layer.querySelector('.ctl-paste').addEventListener('click', () => pasteClipboardToHost());
  layer.querySelector('.ctl-copy').addEventListener('click', () => copyHostSelection());
  layer.querySelector('.ctl-file').addEventListener('click', () => pickFileFor(hostId));

  // --- 鼠标/滚轮采集（挂在控制层上）---
  layer.addEventListener('pointermove', onCtlPointerMove); // 高频 → rAF 节流
  layer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sendCtlInput('mousedown', e, { btn: e.button });       // 0左 / 1中 / 2右
  });
  layer.addEventListener('pointerup', (e) => {
    sendCtlInput('mouseup', e, { btn: e.button });
  });
  layer.addEventListener('dblclick', (e) => sendCtlInput('dblclick', e, {}));
  layer.addEventListener('contextmenu', (e) => e.preventDefault()); // 右键转发而非弹菜单
  layer.addEventListener('wheel', onCtlWheel, { passive: false });  // 高频 → 合并发送
  // ★ A7：触屏支持（长按=右键、双指滑动=滚轮），与上面 pointer 事件共存
  wireTouchControl(layer);

  // --- 键盘采集（挂 document：div 默认收不到键盘）---
  //   只在控制中转发，且焦点在自己页面的输入框里时不转发——
  //   否则我在自己聊天框打字会"串"到对方屏幕上。
  document.addEventListener('keydown', onCtlKeyDown);
  document.addEventListener('keyup', onCtlKeyUp);

  // --- A2：IME 捕获框（中文输入法的关键拼图，与 Mesh 版同构）---
  // ▎为什么需要它？中文输入法打字时 keydown 只给你 key='Process'（keyCode 229），
  //   真正的中文在**组合输入**（composition）里，而组合输入必须发生在"可编辑元素"
  //   上才触发——控制层是个普通 div，IME 在它身上组合不起来。
  // ▎解法（真实远程桌面同款，如 noVNC）：造一个看不见的 <textarea>，
  //   控制期间把焦点钉在它身上：英文直打走原有 keydown 转发；
  //   中文组合输入的最终结果在 compositionend 的 e.data 里，整段发出。
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
  imeCapture.focus(); // 把焦点钉到捕获框：之后敲键盘（含 IME）都落在这里

  log('🎮 控制模式已激活：移动/点击/滚轮/打字将实时作用于对方工作台');
}

// pointermove 节流：每帧只发"最新位置"（丢中间帧、保实时）
// ★ A2：IME 捕获框（控制期间存在，退出时移除）+ 组合输入进行中标记
let imeCapture = null; // 隐藏 textarea：给 IME 一个"可编辑焦点"当输入靶子
let composing = false; // true = 中文组合输入中（候选键不能转发给对方）

// ★ A5② 自适应节流：按 getStats 测到的 RTT 决定"每几帧发一次 move"。
//   RTT 小（<80ms）→ 每帧都发（≈60fps 跟手）；RTT 中 → 隔帧（≈30fps）；
//   RTT 大（>200ms）→ 每 4 帧一条（≈15fps）。数据源：monitorNetwork 每 3 秒更新。
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
  pendingMove = e;
  if (!moveRafId) {
    moveRafId = requestAnimationFrame(() => {
      moveRafId = 0;
      moveFrameTick++;
      // 无论本帧发不发，pendingMove 都清空——"只留最新"是节流的灵魂
      const pm = pendingMove;
      pendingMove = null;
      if (pm && moveFrameTick % ctlMoveSkip() === 0) {
        sendCtlInput('mousemove', pm, {});
      }
    });
  }
}

// 滚轮合并：60ms 内的滚动增量合成一条消息（wheel 比 move 还密，且要"量"有意义）
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
  // A2 两道 IME 闸门：① 组合输入中，Backspace/Enter/空格 是"选候选字"，
  //   转发过去会让对方乱删字/换行；② key='Process' 是 IME 占位键，转发无意义。
  if (composing) return;
  if (e.key === 'Process' || e.keyCode === 229) return;
  if (e.key === 'Escape') { exitControlMode(true); return; } // Esc = 快捷释放（组合中除外）

  /* ★ A3 升级（2026-09-11）：剪贴板的两个快捷键不是"按键"而是"内容"，必须拦下来单独处理
   *   Ctrl/Cmd+V → 读**本机**剪贴板，把文本发给被控端（这是跨机粘贴的正路：
   *                我的剪贴板在我这台机器上，对方看不到，只能我们主动送过去）
   *   Ctrl/Cmd+C → 把对方工作台里选中的文字取回**本机**剪贴板（反向）
   *   为什么要 preventDefault？否则浏览器还会走它自己的复制粘贴默认行为（控制层里没意义）。
   */
  if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
    e.preventDefault();
    pasteClipboardToHost();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
    e.preventDefault();
    copyHostSelection();
    return;
  }
  sendCtlKey('keydown', e);
}
function onCtlKeyUp(e) {
  if (rcRole !== 'controller') return;
  const t = e.target;
  if (t && t !== imeCapture &&
      (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (composing || e.key === 'Process' || e.keyCode === 229) return; // 同 keydown 的 IME 闸门
  sendCtlKey('keyup', e);
}

// 键盘消息：key 是"字符"（a、Enter、Shift…），code 是"物理键位"（KeyA…），都带上
function sendCtlKey(type, e) {
  if (!ctrlActive) return;
  sendInput({ type: 'input', kind: type,
    key: e.key, code: e.code,
    altKey: e.altKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, metaKey: e.metaKey });
}

// ★ A2：整段文本消息（中文 IME 的协议形态，与 Mesh 版同构）——
//   不逐键发、按"组合输入的最终结果"发，对方 execCommand 一次插入整段。
function sendCtlText(text) {
  if (!ctrlActive || !text) return;
  sendInput({ type: 'input', kind: 'input-text', text });
  log(`⌨️ 已发送文本（${text.length} 字）到对方工作台`);
}

// 把一个真实事件转成 16 字节二进制帧发出（坐标在"画面内容矩形"内归一化到 0~1）
// ★ A5①：鼠标/滚轮从 JSON 换成定长二进制帧（~100B → 16B）。
// ▎和 Mesh 版的差异（A5③）：socket.io 不暴露 bufferedAmount（那是 DataChannel
//   的 API），发送队列由 socket.io 自己管理——所以 SFU 版只做②自适应节流、
//   没有③积压监控。"P2P 才拿得到传输层细节"本身就是两版对比的面试素材。
function sendCtlInput(kind, e, extra) {
  if (!ctrlActive) return;
  const screen = peerScreens.get(rcPeerId);
  if (!screen) return;
  const rect = getVideoDrawRect(screen.video);
  const x = clamp01((e.clientX - rect.left) / rect.width);
  const y = clamp01((e.clientY - rect.top) / rect.height);
  sendInput(encodeCtlFrame(kind, x, y, (extra && extra.wheel) || 0, e, extra && extra.btn));
}

// ★ 输入发送统一入口：SFU 版一条 input = 一条 remote-input 信令，
//   服务器校验"我正在控制 to"后定向转发给被控端。
//   （Mesh 版这里往 ctrl DataChannel send；对比记忆：换了条管道而已）
//   event 既可以是普通对象（JSON 命令），也可以是 ArrayBuffer（A5① 二进制帧）——
//   socket.io 会自动把 ArrayBuffer 变成"二进制附件"随包传输，接收端原样还原。
function sendInput(event) {
  if (rcRole === 'controller' && rcPeerId) {
    socket.emit('remote-input', { to: rcPeerId, event });
  }
}

/* ──────────────────────────────────────────────────────────────
 * ★ A5①：16 字节二进制帧编解码器（与 Mesh 版逐行同构）
 *
 * ▎为什么要二进制化？算一笔账（面试可讲）：
 *   鼠标移动是控制流量的绝对大头。JSON 一条约 60~100 字节，还要经服务器
 *   转发两跳；16 字节定长帧省 80%+ 字节。SFU 版省字节同时也省服务器转发量。
 *
 * ▎帧布局（16 字节）：
 *   [0] kind  Uint8   3=mousemove 4=mousedown 5=mouseup 6=dblclick 7=wheel
 *   [1] flags Uint8   bit0=Alt bit1=Ctrl bit2=Shift bit3=Meta bit4~5=鼠标键号
 *   [2..3]    Uint16  预留对齐
 *   [4..7]    Float32 x（归一化 0~1，精度对 4096px 屏误差 <0.001px）
 *   [8..11]   Float32 y
 *   [12..15]  Int32   wheel 增量
 *
 * ▎为什么键盘/文本不走二进制？key/code 是字符串（"ArrowLeft"塞不进 16 字节），
 *   二进制化要建键码表（VNC keysym 那套）；键盘频率低收益小——取舍后留 JSON。
 * ────────────────────────────────────────────────────────────── */

// kind 字符串 ↔ 帧内编号（0~2 留给 JSON 侧的 ping/pong/release，两版编号一致）
const CTL_KIND_TO_ID = { mousemove: 3, mousedown: 4, mouseup: 5, dblclick: 6, wheel: 7 };
const CTL_KIND_FROM_ID = ['', '', '', 'mousemove', 'mousedown', 'mouseup', 'dblclick', 'wheel'];

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

// 算"视频画面内容实际画在元素的哪个矩形"（object-fit: cover 的裁剪修正）
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

// 退出控制模式。sendRelease=true：主动释放 → 发信令 remote-release
//   （Mesh 版还会往 ctrl 通道发 P2P release 快速路径，本版没有通道，信令一条就够）
function exitControlMode(sendRelease) {
  const peerId = rcPeerId;
  if (sendRelease && peerId) socket.emit('remote-release'); // 服务器清表 + 全房广播
  // 摘掉采集监听（引用必须和挂载时是同一个函数引用，所以都用具名函数）
  document.removeEventListener('keydown', onCtlKeyDown);
  document.removeEventListener('keyup', onCtlKeyUp);
  // A2 清理：移除 IME 捕获框（控制结束就不该再截键盘焦点了）
  if (imeCapture) { imeCapture.remove(); imeCapture = null; }
  composing = false;
  // ★ A7 清理：触屏的长按定时器（不收手会在退出后突然发一个右键）
  if (touchLongPressTimer) { clearTimeout(touchLongPressTimer); touchLongPressTimer = null; }
  activeTouchPointers.clear();
  // ★ A6 清理：倒计时随控制会话结束而停（下次授权重新开始）
  stopCountdown();
  clearTimeout(wheelTimer);
  wheelAccum = 0; lastWheelEvent = null; pendingMove = null;
  if (moveRafId) { cancelAnimationFrame(moveRafId); moveRafId = 0; }
  document.querySelectorAll('.ctrl-layer').forEach((el) => el.remove()); // 撤控制层
  const screen = peerId && peerScreens.get(peerId);
  if (screen) screen.box.classList.remove('rc-controlling');
  rcRole = null; rcPeerId = null; ctrlActive = false;
  if (sendRelease) log('🖱️ 已释放控制');
}

/* ---- 被控端：工作台 + 事件重放 ----
 * ▎"重放"是什么？控制端发来的归一化输入，在我端还原成坐标后，
 *   用 new PointerEvent/KeyboardEvent + dispatchEvent 合成一份"假事件"
 *   扔给工作台 iframe 里的元素——监听器不知道也不关心事件是真是假
 *   （isTrusted=false 只影响"浏览器默认行为"，不影响 JS 监听器）。
 *   三个关键手段：① 重放范围锁死 iframe 内（会议 UI 绝不能被遥控）；
 *   ② 合成 mousedown 不聚焦 → 命中文本框时手动 focus()；
 *   ③ 合成按键不插字 → execCommand 代插。
 */
// 收到控制端的一条输入 → 重放到工作台（★ 这就是本版的"ctrl 通道接收端"）
// ★ A5① 分流：event 可能是三种形态——
//   ArrayBuffer（16 字节鼠标/滚轮帧，socket.io 二进制附件还原回来）、
//   普通对象（键盘/文本 JSON 命令）、字符串（万一有端直接 stringify，兼容处理）。
socket.on('remote-input', ({ event } = {}) => {
  if (rcRole !== 'host' || !event) return; // 防御：没在被控状态不处理
  let msg = event;
  try {
    if (event instanceof ArrayBuffer) msg = decodeCtlFrame(event);
    else if (typeof event === 'string') msg = JSON.parse(event);
    replayRemoteInput(msg);
  }
  catch (err) { console.warn('重放控制事件失败:', err); } // 一条坏消息不炸整条流
});

// 「允许远程协助」开关（共享中才出现，见第 9 步）
assistBtn.addEventListener('click', () => {
  if (assistOn) { turnOffAssist(); return; }      // 再点一次 = 关闭
  if (!sharingScreen) {
    showToast('请先共享屏幕，再开启远程协助', 'info');
    return;
  }
  assistOn = true;
  assistBtn.classList.add('on');
  setIconBtn(assistBtn, ICONS.cursor, '远程协助：已开启');
  openWorkbench();
  log('🖱️ 远程协助已开启：工作台已进入共享画面，等待成员请求控制');
});

// 工作台开/关：进入"工作台模式"——藏起会议主界面，iframe 铺满视口。
// 我共享的就是本标签页，所以工作台画面 = 观众看到的"桌面"。
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
  setIconBtn(assistBtn, ICONS.cursor, '允许远程协助');
  if (rcRole === 'host') socket.emit('remote-release'); // 有控制在进行 → 信令收权
  endHostControl();
  closeWorkbench();
  log('🖱️ 远程协助已关闭');
}

// 被控端：结束"被控状态"（不动 assistOn/工作台，只清这一轮控制）
function endHostControl() {
  remoteCursorEl.classList.add('hidden');    // 远程光标收起来
  rcRole = null;
  rcPeerId = null;
  if (assistOn) {
    setWbStatus('✅ 远程协助已开启，等待成员请求控制…');
    wbReclaimBtn.classList.add('hidden');
  }
}

// 清理矩阵：某成员离开时，他卷入的控制关系全部作废（peer-left 时调用）
function cleanupRemoteCtrlForPeer(id) {
  if (rcRole === 'controller' && rcPeerId === id) {
    exitControlMode(false);        // 我正控制他 → 退出（人走了，release 发不出去了）
    socket.emit('remote-release'); // 信令清表（服务器断线清理也会兜底，双保险）
  }
  if (rcRole === 'host' && rcPeerId === id) endHostControl(); // 我正被他控
}

// ⭐重放入口：把控制端的一条 input 消息作用到工作台上
//   消息两种来源（A5①）：JSON 对象（键盘/文本）、16 字节帧解码后的对象——
//   结构同构，这里一视同仁。
function replayRemoteInput(msg) {
  // ★ A6：审计留痕（先记账再重放——"对方做了什么"包括坐标和文本内容，全部记下来）
  auditInput(msg);

  // ★ A3：剪贴板消息（控制端按 Ctrl+V 发来的文本）→ 插进工作台焦点元素
  if (msg.kind === 'clipboard' && msg.dir === 'ctl2host') { replayClipboard(msg); return; }

  // 键盘/整段文本没有坐标，单独走（见 replayKey / replayText）
  if (msg.kind === 'keydown' || msg.kind === 'keyup') { replayKey(msg); return; }
  if (msg.kind === 'input-text') { replayText(msg); return; } // ★ A2：中文整段插入（规划 4.3 预留的 kind 名）

  // ① 归一化 → 我的视口像素坐标。为什么乘整个视口？因为控制端看到的"画面内容"
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

  // ③ 只重放落在工作台 iframe 内的事件（iframe 外是会议 UI，绝不遥控）
  const rect = workbenchFrame.getBoundingClientRect();
  const lx = px - rect.left;
  const ly = py - rect.top;
  if (lx < 0 || ly < 0 || lx > rect.width || ly > rect.height) return;
  const doc = workbenchFrame.contentDocument; // 同源才能拿到
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
      focusTarget(target); // 合成点击不聚焦，命中输入区时手动补
      target.dispatchEvent(new PointerEvent('pointerdown', { ...base, button: msg.btn }));
      // ★ 09-13：HUD 字幕（右键也单独记一笔）
      emitWbActivity(msg.btn === 2 ? 'ctxmenu' : 'mousedown', { label: describeWbTarget(target) });
      break;
    case 'mouseup':
      target.dispatchEvent(new PointerEvent('pointerup', { ...base, button: msg.btn }));
      break;
    case 'dblclick':
      target.dispatchEvent(new MouseEvent('dblclick', base));
      emitWbActivity('dblclick', { label: describeWbTarget(target) });
      break;
    case 'wheel':
      target.dispatchEvent(new WheelEvent('wheel', { ...base, deltaY: msg.wheel || 0 }));
      emitWbActivity('wheel', { delta: msg.wheel || 0, label: describeWbTarget(target) });
      break;
  }
}

// 让"该聚焦的元素"拿到焦点——文本区聚焦了，打字才有落点
function focusTarget(el) {
  const editable = el.isContentEditable ||
    el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
  if (editable) el.focus();
}

/* ★ 09-13 伪桌面"实时字幕 HUD"：把每一次重放的操作广播给工作台页面，
 *   让"被控制"这件事变成一行行看得见的字幕（"点击 → 计算器 7"）。
 * ▎实现方式很克制：往 iframe 的 document 上 dispatch 一个 CustomEvent——
 *   workbench.html 依旧不知道 WebRTC 的存在，它只是又多监听了一个 DOM 事件。
 * ▎只报"动作"不报 mousemove（每秒几十次移动会把字幕冲成噪声）。 */
function emitWbActivity(kind, extra) {
  try {
    const doc = workbenchFrame.contentDocument;
    if (!doc) return;
    doc.dispatchEvent(new CustomEvent('remote-activity', { detail: Object.assign({ kind }, extra) }));
  } catch (e) { /* 工作台还没就绪，忽略 */ }
}
// 给"点到了什么"起个人话名字：优先按钮的语义（data-act/data-emoji），其次可见文字/类名
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

// ⭐键盘重放（最大的"看起来简单"陷阱）：
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
  if (msg.kind === 'keydown') emitWbActivity('keydown', { key: msg.key }); // ★ 09-13 HUD
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

// ⭐整段文本重放（A2 中文 IME 的被控端半边，与 Mesh 版同构）：
//   控制端把组合输入的最终文本整段发来，这里对"当前焦点的可编辑元素"
//   一次 execCommand('insertText') 插入——和粘贴同款通道，天然支持中文、
//   emoji、任何 UTF-8 字符。焦点不在文本区就忽略：打字没有落点。
function replayText(msg) {
  const doc = workbenchFrame.contentDocument;
  if (!doc || !msg.text) return;
  const active = doc.activeElement || doc.body;
  const editable = active && (active.isContentEditable ||
    active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
  if (!editable) return;
  try { doc.execCommand('insertText', false, msg.text); }
  catch (err) { /* 个别浏览器不支持就跳过 */ }
  emitWbActivity('input-text', { text: msg.text }); // ★ 09-13 HUD：中文整段也上字幕
}

/* ---- 工作台工具条按钮 ---- */
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
 * ★★ 2026-09-11 大升级：A 档（远程协助深化）+ D 档（会议本体 / SFU 深究）
 *
 * ▎这一大段的组织方式（按"谁在管这件事"分成十步，接着第 14 步往下编号）：
 *   第 15 步  D4  成员列表与房间状态（服务器 room-state 快照）
 *   第 16 步  D2  说话人指示器（服务器 mediasoup AudioLevelObserver 量音量）
 *   第 17 步  D3  设备切换（enumerateDevices + producer.replaceTrack）
 *   第 18 步  D5  会议录制（canvas 合成 + AudioContext 混音 + MediaRecorder）
 *   第 19 步  D1  Simulcast 选层（服务器自动升降 + 手动锁定）
 *   第 20 步  A3  剪贴板双向同步
 *   第 21 步  A4  远程截图 + 文件传输（服务器定向分块中继）
 *   第 22 步  A7  触屏支持（长按=右键、双指=滚轮）
 *   第 23 步  A6  审计日志的内容入账（授权件在远端协助那段里）
 *   第 24 步      通用小工具（下载 Blob / 格式化体积）
 *   第 25 步  F3  加入前预览页（设备选择 + 试音条 + 预静音，2026-09-12）
 *   第 26 步  F1/F2 宫格/演讲者双布局 + 钉选 + 双击全屏 + 每人网络质量点（2026-09-12）
 *   第 26b 步 09-13 表情回应（D+1 通道飞屏）+ 举手 + 发言占比条 + 连接方式徽标
 *   第 26c 步 09-14 F5 协作批注（独立 'annot' SCTP 频道 + 定向头过滤 + 事件溯源重放）
 *   第 27 步  D+1 SFU 数据通道（SCTP DataProducer/DataConsumer，聊天主路走它，2026-09-12）
 * ════════════════════════════════════════════════════════════════ */

/* ──────────────────────────────────────────────────────────────
 * 第 15 步：★ D4 成员列表 —— "服务器算好快照，前端照单渲染"
 *
 * ▎数据从哪来？服务器每次"房间有变化"就广播 room-state（进/退/静音/共享/踢人）。
 *   前端**不自己拼状态**（否则各端会因消息顺序不同而对不上）——
 *   这是"单一事实来源（single source of truth）"在 UI 上的体现，面试可讲。
 *
 * ▎上报与广播的分工：
 *   我自己的状态变化 → member-state 上报（服务器存下来）
 *   全房状态快照     → room-state 广播（大家照着画）
 * ────────────────────────────────────────────────────────────── */
function reportMyState(patch) {
  if (!myRoom) return; // 没进房间不用报
  socket.emit('member-state', { patch });
}

let lastMembers = [];   // 最近一次快照（成员列表重建时要用）
let lastLevels = [];    // 最近一次音量数据（列表重建后要立刻把"说话高亮"补回去）

/* ★ 09-25 AI 助理"活状态"：让"它到底在不在听"可被用户看见。
 * ▎为什么值得单独维护一个小状态：改造前 bot 行永远写着"聆听中…"——
 *   这是**无条件的断言**，哪怕 ffmpeg 没装、哪怕房间里没人开麦，它都说"在听"。
 *   无条件的断言就是谎言（和 AI 结论"报告成功却失败"是同一类缺陷）。
 *   现在：字幕在进来 → "已聆听 N 条"；一段时间没有新字幕 → "待机中"。
 * ▎为什么用"字幕条数"当作听觉证据：它恰好是**用户自己也能看到的东西**
 *   （字幕就在屏幕上），所以这个状态是双方可核对的，不是服务器自说自话。 */
let botHeard = { count: 0, lastTs: 0 };
function botHearingNote() {
  const idleMs = Date.now() - botHeard.lastTs;
  if (!botHeard.count) return '待机中（暂无字幕）';
  if (botHeard.lastTs && idleMs < 20000) return `聆听中（已听到 ${botHeard.count} 条）`;
  return `已听到 ${botHeard.count} 条 · 待机`;
}
// 字幕进来时更新该状态并**就地**刷新 bot 行的文案（不整表重建，避免闪）
function bumpBotHeard() {
  botHeard.count++;
  botHeard.lastTs = Date.now();
  const noteEl = memberListEl.querySelector('.ai-bot-row .m-bot-note');
  if (noteEl) noteEl.textContent = botHearingNote();
}

socket.on('room-state', ({ members, expiresAt }) => {
  lastMembers = members || [];
  renderMembers(lastMembers);
  // ★ 09-19：AI Bot 在场状态 → 控制坞按钮亮/灭（快照是唯一权威，谁开关的全房一致）
  const hasBot = lastMembers.some((m) => m.isBot);
  aiBtn.classList.toggle('active', hasBot);
  hasBot ? setIconBtn(aiBtn, ICONS.bot, '送走 AI') : setIconBtn(aiBtn, ICONS.bot, 'AI 助理');
  syncAiTile(hasBot); // ★ 09-26：AI 助理"虚拟参会画面格"随在场状态进出网格
  /* ★ 09-25：AI 在场 → 字幕上行调快（看板要跟着会议实时走）+ 回拉一次看板全量。
   *   为什么在这里判定"AI 在不在"：room-state 是所有客户端都能收到的权威快照，
   *   任何客户端开关助理，全房的上行节奏会一致地跟着切，不需要额外信令。 */
  const botJustArrived = hasBot && !sfuHasBot;
  sfuHasBot = hasBot;
  renderAiChips();                     // ★ 09-25：快捷问法只在 AI 在场时显示
  if (botJustArrived) requestBoard();
  // 被控/控制关系也可以通过快照同步（和 remote-state 广播互为兜底）
  if (expiresAt) { remoteExpiresAt = expiresAt; startCountdown(); }
  applyLayout(); // ★ F1：共享状态变了（比如有人开始共享屏幕），演讲者视图的大画面要跟着换人
});

/* ══════════════════════════════════════════════════════════════
 * ★ 09-25 侧栏分段 + AI 会议看板（前端）
 *
 * ▎看板是什么：服务端（sfu/ai/digest.js）边听边把字幕抽成四类结构化信息，
 *   这里只负责**照单渲染**——不做任何判断、不改写一个字。
 *   这个分工很重要：判断逻辑全在服务器（可单测、全房一致），
 *   前端纯展示（不会出现"不同人看到不同看板"）。
 *
 * ▎为什么要有"新条目闪一下"：看板是常驻侧栏的，不闪的话用户根本注意不到它更新了
 *   （侧栏内容变化很容易被忽略）。闪一下就把"AI 又听出来一条"这件事变成可见的。
 * ══════════════════════════════════════════════════════════════ */
const BOARD_KINDS = [
  // 顺序 = 优先级，与服务端 digest 的判定优先级一致（决定 > 风险 > 行动项 > 议题）
  { key: 'decision', icon: '🎯', label: '决定' },
  { key: 'risk', icon: '⚠️', label: '风险' },
  { key: 'todo', icon: '✅', label: '行动项' },
  { key: 'topic', icon: '💬', label: '议题' },
];
let boardState = { counts: {}, items: {}, total: 0 };
let boardNewKeys = new Set();     // 本次增量到达的条目（渲染时加 .is-new 闪一下）

/** 切侧栏分段（成员 / 看板 / 聊天）。切到聊天时清未读角标。 */
function switchSide(name, opts) {
  document.querySelectorAll('.side-tab').forEach((t) => {
    const on = t.dataset.side === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.side-view').forEach((v) => {
    v.classList.toggle('active', v.dataset.side === name);
  });
  if (name === 'chat') {
    chatUnread = 0;
    renderChatUnread();
    const inp = $('chatInput');
    if (inp && opts && opts.focus) inp.focus();
  }
}
function initSideTabs() {
  document.querySelectorAll('.side-tab').forEach((t) => {
    t.addEventListener('click', () => switchSide(t.dataset.side));
  });
}

/* 未读计数：不在聊天分段时来消息就 +1。
 * ▎为什么值得做：侧栏分段之后，聊天可能被切走——不看角标会真的漏消息。
 *   这是"改布局引入的新需求"，必须一起补，否则改 tab 就是体验倒退。 */
let chatUnread = 0;
function renderChatUnread() {
  const el = $('chatUnread');
  if (!el) return;
  el.textContent = String(chatUnread > 99 ? '99+' : chatUnread);
  el.classList.toggle('hidden', !chatUnread);
}
function noteChatActivity() {
  const chatView = document.querySelector('.side-view[data-side="chat"]');
  if (chatView && chatView.classList.contains('active')) return;  // 正在看聊天，不用提醒
  chatUnread++;
  renderChatUnread();
}

/** 渲染看板（全量重建——条目数最多 4×20，重建最简单也最不容易漏状态） */
function renderBoard() {
  const listEl = $('boardList');
  const emptyEl = $('boardEmpty');
  const numEl = $('boardNum');
  const subEl = $('boardSub');
  if (!listEl || !emptyEl) return;   // 假 DOM / 未渲染时安全返回

  const items = boardState.items || {};
  const counts = boardState.counts || {};
  const total = BOARD_KINDS.reduce((n, k) => n + ((items[k.key] || []).length), 0);

  if (numEl) {
    numEl.textContent = String(total);
    numEl.classList.toggle('hidden', !total);
  }
  if (subEl) {
    subEl.textContent = boardState.total
      ? `已消化 ${boardState.total} 条字幕`
      : 'AI 边听边整理';
  }
  emptyEl.classList.toggle('hidden', total > 0);

  listEl.textContent = '';
  for (const k of BOARD_KINDS) {
    const arr = items[k.key] || [];
    if (!arr.length) continue;             // 空栏目不显示（避免四个空标题占位）
    const sec = document.createElement('div');
    sec.className = 'board-sec';
    const h = document.createElement('div');
    h.className = 'board-sec-h';
    h.innerHTML = `<span>${k.icon} ${k.label}</span><span class="bsh-n">${arr.length}</span>`;
    sec.appendChild(h);

    for (const it of arr) {
      const row = document.createElement('div');
      row.className = `board-item k-${k.key}`;
      /* 新条目高亮：键与服务端一致（kind|时间戳|文本前 20 字），
       * 用 ts+text 组合而不是纯 ts——同一毫秒可能来两条。 */
      if (boardNewKeys.has(`${k.key}|${it.ts}|${String(it.text).slice(0, 20)}`)) row.classList.add('is-new');
      // ★ 全部走 escapeHtml：看板内容是**用户说的原话**，不转义就是 XSS 直通车
      /* ★ 09-25 行动项的三字段都要看得见（真浏览器测试暴露的 UI 缺口）：
       *   认领之后界面上只少了"待认领"三个字，**却没显示负责人是谁**——
       *   用户会问"那到底谁负责？"。行动项的价值就是"谁 / 做什么 / 何时"三件事，
       *   少一件这块看板就等于没做完。所以负责人要单独成一枚徽标。 */
      const ownerChip = (k.key === 'todo' && it.owner)
        ? `<span class="bi-owner" title="已认领的负责人">👤 ${escapeHtml(it.owner)}</span>` : '';
      const meta = `<div class="bi-meta"><span class="bi-who">${escapeHtml(it.name || '成员')}</span>`
        + ownerChip
        + `${it.due ? `<span class="bi-due">${escapeHtml(it.due)}</span>` : ''}</div>`;
      // 行动项显示"任务"字段（结构化后的 clean 版），其余类目显示原话
      const bodyText = k.key === 'todo' && it.task ? it.task : it.text;
      let body = `<div class="bi-text">${escapeHtml(bodyText)}</div>`;
      // 无主行动项 = 需要有人认领（看板上最该被看见、也最该能被动手的一类）
      if (k.key === 'todo' && !it.owner) body += '<span class="bi-ownerless">待认领</span>';
      row.innerHTML = meta + body;
      /* ★ 09-25：「我来」按钮——把"待认领"从一句提示变成**一个动作**。
       *   至此看板不只是"看"，而是能就地协作：AI 提出问题，人在同一个界面里认领。
       *   这是"AI 参会"真正落地的地方（比再多一个 AI 能力更有价值）。 */
      if (k.key === 'todo' && !it.owner) {
        const claimBtn = document.createElement('button');
        claimBtn.className = 'bi-claim';
        claimBtn.textContent = '我来';
        claimBtn.title = '认领这条行动项（全房可见，服务器记账）';
        claimBtn.addEventListener('click', () => claimTodo(it.ts, claimBtn));
        row.appendChild(claimBtn);
      }
      sec.appendChild(row);
    }
    listEl.appendChild(sec);
  }
  // 高亮只生效一次（下一帧渲染就不该再闪了）
  if (boardNewKeys.size) setTimeout(() => { boardNewKeys.clear(); }, 2400);
}

/* 服务端推来的增量看板更新 */
socket.on('ai-board', (payload) => {
  if (!payload) return;
  boardState = { counts: payload.counts || {}, items: payload.items || {}, total: payload.total || 0 };
  const added = payload.added || {};
  boardNewKeys = new Set();
  for (const k of BOARD_KINDS) {
    for (const it of (added[k.key] || [])) boardNewKeys.add(`${k.key}|${it.ts}|${String(it.text).slice(0, 20)}`);
  }
  renderBoard();
  /* 有新条目时若用户不在看板分段，给个小提示——不然"AI 又听出来一条"完全不可见。
   * 只在真的有新增时才提，且不抢焦点（不自动切过去，那太粗暴）。 */
  const addedCount = BOARD_KINDS.reduce((n, k) => n + ((added[k.key] || []).length), 0);
  if (addedCount) {
    const boardView = document.querySelector('.side-view[data-side="board"]');
    if (boardView && !boardView.classList.contains('active')) {
      const tab = document.querySelector('.side-tab[data-side="board"]');
      if (tab) { tab.classList.add('flash'); setTimeout(() => tab.classList.remove('flash'), 1600); }
    }
  }
});

/* 主动拉一次全量：ai-board 是"推"，晚进房/刷新的人会错过之前的广播。
 * 推保证实时、拉保证完整——两者缺一不可。 */
function requestBoard() {
  try {
    socket.emit('ai-board-get', {}, (r) => {
      const data = r && r.data;
      if (!data) return;
      boardState = { counts: data.counts || {}, items: data.items || {}, total: data.total || 0 };
      renderBoard();
    });
  } catch (e) { /* 未连接等异常：看板空着不影响会议 */ }
}

/* 快捷问法：点一下就把问题填进输入框并发送（等价于手打 "@ai xxx"）。
 * ▎为什么值得做：AI 的能力是"隐藏"的——用户不知道可以问什么，就不会问。
 *   把最常用/最能体现智能的四个问题做成按钮，比写一段说明文字有效得多。
 *   四个问题也是刻意挑的：前两个吃**看板**（考实时消化），
 *   后两个吃**检索+意图分类**（考 RAG 与动作识别）——一次点击就演示了整条 AI 链路。 */
function initAiChips() {
  const chips = $('aiChips');
  if (!chips) return;
  chips.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('.ai-chip') : null;
    if (!btn) return;
    const q = btn.dataset.q || '';
    const inp = $('chatInput');
    if (inp) inp.value = '';
    // 直接走 sendChat 那条路（与手打 "@ai …" 完全同一条链路，不做特例分支）
    sendAiQuestion(q);
  });
}

function renderAiChips() {
  const chips = $('aiChips');
  if (!chips) return;
  // 只在 AI 助理入会时显示（它不在会里，点了也只会触发自动入会+回答，反而不如不显示引导）
  chips.classList.toggle('hidden', !sfuHasBot);
}

/* 看板头的「📝 出纪要」：看板看够了直接要一份文档，不用回聊天分段再找入口。
 * ▎这是"看板 → 产物"的最短路径：看板上你刚看到 3 条决定 2 条待办，
 *   这时候最自然的动作就是"给我一份文件"，而不是切走去找按钮。 */
function initBoardActions() {
  const btn = $('boardMinutesBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (!myRoom) { showToast('先进房间再生成纪要', 'error'); return; }
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '生成中…';
    try {
      const res = await request('ai-minutes', { type: 'segment' });
      showToast(res.data.mock ? '纪要已生成（[Mock] 本地模板）' : '纪要已生成（LLM 撰写）', 'ok');
      log(`📝 纪要已生成：${res.data.path}`);
    } catch (err) {
      showToast('纪要生成失败：' + (err.message || err), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  });
}

/* ══════════════════════════════════════════════════════════════
 * ★ 09-25 AI 语音播报（浏览器原生 speechSynthesis，零依赖）
 *
 * ▎为什么给 AI 加"嘴"：它此前只有"耳朵"（服务端音频管线）和"文字嘴"（聊天）。
 *   会中它主动提醒"这条行动项还没有负责人"时，你若正盯着共享屏幕，
 *   侧栏那行字很可能根本没被注意到——**提醒没被听见就等于没提醒**。
 *   语音是唯一能"不占眼球"的提醒通道。
 *
 * ▎默认**关**：默认出声会惊吓用户（"这网页怎么突然说话"）。
 *   这是刻意留给用户主动开启的能力，选择权在用户手里。
 *   顺带它也是一条无障碍通道（视障用户不必逐条读聊天）。
 *
 * ▎为什么不用云 TTS：又贵又要网又要把会议内容发给第三方——
 *   而这个场景只需要"把已经确定的文本念出来"，浏览器原生能力完全够用。
 * ══════════════════════════════════════════════════════════════ */
let aiVoiceOn = false;
try { aiVoiceOn = localStorage.getItem('sfuAiVoice') === '1'; } catch (e) { /* 隐私模式等：默认关 */ }

const SPEECH_OK = typeof window !== 'undefined' && 'speechSynthesis' in window;

/* 把 markdown 洗成"能念的句子"。
 * ▎必须洗：AI 的文本里有 `**加粗**`、`@ai`、`/minutes/xxx.md`、表格竖线等，
 *   直接念会变成"星号星号加粗星号星号""斜杠 minutes 斜杠…"，非常刺耳。
 *   这也是"给机器读的文本"和"给人听的文本"必须分开处理的典型案例。 */
function speakableText(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, '（代码块）')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/^[#>\-\s|]+/gm, '')
    .replace(/\|/g, '，')
    .replace(/https?:\/\/\S+/g, '（链接）')
    .replace(/\/minutes\/\S+/g, '（纪要文件）')
    .replace(/@ai/gi, 'A I')
    .replace(/[📚💬🎯📌⚠️✅👋📋🌙🏁🛰️🔈🤖]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);   // 太长的答案念不完会妨碍开会，截断
}

function speakAiText(text) {
  if (!aiVoiceOn || !SPEECH_OK) return;
  const say = speakableText(text);
  if (!say) return;
      try {
      /* ★ 09-26e 语音去 AI 味——三层优化：
       *  ① 音色策略：自然神经音色优先（Online (Natural) / Premium / 常见自然音色名）——
       *     它们与老式 SAPI 音色的差距就是“AI 味”与“真人味”的差距；
       *  ② 分句队列：按句末标点切段排队朗读，句间自然停顿、语调重新起势，
       *     接近真人节奏；新回答到来 cancel+清队列，“只说最新”语义不变；
       *  ③ 参数：rate 1.02（自然音色语速快，过快吞字）、pitch 1.05 略亮。 */
      window.speechSynthesis.cancel();
      aiSpeakQueue.length = 0;
      const pickVoice = () => {
        try {
          const vs = window.speechSynthesis.getVoices() || [];
          const zh = vs.filter((v) => /zh[-_]?CN|Chinese|中文|普通话/i.test(v.lang + ' ' + v.name));
          const prefs = [
            /(Online.*Natural|Natural.*Online)/i,
            /Xiaoxiao|Xiaoyi|云希|云野|晓晓|晓伊/i,
            /Premium|Enhanced/i,
            /Huihui|Yaoyao|Kangkang/i,
          ];
          for (const re of prefs) {
            const hit = zh.find((v) => re.test(v.name));
            if (hit) return hit;
          }
          return zh[0] || null;
        } catch (e) { return null; }
      };
      const voice = pickVoice();
      const sentences = say.split(/(?<=[。！？!?..])/).reduce((acc, seg) => {
        if (!seg) return acc;
        if (acc.length && (acc[acc.length - 1] + seg).length < 6) acc[acc.length - 1] += seg;
        else acc.push(seg);
        return acc;
      }, []);
      aiSpeakQueue.push(...sentences.filter((x) => x.trim()));
      const speakNext = () => {
        if (!aiSpeakQueue.length) return;
        const part = aiSpeakQueue.shift();
        if (Date.now() > aiSpeakDeadline) { aiSpeakQueue.length = 0; return; }
        const u = new SpeechSynthesisUtterance(part);
        u.lang = 'zh-CN';
        u.rate = 1.02;
        u.pitch = 1.05;
        if (voice) u.voice = voice;
        u.onend = () => setTimeout(speakNext, 120); // 句间自然停顿
        window.speechSynthesis.speak(u);
      };
      aiSpeakDeadline = Date.now() + Math.max(20000, say.length * 400);
      speakNext();
    } catch (e) { /* 播报失败绝不影响会议功能 */ }
}
let aiSpeakQueue = [];   // 分句朗读队列
let aiSpeakDeadline = 0; // 本轮朗读截止时刻（超时保护）

function updateAiVoiceUi() {
  const btn = $('aiVoiceBtn');
  if (!btn) return;
  btn.classList.toggle('active', aiVoiceOn);
  btn.textContent = aiVoiceOn ? '🔊 AI 语音' : '🔈 AI 语音';
  btn.title = !SPEECH_OK
    ? '当前浏览器不支持语音合成（speechSynthesis），该功能不可用'
    : (aiVoiceOn
      ? 'AI 语音播报：已开启（点一下关闭）。AI 说的话会用浏览器语音念出来'
      : 'AI 语音播报（默认关）：开启后 AI 说的话会用浏览器语音念出来');
  btn.disabled = !SPEECH_OK || !myRoom;   // 不支持语音 / 还没进房 → 不可点
  if (!SPEECH_OK) btn.classList.add('ai-voice-na');
}

function initAiVoice() {
  const btn = $('aiVoiceBtn');
  updateAiVoiceUi();
  if (!btn) return;
  btn.addEventListener('click', () => {
    aiVoiceOn = !aiVoiceOn;
    try { localStorage.setItem('sfuAiVoice', aiVoiceOn ? '1' : '0'); } catch (e) { /* 存不了就只在本次生效 */ }
    if (!aiVoiceOn) { try { window.speechSynthesis.cancel(); } catch (e) { /* */ } }  // 关掉时立刻闭嘴
    updateAiVoiceUi();
    log(aiVoiceOn ? '🔊 AI 语音播报已开启（AI 说的话会被念出来）' : '🔈 AI 语音播报已关闭');
  });
  /* 某些浏览器 voices 是异步加载的（首次 getVoices 可能返回空数组）。
   * 挂一次 voiceschanged，让首次播报就能用上中文音色。 */
  if (SPEECH_OK) {
    try { window.speechSynthesis.onvoiceschanged = () => { /* 触发一次加载即可，取用时再挑 */ }; } catch (e) { /* */ }
  }
}

/* ★ 09-25 证据链（可展开）：把"AI 检索到了哪几条字幕"从数字变成**能看到原话**。
 * ▎为什么这一步重要：此前气泡上只有"📚 检索 29 条字幕取 1 条"——那仍然只是一个**数字**，
 *   用户只能选择相信或不相信。把原话摊开之后，用户才能自己核对
 *   "它是不是照着我说的那句回答的"，这才是"可验证"从口号变成事实。
 * ▎做成 <details> 折叠而不是默认展开：默认展开会把每条答案的气泡撑得很长，
 *   把"随时能查"变成"每条都要滚"——可验证不该以牺牲可读性为代价。
 * @returns {string} HTML（全部经 escapeHtml，原话是用户输入） */
function traceEvidenceHtml(ai, streamHitList) {
  const list = (streamHitList && streamHitList.length) ? streamHitList
    : ((ai && ai.hitList) || []);
  if (!list.length) return '';
  /* ★ 09-25：标注每条依据的**来源**（看板条目 / 会议字幕）。
   *   为什么要标：两者可信度不同——"看板条目"是系统结构化抽取过的（可能有抽取误差），
   *   "会议字幕"是原话。不标来源就分不清"AI 引用的是整理结果还是原始发言"。 */
  const isBoard = list.some((h) => h.src === '看板');
  const rows = list.map((h) =>
    `<li>${h.src ? `<span class="ev-src">${escapeHtml(h.src)}</span>` : ''}`
    + `<span class="ev-who">${escapeHtml(h.name || '成员')}</span>`
    + `<span class="ev-text">${escapeHtml(h.text || '')}</span></li>`).join('');
  return `<details class="msg-ai-ev"><summary>🔍 看 AI 依据的 ${list.length} 条${isBoard ? '看板条目' : '原话'}</summary>`
    + `<ol class="ev-list">${rows}</ol></details>`;
}

/* 认领一条无主行动项。
 * ▎走服务器（而非本地改状态）：认领结果必须**全房一致**，否则两人同时认领会各自
 *   看到不同的负责人，事后必然扯皮。服务器回来后会广播新的看板，这里不做本地乐观更新——
 *   "先显示成功、再被服务器拒绝"是这类协作操作最伤信任的体验。 */
function claimTodo(ts, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '认领中…'; }
  try {
    socket.emit('ai-board-claim', { ts }, (r) => {
      if (r && r.error) {
        showToast(r.error, 'error');
        if (btn) { btn.disabled = false; btn.textContent = '我来'; }
        return;
      }
      // 成功：服务器会广播新看板，界面随之刷新（按钮自然消失）；这里只补一句本地反馈
      showToast('已认领，AI 已记下', 'ok');
    });
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '我来'; }
    showToast('认领失败：' + (e.message || e), 'error');
  }
}

function renderMembers(members) {
  memberNumEl.textContent = members.length;
  const me = members.find((m) => m.id === socket.id);
  ownerTag.classList.toggle('hidden', !(me && me.owner)); // 只有房主看到"你是房主"角标

  memberListEl.textContent = ''; // 重建式渲染（成员数很少，最不容易漏状态）
  agentPeers.clear();            // ★ 09-24：代理名单跟着快照重建（离场的代理不能留在名单里）
  for (const m of members) {
    const isMe = m.id === socket.id;
    const row = document.createElement('div');
    row.className = `member-row${isMe ? ' me' : ''}`;
    row.dataset.id = m.id; // ★ D2：说话高亮要按 id 找行，所以把 id 存在 dataset 上
    if (m.avatar && !m.isBot) {
      row.classList.add('has-av'); // ★ 09-26：图片头像（CSS 盖过 ::before 圆点；img 在 innerHTML 重建后补）
    }
    if (m.isBot) {
      /* ★ 09-19 AI Bot 行：无媒体无网络概念，一张安静的"机器同事"名牌。
       * ★ 09-25 参会升级：不再是死的"聆听中…"，而是**活的状态**——
       *   ① 显示它当前真正能听见什么（字幕条数 / 待机），让"它到底在不在听"可验证；
       *   ② 行尾给一个「提问」按钮，把"@ai 提问"这条隐藏用法变成可点的入口
       *      （隐藏功能等于没有功能；这是 AI 参会里最容易漏掉的一环）。 */
      row.classList.add('ai-bot-row');
      const note = botHearingNote();   // 由最近一次快照/字幕事件维护的活状态
      row.classList.add('has-av');
      row.innerHTML = `<span class="ai-av"><img src="/avatars/ai/xiaoming-anim.webp" alt=""></span>`
        + `<span class="m-id">${ICONS.bot} ${escapeHtml(m.name || 'AI 小明')}`
        + `<span class="m-bot-note" title="AI 助理的实时状态">${escapeHtml(note)}</span></span>`;
      aiAvatar.rowEl = row.querySelector('.ai-av'); // ★ 09-26：状态机刷新时换五态图
      const askBtn = document.createElement('button');
      askBtn.className = 'btn m-ai-ask-btn';
      askBtn.textContent = '提问';
      askBtn.title = '向 AI 助理提问（等价于在聊天里发「@ai 你的问题」）';
      askBtn.addEventListener('click', () => {
        const inp = $('chatInput');
        if (inp) { inp.value = '@ai '; inp.focus(); }
        log(`🤖 在聊天框里输入你的问题（已自动带上 @ai 前缀）；开会时提到「${AI_NICKNAME}」它会自动接话`);
      });
      row.appendChild(askBtn);
      memberListEl.appendChild(row);
      continue;
    }
    /* ★ 09-24 真远程桌面：桌面代理行。
     * 和 AI Bot 行同一个思路 —— 成员列表里除了"人"，还有"机器"，
     * 各给一种一眼可辨的样式，而不是糊成一行灰字让人猜。
     * 按钮文案也不叫"请求控制"，叫「控制电脑」：因为对被控端是人的情况，
     * 控的是他页面里的工作台；对代理，控的是他整台电脑的浏览器 —— 语义不同就别用同一个词。 */
    if (m.agent) {
      row.classList.add('agent-row');
      row.innerHTML = `<span class="m-id" title="${escapeHtml(m.name || '')}">`
        + `🖥️ ${escapeHtml(m.name || '桌面代理')}<span class="m-agent-note">可被控</span></span>`;
      agentPeers.set(m.id, { name: m.name || '桌面代理', info: m.agentInfo || null });
      if (!isMe) {
        const cbtn = document.createElement('button');
        cbtn.className = 'btn m-ctrl-btn';
        cbtn.textContent = '控制电脑';
        cbtn.title = '申请远程控制这台电脑的真实浏览器（能开网站、能登录、能操作）';
        cbtn.addEventListener('click', () => requestRemoteControl(m.id));
        row.appendChild(cbtn);
      }
      memberListEl.appendChild(row);
      continue;
    }
    // ★ 09-16：登录用户的昵称贯通成员列表（未登录回退"成员 xxxx"）
    const who = isMe ? `我${myDisplayName ? ' · ' + myDisplayName : ''}` : (m.name || `成员 ${shortId(m.id)}`);
    row.innerHTML = `<span class="m-id" title="${escapeHtml(m.name || '')}">${escapeHtml(who)}</span>`;
    if (m.avatar && !m.isBot) {
      // ★ 09-26：头像 img 放在 innerHTML 重建**之后**再 prepend——
      //   先 prepend 再重建会被覆盖；而"重建后查询"在冒烟桩里会自动造元素（坑 27 家族），两头的坑都绕开
      const av = document.createElement('img');
      av.className = 'avatar-img';
      av.src = `/avatars/presets/${m.avatar}.png`;
      av.alt = '';
      row.prepend(av);
    }
    const badges = document.createElement('span');
    badges.className = 'm-badges';
    row.appendChild(badges);

    /* ★ F 档升级（2026-09-12）：行内新增两样东西
     *   · 网络质量点（.m-net）——数据来自服务器 net-levels 广播（第 26 步），○/● 变色；
     *   · 音量条（.vol-bar）——和视频格共用第 16 步 setSpeaking，谁说话哪行就出绿条。 */
    const netDot = document.createElement('span');
    netDot.className = 'm-net net-dot net-3';
    netDot.title = '网络质量：暂无数据';
    netDot.textContent = '○';
    row.appendChild(netDot);
    const volBar = document.createElement('span');
    volBar.className = 'vol-bar';
    volBar.appendChild(document.createElement('i'));
    row.appendChild(volBar);

    // ★ 09-13：发言占比条（行底细条，数据来自服务器 talk-stats 广播）——
    //   "谁主导了这场会"一眼可见（真实会议复盘里最有用的一张图）
    const talkBar = document.createElement('span');
    talkBar.className = 'm-talk';
    const talkFill = document.createElement('i');
    const tstat = talkStatsById.get(m.id);
    talkFill.style.width = (tstat ? tstat.share : 0) + '%';
    talkBar.appendChild(talkFill);
    row.appendChild(talkBar);

    const addBadge = (text, title) => {
      const s = document.createElement('span');
      s.innerHTML = text; // ★ 09-19e：徽标传 ICONS 常量 SVG（常量无 XSS 风险）
      s.title = title || '';
      badges.appendChild(s);
    };
    if (m.owner) addBadge(ICONS.crown, '房主（可移出成员）');
    if (m.sharing) addBadge(ICONS.screen, '正在共享屏幕');
    if (m.muted) addBadge(ICONS.micOff, '已静音');
    if (m.camOff) addBadge(ICONS.camOff, '摄像头已关');
    if (m.hand) addBadge(ICONS.hand, '举手中（想发言）'); // ★ 09-13 F4
    if (m.caption) addBadge(ICONS.cc, '字幕开启中'); // ★ 09-17b：实时字幕状态（member-state 白名单）

    if (!isMe) {
      // ★ D+2（09-15）：服务器侧录制 —— 点 ⏺ 开始录"TA 的摄像头+麦克风"（服务器 ffmpeg 落盘），
      //   再点 ⏹ 停止；产物经 /recordings/<file> 下载。服务器没装 ffmpeg 会弹明确提示。
      const recBtn = document.createElement('button');
      recBtn.className = 'mini';
      recBtn.innerHTML = ICONS.recOn;
      recBtn.title = '服务器侧录制 TA 的摄像头+麦克风（D+2，产物在服务器 recordings/）';
      recBtn.addEventListener('click', async () => {
        try {
          const existing = recordingsByMember.get(m.id);
          if (existing) {
            const stopped = await request('record-stop', { recordId: existing });
            recordingsByMember.delete(m.id);
            recBtn.innerHTML = ICONS.recOn;
            /* ★ 09-24 C4：/recordings/<文件> 改成"admin 或短时效签名 URL"才放行；非管理员的
             *   录制者靠服务器回的签名 URL（默认 1 小时有效）下载自己的产物。写进流程日志可点/复制。 */
            const dlUrl = stopped && stopped.data && stopped.data.url;
            if (dlUrl) {
              log(`⏹ 录制已停止，下载链接（1 小时内有效）：${dlUrl}`);
              showToast('⏹ 已停止录制，下载链接见下方「流程日志」', 'info');
            } else {
              showToast(`⏹ 已停止录制，文件在服务器 recordings/ 目录`, 'info');
            }
          } else {
            const resp = await request('record-start', { memberId: m.id });
            recordingsByMember.set(m.id, resp.data.recordId);
            recBtn.innerHTML = ICONS.recStop;
            showToast(`⏺ 已开始服务器录制（成员 ${shortId(m.id)}）`, 'info');
          }
        } catch (err) {
          showToast('❌ ' + err.message, 'error');
        }
      });
      row.appendChild(recBtn);
      // ★ A4：给任意成员发文件（点 📎 选文件 → file-offer）
      const fileBtn = document.createElement('button');
      fileBtn.className = 'mini';
      fileBtn.innerHTML = ICONS.clip;
      fileBtn.title = '发文件给 TA';
      fileBtn.addEventListener('click', () => pickFileFor(m.id));
      badges.appendChild(fileBtn);

      // ★ D4：房主可以移出成员（服务器会再校验一次权限，前端只是入口）
      if (me && me.owner) {
        const kickBtn = document.createElement('button');
        kickBtn.className = 'mini';
        kickBtn.innerHTML = ICONS.door;
        kickBtn.title = '移出房间（仅房主可用）';
        kickBtn.addEventListener('click', () => kickMember(m.id));
        badges.appendChild(kickBtn);
      }
    }
    memberListEl.appendChild(row);
  }
  applyLevels(lastLevels); // 列表刚重建，把音量高亮补回去
  applyNetDots();          // ★ F2：网络质量点也补回去（等级数据存在 netLevelsById 里）
  updateAgentHint();       // ★ 09-24：房间里有代理就收起"怎么启动代理"的指引卡片
}

function kickMember(id) {
  log(`🚪 正在把成员 ${shortId(id)} 移出房间...`);
  socket.emit('kick-member', { to: id });
}

// 我自己被踢：服务器先发 kicked，再断连接 → 前端给用户一个明确提示后刷新
socket.on('kicked', ({ by }) => {
  leaving = true; // 被踢不是断线，别去重连
  log(`🚪 你已被房主（成员 ${shortId(by)}）移出房间`);
  showToast('🚪 你已被房主移出房间', 'error');
  setTimeout(() => { socket.disconnect(); location.reload(); }, 1500);
});
socket.on('kick-denied', () => {
  log('❌ 只有房主能移出成员');
  showToast('只有房主能移出成员', 'error');
});

/* ──────────────────────────────────────────────────────────────
 * 第 16 步：★ D2 说话人指示器 —— 数据来自**服务器**的 mediasoup AudioLevelObserver
 *
 * ▎和 Mesh 版的根本差异（这条是"SFU 深究"的好素材）：
 *   Mesh 没有服务器媒体层 → 只能在每个浏览器里用 AudioContext 各自分析每条远端流（算 N 遍）；
 *   SFU 的音频本来就经服务器转发 → 服务器顺手量一次，广播给全房（算 1 遍、全房一致）。
 *   这是"中心化架构的天然优势"：需要全房统一的状态，放在中心点最省。
 *
 * ▎volume 的单位是 dB（-127 ~ 0）：-55dB 以下服务器就不报了（那是底噪）。
 *   前端把 dB 映射成 0~100% 的音量条宽度。
 * ────────────────────────────────────────────────────────────── */
socket.on('audio-levels', ({ levels }) => {
  lastLevels = levels || [];
  // ★ F1：记住"现在谁最大声"（服务器已按音量从大到小排序，第一个就是 top）。
  //   演讲者视图的大画面要跟着他走；全房安静时置 null，大画面回退到共享者/自己。
  // ★ 09-18 交接迟滞：候选人与现任不同时，必须连续坐稳 SPEAKER_HOLD_MS 才交接
  //   （含安静回退 null）——高亮/音量条（applyLevels）仍然即时，迟滞的只是大画面归属。
  const top = lastLevels.length ? lastLevels[0].id : null;
  const now = Date.now();
  if (top !== pendingSpeakerId) {
    pendingSpeakerId = top;          // 换候选人：重新计时
    pendingSpeakerSince = now;
  } else if (top !== currentSpeakerId && now - pendingSpeakerSince >= SPEAKER_HOLD_MS) {
    currentSpeakerId = top;          // 坐稳：交接（top 为 null 即"安静回退"）
  }
  applyLevels(lastLevels);
  applyLayout(); // ★ F1：演讲者视图下大画面跟随说话人（宫格视图下只是重打几个 class，开销可忽略）
});

function applyLevels(levels) {
  const byId = new Map((levels || []).map((l) => [l.id, l.volume]));
  // ① 本地那一格（自己的麦克风也在服务器的观察者里，所以自己说话自己也会亮）
  setSpeaking(document.querySelector('.video-box.self'), byId.get(socket.id));
  // ② 每个远端成员的主画面格
  for (const [id, main] of peerMains) setSpeaking(main.box, byId.get(id));
  // ③ 右侧成员列表（没有视频格也要能看出谁在说话）
  for (const row of memberListEl.querySelectorAll('.member-row')) {
    setSpeaking(row, byId.get(row.dataset.id));
  }
}

// 给一个元素（视频格或成员行）设置"是否在说话 + 音量条宽度"
function setSpeaking(el, volume) {
  if (!el) return;
  const talking = typeof volume === 'number' && volume > -55;
  el.classList.toggle('speaking', talking);
  const bar = el.querySelector('.vol-bar > i');
  if (bar) {
    // dB → 百分比：-55dB 记 0%，0dB 记 100%（线性拉伸，够直观，不用追求声学精确）
    const pct = talking ? Math.max(5, Math.min(100, Math.round(((volume + 55) / 55) * 100))) : 0;
    bar.style.width = `${pct}%`;
  }
}

/* ──────────────────────────────────────────────────────────────
 * 第 17 步：★ D3 设备切换 —— enumerateDevices + replaceTrack
 *
 * ▎两个关键点（面试考点）：
 *   ① 设备列表：deviceId 要**授权之后**才拿得到，label（设备名）更是如此——
 *      所以必须在 getUserMedia 成功之后再列设备，否则名字全是空的。
 *   ② 换设备：不要重新 produce（那会在服务器上多建一路、别端画面会闪断），
 *      而是 producer.replaceTrack({ track }) —— "同一路媒体换个源"，
 *      对服务器和观众而言完全透明（和屏幕共享 replaceTrack 是一套原理）。
 * ────────────────────────────────────────────────────────────── */
async function refreshDeviceList() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    fillDeviceSelect(camSelect, devices.filter((d) => d.kind === 'videoinput'), cameraTrack && cameraTrack.getSettings().deviceId);
    fillDeviceSelect(micSelect, devices.filter((d) => d.kind === 'audioinput'),
      localStream && localStream.getAudioTracks()[0] && localStream.getAudioTracks()[0].getSettings().deviceId);
    // ★ F3：预览页的两个下拉框同步填（和会内的 camSelect/micSelect 用同一份设备清单）
    fillDeviceSelect(pjCamSelect, devices.filter((d) => d.kind === 'videoinput'), cameraTrack && cameraTrack.getSettings().deviceId);
    fillDeviceSelect(pjMicSelect, devices.filter((d) => d.kind === 'audioinput'),
      localStream && localStream.getAudioTracks()[0] && localStream.getAudioTracks()[0].getSettings().deviceId);
  } catch (err) {
    log(`⚠️ 读取设备列表失败：${err.message}`);
  }
}

function fillDeviceSelect(sel, list, currentId) {
  sel.textContent = '';
  list.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    // label 为空 = 还没授权（Chrome 的行为），给个兜底名字
    opt.textContent = d.label || `${sel === camSelect ? '摄像头' : '麦克风'} ${i + 1}`;
    if (currentId && d.deviceId === currentId) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.disabled = list.length === 0;
  if (list.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = sel === camSelect ? '（没有摄像头）' : '（没有麦克风）';
    sel.appendChild(opt);
  }
}

// 换摄像头：拿新轨 → 对摄像头的 Producer replaceTrack → 更新本地预览
// ★ F6：滤镜管线开着时这条路径要"绕着管线走"——localStream 里挂的是处理后的轨（canvas 轨），
//   正确动作是"只换管线的输入源"，而不是把 localStream/上行轨直接换成新摄像头原始轨。
async function switchCamera(deviceId) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } }, audio: false });
    const newTrack = stream.getVideoTracks()[0];
    const producer = findCameraProducer();
    let upstream = newTrack; // 这次 replaceTrack 应该上行的那条轨（滤镜开着 = 处理后的轨）
    if (fx.on && fx.procTrack) {
      // 滤镜开着：① 停掉**原始**旧摄像头轨（省电+松设备），但绝不能 stop procTrack（会连管线一起停）；
      //   ② 管线输入源换成新摄像头（video.srcObject 重挂，画布尺寸不变、procTrack 引用不动）；
      //   ③ localStream 里"拿下旧 proc 轨再原样插回"（引用不变，观众/预览都无感）。
      if (cameraTrack) localStream.removeTrack(cameraTrack);
      if (fx.origTrack) fx.origTrack.stop();
      fx.origTrack = newTrack;
      try { fx.video.srcObject = new MediaStream([newTrack]); } catch (e) { /* 桩环境无碍 */ }
      localStream.addTrack(fx.procTrack);
      cameraTrack = fx.procTrack;
      upstream = fx.procTrack;
    } else {
      // 没开滤镜：照旧——旧轨停掉（否则摄像头灯一直亮），新轨顶进 localStream
      if (cameraTrack) { localStream.removeTrack(cameraTrack); cameraTrack.stop(); }
      localStream.addTrack(newTrack);
      cameraTrack = newTrack;
    }
    if (producer) {
      await producer.replaceTrack({ track: upstream }); // ★ 关键：换轨不重连（服务器那头无感）
      log(`🎥 已切换摄像头（replaceTrack，未重建通道${fx.on ? ' · 滤镜保持生效' : ''}）`);
    }
    // 本地预览刷新；保持"关摄像头"状态不被打回（滤镜开着时设的是新原始轨的 enabled，
    //   procTrack 的 enabled 原样保留——它才真正决定观众看到什么）
    newTrack.enabled = camBtn.textContent === '关摄像头';
    localVideo.srcObject = localStream;
  } catch (err) {
    log(`❌ 切换摄像头失败：${err.message}`);
    showToast('❌ 切换摄像头失败（可能被占用）', 'error');
  }
}

async function switchMic(deviceId) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: { deviceId: { exact: deviceId } } });
    const newTrack = stream.getAudioTracks()[0];
    const producer = [...myProducers.values()].find((p) => p.appData && p.appData.source === 'mic');
    if (producer) {
      await producer.replaceTrack({ track: newTrack });
      log('🎤 已切换麦克风（replaceTrack，未重建通道）');
    }
    const old = localStream.getAudioTracks()[0];
    if (old) { localStream.removeTrack(old); old.stop(); }
    localStream.addTrack(newTrack);
    newTrack.enabled = muteBtn.textContent === '静音'; // 保持静音状态
    localVideo.srcObject = localStream;
  } catch (err) {
    log(`❌ 切换麦克风失败：${err.message}`);
    showToast('❌ 切换麦克风失败（可能被占用）', 'error');
  }
}

camSelect.addEventListener('change', () => switchCamera(camSelect.value));
micSelect.addEventListener('change', () => switchMic(micSelect.value));
// 插拔设备（插上耳机/拔掉摄像头）→ 列表自动刷新，这是浏览器给的原生事件
if (navigator.mediaDevices && 'ondevicechange' in navigator.mediaDevices) {
  navigator.mediaDevices.addEventListener('devicechange', () => {
    log('🔌 检测到设备变化，正在刷新设备列表...');
    refreshDeviceList();
  });
}

/* ──────────────────────────────────────────────────────────────
 * 第 18 步：★ D5 会议录制 —— canvas 合成画面 + AudioContext 混音 + MediaRecorder
 *
 * ▎三件事拼起来才叫"录会议"：
 *   ① 画面：把每路 <video> 画进一张 canvas（网格布局），canvas.captureStream(15) 变视频流；
 *   ② 声音：WebAudio 把"我的麦克风 + 每个人的声音"混成一路（createMediaStreamDestination）；
 *   ③ 封装：MediaRecorder 把 ①+② 录成 webm，停止时拼成 Blob 下载。
 * ▎为什么不用录"别人的流"？浏览器拿不到"服务器转发的全貌"，
 *   只有本地这几个 <video> 元素是真实存在的画面 —— 所以"合成式录制"是前端唯一的路。
 *   真实产品（腾讯会议）在**服务器侧**录制（mediasoup 官方推荐另起一个 Consumer 录流），
 *   你能讲清这个差别就够面试用了。
 * ────────────────────────────────────────────────────────────── */
let recorder = null;        // MediaRecorder 实例
let recChunks = [];         // 录到的数据块
let recTimer = null;        // 计时器（按钮上显示录了多久）
let recDrawTimer = null;    // 画面合成循环
let recStartAt = 0;
let recAudioCtx = null;

recordBtn.addEventListener('click', () => {
  if (recorder && recorder.state === 'recording') stopRecording();
  else startRecording();
});

async function startRecording() {
  if (recorder && recorder.state === 'recording') return;
  // ① 画面：一张 1280×720 的画布，按网格画所有人
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');

  const draw = () => {
    const videos = [localVideo, ...[...peerMains.values()].map((m) => m.video)]
      .filter((v) => v && v.readyState >= 2);
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!videos.length) return;
    const cols = Math.ceil(Math.sqrt(videos.length));
    const rows = Math.ceil(videos.length / cols);
    const cw = canvas.width / cols;
    const ch = canvas.height / rows;
    videos.forEach((v, i) => {
      const x = (i % cols) * cw;
      const y = Math.floor(i / cols) * ch;
      // 按"填满格子"的比例裁剪绘制（和页面上 object-fit: cover 的观感一致）
      const scale = Math.max(cw / v.videoWidth, ch / v.videoHeight);
      const dw = v.videoWidth * scale;
      const dh = v.videoHeight * scale;
      ctx.drawImage(v, x + (cw - dw) / 2, y + (ch - dh) / 2, dw, dh);
    });
  };
  draw();
  recDrawTimer = setInterval(draw, 66); // ~15fps：录制不需要 60fps，省 CPU

  const stream = canvas.captureStream(15);

  // ② 声音：把本地 + 所有远端的音频轨混成一条
  try {
    recAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const dest = recAudioCtx.createMediaStreamDestination();
    if (localStream && localStream.getAudioTracks().length) {
      recAudioCtx.createMediaStreamSource(localStream).connect(dest);
    }
    for (const main of peerMains.values()) {
      const audio = main.stream.getAudioTracks();
      if (audio.length) recAudioCtx.createMediaStreamSource(new MediaStream(audio)).connect(dest);
    }
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  } catch (err) {
    log(`⚠️ 混音失败（本次只录画面）：${err.message}`);
  }

  // ③ 封装：优先用 vp8+opus，个别浏览器不支持就退到默认
  const candidates = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'];
  const mimeType = candidates.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
  recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  recChunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
  recorder.onstop = () => {
    const blob = new Blob(recChunks, { type: recorder.mimeType || 'video/webm' });
    const name = `会议录制-${myRoom || 'room'}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`;
    downloadBlob(blob, name);
    log(`⏹️ 录制结束：${formatSize(blob.size)}，已开始下载「${name}」`);
    showToast(`✅ 录制完成（${formatSize(blob.size)}），已下载`, '');
    recChunks = [];
  };
  recorder.start(1000); // 每 1 秒切一个数据块（掉电最多丢 1 秒）
  recStartAt = Date.now();
  recordBtn.classList.add('recording');
  setIconBtn(recordBtn, ICONS.recStop, '停止录制');
  recTimer = setInterval(() => {
    const s = Math.floor((Date.now() - recStartAt) / 1000);
    recordBtn.querySelector('span').textContent = `录制中 ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }, 1000);
  log('⏺️ 开始录制会议（画面网格 + 混音），再点一次停止并下载');
}

function stopRecording() {
  if (!recorder) return;
  try { recorder.stop(); } catch (e) { /* 已经停了 */ }
  clearInterval(recTimer);
  clearInterval(recDrawTimer);
  recTimer = recDrawTimer = null;
  if (recAudioCtx) { try { recAudioCtx.close(); } catch (e) { /* 忽略 */ } recAudioCtx = null; }
  recordBtn.classList.remove('recording');
  setIconBtn(recordBtn, ICONS.rec, '录制会议');
}

/* ──────────────────────────────────────────────────────────────
 * 第 19 步：★ D1 Simulcast 选层（"服务器按网络质量替你挑一层"）
 *
 * ▎谁在决定？默认是**服务器**：它每 2 秒读一次自己量的 consumer 丢包率，
 *   丢包 >5% 降一层、<1% 且稳定 6 秒升一层（迟滞带防抖）。
 *   前端这里只做两件事：① 把服务器的决定显示出来（格子右下角的选层器）；
 *   ② 允许手动锁定某一层（教学演示 + 特殊情况救急），点"自动"再交回服务器。
 *
 * ▎面试延伸：真实的 ABR（自适应码率）还要结合带宽估计（remb/twcc）、
 *   帧率、屏幕尺寸，本 Demo 只用丢包率——够说明"分层 + 选层"的机制。
 * ────────────────────────────────────────────────────────────── */
const layerState = new Map(); // consumerId -> { layerCount, spatialLayer, auto }

socket.on('layer-changed', ({ consumerId, spatialLayer, layerCount, auto, reason }) => {
  layerState.set(consumerId, { layerCount, spatialLayer, auto });
  // ★ 第 32 步（G4 低带宽模式）：省流开着时，任何"回到自动"的层都立刻重新锁回最低层
  //   （服务器 ABR 会在网络好转时升层 → auto=true；省流模式下这是"不该发生的事"，纠回去）
  if (lowBwOn && auto && layerCount > 1) lockLayerLow(consumerId);
  const tile = consumerTiles.get(consumerId);
  if (!tile) return;
  ensureLayerPicker(tile, consumerId, layerCount);
  updateLayerPicker(tile, layerState.get(consumerId));
  if (reason === 'auto-down' || reason === 'auto-up') {
    log(`🎚️ 网络变化：服务器把成员 ${shortId(tile.from || '')} 的画面切到第 ${spatialLayer + 1}/${layerCount} 层`
      + `（${reason === 'auto-down' ? '⬇️ 降级保流畅' : '⬆️ 升级提清晰'}）`);
  }
});

// 为某一格创建"选层器"（只在真有分层时创建）
function ensureLayerPicker(tile, consumerId, layerCount) {
  if (!tile || layerCount <= 1) return;                 // 单层 = 没开 simulcast，不用选
  if (tile.box.querySelector('.layer-pick')) return;    // 幂等：已经有了就不重复加
  const wrap = document.createElement('div');
  wrap.className = 'layer-pick';
  const sel = document.createElement('select');
  let html = `<option value="auto">🎚️ 自动</option>`;
  for (let i = layerCount - 1; i >= 0; i--) {
    html += `<option value="${i}">第 ${i + 1} 层${i === layerCount - 1 ? '（最清晰）' : (i === 0 ? '（最省流量）' : '')}</option>`;
  }
  sel.innerHTML = html;
  sel.title = '观看画质层：自动 = 服务器按网络质量决定';
  sel.addEventListener('change', () => {
    const value = sel.value === 'auto' ? null : Number(sel.value);
    socket.emit('set-preferred-layers', { consumerId, spatialLayer: value }, (resp) => {
      if (resp && resp.error) { showToast(`❌ 切层失败：${resp.error}`, 'error'); return; }
      log(value === null ? '🎚️ 已交回服务器自动选层' : `🎚️ 已手动锁定第 ${value + 1} 层`);
    });
  });
  wrap.appendChild(sel);
  tile.box.appendChild(wrap);
}

function updateLayerPicker(tile, state) {
  if (!tile || !state) return;   // ★ 第 32 步补的守卫：D6 重连清格后，迟到的换层通知不该炸
  const sel = tile.box.querySelector('.layer-pick select');
  if (!sel) return;
  sel.value = state.auto ? 'auto' : String(state.spatialLayer);
}

/* ──────────────────────────────────────────────────────────────
 * 第 20 步：★ A3 剪贴板双向同步
 *
 * ▎为什么剪贴板要"同步"而不是直接读？剪贴板是**机器本地**的东西：
 *   控制端按 Ctrl+C 复制的是被控端屏幕上的文字，被控端按 Ctrl+V 想粘的是控制端机器上的内容——
 *   跨机粘贴天生要"过网络"，这正是远程协助里最常用的功能之一（复制一段命令到远端执行）。
 *
 * ▎两条路（都受服务器"控制关系门禁"约束，见 sfu/server.js 的 clipboard-sync）：
 *   控制端 → 被控端：读本机剪贴板 → 发给被控端 → 插进工作台焦点元素（Ctrl+V / 点📋粘贴）
 *   被控端 → 控制端：点工作台工具条「📋 剪贴板发给控制端」→ 控制端写进自己剪贴板
 *
 * ▎⚠️ 浏览器的边界：navigator.clipboard.readText() 需要页面聚焦 + 权限，
 *   失败是常态（用户没点页面、浏览器策略不同）→ 必须给出明确提示而不是静默失败。
 * ────────────────────────────────────────────────────────────── */
async function readMyClipboard() {
  try {
    return await navigator.clipboard.readText();
  } catch (err) {
    log(`⚠️ 读不到本机剪贴板：${err.name}（需要页面聚焦/剪贴板权限）`);
    showToast('❌ 读不到剪贴板：请先点一下本页面再试（浏览器要求页面聚焦）', 'error');
    return null;
  }
}

async function pasteClipboardToHost() {
  if (rcRole !== 'controller' || !rcPeerId) return;
  const text = await readMyClipboard();
  if (!text) return;
  socket.emit('clipboard-sync', { to: rcPeerId, text, dir: 'ctl2host' });
  log(`📋 已把本机剪贴板（${text.length} 字）发给被控端，将插入他的工作台`);
  showToast(`📋 已发送剪贴板内容（${text.length} 字）`, '');
}

// 控制端：把"对方工作台里选中的文字"取回本机剪贴板
async function copyHostSelection() {
  const doc = workbenchFrame.contentDocument;
  const text = doc && doc.getSelection ? doc.getSelection().toString() : '';
  if (!text) {
    showToast('对方工作台里当前没有选中的文字（先在对方工作台拖选一段）', 'info');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    log(`📋 已把对方工作台选中的 ${text.length} 字复制到本机剪贴板`);
    showToast(`📋 已复制 ${text.length} 字到本机剪贴板`, '');
  } catch (err) {
    showToast('❌ 写入本机剪贴板失败（需要页面聚焦/权限）', 'error');
  }
}

// 被控端工具条按钮：把本机剪贴板发给控制端
wbClipBtn.addEventListener('click', async () => {
  if (rcRole !== 'host' || !rcPeerId) {
    showToast('当前没有控制端在控制你，没地方发', 'info');
    return;
  }
  const text = await readMyClipboard();
  if (!text) return;
  socket.emit('clipboard-sync', { to: rcPeerId, text, dir: 'host2ctl' });
  log(`📋 已把本机剪贴板（${text.length} 字）发给控制端`);
  auditPush('剪贴板', `向控制端发送了 ${text.length} 字的剪贴板内容`);
});

// 收到剪贴板同步（两个方向都从这里进来）
socket.on('clipboard-sync', ({ from, text, dir }) => {
  if (!text) return;
  if (dir === 'host2ctl') {
    // 我是控制端：被控端把内容发来了 → 写进我的本机剪贴板（之后我在自己机器上就能粘贴）
    navigator.clipboard.writeText(text)
      .then(() => {
        log(`📋 已收到被控端的剪贴板（${text.length} 字），已写入本机剪贴板`);
        showToast(`📋 已把对方的剪贴板内容写入你的剪贴板（${text.length} 字）`, '');
      })
      .catch((err) => {
        log(`⚠️ 写入本机剪贴板失败：${err.name}（请点一下页面再试）`);
        showToast('❌ 写入剪贴板失败：请点一下本页面再让对方重发', 'error');
      });
  } else {
    // 我是被控端：控制端粘贴 → 插进工作台当前焦点元素
    replayClipboard({ kind: 'clipboard', dir: 'ctl2host', text });
    log(`📋 控制端把 ${text.length} 字的剪贴板内容粘贴到了你的工作台`);
    showToast(`📋 控制端粘贴了 ${text.length} 字到你的工作台`, 'info');
  }
});

/* ──────────────────────────────────────────────────────────────
 * 第 21 步：★ A4 远程截图 + 文件传输
 *
 * ▎截图（三行代码的功能，但很实用）：被控端的屏幕画面就在我页面的 <video> 里，
 *   drawImage 到 canvas → toBlob → 下载。（能看到画面 = 能截图，这是"视频即画面"的必然结果）
 *
 * ▎文件传输（SFU 版走**服务器定向分块中继**）：
 *   ① file-offer  → 接收方弹"接受/拒绝"卡片
 *   ② file-answer → 接受后才开始传（不让对方白等）
 *   ③ file-chunk  → 32KB 一块，边发边显示进度（服务器校验配额，超申报大小就掐断）
 *   ④ file-end    → 接收方把块拼成 Blob 下载
 *   ▎和 Mesh 版对比（面试讲点）：Mesh 走 P2P DataChannel，能靠 bufferedAmount 做**背压**；
 *     SFU 版经服务器中转，socket.io 不暴露发送缓冲，所以这里用"每块之间让出事件循环"的
 *     节奏控制代替背压——**传输层能力不同，上层流控策略也要跟着变**。
 * ────────────────────────────────────────────────────────────── */
// 控制端：截图被控端屏幕
function screenshotHost(hostId) {
  const screen = peerScreens.get(hostId);
  if (!screen || !screen.video.videoWidth) {
    showToast('现在没有可截图的画面（对方屏幕还没传过来）', 'error');
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = screen.video.videoWidth;
  canvas.height = screen.video.videoHeight;
  canvas.getContext('2d').drawImage(screen.video, 0, 0);
  canvas.toBlob((blob) => {
    if (!blob) { showToast('截图失败', 'error'); return; }
    const name = `远程屏幕-${shortId(hostId)}-${Date.now()}.png`;
    downloadBlob(blob, name);
    log(`📸 已截图并下载：${name}（${canvas.width}×${canvas.height}）`);
    showToast('📸 截图已下载', '');
  }, 'image/png');
}

const FILE_CHUNK_SIZE = 32 * 1024; // 32KB：服务器单块上限 64KB，留一半余量
let fileTarget = null;   // 我准备发给谁（点 📎 时记住）
let outgoingFile = null; // { file, fileId, to, sent }（我正在发的文件）
let incomingFile = null; // { fileId, from, name, size, mime, parts, received }（我正在收的）
let pendingFileAsk = null; // 收到的 offer（等用户点接受/拒绝）

// 点成员列表里的 📎 → 打开文件选择框
function pickFileFor(memberId) {
  fileTarget = memberId;
  fileInput.value = '';   // 清空，保证选同一个文件也能触发 change
  fileInput.click();
}
fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0];
  if (file && fileTarget) offerFile(fileTarget, file);
});

function offerFile(to, file) {
  const fileId = `f${Date.now()}${Math.floor(Math.random() * 1000)}`;
  outgoingFile = { file, fileId, to, sent: 0 };
  socket.emit('file-offer', { to, fileId, name: file.name, size: file.size, mime: file.type || 'application/octet-stream' });
  log(`📎 已发出文件请求「${file.name}」（${formatSize(file.size)}），等待对方接受...`);
  showToast(`📎 已请求给对方发送「${file.name}」`, 'info');
}

// 接收方：弹出"接受/拒绝"卡片
socket.on('file-offer', ({ from, fileId, name, size, mime }) => {
  pendingFileAsk = { from, fileId, name, size, mime };
  fileAskText.textContent = `成员 ${shortId(from)} 想给你发文件：${name}（${formatSize(size)}）`;
  fileAskBox.classList.remove('hidden');
  log(`📎 成员 ${shortId(from)} 想给你发文件「${name}」（${formatSize(size)}）`);
});

fileAcceptBtn.addEventListener('click', () => {
  if (!pendingFileAsk) return;
  const ask = pendingFileAsk;
  socket.emit('file-answer', { to: ask.from, fileId: ask.fileId, ok: true });
  incomingFile = { ...ask, parts: [], received: 0 };
  fileAskBox.classList.add('hidden');
  pendingFileAsk = null;
  log(`📎 已接受，开始接收「${ask.name}」...`);
});

fileRejectBtn.addEventListener('click', () => {
  if (!pendingFileAsk) return;
  socket.emit('file-answer', { to: pendingFileAsk.from, fileId: pendingFileAsk.fileId, ok: false });
  log('📎 已拒绝接收该文件');
  fileAskBox.classList.add('hidden');
  pendingFileAsk = null;
});

// 发送方：对方接受了 → 开始分块传
socket.on('file-answer', async ({ fileId, ok }) => {
  if (!outgoingFile || outgoingFile.fileId !== fileId) return;
  if (!ok) { outgoingFile = null; log('📎 对方拒绝了这次文件传输'); return; }
  await sendFileChunks(outgoingFile);
});

async function sendFileChunks(job) {
  const { file, fileId, to } = job;
  let seq = 0;
  let offset = 0;
  let lastLogged = -1;
  while (offset < file.size) {
    const slice = file.slice(offset, offset + FILE_CHUNK_SIZE);
    const data = await slice.arrayBuffer();     // 只读这一块，不把整个文件读进内存
    socket.emit('file-chunk', { to, fileId, seq: seq++, data });
    offset += data.byteLength;
    job.sent = offset;
    const pct = Math.floor((offset / file.size) * 100);
    if (pct >= lastLogged + 20) {               // 每 20% 打印一次，别刷屏
      lastLogged = pct;
      log(`📎 发送「${file.name}」进度 ${pct}%（${formatSize(offset)}/${formatSize(file.size)}）`);
    }
    // 让出事件循环：给 socket.io 喘息时间顺便"自然限速"（SFU 版没有 backpressure 可用）
    await new Promise((r) => setTimeout(r, 0));
  }
  socket.emit('file-end', { to, fileId });
  log(`📎 「${file.name}」已全部发出（${formatSize(file.size)}），等待对方确认`);
  outgoingFile = null;
}

// 接收方：收块
socket.on('file-chunk', ({ fileId, seq, data }) => {
  if (!incomingFile || incomingFile.fileId !== fileId) return;
  incomingFile.parts[seq] = data;
  incomingFile.received += data.byteLength || data.length || 0;
  const pct = Math.floor((incomingFile.received / incomingFile.size) * 100);
  if (pct % 25 < 2) log(`📎 接收「${incomingFile.name}」进度 ${pct}%`);
});

// 接收方：传完 → 拼 Blob 下载
socket.on('file-end', ({ fileId, received }) => {
  if (!incomingFile || incomingFile.fileId !== fileId) return;
  const blob = new Blob(incomingFile.parts, { type: incomingFile.mime || 'application/octet-stream' });
  downloadBlob(blob, incomingFile.name);
  log(`📎 已接收「${incomingFile.name}」（${formatSize(blob.size)}，服务器记账 ${received} 字节），已开始下载`);
  showToast(`📎 已收到文件「${incomingFile.name}」`, '');
  incomingFile = null;
});

// 中止（拒绝 / 超配额 / 对方离开）
socket.on('file-abort', ({ fileId, reason }) => {
  const word = reason === 'rejected' ? '对方拒绝了文件传输'
    : reason === 'quota-exceeded' ? '传输超出申报大小，已被服务器掐断'
    : reason === 'too-large' ? '文件太大（教学版上限 200MB）'
    : reason === 'peer-left' ? '对方已离开，传输作废'
    : `传输中止（${reason}）`;
  log(`📎 ${word}`);
  showToast(`📎 ${word}`, 'error');
  if (outgoingFile && outgoingFile.fileId === fileId) outgoingFile = null;
  if (incomingFile && incomingFile.fileId === fileId) incomingFile = null;
  pendingFileAsk = null;
  fileAskBox.classList.add('hidden');
});

/* ──────────────────────────────────────────────────────────────
 * 第 22 步：★ A7 触屏支持（长按 = 右键、双指滑动 = 滚轮）
 *
 * ▎触屏和鼠标的差别（教学点）：
 *   · 单指点按在浏览器里会同时产生 pointer 事件，所以"移动/点击"不用改写；
 *   · 但**没有右键**——真实远程软件的做法是"长按"模拟右键（500ms 不动即右键）；
 *   · **没有滚轮**——用"双指上下滑动"模拟（两根手指的平均位移换算成 wheel 增量）。
 * ▎实现要点：pointerdown 起一个 500ms 的定时器，一旦手指移动或第二根手指落下就取消它，
 *   否则会"点一下却弹出右键菜单"（体验灾难）。
 * ────────────────────────────────────────────────────────────── */
let touchLongPressTimer = null;           // 长按定时器
const activeTouchPointers = new Map();    // pointerId -> {x,y}（数一数现在几根手指）
let touchLastTwoFingerY = null;           // 双指滑动的参考纵坐标
let touchWheelTimer = null;               // 滚轮合并发送（和鼠标滚轮同一套思路）
let touchWheelAccum = 0;
let touchWheelPoint = null;

function wireTouchControl(layer) {
  layer.style.touchAction = 'none'; // 告诉浏览器"这块区域的触摸交给我，别做页面滚动/缩放"

  layer.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return; // 鼠标/触控笔走原有的逻辑
    activeTouchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activeTouchPointers.size === 1) {
      const startX = e.clientX, startY = e.clientY;
      touchLongPressTimer = setTimeout(() => {
        touchLongPressTimer = null;
        // 长按 500ms 没动 → 模拟右键（一对 down/up，btn=2）
        const ev = { clientX: startX, clientY: startY, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
        sendCtlInput('mousedown', ev, { btn: 2 });
        sendCtlInput('mouseup', ev, { btn: 2 });
        log('📱 长按已触发右键（触屏右键模拟）');
      }, 500);
    } else {
      // 第二根手指落下 = 双指手势，取消长按并准备滚轮
      if (touchLongPressTimer) { clearTimeout(touchLongPressTimer); touchLongPressTimer = null; }
      touchLastTwoFingerY = avgTouchY();
    }
  });

  layer.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch') return;
    if (!activeTouchPointers.has(e.pointerId)) return;
    activeTouchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activeTouchPointers.size >= 2) {
      // 双指滑动 → 滚轮：用两指平均纵坐标的位移当滚动量（向下滑 = 向下滚）
      const y = avgTouchY();
      if (touchLastTwoFingerY != null) {
        touchWheelAccum += (touchLastTwoFingerY - y) * 2;  // ×2 是手感补偿
        touchWheelPoint = { x: e.clientX, y: e.clientY };
        if (!touchWheelTimer) {
          touchWheelTimer = setTimeout(() => {
            touchWheelTimer = null;
            if (touchWheelPoint && touchWheelAccum) {
              const ev = { ...touchWheelPoint, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
              sendCtlInput('wheel', ev, { wheel: Math.round(touchWheelAccum) });
              log(`📱 双指滚动 ${Math.round(touchWheelAccum)}（触屏滚轮模拟）`);
            }
            touchWheelAccum = 0;
            touchWheelPoint = null;
          }, 80);
        }
      }
      touchLastTwoFingerY = y;
      return;
    }

    // 单指移动：手指一动就说明不是长按（否则会"滑着滑着突然右键"）
    if (touchLongPressTimer) { clearTimeout(touchLongPressTimer); touchLongPressTimer = null; }
  });

  const endTouch = (e) => {
    if (e.pointerType !== 'touch') return;
    activeTouchPointers.delete(e.pointerId);
    if (touchLongPressTimer) { clearTimeout(touchLongPressTimer); touchLongPressTimer = null; }
    if (activeTouchPointers.size < 2) touchLastTwoFingerY = null;
  };
  layer.addEventListener('pointerup', endTouch);
  layer.addEventListener('pointercancel', endTouch);
}

function avgTouchY() {
  const list = [...activeTouchPointers.values()];
  if (!list.length) return null;
  return list.reduce((s, p) => s + p.y, 0) / list.length;
}

/* ──────────────────────────────────────────────────────────────
 * 第 23 步：★ A6 审计日志的内容入账（被控端视角）
 *
 * ▎记什么？每一条"从控制端来的操作"：类型 + 坐标（或按键/文本），加上时间戳。
 *   鼠标移动量太大（每秒几十条），只按"每 10 条记 1 条"抽样，否则日志会被 mousemove 淹没——
 *   真实产品的审计也是分级的（操作级全记、移动级抽样）。
 * ────────────────────────────────────────────────────────────── */
let auditMoveCounter = 0;

function auditInput(msg) {
  if (rcRole !== 'host') return; // 只有被控端才记（审计的对象是"别人对我做了什么"）
  const pos = (typeof msg.x === 'number') ? `(${Math.round(msg.x * 100)}%, ${Math.round(msg.y * 100)}%)` : '';
  switch (msg.kind) {
    case 'mousemove':
      auditMoveCounter++;
      if (auditMoveCounter % 10 !== 0) return; // 抽样：每 10 条记 1 条
      auditPush('鼠标移动', pos);
      break;
    case 'mousedown': auditPush('鼠标按下', `${pos} 键=${['左', '中', '右'][msg.btn] || msg.btn}`); break;
    case 'mouseup':   auditPush('鼠标抬起', `${pos} 键=${['左', '中', '右'][msg.btn] || msg.btn}`); break;
    case 'dblclick':  auditPush('双击', pos); break;
    case 'wheel':     auditPush('滚轮', `${pos} 增量=${msg.wheel}`); break;
    case 'keydown':
      if (msg.ctrlKey && (msg.key === 'v' || msg.key === 'V')) { auditPush('快捷键', 'Ctrl+V（剪贴板粘贴）'); break; }
      auditPush('按键', `${msg.key}${msg.ctrlKey ? '（含 Ctrl）' : ''}`);
      break;
    case 'keyup': break; // 抬键不记，省一半日志
    case 'input-text': auditPush('中文/文本输入', `${msg.text.length} 字：「${msg.text.slice(0, 40)}」`); break;
    case 'clipboard': auditPush('剪贴板粘贴', `${(msg.text || '').length} 字`); break;
    default: auditPush('其它操作', JSON.stringify(msg).slice(0, 80));
  }
}

// ★ A3：把"控制端粘贴过来的文本"插进工作台当前焦点元素
function replayClipboard(msg) {
  const doc = workbenchFrame.contentDocument;
  if (!doc || !msg.text) return;
  const active = doc.activeElement || doc.body;
  const editable = active && (active.isContentEditable ||
    active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
  if (!editable) {
    // 没有落点：给个明确提示，而不是"点了没反应"（好体验的一半是"有反馈"）
    log('📋 对方工作台当前没有聚焦的输入框，剪贴板内容没处插（请先点一下输入框）');
    showToast('📋 工作台里没有聚焦的输入框，请先让对方点一下输入区', 'info');
    return;
  }
  try { doc.execCommand('insertText', false, msg.text); }
  catch (err) { log(`⚠️ 插入剪贴板内容失败：${err.message}`); }
}

/* ──────────────────────────────────────────────────────────────
 * 第 24 步：通用小工具（录制下载、审计导出、文件体积显示都要用）
 * ────────────────────────────────────────────────────────────── */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 10 秒后回收，太早回收会让下载失败（浏览器还在读这个 URL）
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/* ──────────────────────────────────────────────────────────────
 * 第 25 步：★ F3 加入前预览页 —— "进会先把设备检查好"（腾讯会议同款流程）
 *
 * ▎为什么要有这一步？以前页面一打开就默默开摄像头，用户对"哪个设备在用"毫无感知，
 *   邀请链接直达时更是稀里糊涂就进房了。真实产品都有一页"预览 + 选设备 + 试音"。
 *
 * ▎三个设计点（面试可讲）：
 *   ① 预览和会议用**同一条 localStream**（第 4 步里 preVideoEl.srcObject = localStream）：
 *      预览页看到的画面就是进会后的画面，不额外 getUserMedia 一路 —— 少一次授权弹窗、
 *      少占一份设备资源；切换设备复用第 17 步的 switchCamera/switchMic（还没 produce 时
 *      它们会自动跳过 replaceTrack，只换本地轨道，进房后 produce 的就是选好的设备）。
 *   ② 试音条用 WebAudio 的 AnalyserNode 实时量麦克风能量（和 D5 录制混音是同一族 API），
 *      采"峰值"而不是平均值，说话时跳得更明显；动画用 requestAnimationFrame 驱动。
 *      要做"非阻塞降级"：没有 AudioContext/Analyser 的环境（如无头测试桩）直接跳过试音，
 *      绝不让预览页变成进房的拦路虎。
 *   ③ "入会时静音/关摄像头"是**预勾选**，进会后由第 10 步的按钮逻辑统一生效并上报
 *      member-state —— 复用已有状态机，不另造一份"预静音"状态（单一事实来源）。
 * ────────────────────────────────────────────────────────────── */
let pjAudioCtx = null;   // 试音用的 AudioContext（进入会议时关掉，别占着音频分析器）
let pjMeterRaf = 0;      // 试音条动画的 requestAnimationFrame 句柄

function startPrejoinMeter(stream) {
  try {
    if (!stream || !stream.getAudioTracks().length) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (typeof AC !== 'function') return;                  // 没有音频上下文（无头环境）→ 跳过
    pjAudioCtx = new AC();
    if (typeof pjAudioCtx.createAnalyser !== 'function') { // 有 AudioContext 但没有 Analyser（测试桩）→ 跳过
      pjAudioCtx = null;
      return;
    }
    const source = pjAudioCtx.createMediaStreamSource(stream);
    const analyser = pjAudioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser); // 只接分析器、不接 destination —— 试音不会从喇叭外放（防啸叫）
    const buf = new Float32Array(analyser.fftSize);
    const draw = () => {
      if (!pjAudioCtx) return; // 已进入会议（ctx 被关）→ 停止动画
      analyser.getFloatTimeDomainData(buf);
      let peak = 0; // 峰值：一帧里绝对值最大的采样，说话时比均值灵敏得多
      for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > peak) peak = v; }
      if (pjMeterBarEl) pjMeterBarEl.style.width = `${Math.min(100, Math.round(peak * 140))}%`;
      pjMeterRaf = requestAnimationFrame(draw);
    };
    draw();
  } catch (err) {
    pjAudioCtx = null; // 试音失败不影响进入会议（预览页不能变成拦路虎）
  }
}

function stopPrejoinMeter() {
  if (pjMeterRaf) { cancelAnimationFrame(pjMeterRaf); pjMeterRaf = 0; }
  if (pjAudioCtx) { try { pjAudioCtx.close(); } catch (e) { /* 已关则忽略 */ } pjAudioCtx = null; }
  if (pjMeterBarEl) pjMeterBarEl.style.width = '0%';
}

// 点「进入会议」：关预览、应用预静音、关掉遮罩；邀请链接预填过房间号就直接加入
function enterFromPrejoin() {
  stopPrejoinMeter();
  prejoinEl.classList.add('hidden');
  // 预静音：直接复用第 10 步按钮（enabled 翻转 + member-state 上报都由它做，不重复造轮子）
  if (pjMuteChk.checked) muteBtn.click();
  if (pjCamChk.checked) camBtn.click();
  log('🚪 设备检查完成，进入会议');
  if (roomInput.value.trim()) {
    tryJoinRoom(); // ?room= 预填过（或用户手输过）→ 自动加入
  } else {
    roomInput.focus(); // 没有房间号 → 把焦点交给房间号输入框，提示用户"下一步在这"
  }
}

pjEnterBtn.addEventListener('click', enterFromPrejoin);
// 预览页选设备 = 复用第 17 步的切换逻辑（produce 之前只换本地轨道，进房后发布的就是它）
pjCamSelect.addEventListener('change', () => switchCamera(pjCamSelect.value));
pjMicSelect.addEventListener('change', () => switchMic(pjMicSelect.value));

/* ──────────────────────────────────────────────────────────────
 * 第 26 步：★ F1 宫格/演讲者双布局 + 钉选 + 双击全屏 ＆ ★ F2 每人网络质量点
 *
 * ▎演讲者视图的"大画面该给谁"（优先级对齐真实会议产品）：
 *   ① 我钉选了某人（📌）→ 永远显示他（他开共享就显示他的屏幕）；
 *   ② 没钉选 → 有人正在共享屏幕，大画面让给共享者（腾讯会议同款行为）；
 *   ③ 还是没有 → 跟随当前说话人（audio-levels 的 top，第 16 步数据的复用）；
 *   ④ 都没有 → 显示我自己。
 * ▎实现方式（面试可讲）：所有格子始终留在同一个网格容器里，切布局 = 换容器的 CSS 类
 *   + 给"主画面格"打 tile-main 标记，大小位置全由 CSS 决定 —— JS 不搬 DOM 节点，
 *   <video> 不用重新挂流，画面不会闪黑（搬 DOM 会触发部分浏览器的重绘黑帧）。
 * ▎F2 网络点的信任模型：服务器每 3 秒量一次"这个成员订阅的每路流"的丢包率
 *   （consumer.getStats()，和 D1 选层同一数据源），按人聚合、**有变化才广播** ——
 *   网络好不好由服务器量，不听客户端自报。
 * ────────────────────────────────────────────────────────────── */
let layoutMode = 'gallery';    // 'gallery' 宫格（所有人一样大）| 'speaker' 演讲者（大画面 + 小格）
let pinnedId = null;           // 被钉选的成员 id（null = 没钉选）
let currentSpeakerId = null;   // 当前最大声的成员 id（audio-levels 的 top）
/* ★ 09-18 演讲人交接迟滞：audio-levels 每 400ms 一报，多人抢话/说话的呼吸间隙会让
 *   top 不停易主——不防抖的话演讲者视图的大画面会跟着狂跳（真产品的"画面乱切"吐槽点）。
 *   做法（同 D1 选层的迟滞思想）：top 变了先记为"候选人"，**连续坐稳 SPEAKER_HOLD_MS
 *   才交接大画面**；安静（top=null）同样迟滞——说话间隙不让大画面跳回自己，
 *   真的安静下来了才回退到共享者/自己。冒烟桩可用 window.SPEAKER_HOLD_MS 缩短。 */
let pendingSpeakerId = null;   // 候选说话人（还没坐稳的不算数）
let pendingSpeakerSince = 0;   // 候选开始时刻（坐稳计时器）
const SPEAKER_HOLD_MS = (typeof window !== 'undefined' && window.SPEAKER_HOLD_MS) || 1500;
const netLevelsById = new Map(); // ★ F2：成员 id -> 0 好 / 1 中 / 2 差（null = 暂无数据）
const NET_DOT_TEXT = ['●', '●', '●', '○'];
const NET_DOT_TITLE = ['网络质量：良好', '网络质量：一般', '网络质量：较差', '网络质量：暂无数据'];

// 找"某个成员的主画面格"（摄像头/麦克风那一格，屏幕共享格不算）
function mainTileOfMember(id) {
  for (const t of tiles.values()) {
    if (t.from === id && t.source !== 'screen') return t;
  }
  return null;
}

// 演讲者视图的大画面给谁：钉选 > 共享者 > 说话人 > 我自己（null = 我自己）
function pickMainTile() {
  if (pinnedId) {
    const t = peerScreens.get(pinnedId) || mainTileOfMember(pinnedId);
    if (t) return t;
  }
  const sharer = lastMembers.find((m) => m.sharing && m.id !== socket.id);
  if (sharer) {
    const t = peerScreens.get(sharer.id);
    if (t) return t;
  }
  if (currentSpeakerId && currentSpeakerId !== socket.id) {
    const t = mainTileOfMember(currentSpeakerId);
    if (t) return t;
  }
  return null;
}

/* 把布局状态"刷"到 DOM：换容器类 + 换 tile-main 标记（幂等，随时可反复调用）。
 * ★ 09-19 拆成两层：applyLayoutDOM 只做纯 DOM 标记；applyLayout 负责决定
 *   "要不要带过渡"——布局签名（视图模式 + 大画面归属）真的变了，且环境支持
 *   View Transitions API、用户没开"减少动态效果"，才包 startViewTransition
 *   做跨帧过渡（0.25s crossfade，大画面交接/切视图不再瞬间跳变）。
 *   audio-levels 每 400ms 一 tick，签名没变就直通，零过渡开销（防抖动的关键）。 */
let lastLayoutSig = '';
function applyLayoutDOM() {
  videoGrid.classList.toggle('layout-speaker', layoutMode === 'speaker');
  videoGrid.classList.toggle('layout-gallery', layoutMode === 'gallery');
  viewGalleryBtn.classList.toggle('active', layoutMode === 'gallery');
  viewSpeakerBtn.classList.toggle('active', layoutMode === 'speaker');

  // 清标记时**自己那格也要清**：self 不在 tiles 表里，漏了它就会出现"两张大画面"
  // （实修踩过：先在无主时把 tile-main 给了自己，钉选后又给远端格子，两格同时放大）
  const selfBox = document.querySelector('.video-box.self');
  if (selfBox) selfBox.classList.remove('tile-main');
  for (const t of tiles.values()) t.box.classList.remove('tile-main');

  const main = pickMainTile();
  if (main) {
    main.box.classList.add('tile-main');
  } else if (selfBox) {
    selfBox.classList.add('tile-main'); // 大画面是我自己
  }
}

function applyLayout() {
  const selfBox = document.querySelector('.video-box.self');
  const main = pickMainTile(); // 纯查询无副作用，签名可以先算
  const sig = `${layoutMode}|${main ? main.box : (selfBox ? 'self' : 'none')}`;
  const reduced = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (sig === lastLayoutSig || reduced || typeof document.startViewTransition !== 'function') {
    applyLayoutDOM();
  } else {
    try { document.startViewTransition(() => applyLayoutDOM()); }
    catch (e) { applyLayoutDOM(); } // 过渡失败不影响正确性
  }
  lastLayoutSig = sig;
}

viewGalleryBtn.addEventListener('click', () => {
  layoutMode = 'gallery';
  applyLayout();
  log('▦ 已切到宫格视图');
});
viewSpeakerBtn.addEventListener('click', () => {
  layoutMode = 'speaker';
  applyLayout();
  log('▢ 已切到演讲者视图（大画面跟随共享者/说话人）');
});

// 钉选：演讲者视图的大画面固定给这个人（他开共享就显示他的屏幕）；再点一次取消
function togglePin(id) {
  if (pinnedId === id) {
    pinnedId = null;
    log('📌 已取消钉选，大画面恢复自动跟随');
  } else {
    pinnedId = id;
    layoutMode = 'speaker'; // 钉选即切到演讲者视图（宫格里"钉"没有意义）
    log(`📌 已钉选成员 ${shortId(id)}（可再点一次取消）`);
  }
  applyLayout();
  refreshPinBtns();
}

// 钉选状态变了，把所有格子的按钮文字/高亮同步一遍
function refreshPinBtns() {
  for (const t of tiles.values()) {
    const b = t.box.querySelector('.pin-btn');
    if (b) {
      b.textContent = t.from === pinnedId ? '📌 已钉选' : '📌 钉选';
      b.classList.toggle('pinned', t.from === pinnedId); // pinned 的按钮常亮，不靠 hover
    }
  }
}

// 双击任意画面 = 全屏（再双击或按 Esc 退出）—— 浏览器原生 Fullscreen API，布局不用自己写
function toggleFullscreen(el) {
  if (document.fullscreenElement) {
    if (document.exitFullscreen) document.exitFullscreen();
    return;
  }
  if (typeof el.requestFullscreen === 'function') el.requestFullscreen();
}
// 自己的那格是 HTML 写死的（不经 ensureTile），这里补挂双击全屏
const selfVideoBox = document.querySelector('.video-box.self');
if (selfVideoBox) selfVideoBox.addEventListener('dblclick', () => toggleFullscreen(selfVideoBox));

/* ---- ★ F2：每成员网络质量点（★ D+3：payload 增加每人下行带宽估计 bwe）---- */
const bweById = new Map(); // socketId -> bps（null = 没有估计值）
socket.on('net-levels', ({ levels, bwe }) => {
  for (const [id, lv] of Object.entries(levels || {})) netLevelsById.set(id, lv);
  for (const [id, v] of Object.entries(bwe || {})) bweById.set(id, v);
  applyNetDots();
});

// 把 netLevelsById 里的等级刷到成员列表的小圆点上（row.dataset.id 是第 15 步存的人）
function applyNetDots() {
  for (const row of memberListEl.querySelectorAll('.member-row')) {
    const dot = row.querySelector('.m-net');
    if (!dot) continue;
    const lv = netLevelsById.get(row.dataset.id);
    const idx = lv === 0 || lv === 1 || lv === 2 ? lv : 3;
    dot.className = `m-net net-dot net-${idx}`;
    dot.textContent = NET_DOT_TEXT[idx];
    const bwe = bweById.get(row.dataset.id); // ★ D+3：悬浮提示里带上服务器估计的下行带宽
    dot.title = NET_DOT_TITLE[idx] + (bwe ? ` · 下行带宽估计 ≈ ${(bwe / 1e6).toFixed(2)} Mbps` : '');
  }
}

/* ──────────────────────────────────────────────────────────────
 * 第 26b 步：★ 09-13 "真实有用"三件套 —— 表情回应（飞屏）/ 举手 / 发言占比
 *
 * ▎为什么是这三件？（对齐腾讯会议/Zoom 的真实功能，且各踩一条已有机制）
 *   ① 表情回应：D+1 数据通道的第一个非聊天应用——每类消息在通道上"分家"
 *     （type:'chat' / 'react'），这是数据通道真正的用法；
 *   ② 举手：member-state 白名单加一个 hand 字段而已，但"要发言"全房可见
 *     是会议礼仪的刚需（腾讯会议同款）；
 *   ③ 发言占比：D2 服务器说话人检测的"记账版"——同一份数据从"实时高亮"
 *     沉淀成"复盘报表"（服务器 talk-stats 广播），可视化价值最高的一件。
 * ────────────────────────────────────────────────────────────── */

// ① 表情回应：回应骑在聊天同一条 SCTP 广播频道上（mediasoup 自动转发给所有订阅者）
for (const btn of reactBar.querySelectorAll('.react-btn')) {
  btn.addEventListener('click', () => sendReact(btn.dataset.emoji));
}
function sendReact(emoji) {
  if (!myRoom) return;
  if (!chatDataProducer || chatDataProducer.closed) {
    showToast('数据通道未就绪，回应没发出去', 'info');
    return;
  }
  chatDataProducer.send(JSON.stringify({
    type: 'react', emoji, msgId: `${socket.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  }));
  spawnFlyingEmoji(emoji); // mediasoup 不会把消息回给发送者，自己的先飞起来
}

// 表情飞屏：从屏幕底部随机位置飘上去，动画结束自动删（纯 CSS 动画，见 style.css）
function spawnFlyingEmoji(emoji) {
  const el = document.createElement('span');
  el.classList.add('react-fly'); // 用 classList（与项目惯例一致，也方便测试桩断言）
  el.textContent = emoji;
  el.style.left = (12 + Math.random() * 76) + 'vw';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

// ② 举手：member-state 带 hand 字段（服务器白名单已放行），全房 room-state 快照可见
let myHand = false;
handBtn.addEventListener('click', () => {
  myHand = !myHand;
  handBtn.classList.toggle('active', myHand);
  myHand ? setIconBtn(handBtn, ICONS.hand, '放下手') : setIconBtn(handBtn, ICONS.hand, '举手');
  reportMyState({ hand: myHand });
  log(myHand ? '✋ 你举手了（成员列表会显示 ✋）' : '🫱 你放下了手');
});

// ③ 发言占比：服务器 talk-stats 广播 → 刷成员行的占比条
const talkStatsById = new Map(); // socketId -> { sec, share }
const recordingsByMember = new Map(); // ★ D+2：memberId -> recordId（再点一次停止）
socket.on('talk-stats', ({ stats }) => {
  for (const s of stats || []) talkStatsById.set(s.id, s);
  applyTalkBars();
});
function applyTalkBars() {
  for (const row of memberListEl.querySelectorAll('.member-row')) {
    const bar = row.querySelector('.m-talk');
    if (!bar) continue;
    const s = talkStatsById.get(row.dataset.id);
    bar.querySelector('i').style.width = (s ? s.share : 0) + '%';
    bar.title = s && s.sec ? `发言 ${s.sec} 秒，占比 ${s.share}%` : '还没发言过';
  }
}

/* ──────────────────────────────────────────────────────────────
 * 第 26c 步：★ 09-14 F5 协作批注 —— 屏幕共享上的"多人数位画布"
 *
 * ▎这是什么？任何人都可以在任何"屏幕格"上画笔迹，全房实时同步——
 *   开会圈重点、远程协助时指位置，这是真实协作产品的核心场景。
 *
 * ▎为什么它是"数据通道深化"的教材（比聊天更进一步的三点）：
 *   ① **多条 SCTP 流**：标注走独立的 label='annot' 频道（第 27 步 produceData 两次）——
 *     聊天刷屏不会挤掉笔迹，mediasoup 的 numSctpStreams 就是为多频道并存设计的；
 *   ② **定向头过滤**：标注消息带 `to`（屏幕归属者的 id）——mediasoup 数据通道是广播，
 *     "这条笔迹属于哪块屏幕"由应用层自己声明、自己过滤（协议教学核心）；
 *   ③ **增量状态同步**：只广播 op（start/draw/end/undo/clear）+ 归一化坐标，
 *     各端用同一个 applyAnnotOp 重放出完整画面——和"事件溯源"同一个思想，
 *     坐标归一化后窗口大小不一致也画得一样（远程协助同款手法）。
 *
 * ▎笔迹颜色 = 说话人颜色：colorFor(id) 从成员 id 稳定算出颜色，谁画的分得清。
 * ────────────────────────────────────────────────────────────── */
const ANNOT_COLORS = ['#6fdc9b', '#ffcf6f', '#6d9eff', '#ff8f8f', '#c9a6ff'];
let myAnnotColor = ANNOT_COLORS[2]; // 我自己的画笔色（工具条可换）

// 从成员 id 稳定地算一个颜色（同一个 id 永远同色 → 笔迹可归属到人）
function colorFor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ANNOT_COLORS[h % ANNOT_COLORS.length];
}

/* ---- 共享者的"我的屏幕"格：共享时给自己也开一块（观众视角确认 + 批注落点）---- */
function addSelfScreenTile(track) {
  if (peerScreens.has(socket.id)) return;
  const key = `${socket.id}::screen-self`;
  const tile = ensureTile(key, '我的屏幕（共享中）');
  tile.video.srcObject = new MediaStream([track]);
  tile.video.muted = true; // 本地画面必须静音（坑 9 同款，防回声）
  peerScreens.set(socket.id, tile);
  setupAnnotOverlay(tile, socket.id);
  applyLayout();
}
function removeSelfScreenTile() {
  const tile = peerScreens.get(socket.id);
  if (!tile) return;
  try { if (tile.video.srcObject) tile.video.srcObject.getTracks().forEach((t) => t.stop()); } catch (e) { /* 已停 */ }
  tile.box.remove();
  for (const [k, t] of tiles) { if (t === tile) { tiles.delete(k); break; } }
  peerScreens.delete(socket.id);
  applyLayout();
}

/* ---- 给一块屏幕格盖"批注层"：半透明 canvas + 小工具条（幂等）---- */
function setupAnnotOverlay(tile, ownerId) {
  if (tile.annotCanvas) { fitAnnotCanvas(tile); return; }
  const box = tile.box;

  const canvas = document.createElement('canvas');
  canvas.className = 'annot-canvas'; // 默认 pointer-events:none；点 ✏️ 后才接收笔迹
  box.appendChild(canvas);

  // 工具条：✏️ 开关 / 颜色 / ↶ 撤销 / 🗑 清空（全部 pointerdown，重放安全同款原则）
  const bar = document.createElement('div');
  bar.className = 'annot-bar';
  const penBtn = document.createElement('button');
  penBtn.className = 'annot-btn annot-pen';
  penBtn.title = '开/关批注模式（开着才能画）';
  penBtn.textContent = '✏️';
  penBtn.addEventListener('pointerdown', () => {
    tile.annotOn = !tile.annotOn;
    penBtn.classList.toggle('active', tile.annotOn);
    canvas.classList.toggle('annot-on', tile.annotOn);
  });
  bar.appendChild(penBtn);
  for (const c of ANNOT_COLORS) {
    const dot = document.createElement('button');
    dot.className = 'annot-dot' + (c === myAnnotColor ? ' active' : '');
    dot.style.background = c;
    dot.title = '用这个颜色画（笔迹颜色 = 谁画的）';
    dot.addEventListener('pointerdown', () => {
      myAnnotColor = c;
      for (const d of bar.querySelectorAll('.annot-dot')) d.classList.remove('active');
      dot.classList.add('active');
    });
    bar.appendChild(dot);
  }
  const undoBtn = document.createElement('button');
  undoBtn.className = 'annot-btn';
  undoBtn.title = '撤销我的最后一笔';
  undoBtn.textContent = '↶';
  undoBtn.addEventListener('pointerdown', () => {
    applyAnnotOp(tile, myAnnotColor, 'undo');
    sendAnnot(ownerId, 'undo');
  });
  bar.appendChild(undoBtn);
  const clearBtn = document.createElement('button');
  clearBtn.className = 'annot-btn';
  clearBtn.title = '清空整块画布（全房同步）';
  clearBtn.textContent = '🗑';
  clearBtn.addEventListener('pointerdown', () => {
    applyAnnotOp(tile, myAnnotColor, 'clear');
    sendAnnot(ownerId, 'clear');
  });
  bar.appendChild(clearBtn);
  box.appendChild(bar);

  tile.annotCanvas = canvas;
  tile.annotStrokes = []; // 事件溯源的"账本"：所有笔迹按序重放
  tile.annotOn = false;
  tile.annotDrawing = false;

  /* 画笔输入三件套：只在批注模式下响应；坐标归一化（0~1）后广播 */
  canvas.addEventListener('pointerdown', (e) => {
    if (!tile.annotOn || e.button === 2) return;
    const p = annotPoint(tile, e);
    tile.annotDrawing = true;
    applyAnnotOp(tile, myAnnotColor, 'start', p.x, p.y);
    sendAnnot(ownerId, 'start', p);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!tile.annotDrawing) return;
    const p = annotPoint(tile, e);
    applyAnnotOp(tile, myAnnotColor, 'draw', p.x, p.y);
    sendAnnot(ownerId, 'draw', p);
  });
  const endStroke = () => {
    if (!tile.annotDrawing) return;
    tile.annotDrawing = false;
    sendAnnot(ownerId, 'end'); // 收笔只是语义，两端都不用动作
  };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointerleave', endStroke);

  fitAnnotCanvas(tile);
}

/* ---- 唯一的"状态机"：本地画、远端收，都走这一个函数重放 ---- */
function applyAnnotOp(tile, color, op, x, y) {
  const strokes = tile.annotStrokes || (tile.annotStrokes = []);
  if (op === 'start') {
    strokes.push({ color, pts: [{ x, y }] });
    drawAnnotDot(tile, color, x, y);
  } else if (op === 'draw') {
    const s = strokes[strokes.length - 1];
    if (!s) return;
    const p0 = s.pts[s.pts.length - 1];
    s.pts.push({ x, y });
    drawAnnotSegment(tile, s.color, p0.x, p0.y, x, y);
  } else if (op === 'undo') {
    for (let i = strokes.length - 1; i >= 0; i--) {
      if (strokes[i].color === color) { strokes.splice(i, 1); break; } // 撤"这个颜色"的最后一笔
    }
    redrawAnnot(tile);
  } else if (op === 'clear') {
    strokes.length = 0;
    redrawAnnot(tile);
  } // 'end'：两端都无动作
}

/* ---- 收到别人的笔迹（'annot' 频道路由过来，见 subscribeData）---- */
function handleAnnotMessage(from, message) {
  try {
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
    const msg = JSON.parse(text);
    if (msg.type !== 'annot') return;
    // ★ 定向头过滤：msg.to = 屏幕归属者。广播谁都收得到，
    //   但只画"我有他的屏幕格"的那条（找不到 = 不是画我的屏幕，丢弃）。
    const tile = peerScreens.get(msg.to);
    if (!tile || !tile.annotCanvas) return;
    applyAnnotOp(tile, msg.color || colorFor(from), msg.op, msg.x, msg.y);
  } catch (e) { /* 坏消息不炸整条频道 */ }
}

function sendAnnot(toScreenOwner, op, p) {
  if (!annotDataProducer || annotDataProducer.closed) return; // 标注频道没就绪就静默放弃
  annotDataProducer.send(JSON.stringify({
    type: 'annot', msgId: `${socket.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    to: toScreenOwner, op,
    x: p ? p.x : undefined, y: p ? p.y : undefined,
    color: myAnnotColor,
  }));
}

/* ---- 绘制原语：坐标归一化（0~1）→ 当前画布 CSS 像素 ---- */
function annotPoint(tile, e) {
  const rect = tile.annotCanvas.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
  };
}
function annotCssSize(tile) {
  const dpr = window.devicePixelRatio || 1;
  return { w: tile.annotCanvas.width / dpr, h: tile.annotCanvas.height / dpr };
}
function fitAnnotCanvas(tile) {
  if (!tile || !tile.annotCanvas) return;
  const rect = tile.box.getBoundingClientRect();
  if (rect.width < 2) return; // 格子还没摆好（display:none 等），等下次 resize
  const dpr = window.devicePixelRatio || 1;
  tile.annotCanvas.width = Math.round(rect.width * dpr);
  tile.annotCanvas.height = Math.round(rect.height * dpr);
  const ctx = tile.annotCanvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  redrawAnnot(tile); // 尺寸变了，按账本重放一遍（归一化坐标的好处）
}
function drawAnnotSegment(tile, color, x0, y0, x1, y1) {
  const { w, h } = annotCssSize(tile);
  const ctx = tile.annotCanvas.getContext('2d');
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x0 * w, y0 * h);
  ctx.lineTo(x1 * w, y1 * h);
  ctx.stroke();
}
function drawAnnotDot(tile, color, x, y) {
  const { w, h } = annotCssSize(tile);
  const ctx = tile.annotCanvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x * w, y * h, 1.8, 0, Math.PI * 2);
  ctx.fill();
}
function redrawAnnot(tile) {
  const { w, h } = annotCssSize(tile);
  const ctx = tile.annotCanvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  for (const s of tile.annotStrokes || []) {
    for (let i = 0; i < s.pts.length; i++) {
      const p = s.pts[i];
      if (i === 0) drawAnnotDot(tile, s.color, p.x, p.y);
      else {
        const q = s.pts[i - 1];
        drawAnnotSegment(tile, s.color, q.x, q.y, p.x, p.y);
      }
    }
  }
}
// 窗口变形 → 所有屏幕格的批注层重新对齐（归一化坐标重放，笔迹不丢）
//   （防御式：无头测试的假 window 没有 addEventListener，别让顶层加载挂掉）
if (typeof window.addEventListener === 'function') {
  window.addEventListener('resize', () => {
    for (const t of peerScreens.values()) fitAnnotCanvas(t);
  });
}

/* ──────────────────────────────────────────────────────────────
 * 第 26d 步：★ 09-15 F7 独立协作白板 —— 全场共享一块画布（第三条 SCTP 频道）
 *
 * ▎和 F5 批注的区别（都是 canvas + 事件溯源，为什么做成两条频道）：
 *   批注 = "贴在某块屏幕格上的笔迹"（带 to 定向头，跟着屏幕走）；
 *   白板 = "房间级的独立画布"（不依附任何画面，全场一份，无需定向头）。
 *   语义不同 → 频道不同（'annot' / 'board'）——多频道并存正是 D+1 多流的用法演示。
 * ▎消息：{type:'board', msgId, op:'start|draw|end|undo|clear', x, y, color}
 *   坐标 0~1 归一化（窗口大小无关），各端用同一个 applyBoardOp 重放 = 事件溯源。
 * ▎白板底色是浅的（月白），所以笔迹用深色系 BOARD_COLORS——和批注的亮色板区分。
 * ────────────────────────────────────────────────────────────── */
/* ★ 09-19 白板 v2（参考 recent.design igochi 案例的黑白 editorial 气质）:
 *   色板从通用色换「水墨丹青」五色——墨黑/朱砂/鎏金/黛蓝/竹青，纸白底上更统一 */
const BOARD_COLORS = [
  { v: '#2b2724', n: '墨' }, { v: '#b93a26', n: '朱砂' }, { v: '#a5802f', n: '鎖金' },
  { v: '#3a5a7a', n: '黛蓝' }, { v: '#5a7a44', n: '竹青' },
];
let boardColor = BOARD_COLORS[0];
const boardStrokes = []; // 事件溯源账本
let boardDrawing = false;
let boardOn = false;

function boardColorFor(id) { // 对端没带 color 时的兜底（浅底用深色板）
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BOARD_COLORS[h % BOARD_COLORS.length];
}

const boardOverlay = $('boardOverlay');
const boardCanvas = $('boardCanvas');
const boardColorsEl = $('boardColors');

// 工具条：颜色点 + 撤销 + 清空 + 关闭（全部 pointerdown / click，重放安全同款原则）
for (const def of BOARD_COLORS) {
  const c = def.v;
  const dot = document.createElement('button');
  dot.className = 'board-dot' + (c === boardColor ? ' active' : '');
  dot.style.background = c;
  dot.title = def.n;
  dot.addEventListener('pointerdown', () => {
    boardColor = c;
    for (const d of boardColorsEl.querySelectorAll('.board-dot')) d.classList.remove('active');
    dot.classList.add('active');
  });
  boardColorsEl.appendChild(dot);
}
$('boardUndoBtn').addEventListener('pointerdown', () => {
  applyBoardOp(boardColor, 'undo');
  sendBoard('undo');
});
$('boardClearBtn').addEventListener('pointerdown', () => {
  applyBoardOp(boardColor, 'clear');
  sendBoard('clear');
});
$('boardCloseBtn').addEventListener('click', () => boardOverlay.classList.add('hidden'));

const boardBtn = $('boardBtn');
const aiBtn = $('aiBtn');             // ★ 09-19 AI Bot：邀请/送走 AI 助理
const aiOpBtn = $('aiOpBtn');         // ★ 09-19g C1：AI 远程操作员
/* ★ 09-19 AI Bot 参会者（前端）：
 * ▎「🤖 AI」按钮 = 邀请/送走 AI 助理（emit ai-join/ai-leave）；
 * ▎按钮态以 room-state 的 isBot 字段为准（任何人开关，全房按钮同步——状态放唯一权威处）；
 * ▎成员列表的 bot 行：🤖 徽标 + "聆听中…"，没有网络点/音量条（它不消费媒体）。 */
/* ★ 09-26 AI 助理"虚拟参会画面"（深度升级核心）：
 * ▎bot 没有摄像头，但它是**看得见的参会者**——视频网格里有一块"AI 格子"：
 *   五态动态头像（idle/thinking/speaking/happy）由服务器 ai-state 广播驱动；
 *   宫格里是一格，演讲者视图进底部胶片条；离房/送走自动消失（生命周期=room-state.isBot）。
 * ▎"开口说话"的语音部分复用既有 09-25 语音系统（speakAiText/语音开关），互不重复。 */
let aiTileEl = null;
const AI_STATE_LABEL = { idle: '聆听中…', listening: '聆听中…', thinking: '思考中…', speaking: '正在发言…', happy: '任务完成！' };

function setAiState(st, speechText) {
  if (!AI_STATES.includes(st)) return;
  aiAvatar.state = st;
  /* ★ 09-26c 头像 v4（用户反馈 SVG 小人还是不够美）：
   *  底图换成 meihua4 的精美国风头像（一张好图胜过一切小动作），生动感交给
   *  **动效系统**——呼吸缩放/speaking 声波条跳动/thinking 暗化+泡泡漂浮/happy 弹跳。
   *  状态全部由格子 class 驱动 CSS，切换只动 class（丝滑过渡由 transition 承担）。 */
  if (aiAvatar.rowEl) aiAvatar.rowEl.classList.toggle('speaking', st === 'speaking');
  if (aiTileEl) {
    const label = aiTileEl.querySelector('.ai-status');
    if (label) label.textContent = AI_STATE_LABEL[st];
    aiTileEl.classList.toggle('speaking', st === 'speaking');
    aiTileEl.classList.toggle('thinking', st === 'thinking');
    aiTileEl.classList.toggle('happy', st === 'happy');
    /* ★ 09-26b 发言字幕逐字化（用户反馈"AI 字幕太僵硬"）：
     *   speaking 时把答案在格子上方的字幕条里**逐字打出**（标点带停顿——逗号长、
     *   句号更长，模拟说话的呼吸），朗读感立刻不一样；归位时字幕淡出。
     *   为什么不用流式 delta？Mock 轨没有流、LLM 流受网络节奏影响——本地逐字动画
     *   在两种轨道上表现完全一致（确定性的"生动"）。 */
    const bar = aiTileEl.querySelector('.ai-speech');
    if (st === 'speaking' && speechText) {
      bar.classList.add('show');
      bar.textContent = '';
      clearTimeout(aiSpeechTimer);
      let i = 0;
      const tick = () => {
        if (!aiTileEl || i >= speechText.length) return;
        bar.textContent += speechText[i];
        const ch = speechText[i];
        i += 1;
        aiSpeechTimer = setTimeout(tick, /[，、；：]/.test(ch) ? 150 : /[。！？…]/.test(ch) ? 320 : 55);
      };
      aiSpeechTimer = setTimeout(tick, 250);
    } else if (st !== 'speaking' && bar) {
      clearTimeout(aiSpeechTimer);
      bar.classList.remove('show');
      setTimeout(() => { if (bar && !bar.classList.contains('show')) bar.textContent = ''; }, 400);
    }
  }
}
let aiSpeechTimer = 0;

function syncAiTile(present) {
  const grid = document.getElementById('videoGrid');
  if (!grid) return;
  if (present && !aiTileEl) {
    aiTileEl = document.createElement('div');
    aiTileEl.className = 'video-box ai-tile';
    const waves = '<div class="ai-waves">' + '<i></i>'.repeat(7) + '</div>';
    aiTileEl.innerHTML =
      '<div class="ai-face-wrap"><img class="ai-face" src="/avatars/ai/xiaoming-anim.webp" alt="AI 小明"></div>' +
      waves +
      '<div class="ai-speech" aria-live="polite"></div>' +
      '<div class="video-label">AI 小明<span class="ai-status">聆听中…</span></div>';
    grid.appendChild(aiTileEl);
    applyLayout();
  } else if (!present && aiTileEl) {
    aiTileEl.remove();
    aiTileEl = null;
    applyLayout();
  }
}

aiOpBtn.addEventListener('click', () => {
  socket.emit('ai-op', { goal: '演示：打开计算器按 7×8' });
  log('🛰️ AI 操作员任务已下发（被控端会弹授权卡——可拒绝/限时长）');
});

aiBtn.addEventListener('click', () => {
  const on = aiBtn.classList.contains('active');
  socket.emit(on ? 'ai-leave' : 'ai-join', {});
  log(on ? '🤖 正在送走 AI 助理…' : '🤖 正在邀请 AI 助理入会…');
});

boardBtn.addEventListener('click', () => {
  boardOn = !boardOn;
  boardOverlay.classList.toggle('hidden', !boardOn);
  if (boardOn) fitBoardCanvas();
  boardBtn.classList.toggle('active', boardOn);
});

// 白板画布的画笔输入三件套（坐标相对画布归一化）
boardCanvas.addEventListener('pointerdown', (e) => {
  if (e.button === 2) return;
  const p = boardPoint(e);
  boardDrawing = true;
  applyBoardOp(boardColor, 'start', p.x, p.y);
  sendBoard('start', p);
  e.preventDefault();
});
boardCanvas.addEventListener('pointermove', (e) => {
  if (!boardDrawing) return;
  const p = boardPoint(e);
  applyBoardOp(boardColor, 'draw', p.x, p.y);
  sendBoard('draw', p);
});
const boardEndStroke = () => {
  if (!boardDrawing) return;
  boardDrawing = false;
  sendBoard('end');
};
boardCanvas.addEventListener('pointerup', boardEndStroke);
boardCanvas.addEventListener('pointerleave', boardEndStroke);
// 浅底白板禁用浏览器右键菜单（与桌面区同款）
boardCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

function boardPoint(e) {
  const rect = boardCanvas.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
  };
}
function boardCssSize() {
  const dpr = window.devicePixelRatio || 1;
  return { w: boardCanvas.width / dpr, h: boardCanvas.height / dpr };
}
function fitBoardCanvas() {
  const parent = boardCanvas.parentElement; // 真实浏览器必有父节点；无头桩没有则跳过
  if (!parent) return;
  const rect = parent.getBoundingClientRect();
  if (rect.width < 2) return;
  const dpr = window.devicePixelRatio || 1;
  boardCanvas.width = Math.round(rect.width * dpr);
  boardCanvas.height = Math.round((rect.height - 46) * dpr); // 减标题栏高度
  const ctx = boardCanvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  redrawBoard();
}
function applyBoardOp(color, op, x, y) {
  if (op === 'start') {
    boardStrokes.push({ color, pts: [{ x, y }] });
    drawBoardDot(color, x, y);
  } else if (op === 'draw') {
    const s = boardStrokes[boardStrokes.length - 1];
    if (!s) return;
    const p0 = s.pts[s.pts.length - 1];
    s.pts.push({ x, y });
    drawBoardSegment(s.color, p0.x, p0.y, x, y);
  } else if (op === 'undo') {
    for (let i = boardStrokes.length - 1; i >= 0; i--) {
      if (boardStrokes[i].color === color) { boardStrokes.splice(i, 1); break; }
    }
    redrawBoard();
  } else if (op === 'clear') {
    boardStrokes.length = 0;
    redrawBoard();
  }
}
function drawBoardSegment(color, x0, y0, x1, y1) {
  const { w, h } = boardCssSize();
  const ctx = boardCanvas.getContext('2d');
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x0 * w, y0 * h);
  ctx.lineTo(x1 * w, y1 * h);
  ctx.stroke();
}
function drawBoardDot(color, x, y) {
  const { w, h } = boardCssSize();
  const ctx = boardCanvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x * w, y * h, 2.2, 0, Math.PI * 2);
  ctx.fill();
}
function redrawBoard() {
  const { w, h } = boardCssSize();
  const ctx = boardCanvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  for (const s of boardStrokes) {
    for (let i = 0; i < s.pts.length; i++) {
      const p = s.pts[i];
      if (i === 0) drawBoardDot(s.color, p.x, p.y);
      else {
        const q = s.pts[i - 1];
        drawBoardSegment(s.color, q.x, q.y, p.x, p.y);
      }
    }
  }
}
// 窗口变形 → 白板重对齐（归一化账本重放，笔迹不丢）；防御式注册（无头环境）
if (typeof window.addEventListener === 'function') {
  window.addEventListener('resize', () => { if (boardOn) fitBoardCanvas(); });
}

// 收到别人的白板笔迹（'board' 频道路由，见 subscribeData）
function handleBoardMessage(from, message) {
  try {
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
    const msg = JSON.parse(text);
    if (msg.type !== 'board') return;
    applyBoardOp(msg.color || boardColorFor(from), msg.op, msg.x, msg.y);
  } catch (e) { /* 坏消息不炸频道 */ }
}
function sendBoard(op, p) {
  if (!boardDataProducer || boardDataProducer.closed) return;
  boardDataProducer.send(JSON.stringify({
    type: 'board', msgId: `${socket.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    op, x: p ? p.x : undefined, y: p ? p.y : undefined, color: boardColor,
  }));
}

/* ──────────────────────────────────────────────────────────────
 * 第 27 步：★ D+1 SFU 数据通道（DataProducer/DataConsumer · 2026-09-12）
 *
 * ▎这是什么？WebRTC DataChannel 在 mediasoup SFU 里的"正统形态"。
 *   浏览器开一条 SCTP 广播频道（produceData），房间里的每个人都来订阅（consumeData），
 *   之后 .send() 的每条消息 mediasoup 会自动转发给所有订阅者——**服务器一行转发代码都不用写**
 *   （和音视频一样："分层转发是 SFU 的事，应用只管发"）。
 *
 * ▎和媒体 Producer/Consumer 的对应关系（对照着记）：
 *   sendTransport.produce()      ←→ sendTransport.produceData()
 *   'produce' 事件交 rtpParameters ←→ 'producedata' 事件交 sctpStreamParameters（见第 6 步；⚠️ 事件名是完整词 producedata，不是 procedata——09-14 实修踩坑）
 *   recvTransport.consume()      ←→ recvTransport.consumeData()
 *   consumer.resume()            ←→ 数据通道**没有** resume 这一步（建好即用）
 *
 * ▎本项目的第一个应用 = 聊天（第 11 步已改成双路径）。
 *   注意语义：这是**广播**频道，"只发给某个人"要在应用层加 to 字段自己过滤
 *   （A4 文件传输若从信令迁过来就是这么改）。
 * ────────────────────────────────────────────────────────────── */

// 我的广播频道（第 11 步聊天主路 + 第 26c 步标注）；别人频道的订阅表
let chatDataProducer = null;
let annotDataProducer = null; // ★ 09-14 F5：专用"标注"频道——SCTP 多流，一类业务一条频道
let boardDataProducer = null; // ★ 09-15 F7：独立"白板"频道（全场共享画布，与批注的定向画布互不干扰）
const dataConsumers = new Map();   // dataConsumerId -> DataConsumer（我订阅的别人的频道）
const pendingDataSubs = [];        // 接收通道没就绪时收到的订阅请求，先排队（和 pendingSubscriptions 同理）
const seenChatIds = new Set();     // ★ 双发去重：见过的 msgId（上限 500 条，超了清空防涨内存）

function markSeenChatId(msgId) {
  if (seenChatIds.size > 500) seenChatIds.clear();
  seenChatIds.add(msgId);
}

// ① 开我自己的广播频道：produceData 触发第 6 步的 'producedata' 事件 → 服务器 produce-data
async function setupDataChannel() {
  if (!sendTransport || typeof sendTransport.produceData !== 'function') {
    log('⚠️ 当前通道/环境不支持 SCTP 数据通道，聊天继续走信令广播（不影响使用）');
    return;
  }
  try {
    chatDataProducer = await sendTransport.produceData({
      label: 'chat',
      appData: { type: 'chat' },
    });
    log(`🛰️ SCTP 数据通道已建立（${chatDataProducer.id}）：聊天主路不再占用信令带宽`);
  } catch (err) {
    chatDataProducer = null;
    log(`⚠️ 数据通道建立失败（聊天退回信令广播）：${err.message}`);
    return;
  }
  // ★ 09-14 F5：第二条 SCTP 流——mediasoup 的 numSctpStreams 就是为"多条频道并存"设计的。
  //   一类业务一条频道：聊天/回应走 'chat'，协作批注走 'annot'，互不阻塞（聊天刷屏
  //   不会把标注笔迹挤掉队）。订阅端按 consumer.label 路由（见 subscribeData）。
  try {
    annotDataProducer = await sendTransport.produceData({
      label: 'annot',
      appData: { type: 'annot' },
    });
    log(`🛰️ 标注频道已建立（${annotDataProducer.id}）：屏幕共享可以协作批注了`);
  } catch (err) {
    annotDataProducer = null; // 标注是增强功能，失败不拖累聊天
    log(`⚠️ 标注频道建立失败（批注不可用）：${err.message}`);
  }
  // ★ 09-15 F7：第三条流——独立白板（全场共享画布）。三条频道并存演示 SCTP 多流的本意：
  //   聊天/回应、共享批注、白板各自独立，互不阻塞、互不丢业务。
  try {
    boardDataProducer = await sendTransport.produceData({
      label: 'board',
      appData: { type: 'board' },
    });
    log(`🛰️ 白板频道已建立（${boardDataProducer.id}）`);
  } catch (err) {
    boardDataProducer = null;
    log(`⚠️ 白板频道建立失败（白板不可用）：${err.message}`);
  }
}

// ② 订阅别人的频道：问服务器建 DataConsumer，再把参数交给 mediasoup-client 收货
async function subscribeData(from, dataProducerId) {
  const key = `data:${from}::${dataProducerId}`;
  if (consumedProducers.has(key)) return; // 防重复订阅
  consumedProducers.add(key);

  // 竞态防护：接收通道没就绪（或假环境没有 consumeData）就先排队
  if (!recvTransport || typeof recvTransport.consumeData !== 'function') {
    pendingDataSubs.push({ from, dataProducerId });
    return;
  }

  try {
    const resp = await request('consume-data', {
      transportId: recvTransport.id,
      dataProducerId,
    });
    const d = resp.data;
    // 字段名映射同第 8 步：服务器叫 dataConsumerId，mediasoup-client 要的参数名是 id
    const consumer = await recvTransport.consumeData({
      id: d.dataConsumerId,
      dataProducerId: d.dataProducerId,
      sctpStreamParameters: d.sctpStreamParameters,
      label: d.label,
      protocol: d.protocol,
    });
    dataConsumers.set(consumer.id, consumer);
    // 每条到达的消息都在这里（message 可能是字符串或二进制）。
    // ★ 09-14：按频道 label 路由——多条 SCTP 流并存后，"哪条频道来的"决定谁处理。
    consumer.on('message', (message) => {
      if (consumer.label === 'annot') handleAnnotMessage(from, message);
      else if (consumer.label === 'board') handleBoardMessage(from, message);
      else handleDataMessage(from, message);
    });
    log(`🛰️ 已订阅 ${shortId(from)} 的数据通道（label=${d.label}）`);
  } catch (err) {
    log(`⚠️ 订阅 ${shortId(from)} 的数据通道失败：${err.message}`);
  }
}

// ③ 收到 SCTP 消息：聊天（type:'chat'）与表情回应（type:'react'）两类（消息分家）
function handleDataMessage(from, message) {
  try {
    const text = typeof message === 'string' ? message
      : new TextDecoder().decode(message); // 二进制也能接（未来文件分块走这里）
    const msg = JSON.parse(text);

    if (msg.type === 'react') {
      // ★ 09-13 F4：表情回应飞屏（发送者不回环，发的人本地已经飞过）
      if (typeof msg.emoji === 'string' && msg.emoji.length <= 8) spawnFlyingEmoji(msg.emoji);
      return;
    }
    // ★ 09-17 实时字幕（第 29 步）：骑在同一条 'chat' 频道上的第三种消息。
    //   字幕不做信令兜底也不去重（见 emitCaption 的取舍注释）——即时性内容，
    //   丢一条无所谓；文本截断到 500 字防刷屏。
    if (msg.type === 'caption') {
      if (typeof msg.text === 'string' && msg.text && msg.text.length <= 500) {
        handleCaptionMessage(from, msg);
      }
      return;
    }
    if (msg.type !== 'chat' || typeof msg.text !== 'string') return;
    if (msg.msgId && seenChatIds.has(msg.msgId)) return; // 信令路已显示过
    if (msg.msgId) markSeenChatId(msg.msgId);
    appendChat(msg.text, from, false, 'sctp', msg.name); // ★ 09-14 徽标 + ★ 09-16 昵称
  } catch (e) { /* 不是我们的消息格式，忽略（数据通道上跑别的应用时很常见） */ }
}

/* ──────────────────────────────────────────────────────────────
 * 第 28 步：★ F6 滤镜与虚拟背景（canvas 逐帧处理 + replaceTrack · 2026-09-14）
 *
 * ▎这是什么？"美颜/滤镜/绿幕抠像换背景"——腾讯会议的"美颜 + 虚拟背景"的教学版。
 *   整条管线**纯前端、零新依赖**：不做任何 ML 人像分割（那要引模型，违背零依赖铁律），
 *   虚拟背景用**色键抠像**（绿幕/蓝幕，直播行业几十年前的经典手法）实现。
 *
 * ▎处理管线（每帧三站流水线，能讲 5 分钟）：
 *   原始摄像头轨 → 隐藏 <video> 播放
 *     ① 滤镜（GPU）：ctx.filter = 'saturate(1.15) brightness(1.06)...' —— 真正干活的是
 *        GPU 合成器，CPU 几乎不花时间（这 就是"美颜用 GPU"的原因）；
 *     ② 磨皮（GPU 混合）：把帧缩到 1/4 画布 + blur(3px) 再放大回叠——低分辨率模糊放大
 *        天然就是"只糊细节、保住轮廓"的磨皮，一次 drawImage 搞定，不用任何分割；
 *     ③ 色键抠像（CPU）：getImageData 逐像素算与键色（绿/蓝）的距离，容差内 alpha 置 0，
 *        先画背景再把前景盖上 —— 640×360 ≈ 23 万像素的循环，这才是 CPU 账的大头。
 *   → canvas.captureStream(24) 变成新视频轨 → replaceTrack 上行。
 *
 * ▎接线设计（面试最值得讲的一点）——**处理后轨直接顶替进 localStream**：
 *   cameraTrack 变量指向处理后的轨（canvas 轨），原始轨由管线自己攥着（fx.origTrack）。
 *   好处：第 7 步 publishTracks 遍历 localStream、第 10 步关摄像头翻 enabled、D6 重连重发
 *   ——这三处**一行都不用改**，因为"单一事实来源还是 localStream"，它们看到的只是
 *   "一条普通视频轨"，根本不知道这条轨后面藏着一条处理管线。
 *
 * ▎CPU 账（路线图 F6 明确要求"会算"）：每帧 performance.now() 差值做 EMA 平滑，
 *   面板徽标实时显示"x.x ms/帧"。实测量级：GPU 滤镜 + 磨皮 < 2ms；开色键抠像 +2~5ms。
 *   由此能推出工程取舍：能 GPU 就不上 CPU、抠像分辨率别超 720p、帧循环跟不上就掉帧
 *   （captureStream 只采样画好的帧，画得慢=实际帧率自动降，不会堆积）。
 *
 * ▎无头/受限环境降级（F3 试音条同款哲学）：canvas 2D 能力探测失败 → 管线起不来只 log，
 *   绝不影响会议；getImageData 缺失（无头测试桩）→ 色键降级关闭、滤镜照常。
 * ────────────────────────────────────────────────────────────── */
const fx = {
  on: false,            // 管线是否在跑
  preset: 'none',       // 滤镜档位：none / natural / cool / warm / mono（水墨）
  smooth: 0,            // 磨皮强度 0~100（只在管线跑着时叠加生效）
  chroma: false,        // 色键抠像开关
  keyMode: 'green',     // 键色：green 绿幕 / blue 蓝幕
  chromaTol: 60,        // 键色容差（色距小于它→透明；越小抠得越保守）
  bgMode: 'ink',        // 抠像背景：ink 墨色 / silk 绢色 / gold 鎏金 / image 自定义图片
  bgImage: null,        // 用户上传的背景 Image 对象
  video: null, canvas: null, ctx: null,     // 管线三件套：源 video + 输出画布
  loCanvas: null, loCtx: null,              // 磨皮用的低分辨率画布（1/4 尺寸）
  keyCanvas: null, keyCtx: null, chromaOk: false, // 色键画布（getImageData 可用才开）
  origTrack: null,      // 管线正在吃的那条**原始**摄像头轨（fx.on 时 = localStream 外的原始轨）
  procTrack: null,      // 处理后的轨（captureStream 的视频轨，fx.on 时顶替进 localStream）
  raf: 0, costMs: 0, n: 0, errN: 0,         // 帧循环句柄 + CPU 账（EMA）+ 帧计数 + 连续错误计数
};

// 两个下拉/按钮组里找"摄像头的 Producer"（和第 17 步 switchCamera 用同一个写法）
function findCameraProducer() {
  return [...myProducers.values()].find((p) => p.appData && p.appData.source === 'camera');
}

// 档位 → GPU 滤镜字符串（ctx.filter 交给 GPU 合成器，这就是"美颜走 GPU"的全部秘密）
function fxFilterStr() {
  switch (fx.preset) {
    case 'natural': return 'saturate(1.15) brightness(1.06) contrast(1.02)';
    case 'cool':    return 'brightness(1.09) saturate(0.92) contrast(1.04)'; // 冷白：提亮降饱和
    case 'warm':    return 'sepia(0.22) saturate(1.22) brightness(1.05)';    // 暖阳：一点赭石调
    case 'mono':    return 'grayscale(1) contrast(1.1) brightness(1.03)';    // 水墨：黑白高反差
    default: return 'none';
  }
}

// 搭管线：隐藏 video 吃原始轨 → 三张画布 → captureStream 出处理后的轨（能力不够返回 false）
// ★ 09-17c：失败原因写进 fx.lastFail，由 syncFxPipeline 弹给用户看
//   （用户反馈"点了滤镜没反应"——原来失败只写日志面板，主界面毫无反馈）
function fxEnsurePipeline() {
  if (fx.on) return true;
  if (!cameraTrack) {
    fx.lastFail = '先打开摄像头，再使用滤镜/虚拟背景';
    showToast(fx.lastFail, 'error');
    return false;
  }
  // 源 <video>：静音 + 内联播放（不占声音通道、不弹全屏），muted 也让浏览器允许自动播
  const v = document.createElement('video');
  v.muted = true;
  if ('playsInline' in v) v.playsInline = true;
  v.srcObject = new MediaStream([cameraTrack]);
  // 输出画布：教学版锁定 640×360——滤镜输出没必要上 720p（CPU 账 ×2，观众端也多耗码率），
  //   真产品的虚拟背景通常也降分辨率跑分割模型，这里同一取舍。
  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 360;
  const ctx = (typeof canvas.getContext === 'function') ? canvas.getContext('2d') : null;
  if (!ctx || typeof ctx.drawImage !== 'function') {
    fx.lastFail = '当前浏览器不支持 canvas 2D，滤镜不可用';
    log(`⚠️ ${fx.lastFail}（不影响会议其它功能）`);
    return false;
  }
  const lo = document.createElement('canvas');
  lo.width = 160; lo.height = 90;                       // 1/4 尺寸：磨皮 = 低清模糊放大
  const loCtx = (typeof lo.getContext === 'function') ? lo.getContext('2d') : null;
  const key = document.createElement('canvas');
  key.width = 640; key.height = 360;
  const keyCtx = (typeof key.getContext === 'function') ? key.getContext('2d') : null;
  // 色键要 getImageData/putImageData 逐像素读写——无头测试桩没有这两个 API，探测降级
  const chromaOk = !!(keyCtx && typeof keyCtx.getImageData === 'function' && typeof keyCtx.putImageData === 'function');
  try { if (typeof v.play === 'function') v.play(); } catch (e) { /* 自动播被拦也不致命 */ }
  const out = (typeof canvas.captureStream === 'function') ? canvas.captureStream(24) : null;
  const vt = out && out.getVideoTracks ? out.getVideoTracks()[0] : null;
  if (!vt) {
    fx.lastFail = '浏览器不支持 canvas.captureStream，滤镜管线无法启动';
    log(`⚠️ ${fx.lastFail}`);
    return false;
  }
  fx.video = v; fx.canvas = canvas; fx.ctx = ctx;
  fx.loCanvas = lo; fx.loCtx = loCtx;
  fx.keyCanvas = key; fx.keyCtx = keyCtx; fx.chromaOk = chromaOk;
  fx.origTrack = cameraTrack;   // 原始轨由管线攥着（localStream 里此刻还是它，sync 时换出）
  fx.procTrack = vt;
  fx.on = true; fx.costMs = 0; fx.n = 0; fx.errN = 0;
  fx.raf = requestAnimationFrame(fxFrame);
  return true;
}

// 单帧处理（rAF 驱动；captureStream(24) 只采样"画好的帧"，画得慢=帧率自动降，不会堆积）
function fxFrame() {
  fx.raf = 0;
  if (!fx.on) return;
  try {
    const t0 = performance.now();
    // 关摄像头（enabled=false）时空转省 CPU：输出轨静默黑屏，管线保持待命
    const outOn = cameraTrack && cameraTrack.enabled !== false;
    if (outOn && fx.video && fx.video.readyState >= 2) {
      /* ① 滤镜（GPU）：ctx.filter 由 GPU 合成器执行，一帧一次 drawImage */
      fx.ctx.filter = fxFilterStr();
      fx.ctx.drawImage(fx.video, 0, 0, fx.canvas.width, fx.canvas.height);
      fx.ctx.filter = 'none';
      /* ② 磨皮（GPU 混合）：低清画布上 blur 后放大回叠——模糊只糊高频细节（毛孔/细纹），
       *    放大叠半透明后轮廓仍在，"一键磨皮"不需要任何 AI。strength=0 跳过省 CPU */
      if (fx.smooth > 0 && fx.loCtx) {
        fx.loCtx.clearRect(0, 0, fx.loCanvas.width, fx.loCanvas.height);
        fx.loCtx.filter = 'blur(3px)';
        fx.loCtx.drawImage(fx.canvas, 0, 0, fx.loCanvas.width, fx.loCanvas.height);
        fx.loCtx.filter = 'none';
        fx.ctx.globalAlpha = Math.min(0.6, (fx.smooth / 100) * 0.75);
        fx.ctx.drawImage(fx.loCanvas, 0, 0, fx.canvas.width, fx.canvas.height);
        fx.ctx.globalAlpha = 1;
      }
      /* ③ 色键抠像（CPU）：整条管线里唯一逐像素的活，也是 CPU 账的大头 */
      if (fx.chroma && fx.chromaOk) fxChromaPass();
    }
    /* CPU 账：EMA 平滑（0.9 旧 + 0.1 新），每 24 帧刷一次徽标 ≈ 每秒一次，别让 DOM 更新抢 CPU */
    const cost = performance.now() - t0;
    fx.costMs = fx.costMs ? fx.costMs * 0.9 + cost * 0.1 : cost;
    fx.n++;
    if (fx.n % 24 === 0 && fxCost) {
      fxCost.textContent = `⚙️ ${fx.costMs.toFixed(1)} ms/帧 · ${fx.chroma && fx.chromaOk ? 'CPU 抠像' : 'GPU 滤镜'}`;
    }
  } catch (err) {
    fx.errN++;
    if (fx.errN > 30) { // 连续失败（画布被系统回收等极端情况）自动停车，别死循环烧 CPU
      log(`⚠️ 滤镜管线异常，已自动停止：${err.message}`);
      stopVideoFx();
      return;
    }
  }
  fx.raf = requestAnimationFrame(fxFrame);
}

// 色键一趟：拷帧 → 逐像素算色距写 alpha → 先画背景再叠前景。
// 为什么必须双画布？putImageData 是"连 alpha 一起整块替换"，不能直接盖在已画好背景的画布上。
function fxChromaPass() {
  const k = fx.keyCtx;
  const w = fx.canvas.width, h = fx.canvas.height;
  k.clearRect(0, 0, w, h);
  k.drawImage(fx.canvas, 0, 0, w, h);            // 把 ①② 的成品拷过来抠
  const img = k.getImageData(0, 0, w, h);        // ← CPU 大头：23 万像素读出
  const d = img.data;
  const kc = fx.keyMode === 'blue' ? { r: 40, g: 90, b: 220 } : { r: 70, g: 200, b: 90 };
  const tol = fx.chromaTol, soft = tol * 0.55;   // soft 以内全透明、tol 以外不动，中间线性羽化
  for (let i = 0; i < d.length; i += 4) {
    const dr = d[i] - kc.r, dg = d[i + 1] - kc.g, db = d[i + 2] - kc.b;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db); // 欧氏色距（优化方向：平方距离免开方）
    if (dist < tol) {
      d[i + 3] = dist <= soft ? 0 : Math.round(255 * (dist - soft) / (tol - soft));
    }
  }
  k.putImageData(img, 0, 0);
  fx.ctx.clearRect(0, 0, w, h);
  drawFxBg();                                    // 先铺背景
  fx.ctx.drawImage(fx.keyCanvas, 0, 0, w, h);    // 再把抠除后的前景盖上去（alpha 混合）
}

// 抠像背景：墨色/绢色/鎏金渐变（呼应全站水墨主题）/自定义图片（cover 模式铺满）
function drawFxBg() {
  const c = fx.ctx;
  if (fx.bgMode === 'image' && fx.bgImage) {
    const iw = fx.bgImage.width || 1, ih = fx.bgImage.height || 1;
    const s = Math.max(fx.canvas.width / iw, fx.canvas.height / ih); // cover：放大到铺满再居中裁
    c.drawImage(fx.bgImage, (fx.canvas.width - iw * s) / 2, (fx.canvas.height - ih * s) / 2, iw * s, ih * s);
    return;
  }
  if (fx.bgMode === 'silk') {
    c.fillStyle = '#e9e2d3';
  } else if (fx.bgMode === 'gold') {
    if (typeof c.createLinearGradient === 'function') {
      const g = c.createLinearGradient(0, 0, fx.canvas.width, fx.canvas.height);
      g.addColorStop(0, '#d8b36a'); g.addColorStop(1, '#a83a26');   // 鎏金 → 朱砂
      c.fillStyle = g;
    } else c.fillStyle = '#d8b36a';
  } else {
    c.fillStyle = '#171310'; // ink 墨色（默认）
  }
  c.fillRect(0, 0, fx.canvas.width, fx.canvas.height);
}

/* 统一出口：想不想跑管线（want）与在不在跑（fx.on）对表——
 *   要跑没跑 → 起管线 + 处理后轨顶替进 localStream + 上行 replaceTrack；
 *   不想要还在跑 → stopVideoFx 还原原始轨。档位/磨皮/阈值的滑动改的是 fx 状态，
 *   下一帧自动生效，不需要重启管线（管线吃的是 fx.xxx，不是闭包快照）。 */
async function syncFxPipeline() {
  const want = fx.preset !== 'none' || fx.chroma;
  if (want && !fx.on) {
    fx.lastFail = null;
    if (!fxEnsurePipeline()) {
      // ★ 09-17c：失败必须**弹出来**（原来只 revertFxChips + 写日志，用户看到的是"点了没反应"）
      showToast(`滤镜启动失败：${fx.lastFail || '环境不支持'}`, 'error');
      renderFxCost('bad');
      revertFxChips();
      return;
    }
    localStream.removeTrack(cameraTrack);      // 摘下原始轨（管线攥着它，不断开）
    localStream.addTrack(fx.procTrack);        // 处理后的轨顶替进 localStream ★ 核心一步
    cameraTrack = fx.procTrack;                // 此后 camBtn 关/开、D6 重连、publishTracks 全自动正确
    localVideo.srcObject = localStream;
    preVideoEl.srcObject = localStream;        // 预览页同步"所见即所得"
    const producer = findCameraProducer();
    if (producer) {
      try {
        await producer.replaceTrack({ track: fx.procTrack });
        log('✨ 滤镜已上行（replaceTrack，观众看到的就是处理后的画面）');
        renderFxCost('live', '已上行');
      } catch (err) {
        log(`⚠️ 滤镜上行失败：${err.message}`);
        renderFxCost('warn', '上行失败');
      }
    } else {
      log(`✨ 滤镜管线已启动（进会后推流自动带滤镜）`);
      renderFxCost('live', '待上行');
    }
  } else if (!want && fx.on) {
    stopVideoFx();
  }
}

/* ★ 09-17c：滤镜状态行（复用 fxCost 那一行，不新增 UI）
 * ▎用户反馈"滤镜没实现"多半是**看不出它到底跑没跑**：管线在跑但看不见效果（画面上没有对比物）、
 *   或者管线根本没起来（没摄像头/环境不支持）而界面毫无提示。
 *   状态行把三态说清楚：未启动 / 运行中(N ms/帧) / 失败原因。 */
function renderFxCost(level, note) {
  if (!fxCost) return;
  if (level === 'bad') {
    fxCost.textContent = `⚙️ 未启动（${fx.lastFail || '环境不支持'}）`;
    fxCost.classList.add('fx-cost-bad');
    return;
  }
  fxCost.classList.remove('fx-cost-bad');
  if (level === 'warn') { fxCost.textContent = `⚙️ 管线运行中 · ${note || '上行异常'}`; return; }
  if (level === 'live') { fxCost.textContent = `⚙️ 运行中 · ${note || ''} · 计帧中…`; return; }
  fxCost.textContent = '⚙️ -- ms/帧';
}

// 关管线：一切还原——localStream 换回原始轨、上行 replaceTrack 回原轨、资源全清
function stopVideoFx() {
  if (!fx.on) return;
  if (fx.raf) { cancelAnimationFrame(fx.raf); fx.raf = 0; }
  const proc = fx.procTrack, orig = fx.origTrack;
  fx.on = false; fx.procTrack = null; fx.origTrack = null;
  if (fx.video) { try { fx.video.srcObject = null; } catch (e) { /* 桩环境无碍 */ } }
  try { if (proc) proc.stop(); } catch (e) { /* 已停则忽略 */ }
  if (localStream && orig && cameraTrack === proc) {
    localStream.removeTrack(proc);
    localStream.addTrack(orig);
    cameraTrack = orig;
  }
  localVideo.srcObject = localStream;
  preVideoEl.srcObject = localStream;
  const producer = findCameraProducer();
  if (producer && orig) {
    producer.replaceTrack({ track: orig })
      .then(() => log('🚫 滤镜已关闭，恢复原始画面（replaceTrack）'))
      .catch((err) => log(`⚠️ 还原上行失败：${err.message}`));
  }
  if (fxCost) fxCost.textContent = '⚙️ -- ms/帧';
}

// 管线启动失败时把面板 UI 回滚到"全关"状态（UI 与 fx 状态不能各说各话）
function revertFxChips() {
  fx.preset = 'none';
  fx.chroma = false;
  fxChromaChk.checked = false;
  renderFxChips();
}

// 按钮组高亮（active 类）——三组 chip 一次刷完
function renderFxChips() {
  const mark = (box, attr, val) => {
    if (!box) return;
    box.querySelectorAll('.fx-chip').forEach((b) => {
      if (b.dataset[attr] === val) b.classList.add('active');
      else b.classList.remove('active');
    });
  };
  mark(fxPresets, 'preset', fx.preset);
  mark(fxKeys, 'key', fx.keyMode);
  mark(fxBgs, 'bg', fx.bgMode);
}

/* ---- 面板开合 + 控件事件（预览页与控制坞两个入口共用同一块浮层）---- */
function toggleFxPanel(show) {
  const open = show === undefined ? fxPanel.classList.contains('hidden') : show;
  fxPanel.classList.toggle('hidden', !open);
}
pjFxBtn.addEventListener('click', () => toggleFxPanel());
fxBtn.addEventListener('click', () => toggleFxPanel());
fxCloseBtn.addEventListener('click', () => toggleFxPanel(false));

// 滤镜档位：点了就生效（第一次点 = 启动管线），再点"原图" = 回原样并关管线
fxPresets.querySelectorAll('.fx-chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    fx.preset = btn.dataset.preset || 'none';
    renderFxChips();
    syncFxPipeline();
  });
});
// 键色：绿幕/蓝幕二选一（对准你身后的幕布颜色）
fxKeys.querySelectorAll('.fx-chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    fx.keyMode = btn.dataset.key || 'green';
    renderFxChips();
  });
});
// 抠像背景：选"图片"顺手弹文件选择框
fxBgs.querySelectorAll('.fx-chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    fx.bgMode = btn.dataset.bg || 'ink';
    renderFxChips();
    if (fx.bgMode === 'image' && typeof fxBgFile.click === 'function') fxBgFile.click();
  });
});
// 磨皮/阈值滑条：改的只是 fx 数值，下一帧自动生效（管线不用重启——状态与循环分离的红利）
fxSmooth.addEventListener('input', () => {
  fx.smooth = Number(fxSmooth.value) || 0;
  if (fxSmoothVal) fxSmoothVal.textContent = String(fx.smooth);
});
fxChromaTol.addEventListener('input', () => {
  fx.chromaTol = Number(fxChromaTol.value) || 60;
  if (fxChromaTolVal) fxChromaTolVal.textContent = String(fx.chromaTol);
});
// 绿幕开关：开 = 想要"虚拟背景"形态的管线（滤镜可以是原图 + 抠像）
fxChromaChk.addEventListener('change', () => {
  fx.chroma = !!fxChromaChk.checked;
  if (fx.chroma && !fx.chromaOk && fx.on) {
    log('⚠️ 当前环境不支持逐像素抠像（getImageData 不可用），虚拟背景降级为不可用');
    fx.chroma = false;
    fxChromaChk.checked = false;
    return;
  }
  renderFxChips();
  syncFxPipeline();
});
// 自定义背景图：FileReader 读成 Image（读失败不影响会议）
fxBgFile.addEventListener('change', () => {
  const f = fxBgFile.files && fxBgFile.files[0];
  if (!f || typeof FileReader !== 'function') return;
  try {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => { fx.bgImage = img; log('🖼️ 虚拟背景图片已就绪'); };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  } catch (err) { log(`⚠️ 背景图片读取失败：${err.message}`); }
});

/* ──────────────────────────────────────────────────────────────
 * 第 29 步：★ 实时字幕（Web Speech API · 2026-09-17，AI 线 L1）
 *
 * ▎这是什么？腾讯会议的"实时字幕"教学版：说话内容实时转成文字，显示在舞台底部
 *   字幕条上并广播给全房。这是 `AI部分功能计划.md` 第 9.3 节"最先解锁"的 AI 线能力——
 *   用浏览器内置的 **Web Speech API**（Chrome 免费提供语音识别），零新依赖、零费用、
 *   不需要任何 API 密钥；识别出的文字同时存进"字幕账本"，就是将来 C2
 *   （AI 会议纪要/问答）要喂给 LLM 的结构化上下文——**账本先行，AI 后到**。
 *
 * ▎三个设计取舍（面试可讲）：
 *   ① **每端识别自己的麦克风**，再把成稿广播出去——而不是把音频发给某人集中转写。
 *      好处：省上行带宽、不传原始语音（隐私）、识别语言跟着本人走；代价：每人各耗
 *      一份本地识别算力（Web Speech 的识别在浏览器厂商云端，本地只管采集）。
 *   ② **只广播 final 句，不广播 interim 半句**——interim 每几百毫秒变一次，广播它
 *      会把数据通道刷爆；本地字幕条 interim 用半透明样式实时跳动（所见即所得），
 *      认准了整句再发。字幕是即时性内容，丢一条无所谓 → **不做信令兜底、不做 msgId
 *      去重**（对比聊天的双路径+去重：聊天不容忍丢，字幕容忍丢——"可靠性按内容价值
 *      定价"是 QoS 设计的第一课）。
 *   ③ **骑 'chat' 频道而不新开频道**——字幕与聊天同为"全员广播的短文本"，且 SCTP
 *      流数不是免费的；真产品字幕量大/格式多（带说话人分段）才值得单开一条频道。
 *
 * ▎工程细节：Chrome 的识别器每 ~60 秒自动断一次 → onend 里若开关还开着就拉起
 *   （300ms 防抖）；`network` 错误 = 浏览器厂商的识别服务不可达（国内网络常见），
 *   明确提示并自动关闭，绝不让字幕功能拖垮会议（非阻塞降级，同 F3/F6 哲学）。
 * ────────────────────────────────────────────────────────────── */
const cap = {
  on: false,           // 字幕开关（=true 时识别器断了要自动拉起）
  rec: null,           // 当前 SpeechRecognition 实例
  restartTimer: 0,     // onend 自动重启的防抖定时器
  hideTimer: 0,        // 字幕条"8 秒无字幕自动隐藏"定时器
  log: [],             // ★ 字幕账本（C2 前置）：{ts, from, name, text}，上限 500 条
  lastError: null,     // ★ 09-17c：最近一次失败{word, fix}——诊断卡要把它显示出来
  neterr: 0,           // ★ 09-17c：network 错误的重试计数（3 次后停并给兜底指引）
};

function capSupported() {
  return typeof (window.SpeechRecognition || window.webkitSpeechRecognition) === 'function';
}

/* ★ 09-17c：字幕"三段自检"——把用户看到的现象翻译成可行动的原因
 * ▎为什么要有它？用户反馈"字幕不好用，是不是被浏览器拦了"——
 *   实际卡点通常是三类，而界面上原来只有一句"不可用"：
 *     ① 安全上下文：用 http://192.168.x.x 打开 → 浏览器直接禁掉麦克风与语音识别（真凶）
 *     ② 麦克风权限：被拒/被系统占用 → not-allowed / audio-capture
 *     ③ 识别服务：Web Speech 走浏览器厂商云端 → 受限网络报 network（国内最常见的"没反应"）
 * ▎每条都给出"怎么修"，用户能自己解决，而不是把问题丢给开发者。
 */
function capPreflight() {
  const checks = [];
  const secure = window.isSecureContext !== false; // 桩环境无此字段时按通过处理
  checks.push({
    ok: secure,
    text: secure
      ? '安全上下文：通过（https 或 localhost）'
      : '安全上下文：不通过 —— 你正在用 http:// + IP 访问，浏览器会禁用麦克风与语音识别',
    fix: '改用 https://<本机IP>:3443（自签证书点"继续访问"），或在本机用 http://localhost:3001',
  });
  const srOk = capSupported();
  checks.push({
    ok: srOk,
    text: srOk ? '语音识别 API：可用（Web Speech）' : '语音识别 API：当前浏览器不支持（Chrome/Edge 才有）',
    fix: '换用 Chrome 或 Edge（Firefox/Safari 无 Web Speech 识别）',
  });
  const micOk = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  checks.push({
    ok: micOk,
    text: micOk ? '媒体设备 API：可用' : '媒体设备 API：不可用（同安全上下文问题）',
    fix: '同第 1 条：换 https/localhost',
  });
  return { ok: secure && srOk && micOk, checks };
}

// 把识别器的错误码翻译成"人话 + 修法"（覆盖 Chrome 实际会抛的全部常见码）
function capErrorInfo(code) {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return { fatal: true, word: '麦克风权限被拒绝（或浏览器禁用了语音识别）',
        fix: '地址栏左侧的权限图标 → 允许麦克风；若仍失败，检查是否被安全策略禁用' };
    case 'audio-capture':
      return { fatal: true, word: '抓不到麦克风（被别的程序独占或设备异常）',
        fix: '关掉占用麦克风的程序（会议软件/录音机），或换一个输入设备' };
    case 'network':
      return { fatal: false, word: '语音识别服务不可达（Web Speech 依赖浏览器厂商云端）',
        fix: '换网络（能访问该云服务），或改用手动字幕' };
    case 'language-not-supported':
      return { fatal: true, word: '识别服务不支持 zh-CN', fix: '在浏览器设置里检查语言包，或改用手动字幕' };
    case 'no-speech':
      return { fatal: false, word: '这段时间没人说话（正常，会自动继续听）', fix: '' };
    case 'aborted':
      return { fatal: false, word: '识别被中止（切页面/系统抢占，会自动重启）', fix: '' };
    default:
      return { fatal: false, word: `识别出错：${code || '未知'}`, fix: '若持续出现，请点「💬 未开启」看自检报告' };
  }
}

// 自检徽标 + 诊断卡渲染（点徽标随时可看）
function renderCapStatus(text, level = '') {
  if (!capStatus) return;
  capStatus.textContent = text;
  capStatus.className = `cap-status ${level}`;
}
function renderCapDiag() {
  if (!capDiagList) return;
  const r = capPreflight();
  capDiagList.textContent = '';
  for (const c of r.checks) {
    const row = document.createElement('div');
    row.className = `cap-diag-row ${c.ok ? 'ok' : 'bad'}`;
    row.textContent = `${c.ok ? '✅' : '❌'} ${c.text}`;
    capDiagList.appendChild(row);
    if (!c.ok && c.fix) {
      const fix = document.createElement('div');
      fix.className = 'cap-diag-fix';
      fix.textContent = `↳ 怎么修：${c.fix}`;
      capDiagList.appendChild(fix);
    }
  }
  if (cap.lastError) {
    const row = document.createElement('div');
    row.className = 'cap-diag-row bad';
    row.textContent = `❌ 最近一次失败：${cap.lastError.word}`;
    capDiagList.appendChild(row);
    if (cap.lastError.fix) {
      const fix = document.createElement('div');
      fix.className = 'cap-diag-fix';
      fix.textContent = `↳ 怎么修：${cap.lastError.fix}`;
      capDiagList.appendChild(fix);
    }
  }
}

function toggleCaptions() {
  if (cap.on) {
    // 关：不再自动重启 + 停识别器（onend 会触发，但 wantRestart 已 false）
    cap.on = false;
    clearTimeout(cap.restartTimer);
    cap.restartTimer = 0; // ★ 第 30 步：排程句柄归零——看门狗靠「无排程」判断是否该接管
    if (cap.rec) { try { cap.rec.stop(); } catch (e) { /* 已停则忽略 */ } cap.rec = null; }
    setIconBtn(capBtn, ICONS.cc, '字幕');
    renderCapStatus('未开启');
    reportMyState({ caption: false }); // ★ 09-17b：字幕开关进房间状态机（成员列表 💬 徽标）
    log('💬 实时字幕已关闭');
    return;
  }

  /* ★ 09-17c：开之前先自检——把"必然失败"扼杀在点击那一刻，并直接告诉他怎么修 */
  const pre = capPreflight();
  renderCapDiag();
  if (!pre.ok) {
    const bad = pre.checks.find((c) => !c.ok);
    renderCapStatus('⚠️ 环境不支持', 'bad');
    capDiagBox.classList.remove('hidden');
    showToast(`字幕无法开启：${bad.text.split('：')[1] || bad.text}（已弹出自检报告）`, 'error');
    log(`💬 字幕自检未通过：${bad.text}；修法：${bad.fix || '-'}`);
    return;
  }

  cap.on = true;
  cap.neterr = 0;               // 重试预算清零
  if (!cap.sentry.startedAt) cap.sentry.startedAt = Date.now(); // ★ 第 30 步：值守计时起点（首次开字幕）
  setIconBtn(capBtn, ICONS.cc, '关字幕');
  renderCapStatus('🎙️ 识别中…', 'live');
  reportMyState({ caption: true });
  startCaptionRec();
  log('💬 实时字幕已开启（识别自己的麦克风，成稿广播全房）');
}

function startCaptionRec() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  cap.rec = rec;
  rec.lang = 'zh-CN';            // 教学版固定中文；真产品按用户设置/自动语种
  rec.continuous = true;         // 连续识别（说完一句接着下一句）
  rec.interimResults = true;     // 要半句结果：本地字幕条实时跳动用
  // ★ 09-17c：onstart/onaudio 给"到底有没有在听"一个明确的界面反馈
  rec.onstart = () => {
    renderCapStatus('🎙️ 识别中…', 'live');
    // ★ 第 30 步值守：识别器成功起来了 = 自愈成功，失败计数与退避排程全部复位
    cap.neterr = 0;
    cap.backoffUntil = 0;
  };
  rec.onaudiostart = () => renderCapStatus('🎙️ 已采集到声音', 'live');
  rec.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      const text = (r[0] && r[0].transcript || '').trim();
      if (!text) continue;
      if (r.isFinal) emitCaption(text);      // 认准整句：入账 + 广播 + 字幕条定稿
      else interim += text;                  // 半句：只本地跳动，不广播
    }
    if (interim) { showCaptionBar(myDisplayName || '我', interim, true); renderCapStatus('🎙️ 识别中…', 'live'); }
  };
  rec.onend = () => {
    cap.rec = null;
    /* ★ Chrome 的识别器每 ~60 秒自己断一次：开关还开着就必须拉起，字幕才能一直有。
     * ★ 09-17c：但"致命错误"（权限/设备/语言）不能无限重启——那会变成静默死循环，
     *   用户只看到徽标一直亮、一个字都没有。致命错误在 onerror 里已 cap.on=false，
     *   所以这里多一道保险：只有 cap.on 仍为 true 才重启。
     * ★ 第 30 步值守：network 连续失败时 cap.backoffUntil 里有退避排程
     *   （30s→60s→…→5min 封顶），此时按退避等，别再用 300ms 猛冲。 */
    if (cap.on) {
      clearTimeout(cap.restartTimer);
      const wait = Math.max(0, (cap.backoffUntil || 0) - Date.now());
      cap.restartTimer = setTimeout(() => {
        cap.restartTimer = 0; // ★ 第 30 步：回调已执行，句柄归零——看门狗的「无排程」判断才准
        if (cap.on) startCaptionRec();
      }, wait || 300);
    } else {
      renderCapStatus('⚠️ 已停止', 'bad');
    }
  };
  rec.onerror = (event) => {
    const info = capErrorInfo(event.error);
    cap.lastError = info;
    log(`💬 字幕错误[${event.error}]：${info.word}${info.fix ? `；修法：${info.fix}` : ''}`);

    if (info.fatal) {
      renderCapStatus(`⚠️ ${info.word}`, 'bad');
      showToast(`字幕已停止：${info.word}`, 'error');
      renderCapDiag();
      capDiagBox.classList.remove('hidden'); // 直接摊开自检卡（用户最需要的是"怎么修"）
      toggleCaptions();                      // 统一关闭路径（会把 cap.on 置 false 并复位 UI）
      return;
    }

    // 非致命：network 给 3 次重试预算（网络抖动常常能自愈），其它交给 onend 自动重启
    if (event.error === 'network') {
      /* ★ 第 30 步值守化（过夜长跑）：原来是"连续 3 次就永久停"——那对一小时会议合理，
       *   挂一夜时后半夜网络抖三下，字幕就停在凌晨两点，早上只看到一片空白。
       *   改成指数退避：30s→60s→120s→240s→5min 封顶，连续 CAP_NET_GIVE_UP 次
       *   （约 45 分钟连不上）才放弃；期间每次失败刷新徽标，值守统计里能看到次数。 */
      cap.neterr = (cap.neterr || 0) + 1;
      if (cap.neterr >= CAP_NET_GIVE_UP) {
        renderCapStatus('⚠️ 识别服务不可达', 'bad');
        showToast(`语音识别服务连续 ${CAP_NET_GIVE_UP} 次不可达（Web Speech 依赖浏览器厂商云端）；可用「手动字幕」兜底`, 'error');
        renderCapDiag();
        capDiagBox.classList.remove('hidden');
        toggleCaptions();
      } else {
        const delay = Math.min(30000 * Math.pow(2, cap.neterr - 1), 300000);
        cap.backoffUntil = Date.now() + delay; // onend 的重启排程会读它（见上）
        renderCapStatus(`⚠️ 识别服务不可达，${Math.round(delay / 1000)}s 后重试（${cap.neterr}/${CAP_NET_GIVE_UP}）`, 'bad');
      }
    } else if (event.error === 'no-speech') {
      renderCapStatus('🎙️ 等待说话…', 'live');
    }
  };
  try {
    rec.start();
  } catch (err) {
    // 最典型的"点了没反应"：同一次会话里连续 start() 会抛 InvalidStateError
    log(`⚠️ 字幕识别器启动失败：${err.message}`);
    renderCapStatus('⚠️ 启动失败', 'bad');
    cap.on = false;
    setIconBtn(capBtn, ICONS.cc, '字幕');
  }
}

// 一句成稿的三件事：入账本（C2 的弹药）→ 本地字幕条定稿 → SCTP 广播全房
function emitCaption(text) {
  const entry = { ts: Date.now(), from: socket.id, name: myDisplayName || '我', text };
  capPushLog(entry);
  showCaptionBar(myDisplayName || '我', text, false);
  if (capHistoryPanel && !capHistoryPanel.classList.contains('hidden')) appendCapHistoryRow(entry);
  /* ★ 09-26b 唤醒词：成稿里提到「小明」且 AI 在场 → 自动接话（整句作为提问）。
   *   为什么放客户端：字幕在每端本地识别，谁嘴里说出"小明"谁触发——服务端
   *   听不到字（它只有音频管线没有转写），这是当前架构下最自然的挂点。 */
  if (AI_NICKNAME && text.includes(AI_NICKNAME) && lastMembers.some((m) => m.isBot)) {
    socket.emit('ai-ask', { question: text });
    log(`🤖 ${AI_NICKNAME} 听到你叫它了，正在组织回答…`);
  }
  if (!chatDataProducer || chatDataProducer.closed) return; // SCTP 不在（没进房/重连中）→ 只显示本地
  try {
    chatDataProducer.send(JSON.stringify({
      type: 'caption',
      from: socket.id,
      name: myDisplayName || undefined,
      text,
    }));
  } catch (err) {
    // 字幕容忍丢：发送失败只记日志，绝不为它造兜底路（与聊天双路径形成对照）
    log(`⚠️ 字幕广播失败（丢弃，不影响本地显示）：${err.message}`);
  }
}

// 收到别人的字幕：同样入账本 + 字幕条（字幕条永远显示"最近说话的人"）
function handleCaptionMessage(from, msg) {
  const entry = { ts: Date.now(), from, name: msg.name || `成员 ${shortId(from)}`, text: msg.text };
  capPushLog(entry);
  showCaptionBar(entry.name, msg.text, false);
  if (capHistoryPanel && !capHistoryPanel.classList.contains('hidden')) appendCapHistoryRow(entry);
  bumpBotHeard();   // ★ 09-25：字幕 = AI 助理"的确在听"的可见证据（见 botHearingNote 注释）
}

function capPushLog(entry) {
  cap.log.push(entry);
  /* ★ 09-25 重构：把"保留历史"与"上传队列"**拆成两个独立的东西**。
   * ▎为什么必须拆（原本是一体的，且拆之前做不到"实时上行"）：
   *   原实现是 `cap.log` 既当热窗口又当上传队列——只有它涨到 500 条才把旧的剪去上传。
   *   于是**服务器要等 500 条字幕才知道会上发生了什么**，服务端的 AI 看板/问答
   *   全部滞后一整段会议（这是"AI 无法实时参与会议"的根本原因）。
   *   但直接把阈值调小也不行：`cap.log` 同时供字幕历史面板（slice(-100)）和
   *   导出/日报使用，窗口一小，用户能回看的字幕就少了一截——那是功能倒退。
   * ▎拆完各司其职：
   *   · cap.log   = 保留历史（上限 500，仅剪切，不再参与上传）→ 面板/导出照旧；
   *   · sentry.queue = 上传队列（按阈值或定时器排空）→ 可以按需调快调慢。
   *   两者各自收到**同一条** entry 一次，所以既不会重复入库，也不会有条目丢失。 */
  cap.sentry.queue.push(entry);
  cap.sentry.total++; // ★ 第 30 步：值守累计计数（含已归档/待归档的——内存里被剪掉的也算）
  if (cap.log.length > 500) cap.log.splice(0, cap.log.length - 500); // 只剪不再传（上传走 queue）
  if (cap.sentry.queue.length >= capUploadWindow()) {
    capSentryOnSpill(cap.sentry.queue.splice(0));
  }
}

/* ★ 09-25 自适应上行窗口：AI 助理在场时把上传调快（看板要跟着会议实时走），
 *   不在场时保持原样（没有消费者，没必要多打网络）。
 *   ▎为什么"AI 在场才调快"而不是一直快：归档请求的是**可靠性**（宁可攒批少打网络），
 *     而看板请求的是**时效性**。两个消费者的诉求不同，就按"有没有消费者"切换策略——
 *     这比"一律变快"（白耗流量）和"一律慢"（看板废掉）都更贴切。 */
const CAP_WINDOW_IDLE = 500;    // 无 AI：沿用原阈值
const CAP_WINDOW_LIVE = 12;     // AI 在场：攒 12 条就上送（约等于"说几句就同步一次"）
function capUploadWindow() {
  return sfuHasBot ? CAP_WINDOW_LIVE : CAP_WINDOW_IDLE;
}

/* ★ 09-25 定时兜底上行：字幕可能是**稀疏**的（几分钟才一句），
 *   只靠条数阈值的话，看板会在冷场期一直不更新。
 *   每 6s 把队列里攒着的推一次——保证"即使没人连续说话，看板也不会哑"。 */
const CAP_LIVE_TICK_MS = 6000;
setInterval(() => {
  if (!sfuHasBot || !myRoom) return;
  /* ⚠️ 必须先 spill 再 flush：字幕进的是 queue（新队列），而 capSentryFlush 只发 batch。
   *   直接调 flush 会"看着像在工作、实际什么都没发"（初版就是这么写的）——
   *   capSentryOnSpill 内部会把 queue 的内容推进 batch 并接着 flush，所以走它。
   *   队列为空时仍尝试一次 flush：那是为了**重试上一次失败的批次**（batch 里滞留的）。 */
  try {
    if (cap.sentry.queue.length) capSentryOnSpill(cap.sentry.queue.splice(0));
    else if (cap.sentry.batch.length) capSentryFlush();
  } catch (e) { /* 上行失败静默（已有 lastPostErr 限流提示），下一轮再试 */ }
}, CAP_LIVE_TICK_MS);

// 字幕条显示：文本更新 + 显示 + 8 秒无新字幕自动隐藏（真产品同款节奏）
function showCaptionBar(name, text, interim) {
  if (!captionBar || !captionText) return;
  captionText.innerHTML = `<span class="caption-name">${escapeHtml(name)}</span>${escapeHtml(text)}`;
  captionText.classList.toggle('interim', !!interim);
  captionBar.classList.remove('hidden');
  clearTimeout(cap.hideTimer);
  cap.hideTimer = setTimeout(() => {
    if (captionBar) captionBar.classList.add('hidden');
  }, 8000);
}

// 字幕账本导出（C2 之外的人工用途：会议记录随手存 txt；Blob 下载同 D5 录制产物）
// ★ 第 30 步值守：挂了一夜后内存只剩最近 500 条——导出前先拉服务器全档（/api/captions）
//   合并成一份 txt；服务器不可达时降级为只导内存段（导出仍然成功，头部会注明差了多少）。
capExportBtn.addEventListener('click', async () => {
  const s = cap.sentry;
  if (!cap.log.length && !s.archived && !s.batch.length) {
    showToast('还没有字幕记录', 'error');
    return;
  }
  let archiveText = '';
  let archiveCount = 0;
  if (myRoom && typeof fetch === 'function') {
    try {
      const res = await fetch(`/api/captions?room=${encodeURIComponent(String(myRoom))}&format=txt`, {
        headers: roomTokenHeader(), // ★ 09-24 C4：会议内容接口要房间内令牌（游客也有）
      });
      if (res.ok) {
        archiveText = await res.text();
        archiveCount = archiveText ? archiveText.split('\n').filter(Boolean).length : 0;
      }
    } catch (err) {
      log(`⚠️ 服务器归档拉取失败（${err.message}），本次只导出内存段`);
    }
  }
  const lines = cap.log.map((e) => `[${new Date(e.ts).toLocaleTimeString()}] ${e.name}: ${e.text}`);
  let text = `实时字幕记录（${new Date().toLocaleString()}）\n\n`;
  if (archiveText) {
    text += `—— 服务器归档（历史全档 ${archiveCount} 条）——\n${archiveText}\n`;
    text += `—— 本次内存段（最近 ${cap.log.length} 条）——\n`;
  } else if (s.archived) {
    text += `（注：另有 ${s.archived} 条已归档在服务器，此刻拉取失败，以下仅内存最近段）\n`;
  }
  text += `${lines.join('\n')}\n`;
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `captions-${Date.now()}.txt`;
  if (typeof a.click === 'function') a.click();
  URL.revokeObjectURL(url);
  log(`📜 已导出字幕记录（内存 ${cap.log.length} 条${archiveCount ? ` + 服务器归档 ${archiveCount} 条` : ''}）`);
});

capBtn.addEventListener('click', toggleCaptions);

/* ---- ★ 09-25「🗂 汇总」：跨段归并（把按小时切开的纪要合成一份总纪要）----
 * ▎为什么和「📝 纪要」并排放在同一个工具条里：它们是同一件事的**不同粒度**
 *   （分段 = 1 小时 / 终稿 = 本次会议 / 归并 = 把已有分段合成"这场会到底发生了什么"）。
 *   放在一起，用户才能理解成"粒度选项"，而不是两个互不相干的功能。
 * ▎值守场景才是它的主场：挂一夜产出 7~8 份分段纪要，没有人会逐份读——
 *   早上要的就是一份。源文件不删（细节仍可回溯）。 */
const capMergeBtn = $('capMergeBtn');
if (capMergeBtn) {
  capMergeBtn.addEventListener('click', async () => {
    if (!myRoom) { showToast('先进房间再汇总纪要', 'error'); return; }
    capMergeBtn.disabled = true;
    const oldTxt = capMergeBtn.textContent;
    capMergeBtn.textContent = '汇总中…';
    try {
      const res = await request('ai-minutes', { type: 'merge' });
      showToast(`已归并 ${res.data.sources || 0} 份分段纪要`, 'ok');
      log(`🗂 跨段归并完成：${res.data.path}（来源 ${res.data.sources || 0} 份）`);
    } catch (err) {
      /* 服务器把"只有一份、无需归并"这类**业务边界**也走同一条错误路径，
       * 所以这里原样展示即可——那条文案本身就是给人看的（不是"生成失败：xxx"）。 */
      showToast(err.message || String(err), 'error');
    } finally {
      capMergeBtn.disabled = false;
      capMergeBtn.textContent = oldTxt;
    }
  });
}

/* ---- ★ 09-24 AI 会议助理：「📝 纪要」按钮（字幕资产的下游产品）----
 * ▎一路走来：第 29 步攒字幕账本 → 第 30 步把账本归档到服务器 → 现在这一步，
 *   账本第一次被真正"消费"（喂 LLM 出要点/待办/结论）。**账本先建好，AI 自然能长出来**。
 *   这也是为什么纪要不需要 bot 在场：它吃的是账本，不是聊天对话。 */
const capMinutesBtn = $('capMinutesBtn');
if (capMinutesBtn) {
  capMinutesBtn.addEventListener('click', async () => {
    if (!myRoom) { showToast('先进房间再生成纪要', 'error'); return; }
    capMinutesBtn.disabled = true;
    const old = capMinutesBtn.textContent;
    capMinutesBtn.textContent = '📝 生成中…';
    try {
      const res = await request('ai-minutes', { type: 'segment' });
      // 服务器已经向全房广播了一条带下载链接的气泡，这里只补本地反馈 + 日志
      showToast(res.data.mock ? '纪要已生成（[Mock] 本地模板）' : '纪要已生成（LLM 撰写）', 'ok');
      log(`📝 纪要已生成：${res.data.path}${res.data.mock ? '（[Mock] 本地模板）' : ''}`);
    } catch (err) {
      showToast('纪要生成失败：' + (err.message || err), 'error');
    } finally {
      capMinutesBtn.disabled = false;
      capMinutesBtn.textContent = old;
    }
  });
}

/* ---- ★ 09-17c 手动字幕兜底 + 自检卡交互 ----
 * ▎为什么值得做？实时字幕的"不可用"往往是环境问题（安全上下文/云端服务），
 *   用户没法当天解决，但"开会要记录内容"这件事不能因此卡住——
 *   打字发字幕是零依赖、永远可用的兜底路径，而且走的是同一条广播链（emitCaption），
 *   所以它一样会进字幕账本、一样会广播给全房、一样能被导出（未来也能喂给 AI 纪要）。
 */
function sendManualCaption() {
  const text = (capManualInput && capManualInput.value || '').trim();
  if (!text) return;
  if (!myRoom) { showToast('还没进房间，手动字幕发不出去', 'error'); return; }
  emitCaption(text);                     // 与语音字幕完全同一条路径：入账 + 全房广播
  log(`💬 手动字幕已发送（${text.length} 字）`);
  if (capManualInput) capManualInput.value = '';
}
if (capManualSend) capManualSend.addEventListener('click', sendManualCaption);
if (capManualInput) {
  capManualInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendManualCaption(); }
  });
}
// 点状态徽标 = 随时查看自检报告（不依赖"是否出过错"）
if (capStatus) {
  capStatus.addEventListener('click', () => {
    renderCapDiag();
    capDiagBox.classList.toggle('hidden');
  });
}
if (capDiagCloseBtn) capDiagCloseBtn.addEventListener('click', () => capDiagBox.classList.add('hidden'));

/* ---- ② 字幕历史抽屉（09-17b）：真产品字幕都能往上回看——本 Demo 的实现就是
 *   把 cap.log 渲染成滚动列表。注意两点：
 *   ① 字幕文本是远端用户输入 → 渲染一律 createElement + textContent（聊天 XSS 同款纪律，
 *      绝不 innerHTML 拼接）；
 *   ② 抽屉开着时新字幕"追加一行 + 滚底"（不全量重渲染，列表不闪烁）；关→开时全量渲染
 *      尾部 100 条（再早的还在账本里，导出 txt 是全量）。 ---- */
function appendCapHistoryRow(entry) {
  if (!capHistoryList) return;
  appendToCapGroup(capHistoryList, entry);
  capHistoryList.scrollTop = capHistoryList.scrollHeight; // 新字幕自动滚到底（回看时会被拉下去，真产品同款行为）
}

/* ★ 09-19 Otter.ai 排版节奏（用户点名参考）：
 *   连续同一说话人的字幕合并成一个「段」——段头 = 名字 + 段首时间，
 *   段内每句一行；最新一行加金色高亮（.now）。这种"说话人分组"的节奏
 *   让回看时一眼分清"谁在连续发言"，比逐条 [时间][名][文] 的流水账可读得多。
 *   全部 createElement + textContent（XSS 纪律同聊天）。
 * ▎实现注意：分组状态从 DOM 自身推断（最后一段的 dataset.speaker）——
 *   全量渲染与逐条追加走同一条路径，两端天然一致（事件溯源同款哲学）。 */
function capGroupOf(list, entry) {
  const kids = list.children;
  const last = kids.length ? kids[kids.length - 1] : null;
  if (last && last.dataset && last.dataset.speaker === entry.name) return last;
  const group = document.createElement('div');
  group.className = 'cap-h-group';
  group.dataset.speaker = entry.name;
  const head = document.createElement('div');
  head.className = 'cap-h-head-row';
  const name = document.createElement('span');
  name.className = 'cap-h-name';
  name.textContent = entry.name;
  const time = document.createElement('span');
  time.className = 'cap-h-time';
  time.textContent = new Date(entry.ts).toLocaleTimeString();
  head.appendChild(name); head.appendChild(time);
  const lines = document.createElement('div');
  lines.className = 'cap-h-lines';
  group.appendChild(head); group.appendChild(lines);
  list.appendChild(group);
  return group;
}

function appendToCapGroup(list, entry) {
  const group = capGroupOf(list, entry);
  const lines = group.children[1]; // [head, lines] 固定结构（桩与真 DOM 都按 children 索引取）
  const prev = lines.children.length ? lines.children[lines.children.length - 1] : null;
  if (prev) prev.classList.remove('now');
  const row = document.createElement('div');
  row.className = 'cap-h-line';
  row.classList.add('now'); // ★ 桩兼容（坑 27 同源）：className 字符串赋值不会同步 classList 集合
  row.textContent = entry.text;
  lines.appendChild(row);
}

function renderCapHistory() {
  const tail = cap.log.slice(-100);
  capHistoryList.textContent = '';
  for (const entry of tail) appendToCapGroup(capHistoryList, entry);
  capHistoryList.scrollTop = capHistoryList.scrollHeight;
}

function toggleCapHistory(show) {
  if (!capHistoryPanel) return;
  const open = show === undefined ? capHistoryPanel.classList.contains('hidden') : show;
  if (open) {
    if (!cap.log.length) {
      showToast('还没有字幕记录（开着字幕说几句话试试）', 'error');
      return;
    }
    renderCapHistory();
    capHistoryPanel.classList.remove('hidden');
  } else {
    capHistoryPanel.classList.add('hidden');
  }
}
capHistoryBtn.addEventListener('click', () => toggleCapHistory());
capHistoryCloseBtn.addEventListener('click', () => toggleCapHistory(false));

/* ════════════════════════════════════════════════════════════════════
 * 第 30 步 ★ 09-17e 值守模式（过夜长跑 ≥7 小时，AI 线 C3-N1）
 * ▎目标：睡前开字幕挂一夜，早上拿到「完整字幕全档 + 值守日志」，零人工干预零费用。
 *   规划全文见 `AI部分功能计划.md` 第 3.6 节；路线图 C3（`后续升级方向.md`）。
 * ▎L1（第 29 步）按"一小时的会"设计，挂满一夜会在三个点上出事，本步逐一补齐：
 *   ① 账本 cap.log 是 500 条环形 → 后半夜把早期字幕全挤掉了
 *      → 溢出归档：capPushLog 剪掉的旧段攒批 POST /api/captions，服务器落 jsonl。
 *        上传失败滞留内存批里（60s 兜底重试 + 断线重连后自然再试），绝不丢账。
 *   ② network 错误 3 次就永久停 → 后半夜网络抖三下字幕就停在凌晨两点
 *      → 值守级退避：连续失败按 30s→60s→…→5min 退避，约 45 分钟连不上才放弃
 *        （改动点在第 29 步的 onerror/onend，带「第 30 步」注释）；
 *        另加看门狗 setTimeout 链巡检 cap.rec——onend 没触发的静默失效也兜住，
 *        拉起后一个周期内又死则间隔翻倍（5 分钟封顶），重启次数全部记账。
 *   ③ 夜里发生过什么无从知晓 → 值守统计（时长/条数/重启/已归档）挂在字幕历史
 *      抽屉头部 + 每 30 分钟一行心跳日志；导出 txt 自动合并服务器全档。
 * ▎全部零依赖：fetch 是浏览器内置，服务器侧只是 fs.appendFile——不需要 LLM key
 *   （N2「定时纪要」等 key 到位再做，见 AI部分功能计划.md 第 3.6 节）。
 * ════════════════════════════════════════════════════════════════════ */
const capSentryStats = $('capSentryStats'); // 字幕历史抽屉头部的值守统计一行
const capReportBtn = $('capReportBtn');   // ★ 第 31 步：值守日报按钮（字幕历史抽屉头部）

// 值守状态：挂在 cap 上与第 29 步的开关/账本同居一个对象，看一眼就懂全貌
cap.sentry = {
  startedAt: 0,    // 首次开字幕的时间戳（值守计时起点；关字幕不清零——一夜的账要留着看）
  total: 0,        // 累计入账条数（含已归档的——内存里已经没有的也算，见 capPushLog）
  restarts: 0,     // 看门狗拉起识别器的次数（onend 的 300ms 常规续命不算在内）
  queue: [],       // ★ 09-25：待上行队列（与 cap.log 解耦；见 capPushLog 的注释）
  batch: [],       // 待落盘的溢出字幕（POST 失败滞留这里，兜底重试会再发）
  archived: 0,     // 已成功落盘到服务器的条数
  drops: 0,        // 滞留批超上限被丢弃的最老条数（正常不该发生，发生了要在统计里看见）
  pushing: false,  // 防并发上传（上一次 fetch 没回来时不再发第二批）
  lastPostErr: 0,  // 最近一次上传失败的时刻（日志限流：失败提示最多一分钟一条）
};
cap.backoffUntil = 0;   // network 退避排程：此时刻之前 onend 不要急着重启识别器

const CAP_NET_GIVE_UP = 12;        // network 连续失败放弃阈值（30s 起步指数退避，约 45 分钟）
const CAP_BATCH_LIMIT = 5000;      // 滞留批上限（约一晚的量级；超了丢最老并在统计里记账）
const CAP_WD_MS = (typeof window !== 'undefined' && window.CAP_WD_MS) || 30000; // 看门狗周期（冒烟桩会缩短）
const CAP_HB_MS = 30 * 60 * 1000;  // 值守心跳：每 30 分钟往日志区打一行

/* 溢出入队：capPushLog 剪掉的旧段调这里——入滞留批并立刻尝试上传。
 * 溢出本身是低频事件（第 501 条才发生一次），逐次 flush 不会造成请求风暴；
 * 真正的节流靠 pushing 标志 + 60s 兜底重试。 */
function capSentryOnSpill(cut) {
  const s = cap.sentry;
  s.batch.push(...cut);
  if (s.batch.length > CAP_BATCH_LIMIT) {
    s.drops += s.batch.length - CAP_BATCH_LIMIT;
    s.batch.splice(0, s.batch.length - CAP_BATCH_LIMIT);
  }
  capSentryFlush();
}

/* 把滞留批上传给服务器落盘。失败静默滞留（只限流打日志），下一轮兜底再试——
 * 「能传多少传多少，一 条不丢」比「立刻报错」重要，这是值守模式的可靠性取向。 */
async function capSentryFlush() {
  const s = cap.sentry;
  if (s.pushing || !s.batch.length || !myRoom) return; // 没进房先攒着（myRoom 在重连后会恢复）
  if (typeof fetch !== 'function') return;             // 极老环境：只记账不上传
  s.pushing = true;
  const send = s.batch.slice();                        // 拷一份发：上传期间新溢出的不混进这一批
  try {
    const res = await fetch('/api/captions', {
      method: 'POST',
      // ★ 09-24 C4：归档 POST 也要房间内令牌（游客的字幕归档靠它，绝不能被门禁误伤）
      headers: { 'Content-Type': 'application/json', ...roomTokenHeader() },
      body: JSON.stringify({ room: String(myRoom), entries: send }),
    });
    if (res.ok) {
      s.archived += send.length;
      s.batch.splice(0, send.length);                  // 只清这次发掉的，新溢出的留在批里
      renderCapSentry();
      s.pushing = false;
      // 上传完成时批里还有货（上传期间又溢出的）→ 立刻续传，别等 60s 兜底
      if (s.batch.length) capSentryFlush();
      return;
    } else if (Date.now() - s.lastPostErr > 60000) {
      s.lastPostErr = Date.now();
      log(`🌙 值守归档上传失败（HTTP ${res.status}），${send.length} 条滞留待重发`);
    }
  } catch (err) {
    if (Date.now() - s.lastPostErr > 60000) {
      s.lastPostErr = Date.now();
      log(`🌙 值守归档上传失败（${err.message}），${send.length} 条滞留待重发`);
    }
  }
  s.pushing = false;
}
setInterval(capSentryFlush, 60000); // 兜底重试：滞留批每分钟再试一次（断线重连后也靠它续传）

/* 看门狗：setTimeout 自调度链，常态每 30s 巡检一次。
 * 管的是 onend 之外的静默失效（识别器没了、onend 也没来）；常规续命仍归 onend。
 * 拉起后一个周期内又失联 = 启动即坏 → 间隔翻倍（30s→60s→…→5min 封顶）防日志风暴；
 * 巡检跳过「已有重启排程」的窗口（onend 的 300ms 延迟期间 rec 是 null，别误判失联）。 */
let capWdStreak = 0;
function capSentryWatchdog() {
  setTimeout(() => {
    try {
      if (cap.on && !cap.rec && !cap.restartTimer) {
        cap.sentry.restarts++;
        log(`🌙 值守看门狗：识别器失联，第 ${cap.sentry.restarts} 次自动拉起`);
        startCaptionRec();               // 内部有 try/catch，启动失败不会抛出来
        capWdStreak = Math.min(capWdStreak + 1, 4);
      } else if (cap.rec) {
        capWdStreak = 0;                 // 活着：退避复位
      }
    } finally {
      capSentryWatchdog();               // 链式调度下一轮；字幕关着时它只空转不拉起
    }
  }, Math.min(CAP_WD_MS * Math.pow(2, capWdStreak), 300000));
}
capSentryWatchdog();

/* 值守统计渲染：字幕历史抽屉头部一行（🌙 时长 · 累计条数 · 重启 · 已归档 · 丢弃）。
 * 开抽屉时立刻刷 + 每 30s 刷一次；没开过字幕就保持空白不占地方。 */
function renderCapSentry() {
  if (!capSentryStats) return;
  const s = cap.sentry;
  if (!s.startedAt) { capSentryStats.textContent = ''; return; }
  const mins = Math.max(0, Math.floor((Date.now() - s.startedAt) / 60000));
  const dur = mins >= 60 ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}m` : `${mins}m`;
  capSentryStats.textContent =
    `🌙 值守 ${dur} · ${s.total} 条 · 重启 ${s.restarts} · 已归档 ${s.archived}` +
    (s.drops ? ` · 丢 ${s.drops}` : '');
}
setInterval(renderCapSentry, 30000);
capHistoryBtn.addEventListener('click', renderCapSentry); // 打开抽屉立刻看到最新统计

/* 值守心跳：每 30 分钟一行人读日志，早上从日志区就能回放"夜里发生了什么"。
 * 只在值守中（开过字幕且当前字幕仍开着）才打，避免空转刷屏。 */
setInterval(() => {
  const s = cap.sentry;
  if (!s.startedAt || !cap.on) return;
  const mins = Math.floor((Date.now() - s.startedAt) / 60000);
  log(`🌙 值守心跳：已值守 ${Math.floor(mins / 60)}h${mins % 60}m · 累计 ${s.total} 条 · ` +
      `重启 ${s.restarts} 次 · 已归档 ${s.archived} 条 · 滞留 ${s.batch.length} 条` +
      (s.drops ? ` · 丢 ${s.drops}` : ''));
}, CAP_HB_MS);

/* ──────────────────────────────────────────────────────────────
 * 第 31 步 ★ 09-18 离线值守日报（AI 线 C1：零 LLM 的结构化纪要）
 * ▎是什么：点「📋 日报」把这场会/这一夜的字幕合成一份 markdown 报告——
 *   值守时长、累计条数、说话人占比 Top、每小时活跃分布、识别器健康（重启次数）。
 * ▎为什么零 LLM 也有价值：N2（LLM 纪要）要 key、要花钱、断网就瘫；
 *   日报是**纯本地统计**，永远可用——真产品的"会议摘要"也是先算统计再谈理解。
 *   它和 N2 的关系：日报给出结构骨架，LLM 负责"读懂内容"，两层互为兜底。
 * ▎数据口径：服务器归档（format=json，溢出的旧账）+ 内存热窗口（最近 500 条）
 *   = 全档；两边按设计不重叠（归档的都是已从内存剪掉的）。
 * ▎产物：Blob 下载 report-<房间号>-<日期>.md（同字幕导出的下载路径）。
 * ────────────────────────────────────────────────────────────── */
capReportBtn.addEventListener('click', async () => {
  // ① 合并全档：先拉服务器归档（没进房/拉失败就只用内存窗口，日报照样能出）
  let all = cap.log.slice();
  if (myRoom && typeof fetch === 'function') {
    try {
      const res = await fetch(`/api/captions?room=${encodeURIComponent(String(myRoom))}&format=json`, {
        headers: roomTokenHeader(), // ★ 09-24 C4：日报回读同样要房间内令牌
      });
      if (res.ok) all = (await res.json()).concat(cap.log);
    } catch (err) { /* 服务器不可达：用内存窗口出简版 */ }
  }
  if (!all.length) {
    showToast('还没有字幕记录，出不了日报', 'error');
    return;
  }
  all.sort((a, b) => (a.ts || 0) - (b.ts || 0));

  // ② 统计：时间范围 / 说话人占比 / 每小时分布
  const first = all[0].ts, last = all[all.length - 1].ts;
  const durMin = Math.max(1, Math.round((last - first) / 60000));
  const bySpeaker = new Map();
  const byHour = new Map();
  for (const e of all) {
    const name = e.name || '未知';
    bySpeaker.set(name, (bySpeaker.get(name) || 0) + 1);
    const hourKey = new Date(e.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', hour12: false }) + ':00';
    byHour.set(hourKey, (byHour.get(hourKey) || 0) + 1);
  }
  const speakers = [...bySpeaker.entries()].sort((a, b) => b[1] - a[1]);
  const hours = [...byHour.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const maxHour = Math.max(...hours.map(([, n]) => n));

  // ③ 拼 markdown（全 textContent 安全字符，Blob 下载同字幕导出）
  const s = cap.sentry;
  const lines = [];
  lines.push(`# 值守日报 · 房间 ${myRoom || '(未知)'}`);
  lines.push('');
  lines.push(`- 生成时间：${new Date().toLocaleString()}`);
  lines.push(`- 首条字幕：${new Date(first).toLocaleTimeString()} · 末条：${new Date(last).toLocaleTimeString()}（跨度约 ${durMin} 分钟）`);
  lines.push(`- 字幕总数：${all.length} 条 · 说话人 ${speakers.length} 人`);
  if (s.startedAt) lines.push(`- 值守健康：时长 ${Math.floor((Date.now() - s.startedAt) / 3600000)}h${Math.floor(((Date.now() - s.startedAt) / 60000) % 60)}m · 识别器重启 ${s.restarts} 次 · 已归档 ${s.archived} 条${s.drops ? ` · 丢弃 ${s.drops} 条` : ''}`);
  lines.push('');
  lines.push('## 说话人占比');
  for (const [name, n] of speakers.slice(0, 10)) {
    const pct = Math.round((n / all.length) * 100);
    const bar = '█'.repeat(Math.max(1, Math.round(pct / 4)));
    lines.push(`- ${name}：${n} 条（${pct}%）${bar}`);
  }
  lines.push('');
  lines.push('## 每小时活跃度');
  for (const [hour, n] of hours) {
    const bar = '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor((n / maxHour) * 7.99))];
    lines.push(`- ${hour}　${bar} ${n} 条`);
  }
  lines.push('');
  lines.push('> 由简易腾讯会议第 31 步本地生成（零 LLM）；要"读懂内容"的版本等 N2 接上 LLM。');
  lines.push('');
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `report-${myRoom || 'local'}-${Date.now()}.md`;
  if (typeof a.click === 'function') a.click();
  URL.revokeObjectURL(url);
  log(`📋 已生成值守日报（${all.length} 条 · ${speakers.length} 位说话人 · 跨度 ${durMin} 分钟）`);
});


/* ──────────────────────────────────────────────────────────────
 * 第 32 步 ★ 2026-09-23 G4 移动端 / PWA（路线图 G 档：手机也能体面开会）
 * ▎三件事，全是纯前端零依赖：
 *   ① 侧栏抽屉（≤980px）：侧栏在 CSS 里被移出画布，这里给它一个"拉出来"的
 *     开关（顶栏按钮）+ 遮罩点击关闭。桌面布局一行代码都不走。
 *   ② 低带宽模式："省流"开关把**所有远端画面**锁到 simulcast 最低清晰度层
 *     （复用 D1 的 set-preferred-layers 手动锁层信令，服务器零改动）——
 *     弱网/流量敏感场景一键降级；关掉时逐路发 spatialLayer:null 交回服务器自动选层。
 *     新来的成员/服务器 ABR 升层（layer-changed auto=true）会被上面的钩子重新锁回。
 *   ③ Service Worker 注册：manifest + sw.js 让会议页能"安装到主屏"、
 *     静态壳离线可用（音视频照旧要活的服务器——SW 只管静态资源）。
 * ────────────────────────────────────────────────────────────── */

/* ---- ① 侧栏抽屉（小屏）----
 * body.side-open 是唯一的状态位：CSS（style.css 第 25 节）只认它——
 * 抽屉滑入、遮罩亮起、背景冻结滚动，三条规则都挂在同一个类上，好排查。 */
sideBtn.addEventListener('click', () => {
  // ▎注意：不依赖 classList.toggle 的返回值（真 DOM 返回布尔，但老浏览器/测试桩可能返回
  //   undefined）——先 toggle 再用 contains 读回状态，两端语义一致。
  document.body.classList.toggle('side-open');
  const open = document.body.classList.contains('side-open');
  sideBtn.classList.toggle('active', open);
  if (open) sideScrim.classList.remove('hidden');
  else sideScrim.classList.add('hidden');
});
sideScrim.addEventListener('click', () => {
  document.body.classList.remove('side-open');
  sideBtn.classList.remove('active');
  sideScrim.classList.add('hidden');
});

/* ---- ② 低带宽模式（省流）---- */
let lowBwOn = false; // 省流状态位（layer-changed 钩子会读它，见 D1 段）

// 把一路 Consumer 锁到最低清晰度层（simulcast 第 1 层）
function lockLayerLow(consumerId) {
  socket.emit('set-preferred-layers', { consumerId, spatialLayer: 0 }, (resp) => {
    if (resp && resp.error) log(`⚠️ 省流锁层失败：${resp.error}`);
  });
}

lowBwBtn.addEventListener('click', () => {
  lowBwOn = !lowBwOn;
  lowBwBtn.classList.toggle('active', lowBwOn);
  if (lowBwOn) {
    // 开：把**当前所有**多层的远端画面全部锁最低层
    let n = 0;
    for (const [consumerId, st] of layerState) {
      if (st.layerCount > 1) { lockLayerLow(consumerId); n++; }
    }
    showToast(`🐢 省流已开启：${n} 路画面锁定最低清晰度`, 'ok');
    log(`🐢 低带宽模式开启（锁定 ${n} 路画面的最低层；新成员进来也会自动锁）`);
  } else {
    // 关：逐路交回服务器自动选层（null = 自动，D1 的约定）
    let n = 0;
    for (const [consumerId, st] of layerState) {
      if (st.layerCount > 1) {
        socket.emit('set-preferred-layers', { consumerId, spatialLayer: null }, () => {});
        n++;
      }
    }
    showToast('🚀 省流已关闭：画质交回服务器按网络自动调', 'ok');
    log(`🚀 低带宽模式关闭（${n} 路画面交回自动选层）`);
  }
});

/* ---- ③ Service Worker 注册（PWA 外壳）----
 * ▎两个前置：浏览器支持 SW + 安全上下文（https / localhost）——
 *   纯 IP 的 http 页面注册不了（和 getUserMedia 同一条安全规则）。
 * ▎教学提示：注册后 DevTools → Application → Service Workers 可见。
 *   策略细节见 sw.js：vendor 类库 cache-first，client.js/style.css 等走
 *   **network-first**（所以"改完刷新即见"不再受缓存影响）。 */
if ('serviceWorker' in navigator && (window.isSecureContext !== false)) {
  /* ★ 09-24 逃生舱：地址加 `?nosw=1` → 当场注销所有 SW 并清空 Cache Storage。
   *   排查"改了代码不生效"时，第一步就该先按这个开关确认"是不是 SW 缓存的锅"，
   *   比开 DevTools 一层层点 Application 快得多（运维思路：先缩小范围）。
   *   注意：注销后当前这次加载仍归旧 SW 管，要再刷一次才彻底干净——所以下面
   *   注销完直接 reload 一次，做到"一步到位"。 */
  if (/[?&]nosw=1/.test(location.search)) {
    (async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
        if (self.caches) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
        log(`🧹 已注销 ${regs.length} 个 Service Worker 并清空缓存，正在重载…`);
        setTimeout(() => location.reload(), 400);
      } catch (err) {
        log(`⚠️ 注销 Service Worker 失败：${err.message}`);
      }
    })();
  } else {
    navigator.serviceWorker.register('sw.js').then(() => {
      log('📦 PWA 外壳已就绪（可安装到桌面/主屏；静态壳离线可用）');
    }).catch((err) => {
      log(`⚠️ Service Worker 注册失败：${err.message}（不影响会议功能）`);
    });
  }
}

/* ══════════════════════════════════════════════════════════════════════════════════
 * ★ 09-24 真远程桌面（控制端控制台）—— 把"操作一台真电脑"做成一个正经工作台
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * ▎和"远程协助（工作台重放）"的区别，一句话说清：
 *   远程协助 = 控的是**对方页面里的一个 iframe 模拟桌面**（合成事件重放）；
 *   远程桌面 = 控的是**对方电脑上真实的 Chromium 窗口**（CDP 注入真鼠标真键盘）。
 *   前者是"教具"（讲清楚归一化坐标和事件重放），后者是"能真用"的东西
 *   —— 能开真网站、能登录、能看视频、能填表单，这才对得起"远程桌面"四个字。
 *
 * ▎画面链路：被控端 CDP screencast → JPEG → socket.io 二进制 → 这里画进 canvas
 * ▎输入链路：这里的 pointer/keyboard 事件 → 16 字节帧 → 服务器门禁转发 → CDP 注入
 *   两条链路都复用项目里已有的约定（同一套帧格式、同一套授权门禁），没有另起炉灶。
 *
 * ▎顺手补上的移动端能力（用户明确要的"手机控电脑"）：
 *   · pointer 事件本身就同时覆盖鼠标和触摸 → **单指即鼠标**，一行代码都不用多写；
 *   · 双指捏合映射成滚轮 → 手机上能自然地滚动对方页面。
 *   这也是"用 web 标准换来的便宜"：不选 pointer 而用 mousedown/touchstart 双份写，
 *   这里就得写两套逻辑、还容易在两端行为不一致。
 */

const rdConsoleEl = $('rdConsole');
const rdStageEl = $('rdStage');
const rdCanvasEl = $('rdCanvas');
const rdUrlEl = $('rdUrl');
const rdStateEl = $('rdState');
const rdMetaEl = $('rdMeta');
const rdHintEl = $('rdHint');
const rdKeysEl = $('rdKeys');
const agentHintEl = $('agentHint');
const agentCmdEl = $('agentCmd');

// canvas 2d 上下文：测试环境（假 DOM）里没有 getContext，所以防御式取一次
let rdCtx = null;
try { rdCtx = rdCanvasEl && rdCanvasEl.getContext ? rdCanvasEl.getContext('2d') : null; } catch (e) { rdCtx = null; }

const agentPeers = new Map();   // agentId → { name, info }（renderMembers 时重建）
let rdHostId = null;            // 我正在控制的桌面代理 id（null = 没在控制）
let rdFrames = 0;
let rdDrawing = false;
let rdPendingAb = null;         // 只留最新一帧：画面实时性 > 完整性（堆积只会看到"过去"）
let rdMoveRaf = 0;
let rdMovePending = null;
let rdWheelAccum = 0;
let rdWheelTimer = null;
let rdWheelPos = null;
// 注：双指滚动的状态（活跃指针账本 rdPointers / rdScrollMode）在下面的交互段里，
// 它们只被那一处用到，就放在离用最近的地方 —— 状态的作用域能收窄就收窄。

// rAF 帮手：假 DOM / 老环境没有 requestAnimationFrame 时退回 setTimeout
const rdRaf = (cb) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : setTimeout(cb, 16));

function setRdState(t) { if (rdStateEl) rdStateEl.textContent = t; }

/* 把 canvas 按画面比例塞进舞台（自己算尺寸而不是交给 CSS：canvas 不是替换元素，
 * object-fit 对它无效；自己算的好处是 canvas 的 rect 就等于画面区 ——
 * 后面算归一化坐标直接量 canvas 的 rect 就行，不会掉进"有黑边"的坑）。 */
function rdFit() {
  if (!rdCanvasEl || !rdStageEl || !rdCanvasEl.width) return;
  const stage = rdStageEl.getBoundingClientRect ? rdStageEl.getBoundingClientRect() : null;
  if (!stage || !stage.width || !stage.height) return;
  const ar = rdCanvasEl.width / rdCanvasEl.height;
  let w = stage.width - 16, h = w / ar;
  if (h > stage.height - 16) { h = stage.height - 16; w = h * ar; }
  rdCanvasEl.style.width = Math.max(64, Math.floor(w)) + 'px';
  rdCanvasEl.style.height = Math.max(64, Math.floor(h)) + 'px';
}

/* 画一帧。优先 createImageBitmap（无 URL 生命周期、最快）；
 * 环境不支持时降级为"只记状态不画"——保证逻辑（计数/状态/授权）在任何环境都可测。 */
async function rdDrawFrame(ab) {
  rdFrames++;
  if (rdHintEl && rdFrames === 1) rdHintEl.classList.add('hidden');
  try {
    if (typeof createImageBitmap === 'function' && typeof Blob === 'function') {
      const bmp = await createImageBitmap(new Blob([ab], { type: 'image/jpeg' }));
      if (rdCanvasEl.width !== bmp.width || rdCanvasEl.height !== bmp.height) {
        rdCanvasEl.width = bmp.width;
        rdCanvasEl.height = bmp.height;
        rdFit();
      }
      if (rdCtx) rdCtx.drawImage(bmp, 0, 0);
      if (typeof bmp.close === 'function') bmp.close();
    }
  } catch (e) { /* 单帧解码失败忽略：下一帧就补上了 */ }
}

async function rdPumpFrames() {
  if (rdDrawing) return;
  rdDrawing = true;
  try {
    while (rdPendingAb) {
      const ab = rdPendingAb;
      rdPendingAb = null;
      await rdDrawFrame(ab);
    }
  } finally {
    rdDrawing = false;
  }
  /* 状态文案要回答"画面在不在动"，而不是报一个帧数 ——
   * 用户看到"已收 2 帧"只会疑惑（2 帧算好还是不好？）。帧数放进 title 给想深究的人。*/
  setRdState('✅ 实时画面');
  if (rdStateEl) rdStateEl.title = `已接收 ${rdFrames} 帧 JPEG 画面（来自对方电脑的真实屏幕）`;
}

function rdSend(event) {
  if (!rdHostId) return false;
  socket.emit('remote-input', { to: rdHostId, event });
  return true;
}

// 事件坐标 → 归一化 0~1（canvas 的 rect 就是画面区，见 rdFit 的说明）
function rdNorm(e) {
  if (!rdCanvasEl || !rdCanvasEl.getBoundingClientRect) return null;
  const r = rdCanvasEl.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return {
    nx: clamp01((e.clientX - r.left) / r.width),
    ny: clamp01((e.clientY - r.top) / r.height),
  };
}

function openRemoteDesk(hostId, info) {
  rdHostId = hostId;
  rdFrames = 0;
  rdPendingAb = null;
  if (rdConsoleEl) rdConsoleEl.classList.remove('hidden');
  if (document.body && document.body.classList) document.body.classList.add('rd-mode');
  if (rdHintEl && rdHintEl.classList) { rdHintEl.classList.remove('hidden'); rdHintEl.textContent = '正在等对方电脑的第一帧画面…'; }
  if (rdMetaEl) rdMetaEl.textContent = (info && info.name) ? info.name : ('成员 ' + shortId(hostId));
  if (rdUrlEl) rdUrlEl.value = '';
  setRdState('🔄 正在接收画面…');
  rdFit();
  log(`🖥️ 远程桌面已打开：正在操作 ${shortId(hostId)} 的真实浏览器（画面 = 对方真屏幕）`);
  showToast('🖥️ 已连上对方电脑，可以直接用鼠标键盘操作了');
  // 键盘焦点立刻交给捕获框，让用户不用先点一下才能打字
  setTimeout(() => { try { if (rdKeysEl && rdKeysEl.focus) rdKeysEl.focus(); } catch (e) { /* ignore */ } }, 150);
}

function closeRemoteDesk(sendRelease) {
  const host = rdHostId;
  if (sendRelease && host) socket.emit('remote-release');
  rdHostId = null;
  rdPendingAb = null;
  rdWheelAccum = 0;
  if (rdKeysEl) rdKeysEl.value = '';
  if (rdConsoleEl) rdConsoleEl.classList.add('hidden');
  if (document.body && document.body.classList) document.body.classList.remove('rd-mode');
  if (host) log('🖥️ 已退出远程桌面');
}

/* ---- 画面：被控端推来的帧直接画出来 ---- */
socket.on('remote-frame', ({ frame } = {}) => {
  if (!rdHostId || !frame) return;
  rdPendingAb = frame;      // 覆盖式缓冲：网络慢时只画最新，不排队播旧画面
  rdPumpFrames();
});

/* ---- 元信息：对方浏览器的真实 URL / 标题（地址栏据此显示，不做假） ---- */
socket.on('remote-meta', ({ url, title } = {}) => {
  if (!rdHostId) return;
  if (rdUrlEl && url) rdUrlEl.value = url;
  if (rdMetaEl) rdMetaEl.textContent = (title ? title + ' · ' : '') + (url || '');
});

/* ---- 以下是控制台自身的交互（鼠标 / 触屏 / 键盘 / 地址栏）---- */
if (rdCanvasEl && rdCanvasEl.addEventListener) {
  /* ★ 09-24 补（真机抓到的 bug）：手机上一用双指，鼠标就乱点。
   *   根因：pointerdown/move/up 是**按手指**派发的，双指就是两套 pointer 事件，
   *   于是远端收到一串 mousedown/mouseup —— 表现为"想滚动，结果把页面上的东西拖走了"。
   *   修法：自己维护一份"当前有几根手指"的账本（rdPointers），
   *     · 第 1 根手指 → 鼠标（照旧）
   *     · 第 2 根手指落下 → 进入滚动模式，并**撤销**第一根手指已发出的 mousedown
   *       （补一个 mouseup，否则远端一直处于"按住"状态）
   *     · 双指移动 → 用两指中点的位移换算滚轮
   *   全部用 pointer 事件做，不再需要 touch 事件：一套逻辑覆盖鼠标 + 触摸 + 触控笔。
   *   —— 这也是"选 web 标准"的回报：不用 mouse/touch 两套代码，就不会有两套行为不一致。 */
  const rdPointers = new Map();   // pointerId → { x, y }（当前压在画面上的手指/鼠标）
  let rdScrollMode = false;       // 双指滚动模式（此模式下不发鼠标事件）
  let rdScrollMid = null;         // 上一帧两指中点
  let rdMouseDownSent = false;    // 我是否已经发出过 mousedown（用于撤销）

  const pointerMid = () => {
    let sx = 0, sy = 0, n = 0;
    for (const p of rdPointers.values()) { sx += p.x; sy += p.y; n++; }
    return n ? { x: sx / n, y: sy / n } : null;
  };
  const scheduleWheel = () => { if (!rdWheelTimer) rdWheelTimer = setTimeout(flushWheel, 60); };
  const normOf = (x, y) => {
    const r = rdCanvasEl.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { nx: clamp01((x - r.left) / r.width), ny: clamp01((y - r.top) / r.height) };
  };

  // 移动：时间节流（33ms ≈ 30fps 上限）。不节流的话一秒钟能发几百条，
  // 把信令通道塞满，反而让点击变卡——"少发但发得准"比"多发"体验好。
  let lastMoveAt = 0;
  rdCanvasEl.addEventListener('pointermove', (e) => {
    if (!rdHostId) return;
    if (rdPointers.has(e.pointerId)) rdPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // 双指滚动优先（此时一个鼠标事件都不能发，否则就是上面那个 bug）
    if (rdScrollMode && rdPointers.size >= 2) {
      const mid = pointerMid();
      if (mid && rdScrollMid) {
        const dy = rdScrollMid.y - mid.y;      // 双指上滑 = 内容上滚（跟手机习惯一致）
        if (Math.abs(dy) >= 2) {
          const p = normOf(mid.x, mid.y);
          if (p) { rdWheelPos = p; rdWheelAccum += dy / 20; scheduleWheel(); } // 20px 手指 ≈ 滚轮一格
        }
      }
      rdScrollMid = mid;
      return;
    }
    if (rdScrollMode) return;    // 滚动收尾瞬间，别顺手又补一发移动

    const now = Date.now();
    if (now - lastMoveAt < 33) { rdMovePending = rdNorm(e); return; }  // 落下的这笔留到最后补发
    lastMoveAt = now;
    const p = rdNorm(e);
    if (p) rdSend(encodeCtlFrame('mousemove', p.nx, p.ny));
  });
  // 手指/鼠标离开画面时，把最后那笔攒下的移动补发出去，避免"停在半路"
  rdCanvasEl.addEventListener('pointerleave', (e) => {
    rdPointers.delete(e.pointerId);
    if (rdMovePending) { const p = rdMovePending; rdMovePending = null; rdSend(encodeCtlFrame('mousemove', p.nx, p.ny)); }
  });

  rdCanvasEl.addEventListener('pointerdown', (e) => {
    if (!rdHostId) return;
    e.preventDefault();                       // 阻止拖拽选中/长按菜单，全部行为都交给远端
    rdPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (rdPointers.size >= 2) {
      // 第二根手指落下 = 用户想滚动，不是想点击 → 撤销第一根手指造成的"按住"状态
      if (rdMouseDownSent) {
        const q = rdNorm(e);
        if (q) rdSend(encodeCtlFrame('mouseup', q.nx, q.ny, 0, 0));
        rdMouseDownSent = false;
      }
      rdScrollMode = true;
      rdScrollMid = pointerMid();
      return;
    }

    try { if (rdKeysEl && rdKeysEl.focus) rdKeysEl.focus(); } catch (err) { /* ignore */ }
    const p = rdNorm(e);
    if (!p) return;
    rdMouseDownSent = true;
    rdSend(encodeCtlFrame('mousedown', p.nx, p.ny, 0, e.button));   // 0左/1中/2右，和帧协议一致
  });

  const rdEndPointer = (e) => {
    const wasScroll = rdScrollMode;
    rdPointers.delete(e.pointerId);
    if (rdPointers.size < 2) { rdScrollMode = false; rdScrollMid = null; }
    // 滚动模式下的抬手不发 mouseup（那根手指的按下早已被撤销）；没发过按下也不发抬起
    if (wasScroll || !rdMouseDownSent) return;
    if (!rdHostId) return;
    const p = rdNorm(e);
    if (p) rdSend(encodeCtlFrame('mouseup', p.nx, p.ny, 0, e.button));
    rdMouseDownSent = false;
  };
  rdCanvasEl.addEventListener('pointerup', rdEndPointer);
  rdCanvasEl.addEventListener('pointercancel', rdEndPointer);   // 被系统打断（来电/手势）也要收尾

  rdCanvasEl.addEventListener('dblclick', (e) => {
    if (!rdHostId || rdScrollMode) return;
    const p = rdNorm(e);
    if (p) rdSend(encodeCtlFrame('dblclick', p.nx, p.ny));
  });
  rdCanvasEl.addEventListener('contextmenu', (e) => e.preventDefault());  // 右键要转发到远端，不弹本地菜单

  // 滚轮：累加后按 60ms 合并发送（鼠标滚一次会触发十几条 wheel 事件，
  // 合并成一条"滚了 N 格"既省信令，也让远端的滚动幅度符合直觉）
  const flushWheel = () => {
    rdWheelTimer = null;
    const n = Math.round(rdWheelAccum);
    rdWheelAccum = 0;
    if (n && rdWheelPos) rdSend(encodeCtlFrame('wheel', rdWheelPos.nx, rdWheelPos.ny, n));
  };
  rdCanvasEl.addEventListener('wheel', (e) => {
    if (!rdHostId) return;
    e.preventDefault();
    rdWheelPos = rdNorm(e) || rdWheelPos;
    rdWheelAccum += -e.deltaY / 100;         // 帧里 wheel 的单位是"格"，一格 ≈ 100 CSS 像素
    scheduleWheel();
  }, { passive: false });
}

/* 键盘捕获：一个视觉上不可见的输入框 + "整段文本"转发。
 * ▎为什么不像英文那样逐键发？中文输入法的组合态在远端重放会乱套
 *   （拼音串、候选词都会被当成真按键）。攒成整段一次发，远端用 CDP insertText 落字，
 *   中文、emoji、长文本全都稳。功能键（Enter/方向键）单独按 keydown 发。
 *   —— 这套思路和远程协助（A2）里的 IME 捕获框完全一致，是同一份经验的第二次应用。 */
if (rdKeysEl && rdKeysEl.addEventListener) {
  rdKeysEl.addEventListener('input', () => {
    const t = rdKeysEl.value;
    rdKeysEl.value = '';                       // 立刻清空：它只是个"攒字"的桶
    if (t && rdHostId) rdSend({ kind: 'input-text', text: t });
  });
  rdKeysEl.addEventListener('keydown', (e) => {
    if (!rdHostId) return;
    if (e.key === 'Escape') { closeRemoteDesk(true); return; }
    if (e.key.length > 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();                      // Enter/Backspace/方向键：走真按键
      if (rdHostId) rdSend({ kind: 'keydown', key: e.key, code: e.code });
      return;
    }
    if (e.ctrlKey || e.metaKey) {              // Ctrl+A/C/V/Z 这类组合键：交给远端执行
      e.preventDefault();
      if (rdHostId) rdSend({ kind: 'keydown', key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey });
    }
  });
  rdKeysEl.addEventListener('keyup', (e) => {
    if (rdHostId && e.key.length > 1) rdSend({ kind: 'keyup', key: e.key, code: e.code });
  });
}

/* 地址栏 / 工具条 */
if (rdUrlEl && rdUrlEl.addEventListener) {
  const go = () => {
    const u = String(rdUrlEl.value || '').trim();
    if (!u || !rdHostId) return;
    rdSend({ kind: 'navigate', url: u });
    setRdState('🌐 正在打开 ' + u + ' …');
  };
  rdUrlEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  const goBtn = $('rdGo');
  if (goBtn && goBtn.addEventListener) goBtn.addEventListener('click', go);
}
const rdBtn = (id, fn) => { const el = $(id); if (el && el.addEventListener) el.addEventListener('click', fn); };
rdBtn('rdBack', () => rdSend({ kind: 'back' }));
rdBtn('rdReload', () => rdSend({ kind: 'refresh' }));
rdBtn('rdMax', () => { rdSend({ kind: 'window', state: 'maximized' }); showToast('⛶ 已请求最大化对方窗口', 'info'); });
rdBtn('rdRelease', () => closeRemoteDesk(true));

// 窗口尺寸变了要重新排版画面（否则转屏后画面会溢出或缩成一条）
if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', rdFit);

/* ---- 桌面代理指引卡片（成员面板底部）---- */
function updateAgentHint() {
  if (!agentHintEl) return;
  // 房间里已经有代理 → 收起（已经在用了，不需要再教怎么起）
  const shouldHide = agentPeers.size > 0 || !myRoom;
  if (agentHintEl.classList) agentHintEl.classList.toggle('hidden', shouldHide);
  if (agentCmdEl && myRoom) agentCmdEl.textContent = `node agent/index.js --room ${myRoom}`;
}

/* ★ 09-24：一键复制（agentCopy 与安全提示横幅共用一套实现）
 * ▎为什么要把原先内联在 agentCopy 里的逻辑抽出来？因为第 33 步的安全提示横幅又有两处要
 *   复制（start:lan / cloudflared）——同一套"现代 API 优先、选中兜底"的分支抄三遍，
 *   改一处就得改三处，是典型会漂移的副本。抽成一个函数，三处按钮都调它。
 * ▎降级链（真实浏览器里踩过的坑）：
 *   ① 优先用 navigator.clipboard.writeText（异步、要求页面聚焦）；
 *   ② 它可能**根本不存在**——尤其在 http + IP 页面里（又是安全上下文规则！），
 *      所以必须有兜底，否则"复制"按钮点了没反应，用户只会觉得坏了；
 *   ③ 兜底 = 用 Range 选中文本 + 提示 Ctrl+C（命令块本身 user-select: all，手动也好选）。 */
function copyTextToClipboard(text, fallbackEl, okMsg) {
  const t = String(text || '').trim();
  if (!t) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(
      () => showToast(okMsg || '✅ 已复制到剪贴板'),
      () => selectTextWithHint(fallbackEl),
    );
  } else {
    selectTextWithHint(fallbackEl);
  }
}

/* 复制降级：选中目标文本并提示 Ctrl+C（无剪贴板 API / 复制被拒时走这里） */
function selectTextWithHint(el) {
  try {
    if (el) {
      const r = document.createRange();
      r.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }
    showToast('已选中命令，按 Ctrl+C 复制', 'info');
  } catch (e) { showToast('复制失败，请手动选中这行命令复制', 'error'); }
}

rdBtn('agentCopy', () => {
  copyTextToClipboard((agentCmdEl && agentCmdEl.textContent) || '', agentCmdEl, '✅ 命令已复制，粘到终端回车即可');
});

rdBtn('agentHow', () => {
  log('🖥️ 为什么必须在本地跑一个代理？');
  log('   浏览器的安全底线：网页不能移动真实光标、不能敲真实键盘、不能截别的程序窗口。');
  log('   这不是技术不足，是设计如此 —— 否则任何网页都能偷看你屏幕、替你点确认。');
  log('   所以真远程桌面都得装"被控端"（AnyDesk / 向日葵 / TeamViewer 无一例外）。');
  log('   本项目的被控端就是 agent/index.js：零新依赖，一条命令起来，');
  log('   它用 CDP 驱动一个真实 Chromium 窗口 —— 抓真画面、注真鼠标键盘、开任意真实网站。');
  log('   权限方面没有任何特殊待遇：走的是和人类完全相同的授权链路，服务器不认识"代理特权"。');
  showToast('📋 说明已打到下方「流程日志」里', 'info');
});

/* ══════════════════════════════════════════════════════════════════════════════════
 * 第 33 步 ★ 2026-09-24 安全上下文提示横幅（回答"为什么手机 / 别人的电脑用不了"）
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * ▎先把"真凶"说透（这是本步存在的全部理由）：
 *   用户把 http://192.168.x.x:3001 发给别人、或用手机打开，会稳定看到两个现象：
 *     ① 浏览器地址栏显示「不安全」；② 摄像头 / 麦克风拿不到（看起来像"手机功能没做"）。
 *   根因**不是代码 bug**，是浏览器的安全规则：只有在**安全上下文**（https:// 或 localhost）
 *   下，浏览器才允许 getUserMedia（摄像头/麦克风）与 Service Worker。纯 IP 的 http 页面
 *   永远拿不到 —— 这条规则的意义是"否则任意网页都能偷开你的摄像头"。
 *   所以"修"它的方向只有一个：把访问方式变成安全上下文。具体两条路：
 *     ① 局域网自签 https（npm run start:lan）——最快，但证书是自签的，浏览器**一定会**
 *        提示一次「不是私密连接」，要点"高级 → 继续前往"；手机上 iOS Safari 还要去
 *        「设置 → 通用 → VPN与设备管理 / 关于本机 → 证书信任设置」里手动信任，比较麻烦。
 *     ② 公网受信任 https（Cloudflare Tunnel）——拿到 https://xxx.trycloudflare.com，
 *        这是**受信任证书、零警告**，手机和别人的电脑都能直接打开。
 *   一句话结论：自签只适合自己在局域网演示；要给别人 / 手机无障碍访问，用隧道拿受信任证书。
 *   ⚠️ 边界（必须诚实地讲）：隧道只承载 HTTP / WebSocket，也就是"网页 + 信令"。
 *      Mesh 版媒体是 P2P 直达，过隧道能通；**SFU 版媒体是 UDP，过不去隧道** ——
 *      所以"发布公网给外人开完整会议"要发 Mesh 版（node scripts/publish.js --tunnel）。
 *
 * ▎为什么判断写成 `window.isSecureContext !== false` 而不是 `=== false`？
 *   因为无头测试桩（scripts/test-sfu-client-smoke.js）没有这个字段。沿用本项目既有写法
 *   （Service Worker 注册处、第 29 步字幕自检 capPreflight）——"字段缺失时按安全处理"，
 *   这样桩环境不会误报。真实浏览器里该字段**一定存在**，所以也不会漏报。
 *
 * ▎为什么关闭状态要记本地存储？
 *   横幅是"解释 + 指路"，不是每次都要念一遍。用户读过、点了关闭之后，同一浏览器就别再自动弹，
 *   否则就从"教学提示"变成了"扰民的弹窗"。教学提示的第一原则：该出现时出现，用户说不要就闭嘴。
 * ══════════════════════════════════════════════════════════════════════════════════ */

const INSECURE_DISMISS_KEY = 'sfu_insecure_notice_dismissed';   // 本地存储键：关过就不再自动弹

/* 是否处于"非安全上下文"——沿用既有写法：字段缺失（测试桩）按安全处理 */
function isInsecureContext() {
  return window.isSecureContext === false;
}

function insecureNoticeDismissed() {
  try { return localStorage.getItem(INSECURE_DISMISS_KEY) === '1'; }
  catch (e) { return false; }                 // 隐私模式下读不了 localStorage，按"没关过"处理
}
function dismissInsecureNotice() {
  try { localStorage.setItem(INSECURE_DISMISS_KEY, '1'); }
  catch (e) { /* 隐私模式写不了，忽略：本次会话仍然记在内存里靠"已隐藏"生效 */ }
}

/* 显示横幅：尊重"用户已关闭"；返回 true 表示这次真的显示了。
 * 被 startLocalMedia 的 catch 复用（摄像头失败时再露一次解法入口）。 */
function openInsecureNotice() {
  if (!isInsecureContext() || !insecureBanner) return false;
  if (insecureNoticeDismissed()) return false;
  if (insecureBanner.classList) insecureBanner.classList.remove('hidden');
  return true;
}

/* 页面加载时调用一次：只有"非安全上下文 + 没关过"才弹 */
function initInsecureNotice() {
  if (!isInsecureContext()) return;            // https / localhost：什么都不做（不打扰）
  if (insecureNoticeDismissed()) {
    log('ℹ️ 当前是 http + IP 访问（浏览器会禁用摄像头/麦克风）；安全提示横幅此前已被关闭，不再自动弹出');
    return;
  }
  if (insecureBanner && insecureBanner.classList) insecureBanner.classList.remove('hidden');
  log('⚠️ 检测到非安全上下文（http + IP）：浏览器会禁用摄像头 / 麦克风 —— 页面顶部横幅给出了两种解法');

  // 两个命令的"复制命令"按钮：复用 copyTextToClipboard（与 agentCopy 同一套实现，不重复造轮子）
  const copyPairs = [
    [ibCopy1, ibCmd1, '✅ 已复制，粘到终端回车即可（也可以直接双击 start-lan.bat）'],
    [ibCopy2, ibCmd2, '✅ 已复制，粘到终端回车即可（需先装 cloudflared）'],
  ];
  for (const [btn, cmd, msg] of copyPairs) {
    if (btn && btn.addEventListener) {
      btn.addEventListener('click', () => copyTextToClipboard((cmd && cmd.textContent) || '', cmd, msg));
    }
  }

  if (insecureCloseBtn && insecureCloseBtn.addEventListener) {
    insecureCloseBtn.addEventListener('click', () => {
      if (insecureBanner && insecureBanner.classList) insecureBanner.classList.add('hidden');
      dismissInsecureNotice();
      log('已关闭安全提示横幅（本浏览器不再自动弹出；清站点数据或换浏览器会再出现）');
    });
  }
}

/* ------------------------------------------------------------------------------
 * 启动：页面一加载就打开摄像头
 * ------------------------------------------------------------------------------ */
if (!window.mediasoupClient) {
  log('❌ 找不到 mediasoup-client：请先执行 npm run build:sfu-vendor 生成 vendor/mediasoup-client.js');
}
// ★ 09-26 头像选择器：注册卡里的 9 个预设头像（点选高亮；注册时随 auth-register 提交）
let pickedAvatar = null;
(function buildAvatarPicker() {
  const box = document.getElementById('authAvatars');
  if (!box) return;
  for (const av of PRESET_AVATARS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'av-pick';
    b.dataset.key = av.key;
    b.title = av.name;
    const img = document.createElement('img');
    img.src = `/avatars/presets/${av.key}.png`;
    img.alt = av.name;
    b.appendChild(img);
    const nm = document.createElement('span');
    nm.textContent = av.name;
    b.appendChild(nm);
    b.addEventListener('click', () => {
      box.querySelectorAll('.av-pick').forEach((x) => x.classList.remove('picked'));
      b.classList.add('picked');
      pickedAvatar = av.key;
    });
    box.appendChild(b);
  }
})();

// ★ 09-19d 舒适性：日志面板可折叠——教学时展开，演示/开会时收起给画面让位
logTitle.addEventListener('click', () => {
  const collapsed = logPanel.classList.toggle('collapsed');
  document.querySelector('.app').classList.toggle('log-collapsed', collapsed);
});

startLocalMedia();
// ★ 第 33 步：非安全上下文时弹出安全提示横幅。放在 startLocalMedia 之后调用，
//   这样"正在连接信令服务器/本地媒体就绪"这类首行日志仍在最上面，横幅日志不会抢戏。
initInsecureNotice();
// ★ 09-25：侧栏分段（成员/看板/聊天）——脚本在 body 末尾，DOM 已就绪，可直接挂事件
initSideTabs();
initAiChips();          // 快捷问法按钮（点一下 = 手打 "@ai …"）
initBoardActions();     // 看板头的「📝 出纪要」
initAiVoice();          // ★ 09-25 AI 语音播报开关（默认关，用户可开）
renderBoard();          // 先渲染一次空看板（把"投喂提示"空状态显示出来）
renderChatUnread();
renderAiChips();        // 初始隐藏（AI 还没入会）
