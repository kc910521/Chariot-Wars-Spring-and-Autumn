import { calculateCrewSlots, equipment, horses, personnel } from "../data/equipment.js";
import { translate } from "../i18n/index.js";
import { renderShop } from "../ui/shop.js";

export function createEquipmentShop({ campaign, container, statsContainer, goldElement, messageElement }) {
  let selectedCategory = "equipment";

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
      totalGold: campaign.totalGold,
      equipmentLevels: campaign.equipment,
      horseCount: campaign.horseCount,
      roster: campaign.roster,
      selectedCategory,
      onSelectCategory: (category) => { selectedCategory = category; },
      onBuy: purchaseItem,
    });
  }

  return { purchaseItem, render };
}
