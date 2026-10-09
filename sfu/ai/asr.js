/* ══════════════════════════════════════════════════════════════
 * sfu/ai/asr.js —— 语音识别（ASR）唯一实现层 ★ 09-28
 *
 * ▎为什么要有这个文件？（与 password.js 同一条教训）
 *   whisper 的"探测"与"转写"原先只写在 sfu/server.js 里，结果出现两个真 bug：
 *     ① 探测用 `whisper --help` 判存活，而 **Windows 中文控制台下 whisper 打印帮助会
 *        UnicodeEncodeError 崩掉 → 退出码 1** → 服务器认定"没装 whisper" →
 *        asrEnabled=false → 前端退回浏览器 Web Speech（用户实测："还是在用浏览器的"）。
 *     ② 兜底候选 '__py__' 用的是 `process.execPath`（= node.exe）配 `-m whisper`——
 *        那是把 node 当 python 用，**永远不可能成功**。
 *   把逻辑抽成模块后：服务器、自测脚本、将来的 CLI 共用同一份实现，
 *   编码环境（PYTHONIOENCODING=utf-8）与参数拼装只写一遍，改一处即全局生效。
 *
 * ▎三条设计纪律：
 *   1) **所有 whisper 子进程都带 UTF-8 环境**——不然中文输出/帮助文本会把它打崩；
 *   2) **探测只看"能不能跑通 --help 且退出码 0"**，不猜路径、不解析版本号；
 *   3) **形态白名单**（同 Mimosa 安全加固）：只接受"名叫 whisper 的可执行文件"或
 *      "python/python3/py -m whisper"两种形态，其余一律拒绝，防止配置投毒。
 * ══════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

/* ── 1. 参数与环境 ─────────────────────────────────────────────
 * ▎模型：默认 **small**（09-29 定档：常驻 worker 下每段只多约 2s——实测 4s 语音
 *   tiny 0.8s / small 3.0s 纯转写，但"产品评审会"tiny 转成"平省会"、small 全对；
 *   准确率差距是用户可感知的，2s 的差距不是）。要更快/更省内存用 WHISPER_MODEL=tiny。
 * ▎分段：5s（越小越灵敏、越大上下文越完整）。两者都可用环境变量覆盖。 */
const DEFAULT_MODEL = process.env.WHISPER_MODEL || 'small'; // ★ 09-27d：tiny 中文常出繁体/错字，small 准确率显著更高（模型 466MB 自动缓存）
const DEFAULT_SEGMENT_SEC = Math.max(3, Math.min(15, Number(process.env.ASR_SEGMENT_SEC) || 4));

/* ▎UTF-8 是硬要求，不是优化：Windows 默认 GBK 控制台下，whisper 打印帮助/进度里的
 *   非 GBK 字符会抛 UnicodeEncodeError（已实测复现）——探测直接失败、转写输出也可能
 *   中断。psycopg 式的"设个环境变量就好了"的坑，写在这里一次解决。 */
