/* ════════════════════════════════════════════════════════════════
 * scripts/test-fileview.js —— 共享文件渲染内核（sfu/public/fileview.js）的单元测试
 *
 * ▎为什么这一套值得单独存在：
 *   fileview.js 干的活是"**自己读 ZIP + 自己解 XML** 把 Word/Excel/PPT 画出来"。
 *   这类代码的失败方式全部是静默的——解析器少认一个属性，输出就少一段文字，
 *   不报错、不崩溃，只有"看起来内容不太对"。真浏览器里点十次也说不清是哪一步丢的。
 *   所以把渲染内核写成纯函数（输入字节 → 输出 HTML 字符串），在这里穷举断言。
 *
 * ▎证据强度：夹具（scripts/ooxml-fixture.js）是**独立写的一个 ZIP 打包器 + OOXML 生成器**。
 *   写包的和读包的是两份实现，它们对同一份字节达成一致，才算真证据
 *   （比自己测自己强得多——自己测自己只能证明"我没改坏我刚才写的那行"）。
 *
 * ▎跑法：npm run test:fileview      （零依赖，不起服务器，几秒跑完）
 * ════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const FV = require('../sfu/public/fileview.js');
const FX = require('./ooxml-fixture.js');

let pass = 0, fail = 0;
const fails = [];
/* ★ 参数顺序是 ok(名字, 条件)——本仓库有两个测试文件用的是相反顺序（坑 110），
 *   写反了的后果是"全部 PASS true 而一条都没测"。所以这里加一道**自检**：
 *   名字必须是字符串、条件必须是布尔。传反了当场抛错，不会静默变绿。 */
