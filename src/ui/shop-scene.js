import { calculateChariotKit } from "../data/equipment.js";
import { createSpriteArt, spritePalette } from "../render/sprites.js";
import { clamp } from "../utils/math.js";
import { campSeats, projectRigBox, rigPreview, roleFigure } from "./shop-layout.js";
import { COLORS } from "./theme.js";
import { roundRectPath } from "./widgets.js";

// The shop's two scenes as painters: `drawRig` (what a purchase would put on the
// field) and `drawCamp` (the night camp the crew sits around instead). Both take
// a rect and a model and return what they painted, so the dossier can place them
// in either shape and a test can prove a seat appeared without reading pixels.
//
// Nothing here owns state or a clock: the time comes from the caller, because the
// shop redraws thirty times a second and a scene that kept its own clock would
// trot at a different speed from the battle it previews.
//
// `createSpriteArt` binds a painter to one context, so the art is built once per
// canvas and cached against it - the context is the identity of the surface, and
// the shop has exactly one.
const artByContext = new WeakMap();

function artFor(context) {
  let art = artByContext.get(context);
  if (!art) {
    art = createSpriteArt({ context });
    artByContext.set(context, art);
  }
  return art;
}

// Grass tufts on the rig's ground patch, as fractions of the patch radius. Fixed
// offsets, not a random scatter: the dossier is redrawn every frame and scenery
// that reshuffles reads as a glitch.
const tufts = [
  [-0.82, 0.18, 0.9], [-0.52, 0.52, 0.7], [-0.16, 0.66, 1], [0.24, 0.6, 0.8],
  [0.62, 0.4, 0.95], [0.86, 0.06, 0.7], [-0.68, -0.24, 0.75], [0.54, -0.3, 0.85],
];

// Hired lines pitch their tents beside the fire, one on each flank. Fixed
// fractions of the camp rect (x) and of the seat radius (y), in draw order (left
// first), because a camp that rearranges itself every frame reads as a glitch
// rather than as a hire.
const tentSpots = [
  { x: -0.3, y: -0.34, scale: 1 },
  { x: 0.3, y: -0.2, scale: 0.88 },
];

// The green a preview is drawn in: the same stroke the radar's dashed polygon
// uses, so "not paid for yet" looks the same in both scenes.
const PREVIEW_STROKE = "#8ec88c";

const CAMP = Object.freeze({
  stoneCount: 9,
  emberCount: 5,
  seatSquash: 0.62,
  // A seated figure is this tall against the ring radius, and the foot sprite
  // occupies `figureUnits` of art space, so the camp scales the real silhouette
  // instead of carrying a pixel size of its own.
  figureHeight: 0.4,
  figureUnits: 28,
  flicker: 7.1,
  glowPulse: 5.3,
});

