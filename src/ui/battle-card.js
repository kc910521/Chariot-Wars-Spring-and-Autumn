import { translate } from "../i18n/index.js";
import { lockWindowLabel } from "./labels.js";

// The one card in the game.
//
// Everything that stops the battle is the same object: the pause card, the defeat
// card, the victory card and the two cards of the 猛虎下山 drill. It used to be
// three implementations of one idea - two DOM cards, each with its own ids and its
// own CSS, and a third painted straight onto the canvas by
// src/render/tutorial-overlay.js, which had to re-invent wrapping, vertical fitting
// and a pointer hit test because a canvas has none of those.
//
// What they share is a spec: a locale key per text slot, the params that go with
// it, and the one action the button means. The card is then a dumb painter of
// that spec; who decides which spec is up stays the caller's business - the mode
// table below for the four screens, src/game/tutorial.js for the drill's beats.
export const CARD_ACTIONS = Object.freeze({
  resume: "resume",
  retry: "retry",
  endRun: "endRun",
  tutorial: "tutorial",
  grant: "grant",
});

// Which card a mode shows, or null for a mode that shows the field. Pure: the
// copy is resolved from the locale tables by the painter, so this is testable
// without a DOM and a language switch cannot leave a card in the old language.
export function cardForMode(mode, { campaign, state }) {
  switch (mode) {
    case "paused":
      return {
        eyebrowKey: "battle.pausedEyebrow",
        titleKey: "battle.pausedTitle",
        copyKey: "battle.pausedCopy",
        actionKey: "battle.resume",
        action: CARD_ACTIONS.resume,
      };
    case "over":
      return {
        eyebrowKey: "battle.defeatEyebrow",
        titleKey: "battle.defeatTitle",
        copyKey: "battle.defeatCopy",
        copyParams: { gold: campaign.totalGold, stage: campaign.stage },
        actionKey: "battle.retry",
        action: CARD_ACTIONS.retry,
      };
    case "victory":
      return {
        eyebrowKey: "victory.eyebrow",
        titleKey: "victory.title",
        // The run that was won is the card's lede, not a footnote: it is the last
        // thing the player reads before the lock.
        copyKey: "victory.subtitle",
        copyTone: "lede",
        copyParams: { name: campaign.identity?.fullName ?? "", stage: campaign.stage },
        lines: [
          {
            textKey: "victory.stats",
            params: { score: state.score, gold: campaign.totalGold },
            tone: "stat",
          },
          { textKey: "victory.lockNote", params: { time: lockWindowLabel() }, tone: "note" },
        ],
        actionKey: "victory.return",
        action: CARD_ACTIONS.endRun,
      };
    default:
      return null;
  }
}

// The drill's card, from the beat src/game/tutorial.js is currently on. Its body
// is a list of beats rather than one paragraph, which is exactly what the card's
// `lines` are - and what the canvas version used to wrap by hand.
export function cardForTutorial(overlay) {
  if (!overlay) return null;
  return {
    eyebrowKey: "tutorial.eyebrow",
    titleKey: overlay.titleKey,
    lines: overlay.bodyKeys.map((textKey) => ({ textKey, tone: "body" })),
    actionKey: "tutorial.confirm",
    action: CARD_ACTIONS.tutorial,
    // The drill's beats are the game's long-form copy: they get the wider card.
    width: "wide",
  };
}

// The clan's gift, from the end of the 4th stage (`grantFormation`). It is a card
// rather than a shop row because nothing is being asked of the player: the line is
// already his, the battle underneath is still running, and the one button only
// puts the news away. That is also why it cannot be a mode - the field must not
// lose its frame for a thank-you.
export function cardForGrant(grant) {
  if (!grant) return null;
  return {
    eyebrowKey: "grant.eyebrow",
    titleKey: "grant.title",
    copyKey: "grant.copy",
    copyParams: { clan: grant.clan ?? "" },
    lines: [
      {
        textKey: "grant.line",
        params: { formation: translate(grant.nameKey), count: grant.count },
        tone: "stat",
      },
    ],
    actionKey: "grant.accept",
    action: CARD_ACTIONS.grant,
  };
}

// The painter. `show(null)` is "no card": every caller can hand it the result of
// cardForMode/cardForTutorial unexamined and get the right thing on screen.
export function createBattleCard({ elements }) {
  const {
    card, cardIcon, cardEyebrow, cardTitle, cardCopy, cardLines, cardButton, cardAction,
  } = elements;
  // The spec that is up, kept so a language switch can repaint it. Null whenever
  // the card is hidden - a card that was put away (a pause opened on top of a
  // drill card) has to be painted again from scratch when it comes back.
  let spec = null;

  function paint(next) {
    cardIcon.textContent = next.icon ?? "✦";
    cardEyebrow.hidden = !next.eyebrowKey;
    cardEyebrow.textContent = next.eyebrowKey ? translate(next.eyebrowKey) : "";
    cardTitle.textContent = translate(next.titleKey);
    const copy = next.copyKey ? translate(next.copyKey, next.copyParams) : "";
    cardCopy.hidden = copy === "";
    cardCopy.textContent = copy;
    cardCopy.dataset.tone = next.copyTone ?? "note";
    // The beats are DOM list items: the browser wraps them, so the card never has
    // to measure a string to find out how tall it is.
    const lines = next.lines ?? [];
    cardLines.hidden = lines.length === 0;
    cardLines.replaceChildren(...lines.map((line) => {
      const item = document.createElement("li");
      item.dataset.tone = line.tone ?? "note";
      item.textContent = translate(line.textKey, line.params);
      return item;
    }));
    cardAction.textContent = translate(next.actionKey);
    // What the one button means, for the click handler in src/ui/controls.js.
    cardButton.dataset.action = next.action;
    // The measure the card reads at: one column for a question, the wider one for
    // the drill's paragraphs (styles/game.css).
    card.dataset.width = next.width ?? "narrow";
  }

  function show(next) {
    if (!next) {
      hide();
      return;
    }
    spec = next;
    paint(spec);
    card.classList.remove("hidden");
  }

  function hide() {
    spec = null;
    card.classList.add("hidden");
  }

  // Repaint the card that is up, in whatever language is now current.
  function refresh() {
    if (spec) paint(spec);
  }

  return { show, hide, refresh };
}
