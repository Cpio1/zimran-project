"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowRight, CheckCircle2, Clock, FolderKanban, Plus } from "lucide-react";
import { api, listAll } from "@/api/client";
import type { CaseStatus, CaseType } from "@/api/types";
import { CASE_STATUSES, CASE_TYPES } from "@/api/types";
import { USER_TURN } from "@/components/case/Sections";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, ListSkeleton, Modal, PageHeader, Select, Textarea } from "@/components/ui";
import { CASE_NEXT_STEP, CASE_STATUS_LABEL, CASE_TYPE_LABEL, CATEGORY_LABEL, formatDate } from "@/lib/format";
import { invalidate, qk, useAllEntries } from "@/lib/hooks";
import { useUrlState } from "@/lib/useUrlState";

export default function CasesPage() {
  return <Suspense><CasesInner /></Suspense>;
}

function CasesInner() {
  const [statusRaw, setStatusRaw] = useUrlState("stage");
  const status = ((CASE_STATUSES as readonly string[]).includes(statusRaw) ? statusRaw : "") as CaseStatus | "";
  const setStatus = (s: CaseStatus | "") => setStatusRaw(s);
  const [newOpen, setNewOpen] = useState(false);
  const list = useQuery({ queryKey: qk.cases({ status, all: true }), queryFn: () => listAll((cursor) => api.listCases({ status: status || undefined, cursor, limit: 100 })) });

  return (
    <>
      <PageHeader
        title="Cases"
        subtitle="Requests to companies, from first message to the result."
        // While the list is empty the empty state carries the one main "New case" button.
        actions={<Button variant={list.data?.length === 0 && !status ? "secondary" : "primary"} icon={<Plus className="size-4" aria-hidden />} onClick={() => setNewOpen(true)}>New case</Button>}
      />
      <div role="tablist" aria-label="Stage" className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {(["", ...CASE_STATUSES] as const).map((s) => (
          <button key={s || "all"} role="tab" aria-selected={status === s} type="button" onClick={() => setStatus(s)}
            className={clsx("hit-y shrink-0 rounded-full px-3 py-1.5 text-sm transition-colors", status === s ? "bg-ink text-white" : "bg-white text-muted ring-1 ring-line hover:text-ink")}>
            {s ? CASE_STATUS_LABEL[s] : "All"}
          </button>
        ))}
      </div>
      {list.error && <ErrorBox error={list.error} onRetry={() => list.refetch()} />}
      {list.isLoading && <ListSkeleton rows={3} />}
      {list.data?.length === 0 && (
        <EmptyState icon={<FolderKanban className="size-8" aria-hidden />} title={status ? "No cases at this stage" : "No cases yet"} body="Start one from a benefit with “Plan to use”, or open a new case for a warranty claim, a return or a delayed refund." action={!status && <Button variant="primary" onClick={() => setNewOpen(true)}>New case</Button>} />
      )}
      <ul className="flex flex-col gap-3">
        {list.data?.map((c) => {
          const yours = USER_TURN[c.status];
          const done = c.status === "resolved";
          return (
            <Card as="li" key={c.id} tone={yours ? "default" : "quiet"} className="hover:border-brand-200">
              <Link href={`/cases/${c.id}`} data-squish="" className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone={yours ? "brand" : "neutral"}>{CASE_STATUS_LABEL[c.status]}</Badge>
                    <Badge>{CASE_TYPE_LABEL[c.type]}</Badge>
                  </div>
                  <h2 className="font-semibold [overflow-wrap:anywhere]">{c.title}</h2>
                  {/* Staging: the next step is the line to act on when it's the user's turn. */}
                  <p className={clsx("mt-1 flex items-start gap-1.5 text-sm", yours ? "font-medium text-brand-700" : "text-muted")}>
                    {yours ? <ArrowRight data-anticipate="right" className="mt-0.5 size-4 shrink-0" aria-hidden />
                      : done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
                      : <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />}
                    <span className="min-w-0">
                      <span className="sr-only">{yours ? "Your next step: " : done ? "" : "Waiting: "}</span>
                      {CASE_NEXT_STEP[c.status]}
                    </span>
                  </p>
                </div>
                <p className="text-xs text-muted">Updated {formatDate(c.updated_at)}</p>
              </Link>
            </Card>
          );
        })}
      </ul>
      {newOpen && <NewCaseModal onClose={() => setNewOpen(false)} />}
    </>
  );
}

function NewCaseModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const entries = useAllEntries();
  const [f, setF] = useState({ title: "", type: "warranty" as CaseType, entryIds: [] as string[], benefitId: "", situation: "", incident: "", desired: "" });
  const benefits = useQuery({
    queryKey: qk.benefits({ entries: f.entryIds }),
    queryFn: async () => (await Promise.all(f.entryIds.map((id) => api.listBenefits({ entry_id: id, limit: 100 }).then((r) => r.data)))).flat(),
    enabled: f.entryIds.length > 0,
  });
  const m = useMutation({
    mutationFn: () => {
      const chosen = (entries.data ?? []).filter((e) => f.entryIds.includes(e.id));
      return api.createCase({
        title: f.title.trim(), type: f.type, entry_ids: f.entryIds, document_ids: chosen.flatMap((e) => e.document_ids),
        benefit_id: f.benefitId || null, situation: f.situation.trim(), incident_date: f.incident || null, desired_result: f.desired.trim() || null,
      });
    },
    onSuccess: (c) => {
      invalidate(qc, "cases", "dashboard");
      router.push(`/cases/${c.id}`);
    },
  });
  const valid = f.title.trim() && f.situation.trim();
  return (
    <Modal open onClose={onClose} title="New case" wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid} loading={m.isPending} onClick={() => m.mutate()}>Create case</Button></>}>
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="c-title"><Input id="c-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Laptop screen repair" /></Field>
          <Field label="Type" htmlFor="c-type">
            <Select id="c-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as CaseType })}>
              {CASE_TYPES.map((t) => <option key={t} value={t}>{CASE_TYPE_LABEL[t]}</option>)}
            </Select>
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Documents for this case</legend>
          <p className="mb-2 text-xs text-muted">Pick only what belongs to this one product, policy or service.</p>
          {entries.data?.length ? (
            <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-lg border border-line p-2">
              {entries.data.map((e) => (
                <label key={e.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-stone-50">
                  <input type="checkbox" checked={f.entryIds.includes(e.id)} onChange={(ev) => setF({ ...f, entryIds: ev.target.checked ? [...f.entryIds, e.id] : f.entryIds.filter((x) => x !== e.id), benefitId: "" })} />
                  <span className="min-w-0 flex-1 truncate">{e.title}</span>
                  <span className="text-xs text-muted">{CATEGORY_LABEL[e.category]}</span>
                </label>
              ))}
            </div>
          ) : <p className="text-sm text-muted">No documents yet — you can add them later.</p>}
        </fieldset>
        {benefits.data && benefits.data.length > 0 && (
          <Field label="Related benefit (optional)" htmlFor="c-benefit">
            <Select id="c-benefit" value={f.benefitId} onChange={(e) => setF({ ...f, benefitId: e.target.value })}>
              <option value="">None</option>
              {benefits.data.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </Select>
          </Field>
        )}
        <Field label="What happened?" htmlFor="c-sit"><Textarea id="c-sit" rows={3} value={f.situation} onChange={(e) => setF({ ...f, situation: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="When did it happen? (optional)" htmlFor="c-date"><Input id="c-date" type="date" value={f.incident} onChange={(e) => setF({ ...f, incident: e.target.value })} /></Field>
          <Field label="What result do you want? (optional)" htmlFor="c-des"><Input id="c-des" value={f.desired} onChange={(e) => setF({ ...f, desired: e.target.value })} /></Field>
        </div>
        {m.error && <ErrorBox error={m.error} onRetry={() => m.mutate()} />}
      </div>
    </Modal>
  );
}
