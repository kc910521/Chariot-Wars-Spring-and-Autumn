import { createCanvasPage } from "./canvas-page.js";
import { createMenu } from "./menu.js";

// The home page's host: one canvas and the keyboard's door into it.
//
// The canvas itself - pixels, the page's own clock, and the pointer router that
// turns the rects a frame registered into taps - belongs to `canvas-page.js`, as it
// does for the shop. What is left here is the menu's wiring, plus the one thing a
// canvas cannot do for itself: 出征 is painted, so Tab cannot reach it and a screen
// reader cannot press it.
//
// `startProxy` is the answer, and it is the same button the DOM menu had - kept in
// the page, made invisible, and moved onto the painted rect after every frame. It
// takes no pointer events, so every tap still goes to the canvas and nothing can be
// counted twice; `:focus-visible` reveals it, so a keyboard player sees the focus
// ring exactly where the button is drawn.
export function createMenuPage({
  canvas, victoryLock = null, onStart = () => {}, startProxy = null, liveRegion = null,
}) {
  // The page's own logical space, shared with the painter: the host rewrites
  // `height` on every measure and the layout maths reads it back.
  const view = { width: 960, height: 592 };
  // The host is built after the painter (it needs the painter's draw), but the
  // painter needs the host's live region, so it is reached through this ref.
  const pageRef = { current: null };

  const menu = createMenu({
    view,
    victoryLock,
    onNotice: (message) => pageRef.current?.announce(message),
  });

  // Put the focus proxy on the rect the last frame painted, or take it out of the
  // page's tab order while the campaign is resting: a button that refuses is worse
  // than no button.
  function syncStartProxy() {
    if (!startProxy) return;
    const frame = menu.lastFrame();
    const box = canvas.getBoundingClientRect();
    if (!frame || frame.locked || !box.width || !box.height) {
      startProxy.hidden = true;
      startProxy.disabled = true;
      return;
    }
    const scaleX = box.width / frame.view.width;
    const scaleY = box.height / frame.view.height;
    const rect = frame.startRect;
    // The proxy is positioned against the section, and the canvas fills it: the
    // canvas's own offsets are the only thing between the two.
    const originX = canvas.offsetLeft || 0;
    const originY = canvas.offsetTop || 0;
    startProxy.hidden = false;
    startProxy.disabled = false;
    startProxy.style.left = `${originX + rect.x * scaleX}px`;
    startProxy.style.top = `${originY + rect.y * scaleY}px`;
    startProxy.style.width = `${rect.width * scaleX}px`;
    startProxy.style.height = `${rect.height * scaleY}px`;
  }

  const page = createCanvasPage({
    canvas,
    view,
    draw: (context, input, actions) => menu.draw(context, input, actions),
    // The one way off this page, and the stage manager that owns that transition is
    // built above this file.
    actions: { startRun: () => onStart() },
    onOpen: () => menu.reset(),
    onPaint: syncStartProxy,
    liveRegion,
  });
  pageRef.current = page;

  return {
    setActive: page.setActive,
    resize: page.resize,
    dispose: page.dispose,
    // Diagnostics: the last frame the menu painted - whether the card is resting,
    // where 出征 was drawn, what the two lines of the resting card said - so a
    // harness can press the button and read the countdown without reading pixels.
    view: page.view,
    lastFrame: () => menu.lastFrame(),
    // Every label comes from the translator on each frame, so a language switch
    // only has to get the page repainted - and the proxy re-positioned with it.
    refresh: page.refresh,
  };
}
