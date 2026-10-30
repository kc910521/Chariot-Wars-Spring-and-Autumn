import { translate } from "../i18n/index.js";
import { calculateChariotKit } from "../data/equipment.js";
import { formationAura, formationOrders } from "../data/formations.js";
import { effectRules } from "../data/rules.js";
import { cloudDrift, elementCullMargin } from "../game/elements.js";
import { createElementRenderer } from "./elements.js";
import { createGroundPainter } from "./ground.js";
import { createSpriteArt, spritePalette } from "./sprites.js";

export function createRenderer({
  canvas, context, view, camera, world, player, state,
  getObstacles, getTerrain, getClouds, getHorseCount, getRoster,
  // Optional so a harness can build a renderer with no campaign behind it: the
  // chassis then falls back to the stock rig and the field shows no stumps.
  getEquipment = () => null, getStumps = () => [],
}) {
  // Obstacles, terrain patches and clouds are catalog art (src/render/elements.js):
  // the renderer keeps the camera and the culling, the element layer keeps the
  // silhouettes and their palettes.
  const elements = createElementRenderer({ context });
  // The floor under all of it: soil, a little grass and shade, and no grid
  // (src/render/ground.js). It is the only painter that talks about the world at
  // large, so it takes the camera rect and nothing else.
  const ground = createGroundPainter({ context });

  function roundedRect(x, y, width, height, radius) {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    context.fill();
  }
  // Unit silhouettes (chariot rig, foot figure) and their overlay kit are
  // battlefield art shared with the shop preview and the camp scene:
  // src/render/sprites.js is the only copy, this factory is the only binding.
  const sprites = createSpriteArt({ context });

  function drawCombatant(unit, isPlayer = false, isAlly = false) {
    if (unit.destroyed) return;
    const knockedDown = !isPlayer && unit.knockedDown > 0;
    context.save();
    context.translate(unit.x, unit.y);
    context.rotate(unit.angle + (knockedDown ? Math.PI / 2 : 0));
    if (knockedDown) context.scale(1.25, 0.55);
    else {
      // The player is not a data row, so both he and any unit without a
      // descriptor keep the pre-dispatch scale the art was tuned at.
      const scale = unit.visual?.scale ?? (isPlayer ? 1.2 : 1.3);
      context.scale(scale, scale);
    }

    const shadow = context.createRadialGradient(0, 8, 1, 0, 8, unit.radius * 1.2);
    shadow.addColorStop(0, "rgba(35, 29, 21, 0.3)");
    shadow.addColorStop(0.58, "rgba(35, 29, 21, 0.14)");
    shadow.addColorStop(1, "rgba(35, 29, 21, 0)");
    context.fillStyle = shadow;
    context.beginPath();
    context.ellipse(0, 8, (unit.radius || 14) * 1.25, (unit.radius || 14) * 0.82, 0, 0, Math.PI * 2);
    context.fill();

    // The formation aura's heal, drawn under the body so it never hides the
    // silhouette: a pulse that fades over the same `formationAura.flash` as the
    // banner. A friendly ring mends the player as well as the line it belongs to,
    // so his body takes the same green; an enemy line's beat is amber, and the
    // player standing in one is a trespasser, not a patient.
    if (unit.healFlash > 0) {
      const glow = Math.min(1, unit.healFlash / formationAura.flash);
      context.fillStyle = isAlly || isPlayer
        ? `rgba(126, 233, 152, ${0.34 * glow})`
        : `rgba(232, 166, 105, ${0.3 * glow})`;
      context.beginPath();
      context.arc(0, 0, (unit.radius || 14) + 6, 0, Math.PI * 2);
      context.fill();
    }

    // Which silhouette to draw is the row's `visual.kind`, so a new unit type
    // chooses its art in the data table instead of by editing this chain. The
    // player has no row: he rides the chariot art while mounted, walks otherwise.
    const kind = unit.visual?.kind ?? (isPlayer && player.mode !== "foot" ? "chariot" : "foot");
    if (kind === "elephant") {
      context.fillStyle = "rgba(44, 32, 21, 0.3)";
      context.beginPath();
      context.ellipse(0, 11, 43, 31, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#493e34";
      for (const legX of [-24, 23]) {
        for (const legY of [-19, 19]) {
          context.fillRect(legX - 7, legY, 14, 27);
        }
      }
      context.fillStyle = unit.hitFlash > 0 ? "#d0b895" : unit.visual.robe;
      context.beginPath();
      context.ellipse(0, 0, 36, 27, 0, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.ellipse(27, -2, 19, 16, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#9a7950";
      context.beginPath();
      context.ellipse(23, -18, 11, 15, -0.35, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#eee0b8";
      context.lineWidth = 4;
      for (const side of [-1, 1]) {
        context.beginPath();
        context.moveTo(38, side * 6);
        context.quadraticCurveTo(52, side * 12, 46, side * 19);
        context.stroke();
      }
      context.strokeStyle = "#493e34";
      context.lineWidth = 7;
      context.beginPath();
      context.moveTo(40, 3);
      context.quadraticCurveTo(52, 13, 43, 23);
      context.stroke();
      context.fillStyle = "#e7cf9a";
      context.beginPath();
      context.arc(33, -6, 2.5, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#704332";
      roundedRect(-8, -13, 25, 22, 3);
      context.strokeStyle = "#d0b06e";
      context.lineWidth = 2;
      context.strokeRect(-8, -13, 25, 22);
    } else if (kind === "lion") {
      context.fillStyle = "rgba(44, 32, 21, 0.3)";
      context.beginPath();
      context.ellipse(2, 10, 40, 24, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#764629";
      for (const legX of [-22, 18]) {
        for (const legY of [-15, 15]) context.fillRect(legX, legY, 9, 23);
      }
      context.fillStyle = unit.hitFlash > 0 ? "#e6c59a" : unit.visual.robe;
      context.beginPath();
      context.ellipse(0, 0, 34, 22, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#d29a4b";
      context.beginPath();
      context.arc(25, -1, 21, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#b86d35";
      context.beginPath();
      context.arc(29, -2, 12, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#d6b47c";
      context.beginPath();
      context.ellipse(43, 0, 10, 8, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#33291f";
      context.beginPath();
      context.arc(34, -8, 2.5, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#29251f";
      context.beginPath();
      context.arc(-5, -5, 7, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#c3a367";
      context.fillRect(-10, -10, 13, 3);
      context.fillStyle = "#e0bd7c";
      context.fillRect(-6, -2, 3, 8);
      context.strokeStyle = "#58402c";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(-25, -4);
      context.lineTo(-38, -11);
      context.stroke();
    } else if (kind === "tiger") {
      // A smaller, hotter cat than the lion above: the wild animal of the
      // tutorial (src/data/wilds.js) reads as the same family at two-thirds the
      // size, striped where the boss is maned. Same local frame as every other
      // silhouette: +X is forward, so the head sits ahead of the shoulder.
      context.fillStyle = "rgba(44, 32, 21, 0.3)";
      context.beginPath();
      context.ellipse(2, 8, 27, 16, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#8a4a22";
      for (const legX of [-15, 12]) {
        for (const legY of [-10, 10]) context.fillRect(legX, legY, 6, 15);
      }
      context.fillStyle = unit.hitFlash > 0 ? "#f0d2a4" : unit.visual.robe;
      context.beginPath();
      context.ellipse(0, 0, 23, 15, 0, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.arc(18, -1, 13, 0, Math.PI * 2);
      context.fill();
      // Ears, muzzle, then the stripes over crown and flank.
      context.beginPath();
      context.moveTo(10, -11);
      context.lineTo(13, -19);
      context.lineTo(19, -12);
      context.closePath();
      context.fill();
      context.beginPath();
      context.moveTo(19, -12);
      context.lineTo(24, -20);
      context.lineTo(27, -10);
      context.closePath();
      context.fill();
      context.fillStyle = "#e5cba1";
      context.beginPath();
      context.ellipse(28, 2, 6.5, 5, 0, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#3b2416";
      context.lineWidth = 2;
      for (const stripeX of [-15, -7, 1, 9]) {
        context.beginPath();
        context.moveTo(stripeX, -12);
        context.lineTo(stripeX - 3, 2);
        context.stroke();
      }
      context.beginPath();
      context.moveTo(14, -8);
      context.lineTo(18, -4);
      context.stroke();
      context.beginPath();
      context.moveTo(20, -10);
      context.lineTo(23, -5);
      context.stroke();
      context.fillStyle = "#2b2118";
      context.beginPath();
      context.arc(22, -5, 1.8, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#8a4a22";
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(-22, -2);
      context.quadraticCurveTo(-34, -7, -29, -18);
      context.stroke();
    } else if (kind === "catapult") {
      context.fillStyle = "rgba(44, 32, 21, 0.3)";
      context.beginPath();
      context.ellipse(0, 12, 42, 28, 0, 0, Math.PI * 2);
      context.fill();
      for (const wheelY of [-27, 27]) {
        context.fillStyle = "#3d3025";
        context.beginPath();
        context.arc(-11, wheelY, 13, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "#c9a861";
        context.lineWidth = 3;
        context.stroke();
        context.beginPath();
        context.moveTo(-19, wheelY);
        context.lineTo(-3, wheelY);
        context.moveTo(-11, wheelY - 8);
        context.lineTo(-11, wheelY + 8);
        context.stroke();
      }
      context.fillStyle = "#75583a";
      roundedRect(-30, -19, 48, 38, 5);
      context.strokeStyle = "#d0b06e";
      context.lineWidth = 3;
      context.strokeRect(-30, -19, 48, 38);
      context.strokeStyle = "#4b3827";
      context.lineWidth = 8;
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(37, -3);
      context.stroke();
      context.strokeStyle = "#bb8b4c";
      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(1, 0);
      context.lineTo(35, -3);
      context.stroke();
      context.fillStyle = "#514132";
      context.beginPath();
      context.arc(38, -4, 11, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#2e2923";
      context.beginPath();
      context.arc(31, 11, 5, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#c8a36b";
      context.fillRect(25, 3, 13, 3);
    } else if (kind === "chariot") {
      // Same painter as the shop's rig preview: horse team, crew dots and flag
      // all come from campaign state, never from a second copy of the art.
      // The player's bought chassis (crossbow rack, box, axle blades) is derived
      // from the equipment levels once per frame; an enemy chariot buys nothing and
      // keeps the stock deck, because its kit comes from `visual.overlays`.
      const kit = isPlayer ? calculateChariotKit(getEquipment() ?? {}) : null;
      sprites.drawChariotRig({
        robeColor: isPlayer ? spritePalette.playerRobe : unit.visual.robe,
        horseCount: isPlayer ? getHorseCount() : 1,
        elapsed: state.elapsed,
        crew: isPlayer ? getRoster().filter((member) => member.alive !== false) : [],
        overlays: isPlayer ? [] : unit.visual?.overlays ?? [],
        banner: isPlayer || isAlly ? spritePalette.playerBanner : spritePalette.enemyBanner,
        crossbows: kit?.crossbows ?? 0,
        bodyScale: kit?.bodyScale ?? 1,
        bladeLength: kit?.bladeLength ?? 0,
      });
    } else {
      sprites.drawFootFigure({
        robeColor: knockedDown ? "#806c55" : unit.hitFlash > 0 ? "#fff0c7"
          : isPlayer ? spritePalette.playerRobe : isAlly ? spritePalette.allyRobe
            : (unit.visual?.robe ?? spritePalette.enemyRobe),
        friendly: isPlayer || isAlly,
        overlays: unit.visual?.overlays ?? ["sword"],
        hitFlash: unit.hitFlash,
      });
    }

    if (!isPlayer && (unit.boss || unit.health < unit.maxHealth)) {
      context.fillStyle = "rgba(47, 33, 24, 0.7)";
      const barWidth = unit.boss ? 68 : isAlly ? 15 : 20;
      const barY = unit.boss ? -unit.radius - 11 : -19;
      context.fillRect(-barWidth / 2, barY, barWidth, unit.boss ? 6 : 3);
      context.fillStyle = isAlly ? "#5fbd79" : "#bf4632";
      context.fillRect(-barWidth / 2, barY, barWidth * Math.max(0, unit.health / unit.maxHealth), unit.boss ? 6 : 3);
    }
    if (unit.boss) {
      context.fillStyle = "#5a2b20";
      context.font = "bold 12px serif";
      context.textAlign = "center";
      context.fillText(translate(unit.nameKey), 0, -unit.radius - 17);
    }
    context.restore();
  }

  // One footprint painter for both sides: the dashed rect is the ground a line
  // owns, and only the palette differs - rust for an enemy line, green for a
  // hired one. Both lines pulse on their aura beat, from the same shared tick;
  // the colour is what tells the player whose banner just healed.
  //
  // A hired line also says what it has been ordered to do, because the player
  // gave that order and the ring is the only place it shows: marching is a
  // brighter, heavier stroke (the line is under way, and its slots are travelling
  // with the chariot), and a line with bodies still walking back from a 结阵
  // carries an amber stroke until the last of them is on station.
  //
  // The wash inside the ring is the ground the line *holds* - the same ground the
  // banner mends, which is why `tickFormationAura` skips a marching line. So a line
  // under 出击 holds nothing yet: its ring is travelling with the chariot, and it is
  // painted as an outline only, so no tint sits under the player's own wheels while
  // he drives his line about. 结阵 sets the ring down and the wash comes back with
  // it, from the very frame the order lands (the stragglers' amber stroke says the
  // ranks are still closing).
  function drawFormation(formation, friendly) {
    if (formation.x < camera.x - 120 || formation.x > camera.x + view.width + 120
      || formation.y < camera.y - 80 || formation.y > camera.y + view.height + 80) return;
    const halfWidth = formation.halfWidth || 116;
    const halfHeight = formation.halfHeight || 86;
    const marching = formation.order === formationOrders.MARCH;
    const straggling = friendly && !marching && (formation.stragglers ?? 0) > 0;
    context.save();
    context.translate(formation.x, formation.y);
    context.rotate(formation.heading);
    context.beginPath();
    context.rect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);
    if (!marching) {
      context.fillStyle = friendly ? "rgba(64, 140, 92, 0.07)" : "rgba(126, 43, 31, 0.055)";
      context.fill();
    }
    if (straggling) context.strokeStyle = "rgba(226, 189, 106, 0.5)";
    else if (friendly && marching) context.strokeStyle = "rgba(141, 240, 168, 0.62)";
    else context.strokeStyle = friendly ? "rgba(95, 189, 121, 0.34)" : "rgba(112, 39, 31, 0.2)";
    context.lineWidth = friendly && marching ? 1.6 : 1;
    context.setLineDash([7, 8]);
    context.stroke();
    context.setLineDash([]);
    if (formation.auraFlash > 0) {
      const pulse = Math.min(1, formation.auraFlash / formationAura.flash);
      const spread = (1 - pulse) * 12;
      context.strokeStyle = friendly
        ? `rgba(126, 233, 152, ${0.4 * pulse})`
        : `rgba(232, 166, 105, ${0.34 * pulse})`;
      context.lineWidth = 3;
      context.strokeRect(-halfWidth - spread, -halfHeight - spread, (halfWidth + spread) * 2, (halfHeight + spread) * 2);
    }
    context.restore();
    context.font = "bold 11px serif";
    context.textAlign = "center";
    const formationName = translate(formation.nameKey);
    const labelWidth = context.measureText(formationName).width + 14;
    context.fillStyle = friendly ? "rgba(27, 51, 35, 0.78)" : "rgba(39, 42, 30, 0.74)";
    context.fillRect(formation.x - labelWidth / 2, formation.y - halfHeight - 21, labelWidth, 16);
    context.fillStyle = friendly ? "#c8f0cf" : "#f5dfb0";
    context.fillText(formationName, formation.x, formation.y - halfHeight - 9);
  }

  // Culling keeps per-frame work proportional to what is on screen instead of
  // the whole 2400x1600 world.
  function inView(x, y, margin = 48) {
    return x >= camera.x - margin && x <= camera.x + view.width + margin
      && y >= camera.y - margin && y <= camera.y + view.height + margin;
  }

  // The sky is the last thing painted in the world, and that is the whole point:
  // a cloud is a translucent veil (its row's `opacity` tops out near a fifth), so
  // it can cross the field without hiding a silhouette - while a canopy or a hull
  // painted after it would break the one ordering the eye reads instantly. The
  // cull is the cloud's own box, because a puff is wider than the camera margin.
  function drawSky() {
    for (const cloud of getClouds()) {
      const x = cloudDrift(cloud, state.elapsed, world.width);
      if (x < camera.x - cloud.width || x > camera.x + view.width + cloud.width
        || cloud.y < camera.y - cloud.height || cloud.y > camera.y + view.height + cloud.height) continue;
      elements.drawCloud(cloud, x, state.elapsed);
    }
  }

  // One particle pass for every kind, filtered by `match`. Splitting the list this
  // way lets the ground wake be painted under the bodies and the sparks over them
  // without a second copy of the fade, the cull and the alpha reset - and without
  // painting the same puff twice, which would double its alpha.
  const isTrailParticle = (particle) => particle.kind === "trail";
  const isImpactParticle = (particle) => particle.kind !== "trail";

  function paintParticles(match) {
    for (const particle of state.particles) {
      if (match && !match(particle)) continue;
      const size = particle.size ?? 3;
      const growth = particle.growth ?? 0;
      if (!inView(particle.x, particle.y, size + growth + 8)) continue;
      // Never divide by the old hard-coded 0.52s: dust lives longer, and an
      // alpha above 1 is rejected by the canvas, which would freeze the fade.
      const maxLife = particle.maxLife ?? effectRules.particleFadeSeconds;
      const alpha = Math.min(1, Math.max(0, particle.life / maxLife));
      // Both a ring and a trail puff bloom as they fade; a square mote keeps its size.
      const radius = size + growth * (1 - alpha);
      if (particle.kind === "trail") {
        // Soft, translucent, still growing: the same fade as the motes, but a disc
        // at a third of the alpha is the cloud where a square would be grit.
        context.globalAlpha = alpha * effectRules.trail.alpha;
        context.fillStyle = particle.color;
        context.beginPath();
        context.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
        context.fill();
        continue;
      }
      if (particle.kind === "ring") {
        context.globalAlpha = alpha * 0.55;
        context.strokeStyle = particle.color;
        context.lineWidth = 2;
        context.beginPath();
        context.ellipse(particle.x, particle.y, radius, radius * 0.6, 0, 0, Math.PI * 2);
        context.stroke();
        continue;
      }
      context.globalAlpha = alpha;
      context.fillStyle = particle.color;
      context.fillRect(particle.x, particle.y, size, size);
    }
    context.globalAlpha = 1;
  }

  function draw() {
    if (!context || !canvas.width || !canvas.height) return;
    context.clearRect(0, 0, view.width, view.height);
    context.save();
    if (state.shake > 0) {
      context.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
    }
    context.translate(-camera.x, -camera.y);
    // The floor is its own painter (src/render/ground.js): a soil wash with a
    // little grass and shade, painted under the terrain patches, which are
    // gameplay. It owns the base colour, so there is no literal here to drift.
    ground.drawGround(camera.x, camera.y, view.width, view.height);

    for (const patch of getTerrain()) {
      if (!inView(patch.x, patch.y, Math.max(patch.radiusX, patch.radiusY) + 8)) continue;
      elements.drawTerrain(patch);
    }

    for (const stain of state.bloodStains) {
      if (!inView(stain.x, stain.y, stain.width + 8)) continue;
      context.save();
      context.translate(stain.x, stain.y);
      context.rotate(stain.rotation);
      context.fillStyle = stain.color;
      context.beginPath();
      context.ellipse(0, 0, stain.width, stain.height, 0, 0, Math.PI * 2);
      context.fill();
      for (const drop of stain.drops) {
        context.beginPath();
        context.ellipse(drop.x, drop.y, drop.size, drop.size * 0.72, 0, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
    }

    // Stumps sit under everything that moves: a felled tree leaves scenery, and the
    // chariot that cut it down drives straight over the top of it.
    for (const stump of getStumps()) {
      if (!inView(stump.x, stump.y, stump.radius * 2.4)) continue;
      elements.drawStump(stump);
    }

    for (const obstacle of getObstacles()) {
      if (!inView(obstacle.x, obstacle.y, elementCullMargin(obstacle))) continue;
      elements.drawObstacle(obstacle, state.elapsed);
    }

    for (const arrow of state.groundArrows) {
      if (!inView(arrow.x, arrow.y, 16)) continue;
      const alpha = Math.min(1, arrow.life / 1.5);
      context.save();
      context.globalAlpha = alpha;
      context.translate(arrow.x, arrow.y);
      context.rotate(arrow.angle);
      context.strokeStyle = "#7a5834";
      context.fillStyle = "#c3a16a";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(-8, 0);
      context.lineTo(8, 0);
      context.stroke();
      context.beginPath();
      context.moveTo(8, 0);
      context.lineTo(3, -3);
      context.lineTo(3, 3);
      context.closePath();
      context.fill();
      context.restore();
    }

    if (state.phase === "extract" && state.extractionPoint) {
      const point = state.extractionPoint;
      const pulse = Math.sin(state.elapsed * 3) * 4;
      context.save();
      context.fillStyle = "rgba(211, 173, 104, 0.13)";
      context.beginPath();
      context.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "rgba(244, 211, 135, 0.9)";
      context.lineWidth = 3;
      context.setLineDash([10, 7]);
      context.beginPath();
      context.arc(point.x, point.y, point.radius + pulse, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
      context.strokeStyle = "rgba(255, 238, 190, 0.85)";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(point.x, point.y, 17, 0, Math.PI * 2);
      context.moveTo(point.x - 8, point.y);
      context.lineTo(point.x + 8, point.y);
      context.moveTo(point.x, point.y - 8);
      context.lineTo(point.x, point.y + 8);
      context.stroke();
      context.fillStyle = "#4a3524";
      context.font = "bold 14px serif";
      context.textAlign = "center";
      context.fillText(translate("battle.extract"), point.x, point.y - point.radius - 12);
      context.restore();
    }

    for (const drop of state.drops) {
      if (!inView(drop.x, drop.y, 24)) continue;
      const bob = Math.sin(drop.phase) * 3;
      context.save();
      context.translate(drop.x, drop.y + bob);
      context.fillStyle = "rgba(55, 37, 22, 0.28)";
      context.beginPath();
      context.ellipse(0, 8, 9, 4, 0, 0, Math.PI * 2);
      context.fill();
      if (drop.type === "meat") {
        // A wild animal's drop: a scrap of game, not coin. Same shadow, same bob -
        // the HUD's gold counter never sees it, the hull does (game.js heals on
        // pickup).
        context.fillStyle = "#a8412f";
        context.beginPath();
        context.ellipse(0, 0, 8, 5.5, -0.4, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#e8dcc4";
        context.fillRect(3, -5, 4.5, 4);
        context.strokeStyle = "#6d2b1e";
        context.lineWidth = 1;
        context.beginPath();
        context.ellipse(0, 0, 8, 5.5, -0.4, 0, Math.PI * 2);
        context.stroke();
      } else if (drop.type === "coin") {
        context.fillStyle = "#d9a94e";
        context.beginPath();
        context.arc(0, 0, 6, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "#f0d28d";
        context.lineWidth = 1;
        context.stroke();
        context.fillStyle = "#78502a";
        context.font = "7px serif";
        context.textAlign = "center";
        context.fillText(translate("battle.coinMark"), 0, 2.5);
      } else {
        context.fillStyle = drop.type === "gold" ? "#e0b34e" : "#bdc0b8";
        context.beginPath();
        context.moveTo(-8, 3);
        context.lineTo(-6, -4);
        context.lineTo(0, -7);
        context.lineTo(7, -4);
        context.lineTo(8, 3);
        context.closePath();
        context.fill();
        context.strokeStyle = drop.type === "gold" ? "#f4d47a" : "#e2e1d6";
        context.lineWidth = 1;
        context.stroke();
        context.fillStyle = "rgba(255,255,255,0.35)";
        context.fillRect(-4, -4, 6, 1);
      }
      context.restore();
    }

    for (const formation of state.formations) drawFormation(formation, false);
    for (const formation of state.allyFormations ?? []) drawFormation(formation, true);

    // The wake goes down before anything that flies or stands on it: the hull
    // drives through its own dust, and an arrow in the air stays above it.
    paintParticles(isTrailParticle);

    for (const bullet of state.bullets) {
      if (!inView(bullet.x, bullet.y, 40)) continue;
      const color = bullet.kind === "stone" ? "#5f3428"
        : bullet.owner === "enemy" ? "#a53b2b" : bullet.owner === "ally" ? "#888c56" : "#f1d28b";
      const height = bullet.z ?? 0;
      context.fillStyle = "rgba(48, 38, 26, 0.2)";
      context.beginPath();
      context.ellipse(bullet.x, bullet.y, bullet.radius ?? 3.5, (bullet.radius ?? 3.5) * 0.55, 0, 0, Math.PI * 2);
      context.fill();
      context.save();
      context.translate(bullet.x, bullet.y - height);
      context.rotate(Math.atan2(bullet.vy, bullet.vx));
      context.fillStyle = color;
      if (bullet.kind === "stone") {
        context.beginPath();
        context.arc(0, 0, bullet.radius ?? 6, 0, Math.PI * 2);
        context.fill();
      } else {
        context.strokeStyle = color;
        context.lineWidth = 2.5;
        context.beginPath();
        context.moveTo(-7, 0);
        context.lineTo(5, 0);
        context.stroke();
        context.beginPath();
        context.moveTo(5, 0);
        context.lineTo(1, -3);
        context.lineTo(1, 3);
        context.closePath();
        context.fill();
      }
      context.restore();
    }

    for (const enemy of state.enemies) {
      if (inView(enemy.x, enemy.y, enemy.radius + 60)) drawCombatant(enemy);
    }
    for (const companion of state.footCompanions) {
      if (inView(companion.x, companion.y, companion.radius + 60)) drawCombatant(companion, false, true);
    }
    // The hired line uses the same green ally treatment as a dismounted crew
    // member: one visual language for "this body is on your side".
    for (const ally of state.allies ?? []) {
      if (inView(ally.x, ally.y, ally.radius + 60)) drawCombatant(ally, false, true);
    }
    if (player.invulnerable === 0 || Math.floor(player.invulnerable * 12) % 2 === 0) {
      drawCombatant(player, true);
    }

    for (const effect of state.meleeEffects) {
      if (!inView(effect.x, effect.y, 120)) continue;
      const progress = 1 - effect.life / effect.duration;
      const radius = 18 + progress * 22;
      context.save();
      context.translate(effect.x, effect.y);
      context.rotate(effect.angle);
      context.globalAlpha = Math.max(0, effect.life / effect.duration);
      context.strokeStyle = effect.color;
      context.fillStyle = effect.color;
      context.lineWidth = effect.weapon === "dagger-axe" ? 4 : 3;
      if (effect.weapon === "stomp") {
        context.globalAlpha *= 0.85;
        context.lineWidth = 6;
        context.beginPath();
        context.arc(0, 0, 20 + progress * 74, 0, Math.PI * 2);
        context.stroke();
        context.globalAlpha *= 0.55;
        context.beginPath();
        context.arc(0, 0, 12 + progress * 48, 0, Math.PI * 2);
        context.stroke();
      } else if (effect.weapon === "claw") {
        context.lineWidth = 5;
        for (const offset of [-0.34, 0, 0.34]) {
          context.beginPath();
          context.arc(0, 0, radius, offset - 0.38, offset + 0.38);
          context.stroke();
        }
      } else if (effect.weapon === "ram") {
        const reach = 22 + progress * 42;
        context.globalAlpha *= 0.95;
        context.lineWidth = 5;
        context.beginPath();
        context.arc(0, 0, reach, -0.72, 0.72);
        context.stroke();
        context.lineWidth = 3;
        for (const offset of [-0.55, -0.2, 0.2, 0.55]) {
          context.beginPath();
          context.moveTo(Math.cos(offset) * (reach - 7), Math.sin(offset) * (reach - 7));
          context.lineTo(Math.cos(offset) * (reach + 10), Math.sin(offset) * (reach + 10));
          context.stroke();
        }
        context.globalAlpha *= 0.55;
        context.beginPath();
        context.arc(0, 0, 10 + progress * 18, 0, Math.PI * 2);
        context.stroke();
      } else if (effect.weapon === "spike") {
        for (const offset of [-0.45, 0, 0.45]) {
          context.beginPath();
          context.moveTo(Math.cos(offset) * 10, Math.sin(offset) * 10);
          context.lineTo(Math.cos(offset) * radius, Math.sin(offset) * radius);
          context.stroke();
          context.beginPath();
          context.moveTo(Math.cos(offset) * (radius + 5), Math.sin(offset) * (radius + 5));
          context.lineTo(Math.cos(offset) * (radius - 3) - 4, Math.sin(offset) * (radius - 3));
          context.lineTo(Math.cos(offset) * (radius - 3) + 4, Math.sin(offset) * (radius - 3));
          context.closePath();
          context.fill();
        }
      } else {
        const sweep = effect.weapon === "dagger-axe" ? 1.15 : 0.8;
        context.beginPath();
        context.arc(0, 0, radius, -sweep, sweep);
        context.stroke();
        if (effect.weapon === "dagger-axe") {
          context.beginPath();
          context.moveTo(radius * Math.cos(sweep), radius * Math.sin(sweep));
          context.lineTo((radius + 9) * Math.cos(sweep - 0.18), (radius + 9) * Math.sin(sweep - 0.18));
          context.lineTo((radius + 7) * Math.cos(sweep + 0.18), (radius + 7) * Math.sin(sweep + 0.18));
          context.stroke();
        }
      }
      context.restore();
    }

    // Impact sparks, ground rings and motes stay above the bodies.
    paintParticles(isImpactParticle);

    context.strokeStyle = "rgba(111, 64, 35, 0.45)";
    context.lineWidth = 2;
    context.strokeRect(0, 0, world.width, world.height);
    // The sky closes the world pass: nothing above it can cover a cloud, and a
    // layer added after it would put a body in front of the sky.
    drawSky();
    context.restore();

    if (state.damageFlash > 0) {
      context.fillStyle = `rgba(135, 37, 25, ${state.damageFlash * 0.3})`;
      context.fillRect(0, 0, view.width, view.height);
    }
  }

  return { draw };
}
