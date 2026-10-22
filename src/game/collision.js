import { clamp, distanceBetween } from "../utils/math.js";
import { terrainSpeedMultiplier } from "./map.js";

// Geometry queries shared by the player, enemy, projectile, and stage systems.
// `campaign.obstacles`/`campaign.terrain` are replaced on every battle, so the
// lookups below intentionally read them at call time.
export function createCollisionSystem({ campaign, world }) {
  function circleIntersectsObstacle(x, y, radius, obstacleList = campaign.obstacles) {
    return obstacleList.some((obstacle) => {
      if (obstacle.type === "tree") {
        return distanceBetween(x, y, obstacle.x, obstacle.y) < radius + obstacle.radius;
      }
      const closestX = clamp(x, obstacle.x, obstacle.x + obstacle.width);
      const closestY = clamp(y, obstacle.y, obstacle.y + obstacle.height);
      return distanceBetween(x, y, closestX, closestY) < radius;
    });
  }

  function hasLineOfSight(fromX, fromY, toX, toY) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const length = distanceBetween(fromX, fromY, toX, toY);
    const steps = Math.ceil(length / 12);
    for (let step = 1; step < steps; step += 1) {
      const fraction = step / steps;
      if (circleIntersectsObstacle(fromX + dx * fraction, fromY + dy * fraction, 2)) return false;
    }
    return true;
  }

  function moveEntitySafely(entity, dx, dy, radius) {
    const movementScale = terrainSpeedMultiplier(entity.x, entity.y, campaign.terrain);
    dx *= movementScale;
    dy *= movementScale;
    const nextX = clamp(entity.x + dx, radius, world.width - radius);
    const nextY = clamp(entity.y + dy, radius, world.height - radius);
    if (!circleIntersectsObstacle(nextX, entity.y, radius)) entity.x = nextX;
    if (!circleIntersectsObstacle(entity.x, nextY, radius)) entity.y = nextY;
  }

  return { circleIntersectsObstacle, hasLineOfSight, moveEntitySafely };
}
