/* ══════════════════════════════════════════════════════════════
 * scripts/test-asr.js —— 服务端语音识别（ASR）自测 ★ 09-28
 *
 * ▎为什么必须有一个 ASR 自测：（这条线踩过的最贵一脚）
 *   whisper 明明装好了，服务器却一直报"未检测到 whisper"→ asrEnabled=false →
 *   前端悄悄退回浏览器 Web Speech（用户实测："不要再用浏览器的了"）。
 *   根因是探测命令在 Windows GBK 控制台下崩溃（退出码 1），**而没有任何测试盯着它**。
 *   所以本脚本的第一条断言就是"探测必须成功"——把这次事故焊死在 CI 里。
 *
 * ▎四段验证（全部可离线跑，不花钱）：
 *   ① 探测：probeWhisper() 必须返回 runner（形态白名单通过）；
 *   ② 真实转写：用 Windows 系统 TTS 合成一句中文 → whisper 转回文字 → 断言认得出"小明"；
 *   ③ 对话逻辑：shouldWake 唤醒词容错 + isFollowUp 追问窗口；
 *   ④ 在线自检（可选）：若 3001 上跑着服务器，断言 /config.json 的 asrEnabled === true
 *      （正是本次 bug 的回归断言；服务器没起就 SKIP，不算失败）。
 *
 * ▎运行：npm run test:asr
 * ══════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Asr = require('../sfu/ai/asr');

let pass = 0, fail = 0, skip = 0;
/* ★ 2026-10-05 加第三个可选参数 detail：原来 ok 只收 (name, cond)，
 *   于是"哪几条用例挂了"只能靠人再跑一遍脚本去猜。红要红得清楚（坑 57 那条口诀），
 *   失败时把明细打在下一行。老的两参调用完全不受影响。 */
/* 坑 110 的常驻守卫：本文件约定 ok(名字, 条件)；写成 (条件, 名字) 会让断言**永远绿**，
 *   所以顺序错了要当场红，而不是安静地打印一句 `PASS true`。 */
const { guard } = require('./assert-order-guard.js');
const ok = (name, cond, detail) => {
  const bad = guard('name-first', name, cond);
  if (bad) { fail++; console.log(`  FAIL  ${String(name).slice(0, 60)}\n        ↳ 参数顺序守卫：${bad}`); return; }
  if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}`); if (detail) console.log(`        ↳ ${detail}`); }
};
const skipped = (name, why) => { skip++; console.log(`  SKIP  ${name}（${why}）`); };

// 用 Windows 自带 TTS 造一段可复现的中文语音（零依赖、不联网）
function makeSpeechWav(dir) {
  const wav = path.join(dir, 'asr-selftest.wav');
  const ps = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    // 中文音色（Huihui 是简体中文 Windows 的常驻音色）；挑不到就抛错让上层 SKIP
    "$zh = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'zh*' } | Select-Object -First 1",
    "if (-not $zh) { throw 'no-zh-voice' }",
    '$s.SelectVoice($zh.VoiceInfo.Name)',
    '$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
    `$s.SetOutputToWaveFile('${wav.replace(/'/g, "''")}', $fmt)`,
    "$s.Speak('小明，请帮我把明天的会议改到下午三点。')",
    '$s.Dispose()',
  ].join('; ');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 60000, windowsHide: true });
  return wav;
}

// 拼一个 16k/单声道/16bit 的 PCM wav（44 字节头 + 样本）：能量闸的测试素材，零依赖不联网
function writeWav(file, samples) {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + samples.length * 2, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(16000, 24); head.writeUInt32LE(32000, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(samples.length * 2, 40);
  fs.writeFileSync(file, Buffer.concat([head, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)]));
}

