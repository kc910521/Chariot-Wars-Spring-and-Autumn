// Headless smoke test: boots the real game modules (main.js) against a stub DOM
// and drives hundreds of frames with movement + attack input. Usage:
//   node scripts/smoke-test.mjs
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");

// A canvas call with a non-finite argument is the visible symptom of a poisoned
// transform: nothing on a real device can rasterise NaN, and on 小游戏 it is what
// ran the iPhone X out of memory. The stub used to answer every method with
// `() => undefined`, which made those calls completely invisible.
const nonFiniteDraws = [];

function noteNonFinite(name, args) {
  nonFiniteDraws.push(`${name}(${args.map((value) => String(value)).join(", ")})`);
}

function checkNumbers(name, args) {
  for (const value of args) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      noteNonFinite(name, args);
      return;
    }
  }
}

// Geometry entry points: any coordinate here ends up in the rasteriser.
const geometryCalls = new Set([
  "translate", "rotate", "scale", "transform", "setTransform", "resetTransform",
  "arc", "arcTo", "ellipse", "rect", "fillRect", "strokeRect", "clearRect",
  "moveTo", "lineTo", "quadraticCurveTo", "bezierCurveTo",
  "fillText", "strokeText", "drawImage",
]);

// Numeric style state: globalAlpha = NaN makes the whole draw a no-op, and a NaN
// lineWidth is rejected by some engines outright.
const numericStyles = new Set([
  "globalAlpha", "lineWidth", "miterLimit", "shadowBlur", "shadowOffsetX", "shadowOffsetY",
]);

const gradient = {
  addColorStop(offset, color) {
    checkNumbers("addColorStop", [offset]);
    void color;
  },
};

const context2d = new Proxy({
  canvas: { width: 960, height: 592 },
  measureText: () => ({ width: 24 }),
  createLinearGradient: (...args) => {
    checkNumbers("createLinearGradient", args);
    return gradient;
  },
  createRadialGradient: (...args) => {
    checkNumbers("createRadialGradient", args);
    return gradient;
  },
  save() {},
  restore() {},
}, {
  get(target, property) {
    if (property in target) return target[property];
    if (property === "globalAlpha") return 1;
    if (geometryCalls.has(property)) {
      return (...args) => {
        checkNumbers(String(property), args);
        return undefined;
      };
    }
    return () => undefined;
  },
  set(target, property, value) {
    if (numericStyles.has(property) && typeof value === "number" && !Number.isFinite(value)) {
      noteNonFinite(String(property), [value]);
    }
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

// Browsers expose the frame source on the global object as well as on `window`,
// and the loop deliberately resolves it from `globalThis` so one file can run
// both in the browser and inside 小游戏.
globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
globalThis.cancelAnimationFrame = globalThis.window.cancelAnimationFrame;

// Note what is deliberately NOT stubbed: `performance`. It used to be faked as
// `{ now: () => nextFrameTime }`, which made it agree with the frame clock and
// therefore hid the exact defect this harness now guards — stages.js stamped
// `state.lastTime` with `performance.now()`, and on a runtime where that clock
// differs from the rAF timestamp the first delta of a battle came out at about
// -1.8e9. Node's real `performance` is a *foreign* clock, so any code that
// reaches for it is caught by the clock-contract check below.

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
const game = globalThis.__h5game;
check("boot scheduled the first frame", preRenderQueue.length > 0);
check("boot reported no errors", loggedErrors.length === 0, loggedErrors[0]);

// The camera is the first thing a poisoned clock destroys: it consumes the frame
// delta directly, and once it is NaN every inView() is false and every translate
// is non-finite.
function checkCamera(label) {
  const { camera, world, view } = game;
  const maxX = world.width - view.width;
  const maxY = world.height - view.height;
  check(
    `${label}: camera stays finite and inside the world`,
    Number.isFinite(camera.x) && Number.isFinite(camera.y)
      && camera.x >= -1 && camera.x <= maxX + 1
      && camera.y >= -1 && camera.y <= maxY + 1,
    `camera=${camera.x},${camera.y} bounds=${maxX}x${maxY}`,
  );
}

runFrames(3);
// The click handler runs beginMission() synchronously, so this is the one moment
// at which a module stamping a second clock is still observable: the loop rewrites
// state.lastTime on its very next frame. Equality with the harness's frame time is
// the whole contract — the loop is the only writer of the time base.
query("#menu-start").dispatch("click");
check(
  "beginMission leaves the loop's time base alone",
  game.state.lastTime === nextFrameTime,
  `lastTime=${game.state.lastTime} frameClock=${nextFrameTime}`,
);
check("menu start begins a battle", query("#battle-screen").hidden === false);
checkCamera("battle start");

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
check("debug handle exposes the running battle", Boolean(game?.state) && game.state.mode === "running", `mode=${game?.state?.mode}`);
check("battle time advanced", (game?.state.elapsed ?? 0) > 12, `elapsed=${(game?.state.elapsed ?? 0).toFixed(1)}`);
check("battle clock stayed finite", Number.isFinite(game?.state.elapsed) && Number.isFinite(game?.state.lastTime),
  `elapsed=${game?.state.elapsed} lastTime=${game?.state.lastTime}`);
check("formations spawned enemies", (game?.state.enemies.length ?? 0) > 0, `enemies=${game?.state.enemies.length}`);
check("enemy positions are finite", (game?.state.enemies ?? []).every((enemy) => Number.isFinite(enemy.x) && Number.isFinite(enemy.y)),
  `first=${game?.state.enemies?.[0]?.x},${game?.state.enemies?.[0]?.y}`);
check("player state stayed finite", Number.isFinite(game?.player.x) && Number.isFinite(game?.player.y)
  && Number.isFinite(game?.player.health), `player=${game?.player.x},${game?.player.y} health=${game?.player.health}`);
checkCamera("after the combat run");
check("no non-finite geometry reached the canvas", nonFiniteDraws.length === 0, nonFiniteDraws.slice(0, 3).join(" | "));

// Pause/resume via the in-battle button exercises the screens wiring.
query("#start-button").dispatch("click");
runFrames(30);
query("#start-button").dispatch("click");
check(
  "resuming a battle leaves the loop's time base alone",
  game.state.lastTime === nextFrameTime,
  `lastTime=${game.state.lastTime} frameClock=${nextFrameTime}`,
);
runFrames(60);

// Sound toggle + locale switch exercise the UI wiring that touches the shop.
query("#sound-button").dispatch("click");
const select = query("#locale-select");
select.dispatch("change");
runFrames(60);

check("no errors after UI interactions", loggedErrors.length === 0, loggedErrors[0]);
checkCamera("after UI interactions");
check("no non-finite geometry after UI interactions", nonFiniteDraws.length === 0, nonFiniteDraws.slice(0, 3).join(" | "));
console.log(failures.length === 0 ? "\n[smoke] PASS" : `\n[smoke] FAIL: ${failures.join("; ")}`);
process.exitCode = failures.length === 0 ? 0 : 1;
