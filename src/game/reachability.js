import { elementIntersects } from "./elements.js";

// Abstract map check: "can a body of this size actually walk from A to B?".
//
// A battlefield is rolled from a seeded stream, so a scenario that needs a
// promise about the ground (a tiger you must be able to reach, a line of troops
// standing somewhere you can walk to) cannot ask for it after the fact - it has
// to ask the generator, which re-rolls until the answer is yes (see
// createBattlefield in map.js). This is the question it asks.
//
// A coarse flood fill over the obstacle list, not a pathfinder: nothing consumes
// the route, only its existence. A cell is walkable when the body fits at its
// centre, which is deliberately conservative - a false "blocked" costs one
// re-roll, while a false "clear" strands an objective behind a wall.
const REACHABILITY_CELL = 60;

// The fill on its own, so a caller with more than one question ("can the chariot
// stand here, and here, and here?") pays for the grid once instead of once per
// point. `from` is where the body starts; the answer is the set of cells it can
// reach from there. `goal`, when given, is always allowed to stand in an occupied
// cell: its own placement was cleared by the caller against the real geometry, and
// a body standing beside a wall must not read as walled in.
export function buildWalkMap({ from, world, obstacles, radius, cell = REACHABILITY_CELL, goal = null }) {
  const columns = Math.max(1, Math.ceil(world.width / cell));
  const rows = Math.max(1, Math.ceil(world.height / cell));
  const columnOf = (x) => Math.min(columns - 1, Math.max(0, Math.floor(x / cell)));
  const rowOf = (y) => Math.min(rows - 1, Math.max(0, Math.floor(y / cell)));
  const indexOf = (column, row) => row * columns + column;

  // Nothing in the way is the common case (half the catalog's mixes roll a wall
  // or two), and it needs no grid at all.
  if (obstacles.length === 0) return { reachable: () => true };

  const start = indexOf(columnOf(from.x), rowOf(from.y));

  const blocked = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = Math.min(world.width, (column + 0.5) * cell);
      const y = Math.min(world.height, (row + 0.5) * cell);
      blocked[indexOf(column, row)] = obstacles.some(
        (obstacle) => elementIntersects(x, y, radius, obstacle),
      ) ? 1 : 0;
    }
  }
  // The two endpoints are always allowed to stand in a "blocked" cell, for the
  // reason in the header comment.
  blocked[start] = 0;
  if (goal) blocked[indexOf(columnOf(goal.x), rowOf(goal.y))] = 0;

  const visited = new Uint8Array(columns * rows);
  const queue = new Int32Array(columns * rows);
  let head = 0;
  let tail = 0;
  visited[start] = 1;
  queue[tail] = start;
  tail += 1;

  // Four-way on purpose: a diagonal step between two touching walls is exactly
  // the gap a chariot cannot drive through.
  const visit = (next) => {
    if (visited[next] === 1 || blocked[next] === 1) return;
    visited[next] = 1;
    queue[tail] = next;
    tail += 1;
  };

  while (head < tail) {
    const current = queue[head];
    head += 1;
    const column = current % columns;
    const row = (current - column) / columns;
    if (column > 0) visit(current - 1);
    if (column < columns - 1) visit(current + 1);
    if (row > 0) visit(current - columns);
    if (row < rows - 1) visit(current + columns);
  }

  return {
    // A point counts when the fill got to its cell at all. The map check asks both
    // of its ground questions through this one grid: "can the chariot get here?"
    // and, for the samples it passes through here, "is there room for the line?".
    reachable: (point) => visited[indexOf(columnOf(point.x), rowOf(point.y))] === 1,
  };
}


