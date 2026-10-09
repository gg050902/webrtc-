# -*- coding: utf-8 -*-
"""★ 09-29 ASR 常驻转写 worker（零新依赖：用已安装的 openai-whisper Python 包）。

▎为什么要有这个文件：whisper 命令行每转一段音频都要**重新启动 Python + 加载模型**
  （实测固定开销 2~4s/次）。服务端管线是 5s 一段持续转写，每段都白付一次启动钱，
  字幕就会越攒越多——这是"识别不灵敏"的最大单一原因。
▎协议（stdin/stdout 各一行一个 JSON，UTF-8）：
  → {"id": 7, "wav": "C:/.../seg-0003.wav"}
  ← {"id": 7, "text": "小明，明天开会。"}
  启动完成先回一行 {"ready": true, "model": "small"}（Node 侧据此判断可以派活）。
  出错不崩：单段异常回 {"id": N, "text": "", "error": "..."}，循环继续。
▎退出：stdin 关闭（Node 侧 kill/服务器退出）→ 循环自然结束 → 进程退出。
▎被谁加载：sfu/ai/asr.js 的 createResidentTranscriber()。命令行路径（transcribeFile）
  仍是兜底：worker 起不来时自动回退，功能不降级。
"""
import sys
import os
import json
import argparse


def main():
    # Windows 默认 GBK 控制台——不显式 UTF-8 就会 UnicodeEncodeError（坑 57 同族）
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stdin.reconfigure(encoding="utf-8")
    except Exception:
        pass

    ap = argparse.ArgumentParser()
    # 模型名由 Node 侧经环境变量传入（argv 里不出现动态数据——安全形态见 asr.js 4.5 节）
    ap.add_argument("--model", default=os.environ.get("ASR_WORKER_MODEL", "small"))
    args = ap.parse_args()

    try:
        import whisper  # 探测在 Node 侧做过了；这里失败回 fatal 让 Node 走 CLI 兜底
    except Exception as e:  # ImportError 等
        print(json.dumps({"fatal": "import whisper: %s" % e}, ensure_ascii=False), flush=True)
        return 1

    try:
        model = whisper.load_model(args.model)
    except Exception as e:
        print(json.dumps({"fatal": "load_model: %s" % e}, ensure_ascii=False), flush=True)
        return 1

    print(json.dumps({"ready": True, "model": args.model,
                      "device": str(getattr(model, "device", "cpu"))}, ensure_ascii=False), flush=True)

    # ★ 2026-10-02：提示词由 Node 侧经 ASR_WORKER_PROMPT 下发（单一来源在 sfu/ai/asr.js）。
    #   原先这里自己写了一份同样的字符串——两处字面量迟早漂移（坑 47）。
    PROMPT = os.environ.get("ASR_WORKER_PROMPT") or "普通话会议对话，简体中文"
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
            # condition_on_previous_text=False：分段场景下上一段的"味"会串到下一段
            # （重复幻觉/标点漂移），段与段之间本就该独立。
            result = model.transcribe(
                wav,
                language="zh",
                initial_prompt=PROMPT,
                condition_on_previous_text=False,
                verbose=False,
            )
            text = str(result.get("text", "")).strip()
            print(json.dumps({"id": rid, "text": text}, ensure_ascii=False), flush=True)
        except Exception as e:
            print(json.dumps({"id": rid, "text": "", "error": str(e)}, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
