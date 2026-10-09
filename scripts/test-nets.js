#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 *  test:nets —— "本机该对外说哪个 IP" 的判据回归（sfu/nets.js）
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎为什么要单独一套：这件事错了不会报错。mediasoup 把我们挑的地址写进 ICE candidate
 *   告诉浏览器"媒体发这里"——挑成 VirtualBox 的 192.168.56.1，本机 localhost 全好、
 *   别人的电脑一律黑屏，日志里一行异常都没有（坑 36 的沉默故障）。
 *   控制律判据错了不会让任何功能变红，只会天天连不上而没人知道为什么（同 test:watch 的理由）。
 * ▎跑法：npm run test:nets（纯函数，不用起服务器）
 * ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');
const Nets = require('../sfu/nets.js');
const { parseJsonc } = require('../sfu/jsonc.js');

let pass = 0; let fail = 0;
/* 坑 110 的常驻守卫（本文件约定 ok(名字, 条件)） */
const { guard: guardOk } = require('./assert-order-guard.js');
const ok = (name, cond, extra) => {
  const bad = guardOk('name-first', name, cond);
  if (bad) { fail += 1; console.log(`  FAIL  ${String(name).slice(0, 60)}  · 参数顺序守卫：${bad}`); return; }
  if (cond) { pass += 1; console.log(`  PASS  ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${extra ? '  · ' + extra : ''}`); }
};

/* 一台典型开发机：WLAN 是真口，另外三个都是"本机通、别人路由不到"的假局域网 */
const DEV = [
  { ip: '192.168.56.1', name: 'VirtualBox Host-Only Network' },
  { ip: '172.29.112.1', name: 'vEthernet (WSL)' },
  { ip: '192.168.123.45', name: 'WLAN' },
  { ip: '100.101.102.103', name: 'Tailscale' },
];

console.log('\n=== ① 排序：真网口要赢过虚拟网卡（同是私网段时名字才算数）===');
{
  const p = Nets.pickPrimaryIp(DEV);
  ok('WLAN 被选为主地址（不是先出现的 VirtualBox）', p && p.ip === '192.168.123.45',
    p ? `选了 ${p.ip}（${p.name}）` : '没选出来');
  ok('虚拟网卡分数低于真网口（判据本身可断言，不靠实现细节）',
    Nets.usabilityScore({ ip: '192.168.56.1', name: 'VirtualBox Host-Only Network' })
    < Nets.usabilityScore({ ip: '192.168.123.45', name: 'WLAN' }));
  ok('以太网/无线/本地连接 这些中文名也算真网口（中文 Windows 是本项目的主战场）',
    Nets.pickPrimaryIp([{ ip: '10.0.0.5', name: '以太网' }, { ip: '10.0.0.6', name: 'vEthernet (Docker)' }]).ip === '10.0.0.5');
}

console.log('\n=== ② Tailscale：报得出来，但不抢主位 ===');
{
  const p = Nets.pickPrimaryIp(DEV);
  const t = Nets.pickTailscaleIp(DEV);
  ok('主地址不是 100.x（拿它当 announcedIp 会把同局域网的同事挡在外面）', p.ip !== '100.101.102.103');
  ok('Tailscale 地址单独取得到（跨网链接就发这个）', t && t.ip === '100.101.102.103');
  ok('没装 Tailscale 时返回 null（前端不显示这一项，绝不编一个"看起来能用"的地址）',
    Nets.pickTailscaleIp([{ ip: '192.168.1.5', name: 'Wi-Fi' }]) === null);
  ok('CGNAT 段边界判对（100.64.0.0 属于、100.63.9.9 不属于）',
    Nets.isTailscaleIp('100.64.0.0') && !Nets.isTailscaleIp('100.63.9.9'));
}

