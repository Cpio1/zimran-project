"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gift, Search } from "lucide-react";
import clsx from "clsx";
import { api, listAll } from "@/api/client";
import type { Benefit } from "@/api/types";
import { BenefitCard } from "@/components/Benefit";
import { ButtonLink, EmptyState, ErrorBox, Input, ListSkeleton, PageHeader } from "@/components/ui";
import { daysUntil } from "@/lib/format";
import { qk } from "@/lib/hooks";
import { useDebounced } from "@/lib/useDebounced";

const FILTERS: { id: string; label: string; test: (b: Benefit) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "available", label: "Available", test: (b) => b.usage_state === "unused" || (b.usage_state === "partial" && b.remaining_units !== 0) },
  { id: "confirm", label: "To confirm", test: (b) => b.usage_state === "unknown" || b.needs_review },
  { id: "used", label: "Used", test: (b) => b.usage_state === "partial" || b.usage_state === "used" },
  { id: "soon", label: "Date coming up", test: (b) => { const d = b.deadline_date ?? b.deadline_rule?.date; return !!d && daysUntil(d) >= 0 && daysUntil(d) <= 60; } },
];

export default function BenefitsPage() {
  return <Suspense><BenefitsInner /></Suspense>;
}

function BenefitsInner() {
  const params = useSearchParams();
  const [filter, setFilter] = useState(params.get("filter") ?? "all");
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const list = useQuery({ queryKey: qk.benefits({ q: dq, all: true }), queryFn: () => listAll((cursor) => api.listBenefits({ q: dq || undefined, cursor, limit: 100 })) });
  const f = FILTERS.find((x) => x.id === filter) ?? FILTERS[0];
  const items = useMemo(() => (list.data ?? []).filter(f.test), [list.data, f]);

  return (
    <>
      <PageHeader title="Benefits" subtitle="Services, coverage, certificates and member perks found in your documents." actions={<ButtonLink href="/calendar">Calendar</ButtonLink>} />
      <div className="mb-4 flex flex-col gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input type="search" aria-label="Search benefits" placeholder="Search benefits" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <div role="tablist" aria-label="Filter" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {FILTERS.map((x) => (
            <button key={x.id} role="tab" aria-selected={filter === x.id} type="button" onClick={() => setFilter(x.id)}
              className={clsx("shrink-0 rounded-full px-3 py-1.5 text-sm", filter === x.id ? "bg-ink text-white" : "bg-white text-muted ring-1 ring-line hover:text-ink")}>
              {x.label}
              {list.data && <span className="ml-1.5 tabular-nums opacity-70">{list.data.filter(x.test).length}</span>}
            </button>
          ))}
        </div>
      </div>
      {list.error && <ErrorBox error={list.error} onRetry={() => list.refetch()} />}
      {list.isLoading && <ListSkeleton rows={3} />}
      {list.data && !items.length && (
        list.data.length ? <EmptyState title="Nothing in this view" /> : (
          <EmptyState icon={<Gift className="size-8" aria-hidden />} title="No benefits yet" body="Upload a document and Claimly will list the services, coverage and certificates it describes." action={<ButtonLink href="/upload" variant="primary">Upload document</ButtonLink>} />
        )
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{items.map((b) => <BenefitCard key={b.id} b={b} />)}</div>
    </>
  );
}
