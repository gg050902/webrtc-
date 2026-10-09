/* ============================================================================
 * scripts/review-office.js —— 真实 Office 样本回扫（路线图 I8 的常驻仪表）
 *
 * ▎为什么需要这么一台工具：`test:fileview` 那 234 条断言的输入，全部来自
 *   **我自己写的夹具**（scripts/ooxml-fixture.js）。夹具能覆盖的，就是"我想得到的形状"——
 *   而渲染内核的失败方式从来都是静默的（少一类节点、少一格合并、少一张图，都不报错）。
 *   这与 10-06 那次"规则表与电池同一只手写出来，于是电池只覆盖我想到过的说法"是同一件事
 *   （坑 106），只不过这次的对象是**文档解析器**。
 *
 * ▎它做什么：在指定目录里找真实的 .docx / .xlsx / .pptx，逐个喂给渲染内核，
 *   只报**结构统计**（页数/段数/格数/图数/字符数/HTML 体积/耗时/抛错原因）。
 *   ▸ 隐私：它不打印、不上传任何文档内容，也不写任何文件——
 *     会议材料里可能有工资表，一台"顺手把内容打出来"的工具是不能进仓库的。
 *   ▸ 判读：`成功但纯文本极少`（比如 500 字以上却没提出来一个字）与 `抛错` 才是要看的两栏；
 *     "极少"通常意味着内核漏了某类容器（如 w:sdt / VML 图片），那就是下一条夹具 + 断言。
 *
 * ▎跑法：
 *   npm run review:office                      # 默认扫这几个常见目录（存在才扫）
 *   npm run review:office -- --dir D:\\工作文件  # 指定目录（可重复给多个 --dir）
 *   npm run review:office -- --max 30           # 最多扫多少份（默认 25）
 *   npm run review:office -- --selftest        # 自检这台仪表自己（用仓库里的夹具，不碰任何真实文件）
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const FV = require(path.join(__dirname, '..', 'sfu', 'public', 'fileview.js'));

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
    find(dir, 0, found);
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
    find(empty, 0, none);
    yes('空目录报"没有样本"而不是"没问题"（found=0 走 unknown 分支）', none.length === 0);
    fs.rmSync(empty, { recursive: true, force: true });
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 临时目录删不掉不影响结论 */ }
  }
  console.log(`\n自检结果: ${ok} 通过, ${bad} 失败`);
  process.exit(bad ? 1 : 0);
}
const SKIP_DIR = /node_modules|\.git|appdata|\$recycle\.bin|program files|programdata|^models$/i;

function find(dir, depth, out) {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return out;
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    if (out.length >= MAX_FILES) break;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIR.test(e.name)) continue;
      find(p, depth + 1, out);
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
function shape(html) {
  const strip = String(html).replace(/<[^>]*>/g, '');
  return {
    tables: (html.match(/<table/g) || []).length,
    cells: (html.match(/<t[dh][\s>]/g) || []).length,
    imgs: (html.match(/<img/g) || []).length,
    slides: (html.match(/class="fv-slide"/g) || []).length,
    placeholders: (html.match(/〔图片〕/g) || []).length,
    noteSkipped: /fv-note-imgs/.test(html),
    textChars: strip.replace(/\s+/g, '').length,
  };
}

(async () => {
  if (SELFTEST) return selftest();
  const found = [];
  for (const d of DIRS) if (fs.existsSync(d)) find(d, 0, found);
  console.log(`\n═══ 真实 Office 样本回扫（I8）═══`);
  console.log(`扫描目录：${DIRS.filter((d) => fs.existsSync(d)).join('  ') || '（一个都不存在）'}`);
  console.log(`找到 ${found.length} 份候选文件（docx/xlsx/pptx + 旧版 doc/xls/ppt；上限 ${MAX_FILES} 份，深度 ${MAX_DEPTH}）\n`);
  if (!found.length) {
    console.log('❔ 没有样本 —— 这不是"渲染内核没问题"，只是这台仪表今晚没数据（坑 105）。');
    console.log('   想让它有用：把你手头真文件所在目录传进来 —— npm run review:office -- --dir D:\\工作文件');
    process.exit(0);
  }
  const Z = { inflateRaw: (u) => new Uint8Array(zlib.inflateRawSync(Buffer.from(u.buffer, u.byteOffset, u.byteLength))) };
  let bad = 0; let thin = 0;
  const rows = [];
  for (const p of found) {
    const bytes = new Uint8Array(fs.readFileSync(p));
    const t0 = Date.now();
    /* 文件名只打 basename（含中文的路径整条打出来，等于把别人的目录结构写进日志） */
    const label = path.basename(p);
    try {
      const r = await FV.render(label, bytes, Z);
      const s = shape(r.html);
      const m = r.meta || {};
      rows.push({
        label, ok: true, kind: m.kind, ms: Date.now() - t0,
        size: bytes.length, html: r.html.length, s,
        n: m.slides !== undefined ? m.slides : (m.paragraphs !== undefined ? m.paragraphs : (m.rows !== undefined ? m.rows : 0)),
        skipped: m.imagesSkipped || 0,
        /* 旧格式走"抽文字"那条路：meta 里带 legacy/via/unsupported，报告要如实分开 */
        legacy: m.legacy || '', via: m.via || '', unsupported: !!m.unsupported,
      });
    } catch (e) {
      bad++;
      rows.push({ label, ok: false, ms: Date.now() - t0, size: bytes.length, err: String((e && e.message) || e).slice(0, 130) });
    }
  }
  for (const r of rows) {
    if (!r.ok) { console.log(`  ❌ ${r.label}\n       抛错：${r.err}`); continue; }
    /* 旧格式抽不出文字时内核不抛错，但必须单列 —— 这正是用户会报的那种"看不了"，
       而这边一声不响就等于没有那一栏（坑 76：机制没触发时要能看见）。 */
    if (r.unsupported) {
      thin++;
      console.log(`  ! [${r.kind}] ${r.label}`);
      console.log(`       没能抽出文字（多半是加密、损坏，或不是 Office 用这个外壳存的别的程序）—— 界面会退回"请下载"那段话`);
      continue;
    }
    const s = r.s;
    console.log(`  ✅ [${r.kind}${r.legacy ? ":" + r.legacy + "/" + r.via : ""}] ${r.label}`);
    console.log(`       文件 ${(r.size / 1024).toFixed(0)}KB → HTML ${(r.html / 1048576).toFixed(2)}MB · ${r.ms}ms`
      + ` · 页/段/行=${r.n} 表=${s.tables} 格=${s.cells} 图=${s.imgs}(占位 ${s.placeholders}${r.skipped ? ` · 被预算裁掉 ${r.skipped}` : ''})`
      + ` · 提出文字 ${s.textChars} 字`);
    /* "成功但几乎没有文字"是要人看的一栏：内核没抛错，可用户看到的是白页 */
    if (s.textChars < 80 && r.size > 20 * 1024) { thin++; console.log(`       ⚠️ 抽出的文字极少（文件不小）——可能是内核漏了某类容器，值得点开看看`); }
  }
  const capped = found.length >= MAX_FILES ? `（已到上限 ${MAX_FILES} 份，还有更多没扫 —— 想看全用 --max 50）` : '';
  console.log(`\n小结：${rows.length} 份 · 抛错 ${bad} · "文字极少/抽不出" ${thin} ${capped}`);
  console.log('（这台仪表只报结构，不读内容。发现可疑的那一份，再单独拿它去加夹具 + 断言。）');
  process.exit(0);
})().catch((e) => { console.error('回扫失败：', e && e.stack || e); process.exit(1); });
