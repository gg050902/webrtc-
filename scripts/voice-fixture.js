'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
 *  scripts/voice-fixture.js —— "给浏览器喂一段能过成句闸的中文语音"的唯一实现
 * ═══════════════════════════════════════════════════════════════════════════
 * ▎为什么要单独一个文件（与 sfu/password.js、sfu/jsonc.js、sfu/nets.js 同一条路）：
 *   Chrome 的 `--use-fake-device-for-media-stream` 送的是**近乎静音**的假麦克风，
 *   而服务器那侧第一道闸就是能量闸（-62 dBFS 以下连模型都不叫）。
 *   所以任何"要真出字幕"的浏览器测试，都必须自备一段**真语音 + 够长的静音**。
 *   这件事有两半（合成 + 拼接）和一条质量线（最长静音 ≥3s），写两份迟早漂——
 *   漂的那一份会以"零定稿"的面目失败，而那种失败**指向被测代码，其实错在 fixture**。
 *
 * ▎★ 2026-10-06 这条纪律是怎么被验证需要的：test-e2e-reconnect 的"续会识别"断言
 *   原先拿页面上那个 ⏱ 读数当"账本就绪"的代理信号，而假麦克风根本没出声 →
 *   账本一直是空的。读数元素改成初态隐藏之后代理失效，才把"这条从来没验到"暴露出来。
 *   修法不是把断言放宽，是**把输入补上**：用这里合成的 wav 当假麦克风。
 *
 * ▎零依赖：PowerShell 的 System.Speech（Windows 自带中文音色）+ Node 内置 Buffer 拼 WAV。
 * ═══════════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

/** 从 PCM WAV 取采样率与 data 块（通用扫描，跳过 fact 等额外块）。 */
function readWavPcm(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`不是 WAV：${file}`);
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    else if (id === 'data') data = buf.slice(body, Math.min(body + size, buf.length));
    off = body + size + (size % 2);   // 块按偶数字节对齐
  }
  if (!fmt || !data) throw new Error(`WAV 缺 fmt/data 块：${file}`);
  if (fmt.channels !== 1 || fmt.bits !== 16) throw new Error(`WAV 不是 16bit 单声道：ch=${fmt.channels} bits=${fmt.bits}`);
  return { rate: fmt.rate, pcm: data };
}

/** 把 16bit 单声道 PCM 装回 WAV 容器。 */
function buildWav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii'); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii'); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** 最长"数字静音"时长（秒）：0.25s 窗内峰值为 0 采样即静音。
 *  数字静音是精确的 0，合成语音哪怕最轻的过渡也不为 0——阈值取 16/32768 即可。 */
function longestSilenceSec(pcm, rate) {
  const win = Math.round(rate * 0.25) * 2;
  let run = 0; let best = 0;
  for (let w = 0; w < pcm.length; w += win) {
    const end = Math.min(w + win, pcm.length);
    let peak = 0;
    for (let i = w; i + 1 < end; i += 2) { const v = Math.abs(pcm.readInt16LE(i)); if (v > peak) peak = v; }
    if (peak < 16) { run += 0.25; if (run > best) best = run; } else run = 0;
  }
  return best;
}

/**
 * 合成一段"说一句 → 长静音 → 再说一句 → 更长静音"的中文测试语音，返回 wav 路径。
 * 浏览器会**循环播放**这个文件，所以尾部静音要与开头相接后仍然够长。
 *
 * @param {object} o
 * @param {string[]} o.sentences  要说的句子（逐句分开合成，停顿由本函数拼数字静音）
 * @param {string}  [o.dir]       工作目录（默认临时目录下的独立子目录）
 * @param {string}  [o.outName]   产物文件名（默认 speech.wav）
 * @param {number}  [o.gapSec]    句间静音秒数（默认 4）
 * @param {number}  [o.tailSec]    尾部静音秒数（默认 8）
 * @param {number}  [o.minSilenceSec] 质量线下限（默认 3：成句闸要 >1.2s，留 2.5 倍余量）
 * @returns {Promise<{file:string, durSec:number, silSec:number, sizeKb:number}>}
 */
async function makeSpeechWav(o = {}) {
  const sentences = (o.sentences || []).map((s) => String(s)).filter(Boolean);
  if (!sentences.length) throw new Error('makeSpeechWav: 没给句子');
  const dir = o.dir || path.join(os.tmpdir(), 'qoder-voice-fixture');
  const out = path.join(dir, o.outName || 'speech.wav');
  const gapSec = o.gapSec || 4;
  const tailSec = o.tailSec || 8;
  const minSil = o.minSilenceSec || 3;
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  fs.mkdirSync(dir, { recursive: true });

  const esc = (p) => p.replace(/\\/g, '\\\\').replace(/'/g, "''");
  const parts = sentences.map((_, i) => path.join(dir, `sent${i + 1}.wav`));
  const ps = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    "$zh = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'zh*' } | Select-Object -First 1",
    "if (-not $zh) { throw 'no-zh-voice' }",
    '$s.SelectVoice($zh.VoiceInfo.Name)',
    '$s.Rate = 0',
    '$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
    ...sentences.map((sent, i) =>
      `$s.SetOutputToWaveFile('${esc(parts[i])}', $fmt); $s.Speak('${String(sent).replace(/'/g, "''")}')`),
    '$s.Dispose()',
  ].join('; ');
  await new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { timeout: 90000, windowsHide: true }, (err) => (err ? reject(err) : resolve()));
  });

  const read = parts.map((p) => readWavPcm(p));
  const rate = read[0].rate;
  if (read.some((r) => r.rate !== rate)) throw new Error(`各句合成采样率不一致：${read.map((r) => r.rate).join('/')}`);
  const sil = (sec) => Buffer.alloc(Math.round(rate * sec) * 2);   // 16bit 单声道：每样本 2 字节
  const pcm = Buffer.concat(read.reduce((acc, r, i) => {
    acc.push(r.pcm);
    acc.push(sil(i === read.length - 1 ? tailSec : gapSec));
    return acc;
  }, []));
  fs.writeFileSync(out, buildWav(pcm, rate));

  /* 质量防线：最长静音不够就说明 fixture 自己不合格——**先证明输入真的能触发被测路径**，
   *   再谈被测代码红不红（坑 65/72 同族）。 */
  const silSec = longestSilenceSec(pcm, rate);
  if (silSec < minSil) {
    throw new Error(`fixture 不合格：最长静音仅 ${silSec.toFixed(2)}s（要求 ≥${minSil}s，成句闸需 >1.2s）——检查合成输出`);
  }
  return {
    file: out,
    durSec: +(pcm.length / 2 / rate).toFixed(1),
    silSec,
    sizeKb: +(fs.statSync(out).size / 1024).toFixed(0),
  };
}

