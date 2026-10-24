// Pure-logic regression tests for the gameplay rules that have no DOM
// dependency. Usage: node scripts/unit-test.mjs
import "./dom-stub.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  calculateArrowDamage, calculateChariotCollisionDamage, calculateChariotStats,
  calculateHullHealth, calculateMobilityMultiplier, calculateProtectionChance,
  emptyEquipment, equipment, horses, personnel,
} from "../src/data/equipment.js";
import { campaignRules, chariotRules, effectRules, projectileRules } from "../src/data/rules.js";
import { addBloodStain } from "../src/game/blood.js";
import { selectAimTarget } from "../src/game/aim.js";
import { battlefields } from "../src/data/battlefields.js";
import { createCollisionSystem } from "../src/game/collision.js";
import { createCombatSystem } from "../src/game/combat.js";
import { cloudKinds, elementRules, obstacleKinds, terrainKinds } from "../src/data/elements.js";
import {
  clearsSight, cloudDrift, elementBoundingRadius, elementCullMargin, elementGap, elementIntersects,
  elementSpeedAt, obstacleShape, rectHitsAnyObstacle, rectTerrain,
} from "../src/game/elements.js";
import { createBattlefield } from "../src/game/map.js";
import { createElementRenderer } from "../src/render/elements.js";
import { chariotRigBox, createSpriteArt, spritePalette } from "../src/render/sprites.js";
import { CHARIOT_CONTROL_CONFIG, createPlayerController } from "../src/game/player.js";
import { bossTypes, enemyStats, formationPatterns } from "../src/data/formations.js";
import {
  createBallisticProjectile, createProjectileSystem, solveBallisticElevation,
  solveTimeToGround, updateProjectiles,
} from "../src/game/projectiles.js";
import { createEnemies } from "../src/game/units/enemies.js";
import {
  chasePoint, formationExtent, formationGroundExtent, isInsideFormation, updateFormationAlerts,
} from "../src/game/units/formations.js";
import { clamp, shortestAngleDifference } from "../src/utils/math.js";
import { createRandomSeed, createSeededRandom, parseSeed } from "../src/utils/random.js";
import { updateCamera } from "../src/render/camera.js";
import {
  campSeats, crewBanner, crewFigure, crewRobe, playerRobe, projectRigBox, radarLayout,
  radarPolygon, rigPreview, statKeys, statLabelKeys,
} from "../src/ui/shop-layout.js";
import { createRadarChart } from "../src/ui/radar.js";
import { createShopScene } from "../src/ui/shop-scene.js";
import { createInfoPanel, itemInfo } from "../src/ui/shop-info.js";
import { translate } from "../src/i18n/index.js";
import { locales } from "../src/i18n/locales.js";

let passed = 0;
function test(name, run) {
  run();
  passed += 1;
  console.log(`  ok   ${name}`);
}

console.log("[unit] data rules");

test("base chariot stats come from the shared rule table", () => {
  const stats = calculateChariotStats(emptyEquipment(), 1);
  assert.deepEqual(stats, chariotRules.baseStats);
});

test("derived stats use the shared conversions", () => {
  const stats = calculateChariotStats(emptyEquipment(), 1);
  assert.equal(calculateHullHealth(stats), stats.stability * chariotRules.hullPerStability);
  assert.equal(
    calculateMobilityMultiplier(stats),
    chariotRules.mobilityMultiplierBase + stats.mobility * chariotRules.mobilityMultiplierPerPoint,
  );
  assert.equal(calculateProtectionChance(stats), stats.protection * chariotRules.protectionChancePerPoint);
  assert.equal(calculateArrowDamage(emptyEquipment(), 1), stats.firepower * chariotRules.arrowDamagePerFirepower);
});

test("stats stay inside the configured bounds", () => {
  const maxed = Object.fromEntries(equipment.map((item) => [item.id, item.levels.length]));
  const stats = calculateChariotStats(maxed, horses.max);
  for (const value of Object.values(stats)) {
    assert.ok(value >= chariotRules.minimumStat && value <= chariotRules.maximumStat, `stat out of range: ${value}`);
  }
});

test("every equipment level is priced and shaped consistently", () => {
  for (const item of equipment) {
    assert.ok(item.levels.length > 0, `${item.id} has no levels`);
    for (const level of item.levels) {
      assert.equal(typeof level.price, "number");
      assert.ok(level.price > 0, `${item.id} level must cost gold`);
      for (const bonus of Object.values(level.bonuses ?? {})) assert.ok(bonus > 0, `${item.id} bonus must be positive`);
      for (const penalty of Object.values(level.penalties ?? {})) assert.ok(penalty > 0, `${item.id} penalty must be positive`);
    }
  }
});

test("collision damage starts at 1 and adds the rim upgrades", () => {
  assert.equal(calculateChariotCollisionDamage(emptyEquipment()), 1);
  const rim = equipment.find((item) => item.id === "shaftWheelRim");
  const upgraded = { ...emptyEquipment(), shaftWheelRim: 3 };
  const expected = 1 + rim.levels.slice(0, 3).reduce((total, level) => total + level.collisionDamage, 0);
  assert.equal(calculateChariotCollisionDamage(upgraded), expected);
});

test("campaign cadence matches the codified constants", () => {
  const objectiveFor = (stage) => campaignRules.objectiveBase
    + Math.min(stage - 1, campaignRules.objectiveStageCap) * campaignRules.objectiveStep;
  assert.equal(objectiveFor(1), 8);
  assert.equal(objectiveFor(5), 16);
  assert.equal(objectiveFor(9), 16);
  const isBossStage = (stage) => stage % campaignRules.bossStageInterval === 0
    && stage >= campaignRules.bossStageMinimum;
  assert.equal(isBossStage(3), false);
  assert.equal(isBossStage(4), true);
  assert.equal(isBossStage(6), true);
});

test("personnel prices are positive and roles stay unique", () => {
  const roles = new Set();
  for (const member of personnel) {
    assert.ok(member.price > 0);
    assert.ok(member.health > 0 && member.damage > 0 && member.range > 0 && member.cooldown > 0);
    assert.ok(!roles.has(member.id), `duplicate role ${member.id}`);
    roles.add(member.id);
  }
});

console.log("[unit] angle math");

test("shortestAngleDifference wraps across the +/-pi seam", () => {
  const half = Math.PI / 2;
  assert.ok(Math.abs(shortestAngleDifference(0, half) - half) < 1e-12);
  assert.ok(Math.abs(shortestAngleDifference(half, 0) + half) < 1e-12);
  // 0.1 rad past the seam is 0.1 rad across it, not ~6.18 rad the long way round.
  assert.ok(Math.abs(Math.abs(shortestAngleDifference(3.1, -3.1)) - 0.0832) < 1e-3);
  // A digitising seam at exactly pi is allowed to land on either end of the range.
  for (const delta of [Math.PI, -Math.PI]) {
    assert.ok(Math.abs(Math.abs(shortestAngleDifference(0, delta)) - Math.PI) < 1e-12);
  }
  for (const from of [-7, -1, 0, 2.5, 9]) {
    for (const to of [-8, -0.5, 1, 6, 12]) {
      const shortest = shortestAngleDifference(from, to);
      assert.ok(Math.abs(shortest) <= Math.PI + 1e-12, `${from}->${to} left the range`);
      // Reconstructing the target must land on the same heading, mod 2pi (never
      // on the opposite one, which is what a `sin`-only check would let through).
      const rebuilt = from + shortest - to;
      assert.ok(Math.abs(Math.sin(rebuilt)) < 1e-9 && Math.cos(rebuilt) > 0.999999,
        `${from}->${to} did not reconstruct (${rebuilt})`);
    }
  }
});

console.log("[unit] camera");

const cameraWorld = { width: 2400, height: 1600 };
const cameraView = { width: 960, height: 592 };

function settledCamera(delta, player = { x: 1200, y: 800 }) {
  const camera = { x: 0, y: 0 };
  updateCamera({ player, world: cameraWorld, view: cameraView, camera }, delta);
  return camera;
}

test("a normal frame eases the camera toward the player", () => {
  const camera = settledCamera(1 / 60);
  assert.ok(camera.x > 0 && camera.x < 720, `camera.x=${camera.x}`);
  assert.ok(camera.y > 0 && camera.y < 504, `camera.y=${camera.y}`);
});

test("a negative or non-finite delta never moves the camera", () => {
  // -1.8e9 is what the first frame of a battle saw when the clock was stamped
  // from performance.now(); a negative easing would ease *away* from the player.
  for (const delta of [-1.8e9, -0.016, NaN, Infinity, -Infinity, undefined]) {
    const camera = settledCamera(delta);
    assert.equal(camera.x, 0, `delta ${delta} moved camera.x to ${camera.x}`);
    assert.equal(camera.y, 0, `delta ${delta} moved camera.y to ${camera.y}`);
  }
});

test("a stalled frame is clamped instead of teleporting the camera", () => {
  assert.deepEqual(settledCamera(5), settledCamera(0.05));
});

test("a poisoned camera re-seats instead of staying NaN", () => {
  for (const poisoned of [NaN, Infinity, -Infinity]) {
    const camera = { x: poisoned, y: poisoned };
    updateCamera({ player: { x: 1200, y: 800 }, world: cameraWorld, view: cameraView, camera }, 1 / 60);
    assert.equal(camera.x, 720, `camera.x=${camera.x}`);
    assert.equal(camera.y, 504, `camera.y=${camera.y}`);
  }
});

test("a non-finite player position cannot poison the camera", () => {
  const camera = { x: 100, y: 100 };
  updateCamera({ player: { x: NaN, y: 800 }, world: cameraWorld, view: cameraView, camera }, 1 / 60);
  assert.ok(Number.isFinite(camera.x) && Number.isFinite(camera.y), `camera=${camera.x},${camera.y}`);
  assert.equal(camera.x, 0);
});

console.log("[unit] seeded random");

test("the same seed replays the same stream", () => {
  const first = createSeededRandom(12345);
  const second = createSeededRandom(12345);
  for (let index = 0; index < 50; index += 1) assert.equal(first(), second());
});

test("different seeds diverge and values stay normalised", () => {
  const first = createSeededRandom(1);
  const second = createSeededRandom(2);
  const firstRun = Array.from({ length: 20 }, () => first());
  const secondRun = Array.from({ length: 20 }, () => second());
  assert.notDeepEqual(firstRun, secondRun);
  for (const value of [...firstRun, ...secondRun]) assert.ok(value >= 0 && value < 1, `out of range: ${value}`);
});

test("the launch seed is parsed from a string or a number", () => {
  assert.equal(parseSeed("42"), 42);
  assert.equal(parseSeed(7), 7);
  assert.equal(parseSeed("12abc"), 12, "a trailing suffix must not discard the seed");
  assert.equal(parseSeed("-1"), 0xffffffff, "seeds are held as unsigned 32-bit values");
});

test("an unusable launch seed falls back to a random one", () => {
  for (const raw of [null, undefined, "", "nope", "NaN", {}]) {
    assert.equal(parseSeed(raw), null, `parseSeed(${String(raw)}) should be null`);
    const fallback = createRandomSeed(raw);
    assert.ok(Number.isInteger(fallback) && fallback >= 0 && fallback <= 0xffffffff, `unexpected seed: ${fallback}`);
  }
  assert.equal(createRandomSeed("42"), 42, "a valid launch seed must win over the fallback");
});

console.log("[unit] collision");

const world = { width: 1000, height: 800 };
const campaign = {
  obstacles: [{ type: "tree", x: 500, y: 400, radius: 40 }],
  terrain: [{ type: "shallows", x: 100, y: 100, radiusX: 120, radiusY: 90 }],
};
const collision = createCollisionSystem({ campaign, world });

test("entities are clamped inside the world", () => {
  const entity = { x: 995, y: 795 };
  collision.moveEntitySafely(entity, 200, 200, 12);
  assert.equal(entity.x, world.width - 12);
  assert.equal(entity.y, world.height - 12);
});

test("obstacles block movement and line of sight", () => {
  const entity = { x: 380, y: 400 };
  collision.moveEntitySafely(entity, 100, 0, 12);
  assert.equal(entity.x, 380, "walked into a tree");
  assert.equal(collision.hasLineOfSight(300, 400, 640, 400), false);
  assert.equal(collision.hasLineOfSight(300, 200, 640, 200), true);
});

test("terrain slows movement", () => {
  const entity = { x: 100, y: 100 };
  collision.moveEntitySafely(entity, 100, 0, 8);
  assert.ok(entity.x > 100 && entity.x < 200, `expected slowed travel, got ${entity.x}`);
});

// The sight index files every sight-blocking element into a uniform grid and each
// sample only visits its own cell, so these pin the two shapes it has to file, the
// rebuild when a battle installs a new list, and - the one that matters - that the
// indexed answer is identical to walking the whole list.
function referenceLineOfSight(obstacles, fromX, fromY, toX, toY) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const steps = Math.ceil(Math.hypot(dx, dy) / 12);
  for (let step = 1; step < steps; step += 1) {
    const fraction = step / steps;
    const x = fromX + dx * fraction;
    const y = fromY + dy * fraction;
    if (obstacles.some((obstacle) => clearsSight(obstacle) && elementIntersects(x, y, 2, obstacle))) return false;
  }
  return true;
}

test("line of sight follows whichever list the current battle installed", () => {
  const local = { obstacles: [], terrain: [] };
  const sight = createCollisionSystem({ campaign: local, world });
  assert.equal(sight.hasLineOfSight(100, 100, 900, 100), true, "an empty map blocks nothing");
  local.obstacles = [
    { type: "tree", x: 500, y: 100, radius: 40 },
    { type: "wall", x: 400, y: 300, width: 200, height: 40 },
  ];
  assert.equal(sight.hasLineOfSight(100, 100, 900, 100), false, "the tree must block the first line");
  assert.equal(sight.hasLineOfSight(100, 320, 900, 320), false, "the wall must block the second");
  assert.equal(sight.hasLineOfSight(100, 220, 900, 220), true, "the gap between them is clear");
  local.obstacles = [];
  assert.equal(sight.hasLineOfSight(100, 100, 900, 100), true, "a new battle must clear the index");
});

