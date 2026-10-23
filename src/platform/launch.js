// The only part of the launch query the engine needs, behind a host seam. The
// mini-game build implements the same `launchQuery()` on top of
// `wx.getLaunchOptionsSync().query`; this one reads `?seed=` from the URL. Both
// return a plain object, so nothing above this layer knows which runtime it is
// on, and a host without `URLSearchParams` degrades to a random seed instead of
// failing to boot.
export function launchQuery() {
  try {
    const search = globalThis.location?.search;
    if (typeof search !== "string" || search.length === 0) return {};
    if (typeof URLSearchParams !== "function") return {};
    const seed = new URLSearchParams(search).get("seed");
    return seed === null ? {} : { seed };
  } catch (error) {
    console.warn("[chariot-wars] could not read the launch query", error);
    return {};
  }
}
