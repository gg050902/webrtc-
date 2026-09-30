/* ══════════════════════════════════════════════════════════════
 * 白板延迟基线测量（真浏览器，CDP 驱动）
 *
 * ▎为什么要写这个脚本，而不是"看着卡就去改"：
 *   性能优化最怕凭感觉——改了半天不知道有没有用，也不知道有没有改坏别的地方。
 *   所以先量三个数（都是**真实浏览器里量出来的**，不是估算）：
 *     ① 300 次 pointermove 会发出多少条数据通道消息（洪水量）
 *     ② 处理这 300 次事件本身耗掉多少主线程时间（ms）
 *     ③ 一笔 2000 点的长笔画，重绘（redrawBoard）要多久
 *   改完之后用同一个脚本再跑一遍，对比数字——**这才叫"优化了"，而不是"我改了"**。
 *
 * ▎怎么量到"发了多少条消息"：在页面里给 DataProducer.send 装探针即可
 *   （不改业务代码，纯外部观测——这样量的是真实行为，不是被测代码的自述）。
 *
 * 用法：node scripts/bench-whiteboard.js
 * ══════════════════════════════════════════════════════════════ */
'use strict';
const path = require('path');
const { spawn } = require('child_process');
const { Cdp } = require('../agent/cdp');

const PORT = 3121;
const CDP_PORT = 9455;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOT = path.join(__dirname, '..');

let srv = null;
let browser = null;
const cleanup = () => {
  try { if (browser) browser.kill(); } catch (e) { /* 已退 */ }
  try { if (srv) srv.kill(); } catch (e) { /* 已退 */ }
};
process.on('exit', cleanup);

