/**
 * ★ 09-25 AI 实时会议看板（Live Digest）——零依赖、纯逻辑、可单测
 *
 * ══ 解决什么问题 ══
 * 在此之前，AI 助手的智能是"**被动**"的：你不问，它一个字不说。
 * 它虽说"作为参会者入会了"，但整场会下来它对会议内容毫无贡献——
 * 更像一个坐在角落、你戳一下才答一句的记录员。
 *
 * 本模块让它**边听边消化**：字幕持续流入 → 实时抽出四类结构化信息 → 汇成一块
 * 「会议看板」。会议进行中任何人在侧栏都能看到：
 *   · 🎯 决定（就这么定了 / 通过 / 敲定）—— 会后最容易扯皮的"我们到底定了啥"
 *   · ⚠️ 风险（来不及 / 阻塞 / 不确定）—— 最该被及时看见却最容易漏掉
 *   · ✅ 行动项（谁 / 做什么 / 何时）—— 待认领的会被高亮
 *   · 💬 议题（接下来聊什么）—— 会议走到哪了
 *
 * ══ 为什么用规则而不是 LLM ══
 * 三条硬理由，都不是"省钱"：
 *   ① **实时性**：字幕是流式进来的，每来几条就要更新看板。LLM 单次 2~5 秒，
 *      一场会几百条字幕 = 几百次调用 = 既慢又贵，看板永远滞后于会议。
 *      规则是毫秒级，看板能跟着会议实时走。
 *   ② **可解释**：用户点开一条能看到"它是因为哪句话被判成风险的"（原文照录），
 *      不会出现"AI 说这是个风险但它不告诉我为什么"的黑箱。
 *   ③ **不编造**：规则**只从原文里挑句子**，不做任何改写——所以看板里的每一条
 *      都必然是会上真说过的原话。这对"会议纪要类产品"是底线：
 *      看板可以漏（宁可漏，不可编），由 AI 问答/纪要去做深度归纳。
 *
 * ══ 与 brain.js 的分工（两者不是重复）══
 *   brain.js  = **问答题**：按需检索 + 归纳，深但不实时；
 *   digest.js = **看板**：持续抽取 + 原样呈现，实时但不归纳。
 *   一个负责"帮我总结一下"，一个负责"现在会上正在发生什么"。两者互补。
 */
'use strict';

const Brain = require('./brain');

/* ── 判定规则：尽量**只匹配明确的表述**，宁缺毋滥。
 *   一条误报（把闲聊当风险）比一条漏报更伤信任——用户一旦发现看板在胡说，
 *   就再也不会看它了，那么整个模块的价值归零。 */
/* ★ "定在 / 就按" 这一组是**真浏览器截图暴露出来后补的**：
 *   截图里「先说结论：交付时间定在 11 月 20 日，这个日期不能再动了」被归到了
 *   **行动项**（还挂了"待认领"）——因为它含"交付"，命中了 TODO_HINT 的动作词闸门，
 *   而 DECISION_RE 当时只认"定了/就这么定"这类说法，认不出"定在"。
 *   这类句子在会议里**极常见**（把某个日期/数字/方案"定下来"就是决定本身），
 *   归错栏目会让"决定"栏缺条目、同时"行动项"栏多出一条无主任务——
 *   用户看到"待认领"会真的去找人认领一件根本不需要人做的事实陈述。
 *
 * ⚠️ 但"定在"绝不能裸写：中文没有词边界，实测 "服务器**固定在**线" 里
 *   "定在"被跨词命中，一句普通描述被判成了决定（这就是 AGENTS 坑 42 的同类问题）。
 *   所以「定在」后面**必须紧跟一个时间/数值**才认（定在 11 月 / 定在下周 / 定在 3 号），
 *   靠这个 lookahead 把"固定在线""不一定在"这类假阳性挡掉。
 *   「定下来」同理加一个"前面不是固"的 lookbehind。 */
