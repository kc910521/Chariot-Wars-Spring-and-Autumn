import clanTable from "../assets/clan/clan_names.json" with { type: "json" };
import givenTable from "../assets/clan/given_names.json" with { type: "json" };

// The two halves of a Chinese name: the clan name (氏) comes first, the given
// name (名) after it - 趙 + 黑 reads 趙黑, with nothing between them. `weight` is
// a relative probability, so 趙 (10) comes up five times as often as 南疆 (2),
// and 黑 (3) three times as often as 丑 (1).
//
// A row is rolled once per campaign and then read by the prologue and the HUD.
// Nothing should ever write back into these tables: freeze once, recursively, so
// a stray write throws instead of quietly renaming the player mid-run.
function deepFreeze(value) {
  for (const key of Object.keys(value)) {
    if (value[key] && typeof value[key] === "object") deepFreeze(value[key]);
  }
  return Object.freeze(value);
}

export const clanNames = deepFreeze(clanTable);
export const givenNames = deepFreeze(givenTable.givenNames);
