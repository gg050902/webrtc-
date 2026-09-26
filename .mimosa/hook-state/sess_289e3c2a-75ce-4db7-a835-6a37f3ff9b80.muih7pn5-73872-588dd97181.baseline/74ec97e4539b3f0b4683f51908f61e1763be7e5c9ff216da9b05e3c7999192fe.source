/**
 * 阶段 2：手写 ReAct 工具调用循环（不引 LangChain）
 * ══ 学会什么 ══
 * ① function calling 的本质：**让模型输出一段约定格式的 JSON**（"我要调 X，参数是 Y"），
 *    真正的执行在你自己的代码里——模型从不真的"动手"，它只是说该动什么；
 * ② 循环体四步：拼消息 → 让模型决策 → 执行工具 → 把结果作为 Observation 喂回去；
 * ③ 必须有**最大步数**（防幻觉打转）与**结构化错误处理**（工具抛错也要喂回，让模型改道）。
 *
 * ══ 为什么值得手写 ══
 * LangChain 的核心也就是这几行。手写之后你才知道那里面的 agent 在干什么——
 * 本项目 `sfu/server.js` 的 AI 远程操作员就是把这里的 row 换成 `remote-input` 帧序列。
 *
 * 用法：
 *   node scripts/agent.js                       # 用内置工具演示：算个数、看时间、查某房间字幕
 *   node scripts/agent.js --goal "123456 房间谁说话最多"
 *   node scripts/agent.js --maxsteps 8 --verbose
 */
'use strict';
const fs = require('fs');
const path = require('path');
const AI = require('../sfu/ai/provider');

const CAPTIONS_DIR = path.join(__dirname, '..', 'sfu', 'captions');

/* ── 工具表：每个工具 = { name, desc, args, run }
 * ▎设计纪律：只放**只读 / 可撤销**的工具。写操作交给人类确认——
 *   这条边界在 C1 AI 远程操作员那里由"授权卡"强制（AI 也不能豁免）。 */
const tools = [
  {
    name: 'calc',
    desc: '计算一个算术表达式，如 "123+456"。',
    args: { expr: 'string' },
    run: async ({ expr }) => {
      // ⚠️ 安全：只允许数字与运算符字符，绝不 eval 任意串（这是工具类函数的本分）
      if (!/^[\d\s+\-*/().%]+$/.test(String(expr))) return 'ERROR: 表达式含非法字符';
      // eslint-disable-next-line no-new-func
      const v = Function('"use strict";return (' + String(expr) + ')')();
      return String(v);
    },
  },
  {
    name: 'now',
    desc: '返回当前时间（YYYY-MM-DD HH:mm）。',
    args: {},
    run: async () => new Date().toLocaleString('zh-CN', { hour12: false }),
  },
  {
    name: 'meeting_stats',
    desc: '统计某个房间的字幕账本：返回发言条数与每人占比。参数 room=6 位房间号。',
    args: { room: 'string' },
    run: async ({ room }) => {
      if (!fs.existsSync(CAPTIONS_DIR)) return 'ERROR: 没有 captions 目录';
      const files = fs.readdirSync(CAPTIONS_DIR).filter((f) => f.startsWith(`cap-${String(room).trim()}-`) && f.endsWith('.jsonl'));
      if (!files.length) return `ERROR: 房间 ${room} 没有字幕记录`;
      const byName = {};
      let total = 0;
      for (const f of files) {
        for (const line of fs.readFileSync(path.join(CAPTIONS_DIR, f), 'utf8').split('\n')) {
          if (!line.trim()) continue;
          try {
            const e = JSON.parse(line);
            total++;
            byName[e.name || '未知'] = (byName[e.name || '未知'] || 0) + 1;
          } catch (e) { /* 坏行跳过 */ }
        }
      }
      const rows = Object.entries(byName).sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([n, c]) => `${n}: ${c} 条（${Math.round((c / total) * 100)}%）`);
      return `共 ${total} 条；TOP：${rows.join('，')}`;
    },
  },
];

function toolPrompt() {
  return tools.map((t) => `- ${t.name}(${Object.keys(t.args).join(', ') || ''}): ${t.desc}`).join('\n');
}

