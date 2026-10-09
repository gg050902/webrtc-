'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
 *  sfu/nets.js —— "本机这么多 IP，该对外说哪一个"的唯一实现
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎为什么要单独一个文件（与 password.js / jsonc.js / pyprobe.js 同一条路）：
 *   这件事原本在 sfu/server.js 与 scripts/doctor.js 各写了一份 `os.networkInterfaces()`
 *   的遍历。两份迟早会漂——而它漂一次的代价是**跨机黑屏**（announcedIp 是 mediasoup
 *   写进 ICE candidate 告诉浏览器"媒体发这里"的那个地址，坑 36 的沉默故障）。
 *
 * ▎真正难的不是"拿到 IP 列表"，是**排序**：一台开发机上同时挂着
 *   WLAN(192.168.x)、VirtualBox 宿主网络(192.168.56.1)、WSL、Docker、Tailscale(100.x)
 *   是常态，全都"看起来像局域网"。挑错一个，本机测试一切正常、别人的电脑一律连不上，
 *   而且没有任何报错。所以这里把"哪个网卡名字像真的对外网口"写成一个可断言的函数。
 *
 * ▎零依赖：只用 Node 内置的 os。
 * ═══════════════════════════════════════════════════════════════════════════ */

const os = require('os');

/* 名字里带这些字样的几乎一定是虚拟网卡——它们能 ping 通本机，但别的电脑根本路由不到 */
const VIRTUAL_RE = /(vmware|virtualbox|v-box|veth|docker|wsl|hyper-v|loopback|tap|vtap|bluetooth|蓝牙|pseudo|isatap)/i;
/* 这些字样才是"人真正接在网络上"的口 */
const REAL_RE = /(wi-?fi|wlan|wireless|ethernet|以太网|无线|本地连接)/i;
/* Tailscale 用的是 CGNAT 段 100.64.0.0/10：它**跨网络稳定**，但只有装了同一条 tailnet
 *   的设备路由得到——所以它不该抢"主地址"（会把局域网同事挡在外面），
 *   而是要单独报出来当"跨网入口"。 */
const TAILSCALE_RE = /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./;

const isPrivateIp = (ip) => /^192\.168\./.test(ip) || /^10\./.test(ip)
  || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
const isTailscaleIp = (ip) => TAILSCALE_RE.test(ip);

/** 列出本机所有非回环 IPv4 → [{ip, name}]（顺序不保证，调用方用 pickPrimary/sortByUsability） */
function listLocalIps() {
  const out = [];
  const ifs = os.networkInterfaces() || {};
  for (const name of Object.keys(ifs)) {
    for (const ni of ifs[name] || []) {
      if (String(ni.family) !== 'IPv4' && ni.family !== 4) continue;
      if (ni.internal) continue;
      out.push({ ip: ni.address, name });
    }
  }
  return out;
}

/** 打分：越大越该拿去做 announcedIp。判据写在明面上，好过散在 if 里说不清。 */
function usabilityScore(entry) {
  let s = 0;
  if (isPrivateIp(entry.ip)) s += 40;          // 私网才是典型的局域网可达地址
  if (REAL_RE.test(entry.name || '')) s += 30; // 名字像真的对外网口
  if (VIRTUAL_RE.test(entry.name || '')) s -= 60; // 虚拟网卡：本机通、别人路由不到
  if (isTailscaleIp(entry.ip)) s -= 10;        // 稳定但只对同 tailnet 可达，不抢主位
  return s;
}

/** 名字像虚拟网卡（本机 ping 得通、别人根本路由不到）。
 *  ▎为什么不复用 usabilityScore 的符号：一个名字可以同时像两种口——
 *    'vEthernet (WSL)' 里既有 ethernet(+30) 又有 veth/wsl(-60)，私网段再 +40 → 分数是**正的**，
 *    第一版我拿"分数 <0"当"虚拟"的代理判据，于是 WSL 地址被 'all' 发了出去（测试当场红）。
 *    代理信号会骗人：要问的那个问题就是"名字像不像虚拟口"，那就直接问它（坑 53 的同一条）。 */
