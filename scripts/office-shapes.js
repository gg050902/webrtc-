/* ============================================================================
 * scripts/office-shapes.js —— Office「形状类别」的唯一清单、分类判据与夹具兜底
 * ============================================================================
 * ▎为什么单独立一个文件（而不是留在 review-office.js 里）：
 *   2026-10-10 C5 要给"真文件回扫"加按类别取样，而**两个**入口都需要同一套类别：
 *     · `npm run review:office`（Node 里过渲染内核，只报结构统计）
 *     · `npm run check:files` 的 `REAL_OFFICE_DIR=` 模式（两个真浏览器里渲染给用户看）
 *   类别清单与判据在两处各写一份，迟早漂成两个答案（坑 47 在这个仓库已经踩过五次，
 *   每次症状都是"两个地方对同一件事说法不同"）。所以这里是一份，两处引用它。
 *
 * ▎为什么"按类别"而不是"按数量"：上一版回扫是"取目录里前 N 份"，
 *   而"273 份里 0 抛错"这句话的覆盖面完全取决于目录里恰好有什么——本机 docx 占九成，
 *   于是旧版 .ppt、xlsx 的百分比格式、pptx 备注页、坏 ZIP 这些**曾经真错过**的形状
 *   可能一份都没被扫到，报告读起来却同样是"通过"。
 *   **样本很多 ≠ 形状都到了**：数量给的是安全感，不是覆盖面（坑 105 的第三种形态）。
 *
 * ▎隐私：这里的分类只看**字节**（magic + ZIP 成员名 + styles.xml 里的格式码），
 *   判据不读正文，调用方也不许把内容打进来。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FV = require(path.join(__dirname, '..', 'sfu', 'public', 'fileview.js'));

const OLE2_MAGIC = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
const FIX_DIR = path.join(__dirname, 'fixtures', 'office');

/** 读仓库里那份夹具（scripts/fixtures/office/ 下那批是**真 Microsoft Office 生成的**）。 */
function readFix(rel) {
  const p = path.join(FIX_DIR, rel);
  return { p, name: path.basename(p), bytes: new Uint8Array(fs.readFileSync(p)) };
}
/** RTF 最小夹具：`\uN` 转义 + `\uc1`（内核按 ucN 回退补字），一句 ASCII + 一个汉字。 */
function rtfFixture() {
  const rtf = '{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1 {\\pard RTF fixture \\u20122? \\par}}';
  return { p: null, name: 'rtf-min.doc', bytes: Buffer.from(rtf, 'latin1') };
}
/** 网页冒充 .doc 的最小夹具（用户从浏览器"另存为 Word 文档"就是这种）。 */
function htmlFixture() {
  const h = '<html><head><meta charset="utf-8"><title>t</title></head><body><h1>HTML fixture</h1><p>第二段</p></body></html>';
  return { p: null, name: 'html-min.doc', bytes: Buffer.from(h, 'utf8') };
}

/* 每一项：id / 人话类别名 / 夹具怎么来（并**如实标注这是谁写的**——
 *   "我写的夹具"能证明内核认得这个形状，证明不了用户那份文件没问题，坑 130）。
 * ▸ 这九个不是凑数：每一条都对应 2026-10-09 那轮 J 档里**真实掉出来过**的缺陷形状
 *   （piece table / BIFF8 / record 树 / RTF 的 GBK 成对 / docx 改名 / 嵌套编号 /
 *    百分比与货币读错数 / 备注页当成观众页 / 坏 ZIP 要说清为什么坏）。 */
