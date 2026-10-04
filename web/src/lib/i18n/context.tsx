"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Locale = "en" | "ko";

// Chinese text is the lookup key; for en/ko we resolve via these maps.
import en from "./en.json";
import ko from "./ko.json";

const maps: Record<Locale, Record<string, string>> = { en, ko };

const STORAGE_KEY = "artex_locale";

function detectLocale(): Locale {
  if (typeof window === "undefined") return "en"; // static-export prerender
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "ko") return stored;
  } catch {
    // Storage can be blocked even when the browser language is available.
  }
  return navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
}

// Resolved once at module load (synchronously from localStorage on the client).
// Because every other module imports `tr` from here, this i18n module initializes
// first, so module-level label maps that call tr() at import time get the right
// locale too. Changing locale does a full reload (see setLocale) so those
// module-level constants re-evaluate.
let currentLocale: Locale = detectLocale();

/** Translate a Chinese key to the current locale. Returns the key unchanged if
 *  no translation exists (graceful fallback → original Chinese).
 *  Named `tr` (not `t`) to avoid collisions with the many local `t` variables
 *  (loop callbacks, setTimeout handles, Tool params) throughout the codebase. */
export function tr(
  zh: string,
  params?: Record<string, string | number | boolean | null | undefined>,
): string {
  const dict = maps[currentLocale];
  const str = Object.hasOwn(dict, zh) ? dict[zh] : zh;
  if (!params) return str;
  // One pass, with a function replacement: values containing $& or {n1} stay literal.
  return str.replace(/\{([^{}]+)\}/g, (match, key: string) =>
    Object.hasOwn(params, key) ? (params[key] == null ? "" : String(params[key])) : match,
  );
}

export function getLocale(): Locale {
  return currentLocale;
}

interface I18nCtx {
  locale: Locale;
  setLocale: (l: Locale) => boolean | null; // null: user cancelled; false: persistence failed.
  t: typeof tr;
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    document.documentElement.lang = currentLocale;
    setReady(true);
  }, []);

  const setLocale = (l: Locale): boolean | null => {
    if (l !== "en" && l !== "ko") return false;
    if (l === currentLocale) return true;
    // ponytail: warn on every reload; track dirty forms only if this becomes noisy.
    if (!window.confirm(tr("切换语言会重新加载页面，未保存的更改将丢失。是否继续？"))) return null;
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      return false; // Do not reload into a different locale when persistence failed.
    }
    currentLocale = l;
    // Full reload also refreshes labels translated at module initialization.
    window.location.reload();
    return true;
  };

  // Static HTML and the first client render must agree, even for saved Korean.
  if (!ready) return null;
  return <Ctx.Provider value={{ locale: currentLocale, setLocale, t: tr }}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be inside I18nProvider");
  return ctx;
}

/** Back-compat: returns the plain translation function. */
export function useT() {
  return tr;
}
