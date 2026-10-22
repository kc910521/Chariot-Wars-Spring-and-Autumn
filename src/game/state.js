import { emptyEquipment } from "../data/equipment.js";
import { CHARIOT_CONTROL_CONFIG } from "./player.js";

export function createGameState() {
  const world = { width: 2400, height: 1600 };
  const view = { width: 960, height: 592 };
  const camera = { x: 0, y: 0 };
  const player = {
    x: world.width / 2,
    y: world.height / 2,
    radius: 17,
    angle: -Math.PI / 2,
    speed: 0,
    maxSpeed: CHARIOT_CONTROL_CONFIG.maxSpeed,
    acceleration: CHARIOT_CONTROL_CONFIG.acceleration,
    deceleration: CHARIOT_CONTROL_CONFIG.deceleration,
    maxTurnRate: CHARIOT_CONTROL_CONFIG.maxTurnRate,
    cooldown: 0,
    invulnerable: 0,
    health: 100,
    knockbackX: 0,
    knockbackY: 0,
    impactCooldown: 0,
    swarmDamageCooldown: 0,
    mode: "chariot",
    maxHealth: 100,
  };
  const campaign = {
    obstacles: [],
    terrain: [],
    clouds: [],
    random: Math.random,
    battlefieldIndex: 0,
    lastBattlefieldIndex: -1,
    stage: 1,
    totalGold: 0,
    equipment: emptyEquipment(),
    horseCount: 1,
    roster: [],
    nextPersonnelId: 1,
  };
  const state = {
    mode: "menu",
    score: 0,
    wave: 1,
    bullets: [],
    groundArrows: [],
    enemies: [],
    particles: [],
    meleeEffects: [],
    bloodStains: [],
    spawnTimer: 0,
    lastTime: 0,
    sound: true,
    elapsed: 0,
    formations: [],
    formationsSpawned: 0,
    shake: 0,
    kills: 0,
    objectiveTarget: 8,
    phase: "combat",
    extractionPoint: null,
    bossStage: false,
    boss: null,
    bossDefeated: false,
    bossWarningTimer: 0,
    drops: [],
    footCompanions: [],
  };

  return {
    world,
    view,
    camera,
    player,
    campaign,
    state,
    keys: new Set(),
    touchInput: { x: 0, y: 0 },
  };
}
