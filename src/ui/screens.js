import { translate } from "../i18n/index.js";
import { cardForMode, cardForTutorial } from "./battle-card.js";

export function createScreens({
  state, campaign, draw, onModeChange, victoryLock = null, elements, battleCard,
}) {
  const {
    menuScreen, prologueScreen, battleScreen, shopScreen, startLabel, startButton,
  } = elements;

  function setMode(mode) {
    state.mode = mode;
    const running = mode === "running";
    // Only the battle states own the battlefield and the `battle-focus` chrome;
    // the menu, the story card and the shop sit outside. The card is the field's
    // own dialog: a live battle must not show it, it stays on top of the field but
    // hidden, and a victory keeps the field's last frame underneath while the run
    // is being reported.
    const inBattle = running || mode === "paused" || mode === "over" || mode === "victory";
    document.body.classList.toggle("battle-focus", inBattle);
    menuScreen.hidden = mode !== "menu";
    prologueScreen.hidden = mode !== "prologue";
    shopScreen.hidden = mode !== "shop";
    battleScreen.hidden = !inBattle;
    // One card, one line. The mode's card wins; what is left over is the drill's
    // beat, which lives outside the mode machine (the battle is "running" while a
    // drill card is up) - and has to come back when a pause opened over it closes.
    battleCard.show(cardForMode(mode, { campaign, state }) ?? cardForTutorial(state.tutorial?.overlay));
    startLabel.textContent = translate(running ? "battle.pause" : mode === "paused" ? "battle.resumeLabel" : "battle.startLabel");
    startButton.setAttribute("aria-label", translate(mode === "paused" ? "battle.resumeLabel" : "battle.pauseLabel"));
    startButton.hidden = mode === "over" || mode === "victory";

    if (mode === "menu") {
      // Opening the menu is the one moment the lock is re-read from storage: the
      // record can have been written by an earlier visit, and the countdown the
      // canvas card paints is then worked out from the timestamp, not polled. It
      // happens before `onModeChange` below, which is what opens the page.
      victoryLock?.refresh();
    }

    draw();
    onModeChange?.(mode);
  }

  return { setMode };
}
