export function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function distanceBetween(firstX, firstY, secondX, secondY) {
  return Math.hypot(secondX - firstX, secondY - firstY);
}

// Signed shortest turn from `from` to `to`, in (-pi, pi]. The modulo form is used
// for per-frame use: no libm calls and no allocation, unlike the atan2(sin, cos)
// identity that steering uses (kept as-is there, because its tests pin the exact
// rounding of every turn).
export function shortestAngleDifference(from, to) {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  else if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

// Positional hash in [0, 1): the ground painter scatters its flecks of soil with
// this, and the grass painter its blades, so a given patch of field looks the
// same on every frame and on every run - nothing here is `Math.random`, which is
// what keeps a draw trace (H5_TRACE_DRAW) comparable between two refactors.
// `salt` separates the rolls taken at one point (height, lean, tone, ...).
export function hashNoise(x, y, salt = 0) {
  const value = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return value - Math.floor(value);
}
