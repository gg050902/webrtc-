/* ════════════════════════════════════════════════════════════════════════════
 * scripts/test-publish.js —— 一键发布（scripts/publish.js）的自动化测试
 *
 * ▎这套测试的取舍，值得先讲清楚：
 *   只测"顺利路径"的测试是廉价的——它只证明代码在最好的情况下不崩。
 *   发布这件事真正会出事的地方是**闸门失灵**：
 *     · 副本漂移了，脚本却没发现（照样把旧代码发上线）；
 *     · 配置写错了，脚本却说"就绪"。
 *   所以本文件里一半的断言是**负向**的：
 *     故意改坏发布包 → 断言脚本必须报错退出（非 0）。
 *   只有"改坏了它真会拦"被验证过，"它说 OK"才有意义。
 *
 * ▎不启浏览器的原因：发布流程的正确性全在"文件 + HTTP 响应"这一层，
 *   浏览器帮不上忙（真实浏览器验证留给 scripts/test-agent.js 与 E2E 脚本）。
 *   能用一条 HTTP 请求说清的事，不拉一个浏览器来。
 * ════════════════════════════════════════════════════════════════════════════ */

'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'publish-mesh');
const NODE = process.execPath;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (cond, title, extra) => {
  if (cond) { pass++; console.log(`  PASS  ${title}`); }
  else { fail++; console.log(`  FAIL  ${title}${extra ? '  ← ' + extra : ''}`); }
};

/* 跑一次 publish.js，返回 { code, out, note }
 *
 * ▎为什么不用 spawnSync？——踩过：
 *   spawnSync 配 timeout 在本机（Windows + 本环境的文件代理层）会**直接 EBUSY**
 *   返回 status=null，3 毫秒就"失败"，看起来像超时其实根本没启动。
 *   更毒的是它会污染断言：`code !== 0` 对 null 成立，于是"必须报错"这类
 *   负向断言会**因为工具没跑起来而白捡一个通过**（假通过）。
 *   → 改成异步 spawn + 自己计时；并且断言一律要求**精确退出码**，
 *     null 一律算测试设施故障，不算业务结论。 */
