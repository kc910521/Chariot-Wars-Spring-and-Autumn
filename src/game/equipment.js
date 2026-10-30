import { calculateCrewSlots, equipment, horses, personnel } from "../data/equipment.js";
import { hireCount, nextTierFor } from "../data/formations.js";
import { translate } from "../i18n/index.js";

// The clan's gift (see `grantFormation`): the 4th stage's champion leaves a line
// of hire behind, and the campaign remembers it so the same gift cannot be handed
// out twice. It is a campaign flag rather than battle state because the reward
// outlives the battle it was earned in.
export function grantFormation(campaign) {
  const owned = hireCount(campaign);
  const tier = nextTierFor(owned);
  // Nothing left to give: the ladder is full, so the card is skipped rather than
  // promising a line that the spawner would clamp away.
  if (!tier) return null;
  campaign.friendlyFormations = owned + 1;
  return { tier, count: owned + 1 };
}

// Purchases are the campaign's, not the page's. Everything here mutates the
// campaign and answers with the line the shop should print; where that line is
// drawn (a DOM node before the port, the canvas notice strip now) is the screen's
// business, which is what keeps this module runnable with no DOM at all.
//
// Every refusal carries its reason instead of only its copy: the shop styles an
// error differently from a success, and a test can assert on `ok` without
// matching translated text.
export function createEquipmentShop({ campaign }) {
  const refusal = (messageKey, params) => ({ ok: false, message: translate(messageKey, params) });
  const purchase = (nameKey) => ({
    ok: true,
    message: translate("shop.purchaseSuccess", { item: translate(nameKey) }),
  });

  function purchaseItem(purchaseType, itemId) {
    if (purchaseType === "equipment") {
      const item = equipment.find((entry) => entry.id === itemId);
      if (!item) throw new Error(`Unknown equipment: ${itemId}`);
      const level = campaign.equipment[itemId];
      const next = item.levels[level];
      // Maxed is a refusal, not a crash: a frame drawn before the last purchase
      // can still deliver its tap, and the answer is the same one the button
      // showed.
      if (!next) return refusal("shop.full");
      const { price } = next;
      if (campaign.totalGold < price) return refusal("shop.error.gold");
      campaign.totalGold -= price;
      campaign.equipment[itemId] += 1;
      return purchase(item.nameKey);
    }
    if (purchaseType === "horse") {
      const next = horses.levels[campaign.horseCount];
      if (!next) return refusal("shop.fullHorses");
      const { price } = next;
      if (campaign.totalGold < price) return refusal("shop.error.gold");
      campaign.totalGold -= price;
      campaign.horseCount = next.count;
      return purchase("shop.horse");
    }
    if (purchaseType === "personnel") {
      const member = personnel.find((entry) => entry.id === itemId);
      if (!member) throw new Error(`Unknown personnel: ${itemId}`);
      const living = campaign.roster.filter((entry) => entry.alive !== false).length;
      if (living >= calculateCrewSlots(campaign.equipment)) return refusal("shop.error.slots");
      const { price } = member;
      if (campaign.totalGold < price) return refusal("shop.error.gold");
      campaign.totalGold -= price;
      campaign.roster.push({ id: campaign.nextPersonnelId, role: member.id });
      campaign.nextPersonnelId += 1;
      return purchase(member.nameKey);
    }
    if (purchaseType === "formation") {
      // A hired line is bought for the run, not for the battle: the count lives
      // on the campaign and each stage spawns that many lines at full strength.
      // The ladder is bought in order, so the price and the roster come from the
      // rung that follows what the player already owns.
      const owned = hireCount(campaign);
      const tier = nextTierFor(owned);
      if (!tier) return refusal("shop.error.formationCap");
      const { price } = tier;
      if (campaign.totalGold < price) return refusal("shop.error.gold");
      campaign.totalGold -= price;
      campaign.friendlyFormations = owned + 1;
      return purchase(tier.nameKey);
    }
    throw new Error(`Unknown purchase type: ${purchaseType}`);
  }

  return { purchaseItem };
}
