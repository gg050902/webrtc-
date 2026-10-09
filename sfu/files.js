/* =============================================================================
 *  sfu/files.js —— 会议共享文件的**存储层**（第 51 步 · 2026-10-07）
 * =============================================================================
 * ▎它管什么：一场会议的共享文件存在哪、叫什么名字才安全、谁能看到哪些、
 *   多大算超、怎么删、以及"用什么 Content-Type 发出去才不会被浏览器执行"。
 *   信令与 HTTP 路由（sfu/server.js）只负责收发，**判据全在这里**——
 *   与 password.js / nets.js / jsonc.js 同一条纪律：一个概念只有一个实现，
 *   否则服务器一套判据、测试另一套判据，报告说的就和系统做的不是一回事（坑 47）。
 *
 * ▎为什么单独成文件：这一层的失败方式全部是**安全性的**（路径穿越、名字撞车、
 *   把用户上传的 .html 当网页发出去 = 存储型 XSS）。这类判据必须能被穷举断言，
 *   而穷举断言要求它是"纯函数 + 可指到临时目录"，不能混在八千行的 server.js 里。
 *
 * ▎目录结构（这个形状是刻意的，见 sanitizeName 的注释）：
 *     sfu/files/<6位房间号>/
 *       ├── index.json      ← 账本（谁传的、什么时候、多大）
 *       └── blob/           ← 文件字节本体
 *   账本与字节**分目录**：否则用户上传一个叫 index.json 的文件就能把账本覆盖掉。
 *   把冲突变成结构上不可能，比在过滤器里挡一遍可靠（坑 47 的正向用法）。
 *
 * ▎诚实边界（不吹成网盘）：
 *   · 文件是"这场会的共享材料"，**房间销毁时一并删除**（TTL 到期即清）；
 *   · 房间号会回收复用，所以列表按"本场会开始时刻"过滤（同 AI 检索的下界，坑 45/46）；
 *   · 上传者身份是**客户端自报**的（房间令牌是房间级、不绑成员），
 *     所以删除权按"房主 / 平台管理员 / 自报的上传者"判——真产品要把令牌绑到成员；
 *   · 上传是"流式写盘 + 超限即断"，不是整读进内存；但仍是单盘本地存储，没有对象存储/多副本。
 * ============================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

/* ---- 配额（都可被 config.json / 环境变量覆盖，见 resolveLimits） ---- */
const DEFAULTS = {
  maxFileMb: 40,        // 单文件上限
  maxRoomMb: 400,       // 一个房间总量上限
  maxCount: 60,         // 一个房间文件个数上限
};
const NAME_MAX = 120;                 // 文件名最长字符数（不是字节数）
const ROOM_RE = /^\d{6}$/;            // 房间号白名单：6 位数字（与 server.js 同一条判据）

/* 允许**内联**在浏览器里打开的类型（其余一律强制下载）。
 * ▎这条清单是安全边界，不是"能不能预览"的清单——能不能预览由前端 fileview.js 决定。
 *   PDF 走浏览器内置阅读器（插件运行在独立源，碰不到本页面的 cookie/storage）；
 *   光栅图片走 <img>（图片格式里不存在能执行脚本的东西）。
 * ▎**SVG 刻意不在这里**：SVG 是 XML，里面可以带 <script>，同源内联打开就是存储型 XSS。
 *   前端仍然能预览它——用 <img src=blob:> 渲染（img 里的 SVG 不执行脚本），
 *   而"在新标签直接打开"这条路必须是下载。
 * ▎HTML/JS 同理，永远 attachment：用户上传的网页不该在我们的源里跑起来。 */
const INLINE_EXT = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif']);

const MIME_BY_EXT = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif',
  svg: 'image/svg+xml',
  md: 'text/markdown; charset=utf-8', markdown: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8', log: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8', tsv: 'text/tab-separated-values; charset=utf-8',
  json: 'application/json; charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
  zip: 'application/zip',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
  mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska',
};

/* 明确拒绝的扩展名：可执行体。
 * ▎不是"怕它有害"（存着不执行其实无害），而是**怕它被误发**：
 *   同源下发一个 .exe/.bat 让浏览器下载，用户会以为是本系统给的东西；
 *   而且一旦哪天有人把内联清单改宽，这类文件就是最先出事的。
 *   拒收比"收了但小心地发"少一整类风险。 */
