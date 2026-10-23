// Frame loop with failure isolation. The loop stops on the first update/render
// exception and reports it once instead of freezing a half-drawn canvas with
// no feedback.
//
// The loop is the single owner of the time base: `state.lastTime` is only ever
// written from the timestamp the frame source hands us. Stamping it from a
// second clock (performance.now()) used to make the first delta after a battle
// start hugely negative on the 小游戏 runtime, which drove the camera to
// -Infinity and then permanently to NaN.
const MAX_DELTA = 0.05;

// 小游戏 provides requestAnimationFrame, but a missing frame source must not
// freeze the game silently, so a timer keeps it alive.
const scheduleFrame = typeof globalThis.requestAnimationFrame === "function"
  ? (callback) => globalThis.requestAnimationFrame(callback)
  : (callback) => globalThis.setTimeout(() => callback(Date.now()), 16);
const cancelFrame = typeof globalThis.cancelAnimationFrame === "function"
  ? (handle) => globalThis.cancelAnimationFrame(handle)
  : (handle) => globalThis.clearTimeout(handle);

export function startGameLoop({ state, update, draw, onError }) {
  let frameHandle = null;
  let stopped = false;

  function toDelta(time) {
    const raw = (time - state.lastTime) / 1000;
    // Clamp both ends: neither a negative delta nor a non-finite one is ever
    // meaningful, and the ceiling stops a stalled frame from teleporting units.
    return Number.isFinite(raw) ? Math.min(Math.max(raw, 0), MAX_DELTA) : 0;
  }

  function fail(error, phase) {
    if (stopped) return;
    stopped = true;
    if (frameHandle !== null) cancelFrame(frameHandle);
    console.error(`[chariot-wars] ${phase} failed`, error);
    if (typeof onError === "function") {
      try {
        onError(error, phase);
      } catch (reportError) {
        console.error("[chariot-wars] could not display the error report", reportError);
      }
    }
  }

  function frame(time) {
    if (stopped) return;
    const delta = toDelta(time);
    // A missing timestamp must not reset the clock to zero, or the next frame
    // would see a delta larger than the clamp allows and hitch.
    if (Number.isFinite(time)) state.lastTime = time;
    try {
      if (state.mode === "running") update(delta);
    } catch (error) {
      fail(error, "update");
      return;
    }
    try {
      draw();
    } catch (error) {
      fail(error, "render");
      return;
    }
    frameHandle = scheduleFrame(frame);
  }

  function start() {
    scheduleFrame((time) => {
      if (stopped) return;
      // Prime the clock from the frame source itself. `performance.now()` is not
      // guaranteed to share this time base (小游戏 falls back to Date.now()).
      state.lastTime = Number.isFinite(time) ? time : 0;
      frameHandle = scheduleFrame(frame);
    });
  }

  function stop() {
    stopped = true;
    if (frameHandle !== null) cancelFrame(frameHandle);
    frameHandle = null;
  }

  return { start, stop };
}
