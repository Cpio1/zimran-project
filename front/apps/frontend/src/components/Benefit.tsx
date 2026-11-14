"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CheckCheck, ClipboardList, MessageCircle } from "lucide-react";
import clsx from "clsx";
import { api } from "@/api/client";
import { ApiError } from "@/api/errors";
import type { Benefit } from "@/api/types";
import { BENEFIT_TYPE_LABEL, USAGE_LABEL, formatCents, formatDate, parseCount, usageSummary } from "@/lib/format";
import { ensureThread, invalidate, qk } from "@/lib/hooks";
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, NeedsReview, Notice, Textarea, parsedField } from "./ui";
import { useToast } from "./Toast";

export function UsageMeter({ b }: { b: Benefit }) {
  const known = b.units_total !== null && b.usage_state !== "unknown" && b.used_units !== null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm">
        <span className={clsx("font-medium", b.usage_state === "unknown" && "text-amber-800")}>{usageSummary(b)}</span>
      </p>
      {known && (
        <div className="flex gap-1" aria-hidden>
          {Array.from({ length: Math.min(b.units_total!, 12) }, (_, i) => (
            <span key={i} className={clsx("h-1.5 flex-1 rounded-full", i < b.used_units! ? "bg-track-strong" : "bg-brand-500")} />
          ))}
        </div>
      )}
    </div>
  );
}

export function UsageNumbers({ b }: { b: Benefit }) {
  const cell = (label: string, v: number | null, hint?: string) => (
    <div className="min-w-0 rounded-lg bg-subtle px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{v === null ? <span className="block text-sm font-normal leading-snug text-muted [overflow-wrap:anywhere]">{hint ?? "Not known"}</span> : v}</dd>
    </div>
  );
  return (
    <dl className="grid grid-cols-3 gap-2" aria-label="Usage">
      {cell("Total", b.units_total, "Not stated")}
      {cell("Used", b.used_units, "Not confirmed")}
      {cell("Remaining", b.remaining_units, b.usage_state === "unknown" ? "Confirm usage" : "Not known")}
    </dl>
  );
}

export function BenefitCard({ b, compact }: { b: Benefit; compact?: boolean }) {
  const value = formatCents(b.stated_value_cents);
  return (
    <Card as="article" className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="brand">{BENEFIT_TYPE_LABEL[b.type]}</Badge>
        {b.usage_state !== "unknown" && <Badge>{USAGE_LABEL[b.usage_state]}</Badge>}
        {b.needs_review && <NeedsReview />}
      </div>
      <div className="min-w-0">
        <h3 className="font-semibold leading-snug [overflow-wrap:anywhere]">
          <Link href={`/benefits/${b.id}`} className="hover:underline">{b.title}</Link>
        </h3>
        {!compact && <p className="mt-1 line-clamp-2 text-sm text-muted">{b.description}</p>}
      </div>
      <UsageMeter b={b} />
      <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {b.deadline_date ? (
          <span className="inline-flex items-center gap-1"><CalendarClock className="size-3.5" aria-hidden /> Use by {formatDate(b.deadline_date)}{b.deadline_status === "user_set" ? " (your date)" : ""}</span>
        ) : b.deadline_rule?.date ? (
          <span className="inline-flex items-center gap-1"><CalendarClock className="size-3.5" aria-hidden /> Printed date {formatDate(b.deadline_rule.date)} · to confirm</span>
        ) : null}
        {value && <span>Stated value {value} (not cash)</span>}
      </div>
    </Card>
  );
}

