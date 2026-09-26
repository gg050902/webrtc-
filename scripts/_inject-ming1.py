# -*- coding: utf-8 -*-
# 注入:AI 助理深化(矢量动画头像 v2/逐字发言字幕/唤醒词"小明")
import io
p = 'sfu/public/client.js'
s = io.open(p, encoding='utf-8').read()
L = chr(10)
BS = chr(92)

def rep(old, new, tag='auto'):  # tag 缺省:该脚本只有一个 rep 调用
    global s
    assert old in s, tag
    s = s.replace(old, new, 1)

# ── 1) 常量区:唤醒词 + 矢量 SVG 生成器(替换 aiStateUrl 静态图思路) ──
rep("let myAvatar = null; // 我的预设头像 key（登录/恢复后带回）",
    ("let myAvatar = null; // 我的预设头像 key（登录/恢复后带回）" + L +
     L +
     "/* \u2605 09-26b \u5524\u9192\u8bcd\uff1a\u5f00\u4f1a\u65f6\u5546\u91cf\u63d0\u5230\u300c\u5c0f\u660e\u300d\uff0c\u5b83\u5c31\u63a5\u8bdd\u2014\u2014" + L +
     " *   \u5b57\u5e55\u6210\u7a3f\uff08emitCaption\uff09\u91cc\u68c0\u6d4b\u5230\u540d\u5b57 + AI \u5728\u573a \u2192 \u81ea\u52a8\u628a\u6574\u53e5\u8bdd\u4f5c\u4e3a\u63d0\u95ee\u53d1\u7ed9 ai-ask\u3002" + L +
     " *   \u6539\u540d\u5b57\u53ea\u9700\u6539\u8fd9\u91cc\uff08+server \u7684 bot \u663e\u793a\u540d\uff09\u3002 */" + L +
     "const AI_NICKNAME = '\u5c0f\u660e';" + L +
     L +
     "/* \u2605 09-26b \u77e2\u91cf\u52a8\u753b\u5934\u50cf v2\uff08\u7d20\u6750\uff1aapple-avatar/gufeng/handdraw \u4e2b\u9ae5\u7ae5\u5b50\uff09\u2014\u2014" + L +
     " *   \u9759\u6001 PNG \u5207\u6362\u592a\u50f5\u786c\uff0c\u6362\u6210\u5185\u8054 SVG\uff1a\u547c\u5438\u6d6e\u52a8/\u7728\u773c/\u6447\u5934\u7531 CSS \u5173\u952e\u5e27\u9a71\u52a8\uff0c" + L +
     " *   \u4e94\u6001\u9760\u773c\u5f62\uff08\u7741/\u5f2f\uff09\u4e0e\u5634\u5f62\uff08\u7b11/\u5f20/\u5e73\uff09\u7684\u663e\u9690\u5207\u6362\uff0c\u77ac\u65f6\u65e0\u8df3\u53d8\u3002 */" + L +
     "function aiAvatarSvg(st, cls) {" + L +
     "  const ST = { idle: 'st-idle', listening: 'st-listen', thinking: 'st-think', speaking: 'st-speak', happy: 'st-happy' }[st] || 'st-idle';" + L +
     "  return `<div class=\"ai-svg ${cls || ''} ${ST}\"><svg viewBox=\"0 0 200 200\" width=\"100%\" height=\"100%\" xmlns=\"http://www.w3.org/2000/svg\">" + L +
     "    <defs>" + L +
     "      <radialGradient id=\"a-halo\" cx=\"50%\" cy=\"46%\" r=\"52%\">" + L +
     "        <stop offset=\"0%\" stop-color=\"#cfe6df\" stop-opacity=\".85\"/><stop offset=\"100%\" stop-color=\"#cfe6df\" stop-opacity=\"0\"/>" + L +
     "      </radialGradient>" + L +
     "      <linearGradient id=\"a-skin\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\">" + L +
     "        <stop offset=\"0%\" stop-color=\"#fbeedd\"/><stop offset=\"100%\" stop-color=\"#f2ddc4\"/>" + L +
     "      </linearGradient>" + L +
     "      <linearGradient id=\"a-hair\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\">" + L +
     "        <stop offset=\"0%\" stop-color=\"#3b2f24\"/><stop offset=\"100%\" stop-color=\"#241c14\"/>" + L +
     "      </linearGradient>" + L +
     "    </defs>" + L +
     "    <ellipse class=\"halo\" cx=\"100\" cy=\"98\" rx=\"92\" ry=\"92\" fill=\"url(#a-halo)\"/>" + L +
     "    <g class=\"head-grp\">" + L +
     "      <ellipse cx=\"100\" cy=\"104\" rx=\"54\" ry=\"58\" fill=\"url(#a-skin)\"/>" + L +
     "      <path d=\"M46 104 q4 -46 54 -46 q50 0 54 46 q-12 -26 -54 -26 q-42 0 -54 26 Z\" fill=\"url(#a-hair)\"/>" + L +
     "      <path d=\"M46 100 q-6 22 2 34 q-14 -12 -12 -34 Z\" fill=\"url(#a-hair)\"/>" + L +
     "      <path d=\"M154 100 q6 22 -2 34 q14 -12 12 -34 Z\" fill=\"url(#a-hair)\"/>" + L +
     "      <path class=\"ribbon\" d=\"M148 66 q14 -14 6 -28 q-4 12 -14 16 Z\" fill=\"#b4594c\"/>" + L +
     "      <ellipse cx=\"70\" cy=\"118\" rx=\"10\" ry=\"6.5\" fill=\"#eda79c\" opacity=\".5\"/>" + L +
     "      <ellipse cx=\"130\" cy=\"118\" rx=\"10\" ry=\"6.5\" fill=\"#eda79c\" opacity=\".5\"/>" + L +
     "      <g class=\"eye-open\">" + L +
     "        <g class=\"eye\"><ellipse cx=\"80\" cy=\"107\" rx=\"7.5\" ry=\"9.5\" fill=\"#241c14\"/><circle cx=\"82.5\" cy=\"103.5\" r=\"2.6\" fill=\"#fff\"/></g>" + L +
     "        <g class=\"eye\"><ellipse cx=\"120\" cy=\"107\" rx=\"7.5\" ry=\"9.5\" fill=\"#241c14\"/><circle cx=\"122.5\" cy=\"103.5\" r=\"2.6\" fill=\"#fff\"/></g>" + L +
     "      </g>" + L +
     "      <g class=\"eye-curve\">" + L +
     "        <path d=\"M71 108 q9 -9 18 0\" stroke=\"#241c14\" stroke-width=\"4.5\" fill=\"none\" stroke-linecap=\"round\"/>" + L +
     "        <path d=\"M111 108 q9 -9 18 0\" stroke=\"#241c14\" stroke-width=\"4.5\" fill=\"none\" stroke-linecap=\"round\"/>" + L +
     "      </g>" + L +
     "      <path class=\"mouth-smile\" d=\"M90 128 q10 9 20 0\" stroke=\"#b4594c\" stroke-width=\"3.4\" fill=\"none\" stroke-linecap=\"round\"/>" + L +
     "      <ellipse class=\"mouth-open\" cx=\"100\" cy=\"130\" rx=\"8\" ry=\"7\" fill=\"#b4594c\"/>" + L +
     "      <path class=\"mouth-flat\" d=\"M91 130 h18\" stroke=\"#b4594c\" stroke-width=\"3.4\" fill=\"none\" stroke-linecap=\"round\"/>" + L +
     "      <path d=\"M64 162 q36 22 72 0 l6 40 h-84 Z\" fill=\"#5b8f86\"/>" + L +
     "      <path d=\"M100 176 v26\" stroke=\"#e8dcc6\" stroke-width=\"4\" stroke-linecap=\"round\"/>" + L +
     "    </g>" + L +
     "  </svg></div>`;" + L +
     "}"))
s = s.replace(anchor_dummy, '', 1) if False else s
io.open(p, 'w', encoding='utf-8', newline=L).write(s)
print('P1-OK')
