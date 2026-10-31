import { calculateArrowDamage, getPlayerArrowCount } from "../data/equipment.js";
import { resolveProjectileKind } from "../data/projectiles.js";
import { projectileRules } from "../data/rules.js";
import { soundCues } from "../data/sounds.js";

// Every projectile leaves the bow/hand at z = 8, so the arc has to be solved
// from that height to know when it really touches the ground.
const LAUNCH_HEIGHT = 8;

// The integration below advances z with the *previous* velocity (explicit
// Euler), so a long shot lands 3-9px later than the analytic solution. The
// padding keeps the projectile alive until the z <= 0 test ends it; the number
// itself is never the reason a ballistic shot stops.
const BALLISTIC_LIFE_PADDING = 1;

// A ballistic shot is only over when z reaches 0. Deriving `life` from the
// parabola guarantees the integration loop outlives the arc: the old
// `range / horizontalSpeed` budget expired 10-30px short of the ground, which
// culled arrows and stones in mid air with no impact and no decal.
export function solveTimeToGround({ z0 = LAUNCH_HEIGHT, vz = 0, gravity = 420 } = {}) {
  if (gravity <= 0) return Infinity;
  return (vz + Math.sqrt(vz * vz + 2 * gravity * z0)) / gravity;
}

export function createBallisticProjectile({
  x, y, angle, speed, elevation, gravity = 420, range, owner, damage, kind = "arrow",
}) {
  // The one place a kind id becomes behaviour. The row travels with the bullet, so
  // every later question ("what does this hit sound like", "how far does it pass
  // through") is a field read instead of a string comparison.
  const rule = resolveProjectileKind(kind);
  const horizontalSpeed = speed * Math.cos(elevation);
  const vz = speed * Math.sin(elevation);
  return {
    x,
    y,
    z: LAUNCH_HEIGHT,
    vx: Math.cos(angle) * horizontalSpeed,
    vy: Math.sin(angle) * horizontalSpeed,
    vz,
    gravity,
    range,
    travelled: 0,
    life: gravity > 0
      ? solveTimeToGround({ z0: LAUNCH_HEIGHT, vz, gravity }) + BALLISTIC_LIFE_PADDING
      : range / horizontalSpeed,
    owner,
    damage,
    // The id stays a string: the smoke trace fingerprints it.
    kind: rule.id,
    rule,
    // Remaining bodies this shot may still pass through, per instance.
    pierce: rule.pierce,
    // `hitUnits` is filled in by the first body a piercing shot meets.
    radius: rule.radius,
  };
}

// What an impact leaves behind, keyed by the name a projectile row gives it
// (`impact`, `bodyImpact`). The effects themselves live in the projectile system
// because a burst or a dust cloud needs the callbacks it was handed; the table only
// decides which one a name means, so no branch ever asks what kind of shot it holds.
export const projectileImpactEffects = Object.freeze({
  puff: ({ burst }, projectile, color) => burst(projectile.x, projectile.y, color),
  dust: ({ dust }, projectile) => dust(projectile.x, projectile.y),
});

// Low-arc solution for hitting the ground `distance` away. `launchHeight` is the
// z every projectile starts at: leaving it out (the old call shape) solves as if
// the bow stood on the ground, which makes the arrow fly longer than requested
// and land past a close target. Passing LAUNCH_HEIGHT drops the shot exactly on
// the requested distance instead.
export function solveBallisticElevation(distance, speed, gravity = 420, launchHeight = 0) {
  if (distance <= 0) return 0;
  const speedSquared = speed * speed;
  const discriminant = speedSquared ** 2 - gravity * (gravity * distance ** 2)
    + 2 * launchHeight * speedSquared * gravity;
  if (discriminant <= 0) return Math.PI / 4;
  return Math.atan((speedSquared - Math.sqrt(discriminant)) / (gravity * distance));
}

