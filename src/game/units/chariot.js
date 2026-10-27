import { chariotTactics } from "../../data/formations.js";
import { clamp } from "../../utils/math.js";

// The morale of a chariot, shared by both sides of the field.
//
// A chariot is the only unit that decides the fight is lost before its hull is.
// That decision does not depend on whose banner it carries: the hired one and
// the enemy line's one break off at the same health, regroup over the same
// hysteresis band, and make the same last stand. So the state machine lives
// here, once, and each side supplies only its own legs. (`chariot-archer` is a
// horse archer, not a ram: it keeps the ranged brain and never enters this
// machine.)
//
// The machine answers with one of three intents:
//   REGROUP  run / stand on the home slot, still disengaged until mended
//   ENGAGE   drive at the target and ram
//   HOLD     face the threat from the slot, ram only what touches the hull
//
// Keeping the vocabulary to three intents means the locomotion can stay where
// it belongs - allies step along a leash, enemies turn and advance - without
// either side re-implementing the thresholds.

export const CHARIOT_STATE = Object.freeze({
  HOLD: "HOLD",
  CHASE: "CHASE",
  FLEE: "FLEE",
  FIGHT_TO_DEATH: "FIGHT_TO_DEATH",
});

export const CHARIOT_INTENT = Object.freeze({
  HOLD: "HOLD",
  ENGAGE: "ENGAGE",
  REGROUP: "REGROUP",
});

// Pure transition, so the hysteresis can be tested without a battle.
//
// - At or below `fleeAt` the chariot breaks off, unless it is already in melee:
//   then there is no road home and it fights to the death.
// - FLEE is left only above `reengageAt`, not at the entry threshold. That band
//   is the whole point: a chariot that catches one point of healing must not
//   turn around and charge again.
// - FIGHT_TO_DEATH is latched. Healing, reaching home or meeting a fresh target
//   never re-opens an escape route.
// - `hasTarget` only matters once the chariot is willing to fight again; being
//   alone is what turns an armed chariot back into a parked one.
export function nextChariotState({
  current = CHARIOT_STATE.HOLD, health, maxHealth, inMelee = false, hasTarget = false,
}, tactics = chariotTactics) {
  if (current === CHARIOT_STATE.FIGHT_TO_DEATH) return CHARIOT_STATE.FIGHT_TO_DEATH;
  const ratio = maxHealth > 0 ? clamp(health / maxHealth, 0, 1) : 0;
  if (current === CHARIOT_STATE.FLEE) {
    if (inMelee) return CHARIOT_STATE.FIGHT_TO_DEATH;
    if (ratio <= tactics.reengageAt) return CHARIOT_STATE.FLEE;
    return hasTarget ? CHARIOT_STATE.CHASE : CHARIOT_STATE.HOLD;
  }
  if (ratio <= tactics.fleeAt) {
    return inMelee ? CHARIOT_STATE.FIGHT_TO_DEATH : CHARIOT_STATE.FLEE;
  }
  return hasTarget ? CHARIOT_STATE.CHASE : CHARIOT_STATE.HOLD;
}

// The mutable form used by both brains: read the machine's own state, write the
// next one back. `situation` is the same shape `nextChariotState` takes.
export function updateChariotState(chariot, situation, tactics = chariotTactics) {
  chariot.chariotState = nextChariotState({ ...situation, current: chariot.chariotState }, tactics);
  return chariot.chariotState;
}

// What the state asks the legs to do. Unknown states read as HOLD so a unit that
// has never been ticked simply stands its ground.
export function chariotIntent(state) {
  if (state === CHARIOT_STATE.FLEE) return CHARIOT_INTENT.REGROUP;
  if (state === CHARIOT_STATE.CHASE || state === CHARIOT_STATE.FIGHT_TO_DEATH) {
    return CHARIOT_INTENT.ENGAGE;
  }
  return CHARIOT_INTENT.HOLD;
}

// True while the chariot at `x, y` is close enough to its home slot to count as
// regrouped. Shared so "back at camp" means the same thing to both sides.
export function isAtHome(x, y, homeX, homeY, tactics = chariotTactics) {
  return Math.hypot(homeX - x, homeY - y) <= tactics.homeEpsilon;
}
