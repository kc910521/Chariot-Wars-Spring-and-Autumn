import { clamp } from "../../utils/math.js";

// Formation *geometry* - the envelope a spawned line occupies. The data table
// that describes the units themselves lives in src/data/formations.js; this is
// the runtime side: how far a unit may stray from the slot it spawned on, and
// (from the aggro step) how a whole line reacts to the player entering it.

// Melee infantry are leashed to the slot they spawned on. The old guard code
// abandoned that slot for a post 92px in front of whichever archer happened to
// be nearest, recomputed every frame: entire columns converged on one point
// (nothing separates enemies from each other, only the player is pushed), and
// the post orbited as the player circled the archers. Leaning a bounded
// distance off a fixed anchor keeps a formation reading as a line and makes a
// shared post impossible.
const GUARD_LEASH = 38;
// The leash widens as the player closes in so the line braces forward, and it is
// measured from the slot: a unit the chariot is already inside (within its own
// reach) never moves at all.
const GUARD_BRACE = 10;
const GUARD_BRACE_RANGE = 200;

// The renderer draws the dashed footprint from these extents, so they have to
// span the whole leash envelope or units legitimately poke out of their border.
export const FORMATION_MARGIN = 54;

// Ground clearance: the ranks have to stand on clear, uniform footing, so the box
// tested at spawn time is the slots themselves plus a margin for the bodies
// standing on them - not the wider leash envelope the renderer dashes, which a
// wall at its very edge may legitimately touch.
export const FORMATION_GROUND_MARGIN = 26;

function slotExtent(pattern, margin) {
  return {
    halfWidth: Math.max(...pattern.slots.map(([, slotX]) => Math.abs(slotX))) + margin,
    halfHeight: Math.max(...pattern.slots.map(([, , slotY]) => Math.abs(slotY))) + margin,
  };
}

// The rect a formation reserves, in its own frame: the farthest slot in each
// direction plus the leash envelope. Both the renderer's border and the ground
// test use this one function, so a line can never be drawn wider than the ground
// it was cleared for.
export function formationExtent(pattern) {
  return slotExtent(pattern, FORMATION_MARGIN);
}

// The rect the spawner asks about: everything the ranks themselves occupy.
export function formationGroundExtent(pattern) {
  return slotExtent(pattern, FORMATION_GROUND_MARGIN);
}

// How far a leashed unit may stray from the slot it spawned on. It widens a
// little as the player closes in, so the line braces forward instead of
// standing still, and it is measured from the slot rather than from the unit:
// a unit the chariot is already inside has nothing to chase.
export function leashRadius(player, unit) {
  const homeDistance = Math.hypot(player.x - unit.homeX, player.y - unit.homeY);
  const brace = clamp((GUARD_BRACE_RANGE - homeDistance) / GUARD_BRACE_RANGE, 0, 1);
  return GUARD_LEASH + GUARD_BRACE * brace;
}

function clampToAnchor(unit, x, y, span) {
  const dx = x - unit.homeX;
  const dy = y - unit.homeY;
  const distance = Math.hypot(dx, dy);
  if (distance === 0 || distance <= span) return { x, y };
  return { x: unit.homeX + (dx / distance) * span, y: unit.homeY + (dy / distance) * span };
}

// Clamps a point of interest to the unit's own envelope: chasing a remembered
// sighting must not drag one infantry out of the line it belongs to.
export function leashPoint(player, unit, x, y) {
  if (unit.formationId === undefined) return { x, y };
  return clampToAnchor(unit, x, y, leashRadius(player, unit));
}

// How far past its leash a unit will walk to check a sighting it lost. Looking
// is more than chasing - there is no live target to follow, so the unit commits
// to a spot - but the envelope is still bounded, so a line that loses track of a
// chariot walks out, looks, and re-forms instead of scattering after nothing.
const SEARCH_SPANS = 2;

export function searchPoint(player, unit, x, y) {
  if (unit.formationId === undefined) return { x, y };
  return clampToAnchor(unit, x, y, leashRadius(player, unit) + chaseSpan(unit) * SEARCH_SPANS);
}

// A line wakes up when the player steps into its footprint and stands down again
// once he is clear. The two borders are deliberately different: one shared border
// would make a chariot parked on it flicker the whole formation in and out of
// pursuit every frame, which reads as a twitch (and was the chatter the guard
// post was originally introduced to stop).
const ALERT_MARGIN = 24;
// How far past the alert border the line stays awake. It is the distance the
// fastest foot unit (spear, 61px/s) covers in its 1.2s chase span, so a unit
// still walking home cannot cross the release border, stand down, and wake up
// again on the next frame.
const ALERT_RELEASE = 73;

