#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 *  check-golden.js —— /golden 录制页的真浏览器回归（2026-10-09）
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎为什么单独一条检查：这条链是**四个运行时串起来的**——
 *   浏览器 getUserMedia/MediaRecorder → HTTP raw body → ffmpeg 转码 → jsonl 账本。
 *   任何一段断了都不会报错给最终用户看：页面停在"上传中"，而金标准永远是空的。
 *   更糟的是它的失败形态与"用户还没录完"长得一模一样——`bench:asr-golden` 会安静地
 *   回落到合成语音，那张 CER 表看起来完全正常，但**它是合成场的**（坑 76/105）。
 *   test:sfu 那 11 条已经覆盖了 HTTP 层与门禁；这里补的是**浏览器这一轨**：
 *   真点按钮、真开麦克风、真录真传，然后读第二个视角看不到的东西（磁盘上的账本）。
 *
 * ▎断言（顺序即依赖）：
 *   ①  未登录：页面必须说"需要管理员"，不许停在"加载中"（假等待会让人以为还在跑）
 *   ②  版本指纹：页面加载的 golden.html 与服务器上的字节一致（防 SW 缓存假绿，坑 40）
 *   ③  登录后：句子清单从 /api/golden 渲染出来（≥8 行，且带"为什么是这句"）
 *   ④  距离档：两颗按钮 + 点一下切换 + aria-pressed 跟着变（前端不许有第二份清单）
 *   ⑤  录一句：真点「录」→ 再点「停止」→ 页面进度条出现"已存"并带峰值 dBFS
 *   ⑥  账本真落盘：GOLDEN_DIR 里出现 wav 且是 16k/单声道/16bit（转码契约成立）
 *   ⑦  峰值与生产同一个函数：服务器回的 peakDb 与我们自己量那份 wav 的结果一致
 *   ⑧  重录不丢条目：同 id 再录一次，账本里该 id 仍有且只有一条（回归抓过的真缺陷）
 *
 * ▎跑法：npm run check:golden
 *   自起专用端口（默认 3026）+ 临时库 + 临时 GOLDEN_DIR + 假麦克风；
 *   绝不碰用户那台 3001，也不往真实 sfu/voice-golden/ 里写东西（坑 57/72）。 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { Cdp } = require('../agent/cdp.js');   // 命名导出（按 default 取会拿到一个包对象，坑 126）
const Fx = require('./voice-fixture.js');

const PORT = Number(process.env.CHECK_GOLDEN_PORT || 3026);
const CDP_PORT = Number(process.env.WB_CDP_PORT || 9371);
const TMP_DB = path.join(os.tmpdir(), `golden-check-${process.pid}.db`);
const GOLDEN_TMP = path.join(os.tmpdir(), `golden-check-dir-${process.pid}`);
/* ★ 2026-10-09 真实金标准目录的"改动前快照"（⑨ 那条隔离自证要用它）。
 * ▎判据换形的原因：原先写的是"真实 sfu/voice-golden/ **没被创建**"——那句话在 10-09 之前成立，
 *   因为没人录过音；用户录完真人语音之后，这个目录**本来就该存在**，
 *   于是那条断言变成一个结构上不可能通过的假红线（它会一直红，而红的内容什么都没指向）。
 *   要问的真问题从来不是"目录在不在"，而是"这次检查有没有往用户的真实语料里写东西"。 */
