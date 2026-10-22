import { calculateChariotStats, calculateCrewSlots, equipment, horses, personnel } from "../data/equipment.js";
import { translate } from "../i18n/index.js";

const statTranslationKeys = {
  firepower: "shop.stat.firepower",
  protection: "shop.stat.protection",
  mobility: "shop.stat.mobility",
  stability: "shop.stat.stability",
  capacity: "shop.stat.capacity",
};
const statKeys = Object.keys(statTranslationKeys);
const svgNamespace = "http://www.w3.org/2000/svg";

function describeChanges(level) {
  const changes = [];
  for (const [stat, value] of Object.entries(level.bonuses)) {
    changes.push(translate("shop.preview.bonus", { name: translate(statTranslationKeys[stat]), value }));
  }
  for (const [stat, value] of Object.entries(level.penalties ?? {})) {
    changes.push(translate("shop.preview.penalty", { name: translate(statTranslationKeys[stat]), value }));
  }
  if (level.collisionDamage) changes.push(translate("shop.preview.collision", { value: level.collisionDamage }));
  if (level.additionalArrows) changes.push(translate("shop.preview.arrows", { value: level.additionalArrows }));
  return changes.join(" · ");
}

function createCard(iconText, titleText, detailText, effectText) {
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
  const description = document.createElement("p");
  description.textContent = detailText;
  const effect = document.createElement("span");
  effect.className = "shop-item-effect";
  effect.textContent = effectText;
  details.append(title, description, effect);
  card.append(icon, details);
  return { card, details };
}

function createRadarChart(container) {
  const svg = document.createElementNS(svgNamespace, "svg");
  svg.classList.add("shop-radar");
  svg.setAttribute("viewBox", "0 0 360 330");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", translate("shop.stats.chartLabel"));

  const center = { x: 180, y: 158 };
  const radius = 86;
  const angles = statKeys.map((_, index) => (-90 + index * 72) * Math.PI / 180);
  const point = (index, value) => ({
    x: center.x + Math.cos(angles[index]) * radius * value / 10,
    y: center.y + Math.sin(angles[index]) * radius * value / 10,
  });
  const points = (values) => values.map((value, index) => {
    const position = point(index, value);
    return `${position.x},${position.y}`;
  }).join(" ");

  for (let level = 2; level <= 10; level += 2) {
    const ring = document.createElementNS(svgNamespace, "polygon");
    ring.setAttribute("points", points(statKeys.map(() => level)));
    ring.classList.add("radar-grid");
    svg.append(ring);
  }

  angles.forEach((angle) => {
    const axis = document.createElementNS(svgNamespace, "line");
    axis.setAttribute("x1", String(center.x));
    axis.setAttribute("y1", String(center.y));
    axis.setAttribute("x2", String(center.x + Math.cos(angle) * radius));
    axis.setAttribute("y2", String(center.y + Math.sin(angle) * radius));
    axis.classList.add("radar-axis");
    svg.append(axis);
  });

  const currentShape = document.createElementNS(svgNamespace, "polygon");
  currentShape.classList.add("radar-current");
  const previewShape = document.createElementNS(svgNamespace, "polygon");
  previewShape.classList.add("radar-preview");
  svg.append(currentShape, previewShape);

  const labels = statKeys.map((key, index) => {
    const labelPosition = point(index, 13.6);
    const label = document.createElementNS(svgNamespace, "text");
    label.classList.add("radar-label");
    label.setAttribute("x", String(labelPosition.x));
    label.setAttribute("y", String(labelPosition.y));
    label.setAttribute("text-anchor", labelPosition.x < center.x - 10 ? "end"
      : labelPosition.x > center.x + 10 ? "start" : "middle");
    const name = document.createElementNS(svgNamespace, "tspan");
    name.textContent = translate(statTranslationKeys[key]);
    name.setAttribute("x", String(labelPosition.x));
    const value = document.createElementNS(svgNamespace, "tspan");
    value.classList.add("radar-value");
    value.setAttribute("x", String(labelPosition.x));
    value.setAttribute("dy", "15");
    label.append(name, value);
    svg.append(label);
    return { label, name, value };
  });

  container.replaceChildren(svg);
  return {
    update(current, preview) {
      currentShape.setAttribute("points", points(statKeys.map((key) => current[key])));
      previewShape.setAttribute("points", points(statKeys.map((key) => preview[key])));
      previewShape.classList.toggle("is-preview", statKeys.some((key) => current[key] !== preview[key]));
      statKeys.forEach((key, index) => {
        const change = preview[key] - current[key];
        labels[index].name.textContent = translate(statTranslationKeys[key]);
        labels[index].value.textContent = change === 0
          ? String(current[key])
          : `${current[key]} ${change > 0 ? "▲" : "▼"} ${preview[key]}`;
        labels[index].label.classList.toggle("is-up", change > 0);
        labels[index].label.classList.toggle("is-down", change < 0);
      });
    },
  };
}

