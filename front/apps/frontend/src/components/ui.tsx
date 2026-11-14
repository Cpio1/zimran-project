"use client";

import clsx from "clsx";
import Link from "next/link";
import { cloneElement, forwardRef, isValidElement, useCallback, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { AlertCircle, AlertTriangle, Check, ChevronRight, Info, Loader2, MoreHorizontal, X, type LucideIcon } from "lucide-react";
import type { Parsed } from "@/lib/format";
import { describeError } from "@/api/errors";
import { useStageCue } from "./motion";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtleDanger";
/**
 * `root` styles the label (it never transforms); `surface` styles the background layer,
 * which squashes on press (see .squish-surface in globals.css). Bordered variants keep a
 * transparent 1px border on the root so the box size matches the unbordered ones exactly.
 */
const variants: Record<Variant, { root: string; surface: string }> = {
  primary: { root: "text-on-accent", surface: "inset-0 bg-accent group-hover:bg-accent-hover group-disabled:bg-accent/50" },
  secondary: { root: "border border-transparent text-ink disabled:text-muted", surface: "-inset-px border border-line bg-surface group-hover:bg-subtle" },
  ghost: { root: "text-ink disabled:text-muted", surface: "inset-0 group-hover:bg-subtle-strong" },
  danger: { root: "border border-transparent text-red-700", surface: "-inset-px border border-red-200 bg-surface group-hover:bg-red-50" },
  /** A destructive action that must not compete with a dialog's main action. */
  subtleDanger: { root: "text-red-700 disabled:text-red-700/50", surface: "inset-0 group-hover:bg-red-50" },
};
/**
 * md is 44 px (the default target size, matching fields); sm is 32 px with a 44 px target
 * (.hit-y) — rows that wrap sm controls keep ≥ 12 px between lines so targets never overlap.
 */
const sizes = { sm: "hit-y h-8 px-3 text-sm", md: "h-11 px-4 text-sm", lg: "h-12 px-5 text-base" };
const buttonBase = "group relative isolate inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium";
const Surface = ({ variant }: { variant: Variant }) => (
  <span aria-hidden className={clsx("squish-surface pointer-events-none absolute -z-10 rounded-[inherit]", variants[variant].surface)} />
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: keyof typeof sizes;
  loading?: boolean;
  icon?: ReactNode;
  /**
   * Staging: true while this is the next action the current state asks for. When it turns true
   * (not on mount) the button plays one short attention cue; see useStageCue.
   */
  cue?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, cue, className, children, disabled, type = "button", ...rest },
  ref,
) {
  const playCue = useStageCue(!!cue && !disabled && !loading);
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-squish=""
      data-variant={variant}
      data-size={size}
      data-stage-cue={playCue || undefined}
      className={clsx(buttonBase, "disabled:cursor-not-allowed", variants[variant].root, sizes[size], className)}
      {...rest}
    >
      <Surface variant={variant} />
      {/* Doherty: the press pose, disabled state and aria-busy are immediate; the spinner joins after 120 ms. */}
      {loading ? <Loader2 className="spin-delayed size-4" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function ButtonLink({ href, variant = "secondary", size = "md", icon, cue, cueDelayMs, className, children }: { href: string; variant?: Variant; size?: keyof typeof sizes; icon?: ReactNode; cue?: boolean; cueDelayMs?: number; className?: string; children: ReactNode }) {
  const playCue = useStageCue(!!cue, cueDelayMs);
  return (
    <Link href={href} data-squish="" data-variant={variant} data-size={size} data-stage-cue={playCue || undefined} className={clsx(buttonBase, variants[variant].root, sizes[size], className)}>
      <Surface variant={variant} />
      {icon}
      {children}
    </Link>
  );
}

/**
 * Icon-only control. The glyph keeps its visual size; the box is 44 × 44 so it's easy to hit
 * (Fitts), and negative margins (`bleed`) let it sit in tight rows without moving the layout.
 * The accessible name is required.
 */
export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; glyph?: string; bleed?: boolean; tone?: "muted" | "danger" | "inherit" }>(function IconButton(
  { icon: Icon, label, glyph = "size-4", bleed, tone = "muted", className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      data-squish=""
      className={clsx(
        "squish-icon grid size-11 shrink-0 place-items-center rounded-lg disabled:cursor-not-allowed disabled:opacity-50",
        bleed && "-m-2.5",
        tone === "muted" && "text-muted hover:bg-subtle-strong hover:text-ink",
        tone === "danger" && "text-red-700 hover:bg-red-50",
        tone === "inherit" && "hover:bg-current/10",
        className,
      )}
      {...rest}
    >
      <Icon className={glyph} aria-hidden />
    </button>
  );
});

/**
 * Overflow menu (Hick): secondary actions grouped behind one "More" button. Familiar keyboard
 * behaviour (Jakob): Enter/Space/↓ opens and focuses the first item, ↑/↓/Home/End move, Escape
 * or Tab closes and returns focus to the button, a click outside closes.
 */
export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Set on every item to make the menu a single choice (menuitemradio). */
  checked?: boolean;
}
export function Menu({ label, items, icon = MoreHorizontal, placement = "bottom-end", glyph }: { label: string; items: MenuItem[]; icon?: LucideIcon; placement?: "bottom-end" | "top-start"; glyph?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const itemsEls = () => Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? []);
  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  }, []);
  useEffect(() => {
    if (!open) return;
    const els = itemsEls();
    (els.find((el) => el.getAttribute("aria-checked") === "true") ?? els[0])?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !btn.current?.contains(t)) close(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open, close]);
  const onKey = (e: React.KeyboardEvent) => {
    const els = itemsEls();
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "Tab") close(false);
    else if (e.key === "ArrowDown") { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); els[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); els[els.length - 1]?.focus(); }
  };
  if (!items.length) return null;
  return (
    <div className="relative">
      <IconButton
        ref={btn}
        icon={icon}
        label={label}
        glyph={glyph}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); }
        }}
      />
      {open && (
        <div
          ref={list}
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={onKey}
          className={clsx(
            "menu-in elev-2 absolute z-40 flex min-w-48 flex-col rounded-xl border border-line bg-surface p-1",
            placement === "bottom-end" ? "right-0 top-full mt-1" : "bottom-full left-0 mb-1 origin-bottom-left",
          )}
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role={it.checked === undefined ? "menuitem" : "menuitemradio"}
              aria-checked={it.checked}
              disabled={it.disabled}
              onClick={() => { close(); it.onSelect(); }}
              className={clsx(
                "flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-left text-sm disabled:opacity-50",
                it.danger ? "text-red-700 hover:bg-red-50 focus-visible:bg-red-50" : "text-ink hover:bg-subtle-strong focus-visible:bg-subtle-strong",
              )}
            >
              {it.icon && <it.icon className="size-4 shrink-0" aria-hidden />}
              <span className="flex-1">{it.label}</span>
              {it.checked && <Check className="size-4 shrink-0 text-brand-600" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Turns a lenient parse (Postel) into Field props: the normalised value as a hint when the
 * input was reformatted, the explanation as an error, or the readings to choose from when the
 * input is ambiguous. The typed text itself is never changed behind the user's back.
 */
export function parsedField<T>(raw: string, parsed: Parsed<T>, onPick: (display: string) => void): { error: string | null; hint?: ReactNode } {
  if (parsed.kind === "invalid") return { error: parsed.message };
  if (parsed.kind === "ambiguous") {
    return {
      error: null,
      hint: (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-3 text-amber-800">
          <span>{parsed.message}</span>
          {parsed.options.map((o) => (
            <button key={o.display} type="button" onClick={() => onPick(o.display)} className="hit-y inline-flex h-8 items-center rounded-full border border-amber-300 bg-amber-50 px-3 font-medium hover:bg-amber-100">
              {o.display}
            </button>
          ))}
        </span>
      ),
    };
  }
  if (parsed.kind === "ok" && parsed.display !== raw.trim()) return { error: null, hint: <>Saved as <strong className="font-medium text-ink">{parsed.display}</strong></> };
  return { error: null };
}

/**
 * Filters that narrow one list (Jakob): a group of toggle buttons with aria-pressed — not tabs,
 * because nothing is swapped in. Each button is a normal Tab stop, as the platform expects.
 * `look="pills"` for a scrollable row, `look="segmented"` for a compact switch. 44 px on touch.
 */
export function FilterButtons<T extends string>({ label, options, value, onChange, look = "pills", className }: { label: string; options: { value: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; look?: "pills" | "segmented"; className?: string }) {
  return (
    // Pills: a scrolling row clips anything outside it, so callers give it 6 px vertical padding
    // (the 44 px targets fit inside) and wrapped lines keep 12 px apart.
    <div role="group" aria-label={label} className={clsx(look === "pills" ? "flex gap-x-1.5 gap-y-3" : "flex gap-1 rounded-lg bg-subtle-strong p-1", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={clsx(
              "min-w-11 shrink-0 text-sm transition-colors [@media(pointer:coarse)]:min-h-11",
              look === "pills" ? "hit-y rounded-full px-3 py-1.5" : "hit-y rounded-md px-3 py-1.5",
              look === "pills" && (on ? "bg-inverse text-on-inverse" : "bg-surface text-muted ring-1 ring-line hover:text-ink"),
              look === "segmented" && (on ? "elev-1 bg-surface font-medium text-ink" : "text-muted hover:text-ink"),
            )}
          >
            {o.label}
            {o.count !== undefined && <span className="ml-1.5 tabular-nums opacity-70">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Real tabs (Jakob / WAI-ARIA tabs pattern): only the selected tab is in the Tab order (roving
 * tabindex); ←/→ move and select, Home/End jump; each tab controls a tabpanel (tabPanelProps).
 */
export function Tabs<T extends string>({ id, label, tabs, value, onChange }: { id: string; label: string; tabs: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (i: number) => {
    const n = (i + tabs.length) % tabs.length;
    onChange(tabs[n].value);
    refs.current[n]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 rounded-lg bg-subtle-strong p-1">
      {tabs.map((t, i) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            id={`${id}-tab-${t.value}`}
            aria-selected={on}
            aria-controls={`${id}-panel-${t.value}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => {
              const k = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
              if (k === undefined) return;
              e.preventDefault();
              move(k);
            }}
            className={clsx("hit-y min-w-11 rounded-md px-3 py-1.5 text-sm transition-colors [@media(pointer:coarse)]:min-h-11", on ? "elev-1 bg-surface font-medium text-ink" : "text-muted hover:text-ink")}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
export const tabPanelProps = (id: string, value: string) => ({ role: "tabpanel", id: `${id}-panel-${value}`, "aria-labelledby": `${id}-tab-${value}`, tabIndex: 0 });

/**
 * Staging tones. `focus` marks the one block the current step is about, `quiet` steps supporting
 * blocks back (lighter surface, softer border) while keeping their text at full contrast.
 */
const cardTones = {
  default: "border-line bg-surface",
  quiet: "border-line/70 bg-surface-quiet",
  focus: "stage-focus border-brand-200 bg-surface",
};
export type CardTone = keyof typeof cardTones;
/** The attention cue lives on the next action's button, never on its card: one movement per context. */
export function Card({ className, children, as: As = "section", tone = "default", ...rest }: { className?: string; children: ReactNode; as?: "section" | "div" | "article" | "li"; tone?: CardTone; "aria-labelledby"?: string; "aria-label"?: string; id?: string; role?: string; tabIndex?: number }) {
  return (
    <As data-tone={tone} className={clsx("rounded-xl border", cardTones[tone], className)} {...rest}>
      {children}
    </As>
  );
}

export function SectionTitle({ title, action, id }: { title: string; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 id={id} className="text-base font-semibold">{title}</h2>
      {action}
    </div>
  );
}

const tones = {
  neutral: "bg-subtle-strong text-ink",
  brand: "bg-brand-50 text-brand-700",
  warn: "bg-amber-50 text-amber-800",
  danger: "bg-red-50 text-red-700",
  info: "bg-sky-50 text-sky-800",
};
export function Badge({ tone = "neutral", children, className }: { tone?: keyof typeof tones; children: ReactNode; className?: string }) {
  return <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", tones[tone], className)}>{children}</span>;
}
export const NeedsReview = () => <Badge tone="warn">Needs review</Badge>;

export function Field({ label, hint, error, children, htmlFor, hideLabel }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; hideLabel?: boolean }) {
  const errorId = useId();
  // An error is shown three ways: the message, a red border on the control and an icon.
  const control = error && isValidElement<{ "aria-invalid"?: boolean; "aria-describedby"?: string }>(children)
    ? cloneElement(children, { "aria-invalid": true, "aria-describedby": errorId })
    : children;
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-invalid={error ? "" : undefined}>
      <label htmlFor={htmlFor} className={hideLabel ? "sr-only" : "text-sm font-medium"}>{label}</label>
      {control}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && (
        <p id={errorId} className="feedback-in flex items-start gap-1 text-xs font-medium text-red-700" role="alert">
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}
const inputCls = "w-full min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm placeholder:text-placeholder focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-subtle";
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={clsx(inputCls, "h-11", className)} {...p} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={clsx(inputCls, className)} {...p} />;
});
/**
 * Native <select> (keeps its semantics, keyboard and the OS picker). The native look is dropped
 * (`.select-native`) because WebKit ignores height/min-height on it; the chevron is drawn in CSS.
 * 44 px, like text fields.
 */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...p }, ref) {
  return <select ref={ref} className={clsx(inputCls, "select-native h-11 pr-9", className)} {...p} />;
});

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-muted">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {label}
    </span>
  );
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-lg bg-track", className)} aria-hidden />;
}
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-20" />)}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line bg-surface px-6 py-10 text-center">
      {icon && <div className="text-brand-600">{icon}</div>}
      <p className="font-medium">{title}</p>
      {body && <div className="max-w-md text-sm text-muted">{body}</div>}
      {action}
    </div>
  );
}

export function Notice({ tone = "info", title, children, action }: { tone?: "info" | "warn" | "danger"; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const cls = { info: "border-sky-200 bg-sky-50 text-sky-900", warn: "border-amber-200 bg-amber-50 text-amber-900", danger: "border-red-200 bg-red-50 text-red-900" }[tone];
  const Icon = tone === "info" ? Info : AlertTriangle;
  return (
    <div className={clsx("flex flex-col gap-2 rounded-lg border px-3 py-2.5 text-sm sm:flex-row sm:items-start", cls, tone === "danger" && "feedback-in")} role={tone === "danger" ? "alert" : "status"}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={clsx(title && "mt-0.5", "break-words")}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function ErrorBox({ error, onRetry, onReload }: { error: unknown; onRetry?: () => void; onReload?: () => void }) {
  const d = describeError(error);
  const isConflict = d.code === "CONFLICT";
  return (
    <Notice
      tone={isConflict ? "warn" : "danger"}
      title={d.title}
      action={
        isConflict && onReload ? <Button size="sm" onClick={onReload}>Load latest</Button>
          : d.retryable && onRetry ? <Button size="sm" onClick={onRetry}>Try again</Button> : undefined
      }
    >
      <span className="text-xs opacity-75">{d.detail}</span>
    </Notice>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d || !open) return;
    // Where focus was before the dialog took it; it goes back there when the dialog closes,
    // including when the dialog is unmounted rather than closed (Safari doesn't restore it).
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!d.open) {
      d.showModal?.();
      // showModal focuses the first control, which is the close button. For a form, start in
      // the marked field or the first field instead; a plain confirmation keeps the close button.
      d.querySelector<HTMLElement>("[data-autofocus]")?.focus() ??
        d.querySelector<HTMLElement>("[data-modal-body] :is(input:not([type=hidden]), select, textarea):not(:disabled)")?.focus();
    }
    return () => {
      if (d.open) d.close?.();
      const lost = !document.activeElement || document.activeElement === document.body || d.contains(document.activeElement);
      if (opener?.isConnected && lost) opener.focus({ preventScroll: true });
    };
  }, [open]);
  useEffect(() => {
    // Staging guard: a dialog has one main action, everything else is visibly secondary.
    if (process.env.NODE_ENV === "production" || !open) return;
    const n = footerRef.current?.querySelectorAll('[data-variant="primary"]').length ?? 0;
    if (n > 1) console.warn(`[Claimly] Dialog "${title}" shows ${n} primary actions; keep one.`);
  });
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        // Jakob: Enter in a single-line field confirms the dialog, like a form. Fields inside their
        // own <form>, text areas, selects, checkboxes and IME composition keep their own Enter.
        const t = e.target as HTMLElement;
        if (e.key !== "Enter" || e.nativeEvent.isComposing || e.shiftKey || !(t instanceof HTMLInputElement)) return;
        if (["checkbox", "radio", "button", "submit", "file"].includes(t.type)) return;
        // A form with its own submit button handles Enter itself; one whose buttons live in the
        // dialog footer gets the footer's main action.
        if (t.form?.querySelector('button[type="submit"], input[type="submit"]')) return;
        const primary = footerRef.current?.querySelector<HTMLButtonElement>('[data-variant="primary"], [data-variant="danger"]');
        if (primary && !primary.disabled) {
          e.preventDefault();
          primary.click();
        }
      }}
      className={clsx("elev-3 m-auto max-h-[90dvh] w-[calc(100%-2rem)] overflow-hidden rounded-2xl border border-line bg-surface p-0 text-ink", wide ? "max-w-3xl" : "max-w-lg")}
    >
      {open && (
        <div className="dialog-in flex max-h-[90dvh] flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 id={titleId} className="min-w-0 break-words font-semibold">{title}</h2>
            <IconButton icon={X} label="Close" glyph="size-5" bleed onClick={onClose} />
          </div>
          <div data-modal-body="" className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
          {footer && (
            // Phones: full-width buttons with the main action on top; wider screens: one row, main action last (right).
            <div ref={footerRef} className="flex flex-col-reverse gap-2 border-t border-line px-4 py-3 *:w-full sm:flex-row sm:flex-wrap sm:justify-end sm:*:w-auto">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} data-squish="" className="hit-y mb-1 inline-block text-sm text-muted hover:text-ink">
            <span data-anticipate="left" aria-hidden>←</span> {back.label}
          </Link>
        )}
        <h1 className="break-words text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Details({ summary, children, defaultOpen }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    // The padding lives on <summary>, so the whole 44 px row toggles (not just the 20 px text line).
    <details className="group rounded-lg border border-line bg-subtle/60" open={defaultOpen}>
      <summary className="details-summary flex min-h-11 cursor-pointer select-none items-center rounded-lg px-3 text-sm font-medium text-ink">
        <ChevronRight className="details-chevron -ml-0.5 mr-1 size-4 shrink-0 text-muted" aria-hidden />
        {summary}
      </summary>
      <div className="px-3 pb-3 text-sm">{children}</div>
    </details>
  );
}
