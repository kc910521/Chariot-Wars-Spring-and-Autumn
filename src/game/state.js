import { emptyEquipment } from "../data/equipment.js";
import { createRandomSeed, createSeededRandom } from "../utils/random.js";
import { CHARIOT_CONTROL_CONFIG } from "./player.js";

// `seedSource` is injected by the composition root so the engine never reads the
// launch query itself (that lives in src/platform/): `?seed=42` then pins every
// battle of the session, which makes a run easy to reproduce.
export function createGameState({ seedSource = () => null } = {}) {
  const world = { width: 2800, height: 1800 };
  const view = { width: 960, height: 592 };
  const camera = { x: 0, y: 0 };
  const player = {
    x: world.width / 2,
    y: world.height / 2,
    radius: 17,
    angle: -Math.PI / 2,
    speed: 0,
    maxSpeed: CHARIOT_CONTROL_CONFIG.maxSpeed,
    acceleration: CHARIOT_CONTROL_CONFIG.acceleration,
    deceleration: CHARIOT_CONTROL_CONFIG.deceleration,
    maxTurnRate: CHARIOT_CONTROL_CONFIG.maxTurnRate,
    cooldown: 0,
    invulnerable: 0,
    health: 100,
    knockbackX: 0,
    knockbackY: 0,
    impactCooldown: 0,
    swarmDamageCooldown: 0,
    // The formation aura's glow on the player's own body: a friendly ring heals
    // him, and this is what the renderer pulses while it does.
    healFlash: 0,
    mode: "chariot",
    maxHealth: 100,
  };
  const campaign = {
    obstacles: [],
    terrain: [],
    clouds: [],
    // Replaced with a fresh seeded stream at the start of every battle.
    random: createSeededRandom(createRandomSeed(seedSource())),
    battlefieldIndex: 0,
    lastBattlefieldIndex: -1,
    stage: 1,
    totalGold: 0,
    equipment: emptyEquipment(),
    horseCount: 1,
    roster: [],
    nextPersonnelId: 1,
    // Hired friendly lines (see formationTiers in data/formations.js): bought
    // in the shop, kept for the run, and spawned fresh at the start of every
    // battle. Each hire buys the next rung of the ladder, so this count is also
    // the index of the rung the shop is selling (`nextTierFor`).
    friendlyFormations: 0,
    // Set once the 4th stage's champion has paid out its free line. The gift is a
    // campaign reward, not a per-battle one, so it is never handed out twice.
    formationGrant: false,
    // Rolled once when a run starts (src/game/identity.js): the player's name
    // and the two story keys behind it. Reset with the rest of the run, and
    // never re-rolled by a retry — it belongs to the campaign, not the battle.
    identity: null,
    // The last stage of this run, rolled with the name before the first battle
    // (see stages.rollFinalStage). 0 means "not rolled yet", which never matches
    // a stage number.
    finalStage: 0,
    // What the purse was when the current battle began. A retry rewinds the
    // battle's takings to this - the coin picked up on a field the player then
    // died on is lost, the coin banked by earlier battles is not.
    entryGold: 0,
    // True between a cleared tutorial and the battle its shop leads into: the
    // drill *is* stage 1 of the run, so the shop must send the player into stage 1
    // of the campaign rather than into stage 2.
    tutorialHandoff: false,
  };
  const state = {
    mode: "menu",
    score: 0,
    wave: 1,
    bullets: [],
    groundArrows: [],
    enemies: [],
    particles: [],
    meleeEffects: [],
    bloodStains: [],
    spawnTimer: 0,
    lastTime: 0, // Owned by the frame loop (src/game/loop.js) — nothing else may write it.
    sound: true,
    elapsed: 0,
    formations: [],
    formationsSpawned: 0,
    // The hired friendly lines: `allyFormations` is what the renderer dashes and
    // labels, `allies` the bodies that move and fight. Both are rebuilt by
    // allies.spawnFriendlyFormations() at the start of each battle.
    allyFormations: [],
    allies: [],
    shake: 0,
    kills: 0,
    objectiveTarget: 8,
    phase: "combat",
    extractionPoint: null,
    bossStage: false,
    // Every champion of the battle, in spawn order: one for a numbered boss
    // stage, the whole squad for the last one. `state.bosses` is the roster; the
    // individual units also live in `state.enemies`, which is what moves them.
    bosses: [],
    // True for the one battle that ends the campaign instead of the shop.
    finalBattle: false,
    // Felled trees of the current battle (see fellTree in game/elements.js): the
    // stump is scenery only, so it lives outside `obstacles`, which every collision
    // and line-of-sight query reads. Refilled per battle by stages.createBattle.
    stumps: [],
    bossDefeated: false,
    bossWarningTimer: 0,
    // Set by damagePlayer(), consumed by the renderer's red vignette.
    damageFlash: 0,
    drops: [],
    footCompanions: [],
    // Wild animals of the current battle (src/data/wilds.js). They live in
    // `state.enemies` as well - that is what moves, damages and draws them - and
    // `wilds` is the roster the species rule and the battle loop prune. Empty in
    // every campaign battle.
    wilds: [],
    // Which scenario the current battle belongs to: "campaign" or "tutorial".
    // stages.createBattle reads it for the map check, the objective and the enemy
    // cap, and the next battle after a tutorial handoff clears it.
    battleMode: "campaign",
    // Bumped by every createBattle(). A scenario that arms itself when the field
    // opens (src/game/tutorial.js) asks this instead of a boolean, so a pause, a
    // language switch or a blur - all of which re-enter "running" - cannot re-run
    // the opening beat of the same battle.
    battleId: 0,
    // The tutorial's step machine, or null. Owned by src/game/tutorial.js; the
    // HUD and the canvas overlay only read it.
    tutorial: null,
    // The clan's gift card, or null (src/ui/battle-card.js). Like `tutorial` it
    // lives outside the mode machine, because the battle keeps "running" while it
    // is up - see stages.beginExtraction. Nothing advances on the field until it
    // is put away.
    grant: null,
    // Where the camera should look instead of the player, or null to follow the
    // chariot. Only the tutorial writes it (its two pans).
    cameraFocus: null,
    // Bow draw, written by combat.updatePlayerFire() and read by the HUD: the
    // seconds the fire control has been held, and whether it was held last frame
    // (so only a real press -> release is a shot).
    fireHold: 0,
    fireHeld: false,
  };

  return {
    world,
    view,
    camera,
    player,
    campaign,
    state,
    keys: new Set(),
    touchInput: { x: 0, y: 0 },
  };
}
