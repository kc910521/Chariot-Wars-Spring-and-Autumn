import {
  allyStats, enemyStats, formationOrders, formationPresets, formationRules, hireCount, tierForIndex,
} from "../../data/formations.js";
import { soundBorrowed, soundCues } from "../../data/sounds.js";
import { clamp } from "../../utils/math.js";
import { addBloodStain } from "../blood.js";
import { addCorpse } from "../corpses.js";
import { formationExtent, formationGroundExtent, isInsideFormation, layoutSlots, tickFormationAura } from "./formations.js";
import { advanceOrders } from "./formation-orders.js";
import {
  CHARIOT_INTENT, CHARIOT_STATE, chariotIntent, isAtHome, updateChariotState,
} from "./chariot.js";

// The hired line. It is not a second player: every unit here is a clone of an
// enemy row, re-painted green, leashed to the slot it spawned on, and driven by
// one small brain per class. The interesting one is the chariot, whose morale
// (CHASE -> FLEE -> FIGHT_TO_DEATH) is the shared machine in `chariot.js` - the
// enemy line drives the same one, only with different legs.
//
// Two rules shape everything below:
// - The line guards its own ground. Foot allies may step `meleeRange` toward an
//   enemy and are then clamped to `leash` around their slot; nothing charges
//   across the map the way an alerted enemy line does. That keeps a 1000-coin
//   purchase from playing the battle for the player.
// - Nothing here rolls dice. Placement walks a fixed list of bearings and the
//   brains break ties by list order, so a seeded battle stays reproducible with
//   or without a hired line.
//
// A player standing in his own line may give it one of two orders (出击 / 结阵,
// `formation-orders.js`). `出击` glues the line's centre to the chariot, so every
// slot - and the aura's footprint with them - travels with the player, and the
// men run to catch up. `结阵` sets the ring down where it stands and marks every
// body that is off its station `returning`; those bodies run home, and they fight
// whatever crosses their path on the way (归位开打). The two legs live at the
// bottom of this file because they are the hired line's alone: an enemy formation
// would answer the same orders with its own legs.

const SEPARATION_PASSES = 2;
const SEPARATION_MIN_OVERLAP = 2;
// A foot ally this close to its slot is home: walking further would jitter on the
// spot every frame. The number lives in the row with the rest of the guard kit.
const HOME_EPSILON = formationRules.engage.homeEpsilon;

// A foot bow, as opposed to a slinger or a chariot that happens to carry one: the
// body whose whole job is the arrow, and the only one the line paints in its
// second colour (`formationRules.visual.bowRobe`).
function isFootBow(stats) {
  return stats.visual.kind === "foot" && stats.projectile === "arrow";
}

// Bearings to try for a line, in order: left of the chariot, right, behind,
// then the two rear quarters. The line's facing is the bearing itself, so a line
// placed on the left of the player looks left - away from him - and its front
// rank is the one facing the field.
const SPAWN_OFFSETS = [-Math.PI / 2, Math.PI / 2, Math.PI, -Math.PI * 0.75, Math.PI * 0.75, 0];
const SPAWN_DISTANCES = [210, 250, 290];

// The state machine, thresholds and intents live in `chariot.js`; this file only
// supplies the ally-specific situation and the legs that answer the intent. The
// banner beat is in `formations.js`, because the enemy line ticks the same one.

// An enemy chariot that has left the line it belongs to: the target the friendly
// chariot chases. Reusing the visible border means "left the formation" is
// exactly what the player can see, not an invisible distance rule.
export function isLooseChariot(enemy, formations = []) {
  if (!enemy || enemy.destroyed || !enemy.vehicle) return false;
  if (enemy.formationId === undefined) return true;
  const line = formations.find((formation) => formation.id === enemy.formationId);
  if (!line) return true;
  return !isInsideFormation(line, enemy.x, enemy.y);
}


