// Frame-budget benchmark for the per-frame simulation loops. Usage:
//   node scripts/perf-test.mjs
//   H5_PERF_FRAMES=240 node scripts/perf-test.mjs
//
// The scenario is the worst case the game actually reaches: a real battlefield
// (46 obstacles from the same seeded generator a battle uses), four spawned
// formations, a full crew, and a dismounted crew of companions. Every shooter is
// forced ready on every iteration, so what is measured is the *acquisition* path
// - target scan, line of sight, volley maths - rather than the reload timer that
// otherwise hides it.
//
// Budgets are a ratchet: each one sits just above what the code measures today,
// so a regression fails the suite, and each perf change lowers the number it
// pays for. Keep the comment next to a budget in sync with the measurement.
import "./dom-stub.mjs";
import { battlefields } from "../src/data/battlefields.js";
import { personnel } from "../src/data/equipment.js";
import { bossTypes, enemyStats, formationPatterns } from "../src/data/formations.js";
import { createBattlefield } from "../src/game/map.js";
import { createCollisionSystem } from "../src/game/collision.js";
import { createCombatSystem } from "../src/game/combat.js";
import { createProjectileSystem } from "../src/game/projectiles.js";
import { createGameState } from "../src/game/state.js";
import { createEnemies } from "../src/game/units/enemies.js";
import { createRandomSeed, createSeededRandom } from "../src/utils/random.js";

const FRAMES = Number(process.env.H5_PERF_FRAMES ?? 120);
const WARMUP = 20;
const noop = () => {};

// Milliseconds per simulated frame. Measured numbers are printed next to the
// budget so a failure says what moved and by how much.
const budgets = {
  // Enemy AI: per-unit line of sight, chase, and the O(n^2) separation sweeps.
  // Measurements on a warm machine spread 0.19-0.26ms, so the ceiling carries
  // that spread rather than a single run.
  enemyFrame: 0.6, // 0.19-0.26 measured
  // Crew volley: every bow ready, five archers resolving a target against 48
  // candidates on every frame. The sight index plus the cooldown gate took this
  // from a ~12ms burst to 0.18-0.27ms, but it is still the frame a player feels
  // if it regresses: one dropped frame is a visible hitch.
  crewVolley: 0.6, // 0.18-0.27 measured
  // Dismounted companions: the same shape, but sustained rather than periodic.
  footCompanions: 0.5, // 0.13-0.14 measured
  // Projectile integration for a 30-arrow flight.
  projectiles: 0.4, // 0.11-0.13 measured
  // One bow-length line-of-sight query, in microseconds, over the real obstacle
  // set. This is the per-call cost the two scan budgets above are made of.
  lineOfSightMicro: 3, // 0.55-0.60 measured
};

const { state, player, campaign, world } = createGameState({ seedSource: () => "20240607" });
state.mode = "running";
const collision = createCollisionSystem({ campaign, world });
const random = createSeededRandom(createRandomSeed("20240607"));
campaign.random = random;
const field = createBattlefield(random, player, world, collision.circleIntersectsObstacle, battlefields[0].mix);
campaign.obstacles = field.obstacles;
campaign.terrain = field.terrain;
campaign.clouds = field.clouds;

const enemies = createEnemies({
  bossTypes,
  enemyStats,
  formationPatterns,
  state,
  player,
  world,
  campaign,
  random: () => campaign.random(),
  circleIntersectsObstacle: collision.circleIntersectsObstacle,
  moveEntitySafely: collision.moveEntitySafely,
  getChariotCollisionDamage: () => 1,
  playTone: noop,
  updateHud: noop,
  hasLineOfSight: collision.hasLineOfSight,
  fireEnemy: noop,
  damagePlayer: noop,
  damageCompanion: noop,
});

for (let index = 0; index < 4; index += 1) enemies.spawnFormation();
// Stand the player inside the first line's reach so the AI takes its sighted
// branch instead of the idle scan.
if (state.formations.length > 0) {
  player.x = state.formations[0].x;
  player.y = state.formations[0].y + 180;
}

// The ranged scenarios need every candidate inside the bow's reach: that is the
// shape that produces the hitch (five bows x 48 enemies = 240 sight queries on
// every frame the volley is ready), whereas a formation 400px away leaves most
// candidates rejected by the distance filter before a line is ever walked.
function ringEnemies(radius) {
  const live = state.enemies.filter((enemy) => !enemy.destroyed);
  live.forEach((enemy, index) => {
    const angle = (index / live.length) * Math.PI * 2;
    enemy.x = player.x + Math.cos(angle) * radius;
    enemy.y = player.y + Math.sin(angle) * radius;
  });
}

const shots = [];
const combat = createCombatSystem({
  state,
  player,
  campaign,
  collision,
  projectiles: { fireAllyArrow: (options) => shots.push(options) },
  damageEnemy: noop,
  addMeleeEffect: noop,
  burst: noop,
  playTone: noop,
  updateHud: noop,
  announceBanner: noop,
  onDefeat: noop,
});

