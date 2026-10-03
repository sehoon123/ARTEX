"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Locale = "en" | "ko";

// Chinese text is the lookup key; for en/ko we resolve via these maps.
import en from "./en.json";
import ko from "./ko.json";

const maps: Record<string, Record<string, string>> = { en, ko };

// Module-level current locale. Read by the plain t() function below so that
// t() works anywhere (event handlers, toasts, module scope at render) without
// a hook. The I18nProvider forces a full subtree remount on locale change
// (via key=), so every component re-runs and re-reads the new locale.
let currentLocale: Locale = "en";

/** Translate Chinese key to the current locale. Returns the key unchanged if
 *  no translation exists (graceful fallback → original Chinese).
 *  Named `tr` (not `t`) to avoid collisions with the many local `t` variables
 *  (loop callbacks, setTimeout handles, Tool params) throughout the codebase. */
export function tr(zh: string, params?: Record<string, string | number>): string {
  let str = maps[currentLocale]?.[zh] ?? zh;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}

const STORAGE_KEY = "artex_locale";

function detectLocale(): Locale {
  if (typeof window === "undefined") return "en";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "ko") return stored;
  return navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
}

interface I18nCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: typeof tr;
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const l = detectLocale();
    currentLocale = l;
    setLocaleState(l);
  }, []);

  const setLocale = (l: Locale) => {
    currentLocale = l;
    localStorage.setItem(STORAGE_KEY, l);
    setLocaleState(l);
  };

  // key={locale} remounts the whole tree on language change so plain t() calls
  // (including those referenced in render by module-level constants) re-evaluate.
  return (
    <Ctx.Provider value={{ locale, setLocale, t: tr }}>
      <div key={locale} style={{ display: "contents" }}>
        {children}
      </div>
    </Ctx.Provider>
  );
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
