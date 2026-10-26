import { translate } from "../i18n/index.js";
import { VICTORY_LOCK_MS } from "../game/victory-lock.js";

// String helpers shared by the HUD, the shop header and the screens. They are
// pure (a translation function goes in, a string comes out) so the tests can read
// them without a DOM.

// Every battle of a run is numbered except the last one, which is the whole point
// of the run and is named instead.
export function stageLabel(campaign, state, t = translate) {
  if (state && state.finalBattle) return t("battle.finalStage");
  return String(campaign.stage).padStart(2, "0");
}

// How long the campaign still has to rest. Hours while the wait is long, seconds
// once it is short enough to watch — which is the whole point of the one-minute
// stand-in the build currently ships with.
export function countdownLabel(remainingMs, t = translate) {
  const totalSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
  const totalMinutes = Math.ceil(totalSeconds / 60);
  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes === 0
      ? t("menu.timeHoursOnly", { hours })
      : t("menu.timeHours", { hours, minutes });
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return t("menu.timeSecondsOnly", { seconds });
  if (seconds === 0) return t("menu.timeMinutes", { minutes });
  return t("menu.timeSeconds", { minutes, seconds });
}

// The full length of the rest, for the line on the victory card that announces
// the rule before the player runs into it.
export function lockWindowLabel(t = translate) {
  return countdownLabel(VICTORY_LOCK_MS, t);
}
