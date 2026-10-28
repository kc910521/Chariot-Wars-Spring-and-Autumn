import { groundVisual } from "../data/elements.js";
import { hashNoise } from "../utils/math.js";

// The battlefield floor. Three cheap passes, every one of them anchored to world
// coordinates, so the texture stays where it is while the camera slides over it:
//
//   1. one flat wash over the viewport,
//   2. a soft blob of turned soil, shade or bleached dust per lattice cell,
//   3. a sparse tuft of short grass - or a speck of grit - per detail cell.
//
// There is deliberately no grid. The 40px lattice this replaced read as a
// prototype, and its long straight lines were the strongest edges on the field,
// which is the one thing a low-contrast ground cannot afford. Mottling and flecks
// give the same "this is a surface you are moving over" cue without an edge.
//
// Nothing here is random per frame: every fleck is hashed from its own cell, so
// the same field paints identically on every frame (no flicker) and a draw trace
// (H5_TRACE_DRAW) stays comparable between two refactors. The palette, the
// spacing and the density all come from `groundVisual` in src/data/elements.js.
export function createGroundPainter({ context }) {
  const { base, wash, fleck, grit } = groundVisual;

  // Which cells of a world-space lattice can reach the viewport. One spare ring
  // on every side, because a blob is jittered inside its cell and can be wider
  // than the cell itself; the `ceil` already covers the partial cell at the far
  // edge, so this is the tight fit and not a generous one - every spare cell is a
  // full alpha fill that costs a frame.
  function lattice(start, cell, span) {
    return { first: Math.floor(start / cell) - 1, count: Math.ceil(span / cell) + 2 };
  }

  // A point inside the cell, but never on its edge: the jitter is what keeps the
  // lattice from reading as a lattice.
  function cellPoint(cellX, cellY, spacing, salt) {
    return {
      x: (cellX + 0.15 + hashNoise(cellX, cellY, salt) * 0.7) * spacing,
      y: (cellY + 0.15 + hashNoise(cellX, cellY, salt + 1) * 0.7) * spacing,
    };
  }

  function paintWashes(cameraX, cameraY, width, height) {
    const columns = lattice(cameraX, wash.spacing, width);
    const rows = lattice(cameraY, wash.spacing, height);
    for (let cellY = rows.first; cellY < rows.first + rows.count; cellY += 1) {
      for (let cellX = columns.first; cellX < columns.first + columns.count; cellX += 1) {
        const { x, y } = cellPoint(cellX, cellY, wash.spacing, 1);
        const radius = wash.radius[0] + hashNoise(cellX, cellY, 3) * (wash.radius[1] - wash.radius[0]);
        const tone = wash.tones[Math.floor(hashNoise(cellX, cellY, 4) * wash.tones.length)];
        // A radial gradient rather than an alpha ellipse: the blob has to fade to
        // nothing, or its rim becomes exactly the edge this floor must not have.
        // The hold at 0.45 keeps a solid core, so the fade reads as a patch of
        // different soil instead of a gaussian smudge. It fills the blob's box
        // rather than a path: outside the radius the last stop is already
        // transparent, so a path would only cost two more calls.
        const blob = context.createRadialGradient(x, y, Math.max(1, radius * 0.05), x, y, radius);
        blob.addColorStop(0, tone.core);
        blob.addColorStop(0.45, tone.core);
        blob.addColorStop(1, tone.edge);
        context.fillStyle = blob;
        context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
    }
  }

  function paintTuft(cellX, cellY) {
    const { x, y } = cellPoint(cellX, cellY, fleck.spacing, 6);
    const spread = fleck.blades[1] - fleck.blades[0];
    const blades = fleck.blades[0] + Math.floor(hashNoise(cellX, cellY, 8) * (spread + 1));
    // One tone and one path for the whole tuft: a tuft is two or three blades, so
    // stroking them separately would triple the canvas calls for no visible gain.
    context.lineWidth = fleck.width;
    context.strokeStyle = fleck.colors[Math.floor(hashNoise(cellX, cellY, 13) * fleck.colors.length)];
    context.beginPath();
    for (let blade = 0; blade < blades; blade += 1) {
      // Each blade of a tuft takes its own roll for root, height and lean, so a
      // tuft is a little clump of grass and not one brush stroke.
      const height = fleck.height[0] + hashNoise(cellX + blade * 7, cellY, 9) * (fleck.height[1] - fleck.height[0]);
      const lean = (hashNoise(cellX + blade * 7, cellY, 10) - 0.5) * fleck.lean * height;
      const rootX = x + (hashNoise(cellX + blade * 3, cellY, 11) - 0.5) * 7;
      const rootY = y + (hashNoise(cellX, cellY + blade * 3, 12) - 0.5) * 5;
      context.moveTo(rootX, rootY);
      context.quadraticCurveTo(rootX + lean * 0.4, rootY - height * 0.6, rootX + lean, rootY - height);
    }
    context.stroke();
  }

  function paintGrit(cellX, cellY) {
    const { x, y } = cellPoint(cellX, cellY, fleck.spacing, 14);
    const size = grit.size[0] + Math.round(hashNoise(cellX, cellY, 15) * (grit.size[1] - grit.size[0]));
    context.fillStyle = grit.colors[Math.floor(hashNoise(cellX, cellY, 16) * grit.colors.length)];
    context.fillRect(x, y, size, size);
    // One speck is grain; a second one makes it a clod of soil.
    if (hashNoise(cellX, cellY, 17) < 0.5) {
      context.fillRect(x + size + 2, y - size, size, size);
    }
  }

  function paintDetail(cameraX, cameraY, width, height) {
    const columns = lattice(cameraX, fleck.spacing, width);
    const rows = lattice(cameraY, fleck.spacing, height);
    for (let cellY = rows.first; cellY < rows.first + rows.count; cellY += 1) {
      for (let cellX = columns.first; cellX < columns.first + columns.count; cellX += 1) {
        // One roll per cell decides what grows there: grass, grit, or bare soil.
        const roll = hashNoise(cellX, cellY, 20);
        if (roll < fleck.chance) paintTuft(cellX, cellY);
        else if (roll < fleck.chance + grit.chance) paintGrit(cellX, cellY);
      }
    }
  }

  // `cameraX`/`cameraY` are the world coordinates of the viewport's top-left, so
  // this paints in world space exactly like every other layer.
  function drawGround(cameraX, cameraY, width, height) {
    context.fillStyle = base;
    context.fillRect(cameraX, cameraY, width, height);
    paintWashes(cameraX, cameraY, width, height);
    paintDetail(cameraX, cameraY, width, height);
  }

  return { drawGround };
}
