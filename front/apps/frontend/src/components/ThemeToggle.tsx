"use client";

import clsx from "clsx";
import { useEffect } from "react";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { syncTheme, useTheme, type ThemePref } from "@/lib/theme";
import { Menu } from "./ui";

export const THEME_OPTIONS: { value: ThemePref; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/** Compact switch for the app chrome: one 44 px button, a three-item menu. */
export function ThemeToggle({ placement = "bottom-end" }: { placement?: "bottom-end" | "top-start" }) {
  const { pref, theme, setPref } = useTheme();
  useEffect(syncTheme, []); // align <meta name="theme-color"> with the stored choice
  const current = THEME_OPTIONS.find((o) => o.value === pref)!;
  return (
    <Menu
      label={`Theme: ${current.label}${pref === "system" ? ` (${theme})` : ""}`}
      icon={pref === "system" ? (theme === "dark" ? Moon : Sun) : current.icon}
      glyph="size-5"
      placement={placement}
      items={THEME_OPTIONS.map((o) => ({ label: o.label, icon: o.icon, checked: pref === o.value, onSelect: () => setPref(o.value) }))}
    />
  );
}

/** Full choice for Settings: a segmented radio group (arrow keys move, like native radios). */
export function ThemeSetting() {
  const { pref, theme, setPref } = useTheme();
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">Theme</legend>
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-subtle-strong p-1">
        {THEME_OPTIONS.map((o) => (
          <label
            key={o.value}
            className={clsx(
              "flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg px-2 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600",
              pref === o.value ? "elev-1 bg-surface font-medium text-ink" : "text-muted hover:text-ink",
            )}
          >
            <input type="radio" name="theme" value={o.value} checked={pref === o.value} onChange={() => setPref(o.value)} className="sr-only" />
            <o.icon className="size-4 shrink-0" aria-hidden />
            {o.label}
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">
        {pref === "system" ? `Follows your device — now ${theme}.` : "Saved on this device. System follows your device setting."}
      </p>
    </fieldset>
  );
}