test("the indexed line of sight answers exactly like the full walk", () => {
  // A dense mixed list, so the sampled lines cross many cells and both shapes.
  const random = createSeededRandom(2024);
  const obstacles = [];
  for (let index = 0; index < 44; index += 1) {
    const x = 40 + random() * (world.width - 80);
    const y = 40 + random() * (world.height - 80);
    obstacles.push(index % 3 === 0
      ? { type: "wall", x, y, width: 60 + random() * 100, height: 30 + random() * 40 }
      : { type: "tree", x, y, radius: 24 + random() * 36 });
  }
  const sight = createCollisionSystem({ campaign: { obstacles, terrain: [] }, world });
  let blocked = 0;
  for (let index = 0; index < 500; index += 1) {
    const fromX = random() * world.width;
    const fromY = random() * world.height;
    const toX = random() * world.width;
    const toY = random() * world.height;
    const expected = referenceLineOfSight(obstacles, fromX, fromY, toX, toY);
    assert.equal(
      sight.hasLineOfSight(fromX, fromY, toX, toY), expected,
      `divergence for (${fromX}, ${fromY}) -> (${toX}, ${toY})`,
    );
    if (!expected) blocked += 1;
  }
  assert.ok(blocked > 50, `the sample must also contain blocked lines, got ${blocked}`);
});

console.log("[unit] map elements");

// The catalog is the contract: an instance carries only `type` and geometry, so a
// row that is missing a range or a silhouette would fail silently at runtime.
test("every element row declares the shape and the size ranges its instances use", () => {
  assert.ok(Object.keys(obstacleKinds).length > 0 && Object.keys(terrainKinds).length > 0);
  for (const [type, row] of Object.entries(obstacleKinds)) {
    assert.ok(row.weight > 0 && row.weight <= 1, `${type} has no placement weight`);
    assert.ok(["circle", "rect"].includes(row.shape), `${type} has an unknown shape`);
    assert.equal(typeof row.blocksMovement, "boolean", `${type} does not say whether it blocks movement`);
    assert.equal(typeof row.blocksSight, "boolean", `${type} does not say whether it blocks sight`);
    if (row.shape === "circle") {
      assert.equal(row.size.orient, undefined, `${type} is a circle but sizes an axis rect`);
      assert.ok(row.size.radius[0] > 0 && row.size.radius[0] < row.size.radius[1], `${type} radius range is empty or reversed`);
    } else {
      assert.equal(row.size.orient, "axis", `${type} is a rect with no layout`);
      assert.ok(row.size.long[0] < row.size.long[1], `${type} long side range is empty or reversed`);
      assert.ok(row.size.thin[0] < row.size.thin[1], `${type} thin side range is empty or reversed`);
      assert.ok(row.size.thin[1] < row.size.long[0], `${type} thin and long ranges overlap`);
    }
  }
  for (const [type, row] of Object.entries(terrainKinds)) {
    assert.ok(row.speed > 0 && row.speed < 1, `${type} is not a slowdown`);
    assert.ok(["min", "multiply"].includes(row.combine), `${type} has an unknown combine rule`);
    assert.ok(row.placement.count >= 1, `${type} never spawns`);
    assert.ok(row.size.radius[0] > 0 && row.size.radius[0] < row.size.radius[1], `${type} radius range is empty or reversed`);
    assert.ok(row.size.aspectX[0] < row.size.aspectX[1], `${type} has a flat aspectX range`);
    assert.ok(row.size.aspectY[0] < row.size.aspectY[1], `${type} has a flat aspectY range`);
  }
  const sky = cloudKinds.sky;
  assert.ok(sky.count >= 1, "no clouds will ever spawn");
  assert.ok(sky.size.width[0] < sky.size.width[1] && sky.size.height[0] < sky.size.height[1], "cloud size range is flat");
  assert.ok(sky.drift.speed[0] < sky.drift.speed[1], "cloud speed range is flat");
  assert.ok(sky.opacity[0] > 0 && sky.opacity[0] < sky.opacity[1], "cloud opacity range is empty or reversed");
  assert.ok(elementRules.obstacleTarget > 0 && elementRules.obstacleEdgeMargin > 0);
});

test("every row's visual.kind has a silhouette, and its palettes are full", () => {
  const { artKinds } = createElementRenderer({ context: {} });
  for (const [type, row] of Object.entries(obstacleKinds)) {
    assert.ok(artKinds.obstacle.includes(row.visual.kind), `${type} draws with an unknown silhouette "${row.visual.kind}"`);
  }
  for (const [type, row] of Object.entries(terrainKinds)) {
    assert.ok(artKinds.terrain.includes(row.visual.kind), `${type} draws with an unknown pattern "${row.visual.kind}"`);
  }
  for (const [type, row] of Object.entries(cloudKinds)) {
    assert.ok(artKinds.cloud.includes(row.visual.kind), `${type} draws with an unknown silhouette "${row.visual.kind}"`);
  }
  // Gradients read their stops positionally, so a short list paints `undefined`.
  for (const [type, row] of Object.entries(obstacleKinds)) {
    for (const [key, value] of Object.entries(row.visual)) {
      if (!Array.isArray(value) || key === "clusters" || key === "shadeOffset") continue;
      assert.ok(value.length > 0, `${type}.${key} is empty`);
      assert.ok(value.every((entry) => typeof entry === "string" && entry.length > 0), `${type}.${key} has a hole in it`);
    }
  }
  assert.equal(obstacleKinds.tree.visual.trunk.length, 3, "the trunk gradient reads three stops");
  assert.equal(obstacleKinds.tree.visual.canopy.length, 4, "the canopy gradient reads four stops");
  assert.equal(cloudKinds.sky.visual.shade.length, 3, "the cloud shadow reads three stops");
});
console.log("[unit] sprite art");

// A recording 2d context: enough of the API for the unit painters to run, plus
// the geometry extents of everything they paint. src/render/sprites.js declares
// the box its chariot rig occupies, and the shop fits the preview to that box -
// so "the rig is never clipped" is a fact about the art, not a number someone
// eyeballed at one team size.
function recordingContext() {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const grow = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
  };
  const box = (x, y, width, height) => {
    grow(x, y);
    grow(x + width, y + height);
  };
  const context = {
    canvas: { width: 800, height: 600 },
    save() {}, restore() {}, beginPath() {}, closePath() {}, fill() {}, stroke() {},
    translate() {}, rotate() {}, scale() {}, setTransform() {}, clip() {},
    moveTo: grow, lineTo: grow,
    arc: (x, y, radius) => box(x - radius, y - radius, radius * 2, radius * 2),
    arcTo: box,
    ellipse: (x, y, radiusX, radiusY) => box(x - radiusX, y - radiusY, radiusX * 2, radiusY * 2),
    quadraticCurveTo: (controlX, controlY, x, y) => { grow(controlX, controlY); grow(x, y); },
    bezierCurveTo: (c1x, c1y, c2x, c2y, x, y) => { grow(c1x, c1y); grow(c2x, c2y); grow(x, y); },
    rect: box, fillRect: box, strokeRect: box, roundRect: box, clearRect: box,
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => null,
  };
  return { context, bounds };
}

function measureRig(horseCount, crew = []) {
  const recorder = recordingContext();
  createSpriteArt({ context: recorder.context }).drawChariotRig({
    robeColor: "#17796f", horseCount, elapsed: 0.4, crew, banner: "#41b7a3",
  });
  return recorder.bounds;
}

test("the shared chariot rig fits the box the shop scales it into", () => {
  // Four horses is the widest team, and a full crew puts dots along the hull, so
  // measure the extremes as well as the empty rig.
  const fullCrew = ["archer", "halberdier", "archer", "halberdier"].map((role) => ({ role }));
  for (const horseCount of [1, 2, 3, 4]) {
    for (const crew of [[], fullCrew]) {
      const drawn = measureRig(horseCount, crew);
      const box = chariotRigBox(horseCount);
      assert.ok(box.minX <= drawn.minX && box.maxX >= drawn.maxX,
        `a ${horseCount}-horse rig paints past its box horizontally (${drawn.minX}..${drawn.maxX} vs ${box.minX}..${box.maxX})`);
      assert.ok(box.minY <= drawn.minY && box.maxY >= drawn.maxY,
        `a ${horseCount}-horse rig paints past its box vertically (${drawn.minY}..${drawn.maxY} vs ${box.minY}..${box.maxY})`);
    }
  }
});

test("the rig box grows with the team, so a preview never clips a bigger team", () => {
  let previous = chariotRigBox(1);
  for (const horseCount of [2, 3, 4]) {
    const box = chariotRigBox(horseCount);
    assert.ok(box.width >= previous.width && box.height >= previous.height,
      `${horseCount} horses is not at least as big as ${horseCount - 1}`);
    previous = box;
  }
  assert.ok(chariotRigBox(4).height > chariotRigBox(1).height, "a full team is not taller than a single horse");
});

test("every overlay a data row asks for is painted by the shared art", () => {
  // `visual.overlays` is a list of names resolved against the art tables, so a
  // typo in a row is an invisible missing weapon, not a crash.
  const { overlayKinds } = createSpriteArt({ context: recordingContext().context });
  for (const [type, row] of Object.entries(enemyStats)) {
    const painted = overlayKinds[row.visual.kind];
    if (!painted) {
      assert.equal(row.visual.overlays.length, 0,
        `${type} asks for overlays but the "${row.visual.kind}" silhouette has none`);
      continue;
    }
    for (const overlay of row.visual.overlays) {
      assert.ok(painted.includes(overlay), `${type} asks for a "${overlay}" the ${row.visual.kind} art never painted`);
    }
  }
});

test("the battlefield unit art has exactly one implementation", () => {
  // The chariot and foot silhouettes used to be inlined in renderer.js. They live
  // in render/sprites.js now so the shop preview and the camp scene can reuse
  // them; a second copy is exactly how a preview drifts from the battlefield.
  const renderer = readFileSync(new URL("../src/render/renderer.js", import.meta.url), "utf8");
  assert.ok(/createSpriteArt/.test(renderer), "renderer.js no longer binds the shared sprite art");
  for (const colour of ["#674a2f", "#ffe1a0", "#493729", "#88bd8a"]) {
    assert.equal(renderer.includes(colour), false, `renderer.js still paints unit art itself (${colour})`);
  }
});

console.log("[unit] battlefield scatter");

const battlefieldWorld = { width: 2800, height: 1800 };

function scatter(seed, hits = () => false) {
  const player = { x: 0, y: 0, radius: 17 };
  return createBattlefield(createSeededRandom(seed), player, battlefieldWorld, hits);
}

test("the scatter is a pure function of its seed", () => {
  assert.deepEqual(scatter(9), scatter(9), "the same seed produced two different battlefields");
  assert.notDeepEqual(scatter(9), scatter(10), "two different seeds produced the same battlefield");
  // Nothing may leak between runs: a battlefield generated second must look like
  // the one generated first.
  scatter(11);
  assert.deepEqual(scatter(12), scatter(12));
});

test("every scattered instance resolves to a row and keeps the instance shape", () => {
  const field = scatter(5);
  const centre = { x: battlefieldWorld.width / 2, y: battlefieldWorld.height / 2, radius: 17 };
  assert.equal(field.obstacles.length, elementRules.obstacleTarget,
    "a rejected attempt must not shrink the field");
  const terrainBudget = Object.values(terrainKinds).reduce((sum, row) => sum + row.placement.count, 0);
  assert.ok(field.terrain.length > 0 && field.terrain.length <= terrainBudget,
    `${field.terrain.length} patches from a budget of ${terrainBudget}`);
  assert.equal(field.clouds.length, cloudKinds.sky.count);

  for (const obstacle of field.obstacles) {
    const row = obstacleKinds[obstacle.type];
    assert.ok(row, `obstacle "${obstacle.type}" has no catalog row`);
    assert.equal(obstacleShape(obstacle), row.shape, `${obstacle.type} instance and row disagree about its shape`);
    assert.ok(Math.hypot(obstacle.x - centre.x, obstacle.y - centre.y) >= elementRules.obstacleSafeRadius - 1,
      "an obstacle was scattered onto the spawn point");
    if (row.shape === "circle") {
      assert.equal(typeof obstacle.radius, "number");
      assert.equal(obstacle.width, undefined, "a circle instance carries rect fields");
    } else {
      assert.ok(obstacle.width > 0 && obstacle.height > 0);
      assert.equal(obstacle.radius, undefined, "a rect instance carries a radius");
    }
  }
  for (const patch of field.terrain) {
    assert.ok(terrainKinds[patch.type], `terrain "${patch.type}" has no catalog row`);
    assert.ok(patch.radiusX > 0 && patch.radiusY > 0);
  }
  for (const cloud of field.clouds) {
    assert.ok(cloudKinds[cloud.type], `cloud "${cloud.type}" has no catalog row`);
    assert.ok(cloud.width > 0 && cloud.height > 0 && cloud.speed > 0);
  }
});

test("both obstacle kinds are reachable from the weighted table", () => {
  const seen = {};
  for (let seed = 0; seed < 12; seed += 1) {
    for (const obstacle of scatter(seed).obstacles) seen[obstacle.type] = (seen[obstacle.type] ?? 0) + 1;
  }
  for (const type of Object.keys(obstacleKinds)) {
    assert.ok(seen[type] > 0, `${type} never spawned in 12 seeds`);
  }
  // The weight is a share of the attempts, so a 58/42 split cannot come out
  // wildly lopsided over 12 maps.
  const total = Object.values(seen).reduce((sum, count) => sum + count, 0);
  for (const [type, row] of Object.entries(obstacleKinds)) {
    const share = seen[type] / total;
    assert.ok(Math.abs(share - row.weight) < 0.2, `${type} took ${(share * 100).toFixed(0)}% of ${total} attempts`);
  }
});

