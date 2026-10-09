#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 * scripts/test-crossnet.js —— 跨网这条路的实测与回归（2026-10-09，K1）
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎用户要的是"不同网络也能进会议"。这件事在 SFU 里只有一个决定因素：
 *   **浏览器能不能把 UDP（或 TCP）包送到 mediasoup 通告出来的那个 ip:port**。
 *   公共 TURN 帮不到这里（mediasoup 的媒体面不走 TURN 中继），所以"配了 openrelay
 *   就能跨网"那句话是错的（本轮顺手把文档里那句改对）。
 *
 * ▎这台工具做两类事，分开看：
 *   ① **可断言的机制**（跑不过就是回退，退出码 1）：
 *      · 配了 rtcServerPort → 服务器真的挂上 WebRtcServer，并且
 *        **同一条 Transport 的 ICE 候选里同时有 udp 与 tcp 两个候选、端口号就是它**；
 *      · 那个 TCP 端口在本机真的 accept（net.connect 得到回声）；
 *      · /config.json 的 netCheck 说实话（fixedMediaPort / tcpFallback / 那条"媒体端口"判定）；
 *      · /metrics 的 sfu_rtc_server_port 与 /config.json 同源（watch 读的就是它）；
 *      · 没配 rtcServerPort 时 diagnose 给出的是"随机段且只有 UDP"的 warn（反向对照）。
 *   ② **只能测量、不能判红的事实**：本机到公网的 STUN 反射地址是什么、
 *      它等不等于对外通告的 IP —— 不等就是"NAT 后"，必须组网/映射/上云。
 *      这一条**打印结论但不判失败**（在一台 NAT 后的笔记本上它天然为"不行"，
 *      把它做成红灯只会让人忽略真正的红；假红也伤人，坑 82/105）。
 *
 * ▎纪律：自己起服务、自己占端口（3019 / 媒体 3155）——绝不复用用户那台 3001（坑 57），
 *   端口被占明确拒绝；本地 Qwen 耳朵关掉以免占显存；库与共享文件都指到临时目录。
 *
 * 跑法：npm run test:crossnet      （可选 CROSSNET_PORT / CROSSNET_RTC_PORT 换端口）
 * ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.CROSSNET_PORT) || 3019;
const RTC_PORT = Number(process.env.CROSSNET_RTC_PORT) || 3155;
const BASE = `http://localhost:${PORT}`;
const Stun = require('./stun-probe.js');
const Nets = require('../sfu/nets.js');

let pass = 0; let fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (typeof name !== 'string') throw new TypeError('ok() 第一个参数必须是名字（见坑 110）');
  if (typeof cond !== 'boolean') throw new TypeError(`ok("${name}") 第二个参数必须是布尔（收到 ${typeof cond}）`);
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; fails.push(name); console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGet(urlPath, token) {
  return new Promise((resolve, reject) => {
    const req = http.get(BASE + urlPath, { headers: token ? { Authorization: 'Bearer ' + token } : {} }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(new Error('HTTP 超时')); });
  });
}

/** TCP 能否连上某个本机端口（证明 mediasoup 真的在那个号上 listens，不是"配置里写了"） */
function tcpProbe(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: timeoutMs }, () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}

function portInUse(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port, timeout: 700 }, () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}

