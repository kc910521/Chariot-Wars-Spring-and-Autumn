// One row per map element kind. Every `type === "..."` branch that used to live
// in map.js, collision.js and renderer.js is a column here, so adding a kind is
// a row plus (only if the silhouette is genuinely new) one draw function in
// src/render/elements.js.
//
// Instances stay plain data - `{ type, x, y, radius }` for circles,
// `{ type, x, y, width, height }` for axis-aligned rects - and the row is looked
// up by `type` at query time. src/game/elements.js falls back on the instance's
// own fields for an unknown type, so a hand-built obstacle in a test still works.

// Rows are read every frame by the scatter and the renderer, and nothing should
// ever write back into them: freeze once, recursively, so a stray write throws.
function deepFreeze(value) {
  for (const key of Object.keys(value)) {
    if (value[key] && typeof value[key] === "object") deepFreeze(value[key]);
  }
  return Object.freeze(value);
}

export const elementRules = deepFreeze({
  // How many obstacles a field aims for. A tree that would touch another tree is
  // dropped, so the scatter keeps attempting until the target is reached; the cap
  // only exists so a pathological mix cannot spin forever.
  obstacleTarget: 46,
  obstacleAttemptCap: 96,
  // Ground kept clear around the centre, where the player spawns: the chariot
  // needs room to turn before the first formation arrives.
  obstacleSafeRadius: 280,
  terrainSafeRadius: 300,
  // Inset from the world edge. Terrain keeps a wider margin because a patch that
  // straddles the border only ever reads as half a patch.
  edgeMargin: 90,
  terrainEdgeMargin: 110,
  obstacleEdgeMargin: 35,
});

export const obstacleKinds = deepFreeze({
  wall: {
    shape: "rect",
    blocksMovement: true,
    blocksSight: true,
    // Share of the attempt budget. The first row whose cumulative weight covers
    // the roll wins, so the order of this table decides nothing but ties.
    weight: 0.58,
    // Walls deliberately skip the neighbour test: two touching walls read as one
    // longer palisade, while two touching trees read as a clipped canopy.
    rejectExisting: false,
    size: {
      // "axis": one long side and one thin side, laid on whichever axis the roll
      // picks, so the field gets both horizontal and vertical palisades.
      orient: "axis",
      long: [90, 240],
      thin: [28, 46],
    },
    visual: {
      kind: "palisade",
      body: "#74604a",
      shade: "rgba(62, 41, 24, 0.2)",
      rim: "rgba(238, 213, 164, 0.28)",
      seam: "rgba(55, 40, 27, 0.25)",
      shadeOffset: [5, 6],
      rimInset: 5,
      rimHeight: 3,
      // Vertical seams: first at `postInset` in, then every `postGap`, so a long
      // wall reads as a row of posts and a short one still gets a seam.
      postInset: 24,
      postGap: 34,
      corner: 4,
    },
  },
  tree: {
    shape: "circle",
    blocksMovement: true,
    blocksSight: true,
    weight: 0.42,
    rejectExisting: true,
    size: { radius: [22, 40] },
    visual: {
      kind: "canopy",
      trunk: ["#9a7546", "#62452e", "#332a20"],
      canopy: ["#a1ae78", "#728755", "#526d47", "#344934"],
      // Leaf sprinkles alternate through this list by index: light, shadow,
      // mid, deep. Four entries on purpose - `leaf % 4` is the selector.
      leaf: [
        "rgba(208, 201, 139, 0.48)",
        "rgba(38, 62, 42, 0.24)",
        "rgba(137, 157, 97, 0.38)",
        "rgba(76, 107, 63, 0.4)",
      ],
      shadow: "rgba(43, 37, 25, 0.22)",
      canopyEdge: "rgba(43, 61, 39, 0.28)",
      trunkEdge: "rgba(42, 34, 24, 0.55)",
      twig: "rgba(45, 40, 29, 0.58)",
      // Cluster rings come in two tones, picked by cluster index parity: [even, odd].
      clusterRim: ["rgba(183, 188, 118, 0.72)", "rgba(163, 179, 111, 0.78)"],
      clusterBody: ["rgba(83, 119, 70, 0.72)", "rgba(104, 132, 79, 0.66)"],
      clusterFade: "rgba(49, 77, 48, 0)",
      lobes: 14,
      leaves: 24,
      // Cluster rects in units of the radius: [offsetX, offsetY, width, height].
      clusters: [
        [-0.43, -0.26, 0.43, 0.31], [-0.12, -0.48, 0.42, 0.36], [0.29, -0.38, 0.44, 0.32],
        [0.48, -0.02, 0.39, 0.34], [0.13, 0.22, 0.49, 0.35], [-0.34, 0.2, 0.4, 0.33],
      ],
    },
  },
});

export const terrainKinds = deepFreeze({
  // `speed` is what `moveEntitySafely` multiplies movement by, for the player and
  // for every unit alike, so a patch under a formation slows its ranks too.
  shallows: {
    speed: 0.55,
    // Overlapping patches resolve through this: "min" takes the worst ground,
    // "multiply" would compound. Nobody wants ankle-deep mud on top of mud.
    combine: "min",
    placement: { count: 3 },
    size: { radius: [85, 145], aspectX: [0.9, 1.4], aspectY: [0.55, 1.0] },
    visual: {
      kind: "ripples",
      fill: "rgba(91, 135, 129, 0.43)",
      stroke: "rgba(188, 218, 200, 0.38)",
      lineWidth: 2,
      lines: 5,
    },
  },
  sand: {
    speed: 0.7,
    combine: "min",
    placement: { count: 4 },
    size: { radius: [90, 160], aspectX: [0.9, 1.4], aspectY: [0.55, 1.0] },
    visual: {
      kind: "dunes",
      fill: "rgba(190, 153, 92, 0.38)",
      stroke: "rgba(235, 205, 146, 0.36)",
      lineWidth: 2,
      lines: 5,
    },
  },
  grass: {
    speed: 0.92,
    combine: "min",
    placement: { count: 7 },
    size: { radius: [55, 110], aspectX: [0.9, 1.4], aspectY: [0.55, 1.0] },
    visual: {
      kind: "blades",
      fill: "rgba(105, 121, 67, 0.32)",
      stroke: "rgba(189, 198, 128, 0.32)",
      lineWidth: 2,
      blades: 18,
    },
  },
});

export const cloudKinds = deepFreeze({
  // Clouds have a single kind today; the row still owns every number so the
  // scatter and the renderer never disagree about a range.
  sky: {
    count: 16,
    size: { width: [130, 280], height: [55, 107] },
    drift: { speed: [2, 6], axis: "x", wrap: true },
    opacity: [0.14, 0.21],
    visual: {
      kind: "shadow",
      body: "#e0deca",
      rim: "#fff3d4",
      shade: ["rgba(56, 66, 52, 0.72)", "rgba(67, 75, 58, 0.38)", "rgba(77, 80, 62, 0)"],
      bodyAlpha: 0.7,
      rimAlpha: 0.24,
      rimWidthRatio: 0.065,
      rimWidthMin: 2,
      // Slow breathing so the puffs feel alive: base + sin(elapsed * rate + phase) * depth.
      breathe: { base: 0.9, rate: 0.35, depth: 0.1 },
    },
  },
});
