/* =============================================================================
 *  sfu/public/fileview.js —— 共享文件的**零依赖渲染内核**（第 51 步 · 2026-10-07）
 * =============================================================================
 * ▎它是什么：把"会议室里常见的那些文档"在浏览器里直接画出来的那一层纯逻辑——
 *   Markdown / CSV / TXT / JSON / **docx（Word）** / **xlsx（Excel）** / **pptx（PPT）**。
 *   PDF 与图片走浏览器原生能力（<iframe> 内置阅读器 / <img>），不需要解析器；
 *   旧版二进制 Office（.doc/.xls/.ppt）如实报"请下载后查看"——那三种格式没有
 *   公开的可解析结构，任何"零依赖渲染"的说法在这里都是吹牛（见 legacyKind）。
 *
 * ▎为什么自己写，而不用 pdf.js / mammoth / sheetjs：
 *   本项目的红线是**零依赖 + 可离线**（内网部署、PWA 断网外壳都要成立）。
 *   而 OOXML（docx/xlsx/pptx）的本质是"**一个 ZIP 包里的几份 XML**"——
 *   ZIP 的解压器浏览器早就内置了（`DecompressionStream('deflate-raw')`，Chrome 103+），
 *   XML 只需要一个几百行的容错解析器。于是"读 Office 文件"这件事
 *   在本项目里**可以不装任何东西做到**。这一段是本功能最值得讲清楚的部分。
 *
 * ▎架构纪律（与 countup.js / nets.js 同一条）：
 *   **本文件里没有 DOM、没有网络、没有全局可变状态**——输入字节，输出 HTML 字符串。于是：
 *     · Node 里能直接单测（`npm run test:fileview`），穷举断言几毫秒跑完；
 *     · 浏览器里 client.js 只管"取字节 → 塞进容器 → 处理滚动/缩放"；
 *     · 判据只有一处，两端不会漂（坑 47）。
 *   平台差异（解压 / 文本解码）用**注入**解决：`opts.inflate` / `opts.inflateRaw`，
 *   不在函数体里到处 `if (typeof window …)`。
 *
 * ▎安全（这一层渲染的是**别人上传的字节**，必须先讲清楚）：
 *   ① 所有文字**先转义再拼接**——结构上不可能产出用户给的标签；
 *   ② 链接只放行 http/https/mailto/tel 与相对路径，`javascript:` `data:` 一律降级成纯文字
 *      （并且先删掉控制字符与空白，防 `java\tscript:` 这类绕过）；
 *   ③ 服务器那侧还有一道：文本类一律 `text/plain`、非安全类型强制
 *      `Content-Disposition: attachment`（.md 里写 <script> 直接打开也不会执行）。
 *   两道加起来才是完整答案——只有前端转义，遇到"在新标签里直接打开下载链接"就漏了。
 *
 * ▎诚实边界（写在这里，别等答辩被问）：
 *   · docx/xlsx/pptx 只还原**文字与基本结构**（标题/列表/表格/图片/幻灯片版面），
 *     不做分页、不做页眉页脚、不做 SmartArt/图表/公式（那是几十 MB 的渲染引擎的活）；
 *   · xlsx 的合并单元格、条件格式、图表不还原；日期靠数字格式猜测（见 isDateFormat）；
 *   · pptx 的备注页、动画、母版占位符继承不还原；无 xfrm 的占位符按类型给一个近似框；
 *   · 超过 MAX_PARSE_BYTES 的文件直接拒绝解析（保护主线程），引导下载。
 * ============================================================================= */