(async () => {
  console.log(`\n═══ 跨网实测与回归（K1）· 服务端口 ${PORT} · 媒体固定端口 ${RTC_PORT} ═══`);
  /* ---- 前提：自己起服务，绝不复用别人的实例（坑 57：复用端口上已有的服务器 = 假绿） ---- */
  if (await portInUse(PORT)) {
    console.error(`❌ 端口 ${PORT} 已被占用 —— 本工具必须跑在**自己起的**服务器上（不是你 3001 那一台）。`);
    console.error('   换端口：CROSSNET_PORT=3029 npm run test:crossnet');
    process.exit(1);
  }
  if (await portInUse(RTC_PORT)) {
    console.error(`❌ 媒体端口 ${RTC_PORT} 已被占用 —— 换 CROSSNET_RTC_PORT=3166 再跑。`);
    console.error('   （这条红是**好事**：它说明"固定端口被抢"这个场景真的会发生，而服务器要能退回随机段）');
    process.exit(1);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crossnet-'));
  const dbFile = path.join(tmp, 'crossnet.db');
  const logPath = path.join(tmp, 'server.log');
  const env = Object.assign({}, process.env, {
    PORT: String(PORT),
    MEDIASOUP_LISTEN_IP: '0.0.0.0',
    MEDIASOUP_RTC_SERVER_PORT: String(RTC_PORT),
    SFU_NO_HTTPS: '1',
    DB_FILE: dbFile,
    FILES_DIR: path.join(tmp, 'files'),
    ASR_QWEN_LOCAL: '0',
    LOGS_DIR: path.join(tmp, 'logs'),
    /* ★ K2 的"多地址通告"必须**真被断言**，而这台机器只有一张 WLAN、也没装 Tailscale。
     *   硬等"用户哪天有第二张网卡"就等于这条判据永远不跑（坑 83：测不到不等于通过）。
     *   127.0.0.2 是回环段里的第二个地址（不需要管理员就能绑），
     *   它在真实部署里没有意义，但它能证明"多个 announcedIp → 多条 ICE 候选"这条机制成立。 */
    ANNOUNCE_EXTRA_IPS: '127.0.0.2',
  });
  const logFd = fs.openSync(logPath, 'w');
  const server = spawn(process.execPath, [path.join('sfu', 'server.js')], { cwd: ROOT, env, stdio: ['ignore', logFd, logFd] });
  const stop = () => { try { server.kill(); } catch (e) { /* 已经退了 */ } };
  process.on('exit', stop);

  try {
    let up = false;
    for (let i = 0; i < 40 && !up; i++) {
      await sleep(500);
      try { up = (await httpGet('/config.json')).status === 200; } catch (e) { up = false; }
      if (server.killed || server.exitCode !== null) break;
    }
    ok('服务器（带固定媒体端口）起来了', up);
    if (!up) {
      console.log('  启动日志尾部：\n' + fs.readFileSync(logPath, 'utf8').split('\n').slice(-12).join('\n'));
      return finish();
    }

    /* ---- ① /config.json：服务器说的必须是它做的 ----
     * ▸ 这里必须**再等一次**再读：上面判"起来了"用的是 HTTP 200，而 HTTP 比 mediasoup
     *   Worker + 固定端口挂上更早可用——第一版直接拿那一趟的应答做断言，
     *   读到的是"媒体引擎还没就绪"的中间态（fixedMediaPort=0），报成了产品回退。
     *   量具读早了 ≠ 产品坏了（坑 120，今天第三次踩同一个形状）。 */
    let cfg = null;
    for (let i = 0; i < 24; i++) {
      cfg = JSON.parse((await httpGet('/config.json')).body);
      if (cfg.netCheck && cfg.netCheck.fixedMediaPort) break;
      await sleep(500);
    }
    const nc = cfg.netCheck || {};
    ok('★ /config.json 的 netCheck.fixedMediaPort 就是本次真的挂上的号（不是配置里写的数）',
      nc.fixedMediaPort === RTC_PORT, JSON.stringify({ fixed: nc.fixedMediaPort, want: RTC_PORT }));
    ok('★ tcpFallback=true：媒体面有 TCP 这条路（禁 UDP 的网络才有退路）',
      nc.tcpFallback === true, JSON.stringify(nc.tcpFallback));
    const portItem = (nc.items || []).filter((it) => /媒体端口/.test(it.label))[0];
    ok('判定里那条「媒体端口」是 ok（固定端口生效时不该再报"只有 UDP"）',
      !!portItem && portItem.state === 'ok', JSON.stringify(portItem));

    /* ---- ② 真建一条 Transport：ICE 候选里必须 udp + tcp 都有，且端口就是它 ---- */
    const { io } = require('socket.io-client');
    const socket = io(BASE, { transports: ['websocket'], forceNew: true });
    await new Promise((res, rej) => { socket.on('connect', res); socket.on('connect_error', rej); setTimeout(() => rej(new Error('socket 连接超时')), 8000); })
      .catch(async (e) => { ok('socket.io 连上服务器', false, e.message); return finish(); });
    const ask = (ev, payload, ms = 9000) => new Promise((res) => {
      const t = setTimeout(() => res({ timeout: true }), ms);
      socket.emit(ev, payload, (r) => { clearTimeout(t); res(r || {}); });
    });
    const created = await ask('create-room', { roomName: '跨网实测房', maxMembers: 8 });
    const roomNumber = created && created.data && created.data.roomNumber;
    ok('建房成功（自带房间，不碰任何别的实例）', /^\d{6}$/.test(String(roomNumber)), JSON.stringify(created).slice(0, 120));
    const tr = await ask('create-webrtc-transport', { direction: 'send' });
    const cands = (tr && tr.data && tr.data.iceCandidates) || [];
    const udp = cands.filter((c) => c.protocol === 'udp');
    const tcp = cands.filter((c) => c.protocol === 'tcp');
    ok('★★★ 同一条 Transport 的 ICE 候选里 udp 与 tcp 都有（TCP 兜底真的在协商里，不是写在注释里）',
      udp.length > 0 && tcp.length > 0, JSON.stringify(cands.map((c) => `${c.protocol}:${c.port}`)));
    ok('★★ 候选端口号 = 配的固定端口（全服务器共用这一个号 → 端口映射只需一条）',
      cands.length > 0 && cands.every((c) => Number(c.port) === RTC_PORT),
      JSON.stringify(Array.from(new Set(cands.map((c) => c.port)))));
    const announced = udp[0] && udp[0].ip;
    ok('候选里通告的是本机对外网卡地址（不是 127.0.0.1，否则别的网络一定连不上）',
      !!announced && !/^127\./.test(announced), String(announced));

    /* ---- ②b K2：多地址通告 —— 同网与组网的人各挑自己那条 ---- */
    const ips = Array.from(new Set(cands.map((c) => c.ip)));
    ok('★★★ 多个通告地址变成**多条 ICE 候选**（局域网那条 + 注入的那条都在，浏览器自己挑可达的）',
      ips.length >= 2 && ips.includes('127.0.0.2') && ips.includes(announced), JSON.stringify(ips));
    const ncItems = (cfg.netCheck || {}).items || [];
    const adv = ncItems.filter((it) => /通告地址/.test(it.label))[0];
    ok('★ /config.json 里"通告地址"这一条说的是真话（几个就说几个）',
      !!adv && /2 个地址/.test(String(adv.detail)), JSON.stringify(adv));

    /* ---- ③ 那个 TCP 号在本机真的 accept（配置写了 ≠ 挂上了，坑 76） ----
     * ▸ 探的是**每个被通告的地址**，不是 127.0.0.1：多地址通告时 mediasoup 把每条 listenInfo
     *   绑到各自的网卡地址上（0.0.0.0:P 与 <网卡IP>:P 会抢同一个号），
     *   所以第一版探 127.0.0.1 是红的 —— 红的是我的假设，不是产品（坑 80：假红先怀疑量具）。 */
    const tcpTargets = Array.from(new Set(cands.map((c) => c.ip)));
    const tcpSeen = [];
    for (const ip of tcpTargets) tcpSeen.push([ip, await tcpProbe(ip, RTC_PORT)]);
    const tcpOk = tcpTargets.length > 0 && tcpSeen.every(([, v]) => v === true);
    ok(`★ 每个通告地址上的 TCP ${RTC_PORT} 实测都 accept（${tcpSeen.map(([i, v]) => `${i}=${v ? '通' : '不通'}`).join(' ')}）`,
      tcpOk === true, JSON.stringify(tcpSeen));

    /* ---- ④ /metrics 与 /config.json 同源（watch 读的是这一行） ---- */
    const adminUser = 'cx_' + Date.now().toString(36).slice(-6);
    const reg = await ask('auth-register', { username: adminUser, password: 'CrossNet123', displayName: '跨网自测' });
    const token = reg && reg.data && reg.data.token;
    ok('临时库首个账号自动成为管理员（拿得到 token 才读得动观测接口）', !!token, JSON.stringify(reg).slice(0, 120));
    const m = await httpGet('/metrics', token);
    ok('/metrics 里 sfu_rtc_server_port 与 config 同值（两本账同源，watch 才报得准）',
      m.status === 200 && new RegExp('^sfu_rtc_server_port ' + RTC_PORT + '$', 'm').test(m.body),
      `status=${m.status}`);
    ok('★ 反向对照：正则锚了行首（HELP 行里也含这串字，不锚就会 0s 假通过，坑 74）',
      /^# HELP sfu_rtc_server_port/m.test(m.body) && /^sfu_rtc_server_port \d+$/m.test(m.body));

    /* ---- ⑤ 没配固定端口时的判定长什么样（反向对照：warn 必须存在） ---- */
    const off = Nets.diagnose({
      ip: '192.168.1.50', listenIp: '0.0.0.0', httpsEnabled: true, rtcServerPort: 0,
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    const offItem = (off.items || []).filter((it) => /媒体端口/.test(it.label))[0];
    ok('没配 rtcServerPort 时判定给 warn 并写明"只有 UDP"（这条建议是给用户的下一步）',
      !!offItem && offItem.state === 'warn' && /UDP/.test(offItem.detail), JSON.stringify(offItem));
    ok('且 tcpFallback=false（不配就没有 TCP 退路，界面不许假装两条都有）',
      off.tcpFallback === false, String(off.tcpFallback));
    const on = Nets.diagnose({
      ip: '192.168.1.50', listenIp: '0.0.0.0', httpsEnabled: true, rtcServerPort: 4443, iceServers: [],
    });
    ok('配了之后端口映射的提示改成"一条 UDP+TCP"（建议随机制变，不是固定文案）',
      /UDP\+TCP 4443/.test(JSON.stringify(on.items)), '');

    /* ---- ⑥ 事实测量：这台机器对外的地址是什么（打印结论，不判红） ---- */
    console.log('\n  ── 跨网可达性实测（事实，不判红）──');
    const stunUrls = (cfg.iceServers || [])
      .map((s) => (Array.isArray(s.urls) ? s.urls[0] : s.urls))
      .filter((u) => /^stun:/i.test(String(u || '')));
    let reflex = null;
    for (const u of stunUrls) {
      const p = Stun.parseUrl(u);
      if (!p) continue;
      /* 两次机会（4s + 7s）：公共 STUN 的响应时间在 1~3s 抖，一次超时是网络不是产品
       * ——把它写成"不可达"会诱导人去"修"一个没坏的东西（坑 67：超时不等于没有）。 */
      let r = await Stun.binding(p.host, p.port, 4000);
      if (!r.ok) r = await Stun.binding(p.host, p.port, 7000);
      console.log(`  STUN ${u} → ${r.ok ? '可达' : '不可达'}${r.publicIp ? ` · 本机对外地址 ${r.publicIp}:${r.publicPort}` : ''} (${r.note})`);
      if (r.ok && r.publicIp) { reflex = r; break; }
    }
    if (!reflex) {
      console.log('  ❔ 没拿到反射地址（出口被封/超时）——**这不等于"跨网不行"**，只是这台量具今晚读不到（坑 105）。');
    } else {
      const nets = require('../sfu/nets.js');
      const isPub = nets.isPublicIsh(reflex.publicIp);
      const same = String(reflex.publicIp) === String(announced);
      console.log(`  对外通告的媒体地址 = ${announced}:${RTC_PORT}`);
      if (same && isPub) {
        console.log('  ✅ 媒体地址就是这台机器的公网出口地址 → 不同网络**直接可达**（防火墙放行这一个 UDP+TCP 号即可）');
      } else if (isPub && !same) {
        console.log('  ⚠️ 媒体地址与公网出口地址不同 → 多半在 NAT 后：需要在路由器把 '
          + `${RTC_PORT}/udp 与 /tcp 映射到 ${announced}，或改用 Tailscale/云主机`);
      } else {
        console.log('  ⚠️ 本机出口本身是私网（容器/二级 NAT）：公网直达这条路不通，'
          + '按《部署手册.md》B-1（Tailscale 组网，零成本首选）或 B-2（云主机）走');
      }
      console.log(`  （固定端口的意义：上面无论哪种情形，要转发的都只有 ${RTC_PORT} 这一个号，而不是 40000-49999 一整段）`);
    }

    socket.close();
  } catch (e) {
    ok(`工具自身抛错（这一条红代表量具坏了，不代表产品坏了）：${e && e.message}`, false, e && e.stack);
  } finally {
    stop();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* Windows 上偶尔慢一拍，不影响结论 */ }
  }
  return finish();

  function finish() {
    console.log(`\n${'═'.repeat(58)}`);
    console.log(`跨网实测：${pass} 通过 / ${fail} 失败`);
    if (fail) { console.log('失败清单：'); fails.forEach((f) => console.log('  · ' + f)); process.exit(1); }
    console.log('✅ 固定端口媒体入口（UDP+TCP 同号）成立 —— 跨网所需的转发自变量从"一整段"降到"一个号"');
    process.exit(0);
  }
})();
