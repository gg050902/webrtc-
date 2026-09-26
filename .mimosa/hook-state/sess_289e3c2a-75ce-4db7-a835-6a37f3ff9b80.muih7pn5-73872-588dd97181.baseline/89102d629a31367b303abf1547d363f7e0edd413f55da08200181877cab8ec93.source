/**
 * AI 功能的**双轨自检**（路线图 1.3 的落地）
 *
 * ══ 为什么要"双轨" ══
 * AI 功能天生两难：断言要稳定，就得不依赖网络与余额；验证是真的，就得真调模型。
 * 解法：两条轨道都跑，各验各的东西——
 *   🚧 Mock 轨（永远跑）：证明**链路没断**—— provider 降级开关好用、纪要确实落盘、
 *      走冒烟的那部分 UI 逻辑在无 key 环境下仍然成立；
 *   🚀 LLM 轨（有 key 才跑，无 key 自动 skip）：证明**模型真的在干活**——
 *      纪要含三小节且事实来自输入、问答命中原文、操作员能产出合法 JSON 计划、
 *      流式能吐出增量。
 *
 * 用法：npm run test:ai    （smoke/sfu 永远跑 Mock 轨；本脚本才动真钱，单次 < 0.01 元）
 */
'use strict';
const path = require('path');
const fs = require('fs');
const AI = require('../sfu/ai/provider');

let pass = 0; let fail = 0;
let skipped = 0;
const T = (name, fn) => Promise.resolve().then(fn).then(
  () => { pass++; console.log('  PASS  ' + name); },
  (e) => { fail++; console.log('  FAIL  ' + name + '\n        ' + (e && e.message)); },
);
const assert = (cond, msg) => { if (!cond) throw new Error(msg || '断言失败'); };

// 一段"假会议记录"——内容是特制的，好让 LLM 轨能验证"事实来自输入而非编造"
const FAKE = [
  '[10:02] 张三: 前端联调还剩两个接口没通，周五前必须交付 API 文档',
  '[10:03] 李四: 我这边压测先做了 16 路，单核 8263kbps，CPU 6%',
  '[10:04] 王五: 记得把 TURN 的账号密码轮换一下，下周一之前完成',
  '[10:05] 张三: 好，文档我负责，压测报告李四跟进',
].join('\n');

const USE_LLM = AI.aiEnabled();

