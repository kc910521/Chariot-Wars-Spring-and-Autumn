import { addBloodStain } from "../blood.js";
import { campaignRules, effectRules } from "../../data/rules.js";
import { clamp, shortestAngleDifference } from "../../utils/math.js";
import { rectHitsAnyObstacle, rectTerrain } from "../elements.js";
import { spawnParticle } from "../particles.js";
import { createBehaviours } from "./behaviours.js";
import { formationExtent, formationGroundExtent, layoutSlots, searchPoint, tickFormationAura, updateFormationAlerts } from "./formations.js";

const SEPARATION_MIN_OVERLAP = 2;
// How many sweeps `separateEnemies` may take to settle a crowd: one sweep only
// guarantees the pair it resolved last, because a later push can shove a unit
// back into an earlier pair. Three covers a jam of three bodies (which is what
// an alerted line pressing on the hull produces) and the loop exits as soon as
// a sweep moves nothing.
const SEPARATION_PASSES = 3;
// Idle units look around their formation's front while the player is out of
// sight, so a line the chariot has not reached yet reads as standing watch
// rather than as statues. The offset is re-rolled on a timer and clamped to the
// band below, so - unlike the old `wanderAngle += noise`, which accumulated
// without a bound and left units facing backwards after a long idle - it cannot
// drift; the turn is eased at a capped rate so it reads as looking around, and
// nothing here touches `x`/`y`, so a unit's slot stays exactly where it spawned.
const IDLE_SCAN_ANGLE = 0.34; // rad (~19.5deg) either side of the front.
const IDLE_THINK_MIN = 2.6; // Seconds between new headings: longer than the old
const IDLE_THINK_SPAN = 3.2; // 1.7-3.7s, i.e. a new heading every 2.6-5.8s.
const IDLE_TURN_RATE = 1.7; // rad/s cap, so a full scan swings in ~0.4s.

// Looking for a target that just slipped out of sight: the unit walks to where
// it last saw the target, clamped to its own searchPoint envelope, sweeps the
// ground there, and only then goes back to its post. The old code aimed at a
// point clamped to the guard leash instead - usually behind the unit - so it
// snapped round on the first frame and then stood still until a 1.8s timer ran
// out, without ever moving towards the sighting.
const SEARCH_JOG = 0.62; // of `speed`: looking is a jog, not a charge.
const SEARCH_ARRIVE = 14; // Within a body of the sighting: searched.
const SEARCH_SWEEP = 2.2; // Seconds spent sweeping the spot itself.
const SEARCH_GLANCE = 1.2; // Seconds spent looking at a sighting too far to walk.
const SEARCH_TIMEOUT_MAX = 9; // Cap on the walk itself, whatever the distance.
const SEARCH_SPREAD = 1.05; // rad (~60deg) either side of the sighting.
const SEARCH_TURN_RATE = 2.6; // rad/s while looking...
const RETURN_TURN_RATE = 3.2; // ...and while walking back to the post.
// A sighting further out than this only earns a glance: walking after a target
// that blinked out at the edge of sight would drag a rank out of the line for
// information the unit cannot use.
const LOST_SIGHT_LOOK = 240;

// How many places a formation looks at before settling. The scan keeps the best
// ground it has seen instead of taking the first clear patch, so this is a search
// budget rather than a retry count: a wall in the annulus it searches costs an
// attempt, not the spawn.
const FORMATION_SPAWN_ATTEMPTS = 96;

function getChariotTravelSpeed(player) {
  return Math.abs(player.speed);
}

