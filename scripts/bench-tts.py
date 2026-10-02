# -*- coding: utf-8 -*-
"""scripts/bench-tts.py —— Qwen3-TTS 本地引擎的延迟基准（npm run bench:tts，★ 2026-10-02）

▎为什么要有这个脚本：用户问"能不能用 Qwen 的音色但延迟低一点"。这个问题**不能靠感觉回答**——
  CPU 自回归音频模型的成本是硬的（本机实测合成比播放还慢，RTF>1），
  但"哪一段是必须付的、哪一段是我们白等的"必须量出来才知道：
    ① 单句 RTF（合成耗时 / 生成的音频时长）随句长怎么变？
    ② `non_streaming_mode=False`（模型自带的流式档）到底省不省？
    ③ 三句一次批量调用（text=List）比逐句调用省不省？
    ④ dtype float32 → bfloat16 在 CPU 上快不快？
    ⑤ torch 线程数有没有吃满？
  每一条都对应一个可落地的改法；量不出来就别动 worker 的加载参数（坑 58：先量真正的瓶颈量）。

▎输出：每行一个 JSON（kind=env/load/seq/stream_off/batch3/dtype_fail），人和脚本都能读。
▎用法：npm run bench:tts（需要先 modelscope 下好 models/qwen3-tts-0.6b）
▎诚实边界：数字是**本机 CPU + 当前负载**下的实测值，换机器/后台在跑会议时都要重测；
  本脚本会加载模型两次（fp32 与 bf16），每次约 1 分钟，全程约 5~10 分钟。
"""
import sys
import os
import json
import time


def log(**kw):
    print(json.dumps(kw, ensure_ascii=False), flush=True)


try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

MODEL = os.environ.get("QWEN_TTS_MODEL") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "qwen3-tts-0.6b")
SPEAKER = os.environ.get("QWEN_TTS_SPEAKER", "Vivian")

TEXTS = {
    "short12": "明天下午三点开评审会。",
    "med36": "好，记下了：明天下午三点开评审会，我把纪要和待办一起整理好。",
    "long70": "这场会一共定了三件事：第一，明天下午三点开评审会；第二，压测报告由小王负责，"
              "本周五之前给出结论；第三，跨网部署先用 Tailscale 验证一轮，如果还是连不通再考虑云主机。",
}


def synth(model, text, **kw):
    """返回 (耗时秒, 音频总时长秒)。text 传 list 时按批量算。"""
    t0 = time.time()
    wavs, sr = model.generate_custom_voice(text=text, speaker=SPEAKER, language="Chinese", **kw)
    dt = time.time() - t0
    if isinstance(text, list):
        return dt, sum(len(w) / sr for w in wavs)
    return dt, len(wavs[0]) / sr


def one_pass(dt_name):
    import torch
    from qwen_tts import Qwen3TTSModel
    dtype = getattr(torch, dt_name)
    t0 = time.time()
    model = Qwen3TTSModel.from_pretrained(MODEL, dtype=dtype, device_map="cpu")
    log(kind="load", dtype=dt_name, secs=round(time.time() - t0, 1))
    torch.set_num_threads(os.cpu_count() or 8)
    log(kind="threads", set_to=torch.get_num_threads(), cpu=os.cpu_count())
    for name, txt in TEXTS.items():
        try:
            d, dur = synth(model, txt)
            log(kind="seq", dtype=dt_name, case=name, chars=len(txt), secs=round(d, 1),
                audio_secs=round(dur, 2), rtf=round(d / max(dur, 0.01), 2))
        except Exception as e:
            log(kind="seq", dtype=dt_name, case=name, error=str(e)[:160])
    for name in ("med36", "long70"):
        try:
            d, dur = synth(model, TEXTS[name], non_streaming_mode=False)
            log(kind="stream_off", dtype=dt_name, case=name, secs=round(d, 1),
                audio_secs=round(dur, 2), rtf=round(d / max(dur, 0.01), 2))
        except Exception as e:
            log(kind="stream_off", dtype=dt_name, case=name, error=str(e)[:160])
    try:
        d, dur = synth(model, list(TEXTS.values()))
        log(kind="batch3", dtype=dt_name, secs=round(d, 1), audio_secs=round(dur, 2),
            rtf=round(d / max(dur, 0.01), 2))
    except Exception as e:
        log(kind="batch3", dtype=dt_name, error=str(e)[:160])
    del model


def main():
    import torch
    log(kind="env", torch=torch.__version__, threads_init=torch.get_num_threads(),
        cpu_count=os.cpu_count(), cuda=torch.cuda.is_available(), model=MODEL)
    if not os.path.isdir(MODEL):
        log(kind="fatal", error="模型目录不存在（先 modelscope 下载 qwen3-tts-0.6b 到 models/）")
        return 1
    for dt_name in ("float32", "bfloat16"):
        try:
            one_pass(dt_name)
        except Exception as e:
            log(kind="dtype_fail", dtype=dt_name, error=str(e)[:200])
    return 0


if __name__ == "__main__":
    sys.exit(main())
