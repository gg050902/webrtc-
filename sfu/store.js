/* ════════════════════════════════════════════════════════════════
 * sfu/store.js —— 账号 / 审计日志的持久化层（node:sqlite，零新依赖）
 *
 * ▎为什么从这里开始改造？
 *   之前账号存在 sfu/users.json 里，"数据库"就是一次 JSON.parse + writeFileSync：
 *     · 每次登录都要把整个文件读出来解析（69 个账号还无感，6900 个就开始疼）；
 *     · 写是全量覆盖——进程在写一半时崩掉，文件就废了；
 *     · 想按 role 查、想加审计日志，都得自己遍历数组，越写越像在造轮子。
 *   真产品到这一步一定会换数据库。但我们有"零依赖铁律"（当前只有 mediasoup + socket.io），
 *   引 better-sqlite3 就等于破了规矩。
 *
 * ▎这就是选 node:sqlite 的理由（本机 Node v22.22.2 内置，已验证导出
 *   DatabaseSync / StatementSync / backup / constants）：
 *   **要一个真数据库，但不想新增任何 npm 依赖** —— 内置模块不算依赖。
 *   代价：它被打上 experimental 标记（见下面那段警告抑制的说明）。
 *
 * ▎设计要点（面试会被追问的三个）：
 *   ① 路径可配置：DB_FILE（环境变量）> sfu/config.json 的 dbFile > 默认 sfu/data/meeting.db。
 *      测试脚本把 DB_FILE 指到临时文件，就永远不会写脏开发者的真实数据（任务 3 的地基）。
 *   ② WAL 日志模式：见 openDb 里的注释——读写不互相阻塞，才配得上"服务器进程常驻"。
 *   ③ 自动迁移：老 users.json 里的账号原样搬进表（**保留 salt/hash，绝不重新哈希**），
 *      搬完把旧文件改名备份而不是删除——迁移是高风险操作，必须留退路。
 *
 * ▎诚实边界：这是教学项目。真上生产还要考虑：连接池、迁移版本号（schema_migrations）、
 *   分区/备份策略、加密静态数据。这里用注释点出来，不假装已经做到。
 * ════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');

/* ──────────────────────────────────────────────────────────────
 * 第 0 步：只压掉 SQLite 这一条 ExperimentalWarning
 *
 * ▎现象：require('node:sqlite') 会往 stderr 打一行
 *     (node:xxxxx) ExperimentalWarning: SQLite is an experimental feature ...
 *   服务器日志里混进这一行，会让人误以为"出了什么异常"，而它其实是**预期内的**。
 * ▎为什么可以压：这是我们主动、明确选择的特性（理由见文件头），不是"意外触发的实验路径"。
 *   压掉它只是让日志干净，**不是掩盖问题**——真正的异常警告照旧原样输出。
 * ▎怎么压得"只压这一条"：临时替换 process.emitWarning，逐个判断消息里是否包含
 *   这句特征串；不含就把控制权交还原生实现。做完（require + 建库）立刻还原，
 *   把影响面缩到最小——比永久改全局钩子安全。
 * ────────────────────────────────────────────────────────────── */
const SQLITE_WARNING_MARK = 'SQLite is an experimental feature';
const nativeEmitWarning = process.emitWarning;
process.emitWarning = function filteredEmitWarning(warning, ...rest) {
  const msg = typeof warning === 'string' ? warning : (warning && warning.message) || '';
  if (msg.includes(SQLITE_WARNING_MARK)) return; // 只吞这一条
  return nativeEmitWarning.call(process, warning, ...rest);
};

let sqlite;
try {
  sqlite = require('node:sqlite');
} finally {
  // 建库所需的实验特性已经加载完，恢复原生行为（此后的警告一律照常）
  process.emitWarning = nativeEmitWarning;
}

const { DatabaseSync } = sqlite;

/* ──────────────────────────────────────────────────────────────
 * 第 1 步：解析"数据库文件到底放哪"
 *
 * ▎优先级：环境变量 DB_FILE > sfu/config.json 的 dbFile > 默认 sfu/data/meeting.db
 * ▎为什么环境变量最高？——测试脚本要能在**不改任何人配置文件**的前提下把库指到临时目录；
 *   这也是十二要素应用（12-Factor）里"配置放环境变量"的老规矩。
 * ▎为什么默认不放在 sfu/ 根下而放 sfu/data/？——运行时产物集中收口：
 *   .gitignore 只需一条 sfu/data/ 就能把 db / wal / shm 全挡住，不用逐个文件列。
 * ────────────────────────────────────────────────────────────── */