/** Ask Claimly: opens (or creates) the thread of this benefit's entry. */
export function useAskAboutEntry() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const ask = async (entryId: string, documentIds: string[]) => {
    setBusy(true);
    try {
      const t = await ensureThread("entry", { entry_id: entryId, document_ids: documentIds });
      router.push(`/assistant?thread=${t.id}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't open the chat.", "error");
    } finally {
      setBusy(false);
    }
  };
  return { ask, busy };
}

/**
 * Benefit actions. `show` lets a page place each action next to the content it acts on (Fitts):
 * "Mark used" beside the usage numbers, "Plan to use" + "Ask Claimly" in the next-step block.
 * "Plan to use" is the one main action wherever it appears.
 */
export function BenefitActions({ b, onChanged, show = ["plan", "ask", "mark"], planPrimary = true }: { b: Benefit; onChanged?: (b: Benefit) => void; show?: ("plan" | "ask" | "mark")[]; planPrimary?: boolean }) {
  const [markOpen, setMarkOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const { ask, busy } = useAskAboutEntry();
  const docIds = [...new Set(b.evidence_refs.map((r) => r.document_id))];
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {show.includes("plan") && <Button variant={planPrimary ? "primary" : "secondary"} icon={<ClipboardList className="size-4" aria-hidden />} onClick={() => setPlanOpen(true)}>Plan to use</Button>}
        {show.includes("ask") && <Button icon={<MessageCircle className="size-4" aria-hidden />} loading={busy} onClick={() => ask(b.entry_id, docIds)}>Ask Claimly</Button>}
        {show.includes("mark") && <Button icon={<CheckCheck className="size-4" aria-hidden />} onClick={() => setMarkOpen(true)}>Mark used</Button>}
      </div>
      {show.includes("mark") && <MarkUsedDialog open={markOpen} onClose={() => setMarkOpen(false)} benefit={b} onSaved={onChanged} />}
      {show.includes("plan") && <PlanToUseDialog open={planOpen} onClose={() => setPlanOpen(false)} benefit={b} documentIds={docIds} />}
    </>
  );
}

export function MarkUsedDialog({ open, onClose, benefit, onSaved }: { open: boolean; onClose: () => void; benefit: Benefit; onSaved?: (b: Benefit) => void }) {
  const qc = useQueryClient();
  const [current, setCurrent] = useState(benefit);
  const [value, setValue] = useState(String(benefit.used_units ?? ""));
  const [note, setNote] = useState("");
  const [result, setResult] = useState<Benefit | null>(null);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setCurrent(benefit);
      setValue(String(benefit.used_units ?? ""));
      setResult(null);
      setNote("");
    }
  }
  const m = useMutation({
    mutationFn: (used: number) =>
      api.setBenefitUsage(current.id, { used_units: used, confirmed_at: new Date().toISOString(), note, expected_version: current.data_version }),
    onSuccess: (b) => {
      setResult(b);
      setCurrent(b);
      qc.setQueryData(qk.benefit(b.id), b);
      invalidate(qc, "benefits", "dashboard", "entry");
      onSaved?.(b);
    },
  });
  const reload = async () => {
    const fresh = await api.getBenefit(current.id);
    qc.setQueryData(qk.benefit(fresh.id), fresh);
    setCurrent(fresh);
    setValue(String(fresh.used_units ?? ""));
    m.reset();
  };
  const max = current.units_total;
  // Postel: " 2 ", "1,000" and "2.0" are fine; the field explains anything else and keeps the text.
  const parsed = parseCount(value, max);
  const n = parsed.kind === "ok" ? parsed.value : NaN;
  const invalid = parsed.kind !== "ok";
  const feedback = parsedField(value, parsed, setValue);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Mark used"
      footer={
        result ? <Button variant="primary" onClick={onClose}>Done</Button> : (
          <>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={invalid} loading={m.isPending} onClick={() => m.mutate(n)}>Save usage</Button>
          </>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-3" role="status">
          <p className="text-sm">Saved. Here&apos;s where <strong>{result.title}</strong> stands:</p>
          <UsageNumbers b={result} />
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (!invalid) m.mutate(n); }}>
          <p className="text-sm text-muted">
            Enter the <strong className="text-ink">total number you&apos;ve used so far</strong>, including earlier uses — not just today&apos;s.
            {max !== null ? ` The document lists ${max}.` : " The document doesn't state a total, so Claimly won't calculate what's left."}
          </p>
          <Field label="Total used so far" htmlFor="used-units" error={feedback.error} hint={feedback.hint}>
            <Input id="used-units" type="text" inputMode="numeric" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} data-autofocus />
          </Field>
          <Field label="Note (optional)" htmlFor="used-note">
            <Input id="used-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Cleaning on Nov 10" />
          </Field>
          {m.error && <ErrorBox error={m.error} onRetry={() => m.mutate(n)} onReload={reload} />}
        </form>
      )}
    </Modal>
  );
}

export function PlanToUseDialog({ open, onClose, benefit, documentIds }: { open: boolean; onClose: () => void; benefit: Benefit; documentIds: string[] }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [situation, setSituation] = useState(`I'd like to use: ${benefit.title}.`);
  const [desired, setDesired] = useState("Confirm what's available and arrange a time.");
  const m = useMutation({
    mutationFn: () =>
      api.createCase({
        title: `Use: ${benefit.title}`, type: "benefit_use", entry_ids: [benefit.entry_id], document_ids: documentIds, benefit_id: benefit.id,
        situation: situation.trim(), incident_date: null, desired_result: desired.trim() || null,
      }),
    onSuccess: (c) => {
      invalidate(qc, "cases", "dashboard");
      router.push(`/cases/${c.id}`);
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Plan to use"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={!situation.trim()} onClick={() => m.mutate()}>Create plan</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Notice tone="info">This opens a case with its own chat. Nothing is marked as used until you confirm it.</Notice>
        <Field label="What do you need?" htmlFor="plan-situation">
          <Textarea id="plan-situation" rows={3} value={situation} onChange={(e) => setSituation(e.target.value)} />
        </Field>
        <Field label="What result do you want?" htmlFor="plan-desired">
          <Input id="plan-desired" value={desired} onChange={(e) => setDesired(e.target.value)} />
        </Field>
        {m.error && <ErrorBox error={m.error} onRetry={() => m.mutate()} />}
      </div>
    </Modal>
  );
}
