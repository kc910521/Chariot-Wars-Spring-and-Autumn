import { createSpriteArt } from "../render/sprites.js";
import { campSeats, crewBanner, crewFigure, playerRobe, projectRigBox, rigPreview } from "./shop-layout.js";

// The preview runs on its own clock at 30fps. The battlefield gait is a pure
// function of elapsed seconds, so the shop shows the very same trot without ever
// asking the battle loop for a frame - and pausing the game (or sitting in the
// shop) does not freeze the rig mid-stride.
const frameInterval = 1000 / 30;
const maxPixelRatio = 2.5;
const startTime = 0.9;

// Grass tufts on the rig's ground patch, as fractions of the patch radius. Fixed
// offsets, not a random scatter: the dossier is redrawn every frame and scenery
// that reshuffles reads as a glitch.
const tufts = [
  [-0.82, 0.18, 0.9], [-0.52, 0.52, 0.7], [-0.16, 0.66, 1], [0.24, 0.6, 0.8],
  [0.62, 0.4, 0.95], [0.86, 0.06, 0.7], [-0.68, -0.24, 0.75], [0.54, -0.3, 0.85],
];

export function createShopScene({ rigCanvas, campCanvas }) {
  const rigContext = rigCanvas?.getContext?.("2d") ?? null;
  const campContext = campCanvas?.getContext?.("2d") ?? null;
  const rigArt = rigContext ? createSpriteArt({ context: rigContext }) : null;
  const campArt = campContext ? createSpriteArt({ context: campContext }) : null;

  // `snapshot` is what the campaign owns, `preview` a hovered purchase. The
  // preview is dropped on every render, so a pointer that leaves mid-hover cannot
  // leave the dossier showing a chariot the player never bought.
  let snapshot = { horseCount: 1, crew: [] };
  let preview = null;
  let active = false;
  let elapsed = startTime;
  let lastStamp = 0;
  let lastDraw = 0;
  let frameId = 0;
  const lastFrames = { rig: null, camp: null };

  function prefersReducedMotion() {
    const media = globalThis.window?.matchMedia?.("(prefers-reduced-motion: reduce)");
    return Boolean(media?.matches);
  }

  // The campaign's roster keeps its dead, because the ledger lists them; the two
  // canvases only ever draw the living, so the filter lives here where both
  // read from it.
  function target() {
    const source = preview ?? snapshot;
    const crew = (source.crew ?? snapshot.crew).filter((member) => member.alive !== false);
    return {
      horseCount: Math.max(1, Math.round(source.horseCount ?? snapshot.horseCount)),
      crew,
      isPreview: preview !== null,
    };
  }

  // Size the backing store from the CSS box, like `resizeCanvas` does for the
  // battlefield. A hidden shop measures 0x0, and the smoke harness runs every
  // canvas off one shared context - a zero-sized draw has to be a no-op, not a
  // guess.
  function measure(canvas, context) {
    const rect = canvas.getBoundingClientRect?.();
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
    const ratio = Math.min(globalThis.window?.devicePixelRatio || 1, maxPixelRatio);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { width: rect.width, height: rect.height, ratio };
  }

  function drawRigGround(context, view, rig) {
    const footprint = projectRigBox(rig.box, rig);
    const turf = {
      x: (footprint.minX + footprint.maxX) / 2,
      y: footprint.maxY - (footprint.maxY - footprint.minY) * 0.06,
      radiusX: (footprint.maxX - footprint.minX) * 0.58,
      radiusY: Math.max(10, (footprint.maxY - footprint.minY) * 0.2),
    };

    const light = context.createRadialGradient(
      view.width * 0.5, view.height * 0.55, 2,
      view.width * 0.5, view.height * 0.55, Math.max(view.width, view.height) * 0.78,
    );
    light.addColorStop(0, "rgba(214, 168, 96, 0.17)");
    light.addColorStop(0.55, "rgba(168, 116, 62, 0.07)");
    light.addColorStop(1, "rgba(24, 18, 13, 0)");
    context.fillStyle = light;
    context.fillRect(0, 0, view.width, view.height);

    // A brushed patch of dry grass under the team, so the rig stands on ground
    // instead of floating on the panel's background.
    const turfFill = context.createRadialGradient(turf.x, turf.y, 1, turf.x, turf.y, Math.max(turf.radiusX, turf.radiusY));
    turfFill.addColorStop(0, "rgba(74, 92, 58, 0.55)");
    turfFill.addColorStop(0.72, "rgba(58, 72, 48, 0.34)");
    turfFill.addColorStop(1, "rgba(58, 72, 48, 0)");
    context.fillStyle = turfFill;
    context.beginPath();
    context.ellipse(turf.x, turf.y, turf.radiusX, turf.radiusY, 0, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = "rgba(126, 148, 96, 0.5)";
    context.lineWidth = 1;
    context.beginPath();
    for (const [offsetX, offsetY, size] of tufts) {
      const x = turf.x + offsetX * turf.radiusX;
      const y = turf.y + offsetY * turf.radiusY;
      const height = 4 + size * 4;
      context.moveTo(x, y);
      context.lineTo(x - 1.5 * size, y - height);
      context.moveTo(x, y);
      context.lineTo(x + 0.6 * size, y - height * 0.8);
    }
    context.stroke();
  }

  function drawRig(time) {
    if (!rigArt) return;
    const view = measure(rigCanvas, rigContext);
    if (!view) return;
    const { horseCount, crew, isPreview } = target();
    const rig = rigPreview(horseCount, view.width, view.height);
    const context = rigContext;

    context.clearRect(0, 0, view.width, view.height);
    drawRigGround(context, view, rig);

    context.save();
    context.translate(view.width / 2, view.height / 2);
    context.rotate(rig.angle);
    context.scale(rig.scale, rig.scale);
    context.translate(-rig.centerX, -rig.centerY);
    rigArt.drawChariotRig({
      robeColor: playerRobe,
      horseCount,
      elapsed: time,
      crew,
      banner: crewBanner,
    });
    context.restore();

    lastFrames.rig = {
      horseCount,
      crew: crew.length,
      isPreview,
      scale: rig.scale,
      angle: rig.angle,
      width: view.width,
      height: view.height,
      time,
    };
  }

  function drawSeat(context, seat, member) {
    const figure = crewFigure(member?.role);
    const scale = (seat.near ? 1.02 : 0.9) * 1.05;

    context.save();
    context.translate(seat.x, seat.y);
    context.rotate(seat.facing);
    context.scale(scale, scale);
    campArt.drawFootFigure({
      robeColor: figure.robeColor,
      friendly: true,
      overlays: figure.overlays,
      hitFlash: 0,
    });
    context.restore();
  }

  function drawFire(context, centerX, centerY, radius, time) {
    // Stones, logs, then the flame body. The caller draws the far seats first and
    // the near ones after, so the fire reads as sitting inside the ring.
    context.fillStyle = "#423931";
    for (let index = 0; index < 9; index += 1) {
      const angle = index * Math.PI * 2 / 9 + 0.3;
      context.beginPath();
      context.ellipse(
        centerX + Math.cos(angle) * radius * 0.34,
        centerY + Math.sin(angle) * radius * 0.24 + radius * 0.06,
        radius * 0.075, radius * 0.05, angle, 0, Math.PI * 2,
      );
      context.fill();
    }

    context.strokeStyle = "#4a3524";
    context.lineWidth = Math.max(2, radius * 0.06);
    for (const tilt of [-0.5, 0.42]) {
      context.beginPath();
      context.moveTo(centerX - Math.cos(tilt) * radius * 0.18, centerY + radius * 0.08);
      context.lineTo(centerX + Math.cos(tilt) * radius * 0.18, centerY + radius * 0.02);
      context.stroke();
    }

    const flicker = Math.sin(time * 7.1) * 0.08 + Math.sin(time * 11.3) * 0.05;
    const layers = [
      { scale: 1 + flicker, fill: "rgba(226, 126, 48, 0.55)", lift: 0.5 },
      { scale: 0.74 + flicker * 0.6, fill: "rgba(238, 166, 62, 0.85)", lift: 0.62 },
      { scale: 0.44 + flicker * 0.4, fill: "rgba(250, 224, 150, 0.95)", lift: 0.78 },
    ];
    for (const layer of layers) {
      const tip = centerY - radius * layer.lift * layer.scale;
      context.fillStyle = layer.fill;
      context.beginPath();
      context.moveTo(centerX, tip);
      context.quadraticCurveTo(
        centerX + radius * 0.2 * layer.scale, centerY - radius * 0.16,
        centerX + radius * 0.13 * layer.scale, centerY + radius * 0.06,
      );
      context.quadraticCurveTo(centerX, centerY + radius * 0.16, centerX - radius * 0.13 * layer.scale, centerY + radius * 0.06);
      context.quadraticCurveTo(centerX - radius * 0.2 * layer.scale, centerY - radius * 0.16, centerX, tip);
      context.fill();
    }

    for (let index = 0; index < 5; index += 1) {
      const drift = (time * 0.42 + index * 0.21) % 1;
      const sparkX = centerX + Math.sin(index * 2.4 + time * 1.7) * radius * 0.16 * (0.4 + drift);
      const sparkY = centerY - radius * 0.24 - drift * radius * 0.9;
      context.fillStyle = `rgba(248, 196, 108, ${(1 - drift) * 0.85})`;
      context.beginPath();
      context.arc(sparkX, sparkY, Math.max(0.8, radius * 0.018 * (1 - drift * 0.5)), 0, Math.PI * 2);
      context.fill();
    }
  }

  function drawCamp(time) {
    if (!campArt) return;
    const view = measure(campCanvas, campContext);
    if (!view) return;
    const context = campContext;
    const centerX = view.width * 0.5;
    const centerY = view.height * 0.52;
    const radius = Math.min(view.width * 0.3, view.height * 0.44);
    const { crew } = target();

    context.clearRect(0, 0, view.width, view.height);
    const night = context.createLinearGradient(0, 0, 0, view.height);
    night.addColorStop(0, "#15110d");
    night.addColorStop(0.55, "#201810");
    night.addColorStop(1, "#17120e");
    context.fillStyle = night;
    context.fillRect(0, 0, view.width, view.height);

    const glow = context.createRadialGradient(centerX, centerY, 1, centerX, centerY, radius * 3.1);
    glow.addColorStop(0, "rgba(255, 196, 96, 0.34)");
    glow.addColorStop(0.36, "rgba(226, 132, 54, 0.16)");
    glow.addColorStop(1, "rgba(24, 18, 13, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, view.width, view.height);

    // Fixed-offset embers in the dark: the scene reads as night without a random
    // source that would make two frames differ for no reason.
    context.fillStyle = "rgba(226, 206, 158, 0.5)";
    for (let index = 0; index < 14; index += 1) {
      const x = view.width * ((index * 97 % 100) / 100);
      const y = view.height * ((index * 61 % 46) / 100);
      context.globalAlpha = (0.45 + 0.55 * Math.abs(Math.sin(time * 0.9 + index))) * 0.5;
      context.beginPath();
      context.arc(x, y, 1.1, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;

    const seats = campSeats(crew.length + 1, { centerX, centerY, radius });
    const behind = seats.filter((seat) => !seat.near);
    const front = seats.filter((seat) => seat.near);
    for (const seat of behind) drawSeat(context, seat, seat.index === 0 ? null : crew[seat.index - 1]);
    drawFire(context, centerX, centerY, radius, time);
    for (const seat of front) drawSeat(context, seat, seat.index === 0 ? null : crew[seat.index - 1]);

    lastFrames.camp = {
      crew: crew.length,
      seats: seats.length,
      radius,
      width: view.width,
      height: view.height,
      time,
    };
  }

  function draw(time = elapsed) {
    drawRig(time);
    drawCamp(time);
  }

  function schedule() {
    if (!active || frameId || prefersReducedMotion()) return;
    if (typeof globalThis.requestAnimationFrame !== "function") return;
    frameId = globalThis.requestAnimationFrame(frame);
  }

  function frame(stamp) {
    frameId = 0;
    if (!active) return;
    // The frame clock is the rAF timestamp, never `performance.now()`: the loop
    // contract is that one source owns time, and this scene obeys it too.
    const delta = lastStamp ? Math.min(0.1, Math.max(0, (stamp - lastStamp) / 1000)) : 1 / 30;
    lastStamp = stamp;
    elapsed += delta;
    if (lastDraw === 0 || stamp - lastDraw >= frameInterval) {
      lastDraw = stamp;
      draw(elapsed);
    }
    schedule();
  }

  // The shop screen is the only thing that keeps the preview running: a hidden
  // shop cancels its frame, so nothing paints a page nobody is looking at.
  function setActive(next) {
    active = Boolean(next);
    if (!active) {
      if (frameId) globalThis.cancelAnimationFrame?.(frameId);
      frameId = 0;
      lastStamp = 0;
      lastDraw = 0;
      return;
    }
    draw(elapsed);
    schedule();
  }

  function update(next) {
    snapshot = {
      horseCount: Math.max(1, Math.round(next?.horseCount ?? 1)),
      crew: next?.crew ?? [],
    };
    preview = null;
    if (active) draw(elapsed);
  }

  function previewPurchase(next) {
    preview = next ? {
      horseCount: Math.max(1, Math.round(next.horseCount ?? snapshot.horseCount)),
      crew: next.crew ?? snapshot.crew,
    } : null;
    if (active) draw(elapsed);
  }

  return {
    setActive,
    update,
    preview: previewPurchase,
    draw,
    // What each canvas drew last, for the smoke test and for a manual check in a
    // browser console: `__h5game.shopScene.lastFrame()`.
    lastFrame: () => ({ ...lastFrames }),
  };
}