const CLASSES = [
  { id: 'legacy-doc', cn: '旧版 Word97 二进制 .doc（piece table）', fix: () => readFix('legacy/legacy.doc'), fixFrom: '真 Word 生成的夹具' },
  { id: 'legacy-xls', cn: '旧版 Excel BIFF8 .xls（SST/RK/MULRK）', fix: () => readFix('legacy/legacy.xls'), fixFrom: '真 Excel 生成的夹具' },
  { id: 'legacy-ppt', cn: '旧版 PowerPoint .ppt（record 树）', fix: () => readFix('legacy/legacy.ppt'), fixFrom: '真 PowerPoint 生成的夹具' },
  { id: 'rtf-in-doc', cn: 'RTF 冒充 .doc（GBK 成对解码）', fix: rtfFixture, fixFrom: '我写的最小夹具' },
  { id: 'html-in-doc', cn: '网页冒充 .doc', fix: htmlFixture, fixFrom: '我写的最小夹具' },
  { id: 'docx-nested', cn: 'docx 表里套表（嵌套深度 ≥2）', fix: () => ({ p: null, name: 'nested.docx', bytes: require('./ooxml-fixture.js').makeDocx({ nested: true }) }), fixFrom: '我写的夹具（另一个 ZIP 实现打包）' },
  { id: 'docx-vml', cn: 'docx 的 VML 图元（w:pict + v:imagedata，旧式图片与矢量线条）', fix: () => ({ p: null, name: 'vml.docx', bytes: require('./ooxml-fixture.js').makeDocx({ vml: true }) }), fixFrom: '我写的夹具（照用户那份真模板的形状做：VML 图片 + 纯线条 + 20 个空段）' },
  { id: 'xlsx-numfmt', cn: 'xlsx 百分比/货币格式（值 + 格式码）', fix: () => ({ p: null, name: 'money.xlsx', bytes: require('./ooxml-fixture.js').makeXlsx({ money: true }) }), fixFrom: '我写的夹具（另一个 ZIP 实现打包）' },
  { id: 'pptx-notes', cn: 'pptx 备注页（notesSlides 不许当观众页）', fix: () => ({ p: null, name: 'notes.pptx', bytes: require('./ooxml-fixture.js').makePptx({ notes: true }) }), fixFrom: '我写的夹具（另一个 ZIP 实现打包）' },
  { id: 'broken-zip', cn: '坏 ZIP（截断：中央目录没了）', fix: () => { const b = require('./ooxml-fixture.js').makeDocx({}); return { p: null, name: 'truncated.docx', bytes: b.slice(0, Math.floor(b.length / 2)) }; }, fixFrom: '我自己截断的夹具（故意坏）' },
];
const REQ = new Set(CLASSES.map((c) => c.id));

function headStr(bytes, n) { return Buffer.from(bytes.slice(0, n)).toString('latin1'); }
function isOle2(bytes) { return OLE2_MAGIC.every((v, i) => bytes[i] === v); }
/** 一段 XML 里某个标签的**最大嵌套层数**（栈扫描，不是"找有没有 `<a><b`"那种写法）。 */
function xmlTagDepth(xml, tag) {
  const re = new RegExp('<(/?)' + tag + '\\b', 'g');
  let d = 0; let max = 0; let m;
  while ((m = re.exec(xml))) { if (m[1]) { if (d > 0) d--; } else { d++; if (d > max) max = d; } }
  return max;
}

/** 只读字节做分类；认不出特别形状的返回基线 id（docx/xlsx/pptx）或说明性的 other-*。 */
async function classify(p, bytes) {
  const ext = path.extname(String(p)).toLowerCase();
  const isLegacyExt = ext === '.doc' || ext === '.xls' || ext === '.ppt';
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isLegacyExt) {
    if (isOle2(bytes)) return ext === '.doc' ? 'legacy-doc' : ext === '.xls' ? 'legacy-xls' : 'legacy-ppt';
    /* docx 改名成 .doc：10-09 用户那批文件里真有这种，内核按**内容**改道（有意例外） */
    if (isZip) { try { const z = FV.openZip(bytes); if (z.has('word/document.xml')) return 'docx-misnamed'; } catch (e) { /* 落到底下的 RTF/HTML 判据 */ } }
    const h = headStr(bytes, 512).replace(/^(?:\xef\xbb\xbf|\xff\xfe|\xfe\xff)?/, '');
    if (/^\s*\{\s*\\rtf/i.test(h)) return 'rtf-in-doc';
    if (/^\s*(<\?xml|<!doctype|<html|<title|<meta)/i.test(h)) return 'html-in-doc';
    return 'other-legacy-shell';
  }
  if (isZip) {
    let zip;
    try { zip = FV.openZip(bytes); } catch (e) { return 'broken-zip'; }
    const names = zip.names();
    if (names.includes('word/document.xml')) {
      const xml = String((await zip.text('word/document.xml')) || '');
      /* VML 优先于"嵌套"：一份用旧式图元的论文模板往往也有表格，而**它踩的是另一条代码路径**
       * （`v:imagedata r:id` vs `a:blip r:embed`）——类别要按"哪条路径没被覆盖"分，不按扩展名分。 */
      if (/<v:imagedata|<w:pict\b/.test(xml)) return 'docx-vml';
      return xmlTagDepth(xml, 'w:tbl') >= 2 ? 'docx-nested' : 'docx';
    }
    if (names.includes('xl/workbook.xml')) {
      const st = String((await zip.text('xl/styles.xml')) || '');
      /* 百分比或货币：格式码里出现 % / 币符。内置日期格式（numFmtId 14~22）**不算**这一类：
       *   日期那一类 10-09 已有断言与真样本，这条要盯的是"值 + 格式码"里最容易**读错数**
       *   的两种（0.25 显示成 0.25 而不是 25.00% 是读错数，不是难看）。 */
      return /formatCode="[^"]*(?:%|[¥$€£])/.test(st) ? 'xlsx-numfmt' : 'xlsx';
    }
    if (names.includes('ppt/presentation.xml')) {
      return names.some((n) => /^ppt\/notesSlides\/notesSlide\d*\.xml$/.test(n)) ? 'pptx-notes' : 'pptx';
    }
    return 'zip-not-office';
  }
  return 'not-office';
}

