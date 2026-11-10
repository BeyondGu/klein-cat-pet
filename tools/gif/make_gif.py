"""
从 client.js 的 CSS/SVG 逐帧渲染出三态循环的 GIF（不录屏，纯确定性截图）。

原理：CSS 动画是时间的纯函数。用 document.getAnimations() 把每个动画 pause 到指定
currentTime，Chrome headless 截一帧，就得到任意时刻的精确画面；连续 t 采样即可还原动效。
截图必须加 --run-all-compositor-stages-before-draw，否则会截到过期的合成帧（表现为每帧一样）。

取景：按实机尺寸固定裁框（.kc-pet 168×219 再外扩 MARGIN_CSS 让辉光/粒子露出来），
输出 2 倍宽即 336px，比例与桌面上那只猫一致，不会因不同帧内容多少而变化。

帧率 20fps（GIF 延时以 10ms 为单位，50ms 正好整除，多数浏览器不会舍入走样）。

用法（在仓库根目录执行）：
  node tools/gif/dump-art.mjs lib/client.js art.json
  python tools/gif/make_gif.py art.json docs/preview.gif

依赖：Python 3 + Pillow；Chrome 装在默认位置即可，或用环境变量 CHROME_PATH 指定。
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

CHROME = os.environ.get("CHROME_PATH") or r"C:\Program Files\Google\Chrome\Application\chrome.exe"
if not Path(CHROME).exists():
    sys.exit(f"找不到 Chrome：{CHROME}\n请设置环境变量 CHROME_PATH 指向 chrome.exe")

CANVAS_W, CANVAS_H = 260, 340      # 画布留大，给辉光/粒子溢出空间；取景框另行固定
SCALE = 2                          # 设备像素比，先 2x 再缩，线条更干净
STATES = ["work", "tired", "rest"]
FPS = 20                           # 50ms/帧，整除 GIF 的 10ms 延时单位
FRAMES_PER_STATE = 18              # 每态 0.9 秒，三态一轮 2.7 秒
COLORS = 96                        # 深色底渐变容易出色带，比 72 多留一些
BG = (18, 17, 24)                  # DSH 深色面板色的近似值（实机是透明浮层，见 README 说明）
DITHER = Image.NONE                # 开抖动（FLOYDSTEINBERG）体积会翻一倍多，96 色足够平滑
OUT_WIDTH = 336                    # 实机 168px 宽的 2 倍
# 实机尺寸（与 lib/client.js 一致）：宽 168，高 = .kc-top 30 + .kc-stage 189
PET_W, PET_H = 168, 219
MARGIN_CSS = 12                    # 取景框外扩，露出法阵/粒子/阴影
LEFT = (CANVAS_W - PET_W) // 2
TOP = (CANVAS_H - PET_H) // 2

HTML_TMPL = """<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<style>
html,body{{margin:0;padding:0;background:rgb{bg};overflow:hidden;width:{w}px;height:{h}px;}}
body{{position:relative;}}
</style>
<style>{css}</style>
<style>
/* 预览页专用：把插件里的 position:fixed 改成按固定坐标绝对定位，取景框因此可精确预测。
   width 固定为设计尺寸，否则三态内容宽度不同会把标签推来推去。 */
.kc-pet{{position:absolute!important;left:{left}px!important;top:{top}px!important;
         margin:0!important;width:{petw}px!important}}
*{{animation-play-state:paused!important}}
</style>
</head>
<body>
<div class="kc-pet" data-state="{state}">
  <div class="kc-top">
    <span class="kc-bubble"><span class="kc-dot"></span><span class="kc-label">{label}</span></span>
  </div>
  <div class="kc-stage" role="button" tabindex="0">
    <div class="kc-scene">
      <svg viewBox="0 0 160 180" class="kc-svg" aria-hidden="true">{art}</svg>
    </div>
  </div>
