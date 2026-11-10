/**
 * 本地视觉预览：从 client.js 里取出同一份 SVG/CSS，生成可截图的 preview.html。
 * 只用于开发期检查画面，不参与插件运行。
 *
 *   node tools/preview.mjs
 *   chrome --headless=new --screenshot=... tools/preview.html
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const clientPath = join(root, "lib", "client.js");
const outPath = join(root, "tools", "preview.html");

let registration = null;
const sandbox = {
  console,
  window: {
    __ModuleLoader__: {
      load(entry) {
        registration = entry;
      },
    },
  },
};
vm.createContext(sandbox);
vm.runInContext(readFileSync(clientPath, "utf8"), sandbox, { filename: clientPath });

const ReactStub = {
  createElement() {
    return null;
  },
  useState(value) {
    return [typeof value === "function" ? value() : value, () => {}];
  },
  useEffect() {},
  useRef() {
    return { current: null };
  },
};
const api = registration.factory((id) => {
  if (id === "react") return ReactStub;
  throw new Error("unexpected require: " + id);
});
const { ART, CSS, LABELS } = api.__test;

const states = ["work", "tired", "rest"];

function pet(state) {
  return `
  <div class="kc-pet" data-state="${state}">
    <div class="kc-top">
      <span class="kc-bubble"><span class="kc-dot"></span><span class="kc-label">${LABELS[state]}</span></span>
    </div>
    <div class="kc-stage" role="button" tabindex="0">
      <div class="kc-scene">
        <svg viewBox="0 0 160 180" class="kc-svg" aria-hidden="true">${ART[state]}</svg>
      </div>
    </div>
  </div>`;
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>克莱恩猫 · 预览</title>
<style>
  html,body{margin:0;font-family:"Segoe UI","Microsoft YaHei",sans-serif;}
  .board{padding:18px 24px 26px;}
  .board.dark{background:radial-gradient(120% 90% at 20% 0%,#211f2c 0%,#121118 55%,#0a0910 100%);}
  .board.light{background:linear-gradient(180deg,#f7f3ec,#e9e2d7);}
  .board h2{margin:0 0 2px;font-size:12px;font-weight:600;letter-spacing:.12em;opacity:.65}
  .board.dark h2{color:#cfc7b8}
  .board.light h2{color:#6b6156}
  .row{display:flex;gap:14px;align-items:flex-end}
  .row .kc-pet{position:relative!important;left:auto!important;top:auto!important;margin:8px 6px 0}
  .hint{margin:6px 0 0;font-size:11px;opacity:.45}
  .board.dark .hint{color:#bdb5a6}
  .board.light .hint{color:#7a7064}
</style>
<style>${CSS}</style>
</head>
<body>
  <section class="board dark">
    <h2>DARK THEME · 三态预览</h2>
    <div class="row">${states.map(pet).join("")}</div>
    <p class="hint">点击态：占卜铃音 / 呼噜 / 吸饮料（预览页不播放声音）</p>
  </section>
  <section class="board light">
    <h2>LIGHT THEME · 三态预览</h2>
    <div class="row">${states.map(pet).join("")}</div>
  </section>
</body>
</html>`;

writeFileSync(outPath, html, "utf8");
console.log("preview written:", outPath);
