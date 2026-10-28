// Rule tables are read every frame and nothing should ever write back into them.
// Freezing once, recursively, turns a stray write into a throw at the line that
// did it instead of a mystery that only shows up three frames later.
export function deepFreeze(value) {
  for (const key of Object.keys(value)) {
    if (value[key] && typeof value[key] === "object") deepFreeze(value[key]);
  }
  return Object.freeze(value);
}