const PY_ENV = Object.freeze({ ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' });

/* ▎★ 2026-10-06 夜二 唤醒判据从"像不像名字"改成"是不是在叫它"（用户原话：
 *   「这是一个正常的会议，如果不提到小明的名字，小明不应该说话」）。
 * ▎现场证据（sfu/captions/cap-286716-20261006.jsonl，21 条麦克风转写）：
 *   真正提到名字的只有 4 条，而 AI 答了 **18 次**——「拍卖啊！」「咳咳。」「爱丽。」
 *   「你把手机放了吧」全被接话。三条成因，本文件负责其中两条：
 *     ① 旧表 `[小晓笑孝筱][明鸣名铭茗米民密蜜命]` 把 **小命 / 小米 / 小民 / 小密**
 *        一视同仁当叫它。而这几个在日常中文里是**词**（救命、小米手机、小民、密码），
 *        本场的「说小命的话，他是最应该听见话」就是这么被唤醒的。
 *     ② 一句 40 字的合并字幕里只要**任何一个字**含名字，整段 blob 都成了提问。
 *        （那一条由 server 的"说完一句就换句"修，见 Asr.startsNewSentence。）
 * ▎分层判据：**强后缀**（明/鸣/名/铭/茗）在中文里几乎不构成常用词，出现在句中
 *   就是叫它；**歧义后缀**（米/民/密/蜜/命）只在**称呼语境**里才算
 *   （「你好 小米」是 10-05 实测过的真实误听，必须继续接得住；「小米」单独出现不算）。
 * ▎名字表本身仍是唯一来源：`WAKE_RE` 只回答"它长什么样"（抹名字 / 与浏览器那一轨对表），
 *   `shouldWake` 才回答"这句该不该接"。 */
const WAKE_HEAD = '小晓笑孝筱';
const WAKE_TAIL_STRONG = '明鸣名铭茗';
const WAKE_TAIL_AMBIG = '米民密蜜命';
const WAKE_RE = new RegExp(`[${WAKE_HEAD}][${WAKE_TAIL_STRONG}${WAKE_TAIL_AMBIG}]`);
const WAKE_STRONG_RE = new RegExp(`[${WAKE_HEAD}][${WAKE_TAIL_STRONG}]`);
const WAKE_AMBIG_RE = new RegExp(`[${WAKE_HEAD}][${WAKE_TAIL_AMBIG}]`);
/* 称呼语境：一句话里出现这些，说明说话的人正在**对着某个对象**说话，
 * 此时 小米/小命 这类歧义写法才按"叫它"处理。宁可窄，不要宽——
 * 误唤醒（AI 插一句不相干的话）在正常会议里比漏唤醒烦人得多。 */
/* ▸ 词表第一版被真实账本打回来过一次：里面收了裸「在不」，于是
 *   「叫啥？别人的哥哥。 李然讲的：“如果**在不**不。” 说小命的话…」误醒——
 *   中文没有词边界，两个字的 token 一定会跨词命中（坑 49 的第三次应验）。
 *   现在只收**多字且几乎不会跨词**的说法（在吗/在不在，不收 在不）。 */
const WAKE_ADDRESS_RE = /(你好|您好|嗨|喂|在吗|在不在|听着|听得到|听得见|帮我|帮忙|请帮|请问|叫一下|喊一下|替我|能不能|打开|关闭|关掉|收起|记下|查一下|查一查|说一下|回答)/;

function wakeReason(text) {
  const s = String(text || '');
  if (!s) return '';
  if (WAKE_STRONG_RE.test(s)) return 'strong';
  /* 「小命」这类歧义写法：单独出现不算叫它，配上称呼语境才算。 */
  if (WAKE_AMBIG_RE.test(s) && WAKE_ADDRESS_RE.test(s)) return 'addressed';
  return '';
}
// 句子里叫了名字 → 该接话（分层判据见上）
function shouldWake(text) { return !!wakeReason(text); }

/* ── 1.5 静音幻觉清洗 + 能量闸（★ 2026-10-02，用户实测"AI 一直收到重复的一句话"的根因）
 *
 * ▎现场证据（sfu/captions/cap-746646-20261002.jsonl）：账本里每 2.4~4s 就有一条
 *   `asr:true` 的字幕，文本一模一样——**「请用简体中文输出。」**
 *   那不是有人在说话，那是 whisper 的 --initial_prompt 被**当成转写结果回显**了：
 *   模型遇到纯静音没有内容可写，就顺着提示词往下"续写"，把提示词尾巴吐成一句话。
 * ▎为什么旧的门槛挡不住：管线里判的是 `size < 40000`（约 1.25s 音频），
 *   它量的是**时长**不是**能量**——一段 4s 的纯静音有 128KB，照样大摇大摆进了转写。
 *   （prewarmAsrWorker 就是拿 0.3s 纯静音喂 worker 的，那条路径的结果被丢弃所以没人看见，
 *    但同一个机制在生产路径上每 4 秒制造一条假字幕。）
 * ▎后果链：假字幕 → 落进 20s 追问窗口 → 每条都触发一次完整应答（流式气泡 + TTS）
 *   → "AI 每两三秒重复回答同一句话" + "对话很混乱" + 朗读被自己的假字幕一路 hush 掉
 *   → "后边它回答没有说话"。所以这一刀是**从源头断流**，比在下游加节流更正确。
 *
 * ▎两道防线（都要，缺一不可）：
 *   ① **能量闸 measureWavLevel()**：转写之前先量这段音频有没有声——没声就直接删段，
 *      **连模型都不叫**。既治幻觉又省 CPU/降延迟（静音段不再排队的隐藏收益）。
 *   ② **文本清洗 cleanTranscript()**：真有声音时模型也可能回显提示词/吐经典幻句
 *      （"字幕by XXX"、"谢谢大家"），这层把它擦干净；擦完什么都不剩 → 返回空串，
 *      调用方按"这段没人说话"跳过（与本文件"空串=跳过"的既有约定一致）。
 * ▎为什么空串而不是抛错：转写失败与"没人说话"在业务上等价（这段没有可用信息），
 *   而抛错会让单段失败拖垮整条转写循环——这条约定从 09-28 就是这样，别改。 */

/* ▎提示词改短的**原因**（不是随手措辞）：原来那句写成祈使句「…请用简体中文输出。」，
 *   模型续写静音时就照抄这句；换成不含谓语的**中性名词短语**后，即使被回显也一眼可辨、
 *   且 cleanTranscript 的黑名单正好盯着这几个字。
 * ▎单一来源（坑 47）：asr_worker.py 原先自己写了一份同样的字符串——两处字面量迟早漂移，
 *   现在 worker 通过 ASR_WORKER_PROMPT 环境变量取这一份。 */
const ASR_PROMPT = '普通话会议对话，简体中文';

/* 会被当成"提示词回显/静音幻句"的片段。命中即从文本里擦掉（不是整条丢掉——
 * 真实句子里偶尔夹一个词被误伤的概率，比整条丢弃导致丢真话低）。 */
const HALLUCIN_FRAGS = [
  /请[用使][^，。,]{0,12}(输出|简体|中文)/g,
  /以下是普通话[^。，,]*/g,
  /普通话会议对话/g,
  /简体?中文/g,
  /^[\s]*(字幕|Subtitles?)(by|：|:)?[\w\s\byyyymmdd./-]{0,30}$/i,
  /^\s*(谢谢(大家|观看|聆听)?[。！!]?)\s*$/,
  /^\s*(The end|全文完|完)\s*$/i,
  /* ★ 2026-10-05 用户真机实锤：-55 闸放进来的房间噪声，被模型续写成 Whisper
   *   训练语料里的**著名静音幻觉句**（"请不吝点赞订阅转发打赏支持明镜与点点栏目"），
   *   直接上字幕条且带「小明」二字把 AI 唤醒——AI 答的全是幻觉。三个家族全收：
   *   点赞订阅转发打赏串 / 明镜与点点栏目 / 字幕君（后者还混在"请开会了 小明"里）。 */
  /请?不?吝?点赞[，,、]?\s*订阅[，,、]?\s*转发[，,、]?\s*打?赏?支?持?[^，。,]{0,14}/g,
  /明镜与点点栏目/g,
  /字幕君/g,
  /点赞[，,、]?\s*订阅[，,、]?\s*转发[，,、]?\s*打?赏/g,
];

/* 清洗一段转写文本 → 可用的句子；返回 '' 表示"这段等于没人说话"。
 * 纯函数、无依赖，所以能被 test:asr 直接逐条断言（性能/语义逻辑都要可穷举）。 */

/* ★ 2026-10-05 夜二（用户第二张截图实锤）：**"精确串匹配"的幻觉过滤器被同音字漂移打穿了**。
 *   上一轮把闸从 -55 放宽到 -62，噪声段确实进转写了，而模型把噪声续成了 YouTube/B 站那套
 *   "求赞求订阅"话术。实测原文：
 *     「请在下一个视频里面打赞,许多 clic,支持、收养、多泫,看到更多 needL FI Ching」
 *   ——**打赞 ≠ 点赞、收养 ≠ 收藏**，旧的四条精确正则一条都不命中，于是 48 个字的幻觉
 *   直接上了字幕条。这是坑 64 的续集：模型在噪声上一定会说点什么，而"说什么"不可预测，
 *   所以判据不能建立在"预测出它说什么"上。
 * ▸ 换成两类**对同音字免疫**的信号：
 *   ① 强锚（一个就够）：明镜与点点栏目 / 字幕君 / 不吝 / 下一个视频 / 看到更多 / 谢谢大家…
 *   ② 组合判据：**"求赞家族"至少一个**（赞/订阅/收藏/打赏/弹幕/关注）**且**再命中
 *     **一个"平台词"**（视频/频道/更多/栏目/支持/转发）。
 *     为什么要两个条件：单看「点赞」会误伤"这个方案我点赞"，单看「视频」会误伤
 *     "把推广视频发一下"；**同时出现的真人会议概率≈0**（与坑 53 同一条思路：
 *     判"够不够格"要用组合/占比，不要用单点绝对值）。
 *   ③ 拉丁乱码：噪声上模型会吐 "clic / needL FI Ching" 这种半英文碎片。
 *     ≥3 个拉丁词，或 ≥2 个且拉丁字符比汉字还多 → 判乱码。
 *     真技术会议里的 "API / React / PPT" 一般 1~2 个，不会误伤。
 * ▸ 返回命中理由（而不是布尔）：日志里要能看懂"这句为什么被丢掉"。 */
const RIFF_STRONG = /明镜与点点|字幕君|不吝|下一个视频|看到更多|更多视频|谢谢大家|求个?关注|一键三连/;
const RIFF_FAMILY = ['赞', '订阅', '收藏', '打赏', '弹幕', '关注'];
/* 刻意**不含「转发」**：它同时是 spam 链的一环和"把方案转发一下"的常用动词，
   放进平台词会让"这个方案我点赞，大家转发一下"被误杀（真机反例，test:asr 钉着）。 */
const RIFF_PLATFORM = ['视频', '频道', '栏目', '支持', '更多', '三连', '一键'];
function noiseRiffReason(t) {
  const s = String(t || '');
  if (!s) return '';
  if (RIFF_STRONG.test(s)) return '强锚命中';
  const fam = RIFF_FAMILY.filter((w) => s.includes(w));
  const plat = RIFF_PLATFORM.filter((w) => s.includes(w));
  if (fam.length && plat.length) return `求赞家族[${fam}] + 平台词[${plat}]`;
  const latin = s.match(/[A-Za-z][A-Za-z'’]{1,}/g) || [];
  const latinChars = latin.reduce((a, x) => a + x.length, 0);
  const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  if (latin.length >= 3 || (latin.length >= 2 && latinChars > cjk)) return `拉丁乱码 ${latin.length} 词`;
  return '';
}

/* ★ 2026-10-05 夜三（真浏览器 e2e 抓到 + 一次对照实验定下的修法）：会议动作词的别字。
 *   「小明，把纪要生成一下」在 2s 分段里被转成「既要生成一下」——
 *   **整段音频一次转写，有没有热词都转对了**，错的只是切细之后缺上下文的那一片。
 *   症状有两层：字幕条上是别字（用户看得见），更要紧的是**动作路由拿不到"纪要"这两个字**
 *   （brain 的纪要意图、看板关键词都按字面匹配）→ 表现成"AI 答应了但什么都没做"。
 * ▸ 为什么**不**走"给模型喂热词 context"这条路——被实测否决（本机 0.6B/GPU，一次对照）：
 *   context 一写进会议词，**纯静音段模型会把 context 整句照抄回来**，
 *   而那句里带「小明」= 幻觉自己唤醒自己，正是坑 64 的原始事故换个入口复发：
 *     静音 + context → “普通话会议对话，简体中文。常见词：小明 纪要 评审 白板 字幕 共享 待办 决议 排期 延迟。”
 *   真话本来就已经转对，热词换来的不是准确率而是幻句，两边代价完全不对称 → 放弃这条路线。
 * ▸ 于是修在**文本侧**，并且按坑 49 的"词 + 它该有的邻居"约束，绝不给裸同音词表：
 *   「既要」同时是常用连词（既要……又要……），只有**贴着会议动作词**时才判成「纪要」；
 *   句中出现「又要」（并列连词的信号）则整条不做替换。反例全进 test:asr 钉住。 */
const ACT_VERB = '生成|整理|总结|汇总|记录|写|发|出|做|给|来|补|同步';
/* ★ 2026-10-07 变体表加「计要」：真浏览器 e2e 的**定稿**里留下的（分段与整句两路都这么写），
 *   铁证是同一场里「小明，把纪要生成一下」被转成「把计要生成一下。」四次、零次对。
 *   ▸ 只加进"必须贴着动作词"这一组，**不**给它裸词豁免：
 *     「从长计」「另行计」后面自然能跟「要」，跨词命中是本项目被咬过四次的老坑（坑 49），
 *     而漏修的代价只是字幕上多一个错字，误修的代价是把用户一句真话改脏（坑 109 同一条不对称）。 */
function fixDomainHomophones(t) {
  let s = String(t || '');
  if (!s || !/(既要|记要|计要)/.test(s)) return s;
  if (/(又要|且要)/.test(s)) return s;      // 并列连词那句是真话，不动
  s = s.replace(new RegExp(`(${ACT_VERB})(了|一下)?(既要|记要|计要)`, 'g'), '$1$2纪要');
  s = s.replace(new RegExp(`(既要|记要|计要)(了|一下)?(${ACT_VERB})`, 'g'), `纪要$2$3`);
  s = s.replace(/(把|将)(既要|记要|计要)/g, '$1纪要');
  /* ★ 2026-10-07 量词后面那个「记要」：整句重转实测出来的新形状「生成一段记要。」——
   *   动作词在两个词之外（生成 **一段** 记要），上面两条"贴着动作词"的规则都够不着。
   *   ▸ 有意只收「一[段份次] + 记要」这一种，**不**把「既要」一起放进去：
   *     「一段既要快又要稳的路」里的「既要」是真连词，而「一段记要」在中文里没有别的读法。
   *     判据窄一点没关系（漏修 = 用户看见一个错字；误修 = 把真话改脏），见坑 49/109。 */
  s = s.replace(/(一[段份次])(记要|计要)/g, '$1纪要');
  return s;
}

/* ★ 2026-10-10（B3-①）句尾"回声短句"折叠（纯函数，test-asr 逐条断言）。
 * ▎触发这件事的不是我的想象，是**真人金标准表**：`bench:asr-golden` 在 far 档转出
 *   「服务器起负载了，把 GPU 显存先降下来。降下来。」——模型把刚说完的尾巴又复读了一遍。
 *   10-07 那次整句重转的反噬（「…明天下午三点的评审」→「…评审**器真不错,拍麦亚。**」）
 *   是同一个家族：**自回归模型在句尾容易把最后一个词组再说一遍**。
 * ▎为什么这条判据是"安全"的那一类（与改别字完全不同）：
 *   折叠掉的这一份，**紧挨着的前一份里已经原样存在了** ⇒ 这是**保内容**的改写，
 *   不像同音字纠正那样可能把真话改脏。最坏情况只是"某人真的强调了一遍"，
 *   而字幕仍然完整显示那句内容一次。
 * ▎规则（三条同时成立才折）：
 *   1 回声段自己是一个完整短句：前面隔着**句末标点**（。！？!?），段长 2~16 字；
 *   2 它是前一句结尾的**真后缀**（前一句严格更长——所以「同意。同意。」这种
 *     两个相等短句的强调**不动**，那是说话人在重复，不是模型在复读）；
 *   3 只处理**句尾**那一个回声（不递归折叠中间的重复——中间复读是修辞，句尾复读是故障）。
 * ▎为什么不做"没有标点"的那种（「先降下来降下来。」）：中文里「非常非常」「好好」
 *   这类叠词是合法表达，折叠会**丢字**；不对称的代价（丢字比留一个复读更伤）
 *   决定了这里宁可少修（坑 109 同一条）。 */
function foldTailEcho(text) {
  const raw = String(text || '');
  if (!raw) return raw;
  /* 按句末标点切，但**保留标点**在前一段末尾（lookbehind），这样最后一段就是"尾巴" */
  const parts = raw.split(/(?<=[。！？!?])/).filter((p) => p.trim());
  if (parts.length < 2) return raw;
  const last = parts[parts.length - 1];
  const prev = parts[parts.length - 2];
  /* 去掉标点与空白后再比（回声段常常自带尾标点：「降下来。」） */
  const strip = (s) => s.replace(/[。！？!?，,、；;：:\s]/g, '');
  const echo = strip(last);
  const before = strip(prev);
  if (echo.length < 3 || echo.length > 16) return raw;
  /* ▸ 为什么下限是 **3 字**而不是 2：两字复读在中文里太常见，而且多是刻意的
   *   ——「同意。同意。」「好的。好的。」「行吧。行吧。」把这类折掉就是改脏用户的话；
   *   而三字以上的"紧跟句末标点的复读"（「先降下来。降下来。」）几乎没有正常读法。
   *   这一档是拿真实账本定的：真人 1196 句里 2 字回声只有 1 例（模型复读人名），
   *   3 字以上是零——宁可少修，不可丢字（坑 109 同一条不对称）。 */
  if (before.length <= echo.length) return raw;          // 相等 = 强调，不动（见上）
  if (!before.endsWith(echo)) return raw;
  /* 折叠：丢掉最后一个回声段，并保证前一句的句末标点还在 */
  return parts.slice(0, -1).join('').trim();
}

/* ★ 2026-10-10（B3-①）句尾回声折叠的**触发计数**：机制"到底跑没跑"必须是查得到的事实，
 *   不是"我写了所以它在跑"（坑 76）。经 /metrics 的 `sfu_ai_asr_tail_echo_fold_total`
 *   交出去，与 `gain_applied_total` 同一条纪律。 */
let tailEchoFolds = 0;

function cleanTranscript(raw) {
  let t = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  /* ★ 2026-10-05 强特征锚整段判噪 → ★ 2026-10-05 夜二升级成"同音字免疫"的组合判据
   *   （见上面 noiseRiffReason 的长注释：精确串被 打赞/收养 这种漂移打穿了）。
   *   整段丢弃的取舍不变：混合了真话的段会被误伤一句，远好于幻觉上字幕 + 唤醒 AI 答非所问。 */
  const riff = noiseRiffReason(t);
  if (riff) {
    if (process.env.ASR_DEBUG) console.log(`[asr-riff] 判为噪声幻觉（${riff}）：${t.slice(0, 40)}`);
    return '';
  }
  for (const re of HALLUCIN_FRAGS) t = t.replace(re, '');
  // 擦掉片段后会留下光秃秃的句首标点（"。明天下午三点…"），一并去掉
  t = t.replace(/^[\s，,。.、；;：:]+/, '').replace(/[\s，,、；;]+$/, '').trim();
  // 折叠"同一短句连着复读"（幻觉风暴在语句组装后会长成 A A A 的样子）
  t = t.replace(/^(.{2,20}?)([，,。.\s]*)\1(?![\w])/, '$1');
  // ★ 2026-10-05 夜三 会议动作词的别字（只动"贴着动作词"的那一种，见 fixDomainHomophones 的实测注释）
  t = fixDomainHomophones(t);
  /* ★ 2026-10-10（B3-①）句尾回声折叠。**放在这里而不是放在定稿/重转那两处**：
   *   分段转写、整句重转、以及 review:meeting 的回扫走的都是这一个入口——
   *   写在调用方就会漏掉一条路（坑 47；而"漏一条路"的症状正是"有时糊有时不糊"）。
   *   ▸ 带**触发计数**（tailEchoFolds）：一条"上线了但没人能证明它跑过"的机制，
   *     等于一颗不知道会不会响的警报（坑 76；10-05 那条安静麦克风增益就是靠
   *     `gain_applied_total` 才第一次有了"它到底跑没跑"的凭据）。 */
  const foldedEcho = foldTailEcho(t);
  if (foldedEcho !== t) {
    tailEchoFolds += 1;
    if (process.env.ASR_DEBUG) console.log(`[asr-echo] 折掉句尾回声（累计 ${tailEchoFolds}）：…${t.slice(-14)} → …${foldedEcho.slice(-14)}`);
  }
  t = foldedEcho;
  // 擦干净后只剩标点/单字 → 当作没有内容（唤醒与账本都不需要这种条目）
  if (t.replace(/[\s，,。.、！!？?：:;；…~\-]/g, '').length < 2) return '';
  return t;
}

/* 量一段 16k/单声道/16bit PCM wav 的峰值电平（dBFS）。
 * ▎为什么在 Node 里自己算而不是问 ffmpeg：这就是 64000 个 sample 的一次遍历，
 *   亚毫秒级、零进程、零新依赖；而"再起一个 ffmpeg 探测一遍"要给每段多付一次进程钱。
 * ▎用 peak 不用 rms：安静说话的人 rms 可能低到和房间噪声分不开，peak 能分辨"有没有出声"。
 * ▎**fail-open 是硬要求**：文件读不到、格式不是我们预期的 PCM16mono，一律返回 null
 *   （= "判断不了"）→ 调用方照常转写。宁可漏掉一次静音过滤，也绝不能把真话当静音删掉。 */
function measureWavLevel(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { return null; }
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let fmt = null;
  for (let i = 12; i + 8 <= buf.length;) {
    const id = buf.toString('ascii', i, i + 4);
    const size = buf.readUInt32LE(i + 4);
    if (id === 'fmt ') {
      fmt = { audioFormat: buf.readUInt16LE(i + 8), channels: buf.readUInt16LE(i + 10), bits: buf.readUInt16LE(i + 22) };
    }
    if (id === 'data') {
      if (!fmt || fmt.audioFormat !== 1 || fmt.channels !== 1 || fmt.bits !== 16) return null; // 非预期形态：不猜
      const end = Math.min(i + 8 + size, buf.length);
      let peak = 0;
      for (let p = i + 8; p + 1 < end; p += 2) {
        const s = Math.abs(buf.readInt16LE(p));
        if (s > peak) peak = s;
      }
      return { peakDb: peak > 0 ? 20 * Math.log10(peak / 32768) : -99, samples: (end - i - 8) / 2 };
    }
    i += 8 + size + (size % 2); // chunk 按偶数字节对齐
  }
  return null;
}

/* ══ ★ 2026-10-09 收口：模型输入的峰值增益算式（原先在 server.js 里写了两遍）══
 * ▎为什么要抽出来：`Math.min(40, Math.max(0, -8 - lvl.peakDb))` 这一行在
 *   handleSegment（分段转写）与整句重转两处**各自内联**了一份。两处都是"送给模型的音量"
 *   这一个概念，按本项目的纪律它只能有一个来源（坑 47）——今天数值一样不代表明天一样，
 *   而漂移之后的症状是"分段转写听得清、整句重转反而听不清"，两边都不报错。
 *   抽出来还有一个直接收益：`npm run bench:asr-golden` 能复用**同一条**增益算式，
 *   于是量具测的是生产真正喂给模型的那份音频，不是我另外调出来的音频。
 * ▎为什么是"比例增益到目标峰值"而不是固定放大（10-05 的旧账）：
 *   真麦克风的峰值跨度极大（响麦 -12 / 笔记本远讲 -56 / 坐得远 -62），
 *   固定增益要么把响的削顶、要么救不了安静的。
 * ▎0 dB 下限：已经比目标响的**不许往回拉**——拉小音量会同时把量化噪声抬进有效位，
 *   而那对模型是纯噪声；上限 40 dB 是防把 -70 dBFS 的底噪放大成一段响噪。
 * ▎env 可覆：ASR_GAIN_TARGET_DB / ASR_GAIN_CAP_DB（默认 -8 / +40 = 今天的行为一字不变）。
 * @param {number} peakDb 实测峰值（measureWavLevel 的 peakDb）
 * @returns {number} 应施加的增益（dB），0 = 不加
 */
/* 配置桥：`sfu/config.example.json` 里 advertise 了 asrGainTargetDb / asrGainCapDb，
 *   那这两个键就必须**真被读到**——否则模板复制即用却静默失效，正是坑 60 那个形状
 *   （"照文档做反而出事"）。本模块看不见 server.js 的 CONFIG，所以由 server 在配置加载后
 *   调一次 configureGain() 把值交进来；优先级仍是 env > config > 默认（env 留给临时实验）。 */
const GAIN_DEFAULTS = { targetDb: -8, capDb: 40 };
let gainCfg = {};
function configureGain(o = {}) {
  if (Number.isFinite(Number(o.targetDb)) && o.targetDb !== undefined && o.targetDb !== '') gainCfg.targetDb = Number(o.targetDb);
  if (Number.isFinite(Number(o.capDb)) && o.capDb !== undefined && o.capDb !== '') gainCfg.capDb = Number(o.capDb);
  return gainCfg;
}
function gainEnv(name, dflt) {
  const raw = process.env[name];
  if (String(raw === undefined ? '' : raw) !== '') {
    const v = Number(raw);
    if (Number.isFinite(v)) return v;          // ★ 0 是合法值（坑 54：`|| 默认` 会让 0 永久失效）
  }
  return dflt;
}
function gainTargetDb() {
  return gainEnv('ASR_GAIN_TARGET_DB', Number.isFinite(gainCfg.targetDb) ? gainCfg.targetDb : GAIN_DEFAULTS.targetDb);
}
function gainCapDb() {
  return gainEnv('ASR_GAIN_CAP_DB', Number.isFinite(gainCfg.capDb) ? gainCfg.capDb : GAIN_DEFAULTS.capDb);
}
function modelGainDb(peakDb) {
  if (!Number.isFinite(peakDb)) return 0;
  const g = Math.min(gainCapDb(), Math.max(0, gainTargetDb() - peakDb));
  return g > 0.5 ? g : 0;      // 半分贝以下听不出差别，就别改文件名、别做一遍拷贝
}

/* ══ ★ 2026-10-06 "此刻有没有人在说话"的判据：绝对阈值 → 相对本机噪声底
 *   ★ 2026-10-07 夜：从"单边只增灵敏度"改成**双边钳位** ══
 * ▎为什么要换：服务器拿 `RMS_level > FLUSH_DB(-50)` 刷新 lastVoiceTs，而 lastVoiceTs 决定
 *   ①静音确认（silenceConfirmed → 什么时候把一句话定稿）②延迟读数的起点 ③抢跑快照的时机。
 *   本机 ffmpeg 对照实测（同一条滤镜链、reset=8≈0.5s 窗）：
 *     语音峰值 -20 dBFS → RMS -23 ✅判有声
 *     语音峰值 -40 dBFS → RMS -43 ✅判有声
 *     语音峰值 -56 dBFS → RMS -59 ❌**永不判有声**
 *     语音峰值 -62 dBFS → RMS -65 ❌同上
 *   而 10-05d 从真实会议日志里量到的用户麦克风正是 **-56 ~ -65 dBFS**（坐得远 / 笔记本麦）。
 *   对这些人：lastVoiceTs 从头到尾不刷新 ⇒ silenceConfirmed **每一段都成立** ⇒
 *   每个 2s 段各自成句、各自定稿、各自唤醒 ⇒ 用户看到的"语音识别好乱 / 它答好几遍"。
 *
 * ▎★ 但 10-06 那版只允许"比今天更灵敏"（`min(absDb, floor+margin)`），代价是**反方向整条坏掉**：
 *   吵房间 floor=-43 ⇒ 阈值仍是 -50 ⇒ **-43 的底噪本身就高于阈值** ⇒ 每一帧都判"有人在说"
 *   ⇒ lastVoiceTs 永不超时 ⇒ silenceConfirmed 永不成立 ⇒ 句子只能等 10s 保险丝 ⇒
 *   **三句不相干的话粘成一条 blob**。
 *   这不是设想：2026-10-07 `TEST_ASR_DEBUG=1 npm run test:asr-live` 复跑就摊开这一行——
 *     `voiceThr=-50.0 floor=-42.9` · `rms=1444行/495有声` · 定稿只剩一条、把闲聊也粘了进去。
 *   同一条 blob 还连带把「整句重转」推进反噬形态（音频里本来就含着下一句，见 preferRefined）。
 *   ▸ 当时的注释写的是"吵房间行为与修前一字不差"，把它当成**安全**——
 *     而"修前"本身就是这个 bug 的成因。**"不改变旧行为"不是一条安全性质，它只是把旧行为冻结**。
 *
 * ▎现在的规则（两边都有硬安全线，中间跟着本机噪声底走）：
 *     threshold = clamp(floor + margin, SENSITIVE_FLOOR, DEAF_CEIL)
 *   · `SENSITIVE_FLOOR`（默认 -74）= 10-06 那版在完全安静房间里能到达的最灵敏值，
 *     再安静也不往下追（免得把线噪声/呼吸当语音）；
 *   · `DEAF_CEIL`（默认 -42）= **绝不比这更迟钝**：房间再吵，-42 以下的语音仍算"有人在说"，
 *     这样"吵房间能分开句子"就不会反过来把 10-05d 那批安静麦克风用户整个弄聋（坑 91 的另一半）；
 *   · 样本不足（`minSamples`，默认 8）→ 用绝对阈值 `absDb`，不猜。
 *   ▸ 三条边界各自都有断言：吵房间（-43→-42，比今天更迟钝、正是修法本身）/
 *     中等（-60→-54，与 10-06 一字不差）/ 安静（-80→-74，与 10-06 一字不差）——
 *     **只有该变的那一档变**，这就是这次改动的验收形状。
 * ▎floor 用**窗口百分位**而不是全局最小：环境会变（空调开关、换设备、走到窗边）。
 * ▎已知偏差如实挂着（下一批 H8b）：低于 `silentDb`(-80) 的样本**不参与** floor 估计，
 *   而 ffmpeg 在纯静音期给的是 -inf→-99 ⇒ 真正的"房间有多安静"被系统性排除在外，
 *   floor 因此偏高（今晚那个 -42.9 里有 speech 尾音的成分）。修它要先拿真人真麦的分布定，
 *   不拿合成/假设备音频调生产阈值（10-05e 那条"放宽一处、下一环遭殃"）。
 * ▎纯函数、零依赖，test:asr ③.11 逐条断言。 */
function createVoiceTracker(opt = {}) {
  const absDb = Number.isFinite(opt.absDb) ? opt.absDb : -50;      // 样本不够时的绝对阈值（不猜）
  const marginDb = Number.isFinite(opt.marginDb) ? opt.marginDb : 6; // 噪声底之上多少算"人在说话"
  const minSamples = Number.isFinite(opt.minSamples) ? opt.minSamples : 8; // 攒够样本才敢偏离绝对阈值
  const windowSize = Number.isFinite(opt.windowSize) ? opt.windowSize : 60; // 只看最近这些观测（环境会漂）
  const quantile = Number.isFinite(opt.quantile) ? opt.quantile : 0.2;      // "底"取第 20 百分位，不是最小值
  const silentDb = Number.isFinite(opt.silentDb) ? opt.silentDb : -80;      // 低于此视为完全无声（ffmpeg 的 -inf 映射成 -99）
  const LOUD_CAP = Number.isFinite(opt.loudCap) ? opt.loudCap : -30;        // 比这响的不叫底噪，不参与 floor
  /* 两条安全线（★ 2026-10-07 夜把单边 min() 换成双边钳位，理由见函数头） */
  const SENSITIVE_FLOOR = Number.isFinite(opt.sensitiveFloor) ? opt.sensitiveFloor : -74;
  const DEAF_CEIL = Number.isFinite(opt.deafCeil) ? opt.deafCeil : -42;
  const seen = [];
  let lastFloor = null;

  /** 一帧 RMS（dBFS）进来，回答"此刻有没有人在说话"，并顺带报出当前噪声底与阈值。 */
  function feed(db) {
    const v = Number(db);
    if (Number.isFinite(v) && v > silentDb && v < LOUD_CAP) {
      seen.push(v);
      if (seen.length > windowSize) seen.shift();   // 窗口滑动 ⇒ 空调关了、换设备了，floor 会自己跟上
    }
    const thr = threshold();
    return { voiced: v > thr, floorDb: lastFloor, thresholdDb: thr, samples: seen.length };
  }
  /**
   * 阈值 = floor + margin，钳在 [SENSITIVE_FLOOR, DEAF_CEIL]；样本不够时回到绝对阈值。
   * ▎为什么是**钳位**而不是 min()/max() 单边：min() 只会"更灵敏"，吵房间的底噪因此永远在阈值之上，
   *   静音确认整条失效（= blob）；而完全不钳又会让安静房间追着 -99 跑成"什么都算语音"。
   *   两边都留硬线，中间跟着事实走。拿"够不够格"的量必须是尺度无关的量（坑 53）。
   */
  function threshold() {
    if (seen.length < minSamples) { lastFloor = null; return absDb; }
    const sorted = seen.slice().sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * quantile));
    lastFloor = sorted[idx];
    return Math.max(SENSITIVE_FLOOR, Math.min(DEAF_CEIL, lastFloor + marginDb));
  }
  return {
    feed, threshold,
    get floorDb() { return lastFloor; },
    get samples() { return seen.length; },
    get thresholdDb() { return threshold(); },
    /* 两条安全线暴露出去：诊断与自测要说清"现在是被钳住的还是跟着噪声底走的" */
    get sensitiveFloor() { return SENSITIVE_FLOOR; },
    get deafCeil() { return DEAF_CEIL; },
    /* ★ 2026-10-10（B2）把这把尺子的**生效参数**交出来，而不是让外部工具再抄一份默认值。
     *   ▎为什么这条是承重的而不是便利：`bench:voice-floor` 要拿"现状 silentDb"与几个变体对比，
     *   而 -80/-30/8/60/0.2 这些数原先只活在函数体内部——工具自己写一份"现状"就意味着
     *   **它对比的可能是我以为的现状**（生产改了、量具没改，报告会继续替旧参数辩护）。
     *   与 `modelGainDb()` / `asrMinPeakDb()` 同一条纪律：一个概念一个来源（坑 47）。 */
    get params() {
      return { absDb, marginDb, minSamples, windowSize, quantile, silentDb, loudCap: LOUD_CAP,
        sensitiveFloor: SENSITIVE_FLOOR, deafCeil: DEAF_CEIL };
    },
  };
}


/* ★ 2026-10-05 PCM→WAV 包装（PCM 渐进段路线的配套件）。
 * ▎为什么需要它：分段录音输出从 wav 改成 raw s16le 之后（wav 段在 in-flight 时
 *   一个字节都读不到，而 s16le + `-segment_format_options flush_packets=1`
 *   能渐进落盘——见 10-05 探针 seg-probe3 实测），转写引擎与 measureWavLevel
 *   都只吃 WAV，所以转写前要现包一层 44 字节头。
 * ▎参数写死 16k/mono/s16le：与 ffmpeg 侧 `-ar 16000 -ac 1 -c:a pcm_s16le`
 *   是**同一份约定**（改一处必须同改，所以只留这一个函数做包装）。
 * ▎slice 版（buffer 入参）给"尾段 delta 快照"用——那一路只需要 PCM 的一个
 *   切片，不必先写文件再读回来。 */
function wrapPcmToWav(pcmFile, wavFile, opts = {}) {
  const data = fs.readFileSync(pcmFile);
  /* ★ 2026-10-04i 可选线性增益（安静真麦克风的救赎）：真人的笔记本麦峰值常在
   *   -46~-50 dBFS（静音闸是拿 TTS 全幅音色校准的，假设真说话 -20~-10）——
   *   按"实测峰值→目标电平"的比例提升采样（s16 线性缩放，Node 内完成，
   *   零 ffmpeg、零重编码），模型听到的是响亮清晰的语音。
   *   ▸ 上限由调用方钳（服务端钳 +20dB）；线性缩放超过 0dBFS 会削顶，
   *     所以只对"闸后确认是语音"的段提。 */
  let payload = data;
  const g = Number(opts.gainLin);
  if (Number.isFinite(g) && g > 1.001) {
    const samples = new Int16Array(data.buffer, data.byteOffset, data.length >> 1);
    for (let i = 0; i < samples.length; i++) {
      const v = Math.round(samples[i] * g);
      samples[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
    }
    payload = Buffer.from(samples.buffer, 0, samples.length * 2);
  }
  fs.writeFileSync(wavFile, pcmToWavBuffer(payload));
  return data.length;
}

function pcmToWavBuffer(data) {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22); head.writeUInt32LE(16000, 24); head.writeUInt32LE(32000, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

/* ── 2. 候选与白名单 ─────────────────────────────────────────── */

// pip 安装位置：--user 装的 whisper.exe 不在服务器 PATH 里，需要显式枚举
function userExeCandidates() {
  return [
    process.env.APPDATA && path.join(process.env.APPDATA, 'Python', 'Python312', 'Scripts', 'whisper.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Python', 'Python312', 'Scripts', 'whisper.exe'),
    'C:' + path.sep + 'Program Files' + path.sep + 'Python312' + path.sep + 'Scripts' + path.sep + 'whisper.exe',
  ].filter(Boolean).filter((p) => {
    try { return fs.existsSync(p); } catch (e) { return false; }
  });
}

function candidates() {
  const out = [];
  // ① PATH 上的可执行名（Linux/macOS 或已配好 PATH 的 Windows）
  for (const bin of ['whisper', 'whisper-cli', 'whisper.exe', 'whisper-cli.exe']) {
    out.push({ kind: 'exe', bin, preArgs: [] });
  }
  // ② pip --user 的显式路径
  for (const p of userExeCandidates()) out.push({ kind: 'exe', bin: p, preArgs: [] });
  // ③ 模块方式（跨机器最稳：不依赖 Scripts 目录进 PATH）
  out.push({ kind: 'py', bin: 'python', preArgs: ['-m', 'whisper'] });
  out.push({ kind: 'py', bin: 'python3', preArgs: ['-m', 'whisper'] });
  out.push({ kind: 'py', bin: 'py', preArgs: ['-3', '-m', 'whisper'] });
  return out;
}

/* 形态白名单：只有这两种形状的 runner 能进入 spawn/execFile。
 * ▎为什么必须校验：runner 来自"探测结果"，而调用方可能把它存进配置/环境变量；
 *   一旦有人能左右这个字符串，`bin` 就成了任意命令执行入口。白名单把口子焊死。 */
function assertRunner(r) {
  if (!r || typeof r !== 'object') return null;
  const bin = String(r.bin || '');
  const preArgs = Array.isArray(r.preArgs) ? r.preArgs.map(String) : [];
  if (r.kind === 'exe') {
    const bare = !bin.includes('/') && !bin.includes('\\');
    const ok = bare ? /^whisper(-cli)?(\.exe)?$/i.test(bin)
                    : (path.isAbsolute(bin) && /whisper(-cli)?\.exe$/i.test(bin));
    if (!ok || preArgs.length) return null;
    return { kind: 'exe', bin, preArgs: [] };
  }
  if (r.kind === 'py') {
    if (!['python', 'python3', 'py'].includes(bin)) return null;
    if (preArgs.join(' ') !== '-m whisper' && preArgs.join(' ') !== '-3 -m whisper') return null;
    return { kind: 'py', bin, preArgs };
  }
  return null;
}

/* ── 3. 探测：能不能真的跑起来 ────────────────────────────────
 * @@returns {Promise<{kind,bin,preArgs,label}|null>} null = 本机没有可用 whisper
 * ▎超时 25s→45s（2026-10-04h）：本机连跑数小时后 python 冷 import 实测要 47s——
 *   探测超时被当成"没装"= 兜底耳朵整个服务器生命周期消失（坑 67 同族第三发：
 *   "探测超时被当成没装"在 qwen 模块犯过，whisper 这处一直留着旧超时）。 */
async function probeWhisper({ timeoutMs = 45000 } = {}) {
  for (const raw of candidates()) {
    const runner = assertRunner(raw);
    if (!runner) continue;
    const okFlag = await new Promise((resolve) => {
      execFile(runner.bin, [...runner.preArgs, '--help'],
        { timeout: timeoutMs, windowsHide: true, env: PY_ENV },
        (err) => resolve(!err));
    });
    if (okFlag) {
      return { ...runner, label: runner.kind === 'py' ? `${runner.bin} ${runner.preArgs.join(' ')}` : runner.bin };
    }
  }
  return null;
}

/* ── 4. 转写一个音频文件 → 文本 ───────────────────────────────
 * ▎参数拼装集中在这里：模型/语言/提示词/输出格式/静默进度。
 * ▎提示词见 1.5 节：它必须是**不会被回显成整句**的中性短语——旧值那句祈使句
 *   在静音段被模型照抄成"请用简体中文输出。"，就是本轮"AI 收到重复一句话"的现场。
 * ▎返回**空串**表示"这段没人说话/识别失败"——调用方按"跳过"处理，不要当异常。
 *   ★ 2026-10-02 起这里真的会返回空串了：结果统一过 cleanTranscript()。 */
function buildArgs(runner, wavFile, opts = {}) {
  return [
    ...runner.preArgs,
    wavFile,
    '--model', opts.model || DEFAULT_MODEL,
    '--language', opts.language || 'zh',
    '--initial_prompt', opts.initialPrompt || ASR_PROMPT,
    '--output_format', 'txt',
    '--output_dir', opts.outDir || path.dirname(wavFile),
    '--verbose', 'False', // 不往 stdout 打印分段（GBK 控制台更稳，也省时间）
  ];
}

/* ★ 09-28：跨说话人的**转写并发闸**。
 * ▎为什么需要：一场会里 N 个人同时开麦 → 原来会同时跑 N 个 whisper 进程；
 *   本机 CPU 核数有限，3 个人说话就能让机器卡到影响媒体转发（转发才是主业）。
 *   这里用"信号量"把并发压到 ASR_CONCURRENCY（默认 2）：转写慢一点，但服务器不卡。
 *   ▎为什么是 2 不是 1：1 会让"第二个人"排队等第一个人转完（尾延迟 ×N）；
 *     2 是"用满两个核、留足余量给 mediasoup"的折中（可按机器调大/调小）。 */
const ASR_CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.ASR_CONCURRENCY) || 2));
let asrRunning = 0;
const asrWaiters = [];
function acquireAsrSlot() {
  if (asrRunning < ASR_CONCURRENCY) { asrRunning += 1; return Promise.resolve(); }
  return new Promise((resolve) => asrWaiters.push(resolve));
}
function releaseAsrSlot() {
  const next = asrWaiters.shift();
  if (next) next();              // 名额直接转交（asrRunning 不变）
  else asrRunning -= 1;
}

async function transcribeFile(runner, wavFile, opts = {}) {
  const safe = assertRunner(runner);
  if (!safe) throw new Error('runner 未通过形态白名单');
  const outDir = opts.outDir || path.dirname(wavFile);
  const timeoutMs = opts.timeoutMs || Number(process.env.ASR_TIMEOUT_MS) || 120000;
  await acquireAsrSlot();
  try {
    return await new Promise((resolve) => {
      execFile(safe.bin, buildArgs(safe, wavFile, { ...opts, outDir }),
        { timeout: timeoutMs, windowsHide: true, env: PY_ENV, maxBuffer: 4 * 1024 * 1024 },
        () => {
          // whisper CLI 会把结果写成"与音频同名的 .txt"到 output_dir
          const txt = path.join(outDir, path.basename(wavFile).replace(/\.[^.]+$/, '.txt'));
          let text = '';
          try { text = fs.readFileSync(txt, 'utf8'); } catch (e) { text = ''; }
          try { fs.unlinkSync(txt); } catch (e) { /* 不存在就算了 */ }
          resolve(cleanTranscript(text));
        });
    });
  } finally {
    releaseAsrSlot();
  }
}

/* ── 4.5 常驻转写 worker（★ 09-29，"识别不灵敏"的最大单一解）──────────
 * ▎CLI 路径的隐藏成本：whisper 命令行每转一段都要**重启 Python + 重新加载模型**
 *   （本机实测固定开销 2~4s/次）。分段持续转写场景下每段都白付一次启动钱——
 *   字幕滞后越滚越大。
 * ▎worker 方案：一个常驻 Python 进程（asr_worker.py，与本文件同目录）模型只加载
 *   一次，之后每段只付"纯转写"时间。协议见 asr_worker.py 头注释（stdin/stdout JSONL）。
 * ▎安全形态（Mimosa 复核过）：spawn 的**可执行与参数全是字面量**——解释器只在
 *   'python'/'python3' 两个固定名字里选（选哪个由 import 探测决定），脚本名写死；
 *   模型名等一切动态数据走**环境变量**，不进 argv。这就把"程序选择/选项注入"两个
 *   攻击面从结构上焊死了（与 asr.js 一贯的"形态白名单"同思路，只是更进一步）。
 * ▎可靠性：起不来/连崩 3 次 → 永久放弃（alive=false），调用方回退 CLI 路径
 *   （transcribeFile），功能不降级；单段超时/异常按空串处理，绝不挂死转写循环。 */
const { spawn } = require('child_process');

/* ★ 2026-10-02 探测改走 sfu/ai/pyprobe.js（唯一实现）：
 *   原来这里也是 `timeout: 15000` + "err 即没装"，与坑 37 同一个错法——
 *   只是 whisper 的导入比 torch 一族快，才没被踩到。共用一份实现，
 *   下次改判据（比如再加一趟重试）三处一起生效。 */
async function pythonNameForWorker() {
  const { probePythonModule } = require('./pyprobe');
  const r = await probePythonModule('whisper');
  return r.bin; // 'python' | 'python3' | null（null = 真不可用，调用方回退 CLI 路径）
}

function createResidentTranscriber({ model, timeoutMs } = {}) {
  const WAIT_MS = timeoutMs || Number(process.env.ASR_TIMEOUT_MS) || 120000;
  const state = {
    py: null, child: null, ready: false, seq: 0, buf: '',
    pending: new Map(),      // id → { resolve, timer }
    dead: false, crashStreak: 0, lastError: null,
  };

  function failPending(why) {
    for (const [, p] of state.pending) {
      clearTimeout(p.timer);
      p.resolve('');           // 与 CLI 同约定：失败=空串=跳过这段
    }
    state.pending.clear();
    if (why) state.lastError = why;
  }

  function handleLine(chunk) {
    state.buf += chunk.toString('utf8');
    let idx;
    while ((idx = state.buf.indexOf('\n')) >= 0) {
      const line = state.buf.slice(0, idx).trim();
      state.buf = state.buf.slice(idx + 1);
      if (!line) continue;
      let msg = null;
      try { msg = JSON.parse(line); } catch (e) { continue; }
      if (msg.ready) { state.ready = true; state.crashStreak = 0; continue; }
      if (msg.fatal) { state.lastError = msg.fatal; failPending('fatal'); continue; }
      const p = state.pending.get(msg.id);
      if (!p) continue;
      state.pending.delete(msg.id);
      clearTimeout(p.timer);
      p.resolve(cleanTranscript(msg.text));
    }
  }

  function start() {
    if (state.dead || state.child) return;
    state.ready = false;
    state.buf = '';
    // 可执行与参数全部字面量（python3/python 两个固定分支）；动态数据只走 env
    const childOpts = {
      cwd: __dirname,          // 脚本与本实现同目录（字面量文件名 + 固定 cwd）
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...PY_ENV,
        ASR_WORKER_MODEL: String(model || DEFAULT_MODEL),
        ASR_WORKER_PROMPT: ASR_PROMPT, // ★ 2026-10-02 提示词单一来源（worker 侧不再自己写一份）
      },
    };
    if (state.usePython3) {
      state.child = spawn('python3', ['asr_worker.py'], childOpts);
    } else {
      state.child = spawn('python', ['asr_worker.py'], childOpts);
    }
    state.child.stdout.on('data', handleLine);
    state.child.stderr.on('data', () => { /* 进度/警告静默（GBK 控制台防坑） */ });
    state.child.on('exit', () => {
      state.child = null;
      state.ready = false;
      failPending('worker-exit');
      if (!state.dead) {
        state.crashStreak += 1;
        if (state.crashStreak >= 3) state.dead = true; // 连崩 3 次 → 调用方走 CLI 兜底
      }
    });
    state.child.on('error', () => { /* spawn 失败交给 exit 分支收尾 */ });
  }

  async function boot() {
    if (state.dead) return false;
    if (state.child && state.ready) return true;
    if (!state.py) {
      state.py = await pythonNameForWorker();
      if (!state.py) { state.dead = true; state.lastError = 'no-python-with-whisper'; return false; }
      // spawn 的可执行须是字面量：把选中的名字映射回固定调用（见 start()）
      state.usePython3 = state.py === 'python3';
    }
    start();
    const t0 = Date.now();
    while (!state.ready && Date.now() - t0 < 60000) {
      if (!state.child) return false;      // 启动即崩
      await new Promise((r) => setTimeout(r, 150));
    }
    return state.ready;
  }

  async function transcribe(wavFile, opts = {}) {
    if (state.dead) return '';
    const okBoot = await boot();
    if (!okBoot || !state.child || !state.ready) return '';
    const id = ++state.seq;
    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        state.pending.delete(id);
        resolve('');
      }, opts.timeoutMs || WAIT_MS);
      state.pending.set(id, { resolve, timer });
      try {
        state.child.stdin.write(JSON.stringify({ id, wav: String(wavFile) }) + '\n');
      } catch (e) {
        state.pending.delete(id);
        clearTimeout(timer);
        resolve('');
      }
    });
  }

  function kill() {
    state.dead = true;
    failPending('killed');
    try { if (state.child) { state.child.stdin.end(); state.child.kill(); } } catch (e) { /* 忽略 */ }
    state.child = null;
  }

  return {
    transcribe,
    kill,
    get alive() { return !state.dead && !!state.child && state.ready; },
    get model() { return String(model || DEFAULT_MODEL); },
    get lastError() { return state.lastError; },
  };
}

