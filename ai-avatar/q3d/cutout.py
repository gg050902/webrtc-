"""Q版3D手办头像 · 抠透明（flood-fill 连通区域法）

直接用"亮→透明"会误伤浅色皮肤（肤色接近背景）。
flood-fill 从四角种子出发只挖"与背景连通"的区域:
  脸/颈被黑发与西装框住, 不与边缘背景连通 -> 皮肤完好保留。
"""
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = r"C:\Users\27418\Desktop\webrtc\ai-avatar\q3d"
SRC = os.path.join(ROOT, "Cute_chibi_3D_character_render_2026-09-26T12-56-48.png")
TOL = 38          # 与背景色的颜色距离阈值（RGB 欧氏距离）
MAGENTA = (255, 0, 255)


def main():
    im = Image.open(SRC).convert("RGB")
    w, h = im.size
    print("源图:", im.size)

    # flood-fill 从四角挖背景（PIL 内部 C 实现，快）
    filled = im.copy()
    for xy in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        ImageDraw.floodfill(filled, xy, MAGENTA, thresh=TOL)

    fp = filled.load()
    mask = Image.new("L", (w, h), 255)
    mp = mask.load()
    for y in range(h):
        for x in range(w):
            if fp[x, y] == MAGENTA:
                mp[x, y] = 0

    # 边缘轻微羽化去毛刺
    mask = mask.filter(ImageFilter.GaussianBlur(w * 0.0025))

    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)

    # 校验：脸中心（皮肤）应不透明，四角应透明
    a = out.split()[3]
    print("四角 alpha:", [a.getpixel(p) for p in [(2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3)]])
    print("脸中心 alpha(应>200):", a.getpixel((w // 2, int(h * 0.45))))

    for sz in [1024, 512, 256, 128, 64, 40]:
        out.resize((sz, sz), Image.LANCZOS).save(os.path.join(ROOT, f"avatar-3d-{sz}.png"))
    out.save(os.path.join(ROOT, "avatar-3d-full.png"))
    print("已导出 avatar-3d-{40..1024}.png")


if __name__ == "__main__":
    main()
