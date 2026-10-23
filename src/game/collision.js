import { clamp, distanceBetween } from "../utils/math.js";
import { clearsSight, elementIntersects, elementSpeedAt } from "./elements.js";

// Geometry queries shared by the player, enemy, projectile, and stage systems.
// `campaign.obstacles`/`campaign.terrain` are replaced on every battle, so the
// lookups below intentionally read them at call time. Which shape an obstacle is,
// and how much a patch slows a unit, comes from the element rows in
// src/data/elements.js - there is no `type` comparison left in here.
export function createCollisionSystem({ campaign, world }) {
  function circleIntersectsObstacle(x, y, radius, obstacleList = campaign.obstacles) {
    return obstacleList.some((obstacle) => elementIntersects(x, y, radius, obstacle));
  }

  // An element can stop a body without stopping a line of sight (reeds, low
  // scrub), so the walk asks for the sight column rather than every obstacle.
  function sightBlockedAt(x, y) {
    return campaign.obstacles.some((obstacle) => clearsSight(obstacle) && elementIntersects(x, y, 2, obstacle));
  }

  function hasLineOfSight(fromX, fromY, toX, toY) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const length = distanceBetween(fromX, fromY, toX, toY);
    const steps = Math.ceil(length / 12);
    for (let step = 1; step < steps; step += 1) {
      const fraction = step / steps;
      if (sightBlockedAt(fromX + dx * fraction, fromY + dy * fraction)) return false;
    }
    return true;
  }

  function moveEntitySafely(entity, dx, dy, radius) {
    const movementScale = elementSpeedAt(entity.x, entity.y, campaign.terrain);
    dx *= movementScale;
    dy *= movementScale;
    const nextX = clamp(entity.x + dx, radius, world.width - radius);
    const nextY = clamp(entity.y + dy, radius, world.height - radius);
    if (!circleIntersectsObstacle(nextX, entity.y, radius)) entity.x = nextX;
    if (!circleIntersectsObstacle(entity.x, nextY, radius)) entity.y = nextY;
  }

  return { circleIntersectsObstacle, hasLineOfSight, moveEntitySafely };
}