test("each battlefield's mix narrows the catalog without thinning or fattening the field", () => {
  for (const definition of battlefields) {
    const { obstacles: kinds, terrain: patches } = definition.mix;
    assert.ok(kinds && patches, `${definition.nameKey} carries no mix`);
    const share = Object.values(kinds).reduce((sum, weight) => sum + weight, 0);
    assert.ok(Math.abs(share - 1) < 1e-9, `${definition.nameKey}'s obstacle shares sum to ${share}`);
    for (const type of Object.keys(kinds)) {
      assert.ok(obstacleKinds[type], `${definition.nameKey} mixes unknown obstacle "${type}"`);
    }
    for (const [type, count] of Object.entries(patches)) {
      assert.ok(terrainKinds[type], `${definition.nameKey} mixes unknown terrain "${type}"`);
      assert.ok(count > 0, `${definition.nameKey} asks for ${count} ${type} patches`);
    }

    for (let seed = 0; seed < 6; seed += 1) {
      const field = createBattlefield(
        createSeededRandom(seed), { x: 0, y: 0, radius: 17 }, battlefieldWorld, () => false, definition.mix,
      );
      // Density is a property of the target, not of the mix: a tree-heavy map
      // rejects more attempts but still fills the field.
      assert.equal(field.obstacles.length, elementRules.obstacleTarget,
        `${definition.nameKey} scattered ${field.obstacles.length} obstacles on seed ${seed}`);
      for (const obstacle of field.obstacles) {
        assert.ok(kinds[obstacle.type] > 0, `${definition.nameKey} emitted "${obstacle.type}", which its mix excludes`);
      }
      for (const patch of field.terrain) {
        assert.ok(patches[patch.type] > 0, `${definition.nameKey} emitted "${patch.type}", which its mix excludes`);
      }
    }
  }
});

test("a mix changes the ground, not just the numbers", () => {
  const scatterAs = (nameKey, seed = 3) => {
    const definition = battlefields.find((entry) => entry.nameKey === nameKey);
    return createBattlefield(
      createSeededRandom(seed), { x: 0, y: 0, radius: 17 }, battlefieldWorld, () => false, definition.mix,
    );
  };
  const walls = (field) => field.obstacles.filter((obstacle) => obstacle.type === "wall").length;
  const pass = scatterAs("battlefield.hangu.name");
  const marsh = scatterAs("battlefield.yunmeng.name");
  assert.ok(walls(pass) > walls(marsh) * 2, "the fortified pass does not read wallier than the marsh");
  assert.equal(pass.terrain.some((patch) => patch.type === "shallows"), false, "the pass has standing water in it");
  assert.equal(marsh.terrain.some((patch) => patch.type === "sand"), false, "the marsh has a dust bank in it");
  assert.ok(marsh.terrain.some((patch) => patch.type === "shallows"), "the marsh has no water");
  // A battlefield with no mix keeps the whole catalog: the fallback is what every
  // script and test that calls createBattlefield by hand relies on.
  const plain = createBattlefield(createSeededRandom(3), { x: 0, y: 0, radius: 17 }, battlefieldWorld, () => false);
  assert.equal(plain.obstacles.length, elementRules.obstacleTarget);
  assert.deepEqual(scatterAs("battlefield.hangu.name"), scatterAs("battlefield.hangu.name"));
});

console.log("[unit] element geometry");

test("a hand-built obstacle keeps the shape its own fields describe", () => {
  // scripts and older saves still build instances by hand, and the collision test
  // above does exactly that: the type may be unknown, the fields never lie.
  assert.equal(obstacleShape({ type: "tree", x: 0, y: 0, radius: 40 }), "circle");
  assert.equal(obstacleShape({ type: "wall", x: 0, y: 0, width: 60, height: 28 }), "rect");
  assert.equal(obstacleShape({ type: "boulder", x: 0, y: 0, radius: 12 }), "circle", "an unknown type lost its radius");
  assert.equal(obstacleShape({ type: "boulder", x: 0, y: 0, width: 60, height: 28 }), "rect");
  assert.equal(clearsSight({ type: "boulder", radius: 12 }), true, "an unknown type must still block sight");
  assert.equal(elementIntersects(510, 405, 1, { type: "wall", x: 500, y: 400, width: 60, height: 28 }), true);
  assert.equal(elementIntersects(570, 405, 1, { type: "wall", x: 500, y: 400, width: 60, height: 28 }), false);
  assert.equal(elementIntersects(500, 430, 12, { type: "tree", x: 500, y: 400, radius: 40 }), true);
  assert.equal(elementIntersects(500, 460, 12, { type: "tree", x: 500, y: 400, radius: 40 }), false);
});

test("spacing helpers measure between silhouettes, not between anchors", () => {
  const tree = { type: "tree", x: 0, y: 0, radius: 40 };
  const wall = { type: "wall", x: 100, y: 0, width: 60, height: 28 };
  assert.equal(elementBoundingRadius(tree), 40);
  assert.equal(elementBoundingRadius(wall), Math.hypot(60, 28) / 2, "a rect's reach is its half-diagonal");
  assert.equal(elementGap(tree, { type: "tree", x: 100, y: 0, radius: 10 }), 50);
  assert.ok(elementGap(tree, wall) < elementGap(tree, { type: "tree", x: 100, y: 0, radius: 0 }));
  assert.equal(elementCullMargin(tree), 48, "a centred element needs slack past its radius");
  assert.equal(elementCullMargin(wall), 60, "a rect is anchored on its corner, so its own extent is the margin");
});

test("movement cost comes from the patch row, and the worst ground wins", () => {
  const shallows = { type: "shallows", x: 100, y: 100, radiusX: 120, radiusY: 90 };
  assert.equal(elementSpeedAt(100, 100, [shallows]), terrainKinds.shallows.speed);
  assert.equal(elementSpeedAt(500, 500, [shallows]), 1, "open ground is not slowed");
  assert.equal(elementSpeedAt(100, 100, [{ type: "mud", x: 100, y: 100, radiusX: 50, radiusY: 50 }]), 1,
    "an unknown patch must not slow anything");
  const grass = { type: "grass", x: 100, y: 100, radiusX: 120, radiusY: 90 };
  assert.equal(elementSpeedAt(100, 100, [shallows, grass]), Math.min(terrainKinds.shallows.speed, terrainKinds.grass.speed),
    "overlapping patches must not compound");
});

test("clouds drift and wrap instead of flying off the map", () => {
  const cloud = { x: 2790, y: 10, speed: 4, width: 100, height: 50 };
  assert.equal(cloudDrift(cloud, 0, 2800), 2790);
  assert.equal(cloudDrift(cloud, 5, 2800), 10, "a cloud that leaves the right edge must come back on the left");
});

console.log("[unit] chariot steering");


// Drives the real controller with a bare player object: no DOM, no collision
// system, and a joystick vector expressed relative to where the nose points.
const STEER_FACING = -Math.PI / 2;

function angleGap(from, to) {
  return Math.abs(Math.atan2(Math.sin(to - from), Math.cos(to - from)));
}

function simulateSteering({ relativeDeg = 180, magnitude = 0.3, frames = 120, startSpeed = 0, tailFrames = 10 } = {}) {
  const origin = { x: 600, y: 600 };
  const player = {
    x: origin.x,
    y: origin.y,
    radius: 17,
    angle: STEER_FACING,
    speed: startSpeed,
    maxSpeed: CHARIOT_CONTROL_CONFIG.maxSpeed,
    acceleration: CHARIOT_CONTROL_CONFIG.acceleration,
    deceleration: CHARIOT_CONTROL_CONFIG.deceleration,
    maxTurnRate: CHARIOT_CONTROL_CONFIG.maxTurnRate,
    knockbackX: 0,
    knockbackY: 0,
    impactCooldown: 0,
    mode: "chariot",
    invulnerable: 0,
    health: 100,
  };
  const stickAngle = STEER_FACING + relativeDeg * (Math.PI / 180);
  const touchInput = {
    x: Math.cos(stickAngle) * magnitude,
    y: Math.sin(stickAngle) * magnitude,
  };
  const controller = createPlayerController({
    player,
    world: { width: 1200, height: 1200 },
    keys: new Set(),
    touchInput,
    moveEntitySafely: (entity, dx, dy) => {
      entity.x += dx;
      entity.y += dy;
    },
    // Backing into nothing must stay harmless: the reverse cap sits below the
    // ram-damage speed, so damagePlayer() only ever runs on a real impact.
    damagePlayer: () => {
      throw new Error("reversing should not damage the chariot");
    },
    state: { mode: "running" },
  });
  const samples = [];
  for (let frame = 0; frame < frames; frame += 1) {
    controller.readControls(1 / 60);
    samples.push({ x: player.x, y: player.y, angle: player.angle, speed: player.speed });
  }
  const travelled = Math.hypot(player.x - origin.x, player.y - origin.y);
  const travelAngle = Math.atan2(player.y - origin.y, player.x - origin.x);
  // Where the chariot is heading *after* the nose finished swinging: the
  // direction of the run's last `tailFrames` instead of the whole chord.
  const tail = samples[Math.max(0, samples.length - tailFrames)];
  const tailAngle = Math.atan2(player.y - tail.y, player.x - tail.x);
  return { player, stickAngle, travelled, travelAngle, tailAngle, samples, origin };
}

test("the reverse lane stays inside its own tuning bounds", () => {
  assert.ok(
    CHARIOT_CONTROL_CONFIG.reverseLowSpeedThreshold > CHARIOT_CONTROL_CONFIG.reverseMaxSpeed,
    "a reverse cap above the low-speed gate would flicker between reversing and turning",
  );
  assert.ok(CHARIOT_CONTROL_CONFIG.reverseMaxSpeed < 85, "reversing must stay below ram damage");
  assert.ok(
    CHARIOT_CONTROL_CONFIG.reverseAngleThreshold > Math.PI / 2
      && CHARIOT_CONTROL_CONFIG.reverseAngleThreshold <= Math.PI,
    "the lane has to sit behind the nose",
  );
  assert.ok(
    CHARIOT_CONTROL_CONFIG.reverseMaxInputMagnitude < 1,
    "keyboard input contributes magnitude 1, so it must stay in the turning lane",
  );
  assert.ok(
    CHARIOT_CONTROL_CONFIG.reverseSteerFactor > 0
      && CHARIOT_CONTROL_CONFIG.reverseSteerFactor < 1,
    "tail-steering must actually move the nose yet stay slower than a normal turn",
  );
  assert.ok(
    // 120deg of lane leaves a 60deg steer window, which is the tuning cap. Compare
    // with a tolerance: Math.PI - 120 * (Math.PI / 180) lands 2.2e-16 above
    // Math.PI / 3, so an exact comparison fails by one ulp on a legal value.
    Math.PI - CHARIOT_CONTROL_CONFIG.reverseAngleThreshold <= Math.PI / 3 + 1e-9,
    "the steer window (180deg - threshold) has to stay a slight nudge, not a spin",
  );
});

test("a small stick behind the nose backs up without turning", () => {
  const { player, travelled, travelAngle } = simulateSteering({ relativeDeg: 180, magnitude: 0.3 });
  assert.equal(player.angle, STEER_FACING, "facing must survive the whole reverse");
  assert.ok(travelled > 20, `expected visible backward travel, got ${travelled}`);
  assert.ok(
    angleGap(travelAngle, STEER_FACING + Math.PI) < 0.02,
    `expected travel straight back, got ${travelAngle}`,
  );
  assert.ok(
    player.speed <= CHARIOT_CONTROL_CONFIG.reverseMaxSpeed + 1e-9,
    `reverse speed ${player.speed} exceeded its cap`,
  );
});

test("backward diagonals settle with the tail on the stick", () => {
  for (const relativeDeg of [135, 140, 160, 180]) {
    const { player, stickAngle, tailAngle } = simulateSteering({
      relativeDeg,
      magnitude: 0.3,
      frames: 180,
    });
    assert.ok(
      angleGap(player.angle, stickAngle + Math.PI) < 0.02,
      `expected the nose opposite the stick at ${relativeDeg}deg, got ${player.angle}`,
    );
    assert.ok(
      angleGap(tailAngle, stickAngle) < 0.02,
      `expected the settled travel along the stick at ${relativeDeg}deg, got ${tailAngle}`,
    );
  }
});

test("the nose swings the whole lane offset behind a diagonal stick", () => {
  const { player, stickAngle } = simulateSteering({ relativeDeg: 135, magnitude: 0.3, frames: 90 });
  const swing = angleGap(player.angle, STEER_FACING);
  assert.ok(
    Math.abs(swing - Math.PI / 4) < Math.PI / 180,
    `expected a 45deg tail swing at 135deg, got ${((swing * 180) / Math.PI).toFixed(1)}deg`,
  );
  assert.ok(
    angleGap(player.angle, stickAngle + Math.PI) < 1e-6,
    "the nose should settle exactly opposite the stick",
  );
});

test("a diagonal reverse curves into the stick instead of snapping", () => {
  const { samples, stickAngle, origin } = simulateSteering({
    relativeDeg: 135,
    magnitude: 0.3,
    frames: 30,
  });
  const early = samples[9];
  const earlyAngle = Math.atan2(early.y - origin.y, early.x - origin.x);
  assert.ok(
    angleGap(earlyAngle, STEER_FACING + Math.PI) < 10 * (Math.PI / 180),
    `the first frames should still travel backwards, got ${earlyAngle}`,
  );
  assert.ok(
    angleGap(earlyAngle, stickAngle) > 30 * (Math.PI / 180),
    "a 135deg push must not snap the chariot onto the stick",
  );
});

test("steering inside the lane never drops back into turning", () => {
  const { samples, stickAngle } = simulateSteering({ relativeDeg: 135, magnitude: 0.3, frames: 150 });
  const minimumGap = CHARIOT_CONTROL_CONFIG.reverseAngleThreshold
    - CHARIOT_CONTROL_CONFIG.reverseAngleTolerance;
  for (const sample of samples) {
    assert.ok(
      angleGap(sample.angle, stickAngle) >= minimumGap - 1e-9,
      "the nose must never swing toward the stick far enough to leave the lane",
    );
    assert.ok(
      Math.abs(sample.speed) <= CHARIOT_CONTROL_CONFIG.reverseMaxSpeed + 1e-9,
      `reverse speed ${sample.speed} exceeded its cap`,
    );
  }
});

test("a full-strength backward push still turns the chariot", () => {
  const { player } = simulateSteering({ relativeDeg: 180, magnitude: 0.9 });
  assert.ok(
    angleGap(player.angle, STEER_FACING) > Math.PI / 2,
    "pushing past the small-input range must keep the old turn behaviour",
  );
});

test("a moving chariot turns instead of snapping into reverse", () => {
  const { player } = simulateSteering({ relativeDeg: 180, magnitude: 0.3, startSpeed: 120, frames: 6 });
  assert.ok(
    angleGap(player.angle, STEER_FACING) > 0,
    "the low-speed gate must hold while the chariot is still fast",
  );
});

