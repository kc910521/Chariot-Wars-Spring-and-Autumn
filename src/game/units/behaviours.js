import { chariotTactics } from "../../data/formations.js";
import { clamp } from "../../utils/math.js";
import { CHARIOT_INTENT, chariotIntent, isAtHome, updateChariotState } from "./chariot.js";
import { defendedPoint, leashRadius } from "./formations.js";

// The per-type answer to "my target is in sight - what do I do this frame?".
//
// All four brains used to be adjacent branches of one if/else chain inside
// `updateUnits`, ordered so that the hero-specific cases (elephant, lion,
// catapult, chariot) shadowed the generic ones. That order was invisible in the
// data: `chariot-archer` only behaved like an archer because its branch happened
// to sit above the melee one. Here each type names its brain in the data table,
// and the brain reads its own tuning off the same row.
//
// A brain may expose two hooks: `think`, run every frame whether or not the
// target is visible (morale needs that), and `onSight`, run only while it is.
// Both are factory-built closures, not methods: they hold no state of their own
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
  getChariotTravelSpeed, paths = null,
}) {
  // Walk at a point rather than along a heading. Without a path system this is
  // the old `advance` step with the angle to the goal - the same `atan2` the
  // brains used to compute themselves, so the arithmetic is unchanged to the last
  // bit. With one, the heading comes from the route and the *pace* is untouched: a
  // unit still travels at its own speed, it only picks a longer way round. Returns
  // the angle it walked at, for the brains that also turn the hull to face it.
  function advanceTo(enemy, goalX, goalY, delta, pace = enemy.speed) {
    const point = paths === null ? null : paths.waypoint(enemy, goalX, goalY);
    const targetX = point === null ? goalX : point.x;
    const targetY = point === null ? goalY : point.y;
    const angle = Math.atan2(targetY - enemy.y, targetX - enemy.x);
    moveEntitySafely(enemy, Math.cos(angle) * pace * delta, Math.sin(angle) * pace * delta, enemy.radius);
    return angle;
  }

  function retreat(enemy, angle, delta) {
    moveEntitySafely(enemy, -Math.cos(angle) * enemy.speed * delta, -Math.sin(angle) * enemy.speed * delta, enemy.radius);
  }

  // The distance at which a melee unit is genuinely at its target: its weapon
  // range, but never shorter than its own body plus the radius of the target.
  // A unit whose `range` is shorter than that pair of radii would have to stand
  // inside the hull to swing, and `resolveInfantryCollision` shoves it back out
  // every frame (the heavy: 16px body, 27px weapon, 17px hull). Movement and the
  // swing both read this, so the post a unit walks to and the distance it
  // strikes at can never disagree.
  function honestReach(enemy, target) {
    return Math.max(enemy.range, enemy.radius + target.radius + 2);
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
    // The post leans towards whoever the unit is actually facing, not towards the
    // player: since a hired line can be the closer target, using `player` here
    // would lean a guard away from the body inside its reach.
    const homeDistance = Math.hypot(target.x - enemy.homeX, target.y - enemy.homeY);
    const bearing = Math.atan2(target.y - enemy.homeY, target.x - enemy.homeX);
    // The post and the swing both sit at the honest reach.
    const reach = honestReach(enemy, target);
    const lean = clamp(homeDistance - reach, 0, leashRadius(target, enemy));
    if (lean > 0) {
      const guardX = enemy.homeX + Math.cos(bearing) * lean;
      const guardY = enemy.homeY + Math.sin(bearing) * lean;
      const postDistance = Math.hypot(guardX - enemy.x, guardY - enemy.y);
      if (postDistance > GUARD_ARRIVE) {
        const pace = enemy.speed * clamp(postDistance / GUARD_EASE, 0, 1);
        advanceTo(enemy, guardX, guardY, delta, pace);
      }
    }
    if (distance <= reach && enemy.attackCooldown === 0) strike(enemy, target, angle);
  }

  // An alerted line leaves its rank. The goal is the player anywhere on the
  // line's own ground (`defendedPoint`), not clamped to this unit's private
  // envelope: a private envelope minus the weapon's reach left a back-rank heavy
  // 46px of room to manoeuvre in, so it stood inside its own formation with its
  // swing ready and never touched the hull. The line as a whole still stops at
  // its release border, so it cannot be kited off the field, and the walk still
  // ends at the honest reach instead of stepping into the hull.
  function closeOnTarget(enemy, target, distance, angle, delta) {
    const goal = defendedPoint(player, enemy, target.x, target.y);
    const reach = honestReach(enemy, target);
    if (Math.hypot(goal.x - enemy.x, goal.y - enemy.y) > reach) {
      advanceTo(enemy, goal.x, goal.y, delta);
      return;
    }
    if (distance <= reach && enemy.attackCooldown === 0) strike(enemy, target, angle);
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
    if (distance > honestReach(enemy, target)) advanceTo(enemy, target.x, target.y, delta);
    else if (enemy.attackCooldown === 0) strike(enemy, target, angle);
  }

  // chariot: the shared morale machine in `chariot.js` decides whether this
  // frame is a charge, a run home or a last stand; this brain only supplies the
  // enemy's legs. `contactCooldown` is the ram's cooldown; the hull contact
  // resolver in enemies.js owns the other one.
  //
  // `chariot-archer` deliberately keeps the ranged brain: its answer to pressure
  // is distance, not a last stand, so it never enters this state machine.
  function cavalrySituation(enemy, target, distance, seesTarget) {
    return {
      health: enemy.health,
      maxHealth: enemy.maxHealth,
      // A body only counts as "caught" if it can actually be seen; a chariot is
      // not cornered by something it cannot fight.
      inMelee: seesTarget && distance <= enemy.radius + target.radius + 6,
      hasTarget: seesTarget,
    };
  }

  // Morale is ticked every frame, not only while the target is in sight, so a
  // chariot that ran behind a tree still knows it is disengaged when it returns.
  function cavalryThink(enemy, target, distance, seesTarget) {
    updateChariotState(enemy, cavalrySituation(enemy, target, distance, seesTarget));
  }

  // The one order that overrides the loop's "face the target" heading: run for
  // the home slot at the shared regroup pace.
  function regroup(enemy, delta) {
    const pace = enemy.speed * chariotTactics.regroupSpeed;
    enemy.angle = advanceTo(enemy, enemy.homeX, enemy.homeY, delta, pace);
  }

  function ramTarget(enemy, target, angle) {
    enemy.contactCooldown = RAM_INTERVAL;
    addMeleeEffect(target.x, target.y, angle, "ram");
    burst(target.x, target.y, "#ffe08a");
    if (target === player && getChariotTravelSpeed(player) > RAM_COUNTER_SPEED) damageEnemy(enemy, 1);
    damageCombatTarget(target, enemy.damage, enemy.x, enemy.y);
  }

  function cavalryOnSight(enemy, target, distance, angle, delta) {
    const intent = chariotIntent(enemy.chariotState);
    if (intent === CHARIOT_INTENT.REGROUP) {
      // Not home yet: break contact and run. Once home, stand and watch - a
      // wounded chariot does not charge back out at 21%, and only a body that
      // actually reaches the hull (which ticks it into FIGHT_TO_DEATH) is rammed.
      if (!isAtHome(enemy.x, enemy.y, enemy.homeX, enemy.homeY)) regroup(enemy, delta);
      return;
    }
    if (intent === CHARIOT_INTENT.HOLD) {
      // Defensive: a sighted target normally ticks HOLD into CHASE, but if the
      // machine has not been ticked yet a parked hull is still not a free hit.
      if (distance <= enemy.radius + target.radius + 2 && enemy.contactCooldown === 0) {
        ramTarget(enemy, target, angle);
      }
      return;
    }
    // ENGAGE, including the latched last stand.
    if (distance > enemy.radius + target.radius + 2) {
      advanceTo(enemy, target.x, target.y, delta);
      return;
    }
    if (enemy.contactCooldown !== 0) return;
    ramTarget(enemy, target, angle);
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
    else if (distance > enemy.band[1]) advanceTo(enemy, target.x, target.y, delta);
    if (enemy.attack.kind === "shot") {
      if (distance < enemy.range && enemy.shotCooldown === 0) fireEnemy(enemy, angle, target);
      return;
    }
    if (distance > enemy.band[1] || enemy.attackCooldown !== 0) return;
    enemy.attackCooldown = enemy.attack.interval;
    addMeleeEffect(target.x, target.y, angle, enemy.attack.effect);
    damageCombatTarget(target, enemy.damage, enemy.x, enemy.y);
  }

  // A wild animal: the tiger of the tutorial (src/data/wilds.js). It has no line
  // to defend and no morale to break, so - unlike every other brain - there is no
  // `think` pass and no second opinion about the target: whoever
  // `getCombatTarget` hands it is charged, and it keeps charging until the body
  // is dead. `honestReach` keeps the claws on the hull instead of inside it
  // (a 20px body with a 46px reach would otherwise have to overlap the player).
  function wildOnSight(enemy, target, distance, angle, delta) {
    const reach = honestReach(enemy, target);
    if (distance > reach) {
      advanceTo(enemy, target.x, target.y, delta);
      return;
    }
    if (enemy.attackCooldown !== 0) return;
    strike(enemy, target, angle);
  }

  return {
    infantry: { onSight: infantryOnSight },
    ranged: { onSight: rangedOnSight },
    cavalry: { think: cavalryThink, onSight: cavalryOnSight },
    boss: { onSight: bossOnSight },
    wild: { onSight: wildOnSight },
  };
}
