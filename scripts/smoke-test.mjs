// Headless smoke test: boots the real game modules (main.js) against a stub DOM
// and drives hundreds of frames with movement + attack input. Usage:
//   node scripts/smoke-test.mjs
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { projectileRules } from "../src/data/rules.js";

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
  "investigateTimer", "attackCooldown", "shotCooldown", "contactCooldown",
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
// the focused unit test). A unit that just lost sight spends up to ~1.9s easing
// round from its combat heading, so each unit is latched as settled once it is
// first inside the band and only checked from then on.
const idleScan = { states: new WeakMap(), widest: 0, bandBreak: null, settled: 0, drifters: 0, quietClearance: 0 };
function sampleIdleScan() {
  for (const enemy of game?.state?.enemies ?? []) {
    if (enemy.destroyed) continue;
    let entry = idleScan.states.get(enemy);
    if (!entry) idleScan.states.set(enemy, entry = { settled: false, widest: 0 });
    const idle = !enemy.seesPlayer && !(enemy.investigateTimer > 0)
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

for (const [frameBlock, key] of [[120, "w"], [120, "a"], [120, "w"], [120, "d"], [120, "s"], [120, "w"], [180, "d"]]) {
  dispatchWindow("keydown", { key });
  tapFire(frameBlock, sampleEnemies);
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

// Foot phase ---------------------------------------------------------------
// Everything above runs in the chariot, so the trace never reached the dismount,
// the companion build, or their per-frame loop - which is exactly the code a
// player/crew refactor rewrites. Roll a fresh battle through the production
// "next battle" path, hire one archer and one halberdier (one of each row, so the
// volley fan is measured over the archers alone), and die through the real
// damage path so `dismountPlayer` runs rather than being called directly.
game.stageManager.rollForNextBattle();
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
    // is the *closest* companion rather than the farthest - the follow loop walks
    // straight at its slot with no pathfinding, so one companion can snag on a
    // wall corner while the group is fine. A broken loop would strand them all.
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

// The shop dossier. Entering the shop re-renders the ledger and starts the
// preview's own clock; a hovered purchase must never outlive the render that
// follows it (a stale preview would show a team the player never bought).
game.stageManager.enterShop();
runFrames(45);
const shopFrame = game.shopScene.lastFrame();
check("entering the shop shows the dossier", query("#shop-screen").hidden === false, `mode=${game.state.mode}`);
check("the shop preview drew the chariot", Boolean(shopFrame.rig), "no rig frame");
check("the shop preview drew the camp fire", Boolean(shopFrame.camp), "no camp frame");
check("the preview rig is fitted to its canvas", shopFrame.rig?.scale > 0, `scale=${shopFrame.rig?.scale}`);
check("the shop opens on the owned team, not a preview", shopFrame.rig?.isPreview === false,
  `isPreview=${shopFrame.rig?.isPreview}`);

game.shopScene.preview({ horseCount: game.campaign.horseCount + 1, crew: game.campaign.roster });
check("a hovered purchase previews before it is bought", game.shopScene.lastFrame().rig?.isPreview === true,
  "preview did not take");
game.equipmentShop.render();
check("re-rendering the ledger clears the hover preview", game.shopScene.lastFrame().rig?.isPreview === false,
  "stale preview survived the render");
check("the shop rig follows the owned team", game.shopScene.lastFrame().rig?.horseCount === game.campaign.horseCount,
  `drew ${game.shopScene.lastFrame().rig?.horseCount} horses, owns ${game.campaign.horseCount}`);

// The ledger's cards are titles, effect lines and prices; the long descriptions
// live in the one info panel under the summary, which follows the pointer and
// keeps a click. `#shop-items` holds [tabs, equipment, horses, crew].
const { translate } = await import("../src/i18n/index.js");
const shopInfo = query("#shop-info");
const ruleLine = `${translate("shop.collision.label")}${translate("shop.collision.description")}`;
const weaponRackLine = translate("shop.info.label", { name: translate("equipment.weaponRack.name") })
  + translate("equipment.weaponRack.description");
const ledger = query("#shop-items").children;
check("the shop opens on the standing collision rule",
  shopInfo.textContent === ruleLine && !shopInfo.classList.contains("is-item"),
  `panel="${shopInfo.textContent}"`);
check("shop cards keep their description out of the card",
  ledger[1].children.every((card) => card.children[1].children.length === 2),
  `${ledger[1].children[0].children[1].children.length} blocks in the first card`);

// A tap is not a hover: on a phone `pointerenter` arrives a frame before
// `pointerup`, and a panel repainted there changed its height and pulled the
// ledger up - the 购置 button slid out from under the finger and the tap fell
// through to the card behind it. Only a mouse may repaint the panel on entry.
ledger[1].children[0].dispatch("pointerenter", { pointerType: "touch" });
check("a touch entering a card leaves the panel alone",
  shopInfo.textContent === ruleLine, `panel="${shopInfo.textContent}"`);
ledger[1].children[0].dispatch("pointerleave", { pointerType: "touch" });

// A buy button that cannot be pressed has to say why: a dimmed "购置" reads as a
// broken button, "军资不足" reads as the next goal. Gold is forced here so both
// label states are checked whatever drops this run happened to collect.
const { equipment } = await import("../src/data/equipment.js");
const upgrade = equipment.find((item) => game.campaign.equipment[item.id] < item.levels.length);
if (upgrade) {
  const price = upgrade.levels[game.campaign.equipment[upgrade.id]].price;
  const cardIndex = equipment.indexOf(upgrade);
  const buyButton = () => query("#shop-items").children[1].children[cardIndex].children[2];
  const savedGold = game.campaign.totalGold;
  game.campaign.totalGold = 0;
  game.equipmentShop.render();
  check("an unaffordable purchase names the price instead of a dim 购置",
    buyButton().textContent === translate("shop.shortGold", { price }) && buyButton().disabled === true,
    `label="${buyButton().textContent}" disabled=${buyButton().disabled}`);
  game.campaign.totalGold = 99999;
  game.equipmentShop.render();
  check("an affordable purchase goes back to the buy label",
    buyButton().textContent === translate("shop.buy", { price }) && buyButton().disabled === false,
    `label="${buyButton().textContent}"`);
  game.campaign.totalGold = savedGold;
  game.equipmentShop.render();
}

const weaponRackCard = ledger[1].children[0];
weaponRackCard.dispatch("pointerenter");
check("hovering a card puts its description in the panel",
  shopInfo.textContent === weaponRackLine && shopInfo.classList.contains("is-item"),
  `panel="${shopInfo.textContent}"`);
weaponRackCard.dispatch("pointerleave");
check("leaving the card restores the standing rule", shopInfo.textContent === ruleLine,
  `panel="${shopInfo.textContent}"`);

weaponRackCard.dispatch("click");
check("clicking a card pins its description", shopInfo.textContent === weaponRackLine,
  `panel="${shopInfo.textContent}"`);
game.equipmentShop.render();
check("a pinned description survives the purchase re-render",
  shopInfo.textContent === weaponRackLine && shopInfo.classList.contains("is-item"),
  `panel="${shopInfo.textContent}"`);

ledger[0].children[1].dispatch("click");
check("switching tabs drops the pick back to the standing rule", shopInfo.textContent === ruleLine,
  `panel="${shopInfo.textContent}"`);
ledger[1].children[0].children[2].dispatch("click");
check("a buy click leaves that item's description in the panel", shopInfo.textContent === weaponRackLine,
  `panel="${shopInfo.textContent}"`);

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
