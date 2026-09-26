# -*- coding: utf-8 -*-
# 注入:头像 v3 深度美化(精修造型+丝滑过渡+多状态细粒度)
import io
p = 'sfu/public/client.js'
s = io.open(p, encoding='utf-8').read()
L = chr(10)

def rep(old, new, tag):
    global s
    assert old in s, tag
    s = s.replace(old, new, 1)

# ── 1) 整体替换 aiAvatarSvg 生成器(v3 精修版) ──
# 找 v2 函数体(从 function aiAvatarSvg 到它的闭合 "\n}")
import re
m = re.search(r"function aiAvatarSvg\(st, cls\) \{[\s\S]*?\n\}", s)
assert m, 'v2 fn'
v3 = r'''function aiAvatarSvg(st, cls) {
  /* ★ 09-26c 头像 v3 深度美化（用户反馈"还是不好看"）：
   *  ① 造型精修：皮肤径向渐变+柔边阴影滤镜、双眼皮+双高光眼、眉毛、发丝高光、
   *     交领双层次、腮红改柔边渐变——消除"火柴人"感；
   *  ② 丝滑：眼形/嘴形不再 display 硬切，全部 opacity 交叉淡化（transition .25s）；
   *  ③ 状态细粒度：thinking 有漂浮思考泡泡+瞳孔看斜上；speaking 嘴部开合动画；
   *     idle 偶发眨眼+轻微点头；listening 身体微前倾。 */
  const ST = { idle: 'st-idle', listening: 'st-listen', thinking: 'st-think', speaking: 'st-speak', happy: 'st-happy' }[st] || 'st-idle';
  return `<div class="ai-svg ${cls || ''} ${ST}"><svg viewBox="0 0 200 210" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="a-halo" cx="50%" cy="44%" r="55%">
        <stop offset="0%" stop-color="#d8e8df" stop-opacity=".9"/><stop offset="100%" stop-color="#d8e8df" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="a-skin" cx="46%" cy="36%" r="72%">
        <stop offset="0%" stop-color="#fdf1e0"/><stop offset="62%" stop-color="#f7e4cb"/><stop offset="100%" stop-color="#ecd2b2"/>
      </radialGradient>
      <linearGradient id="a-hair" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#4a3b2c"/><stop offset="45%" stop-color="#33291e"/><stop offset="100%" stop-color="#201912"/>
      </linearGradient>
      <linearGradient id="a-robe" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#679a90"/><stop offset="100%" stop-color="#4c7a71"/>
      </linearGradient>
      <filter id="a-soft" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="2.2"/>
      </filter>
      <filter id="a-blur1" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="1.1"/>
      </filter>
    </defs>
    <ellipse class="halo" cx="100" cy="100" rx="94" ry="94" fill="url(#a-halo)"/>
    <g class="body-grp">
      <!-- 衣领两层次：外袍 + 交领 -->
      <path d="M58 168 q42 26 84 0 l7 44 h-98 Z" fill="url(#a-robe)"/>
      <path d="M74 166 q26 20 52 0 l4 18 q-30 14 -60 0 Z" fill="#e8dcc6"/>
      <path d="M100 172 v20 M88 178 l-6 12 M112 178 l6 12" stroke="#c9b88f" stroke-width="2.6" stroke-linecap="round"/>
      <!-- 思考泡泡（仅 st-think 显示） -->
      <g class="think-bubbles">
        <circle cx="158" cy="52" r="5" fill="#d8cdb8" opacity=".85"/>
        <circle cx="172" cy="38" r="7.5" fill="#d8cdb8" opacity=".7"/>
        <circle cx="188" cy="22" r="10" fill="#d8cdb8" opacity=".55"/>
      </g>
      <!-- 头（后层柔影 + 脸） -->
      <ellipse cx="102" cy="110" rx="55" ry="59" fill="#c9a97f" opacity=".35" filter="url(#a-soft)"/>
      <ellipse cx="100" cy="106" rx="54" ry="58" fill="url(#a-skin)"/>
      <!-- 耳朵 -->
      <ellipse cx="45" cy="110" rx="7" ry="11" fill="url(#a-skin)"/>
      <ellipse cx="155" cy="110" rx="7" ry="11" fill="url(#a-skin)"/>
      <!-- 头发：主体 + 鬓角 + 发丝高光 + 丫髻 -->
      <path d="M46 104 q4 -48 54 -48 q50 0 54 48 q-12 -28 -54 -28 q-42 0 -54 28 Z" fill="url(#a-hair)"/>
      <path d="M44 100 q-8 24 1 38 q-16 -13 -13 -38 Z" fill="url(#a-hair)"/>
      <path d="M156 100 q8 24 -1 38 q16 -13 13 -38 Z" fill="url(#a-hair)"/>
      <path d="M60 84 q22 -18 42 -16 M140 84 q-20 -17 -38 -16" stroke="#6b5a41" stroke-width="2" fill="none" opacity=".7" stroke-linecap="round"/>
      <circle cx="100" cy="50" r="11" fill="url(#a-hair)"/>
      <path d="M92 44 q8 -8 16 0" stroke="#6b5a41" stroke-width="2" fill="none" opacity=".8" stroke-linecap="round"/>
      <rect x="96" y="56" width="8" height="6" rx="2" fill="#b4594c"/>
      <!-- 眉毛（thinking 时挑起） -->
      <path class="brow" d="M69 92 q10 -6 20 -2" stroke="#3b2f24" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      <path class="brow" d="M111 90 q10 -4 20 2" stroke="#3b2f24" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      <!-- 腮红（柔边渐变） -->
      <ellipse cx="68" cy="119" rx="10" ry="6" fill="#eda79c" opacity=".45" filter="url(#a-blur1)"/>
      <ellipse cx="132" cy="119" rx="10" ry="6" fill="#eda79c" opacity=".45" filter="url(#a-blur1)"/>
      <!-- 眼睛：睁眼（双眼皮+双高光；thinking 时瞳孔看斜上） -->
      <g class="eye-open">
        <path d="M69 100 q11 -5 22 0" stroke="#3b2f24" stroke-width="1.6" fill="none" opacity=".55" stroke-linecap="round"/>
        <path d="M109 100 q11 -5 22 0" stroke="#3b2f24" stroke-width="1.6" fill="none" opacity=".55" stroke-linecap="round"/>
        <g class="eye"><ellipse cx="80" cy="108" rx="7.6" ry="9.6" fill="#241c14"/>
          <circle cx="82.6" cy="104.2" r="2.7" fill="#fff"/><circle cx="77.8" cy="111" r="1.3" fill="#fff" opacity=".75"/></g>
        <g class="eye"><ellipse cx="120" cy="108" rx="7.6" ry="9.6" fill="#241c14"/>
          <circle cx="122.6" cy="104.2" r="2.7" fill="#fff"/><circle cx="117.8" cy="111" r="1.3" fill="#fff" opacity=".75"/></g>
      </g>
      <!-- 眼睛：弯眼（倾听/思考/愉悦） -->
      <g class="eye-curve">
        <path d="M70 108 q10 -10 20 0" stroke="#241c14" stroke-width="4.6" fill="none" stroke-linecap="round"/>
        <path d="M110 108 q10 -10 20 0" stroke="#241c14" stroke-width="4.6" fill="none" stroke-linecap="round"/>
      </g>
      <!-- 鼻子（一点即止） -->
      <path d="M100 116 q2.5 3 0 5" stroke="#c9a97f" stroke-width="2" fill="none" stroke-linecap="round"/>
      <!-- 嘴：三种（交叉淡化） -->
      <path class="mouth-smile" d="M89 128 q11 10 22 0" stroke="#b4594c" stroke-width="3.4" fill="none" stroke-linecap="round"/>
      <ellipse class="mouth-open" cx="100" cy="131" rx="8.5" ry="7"/>
      <path class="mouth-flat" d="M91 130 h18" stroke="#b4594c" stroke-width="3.4" fill="none" stroke-linecap="round"/>
    </g>
  </svg></div>`;
}'''
s = s[:m.start()] + v3 + s[m.end():]

# ── 2) 成员行/格子已有 setAiState 逻辑保持;补 CSS(另写 style) ──
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('V3-SVG-OK')
