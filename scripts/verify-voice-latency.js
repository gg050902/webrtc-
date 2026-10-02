/* ══════════════════════════════════════════════════════════════
 * scripts/verify-voice-latency.js —— AI 语音"多久出声"的实测工具（npm run verify:voice）
 *
 * ▎为什么要有这个脚本：2026-10-02 用户报"跟它说话延迟很大、后边它回答没有说话"，
 *   而"延迟很大"到底卡在听、想、说哪一环，靠感觉争不出来——必须量。
 *   量出来的结论直接改掉了默认策略：**Qwen3-TTS 本地在 CPU 上合成一句要 44s**
 *   （答案 3.0s 就上屏、声音 47.0s 才到）→ 实时播报改回浏览器朗读（即时），
 *   本地神经音色降级为 config.aiTtsLocalWait 显式开启（详见 sfu/server.js 的 localTtsWaitEnabled）。
 * ▎它做什么：自己起一台服务器（默认端口 3017，避开你在用的 3001）→ 等 Qwen3-TTS
 *   worker 预热完成 → 用一个真的 socket.io 客户端建房进房 → 发一条 `ai-ask`
 *   → 记录四个时刻：答案首字、答案完成、音频首段、失败通知。
 * ▎诚实边界：数字是本机 CPU + 当前网络出口的实测值，换机器/换出口要重测；
 *   Edge 端点可达时（本机 403）走的是另一条更快的路径，这个脚本测不到那一条。
 * ══════════════════════════════════════════════════════════════ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const io = require('socket.io-client');

const PORT = Number(process.env.PROBE_PORT || 3017);
const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const srv = spawn('node', [path.join(ROOT, 'sfu', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), MEDIASOUP_WORKERS: '1', AI_OP_STEP_MS: '20' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let ttsReady = false; const tail = [];
  const onData = (d) => {
    const s = String(d); tail.push(s); if (tail.length > 40) tail.shift();
    if (/Qwen3-TTS 本地 worker 已预热/.test(s)) ttsReady = true;
    if (/Qwen3-ASR 本地 worker 已预热/.test(s)) console.log('   ✔ Qwen3-ASR 已预热');
  };
  srv.stdout.on('data', onData); srv.stderr.on('data', onData);

  // ① 等 TTS worker 加载完（0.6B CPU，实测 60~120s；等不到就带着这个事实退出）
  const t0 = Date.now();
  while (!ttsReady && Date.now() - t0 < 240000) await sleep(1000);
  console.log(`\n── Qwen3-TTS 预热：${ttsReady ? `OK（${((Date.now() - t0) / 1000).toFixed(0)}s）` : '超时未就绪'}`);
  if (!ttsReady) { console.log(tail.slice(-8).join('')); try { srv.kill(); } catch (e) {} process.exit(1); }

  // ② 真客户端进房 → 问一个会答出多句的问题 → 记 ai-audio 分段时刻
  const s = io(`http://127.0.0.1:${PORT}`, { transports: ['websocket'], reconnection: false });
  await new Promise((res, rej) => { s.on('connect', res); s.on('connect_error', rej); });
  const room = await new Promise((res) => { s.once('room-created', (m) => res(m.roomNumber)); s.emit('create-room', { password: '' }); });
  await new Promise((res) => { s.once('room-members', res); s.emit('join-room', { roomNumber: room, password: '' }); setTimeout(res, 3000); });
  const audios = []; const fails = []; let askSent = 0, firstDelta = 0, answerTs = 0;
  s.on('ai-stream', (m) => { if (m && m.delta && !firstDelta) firstDelta = Date.now(); });
  s.on('chat-message', (m) => { if (m && m.from === 'ai-bot' && m.text && m.text.length > 8) { answerTs = m.ts; } });
  s.on('ai-audio', (m) => audios.push({ at: Date.now(), seq: m.seq, total: m.total, url: m.url }));
  s.on('ai-tts-fail', () => fails.push(Date.now()));
  askSent = Date.now();
  s.emit('ai-ask', { question: '请用三句话介绍一下这场会议系统的架构特点。' });
  console.log('── 已提问，等待应答与音频…');
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline && (!audios.length || audios.length < 2)) await sleep(1000);

  const rel = (t) => ((t - askSent) / 1000).toFixed(1);
  console.log(`\n══ 实测（自提问起算）══`);
  console.log(`  提问 → 答案首字上屏   ${firstDelta ? rel(firstDelta) + 's' : '（没收到流式增量）'}`);
  console.log(`  提问 → 答案整段完成   ${answerTs ? rel(answerTs) + 's' : '（没收到终态）'}`);
  console.log(`  提问 → 音频段到达     ${audios.length ? audios.map((a) => `${rel(a.at)}s(seq=${a.seq}/${a.total})`).join('  ') : '无'}`);
  console.log(`  答案上屏 → 听到首句   ${answerTs && audios.length ? ((audios[0].at - answerTs) / 1000).toFixed(1) + 's' : '—'}`);
  console.log(`  失败通知              ${fails.length} 次${fails.length ? `（首次 ${rel(fails[0])}s → 前端应回落浏览器朗读）` : ''}`);
  console.log(`  分段引擎              ${audios.length ? 'Qwen3-TTS 本地（按句流水线分段）' : '未产出音频'}`);

  try { s.disconnect(); } catch (e) {}
  try { srv.kill(); } catch (e) {}
  await sleep(1500);
  try { process.kill(-srv.pid); } catch (e) {}
  process.exit(audios.length ? 0 : 2);
})().catch((e) => { console.error('探针异常:', e.message); process.exit(3); });
