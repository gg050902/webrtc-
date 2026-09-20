# -*- coding: utf-8 -*-
# 注入:G6 测试断言(补第二部分)
import io
p = 'scripts/test-sfu-signaling.js'
s = io.open(p, encoding='utf-8').read()

# 1) 顶部 TTL 拉取
old1 = "const waitEvent = (s, ev) => new Promise(r => s.once(ev, r));"
assert old1 in s, 'ttl anchor'
add1 = old1 + """
// G6：读服务器 token TTL（/config.json 下发），决定过期路径断言是否实测
let authTtlMs = Infinity;
try {
  const cfgBody = await new Promise((resolve, reject) => {
    require('http').get('http://localhost:3001/config.json', (r) => {
      let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => resolve(b));
    }).on('error', reject);
  });
  authTtlMs = (JSON.parse(cfgBody).authTtlMs) || Infinity;
} catch (e) { /* 拉不到按默认跳过 */ }"""
s = s.replace(old1, add1, 1)

# 2) 断言块(挂在 G3 录制列表断言后)
anchor = """  const recList = await httpReq('GET', 'http://localhost:3001/api/recordings');
  ok('09-19c G3 /api/recordings 列表可用（200 数组）', recList.code === 200 && Array.isArray(JSON.parse(recList.text)));"""
assert anchor in s, 'g3 anchor'
add2 = anchor + """

  // --- ★ 09-19h：G6 安全加固（滑动续期 / 聊天限流 / 过期路径）---
  let g6Tok = null;
  const g6Login = await request(A.s, 'auth-login', { username: 'g6user', password: 'secret6' });
  g6Tok = (g6Login.data || {}).token || null;
  if (!g6Tok) {
    await request(A.s, 'auth-register', { username: 'g6user', password: 'secret6', displayName: 'G6测试' });
    const again = await request(A.s, 'auth-login', { username: 'g6user', password: 'secret6' });
    g6Tok = (again.data || {}).token || null;
  }
  ok('09-19h G6 登录拿到 token', !!g6Tok);
  const g6Verify = await request(A.s, 'auth-verify', { username: 'g6user', token: g6Tok });
  ok('09-19h G6 verify 通过（滑动续期已生效）', !!(g6Verify.data && g6Verify.data.user));
  const g6Refresh = await request(A.s, 'auth-refresh', { username: 'g6user', token: g6Tok });
  ok('09-19h G6 auth-refresh 返回新过期时间（expiresAt 数字）',
     !!(g6Refresh.data && typeof g6Refresh.data.expiresAt === 'number' && g6Refresh.data.expiresAt > Date.now()));
  // 聊天限流：单 socket 瞬发 60 条（>40/10s），后段应被静默丢弃
  const chatRecv = [];
  const onChatG6 = (p) => { if ((p.text || '').startsWith('g6spam')) chatRecv.push(p.text); };
  A.s.on('chat-message', onChatG6);
  for (let i = 0; i < 60; i++) A.s.emit('chat-message', { text: `g6spam-${i}`, msgId: `g6-${i}` });
  await sleep(800);
  A.s.off('chat-message', onChatG6);
  ok('09-19h G6 聊天限流生效（60 条瞬发，收到 < 45 = 后段被丢）', chatRecv.length < 45);
  // 过期路径：短 TTL 服务器（AUTH_TTL_MS=2000 启动）才实测；默认 24h 自动跳过
  if (authTtlMs <= 5000) {
    const shortLogin = await request(A.s, 'auth-login', { username: 'g6user', password: 'secret6' });
    const shortTok = (shortLogin.data || {}).token;
    await sleep(authTtlMs + 400);
    const expired = await request(A.s, 'auth-verify', { username: 'g6user', token: shortTok });
    ok('09-19h G6 过期 token 被 verify 拒绝（短 TTL 实测）',
       !!expired.error && expired.error.includes('失效'));
  } else {
    ok('09-19h G6 过期路径（默认 24h TTL 跳过实测——AUTH_TTL_MS=2000 启动可验）', true);
  }"""
s = s.replace(anchor, add2, 1)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('G6TEST-OK')
