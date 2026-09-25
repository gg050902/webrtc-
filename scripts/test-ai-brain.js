/**
 * AI 智能内核（sfu/ai/brain.js）的双轨单测
 *
 * ══ 为什么这个文件必须存在 ══
 * brain.js 里有四样"看不见的能力"：检索、记忆、意图、行动项。它们的特点是——
 * **错了也不会崩，只会变笨**。这类缺陷最难发现：界面一切正常，AI 只是答非所问。
 * 而"答得不够好"是无法自动断言的，能断言的是它的**结构性保证**：
 *   - 检索：该命中的必须在前 K 条里；无关的必须**不进**上下文（否则会稀释注意力）；
 *   - 记忆：有指代时必须拼上上一轮；超过上限必须丢最老的（有界）；
 *   - 意图：动作型（纪要）**换三种说法都要认出来**——这是"用户以为做成了"的重灾区；
 *   - 行动项：**宁可留空不可编造**——提取不到负责人时必须给空串，不能瞎填。
 *
 * 双轨：Mock 轨（无网络，永远跑，测结构与规则）/ LLM 轨（有 key 才跑，测真模型质量）。
 * 用法：npm run test:ai-brain
 */
'use strict';
const B = require('../sfu/ai/brain');

let pass = 0; let fail = 0; let skipped = 0;
const T = (name, fn) => Promise.resolve().then(fn).then(
  () => { pass++; console.log('  PASS  ' + name); },
  (e) => { fail++; console.log('  FAIL  ' + name + '\n        ' + (e && e.message)); },
);
const assert = (cond, msg) => { if (!cond) throw new Error(msg || '断言失败'); };

/* ── 一份"长会"字幕：关键信息故意放在**最早**，用来证明检索能隔 30 条捞回来 ── */
const LONG_MEETING = [
  { name: '张三', text: '先说结论：交付时间定在 11 月 20 日，这个日期不能再动了', ts: 1000 },
  { name: '李四', text: '好的我记下了', ts: 1100 },
  { name: '王五', text: '我这边网络环境没问题', ts: 1200 },
  ...Array.from({ length: 30 }, (_, i) => ({
    name: ['张三', '李四', '王五'][i % 3],
    text: `闲聊内容第 ${i + 1} 条：今天天气不错/午饭吃什么/周末去哪玩`,
    ts: 1300 + i * 10,
  })),
  { name: '李四', text: '压测报告我负责，周五之前提交', ts: 2000 },
  { name: '张三', text: 'TURN 账号密码记得轮换，下周一之前完成', ts: 2100 },
];

const USE_LLM = require('../sfu/ai/provider').aiEnabled();

