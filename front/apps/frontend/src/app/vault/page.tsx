"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Archive, Search, Upload } from "lucide-react";
import { api } from "@/api/client";
import { ENTRY_CATEGORIES } from "@/api/types";
import { entryNeedsReview } from "@/components/Entry";
import { Badge, Button, ButtonLink, Card, EmptyState, ErrorBox, Input, ListSkeleton, NeedsReview, PageHeader, Select } from "@/components/ui";
import { CATEGORY_LABEL, formatDate } from "@/lib/format";
import { useDebounced } from "@/lib/useDebounced";
import { useUrlState } from "@/lib/useUrlState";

export default function VaultPage() {
  return <Suspense><VaultInner /></Suspense>;
}

function VaultInner() {
  const [q, setQ] = useUrlState("q", "", 250);
  const [category, setCategory] = useUrlState("type");
  const dq = useDebounced(q.trim());
  const list = useInfiniteQuery({
    queryKey: ["entries", { q: dq, category, infinite: true }],
    queryFn: ({ pageParam }) => api.listEntries({ q: dq || undefined, category: category || undefined, cursor: pageParam, limit: 24 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });
  const items = list.data?.pages.flatMap((p) => p.data) ?? [];
  const filtered = !!dq || !!category;

  return (
    <>
      <PageHeader title="Vault" subtitle="Warranties, policies, plans, certificates and receipts." actions={<ButtonLink href="/upload" variant="primary" icon={<Upload className="size-4" aria-hidden />}>Upload document</ButtonLink>} />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input type="search" aria-label="Search by name, company or product" placeholder="Search name, company or product" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="sm:w-56">
          <option value="">All types</option>
          {ENTRY_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </Select>
      </div>
      {list.error && <ErrorBox error={list.error} onRetry={() => list.refetch()} />}
      {list.isLoading && <ListSkeleton rows={4} />}
      {list.data && items.length === 0 && (
        filtered ? <EmptyState title="Nothing matches" body="Try another word or type." /> : (
          <EmptyState icon={<Archive className="size-8" aria-hidden />} title="Your vault is empty" body="Upload a document to keep it here and find what it includes." action={<ButtonLink href="/upload" variant="primary">Upload document</ButtonLink>} />
        )
      )}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((e) => {
          const dates = Object.entries(e.facts).filter(([, f]) => typeof f.value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f.value)).slice(0, 2);
          return (
            <Card as="li" key={e.id} className="p-4 hover:border-brand-200">
              <Link href={`/vault/${e.id}`} className="flex h-full flex-col gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge>{CATEGORY_LABEL[e.category]}</Badge>
                  {entryNeedsReview(e) && <NeedsReview />}
                </div>
                <h2 className="font-semibold leading-snug [overflow-wrap:anywhere]">{e.title}</h2>
                {(e.provider || e.subject) && <p className="text-sm text-muted">{[e.provider, e.subject].filter(Boolean).join(" · ")}</p>}
                <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-1 text-xs text-muted">
                  <span>{e.benefit_ids.length} benefit{e.benefit_ids.length === 1 ? "" : "s"}</span>
                  <span>{e.document_ids.length} file{e.document_ids.length === 1 ? "" : "s"}</span>
                  {dates.map(([k, f]) => <span key={k}>{k.replace(/_/g, " ")}: {formatDate(f.value as string)}</span>)}
                </div>
              </Link>
            </Card>
          );
        })}
      </ul>
      {list.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button onClick={() => list.fetchNextPage()} loading={list.isFetchingNextPage}>Load more</Button>
        </div>
      )}
    </>
  );
}
