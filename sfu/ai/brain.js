/**
 * ★ 09-24e AI 智能内核 —— 让"AI 助理"从【关键词模板】升级为【真检索 + 真记忆 + 真理解】
 *
 * ══ 为什么要有这个文件（问题的起点）══════════════════════════════════
 * 改造之前，`aiBrain()` 拼上下文的方式是 **`capTail.slice(-8)`** ——只把"最后 8 条字幕"
 * 塞给模型。这在 5 分钟的演示里看不出问题，但它有一个致命的、且**最容易被验收老师
 * 一句话问倒**的缺陷：
 *
 *     会议开了 40 分钟，老师在第 3 分钟说过「把交付时间定在 11 月 20 日」，
 *     到第 38 分钟你问 AI「交付时间是什么时候？」→ **它答不上来**。
 *
 * 因为它压根没看到那句话。这不是模型不行，是**我们没把正确的上下文给它**。
 * 大模型的上下文窗口是稀缺资源（贵、且长了会"注意力涣散"），
 * 所以工业界的正解从来不是"把全文塞进去"，而是——**先检索，再生成**（RAG）。
 *
 * ══ 这个文件提供四样东西（全部零依赖、全部双轨）════════════════════
 *
 * ① **Retriever（检索引擎）**：中文友好的 BM25 变体
 *    - 分词：**字符二元组（bigram）**。为什么不用空格分词？中文没有词边界，
 *      "交付时间" 用空格切会变成一个 token，而用户可能问"什么时候交"，字面完全不同
 *      → 检索为 0。切成 bigram（交付/付时/时间）后，"交付"就能和"交"擦边命中。
 *      这是中文全文检索绕开分词器（jieba 等重依赖）的经典做法，**零依赖**。
 *    - 打分：BM25（k1=1.5, b=0.75）+ **时间衰减**（越近的字幕略微加权）+
 *      **说话人命中加成**（问"张三说了什么"时，张三名下的句子优先）。
 *    - 为什么是 BM25 而不是"向量检索"？诚实地说：真向量检索要 embedding 模型
 *      （又一次 API 调用 / 又一次网络依赖）。BM25 是**纯本地、毫秒级、可解释**的，
 *      对"会议室里找一句话"这个规模（几千条）效果已经很好。这是工程取舍，不是偷懒。
 *
 * ② **Memory（会话记忆）**：每个房间一份多轮对话历史
 *    - 解决"追问失忆"：用户问"谁负责文档" → AI 答"张三" → 用户问"**那他什么时候交？**"
 *      → 没有记忆的话，"他"是谁、问的是哪件事，全都丢了。
 *    - 记忆有两个用途：**(a)** 拼进 messages 让模型能理解代词指代；
 *      **(b)** 把上一轮的用户问题也一起拿去检索（"他"检索不到东西，但"文档"可以）。
 *    - 环形上限（默认 8 轮）+ 逐条裁剪：**记忆不能无限涨**——长会开 3 小时，
 *      历史会把上下文窗口挤爆、把成本推高。这是"有记忆"和"记忆有界"的区别。
 *
 * ③ **Classifier（意图分类）**：让"换个说法就不认识"成为历史
 *    - 改造前用 `/纪要|总结|摘要/.test(q)` 判断"用户是不是要纪要"。
 *      老师如果说"**帮我整理一下今天聊了啥**"，正则匹配不到 → 走聊天分支 →
 *      **纪要文件根本没生成**，AI 却回了一段"好的我来整理…"的漂亮话。
 *      这是最恶劣的一类 bug：**用户以为做成了，其实什么都没做**。
 *    - 现在：有 key → 让 LLM 分类（它见过"整理下今天聊了啥"这种说法）；
 *      无 key → 扩展过的规则 + 同义词典兜底。**两条路都必须返回一个确定的意图**。
 *
 * ④ **Actions（行动项结构化抽取）**：把"待办"从句子列表变成**三元组**
 *    - 改造前：正则捞出含"下周/记得"的**整句原文**，输出 `- [ ] 张三："记得把 TURN 轮换一下"`。
 *      虽有用，但不是可执行的行动项——**没有负责人字段、没有期限字段**。
 *    - 现在：抽取成 `{ owner, task, due, source }`。
 *      LLM 轨：让模型直接输出 JSON 数组（结构化是它的强项，而且能理解
 *      "文档我负责" 里"我"=张三 这种指代）；Mock 轨：规则版用
 *      "我负责/由X跟进/XX之前完成" 等句式模式尽力提取，提不到就留空——
 *      **宁可留空，不可编造**（这是 AI 产品的底线，也是纪要可信度的来源）。
 *
 * ══ 设计纪律 ══
 * - **纯函数 + 无副作用**：不碰文件系统、不碰网络（除了 askLLM）。可单测。
 * - **绝不抛错**：LLM 失败、JSON 坏了、输入是 undefined —— 一律降级返回兜底值。
 *   调用方（server.js 的会议主路径）永远不该因为 AI 模块异常而中断。
 * - **可解释**：每个返回都带 `mock` / `reason` / 命中数等元信息，UI 能摊开给用户看。
 */
'use strict';

const AI = require('./provider');

/* ══════════════════════════════════════════════════════════════
 * 一、中文分词 & 检索引擎（BM25）
 * ══════════════════════════════════════════════════════════════ */

/* ★ 09-25：是否额外索引**单字（unigram）**。默认开；`AI_UNIGRAM=0` 可关掉做 A/B。
 * 这个开关是**实测驱动**的：原始设计只切 bigram，注释里写着"任意查询都能擦边命中"——
 * 用真实语料一测就发现**这句承诺没有兑现**（注释与实现不符，本身就是个问题）：
 *     「交付时间定在 11 月 20 日」这条语料上，
 *       「啥时候交货？」→ ❌ 无命中（"交货"与"交付"没有共同的 bigram）
 *       「钱够吗？」    → ❌ 无命中（"钱"与"预算"完全不同的字）
 *     → 用户不会照抄原话提问，只会说"啥时候交""钱够吗"，
 *       于是**明明会议里说过，AI 却答"没提到"**——这是最伤信任的一种失败。
 * 修法就是**同时索引单字**：这样"交货/交付"能靠共同的「交」捞回来。
 * ▎为什么不用手工权重：BM25 的 IDF **天然**会压住单字的权重
 *   （常见字出现在几乎所有文档里 → IDF 趋 0），罕见字（如"钱""货"）反而权重高。
 *   也就是说"单字只作为兜底、不该主导排序"这件事**由算法自动完成**了，
 *   不需要我再拍一个系数——这是选 BM25 而非向量检索顺带得到的好处。
 * ▎代价（诚实说）：索引体积约翻倍、打分时多一轮遍历。实测几千条语料仍是毫秒级。 */
