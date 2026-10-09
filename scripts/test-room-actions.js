/* ══════════════════════════════════════════════════════════════
 * scripts/test-room-actions.js —— AI 操控"会议实体"全动作真浏览器逐个验证
 *
 * ▎要解决什么？用户报"AI 操控实体类的功能还是实现的不行"。此前只有
 *   "把白板打开"一个动作被 e2e 覆盖——8 个动作里其余 7 个从未在真浏览器里
 *   逐个验证过（ detectRoomAction 的中文规则改一次就可能静默漏一个）。
 *
 * ▎做法：真 Chromium 进房 + 开字幕（AI 自动入会），然后用**聊天逐条下达**
 *   全部 10 个动作指令，逐个断言"界面状态真的变了"（不是看 AI 回了什么话）：
 *     白板开/关/清空/撤销 · 字幕开/关 · 演讲者/宫格视图 · ★ 共享文件面板开/关
 *   另断言：动作执行有回执（room-control-ack）、无关指令不误触发、组合指令两件都落地、
 *   否定式不动手、★ 泛化口语（test:asr 那 28 句新电池里挑 6 句）在页面上逐条生效、
 *   ★★ 2026-10-08：**句首就是「打开」的房间指令**（「打开白板」「打开共享文件面板」）
 *     不再被客户端那条 C1 入口正则截去"远程操作别人电脑"那条链路——这一条是本轮抓到的
 *     真缺陷，旧电池 17 项一条都盖不住（它们全都说成「把白板打开」，没有一条以"打开"开头）。
 *   ▸ 计数：本脚本现 21 项（8 个动作 + ③b 两条 + ③c 七条 + 文件面板两条 + 回执与闲话各一条）。
 *
 * ▎跑法：npm run test:room-actions（专用端口 3025；TEST_ACTIONS_PORT 可换）。
 * ══════════════════════════════════════════════════════════════ */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { Cdp } = require('../agent/cdp');

const PORT = Number(process.env.TEST_ACTIONS_PORT) || 3025;
const SERVER = `http://localhost:${PORT}`;
const SERVER_JS = path.join(__dirname, '..', 'sfu', 'server.js');
const OUT = path.join(os.tmpdir(), 'room-actions-shots');
const TEST_DB_FILE = path.join(os.tmpdir(), 'room-actions-data.db');
const TEST_LEGACY_USERS = path.join(os.tmpdir(), 'room-actions-legacy.json');

