"""Apple AI 助理头像 · 构建脚本 v2(最终版)

设计原则:
  1. 静态图与动画共用同一套抠图/裁剪逻辑, 保证一套素材视觉一致
  2. 所有阈值由测量得出(不写死), 且动画全程锁定首帧测得的参数, 避免帧间抖动
  3. 主体占比由"导出后实测 -> 闭环校正"收敛, 而不是一次性公式
"""
import os
import subprocess
import shutil
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = r"C:\Users\27418\Desktop\webrtc\apple-avatar"
PNG_OUT = os.path.join(ROOT, "dist", "png")
ANIM_OUT = os.path.join(ROOT, "dist", "anim")
TMP = os.path.join(ROOT, "dist", "_tmp")

SOURCES = {
    "idle":      "candidates/Minimalist_AI_assistant_avatar_2026-09-25T07-56-33.png",
    "listening": "states/Keep_the_exact_same_character__2026-09-25T07-58-59.png",
    "speaking":  "states/Keep_the_exact_same_character__2026-09-25T07-59-59.png",
    "thinking":  "states/Keep_the_exact_same_character__2026-09-25T08-00-48.png",
    "happy":     "states/Keep_the_exact_same_character__2026-09-25T08-01-06.png",
}
VIDEOS = {
    "idle":     "videos/Seamless_loop_animation_of_an__2026-09-25T08-02-34.mp4",
    "speaking": "videos/Seamless_loop_animation_of_an__2026-09-25T08-03-43.mp4",
}

TARGET = 0.66            # 交付尺寸下主体占比目标
CORNER = 0.12
WM_MARGIN = 0.16
LUMA_MARGIN = 8          # alpha 黑场 = 背景亮度 + 此值
ALPHA_HI = 140.0
GAMMA = 0.85            # 静态图 alpha 曲线(柔和)
GAMMA_ANIM = 1.6        # 动画 alpha 曲线(更硬, 显著压低 WebP 体积)
ALPHA_T = 40             # 判定"主体"的 alpha 阈值
PNG_SIZES = [1024, 512, 256, 128, 64, 40]
WEBP_SIZES = [256, 128]      # 64 由 webp_small.py 用 Pillow 生成(见该文件说明)
VID_FPS = 10      # 慢速呼吸/脉动, 10fps 足够;再高只是徒增体积
VID_SIZE = 512


def vignette_mask(size, start=0.80):
    """外围环带 alpha 平滑衰减到 0, 保证任何尺寸四角干净。

    用「实心白盘 + 高斯模糊」而非低分辨率 mask 放大的方式生成:
    后者经 LANCZOS 放大后会产生振铃波纹, 给 alpha 通道引入噪声,
    实测导致 WebP 体积从 454KB 膨胀到 1.18MB。
    """
    cache_key = (size, start)
    if cache_key in _VIG_CACHE:
        return _VIG_CACHE[cache_key]
    disk = size * start
    inset = (size - disk) / 2
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).ellipse([inset, inset, size - inset, size - inset], fill=255)
    blur = max(1.0, disk * (1 - start) / 4)
    m = m.filter(ImageFilter.GaussianBlur(blur))
    _VIG_CACHE[cache_key] = m
    return m


_VIG_CACHE = {}


def apply_vignette(rgba):
    size = rgba.size[0]
    a = ImageChops.multiply(rgba.split()[3], vignette_mask(size))
    out = rgba.copy()
    out.putalpha(a)
    return out


def bg_luma(im):
    w, h = im.size
    k = int(min(w, h) * CORNER)
    g = im.convert("L")
    vals = [sum(list(g.crop(b).getdata())) / (k * k)
            for b in [(0, 0, k, k), (w - k, 0, w, k), (0, h - k, k, h)]]
    return min(vals)


def strip_watermark(im):
    w, h = im.size
    s = int(min(w, h) * WM_MARGIN)
    k = int(min(w, h) * CORNER)
    tone = int(min(list(im.convert("L").crop((w - k, h - k, w, h)).getdata())))
    out = im.copy()
    out.paste(Image.new("RGB", (s, s), (tone,) * 3), (w - s, h - s))
    return out


def alpha_key(im, black, gamma=GAMMA):
    """亮度键控出 alpha。gamma 越大边缘越"硬"。

    动画用比静态图更大的 gamma: 运动状态下细节不易察觉,
    而更硬的 alpha 边缘能让 WebP 体积显著下降(渐变 alpha 压缩开销大)。
    """
    lo = black + LUMA_MARGIN
    span = max(1.0, ALPHA_HI - lo)
    lut = [0 if v <= lo else int(min(1.0, ((v - lo) / span) ** gamma) * 255)
           for v in range(256)]
    rgba = im.convert("RGBA")
    rgba.putalpha(im.convert("L").point(lut))
    return rgba


def crop_with(im_rgba, box):
    """按固定 box 裁剪, 超出部分透明填充(保证所有帧用同一构图)。"""
    x0, y0, side = box
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im_rgba, (-x0, -y0))
    return canvas


def calc_box(im_rgba, factor):
    """factor: 主体占画布比例。返回 (x0,y0,side)。"""
    a = im_rgba.split()[3]
    bb = a.point(lambda v: 255 if v > ALPHA_T else 0).getbbox()
    if not bb:
        return (0, 0, im_rgba.size[0])
    x0, y0, x1, y1 = bb
    bw, bh = x1 - x0, y1 - y0
    side = int(max(bw, bh) / factor)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    return (int(cx - side / 2), int(cy - side / 2), side)


