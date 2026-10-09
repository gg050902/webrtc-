#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 *  check-screenshare.js —— 屏幕共享比例 + 布局过渡的真浏览器验证
 *  （用户点名问题⑥："共享会议屏幕比例还是有点不协调 优化的丝滑一点"）
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎本轮改的什么（这两条是本检查要钉住的契约）：
 *   ① 共享格 video 从 cover 改 **contain**：屏幕内容是文档/图表，边缘被裁 = 没共享；
 *      黑边是正确代价（腾讯会议/Zoom 同款）。挂点 = tile.box.classList.add('source-screen')
 *      （client.js 两处：attachRemoteMedia 的 screen 分支 + addSelfScreenTile）。
 *   ② 布局切换包 **View Transitions**（applyLayout 的"布局签名变化才包"路径）——
 *      宫格↔演讲者不再硬切，0.25s crossfade。
 *   ③ 大画面 16:9 **两形态**（桌面宽扁 + 手机 390 窄高）：fitMainTile() 反算像素写
 *      --main-w/--main-h，CSS 只消费变量（纯 CSS 在窄高会拉成 ar 0.68，见 09-19 的教训）。
 * ▎为什么必须真浏览器：object-fit 是浏览器渲染契约、View Transitions 是浏览器 API——
 *   桩里都没有（冒烟只能证明"类挂上了/函数调了"）。坑 76 纪律：机制"存在"≠"生效"。
 * ▎共享源说明：自动化浏览器里 getDisplayMedia 需要"有人替用户选源"，用
 *   --auto-select-desktop-capture-source 尝试自动选。选不到（headless 无屏幕源）时
 *   诚实降级到**契约层**：真 DOM 构造 .source-screen 格量 computed object-fit。
 *   两条路都会把"走了哪条"打出来，绝不假装测到了真共享。
 * ▎跑法：WB_CDP_PORT=9423 CHECK_URL=http://localhost:3022/ node scripts/check-screenshare.js
 * ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Cdp } = require('../agent/cdp.js');

