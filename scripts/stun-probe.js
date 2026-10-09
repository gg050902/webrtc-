/* ══════════════════════════════════════════════════════════════
 * scripts/stun-probe.js —— 手搓 STUN Binding 探测（零依赖，跨网实测共用的一份实现）
 *
 * ▎为什么单独一个文件（2026-10-09，K1）：这段代码原先长在 scripts/test-turn.js 里，
 *   而新增的 test:crossnet 也要问同一个问题——"这台机器对外是什么地址、UDP 出得去吗"。
 *   两处各写一份 STUN 包构造，迟早一份漂掉（xor 系数、属性号写错的那个先骗人），
 *   而它骗人的方式是"可达性测不出来"或"公网地址读成 0.0.0.1"（坑 47 的探针版）。
 *
 * ▎STUN Binding 不需要账号密码：它验证的是**链路可达**，顺便把
 *   "NAT/防火墙认为我是什么地址"（XOR-MAPPED-ADDRESS）如实地还给我——
 *   这个反射地址才是外面的人真正该连的那个号。
 *   TURN 的用户名密码只在分配中继（Allocate）时才用，那是另一件事。
 *
 * 用法：
 *   const Stun = require('./stun-probe.js');
 *   await Stun.binding('stun.l.google.com', 19302, 3000)
 *     → { ok:true, note:'…', publicIp:'1.2.3.4', publicPort:52134 }
 * ══════════════════════════════════════════════════════════════ */
'use strict';
const dgram = require('dgram');
const net = require('net');
const crypto = require('crypto');

const MAGIC_COOKIE = 0x2112a444;             // RFC 5389：所有响应都按它做 xor 掩码
const ATTR_MAPPED_ADDRESS = 0x0001;          // 老属性（有些服务只回这个）
const ATTR_XOR_MAPPED_ADDRESS = 0x0020;      // 现代属性（必须优先认它）

/** 解析 stun:/turn:/turns: URL → { scheme, host, port, transport }；认不出返回 null。 */
function parseUrl(u) {
  const m = /^(stun|turn|turns):([^:?/]+):(\d+)(\?transport=(tcp|udp))?$/.exec(String(u || ''));
  if (!m) return null;
  return { scheme: m[1], host: m[2], port: Number(m[3]), transport: m[5] || 'udp' };
}

/** 从 Binding Success 里取反射地址（xor 解码按 RFC 5389：端口 xor 高 16 位、IPv4 xor 整个 cookie）。 */
function readMapped(msg) {
  let i = 20;                                // 跳过头（20 字节）
  let mapped = null;
  let xor = null;
  while (i + 4 <= msg.length) {
    const type = msg.readUInt16BE(i);
    const len = msg.readUInt16BE(i + 2);
    const val = msg.subarray(i + 4, i + 4 + len);
    if (type === ATTR_XOR_MAPPED_ADDRESS && len >= 8) {
      /* 布局（RFC 5389）：Reserved(1B) | Family(1B) | XOR Port(2B) | XOR Address(4B, IPv4)
       * ▎字节位置是这台探针唯一"写错不报错"的地方：家族读成 2 字节就会把端口高位混进来，
       *   于是所有响应都被判"没有映射属性"或解出 0.0.0.x —— 跨网建议会整个反着来。
       *   所以本文件带一条**自造响应**的自检（不依赖外网也能证伪自己）。 */
      const family = val[1];
      const port = val.readUInt16BE(2) ^ (MAGIC_COOKIE >>> 16);
      if (family === 0x01) {
        const b = val.subarray(4, 8);
        xor = {
          ip: [
            b[0] ^ ((MAGIC_COOKIE >>> 24) & 255),
            b[1] ^ ((MAGIC_COOKIE >>> 16) & 255),
            b[2] ^ ((MAGIC_COOKIE >>> 8) & 255),
            b[3] ^ (MAGIC_COOKIE & 255),
          ].join('.'),
          port,
        };
      }
    } else if (type === ATTR_MAPPED_ADDRESS && !mapped) {
      /* 老属性有**两种字节布局**，都得认（Google STUN 实测回的是 8 字节那种）：
       *   · RFC 3489 / len=8 ：Reserved(1B) | Family(1B) | Port(2B) | Address(4B)
       *   · RFC 5389 / len=10：Reserved(2B) | Family(2B) | Port(2B) | Address(4B)
       * 第一版我只按 10 字节那种写判据（len >= 10），于是**真响应被读成"没带映射属性"**——
       * 而跨网建议恰恰依赖这个数（把它读成 0.0.0.1 会让"你已在公网可达"和"你在 NAT 后"反过来）。 */
      const wide = len >= 10;
      const fam = wide ? val.readUInt16BE(2) : val[1];
      const port = val.readUInt16BE(wide ? 4 : 2);
      const at = wide ? 6 : 4;
      if (fam === 0x01 && len >= at + 4) {
        mapped = { ip: `${val[at]}.${val[at + 1]}.${val[at + 2]}.${val[at + 3]}`, port };
      }
    }
    i += 4 + len + ((len % 4) ? 4 - (len % 4) : 0);       // 属性按 4 字节对齐
  }
  // 两个都有时以 xor 版为准（部分实现的老属性不做端口掩码，读出来是错的）
  return xor || mapped;
}

