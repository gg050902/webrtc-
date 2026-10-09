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

/* 解析与探测都已搬到 scripts/stun-probe.js（2026-10-09）：test:crossnet 要问同一个问题，
 * 两处各写一份 STUN 包构造迟早一份漂掉——而它漂掉的方式是"可达性测不出来"这种假故障。 */
const Stun = require('./stun-probe.js');
const parseUrl = Stun.parseUrl;

const stunBindingOnce = (host, port, timeoutMs) => Stun.binding(host, port, timeoutMs);

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
        const okTcp = (await Stun.tcpConnect(p.host, p.port, 3000)).ok;
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
