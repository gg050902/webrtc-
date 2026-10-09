'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
 *  assert-order-guard.js —— 「断言助手参数顺序写反」的常驻守卫（2026-10-09，AGENTS 坑 110）
 * ▎为什么需要它：本仓库历史上同时存在两种签名——
 *    scripts/test-asr.js / test-sfu-signaling.js / test-fileview.js / test-nets.js /
 *    test-crossnet.js 用          ok(名字, 条件)
 *    scripts/test-watch.js 用     ok(条件, 名字)
 *   而我（以及任何一个复制粘贴的人）会照"顺手的那个"写。写反之后**条件位上永远是一句中文
 *   （truthy）**，真判据被当成消息打印出来 —— 于是出现"9 条全绿而一条都没测"，
 *   露馅方式仅仅是输出里出现了 `PASS true`（坑 110 原文）。
 * ▎这不治本（治本是把 ok 收进一个公共模块并改几十条历史断言），但它把**这类错误变成当场红**：
 *   顺序反了 ⇒ 那条断言自己失败并说清为什么，而不是安静地永远绿。
 * ▸ 用法：在每个 helper 的第一行调用 guard(约定, 第一参, 第二参)，拿到字符串就报失败。
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * @param {'name-first'|'cond-first'} convention 这个文件里 ok 的签名约定
 * @param {*} a 第一个实参
 * @param {*} b 第二个实参
 * @returns {string|null} 有问题返回一句人话；没问题返回 null
 */
function guard(convention, a, b) {
  if (convention === 'name-first') {
    // 正确形状：ok('中文名', 布尔/任意条件)
    if (typeof a !== 'string') {
      return `第 1 个参数不是名字（拿到的是 ${typeof a}）——`
        + `这个文件的约定是 ok(名字, 条件)，你八成把顺序写反了（真判据被当成消息打印，断言会永远绿：坑 110）`;
    }
    // 名字位上出现 true/false/纯数字，就是坑 110 那次露馅的原样形态
    if (/^(?:true|false)$/.test(a) || /^\d+$/.test(a)) {
      return `第 1 个参数看起来像值（"${a}"）而不是断言名字——`
        + `大概率是把 (条件, 名字) 那套写法复制过来了（坑 110）`;
    }
    return null;
  }
  if (convention === 'cond-first') {
    // 正确形状：ok(条件, '中文名')
    if (typeof a === 'string' && typeof b === 'string') {
      return `两个参数都是字符串——这个文件的约定是 ok(条件, 名字)，第一条判据在哪儿？`;
    }
    if (typeof a === 'string' && typeof b !== 'string') {
      return `第 1 个参数是字符串而第 2 个不是（拿到 ${typeof b}）——`
        + `这个文件的约定是 ok(条件, 名字)，你把另一种写法（名字, 条件）复制过来了：`
        + `条件位上是一句中文（truthy），断言会**永远绿**（坑 110）`;
    }
    return null;
  }
  return `未知的约定 "${convention}"（只支持 name-first / cond-first）`;
}

module.exports = { guard };
