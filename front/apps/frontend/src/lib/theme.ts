"use client";

import { useSyncExternalStore } from "react";

/**
 * Theme: Light / Dark / System (default).
 *
 * The choice is stored in localStorage. The inline script in layout.tsx (THEME_SCRIPT) applies it
 * to <html data-theme> before the first paint, so there's no light flash; React only reads it.
 * With "system", the OS setting is followed live; with an explicit choice, OS changes are ignored.
 * Changing the theme only touches <html> attributes, so page state and typed text are untouched.
 */
import { DARK_QUERY, THEME_COLOR, THEME_KEY, type ResolvedTheme, type ThemePref } from "./theme-script";
export type { ResolvedTheme, ThemePref } from "./theme-script";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function readPref(): ThemePref {
  const p = document.documentElement.getAttribute("data-theme-pref");
  return p === "light" || p === "dark" ? p : "system";
}
function resolve(p: ThemePref): ResolvedTheme {
  return p === "dark" || (p === "system" && window.matchMedia(DARK_QUERY).matches) ? "dark" : "light";
}

function apply(pref: ThemePref) {
  const root = document.documentElement;
  const theme = resolve(pref);
  const changed = root.getAttribute("data-theme") !== theme;
  // Recolour everything in one frame instead of letting each element's transition run.
  if (changed) root.classList.add("theme-switching");
  root.setAttribute("data-theme", theme);
  root.setAttribute("data-theme-pref", pref);
  root.style.colorScheme = theme;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", THEME_COLOR[theme]));
  if (changed) {
    void root.offsetHeight; // commit the new colours with transitions off
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
  }
  notify();
}

/** Re-applies the current choice without a recolour, e.g. to sync <meta name="theme-color">. */
export function syncTheme() {
  apply(readPref());
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* private mode: the choice still applies to this page */
  }
  apply(pref);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (listeners.size === 1) {
    mql = window.matchMedia(DARK_QUERY);
    mql.addEventListener("change", onSystemChange);
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) {
      mql?.removeEventListener("change", onSystemChange);
      window.removeEventListener("storage", onStorage);
    }
  };
}
let mql: MediaQueryList | null = null;
// Only "system" follows the OS.
const onSystemChange = () => {
  if (readPref() === "system") apply("system");
};
// Another tab changed the choice.
const onStorage = (e: StorageEvent) => {
  if (e.key !== THEME_KEY && e.key !== null) return;
  const v = e.newValue;
  apply(v === "light" || v === "dark" ? v : "system");
};

const snapshot = () => `${readPref()}|${document.documentElement.getAttribute("data-theme") ?? "light"}`;
// The server can't know the theme; hydration renders this, then React re-renders with the real one.
const serverSnapshot = () => "system|light";

export function useTheme(): { pref: ThemePref; theme: ResolvedTheme; setPref: (p: ThemePref) => void } {
  const [pref, theme] = useSyncExternalStore(subscribe, snapshot, serverSnapshot).split("|") as [ThemePref, ResolvedTheme];
  return { pref, theme, setPref: setThemePref };
}
