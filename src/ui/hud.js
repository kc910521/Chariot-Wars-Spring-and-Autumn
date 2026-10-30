import { formationOrders } from "../data/formations.js";
import { projectileRules } from "../data/rules.js";
import { getLocale, translate } from "../i18n/index.js";
import { stageLabel } from "./labels.js";

export function createHud({
  state, player, campaign, getCampaignFunds, getPlayerName = () => null,
  getFormationOrder = () => null, elements,
}) {
  let lastFootMode;
  let lastLocale;
  let lastCharge;
  let lastOrderStamp;

  // The fire control doubles as the bow's draw meter: holding it fills a ring,
  // and a full ring means the release will be the long shot. Only write when the
  // 5% step changes, because updateHud() runs on every frame.
  function updateCharge() {
    const charge = player.mode === "foot"
      ? 0
      : Math.min(1, state.fireHold / projectileRules.playerVolley.holdSeconds);
    const step = Math.round(charge * 20) / 20;
    if (step === lastCharge) return;
    lastCharge = step;
    const fireButton = elements.touchFireElement;
    fireButton.style.setProperty("--charge", String(step));
    fireButton.classList.toggle("charged", step >= 1);
  }

  // 出击 / 结阵. The button only exists while the player is standing in a line he
  // owns - the ring under his feet is what it acts on, so a button with no ring
  // would have nothing to say. Its label is the *next* order, which is what a
  // player reaches for; `data-order` carries the state for the stylesheet (amber
  // while the line is out, so the way back is the loud one).
  function updateOrderButton() {
    const button = elements.touchOrderElement;
    const line = getFormationOrder();
    // `hidden` is only written when it changes: this runs on every frame.
    if (button.hidden !== !line) button.hidden = !line;
    if (!line) return;
    const marching = line.order === formationOrders.MARCH;
    const locale = getLocale();
    const stamp = `${locale}:${marching}`;
    if (stamp === lastOrderStamp) return;
    lastOrderStamp = stamp;
    const key = marching ? "battle.hold" : "battle.sortie";
    button.textContent = translate(key);
    button.setAttribute("aria-label", translate(`${key}.hint`));
    button.title = translate(`${key}.hint`);
    button.dataset.order = marching ? "reform" : "march";
  }

  function updateHud() {
    const {
      scoreElement, waveElement, goldElement, modeElement, hullLabelElement, hullValueElement,
      hullHealthElement, objectiveCountElement, objectiveProgressElement, objectiveLabelElement,
      extractionGuideElement, extractionArrowElement, extractionDistanceElement, guideLabelElement,
      touchPadElement, touchHintElement,
    } = elements;
    const onFoot = player.mode === "foot";
    const locale = getLocale();
    scoreElement.textContent = String(state.score).padStart(5, "0");
    // The last battle of a run is named rather than numbered. "FINAL" is not a
    // number, so it carries a class the stylesheet sizes down instead of running
    // past the 86px stat box; a numbered stage keeps the type it always had.
    waveElement.textContent = stageLabel(campaign, state);
    waveElement.classList.toggle("is-final", Boolean(state.finalBattle));
    goldElement.textContent = String(getCampaignFunds());
    modeElement.textContent = translate(onFoot ? "battle.foot" : "battle.chariot");
    modeElement.classList.toggle("on-foot", onFoot);
    hullLabelElement.textContent = translate(onFoot ? "battle.footHealth" : "battle.hull");
    if (lastFootMode !== onFoot || lastLocale !== locale) {
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
    // The tutorial names its own two objectives and counts its own bodies, and its
    // guide arrow points at whatever the script is asking for (the tiger, then the
    // drill line) instead of at an extraction point that does not exist yet.
    const tutorial = state.tutorial;
    const bossAlive = state.bossStage && !state.bossDefeated && state.bosses.length > 0;
    // The objective is the player's own, so it carries their name once the
    // prologue has rolled one. `battle.objective` stays behind as the plain
    // label for anything that runs before a run starts, and a boss fight or a
    // retreat is labelled by what it is rather than by whose it is.
    const playerName = extracting || bossAlive ? null : getPlayerName();
    let objectiveLabel = playerName
      ? translate("battle.objectiveNamed", { name: playerName })
      : translate(extracting ? "battle.extractDistance" : bossAlive ? "battle.boss" : "battle.objective");
    let objectiveCount = `${Math.min(state.kills, state.objectiveTarget)} / ${state.objectiveTarget}`;
    let objectiveProgress = Math.min(100, state.kills / state.objectiveTarget * 100);
    let squadHealth = false;

    if (bossAlive) {
      // The bar is the whole squad's health, not one champion's: the last stage
      // wastes no HUD space on eight separate bars, and the sum drops as each
      // body falls.
      const total = state.bosses.reduce((sum, unit) => sum + unit.maxHealth, 0);
      const alive = state.bosses.reduce(
        (sum, unit) => sum + (unit.destroyed ? 0 : Math.max(0, unit.health)), 0,
      );
      objectiveCount = `${Math.ceil(alive)} / ${total}`;
      objectiveProgress = total > 0 ? Math.max(0, alive / total * 100) : 0;
      squadHealth = true;
      if (state.bosses.length > 1) {
        const first = state.bosses.find((unit) => !unit.destroyed) ?? state.bosses[0];
        objectiveLabel = translate("battle.bossSquad", {
          count: state.bosses.length, name: translate(first.nameKey),
        });
      }
    }

    if (tutorial?.hud) {
      objectiveLabel = translate(tutorial.hud.labelKey);
      objectiveCount = `${tutorial.hud.count} / ${tutorial.hud.total}`;
      objectiveProgress = tutorial.hud.total > 0
        ? Math.min(100, tutorial.hud.count / tutorial.hud.total * 100)
        : 0;
    }

    const guideTarget = extracting ? state.extractionPoint : tutorial?.objective ?? null;
    if (guideTarget) {
      const dx = guideTarget.x - player.x;
      const dy = guideTarget.y - player.y;
      const distance = Math.hypot(dx, dy);
      // Only the retreat borrows the count tile for a distance: the tutorial has
      // its own count and the arrow alone is enough to steer by.
      if (extracting) {
        objectiveCount = translate("battle.steps", { distance: Math.ceil(distance) });
        objectiveProgress = Math.max(0, Math.min(100, 100 - distance / 10));
      }
      extractionDistanceElement.textContent = translate("battle.distance", { distance: Math.ceil(distance) });
      extractionArrowElement.style.setProperty("--guide-angle", `${Math.atan2(dy, dx) + Math.PI / 2}rad`);
    }

    guideLabelElement.textContent = translate(extracting ? "battle.extractGuide" : "tutorial.guide");
    objectiveLabelElement.textContent = objectiveLabel;
    objectiveCountElement.textContent = objectiveCount;
    objectiveProgressElement.style.width = `${objectiveProgress}%`;
    objectiveProgressElement.classList.toggle("boss-health", squadHealth);
    extractionGuideElement.hidden = !guideTarget;
    updateCharge();
    updateOrderButton();
  }

  return updateHud;
}
