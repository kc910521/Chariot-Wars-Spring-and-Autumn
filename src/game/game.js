import { bossTypes, enemyStats, formationPatterns } from "../data/formations.js";
import { calculateChariotCollisionDamage, calculateChariotStats, getPlayerArrowCount, personnel } from "../data/equipment.js";
import { createAudio } from "../assets/audio.js";
import { createEquipmentShop } from "./equipment.js";
import { createEnemies } from "./units/enemies.js";
import { createPlayerController } from "./player.js";
import { createGameState } from "./state.js";
import { updateCamera } from "../render/camera.js";
import { createRenderer } from "../render/renderer.js";
import { createHud } from "../ui/hud.js";
import { bindControls } from "../ui/controls.js";
import { createScreens } from "../ui/screens.js";
import { createStageManager } from "./stages.js";
import { getGameElements } from "../ui/elements.js";
import { createBallisticProjectile, solveBallisticElevation, updateProjectiles } from "./projectiles.js";
import { terrainSpeedMultiplier } from "./map.js";
import { addBloodStain } from "./blood.js";
import { applyTranslations, getLocale, setLocale, translate } from "../i18n/index.js";
import { clamp, distanceBetween } from "../utils/math.js";

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
  soundButton, soundIcon,
} = elements;
const context = canvas.getContext("2d");
const { keys, touchInput, view, world, camera, player, campaign, state } = createGameState();
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
const enemySystem = createEnemies({
  bossTypes, enemyStats, formationPatterns, state, player, world,
  getRandom: () => campaign.random,
  circleIntersectsObstacle, moveEntitySafely,
  getChariotCollisionDamage: () => calculateChariotCollisionDamage(campaign.equipment),
  playTone, updateHud, hasLineOfSight, fireEnemy, damagePlayer, damageCompanion,
});
const {
  resolveInfantryCollision, spawnFormation, spawnBoss, burst, addMeleeEffect, damageEnemy, updateUnits,
} = enemySystem;
const playerController = createPlayerController({
  player,
  world,
  keys,
  touchInput,
  moveEntitySafely,
  damagePlayer,
  state,
});
const readControls = playerController.readControls;
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
const stageManager = createStageManager({
  campaign, state, player, world, view, camera, equipmentShop,
  elements: {
    bossWarningElement, shopGoldElement, shopScoreElement, shopKillsElement,
    shopStageElement, shopLocationElement, shopMessageElement,
    bossWarningTitleElement, bossWarningSubtitleElement,
  },
  circleIntersectsObstacle, updateHud, setMode, spawnBoss, announceBoss, resizeCanvas, playTone,
});
const {
  beginMission, resetMission, beginExtraction, enterShop, rollForNextBattle, restartStage,
} = stageManager;

elements.localeSelect.addEventListener("change", () => {
  setLocale(elements.localeSelect.value);
  applyTranslations();
  controls.refreshLocale();
  equipmentShop.render();
  if (state.mode === "shop") stageManager.refreshShop();
  updateHud();
  setMode(state.mode);
});

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  view.height = view.width * rect.height / rect.width;
  canvas.width = Math.round(rect.width * pixelRatio);
  canvas.height = Math.round(rect.height * pixelRatio);
  context.setTransform(canvas.width / view.width, 0, 0, canvas.height / view.height, 0, 0);
  draw();
}

function announceBoss() {
  bossWarningTitleElement.textContent = translate("battle.bossWarning", { stage: campaign.stage });
  bossWarningSubtitleElement.textContent = `${translate(state.boss.nameKey)} · ${translate(state.boss.epithetKey)}`;
  bossWarningElement.hidden = false;
  state.bossWarningTimer = 5.5;
  playTone(190, 0.5, "sawtooth", 0.045);
}

function circleIntersectsObstacle(x, y, radius, obstacleList = campaign.obstacles) {
  return obstacleList.some((obstacle) => {
    if (obstacle.type === "tree") {
      return distanceBetween(x, y, obstacle.x, obstacle.y) < radius + obstacle.radius;
    }
    const closestX = clamp(x, obstacle.x, obstacle.x + obstacle.width);
    const closestY = clamp(y, obstacle.y, obstacle.y + obstacle.height);
    return distanceBetween(x, y, closestX, closestY) < radius;
  });
}

