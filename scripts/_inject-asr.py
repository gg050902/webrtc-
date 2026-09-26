# -*- coding: utf-8 -*-
# 注入:服务端 ASR(字幕转写,09-27)——whisper 检测 + 每路音频 15s 分段转写入账本
import io
p = 'sfu/server.js'
s = io.open(p, encoding='utf-8').read()
L = chr(10)

def rep(old, new, tag):
    global s
    assert old in s, tag
    s = s.replace(old, new, 1)

# ── 1) whisper 检测 + ASR 状态(挂 AI_WARM_MS 常量后) ──
rep("const AI_WARM_MS = (Number(process.env.AI_WARM_SEC) || 600) * 1000;",
    ("const AI_WARM_MS = (Number(process.env.AI_WARM_SEC) || 600) * 1000;" + L +
     L +
     "/* \u2605 09-27 \u670d\u52a1\u7aef ASR\uff08\u5b57\u5e55\u8f6c\u5199\uff0c\u7528\u6237\u70b9\u540d\u201c\u5f00\u542f\u90a3\u4e2a\u5b57\u5e55\u8f6c\u5199\u201d\uff09\uff1a" + L +
     " * \u25b6 \u539f\u7406\uff1aAI \u542c\u89c9\u7ba1\u7ebf\uff08startAiAudioPipe\uff09\u5df2\u628a\u6bcf\u8def\u97f3\u9891\u63a8\u7ed9\u672c\u673a ffmpeg\u2014\u2014\u5728\u6b64\u57fa\u7840\u4e0a" + L +
     " *   \u6539\u4e3a **15s \u5206\u6bb5\u843d\u76d8 wav \u2192 whisper \u547d\u4ee4\u884c\u8f6c\u5199 \u2192 \u8ffd\u52a0\u8fdb\u5b57\u5e55\u8d26\u672c jsonl\uff08source:'asr'\uff09**\u3002" + L +
     " *   \u8d26\u672c\u4e00\u65e6\u6709\u771f\u5b9e\u8f6c\u5199\uff0c@ai \u95ee\u7b54/RAG/\u7eaa\u8981/\u5524\u9192\u8bcd\u5168\u90e8\u81ea\u52a8\u5347\u7ea7\uff08\u4e0d\u518d\u4f9d\u8d56\u5ba2\u6237\u7aef Web Speech\uff09\u3002" + L +
     " * \u25b6 \u4f9d\u8d56\uff1a`pip install -U openai-whisper`\uff08\u9996\u6b21\u8fd0\u884c\u81ea\u52a8\u4e0b\u8f7d\u6a21\u578b\uff0c\u9700\u80fd\u8bbf HuggingFace\uff09\uff1b" + L +
     " *   \u672a\u68c0\u6d4b\u5230 whisper \u2192 \u542f\u52a8\u65f6\u660e\u786e\u63d0\u793a\u5b89\u88c5\u65b9\u5f0f\uff0c\u529f\u80fd\u9759\u9ed8\u5173\u95ed\uff08\u5ba2\u6237\u7aef Web Speech \u5b57\u5e55\u4ecd\u53ef\u7528\uff09\u3002" + L +
     " * \u25b6 \u9690\u79c1\u8fb9\u754c\uff1a\u97f3\u9891\u4e0d\u51fa\u672c\u673a\uff08whisper \u672c\u5730\u63a8\u7406\uff09\uff1b\u6a21\u578b tiny/base \u5373\u53ef\uff0c\u4e2d\u6587\u6548\u679c\u5df2\u591f\u7528\u3002 */" + L +
     "let WHISPER_BIN = null;      // \u68c0\u6d4b\u5230\u7684 whisper \u53ef\u6267\u884c\u6587\u4ef6\uff08null = \u672a\u53ef\u7528\uff09" + L +
     "let whisperProbed = false;" + L +
     "function probeWhisper() {" + L +
     "  if (whisperProbed) return Promise.resolve(WHISPER_BIN);" + L +
     "  whisperProbed = true;" + L +
     "  const { execFile } = require('child_process');" + L +
     "  const cands = ['whisper', 'whisper-cli', 'whisper.exe'];" + L +
     "  return new Promise((resolve) => {" + L +
     "    let i = 0;" + L +
     "    const tryNext = () => {" + L +
     "      if (i >= cands.length) {" + L +
     "        console.log('\U0001F399 \u670d\u52a1\u7aef\u8f6c\u5199\uff08ASR\uff09\u672a\u5f00\u542f\uff1a\u672a\u68c0\u6d4b\u5230 whisper\u3002\u5b89\u88c5\uff1a pip install -U openai-whisper \uff08\u91cd\u542f\u751f\u6548\uff09\uff1b\u5ba2\u6237\u7aef Web Speech \u5b57\u5e55\u4e0d\u53d7\u5f71\u54cd');" + L +
     "        return resolve(null);" + L +
     "      }" + L +
     "      const c = cands[i++];" + L +
     "      execFile(c, ['--help'], { timeout: 4000, windowsHide: true }, (err) => {" + L +
     "        if (err) return tryNext();" + L +
     "        WHISPER_BIN = c;" + L +
     "        console.log(`\U0001F399 \u670d\u52a1\u7aef\u8f6c\u5199\uff08ASR\uff09\u5df2\u5f00\u542f\uff1a${c}\uff08\u6bcf\u8def\u97f3\u9891 15s \u5206\u6bb5\u8f6c\u5199\u5165\u5b57\u5e55\u8d26\u672c\uff0cAI \u5c0f\u660e\u80fd\u542c\u61c2\u4f1a\u8bae\u5185\u5bb9\u4e86\uff09`);" + L +
     "        resolve(WHISPER_BIN);" + L +
     "      });" + L +
     "    };" + L +
     "    tryNext();" + L +
     "  });" + L +
     "}"), 'asr-probe')

