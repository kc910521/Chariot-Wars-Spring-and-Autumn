// The fallen. A corpse is scenery, so it lives outside every list that fights:
// not in `state.enemies` (no slot in the spawn cap, no target for an arrow, no
// body in `separateEnemies`, no unit keeping a formation's rect alive, no unit
// counted by an aura), not in `state.allies`, and nothing but `renderer` reads
// `state.corpses`. That separation is the whole design: a body on the ground
// cannot change a fight it is not in.
//
// What is stored is a snapshot, never the unit: the unit keeps being filtered out
// of its own roster on the frame it dies, and a corpse must not alias a body that
// is about to disappear. Nothing here rolls a die either - the pose is the bearing
// the body died on - so a death leaves the rest of the field exactly where it was.
export const CORPSE_LIMIT = 40;

// `unit` is any body that has just died: an enemy, a hired ally or a dismounted
// companion. `visual.kind` picks the corpse the renderer paints - a chariot leaves
// the wheel-less box `drawChariotWreck` draws, everything else lies down in the
// silhouette it walked in - and `visual.robe` is kept for the wrecks and for the
// beasts, whose hide stays their own colour.
export function addCorpse(state, unit) {
  state.corpses.push({
    x: unit.x,
    y: unit.y,
    angle: unit.angle,
    kind: unit.visual?.kind ?? "foot",
    robe: unit.visual?.robe ?? null,
    scale: unit.visual?.scale ?? 1,
    radius: unit.radius ?? 12,
  });
  // A long battle leaves hundreds of bodies, so the pile is capped and the oldest
  // one goes: the field keeps the fighting that is still in view.
  if (state.corpses.length > CORPSE_LIMIT) state.corpses.shift();
}