/**
 * 按类别挑样本：分类阶段"多看几眼"，渲染阶段仍受调用方自己的上限管。
 * ▸ 两个上限必须分开（这是 C5 的关键区分）：拿渲染上限当候选上限时，
 *   "看 8 份、没认出 .xls"会被读成"这台机器上没有 .xls"——分母错了（坑 105 的分母版）。
 * ▸ 分类阶段跳过大件：openZip 要看到尾巴才能判"中央目录在不在"，不能只读头部
 *   （读半截会把好文件误判成 broken-zip，而那正是这一类要报的形状 = 自己造一条假缺陷，坑 126）。
 *   跳过的份数**必须报出来**，否则"没扫到"就永远读成"没有"。
 * @param {string[]} paths 候选文件路径
 * @param {{probeMax?:number, probeMaxMb?:number, extraMax?:number, statSize?:function, readBytes?:function}} [opt]
 */
async function selectByCategory(paths, opt) {
  const o = opt || {};
  const probeMax = o.probeMax || 400;
  const probeMaxMb = o.probeMaxMb || 12;
  const statSize = o.statSize || ((p) => fs.statSync(p).size);
  const readBytes = o.readBytes || ((p) => new Uint8Array(fs.readFileSync(p)));
  const counts = {};
  const picked = new Map();
  const rest = [];
  let probed = 0; let skippedBig = 0; let stoppedEarly = false;
  for (const p of paths) {
    if (probed >= probeMax) break;
    let size = 0;
    try { size = statSize(p); } catch (e) { continue; }
    if (size > probeMaxMb * 1024 * 1024) { skippedBig++; continue; }
    let bytes;
    try { bytes = readBytes(p); } catch (e) { continue; }
    probed++;
    let id = 'classify-error';
    try { id = await classify(p, bytes); } catch (e) { id = 'probe-error'; }
    counts[id] = (counts[id] || 0) + 1;
    if (REQ.has(id) && !picked.has(id)) picked.set(id, { p, name: path.basename(p), bytes, id, fixture: false });
    else rest.push({ p, name: path.basename(p), id });
    if (picked.size === REQ.size) { stoppedEarly = true; break; }
  }
  /* 本机没有真文件的类别 ⇒ 夹具顶一份（拿不出来就留 ❔，绝不静默） */
  const usedFixture = new Set();
  const fixtureFailed = [];
  for (const c of CLASSES) {
    if (picked.has(c.id)) continue;
    try {
      const f = c.fix();
      picked.set(c.id, { p: f.p, name: f.name, bytes: f.bytes, id: c.id, fixture: true });
      usedFixture.add(c.id);
    } catch (e) {
      fixtureFailed.push({ id: c.id, cn: c.cn, why: String((e && e.message) || e).slice(0, 90) });
    }
  }
  const queue = [];
  for (const c of CLASSES) if (picked.has(c.id)) queue.push(picked.get(c.id));
  if (typeof o.extraMax === 'number') {
    for (const r of rest.slice(0, Math.max(0, o.extraMax - queue.length))) {
      queue.push({ p: r.p, name: r.name, bytes: null, id: r.id, fixture: false });
    }
  }
  return { counts, picked, rest, usedFixture, fixtureFailed, queue, probed, skippedBig, stoppedEarly, probeMaxMb };
}

/** 覆盖表：每类"真文件几份 / 用了夹具没有 / 什么都没扫到"。抽成纯函数才可穷举断言。 */
function coverageLines(counts, usedFixture) {
  return CLASSES.map((c) => {
    const real = counts[c.id] || 0;
    if (real > 0) return { id: c.id, cn: c.cn, mark: '✅', text: `真文件 ${real} 份（渲染其中 1 份）` };
    if (usedFixture.has(c.id)) return { id: c.id, cn: c.cn, mark: '⚠️', text: `本机没有真文件 ⇒ 用夹具顶（${c.fixFrom}）——它只证明内核认得这个形状，不证明用户那份没问题` };
    return { id: c.id, cn: c.cn, mark: '❔', text: 'SKIP：这一类既没有真文件、夹具也拿不出来 ⇒ 本报告对这一类没有任何话可说' };
  });
}

module.exports = { CLASSES, REQ, classify, coverageLines, selectByCategory, readFix, xmlTagDepth, isOle2, FIX_DIR };