export function renderShop({
  container,
  statsContainer,
  totalGold,
  equipmentLevels,
  horseCount,
  roster,
  selectedCategory,
  onSelectCategory,
  onBuy,
}) {
  container.replaceChildren();
  const radar = createRadarChart(statsContainer);

  function previewStats(levels = equipmentLevels, horsesOwned = horseCount) {
    const current = calculateChariotStats(equipmentLevels, horseCount);
    const preview = calculateChariotStats(levels, horsesOwned);
    radar.update(current, preview);
  }

  previewStats();

  const categories = [
    { id: "equipment", labelKey: "shop.category.equipment" },
    { id: "horse", labelKey: "shop.category.horse" },
    { id: "personnel", labelKey: "shop.category.personnel" },
  ];
  const tabs = document.createElement("div");
  tabs.className = "shop-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", translate("shop.category.label"));
  const panels = new Map();
  for (const category of categories) {
    const selected = category.id === selectedCategory;
    const tab = document.createElement("button");
    tab.className = "shop-tab";
    tab.type = "button";
    tab.id = `shop-tab-${category.id}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", `shop-panel-${category.id}`);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    tab.textContent = translate(category.labelKey);
    const panel = document.createElement("div");
    panel.className = "shop-tab-panel";
    panel.id = `shop-panel-${category.id}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    panel.hidden = !selected;
    panels.set(category.id, panel);
    tab.addEventListener("click", () => {
      for (const candidate of tabs.querySelectorAll('[role="tab"]')) {
        const selected = candidate === tab;
        candidate.setAttribute("aria-selected", String(selected));
        candidate.tabIndex = selected ? 0 : -1;
      }
      for (const [id, candidate] of panels) candidate.hidden = id !== category.id;
      onSelectCategory(category.id);
    });
    tabs.append(tab);
  }
  container.append(tabs, ...panels.values());

  function addButton(card, label, disabled, action, preview) {
    const button = document.createElement("button");
    button.className = "shop-buy";
    button.type = "button";
    button.disabled = disabled;
    button.textContent = label;
    button.addEventListener("click", action);
    if (preview) {
      let hovered = false;
      let focused = false;
      const updatePreview = () => previewStats(...(hovered || focused ? preview : []));
      card.addEventListener("pointerenter", () => {
        hovered = true;
        updatePreview();
      });
      card.addEventListener("pointerleave", () => {
        hovered = false;
        updatePreview();
      });
      button.addEventListener("focus", () => {
        focused = true;
        updatePreview();
      });
      button.addEventListener("blur", () => {
        focused = false;
        updatePreview();
      });
    }
    card.append(button);
  }

  const equipmentPanel = panels.get("equipment");
  for (const item of equipment) {
    const level = equipmentLevels[item.id];
    const next = item.levels[level];
    const { card } = createCard(
      item.icon,
      `${translate(item.nameKey)} · ${translate("shop.level", { level })}`,
      translate(item.descriptionKey),
      next ? describeChanges(next) : translate("shop.maxLevel"),
    );
    const nextLevels = { ...equipmentLevels, [item.id]: level + 1 };
    const cost = next?.price;
    addButton(
      card,
      next ? translate("shop.buy", { price: cost }) : translate("shop.full"),
      !next || totalGold < cost,
      () => onBuy("equipment", item.id),
      next ? [nextLevels, horseCount] : null,
    );
    equipmentPanel.append(card);
  }

  const horsePanel = panels.get("horse");
  const nextHorse = horses.levels[horseCount];
  const horseBonus = nextHorse?.mobilityBonus ?? horses.levels[horseCount - 1].mobilityBonus;
  const horse = createCard(
    "🐎",
    translate("shop.horseCount", { count: horseCount, max: horses.max }),
    translate(horses.descriptionKey),
    nextHorse
      ? translate("shop.mobilityBonus", { value: nextHorse.mobilityBonus - horses.levels[horseCount - 1].mobilityBonus })
      : translate("shop.effect.maxHorseMobility", { value: horseBonus }),
  );
  addButton(
    horse.card,
    nextHorse ? translate("shop.buy", { price: nextHorse.price }) : translate("shop.fullHorses"),
    !nextHorse || totalGold < nextHorse.price,
    () => onBuy("horse"),
    nextHorse ? [equipmentLevels, nextHorse.count] : null,
  );
  horsePanel.append(horse.card);

  const personnelPanel = panels.get("personnel");
  const slots = calculateCrewSlots(equipmentLevels);
  const rosterSummary = document.createElement("p");
  rosterSummary.className = "shop-slot-count";
  const activeRoster = roster.filter((person) => person.alive !== false);
  rosterSummary.textContent = translate("shop.crewSlots", { count: activeRoster.length, slots });
  personnelPanel.append(rosterSummary);

  for (const member of personnel) {
    const count = roster.filter((person) => person.alive !== false && person.role === member.id).length;
    const { card } = createCard(
      member.icon,
      translate("shop.memberCount", { name: translate(member.nameKey), count }),
      translate("shop.memberCanDie", { description: translate(member.descriptionKey) }),
      translate("shop.memberEffect", { price: member.price, damage: member.damage }),
    );
    const full = activeRoster.length >= slots;
    addButton(
      card,
      full ? translate("shop.noSlots") : translate("shop.recruit", { price: member.price }),
      full || totalGold < member.price,
      () => onBuy("personnel", member.id),
    );
    personnelPanel.append(card);
  }
}
