// Shared by the server layout (pre-paint script) and the client theme store. No "use client":
// the layout needs the actual string.

export type ThemePref = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
export const THEME_KEY = "claimly.theme";
export const DARK_QUERY = "(prefers-color-scheme: dark)";
/** Browser UI colour (address bar on mobile) per theme. */
export const THEME_COLOR: Record<ResolvedTheme, string> = { light: "#f4f7f5", dark: "#0d1311" };

/** Runs before first paint (inlined into <head>); keep it dependency-free and in sync with apply(). */
export const THEME_SCRIPT = `(function(){try{var p=null;try{p=localStorage.getItem(${JSON.stringify(THEME_KEY)})}catch(e){}if(p!=="light"&&p!=="dark")p="system";var d=p==="dark"||(p==="system"&&window.matchMedia(${JSON.stringify(DARK_QUERY)}).matches);var r=document.documentElement;r.setAttribute("data-theme",d?"dark":"light");r.setAttribute("data-theme-pref",p);r.style.colorScheme=d?"dark":"light";}catch(e){}})();`;

