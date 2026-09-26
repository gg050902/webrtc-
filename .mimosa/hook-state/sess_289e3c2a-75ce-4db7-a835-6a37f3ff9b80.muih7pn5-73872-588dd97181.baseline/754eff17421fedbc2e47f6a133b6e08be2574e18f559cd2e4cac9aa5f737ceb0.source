"""Q版3D手办 · 动画后处理 v2：无重影循环 + 逐帧抠透明 + WebP

循环方案（v1 的 xfade 交叉淡化会在接缝处产生双重曝光 = 重影，已废弃）：
  palindrome：正放 + 倒放（镜像）。idle 类慢动作倒放自然（呼吸/ sway/眨眼倒放都合理），
              数学上严格无缝——接缝帧 1→0 就是 0→1 的逆，永远平滑。
  hardcut   ：说话等不可逆动作不能倒放。在尾半段找与首帧全图差异最小的帧 k 硬切，
              嘴巴开合是快速周期运动，中性帧处切几乎不可察觉。

流程: 源视频 -> [重采样 fps] -> 逐帧 flood-fill 抠透明(亮色diff法) + 安全渐隐
     -> palindrome/硬切定序 -> 512 clean 帧 -> WebP(256/128 ffmpeg, 64 Pillow disposal=2)

用法: python build_anim.py <input.mp4> <out_prefix> [--mode palindrome|hardcut] [--seg 秒]
"""
import argparse
import os
import shutil
import subprocess
from PIL import Image, ImageDraw, ImageFilter, ImageChops

ROOT = r"C:\Users\27418\Desktop\webrtc\ai-avatar\q3d"
TMP = os.path.join(ROOT, "_tmp")
FPS = 15
OUT_SIZE = 512
MAGENTA = (255, 0, 255)
TOL = 38


def run(cmd):
    subprocess.run(cmd, check=True, capture_output=True)


def key_frame(im, blur_r):
    w, h = im.size
    filled = im.copy()
    for xy in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        ImageDraw.floodfill(filled, xy, MAGENTA, thresh=TOL)
    diff = ImageChops.difference(filled, Image.new("RGB", filled.size, MAGENTA))
    mask = diff.convert("L").point(lambda v: 255 if v > 0 else 0)
    mask = mask.filter(ImageFilter.GaussianBlur(blur_r))
    out = Image.new("RGBA", filled.size, (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)
    # 安全渐隐：主体居中（半径<45%），半径外的孤岛（漏挖的光斑/渐变块）压到透明
    vig = Image.new("L", (w, h), 0)
    ImageDraw.Draw(vig).ellipse([w * 0.03, h * 0.03, w * 0.97, h * 0.97], fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(w * 0.035))
    out.putalpha(ImageChops.multiply(out.split()[3], vig))
    return out


def frame_diff(a, b):
    """两帧 RGB 平均绝对差 + alpha 质量差惩罚。

    纯 RGB 差分挑出的"最相似帧"可能带源视频后期加的烟雾/光斑特效——
    全图平均差分对局部小特效不敏感。alpha 质量（不透明像素占比）差
    能直接反映"这一帧多出了东西"，叠加惩罚后可避开特效帧。"""
    ra = a.resize((64, 64)).convert("RGB")
    rb = b.resize((64, 64)).convert("RGB")
    h = ImageChops.difference(ra, rb).convert("L").histogram()
    rgb_d = sum(v * i for i, v in enumerate(h)) / (64 * 64 * 255)
    ma = a.resize((64, 64)).convert("RGBA").split()[3]
    mb = b.resize((64, 64)).convert("RGBA").split()[3]
    msa = sum(ma.getdata()) / (64 * 64 * 255)
    msb = sum(mb.getdata()) / (64 * 64 * 255)
    return rgb_d + 2.0 * abs(msa - msb)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("prefix")
    ap.add_argument("--mode", choices=["palindrome", "hardcut"], default="palindrome")
    ap.add_argument("--seg", type=float, default=2.8, help="取源视频前多少秒")
    args = ap.parse_args()
    video = args.video if os.path.isabs(args.video) else os.path.join(ROOT, args.video)
    prefix = args.prefix if os.path.isabs(args.prefix) else os.path.join(ROOT, args.prefix)

    raw = os.path.join(TMP, "raw")
    clean = os.path.join(TMP, "clean")
    for d in [TMP, raw, clean]:
        shutil.rmtree(d, ignore_errors=True)
        os.makedirs(d)

    # 1) 重采样 + 限时 + 逐帧抠透明（先抠再定序：hardcut 的相似度要基于抠好的
    #    RGBA 帧算，alpha 质量惩罚才能识别出带烟雾/光斑特效的帧）
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", video, "-t", str(args.seg), "-an",
         "-vf", f"fps={FPS}", os.path.join(raw, "f_%04d.png")])
    frames = sorted(os.listdir(raw))
    blur_r = int(OUT_SIZE * 0.0025)
    cut = []
    for f in frames:
        im = Image.open(os.path.join(raw, f)).convert("RGB")
        cut.append(key_frame(im, blur_r).resize((OUT_SIZE, OUT_SIZE), Image.LANCZOS))
    print(f"源片段: {len(cut)} 帧 @ {FPS}fps ({args.seg}s)，抠透明完成")

    # 2) 定序：palindrome 或 hardcut
    if args.mode == "palindrome":
        seq = cut + cut[-2:0:-1]            # 0..N-1, N-2..1（不重复端点，接缝 1→0 平滑）
        print(f"palindrome: {len(cut)} -> {len(seq)} 帧")
    else:
        n = len(cut)
        best_k, best_d = n - 1, float("inf")
        for k in range(int(n * 0.5), n):    # 尾半段找与首帧最接近的帧
            d = frame_diff(cut[0], cut[k])
            if d < best_d:
                best_d, best_k = d, k
        seq = cut[:best_k + 1]
        print(f"hardcut: 切在第 {best_k} 帧 (diff={best_d:.4f})，共 {len(seq)} 帧")

    # 3) 落盘（定序后的帧）
    for i, im in enumerate(seq):
        im.save(os.path.join(clean, f"{i:04d}.png"))

    # 4) WebP 三档
    seqp = os.path.join(clean, "%04d.png")
    for sz in [256, 128]:
        out = f"{prefix}-{sz}.webp"
        run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", seqp,
             "-vf", f"scale={sz}:{sz}", "-c:v", "libwebp", "-loop", "0", "-q:v", "75",
             "-pix_fmt", "yuva420p", out])
        print(f"{out}: {os.path.getsize(out)//1024}KB")

    sz = 64
    imgs = [Image.open(os.path.join(clean, f"{i:04d}.png")).resize((sz, sz), Image.LANCZOS)
            for i in range(len(seq))]
    out = f"{prefix}-{sz}.webp"
    imgs[0].save(out, save_all=True, append_images=imgs[1:],
                 duration=int(1000 / FPS), loop=0, disposal=2,
                 lossless=False, quality=75, method=4)
    print(f"{out}: {os.path.getsize(out)//1024}KB")


if __name__ == "__main__":
    main()