export function updateProjectiles({
  state, world, player, delta, circleIntersectsObstacle,
  damageEnemy, damagePlayer, damageCompanion, damageAlly = () => {}, burst, dust = () => {},
  playSound = () => {},
}) {
  // Every way a shot can stop looks the same from the outside: an effect at the
  // impact point, named by the row that flew there (a stone raises dust, an arrow
  // keeps its small tinted puff).
  const effects = { burst, dust };
  const spawnImpact = (projectile, color, name = projectile.rule.impact) =>
    (projectileImpactEffects[name] ?? projectileImpactEffects.puff)(effects, projectile, color);

  // What a shot does once it connects: spend one pierce and remember the body, so
  // the same one cannot be hit again a frame later, or drop where it stands.
  function passThrough(projectile, target) {
    if (projectile.pierce <= 0) return false;
    projectile.pierce -= 1;
    (projectile.hitUnits ??= []).push(target);
    return true;
  }

  for (const projectile of state.bullets) {
    if (projectile.kind === undefined) {
      // A bullet from an older shape: flat, no gravity and no row of its own.
      projectile.z = LAUNCH_HEIGHT;
      projectile.radius ??= 3;
      projectile.vz = 0;
      projectile.gravity = 0;
      projectile.range = Infinity;
      projectile.travelled ??= 0;
    }
    projectile.rule ??= resolveProjectileKind(projectile.kind);
    projectile.pierce ??= 0;

    const steps = Math.max(1, Math.ceil(Math.hypot(projectile.vx, projectile.vy) * delta / 8));
    for (let step = 0; step < steps && projectile.life > 0; step += 1) {
      const stepDelta = delta / steps;
      const previousX = projectile.x;
      const previousY = projectile.y;
      projectile.x += projectile.vx * stepDelta;
      projectile.y += projectile.vy * stepDelta;
      projectile.z += projectile.vz * stepDelta;
      projectile.vz -= projectile.gravity * stepDelta;
      projectile.travelled += Math.hypot(projectile.x - previousX, projectile.y - previousY);
      projectile.life -= stepDelta;

      if (projectile.z <= 0) {
        projectile.life = 0;
        spawnImpact(projectile, "#d1b77d");
        playSound(projectile.rule.cue.ground);
        if (projectile.rule.decal) {
          state.groundArrows.push({
            x: projectile.x,
            y: projectile.y,
            angle: Math.atan2(projectile.vy, projectile.vx),
            kind: projectile.rule.decal,
            life: 12,
          });
          if (state.groundArrows.length > 100) state.groundArrows.shift();
        }
        break;
      }
      // `range` only caps gravity-less shots (legacy straight bullets). A
      // ballistic arc ends on its own at z = 0, and cutting it at `range`
      // would kill it in mid air above the grass.
      if ((projectile.gravity === 0 && projectile.travelled >= projectile.range)
        || projectile.x < 0 || projectile.x > world.width
        || projectile.y < 0 || projectile.y > world.height) {
        projectile.life = 0;
        break;
      }
      if (projectile.z < 22 && circleIntersectsObstacle(projectile.x, projectile.y, projectile.radius)) {
        projectile.life = 0;
        spawnImpact(projectile, "#a8a88a");
        playSound(projectile.rule.cue.obstacle);
        break;
      }

      if (projectile.owner === "enemy") {
        // Everyone standing on the player's side can stop an enemy shot: the
        // player, the foot companions and the hired line. A companion or ally is
        // only a candidate while it is alive; the player is always there (a hit
        // that ends the run is routed through damagePlayer).
        const allies = (state.allies ?? []).filter((ally) => !ally.destroyed);
        const targets = player.mode === "foot"
          ? [player, ...state.footCompanions.filter((companion) => !companion.destroyed), ...allies]
          : [player, ...allies];
        const target = targets.find((unit) => projectile.z <= 64
          && !projectile.hitUnits?.includes(unit)
          && Math.hypot(projectile.x - unit.x, projectile.y - unit.y) < unit.radius + projectile.radius);
        if (target) {
          // A stone that hits a body still kicks up dust; an arrow does not.
          const bodyEffect = projectile.rule.bodyImpact;
          if (bodyEffect) spawnImpact(projectile, "#a8a88a", bodyEffect);
          if (target === player) damagePlayer(projectile.damage, projectile.x, projectile.y, true);
          else if (target.friendly) damageAlly(target, projectile.damage, projectile.x, projectile.y);
          else damageCompanion(target, projectile.damage, projectile.x, projectile.y);
          // The player has his own cue for being hit (damagePlayer), so only a
          // companion or an ally adds the impact on top.
          if (target !== player) playSound(projectile.rule.cue.body);
          // The same row decides the same thing on both sides of the field: a
          // `pierce` body is left behind and the shot carries on, an arrow stops.
          // The champion's rig is where a shot always ends - a bolt goes through a
          // man on foot, not through a chariot - and the ledger is what keeps the
          // body it just left from catching it again next frame.
          if (target === player || !passThrough(projectile, target)) projectile.life = 0;
        }
      } else {
        const target = state.enemies.find((enemy) => !enemy.destroyed
          && projectile.z <= (enemy.hitHeight ?? 64)
          && !projectile.hitUnits?.includes(enemy)
          && Math.hypot(projectile.x - enemy.x, projectile.y - enemy.y) < enemy.radius + projectile.radius);
        if (target) {
          const bodyEffect = projectile.rule.bodyImpact;
          if (bodyEffect) spawnImpact(projectile, "#a8a88a", bodyEffect);
          damageEnemy(target, projectile.damage);
          playSound(projectile.rule.cue.body);
          // A bolt leaves through the body it just hit and keeps the next one in
          // sight; an arrow stops dead. Either way the shot is only removed once it
          // has nothing left to pass through.
          if (!passThrough(projectile, target)) projectile.life = 0;
        }
      }
    }
  }
  state.bullets = state.bullets.filter((projectile) => projectile.life > 0);
}

