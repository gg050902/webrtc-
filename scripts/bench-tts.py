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

▎输出：每行一个 JSON（kind=env/load/seq/stream_off/batch3/median/dtype_fail），人和脚本都能读。
▎用法：npm run bench:tts            # 每格跑一次（快，但**不能用来给参数排序**）
      npm run bench:tts -- --repeats 3   # 每格跑三次，额外输出中位数（要做结论就用它）
▎为什么要 --repeats：第一版每格只跑一次，我据此写下"`non_streaming_mode` 没有收益"；
  第二版跑完发现同一 dtype 内部相差 1.7 倍（bf16 流式 30 字 7.80 反而全表最慢），
  **说明差异被机器噪声主导，n=1 根本排不了序**（同坑 53：别拿单个绝对值下判断）。
  所以：排序必须由 median 说话，单跑的数字只用来估量级。
▎诚实边界：数字是**本机 CPU + 当前负载**下的实测值，换机器/后台在跑会议时都要重测；
  本脚本会加载模型两次（fp32 与 bf16），每次约 1 分钟；加 --repeats 3 全程约 15~30 分钟。
"""
import sys
import os
import json
import time


def log(**kw):
    print(json.dumps(kw, ensure_ascii=False), flush=True)


def arg_of(name, default):
    """自己解析 --repeats N（不引 argparse 之外的东西；这里连 argparse 都不必）。"""
    for i, a in enumerate(sys.argv):
        if a == name and i + 1 < len(sys.argv):
            return sys.argv[i + 1]
        if a.startswith(name + "="):
            return a.split("=", 1)[1]
    return default


REPEATS = max(1, int(arg_of("--repeats", "1")))


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


def median(xs):
    s = sorted(xs)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2.0


def cell(model, kind, label, fn, chars=None):
    """跑一个格子：REPEATS 次都记 JSON，repeats>1 时额外记一条 median。
    ▸ 为什么每次都要单独打印而不是只打中位数：**方差本身就是结论**——
      如果 fp32/bf16 的 spread 比它们的中位数差还大，那这张表就不支持"换 dtype 更快"，
      只看 median 会把这件事藏起来（坑 53 的同一条：判断要连着它的置信度一起给）。"""
    rtfs = []
    for i in range(REPEATS):
        try:
            d, dur = fn()
            rtf = d / max(dur, 0.01)
            rtfs.append(rtf)
            log(kind=kind, case=label, rep=i + 1, of=REPEATS,
                chars=chars, secs=round(d, 1), audio_secs=round(dur, 2), rtf=round(rtf, 2))
        except Exception as e:
            log(kind=kind, case=label, error=str(e)[:160])
    if len(rtfs) > 1:
        log(kind="median", case=label, reps=len(rtfs), rtf=round(median(rtfs), 2),
            spread=round(max(rtfs) - min(rtfs), 2), min=round(min(rtfs), 2), max=round(max(rtfs), 2))
    return rtfs


def one_pass(dt_name):
    import torch
    from qwen_tts import Qwen3TTSModel
    dtype = getattr(torch, dt_name)
    # ★ 2026-10-03d 设备可选：默认自动（有 CUDA 用 GPU——worker 的同款逻辑，量出来的
    #   才是"上线后真实发生的"）；BENCH_TTS_DEVICE=cpu 可强制回 CPU 对比。
    dev = (os.environ.get("BENCH_TTS_DEVICE") or "").strip().lower()
    if dev not in ("cpu", "cuda"):
        dev = "cuda" if torch.cuda.is_available() else "cpu"
    t0 = time.time()
    model = Qwen3TTSModel.from_pretrained(MODEL, dtype=dtype, device_map=dev)
    log(kind="load", dtype=dt_name, device=dev, secs=round(time.time() - t0, 1), repeats=REPEATS)
    if dev == "cpu":
        torch.set_num_threads(os.cpu_count() or 8)
    log(kind="threads", set_to=torch.get_num_threads(), cpu=os.cpu_count(), device=dev)
    for name, txt in TEXTS.items():
        cell(model, "seq", "%s/%s" % (dt_name, name), lambda t=txt: synth(model, t), chars=len(txt))
    for name in ("med36", "long70"):
        cell(model, "stream_off", "%s/%s" % (dt_name, name),
             lambda n=name: synth(model, TEXTS[n], non_streaming_mode=False))
    cell(model, "batch3", dt_name + "/batch3", lambda: synth(model, list(TEXTS.values())))
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