/* ── 5. 对话状态：唤醒 + 追问窗口（纯函数，可单测） ───────────── */
// shouldWake 的分层实现在本文件顶部（WAKE_RE 那张表旁边）。
// ▸ 这里**不要再定义一遍**：同名函数声明会被提升后覆盖，本文件就因此出现过
//   "改了上面的判据、行为一点没变"（函数声明后写的那份胜出，而它用的是旧表）。

/* 追问窗口：AI 刚答完 20s 内，大家继续说话不必再喊名字——这是"对话"与
 * "命令"的区别（人跟人聊天不会每句都先叫对方名字）。 */
function isFollowUp(windowUntilTs, now = Date.now()) {
  return !!windowUntilTs && now < windowUntilTs;
}

/* ★ 2026-10-04 「只叫了名字，没说事情」（纯函数，test:asr 逐条断言）。
 * ▎要解决的真问题：分段窗口会把一句「小明，把纪要生成一下」切成两条字幕，
 *   其中一条**只含名字**（e2e 实测出现过「一下，小明。」这种头尾互换的碎片）。
 *   旧代码只要文本里有名字就算"明确指令"，于是拿着一个光秃秃的名字去问模型，
 *   模型没有新问题可答，只能把上一轮的答案再复述一遍——这就是用户说的"它又在重复接话"。
 * ▎处置不是"丢掉"而是"应一声但不作答"：把这一轮当成"叫我一下"，
 *   由调用方顺延追问窗口，让随后到达的那半句以**追问**的身份被接住。
 *   既不重复答，也不把人晾在半句上（两种失败都比现在难受）。
 * ▎判据看的是**归一化之后**的文本（normAsrText 已把 鸣/名/铭→明 并抹掉标点），
 *   与 isDupOrFragment 同一条口径；抹名字时复用 WAKE_RE，所以忘了归一也不会漏。
 *   阈值取"去掉名字后剩不到 2 个字"：
 *   「小明你好」这种带内容的问候仍然正常回答——它不是碎片。 */
