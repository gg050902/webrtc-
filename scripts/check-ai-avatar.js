#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 *  check-ai-avatar.js —— AI 助理"动态效果"的真浏览器验证（用户点名：
 *  "AI 助理的动态效果还是没有变化"——本检查就是回答这一句的证据）
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎为什么必须真浏览器：这一整套动效 = CSS 关键帧动画 + JS 随机调度器。
 *   冒烟桩里 getComputedStyle 只回静态值、setTimeout 链也不按真实帧率走——
 *   **桩只能证明"类加上了"，证不了"画面真的在动"**（坑 76 同一条纪律：
 *   机制"存在"不等于机制"生效"）。所以这里开真无头浏览器，装 100ms 采样器，
 *   直接读 computed animationName 与 transform 矩阵说话。
 * ▎量五组（对应五类动效，全部是"用户能看到"的东西）：
 *   ① 结构：头是**内联 SVG**（五代矢量脸，位图 img 整体退役——AI 生成的 Q 版位图
 *      怎么修帧都有"生成图味"，是"能不能做得像个人做的"那条意见的病根）；五官元素齐全；
 *      圆盘正方形、不溢出格子、不压名牌（当年截图实测踩过，三条都钉住）。
 *   ② 呼吸：calm 段 transform 的 m11 有 >0.008 的起伏（aiBreath 5.4s 循环）。
 *   ③ 小动作：7~14s 随机调度器真的会演一次性动作（g-* 类出现 → transform 偏离
 *      单位矩阵 → 类被摘），且不止一个动作名（"不要一直重复一个动作"的判据）。
 *   ④ 眨眼：calm 段 .av-eye 跑 avBlink 慢循环（说话时人也眨眼，JS 不停它）。
 *   ⑤ 状态律动：发一条 @ai 问题 → thinking（aiThinkLook + 瞳孔上抬眉毛下压）
 *      → speaking（.av-mouth 跑 avTalk 变形动画 + 根 svg 只有呼吸不叠整脸动画
 *      + 屏幕像素量嘴部 Δ≥5）→ 字幕逐字打出 → 自动回稳。
 *   ⑥ 全场汇总：整场至少出现 2 种表情状态类（= 表情真的在变，不是一张脸晃来晃去）。
 * ▎防假绿两件：带 ?nosw=1（坑 40）；双指纹——client.js 查 armAiGestures/
 *   g-breath-deep，style.css 查 aiBreath/g-nod（SW 对 CSS 与 JS 的缓存互相独立，
 *   一条指纹防不住两件事）。开跑前删掉自己这一档的 profile（坑 72 家族）。
 * ▎跑法：npm run check:avatar（先起服务器；专用端口用 CHECK_URL 指过去）。
 *   集成进 check:all 时由 runner 传 CHECK_URL 与专属 WB_CDP_PORT。
 * ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const os = require('os');
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

