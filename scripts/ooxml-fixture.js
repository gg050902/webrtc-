/* =============================================================================
 *  scripts/ooxml-fixture.js —— 测试夹具：在 Node 里**现场造出**真的 Office 文件
 * =============================================================================
 * ▎为什么需要它（这是本套测试能成立的前提）：
 *   `sfu/public/fileview.js` 是"自己读 ZIP + 自己解 XML"的渲染内核，
 *   要验证它就必须喂它**真的 docx / xlsx / pptx 字节**。三条路：
 *     ① 仓库里放几个真实 Office 文件 —— 二进制进 git、体积大、而且**没人知道里面写了什么**，
 *        断言只能写成"输出里包含某个词"，改一次 Office 版本就得重录；
 *     ② 让用户提供 —— 测试就跑不动了（CI/换机器全断）；
 *     ③ **在测试里按 OOXML 规范现场生成** —— 内容完全可控、可穷举断言、零依赖、零二进制。
 *   选 ③。代价是要自己写一个 ZIP 打包器（~60 行），而它同时把"我理解 ZIP 结构"这件事
 *   变成了可执行的事实：**写不出打包器，就说明读包器也只是照着文档抄的**。
 *
 * ▎与 fileview.js 的关系：这里是**独立的第二个实现**（一个写、一个读）。
 *   这不是坑 47 说的"同一概念两处实现"——写与读是两个概念，
 *   而**两个独立实现对同一份字节达成一致**正是最强的证据（比自己测自己硬得多）。
 * ============================================================================= */
'use strict';
const zlib = require('zlib');

/* ---- CRC32（ZIP 必需；用标准多项式，表驱动） ---- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** 1×1 的合法 PNG（base64 常量）——图片类断言只需要"魔数对 + 能塞进 data: URL"。 */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

/* =============================================================================
 * ZIP 打包
 *   entries: [{ name, data: Buffer|Uint8Array|string, store?: true(不压缩) }]
 *   opts:    { zip64?: true, comment?: string }
 * ============================================================================= */
function zipSync(entries, opts) {
  const o = opts || {};
  const local = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const comp = e.store ? data : zlib.deflateRawSync(data);
    const method = e.store ? 0 : 8;
    const crc = crc32(data);

    /* ZIP64 档：把三个尺寸字段写成 0xFFFFFFFF，真值放进额外字段 0x0001。
     * ▎这不是"假装很大"——ZIP64 的**结构**就是这样，文件本身可以很小。
     *   读包器里那段 ZIP64 解析如果没有夹具，它就是一段永远不执行的代码（坑 76）。 */
    const useZ64 = !!o.zip64;
    const extra = useZ64 ? (() => {
      const b = Buffer.alloc(4 + 24);
      b.writeUInt16LE(0x0001, 0);
      b.writeUInt16LE(24, 2);
      b.writeBigUInt64LE(BigInt(data.length), 4);
      b.writeBigUInt64LE(BigInt(comp.length), 12);
      b.writeBigUInt64LE(BigInt(offset), 20);
      return b;
    })() : Buffer.alloc(0);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);                 // version needed
    lh.writeUInt16LE(0x0800, 6);             // flags: 文件名是 UTF-8
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10);                 // mod time
    lh.writeUInt16LE(0x21, 12);              // mod date（1996-01-01，随便一个合法值）
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(useZ64 ? 0xffffffff : comp.length, 18);
    lh.writeUInt32LE(useZ64 ? 0xffffffff : data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(extra.length, 28);      // ★ 本地头也要带上同样的 extra（长度必须一致才对齐）
    local.push(lh, nameBuf, extra, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);                 // version made by
    ch.writeUInt16LE(20, 6);                 // version needed
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(useZ64 ? 0xffffffff : comp.length, 20);
    ch.writeUInt32LE(useZ64 ? 0xffffffff : data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(extra.length, 30);
    ch.writeUInt16LE(0, 32);                 // comment len
    ch.writeUInt16LE(0, 34);                 // disk number start
    ch.writeUInt16LE(0, 36);                 // internal attrs
    ch.writeUInt32LE(0, 38);                 // external attrs
    ch.writeUInt32LE(useZ64 ? 0xffffffff : offset, 42);
    central.push(ch, nameBuf, extra);

    offset += lh.length + nameBuf.length + extra.length + comp.length;
  }

  const cdBuf = Buffer.concat(central);
  const tail = [];
  let cdOffset = offset;
  let cdSize = cdBuf.length;
  let count = entries.length;

  if (o.zip64) {
    // ZIP64 EOCD（56 字节）+ 定位器（20 字节），插在中央目录之后、EOCD 之前
    const z64 = Buffer.alloc(56);
    z64.writeUInt32LE(0x06064b50, 0);
    z64.writeBigUInt64LE(BigInt(44), 4);        // 本记录剩余长度
    z64.writeUInt16LE(45, 12); z64.writeUInt16LE(45, 14);
    z64.writeUInt32LE(0, 16); z64.writeUInt32LE(0, 20);
    z64.writeBigUInt64LE(BigInt(count), 24);
    z64.writeBigUInt64LE(BigInt(count), 32);
    z64.writeBigUInt64LE(BigInt(cdSize), 40);
    z64.writeBigUInt64LE(BigInt(cdOffset), 48);
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x07064b50, 0);
    loc.writeUInt32LE(0, 4);
    loc.writeBigUInt64LE(BigInt(cdOffset + cdSize), 8);
    loc.writeUInt32LE(1, 16);
    tail.push(z64, loc);
    cdOffset = 0xffffffff; cdSize = 0xffffffff; count = 0xffff;
  }

  const comment = Buffer.from(o.comment || '', 'utf8');
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...local, cdBuf, ...tail, eocd, comment]);
}