const DECISION_RE = /(就这么定|那就定|确定下来|(?<!固)定了|定在\s*(?:\d|[一二三四五六七八九十两]|下周|本周|这周|明天|今天|月底|周末)|(?<!固)定下来|就按|按这个|照这个|敲定|拍板|一致同意|都同意|采用这个|采用[了A-Za-z]|结论是|最终方案|没问题就这么|就这么办|决定了)/;
const RISK_RE = /(风险|担心|来不及|赶不上|阻塞|卡住|卡在|可能有问题|有问题|时间紧|紧张|不确定|待定|存疑|需要确认|不敢保证|有隐患|坑)/;
/* 议题：**"议题/话题"这类词本身就足够明确**，不必要求"下一个议题"整句——
 *   实测发现"第 3 个议题是…"、"这个议题先放着"这类说法会被漏掉（初版要求整短语），
 *   而漏掉议题的代价是看板看不出"会议走到哪了"，正是这个栏目存在的意义。
 *   词义够窄，放宽到裸词不会引入闲聊误报。 */
const TOPIC_RE = /(议题|话题|下一个|接下来聊|接下来讨论|接下来看|我们再聊|聊聊|讨论一下|议程|要解决的是|重点是|先说结论|先说一下)/;

/* 疑问句 → 也算"议题"（会上有人在问，说明这是个待解决的点）。
 * 单独拎出来是因为它的判据是**句式**而非关键词，跟上面的词表逻辑不同。 */
const QUESTION_RE = /[?？]\s*$|^(为什么|怎么|如何|能不能|可不可以|要不要|是不是|有没有|谁|哪一?个)/;

/* ★ 行动项的**前置闸门**（实测踩坑后补的）：
 *   brain 的 extractActionsByRules 里有个很宽的 trigger（含裸的 `今天`/`明天`/`本周`），
 *   那是为**纪要**服务的——纪要宁可多抽，人工复核时删掉就行。
 *   但看板是**实时呈现**的，误报的代价完全不同：实测中 "今天天气不错" 被抽成了
 *   行动项（就因为句中有"今天"），还带上 due="今天"。一条这样的条目出现在看板里，
 *   用户立刻会认定"这 AI 在瞎猜"，整个看板就没人看了。
 *   所以看板在这里收一道窄门：**必须有明确的动作意图词**才进入行动项判定。
 *   （两个功能对同一句话结论不同是**有意为之**：纪要=高召回待人复核，
 *     看板=高精度直面用户。同一套判据服务不了两种截然不同的消费方式。） */
const TODO_HINT_RE = /(记得|别忘|@|需要|负责|跟进|落实|安排|尽快|一定要|务必|之前(完成|提交|搞定|交付)|轮换|核对|提交|交付|完成一?下|对接|上线|补一下|整理一下)/;

const KINDS = ['decision', 'risk', 'todo', 'topic'];
const KIND_META = {
  decision: { icon: '🎯', label: '决定' },
  risk: { icon: '⚠️', label: '风险' },
  todo: { icon: '✅', label: '行动项' },
  topic: { icon: '💬', label: '议题' },
};

