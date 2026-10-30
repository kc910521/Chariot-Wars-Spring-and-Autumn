import { formationOrders } from "../../data/formations.js";
import { isInsideFormation } from "./formations.js";

// The orders a player gives to a line he is standing in (`formation_up`: 出击 /
// 结阵). This module is deliberately the whole of the feature's runtime:
//
// - it owns no reference to `state`, `player` or `world`. Everything it needs
//   arrives as an argument, so the enemy line can be driven by the same code
//   once it has a commander (see `owner`) and a test can drive it with a few
//   plain objects;
// - it never looks at a clock. `advanceOrders` is a pure function of the
//   formation, its members and the leader's position, so a seeded battle stays
//   reproducible;
// - it names states with the shared enum from the data table, which is where a
//   second faction will read them from.
//
// The machine has two states. 结阵 is a one-shot *placement*: it sets the ring
// down in front of the leader, rewrites every member's station from its own local
// offset, and puts the line back in `hold` immediately. A body that is not on its
// new station walks there under its own `returning` flag - no timer, no third
// state, and nothing to cancel if the player gives the next order a moment later.

export const ORDER_ACTION = { march: "march", hold: "hold" };

// How far off its station a body may stand at 结阵 before it counts as coming
// home. Half a step: anything tighter would flag a body the separation pass has
// already nudged into place.
const ARRIVAL = 2;

// How far in front of the leader the ring's centre sits: the line's own depth
// (its deepest station, `formation.depth`) plus the leader's hull plus a body's
// width. The pattern is a little over two bodies deep - a front rank, a chariot
// on the centre slot and an archer rank behind it - so a ring centred *on* the
// player would park his hull inside the chariot's and leave the front rank
// shoving against the separation pass forever. Forming the line up in front of him
// is the reading that leaves nobody standing in anybody else, and it is also why
// the player is still inside his own dashed ring (the footprint is deeper than the
// gap): the button stays under his thumb and his banner still mends him.
const BODY_CLEARANCE = 18;

// The line faces the way the leader faces. A formation's heading is a rotation,
// and its front is local -Y, which turns out as `(sin h, -cos h)`; that equals
// the leader's own facing `(cos a, sin a)` exactly at `h = a + pi/2`.
const FRONT_OFFSET = Math.PI / 2;

// A member's station, in world coordinates: its own local offset rotated
// through the formation's centre and heading. The same rotation `layoutSlots`
// runs at spawn, only applied to a new centre - which is all a re-placement is.
function stationPoint(formation, member) {
  const cos = Math.cos(formation.heading);
  const sin = Math.sin(formation.heading);
  return {
    x: formation.x + member.stationX * cos - member.stationY * sin,
    y: formation.y + member.stationX * sin + member.stationY * cos,
  };
}

// Where the centre goes for a leader: his position, pushed forward along the
// line's front by the depth of the rank behind the centre plus his own hull.
function centreFor(formation, leader) {
  const hull = Number.isFinite(leader.radius) ? leader.radius : 0;
  const gap = Math.max(0, formation.depth ?? 0) + hull + BODY_CLEARANCE;
  return {
    x: leader.x + Math.sin(formation.heading) * gap,
    y: leader.y - Math.cos(formation.heading) * gap,
  };
}

// The line the leader is standing in: the nearest centre among every footprint
// that contains him, ties broken by list order. Nearest matters because two
// hired lines may overlap once both have marched; list order matters because
// the answer has to be the same on every machine.
export function formationUnder(formations = [], leader = null) {
  if (!leader || !Number.isFinite(leader.x) || !Number.isFinite(leader.y)) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const formation of formations) {
    if (!formation || !isInsideFormation(formation, leader.x, leader.y)) continue;
    const distance = Math.hypot(formation.x - leader.x, formation.y - leader.y);
    if (distance >= bestDistance) continue;
    best = formation;
    bestDistance = distance;
  }
  return best;
}

// The same question, asked on behalf of one side. A formation with no `owner`
// belongs to nobody in particular, so only a caller that does not care (a test,
// a scripted line) may command it; a formation carrying a flag answers to that
// flag alone. This is the seam a second commander plugs into: an enemy officer
// is `owner: "enemy"` and cannot order a hired line even standing inside it.
export function commandedFormation(formations = [], leader = null, owner = null) {
  const formation = formationUnder(formations, leader);
  if (!formation) return null;
  if (owner !== null && formation.owner !== owner) return null;
  return formation;
}