console.log('\n=== ③ resolveAnnouncedIp：三种配置各走各的路径 ===');
{
  ok('写 "auto" = 每次开机自己探测（source:auto，这就是"配一次就长期对"的那一次配置）',
    (() => { const r = Nets.resolveAnnouncedIp('auto', DEV); return r.source === 'auto' && r.ip === '192.168.123.45'; })());
  ok('留空与 "auto" 同义（新机器不配也不会通告一个错地址）',
    Nets.resolveAnnouncedIp('', DEV).source === 'auto' && Nets.resolveAnnouncedIp(undefined, DEV).source === 'auto');
  ok('写死且仍在本机网卡上 → 照用（source:config，云主机/弹性 IP 的场景）',
    (() => { const r = Nets.resolveAnnouncedIp('192.168.56.1', DEV); return r.source === 'config' && r.ip === '192.168.56.1'; })());
  const stale = Nets.resolveAnnouncedIp('192.168.99.99', DEV);
  ok('写死了但 IP 已经漂 → 自动回退真实网卡并留下 stale 证据（坑 36 的兜底）',
    stale.source === 'fallback' && stale.stale === '192.168.99.99' && stale.ip === '192.168.123.45');
  ok('一台机器一个 IP 都没有时不编地址（ip=undefined，调用方要能说人话）',
    Nets.resolveAnnouncedIp('', []).ip === undefined);
}

console.log('\n=== ④ 接线：服务器与 doctor 用的是这一份实现（不是又抄一遍）===');
{
  const srv = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'server.js'), 'utf8');
  const doc = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'doctor.js'), 'utf8');
  ok('server.js require 了 nets.js 且不再自己遍历 networkInterfaces',
    /require\('\.\/nets'\)/.test(srv) && !/os\.networkInterfaces\(\)/.test(srv));
  /* ★ 这条是**我自己差点制造的那次事故**：搬走 detectLocalIps 时先删了函数、
   *   留下两处调用点（HTTPS 自签的 SAN 计算 + 启动打印）。node --check 全绿，
   *   真跑带 HTTPS 的启动才会 ReferenceError——"删实现留调用点"是重构最便宜的死法。 */
  ok('server.js 里没有任何遗留的 detectLocalIps 调用（实现搬走后调用点必须一起清）',
    !/detectLocalIps\s*\(/.test(srv));
  ok('doctor.js 的 pickLanIp 走同一份判据（两处各写一份 = 迟早各说各话，坑 47）',
    /require\('\.\.\/sfu\/nets\.js'\)/.test(doc) && /Nets\.pickPrimaryIp/.test(doc));
  ok('/config.json 下发 tsUrl（跨网入口在界面上看得见，不只在启动日志里滚过去）',
    /tsUrl: \(\(\) => \{/.test(srv) && /Nets\.pickTailscaleIp\(\)/.test(srv));
  /* ★ 2026-10-06 TS_IP 是操作者明示的覆盖：Tailscale 装在非标准网卡、或组网工具给的
   *   不是恰好被 Nets 认出的地址时用它；也让"这条链接真会出现在顶栏"可被自测跑通
   *   （本机没装 Tailscale 时，正例只能靠这个入口验证——不靠运气）。 */
  ok('tsUrl 认 TS_IP 明示覆盖（正例可测、非标准网卡可部署）',
    /process\.env\.TS_IP/.test(srv));
  {
    const clientSrc = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'client.js'), 'utf8');
    ok('tsUrl 到顶栏按钮：读取器落地时双向 toggle（没有就藏，不留假链接）',
      /crossLinkBtn\.classList\.toggle\('hidden', !tsUrl\)/.test(clientSrc));
    /* ★ 2026-10-06 上一条注释声称"配置改回没有 Tailscale 时按钮也不会留着骗人"，
     *   而赋值写的是 `if (cfg.tsUrl) tsUrl = cfg.tsUrl` —— **只写有值的一侧**，
     *   页面活着期间撤掉入口，旧值会永远留着，那句 toggle 就再也没机会藏它。
     *   这条断言钉的就是"没有"这一侧也要落地（坑 76：机制在，但从来没生效过）。 */
    ok('tsUrl 赋值是双向的（cfg 里没有就落回 null，否则"没有就藏"那句声明是假的）',
      /tsUrl = cfg\.tsUrl \|\| null;/.test(clientSrc));
  }
  const ex = parseJsonc(fs.readFileSync(path.join(__dirname, '..', 'sfu', 'config.example.json'), 'utf8'));
  ok('config.example.json 的 announcedIp 模板就是 "auto"（复制即得"不会过期"的配置）',
    ex.announcedIp === 'auto', `实际=${JSON.stringify(ex.announcedIp)}`);
}

/* ══ ★ 2026-10-07 跨网可达性判定 diagnose()（用户在会里问的那一句，第一次有了机器答案）══
 *   ▎"我朋友在外面，他现在能进来吗？不能的话我下一步敲什么？"
 *   以前这件事的答案散在启动日志 / doctor / 部署手册三处。判据收进 nets.diagnose 之后，
 *   它必须**可穷举断言**——否则这个函数一漂，页面上那段话就成了错的安慰。 */
