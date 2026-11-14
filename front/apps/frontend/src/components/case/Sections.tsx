"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, ClipboardCopy, FileText, MessageSquareReply, NotebookPen, RefreshCw, Send, Sparkles, Trophy } from "lucide-react";
import clsx from "clsx";
import { api, listAll } from "@/api/client";
import { ApiError } from "@/api/errors";
import { trackJob, trackedJobs, untrackJob } from "@/api/jobs";
import type { Case, CaseEvent, CaseStatus, Document, Draft, Job, Outcome, OutcomePut } from "@/api/types";
import { CASE_STATUSES } from "@/api/types";
import { EvidenceChips } from "../Evidence";
import { JobStatusView } from "../JobStatus";
import { useToast } from "../Toast";
import { SuccessIcon, useConfirmFlash } from "../motion";
import { Badge, Button, Card, Details, ErrorBox, Field, Input, Modal, Notice, SectionTitle, Select, Textarea, parsedField } from "../ui";
import { CASE_STATUS_LABEL, formatCents, formatDateTime, parseMoney } from "@/lib/format";
import { invalidate, qk, useJob } from "@/lib/hooks";

// ───────── staging: the next action for the case's current state ─────────

/** Which section holds the next thing the user can do. `null` = nothing to do (waiting or done). */
export type CaseFocus = "assessment" | "initial" | "reply" | "follow_up" | "outcome" | null;

export function caseFocus(c: Case, drafts: Draft[]): CaseFocus {
  switch (c.status) {
    case "draft":
    case "prepared":
      // Check first, then prepare the request, then send it (the draft section holds "I sent it").
      return drafts.some((d) => d.kind === "initial") ? "initial" : c.assessment ? "initial" : "assessment";
    case "submitted":
    case "awaiting_response":
      return "reply";
    case "approved":
      return "outcome";
    case "denied":
      return "follow_up";
    case "resolved":
      return null;
  }
}

/** Is the next step the user's (true) or the company's (false)? Used by the case list. */
export const USER_TURN: Record<CaseStatus, boolean> = {
  draft: true, prepared: true, submitted: false, awaiting_response: true, approved: true, denied: true, resolved: false,
};

// ───────── case jobs (resumable) ─────────

export function useCaseJobs(caseId: string, kinds: Job["kind"][]) {
  const [ids, setIds] = useState<string[]>([]);
  const key = kinds.join(",");
  useEffect(() => {
    setIds(trackedJobs(caseId).filter((j) => kinds.includes(j.kind)).map((j) => j.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, key]);
  return {
    ids,
    add: (j: Job) => {
      trackJob({ id: j.id, kind: j.kind, subject: caseId });
      setIds((x) => [...x.filter((y) => y !== j.id), j.id]);
    },
    remove: (id: string) => {
      untrackJob(id);
      setIds((x) => x.filter((y) => y !== id));
    },
  };
}

function CaseJob({ id, label, onDone, onRetry, onDismiss }: { id: string; label: string; onDone: (j: Job) => void; onRetry?: () => void; onDismiss: () => void }) {
  const job = useJob(id, (j) => {
    onDone(j);
    if (j.status === "succeeded") onDismiss();
  });
  if (job.error) return <ErrorBox error={job.error} onRetry={() => job.refetch()} />;
  if (!job.data || job.data.status === "succeeded") return null;
  const terminal = ["failed", "stale", "cancelled"].includes(job.data.status);
  return (
    <div className="flex flex-col gap-2">
      <JobStatusView job={job.data} label={label} onRetry={onRetry ? () => { onDismiss(); onRetry(); } : undefined} />
      {terminal && <Button size="sm" variant="ghost" className="self-start" onClick={onDismiss}>Dismiss</Button>}
    </div>
  );
}

// ───────── status ─────────

const localNow = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export function StatusModal({ c, initial, onClose }: { c: Case; initial: CaseStatus; onClose: () => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<CaseStatus>(initial);
  const [when, setWhen] = useState(localNow());
  const [note, setNote] = useState(initial === "submitted" ? "Sent by me" : "");
  const [amount, setAmount] = useState("");
  const amountParsed = parseMoney(amount);
  const cents = amountParsed.kind === "ok" ? amountParsed.value : amountParsed.kind === "empty" ? null : NaN;
  const amountFeedback = parsedField(amount, amountParsed, setAmount);
  const m = useMutation({
    mutationFn: (version: number) =>
      api.setCaseStatus(c.id, {
        status, event_date: new Date(when).toISOString(), note: note.trim(),
        approved_amount_cents: status === "approved" && cents !== null && !Number.isNaN(cents) ? cents : null, expected_version: version,
      }),
    onSuccess: (nc) => {
      qc.setQueryData(qk.case(nc.id), nc);
      invalidate(qc, "events", "cases", "dashboard");
      onClose();
    },
  });
  const reload = async () => {
    m.reset();
    await qc.invalidateQueries({ queryKey: qk.case(c.id) });
  };
  return (
    <Modal open onClose={onClose} title="Update stage" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} disabled={Number.isNaN(cents)} onClick={() => m.mutate(c.data_version)}>Save</Button></>}>
      <div className="flex flex-col gap-4">
        {status === "submitted" && <Notice tone="info">Claimly doesn&apos;t send anything. Mark it sent after you&apos;ve sent it yourself.</Notice>}
        <Field label="Stage" htmlFor="st-status">
          <Select id="st-status" value={status} onChange={(e) => setStatus(e.target.value as CaseStatus)}>
            {CASE_STATUSES.map((s) => <option key={s} value={s}>{CASE_STATUS_LABEL[s]}</option>)}
          </Select>
        </Field>
        <Field label="When" htmlFor="st-when"><Input id="st-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        {status === "approved" && (
          <Field label="Approved amount (optional)" htmlFor="st-amount" hint={amountFeedback.hint ?? "Only if the company stated an amount."} error={amountFeedback.error}>
            <Input id="st-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$0.00" />
          </Field>
        )}
        <Field label="Note" htmlFor="st-note"><Input id="st-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Sent to support@ by email" /></Field>
        {m.error && <ErrorBox error={m.error} onReload={reload} onRetry={() => m.mutate(c.data_version)} />}
      </div>
    </Modal>
  );
}

