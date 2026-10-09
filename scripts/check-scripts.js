/* =============================================================================
 *  scripts/check-scripts.js —— 「这八十多条 npm 脚本，有没有哪条其实已经跑不起来了？」
 * =============================================================================
 * ▎为什么需要这条命令（不是又一件"看起来更工程化"的东西）：
 *   2026-10-04e 盘点全测时，`test:tts` 已经**红了三个月**而没人发现——
 *   它不在任何一条清单里、没人跑它，而每次"全量回归"报告都写着全绿。
 *   那一次是靠人把 16 个脚本逐个跑了一遍才发现的；人会忘，清单不会（坑 40 那条老教训）。
 *   ▸ 所以这条命令做的是**机器可判的四件事**，不做"我保证都跑过"那种无法兑现的承诺：
 *     ① 每条 `node xxx.js` 指向的**文件真的存在**，且 `node --check` 过（加载层）；
 *     ② 每条 `python xxx.py` 指向的文件存在（不跑，跑要装依赖/占 GPU）；
 *     ③ 每个 `scripts/*.js` 都**可被找到**：被某条 npm script 引用、或被别的代码 require 到、
 *        或出现在回归清单/文档的跑法里。三者都不是 = 孤儿（它红了也不会有人看见）。
 *     ④ 头部许了"跑完/量完即删"这类**删掉的承诺**、又没登记成任何 npm 命令的文件，
 *        不许留在 `scripts/`（它常是改文件的那一类，误跑一次就要重回归）。
 *   ▸ ★ 这台仪表**证明不了**的事，写清楚免得被当成证明了：
 *     "可达"不等于"今晚被跑过"。没有任何一条命令会替我记录"哪个 test:* 今天跑过"，
 *     所以下面那一层只报**多久没人改过它**（观察，不判红）——真正的"今晚跑过什么"
 *     只能来自我把回归清单逐条跑一遍并贴出数字。拿"文件还在 + 语法过"说"这条测试没问题"
 *     就是坑 105 那条"把没证据报成通过"。
 *   ▸ 一层"观察"（**不判红**，因为证据不足以下判据）：每条测试脚本距上次改动多少天 +
 *     有没有在最近 60 天的文档里被提到。这一行的用途是"今晚哪几条没有任何回归碰过它"，
 *     数字由 `git log` 给，不由记忆给（坑 105：没证据不许报通过，也不许报失败）。
 *
 * 用法：npm run test:scripts            四层全查（缺文件/语法错/孤儿/未删的一次性承诺 ⇒ 退出码 1）
 *       npm run test:scripts -- --selftest   跑这台仪表自己的自检（合成夹具，含反向对照）
 *       npm run test:scripts -- --quiet      只报问题不报表
 * ▎为什么挂在 `test:` 而不是 `check:` 名下（名字不是随便挑的）：
 *   ▸ ★ 这是一台**静态审计：不开浏览器、不起服务器**——与 check:all 那 21 条"量界面"的检查不同类。
 *     冒烟里那条"每条界面检查都要有版本指纹"的红线认的就是这句话（它按声明豁免，
 *     并当场核对声明者真的碰不到浏览器；否则"我是静态的"就成了万能逃生舱）。
 *   ▸ `check:*` 这个命名空间另有一条硬判据：**check:all 的清单与 package.json 的 check:* 一一对应**，
 *     而那条清单是"每条都要起一个真浏览器"的界面检查；这台塞进那个循环，
 *     要么白起一个浏览器，要么把汇总行"共 N 项**界面**断言"的口径污染成假数（坑 82 的计数版）。
 *   ▸ `test:*` 才是它该在的地方——与 test:review / test:nets / test:watch 同类：静态判据 + 自带自检。
 * 零依赖：只用 Node 内置 fs/path/child_process + git（git 不在时那一层报"未采到"，不猜）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SELFTEST = process.argv.includes('--selftest');
const QUIET = process.argv.includes('--quiet');

/* 哪些文件算"清单/文档"：孤儿判定要认它们（一条脚本被写进 check:all 清单或文档跑法，
 *   就不算"没人能跑到"——但被写进注释里不算，见下面 strip 注释那一步）。 */
