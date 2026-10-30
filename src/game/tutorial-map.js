import { formationPresets } from "../data/formations.js";
import { clamp } from "../utils/math.js";
import { rectHitsAnyObstacle } from "./elements.js";
import { buildWalkMap } from "./reachability.js";
import { formationGroundExtent } from "./units/formations.js";

// The tutorial's battlefield promises, and where its three encounters stand.
//
// The tiger is a pure function of the spawn point: it is on the field from the
// first frame, so "where the chariot starts" is where it has to be reachable
// from. Because it is fixed, the ground under it can be *checked* before the
// battle starts (see createTutorialMapCheck), and a field that fails is rolled
// again by map.js.
//
// The three lines are not. Each forms against wherever the chariot *is at that
// moment*: 乱军先锋 when the tiger dies, the clan's squad when that line falls,
// and 乱军精锐 when the squad has been mustered. A player who chased the animal
// across the field must not be shown a pan back to the map's starting corner. So
// the layout below is a *preference*, not a promise: layOnLadder() walks it as a
// ladder of bearings and distances from a live origin and takes the first
// footprint that is clear, free and that the chariot can drive to.
export const TUTORIAL_LAYOUT = {
  tiger: { distance: 470, bearing: -0.34 },
  line: { distance: 900, bearing: 0.62 },
  // The squad rides in from the far quarter: the player has just fought his way
  // out to 0.62 rad, so the clan's men are mustered on the opposite side and the
  // muster is not a walk back into the fight he just left. 560px is off screen
  // vertically (the view is 592px tall), so the pan that reveals them is a
  // reveal - and short, because this is the third pan of one drill.
  squad: { distance: 560, bearing: -2.1 },
  // The second band forms where the first one did: the same bearing and distance,
  // so the two encounters read as one battlefield rather than as two maps.
  wave: { distance: 900, bearing: 0.62 },
};

// Ground clearance for the tiger's spot, beyond the body that stands on it: it is
// a body that turns and lunges, so it needs a little air on every side.
const TUTORIAL_TIGER_CLEARANCE = 26;

// How far the line is asked to stand, most preferred first. The top of the ladder
// is deliberate: 900 and 820 are outside the 960x592 view, so the pan that
// reveals the line is a reveal. The shorter rungs are the fallback for a corner
// of the map with no clear ground beyond them - still far enough that the line
// reads as "over there", never closer than a chariot's own length.
export const LINE_DISTANCES = [900, 820, 740, 660, 580, 500, 420];

// The squad's ladder starts where its own reveal still works - 560px, off the
// bottom of the view - and then steps *inwards*: a muster is a scene, and the
// player has to be able to see his borrowed line and drive into it, so a blocked
// spot is answered by standing the men nearer rather than by a longer pan. The
// two outer rungs are the fallback for a corner where 560 is against a wall.
export const SQUAD_DISTANCES = [560, 480, 420, 640, 720];

// Bearings tried at each distance, as offsets from the authored bearing: the
// preferred direction first, then outwards, and the far side last. Fixed order and
// no random numbers - the same battlefield and the same standing place always give
// the same line, for the drill's line, its squad and the second band alike.
const BEARING_STEPS = [
  0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4, 1.75, -1.75, Math.PI,
];

// Samples per axis when the map check asks "is there room for the line from
// here?" across the whole walkable field.
const CHECK_COLUMNS = 4;
const CHECK_ROWS = 3;

export function lineGroundExtent() {
  return formationGroundExtent(formationPresets.tutorialLine);
}

export function squadGroundExtent() {
  return formationGroundExtent(formationPresets.tutorialSquad);
}

export function waveGroundExtent() {
  return formationGroundExtent(formationPresets.tutorialWave);
}

function pointAt(world, spawn, { distance, bearing }) {
  return {
    x: clamp(spawn.x + Math.cos(bearing) * distance, 140, world.width - 140),
    y: clamp(spawn.y + Math.sin(bearing) * distance, 140, world.height - 140),
  };
}

// Where the tiger waits for this battlefield. Called by the map check while the
// field is being rolled and by the tutorial when it spawns (src/game/tutorial.js),
// so the two can never disagree about the ground.
export function planTigerGround(world, spawn) {
  return pointAt(world, spawn, TUTORIAL_LAYOUT.tiger);
}

// A rotated footprint is inside the world when its circumradius is.
function footprintFits(world, spot, halfWidth, halfHeight) {
  const reach = Math.hypot(halfWidth, halfHeight);
  return spot.x - reach >= 0 && spot.x + reach <= world.width
    && spot.y - reach >= 0 && spot.y + reach <= world.height;
}

