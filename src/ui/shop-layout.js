// Pure geometry and copy decisions for the canvas shop: no DOM, no canvas and no
// translation, so the drawing code, the pointer targets and the unit tests all
// read the same numbers.
//
// The one rule this file exists to protect: **a rect is a function of the screen
// size, the category and the page — never of a hovered or pressed item.** The old
// DOM shop learned this the hard way: a pointer-enter repainted a two-line info
// panel, which shrank it, which pulled the ledger up 14px under the finger, and
// the tap meant for 购置 landed on the card instead. On canvas nothing reflows,
// but the preview still repaints thirty times a second, so the same rule keeps
// the button exactly where the player pressed it.
import { clamp } from "../utils/math.js";
import { personnel } from "../data/equipment.js";
import { chariotRigBox, spritePalette } from "../render/sprites.js";

const CATEGORY_IDS = ["equipment", "horse", "personnel"];

export const statKeys = ["firepower", "protection", "mobility", "stability", "capacity"];

export const statLabelKeys = {
  firepower: "shop.stat.firepower",
  protection: "shop.stat.protection",
  mobility: "shop.stat.mobility",
  stability: "shop.stat.stability",
  capacity: "shop.stat.capacity",
};

// Three rows is what a phone-height ledger fits comfortably; a 2.4:1 screen is
// too short for that and drops to two, so the button never has to shrink below
// its thumb size.
const MAX_ROWS_PER_PAGE = 3;

// A purchase button is a thumb target, not a label: 164x40 is what both
// `shop.buy` ("购置 · 400 两") and `shop.shortGold` ("军资不足 · 400 两") need at
// the sizes drawn here, and 40px is the smallest height that still lands under a
// fingertip whose contact patch is ~9mm.
const BUY_SIZE = Object.freeze({ width: 164, height: 40 });

const metrics = Object.freeze({
  outer: 12,
  inner: 18,
  gap: 14,
  headerHeight: 44,
  tabHeight: 34,
  tabGap: 8,
  tabMaxWidth: 200,
  contentGap: 10,
  footerWidth: 240,
  footerHeight: 40,
  footerGap: 16,
  pagerWidth: 44,
  pagerLabel: 56,
  noticeHeight: 18,
  infoTall: 62,
  infoShort: 50,
  listGap: 10,
  rowGap: 6,
  minRowHeight: 52,
  maxRowHeight: 92,
  dossierMin: 244,
  dossierMax: 304,
  dossierTitle: 26,
  dossierFooter: 6,
  // Taller than this the dossier can afford the team preview above the radar
  // without squeezing the chart. A phone's dossier body is 213px on an 844x390
  // screen, and a radar that fits above a rig there is a 30px chart - so a phone
  // shares the *width* instead and puts the three things side by side.
  rigMinBodyHeight: 400,
  // Side-by-side shape: the chart column, the team column, and the ledger take
  // what is left. Measured at the 960-wide logical space (see the unit tests for
  // the ledger's floor and the radar's radius cap).
  slotShare: 0.246,
  slotMin: 232,
  slotMax: 260,
  rigColumnShare: 0.152,
  rigColumnMin: 132,
  rigColumnMax: 168,
  rigColumnInset: 8,
  rigCaptionHeight: 15,
  // Room a radar label needs beyond its axis, in canvas pixels: `火力 7 ▲ 9` at
  // 10.5px is ~51px wide and starts 4px outside the ring. On a narrow column this
  // is what caps the radius, so the labels stay inside the box instead of the box
  // being assumed wide enough.
  radarGutter: 55,
  radarGutterNarrow: 50,
});

