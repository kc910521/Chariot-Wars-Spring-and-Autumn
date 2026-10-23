import { translate } from "../i18n/index.js";
import { effectRules } from "../data/rules.js";

export function createRenderer({ canvas, context, view, camera, world, player, state, getObstacles, getTerrain, getClouds, getHorseCount, getRoster }) {
  function roundedRect(x, y, width, height, radius) {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    context.fill();
  }

  // A row lists the weapon and armour pieces its silhouette wears, in draw order
  // (armour first, weapon over it), so "heavy" is plate + sword in the data table
  // instead of an `if (type === "heavy")` down here.
  function drawWeaponShaft() {
    context.strokeStyle = "#493421";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(4, 0);
    context.lineTo(25, 0);
    context.stroke();
  }

  const FOOT_OVERLAYS = {
    plate(unit) {
      const armorGradient = context.createLinearGradient(-12, -8, 10, 9);
      armorGradient.addColorStop(0, unit.hitFlash > 0 ? "#fff0c7" : "#aab8bc");
      armorGradient.addColorStop(0.45, unit.hitFlash > 0 ? "#fff0c7" : "#778da0");
      armorGradient.addColorStop(1, "#3e4e5c");
      context.fillStyle = armorGradient;
      roundedRect(-12, -8, 20, 17, 4);
      context.strokeStyle = "#d5e2e8";
      context.lineWidth = 2;
      context.strokeRect(-12, -8, 20, 17);
      context.strokeStyle = "rgba(42, 49, 54, 0.7)";
      context.lineWidth = 1;
      for (let row = 0; row < 3; row += 1) {
        context.beginPath();
        context.moveTo(-9, -4 + row * 5);
        context.lineTo(5, -4 + row * 5);
        context.stroke();
      }
      context.fillStyle = "#d6bc79";
      for (const rivetX of [-9, 5]) {
        for (const rivetY of [-5, 5]) {
          context.beginPath();
          context.arc(rivetX, rivetY, 1, 0, Math.PI * 2);
          context.fill();
        }
      }
      context.fillStyle = "#d9cda9";
      context.beginPath();
      context.ellipse(-13, 0, 5, 10, 0, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#655d4e";
      context.lineWidth = 1.5;
      context.stroke();
      context.fillStyle = "#57534c";
      context.beginPath();
      context.arc(2, -8, 6, Math.PI, Math.PI * 2);
      context.fill();
      context.fillStyle = "#d5e2e8";
      context.fillRect(-8, -3, 13, 2);
    },
    bow() {
      context.strokeStyle = "#59412d";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(-8, -4);
      context.lineTo(-12, 2);
      context.stroke();
      context.strokeStyle = "#4f3425";
      context.lineWidth = 2.5;
      context.beginPath();
      context.arc(8, 0, 8, -1.15, 1.15);
      context.stroke();
      context.strokeStyle = "#d5c294";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(11, -7);
      context.lineTo(11, 7);
      context.stroke();
      context.strokeStyle = "#59422d";
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(4, 0);
      context.lineTo(17, 0);
      context.stroke();
    },
    sling() {
      context.strokeStyle = "#8a6238";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(-8, -4);
      context.lineTo(-12, 2);
      context.stroke();
      context.strokeStyle = "#4f3425";
      context.lineWidth = 2.5;
      context.beginPath();
      context.arc(7, 0, 7, -1.15, 1.15);
      context.stroke();
      context.strokeStyle = "#d5c294";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(10, -6);
      context.lineTo(10, 6);
      context.moveTo(9, -5);
      context.lineTo(14, -9);
      context.stroke();
    },
    sword() {
      drawWeaponShaft();
      context.fillStyle = "#f0d89b";
      context.beginPath();
      context.moveTo(28, 0);
      context.lineTo(20, -5);
      context.lineTo(19, 0);
      context.lineTo(20, 5);
      context.closePath();
      context.fill();
      context.strokeStyle = "#493421";
      context.lineWidth = 1.5;
      context.stroke();
    },
    "dagger-axe"() {
      drawWeaponShaft();
      context.fillStyle = "#f0d89b";
      context.strokeStyle = "#493421";
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(23, -3);
      context.lineTo(31, -9);
      context.lineTo(30, -1);
      context.lineTo(35, 2);
      context.lineTo(29, 5);
      context.lineTo(23, 2);
      context.closePath();
      context.fill();
      context.stroke();
    },
  };

  // The one piece of chariot kit that comes off a row rather than off the art.
  const CHARIOT_OVERLAYS = {
    bow() {
      context.fillStyle = "#d6b47c";
      context.beginPath();
      context.arc(1, -5, 4, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#5b4934";
      context.fillRect(-3, -9, 9, 2);
      context.strokeStyle = "#4f3425";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(10, -5, 7, -1.1, 1.1);
      context.stroke();
      context.strokeStyle = "#d5c294";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(12, -11);
      context.lineTo(12, 1);
      context.stroke();
    },
  };

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
      const robeColor = isPlayer ? "#17796f" : unit.visual.robe;
      context.fillStyle = "rgba(30, 28, 22, 0.42)";
      context.beginPath();
      context.ellipse(18, 3, 34, 18, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#674a2f";
      context.beginPath();
      context.moveTo(-15, -11);
      context.lineTo(14, -11);
      context.lineTo(19, -7);
      context.lineTo(19, 8);
      context.lineTo(13, 12);
      context.lineTo(-15, 12);
      context.closePath();
      context.fill();
      context.strokeStyle = "#d4ae6d";
      context.lineWidth = 1.5;
      context.stroke();
      context.fillStyle = "rgba(239, 211, 157, 0.3)";
      context.fillRect(-10, -8, 22, 2);
      for (const wheelY of [-13, 13]) {
        context.fillStyle = "#3d3025";
        context.beginPath();
        context.arc(-5, wheelY, 9, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "#f0c66e";
        context.lineWidth = 2.5;
        context.beginPath();
        context.arc(-5, wheelY, 6, 0, Math.PI * 2);
        context.stroke();
        for (let spoke = 0; spoke < 8; spoke += 1) {
          const angle = spoke * Math.PI / 4;
          context.beginPath();
          context.moveTo(-5 + Math.cos(angle) * 2, wheelY + Math.sin(angle) * 2);
          context.lineTo(-5 + Math.cos(angle) * 6, wheelY + Math.sin(angle) * 6);
          context.stroke();
        }
        context.fillStyle = "#d8bb7b";
        context.beginPath();
        context.arc(-5, wheelY, 2, 0, Math.PI * 2);
        context.fill();
      }
      context.strokeStyle = "#ffe1a0";
      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(4, 0);
      context.lineTo(32, 0);
      context.stroke();
      const horseCount = isPlayer ? getHorseCount() : 1;
      for (let horseIndex = 0; horseIndex < horseCount; horseIndex += 1) {
        const horseY = (horseIndex - (horseCount - 1) / 2) * 14;
        const gait = Math.sin(state.elapsed * 9 + horseIndex * 1.7) * 2;
        context.fillStyle = "#33271e";
        context.beginPath();
        context.ellipse(38, horseY + 1, 11, 5.6, 0, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#5b4631";
        context.beginPath();
        context.ellipse(45, horseY - 2, 5, 3.2, -0.28, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#33271e";
        context.beginPath();
        context.moveTo(47, horseY - 4);
        context.lineTo(49, horseY - 7);
        context.lineTo(50, horseY - 3);
        context.closePath();
        context.fill();
        context.fillStyle = "#e2c078";
        context.beginPath();
        context.arc(47, horseY - 2, 0.9, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "#6c4930";
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(33, horseY + 4);
        context.lineTo(31, horseY + 9 + gait);
        context.lineTo(29, horseY + 9 + gait);
        context.moveTo(41, horseY + 4);
        context.lineTo(42, horseY + 9 - gait);
        context.lineTo(44, horseY + 9 - gait);
        context.stroke();
        context.strokeStyle = "#b58a50";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(40, horseY - 4);
        context.lineTo(46, horseY - 4);
        context.lineTo(49, horseY - 1);
        context.stroke();
        context.fillStyle = "#b58a50";
        context.beginPath();
        context.moveTo(29, horseY - 2);
        context.quadraticCurveTo(34, horseY - 9, 40, horseY - 5);
        context.quadraticCurveTo(36, horseY - 7, 34, horseY - 1);
        context.fill();
      }
      context.fillStyle = robeColor;
      roundedRect(-15, -12, 26, 24, 4);
      context.strokeStyle = "#f0cc78";
      context.lineWidth = 2;
      context.strokeRect(-15, -12, 26, 24);
      context.fillStyle = "#f3d88f";
      context.fillRect(-12, -8, 19, 3);
      context.fillRect(-12, 5, 19, 3);
      context.fillStyle = "#67472d";
      for (const studX of [-11, 7]) {
        for (const studY of [-8, 7]) {
          context.beginPath();
          context.arc(studX, studY, 1, 0, Math.PI * 2);
          context.fill();
        }
      }
      context.fillStyle = "#ffe4a1";
      context.beginPath();
      context.arc(-2, 0, 5, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#fff0bd";
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(8, 0);
      context.lineTo(29, 0);
      context.stroke();
      context.strokeStyle = "#493421";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(-13, -10);
      context.lineTo(-13, -25);
      context.stroke();
      context.fillStyle = isPlayer ? "#41b7a3" : "#f27a50";
      context.beginPath();
      context.moveTo(-12, -24);
      context.lineTo(1, -20);
      context.lineTo(-12, -15);
      context.closePath();
      context.fill();
      // Crew kit the row asks for: the chariot archer carries a bow.
      if (!isPlayer) {
        for (const overlay of unit.visual?.overlays ?? []) CHARIOT_OVERLAYS[overlay]();
      }
      if (isPlayer) {
        const roster = getRoster().filter((member) => member.alive !== false);
        for (let index = 0; index < Math.min(roster.length, 4); index += 1) {
          context.fillStyle = roster[index].role === "archer" ? "#88bd8a" : "#d7b574";
          context.beginPath();
          context.arc(-10 + index * 7, 0, 2.5, 0, Math.PI * 2);
          context.fill();
          if (roster[index].role === "archer") {
            context.strokeStyle = "#493421";
            context.lineWidth = 1;
            context.beginPath();
            context.arc(-10 + index * 7, 0, 3.5, -1.1, 1.1);
            context.stroke();
          } else {
            context.strokeStyle = "#d8c18d";
            context.lineWidth = 1;
            context.beginPath();
            context.moveTo(-10 + index * 7, -2);
            context.lineTo(-10 + index * 7 + 4, -7);
            context.stroke();
          }
        }
      }
    } else {
      // Foot silhouette - the default, shared by the ranks and by anyone walking.
      const robeColor = knockedDown ? "#806c55" : unit.hitFlash > 0 ? "#fff0c7"
        : isPlayer ? "#17796f" : isAlly ? "#398b63" : (unit.visual?.robe ?? "#a74732");
      context.fillStyle = "#493729";
      context.beginPath();
      context.ellipse(-4, 8, 3.2, 5.5, -0.12, 0, Math.PI * 2);
      context.ellipse(4, 8, 3.2, 5.5, 0.12, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "rgba(30, 28, 22, 0.38)";
      context.beginPath();
      context.ellipse(0, 6, 9.5, 7, 0, 0, Math.PI * 2);
      context.fill();
      const clothGradient = context.createLinearGradient(-7, -8, 8, 10);
      clothGradient.addColorStop(0, isPlayer || isAlly ? "#55a78a" : "#e0a568");
      clothGradient.addColorStop(0.42, robeColor);
      clothGradient.addColorStop(1, isPlayer || isAlly ? "#124f48" : "#63362e");
      context.fillStyle = clothGradient;
      context.beginPath();
      context.moveTo(-8, -5);
      context.quadraticCurveTo(-11, 0, -9, 8);
      context.lineTo(-5, 6);
      context.lineTo(-2, 10);
      context.lineTo(2, 6);
      context.lineTo(7, 9);
      context.quadraticCurveTo(10, 0, 7, -5);
      context.quadraticCurveTo(0, -10, -8, -5);
      context.fill();
      context.strokeStyle = "rgba(44, 34, 27, 0.78)";
      context.lineWidth = 1.2;
      context.stroke();
      context.strokeStyle = "rgba(235, 207, 151, 0.6)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(-5, -4);
      context.lineTo(-3, 4);
      context.lineTo(1, 7);
      context.stroke();
      context.fillStyle = "#b99761";
      context.fillRect(-2, 3, 6, 2);
      context.fillStyle = robeColor;
      context.beginPath();
      context.ellipse(-2, 1, 7.5, 9, 0, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#3b2a20";
      context.lineWidth = 1.5;
      context.stroke();
      context.strokeStyle = "#d3b77e";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(-7, 2);
      context.lineTo(4, 2);
      context.moveTo(-1, -6);
      context.lineTo(1, 7);
      context.stroke();
      context.fillStyle = "#d6b47c";
      context.beginPath();
      context.arc(2, -8, 4.8, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#4a3423";
      context.lineWidth = 1.5;
      context.stroke();
      context.fillStyle = "#41352a";
      context.fillRect(-3, -12, 11, 3);
      context.fillStyle = "#d3b77e";
      context.beginPath();
      context.arc(1, -11, 5, Math.PI, Math.PI * 2);
      context.fill();
      context.fillRect(-4, -11, 11, 1.5);
      context.fillStyle = "#f2d276";
      context.fillRect(-8, 1, 12, 2);

      // Armour and weapon are the row's `overlays`, drawn in the order it lists
      // them: heavy is ["plate", "sword"], an archer just ["bow"]. The default is
      // the unarmoured kit the player and his companions walk in.
      for (const overlay of unit.visual?.overlays ?? ["sword"]) FOOT_OVERLAYS[overlay](unit);
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

  function drawObstacle(obstacle) {
    if (obstacle.type === "wall") {
      context.fillStyle = "rgba(62, 41, 24, 0.2)";
      roundedRect(obstacle.x + 5, obstacle.y + 6, obstacle.width, obstacle.height, 4);
      context.fillStyle = "#74604a";
      roundedRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height, 4);
      context.fillStyle = "rgba(238, 213, 164, 0.28)";
      context.fillRect(obstacle.x + 5, obstacle.y + 5, obstacle.width - 10, 3);
      context.strokeStyle = "rgba(55, 40, 27, 0.25)";
      context.lineWidth = 2;
      for (let x = obstacle.x + 24; x < obstacle.x + obstacle.width; x += 34) {
        context.beginPath();
        context.moveTo(x, obstacle.y + 4);
        context.lineTo(x, obstacle.y + obstacle.height - 4);
        context.stroke();
      }
    } else {
      const { x, y, radius } = obstacle;
      context.fillStyle = "rgba(43, 37, 25, 0.22)";
      context.beginPath();
      context.ellipse(x + 7, y + radius * 0.58, radius * 1.08, radius * 0.55, -0.08, 0, Math.PI * 2);
      context.fill();

      const trunkGradient = context.createLinearGradient(x - radius * 0.2, y - radius * 0.3, x + radius * 0.3, y + radius * 0.5);
      trunkGradient.addColorStop(0, "#9a7546");
      trunkGradient.addColorStop(0.42, "#62452e");
      trunkGradient.addColorStop(1, "#332a20");
      context.fillStyle = trunkGradient;
      context.beginPath();
      context.moveTo(x - radius * 0.28, y + radius * 0.48);
      context.lineTo(x - radius * 0.18, y - radius * 0.36);
      context.lineTo(x + radius * 0.2, y - radius * 0.42);
      context.lineTo(x + radius * 0.32, y + radius * 0.48);
      context.closePath();
      context.fill();
      context.strokeStyle = "rgba(42, 34, 24, 0.55)";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(x, y + radius * 0.2);
      context.lineTo(x - radius * 0.55, y - radius * 0.3);
      context.moveTo(x + radius * 0.05, y + radius * 0.05);
      context.lineTo(x + radius * 0.58, y - radius * 0.48);
      context.stroke();

      const canopyGradient = context.createRadialGradient(
        x - radius * 0.32, y - radius * 0.4, radius * 0.08,
        x, y, radius * 1.08,
      );
      canopyGradient.addColorStop(0, "#a1ae78");
      canopyGradient.addColorStop(0.42, "#728755");
      canopyGradient.addColorStop(0.82, "#526d47");
      canopyGradient.addColorStop(1, "#344934");
      context.fillStyle = canopyGradient;
      const lobes = 14;
      const canopyPoints = Array.from({ length: lobes }, (_, index) => {
        const angle = index * Math.PI * 2 / lobes;
        const variation = 0.82 + ((index * 7 + Math.floor(x * 0.17) + Math.floor(y * 0.13)) % 7) * 0.045;
        return {
          x: x + Math.cos(angle) * radius * variation,
          y: y + Math.sin(angle) * radius * variation * 0.8,
        };
      });
      context.beginPath();
      const first = canopyPoints[0];
      context.moveTo((first.x + canopyPoints[lobes - 1].x) / 2, (first.y + canopyPoints[lobes - 1].y) / 2);
      for (let index = 0; index < lobes; index += 1) {
        const point = canopyPoints[index];
        const next = canopyPoints[(index + 1) % lobes];
        context.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
      }
      context.closePath();
      context.fill();
      context.strokeStyle = "rgba(43, 61, 39, 0.28)";
      context.lineWidth = 1;
      context.stroke();

      const foliageClusters = [
        [-0.43, -0.26, 0.43, 0.31], [-0.12, -0.48, 0.42, 0.36], [0.29, -0.38, 0.44, 0.32],
        [0.48, -0.02, 0.39, 0.34], [0.13, 0.22, 0.49, 0.35], [-0.34, 0.2, 0.4, 0.33],
      ];
      foliageClusters.forEach(([offsetX, offsetY, width, height], index) => {
        const clusterX = x + (offsetX + Math.sin(index * 2 + x) * 0.035) * radius;
        const clusterY = y + (offsetY + Math.cos(index * 1.7 + y) * 0.035) * radius;
        const clusterWidth = width * radius;
        const clusterHeight = height * radius;
        const clusterGradient = context.createRadialGradient(
          clusterX - clusterWidth * 0.24, clusterY - clusterHeight * 0.3, clusterHeight * 0.03,
          clusterX, clusterY, clusterWidth,
        );
        clusterGradient.addColorStop(0, index % 2 ? "rgba(163, 179, 111, 0.78)" : "rgba(183, 188, 118, 0.72)");
        clusterGradient.addColorStop(0.58, index % 2 ? "rgba(104, 132, 79, 0.66)" : "rgba(83, 119, 70, 0.72)");
        clusterGradient.addColorStop(1, "rgba(49, 77, 48, 0)");
        context.fillStyle = clusterGradient;
        context.beginPath();
        context.ellipse(clusterX, clusterY, clusterWidth, clusterHeight, index * 0.29, 0, Math.PI * 2);
        context.fill();
      });

      for (let leaf = 0; leaf < 24; leaf += 1) {
        const angle = leaf * 2.399 + x * 0.013 + y * 0.009;
        const distance = radius * (0.12 + ((leaf * 5 + Math.floor(x + y)) % 9) * 0.072);
        const leafX = x + Math.cos(angle) * distance;
        const leafY = y + Math.sin(angle) * distance * 0.72;
        context.fillStyle = leaf % 4 === 0 ? "rgba(208, 201, 139, 0.48)"
          : leaf % 4 === 1 ? "rgba(38, 62, 42, 0.24)"
            : leaf % 4 === 2 ? "rgba(137, 157, 97, 0.38)" : "rgba(76, 107, 63, 0.4)";
        context.beginPath();
        context.ellipse(leafX, leafY, radius * 0.085, radius * 0.045, angle, 0, Math.PI * 2);
        context.fill();
      }

      context.strokeStyle = "rgba(45, 40, 29, 0.58)";
      context.lineWidth = Math.max(1.4, radius * 0.075);
      context.beginPath();
      context.moveTo(x, y + radius * 0.22);
      context.quadraticCurveTo(x + radius * 0.1, y - radius * 0.08, x - radius * 0.34, y - radius * 0.42);
      context.moveTo(x + radius * 0.03, y + radius * 0.08);
      context.quadraticCurveTo(x + radius * 0.14, y - radius * 0.16, x + radius * 0.42, y - radius * 0.38);
      context.stroke();
    }
  }

  function drawClouds() {
    for (const cloud of getClouds()) {
      const drift = state.elapsed * cloud.speed;
      const x = ((cloud.x + drift) % world.width + world.width) % world.width;
      if (x < camera.x - cloud.width || x > camera.x + view.width + cloud.width
        || cloud.y < camera.y - cloud.height || cloud.y > camera.y + view.height + cloud.height) continue;
      const breathe = 0.9 + Math.sin(state.elapsed * 0.35 + cloud.phase) * 0.1;
      context.save();
      context.globalAlpha = cloud.opacity * breathe;
      const shadowGradient = context.createRadialGradient(x, cloud.y + cloud.height * 0.12, cloud.height * 0.08,
        x, cloud.y + cloud.height * 0.12, cloud.width * 0.7);
      shadowGradient.addColorStop(0, "rgba(56, 66, 52, 0.72)");
      shadowGradient.addColorStop(0.58, "rgba(67, 75, 58, 0.38)");
      shadowGradient.addColorStop(1, "rgba(77, 80, 62, 0)");
      context.fillStyle = shadowGradient;
      context.beginPath();
      context.ellipse(x, cloud.y + cloud.height * 0.1, cloud.width * 0.68, cloud.height * 0.62, -0.06, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = cloud.opacity * breathe * 0.7;
      context.fillStyle = "#e0deca";
      context.beginPath();
      context.ellipse(x - cloud.width * 0.28, cloud.y + cloud.height * 0.03, cloud.width * 0.3, cloud.height * 0.34, -0.12, 0, Math.PI * 2);
      context.ellipse(x - cloud.width * 0.04, cloud.y - cloud.height * 0.1, cloud.width * 0.34, cloud.height * 0.48, -0.06, 0, Math.PI * 2);
      context.ellipse(x + cloud.width * 0.24, cloud.y, cloud.width * 0.31, cloud.height * 0.37, 0.08, 0, Math.PI * 2);
      context.ellipse(x + cloud.width * 0.02, cloud.y + cloud.height * 0.12, cloud.width * 0.43, cloud.height * 0.28, 0, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = cloud.opacity * breathe * 0.24;
      context.strokeStyle = "#fff3d4";
      context.lineWidth = Math.max(2, cloud.height * 0.065);
      context.beginPath();
      context.ellipse(x - cloud.width * 0.04, cloud.y - cloud.height * 0.1, cloud.width * 0.34, cloud.height * 0.48, -0.06, Math.PI * 1.08, Math.PI * 1.9);
      context.stroke();
      context.restore();
    }
  }

  // Culling keeps per-frame work proportional to what is on screen instead of
  // the whole 2400x1600 world.
  function inView(x, y, margin = 48) {
    return x >= camera.x - margin && x <= camera.x + view.width + margin
      && y >= camera.y - margin && y <= camera.y + view.height + margin;
  }

  function draw() {
    if (!context || !canvas.width || !canvas.height) return;
    context.clearRect(0, 0, view.width, view.height);
    context.save();
    if (state.shake > 0) {
      context.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
    }
    context.translate(-camera.x, -camera.y);
    context.fillStyle = "#929d6d";
    context.fillRect(camera.x, camera.y, view.width, view.height);

    for (const patch of getTerrain()) {
      if (!inView(patch.x, patch.y, Math.max(patch.radiusX, patch.radiusY) + 8)) continue;
      context.save();
      context.translate(patch.x, patch.y);
      context.fillStyle = patch.type === "shallows" ? "rgba(91, 135, 129, 0.43)"
        : patch.type === "sand" ? "rgba(190, 153, 92, 0.38)" : "rgba(105, 121, 67, 0.32)";
      context.beginPath();
      context.ellipse(0, 0, patch.radiusX, patch.radiusY, 0, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = patch.type === "shallows" ? "rgba(188, 218, 200, 0.38)"
        : patch.type === "sand" ? "rgba(235, 205, 146, 0.36)" : "rgba(189, 198, 128, 0.32)";
      context.lineWidth = 2;
      if (patch.type === "shallows") {
        for (let line = -2; line <= 2; line += 1) {
          context.beginPath();
          context.ellipse(0, line * patch.radiusY * 0.24, patch.radiusX * 0.72, patch.radiusY * 0.12, 0, 0.1, Math.PI - 0.1);
          context.stroke();
        }
      } else if (patch.type === "sand") {
        for (let line = -2; line <= 2; line += 1) {
          context.beginPath();
          context.moveTo(-patch.radiusX * 0.55, line * 13);
          context.lineTo(patch.radiusX * 0.55, line * 13 - 7);
          context.stroke();
        }
      } else {
        for (let blade = 0; blade < 18; blade += 1) {
          const x = Math.sin(blade * 17.1) * patch.radiusX * 0.7;
          const y = Math.cos(blade * 9.7) * patch.radiusY * 0.6;
          context.beginPath();
          context.moveTo(x, y + 4);
          context.lineTo(x - 2, y - 4);
          context.stroke();
        }
      }
      context.restore();
    }

    context.fillStyle = "rgba(75, 83, 52, 0.055)";
    for (let index = 0; index < 28; index += 1) {
      const ridgeX = index * 103 - 17;
      const ridgeY = (index * 137) % world.height;
      if (!inView(ridgeX, ridgeY, 80)) continue;
      context.beginPath();
      context.ellipse(ridgeX, ridgeY, 54 + (index % 4) * 8, 15 + (index % 3) * 5, -0.14, 0, Math.PI * 2);
      context.fill();
    }

    context.strokeStyle = "rgba(55, 68, 46, 0.055)";
    context.lineWidth = 1;
    const firstGridX = Math.floor(camera.x / 40) * 40;
    const firstGridY = Math.floor(camera.y / 40) * 40;
    for (let x = firstGridX; x <= camera.x + view.width; x += 40) {
      context.beginPath();
      context.moveTo(x, camera.y);
      context.lineTo(x, camera.y + view.height);
      context.stroke();
    }
    for (let y = firstGridY; y <= camera.y + view.height; y += 40) {
      context.beginPath();
      context.moveTo(camera.x, y);
      context.lineTo(camera.x + view.width, y);
      context.stroke();
    }

    context.fillStyle = "rgba(55, 61, 39, 0.12)";
    for (let index = 0; index < 440; index += 1) {
      const x = (index * 149 + 17) % world.width;
      const y = (index * 83 + 29) % world.height;
      if (x >= camera.x && x <= camera.x + view.width && y >= camera.y && y <= camera.y + view.height) {
        context.fillRect(x, y, index % 4 === 0 ? 2 : 1, index % 4 === 0 ? 2 : 1);
      }
    }

    drawClouds();

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

    for (const obstacle of getObstacles()) {
      const margin = obstacle.type === "tree" ? obstacle.radius + 8 : Math.max(obstacle.width, obstacle.height);
      if (!inView(obstacle.x, obstacle.y, margin)) continue;
      drawObstacle(obstacle);
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
      if (drop.type === "coin") {
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

    for (const formation of state.formations) {
      if (formation.x < camera.x - 120 || formation.x > camera.x + view.width + 120
        || formation.y < camera.y - 80 || formation.y > camera.y + view.height + 80) continue;
      context.save();
      context.translate(formation.x, formation.y);
      context.rotate(formation.heading);
      context.fillStyle = "rgba(126, 43, 31, 0.055)";
      context.beginPath();
      context.rect(-(formation.halfWidth || 116), -(formation.halfHeight || 86), (formation.halfWidth || 116) * 2, (formation.halfHeight || 86) * 2);
      context.fill();
      context.strokeStyle = "rgba(112, 39, 31, 0.2)";
      context.lineWidth = 1;
      context.setLineDash([7, 8]);
      context.stroke();
      context.setLineDash([]);
      context.restore();
      context.font = "bold 11px serif";
      context.textAlign = "center";
      const formationName = translate(formation.nameKey);
      const labelWidth = context.measureText(formationName).width + 14;
      context.fillStyle = "rgba(39, 42, 30, 0.74)";
      context.fillRect(formation.x - labelWidth / 2, formation.y - (formation.halfHeight || 86) - 21, labelWidth, 16);
      context.fillStyle = "#f5dfb0";
      context.fillText(formationName, formation.x, formation.y - (formation.halfHeight || 86) - 9);
    }

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

    for (const particle of state.particles) {
      const size = particle.size ?? 3;
      const reach = size + (particle.growth ?? 0);
      if (!inView(particle.x, particle.y, reach + 8)) continue;
      // Never divide by the old hard-coded 0.52s: dust lives longer, and an
      // alpha above 1 is rejected by the canvas, which would freeze the fade.
      const maxLife = particle.maxLife ?? effectRules.particleFadeSeconds;
      const alpha = Math.min(1, Math.max(0, particle.life / maxLife));
      if (particle.kind === "ring") {
        const radius = size + (particle.growth ?? 0) * (1 - alpha);
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

    context.strokeStyle = "rgba(111, 64, 35, 0.45)";
    context.lineWidth = 2;
    context.strokeRect(0, 0, world.width, world.height);
    context.restore();

    if (state.damageFlash > 0) {
      context.fillStyle = `rgba(135, 37, 25, ${state.damageFlash * 0.3})`;
      context.fillRect(0, 0, view.width, view.height);
    }
  }

  return { draw };
}