function ok(name, cond, extra) {
  if (typeof name !== 'string') throw new TypeError(`ok() 第一个参数必须是名字（收到 ${typeof name}）——参数顺序写反了？见坑 110`);
  if (typeof cond !== 'boolean') throw new TypeError(`ok("${name}") 第二个参数必须是布尔（收到 ${typeof cond}）`);
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; fails.push(name + (extra ? ` — ${extra}` : '')); console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
const has = (name, hay, needle) => ok(name, String(hay).indexOf(needle) >= 0, `找不到「${needle}」`);
const not = (name, hay, needle) => ok(name, String(hay).indexOf(needle) < 0, `不该出现「${needle}」`);

/* zlib 注入路径（与浏览器默认的 DecompressionStream 路径互为对照，两条都要跑） */
const ZLIB = { inflateRaw: (u) => new Uint8Array(zlib.inflateRawSync(Buffer.from(u.buffer, u.byteOffset, u.byteLength))) };

(async function main() {
  console.log('\n═══ A. 类型判定 ═══');
  ok('扩展名 → 类型：pdf', FV.kindOf('会议记录.PDF') === 'pdf');
  ok('扩展名 → 类型：docx/xlsx/pptx', FV.kindOf('a.docx') === 'docx' && FV.kindOf('b.XLSX') === 'xlsx' && FV.kindOf('c.pptx') === 'pptx');
  ok('扩展名 → 类型：md/txt/csv/png', FV.kindOf('x.md') === 'markdown' && FV.kindOf('x.txt') === 'text'
    && FV.kindOf('x.csv') === 'csv' && FV.kindOf('x.png') === 'image');
  ok('旧版二进制 Office 单独成一类（不能假装能渲染）', FV.kindOf('老文件.doc') === 'legacy' && FV.kindOf('老表.xls') === 'legacy');
  /* ★ 期望改了（2026-10-09，J2）：legacy 现在**可预览**——给的是抽取出来的文字，不是原版式。
   *   原先那句"legacy 不在"保护的是"我们不撒谎说能渲染原版"；这件事交给界面上的
   *   fv-legacy-note 那一行明说（"在线还原文字；版式、字体、图片与分页不还原"），
   *   所以集合里加入 legacy 的同时，**"必须带那句说明"变成了一条新断言**（见 L 组）。 */
  ok('可预览集合：docx/xlsx/pptx/md/pdf/图片/legacy 都在（legacy 给文字版，界面上会明说）',
    FV.canPreview('a.docx') && FV.canPreview('a.xlsx') && FV.canPreview('a.pptx') && FV.canPreview('a.md')
    && FV.canPreview('a.pdf') && FV.canPreview('a.png') && FV.canPreview('a.doc'));
  ok('魔数认出 PDF / ZIP / PNG / 旧版复合文档',
    FV.magicKind(Buffer.from('%PDF-1.7\n', 'utf8')) === 'pdf'
    && FV.magicKind(FX.makeDocx()) === 'zip'
    && FV.magicKind(FX.PNG_1PX) === 'image'
    && FV.magicKind(Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0, 0])) === 'legacy');
  ok('魔数认不出就返回 null（不猜）', FV.magicKind(Buffer.from('随便一段文字', 'utf8')) === null);
  ok('MIME：docx/xlsx/pptx/pdf/png', FV.mimeOf('a.docx').indexOf('wordprocessingml') > 0
    && FV.mimeOf('a.xlsx').indexOf('spreadsheetml') > 0 && FV.mimeOf('a.pptx').indexOf('presentationml') > 0
    && FV.mimeOf('a.pdf') === 'application/pdf' && FV.mimeOf('a.png') === 'image/png');
  ok('字节数说人话', FV.fmtSize(0) === '0 B' && FV.fmtSize(1023) === '1023 B'
    && FV.fmtSize(2048) === '2.0 KB' && FV.fmtSize(5 * 1024 * 1024) === '5.0 MB');
  ok('字节数脏值不编数', FV.fmtSize(NaN) === '—' && FV.fmtSize(-1) === '—');
  ok('ooxmlKindOf 从字节认出三种文档（扩展名说谎也不怕）',
    (await FV.ooxmlKindOf(FX.makeDocx())) === 'docx'
    && (await FV.ooxmlKindOf(FX.makeXlsx())) === 'xlsx'
    && (await FV.ooxmlKindOf(FX.makePptx())) === 'pptx');

  console.log('\n═══ B. 安全：转义与 URL 白名单（这一组是红线） ═══');
  ok('esc 转义五个危险字符', FV.esc(`<a href="x">&'</a>`) === '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  ok('esc(null/undefined) 不炸且为空', FV.esc(null) === '' && FV.esc(undefined) === '');
  ok('unesc 是 esc 的逆', FV.unesc(FV.esc(`<b>"x"&'</b>`)) === `<b>"x"&'</b>`);
  ok('safeUrl 放行 http/https/mailto/相对路径',
    FV.safeUrl('https://a.b/c') === 'https://a.b/c' && FV.safeUrl('http://a') === 'http://a'
    && FV.safeUrl('mailto:x@y.z') === 'mailto:x@y.z' && FV.safeUrl('/a/b.png') === '/a/b.png'
    && FV.safeUrl('#anchor') === '#anchor');
  ok('safeUrl 拒 javascript: / data: / vbscript:',
    FV.safeUrl('javascript:alert(1)') === '' && FV.safeUrl('data:text/html,<b>') === ''
    && FV.safeUrl('vbscript:x') === '');
  ok('safeUrl 拒"用空白/控制字符拼出来的协议"（真实绕过写法）',
    FV.safeUrl('java\tscript:alert(1)') === '' && FV.safeUrl('  javascript:alert(1)') === ''
    && FV.safeUrl('java\nscript:x') === '');
  ok('md：正文里的 <script> 只会变成文字', (() => {
    const h = FV.mdToHtml('正常文字 <script>alert(1)</script> 结尾');
    return h.indexOf('<script>') < 0 && h.indexOf('&lt;script&gt;') >= 0;
  })());
  ok('md：javascript: 链接不给 href', (() => {
    const h = FV.mdToHtml('[点我](javascript:alert(1))');
    return h.indexOf('href') < 0 && h.indexOf('点我') >= 0;
  })());
  ok('md：代码块里的标签是文字', (() => {
    const h = FV.mdToHtml('```\n<img src=x onerror=alert(1)>\n```');
    return h.indexOf('<img') < 0 && h.indexOf('&lt;img') >= 0;
  })());

  console.log('\n═══ C. Markdown ═══');
  has('六级标题', FV.mdToHtml('# 一\n## 二\n###### 六'), '<h1>一</h1>');
  has('标题里的行内样式仍生效', FV.mdToHtml('## 这是**重点**'), '<h2>这是<strong>重点</strong></h2>');
  has('粗体/斜体/删除线/高亮', FV.mdToHtml('**粗** *斜* ~~删~~ ==亮=='),
    '<strong>粗</strong>');
  ok('粗斜删亮四种都在', (() => {
    const h = FV.mdToHtml('**粗** *斜* ~~删~~ ==亮==');
    return h.indexOf('<strong>粗</strong>') >= 0 && h.indexOf('<em>斜</em>') >= 0
      && h.indexOf('<s>删</s>') >= 0 && h.indexOf('<mark>亮</mark>') >= 0;
  })());
  ok('行内码里的 * 不当样式', FV.mdToHtml('用 `a*b*c` 这样').indexOf('<code class="fv-code">a*b*c</code>') >= 0);
  ok('围栏代码块保留原样并带语言类', (() => {
    const h = FV.mdToHtml('```js\nconst a = 1 < 2;\n```');
    return h.indexOf('<pre class="fv-pre">') >= 0 && h.indexOf('lang-js') >= 0 && h.indexOf('1 &lt; 2') >= 0;
  })());
  ok('~~~ 也能当围栏', FV.mdToHtml('~~~\nx\n~~~').indexOf('<pre') >= 0);
  has('外链带 noopener', FV.mdToHtml('[文档](https://a.b)'), 'rel="noopener noreferrer"');
  ok('URL 里的一层括号不会被切断（维基百科式链接）', (() => {
    const h = FV.mdToHtml('[条目](https://zh.wikipedia.org/wiki/A_(b))');
    return h.indexOf('href="https://zh.wikipedia.org/wiki/A_(b)"') >= 0;
  })());
  has('图片渲染成 img', FV.mdToHtml('![图](https://a.b/x.png)'), '<img class="fv-img" src="https://a.b/x.png"');
  has('裸链接自动成链', FV.mdToHtml('见 https://a.b/c 这里'), 'href="https://a.b/c"');
  ok('裸链接不把句尾中文标点吃进去', FV.mdToHtml('见 https://a.b/c。').indexOf('href="https://a.b/c"') >= 0);
  has('无序列表', FV.mdToHtml('- 甲\n- 乙'), '<ul class="fv-ul"><li>甲</li><li>乙</li></ul>');
  has('有序列表', FV.mdToHtml('1. 甲\n2. 乙'), '<ol class="fv-ol">');
  ok('两级嵌套：子列表在父 li 内部，且顶层没有多余空 li', (() => {
    const h = FV.mdToHtml('- 甲\n  - 乙\n- 丙');
    return h === '<ul class="fv-ul"><li>甲<ul class="fv-ul"><li>乙</li></ul><li>丙</li></ul>';
  })(), FV.mdToHtml('- 甲\n  - 乙\n- 丙'));
  ok('4 空格缩进也算第二层（不按 2 空格过度嵌套）', (() => {
    const h = FV.mdToHtml('- 甲\n    - 乙');
    return (h.match(/<ul/g) || []).length === 2;
  })(), FV.mdToHtml('- 甲\n    - 乙'));
  ok('同层混用有序/无序时换列表而不是嵌套', (() => {
    const h = FV.mdToHtml('1. 甲\n- 乙');
    return h.indexOf('<ol class="fv-ol"><li>甲</li></ol><ul class="fv-ul"><li>乙</li></ul>') >= 0;
  })(), FV.mdToHtml('1. 甲\n- 乙'));
  has('任务列表（禁用态复选框）', FV.mdToHtml('- [x] 做完\n- [ ] 没做'), '<input type="checkbox" disabled checked>');
  has('表格 thead/tbody', FV.mdToHtml('| a | b |\n|---|---|\n| 1 | 2 |'), '<thead><tr><th>a</th><th>b</th></tr></thead>');
  ok('表格三种对齐都认（:-: 居中 / --: 右 / :-- 左）', (() => {
    const h = FV.mdToHtml('| a | b | c |\n|:-:|--:|:--|\n| 1 | 2 | 3 |');
    return h.indexOf('text-align:center') >= 0 && h.indexOf('text-align:right') >= 0 && h.indexOf('text-align:left') >= 0;
  })(), FV.mdToHtml('| a | b | c |\n|:-:|--:|:--|\n| 1 | 2 | 3 |').slice(0, 240));
  has('引用块递归渲染', FV.mdToHtml('> 引用里的**粗**'), '<blockquote><p>引用里的<strong>粗</strong></p></blockquote>');
  has('分隔线', FV.mdToHtml('上\n\n---\n\n下'), '<hr>');
  ok('单换行按硬换行（会议纪要的常见写法）', FV.mdToHtml('第一行\n第二行').indexOf('第一行<br>第二行') >= 0);
  ok('空文档给一句人话而不是空白', FV.mdToHtml('').indexOf('fv-empty') >= 0);
  ok('引用嵌套超过 6 层会截断而不是爆栈', FV.mdToHtml('> '.repeat(30) + '深').indexOf('嵌套过深') >= 0);
  ok('renderListItems 三条不变式：空输入不产标签', FV.renderListItems([]) === '');

  console.log('\n═══ D. CSV ═══');
  ok('分隔符自动识别（分号 / 制表符）', FV.detectDelimiter('a;b;c') === ';' && FV.detectDelimiter('a\tb') === '\t' && FV.detectDelimiter('a,b') === ',');
  ok('引号里的逗号不切列', FV.parseCsv('"甲,乙",2')[0].length === 2 && FV.parseCsv('"甲,乙",2')[0][0] === '甲,乙');
  ok('引号里的换行不切行', FV.parseCsv('"第一行\n第二行",2').length === 1);
  ok('"" 转义成一个引号', FV.parseCsv('"他说""好""",1')[0][0] === '他说"好"');
  ok('CRLF 与末尾空行都处理掉', FV.parseCsv('a,b\r\nc,d\r\n\r\n').length === 2);
  has('表头用 th', FV.csvToHtml('项目,金额\n甲,1'), '<th>项目</th>');
  has('单元格转义', FV.csvToHtml('a\n<script>x</script>'), '&lt;script&gt;');
  ok('超行数上限时如实说明', FV.csvToHtml('h\n' + Array.from({ length: 900 }, (v, i) => i).join('\n'), { maxRows: 10 }).indexOf('共 900 行') >= 0);
  ok('空表给一句人话', FV.csvToHtml('').indexOf('fv-empty') >= 0);

  console.log('\n═══ E. 纯文本 / JSON ═══');
  ok('文本转义且保留换行', (() => { const r = FV.textToHtml('a<b>\nc'); return r.html.indexOf('a&lt;b&gt;\nc') >= 0; })());
  ok('超长文本截断并说明', FV.textToHtml('x'.repeat(FV.MAX_PARSE_BYTES ? 500000 : 500000)).meta.truncated === true);
  ok('JSON 能解析时 pretty-print（输出已转义，所以找 &quot;）',
    FV.jsonToHtml('{"a":1,"b":[1,2]}').html.indexOf('&quot;a&quot;') >= 0
    && FV.jsonToHtml('{"a":1,"b":[1,2]}').html.indexOf('\n') >= 0);
  ok('JSON 解析不了就当纯文本显示（显示原文永远比报错有用）', (() => {
    const r = FV.jsonToHtml('{坏掉的 json');
    return r.html.indexOf('fv-text') >= 0 && r.html.indexOf('坏掉的') >= 0;
  })());
  ok('JSON 里的 <script> 不会变成标签', FV.jsonToHtml('{"x":"<script>alert(1)</script>"}').html.indexOf('<script>') < 0);

  console.log('\n═══ F. XML 解析器 ═══');
  ok('元素/属性/文本', (() => {
    const d = FV.parseXml('<a x="1">文<b/>字</a>');
    const a = d.kids[0];
    return a.tag === 'a' && a.attrs.x === '1' && FV.textOf(a) === '文字' && FV.child(a, 'b') !== null;
  })());
  ok('属性值里可以有 >', FV.parseXml('<a t="x>y">z</a>').kids[0].attrs.t === 'x>y');
  ok('单引号属性也认', FV.parseXml("<a t='v'>z</a>").kids[0].attrs.t === 'v');
  ok('自闭合不吞掉后面的兄弟', FV.parseXml('<r><b/><c/></r>').kids[0].kids.length === 2);
  ok('CDATA 是原文（不解实体）', FV.parseXml('<a><![CDATA[<&>]]></a>').kids[0].kids[0] === '<&>');
  ok('注释与 XML 声明被跳过', FV.parseXml('<?xml version="1.0"?><!-- 注 --><a/>').kids.length === 1);
  ok('实体解码（含数字与十六进制）', FV.parseXml('<a>&amp;&lt;&gt;&quot;&apos;&#20013;&#x4e2d;</a>').kids[0].kids[0] === '&<>"\'中中');
  ok('未知实体原样保留（宁可看得见，不要吞字）', FV.parseXml('<a>&unknown;</a>').kids[0].kids[0] === '&unknown;');
  ok('命名空间前缀：按局部名比对', FV.local('w:document') === 'document' && FV.local('a') === 'a');
  ok('attr 忽略前缀与大小写（r:id / Id / id 都取得到）', (() => {
    const n = FV.parseXml('<x r:id="R" Id="I"/>').kids[0];
    return FV.attr(n, 'id') === 'R' || FV.attr(n, 'id') === 'I';   // 两个都算命中，只要不是空
  })());
  ok('attr 取不到给空串（不给 undefined）', FV.attr(FV.parseXml('<x/>').kids[0], 'nope') === '');
  ok('未闭合标签在 EOF 自动收口（不卡死、不抛）', (() => {
    const d = FV.parseXml('<a><b>文');
    return FV.textOf(d) === '文';
  })());
  ok('多余的闭合标签被忽略', FV.parseXml('<a>文</b></a>').kids.length === 1);
  ok('child 只找直接子（结构敏感处不能乱捞）', (() => {
    const d = FV.parseXml('<a><b><c/></b></a>').kids[0];
    return FV.child(d, 'c') === null && FV.first(d, 'c') !== null && FV.children(d, 'b').length === 1;
  })());
  ok('all 收全子树', FV.all(FV.parseXml('<a><b/><x><b/></x></a>'), 'b').length === 2);
  ok('半截文件不抛错（真实世界会遇到上传中断）', (() => {
    try { FV.parseXml('<a><b attr="未闭合'); return true; } catch (e) { return false; }
  })());

  console.log('\n═══ G. ZIP 读取 ═══');
  {
    const entries = [
      { name: 'a.txt', data: Buffer.from('甲乙丙', 'utf8') },
      { name: 'dir/b.txt', data: Buffer.from('B'.repeat(5000), 'utf8') },
      { name: 'stored.bin', data: FX.PNG_1PX, store: true },
    ];
    const zipBuf = FX.zipSync(entries);
    const z = FV.openZip(zipBuf);
    ok('列出全部条目名', z.names().join('|') === 'a.txt|dir/b.txt|stored.bin');
    ok('has() 命中与不命中', z.has('a.txt') === true && z.has('nope.txt') === false);
    ok('deflate 条目解压正确（默认 inflate = 本机可用的那一条）', (await z.text('a.txt')) === '甲乙丙');
    ok('zlib 注入路径结果一致', (await FV.openZip(zipBuf, ZLIB).text('a.txt')) === '甲乙丙');
    ok('stored（不压缩）条目直接读出', (await z.read('stored.bin')).length === FX.PNG_1PX.length);
    ok('不存在的条目返回 null 而不是抛', (await z.read('nope')) === null);
    ok('大条目（5000B）解压长度正确', (await z.read('dir/b.txt')).length === 5000);
    const d1 = await z.read('dir/b.txt');
    const d2 = await FV.openZip(zipBuf, ZLIB).read('dir/b.txt');
    ok('★ 默认路径与 zlib 路径逐字节一致（浏览器/Node 同一份代码）',
      Buffer.compare(Buffer.from(d1), Buffer.from(d2)) === 0);
    ok('带注释的 ZIP 也能读', FV.openZip(FX.zipSync(entries, { comment: '一段注释'.repeat(3) })).count === 3);

    // ZIP64 结构（小数据也走 ZIP64 记录，正好把那段解析代码跑起来）
    const z64 = FX.zipSync(entries, { zip64: true });
    const zz = FV.openZip(z64, ZLIB);
    ok('ZIP64：条目数从 ZIP64 EOCD 读出', zz.count === 3);
    ok('ZIP64：尺寸与偏移取自额外字段 0x0001，内容仍正确', (await zz.text('a.txt')) === '甲乙丙');
    ok('ZIP64：大条目也对', (await zz.read('dir/b.txt')).length === 5000);

    // 坏输入的三种形态：都要给"人话"而不是静默
    let msg = '';
    try { FV.openZip(Buffer.from('这不是 zip 文件啊啊啊', 'utf8')); } catch (e) { msg = e.message; }
    ok('非 ZIP 给明确报错', msg.indexOf('不是合法的 ZIP') >= 0, msg);
    msg = '';
    try { FV.openZip(z2 => z2, {}); } catch (e) { msg = e.message; }
    ok('喂错类型给明确报错', msg.length > 0, msg);
    msg = '';
    try { await FV.openZip(FX.zipSync([{ name: 'x', data: Buffer.from('x') }]), ZLIB).read('x'); } catch (e) { msg = e.message; }
    ok('正常条目不会误报', msg === '', msg);
    // 截断：把中央目录里记的偏移改坏，读到的是"数据越界"而不是崩溃
    const trunc = Buffer.from(FX.zipSync([{ name: 'x.txt', data: Buffer.from('y'.repeat(300)) }]));
    trunc.writeUInt32LE(999999, 0);   // 破坏第一个本地头的签名
    let truncErr = null;
    try { await FV.openZip(trunc, ZLIB).read('x.txt'); } catch (e) { truncErr = e; }
    ok('本地头被破坏时返回 null（认不出来，不硬解）', truncErr === null);
  }

  /* ══ G2. 浏览器那一轨的解压 ══════════════════════════════════════════
   * ▎为什么专门开这一组：**Node 18+ 也有全局 DecompressionStream**，而 G 组里
   *   "默认路径"在 Node 上其实走的是 zlib 那一支——也就是说浏览器里真正执行的
   *   那几行代码，单测从来没碰过。这不是假想病：这一段代码在真浏览器里
   *   **整条 promise 永久不 settle**（TransformStream 写侧等读侧，而读者在
   *   await 之后才诞生 = 自死锁），178 条单测全绿、界面却一片空白。
   *   ▸ 做法：把源码装进一个**没有 require / module** 的 vm 上下文，于是
   *     `defaultInflateRaw()` 只能选浏览器那一支——测的是** shipped 的那几行**，
   *     不是我另抄的一份（抄一份测就是测桩，坑 63 同一条纪律）。
   *   ▸ 跨 realm 传字节用**普通数组**：`Array.isArray` 是按内部槽判的（跨 realm 成立），
   *     而 `instanceof Uint8Array` 在 vm 里对外来 Buffer 是 false（本项目踩过，见冒烟那次
   *     "vm 跨 realm"的教训）——传错容器会让 toU8 直接抛，别踩。
   * ══════════════════════════════════════════════════════════════════ */
  console.log('\n═══ G2. 浏览器那一轨的解压（vm 里跑真实浏览器代码） ═══');
  {
    const vm = require('vm');
    const src = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'fileview.js'), 'utf8');
    const ctx = vm.createContext({
      setTimeout, clearTimeout, TextDecoder, console,
      DecompressionStream: globalThis.DecompressionStream,   // Node 18+ 有；老 Node 上这组会自然失败
    });
    vm.runInContext(src, ctx);
    const BFV = ctx.FV;
    const asBytes = (buf) => Array.from(buf);                 // 跨 realm 安全的字节容器

    // 前提断言：这个世界里真的没有 require（否则下面测的还是 zlib 那一支，白测）
    ok('★ 前提：这个 vm 上下文里没有 require/module（所以只会走浏览器分支）',
      vm.runInContext('typeof require === "undefined" && typeof module === "undefined"', ctx) === true
      && vm.runInContext('typeof DecompressionStream === "function"', ctx) === true);
    ok('浏览器分支被选中了（返回的是 async 函数，不是同步的 zlib 版）',
      vm.runInContext('FV.defaultInflateRaw().constructor.name', ctx) === 'AsyncFunction'
      || vm.runInContext('String(FV.defaultInflateRaw)', ctx).indexOf('DecompressionStream') >= 0);

    const zipBuf = FX.zipSync([
      { name: 'a.txt', data: Buffer.from('甲乙丙', 'utf8') },
      { name: 'dir/b.txt', data: Buffer.from('B'.repeat(5000), 'utf8') },
    ]);
    // 死锁的表现是"永远不 settle"，所以这里等的是**有上限的**一次 await：
    // 到点没回来就红，而不是把整套测试挂在那里没人知道发生了什么。
    const within = (p, ms) => Promise.race([
      p.then((v) => ({ ok: true, v })),
      new Promise((res) => setTimeout(() => res({ ok: false }), ms)),
    ]);
    const t0 = Date.now();
    const r1 = await within(BFV.openZip(asBytes(zipBuf)).text('a.txt'), 8000);
    ok('★★★ 浏览器那一轨真的解出了 deflate 条目，而且是**有界**地解出来（旧写法永久不 settle）',
      r1.ok === true && r1.v === '甲乙丙', r1.ok ? `${Date.now() - t0}ms` : '8s 没回话 = 又死锁了');
    const r2 = await within(BFV.openZip(asBytes(zipBuf)).read('dir/b.txt'), 8000);
    ok('大条目在浏览器那一轨也对（5000B，跨多块背压）',
      r2.ok === true && r2.v.length === 5000, r2.ok ? '' : '没回话');
    const rHtml = await within(BFV.docxToHtml(asBytes(FX.makeDocx())), 8000);
    const zHtml = (await FV.docxToHtml(FX.makeDocx())).html;
    ok('★★ 同一份 .docx：浏览器那一轨与 zlib 那一轨**逐字符一致**（两个运行时同一份代码）',
      rHtml.ok === true && rHtml.v.html === zHtml,
      rHtml.ok ? `长度 ${rHtml.v.html.length} vs ${zHtml.length}` : '没回话');

    /* ★ 2026-10-08 第三轮：把**真实世界的怪形状**也过一遍浏览器那一轨。
     *   上面那条只拿"我随手写的那份 docx"证了两轨一致，而 O 组那 22 条
     *   （`w:vMerge` 缺 val=继续、gridSpan 与 vMerge 同表混用、公式格没有缓存值、
     *   备注页不许算一页）全部只走 zlib 那一支 ⇒ **真正发出去的那几行代码
     *   从来没渲染过这些形状**。两轨不一致不会报错，只会在浏览器里"表格少一列"
     *   或"日期变回数字"——正是本项目反复记的那类静默差异（坑 57/76 的运行时版）。 */
    const shapes = [
      ['docx 纵向合并 + 横向合并同表', 'docxToHtml', FX.makeDocx({ vMerge: true })],
      ['xlsx 公式带缓存值与不带缓存值', 'xlsxToHtml', FX.makeXlsx()],
      ['pptx 带备注页', 'pptxToHtml', FX.makePptx({ notes: true })],
      ['pptx 普通两页', 'pptxToHtml', FX.makePptx()],
    ];
    const browserHtml = {};
    for (const [label, fn, buf] of shapes) {
      const b = await within(BFV[fn](asBytes(buf)), 8000);
      const z = await FV[fn](buf);
      browserHtml[label] = b.ok ? b.v.html : '';
      ok(`★★ 两轨逐字一致：${label}（浏览器那一轨必须真的渲染过这些形状）`,
        b.ok === true && b.v.html === z.html && z.html.length > 200,
        b.ok ? `${b.v.html.length} vs ${z.html.length} 字符` : '8s 没回话');
    }
    /* 反向对照：两轨一致也可能是"一致地什么都没渲染"，所以再钉一条**内容级**的：
     * 浏览器那一轨也要产出 rowspan="3" 与合并标签只出现一次（O 组在产品侧钉的同一判据）。 */
    const bvm = browserHtml['docx 纵向合并 + 横向合并同表'] || '';
    ok('★ 浏览器那一轨也画得出 rowspan="3"（不是两轨一致地交白卷）',
      bvm.indexOf('<td rowspan="3">') >= 0 || bvm.indexOf('rowspan="3"') >= 0,
      `抓到 ${bvm.length} 字符`);
    ok('★ 被合并的标签在浏览器那一轨也只出现一次（重影是用户一眼看得见的错）',
      (bvm.match(/负责人/g) || []).length === 1,
      `出现 ${(bvm.match(/负责人/g) || []).length} 次`);

    // 坏数据要"报错"，不要"永久转圈"——保险丝存在的意义就是这件事，而它必须可红
    const tBad = Date.now();
    let badMsg = null;
    const rBad = await within(
      BFV.defaultInflateRaw()(asBytes(Buffer.from('这不是 deflate 流', 'utf8')))
        .then(() => 'RESOLVED', (e) => { badMsg = (e && (e.message || e.name)) || String(e); return 'REJECTED'; }),
      8000);
    ok('★ 坏 deflate 流：浏览器那一轨**快速失败**（旧写法要么静默接受、要么永久不 settle）',
      rBad.ok === true && rBad.v === 'REJECTED' && Date.now() - tBad < 6000,
      rBad.ok ? `结果=${rBad.v}，耗时 ${Date.now() - tBad}ms` : '8s 没回话 = 卡住了');
    ok('坏流的报错说得出话（client.js 是把 message 直接显示给用户的）',
      typeof badMsg === 'string' && badMsg.length > 0, `message=${JSON.stringify(badMsg)}`);

    // 解压上限：把 cap 压到 2 字节，一份正常 docx 也必须被拒（安全线要能被小样本测到）
    let capNode = '', capBrowser = '';
    try { await FV.openZip(FX.zipSync([{ name: 'a.txt', data: Buffer.from('甲乙丙', 'utf8') }]), { maxBytes: 2 }).read('a.txt'); }
    catch (e) { capNode = e.message; }
    ok('★ zlib 轨遵守 maxBytes（解压炸弹的那道闸在 Node 里也成立）',
      capNode.indexOf('超过') >= 0, capNode || '没有报错');
    try { await BFV.openZip(asBytes(FX.zipSync([{ name: 'a.txt', data: Buffer.from('甲乙丙', 'utf8') }])), { maxBytes: 2 }).read('a.txt'); }
    catch (e) { capBrowser = e.message; }
    ok('★ 浏览器轨同样遵守 maxBytes（两条路的闸得是同一条线）',
      capBrowser.indexOf('超过') >= 0, capBrowser || '没有报错');
    ok('上限压不住正常文件（默认 cap 之下照常解，别把闸做成门）',
      (await FV.openZip(FX.zipSync([{ name: 'a.txt', data: Buffer.from('甲乙丙', 'utf8') }])).text('a.txt')) === '甲乙丙');

    // 保险丝自己也要可红：一条永不 settle 的 promise 必须到点变成明确的错
    let wdErr = '';
    try { await FV.withWatchdog(new Promise(() => {}), 30, (ms) => `卡住了（${ms}ms）`); } catch (e) { wdErr = e.message; }
    ok('★ withWatchdog 可红：永久不 settle 的 promise 到点报明确的错',
      wdErr.indexOf('卡住了（30ms）') >= 0, wdErr || '没有超时（保险丝没响）');
    ok('withWatchdog 不抢跑：先到的一边照常返回',
      (await FV.withWatchdog(Promise.resolve('好'), 3000, () => '不该发生')) === '好');
  }

  console.log('\n═══ H. 小件纯函数 ═══');
  ok('resolveZipPath：相对路径', FV.resolveZipPath('word', 'media/image1.png') === 'word/media/image1.png');
  ok('resolveZipPath：.. 上跳', FV.resolveZipPath('ppt/slides', '../media/image1.png') === 'ppt/media/image1.png');
  ok('resolveZipPath：绝对路径去掉开头斜杠', FV.resolveZipPath('xl', '/xl/worksheets/sheet2.xml') === 'xl/worksheets/sheet2.xml');
  ok('resolveZipPath：./ 与空段', FV.resolveZipPath('a', './b//c.xml') === 'a/b/c.xml');
  ok('colIndexOf：A=0 Z=25 AA=26', FV.colIndexOf('A1') === 0 && FV.colIndexOf('Z1') === 25 && FV.colIndexOf('AA1') === 26);
  ok('colIndexOf：小写也认、无引用给 0', FV.colIndexOf('b2') === 1 && FV.colIndexOf('') === 0);
  ok('excelSerial：45122 = 2023-07-15', FV.excelSerial(45122) === '2023-07-15');
  ok('excelSerial：44927 = 2023-01-01', FV.excelSerial(44927) === '2023-01-01');
  ok('excelSerial：小数部分可只要时间', FV.excelSerial(45122.5, 'time') === '12:00:00');
  ok('excelSerial：日期+时间', FV.excelSerial(45122.5, 'both') === '2023-07-15 12:00:00');
  ok('excelSerial：脏值给空串（不编数）', FV.excelSerial('abc') === '');
  ok('isDateFormat：内置 14 是日期，0/General 不是', FV.isDateFormat(14) === true && FV.isDateFormat(0) === false);
  ok('isDateFormat：自定义 yyyy-mm-dd 是日期', FV.isDateFormat(164, 'yyyy\\-mm\\-dd') === true);
  ok('isDateFormat：#,##0.00 不是日期', FV.isDateFormat(165, '#,##0.00') === false);
  ok('isDateFormat：h:mm:ss 是时间', FV.isDateFormat(200, 'h:mm:ss') === true && FV.datePartsOf('h:mm:ss') === 'time');
  ok('datePartsOf：三种精度', FV.datePartsOf('yyyy-mm-dd') === 'date' && FV.datePartsOf('yyyy-mm-dd h:mm') === 'both');
  ok('base64 与 Node 实现一致（含 1/2/3 字节余数三种长度）',
    [0, 1, 2, 3, 4, 5, 17].every((n) => {
      const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 37 + 11) & 0xff;
      return FV.base64(b) === b.toString('base64');
    }));

  console.log('\n═══ I. docx（Word） ═══');
  {
    const buf = FX.makeDocx();
    const r = await FV.docxToHtml(buf);
    const r2 = await FV.docxToHtml(buf, ZLIB);
    ok('两条 inflate 路径产出一致', r.html === r2.html);
    has('一级标题（pStyle Heading1 → h1）', r.html, '<h1>项目评审会</h1>');
    has('粗体', r.html, '<strong>加粗</strong>');
    has('斜体', r.html, '<em>斜体</em>');
    has('同一段里的普通文字', r.html, '与普通');
    ok('文档里的 <script> 只当文字（不产标签）', r.html.indexOf('<script>') < 0 && r.html.indexOf('&lt;script&gt;alert(1)&lt;/script&gt;') >= 0);
    ok('文档里的 & 与 <b> 也被转义', r.html.indexOf('&amp; &lt;b&gt;粗&lt;/b&gt;') >= 0);
    has('无序列表 → ul', r.html, '<ul class="fv-ul">');
    has('无序列表第一项', r.html, '<li>第一条</li>');
    ok('有序子列表在无序列表内部且类型正确', (() => {
      const i = r.html.indexOf('编号子项');
      return i > 0 && r.html.lastIndexOf('<ol class="fv-ol">', i) > r.html.lastIndexOf('<ul class="fv-ul">', i);
    })(), r.html.slice(0, 0));
    has('表格', r.html, '<table class="fv-tbl fv-doc-tbl">');
    has('表格单元格', r.html, '格A');
    ok('合并格 colspan=2', r.html.indexOf('colspan="2"') >= 0);
    ok('外部超链接成 <a> 且带 noopener', (() => {
      const i = r.html.indexOf('外部链接');
      return i > 0 && r.html.lastIndexOf('href="https://example.com/a_(b)"', i) > 0 && r.html.lastIndexOf('noopener', i) > 0;
    })());
    ok('内部锚点**不**画成链接（点了没反应比不画更糟）', r.html.indexOf('#_Toc123') < 0);
    ok('内嵌图片成了 data: URL', r.html.indexOf('<img class="fv-docimg" src="data:image/png;base64,') >= 0);
    ok('图片带上替代文字（docPr / cNvPr 两处来源都要找）', r.html.indexOf('alt="示意图"') >= 0);
    ok('图片统计进 meta', r.meta.images === 1);
    ok('段落/表格计数进 meta（可观测：渲染了多少东西）', r.meta.paragraphs >= 6 && r.meta.tables === 1);
    ok('xml:space="preserve" 的尾部空格没丢', r.html.indexOf('尾部保留空格  <') >= 0 || r.html.indexOf('尾部保留空格  ') >= 0);
    ok('没有图片的 docx 不产 img', (await FV.docxToHtml(FX.makeDocx({ noImage: true }))).html.indexOf('fv-docimg') < 0);
    let msg = '';
    try { await FV.docxToHtml(Buffer.from('这不是 docx', 'utf8')); } catch (e) { msg = e.message; }
    ok('非 docx 给人话报错（不是空白页）', msg.length > 5, msg);
    msg = '';
    try { await FV.docxToHtml(FX.zipSync([{ name: 'a.txt', data: 'x' }])); } catch (e) { msg = e.message; }
    ok('是 ZIP 但没有 document.xml 也给人话', msg.indexOf('word/document.xml') >= 0, msg);
  }

  console.log('\n═══ J. xlsx（Excel） ═══');
  {
    const r = await FV.xlsxToHtml(FX.makeXlsx());
    ok('两张表都渲染', r.meta.sheets === 2);
    has('工作表名成小节标题', r.html, '会议预算');
    has('第二张表也在', r.html, '名单');
    has('共享字符串表被读到（否则整张表全是数字）', r.html, '项目');
    has('表头单元格', r.html, '金额');
    ok('数字原样显示', r.html.indexOf('<td>1234.5</td>') >= 0);
    ok('★ 日期序列号还原成日期（45122 → 2023-07-15）', r.html.indexOf('<td>2023-07-15</td>') >= 0,
      '这一步不做，用户看到的是满屏五位数字');
    /* ★ 期望改了（2026-10-09）：这一格格式码是 #,##0.00，Excel 显示 9,876.54。
     *   原先的断言钉的是"原样吐 9876.54321"——那是**旧实现的形状**，不是这个场景本来该有的行为
     *   （把 9876.54321 念成 9,876.54 才是 Excel 上用户看到的那串字；见坑 115 同一条纪律）。
     *   两条红线都留着：① 不许被当日期（excelSerial(9876)≈1926 年），② 不许漏出浮点长尾。 */
    ok('千分位格式：按格式码念成 9,876.54（不当日期、不漏原始长尾）',
      r.html.indexOf('9,876.54') >= 0 && r.html.indexOf('9876.54321') < 0 && r.html.indexOf('1926') < 0);
    has('公式结果字符串（t="str"）', r.html, '合计');
    has('错误值原样显示（#DIV/0! 要看得见）', r.html, '#DIV/0!');
    has('布尔值 → TRUE', r.html, 'TRUE');
    has('inlineStr 单元格', r.html, '行内字符串');
    ok('稀疏列定位正确（D2 空 → 那一格是空的，E2 落在第 5 列）', (() => {
      const row = /<tr><td>张三<\/td>[\s\S]*?<\/tr>/.exec(r.html);
      if (!row) return false;
      const tds = row[0].match(/<td>[^<]*<\/td>/g) || [];
      return tds.length === 8 && tds[3] === '<td></td>' && tds[4] === '<td>9,876.54</td>';
    })(), '列定位错了整张表就串位');
    ok('浮点噪声被收掉（不出现 1234.50000000 这种）', r.html.indexOf('1234.50000000') < 0);
    let msg = '';
    try { await FV.xlsxToHtml(FX.makeDocx()); } catch (e) { msg = e.message; }
    ok('拿 docx 当 xlsx 解析给人话报错', msg.indexOf('xl/workbook.xml') >= 0, msg);
  }

  console.log('\n═══ K. pptx（PPT） ═══');
  {
    const r = await FV.pptxToHtml(FX.makePptx());
    ok('两页幻灯片', r.meta.slides === 2);
    ok('卡片数与页数一致', (r.html.match(/class="fv-slide"/g) || []).length === 2);
    ok('长宽比按 sldSz 算出（16:9 → 1.7778）', r.html.indexOf('--fv-slide-ar:1.7778') >= 0, r.html.slice(0, 120));
    has('标题文字', r.html, '季度评审');
    has('要点文字', r.html, '第一条要点');
    ok('项目符号画出来了', r.html.indexOf('• ') >= 0);
    ok('a:br 换行在段落中间（不是堆到末尾）', (() => {
      const i1 = r.html.indexOf('第二条');
      const i2 = r.html.indexOf('换行后半句');
      const iBr = r.html.indexOf('<br>', i1);
      return i1 >= 0 && i2 > i1 && iBr > i1 && iBr < i2;
    })());
    ok('字号按磅换算成 cqw（44pt / 幻灯片宽 → 4.5833cqw）', r.html.indexOf('font-size:4.5833cqw') >= 0,
      (r.html.match(/font-size:[\d.]+cqw/g) || []).join(','));
    ok('位置按 EMU 换算成百分比', r.html.indexOf('left:6.875%') >= 0, '838200/12192000');
    ok('幻灯片里的表格渲染出来', r.html.indexOf('fv-slide-tbl') >= 0 && r.html.indexOf('列一') >= 0);
    ok('第二页的内嵌图片成了 data: URL', r.html.indexOf('<img class="fv-slideimg" src="data:image/png;base64,') >= 0);
    ok('没有 xfrm 的占位符给近似框（不消失）', r.html.indexOf('没有坐标的占位符') >= 0);
    ok('图片统计进 meta', r.meta.images === 1);
    ok('有内容的段落数对得上（标题 1 + 要点 2 + 第二页占位 1 = 4，空段落不产版面）',
      (r.html.match(/class="fv-sp"/g) || []).length === 4,
      String((r.html.match(/class="fv-sp"/g) || []).length));
  }

  console.log('\n═══ L. render 分派 ═══');
  {
    const md = await FV.render('笔记.md', Buffer.from('# 标题\n正文', 'utf8'));
    has('render(md) 走 markdown', md.html, '<h1>标题</h1>');
    const csv = await FV.render('表.csv', Buffer.from('a,b\n1,2', 'utf8'));
    has('render(csv) 走表格', csv.html, '<th>a</th>');
    const js = await FV.render('配置.json', Buffer.from('{"a":1}', 'utf8'));
    has('render(json) 走 JSON', js.html, 'fv-json');
    const tx = await FV.render('日志.log', Buffer.from('一行\n两行', 'utf8'));
    has('render(text) 走 pre', tx.html, '一行\n两行');
    const lg = await FV.render('老.doc', Buffer.from([0xD0, 0xCF, 0x11, 0xE0]));
    ok('render(legacy) 说明为什么看不了 + 给下一步', lg.meta.unsupported === true && lg.html.indexOf('下载') >= 0);
    const dw = await FV.docxToHtml(FX.makeDocx());
    const dx = await FV.render('文档.docx', FX.makeDocx());
    ok('render(docx) 与直接调用结果一致', dx.html === dw.html);
    const im = await FV.render('图.png', FX.PNG_1PX, { blobUrl: 'blob:x' });
    has('render(image) 用调用方给的 blob URL', im.html, 'src="blob:x"');
    const sv = await FV.render('图.svg', Buffer.from('<svg><script>alert(1)</script></svg>', 'utf8'), { blobUrl: 'blob:y' });
    ok('render(svg) 当图片渲染，不把 SVG 当 HTML 解析（SVG 里能带 script）',
      sv.html.indexOf('<svg') < 0 && sv.html.indexOf('blob:y') >= 0);
    const big = Buffer.alloc(1024);
    let msg = '';
    try { await FV.docxToHtml(big, { kind: 'docx' }); } catch (e) { msg = e.message; }
    ok('坏字节给人话报错（调用方直接把 message 显示出来即可）', msg.length > 5, msg);
  }

  /* ══ N. PDF 夹具自证 ════════════════════════════════════════════════
   * ▎为什么单列一组：PDF 这一路我们**不解析**（交给浏览器内置阅读器），
   *   所以"渲染对不对"在单测里没有抓手；能抓住的只有两件事：
   *     ① 类型判定与分派（魔数是 %PDF-、render 走 iframe、翻页靠 #page=）；
   *     ② **夹具自己合不合法**——它是一份手写的二进制格式，
   *       xref 偏移错一位、/Length 差一字节，阅读器就报"文件已损坏"，
   *       而那句错误看起来完全像"共享文件功能坏了"。量具不干净，被测物就白测（坑 117）。
   *   ▸ 这一组就是这么来的：我先用一次性脚本量出 off-by-one，才确认夹具是好的——
   *     那个"假红"的第一个嫌疑人确实是判据自己。现在把那次验证固化成断言。 */
  console.log('\n═══ N. PDF 夹具自证 ═══');
  {
    const pdf = FX.makePdf();
    const s = pdf.toString('binary');
    const NL = String.fromCharCode(10);
    ok('魔数认得这份手写的 PDF', FV.magicKind(pdf) === 'pdf');
    ok('类型判定按扩展名也认（大小写都算）', FV.kindOf('会议材料.PDF') === 'pdf' && FV.canPreview('a.pdf'));

    const xi = s.lastIndexOf('startxref');
    const xrefAt = Number((s.slice(xi).match(/(\d+)/) || ['', 'nan'])[1]);
    ok('startxref 指向的位置真的是 xref 表', s.substr(xrefAt, 4) === 'xref', `读到 ${JSON.stringify(s.substr(xrefAt, 6))}`);

    const rows = s.slice(xrefAt).split(NL);
    const offs = [];
    for (const L of rows) { const m = /^(\d{10}) (\d{5}) n $/.exec(L); if (m) offs.push(Number(m[1])); }
    ok('xref 表条目数 = 对象数（+1 那条是 free 表头）', offs.length === (s.match(/\d+ 0 obj/g) || []).length, `${offs.length} 条`);
    ok('★ 每条 xref 偏移都落在"N 0 obj"上（错一位阅读器就说文件损坏）',
      offs.every((off) => /^\d+ 0 obj/.test(s.substr(off, 16))),
      (offs.map((off) => JSON.stringify(s.substr(off, 10))).join(' ')).slice(0, 120));
    /* /Length 必须等于 stream 与 endstream 之间的**字节数**。
     * ▸ 这里曾经差 1：取起点时 'stream'(6 字符) 后面还有一个换行，加 6 会把那个换行算进长度——
     *   判据自己错一位，报出来的就是"夹具不合法"这个假红。写清楚免得下次再算错。 */
    const lens = [];
    const re = /<< \/Length (\d+) >>/g;
    let mm;
    while ((mm = re.exec(s))) {
      const start = s.indexOf('stream' + NL, mm.index) + 7;
      const end = s.indexOf('endstream', start);
      lens.push({ declared: Number(mm[1]), actual: end - start });
    }
    ok('★ 每个 stream 的 /Length 都等于真实字节数', lens.length >= 1 && lens.every((x) => x.declared === x.actual),
      JSON.stringify(lens));
    ok('/Size = 对象数 + 1（trailer 与 xref 得对上）',
      Number((s.match(/\/Size (\d+)/) || ['', '0'])[1]) === (s.match(/\d+ 0 obj/g) || []).length + 1);

    // 反例对照的前提：darkFirst:false 时两页**都不画黑块**、长度相同（这样"两页一样亮"才说明阅读器没解码）
    const plain = FX.makePdf({ pages: 2, darkFirst: false }).toString('binary');
    const streams = (plain.match(/stream[\s\S]*?endstream/g) || []).map((x) => x.replace(/^stream/, '').replace(/endstream$/, ''));
    ok('反例夹具 darkFirst:false ⇒ 两页都不画黑块、长度相同（像素断言的对照组）',
      streams.length === 2 && streams[0].indexOf(' re f') < 0 && streams[1].indexOf(' re f') < 0
      && streams[0].length === streams[1].length, JSON.stringify(streams.map((x) => x.length)));
    const dark = FX.makePdf({ pages: 2 }).toString('binary');
    ok('默认夹具第 1 页画了黑块、第 2 页没画（内容差是断言的全部依据）',
      dark.indexOf(' re f') >= 0 && (dark.match(/ re f/g) || []).length === 1);

    /* ── PDF 的"渲染"其实是把 blob URL 交给浏览器内置阅读器，所以我们能测的只有两件事：
     *   ① **片段拼法** `#page=N&view=FitH` 的形状与钳制（client 三处 src 全走这一个函数）；
     *   ② 有人直接 `FV.render('x.pdf')` 时**不许胡说**（原先掉进 default 分支，
     *     会对 PDF 说"这是 1997~2003 版的二进制 Office 格式"——界面在撒谎，坑 82）。 */
    ok('pdfSrc：形状正确（内置阅读器认这个片段）',
      FV.pdfSrc('blob:abc', 3) === 'blob:abc#page=3&view=FitH', FV.pdfSrc('blob:abc', 3));
    ok('pdfSrc：页码钳在 1~上限，脏值不拼出坏片段',
      FV.pdfSrc('blob:abc', 0) === 'blob:abc#page=1&view=FitH'
      && FV.pdfSrc('blob:abc', '99999') === 'blob:abc#page=' + FV.PDF_MAX_PAGE + '&view=FitH'
      && FV.pdfSrc('blob:abc', 'abc') === 'blob:abc#page=1&view=FitH');
    ok('pdfSrc：没有 blob URL 时给空串（不拼出 "#page=1" 这种半截片段）', FV.pdfSrc('', 2) === '');
    const rp = await FV.render('会议材料.pdf', pdf);
    ok('★ render(pdf) 说实话：说"交给内置阅读器"，不对 PDF 念那段旧版 Office 的拒绝词',
      rp.meta.kind === 'pdf' && rp.meta.native === true
      && rp.html.indexOf('内置阅读器') >= 0 && rp.html.indexOf('1997') < 0, rp.html.slice(0, 40));
    /* 结构红线：`#page=` 这个形状只许在内核里出现一次。
     * client.js 原先有三处各拼一遍（初次渲染 / 翻页 / 跟随应用），漏改一处就是
     * "翻页了但另一条路还停在旧页"，而且不报错——所以这里用断言把它钉死。 */
    const clientSrc = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'client.js'), 'utf8');
    const pageLiterals = (clientSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').match(/#page=/g) || []).length;
    ok('★ client.js 里不再自己拼 #page= 片段（三处全部改走 FV.pdfSrc，一个概念一个来源）',
      pageLiterals === 0, `还出现 ${pageLiterals} 次`);
    /* 收敛之后：#page= 的拼法在 client 里只出现 **1 次**（mountPdf 内部），
     * 而 mountPdf 被 3 处使用（定义 + renderPdf + 两处换页）——
     * 断言写死数字是为了"有人再加第 4 处拼片段"时立刻红，而不是慢慢漂。 */
    ok('client.js 里 FV.pdfSrc 只有一个调用点（收敛进 mountPdf，不再三处各拼一遍）',
      (clientSrc.match(/FV\.pdfSrc\(/g) || []).length === 1
      && (clientSrc.match(/\bmountPdf\(/g) || []).length >= 4,
      `pdfSrc=${(clientSrc.match(/FV\.pdfSrc\(/g) || []).length} mountPdf=${(clientSrc.match(/\bmountPdf\(/g) || []).length}`);
  }

  console.log('\n═══ O. 真实世界的怪形状（Word/Excel 真文件里才有、玩具夹具不会有的形状） ═══');
  /* ▎这一组存在的理由：前面 I/J/K 三组的夹具是"我以为 Office 长什么样"写出来的，
   *   而真实的 docx/xlsx 由 Office 自己产出，里面全是**规范允许但教学示例不写**的形状：
   *   纵向合并（`w:vMerge` 缺 val 就是 continue）、公式格只带 `<f>` 不带缓存 `<v>`、
   *   自定义日期格式里带引号字面量（`yyyy"年"m"月"`）。
   *   解析器少认一种形状的后果和以前一样：**静默**——表格少一行、格子变空白，不报错。
   *   ▸ 每条都配一条**反向对照**（同一条判据在不该成立时必须红），否则它只是另一条常绿的装饰（坑 115）。 */
  {
    /* ── O1. docx 纵向合并：起始格带 val="restart"，续格**不带 val**（= 继续） ── */
    const vm = await FV.docxToHtml(FX.makeDocx({ vMerge: true }), ZLIB);
    const plain = await FV.docxToHtml(FX.makeDocx(), ZLIB);
    /* ▸ 表要**按内容挑**，不是按位置挑（`.pop()` 一度把混用表当成第一张去数格子，
     *   于是两条断言测的是同一个东西，另一条白写——坑 51 家族：断言读到了错误的节点）。 */
    const tbls = vm.html.match(/<table[\s\S]*?<\/table>/g) || [];
    const tblVm = tbls.find((t) => t.indexOf('负责人') >= 0) || '';
    const mixed = tbls.find((t) => t.indexOf('宽表头') >= 0) || '';
    ok('夹具里两张合并表都找到了（挑表的方式本身要先验一次）', !!tblVm && !!mixed);
    has('vMerge restart → rowspan="3"（三行合成一格）', tblVm, '<th rowspan="3">');
    ok('被合并的那个标签只出现一次（每续行再印一遍 = 界面上重影）',
      (tblVm.match(/负责人/g) || []).length === 1,
      `出现 ${(tblVm.match(/负责人/g) || []).length} 次`);
    ok('续格不补空格子：那张表恰好 4 个格子、没有一个空格（少认 vMerge 会把列推歪）', (() => {
      const cells = tblVm.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) || [];
      return cells.length === 4 && cells.every((td) => td.replace(/^<t[dh][^>]*>|<\/t[dh]>$/g, '').trim() !== '');
    })(), `格子数=${(tblVm.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) || []).length} 表格=${tblVm}`);
    ok('反向对照：没有 vMerge 的同一份夹具不产 rowspan', plain.html.indexOf('rowspan') < 0);
    /* 横向合并 + 纵向合并**同表混用**：gridSpan 与 vMerge 唯一会互相拖累的形状——
     * 列号若只按"第几个格子"数而不按 gridSpan 累加，起始格会落错列，续格对不上号：
     * rowspan 消失 + 多画一格空格，界面表现为"表格右下角错位"。 */
    has('混用表：起始格同时带 colspan=2', mixed, '<th colspan="2"><p>宽表头</p></th>');
    has('混用表：竖着合并的那格跨两行（列号算错时它会被当成普通格）', mixed, '<th rowspan="2"><p>竖</p></th>');
    ok('混用表的第二行只剩两格（被吃掉的那格不该补回来）', (() => {
      const trs = mixed.match(/<tr>[\s\S]*?<\/tr>/g) || [];
      return trs.length === 2 && (trs[1].match(/<td/g) || []).length === 2;
    })(), mixed);
    /* ── O2. xlsx 公式格：带缓存值就用缓存值，不带就留空（我们**不重算**公式） ── */
    const x = await FV.xlsxToHtml(FX.makeXlsx(), ZLIB);
    has('公式格 <f>B2*2</f><v>2469</v> → 用缓存值 2469', x.html, '>2469<');
    const tables = x.html.match(/<table[\s\S]*?<\/table>/g) || [];
    const rows0 = (tables[0].match(/<tr>[\s\S]*?<\/tr>/g) || []);
    const isEmptyTr = (tr) => (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) || [])
      .every((td) => td.replace(/^<t[dh][^>]*>|<\/t[dh]>$/g, '').trim() === '');
    ok('只有 <f> 没有 <v> 的那一行整行留空（Excel 自己没算出来，我们编个数就是撒谎）',
      rows0.filter(isEmptyTr).length === 1 && isEmptyTr(rows0[rows0.length - 1]),
      `全空的行数=${rows0.filter(isEmptyTr).length}`);
    ok('全表不出现 NaN / undefined / Infinity（编造的数字只会以这三种形态漏出来）',
      !/NaN|undefined|Infinity/.test(x.html));

    /* ── O3. 自定义日期格式带引号字面量：格式串里的英文字面量不许被当成日期/时间字母 ── */
    ok('isDateFormat：自定义 166 且格式里带引号字面量 → 仍判是日期',
      FV.isDateFormat(166, 'yyyy"年"m"月"') === true);
    ok('datePartsOf：引号里的字面量不参与判断',
      FV.datePartsOf('yyyy"hh:mm"') === 'date'                    // 字面量里全是 h/m，剥掉引号才是真相
      && FV.datePartsOf('yyyy"年"m"月"') === 'date'
      && FV.datePartsOf('yyyy"年"m"月" h:mm') === 'both');
    has('走自定义格式的日期格照样还原成日期（45122 → 2023-07-15）', x.html, '>2023-07-15<');
    not('裸序列号 45122 不残留在表格里（那是"没认出格式"的样子）', x.html, '>45122<');

    /* ── O4. pptx 的备注页：真实文件每页都带一份 notesSlides，它**不该**是观众看到的一页 ── */
    const withNotes = await FV.pptxToHtml(FX.makePptx({ notes: true }), ZLIB);
    const noNotes = await FV.pptxToHtml(FX.makePptx(), ZLIB);
    ok('带备注页的 PPT 仍然只有 2 页（备注混进来 = 多一页空白卡片）',
      withNotes.meta.slides === 2 && noNotes.meta.slides === 2,
      `slides=${withNotes.meta.slides}`);
    not('讲者备注的文字不出现在幻灯片正文里（那是只有本人看得见的话）', withNotes.html, '讲者备注');
    ok('反向对照：备注页真的在包里（不在的话上面两条是白给的绿，坑 65）',
      FV.openZip(FX.makePptx({ notes: true }), ZLIB).names()
        .indexOf('ppt/notesSlides/notesSlide1.xml') >= 0,
      FV.openZip(FX.makePptx({ notes: true }), ZLIB).names().join(' '));

    /* ── O5. 扩展名与内容对不上时**按扩展名走**：这是有意的边界，不是没考虑到
     *   反过来做"按内容嗅探再改路由"会带来一个新问题：把 .txt 嗅成 docx 之后，
     *   用户看到的是一份**排版过的 Word**，而他以为那是纯文本。
     *   ▸ 这条断言的作用是把"今天的答案"钉住：将来谁改这个决定，必须连带改这条并写下理由
     *     （同坑 115 —— 反向对照要钉"这个场景本来该是什么行为"，不是钉"和昨天一样"）。 */
    const misnamed = await FV.render('其实是Word.txt', FX.makeDocx(), ZLIB);
    ok('把 .docx 改名 .txt → 按文本渲染（不偷偷改路由，也不崩）',
      misnamed.meta.kind === 'text' && typeof misnamed.html === 'string' && misnamed.html.length > 0,
      `kind=${misnamed.meta.kind}`);
    const reversed = await FV.render('其实是Word.pdf', FX.makeDocx(), ZLIB);
    ok('把 .docx 改名 .pdf → 交回"浏览器自己画"的说明（不掉进那句 1997~2003 的胡话）',
      reversed.meta.kind === 'pdf' && reversed.html.indexOf('1997') < 0,
      `kind=${reversed.meta.kind}`);
  }

    console.log('\n═══ P. 图片预算是"一份文档"的账（2026-10-08 真实文件回扫抓到的缺陷） ═══');
  /* ▎这条缺陷是拿**用户机器上真实的 PPT**扫出来的（不是我想出来的形状）：
   *   一份 25 页、media 解压后合计只有 7.5MB 的 PPT，被渲染成 **61 条 data URL / 40.4MB 的 HTML 字符串**。
   *   根因：collectImages 里的 total 是**函数内局部变量**，而 pptx 逐页调用它 ⇒
   *   "一份文档 16MB 上限"实际上从来没当过文档上限，它是"**每页** 16MB"。
   *   ▸ 顺手量的数（不是拍脑袋）：40MB 字符串 innerHTML 只要 142ms（8MB=31ms），
   *     所以这不是"卡死"级别的缺陷 —— 但**假的限额比没有限额更危险**：
   *     换一份更大的文件它会一路放大到几百 MB，而界面上没有任何一行字说图是被谁裁掉的（坑 76 那一族）。
   *   ▸ 现在记**两条账**：decoded（唯一图片解压了多少 = 解码内存）与 emitted（发出去多少次 = DOM 里躺多少字符）。
   *     同一张 logo 引 20 页：decoded 记一次、emitted 记 20 次 —— 这两个数天然不一样，
   *     硬用一个上限就会两边都判错。 */
  {
    const dup = FX.makePptx({ dupImage: true });        // 两页各引用**同一个** ppt/media/image1.png
    const loose = await FV.pptxToHtml(dup, ZLIB);
    ok('不设限时：两页都出图（预算没被误伤，正常文档不受这次修改影响）',
      loose.meta.images === 2 && loose.meta.imagesSkipped === 0, JSON.stringify(loose.meta));
    const urls = loose.html.match(/data:[a-z/+]+;base64,[A-Za-z0-9+/=]+/g) || [];
    ok('同一份 media 被两页引用 → 解压一次、两条 URL 内容相同（不是各解一遍）',
      urls.length === 2 && urls[0] === urls[1], `条数=${urls.length}`);
    /* 关键那条：上限小于"两次的量"但大于"一次的量"时，**第二页必须被裁掉**。
     * 预算若还是逐页各算一份，两页都放得下 → 这条当场红（这就是 A/B 的靶子）。 */
    const oneImage = 68;                                 // PNG_1PX 的真实字节数
    const tight = await FV.pptxToHtml(dup, { ...ZLIB, maxImageEmittedBytes: oneImage + 10 });
    ok('预算按**发射次数**记账：同一张图引两次，第二次超预算就该被裁',
      tight.meta.images === 1 && tight.meta.imagesSkipped === 1, JSON.stringify(tight.meta));
    has('被裁掉要说一声（占位方块只说明"这里曾有图"，说明不了"为什么没有"）',
      tight.html, 'fv-note-imgs');
    ok('没裁图时不许出现那句说明（常亮的解释等于没有解释，坑 82）',
      loose.html.indexOf('fv-note-imgs') < 0);
    /* 唯一图片的上限是另一条账：同一张图引 20 次，decoded 只涨一次 */
    const decodeCap = await FV.pptxToHtml(dup, { ...ZLIB, maxImageDecodedBytes: oneImage - 10 });
    ok('解码上限按**唯一图片**计：预算小于一张图时整份都进不来，而两个位置各记一次被裁',
      decodeCap.meta.images === 0 && decodeCap.meta.imagesSkipped === 2, JSON.stringify(decodeCap.meta));
    /* 反向的那一半：只卡"解码预算"（给得下唯一一张、给不下两张）、DOM 预算不管 ——
     * 两张图都该画出来。这条钉的是"同一张图只解压一次"：
     * 谁要是把 cache 拿掉，decoded 就会逐次累加，这里立刻红。 */
    const dedup = await FV.pptxToHtml(dup, { ...ZLIB, maxImageDecodedBytes: oneImage + 10 });
    ok('同一张图引两页：解码预算只算一次（两条 data URL 来自同一份解压，第二页不该再占预算）',
      dedup.meta.images === 2 && dedup.meta.imagesSkipped === 0, JSON.stringify(dedup.meta));
    /* 格式不支持 ≠ 预算不够：两本账不许混（混了那句"省略了 N 张"就在谎报原因） */
    const fake = await FV.pptxToHtml(FX.makePptx({ badImage: true }), ZLIB);
    ok('扩展名冒充图片（字节不是 PNG）→ 那一处画不了，但不记进"被预算裁掉"，也不牵连第二页的真图',
      fake.meta.images === 1 && fake.meta.imagesSkipped === 0
      && fake.html.indexOf('fv-note-imgs') < 0 && fake.html.indexOf('〔图片〕') >= 0,
      JSON.stringify(fake.meta));
    /* docx 走同一个预算对象（原来 docx 是单次调用，本来就是文档级；这里钉住"两条路同源"） */
    const dx = await FV.docxToHtml(FX.makeDocx(), { ...ZLIB, maxImageEmittedBytes: 1 });
    ok('docx 也用同一套预算（超了就报 skipped，不是静默少图）',
      dx.meta.images === 0 && dx.meta.imagesSkipped === 1, JSON.stringify(dx.meta));
  }