function isNameOnly(norm) {
  /* 名字表复用 WAKE_RE（同一个概念只有一处来源，坑 47）：加个 g 只是为了"把所有出现都抹掉"。 */
  const rest = String(norm || '').replace(new RegExp(WAKE_RE.source, 'g'), '');
  return rest.length < 2;
}

/* ★ 2026-10-06 夜二 「叫它的那一句」——从合并字幕里取出带名字的那个小句。
 * ▎要解决的真问题（用户那句"答非所问"的另一半）：分段累积会把几句不相干的话
 *   并进同一条字幕（「哦 不能往上怎么接那个 大木车是不是 你好小明」），
 *   旧实现把**整条**丢给模型 ⇒ 它真的去检索"大木车"并认真回答，用户看到的就是
 *   "我没让它管这事"。名字在这条句子里，但**请求**只在其中一个小句里。
 * ▎切分只按**句末标点**（。！？…），逗号不切：「小明，帮我把这条记一下，明天下午三点开评审会」
 *   是一个整体，按逗号切会把请求本身切碎（那比重复回答更糟）。
 * ▎取"含名字的那一段"，如果它短到像半句话（<6 字），再把**下一段**并进来——
 *   真实形态「小明。 帮我记一下…」就是这么被切开的。
 * ▎注意这只收窄**喂给模型的问题**；会议记录/看板/RAG 语料仍是整条字幕（那是另一个概念：
 *   "有人说了什么" ≠ "他在要求什么"）。 */