function isVirtualNic(entry) {
  return VIRTUAL_RE.test(String((entry && entry.name) || ''));
}

/** 按"该不该对外说"排序（同分时按 IP 字典序，保证结果稳定可断言） */
function sortByUsability(list) {
  return (list || []).slice().sort((a, b) =>
    usabilityScore(b) - usabilityScore(a) || String(a.ip).localeCompare(String(b.ip)));
}

/** 主地址：mediasoup 的 announcedIp / 邀请链接的 host 用它 */
function pickPrimaryIp(list) {
  const s = sortByUsability(list || listLocalIps());
  return s.length ? s[0] : null;
}

/** 跨网稳定入口（Tailscale 装了就有；没装返回 null，调用方据此决定要不要打印那一行） */
function pickTailscaleIp(list) {
  const e = (list || listLocalIps()).find((x) => isTailscaleIp(x.ip));
  return e ? e : null;
}

/** 配置里写的值能不能直接用（'auto'/空 = 让服务器自己挑；其它必须是本机某个真实网卡 IP） */
function resolveAnnouncedIp(configured, list) {
  const ips = list || listLocalIps();
  const want = typeof configured === 'string' ? configured.trim() : '';
  const ipStrings = ips.map((e) => e.ip);
  if (!want || /^(auto|detect|true|本机|自动)$/i.test(want)) {
    const p = pickPrimaryIp(ips);
    return { ip: p ? p.ip : undefined, source: 'auto', nic: p ? p.name : null, ips: ipStrings };
  }
  if (ipStrings.includes(want)) {
    const e = ips.find((x) => x.ip === want);
    return { ip: want, source: 'config', nic: e ? e.name : null, ips: ipStrings };
  }
  const p = pickPrimaryIp(ips);
  return {
    ip: p ? p.ip : undefined, source: 'fallback', stale: want,
    nic: p ? p.name : null, ips: ipStrings,
  };
}

/**
 * ★ K2（2026-10-09）多地址通告：一条媒体通道同时给出**几个"外面该怎么连我"**。
 *
 * ▎为什么要它：以前 announcedIp 只能是一个地址 —— 于是"同局域网的同事"和
 *   "在 Tailscale 上的朋友"要的是**两个不同的配置**，用户只能二选一（选了就黑另一个）。
 *   而 mediasoup 的 listenInfos 本来就允许每个条目带自己的 announcedIp，
 *   ICE 会给出多条候选：在同一张网里的人连局域网那条，走组网的人连 100.x 那条，
 *   **各自挑自己可达的那一个**。一次配置同时服务两种人，才叫"配一次就长期对"。
 *
 * @param {object} o
 *   primary   主地址（resolveAnnouncedIp 算出来的那个）
 *   extra     false|'none' 只发主地址 | 'tailscale'（默认）有组网地址就一起发 |
 *             'all' 把所有真实网卡地址都发 | 字符串数组 = 明示要发哪些
 *   explicit  运维硬要加的地址（不经"是不是本机网卡"校验，给测试与特殊环境留口子）
 *   list      注入的网卡表（可测性）
 * @returns {Array<{ip:string, nic:string, kind:'primary'|'tailscale'|'extra'}>}
 */
