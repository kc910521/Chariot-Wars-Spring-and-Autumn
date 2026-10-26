// Locale registry + translation logic. No translation strings live here;
// they are loaded from ./resources/<locale>.json.

export const defaultLocale = "zh-CN";

// Supported locales and their display names. Adding a locale = add an entry
// here + a resources/<locale>.json file.
export const supportedLocales = Object.freeze({
  "zh-CN": { name: "简体中文" },
  en: { name: "English" },
});

const resources = new Map(); // locale -> frozen translation table
const cache = new Map();     // locale -> bound t()

/**
 * Register a translation table for a locale.
 * Called once per locale at startup (e.g. from main.js after importing the JSON).
 * Tables are frozen so a stray write can't mutate shared resources.
 */
export function registerLocale(locale, table) {
  if (!supportedLocales[locale]) {
    throw new Error(`Unknown locale: ${locale}`);
  }
  resources.set(locale, Object.freeze({ ...table }));
}

/**
 * Interpolate {name} placeholders. Missing keys in `params` are left verbatim
 * so a broken call is visible rather than silently blank.
 */
function interpolate(template, params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in params ? String(params[key]) : match
  );
}

/**
 * Look up `key` in `locale`, falling back to the default locale, then to the
 * key itself. Keeps a missing translation from crashing the UI.
 */
function lookup(locale, key) {
  const table = resources.get(locale);
  if (table && key in table) return table[key];

  if (locale !== defaultLocale) {
    const fallback = resources.get(defaultLocale);
    if (fallback && key in fallback) return fallback[key];
  }
  return key;
}

/**
 * Returns a `t(key, params?)` bound to `locale`. Cached per locale so callers
 * don't allocate a new closure every frame.
 */
export function translator(locale = defaultLocale) {
  const resolved = supportedLocales[locale] ? locale : defaultLocale;
  if (cache.has(resolved)) return cache.get(resolved);

  const t = (key, params) => interpolate(lookup(resolved, key), params);
  cache.set(resolved, t);
  return t;
}

/** True if a translation exists for `key` in `locale` (not the key fallback). */
export function hasTranslation(locale, key) {
  const table = resources.get(locale);
  return Boolean(table && key in table);
}

/** All keys present in any registered table — useful for completeness tests. */
export function allKeys() {
  const keys = new Set();
  for (const table of resources.values()) {
    for (const key of Object.keys(table)) keys.add(key);
  }
  return [...keys];
}