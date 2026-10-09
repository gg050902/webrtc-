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
/* 坑 110 的常驻守卫：**这个文件的约定是 ok(条件, 名字)**，与 test-asr / test-sfu-signaling
 *   那两个文件（ok(名字, 条件)）**正好相反**——而我自己照"顺手的那个"复制过一次，
 *   结果 9 条断言全绿而一条都没测（条件位上永远是一句中文，truthy）。
 *   这里不重构签名（那要动几十条历史断言），只做一件事：**顺序写反就当场红**。 */
const { guard: guardOk } = require('./assert-order-guard.js');
function ok(cond, msg) {
  const bad = guardOk('cond-first', cond, msg);
  if (bad) { checks++; issues++; console.log(`  ❌ FAIL  ${String(msg).slice(0, 60)}  · 参数顺序守卫：${bad}`); return; }
  checks++;
  if (cond) console.log(`  PASS  ${msg}`);
  else { issues++; console.log(`  ❌ FAIL  ${msg}`); }
}

const m = (segs, rejected = 0, issued = 0, applied = 0, capLat = null, primaryReady = undefined, speakLat = null, restarts = null) => {
  const lines = [];
  for (const [eng, n] of Object.entries(segs)) lines.push(`sfu_ai_asr_segments_total{engine="${eng}"} ${n}`);
  lines.push(`sfu_board_records_total{op="rejected"} ${rejected}`);
  /* ★ 2026-10-05 与 server 的 /metrics 保持同名同形（这条文件的老规矩：
   *   任何一处改了另一边没跟上，测试就会"绿着什么都不验"）。 */
  if (restarts !== null) lines.push(`sfu_ai_asr_worker_restarts_total ${restarts}`);
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

/* ④b 本地 Qwen ASR worker 因"单次推理超预算"被换过进程（坑 89 的自愈路径）。
 *   ▎为什么单独钉四组：这条告警存在的**全部理由**是"那条重启路径至今没被真实触发过"
 *     （坑 76：没有触发证据就不能声称已验证）。所以既要能报，更要**在没发生时闭嘴**——
 *     一条会误报的告警等于没有告警，只会训练值班的人忽略它。 */
{
  const st = fresh();
  const o1 = run(m({}, 0, 0, 0, null, undefined, null, 1), { asrEngine: 'qwen-local' }, st.counters, st);
  ok(has(o1, 'asr-worker-restart'), '重启计数 0→1 → 报一条（模型真卡过，自愈接住了、字幕没丢）');
  const o2 = run(m({}, 0, 0, 0, null, undefined, null, 1), { asrEngine: 'qwen-local' }, st.counters, st);
  ok(o2.length === 0, '同一批重启不重复报（差值口径，不是绝对值）');
  const st3 = fresh();
  const o3 = run(m({}, 0, 0, 0, null, undefined, null, 0), { asrEngine: 'qwen-local' }, st3.counters, st3);
  ok(!has(o3, 'asr-worker-restart'), '计数一直是 0 → 不报（这正是"自愈还没被用到"的诚实状态）');
  const st4 = fresh();
  const o4 = run(m({}, 0), { asrEngine: 'qwen-local' }, st4.counters, st4);
  ok(!has(o4, 'asr-worker-restart'), '老服务器根本没有这一行 → 不报也不炸（读不到 ≠ 读到 0，坑 71）');
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

/* ⑨ ★ 2026-10-06 夜二「没人叫它，它却开口了」——这条产品规矩的生产端哨兵。
 *   ▎判据不是"有 follow-up 就报"：合法形态（被 2s 分段切断的半句）每次前面必有一次
 *     name-only，所以违规量 = tail − nameOnly；而且只在**纯唤醒模式**下判。
 *     一条"看见 X 就报"的规则会把用户自己选的对话模式报成故障，误报到第三次就没人看告警了。 */
{
  const via = (wake, tail, nameOnly) => m({ 'qwen-local': 1 }) + '\n' + [
    `sfu_ai_answer_via_total{via="wake"} ${wake}`,
    `sfu_ai_answer_via_total{via="follow-up"} ${tail}`,
    `sfu_ai_answer_throttled_total{reason="name-only"} ${nameOnly}`,
  ].join('\n');
  const PURE = { asrEngine: 'qwen-local', aiChatWindowMs: 0 };

  const st1 = fresh();
  const o1 = run(via(2, 5, 0), PURE, st1.counters, st1);
  ok(has(o1, 'ai-unprompted'), '纯唤醒模式下 5 次免唤醒续答、0 次只叫名字 → 报 ai-unprompted',
    JSON.stringify(o1.map((x) => x.key)));
  ok(/aiChatWindowSec/.test((o1[0] || {}).text || '') && /唤醒表/.test((o1[0] || {}).text || ''),
    '告警文案要指路（把三条回归源列出来，而不是只喊一句"有问题"）');

  const st2 = fresh();
  const o2 = run(via(3, 1, 1), PURE, st2.counters, st2);
  ok(o2.length === 0, '合法形态不报：分段半句的续答（tail 1）恰好对应一次只叫名字的唤醒（name-only 1）',
    JSON.stringify(o2.map((x) => x.key)));

  const st3 = fresh();
  const o3 = run(via(3, 9, 0), { asrEngine: 'qwen-local', aiChatWindowMs: 20000 }, st3.counters, st3);
  ok(o3.length === 0 && st3.unprompted === 0,
    '用户自己开了对话模式（aiChatWindowMs>0）时**整体沉默**——那是他选的形态不是故障',
    JSON.stringify({ keys: o3.map((x) => x.key), acc: st3.unprompted }));

  const st4 = fresh();
  const o4 = run(m({ 'qwen-local': 2 }), { asrEngine: 'qwen-local', aiChatWindowMs: 0 }, st4.counters, st4);
  ok(o4.length === 0 && st4.unprompted === undefined,
    '老服务器根本没有这几行 → 不报也不猜（"读不到" ≠ "读到 0"，坑 71/74 同一条纪律）',
    JSON.stringify(o4.map((x) => x.key)));

  /* HELP 行陷阱：Prometheus 的帮助文本里就含 `via="wake"` 这个字面量，
     正则不锚行首会把文档读成一个样本值——这个坑本项目踩过一次（坑 74），这里钉住。 */
  const st5 = fresh();
  const o5 = run(m({ 'qwen-local': 2 }) + '\n# HELP sfu_ai_answer_via_total counter Replies grouped by trigger: via="wake" (name called) / via="follow-up" x 99',
    PURE, st5.counters, st5);
  ok(o5.length === 0, '# HELP 行里含 via="wake" 与数字，也不能被当成样本（正则锚行首）',
    JSON.stringify(o5.map((x) => x.key)));

  /* 累计口径：单轮超出 1 次先记账不报，第二轮再超才报（避免一次同音误听就打断人） */
  const st6 = fresh();
  const r1 = run(via(1, 1, 0), PURE, st6.counters, st6);
  const r2 = run(via(1, 2, 0), PURE, st6.counters, st6);
  ok(!has(r1, 'ai-unprompted') && has(r2, 'ai-unprompted'),
    '超出量按轮累计：1 次不报、累计到 2 次才报（误报的代价是以后没人看告警）',
    JSON.stringify({ r1: r1.map((x) => x.key), r2: r2.map((x) => x.key) }));
}

/* === ★ 2026-10-07 H6：跨网能力退化要能**常驻喊人**（判据在服务器，值守只读结论）===
 *   ▎为什么要这一组：`nets.diagnose()` 的结论以前只出现在两个地方——启动日志（滚过去就没了）
 *     与邀请面板（得有人正好点开）。而跨网失效的方式恰好是**沉默**的：服务器自己一切正常、
 *     网页也打得开，只有"外面的人"进不来，而他是唯一会来报告的人（坑 36 的形态）。
 *   ▎三条纪律各有一条断言：①只在"变差"时报 ②第一观测不下结论 ③恢复要说出来。
 *     少了 ① 就是天天误报（家里/办公室内网部署本来就该是 lan-only），
 *     少了 ② 就是每次值班启动都叫一次——两者都是"以后没人看告警"的前奏。
 *   ▸ ★ 写这一组时我自己踩了**坑 110**：本文件的助手是 `ok(条件, 名字)`，
 *     而 test-asr / test-sfu-signaling 是 `ok(名字, 条件)`。我照熟的那个顺序粘过来，
 *     于是 9 条断言的**条件位上全是那句中文说明（truthy）** ⇒ 9 条全绿而一条都没测。
 *     露馅的方式正是那条坑写的：输出里名字变成了 `PASS true`。逐条换序后重跑才算数。 */
const { diagnoseNetAccess, NET_RANK } = require('./watch.js');
console.log('\n=== H6 跨网退化告警（只在变差时报 / 首轮不下结论 / 恢复要说话）===');
{
  const nc = (level, extra) => ({
    level, headline: ` headline:${level}`,
    items: [{ state: 'bad', label: '媒体地址', detail: '只在局域网可达', fix: 'npm run start:lan' },
      ...(extra || [])],
    canCrossNetNow: level === 'public' || level === 'tailscale',
  });

  ok(NET_RANK['localhost-only'] < NET_RANK['lan-only']
    && NET_RANK['lan-only'] < NET_RANK['tailscale'] && NET_RANK['tailscale'] < NET_RANK['public'],
    '秩的方向：localhost-only < lan-only < tailscale < public（写反会让"变好"报警、"变差"沉默）');

  const s0 = { level: null };
  const a0 = diagnoseNetAccess(nc('lan-only'), s0, 1);
  ok(a0.length === 0 && s0.level === 'lan-only',
    '② 第一观测**不报**（每次值班启动都叫一次 = 噪音），但要把这一轮记进账', `记账后 level=${s0.level}`);

  const a1 = diagnoseNetAccess(nc('localhost-only'), s0, 2);
  ok(a1.length === 1 && a1[0].key === 'net-downgrade'
    && /lan-only → localhost-only/.test(a1[0].text) && /npm run start:lan/.test(a1[0].text),
    '① 变差才报：lan-only → localhost-only 报一条，且带上不合格项与可复制的建议',
    a1.map((x) => x.key).join(','));

  const before = s0.level;
  const a2 = diagnoseNetAccess(nc('public'), s0, 3);
  ok(a2.length === 0 && before === 'localhost-only' && s0.level === 'public',
    '③ 恢复不算告警（只在控制台说一句），但记账必须跟着变', `before=${before} now=${s0.level}`);

  const s1 = { level: null };
  diagnoseNetAccess(nc('tailscale'), s1, 1);
  const repeats = [0, 1, 2, 3, 4].reduce((n, i) => n + diagnoseNetAccess(nc('tailscale'), s1, 2 + i).length, 0);
  ok(repeats === 0, '形态没变就**永不重复报**（同一天一直 lan-only，不该每次值班都喊一次）', `五轮累计报了 ${repeats} 条`);

  ok(diagnoseNetAccess(null, { level: null }, 1).length === 0
    && diagnoseNetAccess(undefined, { level: null }, 1).length === 0
    && diagnoseNetAccess({ level: '火星-only' }, { level: null }, 1).length === 0,
    '老服务器 / 读不到 config.json / 认不出的 level：不下结论也不抛错（"读不到"≠"坏了"，坑 71）');

  const s2 = { level: null };
  diagnoseNetAccess(nc('public'), s2, 1);
  diagnoseNetAccess(null, s2, 2);
  ok(s2.level === 'public',
    '读不到时**不许把上一轮记账冲掉**（否则恢复过后再降级会被当成"第一观测"而永久沉默）', `now=${s2.level}`);

  /* 配置漂移单独一条：自愈把 level 保住了，但用户的配置文件仍然是错的（下次换网卡就要黑屏）。 */
  const s3 = { level: null };
  diagnoseNetAccess(nc('lan-only'), s3, 1);
  const a3 = diagnoseNetAccess(nc('lan-only', [
    { state: 'bad', label: '配置核对', detail: '写的 192.168.1.9 已不是本机任何网卡的地址', fix: 'npm run start:lan' },
  ]), s3, 2);
  ok(a3.length === 1 && a3[0].key === 'net-config-drift' && /自愈/.test(a3[0].text),
    '配置漂移单独报：level 没变也要说（自愈只保这次运行，不等于配置是对的）',
    a3.map((x) => x.key).join(','));

  /* ★ 接线（坑 41/56：纯函数全绿 ≠ 调用方接上了）。这一组扫的是 watch.js 自己的源码：
     · tick() 里真的 fetch 了 /config.json（不接就永远不会报，而 51 条断言依然全绿）；
     · 返回值真的进了 alert()（算出来却丢掉 = 白算）；
     · 跨轮状态用的是**同一个对象**（每轮新建 `{level:null}` 会让"第一观测不报"永远成立 ⇒ 告警永不响）。 */
  const src = require('fs').readFileSync(require('path').join(__dirname, 'watch.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');   // 注释里的例子不算"写了"（坑 76）
  ok(/diagnoseNetAccess\(/.test(src) && /config\.json/.test(src),
    '接线：tick() 真的读 /config.json 并把结论交给 diagnoseNetAccess（纯函数绿不代表接上了）');
  ok(/for \(const a of diagnoseNetAccess\([^)]*\)[^)]*\)[\s\S]{0,80}alert\(a\.key, a\.text\)/.test(src),
    '接线：返回的每条告警真的进了 alert()（算出来丢掉 = 这条告警永远不响）');
  ok(/diagnoseNetAccess\([^,]+,\s*netState\b/.test(src),
    '接线：跨轮传的是模块级 netState，不是每轮新建的对象（新建 ⇒ 永远"第一观测" ⇒ 永不报）');
}

console.log(`\n结果: ${checks - issues}/${checks} 通过，${issues} 失败`);
process.exit(issues > 0 ? 1 : 0);
