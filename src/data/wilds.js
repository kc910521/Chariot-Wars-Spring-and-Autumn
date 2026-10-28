// Wild animals. They are not soldiers: no rank to hold, no flag to defend, no
// morale to break, and they never spawn from a formation pattern. What they do
// share with the enemy roster is the machinery - `state.enemies` moves them,
// `damageEnemy` kills them, `getCombatTarget` hands them to a brain, and the
// renderer draws them - so a row here uses the same columns as an `enemyStats`
// row and adds only the two that make an animal an animal:
//
//   `species` - bodies of the same species never fight each other. Every other
//               row leaves it undefined, so the campaign's target picker is
//               unchanged (see getCombatTarget in units/enemies.js).
//   `loot`    - what the body leaves behind. "meat" is picked up as a hull heal
//               instead of coin, and it is the one drop that costs no random
//               number, so an animal can never shift a seeded battle's rolls.
//
// `holdsRank: false` keeps them out of the leashed-line rules: they have no
// `formationId`, so `updateFormationAlerts` and `tickFormationAura` skip them,
// and `walkHome` (units/enemies.js) only ever walks one back to the spot it
// spawned on after it has lost sight of the player.
export const wildAnimalStats = {
  tiger: {
    health: 22, radius: 20, speed: 74, damage: 2, range: 46,
    behaviour: "wild", sightRange: 640, score: 100, deathBurst: "#c8703a",
    holdsRank: false, species: "tiger", loot: "meat",
    attackInterval: 1.05, weapon: "claw",
    visual: { kind: "tiger", scale: 1, robe: "#d0873f", overlays: [] },
  },
};
