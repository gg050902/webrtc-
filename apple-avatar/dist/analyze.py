"""客观分析头像素材: 透明度、主体边界框、居中度、水印区域检测。"""
import os
from PIL import Image

FILES = [
    ("候选A-球体+光丝+外环", r"C:\Users\27418\Desktop\webrtc\apple-avatar\candidates\Minimalist_AI_assistant_avatar_2026-09-25T07-56-33.png"),
    ("候选B-水滴", r"C:\Users\27418\Desktop\webrtc\apple-avatar\candidates\Minimalist_AI_assistant_avatar_2026-09-25T07-56-57.png"),
    ("候选C-晶体", r"C:\Users\27418\Desktop\webrtc\apple-avatar\candidates\Minimalist_AI_assistant_avatar_2026-09-25T07-57-27.png"),
    ("候选D-光环", r"C:\Users\27418\Desktop\webrtc\apple-avatar\candidates\Minimalist_AI_assistant_avatar_2026-09-25T07-57-53.png"),
    ("状态-倾听", r"C:\Users\27418\Desktop\webrtc\apple-avatar\states\Keep_the_exact_same_character__2026-09-25T07-58-59.png"),
    ("状态-说话", r"C:\Users\27418\Desktop\webrtc\apple-avatar\states\Keep_the_exact_same_character__2026-09-25T07-59-59.png"),
    ("状态-思考", r"C:\Users\27418\Desktop\webrtc\apple-avatar\states\Keep_the_exact_same_character__2026-09-25T08-00-48.png"),
    ("状态-愉悦", r"C:\Users\27418\Desktop\webrtc\apple-avatar\states\Keep_the_exact_same_character__2026-09-25T08-01-06.png"),
    ("透明底-基准", r"C:\Users\27418\Desktop\webrtc\apple-avatar\dist\src\Minimalist_AI_assistant_avatar_2026-09-25T08-06-53.png"),
]

SUBJECT_T = 60      # 亮度阈值: 高于此视为发光主体
WM_T = 70           # 水印 L 形区域检测阈值


def subject_bbox(rgba):
    """返回发光主体的边界框。透明图按 alpha, 不透明图按亮度。"""
    a = rgba.split()[3]
    amin, amax = a.getextrema()
    if amin < 250:                      # 有真实透明通道 -> 用 alpha 判定主体
        return a.point(lambda v: 255 if v > 40 else 0).getbbox()
    g = rgba.convert("L")               # 深底图 -> 用亮度判定
    return g.point(lambda v: 255 if v > SUBJECT_T else 0).getbbox()


def watermark_probe(rgba):
    """右下角 L 形区域平均亮度: 平台水印通常落在那。"""
    w, h = rgba.size
    g = rgba.convert("L")
    x0, y0 = int(w * 0.55), int(h * 0.90)
    crop = g.crop((x0, y0, w, h))
    px = list(crop.getdata())
    return sum(px) / len(px)


def main():
    for name, p in FILES:
        if not os.path.exists(p):
            print(f"[MISS] {name}")
            continue
        im = Image.open(p)
        rgba = im.convert("RGBA")
        w, h = rgba.size
        a = rgba.split()[3]
        amin, amax = a.getextrema()
        bb = subject_bbox(rgba)

        print(f"\n=== {name} ===")
        print(f"  size       : {w}x{h}   mode={im.mode}")
        print(f"  alpha范围   : ({amin},{amax})   透明背景={'是' if amin < 250 else '否'}")

        if bb:
            bx0, by0, bx1, by1 = bb
            bw, bh = bx1 - bx0, by1 - by0
            cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
            offx = (cx - w / 2) / w * 100
            offy = (cy - h / 2) / h * 100
            print(f"  主体框     : {bw}x{bh}  占画面 {bw/w:.1%} x {bh/h:.1%}")
            print(f"  中心偏移   : 水平 {offx:+.1f}% / 垂直 {offy:+.1f}%")
            margin = min(bx0, by0, w - bx1, h - by1)
            print(f"  最小安全边距: {margin}px ({margin/w:.1%})")
        else:
            print("  主体框     : 未检出")

        if amin >= 250:
            wm = watermark_probe(rgba)
            flag = "有水印迹象" if wm > 6 else "干净"
            print(f"  右下角亮度 : {wm:.1f} -> {flag}")


if __name__ == "__main__":
    main()
