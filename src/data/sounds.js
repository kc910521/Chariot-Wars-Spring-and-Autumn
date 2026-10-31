// The sound registry: which drops ship, which cue each gameplay event asks for,
// and every number the audio engine needs. Nothing here touches the DOM, the Web
// Audio API or the file system, so the unit tests can assert the whole contract
// in Node.
//
// A drop is a file under `src/assets/sound/<folder>/` and its file name is the
// routing key:
//
//   <cue>.wav        one one-shot
//   <cue>_<n>.wav    one of several interchangeable takes, picked at random
//   <cue>_loop.wav    a bed that plays until it is told to stop
//
// The folder (`player`, `units`, `weapon`, `ambient`) groups a drop for humans
// only; the engine keys everything off the file name, so a new take dropped into
// any folder joins its cue without a code change. Spell the name the way the
// game says it in `soundCues` below - that table is what maps a *game* event onto
// a *file*, and it is the only place a file name appears in the source.
//
// Assets are normalised by `scripts/transcode-audio.mjs` (22.05 kHz, 16-bit, mono
// PCM, -3 dBFS peak), which is why the gains below can be read as "how loud next
// to the others" instead of "how much headroom this recording happened to have".

// Splits a drop path into the four facts the engine routes on. A file that does
// not follow the convention still loads - it just registers as a one-shot whose
// cue is its whole name, which is the safe default.
export function describeSoundFile(file) {
  const separator = file.lastIndexOf("/");
  const folder = separator < 0 ? "" : file.slice(0, separator);
  const base = file.slice(separator + 1).replace(/\.[a-z0-9]+$/i, "");
  const loop = base.endsWith("_loop");
  const stem = loop ? base.slice(0, -"_loop".length) : base;
  const variant = /^(.*)_(\d+)$/.exec(stem);
  return {
    file,
    folder,
    cue: variant ? variant[1] : stem,
    // 0 for a cue with a single take, so the engine can tell "one variant" from
    // "the first of three" without a second lookup.
    variant: variant ? Number(variant[2]) : 0,
    loop,
  };
}

// Every drop that ships, exactly as `scripts/transcode-audio.mjs` leaves it. The
// ambient beds stay mp3: they are 30s each, so decoding one into an AudioBuffer
// would cost ~11.5 MB of float samples for a loop a streaming element plays for
// free.
export const soundFiles = Object.freeze([
  "ambient/boss_fight_map_background_loop.mp3",
  "ambient/default_map_background_loop.mp3",

  "player/chariot_arrow_shoot_1.wav",
  "player/chariot_arrow_shoot_2.wav",
  "player/chariot_collision_injury.wav",
  "player/chariot_melee_attack_1.wav",
  "player/chariot_moving_loop.wav",
  "player/coin_collect_1.wav",
  "player/footstep_1.wav",
  "player/footstep_2.wav",
  "player/footstep_3.wav",
  "player/footstep_4.wav",
  "player/footstep_5.wav",
  "player/get_off_the_chariot.wav",
  "player/meat_collect.wav",
  "player/push_down_the_tree.wav",
  "player/retreat_point_appear.wav",
  "player/shoppage_campfire_loop.wav",
  "player/shoppage_equipment_upgrade.wav",
  "player/shoppage_recruit_soilder.wav",
  "player/wave_up.wav",

  "units/archer_infantry_die.wav",
  "units/catapult_die.wav",
  "units/catapult_shoot.wav",
  "units/elephant_die.wav",
  "units/hit_by_melee.wav",
  "units/lion_die.wav",

  "weapon/archer_shoot_1.wav",
  "weapon/arrow_hit_1.wav",
  "weapon/arrow_hit_to_ground_1.wav",
  "weapon/stone_hit_to_ground.wav",
]);

// Queues so long that streaming beats decoding. Kept next to the list above so a
// new ambience has one obvious place to be declared.
export const soundStreams = Object.freeze([
  "ambient/boss_fight_map_background_loop.mp3",
  "ambient/default_map_background_loop.mp3",
]);

