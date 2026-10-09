/* scripts/bench-innerhtml.js —— 量"往真浏览器里塞多长的 HTML 字符串会开始卡"
 *
 * ▎为什么要这么一台量具：共享文件面板把 Office 的渲染结果整段塞进一个 div，
 *   而渲染内核给"一份文档的内嵌图片"设了两条上限。那个数**不该靠讨论定**——
 *   它对应的物理量就是"插这么多字符要多久"，能直接量（坑 75：别凭猜调优）。
 * ▎2026-10-08 本机实测（无头 Edge，同一页面反复整段替换 innerHTML）：
 *   0.5MB=3ms · 2MB=8ms · 8MB=31ms · 16MB=59ms · 24MB=87ms · 40MB=142ms
 *   ▸ 结论值得记下来，因为它**推翻了我自己写下的动机**：
 *     我看到一份真 PPT 渲染出 40.4MB HTML，就以为"面板一插入就冻住"；量完发现 40MB 也只要 142ms。
 *     字符串插入不是瓶颈，**内存与图片解码才是**。
 *     所以那两条上限是"体验保险丝"（防无界增长），不是"超过就卡死"的悬崖——
 *     注释与断言都按这个口径写，别把没量过的因果关系写进代码注释（坑 82：界面和注释都不许撒谎）。
 * ▸ 量法：同一个页面里反复 `host.innerHTML = 一段 N MB 的字符串`，测主线程耗时；
 *   造的 HTML 保持"真实形状"（大量 <img src=data:> + 少量文字），不是一整块无标签文本。
 * ▸ 跑法：npm run bench:innerhtml   （无头，一台浏览器，不占 3001 也不需要服务器） */
const path = require('path');
const { Cdp } = require(path.join(__dirname, '..', 'agent', 'cdp.js'));   // 导出的名字是 { Cdp }，不是裸构造器——上一版探针就因为猜错导出直接抛错

const PORTS = Number(process.env.WB_CDP_PORT) || 9399;

(async () => {
  const cdp = new Cdp({ headless: true, port: PORTS, startUrl: 'about:blank' });
  await cdp.launch();
  await cdp.waitForLoad(15000);
  const MB = 1024 * 1024;
  const rows = [];
  for (const size of [0.5, 2, 8, 16, 24, 40]) {
    const r = await cdp.evaluate(`(() => {
      const MB = 1024*1024;
      const target = ${size} * MB;
      /* 造"真实形状"的 HTML：大量 <img src="data:..."> + 少量文字，
       * 与内核实际产出的结构一致（不是一整块无标签的文本） */
      const payload = 'A'.repeat(4096);
      let s = '<div>';
      while (s.length < target) s += '<p>第 ' + (s.length / 4096 | 0) + ' 段：这里是一行普通中文。</p><img src="data:image/png;base64,' + payload + '">';
      s += '</div>';
      const host = document.createElement('div');
      document.body.appendChild(host);
      const t0 = performance.now();
      host.innerHTML = s;
      const t1 = performance.now();
      /* 再量一次"替换插入"（用户换文件时走的就是这条路） */
      const t2 = performance.now();
      host.innerHTML = s.slice(0, Math.floor(s.length / 2));
      const t3 = performance.now();
      const bytes = s.length;
      host.remove();
      return { bytes: bytes / MB, first: t1 - t0, replace: t3 - t2, imgs: document.images.length };
    })()`);
    rows.push(r);
    console.log(`  HTML=${r.bytes.toFixed(1)}MB  首次插入=${r.first.toFixed(0)}ms  替换插入=${r.replace.toFixed(0)}ms`);
  }
  const slow = rows.find((r) => r.first > 2000);
  console.log(`\n参考：首次插入超过 2 秒的最小尺寸 = ${slow ? slow.bytes.toFixed(1) + 'MB' : '本次都没超过 2s'}`);
  console.log('（内存里图片解码的代价没算进来——那是另一笔账，这里只量字符串插入）');
  await cdp.kill();      // 这个客户端的收工方法是 kill()（没有 close()）：上一版探针在收尾处抛错，六档数据白跑
  process.exit(0);
})().catch((e) => { console.error('量具失败：', e.message); process.exit(1); });
