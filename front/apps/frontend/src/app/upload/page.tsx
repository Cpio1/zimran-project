"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, FileText, FlaskConical, ImageIcon, Trash2, UploadCloud } from "lucide-react";
import { api } from "@/api/client";
import { UPLOAD_LIMITS } from "@/api/config";
import { ApiError, describeError } from "@/api/errors";
import { trackJob, trackedJobs, untrackJob } from "@/api/jobs";
import { HANDOVER_MS, SuccessIcon } from "@/components/motion";
import type { EntryCategory, Job } from "@/api/types";
import { ACCEPTED_MIME, ENTRY_CATEGORIES } from "@/api/types";
import { JobStatusView } from "@/components/JobStatus";
import { Badge, Button, ButtonLink, Card, ErrorBox, Field, IconButton, Input, Notice, PageHeader, Select } from "@/components/ui";
import { CATEGORY_LABEL } from "@/lib/format";
import { invalidate, qk, useJob } from "@/lib/hooks";
import { SAMPLE_DOCUMENT, sampleDocumentFile } from "@/lib/samplePdf";

const DRAFT_KEY = "claimly.upload_draft";

interface DraftFile {
  key: string;
  name: string;
  size: number;
  type: string;
  status: "pending" | "uploading" | "uploaded" | "failed";
  documentId?: string;
  jobId?: string;
  error?: { title: string; retryable: boolean };
}
interface UploadDraft {
  entryId: string | null;
  existingEntry: boolean;
  title: string;
  category: EntryCategory | "";
  provider: string;
  subject: string;
  files: DraftFile[];
  sample?: boolean;
}

const fileKey = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;
const emptyDraft = (): UploadDraft => ({ entryId: null, existingEntry: false, title: "", category: "", provider: "", subject: "", files: [] });

