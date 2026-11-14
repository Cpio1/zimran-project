"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Quote } from "lucide-react";
import { api } from "@/api/client";
import type { EvidenceRef } from "@/api/types";
import { qk } from "@/lib/hooks";
import { ErrorBox, Modal, Notice, Spinner } from "./ui";

const Ctx = createContext<(ref: EvidenceRef) => void>(() => {});
export const useOpenEvidence = () => useContext(Ctx);

export function EvidenceProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<EvidenceRef | null>(null);
  const open = useCallback((r: EvidenceRef) => setCurrent(r), []);
  return (
    <Ctx.Provider value={open}>
      {children}
      <Modal open={!!current} onClose={() => setCurrent(null)} title="Source" wide>
        {current && <EvidenceViewer evidence={current} />}
      </Modal>
    </Ctx.Provider>
  );
}

function EvidenceViewer({ evidence }: { evidence: EvidenceRef }) {
  const doc = useQuery({ queryKey: qk.document(evidence.document_id), queryFn: () => api.getDocument(evidence.document_id), retry: false });
  const [url, setUrl] = useState<string | null>(null);
  const [contentError, setContentError] = useState<unknown>(null);

  useEffect(() => {
    if (!doc.data) return;
    const ctrl = new AbortController();
    let objectUrl: string | null = null;
    setContentError(null);
    // Bytes are fetched with the X-Demo-Session header; the token never goes into a URL.
    api.getDocumentContent(evidence.document_id, ctrl.signal)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((e) => {
        if ((e as Error)?.name !== "AbortError") setContentError(e);
      });
    return () => {
      ctrl.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [doc.data, evidence.document_id]);

  const outdated = doc.data && doc.data.version > evidence.document_version;
  const missing = (doc.error as { isNotFound?: boolean } | null)?.isNotFound || (contentError as { isNotFound?: boolean } | null)?.isNotFound;

  return (
    <div className="flex flex-col gap-3">
      {evidence.quote ? (
      <blockquote className="flex gap-2 rounded-lg bg-brand-50 px-3 py-2.5 text-sm text-brand-700">
        <Quote className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span className="min-w-0">
          “{evidence.quote}”
          <span className="mt-1 block text-xs text-brand-700/80">
            {doc.data?.name ?? "Document"} · page {evidence.page}
          </span>
        </span>
      </blockquote>
      ) : (
        <p className="text-sm font-medium">{doc.data?.name ?? "Document"}</p>
      )}
      {outdated && (
        <Notice tone="warn" title="This source may be out of date">
          The quote comes from version {evidence.document_version}; the document is now version {doc.data!.version}. Re-check the analysis.
        </Notice>
      )}
      {missing ? (
        <Notice tone="warn" title="The source document is no longer available">It was deleted or can't be opened, so no preview is shown.</Notice>
      ) : doc.error ? (
        <ErrorBox error={doc.error} onRetry={() => doc.refetch()} />
      ) : contentError ? (
        <ErrorBox error={contentError} />
      ) : !url ? (
        <Spinner label="Loading document" />
      ) : doc.data?.mime_type === "application/pdf" ? (
        <iframe title={`${doc.data.name}, page ${evidence.page}`} src={`${url}#page=${evidence.page}`} className="h-[60dvh] w-full rounded-lg border border-line" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`${doc.data?.name ?? "Document"} (photo)`} className="max-h-[60dvh] w-full rounded-lg border border-line object-contain" />
      )}
    </div>
  );
}

export function EvidenceChips({ refs, max = 3 }: { refs: EvidenceRef[]; max?: number }) {
  const open = useOpenEvidence();
  if (!refs.length) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {refs.slice(0, max).map((r, i) => (
        <li key={`${r.document_id}-${r.page}-${i}`}>
          <button type="button" onClick={() => open(r)} className="flex w-full items-start gap-2 rounded-lg border border-line bg-white px-2.5 py-2 text-left text-xs text-muted hover:border-brand-200 hover:bg-brand-50/50">
            <FileText className="mt-0.5 size-3.5 shrink-0 text-brand-600" aria-hidden />
            <span className="min-w-0">
              <span className="line-clamp-2 text-ink">“{r.quote}”</span>
              <span>Page {r.page} · open source</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