(async () => {
  /* 清自己这一档的 profile：上一轮留下的 SW/缓存会决定"这一轮要不要跳"（坑 72） */
  const port = Number(process.env.WB_CDP_PORT) || 9333;
  try { fs.rmSync(path.join(os.tmpdir(), 'wb-remote-desktop-profile-' + port), { recursive: true, force: true }); } catch (e) { /* 清不掉不致命 */ }

  const cdp = new Cdp({
    headless: true, startUrl: START_URL, windowSize: { width: 1280, height: 860 },
    extraArgs: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  await cdp.launch();
  await cdp.waitForLoad(15000);
  await sleep(1200);

  async function waitJs(expr, timeout = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      let v = null;
      try { v = await cdp.evaluate(expr); } catch (e) { v = null; }
      if (v && v !== 0 && v !== '' && v !== false) return v;
      await sleep(300);
    }
    return '';
  }

  /* ★ 2026-10-06 脸部**屏幕**取样（第三版量具；前两版都被自己的 A/B 推翻，教训写在下面）。
   *   ▎第一版「截那块矩形，700ms 后比像素」：A/B 把 speaking 素材换成静帧（= 用户说的"定格的脸"），
   *     它仍然报 Δ嘴部 38.4 —— 绿的，**量具是假的**。因为那块矩形里动着波形条 .ai-waves
   *     和逐字字幕 .ai-speech，量到的是**别人的动**。
   *   ▎第二版「ctx.drawImage(img) 取当前帧」：换成动图后连采四次恒为 Δ0 —— 也是假的，
   *     Chrome 的 drawImage 只画动画的**第一帧**，它根本看不见屏幕上正在播的帧。
   *   ▸ 现在这样做，三件事一起才成立：
   *     ① 截屏（看的是合成后真的显示出来的东西），但**先把会动的邻居临时藏掉**，
   *        测完在 finally 里原样恢复（检查不得把页面弄坏——量具不许污染被测物）；
   *     ② 同时量一块**对照组**（额头/头发：表情不会动那里），
   *        判据取 `嘴部差 − 对照差`：一圈呼吸光晕整体变亮时两块一起变，差值≈0；
   *        只有嘴真的在动，差值才拉开。这一刀让"整块在闪"冒充不了"表情在变"。
   *     ③ 阈值由 A/B 定：静帧素材在同一套隔离与对照下测到的差值是多少，阈值就压在它之上。 */
  async function pngDiffThree(a, b) {
    const expr = `(async () => {
      const load = (d) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('解码失败')); im.src = 'data:image/png;base64,' + d; });
      let ia, ib;
      try { const rs = await Promise.all([load(${JSON.stringify(a)}), load(${JSON.stringify(b)})]); ia = rs[0]; ib = rs[1]; }
      catch (e) { return JSON.stringify({ err: String(e.message || e) }); }
      const W = Math.min(ia.width, ib.width), H = Math.min(ia.height, ib.height);
      if (W < 8 || H < 8) return JSON.stringify({ err: '截图太小 ' + W + 'x' + H });
      const px = (im) => { const c = document.createElement('canvas'); c.width = W; c.height = H;
        const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, W, H); return g.getImageData(0, 0, W, H).data; };
      const pa = px(ia), pb = px(ib);
      const box = (x0, x1, y0, y1) => { let s = 0, cnt = 0, ch = 0;
        for (let y = Math.floor(y0 * H); y < Math.ceil(y1 * H); y++) for (let x = Math.floor(x0 * W); x < Math.ceil(x1 * W); x++) {
          const i = (y * W + x) * 4;
          for (let k = 0; k < 3; k++) { const d = Math.abs(pa[i + k] - pb[i + k]); s += d; cnt++; if (d > 12) ch++; } }
        return { mean: +(s / cnt).toFixed(2), pct: +(100 * ch / cnt).toFixed(1) }; };
      return JSON.stringify({ size: W + 'x' + H,
        whole: box(0, 1, 0, 1),
        /* ★ 2026-10-07 五代量嘴框（SVG 矢量脸，viewBox 0 0 200 200）：
         *   .av-mouth 闭嘴位 x 83~117 / y 125~138；avTalk 峰值 scaleY≈2 向上摊开。
         *   框取 x 0.38~0.62 / y 0.58~0.78，闭→咧两相都罩得住。 */
        mouth: box(0.38, 0.62, 0.58, 0.78),
        control: box(0.30, 0.70, 0.04, 0.30) });
    })()`;
    const s = await cdp.evaluate(expr, 30000).catch(() => '');
    try { return JSON.parse(s); } catch (e) { return { err: '取值失败' }; }
  }
  async function faceScreenFrames(state, n = 4, gapMs = 400) {
    const tileSel = '.ai-tile' + (state ? '.' + state : '');
    const setup = await cdp.evaluate(`(() => {
      const tile = document.querySelector(${JSON.stringify(tileSel)});
      const f = tile && tile.querySelector('.ai-face');
      if (!f) return JSON.stringify({ err: '找不到 ' + ${JSON.stringify(tileSel)} + ' .ai-face' });
      /* 隔离：把"不是脸本身"会动的东西全部按停 ——
       *   .ai-waves 波形条 / .ai-speech 逐字字幕（都在同一块矩形里动）
       *   .ai-face 与 .ai-face-wrap 的 animation/transform/filter（呼吸缩放、说话律动、
       *   以及 **音频驱动的 --ai-amp 亮度律动**：client.js 每次音量帧都 setProperty('--ai-amp')，
       *   它会让一张**定格的脸**也逐帧变色——A/B 就是这么把我骗过去的：换成静帧仍读到 Δ15.5）。
       *   ★ 2026-10-07 五代补充：.ai-face *（眨眼 avBlink 在眼睛元素上，不按停它会
       *   让"地板≠0"——嘴框虽碰不到眼睛，纪律上 isolation 必须覆盖全部动画元素）。
       *   ★ 但要测的那一项必须放行：量 speaking 的嘴时，.av-mouth 的 avTalk
       *   是被测信号本身——按停它 = 量具把信号杀了再报"没有信号"（本轮真踩过：
       *   隔离全开后嘴 Δ0/0%，avTalk 明明在跑）。 */
      const st = document.createElement('style');
      st.id = '__faceProbeStyle';
      const kill = ${JSON.stringify(state === 'speaking' ? ':not(.av-mouth)' : '')};
      st.textContent = '.ai-tile .ai-face, .ai-tile .ai-face-wrap, .ai-tile .ai-face *' + kill
        + ' { animation: none !important; transform: none !important; filter: none !important; transition: none !important; }';
      document.head.appendChild(st);
      const hidden = [];
      for (const el of tile.querySelectorAll('.ai-waves, .ai-speech')) { hidden.push({ el, prev: el.style.visibility }); el.style.visibility = 'hidden'; }
      window.__faceProbe = hidden;
      const r = f.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height),
        svg: f.namespaceURI && f.namespaceURI.indexOf('svg') >= 0 ? 1 : 0, hidden: hidden.length });
    })()`).catch(() => '');
    const g = JSON.parse(setup || '{}');
    if (!g.width) return { err: g.err || '没量到矩形' };
    const shots = [];
    try {
      for (let i = 0; i < n; i++) {
        shots.push((await cdp.screenshot({ format: 'png', clip: { x: g.x, y: g.y, width: g.width, height: g.height } })).toString('base64'));
        if (i < n - 1) await sleep(gapMs);
      }
    } catch (e) {
      return { err: '截图失败 ' + (e.message || e) };
    } finally {
      /* 恢复现场：临时样式表与 visibility 一律还原——检查不得把页面弄坏（坑 84 同一条纪律：
       * 观测手段不许改变被测对象的状态，改变了一定要成对恢复）。 */
      await cdp.evaluate(`(() => {
        const h = window.__faceProbe || [];
        for (const x of h) { try { x.el.style.visibility = x.prev || ''; } catch (e) { /* 元素可能已被换掉 */ } }
        window.__faceProbe = null;
        const st = document.getElementById('__faceProbeStyle'); if (st) st.remove();
      })()`).catch(() => {});
    }
    const ds = [];
    for (let i = 1; i < shots.length; i++) {
      const d = await pngDiffThree(shots[0], shots[i]);
      if (d && d.err) return { err: d.err };
      ds.push(d);
    }
    const spread = (f) => Math.max.apply(null, ds.map(f));
    return { svg: g.svg, hidden: g.hidden, size: ds.length ? ds[0].size : '-', ds,
      maxMouth: spread((d) => d.mouth.mean), maxControl: spread((d) => d.control.mean),
      net: +(spread((d) => d.mouth.mean) - spread((d) => d.control.mean)).toFixed(2),
      maxMouthPct: spread((d) => d.mouth.pct) };
  }
  async function askAi(text) {
    await cdp.evaluate(`(() => {
      const i = document.getElementById('chatInput');
      i.value = ${JSON.stringify('@ai ' + text)};
      i.dispatchEvent(new Event('input', { bubbles: true }));
      const b = document.getElementById('chatSendBtn');
      if (b) b.click();
    })()`);
  }
  /* ★ 2026-10-07 五代：assetDiffs（三张静态位图两两比像素）随位图素材整体退役——
   *   "表情是不是三只不同的脸"在矢量时代由五官元素的变形断言覆盖。 */
  async function askAi(text) {
    await cdp.evaluate(`(() => {
      const i = document.getElementById('chatInput');
      i.value = ${JSON.stringify('@ai ' + text)};
      i.dispatchEvent(new Event('input', { bubbles: true }));
      const b = document.getElementById('chatSendBtn');
      if (b) b.click();
    })()`);
  }
  async function pixelDiff(a, b) {
    const expr = `(async () => {
      const load = (d) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('解码失败')); im.src = 'data:image/png;base64,' + d; });
      let ia, ib;
      try { const rs = await Promise.all([load(${JSON.stringify(a)}), load(${JSON.stringify(b)})]); ia = rs[0]; ib = rs[1]; }
      catch (e) { return JSON.stringify({ err: String(e.message || e) }); }
      const W = Math.min(ia.width, ib.width), H = Math.min(ia.height, ib.height);
      if (W < 8 || H < 8) return JSON.stringify({ err: '截图太小 ' + W + 'x' + H });
      const px = (im) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, W, H); return g.getImageData(0, 0, W, H).data; };
      const pa = px(ia), pb = px(ib);
      const stat = (x0, x1, y0, y1) => { let sum = 0, cnt = 0, ch = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4;
          for (let k = 0; k < 3; k++) { const d = Math.abs(pa[i + k] - pb[i + k]); sum += d; cnt++; if (d > 12) ch++; } }
        return { mean: +(sum / cnt).toFixed(2), pct: +(100 * ch / cnt).toFixed(1) }; };
      return JSON.stringify({ size: W + 'x' + H,
        whole: stat(0, W, 0, H),
        mouth: stat(Math.floor(W * 0.28), Math.ceil(W * 0.72), Math.floor(H * 0.5), Math.ceil(H * 0.92)) });
    })()`;
    const s = await cdp.evaluate(expr, 30000);
    try { return JSON.parse(s); } catch (e) { return { err: '取值失败' }; }
  }

  /* ── 双指纹：页面自己 no-store 拉两份源码，证明跑的是当前版本（坑 40） ── */
  const fp = await cdp.evaluate(`(async () => {
    const js = await (await fetch('client.js', { cache: 'no-store' })).text();
    const css = await (await fetch('style.css', { cache: 'no-store' })).text();
    return {
      js: js.indexOf('armAiGestures') >= 0 && js.indexOf('g-breath-deep') >= 0,
      css: css.indexOf('aiBreath') >= 0 && css.indexOf('g-nod') >= 0,
      jsBytes: js.length, cssBytes: css.length,
    };
  })()`);
  ok('页面加载的是当前 client.js（小动作调度器）与 style.css（呼吸/小动作关键帧），不是 SW 缓存',
    fp && fp.js === true && fp.css === true, `js=${fp && fp.jsBytes}B css=${fp && fp.cssBytes}B`);
  if (!(fp && fp.js && fp.css)) {
    console.log('\n   服务器没在跑或页面吃缓存。先起服务：npm run start:sfu');
    cdp.kill(); process.exit(1);
  }

  /* ── 进房（与 e2e 同款动线：游客 → 预览 → 进房 → 建房） ── */
  await cdp.evaluate(`(() => { const b = document.getElementById('authGuestBtn'); if (b) b.click(); })()`);
  await waitJs(`!document.getElementById('prejoin').classList.contains('hidden') ? 1 : 0`, 15000);
  await sleep(1200);
  await cdp.evaluate(`(() => { const b = document.getElementById('pjEnterBtn'); if (b) b.click(); })()`);
  await waitJs(`!document.getElementById('roomPanel').classList.contains('hidden') ? 1 : 0`, 15000);
  await sleep(500);
  await cdp.evaluate(`(() => { const b = document.getElementById('createBtn'); if (b) b.click(); })()`);
  const roomText = await waitJs(`(document.getElementById('roomBadge').textContent || '').match(/\\d{6}/) ? document.getElementById('roomBadge').textContent : ''`, 15000);
  const ROOM = (String(roomText).match(/\d{6}/) || [])[0];
  ok('建房拿到 6 位房间号（AI 问答就在这个房间里发生）', !!ROOM, ROOM ? '房间 ' + ROOM : '没拿到号');
  if (!ROOM) { cdp.kill(); process.exit(1); }

  /* 预静音：假麦克风是持续音调，关掉省得服务端 ASR 拿它去转写（本检查不听声音） */
  await cdp.evaluate(`(() => { const b = document.getElementById('muteBtn'); if (b && (b.getAttribute('aria-label') || '') === '静音') b.click(); })()`).catch(() => { });
  await sleep(400);

  /* ── AI 入会：点「🤖 AI」→ 服务器 room-state 带 isBot → 客户端 syncAiTile 建格 ── */
  await cdp.evaluate(`(() => { const b = document.getElementById('aiBtn'); if (b) b.click(); })()`);
  const tileUp = await waitJs(`document.querySelector('.video-box.ai-tile .ai-face') ? 1 : 0`, 20000);
  ok('点「AI」后 AI 助理格子进入视频网格（虚拟参会者真的"看得见"）', tileUp === 1);
  if (tileUp !== 1) { cdp.kill(); process.exit(1); }

  /* ── ① 结构：SVG 矢量脸 + 几何（三条旧账全部钉住） ── */
  const svgN = await waitJs(`(() => { const f = document.querySelector('.ai-tile .ai-face'); return f && f.namespaceURI && f.namespaceURI.indexOf('svg') >= 0 ? 1 : 0; })()`, 15000);
  ok('头像是内联 SVG（五代矢量脸，不是位图 img——"AI 味/重影"的病根随素材层一起退役）', svgN === 1);

  const geo = await cdp.evaluate(`(() => {
    const t = document.querySelector('.video-box.ai-tile');
    const w = t.querySelector('.ai-face-wrap');
    const i = t.querySelector('.ai-face');
    const l = t.querySelector('.video-label');
    const r = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
    const T = r(t), W = r(w), L = r(l);
    return {
      eyes: i.querySelectorAll('.av-eye').length,
      brows: i.querySelectorAll('.av-brow').length,
      mouth: !!i.querySelector('.av-mouth'),
      imgs: i.querySelectorAll('img').length,
      wrapW: W.w, wrapH: W.h,
      inL: W.l - T.l, inT: W.t - T.t, inR: T.r - W.r, inB: T.b - W.b,
      coverLabel: W.b - L.t,
    };
  })()`);
  ok('SVG 五官齐全（眼×2 眉×2 嘴×1——状态变形靠它们，缺一个状态就演不出来）',
    geo && geo.eyes === 2 && geo.brows === 2 && geo.mouth, geo ? `眼${geo.eyes} 眉${geo.brows} 嘴${geo.mouth ? '有' : '无'}` : 'no svg');
  ok('SVG 里没有任何位图 img（结构上没有叠印源，重影的根治是结构性的）',
    geo && geo.imgs === 0, geo ? `img=${geo.imgs}` : '');
  ok('圆盘是正方形（|w-h|≤2px——扁格里按宽度定尺寸会裁头顶，旧账）',
    geo && Math.abs(geo.wrapW - geo.wrapH) <= 2, geo ? `${Math.round(geo.wrapW)}×${Math.round(geo.wrapH)}` : '');
  ok('圆盘不溢出视频格（四条内边距都 ≥ -1px）',
    geo && geo.inL >= -1 && geo.inT >= -1 && geo.inR >= -1 && geo.inB >= -1,
    geo ? `L${Math.round(geo.inL)} T${Math.round(geo.inT)} R${Math.round(geo.inR)} B${Math.round(geo.inB)}` : '');
  ok('圆盘不压名牌（wrap 底边停在 label 顶边之上）',
    geo && geo.coverLabel <= 2, geo ? `重叠 ${Math.round(geo.coverLabel)}px` : '');

  /* ── 装 100ms 采样器：之后所有"动没动"的断言都从这批样本算 ── */
  await cdp.evaluate(`(() => {
    window.__aiSamples = []; window.__aiPulled = 0;
    window.__aiSampler = setInterval(() => {
      const t = document.querySelector('.video-box.ai-tile');
      const f = document.querySelector('.video-box.ai-tile .ai-face');
      const mo = document.querySelector('.video-box.ai-tile .av-mouth');
      const eye = document.querySelector('.video-box.ai-tile .av-eye-l');
      const sp = document.querySelector('.video-box.ai-tile .ai-speech');
      if (!t || !f) { window.__aiSamples.push({ ts: Date.now(), miss: 1 }); return; }
      const cs = getComputedStyle(f);
      const cmo = mo ? getComputedStyle(mo) : null;
      const ceye = eye ? getComputedStyle(eye) : null;
      window.__aiSamples.push({
        ts: Date.now(),
        tile: t.className,
        /* ★ 2026-10-07 五代（SVG）：f.className 在 SVG 上是 SVGAnimatedString 不是字符串，
         *   必须 getAttribute('class')——直接用 className 会把 RegExp test 变恒假。 */
        face: f.getAttribute('class') || '',
        anim: cs.animationName, tf: cs.transform,
        /* 五代判据：没有 src 可采——"换脸"证据 = tile 状态类（speaking/thinking/happy，
         *   cls() 从 tile 类名上读）；嘴真的在张合 = .av-mouth 的 avTalk 动画名。 */
        moAnim: cmo ? cmo.animationName : null,
        moTf: cmo ? cmo.transform : null,
        eyeAnim: ceye ? ceye.animationName : null,
        spShow: sp ? sp.classList.contains('show') : false,
        spLen: sp ? (sp.textContent || '').length : -1,
      });
    }, 100);
    return 'ok';
  })()`);

  const all = [];
  async function syncSamples() {
    try {
      const arr = await cdp.evaluate(`(() => { const a = window.__aiSamples.slice(window.__aiPulled); window.__aiPulled = window.__aiSamples.length; return a; })()`);
      if (Array.isArray(arr)) all.push(...arr);
    } catch (e) { /* 页面忙时可能超时，下一拍再拉 */ }
  }
  async function waitFor(pred, timeoutMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      await syncSamples();
      if (pred(all)) return true;
      await sleep(250);
    }
    await syncSamples();
    return pred(all);
  }
  const cls = (s, name) => new RegExp('(^|\\s)' + name + '(\\s|$)').test(s || '');
  const isCalm = (s) => s && !s.miss && !cls(s.tile, 'speaking') && !cls(s.tile, 'thinking') && !cls(s.tile, 'happy');
  const gOf = (s) => { const m = /(?:^|\s)(g-[a-z-]+)/.exec((s && s.face) || ''); return m ? m[1] : ''; };
  const m11 = (tf) => { const m = /matrix\(([^)]+)\)/.exec(tf || ''); return m ? parseFloat(m[1].split(',')[0]) : null; };
  const isIdentity = (tf) => {
    const m = /matrix\(([^)]+)\)/.exec(tf || '');
    if (!m) return tf === 'none';
    return m[1].split(',').map((x) => parseFloat(x)).every((v, i) => Math.abs(v - (i === 0 || i === 3 ? 1 : 0)) < 0.001);
  };
  try { fs.mkdirSync(OUT, { recursive: true }); } catch (e) { /* 建不出后面截图会报 */ }

  /* ── ② 呼吸：等入会致辞/接入播报落定，在 calm 段观察 ── */
  console.log('   ⏳ 等入会致辞（若有）落定到 calm …');
  await waitFor((a) => { const last = a[a.length - 1]; return isCalm(last); }, 30000);
  await sleep(1300); // 先攒一段（下面再采满一整个周期）
  await syncSamples();
  /* 呼吸断言：aiBreath 是 scale(1)→scale(1.014)、5.4s 的常驻循环——采满 ≥6.5s
   * 保证跨过一整个周期（含上升沿与下降沿），再量 m11 的起伏。
   * 阈值 0.008 ≈ 半幅（0.014/2）：既排除"动画名在、但 transform 纹丝不动"的
   * 假死（坑 76 同一条纪律），也不会因采样相位差一点就假红。 */
  console.log('   ⏳ 采样呼吸起伏（5.4s 周期，采 6.5s）…');
  const markB = all.length;
  await sleep(6500);
  await syncSamples();
  const bWin = all.slice(markB).filter((s) => isCalm(s) && m11(s.tf) !== null);
  const m11s = bWin.map((s) => m11(s.tf));
  const bLo = m11s.length ? Math.min(...m11s) : 0, bHi = m11s.length ? Math.max(...m11s) : 0;
  ok('calm 段呼吸真的在动（aiBreath 5.4s 循环：m11 起伏 >0.008，不是"动画名挂着但纹丝不动"）',
    bWin.length >= 30 && bHi - bLo > 0.008 && bWin.some((s) => /aiBreath/.test(s.anim || '')),
    `样本 ${bWin.length} 个 · m11 ${bLo.toFixed(4)}→${bHi.toFixed(4)}（起伏 ${(bHi - bLo).toFixed(4)}）`);
  try { fs.writeFileSync(path.join(OUT, 'ai-avatar-idle.png'), await cdp.screenshot({ format: 'png' })); } catch (e) { /* 截图失败不致命 */ }

  /* ★ 2026-10-06 量具地板（安静期）：faceScreenFrames 已把呼吸/律动/眨眼/音频光晕按停，
   *   这时候 SVG 五官全部静止，屏幕上就不该有任何东西在动 → 读数≈0。
   *   ▎为什么单独占一条：speaking 那条红线（Δ≥5）只有在"不动时读 0"的前提成立时才叫测量。
   *     本机实测 Δ0；上限留到 8 是给重排/亚像素重绘的余地，不是给"其实一直在动"的余地。
   *   ▸ 前提断言换成"测的确实是 SVG 脸"（五代没有"素材是静帧"这个概念了）。 */
  const frIdle = await faceScreenFrames('', 4, 300);
  ok('量具地板：安静期（律动/眨眼已按停）屏幕嘴部差 ≤8 —— 这就是"没有表情变化"时的读数',
    !!frIdle && !frIdle.err && frIdle.svg === 1 && frIdle.maxMouth <= 8,
    frIdle && !frIdle.err ? `svg=${frIdle.svg} · 嘴 Δ${frIdle.maxMouth} 对照 Δ${frIdle.maxControl}`
      : `没量到：${(frIdle && frIdle.err) || '取值失败'}`);
  /* ★ 2026-10-07 五代：眨眼是常驻 CSS 动画（说话时人也眨眼，JS 不停它）——
   *   采样器在 calm 段应能抓到 avBlink 动画名；同时眨眼不该出现在量具隔离里
   *   （地板断言已把 .ai-face * 按停，两条各管一段）。 */
  {
    const calmAll = all.filter((s) => isCalm(s));
    ok('眨眼常驻（calm 段 .av-eye 跑 avBlink 慢循环——齐眨像机器，错开 20ms 才像生物）',
      calmAll.some((s) => /avBlink/.test(s.eyeAnim || '')),
      `calm 样本 ${calmAll.length} 个 · eyeAnim 例 ${(calmAll.find((s) => s.eyeAnim) || {}).eyeAnim || '(无)'}`);
  }

  /* ── ③ 小动作：7~14s 随机调度器，等第一个动作 + 变化性 ── */
  console.log('   ⏳ 等随机小动作（调度器间隔 7~14s）…');
  const markG = all.length;
  const g1on = await waitFor((a) => a.slice(markG).some((s) => !s.miss && gOf(s)), 36000);
  ok('小动作调度器真的会演（36s 内出现 g-* 一次性动作类）', g1on);
  let gName1 = '';
  if (g1on) {
    /* ★ 检出点在"动作第一拍"——waitFor 一看到首个 g-* 样本就返回，那一刻窗口
     * 里只有 1 个样本，而所有一次性动作的关键帧都以 0% { transform: 单位矩阵 }
     * 起步（style.css：g-tilt 1.5s / g-nod 1.05s / …，峰值在 25%~45%）→ 单样本
     * 恒定为单位矩阵，"画面真的在动"会被误判成"加了类但没动"（2026-10-05
     * check:all 实测抓到：窗口 0.1s · g-tilt · tf 例 undefined——采样器没病，
     * 是取窗取在了动画起点）。等 500ms 让动作演进到中段再取窗：最短的 g-nod
     * 在 400~750ms 处有 ≥0.5px 位移、g-tilt 有 ≥0.7° 旋转，都远过 0.001 阈值；
     * 500ms 也小于最短动作时长 1.05s，不会等到动作消失。 */
    await sleep(500);
    await syncSamples();
    const seg1 = all.slice(markG);
    const gf = seg1.find((s) => !s.miss && gOf(s));
    gName1 = gOf(gf);
    const gIdx = seg1.indexOf(gf);
    let gEnd = -1;
    for (let i = gIdx + 1; i < seg1.length; i++) { if (!gOf(seg1[i])) { gEnd = i; break; } }
    const gWin = gEnd > 0 ? seg1.slice(gIdx, gEnd) : seg1.slice(gIdx);
    const dev = gWin.find((s) => !isIdentity(s.tf)) || gWin[Math.min(gWin.length - 1, Math.floor(gWin.length / 2))];
    const winS = gWin.length >= 2 ? ((gWin[gWin.length - 1].ts - gWin[0].ts) / 1000).toFixed(1) : (gWin.length * 0.1).toFixed(1);
    ok('小动作期间 transform 偏离单位矩阵（不是"加了类但没动"——坑 76 纪律）',
      gWin.some((s) => !isIdentity(s.tf)),
      `${gName1} · 窗口 ${winS}s · ${gWin.length} 样本 · tf 例 ${dev ? dev.tf : '(无)'}`);
    try { fs.writeFileSync(path.join(OUT, 'ai-avatar-gesture.png'), await cdp.screenshot({ format: 'png' })); } catch (e) { /* 尽力而为 */ }
    /* 动作名必须在代码里登记的池子内（六个之一） */
    ok('动作名来自登记的六池（g-nod/g-tilt/g-peek-l/g-peek-r/g-sway/g-breath-deep）',
      ['g-nod', 'g-tilt', 'g-peek-l', 'g-peek-r', 'g-sway', 'g-breath-deep'].includes(gName1), gName1);
    /* 类必须被摘掉（animationend/保险丝生效——不摘就成永久抽搐） */
    const removed = await waitFor((a) => {
      const seg = a.slice(markG);
      const fi = seg.findIndex((s) => !s.miss && gOf(s));
      return fi >= 0 && seg.slice(fi + 1).some((s) => !gOf(s));
    }, 6000);
    ok('小动作演完会把类摘掉（animationend/保险丝生效，不会永久抽搐）', removed);
  } else {
    ok('小动作期间 transform 偏离单位矩阵', false, '动作没出现');
    ok('动作名来自登记的六池', false, '动作没出现');
    ok('小动作演完会把类摘掉', false, '动作没出现');
  }

  /* 变化性：最多再看 3 个动作，凑到 ≥2 个不同动作名（"一直重复一个动作"的反例证据）。
   * 概率账：单抽重复 1/6，四个动作全同 ≈ 0.46%——以此为假红上限。 */
  let seen = new Set(gName1 ? [gName1] : []);
  let gTrace = gName1 || '(无)';
  const tG = Date.now();
  while (seen.size < 2 && seen.size <= 3 && Date.now() - tG < 80000) {
    const mark = all.length;
    const on = await waitFor((a) => a.slice(mark).some((s) => !s.miss && gOf(s)), 36000);
    if (!on) break;
    await syncSamples();
    const gf = all.slice(mark).find((s) => !s.miss && gOf(s));
    const name = gOf(gf);
    seen.add(name); gTrace += ' → ' + name;
    await waitFor((a) => {
      const seg = a.slice(mark);
      const fi = seg.findIndex((s) => !s.miss && gOf(s));
      return fi >= 0 && seg.slice(fi + 1).some((s) => !gOf(s));
    }, 6000);
  }
  ok('小动作不是"一直重复一个动作"（观察到 ≥2 个不同动作名）', seen.size >= 2, gTrace);

  /* ── ④ 状态律动：@ai 提问 → thinking → speaking（逐字）→ 回稳 ── */
  const markQ = all.length;
  const q = '@ai 用一句话介绍你自己';
  await cdp.evaluate(`(() => {
    const i = document.getElementById('chatInput');
    i.value = ${JSON.stringify(q)};
    i.dispatchEvent(new Event('input', { bubbles: true }));
    const b = document.getElementById('chatSendBtn');
    if (b) b.click();
  })()`);
  console.log('   ⏳ 已发「@ai 用一句话介绍你自己」，等 thinking → speaking …');

  const thinkSeen = await waitFor((a) => a.slice(markQ).some((s) => !s.miss && cls(s.tile, 'thinking')), 60000);
  ok('提问后进入 thinking（服务器 thinking 帧 + 类真的落到格子上）', thinkSeen);
  if (thinkSeen) {
    await syncSamples();
    const tk = all.slice(markQ).filter((s) => !s.miss && cls(s.tile, 'thinking'));
    ok('thinking 期间的动画是 aiThinkLook（"抬头想"的律动，不是呼吸）',
      tk.some((s) => /aiThinkLook/.test(s.anim || '')), `样本 ${tk.length} 个 · anim 例 ${tk[0] && tk[0].anim}`);
    try { fs.writeFileSync(path.join(OUT, 'ai-avatar-thinking.png'), await cdp.screenshot({ format: 'png' })); } catch (e) { /* 尽力而为 */ }
  } else {
    ok('thinking 期间的动画是 aiThinkLook', false, '没见到 thinking');
  }

  const speakSeen = await waitFor((a) => a.slice(markQ).some((s) => !s.miss && cls(s.tile, 'speaking')), 60000);
  ok('答案送上屏后进入 speaking（播报期律动 + 逐字字幕）', speakSeen);
  if (speakSeen) {
    await sleep(1500); // 让逐字打出一些内容
    await syncSamples();
    const spk = all.slice(markQ).filter((s) => !s.miss && cls(s.tile, 'speaking'));
    /* ★ 2026-10-07 五代判据（SVG 矢量脸）：一代整脸换 talk.webp、二代重排口型帧、
     *   三代"底脸常驻+嘴部贴片"都死于同一个根——AI 生成的位图素材本身有"生成图味"。
     *   五代换掉素材层：嘴是 .av-mouth 元素，speaking 时跑 avTalk 变形动画。钉两件可量的事：
     *     ① .av-mouth 的 animationName 是 avTalk（嘴真的在张合）；
     *     ② 根 svg 没有整脸动画叠加（一个通道一个来源：根只呼吸，嘴才开合）。 */
    ok('speaking 时 .av-mouth 在跑 avTalk 变形动画（嘴真的在张合，不是定格脸）',
      spk.some((s) => /avTalk/.test(s.moAnim || '')),
      `样本 ${spk.length} 个 · 嘴动画例 ${spk[0] && spk[0].moAnim} · 嘴矩阵例 ${spk[0] && spk[0].moTf}`);
    ok('speaking 时根 svg 只有呼吸（没有整脸动画叠在嘴上——两层节奏=10-02 重影复发）',
      spk.length > 0 && spk.every((s) => /^(aiBreath|none)$/.test(s.anim || '')),
      `根动画例 ${spk[0] && spk[0].anim}`);
    const shown = spk.filter((s) => s.spShow);
    const lens = shown.map((s) => s.spLen).filter((n) => n >= 0);
    const lo = lens.length ? Math.min(...lens) : 0, hi = lens.length ? Math.max(...lens) : 0;
    ok('格子上方字幕条逐字打出（.ai-speech.show 且文本长度在增长，不是一坨直接出现）',
      shown.length > 0 && hi > lo + 5, `show 样本 ${shown.length} · 长度 ${lo}→${hi}`);
    /* ★ 2026-10-06 直接在**屏幕像素**上量"这张脸到底动没动"（用户第四次反馈"动态效果没变化"）。
     *   ▎为什么现有断言不够：它们验的是 src 换成了口型循环、CSS 动画名对了、transform 矩阵变了。
     *     这三件事同时成立时，用户看到的仍然可能是一张**定格的脸**。
     *   ▎两版量具都被 A/B 推翻（详见文件顶部 faceScreenFrames 的注释）：截屏矩形里混着波形条
     *     与逐字字幕（换成静帧仍读 Δ38）；ctx.drawImage 又只画动画第一帧（真动图仍读 Δ0）。
     *   ▸ 现在这套：临时按停呼吸/律动/音频光晕 + 隐藏波形与字幕 → 截同一块矩形四次 → 页面内解码比像素，
     *     测完在 finally 原样恢复。地板与信号：
     *       静帧（A/B 用）Δ0 / 真口型素材 Δ14.2~27.0（三次采样，本机两轮）。
     *     红线压 10：0 与最小观测值之间，既不会因采样相位误红，也放不过"素材对但屏幕不动"。
     *   ▸ **不用 net=嘴部−对照 当判据**：这套素材连头一起动，对照组跟着变（实测 Δ22~28），
     *     net 只剩 7 上下，余量薄得像掷硬币；"整块在闪冒充表情"另有
     *     「speaking 时 .ai-face 不再跑 CSS 动画」那条守着，各司其职。 */
    /* ★ 2026-10-07 五代：采样加密与红线沿用（avTalk 周期 0.42s，6 张 @300ms 必跨
     *   "闭 → 咧"两相）；嘴框按 SVG 元素新坐标（见 pngDiffThree 注释）。 */
    const fr = await faceScreenFrames('speaking', 6, 300);
    ok('speaking 期间屏幕上的嘴部**确实在变**（截屏 Δ≥5，隔离后地板是 0；波形条与字幕已按停）',
      !!fr && !fr.err && fr.maxMouth >= 5,
      fr && !fr.err ? `svg=${fr.svg} · ${fr.size} · 嘴 Δ${fr.maxMouth}(${fr.maxMouthPct}%) 对照 Δ${fr.maxControl} · 逐次 ${fr.ds.map((x) => x.mouth.mean).join('/')}`
        : `没量到：${(fr && fr.err) || '取值失败'}`);
    try { fs.writeFileSync(path.join(OUT, 'ai-avatar-speaking.png'), await cdp.screenshot({ format: 'png' })); } catch (e) { /* 尽力而为 */ }
  } else {
    ok('speaking 时 .av-mouth 在跑 avTalk 变形动画', false, '没见到 speaking');
    ok('speaking 时根 svg 只有呼吸', false, '没见到 speaking');
    ok('格子上方字幕条逐字打出', false, '没见到 speaking');
  }

  /* ★ 2026-10-07 五代汇总判据：**整场里到底出现过几种表情状态**。
   *   位图时代的"换过几种 src"已无 src 可换——换脸证据 = tile 上的状态类；
   *   全程只见过一种类 = 状态机没生效（用户看到的就是"一张脸做位移"）。 */
  {
    const states = new Set();
    for (const s of all) {
      if (s.miss) continue;
      for (const st of ['speaking', 'thinking', 'happy']) if (cls(s.tile, st)) states.add(st);
    }
    ok('整场至少出现过 2 种表情状态类（= 表情真的在变：思考/说话/开心至少演了两样）',
      states.size >= 2, `见到：${[...states].join('、') || '(无)'}`);
  }

  const segQ = all.slice(markQ);
  const iT = segQ.findIndex((s) => !s.miss && cls(s.tile, 'thinking'));
  const iS = segQ.findIndex((s) => !s.miss && cls(s.tile, 'speaking'));
  ok('先想后说（thinking 出现在 speaking 之前）', iT >= 0 && iS >= 0 && iT < iS, `#${iT} < #${iS}`);

  const settled = await waitFor((a) => { const last = a[a.length - 1]; return isCalm(last); }, 25000);
  ok('播报结束后自动回稳 calm（状态机不会卡在 speaking）', settled);

  cdp.kill();
  const bad = results.filter((x) => !x.pass).length;
  console.log(`  截图落盘（尽力而为）：${path.join('wb-rd-shots', 'ai-avatar-{idle,gesture,thinking,speaking}.png')}`);
  console.log(bad ? `\n❌ ${bad} 项未过` : `\n🎉 AI 助理动态效果在真浏览器里全部成立（${results.length} 项）`);
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error(`\n❌ 检查失败：${e && e.message}`);
  console.error('   先确认 SFU 服务器在跑：npm run start:sfu（或用 CHECK_URL 指到测试端口）');
  process.exit(1);
});