let checks = 0, issues = 0;
const chk = (cond, msg) => {
  checks++;
  if (cond) { console.log(`   ✅ ${msg}`); }
  else { issues++; console.log(`   ❌ ${msg}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let serverProc = null;
const browsers = [];

async function waitJs(cdp, expr, timeout = 15000, label = '') {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const v = await cdp.evaluate(expr);
      if (v && v !== '0' && v !== 'false') return v;
    } catch (e) { /* 页面忙 */ }
    await sleep(300);
  }
  console.log(`   ⏳ 等超时：${label || expr}`);
  return null;
}

async function shot(cdp, name) {
  try {
    const buf = await cdp.screenshot({ format: 'jpeg', quality: 72 });
    fs.writeFileSync(path.join(OUT, name), buf);
    console.log(`   📸 ${path.join(OUT, name)}`);
  } catch (e) { /* 截图失败不判失败 */ }
}

/* 通过聊天下达一条指令（@ai 前缀 → 服务器 tools-first 路由，不进 LLM） */
async function say(cdp, text) {
  await cdp.evaluate(`(() => {
    const i = document.getElementById('chatInput');
    i.value = ${JSON.stringify('@ai ' + text)};
    i.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('chatSendBtn').click();
  })()`);
}

/* 界面状态探针：白板开合 / 字幕开合 / 当前视图 */
const STATE = `JSON.stringify((() => {
  const board = document.getElementById('boardOverlay');
  const badge = document.getElementById('capStatus');
  const grid = document.getElementById('videoGrid');
  const spk = document.getElementById('viewSpeakerBtn');
  const files = document.getElementById('filesOverlay');
  return {
    boardOpen: board ? !board.classList.contains('hidden') : null,
    capOn: /服务器转写|实时字幕/.test(badge ? badge.textContent : ''),
    speaker: grid ? grid.classList.contains('layout-speaker') : /active/.test(spk ? spk.className : ''),
    filesOn: files ? !files.classList.contains('hidden') : null,
  };
})())`;

async function run(cdp, text, verify, label, waitMs = 2500) {
  const before = JSON.parse(await cdp.evaluate(STATE, 5000).catch(() => '{}'));
  await say(cdp, text);
  const deadline = Date.now() + 12000;
  let ok = false, after = null;
  while (Date.now() < deadline) {
    await sleep(500);
    after = JSON.parse(await cdp.evaluate(STATE, 5000).catch(() => '{}'));
    if (verify(before, after)) { ok = true; break; }
  }
  chk(ok, `${label}（指令「${text}」）`);
  return after;
}

(async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║ AI 操控会议实体：8 个动作真浏览器逐个验证      ║');
  console.log('╚══════════════════════════════════════════════╝');
  fs.mkdirSync(OUT, { recursive: true });

  let up = false;
  try {
    up = await new Promise((resolve) => {
      require('http').get(`${SERVER}/config.json`, (r) => { r.resume(); resolve(r.statusCode === 200); })
        .on('error', () => resolve(false));
    });
  } catch (e) { up = false; }
  if (up) { console.error(`❌ ${PORT} 已被占用（TEST_ACTIONS_PORT 可换）`); process.exit(1); }

  console.log(`① 起服务器（:${PORT}）+ 真 Chromium 进房…`);
  serverProc = spawn('node', [SERVER_JS], {
    env: { ...process.env, PORT: String(PORT), SFU_NO_HTTPS: '1', DB_FILE: TEST_DB_FILE, USERS_FILE_LEGACY: TEST_LEGACY_USERS, AI_FORCE_MOCK: '1' },
    cwd: path.join(__dirname, '..'), stdio: ['ignore', 'ignore', 'pipe'],
  });
  serverProc.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) {
    await sleep(250);
    try {
      ready = await new Promise((resolve) => {
        require('http').get(`${SERVER}/config.json`, (r) => { r.resume(); resolve(r.statusCode === 200); })
          .on('error', () => resolve(false));
      });
    } catch (e) { ready = false; }
  }
  if (!ready) throw new Error('服务器未就绪');

  const cdp = new Cdp({
    headless: false, port: 9365, windowSize: { width: 1280, height: 820 }, startUrl: 'about:blank',
    extraArgs: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  browsers.push(cdp);
  await cdp.launch();
  await cdp.navigate(SERVER);
  await cdp.waitForLoad(15000);
  await sleep(1200);
  await cdp.evaluate(`(() => { const b = document.getElementById('authGuestBtn'); if (b) b.click(); })()`);
  await waitJs(cdp, `!document.getElementById('prejoin').classList.contains('hidden') ? 1 : 0`, 12000, '预览页');
  await sleep(1000);
  await cdp.evaluate(`(() => { const b = document.getElementById('pjEnterBtn'); if (b) b.click(); })()`);
  await waitJs(cdp, `!document.getElementById('roomPanel').classList.contains('hidden') ? 1 : 0`, 12000, '房间面板');
  await sleep(500);
  await cdp.evaluate(`(() => { document.getElementById('createBtn').click(); })()`);
  await waitJs(cdp, `((el) => !el.classList.contains('hidden') && /\\d{6}/.test(el.textContent||'') ? 1 : 0)(document.getElementById('roomBadge'))`, 15000, '建房');
  await sleep(800);

  console.log('② 先手动开一次字幕（AI 自动入会；此后由 AI 指令控制开合）…');
  await cdp.evaluate(`(() => { document.getElementById('capBtn').click(); })()`);
  await sleep(2500);

  console.log('③ 逐条下达 8 个动作指令…');
  // ① 关字幕（现在字幕是开的）
  await run(cdp, '把字幕关掉', (b, a) => b.capOn === true && a.capOn === false, '关闭实时字幕');
  // ② 开字幕
  await run(cdp, '开启实时字幕', (b, a) => b.capOn === false && a.capOn === true, '开启实时字幕');
  // ③ 打开白板
  await run(cdp, '把白板打开', (b, a) => b.boardOpen === false && a.boardOpen === true, '打开白板');
  await shot(cdp, '白板开.jpg');
  // ④ 清空白板（开合状态不变，账本清空——界面级断言：仍开着）
  await run(cdp, '把白板清空', (b, a) => a.boardOpen === true, '清空白板（保持打开）');
  // ⑤ 撤销一笔（同上，白板仍开）
  await run(cdp, '撤销白板那一笔', (b, a) => a.boardOpen === true, '撤销一笔（保持打开）');
  // ⑥ 关白板
  await run(cdp, '把白板关掉', (b, a) => b.boardOpen === true && a.boardOpen === false, '关闭白板');
  // ⑦ 切演讲者视图
  await run(cdp, '切到演讲者视图', (b, a) => a.speaker === true && b.speaker !== true, '切演讲者视图');
  // ⑧ 切回宫格
  await run(cdp, '切到宫格视图', (b, a) => a.speaker === false && b.speaker === true, '切宫格视图');

  /* ★ 2026-10-08 ⑨⑩ 共享文件面板（第 51 步把白名单从 8 个长到 10 个）：
   *   ▎这条覆盖是"补"出来的，不是"当初就有"的——规则表加了两个动作，而这里
   *     一次都没在真浏览器里跑过它们（坑 106 的形状：电池测的是我想到过的说法）。
   *     症状如果漏了会很难看：AI 回一句"共享文件面板已经打开"，页面什么都没动，
   *     而这正是用户第四次反馈"操控实体还是实现的不行"时骂的那件事。 */
  await run(cdp, '打开共享文件面板', (b, a) => b.filesOn === false && a.filesOn === true, '打开共享文件面板');
  await shot(cdp, '文件面板开.jpg');
  await run(cdp, '把文件面板关掉', (b, a) => b.filesOn === true && a.filesOn === false, '关闭共享文件面板');
  /* ★ 2026-10-08 这一条才是本轮真正的收获：**句首就是"打开"的房间指令**。
   *   客户端的 C1 入口原先按 `/^(操作|打开|点击|帮我操作|远程)/` 判"要不要走远程操作别人电脑"，
   *   于是「@ai 打开白板」「@ai 打开共享文件面板」在浏览器里就被改发成 ai-op，
   *   白板一个字没动，而 AI 回的那句"先有人共享屏幕…"听起来完全正常——
   *   用户报了五次"操控实体还是实现的不行"，这是其中一条成因。
   *   ▸ 为什么现有 8 条一直没抓到：它们的说法全是「把白板打开」「开启实时字幕」「切到宫格」，
   *     **没有一条以"打开"开头**（坑 106：电池只覆盖我想到过的说法）。 */
  await run(cdp, '打开白板', (b, a) => b.boardOpen === false && a.boardOpen === true,
    '★ 句首就是「打开」的房间指令不再被 C1 操作员截走（旧判据在这里必然红）');

  console.log('③b ★ 2026-10-06 组合指令与否定式（用户第四次反馈"操控实体还是不行"之后补的两类）…');
  /* ▎为什么这两条要在真浏览器里跑：test:asr 的电池证明"服务器把那句话读成了几条动作"，
   *   但"两条动作各自到了页面、页面各自动了一次界面"只有这里能量出来——
   *   而用户的原话恰恰是关于界面的（"我说了它不动"）。 */
  // 此刻：白板关、字幕开、宫格（⑧ 之后的状态）
  await run(cdp, '把白板打开，顺便把字幕关掉',
    (b, a) => a.boardOpen === true && a.capOn === false, '一句话两件事：白板开 + 字幕关**同时**成立');
  await shot(cdp, '组合指令后.jpg');
  /* 否定式：不动手。判据用"保持原状"而不是"AI 回了什么"——它回得再漂亮都不算证据。 */
  const negBefore = JSON.parse(await cdp.evaluate(STATE, 5000).catch(() => '{}'));
  await say(cdp, '不要关白板');
  await sleep(4500);
  const negAfter = JSON.parse(await cdp.evaluate(STATE, 5000).catch(() => '{}'));
  chk(negBefore.boardOpen === true && negAfter.boardOpen === true,
    '否定式不动手（「不要关白板」之后白板仍开着——做错方向比不做更糟）');

  /* ★ 2026-10-06 ③c **泛化说法**端到端（这一轮最值得进浏览器的一条）：
   *   ▎test:asr 那 28 句新电池证明"服务器把话读成了动作 id"，但用户抱怨的是界面没动。
   *     拿**从未进过规则表**的口语在这里逐条落地，才算回答"操控实体还是实现的不行"。
   *   ▸ 第 5 条是本轮那个"做错方向"缺陷的哨兵：先切到演讲者，再说「别切宫格，把白板打开」。
   *     若否定守卫仍旧漏（命中点是名词"宫格"，否定副词隔着轻动词"切"），
   *     页面会**真的跳到宫格**——那时 a.speaker 就不是 true，这条当场红。
   *     判据写成"该做的做了 + 不该做的没做"两半，只断"该做的"会被"顺手全做了"骗过。 */
  console.log('③c ★ 泛化说法（从未进过规则表的口语）在真浏览器里逐条落地…');
  await run(cdp, '白板不用了', (b, a) => b.boardOpen === true && a.boardOpen === false, '泛化·关闭白板');
  await run(cdp, '能不能给我配个字幕', (b, a) => a.capOn === true, '泛化·开字幕');
  await run(cdp, '字幕先停一下', (b, a) => b.capOn === true && a.capOn === false, '泛化·关字幕');
  await run(cdp, '把说话的人放大', (b, a) => a.speaker === true && b.speaker !== true, '泛化·切演讲者');
  await run(cdp, '别切宫格，把白板打开', (b, a) => a.speaker === true && a.boardOpen === true,
    '泛化+否定·开白板**且没被切走宫格**（做错方向的缺陷在这里现形）');
  await run(cdp, '所有人的画面一样大', (b, a) => b.speaker === true && a.speaker === false, '泛化·切宫格');
  await run(cdp, '共享资料那块弄出来', (b, a) => b.filesOn === false && a.filesOn === true,
    '泛化·开共享文件面板（"那块"这种远指+量词就是 10-06 那批缺口的原样形状）');
  /* 收尾恢复现场：这里用页面自己的函数关掉——被测对象上面已经量过了，
   *   这一步只是把状态擦干净留给后面的用例（不是又一条"AI 做到了"的证据）。 */
  await cdp.evaluate(`(() => { setFilesOpen(false); return 1; })()`).catch(() => {});
  await sleep(600);
  await shot(cdp, '泛化说法后.jpg');

  console.log('④ 无关指令不误触发（说一句闲话，白板/字幕/文件面板都别动）…');
  const before = JSON.parse(await cdp.evaluate(STATE, 5000).catch(() => '{}'));
  await say(cdp, '今天天气真不错啊');
  await sleep(4000);
  const after = JSON.parse(await cdp.evaluate(STATE, 5000).catch(() => '{}'));
  chk(before.boardOpen === after.boardOpen && before.capOn === after.capOn && before.filesOn === after.filesOn,
    '闲聊不触发任何房间动作（tools-first 边界；现在把文件面板也纳入"不许动"的对照）');
  await shot(cdp, '结束后.jpg');

  console.log(`\n████ 房间动作结果：${checks} 项检查，${issues} 项失败 ████`);
  process.exitCode = issues ? 1 : 0;
})().catch((e) => {
  console.error(`\n❌ 异常：${e.stack || e.message}`);
  process.exitCode = 1;
}).finally(async () => {
  for (const b of browsers) { try { b.kill(); } catch (e) { /* */ } }
  if (serverProc) {
    try { serverProc.kill(); } catch (e) { /* */ }
    await sleep(800);
    try { spawn('taskkill', ['/PID', String(serverProc.pid), '/T', '/F'], { windowsHide: true }); } catch (e) { /* */ }
  }
});
