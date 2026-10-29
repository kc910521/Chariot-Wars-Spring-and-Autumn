import { formationPresets } from "../data/formations.js";
import { clamp } from "../utils/math.js";
import { rectHitsAnyObstacle } from "./elements.js";
import { buildWalkMap } from "./reachability.js";
import { formationGroundExtent } from "./units/formations.js";

// The tutorial's battlefield promises, and where its two encounters stand.
//
// The tiger is a pure function of the spawn point: it is on the field from the
// first frame, so "where the chariot starts" is where it has to be reachable
// from. Because it is fixed, the ground under it can be *checked* before the
// battle starts (see createTutorialMapCheck), and a field that fails is rolled
// again by map.js.
//
// The drill line is not. It forms when the tiger dies, and it has to form far
// from wherever the chariot *is at that moment* - a player who chased the animal
// across the field must not be shown a pan back to the map's starting corner. So
// the layout below is a *preference*, not a promise: findLineGround() walks it as
// a ladder of bearings and distances from a live origin and takes the first
// footprint that is clear and that the chariot can drive to.
export const TUTORIAL_LAYOUT = {
  tiger: { distance: 470, bearing: -0.34 },
  line: { distance: 900, bearing: 0.62 },
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

// Bearings tried at each distance, as offsets from the authored 0.62 (down and to
// the right of the chariot): the preferred direction first, then outwards, and
// the far side last. Fixed order and no random numbers - the same battlefield and
// the same standing place always give the same line.
const LINE_BEARING_STEPS = [
  0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4, 1.75, -1.75, Math.PI,
];

// Samples per axis when the map check asks "is there room for the line from
// here?" across the whole walkable field.
const CHECK_COLUMNS = 4;
const CHECK_ROWS = 3;

export function lineGroundExtent() {
  return formationGroundExtent(formationPresets.tutorialLine);
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

// Where the drill line stands, given where the chariot is standing now.
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
export function findLineGround(origin, { world, obstacles = [], radius = 17, walk = null }) {
  const { halfWidth, halfHeight } = lineGroundExtent();
  const map = walk ?? buildWalkMap({ from: origin, world, obstacles, radius });
  let unreachable = null;

  for (const distance of LINE_DISTANCES) {
    for (const step of LINE_BEARING_STEPS) {
      const bearing = TUTORIAL_LAYOUT.line.bearing + step;
      const x = origin.x + Math.cos(bearing) * distance;
      const y = origin.y + Math.sin(bearing) * distance;
      // The line faces the chariot it is about to fight, which is what makes the
      // ranks read as a drill line rather than as a rectangle of soldiers.
      const heading = Math.atan2(origin.y - y, origin.x - x);
      const spot = { x, y, heading };
      if (!footprintFits(world, spot, halfWidth, halfHeight)) continue;
      if (rectHitsAnyObstacle(x, y, halfWidth, halfHeight, heading, obstacles)) continue;
      if (map.reachable(spot)) return { ...spot, clear: true };
      unreachable = unreachable ?? spot;
    }
  }

  if (unreachable) return { ...unreachable, clear: false };
  const distance = LINE_DISTANCES[0];
  const bearing = TUTORIAL_LAYOUT.line.bearing;
  return {
    x: origin.x + Math.cos(bearing) * distance,
    y: origin.y + Math.sin(bearing) * distance,
    heading: bearing + Math.PI,
    clear: false,
  };
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
//   3. from anywhere the chariot can drive to, there is clear ground for the drill
//      line. The line is placed against the player's live position, so that
//      promise has to hold on the whole field and not just at the spawn; the
//      samples below are positions the chariot can actually stand on (the same
//      fill answers that), and a field too cramped to give the line a home
//      anywhere gets re-rolled.
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
      // Ground the chariot cannot get to is not a place the line has to fit on.
      if (!walk.reachable(sample)) continue;
      if (!findLineGround(sample, { world, obstacles, radius, walk }).clear) return false;
    }
    return true;
  };
}
