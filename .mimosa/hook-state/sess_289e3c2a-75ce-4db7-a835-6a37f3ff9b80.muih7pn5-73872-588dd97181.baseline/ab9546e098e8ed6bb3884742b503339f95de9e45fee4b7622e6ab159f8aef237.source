/* ══════════════════════════════════════════════════════════════
 * scripts/bench.js —— E4 压力测试：给毕设论文"系统测试"一章产出真实数字
 *
 * ▎思路（与 TEST_RECORD 同款技术）：ffmpeg 合成源当"假摄像头"——
 *   N 路 testsrc2+libvpx 以 RTP 推进 mediasoup 的 PlainTransport（comedia），
 *   每路 produce 成一路 Producer；再为每路建一个"收流端"（PlainTransport 推到
 *   本机 dgram socket，真实收包统计吞吐）。这样 N 发 N 收的**完整转发链路**都在
 *   mediasoup 里跑，采样 Worker CPU / 转发码率 / 丢包，输出 markdown 数据表。
 *
 * ▎用法（不需要浏览器、不需要 3001 服务器，独立 Worker）：
 *   node scripts/bench.js --producers 8 --duration 12
 *   npm run bench            # 默认 4/8/16 三档连跑（约 1 分钟）
 * ══════════════════════════════════════════════════════════════ */
'use strict';
const { spawn, execFileSync } = require('child_process');
const dgram = require('dgram');
const path = require('path');
const mediasoup = require('mediasoup');

