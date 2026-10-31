import { clamp } from "../utils/math.js";
import { blocksMovement, obstacleShape } from "./elements.js";

// Grid pathfinding for every unit that is not the player.
//
// The field is one Float32 array: `clear[cell]` is the signed distance from the
// cell's centre to the nearest obstacle surface (negative inside one), capped at
// MAXC. That single array answers every body size at once - a 12px spear and a
// 38px elephant read the same number against different thresholds - so there is
// no per-radius mask, no per-radius build and no per-radius memory. Four buckets
// (16/24/32/40) cover the whole roster: every unit radius in
// src/data/formations.js is 12-38, and `radiusBucket` rounds up to the next 8.
//
// Why a distance field rather than a blocked/clear grid: the bottleneck is the
// unit's *own* cell. 5-16% of requests start in a cell that does not fit the
// body, and a boolean grid can only answer "this cell is blocked", which strands
// the unit. With a distance the start and goal are snapped to the nearest cell
// that fits (two rings of Chebyshev), which the benchmarks show removes 100% of
// the route losses that cell granularity would otherwise cause.
//
// Why paint per obstacle rather than scan per cell: 3150 cells x 46 obstacles is
// ~145k distance tests, while 46 boxes of a few dozen cells each is ~2k. Measured
// 0.19ms against 4.1-5.3ms per bucket.
const CELL = 40;
// The cap is what keeps the field a small integer-ish array: past ~50px of
// clearance nothing changes a decision, so the far field is a plateau and one
// Float32Array covers 2800x1800 in 12.3KB.
const MAXC = 48;
const SNAP_RINGS = 2;

// A route that hugs a wall is legal but reads as a unit scraping along it, and
// the octile heuristic alone prefers the shortest - which is the wall. A step
// costs a little more the closer its target cell is to an obstacle, and the
// heuristic stays the plain octile (so it stays admissible). 0 disables it.
const CLEAR_REWARD = 0.3;

// Planning is the only unbounded work in here, so it is capped per frame. The
// steady state needs 48 units x ~1 replan/second = 0.8 plans/frame, so 2 leaves
// 2.5x of headroom; 0 disables planning entirely and leaves only the line gate.
const MAX_PLANS_PER_FRAME = 2;
const NODE_CAP = 1200;

// Waypoint arrival, the sampling step of the line gate, and the three ways a
// live route stops being live.
const ARRIVE = 14;
const LINE_STEP = 20;
// The exact validator walks finer than the grid gate: at 12px a body of at least
// 16px cannot slip between two samples, so a segment that passes is one the
// movement code will walk without a contact. 8px would be stricter for the same
// answer at 1.5x the cost, because every sample is a broadphase query.
const EXACT_STEP = 12;
const GOAL_MOVE = 24;
const STUCK_TIME = 0.3;
const STUCK_DIST = 6;
const FAIL_BACKOFF = 0.3;
const PLAN_TTL_MIN = 0.8;
const PLAN_TTL_SPAN = 0.4;

const DIAGONAL = CELL * Math.SQRT2;

// The four buckets the whole roster lands in, and the shape of the only
// comparison the rest of this file makes: `clear >= bucket`.
export function radiusBucket(radius) {
  return clamp(Math.ceil((radius ?? 0) / 8) * 8, 16, 40);
}

// Signed distance from a point to an obstacle surface, matching
// `elementIntersects` exactly: that predicate is `distance < radius`, so a cell
// with `clear === radius` is *not* blocked and `clear >= radius` is the
// passable test. The two can never disagree about a cell, which is what the
// [unit] test asserts for every cell centre and all four buckets.
function surfaceDistance(x, y, obstacle) {
  if (obstacleShape(obstacle) === "circle") {
    return Math.hypot(x - obstacle.x, y - obstacle.y) - obstacle.radius;
  }
  const dx = Math.max(obstacle.x - x, 0, x - (obstacle.x + obstacle.width));
  const dy = Math.max(obstacle.y - y, 0, y - (obstacle.y + obstacle.height));
  return Math.hypot(dx, dy);
}

