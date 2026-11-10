"""
从 client.js 的 CSS/SVG 逐帧渲染出三态循环的 GIF（不录屏，纯确定性截图）。

原理：CSS 动画是时间的纯函数。用 document.getAnimations() 把每个动画 pause 到指定
currentTime，Chrome headless 截一帧，就得到任意时刻的精确画面；连续 t 采样即可还原动效。
截图必须加 --run-all-compositor-stages-before-draw，否则会截到过期的合成帧（表现为每帧一样）。

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

CANVAS_W, CANVAS_H = 260, 340      # 故意留大，之后按内容自动裁边
SCALE = 2
STATES = ["work", "tired", "rest"]
FPS = 10
FRAMES_PER_STATE = 12              # 每态 1.2 秒，三态一轮 3.6 秒
COLORS = 72
BG = (18, 17, 24)
PAD = 26                           # 裁边后留白（截图坐标系，即 2x）
OUT_WIDTH = 300                    # 最终 GIF 宽度，太高会拖慢 README 加载

HTML_TMPL = """<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<style>
html,body{{margin:0;padding:0;background:rgb{bg};overflow:hidden;width:{w}px;height:{h}px;}}
body{{display:flex;align-items:center;justify-content:center;}}
</style>
<style>{css}</style>
<style>
/* 预览页专用：把插件里的绝对定位改回文档流；动画统一暂停，时刻由 JS 设定。
   width 固定为设计尺寸，否则三态内容宽度不同会让 flex 居中把标签推来推去。 */
.kc-pet{{position:relative!important;left:auto!important;top:auto!important;margin:0!important;width:168px!important}}
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
        w=CANVAS_W, h=CANVAS_H, bg=BG, css=css, state=state,
        label=labels[state], art=art[state],
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


def union_bbox(imgs, bg):
    """所有帧相对背景的非空区域并集，避免裁边时把某一帧的粒子/气泡切掉。"""
    from PIL import ImageChops

    left = top = 10 ** 9
    right = bottom = -1
    for im in imgs:
        diff = ImageChops.difference(im, Image.new("RGB", im.size, bg))
        bb = diff.getbbox()   # 与背景完全相同的像素为黑，getbbox 直接给出内容外框
        if not bb:
            continue
        left = min(left, bb[0])
        top = min(top, bb[1])
        right = max(right, bb[2])
        bottom = max(bottom, bb[3])
    if right < 0:
        return (0, 0, imgs[0].size[0], imgs[0].size[1])
    return (left, top, right, bottom)


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

        box = union_bbox(imgs, BG)
        box = (max(0, box[0] - PAD), max(0, box[1] - PAD),
               min(size[0], box[2] + PAD), min(size[1], box[3] + PAD))
        print("crop box:", box)
        imgs = [im.crop(box) for im in imgs]

        # 统一缩放到目标宽度（2x 画布缩一半左右，线条依然清楚）
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

        gif_frames = [im.quantize(palette=pal, dither=Image.FLOYDSTEINBERG) for im in imgs]
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
