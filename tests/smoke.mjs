import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkgPath = join(root, "package.json");
const patchPath = join(root, "cordis.patch.yml");
const clientPath = join(root, "lib", "client.js");
const hostPath = join(root, "lib", "index.js");

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
assert.equal(pkg.name, "dsh-klein-cat-pet");
assert.equal(pkg.type, "module");
assert.equal(pkg.main, "lib/index.js");
assert.equal(pkg.exports["./client"], "./lib/client.js");
assert.equal(pkg.dsh.client.platform, "web");
assert.equal(pkg.dsh.bundle.patch, "./cordis.patch.yml");
assert.equal(pkg.dsh.manifestVersion, 1);

const patch = readFileSync(patchPath, "utf8");
assert.match(patch, /insert:/);
assert.match(patch, /id:\s*klein-cat-pet/);
assert.match(patch, /name:\s*dsh-klein-cat-pet/);

for (const file of [clientPath, hostPath]) {
  assert.ok(readFileSync(file, "utf8").length > 0, "empty file: " + file);
}
// 语法检查：下面的 vm.runInContext 会编译 client.js（SyntaxError 会直接抛出）；
// index.js 是 ESM，用动态 import 让 Node 自己校验。
await import(new URL("../lib/index.js", import.meta.url).href);

const client = readFileSync(clientPath, "utf8");
assert.match(client, /window\.__ModuleLoader__\.load\(/);
assert.match(client, /id:\s*"dsh-klein-cat-pet"/);
assert.match(client, /@keyframes kc-bob/);
assert.match(client, /prefers-reduced-motion/);
assert.match(client, /__test/);

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
vm.runInContext(client, sandbox, { filename: clientPath });

assert.ok(registration, "bundle did not register a module");
assert.equal(registration.id, "dsh-klein-cat-pet");

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

assert.equal(api.name, "dsh-klein-cat-pet");
assert.ok(Array.isArray(api.inject));
assert.ok(api.inject.includes("slots"));
assert.equal(typeof api.apply, "function");

const t = api.__test;
assert.ok(t, "missing __test surface");
assert.deepEqual(Array.from(t.STATES), ["work", "tired", "rest"]);
assert.equal(t.nextState("work"), "tired");
assert.equal(t.nextState("tired"), "rest");
assert.equal(t.nextState("rest"), "work");
assert.equal(t.nextState("bogus"), "work");
assert.equal(t.clamp01(2), 1);
assert.equal(t.clamp01(-3), 0);
assert.equal(t.clamp01(NaN), 1);

const normalized = t.normalize({
  state: "rest",
  xPct: 0.25,
  yPct: 2,
  muted: true,
  visible: false,
});
assert.deepEqual(JSON.parse(JSON.stringify(normalized)), {
  state: "rest",
  xPct: 0.25,
  yPct: 1,
  muted: true,
  visible: false,
});

const fallback = t.normalize(null);
assert.equal(fallback.state, "work");
assert.equal(fallback.xPct, 1);
assert.equal(fallback.yPct, 1);
assert.equal(fallback.muted, false);
assert.equal(fallback.visible, true);

const atTopLeft = t.layout({ xPct: 0, yPct: 0 }, 1280, 800);
assert.equal(atTopLeft.left, t.MARGIN);
assert.equal(atTopLeft.top, t.MARGIN);
const atBottomRight = t.layout({ xPct: 1, yPct: 1 }, 1280, 800);
assert.equal(atBottomRight.left, 1280 - t.PET_W - t.MARGIN);
assert.equal(atBottomRight.top, 800 - t.PET_H - t.MARGIN);

for (const state of t.STATES) {
  assert.ok(t.ART[state] && t.ART[state].length > 500, "missing art: " + state);
  assert.ok(t.LABELS[state], "missing label: " + state);
}

// 生命周期接线：用 mock ctx/document 真正跑一遍 apply，捕获槽位注册与错误
const registered = [];
const styleElement = {
  setAttribute() {},
  textContent: "",
  parentNode: null,
};
sandbox.document = {
  createElement() {
    return styleElement;
  },
  head: {
    appendChild() {},
    removeChild() {},
  },
};
sandbox.window.addEventListener = () => {};
sandbox.window.removeEventListener = () => {};
sandbox.window.localStorage = {
  getItem: () => null,
  setItem: () => {},
};
sandbox.window.innerWidth = 1280;
sandbox.window.innerHeight = 800;

const disposers = [];
const ctx = {
  effect(fn) {
    const dispose = fn();
    disposers.push(dispose);
    return dispose;
  },
  slots: {
    inject(_key, callback) {
      return callback();
    },
    register(options, component) {
      registered.push({ options, component });
      return () => {};
    },
  },
};

api.apply(ctx);
assert.equal(registered.length, 2, "expected overlay + sidebar registrations");
assert.equal(registered[0].options.name, "shell.overlay");
assert.equal(registered[0].options.id, "klein-cat-pet");
assert.equal(registered[1].options.name, "sidebar.footer.action");

const store = registered[0].options.inject().store;
assert.ok(store);
assert.equal(store.get().state, "work");

// 渲染路径：用 hook stub 调用组件，确认不缺任何运行时依赖
const element = registered[0].component({ store });
assert.equal(element, null); // h() stub 返回 null
const paw = registered[1].component({ store });
assert.equal(paw, null);

console.log("klein-cat-pet smoke: ok");
