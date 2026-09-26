/**
 * 阶段 0：终端一问一答 —— LLM API 的最小可运行模型
 * ══ 学会什么 ══
 * ① LLM 调用就是一次 HTTP POST：messages 是数组，一条消息三种角色之一（system/user/assistant）；
 * ② temperature 控制随机性（0=确定、1=发散），max_tokens 控制最长输出；
 * ③ 多轮对话的本质 = 把历史 messages 原样再发一遍（模型本身无状态，"记忆"在你手里）。
 *
 * 用法：
 *   node scripts/chat.js                  # 进入交互式问答（输入 exit 退出）
 *   node scripts/chat.js --q "一句话介绍 WebRTC"
 *   node scripts/chat.js --system "你只说文言文"     # 体验 system 角色设定
 */
'use strict';
const AI = require('../sfu/ai/provider');

const argv = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

const system = getArg('--system', '你是资深技术助教，用简洁中文回答，直接给结论与要点。');

async function askOnce(question) {
  const s = Date.now();
  let out = '';
  const r = await AI.streamLLM(
    [{ role: 'system', content: system }, { role: 'user', content: question }],
    { temperature: 0.5, maxTokens: 600, mock: () => `（未配置 DEEPSEEK_API_KEY，这里是本地 Mock 回答：你问的是「${question}」）` },
    (d) => { out += d; process.stdout.write(d); },
  );
  console.log(`\n\n— ${r.mock ? 'Mock' : 'LLM'} · ${Date.now() - s}ms · ${r.usage.totalTokens} tokens`);
  return r.text;
}

(async () => {
  const single = getArg('--q', null);
  if (single) { await askOnce(single); return; }

  const history = [{ role: 'system', content: system }];
  console.log('🤖 终端问答（输入 exit 退出；AI 模式：' + (AI.aiEnabled() ? 'LLM' : '[Mock]') + '）');
  process.stdout.write('你> ');
  for await (const line of process.stdin) {
    const q = String(line).trim();
    if (!q) { process.stdout.write('你> '); continue; }
    if (/^(exit|quit|bye)$/i.test(q)) break;
    history.push({ role: 'user', content: q });
    let answer = '';
    const r = await AI.streamLLM(history, {
      temperature: 0.5, maxTokens: 600,
      mock: () => `（本地 Mock：没配 key，我只能复述你的问题「${q}」）`,
    }, (d) => { answer += d; process.stdout.write(d); });
    history.push({ role: 'assistant', content: r.text });
    console.log(`\n\n— ${r.mock ? 'Mock' : 'LLM'} · ${r.usage.totalTokens} tokens（上下文 ${history.length - 1} 条）\n你> `);
  }
  console.log('👋 已退出。累计用量：' + JSON.stringify(AI.getStats()));
})();
