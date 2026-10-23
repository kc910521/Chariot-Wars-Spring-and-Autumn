import { addBloodStain } from "../blood.js";
import { effectRules } from "../../data/rules.js";
import { clamp, shortestAngleDifference } from "../../utils/math.js";
import { rectHitsAnyObstacle, rectTerrain } from "../elements.js";
import { createBehaviours } from "./behaviours.js";
import { formationExtent, formationGroundExtent, leashPoint, updateFormationAlerts } from "./formations.js";

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

// How many places a formation looks at before settling. The scan keeps the best
// ground it has seen instead of taking the first clear patch, so this is a search
// budget rather than a retry count: a wall in the annulus it searches costs an
// attempt, not the spawn.
const FORMATION_SPAWN_ATTEMPTS = 96;

function getChariotTravelSpeed(player) {
  return Math.abs(player.speed);
}

export function createEnemies({
  bossTypes, enemyStats, formationPatterns, state, player, world, campaign, random,
  circleIntersectsObstacle, moveEntitySafely, getChariotCollisionDamage, playTone, updateHud,
  hasLineOfSight, fireEnemy, damagePlayer, damageCompanion,
}) {
  // `random` is late-bound by the caller so every gameplay roll (and the
  // particle spray) draws from the PRNG of the battle in progress, keeping a
  // battle reproducible from its seed.

  function dropLoot(enemy) {
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

  function layoutSlots(pattern, centerX, centerY, heading) {
    return pattern.slots.map(([, slotX, slotY]) => ({
      x: centerX + slotX * Math.cos(heading) - slotY * Math.sin(heading),
      y: centerY + slotX * Math.sin(heading) + slotY * Math.cos(heading),
    }));
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
        investigateTimer: 0,
        shotCooldown: 0.8 + random() * 1.5,
        homeAngle: heading,
        // A full-strength random phase, so a formation does not re-roll every
        // unit's heading on the same frame and twitch in unison.
        idleTarget: heading,
        idleTimer: random() * (IDLE_THINK_MIN + IDLE_THINK_SPAN),
        hitFlash: 0,
        contactCooldown: 0,
        attackCooldown: 0.8 + random() * 0.8,
        knockedDown: 0,
      });
    }
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

    // Bosses idle before they spot the player, so they need a real facing to fall
    // back on: `spawnBoss` never set `wanderAngle`, and the idle branch wrote
    // `undefined` into `angle`, which is a non-finite canvas transform.
    const aim = Math.atan2(player.y - position.y, player.x - position.x);
    state.boss = {
      ...boss,
      boss: true,
      maxHealth: boss.health,
      x: position.x,
      y: position.y,
      angle: aim,
      homeAngle: aim,
      idleTarget: aim,
      idleTimer: random() * (IDLE_THINK_MIN + IDLE_THINK_SPAN),
      homeX: position.x,
      homeY: position.y,
      seesPlayer: false,
      lastSeenX: player.x,
      lastSeenY: player.y,
      investigateTimer: 0,
      shotCooldown: 2,
      attackCooldown: 2.2,
      contactCooldown: 0,
      hitFlash: 0,
      knockedDown: 0,
    };
    state.enemies.push(state.boss);
  }

  function burst(x, y, color) {
    for (let index = 0; index < 9; index += 1) {
      const angle = random() * Math.PI * 2;
      const speed = 35 + random() * 115;
      state.particles.push({
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
    state.particles.push({
      kind: "ring",
      x,
      y,
      vx: 0,
      vy: 0,
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
      state.particles.push({
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
      if (enemy.boss) state.bossDefeated = true;
      dropLoot(enemy);
      burst(enemy.x, enemy.y, enemy.deathBurst);
      playTone(125, 0.12, "triangle", 0.03);
    } else {
      burst(enemy.x, enemy.y, "#e6c88d");
    }
    if (enemy.boss) updateHud();
  }

  function getCombatTarget(enemy) {
    if (player.mode !== "foot") return player;
    return [player, ...state.footCompanions]
      .filter((target) => !target.destroyed && target.health > 0)
      .sort((first, second) =>
        Math.hypot(first.x - enemy.x, first.y - enemy.y) - Math.hypot(second.x - enemy.x, second.y - enemy.y))[0] ?? player;
  }

  function damageCombatTarget(target, amount, sourceX, sourceY) {
    if (target === player) damagePlayer(amount, sourceX, sourceY);
    else damageCompanion(target, amount, sourceX, sourceY);
  }

  // The brains live in behaviours.js, one per unit type, chosen by the row's
  // `behaviour` column. They are handed only the services they may use, so a
  // brain cannot reach into spawning, loot or the HUD.
  const behaviours = createBehaviours({
    player, moveEntitySafely, fireEnemy, damageCombatTarget, addMeleeEffect, burst, damageEnemy,
    getChariotTravelSpeed,
  });

  function updateUnits(delta) {
    // One pass decides, per formation, whether the player is standing inside its
    // footprint; the brains below only read the mirrored flag.
    updateFormationAlerts(state.formations, state.enemies, player);
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
      enemy.seesPlayer = seesTarget;
      enemy.shotCooldown = Math.max(0, enemy.shotCooldown - delta);
      enemy.hitFlash = Math.max(0, enemy.hitFlash - delta);
      enemy.contactCooldown = Math.max(0, enemy.contactCooldown - delta);

      if (seesTarget) {
        enemy.lastSeenX = target.x;
        enemy.lastSeenY = target.y;
        enemy.investigateTimer = 1.8;
        const angle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
        enemy.angle = angle;
        behaviours[enemy.behaviour].onSight(enemy, target, distance, angle, delta);
        // A blow that took the player's last health ends the frame here, exactly
        // where each inline branch used to return.
        if (state.mode === "over") return;

      } else if (enemy.investigateTimer > 0) {
        enemy.investigateTimer = Math.max(0, enemy.investigateTimer - delta);
        // `ranged` is the "shoots, so it holds position" flag, not the brain: the
        // catapult is a boss, lobs stones and still walks to a sighting.
        if (!enemy.ranged) {
          const goal = leashPoint(player, enemy, enemy.lastSeenX, enemy.lastSeenY);
          const angle = Math.atan2(goal.y - enemy.y, goal.x - enemy.x);
          enemy.angle = angle;
          if (Math.hypot(goal.x - enemy.x, goal.y - enemy.y) > 34) {
            moveEntitySafely(enemy, Math.cos(angle) * enemy.speed * 0.62 * delta, Math.sin(angle) * enemy.speed * 0.62 * delta, enemy.radius);
          }
        }
      } else {
        const homeDistance = Math.hypot(enemy.homeX - enemy.x, enemy.homeY - enemy.y);
        if (homeDistance > 8) {
          const angle = Math.atan2(enemy.homeY - enemy.y, enemy.homeX - enemy.x);
          enemy.angle = angle;
          moveEntitySafely(enemy, Math.cos(angle) * enemy.speed * 0.55 * delta, Math.sin(angle) * enemy.speed * 0.55 * delta, enemy.radius);
        } else {
          // Idle units scan the ground in front of their formation. This is
          // rotation only - never a move - so the slot, the leash and the
          // renderer's footprint all stay exactly as they were; and it only runs
          // while the player is out of sight, because every branch above that
          // sees the target has already written a facing.
          enemy.idleTimer -= delta;
          // `!(idleTimer > 0)` is also false for NaN, so an enemy that never got
          // a timer (older save, a hand-built test rig) re-seeds itself instead
          // of writing a non-finite heading the way the old `wanderAngle` did.
          if (!(enemy.idleTimer > 0)) {
            enemy.idleTimer = IDLE_THINK_MIN + random() * IDLE_THINK_SPAN;
            enemy.idleTarget = (enemy.homeAngle ?? enemy.angle) + (random() - 0.5) * 2 * IDLE_SCAN_ANGLE;
          }
          const turn = shortestAngleDifference(enemy.angle, enemy.idleTarget ?? enemy.homeAngle);
          enemy.angle += clamp(turn, -IDLE_TURN_RATE * delta, IDLE_TURN_RATE * delta);
        }
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

  return { resolveInfantryCollision, spawnFormation, spawnBoss, burst, dust, addMeleeEffect, damageEnemy, updateUnits, separateEnemies };
}
