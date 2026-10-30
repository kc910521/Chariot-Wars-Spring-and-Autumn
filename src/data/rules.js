// Shared balance rules. Gameplay systems read these values instead of
// re-declaring balance literals, so a tuning change stays in one place.
export const chariotRules = Object.freeze({
  baseStats: Object.freeze({ firepower: 3, protection: 3, mobility: 3, stability: 3, capacity: 2 }),
  minimumStat: 1,
  maximumStat: 10,
  hullPerStability: 10,
  mobilityMultiplierBase: 0.5,
  mobilityMultiplierPerPoint: 0.05,
  protectionChancePerPoint: 0.05,
  arrowDamagePerFirepower: 1.5,
});

// Sizes for the player's chassis art. Only the numbers live here: which level
// buys which number is `calculateChariotKit` in data/equipment.js, so the shop
// preview and the battlefield can never disagree about how big a bought box is.
export const chariotArtRules = Object.freeze({
  // The hull grows, the horse team does not: +7.5% a level is 1.075/1.15/1.225,
  // which reads as a boxier carriage without crowding the pole or the wheels.
  bodyGrowthPerLevel: 0.075,
  // Lateral reach of the axle blades past the wheel rim, by axleCap level. Level
  // 0 has none; the max level is also the one that cuts trees down, so the
  // longest blades are on the wheels exactly when the hull stops taking the hit.
  bladeLengths: Object.freeze([0, 3.2, 4.6, 6.2]),
  // A felled tree stops the chariot being damaged, not the chariot: this is the
  // share of full speed a hit needs before the blades bite.
  treeCutSpeedRatio: 0.9,
});

export const projectileRules = Object.freeze({
  playerVolley: Object.freeze({
    speed: 460, elevation: 0.42, gravity: 420, range: 470, spread: 0.075, originOffset: 29,
    // The bow has two releases. Drawing past `holdSeconds` and letting go looses
    // the fixed high arc above, which is the bow's longest shot (~400px from the
    // axle). Anything shorter is a tap that asks the bow to pick a target, so it
    // gets its own reload and a reach that stops short of where the drawn arc
    // comes down — a tap can never outrange a drawn shot.
    holdSeconds: 0.6,
    chargedCooldown: 0.42,
    // `tapConeCosine` is the cosine of the half-angle the nose must clear
    // (0.5 = ±60°), so a target beside or behind the axle is never assisted.
    tapCooldown: 0.34, tapRange: 380, tapConeCosine: 0.5,
  }),
  allyArrow: Object.freeze({
    speed: 420, gravity: 420, spread: 0.055, crewOriginOffset: 25, crewRange: 430, footOriginOffset: 12,
  }),
  enemyShot: Object.freeze({
    arrowSpeed: 420, arrowGravity: 420,
    stoneSpeed: 455, stoneGravity: 430,
    bossStoneSpeed: 560, bossStoneGravity: 430,
    catapultRange: 540, catapultCooldown: 3.1,
    cooldownBase: 2.1, cooldownJitter: 0.7,
  }),
});

export const effectRules = Object.freeze({
  // The battlefield floor is painted `groundVisual.base` (src/data/elements.js),
  // a dry olive, so dust has to be a light, warm tone to read at all; the old
  // #9b8b72 sat at ~1.15:1 contrast against that floor and vanished.
  dust: Object.freeze({
    colors: Object.freeze(["#e6dcc4", "#cdbfa1", "#ab9877"]),
    count: 14,
    sizeMin: 3,
    sizeMax: 6,
    lifeMin: 0.45,
    lifeMax: 0.8,
    spread: 72,
    riseMin: 26,
    riseMax: 70,
    ring: Object.freeze({ color: "#d8cbb0", radius: 5, growth: 30, life: 0.34 }),
  }),
  // Ground dust for anything that is actually travelling. Same warm palette as
  // `dust` (the floor is a dry olive, see `groundVisual` in data/elements.js, so
  // anything cooler vanishes), opposite numbers:
  // many soft, low-alpha puffs that bloom as they fade, instead of one hot
  // scatter that is over in half a second. Every entry scales with the unit's
  // current speed between `minSpeed` and `fullSpeed` (the mounted chariot).
  trail: Object.freeze({
    colors: Object.freeze(["#e6dcc4", "#cdbfa1", "#d8cbb0"]),
    minSpeed: 18, // px/s; anything slower reads as standing still
    fullSpeed: 170,
    sizeMin: 2, sizeMax: 7, // radius at birth
    growthMin: 8, growthMax: 24, // how far a puff blooms - the span of the plume
    lifeMin: 0.28, lifeMax: 0.7,
    rateMin: 4, rateMax: 18, // puffs per second
    driftMin: 0.12, driftMax: 0.3, // share of the unit's speed carried backwards
    riseMin: 6, riseMax: 20,
    alpha: 0.3, // fog: translucent where the impact motes stay opaque
    maxStep: 200, // px in one frame: a teleport (spawn, respawn, dismount), not a stride
    maxLive: 160, // hard cap, so a full formation cannot flood the particle list
    cullMargin: 220, // an off-screen unit is not worth the churn - and it must not
    // spend a visible unit's share of `maxLive`.
  }),
  // A tree that cost the hull points shakes once: one decaying wobble, not a
  // permanent tremble. The duration is short enough to read as an impact and long
  // enough to survive a 30fps frame or two; the painter adds it to the ambient
  // sway, so the settle is a lean back to rest rather than a snap.
  treeHit: Object.freeze({ duration: 0.45, rate: 26, angle: 0.16 }),
  // Fallback fade for particles that do not carry their own `maxLife`.
  particleFadeSeconds: 0.90,
});

export const campaignRules = Object.freeze({
  bossStageInterval: 2,
  bossStageMinimum: 3,
  objectiveBase: 8,
  objectiveStep: 2,
  objectiveStageCap: 4,
  // The stage whose champion pays out the clan's gift: one free rung of the hire
  // ladder (src/game/equipment.js grantFormation). It sits past the first boss
  // stage so the player has met the ladder in the shop before being handed a rung.
  clanGrantStage: 4,
  waveScoreStep: 500,
  enemyLimit: 28,
  spawnIntervalMin: 4.2,
  spawnIntervalBase: 7.2,
  spawnIntervalStep: 0.2,
  // The campaign ends in a last stage drawn from this range, and that stage is
  // never one of the numbered boss stages: it is the last battle of the run.
  finalStageMin: 3,
  finalStageSpan: 4,
  // The last stage opens with a fixed squad instead of one rolled champion — two
  // elephants (204 HP each), two lions (78) and four catapults (55), 784 HP
  // together on this build's champion table. The cap has to sit above the squad
  // or the ordinary waves would stop arriving behind it (the squad alone is 8
  // bodies, and a formation is up to 6 more).
  finalSquad: Object.freeze([
    "elephant", "elephant", "lion", "lion", "catapult", "catapult", "catapult", "catapult",
  ]),
  finalStageEnemyLimit: 52,
});
