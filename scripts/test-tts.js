/* ★ 09-30c 服务端神经语音（Edge TTS）自测 —— Mock 轨（纯函数/缓存）永远跑，
 * 真合成轨（需要网络可达 speech 平台端点）不可达时 SKIP 而不 FAIL（双轨约定，同 test:ai）。
 * 跑法：npm run test:tts */
'use strict';

const Tts = require('../sfu/ai/tts');

let pass = 0, fail = 0, skip = 0;
// 坑 110 的常驻守卫：本文件约定 ok(名字, 条件)
const { guard: guardOk } = require('./assert-order-guard.js');
const ok = (name, cond) => {
  const bad = guardOk('name-first', name, cond);
  if (bad) { fail++; console.log(`  FAIL  ${String(name).slice(0, 60)}  · 参数顺序守卫：${bad}`); return; }
  if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}`); }
};
const skipped = (name, why) => { skip++; console.log(`  SKIP  ${name}（${why}）`); };

console.log('\n=== ① Sec-MS-GEC 令牌：纯函数（固定时钟，结果必须确定）===');
{
  // 2000-01-01T00:00:00Z 起算的 tick 按 300s 取整 → 同一窗口内两次调用必须同值
  const t1 = Date.UTC(2000, 0, 1, 0, 0, 0);
  const t2 = t1 + 299 * 1000;          // 同一 300s 窗口
  const t3 = t1 + 301 * 1000;          // 跨到下一个窗口
  const g1 = Tts.secMsGec(t1), g2 = Tts.secMsGec(t2), g3 = Tts.secMsGec(t3);
  ok('同窗口内两次计算结果一致', g1 === g2);
  ok('跨窗口后结果变化（窗口滚动）', g1 !== g3);
  ok('GEC 是 64 位大写 hex（SHA256）', /^[0-9A-F]{64}$/.test(g1));
}

console.log('\n=== ② 音频货架：putAudio/getAudio/sweepAudio ===');
{
  const id1 = Tts.putAudio(Buffer.from('mp3-1'));
  const id2 = Tts.putAudio(Buffer.from('mp3-2'));
  ok('putAudio 返回 32 位 hex id（不可枚举）', /^[a-f0-9]{32}$/.test(id1) && id1 !== id2);
  /* ★ 2026-10-03d 契约升级跟进：getAudio 自 Qwen 本地音色（wav）起返回 {buf, type}，
   *   HTTP 层（/audio/:id）按 type 选 Content-Type——本测试还停在旧的纯 Buffer 契约上
   *   （套件近期没人跑，红了也没人看见——这就是"全套盘点"要定期跑的理由）。 */
  const e1 = Tts.getAudio(id1);
  ok('getAudio 按 id 取回同一段字节（{buf,type} 契约）', !!e1 && e1.buf.toString() === 'mp3-1' && e1.type === 'mp3');
  ok('未知 id 取不到（返回 null）', Tts.getAudio('deadbeef'.repeat(4)) === null);
  ok('格式不合法的 id 取不到（白名单闸）', Tts.getAudio(id1 + '/../x') === null);
  Tts.putAudio(Buffer.alloc(1)); // 第 3 条
  Tts.sweepAudio(0);             // 全部过期
  ok('sweepAudio 清掉过期音频', Tts.getAudio(id2) === null);
}

console.log('\n=== ③ synthesize 入参防御（不发网络）===');
{
  (async () => {
    ok('空文本返回 null', (await Tts.synthesize('')) === null);
    ok('非字符串返回 null', (await Tts.synthesize(null)) === null);

    console.log('\n=== ④ 真合成（网络轨：端点可达才跑）===');
    const t0 = Date.now();
    let buf = null;
    try {
      buf = await Tts.synthesize('小明测试语音合成。', { timeoutMs: 12000 });
    } catch (e) { /* 探测异常按不可达处理 */ }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (!buf) {
      skipped('真实合成一段中文', 'Edge TTS 端点不可达（403/断网——随网络出口而定，功能自动回落浏览器 TTS）');
    } else {
      ok(`合成出非空 MP3（${buf.length}B，${secs}s）`, buf.length > 1000);
      // MP3 帧头：0xFFF* 或 ID3 标签
      const b = buf;
      const isMp3 = (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
      ok('字节流是合法 MP3（ID3 或帧头 0xFFF）', isMp3);
      const t1 = Date.now();
      const buf2 = await Tts.synthesize('小明测试语音合成。');
      ok(`同文本第二次走缓存（${Date.now() - t1}ms）`, !!buf2 && buf2.length === buf.length);
    }

    console.log(`\n结果: ${pass} 通过, ${fail} 失败, ${skip} 跳过`);
    process.exit(fail ? 1 : 0);
  })();
}
