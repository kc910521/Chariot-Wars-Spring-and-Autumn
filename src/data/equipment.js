import { chariotRules } from "./rules.js";

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

export const personnel = [
  { id: "archer", nameKey: "personnel.archer.name", descriptionKey: "personnel.archer.description", icon: "➶", price: 150, health: 3, damage: 1, range: 330, cooldown: 1.9 },
  { id: "halberdier", nameKey: "personnel.halberdier.name", descriptionKey: "personnel.halberdier.description", icon: "⚔", price: 120, health: 6, damage: 2, range: 58, cooldown: 1.5 },
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
