/* ============================================================================
 * scripts/review-office.js —— 真实 Office 样本回扫（路线图 I8 / C5 的常驻仪表）
 *
 * ▎为什么需要这么一台工具：`test:fileview` 那 240 条断言的输入，全部来自
 *   **我自己写的夹具**（scripts/ooxml-fixture.js）。夹具能覆盖的，就是"我想得到的形状"——
 *   而渲染内核的失败方式从来都是静默的（少一类节点、少一格合并、少一张图，都不报错）。
 *   这与 10-06 那次"规则表与电池同一只手写出来，于是电池只覆盖我想到过的说法"是同一件事
 *   （坑 106），只不过这次的对象是**文档解析器**。
 *
 * ▎★ 2026-10-10（C5）这台仪表从"随便扫 N 份"改成"**按形状类别扫**"：
 *   上一版是"取目录里前 25 份"，而"273 份里 0 抛错"这句话的覆盖面完全看运气——
 *   本机目录里 docx 占九成，于是旧版 .ppt、xlsx 的百分比格式、pptx 备注页、坏 ZIP
 *   这些**曾经真的错过**的形状，可能一份都没被扫到，而报告读起来一模一样是"通过"。
 *   现在每个类别各至少一份：**某一类一份都没扫到 ⇒ 报 SKIP（并让退出码为 1），不报"没问题"**；
 *   某一类本机没有真文件 ⇒ 用仓库里的夹具顶一份，并在报告里**明写"这是夹具，不是用户文件"**
 *   （夹具顶上的类别只能证明"内核认得这个形状"，不能证明"用户那份文件没问题"）。
 *
 * ▎它做什么：找真实的 .docx / .xlsx / .pptx / .doc / .xls / .ppt，按形状分类各挑一份，
 *   逐个喂给渲染内核，只报**结构统计**（页数/段数/格数/图数/字符数/HTML 体积/耗时/抛错原因）。
 *   ▸ 隐私：它不打印、不上传任何文档内容，也不写任何文件——
 *     会议材料里可能有工资表，一台"顺手把内容打出来"的工具是不能进仓库的。
 *   ▸ 文件名只打 basename，整条含中文的路径不进日志。
 *
 * ▎跑法：
 *   npm run review:office                      # 默认扫这几个常见目录（存在才扫）
 *   npm run review:office -- --dir D:\\工作文件  # 指定目录（可重复给多个 --dir）
 *   npm run review:office -- --max 30           # 最多渲染多少份（默认 25）
 *   npm run review:office -- --probe 600         # 最多"看一眼"多少个候选（只读字节分类，不渲染）
 *   npm run review:office -- --selftest        # 自检这台仪表自己（用仓库里的夹具，不碰任何真实文件）
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const FV = require(path.join(__dirname, '..', 'sfu', 'public', 'fileview.js'));
/* ★ 2026-10-10（C5）类别清单与分类判据在 office-shapes.js：回扫（这台）与
 *   check:files 的 REAL_OFFICE_DIR 模式**共用一份**——两处各写一份"什么算同一类形状"，
 *   下次就会有一处报"覆盖了"而另一处报"没有"（坑 47）。 */
const Shapes = require('./office-shapes.js');
const { CLASSES, classify, coverageLines, selectByCategory, readFix } = Shapes;

const args = process.argv.slice(2);
const argOf = (name, dft) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dft; };
const DIRS = (() => {
  const given = [];
  for (let i = 0; i < args.length; i++) if (args[i] === '--dir' && args[i + 1]) given.push(args[i + 1]);
  if (given.length) return given;
  const home = require('os').homedir();
  return [
    path.join(home, 'Desktop'), path.join(home, 'Downloads'), path.join(home, 'Documents'),
    path.join(home, 'WPS Drive'), 'D:\\',
  ];
})();
const MAX_FILES = Math.max(1, Number(argOf('--max', 25)) || 25);
/* ★ C5：分类阶段"只看字节"的候选上限。它和 --max 是两件事：
 *   --max 管"渲染几份"（贵，每份要解析），--probe 管"为了凑齐九类形状允许读多少份的头部"（便宜）。
 *   两者分开是因为**覆盖面靠挑样本来，不靠渲染数量**——渲染 300 份同形状的 docx
 *   也不会让"旧版 .ppt"这一类多出一次证据。 */