const BLOCKED_EXT = new Set([
  'exe', 'bat', 'cmd', 'com', 'scr', 'msi', 'msix', 'app', 'dll', 'sys', 'drv',
  'sh', 'ps1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'jar', 'apk', 'hta', 'cpl', 'reg',
]);

function extOf(name) {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(name || '').trim());
  return m ? m[1].toLowerCase() : '';
}

/** 配额解析：环境变量 > 传入的 config > 默认值。
 *  ▎用 `undefined` 判"有没有传"，不能用 `||`——`Number(env)||默认` 会让"显式配 0"永远失效
 *    （坑 54，本项目已经踩过一次）。0 是合法值（= 关掉上传功能）。 */
function resolveLimits(cfg, env) {
  const c = cfg || {};
  const e = env || process.env;
  const pick = (envVal, cfgVal, def) => {
    const fromEnv = e[envVal];
    if (fromEnv !== undefined && String(fromEnv).trim() !== '') {
      const n = Number(fromEnv);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    const fromCfg = cfgVal === undefined ? c[envVal] : c[cfgVal];
    if (fromCfg !== undefined && fromCfg !== null && fromCfg !== '') {
      const n = Number(fromCfg);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return def;
  };
  return {
    maxFileBytes: Math.round(pick('FILE_MAX_MB', 'fileMaxMb', DEFAULTS.maxFileMb) * 1024 * 1024),
    maxRoomBytes: Math.round(pick('FILE_ROOM_MAX_MB', 'fileRoomMb', DEFAULTS.maxRoomMb) * 1024 * 1024),
    maxCount: Math.round(pick('FILE_MAX_COUNT', 'fileMaxCount', DEFAULTS.maxCount)),
  };
}

/** 房间号合法性（所有拼路径的地方都必须先过这一关——这是路径穿越的第一道闸）。 */
function validRoom(room) {
  return ROOM_RE.test(String(room || ''));
}

/* 目录：FILES_DIR 可用环境变量指到临时目录（测试隔离纪律：绝不碰真实数据）。 */
const FILES_DIR = process.env.FILES_DIR
  ? path.resolve(process.env.FILES_DIR)
  : path.join(__dirname, 'files');

function roomDir(room) {
  if (!validRoom(room)) throw new Error('房间号必须是 6 位数字');
  return path.join(FILES_DIR, String(room));
}
function blobDir(room) { return path.join(roomDir(room), 'blob'); }
function ledgerPath(room) { return path.join(roomDir(room), 'index.json'); }
function blobPath(room, name) { return path.join(blobDir(room), String(name)); }

/* =============================================================================
 * 文件名清洗
 * ============================================================================= */

/** 把用户给的文件名清洗成"能安全当文件名用"的样子。
 *  返回 null = 这名字不能用（调用方要给用户明确报错，不要静默改名）。
 *  ▎四条判据，每条都对应一个真实的坏结果：
 *    ① 去掉任何路径成分（`../../etc/passwd`、`C:\Windows\x`、URL 编码的 %2F）——路径穿越；
 *    ② 去掉控制字符与 Windows 非法字符 `<>:"/\|?*`——写盘会失败或产生看不见的文件；
 *    ③ 拒绝以 `.` 开头的名字——隐藏文件 + 撞账本/系统文件；
 *    ④ 拒绝 BLOCKED_EXT 里的可执行体（理由见上面那段注释）。
 *  ▎长度截断在**扩展名之前**做：直接把 120 个字符砍掉可能把 `.docx` 砍成 `.do`，
 *    于是"一个 Word 文件"在系统眼里变成了未知类型（预览器就认不出来了）。 */
function sanitizeName(raw) {
  let s = String(raw == null ? '' : raw);
  // ① 只取最后一段（同时兜住 / 与 \，以及 URL 编码后的 %2F/%5C）
  try { s = decodeURIComponent(s); } catch (e) { /* 畸形转义：按原样处理，下面还会再清一遍 */ }
  s = s.replace(/\\/g, '/');
  s = s.split('/').pop() || '';
  // ② 控制字符 + Windows 非法字符 + 首尾空白与点
  s = s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[<>:"/\\|?*]/g, '_').trim();
  s = s.replace(/^\.+/, '').replace(/[\s.]+$/, '');
  if (!s) return null;
  // ③ 长度：保扩展名
  if (s.length > NAME_MAX) {
    const ext = extOf(s);
    const stem = ext ? s.slice(0, s.length - ext.length - 1) : s;
    const keep = Math.max(1, NAME_MAX - (ext ? ext.length + 1 : 0));
    s = stem.slice(0, keep) + (ext ? `.${ext}` : '');
  }
  // ④ 可执行体
  if (BLOCKED_EXT.has(extOf(s))) return null;
  if (!extOf(s)) return null;                       // 没扩展名的文件在这个面板里既认不出类型也预览不了
  return s;
}

/** 重名时不覆盖，加 " (2)" / " (3)"。
 *  ▎为什么不覆盖：会议里"改了一版再传一次"很常见，而**覆盖会让正在看旧版的人
 *    看到内容悄悄变了**（他以为自己看的是刚才那份）。留着两份、名字区分开，
 *    是这类协作场景里更安全的默认。要替换就先删再传，那是用户的显式动作。 */
function uniqueName(room, name) {
  const taken = new Set(listFiles(room).map((f) => f.name));
  if (!taken.has(name)) return name;
  const ext = extOf(name);
  const stem = ext ? name.slice(0, name.length - ext.length - 1) : name;
  for (let i = 2; i < 1000; i++) {
    const cand = ext ? `${stem} (${i}).${ext}` : `${stem} (${i})`;
    if (!taken.has(cand)) return cand;
  }
  return `${stem} (${Date.now()})${ext ? `.${ext}` : ''}`;
}

/* =============================================================================
 * 账本（index.json）
 * ============================================================================= */

/** 读账本并与磁盘**对账**：
 *   · 账本里有、磁盘上没了 → 从账本去掉（有人手工删了文件）；
 *   · 磁盘上有、账本里没有 → 补一条（有人手工放进去了 / 上次写到一半崩了）。
 * ▎为什么要对账而不是"信账本"：账本是唯一的数据源，但它是**会漂的**
 *   （进程被杀、手工整理目录、磁盘满写失败）。漂了之后如果照账本发列表，
 *   用户点一个不存在的文件得到 404，而列表上它明明在——这比"少一个文件"更让人困惑。
 * ▎对账只在读的时候做（写路径照常只写账本），所以没有"两个来源互相覆盖"的问题。 */
function listFiles(room, opts) {
  const o = opts || {};
  if (!validRoom(room)) return [];
  const dir = blobDir(room);
  let disk = [];
  try { disk = fs.readdirSync(dir); } catch (e) { disk = []; }
  const diskSet = new Set(disk);

  let entries = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(ledgerPath(room), 'utf8'));
    if (Array.isArray(parsed)) entries = parsed;
  } catch (e) { entries = []; }
  entries = entries.filter((e) => e && typeof e.name === 'string' && diskSet.has(e.name));

  const known = new Set(entries.map((e) => e.name));
  for (const name of disk) {
    if (known.has(name) || name.endsWith('.part')) continue;   // .part = 上传中的临时文件，绝不列出来
    let st = null;
    try { st = fs.statSync(path.join(dir, name)); } catch (e) { continue; }
    if (!st.isFile()) continue;
    entries.push({ name, size: st.size, ts: st.mtimeMs, byId: null, byName: null, orphan: true });
  }

  entries.sort((a, b) => (a.ts || 0) - (b.ts || 0));

  /* ★ 只看"本场会"的文件：房间号会回收复用，不按时间过滤的话，
   *   下一场会打开面板会看到上一场会的材料（这正是 AI 检索踩过的坑 45/46：
   *   能力越强，边界越重要；边界要划在"要防的具体坏结果"上）。
   * ▸ since 由调用方给（= room.createdAt，它已经处理过"重启续会"的回溯）；
   *   给不出 since（比如服务器刚重启、房间对象还没建）时**不过滤**——
   *   宁可多显示自己房间的文件，也不要让用户以为"我传的东西没了"。 */
  if (o.since && Number.isFinite(Number(o.since))) {
    const t = Number(o.since);
    entries = entries.filter((e) => (Number(e.ts) || 0) >= t);
  }
  return entries.map((e) => ({
    name: e.name,
    size: Number(e.size) || 0,
    ts: Number(e.ts) || 0,
    byId: e.byId || null,
    byName: e.byName || null,
    ext: extOf(e.name),
  }));
}

function writeLedger(room, entries) {
  const dir = roomDir(room);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = ledgerPath(room) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 1));
  fs.renameSync(tmp, ledgerPath(room));   // 先写临时再改名：写一半崩了也不会留下半个账本
}

