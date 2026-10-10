# -*- coding: utf-8 -*-
"""★ 2026-10-10（C6 / 路线图 H1b）流式 ASR 可行性探针——**只出结论，不改生产**。

▎要回答的问题（H1b 挂在路线图上的原话是"流式 ASR（边说边出字）"）：
  ① 我们加载的那台 qwen_asr 本地 worker，**有没有可用的分块/流式入口**？
  ② 如果有/如果没有，用"前缀重解码"（每个时间点把听过的音频整段重转一次）能不能
     换到"首字提前"？代价是多少（算力、改口次数）？
  ③ 中途那次读数**稳不稳**——字幕会当场改口几次？（这是"边说边出字"真正的代价，
     不是延迟数字能表达的。）

▎隐私：本探针**一个字的转录内容都不打印**。它只输出数字与长度
  （真人金标准语料是用户自己的声音与句子原文，`sfu/voice-golden/` 因此整目录不进 git）。

▎口径提醒（读结论前先看这条）：这里的"稳定度/差异"用的是**字符级 Levenshtein 的近似口径**，
  **不是** `sfu/ai/accuracy.js` 那把 CER 尺——跨运行时把两份尺对齐的代价不值这一趟，
  而且这条判据只用来比"这一步与前一步是否相同"，不用来报准确率。
  要报准确率的场合仍然只认那一个函数（坑 47）。

用法（不要手工跑，走 npm 那层拿模型目录）：
    npm run bench:asr-stream
    npm run bench:asr-stream -- --grid 1.0 --files 6
输出：stdout 每行一个 JSON（第一行是能力探测，之后每行一句音频）。
"""
import sys
import os
import json
import time
import wave
import argparse

sys.stdout.reconfigure(encoding="utf-8")


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def read_wav(path):
    """读 16k 单声道 s16le → (float32 numpy, sr)。不是 16k/单声道的文件**如实报并跳过**，
    不许悄悄重采样：那样量出来的延迟与生产（16k 管道）不是同一个条件。"""
    import numpy as np
    with wave.open(path, "rb") as w:
        sr = w.getframerate()
        ch = w.getnchannels()
        sw = w.getsampwidth()
        n = w.getnframes()
        raw = w.readframes(n)
    if sr != 16000 or ch != 1 or sw != 2:
        return None, {"skip": "格式不是 16k/单声道/s16le（sr=%d ch=%d w=%d）" % (sr, ch, sw)}
    a = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    return a, {"frames": int(n), "sec": round(n / sr, 2)}


