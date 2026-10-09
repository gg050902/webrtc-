#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 *  check-all.js —— 一条命令跑完全部真浏览器界面检查（npm run check:all）
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎为什么要这个包装：现在有 13 条 check:*，每条都要先起服务器、再开一个无头浏览器。
 *   "九条命令没人会逐个跑"是本轮真实遇到的——写完检查不等于会被跑，
 *   不被跑的检查等于没有（坑 76 那条纪律的另一半：机制存在 ≠ 机制生效）。
 * ▎三条纪律写在这里：
 *   ① **自起服务、自占端口**（3021），绝不复用开发者正在用的 3001（坑 57/58 家族，
 *      用户已经明确说过"测试的时候不要退出 agent 啊"）；端口被占就明确拒绝，
 *      宁可红得清楚，不要绿得可疑。
 *   ② **临时库**（DB_FILE 指到 tmp），账号与审计永不落进真实 sfu/data/meeting.db。
 *   ③ **错峰**：本机的显存是多实例的天花板（坑 76 实测过三台并发直接 OOM，
 *      于是本地 Qwen 静默回落 CPU、整条语音链路淹死）。界面检查不需要耳朵，
 *      所以统一 ASR_QWEN_LOCAL=0；顺带 SFU_NO_HTTPS=1，少一次自签证书生成。
 * ▎spawn 参数全字面量（只有端口/路径这类动态配置走环境变量）——安全扫描对
 *   "把配置拼进 argv"的写法会报警，而这条项目里已经立过（soak.js 同形态）。
 * ▎跑法：npm run check:all        全跑
 *         npm run check:all -- pill dock   只跑名字里含这些关键词的
 *         CHECK_KEEP_SERVER=1 npm run check:all   跑完不关服务器（调试用） */
const path = require('path');
const net = require('net');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.CHECK_ALL_PORT) || 3021;
const CHECK_URL = `http://localhost:${PORT}/`;
/* 清单是字面量（不进 argv 的动态部分只有 env）。
   下面有一条"清单漂移"自检：package.json 里新增了 check:* 而这里没登记，会当场报出来。 */
const CHECKS = [
  { key: 'toggle', file: 'check-toggle-motion.js', label: '开关动效' },
  { key: 'think', file: 'check-thought-line.js', label: 'AI 思考线' },
  { key: 'glow', file: 'check-glow-trail.js', label: '光晕拖尾' },
  { key: 'pill', file: 'check-pill-rise.js', label: '拱形升起' },
  { key: 'visual', file: 'check-visual-pass.js', label: '整体观感' },
  { key: 'icons', file: 'check-icon-sweep.js', label: '图标清扫' },
  { key: 'dock', file: 'check-dock-fit.js', label: '控制坞适配' },
  { key: 'layers', file: 'check-layer-cover.js', label: '浮层遮挡' },
  { key: 'login', file: 'check-login-screen.js', label: '首屏登录卡' },
  { key: 'keyboard', file: 'check-keyboard.js', label: '键盘可操作' },
  { key: 'a11y', file: 'check-a11y.js', label: '无障碍' },
  { key: 'board', file: 'check-board.js', label: '白板' },
  { key: 'console', file: 'check-console.js', label: '控制台异常' },
  { key: 'avatar', file: 'check-ai-avatar.js', label: 'AI 头像动效' },
  { key: 'screenshare', file: 'check-screenshare.js', label: '共享比例/大画面适配' },
  { key: 'wake', file: 'check-wake-scope.js', label: '不叫名字不开口（两条链路一致）' },
  { key: 'caption', file: 'check-caption-line.js', label: '整句字幕显示不越线' },
  { key: 'theme', file: 'check-theme.js', label: '明暗双主题与对比度' },
  { key: 'invite', file: 'check-invite.js', label: '邀请面板与跨网自检' },
  { key: 'files', file: 'check-files.js', label: '共享文件与跟随主讲' },
  { key: 'golden', file: 'check-golden.js', label: '真人语音金标准录制链路' },
];

const ok = (name, pass, extra) => console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portFree(p) {
  return new Promise((resolve) => {
    const s = net.connect(p, '127.0.0.1');
    s.once('connect', () => { s.destroy(); resolve(false); });
    s.once('error', () => resolve(true));
    s.setTimeout(1200, () => { s.destroy(); resolve(true); });
  });
}

