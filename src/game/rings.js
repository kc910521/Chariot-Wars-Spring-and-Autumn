import { ringRules, parseRingShares } from "../data/rings.js";

// The 回 pattern, as geometry. src/data/rings.js says how thick each band is as a
// share of the map; this turns that into the numbers a battle can use, and every
// other system (scatter, spawners, the debug overlay) reads the result instead of
// re-deriving it - one table, one derivation, no two places that can disagree.
//
// The single metric is `t`: 0 at the centre, 1 at the world edge, measured on
// whichever axis is further out. Because every band keeps the map's aspect ratio
// it is the only number needed to say which ring a point belongs to, and it is
// the number a debug overlay would print.

// Shares are authored, so their sum is checked against 1 with a little slack:
// 0.2 + 0.45 + 0.2 + 0.15 is 1 in decimal but 0.9999999999999999 in binary.
const SHARE_TOLERANCE = 1e-6;
// Threshold comparisons at a band edge land within a few ulps of the boundary;
// the epsilon keeps a point exactly on the seam in the inner band rather than
// flipping rings with the last bit of a float.
const EDGE_TOLERANCE = 1e-9;

// Cumulative half-spans, inside out, as a fraction of the *whole* span (so the
// last one is always exactly 0.5). Pure, and cheap enough to call per battle.
export function resolveRingHalves(bands = ringRules.bands, innermostSpan = ringRules.innermostSpan) {
  if (!Array.isArray(bands) || bands.length === 0) throw new Error("the ring table has no bands");
  const total = bands.reduce((sum, band) => sum + band.share, 0);
  if (!Number.isFinite(total) || Math.abs(total - 1) > SHARE_TOLERANCE) {
    throw new Error(`the ring shares sum to ${total}, not 1`);
  }
  for (const band of bands) {
    if (!(band.share > 0)) throw new Error(`ring ${band.id} has a share of ${band.share}`);
  }

  const halves = [];
  let cursor = 0;
  if (innermostSpan === "half") {
    // The innermost band is measured from the centre out, so its own share is
    // already its half-span; the bands outside it then divide what is left of the
    // half-span in their own ratio. 20/45/20/15 therefore gives 0.20 / 0.36875 /
    // 0.44375 / 0.5 rather than the 0.10 / 0.325 / 0.425 / 0.5 that reading the
    // 45 literally would give - the outer three keep their ratio to each other,
    // not their width.
    if (!(bands[0].share < 0.5)) {
      throw new Error(`the innermost share ${bands[0].share} leaves no room for the other ${bands.length - 1} bands`);
    }
    cursor = bands[0].share;
    halves.push(cursor);
    const rest = 0.5 - cursor;
    const tail = bands.slice(1).reduce((sum, band) => sum + band.share, 0);
    for (const band of bands.slice(1)) {
      cursor += rest * (band.share / tail);
      halves.push(cursor);
    }
  } else if (innermostSpan === "band") {
    // Every share is a plain thickness, so it only reaches half as far on each
    // side and the table can be read literally.
    for (const band of bands) {
      cursor += band.share / 2;
      halves.push(cursor);
    }
  } else {
    throw new Error(`unknown innermostSpan "${innermostSpan}"; expected "half" or "band"`);
  }

  // The outer band must reach the edge exactly, or a sliver of the map belongs to
  // no ring and a spawner can never place anything there.
  halves[halves.length - 1] = 0.5;
  return halves;
}

// The authored ids with new shares: `?rings=25,25,25,25` keeps the four names, so
// a table that says `B: "high"` still means the second band from the middle. A
// list of the wrong length is refused (null) rather than re-labelled, because a
// bands table and the level tables that address it have to agree on how many
// bands there are.
export function bandsFromShares(shares, bands = ringRules.bands) {
  if (!Array.isArray(shares) || shares.length !== bands.length) return null;
  return bands.map((band, index) => ({ id: band.id, share: shares[index] }));
}

// A boot override, resolved defensively. `?rings=` is a developer switch typed by
// hand, so a table that cannot tile the world falls back to the authored bands
// instead of taking the game down with it: data in the repository is allowed to be
// wrong loudly (see resolveRingHalves), a URL is not.
export function ringLayoutFromShares(world, raw) {
  const bands = bandsFromShares(parseRingShares(raw));
  if (!bands) return createRingLayout(world);
  try {
    return createRingLayout(world, { bands });
  } catch {
    return createRingLayout(world);
  }
}

// An inset is a request to keep clear of the world edge, but a rim thinner than
// the inset would collapse to nothing; clamping to the middle of the band keeps
// the strip placeable, which is what an extraction point needs even when the band
// is narrower than its own radius.
function shrink(outer, inner, inset) {
  if (inset <= 0) return outer;
  if (outer - inset <= inner) return (outer + inner) / 2;
  return outer - inset;
}

