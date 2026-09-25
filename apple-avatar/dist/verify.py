"""交付前校验: 静态 PNG / 动画 WebP / WebM 的透明通道是否真实有效。"""
import os
from PIL import Image, ImageSequence

ROOT = r"C:\Users\27418\Desktop\webrtc\apple-avatar"


def check_static(p):
    im = Image.open(p)
    rgba = im.convert("RGBA")
    a = rgba.split()[3]
    amin, amax = a.getextrema()
    w, h = rgba.size
    # 四角 alpha 应为 0
    k = max(2, int(min(w, h) * 0.06))
    corners = [a.crop((0, 0, k, k)), a.crop((w - k, 0, w, k)),
               a.crop((0, h - k, k, h)), a.crop((w - k, h - k, w, h))]
    cmax = max(max(list(c.getdata())) for c in corners)
    # 主体占比
    bb = a.point(lambda v: 255 if v > 40 else 0).getbbox()
    frac = (max(bb[2] - bb[0], bb[3] - bb[1]) / w) if bb else 0
    return amin, amax, cmax, frac


def check_anim(p):
    im = Image.open(p)
    frames = 0
    bad = 0
    amin_global = 255
    frac = 0
    for i, fr in enumerate(ImageSequence.Iterator(im)):
        if i > 40:
            break
        rgba = fr.convert("RGBA")
        a = rgba.split()[3]
        frames += 1
        amin_global = min(amin_global, a.getextrema()[0])
        w, h = rgba.size
        k = max(2, int(min(w, h) * 0.06))
        for box in [(0, 0, k, k), (w - k, 0, w, k), (0, h - k, k, h), (w - k, h - k, w, h)]:
            if max(list(a.crop(box).getdata())) > 12:
                bad += 1
        if i == 0:
            bb = a.point(lambda v: 255 if v > 40 else 0).getbbox()
            frac = (max(bb[2] - bb[0], bb[3] - bb[1]) / w) if bb else 0
    return frames, amin_global, bad, frac


def main():
    print("--- 静态 PNG (抽验 128px) ---")
    print(f"{'file':<28}{'alpha最小':>9}{'角透明':>8}{'主体占比':>9}  判定")
    for st in ["idle", "listening", "speaking", "thinking", "happy"]:
        p = os.path.join(ROOT, "dist", "png", f"apple-{st}-128.png")
        if not os.path.exists(p):
            print(f"{st}: MISSING")
            continue
        amin, amax, cmax, frac = check_static(p)
        ok = (amin == 0 and cmax <= 12 and 0.6 <= frac <= 0.85)
        print(f"apple-{st}-128{'':<{max(1,14-len(st))}}{amin:>9}{cmax:>8}{frac:>8.1%}  {'通过' if ok else '需调整'}")

    print("\n--- 动画 WebP / WebM ---")
    print(f"{'file':<30}{'帧数':>6}{'alpha最小':>9}{'脏角':>6}{'主体占比':>9}  判定")
    for f in sorted(os.listdir(os.path.join(ROOT, "dist", "anim"))):
        p = os.path.join(ROOT, "dist", "anim", f)
        try:
            frames, amin, bad, frac = check_anim(p)
            ok = (amin == 0 and bad == 0)
            print(f"{f:<32}{frames:>6}{amin:>9}{bad:>6}{frac:>8.1%}  {'通过' if ok else '需调整'}")
        except Exception as e:
            print(f"{f:<32}无法解析: {type(e).__name__}")


if __name__ == "__main__":
    main()
