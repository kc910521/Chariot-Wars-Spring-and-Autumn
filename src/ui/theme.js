// Palette lifted from the stylesheet (`styles/game.css:3-13`) and flattened into
// constants, because a canvas has no CSS to inherit from. The shop is the H5
// port's first pure-canvas screen: keeping the colours here means the sheet and
// the canvas cannot drift apart in the two directions the page still shares.
export const COLORS = {
  edge: "rgba(211, 185, 139, 0.34)",
  line: "rgba(211, 185, 139, 0.18)",
  text: "#eee2c9",
  muted: "#a69478",
  gold: "#d2ad68",
  cinnabar: "#a94432",
  cinnabarBright: "#c25a42",
  field: "#929d6d",
};

// The page loads its fonts from the stylesheet (`@import` at the top of
// `styles/game.css`), and a canvas can use them as soon as they are decoded - so
// this stack names the real families and keeps a CJK system fallback for the
// first frames. `shop-screen.js` waits for `document.fonts.ready` before it
// measures anything, because a label measured against the fallback would reflow
// the moment the web font lands.
const FONT_FAMILY = '"DM Sans", "PingFang SC", "Microsoft YaHei", sans-serif';
export const SERIF_FAMILY = '"Noto Serif SC", "Songti SC", "PingFang SC", serif';

export function font(size, weight = "normal", family = FONT_FAMILY) {
  return `${weight} ${size}px ${family}`;
}

export const RADIUS = 10;
