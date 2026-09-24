/* ════════════════════════════════════════════════════════════════
 * scripts/test-shutdown.js —— 优雅退出（第 Z 部分）的回归测试
 *
 * ▎为什么值得单独一个测试文件：这段代码的触发路径是"进程收到信号"，
 *   而它在 Windows 上**根本没法用外部信号触发**（没有 POSIX 信号，
 *   timeout / taskkill 走的是 TerminateProcess，等于直接暴毙）。
 *   换句话说：这段逻辑如果写错了，平时谁也发现不了，等真上线（Linux/容器）
 *   才暴露成"孤儿 Worker 占着 RTC 端口 / WAL 一直涨"。
 *   所以用 TEST_SHUTDOWN_AFTER_MS 钩子把它拽出来，在 CI/本机都能断言。
 *
 * ▎断言的取舍（重要，避免"假通过"）：
 *   · 断言"出口码 0"是有意义的——优雅流程若卡住，5 秒保险丝会强制 `exit(1)`；
 *     所以"0"同时证明了"走完了"和"没超时"两件事。
 *   · **刻意不断言 -wal 文件消失**：本测试里服务器几乎不写库，
 *     WAL 文件有没有出现本来就不确定；断言"不存在"会变成一条**永远为真**的假断言。
 *     改成断言真正可证的事实：退出后库仍能打开、integrity ok、之前写入的数据还在。
 *   · 断言"日志里没有『Worker 挂了』"是本文件的**核心回归点**：
 *     这正是本次实跑观察到的问题（正常退出被渲染成崩溃）。
 * ════════════════════════════════════════════════════════════════ */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log(`  PASS  ${msg}`); }
  else { fail++; console.log(`  FAIL  ${msg}`); }
};

const ROOT = path.join(__dirname, '..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfu-shutdown-'));
const dbFile = path.join(tmpDir, 'shutdown.db');
const PORT = Number(process.env.SHUTDOWN_TEST_PORT) || 3099;

console.log(`优雅退出回归（临时库：${dbFile}，端口：${PORT}）\n`);

(async () => {
  /* 先造一点数据：让"退出后数据还在"这条断言有实际意义。
   * 直接 require store 并写入（这是同一个库文件，服务器进程之后会打开它）。 */
  process.env.DB_FILE = dbFile;
  const store = require('../sfu/store');
  store.appendAudit('pre-shutdown-probe', 'test', { note: '退出前写入，用于验证数据耐久性' });
  const usersBefore = store.countUsers();
  store.closeDb();

  // 启动服务器（临时库 + 指定端口 + 2.5 秒后主动触发优雅退出）
  const child = spawn(process.execPath, [path.join(ROOT, 'sfu', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, DB_FILE: dbFile, PORT: String(PORT), TEST_SHUTDOWN_AFTER_MS: '2500' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { out += c; });

  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => { try { child.kill(); } catch (e) {} resolve('TIMEOUT'); }, 30000);
    child.on('exit', (c) => { clearTimeout(timer); resolve(c); });
  });

  console.log('--- 服务器输出（尾部）---');
  console.log(out.split('\n').slice(-12).join('\n'));
  console.log('--- 断言 ---');

  ok(code === 0, `进程以 0 退出（若卡住会被 5s 保险丝强制 exit(1)；实际：${code}）`);
  ok(out.includes('🛑 收到 TEST_SHUTDOWN'), '打印了「收到信号，正在优雅退出」');
  ok(out.includes('👋 已安全退出'), '打印了「已安全退出」= 三步（Worker/监听/关库）都跑完了');
  ok(!out.includes('⚠️ 优雅退出超时'), '没有触发 5 秒保险丝（说明不是被强杀的）');
  /* 核心回归点：正常退出时 Worker 是被我们主动关的，绝不能被当成"崩溃"报错并触发补位 */
  ok(!out.includes('❌ mediasoup Worker 挂了'),
     '正常退出**没有**误报「Worker 挂了，5 秒后自动补位」（本次修的日志噪声）');
  // 反向断言：真崩溃时那条日志必须还在（否则等于我把故障告警也一起删掉了）
  ok(out.includes('mediasoup Workers×1 已启动'), '启动日志正常（证明上面那条不是"整个文件没输出"造成的假通过）');

  // 退出后：库还能正常打开、数据还在、完整性 ok
  delete require.cache[require.resolve('../sfu/store')];
  const store2 = require('../sfu/store');
  ok(store2.countUsers() === usersBefore, `退出后账号数不变（${usersBefore}）`);
  const audit = store2.listAudit(50);
  ok(audit.some((a) => a.kind === 'pre-shutdown-probe'), '退出前写入的审计记录仍在（数据耐久性）');
  const integrity = store2.integrityCheck();
  ok(integrity === 'ok', `退出后 SQLite integrity_check = ${integrity}`);
  store2.closeDb();

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* Windows 下偶尔占用，忽略 */ }

  console.log(`\n结果：PASS ${pass} / FAIL ${fail}（共 ${pass + fail} 项）`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试异常：', e && e.stack || e);
  process.exit(1);
});
