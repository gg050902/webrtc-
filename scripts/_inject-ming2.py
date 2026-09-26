# -*- coding: utf-8 -*-
# 注入:AI 助理深化 P2(旧图换 SVG/发言条逐字/emitCaption 唤醒/server 改名)
import io

def patch(path, pairs):
    s = io.open(path, encoding='utf-8').read()
    for old, new, tag in pairs:
        assert old in s, f'{path}:{tag}'
        s = s.replace(old, new, 1)
    io.open(path, 'w', encoding='utf-8', newline='\n').write(s)
    print('OK', path)

# ═══ client.js ═══
patch('sfu/public/client.js', [
    # 1) 成员行 bot 头像:img → 内联 SVG(小尺寸同 class)
    ("""      row.innerHTML = `<img class="avatar-img ai-av" src="${aiStateUrl(aiAvatar.state)}" alt="">`""",
     """      row.innerHTML = `<span class="ai-av">${aiAvatarSvg(aiAvatar.state, 'ai-av-mini')}</span>`""", 'row-av'),
    # 2) setAiState:成员行换 SVG(整段替换 innerHTML)+ 格子换 SVG + 发言条逐字
    ("""function setAiState(st) {
  if (!AI_STATES.includes(st)) return;
  aiAvatar.state = st;
  if (aiAvatar.rowEl) aiAvatar.rowEl.src = aiStateUrl(st);
  if (aiTileEl) {
    const img = aiTileEl.querySelector('img.ai-face');
    if (img) img.src = aiStateUrl(st).replace('128', '256');
    const label = aiTileEl.querySelector('.ai-status');
    if (label) label.textContent = AI_STATE_LABEL[st];
    aiTileEl.classList.toggle('speaking', st === 'speaking');
    aiTileEl.classList.toggle('thinking', st === 'thinking');
  }
}""",
     """function setAiState(st, speechText) {
  if (!AI_STATES.includes(st)) return;
  aiAvatar.state = st;
  // 成员行小头像：重渲染内联 SVG（换眼形/嘴形）
  if (aiAvatar.rowEl) aiAvatar.rowEl.innerHTML = aiAvatarSvg(st, 'ai-av-mini');
  // AI 格子：大头像 + 状态标签 + 发言字幕条
  if (aiTileEl) {
    const wrap = aiTileEl.querySelector('.ai-face-wrap');
    if (wrap) wrap.innerHTML = aiAvatarSvg(st, 'ai-face-svg');
    const label = aiTileEl.querySelector('.ai-status');
    if (label) label.textContent = AI_STATE_LABEL[st];
    aiTileEl.classList.toggle('speaking', st === 'speaking');
    aiTileEl.classList.toggle('thinking', st === 'thinking');
    /* ★ 09-26b 发言字幕逐字化（用户反馈"AI 字幕太僵硬"）：
     *   speaking 时把答案在格子上方的字幕条里**逐字打出**（标点带停顿——逗号长、
     *   句号更长，模拟说话的呼吸），朗读感立刻不一样；归位时字幕淡出。
     *   为什么不用流式 delta？Mock 轨没有流、LLM 流受网络节奏影响——本地逐字动画
     *   在两种轨道上表现完全一致（确定性的"生动"）。 */
    const bar = aiTileEl.querySelector('.ai-speech');
    if (st === 'speaking' && speechText) {
      bar.classList.add('show');
      bar.textContent = '';
      clearTimeout(aiSpeechTimer);
      let i = 0;
      const tick = () => {
        if (!aiTileEl || i >= speechText.length) return;
        bar.textContent += speechText[i];
        const ch = speechText[i];
        i += 1;
        aiSpeechTimer = setTimeout(tick, /[，、；：]/.test(ch) ? 150 : /[。！？…]/.test(ch) ? 320 : 55);
      };
      aiSpeechTimer = setTimeout(tick, 250);
    } else if (st !== 'speaking' && bar) {
      clearTimeout(aiSpeechTimer);
      bar.classList.remove('show');
      setTimeout(() => { if (bar && !bar.classList.contains('show')) bar.textContent = ''; }, 400);
    }
  }
}
let aiSpeechTimer = 0;""", 'setstate'),
    # 3) AI 格子:img → SVG + 发言字幕条 + 改名小明
    ("""    aiTileEl.innerHTML =
      '<div class="ai-face-wrap"><img class="ai-face" src="/avatars/ai/idle-256.png" alt="AI 助理"></div>' +
      '<div class="video-label">AI 助理<span class="ai-status">聆听中…</span></div>';""",
     """    aiTileEl.innerHTML =
      '<div class="ai-face-wrap">' + aiAvatarSvg('idle', 'ai-face-svg') + '</div>' +
      '<div class="ai-speech" aria-live="polite"></div>' +
      '<div class="video-label">AI 小明<span class="ai-status">聆听中…</span></div>';""", 'tile'),
    # 4) server 名字在前端的三处兜底(广播 name 由 server 给;这里改 label/日志)
    ("  log('🤖 在聊天框里输入你的问题（已自动带上 @ai 前缀）');",
     "  log(`🤖 在聊天框里输入你的问题（已自动带上 @ai 前缀）；开会时提到「${AI_NICKNAME}」它会自动接话`, );".replace(', );', ');'), 'asklog'),
    # 5) emitCaption 唤醒(挂在 SCTP 广播失败兜底之前)
    ("""function emitCaption(text) {
  const entry = { ts: Date.now(), from: socket.id, name: myDisplayName || '我', text };
  capPushLog(entry);
  showCaptionBar(myDisplayName || '我', text, false);
  if (capHistoryPanel && !capHistoryPanel.classList.contains('hidden')) appendCapHistoryRow(entry);""",
     """function emitCaption(text) {
  const entry = { ts: Date.now(), from: socket.id, name: myDisplayName || '我', text };
  capPushLog(entry);
  showCaptionBar(myDisplayName || '我', text, false);
  if (capHistoryPanel && !capHistoryPanel.classList.contains('hidden')) appendCapHistoryRow(entry);
  /* ★ 09-26b 唤醒词：成稿里提到「小明」且 AI 在场 → 自动接话（整句作为提问）。
   *   为什么放客户端：字幕在每端本地识别，谁嘴里说出"小明"谁触发——服务端
   *   听不到字（它只有音频管线没有转写），这是当前架构下最自然的挂点。 */
  if (AI_NICKNAME && text.includes(AI_NICKNAME) && lastMembers.some((m) => m.isBot)) {
    socket.emit('ai-ask', { question: text });
    log(`🤖 ${AI_NICKNAME} 听到你叫它了，正在组织回答…`);
  }""", 'wake'),
])

# ═══ server.js ═══
patch('sfu/server.js', [
    # bot 显示名全线改"小明"
    ("      id: 'ai-bot', name: '🤖 AI 助理', isBot: true, avatar: 'ai',",
     "      id: 'ai-bot', name: '🤖 AI 小明', isBot: true, avatar: 'ai',", 'botname1'),
    ("    io.to(roomNumber).emit('ai-state', { state: 'speaking' }); // ★ 09-26：答案播报期（TTS 朗读/字幕滚动）",
     "    io.to(roomNumber).emit('ai-state', { state: 'speaking', text: r.text }); // ★ 09-26b：播报期带全文（前端逐字字幕）", 'speak-text'),
])
# server 里其余 name: '🤖 AI 助理' 的聊天广播改'🤖 AI 小明'
s = io.open('sfu/server.js', encoding='utf-8').read()
n = s.count("name: '🤖 AI 助理'")
s = s.replace("name: '🤖 AI 助理'", "name: '🤖 AI 小明'")
io.open('sfu/server.js', 'w', encoding='utf-8', newline='\n').write(s)
print('renamed', n)