// The cue a *game* event asks for: game code says `soundCues.chariotArrow`, never
// a file name, which is what lets a drop be re-taken or renamed in one place.
// Every cue here must exist among `soundFiles` and every file must be named by
// exactly one entry - the unit test enforces both directions.
export const soundCues = Object.freeze({
  // The player: chariot, crew and the two story beats.
  chariotArrow: "chariot_arrow_shoot",
  // The source drop for this cue is byte-identical to `weapon/arrow_hit_1.wav`,
  // so the melee swing currently sounds like an arrow landing.
  // TODO(sound): a real blade/halberd swing.
  chariotMelee: "chariot_melee_attack",
  chariotCrash: "chariot_collision_injury",
  chariotRolling: "chariot_moving",
  chariotExit: "get_off_the_chariot",
  footstep: "footstep",
  treeFell: "push_down_the_tree",
  coinPickup: "coin_collect",
  meatPickup: "meat_collect",
  waveUp: "wave_up",
  retreatPoint: "retreat_point_appear",

  // The shop, and the loop that plays while it is open.
  shopUpgrade: "shoppage_equipment_upgrade",
  shopRecruit: "shoppage_recruit_soilder",
  campfire: "shoppage_campfire",

  // Weapons.
  archerShoot: "archer_shoot",
  arrowHit: "arrow_hit",
  arrowGround: "arrow_hit_to_ground",
  stoneGround: "stone_hit_to_ground",

  // Units.
  hitByMelee: "hit_by_melee",
  footDied: "archer_infantry_die",
  lionDied: "lion_die",
  elephantDied: "elephant_die",
  catapultDied: "catapult_die",
  catapultShoot: "catapult_shoot",

  // Ambience. Known defect, recorded here so it is not re-diagnosed from scratch:
  // the field bed in the repo is an empty bounce (30.0s, -58 dBFS RMS, no content
  // below 120 Hz), so menu and battle are effectively silent. The gain is not the
  // problem and raising it would only amplify hiss; the fix is a re-export of the
  // original at this same path. `node scripts/transcode-audio.mjs --levels` flags it.
  fieldAmbience: "default_map_background",
  bossAmbience: "boss_fight_map_background",
});

// Events that have no recording of their own yet. Every row is a deliberate stand
// in, so the substitution is reviewable and a real drop only has to replace one
// value: nothing else in the source names a file.
export const soundBorrowed = Object.freeze({
  // TODO(sound): a boss horn or war drum. The elephant is the only low, heavy
  // drop in the set; `wave_up` is the alternative if this reads as a death cry.
  bossWarning: soundCues.elephantDied,
  // TODO(sound): a victory jingle. The 20 s 96 kHz drop was 11.5 MB, so it was
  // cut; this is the short rising figure from the shop instead.
  victory: soundCues.shopUpgrade,
  // TODO(sound): a shield/buckler deflect. A hit landing is the closest thing.
  playerBlocked: soundCues.arrowHit,
  // TODO(sound): a recruit's crossbow release of its own - a hard wooden clack.
  // Until then it takes the player's crossbow, which is the only crossbow in the
  // set: a recruit volley should not be the bow string. It inherits that cue's
  // `chariotArrow` mix (gain 0.5), so a bolt lands louder than an arrow - which is
  // the right read for a slower, heavier weapon.
  crossbowShoot: soundCues.chariotArrow,
  // TODO(sound): stone off armour. The ground impact is the same material.
  stoneBodyHit: soundCues.stoneGround,
  // TODO(sound): a chariot breaking up. Felled timber reads as the cart going.
  chariotDied: soundCues.treeFell,
  // TODO(sound): one man of a friendly line going down.
  friendlyDied: soundCues.footDied,
  // TODO(sound): the player's own death sting.
  playerDied: soundCues.footDied,
  // TODO(sound): a tiger. The lion is the other big cat in the set.
  tigerDied: soundCues.lionDied,
});

// Balance, in one table. The gains are readable because every drop is normalised
// to the same -3 dBFS peak (scripts/transcode-audio.mjs): 0.3 is "background",
// 0.8 is "you must hear this over a chariot crash".
//
// `maxVoices` and `minInterval` are what keeps a volley of twelve arrows from
// turning into one loud smear: the engine drops a repeat of the same cue inside
// the interval, and never mixes more than `maxVoices` of it at once.
export const soundMix = Object.freeze({
  footstep: { gain: 0.3, maxVoices: 2, minInterval: 0.09 },
  chariotRolling: { gain: 0.5, maxVoices: 1 },
  chariotArrow: { gain: 0.5, maxVoices: 4, minInterval: 0.03 },
  chariotMelee: { gain: 0.6, maxVoices: 3, minInterval: 0.06 },
  chariotCrash: { gain: 0.8, maxVoices: 1, minInterval: 0.35 },
  chariotExit: { gain: 0.6, maxVoices: 1 },
  treeFell: { gain: 0.7, maxVoices: 1, minInterval: 0.3 },
  archerShoot: { gain: 0.35, maxVoices: 4, minInterval: 0.05 },
  arrowHit: { gain: 0.3, maxVoices: 4, minInterval: 0.03 },
  arrowGround: { gain: 0.22, maxVoices: 3, minInterval: 0.05 },
  stoneGround: { gain: 0.35, maxVoices: 3, minInterval: 0.06 },
  hitByMelee: { gain: 0.45, maxVoices: 3, minInterval: 0.06 },
  footDied: { gain: 0.45, maxVoices: 3, minInterval: 0.07 },
  lionDied: { gain: 0.55, maxVoices: 2, minInterval: 0.2 },
  elephantDied: { gain: 0.65, maxVoices: 1, minInterval: 0.4 },
  catapultDied: { gain: 0.55, maxVoices: 2, minInterval: 0.2 },
  catapultShoot: { gain: 0.4, maxVoices: 2, minInterval: 0.2 },
  coinPickup: { gain: 0.5, maxVoices: 2, minInterval: 0.05 },
  meatPickup: { gain: 0.5, maxVoices: 2, minInterval: 0.05 },
  waveUp: { gain: 0.65, maxVoices: 1, minInterval: 0.5 },
  retreatPoint: { gain: 0.7, maxVoices: 1, minInterval: 0.5 },
  shopUpgrade: { gain: 0.6, maxVoices: 1, minInterval: 0.2 },
  shopRecruit: { gain: 0.6, maxVoices: 1, minInterval: 0.2 },
  campfire: { gain: 0.4, maxVoices: 1 },
  fieldAmbience: { gain: 0.5, maxVoices: 1 },
  bossAmbience: { gain: 0.55, maxVoices: 1 },
});