const PROBE_MAX = Math.max(MAX_FILES, Number(argOf('--probe', 400)) || 400);
/* 分类阶段愿意整读的最大文件（MB）：见主循环里那条注释——不能只读头部。 */
const PROBE_MAX_MB = Math.max(1, Number(argOf('--probe-mb', 12)) || 12);
const MAX_DEPTH = Number(argOf('--depth', 3)) || 3;
const EXT = new Set(['.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt']);
/* ★ 2026-10-09（J2）把旧格式纳入回扫：用户机器上要共享的文件里 .doc/.xls 占了一大块，
 *   而这台仪表原本只看 docx/xlsx/pptx —— 于是"真实样本 0 抛错"这句话压根没覆盖到那批文件。
 *   判据覆盖不到的地方，结论就不许延伸到那里（坑 105 同一条）。 */
/* 单份上限：超过就不解析（与生产同一道保险丝，别在这台工具上假装"我什么都能读"） */
const MAX_BYTES = FV.MAX_PARSE_BYTES || 40 * 1024 * 1024;
const SELFTEST = args.indexOf('--selftest') >= 0;

/* ── 自检：这台量具自己必须能红 ──────────────────────────────────────
 * ▎为什么一台"只报统计"的工具也要自检：它最容易长的两种坏账都是**沉默**的——
 *   ① 目录过滤器写错一位（10-06 那次 `slice(-12,-6)`）⇒ 永远筛出 0 份，
 *      而它报"没找到样本"，听起来完全合理；
 *   ② 渲染出错了却被 catch 成一行字 ⇒ 汇总说"0 抛错"，而那个 0 是"没跑到"。
 *   所以这里用**自己造的夹具**跑一遍（夹具在 scripts/ooxml-fixture.js，零外部输入），
 *   两条都必须成立：有夹具时报"1 份、0 抛错"；空目录时报 ❔ 而不是"没问题"。 */
