# -*- coding: utf-8 -*-
"""★ 2026-10-03d GPU 换装后的实测脚本：不猜，量。
量两件事（同一台机器、同一个模型目录，只差 device/dtype）：
  ① ASR：加载 models/qwen3-asr-0.6b → 转写一段 4s 中文 wav 的耗时（重复 3 次取中位）
  ② TTS：加载 models/qwen3-tts-0.6b → 合成一句 12 字的耗时（重复 3 次取中位）
结果直接决定两个配置默认值的去留：
  - ASR 若降到亚秒级 → 字幕定稿延迟 ≈ FLUSH(1.2s)+转写，链路进入"跟手"区间；
  - TTS 若 RTF<1 → aiTtsLocalWait（本地音色实时播报）从实验项变成可选项。
用法：python scripts/gpu-bench-once.py [asr|tts|both]
"""
import os
import sys
import time
import statistics
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASR_DIR = os.path.join(ROOT, 'models', 'qwen3-asr-0.6b')
TTS_DIR = os.path.join(ROOT, 'models', 'qwen3-tts-0.6b')
TMP = os.path.join(ROOT, 'models', 'gpu-bench-tmp')
os.makedirs(TMP, exist_ok=True)


def log(kind, **kw):
    print('%s %s' % (kind, ' '.join('%s=%s' % (k, v) for k, v in kw.items())), flush=True)


def make_tone_wav(path, seconds=4.0, sr=16000):
    """4s 语音感占位音频（低幅变频噪声——真实模型解码要跑全流程）"""
    import struct, math
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        frames = bytearray()
        for i in range(int(sr * seconds)):
            v = int(6000 * math.sin(2 * math.pi * 220 * i / sr) * (0.6 + 0.4 * math.sin(i / 3000)))
            frames += struct.pack('<h', v)
        w.writeframes(bytes(frames))
    return path


def bench_asr():
    import torch
    from qwen_asr import Qwen3ASRModel
    dev = 'cuda' if torch.cuda.is_available() else 'cpu'
    dt = torch.bfloat16 if dev == 'cuda' else torch.float32
    log(kind='env', device=dev, dtype=str(dt), torch=torch.__version__)
    t0 = time.time()
    model = Qwen3ASRModel.from_pretrained(ASR_DIR, dtype=dt, device_map=dev, max_new_tokens=256)
    log(kind='load', secs=round(time.time() - t0, 1))
    wav = make_tone_wav(os.path.join(TMP, 'bench.wav'))
    times = []
    for i in range(4):   # 首次含 kernel 预热，取后 3 次中位
        t1 = time.time()
        r = model.transcribe(audio=wav, language='Chinese')
        dt_s = time.time() - t1
        times.append(dt_s)
        log(kind='run', i=i, secs=round(dt_s, 2), text=str(getattr(r[0], 'text', '') or '')[:20])
    log(kind='RESULT', asr_median_secs=round(statistics.median(times[1:]), 2), device=dev)


def bench_tts():
    import torch
    from qwen_tts import Qwen3TTSModel
    dev = 'cuda' if torch.cuda.is_available() else 'cpu'
    dt = torch.bfloat16
    log(kind='env', device=dev, dtype=str(dt), torch=torch.__version__)
    t0 = time.time()
    model = Qwen3TTSModel.from_pretrained(TTS_DIR, dtype=dt, device_map=dev)
    log(kind='load', secs=round(time.time() - t0, 1))
    text = '你好，我是会议助理小明。'   # 12 字，与 bench-tts 的 med 档同级
    times = []
    for i in range(4):
        t1 = time.time()
        wavs, sr = model.generate_custom_voice(text=text, language='Chinese', speaker='Vivian')
        dt_s = time.time() - t1
        times.append(dt_s)
        chars = len(text)
        audio_secs = len(wavs[0]) / sr
        log(kind='run', i=i, secs=round(dt_s, 2), audio_secs=round(audio_secs, 1),
            rtf=round(dt_s / audio_secs, 2))
    log(kind='RESULT', tts_median_secs=round(statistics.median(times[1:]), 2), device=dev)


if __name__ == '__main__':
    what = (sys.argv[1] if len(sys.argv) > 1 else 'both').lower()
    if what in ('asr', 'both'):
        bench_asr()
    if what in ('tts', 'both'):
        bench_tts()