function runPublish(args = [], timeoutMs = 60000) {
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const finish = (code, note) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, out, note: note || null });
    };
    let child;
    try {
      child = spawn(NODE, [path.join(ROOT, 'scripts', 'publish.js'), ...args], {
        cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      return finish(null, 'spawn 抛异常：' + e.message);
    }
    const timer = setTimeout(() => { try { child.kill(); } catch (e) {} finish(null, `超过 ${timeoutMs}ms 未结束`); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', (e) => finish(null, 'spawn 错误：' + e.message));
    child.on('close', (code, sig) => finish(code, sig ? `被信号 ${sig} 结束` : null));
  });
}

function probe(port, pathname, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = require('http').get({ host: '127.0.0.1', port, path: pathname, timeout: timeoutMs }, (res) => {
      let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
  });
}

(async () => {
  console.log('\n--- 一键发布（publish.js）---\n');

  /* ── ① 首次构建：应该成功，且产物齐全 ─────────────────────────── */
  const r1 = await runPublish();
  ok(r1.code === 0, '发布脚本跑通（退出码 0）', r1.note || ('实际退出码 ' + r1.code));
  ok(fs.existsSync(path.join(OUT, 'server.js')), '发布包含 server.js');
  ok(fs.existsSync(path.join(OUT, 'public', 'client.js')), '发布包含 public/client.js');
  ok(fs.existsSync(path.join(OUT, 'mesh.config.json')), '发布包含 mesh.config.json（ICE 配置入口）');
  ok(fs.existsSync(path.join(OUT, 'package.json')), '发布包含 package.json（云端能 npm start）');

  // 副本漂移闸：逐字节比对
  const same = (rel) => Buffer.compare(
    fs.readFileSync(path.join(ROOT, rel)),
    fs.readFileSync(path.join(OUT, rel)),
  ) === 0;
  ok(same('public/client.js') && same('public/style.css') && same('server.js'),
    '发布包与源文件逐字节一致（副本没漂移）');

  /* ── ② 配置正确性：ICE 必须真的含 TURN ───────────────────────── */
  const cfg = JSON.parse(fs.readFileSync(path.join(OUT, 'mesh.config.json'), 'utf8'));
  ok(Number.isInteger(cfg.port) && cfg.port > 0, '配置里有合法端口', JSON.stringify(cfg.port));
  ok(Array.isArray(cfg.iceServers) && cfg.iceServers.length >= 1, '配置里有 ICE 列表');
  const turnCount = (cfg.iceServers || []).filter((s) => String(s.urls).includes('turn')).length;
  ok(turnCount > 0, '默认 ICE 含 TURN（跨网络严格 NAT 能退回中继）', `实际 TURN ${turnCount} 条`);
  const turnWithCred = (cfg.iceServers || []).some((s) => String(s.urls).includes('turn') && s.username && s.credential);
  ok(turnWithCred, 'TURN 项带 username/credential（没有凭证的 TURN 一定连不通）');

  /* ── ③ 服务端真的把配置下发出来了吗（起真进程 + 真 HTTP） ────── */
  const port = 18123;
  const child = spawn(NODE, ['server.js'], {
    cwd: OUT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let bootLog = '';
  child.stdout.on('data', (d) => { bootLog += d; });
  try {
    let up = false;
    for (let i = 0; i < 40; i++) { await sleep(200); const p = await probe(port, '/config.json', 700); if (p.status === 200) { up = true; break; } }
    ok(up, '发布包能用环境变量 PORT 起在指定端口（云端部署要靠这个）');

    const j = await probe(port, '/config.json');
    const json = (() => { try { return JSON.parse(j.body); } catch (e) { return null; } })();
    ok(!!json && json.arch === 'mesh', '/config.json 下发的架构标记正确');
    ok(!!json && Array.isArray(json.iceServers) && json.iceServers.length === cfg.iceServers.length,
      '/config.json 下发的 ICE 与配置文件一致（配置真的生效，不是写死的）');
    ok(!!json && json.iceServers.some((s) => String(s.urls).includes('turn')),
      '下发给浏览器的 ICE 里含 TURN（前端不再硬编码）');
    ok(String(j.headers['cache-control'] || '').includes('no-store'),
      '/config.json 带 no-store（改了 TURN 配置刷新就生效，不吃旧缓存）');

    const idx = await probe(port, '/');
    ok(idx.status === 200 && /<html/i.test(idx.body), '发布包首页可访问');
    const cli = await probe(port, '/client.js');
    ok(cli.status === 200 && /RTCPeerConnection/.test(cli.body), '发布包 client.js 是会议脚本');
    ok(!/iceServers:\s*\[\s*\{\s*urls:\s*'stun:stun\.l\.google\.com/.test(cli.body),
      'client.js 里的 ICE 已改为配置下发（不再硬编码单一 STUN）');
    ok(/iceReady/.test(cli.body) && /fetch\('config\.json'/.test(cli.body),
      'client.js 启动时会去取 /config.json，且建连前会 await（避免第一条连错）');
  } finally {
    try { child.kill(); } catch (e) {}
  }

  /* ── ④ 负向测试：自检闸门必须真的会拦 ───────────────────────── */
  // 这是本文件最重要的一组断言。
  // ▎注意测的是什么：不是"改坏发布包"（发布包每次都会被重建，改了也无所谓），
  //   而是**源码改了、却没重新发布**——这才是线上发旧版的真实成因。
  //   所以手法是：改源码 → --check 必须报"不同步"并非 0 退出 → 恢复 → 必须通过。
  //
  // ▎我第一版这个测试是错的，值得记下来：
  //   当时我改的是发布包、断言的是 build() 末尾那段比对，结果它**永远通过**——
  //   因为 build() 先删重建，比对时文件必然一致。而那条断言用的正则
  //   /不一致|漂移/ 又恰好匹配到了成功信息里的"没有漂移"，于是它"通过"得很自然。
  //   教训：① 自检不能先修复再检查；② 负向断言的正则必须收紧、最好带上下文。
  const rootClient = path.join(ROOT, 'public', 'client.js');
  const rootBackup = fs.readFileSync(rootClient);
  try {
    fs.appendFileSync(rootClient, '\n// 模拟"改了源码但忘了重新发布"\n');
    const r2 = await runPublish(['--check']);
    // ★ 精确要 1，不要 `!== 0`：null（工具没跑起来/被信号杀掉）也会满足 !==0，
    //   那样这条断言就变成"因为脚本崩了所以通过"——正是要防的假通过。
    ok(r2.code === 1, '★ 源码改动后 --check 必须报错退出（过期闸真的会拦）', r2.note || `实际退出码 ${r2.code}`);
    ok(/已过期/.test(r2.out) && /client\.js/.test(r2.out),
      '★ 报错说清"过期"并点名是哪个文件（不是静默失败）', r2.out.slice(-260));
    ok(!/已复制/.test(r2.out), '★ --check 是只读的：不重建、不改任何文件（先修再查就永远查不出问题）');

    fs.writeFileSync(rootClient, rootBackup);   // 恢复源码
    const r3 = await runPublish(['--check']);
    ok(r3.code === 0, '源码恢复后 --check 通过（闸门不是"一律报错"的假警报）', r3.note || `实际退出码 ${r3.code}`);
  } finally {
    if (Buffer.compare(fs.readFileSync(rootClient), rootBackup) !== 0) fs.writeFileSync(rootClient, rootBackup);
  }

  /* ── ⑤ 根目录 mesh.config.json 应被沿用（用户配自己的 TURN） ── */
  const rootCfg = path.join(ROOT, 'mesh.config.json');
  // ★ 自愈式清理：本测试会往根目录写一份临时 mesh.config.json，跑完必须删掉。
  //   但如果**上一次跑到一半被打断**（崩溃/被 Ctrl+C），这份文件会赖着不走；
  //   下一次跑时 hadCfg 就成了 true，于是"备份→恢复"把它当用户配置又还原回去，
  //   永久污染工作区（实测踩过：它让服务器起在 18099，把另一个测试搞挂）。
  //   解法：给自己写的文件打标记 `_test: true`。见到标记 = 这是我自己的残留，
  //   不是用户配置 → 直接覆盖、跑完删掉，不进"备份恢复"流程。
  const readRootCfg = () => {
    try { return JSON.parse(fs.readFileSync(rootCfg, 'utf8')); } catch (e) { return null; }
  };
  const pre = fs.existsSync(rootCfg) ? readRootCfg() : null;
  const isOurLeftover = !!(pre && pre._test === true);
  if (isOurLeftover) {
    console.log('  ▸ 发现上一次跑留下的临时 mesh.config.json（带 _test 标记），直接覆盖清理');
  }
  const hadCfg = fs.existsSync(rootCfg) && !isOurLeftover;
  const oldCfg = hadCfg ? fs.readFileSync(rootCfg) : null;
  try {
    fs.writeFileSync(rootCfg, JSON.stringify({
      _test: true,   // ← 自愈标记：看到它就知道"这是我自己的残留，别当用户配置恢复"
      port: 18099,
      iceServers: [{ urls: 'turn:my.turn.example:3478', username: 'u', credential: 'p' }],
      publicUrl: 'https://demo.example',
    }, null, 2));
    const r5 = await runPublish();
    // ★ 先确认"这次发布真的成功了"，再去读它生成的文件。
    //   否则一旦发布没跑起来，读到的就是**上一次留下的旧文件**——
    //   旧文件恰好满足断言，于是测试通过（这是本项目第三次遇到同款假通过了）。
    ok(r5.code === 0, '有自定义 mesh.config.json 时发布依然成功', r5.note || `实际退出码 ${r5.code}`);
    if (r5.code === 0) {
      const outCfg = JSON.parse(fs.readFileSync(path.join(OUT, 'mesh.config.json'), 'utf8'));
      ok(outCfg.port === 18099, '自定义端口被沿用', `实际 ${outCfg.port}`);
      ok(outCfg.iceServers.length === 1 && String(outCfg.iceServers[0].urls).includes('my.turn.example'),
        '自定义 TURN 被沿用（用户自己的 coturn 能生效，没被默认值覆盖）');
      ok(outCfg.publicUrl === 'https://demo.example', '公网地址被带进发布配置');
    } else {
      ok(false, '自定义端口被沿用', '上一步发布没成功，跳过（不给假通过）');
      ok(false, '自定义 TURN 被沿用', '同上');
      ok(false, '公网地址被带进发布配置', '同上');
    }
    // --port 参数应压过配置文件
    const r6 = await runPublish(['--port', '18777']);
    ok(r6.code === 0, '带 --port 参数时发布成功', r6.note || `实际退出码 ${r6.code}`);
    if (r6.code === 0) {
      const outCfg2 = JSON.parse(fs.readFileSync(path.join(OUT, 'mesh.config.json'), 'utf8'));
      ok(outCfg2.port === 18777, '命令行 --port 优先级高于配置文件', `实际 ${outCfg2.port}`);
    } else {
      ok(false, '命令行 --port 优先级高于配置文件', '上一步发布没成功，跳过（不给假通过）');
    }
  } finally {
    try {
      if (hadCfg) fs.writeFileSync(rootCfg, oldCfg);
      else if (fs.existsSync(rootCfg)) fs.unlinkSync(rootCfg);
    } catch (e) { /* 清理失败不能盖过测试结论，但要说一声 */ console.log('  ⚠️ 清理根目录 mesh.config.json 失败：' + e.message); }
    await runPublish(); // 恢复成默认配置的发布包，别把工作区留在临时配置上
    // ★ 最后自证一次：临时配置真的没了（否则下一个测试会莫名其妙地挂）
    ok(!fs.existsSync(rootCfg) || !!(readRootCfg() || {}).iceServers,
      '测试没在工作区留下临时 mesh.config.json（不留垃圾给下一个测试）',
      fs.existsSync(rootCfg) ? '根目录仍有 mesh.config.json' : '');
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('❌ 测试自身异常：', e && e.stack || e);
  process.exit(1);
});