console.log('\n=== 跨网可达性判定 diagnose()（2026-10-07）===');
{
  const base = { ip: '192.168.1.20', nic: 'WLAN', source: 'auto', listenIp: '0.0.0.0',
    httpsEnabled: true, httpsPort: 3443, port: 3001, iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], tailscaleIp: '' };
  const d = (o) => Nets.diagnose(Object.assign({}, base, o));

  const lan = d({});
  ok('只有局域网地址 → lan-only，并且明说"不在同一个网络的人看不到画面"',
    lan.level === 'lan-only' && lan.canCrossNetNow === false && /看不到画面/.test(JSON.stringify(lan.items)),
    lan.headline);
  const ts = d({ tailscaleIp: '100.101.102.103' });
  ok('本机有 Tailscale 地址 → tailscale 档，判"现在就能跨网"（这才是零成本那条路）',
    ts.level === 'tailscale' && ts.canCrossNetNow === true);
  const pub = d({ ip: '203.0.113.9' });
  ok('公网地址 → public 档（不需要组网工具）',
    pub.level === 'public' && pub.canCrossNetNow === true && /公网/.test(JSON.stringify(pub.items)));
  const lo = d({ listenIp: '127.0.0.1' });
  ok('只监听 127.0.0.1 → localhost-only（网页本身别人就打不开，与媒体地址无关）',
    lo.level === 'localhost-only' && lo.canCrossNetNow === false);
  /* 每条 bad/warn 都必须带"下一步敲什么"——只报问题不给动作的诊断等于把人推回手册 */
  const withFix = d({ ip: '192.168.1.20' });
  ok('每一条不合格项都带可复制的修复动作（不是"请检查网络"这种空话）',
    withFix.items.filter((i) => i.state === 'bad').every((i) => typeof i.fix === 'string' && i.fix.length > 8),
    JSON.stringify(withFix.items.filter((i) => i.state === 'bad').map((i) => i.fix)));
  /* 配置过期（坑 36 的沉默故障）必须单独成一条，且说清本次实际用了谁 */
  const stale = d({ ip: '192.168.9.9', source: 'fallback', stale: '192.168.170.194' });
  ok('config 里的 IP 已过期 → 单独一条 bad，并写明本次自动改用哪个地址',
    stale.items.some((i) => i.state === 'bad' && /192\.168\.170\.194/.test(i.detail) && /192\.168\.9\.9/.test(i.detail)),
    JSON.stringify(stale.items.map((i) => i.label + ':' + i.detail).slice(0, 4)));
  /* HTTPS 关掉必须报出来：http + IP 时浏览器直接禁摄像头（第 33 步那条规则） */
  ok('HTTPS 关着 → warn，并指到 start:lan（不是让人去手改配置）',
    d({ httpsEnabled: false }).items.some((i) => i.state === 'warn' && /摄像头/.test(i.detail) && /start:lan/.test(i.fix || '')));
  /* 诚实边界：TURN 帮不到 SFU 媒体面——这句话不许被"配了 TURN 就能跨网"取代 */
  ok('配了 TURN 时明确说"媒体面不走 TURN"（不给人一个会浪费半天时间的错觉）',
    d({ iceServers: [{ urls: 'turn:turn.example.com:443', username: 'u', credential: 'c' }] })
      .items.some((i) => /不走 TURN/.test(i.detail)));
  /* 反向对照：全绿的一台机器不许出现任何 bad（否则这台哨兵是"逢人就说有问题"） */
  const good = d({ ip: '203.0.113.9', iceServers: [{ urls: 'turn:x' }, { urls: 'stun:y' }] });
  ok('公网 + HTTPS + 0.0.0.0 的部署：一条 bad 都不该有（诊断工具不许制造焦虑）',
    good.items.every((i) => i.state !== 'bad'), JSON.stringify(good.items.map((i) => i.label + '=' + i.state)));
  /* 接线：判据只有一份，前端只显示不另算 */
  const srv = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'server.js'), 'utf8');
  ok('/config.json 下发 netCheck（判据在服务器算，前端不参与判断）',
    /netCheck: Nets\.diagnose\(/.test(srv));
  const cli = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'client.js'), 'utf8');
  ok('前端只渲染不判断（没有第二份"能不能跨网"的判据），且读不到时整块不出现',
    /serverNetCheck = cfg\.netCheck \|\| null;/.test(cli) && !/canCrossNetNow\s*=/.test(cli)
      && /box\.classList\.add\('hidden'\)/.test(cli));
}