async function selftest() {
  const os = require('os');
  const FX = require('./ooxml-fixture.js');
  const Z = { inflateRaw: (u) => new Uint8Array(zlib.inflateRawSync(Buffer.from(u.buffer, u.byteOffset, u.byteLength))) };
  let ok = 0; let bad = 0;
  const yes = (name, cond, extra) => {
    if (cond) { ok++; console.log('  PASS  ' + name); }
    else { bad++; console.log('  FAIL  ' + name + (extra ? ' — ' + extra : '')); }
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfu-office-sweep-'));
  try {
    fs.writeFileSync(path.join(dir, '一份真形状.docx'), FX.makeDocx({ vMerge: true }));
    const found = [];
    find(dir, 0, found, MAX_FILES);
    yes('夹具能被找出来（目录过滤器没写错）', found.length === 1, found.join(','));
    const r = await FV.render('一份真形状.docx', new Uint8Array(fs.readFileSync(path.join(dir, '一份真形状.docx'))), Z);
    const sh = shape(r.html);
    yes('渲染出结构且合并格在（这台仪表看得见"格"这一层）',
      sh.tables === 3 && sh.cells >= 10, JSON.stringify(sh));   // 夹具现在有三张表：基础 / vMerge / gridSpan+vMerge 混用
    /* ▸ 这里原先写的是 `yes('抛错数在无错样本上是 0', true)` —— 一条**永真断言**，
     *   看着像在检查，实际什么都没检查（坑 95/110 同一族，这次栽在我刚写的自检里）。
     *   换成一件真的能红的事："提出文字"那一栏必须不是恒 0，
     *   否则这台仪表对任何文档都会报"文字极少=0"，等于没有那一栏。 */
    yes('结构统计不是恒 0（"提出文字"那一栏真的量到了东西）', sh.textChars > 20, JSON.stringify(sh));
    /* 反向对照：把同一份文件**截断一半**（留着 .docx 的名字与 ZIP 头，砍掉中央目录）——
     * 内核必须抛错。没有这条，"抛错 0"这一栏就永远读不出任何信息（坑 105：仪表必须能红）。 */
    let errs = 0;
    const whole = new Uint8Array(fs.readFileSync(path.join(dir, '一份真形状.docx')));
    try { await FV.render('一份真形状.docx', whole.slice(0, Math.floor(whole.length / 2)), Z); }
    catch (e) { errs = 1; }
    yes('反向对照：截断后的同一份文件必须抛错（否则"0 抛错"是白给的）', errs === 1);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'sfu-office-empty-'));
    const none = [];
    find(empty, 0, none, MAX_FILES);
    yes('空目录报"没有样本"而不是"没问题"（found=0 走 unknown 分支）', none.length === 0);
    fs.rmSync(empty, { recursive: true, force: true });

    /* ★ 2026-10-10（B5）三件新事情各有自己的正/反向对照——
     *   没有反向对照的仪表读数只是一个装饰（坑 115：一条常绿的断言可以保护一个错的期望）。 */
    const nested = await FV.render('嵌套.docx', FX.makeDocx({ nested: true }), Z);
    const nsh = shape(nested.html);
    yes('B5 深度量具看得见真嵌套（表里套表再套表 ⇒ depth ≥ 3，且最里层那三个字在页面上）',
      nsh.depth >= 3 && nsh.tables >= 4 && /最里层/.test(nested.html), JSON.stringify(nsh));
    /* 反向对照：同一台量具量**没有**嵌套的那份必须读回 1。
     * 没有这一条，depth 可能因为扫描正则写错而恒为 0/恒为很大，而"≥3"那条照样绿。 */
    yes('B5 深度量具能读出 1（平铺的那份不许被读成嵌套；量具读不出 0 就不许报"在"）',
      shape(await FV.render('一份真形状.docx', FX.makeDocx({}), Z).then((x) => x.html)).depth === 1,
      String(shape(await FV.render('一份真形状.docx', FX.makeDocx({}), Z).then((x) => x.html)).depth));
    /* 「以图为主」与「可疑」分栏：把同一句"文字极少"报成两个不同原因，
     * 判错方向会让人去查一个没坏的内核容器（本轮真实回扫 11 份里 10 份是截图作业）。 */
    yes('B5 分栏判据：有图而字少算"以图为主"，不进可疑那一栏（普查过：这批语料没有"字全在 DrawingML"那种）',
      classifyThin({ textChars: 36, imgs: 25, placeholders: 0 }, 2058 * 1024) === 'image-led'
      && classifyThin({ textChars: 6, imgs: 2, placeholders: 0 }, 133 * 1024) === 'image-led');
    yes('B5 分栏判据：字少、一张图都没有、文件不小 ⇒ 才算可疑（这条反向不许一起松掉）',
      classifyThin({ textChars: 36, imgs: 0, placeholders: 0 }, 2058 * 1024) === 'suspicious'
      && classifyThin({ textChars: 5000, imgs: 0, placeholders: 0 }, 2058 * 1024) === 'ok');
    yes('B5 抛错分类：截断的 ZIP 算"输入坏了"，不算内核 bug',
      classifyErr('不是合法的 ZIP（找不到中央目录结尾记录）') === 'broken-input'
      && classifyErr('Cannot read properties of undefined (reading "tag")') === 'kernel');

    /* ═══ C5 组：类别探针 + 覆盖表 ═══
     *   ▸ 这组测的是这台仪表**新长出来的那一半**：分类判据与夹具兜底。
     *     判据与兜底用同一批字节（都走 CLASSES[i].fix()），所以"探针认不出自己的夹具"
     *     这种错会当场红——那正是最坏的一种：报告说这一类覆盖了，其实一次都没扫到（坑 76）。 */
    for (const c of CLASSES) {
      let f = null; let err = null;
      try { f = c.fix(); } catch (e) { err = String(e && e.message || e).slice(0, 70); }
      yes(`C5 类别「${c.id}」的夹具拿得出来（兜底不是空话）`, !!f, err || '');
      if (!f) continue;
      const got = await classify(f.name || f.p, f.bytes);
      yes(`C5 类别「${c.id}」：分类判据认得出自己那份（判据与兜底同源，认不出就红）`, got === c.id, `判据给的是 ${got}`);
    }
    /* 反向对照：普通 docx/xlsx/pptx 一份都不许被上面那些判据认成"特别形状"。
     *   没有这一组，`w:tbl` 的嵌套深度写成恒 ≥2、formatCode 正则写成 .* 之类都会一路全绿，
     *   而"九类全覆盖"这句话就变成了一句装饰（坑 115：断言可以正确地保护一个错的期望）。 */
    const FX2 = require('./ooxml-fixture.js');
    yes('C5 反向：普通 docx 不算嵌套、不算坏 ZIP', await classify('plain.docx', FX2.makeDocx({})) === 'docx');
    yes('C5 反向：普通 xlsx 没百分号/币符 ⇒ 不进"百分比/货币"这一类', await classify('plain.xlsx', FX2.makeXlsx({})) === 'xlsx');
    yes('C5 反向：普通 pptx 没备注页 ⇒ 不进"备注页"这一类', await classify('plain.pptx', FX2.makePptx({})) === 'pptx');
    yes('C5 反向：带 money 的那份必须**只**被认成百分比/货币（多一格少一格都不行）',
      await classify('money.xlsx', FX2.makeXlsx({ money: true })) === 'xlsx-numfmt');
    /* 覆盖表三种状态分得开，并且 ❔ 那一行不许出现"通过/没问题"这种字样（坑 105）。 */
    const covCounts = { 'legacy-doc': 3 };
    const covA = coverageLines(covCounts, new Set(['pptx-notes']));
    const lineOf = (cov, id) => (cov.find((l) => l.id === id) || {}).text || '';
    yes('C5 覆盖表：真文件 3 份 ⇒ ✅ 并写出份数',
      (covA.find((l) => l.id === 'legacy-doc') || {}).mark === '✅' && /真文件 3 份/.test(lineOf(covA, 'legacy-doc')), lineOf(covA, 'legacy-doc'));
    yes('C5 覆盖表：只有夹具 ⇒ ⚠️ 且明说"不证明用户那份没问题"',
      (covA.find((l) => l.id === 'pptx-notes') || {}).mark === '⚠️' && /夹具/.test(lineOf(covA, 'pptx-notes')), lineOf(covA, 'pptx-notes'));
    yes('C5 覆盖表：两者都没有 ⇒ ❔ 且文本明说"既没有真文件、夹具也拿不出来"（不许用一个空 ✅ 糊过去）',
      (covA.find((l) => l.id === 'legacy-ppt') || {}).mark === '❔'
      && /^SKIP/.test(lineOf(covA, 'legacy-ppt'))
      && /既没有真文件/.test(lineOf(covA, 'legacy-ppt')), lineOf(covA, 'legacy-ppt'));
    /* ★ 这一条才是坑 105 的真判据。原先我写的是"文本里不许出现『没问题/通过』这两个字"——
     *   结果它把自己那句解释（"这句话不是『没问题』"）判红了：**禁止字面的断言会把说明本身变成假红**
     *   （坑 91 那条"假要求的断言 = 假红制造机"换个载体复发）。
     *   真正要钉的不是措辞，是**记号**：没有样本的那一类永远不许拿到 ✅。 */
    yes('C5 反向：real=0 的类别永远拿不到 ✅（"没证据"与"通过"必须是两个不同的记号）',
      covA.every((l) => (l.mark === '✅' ? (covCounts[l.id] || 0) > 0 : true)),
      JSON.stringify(covA.filter((l) => l.mark === '✅').map((l) => l.id)));
    /* 数量哨兵：类别清单被删到 9 项以下时，"覆盖 9/9"这句话就不再等于覆盖了什么。 */
    yes('C5 类别清单仍是 9 项（少一类就是少一块证据，别让它在无声中缩水）', CLASSES.length === 9, String(CLASSES.length));

    /* ═══ P 组：selectByCategory（两个消费者共用的取样器；check:files 的 REAL_OFFICE_DIR 也走它）═══
     *   ▸ 磁盘与网络都不进来：readBytes / statSize 全部注入，测的是**取样逻辑**本身
     *     （否则这条自检会变成"看本机目录里恰好有什么"，明天换台机器结论就变，坑 72 同族）。 */
    const FX3 = require('./ooxml-fixture.js');
    const fakeBytes = {
      'D:/a/plain.docx': FX3.makeDocx({}),
      'D:/a/带备注.pptx': FX3.makePptx({ notes: true }),
      'D:/a/真旧版.doc': readFix('legacy/legacy.doc').bytes,
    };
    const fakeOpt = {
      probeMax: 50, probeMaxMb: 12, extraMax: 12,
      statSize: (p) => (fakeBytes[p] ? 4096 : 0),
      readBytes: (p) => fakeBytes[p],
    };
    const p1 = await selectByCategory(Object.keys(fakeBytes), fakeOpt);
    yes('P1 三类真样本各认出来（备注页 / 旧版 doc / 普通 docx 不进类别）',
      p1.counts['pptx-notes'] === 1 && p1.counts['legacy-doc'] === 1 && p1.counts.docx === 1,
      JSON.stringify(p1.counts));
    /* 契约要说准：**九类各一份（真样本优先）**，剩余名额才给"随手扫的余量"。
     *   第一版我把它写成 `queue.length === 9`，而实跑是 10——那份多出来的 plain.docx 是
     *   extraMax=12 允许的第 1 个余量，行为是对的、我把它写成了错的期望（坑 115 的反向版本：
     *   断言保护了一个没想清楚的数）。现在分开数：类别样本 / 夹具兜底 / 余量。 */
    yes('P2 队列 = 九类各一份（2 真 + 7 夹具兜底），第 4 份文件作为余量补到 10',
      p1.queue.filter((q) => !q.fixture && Shapes.REQ.has(q.id)).length === 2
      && p1.queue.filter((q) => q.fixture).length === 7
      && p1.queue.filter((q) => !Shapes.REQ.has(q.id)).length === 1
      && p1.usedFixture.size === 7,
      `queue=${p1.queue.length} 真类别样=${p1.queue.filter((q) => !q.fixture && Shapes.REQ.has(q.id)).length} 夹具=${p1.usedFixture.size} 余量=${p1.queue.filter((q) => !Shapes.REQ.has(q.id)).length}`);

    /* 类别样本**不被 --max 挤掉**：上限只约束"随手扫的余量"。
     *   挤掉的后果是让报告看起来"覆盖 9/9"，实际只渲染了 4 份——覆盖面被数量上限偷偷改动。 */
    const p2 = await selectByCategory(Object.keys(fakeBytes), Object.assign({}, fakeOpt, { extraMax: 3 }));
    yes('P3 反向对照：余量上限调到 3 也仍然渲染满九类（类别优先，上限只管余量）',
      p2.queue.length === 9, String(p2.queue.length));
    /* 零样本 ⇒ 九类全部 ⚠️夹具，且**没有一条 ✅**（这就是"没量到"与"通过"分开的那个记号）。 */
    const p3 = await selectByCategory([], fakeOpt);
    const covEmpty = coverageLines(p3.counts, p3.usedFixture);
    yes('P4 零真文件 ⇒ 九类都是 ⚠️夹具、零 ✅（报告必须一眼看出这轮没有用户文件）',
      covEmpty.every((l) => l.mark === '⚠️') && p3.probed === 0, JSON.stringify(covEmpty.map((l) => l.mark)));
    /* 夹具也拿不出来（仓库缺件）⇒ ❔SKIP，且这条要能让退出码变红（主循环里 skipped>0 ⇒ 1）。
     *   ▸ 这里改的是**共享数组里的一个元素**，所以必须 try/finally 复位——
     *     漏复位的后果不是这一条红，是"以后每次跑都少一类"（自己埋的坑，坑 72 的自检版）。 */
    const saveFix = CLASSES[2].fix;
    let p4; let covMiss;
    try {
      CLASSES[2].fix = () => { throw new Error('夹具被移走（A/B 注入）'); };
      p4 = await selectByCategory([], fakeOpt);
      covMiss = coverageLines(p4.counts, p4.usedFixture);
    } finally {
      CLASSES[2].fix = saveFix;
    }
    yes('P5 夹具也缺 ⇒ 该类落 ❔SKIP（这条就是退出码 1 的那一支）',
      (covMiss.find((l) => l.id === 'legacy-ppt') || {}).mark === '❔'
      && p4.fixtureFailed.length === 1 && /夹具被移走/.test(p4.fixtureFailed[0].why),
      JSON.stringify(p4.fixtureFailed));
    yes('P6 反向对照：夹具复位之后同一批输入不再报缺件（漏复位=以后每次都少一类）',
      coverageLines((await selectByCategory([], fakeOpt)).counts, new Set(CLASSES.map((c) => c.id)))
        .every((l) => l.mark !== '❔'));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 临时目录删不掉不影响结论 */ }
  }
  console.log(`\n自检结果: ${ok} 通过, ${bad} 失败`);
  process.exit(bad ? 1 : 0);
}
const SKIP_DIR = /node_modules|\.git|appdata|\$recycle\.bin|program files|programdata|^models$/i;

