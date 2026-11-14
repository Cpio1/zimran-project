"use client";

import { useState } from "react";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { Check, Eye, FileText, Pencil, RotateCw, Trash2 } from "lucide-react";
import { api } from "@/api/client";
import type { Document, Entry, Fact } from "@/api/types";
import { DOC_STATUS_LABEL, formatDate } from "@/lib/format";
import { invalidate, qk } from "@/lib/hooks";
import { EvidenceChips, useOpenEvidence } from "./Evidence";
import { Badge, Button, ErrorBox, Input, Modal, NeedsReview, Notice } from "./ui";
import { useToast } from "./Toast";

export const humanizeKey = (k: string) => k.replace(/_cents$/, "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function formatFactValue(key: string, v: Fact["value"]): string {
  if (v === null) return "Not known";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number" && key.endsWith("_cents")) return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v / 100);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDate(v) ?? v;
  return String(v);
}

const ORIGIN: Record<Fact["origin"], string> = { document: "From document", user: "Edited by you", calculated: "Calculated" };

export function useEntryDocuments(entry: Entry | undefined) {
  return useQueries({
    queries: (entry?.document_ids ?? []).map((id) => ({ queryKey: qk.document(id), queryFn: () => api.getDocument(id) })),
  });
}

/** Key facts with origin, review flag and source. Edits go to PATCH /entries with expected_version. */
export function FactsList({ entry, editable }: { entry: Entry; editable?: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const m = useMutation({
    mutationFn: (facts: Record<string, Fact>) => api.patchEntry(entry.id, { facts, expected_version: entry.data_version }),
    onSuccess: (e) => {
      qc.setQueryData(qk.entry(e.id), e);
      invalidate(qc, "entries");
      setEditing(null);
    },
  });
  const entries = Object.entries(entry.facts);
  if (!entries.length) return <p className="text-sm text-muted">No key details extracted yet.</p>;

  const save = (key: string, f: Fact) => {
    const raw = value.trim();
    const v: Fact["value"] = raw === "" ? null : typeof f.value === "number" && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
    m.mutate({ [key]: { value: v, origin: "user", evidence_refs: [], needs_review: false } });
  };

  return (
    <div className="flex flex-col gap-2">
      {m.error && <ErrorBox error={m.error} onReload={() => { m.reset(); invalidate(qc, "entry"); }} />}
      <ul className="flex flex-col divide-y divide-line">
        {entries.map(([key, f]) => (
          <li key={key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted">{humanizeKey(key)}</p>
              {editing === key ? (
                <form className="mt-1 flex gap-2" onSubmit={(e) => { e.preventDefault(); save(key, f); }}>
                  <Input aria-label={humanizeKey(key)} value={value} onChange={(e) => setValue(e.target.value)} autoFocus placeholder={typeof f.value === "string" && /^\d{4}-/.test(f.value) ? "YYYY-MM-DD" : ""} />
                  <Button type="submit" size="md" variant="primary" loading={m.isPending}>Save</Button>
                  <Button size="md" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                </form>
              ) : (
                <p className="font-medium">{formatFactValue(key, f.value)}</p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge tone={f.origin === "user" ? "info" : "neutral"}>{ORIGIN[f.origin]}</Badge>
                {f.needs_review && <NeedsReview />}
              </div>
              {f.evidence_refs.length > 0 && <div className="mt-2"><EvidenceChips refs={f.evidence_refs} max={1} /></div>}
            </div>
            {editable && editing !== key && (
              <div className="flex gap-1">
                {f.needs_review && (
                  <Button size="sm" icon={<Check className="size-3.5" aria-hidden />} onClick={() => m.mutate({ [key]: { ...f, needs_review: false } })}>Looks right</Button>
                )}
                <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" aria-hidden />} onClick={() => { setEditing(key); setValue(f.value === null ? "" : String(f.value)); }}>Edit</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DocumentList({ entry, docs, allowDelete }: { entry: Entry; docs: ReturnType<typeof useEntryDocuments>; allowDelete?: boolean }) {
  const open = useOpenEvidence();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState<Document | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => api.deleteDocument(id),
    onSuccess: () => {
      setConfirm(null);
      toast("Document deleted.");
      invalidate(qc, "entry", "entries", "document", "benefits", "benefit", "dashboard");
    },
  });
  const analyze = useMutation({
    mutationFn: (id: string) => api.analyzeDocument(id, { force: true }),
    onSuccess: () => {
      toast("Analysis restarted. Open Review to follow it.");
      invalidate(qc, "document");
    },
  });
  if (!entry.document_ids.length) return <p className="text-sm text-muted">No files yet.</p>;
  return (
    <>
      <ul className="flex flex-col divide-y divide-line">
        {docs.map((q, i) => {
          const d = q.data;
          if (q.isError) return <li key={entry.document_ids[i]} className="py-3 text-sm text-muted">A document is unavailable.</li>;
          if (!d) return <li key={entry.document_ids[i]} className="py-3 text-sm text-muted">Loading…</li>;
          return (
            <li key={d.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <FileText className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{d.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <Badge tone={d.status === "failed" ? "danger" : d.status === "needs_review" ? "warn" : d.status === "ready" ? "brand" : "info"}>{DOC_STATUS_LABEL[d.status]}</Badge>
                    {d.page_count !== null && <span>{d.page_count} page{d.page_count === 1 ? "" : "s"}</span>}
                    <span>v{d.version}</span>
                  </div>
                  {d.review_flags.length > 0 && <ul className="mt-1.5 list-disc pl-4 text-xs text-amber-800">{d.review_flags.map((f) => <li key={f}>{f}</li>)}</ul>}
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" icon={<Eye className="size-3.5" aria-hidden />} onClick={() => open({ document_id: d.id, document_version: d.version, page: 1, quote: "" })}>View</Button>
                {d.status === "failed" && <Button size="sm" icon={<RotateCw className="size-3.5" aria-hidden />} loading={analyze.isPending} onClick={() => analyze.mutate(d.id)}>Analyze again</Button>}
                {allowDelete && <Button size="sm" variant="ghost" aria-label={`Delete ${d.name}`} onClick={() => setConfirm(d)}><Trash2 className="size-4" aria-hidden /></Button>}
              </div>
            </li>
          );
        })}
      </ul>
      {analyze.error && <ErrorBox error={analyze.error} />}
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Delete document?"
        footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" loading={del.isPending} onClick={() => confirm && del.mutate(confirm.id)}>Delete</Button></>}
      >
        <p className="text-sm">“{confirm?.name}” will be removed. Analysis in progress stops, and quotes from it will show as unavailable.</p>
        {del.error && <div className="mt-3"><ErrorBox error={del.error} /></div>}
      </Modal>
    </>
  );
}

export function entryNeedsReview(e: Entry) {
  return Object.values(e.facts).some((f) => f.needs_review);
}

export function StaleSourceNotice({ docs }: { docs: Document[] }) {
  const failed = docs.filter((d) => d.status === "failed");
  if (!failed.length) return null;
  return <Notice tone="warn" title="Some files couldn't be analyzed">{failed.map((d) => d.name).join(", ")}. You can analyze them again or upload a clearer copy.</Notice>;
}