(async () => {
  console.log('▶ 启动测试服务器…');
  srv = spawn(process.execPath, [path.join(ROOT, 'sfu', 'server.js')], {
    cwd: ROOT,
    // MEDIASOUP_WORKER_NUM=1：与 verify-board 同款（少起 worker，快且稳定）
    env: { ...process.env, PORT: String(PORT), MEDIASOUP_WORKER_NUM: '1',
    // 不启 HTTPS：避免 3443 被占导致服务器整体退出（见 server.js 的 SFU_NO_HTTPS 说明）
    SFU_NO_HTTPS: '1', DB_FILE: path.join(require('os').tmpdir(), `bench-wb-${Date.now()}.db`) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  /* ⚠️ 就绪判据必须是**媒体引擎就绪**这条日志，不能看 HTTP 能不能通：
   *   HTTP 静态服务在启动瞬间就响应了，而 socket.io 是在 mediasoup worker 初始化**之后**
   *   才挂上去的——按 HTTP 判就绪会"连得上 HTTP、连不上 websocket"
   *   （踩过一次：报 "websocket error"，看起来像端口问题，其实是连太早）。 */
  const logBuf = [];
  srv.stdout.on('data', (d) => { logBuf.push(d.toString()); if (process.env.BENCH_VERBOSE) process.stdout.write('[srv] ' + d); });
  srv.stderr.on('data', (d) => { logBuf.push(d.toString()); if (process.env.BENCH_VERBOSE) process.stderr.write('[srv!] ' + d); });
  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (logBuf.join('').includes('媒体引擎就绪')) { ready = true; break; }
    await sleep(500);
  }
  if (!ready) throw new Error('服务器未就绪：' + logBuf.join('').slice(-500));
  console.log('  服务器就绪');

  browser = new Cdp({
    headless: true, port: CDP_PORT,
    windowSize: { width: 1280, height: 900 },
    extraArgs: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required', '--no-first-run'],
  });
  await browser.launch();
  await browser.navigate(`http://127.0.0.1:${PORT}/`);
  await browser.waitForLoad(20000);
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const ok = await browser.evaluate('!!document.getElementById("boardBtn")').catch(() => false);
    if (ok) break;
  }
  console.log('  浏览器就绪');

  /* 建房走 Node socket（与 verify-board-live 同款）——浏览器再以游客身份加入同一个房间。
   * ⚠️ 早先想在页面里点 createBtn，但页面进房是「游客 → 预览页 → 入会」多步流程，
   *   直接点 createBtn 会因为前置状态没到而抛异常（踩过一次）。沿用已验证的流程更稳。 */
  const { io: ioClient } = require('socket.io-client');
  const sock = ioClient(`http://127.0.0.1:${PORT}`, { transports: ['websocket'] });
  await new Promise((res, rej) => { sock.once('connect', res); sock.once('connect_error', rej); setTimeout(() => rej(new Error('socket 超时')), 8000); });
  const roomNumber = await new Promise((res) => { sock.emit('create-room', {}, (r) => res(r && r.data && r.data.roomNumber)); });
  if (!roomNumber) throw new Error('建房失败');
  console.log('  已建房:', roomNumber);

  // 游客 → 预览页 → 入会 → 用房间号加入
  await browser.evaluate(`(() => { const g = document.getElementById('authGuestBtn'); if (g) g.click(); return true; })()`);
  await sleep(900);
  await browser.evaluate(`(() => { const b = document.getElementById('pjEnterBtn'); if (b) b.click(); return true; })()`);
  await sleep(1200);
  await browser.evaluate(`(() => {
    const inp = document.getElementById('roomInput');
    if (inp) { inp.value = '${roomNumber}'; inp.dispatchEvent(new Event('input', { bubbles: true })); }
    const btn = document.getElementById('joinRoomBtn');
    if (btn) { btn.disabled = false; btn.click(); }
    return true;
  })()`);
  await sleep(3500);
  const joined = await browser.evaluate(`(() => ({
    panelHidden: (document.getElementById('roomPanel') || {}).classList
      ? document.getElementById('roomPanel').classList.contains('hidden') : null,
  }))()`);
  console.log('  已入房:', joined.panelHidden === true);

  // 打开白板
  await browser.evaluate(`(() => { const b = document.getElementById('boardBtn'); if (b) b.click(); return true; })()`);
  await sleep(1500);
  const boardOpen = await browser.evaluate(`(() => {
    const c = document.getElementById('boardCanvas');
    const o = document.getElementById('boardOverlay');
    return { canvas: !!c, visible: o ? !o.classList.contains('hidden') : null,
             rect: c ? { w: Math.round(c.getBoundingClientRect().width), h: Math.round(c.getBoundingClientRect().height) } : null };
  })()`);
  console.log('  白板已打开:', JSON.stringify(boardOpen));
  if (!boardOpen.canvas || boardOpen.rect.w < 10) throw new Error('白板 canvas 不可用：' + JSON.stringify(boardOpen));

  /* ── 装探针：数"发出了多少条 board 消息" ──
   * ▎为什么用 JSON.stringify 而不是给 DataProducer.send 打补丁：
   *   producer 是 client.js 的模块作用域变量，页面里拿不到。
   *   而每条 board 消息都必经 `JSON.stringify({type:'board',...})`——
   *   在这里数等价于"数发出的消息条数"，且**完全不改业务代码**（纯外部观测）。
   *   ▎为什么"消息条数"才是关键指标而不是 CPU：
   *     实测 CPU 很便宜（900 次事件 16ms），真正让白板"延迟"的是
   *     **一次拖拽产生几百条 SCTP 消息** → 发送缓冲排队 + 对端逐条处理，
   *     延迟随拖拽时长累积。这与远程控制路径的 rAF 节流是同一条道理。 */
  const installProbe = `(() => {
    window.__boardMsgs = 0;
    if (!window.__jsonPatched) {
      const orig = JSON.stringify;
      JSON.stringify = function (v, ...rest) {
        try { if (v && v.type === 'board') window.__boardMsgs++; } catch (e) {}
        return orig.call(this, v, ...rest);
      };
      window.__jsonPatched = true;
    }
    return true;
  })()`;
  await browser.evaluate(installProbe);

  const N = 300;
  console.log(`\n▶ 派发 ${N} 次 pointermove（模拟一次快速拖拽）…`);
  await browser.evaluate('window.__boardMsgs = 0; true');
  const t0 = Date.now();
  const ev = await browser.evaluate(`(async () => {
    const c = document.getElementById('boardCanvas');
    const r = c.getBoundingClientRect();
    const t0 = performance.now();
    /* ⚠️ 必须**先 pointerdown 再连续 move**（一笔到底），
     *   不能每次 down→move→up（那是 300 笔独立短笔画，模拟不了一次拖拽，
     *   点数也攒不起来、重绘成本量不出来）——初版就是这么写的，数据没意义。 */
    c.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + 30, clientY: r.top + 40, pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true }));
    for (let i = 0; i < ${N}; i++) {
      c.dispatchEvent(new PointerEvent('pointermove', {
        clientX: r.left + 30 + i * 2, clientY: r.top + 40 + Math.round(40 * Math.sin(i / 12)),
        pointerId: 1, pointerType: 'mouse', bubbles: true,
      }));
    }
    c.dispatchEvent(new PointerEvent('pointerup', { clientX: r.left + 30 + ${N} * 2, clientY: r.top + 40, pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true }));
    const ms = performance.now() - t0;
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    return { ms, msgs: window.__boardMsgs };
  })()`);
  console.log(`  ★ 发出的 board 消息条数：${ev.msgs}（${N} 次 move → ${ev.msgs} 条）`);
  console.log(`    事件处理耗时：${ev.ms.toFixed(1)} ms｜墙钟：${Date.now() - t0} ms`);

  // 重绘成本：一笔 300 点的重放
  const redraw = await browser.evaluate(`(() => {
    const t0 = performance.now();
    window.dispatchEvent(new Event('resize'));
    return performance.now() - t0;
  })()`);
  console.log(`  一笔 300 点重绘（redrawBoard）耗时：${redraw.toFixed(1)} ms`);

  // 多笔累积后的重绘增长
  const grow = await browser.evaluate(`(async () => {
    const c = document.getElementById('boardCanvas');
    const r = c.getBoundingClientRect();
    const out = [];
    for (let round = 0; round < 3; round++) {
      c.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + 30, clientY: r.top + 60, pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true }));
      for (let i = 0; i < 500; i++) {
        c.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + 30 + i, clientY: r.top + 60 + (i % 30), pointerId: 1, pointerType: 'mouse', bubbles: true }));
      }
      c.dispatchEvent(new PointerEvent('pointerup', { clientX: r.left + 530, clientY: r.top + 60, pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true }));
      await new Promise((res) => requestAnimationFrame(res));
      const t0 = performance.now();
      window.dispatchEvent(new Event('resize'));
      out.push(Number((performance.now() - t0).toFixed(1)));
    }
    return out;
  })()`);
  console.log(`  笔画累积后重绘耗时（每轮 +500 点）：${grow.join(' / ')} ms → 看是否随总点数增长`);

  cleanup();
  console.log('\n✅ 基线测量完成');
})().catch((e) => { console.log('异常：' + (e && e.stack || e)); cleanup(); process.exit(1); });