/**
 * 发一次 STUN Binding Request，等响应（有界）。
 * @returns {Promise<{ok:boolean, note:string, publicIp?:string, publicPort?:number}>}
 */
function binding(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const tid = crypto.randomBytes(12);
    const req = Buffer.alloc(20);
    req.writeUInt16BE(0x0001, 0);            // Binding Request
    req.writeUInt16BE(0, 2);                 // 消息长度 0
    req.writeUInt32BE(MAGIC_COOKIE, 4);
    tid.copy(req, 8);
    let done = false;
    const finish = (ok, note, addr) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock.close(); } catch (e) { /* 已经关了 */ }
      resolve(Object.assign({ ok, note }, addr ? { publicIp: addr.ip, publicPort: addr.port } : {}));
    };
    const timer = setTimeout(() => finish(false, `超时（${Math.round(timeoutMs / 1000)}s 无响应）`), timeoutMs);
    sock.on('message', (msg) => {
      if (msg.length >= 20 && msg.readUInt16BE(0) === 0x0101 && msg.subarray(8, 20).equals(tid)) {
        const addr = readMapped(msg, tid);
        finish(true, `收到 Binding Success（${msg.length}B${addr ? ` · 反射地址 ${addr.ip}:${addr.port}` : ' · 但没带映射属性'}）`, addr);
      }
    });
    sock.on('error', (e) => finish(false, 'socket 错误: ' + e.message));
    sock.send(req, port, host, (err) => { if (err) finish(false, '发送失败: ' + err.message); });
  });
}

/** TCP 能否连上（连上即链路通；TURN over TCP 的鉴权发生在浏览器里，那是下一步）。 */
function tcpConnect(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: timeoutMs }, () => { s.destroy(); resolve({ ok: true, note: 'TCP 可连' }); });
    s.on('error', (e) => resolve({ ok: false, note: 'TCP 连不上: ' + e.message }));
    s.on('timeout', () => { s.destroy(); resolve({ ok: false, note: `TCP 超时（${Math.round(timeoutMs / 1000)}s）` }); });
  });
}

module.exports = { parseUrl, binding, tcpConnect, readMapped, MAGIC_COOKIE };

/* ── 自测：`node scripts/stun-probe.js --selftest` ─────────────────────────
 * ▎为什么一台探针要自带自检：它唯一的失败模式是"把有说成没有"（解析错字节 →
 *   报"没带映射属性"），而那正好是 test:crossnet 最想得到的信息。
 *   对着外网测不出来对错，所以要能**自己造一份响应**验解析。 */
