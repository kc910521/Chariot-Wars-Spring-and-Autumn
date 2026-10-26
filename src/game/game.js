import { bossTypes, enemyStats, formationPatterns } from "../data/formations.js";
import { calculateChariotCollisionDamage, hasMaxedAxleCap } from "../data/equipment.js";
import { campaignRules, chariotArtRules } from "../data/rules.js";
import { createAudio } from "../assets/audio.js";
import { launchQuery } from "../platform/launch.js";
import { createEquipmentShop } from "./equipment.js";
import { createEnemies } from "./units/enemies.js";
import { createPlayerController } from "./player.js";
import { createGameState } from "./state.js";
import { createCollisionSystem } from "./collision.js";
import { fellTree, isFellable } from "./elements.js";
import { createCombatSystem } from "./combat.js";
import { createProjectileSystem } from "./projectiles.js";
import { pruneParticles, updateParticles } from "./particles.js";
import { createTrailSystem } from "./trails.js";
import { startGameLoop } from "./loop.js";
import { updateCamera } from "../render/camera.js";
import { createRenderer } from "../render/renderer.js";
import { createHud } from "../ui/hud.js";
import { bindControls } from "../ui/controls.js";
import { createScreens } from "../ui/screens.js";
import { createShopScene } from "../ui/shop-scene.js";
import { createStageManager } from "./stages.js";
import { createVictoryLock } from "./victory-lock.js";
import { createPlayerIdentity } from "./identity.js";
import { getGameElements } from "../ui/elements.js";
import { applyTranslations, getLocale, setLocale, translate } from "../i18n/index.js";
import { createPrologue } from "../ui/prologue.js";
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
    canvas, menuScreen, prologueScreen, battleScreen, shopScreen, menuStartButton, nextBattleButton,
    prologueNameElement, prologueBirthElement, prologueNameLineElement, prologueClanElement,
    prologueGivenElement, prologueAmbitionElement, prologueFinalElement,
    prologueStartButton,
    shopItemsElement, shopStatsElement, shopGoldElement, shopScoreElement, shopKillsElement,
    shopStageElement, shopLocationElement, shopMessageElement, scoreElement,
    shopRigCanvas, shopCampCanvas, shopRigCaptionElement, shopCampCaptionElement,
    shopInfoElement,
    waveElement, goldElement, modeElement, hullLabelElement, hullValueElement, hullHealthElement,
    overlay, overlayEyebrow, overlayTitle, overlayCopy, overlayButton, startButton,
    startLabel, objectiveCountElement, objectiveProgressElement, objectiveLabelElement,
    extractionGuideElement, extractionArrowElement, extractionDistanceElement,
    touchPadElement, touchHintElement, touchControlsElement,
    touchJoystickElement, touchJoystickKnob, touchFireElement,
    bossWarningElement, bossWarningTitleElement, bossWarningSubtitleElement,
    victoryScreen, victoryEyebrow, victoryTitle, victorySubtitle, victoryStats, victoryNote,
    victoryReturnButton, menuLockElement, menuLockTitleElement, menuLockDetailElement,
    soundButton, soundIcon, fatalErrorReloadButton,
  } = elements;
  const context = canvas.getContext("2d");
  // Read once here so no engine module has to know about `location` (or `wx`).
  const seedSource = () => launchQuery().seed;
  const { keys, touchInput, view, world, camera, player, campaign, state } = createGameState({ seedSource });
  // The post-victory rest, read from local storage through the platform facade.
  // `?reset=1` clears it for one boot and nothing else: the switch a developer
  // needs when walking the flow a second time in the same browser.
  const victoryLock = createVictoryLock();
  if (launchQuery().reset === "1") victoryLock.reset();
  const playTone = createAudio(state).playTone;
  // The dossier's two canvases: the live team preview and the camp fire. They
  // only animate while the shop screen is up, so they never compete with the
  // battle loop for a frame.
  const shopScene = createShopScene({ rigCanvas: shopRigCanvas, campCanvas: shopCampCanvas });
  const equipmentShop = createEquipmentShop({
    campaign,
    container: shopItemsElement,
    statsContainer: shopStatsElement,
    scene: shopScene,
    rigCaptionElement: shopRigCaptionElement,
    campCaptionElement: shopCampCaptionElement,
    infoElement: shopInfoElement,
    goldElement: shopGoldElement,
    messageElement: shopMessageElement,
  });
  const updateHud = createHud({
    state,
    player,
    campaign,
    getCampaignFunds: () => campaign.totalGold,
    // The battle objective is named after the player, so the HUD reads the same
    // identity the prologue showed. Null before a run starts, which falls back
    // to the plain objective label.
    getPlayerName: () => campaign.identity?.fullName ?? null,
    elements: {
      scoreElement, waveElement, goldElement, modeElement, hullLabelElement, hullValueElement,
      hullHealthElement, objectiveCountElement, objectiveProgressElement,
      objectiveLabelElement, extractionGuideElement, extractionArrowElement,
      extractionDistanceElement, touchPadElement, touchHintElement, touchControlsElement,
      touchJoystickElement, touchJoystickKnob, touchFireElement,
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
    // Resolved per frame, never captured: equipment is bought between battles and
    // the battle that shows a new box or a new blade must read the new numbers.
    getEquipment: () => campaign.equipment,
    getStumps: () => campaign.stumps ?? [],
  });
  // The frame's draw: the field first, then the one number a DOM card has to keep
  // live (the resting countdown on the menu). The screens are built below; the
  // ref keeps this function callable during construction without a TDZ read.
  const screensRef = { current: null };
  function draw() {
    renderer.draw();
    screensRef.current?.paint();
  }
  const screens = createScreens({
    state,
    campaign,
    draw,
    victoryLock,
    // The shop's preview runs on its own clock and must start and stop with the
    // screen, not with the battle loop.
    onModeChange: (mode) => shopScene.setActive(mode === "shop"),
    elements: {
      menuScreen, prologueScreen, battleScreen, shopScreen, victoryScreen, overlay, startLabel,
      startButton, menuStartButton, menuLockElement, menuLockTitleElement, menuLockDetailElement,
      overlayEyebrow, overlayTitle, overlayCopy, overlayButton,
      victoryEyebrow, victoryTitle, victorySubtitle, victoryStats, victoryNote, victoryReturnButton,
    },
  });
  const { setMode } = screens;
  screensRef.current = screens;

  // The story card is painted, never rolled: `startRun()` below picks the name
  // and the length of the run, and a language switch only repaints this same
  // identity and ending.
  const prologue = createPrologue({
    elements: {
      prologueNameElement, prologueBirthElement, prologueNameLineElement,
      prologueClanElement, prologueGivenElement, prologueAmbitionElement, prologueFinalElement,
    },
    getFinalStage: () => campaign.finalStage,
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
    const [first] = state.bosses;
    // Nothing to announce means nothing on the banner: a squad stage that failed
    // to spawn a champion is a bug, but it is not worth a card that reads
    // "undefined".
    if (!first) return;
    // A squad names the whole line instead of one champion and an epithet, and
    // the last battle says so in its title.
    const subtitleText = state.bosses.length > 1
      ? translate("battle.bossSquadBanner", {
        name: translate(first.nameKey), count: state.bosses.length,
      })
      : `${translate(first.nameKey)} · ${translate(first.epithetKey)}`;
    announceBanner({
      titleText: translate(state.finalBattle ? "battle.finalWarning" : "battle.bossWarning", {
        stage: campaign.stage,
      }),
      subtitleText,
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
    spawnFormation, spawnBoss, spawnBossSquad, burst, dust, addMeleeEffect, damageEnemy, updateUnits,
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

  // What a rammed element does to the campaign. A tree with a maxed axle cap and
  // the chariot at full tilt is cut down instead of costing hull points: the same
  // blade length the renderer draws, so the art cannot promise a cut the rule
  // refuses. Anything else - a wall, reeds, a tree at speed - is the old hull hit,
  // plus a shake on the tree that caused it.
  function handleObstacleImpact({ obstacle, x, y }) {
    if (obstacle && isFellable(obstacle) && hasMaxedAxleCap(campaign.equipment)
      && player.speed >= player.maxSpeed * chariotArtRules.treeCutSpeedRatio) {
      fellTree(campaign, obstacle);
      // Both halves of the tree in one frame: the crown bursting upward and the
      // pale wood of the cut underneath it.
      burst(obstacle.x, obstacle.y, "#93a468");
      burst(obstacle.x, obstacle.y + 6, "#6f5436");
      playTone(110, 0.24, "triangle", 0.05);
      return;
    }
    if (obstacle && isFellable(obstacle)) obstacle.hitAt = state.elapsed;
    damagePlayer(8, x, y);
  }

  const playerController = createPlayerController({
    player,
    world,
    keys,
    touchInput,
    moveEntitySafely: collision.moveEntitySafely,
    handleObstacleImpact,
    obstacleAt: collision.obstacleAt,
    state,
  });
  const readControls = playerController.readControls;
  // Cosmetic only: the dust behind anything travelling. It reads positions, never
  // writes one, and draws no random numbers - so the battle's seed stream, and
  // with it every enemy decision, is exactly what it was before the trail existed.
  const trails = createTrailSystem({ state, camera, view });

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
    updateHud, setMode, spawnBoss, spawnBossSquad, announceBoss, resizeCanvas, playTone, hideBanner,
    lockVictory: (summary) => victoryLock.lock(summary),
  });
  const {
    beginMission, resetCampaign, resetMission, beginExtraction, enterShop, enterVictory,
    rollForNextBattle, restartStage, rollFinalStage,
  } = stageManager;

  // Menu -> prologue. The name and the length of the run are rolled with the
  // campaign's stream before createBattle() re-seeds it, so `?seed=7` names the
  // same player and ends the same stage on every reload while the battle below
  // is drawn from a stream neither roll touched. A shop visit, a retry or a
  // language switch reuses both: only a new run draws them again.
  function startRun() {
    // The menu already replaces 出征 with the resting card while the lock is
    // live, but a stale click on a hidden button can survive a frame boundary:
    // the gate belongs here as well, and refusing simply re-opens the menu.
    if (!victoryLock.releaseIfExpired()) {
      setMode("menu");
      return;
    }
    resetCampaign();
    campaign.identity = createPlayerIdentity(campaign.random);
    rollFinalStage();
    prologue.show(campaign.identity);
    setMode("prologue");
  }

  // The victory card's only button: the run is over, so the campaign goes back to
  // nothing and the menu (now locked) shows what the next wait is for.
  function endRun() {
    resetCampaign();
    resetMission();
    setMode("menu");
  }

  function update(delta) {
    state.elapsed += delta;
    player.swarmDamageCooldown = Math.max(0, player.swarmDamageCooldown - delta);
    readControls(delta);
    if (state.mode !== "running") return;
    combat.updatePlayerFire(delta, keys.has(" ") || keys.has("Spacebar"));
    player.cooldown = Math.max(0, player.cooldown - delta);
    player.invulnerable = Math.max(0, player.invulnerable - delta);
    combat.updateCrew(delta);
    if (player.mode === "foot") combat.updateFootCompanions(delta);

    if (state.phase === "combat") state.spawnTimer -= delta;
    if (state.phase === "combat" && state.spawnTimer <= 0) {
      const nextFormation = formationPatterns[(state.formationsSpawned + state.wave - 1) % formationPatterns.length];
      // The last stage carries a squad of eight on top of the ordinary waves, so
      // it gets the larger cap; every other battle keeps the usual one.
      const enemyLimit = state.finalBattle
        ? campaignRules.finalStageEnemyLimit
        : campaignRules.enemyLimit;
      if (state.enemies.length <= enemyLimit - nextFormation.slots.length) spawnFormation();
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
    // After the units have moved and before the particles are integrated, so a
    // puff raised this frame is already on its way.
    trails.update(delta, player, state.enemies);
    updateParticles(state.particles, delta);
    state.particles = pruneParticles(state.particles);
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
      // The same walk ends the campaign on the last stage and opens the shop on
      // every other one.
      if (state.finalBattle) enterVictory();
      else enterShop();
    }
  }

  const controls = bindControls({
    state,
    keys,
    startRun,
    beginMission,
    rollForNextBattle,
    restartStage,
    setMode,
    resizeCanvas,
    battleScreen,
    touchInput,
    endRun,
    elements: {
      startButton, menuStartButton, prologueStartButton, nextBattleButton, overlayButton,
      victoryReturnButton, soundButton, soundIcon, touchJoystickElement, touchJoystickKnob,
    },
  });

  elements.localeSelect.addEventListener("change", () => {
    setLocale(elements.localeSelect.value);
    applyTranslations();
    controls.refreshLocale();
    equipmentShop.render();
    if (state.mode === "shop") stageManager.refreshShop();
    // The prologue keeps the name it was shown with; only the story around it
    // is re-translated. updateHud() runs after applyTranslations() so the
    // objective label never flashes a raw {name} placeholder.
    prologue.paint();
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
  // instead of reaching into module internals, `damageEnemy` for the same reason
  // on the last stage's champion squad, and `victoryLock` so a test can rewind a
  // record instead of waiting out the rest.
  globalThis.__h5game = {
    state, player, campaign, world, view, camera, combat, stageManager, equipmentShop, shopScene,
    damageEnemy, victoryLock,
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