// Defaults for a cue the table above does not mention, plus the two numbers that
// belong to the engine rather than to a cue.
export const soundLimits = Object.freeze({
  gain: 0.55,
  maxVoices: 3,
  minInterval: 0.04,
  // Hard cap on short voices across every cue at once. 24 is a whole volley plus
  // a melee scrum; past that a phone's mixer starts dropping frames, and nobody
  // can pick out the 25th arrow anyway.
  voices: 24,
  // A voice cut early (the cue hit its ceiling) fades over this long instead of
  // clicking.
  fadeSeconds: 0.08,
});

// Loop lanes. A soundscape is a set of layers and each layer owns exactly one
// loop, so swapping the ambience under a battle cannot cut the chariot's roll.
// `fadeSeconds` is per lane: music is crossfaded, a mechanical loop is not.
export const soundChannels = Object.freeze({
  ambience: { fadeSeconds: 1.2 },
  motion: { fadeSeconds: 0.25 },
  fire: { fadeSeconds: 0.6 },
});

// What plays underneath each screen. `motion` is added per frame by
// resolveSoundscape() because it follows the chariot, not the screen.
export const soundscapes = Object.freeze({
  menu: { ambience: soundCues.fieldAmbience },
  battle: { ambience: soundCues.fieldAmbience },
  boss: { ambience: soundCues.bossAmbience },
  camp: { fire: soundCues.campfire },
});

// Which bed belongs to the screen that is up: the menu and an ordinary battle
// share the field ambience, a champion's battle gets its own, and the shop is a
// night camp with a fire. The chariot's roll is a layer of its own so a stopped
// chariot stops heard, and it never plays on a screen without a field under it.
export function resolveSoundscape({ mode = "menu", boss = false, moving = false } = {}) {
  const name = mode === "shop" ? "camp"
    : mode === "running" || mode === "paused" || mode === "over" || mode === "victory"
      ? (boss ? "boss" : "battle")
      : "menu";
  const layers = { ...soundscapes[name] };
  if (moving && (name === "battle" || name === "boss")) layers.motion = soundCues.chariotRolling;
  return { name, layers };
}

// Which death a unit's silhouette gets. Keyed by `visual.kind`, which is the one
// field every enemy row already carries (src/data/formations.js, wilds.js), so a
// new unit type inherits a death sound from the body that draws it.
export const soundDeathCues = Object.freeze({
  chariot: soundBorrowed.chariotDied,
  catapult: soundCues.catapultDied,
  elephant: soundCues.elephantDied,
  foot: soundCues.footDied,
  lion: soundCues.lionDied,
  tiger: soundBorrowed.tigerDied,
});

// A successful purchase is the shop's own feedback: steel for a part, a shout for
// a body. Keyed by the purchase type `equipmentShop.purchaseItem` takes.
export const soundPurchaseCues = Object.freeze({
  equipment: soundCues.shopUpgrade,
  horse: soundCues.shopUpgrade,
  personnel: soundCues.shopRecruit,
  formation: soundCues.shopRecruit,
});

// Timing that decides *when* a cue fires, as opposed to how it sounds.
// `footstepStride` is how far a dismounted player walks between steps: 26 px is a
// little over one body length, close enough to a gait that the five takes read as
// walking instead of as a metronome.
export const soundCadence = Object.freeze({
  footstepStride: 26,
});
