/* ══════════════════════════════════════════════════════════════
 * scripts/doctor.js —— 项目自检医生（零依赖，一条命令回答四个问题）
 *
 * ▎为什么要有它？用户反复卡在同样四句话上：
 *   ① "后端起不来 / 启动不顺畅"   → A 组（环境）+ C 组（端口）
 *   ② "跨网连不上"                → B2（announcedIp）+ D 组（STUN/TURN/HTTPS）
 *   ③ "字幕 / 滤镜 / 录制不工作"  → 这几样都吃"安全上下文 + ffmpeg + HTTPS"，
 *                                   对应 A5（ffmpeg）、B4（HTTPS 证书）、D3（HTTPS 入口）
 *   ④ "环境到底缺什么"            → A 组一次性列清（Node / mediasoup / worker / openssl / ffmpeg）
 *
 * ▎设计原则：
 *   · **零依赖**：只用 Node 内置模块（不 require 任何 node_modules，缺依赖时也能跑）；
 *   · **不依赖外部命令**：端口用 net.connect 探、STUN 用 20 字节 UDP 手搓包探，
 *     只有 openssl / ffmpeg 的存在性必须问系统（这两项本身就是被检查对象）；
 *   · **只读**：不改配置、不写文件、不起服务、不杀进程——诊断工具不该有副作用；
 *   · 每项输出 ✅ / ⚠️ / ❌ + 一句"人话"修复建议；有 ❌ 退出码 1，否则 0。
 *
 * ▎用法：
 *   node scripts/doctor.js           人类可读的自检报告（分组 + 缩进 + 总结）
 *   node scripts/doctor.js --json    只输出一份 JSON（给脚本/CI 消费）
 *   npm run doctor                   等价于第一条
 * ══════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const dgram = require('dgram');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const JSON_MODE = process.argv.includes('--json');

const ROOT = path.join(__dirname, '..');
const SFU_DIR = path.join(ROOT, 'sfu');
const CONFIG_PATH = path.join(SFU_DIR, 'config.json');
const WORKER_EXE = path.join(ROOT, 'node_modules', 'mediasoup', 'worker', 'out', 'Release',
  process.platform === 'win32' ? 'mediasoup-worker.exe' : 'mediasoup-worker');

const DEFAULT_SFU_PORT = 3001;
const DEFAULT_HTTPS_PORT = 3443;
const MESH_PORT = 3000;        // Mesh 对照版（根目录 server.js）
const RECORD_BASE_PORT = 50000; // D+2 服务器侧录制：ffmpeg 收 RTP 的端口从这里起
const MIN_NODE_MAJOR = 18;     // 项目用到的 fetch/AbortController/structuredClone 等 API 门槛

/* ── 结果收集器：所有检查都往里塞一条，最后统一渲染 ────────────── */
const GROUPS = [
  { id: 'A', title: 'A. 环境（Node / 依赖 / 外部工具）' },
  { id: 'B', title: 'B. 配置（sfu/config.json）' },
  { id: 'C', title: 'C. 端口与运行态' },
  { id: 'D', title: 'D. 跨网可达性（跨网连不上的真正答案在这里）' },
];
const results = [];

/**
 * 记一条检查结果。
 * @param {string} group  'A'|'B'|'C'|'D'
 * @param {string} id     稳定 id（--json 消费方按它定位）
 * @param {'ok'|'warn'|'fail'|'skip'} status
 * @param {string} title  一句话结论（人类可读）
 * @param {object} [opt]  { detail, advice, priority }
 *   priority 越小越靠前，用于挑"最可能卡住你的三条"
 */
function add(group, id, status, title, opt = {}) {
  results.push({
    group,
    id,
    status,
    title,
    detail: opt.detail || '',
    advice: opt.advice || '',
    priority: typeof opt.priority === 'number' ? opt.priority : 50,
  });
}

/* ── 通用小工具 ──────────────────────────────────────────────── */

/** TCP 探活：能连上 = 端口有人在听（比 netstat 干净，且不依赖系统命令） */
function probeTcp(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (open) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(open);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host);
  });
}

/** get / post 的极简封装（自签证书允许忽略校验；永远 resolve，不抛） */
function httpGetText(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let req;
    try {
      const lib = url.startsWith('https:') ? https : http;
      req = lib.get(url, {
        agent: false,                 // 别复用连接池：否则 keep-alive 句柄会把进程挂住
        rejectUnauthorized: false,    // 自签开发证书 → 忽略校验（就要这个）
        timeout: timeoutMs,
      }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ ok: true, status: res.statusCode, body }));
      });
      req.on('timeout', () => { req.destroy(new Error(`${timeoutMs}ms 超时`)); });
      req.on('error', (e) => resolve({ ok: false, status: 0, error: e.message }));
    } catch (e) {
      resolve({ ok: false, status: 0, error: e.message });
    }
  });
}

/**
 * 手搓一个 STUN Binding Request（RFC 5389）——共 20 字节：
 *   [0..1] 消息类型 0x0001（Binding Request）
 *   [2..3] 消息长度 0x0000（无属性）
 *   [4..7] Magic Cookie 0x2112A442（判定"这确实是一个 STUN 包"）
 *   [8..19] 12 字节随机事务号（响应会原样回带，用来确认"这是我发的那次"）
 * 收到 0x0101（Binding Success）即证明：本机到该服务器的这条 UDP 链路是通的。
 * 注意：Binding **不需要账号密码**——TURN 的账号只在真正 Allocate 时才用，
 *       浏览器连 TURN 的第一步也是 Binding，所以这个探测足以证明"可达性"。
 */
