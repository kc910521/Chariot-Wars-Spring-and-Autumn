import { translate } from "../i18n/index.js";

// The tutorial's card, drawn on the canvas instead of in the DOM.
//
// It is a card because the beat it introduces is a pause: the field is frozen
// underneath it (see src/game/tutorial.js), so a scrim plus one panel reads as
// "the battle is waiting for you" without a second screen to keep in sync with
// the sixteen the DOM already owns. Everything it needs is in `state.tutorial`
// and in the locale tables - it holds no state and paints nothing else.
//
// The layout function is shared with the hit test, so the button a pointer press
// lands on is exactly the button that was drawn.
const PANEL_MIN_WIDTH = 300;
const PANEL_MAX_WIDTH = 520;
const PADDING = 24;
const TITLE_SIZE = 18;
const BODY_SIZE = 13;
const BODY_LINE = 21;
const CONFIRM_HEIGHT = 42;
const TITLE_FONT = `600 ${TITLE_SIZE}px "Noto Serif SC", "Songti SC", serif`;
const BODY_FONT = `${BODY_SIZE}px "Noto Serif SC", "Songti SC", serif`;
const BUTTON_FONT = `600 14px "Noto Serif SC", "Songti SC", serif`;

// Greedy wrap by character: the copy is Chinese, which has no spaces to break on,
// and a line-count difference is not worth a measuring pass per word.
function wrapText(context, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const character of text) {
    const candidate = line + character;
    if (line !== "" && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = character;
    } else {
      line = candidate;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

export function createTutorialOverlay({ context, view, state }) {
  function layout(overlay) {
    const width = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, view.width - 48));
    context.font = BODY_FONT;
    const bodyLines = overlay.bodyKeys.flatMap((key) => wrapText(context, translate(key), width - PADDING * 2));
    const height = PADDING * 2 + TITLE_SIZE + 14 + bodyLines.length * BODY_LINE + 20 + CONFIRM_HEIGHT;
    const x = (view.width - width) / 2;
    // Centred when it fits, pinned inside the view when it does not. Three tactics
    // beats wrap to more lines than the two brief beats, and the button is the only
    // way out of the pause: a card centred taller than the view would put the
    // confirm button off the bottom edge, leaving the player stuck on a frozen
    // field with nothing to tap.
    const margin = 18;
    const y = Math.min(
      Math.max((view.height - height) / 2, margin),
      Math.max(view.height - height - margin, margin),
    );
    return {
      x,
      y,
      width,
      height,
      title: translate(overlay.titleKey),
      bodyLines,
      confirm: {
        x: x + PADDING,
        y: y + height - PADDING - CONFIRM_HEIGHT,
        width: width - PADDING * 2,
        height: CONFIRM_HEIGHT,
      },
    };
  }

  function draw() {
    const overlay = state.tutorial?.overlay;
    if (!overlay) return;
    const panel = layout(overlay);

    context.save();
    // The scrim is what turns the canvas behind it into a backdrop, and it is why
    // the field has to be genuinely paused rather than merely covered.
    context.fillStyle = "rgba(18, 14, 10, 0.62)";
    context.fillRect(0, 0, view.width, view.height);

    context.fillStyle = "rgba(244, 232, 208, 0.97)";
    context.fillRect(panel.x, panel.y, panel.width, panel.height);
    context.strokeStyle = "rgba(122, 92, 54, 0.75)";
    context.lineWidth = 2;
    context.strokeRect(panel.x + 1, panel.y + 1, panel.width - 2, panel.height - 2);
    // The hairline rule the DOM cards carry, so the two kinds of card read as one
    // family.
    context.strokeStyle = "rgba(160, 120, 70, 0.35)";
    context.lineWidth = 1;
    context.strokeRect(panel.x + 8, panel.y + 8, panel.width - 16, panel.height - 16);

    context.textAlign = "left";
    context.fillStyle = "#4a2f1c";
    context.font = TITLE_FONT;
    context.fillText(panel.title, panel.x + PADDING, panel.y + PADDING + TITLE_SIZE);

    context.fillStyle = "#54402c";
    context.font = BODY_FONT;
    for (const [index, line] of panel.bodyLines.entries()) {
      context.fillText(line, panel.x + PADDING, panel.y + PADDING + TITLE_SIZE + 14 + BODY_LINE * (index + 1) - 6);
    }

    const { confirm } = panel;
    context.fillStyle = "#a6412f";
    context.fillRect(confirm.x, confirm.y, confirm.width, confirm.height);
    context.fillStyle = "#f6ead2";
    context.font = BUTTON_FONT;
    context.textAlign = "center";
    context.fillText(
      translate("tutorial.confirm"),
      confirm.x + confirm.width / 2,
      confirm.y + confirm.height / 2 + 5,
    );
    context.restore();
  }

  // Canvas pixels are view units, not device pixels: the transform set up in
  // game.js maps one to the other, and a pointer event arrives in CSS pixels.
  function toView(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: (event.clientX - rect.left) * view.width / rect.width,
      y: (event.clientY - rect.top) * view.height / rect.height,
    };
  }

  function hitConfirm(x, y) {
    const overlay = state.tutorial?.overlay;
    if (!overlay) return false;
    const { confirm } = layout(overlay);
    // A few pixels of slack: the button is the only thing a tap can mean while a
    // card is up, so missing it by two pixels should not swallow the tap.
    const slack = 6;
    return x >= confirm.x - slack && x <= confirm.x + confirm.width + slack
      && y >= confirm.y - slack && y <= confirm.y + confirm.height + slack;
  }

  // The current card's geometry, or null. The pointer handler hit-tests through
  // hitConfirm; this is the readable form of the same numbers, for a harness that
  // has to click the thing that was drawn.
  function currentLayout() {
    const overlay = state.tutorial?.overlay;
    return overlay ? layout(overlay) : null;
  }

  return { draw, toView, hitConfirm, layout: currentLayout };
}
