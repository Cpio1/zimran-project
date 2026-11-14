"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellPlus, CalendarDays, Eye, Pencil } from "lucide-react";
import { api, listAll } from "@/api/client";
import type { Case, CaseStatus, Document } from "@/api/types";
import { Chat } from "@/components/Chat";
import { useOpenEvidence } from "@/components/Evidence";
import { ReminderModal } from "@/components/Reminders";
import { AssessmentSection, Checklist, DraftSection, OutcomeSection, ReplySection, StatusModal, Timeline, caseFocus } from "@/components/case/Sections";
import { Badge, Button, Card, ErrorBox, Field, Input, ListSkeleton, Modal, PageHeader, SectionTitle, Textarea } from "@/components/ui";
import { CASE_NEXT_STEP, CASE_STATUS_LABEL, CASE_TYPE_LABEL, addDaysISO, formatDate, todayISO } from "@/lib/format";
import { invalidate, qk } from "@/lib/hooks";

export default function CasePage() {
  const { id } = useParams<{ id: string }>();
  const c = useQuery({ queryKey: qk.case(id), queryFn: () => api.getCase(id) });
  const drafts = useQuery({ queryKey: qk.drafts(id), queryFn: () => listAll((cursor) => api.listDrafts(id, { cursor, limit: 100 })) });
  const thread = useQuery({ queryKey: qk.threads({ case_id: id }), queryFn: () => api.listThreads({ case_id: id, scope: "case" }).then((r) => r.data.find((t) => t.id === c.data?.thread_id) ?? r.data[0] ?? null), enabled: !!c.data });
  const entries = useQueries({ queries: (c.data?.entry_ids ?? []).map((eid) => ({ queryKey: qk.entry(eid), queryFn: () => api.getEntry(eid), retry: false })) });
  const allDocIds = [...new Set([...(c.data?.document_ids ?? []), ...entries.flatMap((q) => q.data?.document_ids ?? [])])];
  const docs = useQueries({ queries: allDocIds.map((did) => ({ queryKey: qk.document(did), queryFn: () => api.getDocument(did), retry: false })) });
  const docList = docs.map((q) => q.data).filter((d): d is Document => !!d);
  const benefit = useQuery({ queryKey: qk.benefit(c.data?.benefit_id ?? "none"), queryFn: () => api.getBenefit(c.data!.benefit_id!), enabled: !!c.data?.benefit_id, retry: false });
  const reminders = useQuery({ queryKey: qk.reminders({ case_id: id }), queryFn: () => api.listReminders({ case_id: id, limit: 100 }) });
  const [statusFor, setStatusFor] = useState<CaseStatus | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [remOpen, setRemOpen] = useState(false);
  const open = useOpenEvidence();

  if (c.error) return <ErrorBox error={c.error} onRetry={() => c.refetch()} />;
  if (!c.data) return <ListSkeleton rows={4} />;
  const x = c.data;
  const d = drafts.data ?? [];
  const replied = ["submitted", "awaiting_response", "approved", "denied", "resolved"].includes(x.status);
  // Staging: the section that holds the next action for this state gets the focus tone and the
  // page's one main button; the rest stay fully usable but visually secondary.
  const focus = drafts.data ? caseFocus(x, d) : null;

  return (
    <>
      <PageHeader
        back={{ href: "/cases", label: "Cases" }}
        title={x.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{CASE_STATUS_LABEL[x.status]}</Badge>
            <Badge>{CASE_TYPE_LABEL[x.type]}</Badge>
            <span className={focus ? "font-medium text-ink" : undefined}>Next: {CASE_NEXT_STEP[x.status]}</span>
          </span>
        }
        actions={<Button onClick={() => setStatusFor(x.status === "draft" || x.status === "prepared" ? "submitted" : x.status === "submitted" ? "awaiting_response" : x.status)}>Update stage</Button>}
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card tone="quiet" className="p-4">
            <SectionTitle title="About this case" action={<Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" aria-hidden />} onClick={() => setEditOpen(true)}>Edit</Button>} />
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2"><dt className="text-xs text-muted">Situation</dt><dd className="whitespace-pre-line">{x.situation || "—"}</dd></div>
              <div><dt className="text-xs text-muted">Wanted result</dt><dd>{x.desired_result ?? "Not set"}</dd></div>
              <div><dt className="text-xs text-muted">Date of the event</dt><dd>{formatDate(x.incident_date) ?? "Not set"}</dd></div>
              {benefit.data && <div className="sm:col-span-2"><dt className="text-xs text-muted">Benefit</dt><dd><Link className="text-brand-700 hover:underline" href={`/benefits/${benefit.data.id}`}>{benefit.data.title}</Link></dd></div>}
              {x.approved_amount_cents !== null && <div><dt className="text-xs text-muted">Approved</dt><dd>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(x.approved_amount_cents / 100)}</dd></div>}
            </dl>
            <div className="mt-4">
              <p className="mb-1.5 text-xs text-muted">Documents in this case</p>
              {x.document_ids.length ? (
                <ul className="flex flex-col gap-1">
                  {x.document_ids.map((did) => {
                    const doc = docList.find((dd) => dd.id === did);
                    return (
                      <li key={did} className="flex items-center gap-2 text-sm">
                        <span className="min-w-0 flex-1 truncate">{doc?.name ?? "Unavailable document"}</span>
                        {doc && <Button size="sm" variant="ghost" icon={<Eye className="size-3.5" aria-hidden />} onClick={() => open({ document_id: doc.id, document_version: doc.version, page: 1, quote: "" })}>View</Button>}
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="text-sm text-muted">None selected.</p>}
            </div>
          </Card>
          <AssessmentSection c={x} focus={focus === "assessment"} />
          <DraftSection c={x} kind="initial" drafts={d} focus={focus === "initial"} onMarkSent={() => setStatusFor("submitted")} />
          {replied && <ReplySection c={x} docs={docList} focus={focus === "reply"} />}
          {replied && <DraftSection c={x} kind="follow_up" drafts={d} focus={focus === "follow_up"} onMarkSent={() => setStatusFor("submitted")} />}
          <OutcomeSection c={x} focus={focus === "outcome"} />
          <Timeline c={x} />
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <Card className="flex h-[min(640px,80dvh)] flex-col p-4 lg:sticky lg:top-6">
            <h2 className="mb-1 font-semibold">Case chat</h2>
            <p className="mb-3 border-b border-line pb-3 text-xs text-muted">Only about this case. History is kept.</p>
            {thread.data ? <Chat thread={thread.data} className="flex-1" placeholder="Ask about this case" /> : thread.error ? <ErrorBox error={thread.error} /> : <ListSkeleton rows={1} />}
          </Card>
          <Checklist c={x} drafts={d} />
          <Card tone="quiet" className="p-4">
            <SectionTitle title="Reminders" action={<Button size="sm" icon={<BellPlus className="size-3.5" aria-hidden />} onClick={() => setRemOpen(true)}>Add</Button>} />
            {reminders.data?.data.filter((r) => r.status !== "cancelled").length ? (
              <ul className="flex flex-col gap-2 text-sm">
                {reminders.data.data.filter((r) => r.status !== "cancelled").map((r) => (
                  <li key={r.id} className="flex items-center gap-2"><CalendarDays className="size-4 text-brand-600" aria-hidden /><span className="flex-1">{r.title}</span><span className="text-muted">{formatDate(r.date)}</span></li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">Add a reminder to follow up if there&apos;s no reply.</p>}
          </Card>
        </div>
      </div>
      {statusFor && <StatusModal c={x} initial={statusFor} onClose={() => setStatusFor(null)} />}
      {editOpen && <EditCaseModal c={x} docs={docList} onClose={() => setEditOpen(false)} />}
      {remOpen && <ReminderModal open onClose={() => setRemOpen(false)} create={{ title: `Follow up: ${x.title}`, date: addDaysISO(todayISO(), 7), benefit_id: null, case_id: x.id, origin: "user", evidence_refs: [] }} />}
    </>
  );
}

function EditCaseModal({ c, docs, onClose }: { c: Case; docs: Document[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [situation, setSituation] = useState(c.situation);
  const [incident, setIncident] = useState(c.incident_date ?? "");
  const [desired, setDesired] = useState(c.desired_result ?? "");
  const [docIds, setDocIds] = useState(c.document_ids);
  const m = useMutation({
    mutationFn: () => api.patchCase(c.id, { situation, incident_date: incident || null, desired_result: desired.trim() || null, document_ids: docIds, expected_version: c.data_version }),
    onSuccess: (nc) => {
      qc.setQueryData(qk.case(nc.id), nc);
      invalidate(qc, "cases", "drafts", "threads");
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title="Edit case" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Situation" htmlFor="ec-sit"><Textarea id="ec-sit" rows={4} value={situation} onChange={(e) => setSituation(e.target.value)} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date of the event" htmlFor="ec-date"><Input id="ec-date" type="date" value={incident} onChange={(e) => setIncident(e.target.value)} /></Field>
          <Field label="Wanted result" htmlFor="ec-des"><Input id="ec-des" value={desired} onChange={(e) => setDesired(e.target.value)} /></Field>
        </div>
        {docs.length > 0 && (
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Documents</legend>
            {docs.map((d) => (
              <label key={d.id} className="flex items-center gap-2 py-1 text-sm">
                <input type="checkbox" checked={docIds.includes(d.id)} onChange={(e) => setDocIds(e.target.checked ? [...docIds, d.id] : docIds.filter((x) => x !== d.id))} />
                <span className="truncate">{d.name}</span>
              </label>
            ))}
          </fieldset>
        )}
        {m.error && <ErrorBox error={m.error} onReload={() => { m.reset(); qc.invalidateQueries({ queryKey: qk.case(c.id) }); onClose(); }} />}
      </div>
    </Modal>
  );
}