// The team, drawn inside the rect the layout gave it. `vignette` is the team's
// own column on a phone: a tall portrait box, where a team scaled to the width
// would leave a hand's width of empty panel above and below, so the column keeps a
// band at the top for the night glow and one at the bottom for the caption and the
// team takes the middle.
//
// `model` is { horseCount, crew, levels, time, previewing, vignette }: the living
// crew, the chassis the campaign owns (or would own, for a pressed row) and
// whether the whole thing is only a preview.
export function drawRig(context, rect, model = {}) {
  const horseCount = clamp(Math.round(model.horseCount ?? 1), 1, 4);
  const living = (model.crew ?? []).filter((member) => member && member.alive !== false);
  const vignette = Boolean(model.vignette);
  const topBand = vignette ? rect.height * 0.06 : 0;
  const bottomBand = vignette ? rect.height * 0.14 : 0;
  const bandHeight = Math.max(20, rect.height - topBand - bottomBand);
  const band = {
    x: rect.x, y: rect.y + topBand, width: rect.width, height: bandHeight,
  };
  // The chassis the campaign has bought (or would buy, for a pressed row): the
  // same rack, box and blades the next battle drives, fitted by the same box.
  const kit = calculateChariotKit(model.levels ?? {});
  const rig = rigPreview(horseCount, band, { kit });
  const centreX = band.x + band.width / 2;
  const centreY = band.y + band.height / 2;

  if (vignette) {
    // The team's own column keeps the evening the camp next door has: a glow at
    // the top, and the ground the rig is parked on at the bottom.
    const glow = context.createRadialGradient(
      rect.x + rect.width / 2, rect.y + rect.height * 0.74, 3,
      rect.x + rect.width / 2, rect.y + rect.height * 0.74, rect.width * 0.8,
    );
    glow.addColorStop(0, "rgba(206, 140, 78, 0.17)");
    glow.addColorStop(1, "rgba(120, 78, 44, 0)");
    context.fillStyle = glow;
    context.fillRect(rect.x, rect.y, rect.width, rect.height);
    fillEllipse(
      context, rect.x + rect.width / 2, rect.y + rect.height - bottomBand * 0.5,
      rect.width * 0.44, Math.max(3, rect.height * 0.03), "rgba(146, 157, 109, 0.13)",
    );
  }

  // The ground the rig is parked on, in screen space under the fitted box, so it
  // stays under the wheels whichever way the column turns the rig.
  fillEllipse(
    context, centreX, centreY + rig.projected.maxY * rig.scale,
    rig.width * 0.42, Math.max(2, rig.width * 0.07), "rgba(146, 157, 109, 0.12)",
  );

  if (!vignette) {
    // The stacked dossier has the room for a proper patch of dry grass, so the rig
    // stands on ground instead of floating on the panel's background.
    drawRigGround(context, rect, rig);
  }

  context.save();
  context.translate(centreX, centreY);
  context.rotate(rig.angle);
  context.scale(rig.scale, rig.scale);
  context.translate(-(rig.box.minX + rig.box.maxX) / 2, -(rig.box.minY + rig.box.maxY) / 2);

  artFor(context).drawChariotRig({
    robeColor: spritePalette.playerRobe,
    banner: spritePalette.playerBanner,
    horseCount,
    elapsed: model.time ?? 0,
    crew: living,
    crossbows: kit.crossbows,
    bodyScale: kit.bodyScale,
    bladeLength: kit.bladeLength,
  });

  // A green outline around a team that is only being previewed, matching the
  // radar's dashed preview polygon.
  if (model.previewing) {
    context.setLineDash([5, 4]);
    context.strokeStyle = PREVIEW_STROKE;
    context.lineWidth = 1.4 / rig.scale;
    roundRectPath(
      context,
      rig.box.minX - 2, rig.box.minY - 2,
      rig.box.width + 4, rig.box.height + 4, 6,
    );
    context.stroke();
    context.setLineDash([]);
  }
  context.restore();

  return {
    horseCount,
    crew: living.length,
    isPreview: Boolean(model.previewing),
    scale: rig.scale,
    angle: rig.angle,
    // The pixels the team actually occupies, which is what the tests check against
    // the rect the layout handed over.
    width: rig.width,
    height: rig.height,
    rect,
    time: model.time ?? 0,
  };
}