const URL_ = process.env.CHECK_URL || 'http://localhost:3001/';
const START_URL = URL_ + (URL_.includes('?') ? '&' : '?') + 'nosw=1';
const results = [];
const ok = (name, pass, extra) => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const port = Number(process.env.WB_CDP_PORT) || 9423;
  try { fs.rmSync(path.join(os.tmpdir(), 'wb-remote-desktop-profile-' + port), { recursive: true, force: true }); } catch (e) { /* 清不掉不致命 */ }

  const cdp = new Cdp({
    headless: true, startUrl: START_URL, windowSize: { width: 1280, height: 860 },
    extraArgs: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      /* 自动选共享源（两条都试：英文名 API 内部默认、中文名走本地化） */
      '--auto-select-desktop-capture-source=Entire screen',
      '--enable-usermedia-screen-capturing',
      '--allow-http-screen-capture',
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

  /* ── 指纹：两份源码自证版本（坑 40） ── */
  const fp = await cdp.evaluate(`(async () => {
    const js = await (await fetch('client.js', { cache: 'no-store' })).text();
    const css = await (await fetch('style.css', { cache: 'no-store' })).text();
    return {
      js: js.indexOf("source-screen") >= 0 && js.indexOf('startViewTransition') >= 0 && js.indexOf('fitMainTile') >= 0
        && js.indexOf('applyScreenSpan') >= 0,
      css: /source-screen[^}]*contain/.test(css) && css.indexOf('::view-transition-old(root)') >= 0 && css.indexOf('--main-w') >= 0
        && css.indexOf('--screen-span') >= 0,
    };
  })()`);
  ok('页面加载的是当前 client.js（source-screen + 布局过渡 + fitMainTile + applyScreenSpan）与 style.css（contain + VT + --main-w/--screen-span 契约）',
    fp && fp.js === true && fp.css === true, `js=${fp && fp.js} css=${fp && fp.css}`);
  if (!(fp && fp.js && fp.css)) { cdp.kill(); process.exit(1); }

  /* ── 进房动线 ── */
  await cdp.evaluate(`(() => { const b = document.getElementById('authGuestBtn'); if (b) b.click(); })()`);
  await waitJs(`!document.getElementById('prejoin').classList.contains('hidden') ? 1 : 0`, 15000);
  await sleep(1100);
  await cdp.evaluate(`(() => { const b = document.getElementById('pjEnterBtn'); if (b) b.click(); })()`);
  await waitJs(`!document.getElementById('roomPanel').classList.contains('hidden') ? 1 : 0`, 15000);
  await sleep(500);
  await cdp.evaluate(`(() => { const b = document.getElementById('createBtn'); if (b) b.click(); })()`);
  const roomText = await waitJs(`(document.getElementById('roomBadge').textContent || '').match(/\\d{6}/) ? document.getElementById('roomBadge').textContent : ''`, 15000);
  const ROOM = (String(roomText).match(/\d{6}/) || [])[0];
  ok('建房拿到 6 位房间号', !!ROOM, ROOM ? '房间 ' + ROOM : '没拿到号');
  if (!ROOM) { cdp.kill(); process.exit(1); }
  await sleep(900); // 等 produce 就绪（shareBtn 才会 enable）

  /* ── 真共享尝试：点按钮 → 等 .source-screen 格 ── */
  await cdp.evaluate(`(() => { const b = document.getElementById('shareBtn'); if (b && !b.disabled) b.click(); })()`);
  const shareUp = await waitJs(`document.querySelector('.video-box.source-screen') ? 1 : 0`, 9000);
  let realShare = shareUp === 1;
  console.log(realShare ? '   ✓ 真实共享建立（自动选源成功）' : '   ⚠ 本环境共享源不可自动选择，降级到契约层取证（详见断言标注）');

  if (realShare) {
    /* 真共享路径：格 + 视频都在，量真实渲染。
     * ▎video 选择器必须排掉 .tile-blur：第 48 步的衬底是**插在最前面**的，
     *   所以"取第一个 video"会拿到那块 cover 的模糊层，把主画面的 contain 判成 cover
     *   ——这不是产品坏了，是断言站错了位置（坑 77 家族：给节点加子元素前，先数谁在按位置取它）。 */
    const m = await cdp.evaluate(`(() => {
      const box = document.querySelector('.video-box.source-screen');
      const v = box && (box.querySelector('video:not(.tile-blur)') || box.querySelector('video'));
      if (!box || !v) return null;
      const r = box.getBoundingClientRect();
      return {
        fit: getComputedStyle(v).objectFit,
        vw: v.videoWidth, vh: v.videoHeight,
        bw: r.width, bh: r.height,
        cls: box.className,
      };
    })()`);
    ok('共享格 video 按 contain 渲染（看全不裁剪——"比例不协调"的核心修点）', m && m.fit === 'contain', m ? `object-fit=${m.fit} · 源 ${m.vw}×${m.vh} · 格 ${Math.round(m.bw)}×${Math.round(m.bh)}` : '');
  } else {
    /* 契约层：真 DOM 造一个 .video-box.source-screen + video，让浏览器裁判 CSS */
    const m = await cdp.evaluate(`(() => {
      const grid = document.getElementById('videoGrid') || document.querySelector('.video-grid');
      const box = document.createElement('div');
      box.className = 'video-box source-screen';
      const v = document.createElement('video');
      v.muted = true;
      box.appendChild(v);
      if (grid) grid.appendChild(box);
      const fit = getComputedStyle(v).objectFit;
      const fitCam = (() => { // 对照组：普通摄像头格必须是 cover（证明"只在共享格生效"）
        const b2 = document.createElement('div'); b2.className = 'video-box';
        const v2 = document.createElement('video'); b2.appendChild(v2);
        if (grid) grid.appendChild(b2);
        const f = getComputedStyle(v2).objectFit;
        if (grid) grid.removeChild(b2);
        return f;
      })();
      if (grid) grid.removeChild(box);
      return { fit, fitCam };
    })()`);
    ok('共享格 video 的 computed object-fit=contain（真浏览器裁判 CSS 契约）', m && m.fit === 'contain', m ? `source-screen=${m.fit}` : '');
    ok('对照组：普通摄像头格保持 cover（改动只在共享格生效，没误伤其他画面）', m && m.fitCam === 'cover', m ? `camera=${m.fitCam}` : '');
  }

  /* ── ★ 2026-10-06 问题⑥的另一半："多大"。contain 修的是裁不裁，这一组量的是共享格占几列 ──
   *   ▎为什么合成格而不是等真共享：自动化环境里 getDisplayMedia 常常选不到源（上面已诚实降级），
   *     而这两条断言判的是 **CSS 契约 + JS 写进去的变量**，与视频内容无关——
   *     用真 DOM 造一对格子（同一网格、同一套类名）让浏览器自己裁决，比"跳过"强。 */
  {
    /* ★ 量**真的那两块**，不是我自己造的：这一轮真共享建立成功时，屏幕上用户看到的就是
     *   真格子的几何；用合成格断言 = 测的是我造的场景不是用户的场景（坑 65 的布局版）。
     *   只有自动化环境选不到共享源时，才退回合成一对格子量 CSS 契约。 */
    const pick = `(() => {
      const grid = document.getElementById('videoGrid') || document.querySelector('.video-grid');
      if (!grid) return null;
      let scr = document.querySelector('.video-box.source-screen');
      let cam = document.querySelector('.video-box:not(.source-screen)');
      const real = !!scr && !!cam;
      const mk = (cls) => {
        const b = document.createElement('div'); b.className = 'video-box ' + cls;
        const v = document.createElement('video'); v.muted = true; b.appendChild(v); grid.appendChild(b); return b;
      };
      if (!real) { cam = mk(''); scr = mk('source-screen'); }
      const cols = (getComputedStyle(grid).gridTemplateColumns || '').split(' ').filter(Boolean).length;
      const r1 = cam.getBoundingClientRect(), r2 = scr.getBoundingClientRect();
      /* 黑边底色现在挂在**格子**上（第 48 步：video 元素的背景会盖掉衬底），
       * 所以这里读 box 的 background，同时把主画面元素的背景一起读出来核对它是透明的。 */
      const sharpV = scr.querySelector('video:not(.tile-blur)') || scr.querySelector('video');
      const out = {
        real, cols, cw: r1.width, ch: r1.height, sw: r2.width, sh: r2.height,
        varW: grid.style.getPropertyValue('--screen-span') || '(未写)',
        overflow: grid.scrollWidth - grid.clientWidth,
        blank: getComputedStyle(scr).backgroundColor,
        sharpBg: sharpV ? getComputedStyle(sharpV).backgroundColor : '(无 video)',
        blurN: scr.querySelectorAll('video.tile-blur').length,
        camBlurN: cam.querySelectorAll('video.tile-blur').length,
      };
      if (!real) { grid.removeChild(cam); grid.removeChild(scr); }
      return out;
    })()`;
    const m = await cdp.evaluate(pick);
    const src = m && m.real ? '真共享格 vs 真摄像头格' : '合成格（本环境选不到共享源）';
    const wideOk = m && (m.cols >= 2 ? m.sw >= m.cw * 1.7 : m.sw <= m.cw * 1.25);
    ok('共享格按列数占宽：≥2 列时拿到约两倍宽；窄舞台（1 列）不放大——那一列就是全部宽',
      wideOk, m ? `${src} · ${m.cols} 列 · 普通格 ${m.cw.toFixed(0)}×${m.ch.toFixed(0)} · 共享格 ${m.sw.toFixed(0)}×${m.sh.toFixed(0)} · --screen-span=${m.varW}` : '量不到网格');
    /* ★ 这一条是**截图**教我的，不是几何断言教我的：第一版只 span 列，
     *   共享格长到两倍高、同行格子还是一倍高 → 行底边参差、左边一块空黑。
     *   "更大"换来"更乱"等于没修。判据因此从"够不够宽"改成"宽高比是否与普通格一致"。 */
    ok('共享格与普通格**同一个宽高比**（大一档但不破坏行对齐——"比例协调"的字面意思）',
      m && Math.abs(m.sw / m.sh - m.cw / m.ch) < 0.12,
      m ? `ar 普通=${(m.cw / m.ch).toFixed(3)} 共享=${(m.sw / m.sh).toFixed(3)}` : '');
    ok('占两列不会把网格撑出横向溢出（隐式列被 overflow:hidden 裁掉=换个地方裁画面）',
      m && m.overflow <= 1, m ? `溢出 ${m.overflow}px` : '');
    /* ★ 2026-10-07 「画面格不许压在底部那一列底下」——用户那句"共享屏幕比例还是有点不协调"
     *   的真身就在这里，而不是在比例上：`.stage` 的 padding-bottom 原本写死 84px，
     *   而底部那一列早就长成"两行坞 + 字幕卡"（~180-230px），最后一行画面格于是伸到
     *   半透明玻璃坞底下，被 backdrop-filter 糊出一片视频色（截图里那片"漏出来的绿"）。
     *   ▸ 判据用**矩形相交**而不是"看起来没挡住"：任何一格与 .bottom-stack 有重叠就红，
     *     并且把最坏的那一处差值打出来，改回去（写死数字）会立刻被抓。 */
    const overlap = await cdp.evaluate(`(() => {
      const stack = document.querySelector('.bottom-stack');
      const grid = document.querySelector('.video-grid');
      if (!stack || !grid) return { skip: true };
      const s = stack.getBoundingClientRect();
      const g = grid.getBoundingClientRect();
      /* 网格自己是 overflow:hidden 的盒子：子格子的**布局矩形**可以伸到盒外，
         但那些部分根本不会被画出来。所以判"重叠"要看两件分别的事：
         ① 网格这个盒子有没有伸进底部那一列（结构性问题，真正要守的）；
         ② 格子的**可见部分**（裁到网格盒内之后）有没有压上去（用户真正看得见的）。
         第一版我只量 ② 却拿未裁剪的 rect 去算，报了一次假红（量具错，不是产品错）。 */
      let worst = 0, who = '';
      for (const b of grid.querySelectorAll('.video-box')) {
        const r = b.getBoundingClientRect();
        if (!r.height) continue;
        const visBottom = Math.min(r.bottom, g.bottom);
        const dy = visBottom - s.top;
        if (dy > worst) { worst = dy; who = b.className.replace('video-box', '').trim() || 'tile'; }
      }
      return { worst: Math.round(worst), boxWorst: Math.round(g.bottom - s.top), who,
               n: grid.querySelectorAll('.video-box').length, stackTop: Math.round(s.top),
               stackH: Math.round(s.height), gridBottom: Math.round(g.bottom),
               stackVar: getComputedStyle(document.documentElement).getPropertyValue('--stack-h').trim() };
    })()`);
    ok('画面网格这个盒子不许伸进"底部那一列"（坞/字幕卡与网格在同一个布局流里分配高度）',
      overlap.skip === true || overlap.boxWorst <= 1,
      overlap.skip ? '（本页没有底部列，跳过）'
        : `网格底边 - 底部列顶 = ${overlap.boxWorst}px · 底部列顶=${overlap.stackTop} 高=${overlap.stackH} · --stack-h=${overlap.stackVar}`);
    ok('格子的可见部分与底部那一列零重叠（玻璃坞不会把身后的视频糊到自己身上）',
      overlap.skip === true || overlap.worst <= 1,
      overlap.skip ? '（跳过）' : `最坏重叠 ${overlap.worst}px · ${overlap.n} 格 · 网格底=${overlap.gridBottom} · ${overlap.who}`);
    ok('黑边底色来自 token（比格底暗一档的暖黑，不是与暖墨底打架的死黑）',
      /* ★ 2026-10-06 第 48 步把这块底色**从 video 元素挪到了格子**：
       *   video 的 background 会画满整个元素矩形，压在模糊衬底上面 = 把衬底整个盖掉。
       *   所以这里读的不再是 video，而是格子本身；同时把主画面元素自己的背景读出来核对它是透明的。 */
      m && m.blank === 'rgb(16, 13, 8)', m ? `格子 background=${m.blank} · 主画面=${m.sharpBg}` : '');
    if (m && m.real) {
      ok('真共享格有且只有一块模糊衬底，摄像头格一块都没有（挂点对、不扩散）',
        m.blurN === 1 && m.camBlurN === 0, `屏幕格衬底=${m.blurN} · 摄像头格衬底=${m.camBlurN}`);
    } else {
      console.log('   （本环境没建起真共享格 → 衬底的归属由下面的 A/B 像素实验判定，这里不假装测到）');
    }
  }

  /* ── ★ 2026-10-06 第 48 步：那块"黑边"到底还黑不黑 —— 像素 A/B，不靠眼睛也不靠 CSS 字符串 ──
   *   ▎为什么要 A/B 两块格子：只量 B（加了衬底的那块）"亮度 90"说明不了任何事——
   *     也许它本来就是 90（暖墨底 + 视频元素背景）。同一帧、同一尺寸、同一位置关系，
   *     差值才是证据。A 组还兼作**分辨力对照**：如果 A 的黑边不是接近 0，
   *     那这个实验根本没有分辨力，B 的"变亮了"就是白给的绿（坑 65 那条纪律）。
   *   ▎为什么用 4:3 的画布喂 16:9 的格子：真实场景里 4:3 的老 PPT / 平板共享就是这种形状，
   *     contain 必然留左右各约 40px 的边——边太窄的话采样点容易蹭到真内容，量具自己先失真。 */
  {
    const prep = await cdp.evaluate(`(async () => {
      const mk = (id, x) => {
        const b = document.createElement('div');
        b.className = 'video-box source-screen'; b.id = id;
        b.style.cssText = 'position:fixed;left:' + x + 'px;top:8px;width:320px;height:180px;z-index:200';
        const v = document.createElement('video'); v.muted = true; v.playsInline = true;
        b.appendChild(v); document.body.appendChild(b); return b;
      };
      const A = mk('abNoBlur', 8), B = mk('abBlur', 348);
      const c = document.createElement('canvas'); c.width = 640; c.height = 480;
      const g = c.getContext('2d');
      const paint = () => {
        g.fillStyle = '#8aa0b6'; g.fillRect(0, 0, 640, 480);
        g.fillStyle = '#efe9dc'; g.fillRect(30, 30, 260, 180);
        g.fillStyle = '#b8321e'; g.fillRect(320, 250, 290, 200);
      };
      paint();
      window.__abTimer = setInterval(paint, 120);
      const st = c.captureStream(30);
      for (const box of [A, B]) {
        const v = box.querySelector('video'); v.srcObject = st;
        try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* 自动播放策略 */ }
      }
      ensureScreenBackdrop(B, B.querySelector('video'));
      ensureScreenBackdrop(B, B.querySelector('video'));   // 故意再调一次：幂等，不许长出第二块
      let waited = 0;
      const ready = () => {
        const va = A.querySelector('video'), bb = B.querySelector('video.tile-blur');
        return va.videoWidth >= 600 && bb && bb.videoWidth >= 600;
      }
      while (waited < 6000 && !ready()) { await new Promise((r) => setTimeout(r, 120)); waited += 120; }
      const ra = A.getBoundingClientRect(), rb = B.getBoundingClientRect();
      const bs = B.querySelector('video.tile-blur');
      const cs = bs ? getComputedStyle(bs) : null;
      return JSON.stringify({
        ready: ready(), waited, blurN: B.querySelectorAll('video.tile-blur').length,
        fit: cs ? cs.objectFit : '(无衬底)', filt: cs ? cs.filter : '', pe: cs ? cs.pointerEvents : '',
        a: { x: ra.left, y: ra.top, w: ra.width, h: ra.height }, b: { x: rb.left, y: rb.top, w: rb.width, h: rb.height },
      });
    })()`);
    const p = typeof prep === 'string' ? JSON.parse(prep || '{}') : (prep || {});
    ok('衬底只有一块（重复 attach 不叠加）、按 cover 铺满、且吃不了点击',
      p.ready === true && p.blurN === 1 && p.fit === 'cover' && /blur/.test(p.filt) && p.pe === 'none',
      `衬底数=${p.blurN} · object-fit=${p.fit} · filter=${String(p.filt).slice(0, 28)} · pointer-events=${p.pe}`);

    /* 各截一块，再塞回页面用 canvas 解码取样（浏览器解自己的 PNG，零依赖） */
    async function sample(box) {
      const buf = await cdp.screenshot({ format: 'png', clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
      return cdp.evaluate(`(async () => {
        const img = new Image();
        img.src = 'data:image/png;base64,${buf.toString('base64')}';
        await img.decode();
        const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
        const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
        const mean = (x0, y0, x1, y1) => {
          const d = g.getImageData(Math.max(0, x0), Math.max(0, y0), Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data;
          let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          return Math.round(s / (d.length / 4));
        };
        /* 320×180 的格 + 4:3 内容 → 内容宽 240，左右各约 40px 是边。
         * 取样框刻意离边缘留 6px，避开 blur 的羽化过渡带本身。 */
        return { barL: mean(6, 24, 34, 156), barR: mean(286, 24, 314, 156), center: mean(120, 60, 200, 120), w: img.width, h: img.height };
      })()`);
    }
    const sa = await sample(p.a);
    const sb = await sample(p.b);
    /* ▎这里曾经踩过一次自己给自己挖的坑：cdp.evaluate 是 returnByValue 的，
     *   页面上 return 一个对象就直接拿到对象，而我按"要 JSON.parse"写了 →
     *   JSON.parse(对象) 报 "[object Object]" is not valid JSON，整条检查当场死。
     *   判据：**两种返回形态都要接住**（页面里 stringify 与直接 return 对象都合法）。 */
    const asObj = (x) => (typeof x === 'string' ? JSON.parse(x || '{}') : (x || {}));
    const A0 = asObj(sa), B0 = asObj(sb);
    ok('分辨力对照：不加衬底那一格，黑边确实是接近死的黑（不然下面的差值就是白给的绿）',
      A0.barL < 26 && A0.barR < 26, `A 左=${A0.barL} 右=${A0.barR}（0=纯黑 255=纯白）`);
    ok('加了模糊衬底之后，黑边不再是死黑（"比例不协调"的观感来源被消掉）',
      B0.barL - A0.barL > 20 && B0.barR - A0.barR > 20,
      `左 ${A0.barL}→${B0.barL} · 右 ${A0.barR}→${B0.barR}`);
    ok('主画面没有被衬底盖住（内容区两个样本几乎一致，模糊只出现在边里）',
      Math.abs(B0.center - A0.center) < 12, `内容区 A=${A0.center} B=${B0.center}`);
    /* 现场图：数字说"变亮了"，图才说"好不好看"（坑 96：布局改动的验收必须看图） */
    const shot = await cdp.screenshot({ format: 'png' });
    const shotDir = path.join(__dirname, '..', 'wb-rd-shots');
    fs.mkdirSync(shotDir, { recursive: true });
    fs.writeFileSync(path.join(shotDir, 'screen-blur-ab.png'), shot);
    console.log(`   🖼 A/B 现场图（左=无衬底 / 右=模糊衬底）：wb-rd-shots/screen-blur-ab.png`);
    /* 收干净：这两块格子和画布定时器是我造的，留着会污染后面的演讲者视图几何断言 */
    await cdp.evaluate(`(() => { clearInterval(window.__abTimer); for (const id of ['abNoBlur','abBlur']) { const b = document.getElementById(id); if (b) { const v = b.querySelector('video'); if (v && v.srcObject) v.srcObject.getTracks().forEach((t) => t.stop()); b.remove(); } } return 1; })()`);
    await sleep(200);
  }

  /* 存一张现场图：几何断言说得清"多宽"，说不清"看着对不对"（用户点名的就是观感）。
   *   截图不参与判定，只是把证据留在磁盘上，人一眼能复核。 */
  try {
    const shotDir = path.join(__dirname, '..', 'wb-rd-shots');
    fs.mkdirSync(shotDir, { recursive: true });
    const buf = await cdp.screenshot({ format: 'png' });
    const f = path.join(shotDir, 'screen-gallery-1280.png');
    fs.writeFileSync(f, buf);
    console.log(`   🖼 宫格共享格现场图：${f}`);
  } catch (e) { console.log('   （截图没存成，不影响判定：' + (e && e.message) + '）'); }

  /* ── 演讲者视图几何：大画面 16:9 居中、胶片条在底部 ── */
  await cdp.evaluate(`(() => { const b = document.getElementById('viewSpeakerBtn'); if (b) b.click(); })()`);
  await sleep(700);
  const geo = await cdp.evaluate(`(() => {
    const grid = document.querySelector('.video-grid');
    const main = document.querySelector('.video-box.tile-main');
    if (!grid || !main) return null;
    const G = grid.getBoundingClientRect(), M = main.getBoundingClientRect();
    const gvw = getComputedStyle(grid);
    return {
      mode: grid.className.includes('layout-speaker') ? 'speaker' : 'other',
      gw: G.width, mw: M.width, mh: M.height,
      gapL: M.left - G.left, gapR: G.right - M.right,
      ar: M.width / M.height,
      rows: gvw.gridTemplateRows,
    };
  })()`);
  ok('切演讲者视图：大画面占第一行（grid 两行模板 = 1fr + auto）', geo && geo.mode === 'speaker', geo ? geo.rows : '没切过去');
  if (geo) {
    ok('大画面宽高比 ≈ 16:9（不再拉伸撑满——"说话人过大/变形"的修点）',
      Math.abs(geo.ar - 16 / 9) < 0.12, `${geo.mw.toFixed(0)}×${geo.mh.toFixed(0)} · ar=${geo.ar.toFixed(3)}`);
    ok('大画面水平居中（左右留白对称，±3px）',
      Math.abs(geo.gapL - geo.gapR) <= 3, `L${geo.gapL.toFixed(0)} R${geo.gapR.toFixed(0)}`);
  } else {
    ok('大画面宽高比 ≈ 16:9', false, '没找到 tile-main');
    ok('大画面水平居中', false, '没找到 tile-main');
  }

  /* ── ★ 2026-10-05 窄高形态（手机 390）：JS 反算方案存在的直接理由，这里钉死 ──
   *   实测背景（真浏览器三候选实验）：纯 CSS "width:100%" 在宽扁格把大画面拉成 ar 3.97，
   *   "height:100%" 在窄高格拉成 ar 0.68 —— Edge 的 aspect-ratio 钳制不跨轴回缩，
   *   两形态没有纯 CSS 两全解。正解 = fitMainTile() 按第一行实高与格宽反算像素。
   *   只验桌面形态会漏掉一半：桌面能过的方案在窄高是坏的（这正是当初踩的坑）。 ── */
  await cdp._send(cdp.pageWs, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(700); // 等 ResizeObserver → fitMainTile 重算
  const geoM = await cdp.evaluate(`(() => {
    const grid = document.querySelector('.video-grid');
    const main = document.querySelector('.video-box.tile-main');
    if (!grid || !main) return null;
    const G = grid.getBoundingClientRect(), M = main.getBoundingClientRect();
    const rows = (getComputedStyle(grid).gridTemplateRows || '').split(' ');
    return {
      gw: G.width, mw: M.width, mh: M.height, r1: parseFloat(rows[0]) || 0,
      ar: M.width / Math.max(1, M.height),
      varW: (getComputedStyle(grid).getPropertyValue('--main-w') || '').trim(),
    };
  })()`);
  ok('手机 390 形态：大画面仍是 16:9（纯 CSS 在此形态会拉成 ar 0.68——修点的另一半）',
    geoM && Math.abs(geoM.ar - 16 / 9) < 0.12,
    geoM ? `${geoM.mw.toFixed(0)}×${geoM.mh.toFixed(0)} · ar=${geoM.ar.toFixed(3)} · 行高${geoM.r1.toFixed(0)} · --main-w=${geoM.varW || '(未写)'}` : '没找到 tile-main');
  ok('手机 390 形态：大画面收在第一行内且不超网格宽（contain 语义，两边都不溢出）',
    geoM && geoM.mh <= geoM.r1 + 1 && geoM.mw <= geoM.gw + 1,
    geoM ? `宽 ${geoM.mw.toFixed(0)}≤${geoM.gw.toFixed(0)} · 高 ${geoM.mh.toFixed(0)}≤${geoM.r1.toFixed(0)}` : '');
  /* ── ★ 2026-10-06 手机 390 **宫格**形态：共享格占宽不能造出隐式列把画面右边裁掉 ──
   *   这条不是多余的：桌面 3 列时 span 2 是"更大"，窄舞台 1~2 列时同一个数就变成"溢出"，
   *   而 .video-grid 是 overflow:hidden —— 症状恰好就是本轮要修的那个病（画面被裁）换了个地方复发。
   *   量出来才敢说"按列数写变量"这一步真的兜住了（坑 79：别猜，量）。 */
  await cdp.evaluate(`(() => { const b = document.getElementById('viewGalleryBtn'); if (b) b.click(); })()`);
  await sleep(600); // 等 applyLayoutDOM + ResizeObserver 把 --screen-span 重算
  const mG = await cdp.evaluate(`(() => {
    const grid = document.querySelector('.video-grid');
    if (!grid) return null;
    const scr = document.querySelector('.video-box.source-screen');
    const cols = (getComputedStyle(grid).gridTemplateColumns || '').split(' ').filter(Boolean).length;
    const S = scr ? scr.getBoundingClientRect() : null;
    const G = grid.getBoundingClientRect();
    return {
      cols, has: !!scr, gw: G.width, sw: S ? S.width : 0,
      overflow: grid.scrollWidth - grid.clientWidth,
      varW: (grid.style.getPropertyValue('--screen-span') || '').trim() || '(未写)',
    };
  })()`);
  ok('手机 390 宫格：共享格收在网格宽以内、横向零溢出（列数少时占满那一行，而不是造隐式列）',
    mG && mG.overflow <= 1 && (!mG.has || mG.sw <= mG.gw + 1),
    mG ? `${mG.cols} 列 · --screen-span=${mG.varW} · 共享格 ${mG.sw.toFixed(0)} ≤ 网格 ${mG.gw.toFixed(0)} · 溢出 ${mG.overflow}px` : '量不到网格');
  await cdp._send(cdp.pageWs, 'Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  await cdp.evaluate(`(() => { const b = document.getElementById('viewSpeakerBtn'); if (b) b.click(); })()`);
  await sleep(400);
  await cdp._send(cdp.pageWs, 'Emulation.clearDeviceMetricsOverride');
  await sleep(400);

  /* ── View Transitions：spy 计数，切回宫格再看 ── */
  const vt0 = await cdp.evaluate(`(() => {
    if (!window.__vtSpy) {
      window.__vtSpy = { n: 0, orig: document.startViewTransition };
      if (typeof document.startViewTransition === 'function') {
        document.startViewTransition = function () { window.__vtSpy.n++; return window.__vtSpy.orig.apply(this, arguments); };
      }
    }
    return { has: typeof window.__vtSpy.orig === 'function', n: window.__vtSpy.n };
  })()`);
  ok('浏览器支持 View Transitions API（Chrome/Edge 111+，零依赖可用）', vt0 && vt0.has === true);
  await cdp.evaluate(`(() => { const b = document.getElementById('viewGalleryBtn'); if (b) b.click(); })()`);
  await sleep(900);
  const vt1 = await cdp.evaluate(`window.__vtSpy ? window.__vtSpy.n : -1`).catch(() => -1);
  ok('布局切换真的走了 startViewTransition（不是硬切——"丝滑"的机制证据）',
    typeof vt1 === 'number' && vt1 >= 1, `调用 ${vt1} 次`);

  cdp.kill();
  const bad = results.filter((x) => !x.pass).length;
  console.log(bad ? `\n❌ ${bad} 项未过` : `\n🎉 屏幕共享比例 + 布局过渡在真浏览器里全部成立（${results.length} 项${realShare ? '' : ' · 共享为契约层取证'}）`);
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error(`\n❌ 检查失败：${e && e.message}`);
  console.error('   先确认 SFU 服务器在跑（或用 CHECK_URL 指到测试端口）');
  process.exit(1);
});
