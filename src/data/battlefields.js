// Each battlefield narrows the element catalog with a `mix`:
//
// - `obstacles` are shares of the same obstacle target in data/elements.js, so
//   every map still lands 46 obstacles; only the wall/tree balance moves.
// - `terrain` entries are patch counts, replacing the catalog's defaults.
//
// A kind a mix leaves out never spawns there, which is how a crossing reads
// flooded and a pass reads fortified without a single code path of its own.
// `terrainKey` is the ground label shown once the battle is won.
export const battlefields = [
  {
    nameKey: "battlefield.sishui.name",
    terrainKey: "terrain.ferry",
    // A river crossing: broad shallows with sandbanks between them, and the few
    // walls that survive are ferry landings rather than palisades.
    mix: {
      obstacles: { wall: 0.35, tree: 0.65 },
      terrain: { shallows: 7, sand: 3 },
    },
  },
  {
    nameKey: "battlefield.handang.name",
    terrainKey: "terrain.hills",
    // Wooded outskirts: canopy everywhere, dry ground underfoot.
    mix: {
      obstacles: { wall: 0.4, tree: 0.6 },
      terrain: { grass: 5, sand: 3 },
    },
  },
  {
    nameKey: "battlefield.hangu.name",
    terrainKey: "terrain.road",
    // A fortified pass: palisades on both sides of a bare, dusty road.
    mix: {
      obstacles: { wall: 0.82, tree: 0.18 },
      terrain: { sand: 4, grass: 2 },
    },
  },
  {
    nameKey: "battlefield.daliang.name",
    terrainKey: "terrain.plains",
    // Open plain: sparse cover, a light mix of grass and dust.
    mix: {
      obstacles: { wall: 0.45, tree: 0.55 },
      terrain: { grass: 6, sand: 2 },
    },
  },
  {
    nameKey: "battlefield.linzi.name",
    terrainKey: "terrain.fields",
    // Worked farmland: the grass is the point, with hedge walls between fields.
    mix: {
      obstacles: { wall: 0.5, tree: 0.5 },
      terrain: { grass: 9, sand: 2 },
    },
  },
  {
    nameKey: "battlefield.yunmeng.name",
    terrainKey: "terrain.marsh",
    // A marsh: standing water and reed beds, and trees crowding the banks.
    mix: {
      obstacles: { wall: 0.25, tree: 0.75 },
      terrain: { shallows: 8, grass: 3 },
    },
  },
];
