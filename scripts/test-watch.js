#!/usr/bin/env node
/* ★ 2026-10-03 watch 的退化诊断回归（npm run test:watch）
 * ▎为什么单独一套：判断逻辑跑在**长跑值守**里，出错的方式很特殊——
 *   要么天天误报（人很快就不看告警了），要么永远不报（故障静默）。
 *   两种都不会让任何功能测试变红，只能拿合成输入把控制律穷举一遍
 *   （同 `rdDecideFps` 那条纪律：性能/判断类逻辑恰恰最需要确定性）。
 * ▎watch.js 被 require 时只导出函数、不打日志不开循环，所以这里可以直接驱动它。 */
'use strict';

const { diagnoseVoiceAndCollab } = require('./watch.js');

let checks = 0;
let issues = 0;
function ok(cond, msg) {
  checks++;
  if (cond) console.log(`  PASS  ${msg}`);
  else { issues++; console.log(`  ❌ FAIL  ${msg}`); }
}

const m = (segs, rejected = 0, issued = 0, applied = 0, capLat = null, primaryReady = undefined, speakLat = null) => {
  const lines = [];
  for (const [eng, n] of Object.entries(segs)) lines.push(`sfu_ai_asr_segments_total{engine="${eng}"} ${n}`);
  lines.push(`sfu_board_records_total{op="rejected"} ${rejected}`);
  if (issued) lines.push(`sfu_room_control_total{action="board-open"} ${issued}`);
  if (applied) lines.push(`sfu_room_control_applied_total{action="board-open"} ${applied}`);
  /* ★ 2026-10-03 两条端到端延迟各三项 gauge：{n, avg, max} 或 null（= 这条还没量到过）
   *   ▸ 必须和 server 的 latBlock 一模一样：base 名、kind label、counter 命名，
   *     任何一处改了另一边没跟上，这条测试就会"绿着什么都不验"（坑 56 的指标版）。 */
  const latLines = (base, c) => c ? [
    `${base}_count_total ${c.n}`,
    `${base}{kind="avg"} ${c.avg}`,
    `${base}{kind="max"} ${c.max}`,
    `${base}{kind="last"} ${c.max}`,
  ] : [];
  lines.push(...latLines('sfu_ai_asr_caption_latency_ms', capLat));
  lines.push(...latLines('sfu_ai_speech_latency_ms', speakLat));
  /* primaryReady：只有 true/false 才发这一行；undefined = 模拟**老服务器根本没有这行**。
   * ▎为什么要专门测这第三种：诊断如果把"读不到这行"当成 0（没就位），
   *   兜底告警在老服务器上就永远不响——"读不到"和"读到 0"是两件事。 */
  if (primaryReady !== undefined) lines.push(`sfu_ai_asr_primary_ready ${primaryReady ? 1 : 0}`);
  return lines.join('\n');
};
const run = (metrics, collab, prev, state) => diagnoseVoiceAndCollab(metrics, collab, prev, state);
const fresh = () => ({ counters: {}, fallbackRounds: 0, gapRounds: 0, capSlowRounds: 0, speakSlowRounds: 0, bootWaitRounds: 0 });
const has = (out, key) => out.some((a) => a.key === key);

console.log('\n--- watch：语音与协作退化诊断（纯函数，合成输入）---');

/* ① 正常路径：主引擎在干活，一条都不该报 */
{
  const st = fresh();
  const o1 = run(m({ 'qwen-local': 3 }), { asrEngine: 'qwen-local' }, st.counters, st);
  const o2 = run(m({ 'qwen-local': 6 }), { asrEngine: 'qwen-local' }, st.counters, st);
  ok(o1.length === 0 && o2.length === 0, '主引擎正常转写时一条告警都不发（含第二轮，基线要跟着走）');
}

