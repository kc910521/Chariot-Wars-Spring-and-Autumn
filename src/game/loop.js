// Frame loop with failure isolation. The loop stops on the first update/render
// exception and reports it once instead of freezing a half-drawn canvas with
// no feedback.
export function startGameLoop({ state, update, draw, onError }) {
  let frameHandle = null;
  let stopped = false;

  function fail(error, phase) {
    if (stopped) return;
    stopped = true;
    if (frameHandle !== null) window.cancelAnimationFrame(frameHandle);
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
    const delta = Math.min((time - state.lastTime) / 1000 || 0, 0.05);
    state.lastTime = time;
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
    frameHandle = window.requestAnimationFrame(frame);
  }

  function start() {
    window.requestAnimationFrame((time) => {
      if (stopped) return;
      state.lastTime = time;
      frameHandle = window.requestAnimationFrame(frame);
    });
  }

  function stop() {
    stopped = true;
    if (frameHandle !== null) window.cancelAnimationFrame(frameHandle);
    frameHandle = null;
  }

  return { start, stop };
}
