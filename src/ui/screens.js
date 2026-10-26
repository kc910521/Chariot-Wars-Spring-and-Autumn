import { translate } from "../i18n/index.js";

export function createScreens({ state, campaign, draw, onModeChange, elements }) {
  const {
    menuScreen, prologueScreen, battleScreen, shopScreen, overlay, startLabel, startButton,
    overlayEyebrow, overlayTitle, overlayCopy, overlayButton,
  } = elements;

  function setMode(mode) {
    state.mode = mode;
    const running = mode === "running";
    // Only the battle states own the battlefield and the `battle-focus` chrome;
    // the menu, the story card and the shop sit outside. The overlay card is
    // narrower still: it is the pause/defeat dialog, so a live battle must not
    // show it - it stays on top of the field but hidden.
    const inBattle = running || mode === "paused" || mode === "over";
    const showOverlayCard = mode === "paused" || mode === "over";
    document.body.classList.toggle("battle-focus", inBattle);
    menuScreen.hidden = mode !== "menu";
    prologueScreen.hidden = mode !== "prologue";
    shopScreen.hidden = mode !== "shop";
    battleScreen.hidden = !inBattle;
    overlay.classList.toggle("hidden", !showOverlayCard);
    startLabel.textContent = translate(running ? "battle.pause" : mode === "paused" ? "battle.resumeLabel" : "battle.startLabel");
    startButton.setAttribute("aria-label", translate(mode === "paused" ? "battle.resumeLabel" : "battle.pauseLabel"));
    startButton.hidden = mode === "over";

    if (mode === "paused") {
      overlayEyebrow.textContent = translate("battle.pausedEyebrow");
      overlayTitle.textContent = translate("battle.pausedTitle");
      overlayCopy.textContent = translate("battle.pausedCopy");
      overlayButton.firstElementChild.textContent = translate("battle.resume");
    } else if (mode === "over") {
      overlayEyebrow.textContent = translate("battle.defeatEyebrow");
      overlayTitle.textContent = translate("battle.defeatTitle");
      overlayCopy.textContent = translate("battle.defeatCopy", { gold: campaign.totalGold, stage: campaign.stage });
      overlayButton.firstElementChild.textContent = translate("battle.retry");
    }

    draw();
    onModeChange?.(mode);
  }

  return { setMode };
}
