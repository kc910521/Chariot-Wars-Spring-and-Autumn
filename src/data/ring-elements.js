import { deepFreeze } from "../utils/freeze.js";

// Where each kind is allowed to grow, one level per ring. A level is a rank from
// ringRules.levels (high 3 / medium 2 / low 1 / none 0) and only its ratio to the
// other rings of the same kind matters: `tree: { B: "high", C: "low" }` means
// three trees grow in the middle band for every one on the pass band. It is not a
// percentage of anything.
//
// These tables decide *where*, never *how many*. The count is still
// `placement.count` in data/elements.js (or a battlefield's mix), which is what
// keeps a marsh as wet after a reshuffle of these rings as it was before.
//
// A kind with no row here - a new row in elements.js, or a test's own kind - is
// scattered evenly over the field, and a row whose levels are all `none` falls
// back to that too: a table of zeros is a mistake, and a bare battlefield is not
// a useful way to report it.
export const ringElements = deepFreeze({
  // Cover reads best against the middle band, and the centre patch is thin on
  // purpose - ring A is where the chariot turns.
  grass: { A: "low", B: "high", C: "medium", D: "medium" },
  // Dust collects at the edges of a field, where the ground is trampled.
  sand: { A: "low", B: "medium", C: "medium", D: "high" },
  // Water belongs to the outer bands: a marsh reads as banks and channels, and a
  // puddle at the spawn point only ever looks like a bug.
  shallows: { A: "none", B: "low", C: "high", D: "medium" },
  // Canopy backs onto the middle band, with a thinner screen on the rim.
  tree: { A: "low", B: "high", C: "low", D: "medium" },
  // Palisades are the edge of the field: they crowd the rim, thin out through the
  // pass band, and never stand in the clearing the player spawns in.
  wall: { A: "none", B: "low", C: "medium", D: "high" },
});

// How much of a band obstacles may cover before that band stops accepting more,
// as a share of the band's own area. The purpose is narrow: a table that points
// every kind at one band must not be able to turn that band into a solid wall of
// trunks with no way through. At today's budget (46 obstacles over five million
// px2) these caps are nowhere near binding, so they cost nothing and only speak
// up when a ratio has been pushed to its extreme.
export const ringCoverage = deepFreeze({ A: 0.25, B: 0.35, C: 0.3, D: 0.3 });
