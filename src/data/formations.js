export const formationPatterns = [
  {
    nameKey: "formation.charge",
    slots: [
      ["spear", -82, -54], ["ge", -27, -54], ["spear", 27, -54], ["spear", 82, -54],
      ["chariot", -60, 0], ["chariot-archer", 0, 0], ["chariot", 60, 0],
      ["archer", -42, 58], ["slinger", 42, 58],
    ],
  },
  {
    nameKey: "formation.longSpear",
    slots: [
      ["heavy", -90, -48], ["spear", -30, -48], ["heavy", 30, -48], ["spear", 90, -48],
      ["ge", -90, 0], ["spear", -30, 0], ["ge", 30, 0], ["spear", 90, 0],
      ["archer", -45, 58], ["slinger", 45, 58],
    ],
  },
  {
    nameKey: "formation.archerGuard",
    slots: [
      ["spear", -90, -70], ["spear", -30, -70], ["ge", 30, -70], ["spear", 90, -70],
      ["spear", -90, -20], ["ge", -30, -20], ["archer", 30, -20], ["ge", 90, -20],
      ["archer", -60, 48], ["slinger", 0, 48], ["archer", 60, 48],
      ["spear", -60, 96], ["spear", 0, 96], ["ge", 60, 96],
    ],
  },
  {
    nameKey: "formation.square",
    slots: [
      ["spear", -105, -80], ["heavy", -35, -80], ["heavy", 35, -80], ["spear", 105, -80],
      ["ge", -105, -25], ["spear", -35, -25], ["ge", 35, -25], ["spear", 105, -25],
      ["spear", -105, 30], ["ge", -35, 30], ["spear", 35, 30], ["heavy", 105, 30],
      ["archer", -70, 88], ["slinger", 0, 88], ["chariot-archer", 70, 88],
    ],
  },
];

// Scenario lines: a fixed composition laid out by the caller instead of rolled
// from `formationPatterns` above. They are deliberately kept out of that array,
// because the campaign picks its patterns with `(formationsSpawned + wave - 1) %
// formationPatterns.length` - a drill line placed in it would turn up in a real
// battle.
//
// Slots use the same frame as every other pattern: local -Y is the front, so the
// line faces the player it is spawned against, and the ranks read from the front
// (halberdiers) to the back (bows).
//
// `tutorialLine` is the tiger drill's second half: one chariot at the centre, six
// halberdiers in front of it, two archers behind. Ten bodies including the tiger,
// which is exactly the objective count stages.js hands a tutorial battle - the
// extraction opens on the last of them, on the same kill-count rule a campaign
// stage uses.
export const formationPresets = {
  tutorialLine: {
    nameKey: "formation.tutorial",
    slots: [
      ["ge", -90, -30], ["ge", -54, -30], ["ge", -18, -30],
      ["ge", 18, -30], ["ge", 54, -30], ["ge", 90, -30],
      ["chariot", 0, 10],
      ["archer", -45, 70], ["archer", 45, 70],
    ],
  },
};

// Chariot morale, shared by both sides of the field. The enemy roster and the
// hireable line below both import this table, so the hysteresis band, the home
// radius and the regroup pace are defined once - outside either roster.
// A chariot is a property of the machine, not of its flag: the hired one and the
// enemy line's one break off at the same health, regroup over the same band and
// make the same last stand.
export const chariotTactics = {
  // Hysteresis: break off at or below 20% of max health, and only charge again
  // once healed above 40%. Between the two thresholds the chariot stays broken
  // off, including while it sits on its own slot.
  fleeAt: 0.2,
  reengageAt: 0.4,
  // Close enough to the home slot to count as regrouped.
  homeEpsilon: 16,
  // Regrouping is the one time a chariot outruns its row.
  regroupSpeed: 1.15,
};

// What a line has been told to do. Two states are enough because 结阵 is a
// one-shot placement rather than a third mode: it sets the ring down in front of
// the player and hands every body that is not on its new station a `returning`
// flag, so "reforming" is a per-unit walk and not a formation state.
// The table lives here, beside the aura and the hire row, so neither side of the
// field has to import the other's module merely to name a state.
export const formationOrders = {
  HOLD: "hold",
  MARCH: "march",
};

