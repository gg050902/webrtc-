"""Apple AI 助理头像 · 素材处理管线

1. 去水印     : 右下角平台水印 -> 回填背景色
2. 亮度键控   : 深底发光体 -> 生成 alpha 通道(暗=透, 亮=实)
3. 居中裁剪   : 按真实主体 bbox 校正构图
4. 多尺寸导出 : 512/256/128/64/40 (+1024 母版)
"""
import os
from PIL import Image

ROOT = r"C:\Users\27418\Desktop\webrtc\apple-avatar"
OUT = os.path.join(ROOT, "dist", "png")
os.makedirs(OUT, exist_ok=True)

SOURCES = {
    "idle":      r"candidates\Minimalist_AI_assistant_avatar_2026-09-25T07-56-33.png",
    "listening": r"states\Keep_the_exact_same_character__2026-09-25T07-58-59.png",
    "speaking":  r"states\Keep_the_exact_same_character__2026-09-25T07-59-59.png",
    "thinking":  r"states\Keep_the_exact_same_character__2026-09-25T08-00-48.png",
    "happy":     r"states\Keep_the_exact_same_character__2026-09-25T08-01-06.png",
}

SIZES = [1024, 512, 256, 128, 64, 40]
CORNER = 0.12        # 角采样比例
WM_MARGIN = 0.16     # 水印搜索区(右下)
LO_OFFSET = 6        # alpha 黑场: 背景亮度 + 此值
HI = 140             # alpha 白场
GAMMA = 0.85


def load(p):
    return Image.open(os.path.join(ROOT, p)).convert("RGB")


def corner_bg(im):
    """取三洁净角的平均色作为背景色(排除右下)。"""
    w, h = im.size
    k = int(min(w, h) * CORNER)
    boxes = [(0, 0, k, k), (w - k, 0, w, k), (0, h - k, k, h)]
    tot = [0, 0, 0]
    n = 0
    for b in boxes:
        px = list(im.crop(b).getdata())
        for r, g, bl in px:
            tot[0] += r; tot[1] += g; tot[2] += bl
        n += len(px)
    return tuple(v / n for v in tot)


def kill_watermark(im, bg):
    """右下水印区整体回填背景色(该区理论上无主体)。"""
    w, h = im.size
    s = int(min(w, h) * WM_MARGIN)
    box = (w - s, h - s, w, h)
    region = im.crop(box)
    before = sum(sum(p) / 3 for p in region.getdata()) / (region.size[0] * region.size[1])

    patch = Image.new("RGB", region.size, tuple(int(v) for v in bg))
    out = im.copy()
    out.paste(patch, (w - s, h - s))

    after = sum(sum(p) / 3 for p in out.crop(box).getdata()) / (s * s)
    return out, before, after


def subject_bbox(im, bg_lum):
    """排除右下水印区后, 按亮度找真实主体边界。"""
    w, h = im.size
    s = int(min(w, h) * WM_MARGIN)
    probe = im.copy()
    probe.paste(Image.new("RGB", (s, s), (0, 0, 0)), (w - s, h - s))
    g = probe.convert("L")
    mask = g.point(lambda v: 255 if v > bg_lum + 14 else 0)
    return mask.getbbox()


def alpha_from_luma(im, bg_lum):
    """亮度键控: 背景全透, 越亮越实。"""
    r, g, b = im.split()
    lum = Image.merge("L", (r,)).point(lambda v: v)          # 占位, 用真实亮度替换
    lum = im.convert("L")
    lo = bg_lum + LO_OFFSET
    span = max(1, HI - lo)
    lut = []
    for v in range(256):
        if v <= lo:
            lut.append(0)
        else:
            t = (v - lo) / span
            t = min(1.0, t) ** GAMMA
            lut.append(int(t * 255))
    a = lum.point(lut)
    rgba = im.convert("RGBA")
    rgba.putalpha(a)
    return rgba


def center_crop(rgba, pad_ratio=0.17):
    """按 alpha 主体 bbox 居中裁剪成正方形。"""
    w, h = rgba.size
    a = rgba.split()[3]
    bb = a.point(lambda v: 255 if v > 24 else 0).getbbox()
    if not bb:
        return rgba
    x0, y0, x1, y1 = bb
    bw, bh = x1 - x0, y1 - y0
    side = max(bw, bh)
    pad = side * pad_ratio
    side = int(side + pad * 2)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    nx0 = int(cx - side / 2)
    ny0 = int(cy - side / 2)
    # 越界时用背景平移修正(透明填充)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(rgba, (-nx0, -ny0))
    return canvas


def main():
    report = []
    for state, rel in SOURCES.items():
        im = load(rel)
        bg = corner_bg(im)
        bg_lum = sum(bg) / 3

        im2, wm_b, wm_a = kill_watermark(im, bg)
        bb = subject_bbox(im2, bg_lum)
        if bb:
            x0, y0, x1, y1 = bb
            bw, bh = x1 - x0, y1 - y0
            w, h = im2.size
            offx = ((x0 + x1) / 2 - w / 2) / w * 100
            offy = ((y0 + y1) / 2 - h / 2) / h * 100
            frac = max(bw, bh) / min(w, h)
        else:
            offx = offy = frac = 0

        rgba = alpha_from_luma(im2, bg_lum)
        canvas = center_crop(rgba)

        for sz in SIZES:
            out_p = os.path.join(OUT, f"apple-{state}-{sz}.png")
            if sz >= canvas.size[0]:
                canvas.resize((sz, sz), Image.LANCZOS).save(out_p)
            else:
                canvas.resize((sz, sz), Image.LANCZOS).save(out_p, optimize=True)

        report.append((state, bg_lum, wm_b, wm_a, offx, offy, frac))

    print(f"{'state':<11}{'背景亮度':>8}{'水印前':>8}{'水印后':>8}{'偏移X':>8}{'偏移Y':>8}{'主体占比':>9}")
    for st, bl, b, a, ox, oy, fr in report:
        print(f"{st:<12}{bl:>7.1f}{b:>8.1f}{a:>8.1f}{ox:>+7.2f}%{oy:>+7.2f}%{fr:>8.1%}")
    print(f"\n输出目录: {OUT}")
    print(f"文件数: {len(SOURCES) * len(SIZES)}")


if __name__ == "__main__":
    main()
