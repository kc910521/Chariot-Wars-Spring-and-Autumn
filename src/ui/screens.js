import { translate } from "../i18n/index.js";
import { cardForGrant, cardForMode, cardForTutorial } from "./battle-card.js";

export function createScreens({
  state, campaign, draw, onModeChange, victoryLock = null, elements, battleCard,
}) {
  const {
    menuScreen, prologueScreen, battleScreen, shopScreen, startLabel, startButton,
  } = elements;

  // One card, one line, and one order between them: the mode's card wins, and what
  // is left over is the drill's beat and the clan's gift - both of which live
  // outside the mode machine (the battle is "running" while either of them is up)
  // and both of which have to come back when a pause opened over them closes.
  //
  // The gift is the one card that is raised without a mode change: it arrives as
  // the extraction opens (stages.js offerClanGrant), the field freezes under it
  // (src/game/game.js), and the gate is walked through after the news is put away.
  // So a tab switch during the news shows the pause card over it and brings the
  // news back on resume, which is exactly the two things the player needs to know.
  //
  // It is its own function because a card is not always a mode change: whoever
  // pushes the gift calls this instead of `setMode`.
  function showCard() {
    battleCard.show(
      cardForMode(state.mode, { campaign, state })
      ?? cardForGrant(state.grant)
      ?? cardForTutorial(state.tutorial?.overlay),
    );
  }

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
    showCard();
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

  return { setMode, showCard };
}
