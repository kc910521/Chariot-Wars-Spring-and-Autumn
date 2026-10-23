// The only browser global the gameplay modules touch at *import time* is the
// saved locale (`src/i18n/index.js` reads `window.localStorage` while the module
// evaluates). `combat.js` imports it for its banner text, so a test that drives
// the combat system needs this stub to be in place before those modules load -
// which is why `unit-test.mjs` imports this file first.
if (globalThis.window === undefined) {
  globalThis.window = {
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
  };
}