function hasLineOfSight(fromX, fromY, toX, toY) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const length = distanceBetween(fromX, fromY, toX, toY);
  const steps = Math.ceil(length / 12);
  for (let step = 1; step < steps; step += 1) {
    const fraction = step / steps;
    if (circleIntersectsObstacle(fromX + dx * fraction, fromY + dy * fraction, 2)) return false;
  }
  return true;
}

function moveEntitySafely(entity, dx, dy, radius) {
  const movementScale = terrainSpeedMultiplier(entity.x, entity.y, campaign.terrain);
  dx *= movementScale;
  dy *= movementScale;
  const nextX = clamp(entity.x + dx, radius, world.width - radius);
  const nextY = clamp(entity.y + dy, radius, world.height - radius);
  if (!circleIntersectsObstacle(nextX, entity.y, radius)) entity.x = nextX;
  if (!circleIntersectsObstacle(entity.x, nextY, radius)) entity.y = nextY;
}

function firePlayer() {
  if (player.cooldown > 0) return;
  if (player.mode === "foot") {
    const target = state.enemies
      .filter((enemy) => !enemy.destroyed)
      .map((enemy) => ({
        enemy,
        horizontalDistance: enemy.x - player.x,
        verticalDistance: enemy.y - player.y,
      }))
      .filter(({ enemy, horizontalDistance, verticalDistance }) => {
        const targetDistance = distanceBetween(0, 0, horizontalDistance, verticalDistance);
        const facingAlignment = (Math.cos(player.angle) * horizontalDistance
          + Math.sin(player.angle) * verticalDistance) / Math.max(1, targetDistance);
        return targetDistance <= player.radius + enemy.radius + 26 && facingAlignment > 0.15;
      })
      .sort((first, second) => distanceBetween(0, 0, first.horizontalDistance, first.verticalDistance)
        - distanceBetween(0, 0, second.horizontalDistance, second.verticalDistance))[0]?.enemy;
    player.cooldown = 0.72;
    addMeleeEffect(player.x + Math.cos(player.angle) * 20, player.y + Math.sin(player.angle) * 20, player.angle, "sword");
    if (target) {
      damageEnemy(target, 1);
      burst(target.x, target.y, "#d9bb79");
    }
    playTone(target ? 180 : 250, 0.08, "triangle", 0.02);
    return;
  }
  const arrowCount = getPlayerArrowCount(campaign.equipment);
  const spread = 0.075;
  for (let index = 0; index < arrowCount; index += 1) {
    const angle = player.angle + (index - (arrowCount - 1) / 2) * spread;
    state.bullets.push(createBallisticProjectile({
      x: player.x + Math.cos(angle) * 29,
      y: player.y + Math.sin(angle) * 29,
      angle,
      speed: 460,
      elevation: 0.42,
      gravity: 420,
      range: 470,
      owner: "player",
      damage: calculateChariotStats(campaign.equipment, campaign.horseCount).firepower * 1.5,
      kind: "arrow",
    }));
  }
  player.cooldown = 0.42;
  playTone(340, 0.09, "triangle", 0.018);
}

function fireEnemy(enemy, angle, target = player) {
  const distance = distanceBetween(enemy.x, enemy.y, target.x, target.y);
  const kind = enemy.projectile ?? (enemy.boss && enemy.type === "catapult" ? "stone" : "arrow");
  const speed = enemy.projectileSpeed ?? (enemy.boss && enemy.type === "catapult" ? 560 : kind === "stone" ? 455 : 420);
  const gravity = kind === "stone" ? 430 : 420;
  const elevation = solveBallisticElevation(distance, speed, gravity);
  state.bullets.push(createBallisticProjectile({
    x: enemy.x + Math.cos(angle) * 18,
    y: enemy.y + Math.sin(angle) * 18,
    angle,
    speed,
    elevation,
    gravity,
    range: enemy.projectileRange ?? (enemy.boss && enemy.type === "catapult" ? 540 : enemy.range),
    owner: "enemy",
    target,
    damage: enemy.damage,
    kind,
  }));
  enemy.shotCooldown = enemy.fireInterval ?? (enemy.boss && enemy.type === "catapult" ? 3.1 : 2.1 + Math.random() * 0.7);
  playTone(250, 0.11, "triangle", 0.012);
}

