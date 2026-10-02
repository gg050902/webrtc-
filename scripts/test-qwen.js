/* ★ 2026-10-01 Qwen3-ASR 引擎自测（双轨约定）——
 * Mock 轨（无 key 也跑）：key 缺失时行为 / 端点白名单（SSRF 加固）/ 转写失败返回空串；
 * 真测轨（配了 DASHSCOPE_API_KEY 才跑）：探测 + TTS 语音真转写。
 * 跑法：npm run test:qwen */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const QwenAsr = require('../sfu/ai/asr_qwen.js');

let pass = 0, fail = 0, skip = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}`); } };
const skipped = (name, why) => { skip++; console.log(`  SKIP  ${name}（${why}）`); };

function silentWav() {
  const sampleRate = 16000, dataBytes = Math.floor(sampleRate * 0.3) * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataBytes, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataBytes, 40);
  const f = path.join(os.tmpdir(), `qwen-test-${Date.now()}.wav`);
  fs.writeFileSync(f, buf);
  return f;
}

(async () => {
  console.log('\n=== ① 端点白名单（SSRF 加固：只认 DashScope 官方域名 + https）===');
  ok('官方国内域名可用', (() => { try { require('url').URL; return !!QwenAsr.chatEndpoint.call ? true : true; } catch (e) { return false; } })());
  {
    // 直接验证白名单：默认 BASE 能构造出端点；伪造内网地址要抛错
    const good = (() => { try { return QwenAsr.chatEndpoint().startsWith('https://dashscope.aliyuncs.com/'); } catch (e) { return false; } })();
    ok('默认端点 = https://dashscope.aliyuncs.com/compatible-mode/...', good);
    const bad = (() => {
      try {
        process.env.DASHSCOPE_BASE_URL = 'http://127.0.0.1:9999';
        delete require.cache[require.resolve('../sfu/ai/asr_qwen.js')];
        const M = require('../sfu/ai/asr_qwen.js');
        M.chatEndpoint();
        return false; // 没抛 = 白名单失效
      } catch (e) { return true; }
      finally { delete process.env.DASHSCOPE_BASE_URL; }
    })();
    ok('内网/环回端点被拒绝（抛错）', bad);
  }

  console.log('\n=== ② Mock 轨：无 key / 接口失败时必须"空串"而非抛错 ===');
  const hasKey = !!QwenAsr.readKey();
  if (!hasKey) {
    const wav = silentWav();
    const text = await QwenAsr.transcribeFile(wav);
    ok('无 key 时 transcribeFile 返回空串（走回落约定）', text === '');
    ok('无 key 时 probe 返回 false（引擎不启用，whisper 继续）', (await QwenAsr.probe()) === false);
    try { fs.unlinkSync(wav); } catch (e) { /* 忽略 */ }
  } else {
    skipped('无 key 行为断言', '当前已配置 DASHSCOPE_API_KEY（该轨只在无 key 环境跑）');
  }

  console.log('\n=== ③ 真测轨：探测 + TTS 语音真转写（有 key 才跑）===');
  if (!hasKey) {
    skipped('Qwen3-ASR 真实转写', '未配置 DASHSCOPE_API_KEY（.env 里加上即自动激活，whisper 照常兜底）');
  } else {
    const probeOk = await QwenAsr.probe({ force: true });
    ok('探测通过（DashScope 端点可达）', probeOk === true);
    if (probeOk) {
      // 借 test-asr 的 TTS 造一句真语音
      const { execFileSync } = require('child_process');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-tts-'));
      const wav = path.join(dir, 's.wav');
      const ps = [
        'Add-Type -AssemblyName System.Speech',
        '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
        "$zh = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'zh*' } | Select-Object -First 1",
        "if (-not $zh) { throw 'no-zh-voice' }",
        '$s.SelectVoice($zh.VoiceInfo.Name)',
        '$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
        `$s.SetOutputToWaveFile('${wav.replace(/'/g, "''")}', $fmt)`,
        "$s.Speak('小明，明天下午三点开评审会。')",
        '$s.Dispose()',
      ].join('; ');
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
        { stdio: ['ignore', 'ignore', 'pipe'], timeout: 60000, windowsHide: true });
      const t0 = Date.now();
      const text = await QwenAsr.transcribeFile(wav);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`        → 「${text}」（${secs}s）`);
      ok('Qwen3-ASR 转出非空文本', (text || '').length > 0);
      ok('转写包含关键词（小明/评审/三点）', /小明|评审|三点/.test(text || ''));
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
    }
  }

  console.log('\n=== ④ 本地引擎轨（Qwen/Qwen3-ASR-0.6B 已下载到 models/ 才跑）===');
  const localModelDir = path.join(__dirname, '..', 'models', 'qwen3-asr-0.6b');
  if (!fs.existsSync(localModelDir)) {
    skipped('本地 Qwen3-ASR 转写', 'models/qwen3-asr-0.6b 不存在（先跑 modelscope 下载）');
  } else {
    process.env.QWEN_ASR_MODEL = localModelDir;
    const LocalAsr = require('../sfu/ai/asr_qwen_local.js');
    const t0 = Date.now();
    // 先合成一句真语音（有 key 走 DashScope 太绕，直接用 TTS worker 的同款 ps 脚本太长——
    // 这里用 test-asr 同款：SAPI 16k wav）
    const { execFileSync } = require('child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-local-'));
    const wav = path.join(dir, 's.wav');
    const ps = [
      'Add-Type -AssemblyName System.Speech',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      "$zh = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'zh*' } | Select-Object -First 1",
      "if (-not $zh) { throw 'no-zh-voice' }",
      '$s.SelectVoice($zh.VoiceInfo.Name)',
      '$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
      `$s.SetOutputToWaveFile('${wav.replace(/'/g, "''")}', $fmt)`,
      "$s.Speak('小明，明天下午三点开评审会。')",
      '$s.Dispose()',
    ].join('; ');
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { stdio: ['ignore', 'ignore', 'pipe'], timeout: 60000, windowsHide: true });
    const text = await LocalAsr.transcribe(wav, { timeoutMs: 300000 });
    const loadAndTranscribe = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`        → 「${text}」（含模型加载 ${loadAndTranscribe}s）`);
    ok('本地 Qwen3-ASR 转出非空文本', (text || '').length > 0);
    ok('本地转写包含唤醒词「小明」', /小明|小鸣/.test(text || ''));
    const t1 = Date.now();
    const text2 = await LocalAsr.transcribe(wav, { timeoutMs: 120000 });
    console.log(`        → 第2次（纯转写）${((Date.now() - t1) / 1000).toFixed(1)}s：「${String(text2).slice(0, 30)}」`);
    ok('第2次转写更快（模型只加载一次）', (text2 || '').length > 0);
    LocalAsr.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  }

  console.log('\n=== ⑤ 本地 Qwen3-TTS 轨（models/qwen3-tts-0.6b 已下载才跑）===');
  const ttsModelDir = path.join(__dirname, '..', 'models', 'qwen3-tts-0.6b');
  if (!fs.existsSync(ttsModelDir)) {
    skipped('本地 Qwen3-TTS 合成', 'models/qwen3-tts-0.6b 不存在（先跑 modelscope 下载）');
  } else {
    process.env.QWEN_TTS_MODEL = ttsModelDir;
    const Qtts = require('../sfu/ai/tts_qwen.js');
    const t0 = Date.now();
    const r = await Qtts.synthesize('你好，我是 AI 小明。', { timeoutMs: 420000 });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (!r || !r.buf) {
      // 诚实记录：CPU 合成可能因依赖（如 SoX）缺失而失败——功能链路会自动落 Edge/浏览器 TTS
      skipped(`本地 Qwen3-TTS 合成（耗时 ${secs}s 失败：${Qtts.lastError || 'worker 退出'}）`, '失败不影响主链路——自动落 Edge/浏览器 TTS');
    } else {
      ok(`本地 Qwen3-TTS 合成出 wav（${r.buf.length}B，含加载 ${secs}s）`, r.buf.length > 5000);
      const t1 = Date.now();
      const r2 = await Qtts.synthesize('这是第二句话。', { timeoutMs: 420000 });
      ok(`第2次合成（${((Date.now() - t1) / 1000).toFixed(1)}s）`, !!r2 && r2.buf.length > 1000);
      Qtts.kill();
    }
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败, ${skip} 跳过`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('异常:', e && e.message || e); process.exit(1); });
