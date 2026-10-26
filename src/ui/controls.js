import { translate } from "../i18n/index.js";

export function bindControls({
  state, keys, startRun, beginMission, rollForNextBattle, restartStage, setMode, resizeCanvas,
  battleScreen, touchInput, endRun, elements,
}) {
  const {
    startButton, menuStartButton, prologueStartButton, nextBattleButton, overlayButton,
    victoryReturnButton, soundButton, soundIcon,
    touchJoystickElement, touchJoystickKnob,
  } = elements;

  function togglePause() {
    if (state.mode === "running") {
      keys.clear();
      releaseJoystick();
      setMode("paused");
    } else if (state.mode === "paused") {
      setMode("running");
    }
  }

  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLElement
      && (event.target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName))) return;
    const key = event.key;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(key)) event.preventDefault();
    keys.add(key);
    if (key === "p" || key === "P" || key === "Escape") {
      togglePause();
      return;
    }
    if (state.mode === "menu" && (key === "Enter" || key === " ")) {
      startRun();
      return;
    }
    if (state.mode === "prologue" && (key === "Enter" || key === " ")) {
      beginMission();
      return;
    }
    if (state.mode === "over" && (key === "Enter" || key === " ")) restartStage();
  });

  window.addEventListener("keyup", (event) => keys.delete(event.key));
  window.addEventListener("blur", () => {
    keys.clear();
    releaseJoystick();
    if (state.mode === "running") setMode("paused");
  });

  startButton.addEventListener("click", () => {
    if (state.mode === "running") togglePause();
    else if (state.mode === "paused") setMode("running");
  });
  menuStartButton.addEventListener("click", () => startRun());
  prologueStartButton.addEventListener("click", () => beginMission());
  nextBattleButton.addEventListener("click", rollForNextBattle);
  // The victory card's only button: the run is over, so the campaign goes back to
  // nothing and the menu (now locked) shows what the next wait is for.
  victoryReturnButton.addEventListener("click", () => endRun());
  overlayButton.addEventListener("click", () => {
    if (state.mode === "paused") setMode("running");
    else if (state.mode === "over") restartStage();
  });
  function refreshSoundLabel() {
    soundButton.setAttribute("aria-label", translate(state.sound ? "battle.soundOn" : "battle.soundOff"));
    soundButton.title = translate(state.sound ? "battle.soundOn" : "battle.soundOff");
  }

  soundButton.addEventListener("click", () => {
    state.sound = !state.sound;
    soundIcon.textContent = state.sound ? "♫" : "♪";
    refreshSoundLabel();
  });

  function updateTouchLayout() {
    document.body.classList.add("touch-layout");
  }

  function updateJoystick(event) {
    const bounds = touchJoystickElement.getBoundingClientRect();
    const radius = Math.min(bounds.width, bounds.height) / 2;
    const deltaX = event.clientX - (bounds.left + bounds.width / 2);
    const deltaY = event.clientY - (bounds.top + bounds.height / 2);
    const distance = Math.hypot(deltaX, deltaY);
    const magnitude = Math.min(1, distance / (radius * 0.72));
    touchInput.x = distance === 0 ? 0 : (deltaX / distance) * magnitude;
    touchInput.y = distance === 0 ? 0 : (deltaY / distance) * magnitude;
    touchJoystickKnob.style.setProperty("--stick-x", `${touchInput.x * 34}px`);
    touchJoystickKnob.style.setProperty("--stick-y", `${touchInput.y * 34}px`);
  }

  function releaseJoystick() {
    touchInput.x = 0;
    touchInput.y = 0;
    touchJoystickKnob.style.setProperty("--stick-x", "0px");
    touchJoystickKnob.style.setProperty("--stick-y", "0px");
  }

  touchJoystickElement.addEventListener("pointerdown", (event) => {
    if (state.mode !== "running") return;
    event.preventDefault();
    touchJoystickElement.setPointerCapture(event.pointerId);
    updateJoystick(event);
  });
  touchJoystickElement.addEventListener("pointermove", (event) => {
    if (touchJoystickElement.hasPointerCapture(event.pointerId)) updateJoystick(event);
  });
  touchJoystickElement.addEventListener("pointerup", releaseJoystick);
  touchJoystickElement.addEventListener("pointercancel", releaseJoystick);
  touchJoystickElement.addEventListener("lostpointercapture", releaseJoystick);

  const attackButton = document.querySelector(".touch-fire");
  attackButton.addEventListener("pointerdown", (event) => {
    if (state.mode !== "running") return;
    event.preventDefault();
    keys.add(" ");
    attackButton.setPointerCapture(event.pointerId);
  });
  const releaseAttack = () => keys.delete(" ");
  attackButton.addEventListener("pointerup", releaseAttack);
  attackButton.addEventListener("pointercancel", releaseAttack);
  attackButton.addEventListener("lostpointercapture", releaseAttack);

  window.addEventListener("resize", () => {
    updateTouchLayout();
    releaseJoystick();
    if (!battleScreen.hidden) resizeCanvas();
  });
  updateTouchLayout();

  return { togglePause, refreshLocale: refreshSoundLabel };
}
