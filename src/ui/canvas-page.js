import { contains } from "./widgets.js";

// The two canvas pages in this build - the shop and the home page - are the same
// machine: one canvas in logical view units, one frame clock of their own, and a
// pointer router that turns the rects a frame registered into taps. This is that
// machine; `shop-screen.js` and `menu-page.js` are only the wiring around it.
//
// The rule it exists to keep: **a tap is only delivered to the target that was
// under the finger when it went down**. A purchase can re-slice the catalogue
// between the press and the release, and the home page's 出征 can be replaced by
// the resting card mid-press, so the router compares keys rather than trusting
// the frame it drew.
const MAX_PIXEL_RATIO = 2;
// How far a finger may travel before a press is a scroll, not a tap. Logical
// units, so a phone and a tablet agree about it.
const DRAG_CANCEL = 12;

// One frame source per page, resolved the way `game/loop.js` resolves it: the
// battle loop owns the battlefield's clock and must not be slowed down by a page,
// so each page runs its own.
const scheduleFrame = typeof globalThis.requestAnimationFrame === "function"
  ? (callback) => globalThis.requestAnimationFrame(callback)
  : (callback) => globalThis.setTimeout(() => callback(globalThis.performance?.now?.() ?? Date.now()), 16);
const cancelFrame = typeof globalThis.cancelAnimationFrame === "function"
  ? (handle) => globalThis.cancelAnimationFrame(handle)
  : (handle) => globalThis.clearTimeout(handle);