// The one search behind every line the drill stands: walk a ladder of distances
// and bearings out from a live origin and take the first footprint that fits the
// world, is clear of the palisades, is not standing on a line already on the
// field, and that the chariot can drive to.
//
// `walk` is an optional prebuilt walk map; the map check shares one fill across
// its samples instead of paying for one per sample, which is sound because
// four-way reachability is symmetric - every sample it passes in is already in
// the same region as the fill's origin.
//
// Never returns null: if the field has no clear footprint anywhere on the ladder
// (a corner boxed in by walls), the first clear-but-unreachable candidate is
// used, and failing even that, the preferred bearing is used anyway. The drill
// has to go on - an animal killed with nothing left to fight would be a soft
// lock, while a line standing with a wheel in a wall is merely ugly. The answer
// says which it was: `clear` is true only for a footprint that was both clear and
// drivable, so the map check can turn a false one into a re-roll while the drill
// spawns regardless.
//
// `avoid` is the ground other lines are already standing on, as
// `{ x, y, halfWidth, halfHeight }` boxes - two footprints on the same ground
// interpenetrate for the rest of the battle, and the second band is placed while
// the borrowed squad is still on the field.
function layOnLadder(origin, {
  world, obstacles = [], radius = 17, walk = null, layout, distances, extent, avoid = [],
}) {
  const { halfWidth, halfHeight } = extent;
  const map = walk ?? buildWalkMap({ from: origin, world, obstacles, radius });
  let unreachable = null;

  for (const distance of distances) {
    for (const step of BEARING_STEPS) {
      const bearing = layout.bearing + step;
      const x = origin.x + Math.cos(bearing) * distance;
      const y = origin.y + Math.sin(bearing) * distance;
      // Every line faces the chariot it was summoned against, which is what makes
      // the ranks read as a line of troops rather than as a rectangle of soldiers.
      const heading = Math.atan2(origin.y - y, origin.x - x);
      const spot = { x, y, heading };
      if (!footprintFits(world, spot, halfWidth, halfHeight)) continue;
      if (rectHitsAnyObstacle(x, y, halfWidth, halfHeight, heading, obstacles)) continue;
      if (avoid.some((box) => box
        && Math.abs(box.x - x) < box.halfWidth + halfWidth
        && Math.abs(box.y - y) < box.halfHeight + halfHeight)) continue;
      if (map.reachable(spot)) return { ...spot, clear: true };
      unreachable = unreachable ?? spot;
    }
  }

  if (unreachable) return { ...unreachable, clear: false };
  const distance = distances[0];
  const bearing = layout.bearing;
  return {
    x: origin.x + Math.cos(bearing) * distance,
    y: origin.y + Math.sin(bearing) * distance,
    heading: bearing + Math.PI,
    clear: false,
  };
}

// Where the drill line stands, given where the chariot is standing now.
export function findLineGround(origin, { world, obstacles = [], radius = 17, walk = null, avoid = [] }) {
  return layOnLadder(origin, {
    world, obstacles, radius, walk, avoid,
    layout: TUTORIAL_LAYOUT.line,
    distances: LINE_DISTANCES,
    extent: lineGroundExtent(),
  });
}

// Where the clan's squad is mustered: the same ladder, from the opposite quarter
// and on a shorter leash. It is a friendly line, so it is placed by the caller and
// not by the ally spawner - the ally spawner reads the hire ladder, and nobody
// bought this squad.
export function findSquadGround(origin, { world, obstacles = [], radius = 17, walk = null, avoid = [] }) {
  return layOnLadder(origin, {
    world, obstacles, radius, walk, avoid,
    layout: TUTORIAL_LAYOUT.squad,
    distances: SQUAD_DISTANCES,
    extent: squadGroundExtent(),
  });
}

// Where the second band forms: the drill line's own ladder, on a wider footprint.
export function findWaveGround(origin, { world, obstacles = [], radius = 17, walk = null, avoid = [] }) {
  return layOnLadder(origin, {
    world, obstacles, radius, walk, avoid,
    layout: TUTORIAL_LAYOUT.wave,
    distances: LINE_DISTANCES,
    extent: waveGroundExtent(),
  });
}

// The samples of walkable ground the line has to fit from.
function checkSamples(world) {
  const samples = [];
  for (let row = 0; row < CHECK_ROWS; row += 1) {
    for (let column = 0; column < CHECK_COLUMNS; column += 1) {
      samples.push({
        x: (column + 0.5) * world.width / CHECK_COLUMNS,
        y: (row + 0.5) * world.height / CHECK_ROWS,
      });
    }
  }
  return samples;
}

// The tutorial's map check: does this field let the player actually play the
// scenario? Abstract on purpose - it is a plain predicate over the rolled field,
// the same shape every scenario check has (campaign maps pass `null`).
//
// It asks three things:
//   1. the tiger's spot is clear, so the animal does not spawn inside a tree;
//   2. the tiger is reachable from the spawn point, so nothing the tutorial asks
//      the player to drive at is walled off behind a palisade;
//   3. from anywhere the chariot can drive to, there is clear ground for each of
//      the three lines the drill stands - 乱军先锋, the clan's squad and
//      乱军精锐. Every one of them is placed against the player's live position,
//      so that promise has to hold on the whole field and not just at the spawn;
//      the samples below are positions the chariot can actually stand on (the
//      same fill answers that), and a field too cramped to give one of them a home
//      anywhere gets re-rolled.
//
// The three footprints are asked about separately rather than by the widest of
// them: a field that can hold the second band can hold the first, but a field
// that can only hold the first must be refused too - the drill is not re-rollable
// halfway through, and the squad is 8 bodies of script the run cannot do without.
//
// `radius` is the player's body: the flood fill asks the question for the widest
// thing the tutorial asks to be drivable, which is the chariot.
export function createTutorialMapCheck({ world, spawn, circleIntersectsObstacle, radius = 17 }) {
  const tiger = planTigerGround(world, spawn);

  return function tutorialGroundCheck(field) {
    const { obstacles } = field;
    if (circleIntersectsObstacle(tiger.x, tiger.y, TUTORIAL_TIGER_CLEARANCE, obstacles)) {
      return false;
    }
    const walk = buildWalkMap({ from: spawn, goal: tiger, world, obstacles, radius });
    if (!walk.reachable(tiger)) return false;
    for (const sample of checkSamples(world)) {
      // Ground the chariot cannot get to is not a place a line has to fit on.
      if (!walk.reachable(sample)) continue;
      if (!findLineGround(sample, { world, obstacles, radius, walk }).clear) return false;
      if (!findSquadGround(sample, { world, obstacles, radius, walk }).clear) return false;
      if (!findWaveGround(sample, { world, obstacles, radius, walk }).clear) return false;
    }
    return true;
  };
}
