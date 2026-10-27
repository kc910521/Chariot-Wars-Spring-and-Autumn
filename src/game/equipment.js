import { calculateCrewSlots, equipment, horses, personnel } from "../data/equipment.js";
import { formationConfig } from "../data/formations.js";
import { translate } from "../i18n/index.js";
import { renderShop } from "../ui/shop.js";

export function createEquipmentShop({
  campaign, container, statsContainer, scene,
  rigCaptionElement, campCaptionElement, infoElement, goldElement, messageElement,
}) {
  let selectedCategory = "equipment";
  // The card whose description the info panel keeps after a click. Hovering is
  // transient and never lands here; this is the pick that has to survive the
  // re-render a purchase does.
  let selectedItem = null;

  function purchaseItem(purchaseType, itemId) {
    let price;
    let itemNameKey;

    if (purchaseType === "equipment") {
      const item = equipment.find((entry) => entry.id === itemId);
      if (!item) throw new Error(`Unknown equipment: ${itemId}`);
      const level = campaign.equipment[itemId];
      const next = item.levels[level];
      if (!next) return;
      price = next.price;
      itemNameKey = item.nameKey;
      if (campaign.totalGold < price) {
        messageElement.textContent = translate("shop.error.gold");
        return;
      }
      campaign.totalGold -= price;
      campaign.equipment[itemId] += 1;
    } else if (purchaseType === "horse") {
      const next = horses.levels[campaign.horseCount];
      if (!next) return;
      price = next.price;
      itemNameKey = "shop.horse";
      if (campaign.totalGold < price) {
        messageElement.textContent = translate("shop.error.gold");
        return;
      }
      campaign.totalGold -= price;
      campaign.horseCount = next.count;
    } else if (purchaseType === "personnel") {
      const member = personnel.find((entry) => entry.id === itemId);
      if (!member) throw new Error(`Unknown personnel: ${itemId}`);
      if (campaign.roster.filter((member) => member.alive !== false).length >= calculateCrewSlots(campaign.equipment)) {
        messageElement.textContent = translate("shop.error.slots");
        return;
      }
      price = member.price;
      itemNameKey = member.nameKey;
      if (campaign.totalGold < price) {
        messageElement.textContent = translate("shop.error.gold");
        return;
      }
      campaign.totalGold -= price;
      campaign.roster.push({ id: campaign.nextPersonnelId, role: member.id });
      campaign.nextPersonnelId += 1;
    } else if (purchaseType === "formation") {
      // A hired line is bought for the run, not for the battle: the count lives
      // on the campaign and each stage spawns that many lines at full strength.
      if ((campaign.friendlyFormations ?? 0) >= formationConfig.maxHires) {
        messageElement.textContent = translate("shop.error.formationCap");
        return;
      }
      price = formationConfig.price;
      itemNameKey = formationConfig.nameKey;
      if (campaign.totalGold < price) {
        messageElement.textContent = translate("shop.error.gold");
        return;
      }
      campaign.totalGold -= price;
      campaign.friendlyFormations = (campaign.friendlyFormations ?? 0) + 1;
    } else {
      throw new Error(`Unknown purchase type: ${purchaseType}`);
    }

    goldElement.textContent = String(campaign.totalGold);
    messageElement.textContent = translate("shop.purchaseSuccess", { item: translate(itemNameKey) });
    render();
  }

  function render() {
    renderShop({
      container,
      statsContainer,
      scene,
      rigCaptionElement,
      campCaptionElement,
      infoElement,
      totalGold: campaign.totalGold,
      equipmentLevels: campaign.equipment,
      horseCount: campaign.horseCount,
      roster: campaign.roster,
      friendlyFormations: campaign.friendlyFormations ?? 0,
      selectedCategory,
      selectedItem,
      onSelectCategory: (category) => { selectedCategory = category; },
      onSelectItem: (itemId) => { selectedItem = itemId; },
      onBuy: purchaseItem,
    });
  }

  return { purchaseItem, render };
}
