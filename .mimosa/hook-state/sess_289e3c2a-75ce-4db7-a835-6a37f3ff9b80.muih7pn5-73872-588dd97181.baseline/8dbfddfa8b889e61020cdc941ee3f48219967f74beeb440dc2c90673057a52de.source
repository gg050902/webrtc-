/* ════════════════════════════════════════════════════════════════
 * scripts/test-store.js —— sfu/store.js 存储层独立测试（零新依赖）
 *
 * ▎为什么单独测这一层？——它是账号数据的"地基"：注册、登录、角色、迁移全压在它身上。
 *   地基坏了，上面所有信令测试都会以奇怪的方式假失败，却指不到根因。
 *
 * ▎测试纪律（本项目统一脾气）：
 *   ① **绝不碰真实数据**：全程用 os.tmpdir() 下的临时目录，DB_FILE / USERS_FILE_LEGACY
 *      都指向临时路径；结尾还 snapshot 比对一次真实 sfu/users.json，自证没动过它。
 *   ② 断言要精确（比对具体值，不是"非空就行"）。
 *   ③ **迁移测试必须用"原样 salt/hash 能验过密码"来证明"没有重新哈希"**——
 *      这是迁移里唯一不可逆、也最容易做错的一步（重新哈希 = 让所有老用户永远登不上）。
 *
 * ▎怎么跑：npm run test:store
 * ════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};
const throws = (fn) => { try { fn(); return false; } catch (e) { return true; } };

/* ---------- 测试沙箱（临时目录，跑完删） ---------- */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sfu-test-store-'));
const DB_FILE = path.join(TMP, 'meeting.db');
const LEGACY = path.join(TMP, 'users.json');   // 假的"旧 users.json"

/* 真实数据快照：跑完要比对，自证"没写脏"（这是任务 3 的核心诉求） */
const REAL_USERS = path.join(ROOT, 'sfu', 'users.json');
const REAL_USERS_BEFORE = fs.existsSync(REAL_USERS) ? fs.readFileSync(REAL_USERS) : null;

/* ---------- 造两份"老账号"（已知明文密码的 salt/hash） ----------
 * ▎用和服务器一模一样的算法（scrypt(pw, salt, 32) 的 hex）预先生成，
 *   这样迁移后再算一遍 if 相等 → 就证明了"搬运过程没重新哈希、也没丢字段"。 */
function makeLegacy(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(pw, salt, 32).toString('hex') };
}
const PW_A = 'oldpass-AAA', PW_B = 'oldpass-BBB';
const LA = makeLegacy(PW_A);
const LB = makeLegacy(PW_B);
const legacyData = {
  legacyA: { salt: LA.salt, hash: LA.hash, displayName: '老甲', createdAt: 1600000000000 },
  legacyB: { salt: LB.salt, hash: LB.hash, displayName: '老乙', createdAt: 1600000001000 },
};
fs.writeFileSync(LEGACY, JSON.stringify(legacyData, null, 2));

// ★ 关键：必须在 require store 之前设好环境变量（store 在 require 那一刻就建库/迁移）
process.env.DB_FILE = DB_FILE;
process.env.USERS_FILE_LEGACY = LEGACY;

const STORE_PATH = require.resolve('../sfu/store');
// 模拟"重启服务器"：清掉模块缓存再 require，让 store 重新走一遍建库 + 迁移判断
const loadStore = () => { delete require.cache[STORE_PATH]; return require('../sfu/store'); };

function importedBackups() {
  const dir = path.dirname(LEGACY);
  const base = path.basename(LEGACY);
  return fs.readdirSync(dir).filter((f) => f.startsWith(base + '.imported-'));
}