/* ② 引擎退化：要连续两轮才报（启动预热期走兜底是正确行为，一有变化就报=天天误报） */
{
  const st = fresh();
  const o1 = run(m({ '常驻': 2 }), { asrEngine: 'qwen-local' }, st.counters, st);
  const o2 = run(m({ '常驻': 4 }), { asrEngine: 'qwen-local' }, st.counters, st);
  const o3 = run(m({ '常驻': 6 }), { asrEngine: 'qwen-local' }, st.counters, st);
  ok(!has(o1, 'asr-engine-fallback'), '第 1 轮兜底不报（预热期误报防线）');
  ok(has(o2, 'asr-engine-fallback'), '第 2 轮仍在兜底 → 报"主引擎退回"');
  ok(!has(o3, 'asr-engine-fallback'), '第 3 轮不重复刷同一条（只在恰好第 2 轮报）');
}

/* ②b ★ 2026-10-03 预热期 vs 真退化：本地 worker 冷启动要 ~55s，10s 一轮的 watch
 *     连两轮就落在这个窗口里 → 老判据每次开机都可能误报。现在按 primary_ready 分诊。 */
{
  const st = fresh();
  process.env.WATCH_ASR_BOOT_ROUNDS = '4';   // 把"耐心上限"调小，让这条判据可在几轮内测完（默认 12 轮≈2 分钟）
  const fb = m({ '常驻': 2 }, 0, 0, 0, null, false); // 兜底在干活 + 主引擎还没起来
  const round1 = run(fb, { asrEngine: 'qwen-local' }, st.counters, st);
  const round2 = run(m({ '常驻': 4 }, 0, 0, 0, null, false), { asrEngine: 'qwen-local' }, st.counters, st);
  ok(!has(round1, 'asr-engine-fallback') && !has(round2, 'asr-engine-fallback'),
    '主引擎未就绪期间的兜底 → 不报"退回"（预热是正确行为，报了就是天天误报）');
  const mid = run(m({ '常驻': 6 }, 0, 0, 0, null, false), { asrEngine: 'qwen-local' }, st.counters, st);
  ok(!has(mid, 'asr-engine-stuck'), '刚好第 3 轮仍算预热期（边界：报得太早等于没分诊）');
  const late = run(m({ '常驻': 8 }, 0, 0, 0, null, false), { asrEngine: 'qwen-local' }, st.counters, st);
  ok(has(late, 'asr-engine-stuck'), '超过耐心上限仍在兜底 → 改报"主引擎起不来"（这才是真故障）');
  ok(!has(late, 'asr-engine-fallback'), '同一条兜底不会两条告警都报（诊断口径必须唯一）');
  const recovered = run(m({ '常驻': 9, 'qwen-local': 1 }, 0, 0, 0, null, true), { asrEngine: 'qwen-local' }, st.counters, st);
  ok(has(recovered, 'asr-engine-ok'), '预热期结束后主引擎接手 → 也报一条恢复（值班要知道那条"起不来"过去了）');
  delete process.env.WATCH_ASR_BOOT_ROUNDS;
}
{
  const st = fresh();
  const o1 = run(m({ '常驻': 2 }, 0, 0, 0, null, true), { asrEngine: 'qwen-local' }, st.counters, st);
  const o2 = run(m({ '常驻': 4 }, 0, 0, 0, null, true), { asrEngine: 'qwen-local' }, st.counters, st);
  ok(!has(o1, 'asr-engine-fallback') && has(o2, 'asr-engine-fallback'),
    '主引擎**已就绪**却让兜底干活 → 仍按两轮判据报"退回"（分诊不能把真故障也放过）');
  const st3 = fresh();
  const noLine = run(m({ '常驻': 2 }, 0, 0, 0, null, undefined), { asrEngine: 'qwen-local' }, st3.counters, st3);
  const noLine2 = run(m({ '常驻': 4 }, 0, 0, 0, null, undefined), { asrEngine: 'qwen-local' }, st3.counters, st3);
  ok(!has(noLine, 'asr-engine-fallback') && has(noLine2, 'asr-engine-fallback'),
    '老服务器根本没有 primary_ready 这行 → 退回旧判据（"读不到"≠"读到 0"，否则告警永远不响）');
}