export function createEnemies({
  bossTypes, enemyStats, wildAnimalStats = {}, formationPatterns, formationPresets = {}, state, player,
  world, campaign, random,
  circleIntersectsObstacle, moveEntitySafely, getChariotCollisionDamage, playTone, updateHud,
  hasLineOfSight, fireEnemy, damagePlayer, damageCompanion, damageAlly = () => {},
}) {
  // `random` is late-bound by the caller so every gameplay roll (and the
  // particle spray) draws from the PRNG of the battle in progress, keeping a
  // battle reproducible from its seed.

  function dropLoot(enemy) {
    // A wild animal leaves meat, and meat is the one drop that rolls nothing: a
    // body dropped by a scenario (the tutorial's tiger) must not be able to shift
    // every seeded decision that follows it.
    if (enemy.loot === "meat") {
      state.drops.push({ x: enemy.x, y: enemy.y, type: "meat", value: 0, heal: 4, life: 30, phase: 0 });
      return;
    }
    const roll = random();
    const type = roll < 0.62 ? "coin" : roll < 0.9 ? "silver" : "gold";
    const values = { coin: 8 + Math.floor(random() * 8), silver: 22 + Math.floor(random() * 16), gold: 55 + Math.floor(random() * 31) };
    state.drops.push({
      x: enemy.x + (random() - 0.5) * 24,
      y: enemy.y + (random() - 0.5) * 24,
      type,
      value: values[type],
      life: 30,
      phase: random() * Math.PI * 2,
    });
  }

  // The player's hull shoves foot units aside. Vehicles are rammed instead, and a
  // boss is not something a chariot ploughs through, so both bail out here.
  function resolveInfantryCollision(enemy) {
    if (enemy.destroyed || enemy.vehicle || enemy.boss) return;
    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;
    const distance = Math.hypot(dx, dy);
    const touchDistance = player.radius + enemy.radius;
    if (distance >= touchDistance) return;

    const nx = distance > 0 ? dx / distance : Math.cos(player.angle);
    const ny = distance > 0 ? dy / distance : Math.sin(player.angle);
    const overlap = touchDistance - distance;
    moveEntitySafely(enemy, nx * (overlap + 2), ny * (overlap + 2), enemy.radius);
    if (player.mode === "foot") {
      enemy.contactCooldown = Math.max(enemy.contactCooldown, 0.4);
      return;
    }
    player.knockbackX -= nx * 42;
    player.knockbackY -= ny * 42;

    const travelSpeed = getChariotTravelSpeed(player);
    const facingDot = Math.cos(player.angle) * nx + Math.sin(player.angle) * ny;
    const charging = player.mode === "chariot" && travelSpeed > 65 && facingDot > 0.35;
    if (enemy.contactCooldown > 0 || enemy.knockedDown > 0) return;

    if (charging) {
      damageEnemy(enemy, getChariotCollisionDamage(), "ram");
      enemy.contactCooldown = 0.5;
      if (!enemy.destroyed) enemy.knockedDown = Math.max(enemy.knockedDown, 1.8);
      state.shake = Math.max(state.shake, 2.5);
      addMeleeEffect(enemy.x, enemy.y, player.angle, "ram");
      burst(enemy.x, enemy.y, "#ffe08a");
    } else if (travelSpeed > 20) {
      enemy.knockedDown = 1.8;
      enemy.contactCooldown = Math.max(enemy.contactCooldown, 0.55);
      state.shake = Math.max(state.shake, 1.4);
      burst(enemy.x, enemy.y, "#d0ad72");
      burst((player.x + enemy.x) / 2, (player.y + enemy.y) / 2, "#d0ad72");
    } else {
      enemy.contactCooldown = 0.3;
      state.shake = Math.max(state.shake, 0.8);
      burst((player.x + enemy.x) / 2, (player.y + enemy.y) / 2, "#d0ad72");
    }

    if (charging && player.invulnerable === 0 && player.swarmDamageCooldown <= 0) {
      const crowdSize = state.enemies.filter((unit) => !unit.destroyed && !unit.boss && !unit.vehicle
        && Math.hypot(unit.x - player.x, unit.y - player.y) < player.radius + unit.radius + 24).length;
      if (crowdSize >= 4) {
        const counterDamage = Math.max(1, crowdSize - 3);
        player.swarmDamageCooldown = 1.15;
        damagePlayer(counterDamage, enemy.x, enemy.y);
        addMeleeEffect(player.x, player.y, Math.atan2(enemy.y - player.y, enemy.x - player.x), "sword");
      }
    }
  }

  // A formation spawns on the best ground its attempt budget finds, not on the
  // first patch that looks clear: dry beats uniform beats merely clear, and the old
  // slot-centre rule - which accepts a palisade standing *between* two ranks - is
  // the last rung, kept only so that a pathological map still spawns something.
  function spawnFormation() {
    const pattern = formationPatterns[(state.formationsSpawned + state.wave - 1) % formationPatterns.length];
    const formationId = state.elapsed + random();
    // Two rects on purpose: the wider one is what the renderer dashes and what a
    // new formation reserves, the tighter one is the ground the ranks stand on.
    const { halfWidth, halfHeight } = formationExtent(pattern);
    const clearance = formationGroundExtent(pattern);
    let uniform = null;
    let clear = null;
    let legacy = null;
    for (let attempt = 0; attempt < FORMATION_SPAWN_ATTEMPTS; attempt += 1) {
      const heading = random() * Math.PI * 2;
      const distance = 390 + random() * 170;
      const centerX = Math.max(130, Math.min(world.width - 130, player.x + Math.cos(heading) * distance));
      const centerY = Math.max(130, Math.min(world.height - 130, player.y + Math.sin(heading) * distance));
      const slotCoordinates = layoutSlots(pattern, centerX, centerY, heading);
      if (slotCoordinates.some((slot) => Math.hypot(slot.x - player.x, slot.y - player.y) < 310)) continue;
      // Two formations spawned on the same ground interpenetrate for their whole
      // lifetime, which reads as infantry flickering over each other.
      if (state.formations.some((other) => Math.abs(other.x - centerX) < other.halfWidth + halfWidth
        && Math.abs(other.y - centerY) < other.halfHeight + halfHeight)) continue;
      // The hired line is ground already taken: an enemy line spawned on top of it
      // would interpenetrate for the rest of the battle.
      if ((state.allyFormations ?? []).some((other) => Math.abs(other.x - centerX) < other.halfWidth + halfWidth
        && Math.abs(other.y - centerY) < other.halfHeight + halfHeight)) continue;

      const candidate = {
        pattern, formationId, centerX, centerY, heading, halfWidth, halfHeight, slotCoordinates,
        groundTier: "dry",
      };
      // The ranks, not the leash envelope: a wall at the outer edge of the dashed
      // border touches nothing a unit stands on.
      if (!rectHitsAnyObstacle(centerX, centerY, clearance.halfWidth, clearance.halfHeight, heading, campaign.obstacles)) {
        const footing = rectTerrain(centerX, centerY, clearance.halfWidth, clearance.halfHeight, heading, campaign.terrain);
        if (footing.dry) {
          commitFormation(candidate);
          return;
        }
        // A seam under the line means two ranks moving at two speeds, so it is kept
        // only if nothing better turns up: one dry patch is worth the rest of the
        // budget.
        candidate.groundTier = footing.uniform ? "uniform" : "clear";
        if (footing.uniform) uniform ??= candidate;
        else clear ??= candidate;
        continue;
      }
      // The old rule: every slot centre is free, even if a wall between two slots
      // is not. Nothing has needed this rung since the footprint test landed.
      if (slotCoordinates.some((slot) => circleIntersectsObstacle(slot.x, slot.y, 20))) continue;
      candidate.groundTier = "legacy";
      legacy ??= candidate;
    }
    const chosen = uniform ?? clear ?? legacy;
    if (chosen) commitFormation(chosen);
  }

  function commitFormation({
    pattern, formationId, centerX, centerY, heading, halfWidth, halfHeight, slotCoordinates, groundTier,
  }) {
    const formation = {
      id: formationId,
      nameKey: pattern.nameKey,
      x: centerX,
      y: centerY,
      heading,
      halfWidth,
      halfHeight,
      color: "#a74732",
      // Latched by `updateFormationAlerts` before the first unit thinks.
      alerted: false,
      // The banner beat is the same one the hired line runs; see
      // `tickFormationAura` in formations.js.
      auraTimer: 0,
      auraFlash: 0,
      // Which rung of the spawn ladder placed this line; the tests pin the count of
      // `legacy` spawns at zero.
      groundTier,
    };
    state.formations.push(formation);
    state.formationsSpawned += 1;
    for (const [index, [type, slotX, slotY]] of pattern.slots.entries()) {
      const slot = slotCoordinates[index];
      const stats = { ...enemyStats[type] };
      state.enemies.push({
        ...stats,
        type,
        maxHealth: stats.health,
        x: slot.x,
        y: slot.y,
        angle: heading,
        homeX: slot.x,
        homeY: slot.y,
        formationId,
        seesPlayer: false,
        lastSeenX: slot.x,
        lastSeenY: slot.y,
        // Seconds left of the walk to a remembered sighting, and of the sweep
        // that follows it. Both are 0 on a unit that is where it belongs.
        searchTimer: 0,
        sweepTimer: 0,
        shotCooldown: 0.8 + random() * 1.5,
        homeAngle: heading,
        // A full-strength random phase, so a formation does not re-roll every
        // unit's heading on the same frame and twitch in unison.
        idleTarget: heading,
        idleTimer: random() * (IDLE_THINK_MIN + IDLE_THINK_SPAN),
        hitFlash: 0,
        healFlash: 0,
        contactCooldown: 0,
        attackCooldown: 0.8 + random() * 0.8,
        knockedDown: 0,
      });
    }
  }

  // One unit for the champion roster, placed at a free spot: the shape every
  // boss shares (facing, idle timers, attack clocks) lives here so a single
  // champion and a squad of eight cannot drift apart.
  function placeBoss(boss, x, y) {
    // Bosses idle before they spot the player, so they need a real facing to fall
    // back on: the idle branch writes `angle` while searching, and a champion
    // spawned without one would store `undefined` there - a non-finite canvas
    // transform.
    const aim = Math.atan2(player.y - y, player.x - x);
    const unit = {
      ...boss,
      boss: true,
      maxHealth: boss.health,
      x,
      y,
      angle: aim,
      homeAngle: aim,
      idleTarget: aim,
      idleTimer: random() * (IDLE_THINK_MIN + IDLE_THINK_SPAN),
      homeX: x,
      homeY: y,
      seesPlayer: false,
      lastSeenX: player.x,
      lastSeenY: player.y,
      searchTimer: 0,
      sweepTimer: 0,
      shotCooldown: 2,
      attackCooldown: 2.2,
      contactCooldown: 0,
      hitFlash: 0,
      knockedDown: 0,
    };
    state.bosses.push(unit);
    state.enemies.push(unit);
    return unit;
  }

  function spawnBoss() {
    const boss = bossTypes[Math.floor(random() * bossTypes.length)];
    let position;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const angle = random() * Math.PI * 2;
      const distance = 500 + random() * 150;
      const x = Math.max(boss.radius + 20, Math.min(world.width - boss.radius - 20, player.x + Math.cos(angle) * distance));
      const y = Math.max(boss.radius + 20, Math.min(world.height - boss.radius - 20, player.y + Math.sin(angle) * distance));
      if (!circleIntersectsObstacle(x, y, boss.radius + 8)) {
        position = { x, y };
        break;
      }
    }
    if (!position) {
      throw new Error(`Unable to place boss "${boss.nameKey}" on this battlefield.`);
    }
    return placeBoss(boss, position.x, position.y);
  }

  // The last battle: the squad from the rule table, ringed around the player.
  // Each champion gets its own bearing, so the fight opens from every side, and
  // the walk radius shrinks until a free spot turns up — a squad that fails to
  // place would either drop a champion or throw in the middle of the campaign's
  // last battle, and the fallback (a clamped spot) is the lesser evil.
  function spawnBossSquad() {
    const squad = campaignRules.finalSquad;
    const created = [];
    squad.forEach((type, index) => {
      const boss = bossTypes.find((row) => row.type === type);
      if (!boss) throw new Error(`Unknown final-squad boss type "${type}".`);
      const bearing = (index / squad.length) * Math.PI * 2 + (random() - 0.5) * 0.28;
      let position = null;
      let fallback = null;
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const distance = 560 - attempt * 22;
        const angle = bearing + (attempt % 2 ? 1 : -1) * Math.floor(attempt / 2) * 0.16;
        const x = Math.max(boss.radius + 20, Math.min(world.width - boss.radius - 20, player.x + Math.cos(angle) * distance));
        const y = Math.max(boss.radius + 20, Math.min(world.height - boss.radius - 20, player.y + Math.sin(angle) * distance));
        if (!circleIntersectsObstacle(x, y, boss.radius + 8)) {
          position = { x, y };
          break;
        }
        if (!fallback) fallback = { x, y };
      }
      const spot = position ?? fallback;
      created.push(placeBoss(boss, spot.x, spot.y));
    });
    return created;
  }

  // A wild animal is not spawned by a search: the scenario picked its ground and
  // had it checked before the battle started (see game/tutorial-map.js), so this
  // only builds the body. It draws no random number either, which is what keeps a
  // scenario spawn out of the seeded stream entirely.
  //
  // The body is a normal enemy with three extra columns (`wild`, `species`,
  // `loot` from src/data/wilds.js): `state.enemies` moves, damages and draws it,
  // `state.wilds` is the roster the species rule and the battle loop read.
  function spawnWildAnimal(type, { x, y, angle = 0 }) {
    const stats = wildAnimalStats[type];
    if (!stats) throw new Error(`Unknown wild animal type "${type}".`);
    const unit = {
      ...stats,
      type,
      wild: true,
      maxHealth: stats.health,
      x,
      y,
      angle,
      homeX: x,
      homeY: y,
      homeAngle: angle,
      seesPlayer: false,
      lastSeenX: player.x,
      lastSeenY: player.y,
      searchTimer: 0,
      sweepTimer: 0,
      shotCooldown: 0,
      attackCooldown: 0,
      contactCooldown: 0,
      hitFlash: 0,
      knockedDown: 0,
      idleTarget: angle,
      idleTimer: 0,
    };
    state.enemies.push(unit);
    (state.wilds ??= []).push(unit);
    return unit;
  }

  // A scenario's own line: fixed composition (`formationPresets` in
  // data/formations.js) on ground its map check already cleared, so there is no
  // spawn ladder to climb and nothing to reject. `groundTier` still says "dry" -
  // the tests read the tier of every line on the field, and a preset that claimed
  // a different one would read as a failed spawn.
  function spawnPreset(name, { x, y, heading }) {
    const pattern = formationPresets[name];
    if (!pattern) throw new Error(`Unknown formation preset "${name}".`);
    const { halfWidth, halfHeight } = formationExtent(pattern);
    commitFormation({
      pattern,
      formationId: `preset-${name}`,
      centerX: x,
      centerY: y,
      heading,
      halfWidth,
      halfHeight,
      slotCoordinates: layoutSlots(pattern, x, y, heading),
      groundTier: "dry",
    });
    return state.formations[state.formations.length - 1];
  }

  function burst(x, y, color) {
    for (let index = 0; index < 9; index += 1) {
      const angle = random() * Math.PI * 2;
      const speed = 35 + random() * 115;
      spawnParticle(state.particles, {
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.2 + random() * 0.32,
        color,
      });
    }
  }

  function dust(x, y) {
    const rules = effectRules.dust;
    // One flattened ring sells the "something hit the ground here" beat, the
    // squares around it are the loose soil kicked up by the impact.
    spawnParticle(state.particles, {
      kind: "ring",
      x,
      y,
      size: rules.ring.radius,
      growth: rules.ring.growth,
      life: rules.ring.life,
      maxLife: rules.ring.life,
      color: rules.ring.color,
    });
    for (let index = 0; index < rules.count; index += 1) {
      const angle = random() * Math.PI * 2;
      const speed = 14 + random() * rules.spread;
      const life = rules.lifeMin + random() * (rules.lifeMax - rules.lifeMin);
      // Dust climbs instead of falling: it hangs in the air long enough to be
      // noticed against the pale grass.
      const rise = rules.riseMin + random() * (rules.riseMax - rules.riseMin);
      spawnParticle(state.particles, {
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.25 - rise,
        life,
        maxLife: life,
        size: rules.sizeMin + random() * (rules.sizeMax - rules.sizeMin),
        color: rules.colors[Math.floor(random() * rules.colors.length)],
      });
    }
  }

  function addMeleeEffect(x, y, angle, weapon) {
    const colors = {
      sword: "#f1dfb2",
      spike: "#d6ad62",
      ram: "#fff0a1",
      "dagger-axe": "#c97951",
      claw: "#df6947",
      stomp: "#e7bf69",
    };
    state.meleeEffects.push({
      x,
      y,
      angle,
      weapon,
      color: colors[weapon],
      life: weapon === "ram" ? 0.4 : 0.28,
      duration: weapon === "ram" ? 0.4 : 0.28,
    });
  }

  function damageEnemy(enemy, amount, source = "weapon") {
    if (enemy.destroyed) return;
    if (source === "ram" && enemy.collisionDamage === false) return;
    enemy.health -= amount;
    enemy.hitFlash = 0.16;
    addBloodStain(state, random, enemy.x, enemy.y, enemy.radius, enemy.boss || enemy.health <= 0);
    if (enemy.health <= 0) {
      enemy.destroyed = true;
      state.score += enemy.score;
      state.kills += 1;
      if (enemy.boss) {
        // The extraction opens when the *last* champion falls: a squad stage is
        // over once all of its bosses are down, not after the first one.
        state.bossDefeated = state.bosses.every((unit) => unit.destroyed);
      }
      dropLoot(enemy);
      burst(enemy.x, enemy.y, enemy.deathBurst);
      playTone(125, 0.12, "triangle", 0.03);
    } else {
      burst(enemy.x, enemy.y, "#e6c88d");
    }
    if (enemy.boss) updateHud();
  }

  // Whoever is closest gets the blow: in foot combat that has always meant the
  // player or a surviving companion, and the hired line is just one more body on
  // that side. The player starts as the candidate, so a tie still favours him;
  // the loop avoids the per-frame array sort this used to do.
  //
  // Two things are new with the wild animals of the tutorial, and both are
  // data-driven so no campaign battle changes:
  //   - `species`: a body never picks a target of its own species. Every campaign
  //     row leaves `species` undefined, so the check is skipped there and the
  //     campaign's target choice is bit-identical.
  //   - `state.wilds`: animals are candidates too, which is what lets the drill
  //     line fight the tiger and lets the tiger fight everything on the field.
  //     The roster is empty in every campaign battle, so the loop costs nothing.
  function getCombatTarget(enemy) {
    let best = player;
    let bestDistance = Math.hypot(player.x - enemy.x, player.y - enemy.y);
    const consider = (unit) => {
      if (!unit || unit === enemy || unit.destroyed || !(unit.health > 0)) return;
      if (enemy.species !== undefined && unit.species === enemy.species) return;
      const distance = Math.hypot(unit.x - enemy.x, unit.y - enemy.y);
      if (distance < bestDistance) {
        best = unit;
        bestDistance = distance;
      }
    };
    if (player.mode === "foot") {
      for (const companion of state.footCompanions) consider(companion);
    }
    for (const ally of state.allies ?? []) consider(ally);
    for (const wild of state.wilds ?? []) consider(wild);
    return best;
  }

  // `wild` first: an animal is neither hired nor a crew member, so the two
  // faction lanes below would hand it to a function that does not know it.
  function damageCombatTarget(target, amount, sourceX, sourceY) {
    if (target === player) damagePlayer(amount, sourceX, sourceY);
    else if (target.wild) damageEnemy(target, amount);
    else if (target.friendly) damageAlly(target, amount, sourceX, sourceY);
    else damageCompanion(target, amount, sourceX, sourceY);
  }

  // The brains live in behaviours.js, one per unit type, chosen by the row's
  // `behaviour` column. They are handed only the services they may use, so a
  // brain cannot reach into spawning, loot or the HUD.
  const behaviours = createBehaviours({
    player, moveEntitySafely, fireEnemy, damageCombatTarget, addMeleeEffect, burst, damageEnemy,
    getChariotTravelSpeed,
  });

  // Turn on the spot towards a bearing at a capped rate. The old code wrote the
  // facing straight from `atan2`, which is the snap the search used to open with.
  function turnToward(enemy, bearing, rate, delta) {
    const turn = shortestAngleDifference(enemy.angle, bearing);
    enemy.angle += clamp(turn, -rate * delta, rate * delta);
  }

  // Step along `bearing`, but only as fast as the unit is actually facing that
  // way: one that still has to come about turns on the spot instead of
  // moonwalking towards its goal.
  function strideAt(enemy, bearing, speed, delta) {
    const pace = speed * clamp(Math.cos(shortestAngleDifference(enemy.angle, bearing)), 0, 1);
    moveEntitySafely(enemy, Math.cos(bearing) * pace * delta, Math.sin(bearing) * pace * delta, enemy.radius);
  }

  // Look around a heading: re-roll a target inside `spread` of `base` on a timer
  // and ease towards it. Shared by the standing scan and the search sweep, so a
  // unit looking for something sweeps the ground the way it always has.
  // `!(idleTimer > 0)` is also false for NaN, so an enemy that never got a timer
  // (older save, a hand-built rig) reseeds instead of writing a non-finite
  // heading the way the old wanderAngle did.
  function scanGround(enemy, base, spread, rate, delta) {
    enemy.idleTimer -= delta;
    if (!(enemy.idleTimer > 0)) {
      enemy.idleTimer = IDLE_THINK_MIN + random() * IDLE_THINK_SPAN;
      enemy.idleTarget = base + (random() - 0.5) * 2 * spread;
    }
    turnToward(enemy, enemy.idleTarget ?? base, rate, delta);
  }

  // Guard has priority. Infantry still holding their rank do not leave the line
  // to go looking: the line is what they are there to protect, and a target that
  // walked out of their sight is exactly what the guard post is for. Only a unit
  // that has already broken rank (its formation is alerted), one fighting a
  // player on foot, or one with no rank to keep (a chariot, a boss) walks to the
  // sighting. (Ranged units are turned away in beginSearch, before this runs.)
  function mayLeavePost(enemy) {
    if (enemy.formationId === undefined) return true;
    if (!enemy.holdsRank) return true;
    if (player.mode === "foot") return true;
    return enemy.alerted === true;
  }

  // The frame a unit loses sight of its target: remember where, and work out
  // whether the unit may walk there. Everyone looks towards the spot, so a
  // target that vanishes reads as being looked for rather than as forgotten.
  function beginSearch(enemy) {
    enemy.idleTimer = 0; // the next sweep re-rolls around the sighting
    // Ranged units keep the behaviour they had: they hold their ground and
    // their fire discipline, so nothing about them starts hunting the target.
    if (enemy.ranged) {
      enemy.searchTimer = 0;
      enemy.sweepTimer = 0;
      return;
    }
    const sighting = Math.hypot(enemy.lastSeenX - enemy.x, enemy.lastSeenY - enemy.y);
    if (!mayLeavePost(enemy) || sighting > LOST_SIGHT_LOOK) {
      enemy.searchTimer = 0;
      enemy.sweepTimer = SEARCH_GLANCE;
      return;
    }
    const goal = searchPoint(player, enemy, enemy.lastSeenX, enemy.lastSeenY);
    const walk = Math.hypot(goal.x - enemy.x, goal.y - enemy.y) / (enemy.speed * SEARCH_JOG);
    enemy.searchTimer = Math.min(SEARCH_TIMEOUT_MAX, SEARCH_SWEEP + walk);
    enemy.sweepTimer = 0;
  }

  // Walk to the remembered sighting. The budget covers the walk and the sweep
  // that follows it, so a search is bounded even when the envelope is far away.
  // A unit that gets nowhere near the spot within the budget gives up and takes
  // the glance instead of walking after it forever.
  function searchWalk(enemy, delta) {
    enemy.searchTimer = Math.max(0, enemy.searchTimer - delta);
    const goal = searchPoint(player, enemy, enemy.lastSeenX, enemy.lastSeenY);
    const span = Math.hypot(goal.x - enemy.x, goal.y - enemy.y);
    if (span > SEARCH_ARRIVE && enemy.searchTimer > 0) {
      const bearing = Math.atan2(goal.y - enemy.y, goal.x - enemy.x);
      turnToward(enemy, bearing, SEARCH_TURN_RATE, delta);
      strideAt(enemy, bearing, enemy.speed * SEARCH_JOG, delta);
      return;
    }
    enemy.searchTimer = 0;
    // Arriving earns a proper sweep of the spot; running out of budget earns a
    // glance from wherever the search gave up.
    enemy.sweepTimer = Math.max(enemy.sweepTimer, span <= SEARCH_ARRIVE ? SEARCH_SWEEP : SEARCH_GLANCE);
  }

  // Look for the target where it was last seen. The sweep re-centres on the
  // sighting every frame, so a unit never turns its back on the spot while it is
  // still looking.
  function sweepSighting(enemy, delta) {
    enemy.sweepTimer = Math.max(0, enemy.sweepTimer - delta);
    if (enemy.sweepTimer === 0) {
      enemy.idleTimer = 0; // the standing scan re-rolls around the front again
      return;
    }
    const bearing = Math.atan2(enemy.lastSeenY - enemy.y, enemy.lastSeenX - enemy.x);
    scanGround(enemy, bearing, SEARCH_SPREAD, SEARCH_TURN_RATE, delta);
  }

  // Back to the post at a walk, turning into the heading instead of snapping
  // round to face it the way the old code did.
  function walkHome(enemy, delta) {
    const homeDistance = Math.hypot(enemy.homeX - enemy.x, enemy.homeY - enemy.y);
    if (homeDistance <= 8) {
      // Standing watch: rotation only - never a move - so the slot, the leash
      // and the footprint the renderer draws all stay exactly as they were.
      scanGround(enemy, enemy.homeAngle ?? enemy.angle, IDLE_SCAN_ANGLE, IDLE_TURN_RATE, delta);
      return;
    }
    const bearing = Math.atan2(enemy.homeY - enemy.y, enemy.homeX - enemy.x);
    turnToward(enemy, bearing, RETURN_TURN_RATE, delta);
    strideAt(enemy, bearing, enemy.speed * 0.55, delta);
  }

  function updateUnits(delta) {
    // The banner first: a wounded chariot may be topped up over the re-engage
    // threshold this frame, and the morale machine below should see the health
    // it actually has. The hired line ticks the same function on its own pass.
    tickFormationAura(state.formations, state.enemies, delta);
    // One pass decides, per formation, whether the player or a hired ally is
    // standing inside its footprint; the brains below only read the mirrored flag.
    updateFormationAlerts(state.formations, state.enemies, [player, ...(state.allies ?? [])]);
    for (const enemy of state.enemies) {
      if (enemy.destroyed) continue;
      enemy.knockedDown = Math.max(0, enemy.knockedDown - delta);
      enemy.attackCooldown = Math.max(0, enemy.attackCooldown - delta);
      if (enemy.knockedDown > 0) {
        resolveInfantryCollision(enemy);
        continue;
      }
      const target = getCombatTarget(enemy);
      const distance = Math.hypot(target.x - enemy.x, target.y - enemy.y);
      const seesTarget = distance < enemy.sightRange
        && hasLineOfSight(enemy.x, enemy.y, target.x, target.y);
      // The frame a unit loses sight of its target is the frame it starts to
      // look for it; a re-sighting ends the search where the unit stands.
      if (enemy.seesPlayer && !seesTarget) beginSearch(enemy);
      enemy.seesPlayer = seesTarget;
      enemy.shotCooldown = Math.max(0, enemy.shotCooldown - delta);
      enemy.hitFlash = Math.max(0, enemy.hitFlash - delta);
      enemy.contactCooldown = Math.max(0, enemy.contactCooldown - delta);
      const brain = behaviours[enemy.behaviour];
      // Morale has to run even with nothing in sight, so every brain gets a
      // `think` tick before the sight branch; only the chariot supplies one.
      brain.think?.(enemy, target, distance, seesTarget);

      if (seesTarget) {
        enemy.lastSeenX = target.x;
        enemy.lastSeenY = target.y;
        enemy.searchTimer = 0;
        enemy.sweepTimer = 0;
        const angle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
        enemy.angle = angle;
        brain.onSight(enemy, target, distance, angle, delta);
        // A blow that took the player's last health ends the frame here, exactly
        // where each inline branch used to return.
        if (state.mode === "over") return;

      } else if (enemy.searchTimer > 0 || enemy.sweepTimer > 0) {
        if (enemy.searchTimer > 0) searchWalk(enemy, delta);
        if (enemy.searchTimer === 0) sweepSighting(enemy, delta);
      } else {
        walkHome(enemy, delta);
      }
      resolveInfantryCollision(enemy);
    }
    separateEnemies();
  }

  // A deterministic pass so a chariot ploughing through a line cannot shove
  // infantry into the same pixel. Nothing else separates enemies from each
  // other — `resolveInfantryCollision` only ever pushes a unit away from the
  // player — so without this the survivors stack and read as a single sprite.
  // The sweep order is fixed, so re-walking the list stays deterministic.
  function separateEnemies() {
    for (let pass = 0; pass < SEPARATION_PASSES; pass += 1) {
      let moved = false;
      for (let first = 0; first < state.enemies.length; first += 1) {
        const front = state.enemies[first];
        if (front.destroyed || front.boss) continue;
        for (let second = first + 1; second < state.enemies.length; second += 1) {
          const back = state.enemies[second];
          if (back.destroyed || back.boss) continue;
          const dx = back.x - front.x;
          const dy = back.y - front.y;
          // sqrt instead of Math.hypot: this is the only O(n^2) loop in the sim
          // and hypot is a libm call with overflow handling (measured 4.4x
          // slower here, 6.97us -> 1.59us per frame at 40 enemies).
          const span = Math.sqrt(dx * dx + dy * dy);
          const minimum = front.radius + back.radius - SEPARATION_MIN_OVERLAP;
          if (span >= minimum) continue;
          // Only the later unit of the pair moves, so the pass is order-stable
          // and a fully coincident pair still resolves along a fixed axis.
          const push = minimum - span;
          const nx = span > 0 ? dx / span : 1;
          const ny = span > 0 ? dy / span : 0;
          const beforeX = back.x;
          const beforeY = back.y;
          moveEntitySafely(back, nx * push, ny * push, back.radius);
          // Ground that slows a unit (shallows, sand) scales this push too, so a
          // jammed crowd may need the extra passes; anything that did not budge
          // at all is blocked by an obstacle and further passes cannot help.
          if (back.x !== beforeX || back.y !== beforeY) moved = true;
        }
      }
      if (!moved) return;
    }
  }

  return { resolveInfantryCollision, spawnFormation, spawnPreset, spawnWildAnimal, spawnBoss, spawnBossSquad, burst, dust, addMeleeEffect, damageEnemy, updateUnits, separateEnemies };
}
