import { cloudKinds, obstacleKinds, terrainKinds } from "../data/elements.js";
import { effectRules } from "../data/rules.js";

// The art half of the element catalog. Each row picks a silhouette through
// `visual.kind`, and everything a silhouette can repaint - palette, piece counts,
// spacing - is read from that same row, so a new look is a table change and only
// a genuinely new shape needs a function here.
//
// The silhouette functions are plain closures over `context` created once per
// renderer, not per element, and they paint in world coordinates exactly like the
// code they replace (the terrain drawers are the exception: they run inside a
// translate to the patch centre).

const TAU = Math.PI * 2;

export function createElementRenderer({ context }) {
  function fillRoundedRect(x, y, width, height, radius) {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    context.fill();
  }

  // --- obstacles -------------------------------------------------------------
  function drawPalisade(obstacle, art) {
    const [shadeX, shadeY] = art.shadeOffset;
    context.fillStyle = art.shade;
    fillRoundedRect(obstacle.x + shadeX, obstacle.y + shadeY, obstacle.width, obstacle.height, art.corner);
    context.fillStyle = art.body;
    fillRoundedRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height, art.corner);
    context.fillStyle = art.rim;
    context.fillRect(obstacle.x + art.rimInset, obstacle.y + art.rimInset,
      obstacle.width - art.rimInset * 2, art.rimHeight);
    context.strokeStyle = art.seam;
    context.lineWidth = 2;
    for (let x = obstacle.x + art.postInset; x < obstacle.x + obstacle.width; x += art.postGap) {
      context.beginPath();
      context.moveTo(x, obstacle.y + 4);
      context.lineTo(x, obstacle.y + obstacle.height - 4);
      context.stroke();
    }
  }

  function drawCanopy(obstacle, art, elapsed = 0) {
    const { x, y, radius } = obstacle;
    // The shadow stays on the ground; everything above the root line leans. It is
    // kept inside `elementCullMargin` (radius + 8) so a tree cannot pop in at the
    // edge of the screen a pixel before its crown is drawn.
    context.fillStyle = art.shadow;
    context.beginPath();
    context.ellipse(x + radius * 0.12, y + radius * 0.58, radius * 1.04, radius * 0.55, -0.08, 0, TAU);
    context.fill();

    const rootY = y + radius * 0.48;
    context.save();
    context.translate(x, rootY);
    context.rotate(treeSwayAngle(obstacle, elapsed, art, effectRules.treeHit));
    context.translate(-x, -rootY);

    const trunkGradient = context.createLinearGradient(x - radius * 0.16, y - radius * 0.2, x + radius * 0.2, y + radius * 0.5);
    trunkGradient.addColorStop(0, art.trunk[0]);
    trunkGradient.addColorStop(0.45, art.trunk[1]);
    trunkGradient.addColorStop(1, art.trunk[2]);
    context.fillStyle = trunkGradient;
    context.strokeStyle = art.trunkEdge;
    context.lineWidth = Math.max(1, radius * 0.04);
    // A slim taper that widens into the roots: a trunk, not the wedge the old
    // silhouette used, which read as a bush with a stake in it.
    context.beginPath();
    context.moveTo(x - radius * 0.14, y + radius * 0.5);
    context.quadraticCurveTo(x - radius * 0.06, y + radius * 0.16, x - radius * 0.05, y - radius * 0.12);
    context.lineTo(x + radius * 0.05, y - radius * 0.12);
    context.quadraticCurveTo(x + radius * 0.07, y + radius * 0.16, x + radius * 0.15, y + radius * 0.5);
    context.closePath();
    context.fill();
    context.stroke();

    // The fork the crown sits on: two limbs out and the leader up the middle.
    context.strokeStyle = art.twig;
    context.lineWidth = Math.max(1.2, radius * 0.05);
    context.beginPath();
    context.moveTo(x, y + radius * 0.06);
    context.lineTo(x - radius * 0.34, y - radius * 0.34);
    context.moveTo(x, y + radius * 0.02);
    context.lineTo(x + radius * 0.3, y - radius * 0.38);
    context.moveTo(x + radius * 0.01, y - radius * 0.04);
    context.lineTo(x + radius * 0.04, y - radius * 0.6);
    context.stroke();

    // A translucent crown wash gives the sprays something to hang on. Kept faint
    // on purpose: an opaque blob is exactly the look this replaces.
    const canopyGradient = context.createRadialGradient(
      x - radius * 0.26, y - radius * 0.42, radius * 0.06,
      x, y - radius * 0.08, radius * 1.05,
    );
    canopyGradient.addColorStop(0, art.canopy[0]);
    canopyGradient.addColorStop(0.42, art.canopy[1]);
    canopyGradient.addColorStop(0.8, art.canopy[2]);
    canopyGradient.addColorStop(1, art.canopy[3]);
    context.globalAlpha = 0.42;
    context.fillStyle = canopyGradient;
    context.beginPath();
    context.ellipse(x, y - radius * 0.08, radius * 0.92, radius * 0.76, 0, 0, TAU);
    context.fill();
    context.globalAlpha = 1;

    // Pinnate sprays: a stem out from the crown centre, leaflets along it. The
    // anchors and their lengths are data, so a different row can grow a different
    // tree from the same painter.
    const leafletLength = radius * art.leafletScale;
    art.clusters.forEach(([offsetX, offsetY, length], index) => {
      const tipX = x + offsetX * radius;
      const tipY = y + (offsetY - 0.08) * radius;
      const reach = length * radius;
      const angle = Math.atan2(tipY - (y - radius * 0.1), tipX - x);
      // The stem starts short of the tip and grows outward: the crown's own body
      // is the middle, so every spray reaches away from it.
      const baseX = tipX - Math.cos(angle) * reach;
      const baseY = tipY - Math.sin(angle) * reach;
      context.strokeStyle = art.twig;
      context.lineWidth = Math.max(1, radius * 0.03);
      context.beginPath();
      context.moveTo(baseX, baseY);
      context.quadraticCurveTo(
        (baseX + tipX) / 2 + Math.sin(index * 1.7 + x) * radius * 0.06,
        (baseY + tipY) / 2 + Math.cos(index * 2.1 + y) * radius * 0.06,
        tipX, tipY,
      );
      context.stroke();

      for (let leaflet = 0; leaflet < art.leaflets; leaflet += 1) {
        const along = 0.2 + (leaflet / Math.max(1, art.leaflets - 1)) * 0.78;
        const stemX = baseX + (tipX - baseX) * along;
        const stemY = baseY + (tipY - baseY) * along;
        const side = leaflet % 2 === 0 ? 1 : -1;
        // Leaflets shrink toward the tip, the way a real pinnate leaf does.
        const size = leafletLength * (1.05 - along * 0.35);
        const leafletAngle = angle + side * 0.85;
        context.fillStyle = art.leaf[(index + leaflet) % art.leaf.length];
        context.beginPath();
        context.ellipse(
          stemX + Math.cos(leafletAngle) * size * 0.55,
          stemY + Math.sin(leafletAngle) * size * 0.55,
          size, size * 0.44, leafletAngle, 0, TAU,
        );
        context.fill();
      }
    });

    context.restore();
  }

  // A tree leans a little all the time, and once more when something hits it.
  // Pure and exported so the unit test can pin the bounds: the painter only ever
  // hands the result to `rotate`, so this is the whole of the motion.
  function treeSwayAngle(obstacle, elapsed = 0, art, hitRules) {
    // Phased by position, so a stand is a grove and not one synchronised mass.
    const phase = (obstacle.x * 0.013 + obstacle.y * 0.017) % TAU;
    let angle = Math.sin(elapsed * art.swayRate + phase) * art.sway;
    const hitAt = obstacle.hitAt;
    if (hitAt !== undefined && hitAt !== null) {
      const since = elapsed - hitAt;
      if (since >= 0 && since < hitRules.duration) {
        angle += Math.sin(since * hitRules.rate) * hitRules.angle * (1 - since / hitRules.duration);
      }
    }
    return angle;
  }

  // --- terrain ---------------------------------------------------------------
  // Every terrain drawer has already been translated to the patch centre and has
  // had the base ellipse filled, so `0, 0` is the middle of the patch.
  const TERRAIN_ART = {
    ripples(patch, art) {
      const half = (art.lines - 1) / 2;
      for (let index = 0; index < art.lines; index += 1) {
        const offset = index - half;
        context.beginPath();
        context.ellipse(0, offset * patch.radiusY * 0.24, patch.radiusX * 0.72, patch.radiusY * 0.12, 0, 0.1, Math.PI - 0.1);
        context.stroke();
      }
    },
    dunes(patch, art) {
      const half = (art.lines - 1) / 2;
      for (let index = 0; index < art.lines; index += 1) {
        const offset = index - half;
        context.beginPath();
        context.moveTo(-patch.radiusX * 0.55, offset * 13);
        context.lineTo(patch.radiusX * 0.55, offset * 13 - 7);
        context.stroke();
      }
    },
    blades(patch, art) {
      for (let blade = 0; blade < art.blades; blade += 1) {
        const x = Math.sin(blade * 17.1) * patch.radiusX * 0.7;
        const y = Math.cos(blade * 9.7) * patch.radiusY * 0.6;
        context.beginPath();
        context.moveTo(x, y + 4);
        context.lineTo(x - 2, y - 4);
        context.stroke();
      }
    },
  };

  // --- clouds ----------------------------------------------------------------
  function drawCloudPuffs(cloud, x, elapsed, art) {
    const breathe = art.breathe.base + Math.sin(elapsed * art.breathe.rate + cloud.phase) * art.breathe.depth;
    context.save();
    context.globalAlpha = cloud.opacity * breathe;
    const shadowGradient = context.createRadialGradient(x, cloud.y + cloud.height * 0.12, cloud.height * 0.08,
      x, cloud.y + cloud.height * 0.12, cloud.width * 0.7);
    shadowGradient.addColorStop(0, art.shade[0]);
    shadowGradient.addColorStop(0.58, art.shade[1]);
    shadowGradient.addColorStop(1, art.shade[2]);
    context.fillStyle = shadowGradient;
    context.beginPath();
    context.ellipse(x, cloud.y + cloud.height * 0.1, cloud.width * 0.68, cloud.height * 0.62, -0.06, 0, TAU);
    context.fill();
    context.globalAlpha = cloud.opacity * breathe * art.bodyAlpha;
    context.fillStyle = art.body;
    context.beginPath();
    context.ellipse(x - cloud.width * 0.28, cloud.y + cloud.height * 0.03, cloud.width * 0.3, cloud.height * 0.34, -0.12, 0, TAU);
    context.ellipse(x - cloud.width * 0.04, cloud.y - cloud.height * 0.1, cloud.width * 0.34, cloud.height * 0.48, -0.06, 0, TAU);
    context.ellipse(x + cloud.width * 0.24, cloud.y, cloud.width * 0.31, cloud.height * 0.37, 0.08, 0, TAU);
    context.ellipse(x + cloud.width * 0.02, cloud.y + cloud.height * 0.12, cloud.width * 0.43, cloud.height * 0.28, 0, 0, TAU);
    context.fill();
    // A lit rim on the upper-left only: enough to read as volume without turning
    // the puff into a white blob against a bright sky.
    context.globalAlpha = cloud.opacity * breathe * art.rimAlpha;
    context.strokeStyle = art.rim;
    context.lineWidth = Math.max(art.rimWidthMin, cloud.height * art.rimWidthRatio);
    context.beginPath();
    context.ellipse(x - cloud.width * 0.04, cloud.y - cloud.height * 0.1, cloud.width * 0.34, cloud.height * 0.48, -0.06,
      Math.PI * 1.08, Math.PI * 1.9);
    context.stroke();
    context.restore();
  }

  // What a felled tree leaves behind: a sawn face, a ring of bark and two root
  // flares. Scenery only - `campaign.stumps` is not in the obstacle list, so
  // nothing collides with it and no sight ray stops on it.
  function drawStump(stump) {
    const { x, y } = stump;
    const radius = Math.max(4, stump.radius ?? 6);
    // The tilt is hashed from the position at fell time, so a clearing full of
    // stumps is not a row of identical discs.
    const tilt = Math.sin(stump.rotation ?? 0) * 0.4;

    context.fillStyle = "rgba(43, 37, 25, 0.24)";
    context.beginPath();
    context.ellipse(x + radius * 0.18, y + radius * 0.52, radius * 1.2, radius * 0.58, 0, 0, TAU);
    context.fill();

    context.fillStyle = "#5b4530";
    context.beginPath();
    context.moveTo(x - radius * 0.85, y + radius * 0.1);
    context.lineTo(x - radius * 1.85, y + radius * 0.7);
    context.lineTo(x - radius * 0.45, y + radius * 0.8);
    context.closePath();
    context.fill();
    context.beginPath();
    context.moveTo(x + radius * 0.85, y + radius * 0.12);
    context.lineTo(x + radius * 1.8, y + radius * 0.72);
    context.lineTo(x + radius * 0.4, y + radius * 0.82);
    context.closePath();
    context.fill();

    context.fillStyle = "#6f5438";
    context.beginPath();
    context.ellipse(x, y, radius, radius * 0.68, tilt, 0, TAU);
    context.fill();
    context.fillStyle = "#d8c49a";
    context.beginPath();
    context.ellipse(x, y - radius * 0.06, radius * 0.84, radius * 0.54, tilt, 0, TAU);
    context.fill();

    context.strokeStyle = "rgba(122, 96, 62, 0.4)";
    context.lineWidth = 1;
    for (const share of [0.62, 0.34]) {
      context.beginPath();
      context.ellipse(x, y - radius * 0.06, radius * 0.84 * share, radius * 0.54 * share, tilt, 0, TAU);
      context.stroke();
    }

    // Splinters where the trunk broke off, so the cut still reads as a cut.
    context.strokeStyle = "#eeddb4";
    context.lineWidth = Math.max(1, radius * 0.1);
    context.beginPath();
    context.moveTo(x - radius * 0.28, y - radius * 0.06);
    context.lineTo(x - radius * 0.12, y - radius * 0.62);
    context.moveTo(x + radius * 0.32, y);
    context.lineTo(x + radius * 0.46, y - radius * 0.5);
    context.stroke();
  }

  const OBSTACLE_ART = { palisade: drawPalisade, canopy: drawCanopy };
  const CLOUD_ART = { shadow: drawCloudPuffs };

  // An unknown type draws as the row it most closely resembles - a canopy for
  // obstacles, blades for terrain, the sky puff for clouds - which is exactly what
  // the `if (type === ...) ... else ...` chains these replace used to do.
  // `elapsed` is the battle clock: only the wind-sensitive silhouettes read it.
  function drawObstacle(obstacle, elapsed = 0) {
    const visual = obstacleKinds[obstacle.type]?.visual ?? obstacleKinds.tree.visual;
    (OBSTACLE_ART[visual.kind] ?? drawCanopy)(obstacle, visual, elapsed);
  }

  function drawTerrain(patch) {
    const visual = terrainKinds[patch.type]?.visual ?? terrainKinds.grass.visual;
    context.save();
    context.translate(patch.x, patch.y);
    context.fillStyle = visual.fill;
    context.beginPath();
    context.ellipse(0, 0, patch.radiusX, patch.radiusY, 0, 0, TAU);
    context.fill();
    context.strokeStyle = visual.stroke;
    context.lineWidth = visual.lineWidth;
    (TERRAIN_ART[visual.kind] ?? TERRAIN_ART.blades)(patch, visual);
    context.restore();
  }

  // `x` is the drifted position: the caller needs it for culling anyway.
  function drawCloud(cloud, x, elapsed) {
    const visual = cloudKinds[cloud.type]?.visual ?? cloudKinds.sky.visual;
    (CLOUD_ART[visual.kind] ?? drawCloudPuffs)(cloud, x, elapsed, visual);
  }

  return {
    drawObstacle, drawTerrain, drawCloud, drawStump, treeSwayAngle,
    // Exposed so the catalog test can prove every row's `visual.kind` has a
    // silhouette behind it: a typo would otherwise only show up as a silent
    // fallback to the default art.
    artKinds: {
      obstacle: Object.keys(OBSTACLE_ART),
      terrain: Object.keys(TERRAIN_ART),
      cloud: Object.keys(CLOUD_ART),
    },
  };
}
