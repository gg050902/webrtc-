#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 *  check-invite.js —— 邀请面板 + 跨网自检的真浏览器回归（2026-10-07）
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎为什么单独一条检查：这个面板是"要把同事拉进来"的那个人唯一会看的地方，
 *   而它的内容全部是**现推的事实**（进没进房 / 是不是 localhost 打开 / 有没有跨网入口 /
 *   这台机器的媒体地址能不能被外面连上）。写死一条文案就会在某个部署形态下说谎，
 *   而说谎的邀请面板比没有面板更糟——用户会以为是自己网络坏了（坑 82）。
 * ▎跑法：npm run check:invite（先起服务器，或用 CHECK_URL 指到专用端口） */
const fs = require('fs');
const path = require('path');
const { Cdp } = require(path.join(__dirname, '..', 'agent', 'cdp.js'));

const URL_ = (process.env.CHECK_URL || 'http://localhost:3001/') + '?nosw=1';
const results = [];
const ok = (name, pass, extra) => { results.push({ name, pass }); console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ev(cdp, expr, tries = 6) {
  let last = null;
  for (let i = 0; i < tries; i++) { try { return await cdp.evaluate(expr); } catch (e) { last = e; await sleep(700); } }
  throw last;
}

(async () => {
  const cdp = new Cdp({ headless: true, startUrl: URL_, windowSize: { width: 1440, height: 900 } });
  await cdp.launch();
  await cdp.waitForLoad(15000);
  await sleep(1200);

  /* 0. 版本指纹（没有这一步，下面每一条都可能是在测缓存） */
  const fp = await ev(cdp, `(async () => {
    const js = await (await fetch('client.js', { cache: 'no-store' })).text();
    const css = await (await fetch('style.css', { cache: 'no-store' })).text();
    const cfg = await (await fetch('config.json', { cache: 'no-store' })).json();
    return { render: js.includes('function renderNetCheck'), css: css.includes('.invite-net-row'), netCheck: !!cfg.netCheck, level: (cfg.netCheck || {}).level };
  })()`);
  ok('本轮代码已加载，且 /config.json 真的下发了 netCheck',
    fp.render === true && fp.css === true && fp.netCheck === true, JSON.stringify(fp));

  /* 1. 打开面板（走生产的 openInvitePanel，不自己拼 DOM） */
  const g = await ev(cdp, `(() => {
    if (typeof openInvitePanel !== 'function') return { nofn: true };
    openInvitePanel();
    const p = document.getElementById('invitePanel');
    const net = document.getElementById('inviteNet');
    const rows = [...document.querySelectorAll('.invite-net-row')];
    const box = p.getBoundingClientRect();
    return {
      shown: !!p && !p.classList.contains('hidden'),
      panelW: Math.round(box.width), panelH: Math.round(box.height),
      inViewport: box.left >= -1 && box.right <= innerWidth + 1 && box.top >= -1 && box.bottom <= innerHeight + 1,
      netHidden: net ? net.classList.contains('hidden') : null,
      rowCount: rows.length,
      states: rows.map((r) => r.getAttribute('data-state')),
      head: (document.querySelector('.invite-net-head') || {}).textContent || '',
      headLevel: (document.querySelector('.invite-net-head') || {}).getAttribute('data-theme') || (document.querySelector('.invite-net-head') || {}).getAttribute('data-level') || '',
      fixCount: document.querySelectorAll('.invite-net-fix').length,
      // 面板里不许出现 emoji（09-19e 那条纪律；状态用色点表达，不用图标表情）
      emoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(net ? net.textContent : ''),
      lanUrl: (document.getElementById('inviteLanUrl') || {}).textContent || '',
      crossUrl: (document.getElementById('inviteCrossUrl') || {}).textContent || '',
      crossCopyHidden: (document.getElementById('inviteCrossCopy') || { classList: { contains: () => null } }).classList.contains('hidden'),
    };
  })()`);
  if (g.nofn) { ok('面板能被生产函数打开', false, JSON.stringify(g)); }
  else {
    ok('点房间号那条路径能打开邀请面板，且整块在视口内（浮层不被裁出屏幕）',
      g.shown === true && g.inViewport === true, `面板 ${g.panelW}×${g.panelH} 在视口内=${g.inViewport}`);
    ok('跨网自检渲染出条目（每条带一个状态，不是把服务器 JSON 直接 textContent 出来）',
      g.netHidden === false && g.rowCount >= 4 && g.states.every((s) => ['ok', 'warn', 'bad', 'info'].includes(s)),
      `${g.rowCount} 条 · 状态=${g.states.join(',')}`);
    ok('自检抬头说出这一台机器的结论（level 与文案都在）',
      !!g.head && ['public', 'tailscale', 'lan-only', 'localhost-only'].includes(g.headLevel),
      `level=${g.headLevel} 「${g.head}」`);
    ok('不合格项给出可复制的修复命令（有 fix 才有下一步）',
      g.fixCount >= 1, `可复制命令 ${g.fixCount} 条`);
    ok('自检区不出现 emoji（状态用色点，与全站"去 emoji"纪律一致）', g.emoji === false);
    /* 没有跨网入口时：那一行必须写明"没有"，且复制按钮跟着藏（假链接比缺失更糟） */
    const noCross = /没有跨网入口/.test(g.crossUrl);
    ok('跨网那一行与复制按钮一致（没有入口就写明没有、按钮藏掉；有入口才给复制）',
      noCross ? g.crossCopyHidden === true : g.crossCopyHidden === false,
      `跨网行="${String(g.crossUrl).slice(0, 26)}…" 复制按钮隐藏=${g.crossCopyHidden}`);
  }

  /* 2. ★ 2026-10-09 矮窗口：浮层必须"自己滚动"而不是"越出屏幕"。
   *   起因是一次真实回归：跨网自检从 5 条长到 7 条，面板从 733px 涨到 762px，
   *   全量 check:all 里那条"整块在视口内"当场红——最后一行连同可复制的修复命令
   *   掉到屏幕外面，而浮层没有滚动条，用户看不见自己丢了什么（零报错的失效）。
   *   ▸ 这里故意把视口压到 620px：面板内容比它高，"上界生效"与"内容没丢"才被真正测到。
   *   ▸ 先把两张首屏遮罩收掉：真人是在**会中**点房间号开这块面板的，而登录卡（z110）盖在
   *     面板（z70）上面——不收掉的话下面那脚真滚轮打在遮罩上，"滚不动"是量具站错了地方
   *     不是产品的毛病（坑 119）。收完再用命中测试确认"这块地方真的归面板收"。 */
  await ev(cdp, `(() => {
    for (const id of ['authOverlay', 'prejoin']) { const e = document.getElementById(id); if (e) e.classList.add('hidden'); }
    openInvitePanel();
    return 1;
  })()`);
  await cdp._send(cdp.pageWs, 'Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 620, deviceScaleFactor: 1, mobile: false });
  await sleep(350);
  /* 前提断言：视口 override 真的生效了。不验这一步，"滚轮落点"会按 620 算、而 cdp.wheel
   *   按它记着的 900 换算 → 滚轮打在面板外面，红的看起来像"产品滚不动"（坑 63/119）。 */
  const vp = await cdp.refreshViewport();
  ok('视口真的被压到 620（override 生效，且坐标换算跟着改）',
    vp.height <= 640 && vp.height >= 560, `cdp.viewport=${vp.width}×${vp.height}`);
  let low = null;
  for (let i = 0; i < 10; i++) {
    low = await ev(cdp, `(() => {
      openInvitePanel();
      const p = document.getElementById('invitePanel');
      const box = p.getBoundingClientRect();
      return { h: Math.round(box.height), innerH: innerHeight,
        inViewport: box.top >= -1 && box.bottom <= innerHeight + 1,
        scrollable: p.scrollHeight > p.clientHeight };
    })()`);
    if (low && low.inViewport === true) break;
    await sleep(150);
  }
  ok('窗口比面板矮时它自己滚动、整块仍在视口内（不把修复命令顶出屏幕）',
    low.inViewport === true && low.scrollable === true,
    `面板 ${low.h}px / 视口 ${low.innerH}px · 可滚动=${low.scrollable}`);

  /* 光"有上界"不够——还要证明用户**够得着**最后一行。
   *   这里用真滚轮而不是 p.scrollTop = …：overflow:hidden 的容器 JS 照样能改属性，
   *   那种写法测的是"程序能不能设置属性"而不是"用户能不能看到"——A/B 把 overflow-y
   *   改成 hidden 时 JS 滚动那一版仍然全绿（会红的断言才算断言，坑 123）。 */
  const hit = await ev(cdp, `(() => {
    const b = document.getElementById('invitePanel').getBoundingClientRect();
    const x = (b.left + b.right) / 2;
    const y = Math.max(0, Math.min(b.top + b.height / 2, innerHeight - 6));
    const who = document.elementFromPoint(x, y);
    return { nx: x / innerWidth, ny: y / innerHeight,
      who: who ? (who.id || who.className || who.tagName) : 'null',
      inPanel: !!(who && who.closest && who.closest('#invitePanel')) };
  })()`);
  ok('滚轮落点真的归这块面板收（前提断言，坑 80 的命中测试）',
    hit.inPanel === true, `落点接收者=${hit.who}`);
  for (let i = 0; i < 10; i++) await cdp.wheel(hit.nx, hit.ny, 0, 260);
  let scrolled = null;
  for (let i = 0; i < 10; i++) {
    scrolled = await ev(cdp, `(() => {
      const p = document.getElementById('invitePanel');
      const rows = [...document.querySelectorAll('.invite-net-row')];
      const last = rows[rows.length - 1];
      const box = p.getBoundingClientRect();
      const lb = last ? last.getBoundingClientRect() : null;
      return { atBottom: Math.abs(p.scrollTop + p.clientHeight - p.scrollHeight) <= 2,
        top: Math.round(p.scrollTop),
        lastVisible: !!lb && lb.top >= box.top - 1 && lb.bottom <= box.bottom + 1,
        lastText: last ? String(last.textContent).replace(/\\s+/g, ' ').trim().slice(0, 18) : '' };
    })()`);
    if (scrolled && scrolled.lastVisible === true) break;
    await sleep(120);
  }
  ok('用滚轮滚到底能摸到自检最后一行（上界生效，且内容没被裁掉）',
    scrolled.lastVisible === true,
    `最后一行「${scrolled.lastText}…」· scrollTop=${scrolled.top} · 到底=${scrolled.atBottom}`);

  /* 视口 override 必须清掉：残留会把后面每条断言都量在 620px 的窗口里（坑 122 那类"测试自己污染"）。 */
  await cdp._send(cdp.pageWs, 'Emulation.clearDeviceMetricsOverride', {});
  await sleep(250);

  /* 3. 点掉外面要能收起（第 47 步的契约，与上一条"同一趟点击不把它关掉"互相印证） */
  const closed = await ev(cdp, `(() => {
    document.body.click();
    const p = document.getElementById('invitePanel');
    return p ? p.classList.contains('hidden') : null;
  })()`);
  ok('点面板外面会收起（不是一条"打开后关不掉"的浮层）', closed === true);

  const shotDir = path.join(__dirname, '..', 'wb-rd-shots');
  fs.mkdirSync(shotDir, { recursive: true });
  /* 截图前先掀掉首屏两张遮罩：面板本身是开着的（上面每条断言量的就是它），
   *   但登录卡盖在最上面——现场图要拍到要看的东西，不然这张图对复核没有价值。 */
  await ev(cdp, `(function(){
    for (const id of ['authOverlay', 'prejoin']) { const e = document.getElementById(id); if (e) e.classList.add('hidden'); }
    openInvitePanel(); return 1;
  })()`);
  await sleep(300);
  fs.writeFileSync(path.join(shotDir, 'invite-netcheck.png'), await cdp.screenshot({ format: 'png' }));
  console.log(`   📷 现场图：${path.join(shotDir, 'invite-netcheck.png')}`);

  await cdp.kill();
  const bad = results.filter((r) => !r.pass).length;
  console.log(`\n结果: ${results.length - bad} 项通过 / ${bad} 项失败`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('检查异常:', e); process.exit(1); });