// The pattern's own frame: local -Y is the front, +X runs along the line.
function formationLocal(formation, x, y) {
  const dx = x - formation.x;
  const dy = y - formation.y;
  return {
    x: dx * Math.cos(formation.heading) + dy * Math.sin(formation.heading),
    y: -dx * Math.sin(formation.heading) + dy * Math.cos(formation.heading),
  };
}

// The rectangle the renderer dashes, in that same frame - so the aggro border is
// the border the player can see. Same defaults as the renderer's, for a
// formation built by hand (an older save has no extents on it).
export function isInsideFormation(formation, x, y, margin = 0) {
  const local = formationLocal(formation, x, y);
  return Math.abs(local.x) <= (formation.halfWidth || 116) + margin
    && Math.abs(local.y) <= (formation.halfHeight || 86) + margin;
}

// How far past its leash an alerted unit will follow: one `chaseSeconds` of its
// own travel, so a spear closes further than a heavy and the row owns the number.
function chaseSpan(unit) {
  return unit.speed * (unit.chaseSeconds ?? 1.2);
}

// A chasing unit's goal: the player, clamped to the leash plus one chase span
// around the slot it spawned on. It pursues with the whole envelope, so the line
// cannot be kited off the field one unit at a time, and it still returns home
// once the formation stands down.
export function chasePoint(player, unit, x, y) {
  if (unit.formationId === undefined) return { x, y };
  return clampToAnchor(unit, x, y, leashRadius(player, unit) + chaseSpan(unit));
}

// The rect a line defends while it is awake: the footprint the renderer dashes,
// grown by the band that keeps the line alerted. A point already inside comes
// back untouched - the everyday case, the player standing on the formation - and
// anything beyond is pulled in to the border.
function clampToRect(formation, x, y, margin) {
  const local = formationLocal(formation, x, y);
  const halfWidth = (formation.halfWidth || 116) + margin;
  const halfHeight = (formation.halfHeight || 86) + margin;
  const localX = clamp(local.x, -halfWidth, halfWidth);
  const localY = clamp(local.y, -halfHeight, halfHeight);
  if (localX === local.x && localY === local.y) return { x, y };
  return {
    x: formation.x + localX * Math.cos(formation.heading) - localY * Math.sin(formation.heading),
    y: formation.y + localX * Math.sin(formation.heading) + localY * Math.cos(formation.heading),
  };
}

// An alerted line's goal: the player *anywhere on the line's own ground*, not
// clamped to each slot's private envelope.
//
// `chasePoint` bounds a unit to leash + one chase span from its slot, and the
// brain then stops a weapon's reach short of that goal - so the farthest a heavy
// could ever walk from the ground it spawned on was 38px of leash + 43px of
// chase span - 35px of reach = 46px. A back-rank heavy therefore could not touch
// a chariot parked on its own formation: it took its 46px, stood there with its
// swing ready (`attackCooldown === 0`) and faced the player while 100-160px out.
// Measured on the real spawner: 10 of 12 melee units stalled like that, and only
// 4-8 blows landed per 5s when the player stopped at the edge of the line,
// against 21 at its centre.
//
// Defending the formation's rectangle instead puts every rank within reach of a
// player who is on the footprint or in the band that keeps the line awake. The
// bound moves from the unit to the line: the goal still stops at the release
// border, so nothing can be kited off the field, and a unit that is not in an
// alerted formation keeps the old envelope (or no bound at all - a boss).
//
// Same spawner, player parked: the line's mean distance falls from 117px to 49px
// at the front edge and from 199px to 39px at a far corner, the worst unit ends
// one body past its reach instead of 62-191px, and blows in 5s go from 4-8 to 16
// (front edge) and 22 (corner). Centred, 21 blows become 32.
export function defendedPoint(player, unit, x, y) {
  if (unit.line === undefined || !unit.alerted) return chasePoint(player, unit, x, y);
  return clampToRect(unit.line, x, y, ALERT_RELEASE);
}

// Alerts are latched on the formation and mirrored onto its units, because a
// brain owns no state of its own: one pass here and every brain can read
// `enemy.alerted` without having to find its own formation. The formation itself
// rides along as `unit.line` for the same reason - a brain that has to know
// *which ground* it defends (`defendedPoint`) should not have to look it up
// either, and a line's geometry never moves once it has spawned.
export function updateFormationAlerts(formations, units, player) {
  const lines = new Map();
  for (const formation of formations) {
    const margin = formation.alerted ? ALERT_RELEASE : ALERT_MARGIN;
    formation.alerted = isInsideFormation(formation, player.x, player.y, margin);
    lines.set(formation.id, formation);
  }
  for (const unit of units) {
    if (unit.formationId === undefined) continue;
    const line = lines.get(unit.formationId);
    unit.alerted = line !== undefined && line.alerted === true;
    unit.line = line;
  }
}
