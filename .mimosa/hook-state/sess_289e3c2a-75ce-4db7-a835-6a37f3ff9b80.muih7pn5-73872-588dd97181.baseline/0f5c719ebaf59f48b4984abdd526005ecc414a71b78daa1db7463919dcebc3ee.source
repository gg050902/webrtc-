/* ══════════════════════════════════════════════════════════════
 * scripts/start-demo.js —— E5 演示包：一键启动两个版本（零依赖，只用 Node 内置）
 *
 * ▎干什么？投简历/答辩前不想"开两个终端敲两条命令"——
 *   `npm run start:demo` 一次拉起 Mesh(3000) + SFU(3001)，
 *   控制台统一打上 [Mesh]/[SFU] 前缀，Ctrl+C 一起退出。
 *
 * ▎用法：npm run start:demo
 * ══════════════════════════════════════════════════════════════ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const root = path.join(__dirname, '..');

const procs = [];

function start(name, script) {
  const p = spawn(process.execPath, [script], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `[${name}] `;
  const pipe = (src, dest) => {
    src.on('data', (chunk) => {
      dest.write(chunk.toString().split('\n').filter(Boolean).map((l) => tag + l).join('\n') + '\n');
    });
  };
  pipe(p.stdout, process.stdout);
  pipe(p.stderr, process.stderr);
  p.on('exit', (code) => {
    console.log(`${tag}进程退出（code=${code}）——另一个服务仍在运行，Ctrl+C 全部退出`);
  });
  procs.push(p);
  return p;
}

console.log('══════════════════════════════════════════════════');
console.log('  简易腾讯会议 · 演示模式启动中（两个版本并存）');
console.log('──────────────────────────────────────────────────');
console.log('  SFU 主版本   : http://localhost:3001');
console.log('  SFU 观测面板 : http://localhost:3001/dashboard');
console.log('  Mesh 对照版  : http://localhost:3000');
console.log('  演示讲稿     : 见「演示脚本-5分钟.md」');
console.log('══════════════════════════════════════════════════');

start('Mesh', path.join(root, 'server.js'));
start('SFU', path.join(root, 'sfu', 'server.js'));

process.on('SIGINT', () => {
  console.log('\n👋 正在关闭两个服务...');
  procs.forEach((p) => { try { p.kill(); } catch (e) { /* 已退出 */ } });
  process.exit(0);
});
