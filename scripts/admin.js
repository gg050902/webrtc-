/* ════════════════════════════════════════════════════════════════
 * scripts/admin.js —— 管理员与账号命令行工具（零依赖，直接用 node:sqlite 存储层）
 *
 * ▎为什么需要它？
 *   "第一个注册的账号自动成为 admin" 只解决新库的情况。老库迁移过来（69 个账号、全是普通用户）、
 *   或者要把某个已有账号提权/降权时，就得到库上改一行 role——总不能让人手写 SQL。
 *   于是有了这个小 CLI：**它就是 store 的一层薄命令包装**。
 *
 * ▎为什么还要 adduser / passwd（不是只有 grant/revoke 就够）？
 *   因为**没有它们，一次忘记密码就等于永久锁死**：
 *   密码是不可逆 scrypt 哈希，服务器上根本没有明文，谁也没法"找回"。
 *   真产品靠邮件重置；本教学版没有邮件通道，所以必须有一条**本地可信通道**
 *   （能连上这台机器的人）来重置——这正是一条运维常识：
 *   "密码重置是一个必须存在的后门，关键是它只能从本地/可信侧进入"。
 *
 * ▎用法：
 *   npm run admin:list                              # 列出所有账号 + 角色（按注册时间）
 *   npm run admin:grant   -- <用户名>                # 提权为 admin
 *   npm run admin:revoke  -- <用户名>                # 降权回 user
 *   npm run admin:adduser -- <用户名> [密码] [昵称]   # 新建账号（不给密码则随机生成并打印）
 *   npm run admin:passwd  -- <用户名> [新密码]        # 重置密码（不给则随机生成并打印）
 *   npm run admin:purge   -- [--yes] [--match <正则>] # 清理测试垃圾账号（默认只干跑，不删）
 *   （注意 grant/revoke/adduser/passwd/purge 后面要加 `--`：把参数透传给脚本而不是被 npm 吃掉）
 *
 * ▎作用域、安全与注意事项：
 *   · 默认操作 sfu/data/meeting.db；想操作别的库就设环境变量 DB_FILE（和服务器一致）。
 *   · **哈希方案与服务器同源**：两边都 require `sfu/password.js`，结构上不可能漂移。
 *     （早先这里"照抄"过一份实现——那是很危险的一类重复，文件头见 sfu/password.js。）
 *   · **权限生效时机**：role 存在库里，但登录 token 里带的是"发 token 时的角色"。
 *     所以提权后要让对方**重新登录**（或调用 auth-refresh），新 token 才会带 admin——
 *     这是刻意的取舍：换来 HTTP 门禁"零数据库查询"，代价是变更有一点延迟（见 server.js）。
 *   · 降权/改密同理：旧 token 在过期前仍然有效。真产品要配"踢下线"，这里点到为止。
 *   · 随机密码用 crypto.randomBytes + 人工可抄写的字母表（去掉 0/O/1/l/I 这类看着像的字形）。
 * ════════════════════════════════════════════════════════════════ */
'use strict';

const store = require('../sfu/store');
/* ★ 09-24：口令方案从 sfu/password.js 引入——**服务器与 CLI 共用同一份实现**。
 *   早先这里"照抄"了一份 hashPassword，那是最危险的一类重复：两边参数一旦漂移，
 *   CLI 建出来的账号在网页上永远登不上，而报错只说"用户名或密码不对"。
 *   现在结构上就不可能不一致了（见 sfu/password.js 文件头）。 */
const { newSalt, hashPassword, randomPassword } = require('../sfu/password');

const [, , cmd, ...rest] = process.argv;

function usage() {
  console.log('用法：');
  console.log('  npm run admin:list                              列出所有账号与角色');
  console.log('  npm run admin:grant   -- <用户名>                把账号提权为 admin');
  console.log('  npm run admin:revoke  -- <用户名>                把账号降权为 user');
  console.log('  npm run admin:adduser -- <用户名> [密码] [昵称]   新建账号（缺密码则随机生成）');
  console.log('  npm run admin:passwd  -- <用户名> [新密码]        重置密码（缺密码则随机生成）');
  console.log('  npm run admin:purge   -- [--yes] [--match <正则>] 清理测试垃圾账号（默认只干跑）');
  console.log(`\n数据库文件：${store.DB_FILE}（可用环境变量 DB_FILE 覆盖）`);
}