test("steering with the nose is unchanged", () => {
  const { player, stickAngle } = simulateSteering({ relativeDeg: 90, magnitude: 0.3, frames: 90 });
  assert.ok(
    angleGap(player.angle, STEER_FACING) > Math.PI / 4,
    "a sideways stick should still rotate the chariot",
  );
  assert.ok(angleGap(player.angle, stickAngle) < 1e-6, "the chariot should end up facing the stick");
});

console.log("[unit] ballistics");

test("ballistic elevation solves for the requested distance", () => {
  const speed = 420;
  const gravity = 420;
  const elevation = solveBallisticElevation(200, speed, gravity);
  assert.ok(elevation > 0 && elevation < Math.PI / 2);
  const horizontalSpeed = speed * Math.cos(elevation);
  const verticalSpeed = speed * Math.sin(elevation);
  const flightTime = (verticalSpeed + Math.sqrt(verticalSpeed ** 2)) / gravity;
  const distance = horizontalSpeed * flightTime;
  assert.ok(Math.abs(distance - 200) < 10, `expected ~200, got ${distance}`);
});

test("unreachable and degenerate shots fall back safely", () => {
  assert.equal(solveBallisticElevation(0, 420, 420), 0);
  assert.equal(solveBallisticElevation(5000, 420, 420), Math.PI / 4);
});

test("projectiles damage the first enemy they intersect", () => {
  const state = {
    bullets: [],
    groundArrows: [],
    footCompanions: [],
    enemies: [{ x: 260, y: 400, radius: 16, destroyed: false, hitHeight: 64 }],
  };
  const player = { x: 100, y: 400, radius: 17, mode: "chariot" };
  state.bullets.push(createBallisticProjectile({
    x: player.x, y: player.y, angle: 0, speed: 420,
    elevation: solveBallisticElevation(160, 420, 420), gravity: 420,
    range: 470, owner: "player", damage: 5, kind: "arrow",
  }));
  const hits = [];
  for (let frame = 0; frame < 120 && state.bullets.length > 0; frame += 1) {
    updateProjectiles({
      state,
      world,
      player,
      delta: 1 / 60,
      circleIntersectsObstacle: () => false,
      damageEnemy: (enemy, damage) => hits.push({ enemy, damage }),
      damagePlayer: () => { throw new Error("player should not be hit by ally fire"); },
      damageCompanion: () => { throw new Error("companion should not be hit by ally fire"); },
      burst: () => {},
    });
  }
  assert.equal(hits.length, 1);
  assert.equal(hits[0].damage, 5);
  assert.equal(state.bullets.length, 0, "spent projectile should be removed");
});

console.log("[unit] projectile impact effects");

// Every ranged enemy fires with a fixed `projectileRange` while its aggro band
// reaches further, so these cases sit at the far edge where shots used to be
// culled in mid air above the grass.
const rangedBands = [
  ["archer", enemyStats.archer, [290, 320, 340, 358]],
  ["chariot-archer", enemyStats["chariot-archer"], [350, 380, 410, 428]],
  ["slinger", enemyStats.slinger, [400, 430, 460, 478]],
];

const arena = { width: 4000, height: 3000 };

function createTestProjectiles({ state, player, dust = () => {}, burst = () => {}, extras = {} }) {
  return createProjectileSystem({
    state,
    player,
    world: arena,
    campaign: { random: () => 0.5, equipment: extras.equipment ?? {}, horseCount: 1 },
    collision: {
      circleIntersectsObstacle: extras.circleIntersectsObstacle ?? (() => false),
      hasLineOfSight: () => true,
      moveEntitySafely: () => true,
    },
    burst,
    dust,
    playTone: () => {},
    damageEnemy: extras.damageEnemy ?? (() => {}),
    damagePlayer: extras.damagePlayer ?? (() => {}),
    damageCompanion: extras.damageCompanion ?? (() => {}),
  });
}

function emptyBattleState() {
  return { bullets: [], groundArrows: [], enemies: [], footCompanions: [], particles: [] };
}

function fireTrackedShot(enemy, distance) {
  const state = emptyBattleState();
  const player = { x: 1500, y: 1500, radius: 17, mode: "chariot" };
  const log = { bursts: [], dusts: [], damage: 0 };
  const projectiles = createTestProjectiles({
    state,
    player,
    burst: (x, y, color) => log.bursts.push(color),
    dust: (x, y) => log.dusts.push({ x, y }),
    extras: { damagePlayer: () => { log.damage += 1; } },
  });
  projectiles.fireEnemyShot({ ...enemy, x: player.x - distance, y: player.y }, 0, player);
  for (let frame = 0; frame < 600 && state.bullets.length > 0; frame += 1) {
    player.y += 1.6; // step aside so the shot has to come down somewhere
    projectiles.update(1 / 60);
  }
  return { state, log };
}

test("ballistic lifetime is derived from the arc, not the aim distance", () => {
  const speed = 420;
  const gravity = 420;
  const elevation = solveBallisticElevation(320, speed, gravity);
  const vz = speed * Math.sin(elevation);
  const analytic = solveTimeToGround({ z0: 8, vz, gravity });
  const projectile = createBallisticProjectile({
    x: 0, y: 0, angle: 0, speed, elevation, gravity,
    range: 330, owner: "enemy", damage: 4, kind: "arrow",
  });
  assert.ok(projectile.life >= analytic, "the arc must outlive its own flight time");
  assert.ok(projectile.life - analytic <= 1.001, "the remaining padding should stay small");
  assert.equal(solveTimeToGround({ z0: 8, vz: 0, gravity: 0 }), Infinity);
});

test("enemy shots at every firing distance end in an impact, never mid air", () => {
  for (const [name, enemy, distances] of rangedBands) {
    for (const distance of distances) {
      const label = `${name} at ${distance}px`;
      const { state, log } = fireTrackedShot(enemy, distance);
      assert.equal(state.bullets.length, 0, `${label}: projectile left behind`);
      assert.equal(
        log.bursts.length + log.dusts.length + log.damage, 1,
        `${label}: ended without any impact effect`,
      );
      if (enemy.projectile === "stone") {
        assert.equal(log.dusts.length, 1, `${label}: stone raised no dust`);
        assert.equal(state.groundArrows.length, 0, `${label}: stones do not stick in the ground`);
      } else {
        assert.equal(log.bursts.length, 1, `${label}: arrow raised no impact puff`);
        assert.equal(state.groundArrows.length, 1, `${label}: arrow left no ground decal`);
      }
    }
  }
});

test("crew arrows land instead of expiring at their range cap", () => {
  const state = emptyBattleState();
  const player = { x: 200, y: 2400, radius: 17, mode: "chariot" };
  const projectiles = createTestProjectiles({ state, player });
  const rules = projectileRules.allyArrow;
  projectiles.fireAllyArrow({
    x: 1500,
    y: 1500,
    targetX: 1500 + rules.crewRange,
    targetY: 1500,
    damage: 4,
    range: rules.crewRange,
    originOffset: rules.crewOriginOffset,
  });
  for (let frame = 0; frame < 600 && state.bullets.length > 0; frame += 1) {
    projectiles.update(1 / 60);
  }
  assert.equal(state.bullets.length, 0);
  assert.equal(state.groundArrows.length, 1, "crew arrow vanished before landing");
});

test("stones raise dust on ground, obstacle and body impacts", () => {
  function slingShot({ obstacle = () => false, standStill = false } = {}) {
    const state = emptyBattleState();
    const player = { x: 1500, y: 1500, radius: 17, mode: "chariot" };
    const dusts = [];
    let playerHits = 0;
    const projectiles = createTestProjectiles({
      state,
      player,
      dust: (x, y) => dusts.push({ x, y }),
      extras: {
        circleIntersectsObstacle: obstacle,
        damagePlayer: () => { playerHits += 1; },
      },
    });
    projectiles.fireEnemyShot({ ...enemyStats.slinger, x: player.x - 200, y: player.y }, 0, player);
    for (let frame = 0; frame < 400 && state.bullets.length > 0; frame += 1) {
      if (!standStill) player.y += 1.6;
      projectiles.update(1 / 60);
    }
    return { dusts, playerHits, groundArrows: state.groundArrows.length };
  }

  const ground = slingShot();
  assert.equal(ground.dusts.length, 1, "ground impact should raise dust");
  assert.equal(ground.playerHits, 0);

  const blocked = slingShot({ obstacle: () => true });
  assert.equal(blocked.dusts.length, 1, "obstacle impact should raise dust");
  assert.equal(blocked.groundArrows, 0);

  const bodyHit = slingShot({ standStill: true });
  assert.equal(bodyHit.playerHits, 1, "standing still should take the stone");
  assert.equal(bodyHit.dusts.length, 1, "a stone that hits a body should still kick up dust");
});

test("dust particles carry their own lifetime and a palette that reads on grass", () => {
  const state = {
    particles: [], enemies: [], drops: [], footCompanions: [], bloodStains: [], meleeEffects: [],
  };
  const enemies = createEnemies({
    bossTypes,
    enemyStats,
    formationPatterns,
    state,
    player: { x: 0, y: 0, radius: 17, mode: "chariot", angle: 0 },
    world: arena,
    random: () => 0.5,
    circleIntersectsObstacle: () => false,
    moveEntitySafely: () => {},
    getChariotCollisionDamage: () => 5,
    playTone: () => {},
    updateHud: () => {},
    hasLineOfSight: () => true,
    fireEnemy: () => {},
    damagePlayer: () => {},
    damageCompanion: () => {},
  });

  enemies.dust(120, 240);
  const rings = state.particles.filter((particle) => particle.kind === "ring");
  const motes = state.particles.filter((particle) => particle.kind !== "ring");
  assert.equal(rings.length, 1, "dust needs one ground ring");
  assert.equal(motes.length, effectRules.dust.count);
  assert.equal(state.particles.length, effectRules.dust.count + 1);
  for (const particle of state.particles) {
    // The renderer divides by `maxLife`, so a particle without it would fade at
    // the old 0.52s rate, and life > maxLife would push alpha above 1.
    assert.ok(particle.maxLife >= particle.life, "alpha would overflow 1");
    assert.ok(
      particle.color === effectRules.dust.ring.color || effectRules.dust.colors.includes(particle.color),
      `unexpected dust tint ${particle.color}`,
    );
  }
  for (const mote of motes) {
    assert.ok(mote.size >= effectRules.dust.sizeMin && mote.size <= effectRules.dust.sizeMax);
    assert.ok(mote.vy < 0, "dust should drift upwards");
  }
});

console.log("[unit] crew");

// Drives the real combat system with stubbed allies: arrows and melee hits are
// recorded instead of resolved, so a test can read exactly what the crew aimed at
// and what it would have dealt.
function crewRig({ roster = [], enemies = [], mode = "chariot" } = {}) {
  const shots = [];
  const melee = [];
  const state = { enemies, bullets: [], footCompanions: [], groundArrows: [] };
  const player = {
    mode,
    x: 100,
    y: 100,
    angle: 0,
    radius: 20,
    speed: 120,
    health: 40,
    maxHealth: 40,
    knockbackX: 0,
    knockbackY: 0,
    invulnerable: 0,
    cooldown: 0,
  };
  const campaign = { roster, equipment: emptyEquipment(), horseCount: 1, random: () => 0.5 };
  const combat = createCombatSystem({
    state,
    player,
    campaign,
    collision: {
      hasLineOfSight: () => true,
      moveEntitySafely: (entity, dx, dy) => {
        entity.x += dx;
        entity.y += dy;
      },
    },
    projectiles: { fireAllyArrow: (options) => shots.push(options) },
    damageEnemy: (enemy, amount) => melee.push({ enemy, amount }),
    addMeleeEffect: () => {},
    burst: () => {},
    playTone: () => {},
    updateHud: () => {},
    announceBanner: () => {},
    onDefeat: () => {},
  });
  return { combat, state, player, campaign, shots, melee };
}

const archerRow = personnel.find((person) => person.id === "archer");
const halberdierRow = personnel.find((person) => person.id === "halberdier");

test("crew arrows carry the firing member's own row damage", () => {
  // `personnel[0]` happened to be the archer row, so the wrong expression produced
  // the right number. The value, the cooldown and the lane all come from the row.
  const rig = crewRig({
    roster: [{ id: 1, role: "archer" }],
    enemies: [{ x: 460, y: 100, radius: 16, health: 10, destroyed: false }],
  });
  rig.combat.updateCrew(1 / 60);
  assert.equal(rig.shots.length, 1);
  assert.equal(rig.shots[0].damage, archerRow.damage);
  assert.equal(rig.shots[0].index, 0);
  assert.equal(rig.shots[0].count, 1);
  assert.equal(rig.campaign.roster[0].cooldown, archerRow.cooldown);
});

test("the crew volley fans over the archers, not over the whole crew", () => {
  // One archer behind three halberdiers used to fire as lane 0 of 4: a quarter-turn
  // of the 0.055 rad spread, i.e. 33px wide of a 19px target at 400px.
  const rig = crewRig({
    roster: [
      { id: 1, role: "archer" },
      { id: 2, role: "halberdier" },
      { id: 3, role: "halberdier" },
      { id: 4, role: "halberdier" },
    ],
    enemies: [{ x: 500, y: 100, radius: 16, health: 200, destroyed: false }],
  });
  rig.combat.updateCrew(1 / 60);
  assert.deepEqual(rig.shots.map((shot) => [shot.index, shot.count]), [[0, 1]], "a lone archer fired off-centre");
});

test("archers keep their lanes when a neighbouring bow is reloading", () => {
  const rig = crewRig({
    roster: [
      { id: 1, role: "archer" },
      { id: 2, role: "halberdier" },
      { id: 3, role: "archer" },
    ],
    enemies: [{ x: 500, y: 100, radius: 16, health: 200, destroyed: false }],
  });
  rig.combat.updateCrew(1 / 60);
  assert.deepEqual(rig.shots.map((shot) => [shot.index, shot.count]), [[0, 2], [1, 2]]);
  // The first bow reloads, the second does not: the firing lane must stay lane 1.
  rig.campaign.roster[0].cooldown = 5;
  rig.campaign.roster[2].cooldown = 0;
  rig.combat.updateCrew(1 / 60);
  assert.deepEqual(rig.shots.map((shot) => [shot.index, shot.count]), [[0, 2], [1, 2], [1, 2]]);
});

