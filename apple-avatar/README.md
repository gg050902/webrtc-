# Apple · AI 助理动态头像 — 资产交付说明

## 一、设计说明

**形态**：一颗悬浮的「发光能量核心」——磨砂玻璃球体 + 内部流动光丝漩涡 + 外圈细光环，冷白偏青的光色。

**为什么不做具象苹果**：具象水果配「AI 助理」会掉档次，且有商标擦边风险。
Apple 的气质被放在了光的质感里——清透、克制、冷白里透一点青，像果核被剖开那一瞬的光。

**关键设计约束**（决定它能不能真正在产品里用起来）：

| 约束 | 处理 | 原因 |
|---|---|---|
| 透明背景 | 全部资产带真实 alpha 通道 | 可叠加任意 UI 底色，不出现黑/白方块 |
| 主体占比统一 ≈66% | 闭环校正到 65.2%–66.8% | ① 五状态切换时不会「忽大忽小」 ② ≤70.7% 时才不会被圆形裁剪切掉轮廓 |
| 无缝循环 | 尾首交叉淡化，接缝差异 0.70/255 | 低于动画自身帧间变化 1.81/255，肉眼不可察 |
| 一致性 | 静态与动画共用同一套抠图/裁剪逻辑 | 静态图与动画不会发生视觉割裂 |

## 二、资产清单

### 静态 PNG — `png/`

```
png/apple-{state}-{size}.png
state = idle | listening | speaking | thinking | happy
size  = 1024 · 512 · 256 · 128 · 64 · 40
```

五个状态的语义：

- `idle` 待机 — 默认呼吸态，静息时的常驻状态
- `listening` 倾听 — 收拢为声呐波纹，专注接收用户输入
- `speaking` 说话 — 波环向外发射，配合语音输出
- `thinking` 思考 — 螺旋深潜，色相偏冷（银绿/紫）
- `happy` 愉悦 — 暖光绽放，用于正反馈时刻

### 动画 WebP — `anim/`

```
anim/apple-{idle|speaking}-{256|128|64}.webp
```

| 尺寸 | idle | speaking | 建议用途 |
|---|---|---|---|
| 64px | 77 KB | 84 KB | 列表项、聊天行内小头像 |
| 128px | 212 KB | 266 KB | **默认推荐**，覆盖 40–120px 场景 |
| 256px | 606 KB | 775 KB | 高倍屏 / 大画面展示 |

10fps / 5s 循环。慢速呼吸类动画 10fps 与 15fps 观感无差别，但体积省掉约 1/3。

> **推荐**：绝大多数场景用 128px 资源 + CSS 缩放，比直接提供多档静态档位更划算。

## 三、集成方式

```html
<!-- 1. 动态头像（WebP 原生循环，无需 JS） -->
<img src="anim/apple-idle-128.webp" style="width:64px;height:64px;border-radius:50%">

<!-- 2. 按状态切换 -->
<img id="avatar" src="anim/apple-idle-128.webp" style="width:64px;height:64px">
<script>
  const el = document.getElementById('avatar');
  // 助手开始说话 -> speaking；回答结束 -> idle
  el.src = speaking ? 'anim/apple-speaking-128.webp' : 'anim/apple-idle-128.webp';
</script>

<!-- 3. 圆形容裁安全：主体占 66%，方形/圆形裁切均不会切到轮廓 -->
<style>.avatar{border-radius:50%;overflow:hidden}</style>
```

## 四、构建与复现

全部由脚本生成，换素材后可直接重跑：

```bash
# 静态 PNG + 128/256 动画（ffmpeg 编码）
python dist/build.py

# 64px 动画（Pillow 编码，原因见下）
python dist/webp_small.py

# 交付校验
python dist/verify.py
```

## 五、过程中踩到并记录下来的坑

这些都已固化在脚本注释里，避免重蹈：

1. **ImageGen 的 `background: transparent` 在本模型不生效** —— 会生成白底图。
   透明必须靠后处理抠图（亮度键控）实现，不要指望生成参数。

2. **平台水印固定在右下角** —— 四角对照测得该角比其余三角高出约 20 个亮度单位，
   而其余三角彼此差 <1。必须先 quantitative 定位再回填背景色，
   否则它会被误判成「主体」，导致构图居中度计算偏移 12.8%。

3. **ffmpeg 的 libvpx-vp9 在本机不支持 alpha** —— 四种参数组合全部输出 `yuv420p`
   （尽管 `-h encoder` 里声明支持 `yuva420p`）。得到的 WebM 是黑底的，已弃用。

4. **ffmpeg 的 libwebp 动画编码有 alpha 累积问题** —— 后续帧存为相对前帧的增量，
   平坦透明区会累积：实测 64px 版角落 alpha 从首帧 2 递增到末帧 77。
   解法：改用 Pillow 编码并显式 `disposal=2`。

5. **闭合裁剪不能靠一次性公式** —— 各状态分辨率/主体尺寸不同，
   缩放到交付尺寸时边缘损失不一致，公式算完实测从 43% 到 75% 参差不齐。
   改为「导出后实测 → 闭环校正」，3 轮内收敛。

6. **低分辨率 mask 放大做 vignette 会引入振铃** —— 用「实心白盘 + 高斯模糊」替代。

7. **Pillow 的 WebP 动画解码不可靠** —— 验证时应改用 ffmpeg 独立解帧交叉验证，
   否则会得出错误结论（曾误判素材脏，实际是解码器问题；也曾差点漏掉编码器的真问题）。
