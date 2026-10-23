import { clamp } from "../../utils/math.js";
import { chasePoint, leashRadius } from "./formations.js";

// The per-type answer to "my target is in sight - what do I do this frame?".
//
// All four brains used to be adjacent branches of one if/else chain inside
// `updateUnits`, ordered so that the hero-specific cases (elephant, lion,
// catapult, chariot) shadowed the generic ones. That order was invisible in the
// data: `chariot-archer` only behaved like an archer because its branch happened
// to sit above the melee one. Here each type names its brain in the data table,
// and the brain reads its own tuning off the same row.
//
// A brain is a factory-built closure, not a class: it holds no state of its own
// (everything lives on the enemy object, so a save/replay sees one object per
// unit), there is no `this` to lose when a hook is passed around, and 小游戏
// builds with `enhance: false`, so no syntax beyond what the codebase already
// uses goes through the legacy babel pass.

// Arrivals ease out below this distance instead of stepping at full speed into a
// deadband, which is what made units chatter in and out of their post.
const GUARD_EASE = 22;
const GUARD_ARRIVE = 6;

// A chariot only trades hull damage back when the player is genuinely driving
// into it; being brushed while parked just knocks the rammer down.
const RAM_INTERVAL = 1.45;
const RAM_COUNTER_SPEED = 65;

export function createBehaviours({
  player, moveEntitySafely, fireEnemy, damageCombatTarget, addMeleeEffect, burst, damageEnemy,
  getChariotTravelSpeed,
}) {
  function advance(enemy, angle, delta) {
    moveEntitySafely(enemy, Math.cos(angle) * enemy.speed * delta, Math.sin(angle) * enemy.speed * delta, enemy.radius);
  }

  function retreat(enemy, angle, delta) {
    moveEntitySafely(enemy, -Math.cos(angle) * enemy.speed * delta, -Math.sin(angle) * enemy.speed * delta, enemy.radius);
  }

  function strike(enemy, target, angle) {
    enemy.attackCooldown = enemy.attackInterval;
    addMeleeEffect(target.x, target.y, angle, enemy.weapon);
    damageCombatTarget(target, enemy.damage, enemy.x, enemy.y);
  }

  // Rank-preserving guard. Nothing here reads another unit's live position, so
  // guards cannot converge on one shared post and the post cannot orbit with an
  // archer that is backing away.
  function guardPost(enemy, target, distance, angle, delta) {
    const homeDistance = Math.hypot(player.x - enemy.homeX, player.y - enemy.homeY);
    const bearing = Math.atan2(player.y - enemy.homeY, player.x - enemy.homeX);
    // Stop at the honest reach, not at the weapon range: a unit whose `range`
    // is shorter than its own body plus the player's would walk into the hull
    // and be pushed back out every frame.
    const reach = Math.max(enemy.range, enemy.radius + target.radius + 2);
    const lean = clamp(homeDistance - reach, 0, leashRadius(player, enemy));
    if (lean > 0) {
      const guardX = enemy.homeX + Math.cos(bearing) * lean;
      const guardY = enemy.homeY + Math.sin(bearing) * lean;
      const postDistance = Math.hypot(guardX - enemy.x, guardY - enemy.y);
      if (postDistance > GUARD_ARRIVE) {
        const guardAngle = Math.atan2(guardY - enemy.y, guardX - enemy.x);
        const pace = enemy.speed * clamp(postDistance / GUARD_EASE, 0, 1);
        moveEntitySafely(enemy, Math.cos(guardAngle) * pace * delta, Math.sin(guardAngle) * pace * delta, enemy.radius);
      }
    }
    if (distance <= enemy.range && enemy.attackCooldown === 0) strike(enemy, target, angle);
  }

  // An alerted line leaves its rank. The goal is the player clamped to the
  // unit's own envelope (leash + one chase span), so a formation cannot be
  // kited apart, and it still stops at the honest reach instead of stepping
  // into the hull.
  function closeOnTarget(enemy, target, distance, angle, delta) {
    const goal = chasePoint(player, enemy, target.x, target.y);
    const reach = Math.max(enemy.range, enemy.radius + target.radius + 2);
    if (Math.hypot(goal.x - enemy.x, goal.y - enemy.y) > reach) {
      advance(enemy, Math.atan2(goal.y - enemy.y, goal.x - enemy.x), delta);
      return;
    }
    if (distance <= enemy.range && enemy.attackCooldown === 0) strike(enemy, target, angle);
  }

  // spear, ge, heavy: close to weapon range, then swing on the row's interval.
  // While the player is mounted these are the units that hold the line instead -
  // leaning off their slot, not abandoning it - until their formation is alerted.
  function infantryOnSight(enemy, target, distance, angle, delta) {
    if (enemy.holdsRank && player.mode !== "foot") {
      if (enemy.alerted) closeOnTarget(enemy, target, distance, angle, delta);
      else guardPost(enemy, target, distance, angle, delta);
      return;
    }
    if (distance > enemy.range) advance(enemy, angle, delta);
    else if (enemy.attackCooldown === 0) strike(enemy, target, angle);
  }

  // chariot: ram whatever it has seen. `contactCooldown` is the ram's cooldown;
  // the hull contact resolver in enemies.js owns the other one.
  function cavalryOnSight(enemy, target, distance, angle, delta) {
    if (distance > enemy.radius + target.radius + 2) {
      advance(enemy, angle, delta);
      return;
    }
    if (enemy.contactCooldown !== 0) return;
    enemy.contactCooldown = RAM_INTERVAL;
    addMeleeEffect(target.x, target.y, angle, "ram");
    burst(target.x, target.y, "#ffe08a");
    if (target === player && getChariotTravelSpeed(player) > RAM_COUNTER_SPEED) damageEnemy(enemy, 1);
    damageCombatTarget(target, enemy.damage, enemy.x, enemy.y);
  }

  // archer, slinger, chariot-archer: two bands. Inside `retreat` it backs off,
  // and it only looses a shot from beyond `minFire` - shooting point blank would
  // be free damage the player cannot answer.
  function rangedOnSight(enemy, target, distance, angle, delta) {
    if (distance < enemy.kite.retreat) retreat(enemy, angle, delta);
    if (distance < enemy.range && distance > enemy.kite.minFire && enemy.shotCooldown === 0) {
      fireEnemy(enemy, angle, target);
    }
  }

  // elephant, lion, catapult: one `band`, two kinds of answer. A melee boss
  // closes to `band[1]` and swings; the catapult backs off inside `band[0]` and
  // lobs stones from anywhere inside its much longer `range`.
  function bossOnSight(enemy, target, distance, angle, delta) {
    if (distance < enemy.band[0]) retreat(enemy, angle, delta);
    else if (distance > enemy.band[1]) advance(enemy, angle, delta);
    if (enemy.attack.kind === "shot") {
      if (distance < enemy.range && enemy.shotCooldown === 0) fireEnemy(enemy, angle, target);
      return;
    }
    if (distance > enemy.band[1] || enemy.attackCooldown !== 0) return;
    enemy.attackCooldown = enemy.attack.interval;
    addMeleeEffect(target.x, target.y, angle, enemy.attack.effect);
    damageCombatTarget(target, enemy.damage, enemy.x, enemy.y);
  }

  return {
    infantry: { onSight: infantryOnSight },
    ranged: { onSight: rangedOnSight },
    cavalry: { onSight: cavalryOnSight },
    boss: { onSight: bossOnSight },
  };
}
