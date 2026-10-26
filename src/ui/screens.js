import { translate } from "../i18n/index.js";
import { countdownLabel, lockWindowLabel } from "./labels.js";

export function createScreens({
  state, campaign, draw, onModeChange, victoryLock = null, elements,
}) {
  const {
    menuScreen, prologueScreen, battleScreen, shopScreen, victoryScreen, overlay, startLabel,
    startButton, menuStartButton, menuLockElement, menuLockTitleElement, menuLockDetailElement,
    overlayEyebrow, overlayTitle, overlayCopy, overlayButton,
    victoryEyebrow, victoryTitle, victorySubtitle, victoryStats, victoryNote, victoryReturnButton,
  } = elements;

  // The resting card's headline, so the frame loop can repaint a countdown that
  // only changes once a second without writing the DOM sixty times a second.
  let lockHeadline = null;
  // Whether the resting card is up. Remembered so an unlocked menu is not
  // re-toggled on every frame, and reset whenever the menu re-reads storage.
  let lockVisible = null;

  // The menu's 出征 button becomes the resting card while the lock is live: it
  // says how long the wait is and what the last run was worth. It is rewritten
  // from the frame loop (`paint()` below) because the countdown ticks; the card
  // itself registers no click handler, there is nothing here to press.
  function paintLock() {
    if (!victoryLock) return;
    const remaining = victoryLock.remainingMs();
    const locked = remaining > 0;
    if (lockVisible !== locked) {
      lockVisible = locked;
      menuLockElement.hidden = !locked;
      menuStartButton.hidden = locked;
    }
    if (!locked) {
      lockHeadline = null;
      return;
    }
    const headline = translate("menu.locked", { time: countdownLabel(remaining) });
    if (headline === lockHeadline) return;
    lockHeadline = headline;
    menuLockTitleElement.textContent = headline;
    const last = victoryLock.summary();
    menuLockDetailElement.textContent = last
      ? translate("menu.lockedLast", {
        name: last.name || "—", stage: last.stage, score: last.score,
      })
      : "";
  }

  // Called by the frame loop: the DOM build has no per-frame canvas redraw of its
  // own to lean on, so the one live number on a card is repainted here, and only
  // while the menu that shows it is up.
  function paint() {
    if (state.mode === "menu") paintLock();
  }

  function setMode(mode) {
    state.mode = mode;
    const running = mode === "running";
    // Only the battle states own the battlefield and the `battle-focus` chrome;
    // the menu, the story card, the shop and the victory card sit outside. The
    // overlay card is narrower still: it is the pause/defeat dialog, so a live
    // battle must not show it - it stays on top of the field but hidden. The
    // victory card is its own overlay: the field keeps its last frame underneath
    // while the run is being reported.
    const inBattle = running || mode === "paused" || mode === "over" || mode === "victory";
    const showOverlayCard = mode === "paused" || mode === "over";
    document.body.classList.toggle("battle-focus", inBattle);
    menuScreen.hidden = mode !== "menu";
    prologueScreen.hidden = mode !== "prologue";
    shopScreen.hidden = mode !== "shop";
    battleScreen.hidden = !inBattle;
    overlay.classList.toggle("hidden", !showOverlayCard);
    victoryScreen.classList.toggle("hidden", mode !== "victory");
    startLabel.textContent = translate(running ? "battle.pause" : mode === "paused" ? "battle.resumeLabel" : "battle.startLabel");
    startButton.setAttribute("aria-label", translate(mode === "paused" ? "battle.resumeLabel" : "battle.pauseLabel"));
    startButton.hidden = mode === "over" || mode === "victory";

    if (mode === "menu") {
      // Opening the menu is the one moment the lock is re-read from storage: the
      // record can have been written by an earlier visit, and the countdown on
      // the card is then worked out from the timestamp, not polled.
      victoryLock?.refresh();
      lockHeadline = null;
      paintLock();
    } else if (mode === "paused") {
      overlayEyebrow.textContent = translate("battle.pausedEyebrow");
      overlayTitle.textContent = translate("battle.pausedTitle");
      overlayCopy.textContent = translate("battle.pausedCopy");
      overlayButton.firstElementChild.textContent = translate("battle.resume");
    } else if (mode === "over") {
      overlayEyebrow.textContent = translate("battle.defeatEyebrow");
      overlayTitle.textContent = translate("battle.defeatTitle");
      overlayCopy.textContent = translate("battle.defeatCopy", { gold: campaign.totalGold, stage: campaign.stage });
      overlayButton.firstElementChild.textContent = translate("battle.retry");
    } else if (mode === "victory") {
      // The one card in the game that is not a gate: the last stage is won, the
      // run is over, and the campaign is about to rest. It reports the run (who,
      // which stage, what it was worth) and states the rule it is about to
      // enforce, so the locked menu that follows is a consequence the player has
      // already read.
      victoryEyebrow.textContent = translate("victory.eyebrow");
      victoryTitle.textContent = translate("victory.title");
      victorySubtitle.textContent = translate("victory.subtitle", {
        name: campaign.identity?.fullName ?? "", stage: campaign.stage,
      });
      victoryStats.textContent = translate("victory.stats", { score: state.score, gold: campaign.totalGold });
      victoryNote.textContent = translate("victory.lockNote", { time: lockWindowLabel() });
      victoryReturnButton.firstElementChild.textContent = translate("victory.return");
    }

    draw();
    onModeChange?.(mode);
  }

  return { setMode, paint };
}

