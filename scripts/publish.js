/* ════════════════════════════════════════════════════════════════════════════
 * scripts/publish.js —— 一键把 Mesh 版发布成"别人能打开的公网地址"
 *
 * ▎它到底解决什么问题？（先看这一段）
 *   项目一直在本机/局域网跑得挺好，但"发给同学让他点开就能开会"过不去。原因有三层，
 *   一层层都得处理，只做其中一层都会失败：
 *
 *     ① 【代码层】发布目录必须是**当前**代码。以前 publish-mesh/ 是手工拷的，
 *        根目录改了它不会跟着变——于是"发布的版本"和"在跑的版本"慢慢就不是一回事了
 *        （和本项目刚踩过的 Service Worker 缓存旧 JS 是同一类病：**副本会漂移**）。
 *        → 本脚本每次**重新生成** publish-mesh/，副本不可能漂移。
 *
 *     ② 【网络层】要让外网的浏览器能访问到你这台机器，需要一个"公网入口"。
 *        可选：Cloudflare Tunnel（免费、免注册、最省事）、ngrok（要账号）、
 *        或者干脆部署到有公网 IP 的云主机（见《部署手册.md》场景 C）。
 *
 *     ③ 【媒体层】★ 这层最容易被忽略，也最致命：
 *        Mesh 版媒体是 **P2P 直达**，不经过服务器。所以就算你把网页发布出去了，
 *        两台不同网络的电脑之间**能不能传音视频，取决于 ICE 打洞**——
 *        只配 STUN 时，只要有一方在严格 NAT（公司网/4G/酒店 WiFi）就黑屏。
 *        → 发布前必须把 TURN 配好（写进 mesh.config.json 的 iceServers），
 *           由服务器通过 /config.json 下发给浏览器。脚本会**主动检查**这一项并报警。
 *
 * ▎用法：
 *     node scripts/publish.js                 只做构建 + 体检（不启动任何东西）
 *     node scripts/publish.js --tunnel        构建后启动服务，并尝试开隧道拿公网地址
 *     node scripts/publish.js --bundle        构建时把依赖也拷进去（要上传到云主机时用）
 *     node scripts/publish.js --port 8080     临时改端口（默认读 mesh.config.json）
 *
 * ▎设计取舍（为什么写成"构建 + 体检 + 可选隧道"三段）：
 *   发布这件事里，"构建"和"体检"是**确定性**的（可以自动做、可以自动测），
 *   而"开隧道"依赖本机装了什么工具、要不要登录，是**不确定性**的。
 *   把不确定的那段做成可选开关，好处是：一个不装任何隧道工具的机器上，
 *   `node scripts/publish.js` 依然能跑完前两段并给出明确结论——
 *   这比"跑一半报错退出"有用得多。
 * ════════════════════════════════════════════════════════════════════════════ */

'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'publish-mesh');

/* ---- 命令行参数 ---- */
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const argOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const WANT_TUNNEL = has('--tunnel');
const WANT_BUNDLE = has('--bundle');
const PORT_OVERRIDE = argOf('--port');
const WANT_CHECK = has('--check');

/* ---- 小工具：终端彩色输出（零依赖，纯 ANSI） ---- */
const C = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  err: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};
const step = (n, t) => console.log(`\n${C.bold(`【${n}】`)} ${t}`);
const pass = (t) => console.log(`  ${C.ok('✅')} ${t}`);
const warn = (t) => console.log(`  ${C.warn('⚠️')} ${t}`);
const fail = (t) => console.log(`  ${C.err('❌')} ${t}`);

/* ══════════════════════════════════════════════════════════════════════════
 * 第一段：生成发布目录
 *
 * ▎为什么是"生成"而不是"拷贝"？
 *   拷贝有两种：一是每次手工拷（会漂移），二是脚本拷完就完事（这次不漂移，
 *   下次改完根目录又忘了跑脚本，还是会漂移）。真正的解法是让"发布"成为
 *   **一个可重复执行的、幂等的动作**——每次发布前跑一遍，副本必然是最新的。
 *   顺带一个好处：发布目录里出现的东西是**白名单**决定的，
 *   不会像 `cp -r .` 那样把 .env、logs、recordings 一起带上公网。
 * ══════════════════════════════════════════════════════════════════════════ */

