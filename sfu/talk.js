'use strict';
/* ══════════════════════════════════════════════════════════════════════════
 * sfu/talk.js —— 发言时长 → 发言占比的**唯一一处算法**（纯函数，零依赖）
 *
 * ▎为什么单独一个文件（而不是留在 server.js 的定时器里）：
 *   这段逻辑出错的方式很特殊——它不会崩、不会报错，只会让界面上那根细条**看起来数字不对**。
 *   2026-10-10 的"只有正向没有反向"审计就是在查这类账：`room.talk`（socketId → 累计秒数）
 *   只有 `set` 没有 `delete`，而分母又是 `[...room.talk.values()]` 全加起来 ⇒
 *   **一个人掉线重连三次，分母里就留着三份他过去说过的秒数**，
 *   于是还在场的每个人的占比条都被永久稀释（而这块条正是"谁主导了这场会"那一格）。
 *   把算法抽出来才谈得上穷举断言（同 `rdDecideFps` / `nets.js` 那条纪律：
 *   判断类逻辑恰恰最需要确定性）。
 *
 * ▎两条口径，缺一不可：
 *   ① **分母只算"还在场的人"**：新旧 socketId 交替的那一瞬间（D6 重连）也不会算错；
 *   ② 服务器另外在 disconnect 里把离开者的账删掉（`room.talk.delete`），
 *      否则这张表会无界增长——①管"报数对不对"，②管"内存涨不涨"，两件事别混成一个修法。
 *
 * ▎纯函数不改入参：它只读 `talkMap`，不清理、不删除。
 *   顺手 clear 会把"这个人不在了"与"这个人说了多久"两件事搅在一起（坑 47/52 同族）。
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * @param {Map<string,number>} talkMap  socketId -> 累计发言秒数（AudioLevelObserver 顺手记的账）
 * @param {Iterable<string>}   memberIds **此刻还在场**的成员 id
 * @returns {Array<{id:string, sec:number, share:number}>} 按占比从大到小；share 是 0~100 的整数
 */
function talkShares(talkMap, memberIds) {
  const ids = [...(memberIds || [])];
  const secOf = (id) => {
    const v = talkMap && typeof talkMap.get === 'function' ? Number(talkMap.get(id)) : NaN;
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  const rows = ids.map((id) => ({ id, sec: Math.round(secOf(id)), share: 0 }));
  /* 分母只加在场的人——这一行就是那个 bug 的全部（写成 `talkMap.values()` 就会被幽灵稀释） */
  const total = ids.reduce((a, id) => a + secOf(id), 0);
  for (const r of rows) r.share = total > 0 ? Math.round((r.sec / total) * 100) : 0;
  return rows.sort((a, b) => b.share - a.share || (a.id < b.id ? -1 : 1));
}

module.exports = { talkShares };