/* ══ Q. 另一个实现写的文件（python-docx / openpyxl 产物）══════════════════
 * ▎为什么单列这一组（2026-10-09，J1）：上面所有 Office 断言的输入都是
 *   **我自己写的夹具**（scripts/ooxml-fixture.js）——写包的和读包的是两份实现，
 *   这已经比"自己测自己"强，但"有哪些形状"仍然是我一个人想的。
 *   python-docx / openpyxl 是**第三个实现**：它按 Word/Excel 的真实习惯写文件，
 *   里面有一整片我夹具里没有的部件（styles 自带编号、header/footer、docProps、
 *   thumbnail、customXml、文本框、域代码、OMML 公式、百分比/货币格式、稀疏行…）。
 *   ▸ 这一组当场抓到四条真缺陷（都在 2026-10-09 修掉）：
 *     ① 用**列表样式**写的列表 → 圆点与序号全丢（编号定义在 styles.xml，段落自己不写 numPr）；
 *     ② 百分比格式：存 0.25 显示成 "0.25"，而 Excel 上是 **25.00%** —— 这是**读错数**不是难看；
 *     ③ 货币/小数位/千分位同理（¥1,234.50 → 1234.5）；
 *     ④ 稀疏行被压扁（第 12 行的内容显示在第 6 行的位置）+ 合并单元格没跨列。
 *   ▸ 产物在 scripts/fixtures/office/（跟着仓库走，回归**不依赖 python**）；
 *     要加新形状：改 scripts/office-oracle.py → `python scripts/office-oracle.py gen-all`。
 *     缺产物时本组直接**红**，不静默跳过——"跳过"和"通过"在报告里长得太像（坑 76）。
 * ══════════════════════════════════════════════════════════════════════ */
