// The battlefield is four concentric rectangular bands - A in the middle, D at
// the rim - and this table is the only place their size is written down.
//
// Every number here is a *share of the map's span*, never a pixel: the world is
// 2800x1800 today and the same table has to survive the day that changes, so
// src/game/rings.js derives the pixel geometry from it on every battle and the
// scatter (and, as they arrive, the spawners and a debug overlay) all read that
// one derivation.
//
// The ratios are the thing a designer is meant to touch, and they are safe to
// touch at any time: a table that cannot tile the world is refused loudly (see
// resolveRingHalves) instead of quietly producing a map with a hole in it, and
// `?rings=20,45,20,15` overrides the shares for a single boot without an edit
// (see parseRingShares) - the shape of a map is not something to guess at from
// a comment.

// The shares describe the *bands*, not the rectangles around them: A is the
// innermost band, and 20/45/20/15 says the three outer bands share the rest of
// the map in their own 45:20:15 ratio once A has taken its slice. Which is why
// `innermostSpan` exists - the two readings of "A's share" differ by a factor of
// two, and the difference is 560px of middle.
export const ringRules = Object.freeze({
  bands: Object.freeze([
    Object.freeze({ id: "A", share: 0.2 }),
    Object.freeze({ id: "B", share: 0.45 }),
    Object.freeze({ id: "C", share: 0.2 }),
    Object.freeze({ id: "D", share: 0.15 }),
  ]),
  // "half" - the innermost share is a half-span, so 0.20 means a fifth of the
  //          map's width on each side of the centre (A is 1120x720 at
  //          2800x1800). The outer bands then fill the remaining half-span.
  // "band" - every share is a plain thickness, so 0.20 is a tenth on each side
  //          (A is 560x360) and 45/20/15 are taken literally.
  innermostSpan: "half",
  // What "probability" means where a ring table names a level (the per-ring
  // element tables read this). These are weights, not percentages: only the
  // ratios matter, so 3/2/1 and 0.6/0.4/0.2 describe the same table. `none` has
  // to stay 0 - it is how a ring says "this kind never grows here", and it is
  // what an unnamed kind falls back to.
  levels: Object.freeze({ high: 3, medium: 2, low: 1, none: 0 }),
});

// `?rings=20,45,20,15` in the browser, `query.rings` in the mini game: shares or
// null. Any positive scale is accepted - "2,5,4,3" and "200,450,200,150" are the
// same table - because the string is normalised to sum to 1 here, and the layout
// refuses whatever is left over rather than a designer having to do arithmetic.
export function parseRingShares(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const parts = raw.split(",").map((part) => Number.parseFloat(part.trim()));
  if (parts.length !== 4) return null;
  if (parts.some((share) => !Number.isFinite(share) || share <= 0)) return null;
  const total = parts.reduce((sum, share) => sum + share, 0);
  return parts.map((share) => share / total);
}