/* ---- 三份共用的包装件（Office 每个包都要有） ---- */
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function contentTypes(extra) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
${extra || ''}
</Types>`;
}

/* =============================================================================
 * docx（Word）
 * ============================================================================= */
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** 造一个内容完全已知的 .docx。
 *  里面有：一级标题、粗体/斜体、一段**必须被转义**的脚本文字、无序列表、有序子列表、
 *  2×2 表格、外部超链接、一张内嵌 PNG。这些正好是渲染器的七条能力线。 */
function makeDocx(opts) {
  const o = opts || {};
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>项目评审会</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>加粗</w:t></w:r><w:r><w:t>与普通</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>斜体</w:t></w:r></w:p>
<w:p><w:r><w:t>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;粗&lt;/b&gt;</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>第一条</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>第二条</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>编号子项</w:t></w:r></w:p>
<w:tbl>
<w:tr><w:tc><w:p><w:r><w:t>格A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>格B</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>合并格</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>
  ${o.vMerge ? `<w:tbl>
  <w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>负责人</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>甲</w:t></w:r></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p><w:r><w:t>乙</w:t></w:r></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p><w:r><w:t>丙</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>
  <w:tbl>
  <w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>宽表头</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>竖</w:t></w:r></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:p><w:r><w:t>横一</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>横二</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr>
</w:tbl>` : ''}
  ${o.nested ? /* 表格里套表格，再套一层（真实 Word 论文/课设的常见形状：成绩表里的"备注"格放一张小表）。
     内核的 docxBlocks 对 w:tbl 是递归的，但这条形状以前**只在脑子里成立过**——
     夹具里没有它，所以"嵌套到底画不画得出来"从来没有证据（坑 130：自己写的夹具测的是记忆不是能力）。
     外层单元格用 <w:sdt> 再包一层内表，顺手把"内容控件里嵌表"这条也一起钉住。 */ `
<w:tbl>
  <w:tr>
    <w:tc><w:p><w:r><w:t>外层左</w:t></w:r></w:p></w:tc>
    <w:tc>
      <w:tbl>
        <w:tr><w:tc><w:p><w:r><w:t>中层甲</w:t></w:r></w:p></w:tc>
            <w:tc><w:sdt><w:sdtContent>
              <w:tbl><w:tr><w:tc><w:p><w:r><w:t>最里层</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
            </w:sdtContent></w:sdt></w:tc></w:tr>
        <w:tr><w:tc><w:p><w:r><w:t>中层乙</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>中层丙</w:t></w:r></w:p></w:tc></w:tr>
      </w:tbl>
    </w:tc>
  </w:tr>
  <w:tr><w:tc><w:p><w:r><w:t>外层下</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>&nbsp;</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>` : ''}
<w:p><w:hyperlink r:id="rId5"><w:r><w:t>外部链接</w:t></w:r></w:hyperlink></w:p>
<w:p><w:hyperlink r:id="rId6"><w:r><w:t>内部锚点</w:t></w:r></w:hyperlink></w:p>
${o.noImage ? '' : `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="图一" descr="示意图"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="图一" descr="示意图"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId10"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`}
<w:p><w:r><w:t xml:space="preserve">尾部保留空格  </w:t></w:r></w:p>
</w:body></w:document>`;

  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${W_NS}>
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2."/></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/a_(b)" TargetMode="External"/>
<Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="#_Toc123" TargetMode=""/>
<Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`;

  const files = [
    { name: '[Content_Types].xml', data: contentTypes('<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>') },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'word/document.xml', data: document },
    { name: 'word/numbering.xml', data: numbering },
    { name: 'word/_rels/document.xml.rels', data: rels },
  ];
  if (!o.noImage) files.push({ name: 'word/media/image1.png', data: PNG_1PX, store: true });
  return zipSync(files, o);
}

