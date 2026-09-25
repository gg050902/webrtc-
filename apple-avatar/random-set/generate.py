"""注册随机可选头像 · 抽象几何集 · 程序化生成

为什么用代码而不是 AI:
  抽象渐变头像 = 几何图形 × 配色 的组合。程序化生成比 AI 更统一、可控、可无限扩展,
  且能保证九张属于同一套设计语言(随机分配时整体协调)。

每个头像: 背景色 + 一种几何构图(圆/弧/半圆/三角/菱形/圆环等)。
九组国风高级配色, 构图彼此不同但语言统一。
"""
import os
from PIL import Image, ImageDraw

ROOT = r"C:\Users\27418\Desktop\webrtc\apple-avatar\random-set"
os.makedirs(ROOT, exist_ok=True)

SIZES = [512, 256, 128, 64]

# (名称, 背景, 前景)
THEMES = [
    ("青黛", "#33505f", "#eef3f2"),
    ("朱砂", "#b03a2e", "#f5ede1"),
    ("黛蓝", "#274069", "#e8eef5"),
    ("竹青", "#4a7a4f", "#f0f5ec"),
    ("海棠", "#b25066", "#f8ecec"),
    ("玄墨", "#262220", "#d9a441"),
    ("黛紫", "#5a4a75", "#efeaf5"),
    ("石青", "#3f6b85", "#eef4f6"),
    ("墨竹", "#2e4a3f", "#d9c88a"),
]


def hx(c):
    return tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))


def s1(d, S, fg):   # 大圆 + 右上小圆
    d.ellipse([S * .22, S * .22, S * .78, S * .78], fill=fg)
    d.ellipse([S * .64, S * .12, S * .84, S * .32], fill=fg)


def s2(d, S, fg):   # 下半圆 + 上弧
    d.pieslice([S * .18, S * .30, S * .82, S * .94], 0, 180, fill=fg)
    d.pieslice([S * .30, S * .06, S * .70, S * .46], 180, 360, fill=fg)


def s3(d, S, fg):   # 左下三角形 + 圆
    d.polygon([(S * .16, S * .84), (S * .52, S * .34), (S * .52, S * .84)], fill=fg)
    d.ellipse([S * .50, S * .22, S * .80, S * .52], fill=fg)


def s4(d, S, fg):   # 居中菱形 + 圆环
    d.polygon([(S * .5, S * .18), (S * .82, S * .5), (S * .5, S * .82), (S * .18, S * .5)], fill=fg)
    d.ellipse([S * .34, S * .34, S * .66, S * .66], outline=fg, width=int(S * .06))


def s5(d, S, fg):   # 上下错位双半圆
    d.pieslice([S * .16, S * .10, S * .62, S * .56], 0, 180, fill=fg)
    d.pieslice([S * .38, S * .44, S * .84, S * .90], 180, 360, fill=fg)


def s6(d, S, fg):   # 大圆环 + 偏心小圆
    d.ellipse([S * .18, S * .18, S * .82, S * .82], outline=fg, width=int(S * .09))
    d.ellipse([S * .56, S * .56, S * .80, S * .80], fill=fg)


def s7(d, S, fg):   # 四分之一圆(左下) + 右上点
    d.pieslice([S * -0.05, S * .45, S * .50, S * 1.0], 270, 360, fill=fg)
    d.ellipse([S * .66, S * .16, S * .88, S * .38], fill=fg)


def s8(d, S, fg):   # 扇形 + 圆
    d.pieslice([S * .14, S * .30, S * .70, S * .86], 180, 270, fill=fg)
    d.ellipse([S * .52, S * .14, S * .82, S * .44], fill=fg)


def s9(d, S, fg):   # 垂直双圆(大小)
    d.ellipse([S * .34, S * .12, S * .66, S * .44], fill=fg)
    d.ellipse([S * .26, S * .50, S * .74, S * .98], fill=fg)


SHAPES = [s1, s2, s3, s4, s5, s6, s7, s8, s9]


def main():
    for i, (name, bg, fg) in enumerate(THEMES, 1):
        for sz in SIZES:
            im = Image.new("RGB", (sz, sz), hx(bg))
            d = ImageDraw.Draw(im)
            SHAPES[i - 1](d, sz, hx(fg))
            im.save(os.path.join(ROOT, f"av-{i:02d}-{name}-{sz}.png"))
    print(f"生成完成: {len(THEMES) * len(SIZES)} 个文件")
    for i, (name, bg, fg) in enumerate(THEMES, 1):
        print(f"  av-{i:02d}  {name}  bg={bg} fg={fg}")


if __name__ == "__main__":
    main()
