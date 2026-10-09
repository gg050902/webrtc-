# -*- coding: utf-8 -*-
"""★ 2026-10-01 Qwen3-TTS 本地常驻 worker（transformers 后端，CPU）。

▎协议（与 ASR worker 同家族）：stdin/stdout 各一行 JSON（UTF-8）。
  → {"id": 3, "text": "你好，我是 AI 小明。"}
  ← {"id": 3, "wav_b64": "<base64 wav>", "sr": 24000}
  出错 → {"id": 3, "error": "..."}；启动完 → {"ready": true, "model": "..."}
▎模型：QWEN_TTS_MODEL 默认 Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice（CPU 档）；
  音色：QWEN_TTS_SPEAKER（默认 Vivian，见 model.get_supported_speakers()）。
▎CPU 诚实边界：自回归音频生成，一句话可能要 5~20s（视句长）——所以只做
  "服务端音色"的升级项，链路上排在 Edge TTS 之前还是之后由配置/探测决定。
"""
import sys
import os
import json
import io
import base64

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")
except Exception:
    pass


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=os.environ.get("QWEN_TTS_MODEL", "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice"))
    args, _ = parser.parse_known_args()

    try:
        import torch
        from qwen_tts import Qwen3TTSModel
        import soundfile as sf
    except Exception as e:
        print(json.dumps({"fatal": "import: %s" % e}, ensure_ascii=False), flush=True)
        return 1

    # 精度：默认 **bfloat16**（★ 2026-10-02 实测决定，见 scripts/bench-tts.py 的数）
    #   本机 16 核 CPU、无 CUDA，同一批文本的实测：
    #     float32 : 11 字 22.1s / 30 字 49.4s / 87 字 113.6s   （RTF≈6~7）
    #     bfloat16: 11 字 15.8s / 30 字 32.2s / 87 字  91.3s   （RTF≈4.5~5，省 20~35%）
    #   ▸ 但要说清：**这仍然不足以支撑实时对话**（合成比播放慢 4~5 倍），
    #     所以服务端实时播报默认仍走浏览器朗读，本地音色要显式开 aiTtsLocalWait
    #     ——判据与取舍写在 sfu/server.js 的 localTtsWaitEnabled 注释里。
    #   ▸ 想回退/对比：QWEN_TTS_DTYPE=float32。
    # ★ 2026-10-03d GPU 优先（与 qwen_asr_worker.py 同一套逻辑）：本机有 RTX 4060(8GB)
    #   但装的 CPU 版 torch——上面"CPU 合成 44s/句"的账是 torch 没用上 GPU 时的账。
    #   换 cu130 版 torch 后 GPU bf16 合成，RTF 若降到 1 以下，`aiTtsLocalWait`（本地
    #   神经音色实时播报）就从"显式开关的实验项"变成"真正可用的选项"——实测数据说话。
    #   ▸ 逃生舱：QWEN_TTS_DEVICE=cpu 强制走 CPU（回到 02 实测的 CPU 档）。
    import torch as _torch
    dev = (os.environ.get("QWEN_TTS_DEVICE") or "").strip().lower()
    if dev == "cpu":
        device = "cpu"
    elif dev == "cuda" or (dev == "" and _torch.cuda.is_available()):
        device = "cuda"
    else:
        device = "cpu"
    dt_name = (os.environ.get("QWEN_TTS_DTYPE")
               or ("bfloat16")).strip().lower()
    dtype = getattr(_torch, dt_name, _torch.float32)

    try:
        model = Qwen3TTSModel.from_pretrained(
            args.model,
            dtype=dtype,
            device_map=device,
        )
    except Exception as e:
        # GPU 加载失败（显存被占/驱动问题）→ 自动回落 CPU 重试一次，别让音色整条起不来
        if device == "cuda":
            try:
                device = "cpu"
                model = Qwen3TTSModel.from_pretrained(args.model, dtype=dtype, device_map=device)
            except Exception as e2:
                print(json.dumps({"fatal": "load_model: %s / cpu重试: %s" % (e, e2)}, ensure_ascii=False), flush=True)
                return 1
        else:
            print(json.dumps({"fatal": "load_model: %s" % e}, ensure_ascii=False), flush=True)
            return 1

    print(json.dumps({"ready": True, "model": args.model, "dtype": dt_name, "device": device}, ensure_ascii=False), flush=True)

    speaker = os.environ.get("QWEN_TTS_SPEAKER", "Vivian")
    language = os.environ.get("QWEN_TTS_LANGUAGE", "Chinese")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue
        rid = req.get("id")
        text = str(req.get("text", "")).strip()
        try:
            wavs, sr = model.generate_custom_voice(
                text=text,
                language=language,
                speaker=speaker,
            )
            bio = io.BytesIO()
            sf.write(bio, wavs[0], sr, format="WAV")
            print(json.dumps({
                "id": rid,
                "wav_b64": base64.b64encode(bio.getvalue()).decode("ascii"),
                "sr": int(sr),
            }, ensure_ascii=False), flush=True)
        except Exception as e:
            print(json.dumps({"id": rid, "error": str(e)}, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
