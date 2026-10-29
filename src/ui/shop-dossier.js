import { translate } from "../i18n/index.js";
import {
  radarGeometry, radarPoint, radarPolygon, statKeys, statLabelKeys,
} from "./shop-layout.js";
import { drawCamp, drawRig } from "./shop-scene.js";
import { COLORS, SERIF_FAMILY } from "./theme.js";
import { panel, text } from "./widgets.js";

// The shop's left-hand dossier: the five-axis radar (what a purchase would do to
// the chariot), the team it would put on the field, and - on the crew tab - the
// night camp that crew sits around instead of the radar. It draws from live
// campaign data plus a preview object, and it owns no state: the shop decides what
// to preview, the layout decides which chart the column shows.

const RADAR = Object.freeze({
  rings: 5,
  gridStroke: "rgba(211, 185, 139, 0.18)",
  gridFill: "rgba(210, 173, 104, 0.035)",
  currentFill: "rgba(210, 173, 104, 0.22)",
  previewFill: "rgba(123, 184, 141, 0.16)",
  previewStroke: "#8ec88c",
  up: "#8ec88c",
  down: "#d47a68",
  name: "#c8b99d",
});

function tracePolygon(context, points) {
  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.closePath();
}

// The chart's own labels: five names and their values, drawn outside the ring.
// The size, the gap the ring leaves them and the width they are allowed to paint
// all come back with the geometry, so a narrow column cannot get a label size that
// its radius did not budget for.
function drawRadar(context, geometry, current, preview) {
  const changed = statKeys.some((key) => current[key] !== preview[key]);
  context.save();

  // Grid: five rings so a value can be read off the chart without the numbers.
  for (let ring = RADAR.rings; ring >= 1; ring -= 1) {
    tracePolygon(context, radarPolygon(geometry, statKeys.map(() => (geometry.maximum * ring) / RADAR.rings)));
    if (ring === RADAR.rings) {
      context.fillStyle = RADAR.gridFill;
      context.fill();
    }
    context.strokeStyle = RADAR.gridStroke;
    context.lineWidth = 1;
    context.stroke();
  }

  context.beginPath();
  statKeys.forEach((key, index) => {
    const tip = radarPoint(geometry, index, geometry.maximum);
    context.moveTo(geometry.centerX, geometry.centerY);
    context.lineTo(tip.x, tip.y);
  });
  context.stroke();

  const currentPoints = radarPolygon(geometry, statKeys.map((key) => current[key]));
  tracePolygon(context, currentPoints);
  context.fillStyle = RADAR.currentFill;
  context.fill();
  context.strokeStyle = COLORS.gold;
  context.lineWidth = 2;
  context.stroke();

  // The preview sits on top of the current shape: the fill says "this is what you
  // are about to get" and the dashes keep it from reading as owned.
  if (changed) {
    tracePolygon(context, radarPolygon(geometry, statKeys.map((key) => preview[key])));
    context.fillStyle = RADAR.previewFill;
    context.fill();
    context.strokeStyle = RADAR.previewStroke;
    context.lineWidth = 2;
    context.setLineDash([5, 4]);
    context.stroke();
    context.setLineDash([]);
  }

  const labelSize = geometry.labelSize;
  const outset = geometry.labelOutset;
  statKeys.forEach((key, index) => {
    const delta = preview[key] - current[key];
    const tip = radarPoint(geometry, index, geometry.maximum);
    const point = {
      x: geometry.centerX + (tip.x - geometry.centerX) * 1.16,
      y: geometry.centerY + (tip.y - geometry.centerY) * 1.16,
    };
    const dx = tip.x - geometry.centerX;
    const align = dx > 10 ? "left" : dx < -10 ? "right" : "center";
    const x = point.x + (align === "left" ? outset : align === "right" ? -outset : 0);
    const color = delta === 0 ? null : delta > 0 ? RADAR.up : RADAR.down;
    const value = delta === 0 ? String(current[key]) : `${current[key]} ${delta > 0 ? "▲" : "▼"} ${preview[key]}`;
    // `maxWidth` is the promise, not a hint: the canvas condenses a label that
    // would not fit, which is what keeps a wide font inside the chart column.
    text(context, translate(statLabelKeys[key]), x, point.y - geometry.labelGap, {
      size: labelSize, color: color ?? RADAR.name, align, maxWidth: geometry.labelMaxWidth,
    });
    text(context, value, x, point.y + geometry.labelGap, {
      size: labelSize, weight: "bold", color: color ?? COLORS.text, align, maxWidth: geometry.labelMaxWidth,
    });
    // The vertex the value came from, so a label can always be traced to an axis.
    context.beginPath();
    context.arc(currentPoints[index].x, currentPoints[index].y, 2.2, 0, Math.PI * 2);
    context.fillStyle = color ?? COLORS.gold;
    context.fill();
  });

  context.restore();
}

