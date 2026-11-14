"use client";

import clsx from "clsx";
import Link from "next/link";
import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { AlertTriangle, ChevronRight, Info, Loader2, X } from "lucide-react";
import { describeError } from "@/api/errors";
import { useStageCue } from "./motion";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtleDanger";
/**
 * `root` styles the label (it never transforms); `surface` styles the background layer,
 * which squashes on press (see .squish-surface in globals.css). Bordered variants keep a
 * transparent 1px border on the root so the box size matches the unbordered ones exactly.
 */
const variants: Record<Variant, { root: string; surface: string }> = {
  primary: { root: "text-white", surface: "inset-0 bg-brand-600 group-hover:bg-brand-700 group-disabled:bg-brand-600/50" },
  secondary: { root: "border border-transparent text-ink disabled:text-muted", surface: "-inset-px border border-line bg-white group-hover:bg-stone-50" },
  ghost: { root: "text-ink disabled:text-muted", surface: "inset-0 group-hover:bg-stone-100" },
  danger: { root: "border border-transparent text-red-700", surface: "-inset-px border border-red-200 bg-white group-hover:bg-red-50" },
  /** A destructive action that must not compete with a dialog's main action. */
  subtleDanger: { root: "text-red-700 disabled:text-red-700/50", surface: "inset-0 group-hover:bg-red-50" },
};
const sizes = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm", lg: "h-12 px-5 text-base" };
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
      data-stage-cue={playCue || undefined}
      className={clsx(buttonBase, "disabled:cursor-not-allowed", variants[variant].root, sizes[size], className)}
      {...rest}
    >
      <Surface variant={variant} />
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function ButtonLink({ href, variant = "secondary", size = "md", icon, cue, cueDelayMs, className, children }: { href: string; variant?: Variant; size?: keyof typeof sizes; icon?: ReactNode; cue?: boolean; cueDelayMs?: number; className?: string; children: ReactNode }) {
  const playCue = useStageCue(!!cue, cueDelayMs);
  return (
    <Link href={href} data-squish="" data-variant={variant} data-stage-cue={playCue || undefined} className={clsx(buttonBase, variants[variant].root, sizes[size], className)}>
      <Surface variant={variant} />
      {icon}
      {children}
    </Link>
  );
}

/**
 * Staging tones. `focus` marks the one block the current step is about, `quiet` steps supporting
 * blocks back (lighter surface, softer border) while keeping their text at full contrast.
 */
const cardTones = {
  default: "border-line bg-white",
  quiet: "border-line/70 bg-white/60",
  focus: "stage-focus border-brand-200 bg-white",
};
export type CardTone = keyof typeof cardTones;
export function Card({ className, children, as: As = "section", tone = "default", cue, ...rest }: { className?: string; children: ReactNode; as?: "section" | "div" | "article" | "li"; tone?: CardTone; cue?: boolean; "aria-labelledby"?: string; "aria-label"?: string }) {
  const playCue = useStageCue(!!cue && tone === "focus");
  return (
    <As data-tone={tone} data-stage-cue={playCue || undefined} className={clsx("rounded-xl border", cardTones[tone], className)} {...rest}>
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
  neutral: "bg-stone-100 text-stone-700",
  brand: "bg-brand-50 text-brand-700",
  warn: "bg-amber-50 text-amber-800",
  danger: "bg-red-50 text-red-700",
  info: "bg-sky-50 text-sky-800",
};
export function Badge({ tone = "neutral", children, className }: { tone?: keyof typeof tones; children: ReactNode; className?: string }) {
  return <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", tones[tone], className)}>{children}</span>;
}
export const NeedsReview = () => <Badge tone="warn">Needs review</Badge>;

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
    </div>
  );
}
const inputCls = "w-full min-w-0 rounded-lg border border-line bg-white px-3 py-2 text-sm placeholder:text-stone-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-stone-50";
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={clsx(inputCls, "h-10", className)} {...p} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={clsx(inputCls, className)} {...p} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...p }, ref) {
  return <select ref={ref} className={clsx(inputCls, "h-10", className)} {...p} />;
});

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-muted">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {label}
    </span>
  );
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-lg bg-stone-200/70", className)} aria-hidden />;
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
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line bg-white px-6 py-10 text-center">
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
    <div className={clsx("flex flex-col gap-2 rounded-lg border px-3 py-2.5 text-sm sm:flex-row sm:items-start", cls)} role={tone === "danger" ? "alert" : "status"}>
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
      className={clsx("m-auto max-h-[90dvh] w-[calc(100%-2rem)] overflow-hidden rounded-xl border border-line bg-white p-0 text-ink shadow-xl", wide ? "max-w-3xl" : "max-w-lg")}
    >
      {open && (
        <div className="dialog-in flex max-h-[90dvh] flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 id={titleId} className="font-semibold">{title}</h2>
            <button type="button" onClick={onClose} data-squish="" className="squish-icon rounded-md p-1 text-muted hover:bg-stone-100" aria-label="Close">
              <X className="size-5" aria-hidden />
            </button>
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
          <Link href={back.href} data-squish="" className="mb-1 inline-block text-sm text-muted hover:text-ink">
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
    <details className="group rounded-lg border border-line bg-stone-50/60 px-3 py-2" open={defaultOpen}>
      <summary className="details-summary cursor-pointer select-none text-sm font-medium text-ink">
        <ChevronRight className="details-chevron -ml-0.5 mr-1 inline-block size-4 align-[-3px] text-muted" aria-hidden />
        {summary}
      </summary>
      <div className="mt-2 text-sm">{children}</div>
    </details>
  );
}