// ───────── assessment ─────────

const ASSESS: Record<NonNullable<Case["assessment"]>["status"], { label: string; tone: "brand" | "warn" | "danger" }> = {
  possible: { label: "Looks possible", tone: "brand" },
  insufficient_evidence: { label: "Not enough information", tone: "warn" },
  likely_excluded: { label: "Likely not covered", tone: "danger" },
};

export function AssessmentSection({ c, focus }: { c: Case; focus?: boolean }) {
  const qc = useQueryClient();
  const jobs = useCaseJobs(c.id, ["assess"]);
  const run = useMutation({ mutationFn: () => api.assessCase(c.id, c.data_version), onSuccess: (j) => jobs.add(j) });
  const a = c.assessment;
  return (
    <Card tone={focus ? "focus" : "default"} className="p-4">
      <SectionTitle title="Assessment" action={<Button size="sm" variant={focus && !a ? "primary" : "secondary"} cue={focus && !a} icon={<Sparkles className="size-3.5" aria-hidden />} loading={run.isPending} disabled={jobs.ids.length > 0} onClick={() => run.mutate()}>{a ? "Re-check" : "Check"}</Button>} />
      {jobs.ids.map((id) => (
        <CaseJob key={id} id={id} label="Checking your documents" onDone={() => invalidate(qc, "case", "cases")} onRetry={() => run.mutate()} onDismiss={() => jobs.remove(id)} />
      ))}
      {run.error && <ErrorBox error={run.error} onRetry={() => run.mutate()} />}
      {a ? (
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2"><Badge tone={ASSESS[a.status].tone}>{ASSESS[a.status].label}</Badge><span className="text-xs text-muted">Based on your documents — not a decision by the company.</span></div>
          <p>{a.summary}</p>
          {a.reasons.length > 0 && <ul className="list-disc space-y-1 pl-5">{a.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
          {a.missing_info.length > 0 && <Notice tone="warn" title="Missing">{a.missing_info.join(", ")}</Notice>}
          <EvidenceChips refs={a.evidence_refs} max={2} />
        </div>
      ) : !jobs.ids.length && <p className="text-sm text-muted">Check what your documents say about this situation before contacting the company.</p>}
    </Card>
  );
}

// ───────── checklist ─────────

export function Checklist({ c, drafts }: { c: Case; drafts: Draft[] }) {
  const key = `claimly.checklist.${c.id}`;
  const items = useMemo(() => {
    const out = new Set<string>();
    for (const x of c.assessment?.missing_info ?? []) out.add(`Find: ${x}`);
    const d = drafts.find((x) => x.kind === "initial");
    for (const x of d?.content.missing_info ?? []) out.add(`Find: ${x}`);
    for (const x of d?.content.attachments ?? []) out.add(`Attach: ${x}`);
    out.add("Send the request yourself and mark it sent");
    out.add("Save the company's reply here");
    return [...out];
  }, [c.assessment, drafts]);
  const [done, setDone] = useState<string[]>([]);
  useEffect(() => {
    try {
      setDone(JSON.parse(localStorage.getItem(key) ?? "[]"));
    } catch {
      setDone([]);
    }
  }, [key]);
  const toggle = (i: string) => {
    const next = done.includes(i) ? done.filter((x) => x !== i) : [...done, i];
    setDone(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const auto = (i: string) => (i.startsWith("Send") && ["submitted", "awaiting_response", "approved", "denied", "resolved"].includes(c.status));
  return (
    <Card tone="quiet" className="p-4">
      <SectionTitle title="Checklist" />
      <ul className="flex flex-col gap-1.5">
        {items.map((i) => (
          <li key={i}>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={done.includes(i) || auto(i)} onChange={() => toggle(i)} disabled={auto(i)} />
              <span className={clsx((done.includes(i) || auto(i)) && "text-muted line-through")}>{i}</span>
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ───────── drafts ─────────

export function DraftSection({ c, kind, drafts, onMarkSent, focus }: { c: Case; kind: Draft["kind"]; drafts: Draft[]; onMarkSent: () => void; focus?: boolean }) {
  const qc = useQueryClient();
  const jobs = useCaseJobs(c.id, [kind === "initial" ? "draft" : "draft_follow_up"]);
  const draft = drafts.find((d) => d.kind === kind);
  const gen = useMutation({ mutationFn: () => api.createDraft(c.id, { kind }, c.data_version), onSuccess: (j) => jobs.add(j) });
  const title = kind === "initial" ? "Request" : "Follow-up";
  return (
    <Card tone={focus ? "focus" : "default"} className="p-4">
      <SectionTitle
        title={title}
        action={<Button size="sm" variant={focus && !draft ? "primary" : "secondary"} cue={focus && !draft} icon={draft ? <RefreshCw className="size-3.5" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />} loading={gen.isPending} disabled={jobs.ids.length > 0} onClick={() => gen.mutate()}>{draft ? "Regenerate" : kind === "initial" ? "Prepare request" : "Prepare follow-up"}</Button>}
      />
      {jobs.ids.map((id) => (
        <CaseJob key={id} id={id} label={`Writing the ${title.toLowerCase()}`} onDone={() => invalidate(qc, "drafts", "events", "case", "cases")} onRetry={() => gen.mutate()} onDismiss={() => jobs.remove(id)} />
      ))}
      {gen.error && <ErrorBox error={gen.error} onRetry={() => gen.mutate()} />}
      {draft ? <DraftEditor key={draft.id + draft.input_version} draft={draft} onMarkSent={onMarkSent} showSent={kind === "initial" ? ["draft", "prepared"].includes(c.status) : true} focus={focus} /> : !jobs.ids.length && (
        <p className="text-sm text-muted">{kind === "initial" ? "Claimly drafts a message to the company from your documents. You edit and send it yourself." : "After a reply, prepare a follow-up that answers it."}</p>
      )}
    </Card>
  );
}

function DraftEditor({ draft, onMarkSent, showSent, focus }: { draft: Draft; onMarkSent: () => void; showSent: boolean; focus?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const copied = useConfirmFlash();
  const [subject, setSubject] = useState(draft.content.subject);
  const [body, setBody] = useState(draft.content.body);
  const dirty = subject !== draft.content.subject || body !== draft.content.body;
  const save = useMutation({
    mutationFn: () => api.editDraft(draft.id, { subject, body, expected_input_version: draft.input_version }),
    onSuccess: (d) => {
      qc.setQueryData<Draft[]>(qk.drafts(d.case_id), (old) => old?.map((x) => (x.id === d.id ? d : x)));
      toast("Draft saved.");
    },
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      copied.confirm();
      toast("Copied. Copying doesn't mark it as sent.");
    } catch {
      toast("Couldn't copy — select the text and copy it manually.", "warn");
    }
  };
  const conflict = save.error instanceof ApiError && save.error.isConflict;
  return (
    <div className="flex flex-col gap-3">
      {draft.stale && <Notice tone="warn" title="Case details changed">This draft was written before the latest changes. Regenerate it or edit it to match.</Notice>}
      <Field label="Subject" htmlFor={`ds-${draft.id}`}><Input id={`ds-${draft.id}`} value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
      <Field label="Message" htmlFor={`db-${draft.id}`}><Textarea id={`db-${draft.id}`} rows={9} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>To: {draft.content.contact ?? "contact not found in your documents"}{draft.content.contact && draft.content.contact_origin !== "unknown" ? ` (${draft.content.contact_origin === "document" ? "from document" : "added by you"})` : ""}</span>
        {draft.content.attachments.length > 0 && <span>Attach: {draft.content.attachments.join(", ")}</span>}
        {draft.user_edited && <span>Edited by you</span>}
      </div>
      {draft.content.missing_info.length > 0 && <Notice tone="warn" title="Add before sending">{draft.content.missing_info.join(", ")}</Notice>}
      {draft.content.evidence_refs.length > 0 && <Details summary="Quotes used"><EvidenceChips refs={draft.content.evidence_refs} /></Details>}
      {save.error && (conflict ? (
        <Notice tone="warn" title="This draft changed elsewhere" action={<Button size="sm" onClick={() => { save.reset(); invalidate(qc, "drafts"); }}>Load latest</Button>}>
          Your edits weren&apos;t saved. Copy them first if you want to keep them — loading the latest version replaces this text.
        </Notice>
      ) : <ErrorBox error={save.error} onRetry={() => save.mutate()} />)}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          icon={copied.shown ? <SuccessIcon key={copied.key} icon={Check} className="size-4 text-brand-700" /> : <ClipboardCopy className="size-4" aria-hidden />}
          onClick={copy}
        >
          Copy
        </Button>
        {/* One main action: unsaved edits come first; otherwise, when sending is the next step, "I sent it". */}
        <Button variant={dirty ? "primary" : "secondary"} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save edits</Button>
        {showSent && <Button variant={focus && !dirty ? "primary" : "secondary"} cue={focus && !dirty} icon={<Send className="size-4" aria-hidden />} onClick={onMarkSent}>I sent it</Button>}
      </div>
    </div>
  );
}

// ───────── company reply ─────────

export function ReplySection({ c, docs, focus }: { c: Case; docs: Document[]; focus?: boolean }) {
  const qc = useQueryClient();
  const jobs = useCaseJobs(c.id, ["analyze_reply"]);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const m = useMutation({
    mutationFn: () => api.analyzeReply(c.id, { reply_text: text.trim(), document_ids: picked }),
    onSuccess: (j) => {
      jobs.add(j);
      setText("");
      setPicked([]);
    },
  });
  return (
    <Card tone={focus ? "focus" : "default"} className="p-4">
      <SectionTitle title="Company reply" />
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Paste the reply" htmlFor={`reply-${c.id}`}>
          <Textarea id={`reply-${c.id}`} rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the company's email or letter text" />
        </Field>
        {docs.length > 0 && (
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Or choose an uploaded document</legend>
            <div className="flex flex-col gap-1">
              {docs.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={picked.includes(d.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, d.id] : picked.filter((x) => x !== d.id))} />
                  <FileText className="size-4 text-muted" aria-hidden /> <span className="truncate">{d.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {m.error && <ErrorBox error={m.error} onRetry={() => m.mutate()} />}
        <Button type="submit" variant={focus ? "primary" : "secondary"} className="self-start" icon={<MessageSquareReply className="size-4" aria-hidden />} disabled={!text.trim() && !picked.length} loading={m.isPending}>Analyze reply</Button>
      </form>
      <div className="mt-3 flex flex-col gap-2">
        {jobs.ids.map((id) => (
          <CaseJob key={id} id={id} label="Reading the reply" onDone={() => invalidate(qc, "events", "case")} onDismiss={() => jobs.remove(id)} />
        ))}
      </div>
    </Card>
  );
}

export function ReplyAnalysisView({ e }: { e: CaseEvent }) {
  const a = e.reply_analysis;
  if (!a) return null;
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg bg-stone-50 p-3 text-sm">
      <p className="font-medium">{a.company_position}</p>
      <p>{a.summary}</p>
      <p className="text-muted">{a.comparison}</p>
      {a.missing_info.length > 0 && <p className="text-amber-800">Missing: {a.missing_info.join(", ")}</p>}
      <EvidenceChips refs={a.evidence_refs} max={2} />
    </div>
  );
}

// ───────── outcome ─────────

const OUTCOME_LABEL: Record<Outcome["kind"], string> = {
  cash_refund: "Money refunded", service_used: "Service used", repair: "Repaired", replacement: "Replaced",
  voucher_used: "Certificate used", denied: "Denied", closed_without_result: "Closed without result",
};

export function OutcomeSection({ c, focus }: { c: Case; focus?: boolean }) {
  const qc = useQueryClient();
  const outcome = useQuery({
    queryKey: qk.outcome(c.id),
    queryFn: () => api.getOutcome(c.id).catch((e) => {
      if (e instanceof ApiError && e.isNotFound) return null;
      throw e;
    }),
  });
  const [editing, setEditing] = useState(false);
  if (outcome.isLoading) return null;
  const o = outcome.data;
  return (
    <Card tone={focus ? "focus" : "default"} className="p-4">
      <SectionTitle title="Result" action={o && !editing ? <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button> : undefined} />
      {outcome.error && <ErrorBox error={outcome.error} onRetry={() => outcome.refetch()} />}
      {o && !editing ? (
        <div className="flex items-start gap-3 text-sm">
          <Trophy className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden />
          <div>
            <p className="font-medium">{OUTCOME_LABEL[o.kind]}{o.cash_amount_cents !== null ? ` · ${formatCents(o.cash_amount_cents)}` : ""}{o.quantity !== null && ["service_used", "voucher_used"].includes(o.kind) ? ` · ${o.quantity} used` : ""}</p>
            {o.estimated_value_cents !== null && <p className="text-muted">Estimated value {formatCents(o.estimated_value_cents)} ({o.value_origin === "document" ? "from document" : o.value_origin === "user_estimate" ? "your estimate" : "not known"}) — not cash</p>}
            <p className="text-xs text-muted">{o.confirmation_source === "document_supported" ? "Supported by a document" : "Reported by you"} · {formatDateTime(o.confirmed_at)}</p>
            {o.note && <p className="mt-1">{o.note}</p>}
          </div>
        </div>
      ) : o === null && !editing ? (
        <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center">
          <p className="flex-1 text-muted">When it&apos;s settled, record what you actually got — money, a service, a repair, or nothing.</p>
          <Button size="sm" variant={focus ? "primary" : "secondary"} cue={focus} onClick={() => setEditing(true)}>Record result</Button>
        </div>
      ) : (
        <OutcomeForm c={c} existing={o ?? null} onSaved={(saved) => { qc.setQueryData(qk.outcome(c.id), saved); invalidate(qc, "events", "dashboard", "benefit", "benefits", "case", "cases"); setEditing(false); }} onCancel={() => setEditing(false)} />
      )}
    </Card>
  );
}

function OutcomeForm({ c, existing, onSaved, onCancel }: { c: Case; existing: Outcome | null; onSaved: (o: Outcome) => void; onCancel?: () => void }) {
  const [kind, setKind] = useState<Outcome["kind"]>(existing?.kind ?? (c.type === "benefit_use" ? "service_used" : "cash_refund"));
  const [cash, setCash] = useState(existing?.cash_amount_cents != null ? String(existing.cash_amount_cents / 100) : "");
  const [est, setEst] = useState(existing?.estimated_value_cents != null ? String(existing.estimated_value_cents / 100) : "");
  const [qty, setQty] = useState(existing?.quantity != null ? String(existing.quantity) : "1");
  const [source, setSource] = useState<Outcome["confirmation_source"]>(existing?.confirmation_source ?? "user_reported");
  const [note, setNote] = useState(existing?.note ?? "");
  const cashP = parseMoney(cash);
  const estP = parseMoney(est);
  const toCents = (p: typeof cashP) => (p.kind === "ok" ? p.value : p.kind === "empty" ? null : NaN);
  const cashC = toCents(cashP);
  const estC = toCents(estP);
  const cashF = parsedField(cash, cashP, setCash);
  const estF = parsedField(est, estP, setEst);
  const usesUnits = kind === "service_used" || kind === "voucher_used";
  const qtyN = qty === "" ? null : Number(qty);
  const bad = Number.isNaN(cashC) || Number.isNaN(estC) || (usesUnits && qtyN !== null && (!Number.isInteger(qtyN) || qtyN < 0));
  const m = useMutation({
    mutationFn: () => {
      const body: OutcomePut = {
        benefit_id: c.benefit_id, kind, cash_amount_cents: kind === "cash_refund" ? cashC : null, estimated_value_cents: estC,
        value_origin: estC === null ? "not_known" : "user_estimate", quantity: usesUnits ? qtyN : null, currency: "USD",
        confirmation_source: source, confirmed_at: new Date().toISOString(), evidence_refs: [], note: note.trim(),
      };
      return api.setOutcome(c.id, body);
    },
    onSuccess: onSaved,
  });
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (!bad) m.mutate(); }}>
      <p className="text-sm text-muted">Record what actually happened. Approved isn&apos;t the same as received.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What happened" htmlFor="o-kind">
          <Select id="o-kind" value={kind} onChange={(e) => setKind(e.target.value as Outcome["kind"])}>
            {(Object.keys(OUTCOME_LABEL) as Outcome["kind"][]).map((k) => <option key={k} value={k}>{OUTCOME_LABEL[k]}</option>)}
          </Select>
        </Field>
        {kind === "cash_refund" && (
          <Field label="Amount received" htmlFor="o-cash" error={cashF.error} hint={cashF.hint}>
            <Input id="o-cash" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="$0.00" />
          </Field>
        )}
        {usesUnits && (
          <Field label="How many used in this case" htmlFor="o-qty" hint={c.benefit_id ? "Updates the benefit's usage once." : undefined}>
            <Input id="o-qty" type="number" min={0} step={1} value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
        )}
        {kind !== "cash_refund" && kind !== "denied" && kind !== "closed_without_result" && (
          <Field label="Estimated value (optional)" htmlFor="o-est" hint={estF.hint ?? "Your estimate — counted separately from cash."} error={estF.error}>
            <Input id="o-est" inputMode="decimal" value={est} onChange={(e) => setEst(e.target.value)} placeholder="$0" />
          </Field>
        )}
        <Field label="Confirmed by" htmlFor="o-src">
          <Select id="o-src" value={source} onChange={(e) => setSource(e.target.value as Outcome["confirmation_source"])}>
            <option value="user_reported">My own report</option>
            <option value="document_supported">A document I have</option>
          </Select>
        </Field>
      </div>
      <Field label="Note (optional)" htmlFor="o-note"><Input id="o-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {m.error && <ErrorBox error={m.error} onRetry={() => m.mutate()} />}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" icon={<CheckCircle2 className="size-4" aria-hidden />} loading={m.isPending} disabled={bad}>Save result</Button>
        {onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}

// ───────── timeline ─────────

const EVENT_LABEL: Record<CaseEvent["type"], string> = {
  note: "Note", status_change: "Stage changed", company_reply: "Company reply", outcome: "Result", draft_created: "Draft prepared",
};

export function Timeline({ c }: { c: Case }) {
  const qc = useQueryClient();
  const events = useQuery({ queryKey: qk.events(c.id), queryFn: () => listAll((cursor) => api.listCaseEvents(c.id, { cursor, limit: 100 })) });
  const [note, setNote] = useState("");
  const add = useMutation({
    mutationFn: () => api.addCaseNote(c.id, { event_date: new Date().toISOString(), note: note.trim(), attachment_document_ids: [] }),
    onSuccess: () => {
      setNote("");
      invalidate(qc, "events");
    },
  });
  return (
    <Card className="p-4">
      <SectionTitle title="History" />
      {events.error && <ErrorBox error={events.error} onRetry={() => events.refetch()} />}
      {events.data?.length ? (
        <ol className="relative flex flex-col gap-4 border-l border-line pl-4">
          {[...events.data].reverse().map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-white bg-brand-500" aria-hidden />
              <p className="text-xs text-muted">{formatDateTime(e.event_date)} · {EVENT_LABEL[e.type]}{e.new_status ? `: ${CASE_STATUS_LABEL[e.new_status]}` : ""}</p>
              {e.note && <p className="whitespace-pre-line break-words text-sm">{e.note}</p>}
              <ReplyAnalysisView e={e} />
            </li>
          ))}
        </ol>
      ) : <p className="text-sm text-muted">Nothing yet.</p>}
      <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) add.mutate(); }}>
        <label htmlFor={`note-${c.id}`} className="sr-only">Add a note</label>
        <Input id={`note-${c.id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note, e.g. called support" />
        <Button type="submit" icon={<NotebookPen className="size-4" aria-hidden />} disabled={!note.trim()} loading={add.isPending}>Add</Button>
      </form>
      {add.error && <div className="mt-2"><ErrorBox error={add.error} onRetry={() => add.mutate()} /></div>}
    </Card>
  );
}
