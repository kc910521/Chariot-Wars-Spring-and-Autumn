import { clamp, distanceBetween } from "../utils/math.js";
import { obstacleKinds, terrainKinds } from "../data/elements.js";

// The runtime half of the element catalog: what a row *does*. Collision, sight,
// movement cost and cloud drift all read the row from src/data/elements.js, so no
// caller compares a `type` string again.
//
// These are plain functions rather than the per-kind closures used in
// src/game/units/behaviours.js on purpose: `elementIntersects` is called once per
// projectile step and twice per movement axis, and a closure per call would
// allocate in the hot path for no gain.

function circleHits(x, y, radius, element) {
  return distanceBetween(x, y, element.x, element.y) < radius + element.radius;
}

function rectHits(x, y, radius, element) {
  const closestX = clamp(x, element.x, element.x + element.width);
  const closestY = clamp(y, element.y, element.y + element.height);
  return distanceBetween(x, y, closestX, closestY) < radius;
}

const OBSTACLE_SHAPES = { circle: circleHits, rect: rectHits };

// An instance built by hand - or carried over from an older save - may not match
// any row. Its own fields still say which shape it is, so honour those instead of
// rejecting it: `radius` means circle, everything else is the rect path.
export function obstacleShape(element) {
  const row = obstacleKinds[element.type];
  if (row) return row.shape;
  return element.radius === undefined ? "rect" : "circle";
}

export function obstacleRow(element) {
  return obstacleKinds[element.type] ?? null;
}

export function elementIntersects(x, y, radius, element) {
  return OBSTACLE_SHAPES[obstacleShape(element)](x, y, radius, element);
}

// Sight is a separate column from movement: reeds would stop a chariot but not an
// arrow, and the LOS walk has to be able to ask that question on its own.
export function clearsSight(element) {
  return obstacleRow(element)?.blocksSight ?? true;
}

// Culling margin: how far from its anchor an element can still paint a pixel. The
// anchor of a rect is its top-left corner, so its own extent covers it; a circle
// is anchored at its centre and gets a little slack on top.
export function elementCullMargin(element) {
  return obstacleShape(element) === "circle"
    ? element.radius + 8
    : Math.max(element.width, element.height);
}

// Bounding-circle radius, used for spacing checks and for fitting a formation
// footprint around an element. A wall is a box, so its half-diagonal.
export function elementBoundingRadius(element) {
  return obstacleShape(element) === "circle"
    ? element.radius
    : Math.hypot(element.width, element.height) / 2;
}

export function elementGap(first, second) {
  return distanceBetween(first.x, first.y, second.x, second.y)
    - elementBoundingRadius(first) - elementBoundingRadius(second);
}

// --- felling -----------------------------------------------------------------
// A fellable row can leave the field for good, which only the axles can do (see
// the axleCap rules). Whether a type can be felled at all is a data column, so
// the axes never compare a type string.

export function isFellable(element) {
  return obstacleRow(element)?.fellable === true;
}

// Cut a tree down: it leaves `campaign.obstacles` and a stump takes its place in
// `campaign.stumps`. Both are replaced, never spliced in place - the collision
// system keys its sight index on the obstacle list's identity and length, so a new
// array is exactly what makes the rebuilt index correct without a notification.
// The stump is scenery: it is not an obstacle, so nothing collides with it and no
// sight ray stops on it.
export function fellTree(campaign, tree) {
  campaign.obstacles = campaign.obstacles.filter((obstacle) => obstacle !== tree);
  campaign.stumps = [...(campaign.stumps ?? []), {
    x: tree.x,
    y: tree.y,
    // A stump is much smaller than the crown it carried: the root ball and the
    // sawn face, not the thing you used to drive around.
    radius: Math.max(5, (tree.radius ?? elementBoundingRadius(tree)) * 0.34),
    rotation: (tree.x * 0.017 + tree.y * 0.031) % Math.PI,
  }];
  return campaign.stumps[campaign.stumps.length - 1];
}

// Movement cost at a point. Overlapping patches resolve through the row's
// `combine` column: `min` keeps the worst ground underfoot (the default), and
// `multiply` compounds instead.
export function elementSpeedAt(x, y, terrain) {
  let decided = false;
  let multiplier = 1;
  for (const patch of terrain) {
    const row = terrainKinds[patch.type];
    if (!row) continue;
    const dx = (x - patch.x) / patch.radiusX;
    const dy = (y - patch.y) / patch.radiusY;
    if (dx * dx + dy * dy > 1) continue;
    if (!decided) {
      multiplier = row.speed;
      decided = true;
    } else if (row.combine === "multiply") {
      multiplier *= row.speed;
    } else {
      multiplier = Math.min(multiplier, row.speed);
    }
  }
  return multiplier;
}

