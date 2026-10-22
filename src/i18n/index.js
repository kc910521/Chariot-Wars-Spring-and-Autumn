import { defaultLocale, locales } from "./locales.js";

const storageKey = "chariot-wars.locale";
let currentLocale = readSavedLocale();

function readSavedLocale() {
  const savedLocale = window.localStorage.getItem(storageKey);
  return Object.hasOwn(locales, savedLocale) ? savedLocale : defaultLocale;
}

export function getLocale() {
  return currentLocale;
}

export function setLocale(locale) {
  if (!Object.hasOwn(locales, locale)) {
    throw new RangeError(`Unsupported locale: ${locale}`);
  }
  currentLocale = locale;
  window.localStorage.setItem(storageKey, locale);
  document.documentElement.lang = locale;
  return currentLocale;
}

export function translate(key, values = {}) {
  const message = locales[currentLocale][key] ?? locales[defaultLocale][key];
  if (message === undefined) {
    throw new Error(`Missing translation key: ${key}`);
  }
  return message.replace(/\{(\w+)\}/g, (placeholder, name) => {
    if (!Object.hasOwn(values, name)) {
      throw new Error(`Missing value "${name}" for translation "${key}"`);
    }
    return String(values[name]);
  });
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
