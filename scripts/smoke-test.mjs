// Headless smoke test: boots the real game modules (main.js) against a stub DOM
// and drives hundreds of frames with movement + attack input. Usage:
//   node scripts/smoke-test.mjs
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");

const gradient = { addColorStop() {} };
const context2d = new Proxy({
  canvas: { width: 960, height: 592 },
  measureText: () => ({ width: 24 }),
  createLinearGradient: () => gradient,
  createRadialGradient: () => gradient,
  setTransform() {},
  save() {},
  restore() {},
}, {
  get(target, property) {
    if (property in target) return target[property];
    if (property === "globalAlpha") return 1;
    return () => undefined;
  },
  set(target, property, value) {
    target[property] = value;
    return true;
  },
});

const elementCache = new Map();
const listeners = { window: new Map() };

function createElement(selector) {
  const element = {
    selector,
    textContent: "",
    title: "",
    hidden: false,
    width: 960,
    height: 592,
    dataset: {},
    listeners: new Map(),
    style: { setProperty() {} },
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(handler);
    },
    removeEventListener() {},
    dispatch(type, event = {}) {
      for (const handler of this.listeners.get(type) ?? []) handler({ preventDefault() {}, ...event });
    },
    setAttribute() {},
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 960, height: 592, top: 0, left: 0 }),
    append() {},
    appendChild() {},
    replaceChildren() {},
    querySelectorAll: () => [],
    getContext: () => context2d,
    setPointerCapture() {},
    releasePointerCapture() {},
    hasPointerCapture: () => false,
    firstElementChild: { textContent: "" },
  };
  return element;
}

function query(selector) {
  if (!elementCache.has(selector)) elementCache.set(selector, createElement(selector));
  return elementCache.get(selector);
}

const bodyElement = createElement("body");

globalThis.document = {
  title: "",
  documentElement: { lang: "" },
  body: bodyElement,
  querySelector: query,
  querySelectorAll: () => [],
  getElementById: (id) => query(`#${id}`),
  createElement: (tagName) => createElement(tagName),
  createElementNS: (namespace, tagName) => createElement(tagName),
  createTextNode: () => createElement("#text"),
  addEventListener() {},
};

const preRenderQueue = [];
let nextFrameTime = 0;

globalThis.window = {
  devicePixelRatio: 2,
  localStorage: { getItem: () => null, setItem() {} },
  location: { reload() {} },
  addEventListener(type, handler) {
    if (!listeners.window.has(type)) listeners.window.set(type, []);
    listeners.window.get(type).push(handler);
  },
  removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  requestAnimationFrame(callback) {
    preRenderQueue.push(callback);
    return preRenderQueue.length;
  },
  cancelAnimationFrame() {},
  AudioContext: class {
    constructor() {
      this.currentTime = 0;
      this.destination = {};
    }

    createOscillator() {
      return {
        type: "square",
        frequency: { setValueAtTime() {} },
        connect() {},
        start() {},
        stop() {},
      };
    }

    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
    }
  },
};

globalThis.HTMLElement = class HTMLElement {};
globalThis.performance = { now: () => nextFrameTime };

// Pin the battle seed so the frame-for-frame outcome (and therefore the score
// assertions below) is reproducible. Override with H5_SEED=<number> to explore
// other runs; the same value works in a browser via `?seed=<number>`.
const seed = process.env.H5_SEED ?? "1";
globalThis.location = { search: `?seed=${seed}` };

function dispatchWindow(type, event) {
  for (const handler of listeners.window.get(type) ?? []) handler({ preventDefault() {}, target: {}, ...event });
}

function runFrames(frameCount) {
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    nextFrameTime += 16.7;
    const callbacks = preRenderQueue.splice(0);
    if (callbacks.length === 0) throw new Error(`Game loop stopped scheduling frames after ${frameIndex} frames.`);
    for (const callback of callbacks) callback(nextFrameTime);
  }
}

const failures = [];
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures.push(`${label}${detail ? ` (${detail})` : ""}`);
    console.log(`  FAIL ${label}${detail ? ` (${detail})` : ""}`);
  }
}

console.log("[smoke] booting main.js against the stub DOM");
const loggedErrors = [];
const originalError = console.error;
console.error = (...args) => {
  loggedErrors.push(args.map((value) => (value instanceof Error ? value.stack : String(value))).join(" "));
  originalError(...args);
};

await import(pathToFileURL(resolve(projectRoot, "src/main.js")).href);
check("boot scheduled the first frame", preRenderQueue.length > 0);
check("boot reported no errors", loggedErrors.length === 0, loggedErrors[0]);

runFrames(3);
query("#menu-start").dispatch("click");
check("menu start begins a battle", query("#battle-screen").hidden === false);

// Roam and fire: the chariot turns, rams, and volleys so formations, projectiles,
// collision damage, drops, and HUD updates all execute.
for (const [frameBlock, key] of [[120, "w"], [120, "a"], [120, "w"], [120, "d"], [120, "s"], [120, "w"], [180, "d"]]) {
  dispatchWindow("keydown", { key });
  dispatchWindow("keydown", { key: " " });
  runFrames(frameBlock);
  dispatchWindow("keyup", { key });
}

check("game loop still schedules frames", preRenderQueue.length > 0);
check("no runtime errors during combat", loggedErrors.length === 0, loggedErrors[0]);
check("battle screen still active", query("#battle-screen").hidden === false);
check("score advanced past zero", query("#score").textContent !== "00000", `score=${query("#score").textContent}`);
check("battle progressed (objective/extraction/shop reached)",
  query("#objective-count").textContent.includes(" / ")
    || query("#extraction-guide").hidden === false
    || query("#shop-screen").hidden === false,
  `objective=${query("#objective-count").textContent} shopHidden=${query("#shop-screen").hidden}`);
check("wave counter rendered", query("#wave").textContent.length > 0, `wave=${query("#wave").textContent}`);

// The debug handle the game publishes lets the harness assert on live battle
// state instead of trusting HUD text alone.
const game = globalThis.__h5game;
check("debug handle exposes the running battle", Boolean(game?.state) && game.state.mode === "running", `mode=${game?.state?.mode}`);
check("battle time advanced", (game?.state.elapsed ?? 0) > 12, `elapsed=${(game?.state.elapsed ?? 0).toFixed(1)}`);
check("formations spawned enemies", (game?.state.enemies.length ?? 0) > 0, `enemies=${game?.state.enemies.length}`);
check("enemy positions are finite", (game?.state.enemies ?? []).every((enemy) => Number.isFinite(enemy.x) && Number.isFinite(enemy.y)),
  `first=${game?.state.enemies?.[0]?.x},${game?.state.enemies?.[0]?.y}`);
check("player state stayed finite", Number.isFinite(game?.player.x) && Number.isFinite(game?.player.y)
  && Number.isFinite(game?.player.health), `player=${game?.player.x},${game?.player.y} health=${game?.player.health}`);

// Pause/resume via the in-battle button exercises the screens wiring.
query("#start-button").dispatch("click");
runFrames(30);
query("#start-button").dispatch("click");
runFrames(60);

// Sound toggle + locale switch exercise the UI wiring that touches the shop.
query("#sound-button").dispatch("click");
const select = query("#locale-select");
select.dispatch("change");
runFrames(60);

check("no errors after UI interactions", loggedErrors.length === 0, loggedErrors[0]);
console.log(failures.length === 0 ? "\n[smoke] PASS" : `\n[smoke] FAIL: ${failures.join("; ")}`);
process.exitCode = failures.length === 0 ? 0 : 1;