test("crew halberdiers deal their own row damage in melee", () => {
  const rig = crewRig({
    roster: [{ id: 1, role: "halberdier" }],
    enemies: [{ x: 140, y: 100, radius: 16, health: 100, destroyed: false }],
  });
  rig.combat.updateCrew(1 / 60);
  assert.deepEqual(rig.melee.map((hit) => hit.amount), [halberdierRow.damage]);
  assert.equal(rig.campaign.roster[0].cooldown, halberdierRow.cooldown);
});

test("the crew stands down while the player is on foot", () => {
  const rig = crewRig({
    roster: [{ id: 1, role: "archer" }, { id: 2, role: "halberdier" }],
    enemies: [{ x: 140, y: 100, radius: 16, health: 100, destroyed: false }],
    mode: "foot",
  });
  rig.combat.updateCrew(1 / 60);
  assert.equal(rig.shots.length, 0);
  assert.equal(rig.melee.length, 0);
});

test("dismounted companions fight with their own row's numbers", () => {
  const rig = crewRig({
    roster: [{ id: 1, role: "archer" }, { id: 2, role: "halberdier" }],
    enemies: [
      { x: 300, y: 140, radius: 16, health: 100, destroyed: false },
      { x: 70, y: 80, radius: 16, health: 100, destroyed: false },
    ],
  });
  rig.combat.dismountPlayer();
  assert.equal(rig.state.footCompanions.length, 2);
  const [bowman, axeman] = rig.state.footCompanions;
  assert.equal(bowman.damage, archerRow.damage);
  assert.equal(bowman.range, archerRow.range);
  assert.equal(axeman.damage, halberdierRow.damage);
  rig.combat.updateFootCompanions(1);
  assert.deepEqual(rig.shots.map((shot) => shot.damage), [archerRow.damage]);
  assert.deepEqual(rig.melee.map((hit) => hit.amount), [halberdierRow.damage]);
  assert.equal(axeman.attackCooldown, halberdierRow.cooldown);
});

test("no module reads the personnel table by array position", () => {
  // The bug above is invisible in a value assertion while the archer stays first in
  // the table, so pin the shape of the access instead.
  const source = readFileSync(new URL("../src/game/combat.js", import.meta.url), "utf8");
  assert.equal(/personnel\s*\[\s*\d+\s*\]\s*\./.test(source), false, "combat.js indexes personnel by position");
});

console.log("[unit] bow");

// The chariot's bow is a two-stage control: press, draw, release. These tests
// drive the real combat system through that sequence and read what the
// projectile system was asked to do, instead of trusting the HUD.
function bowRig({ mode = "chariot", enemies = [], lineOfSight = () => true } = {}) {
  const volleys = [];
  const melee = [];
  const state = {
    enemies, bullets: [], footCompanions: [], groundArrows: [], fireHold: 0, fireHeld: false,
  };
  const player = {
    mode, x: 100, y: 100, angle: 0, radius: 17, speed: 0, health: 40, maxHealth: 40,
    knockbackX: 0, knockbackY: 0, invulnerable: 0, cooldown: 0,
  };
  const combat = createCombatSystem({
    state,
    player,
    campaign: { roster: [], equipment: emptyEquipment(), horseCount: 1, random: () => 0.5 },
    collision: { hasLineOfSight: lineOfSight, moveEntitySafely: () => true },
    projectiles: { firePlayerVolley: (options = {}) => volleys.push(options) },
    damageEnemy: (enemy, amount) => melee.push({ enemy, amount }),
    addMeleeEffect: () => {},
    burst: () => {},
    playTone: () => {},
    updateHud: () => {},
    announceBanner: () => {},
    onDefeat: () => {},
  });
  return { combat, state, player, volleys, melee };
}

const tap = (combat) => {
  combat.updatePlayerFire(1 / 60, true);
  combat.updatePlayerFire(1 / 60, false);
};

test("aim assist picks the nearest enemy inside the nose's cone", () => {
  const enemies = [
    { x: 380, y: 100, destroyed: false }, // 280 ahead, and first in the list
    { x: 190, y: 100, destroyed: false }, // 90 ahead: the nearest
    { x: 100, y: 30, destroyed: false }, // beside the axle
    { x: 40, y: 100, destroyed: false }, // behind the bow
  ];
  const target = selectAimTarget({
    x: 100, y: 100, angle: 0, enemies, maxRange: 380, coneCosine: 0.5,
  });
  assert.equal(target, enemies[1]);
});

test("aim assist stays out of walls and out of the bow's rear", () => {
  const args = { x: 100, y: 100, angle: 0, maxRange: 380, coneCosine: 0.5 };
  assert.equal(selectAimTarget({ ...args, enemies: [{ x: 60, y: 100 }] }), null);
  assert.equal(
    selectAimTarget({ ...args, enemies: [{ x: 200, y: 100 }], hasLineOfSight: () => false }),
    null,
    "a locked bow must not swing onto a target it cannot see",
  );
});

test("a tap looses an aimed volley at the nearest enemy ahead", () => {
  const rig = bowRig({
    enemies: [
      { x: 380, y: 100, radius: 16, destroyed: false },
      { x: 205, y: 96, radius: 16, destroyed: false },
    ],
  });
  tap(rig.combat);
  assert.equal(rig.volleys.length, 1);
  assert.equal(rig.volleys[0].aimX, 205);
  assert.equal(rig.volleys[0].aimY, 96);
  assert.equal(rig.volleys[0].tone, projectileRules.playerVolley.tapTone);
  assert.equal(rig.player.cooldown, projectileRules.playerVolley.tapCooldown);
  assert.equal(rig.state.fireHold, 0, "the draw has to reset on release");
});

test("a tap with an empty cone still shoots, just unassisted", () => {
  const rig = bowRig({ enemies: [{ x: 520, y: 100, radius: 16, destroyed: false }] });
  tap(rig.combat);
  assert.equal(rig.volleys.length, 1, "a tap must never cost the player an arrow");
  assert.equal(rig.volleys[0].aimX, undefined, "assist reached past its own range");
});

test("a drawn bow looses the long volley down the nose", () => {
  const rig = bowRig({ enemies: [{ x: 205, y: 100, radius: 16, destroyed: false }] });
  rig.combat.updatePlayerFire(0.3, true);
  rig.combat.updatePlayerFire(0.3, true);
  rig.combat.updatePlayerFire(1 / 60, true);
  assert.equal(rig.volleys.length, 0, "a drawn bow must not fire while it is held");
  assert.ok(rig.state.fireHold >= projectileRules.playerVolley.holdSeconds);
  rig.combat.updatePlayerFire(1 / 60, false);
  assert.equal(rig.volleys.length, 1);
  assert.equal(rig.volleys[0].aimX, undefined, "the drawn shot must not turn onto the enemy");
  assert.equal(rig.player.cooldown, projectileRules.playerVolley.chargedCooldown);
});

test("releasing without pressing does not loose an arrow", () => {
  // A pause clears the keys, and a cancelled touch arrives as an end event: both
  // look like "not held" and must not be mistaken for a release.
  const rig = bowRig();
  rig.combat.updatePlayerFire(1 / 60, false);
  assert.equal(rig.volleys.length, 0);
});

test("a release during the reload is spent, not queued", () => {
  const rig = bowRig();
  rig.player.cooldown = 0.2;
  rig.combat.updatePlayerFire(0.1, true);
  rig.combat.updatePlayerFire(1 / 60, false);
  assert.equal(rig.volleys.length, 0);
  assert.equal(rig.state.fireHold, 0);
});

test("the sword keeps its press-to-swing rhythm on foot", () => {
  const rig = bowRig({ mode: "foot", enemies: [{ x: 125, y: 100, radius: 16, destroyed: false }] });
  rig.combat.updatePlayerFire(1 / 60, true);
  assert.equal(rig.melee.length, 1);
  assert.equal(rig.player.cooldown, 0.72);
  assert.equal(rig.state.fireHold, 0, "the sword has no draw meter");
});

test("a tapped shot lands on the enemy instead of past it", () => {
  const state = emptyBattleState();
  const player = { x: 400, y: 400, radius: 17, mode: "chariot", angle: 0 };
  const impacts = [];
  const projectiles = createTestProjectiles({
    state,
    player,
    extras: { equipment: emptyEquipment() },
    burst: (x) => impacts.push(x),
  });

  const fly = () => {
    for (let frame = 0; frame < 240 && state.bullets.length > 0; frame += 1) {
      projectiles.update(1 / 60);
    }
  };

  // 160px ahead: inside the tap's reach, and close enough that the drawn arc
  // (fixed 0.42 rad) flies over the enemy and lands well beyond it.
  projectiles.firePlayerVolley({ aimX: 560, aimY: 400 });
  fly();
  assert.equal(impacts.length, 1);
  assert.ok(
    Math.abs(impacts[0] - 560) < 12,
    `the aimed arrow landed ${(impacts[0] - 560).toFixed(1)}px off the target`,
  );

  projectiles.firePlayerVolley();
  fly();
  assert.equal(impacts.length, 2);
  assert.ok(
    impacts[1] - 560 > 150,
    `the drawn volley must stay the long shot (${(impacts[1] - 560).toFixed(1)}px past)`,
  );
});

console.log("[unit] blood decals");

test("blood decals are capped and fatality adds drops", () => {
  const state = { bloodStains: [] };
  let value = 0;
  const random = () => {
    value = (value + 0.37) % 1;
    return value;
  };
  addBloodStain(state, random, 10, 10, 20, false);
  assert.equal(state.bloodStains[0].drops.length, 5);
  addBloodStain(state, random, 20, 20, 20, true);
  assert.equal(state.bloodStains[1].drops.length, 10);
  for (let index = 0; index < 400; index += 1) addBloodStain(state, random, index, index, 12, false);
  assert.equal(state.bloodStains.length, 180);
});

console.log("[unit] enemy formations");

// A minimal battlefield that runs the real spawner and the real per-frame AI.
// `moveEntitySafely` actually moves (- the dust test stubs it out) so positions
// are observable, and the PRNG is seeded so a failure is reproducible.
function formationRig({ sight = { on: true }, seed = 11, obstacles = [], terrain = [], world = arena } = {}) {
  const state = {
    enemies: [], particles: [], drops: [], footCompanions: [], formations: [],
    formationsSpawned: 0, wave: 1, elapsed: 0, mode: "running", score: 0, kills: 0,
    bloodStains: [], meleeEffects: [], bullets: [], groundArrows: [], shake: 0,
  };
  const player = {
    x: world.width / 2, y: world.height / 2, radius: 17, mode: "chariot", angle: 0, speed: 0,
    knockbackX: 0, knockbackY: 0, invulnerable: 0, swarmDamageCooldown: 0,
  };
  // The spawner reads the ground from the campaign, exactly like the collision
  // system does, so the rig hands it a battlefield instead of a stub predicate.
  const campaign = { obstacles, terrain };
  const enemies = createEnemies({
    bossTypes,
    enemyStats,
    formationPatterns,
    state,
    player,
    world,
    campaign,
    random: createSeededRandom(seed),
    circleIntersectsObstacle: (x, y, radius) => obstacles.some((obstacle) => elementIntersects(x, y, radius, obstacle)),
    moveEntitySafely: (entity, dx, dy) => {
      entity.x = clamp(entity.x + dx, 0, world.width);
      entity.y = clamp(entity.y + dy, 0, world.height);
    },
    getChariotCollisionDamage: () => 5,
    playTone: () => {},
    updateHud: () => {},
    hasLineOfSight: () => sight.on,
    fireEnemy: () => {},
    damagePlayer: () => {},
    damageCompanion: () => {},
  });
  return { state, player, enemies, sight, campaign, world };
}

// Slots are laid out in the pattern's own frame, where local -Y is the front.
function spawnFormationAt(rig, patternIndex) {
  rig.state.wave = patternIndex + 1;
  rig.state.formationsSpawned = 0;
  rig.enemies.spawnFormation();
  return rig.state.formations[rig.state.formations.length - 1];
}

function toWorld(formation, localX, localY) {
  return {
    x: formation.x + localX * Math.cos(formation.heading) - localY * Math.sin(formation.heading),
    y: formation.y + localX * Math.sin(formation.heading) + localY * Math.cos(formation.heading),
  };
}

function parkPlayerInFront(rig, formation, distance) {
  const spot = toWorld(formation, 0, -distance);
  rig.player.x = spot.x;
  rig.player.y = spot.y;
}

const infantry = (state) => state.enemies.filter((enemy) => !enemy.boss && !enemy.ranged
  && enemy.type !== "chariot");

// Gap between the two closest bodies; negative means they overlap.
function closestPairGap(state) {
  let worst = Infinity;
  for (let first = 0; first < state.enemies.length; first += 1) {
    for (let second = first + 1; second < state.enemies.length; second += 1) {
      const left = state.enemies[first];
      const right = state.enemies[second];
      if (left.destroyed || right.destroyed) continue;
      worst = Math.min(worst, Math.hypot(left.x - right.x, left.y - right.y) - (left.radius + right.radius));
    }
  }
  return worst;
}

test("every melee unit holds its own slot instead of sharing a guard post", () => {
  for (let patternIndex = 0; patternIndex < formationPatterns.length; patternIndex += 1) {
    const label = formationPatterns[patternIndex].nameKey;
    const rig = formationRig();
    const formation = spawnFormationAt(rig, patternIndex);
    // 420px: inside the 450px sight range (so the guard code runs) but well
    // outside the footprint + alert margin. Standing inside the footprint is the
    // other contract - the line wakes and leaves its slot - and it is covered by
    // the aggro tests below.
    parkPlayerInFront(rig, formation, 420);
    const units = infantry(rig.state);
    const walked = new Map(units.map((unit) => [unit, 0]));
    for (let frame = 0; frame < 600; frame += 1) {
      const before = new Map(units.map((unit) => [unit, { x: unit.x, y: unit.y }]));
      rig.enemies.updateUnits(1 / 60);
      for (const unit of units) {
        const start = before.get(unit);
        walked.set(unit, walked.get(unit) + Math.hypot(unit.x - start.x, unit.y - start.y));
      }
    }

    const slots = new Set(units.map((unit) => `${unit.homeX},${unit.homeY}`));
    assert.equal(slots.size, units.length, `${label}: two units share a slot`);
    for (const unit of units) {
      const stray = Math.hypot(unit.x - unit.homeX, unit.y - unit.homeY);
      // 48 is the widest leash (38 + 10); the guard post used to sit 92px out
      // and the whole column converged on it, so a unit 140px off its slot was
      // the normal case.
      assert.ok(stray <= 54, `${label}: ${unit.type} strayed ${stray.toFixed(1)}px from its slot`);
      // A pacing guard still ends up near its slot, so distance alone would miss
      // it: walking into the player's hull and being pushed back out chattered
      // ~200px per 10 simulated seconds.
      const paced = walked.get(unit);
      assert.ok(paced < 120, `${label}: ${unit.type} paced ${paced.toFixed(0)}px in 10s`);
    }
    const gap = closestPairGap(rig.state);
    assert.ok(gap > -6, `${label}: bodies stacked to ${gap.toFixed(1)}px overlap`);
  }
});