// Formation banners, shared by both sides of the field. The enemy line and the
// hired line read the same table: every living member standing on the dashed
// footprint recovers `heal` health once per `interval`, and `flash` is both the
// banner pulse and the healed unit's glow. Keeping it outside either roster is
// what lets `formations.js` run one aura pass for `state.formations` and
// `state.allyFormations` without knowing whose flag is on the line.
//
// Two rules come from the field rather than from the roster, and both are read
// by `tickFormationAura`: a marching line does not heal (it is moving, not
// holding ground), and neither does a line with an enemy standing inside its
// ring - a banner that has been stepped on has lost the ground that heals.
// The player is a recipient as well as a trespasser, so a friendly ring mends
// him while an enemy ring is dirtied by him merely standing in it.
export const formationAura = {
  interval: 3,
  heal: 3,
  flash: 0.6,
};

// The hireable lines, cheapest first. The shop sells the next rung of this
// ladder (`nextTierFor`), the ally system spawns every bought rung from its own
// row (`tierForIndex`), and the renderer labels the line with the same name - so
// the roster, the banner it points at and the chariot's leash still meet here
// rather than as branches in the battle code. Slots use the enemy pattern frame:
// local -Y is the front, +X runs along the line, and the line faces away from the
// player who hired it.
//
// The ladder is bought in order and nothing lets the player skip a rung: the
// first line is 私家募兵, the second 马砲铁阵, the third 攻坚砲营. A hire count
// that runs past the table falls back to the first rung instead of inventing a
// line (`tierForIndex`), so a hand-edited save still fields something.
export const formationTiers = [
  {
    // Seven halberdiers, a swordsman and three bows: a rank of hooks in front and
    // a shooting line behind it. No vehicle, so this rung is bought for bodies
    // rather than for momentum.
    nameKey: "formation.friendly",
    descriptionKey: "shop.formationDescription.friendly",
    price: 650,
    slots: [
      ["ge", -108, -48], ["ge", -72, -48], ["ge", -36, -48], ["ge", 0, -48],
      ["ge", 36, -48], ["ge", 72, -48], ["ge", 108, -48],
      ["heavy", 0, 2],
      ["archer", -54, 56], ["archer", 0, 56], ["archer", 54, 56],
    ],
  },
  {
    // The first line with vehicles in it: two chariots in the centre, a heavy on
    // each flank, and a mixed shooting rank (one bow, three slings).
    nameKey: "formation.horseCannon",
    descriptionKey: "shop.formationDescription.horseCannon",
    price: 1150,
    slots: [
      ["ge", -96, -56], ["ge", -32, -56], ["ge", 32, -56], ["ge", 96, -56],
      ["heavy", -84, 0], ["heavy", 84, 0],
      ["chariot", -30, 0], ["chariot", 30, 0],
      ["archer", -72, 58], ["slinger", -24, 58], ["slinger", 24, 58], ["slinger", 72, 58],
    ],
  },
  {
    // The siege rung: five heavies to hold the front, four chariot-archers to
    // ride round it, and a captured catapult behind them - the champion's own
    // engine, in the line's colours (see `allyStats` below).
    nameKey: "formation.siege",
    descriptionKey: "shop.formationDescription.siege",
    price: 2550,
    slots: [
      ["heavy", -108, -52], ["heavy", -54, -52], ["heavy", 0, -52],
      ["heavy", 54, -52], ["heavy", 108, -52],
      ["chariot-archer", -60, 18], ["chariot-archer", -20, 18],
      ["chariot-archer", 20, 18], ["chariot-archer", 60, 18],
      ["catapult", 0, 92],
    ],
  },
];

// One row per line for everything a hire has in common: the cap, the paint, the
// leash, the chariot's morale table and the two legs an order opens up. The rung
// itself only carries what differs - its name, its price and its bodies - so a
// fourth line would be a table entry and nothing else.
export const formationRules = {
  maxHires: formationTiers.length,
  // Same green as `spritePalette.allyRobe`; data rows keep their own hex so the
  // simulation never has to import renderer art. `bowRobe` is the one exception
  // the line makes for itself: an archer in a hired rank is tinted so the player
  // can see which bodies are the bows (- 弓手对齐).
  visual: { robe: "#398b63", bowRobe: "#b8543a", deathBurst: "#6f8f55" },
  engage: {
    // How far from its own slot a foot ally will step to meet an enemy, and how
    // far past that slot it may be dragged. A hired line guards its ground; it
    // never charges across the map.
    meleeRange: 150,
    leash: 70,
    homeEpsilon: 10,
  },
  chariot: {
    // Same morale table the enemy chariot reads; the leash below is only the
    // hired line's promise not to chase across the battlefield.
    ...chariotTactics,
    chaseRange: 430,
    chaseLeash: 300,
    ramInterval: 0.5,
  },
  // The same banner the enemy line reads; the aura is a formation property,
  // not something that belongs to the hire.
  aura: formationAura,
  // The two legs 出击 opens up. Marching keeps step with the chariot instead of
  // matching it (0.55x of the unit's own speed), which is what makes the line
  // trail behind a gallop rather than teleport along with it; a body that was
  // left behind when the line was set down runs, because the ground it has to
  // cover was already paid for.
  orders: { marchSpeed: 0.55, returnSpeed: 1.3 },
};

