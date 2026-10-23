// Deterministic pseudo-random numbers (Mulberry32). Gameplay systems take a
// generator instead of calling Math.random so a battle can be replayed from
// its seed, while visual jitter can stay non-deterministic.

// Seeds come from the launch query (`?seed=42` on the web, the `seed` field of
// `wx.getLaunchOptionsSync().query` in 小游戏). Parsing stays pure here: the
// platform layer reads the raw value, so nothing under src/utils touches `wx`.
export function parseSeed(rawSeed) {
  if (rawSeed === null || rawSeed === undefined) return null;
  const seed = Number.parseInt(String(rawSeed), 10);
  return Number.isFinite(seed) ? seed >>> 0 : null;
}

export function createRandomSeed(rawSeed = null) {
  const requestedSeed = parseSeed(rawSeed);
  if (requestedSeed !== null) return requestedSeed;
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

// Mulberry32: 32-bit state, one arithmetic step per call, deterministic.
export function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
