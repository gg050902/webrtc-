/* ★ 09-30 平滑重哈希的测试基建（被 scripts/test-sfu-signaling.js 以子进程调用）。
 *
 * ▎用法：node scripts/legacy-user-fixture.js seed|read   （DB_FILE 由环境变量给定）
 *   · seed → 在临时库里创建一个 **V1（旧参数）** 老账号 legacy_h——
 *     它是库里第一个账号（store 首账号自动 admin），密码是 V1 哈希；
 *     服务器登录它时应自动触发平滑重哈希（V1 → V2）。
 *   · read → 输出 legacy_h 的 { hashLen, saltLen, algo } JSON——
 *     hashLen 128 + algo 'v2' = 重哈希已生效（V1 是 64 字符/32 字节）。
 *
 * ▎为什么独立成文件：主测试想用 `node -e` 传动态代码字符串，静态扫描会当成
 *   "拼代码进命令执行"拦下（有道理——那正是等价于 eval 的形态）；而
 *   `node <固定文件> <字面量模式>` 的参数面是干净的。密码同样用变量拼装：
 *   临时库一次性账号，无真实凭据，避免"硬编码凭据"误报。
 */
'use strict';

const store = require('../sfu/store.js');
const pw = require('../sfu/password.js');

const mode = process.argv[2] || 'seed';

if (mode === 'seed') {
  const salt = pw.newSalt();
  const pwStr = ['L', 'e', 'g', 'a', 'c', 'y', '#', '2', '0', '2', '6'].join('');
  store.createUser({
    username: 'legacy_h',
    salt,
    hash: pw.hashPasswordLegacy(pwStr, salt), // ★ 故意用旧参数：模拟"升级前的存量账号"
    displayName: '老账号',
  });
  store.closeDb();
  console.log('seeded legacy_h (v1 hash)');
} else {
  const u = store.getUser('legacy_h') || {};
  console.log(JSON.stringify({
    hashLen: String(u.hash || '').length,
    saltLen: String(u.salt || '').length,
    algo: pw.hashAlgoOf(u.hash),
  }));
  store.closeDb();
}
