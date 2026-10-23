import { bossTypes, enemyStats, formationPatterns } from "../data/formations.js";
import { calculateChariotCollisionDamage } from "../data/equipment.js";
import { campaignRules } from "../data/rules.js";
import { createAudio } from "../assets/audio.js";
import { launchQuery } from "../platform/launch.js";
import { createEquipmentShop } from "./equipment.js";
import { createEnemies } from "./units/enemies.js";
import { createPlayerController } from "./player.js";
import { createGameState } from "./state.js";
import { createCollisionSystem } from "./collision.js";
import { createCombatSystem } from "./combat.js";
import { createProjectileSystem } from "./projectiles.js";
import { startGameLoop } from "./loop.js";
import { updateCamera } from "../render/camera.js";
import { createRenderer } from "../render/renderer.js";
import { createHud } from "../ui/hud.js";
import { bindControls } from "../ui/controls.js";
import { createScreens } from "../ui/screens.js";
import { createStageManager } from "./stages.js";
import { getGameElements } from "../ui/elements.js";
import { applyTranslations, getLocale, setLocale, translate } from "../i18n/index.js";
import { distanceBetween } from "../utils/math.js";

// The combat <-> enemy <-> projectile triangle is mutually recursive by nature.
// Instead of relying on function hoisting, each edge is an explicit late-bound
// invoker that fails loudly if it is used before its system exists.
function defer(getTarget, method) {
  return (...args) => {
    const target = getTarget();
    if (!target) throw new Error(`"${method}" was called before its system was initialised.`);
    return target[method](...args);
  };
}

// Works without the game elements, so it can also report boot failures.
function reportFatalError(error, phase = "startup") {
  console.error(`[chariot-wars] ${phase} failed`, error);
  const banner = document.getElementById("fatal-error");
  if (!banner) return;
  const copy = document.getElementById("fatal-error-copy");
  if (copy) copy.textContent = `${phase}: ${error?.message ?? error}`;
  banner.hidden = false;
}

