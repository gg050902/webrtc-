#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 *  check-visual-pass.js —— 「背景说实话 + 聊天分组 + 去 emoji 图标」的真浏览器验证
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎为什么单独一条检查：这一轮改的东西**全在 CSS 与渲染层**（伪元素光晕、分组间距、
 *   图标胶囊、背景漂移）。冒烟桩没有 CSS 引擎，它只能证明"源码里写了这些规则"，
 *   证不了"浏览器真的算出了这些值"——而本项目吃过一次大亏：
 *   全站 CSS 变量为空（坑 26），冒烟一条没红，是用户说"前端排版乱"才发现的。
 * ▎跑法：npm run check:visual（先起 npm run start:sfu）。 */
const fs = require('fs');
const path = require('path');
const { Cdp } = require('../agent/cdp.js');

const URL_ = process.env.CHECK_URL || 'http://localhost:3001/';
const START_URL = URL_ + (URL_.includes('?') ? '&' : '?') + 'nosw=1';
const OUT = process.env.CHECK_OUT || path.join(__dirname, '..', 'wb-rd-shots');
const results = [];
const ok = (name, pass, extra) => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 聊天区里不该再出现彩色 emoji（09-19e 的纪律：图标单色线性，随 currentColor 走） */
const EMOJI_RE = '[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]';
const EMOJI_RE_JS = new RegExp(EMOJI_RE, 'u');

const CHAT = `(function () {
  const list = document.getElementById('chatList');
  const before = list ? list.children.length : 0;
  appendChat('第一句', 'peer-x', false, 'sctp', '小张');
  appendChat('第二句（同一个人连说）', 'peer-x', false, 'sctp', '小张');
  appendChat('这是 AI 的回答', 'ai-bot', false, null, 'AI 小明',
    { mock: false, tokens: 128, totalDocs: 12, hits: 3, turns: 2, intent: 'chat', scoped: true, allDocs: 20 });
  const kids = Array.from(list.children).slice(before);
  const chips = kids[2].querySelectorAll('.msg-ai-trace .tl-chip');
  const chipSvg = Array.from(chips).filter(c => !!c.querySelector('svg')).length;
  return {
    added: kids.length,
    grouped: !!kids[1].classList.contains('msg-cont'),
    nameHidden: kids[1].querySelector('.msg-name') ? getComputedStyle(kids[1].querySelector('.msg-name')).display === 'none' : false,
    chips: chips.length, chipSvg,
    botNameSvg: !!kids[2].querySelector('.msg-name svg'),
    viaSvg: !!kids[0].querySelector('.msg-via svg'),
    text: kids.map(k => k.textContent).join('｜'),
    animName: getComputedStyle(kids[0]).animationName,
    /* 读序：正文必须在证据链之前（脚注在下）。这一条只能在这里断言——
       冒烟桩不建 DOM 树，"谁在谁前面"这种顺序事实在桩里没有对应物。 */
    order: Array.from(kids[2].children).map(c => c.className.split(' ')[0]).join('>'),
  };
})()`;

/* ★ 2026-10-09 注入浏览器之前先让同一个引擎读一遍这些串。
 *   模板字符串**内部**的注释里只要出现反引号，模板就被提前截断——源文件语法没错、node --check 全过，
 *   错在拼出来的那段代码；到浏览器里炸的时候，本脚本一条断言都没跑到（详见 scripts/inject-check.js 头部）。 */
require('./inject-check.js').assertCompiles(__filename, { CHAT });

