#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 *  check-a11y.js —— 无障碍的两条硬指标：减弱动效全覆盖 + 文字对比度达标
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎为什么值得常驻：这一轮往界面里加了非常多动效（第 29~37 节：环形脉冲、呼吸、收焦、
 *   升起、光轨、地平线辉光、消息入场…），而"暖墨 + 鎏金"这套配色是**低对比倾向**的——
 *   金色压在墨底上好看，但次要文字很容易掉到 4.5:1 以下。
 *   这两件事都有明确判据，不该靠"看着还行"。
 * ▎三条检查：
 *   ① 减弱动效：CSS 里被引用的每一个动画名，要么在 prefers-reduced-motion 块里点名，
 *      要么被那里的 `animation: none !important` 一刀切盖住。
 *   ② 对比度：**在真实渲染结果上量**（不是拿 CSS 变量互算）——文字常常落在半透明玻璃上，
 *      实际底色只有布局完才知道。
 *      ▸ 表情回应条那几颗是彩色 emoji，`color` 只是兜底字色，对它们算对比度没有意义 → 排除。
 *   ③ 可访问名：图标按钮（坞 / 画面格 / 成员行）必须有 aria-label 或可见文字。
 * ▎跑法：npm run check:a11y（先起服务器，或用 CHECK_URL 指到专用端口） */
const fs = require('fs');
const path = require('path');
const { Cdp } = require(path.join(__dirname, '..', 'agent', 'cdp.js'));

const URL_ = (process.env.CHECK_URL || 'http://localhost:3001/') + '?nosw=1';
const results = [];
const ok = (name, pass, extra) => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ──  减弱动效：按大括号配对切出 @media 块 ─────────────────────────────
 * ▸ 第一版用正则 `@media ...{ ... \n}` 抓块，一块也没抓到（收尾大括号是缩进的），
 *   于是报"39/39 未覆盖"——**量具坏了比被测物坏了更糟**，因为它给的是一个看起来很
 *   严重、其实是假的结论。这里改成配对计数。 */
function cssBlocks(src, headerRe) {
  const out = [];
  let m;
  const re = new RegExp(headerRe.source, 'g');
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '{') depth++; else if (c === '}') depth--;
      i++;
    }
    out.push(src.slice(start, i - 1));
  }
  return out;
}

/* ── ② 对比度（在页面里算，因为背景要沿祖先合成） ──────────────────────── */
const CONTRAST = `(function(){
  const parse = (c) => {
    const m = String(c).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return [0, 0, 0, 1];
    const p = m[1].split(',').map((x) => parseFloat(x));
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const over = (fg, bg) => fg.map((v, i) => (i === 3 ? v : v * fg[3] + bg[i] * (1 - fg[3])));
  const lum = (rgb) => {
    const f = rgb.slice(0, 3).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const bgOf = (el) => {
    let acc = null;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c[3] <= 0) continue;
      acc = acc ? over(c, acc) : [c[0], c[1], c[2], 1];
      if (c[3] >= 0.999) break;
    }
    if (!acc) { const b = parse(getComputedStyle(document.body).backgroundColor); acc = [b[0], b[1], b[2], 1]; }
    return acc;
  };
  const EMOJI_ONLY = /^[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{FE0F}\\s]+$/u;
  const bad = []; const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    const txt = (el.textContent || '').trim();
    if (!txt || el.children.length) continue;
    if (EMOJI_ONLY.test(txt)) continue;                  // 彩色 emoji 不参与文字对比度
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.4) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const fg = parse(cs.color);
    if (fg[3] < 0.5) continue;
    const px = parseFloat(cs.fontSize);
    const large = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
    const cr = ratio(fg, bgOf(el));
    const need = large ? 3 : 4.5;
    if (cr >= need) continue;
    const key = (el.id || String(el.className || el.tagName)).split(' ')[0] + '|' + Math.round(px);
    if (seen.has(key)) continue;
    seen.add(key);
    bad.push({ who: key, px: Math.round(px * 10) / 10, cr: Math.round(cr * 100) / 100, need, txt: txt.slice(0, 12) });
  }
  return bad.sort((a, b) => a.cr - b.cr).slice(0, 12);
})()`;

/* ★ 2026-10-09 注入浏览器之前先让同一个引擎读一遍这些串。
 *   模板字符串**内部**的注释里只要出现反引号，模板就被提前截断——源文件语法没错、node --check 全过，
 *   错在拼出来的那段代码；到浏览器里炸的时候，本脚本一条断言都没跑到（详见 scripts/inject-check.js 头部）。 */