/** 收集候选路径。cap 由调用方给：**候选上限不等于渲染上限**（C5 的关键区分）——
 *   找齐九个形状需要"多看几眼"，而真渲染仍然只跑 --max 份。
 *   上一版是拿 --max 当候选上限，于是"看 8 份、认出 8 份里恰好没有 .xls"这种结果
 *   其实是"我只翻了 8 份"，而报告读起来像"这台机器上没有 .xls"（坑 105 的分母版）。 */
function find(dir, depth, out, cap) {
  if (depth > MAX_DEPTH || out.length >= cap) return out;
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    if (out.length >= cap) break;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIR.test(e.name)) continue;
      find(p, depth + 1, out, cap);
      continue;
    }
    if (!EXT.has(path.extname(e.name).toLowerCase())) continue;
    let st;
    try { st = fs.statSync(p); } catch (e) { continue; }
    if (st.size < 1024 || st.size > MAX_BYTES) continue;
    out.push(p);
  }
  return out;
}

/* 只统计结构，不看内容 */
/* ★ 2026-10-10（B5）表格嵌套深度：用**栈扫描**数"同时打开的 <table>"，而不是正则找
 *   "td 里套 table"——内核把每张表包在 `<div class="fv-tblwrap">` 里，而**首行**的单元格
 *   渲染成 `<th>`（Word 的表头行语义），所以"<td…><table"那种写法量不到真实的嵌套（我第一版就是）。
 *   深度这件事值得单独量：它是"内层被整片丢掉"唯一的可见信号——
 *   表数与格数在"只画外层"的实现下照样好看。 */
