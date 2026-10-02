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

/* 找本机的局域网 IPv4：跳过回环/虚拟网卡的常见前缀，优先 192.168/10./172. */
function detectLanIp() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      candidates.push({ name, addr: a.address });
    }
  }
  const prefer = candidates.filter((c) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(c.addr));
  return { picked: (prefer[0] || candidates[0] || {}).addr || null, candidates };
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
  const { picked, candidates } = detectLanIp();
  console.log('══════════════════════════════════════════════════════');
  console.log('  一键局域网交付：探测本机 IP → 生成配置 → 启动服务器');
  console.log('──────────────────────────────────────────────────────');

  if (!picked) {
    console.log('⚠️ 没有探测到局域网 IPv4（未联网？）。仍将生成仅本机可用的配置。');
  } else {
    console.log(`  候选网卡 IP：${candidates.map((c) => `${c.addr}(${c.name})`).join('  ')}`);
    console.log(`  ✔ 采用：${picked}  （多网卡请手动改 sfu/config.json 的 announcedIp）`);
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
  if (picked) console.log(`    跨网络       : 配置已带 openrelay TURN，两台设备在不同 WiFi 也能连`);
  console.log('  防火墙：优先自动放行（失败则需管理员重跑，或首次弹窗点"允许"）');
  try {
    const { execSync } = require('child_process');
    execSync(`netsh advfirewall firewall add rule name="meeting-sfu-udp" dir=in action=allow protocol=UDP localport=40000-49999`, { stdio: 'ignore' });
    execSync(`netsh advfirewall firewall add rule name="meeting-web-tcp" dir=in action=allow protocol=TCP localport=3001,3443`, { stdio: 'ignore' });
    console.log('  ✔ 防火墙放行规则已添加（UDP 40000-49999 / TCP 3001,3443）');
  } catch (e) {
    console.log('  ⚠️ 自动放行失败（需要管理员）。请用管理员身份重跑本脚本，或手动执行：');
    console.log(`      netsh advfirewall firewall add rule name="meeting-sfu-udp" dir=in action=allow protocol=UDP localport=40000-49999`);
    console.log(`      netsh advfirewall firewall add rule name="meeting-web-tcp" dir=in action=allow protocol=TCP localport=3001,3443`);
  }
  console.log('──────────────────────────────────────────────────────');
  console.log('  ★ 跨电脑三步走（同一 WiFi 下，0 元）：');
  console.log('    第 1 步  服务器机：启动完成后点「创建房间」，点右上角房间号徽标复制邀请链接');
  console.log('    第 2 步  把链接发给另一台电脑（微信/QQ/手输均可）');
  console.log('    第 3 步  对方浏览器打开 → 提示证书点"继续访问" → 自动进入同一房间');
  console.log('──────────────────────────────────────────────────────');
  console.log('  ★ 真跨网（两处不同网络）零成本方案 = Tailscale 组网（09-19 新增说明）：');
  console.log('    两台设备都装 Tailscale（免费，tailscale.com）→ 各得一个 100.x.x.x 虚拟 IP；');
  console.log('    把 sfu/config.json 的 announcedIp 改成服务器机的 Tailscale IP → 重启本脚本；');
  console.log('    另一台设备用 https://<Tailscale-IP>:3443 访问（媒体走加密隧道，无需公网 IP）。');
  console.log('    详读《部署手册.md》方案 D。其他形态（云主机/端口映射）也在该手册。');
  console.log('──────────────────────────────────────────────────────');

  const child = spawn(process.execPath, [path.join(ROOT, 'sfu', 'server.js')], {
    cwd: ROOT, stdio: 'inherit',
  });
  child.on('exit', (code) => process.exit(code ?? 0));
  process.on('SIGINT', () => { try { child.kill(); } catch (e) {} process.exit(0); });
}

main();