// The drift is a wrapped translation, so a cloud that leaves the right edge comes
// back on the left instead of popping.
export function cloudDrift(cloud, elapsed, worldWidth) {
  const drift = elapsed * cloud.speed;
  return ((cloud.x + drift) % worldWidth + worldWidth) % worldWidth;
}

// --- footprint queries -------------------------------------------------------
// A formation reserves a rotated rect of ground (FORMATION_EXTENT in
// units/formations.js). These answer "is that rect clear?" exactly, because the
// old slot-centre test happily accepted a wall standing *between* two slots.

// Circle-vs-oriented-rect: rotate the circle into the rect's frame and the
// existing clamp math applies unchanged.
function circleHitsOrientedRect(x, y, radius, cx, cy, halfWidth, halfHeight, angle) {
  const dx = x - cx;
  const dy = y - cy;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;
  const closestX = clamp(localX, -halfWidth, halfWidth);
  const closestY = clamp(localY, -halfHeight, halfHeight);
  return Math.hypot(localX - closestX, localY - closestY) < radius;
}

function axisProjection(cx, cy, halfWidth, halfHeight, angle, axisX, axisY) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const extent = Math.abs(halfWidth * (cos * axisX + sin * axisY))
    + Math.abs(halfHeight * (-sin * axisX + cos * axisY));
  const center = cx * axisX + cy * axisY;
  return [center - extent, center + extent];
}

// Separating-axis test between the footprint and an axis-aligned wall: one axis
// without overlap proves a miss.
function rectHitsOrientedRect(element, cx, cy, halfWidth, halfHeight, angle, margin) {
  const elementHalfWidth = element.width / 2 + margin;
  const elementHalfHeight = element.height / 2 + margin;
  const elementCenterX = element.x + element.width / 2;
  const elementCenterY = element.y + element.height / 2;
  const axes = [[1, 0], [0, 1], [Math.cos(angle), Math.sin(angle)], [-Math.sin(angle), Math.cos(angle)]];
  for (const [axisX, axisY] of axes) {
    const mine = axisProjection(cx, cy, halfWidth, halfHeight, angle, axisX, axisY);
    const theirs = axisProjection(elementCenterX, elementCenterY, elementHalfWidth, elementHalfHeight, 0, axisX, axisY);
    if (mine[1] < theirs[0] || theirs[1] < mine[0]) return false;
  }
  return true;
}

export function rectHitsObstacle(cx, cy, halfWidth, halfHeight, angle, obstacle, margin = 0) {
  if (obstacleShape(obstacle) === "circle") {
    return circleHitsOrientedRect(obstacle.x, obstacle.y, obstacle.radius + margin,
      cx, cy, halfWidth, halfHeight, angle);
  }
  return rectHitsOrientedRect(obstacle, cx, cy, halfWidth, halfHeight, angle, margin);
}

export function rectHitsAnyObstacle(cx, cy, halfWidth, halfHeight, angle, obstacles, margin = 0) {
  return obstacles.some((obstacle) => rectHitsObstacle(cx, cy, halfWidth, halfHeight, angle, obstacle, margin));
}

// What a footprint is standing on. `dry` means no patch touches it at all;
// `uniform` means every overlapping patch has the same speed, so the rank moves
// at one pace instead of splitting along a seam.
export function rectTerrain(cx, cy, halfWidth, halfHeight, angle, terrain) {
  let overlapped = 0;
  let speed = 1;
  let uniform = true;
  for (const patch of terrain) {
    const row = terrainKinds[patch.type];
    if (!row) continue;
    // Ellipses are tested through their bounding circle: conservative on purpose,
    // since the whole point is to keep a formation off the edge.
    const reach = Math.max(patch.radiusX, patch.radiusY);
    if (!circleHitsOrientedRect(patch.x, patch.y, reach, cx, cy, halfWidth, halfHeight, angle)) continue;
    if (overlapped === 0) speed = row.speed;
    else if (row.speed !== speed) uniform = false;
    overlapped += 1;
  }
  return { dry: overlapped === 0, uniform, speed, overlapped };
}