// Everything that does not depend on the catalogue: the outer panel, the header,
// the category tabs, the footer strip (pager + start-next-battle) and the notice
// line above it. `computeShopLayout` builds on this, and so does the
// rows-per-page decision, which has to know how much height the ledger gets
// before it can answer.
function shopFrame({ width, height }) {
  const { outer, inner } = metrics;
  const left = outer + inner;
  const right = width - outer - inner;
  const panel = {
    x: outer, y: outer, width: width - outer * 2, height: height - outer * 2,
  };

  const header = {
    x: left, y: outer + 8, width: right - left, height: metrics.headerHeight,
  };

  const tabsTop = header.y + header.height + metrics.tabGap;
  const tabWidth = Math.min(
    metrics.tabMaxWidth,
    Math.floor((right - left - metrics.tabGap * (CATEGORY_IDS.length - 1)) / CATEGORY_IDS.length),
  );
  const tabs = CATEGORY_IDS.map((id, index) => ({
    id,
    rect: {
      x: left + index * (tabWidth + metrics.tabGap), y: tabsTop, width: tabWidth, height: metrics.tabHeight,
    },
  }));

  const footer = {
    x: right - metrics.footerWidth,
    y: height - outer - metrics.footerHeight,
    width: metrics.footerWidth,
    height: metrics.footerHeight,
  };

  // The pager shares the footer with 开始下一战: both are "leave this screen"
  // controls, and putting the pager below the rows cost a phone the 38px that
  // decide whether three rows fit at a readable height.
  const pagerWidth = metrics.pagerWidth * 2 + metrics.pagerLabel + 16;
  const pagerX = footer.x - metrics.footerGap - pagerWidth;
  const pagerY = footer.y + (footer.height - 30) / 2;
  const pager = {
    prev: {
      x: pagerX, y: pagerY, width: metrics.pagerWidth, height: 30,
    },
    next: {
      x: pagerX + metrics.pagerWidth + metrics.pagerLabel + 16,
      y: pagerY,
      width: metrics.pagerWidth,
      height: 30,
    },
    labelX: pagerX + metrics.pagerWidth + 8 + metrics.pagerLabel / 2,
    labelY: footer.y + footer.height / 2,
  };

  // One line above the footer, full width: a purchase message must never sit
  // under either button.
  const notice = {
    x: left, y: footer.y - 24, width: right - left, height: metrics.noticeHeight,
  };

  const contentTop = tabsTop + metrics.tabHeight + metrics.contentGap;
  const contentHeight = Math.max(120, notice.y - 6 - contentTop);

  return {
    width,
    height,
    left,
    right,
    gap: metrics.gap,
    panel,
    header,
    tabs,
    footer,
    pager,
    notice,
    contentTop,
    contentHeight,
  };
}

function infoHeightFor(contentHeight) {
  return contentHeight < 280 ? metrics.infoShort : metrics.infoTall;
}

// How many rows one page holds on this screen. Derived from the height alone, so
// the caller can slice the catalogue before it knows how many pages there are.
export function rowsPerPageFor(height, width = 960) {
  const frame = shopFrame({ width, height });
  const available = frame.contentHeight - infoHeightFor(frame.contentHeight) - metrics.listGap;
  const needed = metrics.minRowHeight * MAX_ROWS_PER_PAGE + metrics.rowGap * (MAX_ROWS_PER_PAGE - 1);
  return available >= needed ? MAX_ROWS_PER_PAGE : MAX_ROWS_PER_PAGE - 1;
}