function doList() {
  const users = store.listUsers();
  if (!users.length) {
    console.log('（库里还没有任何账号——先在会议页注册一个，它会是首个管理员）');
    return 0;
  }
  console.log(`共 ${users.length} 个账号（数据库：${store.DB_FILE}）\n`);
  console.log('  角色   用户名                昵称              注册时间');
  console.log('  ───── ──────────────────── ──────────────── ───────────────────');
  for (const u of users) {
    const role = u.role === 'admin' ? 'admin' : 'user ';
    const time = new Date(u.createdAt).toLocaleString('zh-CN', { hour12: false });
    console.log(`  ${role} ${String(u.username).padEnd(20)} ${String(u.displayName || '').padEnd(16)} ${time}`);
  }
  const admins = users.filter((u) => u.role === 'admin').length;
  console.log(`\n其中管理员 ${admins} 个。`);
  return 0;
}

function doRole(grant) {
  const username = rest[0];
  if (!username) {
    console.error(`❌ 缺少用户名：npm run admin:${grant ? 'grant' : 'revoke'} -- <用户名>`);
    return 1;
  }
  const target = store.getUser(username);
  if (!target) {
    console.error(`❌ 账号不存在：${username}（先 npm run admin:list 看看有没有拼错）`);
    return 1;
  }
  const role = grant ? 'admin' : 'user';
  if (target.role === role) {
    console.log(`ℹ️  ${username} 已经是 ${role}，无需改动。`);
    return 0;
  }
  store.setUserRole(username, role);
  store.appendAudit(`admin-${grant ? 'grant' : 'revoke'}`, 'cli', { target: username, to: role });
  console.log(`✅ 已把「${username}」的角色改为 ${role}。`);
  if (grant) {
    console.log('   ▸ 请让对方**重新登录**一次，新的 token 才会带 admin（role 是发 token 时写进去的）。');
  }
  return 0;
}

/* adduser —— 新建账号
 * ▎role 不显式传：交给 store.createUser 自己判（① config.adminUsername 钦定 → admin；
 *   ② 库里还没 admin → 首个自动 admin；③ 否则 user）。CLI 不重复实现这套规则，
 *   避免两处规则漂移——这是"单一事实来源"的实践。 */
function doAddUser() {
  const [username, password, displayName] = rest;
  if (!username) {
    console.error('❌ 缺少用户名：npm run admin:adduser -- <用户名> [密码] [昵称]');
    return 1;
  }
  if (!/^[\w.-]{2,32}$/.test(username)) {
    console.error('❌ 用户名只能用字母/数字/下划线/点/短横，长度 2~32（与网页注册的规则一致）');
    return 1;
  }
  if (store.getUser(username)) {
    console.error(`❌ 账号已存在：${username}（要改密码用 npm run admin:passwd -- ${username}）`);
    return 1;
  }
  const usedGenerated = !password;
  const pw = password || randomPassword();
  if (String(pw).length < 6) {
    console.error('❌ 密码至少 6 位（与网页注册的规则一致）');
    return 1;
  }
  const salt = newSalt();
  const created = store.createUser({
    username,
    salt,
    hash: hashPassword(pw, salt),
    displayName: displayName || username,
  });
  store.appendAudit('admin-adduser', 'cli', { target: username, role: created.role });
  console.log(`✅ 已创建账号「${username}」（昵称：${displayName || username}，角色：${created.role}）`);
  if (created.autoAdmin) console.log('   ▸ 库里原本没有管理员，这是**首个管理员**账号。');
  if (usedGenerated) {
    console.log(`\n   密码（只显示这一次，请立刻记下）：${pw}\n`);
  }
  return 0;
}

/* passwd —— 重置密码
 * ▎存在的意义见文件头：没有它，忘记密码 = 永久锁死。
 * ▎为什么不校验旧密码：能在这台机器上执行本命令的人，按定义已经拥有该机器的完全控制权
 *   （能直接读库文件），再要旧密码是"安全剧场"而不是安全。 */