// `view` is the page's own logical space, owned by the caller because the painter
// needs it before the host exists. Width is fixed; `height` is rewritten on every
// measure from the element's aspect ratio, so a phone gets a different shape -
// never a scaled-down tablet.
//
// `draw(context, input, actions)` paints one frame and registers its targets
// through `input.addTarget()`; the list is cleared before every frame, so a target
// lives exactly as long as the frame that drew it. `onOpen` runs each time the
// page is shown, which is where a page resets whatever a previous visit left.
export function createCanvasPage({
  canvas, view, draw, actions = {}, onOpen = () => {}, liveRegion = null,
}) {
  const context = canvas.getContext("2d");
  const targets = [];
  // Presses by pointer id: a second finger may press its own control, and neither
  // may hijack the other's release.
  const presses = new Map();
  let active = false;
  let frameHandle = null;
  let clock = 0;
  // What was measured last, so the page is not re-allocated every frame.
  let sizeKey = "";

  // The immediate-mode target list. `key` identifies the target across frames,
  // which is what makes a press survive the frames between down and up.
  const input = {
    addTarget(rect, onTap, handlers = {}) {
      const target = { rect, onTap, ...handlers };
      targets.push(target);
      return target;
    },
  };

  // Every notice a page prints is also announced once through its live region: a
  // canvas is opaque to a screen reader, and a purchase - or the length of the
  // post-victory rest - is exactly the kind of event it must be able to hear.
  function announce(message) {
    if (liveRegion) liveRegion.textContent = message;
  }


  function measure() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const ratio = Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const key = `${Math.round(rect.width)}x${Math.round(rect.height)}@${ratio}`;
    if (key === sizeKey) return true;
    sizeKey = key;
    view.height = view.width * rect.height / rect.width;
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    // One transform for the whole page: everything above is written in view units.
    context.setTransform(canvas.width / view.width, 0, 0, canvas.height / view.height, 0, 0);
    return true;
  }

  function paint() {
    if (!measure()) return;
    targets.length = 0;
    draw(context, input, actions);
  }

  function frame(time) {
    frameHandle = null;
    if (!active) return;
    // The frame source's stamp is the page's only clock: the shop's fire flickers
    // and its horses trot off `now()`, and neither needs a second time base.
    if (Number.isFinite(time)) clock = time / 1000;
    try {
      paint();
    } catch (error) {
      // A broken frame must not spin: stop the page's clock and report once, the
      // same contract the battle loop keeps.
      active = false;
      console.error("[chariot-wars] canvas page draw failed", error);
      return;
    }
    frameHandle = scheduleFrame(frame);
  }

  function pointFor(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: (event.clientX - rect.left) * view.width / rect.width,
      y: (event.clientY - rect.top) * view.height / rect.height,
    };
  }

  // Last registered wins: a buy button is registered after its row, so it is
  // preferred inside its own rect.
  function targetAt(point) {
    for (let index = targets.length - 1; index >= 0; index -= 1) {
      if (contains(targets[index].rect, point.x, point.y)) return targets[index];
    }
    return null;
  }

  function releasePress(press) {
    presses.delete(press.pointerId);
    press.target?.onRelease?.();
  }

  function handleDown(event) {
    if (!active) return;
    const point = pointFor(event);
    if (!point) return;
    const target = targetAt(point);
    if (!target) return;
    const press = {
      pointerId: event.pointerId ?? 0,
      key: target.key ?? null,
      clientX: event.clientX,
      clientY: event.clientY,
      target,
    };
    presses.set(press.pointerId, press);
    target.onPress?.();
  }

  function handleMove(event) {
    const press = presses.get(event.pointerId ?? 0);
    if (!press) return;
    // Sliding off cancels: the control under the finger is now a scroll, not a
    // purchase.
    const travelled = Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY)
      * view.width / canvas.getBoundingClientRect().width;
    if (travelled > DRAG_CANCEL) releasePress(press);
  }

  function handleUp(event) {
    const pointerId = event.pointerId ?? 0;
    const press = presses.get(pointerId);
    if (!press) return;
    const point = pointFor(event);
    const landed = point ? targetAt(point) : null;
    presses.delete(pointerId);
    press.target.onRelease?.();
    // The same target, by key: a frame may have rebuilt the list in between, and a
    // rect that moved must not fire.
    if (landed && (landed.key ?? null) === press.key) landed.onTap?.();
  }

  function handleCancel(event) {
    const press = presses.get(event.pointerId ?? 0);
    if (press) releasePress(press);
  }

  canvas.addEventListener("pointerdown", handleDown);
  canvas.addEventListener("pointermove", handleMove);
  canvas.addEventListener("pointerup", handleUp);
  canvas.addEventListener("pointercancel", handleCancel);
  // A pointer that leaves the element without a release (a mouse dragged out of
  // the window) must not leave a control stuck in its pressed state.
  canvas.addEventListener("pointerleave", handleCancel);

  // The stylesheet loads the page's fonts; measuring before they land would place
  // the first labels with the fallback metrics. One repaint is enough - the page
  // re-measures every frame after it.
  const fonts = typeof document !== "undefined" ? document.fonts : null;
  if (fonts && typeof fonts.ready?.then === "function") {
    fonts.ready.then(() => { if (active) paint(); }).catch(() => {});
  }

  // Opening the page: it starts from whatever `onOpen` resets, and its clock
  // starts from the frame the player arrives on.
  function setActive(next) {
    if (next === active) return;
    active = Boolean(next);
    if (active) {
      onOpen();
      paint();
      frameHandle = scheduleFrame(frame);
      return;
    }
    if (frameHandle !== null) cancelFrame(frameHandle);
    frameHandle = null;
    for (const press of presses.values()) press.target?.onRelease?.();
    presses.clear();
    targets.length = 0;
  }

  // Called by the composition root when the canvas changed size (a rotation, a
  // window resize, the sheet's breakpoints). Dropping `sizeKey` is what makes the
  // next frame re-allocate the backing store and re-fit the page.
  function resize() {
    sizeKey = "";
    if (active) paint();
  }

  function dispose() {
    setActive(false);
    canvas.removeEventListener("pointerdown", handleDown);
    canvas.removeEventListener("pointermove", handleMove);
    canvas.removeEventListener("pointerup", handleUp);
    canvas.removeEventListener("pointercancel", handleCancel);
    canvas.removeEventListener("pointerleave", handleCancel);
  }

  return {
    setActive,
    resize,
    dispose,
    announce,
    // The page's only time base, in seconds: the shop's fire flickers and its
    // horses trot off it, and neither needs a second clock.
    now: () => clock,
    // A repaint with nothing else changed: a locale switch, or a test setting a
    // number the page prints.
    refresh: () => { if (active) paint(); },
    view,
  };
}

