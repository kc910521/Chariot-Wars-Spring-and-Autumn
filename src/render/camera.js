// The camera only ever consumes a finite, clamped delta, and it refuses to stay
// poisoned: once it is NaN it can never recover on its own (Infinity - Infinity
// is NaN), which left every inView() false and every translate() non-finite.
const MAX_DELTA = 0.05;

function clampRatio(value) {
  return Math.min(Math.max(value, 0), 1);
}

export function updateCamera({ player, world, view, camera }, delta) {
  const targetX = Math.max(0, Math.min(world.width - view.width, player.x - view.width / 2));
  const targetY = Math.max(0, Math.min(world.height - view.height, player.y - view.height / 2));
  if (!Number.isFinite(camera.x) || !Number.isFinite(camera.y)
    || !Number.isFinite(targetX) || !Number.isFinite(targetY)) {
    camera.x = Number.isFinite(targetX) ? targetX : 0;
    camera.y = Number.isFinite(targetY) ? targetY : 0;
    return;
  }
  const step = Number.isFinite(delta) ? Math.min(Math.max(delta, 0), MAX_DELTA) : 0;
  const easing = clampRatio(1 - Math.exp(-7 * step));
  camera.x += (targetX - camera.x) * easing;
  camera.y += (targetY - camera.y) * easing;
}
