"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Bot, FilePlus2, Gift, FolderOpen, HelpCircle, Sparkles } from "lucide-react";
import clsx from "clsx";
import { api, listAll } from "@/api/client";
import { describeError } from "@/api/errors";
import { newKey } from "@/api/idempotency";
import { trackJob, trackedJobs, untrackJob } from "@/api/jobs";
import type { AnswerJobResult, ChatMessage, Job, MessageCreate, NextAction, Thread } from "@/api/types";
import { NEXT_ACTION_TYPES } from "@/api/types";
import { qk, useJob } from "@/lib/hooks";
import { EvidenceChips } from "./Evidence";
import { JobStatusView } from "./JobStatus";
import { Button, ErrorBox, ListSkeleton, Notice } from "./ui";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Outgoing {
  nonce: string;
  body: MessageCreate;
  state: "sending" | "error";
  error?: unknown;
}

const SUGGESTIONS: { text: string; purpose: MessageCreate["purpose"] }[] = [
  { text: "What free benefits do I currently have?", purpose: "answer" },
  { text: "I need to get my car inspected.", purpose: "match_need" },
  { text: "Can I get this service without paying again?", purpose: "answer" },
  { text: "Does my policy mention this situation?", purpose: "answer" },
];

export function Chat({ thread, className, placeholder }: { thread: Thread; className?: string; placeholder?: string }) {
  const qc = useQueryClient();
  const threadId = thread.id;
  const messages = useQuery({
    queryKey: qk.messages(threadId),
    queryFn: () => listAll((cursor) => api.listMessages(threadId, { cursor, limit: 100 })),
  });
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [jobs, setJobs] = useState<string[]>([]);
  const [accepted, setAccepted] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [purpose, setPurpose] = useState<MessageCreate["purpose"]>("answer");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Resume polling for jobs started earlier in this thread (e.g. after navigating away).
  useEffect(() => {
    setJobs(trackedJobs(threadId).map((j) => j.id));
    setOutgoing([]);
    setAccepted([]);
  }, [threadId]);

  /** Server history + accepted-but-not-yet-listed messages, de-duplicated by id. */
  const shown = useMemo(() => {
    const byId = new Map<string, ChatMessage>();
    for (const m of messages.data ?? []) byId.set(m.id, m);
    for (const m of accepted) if (!byId.has(m.id)) byId.set(m.id, m);
    return [...byId.values()].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.role === "user" ? -1 : 1));
  }, [messages.data, accepted]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [shown.length, outgoing.length, jobs.length]);

  const send = async (o: Outgoing) => {
    setOutgoing((xs) => [...xs.filter((x) => x.nonce !== o.nonce), { ...o, state: "sending", error: undefined }]);
    try {
      const res = await api.sendMessage(threadId, o.body, o.nonce);
      setOutgoing((xs) => xs.filter((x) => x.nonce !== o.nonce));
      setAccepted((xs) => [...xs, res.message]);
      trackJob({ id: res.job.id, kind: res.job.kind, subject: threadId });
      setJobs((xs) => (xs.includes(res.job.id) ? xs : [...xs, res.job.id]));
    } catch (error) {
      setOutgoing((xs) => xs.map((x) => (x.nonce === o.nonce ? { ...x, state: "error", error } : x)));
    }
  };

  const submit = (content = text, p = purpose) => {
    const c = content.trim();
    if (!c) return;
    setText("");
    void send({ nonce: newKey(), body: { content: c, purpose: p }, state: "sending" });
  };

  const onJobDone = (job: Job) => {
    untrackJob(job.id);
    if (job.status === "succeeded" && job.result && "assistant_message" in job.result) {
      const msg = (job.result as AnswerJobResult).assistant_message;
      setAccepted((xs) => (xs.some((m) => m.id === msg.id) ? xs : [...xs, msg]));
      qc.setQueryData<ChatMessage[]>(qk.messages(threadId), (old) => (old && !old.some((m) => m.id === msg.id) ? [...old, msg] : old));
      // Answers may change nothing else, but benefits/cases could be referenced: keep them fresh.
      void qc.invalidateQueries({ queryKey: qk.messages(threadId) });
    }
    if (job.status !== "failed") setJobs((xs) => xs.filter((x) => x !== job.id));
  };

  const empty = !messages.isLoading && shown.length === 0 && outgoing.length === 0;

  return (
    <div className={clsx("flex min-h-0 flex-col", className)}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-4" aria-live="polite">
        {messages.isLoading && <ListSkeleton rows={2} />}
        {messages.error && <ErrorBox error={messages.error} onRetry={() => messages.refetch()} />}
        {empty && (
          <div className="flex flex-col gap-3 py-4">
            <p className="flex items-center gap-2 text-sm text-muted"><Sparkles className="size-4 text-brand-600" aria-hidden /> Ask about your documents, or describe something you need.</p>
            {thread.scope === "vault" && (
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s.text} type="button" onClick={() => submit(s.text, s.purpose)} className="rounded-full border border-line bg-white px-3 py-1.5 text-left text-sm hover:border-brand-200 hover:bg-brand-50">
                    {s.text}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {shown.map((m) => (m.role === "user" ? <UserBubble key={m.id} text={m.content} /> : (
          <AssistantMessage key={m.id} m={m} thread={thread} onAsk={(q) => { setText(q); inputRef.current?.focus(); }} />
        )))}
        {outgoing.map((o) => (
          <div key={o.nonce} className="flex flex-col items-end gap-2">
            <UserBubble text={o.body.content} pending={o.state === "sending"} />
            {o.state === "error" && (
              <div className="w-full max-w-md"><ErrorBox error={o.error} onRetry={() => send(o)} /></div>
            )}
          </div>
        ))}
        {jobs.map((id) => <PendingAnswer key={id} jobId={id} onDone={onJobDone} onDismiss={() => setJobs((xs) => xs.filter((x) => x !== id))} />)}
        <div ref={endRef} />
      </div>

      <form
        className="sticky bottom-0 flex flex-col gap-2 border-t border-line bg-white pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div role="radiogroup" aria-label="Question type" className="flex flex-wrap gap-1.5">
          {([
            ["answer", "Ask a question"],
            ["match_need", "Find a benefit for a need"],
          ] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={purpose === v}
              onClick={() => setPurpose(v)}
              className={clsx("rounded-full px-3 py-1 text-xs font-medium", purpose === v ? "bg-brand-600 text-white" : "bg-stone-100 text-muted hover:text-ink")}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <label htmlFor={`chat-${threadId}`} className="sr-only">Message to Claimly</label>
          <textarea
            id={`chat-${threadId}`}
            ref={inputRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={placeholder ?? (purpose === "match_need" ? "Describe what you need, e.g. “my laptop screen broke”" : "Ask about your documents")}
            className="max-h-40 min-h-10 w-full min-w-0 flex-1 resize-y rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
          <Button type="submit" variant={text.trim() ? "primary" : "secondary"} aria-label="Send" disabled={!text.trim()} className="size-10 px-0">
            <ArrowUp data-anticipate="up" className="size-4" aria-hidden />
          </Button>
        </div>
      </form>
    </div>
  );
}

function UserBubble({ text, pending }: { text: string; pending?: boolean }) {
  return (
    <div className="flex justify-end">
      <p className={clsx("max-w-[85%] whitespace-pre-line break-words rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2 text-sm text-white", pending && "opacity-70")}>
        {text}
        {pending && <span className="sr-only"> (sending)</span>}
      </p>
    </div>
  );
}

function PendingAnswer({ jobId, onDone, onDismiss }: { jobId: string; onDone: (j: Job) => void; onDismiss: () => void }) {
  const job = useJob(jobId, onDone);
  if (job.error) return <ErrorBox error={job.error} onRetry={() => job.refetch()} />;
  if (job.data?.status === "failed") {
    return (
      <div className="flex flex-col gap-2">
        <JobStatusView job={job.data} label="Answer" />
        <Button size="sm" variant="ghost" className="self-start" onClick={onDismiss}>Dismiss</Button>
      </div>
    );
  }
  return (
    <div className="flex max-w-md gap-2">
      <Bot className="mt-1 size-5 shrink-0 text-brand-600" aria-hidden />
      <div className="flex-1">
        <JobStatusView job={job.data ?? { id: jobId, kind: "answer", status: "queued", progress: null, result: null, error: null, created_at: "", updated_at: "" }} label="Claimly is reading your documents" compact />
      </div>
    </div>
  );
}

function AssistantMessage({ m, thread, onAsk }: { m: ChatMessage; thread: Thread; onAsk: (q: string) => void }) {
  const benefitQs = useQueries({
    queries: m.matched_benefit_ids.filter((id) => UUID.test(id)).map((id) => ({
      queryKey: qk.benefit(id),
      queryFn: () => api.getBenefit(id),
      retry: false,
    })),
  });
  const benefits = benefitQs.map((q) => q.data).filter((b): b is NonNullable<typeof b> => !!b);
  const knownBenefitIds = new Set([...benefits.map((b) => b.id)]);
  const knownCaseIds = new Set(thread.case_id ? [thread.case_id] : []);
  const cases = useQuery({ queryKey: qk.cases({ known: true }), queryFn: () => listAll((cursor) => api.listCases({ cursor, limit: 100 })), staleTime: 30_000 });
  for (const c of cases.data ?? []) knownCaseIds.add(c.id);

  const actions = m.next_actions.map((a) => resolveAction(a, { knownBenefitIds, knownCaseIds, entryId: thread.entry_id })).filter((x): x is ResolvedAction => !!x);

  return (
    <div className="flex gap-2">
      <Bot className="mt-1 size-5 shrink-0 text-brand-600" aria-hidden />
      <div className="flex min-w-0 max-w-2xl flex-1 flex-col gap-3 rounded-2xl rounded-tl-md border border-line bg-white px-3.5 py-3">
        <p className="whitespace-pre-line break-words text-sm">{m.content}</p>
        {benefits.length > 0 && (
          <ul className="flex flex-col gap-1.5" aria-label="Matching benefits">
            {benefits.map((b) => (
              <li key={b.id}>
                <Link href={`/benefits/${b.id}`} className="flex items-center gap-2 rounded-lg bg-brand-50 px-2.5 py-2 text-sm text-brand-700 hover:bg-brand-100">
                  <Gift className="size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">{b.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <EvidenceChips refs={m.evidence_refs} />
        {m.questions.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {m.questions.map((q) => (
              <button key={q} type="button" onClick={() => onAsk(q)} className="flex items-start gap-2 text-left text-sm text-sky-800 hover:underline">
                <HelpCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> {q}
              </button>
            ))}
          </div>
        )}
        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actions.map((a, i) =>
              a.href ? (
                <Link key={i} href={a.href} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-sm hover:bg-stone-50">{a.icon}{a.label}</Link>
              ) : (
                <button key={i} type="button" onClick={() => onAsk(a.label)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-sm hover:bg-stone-50">{a.icon}{a.label}</button>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface ResolvedAction {
  label: string;
  href?: string;
  icon: React.ReactNode;
}
/**
 * Maps model-proposed actions to app routes. Only the four contract types are allowed and
 * only IDs we know about are linked; anything else (unknown type/ID, URLs) is dropped.
 */
export function resolveAction(a: NextAction, ctx: { knownBenefitIds: Set<string>; knownCaseIds: Set<string>; entryId: string | null }): ResolvedAction | null {
  if (!NEXT_ACTION_TYPES.includes(a.type)) return null;
  const label = String(a.label ?? "").slice(0, 80);
  if (!label) return null;
  const id = a.target_id && UUID.test(a.target_id) ? a.target_id : null;
  switch (a.type) {
    case "open_benefit":
      return id && ctx.knownBenefitIds.has(id) ? { label, href: `/benefits/${id}`, icon: <Gift className="size-3.5" aria-hidden /> } : null;
    case "open_case":
      return id && ctx.knownCaseIds.has(id) ? { label, href: `/cases/${id}`, icon: <FolderOpen className="size-3.5" aria-hidden /> } : null;
    case "add_document": {
      const entry = id && id === ctx.entryId ? id : null;
      return { label, href: entry ? `/upload?entry=${entry}` : "/upload", icon: <FilePlus2 className="size-3.5" aria-hidden /> };
    }
    case "ask_question":
      return { label, icon: <HelpCircle className="size-3.5" aria-hidden /> };
  }
  return null;
}

export function ChatUnavailable({ error }: { error: unknown }) {
  const d = describeError(error);
  return <Notice tone="warn" title="Chat isn't available">{d.title}</Notice>;
}