if (require.main === module && process.argv.indexOf('--selftest') >= 0) {
  const t = require('crypto').randomBytes(12);
  const mk = (attrs) => {
    const head = Buffer.alloc(20);
    head.writeUInt16BE(0x0101, 0);
    head.writeUInt32BE(0x2112a444, 4);
    t.copy(head, 8);
    head.writeUInt16BE(attrs.reduce((n, a) => n + 4 + a.length, 0), 2);
    return Buffer.concat([head].concat(attrs.map((a, k) => {
      const h = Buffer.alloc(4);
      h.writeUInt16BE(a.type, 0);
      h.writeUInt16BE(a.len !== undefined ? a.len : a.body.length, 2);
      return Buffer.concat([h, a.body]);
    })));
  };
  const xorBody = Buffer.alloc(8);
  xorBody[0] = 0; xorBody[1] = 1;
  xorBody.writeUInt16BE(45444 ^ (MAGIC_COOKIE >>> 16), 2);          // 端口 45444 掩码后
  const ip = [203, 0, 113, 195];                                     // TEST-NET-3，文档用公网段
  xorBody[4] = ip[0] ^ ((MAGIC_COOKIE >>> 24) & 255);
  xorBody[5] = ip[1] ^ ((MAGIC_COOKIE >>> 16) & 255);
  xorBody[6] = ip[2] ^ ((MAGIC_COOKIE >>> 8) & 255);
  xorBody[7] = ip[3] ^ (MAGIC_COOKIE & 255);
  const plainBody = Buffer.alloc(12);
  plainBody.writeUInt16BE(0x01, 2); plainBody.writeUInt16BE(50001, 4);
  [203, 0, 113, 9].forEach((v, k) => { plainBody[6 + k] = v; });
  let pass = 0; let fail = 0;
  const chk = (name, cond, got) => { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + ' — ' + JSON.stringify(got)); } };
  const r1 = readMapped(mk([{ type: 0x0020, body: xorBody }]));
  chk('XOR-MAPPED-ADDRESS 解出正确的 IPv4', r1 && r1.ip === '203.0.113.195', r1);
  chk('XOR 端口还原（掩码解回去）', r1 && r1.port === 45444, r1);
  const r2 = readMapped(mk([{ type: 0x8022, body: Buffer.alloc(4) }, { type: 0x0020, body: xorBody }]));
  chk('未知属性不干扰后续解析（按 4 字节对齐跳过）', r2 && r2.ip === '203.0.113.195', r2);
  const r3 = readMapped(mk([{ type: 0x0001, body: plainBody }]));
  chk('老属性 MAPPED-ADDRESS 也解得对（家族/端口/IP 各就各位）', r3 && r3.ip === '203.0.113.9' && r3.port === 50001, r3);
  const both = readMapped(mk([{ type: 0x0001, body: plainBody }, { type: 0x0020, body: xorBody }]));
  chk('两个都在时以 xor 版优先（老属性可能没做端口掩码）', both && both.ip === '203.0.113.195', both);
  const plain8 = Buffer.alloc(8);
  plain8[0] = 0; plain8[1] = 1;                       // Reserved(1) + Family IPv4(1)
  plain8.writeUInt16BE(45521, 2);
  [203, 0, 113, 208].forEach((v, k) => { plain8[4 + k] = v; });
  const r4 = readMapped(mk([{ type: 0x0001, len: 8, body: plain8 }]));
  chk('★ 真响应形状：8 字节老 MAPPED-ADDRESS（Google STUN 实测就是这种；IP 用 RFC5737 文档段，不写真值）也解得对',
    r4 && r4.ip === '203.0.113.208' && r4.port === 45521, r4);
  const p = parseUrl('turn:openrelay.metered.ca:443?transport=tcp');
  chk('URL 解析带 ?transport=tcp', !!p && p.host === 'openrelay.metered.ca' && p.transport === 'tcp', p);
  chk('认不出的 URL 返回 null（不猜）', parseUrl('http://example.com') === null);
  console.log(`
stun-probe 自检: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}