function boot() {
  const elements = getGameElements();
  applyTranslations();
  elements.localeSelect.value = getLocale();
  const {
    canvas, menuScreen, battleScreen, shopScreen, menuStartButton, nextBattleButton,
    shopItemsElement, shopStatsElement, shopGoldElement, shopScoreElement, shopKillsElement,
    shopStageElement, shopLocationElement, shopMessageElement, scoreElement,
    waveElement, goldElement, modeElement, hullLabelElement, hullValueElement, hullHealthElement,
    overlay, overlayEyebrow, overlayTitle, overlayCopy, overlayButton, startButton,
    startLabel, objectiveCountElement, objectiveProgressElement, objectiveLabelElement,
    extractionGuideElement, extractionArrowElement, extractionDistanceElement,
    touchPadElement, touchHintElement, touchControlsElement,
    touchJoystickElement, touchJoystickKnob,
    bossWarningElement, bossWarningTitleElement, bossWarningSubtitleElement,
    soundButton, soundIcon, fatalErrorReloadButton,
  } = elements;
  const context = canvas.getContext("2d");
  // Read once here so no engine module has to know about `location` (or `wx`).
  const seedSource = () => launchQuery().seed;
  const { keys, touchInput, view, world, camera, player, campaign, state } = createGameState({ seedSource });
  const playTone = createAudio(state).playTone;
  const equipmentShop = createEquipmentShop({
    campaign,
    container: shopItemsElement,
    statsContainer: shopStatsElement,
    goldElement: shopGoldElement,
    messageElement: shopMessageElement,
  });
  const updateHud = createHud({
    state,
    player,
    getCampaignFunds: () => campaign.totalGold,
    getCampaignStage: () => campaign.stage,
    elements: {
      scoreElement, waveElement, goldElement, modeElement, hullLabelElement, hullValueElement,
      hullHealthElement, objectiveCountElement, objectiveProgressElement,
      objectiveLabelElement, extractionGuideElement, extractionArrowElement,
      extractionDistanceElement, touchPadElement, touchHintElement, touchControlsElement,
      touchJoystickElement, touchJoystickKnob,
    },
  });
  const collision = createCollisionSystem({ campaign, world });
  const renderer = createRenderer({
    canvas, context, view, camera, world, player, state,
    getObstacles: () => campaign.obstacles,
    getTerrain: () => campaign.terrain,
    getClouds: () => campaign.clouds,
    getHorseCount: () => campaign.horseCount,
    getRoster: () => campaign.roster,
  });
  const draw = renderer.draw;
  const { setMode } = createScreens({
    state,
    campaign,
    draw,
    elements: {
      menuScreen, battleScreen, shopScreen, overlay, startLabel, startButton,
      overlayEyebrow, overlayTitle, overlayCopy, overlayButton,
    },
  });

  // Battle banner copy is injected by callers so combat/stage modules stay DOM-free.
  function hideBanner() {
    bossWarningElement.hidden = true;
    state.bossWarningTimer = 0;
  }

  function announceBanner({ titleText, subtitleText, duration, tone }) {
    bossWarningTitleElement.textContent = titleText;
    bossWarningSubtitleElement.textContent = subtitleText;
    bossWarningElement.hidden = false;
    state.bossWarningTimer = duration;
    if (tone) playTone(tone.frequency, tone.duration, tone.type, tone.volume);
  }
  function announceBoss() {
    announceBanner({
      titleText: translate("battle.bossWarning", { stage: campaign.stage }),
      subtitleText: `${translate(state.boss.nameKey)} · ${translate(state.boss.epithetKey)}`,
      duration: 5.5,
      tone: { frequency: 190, duration: 0.5, type: "sawtooth", volume: 0.045 },
    });
  }

  // Enemy, projectile, and combat systems reference each other while updating.
  // The refs below make that cycle explicit and order-independent.
  const combatRef = { current: null };
  const projectileRef = { current: null };
  const damagePlayer = defer(() => combatRef.current, "damagePlayer");
  const damageCompanion = defer(() => combatRef.current, "damageCompanion");

  const enemySystem = createEnemies({
    bossTypes, enemyStats, formationPatterns, state, player, world, campaign,
    // Resolved on every roll: createBattle re-seeds campaign.random, so the AI
    // must never capture the generator at wiring time.
    random: () => campaign.random(),
    circleIntersectsObstacle: collision.circleIntersectsObstacle,
    moveEntitySafely: collision.moveEntitySafely,
    getChariotCollisionDamage: () => calculateChariotCollisionDamage(campaign.equipment),
    playTone, updateHud, hasLineOfSight: collision.hasLineOfSight,
    fireEnemy: defer(() => projectileRef.current, "fireEnemyShot"),
    damagePlayer, damageCompanion,
  });
  const {
    spawnFormation, spawnBoss, burst, dust, addMeleeEffect, damageEnemy, updateUnits,
  } = enemySystem;

  const projectiles = createProjectileSystem({
    state, player, world, campaign, collision, burst, dust, playTone, damageEnemy,
    damagePlayer, damageCompanion,
  });
  projectileRef.current = projectiles;

  const combat = createCombatSystem({
    state, player, campaign, collision, projectiles,
    damageEnemy, addMeleeEffect, burst, playTone, updateHud,
    announceBanner,
    onDefeat: () => setMode("over"),
  });
  combatRef.current = combat;

  const playerController = createPlayerController({
    player,
    world,
    keys,
    touchInput,
    moveEntitySafely: collision.moveEntitySafely,
    damagePlayer: combat.damagePlayer,
    state,
  });
  const readControls = playerController.readControls;

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    view.height = view.width * rect.height / rect.width;
    canvas.width = Math.round(rect.width * pixelRatio);
    canvas.height = Math.round(rect.height * pixelRatio);
    context.setTransform(canvas.width / view.width, 0, 0, canvas.height / view.height, 0, 0);
    draw();
  }

  const stageManager = createStageManager({
    campaign, state, player, world, view, camera, equipmentShop, seedSource,
    elements: {
      shopGoldElement, shopScoreElement, shopKillsElement,
      shopStageElement, shopLocationElement, shopMessageElement,
    },
    circleIntersectsObstacle: collision.circleIntersectsObstacle,
    updateHud, setMode, spawnBoss, announceBoss, resizeCanvas, playTone, hideBanner,
  });
  const {
    beginMission, resetMission, beginExtraction, enterShop, rollForNextBattle, restartStage,
  } = stageManager;
  function update(delta) {
    state.elapsed += delta;
    player.swarmDamageCooldown = Math.max(0, player.swarmDamageCooldown - delta);
    readControls(delta);
    if (state.mode !== "running") return;
    if (keys.has(" ") || keys.has("Spacebar")) combat.firePlayer();
    player.cooldown = Math.max(0, player.cooldown - delta);
    player.invulnerable = Math.max(0, player.invulnerable - delta);
    combat.updateCrew(delta);
    if (player.mode === "foot") combat.updateFootCompanions(delta);

    if (state.phase === "combat") state.spawnTimer -= delta;
    if (state.phase === "combat" && state.spawnTimer <= 0) {
      const nextFormation = formationPatterns[(state.formationsSpawned + state.wave - 1) % formationPatterns.length];
      if (state.enemies.length <= campaignRules.enemyLimit - nextFormation.slots.length) spawnFormation();
      state.spawnTimer = Math.max(
        campaignRules.spawnIntervalMin,
        campaignRules.spawnIntervalBase - state.wave * campaignRules.spawnIntervalStep,
      );
    }

    projectiles.update(delta);
    if (state.mode === "over") return;

    updateUnits(delta);
    if (state.mode === "over") return;

    state.shake = Math.max(0, state.shake - 25 * delta);
    state.damageFlash = Math.max(0, state.damageFlash - delta);
    for (const drop of state.drops) {
      drop.life -= delta;
      drop.phase += delta * 2.2;
      if (distanceBetween(player.x, player.y, drop.x, drop.y) < player.radius + 17) {
        campaign.totalGold += drop.value;
        drop.collected = true;
        playTone(drop.type === "gold" ? 680 : 520, 0.1, "sine", 0.018);
      }
    }
    state.drops = state.drops.filter((drop) => !drop.collected && drop.life > 0);
    state.enemies = state.enemies.filter((enemy) => !enemy.destroyed);
    state.formations = state.formations.filter((formation) => state.enemies.some((enemy) => enemy.formationId === formation.id));
    for (const particle of state.particles) {
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.life -= delta;
      particle.vx *= 0.97;
      particle.vy *= 0.97;
    }
    state.particles = state.particles.filter((particle) => particle.life > 0);
    for (const effect of state.meleeEffects) effect.life -= delta;
    state.meleeEffects = state.meleeEffects.filter((effect) => effect.life > 0);
    for (const arrow of state.groundArrows) arrow.life -= delta;
    state.groundArrows = state.groundArrows.filter((arrow) => arrow.life > 0);

    const nextWave = Math.floor(state.score / campaignRules.waveScoreStep) + 1;
    if (nextWave !== state.wave) {
      state.wave = nextWave;
      playTone(520, 0.14, "sine", 0.025);
    }
    updateHud();
    updateCamera({ player, world, view, camera }, delta);
    if (state.bossWarningTimer > 0) {
      state.bossWarningTimer = Math.max(0, state.bossWarningTimer - delta);
      if (state.bossWarningTimer === 0) bossWarningElement.hidden = true;
    }
    if (state.phase === "combat" && (state.bossStage ? state.bossDefeated : state.kills >= state.objectiveTarget)) {
      beginExtraction();
    }
    if (state.phase === "extract" && state.extractionPoint
      && distanceBetween(player.x, player.y, state.extractionPoint.x, state.extractionPoint.y) <= state.extractionPoint.radius) {
      enterShop();
    }
  }

  const controls = bindControls({
    state,
    keys,
    beginMission,
    rollForNextBattle,
    restartStage,
    setMode,
    resizeCanvas,
    battleScreen,
    touchInput,
    elements: {
      startButton, menuStartButton, nextBattleButton, overlayButton,
      soundButton, soundIcon, touchJoystickElement, touchJoystickKnob,
    },
  });

  elements.localeSelect.addEventListener("change", () => {
    setLocale(elements.localeSelect.value);
    applyTranslations();
    controls.refreshLocale();
    equipmentShop.render();
    if (state.mode === "shop") stageManager.refreshShop();
    updateHud();
    setMode(state.mode);
  });

  fatalErrorReloadButton.addEventListener("click", () => window.location.reload());

  resetMission();
  setMode("menu");

  // Debug handle for QA probes and the browser checks: lets a script inspect a
  // live battle (enemies, hull, score) without scraping the HUD. Read-only by
  // convention — gameplay code never reads from it. `combat` and `stageManager`
  // are on it so a harness can drive a real dismount and a real next battle
  // instead of reaching into module internals.
  globalThis.__h5game = {
    state, player, campaign, world, view, camera, combat, stageManager,
  };

  startGameLoop({
    state,
    update,
    draw,
    onError: (error, phase) => reportFatalError(error, phase),
  }).start();
}

try {
  boot();
} catch (error) {
  reportFatalError(error);
}
