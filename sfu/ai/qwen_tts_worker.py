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

    try:
        model = Qwen3TTSModel.from_pretrained(
            args.model,
            dtype=torch.float32,
            device_map="cpu",
        )
    except Exception as e:
        print(json.dumps({"fatal": "load_model: %s" % e}, ensure_ascii=False), flush=True)
        return 1

    print(json.dumps({"ready": True, "model": args.model}, ensure_ascii=False), flush=True)

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
