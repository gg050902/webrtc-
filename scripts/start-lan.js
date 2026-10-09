/* ══════════════════════════════════════════════════════════════
 * scripts/start-lan.js —— 一键"局域网可连"交付（E1/E2 的落地脚本）
 *
 * ▎做什么？跨电脑连不上，卡住的从来是四件事：
 *   ① 服务器只监听 127.0.0.1；② 媒体面不知道该告诉对方哪个 IP（announcedIp）；
 *   ③ 页面不是安全上下文（拿不到摄像头）；④ TURN 没配。
 *   本脚本把四件事一次配好：自动探测本机局域网 IP → 生成 sfu/config.json
 *   （listenIp=0.0.0.0 + announcedIp=<局域网IP> + HTTPS 自签 + openrelay TURN）
 *   → 启动服务器 → 打印"本机/局域网/跨网"三种访问地址与防火墙放行清单。
 *
 * ▎用法：node scripts/start-lan.js   （或双击 start-lan.bat）
 *   已有 config.json 会先备份为 config.json.bak-<时间戳>。
 * ══════════════════════════════════════════════════════════════ */
'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CONFIG = path.join(ROOT, 'sfu', 'config.json');

/* ★ 2026-10-09（K3）：这台脚本原先自带一份"挑本机 IP"的逻辑，而且**没有虚拟网卡罚分**
 *   （只看 192.168/10./172. 这三个前缀）——开发机上 VirtualBox/WSL 也是 192.168/172 段，
 *   于是 start:lan 可能把一个"本机 ping 得通、别人根本路由不到"的地址写进配置。
 *   而 nets.js 里那份判据（打分 + 名字识别）正是为这件事写的，doctor/test:nets 都用它。
 *   ▸ 一份概念两个来源 = 迟早互相矛盾（坑 47；本轮把 start-lan 也接回同一个来源）。 */
const Nets = require('../sfu/nets.js');

function detectLanIp() {
  const all = Nets.listLocalIps().map((e) => ({ name: e.name, addr: e.ip }));
  const p = Nets.pickPrimaryIp();
  return { picked: p ? p.ip : null, nic: p ? p.name : null, candidates: all };
}

/** 挑一个没人用的固定媒体端口（4443 起试 4 个）。全被占就返回 0 = 不启用固定端口。 */
function pickFreePort(start) {
  const net = require('net');
  const tryBind = (port) => new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '0.0.0.0');
  });
  return (async () => {
    for (let i = 0; i < 4; i++) if (await tryBind(start + i)) return start + i;
    return 0;
  })();
}