/* =============================================================================
 * xlsx（Excel）
 *   ★ 关键：字符串走共享字符串表（t="s" + 下标），日期是"数字 + 数字格式"。
 *     夹具必须把这两条都造出来，否则测不到解析器最容易漏的那两步。
 * ============================================================================= */
function makeXlsx(opts) {
  const o = opts || {};
  const shared = ['项目', '金额', '日期', '备注', '张三', '#DIV/0!'];
  const sst = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">
${shared.map((s) => `<si><t>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`).join('')}
</sst>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2">
<numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/>
<numFmt numFmtId="165" formatCode="#,##0.00"/>
<numFmt numFmtId="166" formatCode='yyyy"年"m"月"'/>
</numFmts>
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border/></borders>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>
</cellXfs>
</styleSheet>`;

  /* 第 1 行表头（共享字符串）；第 2 行：字符串 / 小数 / 日期序列号(s=1) / 千分位(s=2) / 公式结果串 / 错误值 / 布尔
   * ▸ C2 的 45122 = 2023-07-15（这条是"日期到底还原没有"的判据）。
   * ▸ D2 留空（空格子在 xlsx 里根本不写出来）——顺带测稀疏列的定位。 */
  const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
<row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2"><v>1234.5</v></c><c r="C2" s="1"><v>45122</v></c><c r="E2" s="2"><v>9876.54321</v></c><c r="F2" t="str"><v>合计</v></c><c r="G2" t="e"><v>#DIV/0!</v></c><c r="H2" t="b"><v>1</v></c></row>
<row r="4"><c r="B4" t="inlineStr"><is><t>行内字符串</t></is></c></row>
<row r="5"><c r="A5" t="s"><v>1</v></c><c r="B5"><f>B2*2</f><v>2469</v></c><c r="C5" s="3"><v>45122</v></c></row>
<row r="6"><c r="A6"><f>SUM(B2:B5)</f></c></row>
</sheetData>
</worksheet>`;

  const sheet2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData><row r="1"><c r="A1" t="s"><v>3</v></c></row></sheetData>
</worksheet>`;

  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="会议预算" sheetId="1" r:id="rId1"/><sheet name="名单" sheetId="2" r:id="rId2"/></sheets>
</workbook>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  return zipSync([
    { name: '[Content_Types].xml', data: contentTypes('<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>') },
    // ★ 故意把根 .rels 指向 xl/workbook.xml（真实文件就是这样），测"按名取件"而不是"按顺序猜"
    { name: '_rels/.rels', data: ROOT_RELS.replace('word/document.xml', 'xl/workbook.xml') },
    { name: 'xl/workbook.xml', data: wb },
    { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
    { name: 'xl/sharedStrings.xml', data: sst },
    { name: 'xl/styles.xml', data: styles },
    { name: 'xl/worksheets/sheet1.xml', data: sheet1 },
    { name: 'xl/worksheets/sheet2.xml', data: sheet2 },
  ], o);
}

/* =============================================================================
 * pptx（PPT）
 * ============================================================================= */
const P_NS = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function makePptx(opts) {
  const o = opts || {};
  const presentation = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation ${P_NS}>
<p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst>
<p:sldSz cx="12192000" cy="6858000"/>
</p:presentation>`;

  const presRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>`;

  /* slide1：一个有 xfrm 的标题框（44pt）+ 一个带项目符号的正文框（含一次换行 a:br）。
   * ▸ 44pt 在 12192000 EMU 宽的幻灯片上 = 44*12700/12192000*100 = 4.5850 cqw —— 断言就钉这个数。 */
  /* o.dupImage：让第一页也引用**同一份** ppt/media/image1.png（真实 PPT 里"每页同一个 logo"是常态）。
   * ▸ 这个夹具存在的意义：预算若是逐页各算一份，这份文件根本看不出问题——两张都放得下。
   * o.badImage：扩展名写着 .png、字节根本不是图片（真实世界有人把 .emf 改名塞进 PPT）。
   * ▸ 它必须**不算进"被预算裁掉"那本账**：「这格式画不了」与「预算不够被裁」是两件事。 */
  const dupPic = o.dupImage ? `
<p:pic><p:nvPicPr><p:cNvPr id="8" name="同一个 logo" descr="与第二页同一份 media 文件"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId7"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="200000" y="200000"/><a:ext cx="1000000" cy="800000"/></a:xfrm></p:spPr></p:pic>` : '';
  const badPic = o.badImage ? `
<p:pic><p:nvPicPr><p:cNvPr id="9" name="假 png" descr="扩展名与字节不符"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId8"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="400000" y="400000"/><a:ext cx="1000000" cy="800000"/></a:xfrm></p:spPr></p:pic>` : '';
  const slide1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${P_NS}><p:cSld><p:spTree>${dupPic}${badPic}
<p:sp><p:nvSpPr><p:cNvPr id="2" name="标题 1"/><p:cNvSpPr/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1600200"/></a:xfrm></p:spPr>
<p:txBody><a:bodyPr/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="4400" b="1"/><a:t>季度评审</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="内容 2"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="838200" y="2222500"/><a:ext cx="10515600" cy="3683000"/></a:xfrm></p:spPr>
<p:txBody><a:bodyPr/>
<a:p><a:pPr lvl="0"><a:buChar char="•"/></a:pPr><a:r><a:rPr sz="2000"/><a:t>第一条要点</a:t></a:r></a:p>
<a:p><a:pPr lvl="0"><a:buChar char="•"/></a:pPr><a:r><a:rPr sz="2000"/><a:t>第二条</a:t></a:r><a:br/><a:r><a:rPr sz="2000"/><a:t>换行后半句</a:t></a:r></a:p>
<a:p><a:pPr lvl="0"><a:buNone/></a:pPr><a:endParaRPr sz="2000"/></a:p>
</p:txBody></p:sp>
<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="表格 3"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="838200" y="6000000"/><a:ext cx="6000000" cy="600000"/></p:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
<a:tbl><a:tr h="300000"><a:tc><a:txBody><a:p><a:r><a:t>列一</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>列二</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
<a:tr h="300000"><a:tc><a:txBody><a:p><a:r><a:t>甲</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>乙</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl>
</a:graphicData></a:graphic></p:graphicFrame>
</p:spTree></p:cSld></p:sld>`;

  const slide2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${P_NS}><p:cSld><p:spTree>${badPic}
<p:pic><p:nvPicPr><p:cNvPr id="2" name="图片 1" descr="架构图"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="4000000" cy="3000000"/></a:xfrm></p:spPr></p:pic>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="无框占位"/><p:cNvSpPr/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>
<p:txBody><a:p><a:r><a:rPr sz="1800"/><a:t>没有坐标的占位符</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>`;

  /* 备注页：真实 pptx **每页都有一份** notesSlides/notesSlideN.xml（讲者备注），
   * 由 slide 自己的 rels 指过去。它不该出现在观众看到的幻灯片里——
   * 而"按文件名列举"这种偷懒写法正好会把它当一页画出来。 */
  const notes = o.notes ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes ${P_NS}><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm></p:spPr>
<p:txBody><a:lstStyle/><a:p><a:r><a:t>讲者备注：这段只有我自己看得见</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>` : '';
  const dupRels = o.dupImage ? `
<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>` : '';
  const badRels = o.badImage ? `
<Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/fake.png"/>` : '';
  const slide1Rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${dupRels}${badRels}${o.notes ? `
<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>` : ''}</Relationships>`;
  const slide2Rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>${badRels}
</Relationships>`;

  return zipSync([
    { name: '[Content_Types].xml', data: contentTypes('<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>') },
    { name: '_rels/.rels', data: ROOT_RELS.replace('word/document.xml', 'ppt/presentation.xml') },
    { name: 'ppt/presentation.xml', data: presentation },
    { name: 'ppt/_rels/presentation.xml.rels', data: presRels },
    { name: 'ppt/slides/slide1.xml', data: slide1 },
    { name: 'ppt/slides/slide2.xml', data: slide2 },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: slide1Rels },
    { name: 'ppt/slides/_rels/slide2.xml.rels', data: slide2Rels },
    { name: 'ppt/media/image1.png', data: PNG_1PX, store: true },
    /* o.badImage：扩展名 .png、字节根本不是图片（真实世界有人把 .emf 改名塞进 PPT） */
    ...(o.badImage ? [{ name: 'ppt/media/fake.png', data: Buffer.from('这不是图片的字节，只是扩展名冒充了 png', 'utf8'), store: true }] : []),
  ].concat(o.notes ? [{ name: 'ppt/notesSlides/notesSlide1.xml', data: notes }] : []), o);
}


