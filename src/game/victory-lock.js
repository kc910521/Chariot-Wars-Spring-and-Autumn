import { storage as platformStorage } from "../platform/storage.js";

// The post-victory rest: after the final stage is won, the campaign refuses to
// start again for a while. The state is one number in local storage, written the
// moment the victory card appears, so it survives a reload, a closed tab and a
// browser restart — and it needs no server, which is why it can be bypassed by
// changing the device clock or clearing the site's storage. It is a pacing
// device, not an anti-cheat measure.
export const VICTORY_LOCK_KEY = "chariot-wars.victory.v1";

// Minutes rather than milliseconds, because this is the single number that gets
// changed while walking the flow on a real device. 24 * 60 is the shipped rule;
// the build currently in hand uses one minute so the whole lock — locked card,
// countdown, expiry, the next run — can be watched in one sitting. Set it to
// `24 * 60` to ship.
export const VICTORY_LOCK_MINUTES = 1;
export const VICTORY_LOCK_MS = VICTORY_LOCK_MINUTES * 60 * 1000;

// A record that claims a victory further in the future than this is a clock that
// moved backwards (or a tampered payload). Treating it as "no record" means a
// skewed clock can cost the player a lock, never a permanent one.
const CLOCK_SKEW_TOLERANCE_MS = 60 * 1000;

// The payload is validated field by field: it is written by this game but read
// from storage that anything on the device can touch, and a corrupt value must
// unlock the campaign rather than break the boot.
export function parseVictoryRecord(raw) {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch (error) {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const wonAt = Number(value.wonAt);
  if (!Number.isFinite(wonAt) || wonAt <= 0) return null;
  return {
    wonAt,
    name: typeof value.name === "string" ? value.name : "",
    stage: Number.isFinite(Number(value.stage)) ? Number(value.stage) : 0,
    score: Number.isFinite(Number(value.score)) ? Number(value.score) : 0,
  };
}

// A small state machine over one storage key. `now` and `windowMs` are injected
// so a test can walk a 24h window in a few lines and so the same module would
// serve a different rule later.
export function createVictoryLock({
  storage = platformStorage, now = () => Date.now(), windowMs = VICTORY_LOCK_MS,
} = {}) {
  let record = null;
  let loaded = false;

  // Re-read from storage. Called when the menu opens, never per frame: the
  // countdown itself is computed from the cached timestamp and the clock.
  function refresh() {
    storage.invalidate?.(VICTORY_LOCK_KEY);
    record = parseVictoryRecord(storage.get(VICTORY_LOCK_KEY));
    loaded = true;
    return record;
  }

  function summary() {
    if (!loaded) refresh();
    return record;
  }

  function elapsedMs() {
    const current = summary();
    if (!current) return null;
    const elapsed = now() - current.wonAt;
    if (elapsed < -CLOCK_SKEW_TOLERANCE_MS) return null;
    return Math.max(0, elapsed);
  }

  function remainingMs() {
    const elapsed = elapsedMs();
    if (elapsed === null) return 0;
    return Math.max(0, windowMs - elapsed);
  }

  // Anchored to the first victory: a second call while the window is still
  // running keeps the original timestamp instead of extending the wait.
  function lock(values = {}) {
    if (remainingMs() > 0) return false;
    const payload = {
      v: 1,
      wonAt: now(),
      name: String(values.name ?? ""),
      stage: Number(values.stage ?? 0) || 0,
      score: Number(values.score ?? 0) || 0,
    };
    storage.set(VICTORY_LOCK_KEY, payload);
    record = payload;
    loaded = true;
    return true;
  }

  // The gate in front of a new run: true when the campaign may start. Expiry is
  // also the one moment the key is deleted, so storage does not keep a dead
  // record forever.
  function releaseIfExpired() {
    if (remainingMs() > 0) return false;
    if (record) {
      storage.remove(VICTORY_LOCK_KEY);
      record = null;
    }
    return true;
  }

  // `?reset=1` on launch: a developer switch, documented in the README. It clears
  // the record for one boot and nothing else.
  function reset() {
    storage.remove(VICTORY_LOCK_KEY);
    record = null;
    loaded = true;
  }

  return { refresh, lock, remainingMs, summary, releaseIfExpired, reset };
}
