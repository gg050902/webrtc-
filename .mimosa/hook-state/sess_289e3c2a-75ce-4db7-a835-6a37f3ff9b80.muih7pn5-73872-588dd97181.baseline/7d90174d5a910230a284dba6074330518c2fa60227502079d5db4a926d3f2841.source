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
 * ▎诚实边界（面试会被追问）：本教学版没有做
 *   · 密码强度策略（只校验长度下限）、
 *   · 登录失败锁定 / 验证码（只有内存级限流）、
 *   · 参数升级机制（scrypt 的 N/r/p 升档后如何平滑重哈希）。
 *   生产应补上，尤其是最后一条——算法参数会随硬件发展而过时。
 * ════════════════════════════════════════════════════════════════ */
'use strict';

const crypto = require('crypto');

/** 盐的字节数（hex 后是 32 个字符） */
const SALT_BYTES = 16;
/** 派生密钥长度（字节）。32 字节 = 256 位，与主流做法一致。 */
const KEY_LEN = 32;

/** 生成一个新盐（hex 字符串，直接可入库存 TEXT） */
function newSalt() {
  return crypto.randomBytes(SALT_BYTES).toString('hex');
}

/**
 * 计算口令哈希。**必须是唯一的实现**——任何"照抄一份"都会埋下登不上的隐患（见文件头）。
 * @param {string} password 明文口令（只在内存里存活这一瞬）
 * @param {string} salt 该账号的盐（hex）
 * @returns {string} hex 编码的派生密钥
 */
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), String(salt), KEY_LEN).toString('hex');
}

/**
 * 校验口令。
 * ▎用 timingSafeEqual 而不是 === ：字符串比较一旦不等就短路返回，
 *   比较耗时会随"前缀猜对了多少位"变化，理论上可被计时侧信道逐步逼近。
 *   timingSafeEqual 是定长的，不泄露匹配进度。（这是纵深防御，不是本项目的主要威胁。）
 * ▎长度不等时先返回 false：timingSafeEqual 对长度不同的 Buffer 会直接抛错。
 */
function verifyPassword(password, salt, expectedHash) {
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
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

module.exports = { SALT_BYTES, KEY_LEN, newSalt, hashPassword, verifyPassword, randomPassword };