require('./inject-check.js').assertCompiles(__filename, { CONTRAST });

(async () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'style.css'), 'utf8');
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');     // 注释里的例子不算声明

  const kf = new Set([...bare.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));
  /* 只认"animation(-name): 里那个和 @keyframes 同名"的 token ——
     steps()/cubic-bezier()/var(--x)/!important 这些都会混进粗提取，
     用 kf 做白名单一次性滤掉（比维护一张关键字表可靠）。 */
  const referenced = new Set([...bare.matchAll(/animation(?:-name)?:\s*([^;]+);/g)]
    .flatMap((mm) => [...mm[1].matchAll(/[a-zA-Z][\w-]+/g)].map((x) => x[0]))
    .filter((n) => kf.has(n)));
  const rm = cssBlocks(bare, /@media[^{]*prefers-reduced-motion[^{]*/).join('\n');
  const blanket = /animation\s*:\s*[^;]*none[^;]*!important/.test(rm);
  const named = new Set([...rm.matchAll(/animation(?:-name)?:\s*([^;]+);/g)]
    .flatMap((mm) => [...mm[1].matchAll(/[a-zA-Z][\w-]+/g)].map((x) => x[0])));
  const uncovered = [...referenced].filter((a) => !blanket && !named.has(a));

  ok(`① 减弱动效：${referenced.size} 个被引用的动画全部有降级路径`,
    referenced.size > 0 && uncovered.length === 0,
    `@keyframes ${kf.size} 个｜减弱块 ${cssBlocks(bare, /@media[^{]*prefers-reduced-motion[^{]*/).length} 处｜一刀切=${blanket}`
    + (uncovered.length ? `｜漏：${uncovered.join(', ')}` : ''));
  /* 一刀切很省事，但它会顺手把"减弱动效下仍该保留的状态切换"也抹平——
     这里不判对错，只把事实打出来，将来谁改成一刀切能看见。 */
  console.log(`        （提示：animation: none !important 一刀切 = ${blanket}）`);

  const cdp = new Cdp({ headless: true, startUrl: URL_, windowSize: { width: 1280, height: 900 } });
  await cdp.launch();
  try {
    await cdp.waitForLoad(15000);
    await sleep(1000);
    const fp = await cdp.evaluate(`(async () => {
      const js = await (await fetch('client.js', { cache: 'no-store' })).text();
      return js.includes('syncAriaNames');
    })()`);
    ok('量的是本轮代码（含 aria 同步，不是 SW 缓存）', fp === true);
    await cdp.evaluate(`(function(){
      for (const id of ['authOverlay','prejoin','roomPanel']) { const e = document.getElementById(id); if (e) e.classList.add('hidden'); }
      const bar = document.getElementById('captionBar'); if (bar) bar.classList.remove('hidden');
      const ct = bar && bar.querySelector('.caption-text'); if (ct) ct.textContent = '这是一句字幕正文';
      return 'ok';
    })()`);
    await sleep(400);
    const bad = await cdp.evaluate(CONTRAST);
    ok(`② 文字对比度：真实渲染结果全部达到 WCAG AA（正文 4.5:1 / 大字 3:1）`,
      bad.length === 0, bad.length ? bad.map((b) => `${b.who} ${b.cr}<${b.need}「${b.txt}」`).join(' ; ') : '');

    /* ③ 可访问名：图标按钮不能既没文字也没 aria-label */
    const nameless = await cdp.evaluate(`(function(){
      const sel = '.controls .btn, .video-box button, .member-row button, .rd-ibtn, .side-tab';
      const out = [];
      for (const b of document.querySelectorAll(sel)) {
        const lab = String(b.getAttribute('aria-label') || '').trim();
        const txt = String(b.textContent || '').trim();
        if (!lab && !txt) out.push(b.id || String(b.className).split(' ')[0] || b.tagName);
      }
      return out;
    })()`);
    ok('③ 每颗图标按钮都有可访问名（aria-label 或可见文字）', nameless.length === 0,
      nameless.length ? `念不出：${nameless.join(', ')}` : '');
  } finally {
    cdp.kill();
  }

  const bad2 = results.filter((x) => !x.pass).length;
  console.log(bad2 ? `\n❌ ${bad2} 项未过` : '\n🎉 无障碍两条硬指标都过关');
  process.exit(bad2 ? 1 : 0);
})().catch((e) => { console.error(`\n❌ 检查失败：${e && e.message}`); process.exit(1); });