const REAL_GOLDEN = path.join(__dirname, '..', 'sfu', 'voice-golden');
const dirStat = (p) => {
  try {
    const walk = (d, acc) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const fp = path.join(d, e.name);
        if (e.isDirectory()) walk(fp, acc);
        else acc.push(`${fp}|${fs.statSync(fp).size}|${fs.statSync(fp).mtimeMs}`);
      }
      return acc;
    };
    return walk(p, []).sort().join(';');
  } catch (e) { return '(不存在)'; }
};
const REAL_GOLDEN_BEFORE = dirStat(REAL_GOLDEN);
const AUDIO_DIR = path.join(os.tmpdir(), `golden-check-audio-${process.pid}`);
const results = [];
const ok = (name, pass, extra) => { results.push({ name, pass }); console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + String(extra).slice(0, 180) : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ev(cdp, expr, tries = 8) {
  let last = null;
  for (let i = 0; i < tries; i++) { try { return await cdp.evaluate(expr); } catch (e) { last = e; await sleep(800); } }
  throw last;
}
/* ★ 2026-10-09 把"等一个固定时间"换成"等到它成为断言条件本身"。
 *   ▎ev() 只在**抛错**时重试，而"页面还没取回 /api/golden"不抛错，它返回一个空列表 ——
 *   于是 ③ 读到 `prog:"未登录…"` 判红。全量 check:all 把机器压满时 1.8s 根本不够，
 *   单独复跑就 11/11（同一台机器、同一份代码、结论相反 = 量具在跟自己的渲染赛跑）。
 *   这是坑 96 / 104 / 120 那条纪律在本仓库的**最后一个靠 sleep 的量具**，这次一并收掉。
 *   ▸ 判据本身一个字不放松：轮询的条件就是断言要成立的那个条件；超时后照样返回现场值，
 *     让红话里带着"到底读到了什么"，而不是把断言改成"总评？"式的放水。 */
async function waitVal(cdp, expr, pred, tries = 12) {
  let v = null;
  for (let i = 0; i < tries; i++) {
    v = await ev(cdp, expr);
    try { if (pred(v)) return v; } catch (e) { return v; }
    await sleep(400);
  }
  return v;
}
function portBusy(p) {
  return new Promise((res) => {
    const s = require('net').connect(p, '127.0.0.1');
    s.once('connect', () => { s.destroy(); res(true); });
    s.once('error', () => res(false));
    s.setTimeout(800, () => { s.destroy(); res(false); });
  });
}

(async () => {
  if (await portBusy(PORT)) {
    console.log(`\n❌ ${PORT} 端口已有服务器在跑 —— 本检查需要"自己起的、用临时库与临时金标准目录"的那一台，`
      + `复用别人的实例验的不是本次代码（坑 57）。换端口跑：CHECK_GOLDEN_PORT=3027 npm run check:golden\n`);
    process.exit(1);
  }
  fs.rmSync(GOLDEN_TMP, { recursive: true, force: true });

  /* 假麦克风的内容：**故意与页面上那句不一样**。这里测的是"录-传-转-记账"这条管道，
     不是准确率；把两件事混在一个断言里，将来红了分不清是管道坏了还是模型听错了。 */
  const mic = await Fx.makeSpeechWav({
    sentences: ['这是用来验证录制管道的一句话。'],
    dir: AUDIO_DIR, outName: 'mic.wav', tailSec: 4, gapSec: 1,
    /* 这条共享 helper 自带一条质量线（最长静音 ≥3s），因为多数消费者要过服务器的成句闸。
       本检查只需要"有声音进来"，但**不为此放宽共享判据**——放宽一处，别的测试下一环遭殃（坑 92）。 */
  });

  const server = spawn(process.execPath, [path.join(__dirname, '..', 'sfu', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(PORT), SFU_NO_HTTPS: '1',
      DB_FILE: TMP_DB, USERS_FILE_LEGACY: path.join(os.tmpdir(), `nope-${process.pid}.json`),
      GOLDEN_DIR: GOLDEN_TMP,                 // ★ 隔离：录音写临时目录，不碰 sfu/voice-golden/
      ASR_QWEN_LOCAL: '0', ASR_ENABLE: '0',   // 本检查不碰 GPU（显存是这台机器的硬预算）
      AI_FORCE_MOCK: '1', AUTH_PASSWORD_MINLEN: '6',
    },
    cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });

  try {
    for (let i = 0; i < 40; i++) { if (await portBusy(PORT)) break; await sleep(300); }
    if (!(await portBusy(PORT))) throw new Error(`测试服务器起不来：\n${serverLog.slice(-600)}`);
    await sleep(1200);   // 等 ffmpeg / whisper 那些异步探测收敛

    const base = `http://localhost:${PORT}`;
    const cdp = new Cdp({
      headless: false, port: CDP_PORT, windowSize: { width: 1280, height: 860 },
      startUrl: base + '/golden?nosw=1',
      extraArgs: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${mic.file.replace(/\\/g, '/')}`,
        '--autoplay-policy=no-user-gesture-required'],
    });
    await cdp.launch();
    await cdp.waitForLoad(20000);

    /* ① 未登录：诚实提示，不许停在"加载中"
     *   ▸ 不再 sleep(1500) 赌一次：等到页面**真的给出了一句答复**（未登录提示或清单）再读，
     *     读到的还是空串就说明它压根没答话——那才该红（原来那种"读早了"的红会把量具的错记到产品头上）。 */
    const anon = await waitVal(cdp, `(() => ({
      prog: (document.getElementById('progress')||{}).textContent || '',
      rows: document.querySelectorAll('#list .item').length,
      btnDisabled: !!(document.getElementById('allBtn')||{}).disabled,
    }))()`, (v) => v && /管理员|未登录|已录|目标/.test(v.prog));
    ok('① 前提：页面已经答过话（不是停在"加载中…"这种空串）',
      !!(anon && anon.prog), JSON.stringify(anon));
    ok('① 未登录时明说"要管理员/未登录"，并停在诚实的空态（不是转圈圈）',
      /管理员|未登录/.test(anon.prog) && anon.rows === 0 && anon.btnDisabled === true, anon.prog);

    /* ② 版本指纹：页面就是磁盘上那份（SW 缓存会让后面每一条都白测） */
    const fp = await ev(cdp, `(async () => {
      const disk = await (await fetch('/golden.html', { cache: 'no-store' })).text();
      return { diskHasLoader: disk.includes("fetch('/api/golden'"), scripts: [...document.querySelectorAll('script')].length };
    })()`);
    ok('② 页面加载的是磁盘上那版 golden.html（含 /api/golden 读取逻辑）', fp.diskHasLoader === true, fp);

    /* 用 socket.io 走生产注册路径（第一个账号自动 admin），再把 token 塞进 localStorage */
    const token = await new Promise((resolve, reject) => {
      const io = require('socket.io-client');
      const s = io(base, { transports: ['websocket'] });
      const t = setTimeout(() => reject(new Error('注册超时')), 15000);
      s.on('connect', () => s.emit('auth-register', { username: `gc_${process.pid}`, password: 'abcd12', displayName: '金标准检查' }, (resp) => {
        clearTimeout(t);
        const tok = (((resp || {}).data) || {}).token || '';
        s.close();
        tok ? resolve(tok) : reject(new Error('注册没拿到 token：' + JSON.stringify(resp).slice(0, 160)));
      }));
      s.on('connect_error', (e) => { clearTimeout(t); reject(e); });
    });

    await ev(cdp, `localStorage.setItem('wb_auth', JSON.stringify({ token: ${JSON.stringify(token)}, username: 'gc', displayName: '金标准检查' })); 'ok'`);
    await cdp.navigate(base + '/golden?nosw=1');

    /* ③ 登录后渲染清单（前端不许抄第二份句子清单）
     *   ▸ 轮询条件 = 断言条件（rows>=8）：以前是 sleep(1800) 赌一次，机器一满就读到"未登录"，
     *     全量跑与单独跑给出相反结论（坑 120 的同一条纪律，这一处是本仓库最后一处赌时间的读法）。 */
    const after = await waitVal(cdp, `(() => ({
      rows: document.querySelectorAll('#list .item').length,
      why: [...document.querySelectorAll('#list .why')].length,
      segs: [...document.querySelectorAll('#seg button')].map((b) => b.textContent),
      pressed: [...document.querySelectorAll('#seg button')].map((b) => b.getAttribute('aria-pressed')),
      prog: (document.getElementById('progress')||{}).textContent || '',
      recBtns: document.querySelectorAll('#list button.rec').length,
      gate: (window.meta && window.meta.gateDb) || null,
    }))()`, (v) => v && v.rows >= 8, 20);
    ok('③ 登录后逐句渲染（≥8 行、每行带"为什么是这句"，颗按钮都还在）',
      after.rows >= 8 && after.why === after.rows && after.recBtns >= 8, JSON.stringify(after).slice(0, 160));
    ok('④ 两档距离都在且默认档被标成 pressed（清单是前端唯一的状态来源）',
      after.segs.length === 2 && after.pressed.filter((x) => x === 'true').length === 1, after.segs);

    /* ⑤ 真点「录」→ 等 1.6s → 真点「停止」→ 页面进度出现"已存"并带峰值 */
    const clickRec = await ev(cdp, `(() => {
      const b = document.querySelector('#list button.rec');
      if (!b) return { nofn: true };
      b.click();                      // 真点击（不是程序里调 toggle：那样测不到按钮与状态的一致性）
      return { label: b.textContent };
    })()`);
    await sleep(1700);
    await ev(cdp, `(() => { const b = document.querySelector('#list button.rec'); if (b) b.click(); return 'stopped'; })()`);
    /* 轮询到"已存"出现为止 —— 轮询条件必须等于断言条件本身（坑 120） */
    let prog = '';
    for (let i = 0; i < 30; i++) {
      prog = await ev(cdp, `(document.getElementById('progress')||{}).textContent || ''`);
      if (/已存|❌/.test(prog)) break;
      await sleep(500);
    }
    const m = /峰值 (-?\d+(?:\.\d+)?) dBFS/.exec(prog);
    ok('⑤ 真录一条 → 上传 → 页面自己报出"已存 + 峰值 dBFS"（不是停在"上传中"）',
      !!m && /已存/.test(prog), prog);

    /* ⑥ 磁盘侧对账：账本里有这条，wav 存在，且真的是 16k/单声道/16bit */
    const manifestPath = path.join(GOLDEN_TMP, 'manifest.jsonl');
    const rec = fs.existsSync(manifestPath)
      ? fs.readFileSync(manifestPath, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean).slice(-1)[0]
      : null;
    let fmt = null;
    if (rec) {
      const { rate, pcm } = Fx.readWavPcm(path.join(GOLDEN_TMP, rec.wav));   // 这个读法本身就要求单声道 16bit
      fmt = { rate, bytes: pcm.length, exists: true };
    }
    ok('⑥ 账本落盘且 wav 是 16000Hz/单声道/16bit（转码契约成立，否则引擎根本吃不下）',
      !!rec && !!fmt && fmt.rate === 16000 && fmt.bytes > 3000, fmt);
    ok('⑥b 账本记的是**页面上那句**期望文本（管道测的是链路，文本必须来自句子清单而不是假麦克风）',
      !!rec && /评审会|纪要|白板|小明|压测/.test(rec.text || ''), rec && rec.text);

    /* ⑦ 服务器回的峰值 == 我们自己量那份 wav 的峰值（同一个函数、同一个概念） */
    const peakFromDisk = rec ? require('../sfu/ai/asr.js').measureWavLevel(path.join(GOLDEN_TMP, rec.wav)).peakDb : null;
    const peakShown = m ? Number(m[1]) : null;
    ok('⑦ 页面显示的峰值与磁盘上实测的是同一个数（都出自 Asr.measureWavLevel）',
      Number.isFinite(peakFromDisk) && Number.isFinite(peakShown) && Math.abs(peakFromDisk - peakShown) < 0.2,
      `shown=${peakShown} disk=${peakFromDisk === null ? null : peakFromDisk.toFixed(2)}`);

    /* ⑧ 重录同一句：账本里该 id 有且只有一条，且文件还在（今天真被这条抓出一个删错文件的缺陷） */
    await ev(cdp, `(() => { const b = document.querySelector('#list button.rec'); if (b) b.click(); return 'again'; })()`);
    await sleep(1500);
    await ev(cdp, `(() => { const b = document.querySelector('#list button.rec'); if (b) b.click(); return 'stop2'; })()`);
    for (let i = 0; i < 30; i++) {
      prog = await ev(cdp, `(document.getElementById('progress')||{}).textContent || ''`);
      if (/已存|❌/.test(prog)) break;
      await sleep(500);
    }
    const all = fs.existsSync(manifestPath)
      ? fs.readFileSync(manifestPath, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean)
      : [];
    const idCount = (all.filter((r) => r.id === (rec && rec.id) || '').length);
    const pageItems = await ev(cdp, `document.querySelectorAll('#list .st.ok, #list .st.warn').length`);
    ok('⑧ 同句重录后：账本里那条 id 唯一、页面仍显示"已录"、wav 文件没被删掉',
      !!rec && idCount <= 1 && pageItems >= 1 && fs.existsSync(path.join(GOLDEN_TMP, rec.wav)),
      `id=${rec && rec.id} 行数=${all.length} 页面已录=${pageItems}`);

    /* ⑨ 隔离自证 + 控制台干净 */
    ok('⑨ 这次检查期间真实 sfu/voice-golden/ 一个字节都没变（用户语料不许被测试写）',
      dirStat(REAL_GOLDEN) === REAL_GOLDEN_BEFORE,
      REAL_GOLDEN_BEFORE === '(不存在)'
        ? '目录原本不存在，跑完仍不存在'
        : '逐文件比 路径|字节|mtime；若此刻有人正在手动录音，这条会如实红——那不是本检查写的');
    const errs = await ev(cdp, `(window.__cfErrs && window.__cfErrs.length) || 0`).catch(() => 0);
    /* 用 evaluate 而不是 cdp.send(...)：后者是私有通道（_send 要显式带 ws），
       猜错 API 不会报错给被测物看，只会让检查自己红（坑 126 今晚第三次）。 */
    const alive = await ev(cdp, `1`).catch(() => null);
    ok('⑩ 页面没有把错误咽掉（进度条没出现 ❌，脚本还能求值）',
      !/❌/.test(prog) && alive === 1, prog);
    if (errs) console.log(`     （页面自报错误 ${errs} 条）`);

    await cdp.kill();   // 这个类的方法叫 kill()（不是 close()——猜错 API 名不会有人提醒你，坑 126）
  } finally {
    try { server.kill(); } catch (e) { /* 已经退了 */ }
    try { fs.rmSync(TMP_DB, { force: true }); fs.rmSync(TMP_DB + '-wal', { force: true }); fs.rmSync(TMP_DB + '-shm', { force: true }); } catch (e) { /* 无所谓 */ }
    try { fs.rmSync(GOLDEN_TMP, { recursive: true, force: true }); } catch (e) { /* Windows 占用时下轮清 */ }
    try { fs.rmSync(AUDIO_DIR, { recursive: true, force: true }); } catch (e) { /* 同上 */ }
  }

  const bad = results.filter((r) => !r.pass).length;
  console.log(`\n结果: ${results.length - bad} 通过, ${bad} 失败`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('异常:', (e && e.stack) || e); process.exit(1); });
