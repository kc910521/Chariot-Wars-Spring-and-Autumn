import { translate } from "../i18n/index.js";

export function bindControls({
  state, keys, startRun, startTutorial, beginMission, rollForNextBattle, restartStage, setMode,
  resizeCanvas, battleScreen, touchInput, endRun, confirmTutorial = () => {}, elements,
}) {
  const {
    startButton, menuStartButton, prologueStartButton, prologueTutorialButton, nextBattleButton,
    overlayButton, victoryReturnButton, soundButton, soundIcon,
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
    // A tutorial card is the only thing on the field that answers to the keyboard
    // while it is up: the battle underneath it is frozen, so Enter and Space mean
    // "understood", not "go". Neither key is registered either - a Space that
    // confirmed a card must not also start a bow draw the player cannot see.
    if (state.tutorial?.overlay && (key === "Enter" || key === " " || key === "Spacebar")) {
      confirmTutorial();
      return;
    }
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
  // The drill opens from the same story card, with the same freshly rolled run.
  prologueTutorialButton.addEventListener("click", () => startTutorial());
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