</div>
<script>
(function () {{
  var t = parseFloat(new URLSearchParams(location.search).get('t') || '0');
  function freeze() {{
    var list = document.getAnimations ? document.getAnimations() : [];
    for (var i = 0; i < list.length; i++) {{
      try {{ list[i].pause(); list[i].currentTime = t * 1000; }} catch (e) {{}}
    }}
  }}
  freeze();
  document.addEventListener('readystatechange', freeze);
  window.addEventListener('load', freeze);
  setTimeout(freeze, 0);
  setTimeout(freeze, 60);
}})();
</script>
</body></html>
"""


def render_frame(png_path, state, t, art, css, labels, tmpdir, profile):
    html = HTML_TMPL.format(
        w=CANVAS_W, h=CANVAS_H, bg=BG, css=css, state=state, label=labels[state],
        art=art[state], left=LEFT, top=TOP, petw=PET_W,
    )
    html_path = os.path.join(tmpdir, f"f_{state}_{t:.3f}.html")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)
    url = "file:///" + html_path.replace("\\", "/") + f"?t={t:.4f}"
    subprocess.run(
        [
            CHROME,
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            "--no-first-run",
            "--no-default-browser-check",
            "--run-all-compositor-stages-before-draw",
            f"--user-data-dir={profile}",
            f"--force-device-scale-factor={SCALE}",
            f"--window-size={CANVAS_W},{CANVAS_H}",
            "--virtual-time-budget=1200",
            f"--screenshot={png_path}",
            url,
        ],
        check=True,
        capture_output=True,
        timeout=90,
    )


def frame_box():
    """固定取景框（截图坐标系 = 2x）：实机 .kc-pet 外扩 MARGIN_CSS。"""
    m = MARGIN_CSS * SCALE
    left, top = LEFT * SCALE, TOP * SCALE
    return (max(0, left - m), max(0, top - m),
            min(CANVAS_W * SCALE, (LEFT + PET_W) * SCALE + m),
            min(CANVAS_H * SCALE, (TOP + PET_H) * SCALE + m))


def main():
    art_json, out_gif = sys.argv[1], sys.argv[2]
    with open(art_json, encoding="utf-8") as f:
        data = json.load(f)
    art, css, labels = data["ART"], data["CSS"], data["LABELS"]

    tmpdir = tempfile.mkdtemp(prefix="kc-gif-")
    profile = os.path.join(tmpdir, "profile")
    try:
        paths = []
        step = 1.0 / FPS
        for state in STATES:
            for i in range(FRAMES_PER_STATE):
                t = i * step
                png = os.path.join(tmpdir, f"{state}_{i:02d}.png")
                render_frame(png, state, t, art, css, labels, tmpdir, profile)
                if not os.path.exists(png):
                    raise RuntimeError(f"截图失败：{state} t={t}")
                paths.append(png)
        print(f"captured {len(paths)} frames")

        imgs = [Image.open(p).convert("RGB") for p in paths]
        size = imgs[0].size
        uniq = len({hash(im.tobytes()) for im in imgs})
        print(f"canvas {size} | unique frames {uniq}/{len(imgs)}")
        if uniq <= len(STATES):
            raise RuntimeError("每态只有一帧不同：动画没被冻结到不同时刻")

        box = frame_box()
        print("crop box:", box)
        imgs = [im.crop(box) for im in imgs]

        # 缩到实机宽度的 2 倍（截图已是 2x，这里再微调到目标宽度）
        cw, ch = imgs[0].size
        tw = OUT_WIDTH
        th = int(round(ch * tw / cw))
        imgs = [im.resize((tw, th), Image.LANCZOS) for im in imgs]
        print(f"output {tw}x{th}")

        # 全局调色板：所有帧拼成一张长图统一量化，避免逐帧各自调色板导致体积暴涨
        montage = Image.new("RGB", (tw * len(imgs), th))
        for i, im in enumerate(imgs):
            montage.paste(im, (i * tw, 0))
        pal = montage.quantize(colors=COLORS, method=Image.MEDIANCUT)
        del montage

        gif_frames = [im.quantize(palette=pal, dither=DITHER) for im in imgs]
        gif_frames[0].save(
            out_gif,
            format="GIF",
            save_all=True,
            append_images=gif_frames[1:],
            duration=int(1000 / FPS),
            loop=0,
            optimize=True,
            disposal=1,
        )
        kb = os.path.getsize(out_gif) / 1024
        print(f"written: {out_gif}  ({kb:.0f} KB, {len(gif_frames)} frames, {tw}x{th})")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    main()