function announceIps(o = {}) {
  const list = o.list || listLocalIps();
  const out = [];
  const seen = new Set();
  const add = (ip, nic, kind) => {
    const v = String(ip || '').trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push({ ip: v, nic: nic || '', kind });
  };
  add(o.primary, o.primaryNic, 'primary');

  const extra = o.extra === undefined ? 'tailscale' : o.extra;
  if (Array.isArray(extra)) {
    for (const e of extra) {
      const hit = list.filter((x) => x.ip === String(e).trim())[0];
      // 明示的地址如果真是本机网卡就带上网卡名；不是也照发（可能是容器/NAT 后面的映射地址）
      add(e, hit ? hit.name : 'explicit', 'extra');
    }
  } else if (extra === 'tailscale') {
    const t = pickTailscaleIp(list);
    if (t) add(t.ip, t.name, 'tailscale');
  } else if (extra === 'all') {
    /* "全发"不等于"把所有 IP 都发"：VirtualBox/WSL 那种地址发出去 = 给对方一条
     * 永远连不上的候选（它会排在前面被先试，表现为"别人进会慢或黑屏"）。
     * 判据沿用打分那一份：分数 <0 的就是"名字像虚拟口"，不发；组网地址（100.x）例外要发。 */
    for (const e of sortByUsability(list)) {
      if (isVirtualNic(e) && !isTailscaleIp(e.ip)) continue;
      add(e.ip, e.name, 'extra');
    }
  }
  /* 明示注入的条目单独记 kind='explicit'：**运维/自测硬要发的地址照发**，
   * 但"别让回环地址混进通告"这条默认过滤仍然对自动挑出来的地址生效（坑 36 的教训是
   * 自动挑错网卡会黑屏，而明示注入的意图本来就是"我知道我在干什么"）。 */
  for (const e of (o.explicit || [])) add(e, 'explicit', 'explicit');
  return out;
}

/** 这个值是不是"值得自动告诉外面"的地址（排除回环与 APIPA 自动私有地址）。
 *  ▎为什么默认排除：把 127.x 通告给 peer 等于发一个"对方永远连不上"的候选，
 *    而它会出现在候选列表**第一位**时，某些浏览器会先试它、超时后才试对的地址（变慢且像黑屏）。
 *    明示注入（kind='explicit'）不走这道闸——那是"我知道我要发它"（自测/特殊环境）。 */
function isAdvertisableIp(ip) {
  const v = String(ip || '');
  return !!v && !/^127\./.test(v) && !/^169\.254\./.test(v);
}

/* ══ ★ 2026-10-07 「这台服务器到底能不能被外面连上」的判定（纯函数，test:nets 逐条断言）══
 * ▎为什么要有这个函数：跨网这件事此前有两条路各自说话——启动日志打一行"局域网地址"、
 *   doctor 体检要另跑一遍、页面上的邀请面板只显示两条链接。用户在会议里问的其实是一句话：
 *   **"我朋友在外面，他现在能进来吗？不能的话我下一步敲什么？"**
 *   而这个问题需要同时看 announcedIp 是公网还是私网、网卡是不是虚拟的、配置有没有过期、
 *   HTTPS 开没开、监听地址是不是只绑了本机、有没有 Tailscale——散在六处的判断
 *   各写一份就一定会互相矛盾（坑 47），所以收成一个函数、一个来源。
 * ▎诚实边界（写进返回里而不是藏在注释里）：**mediasoup 的媒体面不走 TURN**。
 *   TURN 帮的是浏览器侧的 ICE 候选，服务器在 NAT 后面的话，公共 TURN 也到不了它——
 *   所以"配了 TURN 就能跨网"是错的，判据里明确说清楚，不让人白配一下午。
 * ▎输入全部显式传入（不在这个函数里读 process.env / os）：这样它能被穷举断言，
 *   也能在没有 Tailscale 的机器上测出"跨网就绪"这一档（与 test:nets 的 TS_IP 同理）。 */
function isPublicIsh(ip) {
  const s = String(ip || '');
  if (!s) return false;
  return !isPrivateIp(s) && !/^127\./.test(s) && !/^169\.254\./.test(s);
}

/**
 * @param {object} o { ip, nic, source, listenIp, httpsEnabled, httpsPort, port,
 *                     iceServers, tailscaleIp }
 * @returns {{level: 'public'|'tailscale'|'lan-only'|'localhost-only',
 *            headline: string, items: Array, canCrossNetNow: boolean}}
 */