test("a chariot at contact range does not make the line shuffle", () => {
  const rig = formationRig();
  const formation = spawnFormationAt(rig, 3);
  const slot = formationPatterns[3].slots.find((entry) => entry[0] === "spear");
  const home = toWorld(formation, slot[1], slot[2]);
  const unit = rig.state.enemies.find((enemy) => Math.abs(enemy.homeX - home.x) < 0.01
    && Math.abs(enemy.homeY - home.y) < 0.01);
  // 32px from the slot: outside the 29px touch distance (so nothing shoves it)
  // but inside the 35px spear range, where the whole lean is clamped away.
  rig.player.x = home.x + 32;
  rig.player.y = home.y;
  const start = { x: unit.x, y: unit.y };
  for (let frame = 0; frame < 120; frame += 1) rig.enemies.updateUnits(1 / 60);
  const moved = Math.hypot(unit.x - start.x, unit.y - start.y);
  assert.ok(moved < 1, `spear walked ${moved.toFixed(2)}px with the chariot already in reach`);
});

test("the melee line stays inside the footprint the renderer draws", () => {
  const rig = formationRig();
  const formation = spawnFormationAt(rig, 3);
  // Parked outside the alert band: an alerted line deliberately leaves the
  // footprint, and that bound is asserted by the chase tests below.
  parkPlayerInFront(rig, formation, 420);
  for (let frame = 0; frame < 600; frame += 1) rig.enemies.updateUnits(1 / 60);
  for (const unit of infantry(rig.state)) {
    // Back into the pattern's own frame; the dashed rect is axis aligned there.
    const dx = unit.x - formation.x;
    const dy = unit.y - formation.y;
    const localX = dx * Math.cos(formation.heading) + dy * Math.sin(formation.heading);
    const localY = -dx * Math.sin(formation.heading) + dy * Math.cos(formation.heading);
    assert.ok(Math.abs(localX) <= formation.halfWidth, `${unit.type} pokes past the side border`);
    assert.ok(Math.abs(localY) <= formation.halfHeight, `${unit.type} pokes past the front/back border`);
  }
});

test("ramming through a formation spreads the infantry instead of stacking it", () => {
  const rig = formationRig();
  const formation = spawnFormationAt(rig, 3);
  const acrossX = Math.cos(formation.heading);
  const acrossY = Math.sin(formation.heading);
  rig.player.x = formation.x - acrossX * 220;
  rig.player.y = formation.y - acrossY * 220;
  rig.player.angle = Math.atan2(acrossY, acrossX);
  // Above the 20px/s shove threshold, below the 65px/s ram threshold: every
  // contacted unit is knocked down and pushed, which is what used to pile the
  // survivors onto one pixel.
  rig.player.speed = 60;
  let worst = Infinity;
  for (let frame = 0; frame < 220; frame += 1) {
    rig.player.x += acrossX * 2;
    rig.player.y += acrossY * 2;
    rig.enemies.updateUnits(1 / 60);
    worst = Math.min(worst, closestPairGap(rig.state));
  }
  assert.ok(worst > -6, `bodies stacked to ${worst.toFixed(1)}px overlap while the chariot ploughed through`);
});

// --- aggro: the line only holds rank while the player is outside its footprint
// The tests below pin the border behaviour as geometry first (no simulation, so
// the numbers are the design constants), then the simulated outcome.
const calmFormation = (overrides = {}) => ({
  id: 7, x: 0, y: 0, heading: 0, halfWidth: 116, halfHeight: 86, alerted: false, ...overrides,
});
const rankUnit = (overrides = {}) => ({
  formationId: 7, homeX: 0, homeY: 0, radius: 12, speed: 60, chaseSeconds: 1.2, ...overrides,
});
const chariotPlayer = (x, y) => ({ x, y, radius: 17, mode: "chariot" });
// Local +Y is the back of the line, so a world point at y = 86 + d sits d px
// behind the dashed border.
const behindTheLine = (distance) => chariotPlayer(0, 86 + distance);

test("the alert border is the drawn footprint plus a margin, in the pattern's frame", () => {
  const formation = calmFormation({ heading: Math.PI / 2 });
  // Rotated a quarter turn, the line's +X runs down the world's +Y axis.
  assert.equal(isInsideFormation(formation, 0, 116), true, "the line's own width is not honoured");
  assert.equal(isInsideFormation(formation, 0, 117), false);
  assert.equal(isInsideFormation(formation, 86, 0), true, "the line's own depth is not honoured");
  assert.equal(isInsideFormation(formation, 87, 0), false);
  assert.equal(isInsideFormation(formation, 0, 190, 80), true, "the margin is not applied");
});

test("the alert latches instead of strobing on its border", () => {
  const formation = calmFormation();
  const unit = rankUnit();
  // 40px behind the border: outside the 24px wake margin, so a cold line sleeps.
  updateFormationAlerts([formation], [unit], behindTheLine(40));
  assert.equal(formation.alerted, false);
  assert.equal(unit.alerted, false);
  updateFormationAlerts([formation], [unit], behindTheLine(-10));
  assert.equal(formation.alerted, true, "the player standing inside the footprint did not wake the line");
  assert.equal(unit.alerted, true, "the wake was not mirrored onto the unit");
  // Still in the same band, but now awake: a chariot parked here must not make
  // the whole formation flicker in and out of pursuit every frame.
  updateFormationAlerts([formation], [unit], behindTheLine(40));
  assert.equal(formation.alerted, true, "the alert released inside its own release band");
  assert.equal(unit.alerted, true);
  // Past the release border, it stands down.
  updateFormationAlerts([formation], [unit], behindTheLine(73 + 1));
  assert.equal(formation.alerted, false);
  assert.equal(unit.alerted, false, "a unit kept chasing after its line stood down");
});

test("a chasing unit's goal is its leash plus one chase span from its slot", () => {
  const unit = rankUnit();
  // At 500px the brace has faded, so the leash is its 38px base and the span is
  // 60px/s * 1.2s = 72px: the goal sits 110px from the slot.
  const goal = chasePoint(chariotPlayer(0, -500), unit, 0, -500);
  assert.ok(Math.abs(goal.x) < 1e-9, `goal drifted sideways: ${goal.x}`);
  assert.ok(Math.abs(goal.y + 110) < 1e-9, `goal sat ${Math.abs(goal.y)}px out, expected 110`);
  // In reach of the slot, the goal is simply the player.
  assert.deepEqual(chasePoint(chariotPlayer(30, 40), unit, 30, 40), { x: 30, y: 40 });
  // A unit with no formation (a boss) is never clamped.
  const loose = chasePoint(chariotPlayer(0, -500), rankUnit({ formationId: undefined }), 0, -500);
  assert.deepEqual(loose, { x: 0, y: -500 });
});

test("a line the chariot drives into leaves its rank and closes to reach", () => {
  for (let patternIndex = 0; patternIndex < formationPatterns.length; patternIndex += 1) {
    const label = formationPatterns[patternIndex].nameKey;
    const rig = formationRig();
    const formation = spawnFormationAt(rig, patternIndex);
    parkPlayerInFront(rig, formation, 20);
    rig.enemies.updateUnits(1 / 60);
    assert.equal(formation.alerted, true, `${label}: the line did not wake`);
    const units = infantry(rig.state);
    for (const unit of units) assert.equal(unit.alerted, true, `${label}: ${unit.type} missed the alert`);
    const distanceOf = (unit) => Math.hypot(unit.x - rig.player.x, unit.y - rig.player.y);
    // Units that spawn already inside their own reach cannot demonstrate a
    // charge, so the charge is measured on the ones that were out of reach.
    const startedOutOfReach = units.filter((unit) => distanceOf(unit) > unit.range);
    assert.ok(startedOutOfReach.length > 0, `${label}: every unit spawned in reach, the test proves nothing`);
    const meanBefore = units.reduce((sum, unit) => sum + distanceOf(unit), 0) / units.length;
    for (let frame = 0; frame < 900; frame += 1) rig.enemies.updateUnits(1 / 60);
    for (const unit of startedOutOfReach) {
      // Every unit that had ground to cover left its slot: one still welded to
      // the slot it spawned on is the old "the line never comes at you" bug.
      const stray = Math.hypot(unit.x - unit.homeX, unit.y - unit.homeY);
      assert.ok(stray > 2, `${label}: ${unit.type} never left its slot (${stray.toFixed(1)}px off)`);
    }
    // The back ranks are walled in by their own front rank - a 32px-wide heavy
    // stops a body-width short - so the line is judged as a body: it made
    // contact (the nearest unit is in reach) and its centre of mass advanced.
    const nearest = units.reduce((best, unit) => (distanceOf(unit) < distanceOf(best) ? unit : best));
    assert.ok(distanceOf(nearest) <= nearest.range + 1,
      `${label}: the line stopped ${distanceOf(nearest).toFixed(0)}px out, never making contact`);
    const meanAfter = units.reduce((sum, unit) => sum + distanceOf(unit), 0) / units.length;
    assert.ok(meanAfter < meanBefore * 0.8,
      `${label}: the line only closed from ${meanBefore.toFixed(0)}px to ${meanAfter.toFixed(0)}px`);
  }
});

test("an alerted line settles at reach instead of chattering", () => {
  const rig = formationRig();
  const formation = spawnFormationAt(rig, 3);
  parkPlayerInFront(rig, formation, 20);
  for (let frame = 0; frame < 900; frame += 1) rig.enemies.updateUnits(1 / 60);
  const units = infantry(rig.state);
  const before = new Map(units.map((unit) => [unit, { x: unit.x, y: unit.y }]));
  for (let frame = 0; frame < 180; frame += 1) rig.enemies.updateUnits(1 / 60);
  for (const unit of units) {
    const start = before.get(unit);
    const walked = Math.hypot(unit.x - start.x, unit.y - start.y);
    // Pressing into the hull and being pushed back out chattered ~200px per 10s
    // when the guard post was shared; a converged crowd has to stand still.
    assert.ok(walked < 3, `${unit.type} paced ${walked.toFixed(1)}px against the stopped chariot`);
  }
  const gap = closestPairGap(rig.state);
  assert.ok(gap > -6, `the converged crowd stacked to ${gap.toFixed(1)}px overlap`);
});

test("the line stands down and walks back to its slots once the player is clear", () => {
  const rig = formationRig();
  const formation = spawnFormationAt(rig, 0);
  parkPlayerInFront(rig, formation, 20);
  for (let frame = 0; frame < 240; frame += 1) rig.enemies.updateUnits(1 / 60);
  assert.equal(formation.alerted, true, "the line never woke, so the release proves nothing");
  parkPlayerInFront(rig, formation, 420);
  for (let frame = 0; frame < 600; frame += 1) rig.enemies.updateUnits(1 / 60);
  assert.equal(formation.alerted, false, "the line stayed awake with the chariot 420px out");
  for (const unit of infantry(rig.state)) {
    assert.equal(unit.alerted, false);
    const stray = Math.hypot(unit.x - unit.homeX, unit.y - unit.homeY);
    // Back under the stand-watch leash (38 + 10 of brace), i.e. the line re-forms
    // exactly where the slot-holding test above expects it.
    assert.ok(stray <= 54, `${unit.type} stayed ${stray.toFixed(1)}px off its slot after standing down`);
  }
});

test("sight flickering at the 450px rim does not make the line pace about", () => {
  const rig = formationRig();
  const formation = spawnFormationAt(rig, 3);
  parkPlayerInFront(rig, formation, 445);
  const units = infantry(rig.state);
  const walked = new Map(units.map((unit) => [unit, 0]));
  const heading = new Map();
  let reversals = 0;
  for (let frame = 0; frame < 600; frame += 1) {
    if (frame % 36 === 0) rig.sight.on = !rig.sight.on;
    const before = new Map(units.map((unit) => [unit, { x: unit.x, y: unit.y }]));
    rig.enemies.updateUnits(1 / 60);
    for (const unit of units) {
      const start = before.get(unit);
      const dx = unit.x - start.x;
      const dy = unit.y - start.y;
      const span = Math.hypot(dx, dy);
      walked.set(unit, walked.get(unit) + span);
      const last = heading.get(unit);
      if (span > 0.02 && last && last.x * dx + last.y * dy < 0) reversals += 1;
      if (span > 0.02) heading.set(unit, { x: dx / span, y: dy / span });
    }
  }
  const maxWalk = Math.max(...units.map((unit) => walked.get(unit)));
  // The post/lastSeen/home attractors used to trade places at this rim: 467px
  // of pacing and 120 direction flips per 10 simulated seconds.
  assert.ok(maxWalk < 100, `infantry walked ${maxWalk.toFixed(0)}px while sight flickered`);
  assert.ok(reversals <= 5, `infantry reversed direction ${reversals} times`);
});

test("a boss that has not seen the player still has a finite facing", () => {
  const rig = formationRig();
  rig.sight.on = false;
  rig.enemies.spawnBoss();
  for (let frame = 0; frame < 5; frame += 1) rig.enemies.updateUnits(1 / 60);
  const boss = rig.state.boss;
  // `spawnBoss` never set `wanderAngle`, so the idle branch stored `undefined`
  // in `angle` and every later transform was NaN.
  assert.ok(Number.isFinite(boss.angle), `boss angle became ${boss.angle}`);
  // The boss idles like the infantry: it may look around its spawn heading, but
  // that heading is what keeps `angle` finite.
  assert.ok(Math.abs(shortestAngleDifference(boss.homeAngle, boss.angle)) <= 0.34 + 1e-9,
    `boss idled ${boss.angle} instead of near ${boss.homeAngle}`);
  assert.ok(Number.isFinite(boss.x) && Number.isFinite(boss.y));
  for (let frame = 0; frame < 3600; frame += 1) rig.enemies.updateUnits(1 / 60);
  assert.ok(Number.isFinite(boss.angle), `boss angle became ${boss.angle} after a minute of idling`);
  assert.ok(Math.abs(shortestAngleDifference(boss.homeAngle, boss.angle)) <= 0.34 + 1e-9);
});