/** 这个房间现在占了多少字节（配额判据；按磁盘算，不按账本算——账本可能漂）。 */
function totalSize(room) {
  let sum = 0;
  try {
    const dir = blobDir(room);
    for (const n of fs.readdirSync(dir)) {
      try { sum += fs.statSync(path.join(dir, n)).size; } catch (e) { /* 单个文件读不到不影响总额判断 */ }
    }
  } catch (e) { /* 目录不存在 = 0 */ }
  return sum;
}

/* =============================================================================
 * 上传（流式写盘 + 超限即断）
 * ============================================================================= */

/** 把请求体流式写进 blob 目录。
 *  ▎为什么流式而不是"整读进内存再写"：40MB × 几个人同时传 = 几百 MB 常驻堆，
 *    而这个服务器还跑着 mediasoup Worker 的心跳与 ASR 管线（长跑项目的内存要算账）。
 *  ▎超限处置：**立刻 destroy 请求**并删掉半成品——不是"收完再判"。
 *    收完再判意味着攻击者可以让你先吃下 40MB（坑：先付费再拒绝 = 白付）。
 *  ▎半成品用 `.part` 后缀 + 完成后 rename：列表里永远不会出现一个只写了一半的文件
 *    （否则"上传中断"会留下一条点了打不开的记录）。 */