// `model` is { current, preview, horseCount, crew, levels, slots, time,
// previewing, previewRole, campTents }: the stats before and after the pressed
// purchase, the team that purchase would field, and - on the crew tab - the
// recruit who would join it. Everything else comes from the layout, which decides
// *what* the chart column paints (`slot`) but never where anything sits.
export function drawDossier(context, layout, model) {
  const camp = layout.slot === "camp";
  panel(context, layout.dossier.x, layout.dossier.y, layout.dossier.width, layout.dossier.height, {
    fill: "rgba(39, 28, 20, 0.55)", stroke: COLORS.line, radius: 10,
  });
  text(context, translate(camp ? "shop.camp.title" : "shop.stats.title"), layout.title.x, layout.title.y, {
    size: 12, weight: "bold", color: COLORS.text, family: SERIF_FAMILY,
  });
  const living = (model.crew ?? []).filter((member) => member && member.alive !== false);
  text(context, translate("shop.rig.caption", {
    horses: Math.round(model.horseCount),
    crew: living.length,
    slots: model.slots,
  }), layout.caption.x, layout.caption.y, {
    size: 10, color: COLORS.muted, align: layout.caption.align,
  });

  if (layout.rigPanel) {
    panel(context, layout.rigPanel.x, layout.rigPanel.y, layout.rigPanel.width, layout.rigPanel.height, {
      fill: "rgba(29, 24, 19, 0.66)", stroke: COLORS.line, radius: 10,
    });
  }
  const rigFrame = drawRig(context, layout.rig, {
    horseCount: model.horseCount,
    crew: model.crew,
    levels: model.levels,
    time: model.time,
    previewing: model.previewing,
    // Side by side, the team has its own column and paints the evening glow; the
    // stacked shape already has the dossier's grass patch behind it.
    vignette: Boolean(layout.rigPanel),
  });

  const campFrame = camp ? drawCamp(context, layout.chart, {
    crew: model.crew ?? [],
    previewRole: model.previewRole ?? null,
    campTents: model.campTents ?? 0,
    time: model.time,
  }) : null;
  if (campFrame) {
    if (layout.chartCaption) {
      const key = campFrame.previewSeat
        ? "shop.camp.previewCaption"
        : model.campTents > 0 ? "shop.camp.captionTents"
          : living.length >= model.slots ? "shop.camp.full" : "shop.camp.caption";
      text(context, translate(key, {
        crew: living.length,
        slots: model.slots,
        open: Math.max(0, model.slots - living.length),
        tents: model.campTents ?? 0,
      }), layout.chartCaption.x, layout.chartCaption.y, {
        size: 9.5,
        color: campFrame.previewSeat ? RADAR.previewStroke : COLORS.muted,
        align: layout.chartCaption.align,
      });
    }
  } else {
    drawRadar(context, radarGeometry(layout.chart, { narrow: layout.narrow }), model.current, model.preview);
  }

  return {
    slot: layout.slot,
    narrow: layout.narrow,
    camp: campFrame,
    rig: {
      rect: rigFrame.rect, scale: rigFrame.scale, width: rigFrame.width, height: rigFrame.height,
    },
    radar: campFrame ? null : radarGeometry(layout.chart, { narrow: layout.narrow }),
  };
}

export { drawRadar };