(async () => {
  const cdp = new Cdp({ headless: true, startUrl: START_URL });
  await cdp.launch();
  await cdp.waitForLoad(15000);
  await sleep(1500);

  const fp = await cdp.evaluate(`(async () => {
    const r = await fetch('client.js', { cache: 'no-store' });
    const t = await r.text();
    return { has: t.indexOf('ICONS') >= 0 && t.indexOf('msg-cont') >= 0, bytes: t.length };
  })()`);
  ok('页面加载的是当前 client.js（不是 SW 缓存的旧版）', fp && fp.has === true, 'bytes=' + (fp && fp.bytes));
  if (!(fp && fp.has)) { cdp.kill(); process.exit(1); }
  const cssFp = await cdp.evaluate(`(async () => {
    const r = await fetch('style.css', { cache: 'no-store' });
    const t = await r.text();
    return t.indexOf('stageBreath') >= 0 && t.indexOf('auroraDrift') >= 0;
  })()`);
  ok('样式也是当前版（含 stageBreath / auroraDrift）', cssFp === true);

  /* ① 侧栏 tab：三个都该是单色 SVG，不再有 👥🧠💬 */
  const tabs = await cdp.evaluate(`(function(){
    const ts = Array.from(document.querySelectorAll('.side-tab'));
    return { n: ts.length, svg: ts.filter(t => !!t.querySelector('svg.i')).length,
             txt: ts.map(t => t.textContent.trim()).join('｜') };
  })()`);
  ok('侧栏三个 tab 都换成了单色线性图标', tabs.n === 3 && tabs.svg === 3, `svg=${tabs.svg}/${tabs.n} ${tabs.txt}`);
  ok('tab 文字里已无 emoji', !EMOJI_RE_JS.test(tabs.txt), tabs.txt);

  /* ② 聊天：分组、证据链胶囊、图标 */
  const c = await cdp.evaluate(CHAT);
  ok('三条消息都渲染出来了', c.added === 3, `added=${c.added}`);
  ok('同一人连发被归成一串（第二条打上 msg-cont 且名字隐掉）',
    c.grouped === true && c.nameHidden === true, `grouped=${c.grouped} nameHidden=${c.nameHidden}`);
  ok('AI 证据链变成图标胶囊（≥2 个，每个都带 SVG）',
    c.chips >= 2 && c.chipSvg === c.chips, `chips=${c.chips} 带图标=${c.chipSvg}`);
  ok('AI 气泡名字前是 SVG（双机器人那个坑的根因之一）', c.botNameSvg === true);
  /* 读序断言：答案先上、过程作注脚。曾经证据链胶囊排在正文**上面**，
   *   用户第一眼读到的是"检索 12 条取 3 条"这种元信息，要往下翻才看到答案。 */
  ok('AI 气泡的读序：正文在证据链之前（脚注在下，不是把元信息压在答案上）',
    /^msg-name>msg-text>msg-ai-trace/.test(c.order || ''), c.order);
  ok('SCTP 路径徽标也换成 SVG', c.viaSvg === true);
  ok('新消息有入场动画（animation-name 不是 none）', c.animName && c.animName !== 'none', c.animName);
  const emojiInChat = await cdp.evaluate(`(function(){
    const t = document.getElementById('chatList').textContent;
    const re = /${EMOJI_RE}/u;
    const hit = t.match(re);
    return hit ? '残留 ' + hit[0] : '';
  })()`);
  ok('聊天区已无彩色 emoji（09-19e 纪律收尾）', emojiInChat === '', emojiInChat);

  /* ③ 背景说实话：给一块画面加上 .speaking，量伪元素的真实不透明度 */
  const halo = await cdp.evaluate(`(function(){
    const grid = document.getElementById('videoGrid');
    const box = document.createElement('div');
    box.className = 'video-box';
    box.style.cssText = 'width:280px;height:160px';
    grid.appendChild(box);
    const off = getComputedStyle(box, '::after').opacity;
    box.classList.add('speaking');
    void box.offsetWidth;
    const on = getComputedStyle(box, '::after').opacity;
    const anim = getComputedStyle(box, '::after').animationName;
    box.remove();
    return { off: Number(off), on: Number(on), anim };
  })()`);
  ok('发言者背后确实浮起一圈光（::after 不透明度 0 → 非 0）',
    halo.off === 0 && halo.on > 0.2, `${halo.off} → ${halo.on} (${halo.anim})`);
  /* ④ ★ 2026-10-06 光标聚光描边（style.css 第 37 节 / client.js 的 initTileSpotlight）
   *   ▎为什么必须真鼠标：hover 与 pointermove 都是浏览器的输入状态，桩里造不出来；
   *     而这条效果的"对不对"恰恰是**位置跟不跟手**——只断言 CSS 规则写了等于没测（坑 76）。
   *   ▎判据三件：不透明度 0→1、--mx/--my 落在真实光标位置（±3%）、遮罩把光裁成环
   *     （mask-composite: exclude）——最后这条是"不盖住画面内容"的机制证据。
   *   ▎探针挂在 body 上而不是网格里：这条检查不进房间（没有媒体动线），而 .room-panel
   *     在未进房时是隐藏的 —— 挂在隐藏的容器里 getBoundingClientRect 全是 0，
   *     hover 也永远不会成立，那测的是"页面在不在会中"而不是这条 CSS（坑 55 同族）。 */
  const probe = await cdp.evaluate(`(function(){
    const box = document.createElement('div');
    box.id = 'spotProbe'; box.className = 'video-box';
    box.style.cssText = 'position:fixed;left:140px;top:300px;width:280px;height:160px;z-index:9999';
    document.body.appendChild(box);
    const r = box.getBoundingClientRect();
    const W = window.innerWidth, H = window.innerHeight;
    return {
      off: Number(getComputedStyle(box, '::before').opacity),
      mask: (getComputedStyle(box, '::before').maskComposite
        || getComputedStyle(box, '::before').webkitMaskComposite || ''),
      w: r.width,
      // 目标点：这块格子里 25% / 30% 的位置（换成整屏归一化坐标给 CDP 用）
      nx: (r.left + r.width * 0.25) / W, ny: (r.top + r.height * 0.30) / H,
      // 屏幕右上角：把光标彻底移出去用
      outX: 0.985, outY: 0.02,
    };
  })()`);
  await cdp.mouse('mouseMoved', probe.nx * 0.6, probe.ny * 0.6);
  await cdp.mouse('mouseMoved', probe.nx, probe.ny);
  /* 轮询到"停住"再读，理由同下面那条"熄灭"：opacity 有 .18s 过渡，
   *   睡固定时长必然有时读到中间值——第一版就是 0.309 被判成"没亮起来"。
   *   量具不该跟自己的动画赛跑（10-04e 的纪律，这里两处一起改）。 */
  let spot = null;
  for (let i = 0; i < 20; i++) {
    await sleep(100);
    spot = await cdp.evaluate(`(function(){
      const box = document.getElementById('spotProbe');
      if (!box) return null;
      const cs = getComputedStyle(box);
      return {
        on: Number(getComputedStyle(box, '::before').opacity),
        mx: cs.getPropertyValue('--mx').trim(), my: cs.getPropertyValue('--my').trim(),
      };
    })()`);
    if (!spot || spot.on >= 0.999) break;
  }
  const pct = (s) => Number(String(s).replace('%', ''));
  ok('光标聚光：hover 到格子上时描边亮起来（::before 不透明度 0 → 1）',
    probe.off === 0 && spot && spot.on > 0.5, `${probe.off} → ${spot && spot.on}`);
  ok('光标聚光：亮的位置就是光标的位置（--mx/--my 落在格子内 25%/30%，±3%）',
    spot && Math.abs(pct(spot.mx) - 25) <= 3 && Math.abs(pct(spot.my) - 30) <= 3,
    spot ? `--mx=${spot.mx} --my=${spot.my}` : '量不到');
  ok('聚光被遮罩裁成 1px 环（mask-composite: exclude）——不盖住共享画面里的文字',
    /exclude|xor/.test(String(probe.mask)), `mask-composite=${probe.mask || '(未生效)'}`);
  await cdp.mouse('mouseMoved', probe.outX, probe.outY);
  /* 轮询到"停住"再判，而不是睡一个固定时长：opacity 是 .18s 过渡，
   *   第一版睡 260ms 读到 0.036（还在收尾）→ 判成"没熄灭"是**量具在跟自己的动画赛跑**
   *   （10-04e 同一条纪律：时序脆弱断言要改成等到发生为止）。 */
  let spotOut = -1;
  for (let i = 0; i < 20; i++) {
    spotOut = await cdp.evaluate(`(function(){
      const b = document.getElementById('spotProbe');
      return b ? Number(getComputedStyle(b, '::before').opacity) : -1;
    })()`);
    if (spotOut === 0) break;
    await sleep(100);
  }
  const spotGone = await cdp.evaluate(`(function(){
    const b = document.getElementById('spotProbe'); if (b) b.remove(); return 1;
  })()`);
  ok('光标移开就熄灭（不是常驻发光——常驻的那叫装饰，不叫反馈）', spotOut === 0 && spotGone === 1, String(spotOut));
  const bg = await cdp.evaluate('getComputedStyle(document.body, \'::before\').animationName');
  ok('全局背景在缓慢漂移（auroraDrift 真的挂上了）', /auroraDrift/.test(String(bg)), String(bg));
  const stage = await cdp.evaluate('getComputedStyle(document.querySelector(".stage"), \'::before\').filter');
  ok('舞台底部有一层"地平线"暖光（blur 伪元素在生效）', /blur/.test(String(stage)), String(stage));

  /* ★ 2026-10-06 跨网入口（G4）：顶栏那颗「跨网链接」按钮必须**跟着服务器的真值**出现或消失。
   *   ▎判据从页面里现取 /config.json，而不是假设本机装没装 Tailscale：
   *     装了（或用 TS_IP 明示）→ 按钮可见、链接带房间号格式；
   *     没装 → 按钮必须仍然 hidden。**一条点了打不开的假链接比没有链接更坏**（坑 82 的链接版），
   *     所以这条断言的两个分支都是红线，只是这台机器每次只会走到其中一个。 */
  const cross = await cdp.evaluate(`(async () => {
    const cfg = await fetch('/config.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({}));
    const b = document.getElementById('crossLinkBtn');
    const ai = document.getElementById('aiBtn');
    return JSON.stringify({
      tsUrl: cfg.tsUrl || '',
      exists: !!b,
      hidden: b ? b.classList.contains('hidden') : null,
      /* 页面自己承认"配置已经落地"的证据：applyServerConfig 会写 AI 模式灯。
       * 没有这一格，"按钮是 hidden"就分不清是**按真值藏的**还是**配置根本没到**。 */
      landed: ai ? (ai.dataset.aiMode || '') : '',
    });
  })()`);
  {
    const c = JSON.parse(cross || '{}');
    const hasTs = !!c.tsUrl;
    ok('跨网链接按钮跟着服务器真值走：有 tsUrl 才显示，没有就必须藏着（不许假地址）',
      c.exists && !!c.landed && (hasTs ? c.hidden === false : c.hidden === true),
      `tsUrl=${c.tsUrl || '(无)'} · hidden=${c.hidden} · 配置落地=${c.landed || '(未落地!)'}`);
    /* 点了要有话说：这一屏还没进房（没有房间号可带），按钮不能静默复制一条"少了 ?room= 的半截链接"
     * ——对方点开是首页，正是这条功能最难自查的坏法。判据是"给出下一步指引"，不是"什么也没发生"。 */
    if (hasTs) {
      const clicked = await cdp.evaluate(`(() => {
        const b = document.getElementById('crossLinkBtn'); if (!b) return 'no-btn';
        b.click();
        const t = document.getElementById('toast');
        return t ? t.textContent : '';
      })()`);
      ok('没进房时点「跨网链接」不静默复制半截链接，而是说清下一步（先进房）',
        /先进房|进房/.test(String(clicked)), String(clicked).slice(0, 60));
    }
  }


  /* ★ 2026-10-06 第 47 步「邀请面板」的真浏览器行为四条。
   *   ▎为什么不能只在冒烟里断言：这三件事全在 DOM 事件流里——
   *     ① 点徽标**展开**面板，② 点面板外面收起，③ 点徽标那一趟点击不能被"点外面"的逻辑
   *     立刻关掉（冒泡顺序：按钮处理器 → document 处理器，写漏排除条件就是"点了没反应"）。
   *     冒烟桩的 document.addEventListener 是空操作，在那儿断言只能证明"桩里没人调它"（坑 83）。
   *   ▸ myRoom 在这里是直接赋值（进真房要媒体、要建房信令，这条检查的范围是界面不是会议本体）。
   *     被赋的是**页面自己的全局词法绑定**，走的仍是真实处理器——所以断的是处理器行为，
   *     不是我把变量改成什么。剪贴板同理：包一层只为了"看见它想复制什么"，
   *     原始 writeText 照样调用，失败兜底路径一点没绕开。 */
  const invite = await cdp.evaluate(`(async () => {
    const seen = [];
    const orig = navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText.bind(navigator.clipboard) : null;
    if (navigator.clipboard) navigator.clipboard.writeText = (t) => { seen.push(String(t)); return orig ? orig(t) : Promise.reject(new Error('no clipboard')); };
    const cfg = await fetch('/config.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({}));
    const realTs = tsUrl;
    myRoom = '246810';                       // 让徽标那句"没进房就别弹"的闸放行
    const P = () => document.getElementById('invitePanel');
    const hidOf = (el) => !!(el && el.classList.contains('hidden'));
    const read = () => ({
      open: !hidOf(P()),
      lan: (document.getElementById('inviteLanUrl') || {}).textContent || '',
      cross: (document.getElementById('inviteCrossUrl') || {}).textContent || '',
      crossBtnHidden: hidOf(document.getElementById('inviteCrossCopy')),
      topBtnHidden: hidOf(document.getElementById('crossLinkBtn')),
      hint: (document.getElementById('inviteHint') || {}).textContent || '',
      note: (document.getElementById('inviteCrossNote') || {}).textContent || '',
      clipped: seen.slice(-1)[0] || '',
    });

    /* 命中测试要在"真实会中形态"下做：这一屏此刻还压着登录卡(z110)与预览页(z100)，
     * 而真开会时那两层都不存在。先临时藏掉、量完原样还原（第一张截图的拍摄对象就是它们）。 */
    const pj = document.getElementById('prejoin');
    const au = document.querySelector('.auth-overlay');
    const pjUp = pj && !pj.classList.contains('hidden');
    const auUp = au && !au.classList.contains('hidden');
    if (pjUp) pj.classList.add('hidden');
    if (auUp) au.classList.add('hidden');

    /* ① 点徽标：展开 + 复制局域网那条。同一趟点击会顺着冒泡走到 document 的"点外面"处理器，
     *    排除条件写漏就在这一步现形（表现是"点了没反应"）。 */
    document.getElementById('roomBadge').click();
    const a = read();

    /* ② 点面板外面要收起 —— 有了这一步，① 的"没被关掉"才不是"监听根本没挂"换来的 */
    (document.querySelector('.stage') || document.body).click();
    const c = read();

    /* ③ 没有跨网入口的那一支：这一行必须写明"没有"，不给假地址，复制按钮跟着藏 */
    tsUrl = '';
    renderInvitePanel();
    const d = read();
    const dUrl = /^https?:\\/\\//.test(d.cross);

    /* ④ 入口回来时要重新变成地址（不是"一旦说没有就永远说没有"的锁存）。
     *    这里给一个假造的 100.x 只为了喂 renderInvitePanel 的输入——
     *    断的是"给它 tsUrl 它就渲染成带房间号的地址"，不是"这台机器有跨网"。 */
    tsUrl = 'http://100.127.44.99:3001';
    renderInvitePanel();
    const e = read();
    tsUrl = realTs || cfg.tsUrl || null;      // 一律还原，别把假地址留给后面的截图

    /* ⑤ 几何要**在面板开着**的时候量：收起状态 getBoundingClientRect 全是 0，
     *    拿着它断"宽度够不够"是一条永远红的假断言（量具自己造成的那种）。 */
    document.getElementById('roomBadge').click();
    const r = P().getBoundingClientRect();
    /* 面板中心这块地方，浏览器会把点击给谁？（第 45 步立的命中测试手法：
     *   "看不见/点不动"先问页面，别猜状态机——09-16 那次"视频透进面板"就是这么抓出来的） */
    const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(cx, cy);
    const inPanel = !!(hit && P().contains(hit));
    const hitDesc = hit ? (hit.id || hit.className || hit.tagName) : '(没有元素)';
    const zPanel = Number(getComputedStyle(P()).zIndex);
    const tEl = document.getElementById('toast');
    const zToast = tEl ? Number(getComputedStyle(tEl).zIndex) : NaN;
    P().classList.add('hidden');
    if (pjUp) pj.classList.remove('hidden');   // 还原：第一张截图拍的就是这一屏

    return JSON.stringify({ a, c, d, e, dUrl, cfgTs: cfg.tsUrl || '', inPanel, hitDesc,
      fits: r.right <= innerWidth + 1 && r.left >= -1 && r.width > 240 && r.height > 60,
      box: Math.round(r.width) + 'x' + Math.round(r.height), zPanel, zToast });
  })()`);
  {
    const v = JSON.parse(invite || '{}');
    const A = v.a || {}, C = v.c || {}, D = v.d || {}, E = v.e || {};
    ok('邀请面板：点房间号徽标真的展开，且**同一趟点击没把它自己关掉**',
      A.open === true && A.clipped === A.lan && /^https?:\/\//.test(A.lan) && /246810/.test(A.lan),
      `lan=${A.lan} · 剪贴板=${A.clipped || '(空)'}`);
    ok('邀请面板：点面板外面会收起（浮层不能有"关不掉"这条路；也是上一条不是假绿的凭据）',
      C.open === false, `点舞台后 open=${C.open}`);
    ok('邀请面板：没有跨网入口时那一行是说明不是链接，复制按钮跟着藏（坑 82 的链接版）',
      D.crossBtnHidden === true && v.dUrl === false && /Tailscale/.test(D.cross),
      `cross="${D.cross}" · 按钮hidden=${D.crossBtnHidden}`);
    ok('邀请面板：入口回来时那一行重新变成带房间号的地址（不做"说过一次没有就永远没有"的锁存）',
      /^https?:\/\//.test(E.cross) && /246810/.test(E.cross) && E.crossBtnHidden === false,
      `cross=${E.cross}`);
    /* 说明行必须跟着顶栏那颗按钮的**真实显隐**说话：这就是"浮层里复述别处状态"最容易漂的地方。 */
    ok('邀请面板：跨网那句说明跟着顶栏按钮的真实状态走（藏着就说藏着，不许照抄"在顶栏"）',
      E.topBtnHidden ? /藏着/.test(E.note) : /顶栏/.test(E.note),
      `顶栏按钮hidden=${E.topBtnHidden} · 说明="${String(E.note).slice(0, 40)}"`);
    /* 说明文字只该讲"这一屏才成立的事实"：房间号必须在；而"怎样才能有跨网入口"
     * 这句**只在该没有入口的时候**出现（有入口时它就是噪音——第一版把它写在了每一屏）。
     * ▸ 判据跟着 A 时刻的真实状态分叉，而不是假设本机装没装 Tailscale：
     *   这条检查在两种服务器上都要能跑（有 TS_IP / 没有），写死任何一边都会有一半是假绿。 */
    const aHasCross = /^https?:\/\//.test(A.cross || '');
    ok('邀请面板：说明写的是眼下事实（房间号在里面，跨网那一步只在没有入口时才提）',
      /246810/.test(A.hint) && A.hint.length > 10 && (aHasCross ? !/Tailscale/.test(A.hint) : /Tailscale/.test(A.hint)),
      `有跨网入口=${aHasCross} · 说明="${String(A.hint).slice(0, 60)}…"`);
    ok('邀请面板：没有跨网入口时那一行的说明给出下一步（装 Tailscale / TS_IP），而不是留个空地址',
      /Tailscale/.test(D.hint) && /Tailscale/.test(D.cross),
      `行内="${String(D.cross).slice(0, 40)}…"`);
    ok('邀请面板：不溢出视口，且 z-index 低于提示条（量出来的数，不是"看着没盖住"）',
      v.fits === true && v.zPanel > 0 && v.zPanel < v.zToast, `${v.box} · z=${v.zPanel} vs toast ${v.zToast}`);
    /* 命中测试：z-index 只是"我声称的层级"，elementFromPoint 才是"浏览器实际会把点击给谁"。
     *   上一条断了 z，这一条断**结果**——侧栏/顶栏哪天加了 transform 或 filter 就会造出新的
     *   堆叠上下文，把浮层按在下面而 z-index 数字照旧（坑 80 那次"白板盖住字幕条"的镜像）。 */
    ok('邀请面板：面板中心这块地方归面板自己（命中测试过了，不是只看了 z-index）',
      v.inPanel === true, `中心命中=${v.hitDesc}`);
  }

  /* ══ ★ 2026-10-06 第 39 节：两个 reactbits 移植（文字流光 + 授权卡走光边框）══
   *   ▎为什么不停在"computed style 里有这条规则"：那只能证明 CSS 写对了，证不了它在动。
   *     conic-gradient 的角度是个 CSS 自定义属性，**不注册 @property 的话浏览器把它当字符串**，
   *     动画"在跑"、名字对、时长对，而角度永远不插值 → 边框一动不动（坑 76 的 CSS 版）。
   *     所以这里做三件事：① CSS 契约 ② getAnimations() 确认真的有在 running 的动画
   *     ③ 同一块区域连拍两张量像素差，并且**拿 reduced-motion 当关掉动效的对照组**。 */
  {
    const css = await cdp.evaluate(`(() => {
      const t = document.querySelector('.room-hero-title');
      const ask = document.getElementById('remoteAskBox');
      if (!t || !ask) return JSON.stringify({ err: '缺元素' });
      const cs = getComputedStyle(t);
      ask.classList.remove('hidden');                 // 授权卡平时藏着，这里只把它显形来量动效
      /* ▎为什么要临时藏掉预览页与登录卡：这张授权卡是**磨砂玻璃**（backdrop-filter），
       *   它内部像素会跟着背后那屏的打字机与星云一起动。第一版没藏它们，
       *   量出来"内部变化 65 > 环 33"——不是光太弱，是**环境比被测量还吵**。
       *   对照实验的前提是把噪音源请出去，而不是把阈值调低到能通过。
       *   （测完原样恢复，后面的截图仍然要拍这一屏。） */
      const layers = [document.getElementById('prejoin'), document.querySelector('.auth-overlay')]
        .filter(Boolean);
      window.__fxRestore = layers.filter((el) => !el.classList.contains('hidden'));
      window.__fxRestore.forEach((el) => el.classList.add('hidden'));
      const af = getComputedStyle(ask, '::after');
      const r = ask.getBoundingClientRect();
      const run = (el, pseudo) => el.getAnimations(pseudo ? { pseudoElement: pseudo } : {})
        .some((a) => a.playState === 'running');
      return JSON.stringify({
        clip: cs.backgroundClip || cs.webkitBackgroundClip || '',
        fill: cs.webkitTextFillColor || '',
        pos0: cs.backgroundPosition || '',
        titleAnim: cs.animationName, titleRunning: run(t),
        mask: af.maskComposite || af.webkitMaskComposite || '',
        ringAnim: af.animationName, ringRunning: run(ask, '::after'), pe: af.pointerEvents,
        rect: { x: Math.max(0, Math.floor(r.left) - 4), y: Math.max(0, Math.floor(r.top) - 4),
          w: Math.ceil(r.width) + 8, h: Math.ceil(r.height) + 8 },
      });
    })()`);
    const c0 = JSON.parse(css || '{}');
    /* 注意：这条断言**必须**排在 pos1 之后。它读 pos1，而 pos1 是个 const ——
     * 写在它上面就是 TDZ（坑 69 在本项目已经踩过三次，这次踩在自己刚写的检查脚本里）。 */
    ok('走光边框：环是被 mask 挖出来的（只有边上一圈 2px，不吃点击、不挡文字），且有在跑的动画',
      /exclude|xor/.test(c0.mask) && c0.pe === 'none' && /acSpin/.test(c0.ringAnim) && c0.ringRunning === true,
      `mask=${c0.mask} · pointer-events=${c0.pe} · anim=${c0.ringAnim} · running=${c0.ringRunning}`);

    /* ── 这个量具改了三次，每一次"红"都是它自己的错，不是产品的错（都记下来，别再来一遍）──
     *   ① 拿"卡内部像素"当应为 0 的对照 → 这张卡是磨砂玻璃，内部本来就在跟着背景动
     *    （实测内部均差 65 > 环 33，于是"光在动"被判成"光不如背景吵"）。
     *   ② 拿 reduced-motion 当对照 → 它把环境也一起停了，两边都是 0；两个 0 相减什么也证不了。
     *   ③ 拿环带**平均值**当判据 → 亮头只占周合约 6%，4920 个像素一平均就稀释成 1。
     *   ▸ 终版分三层，从"原因"到"结果"各量一次：
     *      · **原因**：::after 上 --ac-angle 的计算值在不在长
     *        （不注册 @property 时它永远是一个字符串 "0deg"，动画"在跑"却不动 —— 坑 76 的 CSS 版）
     *      · **对照**：只暂停这道光自己（环境照旧），比较环带的**峰值变化**与**热点像素数**
     *      · **可见**：环上到底有多少亮像素（rBright）——"这玩意儿看得见吗"的最低门槛
     *   ▎筛伪元素动画为什么走 document.getAnimations()：这个版本的 Chrome 上
     *     `el.getAnimations({ pseudoElement: '::after' })` 会把元素自己的 rise 动画算进伪元素那份
     *     （实测返回 ["rise"]，而该返回的是 acSpin）——用错的话"暂停"根本暂停不到东西。 */
    const clip = { x: Math.max(0, c0.rect.x + 2), y: Math.max(0, c0.rect.y + 2),
      width: Math.max(40, c0.rect.w - 4), height: Math.max(24, c0.rect.h - 4) };
    const asObj = (x) => (typeof x === 'string' ? JSON.parse(x || '{}') : (x || {}));
    const angleOf = () => cdp.evaluate(`(() => {
      const ask = document.getElementById('remoteAskBox');
      const v = getComputedStyle(ask, '::after').getPropertyValue('--ac-angle');
      return String(v);
    })()`);
    const setRingPlay = (mode) => cdp.evaluate(`((m) => {
      const ask = document.getElementById('remoteAskBox');
      const list = document.getAnimations().filter((a) => a.effect && a.effect.pseudoElement === '::after'
        && a.effect.target === ask);
      list.forEach((a) => { if (m === 'pause') a.pause(); else a.play(); });
      return list.length;
    })(${JSON.stringify(mode)})`);
    async function bandDiff({ settle } = {}) {
      const grab = async () => (await cdp.screenshot({ format: 'png', clip })).toString('base64');
      const s1 = await grab();
      let s2 = null;
      if (settle) {
        /* 轮询到"看见差别"为止（上限 6s），而不是睡一个"看起来够用"的固定值。
         *   ▎为什么：固定 1.2s 在机器空时没问题，在全量 check:all 的负载下会撞上
         *     "两张其实是同一帧"（合成器还没画下一帧）——症状是环带差为 0，
         *     看着像"光没动"，其实是量具在跟自己的动画赛跑（坑 96 第四次应验，
         *     而这次栽在我刚写的动效上）。红灯会移动，就先怀疑量具。 */
        const t0 = Date.now();
        while (Date.now() - t0 < 6000) {
          await sleep(250);
          const cand = await grab();
          if (cand !== s1) { s2 = cand; break; }
          s2 = cand;
        }
      } else {
        await sleep(1200);        // 对照组要的是"给它足够时间也不许出现差别"，所以固定等待
        s2 = await grab();
      }
      return asObj(await cdp.evaluate(`(async () => {
        const load = (b) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + b; });
        const [a, b] = await Promise.all([load('${s1}'), load('${s2}')]);
        const grab = (img) => {
          const o = document.createElement('canvas'); o.width = img.width; o.height = img.height;
          const g = o.getContext('2d'); g.drawImage(img, 0, 0);
          return g.getImageData(0, 0, img.width, img.height);
        };
        const A = grab(a), B = grab(b);
        const W = a.width, H = a.height;
        /* 一次读回整块像素再遍历。逐像素 getImageData(x,y,1,1) 要调 8 万次 ×2 张，
         * 量具自己就能把 CDP 的 30s 预算烧光——症状与"页面卡死"一模一样（坑 86）。 */
        let ringMax = 0, ringHot = 0, ringN = 0, bright = 0, coreMax = 0, lum = 0, lumN = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const dd = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]);
          const L = 0.2126 * A.data[i] + 0.7152 * A.data[i + 1] + 0.0722 * A.data[i + 2];
          lum += L; lumN++;
          /* 到最近边缘的距离：环住在离边 0~3px 那一圈（截图已贴着卡片边裁）。 */
          const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
          if (edge <= 3) {
            ringN++;
            if (dd > ringMax) ringMax = dd;
            if (dd >= 180) ringHot++;
            if (L > 170) bright++;
          } else if (edge >= 8 && dd > coreMax) coreMax = dd;
        }
        return { ringMax, ringHot, bright, coreMax, ringN, lum: Math.round(lum / Math.max(1, lumN)), W, H };
      })()`));
    }
    const ang0 = await angleOf();
    const on = await bandDiff({ settle: true });
    const ang1 = await angleOf();
    /* 文字流光同一条纪律：动画名对、running 对，都不等于**它在画面上动过**。
     * background-position 是这条动画唯一改变的量，所以就读它——隔一次 bandDiff（≈2.4s）再读一次。 */
    const pos1 = await cdp.evaluate(`(() => {
      const cs = getComputedStyle(document.querySelector('.room-hero-title'));
      return cs.backgroundPosition || '';
    })()`);
    ok('文字流光：标题按 background-clip:text 上色、动画在跑，且 background-position 真的在移动',
      /text/.test(c0.clip) && (/transparent/.test(c0.fill) || /rgba?\(0, *0, *0, *0\)/.test(c0.fill))
        && /shinySweep/.test(c0.titleAnim) && c0.titleRunning === true && c0.pos0 !== pos1,
      `clip=${c0.clip} · anim=${c0.titleAnim} · 位=${c0.pos0} → ${pos1}`);
    const nAnims = await setRingPlay('pause');
    const off = await bandDiff();
    await setRingPlay('play');

    /* ▎判据的形状为什么是"差值 + 不为零"，而不是"角度至少涨 40°"：
     *   全量 check:all 的负载下浏览器会把不可见窗口的动画时钟**节流**
     *   （实测某一场只涨了 36.66°，而同一条检查单独跑涨 141°；同期 check:toggle 的
     *   "环在扩散"也被冻成 0.5 → 0.5）。节流是环境，不是产品缺陷——
     *   拿"变化量够大"当判据，就会把机器忙判成代码坏（坑 80：会移动的失败先怀疑量具）。
     *   真正区分"注册了 @property"与"没注册"的是**有没有在涨**：没注册时它永远是 0deg，
     *   节流再狠也不会把它变成"从 0 涨到 36"。所以判据写成"涨了 ≥5°"。 */
    ok('走光边框的**原因**成立：::after 上的 --ac-angle 真的在长（@property 没注册就永远停在 0deg）',
      (() => {
        const a = parseFloat(ang0), b = parseFloat(ang1);
        return Number.isFinite(a) && Number.isFinite(b) && (b - a) >= 5;
      })(), `角度 ${ang0} → ${ang1}`);
    /* 像素层同理：判据是"放开 vs 暂停"的**差**，不是绝对幅度。
     * 暂停那一次是精确的 0（同一台机器、同一块区域、只差这条动画），
     * 所以哪怕节流把幅度压小，"从 0 变成非 0"这件事仍然只能由这道光解释。 */
    ok('走光边框**真的画到像素上**：开着时环带有大幅变化与热点，只把这道光暂停后两者归零',
      nAnims >= 1 && on.ringMax >= 40 && on.ringHot >= 2 && off.ringMax <= 20 && off.ringHot === 0,
      `峰值 ${on.ringMax}→停后 ${off.ringMax} · 热点 ${on.ringHot}→停后 ${off.ringHot} · 伪元素动画=${nAnims} 条`);
    ok('环是**看得见**的（边上确实有一圈亮像素，不是只有断言里写着 blur）',
      Math.max(on.bright, off.bright) >= 4 && on.lum > 8,
      `环上亮像素=${on.bright}/${off.bright}（取两次较大值，亮头会转到不同边）· 平均亮度=${on.lum}`);
    ok('暂停操作确实落在伪元素动画上（拿到 0 条的话，上面那个对照就是空转）',
      nAnims >= 1, `::after 上的动画数=${nAnims}`);

    /* prefers-reduced-motion 单独一条：它量的是**产品行为**（前庭敏感的用户看到什么），
     * 不再兼任上面那个实验的对照——两件事别混成一个（混了就两个都说不清）。 */
    await cdp._send(cdp.pageWs, 'Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await sleep(300);
    const r0 = asObj(await cdp.evaluate(`(() => {
      const t = document.querySelector('.room-hero-title');
      const ask = document.getElementById('remoteAskBox');
      const cs = getComputedStyle(t), af = getComputedStyle(ask, '::after');
      return JSON.stringify({ title: cs.animationName, ring: af.animationName,
        ringStillThere: (af.maskComposite || af.webkitMaskComposite || '') !== '',
        titleStillReadable: getComputedStyle(t).display !== 'none' });
    })()`));
    await cdp._send(cdp.pageWs, 'Emulation.setEmulatedMedia', { features: [] });
    await cdp.evaluate(`(() => {
      document.getElementById('remoteAskBox').classList.add('hidden');
      (window.__fxRestore || []).forEach((el) => el.classList.remove('hidden'));   // 恢复现场：后面的截图要拍这一屏
      return 1;
    })()`);
    ok('reduced-motion 下两个动效都停，但环与标题还在（停的是动效，不是信息）',
      r0.title === 'none' && r0.ring === 'none' && r0.ringStillThere === true && r0.titleStillReadable === true,
      `title=${r0.title} · ring=${r0.ring} · 环还在=${r0.ringStillThere}`);
  }

  fs.mkdirSync(OUT, { recursive: true });
  await cdp.evaluate('document.querySelector(".auth-overlay") && document.querySelector(".auth-overlay").classList.add("hidden"); "ok"');
  await sleep(300);
  fs.writeFileSync(path.join(OUT, 'visual-pass.png'), await cdp.screenshot({ format: 'png' }));
  /* 第二张：把 prejoin 也藏掉，露出应用壳（侧栏/聊天/舞台）——
   *   分组、证据链胶囊、发言光晕这些改动全在那一层里；只拍登录屏等于没拍到。 */
  await cdp.evaluate(`(function(){
    const p = document.getElementById('prejoin'); if (p) p.classList.add('hidden');
    /* 房间卡片浮在舞台中央，不藏就拍不到视频格（分组、光晕这些改动全在舞台那一层） */
    const rp = document.getElementById('roomPanel'); if (rp) rp.classList.add('hidden');
    const g = document.getElementById('videoGrid');
    if (g && !g.children.length) {
      for (const [name, speaking] of [['小张', true], ['小李', false], ['我', false]]) {
        const b = document.createElement('div');
        b.className = 'video-box' + (speaking ? ' speaking' : '');
        b.innerHTML = '<div class="video-ph"></div><div class="video-label">' + name + '</div>';
        g.appendChild(b);
      }
    }
    document.querySelector('.side-tab[data-side="chat"]')?.click();
    return 'ok';
  })()`);
  await sleep(700);
  fs.writeFileSync(path.join(OUT, 'visual-pass-room.png'), await cdp.screenshot({ format: 'png' }));
  /* ★ 2026-10-06 第三张：邀请面板展开的样子（第 47 步新浮层）。
   *   ▎为什么数字之外还要一张图：坑 96 那条硬账——"三条几何断言全绿，截图当场露馅"。
   *     浮层最容易坏在"数字都对但读起来很累"：长地址断成三截、说明挤成一团小灰字。
   *     这类只有看图看得见，所以断言跑完仍然拍一张留给人核对。 */
  await cdp.evaluate(`(() => { myRoom = '246810'; openInvitePanel(); return 1; })()`);
  await sleep(260);   // 入场动画 .22s，等它停稳再拍（拍一半是看不出排版好坏的）
  fs.writeFileSync(path.join(OUT, 'visual-invite-panel.png'), await cdp.screenshot({ format: 'png' }));
  await cdp.evaluate(`(() => { closeInvitePanel(); myRoom = null; return 1; })()`);
  console.log(`  截图落盘：wb-rd-shots/visual-pass.png / visual-pass-room.png / visual-invite-panel.png`);

  /* ★ 2026-10-06 看板错峰入场（AnimatedContent 移植）——在**真浏览器**里量 delay。
   *   ▎为什么不能只靠冒烟：冒烟证明了"JS 按顺序写了 --i"，但 CSS 那条 calc 公式有没有真的
   *     落到元素上（选择器拼错、变量名写错、被后面的层覆盖）只有 computed style 知道。
   *     这是坑 78"加了图标忘写尺寸"的同一家族：样式缺失不报错，只会让界面没效果。
   *   ▸ 造三个假分区：真实数据要等 AI 看板出增量，检查不该依赖那个；这里量的是
   *     "切到看板这一刻，三个分区的 delay 是不是 0 / 45 / 90ms"。测完自己擦干净。 */
  {
    const st = await cdp.evaluate(`(() => {
      const view = document.querySelector('.side-view[data-side="board"]');
      const list = document.getElementById('boardList');
      if (!view || !list) return JSON.stringify({ err: '看板视图不存在' });
      const made = [];
      for (let i = 0; i < 3; i++) {
        const d = document.createElement('div');
        d.className = 'board-sec';
        list.appendChild(d); made.push(d);
      }
      if (typeof switchSide === 'function') switchSide('board');
      const got = made.map((d) => {
        const cs = getComputedStyle(d);
        return { name: cs.animationName, delay: Math.round(parseFloat(cs.animationDelay) * 1000), idx: d.style.getPropertyValue('--i') };
      });
      made.forEach((d) => d.remove());
      return JSON.stringify({ got, viewHas: view.classList.contains('ac-in') });
    })()`);
    const s = JSON.parse(st || '{}');
    const g = s.got || [];
    const delays = g.map((x) => x.delay);
    ok('看板错峰在真浏览器里成立：三个分区的 delay 是 0 / 45 / 90ms（CSS 的 calc 真的作用到了）',
      g.length === 3 && g.every((x) => x.name === 'acRise') && String(delays) === '0,45,90' && s.viewHas === true,
      `动画名 ${g.map((x) => x.name).join('/')} · delay ${delays.join('/')}ms · --i ${g.map((x) => x.idx).join('/')}`);
  }

  /* ★ 2026-10-06 版本自检（坑 40 的收尾）三件一起量：
   *   ① 服务器**真的**把 index.html 里的 ?v= 改写成了内容哈希（不是源码里写死的那个）；
   *   ② 页面加载到的版本与 /config.json 下发的一致 ⇒ 横幅必须是隐藏的（假警告比沉默更糟）；
   *   ③ 人为造一次不一致 ⇒ 横幅必须出现，恢复之后又必须消失（两个方向都要能验，
   *      否则"默认隐藏"这种断言永远绿——它连"功能根本没接线"都区分不出来）。 */
  {
    const vchk = await cdp.evaluate(`(async () => {
      const html = await (await fetch('/?probe=' + Date.now(), { cache: 'no-store' })).text();
      const cfg = await (await fetch('/config.json', { cache: 'no-store' })).json();
      const m = /client\\.js\\?v=([0-9a-f]{4,})/.exec(html);
      const banner = document.getElementById('staleBuild');
      const loaded = (() => {
        /* 必须带路径边界：属性选择器 src*="client.js" 会先命中 vendor/mediasoup-client.js（结尾同名）。 */
        const el = Array.from(document.querySelectorAll('script[src]'))
          .find((s) => /(?:^|\\/)client\\.js\\?v=/.test(s.getAttribute('src') || ''));
        const mm = el ? /\\?v=([^&"]+)/.exec(el.getAttribute('src')) : null;
        return mm ? mm[1] : '';
      })();
      const hidden0 = banner ? banner.classList.contains('hidden') : null;
      if (typeof checkStaleBuild === 'function') checkStaleBuild({ clientjs: 'deadbeef00' });
      const hiddenStale = banner ? banner.classList.contains('hidden') : null;
      if (typeof checkStaleBuild === 'function') checkStaleBuild(cfg.assetVersions || null);
      const hiddenBack = banner ? banner.classList.contains('hidden') : null;
      return JSON.stringify({
        served: m ? m[1] : '', advertised: (cfg.assetVersions || {}).clientjs || '', loaded,
        hidden0, hiddenStale, hiddenBack,
      });
    })()`);
    const v = JSON.parse(vchk || '{}');
    ok('版本自检：index.html 的 ?v= 是服务器按内容哈希改写的，且与 /config.json 下发的一致',
      !!v.served && v.served === v.advertised && v.loaded === v.served,
      `served=${v.served} advertised=${v.advertised} loaded=${v.loaded}`);
    ok('版本自检：版本一致时横幅必须藏着，人为造不一致要出现、恢复后要消失',
      v.hidden0 === true && v.hiddenStale === false && v.hiddenBack === true,
      `一致=${v.hidden0} 不一致=${v.hiddenStale} 恢复=${v.hiddenBack}`);
  }

  /* ★ 2026-10-06 观测面板的数字滚动（CountUp 移植）端到端一次。
   *   ▎为什么去 dashboard 而不是在会议页里造：这块面板本来就是 dashboard 的；
   *     而 render() 是页面自己的全局函数，直接喂一份合成快照就能验**接线**
   *     （data-v → runCountUps → countStep → DOM），不需要 admin token、不需要真开会。
   *   ▸ 两次 render：先 3 再 7。若只是"把新值写进去"，第一次读就该是 7；
   *     先读到不是 7、800ms 后正好读到 7，才证明中间真的在滚（并且收尾落在终值上，
   *     那条由 countup.js 的单测保证，这里只保证"接到了这条链上"）。 */
  await cdp.navigate(`${URL_}dashboard`);
  await sleep(900);
  const cu = await cdp.evaluate(`(() => {
    if (typeof render !== 'function' || typeof COUNTUP === 'undefined') return JSON.stringify({ err: 'render/COUNTUP 不在页面上' });
    const snap = (answers) => ({ rooms: [], worker: { pid: 1 }, recordingCount: 0,
      collab: { answers, roomControl: { 'board-open': 2 }, board: { stroke: 1 }, throttled: {}, asr: {}, asrEngine: 'qwen-local',
        capLat: { sum: 2000, n: 1, max: 2000 }, speakLat: { sum: 0, n: 0, max: 0 } } });
    render(snap(3));
    render(snap(7));
    const el = document.querySelector('.cnt[data-k="answers"]');
    const mid = el ? el.textContent : '';
    return new Promise((res) => setTimeout(() => res(JSON.stringify({
      mid, end: el ? el.textContent : '', ctrl: typeof COUNTUP.countStep === 'function',
    })), 900));
  })()`);
  {
    const c = JSON.parse(cu || '{}');
    ok('观测面板的数字真的在滚：刚从 3 改成 7 时不是 7，900ms 后正好落在 7',
      !c.err && c.ctrl === true && c.mid !== '7' && c.end === '7',
      c.err || `中途读到 "${c.mid}" · 终值 "${c.end}"`);
  }

  /* ── ★ 2026-10-07 第 50 步：分段控件那块"会滑的墨"（侧栏 tab 金线 + 视图切换底片）
   *   ▎先回会议页：上一条 CountUp 断言为了量观测面板的数字，把页面导航到了 /dashboard，
   *     而侧栏/视图切换在面板上根本不存在——不在那里测（第一版就在这儿连红四条，
   *     红的是"我站在哪一页"，不是产品）。
   *   ▎为什么必须真浏览器：这块东西的全部意义是"从 A 滑到 B"，
   *     冒烟桩没有布局引擎，量不到 transform，也量不到它到底盖在哪一颗按钮下面。
   *   ▎三条断言各管一种坏法：
   *     ① 墨不存在 / 没测过位置（首帧 0 宽）——功能根本没接上；
   *     ② 切换后 transform 没变——"滑"是假的，还是跳变；
   *     ③ 墨的水平中心落在当前选中那颗的范围内——**错位**（最可能出现又最难发现的坏法：
   *        窄屏换行、字体加载完宽度变化、抽屉展开都会让它偏）。 */
  await cdp.navigate(START_URL);
  await cdp.waitForLoad(15000);
  await sleep(1200);
  const inkA = await cdp.evaluate(`(() => {
    const bar = document.querySelector('.side-tabs');
    const ink = bar && bar.querySelector('.seg-ink');
    if (!ink) return { miss: true };
    const before = getComputedStyle(ink).transform;
    const tabs = [...bar.querySelectorAll('.side-tab')];
    const chat = tabs.find((t) => t.dataset.side === 'chat');
    if (chat) chat.click();
    return { before, measured: !ink.hasAttribute('data-unmeasured'), w: ink.getBoundingClientRect().width };
  })()`);
  await sleep(420);   // 过渡 0.34s，给它滑完
  const inkB = await cdp.evaluate(`(() => {
    const bar = document.querySelector('.side-tabs');
    const ink = bar && bar.querySelector('.seg-ink');
    const act = bar && bar.querySelector('.side-tab.active');
    if (!ink || !act) return { miss: true };
    const i = ink.getBoundingClientRect(), a = act.getBoundingClientRect();
    return { after: getComputedStyle(ink).transform, centerInk: i.left + i.width / 2,
             centerTab: a.left + a.width / 2, tabLeft: a.left, tabRight: a.right,
             h: i.height, state: ink.getAttribute('data-state') };
  })()`);
  ok('侧栏的墨被量到了位置（首帧没量过之前保持不可见，不露一个 0 宽的小方块）',
    !inkA.miss && !inkB.miss && inkA.measured === true && inkA.w > 8,
    JSON.stringify({ measured: inkA.measured, w: Math.round(inkA.w || 0) }));
  ok('切换 tab 后墨真的挪了位置（transform 变了——不是"这边消失那边出现"的跳变）',
    !inkB.miss && inkA.before !== inkB.after, `${String(inkA.before).slice(0, 22)} → ${String(inkB.after).slice(0, 22)}`);
  ok('墨居中对齐当前选中的那颗 tab（窄屏换行/字体变宽都不会让它偏到隔壁）',
    /* 容差 3px：金线只占按钮宽度的 56%，中心是 `x + (w - lineW)/2` 再取整，
       亚像素舍入天然会差 1~2px；超过这个量才是真的错位（隔壁那颗的宽度是 98px）。 */
    !inkB.miss && Math.abs(inkB.centerInk - inkB.centerTab) <= 3 && inkB.h > 0,
    !inkB.miss ? `墨中心 ${Math.round(inkB.centerInk)} vs tab 中心 ${Math.round(inkB.centerTab)}` : '元素没找到');
  /* 视图切换那一颗（底片形态）：与侧栏共用同一个 moveSegInk，接错选择器就会静默不动 */
  const inkC = await cdp.evaluate(`(() => {
    const bar = document.getElementById('viewBar');
    const ink = bar && bar.querySelector('.seg-ink--plate');
    if (!ink) return { miss: true };
    const b0 = getComputedStyle(ink).transform;
    const sp = document.getElementById('viewSpeakerBtn');
    const ga = document.getElementById('viewGalleryBtn');
    /* 点"当前不是选中的那一颗"——这一轮检查前面已经为 View Transitions 那条断言
       点过一次演讲者，再点同一颗就是"没有变化"，于是"墨挪没挪"根本无从判起
       （判据要能红：先保证真的发生了它该响应的那个变化，坑 63 同一条纪律）。 */
    const target = sp && sp.classList.contains('active') ? ga : sp;
    if (target) target.click();
    return { b0, plate: ink.className.includes('seg-ink--plate'),
             clicked: target ? target.id : '(无)', act0: (bar.querySelector('.view-btn.active') || {}).id || '' };
  })()`);
  /* 视图切换那一颗：点击后**轮询到停住**再判（不是睡一个固定值）。
   *   ▎为什么这里特别容易撞：这一颗按钮的 .active 类是在 View Transition 的回调里翻的
   *     （applyLayout 包了 startViewTransition），比侧栏晚一到几帧，
   *     墨要等 MutationObserver 重排 + 0.34s 过渡才到位——固定 420ms 实测不够。
   *   ▎为什么先等"选中真的换了"再谈对齐：第一版没这条，点击后 .active 还挂在旧按钮上时
   *     墨与"当前选中"当然严丝合缝，于是断言以 moved:false 的方式红——
   *     分不清是"没切换"还是"切了但墨没跟"。**判"跟着动"之前必须先判"它动了"**（坑 63）。 */
  let inkD = null;
  const tInk = Date.now();
  while (Date.now() - tInk < 2500) {
    inkD = await cdp.evaluate(`(() => {
      const bar = document.getElementById('viewBar');
      const ink = bar && bar.querySelector('.seg-ink--plate');
      const act = bar && bar.querySelector('.view-btn.active');
      if (!ink || !act) return { miss: true };
      const i = ink.getBoundingClientRect(), a = act.getBoundingClientRect();
      return { b1: getComputedStyle(ink).transform, act1: act.id,
               dx: Math.abs((i.left + i.width / 2) - (a.left + a.width / 2)),
               covers: i.width >= a.width - 2 && i.height >= a.height - 2,
               iw: Math.round(i.width), aw: Math.round(a.width) };
    })()`);
    if (inkD.miss) break;
    if (inkD.act1 !== inkC.act0 && inkD.dx <= 3 && inkD.covers) break;
    await sleep(150);
  }
  ok('视图切换那块底片同样跟着滑，并且**盖住整颗按钮**（底片形态只对齐中心是不够的）',
    !inkD.miss && inkD.act1 !== inkC.act0 && inkC.b0 !== inkD.b1 && inkD.dx <= 3 && inkD.covers === true,
    JSON.stringify({ clicked: inkC.clicked, act0: inkC.act0, act1: inkD.act1, moved: inkC.b0 !== inkD.b1, dx: Math.round(inkD.dx || -1), covers: inkD.covers, inkW: inkD.iw, btnW: inkD.aw, waitedMs: Date.now() - tInk }));

  cdp.kill();
  const bad = results.filter((x) => !x.pass).length;
  console.log(bad ? `\n❌ ${bad} 项未过` : '\n🎉 这一轮视觉改动在真浏览器里全部成立');
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error(`\n❌ 检查失败：${e && e.message}`);
  process.exit(1);
});