const USE_UNIGRAM = process.env.AI_UNIGRAM !== '0';

/* 高频单字停用表：这些字几乎出现在每一句里（的/了/是/我…），
 *   IDF 本来就把它们压得很低，但它们的**量大**（每句都有好几个），
 *   累积起来仍会给所有文档平白加分、稀释真正命中的信号。
 *  做一次显式过滤是廉价且有效的（比调 b 值直观）。 */
const UNIGRAM_STOP = new Set('的 了 是 在 我 你 他 她 它 们 有 和 与 就 都 也 很 会 能 要 这 那 个 不 人 上 下 来 去 说 好 对 把 被 给 让 从 到 为 以 但 而 或 及 等 之 其 此 该 你 您 一 二 三 四 五 六 七 八 九 十'.split(' '));

/* ══════════════════════════════════════════════════════════════
 * 查询侧同义词扩展（★ 09-25，实测驱动）
 *
 * ▎为什么需要：单字兜底（unigram）能救"交货/交付"这种**共字**的改写，
 *   但救不了**完全不共字**的：「钱够吗？」问「预算总盘子是 999 万」——
 *   两句话里没有一个共同字符，任何字面检索都注定无命中。
 *   而这恰恰是用户最自然的提问方式（说"钱"而不是"预算"）。
 *
 * ▎为什么只扩展**查询侧**、绝不改文档侧（关键取舍）：
 *   文档是"会上真实说过的话"，是**证据**——一旦去改写它，
 *   气泡里「🔍 看 AI 依据的原话」就不再是原话了，整个可核查性会塌掉。
 *   查询只是"用户怎么提问"，扩展它不触碰证据的真实性。
 *   **要改就改问法，别改证据。**
 *
 * ▎为什么是人工小词表而不是 LLM 改写：
 *   LLM 改写覆盖更广，但要多一次调用（2~5 秒）+ 依赖 key；
 *   而会议室里高频的"同义不同字"其实就那么几组（钱/期限/负责人/风险），
 *   人工词表**零延迟、零成本、完全可预测**——宁可窄而准。
 *   这是"够用就好"的取舍，不是能力上限（LLM 改写可作后续增强）。
 * ══════════════════════════════════════════════════════════════ */
const SYNONYM_GROUPS = [
  ['预算', '钱', '成本', '费用', '经费', '报价', '价钱'],
  ['交付', '交货', '交期', '上线', '发布', '投产'],
  ['期限', '截止', '日期', '几号', '什么时候', 'deadline', '时间点'],
  ['负责人', '谁负责', '认领', 'owner', '归谁'],
  ['阻塞', '卡住', '卡点', '堵住', '挡住'],
  ['风险', '隐患', '坑', '问题点'],
  ['进度', '进展', '做到哪', '怎么样了'],
];

/** 把查询里命中的同义词组的**其它说法**追加到查询串后面（返回新串，不改原文）。 */
function expandQuerySynonyms(query) {
  const q = String(query || '');
  if (!q) return q;
  const extra = [];
  for (const group of SYNONYM_GROUPS) {
    if (group.some((w) => q.includes(w))) {
      for (const w of group) if (!q.includes(w)) extra.push(w);
    }
  }
  return extra.length ? `${q} ${extra.join(' ')}` : q;
}

/** 噪声下限：只保留得分达到**最高分 15%** 以上的命中。
 * ▎为什么需要：开了单字兜底后召回变宽，低分陪跑条目会变多
 *   （实测"交付时间是什么时候"会把"压测报告我负责"以 1.1 分拖进来，
 *     而 Top1 是 8.1 分——差了 7 倍，显然不是同一个话题）。
 *   这些条目会挤占证据预算、把模型带偏，所以按**相对分**砍掉。
 *   用相对分而不是绝对分：不同查询的分数尺度差异很大（长查询分普遍更高），
 *   绝对阈值必然调不准；相对分天然自适应。
 * ▎取值 0.25 是**量出来的**（AI_FLOOR 可覆盖以便 A/B）：
 *   实测"交付时间是什么时候"Top1=12.4，陪跑的"压测报告我负责"=1.1（8.9%）→ 该砍；
 *   而真正相关的第二条（如另一条期限类发言）通常能到 Top1 的 30%+ → 该留。
 *   15% 太松（8.9% 之外、19% 的陪跑仍会被放进来），35% 偏紧（会误伤弱相关的真证据）。 */
/* ⚠️ 读环境变量数字的**唯一正确姿势**（本轮踩到的真坑）：
 *   惯性写法 `Number(process.env.X) || 默认值` 有个致命缺陷——**传 0 会被当成"没传"**，
 *   于是 0 永远无法生效（`Number('0')` 是 0，是 falsy，直接落到默认值）。
 *   调参时想"关掉阈值量一下原始分"就是这么被坑的：设了 AI_SCORE_MIN=0，
 *   实际仍在用 3.0，量出来的数据全是错的（而且看不出来）。
 *   → 必须**显式判断"有没有传"**（undefined / 空串 才算没传），0 是合法值。
 *   这与 `||` / `??` 那条经典区别同源，只是发生在环境变量上更容易被忽略。 */
function envNum(name, def, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return def;
  const v = Number(raw);
  if (!Number.isFinite(v)) return def;
  return Math.max(min, Math.min(max, v));
}

const HIT_SCORE_FLOOR = envNum('AI_FLOOR', 0.25, 0, 0.9);

