export function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function distanceBetween(firstX, firstY, secondX, secondY) {
  return Math.hypot(secondX - firstX, secondY - firstY);
}