const DOC_FILES = ['AGENTS.md', 'README.md', '后续升级方向.md', 'LEARN.md'];
const CHECK_LIST = 'scripts/check-all.js';

function readJson(f) { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); }

/** 列出 scripts/ 下所有 .js（排除本文件与一次性隐藏文件）。 */
function listScripts(dir) {
  return fs.readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith('.js') && !f.startsWith('.'))
    .map((f) => `${dir}/${f}`);
}

/** 从一条 npm command 里抠出被执行的本地文件（`node x.js …` / `python x.py …`）。 */
function commandFiles(cmd) {
  const out = [];
  const re = /(?:^|\s)(?:node|python3?|py)\s+(?:"([^"]+)"|'([^']+)'|(\S+\.(?:js|cjs|mjs|py)))/g;
  let m;
  while ((m = re.exec(String(cmd || ''))) !== null) {
    const p = m[1] || m[2] || m[3];
    if (p && !p.startsWith('-')) out.push(p);
  }
  return out;
}

/** 剥掉块注释与行注释：判"文档里提到过"不能靠注释里的自述，否则判据会把自己的说明当证据（坑 103 同族）。 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** 「我跑完就把自己删掉」这句承诺的**写法**——不是"一次性"这三个字。
 *   ▸ 两种形态：① `X完即删`（跑完/量完/用完/改完/做完/测完/试完/一次性…即删），
 *     ② `一次性…（删掉|删除）`。为什么这么窄：见第 ④ 层注释里那三句被误伤的真描述。 */
const ONE_OFF_PROMISE_RE = /(?:跑完|量完|用完|改完|做完|测完|试完|用过|一次性)[^\n]{0,8}即删|一次性[^\n]{0,12}(?:删掉|删除)/;

function gitLastCommitDays(rel) {
  const r = spawnSync('git', ['-C', ROOT, 'log', '-1', '--format=%ct', '--', rel], { encoding: 'utf8' });
  if (r.status !== 0 || !String(r.stdout).trim()) return null;
  const ts = Number(String(r.stdout).trim());
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, Math.round((Date.now() / 1000 - ts) / 86400));
}

/**
 * 核心检查：返回 {rows, problems}。problems 非空 = 退出码 1。
 * @param {{scripts:object, files:string[], docs:string, lists:string[], exists?:function}} input
 */
