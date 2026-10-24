// Aim assist for the chariot's tapped shot. It only picks a bearing: the bow
// keeps its own ballistics, so an arrow still flies the arc solved for the
// distance and can be spoiled by spread, an obstacle, or a target that walks
// away. Nothing here is remembered between frames — a fired arrow is never
// re-aimed — because the helper exists to spare the player from guessing the
// bearing, not to guarantee the hit.
export function selectAimTarget({
  x, y, angle, enemies, maxRange, coneCosine, hasLineOfSight = () => true,
}) {
  let best = null;
  let bestDistance = Infinity;
  for (const enemy of enemies) {
    if (enemy.destroyed) continue;
    const deltaX = enemy.x - x;
    const deltaY = enemy.y - y;
    const distance = Math.hypot(deltaX, deltaY);
    // Farther than the helper's reach, or farther than a target already found:
    // skip before paying for the sight query.
    if (distance > maxRange || distance >= bestDistance) continue;
    // "In front of the chariot": the nose vector dotted with the bearing has to
    // clear the cone, so a target beside or behind the axle is left alone.
    if ((Math.cos(angle) * deltaX + Math.sin(angle) * deltaY) / Math.max(1, distance) < coneCosine) continue;
    if (!hasLineOfSight(x, y, enemy.x, enemy.y)) continue;
    best = enemy;
    bestDistance = distance;
  }
  return best;
}