function stunProbe(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const tid = crypto.randomBytes(12);
    const req = Buffer.alloc(20);
    req.writeUInt16BE(0x0001, 0);          // Binding Request
    req.writeUInt16BE(0, 2);               // 长度 0
    req.writeUInt32BE(0x2112a442, 4);      // Magic Cookie
    tid.copy(req, 8);                      // 事务号
    let done = false;
    const finish = (ok, note) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock.close(); } catch (e) { /* 已关 */ }
      resolve({ ok, note });
    };
    const timer = setTimeout(
      () => finish(false, `${timeoutMs}ms 无响应（UDP 被防火墙/运营商/路由器封了）`), timeoutMs);
    sock.on('message', (msg) => {
      if (msg.length < 20) return;
      const type = msg.readUInt16BE(0);
      if (type === 0x0101 && msg.subarray(8, 20).equals(tid)) {
        finish(true, `收到 Binding Success（${msg.length}B）`);
      } else if (type === 0x0111) {          // Binding Error：链路通，只是这次请求被拒
        finish(true, `收到 Binding Error（${msg.length}B，链路通）`);
      }
    });
    sock.on('error', (e) => finish(false, 'socket 错误：' + e.message));
    try {
      sock.send(req, port, host, (err) => { if (err) finish(false, '发送失败：' + err.message); });
    } catch (e) {
      finish(false, '发送失败：' + e.message);
    }
  });
}

/** 解析 stun:/turn:/turns: URL → { scheme, host, port, transport } */
function parseIceUrl(u) {
  const m = /^(stun|turn|turns):([^:?]+):(\d+)(\?transport=(tcp|udp))?$/i.exec(String(u));
  if (!m) return null;
  return {
    scheme: m[1].toLowerCase(),
    host: m[2],
    port: Number(m[3]),
    transport: (m[5] || (m[1].toLowerCase() === 'turns' ? 'tcp' : 'udp')).toLowerCase(),
  };
}

/** UDP 端口能不能独占绑定（= 空闲）；被占用 / 无权限都返回 false */
function probeUdpBindFree(port) {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    let done = false;
    const finish = (free) => {
      if (done) return;
      done = true;
      try { s.close(); } catch (e) { /* 已关 */ }
      resolve(free);
    };
    s.once('error', () => finish(false));
    try {
      s.bind({ port, address: '0.0.0.0', exclusive: true }, () => finish(true));
    } catch (e) {
      finish(false);
    }
  });
}

/** 本机所有非回环 IPv4（跳过 169.254 自动私有地址，它不是"能用"的地址） */
function localIPv4s() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      const isV4 = a.family === 'IPv4' || a.family === 4;
      if (!isV4 || a.internal) continue;
      out.push({ name, address: a.address, linkLocal: /^169\.254\./.test(a.address) });
    }
  }
  return out;
}

/** 从候选里挑一个"最像局域网地址"的（192.168 / 10. / 172.16-31） */
function pickLanIp(list) {
  const usable = list.filter((c) => !c.linkLocal);
  const prefer = usable.filter((c) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(c.address));
  return prefer[0] || usable[0] || null;
}

