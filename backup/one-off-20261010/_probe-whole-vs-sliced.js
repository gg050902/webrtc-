'use strict';
/* 一次性对照实验（量完即删）：整句音频一次转写 vs 2s 分段分别转写再归并。
 * 目的：给"字幕太短/识别太笨"这一刀定靶子——不猜，用生产同一批函数量出来。
 * 用法：node scripts/_probe-whole-vs-sliced.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
/* 与 sfu/server.js:7093 同一份约定：本地模型目录（不设则 worker 会去 HF 下载 → 卡死） */
process.env.QWEN_ASR_MODEL = process.env.QWEN_ASR_MODEL || path.join(__dirname, '..', 'models', 'qwen3-asr-0.6b');
const Asr = require('../sfu/ai/asr');
const Q = require('../sfu/ai/asr_qwen_local');
const VF = require('./voice-fixture');

const RATE = 16000;
const CHUNK_SEC = 2;                 // 与 config.asrSegmentSec 一致
const GATE_DB = -62;                 // 与 config.asrMinPeakDb 一致
const GAIN_TARGET = -8, GAIN_CAP = 40;

function peakDb(pcm) {
  let peak = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) {
    const s = Math.abs(pcm.readInt16LE(i));
    if (s > peak) peak = s;
  }
  return peak > 0 ? 20 * Math.log10(peak / 32768) : -99;
}
function gainPcm(pcm, lin) {
  const out = Buffer.allocUnsafe(pcm.length);
  for (let i = 0; i + 1 < pcm.length; i += 2) {
    let v = Math.round(pcm.readInt16LE(i) * lin);
    if (v > 32767) v = 32767; else if (v < -32768) v = -32768;
    out.writeInt16LE(v, i);
  }
  return out;
}
async function transcribePcm(pcm, dir, tag) {
  if (pcm.length < 3200) return '';                 // SEG_MIN_BYTES 同口径
  const db = peakDb(pcm);
  if (db < GATE_DB) return '';                       // 能量闸：判静音，连模型都不叫
  let payload = pcm;
  const g = Math.min(GAIN_CAP, Math.max(0, GAIN_TARGET - db));
  if (g > 0.5) payload = gainPcm(pcm, Math.pow(10, g / 20));
  const wav = path.join(dir, `${tag}.wav`);
  fs.writeFileSync(wav, VF.buildWav(payload, RATE));
  const t0 = Date.now();
  const raw = await Q.transcribe(wav);
  const ms = Date.now() - t0;
  try { fs.unlinkSync(wav); } catch (e) { /* win 占用 */ }
  return { text: Asr.cleanTranscript(String(raw || '')), ms };
}

/* 打分：与真句比归一化字符——命中字数 / 真句字数，以及多出来的字数 */
function score(gt, out) {
  const a = Asr.normAsrText(gt), b = Asr.normAsrText(out || '');
  let hit = 0;
  const pool = [...b];
  for (const ch of a) { const i = pool.indexOf(ch); if (i >= 0) { hit += 1; pool.splice(i, 1); } }
  return { hit, gtLen: a.length, outLen: b.length, cov: a.length ? hit / a.length : 0, extra: b.length - hit };
}

(async () => {
  const sentences = [...VF.FIXTURE_SENTENCES, VF.FIXTURE_CHATTER];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-probe-'));
  console.log('⏳ 预热 Qwen 本地 worker…');
  await Q.warm();
  const rows = [];
  for (const sent of sentences) {
    const { file } = await VF.makeSpeechWav({ sentences: [sent], dir, outName: 'one.wav', gapSec: 0, tailSec: 3, minSilenceSec: 1 });
    const { pcm } = VF.readWavPcm(file);
    // A) 生产现状：2s 一段分别转写 → mergeTranscript 归并
    let stitched = '';
    const sliceMs = [];
    for (let off = 0; off < pcm.length; off += CHUNK_SEC * RATE * 2) {
      const chunk = pcm.subarray(off, Math.min(off + CHUNK_SEC * RATE * 2, pcm.length));
      const r = await transcribePcm(chunk, dir, `c${off}`);
      if (r && r.text) { stitched = Asr.mergeTranscript(stitched, r.text); sliceMs.push(r.ms); }
    }
    // B) 整句一次转写（含尾部静音段，与生产"整段累积 PCM"等价）
    const whole = await transcribePcm(pcm, dir, 'whole');
    const sa = score(sent, stitched), sb = score(sent, whole.text);
    rows.push({ sent, stitched, whole: whole.text, sa, sb, sliceMs: sliceMs.reduce((x, y) => x + y, 0), wholeMs: whole.ms });
    console.log(`\n真句：${sent}`);
    console.log(`  A 分段归并：${JSON.stringify(stitched)}  覆盖 ${(sa.cov * 100).toFixed(0)}% 多字 ${sa.extra}`);
    console.log(`  B 整句一次：${JSON.stringify(whole.text)}  覆盖 ${(sb.cov * 100).toFixed(0)}% 多字 ${sb.extra}`);
    console.log(`  耗时：A 合计 ${(sliceMs.reduce((x, y) => x + y, 0) / 1000).toFixed(2)}s vs B ${(whole.ms / 1000).toFixed(2)}s`);
  }
  console.log('\n═══ 汇总 ═══');
  const covA = rows.reduce((s, r) => s + r.sa.cov, 0) / rows.length;
  const covB = rows.reduce((s, r) => s + r.sb.cov, 0) / rows.length;
  const exA = rows.reduce((s, r) => s + r.sa.extra, 0);
  const exB = rows.reduce((s, r) => s + r.sb.extra, 0);
  const msA = rows.reduce((s, r) => s + r.sliceMs, 0);
  const msB = rows.reduce((s, r) => s + r.wholeMs, 0);
  const exactA = rows.filter((r) => Asr.normAsrText(r.stitched) === Asr.normAsrText(r.sent)).length;
  const exactB = rows.filter((r) => Asr.normAsrText(r.whole) === Asr.normAsrText(r.sent)).length;
  console.log(`平均字符覆盖率  A=${(covA * 100).toFixed(1)}%  B=${(covB * 100).toFixed(1)}%`);
  console.log(`逐字全对句数    A=${exactA}/${rows.length}  B=${exactB}/${rows.length}`);
  console.log(`多余字数合计    A=${exA}  B=${exB}`);
  console.log(`模型耗时合计    A=${(msA / 1000).toFixed(2)}s  B=${(msB / 1000).toFixed(2)}s`);
  fs.rmSync(dir, { recursive: true, force: true });
  await Q.kill();
  process.exit(0);
})().catch((e) => { console.error('探针异常：', e); process.exit(1); });
