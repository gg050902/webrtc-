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

const m = (segs, rejected = 0, issued = 0, applied = 0) => {
  const lines = [];
  for (const [eng, n] of Object.entries(segs)) lines.push(`sfu_ai_asr_segments_total{engine="${eng}"} ${n}`);
  lines.push(`sfu_board_records_total{op="rejected"} ${rejected}`);
  if (issued) lines.push(`sfu_room_control_total{action="board-open"} ${issued}`);
  if (applied) lines.push(`sfu_room_control_applied_total{action="board-open"} ${applied}`);
  return lines.join('\n');
};
const run = (metrics, collab, prev, state) => diagnoseVoiceAndCollab(metrics, collab, prev, state);
const fresh = () => ({ counters: {}, fallbackRounds: 0, gapRounds: 0 });
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

/* ⑥ 边界：metrics 拿不到 / collab 缺失都不能炸（值守脚本自己崩掉是最糟的结局） */
{
  const st = fresh();
  ok(run('', null, st.counters, st).length === 0, 'metrics 为空 → 返回空数组不抛错');
  ok(run(m({ 'qwen-local': 1 }), null, st.counters, st).length === 0, 'collab 缺失（老服务器）→ 不猜引擎、不报');
  ok(run(m({ 'qwen-local': 1 }), { asrEngine: 'none' }, st.counters, st).length === 0, '引擎=none → 不做引擎判定（没配就不该报）');
}

console.log(`\n结果: ${checks - issues}/${checks} 通过，${issues} 失败`);
process.exit(issues > 0 ? 1 : 0);