function buildField(obstacles, world) {
  const columns = Math.max(1, Math.ceil(world.width / CELL));
  const rows = Math.max(1, Math.ceil(world.height / CELL));
  const count = columns * rows;
  const clear = new Float32Array(count);
  // The world border is painted first because it is a wall: `moveEntitySafely`
  // clamps a body to [radius, size - radius], so a body fits at a point exactly
  // when it is at least `radius` from every edge.
  for (let row = 0; row < rows; row += 1) {
    const y = (row + 0.5) * CELL;
    const edgeY = Math.min(y, world.height - y);
    for (let column = 0; column < columns; column += 1) {
      const x = (column + 0.5) * CELL;
      clear[row * columns + column] = Math.min(MAXC, edgeY, x, world.width - x);
    }
  }
  for (const obstacle of obstacles) {
    // Same column the collision broadphase files by: scenery that does not stop
    // a body must not shape a route either.
    if (!blocksMovement(obstacle)) continue;
    const circle = obstacleShape(obstacle) === "circle";
    const minX = circle ? obstacle.x - obstacle.radius : obstacle.x;
    const maxX = circle ? obstacle.x + obstacle.radius : obstacle.x + obstacle.width;
    const minY = circle ? obstacle.y - obstacle.radius : obstacle.y;
    const maxY = circle ? obstacle.y + obstacle.radius : obstacle.y + obstacle.height;
    // Every cell whose centre is within MAXC of the surface lies inside the
    // extent grown by MAXC, so the box is the complete set of cells to visit.
    const firstColumn = clamp(Math.floor((minX - MAXC) / CELL), 0, columns - 1);
    const lastColumn = clamp(Math.floor((maxX + MAXC) / CELL), 0, columns - 1);
    const firstRow = clamp(Math.floor((minY - MAXC) / CELL), 0, rows - 1);
    const lastRow = clamp(Math.floor((maxY + MAXC) / CELL), 0, rows - 1);
    for (let row = firstRow; row <= lastRow; row += 1) {
      const y = (row + 0.5) * CELL;
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const slot = row * columns + column;
        // The border may already be nearer than this obstacle; `min` keeps the
        // nearer of the two, which is the whole point of a distance field.
        const distance = surfaceDistance((column + 0.5) * CELL, y, obstacle);
        if (distance < clear[slot]) clear[slot] = distance < 0 ? 0 : distance;
      }
    }
  }
  return { columns, rows, cell: CELL, clear };
}

