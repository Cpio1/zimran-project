"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Archive, CalendarDays, FolderKanban, Gift, Home, MessageCircle, Settings, Upload } from "lucide-react";
import type { ReactNode } from "react";
import { API_MODE } from "@/api/config";
import { ButtonLink } from "./ui";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/vault", label: "Vault", icon: Archive },
  { href: "/benefits", label: "Benefits", icon: Gift },
  { href: "/assistant", label: "Assistant", icon: MessageCircle },
  { href: "/cases", label: "Cases", icon: FolderKanban },
];
const SECONDARY = [
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
}

export function SampleModeBadge({ className }: { className?: string }) {
  if (API_MODE !== "mock") return null;
  return (
    <span title="Sample mode: data and analysis are simulated in this browser. No real AI or backend is used." className={clsx("inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900", className)}>
      Sample mode
    </span>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname() ?? "/";
  return (
    <div className="min-h-dvh">
      {/* Decorative, static page background: behind everything, no pointer events, hidden from AT. */}
      <div className="app-backdrop" aria-hidden="true" />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow">Skip to content</a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-line/80 bg-sidebar px-3 py-5 md:flex">
        <Link href="/" className="mb-1 flex items-center gap-2 px-2 text-lg font-semibold tracking-tight">
          <span className="grid size-7 place-items-center rounded-lg bg-accent text-sm text-on-accent" aria-hidden>C</span>
          Claimly
        </Link>
        <SampleModeBadge className="mx-2 mb-4 self-start" />
        {/* Staging: where the page itself is about uploading (Home's upload block, the Upload page) the
            shortcut steps back so the page's own main action stays the only accent. */}
        <ButtonLink href="/upload" variant={path === "/" || path.startsWith("/upload") ? "secondary" : "primary"} className="mx-1 mb-4" icon={<Upload className="size-4" aria-hidden />}>
          Upload document
        </ButtonLink>
        {/* Frequency of use: navigation is the most repeated action, so it answers with a colour
            change only — no squash or nudge. */}
        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {[...NAV, ...SECONDARY].map(({ href, label, icon: Icon }, i) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(path, href) ? "page" : undefined}
              className={clsx(
                "flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors",
                i === NAV.length && "mt-4",
                isActive(path, href) ? "bg-brand-50 font-medium text-brand-700" : "text-muted hover:bg-subtle-strong hover:text-ink",
              )}
            >
              <Icon className="size-4" aria-hidden /> {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex items-center justify-between gap-2 pl-2">
          <p className="text-xs text-muted">Demo space · no account needed</p>
          <ThemeToggle placement="top-start" />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-line bg-surface px-4 md:hidden">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="grid size-7 place-items-center rounded-lg bg-accent text-sm text-on-accent" aria-hidden>C</span>
          Claimly
        </Link>
        <div className="flex items-center gap-1">
          <SampleModeBadge />
          <ThemeToggle />
          {SECONDARY.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} aria-label={label} title={label} aria-current={isActive(path, href) ? "page" : undefined} className={clsx("grid size-11 place-items-center rounded-lg transition-colors", isActive(path, href) ? "bg-brand-50 text-brand-700" : "text-muted hover:bg-subtle-strong")}>
              <Icon className="size-5" aria-hidden />
            </Link>
          ))}
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-28 pt-5 md:pb-12 md:pl-64 md:pr-8 md:pt-8">
        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav aria-label="Main" className="elev-2-up fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(path, href) ? "page" : undefined}
            className={clsx("flex h-16 flex-col items-center justify-center gap-1 text-[11px] transition-colors", isActive(path, href) ? "font-semibold text-brand-700" : "text-muted")}
          >
            <Icon className="size-5" aria-hidden />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
