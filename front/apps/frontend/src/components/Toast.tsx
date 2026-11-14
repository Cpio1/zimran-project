"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import clsx from "clsx";
import { SuccessIcon } from "./motion";

interface Toast {
  id: number;
  text: string;
  tone: "ok" | "warn" | "error";
}
const Ctx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-2), { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === "ok" ? 3500 : 7000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
        {items.map((t) => (
          <div key={t.id} className={clsx("pointer-events-auto flex max-w-md items-start gap-3 rounded-lg px-4 py-3 text-sm text-white shadow-lg", t.tone === "ok" ? "bg-ink" : t.tone === "warn" ? "bg-amber-700" : "bg-red-700")}>
            {t.tone === "ok" && <SuccessIcon icon={Check} className="mt-0.5 size-4 text-brand-200" />}
            <span className="min-w-0 flex-1">{t.text}</span>
            <button type="button" aria-label="Dismiss" data-squish="" className="squish-icon" onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))}>
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
