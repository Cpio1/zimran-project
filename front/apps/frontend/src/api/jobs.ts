import { api } from "./client";
import type { Job } from "./types";
import { TERMINAL_JOB_STATUSES } from "./types";

export const isTerminal = (j: Pick<Job, "status"> | null | undefined) => !!j && TERMINAL_JOB_STATUSES.includes(j.status);

/** Moderate interval with backoff: 1s, 1.5s, 2.25s … capped at 6s. */
export function pollDelay(attempt: number) {
  return Math.min(6000, Math.round(1000 * Math.pow(1.5, attempt)));
}

/** Promise-based polling for non-React callers. Stops on terminal status or abort. */
export async function waitForJob(id: string, opts: { signal?: AbortSignal; onUpdate?: (j: Job) => void; delay?: (n: number) => number } = {}): Promise<Job> {
  const delay = opts.delay ?? pollDelay;
  for (let attempt = 0; ; attempt++) {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const job = await api.getJob(id, opts.signal);
    opts.onUpdate?.(job);
    if (isTerminal(job)) return job;
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, delay(attempt));
      opts.signal?.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    });
  }
}

/** Jobs the user started, so polling can resume after navigating away and back. */
const KEY = "claimly.active_jobs";
export interface TrackedJob {
  id: string;
  kind: Job["kind"];
  /** what the job is about: entry / case / thread id */
  subject: string;
  label?: string;
}
export function trackJob(j: TrackedJob) {
  const all = trackedJobs().filter((x) => x.id !== j.id);
  all.push(j);
  try {
    localStorage.setItem(KEY, JSON.stringify(all.slice(-50)));
  } catch {
    /* ignore */
  }
}
export function untrackJob(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(trackedJobs().filter((x) => x.id !== id)));
  } catch {
    /* ignore */
  }
}
export function trackedJobs(subject?: string): TrackedJob[] {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "[]") as TrackedJob[];
    return subject ? all.filter((j) => j.subject === subject) : all;
  } catch {
    return [];
  }
}
export function clearTrackedJobs() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
