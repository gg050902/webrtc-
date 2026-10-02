/* ══════════════════════════════════════════════════════════════
 * scripts/bench-asr-accuracy.js —— ★ P2-② ASR 模型选型评测（2026-10-01）
 *
 * ▎是什么：用**常驻 worker**（真实生产路径）对同一批 TTS 中文语句跑 tiny/base/small
 *   三档模型，输出"延迟 + 命中关键词数"对照表——`config.asrModel` 选型不再靠猜。
 * ▎怎么跑：npm run bench:asr（约 1~2 分钟：每档一次模型加载 + 3 句转写）
 * ▎诚实边界：TTS 合成语音≠真人嗓音，命中数是**下限参考**；真人差异请以 test:asr-live
 *   的全闭环 + 真机听感为准。
 * ══════════════════════════════════════════════════════════════ */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Asr = require('../sfu/ai/asr.js');

const SENTENCES = [
  { text: '小明，请帮我把明天的会议改到下午三点。', keys: ['小明', '会议', '三点'] },
  { text: '压测报告由张伟负责，周五之前提交。', keys: ['压测', '报告', '周五'] },
  { text: '产品评审会定在十月十号，全员参加。', keys: ['评审', '十月', '参加'] },
];

function makeSpeechWav(dir, text, idx) {
  const wav = path.join(dir, `s${idx}.wav`);
  // 中文走命令行会被 GBK 控制台弄坏 → 写 UTF-8 BOM 的 .ps1 文件再执行（test-asr 同款教训）
  const ps = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    "$zh = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'zh*' } | Select-Object -First 1",
    "if (-not $zh) { throw 'no-zh-voice' }",
    '$s.SelectVoice($zh.VoiceInfo.Name)',
    '$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
    `$s.SetOutputToWaveFile('${wav.replace(/'/g, "''")}', $fmt)`,
    `$s.Speak('${text.replace(/'/g, "''")}')`,
    '$s.Dispose()',
  ].join('; ');
  fs.writeFileSync(path.join(dir, `t${idx}.ps1`), Buffer.from('\uFEFF' + ps, 'utf8'));
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `& '${path.join(dir, `t${idx}.ps1`).replace(/'/g, "''")}'`],
    { stdio: ['ignore', 'ignore', 'pipe'], timeout: 60000, windowsHide: true });
  if (!fs.existsSync(wav) || fs.statSync(wav).size < 10000) throw new Error('TTS 合成失败（无中文音色？）');
  return wav;
}

(async () => {
  const runner = await Asr.probeWhisper();
  if (!runner) { console.log('whisper 不可用，无法评测'); process.exit(1); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asr-bench-'));
  const wavs = [];
  try {
    for (let i = 0; i < SENTENCES.length; i++) wavs.push(makeSpeechWav(dir, SENTENCES[i].text, i));
    console.log(`测试语句 ${wavs.length} 句（TTS 合成，16k 单声道）\n`);
    console.log('模型   | 首段(含加载) | 后续段均速 | 关键词命中');
    console.log('-------+-------------+-----------+-----------');
    for (const model of ['tiny', 'base', 'small']) {
      const w = Asr.createResidentTranscriber({ model, timeoutMs: 120000 });
      let firstMs = 0, restSum = 0, hits = 0, keysTotal = 0, texts = [];
      for (let i = 0; i < wavs.length; i++) {
        const t0 = Date.now();
        const text = await w.transcribe(wavs[i]);
        const ms = Date.now() - t0;
        if (i === 0) firstMs = ms; else restSum += ms;
        for (const k of SENTENCES[i].keys) { keysTotal++; if ((text || '').includes(k)) hits++; }
        texts.push(`「${String(text || '').slice(0, 24)}」`);
      }
      const avg = wavs.length > 1 ? (restSum / (wavs.length - 1) / 1000).toFixed(1) : '-';
      console.log(`${model.padEnd(6)} | ${(firstMs / 1000).toFixed(1)}s        | ${avg}s       | ${hits}/${keysTotal}`);
      texts.forEach((t, i) => console.log(`       ${i === 0 ? '└ 转写' : '  '} ${t}`));
      w.kill();
    }
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  }
  console.log('\n选型建议：small（默认）准确率明显更好且常驻下延迟可接受；tiny 只在低配机/省内存时用。');
})().catch((e) => { console.error('评测异常:', e && e.message || e); process.exit(1); });
