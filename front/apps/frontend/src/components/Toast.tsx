"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import clsx from "clsx";
import { SuccessIcon } from "./motion";
import { IconButton } from "./ui";

interface Toast {
  id: number;
  text: string;
  tone: "ok" | "warn" | "error";
}
const Ctx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(Ctx);

/** How long a toast stays in its steady pose. */
const VISIBLE_MS: Record<Toast["tone"], number> = { ok: 3500, warn: 7000, error: 7000 };
/** Exit pose length (--dur-exit in globals.css); the next toast enters only after it. */
const EXIT_MS = 160;
const MAX_QUEUED = 4;

/**
 * Staging: toasts are shown one at a time. Several notifications in a row queue up and each
 * gets its own enter → steady → exit sequence. Hovering or focusing the visible toast pauses
 * its timer; dismissing it skips straight to its exit.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Toast[]>([]);
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(0);
  const head = queue[0];

  const push = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    setQueue((q) => (q.some((t) => t.text === text && t.tone === tone) ? q : [...q, { id: Date.now() + Math.random(), text, tone }].slice(-MAX_QUEUED)));
  }, []);

  // A new toast becomes visible: start its steady pose with the full duration.
  useEffect(() => {
    if (head) remaining.current = VISIBLE_MS[head.tone];
  }, [head]);

  // Steady pose; pausing keeps whatever time is left.
  useEffect(() => {
    if (!head || paused || leaving) return;
    const started = performance.now();
    const t = window.setTimeout(() => setLeaving(true), Math.max(0, remaining.current));
    return () => {
      window.clearTimeout(t);
      remaining.current -= performance.now() - started;
    };
  }, [head, paused, leaving]);

  // Exit pose, then hand over to the next toast.
  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => {
      setQueue((q) => q.slice(1));
      setLeaving(false);
      setPaused(false);
    }, EXIT_MS);
    return () => window.clearTimeout(t);
  }, [leaving]);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center px-4 md:bottom-6">
        {head && (
          <div
            key={head.id}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
            className={clsx(
              "on-dark elev-2 pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl py-1.5 pl-4 pr-1.5 text-sm",
              leaving ? "toast-out" : "toast-in",
              // ok: the inverse surface (dark on light theme, light on dark theme); warnings and errors keep
              // their solid colour with white text in both themes, plus an icon and the message itself.
              head.tone === "ok" ? "bg-inverse text-on-inverse" : head.tone === "warn" ? "bg-warn-solid text-white" : "bg-danger-solid text-white",
            )}
          >
            {head.tone === "ok" ? <SuccessIcon icon={Check} className="size-4 text-brand-200" /> : <AlertTriangle className="size-4 shrink-0" aria-hidden />}
            <span className="min-w-0 flex-1 break-words py-1.5">{head.text}</span>
            {queue.length > 1 && <span className="shrink-0 text-xs opacity-70">+{queue.length - 1}</span>}
            <IconButton icon={X} label="Dismiss" tone="inherit" className="opacity-80 hover:opacity-100" onClick={() => setLeaving(true)} />
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}
