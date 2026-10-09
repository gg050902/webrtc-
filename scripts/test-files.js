/* ════════════════════════════════════════════════════════════════
 * scripts/test-files.js —— 共享文件**存储层**（sfu/files.js）的回归
 *
 * ▎为什么这一层要单独测：它的判据全是**安全性的**（路径穿越 / 名字撞车 /
 *   把用户上传的 .html 当网页发出去 = 存储型 XSS / 配额绕过）。
 *   这类判据错了不会让任何功能变红——它只会让服务器多一个洞，
 *   而"多一个洞"在功能测试里表现为一切正常（同坑 57/65：假绿比假红危险）。
 *
 * ▎隔离纪律（AGENTS 第 09-24 条）：FILES_DIR 指到临时目录，**绝不碰 sfu/files/**。
 *   最后有一条断言自证"真实目录没被动过"。
 *
 * ▎跑法：npm run test:files     （零依赖，不起服务器）
 * ════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

/* ★ 环境变量必须在 require 之前设：FILES_DIR 是模块加载时读一次的（const）。
 *   这也是"测试自占目录"的一部分——不靠"记得改回来"，靠进程隔离。 */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sfu-files-test-'));
process.env.FILES_DIR = TMP;
const REAL_DIR = path.join(__dirname, '..', 'sfu', 'files');
const realBefore = snapshotDir(REAL_DIR);

const Files = require('../sfu/files.js');

let pass = 0, fail = 0;
const fails = [];
/* 参数顺序是 ok(名字, 条件)——本仓库另有两个测试文件用的是相反顺序（坑 110），
 * 写反的后果是"全部 PASS true 而一条都没测"，所以这里做类型自检。 */
function ok(name, cond, extra) {
  if (typeof name !== 'string') throw new TypeError('ok() 第一个参数必须是名字——参数顺序写反了？（坑 110）');
  if (typeof cond !== 'boolean') throw new TypeError(`ok("${name}") 第二个参数必须是布尔，收到 ${typeof cond}`);
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; fails.push(name + (extra ? ` — ${extra}` : '')); console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

function snapshotDir(dir) {
  try { return fs.readdirSync(dir).sort().join('|'); } catch (e) { return '(不存在)'; }
}

/** 造一个"像 HTTP 请求"的可读流（saveUpload 只用到 data/end/error/close + headers + pause/resume/destroy）。 */
function fakeReq(bytes, headers) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const r = Readable.from([buf]);
  r.headers = Object.assign({ 'content-length': String(buf.length) }, headers || {});
  return r;
}
/** 造一个"声明的大小是假的、实际灌进来更多"的请求——用来验超限即断。 */
function fakeOverflowReq(bytes, declared) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const r = Readable.from([buf]);
  r.headers = { 'content-length': String(declared) };
  return r;
}
const ROOM = '123456';
const L = { maxFileBytes: 1024, maxRoomBytes: 2048, maxCount: 3 };

/** 轮询到条件成立为止（上限默认 2s）。
 *  ▎为什么不用固定 sleep：清理半成品在 Windows 上要等文件句柄释放，
 *    那个时刻不是常数——固定睡眠要么白等要么假红（坑 96/104：量具不许跟自己的异步赛跑）。 */
async function until(condFn, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    if (condFn()) return true;
    if (Date.now() - t0 > (timeoutMs || 2000)) return false;
    await new Promise((r) => setTimeout(r, 40));
  }
}
const partsOf = (room) => {
  try { return fs.readdirSync(Files.blobDir(room)).filter((n) => n.endsWith('.part')).length; }
  catch (e) { return 0; }
};

async function upload(name, bytes, limits, uploader) {
  return Files.saveUpload(ROOM, name, fakeReq(bytes, { 'x-file-name': encodeURIComponent(name) }), limits || L, uploader || { id: 'sock1', name: '小张' });
}

