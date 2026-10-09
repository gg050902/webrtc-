/* ★ 2026-10-01 test:asr-live 的启动包装（尽量薄）：
 * ▎子进程清理由**服务器自己**负责（gracefulShutdown 会杀 whisper/qwen 常驻 worker
 *   与 ASR 管线的 ffmpeg；自测 PASS 路径也改走优雅退出）——这里只做兜底强杀 node。
 * ▎超时 5 分钟强杀退出 1（防挂死占端口）。
 * ★ 2026-10-02 改用**专用端口 3017** 并关掉 HTTPS：
 *   原先它直接起在 3001/3443 上，于是每跑一次这条自测，就要先把
 *   **用户正在用的那一台会议服务踢掉**（端口被占→它退出→回归又拒绝复用→只能 taskkill）。
 *   测试该占自己的端口，不该动开发者的实例（坑 57：复用别人端口上的服务 = 假绿）。
 *   要换端口：`TEST_ASR_PORT=3021 npm run test:asr-live`。 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const net = require('net');

const PORT = Number(process.env.TEST_ASR_PORT) || 3017;
const SERVER_JS = path.join(__dirname, '..', 'sfu', 'server.js');
/* ★ 2026-10-05 耐久模式（--soak）：同一条自测链路，把"一轮"变成"多轮 + 长间隔"——
 *   服务器侧多跑一段"轮间静默 + 录音进程自愈"的相位（TEST_ASR_SOAK=1），
 *   验证「放一段时间仍然能转写」而不是只验证"刚启动能转写"。
 *   默认 6 轮 × 30s 间隔（第 3 轮后 60s，跨越静音退场边界），15 分钟超时。 */
const SOAK = process.argv.includes('--soak');

const ping = () => new Promise((resolve) => {
  const s = net.connect({ host: '127.0.0.1', port: PORT, timeout: 800 }, () => { s.destroy(); resolve(true); });
  s.on('error', () => resolve(false));
  s.on('timeout', () => { s.destroy(); resolve(false); });
});

(async () => {
  if (await ping()) {
    console.error(`❌ 测试端口 ${PORT} 已被占用（本脚本只用自己的端口，绝不会去动 3001 上你的会议服务）。`);
    console.error(`   换一个端口即可：  TEST_ASR_PORT=${PORT + 1} npm run test:asr-live`);
    process.exit(1);
  }
  const child = spawn('node', [SERVER_JS], {
    env: {
      ...process.env,
      TEST_ASR: '1',
      TEST_ASR_EXIT: '1',
      PORT: String(PORT),      // 交给服务器（env 优先级高于 config.json 的 port）
      SFU_NO_HTTPS: '1',       // 不抢 3443——HTTPS 端口被占不该拖垮语音自测
      AI_OP_STEP_MS: '20',
      ...(SOAK ? { TEST_ASR_SOAK: '1' } : {}),
    },
    stdio: 'inherit',
  });

  child.on('exit', (code) => process.exit(code || 0));

  const timeoutMs = (SOAK ? 15 : 5) * 60 * 1000;
  if (SOAK) console.log('🧪 [TEST_ASR] 耐久模式（TEST_ASR_SOAK=1）：多轮 + 轮间静默，预计 ~5 分钟');
  setTimeout(() => {
    console.error(`🧪 [TEST_ASR] 超时（${timeoutMs / 60000} 分钟）——强杀并按失败退出`);
    try { child.kill(); } catch (e) { /* 已退 */ }
    process.exit(1);
  }, timeoutMs).unref();
})();
