// Headless smoke test: boots the real game modules (main.js) against a stub DOM
// and drives hundreds of frames with movement + attack input. Usage:
//   node scripts/smoke-test.mjs
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { campaignRules, effectRules, projectileRules } from "../src/data/rules.js";
import { equipment } from "../src/data/equipment.js";
import { formationPresets, formationRules, formationTiers } from "../src/data/formations.js";

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

// Moving a draw branch is as easy to get wrong as moving an AI branch, and the
// assertions above cannot see it: a helmet drawn after the spear instead of
// before still passes every check. With H5_TRACE_DRAW=1 every canvas call and
// every style write is folded into one digest, so a refactor that is supposed to
// be pure code motion can be proven byte-identical (same seed, same frames).
const drawHash = process.env.H5_TRACE_DRAW === "1" ? createHash("sha256") : null;
const drawLog = [];
let drawCalls = 0;
function recordDraw(text) {
  if (!drawHash) return;
  drawHash.update(`${text}\n`);
  drawCalls += 1;
  if (process.env.H5_TRACE_DRAW_LOG) drawLog.push(text);
}

// The screen shake is the one value in the game that is deliberately random
// (`Math.random`, so two hull hits never jitter identically). A byte-for-byte
// draw comparison needs it reproducible, so a traced run swaps in one fixed
// sequence - the game itself is untouched.
if (drawHash) {
  let shakeSeed = 0x9e3779b9;
  Math.random = () => {
    shakeSeed = (shakeSeed * 1664525 + 1013904223) >>> 0;
    return shakeSeed / 0x100000000;
  };
}

const gradient = {
  addColorStop(offset, color) {
    checkNumbers("addColorStop", [offset]);
    recordDraw(`addColorStop(${offset},${color})`);
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
        recordDraw(`${String(property)}(${args.join(",")})`);
        return undefined;
      };
    }
    return (...args) => {
      recordDraw(`${String(property)}(${args.join(",")})`);
      return undefined;
    };
  },
  set(target, property, value) {
    if (numericStyles.has(property) && typeof value === "number" && !Number.isFinite(value)) {
      noteNonFinite(String(property), [value]);
    }
    recordDraw(`${String(property)}=${value}`);
    target[property] = value;
    return true;
  },
});

const elementCache = new Map();
const listeners = { window: new Map() };

