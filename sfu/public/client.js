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
const aiAvatar = { state: 'idle', prevState: '', el: null, rowEl: null, tile: null, gestureTimer: 0, gesture: '', gestureDone: null };

/* ══ AI 头像 = 内联 SVG 矢量小人（2026-10-07，四代）════════════════════════════
 * ▎为什么弃用 AI 生成的位图头像（三代已做到"底脸常驻 + 嘴部贴片"，用户仍评
 *   "能不能做得像个人做的"）：Q 版 3D 小人是生成图——比例怪异、微表情诡异、
 *   帧间有烘焙残影，位图路线再怎么修帧都洗不掉这股"AI 味"。换成**手绘矢量机器人脸**：
 *   眼/眉/嘴/腮红都是独立 SVG 元素，状态切换 = CSS 类驱动元素变形（transition 直出），
 *   嘴部说话是 scaleY 呼吸式开合（还能吃 --ai-amp 音频律动）——
 *   没有位图、没有图层叠印，**结构上不存在重影**；一个人的审美可以全控。
 * ▎类契约（与位图时代完全兼容，JS 其余部分零改动）：
 *   · 根 <svg> 挂 .ai-face（呼吸 aiBreath、g-* 小动作、--ai-amp 发光都吃它）；
 *   · 说话/思考/开心的显隐全走 tile 已有的 .speaking/.thinking/.happy 类（CSS 内部消化，
 *     不需要 JS 换 src / 移交图层）；
 *   · 眨眼是纯 CSS 常驻动画（人说话时也眨眼，不用停）。
 * ▎格子与成员行共用本函数一个来源（坑 47：一个概念只能有一个来源）。 */
function aiAvatarSvg() {
  return '<svg class="ai-face" viewBox="0 0 200 200" aria-hidden="true">'
    + '<g class="av">'
    + '<line class="av-ant" x1="100" y1="31" x2="100" y2="47"/>'
    + '<circle class="av-ant-dot" cx="100" cy="25" r="6"/>'
    + '<rect class="av-head" x="34" y="44" width="132" height="120" rx="44"/>'
    + '<rect class="av-plate" x="47" y="57" width="106" height="94" rx="33"/>'
    + '<rect class="av-brow av-brow-l" x="63" y="79" width="29" height="7" rx="3.5"/>'
    + '<rect class="av-brow av-brow-r" x="108" y="79" width="29" height="7" rx="3.5"/>'
    + '<g class="av-eye av-eye-l"><ellipse class="av-eye-bg" cx="77" cy="102" rx="12.5" ry="14.5"/><circle class="av-pupil" cx="77" cy="104" r="6"/></g>'
    + '<g class="av-eye av-eye-r"><ellipse class="av-eye-bg" cx="123" cy="102" rx="12.5" ry="14.5"/><circle class="av-pupil" cx="123" cy="104" r="6"/></g>'
    + '<ellipse class="av-cheek av-cheek-l" cx="59" cy="121" rx="9.5" ry="5.5"/>'
    + '<ellipse class="av-cheek av-cheek-r" cx="141" cy="121" rx="9.5" ry="5.5"/>'
    + '<rect class="av-mouth" x="83" y="125" width="34" height="13" rx="6.5"/>'
    + '</g></svg>';
}
let myAvatar = null; // 我的预设头像 key（登录/恢复后带回）
let serverAsrEnabled = false; // ★ 09-27d：服务端 ASR 是否开启（/config.json 下发）
/* ★ 2026-10-02 界面必须说实话：这里原先在日志和 toast 里**硬编码"whisper"**，
 *   而引擎早就可插拔（whisper / qwen-local / qwen 云）。用户照着界面上那行字
 *   得出的结论就是"根本没切过去，还在用 whisper"（本轮用户原话）。
 *   一个写在 UI 里的过期字符串，比没有字符串更糟——它会让人去装已经装好的东西。 */
let serverAsrEngine = 'none';  // whisper | qwen-local | qwen | none（/config.json 下发）
const ASR_ENGINE_CN = { whisper: '本机 whisper', 'qwen-local': '本机 Qwen3-ASR', qwen: 'Qwen3-ASR（云端）' };
/* 兜底文案刻意**不叫"服务器转写"**：外层模板本来就是 `服务器转写（…）`，
   用它兜底会拼出"服务器转写（服务器转写）"这种胡话（2026-10-04 真在 e2e 里出现过）。
   引擎未知就如实说未知——含糊比看起来自洽更诚实（坑 67 家族）。 */
function asrEngineCn() { return ASR_ENGINE_CN[serverAsrEngine] || '引擎待确认'; }

/* ★ 09-26b 唤醒词：开会时商量提到「小明」，它就接话——
 *   字幕成稿（emitCaption）里检测到名字 + AI 在场 → 自动把整句话作为提问发给 ai-ask。
 *   改名字只需改这里（+server 的 bot 显示名）。 */
const AI_NICKNAME = '小明';
/* ★ 2026-10-05 夜 唤醒词的"听得像"容错（与 sfu/ai/asr.js 的 WAKE_RE 同一张表）。
 * ▎为什么浏览器这一轨也要：这一轨只在"服务器转写不可用、退回 Web Speech"时跑，
 *   而识别把「小明」写成「小米/晓鸣」的概率跟引擎无关——真机实锤就是模型给了
 *   「你好 小米 下面」，旧写法 `text.includes('小明')` 直接判"没叫它"。
 * ▸ 两张表**必须一致**：`test:smoke` 有一条断言逐字符比对这两个字符类，
 *   改一处忘改另一处会当场红（一个概念只能有一个来源；这里跨了运行时，
 *   退而求其次用断言把"两份必须相同"钉住）。 */
const AI_WAKE_RE = /[小晓笑孝筱][明鸣名铭茗米民密蜜命]/;
/* ★ 2026-10-06 夜二 唤醒**分层**（与 sfu/ai/asr.js 的 wakeReason 同一套判据）：
 * ▎用户那句"这是一个正常的会议，不提到小明的名字它就不该说话"在两条链路上都成立才算数，
 *   所以浏览器这一轨也不能再"整张表一视同仁"——「小命」「小米」在日常中文里是**词**。
 * ▸ 强后缀（明/鸣/名/铭/茗）在句中基本只可能是叫它；歧义后缀（米/民/密/蜜/命）
 *   要有称呼语境（你好/帮我/打开…）才算。三张表都有断言与服务端逐字比对（坑 47 跨运行时版）。 */
const AI_WAKE_STRONG_RE = /[小晓笑孝筱][明鸣名铭茗]/;
const AI_WAKE_AMBIG_RE = /[小晓笑孝筱][米民密蜜命]/;
const AI_WAKE_ADDRESS_RE = /(你好|您好|嗨|喂|在吗|在不在|听着|听得到|听得见|帮我|帮忙|请帮|请问|叫一下|喊一下|替我|能不能|打开|关闭|关掉|收起|记下|查一下|查一查|说一下|回答)/;
function aiWakeHere(text) {
  const s = String(text || '');
  if (AI_WAKE_STRONG_RE.test(s)) return true;
  /* 歧义写法（小米/小命/小民…）要有称呼语境才算叫它——与 sfu/ai/asr.js 的 wakeReason 同一套判据。
   * ▸ 这条判据在真浏览器里由 `npm run check:wake` 把 21 句真实账本喂给页面自己判，
   *   并与服务端逐句比对；把这里改回"整张表一视同仁"，那两条断言当场红（已实测）。 */
  return AI_WAKE_AMBIG_RE.test(s) && AI_WAKE_ADDRESS_RE.test(s);
}
let lastWakeAskText = ''; // ★ 2026-10-02 唤醒自动提问的去重状态（见 emitCaption）
let lastWakeAskTs = 0;

/* [2026-10-02 退役、2026-10-07 复活] 09-26b/c 的 aiAvatarSvg() 当年从未被调用过、
 *   随其 CSS 一并删除；四代在"AI 生成的位图怎么修都有生成图味"的教训后重新启用
 *   并改写（见文件头 aiAvatarSvg 注释——眼/眉/嘴/腮红独立元素，状态全走 CSS 类）。 */

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
  speaker: svgIcon('<path d="M4.5 9.5h3L11.5 6v12l-4-3.5h-3z"/><path d="M15 9.6a3.5 3.5 0 0 1 0 4.8M17.7 7a7.2 7.2 0 0 1 0 10"/>'),
  /* ★ 2026-10-03 聊天区去 emoji 化（09-19e 那条纪律的收尾）：证据链、路径徽标、纪要链接
   *   原先全是彩色 emoji，在一整片暖墨界面里像贴纸。统一成 24 viewBox 的线性图标，
   *   stroke=currentColor 所以它们会跟着文字颜色走（AI 气泡里就是鎏金）。 */
  book: svgIcon('<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5A1.5 1.5 0 0 0 20 18.5z"/>'),
  bubble: svgIcon('<path d="M20 12.5a7 7 0 0 1-7 6.8c-1 0-2-.2-2.8-.6L5.5 20l1.4-3.4A6.7 6.7 0 0 1 5 12.5a7 7 0 0 1 7-6.8 7 7 0 0 1 8 6.8z"/>'),
  target: svgIcon('<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2"/>'),
  loop: svgIcon('<path d="M4 11a8 8 0 0 1 13.5-5.5L20 8"/><path d="M20 13a8 8 0 0 1-13.5 5.5L4 16"/><path d="M20 4v4h-4M4 20v-4h4"/>'),
  doc: svgIcon('<path d="M6 3.5h7l5 5v12H6z"/><path d="M13 3.5V9h5M9 13h6M9 16.5h6"/>'),
  link: svgIcon('<path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1"/>'),
  sctp: svgIcon('<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="3.5"/>'),
  bot: svgIcon('<rect x="5" y="8.5" width="14" height="9.5" rx="3"/><circle cx="9.5" cy="13.2" r="1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="13.2" r="1" fill="currentColor" stroke="none"/><path d="M12 8.5V5.5M9 5.5h6"/>'),
  leave: svgIcon('<path d="M14 12H5M8.5 8.5L5 12l3.5 3.5"/><path d="M13 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/>'),
  crown: svgIcon('<path d="M4.5 17.5h15L18 9l-3.8 3.2L12 6l-2.2 6.2L6 9l-1.5 8.5z"/>'),
  shield: svgIcon('<path d="M12 3.5l7 2.5v5.2c0 4.6-3 7.9-7 9.3-4-1.4-7-4.7-7-9.3V6l7-2.5z"/>'), // ★ G6-②：平台管理员
  clip: svgIcon('<path d="M8.5 12.5l5.5-5.5a3 3 0 0 1 4.2 4.2l-7.5 7.5a5 5 0 0 1-7.1-7.1L11 4.2"/>'),
  door: svgIcon('<rect x="13" y="4" width="6" height="16" rx="1"/><path d="M3 12h7M7.5 8.5L11 12l-3.5 3.5"/>'),
  smile: svgIcon('<circle cx="12" cy="12" r="8.5"/><path d="M9 10h.01M15 10h.01M8.5 14.5a4.5 4.5 0 0 0 7 0"/>'), // ★ 定向回应（Piik 式"只对某个人"）
  cursor: svgIcon('<path d="M5 3.5l7 16.5 2.1-6.9L21 11 5 3.5z"/>'),
  /* ★ 2026-10-03 收尾清扫：控件上最后一批彩色 emoji（钉选/看板四类/AI 操作/警告/时钟）。
   *   日志行里的 ⚠️ 前缀**有意保留**——那是终端式的文本记号，不是控件图标。 */
  pin: svgIcon('<path d="M15.2 3.4l5.4 5.4-2 2-.7 4.3-5-5-5.6 5.6-.9.9-1.9-1.9.9-.9L10.1 9.2l-5-5 4.3-.7z"/><path d="M6.5 17.5l-3 3"/>'),
  alert: svgIcon('<path d="M12 4.2L2.8 20h18.4z"/><path d="M12 10v4.2M12 17.2h.01"/>'),
  check: svgIcon('<circle cx="12" cy="12" r="8.5"/><path d="M8.2 12.4l2.6 2.6 5-5.4"/>'),
  bolt: svgIcon('<path d="M13.2 2.8L6 13.4h4.6L9.8 21.2 17.4 10h-4.8z"/>'),
  clock: svgIcon('<circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3.2 2"/>'),
  volMute: svgIcon('<path d="M4.5 9.5h3L11.5 6v12l-4-3.5h-3z"/><path d="M15.5 10l4 4M19.5 10l-4 4"/>'),
  volHigh: svgIcon('<path d="M4.5 9.5h3L11.5 6v12l-4-3.5h-3z"/><path d="M15 9.6a3.5 3.5 0 0 1 0 4.8M17.7 7a7.2 7.2 0 0 1 0 10M20.4 4.7a10.9 10.9 0 0 1 0 14.6"/>'),
  shot: svgIcon('<path d="M4 8.6h3l1.6-2.3h7.8L18 8.6h2v10.2H4z"/><circle cx="12" cy="13.2" r="3.2"/>'),
  paste: svgIcon('<rect x="6.5" y="4.5" width="11" height="16" rx="2"/><path d="M9.5 4.5V7h5V4.5"/><path d="M9.5 12h5M9.5 15.5h3.4"/>'),
  person: svgIcon('<circle cx="12" cy="8" r="3.4"/><path d="M5.8 19.6c0-3.2 2.8-5.6 6.2-5.6s6.2 2.4 6.2 5.6"/>'),
  inbox: svgIcon('<path d="M4 13.5V19h16v-5.5"/><path d="M12 4v9M8 9.5l4 4 4-4"/>'),
  signal: svgIcon('<circle cx="12" cy="12" r="2.2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 16.2a6 6 0 0 0 0-8.4"/><path d="M4.9 4.9a10 10 0 0 0 0 14.2M19.1 19.1a10 10 0 0 0 0-14.2"/>'),
  trash: svgIcon('<path d="M4.5 7h15M9.5 7V4.6h5V7M6.6 7l.9 13h9l.9-13"/><path d="M10.4 10.6v6M13.6 10.6v6"/>'),
};
/* ★ 2026-10-04 第 46 步：让"只剩图标的按钮"仍然有名字。
 * ▎为什么要管这件事：≤760px 那条响应式规则用 `.btn:has(.i) span { display:none }`
 *   把文字收掉只留图标——而 display:none 的内容**不进可访问性树**，
 *   于是手机上这些按钮的可访问名是空的：读屏念不出、悬停没提示、Tab 过去只听到"按钮"。
 *   这不是假想：本轮把图标化从控制坞推广之后，这个口子是被我自己的改动撑大的。
 * ▎名字的唯一来源是**按钮上写着的那句话**（不是再维护一张 id→说明的表，
 *   那张表一定会和文案漂——坑 47）。文案变了就重新同步一次，所以挂在 setIconBtn 里。
 * ▎一个真实的细节：上涨式按钮把同一句话克隆成了两层（基础层 + 悬停层），
 *   直接取 textContent 会得到「静音静音」。悬停层带 aria-hidden，
 *   真实的可访问名计算本来就会忽略它，但我们这里是手工取字符串，所以要自己只取基础层。 */
function ariaNameOf(btn) {
  const base = btn.querySelector && btn.querySelector('.pill-rise__label:not(.pill-rise__label--hover)');
  const t = String((base || btn).textContent || '').trim();
  return t || String(btn.getAttribute && btn.getAttribute('title') || '').trim();
}
function syncAriaName(btn) {
  if (!btn || !btn.setAttribute) return;
  const name = ariaNameOf(btn);
  if (name) btn.setAttribute('aria-label', name);
}
/* 只给"图标 + 文字"这一类按钮同步：表情回应条的 emoji 本身就是内容，不该被换成文字描述。 */
function syncAriaNames(root) {
  const nodes = (root || document).querySelectorAll('.controls .btn, .rd-ibtn, .view-btn, .pill, .auth-guest');
  for (let i = 0; i < nodes.length; i++) syncAriaName(nodes[i]);
}

/* 动态改文本的按钮统一走这里：icon+span 结构，与 index.html 静态按钮同构 */
function setIconBtn(btn, icon, text) {
  btn.innerHTML = icon + '<span>' + text + '</span>';
  /* ★ 2026-10-04 第 43 步补：innerHTML 赋值会把"上涨式"按钮的两层标签连圆一起清掉，
   *   表现是"点一下按钮（静音/字幕/白板…文案会变的那些）之后就没了动效"。
   *   这里原地重装一次——**不另起一套结构**，外壳的定义仍然只有 pillRiseShell 一处（坑 47）。 */
  if (btn.classList && btn.classList.contains('pill-rise')) pillRiseShell(btn);
  syncAriaName(btn);   // 第 46 步：文案变了，可访问名要跟着变（否则手机上念的还是上一次的说法）
}
const connBadge = $('connBadge');
const netBadge = $('netBadge');         // 网络质量徽标（第 13 步）
const connType = $('connType');         // ★ 09-13 可达性：到服务器的连接方式（直连/STUN/TURN）
const crossLinkBtn = $('crossLinkBtn'); // ★ 2026-10-06 跨网邀请链接（服务器没下发 tsUrl 就一直藏着）
/* ★ 2026-10-06 第 47 步：邀请面板（点房间号徽标弹出，两条链接同屏各带一个复制按钮）。
 *   七个元素都在 index.html 里静态存在，面板默认 hidden。 */
const invitePanel = $('invitePanel');
const inviteClose = $('inviteClose');
const inviteLanUrl = $('inviteLanUrl');
const inviteLanCopy = $('inviteLanCopy');
const inviteCrossUrl = $('inviteCrossUrl');
const inviteCrossCopy = $('inviteCrossCopy');
const inviteCrossNote = $('inviteCrossNote');
const inviteHint = $('inviteHint');
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
const pipBtn = $('pipBtn');           // ★ 2026-10-01 画中画（借鉴 Piik）：主画面浮窗化
const captionBar = $('captionBar');   // 舞台底部字幕条
const captionText = $('captionText'); // 字幕文本（名字 + 内容）
const capExportBtn = $('capExportBtn'); // 字幕记录导出
const capHistoryBtn = $('capHistoryBtn');       // ★ 09-17b：历史抽屉开关（字幕条左侧）
const capHistoryPanel = $('capHistoryPanel');   // 历史抽屉
const capHistoryList = $('capHistoryList');     // 历史滚动列表
const capHistoryCloseBtn = $('capHistoryCloseBtn');
/* ★ 2026-10-04h 字幕搜索（长会里找"刚才谁说了什么"——纯前端过滤本地账本，零请求） */
const capSearchInput = $('capSearchInput');
const capSearchCount = $('capSearchCount');
let capSearchQ = '';

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
/* ★ 2026-10-03 字幕延迟读数（第 37 步）：服务器实测"说完→字幕定稿"的秒数显示在这里。
 *   ▎为什么要把它做进界面：延迟这件事**看不见就不可能降**——之前每次问"字幕慢不慢"，
 *   我只能凭分段秒数和模型耗时的算术给一个估算，而估算永远不会告诉我"今天变慢了"。
 *   现在每次定稿都带一个真数字，界面、/metrics、watch.js 三处吃同一个来源。 */
const capLat = $('capLat');
const capLatNum = $('capLatNum'); // ★ 读数数字写进这个子节点：图标留在 index.html 里，JS 不重画装饰
/* ★ 2026-10-07 第 49 步：明暗主题开关（声明放在这里——initTheme() 在文件后面的顶层调用里，
 *   而 const 不会被提升，写在调用之后就是坑 69 那一脚"静默砍掉后面所有初始化"）。 */
const themeBtn = $('themeBtn');
const themeBtnTxt = $('themeBtnTxt');

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
/* ★ 2026-10-04h 原号续开：giveUpRoom 记下死掉的房号（输入框自动填回），点「创建房间」
 *   时作为 create-room 的 roomNumber 传给服务器 = 原号重建 + AI 从字幕账本恢复记忆。 */
let resumeRoomNumber = null;
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
  if (typeof filesBtn !== 'undefined' && filesBtn) filesBtn.disabled = false; // ★ 第 51 步：共享文件（不依赖摄像头）
  fxBtn.disabled = false;     // ★ F6：会内滤镜入口（没摄像头时点了会提示，不会崩）
  capBtn.disabled = false;    // ★ 第 29 步：字幕开关（识别不依赖进房，但广播要）
  aiBtn.disabled = false;     // ★ 09-19 AI Bot：邀请助理不依赖媒体（信令功能）
  aiOpBtn.disabled = false;   // ★ 09-19g：AI 操作员入口（授权链路见服务器 ai-op）
  // ★ 09-25 AI 语音：也在这里放开（updateAiVoiceUi 内部会再判浏览器是否支持 speechSynthesis）
  updateAiVoiceUi();
  lowBwBtn.disabled = false;  // ★ 第 32 步：省流开关（订阅了别人画面才有意义，进房后放开）
  pipBtn.disabled = false;    // ★ 2026-10-01 画中画（借鉴 Piik）：进房后可把主画面浮窗化
  // ★ 第 51 步：人在会里 = 首屏那层一定收起（原先只有点「进入会议」才会收，
  //   别的进房路径会让 z100 的 landing 层继续盖着全场——界面上"什么都对"，就是点不动）
  if (typeof dismissPrejoin === 'function') dismissPrejoin();
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
  /* ★ 2026-10-04h 原号续开：服务器重启后房间没了，但字幕账本还在——输入框里
   *   已被 giveUpRoom 自动填上的旧房号，配合「创建房间」= 原号重建 + AI 记忆恢复。
   *   输入框被用户改成别的（或为空）时行为不变（随机新号）。 */
  const want = (resumeRoomNumber && roomInput.value.trim() === resumeRoomNumber)
    ? resumeRoomNumber : undefined;
  log(want
    ? `🏢 原号续开：正在重建房间 ${want}（AI 会从字幕账本找回这一场的记忆）...`
    : (password ? `🏢 正在创建新房间（并设置密码 ${password}）...` : '🏢 正在创建新房间...'));
  socket.emit('create-room', { ...(password ? { password } : {}), ...(want ? { roomNumber: want } : {}) });
  createBtn.disabled = true;
  joinRoomBtn.disabled = true;
});

socket.on('room-created', ({ roomNumber }) => {
  resumeRoomNumber = null;   // 续开成功（或新号）后清除标记，避免影响下一次建房
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

/* ★ 2026-10-02 「房间没了」要**就地退回加入页**，而不是弹模态框。
 *   起因是用户实测反馈"一直弹这个"：服务器重启后房间是内存结构、号已回收，
 *   而 D6 自动重连会拿旧 myRoom 再 join-room → room-not-found → **原生模态框阻塞主线程** →
 *   点掉确定 → socket 又重连 → 再 join → 再弹……**无限循环**。
 *   ▎两个独立错误叠在一起：
 *   ① 原生模态框（alert）是**阻塞主线程**的，它把重连状态机冻在中间，
 *      用户只能一遍遍点确定（而且它长不出"这次不再试了"的记忆）；
 *   ② `myRoom` 从来没有"作废"这条路——进过房就永远自认为在房里，
 *      于是徽标还挂着旧房号、重连还去敲已经不存在的那扇门。
 *   正解：把"这个房间没有了"当成一个**状态迁移**（清 myRoom + 回加入页 + 拆媒体），
 *   提示交给页内的 toast（可叠加、可自动消失、不冻线程）。 */
function giveUpRoom(why) {
  const gone = myRoom;
  myRoom = null;
  myRoomPassword = null;
  myRoomToken = null;
  reconnecting = false;
  /* ★ 2026-10-04h 原号续开的入口：记住死掉的房号并把输入框填上——用户点
     「创建房间」就是原号续开（服务器会从字幕账本找回这一场的记忆）。 */
  resumeRoomNumber = gone || null;
  if (gone) {
    /* ★ 2026-10-10（B4）这里原来还写了一份 `localStorage.setItem('sfuLastRoom', gone)`——
     *   全仓库**没有任何一处读它**（grep 过：只有这一行）。"写了没人读的状态"不是冗余而是隐患：
     *   它看起来像"我们记住了死掉的房号"，于是下一个人会去信任它、或者反过来不敢删这套机制，
     *   而真正生效的那条路是上面两行的内存变量 + 输入框预填。删。 */
    if (roomInput && !roomInput.value.trim()) roomInput.value = gone;
  }
  try { resetMediaState(); } catch (e) { /* 媒体本来就没起来过 */ }
  /* ★ 2026-10-10（B4 反向配对）房间作废，这一场挂着的"待回落朗读账"也跟着作废。
   *   ▎为什么这是缺陷而不是保险：每一笔 pendingServerTts 都配了一根 20 秒的客户端保险丝
   *     （armServerTtsBackstop → fallBackToBrowserTts），它不认"房间还在不在"，只认"这条账还在不在"。
   *     服务器重启 → room-not-found → 人已经退回加入页，而那根 20s 的钟还在走：
   *     到点它就**用浏览器朗读把死房间里那条答案念出来**。用户在首页听见 AI 说话，
   *     而界面上一个字都没说这是谁的——这正是"只有正向（挂账）没有反向（销账）"的形状。
   *   ▸ 销账就够，不需要存定时器句柄：保险丝的动作前会先问"这条账还在不在"（见那行注释），
   *     账没了它自然不响——这一条既有设计正是为了让撤销便宜。
   *   ▸ 顺带把浏览器那一轨与正在播的服务端 MP3 一起停掉（hushAiSpeech 的收口，
   *     它内部按 SPEECH_OK 自我保护，所以这里不需要再加判据）。 */
  try { hushAiSpeech(); } catch (e) { /* 朗读本来就没起来过 */ }
  pendingServerTts.clear();
  /* ★ 2026-10-06 房间没了，那张"邀请面板"就跟着作废：上面那行只把徽标藏了，
   *   面板是独立浮层、不会跟着藏——留着就是一张写着死房号的邀请卡，
   *   复制出去对方必然进不来。凡"链接依赖在房里"的界面，都要走这条作废路径。 */
  closeInvitePanel();
  /* ★ 2026-10-07 第 51 步：共享文件面板跟着房间一起作废。
   *   房间没了，清单里那几份文件的下载链接全部失效——留着面板就是
   *   "点一下报一串 401"，用户只会以为是自己网坏了（与上面那张死房号邀请卡同一个毛病）。 */
  try { setFilesOpen(false); } catch (e) { /* 面板本来就没起来过 */ }
  filesData = []; filesView = null; filesLimits = null; filesUploading = [];
  roomBadge.classList.add('hidden');
  roomPanel.classList.remove('hidden');
  [leaveBtn, handBtn, boardBtn, fxBtn, capBtn, aiBtn, aiOpBtn, filesBtn].forEach((b) => { if (b) b.disabled = true; });
  resetRoomButtons();
  log(`🚪 房间 ${gone || '(无)'} 已经不在了：${why} —— 已退回加入页，不会再自动去敲这扇门`);
}

socket.on('room-not-found', ({ roomNumber }) => {
  log(`❌ 房间 ${roomNumber || '(空)'} 不存在：可能输错了，或对方已结束会议`);
  if (myRoom) {
    // 重连重回旧房失败：这是状态迁移，必须停止后续自动重试
    giveUpRoom('服务器那边这个号已经不存在（多半是服务重启或最后一人离开后房间被回收）');
    showToast(`房间 ${roomNumber || ''} 已不存在——请核对房间号，或直接创建一个新房间`, 'error');
    return;
  }
  resetRoomButtons();
  if (roomInput) { roomInput.value = ''; roomInput.focus(); }
  showToast(`房间 ${roomNumber || ''} 不存在，请核对房间号（或点「创建房间」开一个新的）`, 'error');
});

socket.on('room-wrong-password', ({ roomNumber }) => {
  log(`🔒 房间 ${roomNumber || ''} 需要密码：密码为空或不对，进不去`);
  resetRoomButtons();
  if (!myRoom && roomNumber) {
    roomInput.value = roomNumber;
    roomPasswordInput.focus();
  }
  showToast(`房间 ${roomNumber || ''} 需要密码，请输入正确密码后再加入`, 'error');
});

socket.on('room-full', ({ max }) => {
  log(`❌ 房间已满（最多 ${max} 人），请稍后再试`);
  resetRoomButtons();
  showToast(`房间已满（最多 ${max} 人），请稍后再试`, 'error');
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
/* ★ 2026-10-09 登录卡的"开"。
 * ▎为什么这是一条真缺口而不是"少个按钮"：审计发现全文件只有 hideAuth()，
 *   `remove('hidden')` 只出现在"设备码面板返回"那两条误打误撞的路径上——
 *   也就是说**登录之后没有任何路径能再回到登录卡**：换不了账号、登不出来、
 *   登录态过期了界面也什么都不做（原来那句只往流程日志里写一行）。
 * ▸ 它只在**用户主动点**的时候被调用（顶栏身份牌 / 账号面板里那颗「登录 / 注册」），
 *   登录态过期时**不**自动弹：人在会议中途被一张全屏遮罩挡住，比"没退出去"更糟。 */
function showAuth(text) {
  authOverlay.classList.remove('hidden');
  if (text) showAuthMsg(text, false);
  try { authUserEl.focus(); } catch (e) { /* 无头环境没有焦点 */ }
}

/* ── ★ 2026-10-09 第 52 步：登录态的反面（退出 + 身份 + 治理台入口）──
 * ▎状态只有一份，住在 myAuth；界面上那几处文字（顶栏徽标 / 面板里的名字与角色）
 *   都是它的一个视图，一律走 renderAccount() 重画。
 * ▎为什么不用 `userChipTxt.textContent === '未登录'` 这类判据：
 *   坑 97 那条事故（换设备把麦克风自己关掉）就是这么来的——给人看的字符串
 *   会随文案、图标、动效改版而变，用它当机器判据迟早静默反转。
 *   冒烟里有一条全文件结构红线盯着 `xxBtn.textContent === '…'`。 */
const userChip = $('userChip');
const userChipTxt = $('userChipTxt');
const accountPanel = $('accountPanel');
const accountName = $('accountName');
const accountRole = $('accountRole');
const accountLoginBtn = $('accountLoginBtn');
const accountLogoutBtn = $('accountLogoutBtn');
const accountAdminBox = $('accountAdminBox');
const accountHint = $('accountHint');
const myAuth = { username: null, token: null, displayName: null, avatar: null, source: 'none' };

/* 角色不在这份状态里存第二份：房主/管理员是**服务器**算的（room-state 的 me.owner / me.role），
 * 本地 myAuth 只回答"这台浏览器还记不记得我是谁"。
 * 两者会不一致是**正常**的（例如票过期了但人还在会里），所以面板上分开讲：
 * 角色行来自服务器，登录行来自本地。 */
function myRoomState() {
  if (!myAuth.username) return null;              // 本地没登录态 → 一切按游客（不再信旧快照里的 role）
  const me = (lastMembers || []).find((m) => m.id === socket.id);
  return me || null;
}
function roleLabel() {
  const me = myRoomState();
  if (me && me.owner) return { tag: '房主', hint: '本房间的创建者：可以移出成员、删任何人的共享文件。' };
  if (me && me.role === 'admin') return { tag: '平台管理员', hint: '治理角色：观测面板 / 录像 / 金标准 / metrics 只认你的 token。' };
  if (myAuth.username) return { tag: '成员', hint: '已登录：可以录制、上传文件、被移出时需要重新进房。' };
  return { tag: '未登录', hint: '游客：昵称显示为"成员 xxxx"，不能发起服务器录制。' };
}

function renderAccount() {
  const r = roleLabel();
  const name = myAuth.displayName || myAuth.username;
  if (userChipTxt) userChipTxt.textContent = name || '未登录';
  if (userChip) {
    // idle/active 是顶栏徽标的两态（与其余徽标同款类名）；这里只是把"登录中"画出来
    userChip.classList.toggle('active', !!myAuth.username);
    userChip.classList.toggle('idle', !myAuth.username);
    userChip.title = `${r.tag}${name ? ' · ' + name : ''} —— 点击查看账号与退出`;
  }
  if (accountName) accountName.textContent = name || '未登录';
  if (accountRole) {
    accountRole.textContent = `${r.tag} · ${r.hint}`;
    accountRole.classList.toggle('dim', !myAuth.username);   // 未登录那一行讲的是"接下来会怎样"，不该抢焦点
  }
  if (accountLoginBtn) accountLoginBtn.classList.toggle('hidden', !!myAuth.username);
  if (accountLogoutBtn) accountLogoutBtn.classList.toggle('hidden', !myAuth.username);
  // 治理台只给平台管理员出现（服务器投影的 role，不是本地猜的 username 白名单）
  if (accountAdminBox) accountAdminBox.classList.toggle('hidden', !(myRoomState() && myRoomState().role === 'admin'));
  disarmLogout();
}

/* 退出是两步确认：第一次点把文案换成"确认退出？"，8 秒不点就复位。
 * 复位判据用 dataset.armed（上面说过：文字不是状态）。 */
function disarmLogout() {
  if (!accountLogoutBtn) return;
  delete accountLogoutBtn.dataset.armed;
  accountLogoutBtn.textContent = '退出登录';
}
function setAuthHint(text) { if (accountHint) accountHint.textContent = text || ''; }

/* 一次性把登录态的四个落点全清掉——**这就是"退出登录的效果"**。
 * 少清一个，都会有一个地方还认为我是那位用户：
 *   · localStorage 的 wb_auth —— dashboard / recordings / golden 三个页面共读它，
 *     不清就是"这个页面退出了，切过去还是登录态"；
 *   · 模块级 myDisplayName / myAvatar —— 聊天与字幕署名从这儿取；
 *   · 续期定时器 —— 不清会继续拿一张已作废的票每小时打一次服务器；
 *   · 服务器那条 socket 的身份 —— 走 auth-logout 信令（见下）。
 * ▸ 成员列表里"我"那一行的昵称不用这里改：它来自服务器的 room-state 投影，
 *   而 auth-logout 的处理器已经广播过一次——**在两处各清一遍就会漂**（坑 47）。 */
function clearAuthState(why) {
  if (authStore) authStore.removeItem('wb_auth');
  myAuth.username = null; myAuth.token = null; myAuth.displayName = null; myAuth.avatar = null;
  myDisplayName = null;                 // 聊天/字幕署名的来源（声明在 684 行附近）
  myAvatar = null;                      // 成员列表头像
  if (window.__authRefreshTimer) { clearInterval(window.__authRefreshTimer); window.__authRefreshTimer = null; }
  renderAccount();
  log(`👤 ${why || '已退出登录'}（昵称回退为"成员 xxxx"，人继续留在会里）`);
}

/* 退出 ≠ 离开会议：游客本来就可以在场（09-16 的设计），把"退出"做成踢人会让人不敢点。
 * ▸ 两条路径（连着 / 没连着）共用同一个 finish()：本地清零 + 面板提示 + toast 是一次状态迁移，
 *   不是"网络往返的奖励"。第一版把提示与 toast 只写在有网那一路，断网时点退出
 *   界面悄悄回到"未登录"却一句反馈都没有——这次是冒烟把它逼出来的
 *   （坑 83：假环境缺一个能力，那条分支就永久不测；桩补上 socket.connected 之后它才被执行过）。 */
function doLogout() {
  const token = myAuth.token;
  const finish = () => {
    clearAuthState('已退出登录');
    setAuthHint('已退出。会议没断——你现在是游客，随时可以从这里重新登录。');
    showToast('已退出登录（仍在会议中）', 'info');
  };
  if (!socket || !socket.connected) { finish(); return; }
  // 先发信令再清本地：服务器要把这张票作废，并把我这条连接的 role 落回 guest（广播给全房）
  let done = false;
  const once = (cb) => () => { if (!done) { done = true; cb(); } };
  // 3s 保险丝：服务器没回话也要让用户看到"退出了"，别把状态迁移挂在一个不回来的往返上
  const t = setTimeout(once(() => { setAuthHint('服务器没回话，本地已经退出了。'); finish(); }), 3000);
  try {
    socket.emit('auth-logout', { token }, once(() => { clearTimeout(t); finish(); }));
  } catch (e) { clearTimeout(t); finish(); }
}

if (userChip) userChip.addEventListener('click', () => {
  const up = !accountPanel.classList.contains('hidden');
  up ? accountPanel.classList.add('hidden') : (setAuthHint(''), accountPanel.classList.remove('hidden'));
  userChip.setAttribute('aria-expanded', String(!up));
});
const accountCloseBtn = $('accountClose');
if (accountCloseBtn) accountCloseBtn.addEventListener('click', () => {
  accountPanel.classList.add('hidden');
  if (userChip) userChip.setAttribute('aria-expanded', 'false');
});
if (accountLoginBtn) accountLoginBtn.addEventListener('click', () => {
  accountPanel.classList.add('hidden');
  showAuth('');
});
if (accountLogoutBtn) accountLogoutBtn.addEventListener('click', () => {
  if (accountLogoutBtn.dataset.armed === '1') { doLogout(); return; }
  accountLogoutBtn.dataset.armed = '1';
  accountLogoutBtn.textContent = '确认退出？';
  setAuthHint('退出后这台浏览器不再记得你；会议不会断，人还在房里。');
  setTimeout(disarmLogout, 8000);
});

/* ★ 2026-10-09 忘记密码：这个项目没有邮件/短信找回（零依赖、可以完全离线跑），
 *   所以这里**不许**做一个"重置链接已发送"的假样子——那种提示会让人去查一个不存在的邮箱。
 *   给的是两条真的路：本机部署 → 在服务器那台机器上跑 CLI；部署在别人机器上 → 找那位管理员。
 *   两者都写的理由：同一个提示在不同部署形态下都要成立，否则就又成了一句过期声明。 */
const authForgotBtn = $('authForgotBtn');
if (authForgotBtn) authForgotBtn.addEventListener('click', () => {
  showAuthMsg('教学版没有邮件/短信找回。① 服务器在你自己这台机器上：开个终端跑  npm run admin:passwd -- 你的用户名  '
    + '（不给新密码会随机生成一条，只在终端显示一次）；② 服务器在别人/公司机器上：找那位管理员执行同一条命令。'
    + '两条都需要能登录那台机器——这正是"本地可信通道"的边界，不是一条能被远程利用的后门。', false);
  log('👤 「忘记密码」：给出本机 CLI 与找管理员两条真实路径（本项目不做邮件找回）');
});

function saveAuth(user, token) {
  myDisplayName = user.displayName || user.username;
  myAvatar = user.avatar || null; // ★ 09-26：头像随登录态带回
  myAuth.username = user.username;
  myAuth.token = token;
  myAuth.displayName = myDisplayName;
  myAuth.avatar = myAvatar;
  myAuth.source = 'local';
  if (authStore) authStore.setItem('wb_auth', JSON.stringify({ username: user.username, token }));
  hideAuth();
  renderAccount();
  log(`👤 已登录：${myDisplayName}`);
    // ★ 09-19h G6：每小时滑动续期（长期值守不掉线；失效则静默回登录态）
    if (window.__authRefreshTimer) clearInterval(window.__authRefreshTimer);
    window.__authRefreshTimer = setInterval(() => {
      // 读存档走 authStore 而不是裸 localStorage（坑 25：无存储环境里顶层访问要防御式）
      const saved = authStore ? JSON.parse(authStore.getItem('wb_auth') || '{}') : {};
      if (!saved.token) return;
      socket.emit('auth-refresh', { username: saved.username, token: saved.token }, (resp) => {
        /* ★ 2026-10-09 这条原来只往流程日志里写一行"请重新登录"——而那行字在折叠的日志面板里，
         *   等于**没有任何效果**：票已经废了/过期了，界面还显示我是那位用户，聊天署名、
         *   头像、成员列表全都照旧。现在把过期当成一次**状态迁移**处理（同 giveUpRoom 的思路）：
         *   清四个落点 + 让身份牌说真话，但**不**弹全屏登录卡打断会议。 */
        if (resp && resp.error) {
          clearAuthState('登录态已过期');
          setAuthHint('登录态过期了，已按游客继续。点这里可以重新登录。');
          showToast('登录态已过期，已退回游客（会议不中断）', 'info');
        }
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
    showAuthMsg(err.message, false);
  }
}
$('authLoginBtn').addEventListener('click', () => doAuth('auth-login'));
$('authRegisterBtn').addEventListener('click', () => doAuth('auth-register'));
authPassEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth('auth-login'); });
$('authGuestBtn').addEventListener('click', () => {
  hideAuth();
  log('👤 游客模式进入（昵称将显示为"成员 xxxx"，可随时注册）');
});

/* ★ 2026-10-04 密码可见切换。
 * ▎为什么值得做：注册时"昵称/密码"两栏挨着，看不见自己打了什么是最常见的一次失败重试；
 *   而它必须是**按钮**而不是 input 的一部分，才不会干扰输入法与自动填充。
 * ▎两颗图标（眼睛/划掉的眼睛）都留在 DOM 里，靠 [data-show] 选一颗显示——
 *   不用 innerHTML 换图标：那会把按钮内容整个重建（第 34 节刚为这件事踩过一次）。 */
const authPassEye = $('authPassEye');
if (authPassEye && authPassEl) {
  authPassEye.addEventListener('click', () => {
    const show = authPassEl.type !== 'text';
    authPassEl.type = show ? 'text' : 'password';
    if (show) authPassEye.setAttribute('data-show', ''); else authPassEye.removeAttribute('data-show');
    authPassEye.title = show ? '隐藏密码' : '显示密码';
    authPassEl.focus();          // 切换完继续打字，不用鼠标再点一次
  });
}

// 自动恢复登录态：socket.io 会把连接前的 emit 缓冲到连接建立后（不用等 connect 事件）
(async () => {
  try {
    const saved = authStore && JSON.parse(authStore.getItem('wb_auth') || 'null');
    if (!saved || !saved.username || !saved.token) return; // 没存档：停在登录卡
    const resp = await request('auth-verify', saved);
    saveAuth(resp.data.user, saved.token);
  } catch (err) {
    /* 存档失效（服务器重启过 / 票被撤销）：走与"退出登录"同一个收口。
     * ▎为什么不复用那行 removeItem：撤销登录态是一个概念，原先有两处各写一遍
     *   （这里 + clearAuthState）——而这里的旧写法只清了 localStorage，
     *   没清 myDisplayName / myAvatar / 续期定时器，正是"退出没效果"的那类漂移（坑 47）。 */
    clearAuthState('登录态已失效');
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
let tsUrl = null;             // ★ 2026-10-06：跨网稳定入口（服务器装了 Tailscale 才下发；没装= null）
/* ★ 2026-10-07 跨网可达性判定（服务器 sfu/nets.js 的 diagnose 算好的一份结论）。
 *   前端**不参与判断**，只把它显示出来——判据有两份就会互相矛盾（坑 47），
 *   而"能不能跨网"这件事的真相只有服务器那侧知道（它才知道自己的监听地址与网卡）。 */
let serverNetCheck = null;
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
    const cfg = await fetch('/config.json', { cache: 'no-store' }).then((r) => r.json());
    applyServerConfig(cfg);
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

/* ★ 2026-10-03 屏幕共享的分层：码率档整体比摄像头高一截。
 * ▎为什么不能共用同一张表：共享的内容是**文字与线条**——1080p 幻灯片压到 500kbps
 *   就是一团马赛克，观众看不清字等于没共享；而摄像头是人脸+背景，低码率也能看。
 * ▎代价照实说：simulcast 上行 = 三档之和（约 4.2Mbps），共享方最吃上行带宽；
 *   换来的是"每个观众按自己的下行带宽拿合适的一层"，而不是全员一起卡死。
 *   （SVC 模式 config.videoSvc=true 时摄像头走单路分层，共享这里仍是 simulcast——
 *    屏幕内容的空间层差异大，独立三路更稳。） */
const SCREEN_SIMULCAST_ENCODINGS = [
  { rid: 'q', maxBitrate: 250000, scaleResolutionDownBy: 4 },  // 低：缩到 1/4 边长，够看清版式
  { rid: 'h', maxBitrate: 1200000, scaleResolutionDownBy: 2 }, // 中：约 960×540，日常够用
  { rid: 'f', maxBitrate: 2800000, scaleResolutionDownBy: 1 }, // 高：原始分辨率，文字锐利
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
  setIconBtn(btn, ICONS.cursor, '请求控制');
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
  setIconBtn(btn, ICONS.pin, '钉选');
  btn.addEventListener('click', () => togglePin(remoteId));
  box.appendChild(btn);
}

/* ★ 2026-10-02 Piik 取长①：每路远端**独立音量**，并且可以超过 100%（audio boost）
 * ▎为什么值得做：真实会议里"那个人声音太小/太大"是最高频的抱怨，而全局音量解决不了它
 *   （调大了另一个人就炸）。Piik 给每个观众一份"只管我自己听到什么"的控件，就是这个思路。
 * ▎**安全分层**（这条设计是刻意的，别合并成一条路径）：
 *     · 0 ~ 100%  → 直接用 video.volume。零新机制、不需要用户手势、不可能把会议搞成静音；
 *     · > 100%    → 才挂 WebAudio 的 GainNode（HTMLMediaElement 的 volume 上限就是 1.0，
 *                   要过 unity 只能走音频图）。这时必须把 <video> 静音，否则"元素出声 +
 *                   图出声"= 双重回声。
 *   ▸ 增强失败（没有 AudioContext / 被自动播放策略挡住 / 这一格还没有流）就**退回 100%**
 *     并说明原因——绝不让"想调大点"变成"突然没声音了"。
 *   ▸ AudioContext 只在第一次需要增强时才建（不抢页面其它用途：预览试音、D5 混音器）。 */
const tileGain = new Map();   // video 元素 → { src, gain }
let playbackCtx = null;
function getPlaybackCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!playbackCtx) playbackCtx = new AC();
  if (playbackCtx.state === 'suspended') { try { playbackCtx.resume().catch(() => {}); } catch (e) { /* 忽略 */ } }
  return playbackCtx && playbackCtx.state !== 'suspended' ? playbackCtx : null;
}
function detachTileGain(video) {
  const n = tileGain.get(video);
  if (n) { try { n.src.disconnect(); n.gain.disconnect(); } catch (e) { /* 已断 */ } tileGain.delete(video); }
  video.muted = false;
}
/* 返回真正生效的音量（可能小于请求值——增强不可用时回落 1.0），调用方据此回写滑杆 */
function applyTileVolume(video, want) {
  const v = Math.max(0, Math.min(2, Number(want) || 0));
  if (v <= 1) { detachTileGain(video); video.volume = v; return v; }
  const ctx = getPlaybackCtx();
  if (!ctx || !video.srcObject) { video.volume = 1; return 1; } // 增强不可用：满音量但不炸
  let n = tileGain.get(video);
  /* ★ 流换了对象就必须重挂：replaceTrack / D6 重连 / 关摄像头再开，都会给这一格一条
   *   **新的 MediaStream**，而 GainNode 上游还接着旧流——旧流已停 = 这一格彻底没声，
   *   而元素此时是被我们静音的（防双重出声），于是"调大音量"反而变成"突然静音"。
   *   这是本项目反复强调的那类缺陷（坑 32 的音频版：锚点变了，挂在旧锚点上的东西要重建）。 */
  if (n && n.stream !== video.srcObject) { detachTileGain(video); n = null; }
  if (!n) {
    try {
      const src = ctx.createMediaStreamSource(video.srcObject);
      const gain = ctx.createGain();
      gain.gain.value = v;
      src.connect(gain);
      gain.connect(ctx.destination);
      n = { src, gain, stream: video.srcObject }; // 记下挂的是哪条流（上面那段注释判的就是它）
      tileGain.set(video, n);
      video.muted = true; // 声音改由音频图负责（不静音就是双重出声）
    } catch (e) {
      detachTileGain(video);
      video.volume = 1;
      return 1;
    }
  }
  n.gain.gain.value = v;
  video.volume = 1;
  return v;
}
/* ★ 2026-10-10（B4）这一行的注释原来写的是"谁吵谁安静，换场会还认得"——那是**过期声明**（坑 82）：
 *   键是 socket.id，而 socket.id 每次连接都换（同一场会里对方重连一次就变），
 *   所以这份记录跨不了一次重连，更跨不了场次。它真正的作用范围只有一件事：
 *   同一场会里我把某个人调到 30%，他换个 producer（关摄像头再开）时格子重建，音量不该弹回 100%。
 * ▸ 既然天然只会攒没人再读的条目，就得有上限——VOL_STORE_MAX 条按"最近调过"保留。
 *   ▎两个细节都不是可有可无：① 先 delete 再 set，让"最近调过的键"排到对象末尾
 *     （JS 对象里**已存在的键**改值不会挪位置，直接赋值会让最老那条永远赖在最前面被当成新的）；
 *     ② socket.io 的 id 永远以字母/下划线开头，所以它不会被当成整数键而按数字顺序提前——
 *     这条前提是"插入顺序≈最近顺序"成立的条件，换 id 方案时要重新检查（写在这是为了下次能查）。 */
const VOL_STORE_KEY = 'sfu.tileVol.v1';
const VOL_STORE_MAX = 60;
function storedVolumes() {
  try { return JSON.parse(localStorage.getItem(VOL_STORE_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function rememberVolume(id, v) {
  try {
    const m = storedVolumes();
    delete m[id];                       // 见上面①：改值不挪位，先删再写才轮到末尾
    m[id] = Math.round(v * 100) / 100;
    const keys = Object.keys(m);
    for (let i = 0; i < keys.length - VOL_STORE_MAX; i++) delete m[keys[i]];   // 剪掉最久没碰的那头
    localStorage.setItem(VOL_STORE_KEY, JSON.stringify(m));
  } catch (e) { /* 隐私模式写不进就算了 */ }
}
function addVolumeCtl(box, tile, remoteId) {
  if (box.dataset.volCtl) {
    // 已有控件（重复订阅/重连后同一格再挂一次）：把滑杆值重新作用一遍，
    // 让 applyTileVolume 内部的"流换对象就重挂"逻辑跟上（否则增强会悄悄失效）。
    const sl = box.querySelector('.vol-ctl input');
    if (sl) applyTileVolume(tile.video, Number(sl.value));
    return;
  }
  box.dataset.volCtl = '1';
  const wrap = document.createElement('div');
  wrap.className = 'vol-ctl';
  const icon = document.createElement('span');
  icon.className = 'vol-ico';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0'; slider.max = '2'; slider.step = '0.05';
  const saved = storedVolumes()[remoteId];
  slider.value = String(saved == null ? 1 : saved);
  const label = document.createElement('span');
  label.className = 'vol-num';
  const paint = (v) => {
    label.textContent = Math.round(v * 100) + '%';
    icon.innerHTML = v === 0 ? ICONS.volMute : v > 1 ? ICONS.volHigh : ICONS.speaker;
    slider.classList.toggle('over', v > 1);
  };
  const apply = () => {
    const eff = applyTileVolume(tile.video, Number(slider.value));
    if (eff !== Number(slider.value)) slider.value = String(eff); // 增强不可用 → 滑杆自己回到 100%
    rememberVolume(remoteId, eff);
    paint(eff);
    if (eff < Number(slider.value)) showToast('这台设备暂时不支持超过 100% 的增强，已停在 100%', 'info');
  };
  slider.addEventListener('input', apply);
  slider.addEventListener('click', (e) => e.stopPropagation()); // 别触发格子的双击全屏
  wrap.appendChild(icon); wrap.appendChild(slider); wrap.appendChild(label);
  box.appendChild(wrap);
  paint(Number(slider.value));
  if (saved != null) apply(); // 重连/重新订阅后把偏好补回去（流换了对象，增益必须重挂）
}
/* ★ 2026-10-02 Piik 取长②：每格一个「不看」按钮 = 让服务器 pause 这路的**视频** Consumer
 * ▎语义是"只听不看"：画面停掉，**声音留着**（会议里你不能因为不想看某人就把他静音）。
 * ▎为什么不是前端 display:none 就完事：那样 mediasoup 还在往你这里发这路的包，
 *   下行带宽一分没省；只有服务器 pause 才真的不发（服务器侧 set-consumer-paused 事件）。
 * ▎与 ABR/省流的分工：暂停期间选层监控被服务器侧守卫跳过（坑 21/62 同一条纪律——
 *   一个执行器不能有两个控制回路），恢复后 ABR 才重新接手。 */
function addWatchBtn(box, tile) {
  if (box.dataset.watchBtn) return; // 幂等：一格一个（dataset 标记，同 addPinBtn 的做法）
  box.dataset.watchBtn = '1';
  const btn = document.createElement('button');
  btn.className = 'watch-btn';
  btn.textContent = '⏸ 不看';
  btn.title = '只听不看：让服务器停止转发这一路的画面（真省下行带宽），声音保留；再点恢复';
  let paused = false;
  btn.addEventListener('click', async () => {
    if (!tile.videoConsumerId) { showToast('这一格还没有视频可暂停', 'info'); return; }
    btn.disabled = true;
    try {
      const resp = await request('set-consumer-paused', { consumerId: tile.videoConsumerId, paused: !paused });
      paused = !!(resp && resp.data && resp.data.paused);
      box.classList.toggle('paused-view', paused);
      btn.textContent = paused ? '▶ 看' : '⏸ 不看';
      log(paused ? '⏸ 已暂停这一路画面（服务器停止转发，下行省下来）' : '▶ 恢复接收这一路画面');
    } catch (e) {
      showToast(`画面暂停失败：${e.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  });
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
      // ★ 2026-10-02 Piik 取长①：这一路的独立音量（含 >100% 增强）挂在主画面格上
      addVolumeCtl(tile.box, tile, from);
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
    /* ★ 2026-10-05 问题⑥（用户："共享会议屏幕比例还是有点不协调"）：
     *   给屏幕格挂语义类 source-screen——CSS 里摄像头画面 cover 求"填满"、
     *   屏幕内容 contain 求"看全"（文档/图表的边不能被裁，裁掉等于没共享）。
     *   两处屏幕格（远端此处 + 本地 addSelfScreenTile）都挂，CSS 规则只写一份。 */
    tile.box.classList.add('source-screen');
    ensureScreenBackdrop(tile.box, tile.video); // ★ 第 48 步：黑边换成模糊衬底（远端屏幕格）
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
    if (kind === 'video') addWatchBtn(tile.box, tile); // ★ 2026-10-02 「只听不看」按钮（视频路才有意义）
    /* ★ 2026-10-03 补渲染"选层器"：服务器的 layer-changed(initial) 是在 consume 的
     *   **ack 之前** emit 的（坑 61 那条时序），而格子要等 ack 回来才登记进 consumerTiles——
     *   于是那条通知到达时 `tile` 还不存在，ensureLayerPicker 直接 return，
     *   **选层器从来没被创建出来**（真浏览器 e2e 第一次断言 videoWidth 就抓到了：
     *   层数明明有 3 层、layerState 里查得到，DOM 里却一个 .layer-pick 都没有）。
     *   修法顺着"一个概念只有一个来源"：layerState 才是权威账本，
     *   格子一出现就照账本补一次渲染，而不是去调服务器的 emit 时序。 */
    if (kind === 'video') {
      const st = layerState.get(consumer.id);
      if (st && st.layerCount > 1) {
        ensureLayerPicker(tile, consumer.id, st.layerCount);
        updateLayerPicker(tile, st);
      }
    }
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
    detachTileGain(tile.video); // ★ 2026-10-02 音量增强走的音频图也要拆（否则每轮重连漏一批节点）
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
  boardStrokes.length = 0; // 重连先清本地账本；★ 2026-10-03 起重回房间时服务器会用 board-state 把账本补回来
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
      detachTileGain(tile.video); // ★ 2026-10-02 同上：拆音频图再删格子
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
      detachTileGain(tile.video); // ★ 2026-10-02 同上
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
        /* ★ 2026-10-01（借鉴 Piik）：共享带音频——勾选标签页时把网页声音一起送进会议
         *   （看视频/放 PPT 配乐的场景）。浏览器不勾音频时这条静默为无声轨，无害。 */
        audio: true,
      });
      const screenTrack = screenStream.getVideoTracks()[0];
      screenTrack.onended = () => stopSharing(); // 用户点系统"停止共享"
      /* ★ 2026-10-03 屏幕共享也上 simulcast（会议本体这一路的真缺口）：
       *   原来共享是**单层全分辨率**上传，于是弱网观众只能二选一——
       *   要么卡成幻灯片，要么什么都看不见；而服务器明明已经有 D1 的自动选层
       *   （它的守卫是 `kind==='video' && layerCount>1`，**层数>1 就自动生效，服务器零改动**）。
       *   摄像头当年就分了三档，共享漏了——这是"同一个概念两处口径"的老账（坑 47）。
       * ▎码率档比摄像头高：屏幕上是**文字和线条**，压太狠就糊成一片，看不清 PPT 等于没共享。
       * ▎contentHint='detail' 是给编码器的语义提示（文字细节优先于帧率），
       *   Chrome 会据此降低帧率、保住清晰度——共享静态幻灯片时这正好是我们想要的。 */
      try { screenTrack.contentHint = 'detail'; } catch (e) { /* 老浏览器没这个属性 */ }
      let screenProducer;
      try {
        screenProducer = await sendTransport.produce({
          track: screenTrack,
          encodings: SCREEN_SIMULCAST_ENCODINGS,
          appData: { source: 'screen' },
        });
        log(`📤 已上传屏幕（${SCREEN_SIMULCAST_ENCODINGS.length} 层 simulcast，弱网观众会自动降层）`);
      } catch (err) {
        // 兜底：个别环境/编码器不支持共享分层 → 退回单层，功能不能因此没了
        log(`⚠️ 屏幕分层协商失败（${err.message}），退回单层上传`);
        screenProducer = await sendTransport.produce({ track: screenTrack, appData: { source: 'screen' } });
      }
      myProducers.set(screenProducer.id, screenProducer);

      /* ★ 2026-10-01（借鉴 Piik）：共享音频真的推上会——浏览器勾了"分享标签页音频"时
       *   screenStream 里有音轨，作为第二路 audio producer 发出去（appData.source=
       *   'screen-audio'，停止共享时随循环一起关）。没勾就是没有音轨，静默跳过。 */
      const screenAudioTrack = screenStream.getAudioTracks()[0];
      if (screenAudioTrack) {
        try {
          const ap = await sendTransport.produce({ track: screenAudioTrack, appData: { source: 'screen-audio' } });
          myProducers.set(ap.id, ap);
          log('🔊 标签页音频已随共享送入会议');
        } catch (e) { /* 音频轨 produce 失败不影响画面共享 */ }
      }

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
/* ★ 2026-10-06 跨网那条链接**只有一个构造点**（坑 47）。
 *   ▎为什么专门抽出来：顶栏按钮与邀请面板都要用同一条地址，
 *     各写一遍"tsUrl 拼上房间号查询串"迟早会有一处忘了带 ——
 *     而"链接发出去对方进了首页找不到房间"是这条功能最难自查的坏法（链接看着是完整的）。
 *   ▸ 这里刻意不复写那个模板字符串的字面形式：冒烟有一条"构造点唯一"的计数断言，
 *     注释里出现同样的字面串会被它算成第二处（本项目已经因为这形状的注释红过一次）。 */
function crossInviteLink() {
  return tsUrl ? `${tsUrl}/?room=${myRoom || ''}`.replace(/\?room=$/, '') : '';
}
/* ★ 2026-10-06 局域网那条同样只有一个构造点（原先写在徽标的点击处理器里，
 *   面板要复用就必须搬出来——搬出来还顺手修掉一个真问题，见下面 isLocal 那段）。
 *   ▸ 未进房时给**不带房间号**的首页地址，而不是 `?room=` 这种半成品：
 *     空参数会被解析成"房间号是空串"，对方点开停在预览页却不知道为什么。 */
function lanInviteLink() {
  /* ★ 09-16 局域网交付：服务器机自己用 localhost 访问时，复制的链接别的电脑打不开——
   *   此时改用 /config.json 下发的局域网 HTTPS 入口（announcedIp + HTTPS 端口） */
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  const base = (isLocal && lanUrl) ? lanUrl : location.origin;
  return `${base}${myRoom ? '/?room=' + myRoom : '/'}`;
}
/* ★ 2026-10-06 三处复制（徽标 / 顶栏跨网按钮 / 面板两行）共用同一个动作（坑 47）。
 *   ▎为什么值得抽：剪贴板 API 在**非安全上下文**里会直接 reject（http://192.168.x.x 就是），
 *     而原先每个调用点各写一份 try/catch → 三份"失败时说什么"，其中只有徽标那一处写了兜底，
 *     另外两处失败是**静默的**（点了按钮什么也没发生，用户以为链接没生成）。
 *     兜底只写一次，三处才会一样好。
 *   ▸ 兜底话必须指向面板上那个 `user-select: all` 的地址框：点一下就整段选中，
 *     手动 Ctrl+C 一样能用——"自动复制失败"从来不等于"这条链接给不出去"。 */
async function copyText(text, okMsg) {
  if (!text) { showToast('这台服务器没有跨网入口（未装 Tailscale），所以没有跨网链接可复制', 'info'); return false; }
  try {
    await navigator.clipboard.writeText(text);
    if (okMsg) showToast(okMsg, 'info');
    return true;
  } catch (e) {
    showToast('自动复制被浏览器拦了（非 HTTPS 页面常见）——点一下地址框整段选中，再按 Ctrl+C', 'warn');
    return false;
  }
}
async function copyCrossLink() {
  const link = crossInviteLink();
  if (link && !myRoom) { showToast('先进房再复制——链接要带上房间号，对方点开才直接入会', 'info'); return false; }
  const done = await copyText(link, '🌐 已复制跨网邀请链接（对方也要在同一张 Tailscale 里）');
  if (done && link) log(`🌐 跨网邀请链接（不在同一个网络时用）：${link}`);
  return done;
}
if (crossLinkBtn) crossLinkBtn.addEventListener('click', copyCrossLink);

/* ★ 2026-10-06 第 47 步：渲染邀请面板的两行地址 + 一句"此刻网络形态"的说明。
 *   ▎为什么把说明也算在这里：这三句都是从 lanUrl / tsUrl / location / myRoom 现推的事实，
 *     写在 HTML 里就是死文案（服务器没装 Tailscale 时页面仍会说"跨网地址在这里"）。
 *   ▎没有跨网入口时这一行**写明没有**，不给假地址（坑 82：虚假声明比缺失更有害——
 *     一条看着能点、发出去打不开的链接会让人以为是自己网络坏了）。 */
/* ★ 2026-10-07 把服务器的跨网判定画进邀请面板。
 *   ▎三态而不是"有/没有"：ok / warn / bad / info 四种状态各配一个色点（CSS 的 data 属性驱动，
 *     不往 DOM 里塞 emoji——09-19e 那条纪律）。
 *   ▸ 每条"修"都是一条**可以整行复制**的命令或路径，不是一个动词建议：
 *     用户看完就该能直接敲，而不是再回去翻手册。
 *   ▸ 读不到 netCheck（老服务器 / 请求失败）时整块**不出现**——
 *     宁可不提示，也不许编一份"看起来像诊断"的空判断（坑 82）。 */
function renderNetCheck() {
  const box = $('inviteNet');
  if (!box) return;
  box.innerHTML = '';
  const nc = serverNetCheck;
  if (!nc || !Array.isArray(nc.items) || !nc.items.length) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  const head = document.createElement('div');
  head.className = 'invite-net-head';
  head.setAttribute('data-level', String(nc.level || ''));
  head.textContent = nc.headline || '跨网可达性';
  box.appendChild(head);
  for (const it of nc.items) {
    const row = document.createElement('div');
    row.className = 'invite-net-row';
    row.setAttribute('data-state', String(it.state || 'info'));
    const dot = document.createElement('span');
    dot.className = 'invite-net-dot';
    dot.setAttribute('aria-hidden', 'true');
    const txt = document.createElement('span');
    txt.className = 'invite-net-txt';
    // 标签 + 详情分开渲染：标签是"这一项在说什么"，详情是"此刻的事实"
    const b = document.createElement('b');
    b.textContent = it.label || '';
    txt.appendChild(b);
    txt.appendChild(document.createTextNode(it.detail ? ' ' + it.detail : ''));
    row.appendChild(dot);
    row.appendChild(txt);
    if (it.fix) {
      const code = document.createElement('code');
      code.className = 'invite-net-fix';
      code.textContent = it.fix;
      code.title = '点击复制这条修复命令';
      code.addEventListener('click', () => { copyText(it.fix.split('   # ')[0], '已复制修复命令'); });
      row.appendChild(code);
    }
    box.appendChild(row);
  }
}
function renderInvitePanel() {
  const lan = lanInviteLink();
  const cross = crossInviteLink();
  if (inviteLanUrl) {
    inviteLanUrl.textContent = lan;
    inviteLanUrl.classList.toggle('none', !myRoom);
  }
  if (inviteCrossUrl) {
    inviteCrossUrl.textContent = cross || '这台服务器没有跨网入口（没装 Tailscale，也没配 TS_IP）';
    inviteCrossUrl.classList.toggle('none', !cross);
  }
  // 没有跨网地址时，那颗"复制"按钮也不许留在行里（复制按钮对着说明文字 = 界面在骗人）
  if (inviteCrossCopy) inviteCrossCopy.classList.toggle('hidden', !cross);
  /* 顶栏那颗按钮此刻的显隐，面板照实复述一遍（**读它的真实 class**，不另写一份判据）。
   *   ▎为什么这件事值得写：顶栏有 8 个徽标，浮层里说"跨网那条"却没说在哪，
   *     用户还是找不到；而把判据（tsUrl 有没有）在这里再算一次就是第二个来源（坑 47），
   *     所以直接读按钮自己——它藏着我就不该说"在顶栏"。 */
  if (inviteCrossNote) {
    const btnUp = !!crossLinkBtn && !crossLinkBtn.classList.contains('hidden');
    inviteCrossNote.textContent = cross
      ? (btnUp ? '顶栏那颗「跨网链接」按钮点一下也直接复制这一条。'
               : '（顶栏的「跨网链接」按钮此刻是藏着的——面板里这一行照样能复制。）')
      : '';
  }
  if (inviteHint) {
    /* 只说**行标题里没有的那些事实**：截图上第一版把"对方也要在同一张 Tailscale 里"
     * 写了两遍（行标题一遍、说明一遍），四行小灰字挤在浮层底下——重复不是详尽，是噪音。
     * 留下的三条都是"此刻这台机器/这一屏"才成立的事：进没进房、是不是 localhost 打开的、
     * 没有跨网入口时怎样才能有。 */
    const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
    const bits = [];
    bits.push(myRoom ? `两条都带着房间号 ${myRoom}，对方点开直接进会（有密码仍要输一次）。`
                     : '还没进房，上面的地址不带房间号——对方点开是首页，要自己输号。');
    if (isLocal && !lanUrl) bits.push('你现在用 localhost 打开，而服务器没下发局域网地址——上面那条只在这台电脑上打得开（改用 npm run start:lan 起服务）。');
    else if (isLocal) bits.push('本机是 localhost 打开的，第一条已自动换成局域网入口。');
    if (!cross) bits.push('要跨网演示：服务器装 Tailscale，或用 TS_IP 明示那台机器的 100.x 地址后重启。');
    inviteHint.textContent = bits.join(' ');
  }
  renderNetCheck();   // ★ 2026-10-07 跨网自检跟着面板一起刷新（面板开的时候才需要，不做后台轮询）
}
function openInvitePanel() {
  if (!invitePanel) return;
  renderInvitePanel();
  invitePanel.classList.remove('hidden');
}
function closeInvitePanel() { if (invitePanel) invitePanel.classList.add('hidden'); }

roomBadge.addEventListener('click', async () => {
  if (!myRoom) return;
  /* ★ 2026-10-06 点徽标同时做两件事：**复制局域网那条**（最高频的动作，一次点击要办完）
   *   和**打开面板**（把"还有跨网这一条"摆到眼前）。
   *   ▎为什么不改成"只开面板、复制要点第二下"：同一 WiFi 的同事是 90% 的场景，
   *     给它多加一步是净倒退；而翻日志才能拿到跨网地址是净缺陷（第 47 步立项的原因）。
   *     两个都保留：老路径一个字没变，新信息只是多出来的。 */
  openInvitePanel();
  const link = lanInviteLink();
  const crossLink = crossInviteLink();
  const ok = await copyText(link, crossLink ? '📋 已复制局域网邀请链接——跨网那条在面板第二行' : '📋 邀请链接已复制——微信/QQ 发给对方，打开即入会');
  log(`📋 邀请链接（发给同一 WiFi 下的另一台电脑，浏览器打开即可）：${link}`);
  if (crossLink) log(`🌐 跨网链接（不在同一个网络时用，需对方也在同一张 Tailscale 里）：${crossLink}`);
  if (!ok) log(`📋 手动复制这一条：${link}`);
});

/* 面板的三颗按钮：关闭 + 两行各自的复制。
 * ▎复制成功后**不关面板**：一个人要邀请的往往不止一位收件人，且第二行的地址
 *   正是"刚才那条发出去了对方连不上"时要换的那一条——关掉就把它藏回去了。 */
if (inviteClose) inviteClose.addEventListener('click', closeInvitePanel);
if (inviteLanCopy) inviteLanCopy.addEventListener('click', async () => {
  const link = lanInviteLink();
  await copyText(link, '📋 已复制局域网邀请链接');
  log(`📋 局域网邀请链接：${link}`);
});
if (inviteCrossCopy) inviteCrossCopy.addEventListener('click', copyCrossLink);
/* 点面板外面就收起。▸ 判据要**同时**放过徽标本身：
 *   冒泡顺序是"按钮处理器 → document 处理器"，放过它否则"点开"会被同一趟点击关掉。 */
document.addEventListener('click', (e) => {
  if (!invitePanel || invitePanel.classList.contains('hidden')) return;
  if (invitePanel.contains(e.target)) return;
  if (roomBadge && (roomBadge === e.target || roomBadge.contains(e.target))) return;
  closeInvitePanel();
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
/* ★ 第 41 步：phase 必须解构出来——服务器从 09-30 就在 ai-state 里带它
 *   （检索中 / 换个说法再找 / 组织回答），这里漏接 = 那套阶段提示从没上过屏。 */
socket.on('ai-state', ({ state, text, phase }) => setAiState(state, text, phase));
socket.on('asr-caption', ({ name, text, interim, latMs, stage } = {}) => {
  /* ★ 09-27c：服务端 ASR 转写上字幕条（实时字幕体验统一；不刷聊天区）
   * ★ 09-28：三处强化——
   *   ① 只在"字幕开着"时显示（用户关掉字幕就不打扰；服务端仍在转写、仍在喂 AI）；
   *   ② 进本地字幕历史（标记 asr:true → 不再回传服务器，避免与服务器自己的落盘重复）；
   *   ③ bumpBotHeard()：服务端转写是 AI"的确在听"的更强证据，兼顾听觉指示器。
   * ★ 2026-10-01 语句组装：interim=true 是"累积中的半句"——只刷字幕条（实时感），
   *   **不进历史**；成句后的定稿（无 interim）才进历史（Otter 分段不被碎片污染）。 */
  if (!cap.on) return;
  const entry = { ts: Date.now(), from: 'asr', name: name || '转写', text: text || '', asr: true, interim: !!interim };
  /* ★ 2026-10-03 把服务器实测的"说完→上字幕"一起存进本地账本：
   *   值守日报因此能报告"这一夜字幕平均多快"，而不是只在当时屏幕上闪一下。
   *   只存定稿（interim 的延迟没有意义），且缺字段就缺着——不写 0，
   *   读的人要能分清"没量到"与"量到 0 毫秒"。 */
  if (!interim) { const lm = Number(latMs); if (Number.isFinite(lm) && lm > 0) entry.lat = lm; }
  /* ★ 2026-10-03b 半句/定稿的样式要跟着真实标志走：原来写死 true，于是**定稿也永远
   *   带着半句（interim）的视觉状态**——用户看到的一直是"还在打字"的字幕，成了
   *   "它到底定稿没有"永远说不清的观感来源（真浏览器 e2e 抓到：capLat 出现了，
   *   interim 类却从不摘掉）。 */
  showCaptionBar(entry.name, entry.text, !!interim);
  if (!interim) {
    capPushLog(entry);
    if (capHistoryPanel && !capHistoryPanel.classList.contains('hidden')) appendCapHistoryRow(entry);
    renderCapLatency(latMs, stage); // ★ 2026-10-03 定稿才带延迟读数（半句的"延迟"没有意义）
  }
  bumpBotHeard();
  /* ★ 09-30 抢话修复③：真人在说话 → 记时间戳 + AI 立即闭嘴。
   *   排除 AI 自己（外放时服务端可能把 AI 的 TTS 回声也转写出来——那是"AI 在说"，
   *   不是"有人在打断"，不能因此掐断它自己的下一句）。 */
  if (!/AI 小明|ai-bot/i.test(name || '')) {
    lastUserSpeechTs = Date.now();
    /* ★ 2026-10-03f **这一句就是"听不见声音"的根因**（用户实测第 N 轮，本轮定位到具体行）：
     *   原先这里是无条件 hushAiSpeech()。2s 分段把一句话切成三条字幕、相隔 1~2 秒到达，
     *   AI 跟着第一条开始念，第二条到达时用户早已闭嘴 1.5 秒 —— 照样被掐，
     *   并且 hush 会把整轮 ts 拉黑（同轮后续段全丢）= 这一轮彻底无声，零报错。
     *   ▸ 判据换成"AI 真的在出声 **且** 麦克风此刻真有人声"两件事同时成立才掐：
     *     字幕是滞后 1~3 秒的证据，它只能证明"刚才有人说话"，不能证明"现在该闭嘴"。
     *   ▸ 礼仪没丢：真人当场打断时两条判据同时成立，照旧 130ms 级闭嘴。 */
    if (aiIsSpeaking() && humanTalkingNow()) hushAiSpeech();
    else if (aiIsSpeaking()) voiceTrace.saved++;   // 被"滞后字幕"误掐、这一轮救回来了（修复效果的直接计数）
  }
});

/* ★ 2026-10-04h 页面外通知：切去别的窗口看资料时，AI 的回答经系统通知送到眼前。
 * ▎权限请求搭「AI 语音」开关的便车（用户表达"我要听它说话"的那一下才弹），
 *   拒绝过就永远静默，绝不二次打扰。
 * ▎只通知**终态全文**（chat-message 的 ai-bot 分支；流式增量走 ai-stream 会刷屏）；
 *   页面在前台时不通知（用户正看着，通知是打断）。tag='ai-answer' 让同类通知覆盖而不是堆叠。 */
function notifyAiAnswer(text) {
  try {
    if (!document.hidden) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification('AI 小明', { body: String(text || '').replace(/\*\*/g, '').slice(0, 140), tag: 'ai-answer', silent: true });
    n.onclick = () => { try { window.focus(); n.close(); } catch (e) { /* 已关 */ } };
  } catch (e) { /* 通知失败绝不影响聊天 */ }
}

socket.on('chat-message', ({ from, text, ts, msgId, name, ai, streamId, tts }) => {
  // ★ D+1：同一条消息可能从 SCTP 和信令各到一次，msgId 相同的只显示第一条
  if (msgId && seenChatIds.has(msgId)) return;
  if (msgId) markSeenChatId(msgId);
  if (from === 'ai-bot' && !/大家好，我是会议 AI 助理|已接入.*正在聆听/.test(String(text || ''))) {
    notifyAiAnswer(text);   // ★ 页面在后台时用系统通知提醒（终态全文；入会致辞不打扰）
  }
  /* ★ 09-25：语音播报放在**去重判断之前**——因为流式回答的终态会在下一行被 early-return
   *   丢掉（增量已渲染过），若把播报放在 appendChat 里，流式答案就永远不会被念出来。
   *   这类"顺序错了功能静默失效"的坑，只能靠把它写在注释里记住。 */
  if (from === 'ai-bot') {
    /* ★ 2026-10-01 服务端语音标记：服务器带了 tts:'server' = 它会送音频（Qwen 本地/Edge），
     *   本地 TTS 让位（防双声）；若服务器合成失败会补发 ai-tts-fail {ts} → 再回落浏览器朗读。
     * ★ 2026-10-06 挂账的同时装一根**客户端自己的保险丝**：上面那句"服务器会补发"是
     *   一整条兜底的唯一依赖，而它依赖服务器跑到流水线收尾——抛错或信令丢失时没人补发，
     *   这条答案就永久无声（正是用户报的"回答的时候不说话"）。详见 fallBackToBrowserTts。 */
    if (tts === 'server' && !playedServerTts.has(ts)) {
      pendingServerTts.set(ts, text);
      armServerTtsBackstop(ts);
    }
    else if (tts === 'server') { /* 流水线抢跑：这段音频已经播过了，不再挂回落账 */ }
    else {
      /* ★ 2026-10-02 流式答案已经按句念过一部分 → 这里只补剩下的尾巴。
       *   判据用"前缀真的对得上"而不是长度：对不上（服务器改了措辞/带了标记）
       *   就退回整段重念——**宁可重复一句，也不能漏掉后半段没声音**。 */
      const spoken = streamId ? streamSpokenRaw.get(streamId) : '';
      if (streamId) streamSpokenRaw.delete(streamId);
      if (spoken && String(text).startsWith(spoken)) {
        const rest = String(text).slice(spoken.length);
        /* 终态只补念剩下的尾巴时**不再换轮次锚点**（replace:false）：
           这一轮的延迟已经在第一句 onstart 时量过了，拿尾巴再量一次会得到一个偏大的数，
           那个数混进了"LLM 写完剩下几句的时间"，不再是"嘴"的延迟。 */
        if (rest.trim()) enqueueAiSpeech(speakableText(rest), { replace: false });
      } else {
        speakAiText(text, { answerTs: ts });
      }
    }
    maybeHintAiVoice(); // ★ 09-28：语音没开时提示一次"可以听它说话"（对话闭环的手感所在）
  }
  // ★ 09-24：带 streamId 的是流式回答的"终态"——增量已经在同一个气泡里渲染过了，
  //   这里再插一条就是两遍。（终态仍然必要：给中途进房/丢过流事件的人兜底）
  if (streamId && aiStreamDone.has(streamId)) return;
  const node = appendChat(text, from, from === socket.id, 'signaling', name, ai);
  /* ★ 2026-10-03 登记"这条答案的文字到齐了"，等第一段音频真的播起来时相减。
   * ▎为什么锚在 chat-message 而不是 ai-stream 首字：那条链路的等待恰恰发生在
   *   "文字已经写完 → 声音才出来"之间（合成 + 上架 + 取回），
   *   而首字时刻混进了 LLM 的生成速度，量出来就不是"嘴"的延迟了。
   * ▎窗口只留最近 30 条（长会里不会有人回头看很久的答案的朗读延迟）。 */
  /* ★ 2026-10-03 登记"这条答案的文字到齐了"，等第一段声音真的播起来时相减。
   * ▎为什么两种 tts 都登记（原先只登记服务端那条）：**今天实际听到的几乎全是浏览器朗读**，
   *   只量服务端等于给一条平时不跑的路装表，而用户真正等的那条仍然没有数。
   *   我在报告里写过"浏览器朗读几乎即时"——那是没量过的假设，现在去量它。
   * ▎为什么锚在 chat-message 而不是 ai-stream 首字：那条链路的等待恰恰发生在
   *   "文字已经写完 → 声音才出来"之间（合成 + 上架 + 取回 + 排队），
   *   而首字时刻混进了 LLM 的生成速度，量出来就不是"嘴"的延迟了。
   * ▎窗口只留最近 30 条（长会里不会有人回头看很久的答案的朗读延迟）。 */
  if (from === 'ai-bot' && node && typeof ts === 'number' && !voiceAnswerAt.has(ts)) {
    voiceAnswerAt.set(ts, { at: Date.now(), node });
    if (voiceAnswerAt.size > 30) voiceAnswerAt.delete(voiceAnswerAt.keys().next().value);
  }
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
/* ★ 2026-10-02 streamId -> 本轮已经用浏览器念出去的原文前缀。
   流式答案的字是一句一句念的，终态那条 chat-message 若再整段朗读就成了双声；
   拿这个前缀一比，只补念剩下的尾巴（前缀对不上则退回整段——宁重不漏）。 */
const streamSpokenRaw = new Map();
const streamHits = new Map();      // ★ 09-25 streamId -> 待补的"证据原话"列表（同上）

/* ★ 09-30：流式增量的**按帧批量刷新**（详见 ai-stream delta 分支的注释）。
 * ▎用 Map 存 rAF id 而不是一个全局变量：理论上可以有多个流同时在跑
 *   （一般不会，但用全局变量一旦并发就会互相取消、表现为"某个答案少字"，
 *   这类 bug 极难复现——从一开始就按 id 隔离，代价只是多一个 Map）。 */
const streamFlushRaf = new Map();  // streamId -> rAF id
function scheduleStreamFlush(id, box) {
  if (streamFlushRaf.has(id)) return;          // 本帧已排过队，继续攒批
  streamFlushRaf.set(id, requestAnimationFrame(() => {
    streamFlushRaf.delete(id);
    applyStreamBuf(box);
  }));
}
/** 立即刷新（done 收尾用：不能让最后几个字卡在缓冲里） */
function flushStreamNow(id, box) {
  const raf = streamFlushRaf.get(id);
  if (raf) { try { cancelAnimationFrame(raf); } catch (e) { /* 无头桩可能没有 */ } streamFlushRaf.delete(id); }
  applyStreamBuf(box);
}
function applyStreamBuf(box) {
  if (!box || !box.buf) return;
  box.textEl.classList.remove('typing');
  box.textEl.textContent += box.buf;   // textContent 而非 innerHTML：增量是远程文本，天然免疫 XSS
  box.buf = '';
  chatList.scrollTop = chatList.scrollHeight;   // 与文本写在**同一帧**，只触发一次布局
}

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
    nameEl.innerHTML = ICONS.bot + `<span>${escapeHtml(aiBotName())}</span><span class="msg-via">AI</span>`;
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
    /* ★ 2026-10-04 把 streamId 一起挂在 box 上：`speakStreamPart(box, …)` 里要用它做
     *   朗读的"轮次锚点"，而那里没有 id 这个变量 —— 真浏览器控制台抓到三次
     *   `ReferenceError: id is not defined`（流式答案每切出一整句就抛一次，
     *   而抛在 try 之外的话整条朗读就断了）。见 npm run check:console。 */
    box = { node, nameEl, textEl, timeEl, id };
    aiStreamNodes.set(id, box);
    /* ★ 2026-10-03 流式答案的延迟锚点登记在**气泡创建那一刻**。
     * ▎为什么不能沿用 chat-message 那次登记：流式终态会在前面就被 early-return
     *   （增量已经渲染过，不再插第二条气泡），所以那条路上永远拿不到 node，
     *   读数就只会出现在"非流式"的少数场景里 —— 而**语音问答的答案基本都是流式的**。
     *   ▸ key 用 streamId 而不是 ts：Map 只做内部配对，两种 key 不会互相影响；
     *     服务端 MP3 那条仍然按 ts 配对（ai-audio 带的是 ts），口径不变。
     *   ▸ 起点选"气泡出现（第一个字上屏）"，与"文字到齐"同样是**嘴之前的最后一个用户可见点**。 */
    voiceAnswerAt.set(id, { at: Date.now(), node });
    if (voiceAnswerAt.size > 30) voiceAnswerAt.delete(voiceAnswerAt.keys().next().value);
  }
  if (delta) {
    /* ★ 2026-10-02 流式答案的按句朗读要一份**不被消费的全文副本**（rawAll）。
     *   下面那个 box.buf 是给 DOM 攒批用的，applyStreamBuf 刷完就把它清空了
     *   ——拿它找"整句"永远只能看到一帧内的三五个字，句子内根本不可能出现句末标点，
     *   于是这条朗读通路会静默地一事无成（症状：改了个看起来完全正确的函数，
     *   但它读的是别人正在消费的那个缓冲区）。 **攒批的缓冲与记账的账本分开。** */
    box.rawAll = (box.rawAll || '') + delta;
    /* ★ 09-30 丝滑度修复：增量**按帧批量刷**，不再每来一个字就写一次 DOM。
     *   ▎为什么（这是"AI 打字卡"的主因，不是模型慢）：
     *     改造前每个 delta 都执行
     *       `textContent += delta` 然后 `chatList.scrollTop = chatList.scrollHeight`。
     *     **读 `scrollHeight` 会强制同步布局**（forced reflow）——因为它要求浏览器
     *     立刻算完刚刚被改动的文本的最终尺寸。于是一条 200 字的答案 =
     *     **200 次强制 reflow**，主线程被打断 200 次，打字观感就是"一顿一顿的"。
     *   ▎为什么合并到 rAF：一帧内的多个 delta 合成一次 DOM 写入 + 一次 scrollTop，
     *     reflow 次数从"每 token 一次"降到"每帧至多一次"（≈60/s 上限，且通常远低于）。
     *     逐字**视觉上依旧连续**（人眼分辨不出 16ms 内的攒批），但主线程不再被打断。
     *   ▎为什么把 scrollTop 也挪进 flush：它和 textContent 写在同一个帧里，
     *     浏览器只需在帧末算一次布局，而不是每写一个 token 算一次。 */
    box.buf = (box.buf || '') + delta;
    scheduleStreamFlush(id, box);
    /* ★ 2026-10-02 按句上嘴：流里一出现完整的一句就立刻念，不等整段写完。
       （文字仍在 rAF 里攒批刷，两处各管各的节奏，互不拖累。） */
    speakStreamPart(box, box.rawAll);
  }
  if (done) {
    flushStreamNow(id, box);   // ★ 09-30：先把握在缓冲里的字刷出去，否则末尾会少一截
    /* 记下"这一轮已经用浏览器念到哪儿了"，终态 chat-message 只补念剩下的尾巴，
       不再整段重念（那是双声；不记则是"念了两遍同一句"）。 */
    if (box.spokenRaw) streamSpokenRaw.set(id, box.spokenRaw);
    while (streamSpokenRaw.size > 40) streamSpokenRaw.delete(streamSpokenRaw.keys().next().value);
    box.node.classList.remove('streaming');
    const mode = mock ? 'Mock' : 'LLM';
    box.nameEl.innerHTML += `<span class="msg-ai-mode${mock ? ' mock' : ''}" title="这条答案由${mock ? '本地规则（未接 LLM）' : 'DeepSeek 模型'}生成">${mode}</span>`;
    /* ★ 09-24e：流式终态也把"检索过程"补上（增量渲染时还不知道这些元信息，
     *   服务器在 done 帧里一起送来）。注意 trace 挂在 bubble 上、**不在 textEl 里**——
     *   因为 textEl 是逐字累加的正文，往里塞 HTML 会破坏打字机与文本一致性。
     * ★ 2026-10-03 顺序改到正文**之后**：原先证据链排在答案上面，用户先看到三枚
     *   "我查了 12 条取 3 条"的小胶囊、才看到答案本身——那是把脚注放在了正文前面。
     *   答案才是这一条气泡的主语，过程是它的注脚（注脚在下，与论文/聊天的读法一致）。 */
    const t = streamTraces.get(id);
    if (t) {
      const traceEl = document.createElement('div');
      traceEl.className = 'msg-ai-trace';
      traceEl.title = 'AI 得出这条答案的中间过程（可验证，非黑箱）';
      traceEl.textContent = t;
      box.node.insertBefore(traceEl, box.timeEl || null);
      streamTraces.delete(id);
      /* ★ 09-25：紧跟着插入"可展开的证据原话"——trace 只说"取了几条"，
       *   details 让用户能真的看到那几条是什么（数字 → 事实）。 */
      const evHtml = traceEvidenceHtml(null, streamHits.get(id));
      if (evHtml) {
        const evEl = document.createElement('div');
        evEl.className = 'msg-ai-ev-wrap';
        evEl.innerHTML = evHtml;
        box.node.insertBefore(evEl, box.timeEl || null);
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
    // ★ 09-27：服务端 ASR 转写同步上字幕条（字幕体验统一：谁说的话都能看见）
    if (text.indexOf('🎙 [转写]') === 0) {
      showCaptionBar('转写', text.slice(('🎙 [转写] ').length), false);
    }
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
    /* ★ 2026-10-03：证据链从"一行带 emoji 的文本"改成**图标胶囊**。
     *   原来 trace.join(' · ') 整串走 escapeHtml，所以想放 SVG 必须换个结构：
     *   每个胶囊自己拼 HTML，**文字部分仍然 escapeHtml**（XSS 纪律不变，坑 7）。 */
    const chips = [];
    if (ai && ai.totalDocs) {
      chips.push({ i: ICONS.book, t: ai.scoped && ai.allDocs > ai.totalDocs
        ? `本场检索 ${ai.totalDocs} 条取 ${ai.hits || 0} 条（全档 ${ai.allDocs}）`
        : `检索 ${ai.totalDocs} 条字幕取 ${ai.hits || 0} 条` });
    }
    if (ai && ai.turns > 1) chips.push({ i: ICONS.bubble, t: `第 ${ai.turns} 轮对话` });
    if (ai && ai.intent && ai.intent !== 'question') {
      /* ★ 2026-10-10：这张表以前缺 `room-action` / `room-undo` 两个键 ⇒ 徽标直接印出内部 id
       *   （真浏览器截图里看到的是「🎯 room-undo」）。**给用户看的界面不许漏服务器内部的枚举名**——
       *   它读起来像坏了，而实际只是没翻译（与坑 82 同族：看不懂的标签等于没说）。
       *   ▸ 兜底仍然留 `|| ai.intent`：将来加新意图忘了配文案时，宁可露原词也不要露空
       *     （露空会让人以为 AI 什么都没理解，比一个英文 id 更误导）。 */
      chips.push({ i: ai.intent === 'chat' ? ICONS.bubble : ICONS.target,
        t: ({ minutes: '生成纪要', recap: '回顾', operator: '远程操作', chat: '直接回答（没查会议记录）',
          'room-action': '替你操作会议', 'room-undo': '撤回刚才那步',
          'room-action-denied': '这条不在我能做的范围' })[ai.intent] || ai.intent });
    }
    if (ai && ai.rewrites) chips.push({ i: ICONS.loop, t: '换过说法再找' });
    const traceHtml = chips.length
      ? `<div class="msg-ai-trace" title="AI 得出这条答案的中间过程（可验证，非黑箱）">${
          chips.map((c) => `<span class="tl-chip">${c.i}<span>${escapeHtml(c.t)}</span></span>`).join('')}</div>`
      : '';
    /* ★ 09-24 C4：纪要链接是 <a href> 导航，浏览器发不出自定义请求头——只能把 roomToken
     *   挂到查询串（服务端 extractRoomToken 已支持 ?roomToken= 这条兜底）。
     *   ai.path 可能已经带查询串，所以判断用 '?' 还是 '&'。文案与 DOM 结构一个字没动。 */
    const minutesHref = (ai && ai.path)
      ? ai.path + (myRoomToken ? (ai.path.includes('?') ? '&' : '?') + 'roomToken=' + encodeURIComponent(myRoomToken) : '')
      : '';
    const link = minutesHref
      ? `<a class="msg-link" href="${escapeHtml(minutesHref)}" target="_blank" rel="noopener">${ICONS.doc}<span>打开纪要</span></a>` : '';
    item.className = 'msg';
    item.classList.add('bot');
    /* 名字前的图标：原先是 emoji 🤖，而服务器发来的 name 也带过一份 🤖 ——
     *   于是界面上出现"两个机器人"（你截图里那个）。现在 name 归服务器（纯文字），
     *   图标归客户端（单色 SVG），一个概念一个来源（坑 47）。 */
    item.dataset.who = 'ai-bot';
    item.innerHTML =
      `<div class="msg-name">${ICONS.bot}<span>${escapeHtml(name || aiBotName())}</span><span class="msg-via" title="AI 会议助理">AI</span>` +
      `<span class="msg-ai-mode${mode === 'Mock' ? ' mock' : ''}" title="这条答案由${mode === 'Mock' ? '本地规则（未接 LLM）' : 'DeepSeek 模型'}生成">${mode}</span>${meta}</div>` +
      `<div class="msg-text">${escapeHtml(text)}${link ? '<br>' + link : ''}</div>` +
      traceHtml +
      traceEvidenceHtml(ai, null) +
      `<div class="msg-time">${new Date().toLocaleTimeString()}</div>`;
  } else {
    item.className = isMe ? 'msg me' : 'msg other';
    // ★ 2026-10-03：路径徽标去 emoji（🛰️ 在暖墨界面里像贴纸）。含义一个字没改：
    //   带 SCTP 标记 = 这条经 SFU 数据通道直达；没有 = 走的信令兜底路。
    const viaIcon = via === 'sctp' ? `<span class="msg-via" title="经 SFU 数据通道（SCTP）直达">${ICONS.sctp}SCTP</span>` : '';
    const who = isMe ? `我${myDisplayName ? ' · ' + myDisplayName : ''}` : (name || `成员 ${shortId(sender)}`);
    item.dataset.who = (isMe ? 'me:' : 'other:') + who;
    item.innerHTML =
      `<div class="msg-name">${escapeHtml(who)}${viaIcon}</div>` +
      `<div class="msg-text">${escapeHtml(text)}</div>` +
      `<div class="msg-time">${new Date().toLocaleTimeString()}</div>`;
  }
  /* ★ 2026-10-03 分组（学 reactbits 的 AnimatedList：一串消息读起来像"一个人在说"）：
   *   与上一条同一个人 → 隐掉名字、收紧间距。判据用 dataset.who（渲染时就写好的同一个字段），
   *   不再去解析 className——那会把"我 vs 别人"和"谁说的"混成一件事。
   *   系统提示不参与分组（它是状态说明）。 */
  const prev = chatList.lastElementChild;
  if (prev && prev.dataset && prev.dataset.who && prev.dataset.who === item.dataset.who) {
    item.classList.add('msg-cont');
  }
  chatList.appendChild(item);
  // ★ 09-25：侧栏分段后聊天可能被切走 → 非当前分段时累计未读角标（否则会漏消息）
  noteChatActivity();
  // ★ 09-19d 架构优化：聊天 DOM 环形上限（300 条）——SCTP 广播语义下长会消息不少，
  //   DOM 节点数是前端内存与重排开销的大头；超限剪最老的（字幕账本另有 jsonl 存档）。
  while (chatList.children.length > 300) chatList.firstChild.remove();
  chatList.scrollTop = chatList.scrollHeight;
  /* ★ 2026-10-03 返回节点：语音播报延迟要在**它自己那条气泡**上落一个读数
   *   （音频可能比气泡晚到好几秒，只能事后按 ts 找回这个节点）。
   *   老调用方都忽略返回值，加这一行不改变任何既有行为。 */
  return item;
}

/* ── C1「AI 远程操作员」的入口判据（2026-10-08 收窄；理由见下面 sendAiQuestion 里那段） ──
 * ▸ 两条各管一半：**提到哪台机器**（电脑/记事本/计算器…）× **要做什么动作**。
 *   为什么不合成一条大正则：把"电脑"和"打开"揉进同一个字面分支，就会退回到
 *   "只看句首动词"的老判据——而那正是这次要修的毛病；而中文两种语序都常见：
 *   「在他电脑上打开记事本」与「打开他电脑上的记事本」。
 * ▸ `AI_OP_EXPLICIT_RE` 留给"就是明说要操作"的说法（「帮我操作」「远程控制」），
 *   它们没提机器，但意图没有别的读法；房间动作表里没有任何一条以这两个词开头。 */
const AI_OP_CTX_RE = /(电脑|桌面|浏览器|网页|记事本|计算器|那台机器|这台机器|对方机器)/;
const AI_OP_VERB_RE = /(操作|控制|打开|点击|双击|单击|输入|敲|按一下|点一下|切到)/;
const AI_OP_EXPLICIT_RE = /^(帮我)?(操作|远程控制|远程)/;

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
  /* ★ 09-19g：@ai 后接「操作/打开/点击…」走 C1 AI 远程操作员（授权卡照弹，与人类同链路）。
   * ▎★ 2026-10-08 这条被**收窄**了，因为它是"AI 操控实体还是不行"的一条真成因：
   *   旧判据是 `^(操作|打开|点击|帮我操作|远程)`——只看句首动词。于是
   *   「@ai 打开白板」「@ai 打开共享文件面板」这类**房间指令**在客户端就被截走，
   *   发成了 ai-op（远程操作别人电脑那条链路），而当时房里并没有被控端，
   *   服务器回一句"先有人共享屏幕并打开「允许远程协助」…"——**白板一个字都没动**，
   *   可这句回话看起来完全正常。用户报的那五次"操控实体不行"里，这是其中一条。
   *   ▸ 为什么以前没人发现：所有测试用的说法恰好都是「把白板打开」「开启实时字幕」
   *     「切到宫格」——没有一个以"打开"开头（坑 106：电池测的是我想到过的说法）。
   *   ▸ 正解 = **按"提到哪台机器"判，不按句首动词判**：只有话里出现电脑/桌面/浏览器
   *     这类"另一台机器的东西"才走操作员链路；房间级开关交给服务器的 ROOM_ACTION_RULES
   *     （它排在 LLM 之前，且与客户端那张动作表一一对应——一个概念一个来源，坑 47）。
   *   ▸ 冒烟里有一条**红线**盯这件事：房间动作的说法清单不许被下面这两条命中。 */
  if (AI_OP_EXPLICIT_RE.test(q) || (AI_OP_CTX_RE.test(q) && AI_OP_VERB_RE.test(q))) {
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
  /* ★ 2026-10-10：五处 `.send(` 收进 sendOnDc 一处（判据只写一次）。
   *   这一处原来有 try/catch，行为本来就对；换过去是为了**下次加第六处时不会再漏守卫**——
   *   复制旁边那段写法的人不会去读注释，而"旁边的写法"有五种就会剩下四种错的（坑 47）。
   *   ▸ 顺手删掉旧代码里那个 `viaSctp`：它被赋值过、**从来没被读过**（聊天气泡的 🛰️
   *     路径徽标是另一处按"这条消息从哪条路到达"决定的）。留着它只会让人以为这里有分支。 */
  sendOnDc(chatDataProducer, msg, '聊天');
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
    `${word} · 丢包${(lossRatio * 100).toFixed(1)}% · 延迟${rttText} · ↑${upKbps} ↓${downKbps}kbps`;
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
  setWbStatus(`成员 ${shortId(requester)} 正在控制你的工作台`);
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
  /* ★ 2026-10-10（B4 反向配对）拉黑这个动作要**看得见**，而且要能撤销。
   *   名单原先只进不出：`blockedPeers.add()` 之后全页面没有任何一处能 `delete()`，
   *   而"我拉黑了 TA"与"TA 现在还在房里、我改主意了"之间没有桥——
   *   唯一的"解除"是刷新整页（连带丢掉这场会的其它一切），那不叫撤销。
   *   ▸ 这里重画一次成员列表，让那颗「解禁」立刻出现（名单是本地状态，服务器不知道，
   *     所以只能由这一侧主动重绘——不重绘就要等下一次 room-state，可能永远不来）。 */
  renderMembers(lastMembers);
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
    const text = `授权剩余 ${Math.ceil(left / 1000)}s`;
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
      setWbStatus(`成员 ${shortId(controllerId)} 正在控制你的工作台`);
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
    `<span class="ctl-status">${ICONS.cursor}<span>正在控制 成员 ${shortId(hostId)}</span></span>` +
    `<span class="ctl-countdown hidden">--</span>` +
    `<span class="ctl-tools">` +
    `<button class="ctl-shot btn" title="把对方屏幕抓成 PNG 下载">${ICONS.shot}<span>截图</span></button>` +
    `<button class="ctl-paste btn" title="把本机剪贴板内容粘贴到对方工作台">${ICONS.clip}<span>粘贴</span></button>` +
    `<button class="ctl-copy btn" title="复制对方工作台里选中的文字到本机剪贴板">${ICONS.doc}<span>复制选中</span></button>` +
    `<button class="ctl-file btn" title="给被控端发文件">${ICONS.inbox}<span>发文件</span></button>` +
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
  setWbStatus('远程协助已开启，等待成员请求控制…');
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
    setWbStatus('远程协助已开启，等待成员请求控制…');
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
/* ★ 2026-10-04 AI 的名字只有一个来源：服务器在 room-state 里投影的那份（默认「AI 小明」）。
 * ▎为什么要抽出来：流式气泡原先写死「AI 助理」，终态气泡用服务器发来的 name，
 *   于是同一轮答案的两条气泡叫两个名字（用户截图里 22:33:07「AI 助理」/ 22:33:09「AI 小明」）。
 *   取不到快照才退回通用称谓「AI 助理」——那是"不知道叫什么"时的诚实兜底，不是第二个来源。 */
function aiBotName() {
  const b = (lastMembers || []).find((m) => m && m.isBot);
  return (b && b.name) || 'AI 助理';
}

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
  /* ★ 2026-10-09 身份牌与治理台入口跟着快照重画：角色（房主/平台管理员/成员）是服务器算的，
   *   本地不判——但"我"这个 id 在不在成员列表里、它带的 role 是什么，只能从这份快照读。
   *   房主迁移（D+4）、被 grant 之后重新登录、退出登录，都会从这里得到修正。 */
  renderAccount();
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
  { key: 'decision', icon: ICONS.target, label: '决定' },
  { key: 'risk', icon: ICONS.alert, label: '风险' },
  { key: 'todo', icon: ICONS.check, label: '行动项' },
  { key: 'topic', icon: ICONS.bubble, label: '议题' },
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
  /* ★ 2026-10-06 看板分区的**错峰入场**（reactbits AnimatedContent 的零依赖移植）。
   *   ▎为什么给它：切到「看板」时那几个分区（决定 / 风险 / 行动项 / 待认领）是"啪"一下
   *     同时出现的，而这块面板的全部作用就是让人**顺着分类往下读**——45ms 一格的上升淡入
   *     把视线牵着走，比一屏齐刷刷的文本块好读（也终于有点像"整理过的东西"）。
   *   ▎为什么只在**切换**这一刻播，而不挂在 renderBoard 上：看板每来一条增量就重画一次列表，
   *     挂在渲染上等于"每说一句新话，整栏抽搐一次"——动效要服务于读，不能服务于吵（坑 79 的兄弟）。
   *   ▸ `--i` 由 DOM 顺序写、CSS 里只有一条 animation-delay 公式：顺序这个概念只有一个来源。
   *   ▸ 先摘类再强制重排：同一栏连着切两次，不重排的话"类加了、动画不重播"
   *     ——那正是本项目里"加了效果但看不见"的老形状（坑 76/78）。 */
  const acView = document.querySelector('.side-view[data-side=' + JSON.stringify(name) + ']');
  if (acView) {
    acView.classList.remove('ac-in');
    acView.querySelectorAll('.board-sec').forEach((el, i) => { el.style.setProperty('--i', String(i)); });
    void acView.offsetWidth;
    acView.classList.add('ac-in');
  }
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
let chatUnreadShown = false;   // 上一次角标是否可见（用来抓"从无到有"那一下）
function renderChatUnread() {
  const el = $('chatUnread');
  if (!el) return;
  el.textContent = String(chatUnread > 99 ? '99+' : chatUnread);
  el.classList.toggle('hidden', !chatUnread);
  /* 第 40 步：未读"从无到有"才弹一下 + 给所在分段按钮响一次环。
   * ▎为什么只在这一刻：连续来 5 条消息时每次都弹，提醒就变成骚扰
   *   （和 BellToggle 的语义一致——环是"状态真的变了"的回执，不是心跳）。 */
  const nowShown = chatUnread > 0;
  if (nowShown && !chatUnreadShown) {
    popBadge(el);
    const tab = el.closest('.side-tab');
    if (tab) ringPulse(tab, { waves: 2 });
  }
  chatUnreadShown = nowShown;
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
        ? `<span class="bi-owner" title="已认领的负责人">${ICONS.person}<span>${escapeHtml(it.owner)}</span></span>` : '';
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
// ★ 09-27d：默认开（用户点名“语音对话”——格子有醒目开关可关；隐私模式默认开，朗读失败静默）
let aiVoiceOn = true;
try { aiVoiceOn = localStorage.getItem('sfuAiVoice') !== '0'; } catch (e) { /* 默认开 */ }
/* ★ 2026-10-05 "听不见声音"的两处静默失败点，现在都有用户可见的出路：
 *   ① 「会说话」关着时 ai-audio 在门口被丢（每个会话提示一次去哪里开）；
 *   ② play() 被自动播放策略拒绝（缓存 + toast + 一次点击恢复）。
 *   ▸ voice-off 提示只弹一次（每会话），开过开关就永不再弹。 */
let aiVoiceHintShown = false;
const blockedTts = [];

const SPEECH_OK = typeof window !== 'undefined' && 'speechSynthesis' in window;

/* ══ 2026-10-03f 播报判据与观测收口（用户实测"听不见声音"的根因处）═══════════
 * ▎三条判据原先散在三处（字幕处理器 / speakAiText 的抢话闸 / 麦克风看门狗），
 *   每处各用各的信号，于是出现"气泡写着 0.1s 后开口、耳朵里什么都没有"这种病。
 * ▎核心事实只有一句：**字幕比真话晚 1~3 秒**（分段 + 转写），
 *   所以"字幕刚到"永远不能当作"此刻有人在说话"。
 *   10-02g 认过这笔账，但只改了 speakAiText 那一处，字幕处理器里那句 hush 还留着：
 *   asrSegmentSec=2 把一句"小明，帮我记一下明天下午三点的评审会"切成三条字幕、
 *   相隔 1~2 秒到达，AI 跟着第一条开始念，第二条到达时用户早已闭嘴 1.5 秒
 *   ——照样被掐，且把整轮 ts 拉黑（同轮后续段全丢）= 这一轮彻底无声。
 * ▎第二个坑是**自回声**：笔记本外放 → 麦克风拾到 AI 自己的声音 → 峰值超阈
 *   → 判"有人在打断" → 掐死自己。所以 AI 正在出声这段时间，麦克风判据要额外
 *   压过"回声本底"（AI 开口后前 160ms 采到的峰值就是这条链路的回声强度），
 *   真人打断必须明显比它响才算数。
 * ▎第三个坑是**看不见**：今天日志里 asr-wake-answer 有 193 条、播报相关埋点 0 条，
 *   "为什么没出声"根本无从判断（坑 76：机制要有触发证据）。voiceTrace 就是那件证据。 */
const voiceTrace = {
  asked: 0,        // 想播报的次数（每一轮答案的第一句算一次）
  started: 0,      // 真的开口的次数（浏览器 onstart / 服务端 onplaying）
  killed: 0,       // 开口之后被掐断的次数
  saved: 0,        // "字幕到了但用户此刻没在说"→ 没让 hush 掐死的次数（本轮修复的直接证据）
  echoFloor: 0,    // 最近一次量到的自回声峰值（0 = 还没量过）
  gated: {},       // 没出声的原因计数：voice-off / no-speech-api / server-yield / empty-text / talking-now
  /* ★ 2026-10-04 「等一轮再说」的触发证据（坑 76 的纪律：新机制必须能证明自己发生过）。
   *   deferred = 因为"此刻有人在说"而改排队的次数；resumed = 排队后真的开口了的次数。
   *   没有这两个数，"它答应了却不说话"和"它在等人说完"在观测上是同一种样子。 */
  deferred: 0,
  resumed: 0,
  /* ★ 2026-10-05 服务端轨的"漏斗计数"——喇叭不出声时必须能说出断在哪一环（坑 76 再记）。
   *   背景：e2e 实测 gated:server-yield=3（已正确让位给服务端轨）而 started=0，
   *   旧计数只能证明"没开口"、说不出"为什么"：是消息没到（srvGot=0）、被掐（srvDrop）、
   *   卡在队列（q>play）、取不到音频（srvErr）、play 被拒（srvRej=自动播放策略）、
   *   还是 play 兑现了但元素从不 onplaying（srvRes>0 而 srvOnp=0=播放链内部停摆）。
   *   漏斗口径：got→skip(voice-off/no-url/no-speech)→drop(被打断的轮)→q(入队)→
   *   play(取出并调 play)→onp(真的出声)/res(play兑现)/rej(被拒)/err(取音频失败)/end(播完)。 */
  srvGot: 0,
  srvSkip: {},
  srvDrop: 0,
  srvQ: 0,
  srvPlay: 0,
  srvOnp: 0,
  srvRes: 0,
  srvRej: 0,
  srvErr: 0,
  srvEnd: 0,
};
function noteVoiceGate(reason) {
  voiceTrace.gated[reason] = (voiceTrace.gated[reason] || 0) + 1;
}

/* ★ 2026-10-04 抢话闸从"直接丢掉这一轮"改成"等一轮"。
 * ▎为什么这是缺陷而不是礼仪：判据本身没错（用户此刻在说就不该插嘴），
 *   错在**处置方式**——原来是 `return`，于是这一轮答案的声音**永远不会再出现**，
 *   气泡上写着答案、嘴上没有声音，正是用户报的"它答应了却不说话"。
 *   而"用户还在说"最常见的场景恰恰是：他问完一句继续补充、或者 2s 分段把一句话
 *   切成三四条字幕陆续到达（e2e 实测就是这样：asked=1 / started=0 / gated.talking-now=1）。
 * ▎改法：等，最多等 AI_TURN_WAIT_MS；等到了就念原话（deferred→resumed），
 *   超时就明说"等太久放弃了"并计入 gated，而不是像现在这样静默消失。
 * ▎"只说最新"仍然成立：每次新的等待都 ++gen，旧的等待链自己作废——
 *   不会出现"用户已经问了第三句，机器还在补第一句的话"。 */
const AI_TURN_WAIT_MS = 6000;
const AI_TURN_POLL_MS = 400;
let speakTurnGen = 0;
function waitForTurnThen(label, run) {
  const gen = ++speakTurnGen;
  const deadline = Date.now() + AI_TURN_WAIT_MS;
  voiceTrace.deferred += 1;
  noteVoiceGate(`talking-now-${label}`);
  const tick = () => {
    if (gen !== speakTurnGen) return;                 // 已经有更新的一轮在等，这一轮作废
    if (!humanTalkingNow()) {
      voiceTrace.resumed += 1;
      try { run(); } catch (e) { /* 播报失败绝不影响会议功能 */ }
      return;
    }
    if (Date.now() >= deadline) { noteVoiceGate(`turn-timeout-${label}`); return; }
    setTimeout(tick, AI_TURN_POLL_MS);
  };
  setTimeout(tick, AI_TURN_POLL_MS);
}

/* AI 此刻真的在出声吗（浏览器朗读与服务端音频两条轨都算）。 */
function aiIsSpeaking() {
  try {
    const ss = window.speechSynthesis;
    if (ss && (ss.speaking || ss.pending)) return true;
  } catch (e) { /* 无头桩环境没有这两个 getter */ }
  return !!serverTtsBusy;
}

/* 真人**此刻**在说话吗。只认麦克风的即时信号（≈130ms 粒度）；
 * 没有麦克风可量时（拒绝授权 / 无设备 / 别人用另一台设备在说）才退回字幕那条滞后判据。 */
function humanTalkingNow() {
  if (aiHush.analyser) return Date.now() - lastMicVoiceTs < 300;
  return Date.now() - lastUserSpeechTs < 700;
}
if (typeof window !== 'undefined') {
  try { window.__SFU_AI_VOICE__ = voiceTrace; } catch (e) { /* 桩环境不能挂全局就算了 */ }
}

/* 把 markdown 洗成"能念的句子"。
 * ▎必须洗：AI 的文本里有 `**加粗**`、`@ai`、`/minutes/xxx.md`、表格竖线等，
 *   直接念会变成"星号星号加粗星号星号""斜杠 minutes 斜杠…"，非常刺耳。
 *   这也是"给机器读的文本"和"给人听的文本"必须分开处理的典型案例。 */
function speakableText(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, '（代码块）')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')          // markdown 链接：留名字，去地址
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/^[#>\-\s|]+/gm, '')
    .replace(/\|/g, '，')
    .replace(/https?:\/\/\S+/g, '（链接）')
    .replace(/\/minutes\/\S+/g, '（纪要文件）')
    /* ★ 2026-10-05 夜（用户点名"纪要那个长名字就不说了，费时间"）：
     *   路径类整段换成"（文件）"、markdown 链接只留名字。与 sfu/ai/tts.js 的
     *   speakable 同一套规则（两个运行时两份实现，由 test:asr 拿同一条样例
     *   断言"两边都不会把路径念出来"）。 */
    .replace(/(?:[.\/\\][\w.\-\/\\]{6,})/g, '（文件）')
    .replace(/@ai/gi, 'A I')
    .replace(/[📚💬🎯📌⚠️✅👋📋🌙🏁🛰️🔈🤖]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);   // 太长的答案念不完会妨碍开会，截断
}

/* ★ 09-28：AI 说话但"语音"没开时，提示一次怎么听（对话闭环的手感所在）。
 *   只提示一次（每次会话），避免变成骚扰；语音已开/浏览器不支持则完全不提。 */
let aiVoiceHinted = false;
function maybeHintAiVoice() {
  if (aiVoiceOn || !SPEECH_OK || aiVoiceHinted) return;
  aiVoiceHinted = true;
  showToast('🔈 想直接"听"小明说话？点控制坞的「AI 语音」开关即可（浏览器语音合成，零依赖）');
}

function speakAiText(text, { force = false, answerTs } = {}) {
  voiceTrace.asked++;
  if (!aiVoiceOn) { noteVoiceGate('voice-off'); return; }
  if (!SPEECH_OK) { noteVoiceGate('no-speech-api'); return; }
  /* ★ 09-30c 双轨闸：服务端神经语音可用时，AI 的声音走服务器 MP3（ai-audio 事件），
   *   本地 speechSynthesis 整体让位——避免"同一条答案两个声音先后读"的灾难。
   * ★ 2026-10-02 实修（用户实测"后边它回答没有说话"的第一条真死锁）：
   *   这道闸原先**无条件**生效，把 ai-tts-fail 的回落路径也一起挡死了。链路是这样断的：
   *     服务器声明 tts:'server'（"这条答案我会送音频"）→ 客户端让位不念
   *     → 服务器合成失败，补发 ai-tts-fail 让客户端"回落浏览器朗读"
   *     → 客户端调用 speakAiText → 又被这同一道 `aiTtsEnabled` 闸 return
   *     → **MP3 没来、浏览器也不念，而且永久如此**（aiTtsEnabled 只在进房那次读
   *        /config.json 就再也不刷新，Edge 端点可达性是会漂的）。
   *   加 force 参数：只有"确认服务端这条已经失败"的回落调用能绕过让位闸。 */
  if (aiTtsEnabled && !force) { noteVoiceGate('server-yield'); return; }
  const say = speakableText(text);
  if (!say) { noteVoiceGate('empty-text'); return; }
  /* ★ 09-30 → 2026-10-02 抢话闸的判据换掉：原来用"2.5s 内到过字幕"，
   *   但字幕比真话晚 1~3 秒才到（分段+转写），于是"用户刚说完、AI 刚答完"这个
   *   最常见的时刻整轮落在闸内 → **AI 永远不开口**（用户："我要的是不乱说话，不是不说话"）。
   *   ▎再修一次（同一天）：连 700ms 的字幕兜底也不能常开。理由很简单——
   *   **"字幕刚到"说明的是"1~3 秒前有人在说话"，不是"此刻有人在说话"**；
   *   而答案恰恰总是紧跟在自己的字幕后面 1~3 秒到达，等于每轮都撞进闸里。
   *   真正需要的"此刻在说"信号只有麦克风（即时、130ms 就能确认）。
   *   字幕那条只保留给"根本没有麦克风可量"的场景（aiHush.analyser 为空：
   *   拒绝授权/无设备/同房间另一台设备在说话），此时它是唯一的证据来源。
   *   ▸ 礼仪并没有丢：用户真在说话时，麦克风闸当场拦；字幕迟到时，
   *     asr-caption 处理器里的 hushAiSpeech() 会把已经念出来的掐断——两条都还在。 */
  /* ★ 2026-10-04 这里原来是 `if (humanTalkingNow()) return;` —— 判据对、处置错：
   *   直接 return 等于把这一轮答案的声音**永久丢掉**，而"用户还在说"最常见的场景
   *   恰恰是 2s 分段把一句话切成三四条字幕陆续到达（e2e 实测 asked=1/started=0/gated.talking-now=1）。
   *   现在改成等一轮（最多 6s），等不到才认输并计数——见 waitForTurnThen 的注释。 */
  const speakNow = () => {
    try {
      /* ★ 09-26e 语音去 AI 味——三层优化：
       *  ① 音色策略：自然神经音色优先（Online (Natural) / Premium / 常见自然音色名）——
       *     它们与老式 SAPI 音色的差距就是“AI 味”与“真人味”的差距；
       *  ② 分句队列：按句末标点切段排队朗读，句间自然停顿、语调重新起势，
       *     接近真人节奏；新回答到来 cancel+清队列，“只说最新”语义不变；
       *  ③ 参数：rate 1.02（自然音色语速快，过快吞字）、pitch 1.05 略亮。 */
      enqueueAiSpeech(say, { replace: true, answerTs });
    } catch (e) { /* 播报失败绝不影响会议功能 */ }
  };
  if (humanTalkingNow()) { waitForTurnThen('answer', speakNow); return; }
  speakNow();
}

/* ★ 2026-10-02 把"切句 + 排队 + 逐句念"从 speakAiText 里抽出来，因为来了第二个用户：
 *   **流式答案的朗读不该等整段写完**。ai-stream 每 12 字就吐一次增量，
 *   原先这些增量只进气泡不上嘴，一定要等终态 chat-message 才开口——
 *   一句长答案 LLM 要写 3~8 秒，用户听到的"它答应了却半天没声"就是这么攒出来的。
 *   现在：流里一出现"完整的一句"就立刻念这一句，LLM 写第 2、3 句的时间被第 1 句的
 *   朗读盖住（服务器上那套 makeSpeakPipeline 是同一个思路，搬到浏览器这一轨）。
 * ▎replace=true：新一轮答案（清队列、掐掉正在念的）；false：同一轮的后半句，
 *   **接在队列尾巴后面**（绝不能 cancel，否则自己把自己的上一句掐了）。 */
function enqueueAiSpeech(say, { replace = true, answerTs } = {}) {
  /* ★ 2026-10-03 浏览器朗读也要有延迟读数（第 38 步的后半）。
   * ▎为什么要补：播报读数原先**只在服务端 MP3 那条路上出现**，
   *   而今天真实听到的几乎全是浏览器 speechSynthesis（Edge 端点 403、本地音色不抢实时）。
   *   我在报告里写过"浏览器朗读几乎即时"——那是**一个从没量过的假设**。
   *   量法与服务端那条同一条纪律：起点=答案文字到齐（answerTs 那一轮），
   *   终点=**u.onstart**（真的开始发音），不是"我 speak 了"。
   * ▎replace=true 才换轮次锚点：一轮答案被切成多句，只有第一句的等待是"用户感知的延迟"，
   *   后面几句是连着念的，量出来会偏小且没有意义。
   * ▸ ★ 2026-10-04 实修：这里的判据原先写死 `typeof answerTs === 'number'`，而**流式那一轨
   *   传的是 streamId（字符串）**——于是语音问答的答案（基本都是流式的）永远登记不上锚点，
   *   播报读数只在少数非流式场景里出现，/metrics 长期少一整类样本。
   *   这是坑 56 的又一个形状：内层（speakStreamPart 把 id 传出来了）与外层（这里按 ts 的类型判）
   *   对"这个 key 长什么样"的假设不一致。判据应当是"能不能当配对用的键"，不是"是不是数字"。
   *   （不能改成"查 voiceAnswerAt 里有没有"：非流式那一轨 speakAiText 跑在登记锚点**之前**，
   *     见 chat-message 处理器里 1631 与 1653 两行的顺序——那条路会当场失读。） */
  if (replace && (typeof answerTs === 'number' || typeof answerTs === 'string')) aiSpeakRoundTs = answerTs;
  const sentences = String(say || '').split(/(?<=[。！？!?；;])/).reduce((acc, seg) => {
    if (!seg) return acc;
    if (acc.length && (acc[acc.length - 1] + seg).length < 6) acc[acc.length - 1] += seg;
    else acc.push(seg);
    return acc;
  }, []).filter((x) => x.trim());
  if (!sentences.length) return;
  if (replace) {
    /* ★ 2026-10-02 关键一处：cancel() 只能让"再也听不见"，**不能让"再也不念"**——
     *   已经交给 speechSynthesis 的那句会走 onerror(canceled) 而不是 onend；
     *   若先 push 新句子再 cancel，那条错误回调会把**刚排好的新队列整个倒空**
     *   （症状：第一轮问候语念完之后，AI 就再也不会出声了）。
     *   顺序必须是：cancel → 清队列/断泵 → 再 push。泵断链后下一次
     *   startAiSpeakPump 会重新起一条，不去等那条注定不再来的 onend。 */
    window.speechSynthesis.cancel();
    aiSpeakQueue.length = 0;
    aiSpeakPumping = false;
    aiSpeakDeadline = Date.now() + Math.max(20000, say.length * 400);
  } else {
    /* 追加时只把"超时保险丝"往后接，不动正在念的那句 */
    aiSpeakDeadline = Math.max(aiSpeakDeadline, Date.now() + 8000 + say.length * 400);
  }
  aiSpeakQueue.push(...sentences);
  startAiSpeakPump();
}

/* 泵按"代"作废：新一轮答案 cancel+重排后，旧泵闭包的回调（尤其 onerror）
   还可能迟到到达，让它看一眼代号为不对就静默退出，而不是去动新队列/新标志。 */
let aiSpeakGen = 0;
let aiSpeakRoundTs;   // ★ 2026-10-03 本轮答案"文字到齐"的时刻（浏览器朗读延迟读数的起点）
function startAiSpeakPump() {
  if (aiSpeakPumping) return;
  aiSpeakPumping = true;
  const gen = ++aiSpeakGen;
  const voice = pickAiVoice();
  const speakNext = () => {
    if (gen !== aiSpeakGen) return;              // 老泵：已被取代，什么都别动
    if (!aiSpeakQueue.length) { aiSpeakPumping = false; return; }
    const part = aiSpeakQueue.shift();
    if (Date.now() > aiSpeakDeadline) { aiSpeakQueue.length = 0; aiSpeakPumping = false; return; }
    const u = new SpeechSynthesisUtterance(part);
    u.lang = 'zh-CN';
    u.rate = 1.02;
    u.pitch = 1.05;
    if (voice) u.voice = voice;
    /* ★ 2026-10-03 第一轮发音开始时量一次延迟，之后本内不再重复记
     *   （aiSpeakRoundTs 置空 = 一句答案只落一个读数，与服务端那条 onplaying 同口径）。
     *   ★ 2026-10-04 判据与 enqueueAiSpeech 同步放宽（streamId 是字符串，见那里的实修注释）。 */
    if (aiSpeakRoundTs !== undefined && aiSpeakRoundTs !== null) {
      const roundTs = aiSpeakRoundTs;
      u.onstart = () => {
        if (gen !== aiSpeakGen) return;
        aiSpeakRoundTs = undefined;
        voiceTrace.started++;   // ★ 真的出声（浏览器轨）——onstart 才是"开口"，不是"speak 了"
        noteVoiceLatency(roundTs);
      };
    }
    u.onboundary = () => aiFacePulse();   // ★ 2026-10-04i 头像随朗读词边界起伏
    u.onend = () => setTimeout(speakNext, 120); // 句间自然停顿
    u.onerror = () => setTimeout(speakNext, 120); // 被 cancel 也会走这儿：靠代号判断该不该继续
    window.speechSynthesis.speak(u);
  };
  speakNext();
}

/* 自然神经音色优先（挑一次就够：音色表在页面生命周期内基本不变） */
let aiSpeakVoice;
function pickAiVoice() {
  if (aiSpeakVoice !== undefined) return aiSpeakVoice;
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
      if (hit) { aiSpeakVoice = hit; return hit; }
    }
    aiSpeakVoice = zh[0] || null;
  } catch (e) { aiSpeakVoice = null; }
  return aiSpeakVoice;
}

/* ★ 2026-10-02 流式答案的"按句追念"：气泡里刚出现的那一句立刻上嘴。
 *   box.spokenChars 记账"已经交出去念到哪儿了"，只在**真的排进队列之后**才推进
 *   （若被抢话闸拦下，位置不动，终态那条会补念——宁多念一次也不漏）。 */
function speakStreamPart(box, rawBuf) {
  if (!aiVoiceOn || !SPEECH_OK || aiTtsEnabled) return;   // 服务端那一轨在，就不该双声
  let cut = 0;
  for (let i = 0; i < rawBuf.length; i++) {
    const c = rawBuf[i];
    if (c === '。' || c === '！' || c === '？' || c === '!' || c === '?' || c === '；' || c === ';') cut = i + 1;
  }
  const from = box.spokenChars || 0;
  if (cut - from < 6) return;                              // 太短的碎句不单独念（听着像结巴）
  const firstOfThisAnswer = !box.spokeFirst;
  if (firstOfThisAnswer) {
    /* 流式这一轨"此刻有人在说"就**先不抢**，但这一句并没有被丢掉：
       终态 chat-message 会带着整段答案走 speakAiText → 那条路会 waitForTurnThen 排队等。
       所以这里是"让位"而不是"丢弃"，计数名字要如实区分开（否则查"为什么没出声"时
       两处都叫 talking-now，就会误以为流式这一轨也在永久丢）。 */
    if (humanTalkingNow()) { noteVoiceGate('talking-now-stream-yield'); return; }
  }
  const say = speakableText(rawBuf.slice(from, cut));
  if (!say) { box.spokenChars = cut; return; }
  /* ★ 2026-10-02 **一轮答案的第一句要"只说最新"**（replace:true），后面的句子才是追加。
   *   这条是真浏览器实测逼出来的：AI 入会那条自我介绍有四五行，它把朗读队列占满，
   *   我提问的答案只能排在它后面——**文字 2.6s 就上屏、声音 8.1s 才轮到**
   *   （用户说的"它半天不出声"里，有一种不是 bug 的慢，就是这种排队）。
   *   语义上也站得住：答案开始往外流 = 用户刚问了话，此刻还排在队里的旧寒暄就是过期内容。
   *   另：spokeFirst 只在**真的排进队列之后**才置位——若第一句被抢话闸拦下，
   *   下一句仍按"本轮第一句"处理（否则会出现"整轮都在往后追加、却从没人清过旧队列"）。 */
  enqueueAiSpeech(say, { replace: firstOfThisAnswer, answerTs: box.id });
  box.spokeFirst = true;
  box.spokenChars = cut;   // ★ 必须推进：不推进就等于每来一个增量都把同一句重新念一遍
  if (!box.spokenRaw) box.spokenRaw = '';
  box.spokenRaw += rawBuf.slice(from, cut);
}
let aiSpeakQueue = [];   // 分句朗读队列
let aiSpeakDeadline = 0; // 本轮朗读截止时刻（超时保护）
let aiSpeakPumping = false; // ★ 2026-10-02 泵只跑一个（流式追加时防两条链抢同一队列）
let lastUserSpeechTs = 0; // ★ 09-30：最近一次字幕到达的时刻（滞后信号，只作兜底）
let lastMicVoiceTs = 0;   // ★ 2026-10-02：最近一次麦克风真出声的时刻（即时信号，看门狗维护）
let aiTtsEnabled = false; // ★ 09-30c：服务端神经语音可用（/config.json 下发）
let serverTtsEl = null;   // 播放服务端 MP3 的 <audio>（复用，hush 时暂停它）
const pendingServerTts = new Map(); // ★ 2026-10-01：ts → 文本（服务端语音待送达/失败的回落账本）
/* ★ 2026-10-03 播报延迟账本：ts → { 文字到齐时刻, 那条气泡的 DOM 节点 }。
 *   音频真的开始播时用它算出"你看见答案 → 你听见它"这段等待，读数贴在气泡自己身上。
 *   ▸ 为什么要 DOM 节点：语音比文字晚到几秒是常态，事后没有节点就无处可贴。
 *   ▸ 声明在本文件后段没问题——这里全是事件回调里才执行的代码（顶层不读它，不会撞 TDZ）。 */
const voiceAnswerAt = new Map();
/* 播报延迟的滚动窗口（值守日报吃这个）：{ ts, ms }，只留最近 60 条 */
const aiVoiceLats = [];
/* ★ 2026-10-02 语音流水线带来一个新的时序：第一句的音频可能**比 chat-message 先到**
 * （LLM 刚吐完第一句就去合成了）。这时 pendingServerTts 里还没有这条 ts，等气泡到达时
 * 再塞进去就成了一条"永远不会被销掉"的账——万一之后来了 ai-tts-fail，会把已经念过的
 * 答案再念一遍。所以记下"这些 ts 真的播过"，气泡到达时不再为它们挂回落账。 */
const playedServerTts = new Set();

/* ★ 09-30c 服务端神经语音：服务器合成 MP3 后广播 ai-audio，这里负责播。
 * ▎为什么客户端不做合成：音色在服务器端统一（晓晓），用户机器装了什么音色不再重要；
 *   浏览器只当"扬声器"——一个 <audio> 元素，零额外依赖。
 * ★ 2026-10-02 改成**顺序播放队列**（修掉两条"后来不出声"的死锁）：
 *   ① 原实现每次收到 ai-audio 就 `pendingServerTts.delete(ts)`（**在 play() 之前**），
 *      然后 `play().catch(() => {})` 把失败吞掉——于是"音频 404 / 被自动播放策略拒绝"
 *      这一类情况既没声音、回落账本又已经被销掉 = 这条答案**永久无声**；
 *   ② 服务器现在按句流水线分段发（一段合成完立刻发一段），last-wins 的单 <audio>
 *      会把前一段掐掉 → 必须排队，否则用户永远只听到最后一句的尾巴。
 *   ▸ 销账时机改成"真的开始播了"（onplaying）；onerror 才走浏览器朗读兜底。
 *   ▸ hush（用户开口打断）会连队列一起清——被打断的答案不该在后面又自己响起来。 */
const serverTtsQueue = [];
let serverTtsBusy = false;
/* ★ 2026-10-02 打断要"认人"，不能"认时间"——本文件里第二个静音死锁就出在这儿：
 *   原先 hush 之后开一个 8 秒静默窗，窗内到达的段一律丢弃。但语音对话的真实时序是
 *   「用户说完 → 字幕到达（hush，开窗）→ 1.5~6s 后**这条问题的答案**合成完送到」，
 *   答案永远落在自己开的窗里 → 被丢弃，且顺手把 pendingServerTts 的回落账本也销了
 *   = 这一轮**既没有服务端声音、也没有浏览器兜底**（用户实测："回答的时候不说话"）。
 *   正解：记下"被打断的那一轮答案"的 ts，只丢**它**的后续段（同一轮流水线分段共用 ts），
 *   新一轮答案是新的 ts，天然放行。不用时间窗 = 不依赖两端时钟对齐。 */
const serverTtsDropped = new Set(); // 被打断那一轮的 ts 集合（同 ts 的后到段一律不念）
let serverTtsPlayingTs;             // 当前正在播的段属于哪一轮答案
let serverTtsIgnoreUntil = 0;       // 兜底：段没带 ts 时才退回时间窗判据
function playNextServerTts() {
  if (serverTtsBusy) return;
  const item = serverTtsQueue.shift();
  if (!item) return;
  if (!serverTtsEl) serverTtsEl = new Audio();
  serverTtsBusy = true;
  voiceTrace.srvPlay++;  // ★ 2026-10-05 漏斗第 5 环：从队列取出并即将调 play()
  serverTtsPlayingTs = typeof item.ts === 'number' ? item.ts : undefined;
  serverTtsEl.onplaying = () => {
    aiTtsFailStreak = 0; // 播出来了 = 这条链是通的，失败计数归零
    attachAiFaceAudio(serverTtsEl);   // ★ 2026-10-04i 头像随 TTS 音量律动
    voiceTrace.started++; // ★ 真的出声（服务端轨）
    voiceTrace.srvOnp++;  // ★ 2026-10-05 漏斗第 6 环：真的出声
    if (typeof item.ts === 'number') {
      pendingServerTts.delete(item.ts);
      playedServerTts.add(item.ts);                  // 这条答案已经出声了
      if (playedServerTts.size > 60) playedServerTts.delete(playedServerTts.values().next().value);
      noteVoiceLatency(item.ts);                     // ★ 2026-10-03 "文字到齐 → 真的开口"实测
    }
  };
  serverTtsEl.onended = () => { serverTtsBusy = false; serverTtsPlayingTs = undefined; voiceTrace.srvEnd++; playNextServerTts(); };
  serverTtsEl.onerror = () => {
    serverTtsBusy = false;
    serverTtsPlayingTs = undefined;
    voiceTrace.srvErr++;  // ★ 2026-10-05 漏斗：音频取不到（404/解码失败）
    const t = typeof item.ts === 'number' ? pendingServerTts.get(item.ts) : undefined;
    if (t) {
      pendingServerTts.delete(item.ts);
      speakAiText(t, { force: true, answerTs: item.ts }); // 音频取不到 → 自己念，延迟仍记在这一轮上
    }
    playNextServerTts();
  };
  try {
    serverTtsEl.src = item.url;
    serverTtsEl.play().then(() => {
      voiceTrace.srvRes++;  // ★ 2026-10-05 play() 兑现 ≠ 出声（出声看 srvOnp）
    }).catch(() => {
      /* 自动播放策略拦截：浏览器朗读同样需要用户手势，这里**不回落**（否则用户一点
       * 就两个声音叠上来）。★ 2026-10-05 之前这里是"静默丢弃"——用户侧表现就是
       * "AI 答了但听不见声音，一个提示都没有"。现在：缓存 + toast + 一次点击恢复
       * （点击本身就是浏览器要的手势），把"听不见"变成"看得见、一点就响"。 */
      voiceTrace.srvRej++;  // ★ 2026-10-05 漏斗：play 被拒（策略/无手势/资源不可用）
      serverTtsBusy = false;
      serverTtsPlayingTs = undefined;
      if (typeof item.ts === 'number') pendingServerTts.delete(item.ts);
      blockedTts.push(item);
      if (blockedTts.length === 1) {
        showToast('🔊 AI 语音被浏览器拦截——点一下页面任意位置即可播出', 'error');
        const resumeTts = () => {
          document.removeEventListener('pointerdown', resumeTts);
          if (blockedTts.length) {
            serverTtsQueue.unshift(...blockedTts.splice(0));
            serverTtsBusy = false;
            playNextServerTts();
          }
        };
        document.addEventListener('pointerdown', resumeTts);
      } else {
        showToast('🔊 AI 语音又缓存了一段——点一下页面即可播放', 'error');
      }
      playNextServerTts();
    });
  } catch (e) {
    serverTtsBusy = false;
    serverTtsPlayingTs = undefined;
  }
}
socket.on('ai-audio', ({ url, ts, total } = {}) => {
  voiceTrace.srvGot++;  // ★ 2026-10-05 漏斗第 1 环：消息到了
  if (!aiVoiceOn || !url || !SPEECH_OK) {
    const why = !aiVoiceOn ? 'voice-off' : (!url ? 'no-url' : 'no-speech');
    /* ★ 2026-10-05 门口静默丢弃的救赎：没开「会说话」时每条 AI 音频都在这里被丢，
     *   用户侧 = "AI 答了但永远听不见，也没有任何提示"。现在每个会话提示一次
     *   （说清楚点哪里开），开过之后这条提示就再也不出现。 */
    if (why === 'voice-off' && !aiVoiceHintShown) {
      aiVoiceHintShown = true;
      showToast('🔈 AI 的声音没开——点控制坞的「会说话」按钮即可听到我说话', 'info');
      log('🔈 已缓存 AI 音频但「会说话」未开启；开启后新回答会直接出声');
    }
    voiceTrace.srvSkip[why] = (voiceTrace.srvSkip[why] || 0) + 1;  // ★ 2026-10-05 漏斗第 2 环：早期拦截
    return;
  }
  /* ★ 2026-10-02 只丢"被打断的那一轮"，不丢"刚答完的这一轮"（判据见 serverTtsDropped 注释）。
   *   段没带 ts（老服务器/异常）时才退回 8 秒时间窗。 */
  const interrupted = (typeof ts === 'number')
    ? serverTtsDropped.has(ts)
    : Date.now() < serverTtsIgnoreUntil;
  if (interrupted) {
    voiceTrace.srvDrop++;  // ★ 2026-10-05 漏斗第 3 环：被判"这一轮已被打断"
    if (typeof ts === 'number') pendingServerTts.delete(ts);
    return;
  }
  try {
    /* 注意参数：这里**不能**把服务端音频自己掐了——服务器按句流水线是一段一段发过来的，
     * 前一段正常播完就该接着播下一段。原先这里裸调 hushAiSpeech()，本意是"关掉正在念的
     * 浏览器 TTS（防双声）"，加上"清服务端队列"之后就会变成**自己把自己的下一段丢掉**。
     * 所以服务端音频的抢占只针对浏览器那一轨（serverToo=false）。 */
    hushAiSpeech({ serverToo: false });
    serverTtsQueue.push({ url, ts, total });
    voiceTrace.srvQ++;  // ★ 2026-10-05 漏斗第 4 环：入队
    if (serverTtsQueue.length > 6) serverTtsQueue.splice(0, serverTtsQueue.length - 6); // 防堆积
    playNextServerTts();
  } catch (e) { /* 播放失败不影响会议 */ }
});

/* ★ 2026-10-02 第 36 步：服务器下发的**房间级视图指令**（AI 说"打开白板"就靠它落地）。
 * ▎边界要说清楚（这条纪律比功能本身重要）：
 *   这里只允许动"房间级共享状态"——白板开合、字幕开合、视图切换。
 *   **凡是动用户设备的事都不在这张表里**（开摄像头、共享屏幕、发消息、静音别人），
 *   那些必须走各自的授权链路，与 C1 AI 操作员"授权绝不豁免"是同一条纪律。
 *   所以服务器那侧的白名单（ROOM_ACTIONS）和这张表必须一致——不一致就是漏洞。 */
socket.on('room-control', ({ action, byName } = {}) => {
  const who = byName || 'AI 助理';
  let done = '';  if (action === 'board-open' && !boardOn) { setBoardOpen(true); done = '已打开实时白板'; }
  else if (action === 'board-close' && boardOn) { setBoardOpen(false); done = '已关闭白板'; }
  else if (action === 'captions-on' && !cap.on) { toggleCaptions(); done = '已开启实时字幕'; }
  else if (action === 'captions-off' && cap.on) { toggleCaptions(); done = '已关闭实时字幕'; }
  else if (action === 'view-grid') { if (setViewMode('gallery')) done = '已切到宫格视图'; }
  else if (action === 'view-speaker') { if (setViewMode('speaker')) done = '已切到演讲者视图'; }
  /* ★ 2026-10-03 新增两个白板动作：**复用按钮背后同一对函数**（undoBoard/clearBoard），
   *   而不是在这里再写一遍 applyBoardOp + sendBoard。
   *   ▸ 白板不必 boardOn 才执行：账本与画布是同一份，收起状态下的清空/撤销
   *     在重新打开时照样要成立（且 sendBoard 会连带把"整笔"上报归档，两处不会漂移）。 */
  else if (action === 'board-undo') { undoBoard(); done = '已撤销白板最近一笔'; }
  else if (action === 'board-clear') { clearBoard(); done = '已清空白板'; }
  /* ★ 2026-10-07 第 51 步：共享文件面板的开关（同样只动"房间级共享状态"）。
   *   复用按钮背后那一个 setFilesOpen，不另写一套开合逻辑（坑 47）——
   *   所以"跟随被一起打开/关闭"这条规则对 AI 指令和用户点击完全一致。 */
  else if (action === 'files-open' && !filesOn) { setFilesOpen(true); done = '已打开共享文件面板'; }
  else if (action === 'files-close' && filesOn) { setFilesOpen(false); done = '已收起共享文件面板'; }
  if (done) showToast(`🤖 ${who}：${done}（全房间同步）`, 'info');
  /* ★ 2026-10-03 执行回执：把"这条指令在我身上真的生效了没有"报回服务器。
   *   服务器分别计「发出数」与「被执行数」，**两者的差就是"AI 说了但没做"的运行时证据**
   *   ——比只靠"两张表结构一致"的断言更强，而且不阻塞回答（回执是异步计数，没人等它）。
   * ★ 2026-10-06 判据补一半：报的是**"要的状态现在成没成"**，不只是"我刚有没有动手"。
   *   ▎为什么：白板本来就开着时说"把白板打开"，那条分支按设计不做事（done 为空），
   *     旧写法报 ok:false → 服务器 4 秒后在全房喊"没有任何客户端执行它"——
   *     可它明明开着。**误报的告警比没有告警更糟**：一个经常乱响的警报，下次真出事也没人信
   *     （坑 67 家族），而且这句瞎话是当着所有人的面说的。
   *   ▸ 所以：状态型动作（开/关白板、开/关字幕、两种视图）在 done 为空时改查"期望态"；
   *     命令型动作（撤销/清空）没有"期望态"可言，跑了就算成。
   *     未知动作两张表都落到"没做"→ ok:false，正是服务器那张表与本表漂移时的可见告警。 */
  const alreadyThere = (action === 'board-open' && boardOn)
    || (action === 'board-close' && !boardOn)
    || (action === 'captions-on' && cap.on)
    || (action === 'captions-off' && !cap.on)
    || (action === 'files-open' && filesOn)
    || (action === 'files-close' && !filesOn)
    || (action === 'view-grid' && layoutMode === 'gallery')
    || (action === 'view-speaker' && layoutMode === 'speaker');
  try { socket.emit('room-control-ack', { action, ok: !!done || alreadyThere }); } catch (e) { /* 回执失败不影响界面 */ }
});

/* ★ 2026-10-03 白板账本补发：晚进房/刷新的人不再面对一块空白画布。
 *   数据是服务器内存里的权威账本（见 sfu/server.js 的 board-record），
 *   这里只做"照账本重放"——与 resize 时的重绘走同一条 redrawBoard 路径（事件溯源的红利：
 *   画出来的东西 = 账本的投影，所以恢复画布只需要恢复账本）。 */
socket.on('board-state', ({ entries } = {}) => {
  if (!Array.isArray(entries) || !entries.length) return;
  boardStrokes.length = 0;
  for (const s of entries) {
    if (!s || !Array.isArray(s.pts) || !s.pts.length) continue;
    const color = /^#[0-9a-fA-F]{3,8}$/.test(String(s.color || '')) ? String(s.color) : '#1a1a1a';
    boardStrokes.push({ color, pts: s.pts.map((p) => ({ x: Number(p[0]) || 0, y: Number(p[1]) || 0 })) });
  }
  redrawBoard();
  showToast(`🖌️ 已恢复白板 ${boardStrokes.length} 笔（你进来之前别人画的）`, 'info');
});

/* ★ 2026-10-02 服务端语音状态翻转要跟着走（配合服务器那条"定期重探"）：
 *   进房时读到的 aiTtsEnabled 是一次性快照，而端点可达性会漂（Edge 403 是常态）。
 *   服务器重探后广播这条，页面当场改让位闸——不然就回到"两边都不出声"那个死局。 */
socket.on('ai-tts-state', ({ enabled } = {}) => {
  /* 本地静音期内（连续失败自愈）不理会服务器"我又可用了"——等静音期自己过，
   * 避免"失败→切浏览器→服务器又说行→又切回去"来回抖动。 */
  const next = !!enabled && Date.now() >= aiTtsLocalMuteUntil;
  if (next === aiTtsEnabled) return;
  aiTtsEnabled = next;
  aiTtsFailStreak = 0;
  log(next ? '🔊 服务端神经语音已就绪，AI 用服务器音色说话'
           : '🔈 服务端语音不可用，AI 回答改由浏览器朗读');
});

/* ★ 2026-10-02 连续失败自愈：回落闸 force 只能救"这一次"，但如果服务端探测说"我可用"
 *   而实际每次都失败，用户会经历"每句都要等服务器判死刑才出声"的延迟。
 *   连吃两次失败就本地临时停用服务端语音 5 分钟（服务器重探成功后会广播恢复）。 */
let aiTtsFailStreak = 0;
let aiTtsLocalMuteUntil = 0;
/* ★ 2026-10-06 「这一轮由浏览器自己念」只有这一个入口（坑 47：一个概念一个来源）。
 * ▎两个触发点共用它：
 *   ① 服务器发来 ai-tts-fail —— 它知道自己发不出音频（现在最晚 8s 就会说这句话）；
 *   ② 客户端等满 SERVER_TTS_BACKSTOP_MS 什么都没等到 —— 服务器**连"发不出"都没能说出口**
 *     （应答链路在流水线收尾之前抛错、或那条信令在网络上丢了）。
 *     这一条不是假想：2026-10-06 追查一次 test:asr-live 的失败时就看到过"音频 0 段 /
 *     失败通知 0 次"的形态，而当时整条兜底全押在服务器补发那一句上 = 客户端会永远等着。
 * ▸ 为什么回落时要**同时**把 ts 记进 serverTtsDropped：
 *   服务端那一段仍可能迟到（合成的内部超时从 12s 收到 6s、决定又有 8s 上限，
 *   于是"决定先于音频"第一次成了正常时序）。不记就会两个声音抢着念同一句话——
 *   本项目的老规矩：宁可念一半，也不要两个声音抢（坑 66/68）。
 * ▸ 判据只看账本还在不在：任何一段真开始播（onplaying）、出错、被拒、被打断都会销账，
 *   销了账的轮次保险丝自然不响，所以不需要保存定时器句柄。 */
const SERVER_TTS_BACKSTOP_MS = 20000;
function armServerTtsBackstop(ts) {
  // 不需要存句柄：动作前先问"这条账还在不在"，所有正常销账路径天然把它取消
  setTimeout(() => { fallBackToBrowserTts(ts, 'backstop'); }, SERVER_TTS_BACKSTOP_MS);
}
function fallBackToBrowserTts(ts, why) {
  const t = pendingServerTts.get(ts);
  if (!t) return false; // 已经出声 / 已被打断 / 已经回落过 = 这一轮早就有交代了
  pendingServerTts.delete(ts);
  if (typeof ts === 'number') {
    serverTtsDropped.add(ts);
    while (serverTtsDropped.size > 20) serverTtsDropped.delete(serverTtsDropped.values().next().value);
  }
  if (why === 'backstop') log('🔇 等了 20s 既没听到服务端语音、也没收到失败通知——这条回答改由浏览器朗读');
  speakAiText(t, { force: true, answerTs: ts });
  return true;
}
socket.on('ai-tts-fail', ({ ts } = {}) => {
  aiTtsFailStreak += 1;
  if (aiTtsFailStreak >= 2) {
    aiTtsEnabled = false;
    aiTtsLocalMuteUntil = Date.now() + 5 * 60000;
    aiTtsFailStreak = 0;
    log('🔈 服务端语音连续失败，这段时间改由浏览器朗读（服务器重探成功后自动切回）');
  }
  fallBackToBrowserTts(ts, 'server-said-fail');
});

/* ★ 09-30 抢话修复①：用户一开口，AI 立即闭嘴。
 * ▎抢话的体验根源：AI 回答用浏览器 TTS 朗读（默认开），而人说完唤醒词往往还在
 *   继续说（"小明，帮我记一下……顺便……"）——AI 的声音直接压在用户的尾句上。
 *   人类对话的礼仪是：对方开口，我就让。
 * ▎触发点：新字幕到达（服务端 asr-caption / 本地识别结果都算"有人在说话"）。
 *   用字幕当 VAD，不引入任何新依赖、不加复杂度。 */
function hushAiSpeech({ serverToo = true } = {}) {
  if (!SPEECH_OK) return;
  try {
    if (aiSpeakQueue.length || window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      aiSpeakQueue.length = 0;
      window.speechSynthesis.cancel();
      voiceTrace.killed++;   // ★ 2026-10-03f "开口之后被掐"的计数——本轮病的 X 光片
    }
    /* serverToo=false 用于"服务端音频自己到达时只关浏览器那一轨"——
     * 按句流水线是一段一段发过来的，若这里连自己的队列一起清掉，就等于自己丢自己的下一段。 */
    if (!serverToo) return;
    // ★ 09-30c：服务端 MP3 也在"AI 的声音"管辖内——用户开口，它同样得停
    if (serverTtsEl && !serverTtsEl.paused) {
      try { serverTtsEl.pause(); } catch (e) { /* 忽略 */ }
      voiceTrace.killed++;   // 服务端那一轨被打断也记同一件事
    }
    /* ★ 2026-10-02 打断要连**队列**一起清，并释放 busy 标志：
     *   pause() 之后 onended 永远不会来（被暂停的音频不结束），于是 serverTtsBusy
     *   一直挂着 true → 下一条答案的音频进队后再也不会被播出 = 新的死锁。
     *   语义上也该如此：用户打断了 AI，它这段答案剩下的句子就不该在后面自己响起来。
     * ▸ 怎么认出"这段答案剩下的句子"：正在播的 + 队列里排着的 ts 全部拉黑
     *   （按句流水线的一段一段共用同一个 ts），后到的同 ts 段自然被 ai-audio 丢掉。
     *   **不能**用时间窗——那会把"这次提问的答案"也一起吞掉（见 serverTtsDropped 注释）。 */
    if (typeof serverTtsPlayingTs === 'number') serverTtsDropped.add(serverTtsPlayingTs);
    for (const q of serverTtsQueue) { if (typeof q.ts === 'number') serverTtsDropped.add(q.ts); }
    while (serverTtsDropped.size > 20) serverTtsDropped.delete(serverTtsDropped.values().next().value);
    serverTtsQueue.length = 0;
    serverTtsBusy = false;
    serverTtsPlayingTs = undefined;
    serverTtsIgnoreUntil = Date.now() + 8000;   // 只作"段没带 ts"时的兜底判据
  } catch (e) { /* 播报失败绝不影响会议功能 */ }
}

/* ══ 第 40 步：开关的运动语言（移植 reactbits BellToggle，纯 CSS + 原生 JS，零依赖）══════
 * ▎三个 helper：ringPulse（从图标支点扩散几圈环 + 图标摆一下）、setToggleLabels
 *   （开/关两套文案叠在同一格交叉淡入）、popBadge（未读数弹跳）。样式全在 style.css 第 29 节。
 * ▎两条必须记住的实现细节：
 *   ① CSS 动画**只有类被重新加上才会重播**——所以先 remove、强制一次回流、再加回。
 *      这里读 offsetWidth 是"点击"这种低频动作，不在 pointermove 那种高频路径上
 *      （坑 59：高频事件里读布局会强制同步重排，那是另一回事）。
 *   ② 环节点演完必须自己拆台（animationend 里 remove，最后一圈顺手撤掉容器），
 *      否则一场长会点几十下就攒出一堆僵尸节点——和 09-19d 的 detachTileGain 同一条纪律。
 *   ▸ prefers-reduced-motion 直接不演（CSS 里也兜了一道 display:none，双保险）。 */
function reducedMotion() {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  catch (e) { return false; }
}
function ringPulse(btn, opts = {}) {
  if (!btn || reducedMotion()) return;
  const waves = Math.max(1, Math.min(5, Number(opts.waves) || 3));   // 对应 ringPasses
  let rx = 20, ry = null;
  try {
    const pivot = opts.pivotEl || btn.querySelector('.i');
    const br = btn.getBoundingClientRect();
    if (pivot && br.width) {
      const pr = pivot.getBoundingClientRect();
      rx = pr.left - br.left + pr.width / 2;                          // 支点 = 图标中心（ringPivot）
      ry = pr.top - br.top + pr.height / 2;
    }
  } catch (e) { /* 无头桩没有布局：退回默认支点，环照样演 */ }
  let layer = btn.querySelector('.tgl-rings');
  if (!layer) {
    layer = document.createElement('span');
    layer.className = 'tgl-rings';
    layer.setAttribute('aria-hidden', 'true');
    btn.appendChild(layer);
  }
  for (let i = 0; i < waves; i++) {
    const r = document.createElement('span');
    r.className = 'tgl-ring';
    r.style.setProperty('--i', String(i));
    r.style.setProperty('--rx', rx + 'px');
    if (ry !== null) r.style.setProperty('--ry', ry + 'px');
    r.addEventListener('animationend', () => {
      r.remove();
      if (layer.parentNode && !layer.children.length) layer.remove();
    }, { once: true });
    layer.appendChild(r);
  }
  btn.classList.remove('pinged');
  void btn.offsetWidth;
  btn.classList.add('pinged');
  setTimeout(() => btn.classList.remove('pinged'), 700);
}
/* 双层文案：只在第一次建结构，之后靠 .active 让 CSS 交叉淡入（不再 textContent 覆写，
 *   那会把 SVG 图标一起冲掉——09-26 的"innerHTML 重建冲掉头像"是同一条坑）。 */
function setToggleLabels(btn, offText, onText) {
  if (!btn) return '';
  let txt = btn.querySelector('.tgl-txt');
  if (!txt) {
    const old = btn.querySelector('span');
    if (old) old.remove();
    txt = document.createElement('span');
    txt.className = 'tgl-txt';
    const off = document.createElement('span'); off.className = 'tgl-off';
    const on = document.createElement('span'); on.className = 'tgl-on';
    txt.appendChild(off); txt.appendChild(on);
    btn.appendChild(txt);
  }
  const kids = txt.children;
  if (kids[0]) kids[0].textContent = offText;
  if (kids[1]) kids[1].textContent = onText;
  return txt;
}
function popBadge(el) {
  if (!el || reducedMotion()) return;
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
  setTimeout(() => el.classList.remove('pop'), 400);
}

function updateAiVoiceUi() {
  const btn = $('aiVoiceBtn');
  if (!btn) return;
  btn.classList.toggle('active', aiVoiceOn);
  btn.classList.toggle('tgl', true);
  setToggleLabels(btn, 'AI 语音', '会说话');   // 交叉淡入交给 CSS，不再覆写 textContent
  btn.title = !SPEECH_OK
    ? '当前浏览器不支持语音合成（speechSynthesis），该功能不可用'
    : (aiVoiceOn
      ? 'AI 语音播报：已开启（点一下关闭）。AI 说的话会用浏览器语音念出来'
      : 'AI 语音播报（默认关）：开启后 AI 说的话会用浏览器语音念出来');
  btn.disabled = !SPEECH_OK || !myRoom;   // 不支持语音 / 还没进房 → 不可点
  if (!SPEECH_OK) btn.classList.add('ai-voice-na');
  // ★ 09-30 抢话修复：语音开着就要有人盯"用户是否在说话"（即时闭嘴闸）；关了就撤岗
  if (aiVoiceOn) startAiHushWatcher(); else stopAiHushWatcher();
}

/* ★ 09-30 抢话修复⑤（即时版）：会议中用 AnalyserNode 盯本地麦克风能量——
 *   峰值连续超阈 ≈ 正在说话 → 立刻 hushAiSpeech()。字幕是 5s 段粒度（要等段结束
 *   +转写完才到），靠字幕"闭嘴"最慢 8s；本机能量是 50ms 级的即时信号。
 * ▎只在 AI 语音开着时运行（语音关了没人抢话，白占 CPU）；AI 没在说时循环近乎空转；
 *   静音后轨道送来的是全零采样，天然不会误触发；设备热切换（replaceTrack）不派发
 *   任何事件 → 在循环里比对轨道引用、变了就静默重绑。 */
const AI_HUSH_THRESHOLD = 0.055; // 峰值阈值：说话明显越线，呼吸/键盘噪声够不着
const AI_HUSH_FRAMES = 8;        // 连续超阈帧数（60fps 下 ≈130ms）才算"人声"而非一下碰撞
/* ★ 2026-10-03f 自回声倍率：AI 正在出声时，打断判据抬到"回声本底 × 这个倍率"。
 *   笔记本外放场景下，AI 自己的声音就够越过固定阈值 → 它把自己掐死（"听不见声音"）。
 *   2.2 的取值依据：真人打断会凑近话筒提高音量，实测能量至少是回路回声的两倍以上；
 *   而回声经 AEC 后本就衰减，再叠 2.2 倍几乎不可能被真人误挡。 */
const AI_HUSH_ECHO_RATIO = 2.2;
/* 回声采样窗：AI 开口后这段时间里采到的最大峰值 = 本条链路的回声强度。
 * ▎为什么是 500ms 而不是 160ms：语音引擎启动本身要几十~几百 ms，声音再从喇叭走到
 *   麦克风、过浏览器采集还要一段时间——窗开太短会**什么都采不到**，本底留在 0，
 *   门槛退回固定阈值，于是"外放自回声掐死自己"原样复发（本轮差点就这么交付了）。
 * ▎代价：AI 开口的头 500ms 内真人插话会被算进本底、那一轮较难打断——
 *   但 AI 之所以会开口，前提正是"此刻没人说话"（speakAiText 的抢话闸），所以这个代价很小。 */
const AI_HUSH_ECHO_WINDOW_MS = 500;
/* ▎打断判据抽成**纯函数**（坑 60 的规矩：控制律不可穷举断言 = 只能"跑起来看着还行"，
 *   而"画面/声音忽有忽无"在真机上极难复现）。纯函数才能拿四组数字钉死四种场景。 */
function voiceBargeIn(peak, echoFloor, speaking) {
  const need = Math.max(AI_HUSH_THRESHOLD, (speaking ? echoFloor : 0) * AI_HUSH_ECHO_RATIO);
  return peak > need;
}
let aiHush = { ctx: null, source: null, analyser: null, buf: null, raf: 0, track: null, hits: 0,
               wasSpeaking: false, echoSampling: false, echoUntil: 0 };

function bindAiHush(track) {
  try { if (aiHush.source) aiHush.source.disconnect(); } catch (e) { /* 忽略 */ }
  aiHush.track = track || null;
  aiHush.analyser = null;
  aiHush.source = null;
  if (!track || !aiHush.ctx) return;
  try {
    aiHush.source = aiHush.ctx.createMediaStreamSource(new MediaStream([track]));
    aiHush.analyser = aiHush.ctx.createAnalyser();
    aiHush.analyser.fftSize = 512;
    aiHush.source.connect(aiHush.analyser); // 只分析不外放（防啸叫）
    aiHush.buf = new Float32Array(512);
  } catch (e) { aiHush.analyser = null; }
}

function startAiHushWatcher() {
  try {
    if (!SPEECH_OK || !aiVoiceOn || aiHush.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (typeof AC !== 'function') return;
    aiHush.ctx = new AC();
    if (typeof aiHush.ctx.createAnalyser !== 'function') { try { aiHush.ctx.close(); } catch (e) {} aiHush.ctx = null; return; }
    bindAiHush(localStream && localStream.getAudioTracks()[0]);
    const loop = () => {
      if (!aiHush.ctx) return;
      try {
        // 设备热切换：轨道换了 → 静默重绑；没麦克风的阶段 analyser 为 null，空转
        const cur = localStream && localStream.getAudioTracks()[0];
        if (cur !== aiHush.track) bindAiHush(cur);
        /* ★ 2026-10-02 采样不再以"AI 正在说话"为前提。
         *   旧写法只在 speechSynthesis.speaking 时量麦克风——于是"用户现在是否在说话"
         *   这个信息在 AI 沉默时根本拿不到，只能退回去用"字幕到达时间"猜，
         *   而字幕比真话晚 1~3 秒（分段+转写），拿它当"正在说话"就会把
         *   **刚答完的那一轮朗读整轮吃掉**（用户实测："回答的时候不说话"）。
         *   现在：只要 AI 语音开着就持续量麦克风，得到"此刻是否在说话"的即时信号；
         *   掐断（hush）仍然只在 AI 真的在念时才做（AI 没念时没什么可掐的）。 */
        if (aiHush.analyser) {
          aiHush.analyser.getFloatTimeDomainData(aiHush.buf);
          let peak = 0;
          for (let i = 0; i < aiHush.buf.length; i++) { const v = Math.abs(aiHush.buf[i]); if (v > peak) peak = v; }
          /* ★ 2026-10-03f 自回声本底自校准：AI 一开口就开一个 160ms 的采样窗，
           *   窗内采到的峰值就是"喇叭 → 麦克风"这条回路的强度；此后 AI 出声期间的
           *   打断判据抬到 max(固定阈值, 本底 × 2.2)。没有这一步，外放场景下
           *   AI 每念一句就被自己的声音判成"有人打断"然后掐死自己。
           *   ▸ AI 静默时把本底清零：一是它此刻无意义，二是防止"上一轮的陈旧本底"
           *     把下一轮的打断判据莫名抬高（判据漂移比没有判据更难查）。 */
          const speaking = aiIsSpeaking();
          if (speaking) {
            if (!aiHush.wasSpeaking) { aiHush.echoSampling = true; aiHush.echoUntil = Date.now() + AI_HUSH_ECHO_WINDOW_MS; }
            if (aiHush.echoSampling) {
              if (peak > voiceTrace.echoFloor) voiceTrace.echoFloor = peak;
              if (Date.now() > aiHush.echoUntil) aiHush.echoSampling = false;
            }
          } else {
            aiHush.echoSampling = false;
            voiceTrace.echoFloor = 0;
          }
          aiHush.wasSpeaking = speaking;
          aiHush.hits = voiceBargeIn(peak, voiceTrace.echoFloor, speaking) ? aiHush.hits + 1 : 0;
          if (aiHush.hits >= AI_HUSH_FRAMES) {
            aiHush.hits = 0;
            lastMicVoiceTs = Date.now();   // "此刻有人在说话"的即时证据
            /* 打断只在"AI 真的在出声"时才执行（没出声没什么可掐）。
             * 判据从 speechSynthesis.speaking 换成 aiIsSpeaking()：
             * 服务端 MP3 那一轨同样得被真人打断，原先它不在这条路上。 */
            if (speaking) {
              lastUserSpeechTs = Date.now();
              hushAiSpeech();
            }
          }
        } else {
          aiHush.hits = 0;
        }
      } catch (e) { /* 看门式兜底：任何异常都不打断循环 */ }
      aiHush.raf = requestAnimationFrame(loop);
    };
    aiHush.raf = requestAnimationFrame(loop);
  } catch (e) { aiHush.ctx = null; /* 失败不影响会议 */ }
}

function stopAiHushWatcher() {
  if (aiHush.raf) { cancelAnimationFrame(aiHush.raf); aiHush.raf = 0; }
  try { if (aiHush.source) aiHush.source.disconnect(); } catch (e) { /* 忽略 */ }
  try { if (aiHush.ctx) aiHush.ctx.close(); } catch (e) { /* 忽略 */ }
  aiHush = { ctx: null, source: null, analyser: null, buf: null, raf: 0, track: null, hits: 0,
             wasSpeaking: false, echoSampling: false, echoUntil: 0 };
  voiceTrace.echoFloor = 0;   // 撤岗时把回声本底一起清掉，别让它带着上一轮的旧读数再上岗
}

function initAiVoice() {
  const btn = $('aiVoiceBtn');
  updateAiVoiceUi();
  if (!btn) return;
  btn.addEventListener('click', () => {
    aiVoiceOn = !aiVoiceOn;
    try { localStorage.setItem('sfuAiVoice', aiVoiceOn ? '1' : '0'); } catch (e) { /* 存不了就只在本次生效 */ }
    if (!aiVoiceOn) { try { window.speechSynthesis.cancel(); } catch (e) { /* */ } }  // 关掉时立刻闭嘴
    /* ★ 2026-10-04h 开语音的那一下顺带请求系统通知权限：用户明确表达"我要听它说话"
     *   才弹权限（进房就弹是骚扰）；拒绝过就永远静默，绝不二次打扰。 */
    if (aiVoiceOn && 'Notification' in window && Notification.permission === 'default') {
      try { Notification.requestPermission().catch(() => {}); } catch (e) { /* 老浏览器 */ }
    }
    updateAiVoiceUi();
    if (aiVoiceOn) ringPulse(btn);   // 第 40 步：只在"开启"时响环——关的时候安静（提醒类动效不做反向强调）
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
  return `<details class="msg-ai-ev"><summary>${ICONS.target}<span>看 AI 依据的 ${list.length} 条${isBoard ? '看板条目' : '原话'}</span></summary>`
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

/* ★ 2026-10-02 成员行上的「只对 TA 回应」按钮（Piik 式定向反应）
 * ▎为什么放在成员行而不是视频格上：视频格会被双击全屏/钉选/批注层抢事件，
 *   而成员行本来就是"关于这个人的一切操作"的入口（录制、发文件、移出都在这）。
 * ▎交互：点一下 = 定向到 TA（回应条出现「→ 小张」），在回应条上选表情即发；
 *   再点一次同一个按钮 = 取消；发完自动取消（一次一发，避免手滑连着定向给错人）。 */
function addReactTargetBtn(host, id, name) {
  const b = document.createElement('button');
  b.className = 'mini m-ai-react';
  b.innerHTML = ICONS.smile;
  b.title = `只对 ${name || 'TA'} 回应一个表情（再点一次取消）`;
  b.addEventListener('click', () => {
    const t = liveReactTarget();
    if (t && t.id === id) { setReactTarget(null); showToast('已取消定向回应', 'info'); return; }
    setReactTarget(id, name);
    showToast(`接下来点的表情只发给 ${name || 'TA'}`, 'info');
  });
  host.appendChild(b);
  return b;
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
      /* ★ 2026-10-07 五代：行内小头像与视频格**共用同一个 aiAvatarSvg()**（坑 47：
       *   一个概念只能有一个来源）；行上挂 .speaking 类时 CSS 驱动嘴开合，
       *   与格子侧同一套状态变形。 */
      row.innerHTML = `<span class="ai-av">${aiAvatarSvg()}</span>`
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
      // ★ 2026-10-02 对 AI 也能定向回应（"它答得好，我只对它比个 👍"）
      addReactTargetBtn(row, m.id, m.name || 'AI 小明');
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
        + `${ICONS.screen}<span>${escapeHtml(m.name || '桌面代理')}</span><span class="m-agent-note">可被控</span></span>`;
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
    if (m.role === 'admin' && !m.owner) addBadge(ICONS.shield, '平台管理员'); // ★ G6-②：admin 徽标（房主已有 crown，不重复挂）
    if (m.sharing) addBadge(ICONS.screen, '正在共享屏幕');
    if (m.muted) addBadge(ICONS.micOff, '已静音');
    if (m.camOff) addBadge(ICONS.camOff, '摄像头已关');
    if (m.hand) addBadge(ICONS.hand, '举手中（想发言）'); // ★ 09-13 F4
    if (m.caption) addBadge(ICONS.cc, '字幕开启中'); // ★ 09-17b：实时字幕状态（member-state 白名单）

    if (!isMe) {
      /* ★ 2026-10-10（B4 反向配对）「解禁」——拉黑要有反面。
       *   ▎原来这条路是单向门：`blockedPeers.add(who)` 之后全文件没有任何一处 delete，
       *     而这把锁的键是 socket.id——对方重连一次 id 就变，于是"永久拉黑"实际上只到
       *     对方下次连接为止，而"这一场想放过 TA"却办不到。两个方向都不对：
       *     承诺比能力强（说不解禁却会自动失效）与能力比承诺强一样糟。
       *   ▸ 为什么挂在成员行而不是授权卡片：卡片只在有人申请时才弹，
       *     而拉黑之后那个人**不再弹卡**（这正是拉黑的效果），
       *     于是"撤销"只能落在那个人的名字上——他还在房里，名字一直看得见。 */
      if (blockedPeers.has(m.id)) {
        const unBtn = document.createElement('button');
        unBtn.className = 'mini m-unblock';
        unBtn.textContent = '解禁';
        unBtn.title = `TA 在你本地黑名单里（申请控制会被自动拒绝）——点一下解除`;
        unBtn.addEventListener('click', () => {
          blockedPeers.delete(m.id);
          log(`✅ 已把成员 ${shortId(m.id)} 移出本地黑名单，之后 TA 可以申请控制`);
          auditPush('授权', `将 ${shortId(m.id)} 移出黑名单`);
          showToast(`已解除对成员 ${shortId(m.id)} 的黑名单`, 'info');
          renderMembers(lastMembers);   // 按钮就地消失（重建式渲染，不留半个状态）
        });
        row.appendChild(unBtn);
      }
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
      // ★ 2026-10-02 定向回应（Piik 式）：只对这个人比一个表情，别人不刷屏
      if (!isMe) addReactTargetBtn(badges, m.id, m.name);

      // ★ D4：房主/平台管理员可以移出成员（服务器 roleOf 再校验一次权限，前端只是入口）
      if (me && (me.owner || me.role === 'admin')) {
        const kickBtn = document.createElement('button');
        kickBtn.className = 'mini';
        kickBtn.innerHTML = ICONS.door;
        kickBtn.title = me.owner ? '移出房间（房主可用）' : '移出房间（平台管理员可用）';
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
  applyAiListening(lastLevels); // ★ 第 44 步：AI 格子的"耳朵"跟着真实音量起伏
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

// dB → 0~1 的**唯一**换算处（-55dB 以下算安静、0dB 满格）。
/* ★ 2026-10-03 第 44 步：抽出来是因为现在有第二个读者——AI 格子的"耳朵"要按同一个口径
 *   起伏。原来这段拉伸写在 setSpeaking 里，AI 那边再抄一份就是两个来源（坑 47）：
 *   哪天把 -55 调成 -48，画面格会亮而 AI 的耳朵不亮，界面上两个地方说法不同。 */
const SPEAK_FLOOR_DB = -55;
function dbToLevel(volume) {
  if (typeof volume !== 'number' || !Number.isFinite(volume)) return 0;
  if (volume <= SPEAK_FLOOR_DB) return 0;
  return Math.max(0, Math.min(1, (volume - SPEAK_FLOOR_DB) / (0 - SPEAK_FLOOR_DB)));
}

// 给一个元素（视频格或成员行）设置"是否在说话 + 音量条宽度"
function setSpeaking(el, volume) {
  if (!el) return;
  const lvl = dbToLevel(volume);
  el.classList.toggle('speaking', lvl > 0);
  const bar = el.querySelector('.vol-bar > i');
  if (bar) bar.style.width = lvl > 0 ? `${Math.max(5, Math.round(lvl * 100))}%` : '0%';
}

/* ★ 2026-10-03 第 44 步：让 AI 的"在听"由房间里的**真实声音**驱动。
 * ▎为什么值得做（用户两次点名"头像动态效果差、没有状态变化"）：AI 格子原先只在
 *   自己 speaking / thinking 时动，别人说话时它一动不动——可它的全部工作就是
 *   "听别人说话"，最该有反应的那个时刻反而没反应，看着就像一张死图。
 * ▎数据来源是既有的 audio-levels（服务器 AudioLevelObserver 每 400ms 一报）：
 *   不新增信令、不新增采样，这一格只是把**已经在飞的真实数字**画出来。
 * ▎诚实边界：波形显示的是"此刻最大声的那个人有多大声"，不是 AI 实际收到的音频流；
 *   服务器侧那条 RMS 管线另有自己的统计口径（第 37 步的 ⏱ 与 /metrics），两者别混。 */
function applyAiListening(levels) {
  if (!aiTileEl) return;
  const top = (levels || [])[0];
  const lvl = dbToLevel(top && top.volume);
  /* AI 自己发言时不抢这组波形：那时 .ai-waves 说的是"它在说话"（speaking 类驱动），
     再叠一层"别人在说话"就是两个来源抢同一个执行器（坑 62 同一条纪律）。 */
  const on = aiAvatar.state !== 'speaking' && lvl > 0;
  aiTileEl.classList.toggle('listening-active', on);
  aiTileEl.style.setProperty('--ai-ear', lvl.toFixed(2));
  const who = aiTileEl.querySelector('.ai-ear');
  if (!who) return;
  if (!on) { who.textContent = ''; return; }
  const isMe = top.id === socket.id;
  const m = isMe ? null : lastMembers.find((x) => x.id === top.id);
  who.textContent = `在听 ${isMe ? (myDisplayName || '我') : (m && m.name) || `成员 ${shortId(top.id)}`}`;
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
    /* ★ 2026-10-06 与下面 switchMic 同一处缺陷的另一半：**按钮文字不是状态机**。
     *   原先这里写 `newTrack.enabled = camBtn.textContent === '关摄像头'`，
     *   而拱形升起（第 43 步）之后那颗按钮的 textContent 是「关摄像头关摄像头」（两层同样的字），
     *   相等判断永远 false ⇒ 换过一次摄像头，画面就自己关了，日志还写着"已切换摄像头"。
     *   状态要在**换轨之前**从旧轨道上取（旧轨一会被 stop()，之后就问不出来了）。 */
    const camWasOn = cameraTrack ? cameraTrack.enabled !== false : true;
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
    newTrack.enabled = camWasOn; // 保持"关摄像头"状态（判据来自旧轨道，不来自按钮文字）
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
    /* ★ 2026-10-06 真缺陷（长跑调查顺手抓到的，与坑 77 同族）：这行原先写
     *     newTrack.enabled = muteBtn.textContent === '静音';
     *   而按钮的文本层在第 43 步（拱形升起）之后变成"两层同样的字"，textContent 读到的是
     *   **「静音静音」**——于是这个相等判断**永远为 false**：换过一次麦克风之后，
     *   新轨道一上来就是 disabled，日志还写着"已切换麦克风（成功）"。
     *   用户侧的表现就是"我用一会儿就没声音/识别不了了"，而且界面上一切正常。
     *   ▸ 正解：**静音状态的唯一来源是轨道自己**，不是按钮上那几个字
     *     （按钮文字是给人看的，它会随图标/动效改版——把它当状态机用迟早出事）。 */
    const micWasOn = (() => {
      const t = localStream && localStream.getAudioTracks && localStream.getAudioTracks()[0];
      return t ? t.enabled !== false : true;
    })();
    const old = localStream.getAudioTracks()[0];
    if (old) { localStream.removeTrack(old); old.stop(); }
    localStream.addTrack(newTrack);
    newTrack.enabled = micWasOn; // 保持静音状态（判据来自旧轨道，不来自按钮文字）
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
  let html = `<option value="auto">自动</option>`;
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
/* ★ 第 51 步顺手把"离开首屏"这件事抽成了唯一入口 dismissPrejoin()。
 * ▎为什么要抽：原先只有这一处会加 .hidden，而"已经在房间里"是另一条路径的产物
 *   （测试/深链/以后新加的入口都可能直接进房）。两者不绑在一起时，界面会停在
 *   "人在会里、首屏那层 z100 的遮罩还盖着全场"——**除了命中测试，没有一条 DOM 断言看得出来**，
 *   因为 DOM 属性全都是对的（本轮的 check:files 就是这么被自己骗了一次，见坑 55/63 那条纪律）。
 *   ▸ 判据：**"进入房间"必然蕴含"首屏收起"**，那就把它写成进房的一部分，而不是某个按钮的副作用。 */
function dismissPrejoin() {
  if (!prejoinEl || prejoinEl.classList.contains('hidden')) return;
  stopPrejoinMeter();
  prejoinEl.classList.add('hidden');
  /* 第 42 步：登录页一隐藏就停辉光。不停 = 一整场会都在后台烧 GPU，
   *   而屏幕上根本看不见它——"看不见的开销"最容易漏（同 09-19d 的内存热窗口总纲）。 */
  if (glowTrail) glowTrail.stop();
}

function enterFromPrejoin() {
  dismissPrejoin();
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

/* ★ 2026-10-05 问题⑥（演讲者视图大画面比例）唯一实现：contain 反算像素。
 * 为什么必须 JS 而不是纯 CSS：真浏览器三候选实验（890×234 宽扁 / 375×560 窄高）——
 *   ① width:100%+max-height+aspect-ratio（09-19 旧写法）→ 宽扁格 890×224（ar 3.97，横向拉伸）
 *   ② height:100%+width:auto+max-width+aspect-ratio → 窄高格 375×550（ar 0.68，纵向拉伸）
 *   Edge 里 aspect-ratio 的钳制**不跨轴回缩**，两个方向各翻一种车，没有两全的纯 CSS 解。
 * 本函数量两个实数：第一行行高 = gridTemplateRows 的首个像素值（minmax(0,1fr) 的实高，
 * 与格子内容无关——不会形成"改尺寸→改行高→再改尺寸"的回环）；可用宽 = grid.clientWidth。
 * 然后按 16:9 contain 反算像素写进 CSS 变量（CSS 侧单一消费点，见 style.css tile-main 规则）。
 * 量不出（宫格视图 / 舞台被遮住 / 还没有大画面）时清掉变量，让 CSS 缺省值兜底而不是吃旧值。 */
function fitMainTile() {
  if (!videoGrid) return;
  const clear = () => {
    videoGrid.style.removeProperty('--main-w');
    videoGrid.style.removeProperty('--main-h');
  };
  if (!videoGrid.classList.contains('layout-speaker')) return clear();
  const r1 = parseFloat((getComputedStyle(videoGrid).gridTemplateRows || '').split(' ')[0]) || 0;
  const W = videoGrid.clientWidth;
  if (r1 <= 0 || W <= 0) return clear();
  const w = Math.min(W, r1 * 16 / 9);
  videoGrid.style.setProperty('--main-w', w.toFixed(1) + 'px');
  videoGrid.style.setProperty('--main-h', (w * 9 / 16).toFixed(1) + 'px');
}

/* ★ 2026-10-06 问题⑥续：宫格视图下"共享格该占几列"由这里量出来（消费点在 style.css）。
 * ▎要解决的事：屏幕内容是文档和表格，240px 宽的一格里字号小到没法看——
 *   而用户说的"比例不协调"，contain 修好的是**裁不裁**，这一刀修的是**多大**。
 * ▎为什么不是 CSS 直接 `span 2`：列数是 auto-fit 随舞台宽度算出来的，
 *   窄舞台只有 1 列时 `span 2` 会造出一条隐式列，右边那块被 overflow:hidden 裁掉
 *   ——把画面裁掉正是我们要修的那个病，不能换个地方再犯一次（坑 79：量，别猜）。
 * ▎演讲者视图清掉变量：那里大画面已有 --main-w/--main-h 一套尺寸来源，
 *   两个来源管同一件事迟早打架（坑 47/62）。 */
function applyScreenSpan() {
  if (!videoGrid) return;
  const clear = () => videoGrid.style.removeProperty('--screen-span');
  if (videoGrid.classList.contains('layout-speaker')) return clear();
  const cols = (getComputedStyle(videoGrid).gridTemplateColumns || '').split(' ').filter(Boolean).length;
  if (!cols) return clear();
  videoGrid.style.setProperty('--screen-span', String(cols >= 2 ? 2 : 1));
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
  /* 大画面换人不改变 grid 盒子尺寸（ResizeObserver 不会响），必须在这里主动重算——
     否则 --main-w 还是上一位大画面时的数，换人那一下画面尺寸不刷新（fitted 于旧行高的值仍在）。 */
  fitMainTile();
  applyScreenSpan();
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
    /* ★ 2026-10-04 真浏览器控制台抓到的未捕获异常：
     *   `AbortError: Transition was skipped. New ViewTransition started`。
     *   ▎为什么 try/catch 挡不住：startViewTransition 返回的是一个对象，
     *     它的三个 promise（updateCallbackDone / ready / finished）在"新过渡抢进来"时
     *     **各自 reject** —— 同步 try 只能包住"调用本身抛错"，管不到稍后的 promise。
     *   ▎修法：三个都挂上 catch。过渡失败不该影响正确性，所以 DOM 更新仍要在
     *     回调里同步做完（本来就是这么设计的），这里只是别让浏览器替我们报错。 */
    try {
      const t = document.startViewTransition(() => applyLayoutDOM());
      if (t) {
        [t.updateCallbackDone, t.ready, t.finished].forEach((p) => { if (p && p.catch) p.catch(() => {}); });
      }
    } catch (e) { applyLayoutDOM(); } // 过渡失败不影响正确性
  }
  lastLayoutSig = sig;
}

/* ★ 2026-10-02 第 36 步：切视图也抽成函数（同一屏的第二个触发源 = AI/远端指令）。
 *   mode: 'gallery' 宫格 | 'speaker' 演讲者。非法值直接忽略，不猜。 */
function setViewMode(mode) {
  if (mode !== 'gallery' && mode !== 'speaker') return false;
  if (layoutMode === mode) return true;
  layoutMode = mode;
  applyLayout();
  log(mode === 'gallery' ? '▦ 已切到宫格视图' : '▢ 已切到演讲者视图（大画面跟随共享者/说话人）');
  return true;
}

viewGalleryBtn.addEventListener('click', () => setViewMode('gallery'));
viewSpeakerBtn.addEventListener('click', () => setViewMode('speaker'));

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
      setIconBtn(b, ICONS.pin, t.from === pinnedId ? '已钉选' : '钉选');
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

/* ① 表情回应：骑在聊天同一条 SCTP 广播频道上（mediasoup 自动转发给所有订阅者）。
 *
 * ★ 2026-10-02 加**定向回应**（学 Piik 的"点某个人的沙发，只对 ta 比一个"）：
 * ▎为什么在应用层加 `to` 而不是新开一条通道：mediasoup 的 DataChannel 是**广播**语义
 *   （服务器不知道"这条只给谁"），所以"发给某人"只能靠消息里带定向头、接收方各自过滤——
 *   这正是 F5 屏幕批注已经验证过的同一套做法（annot 消息的 to 字段），复用而不是另造一套。
 * ▎定向 ≠ 隐私：消息仍然到了所有人手里，只是别人不显示。这是教学版必须说清的边界
 *   （真要私密得走端到端加密，不在本轮范围）。
 * ▎为什么 20 秒自动过期：目标人可能随时离开/关页，定向状态不清就会"对着空气比心"。 */
let reactTarget = null; // { id, name, until }
const REACT_TARGET_TTL_MS = 20000;
const reactChip = document.createElement('span');
reactChip.className = 'react-to hidden';
try { reactBar.appendChild(reactChip); } catch (e) { /* 桩里没有容器就算了 */ }

function setReactTarget(id, name) {
  reactTarget = id ? { id, name: name || 'TA', until: Date.now() + REACT_TARGET_TTL_MS } : null;
  renderReactChip();
}
function liveReactTarget() {
  if (reactTarget && Date.now() > reactTarget.until) reactTarget = null; // 过期自动收回
  return reactTarget;
}
function renderReactChip() {
  const t = liveReactTarget();
  reactChip.classList.toggle('hidden', !t);
  reactChip.textContent = t ? `→ ${t.name}` : '';
  reactChip.title = t ? '本次回应只发给 TA（再点一次回应条外的 ✕ 取消）' : '';
}
reactChip.addEventListener('click', () => setReactTarget(null)); // 点一下就取消定向

for (const btn of reactBar.querySelectorAll('.react-btn')) {
  btn.addEventListener('click', () => sendReact(btn.dataset.emoji));
}
function sendReact(emoji) {
  if (!myRoom) return;
  /* ★ 2026-10-10：守卫从 `!dp || dp.closed` 换成 dcOpen()（同一个 connecting 洞，见 sendOnDc 上面那段）。
   *   表情回应只有 SCTP 这一条路，所以这里的话术是"没发出去"而不是"慢一点"——
   *   它必须仍然是**说出来**的：否则用户按了按钮、屏幕上飞了 emoji（spawnFlyingEmoji 在下一行），
   *   别人那边却什么都没发生，这是"界面在撒谎"的最小样本。 */
  if (!dcOpen(chatDataProducer)) {
    showToast('数据通道未就绪，回应没发出去', 'info');
    return;
  }
  const t = liveReactTarget();
  renderReactChip(); // 顺手把可能已到期的定向状态同步到界面
  const sent = sendOnDc(chatDataProducer, {
    type: 'react', emoji,
    to: t ? t.id : undefined, // 定向头：接收端各自过滤（广播语义下的应用层私聊）
    msgId: `${socket.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  }, '回应');
  if (!sent) {
    /* 上面 dcOpen 说"能发"而这里发失败 = 就在这一瞬间频道变了（关掉了）。
     *   这时候**不许**让本地飞屏留下来冒充成功——先把话说清楚再决定画不画。 */
    showToast('数据通道刚好断了，回应没发出去', 'warn');
    return;
  }
  spawnFlyingEmoji(emoji); // mediasoup 不会把消息回给发送者，自己的先飞起来
  if (t) {
    showToast(`已回应 ${t.name}：${emoji}`, 'info');
    setReactTarget(null); // 一次一发，不常驻定向（防误发）
  }
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

/* ★ 2026-10-06 第 48 步：屏幕格的**模糊衬底**——把"比例不协调"从"两条死黑边"变成"画面自己铺满"。
 * ▎为什么这是这一项的正解而不是"把黑边调淡一点"：
 *   共享的内容比例由对方决定（16:10 的笔记本、竖着的代码窗口、4:3 的老 PPT），
 *   而我们**绝不能为了填满格子去裁它**（文档边缘被切掉=没共享，这是 10-05 定 contain 的原因）。
 *   contain 一定留边，留边就一定"看起来像坏了"——除非那块地方不再是空的。
 *   同一帧放大模糊铺在底下，人眼读到的是"这就是一个画面"，而不是"画面里嵌了个小图"。
 *   （腾讯会议/Zoom 的 fit 模式背后是同一招，零依赖可手写。）
 * ▎为什么用第二个 <video> 而不是 canvas 逐帧画：
 *   canvas 方案要自己跑 rAF + drawImage（每帧一次主线程工作，还会跟滤镜抢），
 *   而两个 video 元素共用同一条 MediaStream 时，**解码只有一份**，
 *   模糊与缩放全在合成器里做（filter/transform 都是合成层属性）。
 * ▎成本如实说：屏幕格通常全场只有一两格（共享者本人），所以这份合成开销是有界的；
 *   它不参与任何功能判断——衬底画不出来也只是回到原来的黑边，不会把共享弄丢。
 * ▸ 幂等：一格最多一块衬底（重复 attach / 换 producer 都走这里），且永远插在最底下。 */
function ensureScreenBackdrop(box, sharp) {
  if (!box || !sharp) return null;
  let bg = box.querySelector('video.tile-blur');
  if (!bg) {
    bg = document.createElement('video');
    bg.className = 'tile-blur';
    bg.muted = true;               // 不静音就是回声（坑 9 同一条）
    bg.playsInline = true;
    bg.setAttribute('aria-hidden', 'true');   // 装饰，读屏不该念它
    bg.tabIndex = -1;
    /* 追加在**最后**，靠 z-index 分层（衬底 0 / 主画面 1 / 批注与按钮 2~4）。
     *   ▎为什么不"插到最前面"（那才是直觉的写法）：那样它就成了格子里第一个 <video>，
     *     而"按位置取第一个 video"这个写法在项目里已经存在好几处（画中弹、e2e 量帧数、
     *     只听不看…）——它们会静默拿到这块糊的。坑 77 的教训是：**给已有节点加子元素，
     *     别去动它现有子节点的相对位置**。层级交给 z-index，DOM 顺序交给追加。 */
    box.appendChild(bg);
  }
  if (bg.srcObject !== sharp.srcObject) {
    bg.srcObject = sharp.srcObject;
    /* play() 在没有手势的自动播放策略下会 reject——这里**不能**让它冒泡成未处理拒绝，
     * 也不能因为衬底没动起来就把共享判成失败（它只是装饰）。 */
    try { const p = bg.play && bg.play(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* 老内核没有 play 返回值 */ }
  }
  return bg;
}

/* ---- 共享者的"我的屏幕"格：共享时给自己也开一块（观众视角确认 + 批注落点）---- */
function addSelfScreenTile(track) {
  if (peerScreens.has(socket.id)) return;
  const key = `${socket.id}::screen-self`;
  const tile = ensureTile(key, '我的屏幕（共享中）');
  tile.video.srcObject = new MediaStream([track]);
  tile.video.muted = true; // 本地画面必须静音（坑 9 同款，防回声）
  tile.box.classList.add('source-screen'); // ★ 2026-10-05 问题⑥：与远端屏幕格共用同一条 contain 规则
  ensureScreenBackdrop(tile.box, tile.video); // ★ 第 48 步：本地屏幕格同样铺衬底（自己看着也协调）
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
  penBtn.innerHTML = ICONS.pen;
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
  clearBtn.innerHTML = ICONS.trash;
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

/* ══ ★ 2026-10-10 「往 SCTP 频道发一条」的唯一一条路（SCTP 发送判据收口）══
 * ▎为什么现在才收口：全项目五处 `.send(` 各写一遍守卫，而守卫的判据是
 *   `!dp || dp.closed`——**这个判据挡不住真正会踩到的那个状态**。
 *   证据在打包好的 vendor 里读得清清楚楚（mediasoup-client 3.x 的 DataProducer）：
 *     · `get closed()` 只反映"有没有人调过 close()"（`this._closed`），
 *     · `send(data)` 里**只**在 `_closed` 时抛自己的 InvalidStateError，
 *       否则直接 `this._dataChannel.send(data)` 转发（sfu/public/vendor/mediasoup-client.js:3146 一带），
 *     · 于是频道还在 `connecting`（刚 produce、SCTP 关联没建完）时，
 *       抛的是**浏览器**那句 `Failed to execute 'send' on 'RTCDataChannel':
 *       RTCDataChannel.readyState is not 'open'` —— 报错里的接口名是 RTCDataChannel，
 *       不是 DataProducer，这就是"谁抛的"的指纹。
 *   而 `closed === false` 在 connecting 阶段成立 ⇒ 旧守卫形同虚设。
 * ▎现场证据：`npm run check:all` 里 check:board 报"页面脚本异常：Uncaught"、
 *   check:console 同时抓出那句 RTCDataChannel 抛错，两条尺指向同一根因。
 * ▎比抛错更糟的一半在**顺序**上：sendBoard 里那条 `board-signal` 信令兜底
 *   写在 `.send()` **之后**——于是"通道还没开"这一路既炸出未捕获异常、
 *   又一条兜底都没发出去；而 10-04f 加这条兜底的理由正是"晚到的人永久错过笔迹"。
 *   一条防"时灵时不灵"的机制，在它最该起作用的那个时刻不工作（坑 76 的形状：
 *   机制在 ≠ 机制生效；这里是"机制在，但被前一行挡住了"）。
 * ▸ 判据只写这一处；调用方只问"发出去了吗"，兜底/提示/静默各自决定。
 *   `dp.readyState` 不存在时（冒烟桩里那种简化对象）按"能发"处理，
 *   因为**桩的缺字段不该变成产品的功能消失**（坑 83 的反面：桩缺能力会让分支永久不测，
 *   桩多给能力则会掩盖问题——这里选择让桩走通主路，另用一条专门用例测 connecting）。 */
function dcOpen(dp) {
  if (!dp || dp.closed) return false;
  return !dp.readyState || dp.readyState === 'open';
}
function sendOnDc(dp, payload, tag) {
  if (!dcOpen(dp)) return false;
  try {
    dp.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
    return true;
  } catch (e) {
    log(`⚠️ ${tag}：SCTP 发送失败（${e && e.message}）——按"没发出去"处理`);
    return false;
  }
}

let annotSctpWarned = false;   // 「这一笔没发出去」只提一次（每帧一条就是噪音）
function sendAnnot(toScreenOwner, op, p) {
  /* ★ 2026-10-10：原来是 `if (!dp || dp.closed) return;` + 裸 `.send()`——
   *   `connecting` 阶段照样同步抛 DOMException（白板那处是同一个病，见 sendBoard 上面那段）。
   *   批注只有 SCTP 这一条路（没有信令兜底：批注是"贴在某人屏幕上"的临时笔迹，
   *   为它再造一条信令路 = 多一份要维护的账，而丢一笔的代价远小于白板丢一笔）。
   *   ▸ 所以这里的修法不是加兜底，是**不炸 + 说实话**：静默放弃会让用户以为自己画错了，
   *     而"这一笔别人看不见"是必须当场说出来的事实（10-05b 那条"门口静默丢弃"同一条纪律）。 */
  if (!sendOnDc(annotDataProducer, {
    type: 'annot', msgId: `${socket.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    to: toScreenOwner, op,
    x: p ? p.x : undefined, y: p ? p.y : undefined,
    color: myAnnotColor,
  }, '批注') && !annotSctpWarned) {
    annotSctpWarned = true;
    showToast('批注通道还没就绪，这一笔只有你看得见', 'info');
  }
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
/* ★ 09-19e 色板改成 {v 十六进制, n 色名} 之后，这里漏了 `.v`：
 *   boardColor 初始是**对象**，而 `ctx.strokeStyle = 对象` 会被浏览器**静默忽略**
 *   ——不报错、不警告，笔迹一律画成默认黑。症状是"色板点了没反应"，
 *   而点过一次色点之后 boardColor 变成字符串，又正常了 → 只有"进白板第一笔"必黑。
 *   本轮做白板持久化时暴露：服务器按 hex 校验颜色，把这笔"{v,n}"直接拒了，
 *   才顺着查到这里。**一个静默失败的赋值 + 一个只在特定路径上才正确的初值**，
 *   是最难被肉眼发现的那类前端 bug（node --check、冒烟、截图都看不出来）。 */
let boardColor = BOARD_COLORS[0].v;
const boardStrokes = []; // 事件溯源账本
let boardDrawing = false;
let boardOn = false;

function boardColorFor(id) { // 对端没带 color 时的兜底（浅底用深色板）；★ 返回 hex 字符串，同上
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BOARD_COLORS[h % BOARD_COLORS.length].v;
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
/* ★ 2026-10-03 白板的"撤销一笔 / 清空整块"抽成具名函数。
 * ▎为什么抽：按钮回调之外现在有**第二个调用者**——AI 房间动作（第 36 步的 room-control）。
 *   同一条 LEARN 5.45.3 的教训：内联在回调里就没法被别处（也没法被测试）调用，
 *   而"AI 清空白板"和"人点清空"必须是**同一条代码路径**，否则两边的行为会慢慢不一样
 *   （比如一边广播了归档、另一边忘了）。 */
function undoBoard() {
  applyBoardOp(boardColor, 'undo');
  sendBoard('undo');
}
function clearBoard() {
  applyBoardOp(boardColor, 'clear');
  sendBoard('clear');
}
$('boardUndoBtn').addEventListener('pointerdown', undoBoard);
$('boardClearBtn').addEventListener('pointerdown', clearBoard);
/* ★ 2026-10-04 导出用 click 而不是 pointerdown：撤销/清空是"画布上的即时动作"，
   与工作台那套"只发会被重放的事件"的约定同源；而导出是**下载**，
   浏览器的下载许可看的是真实点击手势，挂在 pointerdown 上反而更脆。 */
$('boardPngBtn').addEventListener('click', exportBoardPng);
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
/* ══ 第 41 步：AI 思考条（移植 reactbits ThoughtLine 的运动语言，零依赖）════════════
 * ▎顺带修掉一条"上线以来从没生效过"的功能：09-30 起服务器就在 ai-state 里带 phase
 *   （检索中 / 换个说法再找 / 组织回答），客户端 setAiState 也留了第三个参数，
 *   但**监听器只解构 {state, text}** —— 阶段信息在门口就被丢了，
 *   界面上那句"正在翻会议记录…"从上线起一次都没显示过（坑 56 第五次复发：
 *   内层算出来了、外层没带出来，而且两边代码看着都对，只有端到端断言抓得到）。
 * ▎样式在 style.css 第 30 节：呼吸 / 微光 / 两层文案收焦 / 阶段清单 grid-rows 折叠。
 *   计时器不需要原组件的 ResizeObserver 滑移——文案两层同格叠放后宽度恒定，尾巴不跳。 */
const TL_STEPS_MAX = 6;   // 清单上限：一场长会反复问答，不能无限攒节点
/* ▎为什么 tile 存在这里而不是让函数去读全局 aiTileEl：
 *   组件**拥有自己的根**才能被单独驱动（真浏览器检查就是拿一个合成格子来跑的）。
 *   原先 tlEls() 直接读 aiTileEl，等于把"思考条"和"当前那块 AI 格子"焊死——
 *   换格子、重建、离线验证都得先伪造全局，这是不可测的形状。 */
const tlLine = { tile: null, timer: 0, t0: 0, ds: 0, steps: [], working: false, open: false };
const TL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M12 4l1.8 4.7 4.7 1.8-4.7 1.8L12 17l-1.8-4.7-4.7-1.8 4.7-1.8L12 4z"/></svg>';
const TL_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const TL_TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
/* 计时口径与原组件一致：内部存"分秒"(ds = 1/10 秒)，显示 3.2s / 1m 05.0s */
function tlFmt(ds) {
  const n = Math.max(0, Math.round(Number(ds) || 0));
  return n < 600 ? (n / 10).toFixed(1) + 's' : Math.floor(n / 600) + 'm ' + ((n % 600) / 10).toFixed(1) + 's';
}
function tlEls() {
  const tile = tlLine.tile;
  if (!tile) return null;
  const root = tile.querySelector('.tl');
  const trace = tile.querySelector('.tl-trace');
  return root && trace ? { root, trace, list: trace.querySelector('.tl-trace__list') } : null;
}
function tlRenderSteps() {
  const e = tlEls();
  if (!e || !e.list) return;
  e.list.textContent = '';
  tlLine.steps.forEach((txt, i) => {
    const done = !tlLine.working || i < tlLine.steps.length - 1;
    const row = document.createElement('div');
    row.className = 'tl-step';
    if (done) row.setAttribute('data-done', '');
    const mark = document.createElement('span');
    mark.className = 'tl-step__mark';
    mark.innerHTML = done ? TL_TICK : '<i class="tl-pulse"></i>';
    const s = document.createElement('span');
    s.className = 'tl-step__txt';
    s.textContent = txt;
    row.appendChild(mark); row.appendChild(s);
    e.list.appendChild(row);
  });
  if (tlLine.steps.length) e.root.setAttribute('data-has-trace', '');
  else e.root.removeAttribute('data-has-trace');
}
function tlTick() {
  const e = tlEls();
  tlLine.ds = Math.floor((performance.now() - tlLine.t0) / 100);
  if (e) { const t = e.root.querySelector('.tl__timer'); if (t) t.textContent = tlFmt(tlLine.ds); }
}
/* 开始思考：起计时、清清单、展开 trace。重复调用是幂等的（每个 phase 都会调一次）。 */
function tlStart(firstLabel) {
  const e = tlEls();
  if (!e) return;
  if (!tlLine.working) {
    tlLine.working = true; tlLine.t0 = performance.now(); tlLine.ds = 0; tlLine.steps = []; tlLine.open = true;
    clearInterval(tlLine.timer);
    tlLine.timer = setInterval(tlTick, 100);          // 定稿/换态必停（见 tlStop）
    e.root.setAttribute('data-working', '');
    e.trace.setAttribute('data-open', '');
  }
  if (firstLabel) tlPhase(firstLabel);
  else tlRenderSteps();
}
/* 记一个阶段。**阶段就是当前文案**——所以这里同时更新清单与徽标头部，
 *   调用方不必（也不该）自己再 tlSay 一遍：两处各写一次迟早会漂（坑 47）。
 *   与上一条相同就直接返回：服务器每个 delta 都可能带同一个 phase。 */
function tlPhase(txt) {
  const t = String(txt || '').trim();
  if (!t) return false;
  if (tlLine.steps[tlLine.steps.length - 1] === t) return true;
  tlLine.steps.push(t.slice(0, 40));
  if (tlLine.steps.length > TL_STEPS_MAX) tlLine.steps.splice(0, tlLine.steps.length - TL_STEPS_MAX);
  tlRenderSteps();
  tlSay(t, true);
  return true;
}
/* 想完了：停计时、文案收焦成"想了 X.Xs"、清单折叠（用户仍可点徽标展开回看）。 */
function tlStop() {
  const e = tlEls();
  if (!e) return;
  if (!tlLine.working) return;
  tlLine.working = false;
  clearInterval(tlLine.timer); tlLine.timer = 0;      // ★ 长跑纪律：不停就是每轮问答漏一个定时器
  tlLine.open = false;
  e.root.removeAttribute('data-working');
  e.trace.removeAttribute('data-open');
  const done = e.root.querySelector('.tl__txt--done');
  if (done) {
    const b = done.querySelector('.tl__breath') || done;
    b.textContent = tlLine.steps.length ? '想了 ' + tlFmt(tlLine.ds) : '思考完毕';
  }
  tlRenderSteps();
}

/* 格子被移除时：停计时 + 清空清单状态。
 * ▎为什么单独一个函数：tlStop() 会去写 DOM，而移除路径上格子正在消失；
 *   定时器如果不停，就会一直给一个已经不在树上的节点写 textContent
 *   ——和 10-02 那条"clearAiGesture 不停定时器 = 给已移除节点加类"是同一个坑。 */
function tlReset() {
  clearInterval(tlLine.timer); tlLine.timer = 0;
  tlLine.working = false; tlLine.steps = []; tlLine.ds = 0; tlLine.open = false;
  tlLine.tile = null;   // 组件不再持有已消失的格子（否则定时器与引用都留在死节点上）
}

/** 把 AI 格子里那个静态徽标换成会呼吸的思考条（只建一次，重复调用幂等）。 */
function buildThinkLine(tile) {
  if (!tile) return;
  if (tile.querySelector('.tl')) { tlLine.tile = tile; return; }
  tlLine.tile = tile;
  const old = tile.querySelector('.ai-status');
  const root = document.createElement('span');
  root.className = 'tl ai-status';
  root.innerHTML = '<span class="tl__glyph">' + TL_ICON + '</span>'
    + '<span class="tl__stack">'
    + '<span class="tl__txt" data-active><span class="tl__breath" data-shimmer>聆听中…</span></span>'
    + '<span class="tl__txt tl__txt--done"><span class="tl__breath">思考完毕</span></span>'
    + '</span><span class="tl__timer">0.0s</span>'
    + '<span class="tl__chevron">' + TL_ARROW + '</span>';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.tabIndex = -1;
  const trace = document.createElement('div');
  trace.className = 'tl-trace';
  trace.innerHTML = '<div class="tl-trace__fold"><div class="tl-trace__list"></div></div>';
  if (old && old.parentNode) old.parentNode.replaceChild(root, old);
  else tile.appendChild(root);
  tile.appendChild(trace);
  // 点徽标开合清单（有清单才可点；tabIndex 随之开放，键盘也能用）
  root.addEventListener('click', () => {
    if (!tlLine.steps.length) return;
    tlLine.open = !tlLine.open;
    if (tlLine.open) trace.setAttribute('data-open', ''); else trace.removeAttribute('data-open');
    if (tlLine.open) root.setAttribute('data-open', ''); else root.removeAttribute('data-open');
  });
}
/* 文案层（两层同格叠放，切换靠 data-active 交叉淡入 + 收焦） */
function tlSay(txt, shimmer) {
  const e = tlEls();
  if (!e) return;
  const cur = e.root.querySelector('.tl__txt[data-active]');
  if (cur) {
    const b = cur.querySelector('.tl__breath');
    if (b) {
      b.textContent = txt;
      if (shimmer) b.setAttribute('data-shimmer', ''); else b.removeAttribute('data-shimmer');
    }
  }
}

const AI_STATE_LABEL = { idle: '聆听中…', listening: '聆听中…', thinking: '思考中…', speaking: '正在发言…', happy: '任务完成！' };
/* ★ 09-30：把"思考中"拆成**有信息量的阶段**。
 * ▎为什么这是最划算的体感优化：用户说的"卡"，多半不是真的慢，而是**看不出它在干什么**。
 *   改造前整段等待只有一句静止的"思考中…"；若触发查询改写还要凭空多等 1~3 秒——
 *   在用户眼里和卡死没有区别。摊开阶段后，等待从"黑箱"变成"有进度"，
 *   而且每一句都**说了实话**（它确实在做这件事），不掺任何"假进度条"手法。 */
const AI_PHASE_LABEL = {
  retrieving: '正在翻会议记录…',
  rewriting: '第一遍没找到，换个说法再找…',
  generating: '正在组织回答…',
  done: '正在发言…',
};

function setAiState(st, speechText, phase) {
  if (!AI_STATES.includes(st)) return;
  aiAvatar.state = st;
  /* ★ 09-30：思考态优先显示**具体阶段**（"正在翻会议记录…"），拿不到阶段才退回泛化文案。
   *   阶段文案只对 thinking 生效——其它状态（聆听/发言/完成）没有阶段概念，
   *   硬套会说出"正在翻会议记录"却其实在发言这种假话。 */
  const thinkLabel = (st === 'thinking' && phase && AI_PHASE_LABEL[phase]) || null;
  /* ★ 2026-10-02 状态一律走 class 驱动 CSS，**不再换图片 src**：
   *   旧版这里按 speaking 在 talk/idle 两张循环 WebP 之间切 src——那既是"重影"的一半
   *   （两张都是自带残影的动画），也是"只会一个动作"的根源（循环素材不可能看场合变招）。
   *   现在形象只有一张静帧，动作全交给下面的 CSS 状态类 + 随机小动作调度器。 */
  const talking = st === 'speaking';
  if (aiAvatar.rowEl) aiAvatar.rowEl.classList.toggle('speaking', talking);
  if (aiTileEl) {
    /* ★ 第 41 步：状态文案交给"思考条"（两层文案同格叠放 + 呼吸/收焦），
     *   并**把 phase 真正用起来**——服务器从 09-30 就在发 phase，客户端一直在门口丢掉。
     *   ▸ 原来这一行是把整段状态文案直接写进徽标的 textContent：
     *     对思考条来说这是灾难——textContent 会把它整个子树连图标、计时器、清单一起清掉。
     *     （这也是本项目第二次踩"改文案顺手清了图标"，09-26 那次是头像。）
     *     ▸ 注释里刻意不复写那行旧代码的字面形式——它会被防回退的负向断言当成"代码还在"抓到。 */
    if (st === 'thinking') {
      tlStart();
      /* 阶段就是当前文案，交给 tlPhase 一处驱动（它内部会同时更新清单与头部）。
       *   原先这里写成 tlPhase() + tlSay() 两句——两个调用点说同一件事，迟早会漂（坑 47）。 */
      tlPhase(thinkLabel || AI_STATE_LABEL.thinking);
    } else {
      tlStop();
      tlSay(AI_STATE_LABEL[st], false);
    }
    aiTileEl.classList.toggle('speaking', talking);
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
  /* ★ 2026-10-07 五代：表情不再换 src——状态类（.speaking/.thinking/.happy）已在上面的
   *   tile/row toggle 里就位，SVG 元素变形全由 CSS 按这些类驱动，这里无事可做。 */
  /* ★ 2026-10-06 只有状态**真的换了**（或手上根本没有排程）才重排小动作。
   *   ▎为什么这是缺陷而不是洁癖：armAiGestures() 的第一件事是 clearAiGesture()——把等中的
   *     定时器清掉再重排一个 7~14 秒的新等待。而它原先挂在**每一条** ai-state 消息上。
   *     服务器每建一条听觉管线就广播一次 listening（registerAiPipe：每个开麦的人一次、
   *     重连一次、producer 替换一次），于是"同一条状态重复广播"= **等待从头再来**，
   *     只要广播间隔短于 7 秒，小动作就**永远排不到**。
   *     用户看到的就是"它一动不动、动态效果没有变化"——而状态文案、呼吸、字幕全都正常，
   *     所以这件事在日志里完全没有痕迹（坑 90 同一条：把"最后一次事件"当"最后一次进展"，
   *     事件跑得比进展快，闸就永久饿死）。
   *   ▸ `!aiAvatar.gestureTimer` 那一半管开局：首帧若就是当前状态，也要补排一次。 */
  if (st !== aiAvatar.prevState || !aiAvatar.gestureTimer) armAiGestures();
  aiAvatar.prevState = st;
  /* 状态换了要把"耳朵"重算一遍：speaking 期间波形归"它在说话"，
     说完之后同一批 audio-levels 数据还在，得立刻交还给"在听谁"（否则要等下一次上报才回位）。 */
  applyAiListening(lastLevels);
}
let aiSpeechTimer = 0;

/* ──────────────────────────────────────────────────────────────
 * ★ 2026-10-02 AI 头像"小动作"调度器（用户点名：不要一直重复一个动作，不同时候做不同动作）
 * ▎为什么用 JS 调度而不是 CSS 一条 infinite 动画：infinite 就是"永远同一段循环"，
 *   那正是用户嫌的机器感。偶发、不可预测的**一次性**动作才像活物——
 *   所以这里排一个 7~14 秒的随机定时器，到点从动作池里挑**一个**演，演完摘类再排下一次。
 * ▎为什么只在 idle / listening 演：speaking 时身体该随说话律动、thinking 时该"抬头想"，
 *   再叠一个随机点头就成了抽搐（同一元素同一时刻只允许一条动画，见 style.css 第 27 节）。
 * ▎防"永久占位"：animationend 与超时保险丝都会走同一个 finish，但 finish 只生效一次——
 *   否则动画被打断（切状态/切布局）时类没摘掉，之后就再也不会做小动作了。
 * ────────────────────────────────────────────────────────────── */
const AI_GESTURES = ['g-nod', 'g-tilt', 'g-peek-l', 'g-peek-r', 'g-sway', 'g-breath-deep'];
/* ★ 2026-10-04i 头像"说话律动"（音频驱动）：AI 自己的 TTS 音频经 WebAudio 实时分析，
 *   面部亮度/饱和度与轻微缩放随**真实音量**起伏——静态形象第一次"开口"。
 *   ▸ transform 通道被状态动画占用（坑 47：一个通道一个来源），律动走 filter
 *     + 外层 wrap 的 scale，两不打架。
 *   ▸ 两条语音路径都接：服务端 MP3（<audio> 分析）与浏览器朗读（onboundary 脉冲）。 */
let aiFaceCtx = null, aiFaceAnalyser = null, aiFaceRaf = 0, aiFaceAmp = 0, aiFacePulseT = 0;
function attachAiFaceAudio(el) {
  try {
    if (!aiFaceCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      aiFaceCtx = new AC();
    }
    if (aiFaceCtx.state === 'suspended') aiFaceCtx.resume().catch(() => {});
    if (!aiFaceAnalyser) {
      aiFaceAnalyser = aiFaceCtx.createAnalyser();
      aiFaceAnalyser.fftSize = 256;
      aiFaceCtx.createMediaElementSource(el).connect(aiFaceAnalyser);
      aiFaceAnalyser.connect(aiFaceCtx.destination);   // 串回扬声器（分析不夺声）
    }
    if (!aiFaceRaf) startAiFaceLoop();
  } catch (e) { /* 分析失败绝不影响出声 */ }
}
function startAiFaceLoop() {
  const data = new Uint8Array(128);
  const tick = () => {
    aiFaceRaf = requestAnimationFrame(tick);
    const f = aiTileEl && aiTileEl.querySelector('.ai-face');
    if (!f) { cancelAnimationFrame(aiFaceRaf); aiFaceRaf = 0; return; }
    if (aiFaceAnalyser) {
      aiFaceAnalyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 2; i < 26; i++) sum += data[i];          // 人声主频段
      const amp = Math.min(1, sum / (24 * 150));
      aiFaceAmp += (amp - aiFaceAmp) * 0.35;                // 平滑（别闪）
      f.style.setProperty('--ai-amp', aiFaceAmp.toFixed(3));
    }
  };
  aiFaceRaf = requestAnimationFrame(tick);
}
function aiFacePulse() {  // 浏览器朗读轨：每个词边界一次脉冲（音量起伏的近似）
  const f = aiTileEl && aiTileEl.querySelector('.ai-face');
  if (!f) return;
  f.style.setProperty('--ai-amp', '0.85');
  clearTimeout(aiFacePulseT);
  aiFacePulseT = setTimeout(() => {
    const g = aiTileEl && aiTileEl.querySelector('.ai-face');
    if (g) g.style.setProperty('--ai-amp', '0.12');
  }, 150);
}
/* ══ AI 表情系统（2026-10-07 五代：位图路线整体退役，见文件头 aiAvatarSvg）══════
 * 一代整脸换口型 webp → 二代重排帧 → 三代"底脸常驻+嘴部贴片"都试过了，
 * 用户最后评的还是"能不能做得像个人做的"——问题不在动画参数，在素材本身
 * （AI 生成的 Q 版位图怎么修帧都有一股生成图味）。五代直接换掉素材层：
 * 眼/眉/嘴/腮红全是独立 SVG 元素，状态切换 = tile 的 .speaking/.thinking/.happy
 * 类驱动元素变形（CSS 内部消化），没有位图、没有图层叠印，**结构上不存在重影**。
 * 类契约与位图时代完全兼容：根 svg 挂 .ai-face，下面的调度器（呼吸/小动作/
 * 音频律动）一行不用改；眼白/嘴的"换脸"是 CSS 变形，不再需要 JS 换 src。 */

function clearAiGesture() {
  clearTimeout(aiAvatar.gestureTimer);
  aiAvatar.gestureTimer = 0;
  /* ★ 2026-10-06 摘类要摘**全部表情层**：激活类在切换瞬间会移交给下一层，
   *   如果只摘当时的 .ai-face（=新层），旧层上没演完的动作类就成残留——
   *   等这张脸再被激活时 classList.add 是同名的 no-op，动画不会重跑，
   *   小动作就此静默失联（坑 47 家族：一个概念两个来源，状态各存一份）。 */
  if (aiAvatar.gesture && aiTileEl) {
    aiTileEl.querySelectorAll('.' + aiAvatar.gesture).forEach((i) => i.classList.remove(aiAvatar.gesture));
  }
  aiAvatar.gesture = '';
  aiAvatar.gestureDone = null;
}
function armAiGestures() {
  clearAiGesture();
  if (aiAvatar.state !== 'idle' && aiAvatar.state !== 'listening') return; // 说话/思考有自己的律动
  const wait = 7000 + Math.floor(Math.random() * 7000); // 7~14s：太密=抽搐，太疏=看不出活着
  aiAvatar.gestureTimer = setTimeout(() => {
    aiAvatar.gestureTimer = 0;   // ★ 2026-10-06 这次排程已被消费：之后的"有没有排程"才是真话
    if (aiAvatar.state !== 'idle' && aiAvatar.state !== 'listening') { armAiGestures(); return; }
    const f = aiTileEl && aiTileEl.querySelector('.ai-face');
    if (!f) return;              // 格子还没建好：留着 timer=0，下一条状态广播会重新排
    const g = AI_GESTURES[Math.floor(Math.random() * AI_GESTURES.length)];
    aiAvatar.gesture = g;
    f.classList.add(g);
    const finish = () => {
      if (aiAvatar.gestureDone !== finish) return; // 只让第一次触发生效
      f.classList.remove(g);
      aiAvatar.gesture = '';
      aiAvatar.gestureDone = null;
      armAiGestures();                            // 演完接着排下一个
    };
    aiAvatar.gestureDone = finish;
    f.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, 3000);                     // 保险丝（animation 被外部覆盖时不卡死）
  }, wait);
}

function syncAiTile(present) {
  const grid = document.getElementById('videoGrid');
  if (!grid) return;
  if (present && !aiTileEl) {
    aiTileEl = document.createElement('div');
    aiTileEl.className = 'video-box ai-tile';
    const waves = '<div class="ai-waves">' + '<i></i>'.repeat(7) + '</div>';
    /* ★ 2026-10-07 五代：表情 = 一张内联 SVG 矢量脸（见 aiAvatarSvg 注释）。
     *   没有图层、没有 src 切换——状态全由 tile 的类驱动 SVG 元素变形，
     *   结构上不存在"双脸叠印"的重影；可访问性：可读名称只留一份在 wrap 上（role=img）。 */
    aiTileEl.innerHTML =
      '<div class="ai-face-wrap" role="img" aria-label="AI 小明">' + aiAvatarSvg() + '</div>' +
      waves +
      '<div class="ai-speech" aria-live="polite"></div>' +
      '<div class="video-label">AI 小明<span class="ai-status">聆听中…</span><span class="ai-ear"></span></div>';
    grid.appendChild(aiTileEl);
    buildThinkLine(aiTileEl);   // 第 41 步：静态徽标 → 会呼吸、能展开阶段清单的思考条
    tlSay(AI_STATE_LABEL[aiAvatar.state] || '聆听中…', aiAvatar.state === 'thinking');
    /* ★ 2026-10-06 格子建好了才**补排一次**小动作。
     *   ▎为什么必须在这儿补：ai-state 广播常常**早于**格子存在（点「AI」→ 服务器先播状态、
     *     room-state 才把格子建出来）。定时器到点时 `.ai-face` 还不存在 → 直接 return，
     *     而这条链上没有任何地方会再排一次 → 头像从此不再做小动作。
     *     用户报的"动态效果还是没有变化"里，这一半是**开局顺序**问题，不是动画没写。
     *     （与 setAiState 那侧的"重复广播不重排"是一对：一个防饿死，一个防漏排。） */
    armAiGestures();
    applyLayout();
  } else if (!present && aiTileEl) {
    clearAiGesture(); // ★ 2026-10-02 格子没了要连定时器一起停（否则定时器还在给已移除的节点加类）
    tlReset();        // ★ 第 41 步：思考条的计时器同理——不停就一直在给死节点写文字
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

boardBtn.addEventListener('click', () => setBoardOpen(!boardOn));

/* ★ 2026-10-02 第 36 步：白板开合抽成一个函数——因为现在有了**第二个触发源**
 *   （AI 助理说"打开白板"要替全房间打开）。内联在监听器里写死的话，
 *   第二个来源就只能把那段代码抄一遍，抄完就开始漂（本项目这类账已踩三次）。 */
function setBoardOpen(on) {
  if (boardOn === on) return;
  boardOn = on;
  boardOverlay.classList.toggle('hidden', !boardOn);
  if (boardOn) fitBoardCanvas();
  boardBtn.classList.toggle('active', boardOn);
}

// 白板画布的画笔输入三件套（坐标相对画布归一化）
boardCanvas.addEventListener('pointerdown', (e) => {
  if (e.button === 2) return;
  wbRectCache = boardCanvas.getBoundingClientRect();  // ★ 本笔期间缓存，避免每 move 强制 reflow
  wbPending.length = 0;
  const p = boardPoint(e);
  boardDrawing = true;
  applyBoardOp(boardColor, 'start', p.x, p.y);
  sendBoard('start', p);
  e.preventDefault();
});
boardCanvas.addEventListener('pointermove', (e) => {
  if (!boardDrawing) return;
  const p = boardPoint(e);
  /* ★ 09-30 性能修复：**本地点立即画**（跟手，不能等帧），但**网络发送按帧合并**。
   *   ▎为什么必须拆开这两件事（这是白板"延迟"的根因）：
   *     改造前每次 pointermove 都发一条 SCTP 消息 → **一次拖拽 = 300~1000 条**。
   *     真机高回报率鼠标（500~1000Hz）下就是每秒上千条小消息，
   *     发送缓冲排队 + 对端逐条 JSON.parse 并重绘 → 延迟随拖拽累积，越画越滞后。
   *     本地回环测不出来（CPU 只花 9ms），**真机跨网才会显形**。
   *   ▎做法与"远程控制"那条路径同构（ctlMove 每帧只发最新位置）——
   *     白板此前是这个范式**唯一的缺口**。差别在于白板**不能丢点**
   *     （丢点=笔画断裂，而鼠标移动丢中间点无所谓），所以是"按帧**打包**"而非"只留最新"。 */
  applyBoardOp(boardColor, 'draw', p.x, p.y);
  wbPending.push(p);
  if (!wbRafId) {
    wbRafId = requestAnimationFrame(() => {
      wbRafId = 0;
      flushBoardPoints();
    });
  }
});
/** 把本帧累积的点**打包成一条**消息发出去（实测：300 点拖拽 302 条 → 约 5~15 条） */
function flushBoardPoints() {
  if (!wbPending.length) return;
  sendBoard('draw', null, wbPending.slice());
  wbPending.length = 0;
}
const boardEndStroke = () => {
  if (!boardDrawing) return;
  boardDrawing = false;
  if (wbRafId) { cancelAnimationFrame(wbRafId); wbRafId = 0; }
  flushBoardPoints();       // 收笔前把最后一帧的点补发掉，否则笔尾会缺一小段
  wbRectCache = null;
  sendBoard('end');
};
boardCanvas.addEventListener('pointerup', boardEndStroke);
boardCanvas.addEventListener('pointerleave', boardEndStroke);
// 浅底白板禁用浏览器右键菜单（与桌面区同款）
boardCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

/* ★ 09-30：笔画期间的 rect 缓存。
 * ▎为什么必须缓存：`getBoundingClientRect()` 会**强制同步布局**（forced reflow）。
 *   改造前每次 pointermove 都调一次 → 一次拖拽 300~1000 次强制 reflow，
 *   叠在正在重绘的 canvas 上，主线程被拖住——这是"画起来发涩"的第二个来源。
 *   rect 在一笔之内不会变，所以缓存是安全的；失效点只有收笔与 resize（后者已清）。 */
let wbRectCache = null;
let wbPending = [];        // 本帧累积的待发送点
let wbRafId = 0;           // 待执行的 rAF id（0 = 没有排队）

function boardPoint(e) {
  const rect = wbRectCache || boardCanvas.getBoundingClientRect();
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
  wbRectCache = null;   // ★ 09-30：尺寸变了，缓存的那份 rect 立即失效（否则坐标会错位）
  const dpr = window.devicePixelRatio || 1;
  boardCanvas.width = Math.round(rect.width * dpr);
  boardCanvas.height = Math.round((rect.height - 46) * dpr); // 减标题栏高度
  const ctx = boardCanvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  redrawBoard();
}
function applyBoardOp(color, op, x, y, batch) {
  if (op === 'start') {
    boardStrokes.push({ color, pts: [{ x, y }] });
    drawBoardDot(color, x, y);
  } else if (op === 'draw') {
    const s = boardStrokes[boardStrokes.length - 1];
    if (!s) return;
    /* ★ 09-30：支持**一批点**一次画完（对端按帧打包发来的）。
     *   ▎为什么要一批一起画而不是逐点调：逐个点会变成 N 次 beginPath/stroke，
     *     而连续的段本可以用**一条路径**一次描边——canvas 的 stroke 调用开销
     *     主要在状态设置与路径提交，合并后 GPU/光栅化只有一次。
     *   ▎同时把点一次 push 进账本：账本是 undo/重绘的依据，必须与画出来的严格一致。 */
    const list = batch && batch.length ? batch : [{ x, y }];
    const ctx = boardCanvas.getContext('2d');
    const { w, h } = boardCssSize();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    let p0 = s.pts[s.pts.length - 1];
    ctx.moveTo(p0.x * w, p0.y * h);
    for (const pt of list) {
      /* ★ 2026-10-04f 兼容两种点格式：网络上来的是 **[x,y] 数组**（sendBoard 打包时
       *   为省字节序列化成数组），本地调用传的是 {x,y} 对象。原实现只读 pt.x/pt.y
       *   ——对数组全是 undefined → lineTo(NaN) → **远端笔迹从上线起就没画出来过**
       *   （只有起笔圆点；双浏览器像素断言首跑抓到，坑 76"写了但没生效"同族）。 */
      const px = Array.isArray(pt) ? pt[0] : pt.x;
      const py = Array.isArray(pt) ? pt[1] : pt.y;
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
      s.pts.push({ x: px, y: py });
      ctx.lineTo(px * w, py * h);
    }
    ctx.stroke();   // ← 整批只描一次边（不是每段一次）
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
/* ★ 09-30：`drawBoardSegment`（单段描边）已删除——它的两个调用点都改成了
 *   "一批点一次描边"，留着就是幽灵代码（防 AI 通病五戒之一：改完要清死代码）。 */
function drawBoardDot(color, x, y) {
  const { w, h } = boardCssSize();
  const ctx = boardCanvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x * w, y * h, 2.2, 0, Math.PI * 2);
  ctx.fill();
}
/* ★ 2026-10-04 「怎么把一笔笔画出来」只有这一个实现：屏幕重绘与导出 PNG 共用它。
 *   ▎为什么要抽：导出最容易出的错不是"导不出来"，而是"导出来的和看到的不一样"
 *     （线宽、起笔圆点、坐标换算各写一份，改一处漏一处）。抽成一个函数之后，
 *     这两件事**结构上不可能漂移**（坑 47）。
 * @param w/h CSS 像素尺寸（账本存的是 0~1 归一化坐标，所以任何尺寸都能重放） */
function drawBoardStrokes(ctx, w, h) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  /* ★ 09-30：**一笔一条路径**（而不是一段一次 stroke）。
   *   ▎为什么：改造前每个线段都自己 beginPath/stroke——一笔 500 点就是 500 次描边，
   *     撤销/清空/resize 时整屏重放直接卡住（实测递增到 4.3ms 且随点数线性增长）。
   *     合并成一条路径后，同一笔的所有线段一次提交，开销与**笔数**相关而非**点数**。 */
  for (const s of boardStrokes) {
    if (!s.pts.length) continue;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(s.pts[0].x * w, s.pts[0].y * h, 2.2, 0, Math.PI * 2);   // 起笔圆点
    ctx.fillStyle = s.color;
    ctx.fill();
    if (s.pts.length > 1) {
      ctx.beginPath();
      ctx.moveTo(s.pts[0].x * w, s.pts[0].y * h);
      for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i].x * w, s.pts[i].y * h);
      ctx.stroke();
    }
  }
}

function redrawBoard() {
  const { w, h } = boardCssSize();
  const ctx = boardCanvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  drawBoardStrokes(ctx, w, h);
}

/* ★ 2026-10-04 白板导出 PNG。
 * ▎为什么要做：白板画完的东西**只存在服务器内存账本里**，散会即失——
 *   而会上画的东西往往是"要带走的那部分"（草图、结论、待办结构）。
 *   记要（N2）能覆盖文字，覆盖不了图形。
 * ▎纸底要自己画：屏幕上那层宣纸质感是 CSS（渐变 + 颗粒），canvas 像素里并没有它，
 *   直接 toDataURL 会得到一张透明底的图。这里按 CSS 里那个纸色铺底，
 *   再叠一层四缘渐晕——**不追求像素级一致，但导出必须是一张能看的纸**。
 * ▎右下角留一行出处（房间号 / 时间 / 笔数）：一张没有出处的会议草图，
 *   第二天就没人知道它是哪场会的。 */
function exportBoardPng() {
  const { w, h } = boardCssSize();
  if (!w || !h) { showToast('白板还没准备好（画布尺寸是 0）', 'error'); return; }
  const SCALE = 2;                       // 2x 导出：文字与线条在放大时不发虚
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * SCALE);
  cv.height = Math.round(h * SCALE);
  const ctx = cv.getContext('2d');
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = '#ece7db';             // 与 style.css 第 15 节的纸色一致
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createRadialGradient(w / 2, h * 0.42, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.78);
  g.addColorStop(0, 'rgba(58, 46, 28, 0)');
  g.addColorStop(1, 'rgba(58, 46, 28, 0.12)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  drawBoardStrokes(ctx, w, h);
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(58, 46, 28, .45)';
  ctx.textAlign = 'right';
  const stamp = new Date().toLocaleString();
  ctx.fillText(`云会议 · 房间 ${myRoom || '—'} · ${stamp} · ${boardStrokes.length} 笔`, w - 10, h - 10);
  cv.toBlob((blob) => {
    if (!blob) { showToast('导出失败（浏览器不允许把画布转成图片）', 'error'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `whiteboard-${myRoom || 'room'}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 立刻 revoke 会让下载在部分浏览器里失败；留一拍再释放（否则每次导出漏一个 Blob URL）
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, 'image/png');
  log(`🖌 白板已导出 PNG（${boardStrokes.length} 笔）`);
}
// 窗口变形 → 白板重对齐（归一化账本重放，笔迹不丢）；防御式注册（无头环境）
if (typeof window.addEventListener === 'function') {
  window.addEventListener('resize', () => { if (boardOn) fitBoardCanvas(); });
}

// 收到别人的白板笔迹（'board' 频道路由，见 subscribeData；信令兜底见 board-signal）
const seenBoardIds = new Set();     // ★ 双发去重：SCTP 与信令各到一次，msgId 相同只画一次
function markSeenBoardId(msgId) {
  if (seenBoardIds.size > 600) seenBoardIds.clear();
  seenBoardIds.add(msgId);
}
function handleBoardMessage(from, message) {
  try {
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
    const msg = JSON.parse(text);
    if (msg.type !== 'board') return;
    /* ★ 2026-10-04f 双路径去重（与聊天的 seenChatIds 同款）：同一条笔迹可能从
     *   SCTP 与信令兜底各到一次——只画一次，且"先到的算数"。 */
    if (msg.msgId && seenBoardIds.has(msg.msgId)) return;
    if (msg.msgId) markSeenBoardId(msg.msgId);
    /* ★ 09-30：优先读**批量点**（新格式 pts 数组），退回单点（老格式 x/y）。
     *   ▎为什么保留单点分支：协议升级必须**向后兼容**——
     *     房间里只要有一个旧版本客户端（没刷新页面的人）还在，它发的就是单点消息。
     *     不兼容的话会表现为"某些人的笔迹画不出来"，极难排查。
     *     多花的代价只是一个 `||` 判断。 */
    applyBoardOp(msg.color || boardColorFor(from), msg.op, msg.x, msg.y, msg.pts);
  } catch (e) { /* 坏消息不炸频道 */ }
}
/* 信令兜底接收：SCTP 'board' 通道对晚到者/消费竞态时灵时不灵（真浏览器 e2e 实测），
 * 白板此前只有一条路 = 晚到的人永久错过笔迹。现在与聊天同款双路径。 */
socket.on('board-signal', ({ from, payload } = {}) => {
  if (from === socket.id) return;               // 自己发的本地已经画过
  handleBoardMessage(from, payload);
});
let boardSctpWarned = false;   // 「这一场走信令」只提一次（每帧一条就是噪音）
function sendBoard(op, p, batch) {
  /* ★ 2026-10-10 这里原来第一行是 `if (!boardDataProducer || boardDataProducer.closed) return;`
   *   ——**判据错在两个地方**，而它们叠起来正好是用户报的那句"白板时灵时不灵"：
   *   ① 它把"没有 SCTP 频道"当成"什么都不能发"，可这条消息明明还有信令那条路；
   *   ② `closed=false` 挡不住 `connecting`，于是频道刚建好那几百毫秒里
   *     `.send()` 同步抛 DOMException —— 抛出在**兜底那两行之前**，
   *     结果是"既炸了、又一条都没发出去"。
   *   ▸ 现在：主路发不出去就继续走兜底（与聊天 D+1 同款双路径 + msgId 去重，
   *     多收到一份会被 dedup 掉，所以双发是安全的）。 */
  const payload = {
    type: 'board', msgId: `${socket.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    op, color: boardColor,
  };
  if (p) { payload.x = p.x; payload.y = p.y; }
  /* ★ 09-30：一批点走 `pts`（坐标已四舍五入到 3 位小数）。
   *   ▎为什么四舍五入：归一化坐标本来就只有 3~4 位有效数字（画布 900px → 1px ≈ 0.001），
   *     而 JS 默认会序列化成 17 位小数（"0.12345678901234567"）——
   *     每条消息平白多出 3~4 倍字节。对**按帧打包的大批点**尤其致命。 */
  if (batch && batch.length) {
    payload.pts = batch.map((q) => [Number(q.x.toFixed(3)), Number(q.y.toFixed(3))]);
  }
  const viaSctp = sendOnDc(boardDataProducer, payload, '白板');
  /* ★ 2026-10-04f 信令兜底双发（与聊天 D+1 同款纪律）：SCTP 对晚到者/竞态时灵时不灵，
   *   笔迹丢一条就是"别人屏幕上少半笔"且无法补——宁可双发由 msgId 去重。
   *   ▸ 它现在**无条件跑**：主路成功也发（双发本来就是既定语义，去重负责收尾），
   *     主路失败更得发。判据不写在这里，写在 sendOnDc 一处。 */
  try {
    if (socket.connected) socket.emit('board-signal', payload);
  } catch (e) { /* 兜底失败不影响主路 */ }
  if (!viaSctp && socket.connected) {
    /* 界面说实话：这条路只剩信令时说出来，别让人以为"笔迹丢了是我的操作问题"。
     *   一次性提示（同一场会只提一次），否则每帧一条就是噪音（坑 82 的动效版）。 */
    if (!boardSctpWarned) {
      boardSctpWarned = true;
      log('🖌️ 白板数据通道还没就绪，这一场先走信令那条路（笔迹照常同步，只是慢一点）');
    }
  }
  /* ★ 2026-10-03 持久化：**只有"本地动作"走到这里**（远端收到的笔迹走 handleBoardMessage
   *   → applyBoardOp，不经过 sendBoard），所以在这里顺手报给服务器不会重复记账。
   *   只报三件事：画完的一笔（带全部点）、撤销、清空——**中间的 draw 点不报**，
   *   否则就是把 SCTP 的流量原样复制一份到信令上，白挨一遍往返。 */
  try {
    if (op === 'end') {
      const s = boardStrokes[boardStrokes.length - 1];
      if (s && s.pts && s.pts.length) {
        socket.emit('board-record', {
          op: 'stroke', color: s.color,
          pts: s.pts.slice(0, 600).map((q) => [Number(q.x.toFixed(3)), Number(q.y.toFixed(3))]),
        });
      }
    } else if (op === 'undo' || op === 'clear') {
      socket.emit('board-record', { op });
    }
  } catch (e) { /* 归档上报失败不能影响画 */ }
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
      if (typeof msg.emoji !== 'string' || msg.emoji.length > 8) return;
      /* ★ 2026-10-02 定向回应（学 Piik 的"只对某个人比"）：带 to 且不是发给我的 → 不刷屏。
       *   再说一遍边界：mediasoup 数据通道是**广播**的，这条消息所有人都收到了，
       *   只是别人不显示——省的是"注意力"，不是"隐私"（要隐私得端到端加密）。 */
      if (msg.to && msg.to !== socket.id) return;
      spawnFlyingEmoji(msg.emoji);
      if (msg.to === socket.id) {
        const src = lastMembers.find((x) => x.id === from);
        showToast(`${(src && src.name) || shortId(from)} 对你比了 ${msg.emoji}`, 'info');
      }
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
      fxCost.textContent = `${fx.costMs.toFixed(1)} ms/帧 · ${fx.chroma && fx.chromaOk ? 'CPU 抠像' : 'GPU 滤镜'}`;
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
    fxCost.textContent = `未启动（${fx.lastFail || '环境不支持'}）`;
    fxCost.classList.add('fx-cost-bad');
    return;
  }
  fxCost.classList.remove('fx-cost-bad');
  if (level === 'warn') { fxCost.textContent = `管线运行中 · ${note || '上行异常'}`; return; }
  if (level === 'live') { fxCost.textContent = `运行中 · ${note || ''} · 计帧中…`; return; }
  fxCost.textContent = '-- ms/帧';
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
  if (fxCost) fxCost.textContent = '-- ms/帧';
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
  /* ★ 09-28 字幕的两条路径（用户点名"不要再用浏览器的了"）：
   *   'server'  = 服务端 whisper 转写（首选：不依赖浏览器厂商云端、不吃本页 CPU、
   *               而且和 AI 的"耳朵"是同一条链路——转写同时喂字幕/AI 看板/问答）；
   *   'browser' = 浏览器 Web Speech（兜底：只在服务器没装 whisper 时才用）；
   *   'off'     = 关。 */
  mode: 'off',
  rec: null,           // 当前 SpeechRecognition 实例
  restartTimer: 0,     // onend 自动重启的防抖定时器
  hideTimer: 0,        // 字幕条"8 秒无字幕自动隐藏"定时器
  log: [],             // ★ 字幕账本（C2 前置）：{ts, from, name, text}，上限 500 条
  lastError: null,     // ★ 09-17c：最近一次失败{word, fix}——诊断卡要把它显示出来
  neterr: 0,
  asrChecked: false, // ★ 09-27d：/config.json 是否已补拉过           // ★ 09-17c：network 错误的重试计数（3 次后停并给兜底指引）
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
      return { fatal: false, word: `识别出错：${code || '未知'}`, fix: '若持续出现，请点字幕条上的「字幕自检」徽标看诊断' };
  }
}

// 自检徽标 + 诊断卡渲染（点徽标随时可看）
/* ★ 2026-10-03 去 emoji 收尾：这颗徽标原先写的是「服务器转写」「识别中」前面挂一颗彩色 emoji，
 *   在一片暖墨界面里像贴纸；更糟的是 `capStatus.textContent = …` 会把 index.html 里那颗
 *   静态图标整个抹掉（表现：未开启时有图标，一开字幕图标就没了）。
 * ▎现在图标与文字**同源同处渲染**：判"此刻是哪条链路在干活"的判据只写在这里这一处（坑 47），
 *   调用方只管说人话，不再各带一个表情。 */
function renderCapStatus(text, level = '') {
  if (!capStatus) return;
  const icon = level === 'bad' ? ICONS.alert
    : /服务器/.test(text) ? ICONS.screen
    : level === 'live' ? ICONS.mic
    : ICONS.cc;
  capStatus.className = `cap-status ${level}`;
  capStatus.innerHTML = icon + '<span>' + escapeHtml(String(text)) + '</span>';
}
/* ★ 2026-10-03 第 38 步：把"看见答案 → 听见它开口"这段等待量出来，贴在**那条气泡自己身上**。
 * ▎为什么单独量这一段：用户抱怨"它答应了却不说话 / 说话好慢"，而这条等待
 *   （合成 + 上架 + 取回 + 排队）此前**完全没有任何读数**——`test:asr-live` 手工打印过一次
 *   "答案上屏→首段 1.6s"，但开会时人看不见。同一条教训第二次用：
 *   **先做成一个数字，才有得优化**（第 37 步的字幕延迟就是这个路径）。
 * ▎只认"真的开始播"（onplaying）而不是"收到 ai-audio"：后者只证明服务器发了，
 *   取不到文件/被自动播放策略拦截时用户其实一声没听见（坑 66 的同一条纪律）。
 * @param ts 这条答案的时间戳（与 chat-message / ai-audio 共用同一个 ts 配对） */
function noteVoiceLatency(ts) {
  const rec = voiceAnswerAt.get(ts);
  if (!rec) return;                    // 没有"文字到齐"锚点（例如音频先到、气泡还没渲染）→ 不编数
  voiceAnswerAt.delete(ts);
  const ms = Date.now() - rec.at;
  if (!Number.isFinite(ms) || ms <= 0 || ms > 60000) return; // 异常值不进统计也不显示
  const chip = document.createElement('span');
  chip.className = 'msg-voice-lat';
  chip.innerHTML = ICONS.speaker + `<span>${(ms / 1000).toFixed(1)}s 后开口</span>`;
  /* 同一条数据还要进值守日报（第 30 步的账本只记字幕，播报延迟得另存一份滚动窗口）。
   * 上限 60 条：一场长会里 AI 不会答几百次，超了就是环形剪旧段（同 cap.log 的做法）。 */
  aiVoiceLats.push({ ts, ms });
  if (aiVoiceLats.length > 60) aiVoiceLats.shift();
  chip.title = '这条答案：文字上屏 → 真的听见第一句声音，服务器合成 + 传输 + 排队都算在里面。'
    + '慢通常是本地 Qwen 音色在 CPU 上合成（RTF>1）；浏览器朗读几乎是 0s。';
  /* 贴在气泡正文与时间行之间；节点不足时直接挂末尾（假 DOM 与真 DOM 都不炸） */
  if (rec.node && rec.node.lastChild) rec.node.insertBefore(chip, rec.node.lastChild);
  else if (rec.node) rec.node.appendChild(chip);
  // 上报给服务器做累计（权威统计在 /metrics，界面这个只是本条的读数）
  socket.emit('ai-speech-lat', { ms });
}

/* ★ 2026-10-03 第 37 步：字幕延迟读数。
 * ▎数据来源是服务器（它才知道"这个人最后一次有声"是几点），本函数只负责显示与
 *   本地滚动统计——**不在浏览器重算延迟**，否则两处口径不同，界面上就会出现
 *   "徽标 2s、面板 4s" 这种自相矛盾（本项目为这类"一个概念两个来源"栽过很多次）。
 * ▎窗口只留最近 8 句：长跑几小时的会议里，早期网络状况不该拉平现在的读数。
 * @param latMs 说完→字幕定稿的总延迟（0/缺 = 服务器判为不可靠，不显示）
 * @param stage {wait, trans} 末段拆分：等待=静音判定+调度，转写=模型耗时。
 *              这一拆才是可操作信息——"慢在等待"要调 asrSegmentSec/FLUSH_MS，
 *              "慢在转写"要换引擎或模型，只看总数两种情况长得一模一样。 */
const capLatWindow = [];
function renderCapLatency(latMs, stage) {
  if (!capLat) return;
  const ms = Number(latMs);
  /* 不可靠的一律不显示（保持上一次读数，不编数）。除了 0 与超上限，还挡掉 **< 200ms**：
   * ▎真机实锤（房间 283648）字幕条写着「⏱ 0.0s」，而同一句的真实等待是 ~10 秒——
   *   那是"人还在说就被保险丝强制收口"量出来的十几毫秒。物理上"说完→分段边界→
   *   静音判定→转写"不可能低于一个 RMS 窗的量级，所以小于 200ms 的数**必然是量错了**。
   *   服务器侧已同步收紧（只有 silence 定稿才产读数，见 finalizeUtterance 的 reason）。 */
  if (!Number.isFinite(ms) || ms < 200 || ms > 120000) return; // 服务器判为不可靠 → 保持上一次读数，不编数
  capLatWindow.push({ ms, wait: Number(stage && stage.wait) || 0, trans: Number(stage && stage.trans) || 0 });
  if (capLatWindow.length > 8) capLatWindow.shift();
  const sec = (ms / 1000).toFixed(1);
  const avg = capLatWindow.reduce((a, b) => a + b.ms, 0) / capLatWindow.length;
  const avgWait = capLatWindow.reduce((a, b) => a + b.wait, 0) / capLatWindow.length;
  const avgTrans = capLatWindow.reduce((a, b) => a + b.trans, 0) / capLatWindow.length;
  const slow = Math.max(...capLatWindow.map((x) => x.ms));
  (capLatNum || capLat).textContent = `${sec}s`;
  /* 三色：≤3s 正常（分段窗口+静音判定+转写的物理下限附近）/ ≤6s 偏慢 / 更慢就醒目提示。
   * ▸ 用覆盖式 className 赋值：一条语句同时"去掉 hidden（让读数现身）+ 上三色类"，
   *   不用 classList.toggle 的返回值（坑 35：假 DOM 的 toggle 不返回布尔，两端语义会反）。 */
  capLat.className = 'cap-lat' + (ms <= 3000 ? ' ok' : ms <= 6000 ? ' warn' : ' bad');
  const f = (v) => (v / 1000).toFixed(1);
  capLat.title = `说完一句话 → 字幕定稿上屏：本句 ${sec}s`
    + (stage ? `（${capStageParts(stage, f)}）` : '')
    + `\n最近 ${capLatWindow.length} 句：均值 ${f(avg)}s、最慢 ${f(slow)}s`
    + `\n均值里 等待 ${f(avgWait)}s / 转写 ${f(avgTrans)}s —— 等待长就调分段与静音判定，转写长就换引擎`
    + '\n（服务器实测，不含浏览器渲染）';
}
/* ★ 2026-10-10（D1）悬浮提示摊开"等在哪一格"——服务器随定稿下发 stage，六块只报**量到的那几块**。
 * ▎为什么要写在界面里：同一份账本只有复盘工具能读，等于"优化完只有开发者看得见"（守则 11）；
 *   而"等待 vs 转写"两块的旧文案已经解释不了新的读数（闸等待与整句重转都藏在大块里）。
 * ▸ 缺失的块**不补 0**，也不写进提示：0 在这里的含义是"这一格真没等"，
 *   与"这台服务器还没算这一层"是两种事实，前者由服务器写 0、后者由服务器不写字段（坑 155）。 */
const CAP_STAGE_LABELS = [
  ['silence', '等静音判定'], ['tail', '等封口'], ['queue', '调度'],
  ['trans', '转写'], ['refine', '整句重转'], ['gate', '等成句闸'],
];
const CAP_WAIT_KEYS = ['silence', 'tail', 'queue'];
const CAP_REST_KEYS = ['trans', 'refine', 'gate'];
/* ▸ 三块子等待（静音判定/封口/调度）**齐了才拆**，否则退回整块 `wait`——
 *   老服务器只发 `{wait, trans}`，硬按六格读会把"等待"整块弄没（把可用功能读成缺失，那也是撒谎）。
 * ▸ 缺失的块不补 0、也不写进提示：这里的 0 含义是"这一格真没等"，
 *   与"这台服务器还没算这一层"是两种事实（前者服务器写 0、后者不写字段，坑 155）。 */
function capStageParts(stage, f) {
  if (!stage) return '拆分：这台服务器还没算这一层（重启 3001 之后的新会议才有）';
  const has = (k) => Number(stage[k]) >= 0;
  const cn = (k) => (CAP_STAGE_LABELS.find((p) => p[0] === k) || [, k])[1];
  const parts = [];
  if (CAP_WAIT_KEYS.some(has)) CAP_WAIT_KEYS.filter(has).forEach((k) => parts.push(`${cn(k)} ${f(Number(stage[k]))}s`));
  else if (has('wait')) parts.push(`等待(静音判定+封口+调度) ${f(Number(stage.wait))}s`);
  CAP_REST_KEYS.filter(has).forEach((k) => parts.push(`${cn(k)} ${f(Number(stage[k]))}s`));
  return parts.length ? '拆分：' + parts.join(' + ')
    : '拆分：这台服务器还没算这一层（重启 3001 之后的新会议才有）';
}
function renderCapDiag() {
  if (!capDiagList) return;
  const r = capPreflight();
  capDiagList.textContent = '';
  for (const c of r.checks) {
    const row = document.createElement('div');
    row.className = `cap-diag-row ${c.ok ? 'ok' : 'bad'}`;
    row.textContent = `${c.ok ? '✓' : '✕'} ${c.text}`;
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
    row.textContent = `✕ 最近一次失败：${cap.lastError.word}`;
    capDiagList.appendChild(row);
    if (cap.lastError.fix) {
      const fix = document.createElement('div');
      fix.className = 'cap-diag-fix';
      fix.textContent = `↳ 怎么修：${cap.lastError.fix}`;
      capDiagList.appendChild(fix);
    }
  }
}

/* ★ 09-28：字幕路径的**显式覆盖口**（测试与排障用，沿用 window.CAP_WD_MS 的惯例）。
 *   __SFU_ASR__ = true  → 强制服务端转写模式；false → 强制浏览器模式；不设 = 按 /config.json。
 *   为什么要这个口子：冒烟测试要能分别验证"两条路"，而 /config.json 是记忆化拉取
 *   （进程内只拉一次），不能在一条测试里靠改 fetch 桩来回切换。 */
function asrPathForced() {
  try {
    const v = window.__SFU_ASR__;
    return typeof v === 'boolean' ? v : null;
  } catch (e) { return null; }
}

/* ★ 09-28：/config.json 的**记忆化承诺**——"开字幕"必须先知道服务器有没有 ASR 才能选路径。
 *   原来页面加载时 fire-and-forget，用户点得早就读到 false → 又去启浏览器识别
 *   （实测反馈的"还是没转到 whisper"）。现在点击时 await 同一个 promise（不重复请求）。 */
/* ★ 2026-10-04 /config.json 的字段**只在这里落地一次**（坑 47："一个概念只能有一个来源"）。
 * ▎为什么这是一条真缺陷而不是整理代码：本文件里有**两处**读 /config.json——
 *   initSFU 进房时那次、点字幕时 ensureAsrConfig 那次。原先只有前一份会写
 *   `serverAsrEngine`，后一份不写。于是"进房后配置还没落地就先点了字幕"这一路，
 *   徽标拼出的是 `服务器转写（服务器转写）`：外层模板 `服务器转写（${asrEngineCn()}）`
 *   撞上 asrEngineCn() 的兜底文案。界面在说胡话，而且胡话的内容恰好是
 *   "我说不清是哪个引擎在干活"——用户据此会判断"引擎根本没切换"（坑 67 家族：
 *   过期/含混的声明比缺失更糟，它会让人去装已经装好的东西）。
 * ▎合并成一处之后，将来加字段只会"两边同时生效"，不会再出现"改了一处漏一处"。
 *   （e2e 断言 `徽标含"服务器转写"` 一直是绿的，它验不出括号里那半句在撒谎——
 *     所以这条也有配套的结构断言：全文件只允许一处给 serverAsrEngine 赋值。） */
/* ★ 2026-10-06 版本自检：让"我改了，你那边还是旧的"这件事**自己浮出来**。
 * ▎为什么这是本轮最该补的一块：坑 40（SW 绕过 no-store 缓存旧 client.js）修好之后，
 *   防线变成了"改代码的人记得 bump ?v="、"看的人记得硬刷新"——两条都靠人记，
 *   而用户反复报"AI 还是不行"的时候，真相往往就是他那台还跑着旧版（本项目实测过）。
 *   现在服务器按内容哈希改写 ?v=（见 sfu/server.js 的 injectAssetVersions），
 *   页面拿**自己实际加载到的**版本与它下发的比一比就知道，不需要任何人记得什么。
 * ▸ 判据保守：服务器没下发 assetVersions（老服务器 / 读失败）就**一声不吭**——
 *   一条"说不准"的警告比没有警告更糟（坑 67/82：过期或含混的声明会让人去查没坏的东西）。 */
const staleBuildEl = $('staleBuild');
const staleReloadBtn = $('staleReloadBtn');
function loadedAssetVersions() {
  const out = {};
  try {
    document.querySelectorAll('script[src], link[href]').forEach((el) => {
      const src = el.getAttribute('src') || el.getAttribute('href') || '';
      /* 前面的 `(?:^|/)` 不是可有可无：vendor 里有一个 **mediasoup-client.js**，
       * 它的结尾正好也是 "client.js"——不加路径边界，读到的会是它的 ?v=（或读不到），
       * 于是自检拿错了对象。这个坑是真浏览器检查替我抓出来的。 */
      const m = /(?:^|\/)(client\.js|style\.css|countup\.js)\?v=([^&"]+)/.exec(src);
      if (m) out[m[1].replace(/\W/g, '')] = m[2];
    });
  } catch (e) { /* 假 DOM 桩没有 querySelectorAll 也不该拖垮加载 */ }
  return out;
}
const LOADED_ASSET_VERSION = loadedAssetVersions();
/* 横幅只反映**当下这一次比对**，不做"报过就不收回"的锁存：
 *   ① 语义上更诚实——版本一致就是没有旧代码问题，留着一条警告等于撒赖；
 *   ② 也让它可被验证（真浏览器里可以先造一次不一致、再恢复，两个方向都断言）。 */
function checkStaleBuild(advertised) {
  if (!staleBuildEl) return;
  if (!advertised || typeof advertised !== 'object') return;          // 老服务器/读不到：不猜
  const stale = Object.keys(advertised).some((k) => LOADED_ASSET_VERSION[k] && LOADED_ASSET_VERSION[k] !== advertised[k]);
  staleBuildEl.classList.toggle('hidden', !stale);
  if (stale) log('⚠️ 版本自检：页面加载的资源与服务器当前版本不一致（服务器已更新过）——点横幅上的「用最新版打开」');
}
if (staleReloadBtn) {
  staleReloadBtn.addEventListener('click', () => {
    /* 走既有的 ?nosw=1 逃生舱（注销 SW + 清 Cache Storage + 重载）。
     * 保留原有查询串：用户可能正在会议里（?room=xxx），不能一刷新就把他踢回首页。
     * 这里用字符串拼接而不是 new URL：冒烟的假环境里没有 URL 构造器，顶层代码一抛错
     * 会把本文件后面的初始化整段砍掉（坑 69 的教训）。 */
    const search = String(location.search || '').replace(/[?&]nosw=1/g, '');
    location.href = location.pathname + (search ? search + '&' : '?') + 'nosw=1';
  });
}
function recheckBuildFreshness() {
  fetch('/config.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((cfg) => { if (cfg) applyServerConfig(cfg); })
    .catch(() => { /* 拉不到就当没变化，绝不因为一次网络抖动报警 */ });
}
/* 两个时机：① 标签页切回来（"我去查了个资料，回来发现它没反应"是最高频的一幕）；
 * ② 会中每 5 分钟一次兜底（/config.json 是个几百字节的 no-store JSON，不构成负载）。 */
document.addEventListener('visibilitychange', () => { if (!document.hidden) recheckBuildFreshness(); });
setInterval(() => { if (myRoom) recheckBuildFreshness(); }, 5 * 60 * 1000);

function applyServerConfig(cfg) {
  if (!cfg) return;
  if (Array.isArray(cfg.iceServers)) sfuIceServers = cfg.iceServers;
  serverAsrEnabled = !!cfg.asrEnabled;   // ★ 09-27d：服务端转写可用性（Web Speech 失败时的降级依据）
  serverAsrEngine = String(cfg.asrEngine || 'none'); // ★ 2026-10-02 界面要报"真在用的那个引擎"
  /* ★ 09-30c：服务端神经语音可用（AI 回答走服务器 MP3，本地 TTS 让位）。
   *   这份配置可能在进房后很久才被"点字幕"这条路重读，所以**本地静音期内不接受"可用"**——
   *   连吃两次失败说明这条路此刻不好用，等自愈窗口过去再说（否则会把刚判定的失败又翻回可用）。 */
  aiTtsEnabled = !!cfg.aiTtsEnabled && Date.now() >= aiTtsLocalMuteUntil;
  if (typeof cfg.videoSvc === 'boolean') sfuVideoSvc = cfg.videoSvc; // ★ D+3：VP9 SVC 单路分层上传
  // ★ 09-24 AI 模式：服务器只给 true/false（不给 key），前端据此显示「LLM / Mock」状态灯。
  //   为什么值得显示：用户要能一眼分清"AI 真在思考"还是"在走本地模板"——
  //   把不确定性藏在黑盒里，是最容易被误解为"糊弄"的地方。
  if (typeof cfg.aiEnabled === 'boolean') { sfuAiEnabled = cfg.aiEnabled; updateAiModeUi(); }
  if (cfg.lanUrl) lanUrl = cfg.lanUrl;   // ★ 09-16：局域网邀请入口（跨电脑复制链接用）
  /* ★ 2026-10-06 跨网入口这一条改成**双向赋值**（`cfg.tsUrl || null`），不是"只在有值时写"。
   *   ▎为什么：紧接着那行注释声称"哪怕配置改回没有 Tailscale，按钮也不会留在页面上骗人"，
   *     而 `if (cfg.tsUrl)` 只写有值的一侧 —— 页面活着期间撤掉入口，tsUrl 会**永远留着旧值**，
   *     那句声明就是假的（坑 76 的形状：机制"在"但从来没生效过）。/config.json 每次读的都是
   *     当下真值，所以"没有"本来就该落成一个能表达的 null。
   *   ▸ lanUrl 有意保持原样：它只在 localhost 打开时才用得上，撤了也只是退回页面自己的来源，
   *     不会造出假链接——同一个写法在两个字段上的代价不一样，这不叫双标，要写下来。
   *     （这句为什么不写那个 API 名的字面形式：冒烟有一条"全文件只许出现一次"的计数断言，
   *     注释里复述一遍就会被它算成第二处——本项目已经为这件事红过一次。） */
  tsUrl = cfg.tsUrl || null;             // ★ 2026-10-06：跨网稳定入口（服务器装了 Tailscale 才有；没有就明说没有）
  serverNetCheck = cfg.netCheck || null; // ★ 2026-10-07：跨网可达性判定（双向赋值，理由与上面同一条）
  /* ★ 2026-10-06 顶栏那颗按钮**只在真有跨网入口时**出现。
   *   ▎为什么把"没有就藏起来"写成一条显式 toggle 而不是"有就显示"：
   *     顶栏上多一条点了打不开的链接，比少一条链接糟得多——用户会以为是自己网络坏了
   *     （坑 82 的链接版：过期/虚假的声明比缺失更有害）。这里按 cfg 的真值双向设置，
   *     所以哪怕配置后来被改回没有 Tailscale，按钮也不会留在页面上骗人。 */
  if (crossLinkBtn) crossLinkBtn.classList.toggle('hidden', !tsUrl);
  /* 版本自检放在最后：它只读不下发，且要在其它字段都落地之后再判断，
     否则"配置刚到手"这一瞬会拿半份数据去比版本。 */
  checkStaleBuild(cfg.assetVersions);
}

let asrCfgPromise = null;
let serverAsrKnown = false; // ★ 09-28：/config.json 是否已落地（决定"点击时要不要 await"）
function ensureAsrConfig() {
  if (!asrCfgPromise) {
    asrCfgPromise = fetch('/config.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (cfg) {
          applyServerConfig(cfg);
        } else {
          /* ★ 09-30：拉取失败**不缓存失败结果**（asrCfgPromise 归零）——否则服务器明明有
           *   whisper，一次网络抖动就让用户永远落进"浏览器识别"的错误路径（实测反馈
           *   "调用的还是浏览器的 Speech"的一个可能来源）。下次点击会重新拉一次。 */
          asrCfgPromise = null;
        }
        serverAsrKnown = true;   // 成功或失败都算"问过了"（失败按 asrEnabled=false 兜底）
        return cfg;
      })
      .catch(() => { serverAsrKnown = true; asrCfgPromise = null; return null; });
  }
  return asrCfgPromise;
}

/* ★ 09-28：服务端转写模式（首选路径）——
 * ▎为什么不再启动浏览器识别（用户明确要求 + 真实现状）：
 *   Web Speech 走浏览器厂商云端，国内网络经常不可达（实测报 network 错误），
 *   而 whisper 就在本机跑：不上云、不吃本页 CPU、字幕与 AI 的"耳朵"是同一条链路
 *   （服务端转写同时喂字幕条 / AI 看板 / @ai 问答）——一条数据流服务三件事。
 * ▎为什么自动邀请 AI：服务端音频管线是挂在"AI 小明的耳朵"上的（bot 在会才有管线），
 *   所以要字幕就得把 AI 请进来。这也正是"AI 参会"的自然入口。
 * ▎边界（诚实）：浏览器端这个开关只控制"显示与否"，服务器在 AI 在场时始终在转写；
 *   要真正停下，请点 🤖 送走 AI。 */
function enableServerCaptionMode() {
  cap.on = true;
  cap.mode = 'server';
  cap.neterr = 0;
  if (!cap.sentry.startedAt) cap.sentry.startedAt = Date.now();
  setIconBtn(capBtn, ICONS.cc, '服务端字幕');
  renderCapStatus(`服务器转写（${asrEngineCn()}）`, 'live');
  reportMyState({ caption: true });
  log(`💬 已启用服务端转写：你的麦克风音频经 SFU 送到服务器，由${asrEngineCn()}识别后上字幕（不走浏览器云端）`);
  if (!lastMembers.some((m) => m.isBot)) {
    socket.emit('ai-join'); // 任何成员都可邀请（服务器侧有守卫；仅服务端转写需要它在场）
    log('🤖 已自动邀请 AI 小明入会——它是服务端转写的"耳朵"（送走 AI 即停止转写）');
  }
  showToast(`服务端转写已开启：正常说话即可上字幕（${asrEngineCn()}，不依赖浏览器识别）`);
}

async function toggleCaptions() {
  if (cap.on) {
    // 关：不再自动重启 + 停识别器（onend 会触发，但 wantRestart 已 false）
    const wasServer = cap.mode === 'server';
    cap.on = false;
    cap.mode = 'off';
    clearTimeout(cap.restartTimer);
    cap.restartTimer = 0; // ★ 第 30 步：排程句柄归零——看门狗靠「无排程」判断是否该接管
    if (cap.rec) { try { cap.rec.stop(); } catch (e) { /* 已停则忽略 */ } cap.rec = null; }
    setIconBtn(capBtn, ICONS.cc, '字幕');
    renderCapStatus(wasServer ? '服务器仍在转写' : '未开启');
    reportMyState({ caption: false }); // ★ 09-17b：字幕开关进房间状态机（成员列表 💬 徽标）
    log(wasServer
      ? '💬 已隐藏字幕（服务器在 AI 在场时仍在转写并记入账本；要彻底停止请点 🤖 送走 AI）'
      : '💬 实时字幕已关闭');
    return;
  }

  /* ★ 09-28：先确认服务器有没有 ASR，再决定走哪条路——
   *   有 whisper → 服务端转写（默认，不再碰浏览器识别）；
   *   没有      → 才退回浏览器 Web Speech（下面的自检与退避逻辑原样保留）。
   * ▎09-30 改为**无条件 await**：记忆化后除第一次外都是微任务级开销（肉眼不可感），
   *   但能根除"页面刚加载、配置未到、用户抢先点击 → 误进浏览器模式"的时序竞态。
   *   显式覆盖（window.__SFU_ASR__）优先级最高——测试/排障用。 */
  const forced = asrPathForced();
  if (forced === null) await ensureAsrConfig();
  const useServer = forced === null ? serverAsrEnabled : forced;
  if (useServer) { enableServerCaptionMode(); return; }

  /* ★ 09-17c：开之前先自检——把"必然失败"扼杀在点击那一刻，并直接告诉他怎么修 */
  const pre = capPreflight();
  renderCapDiag();
  if (!pre.ok) {
    const bad = pre.checks.find((c) => !c.ok);
    renderCapStatus('环境不支持', 'bad');
    capDiagBox.classList.remove('hidden');
    showToast(`字幕无法开启：${bad.text.split('：')[1] || bad.text}（已弹出自检报告）`, 'error');
    log(`💬 字幕自检未通过：${bad.text}；修法：${bad.fix || '-'}`);
    return;
  }

  cap.on = true;
  cap.mode = 'browser';
  cap.neterr = 0;               // 重试预算清零
  if (!cap.sentry.startedAt) cap.sentry.startedAt = Date.now(); // ★ 第 30 步：值守计时起点（首次开字幕）
  setIconBtn(capBtn, ICONS.cc, '关字幕');
  renderCapStatus('识别中…', 'live');
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
    renderCapStatus('识别中…', 'live');
    // ★ 第 30 步值守：识别器成功起来了 = 自愈成功，失败计数与退避排程全部复位
    cap.neterr = 0;
    cap.backoffUntil = 0;
  };
  rec.onaudiostart = () => renderCapStatus('已采集到声音', 'live');
  rec.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      const text = (r[0] && r[0].transcript || '').trim();
      if (!text) continue;
      if (r.isFinal) emitCaption(text);      // 认准整句：入账 + 广播 + 字幕条定稿
      else interim += text;                  // 半句：只本地跳动，不广播
    }
    if (interim) { showCaptionBar(myDisplayName || '我', interim, true); renderCapStatus('识别中…', 'live'); }
    /* ★ 09-30 抢话修复④：浏览器识别模式下本地结果同样是"我在说话"信号
     *   （半句也算——用户一开口就该让 AI 闭嘴，不必等整句定稿）。 */
    if (interim || event.results.length) lastUserSpeechTs = Date.now();
    if (interim) hushAiSpeech();
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
      renderCapStatus('已停止', 'bad');
    }
  };
  rec.onerror = (event) => {
    const info = capErrorInfo(event.error);
    cap.lastError = info;
    log(`💬 字幕错误[${event.error}]：${info.word}${info.fix ? `；修法：${info.fix}` : ''}`);

    if (info.fatal) {
      renderCapStatus(`${info.word}`, 'bad');
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
      // ★ 09-27d：服务端转写可用时，**第一次 network 失败就立即降级**——
      //   浏览器云端不可达是稳定状态，重试 45 分钟毫无意义（用户实测"动不动就报错"）；
      //   不可用时才走原退避路径。
      // ★ 09-27d 双保险：进房前拉取失败/未到时，现场补拉一次再判
      if (!cap.asrChecked && typeof fetch === 'function') {
        cap.asrChecked = true;
        fetch('/config.json', { cache: 'no-store' }).then((r) => r.json()).then((c) => {
          applyServerConfig(c);   // ★ 2026-10-04 第三处读配置的地方也走同一个落地函数（见那里的实修注释）
          if (serverAsrEnabled && cap.on) {
            renderCapStatus('服务器转写模式', 'live');
            showToast('已切换：服务器转写（AI 小明在场时说话即上字幕）');
          }
        }).catch(() => {});
      }
      if (serverAsrEnabled) {
        renderCapStatus('服务器转写模式', 'live');
        showToast('浏览器识别不可达——已改用服务器转写：邀请 🤖 AI 后正常说话即可上字幕');
        renderCapDiag();
        toggleCaptions();
        renderCapStatus('服务器转写模式', 'live'); // toggleCaptions 复位徽标后再标
      } else if (cap.neterr >= CAP_NET_GIVE_UP) {
        /* ★ 09-27d 降级重构（用户反馈"动不动就报错"）：浏览器厂商云端不可达时，
         *   **自动切到服务端转写模式**——不再反复弹错；AI 小明在场时服务器 whisper
         *   本来就在转写（asr-caption 直接上字幕条），客户端这个开关只是"冗余路径"。 */
        renderCapStatus(serverAsrEnabled ? '服务器转写模式' : '识别服务不可达', serverAsrEnabled ? 'live' : 'bad');
        showToast(serverAsrEnabled
          ? '浏览器识别不可达——已自动改用服务器转写：邀请 🤖 AI 后正常说话即可上字幕'
          : '浏览器识别不可达，且服务器转写未开启（需服务器安装 whisper）。可用「手动字幕」兜底', serverAsrEnabled ? 'default' : 'error');
        renderCapDiag();
        capDiagBox.classList.remove('hidden');
        toggleCaptions();
        if (serverAsrEnabled) {
          renderCapStatus('服务器转写模式', 'live'); // toggleCaptions 会复位徽标，这里再标一次
        }
      } else {
        const delay = Math.min(30000 * Math.pow(2, cap.neterr - 1), 300000);
        cap.backoffUntil = Date.now() + delay; // onend 的重启排程会读它（见上）
        renderCapStatus(`识别服务不可达，${Math.round(delay / 1000)}s 后重试（${cap.neterr}/${CAP_NET_GIVE_UP}）`, 'bad');
      }
    } else if (event.error === 'no-speech') {
      renderCapStatus('等待说话…', 'live');
    }
  };
  try {
    rec.start();
  } catch (err) {
    // 最典型的"点了没反应"：同一次会话里连续 start() 会抛 InvalidStateError
    log(`⚠️ 字幕识别器启动失败：${err.message}`);
    renderCapStatus('启动失败', 'bad');
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
   *   听不到字（它只有音频管线没有转写），这是当前架构下最自然的挂点。
   * ▎★ 2026-10-02 加**同句去重**（用户实测"AI 一直收到重复的一句话"的客户端这一半）：
   *   Web Speech 会把同一句话 repeated 出多次 isFinal（尤其"你好小明"这种短句），
   *   原先这里**零去重、零冷却**——一句"小明…"能连着发出好几条 ai-ask，
   *   每条都换回一个回答，看着就是 AI 在自言自语。8 秒内同一句只发一次。 */
  if (AI_NICKNAME && aiWakeHere(text) && lastMembers.some((m) => m.isBot)) {
    const nowTs = Date.now();
    const dupWake = lastWakeAskText === text && nowTs - lastWakeAskTs < 8000;
    if (!dupWake) {
      lastWakeAskText = text; lastWakeAskTs = nowTs;
      socket.emit('ai-ask', { question: text });
      log(`🤖 ${AI_NICKNAME} 听到你叫它了，正在组织回答…`);
    }
  }
  /* 字幕容忍丢：SCTP 不在/没开/发失败都只记一行日志，**绝不为它造兜底路**
   *   （与聊天的双路径形成对照——可靠性按内容价值定价，09-17b 立的口径）。
   *   ★ 2026-10-10：原来这里也有一个 `!dp || dp.closed` + try/catch，行为是对的，
   *   换成 sendOnDc 只为"判据只写一处"。 */
  sendOnDc(chatDataProducer, {
    type: 'caption',
    from: socket.id,
    name: myDisplayName || undefined,
    text,
  }, '字幕');
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
  /* ★ 09-28：服务端转写（entry.asr = true）**只进本地历史、不再上行**。
   * ▎为什么不回传：服务器在转写那一刻已经自己落盘了（那是权威副本，feedBoard 也喂过了）；
   *   再回传一次就是同一条字幕重复入库——纪要/看板的统计会翻倍（"谁发言多"直接失真）。
   *   单独记 serverTotal：值守统计里能分清"本地上行"与"服务端转写"两个来源。 */
  if (entry && entry.asr) {
    cap.sentry.serverTotal = (cap.sentry.serverTotal || 0) + 1;
    if (cap.log.length > 500) cap.log.splice(0, cap.log.length - 500);
    return;
  }
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
  /* ★ 2026-10-07 整句话超过预留两行时会被省略号收尾（"不越出线"的硬保证），
   *   但一个字都不该丢——把全文挂到 title 上：悬浮即读完整句，
   *   「⌃ 历史」抽屉里也有一条不漏的账（一个概念两处呈现，不是两处各存一份）。 */
  captionText.title = `${name}：${text}`;
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

/* ★ 2026-10-01 画中画（借鉴 Piik 的"灵活观看方式"）：
 * ▎行为：把**当前大画面**（演讲者视图的 tile-main / 共享画面 / 宫格里第一个远端画面）
 *   弹出成系统级画中画小窗——切到别的窗口也能盯着演讲者或共享内容（ PiP 由
 *   requestPictureInPicture 提供，零依赖；不支持的环境提示后忽略）。
 * ▎离房/换主画面：PiP 窗随元素移除自动关闭，无需额外状态机。 */
pipBtn.addEventListener('click', async () => {
  try {
    if (!document.pictureInPictureElement) {
      /* ★ 2026-10-06 第 48 步之后必须排掉 .tile-blur：衬底是**插在格子里最前面**的 video，
       *   而"取第一个 video"会拿到它 —— 表现是画中画弹出一窗**糊的**画面，
       *   而且不报任何错（共享本体一直是正常渲染的，坏只坏在这条按位置取元素的路）。
       *   这就是坑 77 那句话的另一半：给一个已有节点加子元素之前，
       *   先 grep 谁在按**位置**读它的子节点（querySelector('video') 就是按位置读）。 */
      const main = document.querySelector('.tile-main video:not(.tile-blur)')
        || document.querySelector('.video-box video:not(.tile-blur)');
      if (!main || typeof main.requestPictureInPicture !== 'function') {
        showToast('当前浏览器/画面不支持画中画', 'error');
        return;
      }
      await main.requestPictureInPicture();
      log('🖼️ 画中画已开启（可拖到任意窗口之上，关掉小窗即退出）');
    } else {
      await document.exitPictureInPicture();
    }
  } catch (e) {
    showToast(`画中画失败：${e.name}`, 'error');
  }
});

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
  /* ★ 2026-10-04h 搜索激活时，实时到来的字幕不匹配就不追加（账本仍全量保留，
   *   清空搜索框重新渲染即全部回来——单一数据源，搜索只是视图过滤）。 */
  if (capSearchQ && !capEntryMatches(entry)) return;
  appendToCapGroup(capHistoryList, entry);
  capHistoryList.scrollTop = capHistoryList.scrollHeight; // 新字幕自动滚到底（回看时会被拉下去，真产品同款行为）
}

/* ★ 2026-10-04h 搜索：文本或说话人名包含关键词（大小写不敏感）。 */
function capEntryMatches(entry) {
  return `${String(entry.name || '')} ${String(entry.text || '')}`.toLowerCase().includes(capSearchQ);
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
  /* ★ 2026-10-04h 搜索模式：窗口放大到最近 400 条里过滤（覆盖更早的发言），
   *   并显示命中条数；无关键词时维持原状（最近 100 条）。 */
  const q = capSearchQ;
  let tail = cap.log.slice(q ? -400 : -100);
  if (q) tail = tail.filter(capEntryMatches);
  capHistoryList.textContent = '';
  for (const entry of tail) appendToCapGroup(capHistoryList, entry);
  if (q) {
    if (capSearchCount) {
      capSearchCount.textContent = `${tail.length} 条命中`;
      capSearchCount.classList.toggle('hidden', false);
    }
    if (!tail.length) {
      const none = document.createElement('div');
      none.className = 'cap-h-none';
      none.textContent = '没有匹配的字幕';
      capHistoryList.appendChild(none);
    }
  } else if (capSearchCount) {
    capSearchCount.classList.add('hidden');
  }
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
/* ★ 2026-10-04h 搜索接线：输入即过滤（全量重渲染走同一条路径，分组合并语义不变）。
 *   Esc 清空（check:keyboard 的层级约定：Esc 关最上层浮层——这里只清搜索不关抽屉）。 */
if (capSearchInput) {
  capSearchInput.addEventListener('input', () => {
    capSearchQ = String(capSearchInput.value || '').trim().toLowerCase();
    if (cap.log.length || capSearchQ) renderCapHistory();
  });
  capSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && capSearchInput.value) {
      capSearchInput.value = '';
      capSearchQ = '';
      renderCapHistory();
      e.stopPropagation();
    }
  });
}

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
  serverTotal: 0,  // ★ 09-28：服务端 whisper 转写的条数（这条不上行，单独记）
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
      /* ★ 09-28：只在**浏览器识别模式**下才拉起——服务端转写模式 rec 永远是 null，
       *   不设这道闸门看门狗会每 30s 偷偷启动一个 Web Speech 识别器（"不要再用浏览器的"
       *   就白改了，而且用户会看到云端报错）。 */
      if (cap.on && cap.mode === 'browser' && !cap.rec && !cap.restartTimer) {
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
    ((s.serverTotal || 0) ? ` · 服务端转写 ${s.serverTotal}` : '') + // ★ 09-28：服务端 whisper 那条路的条数
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
/* ★ 2026-10-03 把"拼 markdown"从点击回调里抽成具名函数。
 * ▎为什么要抽：原来整段统计 + 拼串写死在 addEventListener 的回调里，**没有任何测试能调用它**——
 *   于是"日报里到底有没有链路质量这一节"这种问题只能靠人肉点一下看。
 *   本项目一路的原则是"断言写在离用户最近的地方"，而要能写断言，先得能被调用。
 *   （纯函数化 = 免费拿到可测性；这也是坑 41 的正解：有状态写入的东西要有"写进去没有"的断言。）
 * @param all      全档字幕（服务器归档 + 内存热窗口，已按 ts 排序）
 * @param sentry   cap.sentry（值守统计）
 * @param voiceLats 播报延迟滚动窗口 [{ ts, ms }]
 * @returns {{md:string, speakerCount:number, durMin:number}}
 *   ▸ 返回对象而不只是字符串：日志行要用的"几位说话人/跨度多久"**必须由同一趟统计给出**，
 *     让调用方再算一遍就是"一个概念两个来源"（坑 47）——两处算法漂移时，
 *     屏幕上会出现"日报说 4 人、日志说 3 人"这种自己跟自己吵架的输出。 */
function buildSentryReport(all, sentry, voiceLats) {
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
  const s = sentry || {};
  const lines = [];
  lines.push(`# 值守日报 · 房间 ${myRoom || '(未知)'}`);
  lines.push('');
  lines.push(`- 生成时间：${new Date().toLocaleString()}`);
  lines.push(`- 首条字幕：${new Date(first).toLocaleTimeString()} · 末条：${new Date(last).toLocaleTimeString()}（跨度约 ${durMin} 分钟）`);
  lines.push(`- 字幕总数：${all.length} 条 · 说话人 ${speakers.length} 人`);
  if (s.startedAt) lines.push(`- 值守健康：时长 ${Math.floor((Date.now() - s.startedAt) / 3600000)}h${Math.floor(((Date.now() - s.startedAt) / 60000) % 60)}m · 识别器重启 ${s.restarts} 次 · 已归档 ${s.archived} 条${s.drops ? ` · 丢弃 ${s.drops} 条` : ''}`);
  /* ★ 2026-10-03 第 39 步：链路质量段——早上那份报告要能**自己证明这一夜有多快**。
   * ▎为什么单独立一节而不是塞进"值守健康"那行：值守健康讲"有没有断过"（可用性），
   *   延迟讲"通的时候有多慢"（体验）——一夜没断但每句慢 8s，是两种完全不同的结论。
   * ▎字幕延迟从**账本里读**（服务器把 lat 写进每条定稿字幕），播报延迟从前端窗口读：
   *   两处共用同一个 latSummary()，口径不会漂。
   * ▎样本数必须一起印出来：一夜只有 3 句字幕时"均值 6s"什么也说明不了（坑 53）。 */
  const latSummary = (arr, label) => {
    if (!arr.length) return null;
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    const sorted = [...arr].sort((a, b) => a - b);
    const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
    return `- ${label}：均值 ${(avg / 1000).toFixed(1)}s · P90 ${(p90 / 1000).toFixed(1)}s · `
      + `最慢 ${(Math.max(...arr) / 1000).toFixed(1)}s（样本 ${arr.length}）`;
  };
  const capLats = all.map((e) => Number(e.lat)).filter((v) => Number.isFinite(v) && v > 0);
  /* ★ 2026-10-03f 把"慢在哪一段"也印出来（服务器现在会把 stage 一并归档）。
   * ▎为什么单独一行：只有一个总秒数时，"慢在等静音判定"与"慢在模型推理"长得一模一样，
   *   而处方完全相反——前者调 asrSegmentSec / FLUSH_MS，后者换引擎或降模型。
   *   10-03b 立这条纪律时只做到了界面悬浮提示，账本里没有 = 现场一过就查不到。
   * ▎口径诚实：stage 是**末段**的拆分（一句话可能跨几段，"说完"发生在最后一段），
   *   所以 wait+trans 不等于 lat，只用于归因方向，不用于对账。 */
  const waits = all.map((e) => e && e.stage && Number(e.stage.wait)).filter((v) => Number.isFinite(v) && v > 0);
  const trans = all.map((e) => e && e.stage && Number(e.stage.trans)).filter((v) => Number.isFinite(v) && v > 0);
  /* 标准中位数：偶数样本取中间两个的平均。
   * ▎为什么专门提一句：`sorted[floor(n/2)]` 在偶数时取的是"上中位"，
   *   样本一少（日报里常见只有两三条）就把结论朝坏的方向偏——
   *   本项目刚在 10-03 为"中位数说错话"改过一次报告，这里不重复犯。 */
  const med = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    if (!s.length) return 0;
    const h = Math.floor(s.length / 2);
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  };
  const spkLats = (voiceLats || []).map((e) => e && e.ms).filter((v) => Number.isFinite(v) && v > 0);
  const latLines = [latSummary(capLats, '说完→上字幕'), latSummary(spkLats, '看到答案→听到开口')]
    .filter(Boolean);
  if (waits.length && trans.length) {
    latLines.push(`- 其中（末段口径，只用于归因方向）：等静音判定/调度 中位 ${(med(waits) / 1000).toFixed(1)}s`
      + ` · 模型转写 中位 ${(med(trans) / 1000).toFixed(1)}s（样本 ${Math.min(waits.length, trans.length)}）`);
    const w = med(waits), t = med(trans);
    /* ★ 2026-10-10（D1）日报也摊开六格：只报**量到的**那些，缺的不补 0、也不写进来。
     *   「等成句闸」与「整句重转」是这次新增的两格——它们加起来常比模型耗时还大，
     *   而旧的两格文案会把这坨全算进"等待"，于是处方指向分段窗口（错的）。 */
    const stRows = all.map((e) => e && e.fin === 'silence' && e.stage).filter(Boolean);
    const six = CAP_STAGE_LABELS.map(([k, cn]) => {
      const xs = stRows.map((st) => Number(st[k])).filter((v) => Number.isFinite(v) && v >= 0);
      return xs.length ? `${cn} 中位 ${(med(xs) / 1000).toFixed(1)}s(n=${xs.length})` : null;
    }).filter(Boolean);
    if (six.length >= 2) latLines.push(`- 延迟构成（${stRows.length ? 'v' + (stRows[0].v || 1) : '-'}）：${six.join(' · ')}`);
    else latLines.push('- 延迟构成：这台服务器的账本里不足两格可拆（重启 3001 之后的新会议才有六格）');
    if (w > t * 1.5) latLines.push('  ▸ 大头在**等待**：先调 asrSegmentSec / 静音确认阈值，换模型收益有限');
    else if (t > w * 1.5) latLines.push('  ▸ 大头在**模型**：等静音已经很快，要提速只能换引擎/降档或上 GPU');
    else latLines.push('  ▸ 等待与推理各占一半：两头都有油水，先攻绝对值更大的那个');
  } else if (capLats.length) {
    latLines.push('- 拆分（等待 vs 转写）：本次归档里没有 stage 字段（服务器版本早于该字段，或未走服务端转写）');
  }
  if (latLines.length) {
    lines.push('');
    lines.push('## 链路质量（实测）');
    lines.push(...latLines);
    if (!spkLats.length) lines.push('- 看到答案→听到开口：本次没有朗读记录（AI 语音未开，或一轮都没真的发音）');
  }
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
  lines.push('> 由云会议第 31 步本地生成（零 LLM）；要"读懂内容"的版本等 N2 接上 LLM。');
  lines.push('');
  return { md: lines.join('\n'), speakerCount: speakers.length, durMin };
}

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
  // ②③ 统计与拼串都在 buildSentryReport 里（抽出去是为了能被测试调用）
  const rep = buildSentryReport(all, cap.sentry, aiVoiceLats);
  const blob = new Blob([rep.md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `report-${myRoom || 'local'}-${Date.now()}.md`;
  if (typeof a.click === 'function') a.click();
  URL.revokeObjectURL(url);
  log(`📋 已生成值守日报（${all.length} 条 · ${rep.speakerCount} 位说话人 · 跨度 ${rep.durMin} 分钟）`);
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
/* ★ 2026-10-04 第 47 步：把"关抽屉"抽成一个函数——第 47 步的 Esc 分发器要关同一层，
 *   不抽出来就得在两地各写一遍那三行（遮罩、按钮高亮、状态位），漏一处就是"抽屉关不干净"。 */
function closeSideDrawer() {
  document.body.classList.remove('side-open');
  sideBtn.classList.remove('active');
  sideScrim.classList.add('hidden');
}
sideScrim.addEventListener('click', closeSideDrawer);

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
   *   注销后当前这次加载仍归旧 SW 管，要再刷一次才彻底干净——所以**真的清掉了东西**时
   *   下面会重载一次，做到"一步到位"；什么都没清的时候不重载（见 ★ 2026-10-04）。 */
  if (/[?&]nosw=1/.test(location.search)) {
    (async () => {
      try {
        /* 去掉 nosw 之后要保留的查询串——两处共用同一条规则（坑 47）：
           ① 不重载时把它从地址栏抹掉；② 真重载时跳去的地址。
           各写一份的话，同一个排障开关就会出现两种地址形态。 */
        const keep = location.search
          .split(/[?&]/).filter((kv) => kv && !/^nosw(=1)?$/.test(kv)).join('&');
        const cleanUrl = () => location.pathname + (keep ? '?' + keep : '') + location.hash;
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
        let keys = [];
        if (self.caches) keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        /* ★ 2026-10-04 只在**真的清掉了东西**时才重载。
         * ▎为什么这不是"顺手优化"而是一条缺陷修复：这趟跳转会打断页面本身——
         *   所有界面检查都以 `?nosw=1` 开头（坑 40 的纪律），于是**每次测量都注定有一趟
         *   自我导航**，撞在 `location.replace` 那一刻的 evaluate 就报
         *   "Inspected target navigated or closed"。10-04 连跑 check:dock（要开 11 台浏览器）
         *   时 1920/1280/1152 轮流红就是这个原因：会移动的失败是负载不是代码，
         *   而这份负载是我们自己的量具制造的。
         * ▎全新浏览器（没有 SW、没有缓存）时重载什么都换不来：页面上跑的就是刚取到的文件。
         *   真清了东西仍然照旧重载一次——那才是"一步到位"的意义所在。 */
        const cleared = regs.length + keys.length;
        if (!cleared) {
          /* 不重载，但把地址栏里的 ?nosw=1 抹掉（history.replaceState **不产生导航**），
             否则调试参数一直挂在 URL 上，看着像"这页还在清缓存模式里"。 */
          try { history.replaceState(null, '', cleanUrl()); } catch (e) { /* 抹不掉不致命 */ }
          log('🧹 本次没有 Service Worker 与缓存可清（?nosw=1 已生效，页面就是最新代码，不必重载）');
          return;
        }
        log(`🧹 已注销 ${regs.length} 个 Service Worker 并清空 ${keys.length} 组缓存，正在重载…`);
        /* ★ 2026-10-02 修掉这个逃生舱自己的 bug：`location.reload()` **保留查询串**，
         *   于是重载后 `/[?&]nosw=1/` 又命中 → 再注销 → 再 reload = **每 400ms 刷一次页面**
         *   （"排障开关"本身变成一个死循环，比没这个开关更糟）。
         *   正解：跳回**去掉 nosw 的同一个地址**，其余参数（尤其 ?room= 邀请链接）原样保留。 */
        setTimeout(() => location.replace(location.pathname + (keep ? '?' + keep : '') + location.hash), 400);
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
let rdStartTs = 0;              // ★ 09-30d：首帧时间（会话时长显示）
let rdDrawing = false;
let rdPendingAb = null;         // 只留最新一帧：画面实时性 > 完整性（堆积只会看到"过去"）

/* ══════════════════════════════════════════════════════════════
 * ★ 09-30 远程画面**闭环自适应帧率**（控制端这一半：测量 + 反馈）
 *
 * ▎要解决的问题：抓屏帧率是**开机参数写死的**（默认 12fps）。
 *   固定参数在变化的网络上必然有一半时间是错的——
 *   网好时白白浪费带宽（12fps 的画面明显发涩），网差时帧持续堆积（越堆越延迟）。
 *
 * ▎为什么要**控制端**来决策：只有接收端量得到"帧到得够不够快"。
 *   发送端看自己的本地队列不代表链路状态（丢帧语义下尤其如此）。
 *   这是"能观测到的人才有资格做决策"。
 *
 * ▎为什么用"中位数间隔"而不是平均值：平均值会被一两次长卡顿拉偏，
 *   而我们要判断的是"稳态下够不够快"。中位数对偶发毛刺天然免疫。
 *
 * ▎为什么要防抖动（滞回 + 最小间隔 + 起步保护）：
 *   自适应控制器最容易写成"震荡器"——调高→立刻过载→调低→又空闲→调高……
 *   用户看到的画面会忽快忽慢，比固定参数更难受。所以：
 *     · 至少 4 秒才允许调一次；
 *     · 窗口内帧数太少（<8）**不决策**（静止画面本来就不出帧，不能当成"链路差"）；
 *     · 升/降阈值分开（90% 才升、60% 才降），中间留出死区；
 *     · 只在 2~24 范围内动（服务器与代理还会再钳一次）。
 * ══════════════════════════════════════════════════════════════ */
let rdLastFrameAt = 0;
let rdIntervals = [];            // 最近若干帧的到达间隔（ms）
let rdTargetFps = 12;            // 当前建议帧率（起步值 = 代理默认，先不打扰它）
let rdQualityAt = 0;             // 上次调参时间
const RD_QUALITY_MIN_GAP = 4000; // 最小调参间隔（防震荡）
const RD_FPS_MIN = 6;
const RD_FPS_MAX = 24;
/* ★ 2026-10-03 端到端手感延迟：**我点下去 → 画面动了** 多少毫秒。
 * ▎为什么单独量这个数：以前控制台只显示 RTT 和帧率，那两个都是"链路"的指标，
 *   而用户抱怨的是"点着发肉"——那是 输入→代理执行→重画→抓屏→编码→回传→解码 一整条，
 *   RTT 再低也盖不住里面"抓屏 + 编码"那一段。**量错指标就会调错地方**（坑 58 同族）。
 * ▎做法：发输入时记一个时刻，下一帧到达时配对相减（EMA 平滑，避免单帧抖动骗人）。
 *   只在输入后 3 秒内配对——静止画面几秒后才飘来的一帧不算"我点出来的响应"。 */
let rdInputSentAt = 0;
let rdInputMs = 0;
const RD_INPUT_PAIR_WINDOW_MS = 3000;
/** 纯函数：把一次新测量并进 EMA（α=0.35：既跟得上变化，又不被单帧尖峰带跑）。 */
function rdInputEma(prev, sample) {
  if (!(sample > 0)) return prev;
  return prev > 0 ? Math.round(prev * 0.65 + sample * 0.35) : Math.round(sample);
}

function rdNoteFrame() {
  const now = Date.now();
  if (rdLastFrameAt) {
    rdIntervals.push(now - rdLastFrameAt);
    if (rdIntervals.length > 30) rdIntervals.shift();   // 只留最近 30 帧
  }
  /* 输入→画面的配对测量（见上面 rdInputSentAt 的注释）。
   * 不清零 rdInputSentAt：一次拖拽会连发几十个输入，每个都该和它之后的第一帧配对。 */
  if (rdInputSentAt && now - rdInputSentAt < RD_INPUT_PAIR_WINDOW_MS) {
    rdInputMs = rdInputEma(rdInputMs, now - rdInputSentAt);
  }
  rdLastFrameAt = now;
  rdAdaptQuality();
}

/* 自适应**决策律**：抽成纯函数（无副作用、不碰 DOM/全局）。
 * ▎为什么值得单独抽出来：这是整个自适应机制里**唯一有判断逻辑**的地方，
 *   也是唯一会"调错"的地方（调错的表现是画面忽快忽慢）。
 *   抽成纯函数后可以用穷举断言把控制律钉死（见冒烟测试），
 *   而不是只能"跑起来看着还行"——性能类逻辑恰恰最需要可断言的确定性。
 * @returns {number} 建议帧率（已钳制在范围与档位步长内） */
function rdDecideFps({ actualFps, targetFps, rttMs }) {
  let next = targetFps;
  if (actualFps < targetFps * 0.6 || (rttMs != null && rttMs > 250)) {
    next = targetFps - 2;                              // 明显跟不上 / 链路很慢 → 降
  } else if (actualFps >= targetFps * 0.9 && (rttMs == null || rttMs < 120)) {
    next = targetFps + 2;                              // 跟得上且链路快 → 试着提
  }
  return Math.max(RD_FPS_MIN, Math.min(RD_FPS_MAX, next));
}

function rdAdaptQuality() {
  if (!rdHostId) return;
  const now = Date.now();
  if (now - rdQualityAt < RD_QUALITY_MIN_GAP) return;
  if (rdIntervals.length < 8) return;                   // 样本太少（静止画面）→ 不决策
  const sorted = rdIntervals.slice().sort((a, b) => a - b);
  const medianMs = sorted[Math.floor(sorted.length / 2)];
  if (!medianMs || medianMs <= 0) return;
  const actualFps = 1000 / medianMs;
  const rtt = typeof netRttMs === 'number' ? netRttMs : null;

  const next = rdDecideFps({ actualFps, targetFps: rdTargetFps, rttMs: rtt });
  if (next === rdTargetFps) { rdQualityAt = now; rdIntervals.length = 0; return; }

  rdTargetFps = next;
  rdQualityAt = now;
  rdIntervals.length = 0;                                // 换档后重新采样，别拿旧数据继续判
  socket.emit('remote-quality', { to: rdHostId, fps: next });
  setRdState(`✅ 实时画面 · ${next}fps 自适应`);
}

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
  if (typeof rdFrameCounter === 'number') rdFrameCounter++;   // ★ 09-30 供自适应画质统计（每 3s 归零重算实测帧率）
  if (!rdStartTs) rdStartTs = Date.now();                     // ★ 09-30d：首帧起计会话时长（billd-desk 同款状态显示）
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
   * 用户看到"已收 2 帧"只会疑惑（2 帧算好还是不好？）。帧数放进 title 给想深究的人。
   * ★ 09-30d（借鉴 billd-desk）：状态行带上会话时长——"控制了多久"是远程会话的基本事实。
   * ★ 2026-10-03：状态行再带上**手感延迟**（我点下去→画面动了 多少 ms）。
   *   这是远程桌面唯一真正决定"好不好用"的数字，RTT 低不等于它低（中间还有抓屏+编码）。 */
  setRdState('✅ 实时画面' + rdDurationText() + (rdInputMs ? ` · 响应 ${rdInputMs}ms` : ''));
  if (rdStateEl) {
    rdStateEl.title = `已接收 ${rdFrames} 帧 JPEG 画面（来自对方电脑的真实屏幕）` +
      (rdInputMs ? `\n响应延迟 = 发出输入 → 收到对应画面（最近 ${rdInputMs}ms，EMA 平滑）` : '');
  }
}

/* ★ 09-30d：会话时长文案（首帧起计；每帧刷新时顺带更新，无需额外定时器） */
function rdDurationText() {
  if (!rdStartTs) return '';
  const s = Math.floor((Date.now() - rdStartTs) / 1000);
  return ` · ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function rdSend(event) {
  if (!rdHostId) return false;
  /* ★ 2026-10-03 记下"最近一次把输入发出去"的时刻，用来量**端到端手感延迟**
   *   （我点下去 → 画面真的动了，多少毫秒）。见 rdNoteFrame 里的配对逻辑。 */
  rdInputSentAt = Date.now();
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
  /* ★ 09-30：每次开新的控制会话都把自适应状态归零。
   *   为什么必须重置：上一次会话（可能是几小时前、也可能是另一台机器）攒下的
   *   帧间隔样本与本档位，**不能**拿来判断这条新链路——否则开局就会按错误的历史
   *   去升/降帧率（典型症状：新会话一开始画面就明显偏卡或偏浪费）。 */
  rdLastFrameAt = 0;
  rdIntervals.length = 0;
  rdTargetFps = 12;
  rdQualityAt = Date.now();   // 起步给一个"冷静期"，别一上来就调参
  rdStartTs = 0;              // ★ 09-30d：会话时长从新会话首帧起算
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
  rdNoteFrame();            // ★ 09-30：记录到达间隔 → 驱动自适应帧率（见 rdAdaptQuality）
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
/* ★ 09-30d（借鉴 billd-desk）：控制台全屏——远程会话的画面空间永远不嫌多。
 *   全屏的是 rdConsole 本身（含工具条），切换后 rdFit 重适配画面尺寸。 */
rdBtn('rdFull', () => {
  try {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (rdConsoleEl && rdConsoleEl.requestFullscreen) {
      rdConsoleEl.requestFullscreen();
    }
    setTimeout(() => { try { rdFit(); } catch (e) { /* 桩无尺寸 */ } }, 300);
  } catch (e) { /* 无 Fullscreen API 的环境忽略 */ }
});
rdBtn('rdRelease', () => closeRemoteDesk(true));
/* ★ 09-30d（借鉴 billd-desk）：剪贴板双向——
 *   推：读本机剪贴板 → clipboard-sync(ctl2host) → agent 写进对方网页剪贴板；
 *   拉：remote-input {kind:'clipboard-read'} → agent 读对方网页剪贴板 → clipboard-sync
 *   (host2ctl) 回来 → 复用既有 host2ctl 监听写进我的剪贴板（不重复造轮子）。
 *   服务器剪贴板门禁（控制对白名单）照常生效——能力来自授权，不是来自通道。 */
rdBtn('rdClipPush', async () => {
  if (!rdHostId) return;
  try {
    const t = await navigator.clipboard.readText();
    if (!t) { showToast('📋 你的剪贴板是空的（或浏览器未授权读取）', 'info'); return; }
    socket.emit('clipboard-sync', { to: rdHostId, text: String(t).slice(0, 100000), dir: 'ctl2host' });
    showToast(`📋 已推送 ${t.length} 字到对方电脑的网页剪贴板`, 'info');
  } catch (e) {
    showToast('❌ 读取本机剪贴板失败：请点一下页面再试', 'error');
  }
});
rdBtn('rdClipPull', () => {
  if (!rdHostId) return;
  if (rdSend({ kind: 'clipboard-read' })) showToast('📥 正在拉取对方网页的剪贴板…', 'info');
});

/* =====================================================================================
 * ★ 09-30 借鉴 billd-desk —— 两块增强远程控制体验：
 *   ① 「设备码」直连：主控端在登录页点「用设备码远程控电脑」→ 输码(+连接密码)即连，
 *      不用先建房/进会议。被授权后（无人值守立即，或对方终端按 y 后）打开真桌面控制台。
 *   ② 画质档 + 弱网自适应：控制台上有 自动/流畅/标准/高清 四颗，切换发 {kind:'quality'}；
 *      "自动"档每 3s 量实测帧率，卡了就降档、稳了再升档——把 billd 的"画质/流畅"做成实时可用。
 * 两块都复用现有管线（desk-connect 只登记门禁、quality 走 remote-input 老通道），不新造轮子。
 * ===================================================================================== */

// ---- ① 设备码直连入口 ----
const deskOverlay = $('deskOverlay');
const deskCodeEl = $('deskCode');
const deskPassEl = $('deskPass');
const deskMsgEl = $('deskMsg');
let deskPendingHost = null;     // 已请求、等对方确认的那台设备 id

function setDeskMsg(t) { if (deskMsgEl) deskMsgEl.textContent = t; }

const authDeskBtn = $('authDeskBtn');
if (authDeskBtn && authDeskBtn.addEventListener) {
  authDeskBtn.addEventListener('click', () => {
    if (authOverlay) authOverlay.classList.add('hidden');
    if (deskOverlay) deskOverlay.classList.remove('hidden');
    setTimeout(() => { try { deskCodeEl && deskCodeEl.focus(); } catch (e) {} }, 50);
  });
}
const deskBackBtn = $('deskBackBtn');
if (deskBackBtn && deskBackBtn.addEventListener) {
  deskBackBtn.addEventListener('click', () => {
    if (deskOverlay) deskOverlay.classList.add('hidden');
    if (authOverlay) authOverlay.classList.remove('hidden');
    setDeskMsg('');
  });
}

async function doDeskConnect() {
  const deviceCode = String(deskCodeEl && deskCodeEl.value || '').trim();
  const password = String(deskPassEl && deskPassEl.value || '');
  if (!/^\d{6}$/.test(deviceCode)) { setDeskMsg('设备码应为 6 位数字'); return; }
  setDeskMsg('正在连接…');
  try {
    const resp = await request('desk-connect', { deviceCode, password });
    const d = (resp && resp.data) || {};
    if (d.granted) {
      // 无人值守：服务器已授权，desk-granted 事件也会到；这里直接开控制台
      openRemoteDesk(d.hostId, { name: d.hostName });
      if (deskOverlay) deskOverlay.classList.add('hidden');
      setDeskMsg('');
    } else {
      // 需人工确认：等对方在它的终端按 y → 届时收 desk-granted 再开
      deskPendingHost = d.hostId;
      setDeskMsg('已发送请求，等待对方在被控电脑上确认…');
    }
  } catch (err) {
    const m = (err && err.message) || '连接失败';
    setDeskMsg(m === 'busy' ? '该设备正被别人控制' : '❌ ' + m);
  }
}
rdBtn('deskConnectBtn', doDeskConnect);
if (deskCodeEl && deskCodeEl.addEventListener) deskCodeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') doDeskConnect(); });
if (deskPassEl && deskPassEl.addEventListener) deskPassEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') doDeskConnect(); });

// 授权成功（两条路径都会发）→ 打开控制台。这是设备码路径专用信号，
//   与会议里"点成员行控制电脑"走的 remote-answer 分支互不影响。
socket.on('desk-granted', ({ hostId, hostName } = {}) => {
  if (!hostId) return;
  deskPendingHost = null;
  if (deskOverlay) deskOverlay.classList.add('hidden');
  if (authOverlay) authOverlay.classList.add('hidden');
  openRemoteDesk(hostId, { name: hostName || ('设备 ' + hostId) });
});

// ---- ② 画质档 + 弱网自适应 ----
/* ▎和上面那套"闭环 fps 自适应"（rdAdaptQuality → remote-quality）怎么共存？（坑 47：一个概念只留一个来源）
 *   两条控制线如果各调各的帧率，用户选了「高清」也会被自适应悄悄拖回 12fps——
 *   所以这里明确分工，**帧率只有一个目标值来源**：
 *     · **档位 = 策略层**：决定 JPEG 画质 + 分辨率上限 + **目标帧率中枢**（切档即改写 rdTargetFps）；
 *     · · **自适应 = 执行层**：只在中枢附近 ±2 微调（6~24 硬钳制），不另起炉灶定目标。
 *   smooth 特意取 6fps（= RD_FPS_MIN 硬下限），否则自动微调会立刻把"流畅"顶回 6，两个来源打架。 */
const RD_PRESETS = {
  smooth:   { fps: 6,  label: '流畅' },
  standard: { fps: 12, label: '标准' },
  hd:       { fps: 20, label: '高清' },
};
const RD_ORDER = ['smooth', 'standard', 'hd'];
let rdPreset = 'standard';   // 当前生效档
let rdAuto = true;           // 自动档：按实测帧率升降
let rdFrameCounter = 0;      // 3s 窗口内收到的帧数（rdPumpFrames 里累加）

function setRdPreset(preset, byAuto) {
  if (!RD_PRESETS[preset]) return;
  rdPreset = preset;
  /* 切档 = 换"中枢"：把自适应的目标帧率与采样窗口一起重设，
   *   否则旧的 rdTargetFps/旧样本会继续按上一档拉扯对端（表现为"切了档没反应"）。 */
  rdTargetFps = RD_PRESETS[preset].fps;
  rdIntervals.length = 0;
  rdLastFrameAt = 0;
  rdSend({ kind: 'quality', preset });
  // 高亮当前档按钮（自动模式下高亮"自动"）
  const map = { rdQSmooth: 'smooth', rdQStd: 'standard', rdQHD: 'hd' };
  Object.entries(map).forEach(([id, p]) => {
    const el = $(id); if (el && el.classList) el.classList.toggle('is-on', !rdAuto && p === preset);
  });
  const autoEl = $('rdQAuto'); if (autoEl && autoEl.classList) autoEl.classList.toggle('is-on', rdAuto);
  if (!byAuto) setRdState(`🎚️ 画质：${RD_PRESETS[preset].label}${rdAuto ? '' : '（手动）'}`);
}

const rdQualityBtn = (id, preset) => rdBtn(id, () => {
  rdAuto = (preset === 'auto');
  if (rdAuto) { setRdPreset(rdPreset, true); showToast('🎚️ 画质：自动（按网络升降档）', 'info'); }
  else setRdPreset(preset, false);
});
rdQualityBtn('rdQAuto', 'auto');
rdQualityBtn('rdQSmooth', 'smooth');
rdQualityBtn('rdQStd', 'standard');
rdQualityBtn('rdQHD', 'hd');

/* 弱网自适应：每 3s 看一次实测帧率。
 *   - 明显低于当前档目标（画面卡）→ 往下降一档（先到最吃紧的"流畅"）；
 *   - 帧率贴着当前档上限、且不是最高档 → 试探性升一档。
 * 只统计"有在变画面"的情况：静止时 screencast 本就不推帧，帧率 0 不代表卡，
 *   所以要求窗口内至少收到过 1 帧才判定（否则静止页面会被误降档）。 */
setInterval(() => {
  if (!rdHostId || !rdAuto) { rdFrameCounter = 0; return; }
  const fps = rdFrameCounter / 3;
  rdFrameCounter = 0;
  if (fps < 0.5) return;                        // 几乎没帧 = 静止或没画面，不据此判断
  const idx = RD_ORDER.indexOf(rdPreset);
  const target = RD_PRESETS[rdPreset].fps;
  if (fps < target * 0.55 && idx > 0) setRdPreset(RD_ORDER[idx - 1], true);   // 卡 → 降档
  else if (fps >= target * 0.9 && idx < RD_ORDER.length - 1) setRdPreset(RD_ORDER[idx + 1], true); // 稳 → 升档
}, 3000);


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

// ★ 09-27d：页面加载即拉 /config.json——serverAsrEnabled 必须在"开字幕"**之前**
//   就位（原来只在进房 initSFU 时拉，用户在预览页/进房前开字幕时降级依据是 false，
//   Web Speech 失败就会走旧退避路径反复报错——实测反馈的"还是没转到 whisper"）。
// ★ 09-28：改为预热 ensureAsrConfig() 的**记忆化 promise**——点击时还会 await 一次，
//   保证"点得比网络快"也不会误判（见 toggleCaptions 开头的 await）。
ensureAsrConfig();

startLocalMedia();
// ★ 第 33 步：非安全上下文时弹出安全提示横幅。放在 startLocalMedia 之后调用，
//   这样"正在连接信令服务器/本地媒体就绪"这类首行日志仍在最上面，横幅日志不会抢戏。
initInsecureNotice();
// ★ 09-25：侧栏分段（成员/看板/聊天）——脚本在 body 末尾，DOM 已就绪，可直接挂事件
initSideTabs();
initIcePrecheck();        // ★ 第 34 步：预览页 ICE 自检（把「UDP 被堵」提前说成人话）
/* ══ ★ 第 49 步（2026-10-07）：明暗双主题（用户："界面可以背景色选明亮一点的，和现在两个版本"）══
 * ▎状态只有一个来源：`<html data-theme>`。按钮上的文字与图标都只是它的一个视图
 *   （坑 97 那条红线：给人看的字符串不许当机器的判据）。
 * ▎防闪烁不在这里：index.html 的 head 里有一段 6 行内联脚本，在样式表之前就把属性写好；
 *   这里只负责"按钮显示成什么 + 点一下发生什么"。
 * ▎切换时顺手改 <meta name="theme-color">：装成 PWA / 手机打开时，
 *   系统状态栏跟着页面走，不然浅色页面配一条深色状态栏，看着就是"没做完"。 */
const THEME_KEY = 'sfu-theme';
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}
function renderThemeBtn() {
  const light = currentTheme() === 'light';
  // 按钮写的是"点下去会变成什么"，不是"现在是什么"——这才是用户看得懂的那句话
  if (themeBtnTxt) themeBtnTxt.textContent = light ? '水墨' : '宣纸';
  if (themeBtn) {
    themeBtn.setAttribute('aria-pressed', light ? 'true' : 'false');
    themeBtn.title = light ? '换回水墨（深色）主题' : '换成宣纸（明亮）主题';
  }
  try {
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', light ? '#f4efe3' : '#14100a');
  } catch (e) { /* 没有这个 meta 也不该影响切换 */ }
}
function initTheme() {
  if (!themeBtn) return;
  renderThemeBtn();
  themeBtn.addEventListener('click', () => {
    const next = currentTheme() === 'light' ? 'dark' : 'light';
    if (next === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* 隐私模式：本次会话内仍然生效 */ }
    renderThemeBtn();
    log(`界面主题：${next === 'light' ? '宣纸（明亮）' : '水墨（深色）'}（已记住，下次打开还是这一版）`);
  });
}
initTheme();
/* ══ ★ 第 50 步（2026-10-07）：分段控件的"会滑的墨"（学 reactbits 的 animated indicator，零依赖手写）══
 * ▎两处共用一个实现：侧栏的 成员/看板/聊天（金线）与舞台上的 宫格/演讲者（底片）。
 *   原来它们各自用 `.active` 画一份选中态，切换时是"这边消失、那边凭空出现"——
 *   眼睛读不出"选中是从哪儿挪到哪儿的"，这就是用户说的"不够丝滑"里最难指认的那一种。
 * ▎位置由 JS 量出来写进 transform/width，而不是 CSS 里写死位移：
 *   tab 是 flex 等分、视图按钮宽度随文字长短、窄屏还会换行——
 *   任何"猜一个数"的做法都会在某个宽度上错位（坑 79：别猜别人的尺寸，量）。
 * ▎只在"点击 / 尺寸变化"时读布局，不在任何高频事件里读（坑 59：强制同步布局）；
 *   resize 用 rAF 闩锁保证每帧最多量一次。 */
function moveSegInk(bar) {
  if (!bar) return;
  const ink = bar.querySelector('.seg-ink');
  const active = bar.querySelector('.side-tab.active, .view-btn.active');
  if (!ink || !active) return;
  /* 侧栏抽屉还没展开 / 还没进房时宽度是 0：这时**什么都不写**，
     留 data-unmeasured 让它保持不可见——一个 0 宽的边框小方块比"暂时没有墨"更难看。 */
  if (!active.offsetWidth) return;
  /* ★ 位移 = "目标位置 − 墨的静态位置"，而静态位置每次现量（临时把 transform 摘掉读一次）。
   *   ▎为什么不能拿上一次的 rect 反推：transform 带过渡，切换那一刻读到的是**动画中间帧**，
   *     反推出的"静态位置"就是错的——第一版正是这样，第二次重排后墨直接飞到 1350px 外
   *     （断言"墨中心对齐 tab"当场红，红得很清楚，是我自己写的量具先抓到我自己的错）。
   *   ▎为什么不直接用 offsetLeft：绝对定位的 left/top 相对**包含块**，而 .view-bar 自带
   *     backdrop-filter，滤镜会给绝对后代另建包含块 —— offsetLeft 与 left:0 的解析原点
   *     差着 7px，肉眼就是"墨没对准按钮"（坑 78 那一族：只有量真实盒子才发现）。
   *   ▸ 一次摘除/恢复只发生在点击与尺寸变化时（每颗 tab 一次），不是每帧，代价可忽略。 */
  const isLine = ink.classList.contains('seg-ink--line');
  const ar = active.getBoundingClientRect();
  const prevTransform = ink.style.transform;
  ink.style.transition = 'none';
  ink.style.transform = 'none';
  const ir = ink.getBoundingClientRect();          // 这才是"没有位移时它画在哪"
  ink.style.transform = prevTransform;
  void ink.offsetWidth;                             // 提交这一次摘除，避免把过渡一起吞掉
  ink.style.transition = '';
  const w = isLine ? Math.round(ar.width * 0.56) : Math.round(ar.width);
  const h = isLine ? 2 : Math.round(ar.height);
  const wantL = isLine ? ar.left + (ar.width - w) / 2 : ar.left;
  const wantT = isLine ? ar.bottom - 3 : ar.top;
  const tx = Math.round(wantL - ir.left);
  const ty = Math.round(wantT - ir.top);
  ink.style.width = w + 'px';
  ink.style.height = h + 'px';
  ink.style.transform = `translate(${tx}px, ${ty}px)`;
  ink.removeAttribute('data-unmeasured');
}
function initSegInk() {
  const bars = [document.querySelector('.side-tabs'), $('viewBar')].filter(Boolean);
  if (!bars.length) return;
  bars.forEach((b) => { const i = b.querySelector('.seg-ink'); if (i) i.setAttribute('data-unmeasured', '1'); });
  const move = () => bars.forEach(moveSegInk);
  move();
  /* 点击后重排：active 类由既有处理器负责写（这里绝不另立一份"谁被选中"的状态，坑 97），
     我们只在那之后读一次位置。 */
  bars.forEach((bar) => bar.addEventListener('click', () => requestAnimationFrame(move)));
  let raf = 0;
  const relayout = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; move(); }); };
  /* 冒烟桩的 window 没有 addEventListener（与第 32/45 步那两处同一口径的防御式调用——
     顶层语句在这里抛错会把本文件后面的初始化一起砍掉，坑 69 那个形状）。 */
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('resize', relayout);
  }
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(relayout);
    bars.forEach((b) => ro.observe(b));   // 抽屉展开、侧栏宽度变化、字体加载完都会触发
  }
  /* ★ 只监听尺寸不够：**active 类可能是异步翻的**。演讲者/宫格那一颗走的是
   *   View Transitions（document.startViewTransition 把 DOM 改动推到下一帧），
   *   点击回调里我的 rAF 量到的还是旧的那一颗——墨就停在原地，表现成"点了不跟着动"。
   *   ▸ 用 MutationObserver 盯 class 变化：它只在真的换了选中项时触发，
   *     不轮询、不定闹钟（闹钟是坑 100 那种"重复广播把调度饿死"的来源）。 */
  if (typeof MutationObserver === 'function') {
    const mo = new MutationObserver(relayout);
    bars.forEach((b) => mo.observe(b, { attributes: true, attributeFilter: ['class'], subtree: true }));
  }
}
initSegInk();
/* ★ 2026-10-02 教训一条（写在这儿免得下次再踩）：**顶层调用必须写在它用到的 const 之后**。
 *   initHero() 原先紧跟在第 34 步那行后面，而它要读的 `const HERO_TEXT` 声明在下面——
 *   TDZ 抛错本身不响，**真正贵的是它会把本文件后面所有顶层语句一起砍掉**
 *   （表现：页面看起来是好的，因为大部分初始化在更前面就做完了，
 *    但后面新加的 init 一个都没跑，且控制台什么都不报）。
 *   所以这里只留注释，真正的 initHero() 调用放在函数定义之后。 */

/* ──────────────────────────────────────────────────────────────
 * 第 35 步：★ 2026-10-02 首页 hero 化（prejoin 从"设备检查卡"变成"一屏叙事"）
 *
 * ▎为什么值得动这一屏：prejoin 是用户打开页面的**第一眼**，也就是本产品的落地页。
 *   原来它只有一张"检查设备"的卡，功能在但没有人味——用户不知道 AI 助理在场、
 *   不知道摄像头只在这里授权一次、也不知道可以先测网络。
 * ▎借鉴的是**编排语言**（模糊引导语 → 打字机主句 → 胶囊 CTA → 严格分层），
 *   不是它的资源：参考稿用外链视频当背景、外链字体当标题，
 *   而本项目是零依赖 + 可离线 PWA（内网/断网一部署，外链就是白屏），
 *   所以背景改成纯 CSS 光晕 + SVG 噪点（见 style.css 第 28 节），字体继续用本地衬线栈。
 * ▎三条纪律：
 *   ① **不写假链接**——顶栏三项全部接真功能（滚到设备卡 / 跑 ICE 自检 / 开设备码面板）；
 *   ② **打字机与 CTA 是两条独立时间线**（胶囊 400ms 出现，绝不等打字打完），
 *      否则慢的人看到的就是"页面卡住没按钮"；
 *   ③ **prefers-reduced-motion 直接出全文、不出现光标**——
 *      动效是装饰，不能变成一部分人读不到内容的门槛。
 * ────────────────────────────────────────────────────────────── */
const HERO_TEXT = '我是 AI 小明，这场会的记录员。先看看摄像头和麦克风，准备好了再进来。';

function heroReducedMotion() {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
}

/** 打字机：speed/startDelay 做成参数（默认 38ms/600ms），教学时想调快调慢不用改逻辑 */
function typeHeroLine(el, caret, text, speed = 38, startDelay = 600) {
  if (!el) return;
  if (heroReducedMotion()) {          // 降级：全文直出，光标节点根本不进 DOM
    el.textContent = text;
    if (caret && caret.parentNode) caret.remove();
    return;
  }
  el.textContent = '';
  let i = 0;
  setTimeout(() => {
    const tick = () => {
      i += 1;
      el.textContent = text.slice(0, i);
      if (i >= text.length) {
        // 打完了把光标**节点移除**（不是隐藏）——留着它就一直闪，抢视线
        if (caret && caret.parentNode) caret.remove();
        return;
      }
      setTimeout(tick, speed);
    };
    tick();
  }, startDelay);
}

function initHero() {
  const typed = $('heroTyped');
  const caret = $('heroCaret');
  const pills = $('heroPills');
  if (!typed && !pills) return;         // 老页面结构（没有 hero）时整体静默跳过
  typeHeroLine(typed, caret, HERO_TEXT);
  // ★ 与打字机并行：400ms 就让按钮出现，不等字打完（否则读屏/慢网络下像页面卡死）
  setTimeout(() => { if (pills) pills.classList.add('shown'); }, 400);

  /* 顶栏三个入口——每一个都必须真的有事可做 */
  const on = (id, fn) => {
    const el = $(id);
    if (el && el.addEventListener) el.addEventListener('click', (e) => { e.preventDefault(); fn(); });
  };
  on('heroLinkDevice', () => {
    const card = document.querySelector('.hero-device');
    if (card && card.scrollIntoView) card.scrollIntoView({ behavior: heroReducedMotion() ? 'auto' : 'smooth', block: 'center' });
    const sel = $('pjCamSelect');
    if (sel && sel.focus) try { sel.focus({ preventScroll: true }); } catch (err) { sel.focus(); }
  });
  on('heroLinkNet', () => {
    // 复用第 34 步那颗按钮，不另写一份探测逻辑（一个概念只有一个来源）
    const btn = document.querySelector('.ice-probe-btn');
    if (btn) btn.click();
    else showToast('网络自检还没就绪，稍等一下再点', 'info');
  });
  const openDesk = () => {
    if (authOverlay) authOverlay.classList.add('hidden');
    if (deskOverlay) deskOverlay.classList.remove('hidden');
    setTimeout(() => { try { deskCodeEl && deskCodeEl.focus(); } catch (e) { /* 桩里没这个元素 */ } }, 50);
  };
  on('heroLinkDesk', openDesk);
  on('heroLinkDesk2', openDesk);
}
initHero();   // ★ 第 35 步：调用点必须在 const/函数定义之后（见上面那条 TDZ 教训）
/* ──────────────────────────────────────────────────────────────
 * 第 34 步：★ 2026-10-02 Piik 取长④ —— 进房前 ICE 预检（把「沉默故障」说成人话）
 *
 * ▎为什么这条值得做：本项目最难缠的一类故障是坑 36 那种——什么都没报错，只是黑屏。
 *   跨网连不上时用户看到的就是「转圈 + 没画面」，而真正的原因往往是
 *   「这条网络把 UDP 全封了 / 没有可用 TURN」。我们已经有 doctor 与 test:turn，
 *   但那两个都在**服务器命令行**上，普通用户不会跑；Piik 的做法是把「能不能连」
 *   放进连接前的自检里，当场给一句人话（它的 ADR 里也明说 UDP 被全封时会显式失败）。
 * ▎做法（零依赖）：开一条一次性的 RTCPeerConnection，用服务器下发的**同一批** ICE 服务器，
 *   建一个数据通道只为触发 ICE 收集，5~6 秒内看它拿到哪些候选类型：
 *     relay → TURN 到位（跨网最稳）；srflx → STUN 打洞可用；
 *     只有 host → 同网可用、跨网还得靠 TURN；一个都没有 → UDP 很可能被阻断。
 * ▎诚实边界（写进 title 也写进日志，不夸口）：这测的是「本机到 ICE 服务器的连通性」，
 *   不等于「和会议服务器一定通」；而且 mediasoup 的媒体走 UDP、**不经 TURN 转发**
 *   （《部署手册.md》里那条边界），所以结论只用于提前预警 + 指路。
 * ────────────────────────────────────────────────────────────── */
const ICE_PROBE_VERDICT = {
  relay: { cls: 'ok', text: '中继可用（拿到 relay 候选，跨网最稳）' },
  stun: { cls: 'ok', text: '打洞可用（拿到公网 srflx 候选）' },
  lan: { cls: 'warn', text: '只有内网候选：同网能连，跨网需要 TURN' },
  blocked: { cls: 'bad', text: '没拿到任何候选：这条网络很可能封了 UDP' },
  na: { cls: 'warn', text: '本浏览器不支持 ICE 探测（已跳过）' },
};
let iceProbe = null; // { cls, text, verdict, at }
let iceProbeRunning = false;

function iceServersForProbe() {
  const list = (Array.isArray(sfuIceServers) && sfuIceServers.length)
    ? sfuIceServers : [{ urls: 'stun:stun.l.google.com:19302' }];
  return list.filter((x) => x && typeof x.urls === 'string');
}

function renderIceProbe() {
  const box = document.getElementById('iceProbe');
  if (!box) return;
  if (!iceProbe) { box.className = 'ice-probe'; box.textContent = ''; return; }
  box.className = `ice-probe ${iceProbe.cls}`;
  /* 结论前面挂一颗"信号"图标：这一行的三色（好/中/差）本来就靠 class 切换，
     图标跟着走比一个 📡 贴纸更省事——但判据只在这里写一次，按钮与结果行共用 ICONS.signal。 */
  box.innerHTML = ICONS.signal + `<span>网络自检：${escapeHtml(iceProbe.text)}</span>`;
  box.title = '结论只表示「本机到 ICE 服务器的连通性」，不代表与会议服务器一定连通'
    + '（SFU 媒体走 UDP、不经 TURN 转发，详见《部署手册.md》）';
}

async function runIceProbe() {
  if (iceProbeRunning) return iceProbe;
  if (!window.RTCPeerConnection) {
    iceProbe = Object.assign({ verdict: 'na', at: Date.now() }, ICE_PROBE_VERDICT.na);
    renderIceProbe();
    return iceProbe;
  }
  iceProbeRunning = true;
  const types = new Set();
  let pc = null;
  try {
    pc = new window.RTCPeerConnection({ iceServers: iceServersForProbe() });
    pc.createDataChannel('ice-probe'); // 只为触发 ICE 收集，不需要真的连通任何人
    pc.onicecandidate = (e) => {
      const c = e && e.candidate && e.candidate.candidate;
      if (!c) return;
      if (/ typ relay/.test(c)) types.add('relay');
      else if (/ typ srflx/.test(c)) types.add('srflx');
      else if (/ typ host/.test(c)) types.add('host');
    };
    await pc.setLocalDescription(await pc.createOffer());
    const deadline = Date.now() + 6000;
    // 拿到 relay 就提前收工（relay 通常最慢，等满 6 秒没意义）
    while (Date.now() < deadline && !types.has('relay')) await new Promise((r) => setTimeout(r, 250));
    const verdict = types.has('relay') ? 'relay' : types.has('srflx') ? 'stun' : types.has('host') ? 'lan' : 'blocked';
    iceProbe = Object.assign({ verdict, at: Date.now() }, ICE_PROBE_VERDICT[verdict]);
    log(`📡 ICE 自检：${iceProbe.text}`);
    if (verdict === 'blocked') {
      showToast('这条网络可能封了 UDP：同网可以开会；跨网请换网络，或按《部署手册.md》用 Tailscale / 云主机', 'error', 9000);
    }
  } catch (err) {
    iceProbe = Object.assign({ verdict: 'na', at: Date.now() }, ICE_PROBE_VERDICT.na, { text: `自检失败：${err.message}` });
  } finally {
    try { if (pc) pc.close(); } catch (e) { /* 忽略 */ }
    iceProbeRunning = false;
    renderIceProbe();
  }
  return iceProbe;
}

function initIcePrecheck() {
  const card = document.querySelector('.prejoin-card');
  if (!card || document.getElementById('iceProbe')) return;
  const row = document.createElement('div');
  row.className = 'ice-probe-row';
  const btn = document.createElement('button');
  btn.className = 'btn ghost ice-probe-btn';
  setIconBtn(btn, ICONS.signal, '测网络');
  btn.title = '开一条一次性 ICE 探测（约 6 秒），看这条网络能不能打洞、有没有中继可用';
  btn.addEventListener('click', () => {
    iceProbe = null;
    renderIceProbe();
    const box = document.getElementById('iceProbe');
    if (box) { box.className = 'ice-probe run'; box.textContent = '网络自检中…'; }
    runIceProbe();
  });
  const out = document.createElement('div');
  out.id = 'iceProbe';
  out.className = 'ice-probe';
  row.appendChild(btn);
  row.appendChild(out);
  card.appendChild(row);
  // 进预览页自动测一次：先等配置落地（否则用不到服务器下发的 TURN，结论会偏悲观），
  // 且整段都不阻塞——用户该点「进入会议」照样能点，自检只是给个预告。
  setTimeout(async () => {
    try { if (typeof ensureAsrConfig === 'function') await ensureAsrConfig(); } catch (e) { /* 拿不到配置就用默认 STUN */ }
    runIceProbe();
  }, 1200);
}

initAiChips();          // 快捷问法按钮（点一下 = 手打 "@ai …"）
initBoardActions();     // 看板头的「📝 出纪要」
initAiVoice();          // ★ 09-25 AI 语音播报开关（默认关，用户可开）
renderBoard();          // 先渲染一次空看板（把"投喂提示"空状态显示出来）
renderChatUnread();
renderAiChips();        // 初始隐藏（AI 还没入会）

/* ══ 第 42 步：★ 2026-10-03 登录页光标辉光（移植 reactbits GlowCursor，裸 WebGL，零依赖）══
 * ▎原组件靠 ogl（一个 WebGL 微型库）。本项目红线是不引第三方依赖（AGENTS 第 3 节），
 *   所以这里**着色器原样搬、渲染器自己写**：全屏三角形 + 同一套 uniform 名。
 *   画面与原版一致，不是"用 CSS 近似一下"。
 * ▎为什么放在登录这一屏：它本来就是产品的第一眼（第 28 节 hero 化）。辉光是**跟着光标走的
 *   氛围**，与静态光晕不同层；光标停 700ms 就淡出（idleFade），所以不会变成"背景在自己抖"。
 * ▎配色守水墨丹青：鎏金起、朱砂尾（原组件的青紫与全站暖墨调冲突，直接换掉）。
 * ▎三条工程纪律写死在下面：
 *   ① 无 WebGL / 系统要求减弱动态 → 整块不起 rAF，只留静态氛围（功能不降级也不报错）；
 *   ② 离开登录页必须 cancelAnimationFrame + 摘监听（否则一场长会里它还在后台烧 GPU）；
 *   ③ 顶层调用放在文件**最末尾**且 try 包住——坑 69：顶层 init 链任何一行抛错，
 *      后面所有初始化都会被静默砍掉（那次表现为"AI 回答没声音"）。 */
const GLOW_MAX_POINTS = 64;
const GLOW_VS = [
  'attribute vec2 position;',
  'attribute vec2 uv;',
  'varying vec2 vUv;',
  'void main() { vUv = uv; gl_Position = vec4(position, 0.0, 1.0); }',
].join('\n');
/* 与原版同一份 GLSL（uniform 名保持一致，日后对照上游改动不费劲） */
const GLOW_FS = [
  'precision highp float;',
  '#define MAX_POINTS 64',
  'uniform vec2 uResolution;',
  'uniform vec2 uPoints[MAX_POINTS];',
  'uniform float uPointCount;',
  'uniform vec3 uColor;',
  'uniform vec3 uSecondaryColor;',
  'uniform float uTrailWidth;',
  'uniform float uTaper;',
  'uniform float uGlowIntensity;',
  'uniform float uGlowSpread;',
  'uniform float uHotspot;',
  'uniform float uBrightness;',
  'uniform float uOpacity;',
  'uniform float uPulseSpeed;',
  'uniform float uNoiseStrength;',
  'uniform float uNormalBlend;',
  'uniform float uTime;',
  'uniform float uFade;',
  'varying vec2 vUv;',
  'float sRGB(float x) { if (x <= 0.00031308) return 12.92 * x; return 1.055 * pow(x, 1.0 / 2.4) - 0.055; }',
  'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }',
  'float filmGrain(vec2 p, float time) {',
  '  float frame = time * 18.0;',
  '  float fi = mod(floor(frame), 256.0);',
  '  float ni = mod(fi + 1.0, 256.0);',
  '  float blend = fract(frame); blend = blend * blend * (3.0 - 2.0 * blend);',
  '  vec2 pixel = floor(p);',
  '  float cur = hash(pixel + vec2(fi * 17.0, fi * 31.0));',
  '  float nxt = hash(pixel + vec2(ni * 17.0, ni * 31.0));',
  '  return mix(cur, nxt, blend) * 2.0 - 1.0;',
  '}',
  'void main() {',
  '  vec2 pixel = vUv * uResolution;',
  '  float denom = max(uPointCount - 1.0, 1.0);',
  '  float strongest = 0.0; float strongestCore = 0.0; float colorWeight = 0.0;',
  '  vec3 colorSum = vec3(0.0);',
  '  for (int i = 0; i < MAX_POINTS - 1; i++) {',
  '    float index = float(i);',
  '    float active = 1.0 - step(uPointCount - 1.0, index);',
  '    vec2 start = uPoints[i];',
  '    vec2 end = uPoints[i + 1];',
  '    vec2 toPixel = pixel - start;',
  '    vec2 segment = end - start;',
  '    float along = clamp(dot(toPixel, segment) / max(dot(segment, segment), 0.0001), 0.0, 1.0);',
  '    float progress = clamp((index + along) / denom, 0.0, 1.0);',
  '    float life = pow(max(1.0 - progress, 0.0), mix(0.55, 1.25, uTaper));',
  '    float width = uTrailWidth * mix(1.0, 0.25, pow(progress, mix(0.55, 1.6, uTaper)));',
  '    float dist = length(toPixel - segment * along);',
  '    float falloff = max(width * (0.8 + uGlowSpread * 1.4), 0.5);',
  '    float beam = min(1.0, (falloff * falloff) / (dist * dist + falloff * falloff));',
  '    float core = exp(-pow(dist / max(width, 0.5), 2.0) * 2.5);',
  '    float pa = min(abs(uPulseSpeed), 1.0);',
  '    float pulse = 1.0 + sin(uTime * uPulseSpeed * 3.0 - progress * 11.0) * 0.16 * pa;',
  '    float intensity = (core + beam * uGlowIntensity * 0.55) * life * pulse * active;',
  '    vec3 segColor = mix(uColor, uSecondaryColor, progress);',
  '    strongest = max(strongest, intensity);',
  '    strongestCore = max(strongestCore, core * life * active);',
  '    colorSum += segColor * intensity;',
  '    colorWeight += intensity;',
  '  }',
  '  float grain = filmGrain(pixel, uTime);',
  '  float noiseAmount = (1.0 - exp(-uNoiseStrength * 2.2)) * 0.4;',
  '  float alpha = clamp(strongest * uOpacity * uFade, 0.0, 1.0);',
  '  if (alpha < 0.0005) discard;',
  '  vec3 color = colorSum / max(colorWeight, 0.0001);',
  '  color = mix(color, vec3(1.0), smoothstep(0.25, 0.95, strongestCore) * uHotspot);',
  '  float luminance = sRGB(clamp(strongest * uBrightness, 0.0, 1.0));',
  '  luminance *= 1.0 + grain * noiseAmount;',
  '  vec3 additiveColor = color * luminance;',
  '  float normalAlpha = clamp(strongest * uBrightness * uOpacity * uFade, 0.0, 1.0);',
  '  vec3 normalColor = mix(color, vec3(1.0), smoothstep(0.45, 1.0, strongestCore) * uHotspot * 0.35);',
  '  gl_FragColor = vec4(mix(additiveColor, normalColor, uNormalBlend), mix(alpha, normalAlpha, uNormalBlend));',
  '}',
].join('\n');

function glowHexToRgb(hex) {
  let v = String(hex || '').replace('#', '').trim();
  if (v.length === 3) v = v.split('').map((c) => c + c).join('');
  const n = Number.parseInt(v || '000000', 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const glowClamp = (v, a, b) => Math.min(Math.max(Number(v) || 0, a), b);

/** 在 host 里挂一条光标辉光。返回 { start, stop, alive, sample }；拿不到 WebGL 返回 null。 */
function initGlowTrail(host, opts) {
  if (!host || typeof document === 'undefined') return null;
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  } catch (e) { /* 问不到就当允许 */ }
  const cfg = Object.assign({
    color: '#d8b36a', secondaryColor: '#b93a26',
    trailLength: 34, trailWidth: 7, trailTaper: 0.8, followSpeed: 0.16,
    glowIntensity: 1.9, glowSpread: 1.2, hotspot: 0.6, brightness: 1.15, opacity: 0.9,
    pulseSpeed: 1.0, noiseStrength: 0.03, idleFade: true, idleTimeout: 700, fadeDuration: 900, maxDpr: 1.5,
  }, opts || {});

  const canvas = document.createElement('canvas');
  canvas.className = 'hero-trail';
  canvas.setAttribute('aria-hidden', 'true');
  if (host.firstChild) host.insertBefore(canvas, host.firstChild); else host.appendChild(canvas);

  /* preserveDrawingBuffer:true 是**为了可测**：不保留缓冲时帧外读 canvas 只会拿到空白，
   *   自动化检查就只能证明"没报错"而不是"真画出了像素"。代价是一点带宽。 */
  const glOpts = { alpha: true, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true };
  let gl = null;
  try { gl = canvas.getContext('webgl', glOpts) || canvas.getContext('experimental-webgl', glOpts); }
  catch (e) { gl = null; }
  if (!gl) { canvas.setAttribute('data-off', ''); return null; }

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const msg = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(String(msg).slice(0, 80));
    }
    return s;
  };
  let prog;
  try {
    const vs = compile(gl.VERTEX_SHADER, GLOW_VS);
    const fs = compile(gl.FRAGMENT_SHADER, GLOW_FS);
    prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(String(gl.getProgramInfoLog(prog)).slice(0, 80));
    gl.deleteShader(vs); gl.deleteShader(fs);
  } catch (e) {
    canvas.setAttribute('data-off', '');
    log('🌗 登录页辉光未启用（WebGL 着色器不可用）：' + (e && e.message));
    return null;
  }
  gl.useProgram(prog);

  /* 一个"大三角形"铺满屏幕：position 到 3、uv 到 2，插值后正好覆盖 0~1 */
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 0, 3, -1, 2, 0, -1, 3, 0, 2]), gl.STATIC_DRAW);
  /* 每个顶点 4 个 float（px, py, u, v）→ stride 必须是 16 字节。
   *   ▸ 这里原先写成 8 * 4 = 32（把"每顶点 8 个 float"当成了事实），于是第二个顶点
   *     从错误的偏移读起、三角形退化成垃圾 → **屏幕上什么都没有，而且零报错**。
   *     发现路径不是猜的：整幅 readPixels 扫下来非零像素数 = 0。
   *     WebGL 的失败几乎都是静默的，所以这条功能的存在与否必须由像素来证明（见 check:glow）。 */
  const STRIDE_FLOATS = 4;
  const bindAttr = (name, size, offset) => {
    const loc = gl.getAttribLocation(prog, name);
    if (loc < 0) return;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE_FLOATS * 4, offset * 4);
  };
  bindAttr('position', 2, 0); bindAttr('uv', 2, 2);

  const U = {};
  ['uResolution', 'uPoints', 'uPointCount', 'uColor', 'uSecondaryColor', 'uTrailWidth', 'uTaper',
    'uGlowIntensity', 'uGlowSpread', 'uHotspot', 'uBrightness', 'uOpacity', 'uPulseSpeed',
    'uNoiseStrength', 'uNormalBlend', 'uTime', 'uFade'].forEach((k) => {
      /* 数组 uniform 的 location：多数实现认 'uPoints'，也有只认 'uPoints[0]' 的。
       *   取不到就是 null，而 uniform2fv(null, …) 同样是**静默 no-op**。 */
      let loc = gl.getUniformLocation(prog, k);
      if (loc === null && k === 'uPoints') loc = gl.getUniformLocation(prog, k + '[0]');
      U[k] = loc;
    });

  const pointData = new Float32Array(GLOW_MAX_POINTS * 2);
  const points = [];
  for (let i = 0; i < GLOW_MAX_POINTS; i++) points.push({ x: 0, y: 0 });
  const target = { x: 0, y: 0 };
  const head = { x: 0, y: 0 };
  let w = 1; let h = 1; let dpr = 1;
  let initialized = false; let inside = false; let fade = 0;
  let lastInput = 0; let lastFrame = 0; let raf = 0; let running = false; let dead = false;

  const resize = () => {
    const r = host.getBoundingClientRect();
    w = Math.max(1, Math.round(r.width || 1));
    h = Math.max(1, Math.round(r.height || 1));
    dpr = Math.min(window.devicePixelRatio || 1, cfg.maxDpr);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  const seed = (x, y) => {
    target.x = head.x = x; target.y = head.y = y;
    for (const p of points) { p.x = x; p.y = y; }
    initialized = true; fade = 1;
  };
  const onMove = (ev) => {
    const r = host.getBoundingClientRect();
    const x = glowClamp(ev.clientX - r.left, 0, r.width);
    const y = glowClamp(r.height - (ev.clientY - r.top), 0, r.height);
    if (!initialized) seed(x, y);
    target.x = x; target.y = y; inside = true; lastInput = performance.now();
  };
  const onLeave = () => { inside = false; lastInput = performance.now(); };

  const frame = (now) => {
    if (!running) return;
    const dt = Math.min((now - (lastFrame || now)) / 16.667, 3);
    lastFrame = now;
    if (initialized) {
      const headEase = 1 - Math.pow(1 - glowClamp(cfg.followSpeed, 0.01, 0.99), dt);
      const chainEase = 1 - Math.pow(1 - glowClamp(0.28 + cfg.followSpeed * 0.35, 0.08, 0.92), dt);
      head.x += (target.x - head.x) * headEase; head.y += (target.y - head.y) * headEase;
      points[0].x = head.x; points[0].y = head.y;
      for (let i = 1; i < GLOW_MAX_POINTS; i++) {
        points[i].x += (points[i - 1].x - points[i].x) * chainEase;
        points[i].y += (points[i - 1].y - points[i].y) * chainEase;
      }
      for (let i = 0; i < GLOW_MAX_POINTS; i++) { pointData[i * 2] = points[i].x; pointData[i * 2 + 1] = points[i].y; }
    }
    const idleFor = now - lastInput;
    const shouldFade = cfg.idleFade && (!inside || idleFor > cfg.idleTimeout);
    const fadeStep = (16.667 * dt) / Math.max(cfg.fadeDuration, 16);
    fade += ((initialized && !shouldFade ? 1 : 0) - fade) * Math.min(1, fadeStep * 7);

    gl.uniform2f(U.uResolution, w, h);
    gl.uniform2fv(U.uPoints, pointData);
    gl.uniform1f(U.uPointCount, glowClamp(Math.round(cfg.trailLength), 2, GLOW_MAX_POINTS));
    gl.uniform3fv(U.uColor, glowHexToRgb(cfg.color));
    gl.uniform3fv(U.uSecondaryColor, glowHexToRgb(cfg.secondaryColor));
    gl.uniform1f(U.uTrailWidth, Math.max(cfg.trailWidth, 0.1));
    gl.uniform1f(U.uTaper, glowClamp(cfg.trailTaper, 0, 1));
    gl.uniform1f(U.uGlowIntensity, Math.max(cfg.glowIntensity, 0));
    gl.uniform1f(U.uGlowSpread, Math.max(cfg.glowSpread, 0));
    gl.uniform1f(U.uHotspot, glowClamp(cfg.hotspot, 0, 1));
    gl.uniform1f(U.uBrightness, Math.max(cfg.brightness, 0));
    gl.uniform1f(U.uOpacity, glowClamp(cfg.opacity, 0, 1));
    gl.uniform1f(U.uPulseSpeed, cfg.pulseSpeed);
    gl.uniform1f(U.uNoiseStrength, glowClamp(cfg.noiseStrength, 0, 1));
    gl.uniform1f(U.uNormalBlend, 0);
    gl.uniform1f(U.uTime, now * 0.001);
    gl.uniform1f(U.uFade, fade);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (running) raf = requestAnimationFrame(frame);
  };

  /* ▎为什么监听挂在 window 而不是 host（真浏览器抓出来的）：
   *   登录时用户实际把鼠标停在 **.auth-overlay（登录卡，z-110）** 上，
   *   而它是 #prejoin 的**兄弟**、不是子孙 —— 挂在 host 上的冒泡监听一次都收不到，
   *   于是辉光"代码全对、永远不亮"。辉光是背景氛围，本来就该在卡片背后跟着鼠标走，
   *   所以事件源用 window、几何仍按 host 的矩形算（两者不必是同一个元素）。 */
  const start = () => {
    if (running || dead) return;
    running = true;
    lastFrame = performance.now(); lastInput = lastFrame;
    resize();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onMove);
    document.addEventListener('pointerleave', onLeave);
    raf = requestAnimationFrame(frame);
  };
  /* 离开登录页必须停：rAF 不停 = 一整场会都在后台烧 GPU，而没人看得见它 */
  const stop = () => {
    running = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerdown', onMove);
    document.removeEventListener('pointerleave', onLeave);
  };
  canvas.addEventListener('webglcontextlost', (ev) => {
    if (ev && ev.preventDefault) ev.preventDefault();
    dead = true; stop(); canvas.setAttribute('data-off', '');
  });
  if (typeof ResizeObserver === 'function') {
    try { new ResizeObserver(resize).observe(host); } catch (e) { /* 观察不上就靠 window resize */ }
  }
  window.addEventListener('resize', resize);

  return {
    start, stop, canvas,
    alive: () => running,
    fade: () => fade,
    /* 取画布中心那点像素（真浏览器检查用它证明"真的画出了东西"，而不是"没抛错"） */
    sample: () => glowRead(0.5, 0.5),
    /* 按归一化坐标取一点：检查里"把鼠标拖到哪就读哪"，
     *   不然轨迹不在中心就会读出 [0,0,0,0] 的**假失败**（本轮就是这么红的）。 */
    sampleAt: (nx, ny) => glowRead(glowClamp(nx, 0, 1), glowClamp(ny, 0, 1)),
  };

  function glowRead(nx, ny) {
    const p = new Uint8Array(4);
    const x = Math.round(glowClamp(nx, 0, 1) * (canvas.width - 1));
    /* WebGL 的 y 轴从下往上，而光标坐标从上往下 → 这里要翻一次 */
    const y = Math.round((1 - glowClamp(ny, 0, 1)) * (canvas.height - 1));
    try { gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p); } catch (e) { return [0, 0, 0, 0]; }
    return [p[0], p[1], p[2], p[3]];
  }
}

/* 顶层调用：放在文件**最末尾**并用 try 包住（坑 69——顶层 init 链一断，后面全静默）。 */
let glowTrail = null;
try {
  glowTrail = initGlowTrail($('prejoin'), {});
  if (glowTrail) glowTrail.start();
} catch (e) {
  glowTrail = null;
  try { log('🌗 登录页辉光初始化失败（不影响会议）：' + (e && e.message)); } catch (e2) { /* 桩环境就算了 */ }
}

/* ★ 2026-10-04i 第一屏（登录卡）也要那条滑动光线——而两条轨只能跑一条。
 * ▎用户的原话是"第一个界面要有第二个页面那个滑动光线的效果，要自然"。
 *   根因不在光轨本身：#prejoin 里那条一直画得好好的，但 `.auth-overlay` 是**实底背景**
 *   （双层 radial-gradient + var(--bg0)），把它 100% 盖住——与此同时 window 级
 *   pointermove 还在驱动它：**既看不见、又白烧 GPU**（"看不见的开销"同 09-19d 总纲）。
 * ▎正解 = 登录卡自己挂一条轨（同一个 initGlowTrail 实现，着色器一份不动）。
 *   canvas 插在遮罩 firstChild，CSS 里走负 z-index：堆叠上下文的绘制顺序是
 *   "宿主背景 → 负 z 子层 → in-flow 内容"，于是光在实底背景之上、登录卡之下——
 *   卡片那层 backdrop-filter 顺手把背后的光磨砂虚化，层次正是"背景氛围"该有的。 */
let authGlowTrail = null;
try {
  authGlowTrail = initGlowTrail($('authOverlay'), {});
} catch (e) {
  authGlowTrail = null;
  try { log('🌗 登录屏辉光初始化失败（不影响登录）：' + (e && e.message)); } catch (e2) { /* 桩环境就算了 */ }
}

/** 两条辉光轨的启停总闸：哪一屏真的在最上面，只跑哪一条（都收起 = 都停）。
 *  ▎判据**只有一处来源**：两个遮罩的 .hidden 状态 —— 不去读光标、不去读 z-index
 *    （那些是"效果"不是"事实"）。auth 在上（z110）→ 只跑 auth 轨；
 *    auth 收起、prejoin 还在（z100）→ 只跑 prejoin 轨；进会（prejoin 也收起）→ 都停。
 *  ▎start/stop 各自幂等（start 有 running 守卫），所以这里不需要记账"上次谁在跑"。 */
function syncGlowTrails() {
  const authVisible = !!(authOverlay && !authOverlay.classList.contains('hidden'));
  const prejoinVisible = !!(prejoinEl && !prejoinEl.classList.contains('hidden'));
  const wantAuth = authVisible;
  const wantPrejoin = !authVisible && prejoinVisible;
  if (authGlowTrail) { if (wantAuth) authGlowTrail.start(); else authGlowTrail.stop(); }
  if (glowTrail) { if (wantPrejoin) glowTrail.start(); else glowTrail.stop(); }
}

/* 接线：盯两个遮罩的 class 变化 —— hidden 的每一次增删都会走到总闸
 *   （hideAuth()、desk 面板进出、hero「用设备码控电脑」、进会时 prejoin 收起……全覆盖）。
 *   为什么用观察器而不是去改那五处散落的调用点：散点接线漏一处，症状是
 *   "收起登录卡后光没了"或"进会后还在烧 GPU"，两个都不报错（坑 47 家族）。
 *   桩里没有 MutationObserver（守卫式接线），判据本身由冒烟直接调 syncGlowTrails()
 *   的**行为断言**覆盖——三态（登录屏 / 预览页 / 进会）各走一遍。 */
if (typeof MutationObserver === 'function') {
  try {
    const glowMo = new MutationObserver(() => { try { syncGlowTrails(); } catch (e) { /* 单次失败不拆观察器 */ } });
    if (authOverlay) glowMo.observe(authOverlay, { attributes: true, attributeFilter: ['class'] });
    if (prejoinEl) glowMo.observe(prejoinEl, { attributes: true, attributeFilter: ['class'] });
  } catch (e) { /* 观察不上就只失去"自动切换"，不影响任何其它功能 */ }
}
syncGlowTrails();

/* ══ 第 43 步：★ 2026-10-03 胶囊按钮的"液体上涨"hover（移植 reactbits PillNav，零依赖）══
 * ▎原组件用 GSAP 时间轴驱动一个算出来的圆：圆从按钮**底部正中**涨起来，弧面恰好经过底边两侧，
 *   同时文字向上退场、另一份同文文字从下面进场。手感之所以好，是因为那个圆不是"随便一个大圆"，
 *   而是按按钮尺寸解出来的 —— 公式原样搬在下面（R / D / delta / originY）。
 * ▎移植策略：几何由 JS 算成 CSS 变量，动画交给 CSS transition。
 *   这样运行时不依赖 GSAP（零依赖红线），而 hover / focus-visible / :disabled 全部由 CSS 状态机管，
 *   不需要 JS 去监听 mouseenter 再手动播时间轴——少一条会漏的事件路径。
 * ▎唯一有意偏离原版的参数：时长从 2s 收到 .62s（见 style.css 第 32 节注释）。 */

/** 按按钮当前尺寸重算圆的直径、下沉量与缩放原点。
 *  ▎为什么单独成函数：字体加载完成、窗口缩放、布局变化都会让按钮宽度变——
 *    圆是按宽度解出来的，尺寸变了不重算，就会露出"圆没填满角落"或"溢出成方块"的破绽。 */
function pillRiseMeasure(btn) {
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const w = Math.max(1, r.width);
  const h = Math.max(1, r.height);
  /* 圆弧经过按钮底边两个角、且圆心在底边中垂线上：
   *   R = ((w²/4) + h²) / (2h)   ← 原组件同款解法
   *   D = 2R（再 +2 防抗锯齿露边）；delta = 圆顶到按钮底边的距离（让弧从下面涨上来）
   *   originY = D - delta → 缩放原点落在圆的下缘，视觉上就是"从底部生长" */
  const R = ((w * w) / 4 + h * h) / (2 * h);
  const D = Math.ceil(2 * R) + 2;
  const delta = Math.ceil(R - Math.sqrt(Math.max(0, R * R - (w * w) / 4))) + 1;
  const set = (k, v) => btn.style.setProperty(k, String(v));
  set('--pr-d', D);
  set('--pr-delta', delta);
  set('--pr-origin', D - delta);
  set('--pr-h', Math.round(h));
}

/** 把一颗按钮**当前**的子内容包成"基础层 + 悬停层"（圆不在这里建，见 pillRise）。
 *  ▎为什么单独成函数：会中那些按钮的文案是 JS 改的（`setIconBtn` 整块重写 innerHTML），
 *    而 innerHTML 赋值会把两层标签连圆一起清掉——表现是"按钮点一下就没了动效"。
 *    所以 setIconBtn 之后要能**原地重新包一次**，而不是重新发明一套结构。 */
function pillRiseWrap(btn) {
  const stack = document.createElement('span');
  stack.className = 'pill-rise__stack';
  const base = document.createElement('span');
  base.className = 'pill-rise__label';
  const hover = document.createElement('span');
  hover.className = 'pill-rise__label pill-rise__label--hover';
  /* 原有子节点整体搬进基础层：图标（滤镜/设备码那颗）跟着走，不会被这次改造弄丢。
   *   ▸ 只搬"不是我造的那两个容器"——重建时圆与旧 stack 还在按钮里（桩的 innerHTML
   *     赋值不清子节点，真浏览器会清），把它们一起搬进 base 就成了套娃。 */
  for (;;) {
    const c = btn.firstChild;
    if (!c) break;
    const cn = (c.getAttribute && (c.getAttribute('class') || '')) || '';
    if (cn.indexOf('pill-rise__') === 0) { c.remove ? c.remove() : btn.children.splice(btn.children.indexOf(c), 1); continue; }
    base.appendChild(c);
  }
  hover.innerHTML = base.innerHTML;
  hover.setAttribute('aria-hidden', 'true');   // 同一句话读两遍是噪音
  stack.appendChild(base);
  stack.appendChild(hover);
  return stack;
}

/** 给一颗按钮装/重装"上涨"外壳：圆 + 两层文字。
 *  ▎为什么顺序是"先搬内容、再放圆、最后放 stack"：圆要画在文字**下面**，
 *    而 DOM 顺序决定同层元素的绘制次序——反过来写就会把圆盖在字上（本函数第一版就写反了，
 *    被第 43 步那条"重复调用不长第二套"的老断言当场抓到：圆被搬进了文字层里）。 */
function pillRiseShell(btn) {
  const stack = pillRiseWrap(btn);
  const circle = document.createElement('span');
  circle.className = 'pill-rise__circle';
  circle.setAttribute('aria-hidden', 'true');
  btn.appendChild(circle);
  btn.appendChild(stack);
}

/** 把一颗按钮改成"上涨"式：建圆 + 把内容包成两层文字（原内容整体当基础层，图标一起搬）。 */
function pillRise(btn) {
  if (!btn || btn.dataset.pillRise) { pillRiseMeasure(btn); return; }
  btn.dataset.pillRise = '1';
  pillRiseShell(btn);
  btn.classList.add('pill-rise');
  pillRiseMeasure(btn);
}

/** 初始化：登录页那一排行动胶囊（进入会议 / 滤镜 / 设备码）用同一套手感。
 *  ▎为什么整排都做而不是只做「进入会议」：三颗并排放着，只有一颗会"涨"，
 *    另外两颗就像坏了——同组的控件必须共享同一套交互语言。 */
function initPillRise() {
  /* 登录页那一排行动胶囊 + ★ 2026-10-04 会中控制坞那一排（用户点名"视频下面那些按钮"）。
   * ▎为什么整排都做而不是只做一颗：同组控件必须共享同一套交互语言——
   *   只有一颗会"涨"，其余就像坏了。
   * ▎为什么排掉 .tgl：BellToggle 那套开关**自己已经是两层标签交叉淡入**（开/关两个字
   *   在同一个格里换位）。再套一层上涨就是两套动效抢同一颗按钮，观感是抖。 */
  const pills = document.querySelectorAll('.hero-pills .pill, .controls .btn:not(.tgl)');
  for (let i = 0; i < pills.length; i++) pillRise(pills[i]);
  const remeasure = () => { for (let i = 0; i < pills.length; i++) pillRiseMeasure(pills[i]); };
  window.addEventListener('resize', remeasure);
  /* 字体是外链的（Noto Serif SC / 系统衬线回退），度量在加载完成那一瞬会变：
   *   不重算就会出现"圆没填满角落"。这是"按钮变宽→圆要跟着重解"的真实触发源。 */
  if (document.fonts && typeof document.fonts.ready === 'object') {
    try { document.fonts.ready.then(remeasure).catch(() => { /* 量不到就算了 */ }); } catch (e) { /* 同上 */ }
  }
  setTimeout(remeasure, 1200);   // 兜一次：hero 文案是逐字打的，宽度会在前 1~2s 内变
  return remeasure;   // ★ 第 45 步：底部那一列换行/长高时由它统一再量一次
}

/* 顶层调用：仍在文件末尾之后，try 包住（坑 69——顶层 init 链一断，后面全部静默不跑）。 */
let remeasurePills = null;
try { remeasurePills = initPillRise(); } catch (e) { try { log('🔘 胶囊上涨效果初始化失败（不影响按钮功能）：' + (e && e.message)); } catch (e2) { /* 桩环境就算了 */ } }
/* 第 46 步：可访问名同步必须**排在上涨改造之后**——上涨会把一句话克隆成两层，
   先同步就会把「静音」之外的东西（甚至「静音静音」）写进 aria-label。 */
try { syncAriaNames(document); } catch (e) { try { log('♿ 可访问名同步失败（读屏会念不出按钮）：' + (e && e.message)); } catch (e2) { /* 桩环境就算了 */ } }

/* ══ 第 45 步：★ 2026-10-04 把"底部那一列有多高"量成一个变量给全舞台用 ══
 * ▎触发它的缺陷（用户报"让 AI 调白板之后字幕不可用了"）：白板覆盖层是
 *   `position:absolute; inset:0; z-index:6`，而字幕条 + 控制坞所在的 .bottom-stack 是 z-index:5。
 *   于是白板一开，**字幕条和整排按钮一起被盖住**——用户看到的现象就是"字幕不可用"，
 *   而字幕那套状态机（开关/账本/看门狗/服务端模式）一个字都没错。
 *   真浏览器命中测试量出来的：白板开着时，字幕条中心与控制坞中心的实际接收者都是 #boardCanvas。
 * ▎为什么不能只把 z-index 调小：那样字幕条和按钮是能点了，但它们的**下半截会压在白板画布上**，
 *   白板底部那块区域画不到——从一个毛病换成另一个毛病。
 * ▎正解是"让位"：白板仍然盖住视频画面（那是它的职责），但底边停在底部那一列之上。
 *   而"那一列有多高"是**会变**的（坞拆成两行、字幕条开合、「允许远程协助」按钮出现、
 *   窄屏换行……），所以不能在任何地方再写一个 bottom:118px 这样的数——
 *   用 ResizeObserver 量真实高度，写进 --stack-h，全舞台只有这一个来源（坑 47）。
 *   与第 43 步的 pillRiseMeasure 是同一条做法：**几何量出来，不猜**。 */
function initBottomStackVar() {
  const stack = document.querySelector('.bottom-stack');
  if (!stack) return;
  /* 桩环境/极老浏览器没有 ResizeObserver：不装，让 CSS 里的兜底值生效
     （--stack-h 缺省 118px ≈ 两行坞 + 字幕条，宁可留白也别把白板铺满挡住按钮）。 */
  if (typeof ResizeObserver !== 'function') return;
  const apply = () => {
    const h = Math.round(stack.getBoundingClientRect().height);
    if (h > 0) document.documentElement.style.setProperty('--stack-h', `${h}px`);
    /* 同一件事触发两个下游：坞换行/长高既改变"底部让位多少"，也改变每颗按钮的宽高——
       上涨的圆是按宽度解出来的，所以顺手再量一次按钮（一个观察者，两处派生值）。 */
    if (typeof remeasurePills === 'function') remeasurePills();
  };
  new ResizeObserver(apply).observe(stack);
  apply();
}

try { initBottomStackVar(); } catch (e) { try { log('📐 底部高度变量初始化失败（白板会退回整屏覆盖）：' + (e && e.message)); } catch (e2) { /* 桩环境就算了 */ } }

/* ★ 2026-10-05 问题⑥：大画面等比 contain 的"尺寸变化"来源（fitMainTile 见布局段）。
 *   大画面**换人**走 applyLayoutDOM 直调；grid 盒子**换尺寸**（窗口缩放 / 侧栏开合 /
 *   胶片条换行把第一行挤矮）由这里兜住——一个 ResizeObserver 观察 grid 自身，
 *   尺寸没变就不重算（observer 语义天然如此），不会给 audio-levels 那种高频路径添开销。 */
function initMainTileFit() {
  if (typeof ResizeObserver !== 'function') return; // 桩/极老浏览器：让 CSS 缺省值生效
  new ResizeObserver(() => { fitMainTile(); applyScreenSpan(); }).observe(videoGrid);
  fitMainTile(); // 首帧补一次（进会前 grid 可能是 0 尺寸，进会时 observer 会自己再响）
  applyScreenSpan();
}
try { initMainTileFit(); } catch (e) { try { log('🖼️ 大画面等比适配初始化失败（会退回 CSS 缺省宽度）：' + (e && e.message)); } catch (e2) { /* 桩环境就算了 */ } }

/* ★ 2026-10-06 第 37 节效果的驱动端：把光标位置写进被聚光那一格的 --mx/--my。
 * ▎两条纪律决定了它的写法：
 *   ① **move 里绝不量 rect**（坑 59：白板当年每次 pointermove 一次 getBoundingClientRect
 *      = 一次强制同步布局，一次拖拽几百次）。rect 只在"进入这一块"时量一次并缓存；
 *      缓存会因窗口缩放/侧栏开合过期，所以每次重新进入都重量——移出去再回来就是新的。
 *   ② **每帧最多写一次**（rAF 闩锁）。指针事件一秒能来上百次，而绘制只需要最后那个位置；
 *      写 CSS 自定义属性不触发布局，但会触发样式重算，攒到帧尾一起做才叫便宜。
 * ▎没有 JS 也不坏：CSS 里 --mx/--my 有缺省值 50%，效果退化成"hover 时边框中央亮"。 */
function initTileSpotlight() {
  if (!videoGrid || typeof window.addEventListener !== 'function') return;
  let box = null; let rect = null; let queued = false; let next = null;
  const flush = () => {
    queued = false;
    if (!next || !box || !rect || !rect.width) { next = null; return; }
    const p = next; next = null;
    box.style.setProperty('--mx', (((p.x - rect.left) / rect.width) * 100).toFixed(1) + '%');
    box.style.setProperty('--my', (((p.y - rect.top) / rect.height) * 100).toFixed(1) + '%');
  };
  window.addEventListener('pointermove', (e) => {
    const el = e.target;
    const t = el && typeof el.closest === 'function' ? el.closest('.video-box') : null;
    if (!t) { box = null; rect = null; return; }
    if (t !== box) {
      box = t;
      try { rect = t.getBoundingClientRect(); } catch (err) { box = null; rect = null; return; }
    }
    next = { x: e.clientX, y: e.clientY };
    if (!queued) { queued = true; requestAnimationFrame(flush); }
  }, { passive: true });
}
try { initTileSpotlight(); } catch (e) { /* 装饰性效果：装不上就算了，绝不该影响会议 */ }

/* ══ 第 47 步：★ 2026-10-04 Esc 关掉"当前最上面那一层" ══
 * ▎为什么值得做：这套界面现在有九块浮层（自检报告 / 审计面板 / 两张授权卡 / 滤镜面板 /
 *   白板 / 字幕历史 / 设备码面板 / 手机侧栏抽屉），而**只有两张卡有 ✕ 按钮、白板有一个**。
 *   键盘用户点开一层就得用鼠标去找关闭的地方——这是"能看不能操作"的那类缺陷，
 *   截图上完全看不出来。
 * ▎三条设计决定：
 *   ① **按 z 序排一张表**，一次只关最上面那一层。全部一起关看起来更"利索"，
 *      但会把用户根本没打算关的东西一起带走（正开着白板画到一半，按 Esc 想收自检报告，
 *      结果白板也没了 = 一次误触丢一笔）。
 *   ② **授权卡上的 Esc = 拒绝，不是忽略**。"取消"在 consent 语义里必须是保守的那一侧，
 *      而且这里直接 `.click()` 复用按钮自己的处理函数——不复制一份逻辑，
 *      否则将来按钮改了行为，Esc 这条路会悄悄做旧的事（坑 47）。
 *   ③ 正在远程控制别人时**不插手**：那一层的 Esc 已经被"快捷释放控制权"占用了
 *      （第 14 步，2555 行），两个处理器抢同一个键会一次按出两件事。
 *   ▸ 输入法组合中同样不插手：Esc 在候选词框里是"取消候选"，不是"关面板"。 */
const ESC_LAYERS = [
  { id: 'accountPanel', name: '账号面板' },
  { id: 'capDiagBox', name: '字幕自检报告' },
  { id: 'auditPanel', name: '控制审计面板' },
  { id: 'remoteAskBox', name: '远程控制请求', deny: 'remoteDenyBtn' },
  { id: 'fileAskBox', name: '文件传输请求', deny: 'fileRejectBtn' },
  { id: 'fxPanel', name: '滤镜面板', fn: () => toggleFxPanel(false) },
  { id: 'boardOverlay', name: '白板', fn: () => setBoardOpen(false) },
  { id: 'filesOverlay', name: '共享文件', fn: () => setFilesOpen(false) },
  { id: 'capHistoryPanel', name: '字幕历史' },
  { id: 'deskOverlay', name: '设备码面板' },
  { id: 'invitePanel', name: '邀请面板' },
];
function layerIsUp(el) {
  if (!el || el.classList.contains('hidden')) return false;
  const cs = getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden';
}
function closeTopLayer() {
  if (document.querySelector('.ctrl-layer')) return null;   // ③ 控制模式里 Esc 另有其主
  for (const L of ESC_LAYERS) {
    const el = document.getElementById(L.id);
    if (!layerIsUp(el)) continue;
    if (L.deny) {                       // 授权卡：走按钮自己那条"拒绝"路径，不复制逻辑
      const b = document.getElementById(L.deny);
      if (b && typeof b.click === 'function') b.click();
      return L.name;
    }
    if (L.fn) L.fn();
    else el.classList.add('hidden');
    return L.name;
  }
  if (document.body.classList.contains('side-open')) { closeSideDrawer(); return '侧栏'; }
  return null;
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (typeof composing !== 'undefined' && composing) return;   // 组合输入中的 Esc 属于输入法
  const closed = closeTopLayer();
  if (closed) { e.preventDefault(); log('⌨ Esc 关闭了' + closed); }
});

/* 登录卡的两行输入框此前回车无反应（只有密码框会提交）——
   表单里"填完按回车"是肌肉记忆，缺一格就是"这表单是不是坏了"。 */
try {
  [['authUser', 'auth-login'], ['authName', 'auth-register']].forEach(([id, ev]) => {
    const el = document.getElementById(id);
    if (el && el.addEventListener) {
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth(ev); });
    }
  });
} catch (e) { /* 桩环境没有这两个元素就算了 */ }

/* ★ 2026-10-06 首屏就读一次 /config.json（第四个读取器，仍旧共用 applyServerConfig）。
 * ▎为什么值得加这一处：跨网入口有没有、AI 是 LLM 还是 Mock，这些都是**服务器的事实**，
 *   不是"进了房才知道"的东西。用户在登录卡那一屏就该看见顶栏怎么说——
 *   特别是"没有跨网入口"这件事，越早说越好（否则他建完房、喊朋友来才发现连不进来）。
 * ▎与坑 82 同一条纪律：同一份配置可以有多个读取器，但落地函数只有一个。
 *   拿不到就保持默认值，绝不影响任何功能（本机演示一直如此）。 */
fetch('/config.json', { cache: 'no-store' })
  .then((r) => (r.ok ? r.json() : null))
  .then((cfg) => { if (cfg) applyServerConfig(cfg); })
  .catch(() => { /* 读不到配置：用默认值继续，不弹错也不藏功能 */ });

/* ════════════════════════════════════════════════════════════════
 * 第 51 步：★ 2026-10-07 共享文件浏览（全房间同时看同一份文档）
 * ════════════════════════════════════════════════════════════════
 * ▎要解决什么（用户原话）："给创建房间后的功能模块增加共享文件浏览的功能，
 *   让在房间的所有用户能同时看到共享文件并操作，包含 PDF / Word / .md / PPT / Excel / 图片"。
 *   会议软件里这件事的真实痛点不是"能不能打开文件"，而是
 *   **"我们说的是同一页吗"**——所以这一步的重点是"同步"，不是"预览"。
 *
 * ▎三块分工（谁都不越界）：
 *   ① sfu/public/fileview.js —— 字节 → HTML 的**纯渲染内核**（自己读 ZIP、自己解 XML）。
 *      不碰 DOM、不发请求，所以能在 Node 里穷举单测（npm run test:fileview）。
 *   ② sfu/files.js（服务器）—— 存储与安全判据（路径穿越 / 谁能删 / 用什么 MIME 发）。
 *      能在 Node 里穷举单测（npm run test:files）。
 *   ③ **本步**——只管四件事：取字节、塞进容器、把"我在看哪儿"发出去、照别人发的改自己。
 *      渲染与存储的判据一行都不在这里重复（坑 47：一个概念一个来源）。
 *
 * ▎支持到什么程度（界面会如实说，不假装全能）：
 *   PDF → 浏览器内置阅读器（<iframe>）；图片 → <img>；
 *   Word/Excel/PPT(.docx/.xlsx/.pptx) → 内核自己解 OOXML 画出来（文字/标题/列表/表格/内嵌图/幻灯片版面）；
 *   Markdown/CSV/JSON/文本/代码 → 内核排版；
 *   旧版二进制 .doc/.xls/.ppt 与压缩包/音视频 → **明确说看不了 + 给下载**，不糊一片空白。
 *
 * ▎同步模型（这一步最容易设计错的地方）：
 *   "谁在看哪一份、第几页、滚到哪儿"是**房间级状态**，服务器存一份（room.fileView）并广播，
 *   晚进房的人靠 files-state 补发拿到当前值。三条刻意的取舍：
 *     ① 位置传**比例**（0~1）不传像素——每个人窗口高度不同，传像素"跟随"就滚过头；
 *     ② **有变化才广播** + 滚动在服务器侧按 120ms 节流（与 net-levels / talk-stats 同一条纪律），
 *        客户端再补一次"停下后收尾上报"，保证最终位置一定同步而中间帧可以丢；
 *     ③ 换文件/翻页是离散事件，**绕开节流**立刻发——那晚 120ms 就是"我点了没反应"。
 *   ▸ 回声防护：应用别人状态的那一小段时间里置 applyingRemote，滚动监听据此不发——
 *     否则 A 跟随 B → A 的滚动又广播给 B → B 的跟随再回来，两个客户端能把彼此推到死循环
 *     （与坑 66/68"清理动作的作用域比看起来更大"同族：同步环一定要有一处断环）。
 *
 * ▎"关闭面板 = 不再跟随"（一条规则，不设定时器）：
 *   自动弹开别人的面板是侵入性的；而用户手动关掉就是明确说"这块地方我不要看"。
 *   所以关面板顺手把跟随关掉（按钮文案同步变），重新打开面板时再把跟随打开——
 *   两件事由同一个动作触发，不需要"静默 60 秒不弹"那种谁都想不到的补丁。
 *
 * ▎安全（客户端这半，另一半在 sfu/files.js）：
 *   渲染只走内核一条路：**先转义再拼 HTML**，链接协议白名单；PDF/图片用 blob: URL
 *   而不是把服务器地址塞进 src/onerror；SVG 特别处理——它是 XML，能带 <script>，
 *   只当图片渲染（<img> 里的 SVG 不执行脚本），绝不 innerHTML。
 * ════════════════════════════════════════════════════════════════ */

/* ---- 元素（全部用 $()，与全站一致：桩环境能自动造出来，真浏览器缺 id 也只是拿到 null） ---- */
const filesBtn = $('filesBtn');
const filesOverlay = $('filesOverlay');
const filesListEl = $('filesList');
const filesStageEl = $('filesStage');
const filesWhoEl = $('filesWho');
const filesFollowBtn = $('filesFollowBtn');
const filesFollowTxt = $('filesFollowTxt');
const filesUploadBtn = $('filesUploadBtn');
const filesRefreshBtn = $('filesRefreshBtn');
const filesCloseBtn = $('filesCloseBtn');
const filesPickEl = $('filesPick');
const filesDropVeil = $('filesDropVeil');
const filesDocNameEl = $('filesDocName');
const filesDocKindEl = $('filesDocKind');
const filesPrevBtn = $('filesPrevBtn');
const filesNextBtn = $('filesNextBtn');
const filesPageInfoEl = $('filesPageInfo');
const filesZoomInBtn = $('filesZoomInBtn');
const filesZoomOutBtn = $('filesZoomOutBtn');
const filesZoomValEl = $('filesZoomVal');
const filesDlBtn = $('filesDlBtn');
const filesQuotaEl = $('filesQuota');

/* 类型图标：全站纪律是**单色线性 SVG**（09-19e 那次"去 AI 味"的收尾，彩色 emoji 会像贴纸）。
 * ▎为什么要按类型给不同图形而不是一个通用文件图标：列表里一眼认出"哪个是 PPT 哪个是 Excel"
 *   靠的就是形状差异，文字标签太小、在手机上还会被省略号截掉。 */
const FICONS = {
  pdf: svgIcon('<path d="M7 3.5h6l4.5 4.5V20.5H7z"/><path d="M13 3.5V8h4.5"/><path d="M10 17v-4h1.2a1.2 1.2 0 0 1 0 2.4H10"/><path d="M14.2 17v-4h1.6"/>'),
  doc: svgIcon('<path d="M7 3.5h6l4.5 4.5V20.5H7z"/><path d="M13 3.5V8h4.5"/><path d="M9.5 12.5h6.5M9.5 15.5h6.5M9.5 18h4"/>'),
  sheet: svgIcon('<path d="M7 3.5h6l4.5 4.5V20.5H7z"/><path d="M13 3.5V8h4.5"/><path d="M9.5 12h7.2M9.5 15h7.2M9.5 18h7.2M12 12v6.5M14.7 12v6.5"/>'),
  deck: svgIcon('<rect x="4.5" y="4" width="15" height="10" rx="1.5"/><path d="M12 14v5M9 20.5h6"/><path d="M8 10.5l2.5-2 2 1.8 3-2.6"/>'),
  md: svgIcon('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M6.5 15V9l3 3.2 3-3.2v6"/><path d="M16.5 9v5M14.6 12.6l1.9 2 1.9-2"/>'),
  csv: svgIcon('<rect x="4" y="5" width="16" height="14" rx="1.8"/><path d="M4 9.5h16M4 14h16M9.5 9.5V19M15 9.5V19"/>'),
  img: svgIcon('<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><circle cx="8.8" cy="10.3" r="1.4"/><path d="M5 16.5l4.2-3.8 3.2 2.8 3-2.4 4 3.4"/>'),
  text: svgIcon('<path d="M7 3.5h6l4.5 4.5V20.5H7z"/><path d="M13 3.5V8h4.5"/><path d="M9.5 12.5h6.5M9.5 15.5h5"/>'),
  other: svgIcon('<path d="M7 3.5h6l4.5 4.5V20.5H7z"/><path d="M13 3.5V8h4.5"/>'),
  dl: svgIcon('<path d="M12 4.5v11M8 11.5l4 4 4-4"/><path d="M5 19.5h14"/>'),
  trash: svgIcon('<path d="M5 7.5h14M9.5 7.5V5.5h5v2M7 7.5l1 12.5h8l1-12.5"/><path d="M10.5 11v6M13.5 11v6"/>'),
};
function fileIconOf(kind) {
  return FICONS[kind] || FICONS.other;
}

/* ---- 状态（全部集中在这里，别散到各回调里去——散出去就一定会漂移，坑 47） ---- */
let filesOn = false;                 // 面板开没开
let filesData = [];                  // 服务器给的清单（唯一来源：files-updated / files-state / HTTP 列表）
let filesLimits = null;              // 配额（服务器给，不在前端硬写）
let filesFollow = true;              // 跟随主讲
let filesView = null;                // 房间当前视角（谁在看什么）
let filesOpen = null;                // 我这里打开的：{ name, kind, page, zoom, blobUrl, total }
let filesBusyToken = 0;              // 打开文件的竞态令牌（后点的赢，先到的作废）
let applyingRemote = false;          // ★ 断环开关：正在照别人的状态改自己 → 不要再广播
let filesScrollTimer = 0;            // 滚动节流句柄
let filesSettleTimer = 0;            // "停下后补一次"的句柄
let filesUploading = [];             // 正在上传的 { name, pct, err }（列表顶部那几条进度行）

/* 昵称兜底：登录用户有昵称，游客没有——服务器那边也是这个口径（socket.displayName || '某位成员'）。 */
function myName4Files() { return myDisplayName || '我'; }

/* 属性上下文必须**连引号一起**转义。
 * ▎escapeHtml（第 1248 行）只处理 & < >，那是给"文本节点"用的正确范围。
 *   而 `data-name="${…}"` 是属性——名字里只要有一个裸引号就能把属性劈开、
 *   接上一个新属性（`" onmouseover="…`）。
 * ▎服务器 sanitizeName 确实已经把引号换成下划线了，但"上游会消毒"不是这一格不转义的理由：
 *   消毒规则改一次，这里就静默变成一个 XSS 入口（纵深防御：每一层守自己那一格）。
 * ▎这不是"同一概念两处实现"（坑 47）——**文本转义与属性转义是两个概念**，
 *   把它们合并成一个函数才会出错（那个函数要么过度转义文本、要么漏转属性）。 */
function fileAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 类型判定走内核那一份实现（判据不重抄）。
 *  ▎FV 万一没加载（缓存/半截部署）时退到最小表：面板至少能列文件、能给下载按钮，
 *    而不是整块 JS 报错把白屏留给用户。这个降级只影响"能不能预览"，不影响功能主干。 */
function fileTypeOf(name) {
  if (typeof FV !== 'undefined' && FV && typeof FV.kindOf === 'function') return FV.kindOf(name);
  const ext = String(name).split('.').pop().toLowerCase();
  return ({ pdf: 'pdf', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image',
    svg: 'svg', md: 'markdown', markdown: 'markdown', txt: 'text', log: 'text', csv: 'csv', tsv: 'csv',
    json: 'json', docx: 'docx', xlsx: 'xlsx', pptx: 'pptx', doc: 'legacy', xls: 'legacy', ppt: 'legacy' })[ext] || 'other';
}
function fileTypeCn(kind) {
  if (typeof FV !== 'undefined' && FV && typeof FV.kindCn === 'function') return FV.kindCn(kind);
  return kind;
}

/* ---- URL 形状 ----
 * ▎这里**故意**不 require 服务器那份 fileUrl()：浏览器拿不到 CommonJS 模块，
 *   两处各写一份字符串形状是跨运行时的必然（同 WAKE_RE 那张表的处理办法）。
 *   漂移的代价是"下载 404"——一眼就能发现，所以用一条冒烟断言钉住两头一致。 */
/* 取令牌的请求头复用第 505 行那一份 roomTokenHeader()（三处 captions 请求也在用），不另写一遍 */
function filesApiUrl(room) { return `/api/files?room=${encodeURIComponent(String(room || ''))}`; }
function fileBlobUrl(room, name) { return `/files/${encodeURIComponent(String(room || ''))}/${encodeURIComponent(String(name || ''))}`; }

/** 时间说人话（列表里那一行小字）：同一天只给时分，跨天给月日。 */
function fileTimeCn(ts) {
  const t = Number(ts);
  if (!isFinite(t) || t <= 0) return '时间未知';
  const d = new Date(t);
  const sameDay = new Date().toDateString() === d.toDateString();
  const hm = d.toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5);
  return sameDay ? hm : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

/* ─────────────── 面板开合 ─────────────── */
function setFilesOpen(on, opts) {
  const o = opts || {};
  if (filesOn === on) return;
  filesOn = on;
  if (filesOverlay) filesOverlay.classList.toggle('hidden', !on);
  if (filesBtn) filesBtn.classList.toggle('active', on);
  if (on) {
    /* 与白板互斥：两块都是"接管舞台"的覆盖层，同时开着只会互相压住——
     * 从一个直接切到另一个，比"叠在一起然后谁也点不到"好（坑 80 那次就是这么坏的）。 */
    if (!o.keepBoard && typeof boardOn !== 'undefined' && boardOn) {
      try { setBoardOpen(false); } catch (e) { /* 白板没初始化成功就算了 */ }
    }
    if (!o.silentFollow) setFilesFollow(true);   // 打开面板 = 我要跟大家一起看
    if (!filesData.length) fetchFilesList();      // 清单可能还没到过（面板先于 files-state 打开）
  } else {
    setFilesFollow(false);                        // 关掉面板 = 不再跟随（见文件头那条规则）
    stopFilePreview();                            // blob: URL 必须撤销，长跑会议里它不清理就是泄漏
  }
  renderFilesWho();
}

function setFilesFollow(on) {
  filesFollow = !!on;
  if (filesFollowBtn) filesFollowBtn.classList.toggle('active', filesFollow);
  /* ★ 只写那个**内层 span**，不写按钮本身：按钮里还有图标子节点，
   *   `btn.textContent = …` 会把图标一起抹掉（坑 77 的原话）。 */
  if (filesFollowTxt) filesFollowTxt.textContent = filesFollow ? '跟随主讲' : '自由浏览';
  try { localStorage.setItem('sfu-files-follow', filesFollow ? '1' : '0'); } catch (e) { /* 无痕模式 */ }
  renderFilesWho();
}

/* ─────────────── 列表渲染 ─────────────── */
function renderFilesList() {
  if (!filesListEl) return;
  const rows = [];
  /* 上传中的进度行排在最前：用户点完「上传」要**立刻**看到东西在动，
     而不是等全部传完才一次性刷出来（1MB/s 的机器上传一个 20MB 的 PPT 要二十秒）。 */
  for (const u of filesUploading) {
    rows.push(`<div class="file-up">
      <span class="file-up-n">${escapeHtml(u.name)}</span>
      <span class="file-up-p">${u.err ? '失败' : (u.pct >= 100 ? '服务器在收…' : u.pct + '%')}</span>
      <span class="file-up-bar"><i style="width:${Math.max(2, Math.min(100, u.pct))}%"></i></span>
    </div>`);
  }
  if (!filesData.length && !filesUploading.length) {
    /* 空态要教用户下一步做什么，而不是写一句"暂无数据"（坑 82：界面要说实话）。 */
    filesListEl.innerHTML = '<div class="files-emptyrow">这场会还没有文件。<br>点上面「上传」，或把文件拖进来。</div>';
    renderFilesQuota();
    return;
  }
  for (const f of filesData) {
    const kind = fileTypeOf(f.name);
    const active = filesOpen && filesOpen.name === f.name;
    const mine = !!f.byId && f.byId === socket.id;
    const canDel = mine || isOwnerOrAdmin();
    rows.push(`<div class="file-row${active ? ' active' : ''}" data-name="${fileAttr(f.name)}" role="button" tabindex="0"
        title="${fileAttr(f.name)} · ${fileAttr(fmtFileSize(f.size))} · ${fileAttr(f.byName || '未知上传者')} ${fileAttr(fileTimeCn(f.ts))}">
      <span class="file-ico">${fileIconOf(kind)}</span>
      <span class="file-col">
        <span class="file-name">${escapeHtml(f.name)}</span>
        <span class="file-meta">${escapeHtml(fmtFileSize(f.size))} · ${escapeHtml(f.byName || '未知')}${mine ? ' · 我' : ''}</span>
      </span>
      <span class="file-acts">
        <button class="file-act" data-act="dl" title="下载原文件" aria-label="下载 ${fileAttr(f.name)}">${FICONS.dl}</button>
        ${canDel ? `<button class="file-act del" data-act="del" title="删除这个共享文件" aria-label="删除 ${fileAttr(f.name)}">${FICONS.trash}</button>` : ''}
      </span>
    </div>`);
  }
  filesListEl.innerHTML = rows.join('');
  renderFilesQuota();
}

/* 大小交给内核算（fmtSize 只有一处实现），拿不到内核时用等价兜底。 */
function fmtFileSize(n) {
  if (typeof FV !== 'undefined' && FV && typeof FV.fmtSize === 'function') return FV.fmtSize(n);
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1048576) return `${(v / 1024).toFixed(0)} KB`;
  return `${(v / 1048576).toFixed(1)} MB`;
}

function isOwnerOrAdmin() {
  /* 口径与 D4 踢人按钮**完全一致**（4736 行那句 me.owner || me.role === 'admin'）：
   *   从 room-state 的权威快照里找我自己那一行，而不是另起一套"我猜我是房主"的判断。
   * ▎前端只是**入口**——真正的拒绝在服务器 files-delete 里（前端算错顶多多显示一个按钮，
   *   服务器算错才是权限漏洞）。 */
  const list = (typeof lastMembers !== 'undefined' && Array.isArray(lastMembers)) ? lastMembers : [];
  const me = list.find((m) => m && m.id === socket.id) || null;
  return !!(me && (me.owner || me.role === 'admin'));
}

function renderFilesQuota() {
  if (!filesQuotaEl) return;
  const used = filesData.reduce((a, f) => a + (Number(f.size) || 0), 0);
  if (!filesLimits) { filesQuotaEl.textContent = ''; return; }
  const L = filesLimits;
  const near = (L.maxRoomBytes && used / L.maxRoomBytes > 0.8)
    || (L.maxCount && filesData.length / L.maxCount > 0.8);
  filesQuotaEl.classList.toggle('warn', !!near);
  filesQuotaEl.textContent =
    `已用 ${fmtFileSize(used)} / ${fmtFileSize(L.maxRoomBytes || 0)} · ${filesData.length}/${L.maxCount || 0} 个 · 单文件上限 ${fmtFileSize(L.maxFileBytes || 0)}`;
}

/** 顶部那颗"谁在带大家看"的小徽标：把"同步这件事现在归谁"摆出来，
 *  而不是让它默默发生在背后（用户看不见就会以为功能坏了，坑 76 的界面版）。 */
function renderFilesWho() {
  if (!filesWhoEl) return;
  if (!filesView || !filesView.name) { filesWhoEl.classList.add('hidden'); return; }
  filesWhoEl.classList.remove('hidden');
  const me = filesView.byId === socket.id;
  filesWhoEl.classList.toggle('is-me', me);
  const base = me ? '你在带着大家看' : `跟着 ${(filesView.byName || '某位成员')}`;
  filesWhoEl.textContent = filesFollow || me
    ? base
    : `${base} · 你已退出跟随`;
}

/* ─────────────── 取清单 / 上传 / 删除 ─────────────── */
async function fetchFilesList() {
  if (!myRoom) return;
  try {
    const r = await fetch(filesApiUrl(myRoom), { headers: roomTokenHeader(), cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    filesData = Array.isArray(j.files) ? j.files : [];
    if (j.limits) filesLimits = j.limits;
    if (j.view) { filesView = j.view; }
    renderFilesList();
    renderFilesWho();
  } catch (e) {
    /* 拉清单失败不弹错误框（弹窗会阻塞主线程，坑 69 那条事故就是被 alert 循环卡死的），
     * 只在列表里留一句可行动的话 + 一条日志。 */
    if (filesListEl) filesListEl.innerHTML = `<div class="files-emptyrow">清单没拉到：${escapeHtml(String(e.message || e))}<br>点上面「刷新」再试一次。</div>`;
    log(`📁 共享文件清单拉取失败：${e.message || e}`);
  }
}

/** 一个文件的上传（用 XHR 而不是 fetch：fetch 至今报不了上传进度，
 *  而"传了 20 秒界面一动不动"是这类功能最难看的失败形态）。 */
function uploadOne(file, rec) {
  return new Promise((resolve, reject) => {
    if (!myRoom || !myRoomToken) { reject(new Error('不在会议里或没拿到房间令牌')); return; }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', filesApiUrl(myRoom), true);
    xhr.setRequestHeader('X-Room-Token', myRoomToken);
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.setRequestHeader('X-Uploader-Name', encodeURIComponent(myName4Files()));
    xhr.setRequestHeader('X-Uploader-Id', socket.id || '');
    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      rec.pct = Math.round((ev.loaded / ev.total) * 100);
      renderFilesList();
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { resolve(xhr.responseText); return; }
      let msg = `HTTP ${xhr.status}`;
      try { msg = (JSON.parse(xhr.responseText) || {}).error || msg; } catch (e) { /* 不是 JSON 就留着状态码 */ }
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error('网络中断'));
    xhr.ontimeout = () => reject(new Error('上传超时'));
    xhr.onabort = () => reject(new Error('上传已取消'));
    xhr.send(file);
  });
}

async function uploadFiles(list) {
  const files = Array.from(list || []);
  if (!files.length) return;
  if (!myRoom) { showToast('先进入会议才能上传共享文件', 'error'); return; }
  /* 排队一个一个传（不是并发）：并发会把进度条变成一团糊——用户看不出"传到哪一个了"，
     而且服务器那边的房间配额是按顺序判的，并发更容易撞上"空间不够"这种难解释的错。 */
  for (const f of files) {
    const rec = { name: f.name, pct: 0, err: null };
    filesUploading.push(rec);
    renderFilesList();
    try {
      await uploadOne(f, rec);
      rec.pct = 100;
      showToast(`已共享「${f.name}」`, 'ok');
    } catch (e) {
      rec.err = String(e.message || e);
      /* 失败必须**留在界面上**并说清原因（超配额？名字不行？房间没了？）：
       * 一个会消失的 toast 等于没告诉用户为什么。 */
      showToast(`「${f.name}」上传失败：${rec.err}`, 'error');
      log(`📁 上传失败「${f.name}」：${rec.err}`);
    }
    filesUploading.splice(filesUploading.indexOf(rec), 1);
    renderFilesList();
  }
  // 成功的那几个由服务器广播带回来；这里再拉一次保证"失败的那几个不会骗我以为传上了"
  await fetchFilesList();
}

function requestDelete(name) {
  if (!myRoom) return;
  socket.emit('files-delete', { name }, (resp) => {
    if (resp && resp.data && resp.data.ok) showToast(`已删除「${name}」`, 'ok');
    else showToast(`删不掉：${(resp && resp.error) || '未知原因'}`, 'error');
  });
}

/* ─────────────── 打开与渲染 ─────────────── */
/** 撤销上一个 blob: URL。
 *  ▎为什么手动 revoke：blob URL 会一直占着那块内存直到页面卸载。
 *    开一场会翻十几份大 PPT 就是几十 MB 挂着不走——"会议软件越用越卡"最常见的成因之一。 */
function stopFilePreview() {
  if (filesOpen && filesOpen.blobUrl) {
    try { URL.revokeObjectURL(filesOpen.blobUrl); } catch (e) { /* 有些环境没有 URL */ }
  }
  filesOpen = null;
  if (filesStageEl) {
    filesStageEl.innerHTML = '<div class="files-empty"><p class="files-empty-t">还没有打开文件</p>'
      + '<p class="files-empty-d">从左边选一份，或点「上传」把材料放进来。</p></div>';
  }
  if (filesDocNameEl) filesDocNameEl.textContent = '还没有打开文件';
  if (filesDocKindEl) filesDocKindEl.classList.add('hidden');
  setFilesToolbar(false);
}

function setFilesToolbar(hasDoc) {
  const kind = hasDoc && filesOpen ? filesOpen.kind : '';
  const paged = kind === 'pdf';
  const zoomable = ['image', 'svg', 'markdown', 'text', 'code', 'json', 'docx', 'xlsx', 'pptx'].indexOf(kind) >= 0;
  [filesPrevBtn, filesNextBtn, filesPageInfoEl].forEach((el) => el && el.classList.toggle('hidden', !paged));
  [filesZoomInBtn, filesZoomOutBtn, filesZoomValEl].forEach((el) => el && el.classList.toggle('hidden', !zoomable));
  if (filesDlBtn) filesDlBtn.classList.toggle('hidden', !hasDoc);
  if (hasDoc) updatePageInfo();
}

function updatePageInfo() {
  if (!filesPageInfoEl || !filesOpen) return;
  filesPageInfoEl.textContent = filesOpen.page ? `第 ${filesOpen.page} 页` : '';
}

function showStageBusy(txt) {
  if (filesStageEl) filesStageEl.innerHTML = `<div class="files-busy"><span class="files-spin"></span>${escapeHtml(txt)}</div>`;
}

/** 打开一份文件。opts 里的 page/scroll/zoom 是"远端要求我到的位置"。 */
async function openFileByName(name, opts) {
  const o = opts || {};
  if (!myRoom || !myRoomToken) { showToast('先进入会议才能看共享文件', 'error'); return; }
  const entry = filesData.find((f) => f.name === name);
  if (!entry) { showToast(`清单里已经没有「${name}」了（可能被删掉了）`, 'error'); return; }
  const kind = fileTypeOf(name);
  const token = ++filesBusyToken;            // 竞态令牌：连点两份时，先回来的那一份要作废
  showStageBusy(`正在打开「${name}」…`);
  if (filesDocNameEl) filesDocNameEl.textContent = name;
  if (filesDocKindEl) {
    filesDocKindEl.textContent = fileTypeCn(kind);
    filesDocKindEl.classList.remove('hidden');
  }
  stopFilePreviewKeepName();                 // 只撤销旧 blob，不清界面（上面刚写好"正在打开"）
  filesOpen = { name, kind, page: Number(o.page) || 1, zoom: Number(o.zoom) || 1, blobUrl: null };
  setFilesToolbar(true);
  applyZoom();
  try {
    const r = await fetch(fileBlobUrl(myRoom, name), { headers: roomTokenHeader(), cache: 'no-store' });
    if (!r.ok) throw new Error(r.status === 404 ? '这份文件已经不在了' : `服务器返回 ${r.status}`);
    const blob = await r.blob();
    if (token !== filesBusyToken) return;    // 已经有更新的打开动作在跑了
    const blobUrl = URL.createObjectURL(blob);
    filesOpen.blobUrl = blobUrl;
    if (kind === 'pdf') { renderPdf(blobUrl); return; }
    if (kind === 'image' || kind === 'svg') { renderImage(blobUrl, name); return; }
    /* 文档类：取字节交给内核。
     * ▎为什么不直接 iframe 那个下载链接？服务器给的 disposition 是 attachment（安全那条），
     *   而且 .docx 本来就没有原生阅读器——必须自己解，这正是 fileview.js 存在的理由。 */
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (token !== filesBusyToken) return;
    if (typeof FV === 'undefined' || !FV || typeof FV.render !== 'function') {
      filesStageEl.innerHTML = '<div class="fv-unsupported"><p class="fv-unsupported-t">渲染内核没加载上</p>'
        + '<p class="fv-unsupported-d">多半是这份页面还是旧版（Service Worker 缓存）。请硬刷新一次（Ctrl+F5）或在地址后加 ?nosw=1 打开。</p></div>';
      return;
    }
    const out = await FV.render(name, bytes, { blobUrl, kind });
    if (token !== filesBusyToken) return;
    filesStageEl.innerHTML = `<div class="fv-doc">${out.html}</div>`;
    if (o.scroll) applyScrollRatio(o.scroll);
  } catch (e) {
    if (token !== filesBusyToken) return;
    /* 内核的报错本来就是给人看的中文（"这个 .docx 里没有 word/document.xml"），
     * 直接摊开——把真实原因藏进"打开失败"这种四字里，用户只能猜。 */
    filesStageEl.innerHTML = `<div class="fv-unsupported"><p class="fv-unsupported-t">这份文件打不开</p>`
      + `<p class="fv-unsupported-d">${escapeHtml(String(e.message || e))}</p>`
      + `<p class="fv-unsupported-h">可以点右上角「下载」用本机的软件打开。</p></div>`;
    log(`📁 打开「${name}」失败：${e.message || e}`);
  }
}
/** ★「我以主讲身份打开这一份」的唯一入口 = 打开 + 把视角播给全房间。
 * ▎为什么要单独有这个名字：`openFileByName()` 只做"我屏幕上出现它"，
 *   "让别人也看到我在看它"是**第二个动作**，原先写在两个调用点后面（列表点击 / 回车键）。
 *   多一个入口就多一次"记得写两行"的纪律——而纪律会被忘掉（坑 40 的原始教训），
 *   忘了的症状还不是报错，是**别人屏幕上静默不跟**（正是用户会报的那种"不同步"）。
 *   ▸ 所以：用户主动打开一律走这里；`applyRemoteView()` 里跟着别人看时走裸函数
 *     （否则跟随者会把自己的位置广播回去，把"谁在带"抢走——那条断环由 applyingRemote 守）。
 *   冒烟里有一条**结构红线**盯这件事：除了定义处与 applyRemoteView，不许再有裸调用点。 */
function openFileAsMine(name) {
  openFileByName(name);
  emitFileView(true);
}

function stopFilePreviewKeepName() {
  if (filesOpen && filesOpen.blobUrl) {
    try { URL.revokeObjectURL(filesOpen.blobUrl); } catch (e) { /* ignore */ }
  }
}

function renderPdf(blobUrl) {
  filesStageEl.innerHTML = '';
  mountPdf(blobUrl, filesOpen.page || 1);
}

/* ★ 2026-10-08 实测修正：**PDF 换页必须重建 iframe，只改 src 的片段不动。**
 * ▎量出来的：第 1 页（夹具里画了一块黑）暗像素 58.9%；点「下一页」把 src 从
 *   `blob:…#page=1` 改成 `blob:…#page=2` 之后**仍然是 58.9%，一字不差**；
 *   而把这个 iframe 拆掉重建，1.5 秒后读到 7.1%（第 2 页是白的）——黑块真的没了。
 * ▎为什么：blob URL 相同 ⇒ 浏览器把这次赋值当成"同一文档内的片段跳转"，
 *   而内置 PDF 插件不响应这种跳转（它只在**加载文档**时读 `#page=`）。
 *   于是翻页按钮**从上线起就没真的翻过页**，而界面看起来完全正常：
 *   页码标签在变、src 在变、不报任何错——坑 76"机制在但从未生效"的第 N 例，
 *   也是这一档为什么要给 PDF 补一条**像素**断言（I1）。
 * ▎代价说清楚：重建 = 阅读器重新初始化（实测约 1.5s 出下一帧），
 *   同一个 blob: URL 不发网络请求，所以只是插件冷启动，不重传文件。 */
function mountPdf(url, page) {
  const want = FV.pdfSrc(url, page);            // 片段拼法只在内核有一处（坑 47）
  if (!want || !filesStageEl) return null;
  const old = filesStageEl.querySelector('iframe.files-pdf');
  if (old && old.getAttribute('src') === want) return old;   // 同一页别重建（重建会让阅读器闪一下）
  if (old && typeof old.remove === 'function') old.remove();   // 真 DOM 与冒烟桩都支持 remove()
  const fr = document.createElement('iframe');
  fr.className = 'files-pdf';
  fr.setAttribute('title', 'PDF 阅读器');
  fr.setAttribute('src', want);
  filesStageEl.appendChild(fr);
  return fr;
}

function renderImage(blobUrl, name) {
  filesStageEl.innerHTML = `<div class="fv-imgwrap"><img alt="${fileAttr(name)}"></div>`;
  const img = filesStageEl.querySelector('img');
  if (img) img.src = blobUrl;
  applyZoom();
}

function applyZoom() {
  if (!filesOpen || !filesStageEl) return;
  filesStageEl.style.setProperty('--fv-zoom', String(filesOpen.zoom));
  if (filesZoomValEl) filesZoomValEl.textContent = `${Math.round(filesOpen.zoom * 100)}%`;
}

function setZoom(z) {
  if (!filesOpen) return;
  filesOpen.zoom = Math.max(0.4, Math.min(4, Number(z) || 1));
  applyZoom();
  emitFileView();
}

function setPage(p) {
  if (!filesOpen) return;
  filesOpen.page = Math.max(1, Math.min(9999, parseInt(p, 10) || 1));
  updatePageInfo();
  /* PDF 换页只能靠重设 iframe 的 src（内置阅读器在另一个源里，我们读不到它的滚动位置）。
   * 这是一条**诚实的边界**：所以翻页用工具条按钮明确地做，而不是假装能监听用户在 PDF 里的滚动。 */
  if (filesOpen.kind === 'pdf' && filesOpen.blobUrl) mountPdf(filesOpen.blobUrl, filesOpen.page);
  emitFileView(true);
}

/** 按比例还原滚动（0~1）。用比例不用像素：见文件头那条取舍。 */
function applyScrollRatio(ratio) {
  if (!filesStageEl) return;
  const max = filesStageEl.scrollHeight - filesStageEl.clientHeight;
  if (!(max > 0)) return;
  applyingRemote = true;
  filesStageEl.scrollTop = Math.round(Math.max(0, Math.min(1, Number(ratio) || 0)) * max);
  // 等这一帧的布局与滚动事件都过去再放开闸（同步置 false 会让这次滚动自己触发一次广播）
  setTimeout(() => { applyingRemote = false; }, 260);
}

/* ─────────────── 同步：我要说的 / 我照别人做的 ─────────────── */
const FILES_VIEW_THROTTLE_MS = 150;   // 滚动上报的节流（服务器那边还会再节流一次）
const FILES_VIEW_SETTLE_MS = 220;     // 滚动停下后补一次收尾，保证"最终位置"一定同步

function currentViewPayload() {
  if (!filesOpen) return { name: null };
  const max = filesStageEl ? (filesStageEl.scrollHeight - filesStageEl.clientHeight) : 0;
  const ratio = max > 0 ? Math.max(0, Math.min(1, filesStageEl.scrollTop / max)) : 0;
  return { name: filesOpen.name, page: filesOpen.page || 1, scroll: Number(ratio.toFixed(4)), zoom: filesOpen.zoom || 1 };
}

/** 把我的视角发出去（immediate=true 用于离散动作：换文件/翻页）。
 *  ▸ ★ 前置守卫「**不跟随就不往外发**」：这颗开关的语义是"我与大家的画面解耦"，
 *    而解耦必须是**双向**的——只挡"别人→我"（applyRemoteView 里那条 return）而不挡
 *    "我→别人"，就会造出真机实测到的这一幕：B 关掉跟随只想自己翻一翻，一翻页
 *    **全房被 B 拽走**，而 B 屏幕上什么都没说出来（A 侧徽标变成"跟着 某位成员"）。
 *    ▎用户说"我只想看自己那份"时，**只能他这一边动**（做错方向比少做更糟）。
 *    主讲权因此只有一条交接路径：**跟着大家的人主动做动作**（打开/翻页/滚动）——
 *    即"最后动的人赢"仍然成立，只是"动"的前提是他此刻在同步环里。 */
function emitFileView(immediate) {
  if (!myRoom || applyingRemote) return;                 // ★ 断环：照别人做的时候不再往外发
  if (!filesFollow) return;                              // ★ 自由浏览 = 完全局部，不夺主讲（见上面那段）
  const payload = currentViewPayload();
  if (immediate) {
    clearTimeout(filesScrollTimer); filesScrollTimer = 0;
    socket.emit('files-view', payload);
    return;
  }
  if (filesScrollTimer) return;                          // 节流窗口里已经排了一次
  filesScrollTimer = setTimeout(() => {
    filesScrollTimer = 0;
    socket.emit('files-view', currentViewPayload());
  }, FILES_VIEW_THROTTLE_MS);
}

/** 收到房间视角：不是我自己发的、而且我开了跟随，才照做。 */
function applyRemoteView(view) {
  filesView = view || null;
  renderFilesWho();
  renderFilesList();
  if (!view || !view.name) {
    /* 主讲把文件关掉了：我这边**不清屏**——跟随的是"他在看什么"，
     * 他关面板不代表要把我眼前那份也抽走（那会让人觉得是自己网断了）。 */
    return;
  }
  if (view.byId === socket.id) return;                   // 我自己发的，不回环
  if (!filesFollow) return;
  if (!filesOn) { setFilesOpen(true, { silentFollow: true }); }   // 跟随开着 = 同意被带着看，自动起面板
  applyingRemote = true;
  const same = filesOpen && filesOpen.name === view.name;
  const wantPage = Number(view.page) || 1;
  if (!same) {
    openFileByName(view.name, { page: wantPage, scroll: view.scroll, zoom: view.zoom });
  } else {
    if (filesOpen.kind === 'pdf' && wantPage !== filesOpen.page) setPageQuiet(wantPage);
    if (Number(view.zoom) && view.zoom !== filesOpen.zoom) { filesOpen.zoom = view.zoom; applyZoom(); }
    applyScrollRatio(view.scroll);
  }
  setTimeout(() => { applyingRemote = false; }, 400);
}

/** ★「回到主讲」的唯一入口：重新打开跟随时，**我跳去主讲那一份**，而不是把大家拽过来。
 *  ▎为什么这颗按钮原来写的是 `emitFileView(true)`，方向恰好反了：用户点"跟随主讲"的理由是
 *  ▎"我想跟大家看一样的东西"，而那行代码干的事是"我宣布接下来由我带大家看"。
 *  ▎真机实测（check:files 的 S 组）：B 点这一下之后 A 的屏幕被换掉，
 *  ▎  A 的徽标变成"跟着 某位成员"——而 B 那边什么都没发生（他以为自己在跟）。
 *  ▸ 复用 applyRemoteView() 这一条正路：面板没开要开、同一份只调页码与滚动、
 *    主讲把文件关了就别把我的屏一起抽走——这些边界它已经处理过了，不写第二份（坑 47）。
 *  ▸ 本地从没见过视角（filesView 为空）就去问一次权威副本（清单应答里带着 view）再跟，
 *    **不猜**"没人带"（坑 67：读不到 ≠ 读到空）。 */
function rejoinPresenterView() {
  if (!filesFollow) return;
  if (filesView && filesView.name) { applyRemoteView(filesView); return; }
  Promise.resolve(fetchFilesList()).then(() => {
    if (filesFollow && filesView && filesView.name) applyRemoteView(filesView);
  });
}

/** 应用远端页码时**不再往外广播**（否则会回声给发起人）。 */
function setPageQuiet(p) {
  filesOpen.page = Math.max(1, Math.min(9999, parseInt(p, 10) || 1));
  updatePageInfo();
  // 同 setPage：换页 = 重新挂载；只改片段的话内置阅读器根本不动（实测见 mountPdf 的注释）
  if (filesOpen.kind === 'pdf' && filesOpen.blobUrl) mountPdf(filesOpen.blobUrl, filesOpen.page);
}

/* ─────────────── 服务器消息 ─────────────── */
socket.on('files-state', (msg = {}) => {
  /* 进房补发：清单 + 当前视角 + 配额。晚到的人不必自己去拉（他也可能不是主动点面板才进来的）。 */
  if (Array.isArray(msg.files)) filesData = msg.files;
  if (msg.limits) filesLimits = msg.limits;
  if (msg.view !== undefined) filesView = msg.view || null;
  renderFilesList();
  renderFilesWho();
  /* 我在跟随、而且别人正在看一份——把那份也带起来。
     刻意不在这里抢：晚到的人先看到会场，愿意跟再跟（刚进房就被弹一个全屏文档是很莽的）。 */
});

socket.on('files-updated', (msg = {}) => {
  if (Array.isArray(msg.files)) filesData = msg.files;
  renderFilesList();
  /* 我正在看的这一份被删了：明说，而不是留一片"加载失败"。 */
  if (filesOpen && msg.name === filesOpen.name && msg.change === 'remove') {
    showToast(`「${filesOpen.name}」已被删除`, 'error');
    stopFilePreview();
  }
});

socket.on('files-view-state', (msg = {}) => { applyRemoteView(msg && msg.view); });

/* ─────────────── 交互接线 ─────────────── */
if (filesBtn) {
  filesBtn.addEventListener('click', () => {
    if (!myRoom) { showToast('先进入会议再共享文件', 'error'); return; }
    setFilesOpen(!filesOn);
  });
}
if (filesCloseBtn) filesCloseBtn.addEventListener('click', () => setFilesOpen(false));
if (filesFollowBtn) filesFollowBtn.addEventListener('click', () => {
  const next = !filesFollow;
  setFilesFollow(next);
  /* ★ 打开跟随 = **我跳回主讲那一份**；这里绝不许再调 emitFileView()——
   *   那颗按钮原先写的就是它，于是"我跟上去"变成了"我抢主讲"（实测见 rejoinPresenterView 的注释）。
   *   冒烟有一条结构红线盯这个处理器里不许出现 emitFileView(。 */
  if (next) rejoinPresenterView();
});
if (filesUploadBtn) filesUploadBtn.addEventListener('click', () => { if (filesPickEl) filesPickEl.click(); });
if (filesRefreshBtn) filesRefreshBtn.addEventListener('click', () => fetchFilesList());
if (filesPickEl) filesPickEl.addEventListener('change', () => {
  const fl = filesPickEl.files;
  if (fl && fl.length) uploadFiles(fl);
  filesPickEl.value = '';        // 同一个文件再选一次也要能触发 change（不重置就会"点了没反应"）
});

/* 列表的点击：一次委托（不给每一行单独挂监听——列表要反复重画，逐个挂会变成"每画一次加一套"） */
if (filesListEl) {
  filesListEl.addEventListener('click', (ev) => {
    const t = ev.target;
    const btn = t && t.closest ? t.closest('.file-act') : null;
    const row = t && t.closest ? t.closest('.file-row') : null;
    if (!row) return;
    const name = row.getAttribute && row.getAttribute('data-name');
    if (!name) return;
    if (btn) {
      const act = btn.getAttribute && btn.getAttribute('data-act');
      if (act === 'del') requestDelete(name);
      else if (act === 'dl') downloadFile(name);
      ev.stopPropagation();
      return;
    }
    openFileAsMine(name);   // ★ 唯一入口：打开 + 广播（漏一半的症状是"别人屏幕上静默不跟"）
  });
  filesListEl.addEventListener('keydown', (ev) => {
    if (!ev || (ev.key !== 'Enter' && ev.key !== ' ')) return;
    const row = ev.target && ev.target.closest ? ev.target.closest('.file-row') : null;
    if (!row) return;
    const name = row.getAttribute && row.getAttribute('data-name');
    if (!name) return;
    ev.preventDefault();
    openFileAsMine(name);
  });
}

if (filesPrevBtn) filesPrevBtn.addEventListener('click', () => setPage((filesOpen && filesOpen.page || 1) - 1));
if (filesNextBtn) filesNextBtn.addEventListener('click', () => setPage((filesOpen && filesOpen.page || 1) + 1));
if (filesZoomInBtn) filesZoomInBtn.addEventListener('click', () => setZoom((filesOpen && filesOpen.zoom || 1) + 0.2));
if (filesZoomOutBtn) filesZoomOutBtn.addEventListener('click', () => setZoom((filesOpen && filesOpen.zoom || 1) - 0.2));
if (filesDlBtn) filesDlBtn.addEventListener('click', () => { if (filesOpen) downloadFile(filesOpen.name); });

/* 滚动同步：节流 + 收尾各一次（只有文档/图片这一路量得到滚动，PDF 那一路读不到插件内部） */
if (filesStageEl) {
  filesStageEl.addEventListener('scroll', () => {
    if (applyingRemote) return;
    emitFileView();
    clearTimeout(filesSettleTimer);
    filesSettleTimer = setTimeout(() => {
      filesSettleTimer = 0;
      if (!applyingRemote) socket.emit('files-view', currentViewPayload());
    }, FILES_VIEW_SETTLE_MS);
  });
}

/** 下载：走带令牌的 fetch + a[download]，而不是把 ?roomToken= 塞进链接。
 *  ▎查询串会进浏览器历史与服务器访问日志（同 admin token 那两条取法的权衡）。 */
async function downloadFile(name) {
  if (!myRoom || !myRoomToken) { showToast('先进入会议再下载', 'error'); return; }
  try {
    const r = await fetch(fileBlobUrl(myRoom, name), { headers: roomTokenHeader(), cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }, 4000);
  } catch (e) {
    showToast(`下载失败：${e.message || e}`, 'error');
  }
}

/* 拖拽上传（面板开着时拖进来；不接"拖到整个页面"那种全局劫持——误拖一次就得解释半天） */
{
  const veil = filesDropVeil;
  let depth = 0;
  const show = () => { if (veil) veil.classList.remove('hidden'); };
  const hide = () => { if (veil) veil.classList.add('hidden'); };
  if (filesOverlay) {
    filesOverlay.addEventListener('dragenter', (ev) => { ev.preventDefault(); depth++; show(); });
    filesOverlay.addEventListener('dragover', (ev) => { ev.preventDefault(); });
    filesOverlay.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) hide(); });
    filesOverlay.addEventListener('drop', (ev) => {
      ev.preventDefault();
      depth = 0; hide();
      const fl = ev.dataTransfer && ev.dataTransfer.files;
      if (fl && fl.length) uploadFiles(fl);
    });
  }
}

/* 跟随的初始值：用户的选择要活过刷新（他显然希望"下次也别老弹我"）。 */
try {
  const savedFollow = localStorage.getItem('sfu-files-follow');
  if (savedFollow === '0') { filesFollow = false; }
} catch (e) { /* 无痕模式：用默认值 */ }
setFilesFollow(filesFollow);

log('📁 共享文件已就绪：点控制坞的「文件」，上传后全房间同时看同一页。');
