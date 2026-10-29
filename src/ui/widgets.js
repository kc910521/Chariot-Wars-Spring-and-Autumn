import { COLORS, RADIUS, font } from "./theme.js";

// Minimal immediate-mode widget kit for the shop. Every helper draws in logical
// view units and returns nothing; hit-testing is done by the caller against the
// rect it passed in, so a widget can never disagree with its own target.
export function roundRectPath(context, x, y, width, height, radius = RADIUS) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

export function panel(context, x, y, width, height, options = {}) {
  const {
    fill = "rgba(43, 36, 28, 0.94)",
    stroke = COLORS.edge,
    radius = RADIUS,
    lineWidth = 1,
  } = options;
  roundRectPath(context, x, y, width, height, radius);
  context.fillStyle = fill;
  context.fill();
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = lineWidth;
    context.stroke();
  }
}

// Break on spaces for latin text and between characters for CJK, which is what
// the shop descriptions need now that nothing wraps automatically.
export function wrapText(context, value, maxWidth) {
  const lines = [];
  let line = "";
  for (const char of String(value)) {
    const candidate = line + char;
    if (context.measureText(candidate).width > maxWidth && line) {
      // Chinese breaks between any two glyphs, but a Latin word must not be cut in
      // half: back up to the last space instead. A single word wider than the box
      // still falls through to the hard break, or it would never fit.
      const space = line.lastIndexOf(" ");
      if (space > 0 && char !== " ") {
        lines.push(line.slice(0, space));
        line = line.slice(space + 1) + char;
      } else {
        lines.push(line);
        line = char === " " ? "" : char;
      }
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function text(context, value, x, y, options = {}) {
  const {
    size = 16,
    weight = "normal",
    color = COLORS.text,
    align = "left",
    baseline = "middle",
    maxWidth = 0,
    family,
  } = options;
  context.font = font(size, weight, family);
  context.fillStyle = color;
  context.textAlign = align;
  context.textBaseline = baseline;
  const content = String(value);
  context.fillText(content, x, y, maxWidth || undefined);
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
}

// Largest size at or below `size` that still keeps `value` inside `maxWidth`.
// The pager label and the price buttons are both drawn at a fixed size into a
// rect that a phone may shrink, so the caller asks for the size instead of
// guessing one.
export function fitTextSize(context, value, maxWidth, options = {}) {
  const { size = 16, min = 9, weight = "normal", family } = options;
  const content = String(value);
  let candidate = size;
  context.font = font(candidate, weight, family);
  while (candidate > min && context.measureText(content).width > maxWidth) {
    candidate -= 1;
    context.font = font(candidate, weight, family);
  }
  return candidate;
}

export function drawButton(context, rect, label, options = {}) {
  const {
    primary = false,
    disabled = false,
    size = 17,
    color,
  } = options;
  const fill = disabled
    ? "rgba(58, 49, 38, 0.7)"
    : primary ? COLORS.cinnabar : "rgba(74, 61, 45, 0.92)";
  const stroke = disabled ? COLORS.line : primary ? COLORS.cinnabarBright : COLORS.edge;
  const labelColor = disabled ? COLORS.muted : color || COLORS.text;
  panel(context, rect.x, rect.y, rect.width, rect.height, {
    fill, stroke, radius: 8,
  });
  // A translated label is one word in one language and two in another: condense
  // it rather than let it paint over the row it belongs to.
  const fitted = fitTextSize(context, label, rect.width - 12, { size, weight: "bold" });
  text(context, label, rect.x + rect.width / 2, rect.y + rect.height / 2 + 1, {
    size: fitted, weight: "bold", color: labelColor, align: "center",
  });
}

export function drawBar(context, rect, ratio, options = {}) {
  const {
    track = "rgba(20, 16, 12, 0.72)",
    fill = COLORS.health,
    radius = rect.height / 2,
  } = options;
  panel(context, rect.x, rect.y, rect.width, rect.height, { fill: track, stroke: COLORS.line, radius });
  const clamped = Math.max(0, Math.min(1, ratio));
  if (clamped <= 0) return;
  const width = Math.max(radius * 2, rect.width * clamped);
  roundRectPath(context, rect.x, rect.y, width, rect.height, radius);
  context.fillStyle = fill;
  context.fill();
}

export function contains(rect, x, y) {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

// Dashed separator, used between shop rows.
export function divider(context, x, y, width, color = COLORS.line) {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 1;
  context.setLineDash([4, 5]);
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + width, y);
  context.stroke();
  context.restore();
}