// Everything 结阵 does, in one place: the ring lands in front of the leader,
// facing the way he faces, every station is recomputed, and anybody who did not
// land on theirs is told to walk. Returns the order the line is in afterwards.
function placeFormation({ formation, members, leader }) {
  if (Number.isFinite(leader.angle)) formation.heading = leader.angle + FRONT_OFFSET;
  const centre = centreFor(formation, leader);
  formation.x = centre.x;
  formation.y = centre.y;
  formation.order = formationOrders.HOLD;
  let stragglers = 0;
  for (const member of members) {
    if (!member || member.destroyed || member.formationId !== formation.id) continue;
    if (!Number.isFinite(member.stationX) || !Number.isFinite(member.stationY)) continue;
    const station = stationPoint(formation, member);
    member.homeX = station.x;
    member.homeY = station.y;
    member.homeAngle = formation.heading;
    member.returning = Math.hypot(member.x - station.x, member.y - station.y) > ARRIVAL;
    if (member.returning) stragglers += 1;
  }
  formation.stragglers = stragglers;
  return formationOrders.HOLD;
}

// One action on one line already in hand. Kept separate from `issueOrder` so
// the button's path (which has just found the line) does not have to look it up
// a second time, and so a scripted order can name its formation directly.
export function applyOrder({ formation, members = [], leader = null, action } = {}) {
  if (!formation || !leader || !action) return null;
  if (action === ORDER_ACTION.march) {
    if (formation.order === formationOrders.MARCH) return null;
    formation.order = formationOrders.MARCH;
    formation.stragglers = 0;
    // A body that was walking home when the line was loosed is marching now:
    // the flag is a fact about the last 结阵, not about this order.
    for (const member of members) {
      if (member && member.formationId === formation.id) member.returning = false;
    }
    return formationOrders.MARCH;
  }
  if (action === ORDER_ACTION.hold) return placeFormation({ formation, members, leader });
  return null;
}

// A command from a commander: find the line he is standing in and apply it.
// This is the shape a networked command serialises to, roughly
// `{ tick, actorId, formationId, action }`: the authority on the host runs it
// and the outcome is synced, so a client never re-derives it.
export function issueOrder({
  formations = [], members = [], leader = null, owner = null, action,
} = {}) {
  const formation = commandedFormation(formations, leader, owner);
  if (!formation) return null;
  const next = applyOrder({ formation, members, leader, action });
  if (!next) return null;
  return { formation, action: next };
}

// The button's own command: 出击 while the line holds, 结阵 while it marches.
export function toggleOrder({ formations = [], members = [], leader = null, owner = null } = {}) {
  const formation = commandedFormation(formations, leader, owner);
  if (!formation) return null;
  const action = formation.order === formationOrders.MARCH ? ORDER_ACTION.hold : ORDER_ACTION.march;
  const next = applyOrder({ formation, members, leader, action });
  if (!next) return null;
  return { formation, action: next };
}

// The per-frame half: one pass over the staffed lines, before any brain thinks.
//
// A marching line's centre *is* the leader - that is the whole of 出击, and it
// is why the ring the renderer dashes, the footprint the aura tests and the
// enemies standing inside it all travel with the chariot. Each station is then
// recomputed every frame, so a marcher is always running at a moving slot and a
// body that was just set down is exactly on the slot it was given.
export function advanceOrders({
  formations = [], members = [], leader = null,
} = {}) {
  const staffed = formations.filter((formation) => members.some(
    (member) => member && !member.destroyed && member.formationId === formation.id,
  ));
  for (const formation of staffed) {
    if (formation.order === formationOrders.MARCH && leader) {
      // The ring is rigidly attached to the leader: same offset, same heading, so
      // he stays at the same spot inside his own line while it travels.
      const centre = centreFor(formation, leader);
      formation.x = centre.x;
      formation.y = centre.y;
    }
    let stragglers = 0;
    for (const member of members) {
      if (!member || member.destroyed || member.formationId !== formation.id) continue;
      if (!Number.isFinite(member.stationX) || !Number.isFinite(member.stationY)) continue;
      const station = stationPoint(formation, member);
      member.homeX = station.x;
      member.homeY = station.y;
      // True only between a 结阵 and the body's arrival; the count is what the
      // renderer's amber stroke reads.
      if (member.returning) stragglers += 1;
    }
    formation.stragglers = stragglers;
  }
  return staffed;
}