function diagnose(o = {}) {
  const ip = String(o.ip || '');
  const listen = String(o.listenIp || '');
  const https = !!o.httpsEnabled;
  const httpPort = o.port || 3001;
  const showPort = https ? (o.httpsPort || 3443) : httpPort;
  const scheme = https ? 'https' : 'http';
  const ice = Array.isArray(o.iceServers) ? o.iceServers : [];
  const hasTurn = ice.some((s) => /turn(s?):/i.test(String(s.urls || s.url || '')));
  const ts = String(o.tailscaleIp || '');
  const rtcPort = Number(o.rtcServerPort) || 0;   // ② 与 ②b 都要用：声明必须在两处之前
  const items = [];
  const push = (state, label, detail, fix) => items.push({ state, label, detail, fix: fix || null });
  /* ★ K2：把"这条服务器一共对外说了几个地址"摆出来 —— 多地址通告的意义是
     "同网的人与组网的人各自挑自己那条"，看不见就等于没做（坑 82）。 */
  const mediaIps = (Array.isArray(o.mediaIps) ? o.mediaIps : []).map((x) => (typeof x === 'string' ? { ip: x } : x)).filter((x) => x && x.ip);
  if (mediaIps.length > 1) {
    push('ok', '通告地址', `一条媒体通道给出 ${mediaIps.length} 个地址（${mediaIps.map((x) => x.ip).join(' · ')}）—— 同网与组网的人各走自己可达的那条`);
  } else if (mediaIps.length === 1) {
    push('info', '通告地址', `只对外说一个地址（${mediaIps[0].ip}）`
      + (o.tailscaleIp && String(o.announceExtra || 'tailscale') === 'tailscale' ? ' —— 本机没有组网网卡可加' : ''),
      '想让局域网与 Tailscale 同时可用：config.json 里 "announceExtra": "all"（或明示数组）');
  }

  /* ① 网页本身能不能被别的设备打开 */
  if (/^127\.|^localhost$/i.test(listen) || listen === '') {
    push('bad', '网页监听', '只绑在本机（' + (listen || '默认') + '），别的设备连页面都打不开',
      'npm run start:lan   # 一条命令改成 0.0.0.0 + 自签 HTTPS + 放行防火墙');
  } else {
    push('ok', '网页监听', listen + '（本机所有网卡都能被访问到）');
  }

  /* ② 媒体地址：这一条决定"外面的人能不能看见画面" */
  const publicIp = isPublicIsh(ip);
  if (!ip) {
    push('bad', '媒体地址', '没有拿到任何可对外通告的 IP（网卡都没起来？）',
      'npm run start:lan');
  } else if (publicIp) {
    push('ok', '媒体地址', ip + ' 是公网地址 —— 跨网可直达，不需要组网工具');
  } else if (ts) {
    push('warn', '媒体地址', ip + ' 是局域网地址，但本机有 Tailscale 地址 ' + ts + ' —— 跨网走那条',
      '让对方也装 Tailscale 并加入同一个账号，然后复制邀请面板里"跨网"那条链接');
  } else {
    push('bad', '媒体地址', ip + ' 只在局域网里可达 —— 不在同一个网络的人**看不到画面**（网页能打开也没用）',
      '三选一：① 装 Tailscale 组网（零成本首选）② 部署到有公网 IP 的云主机 '
      + (rtcPort > 0 ? `③ 路由器把 UDP+TCP ${rtcPort} 转发到本机（固定端口，一条就够）`
        : '③ 路由器做端口映射（UDP 40000-49999；建议先配 "rtcServerPort" 改成一条固定端口）'));
  }

  /* ②b 媒体端口形态（K1，2026-10-09）：这一条决定"跨网要转发多少东西"。
     ▸ 默认（没配 rtcServerPort）：每条 Transport 在 40000-49999 里随机要一对 **UDP** 端口，
       而且只有 UDP —— 于是"把会议开到别的网络"意味着转发一整段端口，
       并且遇上"公司/校园网把 UDP 全封了"就完全没有退路。
     ▸ 配了 rtcServerPort：整个 Worker 共用一个号，**UDP + TCP 同口号**
       → 路由器/防火墙只需一条映射，UDP 被封时 ICE 自动退到 tcp 候选。
     这条判据是"能不能跨网"的一部分，所以摆到界面上说，不留在代码注释里（坑 82）。 */
  if (rtcPort > 0) {
    push('ok', '媒体端口', `固定端口 UDP+TCP ${rtcPort}（WebRtcServer）—— 端口映射只需一条，禁 UDP 的网络还能走 TCP`);
  } else {
    push('warn', '媒体端口', `随机端口段 ${o.rtcMinPort || 40000}-${o.rtcMaxPort || 49999}，且只有 UDP`,
      'config.json 加 "rtcServerPort": 4443 → 全服务器共用一个 UDP+TCP 口号，跨网只需转发这一条');
  }

  /* ③ 配置里的地址是不是已经过期（DHCP 漂 IP 是本项目最坑的"沉默故障"，坑 36） */
  if (o.source === 'fallback') {
    push('bad', '配置核对', 'config.json 里写的 ' + (o.stale || '某个旧 IP') + ' 已经不是本机任何网卡的地址，本次自动改用 ' + (ip || '(无)'),
      'npm run start:lan   # 会保留你手工改过的字段，只重写地址');
  } else if (o.source === 'auto') {
    push('ok', '配置核对', 'announcedIp 是每次开机自动探测的（写的 "auto"，不会过期）' + (o.nic ? ' · 网卡 ' + o.nic : ''));
  } else if (o.source === 'config') {
    push('ok', '配置核对', '用的是 config.json 明示的地址 ' + ip + '（换网络后要记得改）');
  }

  /* ④ 安全上下文：http + IP 访问时浏览器会直接禁掉摄像头 */
  if (https) {
    push('ok', 'HTTPS', '已开（' + scheme + '://' + ip + ':' + showPort + '），跨机访问不会因"非安全上下文"拿不到摄像头');
  } else {
    push('warn', 'HTTPS', '没开 —— 别的设备用 http://内网IP 打开时，浏览器会禁用摄像头/麦克风',
      '在 config.json 里把 https.enabled 设为 true（自签证书会自动生成），或直接 npm run start:lan');
  }

  /* ⑤ TURN 的实话：它帮不到 SFU 的媒体面 */
  if (hasTurn) {
    push('ok', 'ICE / TURN', '配了 TURN —— 但请注意：**mediasoup 的媒体不走 TURN**，'
      + '它帮的是浏览器侧的候选与信令面；服务器在 NAT 后面时公共 TURN 也到不了这台机器');
  } else {
    push('info', 'ICE / TURN', '没配 TURN（对本项目影响有限：SFU 媒体面只认 announcedIp 可达）',
      '需要时看《部署手册.md》B-1/B-4；想自建：deploy/coturn 里一条 docker compose');
  }

  const localhostOnly = /^127\.|^localhost$/i.test(listen) || listen === '';
  const level = localhostOnly ? 'localhost-only' : (publicIp ? 'public' : (ts ? 'tailscale' : 'lan-only'));
  const headline = {
    'localhost-only': '这台服务器只对自己开放，别的设备连网页都打不开',
    public: '跨网可用：这台机器的媒体地址是公网可达的',
    tailscale: '同局域网直接可用；跨网请让对方走 Tailscale 那条链接',
    'lan-only': '只有同一个局域网里的人能进会（跨网还差一步）',
  }[level];
  return {
    level,
    headline,
    items,
    canCrossNetNow: level === 'public' || level === 'tailscale',
    /* 「跨网还能不能多一条路」的事实，由服务器交出来（watch/界面都读它，不各自判断，坑 47） */
    fixedMediaPort: rtcPort > 0 ? rtcPort : 0,
    tcpFallback: rtcPort > 0,
  };
}

module.exports = {
  listLocalIps, sortByUsability, usabilityScore,
  pickPrimaryIp, pickTailscaleIp, resolveAnnouncedIp, announceIps, isAdvertisableIp, isVirtualNic,
  isPrivateIp, isTailscaleIp, isPublicIsh, diagnose,
};