// A band's placeable strips, relative to the world's centre. A ring is not a
// rectangle to sample from - that would put half of a thin rim's points in the
// middle of the map - so it is four rectangles: the top and bottom run the full
// outer width, the left and right fill the sides between them.
function bandStrips(ring, insetX, insetY) {
  const outerX = shrink(ring.halfWidth, ring.innerHalfWidth, insetX);
  const outerY = shrink(ring.halfHeight, ring.innerHalfHeight, insetY);
  if (ring.innerHalfWidth <= 0 && ring.innerHalfHeight <= 0) {
    return [{ x: -outerX, y: -outerY, width: outerX * 2, height: outerY * 2 }];
  }
  const height = outerY - ring.innerHalfHeight;
  const width = outerX - ring.innerHalfWidth;
  const strips = [
    { x: -outerX, y: -outerY, width: outerX * 2, height },
    { x: -outerX, y: ring.innerHalfHeight, width: outerX * 2, height },
  ];
  if (ring.innerHalfHeight > 0) {
    strips.push({ x: -outerX, y: -ring.innerHalfHeight, width, height: ring.innerHalfHeight * 2 });
    strips.push({ x: ring.innerHalfWidth, y: -ring.innerHalfHeight, width, height: ring.innerHalfHeight * 2 });
  }
  return strips;
}

export function createRingLayout(world, { bands = ringRules.bands, innermostSpan = ringRules.innermostSpan } = {}) {
  const halves = resolveRingHalves(bands, innermostSpan);
  const centreX = world.width / 2;
  const centreY = world.height / 2;
  const halfWorldWidth = world.width / 2;
  const halfWorldHeight = world.height / 2;

  const rings = bands.map((band, index) => {
    const inner = index > 0 ? halves[index - 1] : 0;
    const half = halves[index];
    const halfWidth = half * world.width;
    const halfHeight = half * world.height;
    const innerHalfWidth = inner * world.width;
    const innerHalfHeight = inner * world.height;
    const area = halfWidth * halfHeight * 4;
    const innerArea = innerHalfWidth * innerHalfHeight * 4;
    return {
      id: band.id,
      index,
      share: band.share,
      // The band's outer size in pixels plus what the band inside it takes out of
      // it: the two numbers a scatter actually needs.
      halfWidth,
      halfHeight,
      innerHalfWidth,
      innerHalfHeight,
      thicknessX: halfWidth - innerHalfWidth,
      thicknessY: halfHeight - innerHalfHeight,
      rect: { x: centreX - halfWidth, y: centreY - halfHeight, width: halfWidth * 2, height: halfHeight * 2 },
      innerRect: { x: centreX - innerHalfWidth, y: centreY - innerHalfHeight, width: innerHalfWidth * 2, height: innerHalfHeight * 2 },
      area,
      innerArea,
      bandArea: area - innerArea,
      // Where `ringAt` stops: the cumulative half-span, expressed as a `t`.
      threshold: half * 2,
      innerThreshold: inner * 2,
    };
  });
  const byId = new Map(rings.map((ring) => [ring.id, ring]));

  function bandOf(id) {
    const ring = byId.get(id);
    if (!ring) throw new Error(`no ring "${id}" in [${rings.map((entry) => entry.id).join(", ")}]`);
    return ring;
  }

  // The one ring test. Cheap on purpose: it runs for every candidate point of
  // every scatter, and two `Math.abs` calls cost nothing next to the nested
  // rectangle checks a naive 回 pattern would need.
  function ringAt(x, y) {
    const t = Math.max(Math.abs(x - centreX) / halfWorldWidth, Math.abs(y - centreY) / halfWorldHeight);
    for (const ring of rings) {
      if (t <= ring.threshold + EDGE_TOLERANCE) return ring.id;
    }
    return rings[rings.length - 1].id;
  }

  // A uniform point inside a band: pick a strip by area, then a point inside it.
  // Exactly three draws whatever the band, so a map's stream does not shift when
  // the ratios do - a `?seed=` run only changes where points land, never how many
  // rolls it takes to place the same elements.
  function samplePoint(id, random, { insetX = 0, insetY = 0 } = {}) {
    const strips = bandStrips(bandOf(id), insetX, insetY);
    const total = strips.reduce((sum, strip) => sum + strip.width * strip.height, 0);
    let roll = random() * total;
    let chosen = strips[strips.length - 1];
    for (const strip of strips) {
      roll -= strip.width * strip.height;
      if (roll < 0) {
        chosen = strip;
        break;
      }
    }
    return { x: centreX + chosen.x + random() * chosen.width, y: centreY + chosen.y + random() * chosen.height };
  }

  // Weighted ring pick over `{ B: 5, A: 3 }`-style tables: what a spawn ladder
  // ("enemies go B, then A, then C") is made of. A ring the table leaves out never
  // comes back, so a caller cannot accidentally spawn a formation on the rim.
  function pickRing(weights, random) {
    const entries = [];
    for (const ring of rings) {
      const weight = weights?.[ring.id];
      if (Number.isFinite(weight) && weight > 0) entries.push({ id: ring.id, weight });
    }
    if (entries.length === 0) return null;
    const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = random() * total;
    for (const entry of entries) {
      roll -= entry.weight;
      if (roll < 0) return entry.id;
    }
    return entries[entries.length - 1].id;
  }

  return { world, centreX, centreY, bands, innermostSpan, halves, rings, bandOf, ringAt, samplePoint, pickRing };
}
