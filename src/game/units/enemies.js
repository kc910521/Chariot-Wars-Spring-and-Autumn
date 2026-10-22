import { addBloodStain } from "../blood.js";
import { effectRules } from "../../data/rules.js";

function getChariotTravelSpeed(player) {
  return Math.abs(player.speed);
}

export function createEnemies({
  bossTypes, enemyStats, formationPatterns, state, player, world, random,
  circleIntersectsObstacle, moveEntitySafely, getChariotCollisionDamage, playTone, updateHud,
  hasLineOfSight, fireEnemy, damagePlayer, damageCompanion,
}) {
  // `random` is late-bound by the caller so every gameplay roll (and the
  // particle spray) draws from the PRNG of the battle in progress, keeping a
  // battle reproducible from its seed.

  function dropLoot(enemy) {
    const roll = random();
    const type = roll < 0.62 ? "coin" : roll < 0.9 ? "silver" : "gold";
    const values = { coin: 8 + Math.floor(random() * 8), silver: 22 + Math.floor(random() * 16), gold: 55 + Math.floor(random() * 31) };
    state.drops.push({
      x: enemy.x + (random() - 0.5) * 24,
      y: enemy.y + (random() - 0.5) * 24,
      type,
      value: values[type],
      life: 30,
      phase: random() * Math.PI * 2,
    });
  }

  function resolveInfantryCollision(enemy) {
    if (enemy.destroyed || enemy.type === "chariot" || enemy.type === "chariot-archer") return;
    if (enemy.boss) return;
    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;
    const distance = Math.hypot(dx, dy);
    const touchDistance = player.radius + enemy.radius;
    if (distance >= touchDistance) return;

    const nx = distance > 0 ? dx / distance : Math.cos(player.angle);
    const ny = distance > 0 ? dy / distance : Math.sin(player.angle);
    const overlap = touchDistance - distance;
    moveEntitySafely(enemy, nx * (overlap + 2), ny * (overlap + 2), enemy.radius);
    if (player.mode === "foot") {
      enemy.contactCooldown = Math.max(enemy.contactCooldown, 0.4);
      return;
    }
    player.knockbackX -= nx * 42;
    player.knockbackY -= ny * 42;

    const travelSpeed = getChariotTravelSpeed(player);
    const facingDot = Math.cos(player.angle) * nx + Math.sin(player.angle) * ny;
    const charging = player.mode === "chariot" && travelSpeed > 65 && facingDot > 0.35;
    if (enemy.contactCooldown > 0 || enemy.knockedDown > 0) return;

    if (charging) {
      damageEnemy(enemy, getChariotCollisionDamage(), "ram");
      enemy.contactCooldown = 0.5;
      if (!enemy.destroyed) enemy.knockedDown = Math.max(enemy.knockedDown, 1.8);
      state.shake = Math.max(state.shake, 2.5);
      addMeleeEffect(enemy.x, enemy.y, player.angle, "ram");
      burst(enemy.x, enemy.y, "#ffe08a");
    } else if (travelSpeed > 20) {
      enemy.knockedDown = 1.8;
      enemy.contactCooldown = Math.max(enemy.contactCooldown, 0.55);
      state.shake = Math.max(state.shake, 1.4);
      burst(enemy.x, enemy.y, "#d0ad72");
      burst((player.x + enemy.x) / 2, (player.y + enemy.y) / 2, "#d0ad72");
    } else {
      enemy.contactCooldown = 0.3;
      state.shake = Math.max(state.shake, 0.8);
      burst((player.x + enemy.x) / 2, (player.y + enemy.y) / 2, "#d0ad72");
    }

    if (charging && player.invulnerable === 0 && player.swarmDamageCooldown <= 0) {
      const crowdSize = state.enemies.filter((unit) => !unit.destroyed && !unit.boss
        && unit.type !== "chariot" && unit.type !== "chariot-archer"
        && Math.hypot(unit.x - player.x, unit.y - player.y) < player.radius + unit.radius + 24).length;
      if (crowdSize >= 4) {
        const counterDamage = Math.max(1, crowdSize - 3);
        player.swarmDamageCooldown = 1.15;
        damagePlayer(counterDamage, enemy.x, enemy.y);
        addMeleeEffect(player.x, player.y, Math.atan2(enemy.y - player.y, enemy.x - player.x), "sword");
      }
    }
  }

  function spawnFormation() {
    const pattern = formationPatterns[(state.formationsSpawned + state.wave - 1) % formationPatterns.length];
    const formationId = state.elapsed + random();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const heading = random() * Math.PI * 2;
      const distance = 390 + random() * 170;
      const centerX = Math.max(130, Math.min(world.width - 130, player.x + Math.cos(heading) * distance));
      const centerY = Math.max(130, Math.min(world.height - 130, player.y + Math.sin(heading) * distance));
      const slotCoordinates = pattern.slots.map(([, slotX, slotY]) => ({
        x: centerX + slotX * Math.cos(heading) - slotY * Math.sin(heading),
        y: centerY + slotX * Math.sin(heading) + slotY * Math.cos(heading),
      }));
      if (slotCoordinates.some((slot) => circleIntersectsObstacle(slot.x, slot.y, 20))) continue;
      if (slotCoordinates.some((slot) => Math.hypot(slot.x - player.x, slot.y - player.y) < 310)) continue;

      const formation = {
        id: formationId,
        nameKey: pattern.nameKey,
        x: centerX,
        y: centerY,
        heading,
        halfWidth: Math.max(...pattern.slots.map(([, slotX]) => Math.abs(slotX))) + 34,
        halfHeight: Math.max(...pattern.slots.map(([, , slotY]) => Math.abs(slotY))) + 34,
        color: "#a74732",
      };
      state.formations.push(formation);
      state.formationsSpawned += 1;
      for (const [index, [type, slotX, slotY]] of pattern.slots.entries()) {
        const slot = slotCoordinates[index];
        const stats = { ...enemyStats[type] };
        state.enemies.push({
          ...stats,
          type,
          maxHealth: stats.health,
          x: slot.x,
          y: slot.y,
          angle: heading,
          homeX: slot.x,
          homeY: slot.y,
          formationId,
          seesPlayer: false,
          lastSeenX: slot.x,
          lastSeenY: slot.y,
          investigateTimer: 0,
          shotCooldown: 0.8 + random() * 1.5,
          thinkTimer: random() * 2,
          wanderAngle: heading,
          hitFlash: 0,
          contactCooldown: 0,
          attackCooldown: 0.8 + random() * 0.8,
          knockedDown: 0,
        });
      }
      return;
    }
  }

  function spawnBoss() {
    const boss = bossTypes[Math.floor(random() * bossTypes.length)];
    let position;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const angle = random() * Math.PI * 2;
      const distance = 500 + random() * 150;
      const x = Math.max(boss.radius + 20, Math.min(world.width - boss.radius - 20, player.x + Math.cos(angle) * distance));
      const y = Math.max(boss.radius + 20, Math.min(world.height - boss.radius - 20, player.y + Math.sin(angle) * distance));
      if (!circleIntersectsObstacle(x, y, boss.radius + 8)) {
        position = { x, y };
        break;
      }
    }
    if (!position) {
      throw new Error(`Unable to place boss "${boss.nameKey}" on this battlefield.`);
    }

    state.boss = {
      ...boss,
      boss: true,
      maxHealth: boss.health,
      x: position.x,
      y: position.y,
      angle: Math.atan2(player.y - position.y, player.x - position.x),
      homeX: position.x,
      homeY: position.y,
      seesPlayer: false,
      lastSeenX: player.x,
      lastSeenY: player.y,
      investigateTimer: 0,
      shotCooldown: 2,
      attackCooldown: 2.2,
      contactCooldown: 0,
      hitFlash: 0,
      knockedDown: 0,
    };
    state.enemies.push(state.boss);
  }

  function burst(x, y, color) {
    for (let index = 0; index < 9; index += 1) {
      const angle = random() * Math.PI * 2;
      const speed = 35 + random() * 115;
      state.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.2 + random() * 0.32,
        color,
      });
    }
  }

  function dust(x, y) {
    const rules = effectRules.dust;
    // One flattened ring sells the "something hit the ground here" beat, the
    // squares around it are the loose soil kicked up by the impact.
    state.particles.push({
      kind: "ring",
      x,
      y,
      vx: 0,
      vy: 0,
      size: rules.ring.radius,
      growth: rules.ring.growth,
      life: rules.ring.life,
      maxLife: rules.ring.life,
      color: rules.ring.color,
    });
    for (let index = 0; index < rules.count; index += 1) {
      const angle = random() * Math.PI * 2;
      const speed = 14 + random() * rules.spread;
      const life = rules.lifeMin + random() * (rules.lifeMax - rules.lifeMin);
      // Dust climbs instead of falling: it hangs in the air long enough to be
      // noticed against the pale grass.
      const rise = rules.riseMin + random() * (rules.riseMax - rules.riseMin);
      state.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.25 - rise,
        life,
        maxLife: life,
        size: rules.sizeMin + random() * (rules.sizeMax - rules.sizeMin),
        color: rules.colors[Math.floor(random() * rules.colors.length)],
      });
    }
  }

  function addMeleeEffect(x, y, angle, weapon) {
    const colors = {
      sword: "#f1dfb2",
      spike: "#d6ad62",
      ram: "#fff0a1",
      "dagger-axe": "#c97951",
      claw: "#df6947",
      stomp: "#e7bf69",
    };
    state.meleeEffects.push({
      x,
      y,
      angle,
      weapon,
      color: colors[weapon],
      life: weapon === "ram" ? 0.4 : 0.28,
      duration: weapon === "ram" ? 0.4 : 0.28,
    });
  }

  function damageEnemy(enemy, amount, source = "weapon") {
    if (enemy.destroyed) return;
    if (source === "ram" && enemy.collisionDamage === false) return;
    enemy.health -= amount;
    enemy.hitFlash = 0.16;
    addBloodStain(state, random, enemy.x, enemy.y, enemy.radius, enemy.boss || enemy.health <= 0);
    if (enemy.health <= 0) {
      enemy.destroyed = true;
      state.score += enemy.boss ? 1200 : enemy.type === "chariot" ? 180 : enemy.type === "archer" ? 120 : 100;
      state.kills += 1;
      if (enemy.boss) state.bossDefeated = true;
      dropLoot(enemy);
      burst(enemy.x, enemy.y, enemy.boss ? "#d9a34f" : enemy.type === "chariot" ? "#db9d55" : "#a74732");
      playTone(125, 0.12, "triangle", 0.03);
    } else {
      burst(enemy.x, enemy.y, "#e6c88d");
    }
    if (enemy.boss) updateHud();
  }

  function getCombatTarget(enemy) {
    if (player.mode !== "foot") return player;
    return [player, ...state.footCompanions]
      .filter((target) => !target.destroyed && target.health > 0)
      .sort((first, second) =>
        Math.hypot(first.x - enemy.x, first.y - enemy.y) - Math.hypot(second.x - enemy.x, second.y - enemy.y))[0] ?? player;
  }

  function damageCombatTarget(target, amount, sourceX, sourceY) {
    if (target === player) damagePlayer(amount, sourceX, sourceY);
    else damageCompanion(target, amount, sourceX, sourceY);
  }

  function updateUnits(delta) {
    for (const enemy of state.enemies) {
      if (enemy.destroyed) continue;
      enemy.knockedDown = Math.max(0, enemy.knockedDown - delta);
      enemy.attackCooldown = Math.max(0, enemy.attackCooldown - delta);
      if (enemy.knockedDown > 0) {
        resolveInfantryCollision(enemy);
        continue;
      }
      const target = getCombatTarget(enemy);
      const distance = Math.hypot(target.x - enemy.x, target.y - enemy.y);
      const seesTarget = distance < (enemy.boss ? 900 : enemy.ranged ? 620 : 450)
        && hasLineOfSight(enemy.x, enemy.y, target.x, target.y);
      enemy.seesPlayer = seesTarget;
      enemy.shotCooldown = Math.max(0, enemy.shotCooldown - delta);
      enemy.hitFlash = Math.max(0, enemy.hitFlash - delta);
      enemy.contactCooldown = Math.max(0, enemy.contactCooldown - delta);

      if (seesTarget) {
        enemy.lastSeenX = target.x;
        enemy.lastSeenY = target.y;
        enemy.investigateTimer = 1.8;
        const angle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
        enemy.angle = angle;
        if (enemy.boss && enemy.type === "elephant") {
          if (distance > enemy.range) {
            moveEntitySafely(enemy, Math.cos(angle) * enemy.speed * delta, Math.sin(angle) * enemy.speed * delta, enemy.radius);
          } else if (enemy.attackCooldown === 0) {
            enemy.attackCooldown = 2.2;
            addMeleeEffect(target.x, target.y, angle, "stomp");
            damageCombatTarget(target, enemy.damage, enemy.x, enemy.y);
            if (state.mode === "over") return;
          }
        } else if (enemy.boss && enemy.type === "lion") {
          if (distance > enemy.range) {
            moveEntitySafely(enemy, Math.cos(angle) * enemy.speed * delta, Math.sin(angle) * enemy.speed * delta, enemy.radius);
          } else if (enemy.attackCooldown === 0) {
            enemy.attackCooldown = 1.05;
            addMeleeEffect(target.x, target.y, angle, "claw");
            damageCombatTarget(target, enemy.damage, enemy.x, enemy.y);
            if (state.mode === "over") return;
          }
        } else if (enemy.boss && enemy.type === "catapult") {
          if (distance < 260) {
            moveEntitySafely(enemy, -Math.cos(angle) * enemy.speed * delta, -Math.sin(angle) * enemy.speed * delta, enemy.radius);
          } else if (distance > 420) {
            moveEntitySafely(enemy, Math.cos(angle) * enemy.speed * delta, Math.sin(angle) * enemy.speed * delta, enemy.radius);
          }
          if (distance < enemy.range && enemy.shotCooldown === 0) fireEnemy(enemy, angle, target);
        } else if (enemy.ranged) {
          if (distance < 210) {
            moveEntitySafely(enemy, -Math.cos(angle) * enemy.speed * delta, -Math.sin(angle) * enemy.speed * delta, enemy.radius);
          }
          if (distance < enemy.range && distance > 120 && enemy.shotCooldown === 0) fireEnemy(enemy, angle, target);
        } else if (!enemy.boss && enemy.type !== "chariot" && enemy.formationId !== undefined
          && player.mode !== "foot") {
          const rangedFriends = state.enemies.filter((unit) => !unit.destroyed && unit.ranged
            && unit.formationId === enemy.formationId);
          const protectedUnit = rangedFriends.sort((first, second) =>
            Math.hypot(first.x - enemy.x, first.y - enemy.y) - Math.hypot(second.x - enemy.x, second.y - enemy.y))[0];
          if (protectedUnit) {
            const playerDirection = Math.atan2(player.y - protectedUnit.y, player.x - protectedUnit.x);
            const lateralOffset = Math.max(-52, Math.min(52, (enemy.homeX - protectedUnit.homeX) * 0.45));
            const guardX = protectedUnit.x + Math.cos(playerDirection) * 92 - Math.sin(playerDirection) * lateralOffset;
            const guardY = protectedUnit.y + Math.sin(playerDirection) * 92 + Math.cos(playerDirection) * lateralOffset;
            const guardDistance = Math.hypot(guardX - enemy.x, guardY - enemy.y);
            if (guardDistance > 24) {
              const guardAngle = Math.atan2(guardY - enemy.y, guardX - enemy.x);
              enemy.angle = guardAngle;
              moveEntitySafely(enemy, Math.cos(guardAngle) * enemy.speed * delta, Math.sin(guardAngle) * enemy.speed * delta, enemy.radius);
            } else if (distance <= enemy.range && enemy.attackCooldown === 0) {
              const weapon = enemy.type === "ge" ? "dagger-axe" : "sword";
              enemy.attackCooldown = enemy.type === "ge" ? 1.4 : 1.15;
              addMeleeEffect(target.x, target.y, angle, weapon);
              damageCombatTarget(target, enemy.damage, enemy.x, enemy.y);
              if (state.mode === "over") return;
            }
          } else {
            const attackDistance = Math.max(enemy.range, enemy.radius + target.radius + 2);
            const stopDistance = enemy.isEngaged ? attackDistance + 20 : attackDistance;
            if (distance > stopDistance) {
              enemy.isEngaged = false;
              moveEntitySafely(enemy, Math.cos(angle) * enemy.speed * delta, Math.sin(angle) * enemy.speed * delta, enemy.radius);
            } else {
              enemy.isEngaged = true;
              if (distance <= attackDistance && enemy.attackCooldown === 0) {
                const weapon = enemy.type === "ge" ? "dagger-axe" : "sword";
                enemy.attackCooldown = enemy.type === "ge" ? 1.4 : 1.15;
                addMeleeEffect(target.x, target.y, angle, weapon);
                damageCombatTarget(target, enemy.damage, enemy.x, enemy.y);
                if (state.mode === "over") return;
              }
            }
          }
        } else if (enemy.type === "chariot") {
          if (distance > enemy.radius + target.radius + 2) {
            moveEntitySafely(enemy, Math.cos(angle) * enemy.speed * delta, Math.sin(angle) * enemy.speed * delta, enemy.radius);
          } else if (enemy.contactCooldown === 0) {
            enemy.contactCooldown = 1.45;
            addMeleeEffect(target.x, target.y, angle, "ram");
            burst(target.x, target.y, "#ffe08a");
            if (target === player && getChariotTravelSpeed(player) > 65) damageEnemy(enemy, 1);
            damageCombatTarget(target, enemy.damage, enemy.x, enemy.y);
            if (state.mode === "over") return;
          }
        } else if (distance > enemy.range) {
          moveEntitySafely(enemy, Math.cos(angle) * enemy.speed * delta, Math.sin(angle) * enemy.speed * delta, enemy.radius);
        } else if (enemy.attackCooldown === 0) {
          const weapon = enemy.type === "ge" ? "dagger-axe" : "sword";
          enemy.attackCooldown = enemy.type === "ge" ? 1.4 : 1.15;
          addMeleeEffect(target.x, target.y, angle, weapon);
          damageCombatTarget(target, enemy.damage, enemy.x, enemy.y);
          if (state.mode === "over") return;
        }
      } else if (enemy.investigateTimer > 0) {
        enemy.investigateTimer = Math.max(0, enemy.investigateTimer - delta);
        if (!enemy.ranged) {
          const angle = Math.atan2(enemy.lastSeenY - enemy.y, enemy.lastSeenX - enemy.x);
          enemy.angle = angle;
          if (Math.hypot(enemy.lastSeenX - enemy.x, enemy.lastSeenY - enemy.y) > 34) {
            moveEntitySafely(enemy, Math.cos(angle) * enemy.speed * 0.62 * delta, Math.sin(angle) * enemy.speed * 0.62 * delta, enemy.radius);
          }
        }
      } else {
        const homeDistance = Math.hypot(enemy.homeX - enemy.x, enemy.homeY - enemy.y);
        if (homeDistance > 8) {
          const angle = Math.atan2(enemy.homeY - enemy.y, enemy.homeX - enemy.x);
          enemy.angle = angle;
          moveEntitySafely(enemy, Math.cos(angle) * enemy.speed * 0.55 * delta, Math.sin(angle) * enemy.speed * 0.55 * delta, enemy.radius);
        } else {
          enemy.thinkTimer -= delta;
          if (enemy.thinkTimer <= 0) {
            enemy.thinkTimer = 1.7 + random() * 2;
            enemy.wanderAngle += (random() - 0.5) * 0.65;
          }
          enemy.angle = enemy.wanderAngle;
        }
      }
      resolveInfantryCollision(enemy);
    }
  }

  return { resolveInfantryCollision, spawnFormation, spawnBoss, burst, dust, addMeleeEffect, damageEnemy, updateUnits };
}
