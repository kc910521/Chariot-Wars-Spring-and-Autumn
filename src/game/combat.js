import { calculateChariotStats, calculateProtectionChance, personnel } from "../data/equipment.js";
import { projectileRules } from "../data/rules.js";
import { soundBorrowed, soundCues } from "../data/sounds.js";
import { translate } from "../i18n/index.js";
import { distanceBetween } from "../utils/math.js";
import { selectAimTarget } from "./aim.js";
import { addBloodStain } from "./blood.js";
import { addCorpse } from "./corpses.js";

// The roster stores a role id, never a copy of the row: price, reach, damage and
// what the recruit shoots all live in one table (src/data/equipment.js). Looking the
// row up by id is the only way this module touches `personnel`, so a new recruit
// needs no code here.
const rowFor = (role) => personnel.find((person) => person.id === role);

// Player-side combat: chariot/foot attacks, crew, dismounted companions, and
// the damage model. Screen transitions are delegated through `onDefeat`, banner
// text through `announceBanner` and sound through `playSound`, so this module
// never touches the DOM or the audio device.
export function createCombatSystem({
  state, player, campaign, collision, projectiles,
  damageEnemy, addMeleeEffect, burst, playSound, updateHud,
  announceBanner, onDefeat,
  // Optional route planner for the dismounted crew's follow slot (see
  // src/game/pathfinding.js). Null keeps the straight line to the slot.
  paths = null,
}) {
  // Two releases share one button. While the button is down the bow is only
  // drawn: `state.fireHold` counts the draw and `state.fireHeld` remembers the
  // previous frame, so a release fires once and a stray release (a pause clearing
  // the keys, a touch cancelled by the platform) fires nothing. The sword is
  // exempt — it has no charge, so pressing it still swings exactly as before.
  function updatePlayerFire(delta, held) {
    if (player.mode === "foot") {
      // Dismounting mid-draw must not leave a charge behind for the HUD to show.
      state.fireHold = 0;
      state.fireHeld = false;
      if (held) firePlayer();
      return;
    }
    if (held) {
      state.fireHold += delta;
      state.fireHeld = true;
      return;
    }
    const released = state.fireHeld;
    const drawnFor = state.fireHold;
    state.fireHeld = false;
    state.fireHold = 0;
    if (!released) return;
    firePlayer(drawnFor >= projectileRules.playerVolley.holdSeconds ? "charged" : "tap");
  }

  function firePlayer(shot = "charged") {
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
      // A whiff and a connect have to sound different: the swing is the chariot's
      // own melee drop, the impact is the unit hit.
      playSound(target ? soundCues.hitByMelee : soundCues.chariotMelee);
      return;
    }
    const rules = projectileRules.playerVolley;
    if (shot === "tap") {
      const target = selectAimTarget({
        x: player.x,
        y: player.y,
        angle: player.angle,
        enemies: state.enemies,
        maxRange: rules.tapRange,
        coneCosine: rules.tapConeCosine,
        hasLineOfSight: collision.hasLineOfSight,
      });
      // An empty cone still shoots: the tap loses its helper, not the arrow.
      projectiles.firePlayerVolley(target ? { aimX: target.x, aimY: target.y } : {});
      player.cooldown = rules.tapCooldown;
      return;
    }
    projectiles.firePlayerVolley();
    player.cooldown = rules.chargedCooldown;
  }

  function updateCrew(delta) {
    if (player.mode === "foot") return;
    const members = campaign.roster.filter((member) => member.alive !== false);
    // The volley fan is measured over the shooters alone. `fireAllyShot` turns
    // `index`/`count` into a bearing offset, so counting the halberdiers in either
    // number pushes every shot off the target it actually aimed at. A shooter is any
    // row carrying a `projectile` - the same flag the line-of-sight filter and the
    // guard below use, so a new ranged recruit joins the fan without a code change.
    const shooters = members.filter((member) => rowFor(member.role)?.projectile);
    for (const member of members) {
      const config = rowFor(member.role);
      if (!config) continue;
      member.cooldown = Math.max(0, (member.cooldown ?? 0) - delta);
      if (member.cooldown > 0) continue;
      const target = state.enemies
        .filter((enemy) => !enemy.destroyed)
        .filter((enemy) => distanceBetween(player.x, player.y, enemy.x, enemy.y) <= config.range)
        .filter((enemy) => !config.projectile
          || collision.hasLineOfSight(player.x, player.y, enemy.x, enemy.y))
        .sort((first, second) => distanceBetween(player.x, player.y, first.x, first.y) - distanceBetween(player.x, player.y, second.x, second.y))[0];
      if (!target) continue;

      if (config.projectile) {
        projectiles.fireAllyShot({
          x: player.x,
          y: player.y,
          targetX: target.x,
          targetY: target.y,
          originOffset: projectileRules.allyArrow.crewOriginOffset,
          range: projectileRules.allyArrow.crewRange,
          // The firing member's own row. `personnel[0]` only happens to be the
          // archer row, so it tied crew damage to the order of the roster table.
          damage: config.damage,
          // The row's own shot: a bolt passes through one extra body and an arrow
          // stops on the first, and both arcs come from the same data table.
          kind: config.projectile,
          // `indexOf` rather than a firing counter: a shooter waiting on cooldown
          // must not shift the lanes of the ones that do fire.
          index: shooters.indexOf(member),
          count: shooters.length,
        });
      } else {
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
    player.type = "ge";
    player.radius = 18;
    player.maxHealth = 35;
    player.health = player.maxHealth;
    player.speed = 0;
    player.maxSpeed = 78;
    player.invulnerable = 1.8;
    player.knockbackX = 0;
    player.knockbackY = 0;
    player.cooldown = 0.5;
    state.footCompanions = [];
    const roster = campaign.roster.filter((member) => member.alive !== false);
    for (let index = 0; index < roster.length; index += 1) {
      const member = roster[index];
      const config = rowFor(member.role);
      if (!config) continue;
      // Two different questions: `projectile` is what the companion carries (and
      // whether it shoots at all), `footType` is the silhouette it walks as. They
      // used to be one `role === "archer"` test, which painted a crossbowman green
      // and handed him a bow.
      const ranged = Boolean(config.projectile);
      state.footCompanions.push({
        type: config.footType ?? "ge",
        x: player.x - Math.cos(player.angle) * (44 + Math.floor(index / 2) * 22)
          + Math.sin(player.angle) * ((index % 2 === 0 ? -1 : 1) * (20 + Math.floor(index / 2) * 10)),
        y: player.y - Math.sin(player.angle) * (44 + Math.floor(index / 2) * 22)
          - Math.cos(player.angle) * ((index % 2 === 0 ? -1 : 1) * (20 + Math.floor(index / 2) * 10)),
        radius: 10,
        angle: player.angle,
        color: ranged ? "#398b63" : "#b28b4d",
        // What it looses when it shoots: null for a melee body.
        projectile: config.projectile ?? null,
        // What it holds: the row's own kit, so a dismounted crossbowman walks to
        // the line with a crossbow and not with the default sword.
        visual: { overlays: config.overlays ?? ["sword"] },
        health: config.health,
        maxHealth: config.health,
        // Snapshotted like health: the dismounted companion fights on its own row's
        // numbers instead of reaching back into the table by array position.
        damage: config.damage,
        range: config.range,
        cooldown: config.cooldown,
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
    announceBanner({
      titleText: translate("battle.dismounted"),
      subtitleText: translate("battle.crewFollow", { count: roster.length }),
      duration: 4.5,
      cue: soundCues.chariotExit,
    });
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
        // The slot is where the companion is going; the step may head for a
        // waypoint instead when a tree or a wall stands between the two. The cap
        // below still measures the real slot, so a detour never looks like arrival.
        const point = paths === null ? null : paths.waypoint(companion, followX, followY);
        const headingX = point === null ? followX : point.x;
        const headingY = point === null ? followY : point.y;
        const followAngle = Math.atan2(headingY - companion.y, headingX - companion.x);
        const speed = companion.projectile ? 112 : 122;
        collision.moveEntitySafely(
          companion,
          Math.cos(followAngle) * Math.min(followDistance, speed * delta) + (companion.knockbackX || 0) * delta,
          Math.sin(followAngle) * Math.min(followDistance, speed * delta) + (companion.knockbackY || 0) * delta,
          companion.radius,
        );
      }
      companion.knockbackX = (companion.knockbackX || 0) * Math.max(0, 1 - 5 * delta);
      companion.knockbackY = (companion.knockbackY || 0) * Math.max(0, 1 - 5 * delta);

      companion.attackCooldown = Math.max(0, companion.attackCooldown - delta);
      // The reload is checked before the scan, not after it: a dismounted archer
      // used to walk a line of sight to every enemy in range on every frame and
      // then throw the answer away because the bow was still reloading. That was
      // the whole steady cost of the foot phase.
      if (companion.attackCooldown > 0) continue;
      if (companion.projectile) {
        const range = companion.range;
        const target = state.enemies
          .filter((enemy) => !enemy.destroyed && distanceBetween(companion.x, companion.y, enemy.x, enemy.y) < range)
          .filter((enemy) => collision.hasLineOfSight(companion.x, companion.y, enemy.x, enemy.y))
          .sort((first, second) => distanceBetween(companion.x, companion.y, first.x, first.y) - distanceBetween(companion.x, companion.y, second.x, second.y))[0];
        if (!target) continue;
        companion.angle = Math.atan2(target.y - companion.y, target.x - companion.x);
        projectiles.fireAllyShot({
          x: companion.x,
          y: companion.y,
          targetX: target.x,
          targetY: target.y,
          originOffset: projectileRules.allyArrow.footOriginOffset,
          range,
          damage: companion.damage,
          // A dismounted crossbowman still looses bolts: the row that decided the
          // body also decides the shot.
          kind: companion.projectile,
        });
        companion.attackCooldown = companion.cooldown;
      } else {
        const target = state.enemies
          .filter((enemy) => !enemy.destroyed && distanceBetween(companion.x, companion.y, enemy.x, enemy.y) < enemy.radius + 28)
          .sort((first, second) => distanceBetween(companion.x, companion.y, first.x, first.y) - distanceBetween(companion.x, companion.y, second.x, second.y))[0];
        if (!target) continue;
        const angle = Math.atan2(target.y - companion.y, target.x - companion.x);
        companion.angle = angle;
        addMeleeEffect(target.x, target.y, angle, "dagger-axe");
        damageEnemy(target, companion.damage);
        burst(target.x, target.y, "#d9bb79");
        companion.attackCooldown = companion.cooldown;
      }
    }
  }

  function damagePlayer(amount, sourceX, sourceY, isRanged = false) {
    if (player.invulnerable > 0) return;
    if (player.mode === "chariot" && isRanged
      && campaign.random() < calculateProtectionChance(calculateChariotStats(campaign.equipment, campaign.horseCount))) {
      burst(player.x, player.y, "#d7c68a");
      // A deflected shot is a shield taking the arrow, not the hull.
      playSound(soundBorrowed.playerBlocked);
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
    // What the player is riding decides the cue. The crash is the chariot's own
    // hull - almost three seconds of splintering timber - and it is wrong twice
    // over for a champion on foot: there is no hull, and a 3s cue outlives the
    // 1.05s of invulnerability that follows it. On foot the hit gets one short
    // impact instead, thin for an arrow and blunt for a blade.
    if (player.mode === "chariot") playSound(soundCues.chariotCrash);
    else playSound(isRanged ? soundCues.arrowHit : soundCues.hitByMelee);
    if (player.health === 0) {
      if (player.mode === "chariot") {
        burst(player.x, player.y, "#f0c46a");
        dismountPlayer();
      } else {
        playSound(soundBorrowed.playerDied);
        updateHud();
        onDefeat();
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
      // A buried companion is still a body on the ground, drawn from the same
      // snapshot list as an enemy's - the roster is what forgets him, not the field.
      addCorpse(state, companion);
    }
  }

  return {
    firePlayer, updatePlayerFire, updateCrew, updateFootCompanions,
    damagePlayer, damageCompanion, dismountPlayer,
  };
}

