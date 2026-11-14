import { API_BASE_URL } from "./config";
import { ApiError, SessionReplacedError } from "./errors";
import { acquireKey, releaseKey, clearAllKeys } from "./idempotency";
import { clearSession, ensureSession, onSessionChange, readSession, setSessionCreator } from "./session";
import type {
  AnalyzeRequest, Benefit, BenefitPatch, Case, CaseCreate, CaseEvent, CasePatch, ChatMessage, Dashboard,
  DemoSession, Document, Draft, DraftCreate, DraftPatch, Entry, EntryCreate, EntryPatch, Envelope, ErrorEnvelope,
  EventCreate, Health, Job, ListEnvelope, MessageAccepted, MessageCreate, Notification, Outcome, OutcomePut,
  Profile, ProfilePatch, Reminder, ReminderCreate, ReminderPatch, ReplyCreate, StatusChange, Thread, ThreadCreate,
  UploadAccepted, UsagePut,
} from "./types";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Query = Record<string, string | number | boolean | null | undefined>;

interface RequestOptions {
  query?: Query;
  json?: unknown;
  form?: FormData;
  idempotencyKey?: string;
  /** false for /health and demo-session creation */
  auth?: boolean;
  raw?: boolean;
  signal?: AbortSignal;
}

let fetchImpl: typeof fetch = (...a) => fetch(...a);
/** test hook */
export function __setFetch(f: typeof fetch) {
  fetchImpl = f;
}

function buildUrl(path: string, query?: Query) {
  const url = new URL(API_BASE_URL + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  return url.toString();
}

async function parseError(res: Response): Promise<ApiError> {
  const rid = res.headers.get("x-request-id");
  try {
    const body = (await res.json()) as ErrorEnvelope;
    if (body?.error?.code) return ApiError.fromBody(res.status, body.error, body.request_id ?? rid);
  } catch {
    /* non-JSON error */
  }
  return new ApiError({
    status: res.status,
    code: res.status >= 500 ? "INTERNAL_ERROR" : "BAD_RESPONSE",
    message: `Unexpected response (${res.status})`,
    retryable: res.status >= 500,
    requestId: rid,
  });
}

async function send(method: Method, path: string, opts: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form; // browser sets multipart boundary itself
  else if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  }
  if (token) headers["X-Demo-Session"] = token;
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  try {
    return await fetchImpl(buildUrl(path, opts.query), { method, headers, body, signal: opts.signal });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new ApiError({ status: 0, code: "NETWORK_ERROR", message: "Network error", retryable: true });
  }
}