// The rung a hire index (0-based) fields. Past the table it is the first rung:
// a count that outlived the ladder - a save from a build that sold three lines
// differently, a hand-edited campaign - still puts bodies on the field instead of
// throwing on a missing row.
export function tierForIndex(index) {
  const rung = formationTiers[index];
  return rung ?? formationTiers[0];
}

// The rung the shop is selling right now: the one that follows the lines already
// owned. `null` means the ladder is full, which is exactly the shop's cap.
export function nextTierFor(count) {
  return formationTiers[count] ?? null;
}

// How many lines a campaign has, clamped to the ladder. Every caller that reads
// the count - the shop, the spawner, the camp preview - asks this instead of
// trusting the field, so a count from anywhere else cannot field a fourth line.
export function hireCount(campaign) {
  const stored = Math.round(Number(campaign?.friendlyFormations ?? 0));
  if (!Number.isFinite(stored) || stored <= 0) return 0;
  return Math.min(stored, formationRules.maxHires);
}

// The one ally row that is not a repainted enemy: the 攻坚砲营's catapult. It
// carries the champion's numbers from `bossTypes` below - 96 damage a stone, 620
// px of reach, the same lob - because "the boss catapult, but ours" is the whole
// idea. It lives in its own table so the enemy spawner can never field it.
export const allyStats = {
  catapult: {
    health: 55, radius: 36, speed: 34, damage: 96, range: 620,
    ranged: true, projectile: "stone", projectileSpeed: 560, projectileRange: 620,
    fireInterval: 3.1,
    behaviour: "ranged", sightRange: 620, deathBurst: "#6f8f55",
    holdsRank: true,
    // A siege engine does not kite: it stands behind the heavies and lobs.
    kite: { retreat: 240, minFire: 280 },
    visual: { kind: "catapult", scale: 1.08, robe: "#398b63", overlays: [] },
  },
};