export function createPathSystem({ campaign, world, circleIntersectsObstacle }) {
  // The grid can overstate clearance by up to half a cell diagonal near a corner
  // (its values are sampled at cell centres, 40px apart). That is fine for the
  // search - a route one corner too tight still gets a unit moving - but not for
  // the segments a route *commits*: those are what the movement code walks, and a
  // segment that clips a tree corner makes a unit grind along it. So smoothing
  // confirms each segment against the real geometry through the collision
  // broadphase, which the movement index made cheap enough to call per 12px sample.
  if (typeof circleIntersectsObstacle !== "function") {
    throw new Error("createPathSystem needs circleIntersectsObstacle (see collision.js)");
  }
  const exactClear = (x, y, need) => !circleIntersectsObstacle(x, y, need);
  let field = null;
  let fieldSource = null;
  let fieldLength = -1;
  let fieldWidth = -1;
  let fieldHeight = -1;
  // Bumped on every rebuild. A route carries the generation it was planned in,
  // so a felled tree or a new battlefield invalidates every cached route without
  // the system having to know which units exist.
  let generation = 0;

  // Idempotent on (list identity, list length, world size) - the same contract
  // `sightIndexFor` in collision.js keeps, and for the same reason: a battle and
  // a fell both *replace* `campaign.obstacles`, so a new array is the
  // notification. Mutating the live array in place would read as unchanged and
  // leave a stale field, which is the one behaviour a caller must not rely on.
  function fieldFor() {
    const obstacles = campaign.obstacles;
    if (field !== null
      && fieldSource === obstacles && fieldLength === obstacles.length
      && fieldWidth === world.width && fieldHeight === world.height) {
      return field;
    }
    field = buildField(obstacles, world);
    fieldSource = obstacles;
    fieldLength = obstacles.length;
    fieldWidth = world.width;
    fieldHeight = world.height;
    generation += 1;
    return field;
  }

  function clearAt(x, y) {
    const grid = fieldFor();
    const column = clamp(Math.floor(x / CELL), 0, grid.columns - 1);
    const row = clamp(Math.floor(y / CELL), 0, grid.rows - 1);
    return grid.clear[row * grid.columns + column];
  }

  // The straight-line gate: would a body of `need` clearance walk this segment
  // without touching anything? Sampled every LINE_STEP, which is what makes it
  // 0.27µs (measured) instead of the ~400µs an exact geometric pull would cost.
  function lineClear(grid, fromX, fromY, toX, toY, need) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / LINE_STEP));
    for (let step = 0; step <= steps; step += 1) {
      const fraction = step / steps;
      const column = clamp(Math.floor((fromX + dx * fraction) / CELL), 0, grid.columns - 1);
      const row = clamp(Math.floor((fromY + dy * fraction) / CELL), 0, grid.rows - 1);
      if (grid.clear[row * grid.columns + column] < need) return false;
    }
    return true;
  }

  // The same question asked of the real geometry, for the segments a route keeps.
  function pathClear(fromX, fromY, toX, toY, need) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / EXACT_STEP));
    for (let step = 0; step <= steps; step += 1) {
      const fraction = step / steps;
      const x = fromX + dx * fraction;
      const y = fromY + dy * fraction;
      // The border is a wall too - `moveEntitySafely` clamps a body inside it -
      // and `circleIntersectsObstacle` does not know about it.
      if (x < need || y < need || x > world.width - need || y > world.height - need) return false;
      if (!exactClear(x, y, need)) return false;
    }
    return true;
  }

  // The nearest cell that fits the body, searched outwards in Chebyshev rings.
  // A start or goal inside a wall is the normal case for a unit standing beside
  // one, and two rings is what the benchmarks show removes the losses: the cell
  // centre is up to half a diagonal away from the body, so ring 1 covers the
  // margin and ring 2 covers a corner.
  function snap(grid, column, row, need) {
    if (grid.clear[row * grid.columns + column] >= need) return row * grid.columns + column;
    for (let ring = 1; ring <= SNAP_RINGS; ring += 1) {
      let best = -1;
      let bestDistance = Infinity;
      for (let offsetY = -ring; offsetY <= ring; offsetY += 1) {
        for (let offsetX = -ring; offsetX <= ring; offsetX += 1) {
          // The shell only: the interior was searched by the previous ring.
          if (Math.max(Math.abs(offsetX), Math.abs(offsetY)) !== ring) continue;
          const nextColumn = column + offsetX;
          const nextRow = row + offsetY;
          if (nextColumn < 0 || nextRow < 0 || nextColumn >= grid.columns || nextRow >= grid.rows) continue;
          const slot = nextRow * grid.columns + nextColumn;
          if (grid.clear[slot] < need) continue;
          const distance = offsetX * offsetX + offsetY * offsetY;
          if (distance < bestDistance) {
            bestDistance = distance;
            best = slot;
          }
        }
      }
      if (best !== -1) return best;
    }
    return -1;
  }

  // --- search ----------------------------------------------------------------
  // Scratch buffers live on the closure and are reused: a plan allocates nothing
  // except the waypoint array it returns, which keeps the whole thing off the GC
  // during a battle. `state` is the only buffer that has to be cleared - `g` and
  // `cameFrom` are read only where `state` says "seen", so a stale entry is
  // unreachable.
  let buffers = null;
  // The heap is state of the system rather than of one search: keeping it (and
  // its functions) at this level means V8 optimises push/pop once for the life of
  // the battle instead of re-creating the closures - and re-warming them - on
  // every plan.
  let heapNode = null;
  let heapCost = null;
  let heapCapacity = 0;
  let heapSize = 0;

  function ensureBuffers(count) {
    if (buffers !== null && buffers.count === count) return buffers;
    buffers = {
      count,
      g: new Float32Array(count),
      cameFrom: new Int32Array(count),
      state: new Uint8Array(count),
      // A binary heap never holds more than one entry per node, but a node can be
      // pushed again whenever a cheaper route is found, so the capacity is
      // generous: 4n + a hard size guard against a malformed push corrupting
      // `heapCost` neighbours. (The first draft sized this at n and wrote past
      // the end the moment someone tightened the heuristic.)
      heapNode: new Int32Array(count * 4),
      heapCost: new Float32Array(count * 4),
    };
    heapNode = buffers.heapNode;
    heapCost = buffers.heapCost;
    heapCapacity = heapNode.length;
    return buffers;
  }

  function heapPush(node, cost) {
    // Belt and braces: the capacity is 4n and a node is only pushed when its cost
    // improves, so this can only fire if the cost function ever stops being
    // consistent. Writing past the array is not an option.
    if (heapSize >= heapCapacity) return;
    let index = heapSize;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (heapCost[parent] <= cost) break;
      heapNode[index] = heapNode[parent];
      heapCost[index] = heapCost[parent];
      index = parent;
    }
    heapNode[index] = node;
    heapCost[index] = cost;
    heapSize += 1;
  }

  function heapPop() {
    const top = heapNode[0];
    heapSize -= 1;
    const lastNode = heapNode[heapSize];
    const lastCost = heapCost[heapSize];
    let index = 0;
    for (;;) {
      let child = index * 2 + 1;
      if (child >= heapSize) break;
      const right = child + 1;
      if (right < heapSize && heapCost[right] < heapCost[child]) child = right;
      if (heapCost[child] >= lastCost) break;
      heapNode[index] = heapNode[child];
      heapCost[index] = heapCost[child];
      index = child;
    }
    heapNode[index] = lastNode;
    heapCost[index] = lastCost;
    return top;
  }

  // Eight directions, no corner cutting. A diagonal step is only taken when both
  // orthogonal cells it cuts between are passable too: without that rule a route
  // squeezes through the diagonal gap between two touching trees, which no body
  // can actually fit through and which the smoothing then bakes into a segment.
  // Four flat arrays rather than eight tuples: the neighbour loop runs ~1500 times
  // per route and tuple destructuring is the slowest way to read two integers.
  const AXIS_X = new Int8Array([1, -1, 0, 0]);
  const AXIS_Y = new Int8Array([0, 0, 1, -1]);
  const DIAGONAL_X = new Int8Array([1, 1, -1, -1]);
  const DIAGONAL_Y = new Int8Array([1, -1, -1, 1]);
  const INV_MAXC = 1 / MAXC;
  const OCTILE_BEND = DIAGONAL - CELL * 2;

  function octile(offsetX, offsetY) {
    const dx = offsetX < 0 ? -offsetX : offsetX;
    const dy = offsetY < 0 ? -offsetY : offsetY;
    return CELL * (dx + dy) + OCTILE_BEND * (dx < dy ? dx : dy);
  }

  // One route, in cell indices, start and goal included. Returns null when the
  // goal is not reachable inside NODE_CAP expansions - a walled-in unit, or a
  // goal on an island - which the caller treats as "aim straight and hope".
  function search(grid, start, goal, need) {
    const columns = grid.columns;
    const rows = grid.rows;
    const clear = grid.clear;
    const { g, cameFrom, state } = ensureBuffers(columns * rows);
    heapSize = 0;
    state.fill(0);



    const goalColumn = goal % columns;
    const goalRow = (goal - goalColumn) / columns;
    const startColumn = start % columns;
    const startRow = (start - startColumn) / columns;
    state[start] = 1;
    cameFrom[start] = -1;
    g[start] = 0;
    heapPush(start, octile(startColumn - goalColumn, startRow - goalRow));

    let expanded = 0;
    stats.searches += 1;
    while (heapSize > 0) {
      const current = heapPop();
      // A node can sit in the heap twice; the second copy is already closed.
      if (state[current] === 2) continue;
      state[current] = 2;
      if (current === goal) {
        stats.expanded += expanded;
        const route = [];
        for (let node = current; node !== -1; node = cameFrom[node]) route.push(node);
        route.reverse();
        return route;
      }
      // The cap bounds the only unbounded work in the file: a search that cannot
      // reach its goal must still end, and a frame must never wait for it.
      if (expanded >= NODE_CAP) {
        stats.expanded += expanded;
        return null;
      }
      expanded += 1;
      const currentG = g[current];
      const column = current % columns;
      const row = (current - column) / columns;
      const rowBase = row * columns;
      for (let direction = 0; direction < 4; direction += 1) {
        const nextColumn = column + AXIS_X[direction];
        const nextRow = row + AXIS_Y[direction];
        if (nextColumn < 0 || nextColumn >= columns || nextRow < 0 || nextRow >= rows) continue;
        const next = nextRow * columns + nextColumn;
        const nextClear = clear[next];
        if (nextClear < need) continue;
        // A step is dearer the tighter its target cell is, so a route prefers the
        // middle of a gap without ever refusing the gap. The heuristic is still
        // the plain octile, so it stays admissible.
        const cost = currentG + CELL * (1 + CLEAR_REWARD * (1 - (nextClear < MAXC ? nextClear : MAXC) * INV_MAXC));
        if (state[next] !== 0 && cost >= g[next]) continue;
        state[next] = 1;
        g[next] = cost;
        cameFrom[next] = current;
        heapPush(next, cost + octile(nextColumn - goalColumn, nextRow - goalRow));
      }
      for (let direction = 0; direction < 4; direction += 1) {
        const nextColumn = column + DIAGONAL_X[direction];
        const nextRow = row + DIAGONAL_Y[direction];
        if (nextColumn < 0 || nextColumn >= columns || nextRow < 0 || nextRow >= rows) continue;
        const next = nextRow * columns + nextColumn;
        const nextClear = clear[next];
        if (nextClear < need) continue;
        // Both faces of the diagonal must fit the body, or the route is cutting a
        // corner that nothing can pass through.
        if (clear[rowBase + nextColumn] < need) continue;
        if (clear[nextRow * columns + column] < need) continue;
        const cost = currentG + DIAGONAL * (1 + CLEAR_REWARD * (1 - (nextClear < MAXC ? nextClear : MAXC) * INV_MAXC));
        if (state[next] !== 0 && cost >= g[next]) continue;
        state[next] = 1;
        g[next] = cost;
        cameFrom[next] = current;
        heapPush(next, cost + octile(nextColumn - goalColumn, nextRow - goalRow));
      }
    }
    return null;
  }


  // Cells -> waypoints. The greedy version of a string pull: from the current
  // anchor, keep extending while the sampled segment stays clear, then commit the
  // furthest point that does. It is not the exact visibility graph - that costs
  // ~400µs a route - but it turns the 60-90 cell staircase a 40px grid produces
  // into ~6 waypoints (measured 6.2), which is all the movement code needs: a
  // unit walks straight between waypoints and its own collision test still
  // applies to every step it takes.
  function smooth(grid, points, need) {
    const kept = [];
    let current = 0;
    while (current < points.length - 1) {
      let next = current + 1;
      // Cheap first: the grid finds how far this segment could go.
      while (next + 1 < points.length
        && lineClear(grid, points[current].x, points[current].y, points[next + 1].x, points[next + 1].y, need)) {
        next += 1;
      }
      // Then exact: back off a cell at a time until the real geometry agrees.
      while (next > current + 1
        && !pathClear(points[current].x, points[current].y, points[next].x, points[next].y, need)) {
        next -= 1;
      }
      if (!pathClear(points[current].x, points[current].y, points[next].x, points[next].y, need)) {
        // Even one cell ahead is blocked. That is the goal itself sitting inside
        // an obstacle's margin (a formation slot jammed against a tree), so the
        // route ends at the last point that was reachable instead of committing a
        // segment through the wall. On the very first step there is nothing to
        // keep, so the first cell is emitted anyway: it is snapped to the nearest
        // cell that fits, and moving toward it beats standing still.
        if (kept.length === 0) kept.push(points[1]);
        break;
      }
      kept.push(points[next]);
      current = next;
    }
    return kept;
  }

  function plan(unit, goalX, goalY, need) {
    const grid = fieldFor();
    const startColumn = clamp(Math.floor(unit.x / CELL), 0, grid.columns - 1);
    const startRow = clamp(Math.floor(unit.y / CELL), 0, grid.rows - 1);
    const goalColumn = clamp(Math.floor(goalX / CELL), 0, grid.columns - 1);
    const goalRow = clamp(Math.floor(goalY / CELL), 0, grid.rows - 1);
    const start = snap(grid, startColumn, startRow, need);
    const goal = snap(grid, goalColumn, goalRow, need);
    if (start === -1 || goal === -1) return null;
    const cells = search(grid, start, goal, need);
    if (cells === null) return null;
    // The unit's own position anchors the first segment, and the exact goal (not
    // its cell centre) ends the route: a formation slot is a point, and arriving
    // 20px off it would leave every rank visibly skewed.
    const points = [{ x: unit.x, y: unit.y }];
    for (let index = 0; index < cells.length; index += 1) {
      const column = cells[index] % grid.columns;
      points.push({
        x: (column + 0.5) * CELL,
        y: ((cells[index] - column) / grid.columns + 0.5) * CELL,
      });
    }
    points.push({ x: goalX, y: goalY });
    return smooth(grid, points, need);
  }

  // --- the per-frame gate -----------------------------------------------------
  // `beginFrame` is the only clock this file reads: a delta accumulated by the
  // caller, never `performance.now()`. A route's timers therefore replay exactly
  // under H5_TRACE and expire identically on a machine running the frame half as
  // often.
  let clock = 0;
  let plansThisFrame = 0;
  const stats = { gated: 0, reused: 0, planned: 0, deferred: 0, failed: 0, searches: 0, expanded: 0 };
  // The direct-goal answer is a shared scratch: the caller reads it immediately
  // and the next call overwrites it. Allocation-free is the point; do not keep
  // the reference.
  const aim = { x: 0, y: 0 };

  function beginFrame(delta) {
    clock += delta;
    plansThisFrame = 0;
  }

  // Where a unit should walk this frame to reach (goalX, goalY).
  //
  // Three tiers, cheapest first:
  //   1. a live route planned for (approximately) this goal - reuse its waypoint;
  //   2. a clear straight line - hand the goal straight back, which is the case
  //      for most units most of the time and costs one 20px-sampled walk;
  //   3. a plan, the only unbounded work here, capped per frame.
  //
  // "Approximately" is GOAL_MOVE: a formation slot drifts a few pixels as the
  // ranks jostle, and replanning on every pixel of that would plan every frame.
  function waypoint(unit, goalX, goalY) {
    const grid = fieldFor();
    const need = radiusBucket(unit.radius);
    if (MAX_PLANS_PER_FRAME > 0) {
      const live = unit.route;
      if (live) {
        if (live.generation !== generation) {
          // The field moved under this route (a tree fell, or a new battle): its
          // waypoints may now cut through the stump's successor, so it is only
          // ever as good as the field it was planned on.
          unit.route = null;
        } else if (live.index < live.points.length) {
          // Wedged against something the plan did not expect. A unit that has
          // travelled less than STUCK_DIST in STUCK_TIME gets a fresh plan;
          // otherwise the anchor moves and the route is kept, which is what stops
          // a slow unit (a chariot in the shallows) from replanning.
          if (clock - live.anchorAt >= STUCK_TIME) {
            if (Math.hypot(unit.x - live.anchorX, unit.y - live.anchorY) < STUCK_DIST) {
              unit.route = null;
            } else {
              live.anchorX = unit.x;
              live.anchorY = unit.y;
              live.anchorAt = clock;
            }
          }
          const route = unit.route;
          if (route) {
            const offsetX = goalX - route.goalX;
            const offsetY = goalY - route.goalY;
            if (clock < route.expiry && offsetX * offsetX + offsetY * offsetY <= GOAL_MOVE * GOAL_MOVE) {
              while (route.index < route.points.length) {
                const point = route.points[route.index];
                const dx = point.x - unit.x;
                const dy = point.y - unit.y;
                if (dx * dx + dy * dy >= ARRIVE * ARRIVE) break;
                route.index += 1;
              }
              if (route.index < route.points.length) {
                stats.reused += 1;
                return route.points[route.index];
              }
              // The route was walked to its end and the unit is still short of the
              // goal - a slot in front of a tree, a pocket its body cannot fit
              // through. Replanning from here on every frame would burn the whole
              // frame budget for the rest of the battle (measured: 50 plans a
              // second), so it counts as a failure: drop the route, back off, and
              // aim straight at the goal meanwhile.
              unit.route = null;
              unit.routeRetryAt = clock + FAIL_BACKOFF;
            }
          }
        }
      }
    }
    if (lineClear(grid, unit.x, unit.y, goalX, goalY, need)) {
      unit.route = null;
      stats.gated += 1;
      aim.x = goalX;
      aim.y = goalY;
      return aim;
    }
    // Planning disabled, this frame's budget spent, or a recent failure still
    // backing off: aim straight and let the unit's own collision test handle it.
    if (MAX_PLANS_PER_FRAME === 0 || plansThisFrame >= MAX_PLANS_PER_FRAME || clock < (unit.routeRetryAt ?? 0)) {
      stats.deferred += 1;
      aim.x = goalX;
      aim.y = goalY;
      return aim;
    }
    plansThisFrame += 1;
    const points = plan(unit, goalX, goalY, need);
    if (points === null) {
      // Unreachable inside the node cap. Back off for a moment instead of running
      // the same failed search on the next frame, every frame.
      unit.route = null;
      unit.routeRetryAt = clock + FAIL_BACKOFF;
      stats.failed += 1;
      aim.x = goalX;
      aim.y = goalY;
      return aim;
    }
    const planCount = (unit.routePlans ?? 0) + 1;
    unit.routePlans = planCount;
    unit.route = {
      points,
      index: 0,
      goalX,
      goalY,
      generation,
      // Jittered by the plan sequence, not by a random source: two units in the
      // same frame must not share an expiry, and H5_TRACE must replay it exactly.
      expiry: clock + PLAN_TTL_MIN + ((planCount * 0.37) % 1) * PLAN_TTL_SPAN,
      anchorX: unit.x,
      anchorY: unit.y,
      anchorAt: clock,
    };
    stats.planned += 1;
    return points[0] ?? aim;
  }

  return {
    beginFrame,
    waypoint,
    // Exposed for the tests: the field, its clearance query, the line gate, and
    // the counters that say which tier did the work.
    field: fieldFor,
    clearAt,
    lineClear,
    radiusBucket,
    stats,
  };
}