function readConfigFile() {
  // store 要能独立使用（scripts/admin.js 直接 require 它），所以自己读一份配置，
  // 不复用 server.js 里的 CONFIG——两边耦合会更糟。
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  } catch (e) {
    return {}; // 没有/坏了 = 全默认（本机演示模式）
  }
}
const CONFIG = readConfigFile();

function resolveDbFile() {
  const fromEnv = process.env.DB_FILE;
  if (fromEnv && String(fromEnv).trim()) return path.resolve(String(fromEnv).trim());
  const fromCfg = CONFIG.dbFile;
  if (fromCfg && String(fromCfg).trim()) {
    const v = String(fromCfg).trim();
    return path.isAbsolute(v) ? v : path.join(__dirname, v); // 相对路径按 sfu/ 解析，别依赖 cwd
  }
  return path.join(__dirname, 'data', 'meeting.db');
}
const DB_FILE = resolveDbFile();

// 目录不存在要自动建（首次运行 sfu/data/ 并不存在）
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

/* 旧账号文件：默认就是 sfu/users.json（历史遗留位置）。
 * ▎为什么允许 USERS_FILE_LEGACY 覆盖？——测试要造一个"假的老 users.json"来验证迁移，
 *   如果写死真实路径，测试就会把开发者的真文件改名备份，那就本末倒置了。 */
const LEGACY_USERS_FILE = process.env.USERS_FILE_LEGACY
  ? path.resolve(process.env.USERS_FILE_LEGACY)
  : path.join(__dirname, 'users.json');

/* ──────────────────────────────────────────────────────────────
 * 第 2 步：打开数据库、建表
 *
 * ▎PRAGMA journal_mode = WAL 是必须的，讲清楚为什么：
 *   默认的 rollback journal 模式下，**写会阻塞读、读也会阻塞写**；
 *   而本服务是"一个 Node 进程，随时有人登录（读 users）、随时有人注册/审计（写）"。
 *   WAL（Write-Ahead Logging）把写先追加到 .wal 文件，读的人看主库 + wal 快照，
 *   于是"读不挡写、写不挡读"——这正是一个常驻服务器需要的并发模型。
 *   代价：会多出 meeting.db-wal / meeting.db-shm 两个文件（.gitignore 用 sfu/data/ 一并盖住）。
 * ────────────────────────────────────────────────────────────── */
/* ★ 09-30 重构：db 与预编译语句改为**惰性打开 + 可重开**。
 * ▎为什么：closeDb() 之后（优雅退出/测试收尾/CLI 用完）如果还有调用进来（例如
 *   测试进程在 closeDb 后再次 getUser），旧实现会拿"已被 finalize 的语句"直接抛
 *   "statement has been finalized"——真实复现过。现在 openDb() 检测到句柄为空就
 *   重建连接 + 重建全部预编译语句，"关了再用"从崩溃变成自然恢复。
 * ▎require 即建库的语义不变：模块底部会调一次 openDb() + 迁移。 */
let db = null;
let SQL = null;

function openDb() {
  if (db) return db;
  db = new DatabaseSync(DB_FILE);
  db.exec('PRAGMA journal_mode = WAL');

  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username     TEXT PRIMARY KEY,
    salt         TEXT NOT NULL,
    hash         TEXT NOT NULL,
    display_name TEXT,
    role         TEXT NOT NULL DEFAULT 'user',
    created_at   INTEGER NOT NULL
  );
`);

  db.exec(`
  CREATE TABLE IF NOT EXISTS audit (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    ts     INTEGER NOT NULL,
    kind   TEXT,
    actor  TEXT,
    detail TEXT
  );