// A full crew: the chariot box at its last level is nine slots, and the volley
// fan makes the archers the only members that walk a line of sight.
const archerRow = personnel.find((row) => row.id === "archer");
const halberdierRow = personnel.find((row) => row.id === "halberdier");
campaign.roster = [
  ...Array.from({ length: 5 }, (_, index) => ({ id: index + 1, role: archerRow.id })),
  ...Array.from({ length: 4 }, (_, index) => ({ id: index + 6, role: halberdierRow.id })),
];

const projectiles = createProjectileSystem({
  state, player, world, campaign, collision,
  burst: noop, dust: noop, playTone: noop,
  damageEnemy: noop, damagePlayer: noop, damageCompanion: noop,
});

function measure(label, run) {
  for (let index = 0; index < WARMUP; index += 1) run(index);
  const started = performance.now();
  for (let index = 0; index < FRAMES; index += 1) run(index);
  return { label, perFrame: (performance.now() - started) / FRAMES };
}

const delta = 1 / 60;
const results = [];
const scenarios = [
  ["enemy AI + separation", "enemyFrame", () => {
    enemies.updateUnits(delta);
  }],
  ["crew volley (5 bows, all ready)", "crewVolley", () => {
    for (const member of campaign.roster) member.cooldown = 0;
    combat.updateCrew(delta);
  }],
  // The dismount is one-way, so it runs after the mounted scenario is done. Every
  // companion is forced ready for the same reason the bows are.
  ["deployed companions (9)", "footCompanions", () => {
    for (const companion of state.footCompanions) companion.attackCooldown = 0;
    combat.updateFootCompanions(delta);
  }],
  // Keep a full flight in the air by rebuilding it outside the timer: what is
  // measured is the integration and impact loop, not the spawn.
  ["30 projectiles in flight", "projectiles", () => {
    buildFlight();
    projectiles.update(delta);
  }],
];

function buildFlight() {
  state.bullets.length = 0;
  for (let index = 0; index < 30; index += 1) {
    projectiles.fireAllyArrow({
      x: player.x, y: player.y, targetX: player.x + 300, targetY: player.y, damage: 1, range: 600,
    });
  }
  return state.bullets.length;
}

// A benchmark that silently measures nothing is worse than no benchmark: the
// scene is checked once before the timers start, and again after the dismount.
if (state.enemies.length === 0) throw new Error("[perf] the enemy scene did not build");
if (campaign.roster.length !== 9) throw new Error(`[perf] expected a full crew, got ${campaign.roster.length}`);
if (buildFlight() !== 30) throw new Error("[perf] the projectile scene did not fill");
// The AI scenario must not inherit the flight: 30 live arrows are not part of it.
state.bullets.length = 0;

for (const [index, [label, budgetKey, run]] of scenarios.entries()) {
  if (index > 0) ringEnemies(360);
  if (index === 2) {
    combat.dismountPlayer();
    if (state.footCompanions.length !== 9) {
      throw new Error(`[perf] expected 9 companions, got ${state.footCompanions.length}`);
    }
  }
  results.push({ ...measure(label, run), budgetKey });
}

// Line of sight, measured per call: this is the primitive every ranged unit
// leans on, so its unit cost is what the scan budgets above are made of. The
// pairs are bow-length (400px) because that is the query the game actually asks;
// a whole-world span would triple the sample count and measure a shot nobody takes.
const sightQueries = [];
for (let index = 0; index < 400; index += 1) {
  const fromX = 200 + random() * (world.width - 400);
  const fromY = 200 + random() * (world.height - 400);
  const angle = random() * Math.PI * 2;
  sightQueries.push([fromX, fromY, fromX + Math.cos(angle) * 400, fromY + Math.sin(angle) * 400]);
}
let sightChecks = 0;
const sightStart = performance.now();
for (let pass = 0; pass < 3; pass += 1) {
  for (const [fromX, fromY, toX, toY] of sightQueries) {
    collision.hasLineOfSight(fromX, fromY, toX, toY);
    sightChecks += 1;
  }
}
const lineOfSightMicro = (performance.now() - sightStart) * 1000 / sightChecks;

const failures = [];
function report(label, measured, budget, unit) {
  const ok = measured <= budget;
  if (!ok) failures.push(`${label}: ${measured.toFixed(2)}${unit} > ${budget}${unit}`);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label.padEnd(34)} ${measured.toFixed(3).padStart(9)}${unit}  budget ${budget}${unit}`);
}

console.log(`[perf] ${FRAMES} frames per scenario, ${state.enemies.length} enemies, ${campaign.obstacles.length} obstacles`);
console.log("[perf] ms per simulated frame");
for (const { label, perFrame, budgetKey } of results) report(label, perFrame, budgets[budgetKey], " ms");
console.log("[perf] per call");
report("hasLineOfSight", lineOfSightMicro, budgets.lineOfSightMicro, "us");

console.log(failures.length === 0 ? "\n[perf] PASS" : `\n[perf] FAIL: ${failures.join("; ")}`);
process.exitCode = failures.length === 0 ? 0 : 1;
