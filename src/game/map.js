import { cloudKinds, elementRules, obstacleKinds, terrainKinds } from "../data/elements.js";
import { ringCoverage, ringElements } from "../data/ring-elements.js";
import { ringRules } from "../data/rings.js";
import { createRingLayout } from "./rings.js";

// Every number and every kind lives in src/data/elements.js, and where a kind is
// allowed to grow lives in src/data/ring-elements.js; this file only decides
// *where* in that permission things go.
//
// The field is the 回 pattern of src/game/rings.js: a kind is placed by first
// picking a band from its own level table, then a point inside that band, so a
// marsh's water gathers on the outer bands and its trees stand in the middle one
// without a single branch here. A rejected point is retried in the same kind's
// next band pick - the table is the rule, not a one-shot claim.
//
// The draw order below is load-bearing: a battle's `random` is a seeded stream,
// so changing the order or the number of rolls changes every map that follows
// from a `?seed=` run. Ring placement costs a fixed number of rolls (one for the
// band, three for the point), which is why a reshuffled ratio moves the elements
// without changing how many rolls the field takes.
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

// One kind's band weights: the authored level table resolved through
// ringRules.levels and multiplied by each band's own area. The area factor is what
// makes a level mean *density* rather than a count: `high` is three trees per
// square pixel-band for every one in a `low` band, so thinning the middle band
// moves trees outward instead of crushing them into a sliver - and resizing a band
// never turns into a wall of trunks.
//
// `null` means "no opinion" - a kind with no row of its own, or one whose levels
// are all `none`, which is a table mistake rather than an instruction to leave the
// field bare.
function ringWeightsFor(type, layout) {
  const table = ringElements[type];
  if (!table) return null;
  const weights = {};
  let total = 0;
  for (const ring of layout.rings) {
    const level = ringRules.levels[table[ring.id]] ?? 0;
    if (level > 0) {
      weights[ring.id] = level * ring.bandArea;
      total += level * ring.bandArea;
    }
  }
  return total > 0 ? weights : null;
}

// The fallback: every band weighted by its own area, which is level 1 everywhere -
// exactly a uniform scatter over the field, because a band is sampled uniformly
// inside itself. One code path for both cases, and the same fixed number of rolls.
function fieldWeights(layout) {
  const weights = {};
  for (const ring of layout.rings) weights[ring.id] = ring.bandArea;
  return weights;
}

// Where one attempt goes: a band from the kind's table, then a point inside it,
// inset from the world edge by whatever that kind's silhouette needs.
function placeInBand(layout, weights, random, insetX, insetY) {
  const ring = layout.pickRing(weights, random);
  const point = layout.samplePoint(ring, random, { insetX, insetY });
  return { ring, x: point.x, y: point.y };
}

// The ground an obstacle takes up, in px2, for the per-band coverage cap. A
// palisade counts its whole rect: it is drawn there whether or not anyone can
// walk through the gaps between its posts.
function obstacleFootprint(obstacle) {
  if (obstacle.width !== undefined) return obstacle.width * obstacle.height;
  return Math.PI * obstacle.radius * obstacle.radius;
}

export function createBattlefield(random, player, world, circleIntersectsObstacle, mix = null, validate = null, layout = null) {
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
  // Rings are per world, not per roll: a rejected field is rolled again with the
  // same bands, and a caller that owns a layout (the launch-query override, a
  // scenario with its own pattern) hands it in here.
  const rings = layout ?? createRingLayout(world);
  let field = null;
  for (let attempt = 0; attempt < MAP_ROLL_ATTEMPTS; attempt += 1) {
    field = rollBattlefield(random, player, world, circleIntersectsObstacle, mix, rings);
    if (!validate || validate(field)) return field;
  }
  // Out of attempts: the last roll is played rather than an empty field. A
  // scenario that cannot find acceptable ground in this many rolls has a check
  // that is too strict for the catalog, and a missing battlefield would be a
  // crash instead of a compromise.
  return field;
}

function rollBattlefield(random, player, world, circleIntersectsObstacle, mix, layout) {
  const { width, height } = world;
  const safeX = width / 2;
  const safeY = height / 2;

  // A mix that names no known kind would leave the map bare, so it falls back to
  // the whole catalog instead.
  let obstacleTable = obstacleTableFor(mix);
  if (obstacleTable.length === 0) obstacleTable = obstacleTableFor(null);
  let terrainTable = terrainTableFor(mix);
  if (terrainTable.length === 0) terrainTable = terrainTableFor(null);

  // One table per kind, worked out once: the obstacle loop asks for its type's
  // bands on every attempt, and rebuilding them there would allocate a table per
  // roll for no reason.
  const weightsByType = new Map();
  const bandWeights = (type) => {
    let weights = weightsByType.get(type);
    if (!weights) {
      weights = ringWeightsFor(type, layout) ?? fieldWeights(layout);
      weightsByType.set(type, weights);
    }
    return weights;
  };

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
    const weights = bandWeights(type);
    for (let index = 0; index < count; index += 1) {
      const radius = randomIn(row.size.radius, random);
      const { x, y } = placeInBand(layout, weights, random, terrainEdge, terrainEdge);
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
  // Ground taken per band, for the coverage cap: a band stops accepting once its
  // share of the field has been spoken for, so no ratio can pave one band solid.
  const covered = new Map();
  // The budget is a target, not a count of tries: a rejected obstacle does not eat
  // a slot, so a tree-heavy mix still ends up with the same obstacle count as a
  // wall-heavy one.
  for (let attempt = 0; attempt < elementRules.obstacleAttemptCap
    && obstacles.length < elementRules.obstacleTarget; attempt += 1) {
    const { type, row } = rollObstacle(obstacleTable, random);
    const { ring, x, y } = placeInBand(layout, bandWeights(type), random, edge, edge);
    if (Math.hypot(x - safeX, y - safeY) < elementRules.obstacleSafeRadius) continue;

    const obstacle = row.size.orient === "axis"
      ? placeAxisRect(type, row, x, y, random)
      : { type, x, y, radius: randomIn(row.size.radius, random) };
    // A palisade that runs off the map would be clipped by the border. It used to
    // be thrown away; on the rim that would cost half the walls, and the rim is
    // exactly where walls belong, so it is nudged inside the margin instead.
    if (obstacle.width !== undefined) {
      obstacle.x = Math.min(obstacle.x, width - elementRules.obstacleEdgeMargin - obstacle.width);
      obstacle.y = Math.min(obstacle.y, height - elementRules.obstacleEdgeMargin - obstacle.height);
    }
    const footprint = obstacleFootprint(obstacle);
    const cap = (ringCoverage[ring] ?? 1) * layout.bandOf(ring).bandArea;
    if ((covered.get(ring) ?? 0) + footprint > cap) continue;
    // Only the rows that look wrong when they touch ask for this: two walls read
    // as one longer palisade, two trees read as a clipped canopy.
    if (row.rejectExisting && circleIntersectsObstacle(x, y, obstacle.radius, obstacles)) continue;
    covered.set(ring, (covered.get(ring) ?? 0) + footprint);
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