/* ③ 恢复：主引擎回来时要给一条"恢复了"，否则值班的人不知道前面那条已经过去了 */
{
  const st = fresh();
  run(m({ '常驻': 2 }), { asrEngine: 'qwen-local' }, st.counters, st);
  run(m({ '常驻': 4 }), { asrEngine: 'qwen-local' }, st.counters, st);
  const back = run(m({ '常驻': 5, 'qwen-local': 1 }), { asrEngine: 'qwen-local' }, st.counters, st);
  ok(has(back, 'asr-engine-ok'), '主引擎回到一线 → 报恢复');
}

/* ④ 白板归档被拒：客户端在送脏数据，一次就报（这条几乎不可能误报） */
{
  const st = fresh();
  const o1 = run(m({}, 3), { asrEngine: 'qwen-local' }, st.counters, st);
  const o2 = run(m({}, 3), { asrEngine: 'qwen-local' }, st.counters, st);
  ok(has(o1, 'board-rejected'), '归档被拒数上升 → 立刻报');
  ok(o2.length === 0, '计数没再涨就不重复报（基线是差值不是绝对值）');
}

/* ⑤ 房间动作"说了没做"：同样要连续两轮（回执是异步的，单轮可能只是还没到） */
{
  const st = fresh();
  const o1 = run(m({}, 0, 2, 0), { asrEngine: 'qwen-local' }, st.counters, st);
  const o2 = run(m({}, 0, 4, 0), { asrEngine: 'qwen-local' }, st.counters, st);
  ok(!has(o1, 'room-control-gap'), '第 1 轮没回执不报（异步容忍）');
  ok(has(o2, 'room-control-gap'), '连续两轮发出却零回执 → 报"AI 说了但没做"');
  const st2 = fresh();
  run(m({}, 0, 2, 2), { asrEngine: 'qwen-local' }, st2.counters, st2);
  const ok2 = run(m({}, 0, 4, 4), { asrEngine: 'qwen-local' }, st2.counters, st2);
  ok(!has(ok2, 'room-control-gap'), '发出=回执时不报（正常客户端都执行了）');
}

/* ⑥ ★ 2026-10-03 字幕端到端延迟退化：三条判据各钉一条，缺一条都会让告警失去价值 */
{
  const st = fresh();
  const slow = { n: 5, avg: 9000, max: 12000 };
  const o1 = run(m({ 'qwen-local': 1 }, 0, 0, 0, slow), { asrEngine: 'qwen-local' }, st.counters, st);
  ok(!has(o1, 'caption-slow'), '延迟超阈值第 1 轮不报（等第二轮确认，抖动不报警）');
  const o2 = run(m({ 'qwen-local': 2 }, 0, 0, 0, slow), { asrEngine: 'qwen-local' }, st.counters, st);
  ok(has(o2, 'caption-slow'), '连续两轮均值超 6s → 报字幕延迟退化');
  ok(/最慢 12\.0s/.test(o2.find((a) => a.key === 'caption-slow').text), '告警文案里带最慢值（值班要能一眼判断严重程度）');
  const back = run(m({ 'qwen-local': 3 }, 0, 0, 0, { n: 6, avg: 2000, max: 12000 }), { asrEngine: 'qwen-local' }, st.counters, st);
  ok(has(back, 'caption-ok'), '延迟回落 → 报恢复（否则值班不知道那条过去了）');
}
{
  /* 样本不足时**绝不**下结论：只有 1~2 句字幕的会议里，均值会被一句长句完全带跑（坑 53 同源） */
  const st = fresh();
  const o1 = run(m({}, 0, 0, 0, { n: 2, avg: 30000, max: 30000 }), { asrEngine: 'qwen-local' }, st.counters, st);
  const o2 = run(m({}, 0, 0, 0, { n: 2, avg: 30000, max: 30000 }), { asrEngine: 'qwen-local' }, st.counters, st);
  ok(!has(o1, 'caption-slow') && !has(o2, 'caption-slow'), '样本 <3 句时即使 avg 爆表也不报（统计噪声不是链路退化）');
}
{
  const st = fresh();
  const o1 = run(m({}, 0, 0, 0, { n: 20, avg: 2400, max: 5000 }), { asrEngine: 'qwen-local' }, st.counters, st);
  const o2 = run(m({}, 0, 0, 0, { n: 40, avg: 2400, max: 5000 }), { asrEngine: 'qwen-local' }, st.counters, st);
  ok(o1.length === 0 && o2.length === 0, '延迟在阈值内 → 一条不发（阈值不是拿来天天报的）');
  const none = run(m({}, 0, 0, 0, null), { asrEngine: 'qwen-local' }, st.counters, st);
  ok(none.length === 0, 'metrics 里没有延迟行（还没出过字幕）→ 不报错也不崩');
}