// The shop always shows the same three things - the five stats (or, on the crew
// tab, the camp), the team that would take the field, and the ledger - but not
// always in the same shape. A tablet is tall enough to stack the team over the
// radar inside one dossier column. A phone is not, so it puts the three side by
// side and the ledger gives up the width instead of the height.
//
// `category` only decides *which* chart the chart column paints (`slot`). Every
// rect is computed without it, so switching tabs cannot move a buy button - a
// stronger promise than the DOM shop could make, and the reason this returns a
// slot name rather than a second layout.
export function computeShopLayout({
  width, height, pageCount = 1, rowsPerPage = rowsPerPageFor(height, width), category = "equipment",
}) {
  const frame = shopFrame({ width, height });
  const {
    left, right, gap, contentTop, contentHeight,
  } = frame;

  const bodyTop = contentTop + metrics.dossierTitle;
  const bodyBottom = contentTop + contentHeight - metrics.dossierFooter;
  const bodyHeight = Math.max(100, bodyBottom - bodyTop);
  const stacked = bodyHeight >= metrics.rigMinBodyHeight;
  const slot = category === "personnel" ? "camp" : "radar";

  const dossierWidth = stacked
    ? clamp(Math.round(width * 0.3), metrics.dossierMin, metrics.dossierMax)
    : clamp(Math.round(width * metrics.slotShare), metrics.slotMin, metrics.slotMax);
  const dossier = {
    x: left, y: contentTop, width: dossierWidth, height: contentHeight,
  };
  // The team's own column exists only in the side-by-side shape; stacked, the
  // team lives inside the dossier above the chart.
  const rigPanel = stacked ? null : {
    x: dossier.x + dossierWidth + gap,
    y: contentTop,
    width: clamp(Math.round(width * metrics.rigColumnShare), metrics.rigColumnMin, metrics.rigColumnMax),
    height: contentHeight,
  };
  const ledgerX = (rigPanel ? rigPanel.x + rigPanel.width : dossier.x + dossierWidth) + gap;
  const ledger = {
    x: ledgerX, y: contentTop, width: right - ledgerX, height: contentHeight,
  };

  // One description surface for the whole shop, with a height reserved for the
  // longest copy it can ever show. Reserve it once: growing the panel when an
  // item is previewed is exactly the bug this port must not repeat.
  const info = {
    x: ledger.x,
    y: ledger.y,
    width: ledger.width,
    height: infoHeightFor(contentHeight),
  };

  const listTop = info.y + info.height + metrics.listGap;
  const rowHeight = clamp(
    (ledger.y + contentHeight - listTop - metrics.rowGap * (rowsPerPage - 1)) / rowsPerPage,
    metrics.minRowHeight,
    metrics.maxRowHeight,
  );
  const listHeight = rowHeight * rowsPerPage + metrics.rowGap * (rowsPerPage - 1);
  // Centred in whatever the rows did not use, so a tablet does not leave all the
  // slack in one strip above the footer.
  const list = {
    x: ledger.x,
    y: listTop + Math.max(0, (ledger.y + contentHeight - listTop - listHeight) / 2),
    width: ledger.width,
    height: listHeight,
  };

  // The dossier's caption shares the title line, which is what buys the chart
  // the last 20px of height on a phone.
  const rigHeight = stacked ? Math.min(190, Math.round(bodyHeight * 0.42)) : 0;
  const rig = stacked
    ? {
      x: dossier.x + 12, y: bodyTop, width: dossier.width - 24, height: rigHeight,
    }
    : {
      x: rigPanel.x + metrics.rigColumnInset,
      y: rigPanel.y + metrics.rigColumnInset,
      width: rigPanel.width - metrics.rigColumnInset * 2,
      height: rigPanel.height - metrics.rigColumnInset * 2 - metrics.rigCaptionHeight,
    };
  const chartTop = stacked ? bodyTop + rigHeight + 4 : bodyTop;
  const chart = {
    x: dossier.x + 6,
    y: chartTop,
    width: dossier.width - 12,
    height: Math.max(40, bodyBottom - chartTop),
  };

  return {
    ...frame,
    dossier,
    rigPanel,
    ledger,
    info,
    list,
    rows: {
      count: rowsPerPage, height: rowHeight, gap: metrics.rowGap,
    },
    // `radar` is the chart slot whatever it paints, so the tests and the
    // diagnostics can keep naming one rect.
    radar: chart,
    chart,
    slot,
    narrow: !stacked,
    rig,
    title: { x: dossier.x + 12, y: dossier.y + 15 },
    // Stacked, the team's caption shares the dossier title line; side by side it
    // sits under the team, in the team's own column.
    caption: stacked
      ? {
        x: dossier.x + dossier.width - 12, y: dossier.y + 15, align: "right",
      }
      : {
        x: rigPanel.x + rigPanel.width / 2,
        y: rigPanel.y + rigPanel.height - 8,
        align: "center",
      },
    // The camp names its own crew count, which on a phone no longer fits in the
    // dossier title line - it gets the bottom of the chart column.
    chartCaption: !stacked && slot === "camp"
      ? { x: dossier.x + dossier.width / 2, y: dossier.y + dossier.height - 8, align: "center" }
      : null,
    pageCount,
  };
}