const CLAUSE_SPLIT_RE = /(?<=[。！？!?~～])/;
function wakeClause(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const parts = raw.split(CLAUSE_SPLIT_RE).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return raw;
  const i = parts.findIndex((p) => shouldWake(p));
  if (i < 0) return raw;                       // 判据说是含名字的却找不出段（标点异常），保守用整条
  if (normAsrText(parts[i]).length >= 6 || i === parts.length - 1) return parts[i];
  return `${parts[i]} ${parts[i + 1]}`;        // 光秃秃的称呼 + 紧随的那句请求
}

/* ── 5b. ★ 2026-10-03 「这是上一句的碎片」判据（纯函数，test:asr 逐条断言） ──
 * ▎要解决的真问题：4s 分段窗口会把**一句人说出口的话**切成两个 wav 分别转写，
 *   于是同一句话在账本里出现两条、AI 也应答两次（`test:asr-live` 在 qwen-local
 *   引擎下实测到 3 条字幕 / 3 次应答，用户侧观感就是"它又在重复接话"）。
 * ▎为什么原来的"归一化包含"判据拦不住：分段边界会带来**写法漂移**——
 *   「…下午三点的评审。」与「…下午3点的评审会。」既不相等、也不互相包含
 *   （三↔3 的写法差 + 尾字被截断），而它们确实是同一句。
 * ▎判据（三个条件同时成立才算碎片，缺一会误杀真人追问）：
 *   ① **方向性**：算"新句被旧句覆盖的比例"，不是对称相似度。
 *      反向的例子必须放过：先说「小明」（打招呼）、紧跟着说「小明，把纪要生成一下」——
 *      后者包含前者，但它是一句**新的、信息更全**的话，绝不能被当成碎片丢掉。
 *   ② **有新信息就放行**：新句里没被旧句覆盖的 bigram 数量 > 4 就算"说了新东西"。
 *   ③ **只比长度够的句子**：单字/双字的归一化文本（「小」「嗯」）bigram 太少，
 *      比例在统计上没有意义，不下结论（同坑 53：样本太小就别拿占比判够不够格）。
 * ▎窗口与"同一说话人"由调用方把关（见 server 的 finalizeUtterance）：
 *   两个人先后说同样的话是两件事，不能把后一个人的字幕吞掉。 */