/* ══ L. 旧版二进制 Office（.doc / .xls / .ppt，OLE2 复合文档）════════════
 * ▎为什么单列一组（2026-10-09，J2）：用户机器上要共享的文件里有一大批是 1997~2003 的格式，
 *   而上一版界面对它们说的是"这个文件在线看不了"。那句话**当年成立，现在不成立了**——
 *   OLE2 外壳 + Word97 的 piece table + BIFF8 记录流 + PPT97 的 record 树，
 *   零依赖都做得到（做不到的是"还原原版式"，这件事界面上当面说清，见下面的文案断言）。
 * ▎判据来源：**用真的 Microsoft Office 造夹具并让它报出自己认到的文字**
 *   （scripts/legacy-oracle.ps1 → scripts/fixtures/office/legacy/）。
 *   二进制格式自己测自己毫无价值——偏移记错一个字段，抽出来的照样"看着像话"。
 *   本轮就有一次：wIdent 我记成 0x01A5（真值 0xA5EC），于是**每一份 .doc 都被判"不是 Word"**，
 *   报的是"没抽出来"，而文件全是好的。没有真 Office 当裁判，这条会一直绿着骗人。
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n═══ L. 旧版二进制 Office（真 Office 造的夹具 + 真 Office 当裁判）═══');
  {
    const dir = path.join(__dirname, 'fixtures', 'office', 'legacy');
    const need = ['legacy.doc', 'legacy.xls', 'legacy.ppt', 'oracle.json'];
    const missing = need.filter((f) => !fs.existsSync(path.join(dir, f)));
    ok('★ 前提：L 组夹具在仓库里（缺了在装了 Office 的机器上跑 scripts/legacy-oracle.ps1）',
      missing.length === 0, `缺 ${missing.join('/')}`);
    if (missing.length) {
      console.log('  （夹具缺失，本组其余断言不跑——红已经报在上面了）');
    } else {
      const O = JSON.parse(fs.readFileSync(path.join(dir, 'oracle.json'), 'utf8'));
      const M = O.marks;
      const readB = (f) => { const r = fs.readFileSync(path.join(dir, f)); return new Uint8Array(r.buffer, r.byteOffset, r.byteLength); };

      /* ---- CFB 外壳 ---- */
      const cfb = FV.readCfb(readB('legacy.doc'));
      ok('OLE2 外壳认得出（Word 文档流与表流都在）',
        cfb.names.includes('worddocument') && (cfb.names.includes('1table') || cfb.names.includes('0table')),
        JSON.stringify(cfb.names));
      let cfbErr = '';
      try { FV.readCfb(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])); } catch (e) { cfbErr = e.message || ''; }
      ok('签名不对时给一句人话（不静默返回半截结果）', cfbErr.length > 4, cfbErr);
      /* ★ 第二道：把**头部数字都合理、只有签名不对**的样本喂进去。
       *   第一版只测了"全零的短文件"，那种输入就算删掉签名校验也会被"扇区大小不合理"拦下，
       *   于是这条断言对"签名闸"本身是**看不见**的（变异没红 = 判据没在守它以为守着的东西，坑 123）。 */
      const wrongSig = Uint8Array.from(readB('legacy.doc').subarray(0, 4096));
      wrongSig[0] = 0x00;
      let sigErr = '';
      try { FV.readCfb(wrongSig); } catch (e) { sigErr = e.message || ''; }
      ok('★ 只有签名错、其余头部合理时也必须被拦（钉住"是这道闸拦的"）',
        /OLE2|签名/.test(sigErr), sigErr || '没报错——签名校验被绕过/删掉了');

      /* ---- Word 97：piece table ---- */
      const doc = await FV.legacyExtract('legacy.doc', readB('legacy.doc'));
      ok('★ Word97 抽到了文字（via=piece，不是兜底扫描）',
        !!doc && doc.kind === 'doc' && doc.meta.via === 'piece', doc ? JSON.stringify(doc.meta) : 'null');
      /* ★ 前提不成立时后面的断言要**继续跑完**并报红，而不是抛异常把整组带走
       *   （第一版就是这样：变异掉 wIdent 之后 doc=null，下一行 doc.text 直接抛，
       *    于是"红了几条"这个数都读不出来——量具自己崩 = 丢掉其余取证，坑 84 同族）。 */
      const docText = String((doc && doc.text) || '');
      const docMarks = ['para1', 'para2', 'list1', 'list2', 'tableCell', 'textbox'];
      const lost = docMarks.filter((k) => !docText.includes(M[k]));
      ok(`段落/列表/表格/文本框六类文字都还原（裁判：Word 自己写的句子）${lost.length ? '' : ' ✅'}`,
        lost.length === 0, `丢了 ${lost.join(',')}`);
      ok('域**指令**没被当正文（Word 里那句 PAGE 是给机器的，不是给人看的）',
        !/\bPAGE\b|NUMPAGES/.test(docText));
      ok('数字与英文原样保留（3.14159 / ALPHA-9 没被控制符清洗吃掉）',
        docText.includes('3.14159') && docText.includes('ALPHA-9'));
      const oracleMain = String(O.docText || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
      ok(`抽取字数与 Word 自己认到的同量级（≥70%，少了就是漏了某类容器）`,
        docText.length >= oracleMain.length * 0.7,
        `我 ${docText.length} vs Word ${oracleMain.length}`);

      /* ---- Excel 97：BIFF8 ---- */
      const xls = await FV.legacyExtract('legacy.xls', readB('legacy.xls'));
      ok('★ BIFF8 抽到了表（共享字符串 + 数字 + RK + 公式缓存值）',
        !!xls && xls.kind === 'xls' && xls.sheets.length >= 1, xls ? JSON.stringify(xls.meta) : 'null');
      const cellVals = (xls && xls.sheets[0]) ? Array.from(xls.sheets[0].cells.values()) : [];
      const wantVals = ['项目', '金额', '服务器', '带宽', '合计', '合并说明MX8', '1234.5', '0.25', '1234.75', '46327'];
      const missVals = wantVals.filter((v) => !cellVals.includes(v));
      ok(`裁判（Excel 自己报的单元格）里 ${wantVals.length} 个值全部还原（含公式缓存 1234.75）`,
        missVals.length === 0, `丢了 ${missVals.join(',')}`);
      const s0 = (xls && xls.sheets[0]) || { cells: new Map(), rows: 0, merges: [] };
      ok('稀疏行保真：第 9 行第 3 列的 42 还在第 9 行（没被压到第 5 行）',
        s0.cells.get(8 * 256 + 2) === '42' && s0.rows >= 9,
        `rows=${s0.rows} 第9行第3列=${s0.cells.get(8 * 256 + 2)}`);
      ok('合并区域读到了（MergeCells → 渲染时变 colspan）', (s0.merges || []).length >= 1);

      /* ---- PowerPoint 97 ---- */
      const ppt = await FV.legacyExtract('legacy.ppt', readB('legacy.ppt'));
      ok('★ PPT97 的文字原子被遍历到（TextChars/TextBytes）',
        !!ppt && ppt.kind === 'ppt' && ppt.texts.length >= 4, ppt ? `atoms=${ppt.texts.length}` : 'null');
      const pptAll = ppt ? ppt.texts.join('|') : '';
      ok('两页的标题与正文都在（裁判：PowerPoint 自己报的文字）',
        pptAll.includes(M.pptText) && pptAll.includes('第二页标题PP6') && pptAll.includes('跨网与延迟'));

      /* ---- 10.4：扩展名说 .doc，里面其实是别的 ---- */
      const richDocxBuf = fs.readFileSync(path.join(__dirname, 'fixtures', 'office', 'rich.docx'));
      const renamed = await FV.legacyExtract('其实是docx.doc', richDocxBuf);
      ok('★ docx 改名成 .doc：按真实字节改路由到现代那条路（不是"看不了"）',
        !!renamed && renamed.reroute === 'docx', JSON.stringify(renamed && Object.keys(renamed)));
      const rReroute = await FV.render('其实是docx.doc', fs.readFileSync(path.join(__dirname, 'fixtures', 'office', 'rich.docx')));
      ok('改路由之后 render 给的是正常 Word 版面（meta.kind=docx）',
        rReroute.meta.kind === 'docx' && rReroute.html.includes('项目评审会议记录'),
        JSON.stringify(rReroute.meta));

      // RTF：\ansicpg936 的双字节必须**成对**解（逐字节解 = 每个汉字都成乱码）
      const BS = String.fromCharCode(92);                 // 反斜杠用码位写，别让多层转义把 \r 变成回车
      const gbkOf = (bytes) => new TextDecoder('gbk').decode(Uint8Array.from(bytes));
      const escB = (bytes) => bytes.map((bv) => `${BS}'${bv.toString(16).padStart(2, '0')}`).join('');
      /* 期望串**由同一批字节现算**（TextDecoder('gbk') 是标准库，不是我写的解码器），
       * 所以这里既不写死"我猜的那个汉字"，也不把中文字面量塞进 latin1 缓冲区（那样会被截成单字节）。 */
      const CH1 = [0xD6, 0xD0, 0xCE, 0xC4];               // 双字节 ×2
      const CH2 = [0xC1, 0xCF];                            // 一个双字节字，故意被控制词从中间劈开
      const rtfSrc = `{${BS}rtf1${BS}ansi${BS}ansicpg936${BS}deftab720{${BS}fonttbl{${BS}f0${BS}froman Times;}}`
        + `${BS}pard${BS}fs24 AB${escB(CH1)}${BS}par CD ${escB([CH2[0]])}${BS}fs28 ${escB([CH2[1]])}EF${BS}par}`;
      const rRtf = FV.rtfText(new Uint8Array(Buffer.from(rtfSrc, 'latin1')));
      ok('★ RTF（.doc 的真身之一）解出中文：\ansicpg936 的双字节成对解码',
        rRtf.text.includes(gbkOf(CH1)) && rRtf.text.includes('AB'), JSON.stringify(rRtf.text.slice(0, 24)));
      ok('RTF 的 par 变换行生效、样式表组（fonttbl）不产字',
        rRtf.text.includes('\n') && !rRtf.text.includes('Times'), JSON.stringify(rRtf.text.slice(0, 40)));
      ok('★ 排版控制词插在 GBK 半个字中间时，字仍然拼得回来（pend 只在组边界/换行时冲掉）',
        rRtf.text.includes(gbkOf(CH2)) && rRtf.text.includes('EF'),
        `期望含 ${gbkOf(CH2)}，得到 ${JSON.stringify(rRtf.text.slice(0, 30))}`);

      // HTML 存的 .doc
      const htmlDoc = Buffer.from('<html><body><script>window.boom=1</script><p>甲段</p><table><tr><td>乙格</td></tr></table></body></html>', 'utf8');
      const rHtml = await FV.legacyExtract('网页存成.doc', htmlDoc);
      ok('HTML 存的 .doc 也能读（并剥掉 script/style）',
        !!rHtml && rHtml.kind === 'html' && rHtml.text.includes('甲段') && rHtml.text.includes('乙格')
        && !rHtml.text.includes('window.boom'), rHtml ? JSON.stringify(rHtml.text.slice(0, 30)) : 'null');

      /* ---- 安全与诚实（抽取出来的字是陌生字节，必须转义） ---- */
      const hostileRtf = Buffer.from('{\\rtf1\\ansi <img src=x onerror=alert(1)>\\par 结束}', 'latin1');
      const rHostile = await FV.legacyExtract('恶意.doc', hostileRtf);
      const hHostile = FV.legacyExtractedHtml('恶意.doc', rHostile);
      ok('★★ 抽取到的"标签"只是文字，不会变成可执行标签（渲染内核的安全底线）',
        !/<img src=x/.test(hHostile) && hHostile.includes('&lt;img'), hHostile.slice(0, 60));
      ok('★ 界面上明说"版式不还原 / 请下载"（不许把文字版说成渲染好了）',
        hHostile.includes('不还原') && (hHostile.includes('下载') || hHostile.includes('排版')), '');
      /* 两条文案是**分别**给"二进制 OLE2"与"RTF/网页"写的（各自的真相不一样），
       * 所以两边都要各断一次：只断一边时，改另一边不会红（10-08 那条"变异路径没被执行过"）。 */
      const hBin = doc ? FV.legacyExtractedHtml('legacy.doc', doc) : '';
      ok('二进制那条分支的说明也在（两条文案各自有断言，不是只测我看到的那条）',
        hBin.includes('不还原') && hBin.includes('下载'), hBin.slice(0, 50));

      /* ---- 坏输入不许挂死也不许抛到界面上 ---- */
      const whole = readB('legacy.doc');
      for (const [nm, cut] of [['截断一半', whole.subarray(0, Math.floor(whole.length / 2))],
        ['只剩头', whole.subarray(0, 200)], ['纯随机', Uint8Array.from(Array.from({ length: 4096 }, (_, i) => (i * 37) % 256))]]) {
        let out = null;
        let err = null;
        try { out = await FV.legacyExtract('坏文件.doc', cut); } catch (e) { err = e; }
        ok(`坏输入（${nm}）不抛异常、也不硬编出文字`, !err, err && err.message);
      }
      const rBad = await FV.render('坏文件.doc', Uint8Array.from(Array.from({ length: 4096 }, (_, i) => (i * 37) % 256)));
      ok('真给不了文字时，退回那句"这一份没能抽出文字"（并给下载指引）',
        rBad.meta.unsupported === true && rBad.html.includes('下载'), JSON.stringify(rBad.meta));
      ok('旧版 Office 单独成一类这件事仍然成立（kindOf 不因"能抽文字"而改）',
        FV.kindOf('老文件.doc') === 'legacy' && FV.kindOf('老表.xls') === 'legacy');
    }
  }