function inspect(input) {
  const scripts = input.scripts || {};
  const files = input.files || [];
  const docs = String(input.docs || '');
  const lists = (input.lists || []).join('\n');
  /* 存在性判断可注入：自检要给"根本不存在的文件"编一个虚拟文件系统，
   *   否则夹具测试全被真实磁盘绊倒（我第一版就是这么红的两条——判据没错，夹具在骗自己）。 */
  const exists = input.exists || ((rel) => fs.existsSync(path.join(ROOT, rel)));
  const read = input.read || ((rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return ''; } });
  const check = input.check || ((rel) => {
    const c = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' });
    return c.status === 0 ? null : String(c.stderr || c.stdout).split('\n')[0];
  });
  const problems = [];
  /* ① + ②：命令里指向的文件必须存在 */
  const referenced = new Set();
  const rows = [];
  for (const key of Object.keys(scripts)) {
    const cmd = scripts[key];
    for (const f of commandFiles(cmd)) {
      const rel = f.replace(/^\.\//, '');
      referenced.add(rel);
      if (!exists(rel)) problems.push(`${key} 指向的文件不存在：${rel}`);
    }
    rows.push({ key, cmd });
  }

  /* ①b 语法层**扫所有脚本**，不只扫被引用的那些：
   *   一条没人引用的脚本照样会"存在但加载不了"，而那正是它三个月没人跑的原因（09-24b 的 test:tts）。 */
  if (!input.skipCheck) {
    for (const rel of files) {
      if (!exists(rel)) continue;
      if (!/\.(js|cjs|mjs)$/.test(rel)) continue;
      const err = check(rel);
      if (err) problems.push(`${rel} 语法不过：${err}`);
    }
  }

  /* ④ 一次性脚本红线：文件头许了"跑完就删"的诺言却不删，最坏的下场不是难看，是
   *   **几个月后被谁误跑一次**——这类脚本干的事通常是改文件。
   *   ▸ 今晚真跑就是这样逮到两个（`_tmp_auth.js` 会重写 index.html、`_probe-whole-vs-sliced.js` 占 GPU），
   *     两者都已写"跑完即删/量完即删"却没删。承诺要靠判据兜住，不能靠记性（坑 40）。
   *   ▸ ★ 判据第一版只认「一次性」这三个字，被真跑当场退回来：它把三句**描述**当成了**自述**——
   *     「调度器真的会演一次性动作」(check-ai-avatar)、「A 组一次性列清」(doctor)、
   *     「临时库一次性账号」(legacy-user-fixture)。**"这个词出现"与"它许了个删的诺言"是两件事**，
   *     所以要认的是诺言的写法（X完即删 / 一次性…删掉），不是词本身。
   *     会误伤的判据下个遇到它的人会直接删掉（坑 110 原话），所以这条红线配了 A.9b 那条真句子反例。 */
  for (const rel of files) {
    if (!exists(rel)) continue;
    /* 只看文件头 900 字：诺言写在头部；扫全文会把"提到别人的脚本写了即删"的说明当成自述（误伤）。 */
    const head = read(rel).slice(0, 900);
    /* ★ 豁免"已被某条 npm script 登记"的文件——除非名字本身就长得像草稿（_ / tmp / temp / one-off）。
     *   ▸ 为什么这条豁免是**语义**而不是给自己开后门：登记成命令 = 有人决定让它长期存在，
     *     那它头部那句"即删"就是在**描述判据**而不是**许承诺**。这台仪表自己就是这么撞上的：
     *     我的第 ④ 层说明里写了那句承诺的原话，第一次真跑就把它自己判红了（坑 103 的原地复发：
     *     判据把自己的说明当证据）。名字像草稿的那一半不豁免，因为"注册了一条 run:tmp"这种
     *     操作救不了一个本来就打算用完就删的脚本。 */
    const looksScratch = /(^|[\/_.])(?:tmp|temp|one-off)(?:[_.]|$)|\/_/.test(rel);
    const promised = !input.skipOneOffScan && ONE_OFF_PROMISE_RE.test(head);
    /* 判据真值表（写出来是因为我第一版把这两个条件写成了 `!referenced && (scratch || promised)`，
     *   于是"登记过的草稿脚本"整条被豁免、A.9a 当场红——布尔的与/或顺序在两条独立条件上最容易反）：
     *   未登记 + 有承诺 ⇒ 报；未登记 + 只是描述 ⇒ 不报；已登记 + 草稿名 + 有承诺 ⇒ 报；
     *   已登记 + 正常名（= 这台仪表自己）⇒ 不报。 */
    if (promised && (looksScratch || !referenced.has(rel))) {
      problems.push(`${rel} 头部写着"跑完即删/量完即删"这类承诺${referenced.has(rel) ? '，而且名字像草稿' : '、又没有登记成任何命令'}，却还留在 scripts/ 里：要么删掉，要么挪进 backup/（这类脚本做的事常是改文件，误跑一次就要重回归）`);
    }
  }

  /* ③ 孤儿：既没被 npm script 指到，也没被别的代码 require，也没出现在清单/文档里 */
  const srcBlobs = {};
  for (const rel of files) srcBlobs[rel] = stripComments(read(rel));
  /* require 的写法千奇百怪（'./x.js' / '../sfu/x'），所以按**文件名**判而不是拼路径：
   *   判据要能抓住"确实有人引用它"这件事，而不是精确到写法——写法漂了判据就失效（坑 53 同族）。 */
  const allCode = Object.values(srcBlobs).join('\n');
  const orphans = [];
  for (const rel of files) {
    if (referenced.has(rel)) continue;
    const base = path.basename(rel);
    if (allCode.includes(base)) continue;                       // 被别的代码按文件名引用到
    if (lists.includes(base) || docs.includes(base)) continue;   // 被清单/文档指着（人能跑到）
    orphans.push(rel);
  }
  for (const o of orphans) problems.push(`孤儿脚本（没有任何入口能跑到它）：${o} —— 它红了也不会有人看见（test:tts 三个月没人发现的形状）`);

  /* 观察层：多少天没动过（不判红；git 不在就明说"未采到"） */
  const stale = [];
  for (const rel of files) {
    const d = input.gitDays ? input.gitDays(rel) : null;
    if (d === null) continue;
    if (d >= 14) stale.push({ rel, days: d });
  }
  stale.sort((a, b) => b.days - a.days);
  return { rows, problems, orphans, stale, gitMissing: !input.gitDays };
}

