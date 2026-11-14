"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bell, CalendarDays, FlaskConical, FolderKanban, Upload } from "lucide-react";
import { api } from "@/api/client";
import type { Dashboard } from "@/api/types";
import { BenefitCard } from "@/components/Benefit";
import { Badge, ButtonLink, Card, ErrorBox, ListSkeleton, PageHeader, SectionTitle } from "@/components/ui";
import { CASE_NEXT_STEP, CASE_STATUS_LABEL, daysUntil, formatCents, formatDate } from "@/lib/format";
import { qk } from "@/lib/hooks";

export default function HomePage() {
  const dash = useQuery({ queryKey: qk.dashboard, queryFn: api.getDashboard });
  const entries = useQuery({ queryKey: qk.entries({ limit: 1 }), queryFn: () => api.listEntries({ limit: 1 }) });
  const isNew = entries.data && entries.data.data.length === 0;

  return (
    <>
      <PageHeader title="Your benefits" subtitle="What you already paid for, and what to do next." />
      {/* Staging: uploading is the one main action on Home; everything below supports it. */}
      {entries.data && <UploadStage isNew={!!isNew} />}
      {dash.error && <ErrorBox error={dash.error} onRetry={() => dash.refetch()} />}
      {dash.isLoading && <ListSkeleton rows={3} />}
      {dash.data && !isNew && <DashboardBody d={dash.data} />}
    </>
  );
}

function UploadStage({ isNew }: { isNew: boolean }) {
  return (
    <Card tone="focus" aria-labelledby="h-upload" className={isNew ? "mb-6 flex flex-col items-start gap-5 p-6 sm:p-8" : "mb-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-5"}>
      <div className={isNew ? "flex size-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600" : "hidden size-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 sm:flex"}>
        <Upload className={isNew ? "size-7" : "size-6"} aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <h2 id="h-upload" className={isNew ? "text-xl font-semibold tracking-tight sm:text-2xl" : "text-lg font-semibold"}>
          {isNew ? "Start with one document" : "Add another document"}
        </h2>
        <p className={isNew ? "mt-2 max-w-xl text-sm text-muted sm:text-base" : "mt-0.5 text-sm text-muted"}>
          {isNew ? (
            <>
              Upload a warranty, insurance policy, service plan, certificate or receipt. Claimly finds the benefits it describes, the dates that
              matter and how to use them. No account needed — this demo space lives in your browser&apos;s session.
            </>
          ) : (
            "A warranty, policy, certificate or receipt. Claimly finds the benefits and dates in it."
          )}
        </p>
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
        <ButtonLink href="/upload" variant="primary" size="lg" icon={<Upload className="size-4" aria-hidden />}>Upload document</ButtonLink>
        {isNew && <ButtonLink href="/upload?sample=1" variant="ghost" size="lg" icon={<FlaskConical className="size-4" aria-hidden />}>Try a sample document</ButtonLink>}
      </div>
    </Card>
  );
}

function nextActions(d: Dashboard) {
  const out: { label: string; href: string; tone?: "warn" }[] = [];
  if (d.usage_unknown_count > 0) out.push({ label: `Confirm usage for ${d.usage_unknown_count} benefit${d.usage_unknown_count === 1 ? "" : "s"}`, href: "/benefits?filter=confirm", tone: "warn" });
  const review = d.next_benefits.filter((b) => b.needs_review);
  if (review.length) out.push({ label: `Check ${review.length} detail${review.length === 1 ? "" : "s"} found in your documents`, href: `/review/${review[0].entry_id}`, tone: "warn" });
  for (const r of d.upcoming_reminders.slice(0, 2)) {
    const n = daysUntil(r.date);
    if (n <= 30) out.push({ label: `${r.title} — ${n <= 0 ? "today" : `in ${n} day${n === 1 ? "" : "s"}`}`, href: r.benefit_id ? `/benefits/${r.benefit_id}` : r.case_id ? `/cases/${r.case_id}` : "/calendar" });
  }
  for (const c of d.active_cases) {
    if (c.status === "prepared") out.push({ label: `Send your request: ${c.title}`, href: `/cases/${c.id}` });
    if (c.status === "approved") out.push({ label: `Record what you received: ${c.title}`, href: `/cases/${c.id}` });
  }
  return out.slice(0, 4);
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-subtle-strong/60 px-3 py-2.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
      {hint && <dd className="text-[11px] leading-tight text-muted">{hint}</dd>}
    </div>
  );
}

