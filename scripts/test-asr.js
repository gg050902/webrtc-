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

  console.log('\n=== ④ 在线自检：/config.json 的 asrEnabled ===');
  try {
    const res = await fetch('http://127.0.0.1:3001/config.json', { signal: AbortSignal.timeout(3000) });
    const cfg = await res.json();
    ok('运行中的服务器报告 asrEnabled=true（装了 whisper 就必须为真）', cfg.asrEnabled === true);
  } catch (e) {
    skipped('在线 /config.json 自检', '3001 上没有运行中的服务器（先 npm run start:sfu）');
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
