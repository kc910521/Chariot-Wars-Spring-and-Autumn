import { cloudKinds, obstacleKinds, terrainKinds } from "../data/elements.js";

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

  function drawCanopy(obstacle, art) {
    const { x, y, radius } = obstacle;

    context.fillStyle = art.shadow;
    context.beginPath();
    context.ellipse(x + 7, y + radius * 0.58, radius * 1.08, radius * 0.55, -0.08, 0, TAU);
    context.fill();

    const trunkGradient = context.createLinearGradient(x - radius * 0.2, y - radius * 0.3, x + radius * 0.3, y + radius * 0.5);
    trunkGradient.addColorStop(0, art.trunk[0]);
    trunkGradient.addColorStop(0.42, art.trunk[1]);
    trunkGradient.addColorStop(1, art.trunk[2]);
    context.fillStyle = trunkGradient;
    context.beginPath();
    context.moveTo(x - radius * 0.28, y + radius * 0.48);
    context.lineTo(x - radius * 0.18, y - radius * 0.36);
    context.lineTo(x + radius * 0.2, y - radius * 0.42);
    context.lineTo(x + radius * 0.32, y + radius * 0.48);
    context.closePath();
    context.fill();
    context.strokeStyle = art.trunkEdge;
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
    canopyGradient.addColorStop(0, art.canopy[0]);
    canopyGradient.addColorStop(0.42, art.canopy[1]);
    canopyGradient.addColorStop(0.82, art.canopy[2]);
    canopyGradient.addColorStop(1, art.canopy[3]);
    context.fillStyle = canopyGradient;
    // Lobes are offset by a hash of the position, so no two canopies have the
    // same outline without needing per-tree randomness at spawn time.
    const lobes = art.lobes;
    const canopyPoints = Array.from({ length: lobes }, (_, index) => {
      const angle = index * TAU / lobes;
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
    context.strokeStyle = art.canopyEdge;
    context.lineWidth = 1;
    context.stroke();

    // Foliage clusters: lumpy radial blobs, alternating palette by index so the
    // canopy does not read as one flat mass.
    art.clusters.forEach(([offsetX, offsetY, width, height], index) => {
      const clusterX = x + (offsetX + Math.sin(index * 2 + x) * 0.035) * radius;
      const clusterY = y + (offsetY + Math.cos(index * 1.7 + y) * 0.035) * radius;
      const clusterWidth = width * radius;
      const clusterHeight = height * radius;
      const clusterGradient = context.createRadialGradient(
        clusterX - clusterWidth * 0.24, clusterY - clusterHeight * 0.3, clusterHeight * 0.03,
        clusterX, clusterY, clusterWidth,
      );
      const tone = index % 2;
      clusterGradient.addColorStop(0, art.clusterRim[tone]);
      clusterGradient.addColorStop(0.58, art.clusterBody[tone]);
      clusterGradient.addColorStop(1, art.clusterFade);
      context.fillStyle = clusterGradient;
      context.beginPath();
      context.ellipse(clusterX, clusterY, clusterWidth, clusterHeight, index * 0.29, 0, TAU);
      context.fill();
    });

    for (let leaf = 0; leaf < art.leaves; leaf += 1) {
      const angle = leaf * 2.399 + x * 0.013 + y * 0.009;
      const distance = radius * (0.12 + ((leaf * 5 + Math.floor(x + y)) % 9) * 0.072);
      const leafX = x + Math.cos(angle) * distance;
      const leafY = y + Math.sin(angle) * distance * 0.72;
      context.fillStyle = art.leaf[leaf % art.leaf.length];
      context.beginPath();
      context.ellipse(leafX, leafY, radius * 0.085, radius * 0.045, angle, 0, TAU);
      context.fill();
    }

    context.strokeStyle = art.twig;
    context.lineWidth = Math.max(1.4, radius * 0.075);
    context.beginPath();
    context.moveTo(x, y + radius * 0.22);
    context.quadraticCurveTo(x + radius * 0.1, y - radius * 0.08, x - radius * 0.34, y - radius * 0.42);
    context.moveTo(x + radius * 0.03, y + radius * 0.08);
    context.quadraticCurveTo(x + radius * 0.14, y - radius * 0.16, x + radius * 0.42, y - radius * 0.38);
    context.stroke();
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

  const OBSTACLE_ART = { palisade: drawPalisade, canopy: drawCanopy };
  const CLOUD_ART = { shadow: drawCloudPuffs };

  // An unknown type draws as the row it most closely resembles - a canopy for
  // obstacles, blades for terrain, the sky puff for clouds - which is exactly what
  // the `if (type === ...) ... else ...` chains these replace used to do.
  function drawObstacle(obstacle) {
    const visual = obstacleKinds[obstacle.type]?.visual ?? obstacleKinds.tree.visual;
    (OBSTACLE_ART[visual.kind] ?? drawCanopy)(obstacle, visual);
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
    drawObstacle, drawTerrain, drawCloud,
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