// Owns every way a projectile enters or leaves the battle: player volleys,
// crew/companion arrows, enemy shots, and the per-frame integration. Callers
// only say *what* should be fired; trajectory and balance live here.
export function createProjectileSystem({
  state, player, world, campaign, collision, burst, dust, playSound,
  damageEnemy, damagePlayer, damageCompanion, damageAlly = () => {},
}) {
  // `aimX`/`aimY` mark a tapped shot: the fan turns onto that bearing and the
  // arc is solved for the distance instead of using the fixed elevation, so the
  // arrows come down on the target's ring rather than ~200px past it. Without an
  // aim point the fixed high arc stands, and that is the long shot.
  function firePlayerVolley({ aimX = null, aimY = null } = {}) {
    const arrowCount = getPlayerArrowCount(campaign.equipment);
    const rules = projectileRules.playerVolley;
    const damage = calculateArrowDamage(campaign.equipment, campaign.horseCount);
    const aimed = aimX !== null && aimY !== null;
    const bearing = aimed ? Math.atan2(aimY - player.y, aimX - player.x) : player.angle;
    // The arrow starts `originOffset` along the bearing, so only the rest of the
    // distance has to be flown.
    const aimDistance = aimed
      ? Math.max(0, Math.hypot(aimX - player.x, aimY - player.y) - rules.originOffset)
      : 0;
    const elevation = aimed
      ? solveBallisticElevation(aimDistance, rules.speed, rules.gravity, LAUNCH_HEIGHT)
      : rules.elevation;
    for (let index = 0; index < arrowCount; index += 1) {
      const angle = bearing + (index - (arrowCount - 1) / 2) * rules.spread;
      state.bullets.push(createBallisticProjectile({
        x: player.x + Math.cos(angle) * rules.originOffset,
        y: player.y + Math.sin(angle) * rules.originOffset,
        angle,
        speed: rules.speed,
        elevation,
        gravity: rules.gravity,
        range: rules.range,
        owner: "player",
        damage,
        kind: "arrow",
      }));
    }
    playSound(soundCues.chariotArrow);
  }

  // The hired line's shot and the foot companion's shot. A bow is the common case,
  // so the arrow is the default; the 攻坚砲营's engine only has to name
  // `kind: "stone"` and the crossbow `kind: "bolt"`, and the arc, the impact effect
  // and the cue all follow the projectile's own row (src/data/projectiles.js),
  // exactly as they do for the enemy catapult (`fireEnemyShot`).
  function fireAllyShot({
    x, y, targetX, targetY, damage, range, originOffset, index = 0, count = 1,
    kind = "arrow", speed, gravity,
  }) {
    const rules = projectileRules.allyArrow;
    // The kind decides how the shot leaves; a caller may still override the numbers
    // it throws with (the hired line's stone is slower than the champion's). Spread
    // and the two offsets stay the ally volley's own business.
    const rule = resolveProjectileKind(kind);
    const shotSpeed = speed ?? rule.speed;
    const shotGravity = gravity ?? rule.gravity;
    const angle = Math.atan2(targetY - y, targetX - x);
    const volleyAngle = angle + (index - (count - 1) / 2) * rules.spread;
    const distance = Math.hypot(targetX - x, targetY - y);
    state.bullets.push(createBallisticProjectile({
      x: x + Math.cos(volleyAngle) * originOffset,
      y: y + Math.sin(volleyAngle) * originOffset,
      angle: volleyAngle,
      speed: shotSpeed,
      elevation: solveBallisticElevation(distance, shotSpeed, shotGravity),
      gravity: shotGravity,
      range,
      owner: "ally",
      damage,
      kind,
    }));
    // One cue per row: the crew, the dismounted companions and the hired line all
    // sound like what they actually loosed, and `maxVoices` keeps a fan of them from
    // stacking into a single louder shot.
    playSound(rule.cue.release);
  }

  function fireEnemyShot(enemy, angle, target = player) {
    const rules = projectileRules.enemyShot;
    const distance = Math.hypot(enemy.x - target.x, enemy.y - target.y);
    const isBossCatapult = Boolean(enemy.boss) && enemy.type === "catapult";
    const rule = resolveProjectileKind(enemy.projectile ?? (isBossCatapult ? "stone" : "arrow"));
    const speed = enemy.projectileSpeed ?? (isBossCatapult ? rules.bossStoneSpeed : rule.speed);
    const gravity = rule.gravity;
    state.bullets.push(createBallisticProjectile({
      x: enemy.x + Math.cos(angle) * 18,
      y: enemy.y + Math.sin(angle) * 18,
      angle,
      speed,
      elevation: solveBallisticElevation(distance, speed, gravity),
      gravity,
      range: enemy.projectileRange ?? (isBossCatapult ? rules.catapultRange : enemy.range),
      owner: "enemy",
      target,
      damage: enemy.damage,
      kind: rule.id,
    }));
    enemy.shotCooldown = enemy.fireInterval
      ?? (isBossCatapult ? rules.catapultCooldown : rules.cooldownBase + campaign.random() * rules.cooldownJitter);
    // A catapult throws a stone and an archer looses an arrow, so the shot tells
    // the player what is in the air before it lands.
    playSound(rule.cue.release);
  }

  function update(delta) {
    updateProjectiles({
      state,
      world,
      player,
      delta,
      circleIntersectsObstacle: collision.circleIntersectsObstacle,
      damageEnemy,
      damagePlayer,
      damageCompanion,
      damageAlly,
      burst,
      dust,
      playSound,
    });
  }

  return { firePlayerVolley, fireAllyShot, fireEnemyShot, update };
}
