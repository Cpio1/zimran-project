"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, FilePlus2, MessageCircle, Pencil, Trash2 } from "lucide-react";
import { api, listAll } from "@/api/client";
import type { Entry } from "@/api/types";
import { BenefitCard, useAskAboutEntry } from "@/components/Benefit";
import { DocumentList, FactsList, StaleSourceNotice, entryNeedsReview, useEntryDocuments } from "@/components/Entry";
import { useToast } from "@/components/Toast";
import { Badge, Button, ButtonLink, Card, ErrorBox, Field, Input, ListSkeleton, Modal, NeedsReview, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { CASE_STATUS_LABEL, CATEGORY_LABEL, formatDate } from "@/lib/format";
import { invalidate, qk } from "@/lib/hooks";

export default function EntryPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const entry = useQuery({ queryKey: qk.entry(id), queryFn: () => api.getEntry(id) });
  const docs = useEntryDocuments(entry.data);
  const benefits = useQuery({ queryKey: qk.benefits({ entry_id: id, all: true }), queryFn: () => listAll((cursor) => api.listBenefits({ entry_id: id, cursor, limit: 100 })) });
  const cases = useQuery({ queryKey: qk.cases({ entry_id: id }), queryFn: () => listAll((cursor) => api.listCases({ entry_id: id, cursor, limit: 100 })) });
  const reminders = useQuery({
    queryKey: qk.reminders({ entry: id, ids: entry.data?.benefit_ids }),
    queryFn: async () => (await Promise.all((entry.data?.benefit_ids ?? []).map((b) => api.listReminders({ benefit_id: b, limit: 100 }).then((r) => r.data)))).flat(),
    enabled: !!entry.data,
  });
  const { ask, busy } = useAskAboutEntry();
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const del = useMutation({
    mutationFn: () => api.deleteEntry(id),
    onSuccess: () => {
      invalidate(qc, "entries", "dashboard", "benefits", "reminders");
      toast("Entry deleted.");
      router.push("/vault");
    },
  });

  if (entry.error) return <ErrorBox error={entry.error} onRetry={() => entry.refetch()} />;
  if (!entry.data) return <ListSkeleton rows={4} />;
  const e = entry.data;
  const loadedDocs = docs.map((q) => q.data).filter((d): d is NonNullable<typeof d> => !!d);

  return (
    <>
      <PageHeader
        back={{ href: "/vault", label: "Vault" }}
        title={e.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge>{CATEGORY_LABEL[e.category]}</Badge>
            {[e.provider, e.subject].filter(Boolean).join(" · ")}
            {entryNeedsReview(e) && <NeedsReview />}
          </span>
        }
        actions={
          <>
            <Button variant="primary" icon={<MessageCircle className="size-4" aria-hidden />} loading={busy} onClick={() => ask(e.id, e.document_ids)}>Ask about this</Button>
            <ButtonLink href={`/upload?entry=${e.id}`} icon={<FilePlus2 className="size-4" aria-hidden />}>Add document</ButtonLink>
            <Button icon={<Pencil className="size-4" aria-hidden />} onClick={() => setEditOpen(true)}>Edit</Button>
            <Button variant="ghost" aria-label="Delete entry" onClick={() => setDelOpen(true)}><Trash2 className="size-4" aria-hidden /></Button>
          </>
        }
      />
      <div className="flex flex-col gap-5">
        <StaleSourceNotice docs={loadedDocs} />
        {(entryNeedsReview(e) || benefits.data?.some((b) => b.needs_review)) && (
          <Notice tone="warn" title="Some details need your check" action={<ButtonLink size="sm" href={`/review/${e.id}`}>Review</ButtonLink>}>Dates, limits or amounts that Claimly couldn&apos;t confirm from the document.</Notice>
        )}
        <section aria-labelledby="h-benefits">
          <SectionTitle id="h-benefits" title="Benefits" />
          {benefits.error && <ErrorBox error={benefits.error} onRetry={() => benefits.refetch()} />}
          {benefits.data?.length === 0 && <p className="text-sm text-muted">No benefits found in these documents.</p>}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{benefits.data?.map((b) => <BenefitCard key={b.id} b={b} />)}</div>
        </section>
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="p-4">
            <SectionTitle title="Key details" action={<Link href={`/review/${e.id}`} className="text-sm text-brand-700 hover:underline">Review</Link>} />
            <FactsList entry={e} />
          </Card>
          <Card className="p-4">
            <SectionTitle title="Files" />
            <DocumentList entry={e} docs={docs} allowDelete />
          </Card>
          <Card className="p-4">
            <SectionTitle title="Dates" action={<Link href="/calendar" className="text-sm text-brand-700 hover:underline">Calendar</Link>} />
            {reminders.data?.length ? (
              <ul className="flex flex-col gap-2 text-sm">
                {reminders.data.filter((r) => r.status !== "cancelled").map((r) => (
                  <li key={r.id} className="flex items-center gap-2">
                    <CalendarDays className="size-4 shrink-0 text-brand-600" aria-hidden />
                    <span className="min-w-0 flex-1">{r.title}</span>
                    <span className="text-muted">{formatDate(r.date)}</span>
                    {r.status === "needs_review" && <NeedsReview />}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">No dates yet.</p>}
          </Card>
          <Card className="p-4">
            <SectionTitle title="Cases" />
            {cases.data?.length ? (
              <ul className="flex flex-col gap-2 text-sm">
                {cases.data.map((c) => (
                  <li key={c.id} className="flex items-center gap-2">
                    <Link href={`/cases/${c.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{c.title}</Link>
                    <Badge>{CASE_STATUS_LABEL[c.status]}</Badge>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">No cases about this entry.</p>}
          </Card>
        </div>
      </div>
      <EditEntryModal open={editOpen} onClose={() => setEditOpen(false)} entry={e} />
      <Modal open={delOpen} onClose={() => setDelOpen(false)} title="Delete entry?" footer={<><Button variant="ghost" onClick={() => setDelOpen(false)}>Cancel</Button><Button variant="danger" loading={del.isPending} onClick={() => del.mutate()}>Delete</Button></>}>
        <p className="text-sm">“{e.title}”, its files and benefits will be removed from this demo space.</p>
        {del.error && <div className="mt-3"><ErrorBox error={del.error} /></div>}
      </Modal>
    </>
  );
}

function EditEntryModal({ open, onClose, entry }: { open: boolean; onClose: () => void; entry: Entry }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(entry.title);
  const [provider, setProvider] = useState(entry.provider ?? "");
  const [subject, setSubject] = useState(entry.subject ?? "");
  const m = useMutation({
    mutationFn: () => api.patchEntry(entry.id, { title: title.trim(), provider: provider.trim() || null, subject: subject.trim() || null, expected_version: entry.data_version }),
    onSuccess: (e) => {
      qc.setQueryData(qk.entry(e.id), e);
      invalidate(qc, "entries");
      onClose();
    },
  });
  const reload = async () => {
    m.reset();
    const fresh = await qc.fetchQuery({ queryKey: qk.entry(entry.id), queryFn: () => api.getEntry(entry.id), staleTime: 0 });
    setTitle(fresh.title);
    setProvider(fresh.provider ?? "");
    setSubject(fresh.subject ?? "");
  };
  return (
    <Modal open={open} onClose={onClose} title="Edit entry" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!title.trim()} loading={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Name" htmlFor="e-title"><Input id="e-title" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Company" htmlFor="e-prov"><Input id="e-prov" value={provider} onChange={(e) => setProvider(e.target.value)} /></Field>
        <Field label="Product, service or plan" htmlFor="e-subj"><Input id="e-subj" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        {m.error && <ErrorBox error={m.error} onReload={reload} />}
      </div>
    </Modal>
  );
}