function fireCrewArrow(enemy, crewIndex = 0, crewCount = 1, source = player) {
  const angle = Math.atan2(enemy.y - source.y, enemy.x - source.x);
  const volleyAngle = angle + (crewIndex - (crewCount - 1) / 2) * 0.055;
  const distance = distanceBetween(source.x, source.y, enemy.x, enemy.y);
  state.bullets.push(createBallisticProjectile({
    x: source.x + Math.cos(volleyAngle) * 25,
    y: source.y + Math.sin(volleyAngle) * 25,
    angle: volleyAngle,
    speed: 420,
    elevation: solveBallisticElevation(distance, 420),
    gravity: 420,
    range: 430,
    owner: "ally",
    damage: personnel[0].damage,
    kind: "arrow",
  }));
  playTone(390, 0.06, "sine", 0.01);
}

function updateCrew(delta) {
  if (player.mode === "foot") return;
  const members = campaign.roster.filter((member) => member.alive !== false);
  for (const [index, member] of members.entries()) {
    const config = personnel.find((person) => person.id === member.role);
    if (!config) continue;
    member.cooldown = Math.max(0, (member.cooldown ?? 0) - delta);
    const target = state.enemies
      .filter((enemy) => !enemy.destroyed)
      .filter((enemy) => distanceBetween(player.x, player.y, enemy.x, enemy.y) <= config.range)
      .filter((enemy) => member.role !== "archer" || hasLineOfSight(player.x, player.y, enemy.x, enemy.y))
      .sort((first, second) => distanceBetween(player.x, player.y, first.x, first.y) - distanceBetween(player.x, player.y, second.x, second.y))[0];
    if (!target || member.cooldown > 0) continue;

    if (member.role === "archer") {
      fireCrewArrow(target, index, members.length);
    } else {
      const distance = distanceBetween(player.x, player.y, target.x, target.y);
      if (distance > config.range) continue;
      const angle = Math.atan2(target.y - player.y, target.x - player.x);
      addMeleeEffect(target.x, target.y, angle, "dagger-axe");
      damageEnemy(target, config.damage);
      burst(target.x, target.y, "#d9bb79");
    }
    member.cooldown = config.cooldown;
  }
}

function dismountPlayer() {
  player.mode = "foot";
  player.type = "spear";
  player.radius = 12;
  player.maxHealth = 80;
  player.health = player.maxHealth;
  player.speed = 0;
  player.maxSpeed = 108;
  player.invulnerable = 1.8;
  player.knockbackX = 0;
  player.knockbackY = 0;
  player.cooldown = 0.5;
  state.footCompanions = [];
  const roster = campaign.roster.filter((member) => member.alive !== false);
  for (let index = 0; index < roster.length; index += 1) {
    const member = roster[index];
    const config = personnel.find((person) => person.id === member.role);
    if (!config) continue;
    const isArcher = member.role === "archer";
    state.footCompanions.push({
      type: isArcher ? "archer" : "ge",
      x: player.x - Math.cos(player.angle) * (44 + Math.floor(index / 2) * 22)
        + Math.sin(player.angle) * ((index % 2 === 0 ? -1 : 1) * (20 + Math.floor(index / 2) * 10)),
      y: player.y - Math.sin(player.angle) * (44 + Math.floor(index / 2) * 22)
        - Math.cos(player.angle) * ((index % 2 === 0 ? -1 : 1) * (20 + Math.floor(index / 2) * 10)),
      radius: 10,
      angle: player.angle,
      color: isArcher ? "#398b63" : "#b28b4d",
      health: config.health,
      maxHealth: config.health,
      hitFlash: 0,
      knockedDown: 0,
      invulnerable: 0.65,
      knockbackX: 0,
      knockbackY: 0,
      personnelId: member.id,
      attackCooldown: config.cooldown * 0.4 + index * 0.08,
      isAlly: true,
    });
  }
  bossWarningTitleElement.textContent = translate("battle.dismounted");
  bossWarningSubtitleElement.textContent = translate("battle.crewFollow", { count: roster.length });
  bossWarningElement.hidden = false;
  state.bossWarningTimer = 4.5;
  playTone(145, 0.4, "sawtooth", 0.035);
  updateHud();
}

