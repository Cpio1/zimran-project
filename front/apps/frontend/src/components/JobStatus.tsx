"use client";

import { CircleSlash, RefreshCw, XCircle } from "lucide-react";
import type { Job } from "@/api/types";
import { ApiError, describeError } from "@/api/errors";
import { JOB_STATUS_LABEL } from "@/lib/format";
import { Button } from "./ui";
import { SuccessIcon } from "./motion";

export function ProgressBar({ value, label }: { value: number | null; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={value === null ? undefined : 0}
      aria-valuemax={value === null ? undefined : 100}
      aria-valuenow={value ?? undefined}
      className="relative h-1.5 w-full overflow-hidden rounded-full bg-track"
    >
      {value === null ? (
        <div className="animate-indeterminate absolute inset-y-0 left-0 w-2/5 rounded-full bg-brand-500" />
      ) : (
        // Progress moves between two states: transform only, 180 ms ease-in-out (--dur-state).
        <div className="h-full w-full origin-left rounded-full bg-brand-500 transition-transform duration-[180ms] ease-[cubic-bezier(0.65,0,0.35,1)] motion-reduce:transition-none" style={{ transform: `scaleX(${Math.max(0, Math.min(100, value)) / 100})` }} />
      )}
    </div>
  );
}

/** Honest job state. progress=null → indeterminate bar, never an invented percentage. */
export function JobStatusView({ job, label, onRetry, compact }: { job: Job | undefined | null; label: string; onRetry?: () => void; compact?: boolean }) {
  if (!job) return null;
  const { status } = job;
  if (status === "queued" || status === "running") {
    return (
      <div className="flex flex-col gap-1.5" aria-live="polite">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span>{label} · <span className="text-muted">{JOB_STATUS_LABEL[status]}</span></span>
          {job.progress !== null && <span className="tabular-nums text-muted">{job.progress}%</span>}
        </div>
        <ProgressBar value={job.progress} label={label} />
      </div>
    );
  }
  if (status === "succeeded") {
    return compact ? null : (
      <p className="flex items-center gap-2 text-sm font-medium text-brand-700" aria-live="polite">
        <SuccessIcon className="size-4" /> {label} · done
      </p>
    );
  }
  if (status === "failed") {
    const err = job.error ? describeError(new ApiError({ status: 0, ...job.error })) : null;
    return (
      <div className="feedback-in flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 sm:flex-row sm:items-center" role="alert">
        <XCircle className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">{label} failed. {err?.title}</span>
        {onRetry && (job.error?.retryable ?? true) && <Button size="sm" onClick={onRetry} icon={<RefreshCw className="size-3.5" aria-hidden />}>Retry</Button>}
      </div>
    );
  }
  if (status === "stale") {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:flex-row sm:items-center" role="status">
        <RefreshCw className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">The information changed while this ran. A new analysis is needed.</span>
        {onRetry && <Button size="sm" onClick={onRetry}>Run again</Button>}
      </div>
    );
  }
  return (
    <p className="flex items-center gap-2 text-sm text-muted" role="status">
      <CircleSlash className="size-4" aria-hidden /> {label} was cancelled.
    </p>
  );
}