function saveUpload(room, rawName, req, limits, uploader) {
  return new Promise((resolve, reject) => {
    if (!validRoom(room)) return reject(Object.assign(new Error('房间号必须是 6 位数字'), { status: 400 }));
    const name = sanitizeName(rawName);
    if (!name) return reject(Object.assign(new Error(`文件名不能用（${String(rawName).slice(0, 60)}）：需要扩展名，且不能是可执行文件或含路径/非法字符`), { status: 400 }));

    const L = limits || resolveLimits();
    if (L.maxFileBytes <= 0) return reject(Object.assign(new Error('本服务器已关闭文件上传'), { status: 403 }));

    // Content-Length 能提前判就提前判（省掉一次"传了一半才说不行"）
    const declared = Number(req && req.headers && req.headers['content-length']);
    if (Number.isFinite(declared) && declared > L.maxFileBytes) {
      return reject(Object.assign(new Error(`文件 ${fmtMb(declared)} 超过单文件上限 ${fmtMb(L.maxFileBytes)}`), { status: 413 }));
    }

    let entries;
    try { entries = listFiles(room); } catch (e) { entries = []; }
    if (entries.length >= L.maxCount) {
      return reject(Object.assign(new Error(`这个房间的文件数已到上限（${L.maxCount} 个），先删几个再传`), { status: 409 }));
    }
    const used = totalSize(room);
    if (used >= L.maxRoomBytes) {
      return reject(Object.assign(new Error(`这个房间的共享空间已满（${fmtMb(used)} / ${fmtMb(L.maxRoomBytes)}），先删几个再传`), { status: 409 }));
    }
    const roomLeft = Math.max(0, L.maxRoomBytes - used);
    const cap = Math.min(L.maxFileBytes, roomLeft);

    const finalName = uniqueName(room, name);
    const dir = blobDir(room);
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* 下面 createWriteStream 会报出来 */ }
    const partPath = path.join(dir, `${finalName}.part`);
    const finalPath = path.join(dir, finalName);

    let out;
    try { out = fs.createWriteStream(partPath); } catch (e) { return reject(Object.assign(new Error(`写盘失败：${e.message}`), { status: 500 })); }

    let size = 0;
    let done = false;
    let ended = false;      // 请求体收完了没有（'close' 会在 'end' 之后也来一次，靠它区分"正常收尾"与"半路断线"）
    /* 删半成品。★ Windows 上这件事不能紧跟着 destroy() 做：文件句柄还没释放时
     *   unlinkSync 会 EBUSY/EPERM，而"删不掉就算了"的后果是**每失败一次上传就漏一个 .part**
     *   （长跑一周就是几个 GB 的隐形垃圾，而且列表里看不见它——最难发现的那种泄漏）。
     *   所以：等 'close'（句柄真的放了）再删，再补一次延迟重试，最后由启动清扫兜底。 */
    const cleanup = () => {
      const once = () => { try { fs.unlinkSync(partPath); return true; } catch (e) { return false; } };
      if (once()) return;
      setTimeout(() => { if (!once()) setTimeout(() => { try { fs.unlinkSync(partPath); } catch (e) { /* 交给 sweepStaleParts */ } }, 500); }, 60);
    };
    const fail = (err) => {
      if (done) return;
      done = true;
      reject(err);                                    // 先回话：调用方（HTTP 响应）不该等清理
      try { out.destroy(); } catch (e) { /* ignore */ }
      out.once('close', cleanup);
      setTimeout(cleanup, 80);                        // 'close' 万一不来（流已被销毁过）也有一条路
    };

    out.on('error', (e) => fail(Object.assign(new Error(`写盘失败：${e.message}`), { status: 500 })));
    out.on('finish', () => {
      if (done) return;
      done = true;
      try {
        fs.renameSync(partPath, finalPath);
      } catch (e) {
        cleanup();
        return reject(Object.assign(new Error(`保存失败：${e.message}`), { status: 500 }));
      }
      const entry = {
        name: finalName,
        size,
        ts: Date.now(),
        byId: (uploader && uploader.id) || null,
        byName: (uploader && uploader.name) || null,
      };
      try {
        // 账本重读一遍再追加：并发两个上传时，各自手里的旧账本会把对方那条冲掉
        const cur = (() => {
          try { const p = JSON.parse(fs.readFileSync(ledgerPath(room), 'utf8')); return Array.isArray(p) ? p : []; }
          catch (e) { return []; }
        })();
        writeLedger(room, cur.filter((e) => e && e.name !== finalName).concat([entry]));
      } catch (e) {
        // 账本写失败不算上传失败：文件已经在盘上，listFiles 的对账会把它补回来
      }
      resolve(entry);
    });

    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > cap) {
        const why = cap < L.maxFileBytes
          ? `这个房间的共享空间不够了（还需 ${fmtMb(size - cap)}）`
          : `文件超过单文件上限 ${fmtMb(L.maxFileBytes)}`;
        try { req.destroy(); } catch (e) { /* ignore */ }
        return fail(Object.assign(new Error(why), { status: 413 }));
      }
      // 背压：盘写不过来时暂停收流，别让数据堆在内存里
      if (!out.write(chunk)) req.pause();
    });
    out.on('drain', () => { try { req.resume(); } catch (e) { /* 请求已经结束 */ } });
    req.on('end', () => { ended = true; if (!done) out.end(); });
    req.on('error', (e) => fail(Object.assign(new Error(`上传中断：${e.message}`), { status: 400 })));
    req.on('aborted', () => fail(Object.assign(new Error('上传被中断'), { status: 400 })));
    /* ★ 'close' 在**正常收尾之后也会来一次**（Node 的请求生命周期就是这样），
     *   所以判据必须是"没收完就关了"，不能是"关了就当失败"——
     *   第一版我在这里无条件 fail，结果每个上传成功的文件都被自己的收尾回调删掉了
     *   （rename 已经发生，unlink 的是 .part，所以看起来"成功但列表里没有"）。 */
    req.on('close', () => {
      if (!done && !ended) fail(Object.assign(new Error('上传被中断（连接已关闭）'), { status: 400 }));
    });
  });
}