function createElement(selector) {
  const styleProps = new Map();
  const classes = new Set();
  const element = {
    selector,
    textContent: "",
    title: "",
    hidden: false,
    width: 960,
    height: 592,
    dataset: {},
    listeners: new Map(),
    // Children are recorded (not rendered) so a test can walk the tree the game
    // built - the shop ledger is the one screen whose behaviour is a DOM tree:
    // which card is hovered, what the info panel is showing, which tab is open.
    children: [],
    // Enough of CSSOM to prove the HUD actually drives the draw meter: the ring is
    // a `--charge` custom property and one `.charged` class (styles/game.css).
    style: {
      setProperty(name, value) { styleProps.set(name, String(value)); },
      getPropertyValue: (name) => styleProps.get(name) ?? "",
    },
    classList: {
      toggle(name, force) {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) classes.add(name); else classes.delete(name);
      },
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    },
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
    append(...nodes) { this.children.push(...nodes); },
    appendChild(node) {
      this.children.push(node);
      return node;
    },
    replaceChildren(...nodes) {
      this.children.length = 0;
      this.children.push(...nodes);
    },
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

// The smoke device's local storage: a Map behind the Web Storage API. The
// post-victory rest is the one value that has to outlive a boot, so the harness
// keeps it the way a browser would - as strings, one per key.
const deviceStorage = new Map();

globalThis.window = {
  devicePixelRatio: 2,
  localStorage: {
    getItem: (key) => (deviceStorage.has(key) ? deviceStorage.get(key) : null),
    setItem(key, value) { deviceStorage.set(key, String(value)); },
    removeItem(key) { deviceStorage.delete(key); },
  },
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
};

globalThis.HTMLElement = class HTMLElement {};

// Note what is deliberately NOT stubbed: `AudioContext` / `Audio` / `fetch`. The
// sound player probes for a decoder (src/platform/audio.js) and goes silent, once,
// when the host has none, which is what this harness has to prove: a battle must
// run every frame with no audio device at all. It used to be faked here with a
// createOscillator stub, which only existed to keep the old playTone() alive.

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

// A behaviour refactor can only be called behaviour-preserving if the simulation
// is bit-identical before and after, and "the checks still pass" cannot show that:
// a moved branch that rounds one coordinate differently still passes every
// assertion. With H5_TRACE=1 the harness therefore folds every value the
// simulation owns into one hash, frame by frame. Two runs of the same seed must
// print the same digest; H5_TRACE_LOG=<path> also writes the per-frame values so
// the first divergent frame can be diffed field by field.
//
// Values are stringified with their shortest round-trip form, so the comparison is
// exact rather than rounded: `toFixed` would hide the sub-pixel drift this is
// meant to catch.
const traceEnabled = process.env.H5_TRACE === "1";
const traceHash = traceEnabled ? createHash("sha256") : null;
const traceLog = [];
const TRACE_STATE_NUMBERS = [
  "elapsed", "score", "kills", "wave", "spawnTimer", "formationsSpawned",
  "bossWarningTimer", "objectiveTarget", "shake",
];
const TRACE_UNIT_NUMBERS = ["x", "y", "angle", "speed", "health", "cooldown", "invulnerable"];
// The dismounted companion carries its own snapshot of the personnel row, and
// every one of those numbers decides where its next arrow goes: without them a
// crew refactor that mixed up rows would still hash identically.
const TRACE_COMPANION_NUMBERS = [
  "x", "y", "angle", "health", "damage", "range", "cooldown", "attackCooldown",
  "invulnerable", "hitFlash", "knockedDown",
];
const TRACE_ENEMY_NUMBERS = [
  "x", "y", "angle", "health", "knockedDown", "idleTimer", "idleTarget",
  "searchTimer", "sweepTimer", "attackCooldown", "shotCooldown", "contactCooldown",
  "lastSeenX", "lastSeenY",
];

function pushNumbers(parts, object, keys) {
  for (const key of keys) parts.push(object?.[key]);
}

function frameFingerprint() {
  const game = globalThis.__h5game;
  if (!game) return "boot";
  const { state, player, campaign } = game;
  const parts = [state.mode, state.phase, player.mode];
  pushNumbers(parts, state, TRACE_STATE_NUMBERS);
  pushNumbers(parts, player, TRACE_UNIT_NUMBERS);
  for (const enemy of state.enemies) {
    parts.push(enemy.type, enemy.seesPlayer);
    pushNumbers(parts, enemy, TRACE_ENEMY_NUMBERS);
  }
  for (const formation of state.formations) parts.push(formation.id, formation.x, formation.y);
  for (const drop of state.drops) parts.push(drop.type, drop.x, drop.y, drop.value, drop.life);
  for (const bullet of state.bullets) parts.push(bullet.kind, bullet.x, bullet.y, bullet.z);
  for (const companion of state.footCompanions) {
    parts.push(companion.type, companion.destroyed);
    pushNumbers(parts, companion, TRACE_COMPANION_NUMBERS);
  }
  // The roster is the mounted crew: its cooldowns are the only state the volley
  // keeps between frames.
  for (const member of campaign.roster) {
    parts.push(member.id, member.role, member.alive);
    pushNumbers(parts, member, ["cooldown"]);
  }
  for (const particle of state.particles) parts.push(particle.x, particle.y, particle.life);
  return parts.join(",");
}

function runFrames(frameCount, afterFrame = null) {
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    nextFrameTime += 16.7;
    const callbacks = preRenderQueue.splice(0);
    if (callbacks.length === 0) throw new Error(`Game loop stopped scheduling frames after ${frameIndex} frames.`);
    for (const callback of callbacks) callback(nextFrameTime);
    if (traceHash) {
      const fingerprint = frameFingerprint();
      traceHash.update(`${fingerprint}\n`);
      if (process.env.H5_TRACE_LOG) traceLog.push(fingerprint);
    }
    if (afterFrame) afterFrame();
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
// Resolved after boot: i18n/index.js reads window.localStorage at load time, so
// it must not be imported before the stub above has installed one.
const { translate } = await import(pathToFileURL(resolve(projectRoot, "src/i18n/index.js")).href);
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

// ---- the home page ----------------------------------------------------------
// The menu is one canvas page now, like the shop below: the card, the resting
// countdown and 出征 are painted, so the start is a tap on a rect the page drew.
// The conversion is the router's, run in reverse.
const menuCanvas = query("#menu-canvas");
const menuPage = game.menuPage;
const menuStartProxy = query("#menu-start");

function menuPoint(rect) {
  const box = menuCanvas.getBoundingClientRect();
  return {
    pointerId: 1,
    clientX: box.left + ((rect.x + rect.width / 2) * box.width) / menuPage.view.width,
    clientY: box.top + ((rect.y + rect.height / 2) * box.height) / menuPage.view.height,
  };
}

function tapMenuStart() {
  const point = menuPoint(menuPage.lastFrame().startRect);
  menuCanvas.dispatch("pointerdown", point);
  menuCanvas.dispatch("pointerup", point);
}

const bootFrame = menuPage.lastFrame();
check("the home page painted its card", bootFrame !== null, "the menu canvas painted nothing");
check("the card was opened unlocked", bootFrame?.locked === false, `locked=${bootFrame?.locked}`);
check("the card draws the title, the seal and two lines of lede at most",
  bootFrame.title === translate("menu.title") && bootFrame.lede.length >= 1 && bootFrame.lede.length <= 2,
  `title="${bootFrame?.title}" lines=${bootFrame?.lede.length}`);
// The keyboard's and the screen reader's copy of 出征 is not drawn on the canvas:
// it is the invisible button the page moves onto the painted rect.
check("the focus proxy is moved onto the painted 出征",
  menuStartProxy.hidden === false
    && menuStartProxy.style.left === `${bootFrame.startRect.x}px`
    && menuStartProxy.style.top === `${bootFrame.startRect.y}px`,
  `left=${menuStartProxy.style.left} top=${menuStartProxy.style.top} rect=${JSON.stringify(bootFrame.startRect)}`);

// A new run names the player before the first battle, so the menu now opens the
// story card rather than the battlefield. The name is rolled from the campaign's
// stream, which createBattle() re-seeds below it: a seeded run is named the same
// way on every reload, and the battle still draws from an untouched stream.
tapMenuStart();
const identity = game.campaign.identity;
check("menu start opens the prologue", query("#prologue-screen").hidden === false,
  `mode=${game.state.mode}`);
check("the prologue hides the battlefield", query("#battle-screen").hidden === true);
// The pause card lives on top of the field. It must never be up while the battle
// is live: the game would keep running underneath it, invisible and unplayable.
check("the prologue raises no pause card", query("#battle-card").classList.contains("hidden"));
check("the prologue rolled a Chinese name", /^[\u4e00-\u9fa5]{2,}$/u.test(identity?.fullName ?? ""),
  `name=${identity?.fullName}`);
check("the nameplate shows the rolled name", query("#prologue-name").textContent === identity?.fullName,
  `nameplate="${query("#prologue-name").textContent}"`);
check("the story names the player", query("#prologue-name-line").textContent
  === translate("prologue.name", { name: identity?.fullName }),
  `line="${query("#prologue-name-line").textContent}"`);
check("the prologue tells where the player was born",
  query("#prologue-birth").textContent === translate("prologue.birth"));
check("the prologue tells the clan's story",
  query("#prologue-clan").textContent === translate(identity.clanReasonKey),
  `line="${query("#prologue-clan").textContent}"`);
check("the prologue tells the given name's story",
  query("#prologue-given").textContent === translate(identity.givenReasonKey),
  `line="${query("#prologue-given").textContent}"`);
check("the prologue states the ambition",
  query("#prologue-ambition").textContent === translate("prologue.ambition"));
// The run's length is rolled with the name, before the battle stream is re-seeded,
// and the card states it: the last stage is the one the whole run is for.
check("the story rolled a last stage inside the rule range",
  game.campaign.finalStage >= campaignRules.finalStageMin
    && game.campaign.finalStage < campaignRules.finalStageMin + campaignRules.finalStageSpan,
  `finalStage=${game.campaign.finalStage}`);
check("the story ends with the stage it will be settled on",
  query("#prologue-final").hidden === false
    && query("#prologue-final").textContent === translate("prologue.final", { stage: game.campaign.finalStage }),
  `line="${query("#prologue-final").textContent}"`);
check("the objective is unnamed until the battle begins",
  query("#objective-label").textContent === translate("battle.objective"),
  `label="${query("#objective-label").textContent}"`);

// The click handler runs beginMission() synchronously, so this is the one moment
// at which a module stamping a second clock is still observable: the loop rewrites
// state.lastTime on its very next frame. Equality with the harness's frame time is
// the whole contract — the loop is the only writer of the time base.
query("#prologue-start").dispatch("click");
check(
  "beginMission leaves the loop's time base alone",
  game.state.lastTime === nextFrameTime,
  `lastTime=${game.state.lastTime} frameClock=${nextFrameTime}`,
);
check("prologue start begins a battle", query("#battle-screen").hidden === false,
  `mode=${game.state.mode}`);
check("prologue start hides the story card", query("#prologue-screen").hidden === true);
check("beginning the battle drops the pause card", query("#battle-card").classList.contains("hidden"),
  `hidden=${query("#battle-card").classList.contains("hidden")} mode=${game.state.mode}`);

// Round-trip the card through both of its states, so "hidden while running" is
// paired with "shown while paused" rather than proving a permanently hidden box.
dispatchWindow("keydown", { key: "p" });
check("pausing raises the pause card",
  game.state.mode === "paused" && !query("#battle-card").classList.contains("hidden"),
  `mode=${game.state.mode}`);
dispatchWindow("keydown", { key: "p" });
check("resuming drops it again",
  game.state.mode === "running" && query("#battle-card").classList.contains("hidden"),
  `mode=${game.state.mode}`);
check("the battle kept the name the prologue showed", game.campaign.identity === identity);
check("the battle objective carries the player's name",
  query("#objective-label").textContent === translate("battle.objectiveNamed", { name: identity.fullName }),
  `label="${query("#objective-label").textContent}"`);
checkCamera("battle start");

// The two releases have to stay distinct: a drawn bow must not fire by itself,
// and letting go after `holdSeconds` has to be the long volley rather than the
// assisted tap. It runs before the roam, so the field is still empty here — which
// is the other half of the rule: a tap with nothing in its cone still looses an
// arrow instead of swallowing the press.
{
  const { holdSeconds, tapCooldown } = projectileRules.playerVolley;
  dispatchWindow("keydown", { key: " " });
  runFrames(45); // 0.75s of draw
  const drawnFor = game.state.fireHold;
  check("holding the fire key draws the bow", drawnFor >= holdSeconds, `fireHold=${drawnFor.toFixed(2)}s`);
  check("a drawn bow does not fire on its own", game.player.cooldown === 0,
    `cooldown=${game.player.cooldown.toFixed(3)}s`);
  const fireButton = query(".touch-fire");
  check("the fire button fills its draw ring while held",
    fireButton.style.getPropertyValue("--charge") === "1" && fireButton.classList.contains("charged"),
    `--charge=${fireButton.style.getPropertyValue("--charge")} charged=${fireButton.classList.contains("charged")}`);
  dispatchWindow("keyup", { key: " " });
  runFrames(1);
  check("a drawn release looses the long volley", game.player.cooldown > tapCooldown,
    `cooldown=${game.player.cooldown.toFixed(3)}s`);
  check("the draw meter resets on release", game.state.fireHold === 0, `fireHold=${game.state.fireHold}`);
  check("the draw ring empties on release",
    fireButton.style.getPropertyValue("--charge") === "0" && !fireButton.classList.contains("charged"),
    `--charge=${fireButton.style.getPropertyValue("--charge")}`);

  runFrames(40);
  const arrowsBefore = game.state.bullets.filter((shot) => shot.owner === "player").length;
  dispatchWindow("keydown", { key: " " });
  runFrames(6);
  dispatchWindow("keyup", { key: " " });
  runFrames(1);
  check("a quick tap looses the shorter aimed shot",
    game.player.cooldown > 0 && game.player.cooldown <= tapCooldown,
    `cooldown=${game.player.cooldown.toFixed(3)}s`);
  const arrowsAfter = game.state.bullets.filter((shot) => shot.owner === "player").length;
  check("an empty cone still looses an arrow", arrowsAfter > arrowsBefore, `${arrowsBefore} -> ${arrowsAfter} arrows`);
}


// Sampled after every frame of the combat run. Two units in the same pixel is
// the visible symptom of the guard-post collapse (a whole column used to walk
// onto one post), and a non-finite `angle` is what the boss idle branch wrote
// before `spawnBoss` gave it a facing to fall back on.
const enemyGap = { worst: Infinity, nonFiniteAngle: null };
// Idle units look around their formation's front. Two live invariants: a settled
// unit never leaves the scan band, and the scan actually runs here (not just in
// the focused unit test). A unit that just lost track spends up to a couple of
// seconds easing round from its combat heading, and may look about the spot it
// last saw the player, so each unit is latched as settled once it is first
// inside the band and only checked from then on.
const idleScan = { states: new WeakMap(), widest: 0, bandBreak: null, settled: 0, drifters: 0, quietClearance: 0 };
function sampleIdleScan() {
  for (const enemy of game?.state?.enemies ?? []) {
    if (enemy.destroyed) continue;
    let entry = idleScan.states.get(enemy);
    if (!entry) idleScan.states.set(enemy, entry = { settled: false, widest: 0 });
    // A unit that is walking to a sighting is not idle, even when the walk
    // happens to cross its own slot on the way.
    const idle = !enemy.seesPlayer && !(enemy.searchTimer > 0) && !(enemy.sweepTimer > 0)
      && Math.hypot(enemy.homeX - enemy.x, enemy.homeY - enemy.y) <= 8;
    if (!idle) {
      entry.settled = false;
      entry.widest = 0;
      continue;
    }
    // Signed distance from the spawn front, wrapped into [0, pi].
    const raw = (enemy.angle - enemy.homeAngle) % (Math.PI * 2);
    const drift = Math.min(Math.abs(raw), Math.PI * 2 - Math.abs(raw));
    if (!entry.settled) {
      if (drift > 0.34 + 0.02) continue;
      entry.settled = true;
      idleScan.settled += 1;
    }
    if (drift > entry.widest) entry.widest = drift;
    if (!entry.drifted && drift > 0.05) {
      entry.drifted = true;
      idleScan.drifters += 1;
    }
    if (drift > idleScan.widest) idleScan.widest = drift;
    if (drift > 0.34 + 0.02 && !idleScan.bandBreak) idleScan.bandBreak = `${enemy.type} ${drift.toFixed(3)}rad`;
  }
}
function sampleEnemies() {
  sampleIdleScan();
  const enemies = game?.state?.enemies ?? [];
  for (let first = 0; first < enemies.length; first += 1) {
    const left = enemies[first];
    if (left.destroyed) continue;
    if (!Number.isFinite(left.angle) && !enemyGap.nonFiniteAngle) enemyGap.nonFiniteAngle = left.type;
    for (let second = first + 1; second < enemies.length; second += 1) {
      const right = enemies[second];
      if (right.destroyed) continue;
      const gap = Math.hypot(left.x - right.x, left.y - right.y) - (left.radius + right.radius);
      enemyGap.worst = Math.min(enemyGap.worst, gap);
    }
  }
}

// Roam and fire: the chariot turns, rams, and volleys so formations, projectiles,
// collision damage, drops, and HUD updates all execute. The bow looses on
// release now, so the drive taps the fire key in a rhythm instead of holding it:
// 6 frames of draw is a tap (aim-assisted shot), 18 frames of quiet lets the
// reload finish, which keeps roughly the old shot rate.
function tapFire(frames, sample) {
  for (let elapsed = 0; elapsed < frames; elapsed += 24) {
    dispatchWindow("keydown", { key: " " });
    runFrames(6, sample);
    dispatchWindow("keyup", { key: " " });
    runFrames(18, sample);
  }
}

// The dust trail is painted under the bodies, so no drawing assertion can see it.
// Sample the particle list while the chariot is actually driving instead: a puff
// that is the wrong size, lives past its own fade, or never appears at all shows
// up here.
const trailSample = { puffs: 0, widest: 0, longest: 0, stale: 0 };
function sampleTrail() {
  for (const particle of game?.state?.particles ?? []) {
    if (particle.kind !== "trail") continue;
    trailSample.puffs += 1;
    trailSample.widest = Math.max(trailSample.widest, particle.size);
    trailSample.longest = Math.max(trailSample.longest, particle.life);
    if (particle.life > (particle.maxLife ?? 0)) trailSample.stale += 1;
  }
}

for (const [frameBlock, key] of [[120, "w"], [120, "a"], [120, "w"], [120, "d"], [120, "s"], [120, "w"], [180, "d"]]) {
  dispatchWindow("keydown", { key });
  tapFire(frameBlock, () => { sampleEnemies(); sampleTrail(); });
  dispatchWindow("keyup", { key });
}

// Quiet watch: park the chariot in the emptiest corner and let the formations
// that are still standing carry on. The roam above drives straight through them,
// so no unit there gets more than a frame or two of quiet, and the idle scan is
// the one behaviour that only shows itself when nothing is happening.
{
  const inset = 140;
  const corners = [
    [inset, inset],
    [game.world.width - inset, inset],
    [inset, game.world.height - inset],
    [game.world.width - inset, game.world.height - inset],
  ];
  const standing = game.state.enemies.filter((enemy) => !enemy.destroyed);
  let best = corners[0];
  let clearance = -Infinity;
  for (const [x, y] of corners) {
    const nearest = standing.length === 0 ? Infinity : Math.min(...standing.map((enemy) => Math.hypot(enemy.x - x, enemy.y - y)));
    if (nearest > clearance) { clearance = nearest; best = [x, y]; }
  }
  idleScan.quietClearance = clearance;
  game.player.health = game.player.maxHealth;
  game.player.x = best[0];
  game.player.y = best[1];
  runFrames(420, sampleEnemies);
}

check("the driving chariot raised a dust trail", trailSample.puffs > 0,
  `${trailSample.puffs} puffs sampled`);
check("every sampled puff stayed inside the trail rule band",
  trailSample.widest >= effectRules.trail.sizeMin && trailSample.widest <= effectRules.trail.sizeMax
  && trailSample.longest <= effectRules.trail.lifeMax && trailSample.stale === 0,
  `size<=${trailSample.widest.toFixed(1)} life<=${trailSample.longest.toFixed(2)} stale=${trailSample.stale}`);
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
const formations = game?.state?.formations ?? [];
let footprintOverlap = false;
for (let first = 0; first < formations.length; first += 1) {
  for (let second = first + 1; second < formations.length; second += 1) {
    const left = formations[first];
    const right = formations[second];
    if (Math.abs(left.x - right.x) < left.halfWidth + right.halfWidth
      && Math.abs(left.y - right.y) < left.halfHeight + right.halfHeight) footprintOverlap = true;
  }
}
check("no two formation footprints overlap", !footprintOverlap, `formations=${formations.length}`);
check("no two enemies occupy the same pixel", enemyGap.worst > -6, `worst body gap=${enemyGap.worst.toFixed(1)}px`);
check("every enemy kept a finite facing", enemyGap.nonFiniteAngle === null, `angle went ${enemyGap.nonFiniteAngle}`);
check("idle enemies looked around inside their scan band",
  idleScan.bandBreak === null && idleScan.settled > 0 && idleScan.drifters > 0,
  `settled=${idleScan.settled} drifters=${idleScan.drifters} widest=${idleScan.widest.toFixed(3)}rad clearance=${idleScan.quietClearance.toFixed(0)}px ${idleScan.bandBreak ?? ""}`);
check("player state stayed finite", Number.isFinite(game?.player.x) && Number.isFinite(game?.player.y)
  && Number.isFinite(game?.player.health), `player=${game?.player.x},${game?.player.y} health=${game?.player.health}`);
checkCamera("after the combat run");
check("no non-finite geometry reached the canvas", nonFiniteDraws.length === 0, nonFiniteDraws.slice(0, 3).join(" | "));

// Axle blades --------------------------------------------------------------
// The one purchase that changes a rule instead of a pixel: a maxed axle cap cuts
// a tree down at full speed. Drive the real controller into a lone tree twice -
// with the cap bought and without it - and assert on what the campaign is left
// with, because the cut lives in the composition root (game.js) rather than in a
// module a unit test can call.
{
  const maxAxleCap = equipment.find((item) => item.id === "axleCap").levels.length;
  const savedAxleCap = game.campaign.equipment.axleCap;
  const ram = (axleCap) => {
    const tree = { type: "tree", x: 1400, y: 900, radius: 34 };
    // The battlefield is replaced rather than edited in place: exactly what
    // fellTree() does, and what the sight index keys on.
    game.campaign.obstacles = [tree];
    game.campaign.stumps = [];
    game.campaign.equipment.axleCap = axleCap;
    game.state.enemies.length = 0;
    game.state.bullets.length = 0;
    game.player.mode = "chariot";
    game.player.angle = 0;
    // This run's mobility tops out at 78px/s, below the 85px/s every ram - damage
    // or cut - needs. The harness owns the number it drives with, so raise it
    // rather than waiting for a faster campaign.
    game.player.maxSpeed = 200;
    game.player.speed = game.player.maxSpeed;
    game.player.knockbackX = 0;
    game.player.knockbackY = 0;
    game.player.impactCooldown = 0;
    // Nothing on this empty field can hurt the chariot except the tree, so the
    // damage the assertions read is the ram's own.
    game.player.invulnerable = 0;
    game.player.health = game.player.maxHealth;
    game.player.x = tree.x - tree.radius - game.player.radius - 12;
    game.player.y = tree.y;
    dispatchWindow("keydown", { key: "d" });
    runFrames(90);
    dispatchWindow("keyup", { key: "d" });
    return {
      standing: game.campaign.obstacles.includes(tree),
      stumps: game.campaign.stumps.length,
      stumpAtTree: game.campaign.stumps.some((stump) => stump.x === tree.x && stump.y === tree.y),
      damage: game.player.maxHealth - game.player.health,
      // The shake the renderer reads: a plain ram marks the tree, a cut removes it.
      shook: Number.isFinite(tree.hitAt),
    };
  };

  const cut = ram(maxAxleCap);
  check("a maxed axle cap cuts the tree down", !cut.standing, "the tree is still standing");
  check("the felled tree left exactly one stump, where it stood", cut.stumps === 1 && cut.stumpAtTree,
    `stumps=${cut.stumps} atTree=${cut.stumpAtTree}`);
  check("cutting the tree down cost the hull nothing", cut.damage === 0, `damage=${cut.damage}`);
  check("the stump is not an obstacle", !game.campaign.obstacles.some((obstacle) => obstacle === game.campaign.stumps[0]),
    `obstacles=${game.campaign.obstacles.length}`);

  const bumped = ram(0);
  check("without the blades the same run still costs hull points", bumped.standing && bumped.damage > 0,
    `standing=${bumped.standing} damage=${bumped.damage}`);
  check("an unfelled tree leaves no stump", bumped.stumps === 0, `stumps=${bumped.stumps}`);
  check("a plain ram shakes the tree instead of felling it", bumped.shook, "the tree carries no hit time");
  check("a cut tree is gone, so there is nothing left to shake", !cut.shook, "a felled tree still carries a hit time");
  // Everything the frame loop needs afterwards is put back by the next battle; the
  // purchase the harness borrowed is not, so hand it back here.
  game.campaign.equipment.axleCap = savedAxleCap;
  game.player.invulnerable = 0;
  check("no runtime errors while felling", loggedErrors.length === 0, loggedErrors[0]);
}

// Foot phase ---------------------------------------------------------------
// Everything above runs in the chariot, so the trace never reached the dismount,
// the companion build, or their per-frame loop - which is exactly the code a
// player/crew refactor rewrites. Roll a fresh battle through the production
// "next battle" path, hire one archer and one halberdier (one of each row, so the
// volley fan is measured over the archers alone), and die through the real
// damage path so `dismountPlayer` runs rather than being called directly.
game.stageManager.rollForNextBattle();
check("a new stage keeps the run's name", game.campaign.identity === identity);
check("a new stage's objective is still the player's",
  query("#objective-label").textContent === translate("battle.objectiveNamed", { name: identity.fullName }),
  `label="${query("#objective-label").textContent}"`);
game.campaign.roster.push({ id: 9001, role: "archer" }, { id: 9002, role: "halberdier" });
game.campaign.nextPersonnelId = 9003;
game.player.health = 1;
game.player.invulnerable = 0;
game.combat.damagePlayer(5, game.player.x + 24, game.player.y);
const footCompanions = game.state.footCompanions;
check("a lethal hit dismounts the chariot", game.player.mode === "foot", `mode=${game.player.mode}`);
check("the crew deploys beside the dismounted player", footCompanions.length === 2,
  `companions=${footCompanions.length} roster=${game.campaign.roster.length}`);
check("each companion carries its own row's numbers",
  footCompanions[0]?.damage === 2 && footCompanions[1]?.damage === 5,
  `damage=${footCompanions.map((companion) => companion.damage).join(",")}`);

// The hull drops to 35 on foot, which one volley ends: hold it up so the segment
// traces the companion loop instead of finishing on the defeat screen.
game.player.maxHealth = 400;
game.player.health = 400;

const footPhase = { allyShots: 0, seen: new WeakSet(), closest: Infinity, nonFinite: null };
function sampleFootPhase() {
  const state = game?.state;
  if (!state) return;
  for (const bullet of state.bullets) {
    if (bullet.owner !== "ally" || footPhase.seen.has(bullet)) continue;
    footPhase.seen.add(bullet);
    footPhase.allyShots += 1;
  }
  for (const companion of state.footCompanions) {
    if (!Number.isFinite(companion.x) || !Number.isFinite(companion.y)
      || !Number.isFinite(companion.health) || !Number.isFinite(companion.angle)) {
      footPhase.nonFinite ??= `${companion.type}@${companion.x},${companion.y}`;
      continue;
    }
    // A fallen companion is left where it fell, which is the whole point of the
    // follow check: only the ones still on their feet have to keep up. The metric
    // is the *closest* companion rather than the farthest - a companion can still
    // snag on a wall corner while the group is fine (the follow loop bends round
    // obstacles through src/game/pathfinding.js, but a body that was shoved into a
    // pocket has to walk out of it). A broken loop would strand them all.
    if (companion.destroyed) continue;
    footPhase.closest = Math.min(
      footPhase.closest,
      Math.hypot(companion.x - game.player.x, companion.y - game.player.y),
    );
  }
}

// Walk the dismounted group into the lines that spawn on the fresh battle. The
// sword also runs `firePlayer`'s foot branch, which no other block reaches.
for (const [frameBlock, key] of [[240, "w"], [240, "d"], [240, "w"]]) {
  dispatchWindow("keydown", { key });
  dispatchWindow("keydown", { key: " " });
  runFrames(frameBlock, sampleFootPhase);
  dispatchWindow("keyup", { key });
}
check("the dismounted crew fired", footPhase.allyShots > 0, `ally shots=${footPhase.allyShots}`);
check("the companions stayed with the player", footPhase.closest < 90,
  `closest follow=${footPhase.closest.toFixed(1)}px`);
check("companion state stayed finite", footPhase.nonFinite === null, `went ${footPhase.nonFinite}`);
check("the foot fight did not end the battle", game.state.mode === "running", `mode=${game.state.mode}`);

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

// ---- the shop page ----------------------------------------------------------
// The shop is one canvas page: its own clock, its own pointer router, and every
// rect it registers comes back with the frame. The harness therefore drives it
// the way a finger does - a press and a release at the centre of a registered
// rect - and reads the frame back to see what the player would be looking at.
game.stageManager.enterShop();
runFrames(45);
const shopPage = game.shopPage;
const shopCanvas = query("#shop-canvas");
const shopFrame = () => shopPage.lastFrame();

// View units to client pixels: the same conversion the router runs in reverse,
// so a rect taken from the frame always lands on the target that registered it.
function shopPoint(rect) {
  const box = shopCanvas.getBoundingClientRect();
  return {
    pointerId: 1,
    clientX: box.left + ((rect.x + rect.width / 2) * box.width) / shopPage.view.width,
    clientY: box.top + ((rect.y + rect.height / 2) * box.height) / shopPage.view.height,
  };
}

function pressRect(rect) {
  shopCanvas.dispatch("pointerdown", shopPoint(rect));
  runFrames(1);
}

function releaseRect(rect) {
  shopCanvas.dispatch("pointerup", shopPoint(rect));
  runFrames(1);
}

function tapRect(rect) {
  pressRect(rect);
  releaseRect(rect);
}

const rowById = (id) => shopFrame().rows.find((row) => row.id === id) ?? null;
const tabById = (id) => shopFrame().tabs.find((tab) => tab.id === id) ?? null;
const campTents = () => shopFrame().dossier.camp?.formations ?? -1;

// The catalogue is sliced per screen, so a row can live on a later page: turn the
// pager until it is on this one, which is what a player would do.
function revealRow(id) {
  for (let guard = 0; guard < 8; guard += 1) {
    const row = rowById(id);
    if (row) return row;
    const frame = shopFrame();
    if (frame.page >= frame.pageCount - 1) return null;
    tapRect(frame.pager.next);
  }
  return null;
}

check("entering the shop shows the page", query("#shop-screen").hidden === false, `mode=${game.state.mode}`);
check("the shop keeps the run's name", game.campaign.identity === identity);
const opening = shopFrame();
check("the shop painted a dossier and a ledger",
  opening !== null && opening.view.width === 960 && opening.dossier.rect.width > 0 && opening.rows.length > 0,
  `rows=${opening?.rows.length} view=${JSON.stringify(opening?.view)}`);
check("the dossier drew the team inside its box",
  opening.dossier.rig.width > 0 && opening.dossier.rig.height > 0
    && opening.dossier.rig.x >= opening.dossier.rect.x && opening.dossier.rig.y >= opening.dossier.rect.y,
  `rig=${JSON.stringify(opening.dossier.rig)}`);
check("the shop opens on the equipment ledger",
  opening.category === "equipment" && opening.tabs[0].id === "equipment", `category=${opening.category}`);
check("the shop opens on the standing collision rule",
  opening.info.label === translate("shop.collision.label")
    && opening.info.text === translate("shop.collision.description"),
  `label="${opening.info.label}"`);
check("nothing is previewed until a row is pressed",
  JSON.stringify(opening.radar.preview) === JSON.stringify(opening.radar.current),
  "the wheel opened on a purchase");

// A press previews, a release on the same rect pins: the wheel has to move under
// the finger and come back with it, because a preview that outlives the press is
// a team the player never bought.
const upgrade = equipment.find((item) => game.campaign.equipment[item.id] < item.levels.length) ?? equipment[0];
const upgradeRow = revealRow(upgrade.id);
check("the ledger lists the chassis upgrades", Boolean(upgradeRow), `no row for ${upgrade.id}`);

pressRect(upgradeRow.rect);
const pressedFrame = shopFrame();
check("pressing a row previews it on the wheel",
  pressedFrame.pressedId === upgrade.id && pressedFrame.info.id === upgrade.id
    && JSON.stringify(pressedFrame.radar.preview) !== JSON.stringify(pressedFrame.radar.current),
  `pressed=${pressedFrame.pressedId} info=${pressedFrame.info.id}`);

// Sliding off the row is a scroll, not a purchase: the router drops the press and
// the preview goes with it.
shopCanvas.dispatch("pointermove", { ...shopPoint(upgradeRow.rect), pointerId: 1, clientY: 0 });
runFrames(1);
check("sliding off a row cancels the press and the preview",
  shopFrame().pressedId === null
    && JSON.stringify(shopFrame().radar.preview) === JSON.stringify(shopFrame().radar.current),
  `pressed=${shopFrame().pressedId}`);

// A cancel is a cancel, not a pin: the same row has to be pressed and released
// again before it keeps its description.
pressRect(upgradeRow.rect);
releaseRect(upgradeRow.rect);
const releasedFrame = shopFrame();
check("a tapped row keeps its description but not its preview",
  releasedFrame.pressedId === null && releasedFrame.pinnedId === upgrade.id
    && releasedFrame.info.id === upgrade.id
    && JSON.stringify(releasedFrame.radar.preview) === JSON.stringify(releasedFrame.radar.current),
  `pinned=${releasedFrame.pinnedId} pressed=${releasedFrame.pressedId}`);

// A buy button that cannot be pressed has to say why: a dimmed 购置 reads as a
// broken button, 军资不足 reads as the next goal. Gold is forced here so both label
// states are checked whatever drops this run happened to collect.
const savedGold = game.campaign.totalGold;
const upgradePrice = rowById(upgrade.id).price;
game.campaign.totalGold = 0;
runFrames(1);
check("an unaffordable purchase names the price instead of a dim 购置",
  rowById(upgrade.id)?.label === translate("shop.shortGold", { price: upgradePrice })
    && rowById(upgrade.id)?.disabled === true && rowById(upgrade.id)?.reason === "gold",
  `label="${rowById(upgrade.id)?.label}" reason=${rowById(upgrade.id)?.reason}`);
game.campaign.totalGold = 99999;
runFrames(1);
check("an affordable purchase goes back to the buy label",
  rowById(upgrade.id)?.label === translate("shop.buy", { price: upgradePrice })
    && rowById(upgrade.id)?.disabled === false,
  `label="${rowById(upgrade.id)?.label}"`);

// The purchase itself: one tap on the button spends the gold, raises the level and
// is announced - the canvas is opaque to a screen reader, so the live region has to
// carry the same sentence the notice strip draws.
const levelBefore = game.campaign.equipment[upgrade.id];
tapRect(rowById(upgrade.id).buyRect);
check("a tap on the buy button spends the gold and raises the level",
  game.campaign.equipment[upgrade.id] === levelBefore + 1
    && game.campaign.totalGold === 99999 - upgradePrice,
  `level=${game.campaign.equipment[upgrade.id]} gold=${game.campaign.totalGold}`);
const boughtLine = translate("shop.purchaseSuccess", { item: translate(upgrade.nameKey) });
check("the purchase is announced in the live region",
  query("#shop-live").textContent === boughtLine, `live="${query("#shop-live").textContent}"`);
check("the notice strip says what the live region announced",
  shopFrame().notice === boughtLine && shopFrame().noticeTone === "ok", `notice="${shopFrame().notice}"`);

// A refused row must not spend anything either: the tap still reaches the button,
// which reports the reason instead of buying.
game.campaign.totalGold = 0;
runFrames(1);
tapRect(rowById(upgrade.id).buyRect);
check("a refused purchase spends nothing and says why",
  game.campaign.totalGold === 0 && shopFrame().notice === translate("shop.error.gold")
    && shopFrame().noticeTone === "error",
  `notice="${shopFrame().notice}" gold=${game.campaign.totalGold}`);
game.campaign.totalGold = savedGold;
runFrames(1);

// The crew page: the same ledger, but the dossier's chart slot paints the night
// camp, and the last row is the hire ladder - three rungs, bought in order, each
// with its own price and its own line of bodies, capped at the top rung and
// legible at the fire before it is paid for.
tapRect(tabById("personnel").rect);
check("switching tabs paints the night camp",
  shopFrame().category === "personnel" && shopFrame().dossier.slot === "camp"
    && Boolean(shopFrame().dossier.camp),
  `category=${shopFrame().category} slot=${shopFrame().dossier.slot}`);
check("a new tab drops the pinned description",
  shopFrame().pinnedId === null && shopFrame().info.label === translate("shop.collision.label"),
  `pinned=${shopFrame().pinnedId} label="${shopFrame().info.label}"`);
check("the fire seats the player and the living crew",
  shopFrame().dossier.camp.seats === 1 + game.campaign.roster.filter((member) => member.alive !== false).length,
  `seats=${shopFrame().dossier.camp.seats}`);

const [levyRung, horseRung, siegeRung] = formationTiers;
const hireRow = revealRow("formation");
check("the crew page sells the first rung of the ladder, count and cap included",
  Boolean(hireRow) && hireRow.title.includes(translate(levyRung.nameKey))
    && hireRow.title.includes(`0/${formationRules.maxHires}`),
  `title="${hireRow?.title}"`);

const savedForHire = game.campaign.totalGold;
game.campaign.totalGold = levyRung.price + horseRung.price + siegeRung.price;
runFrames(1);
check("the hire opens on the first rung's price",
  rowById("formation")?.label === translate("shop.hireFormation", { price: levyRung.price })
    && rowById("formation")?.disabled === false, `label="${rowById("formation")?.label}"`);
check("the camp opens without a hired tent", campTents() === 0, `tents=${campTents()}`);

pressRect(rowById("formation").rect);
check("pressing the hire pitches a tent at the fire", campTents() === 1, `tents=${campTents()}`);
releaseRect(rowById("formation").rect);
check("releasing the hire takes the tent back", campTents() === 0, `tents=${campTents()}`);

tapRect(rowById("formation").buyRect);
check("buying the first rung charges its price and keeps the line",
  game.campaign.friendlyFormations === 1
    && game.campaign.totalGold === horseRung.price + siegeRung.price,
  `hires=${game.campaign.friendlyFormations} gold=${game.campaign.totalGold}`);
check("the bought line is camped at the fire", campTents() === 1, `tents=${campTents()}`);
check("the row moves up to the second rung, name and price together",
  rowById("formation")?.title.includes(translate(horseRung.nameKey))
    && rowById("formation")?.title.includes(`1/${formationRules.maxHires}`)
    && rowById("formation")?.label === translate("shop.hireFormation", { price: horseRung.price }),
  `title="${rowById("formation")?.title}" label="${rowById("formation")?.label}"`);

pressRect(rowById("formation").rect);
check("the second rung previews a second tent", campTents() === 2, `tents=${campTents()}`);
releaseRect(rowById("formation").rect);
tapRect(rowById("formation").buyRect);
check("the second rung can be hired at its own price",
  game.campaign.friendlyFormations === 2 && game.campaign.totalGold === siegeRung.price,
  `hires=${game.campaign.friendlyFormations} gold=${game.campaign.totalGold}`);
check("the row is selling the siege camp now",
  rowById("formation")?.title.includes(translate(siegeRung.nameKey))
    && rowById("formation")?.label === translate("shop.hireFormation", { price: siegeRung.price }),
  `title="${rowById("formation")?.title}" label="${rowById("formation")?.label}"`);

pressRect(rowById("formation").rect);
check("the siege camp previews a third tent", campTents() === formationRules.maxHires,
  `tents=${campTents()}`);
releaseRect(rowById("formation").rect);
tapRect(rowById("formation").buyRect);
check("the last rung can be bought, and the shelf is bare",
  game.campaign.friendlyFormations === formationRules.maxHires && game.campaign.totalGold === 0,
  `hires=${game.campaign.friendlyFormations} gold=${game.campaign.totalGold}`);
check("the cap disables the button and says why",
  rowById("formation")?.disabled === true && rowById("formation")?.label === translate("shop.formationCap"),
  `label="${rowById("formation")?.label}" disabled=${rowById("formation")?.disabled}`);

// Leave the run as the rest of the script found it: the formation is a purchase
// test, and a hired line on the later battlefields would change those battles.
game.campaign.friendlyFormations = 0;
game.campaign.totalGold = savedForHire;
runFrames(1);
check("the ledger reopens at the first rung without a hire",
  rowById("formation")?.title.includes(translate(levyRung.nameKey))
    && rowById("formation")?.title.includes(`0/${formationRules.maxHires}`),
  `title="${rowById("formation")?.title}"`);

// The footer's button is the one action the page delegates to the stage manager:
// it has to leave the shop for a fresh battlefield, not just repaint the page.
const stageBeforeNext = game.campaign.stage;
tapRect(shopFrame().next);
check("the footer's next battle leaves the shop for the next stage",
  game.state.mode === "running" && game.campaign.stage === stageBeforeNext + 1,
  `mode=${game.state.mode} stage=${game.campaign.stage}`);

// The purchase has to reach the field: one line, eleven bodies, three bows and no
// vehicle on this rung, and all of it close to the player's start rather than at a
// random map bearing.
game.campaign.friendlyFormations = 1;
game.stageManager.restartStage();
const hiredLine = game.state.allyFormations ?? [];
const hiredBodies = game.state.allies ?? [];
check("a hired line takes the field in the next battle",
  hiredLine.length === 1 && hiredBodies.length === levyRung.slots.length,
  `lines=${hiredLine.length} bodies=${hiredBodies.length}`);
check("the first rung is infantry and bows, with no engine among them",
  hiredBodies.filter((ally) => ally.vehicle).length === 0
    && hiredBodies.filter((ally) => ally.ranged).length === 3,
  `vehicles=${hiredBodies.filter((ally) => ally.vehicle).length} ranged=${hiredBodies.filter((ally) => ally.ranged).length}`);
check("the line's rung is the rung that was bought",
  hiredLine[0]?.tier === 0 && hiredLine[0]?.nameKey === levyRung.nameKey,
  `tier=${hiredLine[0]?.tier} name=${hiredLine[0]?.nameKey}`);
check("the hired line spawns beside the chariot, not across the map",
  hiredBodies.every((ally) => Math.hypot(ally.x - game.player.x, ally.y - game.player.y) < 420),
  "a hire spawned out of supporting distance");
check("the line's border is the one the renderer dashes",
  hiredLine.every((line) => line.halfWidth > 0 && line.halfHeight > 0 && line.color === "#5fbd79"));
let hireGeometryGap = null;
runFrames(30, () => {
  for (const ally of game.state.allies ?? []) {
    if (![ally.x, ally.y, ally.angle].every(Number.isFinite)) hireGeometryGap = ally.type;
  }
});
check("the hired line holds its ground with finite geometry", !hireGeometryGap,
  `non-finite ${hireGeometryGap}`);
check("the hired line is still whole after a second of battle",
  (game.state.allies ?? []).length === levyRung.slots.length,
  `bodies=${(game.state.allies ?? []).length}`);

// The second rung on the same field: the ladder is bought in order, so two hires
// are the levy and 马砲铁阵 - the rung with the chariots, and the captured engine
// does not appear until the siege camp is owned.
game.campaign.friendlyFormations = 2;
game.stageManager.restartStage();
const twoRungs = game.state.allyFormations ?? [];
const twoRungBodies = game.state.allies ?? [];
check("two hires field both rungs, each with its own roster",
  twoRungs.length === 2 && twoRungBodies.length === levyRung.slots.length + horseRung.slots.length
    && twoRungs.map((line) => line.tier).join() === "0,1",
  `lines=${twoRungs.length} bodies=${twoRungBodies.length} tiers=${twoRungs.map((line) => line.tier).join()}`);
check("the second rung is the one that brings chariots",
  twoRungBodies.filter((ally) => ally.vehicle).length === 2
    && twoRungBodies.every((ally) => ally.visual.kind !== "catapult"),
  `vehicles=${twoRungBodies.filter((ally) => ally.vehicle).length}`
    + ` engines=${twoRungBodies.filter((ally) => ally.visual.kind === "catapult").length}`);

// ---- 出击 / 结阵 --------------------------------------------------------------
//
// The order button is the only control the player has over a line he is standing
// in: hidden everywhere else, 出击 inside his own ring, 结阵 once the line is
// under way. Both the label and the ring are read back off the live battle, and
// the ring travelling with the chariot is the whole of 出击.
const orderButton = query("#touch-order");
const lineNow = game.state.allyFormations[0];
const seat = { x: lineNow.x, y: lineNow.y };
game.player.x = seat.x;
game.player.y = seat.y;
runFrames(1);
check("standing in his own line raises the order button",
  orderButton.hidden === false && orderButton.textContent === translate("battle.sortie"),
  `hidden=${orderButton.hidden} label="${orderButton.textContent}"`);

const ringOffset = () => ({ x: lineNow.x - game.player.x, y: lineNow.y - game.player.y });
orderButton.dispatch("click");
runFrames(1);
check("出击 puts the line in march and turns the button into 结阵",
  lineNow.order === "march" && orderButton.textContent === translate("battle.hold")
    && orderButton.dataset.order === "reform",
  `order=${lineNow.order} label="${orderButton.textContent}" data-order=${orderButton.dataset.order}`);

// One frame settles the ring onto the chariot (it was pitched at its spawn centre
// until the order); from here the attachment is rigid.
const orderOffset = ringOffset();
game.player.x = seat.x + 200;
game.player.y = seat.y + 120;
runFrames(2);
check("the marching ring travels with the chariot",
  Math.abs(ringOffset().x - orderOffset.x) < 1e-6 && Math.abs(ringOffset().y - orderOffset.y) < 1e-6,
  `offset=${ringOffset().x.toFixed(2)},${ringOffset().y.toFixed(2)}`
    + ` was ${orderOffset.x.toFixed(2)},${orderOffset.y.toFixed(2)}`);

orderButton.dispatch("click");
runFrames(1);
check("结阵 sets the line down and sends the bodies that were left behind home",
  lineNow.order === "hold" && lineNow.stragglers > 0
    && (game.state.allies ?? []).some((ally) => ally.returning === true),
  `order=${lineNow.order} stragglers=${lineNow.stragglers}`);
check("the button turns back into 出击 once the line is set down",
  orderButton.textContent === translate("battle.sortie") && orderButton.dataset.order === "march",
  `label="${orderButton.textContent}" data-order=${orderButton.dataset.order}`);

// Walking out of the ring takes the control away again: an order with no ring to
// act on would be a button that did nothing.
game.player.x = lineNow.x + 900;
game.player.y = lineNow.y + 900;
runFrames(1);
check("the order button goes away when the player leaves the ring", orderButton.hidden === true,
  `hidden=${orderButton.hidden}`);

// The keyboard path walks the same road - a desktop player has no touch control.
dispatchWindow("keydown", { key: "e" });
dispatchWindow("keyup", { key: "e" });
runFrames(1);
check("the order key does nothing outside a ring", lineNow.order === "hold", `order=${lineNow.order}`);
game.player.x = lineNow.x;
game.player.y = lineNow.y;
dispatchWindow("keydown", { key: "e" });
dispatchWindow("keyup", { key: "e" });
runFrames(1);
check("the order key marches the line the player stands in", lineNow.order === "march",
  `order=${lineNow.order}`);
game.campaign.friendlyFormations = 0;

// The defeat card is the other state of that same box, and the two lethal blows
// are what the game itself needs: the first wrecks the chariot and puts the crew
// on foot, the second ends the run. Kill from a live battle rather than from the
// shop, so the assertion is about a real end-of-run, not a forced mode.
game.stageManager.restartStage();
// The battle's takings are scoped to the battle: everything picked up on this
// field is rolled back when it is lost, and the retry starts the score from zero.
const purseAtEntry = game.campaign.entryGold;
game.campaign.totalGold = purseAtEntry + 250;
game.state.score = 640;
game.player.invulnerable = 0;
game.combat.damagePlayer(9999, 0, 0);
game.player.invulnerable = 0;
game.combat.damagePlayer(9999, 0, 0);
check("losing the battle raises the defeat card",
  game.state.mode === "over" && !query("#battle-card").classList.contains("hidden"),
  `mode=${game.state.mode}`);
check("a lost battle keeps none of the coin it collected",
  game.campaign.totalGold === purseAtEntry,
  `gold=${game.campaign.totalGold} entry=${purseAtEntry}`);
check("the defeat card states the purse the retry really leaves",
  query("#card-copy").textContent === translate("battle.defeatCopy", {
    gold: purseAtEntry, stage: game.campaign.stage,
  }),
  `copy="${query("#card-copy").textContent}"`);
check("the defeat card offers the retry action and hides the pause control",
  query("#card-action").textContent === translate("battle.retry")
    && query("#start-button").hidden === true,
  `action="${query("#card-action").textContent}" startHidden=${query("#start-button").hidden}`);

// ---- the last stage, the victory card, and the rest that follows it ----------
//
// The campaign's length is rolled before the first battle, so a run can be walked
// to its end without playing ten stages: retry after the defeat above, then tell
// the stage manager that this is the one. Everything below is the real runtime
// path — the squad spawns through placeBoss, the champions die through the same
// damageEnemy the combat system calls, the extraction opens when the last of them
// falls, and the walk to it ends the run instead of opening the shop.
const { VICTORY_LOCK_KEY } = await import(
  pathToFileURL(resolve(projectRoot, "src/game/victory-lock.js")).href
);
const { countdownLabel, lockWindowLabel } = await import(
  pathToFileURL(resolve(projectRoot, "src/ui/labels.js")).href
);

query("#card-button").dispatch("click");
check("the retry opens a battle again", game.state.mode === "running", `mode=${game.state.mode}`);
check("the retried battle starts its score from zero", game.state.score === 0, `score=${game.state.score}`);

// A numbered boss stage still fields exactly one champion: the squad belongs to
// the last stage alone. Stage 4 is a boss stage by the interval rule, so this is
// the shape every other boss battle has had.
{
  const numberedStage = campaignRules.bossStageMinimum + 1;
  game.campaign.finalStage = 0;
  game.campaign.stage = numberedStage;
  game.stageManager.restartStage();
  runFrames(1);
  const [champion] = game.state.bosses;
  check("a numbered boss stage is not the last battle",
    game.state.finalBattle === false && game.state.bosses.length === 1,
    `finalBattle=${game.state.finalBattle} bosses=${game.state.bosses.length}`);
  check("a numbered boss stage keeps the numbered readout",
    query("#wave").textContent === String(numberedStage).padStart(2, "0")
      && !query("#wave").classList.contains("is-final"),
    `wave="${query("#wave").textContent}"`);
  check("a single champion keeps its own name",
    query("#objective-label").textContent === translate("battle.boss")
      && query("#objective-count").textContent === `${Math.ceil(champion.health)} / ${champion.maxHealth}`,
    `label="${query("#objective-label").textContent}" count="${query("#objective-count").textContent}"`);
}

const finalStage = game.campaign.stage;
game.campaign.finalStage = finalStage;
game.stageManager.restartStage();
runFrames(2);
check("the stage the campaign ends on is the last battle", game.state.finalBattle === true,
  `finalStage=${game.campaign.finalStage} stage=${game.campaign.stage}`);
check("the last battle opens with the whole squad",
  game.state.bosses.length === campaignRules.finalSquad.length,
  `bosses=${game.state.bosses.length}`);
check("the squad stands on the battlefield",
  game.state.enemies.length >= campaignRules.finalSquad.length,
  `enemies=${game.state.enemies.length}`);
check("the stage box says FINAL instead of a number",
  query("#wave").textContent === translate("battle.finalStage")
    && query("#wave").classList.contains("is-final"),
  `wave="${query("#wave").textContent}"`);
check("the banner announces every champion",
  query("#boss-warning").hidden === false
    && query("#boss-warning-title").textContent === translate("battle.finalWarning")
    && query("#boss-warning-subtitle").textContent === translate("battle.bossSquadBanner", {
      name: translate(game.state.bosses[0].nameKey), count: game.state.bosses.length,
    }),
  `title="${query("#boss-warning-title").textContent}" subtitle="${query("#boss-warning-subtitle").textContent}"`);

const squadTotal = game.state.bosses.reduce((sum, boss) => sum + boss.maxHealth, 0);
check("the objective bar totals the squad instead of one champion",
  query("#objective-count").textContent === `${squadTotal} / ${squadTotal}`,
  `count="${query("#objective-count").textContent}"`);

const [firstVictim, ...remaining] = game.state.bosses;
game.damageEnemy(firstVictim, 1e6);
check("one champion down does not end the squad", game.state.bossDefeated === false,
  `destroyed=${game.state.bosses.filter((boss) => boss.destroyed).length}/${game.state.bosses.length}`);
for (const boss of remaining) game.damageEnemy(boss, 1e6);
check("the last champion down ends the squad", game.state.bossDefeated === true,
  `destroyed=${game.state.bosses.filter((boss) => boss.destroyed).length}/${game.state.bosses.length}`);

runFrames(2);
check("the extraction opens on the last stage", game.state.phase === "extract",
  `phase=${game.state.phase}`);
const extraction = game.state.extractionPoint;

// ---- the clan's gift ---------------------------------------------------------
//
// This is the stage the gift is tied to (`campaignRules.clanGrantStage`), so the
// card over the field is the clan's news first and the run's own victory card
// after it. The line is already the player's by the time he reads it - the shop
// would otherwise be the only place a line ever arrived from - and the gift is
// remembered on the campaign so a second battle on this stage cannot hand out a
// second one.
check("the battle is the one the gift is tied to",
  game.campaign.stage === campaignRules.clanGrantStage, `stage=${game.campaign.stage}`);
const gift = game.state.grant;
check("clearing that stage hands out the next rung of the ladder, unasked",
  gift !== null && game.campaign.formationGrant === true && game.campaign.friendlyFormations === gift?.count,
  `grant=${JSON.stringify(gift)} hires=${game.campaign.friendlyFormations}`);
check("the gift is the rung that follows what the run owns",
  gift?.count === 1 && gift?.nameKey === formationTiers[0].nameKey,
  `count=${gift?.count} name=${gift?.nameKey}`);
check("the gift names the player's own clan",
  gift?.clan === game.campaign.identity.clan, `clan=${gift?.clan}`);
check("the gift card takes the field, over the running battle",
  !query("#battle-card").classList.contains("hidden")
    && query("#card-title").textContent === translate("grant.title")
    && query("#card-copy").textContent === translate("grant.copy", { clan: gift?.clan }),
  `title="${query("#card-title").textContent}" copy="${query("#card-copy").textContent}"`);
check("the gift card names the rung and the count it leaves",
  query("#card-lines").children[0]?.textContent === translate("grant.line", {
    formation: translate(gift?.nameKey), count: gift?.count,
  }),
  `line="${query("#card-lines").children[0]?.textContent}"`);

// The card holds the field, gate included: the news is read with the player's
// hands off the controls, so standing in the circle while it is up is not the end
// of the run - and putting it away, standing in that same circle, is.
game.player.x = extraction.x;
game.player.y = extraction.y;
runFrames(1);
check("the gift card holds the whole field, gate included",
  game.state.mode === "running" && game.state.phase === "extract",
  `mode=${game.state.mode} phase=${game.state.phase}`);

const victoryScore = game.state.score;
const goldBeforeVictory = game.campaign.totalGold;
query("#card-button").dispatch("click");
runFrames(1);
check("putting the news away hands the field back",
  game.state.grant === null, `grant=${JSON.stringify(game.state.grant)}`);
check("reaching the extraction point wins the run instead of opening the shop",
  game.state.mode === "victory", `mode=${game.state.mode}`);

// The victory card was waiting behind the news: the gift is not a mode, so the
// run's own report was never interrupted.
check("closing the gift shows the victory card behind it",
  game.state.grant === null && game.state.mode === "victory"
    && query("#card-title").textContent === translate("victory.title"),
  `grant=${game.state.grant} mode=${game.state.mode} title="${query("#card-title").textContent}"`);

// The gift is a run's to keep, so the drill that follows is still a drill: no
// hired line marches into the player's own training.
check("the victory card takes the field",
  !query("#battle-card").classList.contains("hidden"),
  `hidden=${query("#battle-card").classList.contains("hidden")}`);
check("the card states the victory", query("#card-title").textContent === translate("victory.title"),
  `title="${query("#card-title").textContent}"`);
check("the card names the run that was won", query("#card-copy").textContent
  === translate("victory.subtitle", { name: identity.fullName, stage: finalStage }),
  `lede="${query("#card-copy").textContent}"`);
const victoryLines = query("#card-lines").children;
check("the card reports the score and the spoils", victoryLines[0]?.textContent
  === translate("victory.stats", { score: victoryScore, gold: game.campaign.totalGold }),
  `stats="${victoryLines[0]?.textContent}"`);
check("the spoils are banked before the run ends", game.campaign.totalGold >= goldBeforeVictory,
  `gold=${game.campaign.totalGold} before=${goldBeforeVictory}`);
check("the card states the rest it is about to enforce", victoryLines[1]?.textContent
  === translate("victory.lockNote", { time: lockWindowLabel() }),
  `note="${victoryLines[1]?.textContent}"`);

const storedVictory = JSON.parse(deviceStorage.get(VICTORY_LOCK_KEY) ?? "null");
check("the victory is written to storage as the card appears",
  storedVictory !== null && storedVictory.stage === finalStage && storedVictory.score === victoryScore,
  `stored=${deviceStorage.get(VICTORY_LOCK_KEY)}`);
check("the victory card leaves the loop's time base alone", game.state.lastTime === nextFrameTime,
  `lastTime=${game.state.lastTime} frameClock=${nextFrameTime}`);

query("#card-button").dispatch("click");
runFrames(1);
check("the card returns to the menu", game.state.mode === "menu", `mode=${game.state.mode}`);
check("the menu rests instead of offering a new run",
  menuPage.lastFrame().locked === true && menuStartProxy.hidden === true,
  `locked=${menuPage.lastFrame().locked} startHidden=${menuStartProxy.hidden}`);
check("the resting card paints the countdown", menuPage.lastFrame().headline
  === translate("menu.locked", { time: countdownLabel(game.victoryLock.remainingMs()) }),
  `headline="${menuPage.lastFrame().headline}"`);
check("the resting card names the run that earned it", menuPage.lastFrame().detail
  === translate("menu.lockedLast", { name: identity.fullName, stage: finalStage, score: victoryScore }),
  `detail="${menuPage.lastFrame().detail}"`);
// The canvas is opaque to a screen reader, so the one line that changes while the
// card is up is mirrored into the live region.
check("the resting countdown is announced", query("#menu-live").textContent.includes(
  menuPage.lastFrame().headline), `live="${query("#menu-live").textContent}"`);

// The card is not the gate: a start that arrives anyway must be refused, or a
// stale keypress would open the prologue behind the rest.
dispatchWindow("keydown", { key: "Enter" });
runFrames(1);
check("a start during the rest is refused", game.state.mode === "menu", `mode=${game.state.mode}`);
// And the painted slot has no target at all: a tap where 出征 used to be does
// nothing, which is what the resting card means. The refusal is synchronous -
// there is no target to deliver the release to - so the tap needs no frame.
const stalePoint = menuPoint(menuPage.lastFrame().startRect);
menuCanvas.dispatch("pointerdown", stalePoint);
menuCanvas.dispatch("pointerup", stalePoint);
check("a tap where the button used to be does nothing", game.state.mode === "menu",
  `mode=${game.state.mode}`);

// Rewind the record instead of waiting out the window, then prove the menu opens
// again: that is the whole life cycle, expiry included.
game.victoryLock.reset();
runFrames(1);
check("a cleared or expired rest unlocks the menu",
  menuPage.lastFrame().locked === false && menuStartProxy.hidden === false,
  `locked=${menuPage.lastFrame().locked} startHidden=${menuStartProxy.hidden}`);
dispatchWindow("keydown", { key: "Enter" });
check("a run starts again once the rest is over", game.state.mode === "prologue",
  `mode=${game.state.mode}`);

// ---- the tiger drill ---------------------------------------------------------
//
// The prologue's second door: two encounters on one battlefield, played as a
// scenario instead of a campaign stage. Everything below is the real runtime path
// - the button opens the drill, the cards are the same DOM card every other dialog
// uses (confirmed by a click and by Enter), the tiger and the line spawn through
// the enemy system's scenario entry points, and the clear hands the run into
// stage 1 through the shop.
// A drill is the player's own training, so the hire ladder never marches into it:
// the run's line is bought for the campaign's fields, and the drill's own 演武步阵
// is the only line it stands. The campaign is given a line here for the check
// alone and put back, because everything below this section is a diagram of a
// drill and not of a campaign battle.
game.campaign.friendlyFormations = 1;
query("#prologue-tutorial").dispatch("click");
const drill = () => game.state.tutorial;
check("the story card's tutorial button opens the drill",
  game.state.mode === "running" && game.state.battleMode === "tutorial",
  `mode=${game.state.mode} battleMode=${game.state.battleMode}`);
check("the drill opens on its first card, with the field frozen",
  drill()?.step === "brief" && drill().frozen === true && drill().overlay !== null,
  `step=${drill()?.step} frozen=${drill()?.frozen}`);
check("the stage tile says DRILL instead of a stage number",
  query("#wave").textContent === translate("battle.tutorialStage"),
  `wave="${query("#wave").textContent}"`);
check("the drill spawns one wild animal and rolls no campaign wave",
  game.state.wilds.length === 1 && game.state.enemies.length === 1 && game.state.formations.length === 0,
  `wilds=${game.state.wilds.length} enemies=${game.state.enemies.length} formations=${game.state.formations.length}`);
check("a hired line does not march into a drill",
  (game.state.allies ?? []).length === 0 && (game.state.allyFormations ?? []).length === 0,
  `hires=${game.campaign.friendlyFormations} allies=${(game.state.allies ?? []).length}`);
game.campaign.friendlyFormations = 0;
check("the objective counts the animal and both bands the drill stands",
  game.state.objectiveTarget === formationPresets.tutorialLine.slots.length
    + formationPresets.tutorialWave.slots.length + 1,
  `objective=${game.state.objectiveTarget}`);
check("the animal is a wild tiger, not a rank in a line",
  game.state.wilds[0].species === "tiger" && game.state.wilds[0].loot === "meat"
    && game.state.wilds[0].formationId === undefined);

// A frozen field really is frozen: nothing moves, nothing shoots, and the guide
// arrow stays off until the card has been read.
const frozenTiger = { x: game.state.wilds[0].x, y: game.state.wilds[0].y };
const frozenPlayer = { x: game.player.x, y: game.player.y };
runFrames(60);
check("a carded drill does not move the field",
  game.state.wilds[0].x === frozenTiger.x && game.state.wilds[0].y === frozenTiger.y
    && game.player.x === frozenPlayer.x && game.player.y === frozenPlayer.y,
  `tiger=${game.state.wilds[0].x},${game.state.wilds[0].y} player=${game.player.x},${game.player.y}`);
check("a carded drill shows no objective arrow", query("#extraction-guide").hidden === true);

// The card is DOM, so it is read the way a player sees it: a title, one line per
// beat, and one button. Nothing on it is measured - the browser wraps and scrolls.
const briefCopy = drill().overlay;
check("the drill's first beat is painted on the one card",
  !query("#battle-card").classList.contains("hidden")
    && query("#card-title").textContent === translate(briefCopy.titleKey)
    && query("#card-action").textContent === translate("tutorial.confirm"),
  `title="${query("#card-title").textContent}" action="${query("#card-action").textContent}"`);
check("the card takes the wider measure for the drill's paragraphs",
  query("#battle-card").dataset.width === "wide", `width=${query("#battle-card").dataset.width}`);
const briefLines = query("#card-lines").children;
check("the card holds one line per beat, in the drill's order",
  briefLines.length === briefCopy.bodyKeys.length
    && briefLines.every((line, index) => line.textContent === translate(briefCopy.bodyKeys[index])
      && line.dataset.tone === "body"),
  `lines=${briefLines.map((line) => line.textContent).join(" / ")}`);
// The drill is played by thumb, not by keyboard: no line on the card may name a
// key the player has no way to press.
const keyHint = /空格|space|WASD|Enter|↑|↓|←|→/i;
check("the brief talks about the joystick and the fire button, not the keyboard",
  !keyHint.test([translate(briefCopy.titleKey), ...briefCopy.bodyKeys.map((key) => translate(key)),
    translate("tutorial.confirm")].join("")),
  `card="${briefCopy.bodyKeys.map((key) => translate(key)).join(" / ")}"`);
query("#card-button").dispatch("click");
check("clicking the card's button hands the field over",
  drill()?.step === "hunt" && drill().frozen === false && drill().overlay === null,
  `step=${drill()?.step} frozen=${drill()?.frozen}`);
check("the hunt names its target on the HUD and points the guide at it",
  query("#objective-label").textContent === translate("tutorial.huntLabel")
    && query("#extraction-guide-label").textContent === translate("tutorial.guide")
    && query("#extraction-guide").hidden === false,
  `label="${query("#objective-label").textContent}"`);

// A pause is not a second opening beat: `arm()` is idempotent per battle.
dispatchWindow("keydown", { key: "p" });
runFrames(2);
dispatchWindow("keyup", { key: "p" });
dispatchWindow("keydown", { key: "p" });
runFrames(2);
dispatchWindow("keyup", { key: "p" });
check("a paused and resumed drill keeps the field it had",
  game.state.wilds.length === 1 && drill()?.step === "hunt",
  `wilds=${game.state.wilds.length} step=${drill()?.step}`);

// The animal falls: its meat is the one drop that pays no coin.
const tiger = game.state.wilds[0];
game.damageEnemy(tiger, 999);
runFrames(2);
check("the tiger's body leaves meat, not coin",
  game.state.drops.some((drop) => drop.type === "meat")
    && game.state.drops.every((drop) => drop.type !== "meat" || drop.value === 0),
  `drops=${game.state.drops.map((drop) => `${drop.type}:${drop.value}`).join(",")}`);
check("the drill forms its line and pans the camera to it",
  drill()?.step === "pan" && game.state.formations.length === 1
    && drill().line.length === formationPresets.tutorialLine.slots.length
    && game.state.cameraFocus !== null,
  `step=${drill()?.step} formations=${game.state.formations.length} line=${drill()?.line?.length}`);
// The line is placed against the chariot's live position, so the pan always has
// somewhere to go: it stands a screen away from where the player is now.
const lineSpan = Math.hypot(
  game.state.formations[0].x - game.player.x,
  game.state.formations[0].y - game.player.y,
);
check("the line forms a screen away from wherever the chariot is standing",
  lineSpan > 400 && game.state.cameraFocus.x === game.state.formations[0].x
    && game.state.cameraFocus.y === game.state.formations[0].y,
  `line is ${lineSpan.toFixed(0)}px from the chariot, focus=${JSON.stringify(game.state.cameraFocus)}`);

check("the formed line is the drill's own preset, on cleared ground",
  game.state.formations[0].id === "preset-tutorialLine" && game.state.formations[0].groundTier === "dry",
  `id=${game.state.formations[0].id} tier=${game.state.formations[0].groundTier}`);

const panStart = { x: game.camera.x, y: game.camera.y };
runFrames(30);
check("the pan is a camera move, not a teleport",
  game.camera.x !== panStart.x || game.camera.y !== panStart.y,
  `camera=${game.camera.x},${game.camera.y}`);
check("the pan holds the field while it runs", drill()?.frozen === true && drill()?.step === "pan",
  `step=${drill()?.step}`);

runFrames(90);
check("the pan ends on the tactics card",
  drill()?.step === "tactics" && drill().frozen === true && drill().overlay !== null
    && !query("#battle-card").classList.contains("hidden"),
  `step=${drill()?.step}`);
const tacticsCopy = drill().overlay;
check("the tactics card describes the three things in the line",
  tacticsCopy.bodyKeys?.length === 3 && query("#card-lines").children.length === 3,
  `beats=${tacticsCopy?.bodyKeys?.length} lines=${query("#card-lines").children.length}`);
check("the tactics card has no keyboard hints on it either",
  !keyHint.test([translate(tacticsCopy.titleKey),
    ...tacticsCopy.bodyKeys.map((key) => translate(key)), translate("tutorial.confirm")].join("")),
  `card="${tacticsCopy.bodyKeys.map((key) => translate(key)).join(" / ")}"`);
// Three beats used to need a measurement to stay inside the canvas. The card is a
// DOM box now: styles/game.css lets it wrap and scroll, so the one thing left to
// prove is that its button is still the way out of a frozen field.
check("the taller card keeps its button",
  query("#card-button").dataset.action === "tutorial"
    && query("#card-action").textContent === translate("tutorial.confirm"),
  `action="${query("#card-action").textContent}"`);
check("the tactics card raises nothing of its own", game.state.fireHeld === false && game.state.fireHold === 0);
dispatchWindow("keydown", { key: " " });
dispatchWindow("keyup", { key: " " });
check("the tactics card's Space confirms and walks the camera back",
  drill()?.step === "return" && game.state.cameraFocus === null && drill().frozen === true
    && game.state.fireHeld === false,
  `step=${drill()?.step} focus=${game.state.cameraFocus} fireHeld=${game.state.fireHeld}`);

runFrames(100);
check("the camera returns and hands the field back",
  drill()?.step === "engage" && drill().frozen === false && drill().objective !== null,
  `step=${drill()?.step}`);
check("the engagement points the guide at the line",
  query("#extraction-guide").hidden === false
    && query("#objective-label").textContent === translate("tutorial.lineLabel"),
  `label="${query("#objective-label").textContent}"`);

// The first band falls and the drill does *not* end: the clan lends the player a
// line for the last encounter. The extraction stays shut, because a drill answers
// to its script and not to a body count.
for (const unit of drill().line) game.damageEnemy(unit, 999);
runFrames(2);
check("the first band's fall musters the clan's squad instead of ending the drill",
  drill()?.step === "muster" && game.state.allyFormations.length === 1
    && game.state.phase === "combat",
  `step=${drill()?.step} lines=${game.state.allyFormations.length} phase=${game.state.phase}`);
check("the muster is the same card, with the loan's two beats on it",
  !query("#battle-card").classList.contains("hidden")
    && query("#card-title").textContent === translate("tutorial.muster.title")
    && query("#card-lines").children.length === 2,
  `title="${query("#card-title").textContent}" lines=${query("#card-lines").children.length}`);
const squadLine = game.state.allyFormations[0];
check("the borrowed squad is a line he can order and never bought",
  squadLine.tier === -1 && squadLine.owner === "player"
    && squadLine.nameKey === "formation.friendly" && game.campaign.friendlyFormations === 0,
  `tier=${squadLine.tier} owner=${squadLine.owner} hires=${game.campaign.friendlyFormations}`);
check("the muster forms off screen and the camera goes to it",
  Math.hypot(squadLine.x - game.player.x, squadLine.y - game.player.y) > 400
    && game.state.cameraFocus !== null,
  `gap=${Math.hypot(squadLine.x - game.player.x, squadLine.y - game.player.y).toFixed(0)}`);

// The drill is not the kill count. With every body a campaign stage would need
// already dead, the scenario still holds the extraction shut.
game.state.kills = game.state.objectiveTarget;
runFrames(2);
check("a drill answers to its scenario, not to the kill count",
  game.state.phase === "combat" && game.state.tutorial !== null,
  `phase=${game.state.phase} kills=${game.state.kills} target=${game.state.objectiveTarget}`);

query("#card-button").dispatch("click");
runFrames(1);
check("the muster hands over to the orders, with the arrow on the ring",
  drill()?.step === "orders" && drill().frozen === false
    && query("#objective-label").textContent === translate("tutorial.orderLabel"),
  `step=${drill()?.step} label="${query("#objective-label").textContent}"`);

// 出击 and 结阵, from inside the ring, by thumb: one tap on the order button each.
game.player.x = squadLine.x;
game.player.y = squadLine.y;
runFrames(1);
check("standing in the borrowed ring raises the order button",
  orderButton.hidden === false && orderButton.textContent === translate("battle.sortie"),
  `hidden=${orderButton.hidden} label="${orderButton.textContent}"`);
orderButton.dispatch("click");
runFrames(2);
check("出击 is the drill's first order",
  drill()?.hud.count === 1 && squadLine.order === "march" && drill().step === "orders",
  `count=${drill()?.hud.count} order=${squadLine.order} step=${drill()?.step}`);
orderButton.dispatch("click");
runFrames(2);
check("结阵 is the second, and it sets the ring down before the next band",
  drill()?.hud.count === 2 && squadLine.order === "hold" && squadLine.stragglers > 0,
  `count=${drill()?.hud.count} order=${squadLine.order} stragglers=${squadLine.stragglers}`);

// The settle is a beat of the field, then the camera pans to the second band.
runFrames(80);
check("the second band forms while the ranks close",
  game.state.formations.some((formation) => formation.id === "preset-tutorialWave"),
  `formations=${game.state.formations.map((formation) => formation.id).join(",")}`);
runFrames(90);
check("the drill hands the last encounter over, with the squad still standing",
  drill()?.step === "squadEngage" && drill().frozen === false
    && query("#objective-label").textContent === translate("tutorial.squadLabel"),
  `step=${drill()?.step} label="${query("#objective-label").textContent}"`);
check("the second band is twice the first, and the squad is still on the field",
  drill().wave.length === formationPresets.tutorialWave.slots.length
    && game.state.allies.length === formationPresets.tutorialSquad.slots.length,
  `band=${drill().wave.length} squad=${game.state.allies.length}`);

for (const unit of drill().wave) game.damageEnemy(unit, 999);
runFrames(2);
check("the last of the second band clears the drill and opens the extraction",
  game.state.tutorial === null && game.state.phase === "extract" && game.campaign.tutorialHandoff === true,
  `tutorial=${game.state.tutorial} phase=${game.state.phase} handoff=${game.campaign.tutorialHandoff}`);
check("the loan goes home: no borrowed bodies and no line bought",
  game.state.allies.length === 0 && game.state.allyFormations.length === 0
    && game.campaign.friendlyFormations === 0,
  `allies=${game.state.allies.length} lines=${game.state.allyFormations.length}`
    + ` hires=${game.campaign.friendlyFormations}`);
check("the cleared drill goes back to pointing at the extraction point",
  query("#extraction-guide").hidden === false
    && query("#extraction-guide-label").textContent === translate("battle.extractGuide"),
  `label="${query("#extraction-guide-label").textContent}"`);

// Walk to the extraction and the drill hands the shop a stage-1 campaign.
game.player.x = game.state.extractionPoint.x;
game.player.y = game.state.extractionPoint.y;
runFrames(3);
check("the cleared drill opens the shop instead of the victory card",
  game.state.mode === "shop", `mode=${game.state.mode}`);
check("the drill was stage 1 and did not advance the run",
  game.campaign.stage === 1, `stage=${game.campaign.stage}`);
// The footer's button is canvas now, so the drill leaves the shop the same way a
// finger would: a press and a release on the rect the last frame registered.
runFrames(1);
tapRect(shopFrame().next);
runFrames(2);
check("the shop after a drill leads into the campaign's stage 1",
  game.state.mode === "running" && game.state.battleMode === "campaign"
    && game.campaign.stage === 1 && game.campaign.tutorialHandoff === false,
  `mode=${game.state.mode} battleMode=${game.state.battleMode} stage=${game.campaign.stage}`);
check("the campaign battle after a drill has no tiger in it",
  game.state.tutorial === null && game.state.wilds.length === 0
    && game.state.enemies.every((unit) => unit.wild !== true),
  `wilds=${game.state.wilds.length}`);
check("the stage tile counts the campaign again",
  query("#wave").textContent === String(game.campaign.stage).padStart(2, "0"),
  `wave="${query("#wave").textContent}"`);

check("no errors after UI interactions", loggedErrors.length === 0, loggedErrors[0]);
checkCamera("after UI interactions");
check("no non-finite geometry after UI interactions", nonFiniteDraws.length === 0, nonFiniteDraws.slice(0, 3).join(" | "));
console.log(failures.length === 0 ? "\n[smoke] PASS" : `\n[smoke] FAIL: ${failures.join("; ")}`);
if (traceHash) {
  console.log(`[smoke] trace=${traceHash.digest("hex")} frames=${traceLog.length ? traceLog.length : "hashed"}`);
  if (process.env.H5_TRACE_LOG) writeFileSync(process.env.H5_TRACE_LOG, `${traceLog.join("\n")}\n`);
}
if (drawHash) console.log(`[smoke] draw=${drawHash.digest("hex")} calls=${drawCalls}`);
if (process.env.H5_TRACE_DRAW_LOG) writeFileSync(process.env.H5_TRACE_DRAW_LOG, `${drawLog.join("\n")}\n`);
process.exitCode = failures.length === 0 ? 0 : 1;