/* ★ 2026-10-06 把"喂给假麦克风的那几句话"收成**唯一一份**（原先三个测试各写一遍，
 *   同一概念三个来源=坑 47）。这次合并还有一个真实用途：
 *   `review:meeting` 靠它分辨"这场会是自测场还是真人场"——
 *   以前那台复盘只会把两者混在一起数，于是"用户真实可用性"的结论里其实掺着我自测的循环语音。
 *   ▸ 句子内容与各测试的断言绑定（关键词必须原样保留），**改这些字符串等于改契约**。 */
const FIXTURE_SENTENCES = [
  '小明，帮我记一下明天下午三点的评审会。',
  '小明，把纪要生成一下。',
  '小明，帮我把这条记录一下，明天下午三点开评审会。',
  '小明，今天的服务器负载看起来怎么样？',
  '小明，把刚才说的重点生成一段纪要。',
];

/** 这句话像不像"自测 fixture 里的那几句"（ASR 会把它切碎、会写错个别字，所以判覆盖率而不是相等）。 */
function looksLikeFixtureCaption(text) {
  const norm = String(text || '').replace(/[\s。，,、？！?!；;：:."'"“”‘’]/g, '');
  if (norm.length < 6) return false;          // 太短的碎片不下结论（"小明" 两个字不算证据）
  const grams = (s) => { const g = []; for (let i = 0; i < s.length - 1; i++) g.push(s.slice(i, i + 2)); return g; };
  for (const sent of FIXTURE_SENTENCES) {
    const base = new Set(grams(sent.replace(/[\s。，,、？！?!；;：:]/g, '')));
    const cur = grams(norm);
    if (!cur.length) continue;
    const covered = cur.filter((g) => base.has(g)).length / cur.length;
    if (covered >= 0.6) return true;          // 六成大二元组落在 fixture 里 ⇒ 这是自测场在念稿
  }
  return false;
}

/* ★ 2026-10-06 房间级的补判据：**碎片拼起来**才是那句话。
 *   ▎为什么需要：2s 分段会把「小明，帮我记一下明天下午三点的评审会」切成
 *     「我记一下，明天下午三点。」「的评审会。」这种 4~10 字的碎片，
 *     而 looksLikeFixtureCaption 对 <6 字的碎片**有意不下结论**（否则"小明"两个字到处命中）。
 *     后果是真实的：房间 204534 整场都是念稿碎片，逐条判只有 48%，被标成"混合场"——
 *     数字没错，结论却 understated。把整场的字连起来再量一次大元组覆盖，
 *     就把这种"碎成一片的念稿"认回来了。 */
function fixtureRoomCoverage(joinedText) {
  const norm = String(joinedText || '').replace(/[\s。，,、？！?!；;：:.\-"'“”‘’（）()]/g, '');
  if (norm.length < 12) return 0;
  const grams = new Set();
  for (let i = 0; i < norm.length - 1; i++) grams.add(norm.slice(i, i + 2));
  let best = 0;
  for (const sent of FIXTURE_SENTENCES) {
    const s = sent.replace(/[\s。，,、？！?!；;：:]/g, '');
    let hit = 0, total = 0;
    for (let i = 0; i < s.length - 1; i++) { total++; if (grams.has(s.slice(i, i + 2))) hit++; }
    if (total) best = Math.max(best, hit / total);
  }
  return best;
}

/* ★ 2026-10-06 夜二 「**没叫它**」的那句闲聊：专用于"不被叫到就不该开口"的反向用例。
 * ▎为什么它有意**不在** FIXTURE_SENTENCES 里：那份清单的职责是"把自测场从真人场里挑出去"
 *   （判据=像不像在念那几句带名字的请求），而这一句不含名字、也不像请求，混进去
 *   会让"念稿识别"的判据变得含混（坑 47：一个清单只回答一个问题）。
 * ▎但它同样**只此一份**：服务器闭环自测（sfu/server.js 的 TEST_ASR）与真浏览器 e2e
 *   都引用它。两句一样的话各写一份，改了一句忘另一句时，红的那个测试会指向错的地方。 */
const FIXTURE_CHATTER = '今天天气真不错，拍卖啊。';

module.exports = { fixtureRoomCoverage, makeSpeechWav, readWavPcm, buildWav, longestSilenceSec, FIXTURE_SENTENCES, FIXTURE_CHATTER, looksLikeFixtureCaption };
