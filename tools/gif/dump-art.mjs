/**
 * 把 client.js 里的 CSS / ART / LABELS 抽成 JSON，供截图脚本使用。
 * 用法：node dump-art.mjs <client.js> <out.json>
 */
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";

const [clientPath, outPath] = process.argv.slice(2);

let registration = null;
const sandbox = {
  console,
  window: { __ModuleLoader__: { load(entry) { registration = entry; } } },
};
vm.createContext(sandbox);
vm.runInContext(readFileSync(clientPath, "utf8"), sandbox, { filename: clientPath });

const ReactStub = {
  createElement: () => null,
  useState: (v) => [typeof v === "function" ? v() : v, () => {}],
  useEffect() {},
  useRef: () => ({ current: null }),
};
const api = registration.factory((id) => {
  if (id === "react") return ReactStub;
  throw new Error("unexpected require: " + id);
});

const { ART, CSS, LABELS } = api.__test;
writeFileSync(outPath, JSON.stringify({ CSS, ART, LABELS }), "utf8");
console.log("dumped states:", Object.keys(ART).join(", "), "| css bytes:", CSS.length);