/* ── PDF 夹具（2026-10-08，I1）：手写一个**最小但合法**的 PDF ──────────────
 * ▎为什么自己写而不从网上拷一份样本：这份夹具的用途是"让断言有内容可差"——
 *   第一页画一大块**黑**、第二页留白，于是"浏览器内置阅读器真的解码了我给的字节"
 *   这件事可以用一个像素差来证（两页都空白 = 它没画，判红）。
 *   网上拷的样本改不动它的像素构成，也就给不出这种 A/B。
 * ▎PDF 的结构（和 ZIP 一样"从尾巴读"）：一堆对象 + `xref` 表（每个对象在第几字节）
 *   + `trailer`（/Root 指向目录对象）。所以这里最重要的是**字节偏移必须算准**——
 *   偏移错一位，阅读器就报"文件已损坏"，而那看起来像"功能坏了"。
 * ▎单位是 pt（1/72 英寸），坐标原点在**左下角**（和网页相反），A4 是 595×842。 */
function makePdf(opts) {
  const o = opts || {};
  const pages = Math.max(1, Math.min(6, Number(o.pages) || 2));
  const W = 420, H = 300;                        // 小页面：截图量起来便宜
  /* ▎这里刻意**不写反斜杠转义**（NL 拼出来）：夹具生成器本身也是被测代码，
   *   字符串里混进真换行会让 JS 语法错——而 PDF 的语法恰好就是"按行"的，
   *   所以用 NL 常量拼反而更像在写 PDF，而不是在逃离转义地狱。 */
  const NL = String.fromCharCode(10);
  const objs = [];
  const fontId = 3 + pages * 2;                  // 1=Catalog 2=Pages 3..=Page/Content 交替
  const kids = [];
  for (let i = 0; i < pages; i++) kids.push((3 + i * 2) + ' 0 R');
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages + ' >>';
  for (let i = 0; i < pages; i++) {
    const pageId = 3 + i * 2, contId = pageId + 1;
    // 第一页涂一块黑（darkFirst:false 时两页都白 —— 那正是"内容差"的反例对照）
    const dark = (i === 0 && o.darkFirst !== false);
    let stream = 'BT /F1 20 Tf 24 ' + (H - 40) + ' Td (Page ' + (i + 1) + ') Tj ET' + NL;
    /* 黑块画在**页面上半部**：PDF 坐标原点在左下角，而内置阅读器是按宽适配，
     *   竖着看的 iframe 只看得见页面上半截 —— 画在下面等于没画
     *   （第一版就是这么量不出两页的差值，白测一场）。 */
    if (dark) stream += '0 0 0 rg' + NL + '40 ' + Math.round(H * 0.42) + ' '
      + (W - 80) + ' ' + Math.round(H * 0.46) + ' re f' + NL;
    objs[pageId] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] '
      + '/Resources << /Font << /F1 ' + fontId + ' 0 R >> >> /Contents ' + contId + ' 0 R >>';
    // /Length 必须是**字节**长度（不是字符数）。这里全 ASCII，两者相等，但注释留着防后来人加中文
    objs[contId] = 'STREAM:::' + stream;
  }
  objs[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  let out = '%PDF-1.4' + NL + '% fixture comment' + NL;
  const offsets = [];
  for (let id = 1; id < objs.length; id++) {
    const b = objs[id];
    if (b === undefined) continue;
    offsets[id] = Buffer.byteLength(out, 'binary');
    if (b.indexOf('STREAM:::') === 0) {
      const data = b.slice(9);
      out += id + ' 0 obj' + NL + '<< /Length ' + Buffer.byteLength(data, 'binary') + ' >>'
        + NL + 'stream' + NL + data + 'endstream' + NL + 'endobj' + NL;
    } else {
      out += id + ' 0 obj' + NL + b + NL + 'endobj' + NL;
    }
  }
  const count = offsets.length;
  const xrefAt = Buffer.byteLength(out, 'binary');
  out += 'xref' + NL + '0 ' + count + NL + '0000000000 65535 f ' + NL;
  for (let id = 1; id < count; id++) {
    out += String(offsets[id] || 0).padStart(10, '0') + ' 00000 n ' + NL;
  }
  out += 'trailer' + NL + '<< /Size ' + count + ' /Root 1 0 R >>' + NL
    + 'startxref' + NL + xrefAt + NL + '%%EOF' + NL;
  return Buffer.from(out, 'binary');
}

module.exports = { crc32, zipSync, makeDocx, makeXlsx, makePptx, makePdf, PNG_1PX };
