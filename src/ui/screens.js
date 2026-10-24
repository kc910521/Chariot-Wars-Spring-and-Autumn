import { translate } from "../i18n/index.js";

export function createScreens({ state, campaign, draw, onModeChange, elements }) {
  const {
    menuScreen, battleScreen, shopScreen, overlay, startLabel, startButton,
    overlayEyebrow, overlayTitle, overlayCopy, overlayButton,
  } = elements;

  function setMode(mode) {
    state.mode = mode;
    const running = mode === "running";
    document.body.classList.toggle("battle-focus", mode === "running" || mode === "paused" || mode === "over");
    menuScreen.hidden = mode !== "menu";
    shopScreen.hidden = mode !== "shop";
    battleScreen.hidden = mode === "menu" || mode === "shop";
    overlay.classList.toggle("hidden", running || mode === "menu" || mode === "shop");
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
