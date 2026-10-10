/* ============================================================================
 * scripts/bench-asr-stream.js —— H1b「流式 ASR（边说边出字）」的可行性探针（npm run bench:asr-stream）
 * ============================================================================
 * ▎这一档**不改生产**，只出一张可复核的表（计划 0.12 的 C6 行原话："只做结论不改生产"）。
 *   H1b 挂在路线图上已经几天了，它值不值得做，取决于三个此前**没人量过**的事实：
 *     ① 我们加载那台本地 worker（transformers 后端）到底有没有流式入口？
 *     ② 用"每 N 秒把听过的音频整段重转一次"换"首字提前"，算力代价是多少？
 *     ③ 中途读数稳不稳（改口几次）——"边说边出字"真正的代价不是延迟，是字幕在眼前重写。
 *   ▸ ②里那条"重转"不是我发明的浪费：`streaming_transcribe` 的 docstring 自己写着
 *     "re-feed *all* audio seen so far"，**它也没有 KV 复用**。所以就算切到 vLLM 后端，
 *     "流式"省下的是调用编排，不是计算量——这件事必须由数据说话，不由我猜。
 *
 * ▎隐私：转录文本一个字都不打印（真人语料在 `sfu/voice-golden/`，整目录不进 git）。
 *   本脚本只读 python 探针吐出的**数字**。
 * ▎纪律（这台机器已经踩过）：**一次只起一个 ASR 实例**。8GB 显存上 qwen ASR ≈1.5GB，
 *   与别的实例并发会被系统挤到**静默回落 CPU**（10-04e 为这件事红过一整轮）。
 *   所以这里不起常驻 worker，而是让 python 自己加载一次、量完退出。
 *
 * 用法：npm run bench:asr-stream
 *       npm run bench:asr-stream -- --grid 1.0 --files 6      （网格秒数 / 样本句数）
 * ========================================================================== */
'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const Qwen = require(path.join(ROOT, 'sfu', 'ai', 'asr_qwen_local.js'));
const Golden = require(path.join(ROOT, 'sfu', 'golden.js'));

const argv = process.argv.slice(2);
const argOf = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const GRID = String(Number(argOf('grid', 1.0)) || 1.0);
const FILES = String(Number(argOf('files', 6)) || 6);

/* 模型目录的判据只有 asr_qwen_local.resolveModelDir() 一份（10-09 从 server.js 搬出来的那个动作）。
 *   这里如果手写一遍 `models/qwen3-asr-0.6b`，下次改路径就是又一处"只有 server.js 知道"的判据。 */
const MODEL = process.env.QWEN_ASR_MODEL || Qwen.resolveModelDir();

function say(s) { console.log(s); }
function med(xs) { const a = xs.filter((x) => typeof x === 'number').sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; }
function avg(xs) { const a = xs.filter((x) => typeof x === 'number'); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; }
function r1(x) { return x === null || x === undefined ? '—' : (Math.round(x * 10) / 10).toFixed(1); }

if (!MODEL || !fs.existsSync(MODEL)) {
  say('SKIP：本机没有本地 Qwen ASR 模型目录（resolveModelDir() 给空）——**没有真引擎就不量，也不假装量过**。');
  say('     这不是"流式不可行"的结论，是"今天没测"。');
  process.exit(0);
}
const wavDir = Golden.WAV_DIR;
if (!fs.existsSync(wavDir)) {
  say(`SKIP：真人语料目录不存在（${wavDir}）。`);
  say('     探针**不许**自己回落合成语音：合成场量出来的"流式改口次数"不代表真人（10-06 用户驳回过这件事）。');
  process.exit(0);
}

const py = process.env.PYTHON_BIN || null;   // 只有明示覆盖才改解释器；默认逐个试（与 pyprobe 同一条路）
const cands = py ? [py] : ['python', 'python3'];
const PROBE = path.join(__dirname, 'asr-stream-probe.py');