function bigramSet(s) {
  const t = String(s || '');
  const out = new Set();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  if (!out.size && t.length === 1) out.add(t); // 单字句退化成 unigram，避免空集判不出
  return out;
}
function isFragmentOf(prevNorm, norm) {
  const a = bigramSet(prevNorm);
  const b = bigramSet(norm);
  if (a.size < 3 || b.size < 3) return false;     // ③ 太短不下结论
  let covered = 0;
  for (const g of b) if (a.has(g)) covered += 1;
  const novel = b.size - covered;
  return covered / b.size >= 0.6 && novel <= 4;   // ① 方向 + ② 新信息门槛
}

/* ★ 2026-10-03 「这两句是不是同一句」的总判据（纯函数，test:asr 逐条断言）。
 * ▎为什么要抽出来：这四条原本是 server 里一段内联布尔表达式，**谁都测不到它**，
 *   而它正是"字幕刷屏 / AI 重复接话"的总闸——坑 57 说过：
 *   凡是"某能力装了就该生效"的地方，都要有一条"它必须成立"的回归。
 * ▎注意这里**只比文本**："同不同一个人"不该由字符串判据关心——
 *   server 把锚点存在**成员对象**上（每人一条），跨人误吞在结构上就不可能发生。
 *   能用结构消除的判据，就不要靠每次记得检查（坑 47）。
 * ▎四条：① 归一化相等；② 新句是旧句子串（尾音碎片）；
 *   ③ 旧句是新句子串且新句只多 ≤6 字（差个标点/语气词）；④ 写法漂移的碎片。 */
