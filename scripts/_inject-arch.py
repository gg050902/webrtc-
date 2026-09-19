# -*- coding: utf-8 -*-
# 注入:内存上限 + 日志折叠(09-19d 架构优化)
import io
p = 'sfu/public/client.js'
s = io.open(p, encoding='utf-8').read()
NL = chr(92) + 'n'
L = chr(10)

# 1) log() 行数上限
old1 = (
    'function log(msg) {' + L +
    '  const time = new Date().toLocaleTimeString();' + L +
    '  logPanel.textContent += `[${time}] ${msg}' + NL + '`;' + L +
    '  logPanel.scrollTop = logPanel.scrollHeight;' + L +
    '}')
new1 = (
    '/* \u2605 09-19d \u67b6\u6784\u4f18\u5316\uff1a\u65e5\u5fd7\u73af\u5f62\u4e0a\u9650\uff08400 \u884c\uff09\u2014\u2014\u8fc7\u591c\u503c\u5b88\u4e00\u665a\u80fd\u4ea7\u751f\u51e0\u4e07\u884c\u65e5\u5fd7\uff0c' + L +
    ' *   textContent \u65e0\u9650\u589e\u957f\u4f1a\u8ba9\u9875\u9762\u8d8a\u8dd1\u8d8a\u5361\uff08\u6bcf\u6b21 += \u90fd\u6574\u4e32\u91cd\u5efa\uff09\u3002' + L +
    ' *   \u73af\u5f62\u526a\u6389\u65e7\u884c\u540e scrollTop \u4ecd\u8d34\u5e95\uff1b\u526a\u5269\u7684\u5c0f\u5b57\u7b26\u4e32\u66ff\u6362\u5f00\u9500\u53ef\u5ffd\u7565\u3002 */' + L +
    'const LOG_MAX_LINES = 400;' + L +
    'function log(msg) {' + L +
    '  const time = new Date().toLocaleTimeString();' + L +
    '  logPanel.textContent += `[${time}] ${msg}' + NL + '`;' + L +
    '  const lines = logPanel.textContent.split(' + "'" + NL + "'" + ');' + L +
    '  if (lines.length > LOG_MAX_LINES) logPanel.textContent = lines.slice(-LOG_MAX_LINES).join(' + "'" + NL + "'" + ');' + L +
    '  logPanel.scrollTop = logPanel.scrollHeight;' + L +
    '}')
assert old1 in s, 'log anchor'
s = s.replace(old1, new1, 1)

# 2) appendChat DOM 上限
old2 = (
    '  chatList.appendChild(item);' + L +
    '  chatList.scrollTop = chatList.scrollHeight;' + L +
    '}')
new2 = (
    '  chatList.appendChild(item);' + L +
    '  // \u2605 09-19d \u67b6\u6784\u4f18\u5316\uff1a\u804a\u5929 DOM \u73af\u5f62\u4e0a\u9650\uff08300 \u6761\uff09\u2014\u2014SCTP \u5e7f\u64ad\u8bed\u4e49\u4e0b\u957f\u4f1a\u6d88\u606f\u4e0d\u5c11\uff0c' + L +
    '  //   DOM \u8282\u70b9\u6570\u662f\u524d\u7aef\u5185\u5b58\u4e0e\u91cd\u6392\u5f00\u9500\u7684\u5927\u5934\uff1b\u8d85\u9650\u526a\u6700\u8001\u7684\uff08\u5b57\u5e55\u8d26\u672c\u53e6\u6709 jsonl \u5b58\u6863\uff09\u3002' + L +
    '  while (chatList.children.length > 300) chatList.firstChild.remove();' + L +
    '  chatList.scrollTop = chatList.scrollHeight;' + L +
    '}')
assert old2 in s, 'appendChat anchor'
s = s.replace(old2, new2, 1)

# 3) logTitle DOM 引用
old3 = "const logPanel = $('log');"
assert old3 in s, 'logPanel anchor'
s = s.replace(old3, old3 + L + "const logTitle = $('logTitle');   // \u2605 09-19d\uff1a\u65e5\u5fd7\u9762\u677f\u6298\u53e0\u5f00\u5173", 1)

# 4) 折叠接线(挂 startLocalMedia() 之前)
old4 = 'startLocalMedia();'
assert old4 in s, 'tail anchor'
new4 = (
    '// \u2605 09-19d \u8212\u9002\u6027\uff1a\u65e5\u5fd7\u9762\u677f\u53ef\u6298\u53e0\u2014\u2014\u6559\u5b66\u65f6\u5c55\u5f00\uff0c\u6f14\u793a/\u5f00\u4f1a\u65f6\u6536\u8d77\u7ed9\u753b\u9762\u8ba9\u4f4d' + L +
    'logTitle.addEventListener(' + "'" + 'click' + "'" + ', () => {' + L +
    '  const collapsed = logPanel.classList.toggle(' + "'" + 'collapsed' + "'" + ');' + L +
    "  document.querySelector('.app').classList.toggle('log-collapsed', collapsed);" + L +
    '});' + L +
    L +
    'startLocalMedia();')
s = s.replace(old4, new4, 1)

io.open(p, 'w', encoding='utf-8', newline=L).write(s)
print('ARCH-OK')