// "Idle" means "has never seen the player": `sight.on = false` keeps every unit
// in the idle branch (nothing to investigate) while the real spawner and the
// real per-frame AI still run.
function idleRig(patternIndex = 3) {
  const rig = formationRig();
  rig.sight.on = false;
  spawnFormationAt(rig, patternIndex);
  return rig;
}

// Runs idle frames and reports what the scan did: the widest heading off each
// unit's spawn front, the biggest single-frame turn, the total turn, and how far
// the body itself actually travelled.
function scanStats(rig, frames) {
  const units = infantry(rig.state);
  const origin = new Map(units.map((unit) => [unit, { x: unit.x, y: unit.y }]));
  const turned = new Map(units.map((unit) => [unit, 0]));
  let widest = 0;
  let maxStep = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const before = new Map(units.map((unit) => [unit, unit.angle]));
    rig.enemies.updateUnits(1 / 60);
    for (const unit of units) {
      const step = Math.abs(shortestAngleDifference(before.get(unit), unit.angle));
      turned.set(unit, turned.get(unit) + step);
      maxStep = Math.max(maxStep, step);
      widest = Math.max(widest, Math.abs(shortestAngleDifference(unit.homeAngle, unit.angle)));
    }
  }
  const moved = new Map(units.map((unit) => [unit, Math.hypot(unit.x - origin.get(unit).x, unit.y - origin.get(unit).y)]));
  return { units, turned, moved, widest, maxStep };
}

test("idle units scan their front without leaving the slot they spawned on", () => {
  const rig = idleRig();
  const { units, turned, moved, widest } = scanStats(rig, 3600);
  assert.ok(units.length > 4, "the rig spawned too few infantry to tell a line from a lull");
  for (const unit of units) {
    // Rotation only. If the sway bought its motion by nudging the body it would
    // start moving the target of the leash and footprint tests above.
    assert.ok(moved.get(unit) < 1e-9, `${unit.type} drifted ${moved.get(unit).toFixed(3)}px while idling`);
    assert.ok(Number.isFinite(unit.angle), `${unit.type} angle became ${unit.angle}`);
    // Looking around, not standing frozen: ~14 re-rolls a minute, each a 0.1-0.34
    // rad turn, so a whole minute of stillness here means the scan never ran.
    assert.ok(turned.get(unit) > 0.2, `${unit.type} stood frozen for 60s`);
  }
  assert.ok(widest <= 0.34 + 1e-9, `idle heading reached ${widest.toFixed(3)}rad off the front`);
  // A bounded re-roll must still use its band, otherwise the unit is just facing
  // forward with extra bookkeeping.
  assert.ok(widest > 0.1, `no unit ever looked away from the front (widest ${widest.toFixed(3)}rad)`);
});

test("the idle scan eases into its heading instead of snapping", () => {
  const rig = idleRig();
  const { maxStep } = scanStats(rig, 1800);
  // 1.7 rad/s at 60fps; a snap would write the whole 0.34 rad offset in one frame.
  assert.ok(maxStep <= 1.7 / 60 + 1e-9, `idle heading snapped ${maxStep.toFixed(4)}rad in one frame`);
  assert.ok(maxStep > 0.005, "the scan never actually moved");
});

test("a long idle run cannot walk the heading out of the scan band", () => {
  // Five simulated minutes. `wanderAngle += (random()-0.5)*0.65` accumulated ~180
  // rad over this window, which is why idle units ended up facing backwards.
  const rig = idleRig();
  const { units, moved, widest } = scanStats(rig, 18000);
  assert.ok(widest <= 0.34 + 1e-9, `idle heading drifted to ${widest.toFixed(3)}rad off the front`);
  for (const unit of units) {
    assert.ok(Number.isFinite(unit.angle), `${unit.type} angle became ${unit.angle}`);
    assert.ok(moved.get(unit) < 1e-9, `${unit.type} drifted ${moved.get(unit).toFixed(3)}px while idling`);
  }
});

test("idle scanning is seeded, so a replayed seed looks the same", () => {
  const first = idleRig();
  const second = idleRig();
  for (let frame = 0; frame < 900; frame += 1) {
    first.enemies.updateUnits(1 / 60);
    second.enemies.updateUnits(1 / 60);
  }
  const left = infantry(first.state);
  const right = infantry(second.state);
  assert.equal(left.length, right.length);
  for (let index = 0; index < left.length; index += 1) {
    // Anything reaching for Math.random() instead of the injected seeded
    // generator breaks replays and the seeded smoke runs.
    assert.equal(left[index].idleTarget, right[index].idleTarget);
    assert.equal(left[index].angle, right[index].angle);
  }
});

test("a new formation is not spawned on ground another formation holds", () => {
  const rig = formationRig();
  const first = spawnFormationAt(rig, 3);
  // Same pattern, so the reservation is the only thing keeping them apart.
  rig.state.wave = 4;
  rig.enemies.spawnFormation();
  assert.equal(rig.state.formations.length, 2, "the second formation found no ground in 8 tries");
  const second = rig.state.formations[1];
  const overlaps = Math.abs(first.x - second.x) < first.halfWidth + second.halfWidth
    && Math.abs(first.y - second.y) < first.halfHeight + second.halfHeight;
  assert.equal(overlaps, false, "the two formations interpenetrate");
});

console.log("[unit] formation ground");

// A rig standing on a real scattered battlefield: the spawner reads the same
// obstacle and terrain lists the collision system does.
function battlefieldRig(definition, seed) {
  const field = createBattlefield(
    createSeededRandom(seed), { x: 0, y: 0, radius: 17 }, battlefieldWorld, () => false, definition.mix,
  );
  return formationRig({ seed, obstacles: field.obstacles, terrain: field.terrain, world: battlefieldWorld });
}

test("a formation never spawns with a wall inside its own ranks", () => {
  for (const definition of battlefields) {
    const rig = battlefieldRig(definition, 7);
    for (let spawn = 0; spawn < 30; spawn += 1) {
      // One live line at a time: the game caps the crowd, so each spawn only has
      // to clear the map, not a pile of older reservations.
      rig.state.formations = [];
      rig.state.enemies = [];
      rig.state.wave = 1 + (spawn % formationPatterns.length);
      rig.enemies.spawnFormation();
      assert.equal(rig.state.formations.length, 1, `${definition.nameKey} found no ground on spawn ${spawn}`);
      const formation = rig.state.formations[0];
      assert.notEqual(formation.groundTier, "legacy",
        `${definition.nameKey} fell back to the slot-centre rule on spawn ${spawn}`);
      const clearance = formationGroundExtent(formationPatterns.find((entry) => entry.nameKey === formation.nameKey));
      assert.equal(
        rectHitsAnyObstacle(formation.x, formation.y, clearance.halfWidth, clearance.halfHeight,
          formation.heading, rig.campaign.obstacles),
        false, `${definition.nameKey} put a ${formation.nameKey} line across an obstacle`,
      );
      const footing = rectTerrain(formation.x, formation.y, clearance.halfWidth, clearance.halfHeight,
        formation.heading, rig.campaign.terrain);
      assert.equal(footing.dry || footing.uniform, true,
        `${definition.nameKey} put a line across a terrain seam`);
    }
  }
});

test("a wall the old slot-centre rule accepted rejects the ground now", () => {
  const pattern = formationPatterns[0];
  const clearance = formationGroundExtent(pattern);
  // A palisade sitting 22px in front of the front rank: every slot centre clears
  // the old 20px rule, while the rank itself walks straight into it.
  const wall = { type: "wall", x: -120, y: -104, width: 240, height: 28 };
  const distanceToWall = (x, y) => Math.hypot(
    x - clamp(x, wall.x, wall.x + wall.width),
    y - clamp(y, wall.y, wall.y + wall.height),
  );
  const nearestSlot = Math.min(...pattern.slots.map(([, slotX, slotY]) => distanceToWall(slotX, slotY)));
  assert.ok(nearestSlot > 20, `the test wall is only ${nearestSlot.toFixed(1)}px from a slot: the old rule would have caught it`);
  assert.equal(rectHitsAnyObstacle(0, 0, clearance.halfWidth, clearance.halfHeight, 0, [wall]), true,
    "a wall inside the rank box was accepted");
});

test("the ground test measures the ranks, not the dashed leash envelope", () => {
  const pattern = formationPatterns[3];
  const extent = formationExtent(pattern);
  const clearance = formationGroundExtent(pattern);
  // Tucked between the rank box and the drawn border: it may touch the dashes -
  // no unit stands out there - but it must not reach a slot.
  const wall = { type: "wall", x: extent.halfWidth - 20, y: -10, width: 18, height: 20 };
  assert.equal(rectHitsAnyObstacle(0, 0, clearance.halfWidth, clearance.halfHeight, 0, [wall]), false);
  assert.equal(rectHitsAnyObstacle(0, 0, extent.halfWidth, extent.halfHeight, 0, [wall]), true);
  assert.ok(extent.halfWidth > clearance.halfWidth && extent.halfHeight > clearance.halfHeight);
});

test("a flooded battlefield still places its line, on uniform footing", () => {
  // Every candidate is wet, so the ladder settles on the second rung instead of
  // refusing to spawn: one speed under the whole line is what that rung is for.
  const shallows = { type: "shallows", x: 0, y: 0, radiusX: 4000, radiusY: 4000 };
  const rig = formationRig({ terrain: [shallows] });
  rig.enemies.spawnFormation();
  assert.equal(rig.state.formations.length, 1, "a flooded map refused to spawn a formation");
  assert.equal(rig.state.formations[0].groundTier, "uniform");
});

test("a wet patch the ladder could avoid does not end up under the line", () => {
  // One patch beside the spawn ring, so the ladder must walk past it rather than
  // settle for a wet rank it could avoid.
  const shallows = { type: "shallows", x: 500 + 470, y: 400, radiusX: 240, radiusY: 240 };
  const rig = formationRig({ terrain: [shallows] });
  rig.enemies.spawnFormation();
  assert.equal(rig.state.formations[0].groundTier, "dry");
});

console.log("[unit] shop dossier");

// The radar is the only place where a stat becomes geometry, so the test builds
// it against a throwaway element tree instead of a browser: what matters is that
// the polygon it writes is the shared stat table, not a second copy of it.
function fakeSvgElement(tagName) {
  const attributes = new Map();
  const classes = new Set();
  const children = [];
  return {
    tagName,
    children,
    textContent: "",
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute: (name) => attributes.get(name) ?? null,
    append(...nodes) { children.push(...nodes); },
    replaceChildren(...nodes) {
      children.length = 0;
      children.push(...nodes);
    },
    classList: {
      add: (name) => classes.add(name),
      contains: (name) => classes.has(name),
      toggle(name, force) {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) classes.add(name); else classes.delete(name);
        return on;
      },
    },
  };
}