/* ---- ffmpeg 定位（PATH 优先，winget 包目录兜底——与 sfu/server.js 同策略） ---- */
function findFfmpeg() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return 'ffmpeg'; } catch (e) { /* 继续 */ }
  const dirs = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages'),
    'C:\\Program Files\\WinGet\\Packages',
  ].filter(Boolean);
  for (const dir of dirs) {
    try {
      const lines = execFileSync('where', ['/r', dir, 'ffmpeg.exe'], { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().split(/\r?\n/).filter(Boolean);
      if (lines[0]) return lines[0].trim();
    } catch (e) { /* 目录不存在 */ }
  }
  throw new Error('未找到 ffmpeg（winget install ffmpeg）');
}

/* 采样 mediasoup worker 子进程的累计 CPU 秒（Windows: PowerShell Get-Process；失败返回 null） */
function getCpuSeconds(pid) {
  if (!pid) return null;
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      `[Math]::Round((Get-Process -Id ${pid} -ErrorAction Stop).CPU, 2)`],
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 2500 });
    const v = parseFloat(out.toString().trim());
    return Number.isFinite(v) ? v : null;
  } catch (e) { return null; }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (k, d) => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : d; };
  return { producers: get('--producers', 4), duration: get('--duration', 12), fans: Math.max(1, get('--fans', 1)) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runOneLevel(nProducers, durationSec, ffmpegBin, fans = 1) {
  console.log(`\n════ 压测档位：${nProducers} 路推流 × ${nProducers * fans} 路收流（扇出 ×${fans}），时长 ${durationSec}s ════`);
  const worker = await mediasoup.createWorker({ rtcMinPort: 44000, rtcMaxPort: 45999 });
  const router = await worker.createRouter({
    mediaCodecs: [{ kind: 'video', mimeType: 'video/VP8', clockRate: 90000 }],
  });

  // 收流端：一个 dgram socket 接住所有转发包（真实收包，统计吞吐）
  const sink = dgram.createSocket('udp4');
  const sinkPort = 45000 + Math.floor(Math.random() * 400);
  let sinkBytes = 0;
  sink.on('message', (msg) => { sinkBytes += msg.length; });
  await new Promise((r) => sink.bind(sinkPort, r));

  // N 路推流源（ffmpeg → comedia PlainTransport → Producer）
  const senders = [];
  const producers = [];
  for (let i = 0; i < nProducers; i++) {
    const t = await router.createPlainTransport({
      listenIp: { ip: '127.0.0.1' }, comedia: true, rtcpMux: true,
    });
    const port = t.tuple.localPort;
    const producer = await t.produce({
      kind: 'video',
      rtpParameters: {
        codecs: [{ mimeType: 'video/VP8', payloadType: 96, clockRate: 90000, parameters: {}, rtcpFeedback: [] }],
        encodings: [{ ssrc: 30000000 + i }],
      },
    });
    const p = spawn(ffmpegBin, [
      '-loglevel', 'error',
      '-re', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=15',
      '-c:v', 'libvpx', '-b:v', '500k', '-cpu-used', '8', '-deadline', 'realtime',
      '-g', '15', '-keyint_min', '15',
      '-payload_type', '96', '-ssrc', String(30000000 + i),
      '-f', 'rtp', `rtp://127.0.0.1:${port}`,
    ], { stdio: 'ignore' });
    senders.push(p);
    producers.push(producer);
  }
  // 收流：每路 Producer × fans 个 Consumer（G8-① 扇出维度：N 发 × N×K 收）
  for (const producer of producers) {
    for (let k = 0; k < fans; k++) {
      const t = await router.createPlainTransport({
        listenIp: { ip: '127.0.0.1' }, rtcpMux: true, comedia: false,
      });
      await t.connect({ ip: '127.0.0.1', port: sinkPort });
      const c = await t.consume({ producerId: producer.id, rtpCapabilities: router.rtpCapabilities });
      await c.resume();
    }
  }

  // 预热后采样：每 2s 一行；汇总均值
  await sleep(2000); // 预热（编码器起转 + 关键帧到位）
  const samples = [];
  let lastSink = 0, lastCpu = getCpuSeconds(worker.pid);
  const t0 = Date.now();
  const sampleTimer = setInterval(() => {
    const cpu = getCpuSeconds(worker.pid);
    const kbps = ((sinkBytes - lastSink) * 8 / 2000).toFixed(0);
    lastSink = sinkBytes;
    if (cpu !== null && lastCpu !== null) {
      const pct = ((cpu - lastCpu) / 2 * 100).toFixed(0);
      samples.push({ kbps: Number(kbps), cpuPct: Number(pct) });
      console.log(`  [${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] 转发吞吐 ≈ ${kbps} kbps · Worker CPU ≈ ${pct}% 单核`);
    }
    if (cpu !== null) lastCpu = cpu;
  }, 2000);
  await sleep(durationSec * 1000);
  clearInterval(sampleTimer);

  // 终态统计：ingest 丢包（源到 mediasoup 的链路质量）
  let totalPkts = 0, totalLost = 0;
  for (const p of producers) {
    try {
      for (const s of await p.getStats()) {
        totalPkts += s.packetCount || 0;
        totalLost += s.packetsLost || 0;
      }
    } catch (e) { /* 忽略 */ }
  }
  const avgKbps = samples.length ? Math.round(samples.reduce((a, b) => a + b.kbps, 0) / samples.length) : 0;
  const cpuSeconds = getCpuSeconds(worker.pid) ?? 0;

  console.log(`\n  ▎${nProducers} 发 × ${nProducers * fans} 收结果：`);
  console.log(`    | ${nProducers} | ${nProducers * fans} | ${avgKbps} | ${(totalLost / Math.max(1, totalPkts) * 100).toFixed(2)}% | ${Number(cpuSeconds).toFixed(2)} | ${(cpuSeconds / durationSec * 100).toFixed(0)}% |`);
  console.log(`    （转发吞吐均值 ${avgKbps} kbps · ingest 丢包 ${(totalLost / Math.max(1, totalPkts) * 100).toFixed(2)}% · Worker 累计 CPU ${Number(cpuSeconds).toFixed(2)}s ≈ ${(cpuSeconds / durationSec * 100).toFixed(0)}% 单核）`);

  // 清理
  senders.forEach((p) => p.kill());
  await sleep(300);
  worker.close();
  sink.close();
  return { n: nProducers, fans, avgKbps, lossPct: +(totalLost / Math.max(1, totalPkts) * 100).toFixed(2), cpuSeconds: +Number(cpuSeconds).toFixed(2), cpuPct: +(cpuSeconds / durationSec * 100).toFixed(0), durationSec };
}

(async () => {
  const { producers, duration, fans } = parseArgs();
  const ffmpegBin = findFfmpeg();
  console.log(`🧪 E4 压测启动（ffmpeg: ${ffmpegBin}）`);
  if (process.env.BENCH_LEVELS) {
    // 单档模式
    await runOneLevel(producers, duration, ffmpegBin, fans);
  } else {
    const levels = [4, 8, 16];
    const rows = [];
    console.log('\n| 推流路数 | 转发路数 | 转发吞吐均值 (kbps) | ingest 丢包率 | Worker 累计 CPU (s) | 折合单核占用 |');
    console.log('|---|---|---|---|---|---|');
    for (const n of levels) {
      const r = await runOneLevel(n, duration, ffmpegBin, fans);
      console.log(`| ${r.n} | ${r.n * r.fans} | ${r.avgKbps} | ${r.lossPct}% | ${r.cpuSeconds} | ${r.cpuPct}% |`);
      rows.push(r);
    }
    console.log('\n✅ 三档压测完成——把上表复制进《性能测试报告.md》（记得记录机器型号/CPU/网络环境）。');
  }
  process.exit(0);
})().catch((err) => {
  console.error('压测失败:', err.message);
  process.exit(1);
});