(async () => {
  console.log('\n══ AI 智能内核双轨自检 ' + (USE_LLM ? '（有 key → Mock + LLM 全跑）' : '（无 key → 只跑 Mock 轨）') + ' ══\n');

  /* ══════════ 一、分词 ══════════ */
  console.log('── 一、中文分词（bigram）──');
  await T('中文切成字符二元组，标点被丢弃', () => {
    const t = B.tokenize('交付时间，定了。');
    assert(t.includes('交付') && t.includes('付时') && t.includes('时间'), '应含相邻二字组：' + t.join(','));
    assert(!t.some((x) => /[，。]/.test(x)), '标点不该进 token');
  });
  await T('英文/数字整词保留（turn / 123 / api）', () => {
    const t = B.tokenize('TURN 轮换 API 123');
    assert(t.includes('turn'), '英文应小写整词保留：' + t.join(','));
    assert(t.includes('api') && t.includes('123'), '应含 api/123');
  });
  await T('单字查询也能成 token（"钱"）', () => {
    assert(B.tokenize('钱').includes('钱'), '单字应保留');
  });

  /* ══════════ 二、检索（核心：隔 30 条也能捞回来）══════════ */
  console.log('\n── 二、BM25 检索（RAG 的 R）──');
  await T('★ 关键信息在最早一条，问它仍能命中（老实现只看最近 8 条会失明）', () => {
    const r = new B.Retriever(LONG_MEETING);
    const hits = r.search('交付时间是什么时候', 5);
    assert(hits.length > 0, '应当有命中');
    assert(hits[0].text.includes('11 月 20 日'), 'Top1 应是含交付日期那条，实际 Top1：' + (hits[0] && hits[0].text));
  });
  await T('无关句不进结果（只返回有分的，不稀释上下文）', () => {
    const r = new B.Retriever(LONG_MEETING);
    const hits = r.search('交付时间', 10);
    assert(hits.every((h) => !/午饭|天气|周末/.test(h.text)), '闲聊句不该进结果：' + JSON.stringify(hits.map((h) => h.text)));
  });
  await T('说话人加成：问"李四负责什么"时李四的句子优先', () => {
    const r = new B.Retriever(LONG_MEETING);
    const hits = r.search('李四负责什么', 3);
    assert(hits[0].name === '李四', 'Top1 应是李四，实际：' + hits[0].name);
  });
  await T('检索预算：证据块有字符上限，不会把全文塞进 prompt', () => {
    const r = new B.Retriever(LONG_MEETING);
    const ev = B.buildEvidenceBlock(r.search('内容', 20), { maxChars: 200 });
    assert(ev.block.length <= 260, '证据块应受限（约 200 字 + 标号），实际 ' + ev.block.length);
    assert(ev.usedHits < 20, '应只用了部分命中，实际 ' + ev.usedHits);
  });
  await T('空查询/空索引不抛错（fail-safe）', () => {
    assert(new B.Retriever([]).search('随便', 5).length === 0, '空索引应返回 []');
    assert(new B.Retriever(LONG_MEETING).search('', 5).length === 0, '空查询应返回 []');
  });
  await T('不存在的内容 → 空结果（而不是硬凑无关句）', () => {
    const hits = new B.Retriever(LONG_MEETING).search('量子计算机的采购预算', 5);
    assert(hits.length === 0, '无关查询应返回空，实际 ' + hits.length + ' 条');
  });

  /* ══════════ 三、会话记忆 ══════════ */
  console.log('\n── 三、会话记忆（多轮不失忆）──');
  await T('记忆有界：超过上限丢最老的', () => {
    const m = new B.ConversationMemory(3);
    for (let i = 1; i <= 5; i++) m.push('问题' + i, '答案' + i);
    assert(m.length === 3, '应只剩 3 轮，实际 ' + m.length);
    assert(m.recent()[0].q === '问题3', '最老的应是第 3 轮，实际 ' + m.recent()[0].q);
  });
  await T('★ 指代时检索串拼上上一轮（"那他什么时候交"→ 带上"文档谁负责"）', () => {
    const m = new B.ConversationMemory();
    m.push('文档谁负责？', '张三负责');
    const q = m.searchQuery('那他什么时候交？');
    assert(q.includes('文档') && q.includes('什么时候交'), '应拼上上一轮问题，实际：' + q);
  });
  await T('正常提问不被上一轮污染', () => {
    const m = new B.ConversationMemory();
    m.push('文档谁负责？', '张三负责');
    assert(m.searchQuery('压测报告谁做的') === '压测报告谁做的', '无指代词时不该拼历史');
  });
  await T('长答案被截断（历史不占满上下文）', () => {
    const m = new B.ConversationMemory();
    m.push('q', 'x'.repeat(2000));
    assert(m.recent()[0].a.length <= 500, '历史里答案应截断到 500 字内，实际 ' + m.recent()[0].a.length);
  });

  /* ══════════ 四、意图分类（动作型三命中的底线）══════════ */
  console.log('\n── 四、意图分类（动作型不能漏）──');
  await T('★ "纪要"的三种说法都要认出 minutes（老正则只认第一种）', () => {
    for (const s of ['生成纪要', '帮我整理下今天聊了啥', '把会议记录归档一下']) {
      assert(B.classifyByRules(s) === 'minutes', `"${s}" 应判为 minutes，实际 ${B.classifyByRules(s)}`);
    }
  });
  await T('操作型意图识别', () => {
    for (const s of ['操作对方电脑打开计算器', '点一下那个按钮', '远程控制一下']) {
      assert(B.classifyByRules(s) === 'operator', `"${s}" 应判为 operator，实际 ${B.classifyByRules(s)}`);
    }
  });
  await T('回顾型 vs 普通问答区分开', () => {
    assert(B.classifyByRules('刚才大家讨论到哪了') === 'recap', 'recap 判定失败');
    assert(B.classifyByRules('会议室空调多少度') === 'question', '普通问题应判 question');
  });
  await T('classifyIntent 无 key 时也返回确定意图（绝不 undefined）', async () => {
    const r = await B.classifyIntent('帮我生成一份会议纪要');
    assert(B.INTENTS.includes(r.intent), '应返回合法意图，实际 ' + r.intent);
    assert(r.intent === 'minutes', '应命中 minutes 快捷路径');
  });

  /* ══════════ 五、行动项（宁可留空不可编造）══════════ */
  console.log('\n── 五、行动项结构化抽取 ──');
  await T('★ 规则版能抽到 owner/task/due 三个字段', () => {
    const acts = B.extractActionsByRules([
      { name: '李四', text: '压测报告我负责，周五之前提交', ts: 1 },
      { name: '王五', text: 'TURN 账号密码记得轮换，下周一之前完成', ts: 2 },
    ]);
    assert(acts.length >= 2, '应至少抽到 2 条，实际 ' + acts.length);
    assert(acts.some((a) => a.owner === '李四'), '应识别出"我负责"=李四，实际 ' + JSON.stringify(acts));
    assert(acts.some((a) => a.due === '周五' || a.due === '下周一'), '应抽到期限，实际 ' + JSON.stringify(acts.map((a) => a.due)));
  });
  await T('★ 提不到负责人 → 留空串，绝不编造', () => {
    const acts = B.extractActionsByRules([{ name: '张三', text: '这个功能需要尽快上线', ts: 1 }]);
    assert(acts.length === 1, '应识别为行动项');
    assert(acts[0].owner === '', '无明确负责人时应为空串，实际 "' + acts[0].owner + '"');
  });
  await T('集体主语不算负责人（"我们负责"→ 空）', () => {
    const acts = B.extractActionsByRules([{ name: '张三', text: '我们需要跟进这件事', ts: 1 }]);
    assert(acts[0] && acts[0].owner === '', '"我们"不该被当成责任人，实际 "' + (acts[0] && acts[0].owner) + '"');
  });
  await T('renderActions 输出 markdown 清单且暴露缺失', () => {
    const md = B.renderActions([{ owner: '', task: '需要上线', due: '' }]);
    assert(md.includes('待认领') && md.includes('- [ ]'), '应含占位与复选框：' + md);
  });
  await T('extractActions 无条目时不调用 LLM（省钱短路）', async () => {
    const r = await B.extractActions([]);
    assert(r.actions.length === 0 && r.mock === true, '空输入应直接返回');
  });

  /* ══════════ 六、端到端（RoomBrain.answer）══════════ */
  console.log('\n── 六、RoomBrain 端到端问答（Mock 轨）──');
  await T('★ 无 key 时也能答出正确内容（规则兜底读检索结果，不编造）', async () => {
    const brain = new B.RoomBrain();
    const r = await brain.answer('交付时间是什么时候？', LONG_MEETING);
    assert(r.totalDocs === LONG_MEETING.length, '应索引全部字幕，实际 ' + r.totalDocs);
    assert(r.usedHits > 0, '应有检索命中');
    assert(/11 月 20 日/.test(r.text), '兜底答案应包含检索到的原文，实际：' + r.text);
  });
  await T('问答后记忆里有一轮（追问才有上下文）', async () => {
    const brain = new B.RoomBrain();
    await brain.answer('谁负责压测报告', LONG_MEETING);
    assert(brain.memory.length === 1, '应记下 1 轮，实际 ' + brain.memory.length);
  });
  await T('检索器随字幕增长而重建（不是一次性快照）', async () => {
    const brain = new B.RoomBrain();
    const r1 = brain.retriever(LONG_MEETING);
    const grown = LONG_MEETING.concat([{ name: '赵六', text: '新增了一条关于压测的报告结论', ts: 3000 }]);
    const r2 = brain.retriever(grown);
    assert(r1 !== r2, '条目数变化时应重建索引');
    assert(r2.size === grown.length, '新索引应包含新条目');
  });
  await T('AI 故障不抛错（缺 entries 也返回合法结构）', async () => {
    const brain = new B.RoomBrain();
    const r = await brain.answer('有人吗', null);
    assert(typeof r.text === 'string' && r.totalDocs === 0, '应安全降级，实际 ' + JSON.stringify(r).slice(0, 120));
  });

  /* ══════════ 七、LLM 轨 ══════════ */
  console.log('\n── 七、LLM 轨（真模型）──');
  if (!USE_LLM) {
    console.log('  SKIP  未配置 DEEPSEEK_API_KEY → 跳过真模型断言（Mock 轨已覆盖结构保证）');
    skipped = 4;
  } else {
    await T('真模型意图分类：识别老正则认不出的说法', async () => {
      const r = await B.classifyIntent('帮我把今天大家的讨论整理成一份文档');
      assert(r.intent === 'minutes', '应判 minutes，实际 ' + r.intent + '（raw=' + r.raw + '）');
    });
    await T('真模型行动项：抽出结构化三元组', async () => {
      const r = await B.extractActions([
        { name: '张三', text: '前端联调还剩两个接口没通，周五前必须交付 API 文档', ts: 1 },
        { name: '李四', text: '我这边压测先做了 16 路，单核 8263kbps', ts: 2 },
        { name: '王五', text: '记得把 TURN 的账号密码轮换一下，下周一之前完成', ts: 3 },
        { name: '张三', text: '好，文档我负责，压测报告李四跟进', ts: 4 },
      ]);
      assert(r.mock === false, '有 key 应走真模型');
      assert(r.actions.length >= 2, '应抽到至少 2 条行动项，实际 ' + r.actions.length);
      assert(r.actions.every((a) => typeof a.task === 'string' && a.task.length > 0), '每条都要有任务描述');
      assert(r.actions.some((a) => a.owner === '李四'), '应识别出李四跟进压测报告，实际 ' + JSON.stringify(r.actions));
    });
    await T('★ 真模型：证据里没有的内容要承认"没提到"（抗幻觉）', async () => {
      const brain = new B.RoomBrain();
      const r = await brain.answer('预算一共多少钱？', LONG_MEETING);
      assert(r.mock === false, '应走真模型');
      assert(!/\d+\s*(万|元|亿)/.test(r.text) || /没提到|没有提到|未提及/.test(r.text),
        '不该编造预算数字，实际：' + r.text);
    });
    await T('真模型：隔 30 条的关键信息能答对（检索有效性的最终证明）', async () => {
      const brain = new B.RoomBrain();
      const r = await brain.answer('交付时间是什么时候？', LONG_MEETING);
      assert(r.mock === false, '应走真模型');
      assert(/11\s*月\s*20\s*日/.test(r.text), '答案应提到 11 月 20 日，实际：' + r.text);
    });
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败` + (skipped ? `, ${skipped} 跳过` : ''));
  process.exit(fail ? 1 : 0);
})();
