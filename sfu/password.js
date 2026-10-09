/* ════════════════════════════════════════════════════════════════
 * sfu/password.js —— 口令哈希方案（**唯一实现**，服务器与 CLI 共用）
 *
 * ▎为什么单独抽一个模块（这是一个真实踩过的坑）：
 *   这套方案原本在 server.js 里有一份、在 scripts/admin.js 里又被"照抄"了一份。
 *   两处只要有一处改了（哪怕只是把 32 改成 64、或者 hex 换成 base64），
 *   后果是**静默且致命的**：CLI 建出来的账号在网页上永远登不上，
 *   而报错信息只会说"用户名或密码不对"——排查方向完全被带偏。
 *   所以这里把方案收成一个模块，两边 require 同一份。**用结构消除漂移，
 *   而不是靠"记得同步修改"和一条测试兜着。**
 *
 * ▎方案：scrypt(password, salt, 32) → hex
 *   · 为什么用 scrypt 而不是 sha256：sha256 快得离谱，正适合暴力破解；
 *     scrypt 是**故意设计得又慢又吃内存**的（内存硬），专门抬高离线爆破成本。
 *   · 为什么用 Node 内置 crypto 而不是 bcrypt/argon2：本项目有"零依赖铁律"
 *     （生产依赖只有 mediasoup + socket.io）。scrypt 是内置的，够用且合规。
 *   · 盐：每个账号独立的 16 字节随机值，hex 存库。
 *     同样的密码在两个账号上哈希不同 → 彩虹表失效、批量破解失效。
 *   · 只存 salt + hash，**永不存明文**，也不做可逆加密（能解密的密码等于没加密）。
 *
 * ▎★ 09-30 代际与平滑重哈希（补上"参数升级机制"这块最大的诚实边界）：
 *   · V1 = scrypt(pw, salt, 32)（Node 默认参数 N=16384）——存量账号全是它；
 *   · V2 = scrypt(pw, salt, 64, { N: 32768, r: 8, p: 1 })——密钥翻倍 + 成本参数
 *     N 翻倍，**新哈希一律用它**；单次数十毫秒，登录/注册无感，离线爆破成本翻倍；
 *   · 代数判别 = 按 hex 长度（64/128 字符），不做版本前缀（库里已有 V1 没前缀，
 *     长度本身就是无歧义判别器）；
 *   · **平滑重哈希**：老账号登录成功时，服务器用新参数重算并写回（换新盐）——
 *     用户无感（密码没变），库里的哈希悄悄升级。参数过时问题就此自愈。
 * ════════════════════════════════════════════════════════════════ */
'use strict';

const crypto = require('crypto');

/** 盐的字节数（hex 后是 32 个字符） */
const SALT_BYTES = 16;
/** V1 派生密钥长度（字节）：32 字节 = 256 位，Node scrypt 默认参数（N=16384）。
 *  ★ 09-30 起只用于**存量账号**的校验与平滑升级，新哈希一律走 V2。 */
const KEY_LEN = 32;
/** ★ 09-30 V2 参数：密钥 64 字节 + 成本参数 N 翻倍（32768）。
 *  ▎为什么升：scrypt 的 N/r/p 是"以当下硬件为标尺"的——参数会随硬件发展而过时
 *    （路线图 0.3 第 5 条的存量缺口）。V2 单次 ≈ 数十毫秒，登录/注册无感。
 *    再往后要升 V3 时照同一条路走即可（hashAlgoOf 加一个长度分支）。 */
const KEY_LEN_V2 = 64;
/* ★ maxmem 必须显式放大：Node 的 scrypt 默认 maxmem = 32MB，而 128*N*r = 32MB
 *   正好压线 → 实测抛 "memory limit exceeded"（本机复现）。给 64MB 余量。 */
const SCRYPT_V2 = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** 生成一个新盐（hex 字符串，直接可入库存 TEXT） */
function newSalt() {
  return crypto.randomBytes(SALT_BYTES).toString('hex');
}

/**
 * 计算口令哈希（**当前版本 = V2**）。**必须是唯一的实现**——任何"照抄一份"都会
 * 埋下登不上的隐患（见文件头）。
 * @param {string} password 明文口令（只在内存里存活这一瞬）
 * @param {string} salt 该账号的盐（hex）
 * @returns {string} hex 编码的派生密钥（V2 = 128 个字符）
 */
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), String(salt), KEY_LEN_V2, SCRYPT_V2).toString('hex');
}

