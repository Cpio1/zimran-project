"use client";

import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api, listAll } from "@/api/client";
import { isTerminal, pollDelay } from "@/api/jobs";
import type { Job, Thread } from "@/api/types";

export const qk = {
  dashboard: ["dashboard"] as const,
  profile: ["profile"] as const,
  entries: (p: object = {}) => ["entries", p] as const,
  entry: (id: string) => ["entry", id] as const,
  document: (id: string) => ["document", id] as const,
  benefits: (p: object = {}) => ["benefits", p] as const,
  benefit: (id: string) => ["benefit", id] as const,
  threads: (p: object = {}) => ["threads", p] as const,
  messages: (threadId: string) => ["messages", threadId] as const,
  cases: (p: object = {}) => ["cases", p] as const,
  case: (id: string) => ["case", id] as const,
  events: (caseId: string) => ["events", caseId] as const,
  drafts: (caseId: string) => ["drafts", caseId] as const,
  outcome: (caseId: string) => ["outcome", caseId] as const,
  reminders: (p: object = {}) => ["reminders", p] as const,
  notifications: ["notifications"] as const,
  job: (id: string) => ["job", id] as const,
};

/** Invalidate by root key names, e.g. invalidate(qc, "benefit", "benefits", "dashboard"). */
export function invalidate(qc: QueryClient, ...roots: string[]) {
  return qc.invalidateQueries({ predicate: (q) => roots.includes(String(q.queryKey[0])) });
}

/**
 * Polls GET /jobs/{id} with backoff until a terminal status. Stops on unmount (query unobserved).
 * `onDone` fires once per job id when a terminal state is observed.
 */
export function useJob(jobId: string | null | undefined, onDone?: (job: Job) => void) {
  const q = useQuery({
    queryKey: qk.job(jobId ?? "none"),
    queryFn: ({ signal }) => api.getJob(jobId!, signal),
    enabled: !!jobId,
    staleTime: 0,
    refetchInterval: (query) => (isTerminal(query.state.data) ? false : pollDelay(query.state.dataUpdateCount)),
    refetchIntervalInBackground: false,
    retry: 3,
  });
  const fired = useRef<string | null>(null);
  const cb = useRef(onDone);
  cb.current = onDone;
  useEffect(() => {
    if (q.data && jobId && isTerminal(q.data) && fired.current !== jobId) {
      fired.current = jobId;
      cb.current?.(q.data);
    }
  }, [q.data, jobId]);
  return q;
}

export function useProfile() {
  return useQuery({ queryKey: qk.profile, queryFn: api.getProfile, staleTime: 60_000 });
}

export function useAllEntries() {
  return useQuery({ queryKey: qk.entries({ all: true }), queryFn: () => listAll((cursor) => api.listEntries({ cursor, limit: 100 })) });
}

/** Finds the thread for a scope, or creates it (idempotently) on first use. */
export async function ensureThread(scope: Thread["scope"], ids: { entry_id?: string | null; case_id?: string | null; document_ids?: string[] } = {}) {
  const found = await api.listThreads({ scope, entry_id: ids.entry_id ?? undefined, case_id: ids.case_id ?? undefined, limit: 100 });
  const hit = found.data.find((t) => t.scope === scope && (scope !== "entry" || t.entry_id === ids.entry_id) && (scope !== "case" || t.case_id === ids.case_id));
  if (hit) return hit;
  return api.createThread({ scope, entry_id: ids.entry_id ?? null, case_id: ids.case_id ?? null, document_ids: ids.document_ids ?? [] });
}
