import { clamp, distanceBetween } from "../utils/math.js";
import { blocksMovement, clearsSight, elementIntersects, elementSpeedAt, obstacleShape } from "./elements.js";

// A line of sight is sampled every SIGHT_STEP pixels, and each sample asks "is a
// sight-blocking element within the probe radius here?". Asking all ~46 obstacles
// at all ~34 samples is 1.5k element tests per query, and a ready bow walks that
// once per candidate enemy - it was the single most expensive thing the ranged
// units did. The index below buckets the sight-blocking elements into a uniform
// grid once per battle, so a sample only visits the elements that can possibly
// reach the cell it is standing in.
const SIGHT_STEP = 12;
const SIGHT_PROBE = 2;
const SIGHT_CELL = 96;

// The same argument, applied to movement. `moveEntitySafely` asks the movement
// question twice per unit per frame (once per axis), so a full battle is ~100
// scans of the whole obstacle list every frame - the steady cost of every unit on
// the field, not just the shooters. The grid below is keyed on the *pixel* the
// query is about rather than on the obstacle, so one index serves every radius
// instead of one index per body size: a circle of radius r can only touch an
// element that overlaps its own bounding box, so visiting the cells under that
// box is exact rather than a best guess.
const MOVE_CELL = 96;

// Geometry queries shared by the player, enemy, projectile, and stage systems.
// `campaign.obstacles`/`campaign.terrain` are replaced on every battle, so the
// lookups below intentionally read them at call time. Which shape an obstacle is,
// and how much a patch slows a unit, comes from the element rows in
// src/data/elements.js - there is no `type` comparison left in here.
export function createCollisionSystem({ campaign, world }) {
  // Cells are filled with the element's own extent, never with an inflated one:
  // the radius belongs to the *query*, and padding the index by the largest body
  // on the field (a 38px elephant) would multiply the cells every wall files into
  // for a question most callers do not ask.
  function moveBounds(obstacle) {
    if (obstacleShape(obstacle) === "circle") {
      const reach = obstacle.radius;
      return [obstacle.x - reach, obstacle.y - reach, obstacle.x + reach, obstacle.y + reach];
    }
    return [obstacle.x, obstacle.y, obstacle.x + obstacle.width, obstacle.y + obstacle.height];
  }

  function buildMoveIndex(obstacles) {
    const columns = Math.max(1, Math.ceil(world.width / MOVE_CELL));
    const rows = Math.max(1, Math.ceil(world.height / MOVE_CELL));
    const cells = new Array(columns * rows).fill(null);
    for (const obstacle of obstacles) {
      // The catalog's movement column, not a type check: an obstacle that only
      // decorates the ground belongs in no collision index at all.
      if (!blocksMovement(obstacle)) continue;
      const [minX, minY, maxX, maxY] = moveBounds(obstacle);
      const firstColumn = clamp(Math.floor(minX / MOVE_CELL), 0, columns - 1);
      const lastColumn = clamp(Math.floor(maxX / MOVE_CELL), 0, columns - 1);
      const firstRow = clamp(Math.floor(minY / MOVE_CELL), 0, rows - 1);
      const lastRow = clamp(Math.floor(maxY / MOVE_CELL), 0, rows - 1);
      for (let row = firstRow; row <= lastRow; row += 1) {
        for (let column = firstColumn; column <= lastColumn; column += 1) {
          const slot = row * columns + column;
          (cells[slot] ??= []).push(obstacle);
        }
      }
    }
    return { columns, rows, cells };
  }

  // Keyed on the list identity *and* its length, exactly like the sight index: a
  // battle hands over a freshly built array and `fellTree` replaces it, so
  // nothing here has to be notified.
  let moveIndex = null;
  let moveIndexSource = null;
  let moveIndexLength = -1;

  function moveIndexFor() {
    const obstacles = campaign.obstacles;
    if (moveIndex !== null && moveIndexSource === obstacles && moveIndexLength === obstacles.length) {
      return moveIndex;
    }
    moveIndex = buildMoveIndex(obstacles);
    moveIndexSource = obstacles;
    moveIndexLength = obstacles.length;
    return moveIndex;
  }

  function circleIntersectsObstacle(x, y, radius, obstacleList = campaign.obstacles) {
    // A hand-built or generation-time list is scanned directly. `map.js` calls
    // this with the array it is still growing, so its length changes on every
    // query - indexing that would rebuild the grid per call and be slower than
    // the plain scan it replaced.
    if (obstacleList !== campaign.obstacles) {
      return obstacleList.some((obstacle) => blocksMovement(obstacle) && elementIntersects(x, y, radius, obstacle));
    }
    const { columns, rows, cells } = moveIndexFor();
    // The query's own bounding box: every element that can touch this circle
    // overlaps it, so every such element was filed under one of these cells. An
    // element that spans a cell border is filed under both and may be tested
    // twice; the answer is a boolean, so a duplicate costs a `hypot` and changes
    // nothing. Outside the map the clamped edge cell is the conservative answer:
    // it can only add candidates, and `elementIntersects` still rejects them.
    const firstColumn = clamp(Math.floor((x - radius) / MOVE_CELL), 0, columns - 1);
    const lastColumn = clamp(Math.floor((x + radius) / MOVE_CELL), 0, columns - 1);
    const firstRow = clamp(Math.floor((y - radius) / MOVE_CELL), 0, rows - 1);
    const lastRow = clamp(Math.floor((y + radius) / MOVE_CELL), 0, rows - 1);
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const cell = cells[row * columns + column];
        if (cell === null) continue;
        for (let index = 0; index < cell.length; index += 1) {
          if (elementIntersects(x, y, radius, cell[index])) return true;
        }
      }
    }
    return false;
  }

  // Which element stopped a move. `circleIntersectsObstacle` only ever answers
  // yes/no, and the impact handler needs the tree itself: to shake the one that was
  // hit, and to fell it. Same predicate, so the two can never disagree - and the
  // scan stays a scan: the answer is "the first element in list order", which cell
  // order would silently change, and this runs once per impact rather than once
  // per axis per unit.
  function obstacleAt(x, y, radius, obstacleList = campaign.obstacles) {
    return obstacleList.find((obstacle) => blocksMovement(obstacle) && elementIntersects(x, y, radius, obstacle)) ?? null;
  }

  // The cell bounds are the element's own extent grown by the probe radius: a
  // point that could collide with the element is always in a cell the element was
  // filed under, so the lookup is exact rather than a best guess.
  function sightBounds(obstacle) {
    if (obstacleShape(obstacle) === "circle") {
      const reach = obstacle.radius + SIGHT_PROBE;
      return [obstacle.x - reach, obstacle.y - reach, obstacle.x + reach, obstacle.y + reach];
    }
    return [
      obstacle.x - SIGHT_PROBE, obstacle.y - SIGHT_PROBE,
      obstacle.x + obstacle.width + SIGHT_PROBE, obstacle.y + obstacle.height + SIGHT_PROBE,
    ];
  }

  function buildSightIndex(obstacles) {
    const columns = Math.max(1, Math.ceil(world.width / SIGHT_CELL));
    const rows = Math.max(1, Math.ceil(world.height / SIGHT_CELL));
    const cells = new Array(columns * rows).fill(null);
    for (const obstacle of obstacles) {
      // Sight is a separate column from movement, and the index files by that
      // column rather than by type: a tree stops an axle but not an eye, so it is
      // deliberately left out and the cell lists stay short.
      if (!clearsSight(obstacle)) continue;
      const [minX, minY, maxX, maxY] = sightBounds(obstacle);
      const firstColumn = clamp(Math.floor(minX / SIGHT_CELL), 0, columns - 1);
      const lastColumn = clamp(Math.floor(maxX / SIGHT_CELL), 0, columns - 1);
      const firstRow = clamp(Math.floor(minY / SIGHT_CELL), 0, rows - 1);
      const lastRow = clamp(Math.floor(maxY / SIGHT_CELL), 0, rows - 1);
      for (let row = firstRow; row <= lastRow; row += 1) {
        for (let column = firstColumn; column <= lastColumn; column += 1) {
          const slot = row * columns + column;
          (cells[slot] ??= []).push(obstacle);
        }
      }
    }
    return { columns, rows, cells };
  }

  // Keyed on the list identity *and* its length: a battle hands over a freshly
  // built array, and nothing mutates a live list in place.
  let sightIndex = null;
  let sightIndexSource = null;
  let sightIndexLength = -1;

  function sightIndexFor() {
    const obstacles = campaign.obstacles;
    if (sightIndex !== null && sightIndexSource === obstacles && sightIndexLength === obstacles.length) {
      return sightIndex;
    }
    sightIndex = buildSightIndex(obstacles);
    sightIndexSource = obstacles;
    sightIndexLength = obstacles.length;
    return sightIndex;
  }

  function sightBlockedAt(x, y) {
    const { columns, rows, cells } = sightIndexFor();
    // Outside the map the clamped edge cell is the conservative answer: it can
    // only add candidates, and `elementIntersects` still rejects them on distance.
    const column = clamp(Math.floor(x / SIGHT_CELL), 0, columns - 1);
    const row = clamp(Math.floor(y / SIGHT_CELL), 0, rows - 1);
    const cell = cells[row * columns + column];
    if (cell === null) return false;
    for (let index = 0; index < cell.length; index += 1) {
      if (elementIntersects(x, y, SIGHT_PROBE, cell[index])) return true;
    }
    return false;
  }

  function hasLineOfSight(fromX, fromY, toX, toY) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const length = distanceBetween(fromX, fromY, toX, toY);
    const steps = Math.ceil(length / SIGHT_STEP);
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

  return { circleIntersectsObstacle, hasLineOfSight, moveEntitySafely, obstacleAt };
}

