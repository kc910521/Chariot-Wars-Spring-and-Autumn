// The camera only ever consumes a finite, clamped delta, and it refuses to stay
// poisoned: once it is NaN it can never recover on its own (Infinity - Infinity
// is NaN), which left every inView() false and every translate() non-finite.
const MAX_DELTA = 0.05;

// How fast the camera settles on whatever it is following. The follow rate is the
// one the chariot has always used; the focus rate is slower, because a tutorial
// pan is a camera move the player is meant to watch, not a chase.
const FOLLOW_RATE = 7;
const FOCUS_RATE = 3.4;

function clampRatio(value) {
  return Math.min(Math.max(value, 0), 1);
}

// `focus` is an optional point the camera should look at instead of the player -
// the tutorial pans to the tiger's line with it - and null (the whole campaign)
// means "follow the chariot".
export function updateCamera({ player, world, view, camera, focus = null }, delta) {
  const target = focus ?? player;
  const targetX = Math.max(0, Math.min(world.width - view.width, target.x - view.width / 2));
  const targetY = Math.max(0, Math.min(world.height - view.height, target.y - view.height / 2));
  if (!Number.isFinite(camera.x) || !Number.isFinite(camera.y)
    || !Number.isFinite(targetX) || !Number.isFinite(targetY)) {
    camera.x = Number.isFinite(targetX) ? targetX : 0;
    camera.y = Number.isFinite(targetY) ? targetY : 0;
    return;
  }
  const step = Number.isFinite(delta) ? Math.min(Math.max(delta, 0), MAX_DELTA) : 0;
  const easing = clampRatio(1 - Math.exp(-(focus ? FOCUS_RATE : FOLLOW_RATE) * step));
  camera.x += (targetX - camera.x) * easing;
  camera.y += (targetY - camera.y) * easing;
}
