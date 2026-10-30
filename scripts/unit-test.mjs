// Pure-logic regression tests for the gameplay rules that have no DOM
// dependency. Usage: node scripts/unit-test.mjs
import "./dom-stub.mjs";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import {
  calculateArrowDamage, calculateChariotCollisionDamage, calculateChariotKit, calculateChariotStats,
  calculateHullHealth, calculateMobilityMultiplier, calculateProtectionChance,
  emptyEquipment, equipment, getPlayerArrowCount, hasMaxedAxleCap, horses, personnel,
} from "../src/data/equipment.js";
import { campaignRules, chariotRules, effectRules, projectileRules } from "../src/data/rules.js";
import { addBloodStain } from "../src/game/blood.js";
import { selectAimTarget } from "../src/game/aim.js";
import { createPlayerIdentity, pickWeighted } from "../src/game/identity.js";
import { battlefields } from "../src/data/battlefields.js";
import { clanNames, givenNames } from "../src/data/names.js";
import { createCollisionSystem } from "../src/game/collision.js";
import { createCombatSystem } from "../src/game/combat.js";
import { cloudKinds, elementRules, groundVisual, obstacleKinds, terrainKinds } from "../src/data/elements.js";
import {
  clearsSight, cloudDrift, elementBoundingRadius, elementCullMargin, elementIntersects,
  elementSpeedAt, fellTree, isFellable, obstacleShape, rectHitsAnyObstacle, rectTerrain,
} from "../src/game/elements.js";
import { createBattlefield } from "../src/game/map.js";
import { bandsFromShares, createRingLayout, resolveRingHalves, ringLayoutFromShares } from "../src/game/rings.js";
import { parseRingShares, ringRules } from "../src/data/rings.js";
import { buildWalkMap } from "../src/game/reachability.js";
import { createTutorial } from "../src/game/tutorial.js";
import {
  LINE_DISTANCES, TUTORIAL_LAYOUT, createTutorialMapCheck, findLineGround, lineGroundExtent, planTigerGround,
} from "../src/game/tutorial-map.js";
import { wildAnimalStats } from "../src/data/wilds.js";
import { createElementRenderer } from "../src/render/elements.js";
import { createGroundPainter } from "../src/render/ground.js";
import { createRenderer } from "../src/render/renderer.js";
import { chariotRigBox, createSpriteArt, spritePalette } from "../src/render/sprites.js";
import { CHARIOT_CONTROL_CONFIG, createPlayerController } from "../src/game/player.js";
import { bossTypes, chariotTactics, enemyStats, formationAura, formationConfig, formationOrders, formationPatterns, formationPresets } from "../src/data/formations.js";
import {
  createBallisticProjectile, createProjectileSystem, solveBallisticElevation,
  solveTimeToGround, updateProjectiles,
} from "../src/game/projectiles.js";
import { createEnemies } from "../src/game/units/enemies.js";
import { createBehaviours } from "../src/game/units/behaviours.js";
import {
  createAllies, isLooseChariot,
} from "../src/game/units/allies.js";
import {
  CHARIOT_INTENT, CHARIOT_STATE, chariotIntent, nextChariotState,
} from "../src/game/units/chariot.js";
import { countParticles, pruneParticles, spawnParticle, updateParticles } from "../src/game/particles.js";
import { createTrailSystem } from "../src/game/trails.js";
import {
  chasePoint, defendedPoint, formationExtent, formationGroundExtent, isInsideFormation, searchPoint,
  tickFormationAura, updateFormationAlerts,
} from "../src/game/units/formations.js";
import {
  ORDER_ACTION, advanceOrders, applyOrder, commandedFormation, formationUnder, issueOrder, toggleOrder,
} from "../src/game/units/formation-orders.js";
import { clamp, shortestAngleDifference } from "../src/utils/math.js";
import { createRandomSeed, createSeededRandom, parseSeed } from "../src/utils/random.js";
import { updateCamera } from "../src/render/camera.js";
import {
  campSeats, radarGeometry, radarPoint, radarPolygon, rigPreview,
  roleFigure, rowsPerPageFor, statKeys, statLabelKeys,
} from "../src/ui/shop-layout.js";
import { drawCamp, drawRig } from "../src/ui/shop-scene.js";
import { drawRadar } from "../src/ui/shop-dossier.js";
import { createShopScreen } from "../src/ui/shop-screen.js";
import { CARD_ACTIONS, cardForMode, cardForTutorial } from "../src/ui/battle-card.js";
import { createMenuPage } from "../src/ui/menu-page.js";
import { computeMenuLayout } from "../src/ui/menu-layout.js";
import { prologueLines } from "../src/ui/prologue.js";
import { setLocale, translate } from "../src/i18n/index.js";
import { defaultLocale, hasTranslation, registerLocale, supportedLocales, translator } from "../src/i18n/locales.js";
import { createStorage, localStorageDriver } from "../src/platform/storage.js";
import { launchQuery } from "../src/platform/launch.js";
import {
  describeSoundFile, resolveSoundscape, soundBorrowed, soundCues, soundDeathCues, soundFiles, soundLimits,
  soundMix, soundPurchaseCues, soundStreams, soundChannels,
} from "../src/data/sounds.js";
import { buildMixTable, createAudio, indexSoundFiles } from "../src/assets/audio.js";
import { pickFinalStage } from "../src/game/stages.js";
import {
  VICTORY_LOCK_KEY, VICTORY_LOCK_MINUTES, VICTORY_LOCK_MS, createVictoryLock, parseVictoryRecord,
} from "../src/game/victory-lock.js";
import { countdownLabel, lockWindowLabel, stageLabel } from "../src/ui/labels.js";
import zhCN from "../src/assets/i18n/zh-CN.json" with { type: "json" };
import en from "../src/assets/i18n/en.json" with { type: "json" };

let passed = 0;
function test(name, run) {
  run();
  passed += 1;
  console.log(`  ok   ${name}`);
}

// A few contracts can only be checked once a promise has settled - the sound
// player answers with the decode it started - so those are collected here and
// awaited in order at the very end, next to the sync ones' output.
const asyncTests = [];
function asyncTest(name, run) {
  asyncTests.push({ name, run });
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

test("obstacleAt names the element the move was rejected by", () => {
  const wall = { type: "wall", x: 400, y: 300, width: 200, height: 40 };
  const local = { obstacles: [campaign.obstacles[0], wall], terrain: [] };
  const field = createCollisionSystem({ campaign: local, world });
  assert.equal(field.obstacleAt(510, 320, 6), wall, "a point inside the wall must name the wall");
  assert.equal(field.obstacleAt(500, 400, 6).type, "tree");
  assert.equal(field.obstacleAt(100, 700, 6), null, "open ground names nothing");
  // The two queries are the same predicate: whatever one rejects, the other names.
  assert.equal(field.circleIntersectsObstacle(510, 320, 6), field.obstacleAt(510, 320, 6) !== null);
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

// A recording 2D context: with every style write and every call kept in order, so
// a test can read the picture back instead of trusting the painter's source. The
// named handful is what the floor and the terrain patches use; everything else the
// canvas API has (text, dashes, clips) still lands in the log through the proxy
// fallback, which is what lets one recorder drive a whole `draw()` and still say
// "the last two paints in the frame are the cloud's". (The sprite tests further
// down use `recordingContext`, which measures extents instead.)
function callLog() {
  const log = [];
  // Style state kept aside so a test (or a painter) can read a property back.
  const style = new Map([["fillStyle", ""], ["strokeStyle", ""], ["lineWidth", 1], ["globalAlpha", 1]]);
  const gradient = () => ({
    addColorStop: (offset, color) => log.push(["addColorStop", [offset, color]]),
  });
  const api = {
    log,
    // Wide enough that a label box stays positive: no test asserts on its width.
    measureText: (text) => {
      log.push(["measureText", [text]]);
      return { width: String(text).length * 6 };
    },
    createLinearGradient: (...args) => {
      log.push(["createLinearGradient", args]);
      return gradient();
    },
    createRadialGradient: (...args) => {
      log.push(["createRadialGradient", args]);
      return gradient();
    },
    createPattern: () => null,
  };
  return new Proxy(api, {
    get(target, property) {
      if (property in target) return target[property];
      if (typeof property !== "string") return undefined;
      if (style.has(property)) return style.get(property);
      // Any other method only has to exist and log itself.
      const recorder = (...args) => {
        log.push([property, args]);
        return undefined;
      };
      target[property] = recorder;
      return recorder;
    },
    set(target, property, value) {
      style.set(property, value);
      // A gradient object cannot be compared across two runs, so the log keeps its
      // name: the stops themselves are recorded by `addColorStop`.
      log.push([property, [typeof value === "object" && value !== null ? "<gradient>" : value]]);
      return true;
    },
  });
}

// Colours are authored as hex or rgba(), and the floor's whole contract is about
// how close two of them are, so the tests have to read them.
function parseColor(color) {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const value = Number.parseInt(hex[1], 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 1];
  }
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(color);
  assert.ok(rgba, `"${color}" is not a colour this test can read`);
  return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] === undefined ? 1 : Number(rgba[4])];
}