(async () => {
  console.log('\n=== ① 探测：whisper 必须可用（本次事故的回归断言）===');
  const runner = await Asr.probeWhisper();
  ok('probeWhisper() 找到可用 runner', !!runner);
  if (runner) {
    ok(`runner 形态合法（kind=${runner.kind}）`, !!Asr.assertRunner(runner));
    console.log(`        → ${runner.label}`);
  } else {
    console.log('        （本机确实没装 whisper 时，下面转写测试会 SKIP——生产部署请 pip install -U openai-whisper）');
  }

  console.log('\n=== ② 真实转写：中文语音 → 文字 ===');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asr-test-'));
  let wav = null;
  try {
    wav = makeSpeechWav(dir);
    ok('系统 TTS 合成测试语音（16k 单声道 wav）', fs.existsSync(wav) && fs.statSync(wav).size > 10000);
  } catch (e) {
    skipped('系统 TTS 合成测试语音', `本机没有中文 SAPI 音色（${String(e.message).slice(0, 40)}）`);
  }
  if (wav && runner) {
    const t0 = Date.now();
    const text = await Asr.transcribeFile(runner, wav, { outDir: dir, model: 'tiny' });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`        → 转写结果：「${text}」（${secs}s）`);
    ok('whisper 转出非空文本', text.length > 0);
    ok('转写包含唤醒词「小明」', Asr.shouldWake(text));
    ok('转写包含语义关键词（会议/明天/三点 任一）', /会议|會議|明天|三点|三點/.test(text));
  } else {
    skipped('whisper 真实转写', runner ? '缺少测试语音' : 'whisper 未安装');
  }

  console.log('\n=== ③ 对话逻辑：唤醒词容错 + 追问窗口 ===');
  ok('shouldWake("小明，帮我记一下") = true', Asr.shouldWake('小明，帮我记一下'));
  ok('shouldWake("小鸣你听得到吗") = true（识别把名字听岔也算）', Asr.shouldWake('小鸣你听得到吗'));
  ok('shouldWake("今天下午三点开会") = false（没叫名字不接话）', !Asr.shouldWake('今天下午三点开会'));
  const now = Date.now();
  ok('isFollowUp：窗口内 = true（免唤醒追问）', Asr.isFollowUp(now + 15000, now));
  ok('isFollowUp：窗口过期 = false', !Asr.isFollowUp(now - 1, now));
  ok('isFollowUp：未建立窗口 = false', !Asr.isFollowUp(0, now));

  /* ★ 2026-10-04 光叫名字没说事（isNameOnly）。
   * ▎为什么这条必须单独测：重复句闸管的是"这一句和上一句是不是同一句"，
   *   而"名字单独成句"常常**没有可比的上一句**（第一次喊它、或前句早就出了 15s 窗口）——
   *   那时旧代码会拿一个光秃秃的「小明」去问模型，模型只能把上一轮答案复述一遍
   *   （用户看到的"它又在重复接话"）。判据不是"像不像重复"，是"这句话里有没有正事"。 */
  ok('isNameOnly("小明") = true（只叫名字，不该拿它去问模型）', Asr.isNameOnly('小明') === true);
  ok('isNameOnly("小明小明") = true（连着叫两声也不是问题）', Asr.isNameOnly('小明小明') === true);
  ok('isNameOnly("小明把纪要生成一下") = false（有正事，照常答）',
    Asr.isNameOnly('小明把纪要生成一下') === false);
  ok('isNameOnly("小明你好") = false（带内容的问候不是碎片，别把人晾着）',
    Asr.isNameOnly('小明你好') === false);
  ok('isNameOnly：形近字没归一也认（名字表只有一个来源，复用 WAKE_RE）',
    Asr.isNameOnly('小铭') === true && Asr.isNameOnly('小鸣你听得到吗') === false);
  /* ★ 2026-10-05 夜：真机把这张表逼宽了一格。房间 283648 用户说「小明」，
   *   模型写下来的是 **「你好 小米 下面」** —— 旧表没有"米"，于是"我叫了它它不理"。
   *   这类缺陷不会以报错的形式出现，只会以"用户以为功能没做"的形式出现。 */
  ok('shouldWake 认「小米」（模型把小明听成米是常态，2026-10-05 真机实锤）',
    Asr.shouldWake('你好 小米 下面') === true && Asr.shouldWake('晓鸣，把纪要生成一下') === true);
  ok('shouldWake 不误唤常见人名「小敏」（误唤醒比漏唤醒更烦人，边界写死）',
    Asr.shouldWake('这个让小敏跟进一下') === false);
  ok('isNameOnly 对变体同样成立（「小米」单独成句也不该拿它去问模型）',
    Asr.isNameOnly('小米') === true && Asr.isNameOnly('小茗把纪要生成一下') === false);
  /* 两张表必须一致：服务端 WAKE_RE 与浏览器那一轨的 AI_WAKE_RE（跨运行时，
     做不到单一来源，就用断言把"必须相同"钉住——改了忘同步会当场红）。 */
  /* ★ 2026-10-06 夜二 「正常会议里没叫它就不该说话」（用户原话推动的电池）。
   * ▎全部取自真实账本 sfu/captions/cap-286716-20261006.jsonl（21 条麦克风转写、
   *   AI 答了 18 次）。**负例就是用户当场抱怨的那几句**：「拍卖啊！」「咳咳。」
   *   「爱丽。」「你把手机放了吧。」——旧判据下它们要么被 20s 追问窗口接走，
   *   要么（如「说小命的话」）被旧表里的 命 直接唤醒。
   * ▎为什么值得钉成断言而不是只改代码：这三条成因各自都有"讲得通"的理由，
   *   功能测试一条都不会红；只有拿真会议的句子过一遍才看得见。 */
  {
    const NEG = [
      '拍卖啊！', '你好。', '能卖吗？', '咳咳。', '爱丽。', '哈哈哈。', '二卡手表。',
      '你把手机放了吧。', '看吧，我。 对呀。', '发送一个小信息。',
      '不是你，这你把游戏是。 寂寞啊！ 他的视觉太灵敏了。',
      '叫啥？别人的哥哥。 李然讲的：“如果不不。” 说小命的话，他是最应该听见话。 对不对？我们。',
      '那个。 哎，我。 我操！', '一直在玩自己的号。',
    ];
    const miss = NEG.filter((s) => Asr.shouldWake(s));
    ok('真实会议的普通发言一律不唤醒（14 句负例，含旧表会误醒的「小命」）',
      miss.length === 0, `误醒：${miss.join(' | ')}`);
    const POS = ['你好小明', '小明 你的脸子 我们叫吗？', '小明打开打开白板', '关闭白板，小明',
      '小明，帮我记一下明天下午三点的评审会', '你好 小米 下面'];
    const dead = POS.filter((s) => !Asr.shouldWake(s));
    ok('真叫它的句子仍然全部接住（6 句正例，含 10-05 实测的「小米」写法）',
      dead.length === 0, `漏醒：${dead.join(' | ')}`);
    ok('歧义写法单独出现不算叫它（「小米」是品牌/人名，「小命」是常用词）',
      Asr.shouldWake('我买了个小米') === false && Asr.shouldWake('救命啊') === false);
    ok('分层判据本身：歧义写法要称呼语境、强写法不用',
      Asr.wakeReason('你好 小米 下面') === 'addressed' && Asr.wakeReason('小明打开白板') === 'strong'
        && Asr.wakeReason('我买了个小米') === '');
    /* ★ 这一条是被本轮自己的一个错误逼出来的：我在文件顶部改了 shouldWake 的实现，
     *   而下面那份旧的同名函数声明**提升后把它覆盖了**——判据改了、行为一字未动，
     *   且两条电池断言红得莫名其妙。同名函数声明"后写的胜出"，node --check 不管、
     *   单测不写就永远看不见。这条断言把"两个入口必须同真同假"钉住（坑 47 的函数版）。 */
    const disagree = [...NEG, ...POS].filter((s) => Asr.shouldWake(s) !== !!Asr.wakeReason(s));
    ok('判据同源：shouldWake 与 wakeReason 对同一句必须同真同假（防同名函数覆盖）',
      disagree.length === 0, disagree.join(' | '));
  }
  /* ★ 2026-10-06 夜二 「换句」判据：不再把几句不相干的话粘成一条 40 字 blob。
   *   同一场会里「哦 不能往上怎么接那个 大木车是不是 你好小明」就是这么来的——
   *   它既是"识别不准"的字面证据，也是"AI 答得莫名其妙"的成因（blob 里埋着一次名字）。 */
  {
    ok('startsNewSentence：累积句已够长 + 有句末标点 + 新段无关 → 换句（blob 不再粘下去）',
      Asr.startsNewSentence('哦 不能往上怎么接那个 大木车是不是 你好小明。', '拍卖啊！') === true);
    /* ★ 这条是**真跑抓回来的反例**（第一版没有长度下限，test:asr-live 直接把一句请求切成两条，
     *   AI 只听到「小明，帮我记一下」就答了，后半句「明天下午三点的评审」凭空丢失）。
     *   判据的形状：**别为了字幕好看去牺牲请求完整性**。 */
    ok('startsNewSentence：半截请求不许切（「小明，帮我记一下。」只有 8 字 → 继续等后半句）',
      Asr.startsNewSentence('小明，帮我记一下。', '明天下午三点的评审。') === false);
    ok('startsNewSentence：上一句没说完（无句末标点）→ 继续累积，不许切半句',
      Asr.startsNewSentence('帮我记一下明天下午', '三点的评审会。') === false);
    ok('startsNewSentence：新段是同一句的更全版本 → 不换句（走归并替换）',
      Asr.startsNewSentence('把白板打', '把白板打开。') === false);
    ok('startsNewSentence：新段是重复段 → 不换句（否则同一句被定稿两遍）',
      Asr.startsNewSentence('你好小明。', '你好小明') === false);
  }
  /* ★ 2026-10-06 夜二 「叫它的那一句」：blob 收窄提问（用户"答非所问"的另一半）。
   *   全部取自真实账本原句——不是我想像的输入。 */
  {
    ok('wakeClause：只取叫它的那一小句（真实 blob：三句话里夹着一条指令）',
      Asr.wakeClause('哎，是吧？ 打开白板。 小明打开打开白板。 不知道，我也没印象。') === '小明打开打开白板。',
      Asr.wakeClause('哎，是吧？ 打开白板。 小明打开打开白板。 不知道，我也没印象。'));
    ok('wakeClause：称呼在前半句时也不把后半句丢掉（「小明。」+请求 这种分段形态）',
      Asr.wakeClause('小明。 帮我记一下明天下午三点的评审会。') === '小明。 帮我记一下明天下午三点的评审会。');
    ok('wakeClause：逗号不切——「小明，帮我把这条记一下，明天下午三点」是一个整体',
      Asr.wakeClause('小明，帮我把这条记一下，明天下午三点开评审会') === '小明，帮我把这条记一下，明天下午三点开评审会');
    ok('wakeClause：没有句末标点时退回整条（宁可多给上下文，也不猜错边界）',
      Asr.wakeClause('哦 不能往上怎么接那个 大木车是不是 你好小明') === '哦 不能往上怎么接那个 大木车是不是 你好小明');
    const srv2 = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'server.js'), 'utf8');
    ok('接线：唤醒路的提问真的走了 wakeClause（判据对、没接上=白改，坑 41/56）',
      /Asr\.wakeClause\(clean\)/.test(srv2) && /const question = followUp \? [\s\S]{0,40}: ask;/.test(srv2));
  }
  /* 接线断言（判据对、没接上 = 白改，坑 41/56 家族） */
  {
    const srv = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'server.js'), 'utf8');
    ok('接线：追问窗口默认 0（不喊名字就不接话），且留了 env 开关做 A/B',
      /CONFIG\.aiChatWindowSec[\s\S]{0,90}\? 0 :/.test(srv) && !/aiChatWindowSec\)\s*\|\|\s*20/.test(srv)
        && /process\.env\.AI_CHAT_WINDOW_SEC/.test(srv),
      '没有 env 开关就没法证明"这条断言在旧行为下会红"（量具要能读出 0）');
    ok('接线：AI 主动发言默认关（"没人叫它也可能插话"那条路要显式开）',
      /const AI_PROACTIVE_SAY = CONFIG\.aiProactiveSay === true/.test(srv)
        && /function maybeAiSpeakUp[\s\S]{0,140}if \(!AI_PROACTIVE_SAY\) return/.test(srv));
    ok('接线：被分段切断的半句走"一次性续接"（用过即作废，不给整场会续命）',
      /room\.aiAskTailUntil = now \+ AI_ASK_TAIL_MS/.test(srv)
        && /if \(splitTail\) room\.aiAskTailUntil = 0;/.test(srv));
    ok('接线：换句判据真的接进转写累积，且定稿原因记 split（不是 silence，latMs 不许编）',
      /Asr\.startsNewSentence\(u\.text, text\)/.test(srv) && /finalizeUtterance\(memberId, 'split'\)/.test(srv));
  }
  {
    /* 三张表都要一致：跨运行时做不到单一来源，就用断言钉住（改了忘同步 = 当场红）。 */
    const cli = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'client.js'), 'utf8');
    const grab = (name) => {
      const m = cli.match(new RegExp(`const ${name} = (\\/[^\n]+\\/);`));
      return m ? m[1] : '';
    };
    const pairs = [
      ['AI_WAKE_RE', String(Asr.WAKE_RE)],
      ['AI_WAKE_STRONG_RE', String(Asr.WAKE_STRONG_RE)],
      ['AI_WAKE_AMBIG_RE', String(Asr.WAKE_AMBIG_RE)],
      ['AI_WAKE_ADDRESS_RE', String(Asr.WAKE_ADDRESS_RE)],
    ];
    const drift = pairs.filter(([c, s]) => grab(c) !== s)
      .map(([c, s]) => `${c}: client=${grab(c) || '(没找到)'} server=${s}`);
    ok('唤醒判据的三张表两处一致（asr.js 与 client.js 逐字相同）',
      drift.length === 0, drift.join(' / '));
    ok('接线：浏览器那一轨用的是分层判据（不再是整张表一视同仁）',
      /if \(AI_NICKNAME && aiWakeHere\(text\)/.test(cli) && !/AI_WAKE_RE\.test\(text\)/.test(cli));
  }
  /* 延迟读数的诚实性（坑 90 末段挂的待办）：只有"静音确认"的定稿才算"说完→上屏"。
     真机实锤：⏱ 显示 0.0s，而同一句真实等待 ~10s——那是人还在说时被保险丝强制收口。 */
  {
    const srv = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'server.js'), 'utf8');
    ok('接线：定稿原因真的传进 finalizeUtterance（silence / max-age / max-open / gap / flush）',
      /* ★ 2026-10-07 判据从 `silenceConfirmed` 改名成 `silenceOk`：静音确认之外还要求
       *   "没有未消费的尾巴段"（否则「评审会」会被切成「评审。」+下一句的「会」）。
       *   这条断言跟着改口径，别让它变成"改了判据就红"的假红。 */
      /const reason = silenceOk \? 'silence' : \(maxAge \? 'max-age' : \(rmsAlive \? 'max-open' : 'gap'\)\);/.test(srv) &&
      /finalizeUtterance\(mid, reason\)/.test(srv));
    ok('接线：非 silence 定稿不产延迟读数（界面宁可不显示也不撒谎）',
      /const latMs = reason === 'silence' && lastVoiceTs/.test(srv));
    /* ★ 2026-10-09 这条断言被我的重构改红了一次，红得对但原因是**形态变了**（坑 133）：
     *   原来它 grep 的是 `handleSegment` 里那行内联的 `: -62)`，而今天为了录制页能读同一个
     *   闸门值，把它收成了 `asrMinPeakDb()` 一处。判据随之更新——要求反而更强：
     *   既要有那一个函数（默认 -62），也要两条管线路径**真的都调它**。 */
    ok('校准：静音判定阈值随能量闸一起下移（-38 是响麦校准的，安静麦克风整场不刷新）',
      /ASR_FLUSH_DB\) \|\| -50/.test(srv)
        && /function asrMinPeakDb\(\)[\s\S]{0,400}: -62;/.test(srv)
        && /const ASR_MIN_PEAK_DB = asrMinPeakDb\(\)/.test(srv));
  }

  /* 接线断言（坑 41/56：模块写对了不等于调用点接上了）：

     闸必须存在，且位置在"在途锁"之前——碎片不该占锁、也不该被算成"AI 答了一次"。 */
  {
    const srv = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'server.js'), 'utf8');
    const iName = srv.indexOf('Asr.isNameOnly(normAsrText(clean))');
    const iLock = srv.indexOf('if (room.aiAnswering)');
    const iWin = srv.indexOf('COLLAB.answers += 1');
    ok('接线：server 真在应答前判了 isNameOnly，且排在在途锁与应答计数之前',
      iName > 0 && iLock > iName && iWin > iName);
    ok('接线：光叫名字那一轮会顺延追问窗口（否则后半句到达时没人接它）',
      /isNameOnly\(normAsrText\(clean\)\)\) \{[\s\S]{0,400}room\.aiChatUntil = now \+ AI_CHAT_WINDOW_MS/.test(srv));
    /* ★ 2026-10-05 夜二：连续音频（房间里有视频在放）会让 idleTextMs 永远在刷新，
       只靠"多久没变长"那把保险丝，一句字幕可以拖到十几秒——实测 20:47:17 的片段
       到 20:47:27 才定稿。必须有第二把量"这句开了多久"的闸。 */
    ok('延迟：第二把保险丝存在且参与成句判据（ageMs / max-age / 默认 6s）',
      /UTTERANCE_MAX_AGE_MS = Math\.max\(4000,/.test(srv) &&
      /const due = maxAge \|\| \(rmsAlive/.test(srv) &&
      /'max-age'/.test(srv));
    ok('延迟：三把强制成句闸（max-age / max-open / gap）都不产延迟读数',
      /const latMs = reason === 'silence' && lastVoiceTs/.test(srv));
    /* 本轮我自己写出的那个 TDZ 之所以能藏一整场，就是因为段级异常只在 ASR_DEBUG 下打印。
       这条断言钉的是"吞异常必须留证据"（坑 76），不是某一行代码。 */
    ok('证据：段处理异常不再只在 ASR_DEBUG 下打印（首条 + 每 20 条上控制台，每次都进结构化日志）',
      /segErrCount === 1 \|\| segErrCount % 20 === 0 \|\| process\.env\.ASR_DEBUG/.test(srv) &&
      /'asr-segment-error'/.test(srv));
  }

  /* === ③.5 常驻转写 worker（★ 09-29"识别不灵敏"的主解） ===
   * ▎验三件事：worker 能起（模型加载成功）、转写结果可用、kill 后干净退场。
   *   第 1 次转写含模型加载（慢），第 2 次应显著更快——这正是常驻的意义，
   *   但 CI 机器速度不一，只断言"第 2 次不比第 1 次慢"不过分。 */
  console.log('\n=== ③.5 常驻 worker：模型只加载一次 ===');
  if (runner && wav) {
    const w = Asr.createResidentTranscriber({ model: 'tiny', timeoutMs: 60000 });
    const t1 = Date.now();
    const text1 = await w.transcribe(wav);
    const s1 = (Date.now() - t1) / 1000;
    ok('worker 能启动并转写（alive=true）', w.alive && text1.length > 0);
    ok('worker 转写包含唤醒词「小明」', Asr.shouldWake(text1));
    console.log(`        → 第1次（含模型加载）${s1.toFixed(1)}s：「${text1.slice(0, 40)}」`);
    const t2 = Date.now();
    const text2 = await w.transcribe(wav);
    const s2 = (Date.now() - t2) / 1000;
    ok(`第2次转写明显更快（${s2.toFixed(1)}s ≤ ${s1.toFixed(1)}s，模型只加载一次）`, text2.length > 0 && s2 <= s1 + 0.5);
    w.kill();
    ok('kill() 后 worker 干净退场（alive=false）', !w.alive);
  } else {
    skipped('常驻 worker 自检', runner ? '缺少测试语音' : 'whisper 未安装');
  }

  /* === ③.6 静音幻觉清洗 + 能量闸（★ 2026-10-02 回归）===
   * ▎现场证据（sfu/captions/cap-746646-20261002.jsonl）：账本里每 2.4~4s 一条一模一样的
   *   「请用简体中文输出。」——那不是有人说话，是 whisper 在**纯静音段**把 --initial_prompt
   *   续写成了句子。每条假字幕都落进 20s 追问窗口 → AI 每两三秒重复回答一次（用户报的
   *   "一直收到重复的一句话/对话很混乱/后来不出声"全是这一条链上的下游症状）。
   * ▎这一段全是**纯函数断言**：不要真模型、不要 GPU、跑得快且永远可复现（同 ③ 的思路）。
   *   上一轮事故正是因为"没有任何测试盯着探测口径"；这一轮同理——**没人断言过的清洗
   *   等于没有清洗**。 */
  console.log('\n=== ③.6 静音幻觉清洗 + 能量闸 ===');
  ok('丢掉提示词回显「请用简体中文输出。」', Asr.cleanTranscript('请用简体中文输出。') === '');
  ok('丢掉复读风暴（同一句连说三遍 → 空串）',
    Asr.cleanTranscript('请用简体中文输出。 请用简体中文输出。 请用简体中文输出。') === '');
  ok('提示词原文整条也被丢（不留光秃秃的标点）', Asr.cleanTranscript(`${Asr.ASR_PROMPT}。`) === '');
  ok('丢掉经典幻句「字幕by XXX」与「谢谢大家」',
    Asr.cleanTranscript('字幕by Peter') === '' && Asr.cleanTranscript('谢谢大家！') === '');
  ok('真话原样保留（含唤醒词那句不许被误伤）',
    Asr.cleanTranscript('小明，帮我记一下明天下午三点的评审会。') === '小明，帮我记一下明天下午三点的评审会。');
  ok('混合情形只擦幻句、留下真句',
    Asr.cleanTranscript('请用简体中文输出。明天下午三点开评审会。') === '明天下午三点开评审会。');
  ok('只剩一个字的噪音也判"没有内容"', Asr.cleanTranscript('嗯。') === '');
  /* ★ 2026-10-05 真机实锤（房间 945328 的字幕条）：-55 闸放进来的房间噪声被模型
   *   续写成 Whisper 训练语料的**著名静音幻觉句**，上字幕条还带「小明」把 AI 唤醒，
   *   AI 对着幻觉答了一整轮。强特征锚（明镜与点点栏目/字幕君/不吝点赞）整段判噪。 */
  ok('幻觉·混合串整段判噪（用户截图原文）',
    Asr.cleanTranscript('请不吝点赞 订阅 转发 打赏支持明镜与点点栏目 请开会了 小明 字幕君 请点赞 订') === '');
  ok('幻觉·纯句判空',
    Asr.cleanTranscript('请不吝点赞，订阅，转发，打赏支持明镜与点点栏目') === '');
  /* ★ 2026-10-05 夜二（用户第二张截图）：**同音字漂移把"精确串匹配"的过滤器打穿了**。
   *   闸放宽到 -62 之后噪声确实进转写了，而模型把噪声续成 YouTube/B 站话术，
   *   实测原文里是「打赞」（不是点赞）、「收养」（不是收藏）、「多泫」——
   *   旧的四条精确正则一条都不命中，48 个字的幻觉直接上了字幕条。
   *   ▸ 判据换成"求赞家族 + 平台词"的组合 + 拉丁乱码，两者都对同音字免疫。 */
  const RIFF2 = '帮我打开 请在下一个视频里面打赞,许多 clic,支持、收养、多泫,看到更多 needL FI Ching';
  ok('幻觉·同音字漂移版整段判噪（用户 20:47 截图原文，旧精确串全都没命中）',
    Asr.cleanTranscript(RIFF2) === '' && Asr.noiseRiffReason(RIFF2) !== '');
  ok('幻觉·判据给出的是"为什么"（日志里要看得懂这句为什么被丢）',
    /强锚|求赞家族|拉丁乱码/.test(Asr.noiseRiffReason(RIFF2)));
  /* 反例三条：**判据要能红也要能绿**，只会被误杀真话的过滤器比没有更糟。 */
  ok('真话不误伤·"这个方案我点赞，大家转发一下"（只有求赞家族没有平台词）',
    Asr.cleanTranscript('这个方案我点赞，大家转发一下') === '这个方案我点赞，大家转发一下');
  ok('真话不误伤·技术词混排"这个接口用 React 重写一版"（拉丁只有 1 个词）',
    Asr.cleanTranscript('这个接口用 React 重写一版') === '这个接口用 React 重写一版');
  ok('真话不误伤·"把推广视频发到我们频道"（只有平台词，没有求赞家族）',
    Asr.cleanTranscript('把推广视频发到我们频道') === '把推广视频发到我们频道');
  /* 看板不得消化 AI 自己的话（2026-10-05 夜二实锤：AI 复述自己的回答并问"谁来认领"） */
  {
    const srv2 = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'server.js'), 'utf8');
    ok('接线：AI 的回答入账本时带 bot 标记，而 feedBoard 只消化人的话',
      /bot: true/.test(srv2) && /filter\(\(e\) => e && !e\.bot\)/.test(srv2));
  }

  ok('幻觉·真话零误伤',
    Asr.cleanTranscript('小明，帮我把这条记录一下，明天下午三点开评审会。') === '小明，帮我把这条记录一下，明天下午三点开评审会。');

  /* === ★ 2026-10-05 夜三 会议动作词的别字（真浏览器 e2e 的 ⑨ 唯一红点）===
   *   现场：说「小明，把纪要生成一下」，2s 分段转出来是「既要生成一下」。
   *   ▸ 一次对照实验把"加热词 context"这条路**实测否决**了：真话本来就已经转对，
   *     而纯静音 + context 会把 context 整句照抄回来（那句里还带「小明」= 幻觉自己唤醒自己，
   *     坑 64 换入口复发）→ 修在文本侧，且只动"贴着动作词"的那一种（坑 49：词 + 它该有的邻居）。
   *   ▸ 三条反例是这条规则的全部风险面：并列连词「既要…又要…」、常用动词「记一下」、
   *     以及完全没别的字的那句真话——它们都必须一个字不动。 */
  ok('别字纠正·动词在后（既要生成 → 纪要生成，e2e 实测原句）',
    Asr.cleanTranscript('小明，既要生成一下。') === '小明，纪要生成一下。');
  ok('别字纠正·动词在前（生成既要 → 生成纪要）',
    Asr.cleanTranscript('把生成既要这件事交给我') === '把生成纪要这件事交给我');
  ok('别字纠正·把字句（把既要 → 把纪要）',
    Asr.cleanTranscript('麻烦把既要发一下') === '麻烦把纪要发一下');
  ok('反例·并列连词不动（既要…又要…是真话，不是别字）',
    Asr.cleanTranscript('这个方案既要保证质量，又要加快进度') === '这个方案既要保证质量，又要加快进度');
  ok('反例·"既要"单独出现不动（没有动作词邻居就不下结论，坑 53）',
    Asr.cleanTranscript('我既要这个也要那个') === '我既要这个也要那个');
  ok('反例·"记一下"是正常动词，不许被当成"纪要"改掉',
    Asr.cleanTranscript('帮我把这条记一下') === '帮我把这条记一下');
  /* ★ 2026-10-07 「计要」是整场 e2e 里唯一**活到定稿**的别字（分段 4 次、整句重转后仍 4 次，
   *   而同场「记要」一次都没出现）：旧表只收 既要/记要，这一种一直漏。
   *   ▸ 反面钉住跨词：「从长计」+「要」是真话切出来的相邻字，中文没有词边界，
   *     这条规则一旦放开裸词，下一句被改脏的就是它（坑 49 第四次应验）。 */
  ok('别字纠正·把字句「把计要生成一下」→「把纪要生成一下」（e2e 实测原句，四次全错那一句）',
    Asr.cleanTranscript('小明。 把计要生成一下。') === '小明。 把纪要生成一下。');
  ok('别字纠正·动词在前（生成计要 → 生成纪要，动词本身一个字不动）',
    Asr.cleanTranscript('麻烦生成计要发大家') === '麻烦生成纪要发大家');
  ok('别字纠正·量词形（一段计要 → 一段纪要，与「记要」同一条规则）',
    Asr.fixDomainHomophones('生成一段计要。') === '生成一段纪要。');
  ok('反例·跨词的「从长计，要不要…」不许被改成纪要（漏修只是错字，误修是把真话改脏）',
    Asr.cleanTranscript('这件事再从长计，要不要明天定。') === '这件事再从长计，要不要明天定。');
  ok('反例·「计划要求」里含「计要」吗？不含——但断言守住"裸计要无邻居不动"',
    Asr.cleanTranscript('这个计要不要单独看') === '这个计要不要单独看');
  ok('正常句子一字不动（含"纪要"的原句不被二次加工）',
    Asr.cleanTranscript('小明，把纪要生成一下。') === '小明，把纪要生成一下。');
  ok('接线：cleanTranscript 里真的调用了它（写了 ≠ 生效，坑 76）',
    /t = fixDomainHomophones\(t\)/.test(
      fs.readFileSync(path.join(__dirname, '..', 'sfu', 'ai', 'asr.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')));
  /* 定稿原因（fin）必须同时下发到客户端**和**写进账本：只有客户端带了，事后拿 jsonl 一查
   * 仍然分不清"引擎慢被切断"与"读数丢了"（坑 56：内层算出来了、外层没带出来）。 */
  {
    const srv3 = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'server.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    ok('接线：定稿的 fin 既进 asr-caption，也进字幕账本',
      /emit\('asr-caption'[\s\S]{0,600}?fin: reason,/.test(srv3)
      && /lat: latMs \|\| undefined,[\s\S]{0,300}?fin: reason,/.test(srv3));
  }
  // 能量闸：造两个 wav（纯静音 / 有声音）——静音必须判"没出声"，有声绝不能误删
  const silWav = path.join(dir, 'gate-silence.wav');
  const vozWav = path.join(dir, 'gate-voice.wav');
  writeWav(silWav, new Int16Array(16000));
  const tone = new Int16Array(16000);
  for (let i = 0; i < tone.length; i++) tone[i] = Math.round(8000 * Math.sin(2 * Math.PI * 220 * i / 16000));
  writeWav(vozWav, tone);
  const sil = Asr.measureWavLevel(silWav);
  const voz = Asr.measureWavLevel(vozWav);
  ok('能量闸：纯静音峰值 ≤ -90 dBFS（会被跳过，连模型都不叫）', !!sil && sil.peakDb <= -90);
  ok('能量闸：正常音量语音峰值 > -45 dBFS（绝不被当静音删掉）', !!voz && voz.peakDb > -45);
  ok('能量闸：文件读不到 → 返回 null（fail-open：判断不了就照常转写）',
    Asr.measureWavLevel(path.join(dir, 'nope-not-here.wav')) === null);

  /* === ③.7 本地 Qwen worker：推理卡死的处置（★ 2026-10-05 e2e 实测根因）===
   *   实测：单次推理 **93.5s**（同场 p50 只有 0.5s），而旧默认预算是 **120s**——
   *   一次自回归失控就让全场字幕静默两分钟，且下一段还要排在这次跑不完的推理后面
   *   （紧随的那段实测"排队 83.7s"）。用户报的"语音识别一段时间就停了"正是这条。
   *   ▸ 这几条钉的是"别退回旧写法"：预算要有界、超时要重启 worker、
   *     主动重启不许算进"连崩三次"（否则自愈反而把引擎永久判死）、重启要有冷却。 */
  console.log('\n=== ③.7 本地 worker 推理卡死：有界预算 + 重启 + 冷却（2026-10-05 根因）===');
  {
    const qlSrc = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'ai', 'asr_qwen_local.js'), 'utf8');
    const wm = (qlSrc.match(/ASR_TIMEOUT_MS\)\s*\|\|\s*(\d+)/) || [])[1];
    ok(`单次推理默认预算有界（实测 ${(Number(wm) / 1000).toFixed(0)}s ≤ 20s；旧值 120s = 全场静默两分钟）`,
      !!wm && Number(wm) > 0 && Number(wm) <= 20000);
    ok('超时不只丢这一段，还会重启卡死的 worker（不重启则下一段照样排队）',
      /abandonStuckWorker\s*\(/.test(qlSrc));
    ok('主动重启不计入"连崩三次"（crashStreak 到 3 会永久判死引擎，自愈不该把自己判死）',
      /stallRestart/.test(qlSrc) && /!state\.dead\s*&&\s*!state\.stallRestart/.test(qlSrc));
    ok('重启带冷却（模型重新加载要 10~20s，连续重启会互相踩）',
      /ABANDON_COOLDOWN_MS/.test(qlSrc));
    const fnBody = (qlSrc.match(/function abandonStuckWorker[\s\S]*?\n}/) || [''])[0];
    ok('重启路径自己 boot() 拉起、且不置 state.dead（dead=永久判死，本意是"换人接着干"）',
      fnBody.length > 0 && /boot\(\)/.test(fnBody) && !/state\.dead\s*=/.test(fnBody));
    /* 空串必须能被上游接住并回落——否则"超时"就等于"这段话永久消失"（丢字）。 */
    const srvSrc = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'server.js'), 'utf8');
    ok('本地引擎返回空串时上游回落 whisper（这一段不会凭空消失）',
      /if \(!text && engine !== 'qwen'\)/.test(srvSrc));
    /* ★ 2026-10-05 第二刀：**两个时钟必须分开**（实测把"AI 永不接话"钉死在这里）。
     *   旧代码只有 u.lastAt，而它在**纯重复**（mergeTranscript 判"只续窗不追加"）时也刷新
     *   ⇒ "有人不停说同样的话"= 句子永远显得不空闲 = 成句闸的 10s 保险丝永远跳不到。
     *   实测：sinceAppend 最高冲到 9807ms，离 10000ms 只差 193ms，就被一次没加字的重复段清零；
     *   后果是一条全静默链：不成句 → 不定稿 → 不唤醒 → AI 不接话 → 喇叭不出声，
     *   而日志里除了"没有 `成句：` 行"以外没有任何异常。 */
    /* 负向判据要**先把注释剥掉**再扫源码：本项目吃过两次"我自己的注释里写了被禁的字面形式，
     *   于是断言永远红"（alert( 那次、这次 bornAt 引用后声明变量的那次）。
     *   判据：负向断言扫的是**代码**，不是"文件里出现过的字符串"。 */
    const code = srvSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    ok('句子表带 textAt（"这句话多久没变长"，与"多久有人说话"的 lastAt 分开）+ bornAt（这句开了多久）',
      /u\.textAt\s*=/.test(srvSrc) && /\{ text: '', lastAt: 0, textAt: 0, bornAt: Date\.now\(\) \}/.test(srvSrc)
      /* bornAt 绝不能引用后面才声明的 const（TDZ）——本轮真实炸过一次，见 server 那段注释 */
      && !/bornAt: nowU/.test(code));
    ok('成句保险丝读 textAt 而不是 lastAt（否则重复语音会把保险丝永远重置）',
      /const idleTextMs = now - \(u\.textAt \|\| u\.lastAt\)/.test(srvSrc)
        && /idleTextMs > UTTERANCE_MAX_OPEN_MS/.test(srvSrc));
    /* 坑 76 的纪律：机制必须能证明自己发生过。这条闸一旦"永不打开"，
     * 外面看到的只是"没有成句行"，与"成句块每轮抛错"完全同形——所以闸状态与异常都要可见。 */
    ok('成句闸有触发证据（每秒打印守卫状态，不再靠猜）',
      /成句闸 segInFlight=/.test(srvSrc));
    ok('成句块的异常不再静默（静默 catch 会让"没执行"与"每轮抛错"同形）',
      /成句块异常/.test(srvSrc));
  }

  /* === ③.7b worker 池（★ 2026-10-07 H1：多人会议的容量档）===
   *   ▎为什么单独一组：池化最容易坏在"建了但没人用"——两个 worker 都在，
   *     而路由没接通 ⇒ 所有请求落 0 号槽，2 号槽白占 1.9GB 显存。
   *     这台量具第一版就踩中了这件事（测出来"加 worker 吞吐反降"，真凶是没传 key）。
   *   ▸ 所以这里钉的全是**接线**，不是纯函数：判据本身（FNV 分片）只有一条稳定性断言。 */
  console.log('\n=== ③.7b worker 池：分片稳定 + 路由接线 + 空槽兜底（2026-10-07 H1）===');
  {
    const poolSrc = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'ai', 'asr_qwen_local.js'), 'utf8');
    const srvSrc = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'server.js'), 'utf8');
    ok('槽位工厂是"原单例整体包进去"（自愈那套逻辑一字未改：预算/重启/冷却/判死全在里面）',
      /function makeSlot\(\) \{/.test(poolSrc) && /abandonStuckWorker/.test(poolSrc)
        && /ABANDON_COOLDOWN_MS/.test(poolSrc) && /stallRestart/.test(poolSrc));
    ok('分片按**成员稳定**（不是轮询：同一个人的两段回同一个槽，否则顺序会错乱）',
      /function slotIndexForKey\(key\)/.test(poolSrc) && /0x811c9dc5/.test(poolSrc));
    ok('★ 路由键一路带到 transcribe（分段与整句两条路都带）——漏一条就是 2 号槽白加载',
      /local\.transcribe\(wavPath, \{ key \}\)/.test(srvSrc)
        && /const eng = await runEngines\(wavPath, memberId\)/.test(srvSrc)
        && /const eng = await runEngines\(feed, memberId\)/.test(srvSrc));
    ok('runEngines 把 key 透传给内层（只加外壳不改引擎链的调用形状）',
      /const runEngines = async \(wavPath, key\) => \{[\s\S]{0,200}?runEnginesInner\(wavPath, key\)/.test(srvSrc)
        && /const runEnginesInner = async \(wavPath, key\) => \{/.test(srvSrc));
    ok('池在**预热之前**配置（warm 会按配置数建槽；反过来就是永远只有一个）',
      /qAsrWarm\.configure\(/.test(srvSrc)
        && srvSrc.indexOf('qAsrWarm.configure(') < srvSrc.indexOf('qAsrWarm.warm()'));
    ok('配置数与"活着数"分开报（连崩判死/冷却中的槽名义上还在，只看配置会误判）',
      /sfu_ai_asr_qwen_workers /.test(srvSrc) && /sfu_ai_asr_qwen_workers_alive /.test(srvSrc));
    const slotDef = poolSrc.match(/const MAX_SLOTS = (\d+)/);
    ok('默认 1（= 今天的行为）；扩容要显式开——一个 worker ≈1.9GB 显存，OOM 的后果是静默回落 CPU',
      /let wantWorkers = 1;/.test(poolSrc) && !!slotDef
        && Number(slotDef[1]) >= 1 && Number(slotDef[1]) <= 4,
      slotDef ? `MAX_SLOTS=${slotDef[1]}` : '池子里没有 MAX_SLOTS 常量');
    /* 真实行为断言（拿模块自己跑，不起 GPU）：路由的稳定性与"单槽时恒为 0"。 */
    const Local = require(path.join(__dirname, '..', 'sfu', 'ai', 'asr_qwen_local.js'));
    Local.configure({ workers: 3 });
    const f = (typeof Local.transcribe === 'function') && Local.workerCount;
    ok('configure() 在建槽之前生效（workerCount 读得到配置值）',
      f === 3, `workerCount=${Local.workerCount}`);
    const idx = (k) => {
      let h = 0x811c9dc5; const s = String(k);
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
      return h % 3;
    };
    const same = Array.from({ length: 50 }, () => idx('member-XYZ-42'));
    const spread = new Set(Array.from({ length: 200 }, (_, i) => idx('sock-' + i.toString(36) + 'q')));
    ok('同一成员恒走同一槽；不同成员铺得开（三个槽都被用到 = 池真的在分担）',
      new Set(same).size === 1 && spread.size === 3,
      `稳定=${new Set(same).size} 值，200 个 id 覆盖 ${spread.size}/3 槽`);

    /* ★ "配了几个"这件事的判据只许有一份（坑 47）。
       为什么专门钉：doctor 的显存预算体检与服务器的 configure 必须读**同一个数**——
       两处各写一份优先级，就会出现"体检说配了 2 个、服务器实际起了 1 个"，
       而这句话没人会去怀疑（它是一行 ✅）。反面同样要钉：env 传 0 与"没传"必须可分辨（坑 54）。 */
    const docSrc = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'doctor.js'), 'utf8');
    ok('resolveWorkers 的优先级：env > config > 默认 1，且钳在 1..MAX_SLOTS',
      Local.resolveWorkers(undefined, undefined) === 1
        && Local.resolveWorkers(undefined, 2) === 2
        && Local.resolveWorkers('3', 2) === 3
        && Local.resolveWorkers('0', 2) === 1          // 钳到 1（但"传了 0"不等于"没传"）
        && Local.resolveWorkers('', 2) === 2           // 空串 = 没传
        && Local.resolveWorkers('9', undefined) === Local.MAX_SLOTS,
      `${Local.resolveWorkers(undefined, undefined)}/${Local.resolveWorkers(undefined, 2)}/`
        + `${Local.resolveWorkers('3', 2)}/${Local.resolveWorkers('0', 2)}/${Local.resolveWorkers('', 2)}/`
        + `${Local.resolveWorkers('9', undefined)}`);
    ok('★ 服务器与 doctor 都调这一个函数，谁都不再自己写优先级（体检报的数=实际起的数）',
      /qAsrWarm\.configure\(\{ workers: qAsrWarm\.resolveWorkers\(/.test(srvSrc)
        && /Q\.resolveWorkers\(process\.env\.ASR_QWEN_WORKERS/.test(docSrc)
        && !/configure\(\{ workers: numEnvOr\(process\.env\.ASR_QWEN_WORKERS/.test(srvSrc));
    /* 别用 RegExp.$1：它是**全局最后一次匹配**的捕获，后面那条无捕获组的正则一跑就被清成空串
       （本条第一版就这么红过一次——Number('') 是 0，看着像"常量配小了"其实是判据写错）。
       要取值就 match 出来存进局部变量。 */
    const vramDef = poolSrc.match(/const VRAM_PER_WORKER_MIB = (\d+)/);
    ok('预算体检用的是模块里那个常量（≈1.9GB/个），不是 doctor 自己抄一个数（改了池子不会忘改体检）',
      !!vramDef && /Q\.VRAM_PER_WORKER_MIB/.test(docSrc) && Number(vramDef[1]) >= 1000,
      vramDef ? `池子里写的是 ${vramDef[1]} MiB/个` : '池子里没有 VRAM_PER_WORKER_MIB 常量');
  }

  /* === ③.8 AI 房间动作命中电池（★ 2026-10-05）===
   *   ▎为什么值得单独一组：用户三次反馈"AI 操控实体还是实现的不行"，而服务器/客户端
   *     两边的测试都是绿的——因为**没有人测过"用户会怎么说"**。把 detectRoomAction
   *     抽成纯函数后第一件事就是拿 48 句人话去量，结果 **9 句不命中（26%）**：
   *     "白板收起来""不要字幕了""来一张白板""擦一下白板""平铺看看""把自幕打开"……
   *     症状与体感完全对得上：说一句自然话，AI 回一句漂亮话，界面一动不动。
   *   ▎这一组同时钉**反例**：设备/权限类请求（摄像头/共享/静音别人/录制/踢人）
   *     必须**不**命中这张表（它们要走各自的授权链路），闲聊也不能误触发。 */
  console.log('\n=== ③.8 AI 房间动作命中电池（26% 缺口就是"操控实体不行"的主因）===');
  {
    const RoomActions = require('../sfu/ai/roomActions.js');
    const { detectRoomAction, ROOM_ACTIONS } = RoomActions;
    const POS = [
      ['把白板打开', 'board-open'], ['开个白板吧', 'board-open'], ['帮我调出白板', 'board-open'],
      ['我们来画一张白板', 'board-open'], ['来一块白板', 'board-open'], ['打开白榜', 'board-open'],
      /* ★ 2026-10-06 光杆动词（"开白板"）：旧表要求"开个/开一下/打开"，一个字都不差的
       *   「先开白板」整条不命中——而它恰好是最短、最常说的那一句。 */
      ['开白板', 'board-open'], ['先开白板', 'board-open'], ['我们开白板吧', 'board-open'],
      ['把白板关掉', 'board-close'], ['白板收起来', 'board-close'], ['不要白板了', 'board-close'],
      ['把白板清空', 'board-clear'], ['擦一下白板', 'board-clear'], ['白板全部擦干净', 'board-clear'],
      ['撤销那一笔', 'board-undo'], ['撤回刚才那笔', 'board-undo'],
      ['打开字幕', 'captions-on'], ['开启实时字幕', 'captions-on'], ['上字幕', 'captions-on'],
      ['把自幕打开', 'captions-on'], ['加上字幕', 'captions-on'],
      ['把字幕关掉', 'captions-off'], ['不要字幕了', 'captions-off'], ['字幕收起来', 'captions-off'],
      ['切到演讲者视图', 'view-speaker'], ['换成主讲视图', 'view-speaker'], ['切导演讲者视图', 'view-speaker'],
      ['切到宫格', 'view-grid'], ['九宫阁模式', 'view-grid'], ['所有人都一样大', 'view-grid'], ['平铺看看', 'view-grid'],
    ];
    const NEG = [
      '你叫什么名字', '谢谢', '今天聊了什么', '帮我记一下明天三点开会', '午饭吃什么',
      '这个方案我点赞，大家转发一下', '服务器固定在周五上线', '既要保证质量又要加快进度', '把推广视频发一下',
      '把摄像头关掉', '帮我共享屏幕', '把张三静音', '开始录制', '把会议录制打开', '把李四踢出去',
    ];
    const miss = POS.filter(([q, w]) => detectRoomAction(q) !== w);
    ok(`${POS.length} 句自然指令全部命中（缺口=用户说的"说了不做"）`,
      miss.length === 0 || (() => { console.log('   未命中：' + miss.map((m) => `${m[0]}→期望${m[1]}实得${detectRoomAction(m[0]) || 'null'}`).join('、')); return false; })());
    const fp = NEG.filter((q) => detectRoomAction(q));
    ok(`${NEG.length} 句反例零误触发（含设备/权限类：那些必须走各自的授权链路）`,
      fp.length === 0 || (() => { console.log('   误触发：' + fp.map((q) => `${q}→${detectRoomAction(q)}`).join('、')); return false; })());
    const keys = Object.keys(ROOM_ACTIONS);
    ok('每个动作都带 cn + done 两句人话（缺 done 时客户端回执会显示空串）',
      keys.length >= 8 && keys.every((k) => ROOM_ACTIONS[k].cn && ROOM_ACTIONS[k].done));
    /* ★ 2026-10-06 组合指令 / 否定语义 / 顺序诚实（用户第四次反馈"操控实体还是不行"之后量的）。
     *   ▎detectRoomAction 只回**第一条**命中，于是「把白板打开，顺便把字幕也开一下」
     *     做了白板、字幕一动不动——而 AI 回的那句话听起来完全正常。这类缺口不报错，
     *     只会**少做**，所以必须按"说了几件就做几件"来断言（坑 76：机制在≠机制生效）。
     *   ▎这一组同时钉三类反例：
     *     ① 否定（「不要开白板」不能被执行成"开"，也不能被执行成"关"——做错方向比不做更糟）；
     *     ② 顺序（前瞻分支是零宽的，位置若记成 0 就会插队，最终状态与用户说的相反）；
     *     ③ 上限与去重（同一动作说两遍只做一次；超过 3 件说明是闲聊混进来了，宁少做别乱做）。 */
    const { detectRoomActions } = RoomActions;
    const MULTI = [
      ['把白板打开，顺便把字幕也开一下', ['board-open', 'captions-on']],
      ['打开白板和字幕', ['board-open', 'captions-on']],
      // 顺序按**说出来的先后**，不是表的顺序：这句先字幕后白板
      ['字幕打开，然后把白板打开', ['captions-on', 'board-open']],
      ['切到演讲者视图，然后切回宫格', ['view-speaker', 'view-grid']],
      // 四件取前三：view-speaker 被上限挤掉，而不是靠"哪条规则先写"
      ['把白板打开，字幕关掉，切到宫格，再切到演讲者视图', ['board-open', 'captions-off', 'view-grid']],
      ['白板打开，再把白板打开', ['board-open']],                       // 去重
      ['大家都静音一下，把白板打开', ['board-open']],                    // 越界的"静音"不产生动作
    ];
    const multiBad = MULTI.filter(([q, want]) => detectRoomActions(q).join(',') !== want.join(','));
    ok(`${MULTI.length} 组组合指令：说了几件做几件、按说出来的顺序、去重、上限 3`,
      multiBad.length === 0 || (() => {
        console.log('   不符：' + multiBad.map(([q, w]) => `${q}→期望[${w}]实得[${detectRoomActions(q)}]`).join('、'));
        return false;
      })());
    const DENIED = ['别开字幕', '不要开白板', '先不要打开白板', '不用上字幕', '别收起白板', '不要开白板，太费电了',
      /* ★ 2026-10-06 「不要关白板」曾被执行成"关"——否定副词后面跟的是**关**类动词时旧守卫不管，
       *   于是用户说"别关"，白板真被关了。**做错方向比不做更糟**，这几条是那条缺陷的哨兵。 */
      '不要关白板', '别关字幕', '不要取消字幕', '不必收起白板'];
    const deniedBad = DENIED.filter((q) => detectRoomActions(q).length > 0);
    ok(`${DENIED.length} 句否定式指令**一个动作都不做**（做错方向比不做更糟）`,
      deniedBad.length === 0 || (() => {
        console.log('   误执行：' + deniedBad.map((q) => `${q}→[${detectRoomActions(q)}]`).join('、'));
        return false;
      })());
    // 反向对照：否定副词单独用在名词前**就是**关闭的意思，不能被否定守卫吞掉
    const STILL_ON = [['不要白板', ['board-close']], ['不要字幕了', ['captions-off']], ['取消字幕', ['captions-off']],
      /* 否定副词 + **名词**（中间没有别的动词）= "不要了" = 关闭；
       * 上面 DENIED 组钉的是否定副词 + **动词** = 别做。两条合起来才说得清这条边界。 */
      ['不用字幕', ['captions-off']], ['不需要白板', ['board-close']]];
    const stillBad = STILL_ON.filter(([q, w]) => detectRoomActions(q).join(',') !== w.join(','));
    ok('反面：「不要白板」仍正确读成"关掉"（否定守卫不能把关闭语义一起吞了）',
      stillBad.length === 0 || (() => {
        console.log('   不符：' + stillBad.map(([q, w]) => `${q}→期望[${w}]实得[${detectRoomActions(q)}]`).join('、'));
        return false;
      })());
    /* 排序依赖"每条规则在句中的真实位置"：纯前瞻分支零宽命中在索引 0 处就满足，
     * 直接拿 exec 的 index 当位置会让"演讲者"插到句子最前面——上面 MULTI 里那条
     * 四动作用例就是这条缺陷的哨兵（旧写法实得 [board-open, view-speaker, captions-off]，
     * 宫格被挤掉、最终视图与用户说的相反）。行为断言比"函数存在"的结构断言值钱。 */
    /* ★ 越界请求必须被**明着拒绝**，而不是滑进 LLM 回一句漂亮的答非所问——
     *   用户读到的"含糊过去"和"指令没生效"是同一种体验，所以这条也算"操控实体"的一半。
     *   同时钉反例：**求助问句不是命令**（"我的摄像头怎么打不开"不能被拒），
     *   否则我们把咨询当命令，比不答更气人。 */
    const { detectOutOfScopeCommand } = require('../sfu/ai/roomActions.js');
    const DENY = ['把摄像头关掉', '帮我开一下屏幕共享', '把张三静音', '开始录制', '把李四踢出去', '帮我发个文件'];
    const NOT_DENY = ['我的摄像头怎么打不开', '刚才摄像头关了有影响吗', '谁还没发言', '录制有什么用',
      '什么是屏幕共享', '把字幕打开', '打开白板', '今天聊了什么'];
    const missedDeny = DENY.filter((q) => !detectOutOfScopeCommand(q));
    ok(`${DENY.length} 条设备/权限类指令被明确拒绝（不是交给 LLM 含糊过去）`, missedDeny.length === 0,
      missedDeny.length ? '漏拒：' + missedDeny.join('、') : '');
    const overDeny = NOT_DENY.filter((q) => detectOutOfScopeCommand(q));
    ok(`${NOT_DENY.length} 条"问句/正常指令"不被误判成越界（求助不是命令，拒了比不答更气人）`,
      overDeny.length === 0, overDeny.length ? '误拒：' + overDeny.map((q) => `${q}→${detectOutOfScopeCommand(q).id}`).join('、') : '');
    ok('拒绝话术里带上"那我到底能做什么"（能力清单由表本身生成，不另写一份=坑 47）',
      typeof RoomActions.ROOM_ACTION_CAPABILITIES === 'string'
        && RoomActions.ROOM_ACTION_CAPABILITIES.split('、').length === keys.length);
    /* ★ 2026-10-06 **泛化**电池：上面 POS/MULTI/DENIED 里的句子都已经被规则收过，
     *   拿它们断言只能证明"背题会做"，证明不了"用户换一种说法还会"。
     *   ▎这一组 28 句全是**从未进过规则表**的自然口语（含倒装、量词、同音漂移、
     *     省略宾语），首跑实测 **13/28 命中 = 54% 缺口**——比当年那 26% 还严重。
     *     症状与用户那句"AI 操控实体还是实现的不行"完全对得上：说得出人话，它就不动。
     *   ▸ 以后再加动作时**必须往这一组里丢几句新说法**（背题型的电池会越测越虚）。 */
    const GENERALIZE = [
      ['能开个画板不', ['board-open']], ['弄个白板', ['board-open']],
      ['整一块白板出来', ['board-open']], ['麻烦打开一下白板', ['board-open']],
      ['我们把白板启用一下', ['board-open']], ['开下白板', ['board-open']],
      ['把百板打开', ['board-open']], ['我画个图，把白板拉出来', ['board-open']],
      ['字幕弄出来', ['captions-on']], ['能不能给我配个字幕', ['captions-on']],
      ['我耳朵不太好，上字幕', ['captions-on']], ['把字母打开', ['captions-on']],
      ['字幕先停一下', ['captions-off']], ['把字幕关了吧，太吵', ['captions-off']],
      ['不需要字幕', ['captions-off']], ['白板不用了', ['board-close']],
      ['把白板撤了', ['board-close']], ['把刚才画的都擦掉', ['board-clear']],
      ['白板重画，先清一下', ['board-clear']], ['这笔划错了，撤销一下', ['board-undo']],
      ['刚才那一笔不要了', ['board-undo']], ['换成大画面', ['view-speaker']],
      ['把说话的人放大', ['view-speaker']], ['视图切回宫格', ['view-grid']],
      ['所有人的画面一样大', ['view-grid']], ['先开字幕，再把白板打开', ['captions-on', 'board-open']],
      ['别切宫格，把白板打开', ['board-open']], ['不要开字幕了，把白板打开', ['board-open']],
    ];
    const genMiss = GENERALIZE.filter(([q, w]) => detectRoomActions(q).join(',') !== w.join(','));
    /* ★ 2026-10-07 第 51 步：共享文件面板的两个动作（files-open / files-close）。
     *   这一组**直接按泛化写法起步**——上一轮学到的教训：先写规则再补电池，
     *   电池只会覆盖"我想到过的说法"（坑 106）。所以这里的句子全是用户可能怎么说、
     *   而我写规则时没逐条对照过的自然口语。 */
    const FILES_POS = [
      ['打开共享文件', ['files-open']], ['把共享文件打开', ['files-open']],
      ['调出文件面板', ['files-open']], ['文件面板调出来', ['files-open']],
      ['显示共享文件列表', ['files-open']], ['把资料面板打开一下', ['files-open']],
      ['给大家看下文件清单', ['files-open']],
      ['弹出文件窗口', ['files-open']], ['共享的文件打开来看看', ['files-open']],
      ['把共享的文件调出来', ['files-open']],   // 带"的"的定中结构：中文口语里很常见
      ['会议材料先不放，把共享文件开一下', ['files-open']],
      ['关闭共享文件', ['files-close']], ['把文件面板关掉', ['files-close']],
      ['文件窗口收起来', ['files-close']], ['不要文件面板了', ['files-close']],
      ['把共享文件列表关掉', ['files-close']], ['退出文件面板', ['files-close']],
      /* 组合：一句话两件事，按说出来的顺序各做一次（第 51 步不该只做一个） */
      ['把白板打开，共享文件也打开', ['board-open', 'files-open']],
      ['打开文件面板，再把字幕关掉', ['files-open', 'captions-off']],
      /* 礼貌问句：形式是问、语义是命令 */
      ['能不能把共享文件打开？', ['files-open']], ['帮我把文件面板调出来好吗', ['files-open']],
      /* 否定：方向不能反（"不要打开文件面板" ≠ 去关它，更不是去开它） */
      ['不要打开文件面板', []], ['别把共享文件打开', []], ['不用开启文件面板', []],
      /* 「关闭」不是否定副词，是动词——「把文件面板关闭」就该关 */
      ['把文件面板关闭', ['files-close']],
    ];
    const filesMiss = FILES_POS.filter(([q, w]) => detectRoomActions(q).join(',') !== w.join(','));
    ok(`${FILES_POS.length} 句共享文件的自然说法全部命中（含组合/否定/礼貌问句三种形状）`,
      filesMiss.length === 0, filesMiss.length
        ? '未命中：' + filesMiss.map(([q, w]) => `${q}→期望[${w}]实得[${detectRoomActions(q).join(',') || '—'}]`).join('、')
        : '');
    /* ★ 一条**必须为红而它没红**的对照：第 51 步上线前，「把共享文件打开」会被
     *   越界表里的"共享"与"文件"两条规则吃掉 → AI 答一句"这个我办不了"。
     *   两个规则盯着同一个词时，收窄判据而不是调顺序（顺序只解决相遇，不解决歧义）。 */
    const FILES_NOT_DENY = ['把共享文件打开', '打开共享文件面板', '把文件面板调出来', '看一下文件列表'];
    const wronglyDenied = FILES_NOT_DENY.filter((q) => detectOutOfScopeCommand(q));
    ok(`${FILES_NOT_DENY.length} 句"开文件面板"不被误判成越界（共享/文件两个词都不该顺手拒掉它）`,
      wronglyDenied.length === 0, wronglyDenied.map((q) => `${q}→${detectOutOfScopeCommand(q).cn}`).join('、'));
    const FILES_DENY = ['把文件发我', '帮我发个文件', '把那份文件传给张三', '共享一下我的屏幕', '把共享打开'];
    const denyMiss = FILES_DENY.filter((q) => !detectOutOfScopeCommand(q));
    ok(`${FILES_DENY.length} 句真越界仍然被拒（发文件给人=点对点、开共享=设备，AI 都没那个身份）`,
      denyMiss.length === 0, denyMiss.join('、'));
    /* ★ 「看一下会议材料」这一句**有意不接**（不是漏了）：真实会议里它通常是
     *   "我自己翻一下手头的东西"，而误触发会当着全房把界面改了——
     *   与意图分类里"谈论 ≠ 命令"那条保守判据同一条取舍：**漏一次用户可以再说一句，
     *   错一次要人来纠正**。所以它留在这里当反向对照，而不是把规则加宽。 */
    const FILES_MENTION = ['这份文件讲了什么', '文件我刚才发你了', '共享文件在哪儿了',
      '这个文档我昨天写过', '文件面板有什么用', '刚才那份 PPT 谁传的',
      '看一下会议材料', '我把材料找一下', '材料谁准备'];
    const filesWrongDone = FILES_MENTION.filter((q) => detectRoomActions(q).length > 0);
    ok(`${FILES_MENTION.length} 句"谈论文件"一个动作都不做（聊到不等于要执行）`,
      filesWrongDone.length === 0, filesWrongDone.map((q) => `${q}→[${detectRoomActions(q)}]`).join('、'));

    /* ★ 2026-10-08 I9 泛化组（坑 106 的方法论用在共享文件面板上）：
     *   上面 FILES_POS 那 15 句是**和规则同一只手写的**，所以它只覆盖"我想到过的说法"。
     *   这一组 30 句是写完规则之后**专门新造的、规则表里从来没有过的**自然口语，
     *   首跑量到的缺口是 open 9/18、close 9/12 —— 也就是**一半的说法 AI 听不懂**，
     *   而用户报的正是第五次那句"AI 操控实体类的功能还是实现的不行"。
     * ▸ 缺口的形状很具体：旧规则的名词侧是一份**字面短语清单**（文件面板/资料面板/文档面板…），
     *   可口语指代一个界面用的是**远指 + 量词**（「文件那块」「共享资料那块」「材料的面板」），
     *   动词还常倒装到名词后面（「文件面板亮起来」）。
     * ▸ 补完之后 open 17/18、close 12/12、反例 0/8 —— 剩下那 1 句是**有意不接**（见下面 GEN_REFUSE）。 */
    const FILES_GEN_OPEN = [
      '我们看共享文件', '打开共享文档那里', '把文件那块弄出来', '给我看看有哪些文件',
      '能看下文件清单吗', '把刚才那份材料的面板开一下', '文件面板亮起来', '共享资料那块打开来',
      '大家看一下共享文件', '把会议共享的资料调出来', '文档窗口弹出来', '把文件那栏打开',
      '材料清单显示一下', '共享文件这边打开', '帮我们调出文件列表',
    ];
    const FILES_GEN_CLOSE = [
      '文件那块收一下', '文档面板关上', '把资料清单关掉', '共享文件那边收起来',
      '文件窗口撤掉', '把材料的面板隐藏', '资料列表不要了', '文档那里退出',
      '把那块文件列表关一下', '共享资料的页面收起',
    ];
    const genOpenMiss = FILES_GEN_OPEN.filter((q) => !detectRoomActions(q).includes('files-open'));
    ok(`${FILES_GEN_OPEN.length} 句"从没见过"的开面板说法命中（泛化组，规则表写完才造的）`,
      genOpenMiss.length === 0, genOpenMiss.map((q) => `${q}→[${detectRoomActions(q).join(',') || '—'}]`).join('、'));
    const genCloseMiss = FILES_GEN_CLOSE.filter((q) => !detectRoomActions(q).includes('files-close'));
    ok(`${FILES_GEN_CLOSE.length} 句"从没见过"的收面板说法命中（含倒装与远指量词）`,
      genCloseMiss.length === 0, genCloseMiss.map((q) => `${q}→[${detectRoomActions(q).join(',') || '—'}]`).join('、'));
    /* 泛化不能泛到"谈内容也把界面点开"：这一组反例是加宽判据**同时**必须守住的另一边。 */
    const FILES_GEN_NEG = [
      '这个文档讲了什么', '我看一下会议材料', '把这份文档发给大家', '共享文件里有没有报价',
      '刚才那份材料谁写的', '文件我下载到本地了', '不要念这份文档', '共享屏幕',
      '资料我还没看完', '文档那里面的表格是谁做的',
    ];
    const genWrong = FILES_GEN_NEG.filter((q) => detectRoomActions(q).length > 0);
    ok(`${FILES_GEN_NEG.length} 句"只是谈到文件"仍然一个动作都不做（加宽判据不许吃掉这一侧）`,
      genWrong.length === 0, genWrong.map((q) => `${q}→[${detectRoomActions(q)}]`).join('、'));
    /* 两句**有意不接**，写在这里是为了让"不接"成为一个决定而不是一处疏漏：
     *   ①「共享文件呢」——问句守卫排在规则之前（"问一件事 ≠ 命令一件事"），
     *      而"X 呢"太常见（「我的文件呢」多半在找东西），开着面板去猜反而吵；
     *   ②「能看到共享文件吗」/「能力打开白板吗」——问的是**能力**不是**请求**，
     *      所以礼貌例外要的是"句首能 + 紧跟动作动词"这个完整形状（见 POLITE_ASK_RE 的注释）。 */
    const GEN_REFUSE = ['共享文件呢', '能看到共享文件吗', '能力打开白板吗', '文件清单在哪里'];
    const refusedWrong = GEN_REFUSE.filter((q) => detectRoomActions(q).length > 0);
    ok(`${GEN_REFUSE.length} 句"问句 / 问能力"有意不接（少做一次能补，做错方向要人改回来）`,
      refusedWrong.length === 0, refusedWrong.map((q) => `${q}→[${detectRoomActions(q)}]`).join('、'));

    ok(`${GENERALIZE.length} 句**从未进过规则表**的自然说法全部命中（缺口=泛化能力）`,
      genMiss.length === 0, genMiss.length
        ? '未命中：' + genMiss.map(([q, w]) => `${q}→期望[${w}]实得[${detectRoomActions(q).join(',') || '—'}]`).join('、')
        : '');
    /* ★ 「别切宫格，把白板打开」以前会把**宫格执行掉**：否定副词"别"和名词"宫格"之间
     *   夹了一个轻动词"切"，旧守卫要求"别"紧贴命中点，差一个字整条守卫形同虚设。
     *   ▸ 这条是"做错方向"类缺陷，比"少做一个"严重——用户得手动改回来（见 isNegated 注释）。 */
    ok('否定只压"被否的那一件"，同一句里另一件照做（别切宫格≠切宫格）',
      detectRoomActions('别切宫格，把白板打开').join(',') === 'board-open'
        && detectRoomActions('把白板打开，别切宫格').join(',') === 'board-open');
    /* ★ 2026-10-06 **谈论一件事 ≠ 命令做这件事**。补泛化的"光杆动词"分支时，
     *   顺手把这些陈述/疑问句也接住了（两个人正在聊"字幕怎么没出来"，AI 伸手把字幕打开
     *   ——这是"不该做而做了"，与"做错方向"同一种代价不对称）：
     *   没开字幕 / 还没有上字幕 / 开了字幕了吗 / 上次开字幕挺好的 / 谁开的白板 / 我刚才开字幕了。
     *   ▸ 反向对照同组跑：**礼貌问句形式是问、语义是命令**，必须照做，不能一刀切。 */
    const MENTION = ['没开字幕', '还没有上字幕', '开了字幕了吗', '上次开字幕挺好的',
      '谁开的白板', '我刚才开字幕了', '刚才把白板打开了吗？', '字幕是谁关的呢', '白板开着吗'];
    const wronglyDone = MENTION.filter((q) => detectRoomActions(q).length > 0);
    ok(`${MENTION.length} 句"谈论/疑问"一个动作都不做（聊到不等于要执行）`,
      wronglyDone.length === 0, wronglyDone.length
        ? '误执行：' + wronglyDone.map((q) => `${q}→[${detectRoomActions(q)}]`).join('、') : '');
    const POLITE = [['能不能把白板打开？', ['board-open']], ['帮我把字幕关掉好吗？', ['captions-off']],
      ['可以开个白板吗', ['board-open']], ['麻烦把字幕开一下', ['captions-on']]];
    const politeBad = POLITE.filter(([q, w]) => detectRoomActions(q).join(',') !== w.join(','));
    ok(`${POLITE.length} 句礼貌请求照做（形式是问、语义是命令，一刀切会把正解杀了）`,
      politeBad.length === 0, politeBad.length
        ? '不符：' + politeBad.map(([q, w]) => `${q}→期望[${w}]实得[${detectRoomActions(q)}]`).join('、') : '');
    /* ★ 越界的**归类**要准：拿错误的理由拒绝，用户读到的还是答非所问。
     *   「把推广视频发一下」曾被判成 camera（旧表把裸"视频"当设备词）。 */
    const CAT = [['把会议录下来', 'record'], ['共享一下我的屏幕', 'share'],
      ['咱们录个屏吧', 'record'], ['能不能把视频画面关掉', 'camera'], ['把镜头关一下', 'camera']];
    const catBad = CAT.filter(([q, want]) => {
      const r = detectOutOfScopeCommand(q);
      return !r || r.id !== want;
    });
    ok(`${CAT.length} 句越界请求**归对类别**（用错误的理由拒绝=另一种答非所问）`,
      catBad.length === 0, catBad.length
        ? '归类错：' + catBad.map(([q, w]) => `${q}→期望${w}实得${(detectOutOfScopeCommand(q) || {}).id || 'null'}`).join('、')
        : '');
    ok('「把推广视频发一下」不再被当成"开关摄像头"误拒（裸"视频"必须与开/关同现才算设备请求）',
      !detectOutOfScopeCommand('把推广视频发一下') && !detectOutOfScopeCommand('大家看下这段视频'));
    /* ★ 2026-10-06 「记录」两个字害死过一次：上面 ② 补"把会议录下来"时写成 `录(一下|下来)`，
     *   于是「把这条**记录**一下」被判成"开录制"并明确拒绝——而这一句在真实账本
     *   （sfu/captions 的 3332 条**人说的话**）里出现 **11 次**，是用户对 AI 说得最多的一句求助，
     *   而且它本来真能办（记进待办/纪要）。修 = `(?<!记)`；这几条就是那次的哨兵。
     *   ▸ 判据的形状值得记：**改完文本判据要拿真实语料回扫**，电池里的句子只是"我想像中
     *     用户会说的话"，账本里的才是他们真正说的（这一条已进 review:meeting 的回扫行）。 */
    const NOTE_REQUESTS = ['把这条记录一下，明天下午三点开评审会', '小明，帮我把这条记录一下',
      '把这个记录下来', '帮我把刚才那句记一下', '把这条记下来'];
    const wronglyRefused = NOTE_REQUESTS.filter((q) => detectOutOfScopeCommand(q));
    ok(`${NOTE_REQUESTS.length} 句"帮我记事"不被误判成"开录制"而拒绝（真实账本里 11 次的那句求助）`,
      wronglyRefused.length === 0, wronglyRefused.length
        ? '误拒：' + wronglyRefused.map((q) => `${q}→${detectOutOfScopeCommand(q).id}`).join('、') : '');
    /* ▎如实挂着的一条边界（2026-10-06 查证过，不是遗漏）：账本里有 18/3332 句人话会触发房间动作，
     *   其中多数是 **AI 自己的回答被麦克风收回去**（那句"…还是开白板、开字幕"就是它自己说的）。
     *   现有一道 45s 回声闸（isDupOrFragment 包含判据）挡这个，但**短回声**（"开白板"3 字、
     *   bigram<3 不下结论）理论上能漏。拿 11 间真实房间的 3 条 room-control 与 AI 字幕对齐量过：
     *   「AI 说完 ≤6s 且那句本身含指令词」的形态 **0 条** —— 所以这里**有意不加**"AI 说过就不执行"
     *   的抑制：用户把 AI 的提议复述一遍当确认（"开白板"）恰恰是正常用法，
     *   抑制它会把更有价值的一条通路弄坏。这条断言只钉"越界归类"，不自欺地说"回声已根治"。 */
    /* ▎真实账本回扫（2026-10-06）。**口径先说清**：只数 `asr===true` 的句子——
     *   那是麦克风真转出来的话；AI 自己写进账本的回答 `asr:false`，不是"有人说了这句"。
     *   （我第一版把两者混在一起数，得出"18 句会触发、多数是 AI 回声"——
     *     拿 `from/name/asr` 三个字段核过之后才发现：13 条是 AI 存档的回答，
     *     麦克风转写里只有 3 条触发，而**那 3 条全都真是命令**（「帮我开白板再白板这画」…）
     *     ⇒ 误触发 0。**口径写错会编出一个不存在的现象**，这条本身就是坑 105 的形状。）
     *   ▸ 判据用**比例 + 样本量**而不是"逐句金标准清单"：清单会在用户说出新命令那天变红，
     *     那是一条只会制造假红的断言（同坑 91"要求变好"那条教训）。 */
    ok('真实账本回扫：麦克风人话里"被判越界"与"被读成动作"都停在个位数（比例 ≤2%）',
      (() => {
        const fs = require('fs'), pp = require('path');
        const dir = pp.join(__dirname, '..', 'sfu', 'captions');
        if (!fs.existsSync(dir)) return true;                       // 没有历史账本的机器上不硬失败
        let mic = 0, refused = 0, acted = 0; const ex = [];
        for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
          for (const line of fs.readFileSync(pp.join(dir, f), 'utf8').split('\n')) {
            if (!line.trim()) continue;
            let e; try { e = JSON.parse(line); } catch (err) { continue; }
            if (e.bot || e.asr !== true || !e.text) continue;        // 只数"麦克风真转出来的话"
            mic++;
            const a = detectRoomActions(e.text);
            if (a.length) { acted++; if (ex.length < 3) ex.push(`${e.text.slice(0, 18)}→${a}`); }
            if (detectOutOfScopeCommand(e.text)) refused++;
          }
        }
        if (mic < 50) { console.log(`   （麦克风人话只有 ${mic} 句，样本不足，本次不下结论）`); return true; }
        const rate = (acted + refused) / mic;
        console.log(`   （回扫 ${mic} 句麦克风人话：读成动作 ${acted} · 判越界 ${refused} · 合计 ${(rate * 100).toFixed(1)}%${acted ? ' · 例：' + ex.join(' / ') : ''}）`);
        return rate <= 0.02;
      })(), '误触率随规则放宽而涨时，这条会先红（阈值 2%）');
  }

  /* === ③.9 服务端语音的"决定"必须有界，且按引擎定（★ 2026-10-06）===
   *   ▎起因：test:asr-live 的同一条断言"要么有音频、要么有失败通知"会假红。
   *     追下去不是代码坏了，是**那句通知说得太晚**：`await Promise.all(jobs)` 等所有合成任务
   *     落地才发 ai-tts-fail，而 Edge 的合成内部超时写死 12s、并发闸只有 2 路 ——
   *     长答案最坏 20s+ 才承认"这条我没念出来"。等一个死掉的端点等到 20 秒，
   *     用户听到的与"不说话"没有区别。
   *   ▎钉住三件事（都是结构判据，改坏了会当场红）：
   *     ① 决定有截止时刻；② 截止时刻**按引擎能力**分档（否则显式打开的本地神经音色
   *     会被 8s 永远抢跑 → 那个配置变成空转 = 坑 67"写了但从来没生效"原样复发）；
   *     ③ 快引擎的合成预算显式写在调用点上（浏览器回落就在下一步，等满 12s 买不到东西）。 */
  console.log('\n=== ③.9 服务端语音：决定有界 + 按引擎分档（2026-10-06 假红查出来的真缺陷）===');
  {
    const srvSrc = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'server.js'), 'utf8');
    ok('TTS_DECIDE_MS 有定义且下限不为零（下限 1.5s：设成 0 等于每次都在合成前判死刑）',
      /const TTS_DECIDE_MS = Math\.max\(1500, Number\(process\.env\.TTS_DECIDE_MS\)/.test(srvSrc));
    ok('流水线的收尾等的是"截止时刻"而不是"全部合成完"（Promise.race 而非裸 Promise.all）',
      /await Promise\.race\(\[Promise\.all\(jobs\), new Promise\(\(r\) => setTimeout\(r, decideMs\)\)\]\);/.test(srvSrc));
    ok('截止时刻按引擎分档：只有快引擎才用 8s，显式开的本地神经音色等满它自己的上限',
      /const decideMs = slowEngineOnly \? Math\.max\(TTS_DECIDE_MS, 60000\) : TTS_DECIDE_MS;/.test(srvSrc));
    ok('Edge 合成显式带 timeoutMs（不靠模块默认的 12s——下游有浏览器回落，等满只是静音）',
      /timeoutMs: Number\(process\.env\.TTS_EDGE_TIMEOUT_MS\) \|\| 6000,/.test(srvSrc));
    /* 测试接缝：没有它，"探测通过、真合成失败"这条最要命的路径只能等网络自己坏一次才验得到
     *   （Edge 端点可达性随出口网络漂，本机改不了任何东西）——坑 83：测不到不等于通过。 */
    const ttsSrc = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'ai', 'tts.js'), 'utf8');
    ok('tts.js 有 TTS_FAKE_FAIL 接缝，且判在缓存之前（否则同句命中缓存会绕过失败=测的是缓存）',
      (() => {
        const i = ttsSrc.indexOf("if (process.env.TTS_FAKE_FAIL === '1') return null;");
        return i > 0 && i < ttsSrc.indexOf('const hit = cacheGet(key)');
      })());
  }

  console.log('\n=== ④ 在线自检：/config.json 的 asrEnabled ===');
  try {
    const res = await fetch('http://127.0.0.1:3001/config.json', { signal: AbortSignal.timeout(3000) });
    const cfg = await res.json();
    ok('运行中的服务器报告 asrEnabled=true（装了 whisper 就必须为真）', cfg.asrEnabled === true);
    // ★ 2026-10-02：引擎名也要看得见（用户问"是没实现还是还在用 whisper"，不该靠猜）
    ok('运行中的服务器报告当前 ASR 引擎（asrEngine 字段）',
      ['whisper', 'qwen', 'qwen-local', 'auto', 'none'].includes(cfg.asrEngine));
  } catch (e) {
    skipped('在线 /config.json 自检', '3001 上没有运行中的服务器（先 npm run start:sfu）');
  }

  console.log('\n=== ④b ★ 2026-10-03 分段碎片判据 isFragmentOf（同一句被切两半不该答两次）===');
  {
    const norm = (s) => String(s).replace(/[\s，,。.、！!？?；;：:“”"'‘’]/g, '');
    /* 真实取证数据：test:asr-live 在 qwen-local 下把一句话切成了这三条 */
    const A = norm('小明，帮我记一下明天下午三点的评审。');
    const tail = norm('小明。');
    const B = norm('帮我记一下明天下午三点的评审会。');
    ok('尾音碎片（只余下唤醒词）由既有"包含"规则处理，本判据不越权（短文本不下结论）',
      Asr.isFragmentOf(A, tail) === false && A.includes(tail));
    ok('写法漂移的同一句（三↔3 + 尾字截断）判为碎片 → 字幕不重复入账',
      Asr.isFragmentOf(A, B) === true);
    /* 反例三则：判据若太宽，会把"真人接着问的第二句"当成碎片吞掉——那比重复应答更糟 */
    ok('放过：信息更全的新问句（打招呼之后提出真问题）',
      Asr.isFragmentOf(norm('小明。'), norm('小明，把今天的纪要生成一下发我')) === false);
    ok('放过：完全无关的下一句',
      Asr.isFragmentOf(A, norm('服务器的带宽压测跑过了吗')) === false);
    ok('放过：太短的文本不下结论（bigram 太少没有统计意义，同坑 53）',
      Asr.isFragmentOf(A, norm('好')) === false && Asr.isFragmentOf('', A) === false);
    ok('放过：只有两三个 bigram 的句子不判碎片',
      Asr.isFragmentOf(norm('今天天气很好'), norm('天气')) === false);
    /* 总闸 isDupOrFragment：四条判据合一。这条必须单独测——
     *   它原来是 server 里一串内联布尔，**刷屏总闸却没人测得到**（坑 57 那一类）。 */
    ok('总闸①：归一化相等判重复', Asr.isDupOrFragment(A, A) === true);
    ok('总闸②：尾音碎片（子串）判重复', Asr.isDupOrFragment(A, norm('小明。')) === true);
    ok('总闸③：只差标点/语气词的子串判重复',
      Asr.isDupOrFragment(norm('帮我记一下评审会'), norm('帮我记一下评审会。好的')) === true);
    ok('总闸④：写法漂移的碎片判重复（三↔3 + 尾字截断，互不包含）',
      Asr.isDupOrFragment(A, B) === true);
    ok('总闸：无关句子放行', Asr.isDupOrFragment(A, norm('服务器的带宽压测跑过了吗')) === false);
    ok('总闸：任一边为空不判（空串不能被当成"与上一句重复"）',
      Asr.isDupOrFragment('', A) === false && Asr.isDupOrFragment(A, '') === false);
  }

  console.log('\n=== ④c ★ 2026-10-05 句内归并 mergeTranscript（快照半句 vs 封口全量的重叠拼接）===');
  {
    /* 为什么单测必须真的在这里：asr.js 与 server.js 两处注释都写着"test:asr 逐条断言"，
     * 而 grep 全 scripts/ 零引用——注释在撒谎（坑 57/76 家族：说了就要真有）。
     * ▎全部用例取自真实取证（soak/e2e 的"快照半句 + 封口全量"对），勿改成理想值：
     *   旧双向 isDupOrFragment 三分支恰好把封口后更全的版本判成碎片吞掉 → 丢「开」。 */
    ok('★ 升级动机用例：快照半句「小明 把白板打」+ 封口全量「把白板打开」→ 不丢「开」',
      Asr.mergeTranscript('小明 把白板打', '把白板打开') === '把白板打开');
    ok('完全相同的两段归累积（半句重报不翻倍）',
      Asr.mergeTranscript('帮我记一下评审会', '帮我记一下评审会') === '帮我记一下评审会');
    ok('累积是新段的子串 → 归更全的新段（快照「后天」+ 封口「那后天呢」）',
      Asr.mergeTranscript('后天', '那后天呢') === '那后天呢');
    ok('新段是累积的子串 → 归累积（迟到的复读片段不追加）',
      Asr.mergeTranscript('请把白板打开', '把白板') === '请把白板打开');
    ok('后缀-前缀重叠 k≥2 拼尾巴（「三点」重叠，不重说一遍）',
      Asr.mergeTranscript('明天下午三点', '三点开会') === '明天下午三点 开会');
    ok('k=1 不归并（中文里单字重叠几乎全是巧合，删真字更糟）',
      Asr.mergeTranscript('明天三点开会', '会前发我材料') === '明天三点开会 会前发我材料');
    ok('任一段为空归另一段（空串不能被当成句子）',
      Asr.mergeTranscript('小明', '') === '小明' && Asr.mergeTranscript('', '句二') === '句二');
  }

  /* ★ 2026-10-05 夜（用户点名："纪要后面那个很长的名字就不说了，费时间"）：
     念出来之前必须把路径/链接地址洗掉——气泡里本来就有可点的链接，嘴上不需要复述文件名。 */
  {
    const Tts = require('../sfu/ai/tts');
    const MSG = '纪要已生成：/minutes/283648/20261005-221203-segment.md（LLM 撰写） —— 要 [打开纪要](/minutes/283648/x.md) 就点链接';
    const said = Tts.speakable(MSG);
    ok('念之前洗文本：路径不再被逐字念出（不含 /minutes、不含长数字串，换成"（文件）"）',
      !/\/minutes/.test(said) && !/\d{8}/.test(said) && said.includes('（文件）'), said);
    ok('念之前洗文本：markdown 链接只留名字（"打开纪要"在、地址不在）',
      said.includes('打开纪要') && !said.includes(']('), said);
    ok('念之前洗文本：正常句子一字不动（清洗不许改写给人的话）',
      Tts.speakable('你好，我在呢。有什么需要我帮忙的？') === '你好，我在呢。有什么需要我帮忙的？');
    /* 浏览器那一轨是另一个运行时，做不到一份代码，就用断言钉"两边规则都在"。 */
    const cliSrc = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'client.js'), 'utf8');
    const fn = (cliSrc.match(/function speakableText[\s\S]*?\n\}/) || [''])[0];
    ok('两轨一致：client.js 的 speakableText 也有"链接留名字"与"路径换（文件）"两条规则',
      fn.includes(']\\(') && fn.includes('（文件）'), fn.slice(0, 60));
  }

  console.log('\n=== ⑤ 配置模板：example 带注释也要能解析（复制即用）===');
  try {
    const { parseJsonc } = require('../sfu/jsonc');
    const ex = parseJsonc(fs.readFileSync(path.join(__dirname, '..', 'sfu', 'config.example.json'), 'utf8'));
    ok('config.example.json 可被容错解析（带 // 注释）', !!ex && typeof ex === 'object');
    ok('模板含 ASR 三个新键（asrModel / asrSegmentSec / aiChatWindowSec）',
      ex.asrModel === 'small' && Number(ex.asrSegmentSec) > 0 && ex.aiChatWindowSec === 0,
      `aiChatWindowSec=${ex.aiChatWindowSec}（★ 2026-10-06 默认 0：正常会议里麦常开，`
      + '滚动窗口会让 AI 接管整场）');
    ok('模板把"不叫它就不开口"写成交付默认（aiProactiveSay=false + 半句续接 aiAskTailSec）',
      ex.aiProactiveSay === false && Number(ex.aiAskTailSec) >= 2);
  } catch (e) {
    ok(`config.example.json 可被容错解析（带 // 注释）—— ${e.message}`, false);
  }

  /* === ③.10 astats 的 RMS 语义：reset 的单位是帧，不是采样点（★ 2026-10-06 决定性修复）===
   *   ▎为什么必须有这条断言：服务器用 `db > FLUSH_DB` 的那一行刷新 lastVoiceTs，
   *     而 lastVoiceTs 同时决定 ①静音确认（silenceConfirmed）② 延迟读数的起点
   *     ③抢跑快照的 birth 判据。原来写 `reset=8000` 并当作"8000 采样=0.5s"，
   *     实际是 **8000 帧 ≈ 512 秒**——整场会从不重置，RMS 变成"这场会平均有多响"，
   *     纯静音也不掉 ⇒ silenceConfirmed 永不成立 ⇒ 每句都被 10s 保险丝切断
   *     （字幕慢 3~10s + ⏱ 恒为 0）。**语义写错不会让任何功能变红，只会让所有人慢 8 秒。**
   *   ▸ 这条断言直接驱动 ffmpeg 跑同一条滤镜链，钉"静音段必须给 -inf、有声段必须给正常电平"，
   *     并把旧写法钉成**反例**（它必须判不出静音）——不然下一次有人"顺手改回 8000"没人拦得住。 */
  console.log('\n=== ③.10 astats RMS 语义：reset 单位是帧（静音段必须读到 -inf）===');
  {
    const R = 16000;
    const tone = (sec, amp) => {
      const n = Math.round(R * sec); const b = Buffer.alloc(n * 2);
      for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(amp * Math.sin(2 * Math.PI * 220 * i / R)), i * 2);
      return b;
    };
    const sil = (sec) => Buffer.alloc(Math.round(R * sec) * 2);
    const probePcm = path.join(dir, 'rms-semantics.pcm');
    fs.writeFileSync(probePcm, Buffer.concat([tone(2, 12000), sil(2), tone(2, 12000), sil(2)]));
    const runChain = (af) => {
      const outDir = fs.mkdtempSync(path.join(dir, 'rms-segs-'));
      const { execFile } = require('child_process');
      return new Promise((resolve) => {
        const args = ['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', String(R), '-ac', '1',
          '-i', probePcm, '-af', af, '-c:a', 'pcm_s16le', '-f', 'segment',
          '-segment_time', '2', '-segment_format', 's16le', '-reset_timestamps', '1',
          path.join(outDir, 'seg-%04d.pcm')];
        const p = execFile('ffmpeg', args, { timeout: 30000, maxBuffer: 8 << 20 }, (err, stdout) => {
          if (err) return resolve(null);   // ffmpeg 不在/失败：上层按"跳过"处理
          const rows = []; let t = null;
          for (const line of String(stdout || '').split('\n')) {
            const m = /pts_time:([\d.]+)/.exec(line); if (m) t = Number(m[1]);
            const v = /RMS_level=(\S+)/.exec(line); if (v && t !== null) rows.push({ t, db: v[1] });
          }
          resolve(rows);
        });
        if (!p) resolve(null);
      });
    };
    const dbNum = (s) => (s === '-inf' ? -999 : Number(s));
    const NEW = 'astats=metadata=1:reset=8,ametadata=print:key=lavfi.astats.1.RMS_level:file=-:direct=1';
    const OLD = 'astats=metadata=1:reset=8000,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-:direct=1';
    const win = (rows, a, b) => rows.filter((r) => r.t >= a && r.t <= b).map((r) => dbNum(r.db));
    let rowsNew = null; let rowsOld = null;
    try { rowsNew = await runChain(NEW); rowsOld = await runChain(OLD); } catch (e) { rowsNew = null; }
    if (!rowsNew || !rowsNew.length) {
      skipped('astats RMS 语义（③.10）', '本机跑不了 ffmpeg（或滤镜链无输出）——跳过，不判通过');
    } else {
      const silA = win(rowsNew, 2.2, 3.8); const silB = win(rowsNew, 6.2, 7.8);
      const voice = win(rowsNew, 0.3, 1.7);
      ok(`新写法（reset=8≈0.5s 窗）静音段读到 -inf：${silA.length ? Math.max(...silA) : 'n/a'} dB`,
        silA.length > 3 && silB.length > 3 && Math.max(...silA) <= -60 && Math.max(...silB) <= -60,
        `静音段实测 max=${Math.max(...silA, ...silB)}（> -60 就说明统计还在累计）`);
      ok('新写法有声段读到正常电平（不是把一切都判成静音）',
        voice.length > 3 && Math.max(...voice) > -30, `实测 max=${Math.max(...voice)}`);
      if (rowsOld && rowsOld.length) {
        const oldSil = win(rowsOld, 2.2, 3.8).concat(win(rowsOld, 6.2, 7.8));
        ok('旧写法（reset=8000≈512 帧秒级）确实判不出静音——钉成反例，禁止改回去',
          oldSil.length > 3 && Math.max(...oldSil) > -40,
          `旧写法静音段实测 max=${Math.max(...oldSil)} dB（本该 -inf）——这就是字幕被 10s 保险丝切断的成因`);
      } else {
        skipped('旧写法反例', 'ffmpeg 直接拒绝了旧链路（那也是它不可用的证据，但不便断言数值）');
      }
      const srv = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'server.js'), 'utf8');
      ok('服务器两条链都不再出现 reset=8000 / Overall.RMS_level 的累计写法',
        !/reset=8000/.test(srv) && !/astats\.Overall\.RMS_level/.test(srv));
    }
  }

  /* === ③.11 "此刻有没有人说话"改成相对噪声底（★ 2026-10-06，安静麦克风不再被切成碎句）===
   *   ▎实测前提（本机 ffmpeg 同一条滤镜链，③.10 那套）：
   *     语音峰值 -20/-40 dBFS → RMS -23/-43 → 绝对阈值 -50 判"有声" ✅
   *     语音峰值 -56/-62 dBFS → RMS -59/-65 → **判"无声"** ❌
   *     而 10-05d 从真实会议日志量到的用户麦克风正是 -56~-65 dBFS（坐得远/笔记本麦）。
   *     对这些人 lastVoiceTs 永不刷新 ⇒ silenceConfirmed 每段都成立 ⇒ 每个 2s 段各自成句
   *     各自定稿各自唤醒 ⇒ 用户看到的"语音识别好乱 / 它答好几遍"。
   *   ▸ 判据 10-06 版：`min(绝对阈值, 噪声底第20百分位 + 6dB)`——**只增灵敏度，绝不比今天更迟钝**。
   *   ▸ ★ 2026-10-07 夜改成双边钳位 `clamp(噪声底+6, -74, -42)`：
   *     单边 min() 让吵房间的底噪（-43）永远高于阈值（-50）⇒ 每帧都算有人在说 ⇒
   *     静音永不确认 ⇒ **三句话粘成一条 blob**（当晚 test:asr-live 复跑实测摊出这一行）。
   *     下面 ③.11 的"吵房间"两条因此**断的是相反的方向**，理由写在它们自己的注释里。 */
  console.log('\n=== ③.11 有声判据自适应噪声底（安静麦 0/300 → 235/300；吵房间底噪不再算"有人在说"）===');
  {
    const mk = (floor, speech, rounds = 6) => {
      const out = [];
      for (let r = 0; r < rounds; r++) {
        for (let i = 0; i < 50; i++) out.push(['sp', speech]);
        for (let i = 0; i < 30; i++) out.push(['nf', floor]);
        for (let i = 0; i < 10; i++) out.push(['si', -99]);   // ffmpeg 的 -inf 我们映射成 -99
      }
      return out;
    };
    const play = (stream) => {
      const t = Asr.createVoiceTracker();
      const s = { sp: [0, 0], nf: [0, 0], si: [0, 0] };
      for (const [k, db] of stream) { const r = t.feed(db); s[k][1] += 1; if (r.voiced) s[k][0] += 1; }
      return { s, floor: t.floorDb, thr: t.thresholdDb, n: t.samples };
    };
    const quiet = play(mk(-72, -59));      // 10-05d 那位用户的真实电平画像
    const mid = play(mk(-60, -40));        // 中等房间：10-06 的 min() 与今天的双边钳位**结果必须相同**
    const hot = play(mk(-72, -23));        // 响麦 + 安静房间：今天就能用，改了也不能坏
    ok('安静麦克风（语音 RMS -59 / 底噪 -72）现在被判"有声"——今天这条是 0%，于是每段都被当成说完了',
      quiet.s.sp[0] / quiet.s.sp[1] > 0.6,
      `语音 voiced ${quiet.s.sp[0]}/${quiet.s.sp[1]}，floor=${quiet.floor && quiet.floor.toFixed(1)}，阈值=${quiet.thr.toFixed(1)}`);
    ok('但底噪与纯静音仍判"无声"（灵敏度不能把房间噪声当语音，否则碎句更严重）',
      quiet.s.nf[0] === 0 && quiet.s.si[0] === 0,
      `底噪 voiced ${quiet.s.nf[0]}/${quiet.s.nf[1]}，静音 voiced ${quiet.s.si[0]}/${quiet.s.si[1]}`);
    /* ★★ 本组 2026-10-07 夜改写：这一档原来断的是"吵房间阈值被 -50 钳住 ⇒ 与今天一字不差"，
     *   而**那条绿灯本身就是 blob 的成因**（底噪 -43 > 阈值 -50 ⇒ 每帧都算有人在说 ⇒ 静音永不确认）。
     *   "不改变旧行为"不是一条安全性质——它是把旧行为冻结。现在断的是相反的方向，
     *   并且用同一份 fixture 做 A/B：`ASR_VOICE_DEAF_CEIL=-50` 复跑本组就会红在这两条上。 */
    const loud = play(mk(-45, -28));       // 吵房间（今晚 test:asr-live 实测 floor=-42.9 的画像）
    /* 余下那几帧"底噪被判有声"不是判据坏了：窗口攒够 minSamples(8) 之前**一律用绝对阈值**
       （下面有专门一条钉这件事）。断言若把暖机帧也算成违规，就是在要求"没证据时也下结论"。 */
    ok('★ 吵房间：底噪自己不再被判成"有人在说话"（这就是三句粘成一条 blob 的直接成因）',
      loud.s.nf[0] <= loud.s.nf[1] * 0.08 && loud.s.si[0] === 0,
      `floor=${loud.floor && loud.floor.toFixed(1)} → 阈值=${loud.thr.toFixed(1)}，底噪 voiced ${loud.s.nf[0]}/${loud.s.nf[1]}（暖机帧）`);
    ok('★ 吵房间里的真语音仍全部判"有声"（放开迟钝线不能顺手把人弄聋）',
      loud.s.sp[0] === loud.s.sp[1], `语音 ${loud.s.sp[0]}/${loud.s.sp[1]} 阈值=${loud.thr.toFixed(1)}`);
    ok('反向对照：中等房间（floor -60）阈值 -54，与 10-06 那版一字不差（只有该变的那一档变）',
      mid.thr === -54 && mid.s.sp[0] === mid.s.sp[1] && mid.s.nf[0] === 0,
      `floor=${mid.floor && mid.floor.toFixed(1)} → 阈值=${mid.thr.toFixed(1)}`);
    ok('反向对照：安静房间（floor -72）阈值 -66，也与 10-06 那版一字不差',
      quiet.thr === -66, `阈值=${quiet.thr.toFixed(1)}`);
    ok('响麦 + 安静房间：语音全判有声、底噪全判无声（改判据不能把本来能用的场景弄坏）',
      hot.s.sp[0] === hot.s.sp[1] && hot.s.si[0] === 0 && hot.s.nf[0] === 0,
      `语音 ${hot.s.sp[0]}/${hot.s.sp[1]} 底噪 ${hot.s.nf[0]}/${hot.s.nf[1]} 静音 ${hot.s.si[0]}/${hot.s.si[1]}`);
    /* 两条硬安全线各钉一条：钝的那一边保护安静麦克风用户，灵敏的那一边保护"别把线噪声当语音"。 */
    const deaf = play(mk(-31, -25));       // 房间吵到噪声底 -31（比 -42 还高很多）
    ok('★ 迟钝硬线：房间再吵，阈值也不许高过 -42（否则 10-05d 那批 -56 dBFS 的用户整个被弄聋）',
      deaf.thr === -42, `floor=${deaf.floor && deaf.floor.toFixed(1)} → 阈值=${deaf.thr.toFixed(1)}`);
    /* ★ 灵敏硬线要**把 silentDb 一起调低**才测得到——这本身就是量具的一条真相：
       默认 silentDb=-80 会把比 -80 更静的样本当成"完全无声"排除在噪声底之外，
       于是 floor 最低只能到 -79.x，+margin = -73.x，**永远碰不到 -74 这条线**。
       所以 -74 现在是一道**后备线**（防的不是今天，是将来有人把 silentDb/margin 调松的那天）。
       拿默认参数去断言它生效会得到一条"永远不成立"的假断言；把它调到能到达的输入域里才叫测过。 */
    const ultra = Asr.createVoiceTracker({ silentDb: -99 });
    for (let i = 0; i < 40; i++) ultra.feed(-90);
    ok('★ 灵敏硬线（把 silentDb 调到能到达的输入域才测得到）：噪声底 -90 也不许把阈值推到 -74 以下',
      ultra.floorDb === -90 && ultra.thresholdDb === -74,
      `floor=${ultra.floorDb} → 阈值=${ultra.thresholdDb.toFixed(1)}`);
    ok('★ 后备线的现状如实记：默认 silentDb=-80 下 -74 结构上到不了（今天靠 silentDb 自己兜住）',
      Asr.createVoiceTracker().sensitiveFloor === -74 && (() => {
        const t = Asr.createVoiceTracker();
        for (let i = 0; i < 40; i++) t.feed(-79.5);   // 默认口径下能到达的最安静底噪
        return t.thresholdDb > -74;                    // 到不了那条线 = 后备，不是当前判据
      })());
    /* 三条边界（每条都对应一种会把判据弄坏的做法）*/
    const t2 = Asr.createVoiceTracker();
    let usedAbs = 0;
    for (let i = 0; i < 5; i++) { const r = t2.feed(-70); if (r.thresholdDb === -50) usedAbs++; }
    ok('样本不够时**不猜**：一律用绝对阈值（否则开机头几帧就把空调声当噪声底）', usedAbs === 5);
    const t3 = Asr.createVoiceTracker();
    for (let i = 0; i < 40; i++) t3.feed(-99);            // 全程纯静音
    ok('纯静音(-inf)不参与噪声底估计（不然 floor 会被推到 -99，阈值 -93，呼吸声都算说话）',
      t3.floorDb === null && t3.thresholdDb === -50, `floor=${t3.floorDb}`);
    const t4 = Asr.createVoiceTracker();
    for (let i = 0; i < 30; i++) t4.feed(-70);            // 先学一个安静底
    const quietThr = t4.thresholdDb;
    for (let i = 0; i < 80; i++) t4.feed(-45);            // 环境变吵（窗口滑过去）
    ok('环境变吵时噪声底会跟上（窗口滑动，不是一次锁死——上午安静下午开空调不能变聋）',
      quietThr < -60 && t4.thresholdDb >= -50, `安静时 ${quietThr.toFixed(1)} → 变吵后 ${t4.thresholdDb.toFixed(1)}`);
    /* 接线（坑 41/56：模块写对了不等于调用方接上了）*/
    const srv = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'server.js'), 'utf8');
    ok('服务器 RMS 处理真的用这个判据刷新 lastVoiceTs（不是又内联一份 db > FLUSH_DB）',
      /createVoiceTracker\(/.test(srv) && /voice\w*\.feed\(/.test(srv));
  }

  /* === ★ 2026-10-07 ③.12 整句重转：一次对照实验把"识别太笨"的根因量了出来 ===
   *   ▎病灶不是模型差，是**我们只给它 2 秒**：管线按段分别转写再拼句子，
   *     而中文的词会被切在段边界上。本机同一批生产函数、同一段音频实测出来的原话：
   *       「服务器」→「服务。」+「起负载」    「生成」→「升」+「乘」
   *       「评审会」→「评审。」+ 幻觉「怎会？」
   *     把整句音频一次喂回同一个模型：逐字全对 1/6 → 3/6、多余字数 6→4、
   *     模型总耗时 4.34s → 3.22s（一次调用少付一次固定开销，也不再重复吐同一个词）。
   *   ▎所以这一组钉三件事：① 采用判据（重转失败/丢字时必须保留拼接结果，宁漏修不丢字）；
   *     ② 接线（引擎链只有一份、留声只留封口段、定稿真的走了重转）；
   *     ③ 字幕条几何（"整句话显示出来但不越出线"是布局问题，不是识别问题）。 */
  console.log('\n=== ③.12 整句重转：采用判据 + 接线 + 字幕整行显示（2026-10-07）===');
  {
    /* —— 采用判据（纯函数，方向性：新比旧少要怀疑，新比旧多放行）—— */
    ok('重转结果为空 → 不采用（保留分段拼出来的句子，一次推理失败不许把人说的话弄丢）',
      Asr.preferRefined('小明，帮我记一下。 明天下午三点的评审。', '') === false);
    ok('重转与拼接一字不差 → 不采用（没变化就别标记成"修好了"）',
      Asr.preferRefined('小明。', '小明。') === false);
    ok('重转把被切掉的词补回来了 → 采用（实测的那条：「服务。」+「起负载」→「服务器负载」）',
      Asr.preferRefined('小明，今天的服务。 起负载看起来怎么样？', '小明，今天的服务器负载看起来怎么样？') === true);
    ok('重转只转出开头几个字（丢了一大半）→ 不采用（丢字比切错词更严重）',
      Asr.preferRefined('小明，帮我把这条记录一下，明天下午三点开评审会。', '小明。') === false);
    ok('判据尺度无关：短句 2 字 → 6 字算更全，长句 40 字 → 11 字算丢内容（同一个比例阈值两头都成立）',
      Asr.preferRefined('小明。', '小明，你好呀。') === true
        && Asr.preferRefined('一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十', '一二三四五六七八九十一') === false);

    /* ★ 2026-10-07 夜：两条**膨胀上限**——不是设想出来的，是 `TEST_ASR_DEBUG=1 npm run test:asr-live`
     *   当场跑红的机制自己暴露的失败形态（原文照抄进断言，改一个字都要留痕）：
     *     拼接「…明天下午三点的评审」→ 重转「…明天下午三点的评审**器真不错,拍麦亚。**」
     *   那一轮噪声底 −42.9 dBFS 把"有没有人在说话"顶成了恒真，三句被粘成一条 utterance，
     *   于是整句音频里**本来就含后一句**，重转如实把两句一起转了出来。
     *   ▸ 危害不止"这条更乱"：变长的那条会让**下一句的正确定稿被 isDupOrFragment 吞掉**
     *     （账本实测只剩 1 条）——一次"修准确率"换来"丢一整句话"。
     *   ▸ 两条上限都只让重转**更保守**（不采用=保留拼接结果，绝不丢字），所以可以放心加。 */
    ok('★ 重转多转出一整句（句末标点数量增加）→ 拒绝：吵房间实测的那条 blob，宁不改也不放大',
      Asr.preferRefined('小明,帮我记一下。今天天气会。明天下午三点的评审',
        '小明,帮我记一下。今天天气会。明天下午三点的评审器真不错,拍麦亚。') === false);
    ok('★ 重转长度膨胀过 1.35 倍（长句）→ 拒绝：补回被切掉的词是个位数的事，翻倍不是',
      Asr.preferRefined('今天的服务器负载看起来怎么样还有一个问题是延迟',
        '今天的服务器负载看起来怎么样还有一个问题是延迟另外今天天气真不错') === false);
    /* ★★ 两道膨胀上限**只管"变长"**——这条不是设计出来的，是第一版判据自己杀错了对象：
       无条件用"句末标点不许变多"去判，会把一条**明显更好**的重转扔掉（同一条真跑里掉出来的）：
         拼接「今天天气很大 武器真不错 拍卖呀」(13 字、没标点)
         重转「今天天气真不错,拍麦呀!」(更短、词全对、只是补了标点) → 被拒 ❌
       blob 那条是**变长**的（22→28），而"变短的重转"结构上不可能藏着别人的句子。
       ▸ 判据要问的是"它听见了比这一句更多的东西吗"，不是"标点多了吗"（坑 109 同一条：
         为可读性动的判据，必须回头检查它有没有把自己正在保护的东西切掉）。 */
    ok('★ 反向对照（第一版新闸误杀的那条）：重转更短、词更全、只是补了标点 → 必须采用',
      Asr.preferRefined('今天天气很大 武器真不错 拍卖呀', '今天天气真不错,拍麦呀!') === true);
    ok('★ 反向对照：变长但句末标点没变多 → 仍采用（"补了问号"不等于"多转了一句"）',
      Asr.preferRefined('今天的服务器负载看起来', '今天的服务器负载看起来怎么样') === true);
    ok('反向对照：补尾字的正例没被新上限误杀（「…的评审。」→「…的评审会。」照旧采用）',
      Asr.preferRefined('小明，帮我记一下。 明天下午三点的评审。',
        '小明，帮我记一下明天下午三点的评审会。') === true);
    ok('反向对照：短句豁免生效（「小明。」→「小明，你好呀。」仍采用——比例对 2 字没有意义，坑 53）',
      Asr.preferRefined('小明。', '小明，你好呀。') === true);

    /* —— 别字表补上整句实测出来的新形状：量词后面的「记要」 —— */
    ok('「生成一段记要」修成「纪要」（整句重转实测出来的新形状：动作词隔着量词，旧规则够不着）',
      Asr.fixDomainHomophones('生成一段记要。') === '生成一段纪要。');
    ok('反向对照：「一段既要快又要稳的路」原样不动（「既要」是真连词，误修比漏修更伤）',
      Asr.fixDomainHomophones('这是一段既要快又要稳的路。') === '这是一段既要快又要稳的路。');

    /* —— 接线（坑 41/56：模块写对了不等于调用方接上了）—— */
    const srv = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'server.js'), 'utf8');
    /* 引擎链只许有一份：分段路径与整句路径共用 runEngines。
     *   数具体调用而不是数函数名——复制一份链就是这个形状（坑 47 的守门断言）。 */
    ok('转写引擎链只有一份（runEngines 里调 Qwen 云一次，别处不许再内联第二条链）',
      (srv.match(/await QwenAsr\.transcribeFile\(wavPath\)/g) || []).length === 1);
    ok('定稿真的走重转：finalizeUtterance 里 await refineUtterance 且用 preferRefined 决定采用',
      /const finalizeUtterance = async/.test(srv)
        && /await refineUtterance\(ua\.chunks\)/.test(srv)
        && /Asr\.preferRefined\(stitched, r\.text\)/.test(srv));
    /* ★★ 2026-10-07 H5b「让路」的四条接线（`bench:asr-multi` 量出来的处方，不是设想）：
       4 路并发时重转把分段 p95 从 1.40s 顶到 2.21s、8 路顶到 4.38s，吞吐只剩基线 ~72%
       —— 重转与真话抢的是**同一个单进程 worker**。于是 worker 忙时这一句用拼接结果定稿。
       ▸ 四条各挡一种"写了但没生效"：计数没加 / 判据读在 await 之后（读到自己）/
         让路没有单独一本账（"一直让路"与"做了但没采用"分不开，坑 76）/
         释放在 return 之前（抛一次错永久漏一个名额 ⇒ 最终"重转永远让路"，坑 68 那一族）。 */
    /* 判据要的是**性质**（外壳 +1，包住"调用内层"那一段，finally 里 −1），
       不是"附近出现过 bumpAsrBusy(1)"。第一版放宽成后者时 A/B 当场露馅：
       把 +1 挪到 runEnginesInner 的**声明前面**（等价于没包住内层调用）它仍然绿——
       一条挪不动坏写法的断言等于没有断言（坑 110 那条"假绿不需要代码出错"）。
       ▸ 同时它也挨过 H1 那次真红：给 runEngines 加第二个参数后写死 `(wavPath)` 的正则断了，
         所以参数列表这一处放宽成 `[^)]*`，但**结构**这一处收紧。 */
    /* `finally` 这一半原先要求"注释 + −1"，那是**重构前**的形状（注释后来挪到函数头了），
       断言把真实代码判红 = 假红。收紧的是结构不是措辞：−1 必须在 finally 的花括号里、
       而这个花括号后面紧跟 `};`（= 它就是外壳那最后一个块，不是内层某处的 finally）。 */
    ok('H5b 在途计数包的是**整条引擎链**（外壳 +1 → try 调内层 → finally −1），分段与整句共用一个口径',
      /const runEngines = async \([^)]*\) => \{\s*bumpAsrBusy\(1\);\s*try \{ return await runEnginesInner\(/.test(srv)
        && /finally \{[^{}]*bumpAsrBusy\(-1\);\s*\}\s*\};/.test(srv));
    ok('H5b 释放在 `finally` 里：抛错、判空、房间没了三条出口都要减（漏一条 = 计数只增不减 = 让路永不解除）',
      /finally \{[\s\S]{0,400}?bumpAsrBusy\(-1\)/.test(srv));
    ok('H5b 让路判据**在发起之前**读（await 之后再读读到的是重转自己占的那个名额）',
      /const yieldToBusy = canRefine[\s\S]{0,120}?asrEngineBusy > REFINE_YIELD_ABOVE[\s\S]{0,600}?await refineUtterance/.test(srv));
    ok('H5b 让路单独一本账（skipped）+ 进 /metrics ——只有 n/fixed 分不开"一直在让路"与"做了没采用"',
      /COLLAB\.refine\.skipped \+= 1/.test(srv)
        && /refine: \{ n: 0, fixed: 0, ms: 0, skipped: 0 \}/.test(srv)
        && /sfu_ai_asr_refine_skipped_busy_total \$\{COLLAB\.refine\.skipped\}/.test(srv));
    ok('H5b 在途数本身可读（/metrics gauge + /api/rooms 顶层），复盘与值守不必猜"现在到底有多忙"',
      /sfu_ai_asr_engine_busy \$\{asrEngineBusy\}/.test(srv) && /asrBusy: asrEngineBusy/.test(srv));
    ok('H5b 有开关且"关掉让路"不等于"关掉重转"（ASR_REFINE_YIELD=-1 只撤这一个变量，坑 54 的显式判空）',
      /process\.env\.ASR_REFINE_YIELD !== undefined && process\.env\.ASR_REFINE_YIELD !== ''/.test(srv)
        && /REFINE_YIELD_ABOVE >= 0 &&/.test(srv));
    /* ★ 本轮我自己踩出来的那条（真跑 asr-live 第一发就炸）：把引擎链抽成函数时，
     *   留在原调用方里的 `t0` 与 `transMs` 变成了不存在的变量 ⇒
     *   **每一段的成句路径抛 ReferenceError 被 catch 吞掉** ⇒ 转写照常打印、字幕一条不定稿、
     *   自测超时——症状与"耳朵坏了"一模一样。日志里那行 asr-seg-err 把它当场供了出来（坑 90 家族）。
     *   ▸ 判据写成"这段函数体里不许出现 t0"，比"看起来对了"可靠：重构搬运变量时最容易漏的就是这个。 */
    const segBody = srv.slice(srv.indexOf('const handleSegment = async'), srv.indexOf('const ASR_DUP_MS'));
    ok('分段路径不再引用被搬走的局部量（handleSegment 体内 0 处 t0，延迟锚一律走 eng.startedAt）',
      segBody.length > 500 && !/\bt0\b/.test(segBody) && /eng\.startedAt/.test(segBody));
    ok('留声只留 .pcm 封口段（抢跑的 tail-*.wav 是同一段的前缀，留着会把同一段算两遍）',
      /ASR_REFINE_ON && full\.endsWith\('\.pcm'\)/.test(srv));
    ok('整句音频内存有界：攒到 REFINE_MAX_BYTES 就不再追加（过夜长跑不能无上限堆 buffer）',
      /ua\.bytes \+ buf\.length <= REFINE_MAX_BYTES/.test(srv));
    ok('开关两条都认：env ASR_REFINE=0 与 config.asrRefine:false 都能整条关掉',
      /process\.env\.ASR_REFINE !== '0' && CONFIG\.asrRefine !== false/.test(srv));
    ok('重转有触发证据：/metrics 三条（发起数 / 采用数 / 累计耗时）都打出来',
      /sfu_ai_asr_refine_total /.test(srv) && /sfu_ai_asr_refine_adopted_total /.test(srv)
        && /sfu_ai_asr_refine_seconds_total /.test(srv));
    ok('账本与广播都带"这句是整句转写出来的"标记（坑 56：内层算出来了外层要带出来）',
      /ref: refined \? 1 : undefined/.test(srv) && /refined: !!refined/.test(srv));
    /* ★ 2026-10-09 这条断言**当场抓到了我自己的重构**：原写法是 grep server.js 里那行
     *   `Math.min(40, Math.max(0, -8 - lvl.peakDb))`，而我把两处内联收成 Asr.modelGainDb()
     *   之后它就红了（坑 133：机制一变，按旧机制形态写的探针就变假红）。
     *   改判据不是"放宽"——要求反而更强了：现在必须**两条路径都调同一个函数**，
     *   而算式本身由 ⑬.21~⑬.24 那组直接测函数，不再靠 grep 字符串。 */
    ok('增益口径与分段路径一致（两处都调 Asr.modelGainDb，算式只在 asr.js 一份）',
      (srv.match(/Asr\.modelGainDb\(lvl\.peakDb\)/g) || []).length >= 2
        && !/Math\.min\(40, Math\.max\(0, -8 - lvl\.peakDb\)\)/.test(srv)
        && /function modelGainDb/.test(fs.readFileSync(path.join(__dirname, '..', 'sfu', 'ai', 'asr.js'), 'utf8')));
    ok('重转的临时文件每次自己收走（finally 删三个 utt-*，一夜下来目录不能被堆满）',
      /for \(const p of \[pcmPath, wavPath, ampPath\]\)/.test(srv));

    /* —— 字幕条几何：用户的"长度太短"这一半其实是布局 —— */
    const css2 = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'style.css'), 'utf8');
    const capRule = (css2.match(/\.caption-text \{[^}]*\}/) || [''])[0];
    ok('正文允许换行（旧版是 white-space:nowrap + ellipsis，一句话只露前几个字）',
      /white-space: normal/.test(capRule) && !/white-space: nowrap/.test(capRule), capRule.slice(0, 80));
    ok('最多两行且有省略号收尾（-webkit-line-clamp，"不越出线"的硬保证）',
      /-webkit-line-clamp:/.test(capRule));
    ok('容器高度与行数同一个来源（--cap-lines 只写一处，改行数不会把第三行裁掉看不见）',
      /--cap-lines: 2/.test(css2) && /height: calc\(15px \* 1\.5 \* var\(--cap-lines\)\)/.test(css2));
    const html = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'index.html'), 'utf8');
    ok('字幕卡两行结构：正文独占第一行（.cap-line），控件落到第二行（.cap-tools）',
      /class="cap-line"><span id="captionText"/.test(html) && /class="cap-tools"/.test(html));
    ok('captionText 这个 id 全页只有一个（改成两行时最容易留个旧的在原地，JS 只认第一个）',
      (html.match(/id="captionText"/g) || []).length === 1);
    const cli = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'public', 'client.js'), 'utf8');
    ok('超过两行的部分挂进 title：一个字都不丢（悬浮读全文，历史抽屉有整条账）',
      /captionText\.title = `\$\{name\}：\$\{text\}`/.test(cli));
  }

  /* === ★ 2026-10-07 ③.13 两条被真跑抓出来的"礼仪/单位"缺陷 ===
   *   这一组的每一条都对应日志里一个实测到的现象，不是设计评审想出来的。 */
  console.log('\n=== ③.13 续接窗单位 + RMS 冷启动 + 应答因果（2026-10-07 实测）===');
  {
    const srv = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'server.js'), 'utf8');
    /* 缺陷一：`Math.max(2000, 秒) * 1000` 把 6 秒算成 33 分钟。
     *   实测证据（ASR_DEBUG 打点）：`tailUntil剩余=1981680`，设计值 6000。
     *   用户侧表现：只要有人只喊了一声「小明」，接下来半小时里谁说话它都接。
     *   ▸ 反向对照要跑在**剥掉注释**的源码上：上面那段教训把旧写法原样引在注释里，
     *     不剥就会自己判红（坑 103 那条"注释也会打脸断言"，本轮又应验一次）。 */
    const codeOnly = srv.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    ok('分段续接窗按"秒"写下限、再统一换算成毫秒（旧的 max(2000,x)*1000 会算出 33 分钟）',
      /const AI_ASK_TAIL_SEC = Math\.max\(2,/.test(srv)
        && /const AI_ASK_TAIL_MS = AI_ASK_TAIL_SEC \* 1000;/.test(srv)
        && !/Math\.max\(2000,[^;]*\) \* 1000/.test(codeOnly));
    /* 缺陷二：ametadata 打到管道上仍按 ~4KB 成块交付，第一行 RMS 要等约 5 秒；
     *   那段时间 lastVoiceTs=0，gap 代理判据会把开机第一句切在「小明」上。 */
    ok('RMS 一行都没到时不按 gap 切句（冷启动宽限 + 已出过行才算信源活着）',
      /const rmsAlive = lastVoiceTs > 0 \|\| rmsSeen\.lines > 0/.test(srv)
        && /Date\.now\(\) - recBornAt < RMS_GRACE_MS/.test(srv));
    ok('宽限值可配且默认盖过"第一个 RMS 块"（8s；实测 4s 仍会被 gap 切在只含名字的碎片上）',
      /ASR_RMS_GRACE_MS\) \|\| 8000/.test(srv));
    /* 因果记账：自测判"闲聊句有没有被接话"不再靠 7 秒时间窗猜（应答要等 LLM，
     *   窗口会把上一问的答案错记到闲聊句头上——本轮实测撞到的假红）。 */
    ok('语音应答带 trig（引发它的那条字幕时刻），自测据此做因果归因',
      /trig: capTs \|\| null/.test(srv) && /asrWakeAndAnswer\(roomNumber, memberId, text, speakerName, now\)/.test(srv));
    ok('"它为什么开口"在 ASR_DEBUG 下打得出来（woken / 追问窗 / 续接窗三条判据摊开）',
      /\[asr-speak\][^`]*判据 woken=\$\{woken\}/.test(srv));
  }

  /* ══════════════════════════════════════════════════════════════════════
   * ⑬ ★ 2026-10-09 准确率量具 sfu/ai/accuracy.js + 对照跑法 bench-asr-golden.js
   * ▎这一组断言保护的不是"功能"，是**尺子本身**：H3（词级天花板）此前写着"等用户拍板"，
   *   而拍不了的原因就是没有可比的数。尺坏了，后面每一次"改引擎/改阈值"的结论都是假的
   *   ——与坑 98（量具必须能读出 0）、坑 105（没证据不许报通过）是同一条纪律。
   * ▎每条都尽量配**反向对照**：能读出 0、能判出 100%、能拒绝下结论，才算它在做功。
   * ══════════════════════════════════════════════════════════════════════ */
  {
    const Acc = require('../sfu/ai/accuracy.js');
    /* ① tokenize 是"单位"的唯一来源：中文一字一 token、拉丁/数字一串、标点丢弃 */
    ok('⑬.1 tokenize：中文按字切，"GPU 1080"这种串各自成 token，标点不进 token',
      Acc.tokenize('明天三点').join('|') === '明|天|三|点'
        && Acc.tokenize('GPU 1080 号').join('|') === 'gpu|1080|号'
        && Acc.tokenize('三点。').join('|') === '三|点');
    /* ② 尺必须读得出 0 ——否则"CER 高了"这句话没有任何参照（坑 98） */
    ok('⑬.2 反向对照：ref 与 ref 相比必须正好 0%（尺读不出 0 就没有资格报"在变好"）',
      Acc.score('产品评审会定在十月十号', '产品评审会定在十月十号').cer === 0
        && Acc.score('产品评审会定在十月十号', '产品评审会定在十月十号').exact === true);
    ok('⑬.3 标点/空格差不算识别错误（转写自带标点，算进去每档都虚高）',
      Acc.score('明天三点开会', '明天三点开会。').exact === true
        && Acc.score('明天 三点', '明天三点').exact === true);
    ok('⑬.4 一字之差判得出 sub=1 且 cer 离开 0（真实病灶：评审会→庭审会）',
      (() => { const s = Acc.score('产品评审会', '产品庭审会'); return s.sub === 1 && s.cer > 0 && s.grade === 'poor'; })());
    /* ⑤ 诚实线：空转写是最差，不是"没有错误" */
    ok('⑬.5 空转写判 100% 而不是 0%/null（把"什么都没转出来"报成"零错误"是最坏的一种假绿）',
      Acc.score('产品评审会', '').cer === 1 && Acc.score('产品评审会', '').grade === 'poor');
    ok('⑬.6 期望文本为空判"不可比"，不进任何均值（0÷0 不许被读成通过，坑 105）',
      (() => { const s = Acc.score('', '随便转出的一句话'); return s.comparable === false && s.cer === null && s.grade === 'unknown'; })());
    ok('⑬.7 插入让文本变长时 cer 允许 >100%（这是真话，不该被钳成 100%）',
      Acc.score('三点', '三点三点三点').cer > 1);
    /* ⑧ 数字口径：默认不折算是**有意的保守**，两条一起钉才证明它不是遗漏 */
    ok('⑬.8 默认「十号」≠「10号」判为错（量准确率不许借用"判意图"那套归一化）',
      Acc.score('十月十号', '10月10号').exact === false);
    ok('⑬.9 显式 foldDigits 才折算，且口径记在结果里（两张表口径不同就不许互比）',
      Acc.score('十月十号', '10月10号', { foldDigits: true }).exact === true
        && Acc.corpus([{ ref: '十月十号', hyp: '10月10号' }], { foldDigits: true }).foldDigits === true);
    ok('⑬.10 micro 与 macro 分开且不等值（长句小错 + 短句大错；只报一个就会漂移）',
      (() => {
        const c = Acc.corpus([
          { ref: '产品评审会定在十月十号全员参加', hyp: '产品庭审会定在十月十号全员参加' }, // 长句错 1 字
          { ref: '小明', hyp: '小米手机' },                                                  // 短句全错
        ]);
        return c.microCer !== c.macroCer && c.microCer < c.macroCer && c.worst.length >= 1
          && c.worst[0].s.cer >= 1;   // 最差的那句必须排在前面
      })());
    ok('⑬.11 样本量门槛：不足 MIN_SAMPLES 判 enough=false（低于它就打印 ❔，不下结论）',
      (() => {
        const mk = (n) => Array.from({ length: n }, (_, i) => ({ ref: `第${i}句测试`, hyp: `第${i}句测试` }));
        return Acc.corpus(mk(3)).enough === false && Acc.corpus(mk(Acc.MIN_SAMPLES)).enough === true;
      })());
    /* ⑫ 报告文案：没有读数时不许印出一个像"micro 0.0%"的东西
     *   （注意这里不能简单查 "0.0%"——"可用≤10.0%" 这一档标签里天然含这三个字符，
     *     查它会红得莫名其妙；判据要精确到"读数位置"。坑 91 那条"假要求的断言=假红制造机"）*/
    ok('⑬.12 零样本的报告行读数位置印 "—" 与 ❔，绝不印 0.0%（假红伤人，假绿更伤人）',
      (() => {
        const l = Acc.line('x', Acc.corpus([]), '');
        return l.includes('—') && l.includes('❔') && !/micro\s+0\.0%/.test(l) && !/macro\s+0\.0%/.test(l);
      })());
    ok('⑬.13 对照判据：口径不同或样本不足一律拒比（"改好了"必须来自同一把尺的两次读数）',
      (() => {
        const base = { microCer: 0.10, comparable: 8, enough: true, foldDigits: false };
        const fold = { ...base, foldDigits: true };
        const small = { microCer: 0.05, comparable: 2, enough: false, foldDigits: false };
        const tiny = { ...base, microCer: 0.104 };
        const big = { ...base, microCer: 0.04 };
        return Acc.diff(base, fold).comparable === false
          && Acc.diff(base, small).comparable === false
          && Acc.diff(base, tiny).verdict === '无显著变化'
          && Acc.diff(base, big).verdict === '准确率提升';
      })());

    /* ── 接线红线：量具"存在"不够，必须证明对照跑法**用的是这把尺、这条增益链**（坑 41/56）── */
    const runner = fs.readFileSync(path.join(__dirname, 'bench-asr-golden.js'), 'utf8');
    ok('⑬.14 bench-asr-golden 真的 require 了 accuracy.js（不在跑法里另写一份"CER"）',
      /require\(['"]\.\.\/sfu\/ai\/accuracy\.js['"]\)/.test(runner) && /Acc\.corpus\(/.test(runner));
    ok('⑬.15 跑法自己不得实现编辑距离（第二份对齐算法 = 第二个口径，两行数就永远不可比）',
      !/function\s+(levenshtein|editDistance|align)\b/i.test(runner) && !/dp\[i\]\[j\] = Math\.min/.test(runner));
    ok('⑬.16 跑法复用 scripts/voice-fixture 的 makeSpeechWav（TTS 只有一份实现，否则量具的语音比会议的干净）',
      /require\(['"]\.\/voice-fixture\.js['"]\)/.test(runner) && /Fx\.makeSpeechWav\(/.test(runner)
        && !/System\.Speech\.Synthesis/.test(runner));
    ok('⑬.17 跑法的增益走 Asr.modelGainDb（复现生产喂给模型的那份音频，而不是另调一个音量）',
      /Asr\.modelGainDb\(/.test(runner));
    /* ── 算式收口：两处内联 → asr.js 一处（坑 47；症状会是"分段听得清、整句重转反而听不清"）── */
    const srvNoComment = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'server.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    ok('⑬.18 server.js 里不再内联增益算式（两处都改成调 Asr.modelGainDb）',
      !/Math\.min\(40,\s*Math\.max\(0,\s*-8/.test(srvNoComment)
        && (srvNoComment.match(/Asr\.modelGainDb\(/g) || []).length >= 2);
    ok('⑬.19 日志里的"目标 -8 dBFS"也来自同一个数（写死的 -8 会跟着 env 改档位时说假话）',
      /增益 \+\$\{gainDb\.toFixed\(1\)\}dB（峰值 \$\{lvl\.peakDb\.toFixed\(1\)\} → \$\{Asr\.gainTargetDb\(\)\} dBFS）/.test(srvNoComment));
    ok('⑬.20 增益有触发计数并进 /metrics 与快照（"提过音量"这件事必须数得出来，坑 76）',
      /COLLAB\.gainApplied \+= 1/.test(srvNoComment)
        && /sfu_ai_asr_gain_applied_total \$\{COLLAB\.gainApplied\}/.test(srvNoComment)
        && /gainApplied: COLLAB\.gainApplied/.test(srvNoComment));

    /* ── modelGainDb 的算术（钳位两端都要钉：上限防把底噪放大成响噪，下限防把响麦往回拉）── */
    const gain = (peak, env) => {
      const keep = { t: process.env.ASR_GAIN_TARGET_DB, c: process.env.ASR_GAIN_CAP_DB };
      if (env && env.t !== undefined) process.env.ASR_GAIN_TARGET_DB = String(env.t); else delete process.env.ASR_GAIN_TARGET_DB;
      if (env && env.c !== undefined) process.env.ASR_GAIN_CAP_DB = String(env.c); else delete process.env.ASR_GAIN_CAP_DB;
      try { return Asr.modelGainDb(peak); } finally {
        if (keep.t === undefined) delete process.env.ASR_GAIN_TARGET_DB; else process.env.ASR_GAIN_TARGET_DB = keep.t;
        if (keep.c === undefined) delete process.env.ASR_GAIN_CAP_DB; else process.env.ASR_GAIN_CAP_DB = keep.c;
      }
    };
    /* ▸ 这条断言第一版写错过一次，值得留在原地：**"-12 应当不给增益"是假的**。
     *   -12 dBFS 比目标 -8 更**轻**（dBFS 越接近 0 越响），所以 +4dB 是正确行为；
     *   真正的"不许往回拉"发生在 peak 比目标响的时候（-4 dBFS）。
     *   写反的那一条不会保护任何东西，只会红（坑 91：假要求的断言=假红制造机）。 */
    ok('⑬.21 增益算术：-56 → 钳到上限 40（不是 48）；比目标响（-4）→ 0（不许往回拉）',
      gain(-56) === 40 && gain(-4) === 0);
    ok('⑬.21b 比目标轻但差得多（-12 → 4）；正好等于目标（-8 → 0）',
      gain(-12) === 4 && gain(-8) === 0);
    ok('⑬.22 中段线性：-40 → 32；半分贝以下不给增益（省一遍文件拷贝与改名）',
      gain(-40) === 32 && gain(-8.3) === 0);
    ok('⑬.23 env 覆盖生效，且 ASR_GAIN_CAP_DB=0 是合法值（坑 54：`|| 默认值` 会让 0 永久失效）',
      gain(-56, { c: 20 }) === 20 && gain(-56, { c: 0 }) === 0 && gain(-56, { t: -20, c: 40 }) === 36);
    ok('⑬.24 量不到电平（null/NaN）时给 0 增益，不猜',
      Asr.modelGainDb(NaN) === 0 && Asr.modelGainDb(undefined) === 0);
    /* 配置桥（★ 这条防的是"example 里写了、代码只认 env"= 一条静默失效的配置）：
     *   先测桥生效，再把档位显式还原成默认值，免得后面几条断言测到被改过的状态。 */
    const restored = () => Asr.configureGain({ targetDb: -8, capDb: 40 });
    Asr.configureGain({ targetDb: -20, capDb: 30 });
    const viaCfg = Asr.modelGainDb(-56);
    const keepEnv = (() => {
      process.env.ASR_GAIN_CAP_DB = '20';
      const v = Asr.modelGainDb(-56);
      delete process.env.ASR_GAIN_CAP_DB;
      return v;
    })();
    restored();
    ok('⑬.24b config.asrGainCapDb 真被读到（桥生效），且 env 仍优先于 config',
      viaCfg === 30 && keepEnv === 20 && Asr.modelGainDb(-56) === 40);
    ok('⑬.24c server.js 在 CONFIG 加载后调了 configureGain（模板里的键不许是空头支票）',
      /Asr\.configureGain\(\{ targetDb: CONFIG\.asrGainTargetDb, capDb: CONFIG\.asrGainCapDb \}\)/.test(srvNoComment));

    /* ── ★ 2026-10-09 播报形状：超预算不许"拦腰切半句" ──
     * ▎判据跑在**剥掉注释**的源码上（srvNoComment）：旧写法就在注释里被复述了一遍，
     *   不剥会自己判红（坑 103 第三次应验）。 */
    ok('⑬.25 流水线不再按预算切半句（首句永远整句念，后续放不下就整句不念）',
      !/sentence\.slice\(0,\s*room\)/.test(srvNoComment)
        && /if \(spokenChars > 0\)/.test(srvNoComment)
        && /首句 \$\{sentence\.length\} 字超预算，仍整句念出/.test(srvNoComment));
    ok('⑬.26 语音问答那一路把 spoken 传给 aiBrain（@ai 打字那一轨不传——它只进气泡）',
      /\}, \{ spoken: true \}\);/.test(srvNoComment)
        && /function speakShapeLine\(spoken\)/.test(srvNoComment)
        && /if \(!spoken\) return ''/.test(srvNoComment));
    ok('⑬.27 两条答案轨共用同一个 systemExtra 钩子（对话轨与检索轨不许各写一份形状文案）',
      (srvNoComment.match(/systemExtra: speakShapeLine\(opts\.spoken\)/g) || []).length === 2
        && /opts\.systemExtra \|\| ''/.test(fs.readFileSync(path.join(__dirname, '..', 'sfu', 'ai', 'brain.js'), 'utf8')));
  }

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 清理无所谓 */ }


  /* ══ ⑭ ★ 2026-10-10（B3-①）句尾"回声短句"折叠 ══
   * ▎由来不是想象：真人金标准表（bench:asr-golden 的 far 档）转出
   *   「服务器起负载了，把 GPU 显存先降下来。降下来。」——模型把刚说完的尾巴又说了一遍。
   * ▎这条判属"保内容"那一类（被丢的那一份在紧邻的前一份里原样还在），
   *   所以可以比同音字纠正更主动；但"两个相等短句"（强调）与"没有标点的叠词"
   *   （非常非常）**有意不折**——那些是人在说话，不是模型在复读。 */
  const foldEcho = Asr.foldTailEcho;
  ok('⑭.1 真缺陷形状：句末标点之后复读前一句的尾巴 ⇒ 折掉那一份',
    foldEcho('服务器起负载了，把 GPU 显存先降下来。降下来。') === '服务器起负载了，把 GPU 显存先降下来。');
  ok('⑭.2 回声段自带不了尾标点时也折（模型常常最后那个句号都吐丢）',
    foldEcho('把这条记录一下。记录一下') === '把这条记录一下。');
  /* 四条反例——每条都对应一种**真人会这么说**的形状，误折就是把用户的话改脏（坑 109）。
   *   ▸ 名字要写准：⑭.3 不折的原因是"回声段只有 2 字"（两字复读多是刻意强调），
   *     不是"前后相等"——两条不同的判据，各有自己的断言（⑭.3 与 ⑭.3b）。 */
  ok('⑭.3 反例：两字回声不折（「我同意。同意。」是人在强调，不是模型复读）',
    foldEcho('我同意。同意。') === '我同意。同意。');
  ok('⑭.3c 反例：等长的两个短句不折（「没问题。没问题。」是人在重复，判据要求前一句严格更长）',
    foldEcho('没问题。没问题。') === '没问题。没问题。');
  ok('⑭.4 反例：没有句末标点分隔的叠词一律不动（"非常非常"是合法中文）',
    foldEcho('这件事非常重要非常。') === '这件事非常重要非常。');
  ok('⑭.5 反例：回声段不是前一句的尾巴时不许折（那是两句不相干的话）',
    foldEcho('把白板打开。字幕关掉。') === '把白板打开。字幕关掉。');
  ok('⑭.6 反例：只有一句、没有"前一句"可比 ⇒ 原样返回（不许把整条吃掉）',
    foldEcho('降下来。') === '降下来。');
  /* 接线：判据写在 cleanTranscript 里，而不是散在定稿/重转两个调用点后面（坑 47）。
   * ▸ ★ 这条一开始写成了"源码里出现 foldTailEcho(t)"，结果**变异没红**：
   *   把 `t = foldedEcho` 那行删掉（算了不用），源码里那句调用还在、断言照样绿——
   *   这正是坑 41/56 的形状："模块写对了、调用方没接上"。
   *   所以这里改成**走真实入口的行为断言**（cleanTranscript 端到端），
   *   结构断言只作为第二条补充，且必须钉"结果被赋回 t"。 */
  ok('⑭.7 接线：走真实入口 cleanTranscript 也会折掉句尾回声（不是只测那个纯函数）',
    Asr.cleanTranscript('服务器起负载了，把 GPU 显存先降下来。降下来。') === '服务器起负载了，把 GPU 显存先降下来。',
    Asr.cleanTranscript('服务器起负载了，把 GPU 显存先降下来。降下来。'));
  const asrSrcFold = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'ai', 'asr.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('⑭.7b 接线（结构）：折叠的结果被赋回 t（"算了不用"这种半接线要能红）',
    /function cleanTranscript[\s\S]{0,1600}=\s*foldedEcho;/.test(asrSrcFold));
  /* ★ 真实语料回扫（坑 107 那条纪律第二次用）：改"从自然语言里删东西"的判据，
   *   验收必须包含一次真人账本回扫，并且**上限按占比**写、不写逐句清单
   *   ——逐句清单会在用户说出新句子那天变红，那是假红制造机。
   *   ▸ 装上去那晚的基线：1196 句真人转写命中 1 句（0.08%），而那一句本身就是模型复读
   *     「小明你好,小明。小明。」⇒ 命中稀少但非零，正是想要的形态。 */
  {
    const capDir = path.join(__dirname, '..', 'sfu', 'captions');
    let spoken = 0; const folded = [];
    if (fs.existsSync(capDir)) {
      for (const f of fs.readdirSync(capDir)) {
        if (!f.endsWith('.jsonl')) continue;
        for (const line of fs.readFileSync(path.join(capDir, f), 'utf8').split(/\r?\n/)) {
          let e; try { e = JSON.parse(line); } catch (err) { continue; }
          if (!e || e.asr !== true || !e.text) continue;   // 只数麦克风真转写（坑 107 的口径）
          spoken++;
          const out = foldEcho(e.text);
          if (out !== e.text) folded.push({ before: e.text, after: out });
        }
      }
    }
    if (spoken < 50) {
      ok('⑭.8 真人账本回扫：样本不足（<50 句人话）时不下结论，只说明为什么', true, `人话 ${spoken} 句`);
    } else {
      const rate = folded.length / spoken;
      ok('⑭.8 真实账本回扫：被折叠的占比 ≤2%（超过就是判据在吃真话）',
        rate <= 0.02, `${folded.length}/${spoken} = ${(rate * 100).toFixed(2)}%`
        + (folded.length ? ` · 例：${folded[0].before}` : ''));
      ok('⑭.9 折叠是"保内容"的：每一句折叠后仍非空，且必须是原句的前缀',
        folded.every((x) => x.after && x.before.startsWith(x.after)), JSON.stringify(folded.slice(0, 2)));
    }
  }


  /* ══ ⑮ ★ 2026-10-10（C2）"等尾段封口那 1s"：尾巴抢跑放行的判据 ══
   * ▎要买回来的那一秒是量出来的（ASR_DEBUG 实测：静音判据只要 1.2s，实际定稿在 2.6~2.7s，
   *   差值花在等含尾字的那一段被 ffmpeg 封口），而它上一次放松**买回过一次插话**（10-07 夜），
   *   所以这一组的重点不是"能省多少"，而是**三条收紧是否真的在挡最坏形状**。
   * ▸ 判据本体是纯函数 Asr.tailCoveredByRush；服务器那侧只做"取物理事实 + 喂判据"。 */
  const rushCov = Asr.tailCoveredByRush;
  /* 物理常数：16kHz 单声道 s16le = 32 字节/毫秒。下面用"段出生 1000ms、最后一次有声 3000ms、
     RMS 滞后 1000ms"这一组数 ⇒ 需要覆盖到 (3000+1000-1000)=3000ms ⇒ 96000B。 */
  const RUSH = { birthtimeMs: 1000, lastVoiceTs: 3000, rmsLagMs: 1000, okTs: 4100 };
  ok('⑮.1 覆盖到"说话结束+滞后"⇒ 放行（这就是省下来的那 ~1s）',
    rushCov({ ...RUSH, size: 160000, rushedTo: 96000 }) === true);
  ok('⑮.2 反向对照：只吃过半截（32000B < 96000B）⇒ 照旧按住，绝不提前定稿',
    rushCov({ ...RUSH, size: 160000, rushedTo: 32000 }) === false);
  /* ★ 这条是本轮我自己写出来又被反例抓回去的错：第一版把要求写成 min(size, need)，
     于是"文件还没长到 need"也算覆盖到位 —— 而没落盘的那段字节里恰恰可能藏着尾字，
     放行了就是 10-07 修掉的"丢尾"从新入口复发。这条断言现在专门钉它。 */
  ok('⑮.3 反向对照：文件还比"说话结束"短时，读满整个文件也**不算**覆盖到位（丢尾的老路）',
    rushCov({ ...RUSH, size: 64000, rushedTo: 64000 }) === false);
  ok('⑮.4 判据只看"音频覆盖到位"，**不要求那次抢跑转出字**（实测封口段自己也交回 text=""，\
      句尾那个字从来是靠整句重转救的；把"转出字"当放行条件 ⇒ 机制一次都不生效）',
    rushCov({ ...RUSH, size: 160000, rushedTo: 96000, okTs: 0 }) === true
      && rushCov({ ...RUSH, size: 160000, rushedTo: 96000 }) === true);
  ok('⑮.5 纯静音段（出生晚于说话结束）不需要抢跑也算覆盖——否则静音期会把闸门永久按住',
    rushCov({ ...RUSH, birthtimeMs: 5000, size: 4000, rushedTo: 0 }) === true);
  ok('⑮.6 时间取不到（birthtime=0 / 没有 RMS 信源）一律判"不覆盖"：宁可慢，不可丢',
    rushCov({ ...RUSH, birthtimeMs: 0, size: 160000, rushedTo: 96000 }) === false
      && rushCov({ ...RUSH, lastVoiceTs: 0, size: 160000, rushedTo: 96000 }) === false);
  ok('⑮.7 缺字段/坏输入不抛错（判据在热路径上，异常会把成句块整个吞掉）',
    rushCov(undefined) === false && rushCov({}) === false
      && rushCov({ size: 'x', birthtimeMs: null, lastVoiceTs: NaN, rushedTo: undefined, okTs: undefined }) === false);

  /* 整句音频的两个字节账助手（本次新增的行为面：切片有了第二个入口） */
  ok('⑮.7b 乱序切片按**段名**排好再拼：抢跑前缀会早于上一段的封口余量到达（~150ms）',
    Asr.uttOrdered([{ k: 'seg-0008.pcm', b: 1 }, { k: 'seg-0007.pcm', b: 2 }, { k: 'seg-0007.pcm', b: 3 }])
      .map((c) => `${c.k}:${c.b}`).join(',') === 'seg-0007.pcm:2,seg-0007.pcm:3,seg-0008.pcm:1');
  ok('⑮.7c 排序不许改动传进来的数组（那是 uttAudio 的账本本体，排错了下次重转就少字节）',
    (() => {
      const src = [{ k: 'seg-0002.pcm', b: 'a' }, { k: 'seg-0001.pcm', b: 'b' }];
      return Asr.uttOrdered(src).map((c) => c.b).join('') === 'ba' && src.map((c) => c.b).join('') === 'ab';
    })());
  ok('⑮.7d 段数按段名去重：抢跑把一段切成三条前缀仍然只算一段（不白跑一次整句重转）',
    Asr.uttSegmentKinds([{ k: 'seg-0001.pcm' }, { k: 'seg-0001.pcm' }, { k: 'seg-0001.pcm' }]) === 1
      && Asr.uttSegmentKinds([{ k: 'seg-0001.pcm' }, { k: 'seg-0002.pcm' }]) === 2
      && Asr.uttSegmentKinds(undefined) === 0);

  /* ── 接线断言（坑 41/56：纯函数全绿不等于生产里跑到了） ── */
  {
    const srv = fs.readFileSync(path.join(__dirname, '..', 'sfu', 'server.js'), 'utf8');
    const code = srv.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    ok('⑮.8 生产闸门真的调用了这个纯函数（不是测试里自嗨）',
      /Asr\.tailCoveredByRush\(/.test(code) && /const scanTailSegments = \(\)/.test(code));
    ok('⑮.9 旧那条"永远按住"的判据已经改名成一次扫描出两个结论（pending / pendingRushed）',
      !/pendingTailSegment/.test(code) && /out\.pending = true/.test(code) && /out\.pendingRushed = true/.test(code));
    /* ★ 10-07 那次回归的直接对冲：只含名字的碎片句一旦提前定稿 → arm 续接窗 → 下一句被接话。
       而它只是"重转会不会真跑"的三个条件之一（另两条：重转整条关着 / worker 正忙别家）。 */
    ok('⑮.10 放行前必须过 refineWillRun：重转开着 + 段数够 + worker 不忙 + 这句不只叫了个名字',
      /const tailHold = \(TAIL_RUSH_ON && refineWillRun\(mid, u\)\)/.test(code)
        && /if \(!ASR_REFINE_ON \|\| REFINE_MAX_BYTES <= 0\) return false/.test(code)
        && /uttSegmentKinds\(ua\.chunks\) < REFINE_MIN_CHUNKS\) return false/.test(code)
        && /asrEngineBusy > REFINE_YIELD_ABOVE\) return false/.test(code)
        && /!Asr\.isNameOnly\(normAsrText\(u\.text\)\)/.test(code));
    /* ★ 默认开是**同场次 A/B 量出来的**（本机干净机器、qwen-local 就位后各一轮）：
       关 3.3s/3.1s → 开 3.3s/**2.0s**，而 定稿条数(2)、应答次数(1)、正解命中（含尾字「会」）一个都没变差
       ——那三条就是动手前写死的红线。留着 `=0` 这条逃生舱，是因为"多人房里 worker 常年不空闲"
       会让放行很少发生（那是安全侧的少，不是坏），下次要单独量这个变量时得能一键退回。 */
    ok('⑮.11 开关默认开、且留 ASR_TAIL_RUSH=0 整条退回"永远等封口"',
      /const TAIL_RUSH_ON = process\.env\.ASR_TAIL_RUSH !== '0'/.test(code));
    ok('⑮.12 抢跑吃到的字节**也进整句音频**（不补这一半，闸门松不开、尾字也进不了重转）',
      /ua2\.chunks\.push\(\{ k: newest, b: buf \}\)/.test(code) && /uttTake\.set\(newest, flushedTo \+ len\)/.test(code));
    ok('⑮.13 封口段只补余量（skip=uttTake）：同一段被计入两遍就是"整句音频里出现两次"的老账',
      /const skip = Math\.min\(uttTake\.get\(baseName\) \|\| 0, all\.length\)/.test(code)
        && /all\.subarray\(skip\)/.test(code));
    /* 判据本体在 asr.js（下面 ⑮.7b/⑮.7c 直接跑正反例）；这里只钉"生产用的是那一份"。 */
    ok('⑮.14 生产拼整句音频前真的排序（两个入口的切片到达顺序 ≠ 时间顺序）',
      /const uttOrdered = Asr\.uttOrdered;/.test(code)
        && /Buffer\.concat\(uttOrdered\(chunks\)\.map/.test(code));
    ok('⑮.15 "够不够两段"走 asr.js 那一个去重函数（判据不许在服务器里再抄一份）',
      /const uttSegmentKinds = Asr\.uttSegmentKinds;/.test(code)
        && /uttSegmentKinds\(ua\.chunks\) >= REFINE_MIN_CHUNKS/.test(code));
    /* 坑 76：机制没有触发计数，就等于"看起来在跑、实际从未跑过"。 */
    ok('⑮.16 两本触发账都接上了：released（提前定稿）与 held（照旧按住）',
      /COLLAB\.tailRush\.released \+= 1/.test(code) && /COLLAB\.tailRush\.held \+= 1/.test(code)
        && /tailRush: \{ released: 0, held: 0 \}/.test(code));
    ok('⑮.17 /metrics 两行都在且**锚行首**读法可用（HELP 行含同名，坑 74）+ /api/rooms 同源一个数',
      /L\.push\(`sfu_ai_asr_tail_rush_total \$\{COLLAB\.tailRush\.released\}`\)/.test(code)
        && /L\.push\(`sfu_ai_asr_tail_hold_total \$\{COLLAB\.tailRush\.held\}`\)/.test(code)
        && /tailRush: COLLAB\.tailRush/.test(code));
    ok('⑮.18 uttTake 与另外两张水位表同生命周期剪枝（长跑不许只增不减）',
      /for \(const k of \[\.\.\.uttTake\.keys\(\)\]\)/.test(code));
    ok('⑮.19 放行时留一条结构化事件（事后要能回答"这一句为什么没等封口"）',
      /logEvent\('info', 'asr-tail-rush'/.test(code));
    /* ★ 这一条是本轮**被实测否掉的两个写法**之一留下的判据（另一条见 ⑮.4）：
       我曾把"静音确认后从段首整段重读"当成解法，写之前用一个真 wav 量了四刀——
       切掉 0.08s / 0.4s、以及"切掉再补 0.25s 假静音"，三种切片转写结果与整段**一字不差**
       （`scripts/.tmp-tailpad.js`，量完即删）。所以"模型要的是段尾收尾点"这个假设是假的，
       整段重读只会多空跑一次推理。判据反过来钉：**delta 路径不许被顺手改掉**。 */
    ok('⑮.20 抢跑仍只读 delta（从水位起）：整段重读已被实测否决，空跑一次推理换不来字',
      /fs\.readSync\(fd, buf, 0, len, flushedTo\)/.test(code)
        && !/const readFrom =/.test(code) && !/uttDropSegment/.test(code));
    ok('⑮.21 整句音频的字节账：抢跑推 {k,b} 并把水位记进 uttTake，封口段只补余量（不重不漏）',
      /ua2\.chunks\.push\(\{ k: newest, b: buf \}\); ua2\.bytes \+= len;/.test(code)
        && /uttTake\.set\(newest, flushedTo \+ len\)/.test(code)
        && /const skip = Math\.min\(uttTake\.get\(baseName\) \|\| 0, all\.length\)/.test(code)
        && /all\.subarray\(skip\)/.test(code));
    ok('⑮.22 触发计数只在真的要定稿（due）时记，且放行/按住两本互斥（空转不许把计数刷满）',
      /if \(due\) \{[\s\S]{0,400}TAIL_RUSH_ON && tailScan\.pending[\s\S]{0,120}!tailHold/.test(code)
        && /COLLAB\.tailRush\.released \+= 1/.test(code) && /COLLAB\.tailRush\.held \+= 1/.test(code));
    ok('⑮.23 到上限就不推水位（挖声音的老路）：ua2.bytes+len<=REFINE_MAX_BYTES 这一判据必须在',
      /if \(ua2\.bytes \+ len <= REFINE_MAX_BYTES\) \{/.test(code));
  }


  console.log(`\n结果: ${pass} 通过, ${fail} 失败, ${skip} 跳过`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('异常:', e); process.exit(1); });
