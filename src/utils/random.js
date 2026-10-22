// Deterministic pseudo-random numbers (Mulberry32). Gameplay systems take a
// generator instead of calling Math.random so a battle can be replayed from
// its seed, while visual jitter can stay non-deterministic.
export function createRandomSeed() {
  const requestedSeed = readSeedFromUrl();
  if (requestedSeed !== null) return requestedSeed;
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

// `?seed=1234` pins every battle of the session, which makes a run easy to
// reproduce for QA, bug reports, and the headless smoke test.
function readSeedFromUrl() {
  const search = globalThis.location?.search;
  if (typeof search !== "string" || search.length === 0) return null;
  const rawSeed = new URLSearchParams(search).get("seed");
  if (rawSeed === null) return null;
  const seed = Number.parseInt(rawSeed, 10);
  return Number.isFinite(seed) ? seed >>> 0 : null;
}

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
