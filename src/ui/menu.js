import { translate } from "../i18n/index.js";
import { countdownLabel } from "./labels.js";
import { computeMenuLayout } from "./menu-layout.js";
import { COLORS, SERIF_FAMILY } from "./theme.js";
import { drawButton, fitTextSize, panel, text, wrapText } from "./widgets.js";

// The home page: one card with the seal, the eyebrow, the title, two lines of lede
// and 出征 under them - the mini game's menu (`chariot-wars/src/ui/screens.js`,
// `drawMenu`) ported to this side of the build, because the two are meant to read
// as one game on two devices.
//
// What is deliberately *not* here is everything the DOM menu used to carry and the
// mini game never had: the three feature cards and the keyboard footnote. Parity
// was the point of the port, and a card that had to scroll to make room for them
// would not fit a phone.
//
// While the post-victory rest is running the button is replaced by the resting
// card - for how long, and what the last run was worth - which registers no touch
// target, because there is nothing there to press.
//
// `view` is the page's own logical space (`{ width, height }`, width always 960),
// not the battlefield's: the menu is a page, the battlefield is a camera, and they
// resize independently.
export function createMenu({ view, victoryLock = null, onNotice = () => {} }) {
  // What was last announced through the live region. A canvas is opaque to a
  // screen reader, so the one sentence that changes while the card is up - the
  // countdown - is announced when it changes and not on every frame.
  let announced = null;
  let lastFrame = null;

  // The page's own backdrop, since the menu is a section of its own and not a
  // layer over the field: the ink the stylesheet used to paint, and the warm glow
  // it put behind the card.
  function paintBackdrop(context) {
    const { width, height } = view;
    const ink = context.createLinearGradient(0, 0, width * 0.72, height);
    ink.addColorStop(0, "#1d1712");
    ink.addColorStop(0.62, "#12100c");
    ink.addColorStop(1, "#191410");
    context.fillStyle = ink;
    context.fillRect(0, 0, width, height);
    const glow = context.createRadialGradient(
      width * 0.76, height * 0.5, 0,
      width * 0.76, height * 0.5, Math.max(width, height) * 0.46,
    );
    glow.addColorStop(0, "rgba(168, 68, 50, 0.14)");
    glow.addColorStop(1, "rgba(168, 68, 50, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);
    // The hairline the section had where it met the one below it.
    context.fillStyle = COLORS.line;
    context.fillRect(0, height - 1, width, 1);
  }

  // The seal is `menu.seal`, and in English that string is two lines
  // ("Chariot\nWars") because the DOM drew it vertically in a bordered square. A
  // canvas has no writing mode, so the lines are stacked and the block is centred
  // on the anchor the one-line version used.
  function drawSeal(context, seal) {
    const lines = String(translate("menu.seal")).split("\n");
    const top = seal.y - (lines.length - 1) * seal.lineHeight / 2;
    lines.forEach((line, index) => {
      text(context, line, seal.x, top + index * seal.lineHeight, {
        size: seal.size, color: COLORS.gold, align: "center", family: SERIF_FAMILY,
      });
    });
  }

  function drawLede(context, lede) {
    // Wrapped here rather than left to `maxWidth`: a canvas would paint a third
    // line outside the card instead of clipping it.
    const lines = wrapText(context, translate("menu.lede"), lede.maxWidth)
      .slice(0, lede.maxLines);
    lines.forEach((line, index) => {
      text(context, line, lede.x, lede.y + index * lede.lineHeight, {
        size: lede.size, color: COLORS.muted, align: "center", family: SERIF_FAMILY,
      });
    });
    return lines;
  }

  // Where 出征 would be: the campaign is resting, so the card says for how long
  // and what the last run was. It covers two lines instead of one button.
  function drawLockedCard(context, layout, remaining) {
    const rect = layout.lock;
    const headline = translate("menu.locked", { time: countdownLabel(remaining) });
    const last = victoryLock?.summary() ?? null;
    const detail = last
      ? translate("menu.lockedLast", {
        name: last.name || "—", stage: last.stage, score: last.score,
      })
      : "";
    panel(context, rect.x, rect.y, rect.width, rect.height, {
      fill: "rgba(58, 49, 38, 0.7)", stroke: COLORS.line, radius: 8,
    });
    text(context, headline, rect.x + rect.width / 2, rect.y + layout.lockHeadline.offsetY, {
      size: fitTextSize(context, headline, rect.width - layout.lockHeadline.inset * 2, {
        size: layout.lockHeadline.size,
        min: layout.lockHeadline.min,
        weight: "bold",
        family: SERIF_FAMILY,
      }),
      weight: "bold", color: COLORS.gold, align: "center",
    });
    if (detail) {
      text(context, detail, rect.x + rect.width / 2, rect.y + layout.lockDetail.offsetY, {
        size: fitTextSize(context, detail, rect.width - layout.lockDetail.inset * 2, {
          size: layout.lockDetail.size, min: layout.lockDetail.min,
        }),
        color: COLORS.muted, align: "center",
      });
    }
    return { headline, detail };
  }

  function draw(context, input, actions) {
    const layout = computeMenuLayout(view);
    paintBackdrop(context);

    const card = layout.panel;
    panel(context, card.x, card.y, card.width, card.height, {
      fill: "rgba(36, 29, 22, 0.97)", stroke: COLORS.edge,
    });

    text(context, translate("menu.eyebrow"), layout.eyebrow.x, layout.eyebrow.y, {
      size: layout.eyebrow.size, color: COLORS.muted, align: "center",
    });
    // A translated title is two glyphs in one language and four words in the
    // other, so it condenses to fit the card rather than paint past its edge. On a
    // 960-wide page the fitted size is the mini game's 38 anyway.
    const title = translate("menu.title");
    text(context, title, layout.title.x, layout.title.y, {
      size: fitTextSize(context, title, layout.title.maxWidth, {
        size: layout.title.size, min: layout.title.min, weight: "bold", family: SERIF_FAMILY,
      }),
      weight: "bold", color: COLORS.text, align: "center", family: SERIF_FAMILY,
    });
    drawSeal(context, layout.seal);
    const lede = drawLede(context, layout.lede);

    const remaining = victoryLock ? victoryLock.remainingMs() : 0;
    const locked = remaining > 0;
    let headline = null;
    let detail = null;
    if (locked) {
      ({ headline, detail } = drawLockedCard(context, layout, remaining));
      // The countdown is the only thing on this page that changes while nobody is
      // touching it; announcing it once per change keeps it audible without
      // reading the canvas every frame.
      if (headline !== announced) {
        announced = headline;
        onNotice(detail ? `${headline}. ${detail}` : headline);
      }
    } else {
      if (announced !== null) {
        announced = null;
        onNotice("");
      }
      drawButton(context, layout.start, translate("menu.start"), {
        primary: true, size: layout.startSize,
      });
      // The only target on the page, and it is absent while the campaign rests.
      input.addTarget(layout.start, () => actions.startRun(), { key: "start" });
    }

    lastFrame = {
      locked,
      startRect: layout.start,
      lockRect: layout.lock,
      panel: layout.panel,
      title,
      lede,
      headline,
      detail,
      view: { width: view.width, height: view.height },
    };
  }

  return {
    draw,
    // Re-opening the menu: the announcement bookkeeping starts over, so a card that
    // is still resting announces its countdown again instead of staying mute.
    reset() {
      announced = null;
      lastFrame = null;
    },
    // Diagnostics for the browser checks and for `__h5game.menuPage.lastFrame()`
    // in the developer console: the last painted frame, rects included.
    lastFrame: () => lastFrame,
  };
}


