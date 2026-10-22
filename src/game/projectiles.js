export function createBallisticProjectile({
  x, y, angle, speed, elevation, gravity = 420, range, owner, damage, kind,
}) {
  const horizontalSpeed = speed * Math.cos(elevation);
  return {
    x,
    y,
    z: 8,
    vx: Math.cos(angle) * horizontalSpeed,
    vy: Math.sin(angle) * horizontalSpeed,
    vz: speed * Math.sin(elevation),
    gravity,
    range,
    travelled: 0,
    life: range / horizontalSpeed,
    owner,
    damage,
    kind,
    radius: kind === "stone" ? 6 : 3,
  };
}

export function solveBallisticElevation(distance, speed, gravity = 420) {
  if (distance <= 0) return 0;
  const speedSquared = speed * speed;
  const discriminant = speedSquared ** 2 - gravity * (gravity * distance ** 2);
  if (discriminant <= 0) return Math.PI / 4;
  return Math.atan((speedSquared - Math.sqrt(discriminant)) / (gravity * distance));
}

export function updateProjectiles({ state, world, player, delta, circleIntersectsObstacle, damageEnemy, damagePlayer, damageCompanion, burst }) {
  for (const projectile of state.bullets) {
    if (projectile.kind === undefined) {
      projectile.z = 8;
      projectile.radius ??= 3;
      projectile.vz = 0;
      projectile.gravity = 0;
      projectile.range = Infinity;
      projectile.travelled ??= 0;
    }

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
        const impactColor = projectile.kind === "stone" ? "#9b8b72" : "#d1b77d";
        burst(projectile.x, projectile.y, impactColor);
        if (projectile.kind === "arrow") {
          state.groundArrows.push({
            x: projectile.x,
            y: projectile.y,
            angle: Math.atan2(projectile.vy, projectile.vx),
            life: 12,
          });
          if (state.groundArrows.length > 100) state.groundArrows.shift();
        }
        break;
      }
      if (projectile.travelled >= projectile.range
        || projectile.x < 0 || projectile.x > world.width
        || projectile.y < 0 || projectile.y > world.height) {
        projectile.life = 0;
        break;
      }
      if (projectile.z < 22 && circleIntersectsObstacle(projectile.x, projectile.y, projectile.radius)) {
        projectile.life = 0;
        burst(projectile.x, projectile.y, "#a8a88a");
        break;
      }

      if (projectile.owner === "enemy") {
        const targets = player.mode === "foot"
          ? [player, ...state.footCompanions.filter((companion) => !companion.destroyed)]
          : [player];
        const target = targets.find((unit) => projectile.z <= 64
          && Math.hypot(projectile.x - unit.x, projectile.y - unit.y) < unit.radius + projectile.radius);
        if (target) {
          projectile.life = 0;
          if (target === player) damagePlayer(projectile.damage, projectile.x, projectile.y, true);
          else damageCompanion(target, projectile.damage, projectile.x, projectile.y);
        }
      } else {
        const target = state.enemies.find((enemy) => !enemy.destroyed
          && projectile.z <= (enemy.hitHeight ?? 64)
          && Math.hypot(projectile.x - enemy.x, projectile.y - enemy.y) < enemy.radius + projectile.radius);
        if (target) {
          projectile.life = 0;
          damageEnemy(target, projectile.damage);
        }
      }
    }
  }
  state.bullets = state.bullets.filter((projectile) => projectile.life > 0);
}
