/* ★ 2026-10-01 test:asr-live 的启动包装（尽量薄）：
 * ▎子进程清理由**服务器自己**负责（gracefulShutdown 会杀 whisper/qwen 常驻 worker
 *   与 ASR 管线的 ffmpeg；自测 PASS 路径也改走优雅退出）——这里只做兜底强杀 node。
 * ▎超时 5 分钟强杀退出 1（防挂死占端口）。 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');

const SERVER_JS = path.join(__dirname, '..', 'sfu', 'server.js');
const child = spawn('node', [SERVER_JS], {
  env: { ...process.env, TEST_ASR: '1', TEST_ASR_EXIT: '1' },
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code || 0));

setTimeout(() => {
  console.error('🧪 [TEST_ASR] 超时（5 分钟）——强杀并按失败退出');
  try { child.kill(); } catch (e) { /* 已退 */ }
  process.exit(1);
}, 5 * 60000).unref();