function updateFootCompanions(delta) {
  for (const [index, companion] of state.footCompanions.entries()) {
    if (companion.destroyed) continue;
    companion.hitFlash = Math.max(0, companion.hitFlash - delta);
    companion.invulnerable = Math.max(0, companion.invulnerable - delta);
    const row = Math.floor(index / 2);
    const side = index % 2 === 0 ? -1 : 1;
    const backOffset = 42 + row * 24;
    const sideOffset = side * (22 + row * 8);
    const followX = player.x - Math.cos(player.angle) * backOffset + Math.sin(player.angle) * sideOffset;
    const followY = player.y - Math.sin(player.angle) * backOffset - Math.cos(player.angle) * sideOffset;
    const followDistance = distanceBetween(companion.x, companion.y, followX, followY);
    if (followDistance > 13) {
      const followAngle = Math.atan2(followY - companion.y, followX - companion.x);
      const speed = companion.type === "archer" ? 112 : 122;
      moveEntitySafely(
        companion,
        Math.cos(followAngle) * Math.min(followDistance, speed * delta) + (companion.knockbackX || 0) * delta,
        Math.sin(followAngle) * Math.min(followDistance, speed * delta) + (companion.knockbackY || 0) * delta,
        companion.radius,
      );
    }
    companion.knockbackX = (companion.knockbackX || 0) * Math.max(0, 1 - 5 * delta);
    companion.knockbackY = (companion.knockbackY || 0) * Math.max(0, 1 - 5 * delta);

    companion.attackCooldown = Math.max(0, companion.attackCooldown - delta);
    if (companion.type === "archer") {
      const range = personnel[0].range;
      const target = state.enemies
        .filter((enemy) => !enemy.destroyed && distanceBetween(companion.x, companion.y, enemy.x, enemy.y) < range)
        .filter((enemy) => hasLineOfSight(companion.x, companion.y, enemy.x, enemy.y))
        .sort((first, second) => distanceBetween(companion.x, companion.y, first.x, first.y) - distanceBetween(companion.x, companion.y, second.x, second.y))[0];
      if (!target || companion.attackCooldown > 0) continue;
      const angle = Math.atan2(target.y - companion.y, target.x - companion.x);
      companion.angle = angle;
      const speed = 420;
      const distance = distanceBetween(companion.x, companion.y, target.x, target.y);
      state.bullets.push(createBallisticProjectile({
        x: companion.x + Math.cos(angle) * 12,
        y: companion.y + Math.sin(angle) * 12,
        angle,
        speed,
        elevation: solveBallisticElevation(distance, speed),
        gravity: 420,
        range,
        owner: "ally",
        damage: personnel[0].damage,
        kind: "arrow",
      }));
      companion.attackCooldown = personnel[0].cooldown;
      playTone(390, 0.06, "sine", 0.01);
    } else {
      const target = state.enemies
        .filter((enemy) => !enemy.destroyed && distanceBetween(companion.x, companion.y, enemy.x, enemy.y) < enemy.radius + 28)
        .sort((first, second) => distanceBetween(companion.x, companion.y, first.x, first.y) - distanceBetween(companion.x, companion.y, second.x, second.y))[0];
      if (!target || companion.attackCooldown > 0) continue;
      const angle = Math.atan2(target.y - companion.y, target.x - companion.x);
      companion.angle = angle;
      addMeleeEffect(target.x, target.y, angle, "dagger-axe");
      damageEnemy(target, personnel[1].damage);
      burst(target.x, target.y, "#d9bb79");
      companion.attackCooldown = personnel[1].cooldown;
    }
  }
}

