// Battlefield unit art, in unit-local space, shared by the world renderer and by
// anything else that wants the same silhouette (the shop's rig preview, the camp
// fireside). The caller owns translate/rotate/scale, the ground shadow and the
// health bar; this module only paints the body, so a shop preview can never drift
// from what the player sees mid-battle.
//
// Extending the look: add a branch here, or an overlay in the tables below, and
// every consumer (battlefield, shop, camp) picks it up in the same commit.

export const CHARIOT_RIG_BASE_SCALE = 1.2;

// Faction colours for the shared silhouettes. The world renderer and the shop's
// dossier both paint from this table, so a preview cannot show a team in colours
// the battlefield never uses.
export const spritePalette = Object.freeze({
  playerRobe: "#17796f",
  playerBanner: "#41b7a3",
  allyRobe: "#398b63",
  enemyRobe: "#a74732",
  enemyBanner: "#f27a50",
});

// Local-space extent of the chariot rig, in the units the caller scales by.
// The hull spans -15..11, the banner mast tops out at -25, the wheels sit at
// +-22, and the horse team - plus the rig's own ground shadow, which widens the
// box to -16..52 - grows by 14 units a side for every extra horse. A silhouette
// change that outgrows this box fails the unit test that measures the real
// drawing calls, and the shop's fit-to-box follows the constants here.
export function chariotRigBox(horseCount = 1) {
  const span = (Math.max(1, horseCount) - 1) / 2 * 14;
  const minX = -16;
  const maxX = 52;
  const minY = -Math.max(25, span + 9);
  // The gait swings the hooves 2 units past the leg tips.
  const maxY = Math.max(22, span + 11);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}


// One painter bound to one 2d context, mirroring createElementRenderer.
export function createSpriteArt({ context }) {
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

  // The chariot rig: hull, wheels, pole, the horse team and the crew dots.
  // `horseCount` is the team the campaign owns, `elapsed` drives the gait,
  // `crew` draws the same dots the battlefield shows along the hull,
  // `overlays` is the data row's kit and `banner` the flag colour.
  function drawChariotRig({
    robeColor, horseCount = 1, elapsed = 0, crew = [], overlays = [], banner = spritePalette.enemyBanner,
  }) {
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
    for (let horseIndex = 0; horseIndex < horseCount; horseIndex += 1) {
      const horseY = (horseIndex - (horseCount - 1) / 2) * 14;
      const gait = Math.sin(elapsed * 9 + horseIndex * 1.7) * 2;
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
    context.fillStyle = banner;
    context.beginPath();
    context.moveTo(-12, -24);
    context.lineTo(1, -20);
    context.lineTo(-12, -15);
    context.closePath();
    context.fill();
    // Crew kit the row asks for, then one dot per rider the roster actually has.
    for (const overlay of overlays) CHARIOT_OVERLAYS[overlay]?.();
    for (let index = 0; index < Math.min(crew.length, 4); index += 1) {
      context.fillStyle = crew[index].role === "archer" ? "#88bd8a" : "#d7b574";
      context.beginPath();
      context.arc(-10 + index * 7, 0, 2.5, 0, Math.PI * 2);
      context.fill();
      if (crew[index].role === "archer") {
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

  // The foot silhouette - the default, shared by the ranks and by anyone walking.
  // `friendly` swaps the enemy rust for the player/ally greens, `hitFlash` whitens
  // the robe and the plate on a hit, `overlays` is the row's armour and weapon.
  function drawFootFigure({ robeColor, friendly = false, overlays = ["sword"], hitFlash = 0 }) {
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
    clothGradient.addColorStop(0, friendly ? "#55a78a" : "#e0a568");
    clothGradient.addColorStop(0.42, robeColor);
    clothGradient.addColorStop(1, friendly ? "#124f48" : "#63362e");
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
    for (const overlay of overlays) FOOT_OVERLAYS[overlay]?.({ hitFlash });
  }

  return {
    drawChariotRig,
    drawFootFigure,
    // What the art can paint, so a data row asking for kit nobody drew is a test
    // failure instead of a silently missing weapon.
    overlayKinds: {
      foot: Object.keys(FOOT_OVERLAYS),
      chariot: Object.keys(CHARIOT_OVERLAYS),
    },
  };
}
