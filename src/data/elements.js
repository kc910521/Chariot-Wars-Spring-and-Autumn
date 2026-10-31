import { deepFreeze } from "../utils/freeze.js";

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
// ever write back into them: see deepFreeze.
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

// The battlefield floor: dry soil that still carries a little short grass, under
// everything else on the map. It lives here rather than in the painter so the
// tone can be retuned without touching a draw call, and every colour is
// deliberately low-contrast - the floor must never compete with a silhouette, a
// terrain patch or a health bar.
//
// `base` is the flat wash the viewport starts as. The washes, flecks and grit are
// hashed onto a world-space lattice (see src/render/ground.js): that is what gives
// the ground its texture without tiling, without swimming under the camera and
// without a single grid line.
export const groundVisual = deepFreeze({
  // A dry olive with the green knocked back: a field that has been fought over,
  // not a lawn. Everything else in this table is a slight variation on it.
  base: "#8c8f68",
  // Soft blobs of turned soil, shade and bleached dust - the "mixing soil with a
  // little grass and shadow" part. `core` feathers into `edge`, which is the same
  // colour at zero alpha, so a blob has no rim to read.
  wash: {
    // One blob per lattice cell of this size, jittered inside the cell. The
    // lattice is anchored to the world, so the ground slides past the camera.
    // Small enough to read as texture: a handful of very large blobs would haze
    // the field instead of mottling it - and every blob is a full-screen-sized
    // alpha fill, so its radius is a frame-cost decision as much as a look.
    spacing: 300,
    radius: [110, 220],
    tones: [
      { core: "rgba(96, 88, 60, 0.12)", edge: "rgba(96, 88, 60, 0)" }, // turned soil
      { core: "rgba(58, 62, 43, 0.1)", edge: "rgba(58, 62, 43, 0)" }, // shade
      { core: "rgba(182, 178, 136, 0.09)", edge: "rgba(182, 178, 136, 0)" }, // bleached dust
    ],
  },
  // What grass survived: a sparse tuft of a few-pixel blades per cell that rolled
  // one, and grit where nothing grows at all. Kept thin on purpose - a patch
  // (`terrainKinds.grass`) is where the tall stuff lives.
  fleck: {
    spacing: 104,
    chance: 0.55,
    // Two to three blades per tuft, drawn as one path: the floor is a background,
    // so the whole field has to stay inside a few hundred canvas calls a frame.
    blades: [2, 3],
    height: [4, 11],
    lean: 0.6,
    width: 1,
    colors: ["rgba(101, 116, 66, 0.34)", "rgba(85, 100, 57, 0.3)"],
  },
  grit: {
    // The high-frequency half of the texture: flat specks, dark soil and bleached
    // sand. At one to three pixels a rim is invisible and a rect is the cheapest
    // thing a canvas draws, so the floor can afford a lot of them.
    chance: 0.34,
    size: [1, 3],
    colors: ["rgba(62, 58, 40, 0.16)", "rgba(186, 180, 138, 0.14)"],
  },
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
    // A trunk stops an axle; a crown sits above the sight line. So a stand of
    // trees is something to drive around rather than a blind: nothing that asks
    // this column (the LOS walk, and through it archers and the aim assist) file
    // a tree at all. Arrows still meet the trunk - ballistics test the movement
    // column, not this one - so "you can see him, the bolt may still hit a tree"
    // is deliberate, not an oversight.
    blocksSight: false,
    // A maxed axle cap cuts this row down instead of shaking it: see
    // hasMaxedAxleCap() and fellTree().
    fellable: true,
    weight: 0.42,
    rejectExisting: true,
    size: { radius: [22, 40] },
    // Dalbergia hupeana (黄檀): a light, open crown of pinnate leaf sprays on a
    // slim forked trunk, not a solid canopy ball - a stand of these still reads as
    // trees at this pixel size without painting one flat green mass.
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
      twig: "rgba(45, 40, 29, 0.58)",
      trunkEdge: "rgba(42, 34, 24, 0.55)",
      // Pinnate sprays: each anchor in `clusters` grows one stem with `leaflets`
      // leaflets, sized as a share of the crown radius.
      leaflets: 6,
      leafletScale: 0.075,
      // Ambient sway, in radians at the crown, and its rate. A tree that never
      // moves reads as a backdrop decal; this is just enough to keep it alive.
      sway: 0.045,
      swayRate: 1.15,
      // Spray anchors in units of the radius: [offsetX, offsetY, stemLength].
      clusters: [
        [-0.43, -0.26, 0.43], [-0.12, -0.48, 0.42], [0.29, -0.38, 0.44],
        [0.48, -0.02, 0.39], [0.13, 0.22, 0.49], [-0.34, 0.2, 0.4],
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
      // `fill` is the middle of the patch and `fade` its transparent twin: the
      // painter feathers one into the other, so a patch is ground that changes
      // under the wheels instead of a decal lying on top of it.
      fill: "rgba(91, 135, 129, 0.43)",
      fade: "rgba(91, 135, 129, 0)",
      stroke: "rgba(188, 218, 200, 0.3)",
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
      fade: "rgba(190, 153, 92, 0)",
      stroke: "rgba(220, 196, 148, 0.26)",
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
      // The floor already carries a little short grass (see groundVisual), so a
      // patch is the tall stuff: a bed of blades standing out of the tint, with a
      // few weed stalks and their seed heads above them.
      kind: "weeds",
      // A shade greener and a touch deeper than the floor: dark blades need a bed
      // to stand in, or they read as scratches on bare soil.
      fill: "rgba(92, 110, 58, 0.4)",
      fade: "rgba(92, 110, 58, 0)",
      // The weed stems: a mid green, a shade lighter than the blades, so the
      // taller stalks read as separate plants and not as thicker grass.
      stroke: "rgba(126, 140, 82, 0.45)",
      lineWidth: 2,
      blades: 22,
      weeds: 5,
      // Shares of the patch radius, so a bigger patch is taller rather than
      // sparser, and every patch has the same density of stems.
      height: [0.3, 0.55],
      weedHeight: [0.5, 0.78],
      lean: 0.35,
      blade: ["rgba(70, 85, 47, 0.44)", "rgba(88, 102, 60, 0.38)"],
      seed: "rgba(103, 109, 66, 0.42)",
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
