import { soundBorrowed, soundCues } from "./sounds.js";

// One row per thing that flies. Everything a shot needs to know about itself and
// everything the field needs to paint it hangs off that row: the numbers it leaves
// with, how many bodies it can pass through, which impact effect it raises, which
// decal it leaves in the ground, the four cues it uses (release, body, ground,
// obstacle) and the painter that draws it.
//
// `game/projectiles.js` and `render/projectiles.js` look the row up instead of
// comparing a `kind` string, so a new shot is one entry here plus (if it needs new
// art) one painter. A unit test keeps those two lists honest.
const kind = (id, row) => Object.freeze({ id, ...row });

export const projectileKinds = Object.freeze({
  arrow: kind("arrow", {
    speed: 420, gravity: 420, radius: 3,
    // Bodies this shot passes through after the one it hits: an arrow stops on the
    // first, a bolt carries on into exactly one more.
    pierce: 0,
    // Names resolved by `projectileImpactEffects` (src/game/projectiles.js) and by
    // the projectile painter (src/render/projectiles.js).
    impact: "puff", bodyImpact: null, decal: "arrow", visual: "arrow",
    cue: Object.freeze({
      release: soundCues.archerShoot,
      body: soundCues.arrowHit,
      ground: soundCues.arrowGround,
      obstacle: soundCues.arrowHit,
    }),
  }),
  // The crossbow bolt: the same ballistic solver, released fast enough that the arc
  // flattens on its own. At 320px a bow has to lift 24.8 degrees and hangs 37px over
  // the line for 0.84s; the bolt lifts 6.7 degrees, hangs 9.5px and is there in
  // 0.42s. That is a lower, faster shot without a second trajectory model.
  bolt: kind("bolt", {
    speed: 760, gravity: 420, radius: 3,
    // One extra body: through the first, into the second, down.
    pierce: 1,
    impact: "puff", bodyImpact: null, decal: "bolt", visual: "bolt",
    cue: Object.freeze({
      release: soundBorrowed.crossbowShoot,
      body: soundCues.arrowHit,
      ground: soundCues.arrowGround,
      obstacle: soundCues.arrowHit,
    }),
  }),
  stone: kind("stone", {
    speed: 455, gravity: 430, radius: 6, pierce: 0,
    // A stone kicks up dust wherever it stops, body included, and leaves nothing
    // stuck in the grass.
    impact: "dust", bodyImpact: "dust", decal: null, visual: "stone",
    cue: Object.freeze({
      release: soundCues.catapultShoot,
      body: soundBorrowed.stoneBodyHit,
      ground: soundCues.stoneGround,
      obstacle: soundCues.stoneGround,
    }),
  }),
});

// A bullet from an older shape has no `kind`, and a kind nobody has drawn yet is
// not a reason to stop the battle: both fall back to the arrow.
export const resolveProjectileKind = (id) => projectileKinds[id] ?? projectileKinds.arrow;
