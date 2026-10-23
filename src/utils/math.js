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