/** V1 哈希（旧参数）：**只为两件事保留**——① 校验还没升级的存量账号；
 *  ② 测试里造一个"老账号"来验证平滑升级。新代码不要调它。 */
function hashPasswordLegacy(password, salt) {
  return crypto.scryptSync(String(password), String(salt), KEY_LEN).toString('hex');
}

/**
 * 判断一个存量哈希属于哪一代：按 hex 长度判（V1=64 字符、V2=128 字符）。
 * ▎为什么不做版本前缀：库里已有 V1 数据没有前缀，加前缀反而要迁移旧格式；
 *   长度本身就是无歧义的判别器（两代密钥长度不同），对损坏数据返回 unknown。
 */
function hashAlgoOf(storedHash) {
  const h = String(storedHash || '');
  if (h.length === KEY_LEN_V2 * 2) return 'v2';
  if (h.length === KEY_LEN * 2) return 'v1';
  return 'unknown';
}

/** 该账号的哈希是否需要升级到当前版本（平滑重哈希的触发条件）。 */
function needsUpgrade(storedHash) {
  return hashAlgoOf(storedHash) !== 'v2';
}

/**
 * 校验口令：**按存量哈希的代数自动选参数**——V1 库存用旧参数验，
 * V2 用新参数验，升级过程新老并存互不干扰。
 * ▎用 timingSafeEqual 而不是 === ：字符串比较一旦不等就短路返回，
 *   比较耗时会随"前缀猜对了多少位"变化，理论上可被计时侧信道逐步逼近。
 *   timingSafeEqual 是定长的，不泄露匹配进度。（这是纵深防御，不是本项目的主要威胁。）
 * ▎长度不等时先返回 false：timingSafeEqual 对长度不同的 Buffer 会直接抛错。
 */
function verifyPassword(password, salt, expectedHash) {
  const algo = hashAlgoOf(expectedHash);
  const actual = Buffer.from(
    algo === 'v2'
      ? crypto.scryptSync(String(password), String(salt), KEY_LEN_V2, SCRYPT_V2).toString('hex')
      : hashPasswordLegacy(password, salt),
    'hex',
  );
  const expected = Buffer.from(String(expectedHash || ''), 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

/* 随机口令：用于 CLI 建号/重置密码时自动生成。
 * ▎字母表刻意剔除 0/O/o/1/l/I 等易混字形——这个口令是要人从终端**誊抄**到登录框的，
 *   把 'l' 和 '1' 混起来念不清，是可用性问题而不是安全问题。 */
const PW_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function randomPassword(len = 16) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += PW_ALPHABET[bytes[i] % PW_ALPHABET.length];
  return out;
}

/* ★ 2026-10-09 密码强度判据抽到这里（唯一实现）。
 * ▎为什么：这条规则原来只住在 sfu/server.js 的注册路径里，而 `scripts/admin.js passwd`
 *   自己写了一句"密码至少 6 位（与网页注册的规则一致）"——**它并不一致**：
 *   网页要 ≥8 且至少两类字符，CLI 只查 ≥6 位。于是"用命令行重置一次密码，
 *   反而把一个达标的口令换成了网页根本注册不出来的弱口令"，而且没人觉得哪里不对。
 *   同一个概念（这个系统认为什么算可用密码）被两处分别写一遍，就一定会漂——
 *   这次漂在安全规则上，比漂在样式上贵。
 * @param {string} pw
 * @param {{minLen?:number}} [opts]  下限由调用方给（server 读 config/env，CLI 读同一个 env）
 * @returns {string|null}  null = 合格；否则是能直接给用户看的一句话
 */
function strengthError(pw, opts = {}) {
  const minLen = Number.isFinite(opts.minLen) && opts.minLen > 0 ? opts.minLen : 8;
  if (typeof pw !== 'string' || !pw) return '密码不能为空';
  if (pw.length < minLen) return `密码至少 ${minLen} 位`;
  let classes = 0;
  if (/[a-zA-Z]/.test(pw)) classes += 1;
  if (/[0-9]/.test(pw)) classes += 1;
  if (/[^a-zA-Z0-9]/.test(pw)) classes += 1;
  if (classes < 2) return '密码需包含至少两类字符（字母/数字/符号）';
  return null;
}

module.exports = {
  SALT_BYTES, KEY_LEN, KEY_LEN_V2,
  newSalt, hashPassword, hashPasswordLegacy, verifyPassword,
  hashAlgoOf, needsUpgrade, randomPassword, strengthError,
};
