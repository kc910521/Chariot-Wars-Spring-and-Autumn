// Pure-logic regression tests for the gameplay rules that have no DOM
// dependency. Usage: node scripts/unit-test.mjs
import assert from "node:assert/strict";

import {
  calculateArrowDamage, calculateChariotCollisionDamage, calculateChariotStats,
  calculateHullHealth, calculateMobilityMultiplier, calculateProtectionChance,
  emptyEquipment, equipment, horses, personnel,
} from "../src/data/equipment.js";
import { campaignRules, chariotRules, effectRules, projectileRules } from "../src/data/rules.js";
import { addBloodStain } from "../src/game/blood.js";
import { battlefields } from "../src/data/battlefields.js";
import { createCollisionSystem } from "../src/game/collision.js";
import { cloudKinds, elementRules, obstacleKinds, terrainKinds } from "../src/data/elements.js";
import {
  clearsSight, cloudDrift, elementBoundingRadius, elementCullMargin, elementGap, elementIntersects,
  elementSpeedAt, obstacleShape, rectHitsAnyObstacle, rectTerrain,
} from "../src/game/elements.js";
import { createBattlefield } from "../src/game/map.js";
import { createElementRenderer } from "../src/render/elements.js";
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
    campaign: { random: () => 0.5, equipment: {} },
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

console.log(`\n[unit] PASS (${passed} checks)`);