console.log('\n=== ⑦ K2 多地址通告：同网与组网的人各挑一条（announceIps）===');
{
  const pri = Nets.pickPrimaryIp(DEV);
  const only = Nets.announceIps({ primary: pri.ip, primaryNic: pri.name, extra: 'none', list: DEV });
  ok('extra=none 时只发主地址（与 K2 之前的行为逐字一致）',
    only.length === 1 && only[0].ip === '192.168.123.45', JSON.stringify(only));
  const ts = Nets.announceIps({ primary: pri.ip, primaryNic: pri.name, extra: 'tailscale', list: DEV });
  ok('默认（tailscale）自动多给一条组网候选：局域网 + Tailscale 同时可用',
    ts.length === 2 && ts[1].ip === '100.101.102.103' && ts[1].kind === 'tailscale', JSON.stringify(ts));
  ok('主地址永远排第一（同网的人不必等 ICE 去试错的那条）',
    ts[0].ip === '192.168.123.45' && ts[0].kind === 'primary', JSON.stringify(ts[0]));
  const all = Nets.announceIps({ primary: pri.ip, extra: 'all', list: DEV });
  const allIps = all.map((x) => x.ip);
  ok('"all" 把虚拟网卡的地址挡在外面（发出去就是给对端一条永远连不上的候选）',
    !allIps.includes('192.168.56.1') && !allIps.includes('172.29.112.1')
    && allIps.includes('192.168.123.45') && allIps.includes('100.101.102.103'), JSON.stringify(allIps));
  const arr = Nets.announceIps({ primary: pri.ip, extra: ['10.0.0.9'], list: DEV });
  ok('明示数组按原样发（运维自己清楚的第二个地址不必能在网卡表里查到名字）',
    arr.some((x) => x.ip === '10.0.0.9'), JSON.stringify(arr));
  const exp = Nets.announceIps({ primary: pri.ip, extra: 'none', explicit: ['127.0.0.2'], list: DEV });
  ok('★ explicit 注入允许回环段（自测要能造出多候选，不要求这台机器恰好有第二张网卡）',
    exp.length === 2 && exp[1].kind === 'explicit', JSON.stringify(exp));
  const dup = Nets.announceIps({ primary: '100.101.102.103', extra: 'tailscale', list: DEV });
  ok('主地址本身就是组网地址时不重复发第二条（去重，不是靠顺序碰巧）',
    dup.length === 1, JSON.stringify(dup));
  ok('isAdvertisableIp 挡回环与 APIPA（自动挑的时候不许发这两种）',
    Nets.isAdvertisableIp('192.168.1.5') === true && Nets.isAdvertisableIp('127.0.0.1') === false
      && Nets.isAdvertisableIp('169.254.7.7') === false);
  const d2 = Nets.diagnose({
    ip: '192.168.1.50', listenIp: '0.0.0.0', httpsEnabled: true,
    mediaIps: [{ ip: '192.168.1.50', kind: 'primary' }, { ip: '100.64.0.9', kind: 'tailscale' }],
  });
  const advItem = (d2.items || []).filter((x) => /通告地址/.test(x.label))[0];
  ok('判定里「通告地址」按真实条数说话（两条 → ok + 写明各是谁）',
    !!advItem && advItem.state === 'ok' && /2 个地址/.test(advItem.detail), JSON.stringify(advItem));
  const d1 = Nets.diagnose({ ip: '192.168.1.50', listenIp: '0.0.0.0', httpsEnabled: true, mediaIps: [{ ip: '192.168.1.50' }] });
  const adv1 = (d1.items || []).filter((x) => /通告地址/.test(x.label))[0];
  ok('只有一条时给 info + 指路"怎么变成两条"（不装作没问题，也不报成故障）',
    !!adv1 && adv1.state === 'info' && /announceExtra/.test(String(adv1.fix)), JSON.stringify(adv1));
  const d0 = Nets.diagnose({ ip: '192.168.1.50', listenIp: '0.0.0.0', httpsEnabled: true });
  ok('老服务器没发 mediaIps 时**不新增这一条**（读不到 ≠ 读到 0，坑 67 的同一条纪律）',
    !(d0.items || []).some((x) => /通告地址/.test(x.label)));
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