function get(url) {
  return new Promise((resolve) => {
    require('http').get(url, (res) => { res.resume(); resolve(res.statusCode); })
      .on('error', () => resolve(0));
  });
}

async function main() {
  const filter = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  /* 关键词匹配按"键名全等/前缀"或"中文名包含"——不按"键名包含"，
     否则 `board` 会把 `keyboard` 也拖进来跑（本机 10-04 真的这么误跑了一条）。 */
  const list = filter.length
    ? CHECKS.filter((c) => filter.some((f) => c.key === f || c.key.startsWith(f) || c.label.includes(f)))
    : CHECKS;

  /* ── 前提自检：端口与清单 ────────────────────────────────────────────
     ①端口：这一条不是客套。上一轮 check-glow-trail 真实踩过"3001 已停，页面照样出
       登录卡"——服务没起来时检查会连到别的实例或拿到缓存壳子，绿得可疑。
     ②清单：package.json 是唯一的真来源。漏登记的那条检查永远不会被跑到，
       而"没跑到"不会有任何人看见（坑 47：一个概念只能有一个来源）。 */
  if (!(await portFree(PORT))) {
    console.error(`❌ 端口 ${PORT} 已被占用——检查们必须跑在自己起的服务器上（不是你的 3001）。`);
    console.error(`   换端口：CHECK_ALL_PORT=3022 npm run check:all`);
    process.exit(1);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const declared = Object.keys(pkg.scripts).filter((k) => k.startsWith('check:') && k !== 'check:all')
    .map((k) => k.slice(6));
  const missing = declared.filter((k) => !CHECKS.some((c) => c.key === k));
  const ghost = CHECKS.filter((c) => !declared.includes(c.key)).map((c) => c.key);
  /* 重复登记：上面那条"一一对应"查不出它 —— 它比的是"有没有"（some / includes），
   *   同一个 key 出现两次仍然两边都对。后果不是坏，是**贵 + 说谎**：
   *   那条检查跑两遍（每次约 5s），而汇总行的"共 N 项界面断言"把它的断言数**加了两遍**
   *   （2026-10-07 实测：check:invite 双份，312 项里有 8 项是重复计数）。
   *   判据：清单类断言除了"有没有漏"，还要问"有没有多"。 */
  const dupKeys = CHECKS.map((c) => c.key).filter((k, i, a) => a.indexOf(k) !== i);
  ok('check:all 清单与 package.json 的 check:* 一一对应（新增检查漏登记会当场报）',
    missing.length === 0 && ghost.length === 0 && dupKeys.length === 0,
    missing.length ? `未登记: ${missing.join(',')}`
      : ghost.length ? `清单里有但脚本没有: ${ghost.join(',')}`
      : dupKeys.length ? `重复登记: ${dupKeys.join(',')}` : '');
  if (missing.length || ghost.length) console.log('   ▸ 漂移不会让任何功能变红，只会让某条检查从此没人跑。');
  if (dupKeys.length) console.log('   ▸ 重复登记不会让任何功能变红，只会白跑一遍并把断言总数虚报。');

  const dbFile = path.join(os.tmpdir(), `check-all-${PORT}.db`);
  try { fs.rmSync(dbFile, { force: true }); fs.rmSync(dbFile + '-wal', { force: true }); fs.rmSync(dbFile + '-shm', { force: true }); } catch (e) { /* 清不掉也不致命 */ }
  /* ★ 2026-10-08 共享文件（第 51 步）带来的新隔离面：**上传的字节也是持久化存储**。
   *   临时库只挡住了 `sfu/data/meeting.db`，而 check:files 会往 `sfu/files/<房间>/` 落真文件——
   *   和"账号类测试必须指到临时目录"是同一条纪律（坑 72：被测代码会往持久化存储追加的测试，
   *   都要问一句"上一次运行留下的东西会不会被当成这一轮的产出"，何况这次留下的是**真实目录**）。 */
  const filesDir = path.join(os.tmpdir(), `check-all-files-${PORT}`);
  try { fs.rmSync(filesDir, { recursive: true, force: true }); } catch (e) { /* 同上 */ }

  console.log(`\n🚦 起专用服务器（端口 ${PORT}、临时库、临时共享文件目录、不启 HTTPS、本地 Qwen 耳朵关掉以免占显存）…`);
  const server = spawn(process.execPath, [path.join('sfu', 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      SFU_NO_HTTPS: '1',
      DB_FILE: dbFile,
      FILES_DIR: filesDir,
      ASR_QWEN_LOCAL: '0',
      // 保险丝：万一这个包装被 Ctrl+Z/杀掉而没走到收尾，服务器也不该永远占着端口
      TEST_SHUTDOWN_AFTER_MS: String(60 * 60 * 1000),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const serverLog = [];
  server.stdout.on('data', (d) => serverLog.push(String(d)));
  server.stderr.on('data', (d) => serverLog.push(String(d)));
  const stopServer = () => { try { server.kill(); } catch (e) { /* 已经退了 */ } };
  process.on('SIGINT', () => { stopServer(); process.exit(130); });

  let up = false;
  for (let i = 0; i < 120; i++) {
    if (server.kill && server.exitCode !== null) break;
    if ((await get(`${CHECK_URL}config.json`)) === 200) { up = true; break; }
    await sleep(500);
  }
  if (!up) {
    console.error(`❌ 服务器没起来（退出码 ${server.exitCode}）。启动输出如下：`);
    console.error(serverLog.join('').split('\n').slice(-14).join('\n'));
    process.exit(1);
  }
  console.log(`✅ 服务器就绪：${CHECK_URL}\n`);

  const rows = [];
  for (const [idx, c] of list.entries()) {
    const file = path.join(ROOT, 'scripts', c.file);
    const t0 = Date.now();
    const r = await new Promise((resolve) => {
      /* WB_CDP_PORT：每条检查一个专属调试端口（agent/cdp.js 现在认这个环境变量）。
         原先 13 条都用默认 9333 + 同一个 profile 目录，串起来跑就会撞车——
         check:pill 在全量跑里 5 条 hover 断言全 0.00、单独跑 22/22 全过，就是这个原因
         （前一台刚 kill，后一台拿到"半死的靶子"或直接连上没退干净的实例）。
         profile 目录按端口派生，所以这一步顺带把 Service Worker / 缓存也隔开了（坑 40）。 */
      const p = spawn(process.execPath, [file], {
        cwd: ROOT, env: { ...process.env, CHECK_URL, WB_CDP_PORT: String(9400 + idx) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      p.stdout.on('data', (d) => { out += String(d); });
      p.stderr.on('data', (d) => { out += String(d); });
      p.on('exit', (code) => resolve({ code, out }));
    });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const passed = (r.out.match(/^\s*PASS/gm) || []).length;
    const failed = (r.out.match(/^\s*FAIL/gm) || []).length;
    rows.push({ key: c.key, label: c.label, ok: r.code === 0 && failed === 0, passed, failed, secs });
    console.log(`── check:${c.key}（${c.label}）${r.code === 0 && failed === 0 ? '✅' : '❌'} ${passed} 通过 / ${failed} 失败 · ${secs}s`);
    const failLines = r.out.split('\n').filter((l) => /^\s*FAIL/.test(l));
    failLines.slice(0, 6).forEach((l) => console.log('   ' + l.trim()));
    if (r.code !== 0 && failed === 0) {
      // 退出码非 0 但没有任何 FAIL 行 = 脚本自己炸了（不是界面缺陷），这种情况要单独说清
      console.log('   ▸ 检查脚本异常退出（退出码 ' + r.code + '），下面末尾 6 行是原因：');
      r.out.split('\n').filter(Boolean).slice(-6).forEach((l) => console.log('     ' + l));
    }
  }

  if (process.env.CHECK_KEEP_SERVER !== '1') stopServer();
  else console.log(`\n📌 CHECK_KEEP_SERVER=1：服务器继续开着 ${CHECK_URL}`);

  const bad = rows.filter((r) => !r.ok);
  console.log('\n══════════ 界面检查总览 ══════════');
  rows.forEach((r) => console.log(`  ${r.ok ? '✅' : '❌'}  check:${r.key.padEnd(8)} ${r.label.padEnd(7)} ${String(r.passed).padStart(3)} 通过 / ${r.failed} 失败  ${r.secs}s`));
  console.log(`\n结果: ${rows.length - bad.length}/${rows.length} 条检查通过`
    + `（共 ${rows.reduce((a, r) => a + r.passed, 0)} 项界面断言）`);
  if (bad.length) {
    console.log('   单独复跑：' + bad.map((r) => `npm run check:${r.key}`).join('   '));
    console.log('   带服务器地址：CHECK_URL=' + CHECK_URL + ' npm run check:xxx');
  }
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => { console.error('❌ 包装自己出错了：', e); process.exit(1); });
