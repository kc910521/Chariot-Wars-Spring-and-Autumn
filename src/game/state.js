import { emptyEquipment } from "../data/equipment.js";
import { createRandomSeed, createSeededRandom } from "../utils/random.js";
import { CHARIOT_CONTROL_CONFIG } from "./player.js";

// `seedSource` is injected by the composition root so the engine never reads the
// launch query itself (that lives in src/platform/): `?seed=42` then pins every
// battle of the session, which makes a run easy to reproduce.
export function createGameState({ seedSource = () => null } = {}) {
  const world = { width: 2800, height: 1800 };
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
    // Replaced with a fresh seeded stream at the start of every battle.
    random: createSeededRandom(createRandomSeed(seedSource())),
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
    lastTime: 0, // Owned by the frame loop (src/game/loop.js) — nothing else may write it.
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
    // Set by damagePlayer(), consumed by the renderer's red vignette.
    damageFlash: 0,
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
