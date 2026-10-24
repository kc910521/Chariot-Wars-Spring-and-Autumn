// Pure geometry and shared vocabulary for the shop page. No DOM and no canvas:
// the radar's five axes, the box the chariot preview is fitted into and the
// seats around the camp fire all come from here, so the drawing code, the CSS
// and the tests that guard them read the same numbers.
import { chariotRigBox, spritePalette } from "../render/sprites.js";

export const statKeys = ["firepower", "protection", "mobility", "stability", "capacity"];

export const statLabelKeys = {
  firepower: "shop.stat.firepower",
  protection: "shop.stat.protection",
  mobility: "shop.stat.mobility",
  stability: "shop.stat.stability",
  capacity: "shop.stat.capacity",
};

// Radar geometry in SVG user units. Labels sit outside the outer ring, so the
// viewBox is wider than the polygon it draws.
export const radarLayout = {
  width: 380,
  height: 330,
  centerX: 190,
  centerY: 158,
  radius: 86,
  maximum: 10,
  // Labels sit outside the outer ring, far enough out that the widest one
  // ("capacity 10 ▲ 10") still ends inside the viewBox.
  labelRadius: 12.8,
  // Label size in viewBox units. The wheel itself is 172 units across, so a
  // caller that shows the chart at half size needs a bigger number here to keep
  // the text readable; `shop.js` switches to `readableLabelSize` on narrow
  // screens for exactly that reason.
  labelSize: 13,
};

// The narrow strip draws the same chart in roughly half the pixels, so the
// labels grow *in chart units* and land back at ~10px on a phone.
export const readableLabelSize = 20;

export function radarAngle(index, count = statKeys.length) {
  return (-90 + index * 360 / count) * Math.PI / 180;
}

export function radarPoint(index, value, layout = radarLayout) {
  const angle = radarAngle(index);
  const reach = layout.radius * (value / layout.maximum);
  return { x: layout.centerX + Math.cos(angle) * reach, y: layout.centerY + Math.sin(angle) * reach };
}

export function radarPolygon(values, layout = radarLayout) {
  return values.map((value, index) => {
    const point = radarPoint(index, value, layout);
    return `${point.x},${point.y}`;
  }).join(" ");
}

// The dossier shows the chariot from above with the team pointing up the page -
// the same heading a player drives at when a battle starts.
export const rigView = { angle: -Math.PI / 2, padding: 0.9 };

// Axis-aligned extent of a box rotated about its own centre, which is what a
// fit-to-box has to use: a rig that is 68 wide and 62 tall occupies 62 x 68 on
// screen once it is turned to face up the page.
export function rotatedExtent(box, angle) {
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const width = box.width * cos + box.height * sin;
  const height = box.width * sin + box.height * cos;
  return {
    width,
    height,
    centerX: (box.minX + box.maxX) / 2,
    centerY: (box.minY + box.maxY) / 2,
  };
}

// Everything the drawing code needs: the rig's declared box, the scale that fits
// it, and the local point that lands on the canvas centre.
export function rigTransform(box, width, height, options = {}) {
  const angle = options.angle ?? rigView.angle;
  const padding = options.padding ?? rigView.padding;
  const extent = rotatedExtent(box, angle);
  const scale = Math.min(width / extent.width, height / extent.height) * padding;
  return { scale, angle, padding, width, height, centerX: extent.centerX, centerY: extent.centerY };
}

export function rigPreview(horseCount, width, height, options = {}) {
  const box = chariotRigBox(horseCount);
  return { box, ...rigTransform(box, width, height, options) };
}

// Where the rig's declared box lands on the canvas once `rigTransform` is
// applied. The scene draws its ground patch from this, and the unit test asserts
// every corner stays inside the canvas at every team size.
export function projectRigBox(box, transform) {
  const cos = Math.cos(transform.angle);
  const sin = Math.sin(transform.angle);
  const corners = [];
  for (const x of [box.minX, box.maxX]) {
    for (const y of [box.minY, box.maxY]) {
      const localX = (x - transform.centerX) * transform.scale;
      const localY = (y - transform.centerY) * transform.scale;
      corners.push({
        x: transform.width / 2 + localX * cos - localY * sin,
        y: transform.height / 2 + localX * sin + localY * cos,
      });
    }
  }
  return {
    minX: Math.min(...corners.map((corner) => corner.x)),
    minY: Math.min(...corners.map((corner) => corner.y)),
    maxX: Math.max(...corners.map((corner) => corner.x)),
    maxY: Math.max(...corners.map((corner) => corner.y)),
  };
}

// Crew kit for the camp fire. Roles are the personnel row ids, so a new recruit
// shows up in the scene as soon as its row exists; the fallbacks keep an unknown
// role from crashing the fire. Colours come from the sprite palette, which is the
// same table the battlefield paints a dismounted companion from.
export const crewOverlays = { archer: ["bow"], halberdier: ["dagger-axe"] };
export const playerRobe = spritePalette.playerRobe;
export const crewBanner = spritePalette.playerBanner;
export const crewRobe = spritePalette.allyRobe;

export function crewFigure(role) {
  if (!role) return { robeColor: playerRobe, overlays: ["sword"], isPlayer: true };
  return {
    robeColor: crewRobe,
    overlays: crewOverlays[role] ?? ["sword"],
    isPlayer: false,
  };
}

// Seats around the fire, in draw order (far side first). Seat 0 is the near edge
// of the ring - the closest seat to the viewer - and the rest fill the ring
// clockwise, so a growing crew fills the far side before it crowds the front.
// `facing` is the rotation that turns the foot art's local +x towards the fire.
export function campSeats(count, { centerX, centerY, radius, squash = 0.62 }) {
  const total = Math.max(1, Math.round(count));
  const seats = [];
  for (let index = 0; index < total; index += 1) {
    const angle = Math.PI / 2 + index * Math.PI * 2 / total;
    const y = centerY + Math.sin(angle) * radius * squash;
    seats.push({
      index,
      x: centerX + Math.cos(angle) * radius,
      y,
      facing: angle + Math.PI,
      near: Math.sin(angle) > 0,
    });
  }
  return seats.sort((a, b) => a.y - b.y);
}