(function (root) {
  'use strict';

  /* 解析上限：主线程是单线程的，一个 200MB 的 xlsx 会把页面卡死几十秒。
   * ▸ 这个数是"体验保险丝"不是"安全边界"（安全边界在服务器的大小上限那里）。 */
  const MAX_PARSE_BYTES = 40 * 1024 * 1024;
  const MAX_IMG_EACH = 2 * 1024 * 1024;      // 单张内嵌图片上限（超过就只显示占位文字）
  /* ★ 2026-10-08：原来只有一条"总量 16MB"，而 pptx 逐页调用让它变成了"每页 16MB"（见 collectImages）。
   *   现在拆成两条，各答一个问题：decoded 管**解码内存**（同一张图只算一次），
   *   emitted 管**DOM 里躺多少字符**（同一张图引 20 次就是 20 份字符串）。
   *   ▸ 数怎么来的：真实样本回扫（一份 25 页 PPT，media 解压后 7.5MB、被引用 61 次、
   *     渲染出 40.4MB HTML）+ innerHTML 插入耗时实测（16MB=59ms、40MB=142ms）。
   *     16MB 让"绝大多数正常文档的图都进得来"，8MB 让"字符串不再无界地长"。 */
  const MAX_IMG_DECODED = 16 * 1024 * 1024;   // 一份文档解压后的唯一图片总量
  const MAX_IMG_EMITTED = 8 * 1024 * 1024;    // 一份文档"发出"的图片总量（重复引用逐次计）
  const XLSX_MAX_ROWS = 800;                 // 每张表最多渲染多少行（超出如实提示）
  const XLSX_MAX_COLS = 60;
  const PPTX_MAX_SLIDES = 120;

  /* ───────────────────────── 0. 小工具 ───────────────────────── */

  /** 把各种"字节容器"统一成 Uint8Array。
   *  ▎坑 17 的同族教训：Buffer / DataView / subarray 都可能是**共享内存上的视图**，
   *    直接 `new DataView(v.buffer)` 会读到池里相邻的数据——必须带 byteOffset/byteLength。 */
  function toU8(v) {
    if (v instanceof Uint8Array) return v;
    if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    if (Array.isArray(v)) return Uint8Array.from(v);
    throw new Error('需要字节（Uint8Array / ArrayBuffer / Buffer），收到的是 ' + typeof v);
  }

  /** DataView 也要按视图的真实偏移建（同上）。 */
  function viewOf(b) { return new DataView(b.buffer, b.byteOffset, b.byteLength); }

  const B64CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  /** 纯 JS 的 base64（不依赖 btoa / Buffer）——内嵌图片要拼 data: URL。 */
  function base64(u8) {
    const b = toU8(u8);
    const parts = [];
    for (let i = 0; i < b.length; i += 3) {
      const n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
      parts.push(B64CHARS[(n >> 18) & 63], B64CHARS[(n >> 12) & 63],
        i + 1 < b.length ? B64CHARS[(n >> 6) & 63] : '=',
        i + 2 < b.length ? B64CHARS[n & 63] : '=');
      if (parts.length > 30000) { parts.splice(0, parts.length, parts.join('')); }  // 防超长参数栈
    }
    return parts.join('');
  }

  function decUtf8(bytes) {
    const b = toU8(bytes);
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(b);
    let s = '';
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    try { return decodeURIComponent(escape(s)); } catch (e) { return s; }   // 老环境的 utf8 解码兜底
  }

  /** 字节数 → 人话（中文单位，一位小数；0 就是 0 B，不写 "0.0 KB"）。 */
  function fmtSize(n) {
    const v = Number(n);
    if (!isFinite(v) || v < 0) return '—';
    if (v < 1024) return `${v} B`;
    if (v < 1024 * 1024) return `${(v / 1024).toFixed(v < 10240 ? 1 : 0)} KB`;
    return `${(v / 1024 / 1024).toFixed(1)} MB`;
  }

  /* ───────────────────────── 1. 文件类型判定 ───────────────────────── */

  /* ▎为什么按扩展名 + 按魔数**两条**：扩展名是"用户的声明"，魔数是"字节的事实"。
   *   两者不一致时以字节为准（有人把 .pdf 改名成 .docx，扩展名一路走到底就会给出
   *   "解析失败"这种让人以为功能坏了的结论）。见 magicKind。 */
  const EXT_KIND = {
    pdf: 'pdf',
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
    bmp: 'image', ico: 'image', avif: 'image', svg: 'svg',
    md: 'markdown', markdown: 'markdown', mdown: 'markdown',
    txt: 'text', log: 'text', ini: 'text', conf: 'text', yaml: 'text', yml: 'text',
    js: 'code', ts: 'code', py: 'code', java: 'code', c: 'code', cpp: 'code', h: 'code',
    cs: 'code', go: 'code', rs: 'code', sh: 'code', bat: 'code', css: 'code', html: 'code',
    xml: 'code', sql: 'code',
    json: 'json', csv: 'csv', tsv: 'csv',
    docx: 'docx', xlsx: 'xlsx', pptx: 'pptx',
    doc: 'legacy', xls: 'legacy', ppt: 'legacy',
    zip: 'archive', rar: 'archive', '7z': 'archive', gz: 'archive', tar: 'archive',
    mp3: 'media', wav: 'media', m4a: 'media', mp4: 'media', webm: 'media', mkv: 'media',
  };

  const KIND_CN = {
    pdf: 'PDF', image: '图片', svg: '矢量图', markdown: 'Markdown', text: '文本',
    code: '代码', json: 'JSON', csv: '表格(CSV)',
    docx: 'Word', xlsx: 'Excel', pptx: 'PPT',
    doc: 'Word 97-2003', xls: 'Excel 97-2003', ppt: 'PowerPoint 97-2003',
    rtf: 'RTF 富文本', html: '网页格式（存成了 .doc）',
    legacy: '旧版 Office', archive: '压缩包', media: '音视频', other: '文件',
  };

  /** 能在这个面板里**直接看**的类型（其余只能下载）。
   *  ★ 2026-10-09：legacy 进来了 —— 但注意它给的是**抽取的文字**，不是原版式
   *    （面板顶部那一行 fv-legacy-note 会把这件事当面说出来）。 */
  const PREVIEWABLE = new Set(['pdf', 'image', 'svg', 'markdown', 'text', 'code', 'json', 'csv', 'docx', 'xlsx', 'pptx', 'legacy']);

  function extOf(name) {
    const m = /\.([A-Za-z0-9]+)$/.exec(String(name || '').trim());
    return m ? m[1].toLowerCase() : '';
  }
  function kindOf(name) {
    const ext = extOf(name);
    return EXT_KIND[ext] || (ext ? 'other' : 'other');
  }
  function canPreview(name) { return PREVIEWABLE.has(kindOf(name)); }
  function kindCn(kind) { return KIND_CN[kind] || '文件'; }

  /** 按魔数判真实类型（只认前几个字节，不做深度解析）。
   *  ▎返回 null = 认不出来（此时继续相信扩展名，不猜）。 */
  function magicKind(u8) {
    let b; try { b = toU8(u8); } catch (e) { return null; }
    if (b.length < 4) return null;
    const h = (i) => b[i];
    if (h(0) === 0x25 && h(1) === 0x50 && h(2) === 0x44 && h(3) === 0x46) return 'pdf';      // %PDF
    if (h(0) === 0x50 && h(1) === 0x4b && (h(2) === 0x03 || h(2) === 0x05 || h(2) === 0x07)) return 'zip'; // PK
    if (h(0) === 0x89 && h(1) === 0x50 && h(2) === 0x4e && h(3) === 0x47) return 'image';   // PNG
    if (h(0) === 0xff && h(1) === 0xd8 && h(2) === 0xff) return 'image';                     // JPEG
    if (b.length >= 12 && h(0) === 0x52 && h(1) === 0x49 && h(2) === 0x46 && h(3) === 0x46
      && h(8) === 0x57 && h(9) === 0x45 && h(10) === 0x42 && h(11) === 0x50) return 'image'; // WEBP
    if (h(0) === 0x47 && h(1) === 0x49 && h(2) === 0x46) return 'image';                     // GIF
    if (h(0) === 0xd0 && h(1) === 0xcf && h(2) === 0x11 && h(3) === 0xe0) return 'legacy';   // 旧版 Office（复合文档）
    return null;
  }

  /** ZIP 里到底装的是哪种 Office 文档（魔数只知道"是个 ZIP"）。 */
  async function ooxmlKindOf(u8, opts) {
    try {
      const zip = openZip(u8, opts);
      if (zip.has('word/document.xml')) return 'docx';
      if (zip.has('xl/workbook.xml')) return 'xlsx';
      if (zip.has('ppt/presentation.xml')) return 'pptx';
    } catch (e) { /* 认不出就返回 null，调用方继续用扩展名 */ }
    return null;
  }

  /* ───────────────────────── 2. HTML 转义 / URL 白名单 ───────────────────────── */

  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  /** **唯一**的转义实现——渲染器里所有"用户内容进 HTML"都必须过它（坑 47）。 */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
  }
  /** esc 的逆（只在"判完协议再重新转义"这一处用得到）。 */
  function unesc(s) {
    return String(s == null ? '' : s)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  }
  /** 只放行"点了不会执行代码"的协议。返回空串 = 不给链接（降级成纯文字）。 */
  function safeUrl(u) {
    // ★ 先删掉控制字符与所有空白：`java\tscript:alert(1)` 是真实存在过的绕过写法
    const s = String(u == null ? '' : u).replace(/[\u0000-\u0020\u007f]/g, '');
    if (!s) return '';
    if (/^(https?:|mailto:|tel:|ftp:)/i.test(s)) return s;
    if (/^[a-z][a-z0-9+.\-]*:/i.test(s)) return '';       // 其它带协议的（javascript: data: vbscript:）一律拒
    return s;                                              // 相对路径 / 锚点 / 裸文件名：留给浏览器按当前页解析
  }
  function mimeOf(name) {
    const ext = extOf(name);
    const T = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif',
      svg: 'image/svg+xml', pdf: 'application/pdf',
      md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', log: 'text/plain',
      csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
      mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm',
    };
    return T[ext] || 'application/octet-stream';
  }

  /* ───────────────────────── 3. Markdown → HTML ───────────────────────── */

  /* ▎支持到什么程度（够用即止，不做 CommonMark 全规范）：
   *   # ~ ###### 标题 / ``` 代码块 / > 引用（递归渲染）/ - * + 与 1. 列表（含两级缩进与任务列表）/
   *   | 表格 | / --- 分隔线 / **粗** *斜* ~~删~~ `行内码` / [链接](url) ![图片](url) / 裸 http 链接。
   * ▎单换行按 **硬换行**处理（GFM 的评论风格）：会议纪要类文档里"一行一条"是常态，
   *   按标准把单换行当空格会把用户写好的清单挤成一坨。这条取舍写在这里，免得日后被当成 bug。 */
  function mdToHtml(src, depth) {
    const d = Number(depth) || 0;
    if (d > 6) return `<p>${esc('（引用嵌套过深，已截断）')}</p>`;
    const text = String(src == null ? '' : src).replace(/\r\n?/g, '\n').replace(/\t/g, '  ');
    const lines = text.split('\n');
    let out = '';
    let i = 0;
    let para = [];
    let quote = [];
    /* 列表项先攒成扁平数组（带层级），最后由 renderListItems 统一拼成嵌套 ul/ol。
     * ▎为什么不在这里一边扫一边吐标签：嵌套列表的"开一层 / 收一层 / 同层换有序性"
     *   三种情况混在扫描循环里，状态机很难写对（我第一版就写错了：顶层多出一个空 <li>）。
     *   抽成"先收集、后渲染"，同一份逻辑 docx 的列表也用得上（坑 47：一个概念一个来源）。 */
    let listItems = [];

    const flushPara = () => {
      if (!para.length) return;
      out += `<p>${para.map((l) => mdInline(l)).join('<br>')}</p>`;
      para = [];
    };
    const flushQuote = () => {
      if (!quote.length) return;
      out += `<blockquote>${mdToHtml(quote.join('\n'), d + 1)}</blockquote>`;
      quote = [];
    };
    const flushList = () => {
      if (!listItems.length) return;
      out += renderListItems(listItems);
      listItems = [];
    };
    const flushAll = () => { flushPara(); flushQuote(); flushList(); };

    for (; i < lines.length; i++) {
      const line = lines[i];

      /* ── 代码块（``` 或 ~~~，可带语言名）── */
      const fence = /^ {0,3}(```|~~~)\s*([^\s`]*)\s*$/.exec(line);
      if (fence) {
        flushAll();
        const mark = fence[1];
        const lang = fence[2] || '';
        const buf = [];
        i++;
        // 收尾围栏允许缩进 ≤3 空格（与开栏同一条判据）。不用 RegExp 拼字符串：
        // 围栏字符本身就是正则元字符的邻居，拼错了很难看出来（直接写成"去掉缩进后前缀比对"最省心）。
        const closedBy = (s) => s.replace(/^ {0,3}/, '').indexOf(mark) === 0;
        while (i < lines.length && !closedBy(lines[i])) { buf.push(lines[i]); i++; }
        out += `<pre class="fv-pre"><code${lang ? ` class="lang-${esc(lang)}"` : ''}>${esc(buf.join('\n'))}</code></pre>`;
        continue;
      }

      /* ── 空行：段落 / 引用 / 列表的分界 ── */
      if (!line.trim()) { flushAll(); continue; }

      /* ── 引用 ── */
      const bq = /^ {0,3}>\s?(.*)$/.exec(line);
      if (bq) { flushPara(); flushList(); quote.push(bq[1]); continue; }
      flushQuote();

      /* ── 分隔线 ── */
      if (/^ {0,3}([-*_])( *\1){2,} *$/.test(line)) { flushAll(); out += '<hr>'; continue; }

      /* ── 标题 ── */
      const h = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (h) {
        flushAll();
        const lv = h[1].length;
        out += `<h${lv}>${mdInline(h[2]) || '&nbsp;'}</h${lv}>`;
        continue;
      }

      /* ── 表格：本行含 | 且下一行是 |---|---| 这种分隔行 ──
       * ▸ 分隔行的短横**一个就够**（`|:-:|--:|` 是很常见的写法），
       *   第一版要求 `-{2,}` 于是这种表格整个不被识别、原样当段落吐出去。 */
      if (line.indexOf('|') >= 0 && i + 1 < lines.length
        && /^ {0,3}\|? *:?-+:? *(\| *:?-+:? *)+\|? *$/.test(lines[i + 1])) {
        flushAll();
        const cells = (s) => s.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
        const head = cells(line);
        const aligns = cells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /^-+:$/.test(c) ? 'right' : /^\:-+/.test(c) ? 'left' : ''));
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].indexOf('|') >= 0 && lines[i].trim()) { rows.push(cells(lines[i])); i++; }
        i--;   // for 循环自己会 +1
        let t = '<div class="fv-tblwrap"><table class="fv-tbl"><thead><tr>';
        head.forEach((c, k) => { t += `<th${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${mdInline(c)}</th>`; });
        t += '</tr></thead><tbody>';
        for (const r of rows) {
          t += '<tr>';
          for (let k = 0; k < head.length; k++) t += `<td${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${mdInline(r[k] || '')}</td>`;
          t += '</tr>';
        }
        out += `${t}</tbody></table></div>`;
        continue;
      }

      /* ── 列表（缩进 = 层级；任务列表 - [ ] / - [x]）──
       * ▸ 层级判据：≥2 空格算下一层，每 4 空格再加一层（2 空格与 4 空格两种习惯都落在同一层，
       *   这是刻意取的中间值——按 2 空格切会让"缩进 4 格"跳到第 3 层，观感很怪）。 */
      const ul = /^ {0,12}([-*+])\s+(.*)$/.exec(line);
      const ol = /^ {0,12}(\d{1,9})[.)]\s+(.*)$/.exec(line);
      if (ul || ol) {
        flushPara();
        const spaces = line.length - line.replace(/^ +/, '').length;
        const ilvl = spaces >= 2 ? Math.min(3, Math.ceil(spaces / 4)) : 0;
        let body = ul ? ul[2] : ol[2];
        let box = '';
        const task = /^\[([ xX])\]\s+(.*)$/.exec(body || '');
        if (task) {
          box = `<input type="checkbox" disabled${task[1].toLowerCase() === 'x' ? ' checked' : ''}> `;
          body = task[2];
        }
        listItems.push({ ilvl, ordered: !!ol, html: box + mdInline(body || '') || '&nbsp;' });
        continue;
      }
      flushList();

      /* ── 普通段落 ── */
      para.push(line.replace(/\s+$/, ''));
    }
    flushAll();
    return out || '<p class="fv-empty">（这份文档是空的）</p>';
  }

  /** 行内元素：先整段转义，再用"占位槽"防止生成的标签被后续规则二次加工。 */
  function mdInline(raw) {
    let s = esc(raw).replace(/[\u0001\u0002]/g, '');   // 占位符不许由用户内容伪造
    const slots = [];
    const slot = (html) => { slots.push(html); return `\u0002${slots.length - 1}\u0001`; };
    const codes = [];

    // 行内码（先摘走，里面的 ** _ ~ 都是字面量）
    s = s.replace(/(`+)([\s\S]*?)\1/g, (m, t, body) => {
      codes.push(body.replace(/^ | $/g, ''));
      return slot(`<code class="fv-code">${codes[codes.length - 1]}</code>`);
    });
    /* 链接与图片的 URL 部分允许**一层平衡括号**：`[文档](https://zh.wikipedia.org/wiki/A_(b))`
     * 是真实写法（维基百科一类），只写到 `[^)\s]+` 会把 URL 切在第一个 `)` 上，
     * 链接坏掉还会在正文里漏一个孤零零的右括号。
     * ▸ 关键细节：第一段字符类里必须**同时排除 `(`**——只排除 `)` 的话，
     *   贪婪匹配会先把 `A_(b` 整个吃掉（它能匹配成功，正则引擎就不再往前回溯了），
     *   于是"支持平衡括号"这条规则一次也不会被走到。这是我第一版写错的地方。 */
    const URLPAT = '[^()\\s>]*(?:\\([^()\\s>]*\\)[^()\\s>]*)*';
    // 图片
    s = s.replace(new RegExp(`!\\[([^\\]]*)\\]\\(\\s*<?(${URLPAT})>?(?:\\s+"[^"]*")?\\)`, 'g'), (m, alt, url) => {
      const u = safeUrl(unesc(url));
      const a = unesc(alt);
      return u ? slot(`<img class="fv-img" src="${esc(u)}" alt="${esc(a)}" loading="lazy">`) : esc(a);
    });
    // 链接
    s = s.replace(new RegExp(`\\[([^\\]]+)\\]\\(\\s*<?(${URLPAT})>?(?:\\s+"[^"]*")?\\)`, 'g'), (m, txt, url) => {
      const u = safeUrl(unesc(url));
      return u ? slot(`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${txt}</a>`) : txt;
    });
    // 裸 http(s) 链接（**中英文**句尾标点都不算链接的一部分——"见 https://a.b/c。"是常见写法）
    s = s.replace(/(^|[\s(（])((?:https?:\/\/)[^\s<>()（）]+)/g, (m, pre, u) => {
      const t = u.replace(/[.,;:!?)\]}\u3002\uff0c\u3001\uff1b\uff1a\uff01\uff1f\uff09\u300b\u300d\u300f\u3011]+$/, '');
      if (!t) return m;
      return pre + slot(`<a href="${esc(t)}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>`) + esc(u.slice(t.length));
    });
    // 粗体 / 斜体 / 删除线
    s = s.replace(/\*\*([\s\S]+?)\*\*/g, (m, b) => slot(`<strong>${b}</strong>`));
    s = s.replace(/__([\s\S]+?)__/g, (m, b) => slot(`<strong>${b}</strong>`));
    s = s.replace(/(^|[^\w*])\*([^*\n]+?)\*(?=[^\w*]|$)/g, (m, p, b) => p + slot(`<em>${b}</em>`));
    s = s.replace(/~~([\s\S]+?)~~/g, (m, b) => slot(`<s>${b}</s>`));
    s = s.replace(/==([\s\S]+?)==/g, (m, b) => slot(`<mark>${b}</mark>`));

    // 还原占位槽（可能要还原多层：链接里套粗体）
    for (let pass = 0; pass < 8 && s.indexOf('\u0002') >= 0; pass++) {
      s = s.replace(/\u0002(\d+)\u0001/g, (m, n) => (slots[Number(n)] !== undefined ? slots[Number(n)] : ''));
    }
    return s;
  }

  /* ───────────────────────── 4. CSV / TSV → 表格 ───────────────────────── */

  /** 分隔符靠首行猜：中国机器上 Excel 导出的"CSV"常常是分号或制表符。 */
  function detectDelimiter(text) {
    const first = String(text || '').split('\n')[0] || '';
    const cand = [',', ';', '\t', '|'];
    let best = ','; let bestN = 0;
    for (const c of cand) {
      const n = first.split(c).length - 1;
      if (n > bestN) { bestN = n; best = c; }
    }
    return bestN > 0 ? best : ',';
  }

  /** RFC4180：引号包裹、"" 转义、字段内允许换行。 */
  function parseCsv(text, delim) {
    const src = String(text == null ? '' : text).replace(/\r\n?/g, (m) => (m === '\r\n' ? '\n' : ''));
    const d = delim || detectDelimiter(src);
    const rows = [];
    let row = []; let cur = ''; let q = false;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (q) {
        if (c === '"') { if (src[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === d) { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    // 全空的行丢掉（Excel 导出常在末尾留一堆空行）
    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  }

  function csvToHtml(text, opts) {
    const o = opts || {};
    const rows = parseCsv(text, o.delimiter);
    if (!rows.length) return '<p class="fv-empty">（这份表格是空的）</p>';
    const maxRows = Number(o.maxRows) || XLSX_MAX_ROWS;
    const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const head = rows[0];
    let h = '<div class="fv-tblwrap"><table class="fv-tbl fv-sheet"><thead><tr>';
    for (let c = 0; c < cols; c++) h += `<th>${esc(head[c] || '')}</th>`;
    h += '</tr></thead><tbody>';
    const body = rows.slice(1, maxRows + 1);
    for (const r of body) {
      h += '<tr>';
      for (let c = 0; c < cols; c++) h += `<td>${esc(r[c] === undefined ? '' : r[c])}</td>`;
      h += '</tr>';
    }
    h += '</tbody></table></div>';
    if (rows.length - 1 > maxRows) h += `<p class="fv-note">表格共 ${rows.length - 1} 行，这里只显示前 ${maxRows} 行（下载可看全部）。</p>`;
    return h;
  }

  /* ───────────────────────── 5. 极简 XML 解析器 ─────────────────────────
   * ▎为什么不用浏览器自带的 DOMParser：它是**平台能力**，Node 里没有——
   *   用它就意味着"渲染逻辑只能在浏览器里测"，而这个项目吃过好几次
   *   "只有真浏览器才验得到"的亏（坑 83/87）。手写一个几百行的容错解析器，
   *   换来 docx/xlsx/pptx 的解析全部可以在 Node 里穷举断言，这笔账划算。
   * ▎容错到什么程度：未闭合的标签在 EOF 自动收口、多余的闭合标签忽略、
   *   未知实体原样保留（宁可看得见，不要吞字）。Office 产出的 XML 是良构的，
   *   这些容错是给"半截文件 / 手工改坏的文件"兜底，不让解析器卡死。
   * ──────────────────────────────────────────────────────────────────── */

  function decodeEntities(s) {
    return String(s).replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (m, e) => {
      if (e[0] === '#') {
        const code = (e[1] === 'x' || e[1] === 'X') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        if (!isFinite(code) || code < 0 || code > 0x10ffff) return m;
        try { return String.fromCodePoint(code); } catch (err) { return m; }
      }
      switch (e) {
        case 'amp': return '&';
        case 'lt': return '<';
        case 'gt': return '>';
        case 'quot': return '"';
        case 'apos': return "'";
        case 'nbsp': return '\u00a0';
        default: return m;
      }
    });
  }

  /** 找开始标签的 '>'——必须跳过属性值里的引号内容（`title="a>b"` 是合法的）。 */
  function findTagEnd(src, start) {
    let q = null;
    for (let i = start + 1; i < src.length; i++) {
      const c = src[i];
      if (q) { if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === '>') return i;
    }
    return -1;
  }

  function parseAttrs(s) {
    const out = {};
    const re = /([^\s=/>]+)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let m;
    while ((m = re.exec(s))) {
      const v = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5] !== undefined ? m[5] : '';
      out[m[1]] = decodeEntities(v);
      if (m[0] === '') re.lastIndex++;    // 防零宽匹配死循环
    }
    return out;
  }

  /** 字符串 → 树。节点形如 { tag, attrs, kids:[节点|字符串] }；根是 { tag:'#document' }。 */
  function parseXml(str) {
    const src = String(str == null ? '' : str);
    const rootEl = { tag: '#document', attrs: {}, kids: [] };
    const stack = [rootEl];
    const top = () => stack[stack.length - 1];
    const pushText = (t) => { if (t !== '') top().kids.push(decodeEntities(t)); };
    let i = 0;
    const n = src.length;
    while (i < n) {
      const lt = src.indexOf('<', i);
      if (lt < 0) { pushText(src.slice(i)); break; }
      if (lt > i) pushText(src.slice(i, lt));
      if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
      if (src.startsWith('<![CDATA[', lt)) {
        const e = src.indexOf(']]>', lt + 9);
        top().kids.push(src.slice(lt + 9, e < 0 ? n : e));   // CDATA 是原文，不解实体
        i = e < 0 ? n : e + 3; continue;
      }
      if (src.startsWith('<?', lt)) { const e = src.indexOf('?>', lt + 2); i = e < 0 ? n : e + 2; continue; }
      if (src.startsWith('<!', lt)) { const e = src.indexOf('>', lt + 2); i = e < 0 ? n : e + 1; continue; }
      if (src[lt + 1] === '/') {
        const e = src.indexOf('>', lt + 2);
        if (e < 0) { i = n; break; }
        const name = src.slice(lt + 2, e).trim();
        for (let k = stack.length - 1; k >= 1; k--) if (stack[k].tag === name) { stack.length = k; break; }
        i = e + 1; continue;
      }
      const e = findTagEnd(src, lt);
      if (e < 0) { i = n; break; }
      let inner = src.slice(lt + 1, e);
      const selfClose = /\/$/.test(inner);
      if (selfClose) inner = inner.slice(0, -1);
      const m = /^([^\s/>]+)([\s\S]*)$/.exec(inner);
      if (!m) { i = e + 1; continue; }
      const node = { tag: m[1], attrs: parseAttrs(m[2] || ''), kids: [] };
      top().kids.push(node);
      if (!selfClose) stack.push(node);
      i = e + 1;
    }
    return rootEl;
  }

  /** 去掉命名空间前缀（OOXML 里 w: a: r: p: 到处飞，按局部名比对才稳）。 */
  function local(tag) {
    const t = String(tag || '');
    const i = t.indexOf(':');
    return i < 0 ? t : t.slice(i + 1);
  }
  function isEl(k) { return typeof k === 'object' && k !== null && !!k.tag; }
  function kidsOf(node) { return (node && node.kids) || []; }
  /** 直接子元素里第一个局部名匹配的（结构敏感的场合用它，别用 all 到处捞）。 */
  function child(node, name) {
    for (const k of kidsOf(node)) if (isEl(k) && local(k.tag) === name) return k;
    return null;
  }
  /** 直接子元素里**所有元素节点**（不按名字筛）。
   *  ▎为什么要单独一个函数而不是给 children 的 name 传空：
   *     第一版我把这两件事混成一个 `children(node, name)`，然后在几处只传了 node——
   *     `local(tag) === undefined` 恒为假，于是"整个文档的段落列表"是空数组，
   *     渲染结果是"（这份文档没有可提取的文字）"。**不报错，只是什么都不显示**，
   *     和"文件真的是空的"长得一模一样（坑 76/82 家族）。
   *     两个语义就写两个名字，别让一个可选参数去承担"筛/不筛"两种意思。 */
  function elems(node) {
    const out = [];
    for (const k of kidsOf(node)) if (isEl(k)) out.push(k);
    return out;
  }
  /** 直接子元素里所有局部名匹配的。 */
  function children(node, name) {
    const out = [];
    for (const k of kidsOf(node)) if (isEl(k) && local(k.tag) === name) out.push(k);
    return out;
  }
  /** 整棵子树里第一个匹配的。 */
  function first(node, name) {
    if (!node) return null;
    for (const k of kidsOf(node)) {
      if (!isEl(k)) continue;
      if (local(k.tag) === name) return k;
      const deep = first(k, name);
      if (deep) return deep;
    }
    return null;
  }
  /** 整棵子树里所有匹配的。 */
  function all(node, name, out) {
    const res = out || [];
    for (const k of kidsOf(node || {})) {
      if (!isEl(k)) continue;
      if (local(k.tag) === name) res.push(k);
      all(k, name, res);
    }
    return res;
  }
  /** 子树里所有文本（CDATA 已在解析时按原文入树）。 */
  function textOf(node) {
    if (node == null) return '';
    if (typeof node === 'string') return node;
    let s = '';
    for (const k of kidsOf(node)) s += textOf(k);
    return s;
  }
  /** 取属性：**忽略命名空间前缀与大小写**（`r:id` / `Id` / `id` 都取得到）。 */
  function attr(node, name) {
    if (!node || !node.attrs) return '';
    const a = node.attrs;
    if (a[name] !== undefined) return String(a[name]);
    const want = String(name).toLowerCase();
    for (const k of Object.keys(a)) {
      if (local(k).toLowerCase() === want) return String(a[k]);
    }
    return '';
  }
  function hasChild(node, name) { return !!child(node, name); }

  /* ───────────────────────── 6. ZIP 读取（OOXML 的容器） ─────────────────────────
   * ▎ZIP 的结构就三段：一堆"本地文件头 + 数据" → "中央目录"（每个条目的索引）→
   *   文件末尾的 EOCD（告诉你中央目录在哪）。所以**从尾巴往前找 EOCD**，
   *   再顺着中央目录把每个条目的（压缩方式 / 压缩后大小 / 本地头偏移）抄下来。
   * ▎解压只有两种情况：method 0 = 原样存放（stored），method 8 = deflate。
   *   deflate 用浏览器内置的 `DecompressionStream('deflate-raw')`（注意是 **raw**，
   *   ZIP 不带 zlib 那两字节头，用 'deflate' 会直接报格式错——这是最容易踩的一脚）。
   *   Node 侧注入 `zlib.inflateRawSync`，同一份代码两个运行时。
   * ▎大于 4GB 的条目要走 ZIP64（尺寸字段填 0xFFFFFFFF，真值在额外字段 0x0001 里），
   *   这里也处理了：Office 存大图片/大表格时确实会产出 ZIP64。
   * ──────────────────────────────────────────────────────────────────── */

  /* 单个条目解压后的上限：ZIP 压缩比可以做到了 1000:1（一兆字节的 docx 里
   * 塞一个 1GB 的 XML 完全合法）。这条线是**安全边界**，与上面那个
   * "体验保险丝" MAX_PARSE_BYTES 不是一件事——上限到了就报错，不装没事。 */
  const MAX_INFLATE_BYTES = 64 * 1024 * 1024;
  /* 解压卡住的保险丝：卡住不报错的话，界面上就是"点了没反应"（坑 90 那条
   * 全静默链的形状）。宁可报一句难看得懂的错，也不要什么都不说。 */
  const INFLATE_WATCHDOG_MS = 12000;

  /** 给一个 promise 上保险丝：到点没回话就以明确的错误失败（赢的那一边照常）。 */
  function withWatchdog(promise, ms, makeMsg) {
    let timer = null;
    const guard = new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error(makeMsg(ms))), ms);
      if (timer && typeof timer.unref === 'function') timer.unref();  // Node：别为量具续命
    });
    return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
  }

  /** 解压上限可以在调用处压低（`openZip(bytes, { maxBytes })`）——
   *  不是为了生产环境调参，是为了**这条安全线可以被小样本测到**：
   *  真要造一个 64MB 的解压产物来测它，这套单测就从"几秒跑完"变成"占内存的定时炸弹"。 */
  function capOf(o) {
    const v = o && Number(o.maxBytes);
    return isFinite(v) && v > 0 ? v : MAX_INFLATE_BYTES;
  }

  function defaultInflateRaw() {
    /* ① Node 优先走内置 zlib：同步、没有流背压，测试跑得又快又稳。
     *    （判据顺序值得记一句：Node 18+ **同样**有全局 DecompressionStream，
     *      原先"浏览器分支在前"让 Node 也走了流式那条路，于是 Node 撞上的是
     *      浏览器才有的毛病——见下面②的注释。能力更弱但更确定的分支应该先判。） */
    if (typeof require === 'function') {
      try {
        const zlib = require('zlib');
        if (zlib && typeof zlib.inflateRawSync === 'function') {
          return function inflateRawNode(u8, o) {
            const b = toU8(u8);
            const cap = capOf(o);
            try {
              return new Uint8Array(zlib.inflateRawSync(
                Buffer.from(b.buffer, b.byteOffset, b.byteLength), { maxOutputLength: cap }));
            } catch (e) {
              // zlib 那句英文实现细节翻成人话再往上给（client.js 是直接把 message 显示给用户的）。
              // ▸ 实测两种说法都存在：流式路径报 "maxOutputLength exceeded"，
              //   inflateRawSync 这条路报 "Cannot create a Buffer larger than N bytes"
              //   —— 只认前者就会漏（我这次就是这么红了一次的）。
              const m = (e && e.message) || '';
              if (/maxOutputLength|larger than [\d,]+ ?bytes/i.test(m)) {
                throw new Error(`这个条目解压后超过 ${fmtSize(cap)}，出于安全上限不解析`);
              }
              throw e;
            }
          };
        }
      } catch (e) { /* 没有 zlib 就往下试浏览器分支 */ }
    }
    /* ② 浏览器：Deflate 用内置的 `DecompressionStream('deflate-raw')`。
     * ▎★ 这一脚踩过两次，两次都是**静默**的，所以三条教训都写死在这里：
     *  (a) **必须 raw**：ZIP 里的 deflate 流不带 zlib 那两字节头，用 'deflate'
     *      直接格式错——这是最容易踩的一脚。
     *  (b) **别把共享内存递下去**（坑 17）：原先写 `new Blob([b.slice().buffer])`，
     *      浏览器里 `slice()` 会拷贝所以没事，Node 里 b 是 Buffer、它的 slice 是
     *      subarray 的别名**不拷贝**，于是解压器吃到整份 ZIP → Z_DATA_ERROR，
     *      而抛上来的 TypeError 连 message 都是空的，看着像"这个环境不支持"。
     *      正解：显式新建一块独立 ArrayBuffer 再 `set()` 进去，不碰 .buffer。
     *  (c) **绝不能在没有读者的时候 await close()**（真浏览器实测：整条 promise
     *      永久不 settle，`Runtime.evaluate` 直接超时）：DecompressionStream 是
     *      TransformStream，写侧要等读侧把队列排空才收工。原先的顺序是
     *      `await w.close()` 之后才 `new Response(ds.readable)` —— 关闭在等读者，
     *      读者在下一行还没诞生 = **自死锁**。
     *      正解：**自己拿 reader 从头排**（不依赖 Response 的实现细节），
     *      且 write/close **不 await**、立刻开始读；再配一条保险丝（见 withWatchdog），
     *      万一将来又卡住，界面上会得到一句"解压卡住了"，而不是永久转圈。 */
    if (typeof DecompressionStream === 'undefined') return null;
    /* 先探一次"这个浏览器认不认 deflate-raw"（Chrome 103+/Safari 16.4+ 才认）。
     * 判据在这里做一次、返回 null 让调用方说人话，比在每次解压时返回一个 null
     * 让上面报"需要字节，收到的是 object"诚实得多——后者会把"环境不支持"
     * 说成"这个文件坏了"（坑 82：界面在无声地撒谎）。 */
    try { new DecompressionStream('deflate-raw'); } catch (e) { return null; }
    return async function inflateRawBrowser(u8, o) {
      const cap = capOf(o);
      const b = toU8(u8);
      const copy = new Uint8Array(b.byteLength);
      copy.set(b);                                         // (b) 独立内存，不碰 .buffer
      const ds = new DecompressionStream('deflate-raw');
      const w = ds.writable.getWriter();
      const r = ds.readable.getReader();
      w.write(copy).catch(() => {});                       // (c) 不 await：错误由读侧统一收
      w.close().catch(() => {});
      const chunks = [];
      let total = 0;
      const run = async () => {
        for (;;) {
          const { done, value } = await r.read();          // 一边读，写侧才可能收工
          if (done) break;
          if (!value) continue;
          total += value.length;
          if (total > cap) {
            throw new Error(`这个条目解压后超过 ${fmtSize(cap)}，出于安全上限不解析`);
          }
          chunks.push(value);
        }
        const out = new Uint8Array(total);
        let at = 0;
        for (const c of chunks) { out.set(c, at); at += c.length; }
        return out;
      };
      try {
        return await withWatchdog(run(), INFLATE_WATCHDOG_MS,
          (ms) => `解压卡住了（${Math.round(ms / 1000)}s 没回话）——这份压缩数据可能坏了`);
      } finally {
        /* 保险丝到点时循环还挂在 read() 上。cancel() 会把等待中的 read 以 done 收掉，
         * 于是那个后台循环自己退出——不留一条永远在跑的流（长跑纪律）。 */
        try { await r.cancel(); } catch (e) { /* 已经结束了，忽略 */ }
      }
    };
  }

  /** 打开一个 ZIP（**不预解压**，按名取用时才解，省内存）。 */
  function openZip(u8, opts) {
    const bytes = toU8(u8);
    if (bytes.length < 22) throw new Error('文件太小，不是合法的 ZIP');
    const dv = viewOf(bytes);
    const inflate = (opts && (opts.inflateRaw || opts.inflate)) || defaultInflateRaw();

    // ① 从尾巴往前找 EOCD（注释最长 65535 字节，所以扫描窗口是 22 + 65535）
    const scanFrom = Math.max(0, bytes.length - 22 - 65535);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= scanFrom; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是合法的 ZIP（找不到中央目录结尾记录）');

    let count = dv.getUint16(eocd + 10, true);
    let cdSize = dv.getUint32(eocd + 12, true);
    let cdOffset = dv.getUint32(eocd + 16, true);

    // ② ZIP64：EOCD 前面 20 字节处是"ZIP64 EOCD 定位器"
    if (cdOffset === 0xffffffff || count === 0xffff || cdSize === 0xffffffff) {
      const loc = eocd - 20;
      if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
        const z64 = Number(dv.getBigUint64(loc + 8, true));
        if (z64 >= 0 && z64 + 56 <= bytes.length && dv.getUint32(z64, true) === 0x06064b50) {
          count = Number(dv.getBigUint64(z64 + 32, true));
          cdSize = Number(dv.getBigUint64(z64 + 40, true));
          cdOffset = Number(dv.getBigUint64(z64 + 48, true));
        }
      }
    }
    if (cdOffset + 46 > bytes.length) throw new Error('ZIP 中央目录越界（文件可能被截断）');

    // ③ 走一遍中央目录，建索引
    const entries = new Map();
    let p = cdOffset;
    const cdEnd = Math.min(bytes.length, cdOffset + (cdSize === 0xffffffff ? bytes.length : cdSize));
    for (let k = 0; k < count && p + 46 <= cdEnd; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const flags = dv.getUint16(p + 8, true);
      const method = dv.getUint16(p + 10, true);
      let compSize = dv.getUint32(p + 20, true);
      let uncompSize = dv.getUint32(p + 24, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      let localOff = dv.getUint32(p + 42, true);
      const name = decUtf8(bytes.subarray(p + 46, p + 46 + nameLen));
      // ZIP64 额外字段（0x0001）：只包含"上面填了 0xFFFFFFFF 的那几项"，且按固定顺序
      if (extraLen > 0) {
        let q = p + 46 + nameLen;
        const qEnd = q + extraLen;
        while (q + 4 <= qEnd) {
          const id = dv.getUint16(q, true);
          const sz = dv.getUint16(q + 2, true);
          if (id === 0x0001) {
            let r = q + 4;
            if (uncompSize === 0xffffffff && r + 8 <= qEnd) { uncompSize = Number(dv.getBigUint64(r, true)); r += 8; }
            if (compSize === 0xffffffff && r + 8 <= qEnd) { compSize = Number(dv.getBigUint64(r, true)); r += 8; }
            if (localOff === 0xffffffff && r + 8 <= qEnd) { localOff = Number(dv.getBigUint64(r, true)); r += 8; }
          }
          q += 4 + sz;
        }
      }
      if (!entries.has(name)) entries.set(name, { method, compSize, uncompSize, localOff, flags });
      p += 46 + nameLen + extraLen + commentLen;
    }
    if (!entries.size) throw new Error('这个 ZIP 里没有条目（可能不是 Office 文档）');

    async function read(name) {
      const e = entries.get(String(name));
      if (!e) return null;
      if (e.localOff + 30 > bytes.length) return null;
      if (dv.getUint32(e.localOff, true) !== 0x04034b50) return null;
      // ★ 数据起点必须用**本地头自己的**名字/额外字段长度——它和中央目录里的可以不一样
      const nl = dv.getUint16(e.localOff + 26, true);
      const el = dv.getUint16(e.localOff + 28, true);
      const start = e.localOff + 30 + nl + el;
      if (start + e.compSize > bytes.length) throw new Error(`条目 ${name} 的数据越界（文件被截断？）`);
      const raw = bytes.subarray(start, start + e.compSize);
      if (e.method === 0) return raw;                       // stored：原样
      if (e.method !== 8) throw new Error(`不支持的压缩方式 ${e.method}（条目 ${name}）`);
      if (!inflate) throw new Error('这个环境没有解压能力（浏览器需要 DecompressionStream，Node 需要 zlib）');
      /* 报错必须带上"是哪个条目"：一份 docx 里有几十个部件，
       * 一句"解压失败"等于没说（排障时第一个要问的就是"哪一份坏了"）。
       * ▸ 第二个参数把解压上限交给两条 inflate 实现：调用方可以用
       *   `openZip(bytes, { maxBytes: n })` 压低它——安全线要能被小样本测到才算被测过。 */
      try {
        return toU8(await inflate(raw, { maxBytes: capOf(opts) }));
      } catch (e) {
        throw new Error(`解压 ${name} 失败：${(e && e.message) || e}`);
      }
    }
    async function text(name) {
      const b = await read(name);
      return b == null ? null : decUtf8(b);
    }
    return {
      names: () => [...entries.keys()],
      has: (name) => entries.has(String(name)),
      count: entries.size,
      read, text,
    };
  }

  /** 关系表（.rels）→ Map(rId → { type, target, external })。三种文档都靠它找部件。 */
  async function readRels(zip, relPath) {
    const map = new Map();
    const xml = await zip.text(relPath);
    if (!xml) return map;
    const doc = parseXml(xml);
    for (const r of all(doc, 'Relationship')) {
      const id = attr(r, 'Id');
      if (!id) continue;
      map.set(id, {
        type: attr(r, 'Type'),
        target: attr(r, 'Target'),
        external: /external/i.test(attr(r, 'TargetMode')),
      });
    }
    return map;
  }

  /** 相对路径归一化（rels 里的 Target 可能是 `media/image1.png`、`../slides/slide1.xml`、`/ppt/x.xml`）。 */
  function resolveZipPath(baseDir, target) {
    let t = String(target || '').replace(/\\/g, '/').split('#')[0].split('?')[0];
    if (!t) return '';
    if (t[0] === '/') return t.replace(/^\/+/, '');
    const parts = String(baseDir || '').replace(/\/+$/, '').split('/').filter(Boolean);
    for (const seg of t.split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    }
    return parts.join('/');
  }

  /* ───────────────────────── 7. 内嵌图片（docx / pptx 共用） ───────────────────────── */

  /* 浏览器**画不出来**的图片格式：Windows 图元文件（Office 里很常见）。
   * ▎认不出来就当它不存在（显示占位文字），比塞一个裂图给用户体验好——
   *   裂图会被读成"功能坏了"，占位文字会被读成"这里有一张图，格式看不了"（坑 82）。 */
  const IMG_OK_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'svg']);

  /** 图/图形没能画出来时要**说一声**：占位方块只说明"这里曾有图"，说明不了"为什么没有"。
   *  ▸ 不写这句的话，用户看到的就是一堆灰方块，而他会得出"这功能读不了我的 Word"——
   *    实际上文字、版式、其余图都在（与 legacyHtml 那条同纪律）。
   *  ▸ ★ 2026-10-10（用户第四次报"word 共享没实现"，拿他那份真 .docx 取证抓到的）：
   *    原来这条说明**只管"被预算裁掉"那一种**。另外两种一个字的说明都没有：
   *      · bad    = 浏览器根本不认的图片格式（EMF/WMF、把 .emf 改名成 .png 的）
   *      · shapes = Word 的矢量图形（线条/文本框/公式对象，VML 或 DrawingML 画的），
   *                 我们只还原文字，这类东西结构上就画不出来
   *    那份 469KB 的论文模板里 49 处占位**全是这两类**，于是界面上一行解释都没有。
   *    ▎三种原因分开写、分开计数（坑 125 的同一条：混进同一个数，那句"省略了 N 张"就在谎报原因）。
   *  ▸ 上限为什么是 16MB（解压后的图片字节，不是 HTML 长度）：base64 会再涨 4/3，
   *    实测量过 40MB 字符串插入 DOM 只要 142ms，所以卡的不是插入而是**内存与解码**；
   *    16MB 是"一份真 PPT 的绝大多数图都能进来"的那条线（本次那 7.5MB 的样本全放得下）。
   *  ▸ 2026-10-08 之前这条上限是**每页一份**，所以它从来没有作为"文档上限"生效过（坑 76）。 */
  function imgSkippedNote(budget) {
    const b = budget || {};
    const parts = [];
    if (b.skipped) parts.push(`为流畅起见省略了 ${b.skipped} 处内嵌图片`);
    if (b.bad) parts.push(`有 ${b.bad} 处图片是浏览器画不了的格式（EMF/WMF 这类图元文件）`);
    if (b.missing) parts.push(`有 ${b.missing} 处图片引用在文档包里找不到对应文件（那份文件本身不完整）`);
    if (b.shapes) parts.push(`有 ${b.shapes} 处 Word 图形与公式对象是矢量绘制的，在线不还原`);
    if (!parts.length) return '';
    return `<p class="fv-note fv-note-imgs">这份文档${parts.join('；')}。`
      + '文字与版式都在；要看完整图片，点右下角「下载」拿原文件即可。</p>';
  }

  /* 连续空白"占几行、什么时候改说一句『省略 N 行』"——**xlsx 与 docx 共用这一条判据**。
   * ▎为什么要抽出来：折叠空白行这件事 10-09 就为 xlsx 写过了（一份 2000 行的表逐行画空行没意义），
   *   而 docx 那条路径从来没做——用户那份论文模板有 **1198 个空段**（Word 拿空段当排版间距），
   *   于是正文被推到第 48 屏，界面打开就是"一片空白 + 几个灰方块"，读起来等于"没实现"。
   *   ▸ 阈值 6 沿用 xlsx 那条：≤6 个空行照原样占位（"第 12 行"这种指代还要对得上），
   *     再多就压成一行说明——**少画几行不丢信息，全画出来才丢**（信息密度那条）。 */
  const BLANK_PAD_MAX = 6;
  function blankRunOf(n) {
    return n <= 0 ? { pad: 0, omitted: 0 } : (n <= BLANK_PAD_MAX ? { pad: n, omitted: 0 } : { pad: 0, omitted: n });
  }

  /** 把一份文档里引用到的图片一次性抽成 data: URL（带上限，超限/不支持就返回 null → 占位文字）。
   *  ▎为什么要**预先**抽：渲染那一层是同步的（一段递归走完整棵树），而解压是异步的——
   *    在同步渲染里 await 会把树遍历搅乱。先异步备料、再同步渲染，
   *    是这类"树遍历 + IO"最省心的分法。 */
  async function collectImages(zip, baseDir, rels, rids, opts) {
    const o = opts || {};
    /* ★ 2026-10-08 I8（拿真实文件回扫抓到的缺陷，见 `后续升级方向.md` I8）：
     *   这本账**原来不是文档级的**。pptx 是逐页调用本函数的，而 total 写在函数内部
     *   ⇒ "一份文档 16MB 上限"实际是"**每页** 16MB"。
     *   ▎现场证据：一份 25 页、media 目录解压后合计只有 7.5MB 的真 PPT，
     *     被渲染成 **61 条 data URL / 40.4MB 的 HTML 字符串**——因为很多页重复引用同一张图。
     *     顺手量过插入代价（同一份真图结构，无头 Edge 实测）：0.5MB=3ms、8MB=31ms、16MB=59ms、40MB=142ms。
     *     所以这**不是"卡死"级别的缺陷**，但假的限额比没有限额更危险：
     *     换一份更大的文件它会一路放大到几百 MB，而界面上没有任何一行字说图是被谁裁掉的（坑 76 的又一形状）。
     *   ▸ 现在记**两条账**，各答一个问题：
     *     · decoded = 唯一图片的解压字节 → "要我解码多少内存"（同一张图只算一次、也只解压一次）
     *     · emitted = 每次引用都算一次   → "DOM 里要躺多少字符"（一张 logo 引 20 页就是 20 份字符串）
     *     两个数天然不一样，硬用一个上限就会两边都判错。
     *   ▸ skipped 的单位是**位置**（用户看到的"这里本该有图却空着"有几处），
     *     而且只算"被预算裁掉"的：**"这格式浏览器画不了"是另一件事**，混进同一个数，
     *     那句"省略了 N 张"就在谎报原因（坑 47：一个概念一个来源）。
     *   ▸ 三条上限都能由调用方注入（maxImageEachBytes / maxImageDecodedBytes / maxImageEmittedBytes）：
     *     测试要能在几 KB 的夹具上把"超预算"这条路走一遍，而不是搬一份 16MB 的假图去撞生产上限。 */
    const budget = o.budget || { decoded: 0, emitted: 0, skipped: 0, bad: 0, missing: 0, cache: new Map() };
    /* 三种"没画出来"分开记账（skipped=被预算裁 / bad=格式画不了 / missing=包里找不到），
     * 单位统一是**位置**（用户看到的第几处空着），imgSkippedNote 才敢把数直接说给人听。 */
    const bump = (k) => { budget[k] = (budget[k] || 0) + 1; };
    const capEach = Number(o.maxImageEachBytes) > 0 ? Number(o.maxImageEachBytes) : MAX_IMG_EACH;
    const capDecoded = Number(o.maxImageDecodedBytes) > 0 ? Number(o.maxImageDecodedBytes) : MAX_IMG_DECODED;
    const capEmitted = Number(o.maxImageEmittedBytes) > 0 ? Number(o.maxImageEmittedBytes) : MAX_IMG_EMITTED;
    const out = new Map();
    for (const rid of rids) {
      if (out.has(rid)) continue;
      const rel = rels.get(rid);
      if (!rel || rel.external || !rel.target) { bump('missing'); out.set(rid, null); continue; }
      const part = resolveZipPath(baseDir, rel.target);
      if (!part || !zip.has(part)) { bump('missing'); out.set(rid, null); continue; }
      const ext = extOf(part);
      if (!IMG_OK_EXT.has(ext)) { bump('bad'); out.set(rid, null); continue; }
      const seen = budget.cache.get(part);
      if (seen) {
        if (seen.bad) { bump('bad'); out.set(rid, null); continue; }      // 画不了的格式：不再解压，也不算"被裁"
        if (seen.over) { bump('skipped'); out.set(rid, null); continue; }
        if (budget.emitted + seen.size > capEmitted) { bump('skipped'); out.set(rid, null); continue; }
        budget.emitted += seen.size;
        out.set(rid, seen.url);                                          // 同一张图：解压与 base64 只做一次
        continue;
      }
      let bytes;
      try { bytes = await zip.read(part); } catch (e) { bump('missing'); out.set(rid, null); continue; }
      if (!bytes || !bytes.length) { bump('missing'); out.set(rid, null); continue; }
      /* 扩展名说是图片，但字节不认（真实世界有人把 .emf 改名成 .png 塞进 PPT）→ 占位。
       * ▸ 记成 bad 而不是 over：这两件事的**原因不同**，用户看到的说明也就不该同一句。 */
      const real = magicKind(bytes);
      if (real !== 'image' && !(ext === 'svg' && bytes[0] === 0x3c)) {
        budget.cache.set(part, { bad: true });
        bump('bad');
        out.set(rid, null);
        continue;
      }
      if (bytes.length > capEach || budget.decoded + bytes.length > capDecoded) {
        budget.cache.set(part, { over: true });
        bump('skipped');
        out.set(rid, null);
        continue;
      }
      budget.decoded += bytes.length;
      const mime = ext === 'svg' ? 'image/svg+xml' : mimeOf(part);
      const url = `data:${mime};base64,${base64(bytes)}`;
      budget.cache.set(part, { url, size: bytes.length });
      /* 到这里图是"能画的"，但 DOM 的字符预算可能已经用完 —— 这一处才叫"被裁掉" */
      if (budget.emitted + bytes.length > capEmitted) {
        bump('skipped');
        out.set(rid, null);
        continue;
      }
      budget.emitted += bytes.length;
      out.set(rid, url);
      if (o.maxImages && out.size >= o.maxImages) break;
    }
    return out;
  }

  /* ───────────────────────── 8. docx（Word）→ HTML ───────────────────────── */

  /**
   * word/styles.xml → 「这个段落样式带不带编号」。
   *
   * ▎为什么非要有它（2026-10-09 用 python-docx 写的那份"真形状"文件抓出来的真缺陷）：
   *   OOXML 里段落成为列表有**两条**路：
   *     ① 段落的 w:pPr 里直接写 w:numPr（Word 里点工具栏的「编号」按钮就是这条）；
   *     ② 段落只写 w:pStyle="ListNumber"，**编号定义在样式自己身上**（styles.xml 里
   *        ListNumber 那条 style 的 w:pPr/w:numPr 指向 numId）。
   *   内核原先只认①，所以"用列表样式写的列表"整片被降级成普通段落——
   *   列表还在、字也在，就是**圆点与序号没了**。这种缺陷不报错，只是"看着不像 Word"。
   *   ▸ 样式还能沿 w:basedOn 继承父样式的编号，所以这里要顺链找（带环保护：
   *     坏文件里 basedOn 互相指是可能的，不挡就死循环把页面卡死）。
   * @returns {(styleId:string) => {numId:string, ilvl:string} | null}
   */
  async function loadDocxStyles(zip) {
    const xml = await zip.text('word/styles.xml');
    const byId = new Map();
    if (xml) {
      const doc = parseXml(xml);
      for (const st of all(doc, 'style')) {
        const id = attr(st, 'styleId');
        if (!id) continue;
        const pPr = child(st, 'pPr');
        const numPr = pPr ? child(pPr, 'numPr') : null;
        byId.set(id, {
          basedOn: attr(child(st, 'basedOn'), 'val') || '',
          // numId 有值=带编号；显式 0=「本样式取消编号」，它也是"答案"，不许继续往上找
          numId: numPr ? (attr(child(numPr, 'numId'), 'val') || '0') : null,
          ilvl: numPr ? (attr(child(numPr, 'ilvl'), 'val') || '0') : '0',
        });
      }
    }
    return function styleNumOf(styleId) {
      let cur = styleId;
      for (let guard = 0; cur && guard < 32; guard++) {       // 32 层足够深，且挡住 basedOn 成环
        const s = byId.get(cur);
        if (!s) return null;
        if (s.numId !== null) return s.numId === '0' ? null : { numId: s.numId, ilvl: s.ilvl };
        cur = s.basedOn;
      }
      return null;
    };
  }

  /** numbering.xml：numId + ilvl → 'bullet' | 'decimal'（决定画 • 还是 1.）。 */
  async function loadNumbering(zip, styleNumOf) {
    const xml = await zip.text('word/numbering.xml');
    const numToAbs = new Map();
    const numToStyle = new Map();   // ★ w:num 不直接给 abstractNumId，而是"用某样式的编号"（numStyleLink）
    const absFmt = new Map();     // `${absId}:${ilvl}` → fmt
    if (xml) {
      const doc = parseXml(xml);
      for (const an of all(doc, 'abstractNum')) {
        const id = attr(an, 'abstractNumId');
        for (const lvl of children(an, 'lvl')) {
          const ilvl = attr(lvl, 'ilvl') || '0';
          const fmt = attr(child(lvl, 'numFmt'), 'val');
          if (fmt) absFmt.set(`${id}:${ilvl}`, fmt);
        }
      }
      for (const num of all(doc, 'num')) {
        const id = attr(num, 'numId');
        if (!id) continue;
        const abs = attr(child(num, 'abstractNumId'), 'val');
        if (abs) numToAbs.set(id, abs);
        const link = attr(child(num, 'numStyleLink'), 'val') || attr(child(num, 'styleLink'), 'val');
        if (link) numToStyle.set(id, link);
      }
    }
    function fmtOf(numId, ilvl) {
      if (!numId) return null;
      const abs = numToAbs.get(String(numId));
      if (abs === undefined) {
        /* 这个 numId 走的是"链接到样式"那条路：顺着样式自己带的 numPr 再解析一次。
         * 解析不出来时仍按 'bullet' 兜底——**有编号定义但细节未知，画成圆点也比不画好**
         * （列表丢了层级是内容损失，圆点当序号只是长相问题，两者的代价不对称）。 */
        const linked = numToStyle.get(String(numId));
        const inner = linked && styleNumOf ? styleNumOf(linked) : null;
        if (inner && inner.numId && inner.numId !== String(numId)) return fmtOf(inner.numId, inner.ilvl || ilvl);
        return 'bullet';
      }
      const f = absFmt.get(`${abs}:${ilvl || '0'}`);
      if (!f) return 'bullet';
      return f === 'bullet' ? 'bullet' : 'decimal';
    }
    return fmtOf;
  }


  /** 收集整棵树里出现的图片引用，供 collectImages 一次备料。
   *  ▸ 两条来源都要收，缺一条就是"图在包里躺着，界面上一片占位"：
   *    · DrawingML：`a:blip r:embed / r:link`（Word 2007+ 的"插入图片"）
   *    · **VML**：`v:imagedata r:id`（Word 2003 及"旧版格式/公式对象/艺术字"还在用，
   *      中文论文模板尤其常见——它们封面上的校徽、横线、公式图整片是 `<w:pict>`）
   *    ▎2026-10-10 用户那份 469KB 的《数学建模》论文模板就是这一条：包里有 5 张**真 JPEG**、
   *      7 处 `v:imagedata` 指过去，而内核只认 `a:blip` ⇒ 一张都没备料 ⇒ 49 个灰方块。
   *      这条以前没有任何断言，因为**我自己写的夹具只会造 a:blip**（坑 130：夹具测的是记忆不是能力）。 */
  function collectRids(node, out) {
    const res = out || [];
    for (const k of kidsOf(node || {})) {
      if (!isEl(k)) continue;
      const tag = local(k.tag);
      if (tag === 'blip') {
        const rid = attr(k, 'embed') || attr(k, 'link');
        if (rid) res.push(rid);
      } else if (tag === 'imagedata') {
        const rid = attr(k, 'id');
        if (rid) res.push(rid);
      }
      collectRids(k, res);
    }
    return res;
  }

  const DOCX_HEADING = /^(?:heading|标题)\s*([1-9])$/i;

  async function docxToHtml(u8, opts) {
    const o = opts || {};
    const bytes = toU8(u8);
    if (bytes.length > MAX_PARSE_BYTES) throw new Error(`文件 ${fmtSize(bytes.length)} 太大，超过 ${fmtSize(MAX_PARSE_BYTES)} 的在线解析上限，请下载后查看`);
    const zip = openZip(bytes, o);
    const docXml = await zip.text('word/document.xml');
    if (!docXml) throw new Error('这个 .docx 里没有 word/document.xml（可能不是 Word 文档，或文件已损坏）');
    const doc = parseXml(docXml);
    const body = first(doc, 'body');
    if (!body) throw new Error('这份 Word 文档没有正文（w:body 缺失）');
    const rels = await readRels(zip, 'word/_rels/document.xml.rels');
    const styleNumOf = await loadDocxStyles(zip);
    const numFmt = await loadNumbering(zip, styleNumOf);
    const imgBudget = { decoded: 0, emitted: 0, skipped: 0, bad: 0, missing: 0, cache: new Map() };
    const images = await collectImages(zip, 'word', rels, collectRids(body), { ...o, budget: imgBudget });

    const ctx = { rels, images, numFmt, styleNumOf, stats: { paragraphs: 0, tables: 0, images: 0, chars: 0, imagesSkipped: 0, shapes: 0 } };
    const html = docxBlocks(elems(body), ctx);
    ctx.stats.imagesSkipped = imgBudget.skipped;
    ctx.stats.imagesBad = imgBudget.bad;
    ctx.stats.imagesMissing = imgBudget.missing;
    return {
      /* 说明行带**三种原因**各自的数（预算裁掉 / 格式画不了 / 矢量图形），一句里各说各的，
       * 不合并成一个"省略了 N 张"（坑 125：混计就是在谎报原因）。 */
      html: (html || '<p class="fv-empty">（这份文档没有可提取的文字）</p>')
        + imgSkippedNote({ skipped: imgBudget.skipped, bad: imgBudget.bad, missing: imgBudget.missing, shapes: ctx.stats.shapes }),
      meta: ctx.stats,
    };
  }

  /** 正文块序列 → HTML（w:p / w:tbl / w:sdt）。列表要"连续成组"，所以在这里攒。
   *  ▸ ★ 2026-10-10：连续**空段**要折叠（判据与 xlsx 共用 blankRunOf）。
   *    Word 拿空段落当排版间距用，一份真论文模板里 1609 段有 **1198 段是空的**——
   *    照原样画出来，正文被推到第 48 屏，用户打开面板看到的是"一片空白 + 几个灰方块"，
   *    于是他说"word 共享还是没有实现"。**信息都在，但被排版的噪音推到了看不见的地方**，
   *    这类"没实现"不是功能缺陷，是呈现缺陷——而用户只会说成前者。 */
  function docxBlocks(nodes, ctx) {
    let out = '';
    let items = [];       // [{ ilvl, ordered, html }]
    let pendingBlank = 0;
    const drainBlank = () => {
      if (!pendingBlank) return '';
      const r = blankRunOf(pendingBlank);
      pendingBlank = 0;
      if (r.omitted) return `<p class="fv-blankrun">（Word 用空行排版，这里省略了 ${r.omitted} 个空行）</p>`;
      return DOCX_BLANK_P.repeat(r.pad);
    };
    const flushList = () => {
      if (!items.length) return;
      out += renderListItems(items);
      items = [];
    };
    const flushAll = () => { flushList(); out += drainBlank(); };
    for (const n of nodes) {
      if (!isEl(n)) continue;
      const t = local(n.tag);
      if (t === 'sdt') {                                   // 内容控件（目录/占位符）：钻进去继续
        const content = child(n, 'sdtContent');
        if (content) { flushAll(); out += docxBlocks(elems(content), ctx); }
        continue;
      }
      /* ★ 正文流里也会遇到"包一层的壳"：customXml（带自定义标记的段落包装）、
       *   AlternateContent（同一块内容的新旧两份）。原先这两种直接掉出 if 链，
       *   块级整片消失——**Word 的目录(SDT 之外的老写法)与自定义 XML 内容控件就是这一类**。 */
      if (t === 'customXml' || t === 'AlternateContent') {
        const src = t === 'AlternateContent' ? (first(n, 'Choice') || first(n, 'Fallback')) : n;
        if (src) { flushAll(); out += docxBlocks(elems(src), ctx); }
        continue;
      }
      if (t === 'p') {
        const pPr = child(n, 'pPr');
        const numPr = pPr ? child(pPr, 'numPr') : null;
        /* 编号的两个来源（详见 loadDocxStyles 的注释）：段落自己写的 numPr 优先；
         * 段落没写时，才去看它 pStyle 指向的样式带不带编号。
         * ▸ 顺序不能反：段落级 numId=0 是"这一段取消编号"，它对样式的默认编号**有否决权**，
         *   而这条否决恰好由"direct 存在就不查样式"实现——查了样式会把否决吃掉。 */
        let numId = null; let ilvl = '0';
        if (numPr) {
          numId = attr(child(numPr, 'numId'), 'val') || null;
          ilvl = attr(child(numPr, 'ilvl'), 'val') || '0';
        } else {
          const sn = ctx.styleNumOf && pPr ? ctx.styleNumOf(attr(child(pPr, 'pStyle'), 'val') || '') : null;
          if (sn) { numId = sn.numId; ilvl = sn.ilvl || '0'; }
        }
        if (numId && numId !== '0') {                    // numId=0 是"取消编号"
          const f = ctx.numFmt(numId, ilvl) || 'bullet';
          items.push({ ilvl: Math.min(3, parseInt(ilvl, 10) || 0), ordered: f !== 'bullet', html: docxRuns(n, ctx) || '&nbsp;' });
          continue;
        }
        /* 顺序要紧：先渲染这一段、再决定要不要折叠。反过来写（先 flush 再判）会让
         * 每个空段都把前面攒着的空段冲出去 ⇒ 计数永远到不了阈值，折叠形同虚设（坑 76）。 */
        const one = docxParagraph(n, ctx);
        /* 空段不进 out，先进计数器——连续几十个才压成一行说明（见 docxBlocks 头部注释）。
         * ▸ 判"空"用的是**渲染结果**而不是"有没有 w:t"：一段里只有线条/图片占位时，
         *   它画出来是有东西的，不许被当成空行吞掉（吞掉信息比留白严重得多）。 */
        if (one === DOCX_BLANK_P) { pendingBlank++; continue; }
        flushAll();
        out += one;
        continue;
      }
      if (t === 'tbl') { flushAll(); out += docxTable(n, ctx); continue; }
    }
    flushAll();
    return out;
  }

  /* 空段的那一份 HTML **只写一次**：docxBlocks 要靠"渲染结果等于它"来判空，
   * 两处各写一份字符串，将来改一处就让折叠静默失效（坑 76/47）。 */
  const DOCX_BLANK_P = '<p class="fv-blank">&nbsp;</p>';

  function docxParagraph(p, ctx) {
    ctx.stats.paragraphs++;
    const pPr = child(p, 'pPr');
    const style = pPr ? attr(child(pPr, 'pStyle'), 'val') : '';
    const jc = pPr ? attr(child(pPr, 'jc'), 'val') : '';
    const align = jc === 'center' ? 'center' : jc === 'right' ? 'right' : jc === 'both' ? 'justify' : '';
    let inner = docxRuns(p, ctx);
    ctx.stats.chars += textOf(p).replace(/\s/g, '').length;
    const hm = DOCX_HEADING.exec(style || '');
    if (hm) { const lv = Number(hm[1]); return `<h${lv}>${inner || '&nbsp;'}</h${lv}>`; }
    if (/^Title$/i.test(style || '')) return `<h1 class="fv-doc-title">${inner || '&nbsp;'}</h1>`;
    if (/^Subtitle$/i.test(style || '')) return `<p class="fv-doc-sub">${inner || '&nbsp;'}</p>`;
    const cls = [];
    if (align) cls.push(`fv-al-${align}`);
    if (/Quote|引用/i.test(style || '')) cls.push('fv-quote');
    if (!inner) return DOCX_BLANK_P;
    return `<p${cls.length ? ` class="${cls.join(' ')}"` : ''}>${inner}</p>`;
  }

  /** 一个 w:p 里的所有 run（含超链接、修订插入、图片）。 */
  function docxRuns(p, ctx) {
    let out = '';
    for (const k of kidsOf(p)) {
      if (!isEl(k)) continue;
      const t = local(k.tag);
      if (t === 'r') out += docxRun(k, ctx);
      else if (t === 'hyperlink') {
        const rid = attr(k, 'id');
        const rel = rid && ctx.rels ? ctx.rels.get(rid) : null;
        const inner = children(k, 'r').map((r) => docxRun(r, ctx)).join('');
        /* 只有**外部**链接（TargetMode="External"）才画成 <a>；内部锚点（"跳到本文第 3 章"）
         * 在网页里没有对应的落点，画成一个点了没反应的链接比不画更糟（坑 82：假链接）。 */
        const u = rel && rel.external ? safeUrl(rel.target) : '';
        out += u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : inner;
      } else if (t === 'ins' || t === 'smartTag' || t === 'bdo' || t === 'dir'
        || t === 'customXml' || t === 'fldSimple' || t === 'moveFrom' || t === 'moveTo') out += docxRuns(k, ctx);
      /* ★ 域代码（fldSimple）与内容控件（customXml/sdt）都是"包着正文的一层壳"。
       *   Word 的目录、页码、交叉引用、内容控件全在这一层里面——
       *   原先只认 ins/smartTag，于是"用域写出来的东西"整片静默消失（坑 76：机制在，从没生效）。
       *   ▸ fldSimple 里的 w:instrText 由 docxRun 自己忽略（那是**指令**不是正文），
       *     这里递归进去取的正是它包着的**结果**。 */
      else if (t === 'sdt') { const c = child(k, 'sdtContent'); if (c) out += docxRuns(c, ctx); }
      /* ★ AlternateContent（Word 给同一个形状写两份：新格式 Choice + 老格式 Fallback）。
       *   **只取一份**，两份都取就把同一段字画两遍——而"重复"在界面上看起来像渲染 bug，
       *   实际上是我把"兼容副本"当成了内容。 */
      else if (t === 'AlternateContent') {
        const src = first(k, 'Choice') || first(k, 'Fallback');
        if (src) out += docxRuns(src, ctx);
      }
      /* ★ 公式（OMML）：Word 的公式不是 w:t，而是 m:t 一截一截拼起来的。
       *   在线预览不做二维排版（那是 MathML 渲染器的活，违背零依赖红线），
       *   但**按线性文本给出**是做得到的——宁可长相朴素，不可整块空白。 */
      else if (t === 'oMath' || t === 'oMathPara') out += `<span class="fv-math">${docxMathText(k)}</span>`;
      else if (t === 'del') { /* 修订删除的内容不显示（Word 里"最终状态"就是这样） */ }
    }
    return out;
  }

  /** OMML 公式 → 线性文本（把树里所有 m:t 的字按文档顺序接起来）。 */
  function docxMathText(node) {
    let s = '';
    for (const k of kidsOf(node || {})) {
      if (typeof k === 'string') continue;
      if (!isEl(k)) continue;
      if (local(k.tag) === 't') s += esc(textOf(k));
      else if (local(k.tag) === 'f') { const num = child(k, 'num'); const den = child(k, 'den'); s += `(${docxMathText(num)})/(${docxMathText(den)})`; }
      else if (local(k.tag) === 'sup') s += `^${docxMathText(k)}`;
      else if (local(k.tag) === 'sub') s += `_${docxMathText(k)}`;
      else s += docxMathText(k);
    }
    return s;
  }

  /**
   * 文本框（txbxContent）里的字。
   * ▎为什么要专门找它：Word 的"文本框"看着就是页面上的一块字，但那些字**不在正文流里**，
   *   而是塞在 w:pict / w:drawing 下面的一棵子树中。原先 docxDrawing 只找图片引用（a:blip），
   *   找不到就回一个〔图片〕占位——于是真文档里"封面大字/结论框"整块变成占位符。
   *   ▸ 输出用 inline 的 span + `<br>`，不用 div/段落：这段 HTML 会插进 `<p>` 里，
   *     块级元素放进 p 里浏览器会自己把 p 拆开，那样反而把上下文排版弄坏（坑 103 家族：
   *     加子元素前先想清楚谁在按位置/按层级读它）。
   */
  function docxTextBoxText(node, ctx) {
    let s = '';
    (function walk(n) {
      for (const k of kidsOf(n || {})) {
        if (!isEl(k)) continue;
        const t = local(k.tag);
        if (t === 'txbxContent') {
          for (const p of all(k, 'p')) s += (s ? '<br>' : '') + docxRuns(p, ctx);
        } else walk(k);
      }
    })(node);
    return s;
  }

  function docxRun(r, ctx) {
    const rPr = child(r, 'rPr');
    let s = '';
    for (const k of kidsOf(r)) {
      if (typeof k === 'string') continue;               // w:r 的直接文本极少见，交给 w:t
      const t = local(k.tag);
      if (t === 't') s += esc(textOf(k));
      else if (t === 'tab') s += '&emsp;';
      else if (t === 'br' || t === 'cr') s += '<br>';
      else if (t === 'noBreakHyphen') s += '-';
      else if (t === 'sym') s += '&bull;';
      else if (t === 'drawing' || t === 'pict' || t === 'object') s += docxDrawing(k, ctx);
      else if (t === 'footnoteReference' || t === 'endnoteReference') s += `<sup>${esc(attr(k, 'id'))}</sup>`;
    }
    if (!s) return '';
    if (rPr) {
      const va = attr(child(rPr, 'vertAlign'), 'val');
      if (va === 'superscript') s = `<sup>${s}</sup>`;
      else if (va === 'subscript') s = `<sub>${s}</sub>`;
      if (hasChild(rPr, 'strike')) s = `<s>${s}</s>`;
      const u = attr(child(rPr, 'u'), 'val');
      if (u && u !== 'none') s = `<u>${s}</u>`;
      if (hasChild(rPr, 'i')) s = `<em>${s}</em>`;
      if (hasChild(rPr, 'b') && attr(child(rPr, 'b'), 'val') !== 'false' && attr(child(rPr, 'b'), 'val') !== '0') s = `<strong>${s}</strong>`;
      const hl = attr(child(rPr, 'highlight'), 'val');
      if (hl && hl !== 'none') s = `<mark>${s}</mark>`;
    }
    return s;
  }

  /** w:drawing / w:pict 里的图片：按 r:embed（DrawingML）或 r:id（VML）找关系，取预先备好的 data: URL。
   *  ▎替代文字有两个来源：`wp:docPr`（Word 自己写的"说明文字"）与
   *    `pic:cNvPr`（图形对象名）——只找前者会漏掉一批文件（真实文档里两者常常只有一个）。
   *  ▸ 占位方块上那个词**要按原因分**（2026-10-10）：「图片取不到」与「这本来就不是图片」
   *    是两种病，都写〔图片〕的话，用户会以为我们读图读坏了，而真相是那是条矢量线条。 */
  function docxDrawing(node, ctx) {
    /* 先问"这是不是一个文本框"——文本框里没有 blip，原先它会掉进下面的占位符分支，
     * 于是"框里的字"变成了〔图片〕。顺序就是判据：先内容，后占位。 */
    const tb = docxTextBoxText(node, ctx);
    if (tb) return `<span class="fv-txbx">${tb}</span>`;
    const blip = first(node, 'blip');
    const vml = first(node, 'imagedata');
    const rid = blip ? (attr(blip, 'embed') || attr(blip, 'link')) : (vml ? attr(vml, 'id') : '');
    const src = rid ? ctx.images.get(rid) : null;
    const pr = first(node, 'docPr') || first(node, 'cNvPr');
    const label = attr(pr, 'descr') || attr(pr, 'name') || attr(vml, 'title') || '';
    if (src) {
      ctx.stats.images++;
      return `<img class="fv-docimg" src="${src}" alt="${esc(label)}" loading="lazy">`;
    }
    if (!rid && hasVecShape(node)) {
      ctx.stats.shapes++;
      return '<span class="fv-ph fv-ph-shape">〔图形〕</span>';
    }
    return `<span class="fv-ph">〔图片${label ? `：${esc(label)}` : ''}〕</span>`;
  }

  /* Word 的矢量图元（VML 与 DrawingML 两套里的"形状"那一半）：线条、方框、箭头、组合、艺术字轮廓。
   * ▸ 这些**不是图片**，是带坐标的绘制指令——在线还原要一个 VML 渲染器，我们只还原文字与图片，
   *   所以它结构上画不出来。承认这一点，比塞一个"图片"占位过去更诚实（坑 82：假说明比缺失更糟）。 */
  const VEC_SHAPE = new Set(['line', 'rect', 'roundrect', 'oval', 'arc', 'curve', 'group',
    'shape', 'shapetype', 'wsp', 'snip1rect', 'textbox']);
  function hasVecShape(node) {
    let hit = false;
    (function walk(n) {
      if (hit || !n) return;
      for (const k of kidsOf(n || {})) {
        if (!isEl(k)) continue;
        if (VEC_SHAPE.has(local(k.tag))) { hit = true; return; }
        walk(k);
        if (hit) return;
      }
    })(node);
    return hit;
  }

  function docxTable(tbl, ctx) {
    ctx.stats.tables++;
    const rows = children(tbl, 'tr');
    if (!rows.length) return '';
    /* ★ 2026-10-08（I5）先把格子摊到**网格坐标**上，才能算纵向合并（w:vMerge）的 rowspan。
     * ▎为什么这是真缺陷而不是"锦上添花"：Word 里纵向合并的"续格"是**存在但没有内容**的
     *   （文字只在起始格里）。原先照抄 DOM 输出，续格就变成一格空格子——
     *   合并单元格在页面上看起来像"表格坏了一半"，而这份文档其实完全正常。
     * ▎两个细节容易错：
     *   ① 列号要按 `gridSpan` 累加（横向合并占几列，后面的格子就往右移几格），
     *      否则一个跨列格会把整张表的坐标挤歪；
     *   ② `w:vMerge` **不带 val 就是"继续"**，带 `val="restart"` 才是起始——
     *      反过来写会把每一格都当成新合并的开始（rowspan 全是 1，空格子照旧）。 */
    const grid = rows.map(() => []);
    rows.forEach((tr, ri) => {
      let col = 0;
      for (const tc of children(tr, 'tc')) {
        const tcPr = child(tc, 'tcPr');
        const span = Math.max(1, Math.min(20, parseInt(attr(child(tcPr, 'gridSpan'), 'val'), 10) || 1));
        const vm = tcPr ? child(tcPr, 'vMerge') : null;
        grid[ri][col] = { tc, tcPr, span, vm: vm ? (attr(vm, 'val') || 'continue') : null };
        col += span;
      }
    });
    const skip = rows.map(() => ({}));
    let h = '<div class="fv-tblwrap"><table class="fv-tbl fv-doc-tbl">';
    rows.forEach((tr, ri) => {
      const tag = ri === 0 ? 'th' : 'td';
      h += `<tr${/true|1/.test(attr(child(tr, 'tblHeader'), 'val')) ? ' class="fv-thead"' : ''}>`;
      const line = grid[ri];
      for (let col = 0; col < line.length; col++) {
        const cell = line[col];
        if (!cell || skip[ri][col]) continue;             // 稀疏列 / 被起始格吃掉的续格
        let rowspan = 1;
        if (cell.vm === 'restart') {
          for (let r2 = ri + 1; r2 < rows.length; r2++) {
            const below = grid[r2] && grid[r2][col];
            if (!below || !below.vm || below.vm === 'restart') break;
            skip[r2][col] = true;
            rowspan++;
          }
        }
        const shade = attr(child(cell.tcPr, 'shd'), 'fill');
        const st = [];
        if (shade && /^[0-9A-Fa-f]{6}$/.test(shade) && shade.toLowerCase() !== 'auto') st.push(`background:#${esc(shade)}`);
        h += `<${tag}${cell.span > 1 ? ` colspan="${cell.span}"` : ''}${rowspan > 1 ? ` rowspan="${rowspan}"` : ''}`
          + `${st.length ? ` style="${st.join(';')}"` : ''}>${docxBlocks(elems(cell.tc), ctx) || '&nbsp;'}</${tag}>`;
      }
      h += '</tr>';
    });
    return `${h}</table></div>`;
  }
  /** 把扁平的列表项（带缩进层级 ilvl）拼成嵌套 ul/ol。markdown 与 docx 共用这一份。
   *  ▎三条不变式（写错过一次，所以钉在这里）：
   *    ① 顶层列表**不许**凭空多一个空 <li>（第一版就犯了这个错）；
   *    ② 嵌套列表必须落在父项 <li> **内部**，所以进深一层时不许先闭合父项；
   *    ③ 同一层里有序性变了（1. 后面接了 -）要**关掉重开**，而不是把 <ul> 塞进 <ol> 里。 */
  function renderListItems(items) {
    let out = '';
    const stack = [];          // 每层：{ ordered }
    let itemOpen = false;      // 当前有没有一个尚未闭合的 <li>
    const closeItem = () => { if (itemOpen) { out += '</li>'; itemOpen = false; } };
    const closeTo = (depth) => {
      while (stack.length > depth) {
        closeItem();
        out += stack.pop().ordered ? '</ol>' : '</ul>';
      }
    };
    for (const it of items) {
      const want = Math.max(1, (Number(it.ilvl) || 0) + 1);
      if (stack.length > want) closeTo(want);
      // 同层但有序性不同：退回上一层，下面的 while 会用新的类型重开
      if (stack.length === want && stack[want - 1].ordered !== !!it.ordered) closeTo(want - 1);
      while (stack.length < want) {
        // 只有"已经在某个列表里"才需要补一个父 <li>（HTML 要求嵌套列表待在 li 内）
        if (stack.length > 0 && !itemOpen) { out += '<li>'; itemOpen = true; }
        out += it.ordered ? '<ol class="fv-ol">' : '<ul class="fv-ul">';
        stack.push({ ordered: !!it.ordered });
        itemOpen = false;      // 刚开的这层里还没有 li
      }
      closeItem();
      out += '<li>';
      itemOpen = true;
      out += it.html || '&nbsp;';
    }
    closeTo(0);
    return out;
  }

  /* ───────────────────────── 9. xlsx（Excel）→ HTML ───────────────────────── */

  /* ▎Excel 的存储方式值得单独讲一句：单元格的值**不是**直接写在表里的——
   *   字符串统一存在 sharedStrings.xml 里，表格只记一个下标（t="s" + <v>7</v>）。
   *   所以不读共享字符串表，整张表就全是数字。这是"自己解析 OOXML"最容易漏的一步。
   * ▎日期更绕：Excel 里没有"日期类型"，日期是**一个数字 + 一条数字格式**。
   *   45123 到底是"第 45123 天"还是"45123 件"，只能看 styles.xml 给这一格配的格式码。
   *   不处理这一步，用户看到的就是满屏五位数字（看起来像功能坏了）。 */

  const BUILTIN_DATE_FMTS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22,
    27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

  function isDateFormat(fmtId, code) {
    const id = Number(fmtId);
    if (BUILTIN_DATE_FMTS.has(id)) return true;
    if (id === 0 || Number.isNaN(id)) return false;
    const c = String(code || '');
    if (!c || /^general$/i.test(c)) return false;
    // 去掉引号里的字面量与转义字符，再看剩下的有没有日期/时间字母
    const stripped = c.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '').replace(/\\./g, '');
    return /[ymdhs]/i.test(stripped) && !/[#0?]/.test(stripped.replace(/[ymdhs]/gi, ''));
  }

  /** Excel 序列号 → 日期字符串。序列号 1 = 1900-01-01，且 Excel 有个著名的
   *  "1900 是闰年"的兼容 bug，所以基准取 1899-12-30（= 序列号 0）。 */
  function excelSerial(n, wantTime) {
    const v = Number(n);
    if (!isFinite(v)) return '';
    const ms = Math.round((v - 25569) * 86400000);       // 25569 = 1970-01-01 的 Excel 序列号
    const d = new Date(ms);
    if (isNaN(d.getTime())) return String(n);
    const p = (x) => String(x).padStart(2, '0');
    const date = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
    const time = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
    if (wantTime === 'time') return time;
    if (wantTime === 'both') return `${date} ${time}`;
    return date;
  }

  /** 格式码里有什么，就显示到什么精度（只有年月日就不带 00:00:00）。
   *  ▎这里有个真实的坑：Excel 格式码里 `m` **既是月也是分钟**——
   *    `yyyy-mm-dd` 的 m 是月，`h:mm:ss` 的 m 是分钟。只按"有没有 m"判会得出
   *    "h:mm:ss 是日期+时间"，于是时间列全部多出一截年份。
   *    判据：把 `h m s :` 连成的整段挖掉（那就是时间部分），剩下的还有 y/d/m 才算日期。 */
  function datePartsOf(code) {
    const c = String(code || '').replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '').replace(/\\./g, '').toLowerCase();
    const hasTime = /[hs]/.test(c);
    const withoutTimeRuns = c.replace(/[hms:]+/g, ' ');
    const hasDate = /[ymd]/.test(withoutTimeRuns);
    if (hasDate && hasTime) return 'both';
    if (hasTime) return 'time';
    return 'date';
  }

  /** 列名 → 0 基下标（'A'→0, 'Z'→25, 'AA'→26）。 */
  function colIndexOf(ref) {
    const m = /^([A-Z]+)/.exec(String(ref || '').toUpperCase());
    if (!m) return 0;
    let n = 0;
    for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  async function loadSharedStrings(zip) {
    const xml = await zip.text('xl/sharedStrings.xml');
    const out = [];
    if (!xml) return out;
    const doc = parseXml(xml);
    const sst = first(doc, 'sst') || doc;
    for (const si of children(sst, 'si')) {
      // 富文本（多段 r）要把每段的 t 拼起来，否则只拿到第一段
      const t = children(si, 't');
      if (t.length) out.push(t.map((x) => textOf(x)).join(''));
      else {
        const runs = children(si, 'r');
        out.push(runs.map((r) => textOf(child(r, 't'))).join(''));
      }
    }
    return out;
  }

  /** styles.xml → 一组"这一格是不是日期 / 日期显示到什么精度"的查询函数。
   *  ▎为什么不把整张样式表返回出去：调用方只关心这两个问题，把结构暴露出去
   *    就会有第二个地方开始自己算日期（坑 47）。 */
  async function loadStyles(zip) {
    const xml = await zip.text('xl/styles.xml');
    const xfFmt = [];                  // cellXfs 下标 → numFmtId
    const custom = new Map();          // 自定义 numFmtId → formatCode
    if (xml) {
      const doc = parseXml(xml);
      const sheet = first(doc, 'styleSheet') || doc;
      const numFmts = child(sheet, 'numFmts');
      if (numFmts) {
        for (const nf of children(numFmts, 'numFmt')) {
          custom.set(Number(attr(nf, 'numFmtId')), attr(nf, 'formatCode'));
        }
      }
      const xfs = child(sheet, 'cellXfs');
      if (xfs) for (const xf of children(xfs, 'xf')) xfFmt.push(Number(attr(xf, 'numFmtId')) || 0);
    }
    const fmtOf = (s) => {
      const i = Number(s);
      return Number.isFinite(i) && i >= 0 ? (xfFmt[i] || 0) : 0;
    };
    return {
      isDate: (s) => { const f = fmtOf(s); return isDateFormat(f, custom.get(f) || ''); },
      dateParts: (s) => { const f = fmtOf(s); return datePartsOf(custom.get(f) || ''); },
      // ★ 数字格式（百分比/货币/小数位/千分位）——判据只写在这一处，cellText 只问它要结论
      numSpec: (s, value) => { const f = fmtOf(s); return numFmtOf(f, custom.get(f) || '', value); },
    };
  }

  async function xlsxToHtml(u8, opts) {
    const o = opts || {};
    const bytes = toU8(u8);
    if (bytes.length > MAX_PARSE_BYTES) throw new Error(`文件 ${fmtSize(bytes.length)} 太大，超过 ${fmtSize(MAX_PARSE_BYTES)} 的在线解析上限，请下载后查看`);
    const zip = openZip(bytes, o);
    const wbXml = await zip.text('xl/workbook.xml');
    if (!wbXml) throw new Error('这个 .xlsx 里没有 xl/workbook.xml（可能不是 Excel 文档，或文件已损坏）');
    const wb = parseXml(wbXml);
    const rels = await readRels(zip, 'xl/_rels/workbook.xml.rels');
    const sst = await loadSharedStrings(zip);
    const styles = await loadStyles(zip);
    const maxRows = Number(o.maxRows) || XLSX_MAX_ROWS;
    const maxCols = Number(o.maxCols) || XLSX_MAX_COLS;

    const sheetsEl = first(wb, 'sheets');
    const sheetNodes = sheetsEl ? children(sheetsEl, 'sheet') : [];
    const parts = [];
    const meta = { sheets: 0, rows: 0, truncated: false };

    for (const sn of sheetNodes) {
      const name = attr(sn, 'name') || `Sheet${parts.length + 1}`;
      const rid = attr(sn, 'id');
      const rel = rid ? rels.get(rid) : null;
      // 没有 r:id 时按顺序猜路径（少见，但手工产出的文件里有）
      const target = rel ? resolveZipPath('xl', rel.target) : `xl/worksheets/sheet${parts.length + 1}.xml`;
      const sxml = await zip.text(target);
      if (!sxml) continue;
      meta.sheets++;
      const sdoc = parseXml(sxml);
      const data = first(sdoc, 'sheetData');
      const rows = data ? children(data, 'row') : [];
      if (!rows.length) {
        parts.push(`<section class="fv-sheetsec" data-sheet="${esc(name)}"><h3 class="fv-sheetname">${esc(name)}</h3><p class="fv-empty">（这张表是空的）</p></section>`);
        continue;
      }
      // 先扫一遍算出真实列数（单元格是稀疏的：空格子根本不写）
      let cols = 0;
      for (const r of rows) for (const c of children(r, 'c')) cols = Math.max(cols, colIndexOf(attr(c, 'r')) + 1);
      cols = Math.max(1, Math.min(cols, maxCols));

      /* ★ 行号与合并区域（2026-10-09 用 openpyxl 写的真形状文件抓出来的两条）：
       *   ① **稀疏行被压扁**：Excel 只在"有内容的行"写 <row>，而行自己带 r="12" 记行号。
       *      原先按出现顺序渲染，于是第 12 行的内容显示在第 6 行的位置上——
       *      会上说"看第 12 行"，屏幕上对不上（数字是对的，**位置是错的**，这类错最难被发现）。
       *   ② **合并区域被忽略**：<mergeCells ref="A6:B6"> 完全没读，A6 只占一格，
       *      右边的 B6 干脆消失，整行比别的行少一格。
       *   ▸ 补法：按行号补空行（连续空白超过 2 行折成一行说明，免得一张"第 5000 行有个角标"
       *     的表刷出 5000 行白块）；合并锚点写 colspan/rowspan，被盖住的位置不再输出 td。 */
      const rowAt = [];
      rows.forEach((r, i) => {
        const n = Number(attr(r, 'r'));
        rowAt.push(Number.isFinite(n) && n > 0 ? n : (i ? rowAt[i - 1] + 1 : 1));
      });
      const byRow = new Map();
      rows.forEach((r, i) => byRow.set(rowAt[i], r));
      const mergeSpan = new Map();
      const covered = new Set();
      const mcEl = first(sdoc, 'mergeCells');
      if (mcEl) {
        for (const m of children(mcEl, 'mergeCell')) {
          const ref = String(attr(m, 'ref') || '');
          const mm = /^([A-Za-z]+\d+):([A-Za-z]+\d+)$/.exec(ref);
          if (!mm) continue;
          const c1 = colIndexOf(mm[1]);
          const c2 = colIndexOf(mm[2]);
          const r1 = Number(/\d+/.exec(mm[1])[0]);
          const r2 = Number(/\d+/.exec(mm[2])[0]);
          if (!(r1 > 0) || r2 < r1 || c2 < c1) continue;
          mergeSpan.set(`${r1}:${c1}`, { cs: Math.min(c2 - c1 + 1, cols), rs: r2 - r1 + 1 });
          for (let rr = r1; rr <= r2; rr++) {
            for (let cc = c1; cc <= c2; cc++) if (!(rr === r1 && cc === c1)) covered.add(`${rr}:${cc}`);
          }
        }
      }
      const firstRowIdx = rowAt.length ? rowAt[0] : 1;
      const lastRowIdx = rowAt.length ? rowAt[rowAt.length - 1] : 0;
      /* 阈值不在这里写第二份：blankRunOf 是 docx 与 xlsx 共用的那一条判据（见文件里它的注释）。
       * xlsx 这一侧多一层理由——≤6 行照原样占位是为了让"第 12 行"这种口头指代还对得上。 */
      meta.rows = 0;
      let pendingBlank = 0;
      const flushBlank = (buf) => {
        let out = buf;
        if (pendingBlank) {
          const r = blankRunOf(pendingBlank);
          for (let i = 0; i < r.pad; i++) out += `<tr class="fv-blankrow"><td colspan="${cols}"></td></tr>`;
          if (r.omitted) out += `<tr class="fv-blankrun"><td colspan="${cols}">省略 ${r.omitted} 行空白</td></tr>`;
          pendingBlank = 0;
        }
        return out;
      };
      let h = `<section class="fv-sheetsec" data-sheet="${esc(name)}"><h3 class="fv-sheetname">${esc(name)}</h3>`;
      h += '<div class="fv-tblwrap"><table class="fv-tbl fv-sheet"><tbody>';
      for (let rn = firstRowIdx; rn <= lastRowIdx && rn <= maxRows; rn++) {
        const r = byRow.get(rn);
        const cells = new Array(cols).fill('');
        const hadCells = !!r && children(r, 'c').length > 0;
        if (r) {
          for (const c of children(r, 'c')) {
            const ci = colIndexOf(attr(c, 'r'));
            if (ci < 0 || ci >= cols) continue;
            if (covered.has(`${rn}:${ci}`)) continue;                 // 被合并盖住：不重复出一格
            cells[ci] = cellText(c, sst, styles);
          }
        }
        const hasSpan = [...mergeSpan.keys()].some((k) => k.startsWith(`${rn}:`));
        /* 「这一行在文件里存在」与「这一行有字」是两件事：
         * 只有 <f> 没有 <v> 的公式行、被清过内容但留着格式的行，Excel 都会写出 <row>。
         * 判成空白把它抽掉，就是"整行凭空消失"（回归里那条"公式无缓存值留空行"当场红）。 */
        if (!hadCells && !hasSpan) { pendingBlank++; continue; }
        h = flushBlank(h);
        meta.rows++;
        h += '<tr>';
        for (let k = 0; k < cols; k++) {
          if (covered.has(`${rn}:${k}`)) continue;
          const sp = mergeSpan.get(`${rn}:${k}`);
          const a = sp ? ` colspan="${sp.cs}"${sp.rs > 1 ? ` rowspan="${sp.rs}"` : ''} class="fv-merged"` : '';
          h += `<td${a}>${cells[k]}</td>`;
        }
        h += '</tr>';
      }
      h = flushBlank(h);
      if (lastRowIdx > maxRows) {
        meta.truncated = true;
        h += `<p class="fv-note">这张表的内容一直写到第 ${lastRowIdx} 行，这里只显示前 ${maxRows} 行（下载可看全部）。</p>`;
      }
      parts.push(`${h}</tbody></table></div></section>`);
    }
    if (!parts.length) throw new Error('这份工作簿里没有可读的工作表');
    return {
      html: `<div class="fv-wb">${parts.join('')}</div>`,
      meta,
    };
  }

  /** 一个单元格 → 已转义的显示文本。 */
  /* ★ 数字格式（百分比 / 货币 / 小数位 / 千分位）——2026-10-09 用 openpyxl 写的真形状文件抓的缺口：
   *   表里存 0.25、格式码 '0.00%'，Excel 显示 **25.00%**，而我们原先直接打 0.25；
   *   '¥#,##0.00' 存 1234.5，Excel 显示 ¥1,234.50，我们打 1234.5。
   *   ▎这不是"美化"，是**读错数**：0.25 与 25.00% 在会议里是两个完全不同的东西
   *   （一个说不清是比例还是百分比的裸数，一个明确的 25%）。
   *   日期那一路早就承认了"值 + 格式"这个模型，数字这一路却漏了——同一份格式码只该有一处解释。 */
  const BUILTIN_NUM_FMTS = {
    1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00',
    9: '0%', 10: '0.00%',
    37: '#,##0;(#,##0)', 38: '#,##0.00;(#,##0.00)',
    39: '#,##0;(#,##0);-;', 40: '#,##0.00;(#,##0.00);-;',
    43: '_-*$ #,##0.00_-_-*$ "-"_-;_-* "-"??_-;_-@_-',
    44: '_-* #,##0.00_-;_-* "-"??_-;_-@_-',
  };
  /** 拆一个格式码段 → { pct, dp, group, prefix, suffix, parens }。
   *  ▎分类只有一条：`0 # ? . ,` 是**占位符与结构符**，其余字符全是**字面量**（Excel 会照打）。
   *    第一版我把这一步写成"抠引号里的东西"，结果 `¥#,##0.00` 的 ¥ 掉在 body 里
   *    谁都不认——输出成了 1,234.50（少币符），而 0.00% 的 % 被吞掉后输出 25.00（少百分号）。
   *    ▸ 少一个百分号不是少个装饰：**25.00 与 25.00% 是两个数**（读错数比难看严重得多）。 */
  function parseNumSection(sec) {
    let s = String(sec || '').replace(/\[[^\]]*\]/g, '');   // [Red]/[<100] 是颜色与条件，不是排版
    const pre = [];
    const post = [];
    let body = '';
    let pct = false;
    let seenPh = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\\') { if (i + 1 < s.length) { (seenPh ? post : pre).push(s[i + 1]); i++; } continue; }
      if (ch === '"') {
        let j = i + 1; let buf = '';
        while (j < s.length && s[j] !== '"') { buf += s[j]; j++; }
        if (buf) (seenPh ? post : pre).push(buf);
        i = j;
        continue;
      }
      if (ch === '_') { i++; continue; }              // "_x" = 留一个 x 宽的空白（对齐用，忽略）
      if (ch === '*') { i++; continue; }              // 填充字符，忽略
      if (ch === '%') { pct = true; continue; }       // 百分号自己补，不当普通字面量
      if ('0#?.,'.indexOf(ch) >= 0) { body += ch; seenPh = true; continue; }
      if ((ch === 'E' || ch === 'e') && /[0#]/.test(s[i - 1] || '')) { body += 'E'; continue; }
      (seenPh ? post : pre).push(ch);                 // 其余按字面量处理
    }
    const dot = body.indexOf('.');
    let dp = null;
    if (dot >= 0) dp = (body.slice(dot + 1).match(/[0?#]/g) || []).length;
    const intPart = dot < 0 ? body : body.slice(0, dot);
    const group = /,/.test(intPart) && /[0#]/.test(intPart.replace(/,/g, ''));
    const parens = /^\(.*\)$/.test(s.trim());
    return { pct, dp, group, prefix: pre.join(''), suffix: post.join(''), parens };
  }

  /** 格式码 → 用哪一段（Excel 的分号分段语义：正;负;零;文本）。 */
  function numFmtOf(fmtId, code, value) {
    const raw = code || BUILTIN_NUM_FMTS[Number(fmtId)] || '';
    if (!raw) return null;
    const secs = [];
    let buf = '';
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === '\\' && i + 1 < raw.length) { buf += ch + raw[++i]; continue; }
      if (ch === '"') { let j = i + 1; while (j < raw.length && raw[j] !== '"') j++; buf += raw.slice(i, j + 1); i = j; continue; }
      if (ch === ';') { secs.push(buf); buf = ''; continue; }
      buf += ch;
    }
    secs.push(buf);
    let pick = 0;
    if (value === 0 && secs.length >= 3) pick = 2;
    else if (value < 0 && secs.length >= 2) pick = 1;
    const spec = parseNumSection(secs[pick]);
    // 负数只有一段格式码时，符号要自己补上（Excel 就是这么显示的）
    if (value < 0 && secs.length < 2) spec.negative = true;
    return spec;
  }

  /** 按格式码把数字念出来（整数不加小数点、千分位、百分号、货币前后缀）。 */
  function applyNumFmt(num, spec) {
    if (!spec) return null;
    let v = num;
    if (spec.pct) v = v * 100;
    let s = spec.dp === null
      ? String(Number.isInteger(v) ? v : Number(v.toFixed(10)))
      : v.toFixed(spec.dp);
    if (spec.group) {
      const neg = s.startsWith('-');
      if (neg) s = s.slice(1);
      const dot = s.indexOf('.');
      let int = dot < 0 ? s : s.slice(0, dot);
      const tail = dot < 0 ? '' : s.slice(dot);
      int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      s = (neg ? '-' : '') + int + tail;
    }
    if (spec.parens) s = `(${s.replace(/^-/, '')})`;
    else if (spec.negative) s = '-' + s.replace(/^-/, '');
    return spec.prefix + s + (spec.pct ? '%' : '') + spec.suffix;
  }

  function cellText(c, sst, styles) {
    const t = attr(c, 't');
    const sIdx = attr(c, 's');
    if (t === 'inlineStr') {
      const is = child(c, 'is');
      return esc(is ? textOf(is) : '');
    }
    const v = textOf(child(c, 'v'));
    if (t === 's') {
      const i = Number(v);
      return esc(Number.isFinite(i) && sst[i] !== undefined ? sst[i] : '');
    }
    if (t === 'str') return esc(v);                        // 公式的字符串结果
    if (t === 'b') return esc(v === '1' ? 'TRUE' : 'FALSE');
    if (t === 'e') return esc(v || '#ERR');               // 错误值原样显示（#DIV/0! 要看得见）
    if (v === '') return '';
    const num = Number(v);
    if (!Number.isFinite(num)) return esc(v);
    if (styles.isDate(sIdx)) return esc(excelSerial(num, styles.dateParts(sIdx)));
    // ★ 数字格式优先（百分比/货币/小数位/千分位）；认不出来才走"去掉浮点噪声"的裸数
    const spec = styles.numSpec ? styles.numSpec(sIdx, num) : null;
    const fmted = spec ? applyNumFmt(num, spec) : null;
    if (fmted !== null && fmted !== '') return esc(fmted);
    // 数字：去掉浮点噪声（Excel 存的是双精度，1/3 会带一长串）
    return esc(Number.isInteger(num) ? String(num) : String(Number(num.toFixed(10))));
  }


  /* ───────────────────────── 10. pptx（PPT）→ 幻灯片卡片 ───────────────────────── */

  const EMU_PER_PT = 12700;
  const EMU_PER_PX = 9525;

  async function pptxToHtml(u8, opts) {
    const o = opts || {};
    const bytes = toU8(u8);
    if (bytes.length > MAX_PARSE_BYTES) throw new Error(`文件 ${fmtSize(bytes.length)} 太大，超过 ${fmtSize(MAX_PARSE_BYTES)} 的在线解析上限，请下载后查看`);
    const zip = openZip(bytes, o);
    const presXml = await zip.text('ppt/presentation.xml');
    if (!presXml) throw new Error('这个 .pptx 里没有 ppt/presentation.xml（可能不是 PPT，或文件已损坏）');
    const pres = parseXml(presXml);
    const presRels = await readRels(zip, 'ppt/_rels/presentation.xml.rels');
    const sldSz = first(pres, 'sldSz');
    const cx = Number(attr(sldSz, 'cx')) || 9144000;      // 默认 4:3
    const cy = Number(attr(sldSz, 'cy')) || 6858000;

    const idLst = first(pres, 'sldIdLst');
    let slideNodes = idLst ? children(idLst, 'sldId') : [];
    // 没有 sldIdLst（少见）就按文件名顺序兜底
    let paths = slideNodes.map((sn) => {
      const rel = presRels.get(attr(sn, 'id'));
      return rel ? resolveZipPath('ppt', rel.target) : null;
    }).filter(Boolean);
    if (!paths.length) {
      paths = zip.names().filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort((a, b) => (parseInt(/\d+/.exec(a)[0], 10) || 0) - (parseInt(/\d+/.exec(b)[0], 10) || 0));
    }
    paths = paths.slice(0, PPTX_MAX_SLIDES);

    const cards = [];
    const meta = { slides: 0, images: 0, chars: 0, imagesSkipped: 0 };
    /* ★ 整份 PPT 共用一本账（见 collectImages 里那条注释）——逐页各设一份上限等于没有上限 */
    const imgBudget = { decoded: 0, emitted: 0, skipped: 0, cache: new Map() };
    for (const p of paths) {
      const sxml = await zip.text(p);
      if (!sxml) continue;
      const sdoc = parseXml(sxml);
      const tree = first(sdoc, 'spTree') || sdoc;
      const rels = await readRels(zip, `ppt/slides/_rels/${p.split('/').pop()}.rels`);
      const images = await collectImages(zip, 'ppt/slides', rels, collectRids(tree), { ...o, budget: imgBudget });
      const ctx = { rels, images, cx, cy, meta, slidePath: p };
      cards.push(pptxSlide(tree, ctx, cards.length + 1));
      meta.slides++;
    }
    if (!cards.length) throw new Error('这份 PPT 里没有可读的幻灯片');
    const ar = (cx / cy).toFixed(4);
    meta.imagesSkipped = imgBudget.skipped;
    return {
      html: `<div class="fv-slides" style="--fv-slide-ar:${ar}">${cards.join('')}</div>`
        + imgSkippedNote({ skipped: imgBudget.skipped, bad: imgBudget.bad, missing: imgBudget.missing }),
      meta,
    };
  }

  /** 一页幻灯片 = 一张固定长宽比的卡片 + 若干按百分比定位的文本框/图片。
   *  ▎字号用 cqw（容器查询单位）：卡片宽度是响应式的，用 px 就会"缩放了字不跟着缩"。
   *    换算 = 磅 / 幻灯片宽度(磅) × 100 cqw。 */
  function pptxSlide(tree, ctx, no) {
    const { cx, cy } = ctx;
    const ptWidth = cx / EMU_PER_PT;
    const boxes = [];
    for (const shape of elems(tree)) {
      const t = local(shape.tag);
      if (t === 'sp') boxes.push(pptxTextShape(shape, ctx, ptWidth));
      else if (t === 'pic') boxes.push(pptxPicture(shape, ctx));
      else if (t === 'graphicFrame') boxes.push(pptxFrame(shape, ctx, ptWidth));
      else if (t === 'grpSp') {
        for (const inner of elems(shape)) {
          const it = local(inner.tag);
          if (it === 'sp') boxes.push(pptxTextShape(inner, ctx, ptWidth));
          else if (it === 'pic') boxes.push(pptxPicture(inner, ctx));
          else if (it === 'graphicFrame') boxes.push(pptxFrame(inner, ctx, ptWidth));
        }
      }
    }
    return `<figure class="fv-slide" data-slide="${no}">
      <div class="fv-slide-face">${boxes.filter(Boolean).join('')}</div>
      <figcaption class="fv-slide-no">第 ${no} 页</figcaption>
    </figure>`;
  }

  /** 形状的位置与尺寸：有 xfrm 就用它；没有（占位符常继承母版）就按占位符类型给个近似框。
   *  ▎xfrm 有两个可能的位置：普通形状在 `p:spPr/a:xfrm` 里，
   *    而表格那种 `p:graphicFrame` 是**直接**挂一个 `p:xfrm`——只找前者会漏掉所有幻灯片表格。 */
  function shapeBox(node) {
    const spPr = child(node, 'spPr');
    const xfrm = (spPr && child(spPr, 'xfrm')) || child(node, 'xfrm');
    const off = xfrm ? child(xfrm, 'off') : null;
    const ext = xfrm ? child(xfrm, 'ext') : null;
    if (off && ext) {
      return {
        x: Number(attr(off, 'x')) || 0, y: Number(attr(off, 'y')) || 0,
        w: Number(attr(ext, 'cx')) || 0, h: Number(attr(ext, 'cy')) || 0,
        exact: true,
      };
    }
    const ph = first(first(node, 'nvSpPr') || node, 'ph');
    const type = ph ? (attr(ph, 'type') || 'body') : 'body';
    if (/title|ctrTitle/i.test(type)) return { x: 0.05, y: 0.08, w: 0.9, h: 0.2, exact: false, frac: true };
    if (/subTitle/i.test(type)) return { x: 0.1, y: 0.3, w: 0.8, h: 0.12, exact: false, frac: true };
    if (/sldNum|dt|hdr|ftr/i.test(type)) return null;              // 页码/日期/页脚：不画（噪音）
    return { x: 0.05, y: 0.3, w: 0.9, h: 0.6, exact: false, frac: true };
  }

  function boxStyle(box, ctx) {
    const { cx, cy } = ctx;
    if (!box) return '';
    if (box.frac) return `left:${(box.x * 100).toFixed(2)}%;top:${(box.y * 100).toFixed(2)}%;width:${(box.w * 100).toFixed(2)}%;height:${(box.h * 100).toFixed(2)}%`;
    return `left:${(box.x / cx * 100).toFixed(3)}%;top:${(box.y / cy * 100).toFixed(3)}%;width:${(box.w / cx * 100).toFixed(3)}%;height:${(box.h / cy * 100).toFixed(3)}%`;
  }

  function pptxTextShape(sp, ctx, ptWidth) {
    const box = shapeBox(sp);
    if (!box) return '';
    const tx = child(sp, 'txBody');
    if (!tx) return '';
    const paras = children(tx, 'p');
    let inner = '';
    for (const p of paras) {
      const pPr = child(p, 'pPr');
      const algn = pPr ? attr(pPr, 'algn') : '';
      const align = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : '';
      const lvl = pPr ? Math.min(8, parseInt(attr(pPr, 'lvl'), 10) || 0) : 0;
      const bullet = pPr && !hasChild(pPr, 'buNone') && (hasChild(pPr, 'buChar') || hasChild(pPr, 'buAutoNum'));
      let runs = '';
      let maxSz = 0;
      /* ★ 必须**按文档顺序**走 a:p 的孩子：a:r 是文字、a:br 是换行、a:fld 是域（页码/日期）。
       *   第一版我写成"先把所有 a:r 收出来，再单独数 a:br"——换行会全部堆到段落末尾，
       *   多行文本框看起来就是一整坨（顺序是语义的一部分，不能分开取）。 */
      for (const kid of kidsOf(p)) {
        if (!isEl(kid)) continue;
        const kt = local(kid.tag);
        if (kt === 'br') { runs += '<br>'; continue; }
        if (kt !== 'r' && kt !== 'fld') continue;
        const rPr = child(kid, 'rPr');
        const sz = Number(attr(rPr, 'sz')) || 0;              // 单位：百分之一磅
        if (sz > maxSz) maxSz = sz;
        let txt = esc(textOf(child(kid, 't')));
        if (!txt) continue;
        if (attr(rPr, 'b') === '1') txt = `<strong>${txt}</strong>`;
        if (attr(rPr, 'i') === '1') txt = `<em>${txt}</em>`;
        if (attr(rPr, 'u') && attr(rPr, 'u') !== 'none') txt = `<u>${txt}</u>`;
        if (attr(rPr, 'strike') && attr(rPr, 'strike') !== 'noStrike') txt = `<s>${txt}</s>`;
        const linkId = attr(rPr, 'link');
        const rel = linkId ? ctx.rels.get(linkId) : null;
        const u = rel && rel.external ? safeUrl(rel.target) : '';
        runs += u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${txt}</a>` : txt;
      }
      if (!runs) continue;                                     // 空段落不占版面（幻灯片里的空行是排版噪音）
      const szPt = (maxSz || 1800) / 100;
      const cqw = ((szPt / ptWidth) * 100).toFixed(4);
      const pad = lvl * 1.2;
      const st = [`font-size:${cqw}cqw`];
      if (align) st.push(`text-align:${align}`);
      if (pad) st.push(`padding-left:${pad.toFixed(2)}em`);
      const bulletChar = bullet ? `${lvl % 2 ? '–' : '•'} ` : '';
      ctx.meta.chars += runs.replace(/<[^>]+>/g, '').length;
      inner += `<p class="fv-sp" style="${st.join(';')}">${bulletChar}${runs}</p>`;
    }
    if (!inner.trim()) return '';
    const ph = first(first(sp, 'nvSpPr') || sp, 'ph');
    const type = ph ? (attr(ph, 'type') || '') : '';
    const cls = ['fv-box'];
    if (/title|ctrTitle/i.test(type)) cls.push('fv-box-title');
    return `<div class="${cls.join(' ')}" style="${boxStyle(box, ctx)}">${inner}</div>`;
  }

  function pptxPicture(pic, ctx) {
    const box = shapeBox(pic);
    if (!box) return '';
    const blip = first(pic, 'blip');
    const rid = blip ? (attr(blip, 'embed') || attr(blip, 'link')) : '';
    const src = rid ? ctx.images.get(rid) : null;
    if (src) {
      ctx.meta.images++;
      const name = esc(attr(first(first(pic, 'nvPicPr') || pic, 'cNvPr'), 'descr') || '');
      return `<img class="fv-slideimg" src="${src}" alt="${name}" style="${boxStyle(box, ctx)}" loading="lazy">`;
    }
    return `<div class="fv-box fv-ph-box" style="${boxStyle(box, ctx)}"><span class="fv-ph">〔图片〕</span></div>`;
  }

  /** 幻灯片里的表格（graphicFrame → a:tbl）。 */
  function pptxFrame(gf, ctx, ptWidth) {
    const tbl = first(gf, 'tbl');
    if (!tbl) return '';
    const box = shapeBox(gf) || { x: 0.05, y: 0.2, w: 0.9, h: 0.6, frac: true };
    const rows = children(tbl, 'tr');
    if (!rows.length) return '';
    let h = `<div class="fv-box" style="${boxStyle(box, ctx)}"><table class="fv-tbl fv-slide-tbl"><tbody>`;
    rows.forEach((tr, ri) => {
      h += '<tr>';
      for (const tc of children(tr, 'tc')) {
        const tag = ri === 0 ? 'th' : 'td';
        const tx = child(tc, 'txBody');
        const txt = tx ? children(tx, 'p').map((p) => children(p, 'r').map((r) => esc(textOf(child(r, 't')))).join('')).join('<br>') : '';
        h += `<${tag}>${txt || '&nbsp;'}</${tag}>`;
      }
      h += '</tr>';
    });
    return `${h}</tbody></table></div>`;
  }

  /* ─────────── 10. 旧版二进制 Office（.doc / .xls / .ppt，OLE2 复合文档）───────────
   *
   * ▎为什么从"如实报不能看"改成"抽文字出来"（2026-10-09，J2）：
   *   用户机器上要共享的文件里有一大批是 1997~2003 的 .doc/.xls——上一版的界面会说
   *   "这个文件在线看不了"。那句话**当年是对的**（没有公开的解析规范吗？不，是有规范的，
   *   只是没写），但"没人写"和"做不到"是两回事。这一节写的是：
   *     · OLE2/CFB 复合文档（这些文件的"外壳"，一个扇区链式的内部文件系统）；
   *     · Word 97 的 **piece table**（正文不是一整块连续文本，而是一段一段"pieces"
   *       分布在流里，每段可以是 8 位 ANSI 或 16 位 Unicode，甚至可以是"压缩"偏移）；
   *     · Excel 97 的 **BIFF8 记录流**（SST 共享字符串 + LABELSST/NUMBER/RK/FORMULA…）；
   *     · PowerPoint 97 的 **record 树**（TextChars/TextBytes 原子）。
   *   ▎诚实的边界（写进界面文案，不装作"渲染好了"）：
   *     旧格式**只还原文字**——排版、字体、图片、分页、样式全都没有（那是二进制流里的
   *     另一整套结构，还原它等于重写一个 Word）。所以文案是"抽取到的文字"，
   *     而不是"已按原样渲染"。
   *   ▎判据从哪来：**用真的 Microsoft Office 造夹具、并让 Office 自己报出它认的文字**
   *     （scripts/legacy-oracle.ps1）。二进制格式自己测自己毫无价值——偏移错 4 个字节，
   *     抽出来的照样是"看着像话的乱码"（坑 64 那一类：模型的输出不等于内容）。
   * ═══════════════════════════════════════════════════════════════════════════ */

  const CFB_SIG = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
  const CFB_END = 0xFFFFFFFE;          // ENDOFCHAIN
  const CFB_FREE = 0xFFFFFFFF;         // FREESECT
  const CFB_MAX_STREAM = 64 * 1024 * 1024;    // 单条流解出来最多 64MB（内存有界）

  /** 越界即返回 0 的小端读法。**恶意/损坏文件的第一道闸**：
   *  DataView 越界会抛 RangeError，而调用方多半只写了 try 在最外层——
   *  一个字节错就整份文件读不出来。这里让"读到边界外"变成"读到 0"，
   *  上层再靠结构合法性（链长、扇区号、piece 偏移）判断要不要放弃。 */
  function reader(u8) {
    const b = toU8(u8);
    const dv = b.length ? new DataView(b.buffer, b.byteOffset, b.byteLength) : null;
    const ok = (o, n) => !!dv && o >= 0 && o + n <= b.length;
    return {
      bytes: b,
      len: b.length,
      at: (o, n) => (ok(o, n) ? b.subarray(o, o + n) : new Uint8Array(0)),
      u8: (o) => (ok(o, 1) ? b[o] : 0),
      u16: (o) => (ok(o, 2) ? dv.getUint16(o, true) : 0),
      i16: (o) => (ok(o, 2) ? dv.getInt16(o, true) : 0),
      u32: (o) => (ok(o, 4) ? dv.getUint32(o, true) : 0),
      i32: (o) => (ok(o, 4) ? dv.getInt32(o, true) : -1),
      f64: (o) => (ok(o, 8) ? dv.getFloat64(o, true) : NaN),
    };
  }

  /** OLE2/CFB：返回 { names, stream(名字) } —— 只认顶层流名（Word/Excel/PP 要的都在顶层）。 */
  function readCfb(u8) {
    const r = reader(u8);
    for (let i = 0; i < 8; i++) if (r.bytes[i] !== CFB_SIG[i]) throw new Error('文件头不是 OLE2 复合文档（可能被改名或已损坏）');
    const ss = 1 << r.u16(30);
    const mss = 1 << r.u16(32);
    if (!(ss >= 128 && ss <= 65536) || !(mss >= 16 && mss <= ss)) throw new Error('复合文档的扇区大小不合理');
    const numFat = r.i32(44);
    const dirStart = r.i32(48);
    const miniCutoff = r.u32(56) || 4096;
    const miniFatStart = r.i32(60);
    const numMiniFat = r.i32(64);
    const difatStart = r.i32(68);
    const numDifat = r.i32(72);
    if (numFat <= 0 || numFat > 1e6) throw new Error('复合文档的 FAT 扇区数不合理');

    // ── DIFAT：FAT 扇区清单（头里 109 条，再多就串成一条链）
    const fatSecs = [];
    for (let i = 0; i < 109 && fatSecs.length < numFat; i++) {
      const s = r.i32(76 + i * 4);
      if (s >= 0) fatSecs.push(s);
    }
    let d = difatStart;
    for (let guard = 0; guard < Math.max(0, numDifat) + 4 && d >= 0; guard++) {
      const off = (d + 1) * ss;
      for (let i = 0; i < ss / 4 - 1 && fatSecs.length < numFat; i++) {
        const s = r.i32(off + i * 4);
        if (s >= 0) fatSecs.push(s);
      }
      d = r.i32(off + ss - 4);
    }

    const perFatSec = ss >> 2;
    const fatGet = (idx) => {
      const s = fatSecs[Math.floor(idx / perFatSec)];
      if (s === undefined || s < 0) return CFB_FREE;
      return r.u32((s + 1) * ss + (idx % perFatSec) * 4);
    };
    const secLimit = Math.floor(r.len / ss) + 2;         // 扇区数不可能超过文件本身
    function chainOf(start, get) {
      const out = [];
      let c = start;
      const seen = new Set();
      while (c >= 0 && c !== CFB_END && c !== CFB_FREE && out.length < secLimit) {
        if (seen.has(c)) break;                          // 环：坏文件，就地停下（宁缺勿乱）
        seen.add(c);
        out.push(c);
        c = get(c);
      }
      return out;
    }
    const readChain = (start, size, get, unit) => {
      const list = chainOf(start, get);
      const buf = new Uint8Array(Math.min(size === Infinity ? list.length * unit : size, CFB_MAX_STREAM));
      let p = 0;
      for (const s of list) {
        if (p >= buf.length) break;
        const src = r.at((s + 1) * unit, unit);
        const take = Math.min(src.length, buf.length - p);
        buf.set(src.subarray(0, take), p);
        p += take;
      }
      return buf;
    };

    // ── 目录项（每条 128 字节，名字是 UTF-16）
    const dirBuf = readChain(dirStart, Infinity, fatGet, ss);
    const entries = [];
    const nEnt = Math.floor(dirBuf.length / 128);
    for (let i = 0; i < nEnt; i++) {
      const o = i * 128;
      const dv = new DataView(dirBuf.buffer, dirBuf.byteOffset, dirBuf.byteLength);
      const nameLen = dv.getUint16(o + 64, true);
      const chars = Math.max(0, Math.floor(nameLen / 2) - 1);
      let name = '';
      for (let k = 0; k < chars && k < 64; k++) name += String.fromCharCode(dv.getUint16(o + k * 2, true));
      entries.push({
        name,
        type: dirBuf[o + 66],
        start: dv.getInt32(o + 116, true),
        size: dv.getUint32(o + 120, true) + (dv.getUint32(o + 124, true) || 0) * 0x100000000,
      });
    }
    const root = entries.find((e) => e.type === 5) || null;
    const byName = new Map();
    for (const e of entries) if (!byName.has(e.name.toLowerCase())) byName.set(e.name.toLowerCase(), e);

    // ── 小流（MiniFAT + 根项的 ministream）
    const miniSecs = [];
    let mc = miniFatStart;
    for (let guard = 0; guard <= Math.max(0, numMiniFat) + 4 && mc >= 0; guard++) {
      const src = r.at((mc + 1) * ss, ss);
      for (let i = 0; i + 3 < src.length; i += 4) miniSecs.push(src[i] | (src[i + 1] << 8) | (src[i + 2] << 16) | (src[i + 3] << 24));
      const next = chainOf(mc, fatGet);
      mc = next.length > 1 ? next[1] : -1;              // MiniFAT 自己也是 FAT 里的链，取下一扇区
    }
    const miniGet = (idx) => {
      const s = miniSecs[Math.floor(idx / (ss >> 2))];
      if (s === undefined || s < 0) return CFB_FREE;
      const off = (s + 1) * ss + (idx % (ss >> 2)) * 4;
      return r.u32(off);
    };
    const miniData = root ? readChain(root.start, root.size, fatGet, ss) : new Uint8Array(0);
    function readSmall(entry) {
      const list = [];
      let c = entry.start;
      const seen = new Set();
      while (c >= 0 && c !== CFB_END && c !== CFB_FREE && list.length < 1e6) {
        if (seen.has(c)) break;
        seen.add(c); list.push(c); c = miniGet(c);
      }
      const buf = new Uint8Array(Math.min(entry.size, CFB_MAX_STREAM));
      let p = 0;
      for (const s of list) {
        if (p >= buf.length) break;
        const src = miniData.subarray(Math.min(s * mss, miniData.length), Math.min((s + 1) * mss, miniData.length));
        const take = Math.min(src.length, buf.length - p);
        buf.set(src.subarray(0, take), p);
        p += take;
      }
      return buf;
    }
    function stream(name) {
      const e = byName.get(String(name).toLowerCase());
      if (!e || e.type !== 2) return null;
      if (!e.size) return null;
      return e.size < miniCutoff ? readSmall(e) : readChain(e.start, e.size, fatGet, ss);
    }
    return { stream, names: Array.from(byName.keys()), entryCount: nEnt };
  }

  /* Word/Excel 的 8 位"压缩"文本用的是 Windows 代码页。0x80~0x9F 这一段不是控制字符，
   * 而是排版符号（弯引号/破折号/省略号），直接按 Latin-1 映射会变成方框。 */
  const CP1252_HIGH = {
    0x80: ' ', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
    0x88: 'ˆ', 0x89: '‰', 0x8A: 'Š', 0x8B: '‹', 0x8C: 'Œ', 0x8E: 'Ž', 0x91: '‘',
    0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜',
    0x99: '™', 0x9A: 'š', 0x9B: '›', 0x9C: 'œ', 0x9E: 'ž', 0x9F: 'Ÿ',
  };
  /** 按"压缩 piece"的 8 位编码解一个字符（CP1252 家族；高位未知时原样保留字节值）。 */
  function cp1252Char(bv) {
    if (CP1252_HIGH[bv]) return CP1252_HIGH[bv];
    return String.fromCodePoint(bv);      // 0x00~0x7F 与 0xA0~0xFF 与 Latin-1 同
  }

  /** Word 97-2003 正文（piece table）。返回 { text, meta } 或 null（结构不合法）。 */
  function word97Text(u8) {
    const cfb = readCfb(u8);
    const wdRaw = cfb.stream('WordDocument');
    if (!wdRaw) return null;
    const w = reader(wdRaw);
    /* wIdent 的真值是 0xA5EC（MS-DOC 规定的 Word 文档标记）。
     * 第一版我按"0x01A5"判，于是**每一份 .doc 都在这里被拒**、界面上"没抽出来"——
     * 错的是我记的常数，不是文件。判据不放宽：改成对的值，而不是删掉检查。 */
    if (w.u16(0) !== 0xA5EC) return null;
    const nFib = w.u16(2);
    const flags = w.u16(10);
    const whichTable = (flags & 0x0200) ? '1Table' : '0Table';
    const tblRaw = cfb.stream(whichTable) || cfb.stream('1Table') || cfb.stream('0Table');
    if (!tblRaw) return null;
    const t = reader(tblRaw);
    const ccpText = w.u32(0x4C);
    const fcClx = w.u32(0x1A2);
    const lcbClx = w.u32(0x1A6);

    // Clx = 一串 Prc（0x01 前缀）之后跟一个 Pcdt（0x02 前缀 + PlcPcd）
    let p = fcClx;
    const endAt = fcClx + lcbClx;
    let plc = -1;
    let plcLen = 0;
    while (p < endAt && p + 1 < t.len) {
      const clxt = t.u8(p);
      if (clxt === 1) { p += 3 + t.u16(p + 1); }              // Prc：跳过
      else if (clxt === 2) { plcLen = t.u32(p + 1); plc = p + 5; break; }
      else break;                                             // 不认识的结构：不猜
    }
    const pieces = [];
    if (plc >= 0 && plcLen >= 16 && (plcLen - 4) % 12 === 0) {
      const n = (plcLen - 4) / 12;
      for (let i = 0; i < n; i++) {
        const cpStart = t.u32(plc + i * 4);
        const cpEnd = t.u32(plc + (i + 1) * 4);
        const pcd = plc + (n + 1) * 4 + i * 8;
        const fc = t.u32(pcd + 2);
        const compressed = (fc & 0x40000000) !== 0;
        const off = (fc & 0x3FFFFFFF) >> (compressed ? 1 : 0);
        if (!(cpEnd > cpStart) || cpEnd - cpStart > 4e7) continue;   // 段长不合理就丢这一片
        pieces.push({ cpStart, cpEnd, off, compressed });
      }
    }
    const meta = { streams: cfb.names.length, ccpText, pieces: pieces.length, via: 'piece' };
    let text = '';
    if (pieces.length) {
      // 段的 CP 必须递增才可信；不递增（结构被破坏）就退回启发式抽取
      let prev = -1;
      let ordered = true;
      for (const pc of pieces) { if (pc.cpStart < prev) { ordered = false; break; } prev = pc.cpStart; }
      if (ordered) {
        for (const pc of pieces) {
          const chars = pc.cpEnd - pc.cpStart;
          if (pc.compressed) {
            const run = w.at(pc.off, chars);
            for (let i = 0; i < run.length; i++) text += cp1252Char(run[i]);
          } else {
            const run = w.at(pc.off, chars * 2);
            for (let i = 0; i + 1 < run.length; i += 2) text += String.fromCharCode(run[i] | (run[i + 1] << 8));
          }
        }
      } else meta.via = 'unordered';
    }
    if (!text) {
      // 兜底：在整条流里找"足够长的可打印 UTF-16 串"。这不是规范解法，是**尽力抽取**，
      // 所以 meta.via 会一路带到界面上明说（抽取来源可见，用户才知道该信几分）。
      text = scanUtf16Runs(wdRaw, 8);
      meta.via = 'scan';
    }
    return { text: cleanWordText(text), meta };
  }

  /** Word 文本流里的控制字符 → 人能读的结构。
   *  0x13/0x14/0x15 是**域**的三段：begin / separate / end——
   *  begin~separate 之间是"指令"（PAGE、NUMPAGES），**绝不能当正文显示**（坑 93 那一族：
   *  把"给机器的话"念给人听）。separate~end 之间才是域算出来的结果。 */
  function cleanWordText(s) {
    let out = '';
    let inFieldInstr = false;      // 13..14：指令，丢
    let inFieldResult = false;     // 14..15：结果，留
    let objDepth = 0;              // 01..02：嵌入对象，丢
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 0x13) { inFieldInstr = true; continue; }
      if (c === 0x14) { inFieldInstr = false; inFieldResult = true; continue; }
      if (c === 0x15) { inFieldInstr = false; inFieldResult = false; continue; }
      if (c === 0x01) { objDepth++; continue; }
      if (c === 0x02) { if (objDepth) objDepth--; continue; }
      if (inFieldInstr || objDepth) continue;
      if (c === 0x07) { out += '\n'; continue; }             // 单元格/行结束
      if (c === 0x0B || c === 0x0C || c === 0x1E || c === 0x08 || c === 0x05 || c === 0x06) { out += '\n'; continue; }
      if (c === 0x1F) { out += '-'; continue; }
      if (c === 0x2028 || c === 0x2029) { out += '\n'; continue; }
      if (c === 0x0D) { out += '\n'; continue; }
      if (c === 0x0A) { out += '\n'; continue; }
      if (c < 0x09 || (c >= 0x0E && c <= 0x12) || c === 0x1C || c === 0x1D) continue;   // 其余控制符丢掉
      out += s[i];
    }
    return out.replace(/\n{3,}/g, '\n\n').trim();
  }

  /** 在字节流里扫"足够长的 UTF-16LE 可打印串"（旧格式兜底抽取）。 */
  function scanUtf16Runs(u8, minChars) {
    const b = toU8(u8);
    let out = '';
    let run = '';
    for (let i = 0; i + 1 < b.length; i += 2) {
      const cv = b[i] | (b[i + 1] << 8);
      const printable = (cv >= 0x20 && cv < 0x7F) || cv >= 0xA0 || cv === 0x0D || cv === 0x07 || cv === 0x0B;
      if (printable) { run += String.fromCharCode(cv); } 
      else {
        if (run.length >= (minChars || 8)) out += run.replace(/[\r\x07\x0B]/g, '\n') + '\n';
        run = '';
      }
    }
    if (run.length >= (minChars || 8)) out += run.replace(/[\r\x07\x0B]/g, '\n');
    return out;
  }

  /** BIFF8 的共享字符串表（SST + CONTINUE）。
   *  ▎最难的一点不是"字符串分在多段里"，而是**跨记录边界时那个 grbit 标志字节会重新出现一次**，
   *    而且"这条字符串后半截是 8 位还是 16 位"可能就在边界上翻转。
   *    按"一条记录读完一条字符串"来实现，遇到长表就整片错位——
   *    错位的症状不是报错，是**每格显示别的格的文字**（比空白更难查）。
   *  ▎布局：[cch u16][grbit u8]([cRun u16][cbExtRst u32]) 字符… 然后才是富文本运行与扩展数据。 */
  function parseSstBiff(chunks) {
    const out = [];
    let ci = 0;
    let pos = 0;
    let charsTotal = 0;
    const cur = () => chunks[ci];
    const remaining = () => (cur() ? cur().length - pos : 0);
    function advance() { ci++; pos = 0; return ci < chunks.length; }
    function byte() {
      if (!cur()) return null;
      if (pos >= cur().length && !advance()) return null;
      return cur()[pos++];
    }
    function u16() { const a = byte(); const b = byte(); return (a === null || b === null) ? null : a | (b << 8); }
    function u32() { const a = u16(); const b = u16(); return (a === null || b === null) ? null : ((b << 16) | a) >>> 0; }
    function skip(n) { for (let k = 0; k < n; k++) if (byte() === null) break; }

    u32();                                   // cstTotal：注意是 **4 字节**（含重复计数），不是 2 字节
    const uniq = u32();
    if (uniq === null || !Number.isFinite(uniq)) return out;
    for (let s = 0; s < Math.min(uniq, 200000); s++) {
      const cch = u16();
      if (cch === null) break;
      let grbit = byte();
      if (grbit === null) break;
      const cRun = (grbit & 0x08) ? (u16() || 0) : 0;
      const cbExt = (grbit & 0x04) ? (u32() || 0) : 0;
      let str = '';
      let remain = Math.min(cch, 32767);
      while (remain > 0) {
        const wide = (grbit & 1) !== 0;
        if (remaining() < (wide ? 2 : 1)) {          // 字符串跨记录：下一条记录以**新的 grbit**开头
          if (!advance()) break;
          const ng = byte();
          if (ng === null) break;
          grbit = ng;
          continue;
        }
        if (wide) {
          const lo = byte(); const hi = byte();
          if (lo === null || hi === null) break;
          str += String.fromCharCode((hi << 8) | lo);
        } else {
          const bv = byte();
          if (bv === null) break;
          str += cp1252Char(bv);
        }
        remain--;
        charsTotal++;
        if (charsTotal > 8e6) break;                 // 内存有界：一张 8M 字的表在线读不动，也不该把页面读挂
      }
      skip(cRun * 5 + cbExt);                        // 富文本运行 / 扩展数据在字符**之后**
      out.push(str);
      if (charsTotal > 8e6) break;
    }
    return out;
  }

  /* BIFF8 记录类型（只列这一节用得到的那几个） */
  const BIFF = {
    BOF: 0x0809, DIMENSIONS: 0x0200, SST: 0x00FC, CONTINUE: 0x003C, LABELSST: 0x00FD,
    ROW: 0x0208, NUMBER: 0x0203, LABEL: 0x0204, RK: 0x027E, MULRK: 0x00BD, BOOLERR: 0x0005,
    MULBLANK: 0x00BE, BLANK: 0x0201, FORMULA: 0x0006, STRING: 0x0207, MERGECELLS: 0x00E5,
  };

  /** RK 值 → 数字（Excel 用这个把常用数字压进 4 个字节）。 */
  function rkValue(u32v) {
    const isInt = (u32v & 1) !== 0;
    const div100 = (u32v & 2) !== 0;
    let v;
    if (isInt) v = (u32v >> 2);                       // 30 位带符号整数
    else {
      const buf = new Uint8Array(8);
      buf[4] = u32v & 0xFF; buf[5] = (u32v >> 8) & 0xFF; buf[6] = (u32v >> 16) & 0xFF; buf[7] = (u32v >> 24) & 0xFF;
      v = new DataView(buf.buffer).getFloat64(0, true);   // RK 存的是 double 的高 32 位
    }
    return div100 ? v / 100 : v;
  }

  /** .xls（BIFF8）→ 每页一个网格。 */
  function xls97Grid(u8) {
    const cfb = readCfb(u8);
    const raw = cfb.stream('Workbook') || cfb.stream('Book');
    if (!raw) return null;
    const b = toU8(raw);
    const sheets = [];
    let sstChunks = [];
    let strings = [];
    let stringsDone = false;
    let cur = null;
    let lastFormulaKey = null;
    let sheetOrdinal = -1;
    let i = 0;
    let guard = 0;
    const pushSheet = () => { if (cur) sheets.push(cur); };
    /* SST 的记录可能一直延伸到后面的 CONTINUE 里，所以**不能**在见到 SST 那一刻就解析；
     * 也不能等整条流扫完——LABELSST 在 SST 之后马上就来，那时表还没解出来就全是空格。
     * 折中：第一次真要用的时候再解（惰性），并把"解过没有"记下来（解一次就够）。 */
    const ensureStrings = () => {
      if (!stringsDone && sstChunks.length) { strings = parseSstBiff(sstChunks); stringsDone = true; }
      return strings;
    };
    while (i + 4 <= b.length && guard++ < 200000) {
      const type = b[i] | (b[i + 1] << 8);
      const len = b[i + 2] | (b[i + 3] << 8);
      const body = b.subarray(i + 4, Math.min(i + 4 + len, b.length));
      i += 4 + len;
      const g = reader(body);
      if (type === BIFF.SST) { sstChunks = [body]; continue; }
      if (type === BIFF.CONTINUE && sstChunks.length) { sstChunks.push(body); continue; }
      if (type === BIFF.BOF) {
        const sub = g.u16(2);
        if (sub === 0x0010) { sheetOrdinal++; pushSheet(); cur = { index: sheetOrdinal, cells: new Map(), merges: [], rows: 0, cols: 0 }; }
        continue;
      }
      if (!cur) continue;                                  // 全局区（BOF 之前的样式等）这一节不还原
      const put = (r, c, v) => {
        if (!(r >= 0 && c >= 0) || r > 65535 || c > 255) return;
        cur.cells.set(r * 256 + c, String(v === undefined || v === null ? '' : v));
        cur.rows = Math.max(cur.rows, r + 1);
        cur.cols = Math.max(cur.cols, c + 1);
        return r * 256 + c;
      };
      switch (type) {
        case BIFF.LABELSST: {
          const idx = g.u32(6);
          const ss = ensureStrings();
          put(g.u16(0), g.u16(2), ss[idx] === undefined ? '' : ss[idx]);
          break;
        }
        case BIFF.NUMBER: put(g.u16(0), g.u16(2), numText(g.f64(6))); break;
        case BIFF.RK: put(g.u16(0), g.u16(2), numText(rkValue(g.u32(6)))); break;
        case BIFF.MULRK: {
          const row = g.u16(0);
          const c1 = g.u16(2);
          const c2 = g.u16(body.length - 2);
          for (let c = c1, p = 4; c <= c2 && p + 6 <= body.length - 2; c++, p += 6) put(row, c, numText(rkValue(g.u32(p + 2))));
          break;
        }
        case BIFF.LABEL: {
          const cch = g.u8(6);
          const grbit = g.u8(7);
          let s = '';
          for (let k = 0; k < cch; k++) {
            if (grbit & 1) s += String.fromCharCode(g.u16(8 + k * 2));
            else s += cp1252Char(g.u8(8 + k));
          }
          put(g.u16(0), g.u16(2), s);
          break;
        }
        case BIFF.BOOLERR: {
          const isErr = g.u8(7);
          put(g.u16(0), g.u16(2), isErr ? '#错误' : (g.u8(6) ? 'TRUE' : 'FALSE'));
          break;
        }
        case BIFF.FORMULA: {
          /* 结果那 8 个字节是"变体"：头两条字节决定它是布尔/错误/空串/还是 double。
           * 我们**不重算公式**，只用 Excel 写进去的缓存结果（编一个数就是撒谎，见 I5 那条断言）。 */
          const key = put(g.u16(0), g.u16(2), formulaResult(g));
          lastFormulaKey = key;
          break;
        }
        case BIFF.STRING: {
          const cch = g.u16(0);
          const grbit = g.u8(2);
          let s = '';
          for (let k = 0; k < cch; k++) s += (grbit & 1) ? String.fromCharCode(g.u16(3 + k * 2)) : cp1252Char(g.u8(3 + k));
          if (lastFormulaKey !== null) cur.cells.set(lastFormulaKey, s);   // 这条 STRING 属于上一条公式的结果
          break;
        }
        case BIFF.MERGECELLS: {
          const n = g.u16(0);
          for (let k = 0; k < n; k++) {
            const o = 2 + k * 8;
            cur.merges.push({ r1: g.u16(o), r2: g.u16(o + 2), c1: g.u16(o + 4), c2: g.u16(o + 6) });
          }
          break;
        }
        default: break;
      }
    }
    pushSheet();
    const meta = { sheets: sheets.length, via: 'biff8' };
    return { sheets, strings: ensureStrings(), meta };
  }

  /** BIFF8 FORMULA 记录里的缓存结果（8 字节变体）→ 显示文本。 */
  function formulaResult(g) {
    const t = g.u8(13);
    if (g.u8(12) === 0) {
      if (t === 0xFF) return '';                              // 字符串结果：等紧跟的 STRING 记录
      if (t === 0x01) return g.u8(6) ? 'TRUE' : 'FALSE';
      if (t === 0x02) return '#错误';
      if (t === 0x03) return '';                              // 空串
      return '';
    }
    return numText(g.f64(6));
  }

  /** 数字 → 人看的写法（去掉 0.1+0.2 那种浮点长尾；整数不带小数点）。 */
  function numText(v) {
    if (!Number.isFinite(v)) return '';
    if (Number.isInteger(v)) return String(v);
    return String(Number(v.toPrecision(12)));
  }

  /** PowerPoint 97-2003：record 树里的文字原子。 */
  function ppt97Texts(u8) {
    const cfb = readCfb(u8);
    const raw = cfb.stream('PowerPoint Document') || cfb.stream('Current User');
    if (!raw) return null;
    const b = toU8(raw);
    const out = [];
    (function walk(from, to, depth) {
      let i = from;
      let guard = 0;
      while (i + 8 <= to && guard++ < 20000) {
        const verInst = b[i] | (b[i + 1] << 8);
        const type = b[i + 2] | (b[i + 3] << 8);
        const len = (b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24)) >>> 0;
        const bodyFrom = i + 8;
        const bodyTo = Math.min(bodyFrom + len, to);
        if ((verInst & 0x000F) === 0x0F) walk(bodyFrom, bodyTo, depth + 1);       // 容器
        else if (type === 0x0FA0 || type === 0x0FBA) {                             // TextChars / CString：UTF-16
          let s = '';
          for (let k = bodyFrom; k + 1 < bodyTo; k += 2) s += String.fromCharCode(b[k] | (b[k + 1] << 8));
          if (s.trim()) out.push(s);
        } else if (type === 0x0FA8) {                                              // TextBytes：8 位代码页
          let s = '';
          for (let k = bodyFrom; k < bodyTo; k++) s += cp1252Char(b[k]);
          if (s.trim()) out.push(s);
        }
        if (bodyTo <= i) break;                                                    // 长度读成 0 之类的坏记录：不原地打转
        i = bodyTo;
      }
    })(0, b.length, 0);
    return { texts: out, meta: { via: 'ppt97', atoms: out.length } };
  }

  /* ---- 10.4 扩展名是 .doc/.xls/.ppt，里面却往往是别的东西 ----
   *
   * ▎这是"用户真文件"教的（2026-10-09）：拿本机现成的 .doc 一试，发现有一类根本不是 OLE2——
   *   · 其实是 **RTF**（`{\rtf1\ansi\ansicpg936`…：网上下载的表格类文档十有八九是它，
   *     发布系统把 Word/编辑器生成的 RTF/HTML 存成 .doc 而不改扩展名）；
   *   · 其实是 **HTML**（同一类来源）；
   *   · 其实是 **docx 被改名成 .doc**。
   *   只按扩展名走 OLE2，这三类全部"抽不出文字"，而那句话又是假的（文件没坏）。
   *   ▸ 判据边界（有意保留）：**只有"扩展名声称是旧版 Office"时**才按真实字节改路由；
   *     普通 .txt/.md 仍按扩展名走（I5 那条"扩展名与内容不一致时按扩展名"的决定不变）。
   *     理由：这三个扩展名是**众所周知的容器**（Word 自己也先 sniff 再决定用什么引擎），
   *     而 .txt 里出现 ZIP 头几乎只可能是文件坏了——那时给原始文本更诚实。
   */

  const RTF_SKIP_GROUPS = new Set([
    'fonttbl', 'colortbl', 'stylesheet', 'info', 'header', 'footer', 'headerx', 'footerx',
    'pict', 'object', 'xmlinst', 'nonshppict', 'listtable', 'listoverridetable', 'generator',
    'themedata', 'colorschememapping', 'datastore', 'latentstyles', 'rsidtbl', 'filetbl',
    'bkmkstart', 'bkmkend', 'fldinst', 'shppict', 'mmath', 'upr', 'expandable',
  ]);

  /** 按代码页解一批 'xx 字节（中文 RTF 用 \ansicpg936 = GBK，双字节必须**成对**解）。 */
  function decodeCp(bytesArr, cpName) {
    const u8 = Uint8Array.from(bytesArr);
    const names = [];
    if (cpName) names.push(cpName);
    names.push('windows-1252', 'latin1');
    for (const n of names) {
      try { return new TextDecoder(n, { fatal: false }).decode(u8); } catch (e) { /* 这个解码器没有就试下一个 */ }
    }
    let s = '';
    for (const bv of bytesArr) s += cp1252Char(bv);
    return s;
  }

  /** RTF → 纯文本（丢控制字，保留 \par / \tab / \'xx / \uN）。 */
  function rtfText(u8) {
    const b = toU8(u8);
    let cp = null;
    let ucDrop = 1;
    let out = '';
    const pend = [];                    // 攒着的 \'xx 字节（要成对喂给 GBK 解码器）
    const flush = () => { if (pend.length) { out += decodeCp(pend, cp); pend.length = 0; } };
    const groups = [];                  // 每层记一个布尔：这一组要不要丢
    let skip = false;
    let i = 0;
    let guard = 0;
    const isAlpha = (cv) => (cv >= 0x41 && cv <= 0x5A) || (cv >= 0x61 && cv <= 0x7A);
    while (i < b.length && guard++ < 4e6) {
      const c = b[i];
      if (c === 0x7B) {                 // {
        flush(); groups.push(skip); i++;
        if (b[i] === 0x5C && b[i + 1] === 0x2A) { skip = true; i += 2; }   // {\* …} 注释组
        continue;
      }
      if (c === 0x7D) { flush(); skip = groups.pop() || false; i++; continue; }
      if (c !== 0x5C) {                 // 普通字符
        if (!skip && c !== 0x0D && c !== 0x0A) out += cp1252Char(c);
        i++;
        continue;
      }
      const nx = b[i + 1];
      if (nx === undefined) break;
      if (nx === 0x5C || nx === 0x7B || nx === 0x7D) { if (!skip) out += String.fromCharCode(nx); i += 2; continue; }
      if (nx === 0x7E || nx === 0x5F) { if (!skip) { flush(); out += ' '; } i += 2; continue; }   // \~ \_
      if (nx === 0x2D || nx === 0x2A) { i += 2; continue; }                 // \- 软连字符 / \* 已处理
      if (nx === 0x27) {                                                     // \'xx
        const hi = String.fromCharCode(b[i + 2] || 0x30);
        const lo = String.fromCharCode(b[i + 3] || 0x30);
        const bv = parseInt(hi + lo, 16);
        if (!skip && Number.isFinite(bv)) pend.push(bv);
        i += 4;
        continue;
      }
      if (nx === 0x75 && !isAlpha(b[i + 2] || 0)) {                          // \uN
        let j = i + 2;
        let num = '';
        while (j < b.length && (b[j] === 0x2D || (b[j] >= 0x30 && b[j] <= 0x39)) && num.length < 8) { num += String.fromCharCode(b[j]); j++; }
        if (b[j] === 0x20) j++;
        if (!skip) {
          flush();
          const v = Number(num);
          if (Number.isFinite(v)) out += String.fromCharCode(v < 0 ? v + 65536 : v);
          i = j;
          for (let k = 0; k < ucDrop && i < b.length; k++) i++;              // 回退字形按 \ucN 丢掉
          continue;
        }
        i = j;
        continue;
      }
      // \控制字 + 可选数字参数
      let j = i + 1;
      let word = '';
      while (j < b.length && isAlpha(b[j]) && word.length < 32) { word += String.fromCharCode(b[j]); j++; }
      let param = '';
      if (b[j] === 0x2D || (b[j] >= 0x30 && b[j] <= 0x39)) {
        while (j < b.length && (b[j] === 0x2D || (b[j] >= 0x30 && b[j] <= 0x39)) && param.length < 12) { param += String.fromCharCode(b[j]); j++; }
      }
      if (b[j] === 0x20) j++;
      const pv = param === '' ? null : Number(param);
      if (word === 'ansicpg' && pv) cp = pv === 936 ? 'gbk' : pv === 950 ? 'big5' : pv === 1252 ? 'windows-1252' : pv === 65001 ? 'utf-8' : null;
      else if (word === 'uc' && pv !== null && Number.isFinite(pv)) ucDrop = Math.max(0, Math.min(4, pv));
      else if (word === 'bin' && pv) { flush(); j += pv; }                    // 二进制块按声明长度跳
      else if (RTF_SKIP_GROUPS.has(word)) skip = true;
      else if (!skip && word) {
        if (word === 'par' || word === 'line' || word === 'page' || word === 'sect' || word === 'row') { flush(); out += '\n'; }
        else if (word === 'tab' || word === 'cell' || word === 'nestcell') { flush(); out += '\t'; }
        else if (word === 'intbl' || word === 'nestrow' || word === 'trowd') { /* 表格行标记，不产字 */ }
      }
      i = j > i ? j : i + 1;                                                 // 保证一定有进展（坏输入不许原地打转）
    }
    flush();
    return { text: out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), meta: { via: 'rtf', codepage: cp || 'cp1252' } };
  }

  /** HTML（下载站存的 .doc 常见）→ 文字。只取文本节点，标签与 script/style 一律丢。
   *  ▎安全：输出会整段进 esc() 转义，所以这里"剥标签"只是排版考虑，不是安全防线（防线在 esc）。 */
  function htmlToText(u8) {
    const src = decUtf8(toU8(u8));
    const stripped = src
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/tr|\/h[1-6]|\/li|\/table|\/td)\s*\/?>/gi, '\n')
      .replace(/<\/?[a-zA-Z][^>]*>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#(\d+);/g, (m, d) => (Number(d) ? String.fromCodePoint(Number(d)) : ''))
      .replace(/&amp;/g, '&');
    return { text: stripped.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), meta: { via: 'html' } };
  }

  /** 旧格式的总入口：认得出结构就抽文字，认不出返回 null（调用方退回"请下载"那段话）。 */
  async function legacyExtract(name, bytes) {
    const k = extOf(name);
    const b = toU8(bytes);
    const head = b.subarray(0, Math.min(b.length, 512));
    let headTxt = '';
    for (let i = 0; i < head.length; i++) headTxt += String.fromCharCode(head[i]);
    const real = await ooxmlKindOf(b);          // 它是 async（内部要开 ZIP）——忘了 await 就永远比不相等，reroute 形同虚设
    if (real === 'docx' || real === 'xlsx' || real === 'pptx') return { kind: k, reroute: real };
    if (/^\s*\{\\rtf/i.test(headTxt)) {
      try { const r = rtfText(b); return r.text ? { kind: 'rtf', ...r } : null; } catch (e) { return null; }
    }
    if (/^\s*(<html|<!doctype|<body|<table|<div|<meta\s)/i.test(headTxt)) {
      try { const r = htmlToText(b); return r.text ? { kind: 'html', ...r } : null; } catch (e) { return null; }
    }
    try {
      if (k === 'doc') { const r = word97Text(b); return r && r.text ? { kind: 'doc', ...r } : null; }
      if (k === 'xls') { const r = xls97Grid(b); return r && r.sheets.length ? { kind: 'xls', ...r } : null; }
      if (k === 'ppt') { const r = ppt97Texts(b); return r && r.texts.length ? { kind: 'ppt', ...r } : null; }
    } catch (e) {
      return { kind: k, error: (e && e.message) || '解析失败' };
    }
    return null;
  }

  /** 旧格式的产物 → HTML（顶部一行"这是抽出来的文字，不是原版式"，把边界摆在眼前）。 */
  function legacyExtractedHtml(name, r) {
    const why = (r.kind === 'rtf' || r.kind === 'html')
      // 不是"旧版 Office"，是"扩展名写着 .doc、里面其实是 RTF/网页"——说错来源会让人以为文件坏了
      ? `这份文件的扩展名是旧版 Office，实际内容是 <b>${esc(KIND_CN[r.kind] || r.kind)}</b>。这里显示的是抽出来的文字，原网页/RTF 的排版不还原。`
      : '旧格式是二进制流（OLE2），在线还原<b>文字</b>；版式、字体、图片与分页不还原。要原样看请下载。';
    const head = `<div class="fv-legacy-note"><b>${esc(KIND_CN[r.kind] || '旧版 Office')} · 抽取到的文字</b>`
      + `<span>${why}</span></div>`;
    if (r.error) return `${head}<p class="fv-unsupported-d">${esc(r.error)}</p>`;
    if (r.kind === 'xls') {
      let h = head;
      r.sheets.forEach((s, idx) => {
        const grid = [];
        s.cells.forEach((v, key) => {
          const row = Math.floor(key / 256);
          const col = key % 256;
          (grid[row] = grid[row] || new Array(Math.max(s.cols, col + 1)).fill(''))[col] = v;
        });
        const cov = new Set();
        (s.merges || []).forEach((m) => {
          for (let rr = m.r1; rr <= m.r2; rr++) for (let cc = m.c1; cc <= m.c2; cc++) if (!(rr === m.r1 && cc === m.c1)) cov.add(`${rr}:${cc}`);
        });
        h += `<section class="fv-sheetsec"><h3 class="fv-sheetname">工作表 ${idx + 1}</h3><div class="fv-tblwrap"><table class="fv-tbl fv-sheet"><tbody>`;
        for (let rr = 0; rr < s.rows; rr++) {
          const line = grid[rr] || new Array(s.cols).fill('');
          h += '<tr>';
          for (let cc = 0; cc < Math.min(s.cols, line.length); cc++) {
            if (cov.has(`${rr}:${cc}`)) continue;
            const m = (s.merges || []).find((x) => x.r1 === rr && x.c1 === cc);
            const a = m ? ` colspan="${m.c2 - m.c1 + 1}"${m.r2 > m.r1 ? ` rowspan="${m.r2 - m.r1 + 1}"` : ''} class="fv-merged"` : '';
            h += `<td${a}>${esc(line[cc] || '')}</td>`;
          }
          h += '</tr>';
        }
        h += '</tbody></table></div></section>';
      });
      return h;
    }
    if (r.kind === 'ppt') {
      return head + r.texts.map((s) => `<p class="fv-p">${esc(s).replace(/\n/g, '<br>')}</p>`).join('');
    }
    // doc：一行一段，连续空行压掉（cleanWordText 已经处理过控制字符）
    const paras = String(r.text || '').split('\n').map((s) => s.trim()).filter(Boolean);
    return head + paras.map((s) => `<p class="fv-p">${esc(s)}</p>`).join('');
  }



  const TEXT_MAX_CHARS = 400000;

  function textToHtml(str, opts) {
    const o = opts || {};
    let s = String(str == null ? '' : str);
    let truncated = false;
    if (s.length > TEXT_MAX_CHARS) { s = s.slice(0, TEXT_MAX_CHARS); truncated = true; }
    const html = `<pre class="fv-pre fv-text">${esc(s.replace(/\r\n?/g, '\n'))}</pre>`;
    return {
      html: html + (truncated ? `<p class="fv-note">文本超过 ${TEXT_MAX_CHARS} 个字符，只显示前面一部分（下载可看全部）。</p>` : ''),
      meta: { chars: s.length, lines: s.split('\n').length, truncated },
    };
  }

  /** JSON：能解析就 pretty-print（并按语法上色），解析不了就当纯文本显示——
   *  ▎"显示原文"永远比"报错"有用：用户可能就是要看看这文件里写了啥。 */
  function jsonToHtml(str) {
    const s = String(str == null ? '' : str);
    let obj;
    try { obj = JSON.parse(s); } catch (e) { return textToHtml(s); }
    let pretty;
    try { pretty = JSON.stringify(obj, null, 2); } catch (e) { pretty = s; }
    if (pretty.length > TEXT_MAX_CHARS) pretty = pretty.slice(0, TEXT_MAX_CHARS) + '\n…（已截断）';
    const html = esc(pretty)
      .replace(/^(\s*)(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)/gm, '$1<span class="fv-j-key">$2</span>$3')
      .replace(/: (&quot;(?:[^&]|&(?!quot;))*?&quot;)/g, ': <span class="fv-j-str">$1</span>')
      .replace(/: (-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, ': <span class="fv-j-num">$1</span>')
      .replace(/: (true|false|null)/g, ': <span class="fv-j-bool">$1</span>');
    return { html: `<pre class="fv-pre fv-json">${html}</pre>`, meta: { chars: pretty.length } };
  }

  /* ───────────────────────── 12. 统一入口 ───────────────────────── */

  /** 按类型渲染。返回 { html, meta }；抛错时 message 是**给人看的中文**（直接显示即可）。
   *  ▎字节与文本的分界在这里收口：调用方只管"给我字节 + 告诉我叫什么名字"。 */
  async function render(name, bytes, opts) {
    const o = opts || {};
    const kind = (o.kind) || kindOf(name);
    const b = toU8(bytes);
    const asText = () => decUtf8(b);
    switch (kind) {
      case 'markdown': return { html: `<div class="fv-md">${mdToHtml(asText())}</div>`, meta: { kind } };
      case 'csv': return { html: csvToHtml(asText()), meta: { kind } };
      case 'json': return { html: jsonToHtml(asText()).html, meta: { kind } };
      case 'text':
      case 'code': return { ...textToHtml(asText()), meta: { kind } };
      case 'docx': return await withKind(docxToHtml(b, o), 'docx');
      case 'xlsx': return await withKind(xlsxToHtml(b, o), 'xlsx');
      case 'pptx': return await withKind(pptxToHtml(b, o), 'pptx');
      case 'svg': {
        /* SVG 单独说：它是 XML，里面可以带 <script>，**绝不能**直接 innerHTML。
         * 这里把它当图片渲染（<img> 里的 SVG 不执行脚本），既看得到又安全。 */
        const url = o.blobUrl || '';
        return {
          html: url
            ? `<div class="fv-imgwrap"><img class="fv-img" src="${esc(url)}" alt="${esc(name)}"></div>`
            : '<p class="fv-note">SVG 需要在浏览器里以图片形式打开（出于安全考虑不会把它当 HTML 解析）。</p>',
          meta: { kind: 'svg' },
        };
      }
      case 'image': {
        const url = o.blobUrl || '';
        return {
          html: url ? `<div class="fv-imgwrap"><img class="fv-img" src="${esc(url)}" alt="${esc(name)}"></div>` : '',
          meta: { kind: 'image' },
        };
      }
      case 'legacy': {
        /* 旧版 .doc/.xls/.ppt：先**真的去读**（OLE2 + piece table / BIFF8 / record 树）。
         * 读得出文字就显示抽取到的文字，读不出（加密、非 Office 的复合文档、结构被破坏）
         * 才退回那句"请下载后查看"。
         * ▎顺序很重要：原先是"无条件拒绝"，于是用户机器上那一大批真 .doc 全部"看不了"，
         *   而这句话当时已经不再成立了（坑 82：过期声明比缺失更糟）。 */
        const got = await legacyExtract(name, b);
        if (got && got.reroute) {
          // 扩展名写着 .doc、里面其实是 docx/xlsx/pptx：交给**现代那条路**（同一份内核，不是副本）
          const modern = got.reroute === 'docx' ? docxToHtml : got.reroute === 'xlsx' ? xlsxToHtml : pptxToHtml;
          const r2 = await modern(b, o);
          return await withKind(Promise.resolve(r2), got.reroute);
        }
        if (got && got.error && !(got.text && got.text.length)) {
          // 抽失败：把**为什么**（readCfb/word97 给的原文）带上去，而不是只丢一句"看不了"
          return { html: legacyHtml(name, got.error), meta: { kind: 'legacy', unsupported: true, reason: got.error } };
        }
        if (got) {
          return {
            html: legacyExtractedHtml(name, got),
            meta: { kind: 'legacy', legacy: got.kind, via: (got.meta && got.meta.via) || '', chars: String(got.text || '').length, extracted: true },
          };
        }
        return { html: legacyHtml(name), meta: { kind: 'legacy', unsupported: true } };
      }
      case 'pdf':
        /* PDF 走到这里说明**调用方没有把 blob URL 交给内置阅读器**（正常路径是 client 的
         * renderPdf，它会直接用 `pdfSrc()` 造 iframe）。这条分支不是死代码，是**兜底**：
         * 宁可在这里说清"这一路要浏览器自己画"，也不要掉进 default 那句
         * "1997~2003 版二进制 Office"——对 PDF 说那句话就是胡说（坑 82：界面在无声地撒谎）。 */
        return {
          html: '<p class="fv-note">PDF 由浏览器内置阅读器渲染，本页不解析它的字节。</p>'
            + '<p class="fv-note-d">所以这里的"滚动同步"只能到页码这一级 —— 阅读器内部的滚动位置读不到。</p>',
          meta: { kind: 'pdf', native: true },
        };
      default:
        return { html: legacyHtml(name), meta: { kind, unsupported: true } };
    }
  }
  /* ───────────────────────── 8. PDF：不解析，交给浏览器内置阅读器 ─────────────────────────
   * ▎PDF 是这一堆格式里唯一一个"浏览器自己就会画"的，所以我们**不写解析器**——
   *   写了也追不上内置阅读器的文本选择、搜索、打印、缩放。
   * ▎但这里有个能力边界要说清楚（不是谦虚，是设计约束）：
   *   内置阅读器活在**另一个源**里（OOPIF / 插件），我们读不到它内部的滚动位置。
   *   所以 PDF 这一路的"同步"只能同步**页码**，不能同步"翻到这一页的哪个位置"——
   *   这也是 `#page=` 片段必须由一处发明、三处共用的原因（坑 47）。
   * ▎为什么单独把片段拼法做成导出函数：`src = url#page=N` 这个形状写了三遍
   *   （初次渲染 / setPage / 跟随应用），漏改一处就会出现"翻页了但另一条路还停在旧页"，
   *   而且它不报错。收成一处之后，单测能直接钉住它（`test:fileview` 的 N 组）。 */
  const PDF_MAX_PAGE = 9999;
  function pdfSrc(blobUrl, page) {
    const u = String(blobUrl || '');
    if (!u) return '';
    const n = Math.max(1, Math.min(PDF_MAX_PAGE, parseInt(page, 10) || 1));
    return `${u}#page=${n}&view=FitH`;
  }

  async function withKind(promise, kind) {
    const r = await promise;
    return { html: r.html, meta: Object.assign({ kind }, r.meta || {}) };
  }

  /** "这类文件在线看不了"的说明——必须说清**为什么**，并给出下一步（下载）。
   *  ▎不写这句的话，用户看到空白只会得出"功能坏了"的结论（坑 82：界面要说实话）。 */
  function legacyHtml(name, reason) {
    const k = kindOf(name);
    const why = k === 'legacy'
      ? '这是一份 1997-2003 版的二进制 Office 文档（.doc/.xls/.ppt）。内核**能**从里面抽文字，但这一份没抽出来——'
        + '通常是它加了密码、是别的程序借用这个容器存的（有的安装程序与老编辑器也用同一外壳），或者结构已损坏。'
      : k === 'archive' ? '压缩包需要先解压才能看内容。'
        : k === 'media' ? '音视频文件请在下载后用本地播放器打开（会议里要看/听，用共享屏幕那一路）。'
          : '这种格式没有在线预览的方式。';
    return `<div class="fv-unsupported">
      <p class="fv-unsupported-t">这一份没能抽出文字</p>
      <p class="fv-unsupported-d">${esc(reason ? `这一份的结构没认出来：${reason}。` : why)}</p>
      <p class="fv-unsupported-h">点右下角「下载」拿到原文件，用本机对应的软件打开即可。</p>
    </div>`;
  }

  /* ───────────────────────── 导出 ───────────────────────── */

  const FV = {
    version: '2026-10-09.1',
    MAX_PARSE_BYTES,
    // 类型判定
    extOf, kindOf, canPreview, kindCn, mimeOf, fmtSize, magicKind, ooxmlKindOf,
    PREVIEWABLE, KIND_CN,
    // 安全（这两条是"渲染陌生人字节"的护栏，单测重点照顾它们）
    esc, unesc, safeUrl,
    // 渲染
    mdToHtml, mdInline, parseCsv, detectDelimiter, csvToHtml,
    textToHtml, jsonToHtml, legacyHtml, render,
    // XML / ZIP —— "自己读 Office 文件"的地基，单独可测
    parseXml, decodeEntities, local, isEl, child, children, elems, first, all, textOf, attr, hasChild,
    openZip, readRels, resolveZipPath, base64, defaultInflateRaw, withWatchdog,
    // PDF 那一行的片段拼法（#page=）+ 上限：client 的三处 src 全走它（坑 47）
    pdfSrc, PDF_MAX_PAGE,
    // 三种 Office 文档
    docxToHtml, xlsxToHtml, pptxToHtml,
    // 旧版二进制 Office（OLE2 外壳 + 各自的正文流）
    readCfb, word97Text, xls97Grid, ppt97Texts, legacyExtract, legacyExtractedHtml,
    cp1252Char, rkValue, parseSstBiff, cleanWordText, numText, reader, rtfText, htmlToText, decodeCp,
    // 纯函数小件（日期/列号/列表嵌套——它们最容易算错，也最容易穷举断言）
    isDateFormat, excelSerial, datePartsOf, colIndexOf, renderListItems,
  };
  /* ▎有意**不**导出的：loadSharedStrings / loadStyles / loadNumbering / collectImages /
   *   shapeBox / docxBlocks 这些异步且依赖 zip 句柄的内部件。
   *   导出它们只会让测试去断言"实现细节"而不是"行为"——断言从
   *   `xlsxToHtml(bytes)` 的结果出发就够了（行为断言 > 结构断言，坑 41/56 的同一条纪律）。 */

  root.FV = FV;
  if (typeof module !== 'undefined' && module.exports) module.exports = FV;
})(typeof window !== 'undefined' ? window : globalThis);