function loadDraft(): UploadDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as UploadDraft) : null;
  } catch {
    return null;
  }
}
function saveDraft(d: UploadDraft | null) {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

function validateFile(f: File): string | null {
  if (!(ACCEPTED_MIME as readonly string[]).includes(f.type)) return "Only PDF, JPG and PNG files are supported.";
  if (f.size > UPLOAD_LIMITS.maxFileBytes) return `Larger than ${UPLOAD_LIMITS.maxFileBytes / 1024 / 1024} MB.`;
  if (f.size === 0) return "The file is empty.";
  return null;
}
const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function UploadPage() {
  return (
    <Suspense>
      <UploadInner />
    </Suspense>
  );
}

function UploadInner() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const targetEntry = params.get("entry");
  const wantsSample = params.get("sample") === "1";

  const [draft, setDraftState] = useState<UploadDraft>(emptyDraft);
  const filesRef = useRef(new Map<string, File>());
  const [rejected, setRejected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [entryError, setEntryError] = useState<unknown>(null);
  const [resumed, setResumed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Drop-zone motion: drag depth survives dragenter/leave on child nodes in every browser.
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [drops, setDrops] = useState(0);
  const [freshKeys, setFreshKeys] = useState<ReadonlySet<string>>(() => new Set());
  // Final analysis status per file (keyed like DraftFile.key), reported by each row's job.
  const [analysis, setAnalysis] = useState<Record<string, Job["status"]>>({});

  const setDraft = useCallback((fn: (d: UploadDraft) => UploadDraft) => {
    setDraftState((d) => {
      const next = fn(d);
      saveDraft(next.entryId || next.files.length ? next : null);
      return next;
    });
  }, []);

  const existing = useQuery({ queryKey: qk.entry(targetEntry ?? "none"), queryFn: () => api.getEntry(targetEntry!), enabled: !!targetEntry });

  // Restore an unfinished upload or set up a fresh one.
  useEffect(() => {
    const saved = loadDraft();
    const running = new Set(trackedJobs().map((j) => j.id));
    const unfinished = saved?.files.some((f) => f.status !== "uploaded" || (f.jobId && running.has(f.jobId)));
    if (saved && !unfinished) saveDraft(null);
    if (saved && unfinished && !wantsSample && (!targetEntry || saved.entryId === targetEntry)) {
      setDraftState(saved);
      setResumed(saved.files.some((f) => f.status === "pending" || f.status === "failed" || f.status === "uploading"));
      return;
    }
    const d = emptyDraft();
    if (targetEntry) {
      d.entryId = targetEntry;
      d.existingEntry = true;
    }
    if (wantsSample) {
      const f = sampleDocumentFile();
      filesRef.current.set(fileKey(f), f);
      Object.assign(d, { title: SAMPLE_DOCUMENT.title, category: SAMPLE_DOCUMENT.category, provider: SAMPLE_DOCUMENT.provider, subject: SAMPLE_DOCUMENT.subject, sample: true });
      d.files = [{ key: fileKey(f), name: f.name, size: f.size, type: f.type, status: "pending" }];
    }
    setDraftState(d);
  }, [targetEntry, wantsSample]);

  useEffect(() => {
    if (existing.data) setDraftState((d) => ({ ...d, title: existing.data.title, category: existing.data.category }));
  }, [existing.data]);

  const addFiles = (list: FileList | File[]) => {
    const bad: string[] = [];
    const accepted: DraftFile[] = [];
    for (const f of Array.from(list)) {
      const err = validateFile(f);
      if (err) {
        bad.push(`${f.name}: ${err}`);
        continue;
      }
      const key = fileKey(f);
      filesRef.current.set(key, f);
      accepted.push({ key, name: f.name, size: f.size, type: f.type, status: "pending" });
    }
    setDraft((d) => {
      // Re-attaching a file after refresh reconnects to its pending row.
      const known = new Set(d.files.map((x) => x.key));
      const fresh = accepted.filter((a) => !known.has(a.key));
      const room = UPLOAD_LIMITS.maxFiles - d.files.length;
      if (fresh.length > room) bad.push(`Up to ${UPLOAD_LIMITS.maxFiles} files per upload.`);
      const files = [...d.files, ...fresh.slice(0, Math.max(0, room))];
      const title = d.title || (files[0] ? files[0].name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ") : "");
      return { ...d, files, title };
    });
    setRejected(bad);
    if (accepted.length) {
      setDrops((n) => n + 1);
      setFreshKeys(new Set(accepted.map((a) => a.key)));
    }
  };

  const uploadOne = async (entryId: string, df: DraftFile) => {
    const file = filesRef.current.get(df.key);
    if (!file) return;
    setDraft((d) => ({ ...d, files: d.files.map((x) => (x.key === df.key ? { ...x, status: "uploading", error: undefined } : x)) }));
    try {
      const res = await api.uploadDocument(entryId, file);
      trackJob({ id: res.job.id, kind: "extract", subject: entryId, label: file.name });
      setDraft((d) => ({ ...d, files: d.files.map((x) => (x.key === df.key ? { ...x, status: "uploaded", documentId: res.document.id, jobId: res.job.id } : x)) }));
    } catch (e) {
      const info = describeError(e);
      setDraft((d) => ({ ...d, files: d.files.map((x) => (x.key === df.key ? { ...x, status: "failed", error: { title: info.title, retryable: info.retryable || (e as ApiError)?.code === "NETWORK_ERROR" } } : x)) }));
    }
  };

  const start = async () => {
    setBusy(true);
    setEntryError(null);
    try {
      let entryId = draft.entryId;
      if (!entryId) {
        const entry = await api.createEntry({
          title: draft.title.trim(),
          category: draft.category as EntryCategory,
          provider: draft.provider.trim() || null,
          subject: draft.subject.trim() || null,
        });
        entryId = entry.id;
        setDraft((d) => ({ ...d, entryId: entry.id }));
        invalidate(qc, "entries", "dashboard");
      }
      // One request per file, all into the same entry.
      for (const f of draft.files) if (f.status === "pending" || f.status === "failed") await uploadOne(entryId, f);
      setResumed(false);
    } catch (e) {
      setEntryError(e);
    } finally {
      setBusy(false);
    }
  };

  const onJobDone = useCallback(
    (job: Job) => {
      untrackJob(job.id);
      // Fresh Document/Entry/Benefits come from the backend, never from the job payload.
      invalidate(qc, "entry", "entries", "document", "benefits", "benefit", "dashboard", "reminders");
    },
    [qc],
  );

  const missingFiles = draft.files.filter((f) => (f.status === "pending" || f.status === "failed") && !filesRef.current.has(f.key));
  const inFlight = draft.files.some((f) => f.status === "uploaded");
  const canStart = draft.files.length > 0 && draft.title.trim() && draft.category && !busy && missingFiles.length === 0 && draft.files.some((f) => f.status === "pending" || f.status === "failed");
  const started = draft.entryId && draft.files.some((f) => f.status !== "pending");
  const needsUpload = draft.files.some((f) => f.status === "pending" || f.status === "failed");
  const analysisSettled = draft.files.length > 0 && draft.files.every((f) => f.status === "uploaded" && analysis[f.key] !== undefined);
  const analysisOk = draft.files.some((f) => analysis[f.key] === "succeeded");
  /**
   * Staging: the step the user is on, derived only from real file and job states.
   *   choose  → nothing selected yet: the file picker is the main action;
   *   details → files are ready: "Upload and analyze" is the main action;
   *   process → uploading/analysing: progress is what to watch, no competing buttons;
   *   review  → analysis finished: "Review results" is the main action.
   */
  const stage: "choose" | "details" | "process" | "review" =
    draft.files.length === 0 ? "choose" : needsUpload && !busy ? "details" : analysisSettled && analysisOk ? "review" : "process";

  return (
    <>
      <PageHeader
        title={draft.existingEntry ? "Add documents" : "Upload document"}
        subtitle={draft.existingEntry && existing.data ? <>Adding to <Link className="text-brand-700 hover:underline" href={`/vault/${existing.data.id}`}>{existing.data.title}</Link></> : "PDF or photo. Claimly reads it and finds the benefits it describes."}
        back={{ href: draft.existingEntry && targetEntry ? `/vault/${targetEntry}` : "/vault", label: draft.existingEntry ? "Back to entry" : "Vault" }}
      />
      <UploadSteps stage={stage} />
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-5">
          {draft.sample && (
            <Notice tone="info" title="Sample document">
              This is a sample certificate created by Claimly for trying the app. It goes through the same upload and analysis as your own files.
            </Notice>
          )}
          {resumed && draft.entryId && (
            <Notice tone="warn" title="You have an unfinished upload">
              The entry was saved. {missingFiles.length ? `Choose ${missingFiles.length === 1 ? "this file" : "these files"} again to continue: ${missingFiles.map((f) => f.name).join(", ")}.` : "Continue uploading the remaining files."}
            </Notice>
          )}

          <Card tone={stage === "choose" || stage === "process" ? "focus" : "default"} className="p-4">
            <div
              className={clsx(
                "flex rounded-lg border-2 border-dashed text-center",
                // Once files are chosen the drop zone steps back to a compact row; it still accepts files.
                draft.files.length ? "flex-col items-center gap-2 px-4 py-4 sm:flex-row sm:text-left" : "flex-col items-center gap-3 px-4 py-8",
                dragging ? "border-brand-500 bg-brand-50/40" : "border-line",
              )}
              data-dragging={dragging || undefined}
              onDragEnter={(e) => {
                e.preventDefault();
                dragDepth.current += 1;
                setDragging(true);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={() => {
                dragDepth.current = Math.max(0, dragDepth.current - 1);
                if (dragDepth.current === 0) setDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                dragDepth.current = 0;
                setDragging(false);
                addFiles(e.dataTransfer.files);
              }}
            >
              <span className="drop-icon">
                {/* Remounting restarts the landing squash on every drop, even rapid ones. */}
                <UploadCloud key={drops} className={clsx("text-brand-600", draft.files.length ? "size-6" : "size-8", drops > 0 && "squish-drop")} aria-hidden />
              </span>
              <p className={clsx("text-sm", draft.files.length > 0 && "sm:flex-1")}>{draft.files.length ? "Drag more files here or" : "Drag files here or"}</p>
              <Button
                variant={stage === "choose" || missingFiles.length > 0 ? "primary" : "secondary"}
                size={draft.files.length ? "sm" : "md"}
                onClick={() => inputRef.current?.click()}
                disabled={draft.files.length >= UPLOAD_LIMITS.maxFiles && missingFiles.length === 0}
              >
                {draft.files.length && !missingFiles.length ? "Add files" : "Choose files"}
              </Button>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                data-testid="file-input"
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <p className={clsx("text-xs text-muted", draft.files.length > 0 && "sm:hidden")}>
                PDF, JPG or PNG · up to {UPLOAD_LIMITS.maxFileBytes / 1024 / 1024} MB each · up to {UPLOAD_LIMITS.maxFiles} files · up to {UPLOAD_LIMITS.maxPages} pages per document
              </p>
            </div>
            {rejected.length > 0 && (
              <div className="mt-3">
                <Notice tone="warn" title="Some files weren't added">{rejected.join(" ")}</Notice>
              </div>
            )}
            {draft.files.length > 0 && (
              <ul className="mt-4 flex flex-col divide-y divide-line">
                {draft.files.map((f) => (
                  <FileRow
                    key={f.key}
                    f={f}
                    missing={!filesRef.current.has(f.key)}
                    fresh={freshKeys.has(f.key)}
                    onRemove={f.status === "pending" || f.status === "failed" ? () => setDraft((d) => ({ ...d, files: d.files.filter((x) => x.key !== f.key) })) : undefined}
                    onRetry={draft.entryId && f.status === "failed" ? () => uploadOne(draft.entryId!, f) : undefined}
                    onJobDone={(j) => {
                      onJobDone(j);
                      setAnalysis((a) => ({ ...a, [f.key]: j.status }));
                    }}
                  />
                ))}
              </ul>
            )}
          </Card>

          {!draft.existingEntry && (
            <Card tone={stage === "choose" ? "quiet" : "default"} className="p-4">
              <h2 className="mb-3 font-semibold">About this document</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" htmlFor="u-title">
                  <Input id="u-title" value={draft.title} disabled={!!draft.entryId} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="e.g. Laptop warranty" />
                </Field>
                <Field label="Type" htmlFor="u-cat" hint="Insurance, memberships and certificates don't need a purchase.">
                  <Select id="u-cat" value={draft.category} disabled={!!draft.entryId} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as EntryCategory }))}>
                    <option value="">Choose a type</option>
                    {ENTRY_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                  </Select>
                </Field>
                <Field label="Company (optional)" htmlFor="u-prov">
                  <Input id="u-prov" value={draft.provider} disabled={!!draft.entryId} onChange={(e) => setDraft((d) => ({ ...d, provider: e.target.value }))} />
                </Field>
                <Field label="Product, service or plan (optional)" htmlFor="u-subj">
                  <Input id="u-subj" value={draft.subject} disabled={!!draft.entryId} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} />
                </Field>
              </div>
            </Card>
          )}

          {entryError != null && <ErrorBox error={entryError} onRetry={start} />}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {!started || needsUpload ? (
              <Button variant={canStart || busy ? "primary" : "secondary"} size="lg" disabled={!canStart} loading={busy} onClick={start}>
                {draft.entryId && draft.files.some((f) => f.status === "failed") ? "Continue upload" : "Upload and analyze"}
              </Button>
            ) : null}
            {draft.entryId && inFlight && (
              <ButtonLink
                href={`/review/${draft.entryId}`}
                variant={stage === "review" ? "primary" : "secondary"}
                size="lg"
                // Snappy: the cue overlaps the analysis check (starts at 100 ms, ends at 280 ms).
                // The link itself is usable the moment the API reports success — the cue is decoration.
                cue={stage === "review"}
                cueDelayMs={HANDOVER_MS}
              >
                Review results
              </ButtonLink>
            )}
            {(draft.entryId || draft.files.length > 0) && (
              <Button
                variant="ghost"
                onClick={() => {
                  saveDraft(null);
                  filesRef.current.clear();
                  router.replace("/upload");
                  setDraftState(emptyDraft());
                  setAnalysis({});
                  setResumed(false);
                }}
              >
                {started ? "Start another upload" : "Clear"}
              </Button>
            )}
          </div>
        </div>

        <aside className="flex flex-col gap-3 text-sm text-muted">
          <Card tone="quiet" className="p-4">
            <h2 className="mb-2 font-semibold text-ink">What happens next</h2>
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>Your file is stored in this demo space.</li>
              <li>Claimly reads it and finds dates, limits and benefits.</li>
              <li>You check what needs review. Nothing is final until you confirm.</li>
            </ol>
          </Card>
          {!draft.files.length && !draft.existingEntry && (
            <ButtonLink href="/upload?sample=1" variant="ghost" icon={<FlaskConical className="size-4" aria-hidden />}>Try a sample document</ButtonLink>
          )}
        </aside>
      </div>
    </>
  );
}

const STEPS = [
  { key: "pick", label: "Choose files" },
  { key: "process", label: "Upload and analysis" },
  { key: "review", label: "Check the results" },
] as const;

function UploadSteps({ stage }: { stage: "choose" | "details" | "process" | "review" }) {
  const current = stage === "choose" || stage === "details" ? 0 : stage === "process" ? 1 : 2;
  return (
    <ol aria-label="Upload steps" className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
      {STEPS.map((s, i) => (
        <li key={s.key} aria-current={i === current ? "step" : undefined} className="flex items-center gap-2">
          <span
            className={clsx(
              "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums transition-colors",
              i < current ? "bg-brand-100 text-brand-700" : i === current ? "bg-accent text-on-accent" : "bg-track text-muted",
            )}
          >
            {i < current ? <><Check className="size-3.5" aria-hidden /><span className="sr-only">Done:</span></> : i + 1}
          </span>
          <span className={clsx(i === current ? "font-semibold text-ink" : "text-muted")}>{s.label}</span>
          {i < STEPS.length - 1 && <span aria-hidden className="mx-1 hidden h-px w-6 bg-line sm:block" />}
        </li>
      ))}
    </ol>
  );
}

function FileRow({ f, missing, fresh, onRemove, onRetry, onJobDone }: { f: DraftFile; missing: boolean; fresh?: boolean; onRemove?: () => void; onRetry?: () => void; onJobDone: (j: Job) => void }) {
  const Icon = f.type === "application/pdf" ? FileText : ImageIcon;
  // Secondary action: the check pops only when the server confirms this upload while we watch;
  // a row restored from an earlier visit shows it at rest.
  const prev = useRef(f.status);
  const [confirmedNow, setConfirmedNow] = useState(false);
  useEffect(() => {
    if (prev.current !== "uploaded" && f.status === "uploaded") setConfirmedNow(true);
    prev.current = f.status;
  }, [f.status]);
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-center gap-3">
        {/* Leans back, then heads up toward the server as the upload starts (anticipation). */}
        <Icon className={clsx("size-5 shrink-0 text-muted", f.status === "uploading" ? "anticipate-send" : fresh && "squish-land")} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium [overflow-wrap:anywhere]" title={f.name}>{f.name}</p>
          <p className="text-xs text-muted">{fmtSize(f.size)}</p>
        </div>
        {f.status === "pending" && (missing ? <Badge tone="warn">Choose again</Badge> : <Badge>Ready</Badge>)}
        {f.status === "uploading" && <Badge tone="info">Uploading…</Badge>}
        {f.status === "failed" && <Badge tone="danger">Not uploaded</Badge>}
        {f.status === "uploaded" && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-700">
            {confirmedNow ? <SuccessIcon className="size-4" /> : <CheckCircle2 className="size-4" aria-hidden />}
            Uploaded
          </span>
        )}
        {onRemove && (
          <IconButton icon={Trash2} label={`Remove ${f.name}`} bleed className="ml-0.5" onClick={onRemove} />
        )}
      </div>
      {f.status === "failed" && f.error && (
        <Notice tone="danger" action={onRetry && !missing && f.error.retryable ? <Button size="sm" onClick={onRetry}>Retry</Button> : undefined}>{f.error.title}</Notice>
      )}
      {f.jobId && <FileJob jobId={f.jobId} documentId={f.documentId ?? null} onDone={onJobDone} />}
    </li>
  );
}

function FileJob({ jobId, documentId, onDone }: { jobId: string; documentId: string | null; onDone: (j: Job) => void }) {
  const qc = useQueryClient();
  const job = useJob(jobId, onDone);
  const [retryJob, setRetryJob] = useState<string | null>(null);
  const retry = async () => {
    if (!documentId) return;
    const j = await api.analyzeDocument(documentId, { force: true });
    setRetryJob(j.id);
    invalidate(qc, "document");
  };
  if (retryJob) return <FileJob jobId={retryJob} documentId={documentId} onDone={onDone} />;
  if (job.error) return <ErrorBox error={job.error} onRetry={() => job.refetch()} />;
  return <JobStatusView job={job.data} label="Analysis" onRetry={documentId ? retry : undefined} />;
}