function isDupOrFragment(prevNorm, norm) {
  const a = String(prevNorm || '');
  const b = String(norm || '');
  if (!a || !b) return false;
  return b === a
    || (a.length >= 2 && a.includes(b))
    || (b.includes(a) && b.length <= a.length + 6)
    || isFragmentOf(a, b);
}

/* ★ 2026-10-05 文本归一化**唯一实现**（坑 47：一个概念一个来源）。
 * ▎历史：server 侧有一份 normAsrText（重复句闸与 AI 回声闸共用），本轮句内归并
 *   也要同一口径——与其在两处各抄一份正则，不如收到这里：server 的 normAsrText
 *   改为**委托**本函数，两处的归一化从此结构上不可能漂移。
 * ▎口径与历史实现逐字一致：唤醒词家族形近字（鸣/名/铭→明）+ 抹掉空白与标点。 */
const ASR_PUNCT_RE = /[\s，,。.、！!？?；;：:“”"'‘’]/;
function normWithPos(s) {
  const raw = String(s || '');
  let norm = '';
  const pos = [];          // pos[i] = norm 第 i 字在原文 raw 中的下标（归并时切尾巴要用原文）
  for (let i = 0; i < raw.length; i++) {
    let ch = raw[i];
    if (ch === '鸣' || ch === '名' || ch === '铭') ch = '明';
    if (ASR_PUNCT_RE.test(ch)) continue;
    norm += ch;
    pos.push(i);
  }
  return { norm, pos };
}
function normAsrText(s) { return normWithPos(s).norm; }

/* ★ 2026-10-05 句内归并（纯函数，test:asr 逐条断言）——chop 修复的第三层。
 * ▎要解决的真问题：同一句被切成多段分别转写后，**封口段的全量转写**可能比
 *   "抢跑快照"多出尾巴几个字（快照=「把白板打」，封口全量=「把白板打开」）。
 *   旧代码拿 isDupOrFragment 判"重复就只续窗"，而它第③条
 *   `(b.includes(a) && b.length <= a.length + 6)` 恰好把**多几个字的更全版本**
 *   判成碎片吞掉 → 「开」凭空消失（用户侧症状="AI 操控实体缺字/不执行"）。
 * ▎所以句内组装的判据**不是"像不像重复"，而是"哪份更全 + 怎么拼"**；
 *   与 isDupOrFragment 的分工：那条管**跨句去重**（这句要不要丢），
 *   这条管**句内拼接**（两份文本怎么合成一句）——语义不同，不能互换。
 * ▎规则（8 条，按序短路）：
 *   1 段空归累积 / 2 累积空归段 / 3 相等归累积；
 *   4 新段是累积的子串 → 纯重复，归累积；
 *   5 ★ 累积是新段的子串 → 新段更全（快照半句 vs 封口全量）→ 归新段；
 *   6 累积被新段覆盖（写法漂移）→ 归新段；7 新段被累积覆盖 → 归累积；
 *   8 后缀-前缀最长重叠 k≥2 → 拼尾巴（k=1 不归并：中文里几乎全是巧合，删真字更糟）；
 *   9 都不沾 → 空格相连。
 * ▎尾巴切的是 seg **原文**（pos[k-1]+1 起）——归一化会抹标点，用归一文本切会把标点连带删掉。 */
function mergeTranscript(accRaw, segRaw) {
  const acc = String(accRaw || '').trim();
  const seg = String(segRaw || '').trim();
  if (!seg) return acc;
  if (!acc) return seg;
  const A = normWithPos(acc);
  const B = normWithPos(seg);
  if (!B.norm) return acc;
  if (!A.norm) return seg;
  if (B.norm === A.norm) return acc;
  if (A.norm.includes(B.norm)) return acc;
  if (B.norm.includes(A.norm)) return seg;
  if (isFragmentOf(B.norm, A.norm)) return seg;   // A 被 B 覆盖 → B 更全
  if (isFragmentOf(A.norm, B.norm)) return acc;   // B 被 A 覆盖 → acc 更全
  const maxK = Math.min(A.norm.length, B.norm.length);
  for (let k = maxK; k >= 2; k--) {
    if (A.norm.slice(-k) === B.norm.slice(0, k)) {
      const tail = seg.slice(B.pos[k - 1] + 1).trim();
      return tail ? `${acc} ${tail}` : acc;
    }
  }
  return `${acc} ${seg}`;
}

/* ★ 2026-10-07 「整句重转」采用判据（纯函数，test:asr 逐条断言）。
 * ▎背景：2 秒一段分别转写再拼，会把词切在段边界上（实测「服务器」→「服务。」+「起负载」）。
 *   修法是把整句音频一次喂回模型，但**重转的结果不能无条件替换**拼接结果——
 *   万一那一次推理失败/被清洗成空/只转出半句，无条件替换就是"为了修准确率而丢字"，
 *   而丢字比切错词更严重（用户的原话是"要真正能用"，不是"要好看"）。
 * ▎规则：
 *   1 refined 为空 / 归一化后为空 → 不采用（保留分段拼出来的句子）；
 *   2 与 stitched 归一化相同 → 不采用（没变化就别标记，避免把"没修好"说成"修好了"）；
 *   3 ★ refined **不比 stitched 少太多**（归一化字数 ≥ 60%）才采用——
 *     低于这个比例说明整句那次丢了内容（长音频上的截断/幻觉回落），宁可不换。
 * ▸ 为什么用**比例**而不是绝对字数：判据必须尺度无关（坑 53），
 *   「小明。」(2 字) 与一句 40 字的 blob 用同一个"少 6 个字就不许换"会一头沉。
 * ▸ 为什么方向是"新比旧少要怀疑、新比旧多直接放行"：拼接结果常带重复尾巴，
 *   整句那次更干净（实测多余字数 6→4），长一点通常是补回了被切掉的词。
 * ▸ ★★ 但"长一点"到某个程度就不是补词，而是**听见了别的句子**——这一条是 2026-10-07
 *   拿 `TEST_ASR_DEBUG=1 npm run test:asr-live` 当场跑出来的（不是设想）：
 *     拼接「小明,帮我记一下。今天天气会。明天下午三点的评审」
 *     重转「小明,帮我记一下。今天天气会。明天下午三点的评审**器真不错,拍麦亚。**」
 *   那一轮机器很吵（噪声底 −42.9 dBFS，自适应有声判据被顶到"几乎一直在说话"），
 *   三句话被粘成一条 utterance，于是整句音频里**本来就含后一句**，重转如实转了出来。
 *   危害有两层：① 这条字幕比拼接更乱；② 更要紧的是它把**下一句的正确定稿挤掉了**——
 *   后一句正常定稿时被 isDupOrFragment 当成"前一句的碎片"吞掉（账本里实测只剩 1 条），
 *   一次"修准确率"于是变成"丢一整句话"。这条判据的引入让 asr-live 当场由绿转红，
 *   红的是机制本身（坑 76 的反面：**有触发计数之后，才看得见它什么时候在帮倒忙**）。
 * ▸ 于是加两条**只让重变更保守**的上限（绝不因此丢字：不采用就走拼接结果）：
 *   ④ 句末标点数量不许增加（多出来的「。」= 它转的是另一句话，不是这一句的尾巴）；
 *   ⑤ 归一化长度不许超过拼接的 1.35 倍（补回被切掉的词是个位数的事，翻 1.33 倍不是）。
 *   ▸ 两条都是**比例/结构**判据，尺度无关（坑 53）：短句长句同一把尺。 */
const SENT_END_RE = /[。！？!?；;]/g;
const countSentEnds = (s) => (String(s).match(SENT_END_RE) || []).length;
function preferRefined(stitchedRaw, refinedRaw) {
  const refined = String(refinedRaw || '').trim();
  const stitched = String(stitchedRaw || '').trim();
  if (!refined) return false;
  const a = normAsrText(stitched);
  const b = normAsrText(refined);
  if (!b) return false;
  if (a === b) return false;
  if (b.length < a.length * 0.6) return false;       // 少太多 = 整句那次丢了内容
  /* ★ 两条膨胀上限**只管"变长"的情况**——这一点是 2026-10-07 夜被一条真缺陷教出来的：
   *   第一版把"句末标点数量增加"做成无条件判据，于是把一条**明显更好**的重转扔掉了：
   *     拼接「今天天气很大 武器真不错 拍卖呀」(13 字，没标点)
   *     重转「今天天气真不错，拍麦呀！」(更短、词对、只是补了标点) → 被拒 ❌
   *   而 blob 那条是**变长**的（22 → 28）。所以判据该问的从来不是"标点多了吗"，
   *   是"它是不是听见了比这一句更多的东西"——**变短的重转不可能藏着别人的句子**。
   *   ▸ 于是：只在 b 更长时才上两道闸（坑 109 同一条：为 readability 动判据，别把正在保护的东西切掉）。 */
  if (b.length > a.length) {
    /* 膨胀上限只在 stitched "长到比例有意义"时才生效（坑 53：短文本不下结论）——
     *   「小明。」(2 字) 重转成「小明，你好呀。」是**补回了被切掉的词**，
     *   拿 1.35 倍去卡它会把这种正例一起杀掉（test:asr ③.12 那条正例就是这个形状）。 */
    if (a.length >= 10 && b.length > a.length * 1.35) return false;  // 多太多 = 它听见的不止这一句
    if (countSentEnds(refined) > countSentEnds(stitched)) return false; // 多出来的句号 = 多出来的句子
  }
  return true;
}

/* ★ 2026-10-06 夜二「上一句已经说完，这一句是新的」（纯函数，test:asr 逐条断言）。
 * ▎要解决的真问题（用户那句"识别不是很准确"的字面证据）：静音检测被房间噪声/游戏声
 *   顶住时，句子只能靠 10s 保险丝收口，于是**几个人说的几句不相干的话被粘成一条字幕**：
 *     「哦 不能往上怎么接那个 大木车是不是 你好小明」
 *     「哎，是吧？ 打开白板。 小明打开打开白板。 不知道，我也没印象。」
 *   这既是"识别乱"，也是"AI 乱接话"的一半成因——blob 里埋着一次名字，整段都成了提问。
 * ▎判据只看两件事，缺一不可：
 *   ① 上一句**以句末标点收尾**（。！？～ 或问号叹号）——说话人自己已经把这句说完了；
 *   ② 新段与累积**没有任何归并关系**（mergeTranscript 走到最后一条"空格相连"）——
 *      它不是同一句的尾巴、不是更全的版本、也不是重复段。
 *   合起来 = "换句了"。此时把上一句**就地定稿**，新段另起一句，而不是继续粘。
 * ▎为什么宁可用"句末标点"这种弱信号：分段窗口 2s，两秒之间本来就可能换话题；
 *   但把切分权交给**模型自己标出的句号**，比按时间硬切更少误伤（同一句被切成两截
 *   时，前一截通常没有句号收尾）。 */
const SENTENCE_END_RE = /[。！？!?~～]\s*$/;
/* ▸ **长度下限是必须的**（2026-10-06 真跑 test:asr-live 抓回来的）：
 *   第一版只要求"上一句以句号收尾 + 新段无关"，于是模型给半截段落加的句号就把
 *   一句完整请求切成了两条——
 *     段1「小明，帮我记一下。」 段2「明天下午三点的评审。」
 *   合并时 AI 拿到的是**一整句请求**；切开之后它只听到前半句，答的自然不完整
 *   （= 用"识别不准"换了"字幕好看一点"，方向反了）。
 *   ▸ 下限判据看**归一化后的字数 ≥ 12**：那已经是"一句能独立成立的话"的量
 *   （「小明，帮我记一下」只有 8 个字 → 不许切；
 *     而真会议里那种 20~40 字的 blob「哦 不能往上怎么接那个 大木车是不是 你好小明」→ 该切）。 */
const SPLIT_MIN_NORM_CHARS = Math.max(8, Number(process.env.ASR_SPLIT_MIN_CHARS) || 12);
function startsNewSentence(accRaw, segRaw) {
  const acc = String(accRaw || '').trim();
  const seg = String(segRaw || '').trim();
  if (!acc || !seg) return false;
  if (!SENTENCE_END_RE.test(acc)) return false;
  if (normAsrText(acc).length < SPLIT_MIN_NORM_CHARS) return false;
  /* 只有"纯追加"这一种归并结果才算换句；其余分支（重复/更全/重叠拼尾）都还是同一句 */
  return mergeTranscript(acc, seg) === `${acc} ${seg}`;
}

/* ★ 2026-10-10 C2「尾巴抢跑放行」的判据（纯函数，test:asr 逐条正反断言）。
 *   ▎要回答的问题只有一个：**这段话说过之后，还有没有没被模型听过的字节？**
 *   ▸ 为什么不能用"读满当前文件"来判（这是我第一版的错，靠反例抓回来）：
 *     分段文件在 ffmpeg 换段之前**一直在长**（16k 单声道 16le = 32000 字节/秒），静音也在写。
 *     拿文件末尾当要求 ⇒ 抢跑转完（0.4~2s）时文件又长了一截，条件永远差一点，
 *     机制会安静地一次都不触发——正是坑 76 那一族"写了但从来没生效"。
 *   ▸ 正确的物理判据：**覆盖到"说话结束的那一刻"就够了**。
 *     段内第 N 字节对应时刻 ≈ birthtimeMs + N / 32000 秒 ⇒ 需要覆盖到的字节
 *     = (lastVoiceTs + rmsLagMs − birthtimeMs) × 32。
 *     `rmsLagMs`（生产传 RMS_LAG_MS=1000）是给"RMS 行比真实语音滞后"留的余量：
 *     lastVoiceTs 是**低估**的说话结束时刻，所以这个 need 比实际需要更靠后 = 偏保守。
 *   ▸ ★ 这里**刻意不要求"那次抢跑转出了字"**（我第二版这样写过，被一次实测否掉）：
 *     分段边界上那 0.08~2s 的片段本来就常常整段无人声，实测基线与 A/B 两轮里
 *     封口段与抢跑切片**都**交回 `text=""`，句尾那个「会」字从来不是这一段转出来的，
 *     而是"整句音频一次重转"救回来的。所以放行的前提是**音频已经齐**（本函数），
 *     "重转这一句会不会真跑"由调用方判（段数、worker 在途、句子不只叫了个名字）。
 *   ▸ 时间对不上（birthtime=0 / 没有 RMS 信源）一律判"没覆盖"：宁可慢，不可丢。 */
function tailCoveredByRush(o) {
  const size = Number(o && o.size);
  const born = Number(o && o.birthtimeMs);
  const lastVoice = Number(o && o.lastVoiceTs);
  const rushedTo = Number(o && o.rushedTo) || 0;
  const lagMs = Number(o && o.rmsLagMs);
  if (!(size > 0) || !(born > 0) || !(lastVoice > 0)) return false;
  const lag = Number.isFinite(lagMs) && lagMs >= 0 ? lagMs : 0;
  const needMs = lastVoice + lag - born;                       // 段内属于"说话及其滞后"的那一段时间
  if (needMs <= 0) return true;                                // 整段都出生在说话结束之后 = 纯静音段
  /* 和 size 取小也是**错的**：文件还没长到 need 时，"读满文件"并不等于"覆盖到说话结束"——
     那段还没落盘的字节里恰恰可能藏着尾字，放行了就是 10-07 修掉的"丢尾"从新入口复发。 */
  return rushedTo >= Math.ceil(needMs * 32);                   // 1ms × 32B/ms = 16kHz 单声道 s16le
}

/* ★ 2026-10-10 C2：整句音频的两个字节账助手（纯函数，test:asr 直接跑正反例）。
 *   ▸ 为什么值得搬出来：`uttAudio` 的切片现在有两个入口（抢跑前缀 + 封口余量），
 *     **到达顺序不再等于时间顺序**（seg-0008 的 delta 早于 seg-0007 的封口余量 ~150ms）。
 *     直接按 push 顺序拼，模型听到的就是"后半句排在前半句前面"的一句乱序话，
 *     而它照样会自信地转出文字——这类错不报错、只在字幕上看起来"怪"。
 *   ▸ 段名是 `seg-%04d.pcm`（补零）⇒ 字典序 = 时间序；同一段多次抢跑靠稳定排序保持先后。 */
function uttOrdered(chunks) {
  return (chunks || []).slice().sort((a, b) => {
    const ka = (a && a.k) || ''; const kb = (b && b.k) || '';
    return ka < kb ? -1 : (ka > kb ? 1 : 0);
  });
}
/* "够不够两段"按**段名去重**数：抢跑把同一段切成多条前缀，切片数会伪装成"多段"，
 *   而 REFINE_MIN_CHUNKS 的原意是"只有一段的话分段路径本来就整段转写过一次，不必再来一次"。 */
function uttSegmentKinds(chunks) {
  return new Set((chunks || []).map((c) => (c && c.k) || '')).size;
}

module.exports = {
  probeWhisper,
  transcribeFile,
  buildArgs,
  createResidentTranscriber,
  pythonNameForWorker,
  shouldWake,
  wakeReason,     // ★ 2026-10-06 夜二 'strong' | 'addressed' | ''——"这句到底是不是在叫它"
  WAKE_STRONG_RE, // 三张表都导出：浏览器那一轨跨运行时，靠断言逐字比对钉住（坑 47）
  WAKE_AMBIG_RE,
  WAKE_ADDRESS_RE,
  startsNewSentence, // ★ 2026-10-06 夜二 上一句已说完 + 新段无归并关系 → 换句（不再粘成 blob）
  tailCoveredByRush, // ★ 2026-10-10 C2 尾巴抢跑放行：抢跑是否已覆盖到"说话结束的那一刻"
  uttOrdered,        // ★ 2026-10-10 C2 整句音频按段名排序（两个入口的切片到达顺序 ≠ 时间顺序）
  uttSegmentKinds,   // ★ 2026-10-10 C2 按段名去重数段数（抢跑前缀不许伪装成"多一段"）
  wakeClause,       // ★ 2026-10-06 夜二 从合并字幕里取出"叫它的那一句"（收窄提问，不收窄账本）
  isFollowUp,
  isNameOnly,     // ★ 2026-10-04 光叫名字没说事（碎片唤醒不应答，但顺延追问窗口）
  assertRunner,
  cleanTranscript,   // ★ 2026-10-02 静音幻觉清洗（纯函数，test:asr 逐条断言）
  foldTailEcho,      // ★ 2026-10-10 句尾回声折叠（B3-①；cleanTranscript 里已生效，导出是为了单测与真实账本回扫）
  tailEchoFoldCount: () => tailEchoFolds,   // ★ 触发计数（/metrics 的 tail_echo_fold_total 用它）
  fixDomainHomophones, // ★ 2026-10-05 夜三 会议动作词别字（既要→纪要，只在贴动作词时改）
  noiseRiffReason,   // ★ 2026-10-05 夜二 同音字免疫的噪声 riff 判据（返回命中理由或 ''）
  isFragmentOf,      // ★ 2026-10-03 分段碎片的"同一句话"判据（方向性 bigram 覆盖）
  isDupOrFragment,   // ★ 2026-10-03 重复句总闸（四条判据合一，server 只调用不内联）
  mergeTranscript,   // ★ 2026-10-05 句内归并（封口全量 vs 快照半句的重叠拼接，test:asr 逐条断言）
  preferRefined,     // ★ 2026-10-07 整句重转结果的采用判据（比例而非绝对字数，宁漏修不丢字）
  normAsrText,       // ★ 2026-10-05 文本归一化唯一实现（server 的 normAsrText 委托到这里）
  bigramSet,
  measureWavLevel,   // ★ 2026-10-02 段能量闸（转写前先判断有没有出声）
  modelGainDb,       // ★ 2026-10-09 模型输入的峰值增益算式（server 两处 + 量具共用一个来源）
  gainTargetDb, gainCapDb, configureGain,   // ★ 同上：configureGain 是 config→模块 的桥（example 里的键必须真被读到）
  createVoiceTracker, // ★ 2026-10-06 "此刻有没有人说话"：相对噪声底的自适应判据（纯函数）
  wrapPcmToWav,      // ★ 2026-10-05 PCM 渐进段的 WAV 包装（转写引擎只吃 WAV）
  pcmToWavBuffer,    // ★ 2026-10-05 同上，buffer 版（尾段 delta 快照直接用）
  ASR_PROMPT,
  DEFAULT_MODEL,
  DEFAULT_SEGMENT_SEC,
  ASR_CONCURRENCY,
  WAKE_RE,
  PY_ENV,
};
