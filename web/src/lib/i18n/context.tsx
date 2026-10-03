"use client";

import { createContext, useContext, type ReactNode } from "react";

export type Locale = "en" | "ko";

// Chinese text is the lookup key; for en/ko we resolve via these maps.
import en from "./en.json";
import ko from "./ko.json";

const maps: Record<string, Record<string, string>> = { en, ko };

const STORAGE_KEY = "artex_locale";

function detectLocale(): Locale {
  if (typeof window === "undefined") return "en"; // static-export prerender
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "ko") return stored;
    return navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
  } catch {
    return "en";
  }
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
  let str = maps[currentLocale]?.[zh] ?? zh;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replaceAll(`{${k}}`, v == null ? "" : String(v));
    }
  }
  return str;
}

export function getLocale(): Locale {
  return currentLocale;
}

interface I18nCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: typeof tr;
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const setLocale = (l: Locale) => {
    if (l === currentLocale) return;
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
    currentLocale = l;
    // Full reload so module-level constants (label maps, option arrays) that
    // called tr() at import time re-evaluate under the new locale.
    window.location.reload();
  };

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
