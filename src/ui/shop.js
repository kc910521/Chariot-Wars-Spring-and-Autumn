import { calculateChariotStats, calculateCrewSlots, equipment, horses, personnel } from "../data/equipment.js";
import { translate } from "../i18n/index.js";
import { createRadarChart } from "./radar.js";
import { createInfoPanel, itemInfo } from "./shop-info.js";
import { readableLabelSize, statLabelKeys } from "./shop-layout.js";

// The purchase categories, in rail order. `glyph` is the tab's mark and `labelKey`
// its text, so a new category is one row here plus a panel that fills itself from
// the same data the existing tabs read.
const categoryRows = [
  { id: "equipment", glyph: "◈", labelKey: "shop.category.equipment" },
  { id: "horse", glyph: "🐎", labelKey: "shop.category.horse" },
  { id: "personnel", glyph: "⚔", labelKey: "shop.category.personnel" },
];

// Below this width the dossier sits above the cards and the radar is drawn
// smaller, so its labels have to be bigger *in chart units* to stay legible.
const narrowScreen = "(max-width: 980px)";

function isNarrowScreen() {
  return Boolean(globalThis.window?.matchMedia?.(narrowScreen).matches);
}

function describeChanges(level) {
  const changes = [];
  for (const [stat, value] of Object.entries(level.bonuses)) {
    changes.push(translate("shop.preview.bonus", { name: translate(statLabelKeys[stat]), value }));
  }
  for (const [stat, value] of Object.entries(level.penalties ?? {})) {
    changes.push(translate("shop.preview.penalty", { name: translate(statLabelKeys[stat]), value }));
  }
  if (level.collisionDamage) changes.push(translate("shop.preview.collision", { value: level.collisionDamage }));
  if (level.additionalArrows) changes.push(translate("shop.preview.arrows", { value: level.additionalArrows }));
  return changes.join(" · ");
}

// A card is a title, what the next level changes and a price. The long
// description lives in the shared info panel (`ui/shop-info.js`): five cards of
// equipment copy in a two-column grid would otherwise fill the panel with text
// before the player has read a single price.
function createCard(iconText, titleText, effectText) {
  const card = document.createElement("article");
  card.className = "shop-item";
  const icon = document.createElement("span");
  icon.className = "shop-item-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = iconText;
  const details = document.createElement("div");
  details.className = "shop-item-details";
  const title = document.createElement("h4");
  title.textContent = titleText;
  const effect = document.createElement("span");
  effect.className = "shop-item-effect";
  effect.textContent = effectText;
  details.append(title, effect);
  card.append(icon, details);
  return { card, details };
}

// The crew a purchase would leave in the chariot: what the rig preview draws on
// the hull and what the camp fire seats around it.
function crewAfterPurchase({ roster, slots, role }) {
  if (!role) return roster;
  const living = roster.filter((member) => member.alive !== false);
  if (living.length >= slots) return roster;
  // The recruit has no id yet - the campaign assigns it on purchase - so the
  // preview shows an anonymous body, which is what a seat is anyway.
  return [...roster, { role, alive: true }];
}