function relativeLuminance([red, green, blue]) {
  const channel = (value) => {
    const share = value / 255;
    return share <= 0.03928 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function contrastRatio(first, second) {
  const [light, dark] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

test("the floor is a texture, not a grid: no long straight edge anywhere", () => {
  const width = 960;
  const height = 592;
  const context = callLog();
  createGroundPainter({ context }).drawGround(0, 0, width, height);

  // The base wash comes first, and it comes from the data row: the painter must
  // not keep a second copy of the floor colour.
  assert.deepEqual(context.log[0], ["fillStyle", [groundVisual.base]]);
  assert.deepEqual(context.log[1], ["fillRect", [0, 0, width, height]]);

  // Every number handed to the rasteriser has to be finite, exactly as the smoke
  // test insists of the game itself.
  for (const [name, args] of context.log) {
    for (const value of args) {
      if (typeof value === "number") assert.ok(Number.isFinite(value), `${name} was handed ${value}`);
    }
  }

  // The 40px lattice this replaced drew lines the width of the viewport, and those
  // were the strongest edges on the field. Everything left must be a grass blade:
  // a few pixels long.
  assert.ok(!context.log.some(([name]) => name === "strokeRect" || name === "rect"),
    "the floor still draws a rectangle outline");
  let longest = 0;
  let cursor = null;
  for (const [name, args] of context.log) {
    if (name === "moveTo") cursor = [args[0], args[1]];
    else if (name === "lineTo" || name === "quadraticCurveTo") {
      const tip = name === "lineTo" ? [args[0], args[1]] : [args[2], args[3]];
      if (cursor) longest = Math.max(longest, Math.hypot(tip[0] - cursor[0], tip[1] - cursor[1]));
      cursor = tip;
    } else if (name === "stroke" || name === "fill") cursor = null;
  }
  assert.ok(longest > 0, "the floor has no grass on it at all");
  assert.ok(longest < 40, `the floor draws a ${longest.toFixed(0)}px straight edge - that is a grid line`);
  // The floor is a full-screen background, so its canvas calls are a frame cost:
  // a ratchet on today's ~650 at this size, not a target to grow into.
  assert.ok(context.log.length < 900, `the floor costs ${context.log.length} canvas calls a frame`);

  // Same camera, same field: painted identically, because every fleck is hashed
  // from its own cell and nothing in the painter is `Math.random`. A floor that
  // repainted differently would shimmer.
  const again = callLog();
  createGroundPainter({ context: again }).drawGround(0, 0, width, height);
  assert.deepEqual(again.log, context.log, "the floor repaints differently on a second frame");

  // ...and it belongs to the world, not to the screen: a scrolled camera has to
  // see a different piece of ground, or the texture would look glued on.
  const scrolled = callLog();
  createGroundPainter({ context: scrolled }).drawGround(240, 180, width, height);
  assert.notDeepEqual(scrolled.log, context.log, "the floor follows the camera instead of the world");
});

test("the floor palette stays low contrast, so it never competes with a silhouette", () => {
  const base = parseColor(groundVisual.base);
  assert.ok(groundVisual.wash.tones.length >= 2, "a single wash is a flat floor again");
  for (const tone of groundVisual.wash.tones) {
    const core = parseColor(tone.core);
    const edge = parseColor(tone.edge);
    assert.deepEqual(edge.slice(0, 3), core.slice(0, 3), `${tone.core} feathers to a different colour`);
    assert.equal(edge[3], 0, `${tone.core} leaves a rim at its edge`);
    // The wash as it lands on the floor, then the ratio: past ~1.2:1 this stops
    // being shading and becomes a blotch.
    const mixed = [0, 1, 2].map((index) => base[index] * (1 - core[3]) + core[index] * core[3]);
    const ratio = contrastRatio(base, mixed);
    assert.ok(ratio < 1.2, `${tone.core} moves the floor to ${ratio.toFixed(2)}:1`);
  }
  // The grass flecks are the one thing allowed to be visible - but only just, and
  // there must be more bare soil than grass.
  for (const color of groundVisual.fleck.colors) {
    const tone = parseColor(color);
    assert.ok(tone[3] > 0.12 && tone[3] < 0.4, `${color} is either invisible or a stain`);
  }
  assert.ok(groundVisual.fleck.chance < 0.7, "the floor is a lawn, not a field");
  assert.ok(groundVisual.grit.chance > 0, "bare soil has no grain at all");
});

test("every terrain patch feathers into the floor instead of ending on a hard ellipse", () => {
  for (const [type, row] of Object.entries(terrainKinds)) {
    const fill = parseColor(row.visual.fill);
    const fade = parseColor(row.visual.fade);
    assert.ok(fill[3] > 0, `${type} has an invisible fill`);
    assert.equal(fade[3], 0, `${type}'s fade stop is not transparent`);
    assert.deepEqual(fade.slice(0, 3), fill.slice(0, 3), `${type} fades to a different colour`);
  }
});

test("a grass patch is tall blades and weeds, not a tint", () => {
  const art = terrainKinds.grass.visual;
  assert.equal(art.kind, "weeds", "the grass patch lost its own silhouette");
  assert.ok(art.blade.length >= 2, "every blade uses the same tone");
  assert.ok(art.height[0] < art.height[1], "the blade height range is flat");
  assert.ok(art.weedHeight[1] > art.height[1], "the weeds are no taller than the grass");

  // Measure the picture rather than the table: the stems have to stand up out of
  // the bed, or the patch is the tint it used to be.
  const radiusY = 60;
  const context = callLog();
  createElementRenderer({ context }).drawTerrain({ type: "grass", x: 0, y: 0, radiusX: 80, radiusY });
  let tallest = 0;
  let cursor = null;
  for (const [name, args] of context.log) {
    if (name === "moveTo") cursor = [args[0], args[1]];
    else if (name === "quadraticCurveTo" && cursor) {
      tallest = Math.max(tallest, cursor[1] - args[3]);
      cursor = [args[2], args[3]];
    } else if (name === "fill" || name === "stroke") cursor = null;
  }
  assert.ok(tallest > radiusY * 0.4,
    `the tallest stem is ${tallest.toFixed(1)}px on a ${radiusY}px patch - that is a tint, not grass`);
  assert.ok(tallest < radiusY, `${tallest.toFixed(1)}px of stem is taller than the patch is deep`);
  // The bed is feathered and the weeds carry seed heads: the two things that make
  // a patch read as vegetation standing in soil.
  assert.ok(context.log.some(([name]) => name === "createRadialGradient"), "the patch still fills as a hard disc");
  assert.equal(context.log.filter(([name]) => name === "ellipse").length, art.weeds,
    "every weed should carry exactly one seed head");
  // A patch is drawn per frame too: the ratchet keeps a future "more blades!"
  // edit from quietly turning seven patches into seven thousand calls.
  assert.ok(context.log.length < 260, `one grass patch costs ${context.log.length} canvas calls`);
});

// The battlefield's layering is part of the art: a cloud is translucent by design,
// so it may cross the field over anything at all - but only if it is painted last.
// This drives one whole frame through the real renderer and reads the calls back,
// so "the sky is on top" stays a fact about the picture instead of a claim about
// the source order that a later layer can quietly break.
test("clouds are the last thing painted, and only ever a veil", () => {
  const view = { width: 960, height: 592 };
  const context = callLog();
  const sky = cloudKinds.sky;
  // Deliberately overlapping: the puff sits over the tree, the wall and the enemy.
  const cloud = { type: "sky", x: 300, y: 280, width: 240, height: 96, opacity: sky.opacity[1], phase: 0, speed: 0 };
  const tree = { type: "tree", x: 250, y: 300, radius: 30 };
  const wall = { type: "wall", x: 360, y: 250, width: 150, height: 34, rotation: 0 };
  const robe = "#123456";
  const enemy = {
    x: 320, y: 330, angle: 0.3, radius: 12, health: 6, maxHealth: 10,
    knockedDown: 0, hitFlash: 0, destroyed: false,
    visual: { kind: "foot", robe, scale: 1.3, overlays: ["sword"] },
  };
  createRenderer({
    canvas: { width: view.width, height: view.height },
    context, view,
    camera: { x: 0, y: 0 },
    world: { width: 2800, height: 1800 },
    player: {
      x: 90, y: 470, angle: 0, radius: 14, health: 10, maxHealth: 10,
      invulnerable: 0, mode: "mounted", destroyed: false,
    },
    state: {
      elapsed: 1.5, shake: 0, damageFlash: 0, phase: "running", extractionPoint: null,
      particles: [], bloodStains: [], groundArrows: [], drops: [], meleeEffects: [],
      formations: [], allyFormations: [], bullets: [],
      enemies: [enemy], footCompanions: [], allies: [],
    },
    getObstacles: () => [tree, wall],
    getTerrain: () => [{ type: "grass", x: 720, y: 430, radiusX: 90, radiusY: 62 }],
    getClouds: () => [cloud],
    getHorseCount: () => 2,
    getRoster: () => [],
  }).draw();

  const log = context.log;
  // The cloud is found by its own shade stops, which no other painter uses: the
  // first stop is where its paint begins, and the body write lands a little later.
  const cloudStart = log.findIndex(([name, args]) => name === "addColorStop" && args[1] === sky.visual.shade[0]);
  const cloudAt = log.findIndex(([name, args]) => name === "fillStyle" && args[0] === sky.visual.body);
  assert.ok(cloudStart > 0 && cloudStart < cloudAt, "the cloud was never painted");

  // Everything that used to be able to cover a cloud is painted before it: the
  // canopy, a palisade, and a body with its health bar.
  const markers = [
    ["the canopy", obstacleKinds.tree.visual.leaf[0]],
    ["the palisade", obstacleKinds.wall.visual.body],
    ["the body", robe],
  ];
  for (const [what, color] of markers) {
    const index = log.findIndex(([name, args]) => name === "fillStyle" && args[0] === color);
    assert.ok(index >= 0, `${what} was never painted`);
    assert.ok(index < cloudAt, `${what} is painted over the cloud`);
  }

  // And nothing at all follows the cloud except its own body and rim: exactly two
  // paints to the end of the frame.
  const after = log.slice(cloudAt)
    .filter(([name]) => name === "fill" || name === "stroke" || name === "fillRect" || name === "fillText");
  assert.deepEqual(after.map(([name]) => name), ["fill", "stroke"],
    `something painted over the cloud: ${after.map(([name]) => name).join(", ")}`);

  // Being on top is only safe because it is a veil: the strongest alpha the cloud
  // ever reaches is its own row's ceiling, times the deepest breath it takes.
  const ceiling = sky.opacity[1] * (sky.visual.breathe.base + sky.visual.breathe.depth);
  // The shade's alpha is written before its gradient is even built, so the veil
  // starts two entries above the first stop: a shade, a body and a rim, in order.
  assert.equal(log[cloudStart - 2][0], "globalAlpha", "the cloud no longer fades its own shade");
  const alphas = log.slice(cloudStart - 2).filter(([name]) => name === "globalAlpha").map(([, [value]]) => value);
  assert.equal(alphas.length, 3, `the cloud painted ${alphas.length} alphas, not a shade, a body and a rim`);
  for (const alpha of alphas) {
    assert.ok(alpha <= ceiling + 1e-9, `a cloud painted at ${alpha} is not translucent any more`);
  }
});

test("a tree leans inside its declared wind, and one hit adds one decaying wobble", () => {
  const art = obstacleKinds.tree.visual;
  const hitRules = effectRules.treeHit;
  const { treeSwayAngle } = createElementRenderer({ context: {} });
  const tree = { type: "tree", x: 480, y: 320, radius: 30 };
  const worst = art.sway + hitRules.angle;

  let previous = treeSwayAngle(tree, 0, art, hitRules);
  let moved = 0;
  for (let frame = 1; frame <= 240; frame += 1) {
    const angle = treeSwayAngle(tree, frame / 30, art, hitRules);
    assert.ok(Number.isFinite(angle), `frame ${frame} leaned by ${angle}`);
    assert.ok(Math.abs(angle) <= worst + 1e-9, `frame ${frame} leaned ${angle}, past the declared wind`);
    if (Math.abs(angle - previous) > 1e-4) moved += 1;
    previous = angle;
  }
  assert.ok(moved > 100, `an unhit tree is not swaying (${moved} moving frames)`);

  // One hit: the wobble starts from the tree's own sway (no jump), peaks above it,
  // and is completely gone when its window closes - a hit in the future does
  // nothing yet, so the field cannot shake before the chariot arrives.
  const hitTree = { ...tree, hitAt: 2 };
  assert.equal(treeSwayAngle(hitTree, 2, art, hitRules), treeSwayAngle(tree, 2, art, hitRules));
  const peak = Math.max(...Array.from({ length: 14 }, (_, step) =>
    Math.abs(treeSwayAngle(hitTree, 2 + step / 60, art, hitRules))));
  assert.ok(peak > art.sway, `a hit did not shake the tree (peak ${peak})`);
  assert.ok(peak <= worst + 1e-9, `a hit shook the tree past the declared wind (peak ${peak})`);
  assert.equal(treeSwayAngle(hitTree, 2 + hitRules.duration, art, hitRules), treeSwayAngle(tree, 2 + hitRules.duration, art, hitRules));
  assert.equal(treeSwayAngle({ ...tree, hitAt: 5 }, 4.9, art, hitRules), treeSwayAngle(tree, 4.9, art, hitRules));
  assert.equal(treeSwayAngle(tree, undefined, art, hitRules), treeSwayAngle(tree, 0, art, hitRules),
    "a painter called without a clock must not paint NaN");
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
    fillText() {}, strokeText() {},
    measureText: (value) => ({ width: String(value).length * 6 }),
    setLineDash() {},
    drawImage() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => null,
  };
  return { context, bounds };
}

function measureRig(horseCount, crew = [], kit = null) {
  const recorder = recordingContext();
  createSpriteArt({ context: recorder.context }).drawChariotRig({
    robeColor: "#17796f", horseCount, elapsed: 0.4, crew, banner: "#41b7a3",
    // No kit is the stock rig: an enemy row that buys nothing paints it.
    ...(kit ?? {}),
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

test("the chassis art follows the equipment levels, one level at a time", () => {
  // Everything the rig needs is derived from the levels the campaign owns, so the
  // shop preview and the battlefield cannot disagree about the carriage.
  assert.deepEqual(calculateChariotKit(emptyEquipment()), { crossbows: 1, bodyScale: 1, bladeLength: 0 },
    "an empty campaign must paint the stock rig");
  let previous = calculateChariotKit(emptyEquipment());
  for (const level of [1, 2, 3]) {
    const levels = { weaponRack: level, axleCap: level, chariotBox: level };
    const kit = calculateChariotKit(levels);
    assert.equal(kit.crossbows, getPlayerArrowCount(levels),
      `level ${level} shows ${kit.crossbows} crossbows but fires ${getPlayerArrowCount(levels)} bolts`);
    assert.ok(kit.crossbows > previous.crossbows, `level ${level} did not add a crossbow`);
    assert.ok(kit.bodyScale > previous.bodyScale, `level ${level} did not grow the box`);
    assert.ok(kit.bladeLength > previous.bladeLength, `level ${level} did not lengthen the blades`);
    assert.equal(hasMaxedAxleCap(levels), level === equipment.find((item) => item.id === "axleCap").levels.length,
      `hasMaxedAxleCap disagrees with the axleCap table at level ${level}`);
    previous = kit;
  }
  assert.equal(hasMaxedAxleCap({}), false, "no purchase is not a maxed axle cap");
  assert.equal(hasMaxedAxleCap({ axleCap: 2 }), false, "the second level is not the last one");
});

test("the bought chassis still paints inside the box the shop scales into", () => {
  // A maxed campaign is the widest silhouette the rig can have: four crossbows on
  // the deck, the biggest box and the longest axle blades. The unbought kit rides
  // along too, because the player always owns the first crossbow.
  const axleLevels = equipment.find((item) => item.id === "axleCap").levels.length;
  const kits = [
    calculateChariotKit(emptyEquipment()),
    calculateChariotKit({
      weaponRack: equipment[0].levels.length,
      axleCap: axleLevels,
      chariotBox: equipment.find((item) => item.id === "chariotBox").levels.length,
    }),
  ];
  const fullCrew = ["archer", "halberdier", "archer", "halberdier"].map((role) => ({ role }));
  for (const kit of kits) {
    for (const horseCount of [1, 2, 3, 4]) {
      const box = chariotRigBox(horseCount, kit);
      const drawn = measureRig(horseCount, fullCrew, kit);
      assert.ok(box.minX <= drawn.minX && box.maxX >= drawn.maxX,
        `a ${kit.crossbows}-crossbow ${horseCount}-horse rig paints past its box horizontally (${drawn.minX}..${drawn.maxX} vs ${box.minX}..${box.maxX})`);
      assert.ok(box.minY <= drawn.minY && box.maxY >= drawn.maxY,
        `a ${kit.crossbows}-crossbow ${horseCount}-horse rig paints past its box vertically (${drawn.minY}..${drawn.maxY} vs ${box.minY}..${box.maxY})`);
      // The stock box is what an enemy row and the shop's default preview use, so a
      // kit may only ever add room, never take it away.
      const stock = chariotRigBox(horseCount);
      assert.ok(box.minX <= stock.minX && box.maxX >= stock.maxX
        && box.minY <= stock.minY && box.maxY >= stock.maxY,
      `the kit shrank the ${horseCount}-horse box, so a stock rig could clip`);
      assert.ok(stock.maxX >= measureRig(horseCount, fullCrew).maxX,
        `the stock ${horseCount}-horse rig no longer fits the stock box`);
    }
  }
  // The blades are the piece that reaches sideways, so a single horse - the team
  // the blades outgrow - must be the one that grows the box.
  const maxed = kits[1];
  assert.ok(chariotRigBox(1, maxed).height > chariotRigBox(1).height, "the axle blades did not grow the box");
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

console.log("[unit] battlefield rings");

const ringWorld = { width: 2800, height: 1800 };

test("the four bands tile the map and keep its shape", () => {
  const layout = createRingLayout(ringWorld);
  assert.equal(layout.rings.length, 4);
  // Thickness adds up to the half-span on both axes - once per side, so the two
  // sides make the full span - and no band overlaps its neighbour.
  const width = layout.rings.reduce((sum, ring) => sum + ring.thicknessX, 0);
  const height = layout.rings.reduce((sum, ring) => sum + ring.thicknessY, 0);
  assert.ok(Math.abs(width - ringWorld.width / 2) < 1e-6, `the bands reach ${width}px from the centre`);
  assert.ok(Math.abs(height - ringWorld.height / 2) < 1e-6, `the bands reach ${height}px from the centre`);
  const area = layout.rings.reduce((sum, ring) => sum + ring.bandArea, 0);
  assert.ok(Math.abs(area - ringWorld.width * ringWorld.height) < 1e-3, `the bands cover ${area}px2`);
  for (const ring of layout.rings) {
    // Every band is concentric, and each keeps the map's own aspect ratio: an
    // oval 回 pattern would move the ring seams away from the drawn field.
    assert.ok(Math.abs(ring.rect.x + ring.rect.width / 2 - layout.centreX) < 1e-6);
    assert.ok(Math.abs(ring.rect.y + ring.rect.height / 2 - layout.centreY) < 1e-6);
    const aspect = ring.rect.width / ring.rect.height;
    assert.ok(Math.abs(aspect - ringWorld.width / ringWorld.height) < 1e-9, `ring ${ring.id} is ${aspect}:1`);
  }
  // `t` is 0 at the centre and 1 at the edge, so the outermost stop is the edge.
  assert.equal(layout.rings[layout.rings.length - 1].threshold, 1);
});

test("20/45/20/15 puts the fifth in the middle and a rim on the outside", () => {
  const [a, b, c, d] = createRingLayout(ringWorld).rings;
  // The innocuous-looking numbers are the point of the test: A is a half-span, so
  // 0.20 is a fifth of the width on each side, and the outer three then divide
  // what is left of the half-span (1050px) in their own 45:20:15 ratio.
  const near = (value, expected) => Math.abs(value - expected) < 1e-6;
  assert.ok(near(a.rect.width, 1120) && near(a.rect.height, 720), `A is ${a.rect.width}x${a.rect.height}`);
  assert.ok(near(b.thicknessX, 472.5) && near(b.thicknessY, 303.75), `B is ${b.thicknessX} thick`);
  assert.ok(near(c.thicknessX, 210) && near(c.thicknessY, 135), `C is ${c.thicknessX} thick`);
  assert.ok(near(d.thicknessX, 157.5) && near(d.thicknessY, 101.25), `D is ${d.thicknessX} thick`);
  // B has the most ground of the four, which is why it carries the enemy ladder.
  const widest = [...createRingLayout(ringWorld).rings].sort((l, r) => r.bandArea - l.bandArea)[0];
  assert.equal(widest.id, "B");
  // Ring A has to hold the spawn clearing (elementRules.obstacleSafeRadius 280),
  // or the first element of a battle would be dropped on every roll.
  assert.ok(a.thicknessX >= 560 && a.thicknessY >= 360, "ring A is smaller than the spawn clearing");
});

test("one word switches how the innermost share is measured", () => {
  const half = createRingLayout(ringWorld);
  const band = createRingLayout(ringWorld, { innermostSpan: "band" });
  const near = (value, expected) => Math.abs(value - expected) < 1e-6;
  assert.ok(near(half.bandOf("A").rect.width, 1120), `half gives ${half.bandOf("A").rect.width}`);
  assert.ok(near(band.bandOf("A").rect.width, 560), `band gives ${band.bandOf("A").rect.width}`);
  // Both readings tile; only the seams move.
  for (const layout of [half, band]) {
    const width = layout.rings.reduce((sum, ring) => sum + ring.thicknessX, 0);
    assert.ok(near(width, ringWorld.width / 2), `${layout.innermostSpan} reaches ${width}px`);
  }
  // The halves are compared with a tolerance on purpose: 0.3 * 0.45 / 0.8 is not
  // the decimal 0.16875 in binary, and the table is authored in decimals.
  const halves = (layout) => layout.halves.map((value) => Number(value.toFixed(5)));
  assert.deepEqual(halves(half), [0.2, 0.36875, 0.44375, 0.5]);
  assert.deepEqual(halves(band), [0.1, 0.325, 0.425, 0.5]);
});

test("the ratio is data: any table that sums to 1 is accepted", () => {
  // Nothing in src/game/rings.js knows the ids or how many bands there are, which
  // is what makes the ratios adjustable at any time rather than a constant to
  // migrate.
  const evenBands = [
    { id: "core", share: 0.25 },
    { id: "mid", share: 0.25 },
    { id: "outer", share: 0.25 },
    { id: "rim", share: 0.25 },
  ];
  const even = createRingLayout(ringWorld, { bands: evenBands });
  assert.deepEqual(even.rings.map((ring) => ring.id), ["core", "mid", "outer", "rim"]);
  assert.ok(Math.abs(even.rings[3].threshold - 1) < 1e-12, "the outer band does not reach the edge");
  // A quarter half-span first, then the remaining quarter split evenly.
  assert.ok(Math.abs(resolveRingHalves(evenBands, "half")[1] - (0.25 + 0.25 / 3)) < 1e-9);
  // The same point changes ring when only the table changes: t = 0.6 sits in B at
  // 20/45/20/15 and in `mid` at 25/25/25/25, because a 20% innermost band ends at
  // t 0.4 and a 25% one ends at t 0.5.
  const point = { x: ringWorld.width / 2 + 840, y: ringWorld.height / 2 };
  assert.equal(createRingLayout(ringWorld).ringAt(point.x, point.y), "B");
  assert.equal(even.ringAt(point.x, point.y), "mid");
});

test("ringAt is the rect table, checked on a grid", () => {
  const layout = createRingLayout(ringWorld);
  const steps = 40;
  for (let row = 0; row < steps; row += 1) {
    for (let column = 0; column < steps; column += 1) {
      const x = ((column + 0.5) / steps) * ringWorld.width;
      const y = ((row + 0.5) / steps) * ringWorld.height;
      const ring = layout.bandOf(layout.ringAt(x, y));
      assert.ok(x >= ring.rect.x - 1e-6 && x <= ring.rect.x + ring.rect.width + 1e-6, `(${x}, ${y}) is outside ${ring.id}`);
      assert.ok(y >= ring.rect.y - 1e-6 && y <= ring.rect.y + ring.rect.height + 1e-6, `(${x}, ${y}) is outside ${ring.id}`);
      // ... and outside the band inside it, or the innermost match would be wrong.
      if (ring.index > 0) {
        const inInner = Math.abs(x - layout.centreX) <= ring.innerHalfWidth + 1e-6
          && Math.abs(y - layout.centreY) <= ring.innerHalfHeight + 1e-6;
        assert.equal(inInner, false, `(${x}, ${y}) is inside the inner rect but was called ${ring.id}`);
      }
    }
  }
});

test("a sampled point always lands in the band it was asked for", () => {
  const layout = createRingLayout(ringWorld);
  for (const ring of layout.rings) {
    const random = createSeededRandom(31 + ring.index);
    for (let index = 0; index < 400; index += 1) {
      const point = layout.samplePoint(ring.id, random);
      assert.equal(layout.ringAt(point.x, point.y), ring.id, `${ring.id} sampled ${point.x},${point.y}`);
    }
  }
  // The rim is sampled from four strips, not from its bounding rect: a rect would
  // drop most rim points in the middle of the map where ring A is.
  assert.ok(layout.bandOf("D").innerHalfWidth > 0 && layout.bandOf("D").innerHalfHeight > 0);
});

test("a sample costs three draws, so a map's stream does not shift with the ratios", () => {
  const layout = createRingLayout(ringWorld);
  let draws = 0;
  const random = createSeededRandom(7);
  const counted = () => {
    draws += 1;
    return random();
  };
  const first = layout.samplePoint("D", counted);
  assert.equal(draws, 3);
  assert.deepEqual(layout.samplePoint("D", createSeededRandom(7)), first);
  // An inset pulls a rim point off the world edge without emptying the band ...
  const inset = layout.samplePoint("D", createSeededRandom(11), { insetX: 200, insetY: 200 });
  assert.ok(inset.x >= 200 && inset.x <= ringWorld.width - 200, `inset point at ${inset.x}`);
  // ... and an inset wider than the band falls back to its middle instead of
  // collapsing to a zero-width strip a spawner could never use.
  const tight = layout.samplePoint("D", createSeededRandom(11), { insetX: 500, insetY: 500 });
  assert.equal(layout.ringAt(tight.x, tight.y), "D");
});

test("a table that cannot tile the world is refused instead of half-built", () => {
  assert.throws(() => resolveRingHalves([{ id: "A", share: 0.5 }, { id: "B", share: 0.2 }], "half"), /sum to/);
  assert.throws(() => resolveRingHalves([], "half"), /no bands/);
  assert.throws(() => resolveRingHalves([{ id: "A", share: 0.6 }, { id: "B", share: 0.4 }], "half"), /no room/);
  assert.throws(() => resolveRingHalves([{ id: "A", share: 1 }, { id: "B", share: 0 }], "band"), /share of 0/);
  assert.throws(() => resolveRingHalves(ringRules.bands, "halves"), /innermostSpan/);
  assert.throws(() => createRingLayout(ringWorld).bandOf("E"), /no ring "E"/);
});

test("high/medium/low are ranks, so the level table can be retuned too", () => {
  const { high, medium, low, none } = ringRules.levels;
  assert.ok(high > medium && medium > low && low > none, "the ranks are not ordered");
  assert.equal(none, 0, "`none` is how a ring says a kind never grows there");
  // Only the ratios matter: 3/2/1 and 30/20/10 are the same table.
  assert.ok(Math.abs(high / medium - 30 / 20) < 1e-12);
});

test("pickRing follows its weights and never returns a ring at zero", () => {
  const layout = createRingLayout(ringWorld);
  const random = createSeededRandom(2024);
  const seen = { A: 0, B: 0, C: 0, D: 0 };
  for (let index = 0; index < 4000; index += 1) seen[layout.pickRing({ B: 5, A: 3, C: 2 }, random)] += 1;
  assert.equal(seen.D, 0, "the enemy ladder spawned on the rim");
  assert.ok(Math.abs(seen.B / 4000 - 0.5) < 0.04, `B took ${seen.B}`);
  assert.ok(Math.abs(seen.A / 4000 - 0.3) < 0.04, `A took ${seen.A}`);
  assert.ok(Math.abs(seen.C / 4000 - 0.2) < 0.04, `C took ${seen.C}`);
  assert.equal(layout.pickRing({ A: 0, B: 0 }, random), null);
  assert.equal(layout.pickRing(undefined, random), null);
});

test("the shares can be overridden for one boot without an edit", () => {
  assert.deepEqual(parseRingShares("20,45,20,15"), [0.2, 0.45, 0.2, 0.15]);
  // Any positive scale: "200,450,200,150" is the same table.
  assert.deepEqual(parseRingShares("200,450,200,150"), parseRingShares("20,45,20,15"));
  assert.equal(parseRingShares("20,45,20"), null);
  assert.equal(parseRingShares("20,45,20,0"), null);
  assert.equal(parseRingShares("20,45,20,-5"), null);
  assert.equal(parseRingShares("a,45,20,15"), null);
  assert.equal(parseRingShares(""), null);
  assert.equal(parseRingShares(undefined), null);
  // And the parsed shares feed the same derivation the authored table does.
  const shares = parseRingShares("25,25,25,25");
  const bands = shares.map((share, index) => ({ id: "ABCD"[index], share }));
  assert.deepEqual(createRingLayout(ringWorld, { bands }).rings.map((ring) => ring.id), ["A", "B", "C", "D"]);
});

test("a shorter override cannot rename the bands", () => {
  // The level tables say `B: "high"`. An override of three shares would re-label
  // the bands under them, so it is refused and the authored table stands.
  assert.deepEqual(bandsFromShares([0.25, 0.25, 0.25, 0.25]).map((band) => band.id), ["A", "B", "C", "D"]);
  assert.equal(bandsFromShares([0.5, 0.5]), null);
  assert.equal(bandsFromShares(null), null);
  // ... and the boot query is wired into the stage manager, not just parseable.
  const game = readFileSync(new URL("../src/game/game.js", import.meta.url), "utf8");
  assert.ok(/launchQuery\(\)\.rings/.test(game), "game.js does not read ?rings= from the launch query");
  const launch = readFileSync(new URL("../src/platform/launch.js", import.meta.url), "utf8");
  assert.ok(/params\.get\("rings"\)/.test(launch), "launch.js does not surface ?rings=");
});

test("a boot override that cannot tile the world falls back instead of crashing", () => {
  // Typed by hand in a URL, so it is not allowed to be fatal: the authored bands
  // stand in. (The authored table itself still throws - see resolveRingHalves.)
  const world = { width: 2800, height: 1800 };
  const authored = createRingLayout(world).rings.map((ring) => ring.rect);
  const rects = (raw) => ringLayoutFromShares(world, raw).rings.map((ring) => ring.rect);
  assert.deepEqual(rects("50,20,20,10"), authored, "an untileable override was not refused");
  assert.deepEqual(rects("nonsense"), authored);
  assert.deepEqual(rects(undefined), authored);
  // A usable one is taken, and any scale is accepted: 200,450,200,150 is 20/45/20/15.
  assert.deepEqual(rects("20,45,20,15"), authored, "the override is not normalised");
  assert.deepEqual(rects("200,450,200,150"), authored, "a scaled override was not normalised");
  assert.notDeepEqual(rects("25,25,25,25"), authored, "a valid override was ignored");
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

test("the ring tables place each kind, and the budget still sets the count", () => {
  const layout = createRingLayout(battlefieldWorld);
  const bandsOf = (type) => {
    const seen = { A: 0, B: 0, C: 0, D: 0 };
    for (let seed = 0; seed < 8; seed += 1) {
      for (const obstacle of scatter(seed).obstacles) {
        if (obstacle.type === type) seen[layout.ringAt(obstacle.x, obstacle.y)] += 1;
      }
    }
    return seen;
  };
  // Palisades crowd the rim and never stand in the clearing: the wall row says
  // A "none", D "high". B is the pass band, so walls thin out there.
  const walls = bandsOf("wall");
  assert.equal(walls.A, 0, "a palisade stood in the spawn clearing's band");
  assert.ok(walls.C + walls.D > walls.B * 2, `walls went ${JSON.stringify(walls)}`);
  // Trees back onto the middle band, which is why ring B is the widest.
  const trees = bandsOf("tree");
  assert.ok(trees.B > trees.A && trees.B > trees.C, `trees went ${JSON.stringify(trees)}`);
  // The tables decide where, never how many: the field still lands its budget.
  assert.equal(scatter(6).obstacles.length, elementRules.obstacleTarget);
});

test("a laid-out override reshapes the field without changing its density", () => {
  const spawn = { x: 0, y: 0, radius: 17 };
  // The same table with a sliver for B: trees lose their favourite band, so the
  // field has to put them somewhere else rather than grow fewer of them.
  const sliver = createRingLayout(battlefieldWorld, {
    bands: [
      { id: "A", share: 0.2 },
      { id: "B", share: 0.05 },
      { id: "C", share: 0.45 },
      { id: "D", share: 0.3 },
    ],
  });
  const plainLayout = createRingLayout(battlefieldWorld);
  const treesIn = (field, layout) => field.obstacles
    .filter((obstacle) => obstacle.type === "tree" && layout.ringAt(obstacle.x, obstacle.y) === "B").length;
  const treesBeyond = (field, layout) => field.obstacles
    .filter((obstacle) => obstacle.type === "tree" && ["C", "D"].includes(layout.ringAt(obstacle.x, obstacle.y))).length;
  let plainB = 0;
  let sliverB = 0;
  let sliverOuter = 0;
  for (let seed = 0; seed < 8; seed += 1) {
    const plain = createBattlefield(createSeededRandom(seed), { ...spawn }, battlefieldWorld, () => false);
    const reshaped = createBattlefield(
      createSeededRandom(seed), { ...spawn }, battlefieldWorld, () => false, null, null, sliver,
    );
    assert.deepEqual(reshaped, createBattlefield(
      createSeededRandom(seed), { ...spawn }, battlefieldWorld, () => false, null, null, sliver,
    ), "the override made the field non-deterministic");
    assert.equal(reshaped.obstacles.length, elementRules.obstacleTarget, "the override thinned the field");
    plainB += treesIn(plain, plainLayout);
    sliverB += treesIn(reshaped, sliver);
    sliverOuter += treesBeyond(reshaped, sliver);
  }
  assert.ok(sliverB < plainB / 2, `B kept ${sliverB} trees of the ${plainB} it had`);
  assert.ok(sliverOuter > sliverB * 2, "the trees did not move outward, they just thinned out");
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

// Felling is the one thing that removes an element from a live battle, so these
// pin what it leaves behind: a stump that blocks nothing, and an obstacle list
// whose identity changed (the sight index keys on exactly that).
test("a felled tree leaves a stump the field walks and shoots straight through", () => {
  const tree = { type: "tree", x: 500, y: 400, radius: 40 };
  const wall = { type: "wall", x: 400, y: 300, width: 200, height: 40 };
  const local = { obstacles: [tree, wall], terrain: [], stumps: [] };
  const field = createCollisionSystem({ campaign: local, world });

  assert.equal(isFellable(tree), true, "the tree row must be fellable");
  assert.equal(isFellable(wall), false, "a wall is not a tree");
  assert.equal(isFellable({ type: "boulder", x: 0, y: 0, radius: 10 }), false, "an unknown type is not fellable");
  assert.equal(field.hasLineOfSight(300, 400, 700, 400), false, "the standing tree must block the line");

  const before = local.obstacles;
  const stump = fellTree(local, tree);
  assert.equal(local.obstacles.includes(tree), false, "the tree stayed on the field");
  assert.equal(local.obstacles.length, 1, "felling must not touch the other obstacles");
  assert.notEqual(local.obstacles, before, "the obstacle list must be replaced, or the sight index goes stale");
  assert.equal(local.stumps.length, 1);
  assert.equal(stump.x, tree.x);
  assert.equal(stump.y, tree.y);
  assert.ok(stump.radius > 0 && stump.radius < tree.radius,
    `a stump is smaller than the tree that made it (${stump.radius} vs ${tree.radius})`);
  assert.ok(Number.isFinite(stump.rotation), "the stump needs a tilt the painter can read");

  assert.equal(field.circleIntersectsObstacle(tree.x, tree.y, 12), false, "the stump still blocks movement");
  assert.equal(field.obstacleAt(tree.x, tree.y, 12), null, "the stump is not an obstacle");
  assert.equal(field.hasLineOfSight(300, 400, 700, 400), true, "the stump still blocks sight");

  // Two trees, two stumps, and a campaign object built before stumps existed still
  // ends up with a list.
  const bare = { obstacles: [{ ...tree }, { ...tree, x: 700 }] };
  fellTree(bare, bare.obstacles[0]);
  fellTree(bare, bare.obstacles[0]);
  assert.equal(bare.obstacles.length, 0);
  assert.equal(bare.stumps.length, 2, "a campaign without a stump list must still collect them");
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
    // ram-damage speed, so handleObstacleImpact() only ever runs on a real impact.
    // Nothing here is felled (obstacleAt answers null: an empty field).
    handleObstacleImpact: () => {
      throw new Error("reversing should not damage the chariot");
    },
    obstacleAt: () => null,
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
    playSound: () => {},
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
    playSound: () => {},
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

console.log("[unit] dust trails");

// The trail emitters read the displacement between frames, so the rig moves the
// body instead of pretending it has a `speed` field: that is the property the
// feature is built on, and a test that set `speed` would not exercise it.
function trailRig({ angle = 0, radius = 17, camera = { x: 0, y: 0 } } = {}) {
  const state = { particles: [] };
  const view = { width: 1280, height: 720 };
  const trails = createTrailSystem({ state, camera, view });
  const actor = { x: 600, y: 360, angle, radius };
  const puffs = () => state.particles.filter((particle) => particle.kind === "trail");
  function drive(stepPerFrame, { frames = 30, direction = 1 } = {}) {
    const dx = Math.cos(angle) * stepPerFrame * direction;
    const dy = Math.sin(angle) * stepPerFrame * direction;
    for (let frame = 0; frame < frames; frame += 1) {
      actor.x += dx;
      actor.y += dy;
      trails.update(1 / 60, actor, []);
    }
    return puffs();
  }
  return { state, actor, trails, puffs, drive };
}

test("the shared particle lifecycle builds, advances and prunes in one place", () => {
  const list = [];
  const mote = spawnParticle(list, { x: 0, y: 0, vx: 10, vy: -4, life: 0.5, color: "#fff" });
  // Every emitter used to repeat these five fields, and a copy that missed one
  // changed how the mote looked or how long it lived.
  assert.deepEqual(mote, {
    kind: "mote", vx: 10, vy: -4, size: 3, growth: 0, x: 0, y: 0, life: 0.5, color: "#fff",
  });
  // No default `maxLife` on purpose: `burst` relies on the renderer's 0.52s
  // fallback, and inventing one here would change how fast sparks fade.
  assert.equal(mote.maxLife, undefined);

  updateParticles(list, 0.1);
  assert.ok(Math.abs(mote.x - 1) < 1e-9, "the integrator should carry vx * delta");
  assert.ok(Math.abs(mote.y + 0.4) < 1e-9);
  assert.ok(Math.abs(mote.life - 0.4) < 1e-9);
  assert.ok(Math.abs(mote.vx - 9.7) < 1e-9, "damping stays in the shared integrator");
  assert.equal(pruneParticles(list).length, 1);
  updateParticles(list, 0.5);
  assert.equal(pruneParticles(list).length, 0, "a spent particle must be pruned");
  assert.equal(countParticles(list, "mote"), 1, "pruning returns a new list, it does not edit the old one");
});

test("a chariot driving forward leaves a trail that grows with its speed", () => {
  // 1px/frame is 60px/s (a walking unit), 4px/frame is 240px/s (flat out).
  const slow = trailRig().drive(1, { frames: 40 });
  const fast = trailRig().drive(4, { frames: 40 });

  assert.ok(slow.length > 0, "a unit walking forward should raise some dust");
  assert.ok(fast.length > slow.length, "a faster unit must raise more of it");
  const biggest = (puffs) => Math.max(...puffs.map((puff) => puff.size));
  const widest = (puffs) => Math.max(...puffs.map((puff) => puff.growth));
  assert.ok(biggest(fast) > biggest(slow), "puffs should be larger at speed");
  assert.ok(widest(fast) > widest(slow), "and should span further before they fade");
  for (const puff of fast) {
    assert.ok(puff.maxLife >= puff.life, "alpha would overflow 1");
    assert.ok(puff.life <= effectRules.trail.lifeMax);
    assert.ok(puff.growth > 0, "a puff that never blooms reads as grit, not fog");
  }
});

test("the trail sits behind the hull it came from", () => {
  const rig = trailRig({ angle: 0 });
  const puffs = rig.drive(3, { frames: 30 });
  for (const puff of puffs) {
    assert.ok(puff.x < rig.actor.x, `puff at ${puff.x.toFixed(1)} is not behind ${rig.actor.x}`);
  }
  // Turning the whole rig has to turn the wake with it.
  const turned = trailRig({ angle: Math.PI / 2 });
  for (const puff of turned.drive(3, { frames: 30 })) {
    assert.ok(puff.y < turned.actor.y, "the wake should follow the heading, not the x axis");
  }
});

test("a unit standing still raises no dust, and neither does one creeping", () => {
  const still = trailRig();
  for (let frame = 0; frame < 90; frame += 1) still.trails.update(1 / 60, still.actor, []);
  assert.equal(still.puffs().length, 0, "a parked chariot must not smoke");

  // 0.2px/frame is 12px/s, under `minSpeed`: the crowd shuffling in place is not
  // travelling, and it should read that way.
  assert.equal(trailRig().drive(0.2, { frames: 90 }).length, 0);
});

test("a reversing chariot raises no dust, forwards raises it", () => {
  // 24px/s is the reverse lane's ceiling (CHARIOT_CONTROL_CONFIG.reverseMaxSpeed),
  // i.e. the fastest the chariot can travel backwards - fast enough to clear
  // `minSpeed`, so only the forward test can be what suppresses the wake.
  const backwards = trailRig({ angle: 0 }).drive(0.4, { frames: 120, direction: -1 });
  assert.equal(backwards.length, 0, "backing up must not leave a wake");
  const fastBackwards = trailRig({ angle: 0 }).drive(3, { frames: 30, direction: -1 });
  assert.equal(fastBackwards.length, 0, "and neither should a shoved-into-reverse hull");
  const forwards = trailRig({ angle: 0 }).drive(0.4, { frames: 120 });
  assert.ok(forwards.length > 0, "the same rig driving forwards does raise dust");
});

test("the trail is capped and skips units that cannot be seen", () => {
  const busy = trailRig();
  busy.drive(4, { frames: 600 });
  assert.ok(busy.puffs().length <= effectRules.trail.maxLive,
    `${busy.puffs().length} trail puffs exceeded the cap`);

  // An off-screen unit would spend a visible unit's share of that cap.
  const hidden = trailRig({ camera: { x: 4000, y: 4000 } });
  assert.equal(hidden.drive(4, { frames: 60 }).length, 0);
});

test("the trail draws no random numbers, so the seed stream is untouched", () => {
  // The system takes no `random` at all - it structurally cannot reach the
  // battle's generator - and this guards against anyone reaching for Math.random
  // instead, which would be a second, hidden source of variation.
  const original = Math.random;
  Math.random = () => {
    throw new Error("the dust trail must not draw random numbers");
  };
  try {
    assert.ok(trailRig().drive(4, { frames: 30 }).length > 0);
  } finally {
    Math.random = original;
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
    playSound: () => {},
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
function bowRig({ mode = "chariot", enemies = [], lineOfSight = () => true, random = () => 0.5 } = {}) {
  const volleys = [];
  const melee = [];
  const sounds = [];
  const state = {
    enemies, bullets: [], footCompanions: [], groundArrows: [], bloodStains: [],
    fireHold: 0, fireHeld: false,
  };
  const player = {
    mode, x: 100, y: 100, angle: 0, radius: 17, speed: 0, health: 40, maxHealth: 40,
    knockbackX: 0, knockbackY: 0, invulnerable: 0, cooldown: 0,
  };
  const combat = createCombatSystem({
    state,
    player,
    campaign: { roster: [], equipment: emptyEquipment(), horseCount: 1, random },
    collision: { hasLineOfSight: lineOfSight, moveEntitySafely: () => true },
    projectiles: { firePlayerVolley: (options = {}) => volleys.push(options) },
    damageEnemy: (enemy, amount) => melee.push({ enemy, amount }),
    addMeleeEffect: () => {},
    burst: () => {},
    playSound: (cue) => sounds.push(cue),
    updateHud: () => {},
    announceBanner: () => {},
    onDefeat: () => {},
  });
  return { combat, state, player, volleys, melee, sounds };
}

test("taking damage plays the cue for what was actually hit", () => {
  // The chariot's crash is its own hull coming apart, and it runs 2.97s - longer
  // than the 1.05s of invulnerability that follows any hit. A champion on foot has
  // no hull, so the same cue there is wrong twice over; the body gets one short
  // impact instead, thin for an arrow and blunt for a blade.
  const mounted = bowRig({ random: () => 1 });
  mounted.combat.damagePlayer(5, 400, 100, true);
  assert.deepEqual(mounted.sounds, [soundCues.chariotCrash]);

  const shotOnFoot = bowRig({ mode: "foot" });
  shotOnFoot.combat.damagePlayer(5, 400, 100, true);
  assert.deepEqual(shotOnFoot.sounds, [soundCues.arrowHit], "an on-foot arrow played the chariot's crash");

  const bladeOnFoot = bowRig({ mode: "foot" });
  bladeOnFoot.combat.damagePlayer(5, 140, 100, false);
  assert.deepEqual(bladeOnFoot.sounds, [soundCues.hitByMelee], "an on-foot blade played the chariot's crash");
});

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
  // A tap and a drawn shot loose the same volley and share one cue; the tap is
  // told apart by its aim point and its shorter reload, not by its sound.
  assert.equal(rig.player.cooldown, projectileRules.playerVolley.tapCooldown);
  assert.equal(rig.state.fireHold, 0, "the draw has to reset on release");
});

test("a foot swing sounds different when it lands", () => {
  // The swing and the impact were two different tones before; they are two
  // different cues now, and a whiff has to stay audible without sounding like a
  // connect.
  const hit = bowRig({
    mode: "foot",
    enemies: [{ x: 130, y: 100, radius: 16, health: 5, destroyed: false }],
  });
  hit.combat.firePlayer();
  assert.deepEqual(hit.melee.map((blow) => blow.amount), [1]);
  assert.deepEqual(hit.sounds, [soundCues.hitByMelee]);

  const whiff = bowRig({ mode: "foot", enemies: [] });
  whiff.combat.firePlayer();
  assert.deepEqual(whiff.sounds, [soundCues.chariotMelee]);
  assert.deepEqual(whiff.melee, []);
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
    // The champion roster: `spawnBoss`/`spawnBossSquad` fill it, and the squad
    // stage reads it back to decide when the battle is won.
    bosses: [], bossStage: false, bossDefeated: false, finalBattle: false,
    // Wild animals live in both lists: `enemies` moves them, `wilds` is the
    // species roster and the tutorial's script handle.
    wilds: [],
  };
  const player = {
    x: world.width / 2, y: world.height / 2, radius: 17, mode: "chariot", angle: 0, speed: 0,
    knockbackX: 0, knockbackY: 0, invulnerable: 0, swarmDamageCooldown: 0,
  };
  // The spawner reads the ground from the campaign, exactly like the collision
  // system does, so the rig hands it a battlefield instead of a stub predicate.
  const campaign = { obstacles, terrain };
  // Every blow a unit lands on the player; the melee tests read it to tell a
  // swing that connected from a unit that only stood in reach.
  const hits = [];
  const enemies = createEnemies({
    bossTypes,
    enemyStats,
    wildAnimalStats,
    formationPatterns,
    formationPresets,
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
    playSound: () => {},
    updateHud: () => {},
    hasLineOfSight: () => sight.on,
    fireEnemy: () => {},
    damagePlayer: (amount) => { hits.push(amount); },
    damageCompanion: () => {},
  });
  return { state, player, enemies, sight, campaign, world, hits };
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

// Where a melee unit settles: its weapon range, or its own body plus the body it
// is swinging at when that is wider. The heavy (16px body, 27px weapon, 17px
// hull) cannot get inside 35px, so its post and its swing both sit there.
const reachOf = (unit, target) => Math.max(unit.range, unit.radius + target.radius + 2);

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

test("an alerted line defends its whole footprint, not a leash circle per slot", () => {
  // A back-rank slot 90px behind the centre of a 116x86 footprint, and a chariot
  // parked 80px in front of that centre: the player is on the line's own ground.
  const line = calmFormation();
  const backRank = rankUnit({ homeX: 0, homeY: 90, line });
  // What the old goal did to this unit: 39.5px of leash (the brace is nearly
  // spent 170px out) + 72px of chase span = 111.5px from its slot, i.e. y =
  // -21.5 - and the brain then stops a weapon's reach short of *that*, 58px
  // short of the player, with its swing ready and out of contact.
  const chase = chasePoint(chariotPlayer(0, -80), backRank, 0, -80);
  assert.ok(Math.abs(chase.y + 21.5) < 1e-9, `the chase goal moved: ${chase.y}`);
  // Awake, the line's goal is the player himself, so the back rank can reach him.
  backRank.alerted = true;
  assert.deepEqual(defendedPoint(chariotPlayer(0, -80), backRank, 0, -80), { x: 0, y: -80 });
  // The bound moved from the unit to the line: 300px out, the goal stops at the
  // release band (86 + 73) instead of following him off the field.
  assert.deepEqual(
    defendedPoint(chariotPlayer(0, -300), backRank, 0, -300),
    { x: 0, y: -(86 + 73) },
  );
  // The rect is read in the formation's own frame, not the world's: a quarter
  // turn puts local +Y down world -X, so the release border moves with it.
  const turned = calmFormation({ heading: Math.PI / 2 });
  const turnedUnit = rankUnit({ homeX: 0, homeY: 100, alerted: true, line: turned });
  assert.deepEqual(defendedPoint(chariotPlayer(-100, 0), turnedUnit, -100, 0), { x: -100, y: 0 });
  const beyond = defendedPoint(chariotPlayer(-200, 0), turnedUnit, -200, 0);
  assert.ok(Math.abs(beyond.y) < 1e-9, `the rotated clamp drifted off the line's axis: ${beyond.y}`);
  assert.ok(Math.abs(beyond.x + 159) < 1e-9, `the rotated clamp sat at ${beyond.x}, expected -159`);
  // A line that is not awake keeps the old per-slot envelope...
  backRank.alerted = false;
  assert.deepEqual(defendedPoint(chariotPlayer(0, -80), backRank, 0, -80), chase);
  // ...and a unit with no line at all (a boss) is never clamped.
  const loose = defendedPoint(chariotPlayer(0, -300), rankUnit({ formationId: undefined }), 0, -300);
  assert.deepEqual(loose, { x: 0, y: -300 });
});

test("a sighting is searched from a wider envelope than a chase", () => {
  const unit = rankUnit();
  // Leash 38 + two 72px chase spans = 182px from the slot: far enough to reach a
  // sighting the chase itself would have been clamped away from, still bounded.
  const spot = searchPoint(chariotPlayer(0, -500), unit, 0, -500);
  assert.ok(Math.abs(spot.x) < 1e-9, `search goal drifted sideways: ${spot.x}`);
  assert.ok(Math.abs(spot.y + 182) < 1e-9, `search goal sat ${Math.abs(spot.y)}px out, expected 182`);
  // A sighting already inside the envelope is taken as it is.
  assert.deepEqual(searchPoint(chariotPlayer(30, 40), unit, 30, 40), { x: 30, y: 40 });
  // A unit with no formation (a boss) is never clamped.
  const loose = searchPoint(chariotPlayer(0, -500), rankUnit({ formationId: undefined }), 0, -500);
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
    const startedOutOfReach = units.filter((unit) => distanceOf(unit) > reachOf(unit, rig.player));
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
    assert.ok(distanceOf(nearest) <= reachOf(nearest, rig.player) + 1,
      `${label}: the line stopped ${distanceOf(nearest).toFixed(0)}px out, never making contact`);
    const meanAfter = units.reduce((sum, unit) => sum + distanceOf(unit), 0) / units.length;
    assert.ok(meanAfter < meanBefore * 0.8,
      `${label}: the line only closed from ${meanBefore.toFixed(0)}px to ${meanAfter.toFixed(0)}px`);
  }
});

test("the whole line answers a player standing on its footprint", () => {
  // The chariot parks on the line instead of driving through it: the front edge
  // and a far corner of the same 12-strong formation. This is the case a private
  // envelope could not answer - a heavy could walk 46px from its slot and no
  // further, so the back rank stood with a swing ready (`attackCooldown === 0`)
  // 70-160px out and never touched the hull: 10 of 12 units stalled, and only
  // 4-8 blows landed in 5s.
  for (const [, localX, localY] of [["front edge", 0, -110], ["far corner", 130, 110]]) {
    const rig = formationRig();
    const formation = spawnFormationAt(rig, 3);
    const spot = toWorld(formation, localX, localY);
    rig.player.x = spot.x;
    rig.player.y = spot.y;
    const units = infantry(rig.state);
    const distanceOf = (unit) => Math.hypot(unit.x - rig.player.x, unit.y - rig.player.y);
    const meanBefore = units.reduce((sum, unit) => sum + distanceOf(unit), 0) / units.length;
    for (let frame = 0; frame < 300; frame += 1) rig.enemies.updateUnits(1 / 60);
    assert.equal(formation.alerted, true, "the line never woke");
    // Crowding, not the goal, is the only thing that may hold a unit back now: a
    // stopped ring of twelve bodies cannot all stand at one hull, and the back of
    // that ring queues a couple of body-widths out.
    const meanAfter = units.reduce((sum, unit) => sum + distanceOf(unit), 0) / units.length;
    for (const unit of units) {
      // Measured on this build: the worst unit sat 33px (front edge) and 37px
      // (far corner) past its reach, i.e. one heavy body back in the queue;
      // against the old goal the worst was 62px and 191px. 45 leaves the fix a
      // body-width of room and still fails the old behaviour on both cases.
      const slack = distanceOf(unit) - reachOf(unit, rig.player);
      assert.ok(slack <= 45,
        `${unit.type} stood ${slack.toFixed(0)}px past its reach (${distanceOf(unit).toFixed(0)}px out) instead of coming at the chariot`);
    }
    assert.ok(meanAfter < meanBefore * 0.6,
      `the line only closed from ${meanBefore.toFixed(0)}px to ${meanAfter.toFixed(0)}px`);
    assert.ok(rig.hits.length >= 10, `only ${rig.hits.length} blows landed in 5s`);
  }
});

test("the line cannot be walked off its own ground", () => {
  // The bound moved from each slot to the line's rectangle, so the guard is that
  // the line's ground is still a bound: the chariot wakes the line at its edge,
  // then runs. Nobody may trail him across the field, and once he is out of the
  // release band the line stands down and walks home.
  const rig = formationRig();
  const formation = spawnFormationAt(rig, 3);
  parkPlayerInFront(rig, formation, 20);
  rig.enemies.updateUnits(1 / 60);
  assert.equal(formation.alerted, true, "the line did not wake");
  const overhang = (unit) => {
    const dx = unit.x - formation.x;
    const dy = unit.y - formation.y;
    const localX = dx * Math.cos(formation.heading) + dy * Math.sin(formation.heading);
    const localY = -dx * Math.sin(formation.heading) + dy * Math.cos(formation.heading);
    return Math.max(Math.abs(localX) - formation.halfWidth, Math.abs(localY) - formation.halfHeight);
  };
  let worstOverhang = -Infinity;
  for (let frame = 0; frame < 700; frame += 1) {
    const spot = toWorld(formation, 0, -20 - frame * 0.5);
    rig.player.x = spot.x;
    rig.player.y = spot.y;
    rig.enemies.updateUnits(1 / 60);
    for (const unit of infantry(rig.state)) worstOverhang = Math.max(worstOverhang, overhang(unit));
  }
  // Kited at 30px/s - slow enough for a heavy (40px/s) to keep pace - the line
  // presses up to the release border and stops there: measured 71px past the
  // footprint, i.e. a weapon's reach short of the player at the band's edge. The
  // 12px of slack is the crowd shoving a body, nothing more.
  assert.ok(worstOverhang <= 73 + 12,
    `a unit was dragged ${worstOverhang.toFixed(0)}px past the footprint, more than the release band`);
  assert.equal(formation.alerted, false, "the line stayed awake after the chariot left the band");
  for (let frame = 0; frame < 900; frame += 1) rig.enemies.updateUnits(1 / 60);
  for (const unit of infantry(rig.state)) {
    assert.ok(overhang(unit) <= 8, `${unit.type} never made it home (${overhang(unit).toFixed(0)}px out)`);
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

test("heavy infantry swings at the hull instead of standing in it", () => {
  const rig = formationRig();
  const formation = spawnFormationAt(rig, 3);
  parkPlayerInFront(rig, formation, 20);
  const heavy = rig.state.enemies.find((enemy) => enemy.type === "heavy");
  assert.ok(heavy, "the rig spawned no heavy to test");
  // On its own: in a crowd the front rank lands the swings for it.
  rig.state.enemies = [heavy];
  for (let frame = 0; frame < 420; frame += 1) rig.enemies.updateUnits(1 / 60);
  const distance = Math.hypot(heavy.x - rig.player.x, heavy.y - rig.player.y);
  // Its own body keeps it out of weapon range, so the post it walks to is the
  // honest reach (16 + 17 + 2) rather than its 27px sword. It used to settle at
  // 35px and then wait forever for a distance its body made impossible.
  assert.ok(distance <= reachOf(heavy, rig.player) + 1,
    `heavy settled ${distance.toFixed(1)}px out, past its own reach`);
  assert.ok(rig.hits.length >= 2, `heavy landed ${rig.hits.length} swings at ${distance.toFixed(1)}px`);
});

test("holding rank outranks going to look", () => {
  const rig = formationRig();
  const formation = spawnFormationAt(rig, 3);
  // In sight, so the guard post runs, but outside the alert band: the line is
  // standing watch, which is exactly when it must not break formation.
  parkPlayerInFront(rig, formation, 420);
  for (let frame = 0; frame < 120; frame += 1) rig.enemies.updateUnits(1 / 60);
  const units = infantry(rig.state);
  // Only the units that actually saw the player have a sighting to glance at.
  const watchers = units.filter((unit) => unit.seesPlayer);
  assert.ok(watchers.length >= 3, "too few units could see the player to test the gate");
  rig.sight.on = false;
  rig.enemies.updateUnits(1 / 60);
  for (const unit of watchers) {
    // It may look, but it may not walk: the guard post outranks the search, so
    // the unit is granted a glance rather than a walk budget.
    assert.equal(unit.searchTimer, 0, `${unit.type} started a search while holding rank`);
    assert.ok(unit.sweepTimer > 0, `${unit.type} did not even glance at the sighting`);
  }
  let widest = 0;
  for (let frame = 0; frame < 240; frame += 1) {
    rig.enemies.updateUnits(1 / 60);
    for (const unit of units) {
      widest = Math.max(widest, Math.hypot(unit.x - unit.homeX, unit.y - unit.homeY));
    }
  }
  // The line leans off its slot towards a target it can see; it must not walk
  // out of the leash to hunt one it cannot.
  assert.ok(widest <= 54, `the line strayed ${widest.toFixed(1)}px from its slots while holding rank`);
});

test("a unit that loses track walks to the spot instead of turning back", () => {
  const rig = formationRig();
  const formation = spawnFormationAt(rig, 3);
  parkPlayerInFront(rig, formation, 20);
  const unit = rig.state.enemies.find((enemy) => enemy.type === "spear");
  // On its own, so a crowd cannot stand in for it.
  rig.state.enemies = [unit];
  for (let frame = 0; frame < 120; frame += 1) rig.enemies.updateUnits(1 / 60);
  assert.equal(unit.alerted, true, "the line never broke rank, so the search proves nothing");
  // The player slips out of sight from 110px further down the field. The spot
  // is left clear, so the walk can be measured without the hull in the way.
  rig.sight.on = false;
  const sighting = toWorld(formation, 0, -150);
  unit.lastSeenX = sighting.x;
  unit.lastSeenY = sighting.y;
  const from = { x: unit.x, y: unit.y };
  let closest = Infinity;
  let maxStep = 0;
  let widest = 0;
  for (let frame = 0; frame < 210; frame += 1) {
    const before = unit.angle;
    rig.enemies.updateUnits(1 / 60);
    closest = Math.min(closest, Math.hypot(unit.x - sighting.x, unit.y - sighting.y));
    maxStep = Math.max(maxStep, Math.abs(shortestAngleDifference(before, unit.angle)));
    if (frame >= 45) {
      // While it is looking, it looks at the spot - never away from it.
      const bearing = Math.atan2(sighting.y - unit.y, sighting.x - unit.x);
      widest = Math.max(widest, Math.abs(shortestAngleDifference(bearing, unit.angle)));
    }
  }
  assert.ok(closest <= 16, `the unit stopped ${closest.toFixed(1)}px short of where it lost sight`);
  assert.ok(Math.hypot(unit.x - from.x, unit.y - from.y) > 40, "the unit never left its post");
  // It used to freeze on a goal clamped to the guard leash, usually behind it,
  // and snap round the moment the timer ran out.
  // 3.2 rad/s is the quickest of the eased turn rates, so no branch may cover
  // more than that in a frame; the old snap showed up as ~pi in one frame.
  assert.ok(maxStep <= 3.2 / 60 + 1e-9, `the facing snapped ${maxStep.toFixed(4)}rad in one frame`);
  assert.ok(widest <= Math.PI / 2, `the unit turned ${widest.toFixed(2)}rad away from the spot`);
});

test("a sighting at the rim earns a glance, not a march", () => {
  const rig = formationRig();
  const formation = spawnFormationAt(rig, 3);
  parkPlayerInFront(rig, formation, 20);
  const unit = rig.state.enemies.find((enemy) => enemy.type === "spear");
  rig.state.enemies = [unit];
  for (let frame = 0; frame < 120; frame += 1) rig.enemies.updateUnits(1 / 60);
  assert.equal(unit.alerted, true, "the line never broke rank, so this tests nothing");
  // A sighting out past the chase is further than the unit would ever go: it
  // can only stare at the rim of its sight, so marching there chases nothing.
  rig.sight.on = false;
  const sighting = toWorld(formation, 0, -350);
  unit.lastSeenX = sighting.x;
  unit.lastSeenY = sighting.y;
  rig.enemies.updateUnits(1 / 60);
  assert.equal(unit.searchTimer, 0, "the unit marched off after a rim sighting");
  assert.ok(unit.sweepTimer > 0, "the unit did not even glance at it");
  let closest = Infinity;
  for (let frame = 0; frame < 240; frame += 1) {
    rig.enemies.updateUnits(1 / 60);
    closest = Math.min(closest, Math.hypot(unit.x - sighting.x, unit.y - sighting.y));
  }
  assert.ok(closest > 240, `the unit closed to ${closest.toFixed(1)}px of a sighting it cannot use`);
  const stray = Math.hypot(unit.x - unit.homeX, unit.y - unit.homeY);
  assert.ok(stray <= 60, `the unit ended ${stray.toFixed(1)}px off its slot`);
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
  const boss = rig.state.bosses[0];
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

// The radar is the only place where a stat becomes geometry, so the test builds it
// against the shared layout instead of a browser: what matters is that the polygon
// it paints is the shared stat table, not a second copy of it.
test("the radar plots the shared chariot stats, axis for axis", () => {
  const box = { x: 0, y: 0, width: 320, height: 220 };
  const geometry = radarGeometry(box);
  // The wheel's rim is the stat ceiling; a stat table that outgrows it would draw
  // outside the outer ring, so the two numbers have to agree.
  assert.equal(geometry.maximum, chariotRules.maximumStat);
  assert.equal(geometry.centerX, box.width / 2);
  assert.equal(geometry.centerY, box.height / 2);
  // Labels live outside the ring, so the radius leaves room for them on every side
  // rather than filling the box.
  assert.ok(geometry.radius < Math.min(box.width, box.height) / 2,
    "the wheel fills its box, leaving no room for its labels");
  assert.ok(geometry.labelMaxWidth > 0, "the labels were given no width to live in");
  // A narrow column spends more of its box on labels, so its wheel is smaller and
  // its type is smaller with it.
  const narrow = radarGeometry(box, { narrow: true });
  assert.ok(narrow.radius <= geometry.radius, "the narrow column got the wider wheel");
  assert.ok(narrow.labelSize < geometry.labelSize, "the narrow column got the larger labels");

  const stats = calculateChariotStats({ ...emptyEquipment(), weaponRack: 1, chariotBox: 1 }, 2);
  const points = radarPolygon(geometry, statKeys.map((key) => stats[key]));
  assert.equal(points.length, statKeys.length);
  // The first axis points up - firepower at the top of the wheel, not at 3 o'clock
  // - and a maxed stat reaches the rim exactly.
  const rim = radarPoint(geometry, 0, geometry.maximum);
  assert.ok(Math.abs(rim.x - geometry.centerX) < 1e-9, "the first axis is not vertical");
  assert.ok(rim.y < geometry.centerY, "the first axis points down the page");
  assert.ok(Math.abs(Math.hypot(rim.x - geometry.centerX, rim.y - geometry.centerY) - geometry.radius) < 1e-9,
    "a maxed stat does not reach the rim");
  // A zero stat collapses to the centre instead of drawing a spike.
  const collapsed = radarPoint(geometry, statKeys.length - 1, 0);
  assert.deepEqual(collapsed, { x: geometry.centerX, y: geometry.centerY });
});

// A canvas that records what was drawn. The preview ring is a dashed polygon in a
// different colour and the labels print their delta, so both are legible in a call
// log without a rasteriser - and no drawing code has to grow a hook for the test.
function drawLog() {
  const calls = [];
  const target = {
    measureText: (value) => ({ width: String(value).length * 6 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => null,
  };
  const context = new Proxy(target, {
    get(object, property) {
      if (property in object) return object[property];
      return (...args) => calls.push({ name: String(property), args });
    },
    set(object, property, value) {
      calls.push({ name: `set:${String(property)}`, args: [value] });
      object[property] = value;
      return true;
    },
  });
  return { context, calls };
}

test("the radar draws a preview ring only for a purchase that changes a stat", () => {
  const geometry = radarGeometry({ x: 0, y: 0, width: 320, height: 220 });
  const owned = calculateChariotStats(emptyEquipment(), 1);
  const next = calculateChariotStats({ ...emptyEquipment(), weaponRack: 1 }, 1);
  assert.ok(statKeys.some((key) => owned[key] !== next[key]), "the fixture buys nothing");
  const dashed = (log) => log.calls.some((call) => call.name === "setLineDash"
    && JSON.stringify(call.args) === JSON.stringify([[5, 4]]));
  const labels = (log) => log.calls.filter((call) => call.name === "fillText").map((call) => String(call.args[0]));

  // Nothing pinned: one shape, no dashes and no deltas.
  const flat = drawLog();
  drawRadar(flat.context, geometry, owned, { ...owned });
  assert.equal(dashed(flat), false, "an unchanged purchase still drew a preview ring");
  assert.equal(labels(flat).some((label) => label.includes("▲") || label.includes("▼")), false,
    "an unchanged purchase still printed a delta");
  statKeys.forEach((key) => {
    assert.ok(labels(flat).includes(translate(statLabelKeys[key])), `${key} has no label on the wheel`);
  });

  // A pressed upgrade: the preview ring is dashed so it cannot be mistaken for the
  // shape the player owns, and the labels it moves print owned ▲ previewed.
  const preview = drawLog();
  drawRadar(preview.context, geometry, owned, next);
  assert.equal(dashed(preview), true, "a buffed stat drew no preview ring");
  assert.ok(preview.calls.some((call) => call.name === "set:strokeStyle" && call.args[0] === "#8ec88c"),
    "the preview ring was not painted in the preview colour");
  const delta = labels(preview).find((label) => label.includes("▲"));
  assert.ok(delta, "the buffed stat printed no delta");
  assert.ok(delta.includes(String(owned.firepower)) && delta.includes(String(next.firepower)),
    `the delta line "${delta}" does not name both values`);
  // The rest of the labels stay plain, or a single purchase would mark up the whole
  // wheel and say nothing.
  const unchanged = statKeys.filter((key) => owned[key] === next[key]);
  unchanged.forEach((key) => {
    assert.ok(labels(preview).includes(String(owned[key])), `${key} was marked up without changing`);
  });
});

test("every radar axis has a label in both locales", () => {
  for (const locale of Object.keys(supportedLocales)) {
    for (const key of statKeys) {
      assert.ok(hasTranslation(locale, statLabelKeys[key]), `${locale} is missing ${statLabelKeys[key]}`);
    }
    for (const key of ["shop.stats.chartLabel", "shop.rig.caption", "shop.camp.caption", "shop.dossier.label",
      "shop.collision.label", "shop.collision.description", "shop.info.label", "shop.shortGold"]) {
      assert.ok(hasTranslation(locale, key), `${locale} is missing ${key}`);
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
  // The shapes the dossier actually draws at: the stacked column, the narrow strip
  // beside the ledger, a phone's team row - and a column taller than it is wide,
  // which turns the rig a quarter turn so the fit has to follow the turned
  // silhouette rather than the raw box.
  const rects = [
    { width: 320, height: 220 },
    { width: 180, height: 128 },
    { width: 120, height: 104 },
    { width: 140, height: 260 },
  ];
  // The stock rig and the widest one the dossier can be asked to show: four
  // crossbows on the deck, the biggest box and the longest axle blades.
  const chassis = [
    {},
    {
      weaponRack: equipment[0].levels.length,
      axleCap: equipment.find((item) => item.id === "axleCap").levels.length,
      chariotBox: equipment.find((item) => item.id === "chariotBox").levels.length,
    },
  ];
  for (const levels of chassis) {
    for (let horseCount = 1; horseCount <= horses.max; horseCount += 1) {
      for (const rect of rects) {
        const label = `${horseCount} horses in ${rect.width}x${rect.height}`
          + (Object.keys(levels).length ? " with a maxed chassis" : "");
        // The real drawing call: `drawRig` reports the pixels the team occupies, so
        // the fit under test is the one the column draws with.
        const drawn = drawRig(recordingContext().context, { x: 0, y: 0, ...rect }, { horseCount, levels });
        const fit = rigPreview(horseCount, rect, { kit: calculateChariotKit(levels) });
        assert.ok(drawn.scale > 0, `${label}: scale collapsed`);
        assert.equal(drawn.scale, fit.scale, `${label}: the drawing does not use the fitted scale`);
        assert.ok(drawn.width <= rect.width - fit.padding * 2 + 0.01,
          `${label}: the team is ${drawn.width}px wide in a ${rect.width}px column`);
        assert.ok(drawn.height <= rect.height - fit.padding * 2 + 0.01,
          `${label}: the team is ${drawn.height}px tall in a ${rect.height}px column`);
        // One axis is the binding one: the fit spends its column instead of shrinking
        // the team into a corner of it.
        assert.ok(Math.abs(drawn.width - (rect.width - fit.padding * 2)) < 0.01
          || Math.abs(drawn.height - (rect.height - fit.padding * 2)) < 0.01,
        `${label}: the fit left a gap on both axes`);
      }
    }
  }
  // The blades really do reach further, so the fit has to make room for them.
  const box = { x: 0, y: 0, width: 320, height: 220 };
  const stock = drawRig(recordingContext().context, box, { horseCount: 1 });
  const maxed = drawRig(recordingContext().context, box, { horseCount: 1, levels: chassis[1] });
  assert.ok(maxed.scale < stock.scale, "a maxed chassis is drawn at the same size as the stock one");
});


test("the rig box grows with the team instead of hiding it", () => {
  // The box is the contract the shop scales into; teams that fit the same box
  // would mean the preview is drawing horses on top of each other.
  const boxes = [];
  for (let horseCount = 1; horseCount <= horses.max; horseCount += 1) {
    boxes.push(rigPreview(horseCount, { width: 320, height: 220 }).box);
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
    const figure = roleFigure(member.id);
    assert.equal(figure.robeColor, spritePalette.allyRobe, `${member.id} is not wearing the ally colour`);
    assert.ok(figure.overlays.length > 0, `${member.id} sits at the fire with no kit`);
    for (const overlay of figure.overlays) {
      assert.ok(overlayKinds.foot.includes(overlay),
        `${member.id} asks for a "${overlay}" the foot art never painted`);
    }
  }
  // A row added tomorrow shows up at the fire before anyone has drawn it a kit.
  const unknown = roleFigure("future-recruit");
  assert.equal(unknown.robeColor, spritePalette.allyRobe);
  assert.ok(unknown.overlays.length > 0);
  // No role is seat 0 - the player - who wears the chariot's own colour and the
  // sword the foot art does paint.
  const player = roleFigure();
  assert.equal(player.robeColor, spritePalette.playerRobe, "seat 0 is not wearing the player's robe");
  assert.deepEqual(player.overlays, ["sword"]);
});

test("the camp fire wears the colours the battlefield paints", () => {
  // Both scenes paint from one palette; a preview in a different green is the
  // classic way a shop screen stops matching the game behind it.
  assert.equal(roleFigure().robeColor, spritePalette.playerRobe);
  assert.equal(roleFigure("archer").robeColor, spritePalette.allyRobe);
  const renderer = readFileSync(new URL("../src/render/renderer.js", import.meta.url), "utf8");
  for (const colour of [spritePalette.playerRobe, spritePalette.playerBanner, spritePalette.allyRobe]) {
    assert.equal(renderer.includes(colour), false, `renderer.js still hard-codes the team colour ${colour}`);
  }
});


// The page owns its clock, its canvas and its pointer router. `shop.js` decides
// what a tap means; `shop-screen.js` decides what a tap *is* - which is the part a
// browser used to do for the DOM shop and this file has to do for the canvas one.
// That split is what lets the page be tested without a browser: the router is the
// whole of the device-facing code.
function fakePageCanvas(box, context) {
  const listeners = new Map();
  return {
    width: 0,
    height: 0,
    getContext: () => context,
    getBoundingClientRect: () => ({ width: box.width, height: box.height, top: 0, left: 0 }),
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      const entries = listeners.get(type) ?? [];
      const index = entries.indexOf(handler);
      if (index >= 0) entries.splice(index, 1);
    },
    // A finger, in client pixels: the page converts back into view units itself.
    touch(type, point = {}) {
      for (const handler of [...(listeners.get(type) ?? [])]) handler({ preventDefault() {}, ...point });
    },
  };
}

// A campaign with nothing bought and no coin. Each test sets only the field it is
// about, so a fixture that drifts cannot quietly pass for a different reason.
function shopCampaign(overrides = {}) {
  return {
    identity: "canvas-run",
    equipment: emptyEquipment(),
    horseCount: 1,
    roster: [{ role: "archer", alive: true }],
    totalGold: 0,
    friendlyFormations: 0,
    ...overrides,
  };
}

// The shop only asks the wallet to buy and to report; the equipment rules own the
// real thing and are tested above. This stub records the calls and answers the
// shape `equipmentShop.purchaseItem` answers.
function stubEquipmentShop(campaign) {
  const calls = [];
  return {
    calls,
    purchaseItem(kind, id) {
      calls.push([kind, id]);
      if (kind === "equipment") {
        campaign.equipment = { ...campaign.equipment, [id]: (campaign.equipment[id] ?? 0) + 1 };
      }
      return { ok: true, message: `bought ${id ?? kind}` };
    },
  };
}

const shopPoint = (rect) => ({ clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 });

test("opening the shop page paints the frame its targets come from", () => {
  const recorder = recordingContext();
  const canvas = fakePageCanvas({ width: 960, height: 592 }, recorder.context);
  const campaign = shopCampaign({ totalGold: 900 });
  const equipmentShop = stubEquipmentShop(campaign);
  const liveRegion = { textContent: "" };
  const page = createShopScreen({
    canvas, campaign, equipmentShop, liveRegion,
  });

  assert.equal(page.lastFrame(), null, "a page that was never opened painted a frame");
  page.setActive(true);
  const frame = page.lastFrame();
  assert.ok(frame, "opening the page painted nothing");
  // The page's own space: 960 wide, as tall as the element's aspect ratio makes it.
  assert.deepEqual(frame.view, { width: 960, height: 592 });
  assert.deepEqual(page.view, { width: 960, height: 592 });
  // The backing store follows the CSS box at the device ratio, capped at 2 so a
  // phone with a 3x screen does not paint three times the pixels it can show.
  const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
  assert.equal(canvas.width, Math.round(960 * ratio));
  assert.equal(canvas.height, Math.round(592 * ratio));
  assert.ok(recorder.bounds.maxX > 0, "the page registered no draw at all");

  assert.equal(frame.category, "equipment");
  assert.equal(frame.tabs.length, 3);
  assert.ok(frame.rows.length > 0, "the ledger opened empty");
  assert.equal(frame.gold, 900);
  // Nothing is pinned, so the panel shows the standing rule, and the page greets
  // the player with the line the DOM shop's footer carried.
  assert.equal(frame.pinnedId, null);
  assert.equal(frame.info.label, translate("shop.collision.label"));
  assert.equal(frame.notice, translate("shop.message"));
  assert.equal(liveRegion.textContent, translate("shop.message"), "the greeting was not announced");
  page.setActive(false);
});

test("a tap on a buy button spends once, announces once and repaints", () => {
  const canvas = fakePageCanvas({ width: 960, height: 592 }, recordingContext().context);
  const campaign = shopCampaign({ totalGold: 9000 });
  const equipmentShop = stubEquipmentShop(campaign);
  const liveRegion = { textContent: "" };
  const page = createShopScreen({
    canvas, campaign, equipmentShop, liveRegion,
  });
  page.setActive(true);

  const row = page.lastFrame().rows.find((entry) => entry.id === "weaponRack");
  assert.ok(row, "the first equipment row is missing");
  assert.equal(row.disabled, false, "an affordable row was already disabled");
  const point = shopPoint(row.buyRect);
  canvas.touch("pointerdown", { pointerId: 1, ...point });
  canvas.touch("pointerup", { pointerId: 1, ...point });

  assert.deepEqual(equipmentShop.calls, [["equipment", "weaponRack"]], "the tap did not buy the item");
  // The live region is written from the same notice the page prints, so a screen
  // reader hears the purchase the instant it lands instead of waiting for a frame.
  assert.equal(liveRegion.textContent, "bought weaponRack", "the purchase was not announced");

  // The frame painted before the tap still shows the greeting; the shop is drawn
  // from campaign data, so one repaint is all it takes to show the new state.
  page.refresh();
  const after = page.lastFrame();
  assert.equal(after.notice, "bought weaponRack");
  assert.equal(after.noticeTone, "ok");
  assert.equal(after.pinnedId, "weaponRack", "the bought row was not pinned for its explanation");
  assert.equal(after.pressedId, null, "the row stayed pressed after the release");
  assert.equal(after.info.id, "weaponRack", "the panel did not explain the bought item");
  page.setActive(false);
});

test("a press that slides off the button buys nothing", () => {
  const canvas = fakePageCanvas({ width: 960, height: 592 }, recordingContext().context);
  const campaign = shopCampaign({ totalGold: 9000 });
  const equipmentShop = stubEquipmentShop(campaign);
  const page = createShopScreen({
    canvas, campaign, equipmentShop, liveRegion: { textContent: "" },
  });
  page.setActive(true);

  const row = page.lastFrame().rows.find((entry) => entry.id === "weaponRack");
  const point = shopPoint(row.buyRect);
  canvas.touch("pointerdown", { pointerId: 1, ...point });
  // A finger that travels further than the drag tolerance was scrolling the
  // ledger, not tapping the button - even though it lets go over the button.
  canvas.touch("pointermove", { pointerId: 1, clientX: point.clientX, clientY: point.clientY - 40 });
  canvas.touch("pointerup", { pointerId: 1, ...point });
  assert.equal(equipmentShop.calls.length, 0, "a scrolled row was bought");

  // A second finger is its own press: the cancelled one must not have left the
  // page unable to answer a fresh tap on the same button.
  canvas.touch("pointerdown", { pointerId: 2, ...point });
  canvas.touch("pointerup", { pointerId: 2, ...point });
  assert.deepEqual(equipmentShop.calls, [["equipment", "weaponRack"]]);
  page.setActive(false);
});

test("a buy the purse cannot afford is refused without spending", () => {
  const canvas = fakePageCanvas({ width: 960, height: 592 }, recordingContext().context);
  const campaign = shopCampaign({ totalGold: 0 });
  const equipmentShop = stubEquipmentShop(campaign);
  const liveRegion = { textContent: "" };
  const page = createShopScreen({
    canvas, campaign, equipmentShop, liveRegion,
  });
  page.setActive(true);

  const row = page.lastFrame().rows.find((entry) => entry.id === "weaponRack");
  assert.equal(row.disabled, true, "a row nobody can afford was not disabled");
  assert.ok(row.reason, "a disabled row did not say why");
  const point = shopPoint(row.buyRect);
  canvas.touch("pointerdown", { pointerId: 1, ...point });
  canvas.touch("pointerup", { pointerId: 1, ...point });

  // The label already said why; the notice repeats it in words that survive a
  // glance, and nothing is attempted against the wallet.
  assert.equal(equipmentShop.calls.length, 0, "a disabled button still tried to buy");
  assert.equal(liveRegion.textContent, translate("shop.error.gold"));
  page.refresh();
  const after = page.lastFrame();
  assert.equal(after.notice, translate("shop.error.gold"));
  assert.equal(after.noticeTone, "error");
  page.setActive(false);
});

test("a closed shop page answers no taps and parks its frame", () => {
  const canvas = fakePageCanvas({ width: 960, height: 592 }, recordingContext().context);
  const campaign = shopCampaign({ totalGold: 9000 });
  const equipmentShop = stubEquipmentShop(campaign);
  const page = createShopScreen({
    canvas, campaign, equipmentShop, liveRegion: { textContent: "" },
  });
  page.setActive(true);
  const row = page.lastFrame().rows.find((entry) => entry.id === "weaponRack");
  const point = shopPoint(row.buyRect);
  page.setActive(false);

  const parked = page.lastFrame();
  canvas.touch("pointerdown", { pointerId: 1, ...point });
  canvas.touch("pointerup", { pointerId: 1, ...point });
  assert.equal(equipmentShop.calls.length, 0, "a closed page bought an item");
  // `refresh` is the composition root's nudge after a locale switch; while the page
  // is closed it must be a no-op, not a paint into an invisible canvas.
  page.refresh();
  assert.equal(page.lastFrame(), parked, "a closed page repainted");

  // Re-opening starts from the greeting again and paints: the shop never resumes a
  // pinned row or a half-finished page from the last visit.
  page.setActive(true);
  const reopened = page.lastFrame();
  assert.notEqual(reopened, parked, "re-opening the page did not repaint");
  assert.equal(reopened.pinnedId, null);
  assert.equal(reopened.notice, translate("shop.message"));
  page.setActive(false);
});

test("a shop canvas with no box is left alone", () => {
  const recorder = recordingContext();
  const canvas = fakePageCanvas({ width: 0, height: 0 }, recorder.context);
  const campaign = shopCampaign({ totalGold: 900 });
  const equipmentShop = stubEquipmentShop(campaign);
  const page = createShopScreen({
    canvas, campaign, equipmentShop, liveRegion: null,
  });
  // A page whose sheet has not been laid out yet measures 0x0: the shop must skip
  // the frame rather than guess a size, and the router must not divide by a box it
  // does not have.
  page.setActive(true);
  assert.equal(page.lastFrame(), null, "a zero-sized canvas was drawn anyway");
  assert.equal(Number.isFinite(recorder.bounds.maxX), false, "a zero-sized canvas was painted on");
  assert.equal(canvas.width, 0);
  canvas.touch("pointerdown", { pointerId: 1, clientX: 1, clientY: 1 });
  canvas.touch("pointerup", { pointerId: 1, clientX: 1, clientY: 1 });
  assert.equal(equipmentShop.calls.length, 0);
  assert.doesNotThrow(() => page.resize(), "resizing a page with no box threw");
  page.setActive(false);
  page.dispose();
});

test("a resize re-fits the page to its box and keeps its width", () => {
  const box = { width: 960, height: 592 };
  const canvas = fakePageCanvas(box, recordingContext().context);
  const campaign = shopCampaign({ totalGold: 900 });
  const equipmentShop = stubEquipmentShop(campaign);
  const page = createShopScreen({
    canvas, campaign, equipmentShop, liveRegion: { textContent: "" },
  });
  page.setActive(true);
  const landscape = page.lastFrame();
  assert.deepEqual(landscape.view, { width: 960, height: 592 });

  // The same page in portrait: the width stays 960 - every rect is computed in that
  // space - and the height grows with the element, which is what gives a phone a
  // different shape rather than a scaled-down tablet.
  box.width = 420;
  box.height = 760;
  page.resize();
  const portrait = page.lastFrame();
  assert.notEqual(portrait, landscape, "the resize did not repaint");
  assert.equal(portrait.view.width, 960);
  assert.equal(portrait.view.height, 960 * 760 / 420);
  const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
  assert.equal(canvas.width, Math.round(420 * ratio));
  assert.equal(canvas.height, Math.round(760 * ratio));
  // The catalogue was re-sliced for the new shape instead of carried over from the
  // old one, so the rows on the page are the rows this box has room for.
  assert.equal(portrait.rows.length, rowsPerPageFor(portrait.view.height, portrait.view.width));
  page.setActive(false);
});

console.log("[unit] the home page");

const menuPoint = (rect) => ({ clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 });

// The resting lock, as the page reads it: two numbers and a record.
function stubVictoryLock(remaining = 0, last = null) {
  return { remainingMs: () => remaining, summary: () => last };
}

// A live region that counts its writes, so "announced once per change" is a fact
// about the page and not about how many frames the test happened to paint.
function countingLiveRegion() {
  const region = { writes: 0, value: "" };
  Object.defineProperty(region, "textContent", {
    get: () => region.value,
    set: (value) => { region.value = value; region.writes += 1; },
  });
  return region;
}

function menuPageUnderTest({
  box = { width: 960, height: 592 }, lock = stubVictoryLock(), proxy = null, live = null,
} = {}) {
  const starts = [];
  const recorder = recordingContext();
  const canvas = fakePageCanvas(box, recorder.context);
  const page = createMenuPage({
    canvas,
    victoryLock: lock,
    liveRegion: live,
    startProxy: proxy,
    onStart: () => starts.push(true),
  });
  return { page, canvas, box, starts, recorder, proxy };
}

test("the card is the mini game's card, laid out in the page's own space", () => {
  const layout = computeMenuLayout({ width: 960, height: 592 });
  // 550x380, centred: the same card `chariot-wars/src/ui/screens.js` paints.
  assert.deepEqual(layout.panel, { x: 205, y: 106, width: 550, height: 380 });
  // The four lines above the button, at the offsets the mini game uses.
  assert.equal(layout.eyebrow.y, 148);
  assert.equal(layout.title.y, 202);
  assert.equal(layout.seal.y, 242);
  assert.equal(layout.lede.y, 278);
  for (const line of [layout.eyebrow, layout.title, layout.seal, layout.lede]) {
    assert.equal(line.x, 480, "a line of the card was not centred on the page");
  }
  // 出征: 224x50, inside the card and clear of the last line of lede.
  assert.deepEqual(layout.start, { x: 368, y: 418, width: 224, height: 50 });
  assert.ok(layout.start.y >= layout.lede.y + layout.lede.lineHeight * layout.lede.maxLines,
    "出征 overlaps the lede");
  assert.ok(layout.start.y + layout.start.height <= layout.panel.y + layout.panel.height,
    "出征 hangs out of the card");
  // The resting card covers the button's slot and then some.
  assert.deepEqual(layout.lock, { x: 368, y: 406, width: 224, height: 74 });
  assert.equal(layout.lock.y, layout.start.y - 12);
});

test("the card shrinks with a short page and never with a wide one", () => {
  // A wide window: the card is capped at 550, so the page gets margins instead.
  const wide = computeMenuLayout({ width: 1600, height: 900 });
  assert.equal(wide.panel.width, 550);
  assert.equal(wide.panel.x, (1600 - 550) / 2);
  // A short one: the height follows, and the card keeps its full height until the
  // page has no room for it.
  const portrait = computeMenuLayout({ width: 960, height: 1740 });
  assert.equal(portrait.panel.height, 380);
  assert.equal(portrait.panel.y, (1740 - 380) / 2);
  const short = computeMenuLayout({ width: 960, height: 300 });
  assert.equal(short.panel.height, 240);
  assert.equal(short.panel.y, 30);
  // Nothing has a negative size, which a canvas would paint as nothing at all.
  for (const rect of [short.panel, short.start, short.lock]) {
    assert.ok(rect.width >= 0 && rect.height >= 0, "a rect went negative");
  }
});

test("a page with no box at all is laid out without a NaN", () => {
  for (const view of [{ width: 0, height: 0 }, { width: 40, height: 40 }, { width: 960, height: 0 }]) {
    const layout = computeMenuLayout(view);
    const numbers = [layout.panel, layout.start, layout.lock, layout.lede, layout.title]
      .flatMap((rect) => [rect.x, rect.y, rect.width ?? 0, rect.height ?? 0]);
    assert.ok(numbers.every(Number.isFinite), `a NaN escaped the layout at ${JSON.stringify(view)}`);
    assert.ok(layout.panel.width >= 0 && layout.panel.height >= 0, "a card went negative");
  }
});

test("opening the home page paints the card its target comes from", () => {
  const { page, canvas } = menuPageUnderTest();
  assert.equal(page.lastFrame(), null, "a page that was never opened painted a frame");
  page.setActive(true);
  const frame = page.lastFrame();
  assert.ok(frame, "opening the page painted nothing");
  assert.deepEqual(frame.view, { width: 960, height: 592 });
  assert.deepEqual(page.view, { width: 960, height: 592 });
  // The backing store follows the CSS box at the device ratio, capped at 2.
  const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
  assert.equal(canvas.width, Math.round(960 * ratio));
  assert.equal(canvas.height, Math.round(592 * ratio));
  // Nothing is resting, so the button is drawn in the slot the layout gave it and
  // the page has exactly one target.
  assert.equal(frame.locked, false);
  assert.deepEqual(frame.startRect, computeMenuLayout(page.view).start);
  assert.equal(frame.title, translate("menu.title"));
  assert.equal(frame.headline, null);
  assert.equal(frame.detail, null);
  assert.ok(frame.lede.length >= 1 && frame.lede.length <= 2, "the lede is not two lines or fewer");
  page.setActive(false);
});

test("a tap on the painted 出征 starts the run once, and only on the button", () => {
  const { page, canvas, starts } = menuPageUnderTest();
  page.setActive(true);
  const frame = page.lastFrame();

  // The card around the button is not a target: pressing the middle of the card
  // does nothing, which is what the mini game does too.
  const card = menuPoint(frame.panel);
  canvas.touch("pointerdown", { pointerId: 1, ...card });
  canvas.touch("pointerup", { pointerId: 1, ...card });
  assert.equal(starts.length, 0, "the card itself started a run");

  const button = menuPoint(frame.startRect);
  canvas.touch("pointerdown", { pointerId: 2, ...button });
  canvas.touch("pointerup", { pointerId: 2, ...button });
  assert.equal(starts.length, 1, "the tap on 出征 did not start the run");

  // A second finger's release must not buy a second run: there is only one press.
  canvas.touch("pointerup", { pointerId: 2, ...button });
  assert.equal(starts.length, 1, "a released press fired twice");
  page.setActive(false);
});

test("sliding off 出征 cancels the tap, and a press the card replaced never fires", () => {
  let remaining = 0;
  const lock = {
    remainingMs: () => remaining,
    summary: () => ({ name: "姬仇", stage: 4, score: 1234 }),
  };
  const { page, canvas, starts } = menuPageUnderTest({ lock });
  page.setActive(true);
  const button = menuPoint(page.lastFrame().startRect);

  // A finger that travels more than the drag threshold is a scroll, not a tap.
  canvas.touch("pointerdown", { pointerId: 1, ...button });
  canvas.touch("pointermove", { pointerId: 1, clientX: button.clientX + 40, clientY: button.clientY });
  canvas.touch("pointerup", { pointerId: 1, ...button });
  assert.equal(starts.length, 0, "a drag across 出征 started the run");

  // Pressing 出征 and then having the victory lock land under the finger: the next
  // frame draws the resting card in that slot, and the release must not fire the
  // button the player is no longer looking at.
  canvas.touch("pointerdown", { pointerId: 2, ...button });
  remaining = 90_000;
  page.refresh();
  assert.equal(page.lastFrame().locked, true, "the resting card was not painted");
  canvas.touch("pointerup", { pointerId: 2, ...button });
  assert.equal(starts.length, 0, "a release fired a button that had already gone");
  page.setActive(false);
});

test("the resting card says how long, and what the last run was, and cannot be pressed", () => {
  const last = { name: "姬仇", stage: 4, score: 1234 };
  const live = countingLiveRegion();
  const { page, canvas, starts } = menuPageUnderTest({ lock: stubVictoryLock(90_000, last), live });
  page.setActive(true);
  const frame = page.lastFrame();

  assert.equal(frame.locked, true);
  assert.equal(frame.headline, translate("menu.locked", { time: countdownLabel(90_000) }));
  assert.equal(frame.detail, translate("menu.lockedLast", last));
  // It stands where 出征 would be, one line taller than the button it replaced.
  assert.deepEqual(frame.lockRect, computeMenuLayout(page.view).lock);
  assert.equal(frame.lockRect.y, frame.startRect.y - 12);
  assert.equal(frame.lockRect.height, frame.startRect.height + 24);
  // A screen reader hears the countdown; the canvas itself is opaque.
  assert.equal(live.textContent, `${frame.headline}. ${frame.detail}`);

  // Nothing to press: the resting card registers no target anywhere in its rect.
  for (const point of [menuPoint(frame.lockRect), menuPoint(frame.startRect)]) {
    canvas.touch("pointerdown", { pointerId: 1, ...point });
    canvas.touch("pointerup", { pointerId: 1, ...point });
  }
  assert.equal(starts.length, 0, "the resting card started a run");
  page.setActive(false);
});

test("the countdown is announced once per change, and the card unlocks in place", () => {
  let remaining = 90_000;
  const lock = { remainingMs: () => remaining, summary: () => ({ name: "姬仇", stage: 4, score: 7 }) };
  const live = countingLiveRegion();
  const { page, canvas, starts } = menuPageUnderTest({ lock, live });
  page.setActive(true);
  assert.equal(live.writes, 1, "the first countdown was not announced");
  const painted = page.lastFrame().headline;

  // Sixty frames of the same second are not sixty announcements.
  page.refresh();
  page.refresh();
  assert.equal(live.writes, 1, "the same countdown was announced again");
  assert.equal(page.lastFrame().headline, painted);

  remaining = 89_000;
  page.refresh();
  assert.equal(live.writes, 2, "a new countdown was not announced");
  assert.notEqual(page.lastFrame().headline, painted);

  // The rest runs out: the card becomes the button again, and the live region is
  // cleared rather than left holding a countdown that is no longer true.
  remaining = 0;
  page.refresh();
  const frame = page.lastFrame();
  assert.equal(frame.locked, false);
  assert.equal(frame.headline, null);
  assert.equal(live.writes, 3);
  assert.equal(live.textContent, "");

  // ...and the slot is a button again, so a tap there starts the run.
  const button = menuPoint(frame.startRect);
  canvas.touch("pointerdown", { pointerId: 3, ...button });
  canvas.touch("pointerup", { pointerId: 3, ...button });
  assert.equal(starts.length, 1, "the unlocked button did not start the run");
  page.setActive(false);
});

test("a language switch re-labels the card without reopening it", () => {
  const previousDocument = globalThis.document;
  globalThis.document = { documentElement: { lang: "" } };
  try {
    const { page } = menuPageUnderTest();
    page.setActive(true);
    const chinese = page.lastFrame();
    assert.equal(chinese.title, "逐鹿中原");
    assert.equal(setLocale("en"), "en");
    page.refresh();
    const english = page.lastFrame();
    assert.equal(english.title, "Claim the Central Plains", "the canvas kept the old language");
    assert.equal(english.lede.length, 2, "the English lede is not the two lines the card reserves");
    assert.ok(english.lede.every((line) => translate("menu.lede").includes(line.replace(/\s+/g, " ").trim())
      || translate("menu.lede").includes(line.trim())), "a lede line is not part of the copy");
    page.setActive(false);
    setLocale(defaultLocale);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("the focus proxy sits on the painted 出征 and leaves the page while the rest runs", () => {
  const proxy = { hidden: true, disabled: true, style: {} };
  let remaining = 0;
  const lock = { remainingMs: () => remaining, summary: () => ({ name: "姬仇", stage: 2, score: 9 }) };
  const { page, box } = menuPageUnderTest({ lock, proxy });
  page.setActive(true);
  const frame = page.lastFrame();

  // Nothing in the page can be tabbed to that is not where the button is drawn.
  assert.equal(proxy.hidden, false);
  assert.equal(proxy.disabled, false);
  assert.equal(proxy.style.left, `${frame.startRect.x}px`);
  assert.equal(proxy.style.top, `${frame.startRect.y}px`);
  assert.equal(proxy.style.width, `${frame.startRect.width}px`);
  assert.equal(proxy.style.height, `${frame.startRect.height}px`);

  // A narrower box scales the proxy with the canvas: the rect is in view units, the
  // button is in CSS pixels.
  box.width = 480;
  box.height = 296;
  page.resize();
  assert.equal(proxy.style.left, `${frame.startRect.x / 2}px`);
  assert.equal(proxy.style.width, `${frame.startRect.width / 2}px`);
  assert.equal(proxy.style.height, `${frame.startRect.height / 2}px`);

  // While the campaign rests there is nothing to press, so there is nothing to
  // focus either: the proxy is hidden and disabled rather than left to fail.
  remaining = 60_000;
  page.refresh();
  assert.equal(proxy.hidden, true);
  assert.equal(proxy.disabled, true);
  page.setActive(false);
});

test("a portrait page re-fits the card in its own space", () => {
  const proxy = { hidden: false, disabled: false, style: {} };
  const { page, canvas, box, starts } = menuPageUnderTest({ proxy });
  page.setActive(true);
  const landscape = page.lastFrame();

  box.width = 420;
  box.height = 760;
  page.resize();
  const portrait = page.lastFrame();
  assert.notEqual(portrait, landscape, "the resize did not repaint");
  // The width stays 960 - every rect is computed in that space - and the height
  // grows with the element, so the card is centred in a taller page.
  assert.equal(portrait.view.width, 960);
  assert.equal(portrait.view.height, 960 * 760 / 420);
  assert.equal(portrait.panel.height, 380);
  assert.equal(portrait.panel.y, (portrait.view.height - 380) / 2);
  const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
  assert.equal(canvas.width, Math.round(420 * ratio));
  assert.equal(canvas.height, Math.round(760 * ratio));
  assert.equal(proxy.style.width, `${portrait.startRect.width * 420 / 960}px`);

  // The button moved with the card and still starts the run where it is drawn.
  const point = menuPoint(portrait.startRect);
  canvas.touch("pointerdown", {
    pointerId: 1, clientX: point.clientX * 420 / 960, clientY: point.clientY * 760 / portrait.view.height,
  });
  canvas.touch("pointerup", {
    pointerId: 1, clientX: point.clientX * 420 / 960, clientY: point.clientY * 760 / portrait.view.height,
  });
  assert.equal(starts.length, 1, "the re-fitted button did not start the run");
  page.setActive(false);
});

console.log("[unit] naming");

test("every name row carries a weight, a Chinese name and a story key", () => {
  for (const [table, rows] of [["clan", clanNames], ["given", givenNames]]) {
    assert.ok(rows.length > 20, `the ${table} table holds only ${rows.length} rows`);
    for (const row of rows) {
      assert.match(row.name, /^[\u3400-\u9fff]+$/u, `${table} "${row.name}" is not Chinese characters only`);
      assert.ok(Number.isInteger(row.weight) && row.weight > 0,
        `${table} "${row.name}" has weight ${row.weight}`);
      assert.match(row.namingStory.reason, new RegExp(`^namingStory\\.${table}\\.reason\\.`),
        `${table} "${row.name}" points at ${row.namingStory.reason}`);
      assert.ok(row.namingStory.named_by, `${table} "${row.name}" has no naming source`);
    }
  }
});

test("every rolled story key exists in every locale", () => {
  // This is the one that would have caught the table pointing at a key no
  // resource file ever defined: the player would have been shown the raw key.
  for (const row of [...clanNames, ...givenNames]) {
    for (const locale of Object.keys(supportedLocales)) {
      assert.ok(hasTranslation(locale, row.namingStory.reason),
        `${locale} is missing ${row.namingStory.reason}`);
    }
  }
});

test("a clan name is unique, so a name reads as one family", () => {
  const seen = new Set();
  for (const row of clanNames) {
    assert.ok(!seen.has(row.name), `clan name "${row.name}" appears twice`);
    seen.add(row.name);
  }
});

test("the name tables are frozen, so a live run cannot rename itself", () => {
  assert.throws(() => { clanNames[0].name = "改"; }, TypeError);
  assert.throws(() => { givenNames[0].namingStory.reason = "nope"; }, TypeError);
});

test("pickWeighted walks the table once and lands in the right bucket", () => {
  const rows = [{ id: "first", weight: 3 }, { id: "second", weight: 1 }];
  assert.equal(pickWeighted(rows, () => 0), rows[0]);
  assert.equal(pickWeighted(rows, () => 0.74), rows[0], "a roll inside the first bucket left it");
  assert.equal(pickWeighted(rows, () => 0.76), rows[1]);
  // A generator that returns exactly 1 walks off the end of the table: the last
  // row is the fallback rather than `undefined`, which would have reached the
  // prologue as an empty name.
  assert.equal(pickWeighted(rows, () => 1), rows[1]);
  assert.equal(pickWeighted(rows, () => 0.9999999999), rows[1]);
});

test("a heavier weight comes up more often over 2000 draws", () => {
  const rows = [{ name: "heavy", weight: 10 }, { name: "light", weight: 2 }];
  const random = createSeededRandom(20261026);
  let heavy = 0;
  for (let draw = 0; draw < 2000; draw += 1) if (pickWeighted(rows, random) === rows[0]) heavy += 1;
  // 10/12 of 2000 is 1667. The band is wide enough not to be flaky and narrow
  // enough to fail the moment the weights stop being read.
  assert.ok(heavy > 1550 && heavy < 1780, `heavy came up ${heavy} times in 2000`);
});

test("a run's name is one draw per table and repeats on the same seed", () => {
  const first = createPlayerIdentity(createSeededRandom(42));
  const second = createPlayerIdentity(createSeededRandom(42));
  assert.deepEqual(first, second, "the same seed named two different players");
  assert.equal(first.fullName, `${first.clan}${first.given}`);
  assert.match(first.fullName, /^[\u3400-\u9fff]{2,}$/u);

  let draws = 0;
  createPlayerIdentity(() => {
    draws += 1;
    return 0.5;
  });
  assert.equal(draws, 2, `the roll took ${draws} draws instead of one per table`);
});

test("the prologue is five lines, and only the story around the name is translated", () => {
  const identity = createPlayerIdentity(createSeededRandom(7));
  const zh = translator("zh-CN");
  const en = translator("en");
  const lines = prologueLines(identity, 0, zh);
  assert.deepEqual(lines.map((line) => line.slot), ["birth", "name", "clan", "given", "ambition"]);
  assert.equal(lines[1].text, zh("prologue.name", { name: identity.fullName }));
  assert.equal(lines[2].text, zh(identity.clanReasonKey));
  assert.equal(lines[3].text, zh(identity.givenReasonKey));

  // The name is data, not copy: the English story carries the same characters.
  const english = prologueLines(identity, 0, en);
  assert.ok(english[1].text.includes(identity.fullName), "the English story lost the name");
  assert.notEqual(english[1].text, lines[1].text, "the English story was not translated");
  for (const line of english) {
    assert.ok(!line.text.startsWith("prologue.") && !line.text.startsWith("namingStory."),
      `an English line fell back to its key: ${line.text}`);
  }
});

test("the prologue card declares every line the story writes", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const id of ["prologue-name", "prologue-birth", "prologue-name-line", "prologue-clan",
    "prologue-given", "prologue-ambition", "prologue-final", "prologue-start"]) {
    assert.ok(html.includes(`id="${id}"`), `index.html is missing #${id}`);
  }
  // The card is hidden in the markup: it must not flash before the first run
  // has rolled a name for it.
  assert.match(html, /id="prologue-screen"[^>]*hidden/, "the prologue section is not hidden at boot");
});

console.log("[unit] i18n");

test("every supported locale registered its resource file", () => {
  for (const locale of Object.keys(supportedLocales)) {
    for (const key of ["app.title", "menu.title", "shop.title", "battle.pausedTitle"]) {
      assert.ok(hasTranslation(locale, key), `${locale} is missing ${key}`);
    }
  }
});

test("every key in index.html has a translation in every locale", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const keys = new Set([...html.matchAll(/data-i18n(?:-aria-label|-title|-content)?="([^"]+)"/g)]
    .map((match) => match[1]));
  assert.ok(keys.size > 40, `only ${keys.size} static translation keys found in index.html`);
  for (const locale of Object.keys(supportedLocales)) {
    for (const key of keys) assert.ok(hasTranslation(locale, key), `${locale} is missing ${key}`);
  }
});

test("translate reads the resource file of the active locale", () => {
  const previousDocument = globalThis.document;
  globalThis.document = { documentElement: { lang: "" } };
  try {
    assert.equal(translate("menu.title"), "逐鹿中原");
    assert.equal(setLocale("en"), "en");
    assert.equal(translate("menu.title"), "Claim the Central Plains");
    assert.equal(globalThis.document.documentElement.lang, "en", "the page language did not follow the locale");
    assert.throws(() => setLocale("fr"), /Unsupported locale/, "an unknown locale was accepted");
    setLocale(defaultLocale);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("translate interpolates values and leaves unknown placeholders visible", () => {
  const t = translator(defaultLocale);
  assert.equal(t("shop.info.label", { name: "弩架" }), "弩架：");
  assert.match(t("shop.location"), /\{battlefield\}/, "a missing value was not left visible");
  assert.equal(t("shop.info.label", { name: 3 }), "3：");
});

test("a bound translator is cached per locale", () => {
  assert.equal(translator("en"), translator("en"));
  assert.notEqual(translator("en"), translator("zh-CN"));
});

test("an unsupported locale falls back to the default one", () => {
  assert.equal(translator("fr")("menu.title"), translator(defaultLocale)("menu.title"));
  assert.throws(() => registerLocale("fr", {}), /Unknown locale/, "an unknown locale was registered");
});

test("a missing key falls back to the key itself instead of a blank string", () => {
  assert.equal(translator(defaultLocale)("no.such.key"), "no.such.key");
});

console.log("[unit] storage facade");

// A driver is three functions, so a test driver is a Map with a wrapper. The
// facade's own job is the caching and the "never throw at the game" contract.
function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  const storage = createStorage({
    driver: {
      read: (key) => (values.has(key) ? values.get(key) : null),
      write: (key, value) => values.set(key, value),
      erase: (key) => values.delete(key),
    },
    onError: () => {},
  });
  return { values, storage };
}

test("a driver that throws cannot stop the game from reading or writing", () => {
  const errors = [];
  const broken = (action) => () => {
    throw new Error(`${action} failed`);
  };
  const storage = createStorage({
    driver: { read: broken("read"), write: broken("write"), erase: broken("erase") },
    onError: (action, key) => errors.push(`${action}:${key}`),
  });
  assert.equal(storage.get("missing"), null, "a failed read is a missing value");
  assert.equal(storage.get("missing", 7), 7, "and it still answers the fallback");
  storage.set("k", { a: 1 });
  assert.deepEqual(storage.get("k"), { a: 1 }, "the cache keeps the value the driver could not");
  storage.remove("k");
  assert.equal(storage.get("k"), null, "a failed erase still forgets the value");
  // The second read of "missing" and of "k" are answered by the cache, so each
  // failure is reported once — the point is that every one of them is reported
  // with the action and the key, and that none of them escapes to the caller.
  assert.deepEqual(errors, ["read:missing", "write:k", "erase:k", "read:k"],
    "every failure is reported once, with the action and the key");
});

test("the facade writes through and re-reads after an invalidate", () => {
  const { values, storage } = memoryStorage();
  storage.set("chariot-wars.test", "one");
  assert.equal(values.get("chariot-wars.test"), "one", "the driver was written through");
  // Somebody else writes the same key: the cache has to be told to look again.
  values.set("chariot-wars.test", "two");
  assert.equal(storage.get("chariot-wars.test"), "one", "the cache answers first");
  storage.invalidate("chariot-wars.test");
  assert.equal(storage.get("chariot-wars.test"), "two", "invalidate re-hits the driver");
  storage.remove("chariot-wars.test");
  assert.equal(values.has("chariot-wars.test"), false, "remove reaches the driver");
});

test("a driver that fetches over the network feeds the cache instead", () => {
  // The shape a web-service driver will have: it cannot answer synchronously, so
  // it hands the facade what it fetched and the game keeps reading from there.
  const remote = { "chariot-wars.locale": "en" };
  const storage = createStorage({
    driver: {
      read: (key) => remote[key] ?? null,
      write: (key, value) => { remote[key] = value; },
      erase: (key) => { delete remote[key]; },
    },
    onError: () => {},
  });
  storage.hydrate({ "chariot-wars.locale": "zh-CN" });
  assert.equal(storage.get("chariot-wars.locale"), "zh-CN", "hydrate wins until invalidated");
  storage.invalidate();
  assert.equal(storage.get("chariot-wars.locale"), "en", "an invalidate falls back to the driver");
  storage.set("chariot-wars.victory.v1", { wonAt: 1 });
  assert.deepEqual(storage.snapshot(), {
    "chariot-wars.locale": "en", "chariot-wars.victory.v1": { wonAt: 1 },
  }, "the snapshot is what such a driver uploads");
});

// The shipped driver is the one piece of the facade that talks to the platform,
// and the H5 platform stores UTF-16 strings only: a payload becomes JSON text on
// the way in and the reader parses it back.
test("the browser driver stores JSON text and forgets a removed key", () => {
  const previous = globalThis.window.localStorage;
  const values = new Map();
  globalThis.window.localStorage = {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  try {
    const storage = createStorage({ driver: localStorageDriver });
    storage.set("chariot-wars.victory.v1", { wonAt: 5, name: "子車黑" });
    assert.equal(typeof values.get("chariot-wars.victory.v1"), "string", "localStorage only holds strings");
    assert.deepEqual(JSON.parse(values.get("chariot-wars.victory.v1")), { wonAt: 5, name: "子車黑" });
    storage.invalidate();
    assert.deepEqual(parseVictoryRecord(storage.get("chariot-wars.victory.v1")), {
      wonAt: 5, name: "子車黑", stage: 0, score: 0,
    }, "a fresh read is the same record");
    storage.remove("chariot-wars.victory.v1");
    assert.equal(values.has("chariot-wars.victory.v1"), false, "removal reaches the store");
  } finally {
    globalThis.window.localStorage = previous;
  }
});

test("a host that refuses storage unlocks the campaign instead of failing", () => {
  const previous = globalThis.window;
  // `localStorage` raises on a `file:` origin and in a browser that blocks site
  // data; the driver must degrade to "no stored value" rather than throw at boot.
  globalThis.window = {};
  Object.defineProperty(globalThis.window, "localStorage", {
    get() { throw new Error("SecurityError: storage is blocked"); },
  });
  try {
    const storage = createStorage({ driver: localStorageDriver, onError: () => {} });
    assert.equal(storage.get(VICTORY_LOCK_KEY), null, "a blocked store reads as empty");
    storage.set(VICTORY_LOCK_KEY, { wonAt: 1 });
    storage.remove(VICTORY_LOCK_KEY);
    const lock = createVictoryLock({ storage });
    assert.equal(lock.remainingMs(), 0, "and the campaign is not locked");
    assert.equal(lock.releaseIfExpired(), true);
  } finally {
    globalThis.window = previous;
  }
});


console.log("[unit] the rest after a victory");

test("the rest is measured in whole minutes of one window", () => {
  assert.ok(Number.isInteger(VICTORY_LOCK_MINUTES) && VICTORY_LOCK_MINUTES > 0,
    `the window must be a positive whole number of minutes, got ${VICTORY_LOCK_MINUTES}`);
  assert.equal(VICTORY_LOCK_MS, VICTORY_LOCK_MINUTES * 60 * 1000,
    "milliseconds are derived, so one edit moves both");
  assert.equal(lockWindowLabel(), countdownLabel(VICTORY_LOCK_MS),
    "the card quotes the same window the gate enforces");
});

test("a victory locks the campaign for exactly one window", () => {
  const { values, storage } = memoryStorage();
  let now = 1_000_000;
  const lock = createVictoryLock({ storage, now: () => now, windowMs: 60_000 });
  assert.equal(lock.remainingMs(), 0, "no record means no rest");
  assert.equal(lock.releaseIfExpired(), true, "and a run may start");

  assert.equal(lock.lock({ name: "子車黑", stage: 13, score: 9600 }), true);
  assert.deepEqual(values.get(VICTORY_LOCK_KEY), {
    v: 1, wonAt: 1_000_000, name: "子車黑", stage: 13, score: 9600,
  }, "the payload is the documented one, under the documented key");
  assert.equal(lock.remainingMs(), 60_000);
  assert.equal(lock.releaseIfExpired(), false, "the window is live");

  now += 59_999;
  assert.equal(lock.releaseIfExpired(), false, "one millisecond short is still locked");
  now += 1;
  assert.equal(lock.remainingMs(), 0, "the window ends on the millisecond");
  assert.equal(lock.releaseIfExpired(), true, "and the campaign opens again");
  assert.equal(values.has(VICTORY_LOCK_KEY), false, "the spent record is deleted, not kept");
});

test("a second victory inside the window does not extend it", () => {
  const { values, storage } = memoryStorage();
  let now = 1_000_000;
  const lock = createVictoryLock({ storage, now: () => now, windowMs: 60_000 });
  lock.lock({ name: "甲", stage: 10, score: 1 });
  now += 30_000;
  assert.equal(lock.lock({ name: "乙", stage: 11, score: 2 }), false, "a live window refuses the write");
  assert.equal(values.get(VICTORY_LOCK_KEY).wonAt, 1_000_000, "the first victory keeps its timestamp");
  assert.equal(values.get(VICTORY_LOCK_KEY).name, "甲", "and its run");
  assert.equal(lock.remainingMs(), 30_000, "so the wait is the remainder, not a fresh window");
});

test("a corrupt or impossible record unlocks the campaign", () => {
  for (const raw of ["", "nope", "{oops", "[]", "null", "{}", { wonAt: 0 }, { wonAt: -5 },
    { wonAt: "later" }, { wonAt: null }, { wonAt: Number.NaN }]) {
    assert.equal(parseVictoryRecord(raw), null, `${JSON.stringify(raw)} must not parse`);
    const { storage } = memoryStorage({ [VICTORY_LOCK_KEY]: raw });
    const lock = createVictoryLock({ storage, now: () => 5_000_000, windowMs: 60_000 });
    assert.equal(lock.remainingMs(), 0, `${JSON.stringify(raw)} must not lock`);
    assert.equal(lock.releaseIfExpired(), true, `${JSON.stringify(raw)} must not throw`);
  }
  // The same payload as text, which is how the browser hands it back.
  assert.deepEqual(parseVictoryRecord(JSON.stringify({
    wonAt: 12, name: "子車黑", stage: 12, score: 2400,
  })), { wonAt: 12, name: "子車黑", stage: 12, score: 2400 });
  assert.deepEqual(parseVictoryRecord({ wonAt: "12" }), {
    wonAt: 12, name: "", stage: 0, score: 0,
  }, "a record with no name still parses, its extra fields defaulted");
});

test("a record dated in the future is a moved clock, not a life sentence", () => {
  // A clock set back by a minute or two is treated as noise: the window restarts.
  const noise = memoryStorage({ [VICTORY_LOCK_KEY]: { wonAt: 1_030_000 } });
  const noisy = createVictoryLock({ storage: noise.storage, now: () => 1_000_000, windowMs: 60_000 });
  assert.equal(noisy.remainingMs(), 60_000, "a small skew still locks, from the whole window");

  // A record a week in the future is not a victory this device could have won.
  const forged = memoryStorage({ [VICTORY_LOCK_KEY]: { wonAt: 1_000_000 + 7 * 24 * 3600 * 1000 } });
  const forgedLock = createVictoryLock({ storage: forged.storage, now: () => 1_000_000, windowMs: 60_000 });
  assert.equal(forgedLock.remainingMs(), 0, "an impossible record is ignored");
  assert.equal(forgedLock.releaseIfExpired(), true, "and the campaign opens");
});

test("the countdown names hours above an hour and seconds below it", () => {
  assert.equal(countdownLabel(60_000), translate("menu.timeMinutes", { minutes: 1 }), "a whole minute");
  assert.equal(countdownLabel(45_000), translate("menu.timeSecondsOnly", { seconds: 45 }),
    "seconds only");
  assert.equal(countdownLabel(100_000), translate("menu.timeSeconds", { minutes: 1, seconds: 40 }));
  assert.equal(countdownLabel(VICTORY_LOCK_MS), translate("menu.timeMinutes", {
    minutes: VICTORY_LOCK_MINUTES,
  }), "the shipped window, as the card prints it");
  assert.equal(countdownLabel(24 * 3600 * 1000), translate("menu.timeHoursOnly", { hours: 24 }),
    "a day is a day, not 24h 0m");
  assert.equal(countdownLabel(3_660_000), translate("menu.timeHours", { hours: 1, minutes: 1 }));
  assert.equal(countdownLabel(1), translate("menu.timeSecondsOnly", { seconds: 1 }),
    "the last second still reads as a second");
});

test("the ending and the rest exist in both locales, placeholders included", () => {
  const slots = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  const tables = { "zh-CN": zhCN, en };
  for (const key of [
    "battle.finalStage", "battle.bossSquad", "battle.bossSquadBanner", "battle.finalWarning",
    "victory.eyebrow", "victory.title", "victory.subtitle", "victory.stats",
    "victory.lockNote", "victory.return",
    "menu.locked", "menu.lockedLast",
    "menu.timeHours", "menu.timeHoursOnly", "menu.timeMinutes", "menu.timeSeconds",
    "menu.timeSecondsOnly", "prologue.final",
  ]) {
    const zh = tables["zh-CN"][key];
    const english = tables.en[key];
    assert.ok(zh && english, `missing translation: ${key}`);
    assert.deepEqual(slots(zh), slots(english), `placeholder mismatch in ${key}`);
  }
  // The countdown never renders a raw number where a unit belongs: every branch
  // carries its own suffix, so the label reads the same in a screenshot and in a
  // log line.
  for (const key of ["menu.timeHours", "menu.timeHoursOnly", "menu.timeMinutes",
    "menu.timeSeconds", "menu.timeSecondsOnly"]) {
    assert.ok(/[时h]|[分m]|[秒s]/.test(tables.en[key]), `${key} has no unit`);
  }
});

console.log("[unit] the last stage");

test("the last stage is drawn from the rule range and only from it", () => {
  assert.equal(pickFinalStage(() => 0), campaignRules.finalStageMin);
  assert.equal(pickFinalStage(() => 0.999999),
    campaignRules.finalStageMin + campaignRules.finalStageSpan - 1);
  const seen = new Set();
  const random = createSeededRandom(createRandomSeed(7));
  for (let run = 0; run < 200; run += 1) {
    const stage = pickFinalStage(random);
    assert.ok(stage >= campaignRules.finalStageMin
      && stage < campaignRules.finalStageMin + campaignRules.finalStageSpan, `stage ${stage}`);
    seen.add(stage);
  }
  // Every stage in the range turns up in 200 runs: a short campaign must be as
  // reachable as a long one.
  assert.equal(seen.size, campaignRules.finalStageSpan, `only ${[...seen].join("/")} were drawn`);
  // The same seed draws the same last stage, so `?seed=` still pins a run.
  assert.equal(
    pickFinalStage(createSeededRandom(createRandomSeed(7))),
    pickFinalStage(createSeededRandom(createRandomSeed(7))),
  );
});

test("the squad table is eight champions and a fixed 784 HP", () => {
  const squad = campaignRules.finalSquad;
  assert.equal(squad.length, 8);
  const counts = {};
  let health = 0;
  for (const type of squad) {
    const row = bossTypes.find((boss) => boss.type === type);
    assert.ok(row, `the squad names a real champion type (${type})`);
    counts[type] = (counts[type] ?? 0) + 1;
    health += row.health;
  }
  assert.deepEqual(counts, { elephant: 2, lion: 2, catapult: 4 },
    "two elephants to break the line, two lions to chase, four catapults to bombard");
  // The weight follows this build's champion table (2 x 204 + 2 x 78 + 4 x 55),
  // so a retune of any row has to be looked at with the squad in hand: the HUD
  // prints the sum, and eight champions that melt are not the last battle.
  assert.equal(health, 784, "the HUD's total is what the rule table adds up to");
  assert.ok(campaignRules.finalStageEnemyLimit >= squad.length + 6,
    "the enemy cap has to leave room for a formation behind the squad");
});

test("a squad is only beaten when its last champion falls", () => {
  const rig = formationRig();
  const squad = rig.enemies.spawnBossSquad();
  assert.equal(squad.length, 8, "the squad is spawned whole");
  assert.equal(rig.state.bosses.length, 8, "every champion joins the roster");
  assert.equal(rig.state.enemies.length, 8, "and the battlefield");
  for (const boss of squad.slice(0, -1)) rig.enemies.damageEnemy(boss, 1e6, "sword");
  assert.equal(rig.state.bossDefeated, false, "seven of eight is not a victory");
  assert.equal(rig.state.bosses.filter((boss) => boss.destroyed).length, 7);
  rig.enemies.damageEnemy(squad[7], 1e6, "sword");
  assert.equal(rig.state.bossDefeated, true, "the last champion ends the squad");
  // The roster keeps the fallen, because the HUD still totals the whole squad.
  assert.equal(rig.state.bosses.length, 8);
  assert.equal(rig.state.bosses.filter((boss) => boss.destroyed).length, 8);
});

test("a squad is placed around the player, one bearing each", () => {
  const rig = formationRig();
  const squad = rig.enemies.spawnBossSquad();
  const spots = new Set(squad.map((boss) => `${Math.round(boss.x)},${Math.round(boss.y)}`));
  assert.equal(spots.size, 8, "no two champions share a spot");
  // The rig's field is empty, so every champion lands on the first candidate:
  // one ring, one radius. When the ground is blocked the walk closes the radius
  // instead, which is why this asserts equality and not an exact constant.
  const distances = squad.map((boss) => Math.hypot(boss.x - rig.player.x, boss.y - rig.player.y));
  assert.ok(distances.every((distance) => distance > 400 && distance <= 640),
    `champions open at ${distances.map((d) => d.toFixed(0)).join("/")}px`);
  assert.ok(distances.every((distance) => Math.abs(distance - distances[0]) < 1),
    "an unblocked squad opens on a single ring");
  for (const boss of squad) {
    assert.ok(Number.isFinite(boss.x) && Number.isFinite(boss.y),
      `${boss.type} at ${boss.x},${boss.y}`);
    assert.ok(boss.x >= 0 && boss.x <= arena.width, `x ${boss.x} left the field`);
    assert.ok(boss.y >= 0 && boss.y <= arena.height, `y ${boss.y} left the field`);
    assert.ok(boss.boss === true && boss.maxHealth === boss.health, "a squad member is a boss");
  }
  // One champion per bearing, so the fight does not open from two sides only.
  const bearings = squad.map((boss) => Math.atan2(boss.y - rig.player.y, boss.x - rig.player.x));
  const spread = Math.max(...bearings) - Math.min(...bearings);
  assert.ok(spread > Math.PI, `the squad must ring the player, spread ${spread.toFixed(2)}rad`);
});

test("the stage box names the last battle instead of numbering it", () => {
  const zh = translator("zh-CN");
  const english = translator("en");
  assert.equal(stageLabel({ stage: 4 }, { finalBattle: false }, zh), "04", "a numbered stage is padded");
  assert.equal(stageLabel({ stage: 12 }, { finalBattle: false }, zh), "12");
  assert.equal(stageLabel({ stage: 12 }, { finalBattle: true }, zh), zh("battle.finalStage"),
    "the last battle is named");
  assert.notEqual(stageLabel({ stage: 12 }, { finalBattle: true }, zh), "12");
  assert.equal(stageLabel({ stage: 12 }, { finalBattle: true }, english), "FINAL",
    "the English readout is the word the stat box was sized for");
  // A state object that predates the flag (or a campaign that has not rolled a
  // last stage yet) must not read as the last battle.
  assert.equal(stageLabel({ stage: 3 }, {}, zh), "03");
  assert.equal(stageLabel({ stage: 3 }, null, zh), "03");
});

test("the story card grows a sixth line that names the last stage", () => {
  const identity = createPlayerIdentity(createSeededRandom(createRandomSeed(11)));
  const five = prologueLines(identity);
  assert.equal(five.length, 5, "a card with no known ending stays five lines");
  const six = prologueLines(identity, 12);
  assert.equal(six.length, 6);
  assert.equal(six[5].slot, "final");
  assert.ok(six[5].text.includes("12"), `the line names the stage, got "${six[5].text}"`);
  assert.ok(six.slice(0, 5).every((line, index) => line.text === five[index].text),
    "the ending is appended, not woven into the story");
  assert.equal(prologueLines(null, 12).length, 0, "no identity, no card");
});

test("index.html carries the one card, and a menu whose 出征 is painted", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  // One card for every dialog that stops the battle. There used to be two DOM
  // cards with their own ids and their own CSS, plus a third painted on the canvas
  // for the drill; the copy now lives in the locale tables and the ids are the
  // presenter's (src/ui/battle-card.js).
  for (const id of ["battle-card", "card-icon", "card-eyebrow", "card-title", "card-copy",
    "card-lines", "card-button", "card-action"]) {
    assert.ok(html.includes(`id="${id}"`), `index.html is missing #${id}`);
  }
  assert.ok(!html.includes('id="game-overlay"') && !html.includes('id="victory-screen"'),
    "a second card survived the merge");
  // The card is hidden in the markup: it may not flash before a run has earned it,
  // and it must not cover the menu at boot.
  const cardTag = html.match(/<div[^>]*id="battle-card"[^>]*>/)?.[0] ?? "";
  assert.ok(cardTag.includes("hidden"), `the card is not hidden at boot: ${cardTag}`);
  // The slots are painted from the spec, so the markup carries none of the copy: a
  // string here would be a second table to keep in sync with the locale files.
  const cardMarkup = html.slice(html.indexOf('id="battle-card"'), html.indexOf('id="battle-card"') + 1200);
  for (const id of ["card-eyebrow", "card-title", "card-copy", "card-action"]) {
    assert.match(cardMarkup, new RegExp(`id="${id}"[^>]*></`), `#${id} carries hard-coded copy`);
  }
  // The home page is one canvas now: the resting card is painted on it, so what the
  // page keeps is the canvas, the live region that announces the countdown, and the
  // focus proxy that stands in for the painted 出征.
  for (const id of ["menu-screen", "menu-canvas", "menu-live", "menu-start"]) {
    assert.ok(html.includes(`id="${id}"`), `index.html is missing #${id}`);
  }
  assert.ok(!html.includes("menu-lock"), "the resting card is no longer DOM");
  assert.match(html, /<canvas[^>]*id="menu-canvas"/, "the menu canvas is a canvas");
  assert.match(html, /id="menu-start"[^>]*>[\s\S]*?data-i18n="menu.start"/,
    "the focus proxy carries the button's label, so it has an accessible name");
  assert.match(html, /class="menu-start-proxy"/, "the proxy is styled as a proxy, not as the old button");
});

test("?reset=1 reaches the launch query, and a bare launch is empty", () => {
  const previous = globalThis.location;
  try {
    globalThis.location = { search: "?seed=7&reset=1" };
    assert.deepEqual(launchQuery(), { seed: "7", reset: "1" }, "both switches are read");
    globalThis.location = { search: "?seed=7" };
    assert.deepEqual(launchQuery(), { seed: "7" }, "no reset means no key to act on");
    globalThis.location = { search: "" };
    assert.deepEqual(launchQuery(), {}, "a plain launch says nothing");
  } finally {
    globalThis.location = previous;
  }
  // The game is untouched by a host with no URL: it boots with a random seed.
  const previousWindow = globalThis.window;
  globalThis.window = {};
  try {
    assert.deepEqual(launchQuery(), {}, "a host without a URL still boots");
  } finally {
    globalThis.window = previousWindow;
  }
});

console.log("\n[unit] the hired formation");

// A minimal battle for the ally system: flat, empty ground, a player in the
// middle and one enemy list the test owns. The factory only reaches for the
// services it is given, so these stubs stand in for the real collision/map.
function hireRig({ hires = 0 } = {}) {
  const state = {
    elapsed: 0,
    enemies: [],
    formations: [],
    allyFormations: [],
    allies: [],
    shake: 0,
    bullets: [],
    particles: [],
    meleeEffects: [],
    bloodStains: [],
  };
  const player = { x: 1000, y: 800, radius: 17, angle: -Math.PI / 2, mode: "chariot" };
  const world = { width: 2000, height: 1600 };
  let draws = 0;
  const campaign = {
    friendlyFormations: hires,
    obstacles: [],
    terrain: [],
    // Counts every draw so the spawn test can prove a hire rolls nothing; the
    // value is fixed so a death stain is still deterministic.
    random: () => { draws += 1; return 0.5; },
  };
  const allies = createAllies({
    state,
    player,
    world,
    campaign,
    moveEntitySafely: (unit, dx, dy) => { unit.x += dx; unit.y += dy; },
    hasLineOfSight: () => true,
    circleIntersectsObstacle: () => false,
    rectHitsAnyObstacle: () => false,
    rectTerrain: () => ({ dry: true, uniform: true, speed: 1, overlapped: 0 }),
    damageEnemy: (enemy, amount) => {
      enemy.health -= amount;
      if (enemy.health <= 0) enemy.destroyed = true;
    },
    fireAllyArrow: () => { state.bullets.push({ owner: "ally" }); },
    addMeleeEffect: (x, y, angle, weapon) => { state.meleeEffects.push({ x, y, angle, weapon }); },
    burst: () => {},
  });
  return { state, player, world, campaign, allies, draws: () => draws };
}

test("the hire is one row: price, cap, roster and aura all read from it", () => {
  assert.equal(formationConfig.price, 1000);
  assert.equal(formationConfig.maxHires, 2);
  assert.equal(formationConfig.slots.length, 7, "the line is not seven bodies");
  const types = formationConfig.slots.map(([type]) => type);
  assert.equal(types.filter((type) => type === "chariot").length, 1);
  assert.equal(types.filter((type) => type === "archer").length, 2);
  assert.equal(types.filter((type) => type === "spear").length, 2);
  assert.equal(formationConfig.aura.heal, 3);
  assert.equal(formationConfig.aura.interval, 3);
  // The two legs an order opens up are in the row too, and they pull in opposite
  // directions: a marcher keeps step with the chariot (slower), a straggler sent
  // home by a 结阵 runs (faster).
  assert.ok(formationConfig.orders.marchSpeed < formationConfig.orders.returnSpeed,
    "a march must be slower than a return, or 结阵 would gain nothing");
  assert.ok(formationConfig.chariot.reengageAt > formationConfig.chariot.fleeAt,
    "the two thresholds must leave a hysteresis band");
});

test("a hire with no purchase spawns nothing", () => {
  const rig = hireRig();
  assert.deepEqual(rig.allies.spawnFriendlyFormations(), []);
  assert.deepEqual(rig.state.allies, []);
});

test("each hire spawns the whole line, and the count is capped", () => {
  const rig = hireRig({ hires: 2 });
  const lines = rig.allies.spawnFriendlyFormations();
  assert.equal(lines.length, 2, "two hires did not spawn two lines");
  assert.equal(rig.state.allies.length, 14, "a line is not seven bodies");
  for (const line of lines) {
    const members = rig.state.allies.filter((ally) => ally.formationId === line.id);
    assert.equal(members.length, 7);
    assert.equal(members.filter((ally) => ally.vehicle).length, 1, "a line without its chariot");
    assert.equal(members.filter((ally) => ally.ranged).length, 2, "a line without both archers");
    assert.equal(members.every((ally) => ally.friendly && ally.health === ally.maxHealth), true);
    assert.equal(members.every((ally) => ally.visual.robe === formationConfig.visual.robe), true,
      "a hired body kept the enemy palette");
    assert.ok(line.id < 0, "a friendly line reused the enemy id space");
  }
  // The cap is enforced at spawn too, not only by the shop button.
  const capped = hireRig({ hires: 9 });
  assert.equal(capped.allies.spawnFriendlyFormations().length, formationConfig.maxHires);
});

test("spawning a line draws no random numbers and repeats exactly", () => {
  const first = hireRig({ hires: 2 });
  const second = hireRig({ hires: 2 });
  first.allies.spawnFriendlyFormations();
  second.allies.spawnFriendlyFormations();
  const place = (rig) => rig.state.allies.map((ally) => [ally.type, ally.x, ally.y, ally.angle]);
  assert.deepEqual(place(first), place(second), "two identical spawns landed differently");
  // Placement walks a fixed bearing list, so a hire cannot move the enemy
  // placement on a seeded battlefield.
  assert.equal(first.draws() + second.draws(), 0, "spawning a line drew from the battle seed");
  assert.ok(first.state.allyFormations.every((line) => line.auraTimer === 0 && line.auraFlash === 0));
});



test("a chariot flees at 20% and only re-engages above 40%", () => {
  const at = (health, current, extra = {}) => nextChariotState({
    current, health, maxHealth: 14, ...extra,
  });
  // Both sides read the same table; the ally row keeps it by reference.
  assert.equal(formationConfig.chariot.fleeAt, chariotTactics.fleeAt);
  assert.equal(formationConfig.chariot.reengageAt, chariotTactics.reengageAt);
  assert.equal(at(14, CHARIOT_STATE.HOLD), CHARIOT_STATE.HOLD, "a fresh chariot left its post");
  assert.equal(at(14, CHARIOT_STATE.HOLD, { hasTarget: true }), CHARIOT_STATE.CHASE);
  assert.equal(at(2, CHARIOT_STATE.CHASE), CHARIOT_STATE.FLEE, "a broken chariot did not run");
  assert.equal(at(2, CHARIOT_STATE.HOLD), CHARIOT_STATE.FLEE);
  // Hysteresis: 30% is inside the band, so a fleeing chariot keeps running even
  // though it is above the entry threshold.
  assert.equal(at(4, CHARIOT_STATE.FLEE), CHARIOT_STATE.FLEE, "the band collapsed into one threshold");
  assert.equal(at(6, CHARIOT_STATE.FLEE), CHARIOT_STATE.HOLD, "the chariot did not re-engage above 40%");
  // Camp does not end the band: 21% at home is still disengaged, and only the
  // re-engage threshold sends it back out.
  assert.equal(at(3, CHARIOT_STATE.FLEE, { hasTarget: true }), CHARIOT_STATE.FLEE,
    "a chariot that reached camp charged out again before 40%");
  assert.equal(at(6, CHARIOT_STATE.FLEE, { hasTarget: true }), CHARIOT_STATE.CHASE);
  assert.equal(chariotIntent(CHARIOT_STATE.FLEE), CHARIOT_INTENT.REGROUP);
  assert.equal(chariotIntent(CHARIOT_STATE.CHASE), CHARIOT_INTENT.ENGAGE);
  assert.equal(chariotIntent(CHARIOT_STATE.FIGHT_TO_DEATH), CHARIOT_INTENT.ENGAGE);
  assert.equal(chariotIntent(CHARIOT_STATE.HOLD), CHARIOT_INTENT.HOLD);
  assert.equal(chariotIntent(undefined), CHARIOT_INTENT.HOLD, "an unticked unit must stand still");
});

test("a cornered chariot fights to the death and never runs again", () => {
  assert.equal(nextChariotState({ current: CHARIOT_STATE.FLEE, health: 1, maxHealth: 14, inMelee: true }),
    CHARIOT_STATE.FIGHT_TO_DEATH);
  assert.equal(nextChariotState({ current: CHARIOT_STATE.HOLD, health: 1, maxHealth: 14, inMelee: true }),
    CHARIOT_STATE.FIGHT_TO_DEATH);
  // Latched: healing, reaching camp or meeting a fresh target cannot undo it.
  assert.equal(nextChariotState({ current: CHARIOT_STATE.FIGHT_TO_DEATH, health: 14, maxHealth: 14 }),
    CHARIOT_STATE.FIGHT_TO_DEATH);
  assert.equal(nextChariotState({
    current: CHARIOT_STATE.FIGHT_TO_DEATH, health: 14, maxHealth: 14, hasTarget: true,
  }), CHARIOT_STATE.FIGHT_TO_DEATH);
});

test("the enemy chariot drives the same morale machine as the hire", () => {
  const player = { x: 800, y: 500, radius: 17, mode: "chariot", angle: 0 };
  const behaviours = createBehaviours({
    player,
    moveEntitySafely: (unit, dx, dy) => { unit.x += dx; unit.y += dy; },
    fireEnemy: () => {},
    damageCombatTarget: () => {},
    addMeleeEffect: () => {},
    burst: () => {},
    damageEnemy: () => {},
    getChariotTravelSpeed: () => 0,
  });
  const chariot = {
    type: "chariot", behaviour: "cavalry", x: 500, y: 500,
    homeX: 300, homeY: 500, radius: 21, speed: 75, health: 14, maxHealth: 14,
    angle: 0, contactCooldown: 0,
  };
  // The same order `updateUnits` uses: morale every frame, then the sight brain.
  function frame() {
    const distance = Math.hypot(player.x - chariot.x, player.y - chariot.y);
    const angle = Math.atan2(player.y - chariot.y, player.x - chariot.x);
    behaviours.cavalry.think(chariot, player, distance, true);
    behaviours.cavalry.onSight(chariot, player, distance, angle, 1 / 60);
  }

  frame();
  assert.equal(chariot.chariotState, CHARIOT_STATE.CHASE, "an enemy chariot did not charge");
  assert.ok(chariot.x > 500, "a whole enemy chariot did not close on the player");

  // Broken on the field: it breaks contact and runs for its own slot.
  chariot.health = 2;
  chariot.chariotState = CHARIOT_STATE.CHASE;
  chariot.x = 500;
  frame();
  assert.equal(chariot.chariotState, CHARIOT_STATE.FLEE, "a broken enemy chariot did not break off");
  assert.ok(chariot.x < 500, "a broken enemy chariot did not run home");

  // At home at 21%, with the player in plain sight: still disengaged.
  chariot.x = chariot.homeX;
  chariot.health = 3;
  chariot.chariotState = CHARIOT_STATE.FLEE;
  frame();
  assert.equal(chariot.chariotState, CHARIOT_STATE.FLEE, "camp ended the hysteresis band");
  assert.equal(chariot.x, chariot.homeX, "a wounded chariot charged out before 40%");

  // Mended past 40% it charges again; caught while broken it latches the last stand.
  chariot.health = 6;
  frame();
  assert.equal(chariot.chariotState, CHARIOT_STATE.CHASE, "a mended enemy chariot did not re-engage");

  chariot.health = 1;
  chariot.chariotState = CHARIOT_STATE.FLEE;
  player.x = chariot.x + 20;
  player.y = chariot.y;
  frame();
  assert.equal(chariot.chariotState, CHARIOT_STATE.FIGHT_TO_DEATH, "a cornered enemy chariot ran");
  chariot.health = chariot.maxHealth;
  frame();
  assert.equal(chariot.chariotState, CHARIOT_STATE.FIGHT_TO_DEATH, "healing undid the last stand");
});


test("the aura heals three points every three seconds, only inside the footprint", () => {
  const extent = formationExtent(formationConfig);
  const formation = {
    id: 7, x: 0, y: 0, heading: 0, halfWidth: extent.halfWidth, halfHeight: extent.halfHeight,
    auraTimer: 0, auraFlash: 0,
  };
  const inside = { formationId: 7, x: 0, y: 0, health: 5, maxHealth: 14 };
  const outside = { formationId: 7, x: 600, y: 600, health: 5, maxHealth: 14 };
  const full = { formationId: 7, x: 10, y: 10, health: 14, maxHealth: 14 };
  const dead = { formationId: 7, x: 0, y: 0, health: 0, maxHealth: 14, destroyed: true };
  const stranger = { formationId: 99, x: 0, y: 0, health: 5, maxHealth: 14 };
  const units = [inside, outside, full, dead, stranger];

  assert.deepEqual(tickFormationAura([formation], units, 2.9), [], "the aura fired before its interval");
  assert.equal(inside.health, 5);

  const healed = tickFormationAura([formation], units, 0.2);
  assert.deepEqual(healed, [inside], "the beat healed the wrong bodies");
  // One beat is a third of a foot body: 5 -> 8 of 14.
  assert.equal(inside.health, 8);
  assert.equal(outside.health, 5, "a body outside the border was healed");
  assert.equal(stranger.health, 5, "another line's unit was healed");
  assert.equal(full.health, 14, "the heal overshot the maximum");
  assert.equal(formation.auraFlash, formationConfig.aura.flash);

  // The remainder is carried, not rounded up: after the 0.1s overshoot the next
  // beat is 2.9s away, not a fresh 3s.
  tickFormationAura([formation], units, 1.4);
  assert.equal(inside.health, 8);
  tickFormationAura([formation], units, 1.5);
  assert.equal(inside.health, 11, "the timer lost the overshoot from the previous beat");
  assert.ok(formation.auraFlash <= formationConfig.aura.flash);
});

test("a full body is not over-healed, and a beat lands on the maximum, not past it", () => {
  const formation = { id: 1, x: 0, y: 0, heading: 0, auraTimer: 0, auraFlash: 0 };
  // A spear is a two-point body: the three-point beat still leaves it at 2.
  const spear = { formationId: 1, x: 4, y: 4, health: 2, maxHealth: 2 };
  const archer = { formationId: 1, x: -4, y: 4, health: 1, maxHealth: 1 };
  const heavy = { formationId: 1, x: 4, y: -4, health: 5, maxHealth: 6 };
  const healed = tickFormationAura([formation], [spear, archer, heavy], 3);
  assert.deepEqual(healed, [heavy], "the beat tried to heal a body that was already full");
  assert.equal(spear.health, 2);
  assert.equal(archer.health, 1);
  assert.equal(heavy.health, 6, "a six-point body was healed past its maximum");
});

test("the aura heals a unit that came home, not one still running", () => {
  const extent = formationExtent(formationConfig);
  const formation = {
    id: -1, x: 0, y: 0, heading: 0, halfWidth: extent.halfWidth, halfHeight: extent.halfHeight,
    auraTimer: 0, auraFlash: 0,
  };
  const running = { formationId: -1, x: 0, y: 400, health: 2, maxHealth: 14 };
  const home = { formationId: -1, x: 10, y: 10, health: 2, maxHealth: 14 };
  const healed = tickFormationAura([formation], [running, home], 3);
  assert.deepEqual(healed, [home]);
  assert.equal(running.health, 2, "a chariot still outside the line was patched up");
});

test("both sides run the same banner beat, and an enemy line heals its own", () => {
  // The ally row points at the shared table instead of keeping a copy.
  assert.equal(formationConfig.aura, formationAura, "the hire kept a private aura table");
  const rig = formationRig();
  const formation = spawnFormationAt(rig, 0);
  assert.equal(formation.auraTimer, 0);
  assert.equal(formation.auraFlash, 0);

  const patient = rig.state.enemies.find((enemy) => enemy.type === "ge");
  const outside = rig.state.enemies.find((enemy) => enemy.type === "spear");
  patient.health = 1;
  outside.health = 1;
  // Far outside the dashed border; it walks home, but not far enough in one beat
  // to step onto the footprint.
  outside.x = formation.x + 600;
  outside.y = formation.y + 600;
  // Nothing in sight: the line stands on its slots and only the banner runs.
  rig.player.x = formation.x + 1200;
  rig.player.y = formation.y + 1200;

  for (let frame = 0; frame < 179; frame += 1) rig.enemies.updateUnits(1 / 60);
  assert.equal(patient.health, 1, "the enemy banner fired before its interval");
  for (let frame = 0; frame < 6; frame += 1) rig.enemies.updateUnits(1 / 60);
  // A ge is a three-point body and the beat is three points: one beat fills it,
  // and the clamp is what keeps it there rather than at four.
  assert.equal(patient.health, 3, "a wounded enemy on its own footprint was not healed");
  assert.ok(patient.healFlash > 0, "the healed enemy body did not glow");
  assert.ok(formation.auraFlash > 0, "the enemy banner did not pulse");
  assert.equal(outside.health, 1, "an enemy outside the border was patched up");
});

test("an enemy chariot heals at its own banner and charges out above 40%", () => {
  const rig = formationRig();
  const formation = spawnFormationAt(rig, 0);
  const chariot = rig.state.enemies.find((enemy) => enemy.type === "chariot");
  chariot.health = 2;
  chariot.chariotState = CHARIOT_STATE.FLEE;
  chariot.x = chariot.homeX;
  chariot.y = chariot.homeY;
  // In plain sight, but far enough that being seen is not being caught.
  const spot = toWorld(formation, 0, -300);
  rig.player.x = spot.x;
  rig.player.y = spot.y;

  // One beat mends it to 5/14 (35.7%), still inside the hysteresis band: it must
  // hold its slot and not charge out.
  for (let frame = 0; frame < 185; frame += 1) rig.enemies.updateUnits(1 / 60);
  assert.equal(chariot.health, 5);
  assert.equal(chariot.chariotState, CHARIOT_STATE.FLEE, "the enemy chariot left camp inside the band");
  assert.equal(chariot.x, chariot.homeX, "a chariot at 35% charged out");

  // The second beat takes it to 8/14 (57%): now it re-engages.
  for (let frame = 0; frame < 185; frame += 1) rig.enemies.updateUnits(1 / 60);
  assert.equal(chariot.health, 8);
  assert.equal(chariot.chariotState, CHARIOT_STATE.CHASE, "a mended enemy chariot did not re-engage");
  assert.notEqual(chariot.x, chariot.homeX, "the re-engaged chariot stayed on its slot");
});


// A ring that is standing still, with no order on it: the plain aura case.
const auraRing = (id = 1) => ({
  id, x: 0, y: 0, heading: 0, halfWidth: 116, halfHeight: 86, auraTimer: 0, auraFlash: 0,
});

test("a friendly ring mends the player standing in it, and only inside the ring", () => {
  const formation = auraRing(-1);
  const player = { x: 0, y: 20, radius: 17, health: 40, maxHealth: 100, healFlash: 0 };
  const healed = tickFormationAura([formation], [], 3, formationAura, { friends: [player] });
  assert.deepEqual(healed, [player], "the player was not mended by his own line");
  assert.equal(player.health, 43);
  assert.ok(player.healFlash > 0, "the mended player did not glow");
  // The footprint is the whole rule: outside the dashed border, nothing.
  player.x = 900;
  player.y = 900;
  tickFormationAura([formation], [], 3, formationAura, { friends: [player] });
  assert.equal(player.health, 43, "the player was mended from outside the ring");
  // The glow decays on him as well, because nothing else ticks it.
  assert.equal(player.healFlash, 0, "the player's glow outlived the beat");
});

test("an enemy inside the ring stops the beat, and the beat returns when it leaves", () => {
  const formation = auraRing(3);
  const patient = { formationId: 3, x: 10, y: -10, health: 5, maxHealth: 14 };
  const intruder = { x: 40, y: 30, radius: 14, destroyed: false };
  const blocked = tickFormationAura([formation], [patient], 3, formationAura, { intruders: [intruder] });
  assert.deepEqual(blocked, [], "a stepped-on banner healed anyway");
  assert.equal(patient.health, 5);
  assert.equal(formation.auraFlash, 0, "a stepped-on banner still pulsed");
  // The phase was kept, so the dirty beat is *spent* rather than banked and
  // rather than refunded: once the ground is clear the line waits out the rest
  // of a normal interval instead of getting the lost heal straight back.
  intruder.x = 900;
  intruder.y = 900;
  tickFormationAura([formation], [patient], 3, formationAura, { intruders: [intruder] });
  assert.equal(patient.health, 8, "the beat did not come back when the ground cleared");
  // A body that has already fallen is not standing on anything.
  const corpse = { x: 10, y: 10, radius: 14, destroyed: true };
  patient.health = 5;
  tickFormationAura([formation], [patient], 3, formationAura, { intruders: [corpse] });
  assert.equal(patient.health, 8, "a corpse was counted as an intruder");
});

test("the player is an intruder in an enemy ring, never one of its patients", () => {
  const formation = auraRing(5);
  const enemy = { formationId: 5, x: -10, y: 10, health: 2, maxHealth: 14 };
  const player = { x: 0, y: 0, radius: 17, health: 40, maxHealth: 100, healFlash: 0 };
  tickFormationAura([formation], [enemy], 3, formationAura, { intruders: [player], friends: [] });
  assert.equal(enemy.health, 2, "an enemy line healed under the player's hull");
  assert.equal(player.health, 40, "an enemy line healed the player");
  player.x = 900;
  player.y = 900;
  tickFormationAura([formation], [enemy], 3, formationAura, { intruders: [player], friends: [] });
  assert.equal(enemy.health, 5, "the enemy beat did not come back once he stepped out");
  assert.equal(player.health, 40, "an enemy banner mended the player standing outside it");
});

test("a marching line spends its beat on the move and heals nobody", () => {
  const formation = { ...auraRing(9), order: formationOrders.MARCH };
  const patient = { formationId: 9, x: 10, y: 10, health: 5, maxHealth: 14 };
  assert.deepEqual(tickFormationAura([formation], [patient], 2.9), []);
  assert.equal(patient.health, 5);
  assert.deepEqual(tickFormationAura([formation], [patient], 0.2), [], "a marching line healed");
  assert.equal(patient.health, 5);
  assert.equal(formation.auraFlash, 0, "a marching banner pulsed");
  // The beat was due and spent. Being set down must not buy a free one: the next
  // beat is 2.9s away, exactly as it would have been.
  formation.order = formationOrders.HOLD;
  tickFormationAura([formation], [patient], 1.4);
  assert.equal(patient.health, 5, "a line that halted early got a beat it had already spent");
  tickFormationAura([formation], [patient], 1.5);
  assert.equal(patient.health, 8, "the phase restarted when the line halted");
});

test("a loose chariot is one that left the border the player can see", () => {
  const line = { id: 4, x: 0, y: 0, heading: 0, halfWidth: 116, halfHeight: 86 };
  const inside = { vehicle: true, formationId: 4, x: 20, y: 20 };
  const outside = { vehicle: true, formationId: 4, x: 400, y: 20 };
  const orphan = { vehicle: true, x: 20, y: 20 };
  assert.equal(isLooseChariot(inside, [line]), false);
  assert.equal(isLooseChariot(outside, [line]), true);
  assert.equal(isLooseChariot(orphan, [line]), true, "a rider without a line is loose");
  assert.equal(isLooseChariot({ vehicle: false, formationId: 4, x: 400, y: 20 }, [line]), false);
  assert.equal(isLooseChariot({ vehicle: true, formationId: 4, x: 400, y: 20, destroyed: true }, [line]), false);
});

test("an enemy line wakes for a hired ally as well as for the player", () => {
  const line = { id: 1, x: 0, y: 0, heading: 0, halfWidth: 116, halfHeight: 86, alerted: false };
  const player = { x: 900, y: 900 };
  const ally = { x: 10, y: 10 };
  updateFormationAlerts([line], [], player);
  assert.equal(line.alerted, false);
  updateFormationAlerts([line], [], [player, ally]);
  assert.equal(line.alerted, true, "the line ignored a hired body on its ground");
  // With no living body on the line's ground it stands down; a destroyed body
  // cannot hold a formation awake.
  updateFormationAlerts([line], [], [player, { ...ally, destroyed: true }]);
  assert.equal(line.alerted, false);
});

test("a spear answers an enemy at its weapon's reach", () => {
  const rig = hireRig({ hires: 1 });
  rig.allies.spawnFriendlyFormations();
  const spear = rig.state.allies.find((ally) => ally.type === "spear");
  const enemy = {
    type: "archer", x: spear.x + spear.range - 4, y: spear.y, radius: 12, health: 10, destroyed: false,
  };
  rig.state.enemies.push(enemy);
  spear.attackCooldown = 0;
  rig.allies.update(1 / 60);
  assert.equal(enemy.health, 10 - spear.damage, "the spear did not swing at an enemy in reach");
  assert.equal(rig.state.meleeEffects.length, 1, "the swing drew no effect");
  assert.ok(spear.attackCooldown > 0, "the spear swung twice in one frame");
});

test("a line with nobody near it walks back to its slots and stays put", () => {
  const rig = hireRig({ hires: 1 });
  rig.allies.spawnFriendlyFormations();
  const spear = rig.state.allies.find((ally) => ally.type === "spear");
  const home = { x: spear.homeX, y: spear.homeY };
  spear.x += 60;
  for (let frame = 0; frame < 240; frame += 1) rig.allies.update(1 / 60);
  assert.ok(Math.hypot(spear.x - home.x, spear.y - home.y) < 11, "the ally did not return to its slot");
  assert.ok(Math.abs(spear.angle - spear.homeAngle) < 1e-6, "the idle line stopped facing its front");
});

test("the chariot really runs from a loose rider and re-joins when mended", () => {
  const rig = hireRig({ hires: 1 });
  rig.allies.spawnFriendlyFormations();
  const chariot = rig.state.allies.find((ally) => ally.vehicle);
  const line = rig.state.allyFormations[0];
  // A loose enemy chariot on the line's own ground is the target the FSM exists
  // for; it is not inside any enemy formation, so `isLooseChariot` sees it.
  const rider = {
    type: "chariot", vehicle: true, x: line.x + 90, y: line.y, radius: 21, health: 14, destroyed: false,
    formationId: 9999,
  };
  rig.state.enemies.push(rider);

  // Out on the field, badly hurt: the next thought is FLEE, and the step goes
  // back towards the slot instead of at the enemy.
  chariot.health = 2;
  chariot.x = line.x + 200;
  chariot.y = line.y;
  chariot.chariotState = "HOLD";
  const away = Math.hypot(chariot.x - chariot.homeX, chariot.y - chariot.homeY);
  rig.allies.update(0.1);
  assert.equal(chariot.chariotState, "FLEE", "a broken chariot did not switch to FLEE");
  const closer = Math.hypot(chariot.x - chariot.homeX, chariot.y - chariot.homeY);
  assert.ok(closer < away, "a fleeing chariot did not run home");

  // Back on its slot at 21% it stays disengaged: reaching camp does not end the
  // band, only healing past 40% does.
  chariot.health = 3;
  chariot.x = chariot.homeX;
  chariot.y = chariot.homeY;
  chariot.chariotState = "FLEE";
  rig.allies.update(0.1);
  assert.equal(chariot.chariotState, "FLEE", "healing at camp ended the hysteresis band");
  assert.ok(Math.hypot(chariot.x - chariot.homeX, chariot.y - chariot.homeY) < 1,
    "a camped wounded chariot charged out before 40%");

  // Mended above 40% and back in the line, a loose rider is worth chasing again.
  chariot.health = chariot.maxHealth;
  chariot.x = chariot.homeX;
  chariot.y = chariot.homeY;
  chariot.chariotState = "HOLD";
  rig.allies.update(0.1);
  assert.equal(chariot.chariotState, "CHASE", "a mended chariot did not re-engage a loose rider");
});

test("damage to a hire stains the ground, and the last point kills it", () => {
  const rig = hireRig({ hires: 1 });
  rig.allies.spawnFriendlyFormations();
  const archer = rig.state.allies.find((ally) => ally.type === "archer");
  rig.allies.damageAlly(archer, 1, archer.x - 20, archer.y);
  assert.equal(archer.destroyed, true, "an archer with 1 HP survived a hit");
  assert.equal(rig.state.bloodStains.length, 1, "a hire died without a stain");
  assert.ok(rig.state.shake > 0, "a hire died without a shake");
  rig.allies.update(1 / 60);
  assert.equal(rig.state.allies.includes(archer), false, "the corpse stayed in the line");
  assert.ok(rig.state.allyFormations[0], "one fallen archer removed the whole line");
});

test("the order button acts on the nearest own line the player stands in", () => {
  const rig = hireRig({ hires: 2 });
  const lines = rig.allies.spawnFriendlyFormations();
  const [first] = lines;
  // Nowhere near a line: nothing to order, and the button would be hidden.
  rig.player.x = 20;
  rig.player.y = 20;
  assert.equal(formationUnder(lines, rig.player), null);
  assert.equal(toggleOrder({
    formations: lines, members: rig.state.allies, leader: rig.player, owner: "player",
  }), null);
  // Standing in his own line: that line, and only through the flag it carries.
  rig.player.x = first.x;
  rig.player.y = first.y;
  assert.equal(formationUnder(lines, rig.player), first);
  assert.equal(commandedFormation(lines, rig.player, "player"), first);
  assert.equal(commandedFormation(lines, rig.player, "enemy"), null,
    "a rival flag commanded the player's line");
  // A rival commander is refused, and the line is left exactly as it was.
  assert.equal(issueOrder({
    formations: lines, members: rig.state.allies, leader: rig.player, owner: "enemy", action: ORDER_ACTION.march,
  }), null);
  assert.equal(first.order, formationOrders.HOLD, "a rival commander moved the player's line");
  assert.equal(applyOrder({
    formation: first, members: rig.state.allies, leader: rig.player, action: "retreat",
  }), null, "an unknown action was applied");
  // The per-frame pass walks only the lines that still have a body on them, and
  // reports which ones it staffed - an emptied line is left exactly as it is.
  assert.equal(advanceOrders({
    formations: lines, members: rig.state.allies, leader: rig.player,
  }).length, 2);
  for (const ally of rig.state.allies.filter((member) => member.formationId === lines[1].id)) {
    ally.destroyed = true;
  }
  assert.deepEqual(advanceOrders({ formations: lines, members: rig.state.allies, leader: rig.player }), [first]);
});

test("出击 glues the ring to the chariot; 结阵 sets it down and sends the stragglers home", () => {
  const rig = hireRig({ hires: 1 });
  const [line] = rig.allies.spawnFriendlyFormations();
  const spear = rig.state.allies.find((ally) => ally.type === "spear");
  const order = (action) => issueOrder({
    formations: rig.state.allyFormations, members: rig.state.allies, leader: rig.player, owner: "player", action,
  });
  assert.equal(line.order, formationOrders.HOLD);
  assert.equal(line.owner, "player");
  rig.player.x = line.x;
  rig.player.y = line.y;

  // 出击: the line is under way, and it is rigidly attached to the chariot.
  assert.equal(order(ORDER_ACTION.march).action, ORDER_ACTION.march);
  assert.equal(line.order, formationOrders.MARCH);
  // One frame settles the ring onto the chariot: it was pitched at a spawn
  // centre, and 出击 attaches it to the leader from this frame on.
  rig.allies.update(1 / 60);
  const station = { x: spear.homeX, y: spear.homeY };
  rig.player.x += 240;
  rig.player.y -= 90;
  rig.allies.update(1 / 60);
  assert.ok(Math.abs(spear.homeX - station.x - 240) < 1e-6, "a slot did not travel with the line");
  assert.ok(Math.abs(spear.homeY - station.y + 90) < 1e-6, "a slot did not travel with the line");
  // He stays at the same spot in his own ring, which is what keeps the button
  // under his thumb while the line is out.
  assert.equal(isInsideFormation(line, rig.player.x, rig.player.y), true,
    "the line marched out from under the player");

  // 结阵: the ring lands around him, front facing the way he faces.
  rig.player.angle = Math.PI / 2;
  assert.equal(order(ORDER_ACTION.hold).action, ORDER_ACTION.hold);
  assert.equal(line.order, formationOrders.HOLD);
  const front = { x: Math.sin(line.heading), y: -Math.cos(line.heading) };
  assert.ok(Math.abs(front.x - Math.cos(rig.player.angle)) < 1e-9, "the line did not face where he faces");
  assert.ok(Math.abs(front.y - Math.sin(rig.player.angle)) < 1e-9, "the line did not face where he faces");
  // The ring's centre sits back from his hull: the centre slot is the line's own
  // chariot, and two vehicles in one pixel is not a formation.
  assert.ok(Math.hypot(line.x - rig.player.x, line.y - rig.player.y) > rig.player.radius,
    "the ring was centred on the player's own hull");
  assert.equal(isInsideFormation(line, rig.player.x, rig.player.y), true, "he ended up outside his own ring");
  // Every body that was left behind is walking back, and the line counts them.
  assert.ok(spear.returning, "a body left behind was not told to come home");
  assert.equal(line.stragglers, rig.state.allies.length, "the line did not count its stragglers");

  // They run rather than re-form on the spot: the flag clears on arrival, and
  // the count follows it down. Nothing else has to end the state. The spear is
  // the first to arrive, so the loop waits for the slowest body, not for it.
  for (let frame = 0; frame < 900 && rig.state.allies.some((ally) => ally.returning); frame += 1) {
    rig.allies.update(1 / 60);
  }
  assert.equal(rig.state.allies.every((ally) => ally.returning === false), true,
    "a straggler never reached its station");
  assert.ok(Math.hypot(spear.x - spear.homeX, spear.y - spear.homeY)
    <= formationConfig.engage.homeEpsilon + 1, "a body that came home is not standing on its slot");
  rig.allies.update(1 / 60);
  assert.equal(line.stragglers, 0, "the line still counts a body that came home");
});

test("the camp pitches one tent per hire, and a hover stays a preview", () => {
  const rect = { x: 0, y: 0, width: 320, height: 128 };
  const campFor = (model) => drawCamp(recordingContext().context, rect, { crew: [], ...model });
  // A hire is legible at the fire even though the battlefield it fights on is never
  // shown in the shop: one tent per bought line.
  assert.equal(campFor({ campTents: 1 }).formations, 1, "one hire pitched no tent");
  assert.equal(campFor({ campTents: 2 }).formations, 2, "the second hire pitched no tent");
  // The camp has two spots, so a tent count from anywhere else cannot invent a
  // third one - which is what the shop's hover does once the cap is reached.
  assert.equal(campFor({ campTents: 9 }).formations, 2, "the camp pitched tents there was no room for");

  // A recruit preview is one extra body round the fire, and a buried companion is
  // no body at all: the roster is the campaign's, and the camp reads it as such.
  assert.equal(campFor({ crew: [{ role: "archer" }] }).seats, 2, "the player and his archer did not sit down");
  assert.equal(campFor({ crew: [{ role: "archer" }, { role: "halberdier", alive: false }] }).seats, 2,
    "a buried companion still sat at the fire");
  // The shop hands the camp the roster it would have after the recruit joins, and
  // names him so the fire can mark him as unpaid: he sits, he is drawn faded, and
  // he carries one dashed green ring instead of the player's gold one.
  const owned = drawLog();
  drawCamp(owned.context, rect, { crew: [{ role: "archer" }], campTents: 0 });
  const logged = (log, name, args) => log.calls.some((call) => call.name === name
    && (args === undefined || JSON.stringify(call.args) === JSON.stringify(args)));
  assert.equal(logged(owned, "set:globalAlpha", [0.72]), false, "the owned camp faded a figure it owns");
  assert.equal(logged(owned, "setLineDash", [[2.5, 2.5]]), false, "the owned camp rang a figure as unpaid");

  const hovered = drawLog();
  const hoveredCamp = drawCamp(hovered.context, rect, {
    crew: [{ role: "archer" }, { role: "halberdier" }], previewRole: "halberdier", campTents: 1,
  });
  assert.equal(hoveredCamp.seats, 3, "a hovered recruit did not pull up a seat");
  assert.equal(hoveredCamp.previewSeat, true);
  assert.equal(logged(hovered, "set:globalAlpha", [0.72]), true, "the hovered recruit was not drawn as a preview");
  assert.equal(logged(hovered, "setLineDash", [[2.5, 2.5]]), true, "the hovered recruit got no dashed ring");
  assert.equal(campFor({ crew: [{ role: "archer" }] }).previewSeat, false,
    "the owned camp was painted as a preview");
});



console.log("[unit] the map check");

// Every battlefield is rolled whole and then accepted or rejected by the
// scenario's own check (see createBattlefield). The campaign passes none, which
// is what keeps a `?seed=` run byte-identical; a scenario that promises something
// about the ground passes one, and this is the plumbing that re-rolls for it.
test("a battlefield with no check is exactly the roll it always was", () => {
  const plain = createBattlefield(createSeededRandom(21), { x: 0, y: 0, radius: 17 }, battlefieldWorld, () => false);
  const explicitNull = createBattlefield(
    createSeededRandom(21), { x: 0, y: 0, radius: 17 }, battlefieldWorld, () => false, null, null,
  );
  assert.deepEqual(explicitNull, plain, "an explicit null check changed the campaign's map");
});

test("a field that fails its check is rolled again instead of trimmed", () => {
  let rolls = 0;
  const field = createBattlefield(
    createSeededRandom(21), { x: 0, y: 0, radius: 17 }, battlefieldWorld, () => false, null,
    () => { rolls += 1; return rolls === 3; },
  );
  assert.equal(rolls, 3, "the check was not given a second and third roll");
  assert.equal(field.obstacles.length, elementRules.obstacleTarget,
    "a rejected roll left the field short of elements");
});

test("a check that never passes still hands back a whole field", () => {
  let rolls = 0;
  const field = createBattlefield(
    createSeededRandom(4), { x: 0, y: 0, radius: 17 }, battlefieldWorld, () => false, null,
    () => { rolls += 1; return false; },
  );
  assert.ok(rolls > 1, "the check was consulted once and ignored");
  assert.equal(field.obstacles.length, elementRules.obstacleTarget, "the give-up field is bare");
  assert.equal(field.clouds.length, cloudKinds.sky.count, "the give-up field lost its sky");
});

console.log("[unit] reachability");

const reachWorld = { width: 1200, height: 900 };
const reachFrom = { x: 150, y: 450 };
const reachTo = { x: 1050, y: 450 };
const wallAt = (x, y, width, height) => ({ type: "wall", x, y, width, height });

// The generator's own question, asked the way it asks it: build the fill once
// from the start with the goal always walkable, then read the goal's cell.
const pathIsClear = ({ from, to, world, obstacles, radius, cell }) =>
  buildWalkMap({ from, goal: to, world, obstacles, radius, cell }).reachable(to);

test("an empty field is a clear path and needs no grid", () => {
  assert.equal(pathIsClear({ from: reachFrom, to: reachTo, world: reachWorld, obstacles: [], radius: 17 }), true);
});

test("a palisade across the field separates the two points", () => {
  const closed = [wallAt(560, 0, 80, reachWorld.height)];
  assert.equal(pathIsClear({ from: reachFrom, to: reachTo, world: reachWorld, obstacles: closed, radius: 17 }), false,
    "a wall across the whole field still read as walkable");
});

test("a gap in the same wall opens the path again", () => {
  const gapped = [wallAt(560, 0, 80, 300), wallAt(560, 600, 80, 300)];
  assert.equal(pathIsClear({ from: reachFrom, to: reachTo, world: reachWorld, obstacles: gapped, radius: 17 }), true,
    "the flood fill did not find the gap");
});

test("one tree in an open field is walked around, not through", () => {
  const obstacles = [{ type: "tree", x: 600, y: 450, radius: 30 }];
  assert.equal(pathIsClear({ from: reachFrom, to: reachTo, world: reachWorld, obstacles, radius: 17 }), true);
});

console.log("[unit] the tiger drill's ground");

const drillWorld = battlefieldWorld;
const drillSpawn = { x: drillWorld.width / 2, y: drillWorld.height / 2 };
const drillIntersects = (x, y, radius, obstacles = []) => obstacles.some(
  (obstacle) => elementIntersects(x, y, radius, obstacle),
);

test("the tiger stands where the layout says, from the spawn point", () => {
  const tiger = planTigerGround(drillWorld, drillSpawn);
  const span = Math.hypot(tiger.x - drillSpawn.x, tiger.y - drillSpawn.y);
  assert.ok(Math.abs(span - TUTORIAL_LAYOUT.tiger.distance) < 1,
    `the tiger moved to ${span.toFixed(1)}px from the spawn`);
  // Pure: the map check and the spawn both ask this, and they must agree.
  assert.deepEqual(planTigerGround(drillWorld, drillSpawn), tiger);
});

test("the line stands at the preferred bearing on open ground, off screen", () => {
  const spot = findLineGround(drillSpawn, { world: drillWorld, obstacles: [] });
  const span = Math.hypot(spot.x - drillSpawn.x, spot.y - drillSpawn.y);
  assert.ok(Math.abs(span - TUTORIAL_LAYOUT.line.distance) < 1, `the line stood ${span.toFixed(1)}px off`);
  assert.equal(spot.clear, true, "open ground was not read as clear");
  // The preferred ground is the first rung of the ladder, and it has to start
  // outside the 960x592 view or the pan that reveals it is not a reveal.
  assert.equal(TUTORIAL_LAYOUT.line.distance, LINE_DISTANCES[0]);
  assert.ok(Math.abs(spot.x - drillSpawn.x) > 960 / 2, "the line starts on screen");
  assert.ok(Math.abs(spot.y - drillSpawn.y) > 592 / 2, "the line starts on screen");
  // The line faces the chariot it was summoned against.
  assert.equal(spot.heading, Math.atan2(drillSpawn.y - spot.y, drillSpawn.x - spot.x));
  // A pure function of the standing place and the field: no random numbers in it.
  assert.deepEqual(findLineGround(drillSpawn, { world: drillWorld, obstacles: [] }), spot);
});

test("the line is placed against wherever the chariot is standing now", () => {
  // The animal runs, so the player is rarely where they started: each standing
  // place gets its own line, at the authored distance from *it*.
  const origins = [
    drillSpawn,
    { x: drillSpawn.x + 420, y: drillSpawn.y - 300 },
    { x: drillSpawn.x - 520, y: drillSpawn.y + 260 },
  ];
  const spots = origins.map((origin) => findLineGround(origin, { world: drillWorld, obstacles: [] }));
  for (const [index, spot] of spots.entries()) {
    const origin = origins[index];
    const span = Math.hypot(spot.x - origin.x, spot.y - origin.y);
    assert.ok(Math.abs(span - TUTORIAL_LAYOUT.line.distance) < 1,
      `from (${origin.x}, ${origin.y}) the line stood ${span.toFixed(1)}px off`);
    assert.equal(spot.heading, Math.atan2(origin.y - spot.y, origin.x - spot.x),
      "the line did not face the chariot that summoned it");
  }
  assert.notDeepEqual(spots[1], spots[2], "two standing places 800px apart got the same line");
  const drift = Math.hypot(spots[1].x - spots[0].x, spots[1].y - spots[0].y);
  assert.ok(drift > 200, `the line only moved ${drift.toFixed(1)}px after the player drove 500`);
});

test("a blocked preferred spot is stepped over, never closer than the ladder's floor", () => {
  const preferred = findLineGround(drillSpawn, { world: drillWorld, obstacles: [] });
  const { halfWidth, halfHeight } = lineGroundExtent();
  // A palisade right on the preferred ground, and nothing else.
  const obstacles = [wallAt(preferred.x - 130, preferred.y - 130, 260, 260)];
  const stepped = findLineGround(drillSpawn, { world: drillWorld, obstacles });
  assert.equal(stepped.clear, true, "the search gave up on a field with one wall in it");
  assert.equal(
    rectHitsAnyObstacle(stepped.x, stepped.y, halfWidth, halfHeight, stepped.heading, obstacles),
    false,
    "the line was stood in the palisade it was supposed to step around",
  );
  assert.notDeepEqual(stepped, preferred, "the line did not move off the blocked ground");
  const span = Math.hypot(stepped.x - drillSpawn.x, stepped.y - drillSpawn.y);
  assert.ok(span >= LINE_DISTANCES[LINE_DISTANCES.length - 1] - 1,
    `the line fell back to ${span.toFixed(1)}px, nearer than the ladder allows`);
});

test("in a corner the line is only ever stood on ground that fits the world", () => {
  const { halfWidth, halfHeight } = lineGroundExtent();
  const spot = findLineGround({ x: 60, y: 60 }, { world: drillWorld, obstacles: [] });
  const reach = Math.hypot(halfWidth, halfHeight);
  assert.ok(spot.x - reach >= 0 && spot.x + reach <= drillWorld.width,
    `the line's footprint runs off the field at x=${spot.x.toFixed(1)}`);
  assert.ok(spot.y - reach >= 0 && spot.y + reach <= drillWorld.height,
    `the line's footprint runs off the field at y=${spot.y.toFixed(1)}`);
  assert.equal(spot.clear, true, "a corner with room was refused");
});

test("a field with nowhere clear to stand still gets a line", () => {
  // The drill must never soft-lock: with a wall over every rung of the ladder the
  // search reports clear=false, and the caller stands the line there anyway.
  const obstacles = [wallAt(0, 0, drillWorld.width, drillWorld.height)];
  const spot = findLineGround(drillSpawn, { world: drillWorld, obstacles });
  assert.equal(spot.clear, false, "a walled-in field was reported as clear");
  assert.ok(Number.isFinite(spot.x) && Number.isFinite(spot.y), "the search returned no ground at all");
});

test("the check wants a clear, reachable tiger and room for the line from anywhere", () => {
  const check = createTutorialMapCheck({
    world: drillWorld, spawn: drillSpawn, circleIntersectsObstacle: drillIntersects,
  });
  const tiger = planTigerGround(drillWorld, drillSpawn);
  assert.equal(check({ obstacles: [] }), true, "an empty field was refused");
  assert.equal(check({ obstacles: [wallAt(tiger.x - 40, tiger.y - 40, 80, 80)] }), false,
    "the tiger's own ground was not checked");
  // A palisade on the preferred line ground is not a refusal any more: the line is
  // placed when the tiger dies, and the search steps around a wall.
  const preferred = findLineGround(drillSpawn, { world: drillWorld, obstacles: [] });
  assert.equal(check({ obstacles: [wallAt(preferred.x - 60, preferred.y - 60, 120, 120)] }), true,
    "one wall on the preferred ground was treated as unreplayable");
  // A wall sealing the spawn off from the tiger.
  const sealX = (drillSpawn.x + tiger.x) / 2;
  assert.equal(check({ obstacles: [wallAt(sealX - 60, 0, 120, drillWorld.height)] }), false,
    "a sealed-off tiger was accepted");
});

test("a field too small to hold the line anywhere is refused", () => {
  // Every rung of the ladder is 420px or more out and the line's footprint needs a
  // 150px circumradius: a 700x700 field has nowhere to put it, from anywhere.
  const cramped = { width: 700, height: 700 };
  const check = createTutorialMapCheck({
    world: cramped, spawn: { x: 350, y: 350 }, circleIntersectsObstacle: drillIntersects,
  });
  assert.equal(check({ obstacles: [] }), false, "a field with no room for the line was accepted");
});

test("a real battlefield can always satisfy the drill's check", () => {
  const check = createTutorialMapCheck({
    world: drillWorld, spawn: drillSpawn, circleIntersectsObstacle: drillIntersects,
  });
  for (let seed = 1; seed <= 12; seed += 1) {
    const field = createBattlefield(
      createSeededRandom(seed), { x: 0, y: 0, radius: 17 }, drillWorld, drillIntersects,
      battlefields[0].mix, check,
    );
    assert.equal(check(field), true, `seed ${seed} came back unsatisfied`);
  }
});

console.log("[unit] the tiger drill");

function drillRig({ seed = 5 } = {}) {
  const rig = formationRig({ seed });
  rig.state.battleMode = "tutorial";
  rig.state.battleId = 7;
  rig.state.tutorial = null;
  rig.state.cameraFocus = null;
  rig.campaign.tutorialHandoff = false;
  let hudCalls = 0;
  const tutorial = createTutorial({
    state: rig.state,
    player: rig.player,
    world: rig.world,
    campaign: rig.campaign,
    enemySystem: rig.enemies,
    updateHud: () => { hudCalls += 1; },
  });
  return { ...rig, tutorial, hudCalls: () => hudCalls };
}

test("the drill opens frozen, with one wild animal on the field", () => {
  const rig = drillRig();
  rig.tutorial.arm();
  const tutorial = rig.state.tutorial;
  assert.equal(tutorial.step, "brief");
  assert.equal(tutorial.frozen, true, "the brief is not a pause");
  assert.ok(tutorial.overlay, "the brief has no card");
  assert.equal(rig.state.formations.length, 0, "the drill rolled a campaign wave");
  assert.equal(rig.state.wilds.length, 1);
  assert.equal(rig.state.enemies.length, 1, "the tiger never reached the battlefield");
  const tiger = rig.state.wilds[0];
  assert.equal(tiger.species, wildAnimalStats.tiger.species);
  assert.equal(tiger.loot, "meat");
  assert.equal(tiger.health, tiger.maxHealth);
  assert.equal(tiger.formationId, undefined, "the animal joined a formation");
  // The HUD is told what to count before the player can move.
  assert.equal(tutorial.hud.total, 1);
  assert.equal(tutorial.hud.labelKey, "tutorial.huntLabel");
});

test("re-entering the battle does not spawn a second tiger", () => {
  const rig = drillRig();
  rig.tutorial.arm();
  const tiger = rig.state.tutorial.tiger;
  // A pause dismissed, a locale switch, a tab regaining focus: all of them
  // re-enter "running" and all of them call arm() again.
  rig.tutorial.arm();
  assert.equal(rig.state.wilds.length, 1, "a second tiger was spawned");
  assert.equal(rig.state.tutorial.tiger, tiger);
  // Even once the script has finished, the same battle stays finished.
  rig.state.tutorial = null;
  rig.tutorial.arm();
  assert.equal(rig.state.wilds.length, 1, "the drill restarted itself inside one battle");
  assert.equal(rig.state.tutorial, null, "the cleared drill was re-armed");
});

test("confirming the brief hands the field over with the arrow on the tiger", () => {
  const rig = drillRig();
  rig.tutorial.arm();
  const tiger = rig.state.wilds[0];
  rig.tutorial.confirm();
  const tutorial = rig.state.tutorial;
  assert.equal(tutorial.step, "hunt");
  assert.equal(tutorial.frozen, false, "the card is still holding the field");
  assert.equal(tutorial.overlay, null);
  assert.deepEqual(tutorial.objective, { x: tiger.x, y: tiger.y });
  // And it keeps following the animal, not the ground it spawned on.
  tiger.x += 40;
  rig.tutorial.update(1 / 60);
  assert.equal(tutorial.objective.x, tiger.x, "the arrow stayed on the old spot");
});

test("a wild animal charges whatever is nearest and bites the hull", () => {
  const rig = drillRig();
  rig.tutorial.arm();
  rig.tutorial.confirm();
  const tiger = rig.state.wilds[0];
  // Park the animal inside its own reach: the brain spends its cool-down bite.
  tiger.x = rig.player.x + 30;
  tiger.y = rig.player.y;
  tiger.homeX = tiger.x;
  tiger.homeY = tiger.y;
  tiger.attackCooldown = 0;
  for (let frame = 0; frame < 200; frame += 1) rig.enemies.updateUnits(1 / 60);
  assert.ok(rig.hits.length > 0, "the tiger never bit the hull");
  assert.equal(rig.hits.every((amount) => amount === wildAnimalStats.tiger.damage), true,
    `the animal dealt ${rig.hits.join("/")} instead of its row's damage`);
});

test("two animals of the same species ignore each other", () => {
  const rig = drillRig();
  // Two tigers shoulder to shoulder, the player far out of sight: with no species
  // rule each animal's nearest target is its neighbour.
  const first = rig.enemies.spawnWildAnimal("tiger", { x: 600, y: 600 });
  const second = rig.enemies.spawnWildAnimal("tiger", { x: 630, y: 600 });
  rig.player.x = 3200;
  rig.player.y = 2400;
  for (let frame = 0; frame < 200; frame += 1) rig.enemies.updateUnits(1 / 60);
  assert.equal(first.health, first.maxHealth, "a tiger bit another tiger");
  assert.equal(second.health, second.maxHealth, "a tiger bit another tiger");
  assert.equal(rig.hits.length, 0, "an animal reached the player from across the field");
});

test("a line of soldiers fights the tiger and the tiger fights back", () => {
  const rig = drillRig();
  const tiger = rig.enemies.spawnWildAnimal("tiger", { x: 600, y: 600 });
  const formation = rig.enemies.spawnPreset("tutorialLine", { x: 610, y: 660, heading: 0 });
  assert.equal(rig.state.formations.length, 1, "the preset spawned no line");
  assert.equal(formation.id, "preset-tutorialLine");
  assert.equal(formation.groundTier, "dry", "a preset claimed a spawn tier it never searched");
  assert.equal(rig.state.enemies.length, 10, "the line is nine ranks plus the animal");
  for (let frame = 0; frame < 120; frame += 1) rig.enemies.updateUnits(1 / 60);
  assert.ok(tiger.destroyed || tiger.health < tiger.maxHealth, "the line never touched the animal");
});

test("the drill pans to the line, holds the field, and hands it back", () => {
  const rig = drillRig();
  rig.tutorial.arm();
  rig.tutorial.confirm();
  const tiger = rig.state.wilds[0];

  rig.enemies.damageEnemy(tiger, 999);
  rig.tutorial.update(1 / 60);
  let tutorial = rig.state.tutorial;
  assert.equal(tutorial.step, "pan", `the animal's death left the drill at ${tutorial.step}`);
  assert.equal(tutorial.frozen, true, "the pan is not a pause");
  assert.equal(tutorial.line.length, 9, `the line formed with ${tutorial.line.length} bodies`);
  const lineSpot = tutorial.lineSpot;
  assert.deepEqual(rig.state.cameraFocus, { x: lineSpot.x, y: lineSpot.y });
  assert.equal(tutorial.objective, null, "the arrow was left on a dead animal");

  rig.tutorial.update(2);
  tutorial = rig.state.tutorial;
  assert.equal(tutorial.step, "tactics");
  assert.ok(tutorial.overlay, "the tactics card never appeared");
  assert.equal(tutorial.overlay.bodyKeys.length, 3, "the tactics card lost a beat");
  assert.equal(tutorial.frozen, true);

  rig.tutorial.confirm();
  tutorial = rig.state.tutorial;
  assert.equal(tutorial.step, "return");
  assert.equal(rig.state.cameraFocus, null, "the camera was left on the line");
  assert.equal(tutorial.frozen, true, "the camera walk is not a pause");

  rig.tutorial.update(2);
  tutorial = rig.state.tutorial;
  assert.equal(tutorial.step, "engage");
  assert.equal(tutorial.frozen, false);
  // The arrow starts on the middle of the line and follows it as the ranks fall.
  const living = tutorial.line.filter((unit) => !unit.destroyed);
  const centroid = {
    x: living.reduce((sum, unit) => sum + unit.x, 0) / living.length,
    y: living.reduce((sum, unit) => sum + unit.y, 0) / living.length,
  };
  assert.deepEqual(tutorial.objective, centroid);

  // The last body of the line is the trigger, and it is what hands the run on.
  for (const unit of tutorial.line) rig.enemies.damageEnemy(unit, 999);
  rig.tutorial.update(1 / 60);
  assert.equal(rig.state.tutorial, null, "the drill never finished");
  assert.equal(rig.campaign.tutorialHandoff, true, "the cleared drill did not hand the run on");
});

test("the line forms around the chariot's live position, not its spawn corner", () => {
  const rig = drillRig();
  rig.tutorial.arm();
  rig.tutorial.confirm();
  // Off across the field, the way a player who chased the animal would be.
  rig.player.x = 900;
  rig.player.y = 700;
  rig.enemies.damageEnemy(rig.state.wilds[0], 999);
  rig.tutorial.update(1 / 60);

  const tutorial = rig.state.tutorial;
  assert.equal(tutorial.step, "pan");
  const span = Math.hypot(tutorial.lineSpot.x - rig.player.x, tutorial.lineSpot.y - rig.player.y);
  assert.ok(Math.abs(span - TUTORIAL_LAYOUT.line.distance) < 1,
    `the line formed ${span.toFixed(1)}px from the chariot`);
  // The old behaviour put it at a fixed offset from the spawn point; a player who
  // drove away from that corner must not be panned back to it.
  const spawn = { x: rig.world.width / 2, y: rig.world.height / 2 };
  const fromSpawn = Math.hypot(tutorial.lineSpot.x - spawn.x, tutorial.lineSpot.y - spawn.y);
  assert.ok(fromSpawn > 400, `the line formed ${fromSpawn.toFixed(1)}px from the spawn corner it was not asked about`);
  // The camera goes where the line went, and so does the formation on the field.
  assert.deepEqual(rig.state.cameraFocus, { x: tutorial.lineSpot.x, y: tutorial.lineSpot.y });
  assert.deepEqual(
    { x: tutorial.formation.x, y: tutorial.formation.y },
    { x: tutorial.lineSpot.x, y: tutorial.lineSpot.y },
  );
});

test("the arrow keeps pointing at the ranks that are left", () => {
  const rig = drillRig();
  rig.tutorial.arm();
  rig.tutorial.confirm();
  rig.enemies.damageEnemy(rig.state.wilds[0], 999);
  rig.tutorial.update(1 / 60);
  rig.tutorial.update(2);
  rig.tutorial.confirm();
  rig.tutorial.update(2);
  const tutorial = rig.state.tutorial;
  assert.equal(tutorial.step, "engage");

  // Kill the half of the line nearest the chariot, then walk the survivors away
  // from where the line formed: the arrow has to move with them.
  const firstHalf = tutorial.line.slice(0, 4);
  for (const unit of firstHalf) rig.enemies.damageEnemy(unit, 999);
  for (const unit of tutorial.line) {
    if (!unit.destroyed) unit.x += 120;
  }
  rig.tutorial.update(1 / 60);
  const living = tutorial.line.filter((unit) => !unit.destroyed);
  const centroid = {
    x: living.reduce((sum, unit) => sum + unit.x, 0) / living.length,
    y: living.reduce((sum, unit) => sum + unit.y, 0) / living.length,
  };
  assert.deepEqual(tutorial.objective, centroid, "the arrow stayed on the line's old ground");
  assert.notDeepEqual(tutorial.objective, { x: tutorial.lineSpot.x, y: tutorial.lineSpot.y },
    "the arrow is still the spawn point of the line");
  assert.equal(tutorial.hud.count, firstHalf.length, "the counter lost the fallen");
});


test("one card serves every mode, and a live field has none", () => {
  const campaign = { totalGold: 120, stage: 3, identity: { fullName: "司马长风" } };
  const state = { score: 460 };

  const paused = cardForMode("paused", { campaign, state });
  assert.equal(paused.titleKey, "battle.pausedTitle");
  assert.equal(paused.action, CARD_ACTIONS.resume);
  assert.equal(paused.lines, undefined, "the pause card grew a list it has no copy for");

  const defeat = cardForMode("over", { campaign, state });
  assert.equal(defeat.action, CARD_ACTIONS.retry);
  assert.deepEqual(defeat.copyParams, { gold: 120, stage: 3 },
    "the defeat card lost the run it reports");

  const victory = cardForMode("victory", { campaign, state });
  assert.equal(victory.action, CARD_ACTIONS.endRun);
  // The lede is the run that was won; the list is what it was worth and the rule
  // the locked menu is about to enforce.
  assert.equal(victory.copyTone, "lede");
  assert.deepEqual(victory.lines.map((line) => line.tone), ["stat", "note"]);
  assert.deepEqual(victory.lines[0].params, { score: 460, gold: 120 });
  assert.match(victory.lines[1].params.time, /[0-9]/, "the lock note has no countdown in it");

  for (const mode of ["menu", "prologue", "shop", "running"]) {
    assert.equal(cardForMode(mode, { campaign, state }), null, `${mode} was given a card`);
  }
});

test("the drill's beats are the same card, one line per beat", () => {
  assert.equal(cardForTutorial(null), null);
  assert.equal(cardForTutorial(undefined), null, "a drill without a card still painted one");

  const brief = cardForTutorial({
    titleKey: "tutorial.brief.title",
    bodyKeys: ["tutorial.brief.drive", "tutorial.brief.fire"],
  });
  assert.equal(brief.titleKey, "tutorial.brief.title");
  assert.equal(brief.action, CARD_ACTIONS.tutorial);
  assert.equal(brief.actionKey, "tutorial.confirm");
  assert.equal(brief.width, "wide", "the drill's paragraphs lost their wider measure");
  assert.deepEqual(brief.lines.map((line) => line.textKey),
    ["tutorial.brief.drive", "tutorial.brief.fire"]);
  assert.deepEqual(brief.lines.map((line) => line.tone), ["body", "body"]);

  const tactics = cardForTutorial({
    titleKey: "tutorial.tactics.title",
    bodyKeys: ["tutorial.tactics.infantry", "tutorial.tactics.archers", "tutorial.tactics.chariot"],
  });
  assert.equal(tactics.lines.length, 3, "the three-beat card lost a beat");
});

test("a drill battle says so on the stage tile instead of a number", () => {
  assert.equal(stageLabel({ stage: 1 }, { tutorial: {} }), translate("battle.tutorialStage"));
  assert.equal(stageLabel({ stage: 1 }, { finalBattle: true, tutorial: {} }), translate("battle.tutorialStage"),
    "a drill borrowed the last stage's name");
  assert.equal(stageLabel({ stage: 3 }, {}), "03");
});

test("both locales carry the drill's copy and the drilled line's name", () => {
  const keys = [
    "prologue.tutorial", "battle.tutorialStage", "formation.tutorial", "tutorial.eyebrow",
    "tutorial.brief.title", "tutorial.brief.drive", "tutorial.brief.fire",
    "tutorial.tactics.title", "tutorial.tactics.infantry",
    "tutorial.tactics.archers", "tutorial.tactics.chariot",
    "tutorial.confirm", "tutorial.huntLabel", "tutorial.lineLabel", "tutorial.guide",
  ];
  for (const locale of Object.keys(supportedLocales)) {
    for (const key of keys) assert.ok(hasTranslation(locale, key), `${locale} is missing ${key}`);
  }
});

test("the drill's copy never sends a touch player to the keyboard", () => {
  // The drill is played on a phone: the left joystick drives, the fire button
  // shoots, and the card's own button confirms. A key name in the copy is an
  // instruction the player cannot follow.
  const forbidden = [/空格/, /space/i, /\bWASD\b/i, /\bEnter\b/i, /↑/, /↓/, /←/, /→/, /\bA \/ D\b/i, /\bW \/ /];
  for (const [locale, table] of Object.entries({ "zh-CN": zhCN, en })) {
    for (const [key, value] of Object.entries(table)) {
      if (!key.startsWith("tutorial.")) continue;
      for (const pattern of forbidden) {
        const hit = value.match(pattern);
        assert.equal(hit, null, `${locale} ${key} still names a key: "${hit?.[0]}"`);
      }
    }
  }
});

test("the drill line is nine ranks led by one chariot, and not a rolled pattern", () => {
  const preset = formationPresets.tutorialLine;
  assert.equal(preset.slots.length, 9, `the line is ${preset.slots.length} bodies`);
  assert.equal(preset.slots.filter(([type]) => type === "chariot").length, 1);
  assert.equal(preset.slots.filter(([type]) => type === "archer").length, 2);
  for (const [type] of preset.slots) assert.ok(enemyStats[type], `no stats row for "${type}"`);
  // The campaign picks its lines with `formationsSpawned + wave - 1` modulo the
  // pattern list: a preset in that list would turn up in a real battle.
  assert.equal(formationPatterns.includes(preset), false, "the drill line is in the campaign's rotation");
  assert.equal(hasTranslation(defaultLocale, preset.nameKey), true, "the preset has no banner name");
});

test("index.html puts the drill beside 出征 on the story card", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const actionsAt = html.indexOf('class="prologue-actions"');
  assert.ok(actionsAt > 0, "the story card has no action row");
  const actions = html.slice(actionsAt, html.indexOf("</div>", actionsAt));
  const tutorialAt = actions.indexOf('id="prologue-tutorial"');
  const campaignAt = actions.indexOf('id="prologue-start"');
  assert.ok(tutorialAt >= 0, "index.html has no tutorial button");
  assert.ok(campaignAt > tutorialAt, "the drill does not sit to the left of 出征");
  // The guide arrow needed a caption to retitle: it points at the drill's own
  // target as well as at an extraction point.
  assert.ok(html.includes('id="extraction-guide-label"'), "the guide arrow has no caption element");
});

console.log("[unit] sound");

test("a drop's file name is the routing key the engine reads", () => {
  assert.deepEqual(describeSoundFile("player/chariot_arrow_shoot_2.wav"), {
    file: "player/chariot_arrow_shoot_2.wav",
    folder: "player",
    cue: "chariot_arrow_shoot",
    variant: 2,
    loop: false,
  });
  assert.equal(describeSoundFile("player/footstep_1.wav").cue, "footstep");
  assert.equal(describeSoundFile("player/chariot_moving_loop.wav").cue, "chariot_moving");
  assert.equal(describeSoundFile("player/chariot_moving_loop.wav").loop, true);
  assert.equal(describeSoundFile("weapon/stone_hit_to_ground.wav").cue, "stone_hit_to_ground");
  // A stray drop still routes somewhere sensible instead of colliding with "".
  assert.equal(describeSoundFile("units/Dragon Roar.wav").cue, "Dragon Roar");
});

test("every cue names a file, and every file is named by a cue", () => {
  const banks = indexSoundFiles();
  const byCue = [...banks.values()].map((bank) => bank.cue).sort();
  const declared = Object.values(soundCues).sort();
  assert.deepEqual(byCue, declared, "soundCues and soundFiles disagree");
  for (const bank of banks.values()) {
    const loops = bank.files.filter((file) => describeSoundFile(file).loop);
    assert.ok(loops.length === 0 || loops.length === bank.files.length, `cue ${bank.cue} mixes loops and one-shots`);
  }
});

test("a cue's takes are numbered from one and share one folder", () => {
  for (const bank of indexSoundFiles().values()) {
    const takes = bank.files.map((file) => describeSoundFile(file));
    assert.equal(new Set(takes.map((take) => take.folder)).size, 1, `cue ${bank.cue} spans two folders`);
    const numbered = takes.map((take) => take.variant).filter((variant) => variant > 0).sort((a, b) => a - b);
    if (numbered.length > 0) {
      assert.deepEqual(numbered, numbered.map((_, index) => index + 1), `cue ${bank.cue} skips a take number`);
    }
  }
});

test("every file the registry lists is on disk", () => {
  // The suite also runs where the (multi-megabyte) assets were never checked out,
  // so a missing directory is not a broken registry - a missing file among present
  // ones is.
  try {
    readdirSync(new URL("../src/assets/sound", import.meta.url));
  } catch {
    console.log("  note: src/assets/sound is not checked out, file existence not asserted");
    return;
  }
  const missing = [];
  for (const file of soundFiles) {
    try {
      readFileSync(new URL(`../src/assets/sound/${file}`, import.meta.url));
    } catch {
      missing.push(file);
    }
  }
  assert.deepEqual(missing, [], "the registry lists files that do not exist");
});

test("every borrowed cue is marked TODO and points at a real cue", () => {
  const source = readFileSync(new URL("../src/data/sounds.js", import.meta.url), "utf8");
  const block = source.slice(source.indexOf("export const soundBorrowed"), source.indexOf("export const soundMix"));
  const rows = Object.keys(soundBorrowed);
  assert.ok(rows.length > 0, "soundBorrowed is empty");
  for (const row of rows) {
    assert.ok(block.includes(`  ${row}:`), `soundBorrowed.${row} is not in the source block`);
  }
  // One TODO per stand-in, so a real drop cannot be added without the row being
  // revisited: the count is the contract, not the wording.
  const todos = block.match(/TODO\(sound\)/g) ?? [];
  assert.ok(todos.length >= rows.length, `${rows.length} borrowed cues carry only ${todos.length} TODOs`);
  const cues = new Set(Object.values(soundCues));
  for (const [row, cue] of Object.entries(soundBorrowed)) {
    assert.ok(cues.has(cue), `soundBorrowed.${row} points at "${cue}", which no file plays`);
  }
});

test("the mix covers every cue it mentions and never silences one", () => {
  const cueKeys = new Set(Object.keys(soundCues));
  for (const [key, row] of Object.entries(soundMix)) {
    assert.ok(cueKeys.has(key), `soundMix.${key} is not a cue in soundCues`);
    assert.ok(row.gain > 0 && row.gain <= 1, `soundMix.${key}.gain is outside 0..1`);
    if (row.maxVoices !== undefined) assert.ok(row.maxVoices >= 1);
    if (row.minInterval !== undefined) assert.ok(row.minInterval >= 0);
  }
  // The engine keys its balance by cue id, so the table has to survive the swap.
  const table = buildMixTable();
  for (const [key, cue] of Object.entries(soundCues)) {
    if (soundMix[key]) assert.equal(table.get(cue), soundMix[key]);
  }
  assert.ok(soundLimits.voices >= 8, "the voice ceiling is too low for a battle");
});

test("every silhouette in the unit tables has a death sound", () => {
  const kinds = new Set();
  for (const table of [enemyStats, bossTypes, wildAnimalStats]) {
    for (const row of Object.values(table)) {
      if (row?.visual?.kind) kinds.add(row.visual.kind);
    }
  }
  assert.ok(kinds.size >= 5, "the unit tables lost their silhouettes");
  for (const kind of kinds) {
    assert.ok(soundDeathCues[kind], `no death cue for the "${kind}" silhouette`);
    assert.ok(Object.values(soundCues).includes(soundDeathCues[kind]), `death cue for "${kind}" is not a file`);
  }
});

test("every purchase the shop can make has a cue", () => {
  for (const type of ["equipment", "horse", "personnel", "formation"]) {
    assert.ok(soundPurchaseCues[type], `no purchase cue for "${type}"`);
    assert.ok(Object.values(soundCues).includes(soundPurchaseCues[type]));
  }
});

test("the soundscape follows the screen, the champion and the wheels", () => {
  assert.deepEqual(resolveSoundscape({ mode: "menu" }), { name: "menu", layers: { ambience: soundCues.fieldAmbience } });
  assert.equal(resolveSoundscape({ mode: "prologue" }).name, "menu");
  assert.equal(resolveSoundscape({ mode: "running" }).name, "battle");
  assert.deepEqual(resolveSoundscape({ mode: "running", boss: true }).layers, { ambience: soundCues.bossAmbience });
  assert.equal(resolveSoundscape({ mode: "paused" }).name, "battle", "a pause keeps the field it paused");
  assert.deepEqual(resolveSoundscape({ mode: "shop" }).layers, { fire: soundCues.campfire });
  // The roll is a layer, not a screen: it appears with the wheels and never on a
  // screen that has no field under it.
  assert.equal(resolveSoundscape({ mode: "running", moving: true }).layers.motion, soundCues.chariotRolling);
  assert.equal(resolveSoundscape({ mode: "shop", moving: true }).layers.motion, undefined);
  assert.equal(resolveSoundscape({ mode: "menu", moving: true }).layers.motion, undefined);
});

test("the ambient beds are the only streamed files, and they are the long ones", () => {
  for (const file of soundStreams) {
    assert.ok(soundFiles.includes(file), `${file} is streamed but not registered`);
    assert.ok(describeSoundFile(file).loop, `${file} is streamed but is not a loop`);
    assert.ok(file.endsWith(".mp3"), `${file} would need a codec as PCM`);
  }
});

test("no gameplay module names a file or reaches for the old tone stub", () => {
  const offenders = [];
  const cueKeys = new Set(Object.keys(soundCues));
  const borrowedKeys = new Set(Object.keys(soundBorrowed));
  for (const folder of ["game", "ui", "render", "i18n", "utils"]) {
    for (const entry of readdirSync(new URL(`../src/${folder}`, import.meta.url), { recursive: true })) {
      if (!entry.endsWith(".js")) continue;
      const source = readFileSync(new URL(`../src/${folder}/${entry}`, import.meta.url), "utf8");
      if (/playTone/.test(source)) offenders.push(`${folder}/${entry} calls playTone`);
      if (/["'`][\w/-]+\.(wav|mp3)["'`]/.test(source)) offenders.push(`${folder}/${entry} names an audio file`);
      // A cue nobody registered is silence at runtime, so the reference itself has
      // to be checked: `soundCues.chariotArrows` would be `undefined` forever.
      for (const [, key] of source.matchAll(/soundCues\.(\w+)/g)) {
        if (!cueKeys.has(key)) offenders.push(`${folder}/${entry} reads soundCues.${key}, which does not exist`);
      }
      for (const [, key] of source.matchAll(/soundBorrowed\.(\w+)/g)) {
        if (!borrowedKeys.has(key)) offenders.push(`${folder}/${entry} reads soundBorrowed.${key}, which does not exist`);
      }
    }
  }
  assert.deepEqual(offenders, [], "the cue registry is not the only place a sound is named");
});

// A device that records instead of playing: these tests are about the player's
// decisions (which take, how often, which lane), not about the browser's mixer.
function fakeDevice() {
  const calls = { decoded: [], buffers: [], streams: [], stopped: [], resumed: [] };
  const device = {
    calls,
    time: 0,
    available: true,
    hasStreams: true,
    now: () => device.time,
    unlock() { calls.unlocked = (calls.unlocked ?? 0) + 1; },
    decode(url) {
      calls.decoded.push(url);
      return Promise.resolve({ url, duration: 1 });
    },
    startBuffer(buffer, options = {}) {
      const voice = { buffer, ...options };
      calls.buffers.push(voice);
      return voice;
    },
    stopVoice(voice, fade) { calls.stopped.push({ voice, fade }); },
    setVoiceGain() {},
    // A stream opens paused, which is how the autoplay policy leaves a bed that was
    // started outside a gesture. Only `resumeStream` starts it, so a test can tell
    // "nobody resumed it" from "it was never opened at all".
    startStream(url, options = {}) {
      const element = { paused: true, currentTime: 0, volume: 0 };
      const stream = { url, ...options, element };
      calls.streams.push(stream);
      return stream;
    },
    stopStream(stream, fade) {
      calls.stopped.push({ stream, fade });
      stream.element.paused = true;
    },
    resumeStream(stream) {
      calls.resumed.push(stream);
      stream.element.paused = false;
      return true;
    },
    streamState(stream) {
      return {
        paused: stream.element.paused, at: stream.element.currentTime, volume: stream.element.volume,
      };
    },
    setStreamGain(stream, gain, ramp) {
      stream.gain = gain;
      stream.ramp = ramp;
      // A ramp ends on its target; the steps in between are the browser's business.
      stream.element.volume = gain;
    },
  };
  return device;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const takeName = (url) => decodeURIComponent(url).split("/sound/")[1];

asyncTest("the takes of a cue are played in turn, never drawn from the battle's seed", async () => {
  const device = fakeDevice();
  const audio = createAudio({ sound: true }, { device });
  for (let shot = 0; shot < 3; shot += 1) {
    device.time += 1;
    // eslint-disable-next-line no-await-in-loop -- the order of the takes is the point
    await audio.play(soundCues.chariotArrow);
  }
  assert.deepEqual(device.calls.decoded.map(takeName), [
    "player/chariot_arrow_shoot_1.wav",
    "player/chariot_arrow_shoot_2.wav",
    "player/chariot_arrow_shoot_1.wav",
  ]);
  assert.equal(device.calls.buffers.length, 3);
  assert.equal(device.calls.buffers[0].gain, soundMix.chariotArrow.gain);
});

asyncTest("a cue is rate limited and voice limited, so a volley stays legible", async () => {
  const device = fakeDevice();
  const audio = createAudio({ sound: true }, { device });
  const cue = soundCues.footstep;
  const { minInterval, maxVoices } = soundMix.footstep;

  await audio.play(cue);
  assert.equal(device.calls.buffers.length, 1);
  device.time += minInterval / 2;
  assert.equal(await audio.play(cue), null, "a repeat inside the interval slipped through");
  device.time += minInterval;
  await audio.play(cue);
  assert.equal(device.calls.buffers.length, 2);
  device.time += minInterval;
  assert.equal(await audio.play(cue), null, `more than ${maxVoices} takes overlapped`);
  // Past the takes' own length the slots free themselves: no timer, no leak.
  device.time += 2;
  await audio.play(cue);
  assert.equal(device.calls.buffers.length, 3);
});

asyncTest("muting is silence, and unmuting restarts the lane that is already up", async () => {
  const state = { sound: true };
  const device = fakeDevice();
  const audio = createAudio(state, { device });
  audio.setState({ mode: "shop" });
  await settle();
  assert.deepEqual(audio.lanes(), ["fire"]);
  assert.equal(device.calls.buffers[0].loop, true, "the campfire has to loop");

  state.sound = false;
  audio.setState({ mode: "shop" });
  await settle();
  assert.deepEqual(audio.lanes(), [], "a mute left a loop playing");
  assert.equal(await audio.play(soundCues.coinPickup), null);
  const decodedBefore = device.calls.decoded.length;
  await audio.play(soundCues.coinPickup);
  assert.equal(device.calls.decoded.length, decodedBefore, "a muted cue still fetched its file");

  state.sound = true;
  audio.setState({ mode: "shop" });
  await settle();
  assert.deepEqual(audio.lanes(), ["fire"]);
});

asyncTest("a screen change crossfades its own lane and leaves the others alone", async () => {
  const device = fakeDevice();
  const audio = createAudio({ sound: true }, { device });
  audio.setState({ mode: "running", moving: true });
  await settle();
  assert.deepEqual(audio.lanes().sort(), ["ambience", "motion"]);
  const streamsBefore = device.calls.streams.length;
  const stoppedBefore = device.calls.stopped.length;

  // The boss swap changes the ambience bed only: the wheels are still rolling, so
  // their lane must not be cut.
  audio.setState({ mode: "running", boss: true, moving: true });
  await settle();
  assert.equal(device.calls.streams.length, streamsBefore + 1);
  assert.equal(takeName(device.calls.streams.at(-1).url), "ambient/boss_fight_map_background_loop.mp3");
  assert.equal(device.calls.streams.at(-1).gain, soundMix.bossAmbience.gain);
  const stopped = device.calls.stopped.slice(stoppedBefore);
  assert.equal(stopped.length, 1, "the swap cut more than the bed it replaced");
  assert.ok(stopped[0].stream, "the bed that was replaced was not the stream");
  assert.equal(stopped[0].fade, soundChannels.ambience.fadeSeconds);

  audio.stop();
  assert.deepEqual(audio.lanes(), []);
});

asyncTest("the warm-up starts on unlock, once, and only where a decoder exists", async () => {
  const device = fakeDevice();
  const audio = createAudio({ sound: true }, { device });
  // A bed opened before the first gesture is paused by the autoplay policy; unlock
  // is what has to hand it back, in place, so a 30s bed does not restart at 0:00.
  audio.setState({ mode: "running" });
  await settle();
  assert.equal(device.calls.streams.length, 1);
  const bed = device.calls.streams.at(-1);
  bed.element.currentTime = 7;

  audio.unlock();
  await settle();
  assert.equal(device.calls.unlocked, 1);
  assert.deepEqual(device.calls.resumed, [bed], "the ambience was never resumed on unlock");
  assert.equal(device.calls.streams.length, 1, "unlock rebuilt the element instead of resuming it");
  assert.equal(bed.element.currentTime, 7, "unlock restarted the bed from the beginning");
  const decoded = device.calls.decoded.length;
  assert.equal(decoded, soundFiles.length - soundStreams.length, "not every one-shot was warmed");
  audio.unlock();
  await settle();
  assert.equal(device.calls.decoded.length, decoded, "a second unlock decoded everything again");
  assert.equal(device.calls.resumed.length, 1, "a second unlock resumed a bed that was already playing");

  // A host without a decoder must not queue a single fetch.
  const silent = fakeDevice();
  silent.available = false;
  const quiet = createAudio({ sound: true }, { device: silent });
  quiet.unlock();
  await settle();
  assert.deepEqual(silent.calls.decoded, []);
});

asyncTest("the next event hands back a bed the autoplay policy refused", async () => {
  const device = fakeDevice();
  const audio = createAudio({ sound: true }, { device });
  // A screen change with no gesture behind it: the element opens and stays paused,
  // which is what Safari does and never retries on its own.
  audio.setState({ mode: "running" });
  await settle();
  const bed = device.calls.streams.at(-1);
  assert.deepEqual(device.calls.resumed, []);

  // In a real session the first gesture is usually a shot rather than the unlock
  // handler, so an ordinary cue has to be enough to bring the music back.
  await audio.play(soundCues.chariotArrow);
  assert.deepEqual(device.calls.resumed, [bed], "a refused bed stayed refused after an event");
  assert.equal(device.calls.streams.length, 1, "the bed was restarted instead of resumed");
  // And a bed that is already playing must not be poked on every shot.
  await audio.play(soundCues.chariotArrow);
  assert.equal(device.calls.resumed.length, 1);
});

asyncTest("inspect tells a refused bed apart from a playing one", async () => {
  const device = fakeDevice();
  const audio = createAudio({ sound: true }, { device });
  audio.setState({ mode: "running", moving: true });
  await settle();

  const lanes = audio.inspect();
  assert.deepEqual(lanes.map((entry) => entry.lane).sort(), ["ambience", "motion"]);
  const bed = lanes.find((entry) => entry.lane === "ambience");
  assert.equal(bed.kind, "stream");
  assert.equal(bed.cue, soundCues.fieldAmbience);
  // The whole point of this call: a refused bed is silent, and only this says so.
  assert.equal(bed.paused, true, "a refused bed read as playing");
  const wheels = lanes.find((entry) => entry.lane === "motion");
  assert.equal(wheels.kind, "buffer");
  assert.equal(wheels.paused, false);
  assert.equal(wheels.at, null, "a decoded loop has no playback position to report");

  audio.unlock();
  assert.equal(audio.inspect().find((entry) => entry.lane === "ambience").paused, false);
  audio.stop();
  assert.deepEqual(audio.inspect(), [], "a stop left a lane behind");
});

asyncTest("a stop is silence until the next scene is announced, even the same one", async () => {
  const device = fakeDevice();
  const audio = createAudio({ sound: true }, { device });
  audio.setState({ mode: "running" });
  await settle();
  audio.stop();
  assert.deepEqual(audio.lanes(), []);
  // A battle re-announces its scene every frame, so a stop has to forget the scene
  // key it deduplicates on - otherwise one stop would silence the run for good.
  audio.setState({ mode: "running" });
  await settle();
  assert.deepEqual(audio.lanes(), ["ambience"], "the same screen stayed silent after a stop");
});

for (const { name, run } of asyncTests) {
  await run();
  passed += 1;
  console.log(`  ok   ${name}`);
}

console.log(`\n[unit] PASS (${passed} checks)`);