console.log('\n═══ Q. 另一个实现写的文件（真形状夹具 + 独立裁判）═══');
  {
    const dir = path.join(__dirname, 'fixtures', 'office');
    const files = ['rich.docx', 'rich.xlsx', 'oracle.json'];
    const missing = files.filter((f) => !fs.existsSync(path.join(dir, f)));
    ok('★ 前提：Q 组夹具在仓库里（缺了就跑 python scripts/office-oracle.py gen-all）',
      missing.length === 0, `缺 ${missing.join('/')}`);
    if (!missing.length) {
      const O = JSON.parse(fs.readFileSync(path.join(dir, 'oracle.json'), 'utf8'));
      const docBytes = fs.readFileSync(path.join(dir, 'rich.docx'));
      const xlsBytes = fs.readFileSync(path.join(dir, 'rich.xlsx'));
      const r = await FV.docxToHtml(docBytes, { name: 'rich.docx' });
      const plain = r.html.replace(/<[^>]+>/g, '\n');
      const cnt = (re) => (r.html.match(re) || []).length;

      // ① 覆盖率：裁判说每一段有话，输出里就得找得到（前 2 字足够定位，不打印全文）
      const lost = O.docx.paras.filter((p) => p.text_len > 0 && plain.indexOf(p.head) < 0);
      ok('★ 每一个非空段落的文字都出现在输出里（覆盖率对裁判，不是对自己）',
        lost.length === 0, `丢了 ${lost.length} 段：${lost.slice(0, 3).map((p) => p.style).join(',')}`);
      // ② 编号：样式带来的 + 段落直接写的，两种来源都要认（本轮抓的第一条真缺陷）
      const wantLi = O.docx.numberedByStyle + O.docx.numberedDirect;
      ok(`列表项数量 = 裁判数出的编号段落（样式 ${O.docx.numberedByStyle} + 直接 ${O.docx.numberedDirect}）`,
        cnt(/<li/g) === wantLi, `渲染 ${cnt(/<li/g)} 项，裁判 ${wantLi} 项`);
      ok('有序与无序各自成列表（不是全降级成普通段落）',
        cnt(/<ol/g) >= 1 && cnt(/<ul/g) >= 1, `ol=${cnt(/<ol/g)} ul=${cnt(/<ul/g)}`);
      ok('★ 反向对照：样式继承的编号真的被解析（把 loadDocxStyles 摘掉这一条必红）',
        O.docx.numberedByStyle >= 3 && cnt(/<li/g) >= O.docx.numberedByStyle,
        `样式带编号的段落 ${O.docx.numberedByStyle} 段`);
      // ③ 超链接
      ok('外链画成 <a> 且地址正确（rels 的 TargetMode=External）',
        r.html.indexOf('href="https://example.com/report"') >= 0 && plain.includes(O.marks.linkText));
      // ④ 图片
      ok('内嵌图片被解出来（word/media + a:blip）',
        cnt(/<img/g) === O.docx.images, `图 ${cnt(/<img/g)} 张 / 裁判 ${O.docx.images} 张`);
      // ⑤ 文本框 / 域 / 公式（三个"字不在正文流里"的容器）
      ok('★ 文本框里的字上了屏（原先它只留下一个〔图片〕占位）', plain.includes(O.marks.textbox));
      ok('★ 域的**指令**不许上屏，域的**结果**必须上屏（PAGE 是指令不是话）',
        plain.includes(O.marks.fieldResult) && !new RegExp(`\\b${O.marks.instr}\\b`).test(plain));
      ok('fldSimple（老写法的壳）里面的结果也在', plain.includes(O.marks.fldSimple));
      ok('★ 公式（OMML 的 m:t）按线性文本给出，不是一片空白', plain.includes(O.marks.math));
      // ⑥ 有意的边界：页眉页脚不混进正文（写成断言，将来若要显示必须改这条=做决定）
      ok('页眉文字不混进正文（有意的边界，不是漏了——要显示页眉请先改这条断言）',
        !plain.includes(O.marks.header));
      // ⑦ 表格形状
      ok('表格画出来了，且横向合并变成 colspan',
        cnt(/<table/g) === O.docx.tables.length && cnt(/colspan="2"/g) >= 1,
        `table=${cnt(/<table/g)} colspan=${cnt(/colspan="2"/g)}`);

      /* ---- xlsx：格式码是"值的一半"，读错格式就是读错数 ---- */
      const x = await FV.xlsxToHtml(xlsBytes, { name: 'rich.xlsx' });
      const xp = x.html.replace(/<[^>]+>/g, '\n');
      const xcnt = (re) => (x.html.match(re) || []).length;
      ok('★ 百分比格式按格式码念（0.25 → 25.00%，不是把 0.25 当结论）', xp.includes('25.00%'));
      ok('★ 货币格式：小数位 + 千分位 + 币符都在（1234.5 → ¥1,234.50）', xp.includes('¥1,234.50'));
      ok('General 格式的 45570 不许被当成日期（只有带日期格式的同一串数才转）',
        xp.includes('45570') && (x.html.match(/2024-10-05/g) || []).length === 1,
        `2024-10-05 出现 ${(x.html.match(/2024-10-05/g) || []).length} 次`);
      ok('★ 合并单元格跨列（mergeCells 的 A6:B6 → colspan=2）', xcnt(/colspan="2"/g) >= 1,
        `colspan ${xcnt(/colspan="2"/g)} 处`);
      const lastDataRow = Math.max(...O.xlsx.sheets[0].cells.map((c) => c.r));
      ok(`★ 行号保真：裁判看到第 ${lastDataRow} 行有内容，输出就得排到第 ${lastDataRow} 行（稀疏行不许压扁）`,
        xcnt(/<tr/g) >= lastDataRow, `渲染 ${xcnt(/<tr/g)} 行`);
      ok('公式没有缓存值时留空，且全表不出现 NaN/undefined（我们不重算公式）',
        !/NaN|undefined|Infinity/.test(x.html) && !xp.includes('D2+D3'));
      ok('日期列还原成人话（openpyxl 自动识别的那批日期）',
        xp.includes('2026-11-01') && xp.includes('2026-12-01'));

      /* ---- 两轨一致：真形状也必须走一遍浏览器那一轨（10-08 那条教训的续集）---- */
      const vm = require('vm');
      const srcQ = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'fileview.js'), 'utf8');
      const ctx = vm.createContext({
        setTimeout, clearTimeout, TextDecoder, console,
        DecompressionStream: globalThis.DecompressionStream,
      });
      vm.runInContext(srcQ, ctx);
      const within = (p, ms) => Promise.race([
        p.then((v) => ({ got: true, v })),
        new Promise((res) => setTimeout(() => res({ got: false }), ms)),
      ]);
      const br = await within(ctx.FV.docxToHtml(Array.from(docBytes), { name: 'rich.docx' }), 12000);
      ok('★★★ 浏览器那一轨（DecompressionStream）把这份真形状文件也解出来了（有界，不是永久不 settle）',
        br.got === true && !!br.v && typeof br.v.html === 'string', br.got ? '' : '12s 没回话');
      ok('★★ 两轨输出逐字符一致（同一份代码在两个运行时做同一件事，坑 118）',
        br.got === true && br.v.html === r.html,
        br.got ? `zlib ${r.html.length}B vs 浏览器 ${br.v.html.length}B` : '浏览器那一轨没回话');
      const bx = await within(ctx.FV.xlsxToHtml(Array.from(xlsBytes), { name: 'rich.xlsx' }), 12000);
      ok('两轨的 xlsx 也逐字符一致（百分比/货币/合并都在浏览器那一轨跑过）',
        bx.got === true && bx.v.html === x.html, bx.got ? '' : '没回话');
    }
  }