(async () => {
  console.log('🧪 sfu/store.js 存储层测试\n');
  console.log(`   临时目录：${TMP}\n`);

  /* ═══════ 第 1 部分：路径可配置 + 建库 ═══════ */
  let store = loadStore(); // 第一次"启动"

  ok('DB_FILE 环境变量生效：store.DB_FILE 指向指定路径', store.DB_FILE === DB_FILE, store.DB_FILE);
  ok('旧 users.json 路径被 USERS_FILE_LEGACY 覆盖（指向 temp）', store.LEGACY_USERS_FILE === LEGACY, store.LEGACY_USERS_FILE);
  ok('数据库文件确实建在了指定路径（不是默认 sfu/data/）', fs.existsSync(DB_FILE));

  /* ═══════ 第 2 部分：自动迁移（原样搬运 + 改名备份） ═══════ */
  ok('迁移导入 2 条账号', store.countUsers() === 2, `实际 ${store.countUsers()}`);

  const ua = store.getUser('legacyA');
  ok('迁移后 legacyA 存在', !!ua);
  ok('迁移**原样保留 salt**（未重新生成）', ua && ua.salt === LA.salt);
  ok('迁移**原样保留 hash**（未重新哈希）', ua && ua.hash === LA.hash);
  ok('迁移保留 displayName', ua && ua.displayName === '老甲', ua && ua.displayName);
  ok('迁移保留 createdAt（时间戳未丢）', ua && ua.createdAt === 1600000000000, ua && String(ua.createdAt));
  ok('迁移进来的账号默认角色是 user', ua && ua.role === 'user', ua && ua.role);
  // ★ 这条是迁移正确性的"终极证明"：用老密码 + 老 salt 现算一遍，应当等于老 hash。
  ok('用旧明文密码能按原样 salt/hash 验过（证明老用户仍能登录）',
     !!ua && crypto.scryptSync(PW_A, ua.salt, 32).toString('hex') === ua.hash);
  const ub = store.getUser('legacyB');
  ok('第二个账号同样原样搬运（salt/hash 一致）',
     !!ub && ub.salt === LB.salt && ub.hash === LB.hash
     && crypto.scryptSync(PW_B, ub.salt, 32).toString('hex') === ub.hash);

  ok('旧 users.json 已被改名（不在原位置）', !fs.existsSync(LEGACY));
  const backups1 = importedBackups();
  ok('生成了 .imported-<日期> 备份文件（保留而非删除）', backups1.length === 1, backups1.join(','));
  ok('备份内容与原始旧文件一致（可回退）',
     backups1.length === 1 && fs.readFileSync(path.join(TMP, backups1[0]), 'utf8') === JSON.stringify(legacyData, null, 2));

  /* ═══════ 第 3 部分：第二次"启动"不重复导入 ═══════ */
  store.closeDb();
  store = loadStore(); // 第二次"启动"（库已有数据、旧文件已改名）
  ok('第二次启动不重复导入（账号数仍为 2）', store.countUsers() === 2, `实际 ${store.countUsers()}`);
  ok('第二次启动不会再多出一个备份文件', importedBackups().length === 1, importedBackups().join(','));

  /* ═══════ 第 4 部分：写入/读取 + 角色规则 ═══════ */
  const pwHash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
  const mk = (name, extra = {}) => {
    const salt = crypto.randomBytes(16).toString('hex');
    return { username: name, salt, hash: pwHash('pw-' + name, salt), ...extra };
  };

  // 库里此刻没有任何 admin（迁移进来的都是 user）→ 下一个注册的账号自动成为 admin
  const boss = store.createUser(mk('boss'));
  ok('库里无 admin 时，下一个创建者自动成为 admin', boss.role === 'admin' && boss.autoAdmin === true, boss.role);

  const u1 = store.createUser(mk('u1', { displayName: '用户一' }));
  ok('已有 admin 后，新账号默认角色为 user', u1.role === 'user' && u1.autoAdmin === false, u1.role);
  const u1r = store.getUser('u1');
  ok('getUser 能读回刚写入的账号（含 displayName）', !!u1r && u1r.displayName === '用户一');
  ok('listUsers 返回全部 4 个账号', store.listUsers().length === 4, String(store.listUsers().length));

  ok('setUserRole 提权生效（u1 → admin）', store.setUserRole('u1', 'admin') === true && store.getUser('u1').role === 'admin');
  ok('setUserRole 降权生效（u1 → user）', store.setUserRole('u1', 'user') === true && store.getUser('u1').role === 'user');
  ok('setUserRole 对不存在的账号返回 false', store.setUserRole('nobody', 'admin') === false);
  ok('setUserRole 拒绝非法角色（白名单外一律拒绝）', throws(() => store.setUserRole('u1', 'root')));

  /* ═══════ 第 5 部分：唯一约束 ═══════ */
  ok('同名注册第二次失败（UNIQUE 约束生效）', throws(() => store.createUser(mk('u1'))));
  ok('重复失败后账号数不变（没有写进去）', store.countUsers() === 4, String(store.countUsers()));

  /* ═══════ 第 6 部分：审计日志（按时间倒序） ═══════ */
  store.appendAudit('auth-register', 'u1', { role: 'user' });
  await new Promise((r) => setTimeout(r, 5)); // 拉开时间戳，保证 ts 严格递增
  store.appendAudit('admin-grant', 'cli', { target: 'u1' });
  await new Promise((r) => setTimeout(r, 5));
  store.appendAudit('room-create', 'u1', 'room 123456');

  const audit = store.listAudit(10);
  ok('listAudit 返回 3 条', audit.length === 3, String(audit.length));
  ok('listAudit 按时间倒序（最新一条在最前）', audit[0].kind === 'room-create', audit[0] && audit[0].kind);
  ok('listAudit 末尾是最早的一条', audit[2].kind === 'auth-register', audit[2] && audit[2].kind);
  ok('listAudit 时间戳递减', audit[0].ts >= audit[1].ts && audit[1].ts >= audit[2].ts);
  ok('listAudit 的 detail 原样可读（JSON 字符串）',
     audit[1].kind === 'admin-grant' && audit[1].detail === JSON.stringify({ target: 'u1' }));
  ok('listAudit(limit) 生效（limit=1 只回 1 条）', store.listAudit(1).length === 1);
  ok('listAudit 的 actor 被记录', audit[0].actor === 'u1', audit[0] && audit[0].actor);

  /* ═══════ 第 7 部分：改密 / 删号 / 完整性（09-24 追加） ═══════
   * ▎这一部分守的是"账号生命周期"的另外两件事：
   *   忘记密码要有路可走（setPassword），清理垃圾账号不能把系统删到进不去（deleteUser 安全闸）。
   * ▎为什么这里要 import sfu/password 而不在测试里再抄一遍 scrypt：
   *   本测试的职责是"验证 store 存的东西能被**密码方案**验过"，所以必须用**那一份**
   *   真方案。抄一遍就只能证明"我抄对了"，证明不了产品用对。 */
  const { hashPassword, newSalt, verifyPassword } = require('../sfu/password');

  // 改密：换盐 + 换哈希 → 旧密码必须失效，新密码必须通过
  const u1Before = store.getUser('u1');
  const s2 = newSalt();
  store.setPassword('u1', s2, hashPassword('brand-new-pw', s2));
  const u1After = store.getUser('u1');
  ok('setPassword 换了盐（旧盐不再使用）', u1After.salt !== u1Before.salt);
  ok('setPassword 后旧密码失效', !verifyPassword('pw-u1', u1After.salt, u1After.hash));
  ok('setPassword 后新密码能验过', verifyPassword('brand-new-pw', u1After.salt, u1After.hash));
  ok('setPassword 对不存在的账号返回 false', store.setPassword('nobody-xyz', newSalt(), 'dead') === false);

  /* 口令方案同源：迁移搬过来的老账号，必须仍能用**原来的明文密码**验过。
   * 这条同时锁两件事：① 迁移没有重新哈希；② sfu/password.js 与 store 里存的东西对得上。 */
  const lA = store.getUser('legacyA');
  ok('迁移过来的老账号仍能用原密码验过（salt/hash 未被重算、方案同源）',
     verifyPassword(PW_A, lA.salt, lA.hash));

  // 删号：普通账号能删；最后一个管理员被安全闸挡住
  ok('deleteUser 删普通账号成功', store.deleteUser('legacyB') === true);
  ok('deleteUser 后账号真的没了', store.getUser('legacyB') === null);
  ok('deleteUser 对不存在的账号返回 false', store.deleteUser('nobody-xyz') === false);

  const onlyAdmin = 'gateadmin_' + Math.random().toString(36).slice(2, 6);
  store.createUser({ username: onlyAdmin, salt: newSalt(), hash: hashPassword('x', 'y'), role: 'admin' });
  // 把其它管理员都降权，人为制造"库里只剩这一个管理员"的场景
  for (const u of store.listUsers()) {
    if (u.role === 'admin' && u.username !== onlyAdmin) store.setUserRole(u.username, 'user');
  }
  ok('deleteUser 拒绝删除库里唯一的管理员（安全闸：不许把自己锁在门外）',
     throws(() => store.deleteUser(onlyAdmin)));
  ok('被安全闸拦下后该管理员仍然存在', store.getUser(onlyAdmin) !== null);
  const backupAdmin = 'gateadmin2_' + Math.random().toString(36).slice(2, 6);
  store.createUser({ username: backupAdmin, salt: newSalt(), hash: hashPassword('x', 'y'), role: 'admin' });
  ok('有第二个管理员后，删原管理员成功', store.deleteUser(onlyAdmin) === true);
  ok('删完后另一个管理员还在（库里仍有 admin）', store.getUser(backupAdmin) !== null && store.hasAdmin());

  ok('integrityCheck 返回 ok（库结构完好）', store.integrityCheck() === 'ok', store.integrityCheck());

  /* ═══════ 收尾：关库、清理、自证没写脏真实数据 ═══════ */
  store.closeDb();

  const REAL_USERS_AFTER = fs.existsSync(REAL_USERS) ? fs.readFileSync(REAL_USERS) : null;
  ok('真实 sfu/users.json 未被本测试改动（内容逐字节一致）',
     Buffer.compare(REAL_USERS_BEFORE || Buffer.alloc(0), REAL_USERS_AFTER || Buffer.alloc(0)) === 0);
  ok('本测试没有在 sfu/data/ 下建库（DB 只在临时目录）',
     store.DB_FILE === DB_FILE && fs.existsSync(DB_FILE));

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* 清理失败不判失败 */ }

  console.log(`\n结果：PASS ${pass} / FAIL ${fail}（共 ${pass + fail} 项）`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error('测试崩溃：', err && err.stack || err);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  process.exit(1);
});
