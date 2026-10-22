import { getLocale, translate } from "../i18n/index.js";

export function createHud({ state, player, getCampaignFunds, getCampaignStage, elements }) {
  let lastFootMode;
  let lastLocale;

  function updateHud() {
    const {
      scoreElement, waveElement, goldElement, modeElement, hullLabelElement, hullValueElement,
      hullHealthElement, objectiveCountElement, objectiveProgressElement, objectiveLabelElement,
      extractionGuideElement, extractionArrowElement, extractionDistanceElement,
      touchPadElement, touchHintElement, touchControlsElement,
    } = elements;
    const onFoot = player.mode === "foot";
    const locale = getLocale();
    scoreElement.textContent = String(state.score).padStart(5, "0");
    waveElement.textContent = String(getCampaignStage()).padStart(2, "0");
    goldElement.textContent = String(getCampaignFunds());
    modeElement.textContent = translate(onFoot ? "battle.foot" : "battle.chariot");
    modeElement.classList.toggle("on-foot", onFoot);
    hullLabelElement.textContent = translate(onFoot ? "battle.footHealth" : "battle.hull");
    if (lastFootMode !== onFoot || lastLocale !== locale) {
      touchControlsElement.classList.toggle("foot-phase", onFoot);
      touchPadElement.setAttribute("aria-label", translate(onFoot ? "battle.touchFootDirection" : "battle.touchDirection"));
      touchHintElement.textContent = translate(onFoot ? "battle.touchHintFoot" : "battle.touchHint");
      lastFootMode = onFoot;
      lastLocale = locale;
    }
    hullValueElement.textContent = String(Math.ceil(player.health));
    hullHealthElement.style.width = `${player.health / player.maxHealth * 100}%`;
    hullHealthElement.classList.toggle("damaged", player.health / player.maxHealth < 0.35);
    objectiveCountElement.textContent = `${Math.min(state.kills, state.objectiveTarget)} / ${state.objectiveTarget}`;
    objectiveProgressElement.style.width = `${Math.min(100, state.kills / state.objectiveTarget * 100)}%`;
    const extracting = state.phase === "extract" && state.extractionPoint;
    const bossAlive = state.bossStage && !state.bossDefeated;
    objectiveLabelElement.textContent = translate(extracting ? "battle.extractDistance" : bossAlive ? "battle.boss" : "battle.objective");
    extractionGuideElement.hidden = !extracting;
    if (bossAlive && state.boss) {
      objectiveCountElement.textContent = `${Math.ceil(state.boss.health)} / ${state.boss.maxHealth}`;
      objectiveProgressElement.style.width = `${Math.max(0, state.boss.health / state.boss.maxHealth * 100)}%`;
      objectiveProgressElement.classList.add("boss-health");
    } else {
      objectiveProgressElement.classList.remove("boss-health");
    }
    if (extracting) {
      const dx = state.extractionPoint.x - player.x;
      const dy = state.extractionPoint.y - player.y;
      const distance = Math.hypot(dx, dy);
      objectiveCountElement.textContent = translate("battle.steps", { distance: Math.ceil(distance) });
      objectiveProgressElement.style.width = `${Math.max(0, Math.min(100, 100 - distance / 10))}%`;
      extractionDistanceElement.textContent = translate("battle.distance", { distance: Math.ceil(distance) });
      extractionArrowElement.style.setProperty("--guide-angle", `${Math.atan2(dy, dx) + Math.PI / 2}rad`);
    } else if (!bossAlive) {
      objectiveCountElement.textContent = `${Math.min(state.kills, state.objectiveTarget)} / ${state.objectiveTarget}`;
      objectiveProgressElement.style.width = `${Math.min(100, state.kills / state.objectiveTarget * 100)}%`;
    }
  }

  return updateHud;
}