# ── 2) startAiAudioPipe:whisper 可用时改"15s 分段录音→转写→循环" ──
rep("""    const proc = require('child_process').spawn(FFMPEG_BIN, [
      '-loglevel', 'error', '-protocol_whitelist', 'file,udp,rtp',
      '-fflags', '+genpts', '-i', sdpFile,
      '-af', 'astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level',
      '-f', 'null', '-',
    ], { stdio: ['pipe', 'ignore', 'pipe'] });""",
    """    // ★ 09-27：whisper 可用 → **分段录音模式**（每 15s 一段 wav，段完转写入账本）；
    //   不可用 → 原 astats 模式（只记响度）。两条路径都吃同一路 RTP。
    if (WHISPER_BIN) {
      const segDir = path.join(LOGS_DIR, `asr-${roomNumber}`);
      fs.mkdirSync(segDir, { recursive: true });
      let segIdx = 0;
      let alive = true;
      pipe.alive = () => { alive = false; }; // producerclose/停用时置假
      const recordLoop = async () => {
        while (alive && rooms.get(roomNumber)) {
          const wav = path.join(segDir, `seg-${Date.now()}.wav`);
          await new Promise((r) => {
            const rec = require('child_process').spawn(FFMPEG_BIN, [
              '-loglevel', 'error', '-protocol_whitelist', 'file,udp,rtp',
              '-fflags', '+genpts', '-i', sdpFile, '-t', '15',
              '-ar', '16000', '-ac', '1', '-y', wav,
            ], { stdio: ['ignore', 'ignore', 'ignore'] });
            rec.on('exit', () => setTimeout(r, 300)); // 留缓冲：文件写完整
          });
          if (!alive || !rooms.get(roomNumber)) { try { fs.unlinkSync(wav); } catch (e) {} break; }
          let size = 0;
          try { size = fs.statSync(wav).size; } catch (e) { continue; }
          if (size < 20000) { try { fs.unlinkSync(wav); } catch (e) {} continue; } // 静音段(≈<1s 语音)跳过
          // 转写（whisper CLI：输出同名 txt；模型 tiny 足够会议场景）
          const txtFile = wav.replace(/\\.wav$/, '.txt');
          await new Promise((r) => {
            require('child_process').execFile(WHISPER_BIN,
              [wav, '--model', process.env.WHISPER_MODEL || 'tiny', '--language', 'zh',
               '--output_format', 'txt', '--output_dir', segDir],
              { timeout: 60000, windowsHide: true }, () => r());
          });
          let text = '';
          try { text = fs.readFileSync(txtFile, 'utf8').trim(); } catch (e) {}
          try { fs.unlinkSync(wav); fs.unlinkSync(txtFile); } catch (e) {}
          if (!text || !rooms.get(roomNumber)) continue;
          // 入字幕账本（source:'asr' 标记来源；与客户端字幕同一条权威副本路径）
          const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
          const capFile = path.join(CAPTIONS_DIR, `cap-${roomNumber}-${day}.jsonl`);
          fs.appendFileSync(capFile, JSON.stringify({
            ts: Date.now(), from: memberId, name: `成员 ${String(memberId).slice(-4)}`, text: text.slice(0, 500), asr: true,
          }) + '\\n');
          if (!aiHearing.has(roomNumber)) aiHearing.set(roomNumber, new Map());
          io.to(roomNumber).emit('chat-message', {
            from: 'system', name: null,
            text: `🎙️ [转写] ${String(memberId).slice(-4)}：${text.slice(0, 80)}`,
            ts: Date.now(),
          });
          logEvent('info', 'asr-segment', { roomNumber, member: memberId, chars: text.length });
          segIdx += 1;
        }
      };
      recordLoop();
      return;
    }
    const proc = require('child_process').spawn(FFMPEG_BIN, [
      '-loglevel', 'error', '-protocol_whitelist', 'file,udp,rtp',
      '-fflags', '+genpts', '-i', sdpFile,
      '-af', 'astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level',
      '-f', 'null', '-',
    ], { stdio: ['pipe', 'ignore', 'pipe'] });""", 'seg-mode')

# ── 3) producerclose 停分段循环(pipe.alive) ──
rep("""    // 被跟的 Producer 关闭（关麦克风/断线）→ 收掉 ffmpeg（exit 回调统一清理管道）
    c.on('producerclose', () => { try { proc.kill(); } catch (e) { /* 已退 */ } });""",
    """    // 被跟的 Producer 关闭（关麦克风/断线）→ 收掉 ffmpeg（exit 回调统一清理管道）
    c.on('producerclose', () => {
      if (pipe && pipe.alive) pipe.alive(); // ★ 09-27 分段转写循环停机
      try { proc.kill(); } catch (e) { /* 已退 */ }
    });""", 'close-hook')

# ── 4) 启动时探测(与 probeFfmpeg 并行) ──
rep("  const workerReady = createWorker().then(() => {",
    "  probeWhisper();\n  const workerReady = createWorker().then(() => {", 'startup')

assert len(s) > 40000, '防截断保护：写入前发现 s 异常变短(' + str(len(s)) + ')'
import os
assert len(s) > 40000, '防截断保护'
tmp = p + '.tmp'
io.open(tmp, 'w', encoding='utf-8', newline=L).write(s)
os.replace(tmp, p)  # 原子替换(并发写手也只会得到完整的新版或完整旧版)
print('ASR-OK')