/** openssl 是否可用：先看 PATH，再看 Git for Windows 自带的目录 */
function probeOpenssl() {
  try {
    const out = execFileSync('openssl', ['version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return { ok: true, where: 'PATH', version: out.trim() };
  } catch (e) { /* 继续找 */ }
  const guesses = [
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
    'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
    'C:\\Program Files (x86)\\Git\\usr\\bin\\openssl.exe',
  ];
  for (const p of guesses) {
    try {
      if (!fs.existsSync(p)) continue;
      const out = execFileSync(p, ['version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return { ok: false, where: '仅 Git 目录（不在 PATH）', path: p, version: out.trim() };
    } catch (e) { /* 试下一个 */ }
  }
  return { ok: false, where: null };
}

/** ffmpeg 是否可用：PATH 优先，Windows 再兜底扫 winget 包目录（和 sfu/server.js 的探测口径一致） */
function probeFfmpeg() {
  try {
    const out = execFileSync('ffmpeg', ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return { ok: true, bin: 'ffmpeg', version: (out.split('\n')[0] || '').trim() };
  } catch (e) { /* 继续找 */ }
  const dirs = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages'),
    'C:\\Program Files\\WinGet\\Packages',
  ].filter(Boolean);
  for (const dir of dirs) {
    try {
      const found = execFileSync('where', ['/r', dir, 'ffmpeg.exe'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/).filter(Boolean);
      for (const p of found) {
        try {
          const out = execFileSync(p.trim(), ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
          return { ok: true, bin: p.trim(), version: (out.split('\n')[0] || '').trim(), note: 'winget 目录兜底找到（不在 PATH）' };
        } catch (e2) { /* 试下一个 */ }
      }
    } catch (e3) { /* 目录不存在 */ }
  }
  return { ok: false };
}

/** 读证书到期时间：优先 crypto.X509Certificate（Node 内置），退路 openssl x509 -enddate */
function certNotAfter(certPath) {
  let pem = null;
  try { pem = fs.readFileSync(certPath, 'utf8'); } catch (e) { return { date: null, source: null, error: e.message }; }
  try {
    if (typeof crypto.X509Certificate === 'function') {
      const c = new crypto.X509Certificate(pem);
      const d = new Date(c.validTo);
      if (!isNaN(d.getTime())) return { date: d, source: 'crypto.X509Certificate', subject: c.subject };
    }
  } catch (e) { /* 退路 */ }
  try {
    const out = execFileSync('openssl', ['x509', '-noout', '-enddate', '-in', certPath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = /notAfter=(.+)/.exec(out);
    if (m) {
      const d = new Date(m[1].trim());
      if (!isNaN(d.getTime())) return { date: d, source: 'openssl', subject: null };
    }
  } catch (e) { /* 都不可用 */ }
  return { date: null, source: null };
}

/* ── 读配置（先读，后面 B/C/D 都要用） ───────────────────────── */
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { exists: false, ok: false, cfg: {}, error: null };
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '');
    const cfg = JSON.parse(raw);
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('顶层必须是一个 JSON 对象');
    return { exists: true, ok: true, cfg, error: null };
  } catch (e) {
    return { exists: true, ok: false, cfg: {}, error: e.message };
  }
}

const FIREWALL_HINT = [
  '以管理员身份执行（或直接跑 npm run start:lan 自动放行）：',
  'netsh advfirewall firewall add rule name="meeting-web-tcp" dir=in action=allow protocol=TCP localport=3001,3443',
  'netsh advfirewall firewall add rule name="meeting-sfu-udp" dir=in action=allow protocol=UDP localport=40000-49999',
].join('\n      ');

/* ══════════════════════════════════════════════════════════════
 * 主流程
 * ══════════════════════════════════════════════════════════════ */
(async function main() {
  const loaded = loadConfig();
  const cfg = loaded.cfg;
  const sfuPort = Number(cfg.port) || DEFAULT_SFU_PORT;
  const httpsCfg = cfg.https || {};
  const httpsEnabled = !!httpsCfg.enabled;
  const httpsPort = Number(httpsCfg.port) || DEFAULT_HTTPS_PORT;
  const announcedIp = typeof cfg.announcedIp === 'string' ? cfg.announcedIp.trim() : '';
  const listenIp = typeof cfg.listenIp === 'string' && cfg.listenIp.trim() ? cfg.listenIp.trim() : '0.0.0.0';
  const nics = localIPv4s();
  const lanIp = pickLanIp(nics);

  /* ════════ A. 环境 ════════ */

  // A1 Node 版本
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor >= MIN_NODE_MAJOR) {
    add('A', 'A1-node', 'ok', `Node ${process.versions.node}（≥${MIN_NODE_MAJOR}，满足项目要求）`,
      { detail: `可执行文件：${process.execPath}`, priority: 90 });
  } else {
    add('A', 'A1-node', 'fail', `Node ${process.versions.node} 太旧（项目需要 ≥${MIN_NODE_MAJOR}）`,
      {
        detail: `当前主版本 ${nodeMajor}，mediasoup 3.x 与前端 fetch/structuredClone 等 API 都会失败`,
        advice: '去 https://nodejs.org 装 Node 20 LTS 或更新版本，装完重开命令行（node -v 确认）',
        priority: 1,
      });
  }

  // A2 关键依赖
  const depMissing = [];
  for (const name of ['mediasoup', 'socket.io']) {
    if (!fs.existsSync(path.join(ROOT, 'node_modules', name))) depMissing.push(name);
  }
  if (!depMissing.length) {
    let ver = '';
    try { ver = require(path.join(ROOT, 'node_modules', 'mediasoup', 'package.json')).version; } catch (e) { /* 忽略 */ }
    add('A', 'A2-deps', 'ok', `关键依赖已安装（mediasoup ${ver || '?'} / socket.io）`,
      { detail: 'node_modules 下能找到两个包', priority: 80 });
  } else {
    add('A', 'A2-deps', 'fail', `缺少依赖：${depMissing.join(' / ')}`,
      {
        detail: '后端起不来最常见的原因之一（require 直接抛错）',
        advice: '在项目根目录执行 npm install；若 npm install 在 mediasoup 处失败，见下一条（worker 二进制手放）',
        priority: 2,
      });
  }

  // A3 mediasoup worker 二进制（本项目最大的坑）
  const workerAlt = WORKER_EXE.replace(/\.exe$/, '');
  if (fs.existsSync(WORKER_EXE) || fs.existsSync(workerAlt)) {
    add('A', 'A3-worker', 'ok', 'mediasoup worker 二进制存在（启动不会卡在这一步）',
      { detail: path.relative(ROOT, fs.existsSync(WORKER_EXE) ? WORKER_EXE : workerAlt), priority: 85 });
  } else {
    add('A', 'A3-worker', 'fail', 'mediasoup worker 二进制缺失 —— 服务器必定启动失败（本项目最大的坑）',
      {
        detail: `期望路径：${path.relative(ROOT, WORKER_EXE)}`,
        advice: '注意：直接 npm install 也补不回来（.npmrc 里 ignore-scripts=true，postinstall 拉不到）。'
          + '请按 AGENTS.md「坑 12」手动放置：npm pack mediasoup → 解包 → 下载官方 release 的 '
          + 'mediasoup-worker-3.26.0-win32-x64.tgz → 放进 node_modules/mediasoup/worker/out/Release/（两份：带 .exe 与不带）',
        priority: 1,
      });
  }

  // A4 openssl（HTTPS 自签要用）
  const ssl = probeOpenssl();
  const certPathCfg = httpsCfg.cert || path.join(SFU_DIR, 'tls', 'dev-cert.pem');
  const keyPathCfg = httpsCfg.key || path.join(SFU_DIR, 'tls', 'dev-key.pem');
  const certsExist = fs.existsSync(certPathCfg) && fs.existsSync(keyPathCfg);
  if (ssl.ok) {
    add('A', 'A4-openssl', 'ok', `openssl 可用（${ssl.version || 'path 中就绪'}）`,
      { detail: 'HTTPS 证书缺失时服务器能自动自签（sfu/tls/）', priority: 70 });
  } else if (certsExist) {
    add('A', 'A4-openssl', 'warn', 'openssl 不在 PATH（但证书已存在，不影响现在运行）',
      {
        detail: ssl.where ? `仅在 ${ssl.where}：${ssl.path}` : 'PATH 与 Git 目录都没找到',
        advice: '只有"证书丢了要重新自签"时才会用到。到时可用 Git Bash 里跑，或把 Git 的 usr/bin 加进 PATH',
        priority: 70,
      });
  } else {
    add('A', 'A4-openssl', 'fail', 'openssl 不可用，且 sfu/tls/ 里没有证书 → HTTPS 起不来',
      {
        detail: '没有 HTTPS 就没有安全上下文：跨机访问时浏览器会拒绝开摄像头（字幕/滤镜/共享全都用不了）',
        advice: '装 Git for Windows（自带 openssl）并把 <Git>\\usr\\bin 加进 PATH，或手动放一对证书到 sfu/tls/dev-cert.pem + dev-key.pem',
        priority: 3,
      });
  }

  // A5 ffmpeg（服务器侧录制 D+2 要用）
  const ff = probeFfmpeg();
  if (ff.ok) {
    add('A', 'A5-ffmpeg', 'ok', 'ffmpeg 可用（服务器侧录制 D+2 就绪）',
      { detail: `${ff.version || ''}${ff.note ? ' · ' + ff.note : ''}`.trim() || ff.bin, priority: 60 });
  } else {
    add('A', 'A5-ffmpeg', 'fail', 'ffmpeg 不可用 → 「⏺ 服务器录制」点了会返回安装提示',
      {
        detail: '其它功能（会议/字幕/滤镜）不受影响，只有 D+2 服务器侧录制需要它',
        advice: 'winget install --id Gyan.FFmpeg -e   （装完重开命令行，再重启服务器；服务器会自动扫 winget 目录）',
        priority: 12,
      });
  }

  /* ════════ B. 配置 ════════ */

  // B1 config.json 存在且合法
  if (!loaded.exists) {
    add('B', 'B1-config', 'warn', 'sfu/config.json 不存在 → 服务器用默认值运行（本机演示模式）',
      {
        detail: '默认：端口 3001、listenIp 0.0.0.0、无 announcedIp、无 TURN、HTTPS 关闭',
        advice: '想要"别的电脑能连"，跑一次 npm run start:lan 生成配置（或复制 config.example.json 改名）',
        priority: 8,
      });
  } else if (!loaded.ok) {
    add('B', 'B1-config', 'fail', `sfu/config.json 不是合法 JSON：${loaded.error}`,
      {
        detail: '服务器读不动会**静默退回默认值**——你以为配了 announcedIp/TURN，其实一个都没生效（跨网必挂）',
        advice: '检查是不是多了逗号 / 用了中文引号 / 少了花括号；也可以直接跑 npm run start:lan 重新生成（会自动备份旧的）',
        priority: 2,
      });
  } else {
    add('B', 'B1-config', 'ok', 'sfu/config.json 存在且是合法 JSON',
      { detail: `字段：${Object.keys(cfg).join(', ')}`, priority: 88 });
  }

  // B2 announcedIp vs 本机实际 IPv4（"别的电脑看不到画面"的头号原因）
  const nicList = nics.map((c) => `${c.address}(${c.name}${c.linkLocal ? '·自动私有' : ''})`).join('  ') || '（没有非回环网卡）';
  if (!announcedIp) {
    add('B', 'B2-announcedIp', 'fail', 'announcedIp 没配 —— 别的电脑 100% 看不到你的画面',
      {
        detail: `本机网卡：${nicList}`,
        advice: lanIp
          ? `在 sfu/config.json 加一行 "announcedIp": "${lanIp.address}"（或直接跑 npm run start:lan 自动写）`
          : '本机没探测到可用局域网 IPv4（没连网？），连上网络后再配',
        priority: 1,
      });
  } else if (/^127\./.test(announcedIp)) {
    add('B', 'B2-announcedIp', 'fail', `announcedIp=${announcedIp} 是回环地址，别的电脑连不到`,
      {
        detail: `本机网卡：${nicList}`,
        advice: `改成局域网 IP，例如 "announcedIp": "${lanIp ? lanIp.address : '192.168.x.x'}"`,
        priority: 1,
      });
  } else if (!nics.some((c) => c.address === announcedIp)) {
    add('B', 'B2-announcedIp', 'warn',
      `announcedIp=${announcedIp} 与本机实际 IPv4（${lanIp ? lanIp.address : '无'}）不一致 —— 这是"别的电脑看不到画面"的头号原因`,
      {
        detail: `本机所有网卡：${nicList}。媒体面会把 announcedIp 告诉对方，对方按这个地址回连；写错了就是"能进房、黑屏/转圈"`,
        advice: (lanIp
          ? `改 sfu/config.json： "announcedIp": "${lanIp.address}" （换 WiFi/重启路由器后 IP 会变，每次重跑 npm run start:lan 最省事）`
          : '先把机器连上局域网，再填它的 IPv4')
          + '。同一个问题服务器启动时也会自检一次（日志里打 "❌ announcedIp=... 与本机网卡不匹配"），两处告警指的是同一件事',
        priority: 1,
      });
  } else {
    const here = nics.find((c) => c.address === announcedIp);
    add('B', 'B2-announcedIp', 'ok', `announcedIp=${announcedIp} 与本机网卡一致（${here ? here.name : '?'}）`,
      {
        detail: nics.length > 1 ? `注意本机有多个 IPv4：${nicList}（用错网卡时对方仍连不上）` : '跨机媒体面地址正确',
        priority: 95,
      });
  }

  // B3 listenIp / 端口 / RTC 端口段
  const b3detail = [];
  let b3status = 'ok';
  let b3advice = '';

  if (listenIp === '0.0.0.0' || listenIp === '::') {
    b3detail.push('listenIp=0.0.0.0（监听所有网卡，跨机可连）');
  } else if (/^127\./.test(listenIp)) {
    b3status = 'warn';
    b3detail.push('listenIp=127.0.0.1（只监听本机）');
    b3advice += '想让别的电脑连进来，把 listenIp 改成 "0.0.0.0"。';
  } else if (nics.some((c) => c.address === listenIp)) {
    b3detail.push(`listenIp=${listenIp}（绑定单个网卡，能用但换网络会失效）`);
  } else {
    b3status = 'warn';
    b3detail.push(`listenIp=${listenIp} 不是本机任何一块网卡的地址`);
    b3advice += 'listenIp 建议写 "0.0.0.0"（除非明确知道只绑哪块网卡）。';
  }

  if (sfuPort < 1024) {
    b3status = 'warn';
    b3detail.push(`端口 ${sfuPort} < 1024（Linux/macOS 需要 root 才能监听）`);
    b3advice += `换成 1024 以上的端口（如 3001）。`;
  } else {
    b3detail.push(`主端口 ${sfuPort}（>1024，无需特权）`);
  }

  const rtcMin = Number(cfg.rtcMinPort) || 40000;
  const rtcMax = Number(cfg.rtcMaxPort) || 49999;
  if (!(rtcMin > 0 && rtcMax > rtcMin)) {
    b3status = 'fail';
    b3detail.push(`RTC 端口段不合法：${rtcMin}~${rtcMax}`);
    b3advice += 'rtcMaxPort 必须大于 rtcMinPort（默认 40000~49999）。';
  } else {
    b3detail.push(`RTC 端口段 ${rtcMin}~${rtcMax}（共 ${rtcMax - rtcMin + 1} 个 UDP 端口）`);
    if (rtcMax - rtcMin + 1 < 100) {
      b3status = b3status === 'fail' ? 'fail' : 'warn';
      b3advice += `端口段太小（<100），多人并发时可能分不到端口；建议 40000~49999。`;
    }
    if (rtcMax >= RECORD_BASE_PORT) {
      b3status = b3status === 'fail' ? 'fail' : 'warn';
      b3advice += `端口段压到了录制用的 ${RECORD_BASE_PORT}+（D+2 的 ffmpeg 收流口），建议 rtcMaxPort ≤ 49999。`;
    }
  }

  // 端口段占用抽样：绑 min / min+1 / 中位 / max 四个 UDP 端口试试
  const samples = [...new Set([rtcMin, rtcMin + 1, Math.floor((rtcMin + rtcMax) / 2), rtcMax])]
    .filter((p) => p > 0 && p < 65536);
  const busy = [];
  for (const p of samples) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await probeUdpBindFree(p))) busy.push(p);
  }
  const dupePorts = [sfuPort, httpsPort].filter((p) => p >= rtcMin && p <= rtcMax);
  if (dupePorts.length) {
    b3status = b3status === 'fail' ? 'fail' : 'warn';
    b3detail.push(`⚠️ 主端口与 RTC 端口段重叠：${dupePorts.join(', ')}`);
    b3advice += `TCP ${dupePorts.join('/')} 落在 RTC UDP 段里，可能撞车（TCP/UDP 分属不同协议，通常能共存，但排查端口问题时会很迷惑）。`;
  }
  if (busy.length) {
    b3detail.push(`UDP 抽样占用：${busy.join(', ')}（是别家程序占用，见 C 组；本机已有实例在跑时属正常）`);
  } else {
    b3detail.push('UDP 抽样（段首/段中/段尾）都能绑定，空闲');
  }

  add('B', 'B3-ports', b3status,
    b3status === 'ok' ? `监听与端口配置合理（listenIp=${listenIp}，端口 ${sfuPort}，RTC ${rtcMin}~${rtcMax}）`
      : '监听地址 / 端口配置有可以改好的地方',
    { detail: b3detail.join('；'), advice: b3advice, priority: b3status === 'fail' ? 4 : 20 });

  // B4 HTTPS 与证书
  if (!httpsEnabled) {
    add('B', 'B4-https', 'warn', 'HTTPS 关闭（https.enabled=false）→ 跨机访问拿不到摄像头',
      {
        detail: 'getUserMedia/getDisplayMedia 需要"安全上下文"：只有 localhost 或 https 才行。'
          + '别的电脑用 http://<IP>:3001 打开会看不到摄像头，字幕/滤镜/共享/录制随之全废',
        advice: '把 sfu/config.json 的 https.enabled 改成 true（会自动自签证书，端口 3443）',
        priority: 6,
      });
  } else if (!certsExist) {
    add('B', 'B4-https', 'warn', 'https.enabled=true，但证书文件还不存在（首次启动会自动自签）',
      {
        detail: `期望：${path.relative(ROOT, certPathCfg)} + ${path.relative(ROOT, keyPathCfg)}`,
        advice: httpsCfg.autoSelfSigned === false
          ? '已禁用自签（autoSelfSigned=false）：请手动放一对证书进去，否则 HTTPS 起不来'
          : (ssl.ok ? '启动一次服务器即可（会用 openssl 自动生成）' : '但 openssl 不可用（见 A4）——先解决 A4，或手动放证书'),
        priority: ssl.ok ? 40 : 5,
      });
  } else {
    const info = certNotAfter(certPathCfg);
    if (!info.date) {
      add('B', 'B4-https', 'skip', 'HTTPS 已启用，证书存在（到期时间解析不可用，本项跳过）',
        { detail: 'crypto.X509Certificate 与 openssl 都拿不到 notAfter，无法判断有效期；证书存在即可用', priority: 45 });
    } else {
      const daysLeft = Math.floor((info.date.getTime() - Date.now()) / 86400000);
      const from = info.date.toISOString().slice(0, 10);
      if (daysLeft < 0) {
        add('B', 'B4-https', 'fail', `HTTPS 证书已过期（${from}，${-daysLeft} 天前）`,
          {
            detail: `解析来源：${info.source}${info.subject ? ' · ' + info.subject : ''}`,
            advice: `删掉 ${path.relative(ROOT, certPathCfg)} 与 dev-key.pem，重启服务器会自动重新自签一张（10 年）`,
            priority: 4,
          });
      } else if (daysLeft < 30) {
        add('B', 'B4-https', 'warn', `HTTPS 证书还有 ${daysLeft} 天过期（${from}）`,
          { detail: `解析来源：${info.source}`, advice: '到期后浏览器会拒绝连接；提前删掉证书文件重启即可重新自签', priority: 42 });
      } else {
        add('B', 'B4-https', 'ok', `HTTPS 已启用且证书有效（到期 ${from}，还剩 ${daysLeft} 天）`,
          { detail: `端口 ${httpsPort}，wss 同端口 · 自签证书浏览器首次要点"继续访问"`, priority: 86 });
      }
    }
  }

  /* ════════ C. 端口与运行态 ════════ */

  const portChecks = [
    { port: sfuPort, label: `SFU 主版本（http）`, role: 'main' },
    { port: httpsPort, label: `SFU HTTPS（跨机访问入口）`, role: 'https' },
    { port: MESH_PORT, label: 'Mesh 对照版（http）', role: 'mesh' },
  ];
  const portState = {};
  for (const pc of portChecks) {
    // eslint-disable-next-line no-await-in-loop
    portState[pc.port] = await probeTcp('127.0.0.1', pc.port);
  }
  const mainUp = !!portState[sfuPort];

  const c1lines = [];
  let c1status = 'ok';
  let c1advice = '';
  for (const pc of portChecks) {
    const up = portState[pc.port];
    if (up) {
      c1lines.push(`${pc.port} 被占用 —— ${pc.label} 已有实例在跑，直接用浏览器打开即可`
        + (pc.role === 'mesh' ? '（Mesh 版与 SFU 版可同时跑，互不干扰）' : ''));
    } else {
      c1lines.push(`${pc.port} 空闲 —— ${pc.label} 可启动`);
    }
  }
  if (portState[httpsPort] && !mainUp) {
    c1status = 'warn';
    c1advice = `${httpsPort} 被别的程序占用，但 ${sfuPort} 没在跑：启动时 HTTPS 会报 EADDRINUSE。先用 netstat -ano | findstr :${httpsPort} 查 PID 再决定是否 taskkill /PID <PID> /F`;
  } else if (mainUp) {
    c1advice = `已有实例在跑：直接用浏览器打开 http://localhost:${sfuPort}（跨机用 https://${announcedIp || (lanIp ? lanIp.address : '<本机IP>')}:${httpsPort}）。`
      + `想重启：关掉启动它的那个命令行窗口即可（别再双击启动，会撞 EADDRINUSE）`;
  } else {
    c1advice = `可以启动：npm run start:sfu（局域网交付用 npm run start:lan，会自动配 IP + 放行防火墙）`;
  }
  add('C', 'C1-ports', c1status,
    mainUp ? `${sfuPort} 端口已被占用（已有会议服务在运行）` : `${sfuPort} / ${httpsPort} / ${MESH_PORT} 端口空闲`,
    { detail: c1lines.join('；'), advice: c1advice, priority: 30 });

  // C2 健康接口（只有 3001 真的在跑才问）
  if (mainUp) {
    const api = await httpGetText(`http://127.0.0.1:${sfuPort}/api/rooms`);
    if (api.ok && api.status === 200) {
      let snap = null;
      try { snap = JSON.parse(api.body); } catch (e) { /* 不是 JSON */ }
      if (snap && Array.isArray(snap.rooms)) {
        const totalMembers = snap.rooms.reduce((a, r) => a + ((r.counts && r.counts.members) || 0), 0);
        const totalProducers = snap.rooms.reduce((a, r) => a + ((r.counts && r.counts.producers) || 0), 0);
        const grace = snap.rooms.filter((r) => r.members.length === 0 && r.ttlRemainingSec != null).length;
        const roomLine = snap.rooms.length
          ? snap.rooms.map((r) => `${r.roomNumber}(${(r.members || []).length}人/${(r.media || []).length}路${r.ttlRemainingSec != null ? '·空房宽限剩' + r.ttlRemainingSec + 's' : ''})`).join(' ')
          : '（暂无房间）';
        const workerPid = snap.worker && snap.worker.pid;
        add('C', 'C2-api', 'ok',
          `/api/rooms 正常：${snap.rooms.length} 个房间 / ${totalMembers} 名在线成员 / ${totalProducers} 路媒体`,
          {
            detail: `房间明细：${roomLine}；Worker PID=${workerPid || '（还没就绪）'}；录制中 ${snap.recordingCount || 0} 场`
              + (grace ? `；其中 ${grace} 个是"空房宽限中"（人到点前可凭原号回归）` : '')
              + (workerPid ? '' : '；⚠️ 媒体引擎尚未就绪——服务器是先开 HTTP 再并行拉 Worker，等日志出现「⚙️ 媒体引擎就绪」后摄像头/共享才可用'),
            advice: totalMembers === 0
              ? `现在房间里没人：浏览器打开 http://localhost:${sfuPort} → 创建房间，再开第二个窗口凭号加入`
              : '',
            priority: 84,
          });
      } else {
        add('C', 'C2-api', 'warn', '/api/rooms 返回了 200，但内容不是预期的房间快照',
          { detail: api.body.slice(0, 200), advice: '服务器可能不是本项目版本，或路由被别的程序占了', priority: 35 });
      }
    } else {
      add('C', 'C2-api', 'warn', `${sfuPort} 在监听，但 /api/rooms 请求失败：${api.error || ('HTTP ' + api.status)}`,
        {
          detail: '这个接口是项目自带的健康快照（观测面板 /dashboard 也吃它）',
          advice: `① 如果是刚启动服务器：新启动流程是"先开 HTTP、再并行拉媒体引擎"，这中间可能出现短暂无响应，等日志出现「⚙️ 媒体引擎就绪」再试一次；`
            + `② 否则在浏览器打开 http://localhost:${sfuPort}/dashboard 看看，若 404/无响应，说明监听 ${sfuPort} 的进程不是本项目的 sfu/server.js`,
          priority: 33,
        });
    }
    const dash = await httpGetText(`http://127.0.0.1:${sfuPort}/dashboard`);
    if (!(dash.ok && dash.status === 200)) {
      add('C', 'C2b-dashboard', 'warn', `/dashboard 观测面板不可用（${dash.error || ('HTTP ' + dash.status)}）`,
        { detail: '面板页是零依赖静态页，正常应返回 200', advice: `确认 sfu/public/dashboard.html 存在，并强刷浏览器（Ctrl+F5）`, priority: 36 });
    } else {
      add('C', 'C2b-dashboard', 'ok', '/dashboard 观测面板可访问（HTTP 200）',
        { detail: `地址：http://localhost:${sfuPort}/dashboard（2s 轮询 /api/rooms 画实时码率折线）`, priority: 76 });
    }
  } else {
    add('C', 'C2-api', 'skip', '服务器没在运行，跳过 /api/rooms 健康快照',
      { detail: `启动后（npm run start:sfu）再跑一次 npm run doctor 就能看到真实房间数/成员数`, priority: 44 });
  }

  /* ════════ D. 跨网可达性 ════════ */

  const iceServers = Array.isArray(cfg.iceServers) ? cfg.iceServers : [];
  const stunUrls = [];
  const turnUrls = [];
  for (const s of iceServers) {
    if (!s || !s.urls) continue;
    for (const u of (Array.isArray(s.urls) ? s.urls : [s.urls])) {
      const str = String(u);
      if (/^stuns?:/i.test(str)) stunUrls.push(str);
      else if (/^turns?:/i.test(str)) turnUrls.push(str);
    }
  }

  if (!iceServers.length) {
    add('D', 'D1-stun', 'warn', 'iceServers 未配置 → 只能用本机候选地址，跨网（含跨网段）连不上',
      {
        detail: 'config.json 里没有 iceServers 字段（或为空数组）；服务器 /config.json 下发给浏览器的也是空',
        advice: '复制 sfu/config.example.json 的 iceServers 段（含 Google STUN + openrelay TURN），或跑 npm run start:lan 自动写',
        priority: 7,
      });
  } else {
    // STUN 逐个探测（并行，3s 超时）
    const stunRes = await Promise.all(stunUrls.map(async (u) => {
      const p = parseIceUrl(u);
      if (!p) return { u, ok: false, note: 'URL 格式无法解析（例：stun:host:3478）' };
      const r = await stunProbe(p.host, p.port, 3000);
      return { u, ok: r.ok, note: r.note };
    }));

    if (!stunUrls.length) {
      add('D', 'D1-stun', 'warn', '没有配置 STUN 服务器',
        {
          detail: 'STUN 负责问出"我在公网上的地址"（srflx 候选）——缺少它，NAT 后的双方只能靠 TURN 中继',
          advice: '加一条 stun:stun.l.google.com:19302（国内也可换 stun:stun.qq.com:3478）',
          priority: 10,
        });
    } else {
      for (const r of stunRes) {
        const p = parseIceUrl(r.u);
        add('D', 'D1-stun:' + r.u, r.ok ? 'ok' : 'warn',
          r.ok ? `STUN 可达：${r.u}` : `STUN 不可达：${r.u}`,
          {
            detail: r.ok ? r.note : `${r.note}（目标 ${p ? p.host + ':' + p.port + ' UDP' : '?'}）`,
            advice: r.ok ? '' : 'STUN 不通不致命（还有 TURN 兜底），但会少掉"直连/穿墙"这条路：'
              + '检查本机出网 UDP 是否被公司防火墙/代理封掉，或换一个 STUN（stun:stun.qq.com:3478）',
            priority: r.ok ? 65 : 15,
          });
      }
    }

    // TURN 逐个探测：UDP 先试（STUN Binding），失败退 TCP 443 试（?transport=tcp 的直接走 TCP）
    const turnRes = await Promise.all(turnUrls.map(async (u) => {
      const p = parseIceUrl(u);
      if (!p) return { u, ok: false, channel: '-', note: 'URL 格式无法解析' };
      const hasCred = iceServers.some((s) => {
        const list = Array.isArray(s.urls) ? s.urls : [s.urls];
        return list.map(String).includes(u) && s.username;
      });
      if (p.transport === 'tcp') {
        const ok = await probeTcp(p.host, p.port, 3000);
        return { u, ok, channel: `TCP ${p.port}`, note: ok ? `TCP ${p.port} 连接成功` : `TCP ${p.port} 连不上`, hasCred };
      }
      const udp = await stunProbe(p.host, p.port, 3000);
      if (udp.ok) return { u, ok: true, channel: `UDP ${p.port}`, note: udp.note, hasCred };
      // UDP 失败 → 按浏览器 ICE 的回退顺序换 TCP 443 再试一次
      const tcpOk = await probeTcp(p.host, 443, 3000);
      return {
        u, ok: tcpOk, channel: tcpOk ? 'TCP 443（回退）' : '-', hasCred,
        note: tcpOk
          ? `UDP ${p.port} 不通，但同主机 TCP 443 可达（浏览器 ICE 会自动回退到 TCP 中继）`
          : `UDP ${p.port} 与 TCP 443 都不通`,
      };
    }));

    if (!turnUrls.length) {
      add('D', 'D2-turn', 'warn', '没有配置 TURN 服务器 → 双方都在 NAT 后时跨网连不上',
        {
          detail: 'TURN 是"双方都穿不过 NAT 时的保底中继"。没有它，两边不同网络（一个 4G 一个家用 WiFi）就只剩黑屏',
          advice: '加一条 openrelay 免费 TURN（见 config.example.json），或按 deploy/coturn/ 自建；跑 npm run start:lan 会自动写',
          priority: 5,
        });
    } else {
      for (const r of turnRes) {
        add('D', 'D2-turn:' + r.u, r.ok ? 'ok' : 'warn',
          r.ok ? `TURN 通道可达：${r.u}（${r.channel}）` : `TURN 通道不可达：${r.u}`,
          {
            detail: r.note + (r.hasCred === false ? '（⚠️ 这条 TURN 没有配 username/credential，浏览器会拒绝使用）' : ''),
            advice: r.ok ? '' : '可继续看下一条总结：单条 TURN 不通不等于跨网没救（udp/tcp 会自动回退）',
            priority: r.ok ? 64 : 16,
          });
      }
      const turnOkCount = turnRes.filter((r) => r.ok).length;
      const stunOkCount = stunRes.filter((r) => r.ok).length;
      const turnSummary = 'TURN 不通 ≠ 不能用：浏览器 ICE 会自动在 udp / tcp 之间回退（配置里 ?transport=tcp 那条就是保底通道）；'
        + '但跨网（双方都在 NAT 后，例如一个家用 WiFi 一个手机 4G）**必须有至少一条可用 TURN**，否则只能同局域网。';
      if (turnOkCount > 0) {
        add('D', 'D2-turn-summary', 'ok',
          `TURN 结论：${turnOkCount}/${turnRes.length} 条通道可达 —— 跨网有保底中继（${stunOkCount} 条 STUN 可达）`,
          {
            detail: turnSummary,
            advice: turnOkCount < turnRes.length
              ? '部分通道被封是常态（很多网络只放 TCP 443）。只要有一条通，浏览器 ICE 自己会挑；'
                + '真连不上时看页面顶部「🔗 连接方式」徽标是否显示"TURN 中继"'
              : '运行时看页面顶部「🔗 连接方式」徽标：显示"中继"说明正在走 TURN（此时双方都能连上，但延迟略高）',
            priority: 66,
          });
      } else {
        add('D', 'D2-turn-summary', 'fail',
          `TURN 结论：${turnRes.length} 条通道全部不可达 —— 双方都在 NAT 后时跨网必失败（只能同局域网）`,
          {
            detail: turnSummary,
            advice: '① 先确认本机能出网（浏览器能打开 baidu.com）；'
              + '② 换 TURN：自建按 deploy/coturn/（docker-compose 一条命令，TCP 443 + UDP 3478 都要放行）；'
              + '③ 云主机部署时记得开安全组 UDP 40000-49999 与 TCP 3443',
            priority: 2,
          });
      }
    }
  }

  // D3 HTTPS 入口可达性（跨机访问的真正入口）
  if (!httpsEnabled) {
    add('D', 'D3-https-entry', 'skip', 'HTTPS 未启用，跳过入口可达性测试',
      { detail: '跨机访问请启用 https（见 B4）：http 页面拿不到摄像头', priority: 46 });
  } else if (!announcedIp) {
    add('D', 'D3-https-entry', 'skip', '没有 announcedIp，跳过 HTTPS 入口测试',
      { detail: `本机可用地址：${lanIp ? lanIp.address : '无'}；配好 announcedIp 后本项会自动测`, priority: 46 });
  } else if (!portState[httpsPort]) {
    add('D', 'D3-https-entry', 'skip', `本机 ${httpsPort} 没在监听（服务器未启动），跳过 HTTPS 入口测试`,
      { detail: `启动服务器后（npm run start:sfu）再跑一次，就能验证 https://${announcedIp}:${httpsPort}/ 是否可访问`, priority: 46 });
  } else {
    const url = `https://${announcedIp}:${httpsPort}/`;
    const r = await httpGetText(url, 5000);
    if (r.ok && r.status === 200) {
      add('D', 'D3-https-entry', 'ok', `HTTPS 入口可达：${url} → HTTP ${r.status}`,
        {
          detail: '这是给别的电脑用的地址（自签证书，首次访问点"继续访问/高级→继续前往"）',
          advice: `把邀请链接发给对方即可（服务器机自己用 localhost，复制的链接会自动换成 ${url}）`,
          priority: 68,
        });
    } else {
      add('D', 'D3-https-entry', 'fail', `HTTPS 入口不可达：${url}（${r.error || ('HTTP ' + r.status)}）`,
        {
          detail: '本机端口在监听但按 announcedIp 连不上 → 基本可以锁定是防火墙 / 安全组 / 网络隔离（不是代码问题）',
          advice: FIREWALL_HINT + '；云主机还要在控制台安全组放行 TCP 3443',
          priority: 3,
        });
    }
  }

  /* ════════ 渲染 ════════ */
  const passed = results.filter((r) => r.status === 'ok' || r.status === 'skip').length;
  const warnings = results.filter((r) => r.status === 'warn').length;
  const failures = results.filter((r) => r.status === 'fail').length;
  const exitCode = failures > 0 ? 1 : 0;

  // "最可能卡住你的三条"：失败优先，再看优先级（数字小的更致命）
  const rank = { fail: 0, warn: 1, ok: 2, skip: 3 };
  const topBlockers = results
    .filter((r) => r.status === 'fail' || r.status === 'warn')
    .sort((a, b) => (rank[a.status] - rank[b.status]) || (a.priority - b.priority) || a.id.localeCompare(b.id))
    .slice(0, 3)
    .map((r) => ({ id: r.id, status: r.status, title: r.title, advice: r.advice }));

  if (JSON_MODE) {
    const payload = {
      tool: 'webrtc-doctor',
      generatedAt: new Date().toISOString(),
      node: process.versions.node,
      platform: `${process.platform} ${process.arch}`,
      cwd: process.cwd(),
      groups: GROUPS.map((g) => ({
        id: g.id,
        title: g.title,
        items: results.filter((r) => r.group === g.id)
          .map(({ id, status, title, detail, advice }) => ({ id, status, title, detail, advice })),
      })),
      summary: { passed, warnings, failures, total: results.length },
      topBlockers,
      exitCode,
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    const ICON = { ok: '✅', warn: '⚠️', fail: '❌', skip: '✅' };
    const line = '══════════════════════════════════════════════════════════';
    console.log(line);
    console.log(`  🩺 会议项目自检 doctor —— ${results.length} 项检查（Node ${process.versions.node} / ${process.platform}）`);
    console.log(line);
    for (const g of GROUPS) {
      const items = results.filter((r) => r.group === g.id);
      if (!items.length) continue;
      console.log('');
      console.log(g.title);
      for (const it of items) {
        console.log(`  ${ICON[it.status] || '·'} ${it.title}${it.detail ? `\n      └ ${it.detail}` : ''}`);
        if (it.advice) console.log(`      ↳ 建议：${it.advice.replace(/\n/g, '\n        ')}`);
      }
    }
    console.log('');
    console.log(line);
    console.log(`结论：${passed} 项通过 / ${warnings} 项警告 / ${failures} 项失败`);
    if (topBlockers.length) {
      console.log('');
      console.log('最可能卡住你的三条：');
      topBlockers.forEach((b, i) => {
        const icon = b.status === 'fail' ? '❌' : '⚠️';
        console.log(`  ${i + 1}. ${icon} ${b.title}`);
        if (b.advice) console.log(`     ↳ ${b.advice.split('\n')[0]}`);
      });
    } else {
      console.log('');
      console.log('最可能卡住你的三条：没有 —— 环境/配置/端口/跨网四项都正常，去浏览器验证功能即可 🎉');
    }
    console.log(line);
  }

  // 收尾：给 stdout 一点冲刷时间，同时确保不会被残留句柄挂住
  process.exitCode = exitCode;
  setTimeout(() => process.exit(exitCode), 250);
})().catch((err) => {
  // doctor 自己不能崩：任何意外都要有可读输出
  const msg = `❌ doctor 自身出错：${err && err.stack ? err.stack : err}`;
  if (JSON_MODE) process.stdout.write(JSON.stringify({ tool: 'webrtc-doctor', error: String(err && err.message || err), exitCode: 1 }, null, 2) + '\n');
  else console.error(msg);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 250);
});