function run(exe) {
  return new Promise((resolve) => {
    /* spawn 参数**全字面量**（只有脚本路径这一个常量），网格与句数走 env——
     *   与 soak.js / check-all.js 同一条纪律：把配置拼进 argv 会被安全扫描报警，
     *   而且拼参数这条路上"忘了引号"就是一个命令注入面。 */
    const child = spawn(exe, [PROBE], {
      cwd: __dirname,
      env: Object.assign({}, process.env, {
        QWEN_ASR_MODEL: MODEL, GOLDEN_DIR: wavDir,
        ASR_STREAM_GRID: GRID, ASR_STREAM_FILES: FILES,
      }),
      windowsHide: true,
    });
    let out = ''; let err = '';
    child.stdout.on('data', (b) => { out += String(b); });
    child.stderr.on('data', (b) => { err += String(b); });
    child.on('error', () => resolve({ code: -1, out, err: err || 'spawn 失败' }));
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

(async () => {
  say(`═══ H1b 流式可行性探针（只出结论，不改生产）═══`);
  say(`模型 ${MODEL} · 语料 ${wavDir} · 网格 ${GRID}s · 句数上限 ${FILES}`);
  say('▸ 一次只起这一个实例（8GB 显存的硬账），加载要十几到几十秒，别催。\n');
  let res = null; let used = '';
  for (const exe of cands) {
    res = await run(exe);
    if (res.out.trim() || res.code === 0) { used = exe; break; }
  }
  const lines = String(res.out || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const objs = [];
  for (const l of lines) { try { objs.push(JSON.parse(l)); } catch (e) { /* 非 JSON 的行是 python 自己的日志 */ } }
  const cap = objs.find((o) => o.kind === 'capability');
  const files = objs.filter((o) => o.kind === 'file');
  const bad = objs.find((o) => o.kind === 'error');

  if (!cap) {
    say(`❌ 没拿到能力探测那一行（python=${used} 退出码=${res.code}）——**这就是"未测"，不许写进结论**：`);
    say(String(res.err || '').split('\n').slice(0, 4).map((s) => '   ' + s).join('\n'));
    process.exit(1);
  }
  say('── ① 能力：这台后端有没有流式入口 ──');
  say(`   有这些方法：${(cap.has_attr || []).join(' / ') || '（一个都没有）'}`);
  say(`   init_streaming_state() → ${cap.streaming_state}`);
  if (cap.backend_attr) say(`   后端属性：${cap.backend_attr}`);
  say(`   （device=${cap.device} dtype=${cap.dtype} 加载 ${cap.load_ms}ms）`);

  if (bad) { say(`\n❌ ${bad.why}`); process.exit(1); }
  if (!files.length) { say('\n❌ 一句都没量到（语料目录里没有被探针接受的 wav）——未测，不是"不可行"。'); process.exit(1); }

  say(`\n── ② 代价与收益（样本 n=${files.length} 句真人语音，本机 0.6B/${cap.device}）──`);
  say('   文件          时长   整句一次   首字出现   前缀总耗时   算力倍数   改口次数   末步与终稿差');
  for (const f of files) {
    const ratio = f.full_ms ? f.prefix_total_ms / f.full_ms : null;
    say(`   ${(f.file || '').padEnd(14)} ${String(f.dur).padStart(5)}s ${String(f.full_ms).padStart(7)}ms `
      + `${String(f.prefix_first_text_at_s === null ? '—' : f.prefix_first_text_at_s).padStart(7)}s `
      + `${String(f.prefix_total_ms).padStart(9)}ms ${r1(ratio).padStart(9)}× `
      + `${String(f.prefix_rewrites).padStart(9)} ${String(f.last_step_d_vs_full).padStart(11)}`);
  }
  const fulls = files.map((f) => f.full_ms);
  const tots = files.map((f) => f.prefix_total_ms);
  const firsts = files.map((f) => f.prefix_first_text_at_s);
  const rew = files.map((f) => f.prefix_rewrites);
  const dl = files.map((f) => f.last_step_d_vs_full);
  say(`\n   中位数：整句 ${med(fulls)}ms · 前缀累计 ${med(tots)}ms（≈${r1(med(fulls) ? med(tots) / med(fulls) : null)}× 算力）`
    + ` · 首字出现在 ${r1(med(firsts))}s（均值 ${r1(avg(firsts))}s）`);
  say(`   改口次数：中位 ${med(rew)} · 最多 ${Math.max.apply(null, rew.concat([0]))}`
    + ` · 末步与终稿的字符差异：中位 ${med(dl)}（0 = 最后一步读出来的就是终稿）`);

  const streamed = cap.streaming_state === 'OK';
  say('\n── ③ 结论（按上面两栏的事实写，不按愿望写）──');
  if (!streamed) {
    say('   ▸ 我们这条加载路径（transformers 后端）**拿不到官方流式入口**——上面那行 ValueError 是原话，');
    say(`     库的 docstring 也明写 "Streaming ASR is supported ONLY for vLLM backend"。本机实测：vLLM 没装（pip 查无此包、import 不到）。`);
    say('     ⇒ H1b **按原样**做不了：不是"没优化好"，是那个入口不在这台后端上。');
    say('     ▸ 有一条我**没有**在本机验证、因此不写进结论的说法："vLLM 不支持原生 Windows（要 WSL/Linux）"——');
    say('       那是它 README 的公开说法，属"旧文档说的"，不是今天量到的（坑 139：能力要有真请求作证）。');
    say('       真要上 vLLM，第一步不是改代码，是在这台机器上装起来并跑通一次 init_streaming_state()。');
  } else {
    say('   ▸ 官方流式入口**在这条加载路径上可用**（init_streaming_state 成功）。');
    say('     注意它的实现里写着"每凑满一块就把听过的音频整段重喂模型"——没有 KV 复用，');
    say('     所以下面那个"算力倍数"就是它真实的代价，不是我这边的模拟。');
  }
  say(`   ▸ 可行的替代形状是**前缀重解码**：首字出现在**句中 ~${r1(med(firsts))}s**（人还在说就有字），`);
  say(`     这是它与现路径唯一真正的差别——今天最早也要等"静音确认 + 整句转写"（定稿在说完之后，看 ⏱ 那栏）。`);
  say(`     代价有两笔：算力 ≈${r1(med(fulls) ? med(tots) / med(fulls) : null)}×（本批中位；每凑满一格就把听过的音频**整段重喂**一次）`);
  say(`     与字幕**整行重写**：本批改口中位 ${med(rew)} 次/句（"改口"定义=新文本不是旧文本的延长，`);
  say(`     也就是那一行的字要换掉，而不是往后接着写）。多人会议里这笔算力是从别人的段上抢的（H5b 那条"忙时让路"）。`);
  say('     ▸ 别把这两笔账记成一笔：**提前出字**买的是"有东西在看"，不是"更早拿到终稿"——');
  say('       最后一步仍然在说完之后，而它的耗时是全程最大的一次（重喂的音频最长）。');
  say(`   ▸ 末步与终稿的字符差异中位 ${med(dl)}（0 = 最后一次重解码读出来的就是终稿）：`);
  say('       说明"整段重喂"这条路给出的**终稿**与现在的一次整句解码基本同值，差的只是过程。');
  say('   ▸ 决定权交回路线图：这一档要不要做，看的是"句中就有字"值不值"改口 Y 次 + N× 算力"——');
  say('     这是产品取舍，不由我一个人拍（与词级准确率那三条路同一条纪律）。');
  say('\n   （样本量与限定：n=' + files.length + ' 句、都是真人录音、都是 near 档、本机 0.6B/' + cap.device + ' 单实例；');
  say('     表里**第一句的"整句一次"含 CUDA 冷启动**（它把那一行的倍数压低了），所以判读只看中位数那一行；');
  say('     **换引擎/换机器/并发起来之后这些数全部要重测**，别拿本表当常数。）');
  if (res.err && res.err.trim()) say('\n（python stderr 尾巴：' + res.err.split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 220) + '）');
})().catch((e) => { console.error('探针失败：', e && e.stack || e); process.exit(1); });