/** 把模型的回复解析成 {type:'action'|'final', ...}；解析不了也算 final（防死循环的宽容处理） */
function parseDecision(raw) {
  const text = String(raw || '').replace(/```(?:json)?/g, '').trim();
  try {
    const j = JSON.parse(text);
    if (j && j.final !== undefined) return { type: 'final', answer: String(j.final) };
    if (j && j.action) return { type: 'action', name: String(j.action), args: j.args || {} };
  } catch (e) { /* 不是 JSON → 当作最终回答 */ }
  return { type: 'final', answer: text };
}

/**
 * 通用 ReAct 循环
 * @param {Object} o { goal, tools, system, maxSteps, verbose, onStep }
 * @returns {Promise<{answer:string, steps:Array, mock:boolean, usage:Object}>}
 */
async function runAgent(o = {}) {
  const list = o.tools || tools;
  const maxSteps = Number(o.maxSteps) || 6;
  const system = o.system || [
    '你是一个会用工具的助手。每一步只能输出一个 JSON 对象，不要输出任何其它文字：',
    '要调用工具：{"action":"工具名","args":{...}}',
    '已经可以回答：{"final":"最终答案"}',
    '可用工具：\n' + list.map((t) => `- ${t.name}(${Object.keys(t.args).join(', ') || ''}): ${t.desc}`).join('\n'),
  ].join('');

  const history = [{ role: 'system', content: system }, { role: 'user', content: `目标：${o.goal}` }];
  const steps = [];
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let mock = false;

  for (let i = 1; i <= maxSteps; i++) {
    const r = await AI.askLLM(history, {
      temperature: 0.2, maxTokens: 500, json: true, label: 'agent-step',
      // 过了步数还没结论 → 兜底 final（保证 agent 总能给个说法，不会卡死）
      mock: () => JSON.stringify({ final: `（[Mock] 未配置 LLM）已尽力：${steps.map((s) => `${s.name}=${s.result}`).join('；') || '无可用工具结果'}` }),
    });
    mock = mock || r.mock;
    usage.promptTokens += r.usage.promptTokens || 0;
    usage.completionTokens += r.usage.completionTokens || 0;
    usage.totalTokens += r.usage.totalTokens || 0;

    const decision = parseDecision(r.text);
    if (decision.type === 'final') {
      if (o.verbose || o.onStep) (o.onStep || console.log)(`[#${i}] final: ${decision.answer}`);
      return { answer: decision.answer, steps, mock, usage };
    }
    const tool = list.find((t) => t.name === decision.name);
    let result;
    if (!tool) {
      result = `ERROR: 没有这个工具（${decision.name}）`;
    } else {
      try {
        result = String(await tool.run(decision.args || {}));
      } catch (err) {
        // ★ 工具报错也要喂回去——这正是 ReAct 的 Observation：模型看到 ERROR 会自己改参数重试
        result = `ERROR: ${err && err.message ? err.message : err}`;
      }
    }
    steps.push({ step: i, name: decision.name, args: decision.args, result });
    if (o.verbose || o.onStep) (o.onStep || console.log)(`[#${i}] ${decision.name}(${JSON.stringify(decision.args)}) → ${result}`);
    history.push({ role: 'assistant', content: r.text });
    history.push({ role: 'user', content: `Observation: ${result}\n继续（只能输出一个 JSON 对象）。` });
  }
  return { answer: `达到最大步数（${maxSteps}）仍未收敛，最后观察：${steps.length ? steps[steps.length - 1].result : '无'}`, steps, mock, usage };
}

module.exports = { runAgent, tools, toolPrompt };

// ── CLI ──
if (require.main === module) {
  const argv = process.argv.slice(2);
  const getArg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
  const goal = getArg('--goal', '现在是几点？再帮我算一下 123+456 等于多少');
  (async () => {
    console.log(`🎯 目标：${goal}`);
    const r = await runAgent({ goal, maxSteps: Number(getArg('--maxsteps', 6)), verbose: argv.includes('--verbose') });
    console.log(`\n✅ 答案：${r.answer}`);
    console.log(`— ${r.mock ? '[Mock]' : 'LLM'} · ${r.steps.length} 步 · ${r.usage.totalTokens} tokens`);
  })();
}
