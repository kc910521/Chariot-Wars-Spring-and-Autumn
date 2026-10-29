// Pure geometry for the canvas home page: no DOM, no canvas and no translation, so
// the painting code, the pointer target and the unit tests all read the same
// numbers.
//
// It is a port of the mini game's card (`chariot-wars/src/ui/screens.js`, the
// `drawMenu` block) at the same numbers, because the two builds are meant to read
// as one game on two devices: a 550x380 card centred in the page, an eyebrow, the
// title, the seal, two lines of lede, and one 224x50 出征 under them. Everything
// here is an anchor or a box; the copy and the fitting are the painter's job.
//
// The card shrinks with a short view but never with a wide one: the stylesheet
// gives the canvas `max(540px, 100vh - 128px)`, so the page is never shorter than
// its own content needs - which is what the mini game's fixed 592-unit view does
// for it too.

// The two lines of lede are what the card reserves room for. A lede that wraps to
// three is clipped rather than allowed to push 出征 down, so the button sits in the
// same place in both locales.
const LEDE_LINES = 2;
const LEDE_LINE_HEIGHT = 20;

export function computeMenuLayout(view) {
  const width = Math.max(0, Math.min(550, view.width - 80));
  const height = Math.max(0, Math.min(380, view.height - 60));
  const x = (view.width - width) / 2;
  const y = (view.height - height) / 2;
  const center = view.width / 2;

  // 出征: a thumb target once it is a button, and the same slot for the resting
  // card, which grows to two lines by taking 12px off each side of it.
  const start = { x: center - 112, y: y + height - 68, width: 224, height: 50 };
  const lock = {
    x: start.x, y: start.y - 12, width: start.width, height: start.height + 24,
  };

  return {
    // The whole page, painted before the card so the card's own fill is not the
    // only thing standing between the player and a black rectangle.
    veil: { x: 0, y: 0, width: view.width, height: view.height },
    panel: { x, y, width, height },
    // Text anchors are the point each line is centred on, not a box corner: every
    // line on this card is horizontally centred, so a box would only be a
    // rectangle whose centre the painter recomputes.
    eyebrow: { x: center, y: y + 42, size: 13 },
    title: { x: center, y: y + 96, size: 38, min: 20, maxWidth: width - 48 },
    // The seal is `menu.seal`, and in English that string is two lines
    // ("Chariot\nWars") because the DOM drew it vertically. A canvas has no
    // writing mode, so the painter stacks the lines here instead.
    seal: { x: center, y: y + 136, size: 15, lineHeight: 18 },
    lede: {
      x: center,
      y: y + 172,
      size: 12,
      lineHeight: LEDE_LINE_HEIGHT,
      maxWidth: width - 96,
      maxLines: LEDE_LINES,
    },
    start,
    lock,
    // The card's two lines fit themselves to the rect: `menu.locked` carries a
    // countdown and `menu.lockedLast` carries a name and a stage number, so both
    // are longer in one language, and neither may paint over its neighbour.
    lockHeadline: { size: 14, min: 10, inset: 10, offsetY: 20 },
    lockDetail: { size: 12, min: 9, inset: 10, offsetY: 43 },
    startSize: 18,
  };
}
