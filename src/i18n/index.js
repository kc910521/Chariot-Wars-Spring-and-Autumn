import zhCN from "../assets/i18n/zh-CN.json" with { type: "json" };
import en from "../assets/i18n/en.json" with { type: "json" };
import { defaultLocale, registerLocale, supportedLocales, translator } from "./locales.js";

// The resource files are the only place copy lives; the registry stays data-free
// so it can be imported on its own (tests, tooling) and so adding a locale means
// dropping in a JSON file and one line here.
const resourceTables = { "zh-CN": zhCN, en };
for (const [locale, table] of Object.entries(resourceTables)) {
  registerLocale(locale, table);
}

const storageKey = "chariot-wars.locale";
let currentLocale = readSavedLocale();

function readSavedLocale() {
  const savedLocale = window.localStorage.getItem(storageKey);
  return Object.hasOwn(supportedLocales, savedLocale) ? savedLocale : defaultLocale;
}

export function getLocale() {
  return currentLocale;
}

export function setLocale(locale) {
  if (!Object.hasOwn(supportedLocales, locale)) {
    throw new RangeError(`Unsupported locale: ${locale}`);
  }
  currentLocale = locale;
  window.localStorage.setItem(storageKey, locale);
  document.documentElement.lang = locale;
  return currentLocale;
}

export function translate(key, values = {}) {
  return translator(currentLocale)(key, values);
}

export function applyTranslations(root = document) {
  for (const element of root.querySelectorAll("[data-i18n]")) {
    element.textContent = translate(element.dataset.i18n);
  }
  for (const element of root.querySelectorAll("[data-i18n-aria-label]")) {
    element.setAttribute("aria-label", translate(element.dataset.i18nAriaLabel));
  }
  for (const element of root.querySelectorAll("[data-i18n-title]")) {
    element.setAttribute("title", translate(element.dataset.i18nTitle));
  }
  for (const element of root.querySelectorAll("[data-i18n-content]")) {
    element.setAttribute("content", translate(element.dataset.i18nContent));
  }
  document.title = translate("app.title");
  document.documentElement.lang = currentLocale;
}