/* ─────────────────────────── 自检（合成夹具，含反向对照） ─────────────────────────── */
function selftest() {
  const R = [];
  /* 参数顺序守卫（坑 110）：这个文件的约定是 ok(名字, 条件)。本仓库同时存在两种约定，
   *   下一个照"顺手的那个"粘进来的人会把判据粘成永真 —— 守卫把它变成当场红。 */
  const orderProblem = require('./assert-order-guard.js').guard;
  const ok = (name, pass, extra) => {
    const bad = orderProblem('name-first', name, pass);
    const real = bad ? false : !!pass;
    R.push(real);
    console.log(`  ${real ? 'PASS' : 'FAIL'}  ${name}${(bad || extra) ? '  · ' + (bad || extra) : ''}`);
  };
  const files = ['scripts/a.js', 'scripts/b.js', 'scripts/orphan.js'];
  const gitDays = () => 0;
  /* 虚拟磁盘：a/b/bench.py 算"存在"，orphan.js 也存在（它的问题是"没有入口"，不是"文件没了"） */
  const exists = (rel) => ['scripts/a.js', 'scripts/b.js', 'scripts/orphan.js', 'scripts/bench.py'].includes(rel);

  const base = { files, gitDays, lists: [], docs: '', exists, skipCheck: true };
  /* A.1 的夹具必须**三个文件都有入口**，否则"没有问题"这句话结构上不可能成立
   *   （第一版我只引用了 a/b，于是这条永远红——判据没错，是我给它编了一个做不到的现场，坑 55 同族）。 */
  const a = inspect(Object.assign({}, base, {
    scripts: { x: 'node scripts/a.js', y: 'node scripts/b.js --flag', z: 'node scripts/orphan.js' },
  }));
  ok('A.1 每条命令指向的文件都在、每个脚本都有入口 ⇒ 没有问题', a.problems.length === 0, a.problems.join(' | '));

  const b = inspect(Object.assign({}, base, { scripts: { x: 'node scripts/a.js', y: 'node scripts/没了.js' } }));
  ok('A.2 反向对照：命令指向不存在的文件必须报（这是最便宜也最救命的一层）',
    b.problems.some((p) => /不存在/.test(p) && /没了\.js/.test(p)), b.problems[0]);

  const c = inspect(Object.assign({}, base, { scripts: { x: 'node scripts/a.js', y: 'node scripts/b.js' } }));
  ok('A.3 反向对照：没被任何入口指到的脚本要报"孤儿"（test:tts 那一类的机器判据）',
    c.problems.some((p) => /孤儿/.test(p) && /orphan\.js/.test(p)), c.problems.filter((p) => /孤儿/.test(p)).length + ' 条');

  const d = inspect(Object.assign({}, base, {
    scripts: { x: 'node scripts/a.js', y: 'node scripts/b.js' },
    lists: ['module.exports = require("./orphan.js");'],
  }));
  ok('A.4 被别的代码 require 到就不算孤儿（库文件不是漏网）',
    !d.problems.some((p) => /孤儿/.test(p)), d.problems.join(' | '));

  const e = inspect(Object.assign({}, base, {
    scripts: { x: 'node scripts/a.js', y: 'node scripts/b.js' },
    docs: '跑法：`node scripts/orphan.js`',
  }));
  ok('A.5 文档里写了跑法就不算孤儿（文档也是入口，只是弱一点的入口）',
    !e.problems.some((p) => /孤儿/.test(p)), e.problems.join(' | '));

  /* 判"提到过"要看**剥掉注释之后**的代码：把自己那句说明当证据，判据就永远不会红（坑 103 第三次应验） */
  const f = inspect(Object.assign({}, base, {
    scripts: { x: 'node scripts/a.js', y: 'node scripts/b.js' },
    lists: [],
  }));
  ok('A.6 只在注释里被提到的文件名不算"有入口"（否则判据会被自己的说明喂饱）',
    f.problems.some((p) => /孤儿/.test(p) && /orphan\.js/.test(p)));

  /* 命令解析层：`node -e "…"` 不该被当成"指向本地文件"（误判会天天报"不存在"，
   *   而天天误报的判据跟没有判据等价——坑 67/82 那条）。
   *   ▸ 这里刻意**不**断"没有任何问题"：a/b/orphan 三个夹具文件在这种脚本表下确实都是孤儿，
   *     那是 A.3 的账，不是这一条要问的事。一条断言只问一个问题（坑 123 同族）。 */
  const g = inspect(Object.assign({}, base, { scripts: { z: 'node -e "console.log(1)"' } }));
  ok('A.7 `node -e` 不被误当成文件引用（只断这一件：不许冒出"不存在"）',
    !g.problems.some((p) => /不存在/.test(p)), g.problems.filter((p) => /不存在/.test(p)).join(' | ') || '（没有误报）');
  const h = inspect(Object.assign({}, base, { scripts: { x: 'node scripts/a.js', y: 'node scripts/b.js', z: 'python scripts/没有这个.py' } }));
  ok('A.8 python 命令也查存在性（跑它要装依赖/占 GPU，不在这一层；只查文件在不在）',
    h.problems.some((p) => /不存在/.test(p) && /没有这个\.py/.test(p)), h.problems[0] || '（没报）');

  /* ④ 一次性脚本红线：头部许了"跑完即删"这类承诺、又没登记成任何命令 ⇒ 必须报；
   *   而**描述**不许被当成承诺。反例用的是仓库里真出现过的三句话（第一版把它们全判红了）：
   *   "会演一次性动作" / "一次性列清" / "一次性账号" —— 拿真句子当反例比我凭空编一句"正常脚本"
   *   更有力（坑 106：自己写的夹具测的是记忆，不是能力）。
   *   ▸ 这一组用**独立的夹具文件**（不复用 A.1~A.8 的 base）：那条"登记过就豁免"的规则
   *     与 base 里"每个脚本都有入口"的前提互相抵消，混在一组夹具里测不出任何东西（坑 123 同族：
   *     变异/判据那一行到底有没有被执行，要先设计出让它能被执行的现场）。 */
  const oFiles = ['scripts/a.js', 'scripts/b.js', 'scripts/orphan.js', 'scripts/_tmp_thing.js', 'scripts/judge.js'];
  const oRead = (rel) => ({
    'scripts/a.js': '/* 常驻回归套件，头部什么都没有 */\n',
    'scripts/b.js': '/* 一次性对照实验（量完即删）：同一批生产函数、同一段音频 */\n',
    'scripts/orphan.js': '/* 小动作：7~14s 随机调度器真的会演一次性动作；A 组一次性列清；临时库一次性账号。 */\n',
    'scripts/_tmp_thing.js': '/* 正式工具（登记成命令了）——但名字像草稿，还写着跑完即删 */\n',
    'scripts/judge.js': '/* 常驻判据工具：本文档里会引用"跑完即删/量完即删"这句被检测的话 */\n',
  }[rel] || '');
  const oBase = Object.assign({}, base, { files: oFiles, exists: (rel) => oFiles.includes(rel), read: oRead });
  /* 入口只给 a.js 与 _tmp_thing.js 与 judge.js；b.js/orphan.js 故意没入口（它们各自只回答一个问题） */
  const o1 = inspect(Object.assign({}, oBase, {
    scripts: { x: 'node scripts/a.js', y: 'node scripts/_tmp_thing.js', j: 'node scripts/judge.js' },
  }));
  const hit = (re) => o1.problems.filter((p) => re.test(p));
  ok('A.9 「量完即删」这种未登记的承诺必须报（报的是删掉承诺，不是"一次性"三个字）',
    hit(/scripts\/b\.js/).some((p) => /即删/.test(p)), hit(/scripts\/b\.js/).join(' | ') || '（没报）');
  ok('A.9a 名字像草稿（_tmp_）的即使登记成命令也照样报——注册一条 run:tmp 救不了一个用完就删的脚本',
    hit(/_tmp_thing/).some((p) => /即删/.test(p)), hit(/_tmp_thing/).join(' | ') || '（没报）');
  ok('A.9b 反向对照：仓库里那三句**描述**不许被这条红线误伤（"演一次性动作/一次性列清/一次性账号"）——会误伤的判据会被下一个人直接删掉，坑 110',
    !hit(/scripts\/orphan\.js/).some((p) => /即删/.test(p)), hit(/scripts\/orphan\.js/).join(' | ') || '（没误伤）');
  /* A.9c 就是这台仪表自己的现场：常驻判据工具的说明里必然要引用被检测的那句话，
   *   不豁免它就会自己判自己红（真跑第一次确实这样红过一次，坑 103"判据把自己的说明当证据"）。
   *   ▸ 注意判的是"没有即删那条问题"，不是"没有任何问题"——judge.js 不在 base 的 files 里所以不报孤儿，
   *     而 a.js/b.js/orphan.js 在这一组里确实是孤儿，那是 A.3 的账（一条断言只问一个问题）。 */
  ok('A.9c 已登记成命令的常驻工具，头部引用了那句承诺原话也不报（豁免"说明"，不豁免"草稿"）',
    !hit(/scripts\/judge\.js/).some((p) => /即删/.test(p)), hit(/scripts\/judge\.js/).join(' | ') || '（没误伤自己）');

  /* ①b 语法层扫**所有**脚本（不只被引用的）：没人引用的脚本"存在但加载不了"正是三个月没人发现的形状 */
  const i10 = inspect(Object.assign({}, base, {
    scripts: { x: 'node scripts/a.js', y: 'node scripts/b.js', z: 'node scripts/orphan.js' },
    skipCheck: false,
    check: (rel) => (rel === 'scripts/orphan.js' ? 'SyntaxError: 少个括号' : null),
  }));
  ok('A.10 语法层覆盖到"没被任何命令引用"的脚本（test:tts 那类：红了三个月没人跑，首先得能加载）',
    i10.problems.some((p) => /语法不过/.test(p) && /orphan\.js/.test(p)), i10.problems.filter((p) => /语法不过/.test(p)).join(' | ') || '（没报）');

  const fails = R.filter((x) => !x).length;
  console.log(`\n自检结果: ${R.length - fails} 通过, ${fails} 失败`);
  process.exit(fails ? 1 : 0);
}