// Two ellipses and a brush of grass: the ground the stacked team stands on. It is
// built from the fitted box (`rigPreview`), so the patch follows the silhouette -
// more horses, a wider box.
function drawRigGround(context, rect, rig) {
  const footprint = projectRigBox(rig.box, rig.angle);
  const turf = {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2 + footprint.maxY * rig.scale,
    radiusX: Math.max(8, rig.width * 0.58),
    radiusY: Math.max(8, rig.height * 0.2),
  };

  const light = context.createRadialGradient(
    turf.x, turf.y, 2,
    turf.x, turf.y, Math.max(rect.width, rect.height) * 0.78,
  );
  light.addColorStop(0, "rgba(214, 168, 96, 0.17)");
  light.addColorStop(0.55, "rgba(168, 116, 62, 0.07)");
  light.addColorStop(1, "rgba(24, 18, 13, 0)");
  context.fillStyle = light;
  context.fillRect(rect.x, rect.y, rect.width, rect.height);

  const turfFill = context.createRadialGradient(
    turf.x, turf.y, 1, turf.x, turf.y, Math.max(turf.radiusX, turf.radiusY),
  );
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

function fillEllipse(context, x, y, radiusX, radiusY, fill) {
  context.beginPath();
  context.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
  context.fillStyle = fill;
  context.fill();
}


// A seated crew member is the battlefield's foot silhouette, turned to face the
// fire. `scale` is pixels per art unit, so the ring's figures grow with the rect
// without a second set of proportions.
function drawFigure(context, art, seat, figure, scale, { preview = false, player = false } = {}) {
  // The player's own place: a gold ring on the ground under him, so the near seat
  // reads as "you" even though he wears the robe the battlefield gives him.
  if (player) {
    context.beginPath();
    context.ellipse(seat.x, seat.y + 1, scale * 13, scale * 5, 0, 0, Math.PI * 2);
    context.strokeStyle = "rgba(210, 173, 104, 0.55)";
    context.lineWidth = 1.2;
    context.stroke();
  }

  context.save();
  context.translate(seat.x, seat.y);
  context.rotate(seat.facing);
  // The far half of the ring is a touch smaller: the same figure, further away.
  context.scale(scale * (seat.near ? 1.06 : 0.92), scale * (seat.near ? 1.06 : 0.92));
  if (preview) context.globalAlpha = 0.72;
  art.drawFootFigure({
    robeColor: figure.robeColor, friendly: true, overlays: figure.overlays, hitFlash: 0,
  });
  context.restore();

  if (preview) {
    // One dashed ring on the ground: "he sits here if you pay".
    context.beginPath();
    context.ellipse(seat.x, seat.y + 1, scale * 12, scale * 4.5, 0, 0, Math.PI * 2);
    context.strokeStyle = "rgba(142, 200, 140, 0.5)";
    context.lineWidth = 1.1;
    context.setLineDash([2.5, 2.5]);
    context.stroke();
    context.setLineDash([]);
  }
}

// A ridge tent seen from the front: a dark canvas triangle, the firelit half,
// and the black wedge of the door. Drawn behind the ring so a tent never covers
// a seated crew member.
function drawTent(context, x, groundY, size) {
  fillEllipse(context, x, groundY + size * 0.05, size * 0.62, size * 0.16, "rgba(8, 6, 5, 0.42)");

  context.fillStyle = "#4b4132";
  context.beginPath();
  context.moveTo(x, groundY - size);
  context.lineTo(x + size * 0.62, groundY);
  context.lineTo(x - size * 0.62, groundY);
  context.closePath();
  context.fill();

  // The face turned towards the firelight.
  context.fillStyle = "#6c5a3c";
  context.beginPath();
  context.moveTo(x, groundY - size);
  context.lineTo(x + size * 0.62, groundY);
  context.lineTo(x + size * 0.06, groundY);
  context.closePath();
  context.fill();

  context.strokeStyle = "rgba(226, 196, 138, 0.5)";
  context.lineWidth = Math.max(1, size * 0.03);
  context.beginPath();
  context.moveTo(x, groundY - size);
  context.lineTo(x, groundY);
  context.stroke();

  context.fillStyle = "rgba(18, 13, 10, 0.9)";
  context.beginPath();
  context.moveTo(x, groundY - size * 0.42);
  context.lineTo(x + size * 0.17, groundY);
  context.lineTo(x - size * 0.17, groundY);
  context.closePath();
  context.fill();
}

function drawFire(context, fire, time) {
  const { x, y, r } = fire;
  // The glow is what makes it a night scene rather than a grey box; its alpha
  // breathes on a slower clock than the flames.
  const glow = context.createRadialGradient(x, y - r * 0.4, r * 0.2, x, y - r * 0.4, r * 5.4);
  glow.addColorStop(0, "rgba(214, 138, 74, 0.34)");
  glow.addColorStop(0.55, "rgba(168, 96, 52, 0.11)");
  glow.addColorStop(1, "rgba(120, 70, 40, 0)");
  context.globalAlpha = 0.85 + 0.15 * Math.sin(time * CAMP.glowPulse);
  context.fillStyle = glow;
  context.beginPath();
  context.arc(x, y - r * 0.4, r * 5.4, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;

  for (let index = 0; index < CAMP.stoneCount; index += 1) {
    const angle = (index / CAMP.stoneCount) * Math.PI * 2;
    context.beginPath();
    context.ellipse(x + Math.cos(angle) * r * 1.5, y + Math.sin(angle) * r * 0.55,
      r * 0.34, r * 0.2, 0, 0, Math.PI * 2);
    context.fillStyle = index % 2 ? "#4a4239" : "#3c352d";
    context.fill();
  }

  // Two logs, one across the other.
  context.strokeStyle = "#33261a";
  context.lineWidth = Math.max(1.5, r * 0.34);
  context.beginPath();
  context.moveTo(x - r * 1.1, y + r * 0.18);
  context.lineTo(x + r * 1.1, y - r * 0.1);
  context.moveTo(x - r * 0.9, y - r * 0.24);
  context.lineTo(x + r * 1.0, y + r * 0.3);
  context.stroke();

  const layers = [
    {
      color: "rgba(169, 68, 50, 0.72)", width: 1.0, height: 1.55, sway: 0,
    },
    {
      color: "rgba(201, 138, 85, 0.86)", width: 0.66, height: 1.2, sway: 1.4,
    },
    {
      color: "rgba(240, 214, 158, 0.92)", width: 0.34, height: 0.78, sway: 2.6,
    },
  ];
  layers.forEach((layer, index) => {
    const flicker = 1 + 0.12 * Math.sin(time * CAMP.flicker + index * 1.7);
    const bend = Math.sin(time * CAMP.flicker * 0.7 + layer.sway) * r * 0.16;
    const height = r * layer.height * flicker;
    const half = r * layer.width;
    context.beginPath();
    context.moveTo(x - half, y);
    context.quadraticCurveTo(x - half * 0.8 + bend, y - height * 0.6, x + bend, y - height);
    context.quadraticCurveTo(x + half * 0.9 + bend, y - height * 0.55, x + half, y);
    context.closePath();
    context.fillStyle = layer.color;
    context.fill();
  });

  // Embers: five points on a loop, rising out of the flames and fading.
  for (let index = 0; index < CAMP.emberCount; index += 1) {
    const cycle = (time * 0.55 + index / CAMP.emberCount) % 1;
    context.beginPath();
    context.arc(
      x + Math.sin(time * 1.9 + index * 2.1) * r * (0.5 + cycle),
      y - r * 0.8 - cycle * r * 4.2,
      Math.max(0.7, r * 0.075 * (1 - cycle)),
      0, Math.PI * 2,
    );
    context.fillStyle = `rgba(240, 196, 120, ${(0.7 * (1 - cycle)).toFixed(3)})`;
    context.fill();
  }
}


// The crew tab's scene: the night camp the chariot is parked in, one seat per
// living crew member round the fire, and the player's own place at the near edge.
//
// `crew` already contains the recruit a press is previewing (the shop appends him
// before it calls this), so a hire that would fit simply shows up as one more
// figure - dashed and tinted green, because nothing has been paid for yet. A full
// chariot appends nobody and passes `previewRole: null`, which is why the scene can
// never promise a seat the ledger will refuse to sell.
export function drawCamp(context, rect, model = {}) {
  const {
    crew = [], previewRole = null, campTents = 0, time = 0,
  } = model;
  const living = crew.filter((member) => member && member.alive !== false);
  const radius = Math.min(rect.width * 0.3, rect.height * 0.34);
  const fire = {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height * 0.54,
    r: Math.max(5, radius * 0.17),
  };
  // Seat 0 is the player; the crew fill the ring clockwise after him.
  const seats = campSeats(1 + living.length, {
    centerX: fire.x,
    centerY: fire.y,
    radius,
    squash: CAMP.seatSquash,
  });
  const scale = radius * CAMP.figureHeight / CAMP.figureUnits;
  const art = artFor(context);

  context.save();
  roundRectPath(context, rect.x, rect.y, rect.width, rect.height, 6);
  context.clip();

  const sky = context.createLinearGradient(0, rect.y, 0, rect.y + rect.height);
  sky.addColorStop(0, "#121721");
  sky.addColorStop(0.62, "#1b1a1c");
  sky.addColorStop(1, "#2a2118");
  context.fillStyle = sky;
  context.fillRect(rect.x, rect.y, rect.width, rect.height);

  // The banner behind the fire: the same cinnabar as the chariot's pennant, so
  // the camp reads as this army's camp and not a generic campfire.
  const poleX = rect.x + rect.width * 0.14;
  context.strokeStyle = "rgba(146, 124, 92, 0.8)";
  context.lineWidth = 1.4;
  context.beginPath();
  context.moveTo(poleX, rect.y + rect.height * 0.16);
  context.lineTo(poleX, fire.y + radius * 0.3);
  context.stroke();
  context.beginPath();
  context.moveTo(poleX, rect.y + rect.height * 0.16);
  context.lineTo(poleX + radius * 0.52, rect.y + rect.height * 0.2);
  context.lineTo(poleX, rect.y + rect.height * 0.26);
  context.closePath();
  context.fillStyle = COLORS.cinnabar;
  context.fill();

  // The ground the ring stands on.
  fillEllipse(context, fire.x, fire.y + radius * 0.22, radius * 1.42, radius * 0.56, "rgba(62, 50, 35, 0.55)");

  // Tents first: they belong to the dark behind the ring, and a firelit canvas
  // painted over a seated figure would read as the figure sitting inside it.
  const tents = Math.max(0, Math.min(Math.round(campTents), tentSpots.length));
  for (let index = 0; index < tents; index += 1) {
    const spot = tentSpots[index];
    drawTent(
      context,
      rect.x + rect.width * (0.5 + spot.x),
      fire.y + spot.y * radius,
      radius * 0.42 * spot.scale,
    );
  }

  const figureFor = (index) => {
    if (index === 0) return { figure: roleFigure(null), preview: false, player: true };
    const preview = previewRole !== null && index === living.length;
    return {
      figure: roleFigure(preview ? previewRole : living[index - 1]?.role),
      preview,
      player: false,
    };
  };

  // Far half behind the flames, near half in front of them: that one ordering is
  // what turns flat figures into a ring round a fire.
  for (const seat of seats) {
    if (seat.near) continue;
    const { figure, preview, player } = figureFor(seat.index);
    drawFigure(context, art, seat, figure, scale, { preview, player });
  }

  drawFire(context, fire, time);

  for (const seat of seats) {
    if (!seat.near) continue;
    const { figure, preview, player } = figureFor(seat.index);
    drawFigure(context, art, seat, figure, scale, { preview, player });
  }

  context.restore();

  return {
    seats: seats.length,
    crew: living.length,
    previewSeat: previewRole !== null,
    // The shop reads this back: a hire is legible at the fire even though the
    // battle it will fight in is never shown here.
    formations: tents,
    radius,
    rect,
  };
}

