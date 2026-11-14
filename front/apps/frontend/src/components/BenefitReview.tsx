"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, Check } from "lucide-react";
import { api } from "@/api/client";
import type { Benefit, BenefitPatch } from "@/api/types";
import { BENEFIT_TYPE_LABEL, describeRule, formatCents, formatDate } from "@/lib/format";
import { invalidate, qk } from "@/lib/hooks";
import { EvidenceChips } from "./Evidence";
import { UsageMeter } from "./Benefit";
import { Badge, Button, Card, Details, ErrorBox, Input, NeedsReview } from "./ui";

export const DEADLINE_STATUS_LABEL: Record<Benefit["deadline_status"], string> = {
  document_confirmed: "From the document",
  user_set: "Set by you",
  needs_review: "Needs your confirmation",
  not_known: "No date found",
};

export function useBenefitPatch(b: Benefit) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Omit<BenefitPatch, "expected_version">) => api.patchBenefit(b.id, { ...patch, expected_version: b.data_version }),
    onSuccess: (nb) => {
      qc.setQueryData(qk.benefit(nb.id), nb);
      invalidate(qc, "benefits", "dashboard", "reminders");
    },
  });
}

export function DeadlineControls({ b }: { b: Benefit }) {
  const m = useBenefitPatch(b);
  const qc = useQueryClient();
  const [date, setDate] = useState(b.deadline_date ?? b.deadline_rule?.date ?? "");
  const [editing, setEditing] = useState(false);
  const rule = describeRule(b.deadline_rule);
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{b.deadline_date ? formatDate(b.deadline_date) : "No confirmed date"}</span>
        <Badge tone={b.deadline_status === "needs_review" ? "warn" : b.deadline_status === "not_known" ? "neutral" : "brand"}>{DEADLINE_STATUS_LABEL[b.deadline_status]}</Badge>
      </div>
      {rule && <p className="text-xs text-muted">Document says: {rule}{b.deadline_rule?.last_day_inclusion === "unknown" ? " · unclear whether the last day counts" : ""}</p>}
      <div className="flex flex-wrap gap-2">
        {b.deadline_status === "needs_review" && b.deadline_rule?.date && (
          <Button size="sm" icon={<CalendarCheck className="size-3.5" aria-hidden />} loading={m.isPending} onClick={() => m.mutate({ deadline_date: b.deadline_rule!.date, deadline_origin: "document" })}>
            Use printed date
          </Button>
        )}
        {!editing ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>{b.deadline_date ? "Change date" : "Set a date"}</Button>
        ) : (
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (date) m.mutate({ deadline_date: date, deadline_origin: "user" }, { onSuccess: () => setEditing(false) }); }}>
            <Input type="date" aria-label="Your date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
            <Button size="sm" type="submit" variant="primary" disabled={!date} loading={m.isPending}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </form>
        )}
      </div>
      {m.error && <ErrorBox error={m.error} onReload={() => { m.reset(); qc.invalidateQueries({ queryKey: qk.benefit(b.id) }); invalidate(qc, "benefits"); }} />}
    </div>
  );
}

export function BenefitReviewCard({ b }: { b: Benefit }) {
  const m = useBenefitPatch(b);
  const qc = useQueryClient();
  const value = formatCents(b.stated_value_cents);
  return (
    <Card as="article" className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="brand">{BENEFIT_TYPE_LABEL[b.type]}</Badge>
        {b.needs_review && <NeedsReview />}
      </div>
      <div>
        <h3 className="font-semibold"><Link href={`/benefits/${b.id}`} className="hover:underline">{b.title}</Link></h3>
        <p className="mt-1 text-sm text-muted">{b.description}</p>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted">Limit</dt>
          <dd><UsageMeter b={b} /></dd>
        </div>
        {value && (
          <div>
            <dt className="text-xs text-muted">Stated value</dt>
            <dd className="font-medium">{value} <span className="text-xs font-normal text-muted">(printed value, not cash)</span></dd>
          </div>
        )}
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted">Date</dt>
          <dd><DeadlineControls b={b} /></dd>
        </div>
      </dl>
      {b.conditions.length > 0 && (
        <Details summary={`Conditions (${b.conditions.length})`}>
          <ul className="list-disc space-y-1 pl-5">{b.conditions.map((c) => <li key={c}>{c}</li>)}</ul>
        </Details>
      )}
      <EvidenceChips refs={b.evidence_refs} max={2} />
      {b.needs_review && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <Button size="sm" variant="primary" icon={<Check className="size-3.5" aria-hidden />} loading={m.isPending} onClick={() => m.mutate({ confirmed_review: true })}>Looks right</Button>
          <span className="text-xs text-muted">Confirms the details match your document. Usage is confirmed separately.</span>
        </div>
      )}
      {m.error && <ErrorBox error={m.error} onReload={() => { m.reset(); qc.invalidateQueries({ queryKey: qk.benefit(b.id) }); invalidate(qc, "benefits"); }} />}
    </Card>
  );
}