def lev(a, b):
    """字符级编辑距离（只用于"这一步与那一步差多少"，两行滚动数组）。"""
    if a == b:
        return 0
    la, lb = len(a), len(b)
    if la == 0 or lb == 0:
        return la or lb
    prev = list(range(lb + 1))
    for i in range(1, la + 1):
        cur = [i] + [0] * lb
        ca = a[i - 1]
        for j in range(1, lb + 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (0 if ca == b[j - 1] else 1))
        prev = cur
    return prev[lb]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=os.environ.get("QWEN_ASR_MODEL", ""))
    ap.add_argument("--dir", default=os.environ.get("GOLDEN_DIR", ""))
    ap.add_argument("--grid", type=float, default=float(os.environ.get("ASR_STREAM_GRID", "1.0")), help="前缀重解码的采样间隔（秒）")
    ap.add_argument("--files", type=int, default=int(os.environ.get("ASR_STREAM_FILES", "6")), help="最多量几句（样本量要打印出来）")
    args, _ = ap.parse_known_args()

    import numpy as np
    import torch
    from qwen_asr import Qwen3ASRModel

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.bfloat16 if dev == "cuda" else torch.float32
    t0 = time.time()
    model = Qwen3ASRModel.from_pretrained(args.model, dtype=dtype, device_map=dev, max_new_tokens=256)
    load_ms = int((time.time() - t0) * 1000)

    # ── ① 能力探测：这台后端到底认不认流式入口（一次调用就够，这不是统计量）──
    cap = {"has_attr": [n for n in ("init_streaming_state", "streaming_transcribe", "finish_streaming_transcribe")
                        if hasattr(model, n)],
           "device": dev, "dtype": str(dtype), "load_ms": load_ms}
    try:
        st = model.init_streaming_state(chunk_size_sec=args.grid)
        cap["streaming_state"] = "OK"
        cap["state_type"] = type(st).__name__
    except Exception as e:
        cap["streaming_state"] = "%s: %s" % (type(e).__name__, str(e).replace("\n", " ")[:220])
        st = None
    # 后端是什么（vLLM 与 transformers 是两条完全不同的路；H1b 的成不成押在这一个事实上）
    for k in ("backend", "_backend", "engine"):
        if hasattr(model, k):
            cap["backend_attr"] = "%s=%s" % (k, getattr(model, k))
    emit({"kind": "capability", **cap})

    # ── ② 样本：真人金标准的 wav（只取路径，不读内容）──
    if not args.dir or not os.path.isdir(args.dir):
        emit({"kind": "error", "why": "GOLDEN_DIR 不存在（%r）——没有真人语料就量，结论会是合成语音的" % args.dir})
        return 1
    import glob
    names = sorted(glob.glob(os.path.join(args.dir, "near-*.wav")))
    names = names[:max(1, args.files)]
    if not names:
        emit({"kind": "error", "why": "目录里没有 near-*.wav（用户还没录？）**不许回落合成语音**——那正是这轮要避开的条件"  })
        return 1

    for p in names:
        audio, info = read_wav(p)
        base = {"kind": "file", "file": os.path.basename(p), **info}
        if audio is None:
            emit(dict(base, skipped=info["skip"]))
            continue
        dur = len(audio) / 16000.0

        # 整句一次解码（= 今天生产里"整句重转"那一刀的形状）：这是**对照组**
        t = time.time()
        full = model.transcribe([(audio, 16000)])[0]
        full_ms = int((time.time() - t) * 1000)
        full_text = getattr(full, "text", "") or ""

        # 前缀重解码：每 --grid 秒把"听过的全部音频"重转一次（流式实现自己也是这么做的——
        #   它的 docstring 明写 "re-feed *all* audio seen so far"，没有 KV 复用）
        steps = []
        cum_ms = 0
        prev = ""
        rewrites = 0
        first_nonempty_at = None
        tt = args.grid
        while tt <= dur + 1e-6:
            seg = audio[:int(tt * 16000)]
            t = time.time()
            r = model.transcribe([(seg, 16000)])[0]
            ms = int((time.time() - t) * 1000)
            cum_ms += ms
            txt = getattr(r, "text", "") or ""
            if txt and first_nonempty_at is None:
                first_nonempty_at = round(tt, 2)
            if txt != prev:
                # "改口"= 新文本不是旧文本的延长（前缀关系成立 = 只是往下续写，界面不用重画整行）
                if prev and not txt.startswith(prev):
                    rewrites += 1
                prev = txt
            steps.append({"t": round(tt, 2), "ms": ms, "chars": len(txt),
                          "d_vs_full": lev(txt, full_text), "d_vs_prev": lev(txt, prev)})
            tt += args.grid
        tail = None
        if dur > steps[-1]["t"] + 0.05:
            t = time.time()
            r = model.transcribe([(audio, 16000)])[0]
            tail = {"t": round(dur, 2), "ms": int((time.time() - t) * 1000), "chars": len(getattr(r, "text", "") or "")}

        emit(dict(base, dur=round(dur, 2), grid=args.grid,
                  full_ms=full_ms, full_chars=len(full_text),
                  prefix_first_text_at_s=first_nonempty_at,
                  prefix_total_ms=cum_ms, prefix_steps=len(steps),
                  prefix_rewrites=rewrites,
                  last_step_d_vs_full=steps[-1]["d_vs_full"] if steps else None,
                  tail=tail,
                  # 每步与终稿的差异（0 = 这一步读出来的东西就是最终答案的前缀/全文）
                  steps=steps))
    return 0


if __name__ == "__main__":
    sys.exit(main())
