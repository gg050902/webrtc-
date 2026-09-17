/* ══════════════════════════════════════════════════════════════
 * scripts/test-turn.js —— ICE 服务器可达性实测（跨网连接的前提验证）
 *
 * ▎做什么？对 sfu/config.json 里的每个 iceServers 条目发一个
 *   **STUN Binding Request**（UDP，20 字节），3 秒内收到 Binding Success
 *   即证明"这台机器到该服务器的 UDP 链路是通的"。
 *   STUN Binding 不需要账号密码——它验证的是**可达性**；TURN 的账号密码
 *   只在真正分配中继（Allocate）时才用，浏览器连 TURN 的第一步同样是 Binding。
 *
 * ▎用法：node scripts/test-turn.js   （读 sfu/config.json；没有就测默认 openrelay）
 * ══════════════════════════════════════════════════════════════ */
'use strict';
const dgram = require('dgram');
const net = require('net');
const fs = require('fs');
const path = require('path');

function loadIceServers() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'sfu', 'config.json'), 'utf8'));
    if (Array.isArray(cfg.iceServers) && cfg.iceServers.length) return cfg.iceServers;
  } catch (e) { /* 用默认 */ }
  return [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ];
}

/* 解析 stun:/turn: URL → { host, port, proto }（?transport=tcp 的 TCP 探测用 net，简化版只测 UDP 并标注） */
function parseUrl(u) {
  const m = /^(stun|turn|turns):([^:?]+):(\d+)(\?transport=(tcp|udp))?$/.exec(u);
  if (!m) return null;
  return { scheme: m[1], host: m[2], port: Number(m[3]), transport: m[5] || 'udp' };
}

/* 发 STUN Binding Request（RFC 5386：type=0x0001, len=0, magic=0x2112A444, 12B 随机事务号） */
function stunBindingOnce(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const tid = require('crypto').randomBytes(12);
    const req = Buffer.alloc(20);
    req.writeUInt16BE(0x0001, 0);          // Binding Request
    req.writeUInt16BE(0, 2);               // 消息长度
    req.writeUInt32BE(0x2112a444, 4);      // magic cookie
    tid.copy(req, 8);
    let done = false;
    const finish = (ok, note) => { if (done) return; done = true; clearTimeout(timer); try { sock.close(); } catch (e) {} resolve({ ok, note }); };
    const timer = setTimeout(() => finish(false, '超时（3s 无响应）'), timeoutMs);
    sock.on('message', (msg) => {
      if (msg.length >= 20 && msg.readUInt16BE(0) === 0x0101 && msg.slice(8, 20).equals(tid)) {
        finish(true, `收到 Binding Success（${msg.length}B）`);
      }
    });
    sock.on('error', (e) => finish(false, 'socket 错误: ' + e.message));
    sock.send(req, port, host, (err) => { if (err) finish(false, '发送失败: ' + err.message); });
  });
}

(async () => {
  const servers = loadIceServers();
  console.log('════ ICE 服务器可达性实测（STUN Binding / 3s 超时）════');
  let okCount = 0;
  for (const s of servers) {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    for (const u of urls) {
      const p = parseUrl(u);
      if (!p) { console.log(`  ⚠️ 无法解析: ${u}`); continue; }
      if (p.transport === 'tcp') {
        // TCP 链路探测：net 连上即证明链路通（TURN over TCP 的 Authenticate 在浏览器内进行）
        const okTcp = await new Promise((res) => {
          const s = net.connect({ host: p.host, port: p.port, timeout: 3000 }, () => { s.destroy(); res(true); });
          s.on('error', () => res(false));
          s.on('timeout', () => { s.destroy(); res(false); });
        });
        if (okTcp) okCount++;
        console.log(`  ${okTcp ? '✅ TCP 可达' : '❌ 不可达'}  ${u}  （UDP 被封时浏览器自动回退的通道）`);
        continue;
      }
      const r = await stunBindingOnce(p.host, p.port, 3000);
      if (r.ok) okCount++;
      console.log(`  ${r.ok ? '✅ 可达' : '❌ 不可达'}  ${u}  → ${r.note}`);
    }
  }
  console.log('──────────────────────────────────────────────────────');
  console.log(okCount > 0
    ? `✅ ${okCount} 个 UDP 通道可达：跨网连接的"先决条件"满足。若跨网仍连不上，检查浏览器端 🔗 徽标是否出现"TURN 中继"。`
    : '❌ 全部不可达：检查本机出网 UDP（防火墙/代理），或更换 iceServers。');
  process.exit(0);
})();
