# -*- coding: utf-8 -*-
# 注入:G6 安全加固(token 生命周期+滑动续期+四处限流)
import io
p = 'sfu/server.js'
s = io.open(p, encoding='utf-8').read()
L = chr(10)
NL = chr(92) + 'n'

# ── 1) 限流 helper + token 生命周期(挂在 authTokens 声明处) ──
old1 = "const authTokens = new Map(); // token -> username"
assert old1 in s, 'a1'
new1 = """/* ★ 09-19h G6-③ 限流（零依赖手写固定窗口计数器，~15 行）：
 * ▎防什么：撞库（login）/暴力猜 6 位房间号（join-room）/注册机刷号（register）/刷屏（chat）。
 * ▎用固定窗口而非令牌桶：实现最短、语义直白（"一分钟最多 N 次"），教学项目够用；
 *   需要平滑限流再换令牌桶（扩展点注释）。
 * ▎内存纪律：桶本身带过期，定时清理防 Map 无限涨（与日志环形上限同一总纲）。 */
const rateBuckets = new Map(); // key -> { count, windowStart }
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const b = rateBuckets.get(key);
  if (!b || now - b.windowStart >= windowMs) {
    rateBuckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  b.count += 1;
  return b.count <= max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of rateBuckets) if (now - b.windowStart > 15 * 60000) rateBuckets.delete(k);
}, 10 * 60000).unref();

/* ★ 09-19h G6-① token 生命周期（原来是无过期内存 Map——"敢公开演示"的第一道坎）：
 * ▎authTokens 值升级为 { username, displayName, expiresAt }；
 *   默认 24h（AUTH_TTL_MS 环境变量可调——信令回归用它开短 TTL 实测过期路径）；
 * ▎滑动续期：auth-verify / auth-refresh 命中即续期（真实产品的"活跃不掉线"语义）；
 *   auth-refresh = 显式续期信令（前端定时调，长期会话不中断）。 */
const AUTH_TTL_MS = Number(process.env.AUTH_TTL_MS) || 24 * 3600 * 1000;
const authTokens = new Map(); // token -> { username, expiresAt }
function issueToken(username) {
  const token = crypto.randomBytes(24).toString('hex');
  authTokens.set(token, { username, expiresAt: Date.now() + AUTH_TTL_MS });
  return token;
}
function validToken(token, username) {
  const t = authTokens.get(token);
  if (!t || t.username !== username) return false;
  if (Date.now() > t.expiresAt) { authTokens.delete(token); return false; }
  t.expiresAt = Date.now() + AUTH_TTL_MS; // 滑动续期：活跃会话不过期
  return true;
}
const clientIp = (socket) => (socket.handshake && socket.handshake.address) || 'unknown';"""
s = s.replace(old1, new1, 1)

# ── 2) 三个信令改用 issueToken/validToken + register/login 限流 ──
old2 = """    const token = crypto.randomBytes(24).toString('hex');
    authTokens.set(token, username);
    bindIdentity(username, users[username].displayName);
    console.log(`👤 注册成功: ${username}（昵称 ${users[username].displayName}）`);"""
assert old2 in s, 'a2'
new2 = """    if (!rateLimit(`reg:${clientIp(socket)}`, 30, 10 * 60000)) return fail(callback, '注册过于频繁，请稍后再试');
    const token = issueToken(username);
    bindIdentity(username, users[username].displayName);
    logEvent('info', 'auth-register', { username });
    console.log(`👤 注册成功: ${username}（昵称 ${users[username].displayName}）`);"""
s = s.replace(old2, new2, 1)

old3 = """    if (!u || hashPassword(password, u.salt) !== u.hash) return fail(callback, '用户名或密码不对');
    const token = crypto.randomBytes(24).toString('hex');
    authTokens.set(token, username);
    bindIdentity(username, u.displayName);"""
assert old3 in s, 'a3'
new3 = """    if (!rateLimit(`login:${clientIp(socket)}`, 20, 60000)) return fail(callback, '尝试过于频繁，请一分钟后再试');
    if (!u || hashPassword(password, u.salt) !== u.hash) return fail(callback, '用户名或密码不对');
    const token = issueToken(username);
    bindIdentity(username, u.displayName);"""
s = s.replace(old3, new3, 1)

old4 = """    if (!u || authTokens.get(token) !== username) return fail(callback, '登录态已失效，请重新登录');"""
assert old4 in s, 'a4'
new4 = """    if (!u || !validToken(token, username)) return fail(callback, '登录态已失效，请重新登录');"""
s = s.replace(old4, new4, 1)

# ── 3) auth-refresh 信令(挂在 auth-verify 后) ──
old5 = """    bindIdentity(username, u.displayName);
    ok(callback, { user: { username, displayName: u.displayName } });
  });"""
# 这个结尾在 auth-verify;找它最后一次出现(auth-verify 是最后一个 auth 信令)
idx = s.rfind(old5)
assert idx > 0, 'a5'
new5 = """    bindIdentity(username, u.displayName);
    ok(callback, { user: { username, displayName: u.displayName } });
  });
  // ★ 09-19h G6-①：显式滑动续期（前端每小时调一次，长期值守不掉线）
  socket.on('auth-refresh', ({ username, token } = {}, callback) => {
    if (!callback) return;
    const users = loadUsers();
    const u = users[username];
    if (!u || !validToken(token, username)) return fail(callback, '登录态已失效，请重新登录');
    ok(callback, { expiresAt: authTokens.get(token).expiresAt });
  });"""
s = s[:idx] + new5 + s[idx + len(old5):]

# ── 4) join-room / chat-message 限流 ──
old6 = """  socket.on('join-room', async ({ roomNumber, password } = {}, callback) => {"""
assert old6 in s, 'join sig'
s = s.replace(old6, old6 + """
    if (!rateLimit(`join:${socket.id}`, 20, 60000)) return; // ★ G6-③：防暴力猜 6 位房间号(静默丢弃,不给试探反馈)""", 1)

old7 = """  socket.on('chat-message', ({ text, msgId } = {}) => {
    if (!socket.roomNumber || typeof text !== 'string' || !text.trim()) return;"""
assert old7 in s, 'chat sig'
new7 = """  socket.on('chat-message', ({ text, msgId } = {}) => {
    if (!socket.roomNumber || typeof text !== 'string' || !text.trim()) return;
    if (!rateLimit(`chat:${socket.id}`, 40, 10000)) return; // ★ G6-③：防刷屏(静默丢弃)"""
s = s.replace(old7, new7, 1)

io.open(p, 'w', encoding='utf-8', newline=L).write(s)
print('G6-OK')
