"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { API_MODE } from "@/api/config";
import { ApiError, describeError } from "@/api/errors";
import { ensureSession, onSessionChange } from "@/api/session";
import { clearTrackedJobs } from "@/api/jobs";
import "@/api/client"; // registers the session creator
import { ToastProvider } from "./Toast";
import { EvidenceProvider } from "./Evidence";
import { Button, Notice } from "./ui";
import { PressFeedback } from "./motion";

let mswStarted: Promise<unknown> | null = null;
function startMocks() {
  if (API_MODE !== "mock") return Promise.resolve();
  mswStarted ??= import("@/mocks/browser").then(({ worker }) =>
    worker.start({ onUnhandledRequest: "bypass", quiet: true, serviceWorker: { url: "/mockServiceWorker.js" } }),
  );
  return mswStarted;
}

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchOnWindowFocus: false,
            retry: (n, e) => e instanceof ApiError && e.retryable && e.code !== "AI_NOT_CONFIGURED" && n < 2,
          },
          mutations: { retry: false },
        },
      }),
  );
  const [state, setState] = useState<"booting" | "ready" | { error: unknown }>("booting");
  const [notice, setNotice] = useState<string | null>(null);

  const boot = useCallback(() => {
    setState("booting");
    startMocks()
      .then(() => ensureSession())
      .then(() => setState("ready"))
      .catch((error) => setState({ error }));
  }, []);

  useEffect(() => {
    boot();
    return onSessionChange((reason) => {
      // Old UUIDs belong to the previous space: drop every cached query and resumable job.
      qc.cancelQueries();
      qc.clear();
      clearTrackedJobs();
      if (reason === "expired") setNotice("Your previous demo session ended, so a new empty demo space was started.");
      if (reason === "reset") setNotice("Started a new demo space.");
    });
  }, [boot, qc]);

  return (
    <QueryClientProvider client={qc}>
      <PressFeedback />
      <ToastProvider>
        <EvidenceProvider>
          {state === "booting" ? (
            <div className="flex min-h-dvh items-center justify-center" role="status">
              <span className="inline-flex items-center gap-2 text-sm text-muted">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Opening Claimly…
              </span>
            </div>
          ) : state === "ready" ? (
            <>
              {notice && (
                <div className="mx-auto max-w-6xl px-4 pt-3 md:pl-64">
                  <Notice tone="info" action={<Button size="sm" variant="ghost" onClick={() => setNotice(null)}>Dismiss</Button>}>{notice}</Notice>
                </div>
              )}
              {children}
            </>
          ) : (
            <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
              <Notice tone="danger" title="Claimly can't start right now">
                {describeError(state.error).title}
              </Notice>
              <Button variant="primary" onClick={boot}>Try again</Button>
            </div>
          )}
        </EvidenceProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
