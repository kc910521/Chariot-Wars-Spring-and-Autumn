import { translate } from "../i18n/index.js";
import { CARD_ACTIONS } from "./battle-card.js";

export function bindControls({
  state, keys, startRun, startTutorial, beginMission, restartStage, setMode,
  resizeCanvas, resizeShop = () => {}, resizeMenu = () => {}, battleScreen, touchInput, endRun,
  confirmTutorial = () => {}, confirmGrant = () => {}, onSoundToggle = () => {}, onFormationOrder = () => {}, elements,
}) {
  const {
    startButton, menuStartButton, prologueStartButton, prologueTutorialButton,
    cardButton, soundButton, soundIcon,
    touchJoystickElement, touchJoystickKnob, touchOrderElement,
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
    //
    // The clan's gift card is the other one, and for the same reason: it opens over
    // a live field, the field waits for it (game.update), and its one button is
    // the only thing a key should be able to press.
    if (state.tutorial?.overlay && (key === "Enter" || key === " " || key === "Spacebar")) {
      confirmTutorial();
      return;
    }
    if (state.grant && (key === "Enter" || key === " " || key === "Spacebar")) {
      confirmGrant();
      return;
    }
    keys.add(key);
    if (key === "p" || key === "P" || key === "Escape") {
      togglePause();
      return;
    }
    // 出击 / 结阵 on a keyboard. The button for it is a touch control, so a
    // desktop player would otherwise have no way to give the order at all; the
    // key is swallowed here so it never reaches a movement binding.
    if ((key === "e" || key === "E") && state.mode === "running") {
      onFormationOrder();
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
  // The card's one button. What it means was decided when the card was painted -
  // src/ui/battle-card.js leaves it in `data-action` - so this is a table rather
  // than a branch on the mode: the drill's cards and the three screens share the
  // button without either side knowing about the other.
  const cardActions = {
    [CARD_ACTIONS.resume]: () => setMode("running"),
    [CARD_ACTIONS.retry]: () => restartStage(),
    // The victory card's only button: the run is over, so the campaign goes back
    // to nothing and the menu (now locked) shows what the next wait is for.
    [CARD_ACTIONS.endRun]: () => endRun(),
    [CARD_ACTIONS.tutorial]: () => confirmTutorial(),
    // The clan's gift: the line is already the player's, so this only puts the
    // card away (the gift is offered as the extraction gate opens, not before).
    [CARD_ACTIONS.grant]: () => confirmGrant(),
  };
  cardButton.addEventListener("click", () => cardActions[cardButton.dataset.action]?.());
  function refreshSoundLabel() {
    soundButton.setAttribute("aria-label", translate(state.sound ? "battle.soundOn" : "battle.soundOff"));
    soundButton.title = translate(state.sound ? "battle.soundOn" : "battle.soundOff");
  }

  soundButton.addEventListener("click", () => {
    state.sound = !state.sound;
    soundIcon.textContent = state.sound ? "♫" : "♪";
    refreshSoundLabel();
    // The player watches `state.sound` on its own, but the menu and the shop have
    // no battle frame to notice the change on, so the toggle tells it directly.
    onSoundToggle(state.sound);
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

  // The order button: one tap is one order, and the HUD rewrites the label the
  // moment it lands (it is the next order, not the current one).
  touchOrderElement.addEventListener("click", () => {
    if (state.mode !== "running") return;
    onFormationOrder();
  });

  window.addEventListener("resize", () => {
    updateTouchLayout();
    releaseJoystick();
    // Both canvases are measured from their own box: the battlefield's only while
    // it is on screen, the pages' whatever the mode (a no-op unless the page is
    // open, and it drops its cached size either way).
    if (!battleScreen.hidden) resizeCanvas();
    resizeShop();
    resizeMenu();
  });
  updateTouchLayout();

  return { togglePause, refreshLocale: refreshSoundLabel };
}
