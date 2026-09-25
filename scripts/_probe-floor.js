/* 临时探针：给"绝对分下限"定标（跑完即删）
 * 问题：开了单字兜底后，任何查询都能和某句话共用一个字 → "没提到"也会硬凑一条。
 * 要选一个绝对分阈值：真命中要过，噪声要拦。 */
const B = require('../sfu/ai/brain');
const CAPS = [
  { name: '张三', text: '先说结论：交付时间定在 11 月 20 日，这个日期不能再动了', ts: 1000 },
  { name: '李四', text: '好的我记下了', ts: 1100 },
  { name: '王五', text: '压测报告我负责，周五之前提交', ts: 1200 },
  { name: '张三', text: 'TURN 账号密码记得轮换，下周一之前完成', ts: 1300 },
  { name: '张三', text: '预算总盘子是 999 万，走 A 方案', ts: 1600 },
  { name: '李四', text: '这个模块的日志级别要不要调一下', ts: 1700 },
];
const r = new B.Retriever(CAPS);
const cases = [
  ['【该命中】交付时间是什么时候？', true],
  ['【该命中】啥时候交货？', true],
  ['【该命中】钱够吗？', true],
  ['【该命中】谁负责压测？', true],
  ['【该命中】预算多少', true],
  // 会议里完全没提过的话题
  ['【该落空】今天股市涨了多少？', false],
  ['【该落空】下周三的团建去哪吃？', false],
  ['【该落空】你叫什么名字？', false],
  ['【该落空】乌克兰局势怎么样？', false],
  ['【该落空】这道题的解法是什么？', false],
];
for (const [q, shouldHit] of cases) {
  const hits = r.search(q, 3);
  const top = hits.length ? hits[0] : null;
  const line = top ? `Top1=${top.score.toFixed(2)} [${top.text.slice(0, 20)}]  共${hits.length}条` : '无命中';
  const okMark = shouldHit ? (top ? '  ' : '❌') : (top ? '❌' : '  ');
  console.log(`${okMark} ${q}\n     ${line}`);
}
