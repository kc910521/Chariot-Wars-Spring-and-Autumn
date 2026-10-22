// Pure-logic regression tests for the gameplay rules that have no DOM
// dependency. Usage: node scripts/unit-test.mjs
import assert from "node:assert/strict";

import {
  calculateArrowDamage, calculateChariotCollisionDamage, calculateChariotStats,
  calculateHullHealth, calculateMobilityMultiplier, calculateProtectionChance,
  emptyEquipment, equipment, horses, personnel,
} from "../src/data/equipment.js";
import { campaignRules, chariotRules } from "../src/data/rules.js";
import { addBloodStain } from "../src/game/blood.js";
import { createCollisionSystem } from "../src/game/collision.js";
import {
  createBallisticProjectile, solveBallisticElevation, updateProjectiles,
} from "../src/game/projectiles.js";
import { createRandomSeed, createSeededRandom } from "../src/utils/random.js";

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

test("a ?seed= url parameter pins the battle seed", () => {
  const originalLocation = globalThis.location;
  try {
    globalThis.location = { search: "?seed=42" };
    assert.equal(createRandomSeed(), 42);
    globalThis.location = { search: "?seed=not-a-number" };
    const fallback = createRandomSeed();
    assert.ok(Number.isInteger(fallback) && fallback >= 0 && fallback <= 0xffffffff, `unexpected seed: ${fallback}`);
    globalThis.location = { search: "" };
    assert.ok(Number.isInteger(createRandomSeed()));
  } finally {
    globalThis.location = originalLocation;
  }
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

console.log(`\n[unit] PASS (${passed} checks)`);
