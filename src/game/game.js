import { bossTypes, enemyStats, formationPatterns, formationPresets } from "../data/formations.js";
import { calculateChariotCollisionDamage, hasMaxedAxleCap } from "../data/equipment.js";
import { campaignRules, chariotArtRules } from "../data/rules.js";
import { soundBorrowed, soundCadence, soundCues } from "../data/sounds.js";
import { wildAnimalStats } from "../data/wilds.js";
import { createAudio } from "../assets/audio.js";
import { launchQuery } from "../platform/launch.js";
import { createEquipmentShop } from "./equipment.js";
import { createEnemies } from "./units/enemies.js";
import { createAllies } from "./units/allies.js";
import { createPlayerController } from "./player.js";
import { createGameState } from "./state.js";
import { createCollisionSystem } from "./collision.js";
import { createPathSystem } from "./pathfinding.js";
import { fellTree, isFellable, rectHitsAnyObstacle, rectTerrain } from "./elements.js";
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
import { createBattleCard, cardForTutorial } from "../ui/battle-card.js";
import { createMenuPage } from "../ui/menu-page.js";
import { createShopScreen } from "../ui/shop-screen.js";
import { createStageManager } from "./stages.js";
import { createVictoryLock } from "./victory-lock.js";
import { createPlayerIdentity } from "./identity.js";
import { createTutorial } from "./tutorial.js";
import { getGameElements } from "../ui/elements.js";
import { applyTranslations, getLocale, setLocale, translate } from "../i18n/index.js";
import { createPrologue } from "../ui/prologue.js";
import { commandedFormation, toggleOrder } from "./units/formation-orders.js";
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
    canvas, menuScreen, prologueScreen, battleScreen, shopScreen, menuStartButton,
    prologueNameElement, prologueBirthElement, prologueNameLineElement, prologueClanElement,
    prologueGivenElement, prologueAmbitionElement, prologueFinalElement,
    prologueStartButton, prologueTutorialButton,
    shopCanvas, shopLiveElement, menuCanvas, menuLiveElement, scoreElement,
    waveElement, goldElement, modeElement, hullLabelElement, hullValueElement, hullHealthElement,
    startButton, startLabel, objectiveCountElement, objectiveProgressElement, objectiveLabelElement,
    extractionGuideElement, extractionArrowElement, extractionDistanceElement, guideLabelElement,
    touchPadElement, touchHintElement, touchControlsElement,
    touchJoystickElement, touchJoystickKnob, touchFireElement, touchOrderElement,
    bossWarningElement, bossWarningTitleElement, bossWarningSubtitleElement,
    soundButton, soundIcon, fatalErrorReloadButton, cardButton,
  } = elements;
  const context = canvas.getContext("2d");
  // Read once here so no engine module has to know about `location` (or `wx`).
  const seedSource = () => launchQuery().seed;
  // A developer switch, read through the same seam as the seed: `?rings=` reshapes
  // the battlefield's 回 ratios for this boot (src/data/rings.js parses it).
  const ringSource = () => launchQuery().rings;
  const { keys, touchInput, view, world, camera, player, campaign, state } = createGameState({ seedSource });
  // The post-victory rest, read from local storage through the platform facade.
  // `?reset=1` clears it for one boot and nothing else: the switch a developer
  // needs when walking the flow a second time in the same browser.
  const victoryLock = createVictoryLock();
  if (launchQuery().reset === "1") victoryLock.reset();
  // The sound player and the one function gameplay gets: `playSound(cue)`. Every
  // caller names a cue from src/data/sounds.js, so no gameplay module knows a file
  // name, a gain or a loop lane.
  const audio = createAudio(state);
  const playSound = (cue, options) => audio.play(cue, options);
  // Browsers only start a context inside a gesture, so every press or key of the
  // session unlocks it: the first one starts the context and the warm-up decode,
  // and the rest hand back a music bed that opened on a later screen change and
  // was refused in between (Safari does not retry on its own). Both calls are
  // idempotent and cheap, so the listeners stay for the whole session rather than
  // being removed after the first tap - removing them is what used to leave a bed
  // silent for good.
  const unlockAudio = () => audio.unlock();
  window.addEventListener("pointerdown", unlockAudio);
  window.addEventListener("keydown", unlockAudio);

  // What the soundscape is: the screen, whether a champion is on the field, and
  // whether the chariot is rolling. Idempotent and cheap, so the battle loop calls
  // it every frame while a screen change calls it once.
  function syncSoundscape() {
    audio.setState({
      mode: state.mode,
      boss: state.bosses.length > 0,
      moving: state.mode === "running" && player.mode === "chariot" && player.speed > 40,
    });
  }

  // Footsteps are the one cue driven by distance walked rather than by an event, so
  // they are measured here, where the frame's movement has already been applied.
  // `soundCadence.footstepStride` is how far a step is; the five takes in the bank
  // are what stop a stride from sounding like a metronome.
  let strideCarry = 0;
  let lastStepX = player.x;
  let lastStepY = player.y;
  function updateFootsteps() {
    const moved = Math.hypot(player.x - lastStepX, player.y - lastStepY);
    lastStepX = player.x;
    lastStepY = player.y;
    if (player.mode !== "foot" || state.mode !== "running") {
      strideCarry = 0;
      return;
    }
    strideCarry += moved;
    if (strideCarry < soundCadence.footstepStride) return;
    strideCarry = 0;
    playSound(soundCues.footstep);
  }
  // The shop page: one canvas, and the campaign's own purchase rules. The page
  // paints itself while it is open (its own frame clock, never the battle's) and
  // is handed the footer's "next battle" as a callback, because the stage manager
  // that owns that transition is built further down.
  const equipmentShop = createEquipmentShop({ campaign });
  const shopPage = createShopScreen({
    canvas: shopCanvas,
    campaign,
    equipmentShop,
    liveRegion: shopLiveElement,
    onNextBattle: () => rollForNextBattle(),
    playSound,
  });
  // The home page: one canvas with the card on it, and the one button the DOM menu
  // used to own kept as an invisible focus proxy over the painted 出征, so Tab and a
  // screen reader still reach it. `victoryLock` is read every frame, which is what
  // makes the resting countdown tick without the battle loop writing the DOM.
  const menuPage = createMenuPage({
    canvas: menuCanvas,
    victoryLock,
    liveRegion: menuLiveElement,
    startProxy: menuStartButton,
    onStart: () => startRun(),
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
    // The line the player is standing in, or null. The HUD shows 出击 / 结阵 only
    // for a line it can actually order - `commandedFormation` answers with the
    // nearest ring he is inside *and* owns.
    getFormationOrder: () => commandedFormation(state.allyFormations, player, "player"),
    elements: {
      scoreElement, waveElement, goldElement, modeElement, hullLabelElement, hullValueElement,
      hullHealthElement, objectiveCountElement, objectiveProgressElement,
      objectiveLabelElement, extractionGuideElement, extractionArrowElement,
      extractionDistanceElement, guideLabelElement, touchPadElement, touchHintElement, touchControlsElement,
      touchJoystickElement, touchJoystickKnob, touchFireElement, touchOrderElement,
    },
  });
  const collision = createCollisionSystem({ campaign, world });
  // Grid routing for every body that is not the player. One clearance field per
  // battle, one A* route per unit per second at most (see pathfinding.js): the
  // player drives himself, and `moveEntitySafely` is what stops everyone else, so
  // this only ever decides *which way* a unit walks. It leans on the collision
  // broadphase for its exact segment check, which is why it is built after it.
  const paths = createPathSystem({
    campaign, world,
    circleIntersectsObstacle: collision.circleIntersectsObstacle,
  });
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
  // The one card (src/ui/battle-card.js): pause, defeat, victory and the drill's
  // beats all paint through this. It is DOM, so the field's own draw has nothing
  // to layer on top of itself any more.
  const battleCard = createBattleCard({ elements });
  // The frame's draw: the field, and nothing else. The card is a DOM element over
  // the canvas, and both pages - the shop and the home page - paint on their own
  // canvases and their own clock, so nothing here has to keep a dialog live.
  function draw() {
    renderer.draw();
  }
  // The tutorial arms itself on every entry into "running" (a battle opening, a
  // pause being dismissed, a tab regaining focus after a blur). The ref exists
  // because it is built further down, once the enemy system it spawns through does
  // - and setMode() is already callable at this point.
  const tutorialRef = { current: null };
  const screens = createScreens({
    state,
    campaign,
    draw,
    victoryLock,
    battleCard,
    // Both canvas pages run on their own clock and must start and stop with the
    // screen, not with the battle loop.
    onModeChange: (mode) => {
      shopPage.setActive(mode === "shop");
      menuPage.setActive(mode === "menu");
      tutorialRef.current?.arm();
      // The shop opening is what starts the campfire and the menu what silences
      // the field, so the screen is the soundscape's trigger as well as its source.
      syncSoundscape();
    },
    elements: {
      menuScreen, prologueScreen, battleScreen, shopScreen, startLabel, startButton,
    },
  });
  const { setMode } = screens;

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

  function announceBanner({ titleText, subtitleText, duration, cue }) {
    bossWarningTitleElement.textContent = titleText;
    bossWarningSubtitleElement.textContent = subtitleText;
    bossWarningElement.hidden = false;
    state.bossWarningTimer = duration;
    if (cue) playSound(cue);
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
      // TODO(sound): a real boss horn; the row is documented in soundBorrowed.
      cue: soundBorrowed.bossWarning,
    });
  }

  // Enemy, projectile, and combat systems reference each other while updating.
  // The refs below make that cycle explicit and order-independent.
  const combatRef = { current: null };
  const projectileRef = { current: null };
  const alliesRef = { current: null };
  const damagePlayer = defer(() => combatRef.current, "damagePlayer");
  const damageCompanion = defer(() => combatRef.current, "damageCompanion");
  const damageAlly = defer(() => alliesRef.current, "damageAlly");

  const enemySystem = createEnemies({
    bossTypes, enemyStats, wildAnimalStats, formationPatterns, formationPresets, state, player, world, campaign,
    // Resolved on every roll: createBattle re-seeds campaign.random, so the AI
    // must never capture the generator at wiring time.
    random: () => campaign.random(),
    circleIntersectsObstacle: collision.circleIntersectsObstacle,
    moveEntitySafely: collision.moveEntitySafely,
    paths,
    getChariotCollisionDamage: () => calculateChariotCollisionDamage(campaign.equipment),
    playSound, updateHud, hasLineOfSight: collision.hasLineOfSight,
    fireEnemy: defer(() => projectileRef.current, "fireEnemyShot"),
    damagePlayer, damageCompanion, damageAlly,
  });
  const {
    spawnFormation, spawnBoss, spawnBossSquad, burst, dust, addMeleeEffect, damageEnemy, updateUnits,
  } = enemySystem;

  // The tutorial: a step machine that spawns through the enemy system's scenario
  // entry points (a tiger, then two preset bands) and the ally system's (the clan's
  // borrowed squad). It runs only in a tutorial battle; `arm()` is idempotent per
  // battle.
  const tutorial = createTutorial({
    state, player, world, campaign, enemySystem, updateHud,
    // The borrowed squad is the ally system's, and the ally system is built below
    // this line: `defer` is the same seam `damageAlly` uses, so the tutorial never
    // holds a reference to a half-built system.
    spawnScenarioLine: defer(() => alliesRef.current, "spawnScenarioLine"),
    despawnScenarioLine: defer(() => alliesRef.current, "despawnScenarioLine"),
    // A beat's card is the DOM card every other dialog uses: the drill says which
    // beat is up, the card paints it (src/ui/battle-card.js).
    onOverlay: (overlay) => battleCard.show(cardForTutorial(overlay)),
  });
  tutorialRef.current = tutorial;

  // The hired line fights with the same verbs the enemies do: `damageEnemy` for
  // its blows, the projectile system's `fireAllyShot` for its bows, and the
  // enemy spawner's burst/melee effects for feedback. It owns no references to
  // the player's combat module - a hire can never call `damagePlayer`.
  const allies = createAllies({
    state, player, world, campaign,
    moveEntitySafely: collision.moveEntitySafely,
    hasLineOfSight: collision.hasLineOfSight,
    circleIntersectsObstacle: collision.circleIntersectsObstacle,
    rectHitsAnyObstacle, rectTerrain, paths,
    damageEnemy, fireAllyShot: defer(() => projectileRef.current, "fireAllyShot"),
    addMeleeEffect, burst, playSound,
  });
  alliesRef.current = allies;

  const projectiles = createProjectileSystem({
    state, player, world, campaign, collision, burst, dust, playSound, damageEnemy,
    damagePlayer, damageCompanion, damageAlly,
  });
  projectileRef.current = projectiles;

  const combat = createCombatSystem({
    state, player, campaign, collision, projectiles, paths,
    damageEnemy, addMeleeEffect, burst, playSound, updateHud,
    announceBanner,
    onDefeat: () => {
      // A battle lost keeps none of its takings: the purse rolls back to what the
      // fight was entered with, so the number on the defeat card ("you keep N") is
      // the number the retry really leaves the player holding. Coins banked by
      // earlier battles are untouched - the snapshot is taken per battle.
      campaign.totalGold = campaign.entryGold;
      setMode("over");
    },
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
      playSound(soundCues.treeFell);
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
    campaign, state, player, world, view, camera, shopScreen: shopPage, seedSource, ringSource,
    circleIntersectsObstacle: collision.circleIntersectsObstacle,
    updateHud, setMode, spawnBoss, spawnBossSquad, announceBoss, resizeCanvas, playSound, hideBanner,
    spawnFriendlyAllies: allies.spawnFriendlyFormations,
    lockVictory: (summary) => victoryLock.lock(summary),
    // The clan's gift (stages.offerClanGrant). It is parked on the state and the
    // card is painted straight away: the gift is not a mode, so nothing about the
    // run changes except that the field waits under the news until it is put away
    // (src/game/game.js freezes on `state.grant` the way it freezes on a drill card).
    onGrant: (grant) => {
      state.grant = grant;
      screens.showCard();
    },
  });
  const {
    beginMission, beginTutorial, resetCampaign, resetMission, beginExtraction, enterShop, enterVictory,
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

  // The prologue's second door: the tiger drill. Same freshly rolled run, one
  // scenario instead of a campaign battle (see stages.beginTutorial), and nothing
  // about the run is spent by playing it.
  function startTutorial() {
    if (!victoryLock.releaseIfExpired()) {
      setMode("menu");
      return;
    }
    resetCampaign();
    campaign.identity = createPlayerIdentity(campaign.random);
    rollFinalStage();
    // The story card keeps the same identity: the drill belongs to this run, so a
    // language switch must not repaint the previous run's nameplate behind it.
    prologue.show(campaign.identity);
    beginTutorial();
  }

  // The victory card's only button: the run is over, so the campaign goes back to
  // nothing and the menu (now locked) shows what the next wait is for.
  function endRun() {
    resetCampaign();
    resetMission();
    setMode("menu");
  }

  // The walk to the gate: the same arrival ends the campaign on the last stage and
  // opens the shop on every other one. A frozen field never gets here, which is why
  // the clan's gift (raised as this gate opens) cannot be walked through while its
  // card is up: the news is put away first, and the frame after that finds the
  // player standing in the circle he was already in and ends the run from there.
  function checkExtractionArrival() {
    if (state.phase !== "extract" || !state.extractionPoint) return;
    const span = distanceBetween(player.x, player.y, state.extractionPoint.x, state.extractionPoint.y);
    if (span > state.extractionPoint.radius) return;
    if (state.finalBattle) enterVictory();
    else enterShop();
  }

  function update(delta) {
    state.elapsed += delta;
    // The route clock is simulated time, not wall time: a route's TTL and its
    // stuck timer have to replay identically under H5_TRACE, and the planning
    // budget has to reset once per simulated frame (pathfinding.js).
    paths.beginFrame(delta);
    player.swarmDamageCooldown = Math.max(0, player.swarmDamageCooldown - delta);
    // A tutorial card (or a pan) is a real pause: every control reads neutral, so
    // the chariot coasts to a stop instead of the field freezing mid-stride. The
    // clan's gift card is the same bargain, and it has to be: it opens over a live
    // field (the extraction gate is open and the player is still driving for it),
    // so the field waits for the card rather than letting a stray axe find a reader.
    const frozen = state.tutorial?.frozen === true || state.grant !== null;
    readControls(delta, frozen);
    updateFootsteps();
    syncSoundscape();
    if (state.mode !== "running") return;
    tutorial.update(delta);
    if (state.grant !== null || state.tutorial?.frozen) {
      // Nothing moves, nothing is fired and nothing lands while a card is up. The
      // bow's draw state is dropped rather than carried across the pause, and the
      // camera still eases (a pan is a frozen field, not a frozen camera).
      state.fireHold = 0;
      state.fireHeld = false;
      updateHud();
      updateCamera({ player, world, view, camera, focus: state.cameraFocus }, delta);
      return;
    }
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

    // The hired line moves after the enemies have decided where they stand, so a
    // swing is aimed at this frame's position and not last frame's.
    allies.update(delta);

    state.shake = Math.max(0, state.shake - 25 * delta);
    state.damageFlash = Math.max(0, state.damageFlash - delta);
    for (const drop of state.drops) {
      drop.life -= delta;
      drop.phase += delta * 2.2;
      if (distanceBetween(player.x, player.y, drop.x, drop.y) < player.radius + 17) {
        // Meat is a wild animal's drop and pays in hull, not coin: the drill is
        // meant to teach the controls, so it heals what the tiger bit off rather
        // than starting a ledger the shop cannot spend.
        if (drop.type === "meat") {
          player.health = Math.min(player.maxHealth, player.health + (drop.heal ?? 0));
        } else {
          campaign.totalGold += drop.value;
        }
        drop.collected = true;
        playSound(drop.type === "gold" ? soundCues.coinPickup : soundCues.meatPickup);
      }
    }
    state.drops = state.drops.filter((drop) => !drop.collected && drop.life > 0);
    state.enemies = state.enemies.filter((enemy) => !enemy.destroyed);
    // Animals come out of their roster on the same frame: the tutorial's script
    // reads the tiger's `destroyed` flag, never its presence in the list.
    state.wilds = state.wilds.filter((unit) => !unit.destroyed);
    state.formations = state.formations.filter((formation) => state.enemies.some((enemy) => enemy.formationId === formation.id));
    // After the units have moved and before the particles are integrated, so a
    // puff raised this frame is already on its way.
    trails.update(delta, player, state.enemies, state.allies);
    updateParticles(state.particles, delta);
    state.particles = pruneParticles(state.particles);
    for (const effect of state.meleeEffects) effect.life -= delta;
    state.meleeEffects = state.meleeEffects.filter((effect) => effect.life > 0);
    for (const arrow of state.groundArrows) arrow.life -= delta;
    state.groundArrows = state.groundArrows.filter((arrow) => arrow.life > 0);

    const nextWave = Math.floor(state.score / campaignRules.waveScoreStep) + 1;
    if (nextWave !== state.wave) {
      state.wave = nextWave;
      playSound(soundCues.waveUp);
    }
    updateHud();
    updateCamera({ player, world, view, camera, focus: state.cameraFocus }, delta);
    if (state.bossWarningTimer > 0) {
      state.bossWarningTimer = Math.max(0, state.bossWarningTimer - delta);
      if (state.bossWarningTimer === 0) bossWarningElement.hidden = true;
    }
    // The extraction opens on the battle's own objective: the champion's fall, or
    // the kill count a stage set. A drill is the exception - its extraction is the
    // *scenario's* answer, not a body count, because the tutorial's encounters are
    // three separate lines and only the last one finishing means the player has
    // been taught what the drill is for (`state.tutorial` is cleared by
    // `tutorial.finish()`). A tutorial battle therefore never opens its extraction
    // here; the moment the script ends, `state.tutorial` is null and the ordinary
    // rule below takes over on the same frame.
    if (state.phase === "combat" && !state.tutorial
      && (state.bossStage ? state.bossDefeated : state.kills >= state.objectiveTarget)) {
      beginExtraction();
    }
    checkExtractionArrival();
  }

  const controls = bindControls({
    state,
    keys,
    startRun,
    startTutorial,
    beginMission,
    restartStage,
    setMode,
    resizeCanvas,
    // Both pages size their own canvas from the element's box, so they need the
    // same resize the battlefield gets - they are just never the battlefield's
    // clock.
    resizeShop: () => shopPage.resize(),
    resizeMenu: () => menuPage.resize(),
    battleScreen,
    touchInput,
    endRun,
    // The card is canvas UI, so "click the button" and "press Enter" are the same
    // call as far as the controls are concerned.
    confirmTutorial: () => tutorial.confirm(),
    // The clan's gift card's button: put the news away and give the field back.
    // The line is already bought (stages.offerClanGrant), so there is nothing to
    // confirm - which is exactly why the card is not a mode.
    confirmGrant: () => {
      state.grant = null;
      screens.showCard();
    },
    // The HUD's mute switch is the player's own: `state.sound` is what the player
    // sees, and the player applies it immediately so the shop's campfire and the
    // menu's ambience stop on the same tap.
    onSoundToggle: (enabled) => audio.setEnabled(enabled),
    // One press of 出击 / 结阵. The order itself knows which state it came from
    // (`toggleOrder`), and the HUD is refreshed straight away so the label turns
    // over inside the same tap rather than on the next frame - the button is
    // covered by the thumb that pressed it.
    onFormationOrder: () => {
      const given = toggleOrder({
        formations: state.allyFormations, members: state.allies, leader: player, owner: "player",
      });
      if (!given) return;
      // The drill counts the two orders it teaches (`noteOrder`): the press is
      // reported from here rather than inferred from the line, because the button
      // toggles and both presses may land between two frames. In every other battle
      // there is no script listening and the call is a no-op.
      tutorialRef.current.noteOrder(given);
      updateHud();
    },
    elements: {
      startButton, menuStartButton, prologueStartButton, prologueTutorialButton,
      cardButton, soundButton, soundIcon,
      touchJoystickElement, touchJoystickKnob, touchOrderElement,
    },
  });

  elements.localeSelect.addEventListener("change", () => {
    setLocale(elements.localeSelect.value);
    applyTranslations();
    controls.refreshLocale();
    // The card is painted imperatively from a spec, so `applyTranslations()` above
    // cannot reach it: it repaints itself from the spec it is showing. The shop and
    // the home page draw every label from the translator on each frame, so a
    // language switch only has to get the pages repainted - and each is only on
    // screen, and so only painting, while it is open.
    battleCard.refresh();
    stageManager.refreshShop();
    menuPage.refresh();
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
  // on the last stage's champion squad, `victoryLock` so a test can rewind a
  // record instead of waiting out the rest, and `menuPage` so it can press the
  // painted 出征 without guessing where the card put it. The card itself is DOM,
  // so a harness reads it the way a player does - through the page.
  globalThis.__h5game = {
    state, player, campaign, world, view, camera, combat, stageManager, equipmentShop, shopPage,
    menuPage, damageEnemy, victoryLock, tutorial,
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
