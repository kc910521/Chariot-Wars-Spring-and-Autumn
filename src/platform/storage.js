// Storage facade. The game asks for a value and gets a plain JS value back; it
// never learns whether that value came from local storage, a file, or (one day)
// a web service. Everything that touches the backing store is one driver
// object, so swapping it changes nothing above this file.
//
// Driver contract — synchronous and best-effort:
//   read(key)         -> stored value | null
//   write(key, value) -> void
//   erase(key)        -> void
//
// A service-backed driver cannot answer `read` synchronously, so it keeps the
// last snapshot it fetched in memory: `hydrate()` fills the cache when the fetch
// lands (on boot, on `visibilitychange`), writes go out through `write` in the
// background, and `snapshot()` is what such a driver uploads. Until then reads
// answer from the cache, which is why the facade caches at all.
//
// `invalidate(key)` drops a cached entry so the next read re-hits the driver —
// the victory lock uses it to notice a change made outside this process (another
// tab, the devtools console, a finished upload).
function warn(action, key, error) {
  console.warn(`[chariot-wars] storage ${action} failed for "${key}"`, error);
}

export function createStorage({ driver, onError = warn } = {}) {
  if (!driver) throw new Error("createStorage needs a driver.");
  const cache = new Map();

  function get(key, fallback = null) {
    if (cache.has(key)) {
      const cached = cache.get(key);
      return cached === null ? fallback : cached;
    }
    let value = null;
    try {
      value = driver.read(key);
    } catch (error) {
      onError("read", key, error);
    }
    // A key that was never stored answers `null`; do not cache a value the
    // driver could not produce as if it were real.
    if (value === undefined || value === "") value = null;
    cache.set(key, value);
    return value === null ? fallback : value;
  }

  function set(key, value) {
    cache.set(key, value);
    try {
      driver.write(key, value);
    } catch (error) {
      onError("write", key, error);
    }
  }

  function remove(key) {
    cache.delete(key);
    try {
      driver.erase(key);
    } catch (error) {
      onError("erase", key, error);
    }
  }

  // Replace the cached values wholesale: the entry point for a driver that
  // fetched its state over the network.
  function hydrate(entries) {
    for (const key of Object.keys(entries || {})) cache.set(key, entries[key]);
  }

  function invalidate(key) {
    if (key === undefined) cache.clear();
    else cache.delete(key);
  }

  function snapshot() {
    const entries = {};
    for (const [key, value] of cache) entries[key] = value;
    return entries;
  }

  return { get, set, remove, hydrate, invalidate, snapshot };
}

// The shipped driver: `window.localStorage`, keyed exactly as written. It is the
// only place in the project that names the Web Storage API.
//
// Two platform facts shape it. Storage holds UTF-16 strings only, so a payload
// written here is JSON text and the reader parses it back. And the property
// itself can throw — a `file:` or `data:` origin raises `SecurityError`, a
// browser with storage blocked raises it too — so every access goes through
// `store()` and is allowed to fail into the facade's handler instead of taking
// the boot with it.
function store() {
  try {
    // `window` first: in a browser the two are the same object, and in Node the
    // bare `globalThis.localStorage` getter warns unless the runtime was started
    // with a storage file.
    if (globalThis.window?.localStorage) return globalThis.window.localStorage;
    return globalThis.localStorage ?? null;
  } catch (error) {
    return null;
  }
}

function eraseKey(key) {
  const storage = store();
  if (!storage) return;
  // A host without `removeItem` still has a way to forget: an empty string is
  // what the facade already reads as "no value".
  if (typeof storage.removeItem === "function") storage.removeItem(key);
  else storage.setItem(key, "");
}

export const localStorageDriver = {
  read(key) {
    const storage = store();
    return storage ? storage.getItem(key) : null;
  },
  write(key, value) {
    // `JSON.stringify(undefined)` is `undefined`, which `setItem` would store as
    // the string "undefined"; a missing value is an erased key instead.
    if (value === undefined) {
      eraseKey(key);
      return;
    }
    const storage = store();
    if (!storage) return;
    storage.setItem(key, JSON.stringify(value));
  },
  erase(key) {
    eraseKey(key);
  },
};

export const storage = createStorage({ driver: localStorageDriver });
