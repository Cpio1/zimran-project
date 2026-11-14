"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { api, listAll } from "@/api/client";
import { trackedJobs, untrackJob } from "@/api/jobs";
import type { Job } from "@/api/types";
import { BenefitReviewCard } from "@/components/BenefitReview";
import { DocumentList, FactsList, StaleSourceNotice, useEntryDocuments } from "@/components/Entry";
import { JobStatusView } from "@/components/JobStatus";
import { SampleModeBadge } from "@/components/AppShell";
import { API_MODE } from "@/api/config";
import { ButtonLink, Card, ErrorBox, ListSkeleton, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { CATEGORY_LABEL } from "@/lib/format";
import { invalidate, qk, useJob } from "@/lib/hooks";

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const entry = useQuery({ queryKey: qk.entry(id), queryFn: () => api.getEntry(id) });
  const docs = useEntryDocuments(entry.data);
  const benefits = useQuery({ queryKey: qk.benefits({ entry_id: id, all: true }), queryFn: () => listAll((cursor) => api.listBenefits({ entry_id: id, cursor, limit: 100 })) });
  const [jobs, setJobs] = useState<string[]>([]);
  useEffect(() => setJobs(trackedJobs(id).map((j) => j.id)), [id]);

  const onDone = (j: Job) => {
    untrackJob(j.id);
    invalidate(qc, "entry", "document", "benefits", "benefit", "dashboard", "reminders");
  };

  if (entry.error) return <ErrorBox error={entry.error} onRetry={() => entry.refetch()} />;
  if (!entry.data) return <ListSkeleton rows={3} />;
  const e = entry.data;
  const loadedDocs = docs.map((q) => q.data).filter((d): d is NonNullable<typeof d> => !!d);
  const processing = loadedDocs.some((d) => d.status === "uploaded" || d.status === "processing");
  const toReview = (benefits.data ?? []).filter((b) => b.needs_review).length + Object.values(e.facts).filter((f) => f.needs_review).length;
  // Staging: the first benefit still waiting for a check is the next step; once it's confirmed,
  // the next one takes over.
  const activeId = processing ? null : benefits.data?.find((b) => b.needs_review)?.id ?? null;

  return (
    <>
      <PageHeader
        title={`Review: ${e.title}`}
        subtitle={<>{CATEGORY_LABEL[e.category]}{e.provider ? ` · ${e.provider}` : ""}</>}
        back={{ href: `/vault/${e.id}`, label: "Entry" }}
        actions={<ButtonLink href={`/vault/${e.id}`} variant={toReview || processing ? "ghost" : "primary"} cue={!toReview && !processing}>{toReview ? "Finish later" : "Done"}</ButtonLink>}
      />
      <div className="flex flex-col gap-5">
        {API_MODE === "mock" && (
          <Notice tone="warn" title={<span className="inline-flex items-center gap-2">Sample analysis <SampleModeBadge /></span>}>
            In sample mode the results below come from a built-in template, not from reading your file.
          </Notice>
        )}
        {jobs.map((j) => <TrackedJob key={j} id={j} onDone={onDone} />)}
        <StaleSourceNotice docs={loadedDocs} />

        {benefits.data && !processing && (
          <Card className="flex items-start gap-3 border-brand-100 bg-brand-50/60 p-4 sm:p-5">
            <Sparkles className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden />
            <div className="text-sm">
              <p className="text-lg font-semibold leading-snug">{benefits.data.length ? `Found ${benefits.data.length} benefit${benefits.data.length === 1 ? "" : "s"}` : "No benefits found in this document"}</p>
              <p className="text-muted">{toReview ? `${toReview} item${toReview === 1 ? "" : "s"} need${toReview === 1 ? "s" : ""} your check — mostly dates and limits.` : "Everything important is confirmed."}</p>
            </div>
          </Card>
        )}

        <section aria-labelledby="h-b">
          <SectionTitle id="h-b" title="Benefits" />
          {benefits.isLoading && <ListSkeleton rows={1} />}
          {benefits.error && <ErrorBox error={benefits.error} onRetry={() => benefits.refetch()} />}
          <div className="grid gap-3 lg:grid-cols-2">
            {benefits.data?.map((b) => <BenefitReviewCard key={b.id} b={b} active={b.id === activeId} />)}
          </div>
          {benefits.data?.length === 0 && !processing && <p className="text-sm text-muted">Nothing that looks like a service, coverage or certificate was found. You can still keep the document here.</p>}
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card tone="quiet" className="p-4">
            <SectionTitle title="Key details" />
            <FactsList entry={e} editable />
          </Card>
          <Card tone="quiet" className="p-4">
            <SectionTitle title="Files" />
            <DocumentList entry={e} docs={docs} />
          </Card>
        </div>
      </div>
    </>
  );
}

function TrackedJob({ id, onDone }: { id: string; onDone: (j: Job) => void }) {
  const job = useJob(id, onDone);
  if (!job.data || job.data.status === "succeeded") return null;
  return <Card tone="focus" className="p-4"><JobStatusView job={job.data} label="Analyzing document" /></Card>;
}