export function rowRect(layout, index) {
  return {
    x: layout.list.x,
    y: layout.list.y + index * (layout.rows.height + layout.rows.gap),
    width: layout.list.width,
    height: layout.rows.height,
  };
}

// The button hugs the right edge of its row and is vertically centred, so a row
// that shrinks on a phone loses margin before it loses target height.
export function buyRect(row) {
  const height = Math.min(BUY_SIZE.height, Math.max(0, row.height - 12));
  return {
    x: row.x + row.width - 20 - BUY_SIZE.width,
    y: row.y + (row.height - height) / 2,
    width: BUY_SIZE.width,
    height,
  };
}

// What the buy button says and whether it can be pressed. A disabled button that
// only looks dim reads as broken; "军资不足 · 400 两" reads as the next goal, and
// "已达最高等级" / "名额已满" say there is nothing left to buy. `reason` is what
// the tap handler reports instead of calling the purchase path.
export function resolveBuy({ price, gold, maxedKey = null, buyKey = "shop.buy" }) {
  if (maxedKey) {
    return {
      labelKey: maxedKey, params: {}, disabled: true, reason: "maxed",
    };
  }
  if (gold < price) {
    return {
      labelKey: "shop.shortGold", params: { price }, disabled: true, reason: "gold",
    };
  }
  return {
    labelKey: buyKey, params: { price }, disabled: false, reason: null,
  };
}

// The horizontal reach of a label, in radii. The two near-horizontal axes sit at
// +-18 degrees, so their labels land at 1.16 * cos(18deg) of the radius from the
// centre, and then need `gutter` pixels of text before the box edge.
const RADAR_LABEL_REACH = 1.16 * Math.cos((18 * Math.PI) / 180);

// Radar geometry in canvas pixels. The labels live outside the outer ring, so
// the radius leaves room for them on every side rather than filling the box; on
// a narrow column the label room is what caps the radius. The label metrics come
// back with the geometry because they are the other half of the same promise: the
// canvas is told how wide a label may be (`labelMaxWidth`), so a font that
// measures wider than expected condenses the text instead of painting over the
// team column.
export function radarGeometry(rect, { narrow = false } = {}) {
  const gutter = narrow ? metrics.radarGutterNarrow : metrics.radarGutter;
  const labelOutset = narrow ? 3 : 4;
  const radius = Math.max(34, Math.min(
    rect.width * 0.3,
    rect.height * 0.31,
    (rect.width / 2 - gutter) / RADAR_LABEL_REACH,
  ));
  return {
    centerX: rect.x + rect.width / 2,
    centerY: rect.y + rect.height / 2,
    radius,
    maximum: 10,
    labelSize: narrow ? 9.5 : 10.5,
    labelOutset,
    labelGap: narrow ? 5.6 : 6.2,
    labelMaxWidth: Math.max(24, gutter - labelOutset),
  };
}

function radarAngle(index, count = statKeys.length) {
  return (-90 + index * 360 / count) * Math.PI / 180;
}

export function radarPoint(geometry, index, value) {
  const angle = radarAngle(index);
  const reach = geometry.radius * clamp(value / geometry.maximum, 0, 1);
  return {
    x: geometry.centerX + Math.cos(angle) * reach,
    y: geometry.centerY + Math.sin(angle) * reach,
  };
}

export function radarPolygon(geometry, values) {
  return values.map((value, index) => radarPoint(geometry, index, value));
}

