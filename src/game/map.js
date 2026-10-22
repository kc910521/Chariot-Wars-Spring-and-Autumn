export function createBattlefield(random, player, world, circleIntersectsObstacle) {
  const obstacles = [];
  const terrain = [];
  const clouds = Array.from({ length: 16 }, () => ({
    x: random() * world.width,
    y: random() * world.height,
    width: 130 + random() * 150,
    height: 55 + random() * 52,
    speed: 2 + random() * 4,
    opacity: 0.14 + random() * 0.07,
    phase: random() * Math.PI * 2,
  }));
  const safeX = world.width / 2;
  const safeY = world.height / 2;

  for (const [type, count, minRadius, maxRadius] of [
    ["shallows", 3, 85, 145],
    ["sand", 4, 90, 160],
    ["grass", 7, 55, 110],
  ]) {
    for (let index = 0; index < count; index += 1) {
      const radius = minRadius + random() * (maxRadius - minRadius);
      const x = 110 + random() * (world.width - 220);
      const y = 110 + random() * (world.height - 220);
      if (Math.hypot(x - safeX, y - safeY) < 300) continue;
      terrain.push({ type, x, y, radiusX: radius * (0.9 + random() * 0.5), radiusY: radius * (0.55 + random() * 0.45) });
    }
  }

  for (let index = 0; index < 46; index += 1) {
    const x = 90 + random() * (world.width - 180);
    const y = 90 + random() * (world.height - 180);
    if (Math.hypot(x - safeX, y - safeY) < 280) continue;

    if (random() < 0.58) {
      const horizontal = random() < 0.5;
      const obstacle = {
        type: "wall",
        x,
        y,
        width: horizontal ? 90 + random() * 150 : 28 + random() * 18,
        height: horizontal ? 28 + random() * 18 : 90 + random() * 150,
      };
      if (x + obstacle.width > world.width - 35 || y + obstacle.height > world.height - 35) continue;
      obstacles.push(obstacle);
    } else {
      const obstacle = { type: "tree", x, y, radius: 22 + random() * 18 };
      if (circleIntersectsObstacle(x, y, obstacle.radius, obstacles)) continue;
      obstacles.push(obstacle);
    }
  }

  player.x = safeX;
  player.y = safeY;
  if (circleIntersectsObstacle(player.x, player.y, player.radius, obstacles)) {
    obstacles.splice(0, obstacles.length);
  }
  return { obstacles, terrain, clouds };
}

export function terrainSpeedMultiplier(x, y, terrain) {
  let multiplier = 1;
  for (const patch of terrain) {
    const dx = (x - patch.x) / patch.radiusX;
    const dy = (y - patch.y) / patch.radiusY;
    if (dx * dx + dy * dy > 1) continue;
    const patchMultiplier = patch.type === "shallows" ? 0.55 : patch.type === "sand" ? 0.7 : 0.92;
    multiplier = Math.min(multiplier, patchMultiplier);
  }
  return multiplier;
}
