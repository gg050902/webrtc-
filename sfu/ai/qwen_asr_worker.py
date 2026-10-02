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

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")
except Exception:
    pass


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

    try:
        model = Qwen3ASRModel.from_pretrained(
            args.model,
            dtype=torch.float32,          # CPU：bf16 不稳定，float32 保守可行
            device_map="cpu",
            max_new_tokens=256,
        )
    except Exception as e:
        print(json.dumps({"fatal": "load_model: %s" % e}, ensure_ascii=False), flush=True)
        return 1

    print(json.dumps({"ready": True, "model": args.model}, ensure_ascii=False), flush=True)

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
            results = model.transcribe(audio=wav, language=language)
            text = str(getattr(results[0], "text", "") or "").strip()
            print(json.dumps({"id": rid, "text": text}, ensure_ascii=False), flush=True)
        except Exception as e:
            print(json.dumps({"id": rid, "text": "", "error": str(e)}, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
