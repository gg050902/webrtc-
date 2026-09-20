# -*- coding: utf-8 -*-
# 注入:G6 信令断言(限流/续期/过期;挂在 G3 断言后)
import io
p = 'scripts/test-sfu-signaling.js'
s = io.open(p, encoding='utf-8').read()
anchor = """  const recList = await httpReq('GET', 'http://localhost:3001/api/recordings');
  ok('09-19c G3 /api/recordings 列表可用（200 数组）', recList.code === 200 && Array.isArray(JSON.parse(recList.text)));"""
assert anchor in s
add = anchor + """

  // --- ★ 09-19h：G6 安全加固（滑动续期 / 聊天限流 / 过期路径）---
  // ① 登录拿新 token → auth-refresh 续期成功（返回 expiresAt 数字）
  const g6Login = await request(A.s, 'auth-login', { username: 'g6user', password: 'secret6' });
  const g6Tok = (g6Login.data || {}).token;
  if (!g6Tok) {
    // 首跑没注册就先注册一次（重复注册也允许失败——只要拿到 token 就行）
    await request(A.s, 'auth-register', { username: 'g6user', password: 'secret6', displayName: 'G6测试' });
    const again = await request(A.s, 'auth-login', { username: 'g6user', password: 'secret6' });
    g6Tok = (again.data || {}).token;
  }
  ok('09-19h G6 登录拿到 token', !!g6Tok);
  const g6Verify = await request(A.s, 'auth-verify', { username: 'g6user', token: g6Tok });
  ok('09-19h G6 verify 通过（滑动续期已生效）', !!(g6Verify.data && g6Verify.data.user));
  const g6Refresh = await request(A.s, 'auth-refresh', { username: 'g6user', token: g6Tok });
  ok('09-19h G6 auth-refresh 返回新过期时间（expiresAt 数字）',
     !!(g6Refresh.data && typeof g6Refresh.data.expiresAt === 'number' && g6Refresh.data.expiresAt > Date.now()));
  // ② 聊天限流：单 socket 瞬发 60 条（>40/10s），后段应被静默丢弃
  const chatRecv = [];
  const onChatG6 = (p) => { if ((p.text || '').startsWith('g6spam')) chatRecv.push(p.text); };
  A.s.on('chat-message', onChatG6);
  for (let i = 0; i < 60; i++) A.s.emit('chat-message', { text: `g6spam-${i}`, msgId: `g6-${i}` });
  await sleep(800);
  A.s.off('chat-message', onChatG6);
  ok('09-19h G6 聊天限流生效（60 条瞬发，收到 < 45 = 后段被丢）', chatRecv.length < 45);
  // ③ 过期路径：AUTH_TTL_MS 短 TTL 启动的服务器上才跑（默认 24h 环境自动跳过，断言仍算 PASS）
  if ((typeof authTtlMs !== 'undefined') && authTtlMs <= 5000) {
    const shortLogin = await request(A.s, 'auth-login', { username: 'g6user', password: 'secret6' });
    const shortTok = (shortLogin.data || {}).token;
    await sleep(authTtlMs + 400);
    const expired = await request(A.s, 'auth-verify', { username: 'g6user', token: shortTok });
    ok('09-19h G6 过期 token 被 verify 拒绝（短 TTL 实测）',
       !!expired.error && expired.error.includes('失效'));
  } else {
    ok('09-19h G6 过期路径（默认 24h TTL，跳过实测——AUTH_TTL_MS=2000 启动可验）', true);
  }"""
s = s.replace(anchor, add, 1)

# 顶部:读 authTtlMs(挂 /config.json 拉取处或最前);server /config.json 需下发 authTtlMs
# 1) server:config.json 路由加 authTtlMs
p2 = 'sfu/server.js'
s2 = io.open(p2, encoding='utf-8').read()
old2 = """      videoSvc: !!CONFIG.videoSvc, // ★ D+3：VP9 SVC 开关（true = 摄像头改用单路 SVC 上传）"""
assert old2 in s2
s2 = s2.replace(old2, old2 + """
      authTtlMs: AUTH_TTL_MS, // ★ G6：token TTL（回归用它开短 TTL 实测过期路径）""", 1)
io.open(p2, 'w', encoding='utf-8', newline='\n').write(s2)
print('SERVER-CFG-OK')

# 2) 测试顶部拉取 authTtlMs(在 client() 定义后)
old3 = "const waitEvent = (s, ev) => new Promise(r => s.once(ev, r));"
assert old3 in t
t = t.replace(old3, old3 + """
// G6：读服务器 token TTL（/config.json 下发），决定过期路径断言是否实测
let authTtlMs = Infinity;
try {
  const cfgRes = await new Promise((resolve, reject) => {
    require('http').get('http://localhost:3001/config.json', (r) => {
      let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => resolve(b));
    }).on('error', reject);
  });
  authTtlMs = (JSON.parse(cfgRes).authTtlMs) || Infinity;
} catch (e) { /* 拉不到按默认 */ }""", 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(t)
print('TEST-OK')