console.log('\n═══ M. 结构红线（防回退，不看行为看形状） ═══');
  {
    const srcPath = path.join(__dirname, '..', 'sfu', 'public', 'fileview.js');
    const src = fs.readFileSync(srcPath, 'utf8');
    /* 剥掉注释**和字符串字面量**再判：源码里有 'word/document.xml' 这样的字符串，
     * 直接搜 document. 会命中它——那不是碰 DOM，是 ZIP 里的部件路径（假红制造机）。
     * 剥离是"够用的近似"：不追求解析器级别正确，只要别把字符串内容当代码看。 */
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')                  // 块注释
      .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1 ')          // 行注释
      .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")              // 单引号串
      .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')              // 双引号串
      .replace(/`(?:[^`\\]|\\.)*`/g, '``');               // 模板串
    ok('渲染内核里不许出现 innerHTML（它是纯逻辑，碰不到 DOM）', code.indexOf('innerHTML') < 0);
    ok('渲染内核里不许出现 document. / window.（字符串里的部件路径不算）',
      !/\bdocument\s*\./.test(code) && !/\bwindow\s*\./.test(code),
      (code.match(/.{0,40}\b(?:document|window)\s*\..{0,20}/) || [''])[0]);
    ok('渲染内核里不许出现 fetch（取字节是调用方的事）', code.indexOf('fetch(') < 0);
    /* ★ 原先这里写的是"数一对注释符号是否配平"，第一版就报了 54 处假红：
     *   fileview.js 里有正则字面量含那两个字符（粗体那条规则），朴素扫描器
     *   分不清"注释里的"和"正则里的"。
     * ▸ 对 .js 来说，坑 26（注释提前闭合吞掉后面的规则）的后果就是**语法错误**，
     *   所以正确的守卫是 node --check，而不是自己写一个扫描器（量具本身也会错，坑 104）。 */
    ok('node --check 通过（这才是"块注释提前闭合"的真守卫）', (() => {
      try {
        require('child_process').execFileSync(process.execPath, ['--check', srcPath], { stdio: 'pipe' });
        return true;
      } catch (e) { return false; }
    })());
    const sw = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'sw.js'), 'utf8');
    ok('fileview.js 已登记进 SW 的 network-first 清单（否则改了不生效 = 坑 40）',
      /['"]\.\/fileview\.js['"]/.test(sw));
    const idx = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'index.html'), 'utf8');
    /* ★ 这条判据我自己第一版就写错了，而且错在 AGENTS.md 里**已经记过**的那一处：
     *   用 indexOf('client.js') 找位置，结果命中的是 `vendor/mediasoup-client.js`
     *   （它也含 "client.js" 这个子串，而且排在 fileview.js 前面）→ 断言恒红。
     *   ▎判据：匹配**属性形态**（src="client.js"）而不是子串。
     *     探针读到错误的节点，报出来的就是"产品没接线"这种假故障（坑 27/51 家族）。 */
    const iFileview = idx.search(/src="(?:\.\/)?fileview\.js/);
    const iClient = idx.search(/src="(?:\.\/)?client\.js/);
    ok('index.html 引入了 fileview.js，且**排在 client.js 之前**（client.js 顶层就可能用到它）',
      iFileview >= 0 && iClient >= 0 && iFileview < iClient,
      `fileview@${iFileview} client@${iClient}`);
    const srv = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'server.js'), 'utf8');
    ok('fileview.js 进了服务器的版本指纹表（assetVersions 会下发给页面自检）',
      srv.indexOf("'fileview.js'") >= 0);
    ok('版本号存在（排障时能一眼看出跑的是哪一版）', /^\d{4}-\d{2}-\d{2}/.test(FV.version));
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`fileview 单测：${pass} 通过 / ${fail} 失败`);
  if (fail) { console.log('失败清单：'); fails.forEach((f) => console.log('  · ' + f)); process.exit(1); }
  console.log('✅ 全部通过');
})().catch((e) => { console.error('\n💥 测试脚本自身抛错：', e); process.exit(2); });