/* 绝对分下限（★ 09-25）：**连最强的一条都不够格 → 诚实地说"没检索到"**。
 *
 * ▎为什么"相对下限"不够、必须再加一个"绝对下限"（这是单字兜底带来的新问题）：
 *   开了单字兜底后，**任何**查询都能和某句话共用一个字，于是"会议里没提到的东西"
 *   也会被硬凑出一条（如"下周三的团建去哪吃"命中"下周一"）。
 *   相对下限管不了它——只有一条命中时它就是 Top1，相对分永远是 100%。
 *   于是 AI 会对一个**从没讨论过**的话题煞有介事地引一句不相干的话，
 *   这比"说没提到"糟糕得多（那是**看起来有据可依的胡说**）。
 *
 * ▎3.0 是量出来的……**不，这个思路本身错了**（留在这里当反面教材）：
 *   我一开始想用"绝对分下限"来拦假阳性，并真的量出了一个数（真命中最低 5.65 /
 *   假阳性最高 2.44，看着很干净）。但换到 62 条的语料上再量就发现**这个数不可移植**：
 *   BM25 的 IDF 随语料规模增长（df=1 时 N=6 → IDF 1.54，N=62 → IDF 3.7），
 *   于是同一句"共享一个 bigram"的真命中，在小语料上只有 0.9 分、大语料上有 2.2 分——
 *   **任何固定的绝对阈值都会在小语料上误杀、或在大语料上漏拦**。
 *   → 结论：判"够不够格"的量必须是**尺度无关**的，不能用分数。
 *   最终改用的判据是「**至少共享一个 bigram/英文词**」（见 search 里的 strong 掩码），
 *   它随语料规模不变，且语义明确（"有真实的词级重叠"而不是"蹭到一个字"）。
 *   这个常量因此保留但**默认 0（不启用）**——留作极端场景的手动旋钮，
 *   而不是主判据。（`AI_SCORE_MIN` 可覆盖。）
 */
const HIT_SCORE_MIN = envNum('AI_SCORE_MIN', 0, 0, 1e6);

/* 单字 token 的**前缀标记**：给单字加一个不可见前缀，让它在倒排索引里
 *  与两字词彻底分开，从而在打分时能被**单独识别并降权**。
 * ▎为什么必须显式降权（而不是"靠 IDF 自动压住"——那是错的，我实测踩到）：
 *   我原本以为 BM25 的 IDF 会让常见单字自然低分，就不用管了。**实测证伪**：
 *   查询「量子计算机的采购预算」在**完全不含"预算"**的语料上仍能命中——
 *   因为单字「计」「算」在语料里出现且 IDF 不算低，两条单字命中叠加就过了阈值。
 *   于是"没提到的内容"被硬凑出一条证据，AI 会煞有介事地引用一句无关的话。
 *   → IDF 只压"高频字"，压不住"中等频率的字"；这类字反而最容易造成假阳性。
 *   所以必须**显式**把单字贡献降权，把它明确地定义成"只用来微调排序，
 *   不足以单独撑起一条命中"。 */
const UNIGRAM_PREFIX = '\u0001';
/* 单字贡献的权重：0.3 = 单字合计最多算成"三分之一条 bigram"。
 * 量级依据：真命中（共享 bigram）通常在 5~12 分；仅靠单字蹭到的假阳性要压到 3 分线下。 */
const UNIGRAM_WEIGHT = envNum('AI_UNIGRAM_W', 0.3, 0, 1);

/** 中文友好的分词：**字符二元组（bigram）+ 单字（unigram，兜底）+ 英文/数字整词**
 *
 * ▎为什么这么切：
 *   "TURN 账号密码轮换一下" → ['turn', '账号','号密','密码','码轮','轮换','换一','一下', '账','号','密','码',...]
 *   - 英文/数字按整词（turn / 123 / api），因为它们天然有边界且需要精确匹配；
 *   - 中文切相邻两字（bigram）作为**主信号**：能区分"交付"与"交互"这类近义字组合；
 *   - 中文**同时收单字（unigram）**作为**兜底**：让"交货/交付""钱/预算"这类
 *     字面不同但共字的问法仍能擦边命中（见上方 USE_UNIGRAM 的实测说明）。
 * ▎为什么标点要丢掉：标点既是噪声又会造出 "。，" 这种无意义 bigram。
 */
