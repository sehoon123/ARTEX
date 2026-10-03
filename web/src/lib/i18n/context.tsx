"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Locale = "en" | "ko";

// Chinese text is used as-is for zh; for en/ko we look up in these maps.
import en from "./en.json";
import ko from "./ko.json";

const maps: Record<string, Record<string, string>> = { en, ko };

const STORAGE_KEY = "artex_locale";

function detectLocale(): Locale {
  if (typeof window === "undefined") return "en";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "ko") return stored;
  const nav = navigator.language.toLowerCase();
  if (nav.startsWith("ko")) return "ko";
  return "en";
}

interface I18nCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  /** Translate Chinese key to current locale. Returns key if no translation found. */
  t: (zh: string, params?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => setLocaleState(detectLocale()), []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem(STORAGE_KEY, l);
  }, []);

  const t = useCallback(
    (zh: string, params?: Record<string, string | number>): string => {
      let str = maps[locale]?.[zh] ?? zh;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          str = str.replaceAll(`{${k}}`, String(v));
        }
      }
      return str;
    },
    [locale],
  );

  return <Ctx.Provider value={{ locale, setLocale, t }}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be inside I18nProvider");
  return ctx;
}

/** Shorthand: just the t() function */
export function useT() {
  return useI18n().t;
}
