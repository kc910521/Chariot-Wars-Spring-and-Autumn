import { chariotArtRules, chariotRules } from "./rules.js";

export const equipment = [
  {
    id: "weaponRack",
    nameKey: "equipment.weaponRack.name",
    icon: "➶",
    descriptionKey: "equipment.weaponRack.description",
    levels: [
      { price: 200, bonuses: { firepower: 2 }, additionalArrows: 1 },
      { price: 200, bonuses: { firepower: 4 }, penalties: { mobility: 1 }, additionalArrows: 1 },
      { price: 500, bonuses: { firepower: 6 }, penalties: { mobility: 2 }, additionalArrows: 1 },
    ],
  },
  {
    id: "horseArmor",
    nameKey: "equipment.horseArmor.name",
    icon: "⬡",
    descriptionKey: "equipment.horseArmor.description",
    levels: [
      { price: 180, bonuses: { protection: 2 } },
      { price: 180, bonuses: { protection: 4 }, penalties: { mobility: 1 } },
      { price: 450, bonuses: { protection: 6 }, penalties: { mobility: 2 } },
    ],
  },
  {
    id: "shaftWheelRim",
    nameKey: "equipment.shaftWheelRim.name",
    icon: "◉",
    descriptionKey: "equipment.shaftWheelRim.description",
    levels: [
      { price: 150, bonuses: { mobility: 1 }, collisionDamage: 2 },
      { price: 150, bonuses: { mobility: 2 }, penalties: { stability: 1 }, collisionDamage: 2 },
      { price: 400, bonuses: { mobility: 3 }, penalties: { stability: 2 }, collisionDamage: 2 },
    ],
  },
  {
    id: "axleCap",
    nameKey: "equipment.axleCap.name",
    icon: "⊙",
    descriptionKey: "equipment.axleCap.description",
    levels: [
      { price: 180, bonuses: { stability: 2 } },
      { price: 180, bonuses: { stability: 4 }, penalties: { mobility: 1 } },
      { price: 450, bonuses: { stability: 6 }, penalties: { mobility: 2 } },
    ],
  },
  {
    id: "chariotBox",
    nameKey: "equipment.chariotBox.name",
    icon: "▣",
    descriptionKey: "equipment.chariotBox.description",
    levels: [
      { price: 200, bonuses: { capacity: 2 }, extraSlots: 2 },
      { price: 200, bonuses: { capacity: 4 }, penalties: { mobility: 1 }, extraSlots: 4 },
      { price: 500, bonuses: { capacity: 6 }, penalties: { mobility: 2 }, extraSlots: 8 },
    ],
  },
];

export const horses = {
  descriptionKey: "horse.description",
  max: 4,
  levels: [
    { count: 1, mobilityBonus: 0, price: 0 },
    { count: 2, mobilityBonus: 1, price: 300 },
    { count: 3, mobilityBonus: 2, price: 500 },
    { count: 4, mobilityBonus: 3, price: 800 },
  ],
};

// The recruits, one row per body. `projectile` is the only "is this recruit
// ranged" flag: the crew volley, the line-of-sight filter and the dismounted brain
// read it instead of the role name. `footType` is the silhouette the companion
// walks as once the chariot is gone, and the type the smoke trace fingerprints, so
// the two rows that predate it keep the labels they have always had. `overlays` is
// the weapon in his hands - the same list the camp fire seats him with.
export const personnel = [
  {
    id: "archer", nameKey: "personnel.archer.name", descriptionKey: "personnel.archer.description",
    icon: "➶", price: 150, health: 9, damage: 2, range: 400, cooldown: 1.9,
    projectile: "arrow", footType: "archer", overlays: Object.freeze(["bow"]),
  },
  {
    // Three times the bow's reload for twice its damage, on a shot that passes
    // through one extra body: a single bolt is worth less than the arrows it costs
    // to load, a bolt down a rank is worth more. Its reach is shorter than the
    // bow's on purpose - it is a close, flat weapon.
    id: "crossbow", nameKey: "personnel.crossbow.name", descriptionKey: "personnel.crossbow.description",
    icon: "➹", price: 200, health: 11, damage: 4, range: 320, cooldown: 5.7,
    projectile: "bolt", footType: "crossbow", overlays: Object.freeze(["crossbow"]),
  },
  {
    id: "halberdier", nameKey: "personnel.halberdier.name", descriptionKey: "personnel.halberdier.description",
    icon: "⚔", price: 120, health: 13, damage: 5, range: 58, cooldown: 1.5,
    footType: "ge", overlays: Object.freeze(["dagger-axe"]),
  },
];