// Everything the simulation and the renderer need to know about a unit type
// lives in one row. The columns that used to be `type === "..."` branches:
//
//   behaviour     which brain answers "the target is in sight"
//                 (see src/game/units/behaviours.js)
//   sightRange    how far it can spot a target at all
//   score         points awarded for the kill
//   deathBurst    particle tint of the death burst
//   holdsRank     melee line that defends its spawn slot instead of charging
//   chaseSeconds  how long a holdRank unit pursues once its line is alerted
//                 (its travel in that time is the span it may leave the slot)
//   weapon / attackInterval
//                 what the melee swing draws and how often it lands
//   kite          ranged unit: back off inside `retreat`, only loose a shot
//                 beyond `minFire`
//   vehicle       the player's hull pushes foot units aside, never these
//   visual        renderer descriptor: which silhouette to draw, at what scale,
//                 in what colour, with which weapon/armour overlays
//
// `ranged` is not a brain: it predates one and still means "shoots, and therefore
// does not walk to a remembered sighting" - which is why the catapult (a boss
// that lobs stones and does go looking) deliberately omits it.
export const enemyStats = {
  chariot: {
    health: 14, radius: 21, speed: 75, damage: 20, range: 39,
    behaviour: "cavalry", sightRange: 450, score: 180, deathBurst: "#db9d55",
    holdsRank: false, vehicle: true,
    visual: { kind: "chariot", scale: 1.2, robe: "#b33d32", overlays: [] },
  },
  "chariot-archer": {
    health: 8, radius: 21, speed: 80, damage: 9, range: 490,
    ranged: true, projectile: "arrow", projectileSpeed: 430, projectileRange: 390, fireInterval: 2.3,
    behaviour: "ranged", sightRange: 620, score: 100, deathBurst: "#a74732",
    holdsRank: false, vehicle: true,
    kite: { retreat: 210, minFire: 120 },
    visual: { kind: "chariot", scale: 1.2, robe: "#a65b2c", overlays: ["bow"] },
  },
  spear: {
    health: 2, radius: 12, speed: 61, damage: 13, range: 35,
    behaviour: "infantry", sightRange: 450, score: 100, deathBurst: "#a74732",
    holdsRank: true, chaseSeconds: 1.2, weapon: "sword", attackInterval: 1.15,
    visual: { kind: "foot", scale: 1.3, robe: "#c75a3b", overlays: ["sword"] },
  },
  ge: {
    health: 3, radius: 13, speed: 53, damage: 18, range: 39,
    behaviour: "infantry", sightRange: 450, score: 100, deathBurst: "#a74732",
    holdsRank: true, chaseSeconds: 1.2, weapon: "dagger-axe", attackInterval: 1.4,
    visual: { kind: "foot", scale: 1.3, robe: "#8e4b82", overlays: ["dagger-axe"] },
  },
  heavy: {
    health: 6, radius: 16, speed: 36, damage: 22, range: 27,
    armor: true, collisionDamage: false, collisionResistance: true,
    behaviour: "infantry", sightRange: 450, score: 100, deathBurst: "#a74732",
    holdsRank: true, chaseSeconds: 1.2, weapon: "sword", attackInterval: 1.15,
    visual: { kind: "foot", scale: 1.3, robe: "#566778", overlays: ["plate", "sword"] },
  },
  archer: {
    health: 1, radius: 12, speed: 45, damage: 10, range: 460,
    ranged: true, projectile: "arrow", projectileSpeed: 420, projectileRange: 330, fireInterval: 2.1,
    behaviour: "ranged", sightRange: 620, score: 120, deathBurst: "#a74732",
    holdsRank: true,
    kite: { retreat: 210, minFire: 120 },
    visual: { kind: "foot", scale: 1.3, robe: "#4f8b55", overlays: ["bow"] },
  },
  slinger: {
    health: 3, radius: 13, speed: 47, damage: 14, range: 330,
    ranged: true, projectile: "stone", projectileSpeed: 455, projectileRange: 430, fireInterval: 2.65,
    behaviour: "ranged", sightRange: 620, score: 100, deathBurst: "#a74732",
    holdsRank: true,
    kite: { retreat: 210, minFire: 120 },
    visual: { kind: "foot", scale: 1.3, robe: "#cc8b37", overlays: ["sling"] },
  },
};

// Bosses share the columns of the rank-and-file rows, plus the two that make a
// boss fight read differently: `band` (the [near, far] distances it fights in,
// so the catapult backs off inside 260 instead of standing in the melee) and
// `attack` (how its swing lands, if it swings at all).
export const bossTypes = [
  {
    type: "elephant",
    nameKey: "boss.elephant.name",
    epithetKey: "boss.elephant.epithet",
    health: 204,
    radius: 38,
    speed: 48,
    damage: 42,
    range: 58,
    behaviour: "boss", sightRange: 900, score: 1200, deathBurst: "#d9a34f",
    holdsRank: false,
    band: [0, 58],
    attack: { kind: "melee", interval: 2.2, effect: "stomp" },
    visual: { kind: "elephant", scale: 1.08, robe: "#55493a", overlays: [] },
  },
  {
    type: "lion",
    nameKey: "boss.lion.name",
    epithetKey: "boss.lion.epithet",
    // The boss cousin of the tiger (src/data/wilds.js): same silhouette, a third
    // larger again, and worth a champion's health and score. The wild animal is
    // deliberately the small one - what the drill teaches is that a single cat is
    // a fight, not that it is the fight.
    health: 78,
    radius: 31,
    speed: 85,
    damage: 32,
    range: 52,
    behaviour: "boss", sightRange: 900, score: 1200, deathBurst: "#d9a34f",
    holdsRank: false,
    band: [0, 52],
    attack: { kind: "melee", interval: 1.05, effect: "claw" },
    visual: { kind: "lion", scale: 1.08, robe: "#a85c32", overlays: [] },
  },
  {
    type: "catapult",
    nameKey: "boss.catapult.name",
    epithetKey: "boss.catapult.epithet",
    health: 55,
    radius: 36,
    speed: 34,
    damage: 96,
    range: 620,
    projectile: "stone",
    behaviour: "boss", sightRange: 900, score: 1200, deathBurst: "#d9a34f",
    holdsRank: false,
    band: [260, 420],
    attack: { kind: "shot" },
    visual: { kind: "catapult", scale: 1.08, robe: "#70553a", overlays: [] },
  },
];
