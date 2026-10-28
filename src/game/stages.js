import { battlefields } from "../data/battlefields.js";
import {
  calculateChariotStats, calculateHullHealth, calculateMobilityMultiplier, emptyEquipment,
} from "../data/equipment.js";
import { formationPresets } from "../data/formations.js";
import { campaignRules } from "../data/rules.js";
import { translate } from "../i18n/index.js";
import { createRandomSeed, createSeededRandom } from "../utils/random.js";
import { createBattlefield } from "./map.js";
import { CHARIOT_CONTROL_CONFIG } from "./player.js";
import { ringLayoutFromShares } from "./rings.js";
import { createTutorialMapCheck } from "./tutorial-map.js";

// How long a run is: the last stage is drawn from the rule range with one roll of
// whatever stream is handed in. Pure, so the range and the draw can be pinned in
// a test without building a campaign.
export function pickFinalStage(random) {
  return campaignRules.finalStageMin + Math.floor(random() * campaignRules.finalStageSpan);
}

export function createStageManager({
  campaign, state, player, world, view, camera, equipmentShop, seedSource = () => null,
  elements, circleIntersectsObstacle, updateHud, setMode, spawnBoss, spawnBossSquad, announceBoss,
  spawnFriendlyAllies = () => [], resizeCanvas, playTone, hideBanner, lockVictory = () => {},
  ringSource = () => null,
}) {
  // The 回 ratios for the whole run: the authored table in src/data/rings.js,
  // unless the host handed in a `?rings=20,45,20,15`-style override. Read once -
  // the ground does not change shape between the stage's battles - and the layout
  // itself is per world, so every battle of a run refines the same bands. An
  // unusable override falls back to the authored table instead of failing to boot.
  const ringLayout = ringLayoutFromShares(world, ringSource());
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
    // Hired formations belong to the run: a new run starts without them, while
    // retrying a stage or marching to the next one keeps the count.
    campaign.friendlyFormations = 0;
    campaign.identity = null;
    // Both wallets of a battle reset with the run: the tutorial's handoff belongs
    // to the stage-1 drill, and the entry purse is re-snapshotted by createBattle.
    campaign.entryGold = 0;
    campaign.tutorialHandoff = false;
    state.battleMode = "campaign";
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
    // The campaign's door is the campaign: a tutorial handoff never survives a
    // deliberate "set out".
    state.battleMode = "campaign";
    createBattle();
  }

  // The prologue's second door: the tiger drill. It is stage 1 of the run - the
  // campaign has already been reset and named - played as a scenario instead of
  // as a campaign battle, and it hands the shop into stage 1 rather than into
  // stage 2 (see rollForNextBattle).
  function beginTutorial() {
    state.battleMode = "tutorial";
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
    const tutorial = state.battleMode === "tutorial";
    // The map check, per scenario: the campaign has nothing to promise about its
    // ground and passes none (so its roll stays a single draw from the seed, byte
    // for byte what it always was), while the tutorial hands in the check that
    // keeps the tiger reachable from the spawn point and leaves the drill line
    // somewhere to stand from anywhere the chariot can get to. A field that fails
    // it is rolled again - see createBattlefield.
    const groundCheck = tutorial
      ? createTutorialMapCheck({
        world,
        spawn: { x: world.width / 2, y: world.height / 2 },
        circleIntersectsObstacle,
      })
      : null;
    const battlefield = createBattlefield(
      campaign.random, player, world, circleIntersectsObstacle, definition.mix, groundCheck, ringLayout,
    );
    campaign.obstacles = battlefield.obstacles;
    campaign.terrain = battlefield.terrain;
    campaign.clouds = battlefield.clouds;
    // A stump belongs to the battlefield, not to the campaign: the next battle
    // stands on its own ground, so the felled trees start from none.
    campaign.stumps = [];
    // The purse this battle is entered with. A retry rolls the battle's takings
    // back to it (see restartStage), so dying with a pocketful of coin costs the
    // coin picked up on that field - never the savings of the run.
    campaign.entryGold = campaign.totalGold;
    resetMission();
    // A new battle. Scenario code (src/game/tutorial.js) arms itself on entry into
    // "running", and this is what tells it the field is new rather than the same
    // one being re-entered after a pause.
    state.battleId += 1;
    const finalBattle = isFinalBattle();
    // A drill is neither the last battle nor a boss stage, whatever the stage
    // number says: the tutorial has its own opening and its own two encounters.
    state.finalBattle = finalBattle && !tutorial;
    state.bossStage = !tutorial && (finalBattle || (campaign.stage % campaignRules.bossStageInterval === 0
      && campaign.stage >= campaignRules.bossStageMinimum));
    state.bossDefeated = false;
    state.bosses = [];
    state.bossWarningTimer = 0;
    hideBanner();
    state.objectiveTarget = tutorial
      // The tiger, and then the line it was guarding. The same kill-count rule a
      // campaign stage uses, so the extraction opens on the last body of the line.
      ? formationPresets.tutorialLine.slots.length + 1
      : state.bossStage ? 1
        : campaignRules.objectiveBase
          + Math.min(campaign.stage - 1, campaignRules.objectiveStageCap) * campaignRules.objectiveStep;
    // A drill rolls no waves: its two encounters are the tutorial's own
    // (src/game/tutorial.js), so the spawn clock never comes due.
    state.spawnTimer = tutorial ? Infinity : 0.8;
    // The hired lines are placed after the player has been returned to the
    // middle of the new map, and they draw no random numbers - spawning them
    // cannot shift the enemy placement on a seeded battlefield.
    spawnFriendlyAllies();
    if (!tutorial && finalBattle) spawnBossSquad();
    else if (!tutorial && state.bossStage) spawnBoss();
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
    // Wild animals live in `state.enemies` as well as in their own roster; both
    // start empty, and a scenario refills them after the field exists.
    state.wilds = [];
    // A new field starts with no scenario script and no camera override: the
    // tutorial (re)arms itself once the battle is entered.
    state.tutorial = null;
    state.cameraFocus = null;
    state.formations = [];
    state.formationsSpawned = 0;
    // createBattle() refills these from the campaign's hire count; clearing here
    // also covers a caller that resets a mission in place.
    state.allyFormations = [];
    state.allies = [];
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
    // The tutorial is stage 1 of the run dressed as a drill: the shop it opens
    // leads into the real first battle, not into stage 2.
    if (campaign.tutorialHandoff) {
      campaign.tutorialHandoff = false;
      state.battleMode = "campaign";
    } else {
      campaign.stage += 1;
    }
    createBattle();
    state.wave = campaign.stage;
    updateHud();
  }

  // A retry rewinds the battle, not the run: the takings of the field that was
  // just lost go back to the purse the battle was entered with (the defeat card
  // already rewound them - this is the same, idempotent, for any other route into
  // a retry), and a retried drill stops claiming the handoff it never earned.
  function restartStage() {
    campaign.totalGold = campaign.entryGold;
    if (state.battleMode === "tutorial") campaign.tutorialHandoff = false;
    createBattle();
  }

  return {
    beginMission, beginTutorial, resetCampaign, resetMission, beginExtraction, enterShop, refreshShop,
    enterVictory, rollForNextBattle, restartStage, rollFinalStage,
  };
}
