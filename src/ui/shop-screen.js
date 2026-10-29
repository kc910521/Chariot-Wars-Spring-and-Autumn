import { createCanvasPage } from "./canvas-page.js";
import { createShop } from "./shop.js";

// The shop page: the dossier, the ledger and the next-battle button, all painted
// on one canvas.
//
// The canvas itself - pixels, the page's own clock, and the pointer router that
// turns the rects a frame registered into taps - belongs to `canvas-page.js`, as
// it does for the home page. What is left here is the shop's three answers: what
// to draw, what a tap means, and what opening the page resets.
//
// `shop.js` draws in logical view units (960 wide, as tall as the element's
// aspect ratio makes it) and knows nothing about a device; the host owns the one
// browser-shaped concern - pixels.
export function createShopScreen({
  canvas, campaign, equipmentShop, onNextBattle = () => {}, liveRegion = null,
}) {
  // The page's own logical space, shared with the painter: the host rewrites
  // `height` on every measure and the layout maths reads it back.
  const view = { width: 960, height: 592 };
  // The host is built after the shop (it needs the shop's draw), but the shop needs
  // the host's clock and its live region, so both are reached through this ref
  // instead of being captured during construction.
  const pageRef = { current: null };

  const shop = createShop({
    campaign,
    equipmentShop,
    view,
    now: () => pageRef.current?.now() ?? 0,
    onNotice: (message) => pageRef.current?.announce(message),
  });

  const page = createCanvasPage({
    canvas,
    view,
    draw: (context, input, actions) => shop.draw(context, input, actions),
    // The footer button is the campaign's one exit, and the stage manager that
    // owns that transition is built above this file.
    actions: { rollForNextBattle: () => onNextBattle() },
    // Opening the page: the shop always starts on the first tab with nothing
    // pinned.
    onOpen: () => shop.reset(),
    liveRegion,
  });
  pageRef.current = page;

  return {
    setActive: page.setActive,
    resize: page.resize,
    dispose: page.dispose,
    // Diagnostics: the page's own space, and the last frame the shop painted -
    // rects, labels and the radar's two stat sets, so a harness can prove a
    // purchase previewed before it was paid for without reading pixels.
    view: page.view,
    lastFrame: () => shop.lastFrame(),
    // Everything is drawn from campaign data every frame, so a change made
    // outside a tap (a locale switch, a test setting gold) needs a repaint and
    // nothing else.
    refresh: page.refresh,
  };
}
