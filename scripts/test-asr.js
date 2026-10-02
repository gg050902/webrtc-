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
const ok = (name, cond) => { if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}`); } };
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

  console.log('\n=== ⑤ 配置模板：example 带注释也要能解析（复制即用）===');
  try {
    const { parseJsonc } = require('../sfu/jsonc');
    const ex = parseJsonc(fs.readFileSync(path.join(__dirname, '..', 'sfu', 'config.example.json'), 'utf8'));
    ok('config.example.json 可被容错解析（带 // 注释）', !!ex && typeof ex === 'object');
    ok('模板含 ASR 三个新键（asrModel / asrSegmentSec / aiChatWindowSec）',
      ex.asrModel === 'small' && Number(ex.asrSegmentSec) > 0 && Number(ex.aiChatWindowSec) > 0);
  } catch (e) {
    ok(`config.example.json 可被容错解析（带 // 注释）—— ${e.message}`, false);
  }

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 清理无所谓 */ }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败, ${skip} 跳过`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('异常:', e); process.exit(1); });