export function renderShop({
  container,
  statsContainer,
  scene,
  rigCaptionElement,
  campCaptionElement,
  infoElement,
  totalGold,
  equipmentLevels,
  horseCount,
  roster,
  selectedCategory,
  selectedItem,
  onSelectCategory,
  onSelectItem,
  onBuy,
}) {
  container.replaceChildren();
  const liveRoster = roster.filter((member) => member.alive !== false);
  const slots = calculateCrewSlots(equipmentLevels);

  // The description panel keeps the item the player clicked - that is the one
  // they just bought - while a hover is only a glance. The pick outlives this
  // render (the caller remembers it), so a purchase can rebuild the whole
  // ledger and still leave the panel explaining what was bought.
  const infoPanel = createInfoPanel(infoElement);
  const infoById = new Map();
  let pinnedId = selectedItem ?? null;
  const restingInfo = () => (pinnedId ? infoById.get(pinnedId) ?? null : null);
  const showInfo = (info = null) => infoPanel.paint(info ?? restingInfo());

  // A disabled button still has to say why it cannot be pressed: a dimmed
  // "购置" reads as a broken button, while "军资不足" reads as the next goal.
  const buyLabel = (price, { maxedKey = null, buyKey = "shop.buy" } = {}) => {
    if (maxedKey) return translate(maxedKey);
    if (totalGold < price) return translate("shop.shortGold", { price });
    return translate(buyKey, { price });
  };

  // The dossier follows the campaign; every hover then re-targets it. `update`
  // clears a stale preview, so a card that lost the pointer mid-click cannot
  // leave the rig showing a team the player never bought.
  scene?.update({ horseCount, crew: roster });
  if (rigCaptionElement) {
    rigCaptionElement.textContent = translate("shop.rig.caption", {
      horses: horseCount,
      crew: liveRoster.length,
      slots,
    });
  }
  if (campCaptionElement) {
    campCaptionElement.textContent = translate("shop.camp.caption", { crew: liveRoster.length });
  }

  const radar = createRadarChart(statsContainer, {
    labelSize: isNarrowScreen() ? readableLabelSize : undefined,
  });

  function previewStats(preview = null) {
    const current = calculateChariotStats(equipmentLevels, horseCount);
    const levels = preview?.levels ?? equipmentLevels;
    const horsesOwned = preview?.horses ?? horseCount;
    radar.update(current, calculateChariotStats(levels, horsesOwned));
    scene?.preview(preview ? { horseCount: horsesOwned, crew: preview.crew ?? roster } : null);
  }

  previewStats();

  const tabs = document.createElement("div");
  tabs.className = "shop-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", translate("shop.category.label"));
  const panels = new Map();
  for (const category of categoryRows) {
    const selected = category.id === selectedCategory;
    const tab = document.createElement("button");
    tab.className = "shop-tab";
    tab.type = "button";
    tab.id = `shop-tab-${category.id}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", `shop-panel-${category.id}`);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    const mark = document.createElement("span");
    mark.className = "shop-tab-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = category.glyph;
    const label = document.createElement("span");
    label.textContent = translate(category.labelKey);
    tab.append(mark, label);
    const panel = document.createElement("div");
    panel.className = "shop-tab-panel";
    panel.id = `shop-panel-${category.id}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    panel.hidden = !selected;
    panels.set(category.id, panel);
    tab.addEventListener("click", () => {
      for (const candidate of tabs.querySelectorAll('[role="tab"]')) {
        const isSelected = candidate === tab;
        candidate.setAttribute("aria-selected", String(isSelected));
        candidate.tabIndex = isSelected ? 0 : -1;
      }
      for (const [id, candidate] of panels) candidate.hidden = id !== category.id;
      // A pick belongs to the card it came from, so switching tabs drops it and
      // the panel goes back to the rule that applies everywhere.
      pinnedId = null;
      onSelectItem?.(null);
      showInfo();
      onSelectCategory(category.id);
    });
    tabs.append(tab);
  }
  container.append(tabs, ...panels.values());

  // Hovering a card is a glance: the rig, the radar and the description panel
  // all follow the pointer and all revert together. Clicking pins the pick, so
  // the panel still explains the item after the purchase re-renders the ledger.
  function addPurchase(card, id, { label, disabled, action, preview }) {
    const button = document.createElement("button");
    button.className = "shop-buy";
    button.type = "button";
    button.disabled = disabled;
    button.textContent = label;
    card.append(button);

    const info = infoById.get(id) ?? null;
    let hovered = false;
    let focused = false;
    const update = (paintPanel = true) => {
      const active = hovered || focused;
      previewStats(active && preview ? preview : null);
      if (paintPanel) showInfo(active ? info : null);
    };
    const pin = () => {
      pinnedId = id;
      onSelectItem?.(id);
      infoPanel.paint(info);
    };
    // A tap is not a hover. On touch `pointerenter` arrives a frame before
    // `pointerup`, and painting the (two-line) description there shrank the panel
    // and pulled the ledger up under the finger, so the tap landed on the card
    // instead of the button. A tap reaches the panel through `pin` instead, which
    // runs from `click`.
    const hovers = (event) => !event?.pointerType || event.pointerType === "mouse";
    card.addEventListener("pointerenter", (event) => {
      if (!hovers(event)) return;
      hovered = true;
      update();
    });
    card.addEventListener("pointerleave", (event) => {
      if (!hovers(event)) return;
      hovered = false;
      update();
    });
    // `focus` was the second way a pointer could repaint the panel before the
    // click, since a tap focuses the button it is about to press. Pointer focus
    // now only previews the rig and the radar, which move nothing; a keyboard
    // focus (`:focus-visible`) still describes the item, because pressing a key
    // does not depend on where the button sat when it was reached. An engine that
    // cannot answer the question keeps the old behaviour.
    const keyboardFocus = (event) => event?.target?.matches?.(":focus-visible") !== false;
    button.addEventListener("focus", (event) => {
      focused = true;
      update(keyboardFocus(event));
    });
    button.addEventListener("blur", () => {
      focused = false;
      update();
    });
    // The pick is recorded before the purchase runs, because the purchase
    // re-renders the ledger and the next panel paints the remembered item.
    button.addEventListener("click", () => {
      pin();
      action();
    });
    card.addEventListener("click", pin);
  }

  const equipmentPanel = panels.get("equipment");
  for (const item of equipment) {
    const level = equipmentLevels[item.id];
    const next = item.levels[level];
    const { card } = createCard(
      item.icon,
      `${translate(item.nameKey)} · ${translate("shop.level", { level })}`,
      next ? describeChanges(next) : translate("shop.maxLevel"),
    );
    infoById.set(item.id, itemInfo(item.id, item.nameKey, translate(item.descriptionKey)));
    const nextLevels = { ...equipmentLevels, [item.id]: level + 1 };
    addPurchase(card, item.id, {
      label: buyLabel(next?.price, { maxedKey: next ? null : "shop.full" }),
      disabled: !next || totalGold < next.price,
      action: () => onBuy("equipment", item.id),
      preview: next ? { levels: nextLevels, horses: horseCount } : null,
    });
    equipmentPanel.append(card);
  }

  const horsePanel = panels.get("horse");
  const nextHorse = horses.levels[horseCount];
  const horseBonus = nextHorse?.mobilityBonus ?? horses.levels[horseCount - 1].mobilityBonus;
  const horse = createCard(
    "🐎",
    translate("shop.horseCount", { count: horseCount, max: horses.max }),
    nextHorse
      ? translate("shop.mobilityBonus", { value: nextHorse.mobilityBonus - horses.levels[horseCount - 1].mobilityBonus })
      : translate("shop.effect.maxHorseMobility", { value: horseBonus }),
  );
  infoById.set("horse", itemInfo("horse", "shop.horse", translate(horses.descriptionKey)));
  addPurchase(horse.card, "horse", {
    label: buyLabel(nextHorse?.price, { maxedKey: nextHorse ? null : "shop.fullHorses" }),
    disabled: !nextHorse || totalGold < nextHorse.price,
    action: () => onBuy("horse"),
    // Hovering the team page grows the rig by one horse, so the purchase is shown
    // as a team before it is bought rather than only as a price.
    preview: nextHorse ? { levels: equipmentLevels, horses: nextHorse.count } : null,
  });
  horsePanel.append(horse.card);

  const personnelPanel = panels.get("personnel");
  const rosterSummary = document.createElement("p");
  rosterSummary.className = "shop-slot-count";
  rosterSummary.textContent = translate("shop.crewSlots", { count: liveRoster.length, slots });
  personnelPanel.append(rosterSummary);

  for (const member of personnel) {
    const count = liveRoster.filter((person) => person.role === member.id).length;
    const { card } = createCard(
      member.icon,
      translate("shop.memberCount", { name: translate(member.nameKey), count }),
      translate("shop.memberEffect", { price: member.price, damage: member.damage }),
    );
    // The "can die in a foot battle" warning travels with the description: it is
    // the one thing about a recruit that cannot be read off the price.
    infoById.set(
      member.id,
      itemInfo(
        member.id,
        member.nameKey,
        translate("shop.memberCanDie", { description: translate(member.descriptionKey) }),
      ),
    );
    const full = liveRoster.length >= slots;
    addPurchase(card, member.id, {
      label: buyLabel(member.price, { maxedKey: full ? "shop.noSlots" : null, buyKey: "shop.recruit" }),
      disabled: full || totalGold < member.price,
      action: () => onBuy("personnel", member.id),
      // A recruit previews as an extra body on the hull and an extra seat at the
      // fire - but only if the chariot box has a slot left for him.
      preview: { levels: equipmentLevels, horses: horseCount, crew: crewAfterPurchase({ roster, slots, role: member.id }) },
    });
    personnelPanel.append(card);
  }

  // Last, because every card has registered its own description by now: paints
  // the picked item or the collision rule the shop opens on.
  showInfo();
}
