/**
 * 阶段 1：把文本喂给 LLM，拿到结构化会议纪要
 * ══ 学会什么 ══
 * ① system 角色设定 = 给模型一个稳定人格 + 输出格式约束（"只含三小节"这种硬约束非常有效）；
 * ② **上下文窗口**：输入不是无限的。超过一定长度就要分段（本项目阈值按字符数估：1 汉字≈0.6 token）；
 * ③ **长文本策略（map-reduce）**：先分段各自总结，再把各段摘要合并出终稿——
 *    这是"用一个小窗口模型处理一本书"的通用解法，也是本项目 N2 定时纪要的核心算法。
 *
 * ══ 与项目的关系 ══
 * 本文件是 `sfu/server.js` 里 `buildMinutes()` 的**离线版实验室**：同样的 prompt、
 * 同样的分段策略，只是输入从"房间字幕 jsonl"换成"任意文本"。改 prompt 在这里试，
 * 试好了再同步回服务器——调 prompt 不用重启会议。
 *
 * 用法：
 *   node scripts/summarize.js --text "会议记录全文…"
 *   node scripts/summarize.js --file meeting.txt
 *   node scripts/summarize.js --room 123456            # 直接吃服务器字幕账本（和线上同源）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const AI = require('../sfu/ai/provider');

// 单段阈值：约 6000 字符 ≈ 4000 tokens 输入。留足空间的理由——输入省下的每一分，
// 都换成输出质量与更低的花费；真产品的数字要按模型的实际窗口调整。
const CHUNK_CHARS = 6000;

const SYSTEM = '你是会议纪要助手。基于会议字幕输出 markdown，只含三个小节：## 要点（不超过6条）## 待办（可执行的动作项，格式"- [ ] 负责人：事项"）## 结论（一句话）。不要编造字幕里没有的内容。';

// 零 LLM 的规则兜底（AI 双轨约定）：关键词抽待办 + 首尾句节选，key 没配也能出结构化纪要
function mockMinutes(text) {
  const lines = String(text).split('\n').filter((l) => l.trim());
  const todoRe = /(需要|待办|记得|下周|明天|得去|别忘了|安排|跟进|然后要|尽快)/;
  const todos = lines.filter((l) => todoRe.test(l)).slice(0, 6);
  return [
    '## 要点', ...lines.slice(0, 5).map((l) => '- ' + l.slice(0, 80)),
    '## 待办', ...(todos.length ? todos.map((l) => '- [ ] ' + l.slice(0, 80)) : ['- （无）']),
    '## 结论', lines.length ? lines[lines.length - 1].slice(0, 120) : '（无）',
  ].join('\n');
}

/**
 * 分段 + 汇总（map-reduce）
 * @param {string} transcript 带时间戳的 `[HH:MM] 名字: 文本` 原文（或任意纯文本）
 * @param {Object} opts { chars, mock }
 * @returns {Promise<{markdown:string, mock:boolean, chunks:number, usage:Object}>}
 */
async function summarize(transcript, opts = {}) {
  const text = String(transcript || '').trim();
  if (!text) return { markdown: '（输入为空）', mock: true, chunks: 0, usage: { totalTokens: 0 } };
  const size = Number(opts.chars) || CHUNK_CHARS;
  const chunks = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));

  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const add = (u) => { usage.promptTokens += u.promptTokens || 0; usage.completionTokens += u.completionTokens || 0; usage.totalTokens += u.totalTokens || 0; };

  if (chunks.length === 1) {
    const r = await AI.askLLM(
      [{ role: 'system', content: SYSTEM }, { role: 'user', content: `会议字幕：\n${text}` }],
      { temperature: 0.3, maxTokens: 900, mock: () => mockMinutes(text) },
    );
    add(r.usage);
    return { markdown: r.text, mock: r.mock, chunks: 1, usage };
  }

  // ① map：每段各出一份摘要
  const parts = [];
  for (const [i, c] of chunks.entries()) {
    const r = await AI.askLLM(
      [{ role: 'system', content: SYSTEM }, { role: 'user', content: `这是会议第 ${i + 1}/${chunks.length} 段，请给出这一段的要点与待办：\n${c}` }],
      { temperature: 0.3, maxTokens: 500, mock: () => mockMinutes(c) },
    );
    add(r.usage);
    parts.push(r.text);
  }
  // ② reduce：把各段摘要合并成终稿（这一步让跨段的长逻辑仍能落到终稿里）
  const merged = await AI.askLLM(
    [{ role: 'system', content: SYSTEM }, { role: 'user', content: `下面是同一场会议的分段摘要，请去重、合并，输出最终纪要：\n\n${parts.join('\n\n')}` }],
    { temperature: 0.3, maxTokens: 900, mock: () => parts.join('\n\n') },
  );
  add(merged.usage);
  return { markdown: merged.text, mock: merged.mock, chunks: chunks.length, usage };
}

// 房间字幕账本 → 与 buildMinutes 同源的输入格式
function loadRoomCaptions(room) {
  const dir = path.join(__dirname, '..', 'sfu', 'captions');
  if (!fs.existsSync(dir)) throw new Error('没有 sfu/captions 目录');
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(`cap-${room}-`) && f.endsWith('.jsonl')).sort();
  const out = [];
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch (e) { /* 坏行跳过 */ }
    }
  }
  out.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const hhmm = (ts) => new Date(ts || Date.now()).toTimeString().slice(0, 5);
  return out.map((e) => `[${hhmm(e.ts)}] ${e.name || '未知'}: ${e.text || ''}`).join('\n');
}

module.exports = { summarize, mockMinutes, SYSTEM };

// ── CLI ──
if (require.main === module) {
  const argv = process.argv.slice(2);
  const getArg = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  (async () => {
    let transcript = getArg('--text');
    const file = getArg('--file');
    const room = getArg('--room');
    if (!transcript && file) transcript = fs.readFileSync(file, 'utf8');
    if (!transcript && room) { transcript = loadRoomCaptions(String(room).trim()); console.log(`📼 已从房间 ${room} 的字幕账本读取 ${transcript.split('\n').length} 行`); }
    if (!transcript) {
      console.log('用法：node scripts/summarize.js --text "…" | --file a.txt | --room 123456');
      process.exit(1);
    }
    const r = await summarize(transcript);
    console.log('\n' + r.markdown);
    console.log(`\n—  ${r.mock ? '[Mock] 本地规则' : 'LLM 真纪要'} · ${r.chunks} 段 · ${r.usage.totalTokens} tokens `
      + `· 约 ¥${AI.getStats().costCny.toFixed(5)}`);
  })();
}