function fmtMb(bytes) {
  const mb = Number(bytes) / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(mb < 10 ? 1 : 0)} MB` : `${Math.max(1, Math.round(Number(bytes) / 1024))} KB`;
}

/** 删一个文件（账本 + 磁盘一起）。返回 true = 真的删掉了。 */
function removeFile(room, name) {
  if (!validRoom(room)) return false;
  const safe = sanitizeName(name);
  if (!safe) return false;
  const fp = blobPath(room, safe);
  let removed = false;
  try { fs.unlinkSync(fp); removed = true; } catch (e) { removed = false; }
  try {
    const entries = (() => {
      const p = JSON.parse(fs.readFileSync(ledgerPath(room), 'utf8'));
      return Array.isArray(p) ? p : [];
    })();
    const next = entries.filter((e) => e && e.name !== safe);
    if (next.length !== entries.length) writeLedger(room, next);
  } catch (e) { /* 账本读不出来就算了：磁盘上已经删掉，对账会同步 */ }
  return removed;
}

/** 房间销毁时清掉它的全部共享文件（返回删了几个）。
 *  ▎为什么删：这些是"这场会的材料"，不是网盘。留着的话，
 *    ① 房间号回收复用会让下一场会看到上一场会的文件（隐私）；
 *    ② 教学服务器磁盘有限，没人会去清（长跑一周就是几十 GB）。 */
function removeRoom(room) {
  if (!validRoom(room)) return 0;
  let n = 0;
  try { n = listFiles(room).length; } catch (e) { n = 0; }
  try { fs.rmSync(roomDir(room), { recursive: true, force: true }); } catch (e) { /* 删不掉不阻塞房间销毁 */ }
  return n;
}

/* =============================================================================
 * 下发策略（这一份是**安全判据**，不是"好不好看"）
 * ============================================================================= */

/** 决定一个文件用什么 Content-Type / 要不要内联打开。
 *  返回 { mime, inline, disposition }。
 *  ▎默认永远是 **attachment + octet-stream**：白名单放行内联，其余一律下载。
 *    新出现的扩展名自动落在"下载"那一侧，不需要有人记得来加一条规则。
 *  ▎下载时**故意不给真实 MIME**（.docx 不说自己是 wordprocessingml，.svg 不说自己是
 *    image/svg+xml）：浏览器反正要存盘，给真实类型没有好处；而万一日后有人把
 *    disposition 从 attachment 改成 inline，那个"真实 MIME"就会立刻变成一个
 *    同源存储型 XSS。**默认值要选"就算被改坏也不致命"的那一个。** */
function servePolicy(name) {
  const ext = extOf(name);
  const inline = INLINE_EXT.has(ext);
  const mime = inline ? (MIME_BY_EXT[ext] || 'application/octet-stream') : 'application/octet-stream';
  const safe = String(name).replace(/["\\\r\n]/g, '_');
  /* 中文名要同时给两份：filename= 里只能放 ASCII（各浏览器对非 ASCII 的猜法不一致），
   * filename*=UTF-8'' 才是标准做法（RFC 5987）。只给前者的话中文名下载下来是乱码。 */
  const disposition = `${inline ? 'inline' : 'attachment'}; filename="${safe.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
  return { mime, inline, disposition };
}

