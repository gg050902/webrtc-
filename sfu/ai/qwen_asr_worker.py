# -*- coding: utf-8 -*-
"""★ 2026-10-01 Qwen3-ASR 本地常驻 worker（transformers 后端，CPU）。

▎与 asr_worker.py（whisper）同款协议：stdin/stdout 各一行 JSON（UTF-8）。
  → {"id": 7, "wav": "C:/.../seg-0003.wav"}
  ← {"id": 7, "text": "..."} / {"fatal": "..."} / 启动完 {"ready": true, "model": "..."}
▎为什么本地：Qwen3-ASR-0.6B 在 CPU 上可跑（transformers 后端），不依赖 DashScope key；
  与 whisper 常驻 worker 同款"模型只加载一次"——每段只付纯转写时间。
▎模型：环境变量 QWEN_ASR_MODEL 指定（HF id 或本地目录），默认 Qwen/Qwen3-ASR-0.6B。
▎退出：stdin 关闭 → 循环结束 → 进程退出（与 asr_worker.py 一致）。
"""
import sys
import os
import json
import time

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")
except Exception:
    pass


def pick_device():
    """★ 2026-10-03d GPU 优先：本机实测 RTX 4060(8GB) 装的是 CPU 版 torch，
    转写一段 4s 音频要 2.1~2.4s——这是每句字幕的硬账。换 CUDA 版 torch 后
    GPU 走 bf16（0.6B 模型约 1.5GB 显存），拿不到 GPU（驱动/显存/依赖缺）
    自动回落 CPU float32，行为与旧版完全一致。
    ▸ 逃生舱：QWEN_ASR_DEVICE=cpu 强制走 CPU（GPU 被别的活占满时用）。"""
    dev = (os.environ.get("QWEN_ASR_DEVICE") or "").strip().lower()
    import torch
    if dev == "cpu":
        return "cpu", torch.float32
    if dev == "cuda" or (dev == "" and torch.cuda.is_available()):
        return "cuda", torch.bfloat16
    return "cpu", torch.float32


def main():
    ap = __import__("argparse")
    parser = ap.ArgumentParser()
    parser.add_argument("--model", default=os.environ.get("QWEN_ASR_MODEL", "Qwen/Qwen3-ASR-0.6B"))
    args, _ = parser.parse_known_args()

    try:
        import torch  # whisper 已装过 torch；这里只 import 校验
        from qwen_asr import Qwen3ASRModel
    except Exception as e:
        print(json.dumps({"fatal": "import: %s" % e}, ensure_ascii=False), flush=True)
        return 1

    device, dtype = pick_device()
    try:
        model = Qwen3ASRModel.from_pretrained(
            args.model,
            dtype=dtype,                  # CPU：bf16 不稳定，float32 保守可行；GPU：bf16 又快又稳
            device_map=device,
            max_new_tokens=256,
        )
    except Exception as e:
        # GPU 加载失败（显存被占/驱动问题）→ 自动回落 CPU 重试一次，别让整条 ASR 起不来
        if device == "cuda":
            try:
                device, dtype = "cpu", torch.float32
                model = Qwen3ASRModel.from_pretrained(
                    args.model, dtype=dtype, device_map=device, max_new_tokens=256)
            except Exception as e2:
                print(json.dumps({"fatal": "load_model: %s / cpu重试: %s" % (e, e2)}, ensure_ascii=False), flush=True)
                return 1
        else:
            print(json.dumps({"fatal": "load_model: %s" % e}, ensure_ascii=False), flush=True)
            return 1

    print(json.dumps({"ready": True, "model": args.model, "device": device}, ensure_ascii=False), flush=True)

    language = os.environ.get("QWEN_ASR_LANGUAGE", "Chinese")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue
        rid = req.get("id")
        wav = req.get("wav", "")
        try:
            t0 = time.time()
            results = model.transcribe(audio=wav, language=language)
            text = str(getattr(results[0], "text", "") or "").strip()
            # ms = worker 自己量的纯推理耗时——Node 侧的"转写 X.Xs"若远大于它，
            # 差值就是排队（前一段还没转完），不是模型慢。归因要靠这两个数分开。
            print(json.dumps({"id": rid, "text": text,
                              "ms": round((time.time() - t0) * 1000)}, ensure_ascii=False), flush=True)
        except Exception as e:
            print(json.dumps({"id": rid, "text": "", "error": str(e)}, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
