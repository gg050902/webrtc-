"""用 Pillow 生成小尺寸动画 WebP。

背景: ffmpeg 的 libwebp 动画编码器会把后续帧存为相对前一帧的增量,
alpha 在平坦透明区累积(实测 Idle 首帧角落 2 -> 末帧 77), 导致小头像露方块边。
Pillow 编码时可显式指定 disposal, 避免累积。
"""
import os
import shutil
from PIL import Image

ROOT = r"C:\Users\27418\Desktop\webrtc\apple-avatar"
TMP = os.path.join(ROOT, "dist", "_tmp")
ANIM_OUT = os.path.join(ROOT, "dist", "anim")

SIZES = [64]
FPS = 10


def build(tag):
    clean = os.path.join(TMP, f"{tag}_clean")
    fs = sorted(os.listdir(clean))
    for sz in SIZES:
        frames = []
        for f in fs:
            im = Image.open(os.path.join(clean, f)).convert("RGBA")
            frames.append(im.resize((sz, sz), Image.LANCZOS))
        out = os.path.join(ANIM_OUT, f"apple-{tag}-{sz}.webp")
        frames[0].save(
            out, save_all=True, append_images=frames[1:],
            duration=int(1000 / FPS), loop=0,
            disposal=2,            # 每帧后清画布, 杜绝累积
            lossless=False, quality=72, method=6,
        )
        kb = os.path.getsize(out) / 1024
        print(f"  {os.path.basename(out)}: {len(frames)}帧 {kb:.0f}KB")


def check(tag):
    """回读验证(用 ffmpeg 解帧, 独立于 Pillow 的检测路径)。"""
    import subprocess
    for sz in SIZES:
        src = os.path.join(ANIM_OUT, f"apple-{tag}-{sz}.webp")
        d = os.path.join(TMP, f"{tag}_wpc")
        shutil.rmtree(d, ignore_errors=True)
        os.makedirs(d)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src,
                        "-fps_mode", "passthrough", os.path.join(d, "f_%04d.png")],
                       check=True)
        from PIL import Image as I
        fs = sorted(os.listdir(d))
        worst = 0
        for f in fs:
            a = I.open(os.path.join(d, f)).convert("RGBA").split()[3]
            w, h = a.size
            k = max(2, int(w * 0.06))
            for b in [(0, 0, k, k), (w - k, 0, w, k), (0, h - k, k, h), (w - k, h - k, w, h)]:
                worst = max(worst, max(list(a.crop(b).getdata())))
        print(f"  {tag}-{sz}: 全{len(fs)}帧角落最大 alpha = {worst}  "
              f"{'通过' if worst <= 12 else '仍超标'}")


def main():
    print("--- Pillow 重建小尺寸动画 ---")
    for tag in ["idle", "speaking"]:
        build(tag)
    print("\n--- 回读校验 ---")
    for tag in ["idle", "speaking"]:
        check(tag)


if __name__ == "__main__":
    main()