function tokenize(text) {
  const s = String(text || '').toLowerCase();
  const out = [];
  // 英文单词 / 数字 / 下划线 —— 整词保留（保留 t、api、turn、3.26 这类）
  for (const m of s.matchAll(/[a-z0-9][a-z0-9_.\-]*/g)) out.push(m[0]);
  // 中文（含日韩表意）—— 抽出来切成 bigram（主）+ unigram（兜底）
  const cjk = s.replace(/[^\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, ' ');
  for (const seg of cjk.split(/\s+/)) {
    if (!seg) continue;
    if (seg.length === 1) { out.push(seg); continue; }   // 单字查询（如"钱"）单独保留
    for (let i = 0; i < seg.length - 1; i++) out.push(seg.slice(i, i + 2));
    if (USE_UNIGRAM) {
      for (const ch of seg) { if (!UNIGRAM_STOP.has(ch)) out.push(UNIGRAM_PREFIX + ch); }
    }
  }
  return out;
}

/**
 * 检索器：对一组文档（这里是字幕条目）建倒排索引，按 BM25 打分查最相关的几条。
 *
 * ▎BM25 三要素（面试可讲）：
 *   ① TF 饱和：一个词在一篇里出现 10 次，不该比出现 1 次重要 10 倍 → `tf*(k1+1)/(tf+k1*…)`
 *   ② IDF：'会议' 这种到处都是的词权重低，'TURN' 这种稀有的权重高 → `log(1+(N-df+0.5)/(df+0.5))`
 *   ③ 长度归一：长句天然更容易命中词，要按长度惩罚 → 除以 `(1-b+b*dl/avgdl)`
 * ▎本项目额外加的两味：
 *   - **时间衰减**：越靠近会议末尾的字幕乘一个略大于 1 的系数（默认按半天线性，最多 +15%）
 *   - **说话人加成**：查询里出现了某个说话人的名字 → 他名下的句子额外加权（问"张三说了啥"）
 */
class Retriever {
  /**
   * @param {Array<{name?:string, text?:string, ts?:number}>} docs 文档集合
   * @param {Object} opts { k1, b }
   */
  constructor(docs = [], opts = {}) {
    this.k1 = Number(opts.k1) || 1.5;
    this.b = Number(opts.b) || 0.75;
    this.docs = [];
    this.postings = new Map();      // token -> Map(docIndex -> tf)
    this.docLen = [];
    this.avgdl = 1;
    this.maxTs = 0;
    this.minTs = 0;
    this._build(docs);
  }

  _build(docs) {
    const list = Array.isArray(docs) ? docs : [];
    for (const d of list) {
      const text = String((d && d.text) || '');
      if (!text) continue;                        // 空白字幕不进索引（省内存也防噪声）
      const toks = tokenize(text);
      const idx = this.docs.length;
      this.docs.push({
        name: String((d && d.name) || '未知'),
        text,
        ts: Number((d && d.ts) || 0),
        _tokens: toks,
      });
      this.docLen.push(toks.length || 1);
      const seen = new Map();
      for (const t of toks) seen.set(t, (seen.get(t) || 0) + 1);
      for (const [t, tf] of seen) {
        if (!this.postings.has(t)) this.postings.set(t, new Map());
        this.postings.get(t).set(idx, tf);
      }
    }
    const total = this.docLen.reduce((a, b) => a + b, 0);
    this.avgdl = this.docs.length ? total / this.docs.length : 1;
    const tss = this.docs.map((d) => d.ts).filter((t) => t > 0);
    this.minTs = tss.length ? Math.min(...tss) : 0;
    this.maxTs = tss.length ? Math.max(...tss) : 0;
  }

  get size() { return this.docs.length; }

  /** 查询里提到的说话人名字（用于加成）——命中 doc.name 的子串即算 */
  _speakerBoost(query) {
    const q = String(query || '');
    const names = new Set(this.docs.map((d) => d.name));
    const hit = new Set();
    for (const n of names) {
      // 名字通常 2~3 字；名字太短（如"我"）不加成，否则满盘乱加权
      if (n && n.length >= 2 && n !== '未知' && q.includes(n)) hit.add(n);
    }
    return hit;
  }

  /**
   * 检索 Top-K 相关字幕
   * @returns {Array<{name,text,ts,score}>} 按分数降序（**只返回有分的**，无关句子不进上下文）
   */
  search(query, topK = 6) {
    const q = String(query || '').trim();
    if (!q || !this.docs.length) return [];
    /* ★ 09-25：先做**查询侧**同义词扩展，再分词。
     *   顺序很重要：扩展必须在分词**之前**（否则新加的说法不会被切成 token）。 */
    const qToks = tokenize(expandQuerySynonyms(q));
    if (!qToks.length) return [];
    const N = this.docs.length;
    const speakers = this._speakerBoost(q);
    const scores = new Float64Array(N);
    /* ★ 09-25 资格掩码：该文档是否与查询共享过**一个"够有信息量"的 bigram / 英文词**。
     *   ▎为什么需要它（这是本模块最值得记的一处设计）：单字兜底（unigram）能把召回拉宽
     *     ——"啥时候交货"靠一个「交」就能捞回"交付时间"，很香；
     *     但代价是**任何查询都能和某句话共用一个字**，于是"会议里从没提过的话题"
     *     也会被硬凑出一条证据，AI 就会煞有介事地引用一句不相干的话
     *     （比"说没提到"糟糕得多：那是**看起来有据可依的胡说**）。
     *   ▎我先试过"绝对分下限"，量出了阈值——**换语料规模就失效**（见 HIT_SCORE_MIN 注释）。
     *     改用"共享任意 bigram"后**仍然漏**：「今天股市涨了多少」靠一个高频 bigram
     *     「今天」就能蹭过（因为标定语料里 55/62 条都含"今天/天气"）。
     *   ▎最终判据 = **共享的 bigram 不能是"人人都说的词"**。判据必须**尺度无关**，
     *     所以**不能**用 IDF 的绝对值（我第一版就写成了 IDF ≥ 1.0，直接踩坑）：
     *       IDF 的取值域随语料规模压缩——`df=1` 时 N=2 → IDF 0.69、N=3 → 0.98、N=62 → 3.7。
     *       固定 1.0 会让**只有两三条字幕的短会**里，一个完美匹配都被判成"不够格"，
     *       于是 AI 明明有依据却答"没提到"（实测：scope 单测就是这么红的）。
     *     → 改用"**这个词在语料里的占比**"：`df ≤ N/2` 才算有区分度
     *       （即"不至于是过半文档都有的口头禅"）；并且**语料太小时（N≤3）不做这个筛**——
     *       三五条字幕里"频率"没有统计意义，硬筛只会误杀。
     *     单字仍然只影响**排序**，不决定**是否算命中**——严格降级为 tie-breaker。
     *   ▎诚实说明本判据的**边界**（测出来的，不假装它完美）：
     *     「下周三的团建去哪吃」会命中"下周一之前完成"——两者共享一个 bigram「下周」。
     *     一个 bag-of-ngrams 模型**无法**区分"下周X"的具体日次，这是模型能力的边界。
     *     我选择**接受**它而不是把门槛提到"共享 2 个 bigram"，因为那会误杀
     *     「啥时候交货」这类**只共享一个 bigram 但确实正确**的问法——
     *     错杀正确召回（AI 答"没提到"）比多给一条弱证据更伤信任；
     *     而弱证据会被下游 LLM 兜住（系统提示明确要求证据不足时说"没提到"）。 */
    const strong = new Uint8Array(N);
    const IDF_FREE_N = 3;   // 语料 ≤ 这个数时不筛信息量（频率没有统计意义）

    for (const t of new Set(qToks)) {
      const posting = this.postings.get(t);
      if (!posting) continue;
      const isUni = t.startsWith(UNIGRAM_PREFIX);
      // ★ 单字 token 贡献降权（见 UNIGRAM_WEIGHT 注释：IDF 压不住中等频率的字）
      const w = isUni ? UNIGRAM_WEIGHT : 1;
      const df = posting.size;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      const informative = !isUni && (N <= IDF_FREE_N || (df < N && df <= Math.floor(N * 0.5)));
      for (const [idx, tf] of posting) {
        const dl = this.docLen[idx] || 1;
        const denom = tf + this.k1 * (1 - this.b + this.b * (dl / this.avgdl));
        scores[idx] += w * idf * ((tf * (this.k1 + 1)) / denom);
        if (informative) strong[idx] = 1;   // 有"有信息量的词级重叠" → 够格
      }
    }

    const out = [];
    for (let i = 0; i < N; i++) {
      if (!strong[i]) continue;            // ★ 只靠单字蹭到的，直接不算命中
      let s = scores[i];
      if (s <= 0) continue;
      const d = this.docs[i];
      // 时间衰减：越晚的句子越相关（会议语境下新信息 > 旧信息），最多 +15%
      if (this.maxTs > this.minTs && d.ts > 0) {
        const rel = (d.ts - this.minTs) / (this.maxTs - this.minTs);
        s *= 1 + 0.15 * rel;
      }
      // 说话人加成：查询点名了某人 → 他说的句子 +35%
      if (speakers.has(d.name)) s *= 1.35;
      out.push({ name: d.name, text: d.text, ts: d.ts, score: Number(s.toFixed(4)) });
    }
    out.sort((a, b) => b.score - a.score);
    /* ★ 09-25 把关顺序：先靠 `strong` 掩码判资格（尺度无关，见上），
     *   再靠相对分砍掉陪跑条目（它们会挤占证据预算、把模型带偏）。
     *   HIT_SCORE_MIN 默认 0、不参与——它那份"绝对阈值"的职责已被 strong 掩码取代
     *   （原因见其注释：绝对分随语料规模漂移，不可移植）。 */
    const top = out.length ? out[0].score : 0;
    if (!top || top < HIT_SCORE_MIN) return [];
    const kept = out.filter((h) => h.score >= top * HIT_SCORE_FLOOR);
    return kept.slice(0, Math.max(1, Number(topK) || 6));
  }
}

/* ══════════════════════════════════════════════════════════════
 * 二、会话记忆（多轮对话）
 * ══════════════════════════════════════════════════════════════ */

const DEFAULT_MEMORY_TURNS = 8;

/**
 * 每个房间一份会话记忆。为什么是模块级 Map（内存）而不是落盘？
 *   会话记忆的价值在"这几分钟的连续对话"，服务重启后会议本来就没了
 *   （rooms 也是内存 Map）——落盘反而是过度设计。但**必须有界**（见下）。
 */
class ConversationMemory {
  constructor(maxTurns = DEFAULT_MEMORY_TURNS) {
    this.maxTurns = Math.max(1, Number(maxTurns) || DEFAULT_MEMORY_TURNS);
    this.turns = [];   // [{q, a, ts}]
  }

  /** 记一轮问答。答案过长时截断——历史里不需要完整的 300 字回答 */
  push(question, answer) {
    const q = String(question || '').trim();
    if (!q) return;
    this.turns.push({ q: q.slice(0, 300), a: String(answer || '').slice(0, 500), ts: Date.now() });
    // 环形上限：超出就丢最老的。**记忆有界**是可运营的前提
    while (this.turns.length > this.maxTurns) this.turns.shift();
  }

  /** 最近 n 轮（默认全部），供拼 messages */
  recent(n) {
    return n === undefined ? this.turns.slice() : this.turns.slice(-Math.max(0, Number(n) || 0));
  }

  get length() { return this.turns.length; }

  /**
   * 构造检索用的查询串：当前问题 + 上一轮的问题。
   * ▎为什么把上一轮也拼上：用户问"**那他什么时候交？**"——"他"和"交"单独检索是噪声；
   *   拼上上一轮"文档谁负责"，就能召回"文档/交付/张三"相关的字幕。
   *   这是**指代消解**的廉价近似：不做 NLP，只做"把上下文一起拿去检索"。
   */
  searchQuery(question) {
    const q = String(question || '').trim();
    const last = this.turns[this.turns.length - 1];
    // 只在"看似有指代"时才拼上一轮，避免污染正常查询
    if (last && /^(那|他|她|它|这|此|然后|所以|还有|继续|接着说)/.test(q)) {
      return `${last.q} ${q}`;
    }
    return q;
  }

  clear() { this.turns = []; }
}

/* ══════════════════════════════════════════════════════════════
 * 三、意图分类（正则的替代品）
 * ══════════════════════════════════════════════════════════════ */

/* 意图枚举 —— 只保留真正会走不同代码路径的意图（不为分类而分类）：
 *   minutes   : 要生成/查看会议纪要（动作型 → 要落盘，不能只回一句话）
 *   recap     : 要"复述/回顾"（介于纪要与会话之间，走检索+归纳，不落盘）
 *   operator  : 要 AI 去操作被控端（走授权链路）
 *   question  : 普通问答（走向量检索 + 生成）
 * 为什么"动作型"必须被单独分出来：见文件头 ③ —— 动作被误判成闲聊 = 用户以为做成了。
 */
const INTENTS = ['minutes', 'recap', 'operator', 'question'];

// 规则兜底的同义表达（无 key 时用；也是 LLM 分类失败时的降级）——比老正则宽得多
const INTENT_RULES = [
  // 操作型：动词宽一点没关系（"点一下"是口语的说法），但"帮我"必须和动作词同现，
  //   否则"帮我总结一下"会被误判成操作——那会把用户送进授权链路，代价比漏判高得多
  { intent: 'operator', re: /(^|\s)(操作|打开|点击|双击|输入|帮我操作|远程控制|去我?电脑上|在(对方|他|她)电脑)|(点一下|点下|按一下|双击|单击|敲一下|把.{0,6}(打开|关掉|点上))/ },
  { intent: 'minutes', re: /(纪要|会议记录|会议总结|总结一下|整理.*(聊|讨论|说)|整理成文|摘要|归档|记录成|会议报告|复盘文档)/ },
  { intent: 'recap', re: /(刚才|刚刚|之前|前面).{0,6}(说|讲|聊|讨论|提到|决定)/ },
];

/** 规则分类（永远可用，无网络） */
function classifyByRules(question) {
  const q = String(question || '').trim();
  for (const r of INTENT_RULES) if (r.re.test(q)) return r.intent;
  return 'question';
}

/**
 * 意图分类（双轨）。
 * 有 key → 让 LLM 分类（它见过"帮我整理下今天聊了啥"这种表述，规则很难穷举）；
 * 无 key / 失败 / 返回了不认识的标签 → 落回规则。
 * @returns {Promise<{intent:string, mock:boolean, raw?:string, ms?:number}>}
 */
async function classifyIntent(question, opts = {}) {
  const q = String(question || '').trim().slice(0, 300);
  if (!q) return { intent: 'question', mock: true };
  const ruleIntent = classifyByRules(q);

  // ★ 省钱的短路：规则**高置信度**命中动作型意图时，不必再花一次 LLM 调用。
  //   理由：动作型误判的代价极高（纪要没生成），而这两条规则的正则已经很明确；
  //   反过来，规则说"question"时并不可信（可能有规则没想到的说法）→ 才需要 LLM 兜。
  if (ruleIntent === 'minutes' || ruleIntent === 'operator') {
    return { intent: ruleIntent, mock: true, raw: 'rule-shortcut' };
  }
  if (!AI.aiEnabled()) return { intent: ruleIntent, mock: true, raw: 'rule' };

  const res = await AI.askLLM([
    {
      role: 'system',
      /* ★ 09-25 分类口径细化（真浏览器测试暴露的问题）：
       *   实测「这场会都定了什么？」被判成了 minutes → 用户问一句话，收到一个文件。
       *   根因是 minutes 的定义写得太宽（"总结/会议记录"），而中文里
       *   "……都定了什么？"这种**疑问句**很容易被划进"会议记录"那一类。
       *   判据改成看**产出物形态**，而不是看话题：
       *     minutes = 明确要"一份东西"（文档/文件/整理成文/归档）；
       *     question = 问一个**事实**（定了什么/谁负责/什么时候），即使问的正是会议内容。
       *   一句话总结给模型：**问"是什么"→ question；要"给我一份"→ minutes。** */
      content: '你是意图分类器。读用户对会议 AI 助理说的一句话，只回答一个标签，不要任何其他文字。\n'
        + 'minutes = 明确要求**产出一份文档/文件**（生成纪要、整理成文、归档、做成会议记录、导出报告）\n'
        + 'recap = 只要求**口头复述回顾**刚才讨论的内容，不要正式文档\n'
        + 'operator = 要 AI 去操作某台电脑（打开软件、点击、输入文字等）\n'
        + 'question = 问一个**具体事实**：谁说了什么、什么时候、定了什么、会议多久、有多少人、闲聊等\n'
        + '关键区分：**问"是什么/有哪些"→ question；说"给我一份/整理成文档"→ minutes。**\n'
        + '例：「这场会都定了什么？」→ question（在问事实）；「帮我整理成会议纪要」→ minutes（要文件）。',
    },
    { role: 'user', content: q },
  ], {
    label: 'ai-intent', temperature: 0, maxTokens: 10,
    mock: () => ruleIntent,              // 无 key → 直接给规则结论
  });

  const raw = String(res.text || '').toLowerCase();
  const hit = INTENTS.find((x) => raw.includes(x));
  // LLM 给了个不认识的词 → 不猜，落回规则（fail-safe 而非 fail-open）
  return { intent: hit || ruleIntent, mock: !hit || res.mock, raw: raw.slice(0, 40), ms: res.ms };
}

/* ══════════════════════════════════════════════════════════════
 * 四、行动项结构化抽取（{ owner, task, due }）
 * ══════════════════════════════════════════════════════════════ */

const SPEAKERS_IN_TEXT = /\b(我|我们)\b|咱们/;

/**
 * 规则版行动项抽取（无 key 时用；也是 LLM 轨的兜底）。
 *
 * ▎诚实说明它的上限：规则**不可能**做好这事——"文档我负责" 里"我"是谁要靠上文（说话人），
 *   "下周一" 要换算成日期，这些规则做得粗糙。所以：
 *   - 提取不到负责人 → owner 留 ''（前端显示"待认领"），**不编造**；
 *   - 期限只做**相对词 → 原词**的保留（"下周一" 就写"下周一"），不瞎换算成具体日期；
 *   - 任务文本做**指代替换**（把"我负责"→ 说话人名 + "负责"），这是规则能可靠做到的少数事。
 *
 * ★ 09-24e 实修（单测揪出的两处规则缺陷，都出自"正则贪婪"）：
 *   ① `压测报告我负责` 被 `([\u4e00-\u9fff]{2,6})(?:负责…)` 抓成 owner="压测报告我" ——
 *      因为贪婪的 {2,6} 把"压测报告我"整个吃进去了。修法：**先处理"我/我们"指代**，
 *      再考虑用正则抓显式人名，且人名段用非贪婪 {1,3} 并排除动词/名词尾（见下）。
 *   ② `我们需要跟进` 被判成 owner="我们需要" —— 同理，"我们"是集体主语不是责任人。
 *      修法：候选 owner 落在集体词表里就丢弃；且**先**做集体词排除。
 */
function extractActionsByRules(entries) {
  const list = Array.isArray(entries) ? entries : [];
  // 触发词：比老的 todoRe 更聚焦"任务分配"句式，减少误报
  const trigger = /(需要|记得|别忘|下周|明天|下周[一二三四五六日天]|本周|今天|之前|一定要|尽快|负责|跟进|安排|交付|完成|提交|轮换|核对|确认|落实)/;
  // 显式负责人："由张三负责" / "李四跟进"
  // ★ 09-24e 实修②：`我们需要跟进` 曾被抓成 owner="们需要"——因为中文没有词边界，
  //   `[\u4e00-\u9fff]{2,3}` 从"们"开始切了。修法：用 **JS 支持的 lookbehind** 要求
  //   名字左边不是汉字（(?<![\u4e00-\u9fff])），这样只能从词首开始匹配 → 抓到的是"我们"，
  //   随后被下方 NOT_OWNER 集体词表拦掉。这是"用正则近似中文词边界"的标准手法。
  const ownerPat = /(?:由|叫|让)(?<![\u4e00-\u9fff])([\u4e00-\u9fff]{2,3})(?:来|去)?(?:负责|跟进|处理|完成|落实|对接)|(?<![\u4e00-\u9fff])([\u4e00-\u9fff]{2,3})(?:负责|跟进|落实|对接)(?![，。；])/;
  const duePat = /(下周[一二三四五六日天]|下个?周|本周[一二三四五六日天]?|这周|明天|后天|今天|下个?月|周[一二三四五六日天]|月底|周末|\d+\s*(?:月|日)|\d{1,2}\/\d{1,2})/;
  // 绝不能被当成负责人的词（集体主语 / 常见名词尾 / 时间词）
  const NOT_OWNER = /^(我们|咱们|大家|团队|各位|所有人|每个|需求|文档|报告|功能|问题|事项|任务|计划|这个|那个|一下|时候|内容|工作|进度|人员|下周|明天|今天)/;
  const out = [];
  for (const e of list.slice(-120)) {
    const text = String((e && e.text) || '').trim();
    if (!text || !trigger.test(text)) continue;
    const dueM = text.match(duePat);
    const speaker = String((e && e.name) || '');

    // ★ 判定顺序（顺序即语义，改这里要想清楚）：
    //   1. 说话人自己认领（"我负责/我来/我这边…"）→ owner = 说话人，最可靠；
    //   2. 句中显式点名（"由张三负责"/"李四跟进"）→ 用名字；
    //   3. 都没有 → 留空（待认领），绝不瞎猜
    let owner = '';
    if (/(?:^|[，。；、\s])(?:我|咱|本人)(?:来|去)?(?:负责|跟进|处理|落实|完成|对接|做|写|搞)|我(?:来|去)?(?:负责|跟进|处理|落实|完成|对接)/.test(text)
      || /(我这边|我们这边)(?:先|来)?/.test(text)) {
      owner = speaker;
    } else {
      const m = text.match(ownerPat);
      const cand = (m && (m[1] || m[2])) || '';
      if (cand && !NOT_OWNER.test(cand)) owner = cand;
    }
    // 集体主语永不作为责任人（"我们负责"→ 空，语义上"大家的事"没有单一责任人）
    if (owner && /^(我们|咱们|大家|团队|各位)$/.test(owner)) owner = '';

    out.push({
      owner,
      task: text.slice(0, 120),
      due: dueM ? dueM[1] : '',
      source: speaker,
      ts: Number((e && e.ts) || 0),
    });
    if (out.length >= 12) break;
  }
  return out;
}

/**
 * 行动项抽取（双轨）。
 * LLM 轨让它直接吐 JSON 数组——结构化输出是模型的强项，且能理解指代与合并重复项。
 * @returns {Promise<{actions:Array, mock:boolean}>}
 */
async function extractActions(entries, opts = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const rule = extractActionsByRules(list);
  if (!list.length) return { actions: [], mock: true, reason: 'no-entries' };

  // 字幕条数太少时（几条），规则足够且更省钱——不必惊动 LLM
  if (list.length < 4 || !AI.aiEnabled()) return { actions: rule, mock: true, reason: 'rules' };

  const transcript = list.slice(-150).map((e) => `${e.name}: ${e.text}`).join('\n');
  const res = await AI.askLLM([
    {
      role: 'system',
      content: '你是会议纪要助手。从会议字幕中抽取**行动项**（需要有人去做的具体事项）。'
        + '只输出 JSON 数组，每项 {"owner":"负责人（字幕里能确定的才填，否则空串）","task":"具体要做什么","due":"期限原词（如 下周一，没有就空串）"}。'
        + '合并重复项，最多 10 条。不要编造字幕里没有的负责人或期限。没有任何行动项就输出 []。',
    },
    { role: 'user', content: `会议字幕：\n${transcript}` },
  ], {
    label: 'ai-actions', temperature: 0.1, maxTokens: 600, json: true,
    mock: () => JSON.stringify(rule.map((a) => ({ owner: a.owner, task: a.task, due: a.due }))),
  });

  if (res.mock) return { actions: rule, mock: true, reason: res.reason || 'llm-failed' };
  try {
    const parsed = JSON.parse(res.text);
    if (!Array.isArray(parsed)) throw new Error('不是数组');
    const actions = parsed
      .filter((a) => a && typeof a === 'object' && String(a.task || '').trim())
      .slice(0, 10)
      .map((a) => ({
        owner: String(a.owner || '').trim().slice(0, 20),
        task: String(a.task || '').trim().slice(0, 160),
        due: String(a.due || '').trim().slice(0, 20),
        source: 'LLM',
        ts: 0,
      }));
    return { actions, mock: false };
  } catch (e) {
    // LLM 吐了坏 JSON → 用规则结果，**不把坏数据交给调用方**
    return { actions: rule, mock: true, reason: 'bad-json' };
  }
}

/** 把行动项渲染成 markdown 清单（owner/due 缺失时用占位符，不隐藏缺失） */
function renderActions(actions) {
  const list = Array.isArray(actions) ? actions : [];
  if (!list.length) return '- （未识别到明确的行动项）';
  return list.map((a) => {
    const who = a.owner ? a.owner : '待认领';
    const when = a.due ? `（${a.due}）` : '';
    return `- [ ] **${who}**：${a.task}${when}`;
  }).join('\n');
}

/* ══════════════════════════════════════════════════════════════
 * 五、上下文构造（把检索结果拼成给模型的证据块）
 * ══════════════════════════════════════════════════════════════ */

/**
 * 用检索结果构造"证据块"——这是 RAG 的 R（Retrieve）到 G（Generate）的桥。
 *
 * ▎为什么要明确标注"证据 X"：模型的幻觉多半来自"上下文里没有，但它想答"。
 *   把材料编号并明确写"只依据以下证据"，同时允许它说"没提到"，
 *   比任何 prompt 技巧都更能压住编造（配合 low temperature）。
 * @returns {{block:string, hits:Array, usedHits:number}}
 */
function buildEvidenceBlock(hits, opts = {}) {
  const list = Array.isArray(hits) ? hits : [];
  if (!list.length) return { block: '（检索：没有找到相关会议内容）', hits: [], usedHits: 0 };
  const maxChars = Number(opts.maxChars) || 1800;   // 证据也要有预算——不是越多越好
  const lines = [];
  let used = 0;
  let chars = 0;
  for (const [i, h] of list.entries()) {
    const t = `【证据${i + 1}】${h.name}：${h.text}`;
    if (chars + t.length > maxChars) break;
    lines.push(t);
    chars += t.length;
    used++;
  }
  return { block: lines.join('\n'), hits: list, usedHits: used };
}

/* ══════════════════════════════════════════════════════════════
 * 六、房间级智能体（把上面五件事装配起来）
 * ══════════════════════════════════════════════════════════════ */

/**
 * 每房间一个智能体 = 一份会话记忆 + 一个按需重建的检索器。
 * ▎为什么检索器要"按需重建"：字幕是**持续增长**的（会议在进行），
 *   索引必须跟着更新。策略：记录建索引时的条目数，条目数变了就重建。
 *   重建成本：几千条的 bigram 索引约几毫秒——远低于一次 LLM 调用，
 *   所以"每次有新增就重建"的朴素策略完全够用（**不做增量索引的过度设计**）。
 */
class RoomBrain {
  /**
   * @param {number} maxTurns 会话记忆轮数上限
   * @param {Object} [opts]
   * @param {number} [opts.since] 检索证据的**时间下界**（ms），语义 = "本场会议开始时刻"。
   *   0 = 不限（处理历史档案）。
   */
  constructor(maxTurns, opts = {}) {
    this.memory = new ConversationMemory(maxTurns);
    this.since = Number(opts.since) || 0;
    this._retriever = null;
    this._indexedCount = -1;
  }

  /**
   * 会议范围：只检索**本场会议**产生的字幕。
   *
   * ══ 这条边界改过一次，两版的设计意图都留在这里（值得看）══
   *
   * ▎第一版（09-25 上午）：边界 = **助理入会时刻**，动机是"参会语义"——
   *   助理只该拿它"亲耳听到的"作答，听起来很正当。
   *
   * ▎第一版为什么被推翻（**真浏览器测试当场暴露**）：
   *   测试里 AI 入会后立刻问「这场会都定了什么？」，它答"会议里没提到"——
   *   因为所有会议内容都产生在它入会之前。这不是 bug，是**设计本身错了**：
   *   现实中助理几乎总是**中途被请进来**的（会开了一半，有人想起"叫个 AI 来记"），
   *   而它一入会就对之前那半小时一无所知 → **一请来就是个废人**。
   *   一个"来得晚就什么都不知道"的助理，比没有助理更让人失望。
   *
   * ▎重新定位真正的风险：
   *   当初要防的**不是**"本场会早期的内容"，而是**房间号回收复用**——
   *   房间销毁后 6 位号码会被下一次建房复用（号码空间只有 10^6），
   *   若不设下界，新一场会的助理会把**上一场会**的字幕当成本场证据答出来（跨会议串味）。
   *   所以正确的边界是**会议场次**，不是"助理何时到场"。
   *
   * ▎现在：下界 = 房间创建时刻（= 本场会议开始）。两个目标同时达成：
   *   · 中途入会照样能答全本场内容 → 助理真的有用；
   *   · 上一场会（号码复用）的记录被挡在界外 → 串味依然被根治。
   *   而且这两点是**结构上成立**的，不靠"努力对齐"。
   *
   * ▎为什么不做"范围内为空就退回全档"的兜底：初版加过，它把整个机制废掉了
   *   （只要范围内暂时没内容，过滤就无条件失效，等于没过滤）。
   *   范围就是范围——答不上来就诚实说答不上来，这是"宁可留空不可编造"在检索层的同一条原则。
   */
  scopeEntries(entries) {
    const list = Array.isArray(entries) ? entries : [];
    if (!this.since) return list;                 // 未设下界 = 历史档案模式（导出/离线总结等）
    return list.filter((e) => (e.ts || 0) >= this.since);
  }

  /** 拿到与当前字幕同步的检索器（数量没变就复用，避免重复建索引） */
  retriever(entries) {
    const list = this.scopeEntries(entries);
    if (!this._retriever || list.length !== this._indexedCount) {
      this._retriever = new Retriever(list);
      this._indexedCount = list.length;
    }
    return this._retriever;
  }

  /**
   * 端到端回答一个问题（检索 → 拼上下文 → 生成）。
   * @param {string} question
   * @param {Array} entries 全量字幕条目（调用方给，本类不碰 IO）
   * @param {Object} opts { topK, onDelta, extraContext, systemExtra }
   * @returns {Promise<{text,mock,usage,ms,hits,usedHits,turns}>}
   */
  async answer(question, entries, opts = {}) {
    const q = String(question || '').trim();
    const r = this.retriever(entries);
    // 检索查询串：考虑指代（把上一轮问题一起检索）
    const searchQ = this.memory.searchQuery(q);
    const hits = r.search(searchQ, Number(opts.topK) || 6);
    const ev = buildEvidenceBlock(hits, { maxChars: opts.maxChars });

    const sys = [
      '你是这场会议的 AI 助理，以参会者身份在场。',
      '回答**只能依据**下面给出的材料：',
      '  ①【证据】= 会议字幕的检索结果；',
      '  ②【本场会议已抽取的…】= 系统已结构化整理好的清单（决定 / 行动项 / 风险）。',
      '当问题问的是"定了什么/有哪些待办/有什么风险"这类**清单型问题**时，',
      '  以 ② 为准并**完整列出**（不要只挑一条），因为它是已抽取的全量；',
      '如果两类材料都不足以回答，明确说"会议里没提到"，**绝不编造**。',
      '用简短中文回答，不超过 150 字。',
      opts.systemExtra || '',
    ].filter(Boolean).join('\n');

    // 把多轮记忆拼成 messages（这是"追问不失忆"的落地点）
    const messages = [{ role: 'system', content: sys }];
    for (const t of this.memory.recent(-1)) {
      messages.push({ role: 'user', content: t.q });
      messages.push({ role: 'assistant', content: t.a });
    }
    messages.push({
      role: 'user',
      content: (opts.extraContext ? opts.extraContext + '\n\n' : '')
        + `【证据】（按相关度排序，共 ${ev.usedHits} 条命中）\n${ev.block}\n\n成员提问：${q}`,
    });

    const mockAnswer = () => {
      if (!hits.length) return '会议里没有提到相关内容（我检索了全部字幕，没有相关记录）。';
      // 规则兜底：直接把最相关的两条读出来——**不做归纳，但绝不编造**
      return '根据会议记录：' + hits.slice(0, 2).map((h) => `${h.name}提到"${h.text.slice(0, 60)}"`).join('；');
    };

    const res = opts.onDelta
      ? await AI.streamLLM(messages, { label: 'ai-answer', temperature: 0.25, timeoutMs: 20000, maxTokens: 400, mock: mockAnswer }, opts.onDelta)
      : await AI.askLLM(messages, { label: 'ai-answer', temperature: 0.25, timeoutMs: 15000, maxTokens: 400, mock: mockAnswer });

    /* ★ 09-24e 实修：这里原先漏了 `memory.push` —— 单测「问答后记忆里有一轮」直接失败。
     *   后果比想象严重：Memory 类本身写对了（有界、指代拼串都对），但**从来没人往里写**，
     *   于是"追问不失忆"这个卖点整体是死的——下一轮 messages 里历史永远为空。
     *   这类"模块写好了但没接线"是最隐蔽的缺陷：单测模块过、单测调用方过（如果只测返回值），
     *   只有把两者放一起测（本单测第六部分）才会暴露。教训：**集成点必须被断言覆盖**。 */
    this.memory.push(q, res.text);

    return {
      text: res.text, mock: res.mock, usage: res.usage, ms: res.ms, reason: res.reason,
      hits: hits.map((h) => ({ name: h.name, text: h.text.slice(0, 80), score: h.score })),
      usedHits: ev.usedHits,
      totalDocs: r.size,
      /* ★ 09-25：把"检索范围"一并交出去——前端据此在证据链里写「本场会议 N 条 / 全档 M 条」。
       *   为什么不只在服务端日志里记：这个范围直接影响答案该怎么被信任
       *   （"我只查了本场会议"和"我翻了历史所有记录"是两种不同强度的结论），
       *   用户有权知道。跟 hits/turns 一样，属于"可验证性"的一部分。 */
      scoped: !!this.since,
      allDocs: Array.isArray(entries) ? entries.length : r.size,
      turns: this.memory.length,
    };
  }
}

module.exports = {
  tokenize,
  expandQuerySynonyms,     // ★ 09-25：导出以便单测直接验证"查询扩展"这一步
  SYNONYM_GROUPS,
  /* 检索调参相关的常量也导出：单测要能断言"阈值的量级是合理的"，
   * 而不是只能黑盒地跑几个查询看结果（那样改坏了也不知道）。 */
  HIT_SCORE_MIN,
  HIT_SCORE_FLOOR,
  USE_UNIGRAM,
  Retriever,
  ConversationMemory,
  RoomBrain,
  classifyIntent,
  classifyByRules,
  extractActions,
  extractActionsByRules,
  renderActions,
  buildEvidenceBlock,
  INTENTS,
};