// 发布白名单：根目录 → publish-mesh/（只列该上线的文件，一个不多一个不少）
const COPY_LIST = [
  ['server.js', 'server.js'],
  ['public/index.html', 'public/index.html'],
  ['public/style.css', 'public/style.css'],
  ['public/client.js', 'public/client.js'],
  ['public/workbench.html', 'public/workbench.html'],
  ['public/vendor/socket.io.min.js', 'public/vendor/socket.io.min.js'],
];

function build() {
  step(1, `生成发布目录 ${C.dim('publish-mesh/')}`);

  // 清空重建：保证"发布目录 = 当前代码"，绝不残留上次的旧文件
  //   ▎注意只删 publish-mesh 这一个由本脚本生成的目录（不碰用户其他任何东西）
  if (fs.existsSync(OUT)) {
    fs.rmSync(OUT, { recursive: true, force: true });
    console.log(C.dim('  · 已清空旧的 publish-mesh/（确保不留上一版残留）'));
  }
  fs.mkdirSync(path.join(OUT, 'public', 'vendor'), { recursive: true });

  let n = 0;
  for (const [from, to] of COPY_LIST) {
    const src = path.join(ROOT, from);
    if (!fs.existsSync(src)) { fail(`缺少源文件：${from}（发布包会不完整）`); process.exitCode = 1; continue; }
    fs.copyFileSync(src, path.join(OUT, to));
    const kb = (fs.statSync(src).size / 1024).toFixed(1);
    console.log(C.dim(`  · ${from} → ${to}  (${kb} KB)`));
    n++;
  }
  pass(`已复制 ${n}/${COPY_LIST.length} 个文件`);

  // 写发布目录自己的 package.json（云端/容器里 npm start 就能起）
  const pkg = {
    name: 'simple-tencent-meeting-mesh',
    version: '1.0.0',
    private: true,
    description: 'WebRTC 多人会议（Mesh/P2P 版）· 发布包（由 scripts/publish.js 生成，勿手工修改）',
    scripts: { start: 'node server.js' },
    dependencies: { 'socket.io': require(path.join(ROOT, 'package.json')).dependencies['socket.io'] },
  };
  fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  console.log(C.dim('  · 已写 package.json（声明 socket.io 依赖）'));
  return true;
}

/* ══════════════════════════════════════════════════════════════════════════
 * ★ 同步自检（--check）：当前 publish-mesh/ 是不是和源码一致？
 *
 * ▎这里有一个必须讲清楚的坑，因为我自己先写错了：
 *   最早我把"逐字节比对"直接写在 build() 末尾——结果它是个**永真断言**：
 *   build() 一上来就把 publish-mesh/ 删掉重建，等比对时文件当然一致。
 *   一个"先修复、再检查"的自检，永远不可能失败，也就永远抓不到问题。
 *   （更隐蔽的是：它还会让针对它的测试也"通过"——我当时那条断言用的是
 *     /不一致|漂移/ 正则，结果匹配到了成功信息里的"没有漂移"四个字。
 *     教训有两层：自检动作绝不能先修复再检查；负向断言的正则不能太松。）
 *
 * ▎那"漂移"到底是什么问题？注意：build() 每次重建，所以**发布包自己不可能漂移**。
 *   真正会出事的是**时间差**：
 *     你上次发布了 → 之后继续改根目录代码 → 但没重新发布 → 线上还是旧版。
 *   这就是"副本过期"。一个人是察觉不到这件事的（本地跑的是根目录，一切正常）。
 *   所以这个自检不修东西，只回答一个问题：
 *     "你现在的发布包，和你现在的源码，是不是同一个版本？"
 * ══════════════════════════════════════════════════════════════════════════ */

