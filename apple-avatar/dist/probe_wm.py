"""四角亮度对照检测: 判断右下角异常是平台水印还是背景渐变。"""
from PIL import Image

TARGETS = [
    ("候选A", r"C:\Users\27418\Desktop\webrtc\apple-avatar\candidates\Minimalist_AI_assistant_avatar_2026-09-25T07-56-33.png"),
    ("状态-愉悦", r"C:\Users\27418\Desktop\webrtc\apple-avatar\states\Keep_the_exact_same_character__2026-09-25T08-01-06.png"),
]


def corner_stats(path):
    g = Image.open(path).convert("L")
    w, h = g.size
    k = int(min(w, h) * 0.12)          # 角区块边长
    corners = {
        "左上": (0, 0, k, k),
        "右上": (w - k, 0, w, k),
        "左下": (0, h - k, k, h),
        "右下": (w - k, h - k, w, h),
    }
    out = {}
    for name, box in corners.items():
        px = list(g.crop(box).getdata())
        out[name] = sum(px) / len(px)
    return out


def main():
    for name, p in TARGETS:
        s = corner_stats(p)
        base = min(s.values())
        print(f"\n=== {name} 四角平均亮度 ===")
        for k, v in s.items():
            print(f"  {k}: {v:6.1f}   (高出最暗角 {v - base:5.1f})")


if __name__ == "__main__":
    main()
