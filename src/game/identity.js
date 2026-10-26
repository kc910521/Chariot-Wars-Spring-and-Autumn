import { clanNames, givenNames } from "../data/names.js";

// Weighted pick over rows that carry a `weight`. One draw, then walk the table
// subtracting each weight: the row whose bucket the roll lands in wins, so the
// cost is one pass and no allocation. A generator that returns exactly 1 (or a
// float that rounds up to the total) falls back to the last row rather than
// returning nothing.
export function pickWeighted(rows, random) {
  let total = 0;
  for (const row of rows) total += row.weight;
  let roll = random() * total;
  for (const row of rows) {
    roll -= row.weight;
    if (roll < 0) return row;
  }
  return rows[rows.length - 1];
}

// One draw per table, at the moment a new run starts and before the first
// battle re-seeds `campaign.random` - so `?seed=42` names the same player on
// every reload, and the battle's own seed stream is left untouched.
export function createPlayerIdentity(random) {
  const clan = pickWeighted(clanNames, random);
  const given = pickWeighted(givenNames, random);
  return {
    clan: clan.name,
    given: given.name,
    fullName: `${clan.name}${given.name}`,
    clanReasonKey: clan.namingStory.reason,
    givenReasonKey: given.namingStory.reason,
  };
}