function doPasswd() {
  const [username, password] = rest;
  if (!username) {
    console.error('❌ 缺少用户名：npm run admin:passwd -- <用户名> [新密码]');
    return 1;
  }
  const target = store.getUser(username);
  if (!target) {
    console.error(`❌ 账号不存在：${username}（先 npm run admin:list 看看有没有拼错）`);
    return 1;
  }
  const usedGenerated = !password;
  const pw = password || randomPassword();
  if (String(pw).length < 6) {
    console.error('❌ 密码至少 6 位（与网页注册的规则一致）');
    return 1;
  }
  const salt = newSalt();
  store.setPassword(username, salt, hashPassword(pw, salt));
  store.appendAudit('admin-passwd', 'cli', { target: username });
  console.log(`✅ 已重置「${username}」的密码（旧密码立即失效）。`);
  if (usedGenerated) {
    console.log(`\n   新密码（只显示这一次，请立刻记下）：${pw}\n`);
  }
  console.log('   ▸ 若对方当前在线，已签发的旧 token 在过期前仍有效；要立刻踢下线需重启服务或等 TTL。');
  return 0;
}

/* purge-tests —— 清理测试脚本留下的垃圾账号
 * ▎为什么要有它：测试脚本过去曾经直接往真实 users.json 注册账号（就是本次事故的成因），
 *   这类残留会一直累积在库里，让 admin:list 和演示时的人员列表变得很难看。
 * ▎为什么**默认只干跑（dry-run）**：删除账号不可逆。默认只打印"将要删谁"，
 *   必须显式加 --yes 才真删——把"危险"变成一次**主动表达**，而不是一个手滑的回车。
 *   这是所有运维工具的通行做法（kubectl --dry-run、terraform plan 都是这个思路）。
 * ▎为什么用正则而不是"用户名长度"之类的启发式：测试账号有固定命名约定
 *   （scripts/test-sfu-signaling.js 用 `a_${随机6位}`、`adm_${随机6位}`），
 *   正则能精确命中，且误伤真实账号的概率可审阅（--match 可覆盖）。
 * ▎安全闸：即便匹配到，也**绝不删除最后一个管理员**（见 store.deleteUser 的守卫）。 */
const TEST_ACCOUNT_RE = /^(a_|adm_|evt_|t_)[a-z0-9]{4,10}$/;
function doPurge() {
  const yes = rest.includes('--yes') || rest.includes('-y');
  const matchIdx = rest.findIndex((a) => a === '--match');
  const pattern = matchIdx >= 0 && rest[matchIdx + 1] ? rest[matchIdx + 1] : null;
  let re = TEST_ACCOUNT_RE;
  if (pattern) {
    try { re = new RegExp(pattern); } catch (e) { console.error(`❌ --match 不是合法正则：${e.message}`); return 1; }
  }

  const victims = store.listUsers().filter((u) => re.test(u.username));
  if (!victims.length) {
    console.log(`没有匹配 ${re} 的账号，无需清理。`);
    return 0;
  }
  console.log(`${yes ? '准备删除' : '【干跑】将匹配到'} ${victims.length} 个账号（匹配规则：${re}）：\n`);
  for (const u of victims) {
    console.log(`  ${String(u.username).padEnd(20)} 昵称=${String(u.displayName || '').padEnd(12)} 角色=${u.role} 注册于 ${new Date(u.createdAt).toLocaleString('zh-CN', { hour12: false })}`);
  }
  if (!yes) {
    console.log(`\n以上**均未删除**。确认无误后重跑：npm run admin:purge -- --yes`);
    return 0;
  }

  let removed = 0; const failed = [];
  for (const u of victims) {
    try { if (store.deleteUser(u.username)) removed++; }
    catch (e) { failed.push(`${u.username}（${e.message}）`); }
  }
  store.appendAudit('admin-purge', 'cli', { pattern: String(re), removed, failed: failed.length });
  console.log(`\n✅ 已删除 ${removed} 个测试账号。`);
  if (failed.length) {
    console.log(`⚠️ 有 ${failed.length} 个没能删（多半是安全闸拦下的）：`);
    for (const f of failed) console.log('   · ' + f);
  }
  console.log(`剩余账号：${store.countUsers()} 个（npm run admin:list 可复核）`);
  return 0;
}

function main() {
  switch (cmd) {
    case 'list': case 'ls': return doList();
    case 'grant': return doRole(true);
    case 'revoke': return doRole(false);
    case 'adduser': case 'create': return doAddUser();
    case 'passwd': case 'password': case 'reset': return doPasswd();
    case 'purge-tests': case 'purge': return doPurge();
    default:
      usage();
      return cmd ? 1 : 0;
  }
}

let code = 1;
try {
  code = main();
} catch (e) {
  console.error('❌ 操作失败：' + e.message);
  code = 1;
} finally {
  store.closeDb(); // 显式关库，让 wal 收尾干净（不然临时文件可能残留）
}
process.exit(code);