def measure_on(rgba, size=256):
    """在给定交付尺寸上实测主体占比。"""
    a = rgba.resize((size, size), Image.LANCZOS).split()[3]
    bb = a.point(lambda v: 255 if v > ALPHA_T else 0).getbbox()
    return (max(bb[2] - bb[0], bb[3] - bb[1]) / size) if bb else 0.0


# ---------------- 静态图 ----------------
def build_statics():
    print("--- 静态 PNG (闭环校正主体占比) ---")
    for state, rel in SOURCES.items():
        src = Image.open(os.path.join(ROOT, rel)).convert("RGB")
        black = bg_luma(src)
        keyed = alpha_key(strip_watermark(src), black)

        factor, frac, hist = 0.66, 0.0, []
        for _ in range(6):
            box = calc_box(keyed, factor)
            master = crop_with(keyed, box).resize((1024, 1024), Image.LANCZOS)
            frac = measure_on(master)          # 母版统一下 256 实测
            hist.append(frac)
            if abs(frac - TARGET) < 0.015:
                break
            # frac 与 factor 正相关 -> 不足则放大 factor
            factor = min(0.95, max(0.30, factor * (TARGET / max(0.05, frac))))

        canvas = master
        for sz in PNG_SIZES:
            img = canvas.resize((sz, sz), Image.LANCZOS)
            apply_vignette(img).save(os.path.join(PNG_OUT, f"apple-{state}-{sz}.png"))
        print(f"  apple-{state:<10} 黑场={black:5.1f}  factor={factor:.3f}  "
              f"迭代={[round(x, 3) for x in hist]}  最终占比={frac:.1%}")


# ---------------- 动画 ----------------
def build_anim(tag, src):
    raw_dir = os.path.join(TMP, f"{tag}_raw")
    clean_dir = os.path.join(TMP, f"{tag}_clean")
    for d in (raw_dir, clean_dir):
        shutil.rmtree(d, ignore_errors=True)
        os.makedirs(d)

    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src,
                    "-filter_complex",
                    "[0:v]split=2[a][b];[a]trim=0:5.0,setpts=PTS-STARTPTS[body];"
                    "[b]trim=0:0.4,reverse,setpts=PTS-STARTPTS[tailseg];"
                    "[body][tailseg]xfade=transition=fade:duration=0.4:offset=4.6[out]",
                    "-map", "[out]", "-an", "-c:v", "libx264", "-crf", "18",
                    os.path.join(TMP, f"{tag}_loopfix.mp4")], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error",
                    "-i", os.path.join(TMP, f"{tag}_loopfix.mp4"),
                    "-an", "-vf", f"fps={VID_FPS}",
                    os.path.join(raw_dir, "f_%04d.png")], check=True)

    frames = sorted(os.listdir(raw_dir))
    first = Image.open(os.path.join(raw_dir, frames[0])).convert("RGB")
    black = bg_luma(first)                       # 全程锁定首帧测得的参数

    keyed0 = alpha_key(strip_watermark(first), black, GAMMA_ANIM)
    factor = 0.66
    for _ in range(5):
        box = calc_box(keyed0, factor)
        frac = measure_on(crop_with(keyed0, box), VID_SIZE)
        if abs(frac - TARGET) < 0.015:
            break
        factor = min(0.95, max(0.35, factor * (frac / TARGET)))

    for i, f in enumerate(frames):
        im = Image.open(os.path.join(raw_dir, f)).convert("RGB")
        keyed = alpha_key(strip_watermark(im), black, GAMMA_ANIM)
        frame = crop_with(keyed, box).resize((VID_SIZE, VID_SIZE), Image.LANCZOS)
        apply_vignette(frame).save(os.path.join(clean_dir, f"{i:04d}.png"))

    # 说明: 本机 ffmpeg 的 libvpx-vp9 虽声明支持 yuva420p, 实际仍输出 yuv420p
    # (四种参数组合均验证失败), 得到的 WebM 是黑底的。为保证交付诚实,
    # 不产出 WebM。大尺寸透明动画统一使用 WebP 或 APNG(由 Pillow 负责)。
    seq = os.path.join(clean_dir, "%04d.png")
    for sz in WEBP_SIZES:
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", seq,
                        "-framerate", str(VID_FPS), "-vf", f"scale={sz}:{sz}",
                        "-c:v", "libwebp", "-loop", "0", "-q:v", "72",
                        "-pix_fmt", "yuva420p",
                        os.path.join(ANIM_OUT, f"apple-{tag}-{sz}.webp")], check=True)
    print(f"  apple-{tag:<10} 帧数={len(frames)}  黑场={black:5.1f}  "
          f"factor={factor:.3f}  最终占比={frac:.1%}")


def main():
    for d in (PNG_OUT, ANIM_OUT, TMP):
        os.makedirs(d, exist_ok=True)
    build_statics()
    print("\n--- 动画 (与静态共用抠图逻辑) ---")
    for tag, src in VIDEOS.items():
        build_anim(tag, os.path.join(ROOT, src))
    print("\n构建完成")


if __name__ == "__main__":
    main()