export const emptyEquipment = () => Object.fromEntries(equipment.map((item) => [item.id, 0]));

export function calculateChariotStats(equipmentLevels, horseCount) {
  const values = { ...chariotRules.baseStats };

  for (const item of equipment) {
    const level = item.levels[equipmentLevels[item.id] - 1];
    if (!level) continue;
    for (const [stat, bonus] of Object.entries(level.bonuses)) values[stat] += bonus;
    for (const [stat, penalty] of Object.entries(level.penalties ?? {})) values[stat] -= penalty;
  }

  values.mobility += horses.levels[horseCount - 1].mobilityBonus;
  for (const stat of Object.keys(values)) {
    values[stat] = Math.max(chariotRules.minimumStat, Math.min(chariotRules.maximumStat, values[stat]));
  }
  return values;
}

// Derived combat values. Keeping the conversions here means HUD previews,
// stage setup, and combat all agree on what a stat point is worth.
export function calculateHullHealth(stats) {
  return stats.stability * chariotRules.hullPerStability;
}

export function calculateMobilityMultiplier(stats) {
  return chariotRules.mobilityMultiplierBase + stats.mobility * chariotRules.mobilityMultiplierPerPoint;
}

export function calculateProtectionChance(stats) {
  return stats.protection * chariotRules.protectionChancePerPoint;
}

export function calculateArrowDamage(equipmentLevels, horseCount) {
  return calculateChariotStats(equipmentLevels, horseCount).firepower * chariotRules.arrowDamagePerFirepower;
}

export function calculateChariotCollisionDamage(equipmentLevels) {
  const shaftAndRim = equipment.find((item) => item.id === "shaftWheelRim");
  return 1 + shaftAndRim.levels
    .slice(0, equipmentLevels.shaftWheelRim)
    .reduce((damage, level) => damage + (level.collisionDamage ?? 0), 0);
}

export function calculateCrewSlots(equipmentLevels) {
  const box = equipment.find((item) => item.id === "chariotBox");
  return 1 + (box.levels[equipmentLevels.chariotBox - 1]?.extraSlots ?? 0);
}

export function getPlayerArrowCount(equipmentLevels) {
  const weaponRack = equipment.find((item) => item.id === "weaponRack");
  return 1 + weaponRack.levels
    .slice(0, equipmentLevels.weaponRack)
    .reduce((count, level) => count + level.additionalArrows, 0);
}

// What the shared chariot art needs to know about the campaign's purchases: the
// crossbows on the deck, how much the hull grew, and how far the axle blades
// reach. Read by the battlefield renderer and by the shop's rig preview, so the
// dossier shows the carriage the next battle will actually drive.
export function calculateChariotKit(equipmentLevels) {
  return {
    // One crossbow rides the stock deck, and the rack grows with the very
    // purchase that adds bolts to a volley - the art can never promise a shot the
    // damage table refuses.
    crossbows: getPlayerArrowCount(equipmentLevels),
    bodyScale: 1 + chariotArtRules.bodyGrowthPerLevel * (equipmentLevels.chariotBox ?? 0),
    bladeLength: chariotArtRules.bladeLengths[equipmentLevels.axleCap ?? 0] ?? 0,
  };
}

// The one purchase that changes a rule instead of a pixel: a maxed axle cap cuts
// a tree down at full speed instead of costing the hull points. The renderer
// draws its blades from the same table, so the promise the art makes is the rule
// that runs.
export function hasMaxedAxleCap(equipmentLevels) {
  const axleCap = equipment.find((item) => item.id === "axleCap");
  return (equipmentLevels.axleCap ?? 0) >= axleCap.levels.length;
}