/** 归一化：去掉空白/标点，用于**去重**（同一句话被反复说只记一次）。 */
function normText(t) {
  return String(t || '')
    .replace(/\s+/g, '')
    .replace(/[，。！？、；：""''（）,.!?;:()"'\-—…~]/g, '')
    .toLowerCase()
    .slice(0, 120);
}

/* ══════════════════════════════════════════════════════════════
 * 七、看板 → 问答：让 AI 消费自己整理出来的结构化事实
 *
 * ▎为什么需要这一步（真浏览器测试暴露的"答不全"）：
 *   用户点「这场会都定了什么？」，AI 答"只提到采用 A 方案"——但看板上明明有两条决定
 *   （A 方案 + 交付时间 11 月 20 日）。原因是那句话太宽泛，BM25 只在字幕里捞到了
 *   匹配度最高的那条，**另一条决定就漏了**。
 *   这类问题的正确答案本来就不该靠"检索运气"——**决定/待办/风险本来就是被结构化抽出来的**，
 *   直接把它们作为证据交给模型，答案才是**完整**的。
 *
 * ▎这也是一个漂亮的闭环：digest 抽出来的结构 → 既渲染成人看的看板 →
 *   又回喂给 AI 做证据。一份抽取，两种消费，且**用户看到的和 AI 用的是同一份数据**
 *   （所以他不会遇到"看板上有、问 AI 却说没有"这种最伤信任的不一致）。
 * ══════════════════════════════════════════════════════════════ */

/** 问题 → 想看哪一类看板信息（可多类；都不像就返回空数组 = 走常规检索） */
const BOARD_PROBES = [
  { key: 'decision', re: /(定了什么|都定了|定下|决定|结论|拍板|敲定|通过了什么|达成)/ },
  { key: 'todo', re: /(待办|行动项|要做|要做的|谁负责|谁来做|任务|安排|认领|todo)/i },
  { key: 'risk', re: /(风险|隐患|问题点|担心|阻塞|卡在哪)/ },
];
function probeBoard(question) {
  const q = String(question || '');
  return BOARD_PROBES.filter((p) => p.re.test(q)).map((p) => p.key);
}

/**
 * 把看板某一类的条目渲染成给模型的**结构化证据**。
 * ▎行动项列出 owner/due：因为"谁负责、什么时候交"正是这类问题的答案本体，
 *   而看板里这三项已经抽好了（不必让模型再从原话里猜）。
 */
function renderBoardEvidence(items, kind) {
  const list = Array.isArray(items) ? items : [];
  const label = (KIND_META[kind] || {}).label || kind;
  if (!list.length) return `【本场会议已抽取的${label}】目前为空。`;
  const lines = [`【本场会议已抽取的${label}】（按时间顺序，来自会议看板的结构化抽取）`];
  for (const it of list) {
    if (kind === 'todo') {
      lines.push(`- 负责人：${it.owner || '（未指定，待认领）'} ｜ 事项：${it.task || it.text} ｜ 期限：${it.due || '（未提及）'}`);
    } else {
      lines.push(`- ${it.name}：${it.text}`);
    }
  }
  return lines.join('\n');
}

class Digest {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.maxPerKind=20] 每类保留条数上限（有界，防长会内存涨）
   * @param {number} [opts.minLen=4] 太短的句子不判（"好" / "嗯" / "对" 之类是噪声）
   */
  constructor(opts = {}) {
    this.maxPerKind = Number(opts.maxPerKind) || 20;
    this.minLen = Number(opts.minLen) || 4;
    /** @type {{decision:Array,risk:Array,todo:Array,topic:Array}} */
    this.items = { decision: [], risk: [], todo: [], topic: [] };
    this._seen = new Set();       // normText 去重集合（跨类共享：同一句只入一类）
    this._seenCut = 400;          // 去重集合上限（超出清一半，避免无限增长）
    this.total = 0;               // 消化过的字幕条数（看板角标用）
  }

  /** 单条字幕 → 判定它属于哪一类（按优先级：决定 > 风险 > 行动项 > 议题）。
   *  ▎为什么要优先级而不是"能命中几类就记几类"：
   *   一句话通常只有一个主要身份（"这个必须周五交付，来不及了"既是行动项又是风险，
   *   但它在看板里应该只出现在一处，否则同一条信息在四个栏目里重复出现，看板就废了）。
   *   决定放最前，因为它是会后最重要的存档；风险次之，因为时效性最强。
   * @param {string} text 字幕原文
   * @param {string} [speaker] 说话人昵称。**必须传**——行动项的负责人抽取依赖它：
   *   "压测报告我负责" 这句里"我"=说话人，不传 speaker 就永远抽不到负责人。
   *   （实测踩坑：初版为省一次参数传递传了空串，结果所有"我来负责"型行动项负责人全是空。）
   * @returns {{kind:string|null, act:Object|null}} act = 行动项三元组（命中 todo 时）
   */
  classify(text, speaker) {
    const t = String(text || '');
    if (t.trim().length < this.minLen) return { kind: null, act: null };
    if (DECISION_RE.test(t)) return { kind: 'decision', act: null };
    if (RISK_RE.test(t)) return { kind: 'risk', act: null };
    /* 行动项：先过**窄门**（必须有动作意图词），再看 brain 的抽取器是否认。
     * 抽出来的三元组**一起带走**，避免下面再抽一次（同一句话抽两遍纯属浪费）。 */
    if (TODO_HINT_RE.test(t)) {
      const acts = Brain.extractActionsByRules([{ name: String(speaker || ''), text: t, ts: 0 }]);
      if (acts.length) return { kind: 'todo', act: acts[0] };
    }
    if (TOPIC_RE.test(t) || QUESTION_RE.test(t)) return { kind: 'topic', act: null };
    return { kind: null, act: null };
  }

  /**
   * 消化一批字幕，返回**本次新增**的条目（用于增量广播，不是全量重发）。
   * @param {Array<{ts:number,name:string,text:string,from?:string}>} entries
   * @returns {{added:Object, addedCount:number, total:number}}
   */
  ingest(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const added = { decision: [], risk: [], todo: [], topic: [] };
    let addedCount = 0;

    for (const e of list) {
      const text = String((e && e.text) || '').trim();
      if (!text) continue;
      this.total++;
      const speaker = String((e.name || e.from || '')).slice(0, 32);
      const { kind, act } = this.classify(text, speaker);
      if (!kind) continue;

      const norm = normText(text);                          // 只算一次（下面要用好几回）
      if (this._seen.has(kind + '|' + norm)) continue;       // 同类已记过
      /* 也检查"同一句话被判成别的类"——避免同一句在两个栏目各出现一次。 */
      if (KINDS.some((k) => k !== kind && this._seen.has(k + '|' + norm))) continue;
      this._seen.add(kind + '|' + norm);

      const item = {
        ts: Number(e.ts) || Date.now(),
        name: speaker || '成员',
        text: text.slice(0, 200),              // ★ 原文照录，不改写（看板不编造）
        kind,
      };
      // 行动项带上结构化三元组（与纪要共用同一套抽取结果，见 classify 注释）
      if (kind === 'todo') {
        item.owner = (act && act.owner) || '';
        item.task = (act && act.task) || text;
        item.due = (act && act.due) || '';
      }
      const bucket = this.items[kind];
      bucket.push(item);
      // 有界：超出丢最老的
      while (bucket.length > this.maxPerKind) bucket.shift();
      added[kind].push(item);
      addedCount++;
    }

    // 去重集合自身也要有界（长会几小时会累积上千条）
    if (this._seen.size > this._seenCut) {
      const keep = [...this._seen].slice(-Math.floor(this._seenCut / 2));
      this._seen = new Set(keep);
    }

    return { added, addedCount, total: this.total };
  }

  /** 看板快照（广播给前端 / 供 AI 主动发言时引用） */
  snapshot() {
    const counts = {};
    for (const k of KINDS) counts[k] = this.items[k].length;
    return {
      counts,
      // 各类都按时间倒序（最新在上）——看板关心"现在"，不关心"最开始"
      items: {
        decision: [...this.items.decision].reverse(),
        risk: [...this.items.risk].reverse(),
        todo: [...this.items.todo].reverse(),
        topic: [...this.items.topic].reverse(),
      },
      total: this.total,
    };
  }

  /** 还没人认领的行动项（AI 主动提醒的原料） */
  unclaimedTodos() {
    return this.items.todo.filter((t) => !t.owner);
  }

  reset() {
    for (const k of KINDS) this.items[k] = [];
    this._seen.clear();
    this.total = 0;
  }
}

module.exports = { Digest, KINDS, KIND_META, normText, probeBoard, renderBoardEvidence };