`);

  /* ★ 09-26 头像系统：users 表补 avatar 列（幂等迁移——老库首次打开自动加列，老数据 avatar 为 null）*/
  {
    const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
    if (!cols.includes('avatar')) db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts);');

  /* 语句预编译：prepare() 一次、反复 run（省解析开销）；占位符顺带挡 SQL 注入。 */
  SQL = {
    insertUser: db.prepare(
      'INSERT INTO users (username, salt, hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    insertUserIgnore: db.prepare(
      'INSERT OR IGNORE INTO users (username, salt, hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    getUser: db.prepare(
      'SELECT username, salt, hash, display_name, role, avatar, created_at FROM users WHERE username = ?'),
    listUsers: db.prepare(
      'SELECT username, salt, hash, display_name, role, avatar, created_at FROM users ORDER BY created_at ASC, username ASC'),
    setAvatar: db.prepare('UPDATE users SET avatar = ? WHERE username = ?'),
    countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
    hasAdmin: db.prepare("SELECT 1 AS x FROM users WHERE role = 'admin' LIMIT 1"),
    setRole: db.prepare('UPDATE users SET role = ? WHERE username = ?'),
    setPassword: db.prepare('UPDATE users SET salt = ?, hash = ? WHERE username = ?'),
    deleteUser: db.prepare('DELETE FROM users WHERE username = ?'),
    insertAudit: db.prepare('INSERT INTO audit (ts, kind, actor, detail) VALUES (?, ?, ?, ?)'),
    listAudit: db.prepare('SELECT id, ts, kind, actor, detail FROM audit ORDER BY ts DESC, id DESC LIMIT ?'),
  };
  return db;
}

// 行 → 对外的 JS 对象（把下划线的列名翻译成前端更好用的 camelCase）
const toUser = (r) => (r ? {
  username: r.username,
  salt: r.salt,
  hash: r.hash,
  displayName: r.display_name,
  role: r.role,
  avatar: r.avatar || null,
  createdAt: r.created_at,
} : null);

/* ──────────────────────────────────────────────────────────────
 * 第 4 步：对外 API
 * ────────────────────────────────────────────────────────────── */

function getUser(username) {
  openDb();
  if (typeof username !== 'string' || !username) return null;
  return toUser(SQL.getUser.get(username));
}

function countUsers() {
  openDb();
  return SQL.countUsers.get().n;
}

function hasAdmin() {
  openDb();
  return !!SQL.hasAdmin.get();
}

/* createUser —— 注册唯一的落库入口
 * ▎role 的默认规则（三档，顺序不能乱）：
 *   ① 调用方显式传了 role → 听调用方的；
 *   ② 用户名等于 config.json 的 adminUsername → 直接 admin（给部署者留的"钦定"口子）；
 *   ③ 库里还没有任何 admin → 这第一个成功注册的账号就是 admin（并回传 autoAdmin 让上层打日志）。
 * ▎③ 为什么用"没有 admin"而不是"表为空"？——迁移会先把老账号灌进来（表非空但没 admin），
 *   若用"表为空"判断，迁移后就再也自动产生不了管理员，把系统锁死。用"没有 admin"更稳。
 * ▎唯一约束：同名再插会抛 UNIQUE constraint failed，调用方（注册信令）需 try/catch。
 *   库层兜底比应用层 if 检查更可靠（并发下应用层检查会漏）。 */
function createUser({ username, salt, hash, displayName, avatar, role, createdAt } = {}) {
  openDb();
  let finalRole = role;
  let autoAdmin = false;
  if (!finalRole) {
    if (CONFIG.adminUsername && username === CONFIG.adminUsername) {
      finalRole = 'admin';
    } else if (!hasAdmin()) {
      finalRole = 'admin';
      autoAdmin = true;
    } else {
      finalRole = 'user';
    }
  }
  SQL.insertUser.run(
    username, salt, hash,
    displayName == null ? null : String(displayName),
    finalRole,
    Number(createdAt) || Date.now(),
  );
  if (avatar) SQL.setAvatar.run(String(avatar), username); // 注册即选头像
  return { username, displayName: displayName == null ? username : displayName, avatar: avatar || null, role: finalRole, autoAdmin };
}

function listUsers() {
  openDb();
  return SQL.listUsers.all().map(toUser);
}

/* setUserRole —— 提权/降权（scripts/admin.js 与未来的管理接口都用它）
 * ▎只允许 'user' / 'admin' 两档：角色是安全边界，白名单外的一律拒绝，
 *   避免"手滑写成 adminn"这种拼写错误把门禁悄悄打开。 */
function setAvatar(username, avatar) {
  openDb();
  if (typeof username !== 'string' || !username) return;
  SQL.setAvatar.run(avatar == null ? null : String(avatar), username);
}

function setUserRole(username, role) {
  openDb();
  if (role !== 'user' && role !== 'admin') throw new Error(`非法角色：${role}（只允许 user/admin）`);
  return SQL.setRole.run(role, username).changes > 0;
}

/* setPassword —— 重置密码（scripts/admin.js passwd 用）
 * ▎为什么要换盐：旧哈希可能已经泄露过（备份、日志、别的库）。改密时换盐能让
 *   旧哈希**无法**被用来验证新密码，也顺带保证"相同密码的两个人哈希不同"。
 * ▎传 salt/hash 而不是明文：库层不做哈希计算——哈希方案属于认证层（server.js / CLI），
 *   库层只管存取。这样两边各司其职，也避免库层依赖 crypto。
 * ▎返回 false = 没有这个账号（changes 为 0），而不是抛错——调用方按"改没改成"处理。 */
function setPassword(username, salt, hash) {
  openDb();
  return SQL.setPassword.run(String(salt), String(hash), username).changes > 0;
}

/* deleteUser —— 删除账号（清理测试残留账号等）
 * ▎为什么内置"最后一个管理员不能删"的守卫：删掉最后一个 admin，系统就再也进不去
 *   观测面板/门禁接口（而密码是不可逆哈希，没有"找回"这条路）。这类"把自己锁在门外"
 *   的操作应该在库层直接挡住，而不是指望每个调用方记得检查——**安全默认值**。
 * ▎想真的删掉它？先把别的账号提权为 admin（npm run admin:grant），再删这个。
 * ▎返回 true=删掉了，false=账号不存在。 */
function deleteUser(username) {
  openDb();
  const u = getUser(username);
  if (!u) return false;
  if (u.role === 'admin') {
    const admins = SQL.listUsers.all().filter((r) => r.role === 'admin');
    if (admins.length <= 1) {
      throw new Error(`拒绝删除「${username}」：它是库里唯一的管理员，删掉就再也没人能进观测面板了（先 grant 一个新管理员再删）`);
    }
  }
  return SQL.deleteUser.run(username).changes > 0;
}

/* appendAudit / listAudit —— 审计日志
 * ▎detail 允许传对象：自动 JSON 序列化，方便记结构化上下文（如 {room, file}）。
 *   写失败不该拖垮主路，但这里**不吞异常**——审计是安全能力，静默失败等于没有审计；
 *   由调用方决定怎么处理（server.js 里用 try/catch 包住并打警告）。 */
function appendAudit(kind, actor, detail) {
  openDb();
  const detailText = detail == null
    ? null
    : (typeof detail === 'string' ? detail : JSON.stringify(detail));
  SQL.insertAudit.run(Date.now(), kind == null ? null : String(kind), actor == null ? null : String(actor), detailText);
}

function listAudit(limit = 100) {
  openDb();
  const n = Math.max(1, Math.min(Number(limit) || 100, 1000));
  return SQL.listAudit.all(n).map((r) => ({
    id: r.id, ts: r.ts, kind: r.kind, actor: r.actor, detail: r.detail,
  }));
}

/* integrityCheck —— SQLite 完整性自检（PRAGMA integrity_check）
 * ▎什么时候用：优雅退出后的自动化自测（scripts/test-shutdown.js）、doctor 巡检、
 *   以及"上次断电/磁盘满，库还好吗"这种怀疑时刻。
 * ▎返回 'ok' = 结构与索引一致；其它字符串 = 具体损坏描述（SQLite 自己给的）。
 * ▎为什么不放进每次启动：它是**全库扫描**，库大了会明显拖慢启动——
 *   定位是"诊断工具"，不是"启动步骤"。这也是可观测性常讲的"探针要能按需拉"。
 * ▎为什么 catch 住异常也返回字符串而不是抛：调用方（测试/巡检）想拿到的是"结论"，
 *   库都打开不了时，'error: ...' 本身就是结论；抛出去只会让探针把巡检流程带崩。 */
function integrityCheck() {
  openDb();
  try { return db.prepare('PRAGMA integrity_check').get().integrity_check; }
  catch (e) { return 'error: ' + e.message; }
}

/* closeDb —— 关库（测试收尾、CLI 退出都用它） * ▎为什么要显式关：node:sqlite 的句柄不关，进程退出前 wal 未做 checkpoint，
 *   临时文件可能残留；显式 close 让清理干净可预期。 */
function closeDb() {
  try { if (db) db.close(); } catch (e) { /* 已关或从未打开：忽略 */ }
  db = null; SQL = null; // ★ 09-30：置空句柄——下次任何调用经 openDb() 自然重开
}

/* ──────────────────────────────────────────────────────────────
 * 第 5 步：从旧 users.json 自动迁移（一次性）
 *
 * ▎什么时候做：库里的 users 表为空，且旧 users.json 存在。
 * ▎最关键的一条：**原样搬运 salt/hash，绝不重新哈希**。
 *   重新哈希是"密码学自杀"——你没有明文密码，hash(pw, salt) 里的 pw 根本不存在于服务器上，
 *   唯一能做的就是保留原 salt/hash 让老密码继续能验过。测试里专门断言了这一点。
 * ▎导入完把旧文件**改名**（users.json.imported-<日期>）而不是删除：
 *   迁移永远有"搬了一半发现字段对不上"的风险，保留原文件 = 保留退路。
 * ────────────────────────────────────────────────────────────── */
function migrateLegacyUsersIfNeeded() {
  if (countUsers() > 0) return null;                  // 已经迁移过（或全新库已有数据）
  if (!fs.existsSync(LEGACY_USERS_FILE)) return null; // 没有旧文件 = 无需迁移

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(LEGACY_USERS_FILE, 'utf8'));
  } catch (e) {
    console.warn(`⚠️ 旧 users.json 解析失败，跳过迁移（原文件未动）：${e.message}`);
    return null;
  }
  const pairs = Object.entries(raw && typeof raw === 'object' ? raw : {})
    .filter(([, v]) => v && typeof v.salt === 'string' && typeof v.hash === 'string'); // 缺字段的坏数据不进库
  if (!pairs.length) return null;

  let imported = 0;
  db.exec('BEGIN');
  try {
    for (const [username, v] of pairs) {
      const r = SQL.insertUserIgnore.run(
        username, v.salt, v.hash,
        (typeof v.displayName === 'string' && v.displayName) ? v.displayName : username,
        'user',
        Number(v.createdAt) || Date.now(),
      );
      imported += r.changes;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    console.warn(`⚠️ 迁移事务回滚（旧文件未动）：${e.message}`);
    return null;
  }

  // 备份：改名保留（带日期；同日重名再加序号，避免覆盖）
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let backup = `${LEGACY_USERS_FILE}.imported-${stamp}`;
  let seq = 2;
  while (fs.existsSync(backup)) backup = `${LEGACY_USERS_FILE}.imported-${stamp}-${seq++}`;
  try {
    fs.renameSync(LEGACY_USERS_FILE, backup);
  } catch (e) {
    console.warn(`⚠️ 账号已导入数据库，但旧文件改名失败（原文件仍在）：${e.message}`);
    return { imported, backup: null };
  }
  return { imported, backup };
}

const MIGRATION = migrateLegacyUsersIfNeeded();
if (MIGRATION) {
  console.log(`📦 已从旧 users.json 迁移 ${MIGRATION.imported} 个账号到 SQLite`
    + (MIGRATION.backup ? `（原文件备份为 ${path.basename(MIGRATION.backup)}，未删除）` : '（原文件未动，改名失败见上方警告）'));
}
// 迁移后发现配置钦定了 adminUsername，顺手把该账号提权（否则钦定形同虚设）
if (CONFIG.adminUsername && countUsers() > 0) {
  const u = getUser(CONFIG.adminUsername);
  if (u && u.role !== 'admin') {
    setUserRole(CONFIG.adminUsername, 'admin');
    console.log(`🛡️ 已按 config.json 的 adminUsername 把「${CONFIG.adminUsername}」设为管理员`);
  }
}

module.exports = {
  DB_FILE,
  LEGACY_USERS_FILE,
  getUser,
  createUser,
  listUsers,
  setUserRole,
  setAvatar,
  setPassword,
  deleteUser,
  countUsers,
  hasAdmin,
  appendAudit,
  listAudit,
  integrityCheck,
  closeDb,
};
