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

export const projectileRules = Object.freeze({
  playerVolley: Object.freeze({
    speed: 460, elevation: 0.42, gravity: 420, range: 470, spread: 0.075, originOffset: 29,
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
  // The battlefield floor is painted #929d6d, so dust has to be a light, warm
  // tone to read at all; the old #9b8b72 sat at ~1.15:1 contrast and vanished.
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
  // Fallback fade for particles that do not carry their own `maxLife`.
  particleFadeSeconds: 0.52,
});

export const campaignRules = Object.freeze({
  bossStageInterval: 2,
  bossStageMinimum: 3,
  objectiveBase: 8,
  objectiveStep: 2,
  objectiveStageCap: 4,
  waveScoreStep: 500,
  enemyLimit: 28,
  spawnIntervalMin: 4.2,
  spawnIntervalBase: 7.2,
  spawnIntervalStep: 0.2,
});