/* ⑦ ★ 2026-10-03 播报延迟（看到答案→听见开口）：与字幕同一条判据，
 *   但**必须单独钉一组**——两组共用一个函数时，只要 base 名写错一处，
 *   那条告警就永远不响，而另一组照常绿（坑 56 的指标版）。 */
{
  const st = fresh();
  const slow = { n: 4, avg: 15000, max: 22000 };   // 本地 Qwen3-TTS 在 CPU 上的典型量级
  const o1 = run(m({}, 0, 0, 0, null, undefined, slow), { asrEngine: 'qwen-local' }, st.counters, st);
  const o2 = run(m({}, 0, 0, 0, null, undefined, slow), { asrEngine: 'qwen-local' }, st.counters, st);
  ok(!has(o1, 'speech-slow'), '播报延迟超阈值第 1 轮不报（连续两轮判据对两组都生效）');
  ok(has(o2, 'speech-slow'), '连续两轮均值超 8s → 报播报延迟退化');
  ok(/Qwen3-TTS/.test(o2.find((a) => a.key === 'speech-slow').text),
    '播报告警文案要给出排查方向（慢引擎抢实时播报是最常见的一种）');
  const back = run(m({}, 0, 0, 0, null, undefined, { n: 5, avg: 1200, max: 22000 }), { asrEngine: 'qwen-local' }, st.counters, st);
  ok(has(back, 'speak-ok'), '播报恢复也报一条');
}
{
  /* 两组互不串台：字幕爆表不该报播报，反之亦然 */
  const st = fresh();
  const a1 = run(m({}, 0, 0, 0, { n: 9, avg: 30000, max: 40000 }, undefined, null), { asrEngine: 'qwen-local' }, st.counters, st);
  const a2 = run(m({}, 0, 0, 0, { n: 9, avg: 30000, max: 40000 }, undefined, null), { asrEngine: 'qwen-local' }, st.counters, st);
  ok(has(a2, 'caption-slow') && !has(a2, 'speech-slow'),
    '只有字幕超阈值时只报字幕（两组各判各的，不共用计数器也不共用读数）');
}

/* ⑧ 边界：metrics 拿不到 / collab 缺失都不能炸（值守脚本自己崩掉是最糟的结局） */
{
  const st = fresh();
  ok(run('', null, st.counters, st).length === 0, 'metrics 为空 → 返回空数组不抛错');
  ok(run(m({ 'qwen-local': 1 }), null, st.counters, st).length === 0, 'collab 缺失（老服务器）→ 不猜引擎、不报');
  ok(run(m({ 'qwen-local': 1 }), { asrEngine: 'none' }, st.counters, st).length === 0, '引擎=none → 不做引擎判定（没配就不该报）');
}

console.log(`\n结果: ${checks - issues}/${checks} 通过，${issues} 失败`);
process.exit(issues > 0 ? 1 : 0);