(async function main() {
  console.log(`\n临时目录：${TMP}`);

  console.log('\n═══ A. 文件名清洗（路径穿越的第一道闸） ═══');
  ok('正常中文名原样保留', Files.sanitizeName('季度评审会材料.docx') === '季度评审会材料.docx');
  ok('相对路径穿越被剥掉，只剩最后一段', Files.sanitizeName('../../etc/passwd.txt') === 'passwd.txt');
  ok('绝对路径被剥掉', Files.sanitizeName('/etc/shadow.log') === 'shadow.log');
  ok('Windows 反斜杠路径被剥掉', Files.sanitizeName('C:\\Users\\x\\a.pdf') === 'a.pdf');
  ok('URL 编码的 %2F 解码后仍被剥掉', Files.sanitizeName('..%2F..%2Fsecret.pdf') === 'secret.pdf');
  ok('控制字符被清掉', Files.sanitizeName('a\u0000b\u001b.pdf') === 'ab.pdf');
  ok('Windows 非法字符换成下划线', Files.sanitizeName('a<b>c:d|e?.pdf') === 'a_b_c_d_e_.pdf');
  ok('以点开头的名字被拒（隐藏文件 / 撞账本）', Files.sanitizeName('.bashrc') === null && Files.sanitizeName('..') === null);
  ok('没有扩展名被拒（这个面板认不出类型也预览不了）', Files.sanitizeName('README') === null);
  ok('可执行体被拒（exe/bat/sh/js/msi）',
    ['a.exe', 'a.bat', 'a.sh', 'a.js', 'a.msi', 'a.scr', 'a.ps1', 'a.vbs'].every((n) => Files.sanitizeName(n) === null));
  ok('★ index.json 这个名字**不能**被用来覆盖账本', (() => {
    // 账本在 roomDir/index.json，字节在 roomDir/blob/——分目录就是为了让这件事结构上不可能
    const n = Files.sanitizeName('index.json');
    return n === 'index.json' && path.join(Files.blobDir(ROOM), n) !== Files.ledgerPath(ROOM);
  })());
  ok('超长名字截断但**保住扩展名**（砍掉扩展名 = 认不出类型）', (() => {
    const n = Files.sanitizeName('x'.repeat(300) + '.docx');
    return n.length <= Files.NAME_MAX && n.endsWith('.docx');
  })());
  ok('首尾空白清掉', Files.sanitizeName('  报告 v1.pdf  ') === '报告 v1.pdf');
  ok('结尾的点清掉（Windows 上"报告.pdf."会写出一个看不见的名字）', Files.sanitizeName('报告.pdf.') === '报告.pdf');
  ok('中间的空格原样保留（"报告 v1.pdf"是合法名字，不许替用户改名）', Files.sanitizeName('报告 v1.pdf') === '报告 v1.pdf');
  ok('空 / null / undefined 都返回 null', Files.sanitizeName('') === null && Files.sanitizeName(null) === null && Files.sanitizeName(undefined) === null);
  ok('房间号白名单：只有 6 位数字', Files.validRoom('123456') === true && Files.validRoom('12345') === false
    && Files.validRoom('1234567') === false && Files.validRoom('abcdef') === false && Files.validRoom('../12') === false);
  ok('validPathParts 拒掉带斜杠的名字', Files.validPathParts(ROOM, 'a.pdf') === true && Files.validPathParts(ROOM, 'a/b.pdf') === false);

  console.log('\n═══ B. 上传与账本 ═══');
  const e1 = await upload('第一份.md', Buffer.from('# 标题\n正文', 'utf8'));
  ok('上传返回条目（名字/大小/上传者）', e1.name === '第一份.md' && e1.size === Buffer.byteLength('# 标题\n正文') && e1.byName === '小张' && e1.byId === 'sock1');
  ok('字节真的落盘了', fs.readFileSync(Files.blobPath(ROOM, '第一份.md'), 'utf8') === '# 标题\n正文');
  ok('账本里有这一条', Files.listFiles(ROOM).some((f) => f.name === '第一份.md'));
  ok('没有留下 .part 半成品', fs.readdirSync(Files.blobDir(ROOM)).filter((n) => n.endsWith('.part')).length === 0);

  const e2 = await upload('第一份.md', Buffer.from('第二版', 'utf8'));
  ok('★ 重名不覆盖，自动加 (2)', e2.name === '第一份 (2).md', e2.name);
  ok('两个版本都在（"改一版再传"不会悄悄换掉别人正在看的那份）',
    fs.readFileSync(Files.blobPath(ROOM, '第一份.md'), 'utf8') === '# 标题\n正文'
    && fs.readFileSync(Files.blobPath(ROOM, '第一份 (2).md'), 'utf8') === '第二版');

  const e3 = await upload('第三份.txt', Buffer.from('x'.repeat(100), 'utf8'));
  ok('第三个文件也进去了', e3.name === '第三份.txt');
  ok('个数到上限（maxCount=3）后拒绝', await (async () => {
    try { await upload('第四份.txt', Buffer.from('y')); return false; }
    catch (err) { return err.status === 409 && /已到上限/.test(err.message); }
  })());
  ok('totalSize 是盘上真实占用', Files.totalSize(ROOM) === Buffer.byteLength('# 标题\n正文') + Buffer.byteLength('第二版') + 100);

  console.log('\n═══ C. 配额（先判后收，不是收完再拒） ═══');
  ok('超单文件上限 → 413，且**不留半成品**', await (async () => {
    try { await upload('big.bin', Buffer.alloc(4096, 7)); return false; }
    catch (err) {
      return err.status === 413 && !fs.existsSync(Files.blobPath(ROOM, 'big.bin'))
        && await until(() => partsOf(ROOM) === 0);
    }
  })());
  ok('Content-Length 就能提前判掉（不必等字节灌进来）', await (async () => {
    try { await Files.saveUpload(ROOM, 'declared.bin', fakeReq(Buffer.alloc(10), { 'content-length': '99999' }), L, {}); return false; }
    catch (err) { return err.status === 413; }
  })());
  ok('★ 声明小、实际灌大 → 收到一半就断（不是收完再拒）', await (async () => {
    /* 单独放宽 maxCount：房间里已经有 3 个文件了，不放宽的话**个数**那条判据会先命中，
     * 这条断言就变成"在测个数上限"——绿是绿了，但它没测到我想测的东西（坑 55 同族：
     * 先确认自己站在哪个状态上）。一条断言只动一个变量。 */
    const only = { maxFileBytes: 1024, maxRoomBytes: 1 << 20, maxCount: 50 };
    try { await Files.saveUpload(ROOM, 'lie.bin', fakeOverflowReq(Buffer.alloc(4096, 1), 100), only, {}); return false; }
    catch (err) {
      return err.status === 413 && /超过单文件上限/.test(err.message)
        && !fs.existsSync(Files.blobPath(ROOM, 'lie.bin'))
        && await until(() => partsOf(ROOM) === 0);
    }
  })());
  /* ★ 半成品清理是**异步**的（Windows 上要等句柄释放），所以"失败即漏一个 .part"这件事
   *   在真实运行里发生过：清理紧跟着 destroy() 做，unlink 撞上 EBUSY 被 catch 吞掉，
   *   而 .part 在列表里是有意过滤掉的——于是没人看得见盘在被吃掉。
   *   现在有两道：清理等 'close' + 延迟重试；崩溃留下的由启动清扫兜底（下面这条测它）。 */
  ok('★ 启动清扫能收走崩溃留下的 .part，但**不碰新鲜的**（那可能正在传）', (() => {
    const dir = Files.blobDir(ROOM);
    fs.mkdirSync(dir, { recursive: true });
    const stale = path.join(dir, '崩掉的那次.md.part');
    const fresh = path.join(dir, '正在传的那份.md.part');
    fs.writeFileSync(stale, 'x');
    fs.writeFileSync(fresh, 'y');
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(stale, old, old);                       // 把 mtime 改成两小时前
    const n = Files.sweepStaleParts(60 * 60 * 1000);
    const swept = n >= 1 && !fs.existsSync(stale) && fs.existsSync(fresh);
    try { fs.unlinkSync(fresh); } catch (e) { /* ignore */ }
    return swept;
  })());
  ok('房间总量配额也拦得住（maxRoomBytes=2048，已用约 130）', await (async () => {
    // 先删到只剩一个，腾出空间验"总量"这条独立判据
    const tight = { maxFileBytes: 4096, maxRoomBytes: Files.totalSize(ROOM) + 10, maxCount: 50 };
    try { await Files.saveUpload(ROOM, 'over.md', fakeReq(Buffer.alloc(64, 2)), tight, {}); return false; }
    catch (err) { return err.status === 413 && /空间不够/.test(err.message); }
  })());
  ok('可执行体在上传这一层也被拒（不只是清洗函数）', await (async () => {
    try { await upload('evil.exe', Buffer.from('MZ')); return false; }
    catch (err) { return err.status === 400 && /文件名不能用/.test(err.message); }
  })());
  ok('显式配 0 = 关掉上传（不是"0 被 || 吃掉变默认值"，坑 54）', await (async () => {
    try { await Files.saveUpload(ROOM, 'x.md', fakeReq(Buffer.from('a')), { maxFileBytes: 0, maxRoomBytes: 0, maxCount: 0 }, {}); return false; }
    catch (err) { return err.status === 403 && /已关闭/.test(err.message); }
  })());
  ok('resolveLimits：环境变量优先、0 合法、脏值回落默认', (() => {
    const a = Files.resolveLimits({}, { FILE_MAX_MB: '7' });
    const b = Files.resolveLimits({}, { FILE_MAX_MB: '0' });
    const c = Files.resolveLimits({}, { FILE_MAX_MB: 'abc' });
    const d = Files.resolveLimits({ fileMaxMb: 9 }, {});
    return a.maxFileBytes === 7 * 1024 * 1024 && b.maxFileBytes === 0
      && c.maxFileBytes === Files.DEFAULTS.maxFileMb * 1024 * 1024
      && d.maxFileBytes === 9 * 1024 * 1024;
  })());

  console.log('\n═══ D. 账本与磁盘对账 ═══');
  ok('手工删掉盘上的文件 → 列表里也消失（不发一个点了 404 的条目）', (() => {
    fs.unlinkSync(Files.blobPath(ROOM, '第三份.txt'));
    return !Files.listFiles(ROOM).some((f) => f.name === '第三份.txt');
  })());
  ok('手工往 blob 目录丢一个文件 → 列表补一条（不假装知道谁传的）', (() => {
    const body = 'a,b\n1,2';
    fs.writeFileSync(path.join(Files.blobDir(ROOM), '手工放的.csv'), body);
    const f = Files.listFiles(ROOM).find((x) => x.name === '手工放的.csv');
    return !!f && f.size === Buffer.byteLength(body) && f.byName === null && f.byId === null;
  })());
  ok('账本 JSON 被写坏 → 不抛错，靠磁盘重建列表', (() => {
    fs.writeFileSync(Files.ledgerPath(ROOM), '{ 这不是 JSON');
    const list = Files.listFiles(ROOM);
    return list.length >= 3 && list.some((f) => f.name === '第一份.md');
  })());
  ok('★ since 过滤：上一场会的文件这一场看不到（房间号会回收复用）', (() => {
    const all = Files.listFiles(ROOM);
    const future = Files.listFiles(ROOM, { since: Date.now() + 60000 });
    return all.length > 0 && future.length === 0;
  })());
  ok('since=0 或缺省 = 不过滤（服务器刚重启、房间对象还没建时宁可多显示）',
    Files.listFiles(ROOM).length === Files.listFiles(ROOM, { since: 0 }).length);

  console.log('\n═══ E. 删除与清理 ═══');
  ok('removeFile 同时删掉字节与账本条目', (() => {
    const r = Files.removeFile(ROOM, '第一份 (2).md');
    return r === true && !fs.existsSync(Files.blobPath(ROOM, '第一份 (2).md'))
      && !Files.listFiles(ROOM).some((f) => f.name === '第一份 (2).md');
  })());
  ok('删不存在的文件返回 false（不抛）', Files.removeFile(ROOM, '从来没有过.pdf') === false);
  ok('删除也走名字清洗（../../ 打不穿）', Files.removeFile(ROOM, '../../../package.json') === false
    && fs.existsSync(path.join(__dirname, '..', 'package.json')));
  ok('非法房间号一律拒（拼路径之前先过白名单）', Files.removeFile('99', 'a.pdf') === false && Files.removeFile('../x', 'a.pdf') === false);
  ok('removeRoom 把整个房间目录清掉', (() => {
    const n = Files.removeRoom(ROOM);
    return n >= 0 && !fs.existsSync(Files.roomDir(ROOM));
  })());
  ok('removeRoom 对非法房间号不抛、不删别的', Files.removeRoom('bad') === 0 && Files.removeRoom('../') === 0);

  console.log('\n═══ F. 下发策略（这一份是安全判据） ═══');
  ok('pdf 内联 + 真实 MIME（浏览器内置阅读器要用）', (() => {
    const p = Files.servePolicy('a.pdf');
    return p.inline === true && p.mime === 'application/pdf';
  })());
  ok('光栅图片内联 + 真实 MIME', ['a.png', 'a.jpg', 'a.webp', 'a.gif'].every((n) => Files.servePolicy(n).inline === true));
  ok('★ SVG 强制下载 + octet-stream（SVG 里能带 <script>，同源内联 = 存储型 XSS）', (() => {
    const p = Files.servePolicy('logo.svg');
    return p.inline === false && p.mime === 'application/octet-stream' && /^attachment/.test(p.disposition);
  })());
  ok('★ html / js 强制下载 + octet-stream', ['a.html', 'a.htm', 'a.js', 'a.xhtml'].every((n) => {
    const p = Files.servePolicy(n);
    return p.inline === false && p.mime === 'application/octet-stream';
  }));
  ok('Office 文档强制下载（前端是 fetch 字节自己渲染，不看 disposition）',
    ['a.docx', 'a.xlsx', 'a.pptx'].every((n) => Files.servePolicy(n).inline === false));
  ok('未知扩展名落在"下载"那一侧（白名单放行，新类型不需要有人记得加规则）', (() => {
    const p = Files.servePolicy('a.weirdext123');
    return p.inline === false && p.mime === 'application/octet-stream';
  })());
  ok('中文名两份都给：filename= 只放 ASCII，filename* 用 UTF-8（RFC 5987）', (() => {
    const d = Files.servePolicy('季度 报告.pdf').disposition;
    return /filename="[^"]*"/.test(d) && /filename\*=UTF-8''%E5%AD%A3%E5%BA%A6/.test(d);
  })());
  ok('disposition 里不许出现裸引号/换行（头部注入）', (() => {
    const d = Files.servePolicy('a"\r\nX-Evil: 1.pdf').disposition;
    return d.indexOf('\r') < 0 && d.indexOf('\n') < 0;
  })());
  ok('fileUrl 两段都编码', Files.fileUrl(ROOM, 'a b/c.pdf') === `/files/${ROOM}/a%20b%2Fc.pdf`);

  console.log('\n═══ G. 并发 ═══');
  {
    const ROOM2 = '654321';
    const up = (n, txt) => Files.saveUpload(ROOM2, n, fakeReq(Buffer.from(txt, 'utf8')), { maxFileBytes: 1 << 20, maxRoomBytes: 1 << 22, maxCount: 50 }, { id: n, name: n });
    /* ★ 为什么要专门测并发：账本是"读-改-写"一个 JSON 文件，
     *   两个上传同时进行时，各自手里的旧账本会把对方那条**冲掉**——
     *   症状是"文件在盘上、列表里没有"，而单个上传的测试永远是绿的。 */
    const rs = await Promise.all([up('并发一.md', 'a'), up('并发二.md', 'b'), up('并发三.md', 'c')]);
    const names = rs.map((r) => r.name).sort();
    const listed = Files.listFiles(ROOM2).map((f) => f.name).sort();
    ok('三个并发上传都成功', names.join('|') === '并发一.md|并发三.md|并发二.md');
    ok('★ 三个并发上传的账本条目一个都没被冲掉', listed.join('|') === names.join('|'), listed.join('|'));
    Files.removeRoom(ROOM2);
  }

  console.log('\n═══ H. 隔离自证 ═══');
  ok('★ 真实的 sfu/files/ 一个字节都没被动过（测试隔离纪律）', snapshotDir(REAL_DIR) === realBefore,
    `${realBefore} → ${snapshotDir(REAL_DIR)}`);
  ok('FILES_DIR 真的指到了临时目录', Files.FILES_DIR === path.resolve(TMP));

  // 收尾：清掉临时目录（成败都清，别让下一次背锅——坑 72）
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`共享文件存储层：${pass} 通过 / ${fail} 失败`);
  if (fail) { console.log('失败清单：'); fails.forEach((f) => console.log('  · ' + f)); process.exit(1); }
  console.log('✅ 全部通过');
})().catch((e) => {
  console.error('\n💥 测试脚本自身抛错：', e);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (x) { /* ignore */ }
  process.exit(2);
});