/* 预检：3001 是否已有实例在跑（双开会 EADDRINUSE，先给"人话"提示） */
function checkExisting() {
  return new Promise((resolve) => {
    const net = require('net');
    const s = net.connect({ host: '127.0.0.1', port: 3001, timeout: 1200 }, () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}

async function main() {
  const { picked, nic, candidates } = detectLanIp();
  const mediaPort = await pickFreePort(4443);
  console.log('══════════════════════════════════════════════════════');
  console.log('  一键局域网交付：探测本机 IP → 生成配置 → 启动服务器');
  console.log('──────────────────────────────────────────────────────');

  if (!picked) {
    console.log('⚠️ 没有探测到局域网 IPv4（未联网？）。仍将生成仅本机可用的配置。');
  } else {
    console.log(`  候选网卡 IP：${candidates.map((c) => `${c.addr}(${c.name})`).join('  ')}`);
    console.log(`  ✔ 采用：${picked}（网卡 ${nic}）—— 判据与 doctor/test:nets 同一份（避开虚拟网卡）`);
  }

  // 备份旧配置
  if (fs.existsSync(CONFIG)) {
    const bak = `${CONFIG}.bak-${Date.now()}`;
    fs.copyFileSync(CONFIG, bak);
    console.log(`  旧配置已备份 → ${path.basename(bak)}`);
  }

  /* ★ 2026-10-02 **合并式生成**，不再整份覆写（用户配置被吃掉的真事故）：
   * ▎原来这里是一个从零拼出来的对象 + writeFileSync——adminUsername / asrEngine / asrModel /
   *   aiChatWindowSec / aiTtsVoice … 只要不在下面这张表里，跑一次 start:lan 就**静默消失**。
   *   实际后果实测过：10-01 把 asrEngine 配成 qwen-local，之后一次 start:lan 把它抹掉，
   *   服务器悄悄退回 whisper，用户侧表现为"AI 说话还是那个机械音/识别还是慢"，
   *   而且没有任何报错——这类"配置被工具吃掉"是最难查的一类故障。
   * ▎规则：本脚本只负责它**真正懂**的那几项（网络与 HTTPS），其余字段原样保留。
   *   旧配置仍然备份（.bak-<时间戳>），所以即便合并结果不满意也能手工还原。 */
  let prev = {};
  if (fs.existsSync(CONFIG)) {
    try {
      prev = require(path.join(ROOT, 'sfu', 'jsonc.js')).parseJsonc(
        fs.readFileSync(CONFIG, 'utf8')) || {};
    } catch (e) {
      console.log(`  ⚠️ 旧 config.json 解析失败（${e.message}）——本次只能整份重建（已备份，可手工还原）`);
      prev = {};
    }
  }
  const generated = {
    port: 3001,
    maxMembers: 8,
    listenIp: '0.0.0.0',            // 监听所有网卡：别的电脑才连得进来
    announcedIp: picked || undefined, // 媒体面告诉对方"往这个 IP 连我"
    rtcMinPort: 40000,
    rtcMaxPort: 49999,
    /* ★ K1（2026-10-09）：媒体走**固定端口 + UDP/TCP 同号**（WebRtcServer）。
     *   ▸ 为什么默认就开：跨网要转发的东西从"40000-49999 一整段 UDP"降到"一个号的
     *     UDP + TCP"——家用路由器只做得到后者；而 TCP 那一路还顺带救活"公司网把 UDP 封了"。
     *   ▸ 4443 被占时自动往后找 4 个，全占就写 0（= 退回随机端口段），启动日志会说实话。 */
    rtcServerPort: mediaPort,
    announceExtra: 'tailscale',      // 装了 Tailscale 就自动多通告一条组网地址（同网那条不受影响）
    roomTtlSec: 60,
    videoSvc: false,
    // TURN：openrelay 公共服务（跨网演示开箱即用；生产请自建 deploy/coturn）
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    ],
    https: { enabled: true, port: 3443, autoSelfSigned: true },
  };
  // 只有"本次真的探到了 IP"才覆盖，否则保留用户手写的值（例如 Tailscale IP）
  if (!picked) delete generated.announcedIp;
  const config = Object.assign({}, prev, generated);
  fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2) + '\n');
  const kept = Object.keys(prev).filter((k) => !(k in generated));
  console.log(`  ✔ 已生成 sfu/config.json（0.0.0.0 + announcedIp + HTTPS 自签 + openrelay TURN）` +
    (kept.length ? `，并保留原有手工字段：${kept.join('、')}` : ''));

  const lan = picked || '127.0.0.1';
  console.log('──────────────────────────────────────────────────────');
  /* ★ 2026-10-05 防火墙放行挪到"已有实例"预检**之前**：
   *   ▎原顺序是"检测到 3001 已占用 → 提示直接用浏览器 → exit(0)"，而放行代码在它后面——
   *     于是《跨电脑连接-操作指南》里"自动放行失败就用管理员身份重跑 start-lan.bat"这条
   *     修复路径，**在有服务器运行时根本执行不到**（而有服务器运行恰恰是常态）：
   *     用户按文档做了、什么也没发生、别的电脑照样打不开，是条"看起来存在"的假通路。
   *   ▎放行规则是幂等的、与"要不要重启服务器"无关——先保证网络可达，再谈启不启动。 */
  console.log('  防火墙：优先自动放行（失败则双击根目录 allow-firewall.bat，或管理员身份重跑本脚本）');
  try {
    const { execSync } = require('child_process');
    const ensureRule = (name, proto, ports) => {
      try {
        execSync(`netsh advfirewall firewall show rule name="${name}"`, { stdio: 'ignore' });
        return 'exists'; // 已有同名规则就不再 add（netsh 的同名 add 会叠出第二条）
      } catch (e) {
        execSync(`netsh advfirewall firewall add rule name="${name}" dir=in action=allow protocol=${proto} localport=${ports}`, { stdio: 'ignore' });
        return 'added';
      }
    };
    const r1 = ensureRule('meeting-sfu-udp', 'UDP', '40000-49999');
    const r2 = ensureRule('meeting-web-tcp', 'TCP', '3001,3443');
    /* ★ K1：固定媒体端口要 **UDP 与 TCP 各一条**（TCP 那条是"禁 UDP 的网络"的退路，
     *   少了它，TCP 候选发出去了却连不进来——那种"半个机制"比没有机制更会误导排查）。 */
    let r3 = 'skip';
    let r4 = 'skip';
    if (mediaPort) {
      r3 = ensureRule('meeting-sfu-media-udp', 'UDP', String(mediaPort));
      r4 = ensureRule('meeting-sfu-media-tcp', 'TCP', String(mediaPort));
    }
    console.log(`  ✔ 防火墙放行（UDP 40000-49999 / TCP 3001,3443${mediaPort ? ` / 媒体固定端口 ${mediaPort} UDP+TCP` : ''}）：`
      + `${[r1, r2, r3, r4].some((r) => r === 'added') ? '本次已添加' : '之前已放行，本次跳过'}`);
  } catch (e) {
    console.log('  ⚠️ 自动放行失败（需要管理员）——双击根目录的 allow-firewall.bat（会自动弹 UAC 提权），或手动执行：');
    console.log(`      netsh advfirewall firewall add rule name="meeting-sfu-udp" dir=in action=allow protocol=UDP localport=40000-49999`);
    console.log(`      netsh advfirewall firewall add rule name="meeting-web-tcp" dir=in action=allow protocol=TCP localport=3001,3443`);
    if (mediaPort) {
      console.log(`      netsh advfirewall firewall add rule name="meeting-sfu-media-udp" dir=in action=allow protocol=UDP localport=${mediaPort}`);
      console.log(`      netsh advfirewall firewall add rule name="meeting-sfu-media-tcp" dir=in action=allow protocol=TCP localport=${mediaPort}`);
    }
  }
  if (await checkExisting()) {
    console.log('⚠️ 检测到 3001 端口已有会议服务在运行——**直接用浏览器打开即可，无需再启动**：');
    console.log(`     http://localhost:3001   /   https://${lan}:3443`);
    console.log('   如需以新配置重启：关掉旧的命令行窗口（或 taskkill /PID <PID> /F）后再跑本脚本。');
    process.exit(0);
  }
  console.log('  启动后可访问：');
  console.log(`    本机会议页   : http://localhost:3001`);
  console.log(`    本机观测面板 : http://localhost:3001/dashboard`);
  console.log(`    局域网(HTTPS): https://${lan}:3443   ← 另一台电脑/手机浏览器打开`);
  console.log(`    局域网(HTTP) : http://${lan}:3001    （无法授权摄像头，仅看页面）`);
  if (picked) {
    /* ★ 09-16 这里原先写的是"配置已带 openrelay TURN，两台设备在不同 WiFi 也能连"——**那句是错的**：
     *   mediasoup 的媒体面不走 TURN 中继（TURN 帮的是浏览器侧候选与信令面），
     *   服务器在 NAT 后面的时候，公共 TURN 也到不了这台机器。
     *   把这句话说出口的后果是用户照着做、连不上、还以为是自己网络坏（坑 82：过期/过度声明比缺失更糟）。
     *   现在按本次真的配上了什么来说，并把"跨网还差哪一步"指名。 */
    console.log(`  跨网络：仅配 TURN **不够**（SFU 媒体不走中继）。已为你准备好的两条路：`);
    console.log(`    ① 固定媒体端口${mediaPort ? ` ${mediaPort}（UDP+TCP 同号）` : '（端口都被占，本次退回随机段）'} —— 路由器上做端口映射时只需转发这一条`);
    console.log('    ② 装 Tailscale（下面有步骤）—— 不用公网 IP、不用碰路由器，配一次长期有效');
    console.log('    实测你现在能不能被外面连上：npm run test:crossnet（会打印 STUN 反射地址与差在哪）');
  }
  console.log('──────────────────────────────────────────────────────');
  console.log('  ★ 跨电脑三步走（同一 WiFi 下，0 元）：');
  console.log('    第 1 步  服务器机：启动完成后点「创建房间」，点右上角房间号徽标复制邀请链接');
  console.log('    第 2 步  把链接发给另一台电脑（微信/QQ/手输均可）');
  console.log('    第 3 步  对方浏览器打开 → 提示证书点"继续访问" → 自动进入同一房间');
  console.log('──────────────────────────────────────────────────────');
  console.log('  ★ 真跨网（两处不同网络）零成本方案 = Tailscale 组网：');
  console.log('    两台设备都装 Tailscale（免费，tailscale.com）→ 各得一个 100.x.x.x 虚拟 IP；');
  console.log(`    本次配置已写 "announceExtra": "tailscale" —— 服务器**同时**通告局域网地址与`);
  console.log('    Tailscale 地址（ICE 给出两条候选），所以同网同事与外面朋友都能用同一个链接进来，');
  console.log('    不再需要"把 announcedIp 改成 Tailscale IP"那一步（那一步会让局域网同事反而连不上）。');
  console.log('    另一台设备用 https://<Tailscale-IP>:3443 打开即可（媒体走加密隧道，无需公网 IP）。');
  console.log('    详读《部署手册.md》B-1；端口映射与云主机形态在 B-3 / B-2。');
  /* ★ 2026-10-06 两件：① 本机装了 Tailscale 就直接把可用地址打出来（原来要自己去 ip a 里找）；
   *   ② 说明 announcedIp 的"auto"写法——本次生成的配置仍写死本机 IP（因为防火墙放行、
   *     打印的链接都按这个地址核对过），但换网络后它会漂，届时不必再跑一遍本脚本。 */
  try {
    const ts = require('../sfu/nets.js').pickTailscaleIp();
    if (ts) console.log(`  🌐 本机已有 Tailscale 地址：https://${ts.ip}:3443（同一张 tailnet 里的设备直接点开就能进）`);
  } catch (e) { /* 判据模块出问题不该拖垮交付脚本 */ }
  console.log('  ▸ 以后换了 WiFi/路由器导致 IP 变了：把 sfu/config.json 的 announcedIp 改成 "auto"');
  console.log('    即可让服务器每次开机自己挑网卡地址（挑法避开 VirtualBox/WSL 那种假局域网），');
  console.log('    不必每次重跑本脚本；要重新放行防火墙时再跑一次。');
  console.log('──────────────────────────────────────────────────────');

  const child = spawn(process.execPath, [path.join(ROOT, 'sfu', 'server.js')], {
    cwd: ROOT, stdio: 'inherit',
  });
  child.on('exit', (code) => process.exit(code ?? 0));
  process.on('SIGINT', () => { try { child.kill(); } catch (e) {} process.exit(0); });
}

main();