(async () => {
  console.log('\n══ AI 双轨自检 ' + (USE_LLM ? '（检测到 key → Mock 轨 + LLM 轨全跑）' : '（无 key → 只跑 Mock 轨，LLM 轨自动跳过）') + ' ══\n');
  console.log('── 🚧 Mock 轨（零费用零网络，永远可跑）──');

  // Mock 轨要把"有 key"临时关掉，强制走降级路径（测的就是这条路径）
  const realKey = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  // provider 每次调用现读 env（没有缓存），所以这里直接生效，不需要清 require 缓存
  await T('无 key 时 provider 判定为 Mock 模式', async () => {
    assert(AI.aiEnabled() === false, '应当识别为无 key');
  });
  await T('askLLM 无 key → 走 mock 钩子且返回 mock:true', async () => {
    const r = await AI.askLLM([{ role: 'user', content: 'x' }], { mock: () => '本地兜底答案' });
    assert(r.mock === true, 'mock 标记应为 true');
    assert(r.text === '本地兜底答案', '应返回 mock 钩子文本，实际：' + r.text);
  });
  await T('streamLLM 无 key → 分片喂出兜底文本（前端只有一条渲染路径）', async () => {
    let acc = '';
    const r = await AI.streamLLM([{ role: 'user', content: 'x' }], { mock: () => '兜底' }, (d) => { acc += d; });
    assert(r.mock === true && acc === '兜底', '分片结果应等于完整兜底文本，实际：' + acc);
  });
  await T('离线纪要 summarize 在无 key 时仍产出结构化三小节', async () => {
    const { summarize } = require('./summarize');
    const r = await summarize(FAKE);
    assert(r.mock === true, '应为 Mock 纪要');
    for (const sec of ['## 要点', '## 待办', '## 结论']) assert(r.markdown.includes(sec), '缺少小节 ' + sec);
  });
  await T('agent 循环无 LLM 时不会死循环（到终态即止）', async () => {
    const { runAgent } = require('./agent');
    const r = await runAgent({ goal: '算一下 2+2', maxSteps: 4 });
    assert(r.mock === true, '应为 Mock 答案');
    assert(typeof r.answer === 'string' && r.answer.length > 0, '应有兜底答案');
  });

  if (realKey) process.env.DEEPSEEK_API_KEY = realKey; // 还原，给 LLM 轨用

  console.log('\n── 🚀 LLM 轨（真调 DeepSeek，单次 < 0.01 元）──');
  if (!USE_LLM) {
    console.log('  SKIP  未配置 DEEPSEEK_API_KEY → 跳过真模型断言'
      + '\n        配置方式：项目根建 .env 写一行 DEEPSEEK_API_KEY=sk-…（已在 .gitignore 里）');
    skipped = 5;
  } else {
    await T('一次真问答：答案来自模型而非本地模板（非空、不含 [Mock]）', async () => {
      const r = await AI.askLLM([
        { role: 'system', content: '只用一句话回答。' },
        { role: 'user', content: '会议助手的核心价值是什么？' },
      ], { mock: () => '不应该走到这里', maxTokens: 200 });
      assert(r.mock === false, '有 key 却走了 Mock：' + r.text);
      assert(r.text.length > 8, '答案过短：' + r.text);
      assert(!r.text.includes('[Mock]'), '真答案不该带 Mock 标记');
      assert(r.usage.totalTokens > 0, '应返回 usage');
    });

    await T('真纪要：含三小节，且事实取自输入（能说出"张三/API 文档/下周一"等原文要素）', async () => {
      const { summarize } = require('./summarize');
      const r = await summarize(FAKE);
      assert(r.mock === false, '应为 LLM 纪要');
      for (const sec of ['## 要点', '## 待办', '## 结论']) assert(r.markdown.includes(sec), '缺少小节 ' + sec);
      const hit = ['张三', 'API 文档', '下周一'].filter((k) => r.markdown.includes(k));
      assert(hit.length >= 2, '纪要未体现原文事实（命中 ' + hit.join('/') + '）:\n' + r.markdown);
    });

    await T('问答命中原文：问"谁负责文档"，答案应提到张三', async () => {
      const r = await AI.askLLM([
        { role: 'system', content: '你是会议助理，只依据给定字幕回答，不超过 60 字。' },
        { role: 'user', content: `字幕：\n${FAKE}\n\n问题：文档谁负责？` },
      ], { mock: () => '不应该走到这里', maxTokens: 120 });
      assert(r.mock === false, '应走真模型');
      assert(/张三/.test(r.text), '答案没提到张三：' + r.text);
    });

    await T('操作员：LLM 能产出合法的 remote-input 计划 JSON', async () => {
      const r = await AI.askLLM([
        { role: 'system', content: '你是远程桌面 AI 操作员。只输出一个 JSON 数组（不要任何其他文字），表示目标的鼠标/键盘操作序列。' },
        { role: 'user', content: '可用操作 JSON：{op:"move|click|dblclick|type|key|wait", x,y 为 0~1 归一化}。桌面计算器图标在 {0.045,0.09}。\n目标：打开计算器算 123+456' },
      ], { mock: () => '不应该走到这里', temperature: 0.2, json: true, maxTokens: 400 });
      assert(r.mock === false, '应走真模型');
      const plan = JSON.parse(r.text);
      assert(Array.isArray(plan) && plan.length > 0, '计划应为非空数组');
      assert(plan.every((s) => typeof s.op === 'string'), '每一步都要有 op');
    });

    await T('流式：能吐出增量且最终文本非空', async () => {
      let chunks = 0; let acc = '';
      const r = await AI.streamLLM([{ role: 'user', content: '用中文从一数到五' }],
        { mock: () => '不应该走到这里', maxTokens: 100 }, (d) => { chunks++; acc += d; });
      assert(r.mock === false, '应走真模型');
      assert(chunks > 1, '增量回调次数应 >1，实际 ' + chunks);
      assert(r.text.length > 0 && acc.includes(r.text.slice(0, 5)), '流累加应与最终文本一致');
    });
  }

  const st = AI.getStats();
  console.log(`\n结果: ${pass} 通过, ${fail} 失败` + (skipped ? `, ${skipped} 跳过` : ''));
  console.log(`AI 用量：调用 ${st.calls} 次（成功 ${st.ok} / 失败 ${st.errors} / Mock 兜底 ${st.mock}），`
    + `tokens ${st.promptTokens}+${st.completionTokens}，约 ¥${st.costCny}`);
  process.exit(fail ? 1 : 0);
})();
