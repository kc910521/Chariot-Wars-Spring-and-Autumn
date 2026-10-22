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
import { createCollisionSystem } from "../src/game/collision.js";
import { CHARIOT_CONTROL_CONFIG, createPlayerController } from "../src/game/player.js";
import { bossTypes, enemyStats, formationPatterns } from "../src/data/formations.js";
import {
  createBallisticProjectile, createProjectileSystem, solveBallisticElevation,
  solveTimeToGround, updateProjectiles,
} from "../src/game/projectiles.js";
import { createEnemies } from "../src/game/units/enemies.js";
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

console.log("[unit] chariot steering");

// Drives the real controller with a bare player object: no DOM, no collision
// system, and a joystick vector expressed relative to where the nose points.
const STEER_FACING = -Math.PI / 2;

function angleGap(from, to) {
  return Math.abs(Math.atan2(Math.sin(to - from), Math.cos(to - from)));
}

function simulateSteering({ relativeDeg = 180, magnitude = 0.3, frames = 120, startSpeed = 0 } = {}) {
  const player = {
    x: 600,
    y: 600,
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
  for (let frame = 0; frame < frames; frame += 1) controller.readControls(1 / 60);
  const travelled = Math.hypot(player.x - 600, player.y - 600);
  const travelAngle = Math.atan2(player.y - 600, player.x - 600);
  return { player, stickAngle, travelled, travelAngle };
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

test("backward diagonals reverse along the stick direction", () => {
  for (const relativeDeg of [135, 140, 160, 180]) {
    const { player, stickAngle, travelAngle } = simulateSteering({ relativeDeg, magnitude: 0.3 });
    assert.equal(player.angle, STEER_FACING, `facing rotated at ${relativeDeg}deg`);
    assert.ok(
      angleGap(travelAngle, stickAngle) < 0.02,
      `expected travel along the stick at ${relativeDeg}deg, got ${travelAngle}`,
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

console.log(`\n[unit] PASS (${passed} checks)`);
