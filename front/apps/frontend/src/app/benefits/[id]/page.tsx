"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BellPlus, CalendarDays } from "lucide-react";
import { api } from "@/api/client";
import type { Benefit, Reminder } from "@/api/types";
import { BenefitActions, UsageNumbers } from "@/components/Benefit";
import { DeadlineControls, useBenefitPatch } from "@/components/BenefitReview";
import { EvidenceChips } from "@/components/Evidence";
import { ReminderModal, offsetLabel } from "@/components/Reminders";
import { Badge, Button, Card, Details, ErrorBox, ListSkeleton, NeedsReview, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { BENEFIT_TYPE_LABEL, USAGE_LABEL, formatCents, formatDate } from "@/lib/format";
import { qk } from "@/lib/hooks";

export default function BenefitPage() {
  const { id } = useParams<{ id: string }>();
  const b = useQuery({ queryKey: qk.benefit(id), queryFn: () => api.getBenefit(id) });
  const entry = useQuery({ queryKey: qk.entry(b.data?.entry_id ?? "none"), queryFn: () => api.getEntry(b.data!.entry_id), enabled: !!b.data });
  const reminders = useQuery({ queryKey: qk.reminders({ benefit_id: id }), queryFn: () => api.listReminders({ benefit_id: id, limit: 100 }) });
  const [newReminder, setNewReminder] = useState(false);
  const [edit, setEdit] = useState<Reminder | null>(null);

  if (b.error) return <ErrorBox error={b.error} onRetry={() => b.refetch()} />;
  if (!b.data) return <ListSkeleton rows={3} />;
  const x = b.data;
  const value = formatCents(x.stated_value_cents);

  return (
    <>
      <PageHeader
        back={{ href: "/benefits", label: "Benefits" }}
        title={x.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{BENEFIT_TYPE_LABEL[x.type]}</Badge>
            <Badge>{USAGE_LABEL[x.usage_state]}</Badge>
            {x.needs_review && <NeedsReview />}
            {entry.data && <span>from <Link href={`/vault/${entry.data.id}`} className="text-brand-700 hover:underline">{entry.data.title}</Link>{entry.data.provider ? ` · ${entry.data.provider}` : ""}</span>}
          </span>
        }
      />
      {/* Miller: one block per question — what it is, how much is left, until when, on what
          terms, says who, and what to do next. Each action sits beside the facts it changes. */}
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card aria-labelledby="h-what" className="flex flex-col gap-2 p-4">
            <h2 id="h-what" className="text-xs font-medium uppercase tracking-wide text-muted">What you get</h2>
            <p className="text-sm">{x.description}</p>
            {value && <p className="text-sm">Stated value: <strong>{value}</strong> <span className="text-muted">— printed on the document, not cash.</span></p>}
          </Card>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card aria-labelledby="h-limit" className="flex flex-col gap-3 p-4">
              <h2 id="h-limit" className="text-xs font-medium uppercase tracking-wide text-muted">Limit</h2>
              <UsageNumbers b={x} />
              {x.usage_state === "unknown" && (
                <Notice tone="warn" title="Usage not confirmed">Claimly can&apos;t see past use. Tell it how many you&apos;ve used — this isn&apos;t assumed to be zero.</Notice>
              )}
              <div className="mt-auto"><BenefitActions b={x} show={["mark"]} /></div>
            </Card>
            <Card aria-labelledby="h-date" className="flex flex-col gap-3 p-4">
              <h2 id="h-date" className="text-xs font-medium uppercase tracking-wide text-muted">Date</h2>
              <DeadlineControls b={x} />
            </Card>
          </div>

          <Card tone={x.needs_review ? "focus" : "default"} aria-labelledby="h-terms" className="flex flex-col gap-3 p-4">
            <h2 id="h-terms" className="text-xs font-medium uppercase tracking-wide text-muted">Conditions</h2>
            {x.conditions.length ? (
              <ul className="list-disc space-y-1 pl-5 text-sm">{x.conditions.map((c) => <li key={c}>{c}</li>)}</ul>
            ) : <p className="text-sm text-muted">No conditions listed.</p>}
            {x.instructions.length > 0 && (
              <Details summary="How to use it">
                <ol className="list-decimal space-y-1 pl-5">{x.instructions.map((c) => <li key={c}>{c}</li>)}</ol>
              </Details>
            )}
            <Details summary={`Sources (${x.evidence_refs.length})`}>
              {x.evidence_refs.length ? <EvidenceChips refs={x.evidence_refs} max={10} /> : <p className="text-muted">No source quote.</p>}
            </Details>
            <ConfirmReview b={x} />
          </Card>

          <Card tone={x.needs_review ? "default" : "focus"} aria-labelledby="h-next" className="flex flex-col gap-3 p-4">
            <h2 id="h-next" className="text-xs font-medium uppercase tracking-wide text-muted">Next step</h2>
            <p className="text-sm">Plan when to use it: Claimly opens a case with its own chat and drafts the request. Nothing is marked used until you confirm.</p>
            <BenefitActions b={x} show={["plan", "ask"]} planPrimary={!x.needs_review} />
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card tone="quiet" className="p-4">
            <SectionTitle title="Reminders" action={<Button size="sm" icon={<BellPlus className="size-3.5" aria-hidden />} onClick={() => setNewReminder(true)}>Add</Button>} />
            {reminders.error && <ErrorBox error={reminders.error} />}
            {reminders.data?.data.length ? (
              <ul className="flex flex-col gap-2">
                {reminders.data.data.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => setEdit(r)} className="flex w-full items-start gap-2 rounded-lg border border-line px-3 py-2 text-left text-sm hover:bg-stone-50">
                      <CalendarDays className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{formatDate(r.date)} · {r.local_time}</span>
                        <span className="block text-xs text-muted">{r.offset_days.map(offsetLabel).join(", ") || "No alerts"}</span>
                      </span>
                      {r.status !== "active" && <Badge tone={r.status === "needs_review" ? "warn" : "neutral"}>{r.status === "needs_review" ? "To confirm" : r.status === "cancelled" ? "Off" : "Done"}</Badge>}
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">No reminders.</p>}
          </Card>
        </div>
      </div>
      {newReminder && (
        <ReminderModal open onClose={() => setNewReminder(false)} create={{ title: x.title, date: x.deadline_date ?? x.deadline_rule?.date ?? null, benefit_id: x.id, case_id: null, origin: "user", evidence_refs: [] }} />
      )}
      {edit && <ReminderModal open onClose={() => setEdit(null)} reminder={edit} />}
    </>
  );
}

function ConfirmReview({ b }: { b: Benefit }) {
  const m = useBenefitPatch(b);
  if (!b.needs_review) return null;
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3 sm:flex-row sm:items-center">
      <p className="flex-1 text-sm text-muted">Do these details match your document?</p>
      <Button size="sm" variant="primary" loading={m.isPending} onClick={() => m.mutate({ confirmed_review: true })}>Looks right</Button>
      {m.error && <ErrorBox error={m.error} />}
    </div>
  );
}
