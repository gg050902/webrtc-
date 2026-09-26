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
const Digest = require('../sfu/ai/digest');

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

  /* ══════════ 五之二、检索召回与"抗幻觉"（★ 09-25）══════════   * ▎这一组来自一次**实测驱动的改造**：用真实语料一跑就发现，原文注释里
   *   "任意查询都能擦边命中"这句承诺**没有兑现**——
   *     「交付时间定在 11 月 20 日」这条语料上，
   *     「啥时候交货？」❌ 无命中、「钱够吗？」❌ 无命中（"钱"与"预算"不共字）。
   *   用户不会照抄原话提问，于是明明会上说过，AI 却答"没提到"——最伤信任的一种失败。
   *   修法：① **查询侧同义词扩展**（钱→预算、交货→交付）；② **单字兜底**并严格降权；
   *         ③ 新增**资格判据**，保证兜底不会把"没提过的话题"也凑出一条证据。
   *   这一组的两个方向都要守：**该召回的必须召回**，**不该召回的必须落空**。 */
  console.log('\n── 五之二、检索召回与抗幻觉（同义改写 / 单字兜底 / 资格判据）──');
  const RECALL_CAPS = [];
  for (let i = 0; i < 55; i++) RECALL_CAPS.push({ name: '王五', text: `闲聊第 ${i} 条：今天天气不错`, ts: 1000 + i });
  RECALL_CAPS.push({ name: '张三', text: '先说结论：交付时间定在 11 月 20 日，这个日期不能再动了', ts: 2000 });
  RECALL_CAPS.push({ name: '李四', text: '好的我记下了', ts: 2010 });
  RECALL_CAPS.push({ name: '李四', text: '压测报告我负责，周五之前提交', ts: 2020 });
  RECALL_CAPS.push({ name: '张三', text: 'TURN 账号密码记得轮换，下周一之前完成', ts: 2030 });
  RECALL_CAPS.push({ name: '张三', text: '预算总盘子是 999 万，走 A 方案', ts: 2040 });

  await T('查询侧同义词扩展：只加说法、不改原查询', () => {
    const ex = B.expandQuerySynonyms('钱够吗？');
    assert(ex.startsWith('钱够吗？'), '应保留原查询在最前，实际 ' + ex);
    assert(/预算/.test(ex), '「钱」应扩展到「预算」，实际 ' + ex);
    assert(B.expandQuerySynonyms('今天天气不错') === '今天天气不错', '没命中任何同义词时应原样返回');
  });

  await T('★ 口语化改写真能召回（这是本轮改造的核心价值）', () => {
    const r = new B.Retriever(RECALL_CAPS);
    const cases = [
      ['啥时候交货？', /11\s*月\s*20/, '交货→交付'],
      ['什么时候能上线？', /11\s*月\s*20/, '上线→发布/交付'],
      ['钱够吗？', /999/, '钱→预算'],
      ['截止日期是哪天？', /11\s*月\s*20/, '截止日期→交付时间'],
    ];
    for (const [q, re, why] of cases) {
      const hits = r.search(q, 3);
      assert(hits.length > 0, `「${q}」应能召回（${why}），实际无命中`);
      assert(re.test(hits[0].text), `「${q}」Top1 应是相关那条，实际 Top1=${hits[0].text.slice(0, 30)}`);
    }
  });

  await T('★ 会议里没提过的话题 → 必须落空（抗幻觉在检索层的闸门）', () => {
    const r = new B.Retriever(RECALL_CAPS);
    for (const q of ['今天股市涨了多少？', '你叫什么名字？', '这道题的解法是什么？', '外太空探索有什么进展？', '明天的电影票买了吗？', '隔壁部门的团建去哪']) {
      const n = r.search(q, 3).length;
      assert(n === 0, `「${q}」不该有命中（会诱导 AI 胡说），实际命中 ${n} 条`);
    }
  });

  await T('共享到"有信息量的词"就算命中——哪怕话题不同（这是有意的取舍）', () => {
    /* ⚠️ 这条断言**故意写成"应该命中"**，与上一条看似矛盾，其实是一致的：
     *   「量子计算机的采购预算」和语料里的「预算总盘子是 999 万」**共享了「预算」**，
     *   所以召回它是**正确**的——检索层的职责是"找出可能有用的原话"，
     *   而不是替 LLM 判断"用户问的量子计算机预算和项目预算是不是一回事"。
     *   ▎为什么不把门槛提到"共享 2 个 bigram"来躲开这种情况：
     *     那会误杀「啥时候交货」（只共享一个「交付」但完全正确）。
     *     **错杀正确召回（AI 说"没提到"）比多给一条弱证据更伤信任**；
     *     弱证据由下游 LLM 兜住——系统提示明确要求证据不足时必须说"没提到"。
     *   这个取舍是**量出来的**：我用真实语料比过两种门槛，一个 bag-of-ngrams
     *   模型无法区分"下周X"的具体日次这类差异，只能选一侧并说明理由。 */
    const r = new B.Retriever(RECALL_CAPS);
    const hits = r.search('量子计算机的采购预算', 3);
    assert(hits.length > 0, '共享「预算」应召回（检索层不做话题同一性判断）');
    assert(/999/.test(hits[0].text), '且应收敛到那条预算发言，实际 ' + hits[0].text.slice(0, 30));
  });

  await T('★ 高频口头禅不足以构成命中（"今天/天气"人人都在说）', () => {
    /* 单字兜底后，任何查询都能和某句话共用一个字；若再允许"高频 bigram"充数，
     *   "今天股市涨了多少"就会靠"今天"命中"今天天气不错"——非常荒谬的假阳性。 */
    const r = new B.Retriever(RECALL_CAPS);
    assert(r.search('明天天气如何', 3).length === 0, '不该靠"天气"这种高频词命中');
    assert(r.search('今天的股市行情怎么样', 3).length === 0, '不该靠"今天"这种高频词命中');
  });

  await T('★ 小语料（N≤3）不做信息量筛选——三五条字幕里"频率"没有意义', () => {
    /* 踩过的坑：资格判据第一版写成"IDF ≥ 1.0"，而 IDF 的取值域随 N 压缩
     * （df=1 时 N=2→0.69、N=3→0.98、N=62→3.7），于是**短会里完美匹配也判不够格**，
     * AI 明明有依据却答"没提到"。 → 判据必须尺度无关（占比），且小语料直接豁免。 */
    const tiny = new B.Retriever([
      { name: '张三', text: '交付时间定在 11 月 20 日', ts: 1 },
      { name: '李四', text: '压测报告我负责', ts: 2 },
    ]);
    assert(tiny.search('交付时间', 3).length > 0, '两条语料时也应能召回（不能被频率判据误杀）');
    assert(tiny.search('交付时间', 3)[0].text.includes('11 月 20 日'), '且应命中正确那条');
  });

  await T('单字只影响排序，不单独构成命中', () => {
    /* 「交」是"交付/交货"共用的字。若单字能独立构成命中，
     * 那么任何含"交"的问句都会召回"交付时间"，假阳性会失控。
     * 判据：**只擦到单字、不共享 bigram 的查询必须落空**。 */
    const one = new B.Retriever([{ name: '王五', text: '联网设备的账号要单独申请', ts: 1 }]);
    assert(one.search('联网', 3).length > 0, '共享 bigram 应命中');
    assert(one.search('联系方式', 3).length === 0,
      '「联系方式」与语料只共用一个字、不共享 bigram，不该命中');
  });

  await T('词级重叠才有资格：命中条目必须与查询共享一个 bigram', () => {
    const r = new B.Retriever(RECALL_CAPS);
    for (const q of ['交付时间是什么时候？', '谁负责压测？', '预算多少？']) {
      const hits = r.search(q, 3);
      assert(hits.length > 0, `「${q}」应有命中`);
      const qb = new Set(B.tokenize(q).filter((t) => !t.startsWith('\u0001')));
      const ok = hits.every((h) => {
        const db = new Set(B.tokenize(h.text));
        return [...qb].some((t) => db.has(t));
      });
      assert(ok, `「${q}」的命中必须与查询共享 bigram（否则就是靠单字蹭到的）`);
    }
  });

  await T('不存在的内容 → 空结果（而不是硬凑无关句）', () => {
    const hits = new B.Retriever(LONG_MEETING).search('量子计算机的采购预算', 5);
    assert(hits.length === 0, '无关查询应返回空，实际 ' + hits.length + ' 条');
  });

  /* ══════════ 五之三、多查询检索（LLM 改写 + RRF 融合，★ 09-25）══════════
   * ▎要解决的是同义词表**原理上解决不了**的缺口：语料说"压测报告"，
   *   用户问「性能测试那件事谁在做？」——"测试"与"压测"没有共同 bigram，
   *   也不是同义词表能穷举的关系（领域内同义是开放集合，写不全）。
   *   实测改造前：该问法与「这块压力大不大」**都是 0 命中**。
   *   这里守两件事：**融合逻辑正确**（纯函数可单测）+ **无 key 时绝不拖累主链路**。 */
  console.log('\n── 五之三、多查询检索（LLM 改写 + RRF 融合）──');
  await T('RRF：被多路同时命中的条目排更前（这正是"融合"的意义）', () => {
    const a = [{ ts: 1, text: 'A', score: 9 }, { ts: 2, text: 'B', score: 2 }];
    const b = [{ ts: 1, text: 'A', score: 0.5 }, { ts: 3, text: 'C', score: 8 }];
    const out = B.rrfFuse([a, b], 5);
    assert(out[0].text === 'A', 'A 在两路都出现，应排第一，实际 ' + out.map((h) => h.text).join(','));
    assert(out[0].via === 2, 'A 的 via 应为 2（被两路命中），实际 ' + out[0].via);
    assert(out.length === 3, '三条不同条目都应保留，实际 ' + out.length);
  });
  await T('RRF：同一条字幕在不同查询里被认成同一条（按 ts+正文去重）', () => {
    const out = B.rrfFuse([[{ ts: 7, text: '同一条', score: 5 }], [{ ts: 7, text: '同一条', score: 1 }]], 5);
    assert(out.length === 1, '应去重成一条，实际 ' + out.length);
    assert(out[0].via === 2, 'via 应累计为 2');
  });
  await T('RRF：平手时用原 BM25 分兜底（RRF 丢了强度信息，得补回来）', () => {
    // 两条都只在一路、名次相同 → RRF 分完全相等，此时应看谁的原分高
    const out = B.rrfFuse([[{ ts: 1, text: '弱', score: 1 }], [{ ts: 2, text: '强', score: 9 }]], 5);
    assert(out[0].text === '强', 'RRF 打平时应让原分高的在前，实际 ' + out[0].text);
  });
  await T('RRF 对空输入安全（不抛错、不返回脏数据）', () => {
    assert(B.rrfFuse([], 3).length === 0);
    assert(B.rrfFuse([[], []], 3).length === 0);
    assert(B.rrfFuse([null, undefined], 3).length === 0);
  });
  await T('检索结果带"覆盖率"（answer 用它判断召回够不够；用比例而非分数）', () => {
    const r = new B.Retriever(RECALL_CAPS);
    const full = r.search('交付时间是什么时候？', 3);
    assert(full.length && typeof full[0].cover === 'number', '命中应带 cover 字段');
    assert(full[0].cover > 0 && full[0].cover <= 1, 'cover 应在 (0,1]，实际 ' + full[0].cover);
    const weak = r.search('量子计算机的外太空探索进展如何呀', 3);
    assert(weak.length === 0 || weak[0].cover < 0.5,
      '语料外的问法覆盖率应很低，实际 ' + (weak[0] && weak[0].cover));
  });
  await T('无 key 时改写查询返回空数组（绝不拖累主链路、绝不抛错）', async () => {
    const alts = await B.rewriteQuery('性能测试那件事谁在做？');
    assert(Array.isArray(alts), '应返回数组');
    if (!USE_LLM) assert(alts.length === 0, '无 key 应为空，实际 ' + JSON.stringify(alts));
    assert(Array.isArray(await B.rewriteQuery('')), '空问题也要安全返回数组');
  });
  await T('★ 多查询融合真能补上"词汇表缺口"（真模型；无 key 时跳过）', async () => {
    if (!USE_LLM) { console.log('     （无 key，跳过——Mock 轨已覆盖结构与降级行为）'); return; }
    const caps = [
      { name: '王五', text: '闲聊：今天天气不错', ts: 1 },
      { name: '李四', text: '压测报告我负责，周五之前提交', ts: 2 },
    ];
    const r = new B.Retriever(caps);
    const q = '性能测试那件事谁在做？';
    assert(r.search(q, 3).length === 0, '前提：单查询命中不到（"测试"与"压测"无共同 bigram）');
    const alts = await B.rewriteQuery(q);
    assert(alts.length > 0, '应改写出一批说法，实际 ' + JSON.stringify(alts));
    const fused = B.rrfFuse(alts.map((a) => r.search(a, 3)).filter((l) => l.length), 3);
    assert(fused.length > 0, '融合后应能召回"压测报告"，改写：' + JSON.stringify(alts));
    assert(/压测报告/.test(fused[0].text), 'Top1 应是那条压测发言，实际 ' + fused[0].text);
    console.log('     改写：' + alts.join(' ｜ '));
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
    assert(/11 月 20 (日|号)/.test(r.text), '答案应包含交付日期（日/号均可，LLM 口语化后常写“号”），实际：' + r.text);
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

  /* ══════════ 六之二、参会语义：会话范围（★ 09-25）══════════
   * ▎这一节的边界**改过一次**，两版的理由都留在这里：
   *   第一版边界 = "助理入会时刻"（动机：参与会语义）。真浏览器测试当场推翻它——
   *   助理中途被请进来时对之前整场会一无所知，问"这场会都定了什么"答"没提到"，
   *   等于请来一个废人。而当初要防的真正风险是**房间号回收复用**导致的跨会议串味。
   *   现在边界 = **本场会议开始时刻**：中途入会能答全本场内容，上一场会仍被挡在界外。
   *   所以下面断言的语义从"入会前/后"改成了"上一场会/本场会"。 */
  console.log('\n── 六之二、会议范围（本场会 vs 上一场会 · 房间号复用防串味）──');
  const TWO_SESSIONS = [
    { name: '张三', text: '上一场会的旧账：预算 999 万，全部交给李四处理', ts: 1000 },
    { name: '王五', text: '本场会新结论：交付时间定在 11 月 20 日', ts: 5000 },
    { name: '赵六', text: '本场会新结论：压测报告由孙七负责', ts: 9000 },
  ];
  await T('不给 since → 全档（历史档案模式，导出/离线总结用）', () => {
    const b = new B.RoomBrain(8);
    assert(b.retriever(TWO_SESSIONS).size === 3, '不限范围时应索引全部');
  });
  await T('★ 给了 since（本场会开始）→ 上一场会的记录**检索不到**（防房间号复用串味）', () => {
    const b = new B.RoomBrain(8, { since: 4000 });
    const r = b.retriever(TWO_SESSIONS);
    assert(r.size === 2, '应只索引本场会 2 条，实际 ' + r.size);
    assert(r.search('预算 999 万', 3).length === 0, '上一场会的旧内容不该被检索到（跨会议串味的根源）');
    assert(r.search('交付时间', 3).length > 0, '本场会的内容必须能检索到');
  });
  await T('★ 助理**中途入会**也能答本场会早期内容（第一版设计的致命缺陷）', async () => {
    /* 这条守的是被推翻的那个设计：若下界取"助理入会时刻"，
     *   那么入会时点上已有的全部字幕都会被排除 → 助理一请来就什么都不知道。
     *   现在下界取"房间创建时刻"，所以只要字幕属于本场会，早晚入会都答得出。 */
    const b = new B.RoomBrain(8, { since: 4000 });
    const r = await b.answer('交付时间是什么时候？', TWO_SESSIONS);
    assert(/11\s*月\s*20\s*日/.test(r.text), '应能答出本场会早期内容，实际：' + r.text);
  });
  await T('★ 范围内确无字幕 → 就是空的，**不退回全档**（诚实：没有就是没有）', () => {
    /* ⚠️ 这条断言也**修过**：初版断言"应退回全档（宁可多看不可失明）"，当时是绿的——
     *   它把一个真缺陷当成了期望行为保护起来。兜底会让整个范围机制形同虚设。
     *   教训：**一条绿色的断言也可能是错的**，测试会替缺陷站岗。 */
    const b = new B.RoomBrain(8, { since: 99999 });
    const r = b.retriever(TWO_SESSIONS);
    assert(r.size === 0, '范围外没有字幕时应为空集，实际 ' + r.size + '（退回全档=范围失效）');
    assert(r.search('预算', 3).length === 0, '不该检索到范围外的内容');
  });
  await T('范围内为空时，端到端如实回答"没提到"（而不是拿全档兜底）', async () => {
    const b = new B.RoomBrain(8, { since: 99999 });
    const r = await b.answer('预算多少？', TWO_SESSIONS);
    assert(r.totalDocs === 0, '范围内应无文档，实际 ' + r.totalDocs);
    assert(/没提到|没有提到|未提及|没有相关|没有找到|没聊到/.test(r.text), '应如实说没提到（口语化“没聊到”也算），实际：' + r.text);
  });
  await T('端到端：范围内的答案**不含上一场会的内容**，且 scoped 标志为真', async () => {
    const b = new B.RoomBrain(8, { since: 4000 });
    const r = await b.answer('预算多少？', TWO_SESSIONS);
    assert(r.scoped === true, '应标记为受限会话');
    assert(r.totalDocs === 2 && r.allDocs === 3, '应报出"入会后 2 条 / 全档 3 条"，实际 ' + r.totalDocs + '/' + r.allDocs);
    /* ⚠️ 断言写法自省：**不能**简单断言"文本里不含'预算'二字"——
     * 正确行为恰恰是"会议里没提到预算相关信息"（拒绝作答时要复述问题里的词）。
     * 那样写会把**正确的拒答**判成失败（本次初版就踩了这个坑：1 失败但其实是对的）。
     * 正确的判据是"**没有泄露具体数值**"：999 这个数不该出现。 */
    assert(!/999/.test(r.text), '答案不该泄露上一场会的具体数值，实际：' + r.text);
    assert(/没提到|没有提到|未提及|没有相关|没聊到/.test(r.text), '应明确承认没提到（口语化“没聊到”也算），实际：' + r.text);
  });

  /* ══════════ 六之三、实时会议看板（digest.js）★ 09-25 ══════════
   * ▎为什么这组断言重要：看板是**实时呈现给用户**的，误报的代价与纪要完全不同——
   *   纪要里多抽一条行动项，人复核时删掉即可；看板里冒出一条"今天天气不错 → 行动项"，
   *   用户立刻判定"这 AI 在瞎猜"，之后就再也不看这块板了。
   *   所以这里的核心断言是**精度**（不能误报闲聊），而不是召回。
   *   另外两条同样关键：去重（同一句反复说只记一次）与有界（长会不涨内存）。 */
  console.log('\n── 六之三、实时会议看板（digest）──');
  const MEETING_LINES = [
    { name: '张三', text: '那交付时间就这么定了，11 月 20 日', ts: 1 },
    { name: '李四', text: '我担心时间来不及，联调还没开始', ts: 2 },
    { name: '王五', text: 'TURN 账号密码记得轮换，下周一之前完成', ts: 3 },
    { name: '李四', text: '压测报告我负责，周五之前提交', ts: 4 },
    { name: '张三', text: '下一个议题是跨网连接怎么做', ts: 5 },
    { name: '张三', text: '今天天气不错', ts: 6 },
    { name: '李四', text: '午饭吃什么', ts: 7 },
    { name: '王五', text: '好', ts: 8 },
    { name: '王五', text: '嗯', ts: 9 },
  ];
  await T('★ 四类信息都能抽到（决定 / 风险 / 行动项 / 议题）', () => {
    const d = new Digest.Digest();
    const r = d.ingest(MEETING_LINES);
    assert(r.added.decision.length === 1, '应抽到 1 条决定，实际 ' + r.added.decision.length);
    assert(r.added.risk.length === 1, '应抽到 1 条风险，实际 ' + r.added.risk.length);
    assert(r.added.todo.length === 2, '应抽到 2 条行动项，实际 ' + r.added.todo.length);
    assert(r.added.topic.length === 1, '应抽到 1 条议题，实际 ' + r.added.topic.length);
  });
  await T('★ 闲聊/语气词绝不进看板（看板的生命线是精度）', () => {
    const d = new Digest.Digest();
    const r = d.ingest([
      { name: '张三', text: '今天天气不错', ts: 1 },
      { name: '李四', text: '午饭吃什么', ts: 2 },
      { name: '王五', text: '好', ts: 3 },
      { name: '王五', text: '嗯嗯', ts: 4 },
      { name: '张三', text: '哈哈哈哈', ts: 5 },
    ]);
    assert(r.addedCount === 0,
      '闲聊不该产出任何看板条目，实际产出：' + JSON.stringify(r.added).slice(0, 200));
  });
  await T('★ 行动项带负责人（"我负责"型必须认到说话人）', () => {
    /* 实测踩坑：初版 classify 为了省参数没传说话人，"压测报告我负责" 的负责人
     *   永远是空 → 所有自认领型行动项都变成"待认领"，看板会误报一堆无主任务。 */
    const d = new Digest.Digest();
    const r = d.ingest([{ name: '李四', text: '压测报告我负责，周五之前提交', ts: 1 }]);
    const todo = r.added.todo[0];
    assert(todo, '应识别为行动项');
    assert(todo.owner === '李四', '自认领型应归到说话人李四，实际 "' + todo.owner + '"');
    assert(todo.due === '周五', '应识别期限，实际 "' + todo.due + '"');
  });
  await T('无人认领的行动项能被单独挑出（AI 主动提醒的原料）', () => {
    const d = new Digest.Digest();
    d.ingest(MEETING_LINES);
    const un = d.unclaimedTodos();
    assert(un.length === 1, '应恰好 1 条无主行动项（TURN 轮换），实际 ' + un.length);
    assert(/TURN/.test(un[0].text), '无主的那条应是 TURN 轮换，实际 ' + un[0].text);
  });
  await T('同一句反复说只记一次（去重）', () => {
    const d = new Digest.Digest();
    d.ingest([{ name: '张三', text: '那交付时间就这么定了，11 月 20 日', ts: 1 }]);
    const again = d.ingest([
      { name: '李四', text: '那交付时间就这么定了，11 月 20 日', ts: 2 },
      { name: '王五', text: '那交付时间就这么定了, 11 月 20 日', ts: 3 },   // 标点/空格不同
    ]);
    assert(again.addedCount === 0, '重复表述不该重复入板，实际新增 ' + again.addedCount);
  });
  await T('同一句不会在两个栏目各出现一次（跨类去重）', () => {
    const d = new Digest.Digest();
    const r = d.ingest([
      { name: '张三', text: '这个方案就这么定了，但是我有风险担心来不及', ts: 1 },
    ]);
    // 同时命中"决定"和"风险"两个正则，但只能入一类（决定优先）
    const total = Digest.KINDS.reduce((n, k) => n + r.added[k].length, 0);
    assert(total === 1, '同一句应只入一类，实际入了 ' + total + ' 类：' + JSON.stringify(r.added).slice(0, 200));
  });
  await T('★ 有界：超出上限丢最老的（长会不涨内存）', () => {
    const d = new Digest.Digest({ maxPerKind: 3 });
    for (let i = 0; i < 10; i++) {
      d.ingest([{ name: '张三', text: `第 ${i} 个议题：这是第 ${i} 项要讨论的内容`, ts: i }]);
    }
    const snap = d.snapshot();
    assert(snap.counts.topic === 3, '每类应被压到 3 条，实际 ' + snap.counts.topic);
    assert(/第 9 个议题/.test(snap.items.topic[0].text), '最新一条应在最前，实际 ' + snap.items.topic[0].text);
  });
  await T('快照是最新在前（看板关心"现在"）', () => {
    const d = new Digest.Digest();
    d.ingest([
      { name: '张三', text: '第一个议题是部署', ts: 1 },
      { name: '李四', text: '第二个议题是测试', ts: 2 },
    ]);
    const snap = d.snapshot();
    assert(snap.items.topic[0].ts === 2, '最新议题应排最前，实际 ts=' + snap.items.topic[0].ts);
  });
  await T('原文照录，不做任何改写（看板不编造）', () => {
    const src = 'TURN 账号密码记得轮换，下周一之前完成';
    const d = new Digest.Digest();
    const r = d.ingest([{ name: '王五', text: src, ts: 1 }]);
    assert(r.added.todo[0].text === src, '看板条目必须是原话，实际：' + r.added.todo[0].text);
  });
  await T('★ "把某个日期/方案定下来"是**决定**，不是行动项（真截图暴露的错分）', () => {
    /* 这条来自真浏览器截图：看板把「先说结论：交付时间定在 11 月 20 日」归进了
     *   **行动项**并打了"待认领"——因为句中有"交付"（命中行动项的动词闸门），
     *   而决定词表当时不认"定在"。
     *   后果很实际：用户会去找人认领一句**根本不需要人做**的事实陈述。
     *   所以这条断言的判据是"栏目归属"，不是"有没有抽到"。 */
    const d = new Digest.Digest();
    const r = d.ingest([{ name: '张三', text: '先说结论：交付时间定在 11 月 20 日，这个日期不能再动了', ts: 1 }]);
    assert(r.added.decision.length === 1, '应归入「决定」，实际归到了：' +
      JSON.stringify(Digest.KINDS.filter((k) => r.added[k].length)));
    assert(r.added.todo.length === 0, '不该同时出现在行动项里');
  });
  await T('"不一定/固定在线"这类含"定"字的词不会被误判成决定', () => {
    const d = new Digest.Digest();
    const r = d.ingest([
      { name: '张三', text: '这个方案我还不一定同意', ts: 1 },
      { name: '李四', text: '服务器固定在线，随时可以连', ts: 2 },
    ]);
    assert(r.added.decision.length === 0, '不该误判成决定，实际：' +
      JSON.stringify(r.added.decision.map((x) => x.text)));
  });
  await T('空输入 / 非法输入不抛错', () => {
    const d = new Digest.Digest();
    assert(d.ingest(null).addedCount === 0, 'null 应安全');
    assert(d.ingest([{ text: '' }, null, { text: '   ' }]).addedCount === 0, '空文本应被跳过');
  });

  /* ══════════ 六之四、看板 → 问答（结构化事实回喂，★ 09-25）══════════
   * ▎为什么需要：真浏览器测试里问「这场会都定了什么？」，AI 只答出**一条**决定
   *   （另一条被 BM25 漏掉了）。清单型问题的答案本该是**完整枚举**，
   *   而完整清单其实早就被 digest 抽好了 —— 直接把它交给模型才是对的，
   *   不该赌"检索运气"。 */
  console.log('\n── 六之四、看板 → 问答（清单型问题要给全，不靠检索运气）──');
  await T('★ 问"定了什么"能识别出要看【决定】类看板数据', () => {
    const keys = Digest.probeBoard('这场会都定了什么？');
    assert(keys.includes('decision'), '应识别出 decision，实际 ' + JSON.stringify(keys));
  });
  await T('问"有哪些待办"能识别出要看【行动项】', () => {
    assert(Digest.probeBoard('现在有哪些待办？').includes('todo'), '应识别出 todo');
    assert(Digest.probeBoard('谁负责压测报告').includes('todo'), '问"谁负责"也属于待办类');
  });
  await T('普通提问不触发看板注入（避免污染上下文）', () => {
    assert(Digest.probeBoard('今天天气怎么样').length === 0, '闲聊不该触发');
    assert(Digest.probeBoard('压测报告写了多少路并发').length === 0, '事实提问不该触发');
  });
  await T('★★ 清单型问题的证据必须**完整包含全部条目**（这是本功能存在的理由）', () => {
    const d = new Digest.Digest();
    d.ingest([
      { name: '张三', text: '先说结论：交付时间定在 11 月 20 日', ts: 1 },
      { name: '王五', text: '那就这么定了，采用 A 方案', ts: 2 },
    ]);
    const ev = Digest.renderBoardEvidence(d.items.decision, 'decision');
    assert(/11 月 20 日/.test(ev), '第一条决定应在证据里：' + ev);
    assert(/A 方案/.test(ev), '第二条决定也应在证据里（不能只有一条）：' + ev);
  });
  await T('行动项证据列出 负责人/事项/期限 三字段（清单型问题的答案本体）', () => {
    const d = new Digest.Digest();
    d.ingest([
      { name: '李四', text: '压测报告我负责，周五之前提交', ts: 1 },
      { name: '王五', text: 'TURN 账号密码记得轮换，下周一之前完成', ts: 2 },
    ]);
    const ev = Digest.renderBoardEvidence(d.items.todo, 'todo');
    assert(/负责人：李四/.test(ev), '应写明负责人：' + ev);
    assert(/期限：周五/.test(ev), '应写明期限：' + ev);
    assert(/待认领/.test(ev), '无主那条应标注待认领：' + ev);
  });
  await T('该类为空时如实写"目前为空"（不编造）', () => {
    const ev = Digest.renderBoardEvidence([], 'risk');
    assert(/为空/.test(ev), '应如实说为空：' + ev);
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
    await T('★ 真模型意图分类：问"事实"不能被判成"要文件"（真浏览器暴露的错分）', async () => {
      /* 实测「这场会都定了什么？」被判成 minutes → 用户问一句话却收到一个文件。
       * 判据：**问"是什么"→ question；要"给我一份"→ minutes**。 */
      const r = await B.classifyIntent('这场会都定了什么？');
      assert(r.intent === 'question', '问事实应判 question，实际 ' + r.intent + '（raw=' + r.raw + '）');
      const r2 = await B.classifyIntent('现在有哪些待办？');
      assert(r2.intent === 'question', '问待办列表应判 question，实际 ' + r2.intent + '（raw=' + r2.raw + '）');
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
      assert(/11\s*月\s*20\s*(日|号)/.test(r.text), '答案应提到交付日期（日/号均可，LLM 口语化后常写“号”），实际：' + r.text);
    });
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败` + (skipped ? `, ${skipped} 跳过` : ''));
  process.exit(fail ? 1 : 0);
})();
