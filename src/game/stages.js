import { battlefields } from "../data/battlefields.js";
import {
  calculateChariotStats, calculateHullHealth, calculateMobilityMultiplier, emptyEquipment,
} from "../data/equipment.js";
import { campaignRules } from "../data/rules.js";
import { translate } from "../i18n/index.js";
import { createRandomSeed, createSeededRandom } from "../utils/random.js";
import { createBattlefield } from "./map.js";
import { CHARIOT_CONTROL_CONFIG } from "./player.js";

export function createStageManager({
  campaign, state, player, world, view, camera, equipmentShop, seedSource = () => null,
  elements, circleIntersectsObstacle, updateHud, setMode, spawnBoss, announceBoss,
  resizeCanvas, playTone, hideBanner,
}) {
  const {
    shopGoldElement, shopScoreElement, shopKillsElement,
    shopStageElement, shopLocationElement, shopMessageElement,
  } = elements;

  function beginMission(isNewRun = false) {
    if (isNewRun) {
      campaign.totalGold = 0;
      campaign.stage = 1;
      campaign.equipment = emptyEquipment();
      campaign.horseCount = 1;
      campaign.roster = [];
      campaign.nextPersonnelId = 1;
    }
    createBattle();
  }

  function createBattle() {
    campaign.random = createSeededRandom(createRandomSeed(seedSource()));
    campaign.battlefieldIndex = Math.floor(campaign.random() * battlefields.length);
    if (battlefields.length > 1 && campaign.battlefieldIndex === campaign.lastBattlefieldIndex) {
      campaign.battlefieldIndex = (campaign.battlefieldIndex + 1 + Math.floor(campaign.random() * (battlefields.length - 1))) % battlefields.length;
    }
    campaign.lastBattlefieldIndex = campaign.battlefieldIndex;
    const battlefield = createBattlefield(campaign.random, player, world, circleIntersectsObstacle);
    campaign.obstacles = battlefield.obstacles;
    campaign.terrain = battlefield.terrain;
    campaign.clouds = battlefield.clouds;
    resetMission();
    state.bossStage = campaign.stage % campaignRules.bossStageInterval === 0
      && campaign.stage >= campaignRules.bossStageMinimum;
    state.bossDefeated = false;
    state.boss = null;
    state.bossWarningTimer = 0;
    hideBanner();
    state.objectiveTarget = state.bossStage ? 1
      : campaignRules.objectiveBase
        + Math.min(campaign.stage - 1, campaignRules.objectiveStageCap) * campaignRules.objectiveStep;
    state.spawnTimer = 0.8;
    if (state.bossStage) spawnBoss();
    updateHud();
    setMode("running");
    if (state.bossStage) announceBoss();
    resizeCanvas();
  }

  function resetMission() {
    state.score = 0;
    state.wave = 1;
    state.bullets = [];
    state.groundArrows = [];
    state.enemies = [];
    state.formations = [];
    state.formationsSpawned = 0;
    state.kills = 0;
    state.phase = "combat";
    state.extractionPoint = null;
    state.drops = [];
    state.particles = [];
    state.meleeEffects = [];
    state.bloodStains = [];
    state.spawnTimer = 1.2;
    state.elapsed = 0;
    player.x = world.width / 2;
    player.y = world.height / 2;
    player.radius = 17;
    player.angle = -Math.PI / 2;
    player.speed = 0;
    const stats = calculateChariotStats(campaign.equipment, campaign.horseCount);
    const mobilityMultiplier = calculateMobilityMultiplier(stats);
    player.maxSpeed = CHARIOT_CONTROL_CONFIG.maxSpeed * mobilityMultiplier;
    player.acceleration = CHARIOT_CONTROL_CONFIG.acceleration * mobilityMultiplier;
    player.deceleration = CHARIOT_CONTROL_CONFIG.deceleration * mobilityMultiplier;
    player.maxTurnRate = CHARIOT_CONTROL_CONFIG.maxTurnRate * mobilityMultiplier;
    player.cooldown = 0;
    player.invulnerable = 0;
    player.maxHealth = calculateHullHealth(stats);
    player.health = player.maxHealth;
    player.mode = "chariot";
    player.type = "chariot";
    player.knockbackX = 0;
    player.knockbackY = 0;
    player.impactCooldown = 0;
    player.swarmDamageCooldown = 0;
    state.footCompanions = [];
    state.shake = 0;
    state.damageFlash = 0;
    camera.x = player.x - view.width / 2;
    camera.y = player.y - view.height / 2;
    updateHud();
  }

  function chooseExtractionPoint() {
    const radius = 70;
    const minDistance = 450;
    const isValid = (x, y) => Math.hypot(x - player.x, y - player.y) >= minDistance
      && !circleIntersectsObstacle(x, y, radius + 18);

    for (let attempt = 0; attempt < 240; attempt += 1) {
      const x = 120 + campaign.random() * (world.width - 240);
      const y = 120 + campaign.random() * (world.height - 240);
      if (isValid(x, y)) return { x, y, radius };
    }

    const validPoints = [];
    for (let y = 120; y <= world.height - 120; y += 80) {
      for (let x = 120; x <= world.width - 120; x += 80) {
        if (isValid(x, y)) validPoints.push({ x, y, radius });
      }
    }
    if (validPoints.length === 0) {
      throw new Error("Unable to place an accessible extraction point on this battlefield.");
    }
    return validPoints[Math.floor(campaign.random() * validPoints.length)];
  }

  function beginExtraction() {
    if (state.phase !== "combat") return;
    state.phase = "extract";
    state.extractionPoint = chooseExtractionPoint();
    state.spawnTimer = Infinity;
    updateHud();
    playTone(620, 0.2, "sine", 0.03);
  }

  function refreshShop() {
    shopGoldElement.textContent = String(campaign.totalGold);
    shopScoreElement.textContent = String(state.score);
    shopKillsElement.textContent = String(state.kills);
    shopStageElement.textContent = String(campaign.stage);
    shopLocationElement.textContent = translate("shop.location", {
      battlefield: translate(battlefields[campaign.battlefieldIndex].nameKey),
    });
    shopMessageElement.textContent = translate("shop.message");
    equipmentShop.render();
  }

  function enterShop() {
    if (state.mode !== "running") return;
    for (const drop of state.drops) campaign.totalGold += drop.value;
    state.drops = [];
    state.bullets = [];
    refreshShop();
    setMode("shop");
  }

  function rollForNextBattle() {
    campaign.stage += 1;
    createBattle();
    state.wave = campaign.stage;
    updateHud();
  }

  function restartStage() {
    createBattle();
  }

  return { beginMission, resetMission, beginExtraction, enterShop, refreshShop, rollForNextBattle, restartStage };
}