/** 预览用的 URL（前端 fetch 时带 X-Room-Token；这个函数只管形状，不发请求）。 */
function fileUrl(room, name) {
  return `/files/${encodeURIComponent(String(room))}/${encodeURIComponent(String(name))}`;
}

/** URL 里的两段是否合法（HTTP 路由用它做第二道闸；第一道是门禁）。 */
function validPathParts(room, name) {
  return validRoom(room) && !!sanitizeName(name) && String(name).indexOf('/') < 0 && String(name).indexOf('\\') < 0;
}

/** 清掉"上一辈子留下的"上传半成品（进程被杀、断电、磁盘满都会留下 .part）。
 *  ▎为什么需要它：saveUpload 的清理是尽力而为的（Windows 上句柄没放就删不掉），
 *    而崩溃时根本没机会跑清理。没有这道启动清扫，.part 会在 blob 目录里越积越多——
 *    列表里看不见它（有意过滤），于是没人会发现盘在被吃掉（沉默泄漏）。
 *  ▸ 只删"超过 maxAgeMs 的"：正在上传的那一个不能碰。
 *  @returns 删掉几个 */
function sweepStaleParts(maxAgeMs) {
  const age = Number(maxAgeMs) || 60 * 60 * 1000;
  let n = 0;
  let rooms = [];
  try { rooms = fs.readdirSync(FILES_DIR); } catch (e) { return 0; }
  for (const room of rooms) {
    if (!validRoom(room)) continue;
    let names = [];
    try { names = fs.readdirSync(blobDir(room)); } catch (e) { continue; }
    for (const name of names) {
      if (!name.endsWith('.part')) continue;
      const fp = path.join(blobDir(room), name);
      try {
        const st = fs.statSync(fp);
        if (Date.now() - st.mtimeMs < age) continue;      // 还新鲜 = 可能正在传，别碰
        fs.unlinkSync(fp);
        n++;
      } catch (e) { /* 单个删不掉不影响其余 */ }
    }
  }
  return n;
}

module.exports = {
  FILES_DIR, DEFAULTS, NAME_MAX, INLINE_EXT, BLOCKED_EXT,
  extOf, validRoom, resolveLimits, sanitizeName, uniqueName,
  roomDir, blobDir, ledgerPath, blobPath,
  listFiles, writeLedger, totalSize, saveUpload, removeFile, removeRoom, sweepStaleParts,
  servePolicy, fileUrl, validPathParts, fmtMb,
};
