import {
  calculateChariotStats, calculateCrewSlots, equipment, horses, personnel,
} from "../data/equipment.js";
import { formationConfig } from "../data/formations.js";
import { translate } from "../i18n/index.js";
import { drawDossier } from "./shop-dossier.js";
import {
  buyRect, computeShopLayout, radarGeometry, resolveBuy, rowRect, rowsPerPageFor,
} from "./shop-layout.js";
import { COLORS, SERIF_FAMILY, font } from "./theme.js";
import { drawButton, panel, text, wrapText } from "./widgets.js";

// Canvas shop: a dossier on the left - the five stats, the team, and on the crew
// tab the night camp - and the ledger on the right, both drawn from the same
// layout maths the pointer targets use.
//
// Two interactions are worth spelling out because they are what a touch screen
// needs and a mouse does not:
//
//  * **Press previews.** Touching a row paints that purchase on the radar and the
//    team without spending anything, so the player sees the effect before
//    committing. Releasing on the same rect buys; sliding off cancels.
//  * **The price is honest.** An unaffordable button says "军资不足 · 400 两"
//    instead of a dim "购置", and a capped one says why it is capped. The screen's
//    pointer router only calls onTap for a target whose rect never moved under the
//    finger, which is the same guarantee the CSS shop bought with a reflow fix.
//
// `view` is the shop's own logical space (`{ width, height }`, width always 960),
// not the battlefield's: the shop is a page, the battlefield is a camera, and
// they resize independently.
export function createShop({
  campaign, equipmentShop, view, now = () => 0, onNotice = () => {},
}) {
  let category = "equipment";
  let page = 0;
  let notice = "";
  let noticeTone = "info";
  // `pressedId` is a glance (it follows the finger); `pinnedId` is the item the
  // player last tapped or bought, so the panel keeps explaining it afterwards.
  let pressedId = null;
  let pinnedId = null;
  let lastFrame = null;

  function livingRoster() {
    return campaign.roster.filter((member) => member.alive !== false);
  }

  // Every notice goes through here: the page prints it above the footer, and the
  // page's live region announces the same string once, so a screen reader hears a
  // purchase without the canvas being read sixty times a second.
  function setNotice(message, tone = "info") {
    notice = message;
    noticeTone = tone;
    if (message) onNotice(message, tone);
  }

  function describeChanges(level) {
    const changes = [];
    for (const [stat, value] of Object.entries(level.bonuses)) {
      changes.push(translate("shop.preview.bonus", { name: translate(`shop.stat.${stat}`), value }));
    }
    for (const [stat, value] of Object.entries(level.penalties ?? {})) {
      changes.push(translate("shop.preview.penalty", { name: translate(`shop.stat.${stat}`), value }));
    }
    if (level.collisionDamage) changes.push(translate("shop.preview.collision", { value: level.collisionDamage }));
    if (level.additionalArrows) changes.push(translate("shop.preview.arrows", { value: level.additionalArrows }));
    return changes.join(" · ");
  }

  // The standing rule the panel shows while nothing is picked: the one piece of
  // shop knowledge that is not attached to a single item.
  function collisionInfo() {
    return {
      id: null,
      label: translate("shop.collision.label"),
      text: translate("shop.collision.description"),
    };
  }

  // `nameKey` is the item's own key, so the panel reads "弩机：提升弩箭伤害……"
  // without either string being assembled by hand.
  function itemInfo(id, nameKey, description) {
    return { id, label: translate("shop.info.label", { name: translate(nameKey) }), text: description };
  }

  // The crew a recruit would leave in the chariot. A full chariot previews
  // nothing new, which is the same answer the purchase would give.
  function crewAfterRecruit(role) {
    const living = livingRoster();
    if (living.length >= calculateCrewSlots(campaign.equipment)) return campaign.roster;
    return [...campaign.roster, { role, alive: true }];
  }

  function buildRows() {
    const gold = campaign.totalGold;
    if (category === "equipment") {
      return equipment.map((item) => {
        const level = campaign.equipment[item.id] ?? 0;
        const next = item.levels[level] ?? null;
        const price = next ? next.price : 0;
        return {
          id: item.id,
          title: `${translate(item.nameKey)} · ${translate("shop.levelOf", { level, max: item.levels.length })}`,
          effect: next ? describeChanges(next) : translate("shop.maxLevel"),
          price,
          buy: resolveBuy({ price, gold, maxedKey: next ? null : "shop.full" }),
          info: itemInfo(item.id, item.nameKey, translate(item.descriptionKey)),
          preview: next ? { levels: { ...campaign.equipment, [item.id]: level + 1 }, horses: campaign.horseCount } : null,
          action: () => equipmentShop.purchaseItem("equipment", item.id),
        };
      });
    }
    if (category === "horse") {
      const owned = horses.levels[campaign.horseCount - 1] ?? horses.levels[0];
      const next = horses.levels[campaign.horseCount] ?? null;
      const price = next ? next.price : 0;
      return [{
        id: "horse",
        title: translate("shop.horseCount", { count: campaign.horseCount, max: horses.max }),
        effect: next
          ? translate("shop.mobilityBonus", { value: next.mobilityBonus - owned.mobilityBonus })
          : translate("shop.effect.maxHorseMobility", { value: owned.mobilityBonus }),
        price,
        buy: resolveBuy({ price, gold, maxedKey: next ? null : "shop.fullHorses" }),
        info: itemInfo("horse", "shop.horse", translate(horses.descriptionKey)),
        preview: next ? { levels: campaign.equipment, horses: next.count } : null,
        action: () => equipmentShop.purchaseItem("horse"),
      }];
    }
    const slots = calculateCrewSlots(campaign.equipment);
    const living = livingRoster();
    const full = living.length >= slots;
    const rows = personnel.map((member) => ({
      id: member.id,
      title: translate("shop.memberCount", {
        name: translate(member.nameKey),
        count: living.filter((entry) => entry.role === member.id).length,
      }),
      effect: `${translate("shop.memberEffect", { price: member.price, damage: member.damage })} · ${translate("shop.crewSlots", { count: living.length, slots })}`,
      price: member.price,
      buy: resolveBuy({
        price: member.price, gold, maxedKey: full ? "shop.noSlots" : null, buyKey: "shop.recruit",
      }),
      info: itemInfo(
        member.id,
        member.nameKey,
        translate("shop.memberCanDie", { description: translate(member.descriptionKey) }),
      ),
      // A recruit previews as an extra body on the hull - but only if the
      // chariot box has a slot left for him.
      preview: { levels: campaign.equipment, horses: campaign.horseCount, crew: crewAfterRecruit(member.id) },
      action: () => equipmentShop.purchaseItem("personnel", member.id),
    }));

    // The hired line: a fixed-price formation bought for the run, capped at two.
    // It is not a roster member - it never takes a crew slot and its dead are not
    // listed - so it sits at the bottom of the crew page with its own count.
    const hired = campaign.friendlyFormations ?? 0;
    const formationFull = hired >= formationConfig.maxHires;
    rows.push({
      id: "formation",
      title: translate("shop.formationCount", {
        name: translate(formationConfig.nameKey),
        count: hired,
        max: formationConfig.maxHires,
      }),
      effect: translate("shop.formationEffect", {
        price: formationConfig.price,
        units: formationConfig.slots.length,
        heal: formationConfig.aura.heal,
        interval: formationConfig.aura.interval,
      }),
      price: formationConfig.price,
      buy: resolveBuy({
        price: formationConfig.price,
        gold,
        maxedKey: formationFull ? "shop.formationCap" : null,
        buyKey: "shop.hireFormation",
      }),
      info: itemInfo("formation", formationConfig.nameKey, translate("shop.formationDescription")),
      // Pressing grows the camp by one tent; the battlefield is not shown in the
      // shop, so the fire is where a hire has to be legible before it is paid for.
      preview: {
        levels: campaign.equipment,
        horses: campaign.horseCount,
        campTents: Math.min(formationConfig.maxHires, hired + (formationFull ? 0 : 1)),
      },
      action: () => equipmentShop.purchaseItem("formation"),
    });
    return rows;
  }

  function drawBackdrop(context, layout) {
    context.fillStyle = "rgba(14, 11, 8, 0.78)";
    context.fillRect(0, 0, view.width, view.height);
    panel(context, layout.panel.x, layout.panel.y, layout.panel.width, layout.panel.height, {
      fill: "rgba(30, 24, 18, 0.97)", stroke: COLORS.edge, radius: 12,
    });
  }

  function drawHeader(context, layout) {
    const { header } = layout;
    text(context, translate("shop.title"), header.x, header.y + 10, {
      size: 21, weight: "bold", family: SERIF_FAMILY,
    });
    text(context, translate("shop.eyebrow"), header.x, header.y + 31, { size: 10.5, color: COLORS.muted });

    const right = header.x + header.width;
    text(context, translate("shop.treasury"), right, header.y + 1, {
      size: 10.5, color: COLORS.muted, align: "right",
    });
    text(context, `${campaign.totalGold} ${translate("shop.currency")}`, right, header.y + 21, {
      size: 19, weight: "bold", color: COLORS.gold, align: "right",
    });

    const stageRight = right - 132;
    text(context, translate("shop.stage"), stageRight, header.y + 1, {
      size: 10.5, color: COLORS.muted, align: "right",
    });
    text(context, String(campaign.stage).padStart(2, "0"), stageRight, header.y + 21, {
      size: 19, weight: "bold", color: COLORS.text, align: "right",
    });
  }

  function drawTabs(context, input, layout) {
    layout.tabs.forEach((tab) => {
      const active = tab.id === category;
      drawButton(context, tab.rect, translate(`shop.category.${tab.id}`), {
        primary: active, size: 12.5, color: active ? COLORS.text : COLORS.muted,
      });
      input.addTarget(tab.rect, () => {
        if (category === tab.id) return;
        category = tab.id;
        page = 0;
        // A pick belongs to the row it came from, so switching tabs drops both the
        // pinned description and any preview left behind by a cancelled press.
        pinnedId = null;
        pressedId = null;
        setNotice("");
      }, { key: `tab.${tab.id}` });
    });
    // The press-to-preview hint rides the tab row, which is otherwise empty to the
    // right of the three categories.
    const top = layout.tabs[0].rect;
    text(context, translate("shop.items.hint"), layout.right, top.y + top.height / 2, {
      size: 10.5, color: COLORS.muted, align: "right",
    });
  }

  // One description surface for the whole shop: the collision rule at rest, the
  // pressed or pinned item otherwise. The panel's height is reserved by the
  // layout, so switching text never moves a row.
  function drawInfo(context, layout, info) {
    const rect = layout.info;
    panel(context, rect.x, rect.y, rect.width, rect.height, {
      fill: info.id ? "rgba(210, 173, 104, 0.08)" : "rgba(39, 28, 20, 0.5)", stroke: null, radius: 6,
    });
    context.fillStyle = info.id ? "rgba(210, 173, 104, 0.9)" : "rgba(210, 173, 104, 0.58)";
    context.fillRect(rect.x, rect.y + 2, 2, rect.height - 4);
    text(context, info.label, rect.x + 12, rect.y + 13, { size: 10.5, weight: "bold", color: COLORS.gold });
    // `wrapText` measures with the context's current font, so set it first; and
    // the slice keeps a longer translation inside the reserved height instead of
    // painting over the first row.
    context.font = font(10.5);
    const maxLines = Math.max(1, Math.floor((rect.height - 22) / 14));
    const lines = wrapText(context, info.text, rect.width - 26).slice(0, maxLines);
    lines.forEach((line, index) => {
      text(context, line, rect.x + 12, rect.y + 28 + index * 14, {
        size: 10.5, color: info.id ? COLORS.text : COLORS.muted,
      });
    });
  }

  function drawRow(context, input, layout, row, index, state) {
    const rect = rowRect(layout, index);
    const pressed = state.pressed?.id === row.id;
    const pinned = !state.pressed && state.pinned?.id === row.id;
    panel(context, rect.x, rect.y, rect.width, rect.height, {
      fill: pressed ? "rgba(210, 173, 104, 0.14)" : "rgba(48, 40, 30, 0.86)",
      stroke: pressed || pinned ? "rgba(210, 173, 104, 0.62)" : COLORS.line,
      radius: 8,
    });

    const button = buyRect(rect);
    const textWidth = Math.max(60, button.x - rect.x - 16);
    text(context, row.title, rect.x + 16, rect.y + rect.height / 2 - 8, {
      size: 13.5, weight: "bold", maxWidth: textWidth,
    });
    text(context, row.effect, rect.x + 16, rect.y + rect.height / 2 + 9, {
      size: 10.5, color: COLORS.muted, maxWidth: textWidth,
    });

    // Honest label: 购置 / 军资不足 · N 两 / 已达最高等级 / 名额已满. It is drawn
    // from the same `row.buy` the handler reads, so the text can never disagree
    // with what a press will do.
    drawButton(context, button, translate(row.buy.labelKey, row.buy.params), {
      disabled: row.buy.disabled,
      size: 11.5,
      color: row.buy.disabled && row.buy.reason === "gold" ? COLORS.gold : undefined,
    });

    // The whole row previews on press and pins on tap; the button buys. The button
    // registers last, so the touch router prefers it inside its own rect.
    input.addTarget(rect, () => {
      pinnedId = row.id;
      setNotice("");
    }, {
      key: `row.${row.id}`,
      onPress: () => { pressedId = row.id; },
      onRelease: () => { if (pressedId === row.id) pressedId = null; },
    });
    input.addTarget(button, () => {
      pinnedId = row.id;
      if (row.buy.disabled) {
        // Nothing is spent and nothing is attempted: the label already said why,
        // and the notice repeats it in words that survive a glance.
        setNotice(
          translate(row.buy.reason === "maxed" ? row.buy.labelKey : "shop.error.gold"),
          "error",
        );
        return;
      }
      // The purchase reports its own outcome, so a notice can never claim success
      // for a buy the purse refused between the frame and the tap.
      const result = row.action();
      setNotice(result?.message ?? "", result?.ok === false ? "error" : "ok");
    }, {
      key: `buy.${row.id}`,
      onPress: () => { pressedId = row.id; },
      onRelease: () => { if (pressedId === row.id) pressedId = null; },
    });
  }

  function drawFooter(context, input, layout, actions, pageCount) {
    const next = layout.footer;
    drawButton(context, next, translate("shop.next"), { primary: true, size: 13 });
    input.addTarget(next, () => {
      pressedId = null;
      pinnedId = null;
      page = 0;
      category = "equipment";
      setNotice("");
      actions.rollForNextBattle();
    }, { key: "next" });

    if (pageCount > 1) {
      const { pager } = layout;
      drawButton(context, pager.prev, "◀", { size: 12, disabled: page === 0 });
      drawButton(context, pager.next, "▶", { size: 12, disabled: page >= pageCount - 1 });
      if (page > 0) input.addTarget(pager.prev, () => { page -= 1; setNotice(""); }, { key: "page.prev" });
      if (page < pageCount - 1) {
        input.addTarget(pager.next, () => { page += 1; setNotice(""); }, { key: "page.next" });
      }
      text(context, `${page + 1} / ${pageCount}`, pager.labelX, pager.labelY, {
        size: 11, color: COLORS.muted, align: "center",
      });
    }
  }

  function drawNotice(context, layout) {
    text(context, notice, layout.notice.x, layout.notice.y + layout.notice.height / 2, {
      size: 11,
      color: noticeTone === "error" ? COLORS.cinnabarBright : COLORS.field,
      maxWidth: layout.notice.width,
    });
  }

  function draw(context, input, actions) {
    const rows = buildRows();
    // Rows per page is a property of the screen, so a resize (rotation) re-slices
    // the catalogue instead of squeezing the buttons.
    const rowsPerPage = rowsPerPageFor(view.height, view.width);
    const pageCount = Math.max(1, Math.ceil(rows.length / rowsPerPage));
    if (page > pageCount - 1) page = pageCount - 1;
    const layout = computeShopLayout({
      // `category` only picks which chart the chart column paints; it cannot move
      // a rect (see computeShopLayout).
      width: view.width, height: view.height, pageCount, rowsPerPage, category,
    });
    const visible = rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

    const current = calculateChariotStats(campaign.equipment, campaign.horseCount);
    const pressed = visible.find((row) => row.id === pressedId) ?? null;
    const pinned = rows.find((row) => row.id === pinnedId) ?? null;
    const preview = pressed?.preview ?? null;
    const previewStats = preview ? calculateChariotStats(preview.levels, preview.horses) : current;
    const shown = pressed ?? pinned;
    const info = shown?.info ?? collisionInfo();
    // The camp may only promise the seat the ledger would actually sell: a full
    // chariot previews nobody, so it passes no role and draws no preview figure.
    // Only a recruit row carries a `crew` (an equipment row previews stats, not
    // headcount), so a missing list means "this purchase adds nobody".
    const rosterAfter = preview?.crew ?? null;
    const recruited = rosterAfter && rosterAfter.length > campaign.roster.length ? pressed.id : null;

    drawBackdrop(context, layout);
    drawHeader(context, layout);
    drawTabs(context, input, layout);
    drawInfo(context, layout, info);
    const dossierFrame = drawDossier(context, layout, {
      current,
      preview: previewStats,
      horseCount: preview?.horses ?? campaign.horseCount,
      crew: preview?.crew ?? campaign.roster,
      // The chassis the campaign owns, or the one a pressed row would leave
      // behind: the dossier draws the same rack, box and blades the next battle
      // will, so a purchase can be seen before the gold is spent.
      levels: preview?.levels ?? campaign.equipment,
      slots: calculateCrewSlots(campaign.equipment),
      // The frame loop owns time; the shop's clock keeps ticking, so the horses
      // trot and the fire flickers without a second time base.
      time: now(),
      previewing: Boolean(pressed && preview),
      previewRole: recruited,
      // How many hired lines are camped here. Only the camp fire reads it; the rig
      // page does not care, and one extra tent on a press is the preview.
      campTents: preview?.campTents ?? campaign.friendlyFormations ?? 0,
    });
    visible.forEach((row, index) => drawRow(context, input, layout, row, index, { pressed, pinned }));
    drawFooter(context, input, layout, actions, pageCount);
    if (notice) drawNotice(context, layout);

    // Everything a test (or a console probe) needs to prove the shop behaves:
    // the rects that were registered this frame, the labels that were painted and
    // what the radar is showing.
    lastFrame = {
      category,
      page,
      pageCount,
      rowsPerPage,
      gold: campaign.totalGold,
      rows: visible.map((row, index) => {
        const rect = rowRect(layout, index);
        return {
          id: row.id,
          rect,
          buyRect: buyRect(rect),
          title: row.title,
          effect: row.effect,
          label: translate(row.buy.labelKey, row.buy.params),
          disabled: row.buy.disabled,
          reason: row.buy.reason,
          price: row.price,
        };
      }),
      tabs: layout.tabs.map((tab) => ({ id: tab.id, rect: tab.rect })),
      pager: layout.pager,
      next: layout.footer,
      noticeRect: layout.notice,
      info: { label: info.label, text: info.text, id: info.id },
      pressedId,
      pinnedId,
      notice,
      noticeTone,
      radar: {
        ...radarGeometry(layout.radar, { narrow: layout.narrow }),
        current: { ...current },
        preview: { ...previewStats },
      },
      dossier: {
        rect: layout.dossier,
        slot: dossierFrame.slot,
        narrow: dossierFrame.narrow,
        // The chart slot whatever it paints, plus the team's rect (and, on a
        // phone, the column it was given).
        radar: layout.chart,
        chart: layout.chart,
        rig: layout.rig,
        rigPanel: layout.rigPanel,
        // What the camp actually painted, so a test can prove a seat appeared
        // without reading pixels.
        camp: dossierFrame.camp,
      },
      view: { width: view.width, height: view.height },
    };
  }

  // Called when the screen opens: the shop always starts on the first tab with
  // nothing pinned, and greets the player with the same line the DOM shop's footer
  // carried instead of an empty notice strip.
  function reset() {
    category = "equipment";
    page = 0;
    pressedId = null;
    pinnedId = null;
    setNotice(translate("shop.message"), "info");
  }

  return {
    draw,
    reset,
    // Diagnostics for the browser checks and for `__h5game.shop.lastFrame()` in
    // the developer console: the last painted frame, rects included.
    lastFrame: () => lastFrame,
  };
}