export function createAllies({
  state, player, world, campaign,
  moveEntitySafely, hasLineOfSight, circleIntersectsObstacle,
  rectHitsAnyObstacle, rectTerrain,
  damageEnemy, fireAllyShot, addMeleeEffect, burst, playSound = () => {},
  // Optional route planner. Every step a hired unit takes goes through
  // `stepToward`, so this is the whole wiring: with it, a step that would walk
  // into a wall is redirected at the next waypoint; without it the unit walks the
  // straight line it always did.
  paths = null,
}) {
  const { engage, chariot: chariotConfig } = formationRules;

  // Two rows of the roster ride: the 马砲铁阵's chariots and the 攻坚砲营's
  // chariot-archers. Only the first answers to the morale machine, because a
  // chariot archer is a horseman with a bow and fights like the bows it rides
  // with - which is why the vehicle flag alone is not the question.
  function isChariot(unit) {
    return Boolean(unit.vehicle) && !unit.ranged;
  }

  function nearestEnemy(ally, range, { requireSight = false } = {}) {
    let best = null;
    let bestDistance = range;
    for (const enemy of state.enemies) {
      if (enemy.destroyed) continue;
      const distance = Math.hypot(enemy.x - ally.x, enemy.y - ally.y);
      if (distance > bestDistance) continue;
      if (requireSight && !hasLineOfSight(ally.x, ally.y, enemy.x, enemy.y)) continue;
      best = enemy;
      bestDistance = distance;
    }
    return best;
  }

  function stepToward(ally, x, y, delta, speedScale = 1) {
    const distance = Math.hypot(x - ally.x, y - ally.y);
    if (distance < 0.5) return distance;
    // Only the *heading* may bend: every caller uses the return value as "am I
    // there yet?", so it stays the distance to the real goal even when this step
    // is walking towards a waypoint on the way there.
    const point = paths === null ? null : paths.waypoint(ally, x, y);
    const stepX = (point === null ? x : point.x) - ally.x;
    const stepY = (point === null ? y : point.y) - ally.y;
    const span = Math.hypot(stepX, stepY);
    if (span === 0) return distance;
    moveEntitySafely(ally, (stepX / span) * ally.speed * speedScale * delta, (stepY / span) * ally.speed * speedScale * delta, ally.radius);
    return distance;
  }

  // A foot ally's goal never leaves the envelope: the point is clamped to
  // `engage.leash` around the slot, so a unit lured by a chariot walks out a
  // little and then holds, exactly as the line's border promised.
  function clampToHome(ally, x, y, span) {
    const dx = x - ally.homeX;
    const dy = y - ally.homeY;
    const distance = Math.hypot(dx, dy);
    if (distance === 0 || distance <= span) return { x, y };
    return { x: ally.homeX + (dx / distance) * span, y: ally.homeY + (dy / distance) * span };
  }

  function holdGround(ally, delta, speedScale = 0.65) {
    const homeDistance = Math.hypot(ally.homeX - ally.x, ally.homeY - ally.y);
    if (homeDistance > HOME_EPSILON) {
      ally.angle = Math.atan2(ally.homeY - ally.y, ally.homeX - ally.x);
      stepToward(ally, ally.homeX, ally.homeY, delta, speedScale);
      return;
    }
    const threat = nearestEnemy(ally, ally.sightRange ?? 450);
    ally.angle = threat
      ? Math.atan2(threat.y - ally.y, threat.x - ally.x)
      : ally.homeAngle;
  }

  // The line's own shot, in one place: a bow looses an arrow and the captured
  // engine throws a stone, but both hand the projectile system a target, a reach
  // and the row's own `projectile`/`speed` - the flight is the system's business.
  function looseShot(ally, target, range) {
    ally.shotCooldown = ally.fireInterval ?? 2;
    fireAllyShot({
      x: ally.x,
      y: ally.y,
      targetX: target.x,
      targetY: target.y,
      damage: ally.damage,
      range,
      // Far enough out of the body that the shot does not start inside it, which
      // matters for the 36px engine behind a rank of heavies.
      originOffset: Math.max(16, ally.radius + 2),
      kind: ally.projectile ?? "arrow",
      speed: ally.projectileSpeed,
    });
  }

  // 结阵: the ring stopped where the line was set down, so this leg ends. A body
  // that reaches its station drops its own `returning` flag and is handed back to
  // the ordinary guard brain next frame - there is no formation state to leave,
  // which is why a second 结阵 moments later costs nothing.
  //
  // 归位开打: walking home is not a truce. A body ordered back to a station that
  // an enemy is standing beside swings (or shoots) at it on the way, without
  // breaking step. Otherwise 结阵 in the middle of a fight was a free flank: the
  // line walked home with its back turned for a second and a half.
  function runToStation(ally, delta) {
    if (Math.hypot(ally.homeX - ally.x, ally.homeY - ally.y) <= HOME_EPSILON) {
      ally.returning = false;
      ally.angle = ally.homeAngle;
      return;
    }
    const target = nearestEnemy(ally, Math.max(ally.range, ally.radius + 26), { requireSight: Boolean(ally.ranged) });
    if (target) {
      ally.angle = Math.atan2(target.y - ally.y, target.x - ally.x);
      if (ally.ranged) {
        if (ally.shotCooldown <= 0) looseShot(ally, target, ally.projectileRange ?? ally.range);
      } else if (ally.attackCooldown <= 0) {
        swing(ally, target);
      }
    } else {
      ally.angle = Math.atan2(ally.homeY - ally.y, ally.homeX - ally.x);
    }
    stepToward(ally, ally.homeX, ally.homeY, delta, formationRules.orders.returnSpeed);
  }

  function swing(ally, target) {
    ally.attackCooldown = ally.attackInterval ?? 1.2;
    const angle = Math.atan2(target.y - ally.y, target.x - ally.x);
    ally.angle = angle;
    addMeleeEffect(target.x, target.y, angle, ally.weapon ?? "sword");
    damageEnemy(target, ally.damage, "weapon");
  }

  function ram(ally, target) {
    ally.ramCooldown = chariotConfig.ramInterval;
    const angle = Math.atan2(target.y - ally.y, target.x - ally.x);
    ally.angle = angle;
    addMeleeEffect(target.x, target.y, angle, "ram");
    damageEnemy(target, ally.damage, "ram");
    if (!target.destroyed && !target.boss) {
      target.knockedDown = Math.max(target.knockedDown ?? 0, 1.8);
      target.contactCooldown = Math.max(target.contactCooldown ?? 0, 0.5);
    }
    burst(target.x, target.y, "#ffe08a");
    state.shake = Math.max(state.shake, 2);
  }

  function updateMelee(ally, delta, { free = false, walk = 0.65 } = {}) {
    // Only enemies near the line's own ground are worth stepping for; the reach
    // the ally stops at is the honest one (weapon range or the two bodies plus a
    // hair), so it can actually land the blow once it arrives.
    const target = nearestEnemy(ally, engage.meleeRange + ally.range);
    if (!target) {
      // Nothing to fight: walk back onto the slot. `walk` is the pace the caller
      // wants that walk taken at - a marching line runs its slot down at
      // `orders.marchSpeed`, because the slot is moving with the chariot.
      holdGround(ally, delta, walk);
      return;
    }
    const reach = Math.max(ally.range, ally.radius + target.radius + 2);
    const distance = Math.hypot(target.x - ally.x, target.y - ally.y);
    if (distance <= reach) {
      if (ally.attackCooldown <= 0) swing(ally, target);
      else ally.angle = Math.atan2(target.y - ally.y, target.x - ally.x);
      return;
    }
    // Marching (`free`) trades the leash for the walk: the slot is moving with
    // the chariot anyway, and a line that may press one step further is what
    // 出击 buys. The acquisition range above still bounds the pursuit, so a
    // marcher can never leave the line to chase the field.
    const goal = free ? { x: target.x, y: target.y } : clampToHome(ally, target.x, target.y, engage.leash);
    if (Math.hypot(goal.x - ally.x, goal.y - ally.y) < 2) {
      // The leash is already spent: stand and face the enemy rather than jitter
      // against the clamp.
      ally.angle = Math.atan2(target.y - ally.y, target.x - ally.x);
      return;
    }
    ally.angle = Math.atan2(goal.y - ally.y, goal.x - ally.x);
    stepToward(ally, goal.x, goal.y, delta);
  }

  function updateRanged(ally, delta, { free = false, walk = 0.8 } = {}) {
    // A bow planted on its slot shoots; one that is still walking home does not.
    // Marching releases that rule - the archers are permanently off-slot while
    // the line moves, and a line that cannot shoot on the move would be a line
    // that never shoots at all.
    if (!free && Math.hypot(ally.homeX - ally.x, ally.homeY - ally.y) > HOME_EPSILON) {
      holdGround(ally, delta, walk);
      return;
    }
    // 弓手对齐: the bow opens fire at the distance the enemy archer does
    // (`range`, 460), not at the shorter distance its arrow can actually carry
    // (`projectileRange`, 330). Those two numbers are different questions - how
    // far a shooter looks, and how far the shot flies - and using the flight
    // distance for both put the hired bows a body's length behind every enemy
    // bow on the field, which is the exchange the line kept losing.
    const target = nearestEnemy(ally, ally.range, { requireSight: true });
    if (!target) {
      holdGround(ally, delta, walk);
      return;
    }
    ally.angle = Math.atan2(target.y - ally.y, target.x - ally.x);
    if (ally.shotCooldown > 0) return;
    looseShot(ally, target, ally.projectileRange ?? ally.range);
  }

  function findLooseChariot(ally) {
    let best = null;
    let bestDistance = chariotConfig.chaseRange;
    for (const enemy of state.enemies) {
      if (!isLooseChariot(enemy, state.formations)) continue;
      // The chase is bounded by the line's ground on both ends: the target has
      // to be reachable within the leash and visible from where the ally stands.
      if (Math.hypot(enemy.x - ally.homeX, enemy.y - ally.homeY) > chariotConfig.chaseLeash) continue;
      const distance = Math.hypot(enemy.x - ally.x, enemy.y - ally.y);
      if (distance > bestDistance) continue;
      if (!hasLineOfSight(ally.x, ally.y, enemy.x, enemy.y)) continue;
      best = enemy;
      bestDistance = distance;
    }
    return best;
  }

  function runHome(ally, delta, threat = null) {
    if (isAtHome(ally.x, ally.y, ally.homeX, ally.homeY)) {
      ally.angle = threat
        ? Math.atan2(threat.y - ally.y, threat.x - ally.x)
        : ally.homeAngle;
      return;
    }
    // Running home is the one time a chariot moves faster than its row.
    ally.angle = Math.atan2(ally.homeY - ally.y, ally.homeX - ally.x);
    stepToward(ally, ally.homeX, ally.homeY, delta, chariotConfig.regroupSpeed);
  }

  function chaseTarget(ally, target, delta) {
    const distance = Math.hypot(target.x - ally.x, target.y - ally.y);
    const reach = ally.radius + target.radius + 6;
    ally.angle = Math.atan2(target.y - ally.y, target.x - ally.x);
    if (distance > reach) {
      if (Math.hypot(ally.x - ally.homeX, ally.y - ally.homeY) > chariotConfig.chaseLeash) {
        runHome(ally, delta);
        return;
      }
      stepToward(ally, target.x, target.y, delta);
      return;
    }
    if (ally.ramCooldown <= 0) ram(ally, target);
  }

  function updateChariot(ally, delta) {
    const contact = nearestEnemy(ally, ally.radius + 36);
    const inMelee = contact !== null
      && Math.hypot(contact.x - ally.x, contact.y - ally.y) <= ally.radius + contact.radius + 6;
    const loose = findLooseChariot(ally);
    // Same morale machine as the enemy line. The hired chariot's `hasTarget` is
    // the loose enemy rider it is allowed to chase, not the whole battlefield.
    const intent = chariotIntent(updateChariotState(ally, {
      health: ally.health,
      maxHealth: ally.maxHealth,
      inMelee,
      hasTarget: loose !== null,
    }, chariotConfig));

    if (intent === CHARIOT_INTENT.REGROUP) {
      // Disengaged: run for the slot and stay there until mended above the
      // re-engage band. Standing on the slot is not a reason to charge out at 21%.
      runHome(ally, delta, contact);
      return;
    }
    if (intent === CHARIOT_INTENT.ENGAGE) {
      // FIGHT_TO_DEATH is the same ram, aimed at whatever is closest: the
      // chariot it was chasing may be gone by the time the trap closes.
      const target = ally.chariotState === CHARIOT_STATE.CHASE
        ? loose
        : contact ?? nearestEnemy(ally, chariotConfig.chaseRange);
      if (target) chaseTarget(ally, target, delta);
      else holdGround(ally, delta, 0.7);
      return;
    }
    // HOLD: return to the slot, face the field, and still ram anything that
    // walks into the hull - a parked chariot is not a free hit.
    if (!isAtHome(ally.x, ally.y, ally.homeX, ally.homeY)) {
      ally.angle = Math.atan2(ally.homeY - ally.y, ally.homeX - ally.x);
      stepToward(ally, ally.homeX, ally.homeY, delta, 0.7);
      return;
    }
    ally.angle = contact
      ? Math.atan2(contact.y - ally.y, contact.x - ally.x)
      : ally.homeAngle;
    // Only a body actually against the hull is rammed from a standstill; the
    // 36px search above is for facing, not for reach.
    if (inMelee && contact && ally.ramCooldown <= 0) ram(ally, contact);
  }

  // `damageAlly` mirrors `damageCompanion`, minus the campaign consequences: a
  // hired unit is not on the roster, so its death costs the run nothing but the
  // body. Vehicles shrug the shove off instead of being knocked about.
  function damageAlly(ally, amount, sourceX, sourceY) {
    if (!ally || ally.destroyed || !ally.friendly) return;
    ally.health = Math.max(0, ally.health - amount);
    ally.hitFlash = 0.2;
    addBloodStain(state, () => campaign.random(), ally.x, ally.y, ally.radius, ally.health === 0);
    const angle = Math.atan2(ally.y - sourceY, ally.x - sourceX);
    if (!ally.vehicle) {
      ally.knockbackX = (ally.knockbackX || 0) + Math.cos(angle) * 42;
      ally.knockbackY = (ally.knockbackY || 0) + Math.sin(angle) * 42;
    }
    state.shake = Math.max(state.shake, ally.vehicle ? 2 : 1);
    burst(ally.x, ally.y, "#d9a34f");
    if (ally.health === 0) {
      ally.destroyed = true;
      burst(ally.x, ally.y, formationRules.visual.deathBurst);
      // The line's dead stay on the field like everyone else's; the snapshot is
      // drawn once per frame and never ticks.
      addCorpse(state, ally);
      // A hired vehicle goes down like a chariot, a man like a man. Both are
      // borrowed cues until the line has deaths of its own.
      playSound(ally.vehicle ? soundBorrowed.chariotDied : soundBorrowed.friendlyDied);
    }
  }

  // Ally bodies never share a pixel with an enemy (or with each other). Only one
  // side of a foot pair is moved per overlap - the enemy for foot pairs, the ally
  // for a vehicle or a champion - so the pass is order-stable and cannot shove a
  // boss out of its line.
  function separateAllies() {
    for (let pass = 0; pass < SEPARATION_PASSES; pass += 1) {
      let moved = false;
      for (const ally of state.allies) {
        if (ally.destroyed) continue;
        // Foot allies are pushed out of the player's hull; the chariot is not.
        if (!ally.vehicle) {
          const dx = ally.x - player.x;
          const dy = ally.y - player.y;
          const span = Math.sqrt(dx * dx + dy * dy);
          const minimum = player.radius + ally.radius - SEPARATION_MIN_OVERLAP;
          if (span < minimum) {
            const push = minimum - span;
            const nx = span > 0 ? dx / span : 1;
            const ny = span > 0 ? dy / span : 0;
            moveEntitySafely(ally, nx * push, ny * push, ally.radius);
            moved = true;
          }
        }
        for (const enemy of state.enemies) {
          if (enemy.destroyed) continue;
          const dx = enemy.x - ally.x;
          const dy = enemy.y - ally.y;
          const span = Math.sqrt(dx * dx + dy * dy);
          const minimum = ally.radius + enemy.radius - SEPARATION_MIN_OVERLAP;
          if (span >= minimum) continue;
          const push = minimum - span;
          const nx = span > 0 ? dx / span : 1;
          const ny = span > 0 ? dy / span : 0;
          if (enemy.boss || enemy.vehicle) {
            moveEntitySafely(ally, -nx * push, -ny * push, ally.radius);
          } else {
            moveEntitySafely(enemy, nx * push, ny * push, enemy.radius);
          }
          moved = true;
        }
      }
      for (let first = 0; first < state.allies.length; first += 1) {
        const front = state.allies[first];
        if (front.destroyed) continue;
        for (let second = first + 1; second < state.allies.length; second += 1) {
          const back = state.allies[second];
          if (back.destroyed) continue;
          const dx = back.x - front.x;
          const dy = back.y - front.y;
          const span = Math.sqrt(dx * dx + dy * dy);
          const minimum = front.radius + back.radius - SEPARATION_MIN_OVERLAP;
          if (span >= minimum) continue;
          const push = minimum - span;
          const nx = span > 0 ? dx / span : 1;
          const ny = span > 0 ? dy / span : 0;
          // A body walking home from a 结阵 does not stop for a rank that has
          // already closed: when exactly one of the pair is on its way home, it is
          // the *settled* body that is shoved aside, by exactly the overlap. The
          // plain rule (the later body in the list moves) is what a ring of
          // neighbours wants, but it cannot get a chariot through its own front
          // rank: the push would cancel the step every frame and the straggler
          // would stand in the rank for the rest of the battle. The shoved body
          // holds its ground and walks back on the next frame, so the ring closes
          // behind the straggler exactly as it was.
          const shoved = front.returning !== back.returning
            ? (front.returning ? back : front)
            : back;
          const sign = shoved === back ? 1 : -1;
          moveEntitySafely(shoved, sign * nx * push, sign * ny * push, shoved.radius);
          moved = true;
        }
      }
      if (!moved) return;
    }
  }

  function update(delta) {
    // Orders first: a 结阵 this frame rewrites every station, and the aura below
    // must test the ring the line is actually holding, not last frame's.
    advanceOrders({
      formations: state.allyFormations,
      members: state.allies,
      leader: player,
    });
    // Aura next: it may top a chariot up over a threshold, and the state machine
    // below should see the health it actually has this frame. The player is a
    // patient of his own line (standing in a friendly ring mends him) and the
    // enemy bodies are what dirties the ground the beat needs.
    tickFormationAura(state.allyFormations, state.allies, delta, formationRules.aura, {
      intruders: state.enemies,
      friends: [player],
    });
    for (const ally of state.allies) {
      if (ally.destroyed) continue;
      ally.hitFlash = Math.max(0, ally.hitFlash - delta);
      ally.attackCooldown = Math.max(0, ally.attackCooldown - delta);
      ally.shotCooldown = Math.max(0, ally.shotCooldown - delta);
      ally.ramCooldown = Math.max(0, ally.ramCooldown - delta);
      ally.knockedDown = Math.max(0, (ally.knockedDown ?? 0) - delta);
      if (ally.knockedDown > 0) continue;
      // Knockback from a hit decays over a few frames instead of being applied
      // once: a spear that survives a blow is visibly shoved, not teleported.
      if (!ally.vehicle && (ally.knockbackX || ally.knockbackY)) {
        moveEntitySafely(ally, (ally.knockbackX || 0) * delta, (ally.knockbackY || 0) * delta, ally.radius);
        const drag = Math.max(0, 1 - 9 * delta);
        ally.knockbackX = (ally.knockbackX || 0) * drag;
        ally.knockbackY = (ally.knockbackY || 0) * drag;
      }
      // One question, three answers. A body that was left behind by the last
      // 结阵 runs to its station and fights nothing on the way - the flag is
      // cleared the frame it arrives. A marching line fights on the move
      // (`free`: no leash, no home-first rule) and walks back to its moving slot
      // at the marching pace; the chariot keeps the morale machine it always had,
      // whose own walk to a slot that has moved with the player is the same leg.
      // Everything else is the guard brain this file has always had.
      const marching = ally.line?.order === formationOrders.MARCH;
      const pace = marching ? formationRules.orders.marchSpeed : undefined;
      if (ally.returning) runToStation(ally, delta);
      else if (isChariot(ally)) updateChariot(ally, delta);
      else if (ally.ranged) updateRanged(ally, delta, { free: marching, walk: pace });
      else updateMelee(ally, delta, { free: marching, walk: pace });
    }
    separateAllies();
    state.allies = state.allies.filter((ally) => !ally.destroyed);
    state.allyFormations = state.allyFormations.filter((formation) =>
      state.allies.some((ally) => ally.formationId === formation.id));
  }

  function createAllyUnit(type, slot, formation, heading, order) {
    // Every rung repaints an enemy row; only the siege engine is an ally of its
    // own (`allyStats`), because the enemy roster has no foot catapult to borrow.
    const stats = enemyStats[type] ?? allyStats[type];
    if (!stats) throw new Error(`Unknown friendly formation unit "${type}".`);
    // The rung's own local station, kept as an offset rather than a position: 出击
    // drags the centre, and every station is that offset rotated through the new
    // one (`formation-orders.js`). `homeX/homeY` stays the runtime goal.
    const [, stationX, stationY] = formation.slots[order] ?? [];
    return {
      ...stats,
      type,
      friendly: true,
      maxHealth: stats.health,
      x: slot.x,
      y: slot.y,
      angle: heading,
      homeX: slot.x,
      homeY: slot.y,
      homeAngle: heading,
      formationId: formation.id,
      // The line itself, so a brain can ask what it has been ordered to do
      // without a lookup on every frame. One object per line, shared by all of
      // its bodies.
      line: formation,
      stationX,
      stationY,
      // Set by 结阵 for a body that was left behind; cleared when it arrives.
      returning: false,
      // The row's own robe is the enemy palette; the hired line is green - except
      // a foot bow, which keeps the line's second colour (`bowRobe`) so the
      // shooting rank is legible at a glance.
      visual: {
        ...stats.visual,
        robe: isFootBow(stats) ? formationRules.visual.bowRobe : formationRules.visual.robe,
        overlays: [...(stats.visual.overlays ?? [])],
      },
      deathBurst: formationRules.visual.deathBurst,
      chariotState: isChariot(stats) ? CHARIOT_STATE.HOLD : null,
      // Staggered clocks, fixed rather than rolled: the line opens with a ripple
      // instead of every bow releasing on the same frame, and the seed is intact.
      attackCooldown: 0.9 + order * 0.15,
      shotCooldown: 1.1 + order * 0.2,
      ramCooldown: 0,
      hitFlash: 0,
      healFlash: 0,
      knockedDown: 0,
      contactCooldown: 0,
      knockbackX: 0,
      knockbackY: 0,
    };
  }

  // Placement walks the fixed bearing list and keeps the best ground it saw:
  // dry beats merely uniform beats "slots are free but a wall crosses the
  // footprint", the same ladder the enemy spawner uses. Unlike the enemy spawner
  // it never gives up - a line that cost coins has to appear - so the best rung is
  // committed even when every rung failed; beneath it sits the candidate with the
  // fewest obstructed stations, and the first clamped candidate is the floor under
  // that. `tier` only supplies the stations being laid out, so a wide siege camp
  // asks about - and clears - more ground than a rank of halberds.
  function findSpawn(index, extent, clearance, tier) {
    const preferred = index % 2 === 0 ? -Math.PI / 2 : Math.PI / 2;
    const offsets = [preferred, ...SPAWN_OFFSETS.filter((offset) => offset !== preferred)];
    let best = null;
    let safest = null;
    let safestBlocked = Infinity;
    let fallback = null;
    for (const distance of SPAWN_DISTANCES) {
      for (const offset of offsets) {
        const heading = player.angle + offset;
        const centerX = clamp(player.x + Math.cos(heading) * distance, extent.halfWidth + 24, world.width - extent.halfWidth - 24);
        const centerY = clamp(player.y + Math.sin(heading) * distance, extent.halfHeight + 24, world.height - extent.halfHeight - 24);
        const slotCoordinates = layoutSlots(tier, centerX, centerY, heading);
        const candidate = { centerX, centerY, heading, slotCoordinates, tier: 0 };
        fallback ??= candidate;
        if (slotCoordinates.some((slot) => Math.hypot(slot.x - player.x, slot.y - player.y) < player.radius + 40)) continue;
        // Two hired lines (or a hired line and an enemy line) on the same ground
        // interpenetrate for the rest of the battle.
        if (state.allyFormations.some((other) => Math.abs(other.x - centerX) < other.halfWidth + extent.halfWidth
          && Math.abs(other.y - centerY) < other.halfHeight + extent.halfHeight)) continue;
        if (state.formations.some((other) => Math.abs(other.x - centerX) < other.halfWidth + extent.halfWidth
          && Math.abs(other.y - centerY) < other.halfHeight + extent.halfHeight)) continue;
        if (!rectHitsAnyObstacle(centerX, centerY, clearance.halfWidth, clearance.halfHeight, heading, campaign.obstacles)) {
          const footing = rectTerrain(centerX, centerY, clearance.halfWidth, clearance.halfHeight, heading, campaign.terrain);
          candidate.tier = footing.dry ? 3 : footing.uniform ? 2 : 1;
          if (!best || candidate.tier > best.tier) best = candidate;
          if (candidate.tier === 3) return candidate;
          continue;
        }
        const blockedSlots = slotCoordinates.filter((slot) => circleIntersectsObstacle(slot.x, slot.y, 20)).length;
        if (blockedSlots > 0) {
          // A station standing on an obstacle. Nothing on this rung can be
          // committed, but the candidate with the fewest such stations is the
          // ground a body can still walk off (src/game/pathfinding.js routes it),
          // so it beats "whatever was tried first" when every candidate is bad.
          if (blockedSlots < safestBlocked) {
            safestBlocked = blockedSlots;
            safest = candidate;
          }
          continue;
        }
        candidate.tier = 1;
        if (!best || candidate.tier > best.tier) best = candidate;
      }
    }
    return best ?? safest ?? fallback;
  }

  // One line, committed to the field: the formation row, its stations filled with
  // bodies, both pushed into the battle's lists. `pattern` is where the stations
  // come from and `rung` is what the line calls itself afterwards - the index in
  // the hire ladder for a purchase, `-1` for a line nobody bought (the drill's
  // borrowed squad). `index` only decides the id: hired lines are numbered by their
  // rung, and a scripted line takes the next free slot in the negative ladder.
  function commitFormation({ centerX, centerY, heading, slotCoordinates }, { index, pattern, rung = index }) {
    const { halfWidth, halfHeight } = formationExtent(pattern);
    const formation = {
      // Negative ids cannot collide with an enemy formation's `elapsed + random`.
      id: -(index + 1),
      nameKey: pattern.nameKey,
      // Which rung of the ladder this line was bought from, kept on the line so a
      // save, a debugger and the camp preview can name it without the recount.
      // `-1` is a scripted line: it fights like a hire and is nobody's property.
      tier: rung,
      // The rung's stations, so the orders code can re-place this line without
      // having to know which line it happens to be holding.
      slots: pattern.slots,
      x: centerX,
      y: centerY,
      heading,
      halfWidth,
      halfHeight,
      // The deepest station in the pattern, behind the centre: `formation-orders`
      // uses it to work out how far in front of a leader the ring has to sit for
      // no body to be standing in his hull.
      depth: Math.max(...pattern.slots.map(([, , slotY]) => slotY)),
      color: "#5fbd79",
      friendly: true,
      // Who may give this line orders. An order is only honoured by the owner
      // its formation names (`commandedFormation`), which is the seam a second
      // commander - and a networked command - goes through.
      owner: "player",
      // A hired line starts on its ground: 出击 is the player's to give.
      order: formationOrders.HOLD,
      stragglers: 0,
      auraTimer: 0,
      auraFlash: 0,
    };
    state.allyFormations.push(formation);
    pattern.slots.forEach(([type], order) => {
      state.allies.push(createAllyUnit(type, slotCoordinates[order], formation, heading, order));
    });
    return formation;
  }

  // Hires are a campaign-level count and each battle rebuilds the lines at full
  // strength from it: losing a line in one battle does not refund or erase it.
  // The ladder is bought in order, so line `index` fields rung `index` - the
  // first hire is always the cheap rank and the third always the siege camp.
  function spawnFriendlyFormations() {
    state.allyFormations = [];
    state.allies = [];
    const hires = hireCount(campaign);
    if (hires === 0) return state.allyFormations;
    for (let index = 0; index < hires; index += 1) {
      const tier = tierForIndex(index);
      commitFormation(
        findSpawn(index, formationExtent(tier), formationGroundExtent(tier), tier),
        { index, pattern: tier, rung: index },
      );
    }
    return state.allyFormations;
  }

  // A line the *script* owns, laid out on the ground the caller chose: the drill
  // lends the player eight men for one encounter (see `formationPresets`), and they
  // are a line in every way that matters - the same banner, the same 出击 / 结阵,
  // the same brains - except that nobody paid for them. So this path skips the
  // spawn ladder entirely (the tutorial's map promises already picked the ground,
  // and a re-roll here would move the scene the player is watching) and it never
  // touches `campaign.friendlyFormations`, which is the hire count the shop reads.
  //
  // The formation it returns is the handle the caller keeps: `state.allyFormations`
  // drops a line the frame its last body falls (see `update`), so the tutorial
  // holds the object and asks it, not the list.
  function spawnScenarioLine(name, { x, y, heading = 0 }) {
    const pattern = formationPresets[name];
    if (!pattern) throw new Error(`Unknown scenario line "${name}".`);
    return commitFormation(
      { centerX: x, centerY: y, heading, slotCoordinates: layoutSlots(pattern, x, y, heading) },
      // The next free slot in the negative id ladder: a borrowed line is numbered
      // like any other line and still cannot collide with an enemy's id.
      { index: state.allyFormations.length, pattern, rung: -1 },
    );
  }

  // The loan goes home. Takes the formation (not a name) so a caller cannot pull
  // somebody else's line: the bodies are removed with it, and the line leaves both
  // lists here instead of waiting for the next frame's filter - a caller that
  // despawns on the frame the act ends must not have the HUD still count them.
  function despawnScenarioLine(formation) {
    if (!formation) return 0;
    const before = state.allies.length;
    state.allies = state.allies.filter((ally) => ally.formationId !== formation.id);
    state.allyFormations = state.allyFormations.filter((line) => line !== formation);
    return before - state.allies.length;
  }

  return { spawnFriendlyFormations, spawnScenarioLine, despawnScenarioLine, update, damageAlly };
}