function DashboardBody({ d }: { d: Dashboard }) {
  const actions = nextActions(d);
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-5 lg:col-span-2">
        <Card className="p-4">
          <SectionTitle title="Next actions" />
          {actions.length ? (
            <ul className="flex flex-col divide-y divide-line">
              {actions.map((a) => (
                <li key={a.label}>
                  <Link href={a.href} data-squish="" className="flex items-center gap-3 py-2.5 text-sm hover:text-brand-700">
                    <span className={a.tone === "warn" ? "size-2 shrink-0 rounded-full bg-amber-500" : "size-2 shrink-0 rounded-full bg-brand-500"} aria-hidden />
                    <span className="min-w-0 flex-1">{a.label}</span>
                    <ArrowRight data-anticipate="right" className="size-4 shrink-0 text-muted" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nothing urgent. Add another document to find more benefits.</p>
          )}
        </Card>

        <section aria-labelledby="h-benefits">
          <SectionTitle id="h-benefits" title="Benefits to use" action={<Link href="/benefits" className="hit-y inline-block text-sm text-brand-700 hover:underline">View all</Link>} />
          {d.next_benefits.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {d.next_benefits.slice(0, 4).map((b) => <BenefitCard key={b.id} b={b} compact />)}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-line bg-surface p-4 text-sm text-muted">No open benefits found yet.</p>
          )}
        </section>
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        <Card tone="quiet" className="p-4">
          <SectionTitle title="Results" />
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Money</p>
          <dl className="mb-4 grid grid-cols-2 gap-2">
            <Metric label="Cash recovered" value={formatCents(d.cash_recovered_cents)!} />
            <Metric label="Approved, not received" value={formatCents(d.approved_not_received_cents)!} />
            <div className="col-span-2">
              <Metric label="Stated value in documents" value={formatCents(d.document_valued_benefits_cents)!} hint="Face value printed on certificates — not cash" />
            </div>
          </dl>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Services</p>
          <dl className="grid grid-cols-3 gap-2">
            <Metric label="Available" value={String(d.available_benefits_count)} />
            <Metric label="To confirm" value={String(d.usage_unknown_count)} />
            <Metric label="Used" value={String(d.services_used_units)} />
          </dl>
        </Card>

        <Card tone="quiet" className="p-4">
          <SectionTitle title="Coming up" action={<Link href="/calendar" className="hit-y inline-block text-sm text-brand-700 hover:underline">Calendar</Link>} />
          {d.upcoming_reminders.length ? (
            <ul className="flex flex-col gap-2.5">
              {d.upcoming_reminders.slice(0, 5).map((r) => (
                <li key={r.id} className="flex items-start gap-3 text-sm">
                  <CalendarDays className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <Link href={r.benefit_id ? `/benefits/${r.benefit_id}` : r.case_id ? `/cases/${r.case_id}` : "/calendar"} className="font-medium hover:underline">{r.title}</Link>
                    <p className="text-xs text-muted">{formatDate(r.date)}{r.status === "needs_review" && " · date to confirm"}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted"><Bell className="size-4" aria-hidden /> No upcoming dates.</p>
          )}
        </Card>

        <Card tone="quiet" className="p-4">
          <SectionTitle title="Active cases" action={<Link href="/cases" className="hit-y inline-block text-sm text-brand-700 hover:underline">View all</Link>} />
          {d.active_cases.length ? (
            <ul className="flex flex-col gap-3">
              {d.active_cases.slice(0, 4).map((c) => (
                <li key={c.id} className="text-sm">
                  <div className="flex items-center gap-2">
                    <FolderKanban className="size-4 shrink-0 text-brand-600" aria-hidden />
                    <Link href={`/cases/${c.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{c.title}</Link>
                    <Badge>{CASE_STATUS_LABEL[c.status]}</Badge>
                  </div>
                  <p className="ml-6 text-xs text-muted">{CASE_NEXT_STEP[c.status]}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No open cases. Use “Plan to use” on a benefit to start one.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