export async function request<T>(method: Method, path: string, opts: RequestOptions = {}): Promise<T> {
  const auth = opts.auth !== false;
  let token = auth ? (await ensureSession()).session_token : null;
  let res = await send(method, path, opts, token);

  if (res.status === 401 && auth) {
    const err = await parseError(res);
    if (!err.isSessionError) throw err;
    // Another request may already have replaced the session.
    const current = readSession();
    if (!current || current.session_token === token) clearSession("expired");
    const fresh = await ensureSession();
    if (method !== "GET") throw new SessionReplacedError(err.requestId);
    token = fresh.session_token;
    res = await send(method, path, opts, token);
    if (res.status === 401) throw await parseError(res);
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  if (opts.raw) return res as unknown as T;
  return (await res.json()) as T;
}

// Session creation is public: no token, no body.
setSessionCreator(async () => {
  const env = await request<Envelope<DemoSession>>("POST", "/api/v1/demo/sessions", { auth: false });
  return env.data;
});
// Keys from a previous session reference old UUIDs.
onSessionChange(() => clearAllKeys());

/**
 * Runs a repeatable operation with a stable Idempotency-Key: the key survives failures that
 * may be retried, and is released after success or a definitive failure.
 */
export async function idempotent<T>(scope: string, payload: unknown, run: (key: string) => Promise<T>): Promise<T> {
  const key = acquireKey(scope, payload);
  try {
    const out = await run(key);
    releaseKey(scope, payload);
    return out;
  } catch (e) {
    if (!(e instanceof ApiError) || !e.retryable || e.isConflict) releaseKey(scope, payload);
    throw e;
  }
}

const d = <T>(p: Promise<Envelope<T>>) => p.then((e) => e.data);
const V1 = "/api/v1";

export interface Page {
  cursor?: string | null;
  limit?: number;
}

export const api = {
  health: () => d(request<Envelope<Health>>("GET", "/health", { auth: false })),
  createDemoSession: () => d(request<Envelope<DemoSession>>("POST", `${V1}/demo/sessions`, { auth: false })),

  getProfile: () => d(request<Envelope<Profile>>("GET", `${V1}/profile`)),
  patchProfile: (body: ProfilePatch) => d(request<Envelope<Profile>>("PATCH", `${V1}/profile`, { json: body })),
  getDashboard: () => d(request<Envelope<Dashboard>>("GET", `${V1}/dashboard`)),

  listEntries: (q: { category?: string; q?: string } & Page = {}) =>
    request<ListEnvelope<Entry>>("GET", `${V1}/entries`, { query: { ...q } }),
  createEntry: (body: EntryCreate, scope = "entry.create") =>
    idempotent(scope, body, (key) => d(request<Envelope<Entry>>("POST", `${V1}/entries`, { json: body, idempotencyKey: key }))),
  getEntry: (id: string) => d(request<Envelope<Entry>>("GET", `${V1}/entries/${id}`)),
  patchEntry: (id: string, body: EntryPatch) => d(request<Envelope<Entry>>("PATCH", `${V1}/entries/${id}`, { json: body })),
  deleteEntry: (id: string) => request<void>("DELETE", `${V1}/entries/${id}`),

  uploadDocument: (entryId: string, file: File, scope = "document.upload") =>
    idempotent(scope, { entryId, file }, (key) => {
      const form = new FormData();
      form.append("entry_id", entryId);
      form.append("file", file, file.name);
      return d(request<Envelope<UploadAccepted>>("POST", `${V1}/documents`, { form, idempotencyKey: key }));
    }),
  getDocument: (id: string) => d(request<Envelope<Document>>("GET", `${V1}/documents/${id}`)),
  deleteDocument: (id: string) => request<void>("DELETE", `${V1}/documents/${id}`),
  /** Bytes via header auth; the token never goes to a query string. */
  getDocumentContent: async (id: string, signal?: AbortSignal) => {
    const res = await request<Response>("GET", `${V1}/documents/${id}/content`, { raw: true, signal });
    return res.blob();
  },
  analyzeDocument: (id: string, body: AnalyzeRequest) =>
    idempotent(`document.analyze.${id}`, body, (key) =>
      d(request<Envelope<Job>>("POST", `${V1}/documents/${id}/analyze`, { json: body, idempotencyKey: key })),
    ),

  listBenefits: (q: { entry_id?: string; usage_state?: string; q?: string } & Page = {}) =>
    request<ListEnvelope<Benefit>>("GET", `${V1}/benefits`, { query: { ...q } }),
  getBenefit: (id: string) => d(request<Envelope<Benefit>>("GET", `${V1}/benefits/${id}`)),
  patchBenefit: (id: string, body: BenefitPatch) => d(request<Envelope<Benefit>>("PATCH", `${V1}/benefits/${id}`, { json: body })),
  setBenefitUsage: (id: string, body: UsagePut) =>
    idempotent(`benefit.usage.${id}`, { used_units: body.used_units, expected_version: body.expected_version, note: body.note }, (key) =>
      d(request<Envelope<Benefit>>("PUT", `${V1}/benefits/${id}/usage`, { json: body, idempotencyKey: key })),
    ),

  createThread: (body: ThreadCreate) =>
    idempotent("thread.create", body, (key) => d(request<Envelope<Thread>>("POST", `${V1}/threads`, { json: body, idempotencyKey: key }))),
  listThreads: (q: { scope?: string; entry_id?: string; case_id?: string } & Page = {}) =>
    request<ListEnvelope<Thread>>("GET", `${V1}/threads`, { query: { ...q } }),
  listMessages: (threadId: string, p: Page = {}) =>
    request<ListEnvelope<ChatMessage>>("GET", `${V1}/threads/${threadId}/messages`, { query: { ...p } }),
  sendMessage: (threadId: string, body: MessageCreate, clientNonce: string) =>
    idempotent(`message.send.${threadId}.${clientNonce}`, body, (key) =>
      d(request<Envelope<MessageAccepted>>("POST", `${V1}/threads/${threadId}/messages`, { json: body, idempotencyKey: key })),
    ),

  listCases: (q: { status?: string; entry_id?: string } & Page = {}) =>
    request<ListEnvelope<Case>>("GET", `${V1}/cases`, { query: { ...q } }),
  createCase: (body: CaseCreate) =>
    idempotent("case.create", body, (key) => d(request<Envelope<Case>>("POST", `${V1}/cases`, { json: body, idempotencyKey: key }))),
  getCase: (id: string) => d(request<Envelope<Case>>("GET", `${V1}/cases/${id}`)),
  patchCase: (id: string, body: CasePatch) => d(request<Envelope<Case>>("PATCH", `${V1}/cases/${id}`, { json: body })),
  assessCase: (id: string, version: number) =>
    idempotent(`case.assess.${id}`, { version }, (key) => d(request<Envelope<Job>>("POST", `${V1}/cases/${id}/assess`, { idempotencyKey: key }))),
  setCaseStatus: (id: string, body: StatusChange) =>
    idempotent(`case.status.${id}`, { status: body.status, expected_version: body.expected_version }, (key) =>
      d(request<Envelope<Case>>("POST", `${V1}/cases/${id}/status`, { json: body, idempotencyKey: key })),
    ),
  listCaseEvents: (id: string, p: Page = {}) => request<ListEnvelope<CaseEvent>>("GET", `${V1}/cases/${id}/events`, { query: { ...p } }),
  addCaseNote: (id: string, body: EventCreate) =>
    idempotent(`case.note.${id}`, { note: body.note, docs: body.attachment_document_ids }, (key) =>
      d(request<Envelope<CaseEvent>>("POST", `${V1}/cases/${id}/events`, { json: body, idempotencyKey: key })),
    ),
  analyzeReply: (id: string, body: ReplyCreate) =>
    idempotent(`case.reply.${id}`, body, (key) => d(request<Envelope<Job>>("POST", `${V1}/cases/${id}/replies`, { json: body, idempotencyKey: key }))),
  listDrafts: (id: string, p: Page = {}) => request<ListEnvelope<Draft>>("GET", `${V1}/cases/${id}/drafts`, { query: { ...p } }),
  createDraft: (id: string, body: DraftCreate, caseVersion: number) =>
    idempotent(`case.draft.${id}.${caseVersion}`, body, (key) =>
      d(request<Envelope<Job>>("POST", `${V1}/cases/${id}/drafts`, { json: body, idempotencyKey: key })),
    ),
  editDraft: (draftId: string, body: DraftPatch) => d(request<Envelope<Draft>>("PATCH", `${V1}/drafts/${draftId}`, { json: body })),
  getOutcome: (id: string) => d(request<Envelope<Outcome>>("GET", `${V1}/cases/${id}/outcome`)),
  setOutcome: (id: string, body: OutcomePut) =>
    idempotent(`case.outcome.${id}`, { ...body, confirmed_at: undefined }, (key) =>
      d(request<Envelope<Outcome>>("PUT", `${V1}/cases/${id}/outcome`, { json: body, idempotencyKey: key })),
    ),

  listReminders: (q: { from_date?: string; to_date?: string; benefit_id?: string; case_id?: string } & Page = {}) =>
    request<ListEnvelope<Reminder>>("GET", `${V1}/reminders`, { query: { ...q } }),
  createReminder: (body: ReminderCreate) =>
    idempotent("reminder.create", body, (key) => d(request<Envelope<Reminder>>("POST", `${V1}/reminders`, { json: body, idempotencyKey: key }))),
  patchReminder: (id: string, body: ReminderPatch) => d(request<Envelope<Reminder>>("PATCH", `${V1}/reminders/${id}`, { json: body })),
  listNotifications: (p: Page = {}) => request<ListEnvelope<Notification>>("GET", `${V1}/notifications`, { query: { ...p } }),

  getJob: (id: string, signal?: AbortSignal) => d(request<Envelope<Job>>("GET", `${V1}/jobs/${id}`, { signal })),
};

/** Follows next_cursor until exhausted (bounded). */
export async function listAll<T>(fetchPage: (cursor: string | null) => Promise<ListEnvelope<T>>, maxPages = 20): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const page: ListEnvelope<T> = await fetchPage(cursor);
    out.push(...page.data);
    if (!page.next_cursor) break;
    cursor = page.next_cursor;
  }
  return out;
}
