import { cloudKinds, elementRules, obstacleKinds, terrainKinds } from "../data/elements.js";

// Every number and every kind lives in src/data/elements.js; this file only
// decides *where* things go. The draw order below is load-bearing: a battle's
// `random` is a seeded stream, so changing the order or the number of rolls
// changes every map that follows from a `?seed=` run.
//
// Placement and acceptance are separate steps: `rollBattlefield` fills the field,
// `createBattlefield` asks the scenario's map check whether the result is
// playable and rolls the whole thing again if it is not (see the comment on
// createBattlefield).

function randomIn([min, max], random) {
  return min + random() * (max - min);
}

// How many whole-field rolls a scenario's map check may reject before the last
// one is accepted. Generous on purpose: a roll is cheap (a few dozen elements)
// and the alternative is handing the player an unwinnable field.
const MAP_ROLL_ATTEMPTS = 12;

// Weighted pick over a table of `{ type, row, weight }`: one draw, and the first
// entry whose cumulative weight covers the roll wins.
function rollObstacle(table, random) {
  const total = table.reduce((sum, entry) => sum + entry.weight, 0);
  const roll = random() * total;
  let cursor = 0;
  for (const entry of table) {
    cursor += entry.weight;
    if (roll < cursor) return entry;
  }
  return table[table.length - 1];
}

// A battlefield's mix narrows the catalog; without one, every row competes at
// its catalog weight and every terrain kind spawns its default count. Kinds the
// mix leaves out, or names with a zero, never spawn.
function obstacleTableFor(mix) {
  const entries = mix?.obstacles
    ? Object.entries(mix.obstacles)
    : Object.entries(obstacleKinds).map(([type, row]) => [type, row.weight]);
  return entries
    .filter(([type, weight]) => obstacleKinds[type] && weight > 0)
    .map(([type, weight]) => ({ type, row: obstacleKinds[type], weight }));
}

function terrainTableFor(mix) {
  const entries = mix?.terrain
    ? Object.entries(mix.terrain)
    : Object.entries(terrainKinds).map(([type, row]) => [type, row.placement.count]);
  return entries
    .filter(([type, count]) => terrainKinds[type] && count > 0)
    .map(([type, count]) => ({ type, row: terrainKinds[type], count: Math.floor(count) }));
}

// A wall: one long side and one thin side, on whichever axis the roll picks, so
// the field gets both horizontal and vertical palisades.
function placeAxisRect(type, row, x, y, random) {
  const horizontal = random() < 0.5;
  // Width consumes the first size roll and height the second, whichever way the
  // wall is laid out: that is the order the old object literal evaluated in, and
  // a seeded stream must not see the two rolls swap.
  const width = randomIn(horizontal ? row.size.long : row.size.thin, random);
  const height = randomIn(horizontal ? row.size.thin : row.size.long, random);
  return { type, x, y, width, height };
}

export function createBattlefield(random, player, world, circleIntersectsObstacle, mix = null, validate = null) {
  // The abstract map check. Every battlefield is rolled whole from the stream;
  // `validate` is the scenario's own acceptance test on the finished field, and a
  // scenario with nothing to promise passes `null` - which is what the campaign
  // does, so a `?seed=` run still rolls exactly the map it always did (one roll,
  // no extra draws).
  //
  // A scenario that does promise something (the tutorial: the tiger and the drill
  // line have to be walkable ground) hands in a check, and a field that fails it
  // is thrown away and drawn again. Retrying consumes more of the same stream,
  // which is why the campaign passes `null` rather than a check that is always
  // true: the number of rolls is part of the seeded contract.
  let field = null;
  for (let attempt = 0; attempt < MAP_ROLL_ATTEMPTS; attempt += 1) {
    field = rollBattlefield(random, player, world, circleIntersectsObstacle, mix);
    if (!validate || validate(field)) return field;
  }
  // Out of attempts: the last roll is played rather than an empty field. A
  // scenario that cannot find acceptable ground in this many rolls has a check
  // that is too strict for the catalog, and a missing battlefield would be a
  // crash instead of a compromise.
  return field;
}

function rollBattlefield(random, player, world, circleIntersectsObstacle, mix) {
  const { width, height } = world;
  const safeX = width / 2;
  const safeY = height / 2;

  // A mix that names no known kind would leave the map bare, so it falls back to
  // the whole catalog instead.
  let obstacleTable = obstacleTableFor(mix);
  if (obstacleTable.length === 0) obstacleTable = obstacleTableFor(null);
  let terrainTable = terrainTableFor(mix);
  if (terrainTable.length === 0) terrainTable = terrainTableFor(null);

  const sky = cloudKinds.sky;
  const clouds = [];
  for (let index = 0; index < sky.count; index += 1) {
    clouds.push({
      type: "sky",
      x: random() * width,
      y: random() * height,
      width: randomIn(sky.size.width, random),
      height: randomIn(sky.size.height, random),
      speed: randomIn(sky.drift.speed, random),
      opacity: randomIn(sky.opacity, random),
      phase: random() * Math.PI * 2,
    });
  }

  const terrain = [];
  const terrainEdge = elementRules.terrainEdgeMargin;
  for (const { type, row, count } of terrainTable) {
    for (let index = 0; index < count; index += 1) {
      const radius = randomIn(row.size.radius, random);
      const x = terrainEdge + random() * (width - terrainEdge * 2);
      const y = terrainEdge + random() * (height - terrainEdge * 2);
      if (Math.hypot(x - safeX, y - safeY) < elementRules.terrainSafeRadius) continue;
      terrain.push({
        type,
        x,
        y,
        radiusX: radius * randomIn(row.size.aspectX, random),
        radiusY: radius * randomIn(row.size.aspectY, random),
      });
    }
  }

  const obstacles = [];
  const edge = elementRules.edgeMargin;
  // The budget is a target, not a count of tries: a rejected tree does not eat a
  // slot, so a tree-heavy mix still ends up with the same obstacle count as a
  // wall-heavy one.
  for (let attempt = 0; attempt < elementRules.obstacleAttemptCap
    && obstacles.length < elementRules.obstacleTarget; attempt += 1) {
    const x = edge + random() * (width - edge * 2);
    const y = edge + random() * (height - edge * 2);
    if (Math.hypot(x - safeX, y - safeY) < elementRules.obstacleSafeRadius) continue;

    const { type, row } = rollObstacle(obstacleTable, random);
    const obstacle = row.size.orient === "axis"
      ? placeAxisRect(type, row, x, y, random)
      : { type, x, y, radius: randomIn(row.size.radius, random) };
    // A palisade that runs off the map would be clipped by the border, so it is
    // dropped instead. Circles cannot overflow: they already spawn inside the
    // edge margin.
    if (x + (obstacle.width ?? 0) > width - elementRules.obstacleEdgeMargin
      || y + (obstacle.height ?? 0) > height - elementRules.obstacleEdgeMargin) continue;
    // Only the rows that look wrong when they touch ask for this: two walls read
    // as one longer palisade, two trees read as a clipped canopy.
    if (row.rejectExisting && circleIntersectsObstacle(x, y, obstacle.radius, obstacles)) continue;
    obstacles.push(obstacle);
  }

  player.x = safeX;
  player.y = safeY;
  // The spawn point is the one place the player must never start inside geometry.
  if (circleIntersectsObstacle(player.x, player.y, player.radius, obstacles)) {
    obstacles.splice(0, obstacles.length);
  }
  return { obstacles, terrain, clouds };
}