// The team column shows the battlefield rig at whatever angle spends the most of
// its column: the chariot art faces +x, so a column taller than it is wide turns
// it a quarter turn (-90deg sends +x to -y, horses up the page) and a wide column
// keeps the orientation the player just fought in. The box that gets fitted is the
// sprite module's own `chariotRigBox`, the same one its unit test measures against
// the real draw calls, so the column can never fall out of step with the
// silhouette.
const RIG_VIEW = Object.freeze({
  turned: -Math.PI / 2,
  padding: 12,
});

// The corners of a local-space box after a rotation, as a box again - all the
// caller needs to fit a turned silhouette without re-deriving the transform.
export function projectRigBox(box, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corners = [];
  for (const x of [box.minX, box.maxX]) {
    for (const y of [box.minY, box.maxY]) {
      corners.push({ x: x * cos - y * sin, y: x * sin + y * cos });
    }
  }
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY,
  };
}

// Everything drawTeam needs to place the rig: the local box to centre on, the
// angle it will be shown at, and the one scale that fits that box - plus the
// padding - inside the rect it is given. `width`/`height` are the pixels the team
// will occupy, which is what the tests check against the rect.
export function rigPreview(horseCount = 1, rect = {}, { padding = RIG_VIEW.padding, kit = null } = {}) {
  // `kit` is the campaign's chassis art: a bought box and axle blades make the
  // rig bigger, and the fit has to follow or the column clips them.
  const box = chariotRigBox(clamp(Math.round(horseCount), 1, 4), kit);
  const angle = (rect.height ?? 0) > (rect.width ?? 0) ? RIG_VIEW.turned : 0;
  const projected = projectRigBox(box, angle);
  const scale = Math.min(
    Math.max(1, (rect.width ?? 0) - padding * 2) / projected.width,
    Math.max(1, (rect.height ?? 0) - padding * 2) / projected.height,
  );
  return {
    box,
    projected,
    angle,
    padding,
    scale,
    width: projected.width * scale,
    height: projected.height * scale,
  };
}

// Seats around the night camp's fire, far side first so the painter can draw the
// ring behind the flames and the near half in front. Seat 0 is the near edge -
// the player's own place - and the rest fill the ring clockwise from there, so a
// crew of two sits in front of the fire before anyone crosses it. `radius` is the
// half-width of the ellipse the ring sits on; `squash` turns that circle into a
// ground ellipse.
export function campSeats(count, {
  centerX = 0, centerY = 0, radius = 40, squash = 0.62,
} = {}) {
  const total = Math.max(1, Math.floor(count));
  return Array.from({ length: total }, (_, index) => {
    // Start at the near edge and walk round the ring: in canvas coordinates y
    // grows downward, so +90deg is the near (south) seat and 90 -> 450 sweeps
    // clockwise as the player sees it.
    const angle = (90 + (index * 360) / total) * Math.PI / 180;
    return {
      index,
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius * squash,
      near: Math.sin(angle) > 0,
      // The foot art faces +x, so a figure sitting on the ring has to turn to
      // look at the fire: the radial direction from the seat to the centre is
      // angle + PI. Seat 0, at the near edge, therefore faces up the page.
      facing: angle + Math.PI,
    };
  }).sort((a, b) => a.y - b.y);
}

// What a seated figure wears and carries. A recruit wears the same ally robe the
// battlefield gives a companion and holds the weapon his own row lists, so the camp
// previews the team instead of inventing a second costume; the colours come from
// the sprite module's palette rather than a copy of it, and the kit from the
// personnel table rather than a second copy of the roster.
const CREW_KIT = Object.freeze(Object.fromEntries(
  personnel.filter((person) => person.overlays).map((person) => [person.id, person.overlays]),
));

export function roleFigure(role) {
  if (!role) return { robeColor: spritePalette.playerRobe, overlays: ["sword"] };
  return {
    robeColor: spritePalette.allyRobe,
    overlays: CREW_KIT[role] ?? ["sword"],
  };
}

