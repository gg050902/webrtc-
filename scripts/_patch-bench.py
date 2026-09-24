# -*- coding: utf-8 -*-
# bench.js 加 --fans K(每路 K 个收流端,扇出维度)。用精确锚点,不整文件 split。
import io
p = 'scripts/bench.js'
s = io.open(p, encoding='utf-8').read()
BS = chr(92)
NL = BS + 'n'   # 源码里反斜杠+n 两字符(转义序列)

def rep(old, new, tag):
    global s
    assert old in s, tag
    s = s.replace(old, new, 1)

# 1) 参数
rep("return { producers: get('--producers', 4), duration: get('--duration', 12) };",
    "return { producers: get('--producers', 4), duration: get('--duration', 12), fans: Math.max(1, get('--fans', 1)) };",
    'args')

# 2) 签名与标题(标题行源码里模板字符串首字符是转义序列 \n)
rep('async function runOneLevel(nProducers, durationSec, ffmpegBin) {',
    'async function runOneLevel(nProducers, durationSec, ffmpegBin, fans = 1) {', 'sig')
rep('console.log(`' + NL + '\u2550\u2550\u2550\u2550 \u538b\u6d4b\u6863\u4f4d\uff1a${nProducers} \u8def\u63a8\u6d41 \u00d7 ${nProducers} \u8def\u6536\u6d41\uff0c\u65f6\u957f ${durationSec}s \u2550\u2550\u2550\u2550`);',
    'console.log(`' + NL + '\u2550\u2550\u2550\u2550 \u538b\u6d4b\u6863\u4f4d\uff1a${nProducers} \u8def\u63a8\u6d41 \u00d7 ${nProducers * fans} \u8def\u6536\u6d41\uff08\u6247\u51fa \u00d7${fans}\uff09\uff0c\u65f6\u957f ${durationSec}s \u2550\u2550\u2550\u2550`);', 'title')

# 3) 收流循环 ×fans
LF = chr(10)
old3 = LF.join([
"  // N 路收流（每路一个 consumer，转发到 sink）",
"  for (const producer of producers) {",
"    const t = await router.createPlainTransport({",
"      listenIp: { ip: '127.0.0.1' }, rtcpMux: true, comedia: false,",
"    });",
"    await t.connect({ ip: '127.0.0.1', port: sinkPort });",
"    const c = await t.consume({ producerId: producer.id, rtpCapabilities: router.rtpCapabilities });",
"    await c.resume();",
"  }"])
new3 = LF.join([
"  // 收流：每路 Producer × fans 个 Consumer（G8-① 扇出维度：N 发 × N×K 收）",
"  for (const producer of producers) {",
"    for (let k = 0; k < fans; k++) {",
"      const t = await router.createPlainTransport({",
"        listenIp: { ip: '127.0.0.1' }, rtcpMux: true, comedia: false,",
"      });",
"      await t.connect({ ip: '127.0.0.1', port: sinkPort });",
"      const c = await t.consume({ producerId: producer.id, rtpCapabilities: router.rtpCapabilities });",
"      await c.resume();",
"    }",
"  }"])
rep(old3, new3, 'consume')

# 4) 结果行
rep('console.log(`' + NL + "  \u258e${nProducers} \u8def\u7ed3\u679c\uff1a`);",
    'console.log(`' + NL + "  \u258e${nProducers} \u53d1 \u00d7 ${nProducers * fans} \u6536\u7ed3\u679c\uff1a`);", 'result1')
rep("console.log(`    | ${nProducers} | ${nProducers} |",
    "console.log(`    | ${nProducers} | ${nProducers * fans} |", 'result2')
rep("  return { n: nProducers, avgKbps,", "  return { n: nProducers, fans, avgKbps,", 'ret')

# 5) 调用点
rep("  const { producers, duration } = parseArgs();",
    "  const { producers, duration, fans } = parseArgs();", 'call1')
rep("await runOneLevel(producers, duration, ffmpegBin);",
    "await runOneLevel(producers, duration, ffmpegBin, fans);", 'call2')
rep("const r = await runOneLevel(n, duration, ffmpegBin);",
    "const r = await runOneLevel(n, duration, ffmpegBin, fans);", 'call3')
rep("console.log(`| ${r.n} | ${r.n} |", "console.log(`| ${r.n} | ${r.n * r.fans} |", 'call4')

io.open(p, 'w', encoding='utf-8', newline=chr(10)).write(s)
print('FANS-OK')
