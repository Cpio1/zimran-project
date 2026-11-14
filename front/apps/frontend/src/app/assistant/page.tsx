"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { FileText, FolderKanban, MessagesSquare } from "lucide-react";
import { api, listAll } from "@/api/client";
import type { Thread } from "@/api/types";
import { Chat } from "@/components/Chat";
import { Card, ErrorBox, ListSkeleton, PageHeader, Select } from "@/components/ui";
import { ensureThread, qk, useAllEntries } from "@/lib/hooks";

export default function AssistantPage() {
  return <Suspense><AssistantInner /></Suspense>;
}

function AssistantInner() {
  const params = useSearchParams();
  const router = useRouter();
  const selected = params.get("thread");
  const general = useQuery({ queryKey: ["thread", "vault"], queryFn: () => ensureThread("vault"), staleTime: Infinity });
  const threads = useQuery({ queryKey: qk.threads({ all: true }), queryFn: () => listAll((cursor) => api.listThreads({ cursor, limit: 100 })), enabled: !!general.data });
  const entries = useAllEntries();
  const cases = useQuery({ queryKey: qk.cases({ known: true }), queryFn: () => listAll((cursor) => api.listCases({ cursor, limit: 100 })) });

  const name = useMemo(() => {
    const e = new Map((entries.data ?? []).map((x) => [x.id, x.title]));
    const c = new Map((cases.data ?? []).map((x) => [x.id, x.title]));
    return (t: Thread) => (t.scope === "vault" ? "All documents" : t.scope === "entry" ? e.get(t.entry_id ?? "") ?? "Document" : c.get(t.case_id ?? "") ?? "Case");
  }, [entries.data, cases.data]);

  const list = useMemo(() => {
    const all = threads.data ?? (general.data ? [general.data] : []);
    const vault = all.filter((t) => t.scope === "vault").slice(0, 1);
    return [...vault, ...all.filter((t) => t.scope === "entry"), ...all.filter((t) => t.scope === "case")];
  }, [threads.data, general.data]);

  const current = list.find((t) => t.id === selected) ?? (selected ? undefined : general.data);
  // A thread id from a link may not be listed yet (just created): refetch once.
  useEffect(() => {
    if (selected && threads.data && !threads.data.some((t) => t.id === selected)) void threads.refetch();
  }, [selected, threads]);

  const pick = (id: string) => router.replace(`/assistant?thread=${id}`);
  const Icon = ({ t }: { t: Thread }) => (t.scope === "vault" ? <MessagesSquare className="size-4" aria-hidden /> : t.scope === "entry" ? <FileText className="size-4" aria-hidden /> : <FolderKanban className="size-4" aria-hidden />);

  return (
    <>
      <PageHeader title="Assistant" subtitle="Answers come from your documents, with quotes. Claimly says so when a document doesn't cover something." />
      {general.error && <ErrorBox error={general.error} onRetry={() => general.refetch()} />}
      <div className="grid gap-4 md:grid-cols-[220px_1fr] lg:grid-cols-[260px_1fr]">
        <div className="md:hidden">
          <label htmlFor="thread-select" className="sr-only">Conversation</label>
          <Select id="thread-select" value={current?.id ?? ""} onChange={(e) => pick(e.target.value)}>
            {list.map((t) => <option key={t.id} value={t.id}>{t.scope === "vault" ? "All documents" : `${t.scope === "entry" ? "Document" : "Case"}: ${name(t)}`}</option>)}
          </Select>
        </div>
        <nav aria-label="Conversations" className="hidden flex-col gap-1 md:flex">
          {list.map((t, i) => (
            <div key={t.id}>
              {(i === 0 || list[i - 1].scope !== t.scope) && t.scope !== "vault" && (
                <p className="mb-1 mt-3 px-3 text-xs font-medium uppercase tracking-wide text-muted">{t.scope === "entry" ? "Documents" : "Cases"}</p>
              )}
              <button type="button" onClick={() => pick(t.id)} aria-current={current?.id === t.id ? "page" : undefined}
                className={clsx("flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm", current?.id === t.id ? "bg-brand-50 font-medium text-brand-700" : "text-muted hover:bg-subtle-strong hover:text-ink")}>
                <Icon t={t} /> <span className="truncate">{name(t)}</span>
              </button>
            </div>
          ))}
        </nav>
        <Card className="flex h-[calc(100dvh-15rem)] min-h-[420px] flex-col p-4 md:h-[calc(100dvh-12rem)]">
          {!current ? (
            selected && threads.isFetched ? <p className="text-sm text-muted">This conversation isn&apos;t available.</p> : <ListSkeleton rows={2} />
          ) : (
            <>
              <p className="mb-3 border-b border-line pb-3 text-sm text-muted">
                {current.scope === "vault" ? "Asking about all your documents" : current.scope === "entry" ? `Asking only about: ${name(current)}` : `Case chat: ${name(current)}`}
              </p>
              <Chat key={current.id} thread={current} className="flex-1" />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
