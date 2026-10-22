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

export const enemyStats = {
  chariot: { health: 9, radius: 20, speed: 72, damage: 20, range: 39, color: "#9c392b" },
  "chariot-archer": {
    health: 6, radius: 21, speed: 60, damage: 9, range: 430, color: "#8b512d",
    ranged: true, projectile: "arrow", projectileSpeed: 430, projectileRange: 390, fireInterval: 2.3,
  },
  spear: { health: 1, radius: 12, speed: 61, damage: 13, range: 27, color: "#b35a37" },
  ge: { health: 2, radius: 13, speed: 53, damage: 18, range: 36, color: "#8e5436" },
  heavy: {
    health: 4, radius: 16, speed: 36, damage: 22, range: 38, color: "#54504a",
    armor: true, collisionDamage: false, collisionResistance: true,
  },
  archer: {
    health: 1, radius: 12, speed: 45, damage: 10, range: 360, color: "#68784d",
    ranged: true, projectile: "arrow", projectileSpeed: 420, projectileRange: 330, fireInterval: 2.1,
  },
  slinger: {
    health: 2, radius: 13, speed: 47, damage: 14, range: 480, color: "#78634b",
    ranged: true, projectile: "stone", projectileSpeed: 455, projectileRange: 430, fireInterval: 2.65,
  },
};

export const bossTypes = [
  {
    type: "elephant",
    nameKey: "boss.elephant.name",
    epithetKey: "boss.elephant.epithet",
    health: 44,
    radius: 38,
    speed: 48,
    damage: 42,
    range: 58,
    color: "#55493a",
  },
  {
    type: "lion",
    nameKey: "boss.lion.name",
    epithetKey: "boss.lion.epithet",
    health: 38,
    radius: 31,
    speed: 85,
    damage: 32,
    range: 52,
    color: "#a85c32",
  },
  {
    type: "catapult",
    nameKey: "boss.catapult.name",
    epithetKey: "boss.catapult.epithet",
    health: 25,
    radius: 36,
    speed: 34,
    damage: 96,
    range: 620,
    color: "#70553a",
  },
];