/* ─────────────────────────────── 真跑 ─────────────────────────────── */
(async function main() {
  if (SELFTEST) return selftest();
  const pkg = readJson('package.json');
  const files = listScripts('scripts');
  let docs = '';
  for (const d of DOC_FILES) { try { docs += fs.readFileSync(path.join(ROOT, d), 'utf8'); } catch (e) { /* 缺文档不判失败 */ } }
  let lists = [];
  try { lists = [stripComments(fs.readFileSync(path.join(ROOT, CHECK_LIST), 'utf8'))]; } catch (e) { lists = []; }

  const out = inspect({ scripts: pkg.scripts, files, docs, lists, gitDays: gitLastCommitDays });
  if (!QUIET) {
    console.log(`npm scripts ${out.rows.length} 条 · scripts/*.js ${files.length} 个`);
    if (out.stale.length) {
      console.log('\n最近 14 天没被改动过的脚本（**观察，不判红**——没改不等于没跑）：');
      for (const s of out.stale.slice(0, 14)) console.log(`   ${String(s.days).padStart(3)} 天前  ${s.rel}`);
      if (out.stale.length > 14) console.log(`   …另 ${out.stale.length - 14} 条`);
    }
    if (out.gitMissing) console.log('（git 不可用 ⇒ "多久没动"那一层未采到，不猜）');
  }
  if (out.problems.length) {
    console.log(`\n❌ 发现 ${out.problems.length} 个问题：`);
    for (const p of out.problems) console.log('   · ' + p);
    process.exitCode = 1;
    return;
  }
  console.log('✅ 每条 npm 命令指向的文件都在且语法过；没有"没有任何入口能跑到"的脚本');
})().catch((e) => { console.error('异常：', e); process.exitCode = 1; });