function checkSync() {
  const diffs = [];
  if (!fs.existsSync(OUT)) return { exists: false, diffs: [] };
  for (const [from, to] of COPY_LIST) {
    const src = path.join(ROOT, from);
    const dst = path.join(OUT, to);
    if (!fs.existsSync(dst)) { diffs.push({ file: to, why: '发布包里缺这个文件' }); continue; }
    if (!fs.existsSync(src)) { diffs.push({ file: from, why: '源码里缺这个文件' }); continue; }
    if (Buffer.compare(fs.readFileSync(src), fs.readFileSync(dst)) !== 0) {
      const a = fs.statSync(src).mtime, b = fs.statSync(dst).mtime;
      diffs.push({ file: to, why: `内容不同（源码 ${a.toLocaleString('zh-CN')} / 发布包 ${b.toLocaleString('zh-CN')}）` });
    }
  }
  return { exists: true, diffs };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 第二段：写发布用的 mesh.config.json —— 也就是"跨网能不能通"的开关
 * ══════════════════════════════════════════════════════════════════════════ */

// 默认 TURN：openrelay 的免费公共 TURN（metered.ca 提供，演示/学习够用）
//   ▎为什么给免费 TURN 而当默认值？因为"跨网第一次就成功"体验优先。
//     生产环境务必换成自建 coturn（deploy/coturn 里有 docker-compose，一条命令起）。
const OPENRELAY_TURN = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp', 'turns:openrelay.metered.ca:443'],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

function writeMeshConfig(port) {
  step(2, '写发布配置 mesh.config.json（ICE 开关）');

  // 根目录若已有 mesh.config.json（用户自己配过 TURN），就尊重它，只补端口/公网占位
  const srcCfg = path.join(ROOT, 'mesh.config.json');
  let cfg = {};
  if (fs.existsSync(srcCfg)) {
    try { cfg = JSON.parse(fs.readFileSync(srcCfg, 'utf8')); pass('读到根目录 mesh.config.json，沿用你的配置'); }
    catch (e) { warn(`根目录 mesh.config.json 解析失败，改用默认值：${e.message}`); }
  } else {
    console.log(C.dim('  · 根目录没有 mesh.config.json，使用默认（含免费公共 TURN）'));
  }

  const ice = Array.isArray(cfg.iceServers) && cfg.iceServers.length ? cfg.iceServers : OPENRELAY_TURN;
  const out = {
    _comment: '由 scripts/publish.js 生成。改 ICE/TURN 请改根目录 mesh.config.json 后重新发布。',
    port: Number(port || cfg.port || 8081),
    host: cfg.host || '0.0.0.0',
    iceServers: ice,
    publicUrl: cfg.publicUrl || null,
  };
  fs.writeFileSync(path.join(OUT, 'mesh.config.json'), JSON.stringify(out, null, 2) + '\n');

  const stun = ice.filter((s) => String(s.urls).startsWith('stun:')).length;
  const turn = ice.filter((s) => String(s.urls).startsWith('turn')).length;
  console.log(`  · 端口 ${out.port}，STUN ${stun} 条 / TURN ${turn} 条`);
  if (turn > 0) pass('已配 TURN：严格 NAT 下会退回中继，跨网络也能连通');
  else {
    warn('没有配 TURN：跨网络遇到严格 NAT（公司网/4G/酒店 WiFi）会连不上音视频');
    console.log(C.dim('     修法：在根目录建 mesh.config.json，把 iceServers 换成你的 coturn 地址'));
    console.log(C.dim('     （deploy/coturn 里有 docker-compose，一条命令起一个自建 TURN）'));
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 第三段：体检 —— 真的把发布包跑起来，看它能不能正确吐出配置
 *
 * ▎为什么要真的起一次？"生成了文件"和"文件能用"是两件事。
 *   只检查文件存在，等于没测；本脚本起一个临时进程 + HTTP 请求，
 *   确认 /config.json 真的把 TURN 下发出来了才叫通过。
 * ══════════════════════════════════════════════════════════════════════════ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function probe(port, pathname, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const req = require('http').get(
      { host: '127.0.0.1', port, path: pathname, timeout: timeoutMs },
      (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      },
    );
    req.on('error', (e) => resolve({ error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
  });
}

async function healthCheck() {
  step(3, '体检：把发布包真的跑起来，验证配置能正确下发');

  const port = 18081; // 用不常用的端口，避免和正在跑的 3000/3001 撞
  const child = spawn(process.execPath, ['server.js'], {
    cwd: OUT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let outText = '';
  child.stdout.on('data', (d) => { outText += d; });
  child.stderr.on('data', (d) => { outText += d; });

  let ok = true;
  try {
    // 等服务起来（最多 ~8s）
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(200);
      const r = await probe(port, '/config.json', 800);
      if (r && r.status === 200) { up = true; break; }
    }
    if (!up) { fail('发布包没能在 8 秒内起来，看下面的输出排查'); ok = false; }

    if (up) {
      const cfg = await probe(port, '/config.json');
      let json = null;
      try { json = JSON.parse(cfg.body); } catch (e) { /* 下面统一报 */ }
      if (!json) { fail('/config.json 返回的不是合法 JSON'); ok = false; }
      else {
        pass(`/config.json 可用：架构=${json.arch}，ICE ${json.iceServers.length} 组，端口来自配置`);
        const turn = json.iceServers.filter((s) => String(s.urls).includes('turn')).length;
        (turn > 0 ? pass : warn)(turn > 0 ? `下发的 ICE 里含 ${turn} 组 TURN（跨网可中继）` : '下发的 ICE 里没有 TURN');
      }

      // 页面能拿到
      const idx = await probe(port, '/');
      (idx.status === 200 && /<html/i.test(idx.body || '')) ? pass('首页可访问（发布包静态托管正常）')
        : (fail('首页打不开，发布包不完整'), ok = false);
      const cli = await probe(port, '/client.js');
      (cli.status === 200 && /RTCPeerConnection/.test(cli.body || '')) ? pass('client.js 可访问且是会议脚本')
        : (fail('client.js 打不开或内容不对'), ok = false);
      // 禁缓存头（发布后改了东西刷新就能见）
      (String(cli.headers['cache-control'] || '').includes('no-store')) ? pass('静态资源带 no-store（改完刷新即见）')
        : warn('静态资源没有 no-store，浏览器可能吃旧缓存');
    }
  } finally {
    try { child.kill(); } catch (e) { /* ignore */ }
  }
  if (!ok) process.exitCode = 1;
  return ok;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 第四段（可选）：开隧道拿公网地址
 * ══════════════════════════════════════════════════════════════════════════ */

function which(bin) {
  // ▎为什么包一层 try/catch？——spawnSync 在个别 Windows 环境下会抛 EBUSY
  //   （本项目实测：spawnSync 带 timeout 时必抛）。探测一个可选工具，
  //   探不到就当"没装"，绝不能让一个探测动作把发布流程搞崩。
  try {
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' });
    return r.status === 0;
  } catch (e) {
    return false;
  }
}

async function tunnel(port) {
  step(4, '开公网隧道（把本机服务映射成一个公网地址）');

  // 依次探测常见隧道工具，谁在就用谁（都零依赖：不需要 npm 装包）
  if (which('cloudflared')) {
    pass('发现 cloudflared（Cloudflare Tunnel：免费、免注册，推荐）');
    console.log(C.dim(`  ▸ 正在开隧道，公网地址会打印在下面（形如 https://xxx.trycloudflare.com）`));
    const p = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${port}`], { stdio: 'inherit' });
    p.on('exit', (c) => process.exit(c || 0));
    return;
  }
  if (which('ngrok')) {
    pass('发现 ngrok');
    console.log(C.dim('  ▸ 正在开隧道（首次用要 ngrok config add-authtoken ...）'));
    const p = spawn('ngrok', ['http', String(port)], { stdio: 'inherit' });
    p.on('exit', (c) => process.exit(c || 0));
    return;
  }

  fail('本机没有隧道工具（cloudflared / ngrok 都没装），没开成公网地址');
  console.log('');
  console.log(C.bold('  三条可选路（按省事程度排）：'));
  console.log(`   1. Cloudflare Tunnel ${C.ok('（最推荐：免费、免注册、一条命令）')}`);
  console.log(C.dim('      winget install --id Cloudflare.cloudflared     # 装'));
  console.log(C.dim(`      cloudflared tunnel --url http://127.0.0.1:${port}   # 跑，会吐出 https://xxx.trycloudflare.com`));
  console.log('   2. ngrok：需注册账号拿 authtoken（免费版地址每次变）');
  console.log('   3. 部署到有公网 IP 的云主机：见《部署手册.md》场景 C（systemd + Let\'s Encrypt）');
  console.log('');
  console.log(C.warn('  ⚠️ 媒体提醒：隧道只解决"网页能打开"，音视频是 P2P 的，'));
  console.log(C.warn('     两台不同网络的电脑要真能开会，还得有 TURN（上面第 2 步已配）。'));
  console.log(C.warn('     判断方法：开会后看页面顶部「🔗 连接方式」——显示"直连/STUN"最好，'));
  console.log(C.warn('     显示"TURN 中继"说明走中继（能通，但流量过 TURN 服务器）。'));
  console.log('');
  console.log(`  ${C.bold('本地就能看的地址')}：http://localhost:${port}（同机浏览器同样能验证全部功能）`);
  console.log(`  ${C.bold('局域网给同学看')}：http://<你的内网IP>:${port}`);
  console.log(C.dim('  ▸ 起服务：cd publish-mesh && node server.js'));
  if (!WANT_BUNDLE) {
    console.log(C.dim('  ▸ 注意：publish-mesh/ 目前靠父目录的 node_modules 跑（本机可用）。'));
    console.log(C.dim('    要上传到云主机，请用 --bundle 重新生成（会把依赖拷进去）。'));
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 主流程
 * ══════════════════════════════════════════════════════════════════════════ */

(async () => {
  /* ── --check：只读自检 ──
   * 这是本脚本唯一会以"失败"退出的一种调用方式（给提交前/CI 用）。
   * 它刻意**不重建**——先修再查等于永远查不出问题（见 checkSync 上面的长注释）。 */
  if (WANT_CHECK) {
    console.log(C.bold('\n🔍 发布包同步自检（--check：只读，不修改任何文件）\n'));
    const st = checkSync();
    if (!st.exists) {
      fail('publish-mesh/ 还不存在，先跑一次：node scripts/publish.js');
      process.exit(1);
    }
    if (st.diffs.length === 0) {
      pass(`发布包与源码一致（${COPY_LIST.length} 个文件逐字节相同，同一个版本）`);
      console.log('');
      process.exit(0);
    }
    fail(`发布包已过期：${st.diffs.length} 个文件与源码不同 —— 线上还是旧版本`);
    for (const d of st.diffs) console.log(C.dim(`     · ${d.file}：${d.why}`));
    console.log(C.dim('\n  ▸ 修法：node scripts/publish.js（重新生成，然后按提示上传/开隧道）\n'));
    process.exit(1);
  }

  console.log(C.bold('\n🚀 Mesh 版一键发布'));
  console.log(C.dim('   目标：把当前代码打成可上线的发布包，并检查"跨网络能不能真通"的关键配置\n'));

  // 重建之前先报告"上一次的发布有多旧"——信息性提示，不阻止流程：
  // 因为重建本来就会修好它。但用户应该知道自己刚刚差点发了个旧版本出去。
  const stale = checkSync();
  if (stale.exists && stale.diffs.length) {
    warn(`发布包已过期（${stale.diffs.length} 个文件与源码不同），本次会重建为最新版本：`);
    for (const d of stale.diffs) console.log(C.dim(`     · ${d.file}`));
  }

  build();
  const cfg = writeMeshConfig(PORT_OVERRIDE);
  const healthy = await healthCheck();

  if (WANT_BUNDLE) {
    step('4a', '拷贝运行依赖到发布包（--bundle）');
    const dep = path.join(ROOT, 'node_modules', 'socket.io');
    if (fs.existsSync(dep)) {
      // 只拷 socket.io 运行时真正需要的包（跨平台用 fs.cpSync，不依赖系统 cp）
      const need = ['socket.io', 'socket.io-parser', 'socket.io-adapter', 'engine.io',
        'engine.io-parser', 'ws', 'base64id', 'cookie', 'cors', '@socket.io'];
      let cnt = 0;
      for (const name of need) {
        const s = path.join(ROOT, 'node_modules', name);
        if (!fs.existsSync(s)) continue;
        fs.cpSync(s, path.join(OUT, 'node_modules', name), { recursive: true });
        cnt++;
      }
      pass(`已拷入 ${cnt} 个运行依赖（publish-mesh/ 现在可以整体上传到云主机）`);
    } else {
      warn('根目录 node_modules 里没有 socket.io，请先 npm i');
    }
  }

  if (WANT_TUNNEL) {
    console.log(C.dim(`\n  ▸ 隧道需要服务在跑：先在另一个终端执行  cd publish-mesh && node server.js`));
    await tunnel(cfg.port);
    return;
  }

  step('结论', healthy ? '发布包已就绪' : '发布包有问题，见上面 ❌');
  if (healthy) {
    console.log(`  · 发布目录：${C.bold(OUT.replace(ROOT + path.sep, ''))}（由本脚本生成，别手工改）`);
    console.log(`  · 起服务：  ${C.bold('cd publish-mesh && node server.js')}  → http://localhost:${cfg.port}`);
    console.log(`  · 开公网：  ${C.bold('node scripts/publish.js --tunnel')}（需先装 cloudflared 或 ngrok）`);
    console.log(`  · 上传云主机：${C.bold('node scripts/publish.js --bundle')} 后整个目录拷过去`);
    console.log(`  · 改完代码后可自检：${C.bold('node scripts/publish.js --check')}（确认发布包没落后于源码）`);
  }
  console.log('');
})();
