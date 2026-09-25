"""古风水墨童子头像 · 后处理管线

与科技光体版的关键差异:
  科技版: 深底发光体 -> 越亮越不透明 (alpha ∝ lum)
  古风版: 宣纸底的墨 -> 越暗越不透明 (alpha ∝ (paper_lum - lum))
宣纸不是纯白(实测约 235), 所以背景色必须实测, 不能假设 255。

流程: 实测底色 -> 去水印 -> 反相键控 -> 归一化裁剪 -> 多尺寸导出
"""
import os
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = r"C:\Users\27418\Desktop\webrtc\apple-avatar\gufeng"
OUT = os.path.join(ROOT, "png")
os.makedirs(OUT, exist_ok=True)

SOURCES = {
    "idle":      "Traditional_Chinese_freehand_i_2026-09-25T10-09-10.png",
    "listening": "Keep_the_exact_SAME_ink_wash_c_2026-09-25T10-10-39.png",
    "speaking":  "Keep_the_exact_SAME_ink_wash_c_2026-09-25T10-11-17.png",
    "thinking":  "Keep_the_exact_SAME_ink_wash_c_2026-09-25T10-11-43.png",
    "happy":     "Keep_the_exact_SAME_ink_wash_c_2026-09-25T10-12-09.png",
}

TARGET = 0.66          # 交付尺寸下主体占比目标
CORNER = 0.12
WM_MARGIN = 0.18
INK_FULL = 70          # 暗于此 -> 浓墨, 完全不透明
PAPER_TOL = 14         # 底色容差: 亮于 (底色-此值) 视作纸 -> 透明
GAMMA = 0.9
ALPHA_T = 40
SIZES = [1024, 512, 256, 128, 64, 40]


# ---------- 测量 ----------
def paper_luma(im):
    """宣纸底色: 取四角中位数(排除可能的暗水印角)。"""
    w, h = im.size
    k = int(min(w, h) * CORNER)
    g = im.convert("L")
    vals = []
    for b in [(0, 0, k, k), (w - k, 0, w, k), (0, h - k, k, h), (w - k, h - k, w, h)]:
        px = list(g.crop(b).getdata())
        vals.append(sorted(px)[len(px) // 2])       # 中位数更抗噪
    vals.sort()
    return vals[len(vals) // 2]


def wm_report(im, base):
    """水印探测: 右下角是否明显暗于其余角。"""
    w, h = im.size
    k = int(min(w, h) * CORNER)
    g = im.convert("L")
    corners = {
        "左上": [(0, 0, k, k)], "右上": [(w - k, 0, w, k)],
        "左下": [(0, h - k, k, h)], "右下": [(w - k, h - k, w, h)],
    }
    out = {}
    for nm, boxes in corners.items():
        px = list(g.crop(boxes[0]).getdata())
        out[nm] = sum(px) / len(px)
    return out


# ---------- 处理 ----------
def maybe_strip_watermark(im, base):
    """仅在「四角对照」判定确有水印时才处理。

    判定依据: 真水印会让右下角显著暗于其余三角(科技光体版实测落差 20 单位,
    且其余三角彼此差 <1)。而宣纸的自然明暗渐变是四角均匀递降, 落差 <6。
    水墨飛白/淡墨点容易被误判成水印, 一刀切回填会毁掉写意的灵魂, 故默认不动。
    """
    w, h = im.size
    k = int(min(w, h) * CORNER)
    g = im.convert("L")
    vals = [sum(list(g.crop(b).getdata())) / (k * k)
            for b in [(0, 0, k, k), (w - k, 0, w, k), (0, h - k, k, h)]]
    dev = max(vals) - min(vals)
    if dev < 10:                      # 无水印迹象 -> 原样返回
        return im, 0.0
    s = int(min(w, h) * WM_MARGIN)
    paper = (int(base),) * 3
    region = im.crop((w - s, h - s, w, h))
    mask = region.convert("L").point(lambda v: 255 if v < base - 25 else 0)
    clean = Image.composite(Image.new("RGB", region.size, paper), region, mask)
    out = im.copy()
    out.paste(clean, (w - s, h - s))
    return out, sum(1 for v in mask.getdata() if v) / (s * s)


def ink_alpha(im, base):
    """反相键控: 纸 -> 透明, 越浓的墨 -> 越不透明。"""
    g = im.convert("L")
    lo_full = min(INK_FULL, base - 40)          # 浓墨(=完全实)
    hi_zero = max(base - PAPER_TOL, lo_full + 8)  # 纸(=完全透)
    span = max(1.0, hi_zero - lo_full)
    lut = []
    for v in range(256):
        if v >= hi_zero:
            lut.append(0)
        elif v <= lo_full:
            lut.append(255)
        else:
            t = (hi_zero - v) / span
            lut.append(int(min(1.0, t ** GAMMA) * 255))
    rgba = im.convert("RGBA")
    rgba.putalpha(g.point(lut))
    return rgba


def calc_box(rgba, factor):
    a = rgba.split()[3]
    bb = a.point(lambda v: 255 if v > ALPHA_T else 0).getbbox()
    if not bb:
        return (0, 0, rgba.size[0])
    x0, y0, x1, y1 = bb
    side = int(max(x1 - x0, y1 - y0) / factor)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    return (int(cx - side / 2), int(cy - side / 2), side)


def crop_with(rgba, box):
    x0, y0, side = box
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(rgba, (-x0, -y0))
    return canvas


def measure_on(rgba, size=256):
    a = rgba.resize((size, size), Image.LANCZOS).split()[3]
    bb = a.point(lambda v: 255 if v > ALPHA_T else 0).getbbox()
    return (max(bb[2] - bb[0], bb[3] - bb[1]) / size) if bb else 0.0


def vignette_mask(size, start=0.84):
    disk = size * start
    inset = (size - disk) / 2
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).ellipse([inset, inset, size - inset, size - inset], fill=255)
    return m.filter(ImageFilter.GaussianBlur(max(1.0, disk * (1 - start) / 4)))


def main():
    print(f"{'state':<11}{'纸底色':>7}{'水印占比':>9}{'迭代':>24}  最终占比")
    for state, rel in SOURCES.items():
        src = Image.open(os.path.join(ROOT, rel)).convert("RGB")
        base = paper_luma(src)
        wm_before = wm_report(src, base)

        im2, wm_ratio = maybe_strip_watermark(src, base)
        keyed = ink_alpha(im2, base)

        factor, frac, hist = 0.66, 0.0, []
        for _ in range(6):
            box = calc_box(keyed, factor)
            master = crop_with(keyed, box).resize((1024, 1024), Image.LANCZOS)
            frac = measure_on(master)
            hist.append(frac)
            if abs(frac - TARGET) < 0.015:
                break
            factor = min(0.95, max(0.30, factor * (TARGET / max(0.05, frac))))

        for sz in SIZES:
            img = master.resize((sz, sz), Image.LANCZOS)
            a = ImageChops.multiply(img.split()[3], vignette_mask(sz))
            img.putalpha(a)
            img.save(os.path.join(OUT, f"apple-ink-{state}-{sz}.png"))

        print(f"{state:<12}{base:>6.1f}{wm_ratio:>8.2%}"
              f"{str([round(x, 3) for x in hist]):>24}  {frac:.1%}")


if __name__ == "__main__":
    main()