function maxTableDepth(html) {
  const re = /<(\/?)table\b/g;
  let d = 0; let max = 0; let m;
  while ((m = re.exec(html))) {
    if (m[1]) { if (d > 0) d--; } else { d++; if (d > max) max = d; }
  }
  return max;
}
/* ★ 2026-10-10（B5）"文字极少"这一栏原来把两种完全不同的东西混在一起报，
 *   而报的原因那句"可能是内核漏了某类容器"对**十一份里的十份都是错的**：
 *   真实回扫里那 11 份字少的文件，几乎每一份都是 图=6~25 的截图作业（文件大是因为图片，不是因为文字）。
 *   判据说错了比没有判据更糟——它会把人支去查一个不存在的地方（坑 105/125 同一条：
 *   "这格式画不了"与"预算不够被裁"不许进同一个计数，这里同理）。 */
function classifyThin(s, sizeBytes) {
  if (!(s.textChars < 80 && sizeBytes > 20 * 1024)) return 'ok';
  /* ▸ 为什么"有一张图"就够把它归到"以图为主"：这不是拍脑袋放宽，是**一次性普查给的依据**——
     本机 77 份"渲染出来几乎没字"的真实 docx 里，"字全部住在 DrawingML/ SmartArt 而内核只看 w:t"
     这种形状 = **0 份**；剩下的每一份都有嵌入图片（截图作业、扫描件）。
     所以这批语料里，"字少 + 有图"的最省解释就是它本来就是图片，而不是内核漏了一类容器。
     下次如果真人语料里出现"字少、一张图都没有、段落却很多"，那才是这条判据该红的时候。 */
  if (s.imgs >= 1 || s.placeholders >= 1) return 'image-led';   // 以图为主：正常，这份文件本来就是图片
  return 'suspicious';                                          // 字少、图也没有、文件不小：这才是要点开看的
}
/* 抛错也分两类：**输入本身坏了**（截断、加密、改名）与**内核抛错**（我们的 bug）。
 * 混在一起的后果是"273 份里 1 份抛错"这句话读起来像内核有 1 个 bug，而实际是那份文件不是合法 ZIP。 */
