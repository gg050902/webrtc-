/* ══════════════════════════════════════════════════════════════
 * sfu/jsonc.js —— 带注释 JSON 的容错解析（★ 09-28）
 *
 * ▎为什么需要它（一个"照文档做反而出事"的真陷阱）：
 *   sfu/config.example.json 里写了大量 `//` 注释（这份配置是给人读的），
 *   而 README/部署手册让人"复制 config.example.json 改名成 config.json"——
 *   可服务器与 doctor 都用严格 `JSON.parse`，复制过去的注释会让它**静默失效**：
 *   服务器 catch 住异常、当"没有配置文件"继续跑（只用默认值），用户以为配置生效了。
 *   这类"错误被吃掉"的坑最难查：功能没坏，只是按默认值跑。
 *
 * ▎做法：解析前把字符串之外的注释剥掉（保留字符串里的 // 与 /* *\/）。
 *   不引第三方依赖，一个状态机 ~25 行；两处加载器共用同一份实现（避免漂移）。
 * ══════════════════════════════════════════════════════════════ */
'use strict';

// 剥掉 JSONC 注释（支持 // 行注释与 /* */ 块注释；字符串内的内容原样保留）
function stripJsonComments(text) {
  const src = String(text == null ? '' : text);
  let out = '';
  let inStr = false;
  let quote = '';
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];
    if (inStr) {
      out += ch;
      if (ch === '\\') {            // 转义序列：把下一个字符一并吞掉
        if (i + 1 < src.length) { out += src[i + 1]; i += 1; }
      } else if (ch === quote) {
        inStr = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; quote = ch; out += ch; continue; }
    if (ch === '/' && next === '/') {           // 行注释 → 跳到行尾
      while (i < src.length && src[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {           // 块注释 → 跳到 */
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 1;                                   // 跳到 '/' 上（循环末尾还会 +1）
      continue;
    }
    out += ch;
  }
  return out;
}

// 解析可能带注释的 JSON；失败时抛错（调用方决定是"用默认值"还是"报错"）
function parseJsonc(text) {
  // 去掉剥注释后可能出现的尾随逗号（{"a":1,} → {"a":1}），同样是手写配置的常见笔误
  const cleaned = stripJsonComments(text).replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(cleaned);
}

module.exports = { parseJsonc, stripJsonComments };
