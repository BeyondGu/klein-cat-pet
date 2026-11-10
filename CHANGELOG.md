# 变更记录

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增

- `docs/preview.gif`：三态动效预览，README 首图。
- `tools/gif/`：把 CSS 动画冻结到指定 `currentTime` 逐帧截图再合成 GIF 的脚本（非录屏，可精确复现）。

### 计划中（v0.2）

- 联动「AI 是否正在生成」自动切换状态，不再只靠手动点击。
- 宿主半增加本地设置文件，让位置/静音跨 DSH 重启保留（不再依赖 `localStorage` 的端口级 origin）。
- 可选真实录音音效：支持放入 `assets/*.wav|mp3` 后优先播放，缺失时回落到代码合成。
- 新增第 4 种状态的成本收敛：把 `STATES / ART / LABELS / HINTS` 四张表抽成独立数据模块。

## [0.1.0] - 2026-11-10

### 新增

- 三状态宠物（努力工作中 / 累了 / 休息中），点击本体循环切换。
- 每状态独立 SVG 手绘画面、循环动效与 Web Audio 合成音效，无外部素材、无网络请求。
- `shell.overlay` 浮层挂载 + `sidebar.footer.action` 侧边栏猫爪入口。
- 拖动定位（百分比存储，窗口缩放后仍可点）、悬停工具栏（静音 / 复位 / 隐藏）。
- `localStorage` 持久化 `{state,xPct,yPct,muted,visible}`，同源标签页间保留。
- 降级路径：`prefers-reduced-motion` 停循环动画，`AudioContext` / `localStorage` 不可用时静默回落。
- `tests/smoke.mjs` 冒烟测试与 `tools/preview.mjs` 三态预览页生成。
- GitHub Actions：CI 冒烟 + 打 tag 自动出 Release zip。