function classifyErr(msg) {
  const m = String(msg || '');
  return /不是合法的 ZIP|中央目录|加密|损坏|截断/.test(m) ? 'broken-input' : 'kernel';
}

function shape(html) {
  const strip = String(html).replace(/<[^>]*>/g, '');
  return {
    tables: (html.match(/<table/g) || []).length,
    cells: (html.match(/<t[dh][\s>]/g) || []).length,
    imgs: (html.match(/<img/g) || []).length,
    slides: (html.match(/class="fv-slide"/g) || []).length,
    placeholders: (html.match(/〔图片〕/g) || []).length,
    noteSkipped: /fv-note-imgs/.test(html),
    depth: maxTableDepth(html),
    textChars: strip.replace(/\s+/g, '').length,
  };
}

(async () => {
  if (SELFTEST) return selftest();
  const cands = [];
  for (const d of DIRS) if (fs.existsSync(d)) find(d, 0, cands, PROBE_MAX);
  console.log(`\n═══ 真实 Office 样本回扫（I8 + C5 按类别覆盖）═══`);
  console.log(`扫描目录：${DIRS.filter((d) => fs.existsSync(d)).join('  ') || '（一个都不存在）'}`);
  console.log(`候选文件 ${cands.length} 份（docx/xlsx/pptx + 旧版 doc/xls/ppt；深度 ${MAX_DEPTH}）`
    + ` · 只看字节分类的上限 ${PROBE_MAX} 份 · 实际渲染上限 ${MAX_FILES} 份\n`);
  if (!cands.length) {
    console.log('❔ 一份真文件都没找到 —— 下面所有类别都会由夹具顶上，那份"覆盖"只到"内核认得这些形状"，');
    console.log('   离"你手头那些文件渲染得出来"还差一整步（坑 105：没有证据时既不许报通过，也不许报失败）。');
    console.log('   想让它有用：把你手头真文件所在目录传进来 —— npm run review:office -- --dir D:\\工作文件\n');
  }

  /* ── 第一+二+三阶段：按类别挑样本、缺的类别用夹具顶、剩余名额给随手扫的 ──
   *   判据与类别清单都在 scripts/office-shapes.js（与 check:files 的 REAL_OFFICE_DIR 同一份，
   *   两份清单迟早漂成两个答案——坑 47）。 */
  const sel = await selectByCategory(cands, {
    probeMax: PROBE_MAX, probeMaxMb: PROBE_MAX_MB, extraMax: MAX_FILES,
  });
  const { counts, usedFixture, queue, probed, skippedBig } = sel;
  const fixtureFailed = sel.fixtureFailed.map((f) => `${f.cn}：${f.why}`);

  const Z = { inflateRaw: (u) => new Uint8Array(zlib.inflateRawSync(Buffer.from(u.buffer, u.byteOffset, u.byteLength))) };
  let bad = 0; let thin = 0;
  const rows = [];
  console.log('── 逐份结果（按类别挑出来的样本）──');
  for (const q of queue) {
    const bytes = q.bytes || new Uint8Array(fs.readFileSync(q.p));
    const t0 = Date.now();
    /* 文件名只打 basename（含中文的路径整条打出来，等于把别人的目录结构写进日志） */
    const label = q.name || path.basename(q.p);
    const tag = `[${q.id}${q.fixture ? '·夹具' : ''}]`;
    try {
      const r = await FV.render(label, bytes, Z);
      const s = shape(r.html);
      const m = r.meta || {};
      rows.push({
        label, tag, ok: true, kind: m.kind, ms: Date.now() - t0,
        size: bytes.length, html: r.html.length, s, fixture: !!q.fixture,
        n: m.slides !== undefined ? m.slides : (m.paragraphs !== undefined ? m.paragraphs : (m.rows !== undefined ? m.rows : 0)),
        skipped: m.imagesSkipped || 0,
        /* 旧格式走"抽文字"那条路：meta 里带 legacy/via/unsupported，报告要如实分开 */
        legacy: m.legacy || '', via: m.via || '', unsupported: !!m.unsupported,
      });
    } catch (e) {
      /* 计数**不在这里做**：坏在哪一类要到报告时才判得清（classifyErr），
       * 在这儿先 bad++ 再在报告里 bad++ 就是把同一个错数两遍（我第一版就是这样，
       * 而"数两遍"比"少数一遍"更难发现——汇总那行看着完全正常）。 */
      rows.push({ label, tag, ok: false, ms: Date.now() - t0, size: bytes.length, fixture: !!q.fixture, err: String((e && e.message) || e).slice(0, 130) });
    }
  }
  let imageLed = 0;   // 以图为主（正常，不该和"可疑"混在一栏）
  let inputBad = 0;   // 输入本身坏了（不是内核的 bug）
  for (const r of rows) {
    if (!r.ok) {
      const ec = classifyErr(r.err);
      if (ec === 'broken-input') inputBad++; else bad++;
      /* 「坏 ZIP」这一类**本来就该抛错**（它测的是"输入坏了时报错说得清吗"），
       *   所以它的错不记进 bad——记进去就等于自己造一条假的产品缺陷（坑 105/123 同族：
       *   一条断言/计数只能问一件真的事）。但它必须被看见，所以单独打一行。 */
      const expected = r.tag === '[broken-zip]' || r.tag === '[broken-zip·夹具]';
      console.log(`  ${ec === 'broken-input' ? '⚠️' : '❌'} ${r.tag} ${r.label}${expected ? '  ← 这一类**故意是坏的**，抛错就是它要的结果' : ''}`);
      console.log(`       ${ec === 'broken-input' ? '读不了这份文件（输入侧：损坏/截断/加密/改名）——界面会明说读不了' : '内核抛错（这才是要修的）：' + r.err}`);
      continue;
    }
    /* 旧格式抽不出文字时内核不抛错，但必须单列 —— 这正是用户会报的那种"看不了"，
       而这边一声不响就等于没有那一栏（坑 76：机制没触发时要能看见）。 */
    if (r.unsupported) {
      thin++;
      console.log(`  ! ${r.tag} [${r.kind}] ${r.label}`);
      console.log(`       没能抽出文字（多半是加密、损坏，或不是 Office 用这个外壳存的别的程序）—— 界面会退回"请下载"那段话`);
      continue;
    }
    const s = r.s;
    console.log(`  ✅ ${r.tag} [${r.kind}${r.legacy ? ":" + r.legacy + "/" + r.via : ""}] ${r.label}`);
    console.log(`       文件 ${(r.size / 1024).toFixed(0)}KB → HTML ${(r.html / 1048576).toFixed(2)}MB · ${r.ms}ms`
      + ` · 页/段/行=${r.n} 表=${s.tables} 格=${s.cells} 嵌套深=${s.depth} 图=${s.imgs}(占位 ${s.placeholders}${r.skipped ? ` · 被预算裁掉 ${r.skipped}` : ''})`
      + ` · 提出文字 ${s.textChars} 字`);
    /* "成功但几乎没有文字"是要人看的一栏：内核没抛错，可用户看到的是白页。
     *   ▸ 但**图多的那份不算**（见 classifyThin 的注释）——报错了原因，人就照着错方向查。
     *   ▸ 夹具不算：最小夹具本来就只写十几个字，报"字少可疑"是把量具的构造说成产品的缺陷。 */
    const cls = classifyThin(s, r.size);
    if (r.fixture) { /* 夹具只看"渲染出来了没有"， Thin/以图为主 两栏都不进 */ }
    else if (cls === 'image-led') { imageLed++; console.log('       ℹ️ 文字少但图多：这份本来就是截图/扫描件，不算可疑'); }
    else if (cls === 'suspicious') { thin++; console.log('       ⚠️ 字少、图也少、文件不小——内核可能漏了某类容器，值得点开看看'); }
  }

  /* ── 第四阶段：类别覆盖表（C5 要的那一行——"扫到了什么形状"，不是"扫了几份"） ── */
  console.log('\n── 类别覆盖（这才是"0 抛错"这句话的适用范围）──');
  const cov = coverageLines(counts, usedFixture);
  for (const l of cov) console.log(`  ${l.mark} ${l.cn.padEnd(34, '　')} ${l.text}`);
  const skipped = cov.filter((l) => l.mark === '❔').length;
  const coveredByReal = cov.filter((l) => l.mark === '✅').length;
  const nFix = rows.filter((r) => r.fixture).length;
  const capped = queue.length >= MAX_FILES ? `（渲染到上限 ${MAX_FILES} 份）` : '';
  console.log(`\n小结：真读了 ${probed} 份真文件的字节做分类${skippedBig ? `（另有 ${skippedBig} 份超过 ${PROBE_MAX_MB}MB 没看——"某一类没扫到"可能只是"太大没读"，别把它读成"这台机器上没有"）` : ''}`
    + ` · 渲染 ${rows.length} 份（真文件 ${rows.length - nFix} · 夹具 ${nFix}）· `
    + `内核抛错 ${bad} · 输入坏了 ${inputBad} · "可疑(字少图也少/抽不出)" ${thin} · 以图为主 ${imageLed} ${capped}`);
  console.log(`类别覆盖 ${cov.length - skipped}/${cov.length}`
    + `（其中 **${coveredByReal} 类有真文件**、${cov.length - skipped - coveredByReal} 类只有夹具`
    + `${skipped ? `、${skipped} 类彻底没样本 = SKIP` : ''}）`);
  if (!cands.length) console.log('   ▸ 本轮**零真文件**：上面所有"覆盖"都是夹具给的，只证明内核认得这些形状。');
  if (fixtureFailed.length) console.log('   ▸ 有类别连夹具都没拿出来：\n     - ' + fixtureFailed.join('\n     - '));
  console.log('（这台仪表只报结构，不读内容。发现可疑的那一份，再单独拿它去加夹具 + 断言。）');
  /* 退出码：内核真抛错 或 有类别彻底没样本 ⇒ 红。
   *   ▸ "输入坏了"不红（那是用户文件的问题，界面会明说读不了）；
   *   ▸ 只有夹具不算红（那是本机没语料，不是仪器坏了）——但报告里必须看得见它只有夹具。 */
  process.exitCode = (bad > 0 || skipped > 0) ? 1 : 0;
})().catch((e) => { console.error('回扫失败：', e && e.stack || e); process.exit(1); });
