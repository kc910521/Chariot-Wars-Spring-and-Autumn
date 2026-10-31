// The projectile painter: what a shot looks like in the air and what it leaves
// stuck in the grass, chosen by name from the shot's own row
// (src/data/projectiles.js). The renderer keeps the camera, the culling, the
// shadow and the transforms; this module owns the silhouettes. `visuals` and
// `decals` are exported so a test can prove every name a data row asks for is
// actually painted.
export function createProjectileArt({ context }) {
  // Faction colours for what flies. The enemy's rust and the player's gold are the
  // two the silhouettes already use, and the hired line keeps the ally olive; a
  // bolt is steel so a piercing shot reads differently from a plain arrow.
  const PALETTE = Object.freeze({
    arrow: Object.freeze({ enemy: "#a53b2b", ally: "#888c56", player: "#f1d28b" }),
    bolt: Object.freeze({ enemy: "#a53b2b", ally: "#cfd6cf", player: "#f1d28b" }),
    stone: Object.freeze({ enemy: "#5f3428", ally: "#5f3428", player: "#5f3428" }),
  });

  // Bodies are drawn in a space already translated onto the shot and rotated onto
  // its heading, so every shape points along +x.
  const BODIES = Object.freeze({
    arrow(color) {
      context.strokeStyle = color;
      context.lineWidth = 2.5;
      context.beginPath();
      context.moveTo(-7, 0);
      context.lineTo(5, 0);
      context.stroke();
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(5, 0);
      context.lineTo(1, -3);
      context.lineTo(1, 3);
      context.closePath();
      context.fill();
    },
    bolt(color) {
      // A quarrel: a shorter, thicker shaft than an arrow's, a stubby wedge head and
      // two vanes at the nock.
      context.strokeStyle = color;
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(-9, 0);
      context.lineTo(3, 0);
      context.stroke();
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(8, 0);
      context.lineTo(2, -4);
      context.lineTo(2, 4);
      context.closePath();
      context.fill();
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(-9, 0);
      context.lineTo(-6, -3);
      context.moveTo(-9, 0);
      context.lineTo(-6, 3);
      context.stroke();
    },
    stone(color, bullet) {
      context.fillStyle = color;
      context.beginPath();
      context.arc(0, 0, bullet.radius ?? 6, 0, Math.PI * 2);
      context.fill();
    },
  });

  // What is left in the ground, drawn in a space translated onto the decal and
  // rotated onto the angle it landed at.
  const DECALS = Object.freeze({
    arrow() {
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
    },
    bolt() {
      // Shorter and thicker than the arrow, with a steel head: what is stuck in the
      // grass tells you what was shot at you.
      context.strokeStyle = "#6d5334";
      context.fillStyle = "#aab4b8";
      context.lineWidth = 2.5;
      context.beginPath();
      context.moveTo(-6, 0);
      context.lineTo(7, 0);
      context.stroke();
      context.beginPath();
      context.moveTo(9, 0);
      context.lineTo(5, -3);
      context.lineTo(5, 3);
      context.closePath();
      context.fill();
    },
  });

  function colorFor(bullet) {
    const palette = PALETTE[bullet.rule?.visual] ?? PALETTE.arrow;
    return palette[bullet.owner] ?? palette.player;
  }

  return {
    visuals: Object.keys(BODIES),
    decals: Object.keys(DECALS),
    paint(bullet) {
      (BODIES[bullet.rule?.visual] ?? BODIES.arrow)(colorFor(bullet), bullet);
    },
    paintDecal(decal) {
      (DECALS[decal.kind] ?? DECALS.arrow)(decal);
    },
  };
}