function damagePlayer(amount, sourceX, sourceY, isRanged = false) {
  if (player.invulnerable > 0) return;
  if (player.mode === "chariot" && isRanged
    && Math.random() < calculateChariotStats(campaign.equipment, campaign.horseCount).protection * 0.05) {
    burst(player.x, player.y, "#d7c68a");
    playTone(520, 0.06, "sine", 0.018);
    return;
  }
  const angle = Math.atan2(player.y - sourceY, player.x - sourceX);
  player.health = Math.max(0, player.health - amount);
  addBloodStain(state, () => campaign.random(), player.x, player.y, player.radius, player.health === 0);
  player.invulnerable = 1.05;
  state.damageFlash = 0.5;
  player.knockbackX += Math.cos(angle) * 100;
  player.knockbackY += Math.sin(angle) * 100;
  state.shake = Math.max(state.shake, 7);
  burst(player.x, player.y, "#d9a34f");
  playTone(95, 0.18, "triangle", 0.04);
  if (player.health === 0) {
    if (player.mode === "chariot") {
      burst(player.x, player.y, "#f0c46a");
      dismountPlayer();
    } else {
      updateHud();
      setMode("over");
      return;
    }
  }
  updateHud();
}

function damageCompanion(companion, amount, sourceX, sourceY) {
  if (companion.destroyed || companion.invulnerable > 0) return;
  companion.health = Math.max(0, companion.health - amount);
  addBloodStain(state, () => campaign.random(), companion.x, companion.y, companion.radius, companion.health === 0);
  companion.hitFlash = 0.2;
  companion.invulnerable = 0.55;
  const angle = Math.atan2(companion.y - sourceY, companion.x - sourceX);
  companion.knockbackX = (companion.knockbackX || 0) + Math.cos(angle) * 55;
  companion.knockbackY = (companion.knockbackY || 0) + Math.sin(angle) * 55;
  state.shake = Math.max(state.shake, 2);
  burst(companion.x, companion.y, "#d9a34f");
  if (companion.health === 0) {
    companion.destroyed = true;
    const member = campaign.roster.find((person) => person.id === companion.personnelId);
    if (member) member.alive = false;
    burst(companion.x, companion.y, "#8d4534");
  }
}

function update(delta) {
  state.elapsed += delta;
  player.swarmDamageCooldown = Math.max(0, player.swarmDamageCooldown - delta);
  readControls(delta);
  if (state.mode !== "running") return;
  if (keys.has(" ") || keys.has("Spacebar")) firePlayer();
  player.cooldown = Math.max(0, player.cooldown - delta);
  player.invulnerable = Math.max(0, player.invulnerable - delta);
  updateCrew(delta);
  if (player.mode === "foot") updateFootCompanions(delta);

  if (state.phase === "combat") state.spawnTimer -= delta;
  if (state.phase === "combat" && state.spawnTimer <= 0) {
    const nextFormation = formationPatterns[(state.formationsSpawned + state.wave - 1) % formationPatterns.length];
    if (state.enemies.length <= 28 - nextFormation.slots.length) spawnFormation();
    state.spawnTimer = Math.max(4.2, 7.2 - state.wave * 0.2);
  }

  updateProjectiles({
    state, world, player, delta, circleIntersectsObstacle, damageEnemy, damagePlayer, damageCompanion, burst,
  });
  if (state.mode === "over") return;

  updateUnits(delta);
  if (state.mode === "over") return;

  state.shake = Math.max(0, state.shake - 25 * delta);
  state.damageFlash = Math.max(0, (state.damageFlash || 0) - delta);
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

  const nextWave = Math.floor(state.score / 500) + 1;
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
  if (state.phase === "combat" && (state.bossStage ? state.bossDefeated : state.kills >= state.objectiveTarget)) beginExtraction();
  if (state.phase === "extract" && state.extractionPoint
    && distanceBetween(player.x, player.y, state.extractionPoint.x, state.extractionPoint.y) <= state.extractionPoint.radius) {
    enterShop();
  }
}

function frame(time) {
  const delta = Math.min((time - state.lastTime) / 1000 || 0, 0.05);
  state.lastTime = time;
  if (state.mode === "running") update(delta);
  draw();
  window.requestAnimationFrame(frame);
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
resetMission();
setMode("menu");
window.requestAnimationFrame((time) => {
  state.lastTime = time;
  window.requestAnimationFrame(frame);
});
