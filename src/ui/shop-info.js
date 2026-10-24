import { translate } from "../i18n/index.js";

// The shop's one description surface. Cards carry a title, an effect line and a
// price only - equipment copy is long enough to double the height of every card
// and to drown the ledger - so the long text lives in a single panel under the
// summary. That panel shows the collision rule while nothing is picked, and the
// item the player points at or picked otherwise. `id === null` means "the rule".

export function collisionRuleInfo() {
  return {
    id: null,
    label: translate("shop.collision.label"),
    text: translate("shop.collision.description"),
  };
}

// `nameKey` is the item's own translation key, so the panel reads
// "弩机：提升弩箭伤害……" in Chinese and "Weapon rack: Improves crossbow..." in
// English without either string being assembled by hand.
export function itemInfo(id, nameKey, text) {
  return { id, label: translate("shop.info.label", { name: translate(nameKey) }), text };
}

export function createInfoPanel(element) {
  if (!element) return { paint() {} };
  // The label and the body are separate nodes so the label can be accented. A
  // harness that models an element without children still gets the whole line
  // through `textContent`, which is exactly what a screen reader reads out.
  const label = element.querySelector?.(".shop-info-label") ?? null;
  const text = element.querySelector?.(".shop-info-text") ?? null;
  function paint(info = null) {
    // Resolved per paint so a locale switch that re-renders the ledger also
    // re-translates the resting text, without the panel caching a language.
    const shown = info ?? collisionRuleInfo();
    element.classList?.toggle("is-item", Boolean(shown.id));
    if (label && text) {
      label.textContent = shown.label;
      text.textContent = shown.text;
    } else {
      element.textContent = `${shown.label}${shown.text}`;
    }
  }
  return { paint };
}