function withFakeDocument(run) {
  const previous = globalThis.document;
  globalThis.document = { createElementNS: (_namespace, tagName) => fakeSvgElement(tagName) };
  try {
    return run();
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
}

const byClass = (nodes, name) => nodes.find((node) => node.classList.contains(name));

test("the radar plots the shared chariot stats, axis for axis", () => {
  withFakeDocument(() => {
    const container = fakeSvgElement("div");
    const chart = createRadarChart(container, { labelSize: 16 });
    const svg = container.children[0];
    assert.equal(svg.getAttribute("viewBox"), `0 0 ${radarLayout.width} ${radarLayout.height}`);
    // The wheel's rim is the stat maximum; a stat table that outgrows it would
    // draw outside the outer ring, so the two numbers have to agree.
    assert.equal(radarLayout.maximum, chariotRules.maximumStat);

    const stats = calculateChariotStats({ ...emptyEquipment(), weaponRack: 1, chariotBox: 1 }, 2);
    chart.update(stats, stats);
    assert.equal(
      byClass(svg.children, "radar-current").getAttribute("points"),
      radarPolygon(statKeys.map((key) => stats[key])),
    );
    assert.equal(svg.children.filter((node) => node.tagName === "line").length, statKeys.length);
    assert.equal(svg.children.filter((node) => node.tagName === "text").length, statKeys.length);
  });
});

test("a hovered upgrade moves the preview ring and marks the labels it changes", () => {
  withFakeDocument(() => {
    const container = fakeSvgElement("div");
    const chart = createRadarChart(container);
    const svg = container.children[0];
    const owned = calculateChariotStats(emptyEquipment(), 1);
    const next = calculateChariotStats({ ...emptyEquipment(), weaponRack: 1 }, 1);

    chart.update(owned, next);
    const previewShape = byClass(svg.children, "radar-preview");
    assert.equal(previewShape.getAttribute("points"), radarPolygon(statKeys.map((key) => next[key])));
    assert.equal(previewShape.classList.contains("is-preview"), true);

    const labels = svg.children.filter((node) => node.tagName === "text");
    const firepower = labels[statKeys.indexOf("firepower")];
    assert.equal(firepower.classList.contains("is-up"), true, "a buffed stat is not marked up");
    assert.match(firepower.children[1].textContent, /▲/, "a buffed stat shows no delta");
    const protection = labels[statKeys.indexOf("protection")];
    assert.equal(protection.classList.contains("is-up"), false);
    assert.equal(protection.children[1].textContent, String(owned.protection));

    // Leaving the card drops the preview ring instead of leaving it on the wheel.
    chart.update(owned, owned);
    assert.equal(previewShape.classList.contains("is-preview"), false);
  });
});

test("every radar axis has a label in both locales", () => {
  for (const locale of Object.keys(locales)) {
    for (const key of statKeys) {
      assert.ok(locales[locale][statLabelKeys[key]], `${locale} is missing ${statLabelKeys[key]}`);
    }
    for (const key of ["shop.stats.chartLabel", "shop.rig.caption", "shop.camp.caption", "shop.dossier.label",
      "shop.collision.label", "shop.collision.description", "shop.info.label", "shop.shortGold"]) {
      assert.ok(locales[locale][key], `${locale} is missing ${key}`);
    }
  }
});

test("every equipment change names a stat the radar draws", () => {
  for (const item of equipment) {
    for (const level of item.levels) {
      for (const stat of Object.keys(level.bonuses)) {
        assert.ok(statKeys.includes(stat), `${item.id} buffs ${stat}, which the radar does not draw`);
      }
      for (const stat of Object.keys(level.penalties ?? {})) {
        assert.ok(statKeys.includes(stat), `${item.id} penalises ${stat}, which the radar does not draw`);
      }
    }
  }
  // And the other direction: a stat the rules expose but the chart ignores would
  // stay invisible to the player forever.
  const stats = calculateChariotStats(emptyEquipment(), 1);
  assert.deepEqual(Object.keys(stats).sort(), [...statKeys].sort());
});

test("the rig preview keeps the whole team inside its canvas", () => {
  // The three sizes the shop actually draws at: the desktop dossier, the narrow
  // strip and the phone strip.
  const boxes = [[320, 220], [180, 128], [120, 104]];
  for (let horseCount = 1; horseCount <= horses.max; horseCount += 1) {
    for (const [width, height] of boxes) {
      const rig = rigPreview(horseCount, width, height);
      const fit = projectRigBox(rig.box, rig);
      const label = `${horseCount} horses in ${width}x${height}`;
      assert.ok(rig.scale > 0, `${label}: scale collapsed`);
      assert.ok(fit.minX >= -0.01 && fit.minY >= -0.01,
        `${label}: rig spills off the top/left (${fit.minX}, ${fit.minY})`);
      assert.ok(fit.maxX <= width + 0.01 && fit.maxY <= height + 0.01,
        `${label}: rig spills off the bottom/right (${fit.maxX}, ${fit.maxY})`);
    }
  }
});

test("the rig box grows with the team instead of hiding it", () => {
  // The box is the contract the shop scales into; teams that fit the same box
  // would mean the preview is drawing horses on top of each other.
  const boxes = [];
  for (let horseCount = 1; horseCount <= horses.max; horseCount += 1) {
    boxes.push(rigPreview(horseCount, 320, 220).box);
  }
  for (let index = 1; index < boxes.length; index += 1) {
    assert.ok(boxes[index].width >= boxes[index - 1].width, "the rig box shrank as horses were added");
    assert.ok(boxes[index].height >= boxes[index - 1].height, "the rig box lost height as horses were added");
  }
  // The extra horses are harnessed along the team's depth, so the box grows on
  // that axis and not across it - which is why the preview fits the *rotated*
  // extent, not the raw box.
  assert.equal(boxes.at(-1).width, boxes[0].width, "the rig box changed width as horses were added");
  assert.ok(boxes.at(-1).height > boxes[0].height, "a four-horse rig is no taller than a single horse");
});

test("the camp fire seats the player plus one body per seat, far side first", () => {
  const seats = campSeats(4, { centerX: 100, centerY: 60, radius: 50 });
  assert.equal(seats.length, 4);
  assert.deepEqual(seats.map((seat) => seat.index).sort((a, b) => a - b), [0, 1, 2, 3]);
  // Painter's order: the far side is drawn before the fire, the near side after.
  const heights = seats.map((seat) => seat.y);
  assert.deepEqual(heights, [...heights].sort((a, b) => a - b));
  assert.equal(seats.at(-1).index, 0, "the player is not on the near rim");
  assert.equal(seats.at(-1).near, true);
  for (const seat of seats) {
    assert.ok(Number.isFinite(seat.x) && Number.isFinite(seat.y) && Number.isFinite(seat.facing),
      `seat ${seat.index} is not finite`);
    assert.ok(Math.abs(seat.x - 100) <= 50 + 1e-9, `seat ${seat.index} sits outside the ring`);
  }
  // One seat and no crew still seats the player: an empty fire would read as a bug.
  assert.equal(campSeats(1, { centerX: 0, centerY: 0, radius: 10 }).length, 1);
});

test("every recruit has a figure at the fire, and an unknown role still gets one", () => {
  const { overlayKinds } = createSpriteArt({ context: recordingContext().context });
  for (const member of personnel) {
    const figure = crewFigure(member.id);
    assert.equal(figure.isPlayer, false);
    assert.equal(figure.robeColor, crewRobe, `${member.id} is not wearing the ally colour`);
    assert.ok(figure.overlays.length > 0, `${member.id} sits at the fire with no kit`);
    for (const overlay of figure.overlays) {
      assert.ok(overlayKinds.foot.includes(overlay),
        `${member.id} asks for a "${overlay}" the foot art never painted`);
    }
  }
  // A row added tomorrow shows up at the fire before anyone has drawn it a kit.
  const unknown = crewFigure("future-recruit");
  assert.equal(unknown.isPlayer, false);
  assert.ok(unknown.overlays.length > 0);
  assert.equal(crewFigure().isPlayer, true, "seat 0 is the player");
});

test("the camp fire wears the colours the battlefield paints", () => {
  // Both scenes paint from one palette; a preview in a different green is the
  // classic way a shop screen stops matching the game behind it.
  assert.equal(playerRobe, spritePalette.playerRobe);
  assert.equal(crewRobe, spritePalette.allyRobe);
  assert.equal(crewBanner, spritePalette.playerBanner);
  const renderer = readFileSync(new URL("../src/render/renderer.js", import.meta.url), "utf8");
  for (const colour of [spritePalette.playerRobe, spritePalette.playerBanner, spritePalette.allyRobe]) {
    assert.equal(renderer.includes(colour), false, `renderer.js still hard-codes the team colour ${colour}`);
  }
});

// The preview owns a requestAnimationFrame loop, so the test owns the frame
// queue: `drain` hands the scene the stamps a browser at 30fps would.
function withAnimationFrames(run) {
  const previousWindow = globalThis.window;
  const previousRequest = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  const queue = new Map();
  let nextId = 1;
  let stamp = 0;
  globalThis.window = {
    ...previousWindow,
    devicePixelRatio: 2,
    matchMedia: (query) => ({ matches: false, media: query }),
  };
  globalThis.requestAnimationFrame = (callback) => {
    const id = nextId;
    nextId += 1;
    queue.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => queue.delete(id);
  const drain = (frames, step = 1000 / 30) => {
    for (let index = 0; index < frames; index += 1) {
      const pending = [...queue.values()];
      queue.clear();
      stamp += step;
      for (const callback of pending) callback(stamp);
    }
  };
  try {
    return run({ queue, drain });
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousRequest === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousRequest;
    if (previousCancel === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = previousCancel;
  }
}

// A canvas whose CSS box is what the test says it is: `shop-scene.js` measures
// the box and sizes the backing store, exactly like the battlefield's canvas.
function fakeCanvas(width, height, context) {
  return {
    width: 0,
    height: 0,
    getContext: () => context,
    getBoundingClientRect: () => ({ width, height, top: 0, left: 0 }),
  };
}

test("the shop preview animates only while the shop is open", () => {
  const rigRecorder = recordingContext();
  const campRecorder = recordingContext();
  const rigCanvas = fakeCanvas(320, 220, rigRecorder.context);
  const campCanvas = fakeCanvas(320, 128, campRecorder.context);
  withAnimationFrames(({ queue, drain }) => {
    const scene = createShopScene({ rigCanvas, campCanvas });
    // A dead companion is still in the roster the campaign owns; it must not be
    // drawn on the hull or seated at the fire.
    const roster = [{ role: "archer" }, { role: "halberdier", alive: false }];
    scene.update({ horseCount: 3, crew: roster });
    scene.preview({ horseCount: 3, crew: [{ role: "archer" }, { role: "halberdier" }] });
    assert.equal(queue.size, 0, "a closed shop asked for a frame");
    assert.deepEqual(scene.lastFrame(), { rig: null, camp: null }, "a closed shop painted its canvases");
    // Opening the shop re-renders the ledger first (`shop.js` -> `update`), which
    // is what drops a hover that was still set when the screen closed.
    scene.update({ horseCount: 3, crew: roster });

    scene.setActive(true);
    assert.equal(queue.size, 1, "an open shop scheduled more than one frame per frame");
    // The backing store follows the CSS box and the device pixel ratio, like the
    // battlefield's canvas does.
    assert.equal(rigCanvas.width, 640);
    assert.equal(rigCanvas.height, 440);
    assert.ok(rigRecorder.bounds.maxX > 0, "opening the shop did not paint the rig");
    assert.ok(campRecorder.bounds.maxX > 0, "opening the shop did not paint the camp");
    const owned = scene.lastFrame();
    assert.equal(owned.rig.crew, 1, "a buried companion still stands on the rig");
    assert.equal(owned.rig.horseCount, 3);
    assert.equal(owned.rig.isPreview, false, "the owned team opened as a preview");
    assert.equal(owned.camp.seats, 2, "the fire seated a body the campaign buried");

    scene.preview({ horseCount: 3, crew: [{ role: "archer" }, { role: "halberdier" }] });
    const hovered = scene.lastFrame();
    assert.equal(hovered.rig.crew, 2, "the hovered recruit is not on the previewed rig");
    assert.equal(hovered.rig.isPreview, true);
    assert.equal(hovered.camp.seats, 3, "the fire did not seat the hovered recruit");
    // A hover repaints the current phase; it does not restart or skip the clock.
    assert.equal(hovered.rig.time, owned.rig.time);

    drain(4);
    const later = scene.lastFrame();
    assert.equal(queue.size, 1, "the loop stopped scheduling after a frame");
    assert.ok(later.rig.time > owned.rig.time, "the preview clock did not advance");
    assert.ok(later.rig.time - owned.rig.time <= 4 / 30 + 1e-9,
      "the preview advanced further than the four frames it was given");

    // A render clears the preview, so a stale hover cannot outlive the ledger.
    scene.update({ horseCount: 3, crew: roster });
    assert.equal(scene.lastFrame().rig.isPreview, false, "re-rendering the ledger kept the hover");

    scene.setActive(false);
    assert.equal(queue.size, 0, "a closed shop kept its frame scheduled");
    const parked = scene.lastFrame().rig.time;
    drain(4);
    assert.equal(scene.lastFrame().rig.time, parked, "a closed shop kept animating");

    // Re-opening resumes on the phase it stopped at instead of jumping.
    scene.setActive(true);
    assert.equal(scene.lastFrame().rig.time, parked);
    assert.equal(queue.size, 1);
    scene.setActive(false);
  });
});

test("a shop canvas with no box is left alone", () => {
  const recorder = recordingContext();
  withAnimationFrames(({ drain }) => {
    // The narrow layout hides the camp fire, so its canvas measures 0x0 and the
    // scene has to skip it rather than draw at a guessed size.
    const scene = createShopScene({
      rigCanvas: fakeCanvas(320, 220, recorder.context),
      campCanvas: fakeCanvas(0, 0, recorder.context),
    });
    scene.update({ horseCount: 1, crew: [] });
    scene.setActive(true);
    assert.equal(scene.lastFrame().camp, null, "a zero-sized canvas was drawn anyway");
    assert.ok(scene.lastFrame().rig, "hiding the camp fire stopped the rig too");
    drain(3);
    assert.equal(scene.lastFrame().camp, null, "a later frame drew the hidden canvas");
    scene.setActive(false);

    // No canvases at all (a stripped page) is not an error either.
    const empty = createShopScene({});
    empty.update({ horseCount: 2, crew: [{ role: "archer" }] });
    empty.setActive(true);
    assert.deepEqual(empty.lastFrame(), { rig: null, camp: null });
    drain(2);
    empty.setActive(false);
  });
});

console.log("\n[unit] shop info panel");

// The panel is the shop's one description surface: cards carry a title, an
// effect line and a price, and the long copy (equipment descriptions are long
// enough to double every card) is swapped into one place under the summary.
function fakeInfoElement() {
  const classes = new Set();
  const label = { textContent: "" };
  const text = { textContent: "" };
  return {
    label,
    text,
    classes,
    element: {
      textContent: "",
      classList: {
        toggle(name, force) {
          const on = force === undefined ? !classes.has(name) : Boolean(force);
          if (on) classes.add(name); else classes.delete(name);
          return on;
        },
        contains: (name) => classes.has(name),
      },
      querySelector: (selector) => {
        if (selector === ".shop-info-label") return label;
        if (selector === ".shop-info-text") return text;
        return null;
      },
    },
  };
}

test("the shop info panel shows the standing rule until an item is picked", () => {
  const { element, label, text, classes } = fakeInfoElement();
  const panel = createInfoPanel(element);

  panel.paint();
  assert.equal(label.textContent, translate("shop.collision.label"));
  assert.equal(text.textContent, translate("shop.collision.description"));
  assert.equal(classes.has("is-item"), false, "the standing rule was marked as a picked item");

  // Pointing at a card paints that card's own copy in both languages of the
  // label and the body, with the accented state on.
  panel.paint(itemInfo("weaponRack", "equipment.weaponRack.name", translate("equipment.weaponRack.description")));
  assert.equal(label.textContent, translate("shop.info.label", { name: translate("equipment.weaponRack.name") }));
  assert.equal(text.textContent, translate("equipment.weaponRack.description"));
  assert.equal(classes.has("is-item"), true, "a picked item was not marked as one");

  // Releasing the pointer falls back to the rule instead of keeping the pick.
  panel.paint(null);
  assert.equal(text.textContent, translate("shop.collision.description"));
  assert.equal(classes.has("is-item"), false, "a released item stayed pinned");
});

test("a shop info panel without children still reads as one line", () => {
  // A harness - or a stripped page - whose element reports no child nodes must
  // not throw: the whole line lands in `textContent`, which is what a screen
  // reader reads out of the live region anyway.
  const element = { textContent: "", classList: { toggle() {} } };
  const panel = createInfoPanel(element);
  panel.paint();
  assert.equal(element.textContent,
    `${translate("shop.collision.label")}${translate("shop.collision.description")}`);
  panel.paint(itemInfo("horse", "shop.horse", translate("horse.description")));
  assert.equal(element.textContent,
    `${translate("shop.info.label", { name: translate("shop.horse") })}${translate("horse.description")}`);
});

test("a shop info panel with no element is a no-op", () => {
  const panel = createInfoPanel(null);
  assert.doesNotThrow(() => {
    panel.paint();
    panel.paint(itemInfo("horse", "shop.horse", "…"));
  });
});

console.log(`\n[unit] PASS (${passed} checks)`);
