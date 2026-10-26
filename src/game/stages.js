import { battlefields } from "../data/battlefields.js";
import {
  calculateChariotStats, calculateHullHealth, calculateMobilityMultiplier, emptyEquipment,
} from "../data/equipment.js";
import { campaignRules } from "../data/rules.js";
import { translate } from "../i18n/index.js";
import { createRandomSeed, createSeededRandom } from "../utils/random.js";
import { createBattlefield } from "./map.js";
import { CHARIOT_CONTROL_CONFIG } from "./player.js";

// How long a run is: the last stage is drawn from the rule range with one roll of
// whatever stream is handed in. Pure, so the range and the draw can be pinned in
// a test without building a campaign.
export function pickFinalStage(random) {
  return campaignRules.finalStageMin + Math.floor(random() * campaignRules.finalStageSpan);
}

export function createStageManager({
  campaign, state, player, world, view, camera, equipmentShop, seedSource = () => null,
  elements, circleIntersectsObstacle, updateHud, setMode, spawnBoss, spawnBossSquad, announceBoss,
  resizeCanvas, playTone, hideBanner, lockVictory = () => {},
}) {
  const {
    shopGoldElement, shopScoreElement, shopKillsElement,
    shopStageElement, shopLocationElement, shopMessageElement,
  } = elements;

  // A new run starts from nothing; the prologue rolls the name between this and
  // the first battle, so the reset is its own step rather than a flag on
  // beginMission().
  function resetCampaign() {
    campaign.totalGold = 0;
    campaign.stage = 1;
    campaign.finalStage = 0;
    campaign.equipment = emptyEquipment();
    campaign.horseCount = 1;
    campaign.roster = [];
    campaign.nextPersonnelId = 1;
    campaign.identity = null;
    // The battle flags belong to the run too: leaving `finalBattle` set would keep
    // the next prologue claiming to be the last stage, and a stale squad roster
    // would be the HUD's first read on the menu.
    state.finalBattle = false;
    state.bosses = [];
    state.bossDefeated = false;
    state.bossStage = false;
  }

  // How long a run is, drawn from the campaign's stream at the same moment the
  // name is: createBattle() re-seeds the stream below, so a pinned `?seed=` still
  // produces exactly the battle it did before the last stage was rolled, while
  // the length of the campaign itself varies from run to run.
  function rollFinalStage() {
    campaign.finalStage = pickFinalStage(campaign.random);
    return campaign.finalStage;
  }

  // The last stage is decided by the stage number alone: it is a boss stage even
  // when the interval rule would not have made it one.
  function isFinalBattle() {
    return campaign.finalStage > 0 && campaign.stage >= campaign.finalStage;
  }

  function beginMission(isNewRun = false) {
    if (isNewRun) resetCampaign();
    createBattle();
  }

  function createBattle() {
    campaign.random = createSeededRandom(createRandomSeed(seedSource()));
    campaign.battlefieldIndex = Math.floor(campaign.random() * battlefields.length);
    if (battlefields.length > 1 && campaign.battlefieldIndex === campaign.lastBattlefieldIndex) {
      campaign.battlefieldIndex = (campaign.battlefieldIndex + 1 + Math.floor(campaign.random() * (battlefields.length - 1))) % battlefields.length;
    }
    campaign.lastBattlefieldIndex = campaign.battlefieldIndex;
    const definition = battlefields[campaign.battlefieldIndex];
    const battlefield = createBattlefield(
      campaign.random, player, world, circleIntersectsObstacle, definition.mix,
    );
    campaign.obstacles = battlefield.obstacles;
    campaign.terrain = battlefield.terrain;
    campaign.clouds = battlefield.clouds;
    // A stump belongs to the battlefield, not to the campaign: the next battle
    // stands on its own ground, so the felled trees start from none.
    campaign.stumps = [];
    resetMission();
    const finalBattle = isFinalBattle();
    state.finalBattle = finalBattle;
    state.bossStage = finalBattle || (campaign.stage % campaignRules.bossStageInterval === 0
      && campaign.stage >= campaignRules.bossStageMinimum);
    state.bossDefeated = false;
    state.bosses = [];
    state.bossWarningTimer = 0;
    hideBanner();
    state.objectiveTarget = state.bossStage ? 1
      : campaignRules.objectiveBase
        + Math.min(campaign.stage - 1, campaignRules.objectiveStageCap) * campaignRules.objectiveStep;
    state.spawnTimer = 0.8;
    if (finalBattle) spawnBossSquad();
    else if (state.bossStage) spawnBoss();
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
    state.fireHold = 0;
    state.fireHeld = false;
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
      terrain: translate(battlefields[campaign.battlefieldIndex].terrainKey),
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

  // The last battle ends the run instead of opening the shop: the spoils are
  // banked, the champions are announced as beaten, and the campaign locks itself
  // for a while (the lock is written here, not when the card is dismissed, so a
  // tab closed on the victory screen still counts as a victory).
  function enterVictory() {
    if (state.mode !== "running") return;
    for (const drop of state.drops) campaign.totalGold += drop.value;
    state.drops = [];
    state.bullets = [];
    hideBanner();
    lockVictory({
      name: campaign.identity ? campaign.identity.fullName : "",
      stage: campaign.stage,
      score: state.score,
    });
    setMode("victory");
    playTone(660, 0.3, "sine", 0.035);
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

  return {
    beginMission, resetCampaign, resetMission, beginExtraction, enterShop, refreshShop, enterVictory,
    rollForNextBattle, restartStage, rollFinalStage,
  };
}
