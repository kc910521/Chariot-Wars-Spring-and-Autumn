// The only part of the launch query the engine needs, behind a host seam. The
// mini-game build implements the same `launchQuery()` on top of
// `wx.getLaunchOptionsSync().query`; this one reads `?seed=` and `?reset=1` from
// the URL. Both return a plain object, so nothing above this layer knows which
// runtime it is on, and a host without `URLSearchParams` degrades to a random
// seed and no reset instead of failing to boot.
export function launchQuery() {
  try {
    const search = globalThis.location?.search;
    if (typeof search !== "string" || search.length === 0) return {};
    if (typeof URLSearchParams !== "function") return {};
    const params = new URLSearchParams(search);
    const query = {};
    const seed = params.get("seed");
    if (seed !== null) query.seed = seed;
    // A developer switch: clear the post-victory rest for this boot only.
    const reset = params.get("reset");
    if (reset !== null) query.reset = reset;
    return query;
  } catch (error) {
    console.warn("[chariot-wars] could not read the launch query", error);
    return {};
  }
}
