/**
 * Stateful mock of contracts/backend.openapi.json v2.0.0 for NEXT_PUBLIC_API_MODE=mock.
 *
 * Framework-agnostic: `handleMockRequest(Request) → Response | null`. MSW wraps it in the browser,
 * Vitest uses the same function through msw/node. Same routes, envelopes, status codes and
 * error codes as the real Backend; data is sample data, persisted per demo session in localStorage.
 */
import type {
  Assessment, Benefit, Case, CaseEvent, ChatMessage, Dashboard, DeadlineRule, Document, Draft, Entry, ErrorCode,
  EvidenceRef, Fact, Job, Notification, Outcome, Profile, Reminder, ReminderOffset, Thread,
} from "@/api/types";
import { templateFor } from "./templates";

export const CONTRACT_VERSION = "2.0.0";

// ───────────────────────── state ─────────────────────────

interface JobMeta {
  documentId?: string;
  threadId?: string;
  userMessageId?: string;
  purpose?: "answer" | "match_need";
  question?: string;
  caseId?: string;
  caseContentVersion?: number;
  draftKind?: "initial" | "follow_up";
  replyText?: string;
  replyDocs?: string[];
  fail?: ErrorCode;
  done?: boolean;
}

interface Space {
  id: string;
  token: string;
  expires_at: string;
  revoked?: boolean;
  profile: Profile;
  entries: Entry[];
  documents: Document[];
  benefits: Benefit[];
  benefitKeys: Record<string, string>; // benefit_id → `${entry_id}:${candidate_key}`
  benefitCreated: Record<string, string>;
  threads: Thread[];
  messages: ChatMessage[];
  cases: Case[];
  caseContentVersion: Record<string, number>;
  events: CaseEvent[];
  drafts: Draft[];
  outcomes: Record<string, Outcome>;
  reminders: Reminder[];
  notifications: Notification[];
  jobs: Job[];
  jobMeta: Record<string, JobMeta>;
  idem: Record<string, { fp: string; status: number; body: unknown }>;
  docPages: Record<string, string>;
}

interface Db {
  spaces: Record<string, Space>; // by token
}

export interface MockOptions {
  baseUrl: string;
  now: () => number;
  /** queued → running → finished timings (ms) */
  jobDelays: { queued: number; running: number };
  persist: boolean;
}

const DB_KEY = "claimly.mock.db.v1";
const FILE_KEY = "claimly.mock.file.";
const FLAGS_KEY = "claimly.mock.flags";

let opts: MockOptions = {
  baseUrl: "http://localhost:8000",
  now: () => Date.now(),
  jobDelays: { queued: 700, running: 2200 },
  persist: true,
};
let db: Db | null = null;
const files = new Map<string, Blob>();

export function configureMock(o: Partial<MockOptions>) {
  opts = { ...opts, ...o, jobDelays: { ...opts.jobDelays, ...(o.jobDelays ?? {}) } };
}
export function resetMockDb() {
  db = { spaces: {} };
  files.clear();
  try {
    localStorage.removeItem(DB_KEY);
  } catch {
    /* ignore */
  }
}

export interface MockFlags {
  ai_off?: boolean;
}
export function getMockFlags(): MockFlags {
  try {
    return JSON.parse(localStorage.getItem(FLAGS_KEY) ?? "{}") as MockFlags;
  } catch {
    return {};
  }
}
export function setMockFlags(f: MockFlags) {
  try {
    localStorage.setItem(FLAGS_KEY, JSON.stringify(f));
  } catch {
    /* ignore */
  }
}
/** Mock control: make the current token behave as expired on the next request. */
export function expireMockSession(token: string) {
  const d = load();
  if (d.spaces[token]) d.spaces[token].revoked = true;
  save();
}

function load(fresh = false): Db {
  if (db && !(fresh && opts.persist)) return db;
  db = { spaces: {} };
  if (opts.persist) {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) db = JSON.parse(raw) as Db;
    } catch {
      db = { spaces: {} };
    }
  }
  return db;
}
function save() {
  if (!opts.persist || !db) return;
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {
    /* quota: keep in memory */
  }
}

// ───────────────────────── helpers ─────────────────────────

const uuid = () => crypto.randomUUID();
const nowIso = () => new Date(opts.now()).toISOString();
const today = () => new Date(opts.now()).toISOString().slice(0, 10);
const rid = () => `mock-${Math.random().toString(36).slice(2, 10)}`;

class HttpErr extends Error {
  constructor(public status: number, public code: ErrorCode, message: string, public retryable = false) {
    super(message);
  }
}
const notFound = (what: string) => new HttpErr(404, "NOT_FOUND", `${what} not found.`);
const invalid = (msg: string) => new HttpErr(422, "VALIDATION_ERROR", msg);
const conflict = (msg = "The resource was changed. Reload the latest version.") => new HttpErr(409, "CONFLICT", msg);

function headers(extra: Record<string, string> = {}) {
  return { "X-Contract-Version": CONTRACT_VERSION, ...extra };
}
function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: headers({ "Content-Type": "application/json" }) });
}
const ok = (data: unknown, status = 200) => json(status, { data, request_id: rid() });
const errorResponse = (e: HttpErr) =>
  json(e.status, { error: { code: e.code, message: e.message, retryable: e.retryable }, request_id: rid() });

function paginate<T>(items: T[], url: URL) {
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid("limit must be between 1 and 100.");
  const cursor = url.searchParams.get("cursor");
  let start = 0;
  if (cursor) {
    try {
      start = Number(atob(cursor));
    } catch {
      start = NaN;
    }
    if (!Number.isInteger(start) || start < 0) throw invalid("Invalid cursor.");
  }
  const page = items.slice(start, start + limit);
  const next = start + limit < items.length ? btoa(String(start + limit)) : null;
  return json(200, { data: page, next_cursor: next, request_id: rid() });
}

const cmp = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1);

const isUuid = (s: unknown) => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const isDateTime = (s: unknown) => typeof s === "string" && !Number.isNaN(Date.parse(s)) && s.includes("T");
const isTime = (s: unknown) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
function isTz(s: unknown) {
  if (typeof s !== "string" || !s) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: s });
    return true;
  } catch {
    return false;
  }
}
const OFFSETS: ReminderOffset[] = [30, 14, 7, 1, 0];

function addDays(date: string, n: number) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function addMonths(date: string, n: number) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

function stable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "u";
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${k}:${stable(o[k])}`).join(",")}}`;
}

// ───────────────────────── entity helpers ─────────────────────────

function getEntry(s: Space, id: string) {
  const e = s.entries.find((x) => x.id === id);
  if (!e) throw notFound("Entry");
  return e;
}
function getDoc(s: Space, id: string) {
  const d = s.documents.find((x) => x.id === id);
  if (!d) throw notFound("Document");
  return d;
}
function getBenefit(s: Space, id: string) {
  const b = s.benefits.find((x) => x.id === id);
  if (!b) throw notFound("Benefit");
  return b;
}
function getCase(s: Space, id: string) {
  const c = s.cases.find((x) => x.id === id);
  if (!c) throw notFound("Case");
  return c;
}
function touchEntry(e: Entry) {
  e.data_version += 1;
  e.updated_at = nowIso();
}
function touchCase(s: Space, c: Case, content = false) {
  c.data_version += 1;
  c.updated_at = nowIso();
  if (content) {
    s.caseContentVersion[c.id] = (s.caseContentVersion[c.id] ?? 1) + 1;
    for (const d of s.drafts) if (d.case_id === c.id) d.stale = true;
  }
}

function applyUsage(b: Benefit, used: number) {
  b.used_units = used;
  if (b.units_total !== null) {
    b.remaining_units = Math.max(0, b.units_total - used);
    b.usage_state = used === 0 ? "unused" : used >= b.units_total ? "used" : "partial";
  } else {
    b.remaining_units = null;
    b.usage_state = used === 0 ? "unused" : "partial";
  }
  b.data_version += 1;
}

function newJob(s: Space, kind: Job["kind"], meta: JobMeta): Job {
  const job: Job = {
    id: uuid(), kind, status: "queued", progress: null, result: null, error: null, created_at: nowIso(), updated_at: nowIso(),
  };
  s.jobs.push(job);
  s.jobMeta[job.id] = meta;
  return job;
}

function regenerateNotifications(s: Space, r: Reminder) {
  for (const n of s.notifications) if (n.reminder_id === r.id && n.status === "pending") n.status = "cancelled";
  if (r.status !== "active") return;
  for (const off of r.offset_days) {
    for (const ch of r.channels) {
      const day = addDays(r.date, -off);
      const scheduled = new Date(`${day}T${r.local_time}:00Z`).toISOString();
      s.notifications.push({
        id: uuid(), reminder_id: r.id, title: r.title,
        body: off === 0 ? `Today: ${r.title}` : `${r.title} — in ${off} day${off === 1 ? "" : "s"} (${r.date}).`,
        channel: ch, status: "pending", scheduled_at: scheduled, sent_at: null, read_at: null,
      });
    }
  }
}
function dispatchDue(s: Space) {
  const now = opts.now();
  for (const n of s.notifications) {
    if (n.status === "pending" && Date.parse(n.scheduled_at) <= now) {
      if (n.channel === "email" && !s.profile.email_configured) n.status = "failed";
      else {
        n.status = "sent";
        n.sent_at = n.scheduled_at;
      }
    }
  }
}

// ───────────────────────── job completion ─────────────────────────

function tick(s: Space) {
  const now = opts.now();
  let changed = false;
  for (const job of s.jobs) {
    if (["succeeded", "failed", "cancelled", "stale"].includes(job.status)) continue;
    const age = now - Date.parse(job.created_at);
    if (age >= opts.jobDelays.queued + opts.jobDelays.running) {
      complete(s, job);
      changed = true;
    } else if (age >= opts.jobDelays.queued && job.status === "queued") {
      job.status = "running";
      job.progress = job.kind === "extract" ? 40 : null;
      job.updated_at = nowIso();
      if (job.kind === "extract") {
        const d = s.documents.find((x) => x.id === s.jobMeta[job.id]?.documentId);
        if (d) d.status = "processing";
      }
      changed = true;
    }
  }
  dispatchDue(s);
  return changed;
}

function failJob(job: Job, code: ErrorCode, message: string, retryable: boolean) {
  job.status = "failed";
  job.progress = null;
  job.error = { code, message, retryable };
  job.updated_at = nowIso();
}

function complete(s: Space, job: Job) {
  const m = s.jobMeta[job.id] ?? {};
  job.updated_at = nowIso();
  try {
    if (m.fail) {
      const msg = m.fail === "AI_NOT_CONFIGURED" ? "AI is not configured." : "The document could not be read.";
      failJob(job, m.fail, msg, false);
      if (m.documentId) {
        const d = s.documents.find((x) => x.id === m.documentId);
        if (d) d.status = "failed";
      }
      return;
    }
    switch (job.kind) {
      case "extract":
        return completeExtract(s, job, m);
      case "answer":
      case "match_need":
        return completeAnswer(s, job, m);
      case "assess":
        return completeAssess(s, job, m);
      case "draft":
      case "draft_follow_up":
        return completeDraft(s, job, m);
      case "analyze_reply":
        return completeReply(s, job, m);
    }
  } catch (e) {
    failJob(job, "INTERNAL_ERROR", (e as Error).message, true);
  }
}

function ref(doc: Document, quote: string): EvidenceRef {
  return { document_id: doc.id, document_version: doc.version, page: 1, quote };
}

function completeExtract(s: Space, job: Job, m: JobMeta) {
  const doc = s.documents.find((d) => d.id === m.documentId);
  if (!doc) {
    job.status = "cancelled";
    return;
  }
  const entry = s.entries.find((e) => e.id === doc.entry_id);
  if (!entry) {
    job.status = "cancelled";
    return;
  }
  const t = templateFor(entry.category);
  s.docPages[doc.id] = t.pageText;

  const facts: Record<string, Fact> = {};
  for (const [k, f] of Object.entries(t.facts)) {
    facts[k] = { value: f.value, origin: "document", evidence_refs: [ref(doc, f.quote)], needs_review: f.needs_review };
  }
  doc.facts = facts;
  doc.page_count = 1;
  doc.review_flags = [...t.review_flags];

  // Never overwrite user corrections.
  for (const [k, f] of Object.entries(facts)) if (entry.facts[k]?.origin !== "user") entry.facts[k] = f;
  entry.provider ??= t.provider;
  entry.subject ??= t.subject;

  const ids: string[] = [];
  for (const c of t.benefits) {
    const key = `${entry.id}:${c.candidate_key}`;
    const existingId = Object.entries(s.benefitKeys).find(([, v]) => v === key)?.[0];
    const rule: DeadlineRule | null = c.deadline_rule
      ? { ...omit(c.deadline_rule, "quote"), evidence_refs: [ref(doc, c.deadline_rule.quote)] }
      : null;
    let ruleDate: string | null = rule?.date ?? null;
    if (rule && rule.kind === "relative" && rule.anchor_field && rule.duration_value && rule.duration_unit) {
      const anchor = entry.facts[rule.anchor_field]?.value;
      if (typeof anchor === "string" && isDate(anchor)) {
        ruleDate = rule.duration_unit === "calendar_months" ? addMonths(anchor, rule.duration_value) : addDays(anchor, rule.duration_value);
      }
    }
    const confirmed = !!rule && rule.kind === "absolute" && rule.last_day_inclusion !== "unknown" && !c.needs_review && !!rule.date;
    const base = {
      title: c.title, type: c.type, description: c.description, conditions: c.conditions, units_total: c.units_total,
      stated_value_cents: c.stated_value_cents, currency: c.currency, deadline_rule: rule, instructions: c.instructions,
      evidence_refs: [ref(doc, c.quote)], needs_review: c.needs_review,
    };
    if (existingId) {
      const b = getBenefit(s, existingId);
      Object.assign(b, base);
      b.data_version += 1;
      ids.push(b.id);
      continue;
    }
    const b: Benefit = {
      ...base, id: uuid(), entry_id: entry.id, usage_state: "unknown", used_units: null, remaining_units: null,
      deadline_date: confirmed ? rule!.date : null,
      deadline_status: !rule ? "not_known" : confirmed ? "document_confirmed" : "needs_review",
      data_version: 1,
    };
    s.benefits.push(b);
    s.benefitKeys[b.id] = key;
    s.benefitCreated[b.id] = nowIso();
    entry.benefit_ids.push(b.id);
    ids.push(b.id);
    if (ruleDate) {
      const r: Reminder = {
        id: uuid(), benefit_id: b.id, case_id: null, title: b.title, date: ruleDate, timezone: s.profile.timezone,
        local_time: s.profile.local_notification_time, origin: "document", offset_days: [...s.profile.reminder_offsets],
        channels: ["in_app"], status: confirmed ? "active" : "needs_review", evidence_refs: rule!.evidence_refs,
      };
      s.reminders.push(r);
      regenerateNotifications(s, r);
    }
  }
  touchEntry(entry);
  const review = doc.review_flags.length > 0 || t.benefits.some((b) => b.needs_review) || Object.values(facts).some((f) => f.needs_review);
  doc.status = review ? "needs_review" : "ready";
  job.status = "succeeded";
  job.progress = 100;
  job.result = { type: "extract", document_id: doc.id, benefit_ids: ids, review_required: review };
}

function omit<T extends object, K extends keyof T>(o: T, k: K): Omit<T, K> {
  const c = { ...o };
  delete c[k];
  return c;
}

const STOP = new Set("what which with this that have from your about need does there their when where would could should into they them then than will just been were also only some more most very much many like make made want please mine currently free".split(" "));
const SYN: Record<string, string[]> = {
  car: ["vehicle", "oil", "inspection", "tire"], inspected: ["inspection"], inspect: ["inspection"],
  teeth: ["dental", "cleaning"], dentist: ["dental", "cleaning"], tooth: ["dental"],
  laptop: ["defect", "warranty"], broken: ["defect", "coverage", "warranty"], broke: ["defect"], repair: ["defect", "warranty"],
  stolen: ["property"], flood: ["flood", "excluded"], water: ["flood"], refund: ["return"], return: ["return"], tires: ["tire"],
};
function words(t: string) {
  return t.toLowerCase().match(/[a-z]+/g)?.filter((w) => w.length > 3 && !STOP.has(w)) ?? [];
}
function score(q: string, b: Benefit) {
  const qs = new Set(words(q).flatMap((w) => [w, w.replace(/s$/, ""), ...(SYN[w] ?? [])]));
  const bs = words(`${b.title} ${b.description} ${b.conditions.join(" ")}`).map((w) => w.replace(/s$/, ""));
  return bs.filter((w) => qs.has(w)).length;
}

function scopeBenefits(s: Space, t: Thread): Benefit[] {
  if (t.scope === "entry" && t.entry_id) return s.benefits.filter((b) => b.entry_id === t.entry_id);
  if (t.scope === "case" && t.case_id) {
    const c = s.cases.find((x) => x.id === t.case_id);
    if (!c) return [];
    return s.benefits.filter((b) => b.id === c.benefit_id || c.entry_ids.includes(b.entry_id));
  }
  return s.benefits;
}

function usageText(b: Benefit) {
  if (b.units_total === null) return b.usage_state === "unknown" ? "usage not confirmed yet" : `used ${b.used_units ?? "?"}`;
  if (b.usage_state === "unknown") return `${b.units_total} listed; prior usage unknown`;
  return `${b.remaining_units} of ${b.units_total} remaining`;
}

function completeAnswer(s: Space, job: Job, m: JobMeta) {
  const t = s.threads.find((x) => x.id === m.threadId);
  if (!t) {
    job.status = "cancelled";
    return;
  }
  const q = m.question ?? "";
  const pool = scopeBenefits(s, t).filter((b) => b.usage_state !== "used");
  const scored = pool.map((b) => ({ b, sc: score(q, b) })).filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc);
  const generic = /\b(benefits?|have|list|what)\b/i.test(q) && m.purpose === "answer";
  const matched = scored.length ? scored.map((x) => x.b).slice(0, 3) : generic ? pool.slice(0, 5) : [];
  let content: string;
  const questions: string[] = [];
  const next: ChatMessage["next_actions"] = [];
  if (!matched.length) {
    content = m.purpose === "match_need"
      ? "Sample answer: I didn't find a benefit in your documents that matches this need. Add the document that describes it, or tell me more about what you need."
      : "Sample answer: Your documents don't mention this. I can't confirm it without a document that describes it.";
    next.push({ type: "add_document", label: "Add a document", target_id: t.entry_id });
  } else {
    const lines = matched.map((b) => `• ${b.title} — ${usageText(b)}${b.deadline_date ? `, use by ${b.deadline_date}` : ""}.`);
    content = `${m.purpose === "match_need" ? "Sample answer: These benefits in your documents may cover this need:" : "Sample answer: Here's what your documents say:"}\n${lines.join("\n")}\nA listed benefit isn't a guarantee for your situation — check the conditions.`;
    for (const b of matched) {
      if (b.usage_state === "unknown" && b.units_total !== null) questions.push(`How many of the ${b.units_total} "${b.title}" have you already used?`);
      next.push({ type: "open_benefit", label: `View ${b.title}`, target_id: b.id });
    }
  }
  const msg: ChatMessage = {
    id: uuid(), thread_id: t.id, role: "assistant", content,
    evidence_refs: matched.flatMap((b) => b.evidence_refs).slice(0, 4),
    matched_benefit_ids: matched.map((b) => b.id), questions: questions.slice(0, 2), next_actions: next.slice(0, 3),
    created_at: nowIso(),
  };
  s.messages.push(msg);
  job.status = "succeeded";
  job.result = { type: m.purpose === "match_need" ? "match_need" : "answer", assistant_message: msg };
}

function caseStaleCheck(s: Space, job: Job, m: JobMeta): Case | null {
  const c = s.cases.find((x) => x.id === m.caseId);
  if (!c) {
    job.status = "cancelled";
    return null;
  }
  if ((s.caseContentVersion[c.id] ?? 1) !== m.caseContentVersion) {
    job.status = "stale";
    job.error = { code: "STALE_INPUT", message: "The case changed while this was running. Run it again.", retryable: true };
    return null;
  }
  return c;
}

function assessmentFor(s: Space, c: Case): Assessment {
  const b = c.benefit_id ? s.benefits.find((x) => x.id === c.benefit_id) : undefined;
  if (!b) {
    return {
      status: "insufficient_evidence", summary: "Sample assessment: no document with relevant terms is linked to this case yet.",
      reasons: ["The case has no linked benefit or coverage terms."], evidence_refs: [],
      missing_info: ["The document that describes the coverage or service"],
      next_actions: [{ type: "add_document", label: "Add a document", target_id: c.entry_ids[0] ?? null }],
    };
  }
  if (b.usage_state === "unknown") {
    return {
      status: "insufficient_evidence", summary: "Sample assessment: prior usage must be confirmed.",
      reasons: [`The document lists ${b.units_total ?? "the"} ${b.title.toLowerCase()} but not the remaining balance.`],
      evidence_refs: b.evidence_refs, missing_info: ["Prior usage"],
      next_actions: [{ type: "open_benefit", label: "Confirm usage", target_id: b.id }],
    };
  }
  if (b.remaining_units === 0) {
    return {
      status: "likely_excluded", summary: "Sample assessment: all listed units are marked as used.",
      reasons: ["Your confirmed usage equals the total listed in the document."], evidence_refs: b.evidence_refs,
      missing_info: [], next_actions: [{ type: "open_benefit", label: "Review usage", target_id: b.id }],
    };
  }
  return {
    status: "possible", summary: `Sample assessment: the document lists this benefit${b.remaining_units !== null ? ` and ${b.remaining_units} remain` : ""}.`,
    reasons: b.conditions.length ? b.conditions : ["The document lists this benefit."], evidence_refs: b.evidence_refs,
    missing_info: c.incident_date ? [] : ["Preferred date"],
    next_actions: [{ type: "open_case", label: "Prepare a request", target_id: c.id }],
  };
}

function completeAssess(s: Space, job: Job, m: JobMeta) {
  const c = caseStaleCheck(s, job, m);
  if (!c) return;
  c.assessment = assessmentFor(s, c);
  touchCase(s, c);
  job.status = "succeeded";
  job.result = { type: "assess", case_id: c.id, assessment: c.assessment };
}

function completeDraft(s: Space, job: Job, m: JobMeta) {
  const c = caseStaleCheck(s, job, m);
  if (!c) return;
  const b = c.benefit_id ? s.benefits.find((x) => x.id === c.benefit_id) : undefined;
  const entry = s.entries.find((e) => c.entry_ids.includes(e.id));
  const lastReply = [...s.events].reverse().find((e) => e.case_id === c.id && e.type === "company_reply");
  const follow = m.draftKind === "follow_up";
  const body = follow
    ? `Hello,\n\nThank you for your reply${lastReply ? ` on ${lastReply.event_date.slice(0, 10)}` : ""}. I'm following up on my request "${c.title}".\n\n${b ? `My ${entry?.title ?? "document"} lists: ${b.evidence_refs[0]?.quote ?? b.description}\n\n` : ""}Could you please confirm the next steps${c.desired_result ? ` so that I can ${c.desired_result.charAt(0).toLowerCase()}${c.desired_result.slice(1)}` : ""}?\n\nThank you.`
    : `Hello,\n\n${c.situation}\n\n${b ? `My ${entry?.title ?? "document"} states: "${b.evidence_refs[0]?.quote ?? b.description}"\n\n` : ""}${c.desired_result ? `I would like to: ${c.desired_result}\n\n` : ""}Please confirm the next steps. Thank you.`;
  const draft: Draft = {
    id: uuid(), case_id: c.id, kind: follow ? "follow_up" : "initial",
    content: {
      subject: follow ? `Follow-up: ${c.title}` : `${c.title}${entry?.provider ? ` — ${entry.provider}` : ""}`,
      body, attachments: entry ? [entry.title] : [], contact: null, contact_origin: "unknown",
      evidence_refs: b?.evidence_refs ?? [], missing_info: ["Provider contact"],
    },
    input_version: c.data_version, user_edited: false, stale: false, updated_at: nowIso(),
  };
  s.drafts.push(draft);
  s.events.push({
    id: uuid(), case_id: c.id, type: "draft_created", event_date: nowIso(), note: follow ? "Follow-up draft prepared." : "Request draft prepared.",
    attachment_document_ids: [], new_status: null, reply_analysis: null,
  });
  if (c.status === "draft" && !follow) {
    c.status = "prepared";
    touchCase(s, c);
    draft.input_version = c.data_version;
  }
  job.status = "succeeded";
  job.result = { type: follow ? "draft_follow_up" : "draft", draft };
}

function completeReply(s: Space, job: Job, m: JobMeta) {
  const c = s.cases.find((x) => x.id === m.caseId);
  if (!c) {
    job.status = "cancelled";
    return;
  }
  const text = (m.replyText ?? "").trim();
  const docTexts = (m.replyDocs ?? []).map((id) => s.docPages[id] ?? "").join(" ");
  const all = `${text} ${docTexts}`.toLowerCase();
  const position = /approv|we will (refund|replace|repair)|accepted|confirm/.test(all)
    ? "The company appears to accept the request."
    : /den(y|ied)|reject|not covered|unable to|cannot/.test(all)
      ? "The company appears to decline the request."
      : "The company asks for more information or doesn't take a clear position.";
  const b = c.benefit_id ? s.benefits.find((x) => x.id === c.benefit_id) : undefined;
  const event: CaseEvent = {
    id: uuid(), case_id: c.id, type: "company_reply", event_date: nowIso(),
    note: text || "Company reply attached as a document.", attachment_document_ids: m.replyDocs ?? [], new_status: null,
    reply_analysis: {
      summary: `Sample analysis: ${text ? (text.length > 160 ? text.slice(0, 157) + "…" : text) : "Reply provided as a document."}`,
      company_position: position,
      comparison: b ? `Your document lists: "${b.evidence_refs[0]?.quote ?? b.description}". Compare this with the company's position.` : "No linked document terms to compare with.",
      evidence_refs: b?.evidence_refs ?? [], missing_info: /information|provide|send/.test(all) ? ["Details the company asked for"] : [],
      next_actions: [{ type: "open_case", label: "Prepare a follow-up", target_id: c.id }],
    },
  };
  s.events.push(event);
  job.status = "succeeded";
  job.result = { type: "analyze_reply", case_id: c.id, event };
}

// ───────────────────────── routing ─────────────────────────

type Ctx = { s: Space; url: URL; req: Request; params: string[] };
type Handler = (c: Ctx) => Promise<Response> | Response;
interface Route {
  method: string;
  re: RegExp;
  idem?: boolean;
  h: Handler;
}

const U = "([0-9a-fA-F-]{36})";
const routes: Route[] = [];
const route = (method: string, path: string, h: Handler, idem = false) =>
  routes.push({ method, re: new RegExp(`^${path.replace(/:id/g, U)}$`), h, idem });

async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    const b = await req.clone().json();
    if (b === null || typeof b !== "object" || Array.isArray(b)) throw new Error();
    return b as T;
  } catch {
    throw invalid("Request body must be a JSON object.");
  }
}
function only(b: Record<string, unknown>, allowed: string[], required: string[] = []) {
  for (const k of Object.keys(b)) if (!allowed.includes(k)) throw invalid(`Unknown field: ${k}.`);
  for (const k of required) if (!(k in b)) throw invalid(`Missing required field: ${k}.`);
}
function expectVersion(actual: number, expected: unknown) {
  if (typeof expected !== "number" || expected < 1) throw invalid("expected_version is required.");
  if (actual !== expected) throw conflict();
}
function nullableStr(v: unknown, f: string) {
  if (v !== null && typeof v !== "string") throw invalid(`${f} must be a string or null.`);
}
function uuidArray(v: unknown, f: string) {
  if (!Array.isArray(v) || !v.every(isUuid)) throw invalid(`${f} must be an array of UUIDs.`);
}

const CATEGORIES = ["receipt", "warranty", "insurance", "service_agreement", "service_contract", "gift_certificate", "subscription", "membership", "refund_confirmation", "correspondence", "other"];
const CASE_TYPES = ["benefit_use", "warranty", "insurance_question", "product_return", "refund_delay", "follow_up"];
const CASE_STATUSES = ["draft", "prepared", "submitted", "awaiting_response", "approved", "denied", "resolved"];
const OUTCOME_KINDS = ["cash_refund", "service_used", "repair", "replacement", "voucher_used", "denied", "closed_without_result"];
const MIME = ["application/pdf", "image/jpeg", "image/png"];

function requireAi() {
  if (getMockFlags().ai_off) throw new HttpErr(503, "AI_NOT_CONFIGURED", "AI is not configured.", false);
}

// profile & dashboard
route("GET", "/api/v1/profile", ({ s }) => ok(s.profile));
route("PATCH", "/api/v1/profile", async ({ s, req }) => {
  const b = await body(req);
  only(b, ["timezone", "email_notification_opt_in", "reminder_offsets", "local_notification_time", "notification_email"]);
  if ("timezone" in b && !isTz(b.timezone)) throw invalid("timezone must be an IANA time zone.");
  if ("email_notification_opt_in" in b && typeof b.email_notification_opt_in !== "boolean") throw invalid("email_notification_opt_in must be boolean.");
  if ("reminder_offsets" in b && (!Array.isArray(b.reminder_offsets) || !b.reminder_offsets.every((x) => OFFSETS.includes(x as ReminderOffset)))) throw invalid("reminder_offsets must contain 30, 14, 7, 1 or 0.");
  if ("local_notification_time" in b && !isTime(b.local_notification_time)) throw invalid("local_notification_time must be HH:MM.");
  if ("notification_email" in b && b.notification_email !== null && !(typeof b.notification_email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.notification_email))) throw invalid("notification_email must be a valid email.");
  Object.assign(s.profile, b);
  return ok(s.profile);
});
route("GET", "/api/v1/dashboard", ({ s }) => {
  const live = s.benefits;
  const available = live.filter((b) => b.usage_state === "unused" || (b.usage_state === "partial" && (b.remaining_units === null || b.remaining_units > 0)));
  const outcomes = Object.values(s.outcomes);
  const t = today();
  const d: Dashboard = {
    available_benefits_count: available.length,
    usage_unknown_count: live.filter((b) => b.usage_state === "unknown").length,
    document_valued_benefits_cents: live.filter((b) => b.usage_state !== "used" && b.stated_value_cents !== null).reduce((a, b) => a + (b.stated_value_cents ?? 0), 0),
    approved_not_received_cents: s.cases.filter((c) => c.status === "approved" && !(s.outcomes[c.id]?.kind === "cash_refund")).reduce((a, c) => a + (c.approved_amount_cents ?? 0), 0),
    cash_recovered_cents: outcomes.filter((o) => o.kind === "cash_refund").reduce((a, o) => a + (o.cash_amount_cents ?? 0), 0),
    services_used_units: live.reduce((a, b) => a + (b.used_units ?? 0), 0),
    currency: "USD",
    next_benefits: [...live].filter((b) => b.usage_state !== "used").sort((a, b) => cmp(a.deadline_date, b.deadline_date) || cmp(a.id, b.id)).slice(0, 4),
    upcoming_reminders: s.reminders.filter((r) => r.status !== "cancelled" && r.status !== "done" && r.date >= t).sort((a, b) => cmp(a.date, b.date) || cmp(a.id, b.id)).slice(0, 5),
    active_cases: s.cases.filter((c) => c.status !== "resolved").sort((a, b) => cmp(b.updated_at, a.updated_at) || cmp(a.id, b.id)).slice(0, 5),
  };
  return ok(d);
});

// entries
route("GET", "/api/v1/entries", ({ s, url }) => {
  const cat = url.searchParams.get("category");
  const q = url.searchParams.get("q")?.toLowerCase().trim();
  let items = s.entries.filter((e) => !cat || e.category === cat);
  if (q) items = items.filter((e) => [e.title, e.provider ?? "", e.subject ?? ""].some((x) => x.toLowerCase().includes(q)));
  items = [...items].sort((a, b) => cmp(b.created_at, a.created_at) || cmp(a.id, b.id));
  return paginate(items, url);
});
route("POST", "/api/v1/entries", async ({ s, req }) => {
  const b = await body(req);
  only(b, ["title", "category", "provider", "subject"], ["title", "category"]);
  if (typeof b.title !== "string" || !b.title.trim()) throw invalid("title is required.");
  if (!CATEGORIES.includes(b.category as string)) throw invalid("Unknown category.");
  nullableStr(b.provider ?? null, "provider");
  nullableStr(b.subject ?? null, "subject");
  const e: Entry = {
    id: uuid(), title: (b.title as string).trim(), category: b.category as Entry["category"], provider: (b.provider as string | null) ?? null,
    subject: (b.subject as string | null) ?? null, facts: {}, data_version: 1, document_ids: [], benefit_ids: [], created_at: nowIso(), updated_at: nowIso(),
  };
  s.entries.push(e);
  return ok(e, 201);
}, true);
route("GET", "/api/v1/entries/:id", ({ s, params }) => ok(getEntry(s, params[0])));
route("PATCH", "/api/v1/entries/:id", async ({ s, req, params }) => {
  const e = getEntry(s, params[0]);
  const b = await body(req);
  only(b, ["title", "provider", "subject", "facts", "expected_version"], ["expected_version"]);
  expectVersion(e.data_version, b.expected_version);
  if ("title" in b && (typeof b.title !== "string" || !b.title.trim())) throw invalid("title must not be empty.");
  if ("provider" in b) nullableStr(b.provider, "provider");
  if ("subject" in b) nullableStr(b.subject, "subject");
  if ("title" in b) e.title = (b.title as string).trim();
  if ("provider" in b) e.provider = b.provider as string | null;
  if ("subject" in b) e.subject = b.subject as string | null;
  if ("facts" in b) {
    if (!b.facts || typeof b.facts !== "object") throw invalid("facts must be an object.");
    for (const [k, f] of Object.entries(b.facts as Record<string, Fact>)) {
      if (!f || typeof f !== "object" || !("value" in f) || !["document", "user", "calculated"].includes(f.origin) || !Array.isArray(f.evidence_refs) || typeof f.needs_review !== "boolean") throw invalid(`Invalid fact: ${k}.`);
      e.facts[k] = f;
    }
  }
  touchEntry(e);
  return ok(e);
});
route("DELETE", "/api/v1/entries/:id", ({ s, params }) => {
  const e = getEntry(s, params[0]);
  for (const id of e.document_ids) removeDocument(s, id);
  const bIds = new Set(s.benefits.filter((b) => b.entry_id === e.id).map((b) => b.id));
  s.benefits = s.benefits.filter((b) => !bIds.has(b.id));
  for (const r of s.reminders) if (r.benefit_id && bIds.has(r.benefit_id)) {
    r.status = "cancelled";
    regenerateNotifications(s, r);
  }
  const tIds = new Set(s.threads.filter((t) => t.entry_id === e.id).map((t) => t.id));
  s.threads = s.threads.filter((t) => !tIds.has(t.id));
  s.messages = s.messages.filter((m) => !tIds.has(m.thread_id));
  s.entries = s.entries.filter((x) => x.id !== e.id);
  return new Response(null, { status: 204, headers: headers() });
});

function removeDocument(s: Space, id: string) {
  s.documents = s.documents.filter((d) => d.id !== id);
  files.delete(id);
  try {
    localStorage.removeItem(FILE_KEY + id);
  } catch {
    /* ignore */
  }
  for (const j of s.jobs) {
    if (s.jobMeta[j.id]?.documentId === id && !["succeeded", "failed", "cancelled", "stale"].includes(j.status)) {
      j.status = "cancelled";
      j.updated_at = nowIso();
    }
  }
  for (const e of s.entries) if (e.document_ids.includes(id)) {
    e.document_ids = e.document_ids.filter((x) => x !== id);
    touchEntry(e);
  }
}

// documents
route("POST", "/api/v1/documents", async ({ s, req }) => {
  let form: FormData;
  try {
    form = await req.clone().formData();
  } catch {
    throw invalid("Expected multipart/form-data with entry_id and file.");
  }
  const entryId = form.get("entry_id");
  const file = form.get("file");
  if (typeof entryId !== "string" || !isUuid(entryId)) throw invalid("entry_id is required.");
  if (!file || typeof file === "string") throw invalid("file is required.");
  const entry = getEntry(s, entryId);
  const f = file as File;
  if (!MIME.includes(f.type)) throw invalid("Only PDF, JPG and PNG files are supported.");
  if (f.size > 10 * 1024 * 1024) throw new HttpErr(413, "FILE_TOO_LARGE", "File exceeds 10 MB.");
  const doc: Document = {
    id: uuid(), entry_id: entry.id, name: f.name || "document", mime_type: f.type as Document["mime_type"], version: 1, status: "uploaded",
    page_count: null, facts: {}, review_flags: [], created_at: nowIso(),
  };
  s.documents.push(doc);
  entry.document_ids.push(doc.id);
  touchEntry(entry);
  const blob = new Blob([await f.arrayBuffer()], { type: f.type });
  files.set(doc.id, blob);
  void persistFile(doc.id, blob);
  const fail: ErrorCode | undefined = getMockFlags().ai_off ? "AI_NOT_CONFIGURED" : /unreadable/i.test(f.name) ? "UNREADABLE_DOCUMENT" : undefined;
  const job = newJob(s, "extract", { documentId: doc.id, fail });
  return ok({ document: doc, job }, 202);
}, true);

async function persistFile(id: string, blob: Blob) {
  if (!opts.persist || blob.size > 1_500_000) return;
  try {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    localStorage.setItem(FILE_KEY + id, `${blob.type};${btoa(bin)}`);
  } catch {
    /* quota exceeded: bytes stay in memory for this tab */
  }
}
function readFile(id: string): Blob | null {
  const m = files.get(id);
  if (m) return m;
  try {
    const raw = localStorage.getItem(FILE_KEY + id);
    if (!raw) return null;
    const i = raw.indexOf(";");
    const bin = atob(raw.slice(i + 1));
    const bytes = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    const blob = new Blob([bytes], { type: raw.slice(0, i) });
    files.set(id, blob);
    return blob;
  } catch {
    return null;
  }
}

route("GET", "/api/v1/documents/:id", ({ s, params }) => ok(getDoc(s, params[0])));
route("DELETE", "/api/v1/documents/:id", ({ s, params }) => {
  getDoc(s, params[0]);
  removeDocument(s, params[0]);
  return new Response(null, { status: 204, headers: headers() });
});
route("GET", "/api/v1/documents/:id/content", ({ s, params }) => {
  const d = getDoc(s, params[0]);
  const blob = readFile(d.id);
  if (!blob) throw new HttpErr(404, "NOT_FOUND", "The original file is not available in this sample session.");
  return new Response(blob, { status: 200, headers: headers({ "Content-Type": d.mime_type }) });
});
route("POST", "/api/v1/documents/:id/analyze", async ({ s, req, params }) => {
  const d = getDoc(s, params[0]);
  const b = await body(req);
  only(b, ["force"], ["force"]);
  if (typeof b.force !== "boolean") throw invalid("force must be boolean.");
  const running = s.jobs.find((j) => s.jobMeta[j.id]?.documentId === d.id && (j.status === "queued" || j.status === "running"));
  if (running && !b.force) return ok(running, 202);
  if (running) {
    running.status = "stale";
    running.updated_at = nowIso();
  }
  const job = newJob(s, "extract", { documentId: d.id, fail: getMockFlags().ai_off ? "AI_NOT_CONFIGURED" : undefined });
  d.status = "uploaded";
  return ok(job, 202);
}, true);

// benefits
route("GET", "/api/v1/benefits", ({ s, url }) => {
  const entryId = url.searchParams.get("entry_id");
  const st = url.searchParams.get("usage_state");
  const q = url.searchParams.get("q")?.toLowerCase().trim();
  let items = s.benefits.filter((b) => (!entryId || b.entry_id === entryId) && (!st || b.usage_state === st));
  if (q) items = items.filter((b) => `${b.title} ${b.description}`.toLowerCase().includes(q));
  items = [...items].sort((a, b) => cmp(a.deadline_date, b.deadline_date) || cmp(s.benefitCreated[a.id] ?? "", s.benefitCreated[b.id] ?? "") || cmp(a.id, b.id));
  return paginate(items, url);
});
route("GET", "/api/v1/benefits/:id", ({ s, params }) => ok(getBenefit(s, params[0])));
route("PATCH", "/api/v1/benefits/:id", async ({ s, req, params }) => {
  const bn = getBenefit(s, params[0]);
  const b = await body(req);
  only(b, ["title", "confirmed_review", "deadline_date", "deadline_origin", "expected_version"], ["expected_version"]);
  expectVersion(bn.data_version, b.expected_version);
  if ("title" in b) {
    if (typeof b.title !== "string" || !b.title.trim()) throw invalid("title must not be empty.");
    bn.title = b.title.trim();
  }
  if (b.confirmed_review === true) bn.needs_review = false;
  if ("deadline_date" in b) {
    if (b.deadline_date !== null && !isDate(b.deadline_date)) throw invalid("deadline_date must be YYYY-MM-DD or null.");
    bn.deadline_date = b.deadline_date as string | null;
    bn.deadline_status = b.deadline_date === null ? (bn.deadline_rule ? "needs_review" : "not_known") : b.deadline_origin === "document" ? "document_confirmed" : "user_set";
    for (const r of s.reminders) if (r.benefit_id === bn.id && r.case_id === null && r.status !== "cancelled" && bn.deadline_date) {
      r.date = bn.deadline_date;
      r.status = "active";
      regenerateNotifications(s, r);
    }
  }
  bn.data_version += 1;
  return ok(bn);
});
route("PUT", "/api/v1/benefits/:id/usage", async ({ s, req, params }) => {
  const bn = getBenefit(s, params[0]);
  const b = await body(req);
  only(b, ["used_units", "confirmed_at", "note", "expected_version"], ["used_units", "confirmed_at", "note", "expected_version"]);
  if (!Number.isInteger(b.used_units) || (b.used_units as number) < 0) throw invalid("used_units must be a non-negative integer.");
  if (bn.units_total !== null && (b.used_units as number) > bn.units_total) throw invalid(`used_units can't exceed ${bn.units_total}.`);
  if (!isDateTime(b.confirmed_at)) throw invalid("confirmed_at must be ISO 8601.");
  if (typeof b.note !== "string") throw invalid("note must be a string.");
  expectVersion(bn.data_version, b.expected_version);
  applyUsage(bn, b.used_units as number);
  return ok(bn);
}, true);

// threads & messages
route("POST", "/api/v1/threads", async ({ s, req }) => {
  const b = await body(req);
  only(b, ["scope", "entry_id", "case_id", "document_ids"], ["scope", "entry_id", "case_id", "document_ids"]);
  if (!["vault", "entry", "case"].includes(b.scope as string)) throw invalid("Unknown scope.");
  if (b.scope === "entry" && !isUuid(b.entry_id)) throw invalid("entry_id is required for entry threads.");
  if (b.scope === "case" && !isUuid(b.case_id)) throw invalid("case_id is required for case threads.");
  uuidArray(b.document_ids, "document_ids");
  if (b.entry_id) getEntry(s, b.entry_id as string);
  if (b.case_id) getCase(s, b.case_id as string);
  const t: Thread = {
    id: uuid(), scope: b.scope as Thread["scope"], entry_id: (b.entry_id as string | null) ?? null, case_id: (b.case_id as string | null) ?? null,
    document_ids: b.document_ids as string[], created_at: nowIso(),
  };
  s.threads.push(t);
  return ok(t, 201);
}, true);
route("GET", "/api/v1/threads", ({ s, url }) => {
  const sc = url.searchParams.get("scope");
  const e = url.searchParams.get("entry_id");
  const c = url.searchParams.get("case_id");
  const items = s.threads.filter((t) => (!sc || t.scope === sc) && (!e || t.entry_id === e) && (!c || t.case_id === c)).sort((a, b) => cmp(a.created_at, b.created_at) || cmp(a.id, b.id));
  return paginate(items, url);
});
route("GET", "/api/v1/threads/:id/messages", ({ s, url, params }) => {
  if (!s.threads.some((t) => t.id === params[0])) throw notFound("Thread");
  const items = s.messages.filter((m) => m.thread_id === params[0]).sort((a, b) => cmp(a.created_at, b.created_at) || (a.role === b.role ? cmp(a.id, b.id) : a.role === "user" ? -1 : 1));
  return paginate(items, url);
});
route("POST", "/api/v1/threads/:id/messages", async ({ s, req, params }) => {
  const t = s.threads.find((x) => x.id === params[0]);
  if (!t) throw notFound("Thread");
  const b = await body(req);
  only(b, ["content", "purpose"], ["content", "purpose"]);
  if (typeof b.content !== "string" || !b.content.trim()) throw invalid("content must not be empty.");
  if (b.purpose !== "answer" && b.purpose !== "match_need") throw invalid("purpose must be answer or match_need.");
  requireAi();
  const msg: ChatMessage = {
    id: uuid(), thread_id: t.id, role: "user", content: b.content, evidence_refs: [], matched_benefit_ids: [], questions: [], next_actions: [], created_at: nowIso(),
  };
  s.messages.push(msg);
  const job = newJob(s, b.purpose, { threadId: t.id, userMessageId: msg.id, purpose: b.purpose, question: b.content });
  return ok({ message: msg, job }, 202);
}, true);

// cases
route("GET", "/api/v1/cases", ({ s, url }) => {
  const st = url.searchParams.get("status");
  const e = url.searchParams.get("entry_id");
  const items = s.cases.filter((c) => (!st || c.status === st) && (!e || c.entry_ids.includes(e))).sort((a, b) => cmp(b.updated_at, a.updated_at) || cmp(a.id, b.id));
  return paginate(items, url);
});
route("POST", "/api/v1/cases", async ({ s, req }) => {
  const b = await body(req);
  only(b, ["title", "type", "entry_ids", "document_ids", "benefit_id", "situation", "incident_date", "desired_result"], ["title", "type", "entry_ids", "document_ids", "benefit_id", "situation", "incident_date", "desired_result"]);
  if (typeof b.title !== "string" || !b.title.trim()) throw invalid("title is required.");
  if (!CASE_TYPES.includes(b.type as string)) throw invalid("Unknown case type.");
  uuidArray(b.entry_ids, "entry_ids");
  uuidArray(b.document_ids, "document_ids");
  if (b.benefit_id !== null && !isUuid(b.benefit_id)) throw invalid("benefit_id must be a UUID or null.");
  if (typeof b.situation !== "string") throw invalid("situation must be a string.");
  if (b.incident_date !== null && !isDate(b.incident_date)) throw invalid("incident_date must be YYYY-MM-DD or null.");
  nullableStr(b.desired_result, "desired_result");
  for (const id of b.entry_ids as string[]) getEntry(s, id);
  if (b.benefit_id) getBenefit(s, b.benefit_id as string);
  const caseId = uuid();
  const thread: Thread = { id: uuid(), scope: "case", entry_id: null, case_id: caseId, document_ids: b.document_ids as string[], created_at: nowIso() };
  const c: Case = {
    id: caseId, title: (b.title as string).trim(), type: b.type as Case["type"], entry_ids: b.entry_ids as string[], document_ids: b.document_ids as string[],
    benefit_id: b.benefit_id as string | null, situation: b.situation as string, incident_date: b.incident_date as string | null,
    desired_result: b.desired_result as string | null, status: "draft", assessment: null, requested_amount_cents: null, approved_amount_cents: null,
    data_version: 1, thread_id: thread.id, created_at: nowIso(), updated_at: nowIso(),
  };
  s.cases.push(c);
  s.threads.push(thread);
  s.caseContentVersion[c.id] = 1;
  return ok(c, 201);
}, true);
route("GET", "/api/v1/cases/:id", ({ s, params }) => ok(getCase(s, params[0])));
route("PATCH", "/api/v1/cases/:id", async ({ s, req, params }) => {
  const c = getCase(s, params[0]);
  const b = await body(req);
  only(b, ["situation", "incident_date", "desired_result", "document_ids", "expected_version"], ["expected_version"]);
  expectVersion(c.data_version, b.expected_version);
  if ("situation" in b && typeof b.situation !== "string") throw invalid("situation must be a string.");
  if ("incident_date" in b && b.incident_date !== null && !isDate(b.incident_date)) throw invalid("incident_date must be YYYY-MM-DD or null.");
  if ("desired_result" in b) nullableStr(b.desired_result, "desired_result");
  if ("document_ids" in b) uuidArray(b.document_ids, "document_ids");
  Object.assign(c, omit(b, "expected_version"));
  const t = s.threads.find((x) => x.id === c.thread_id);
  if (t && "document_ids" in b) t.document_ids = b.document_ids as string[];
  touchCase(s, c, true);
  return ok(c);
});
route("POST", "/api/v1/cases/:id/assess", ({ s, params }) => {
  const c = getCase(s, params[0]);
  requireAi();
  return ok(newJob(s, "assess", { caseId: c.id, caseContentVersion: s.caseContentVersion[c.id] ?? 1 }), 202);
}, true);
route("POST", "/api/v1/cases/:id/status", async ({ s, req, params }) => {
  const c = getCase(s, params[0]);
  const b = await body(req);
  only(b, ["status", "event_date", "note", "approved_amount_cents", "expected_version"], ["status", "event_date", "note", "approved_amount_cents", "expected_version"]);
  if (!CASE_STATUSES.includes(b.status as string)) throw invalid("Unknown status.");
  if (!isDateTime(b.event_date)) throw invalid("event_date must be ISO 8601.");
  if (typeof b.note !== "string") throw invalid("note must be a string.");
  if (b.approved_amount_cents !== null && !(Number.isInteger(b.approved_amount_cents) && (b.approved_amount_cents as number) >= 0)) throw invalid("approved_amount_cents must be integer cents or null.");
  expectVersion(c.data_version, b.expected_version);
  c.status = b.status as Case["status"];
  if (b.approved_amount_cents !== null) c.approved_amount_cents = b.approved_amount_cents as number;
  touchCase(s, c);
  s.events.push({
    id: uuid(), case_id: c.id, type: "status_change", event_date: b.event_date as string, note: b.note as string, attachment_document_ids: [],
    new_status: c.status, reply_analysis: null,
  });
  return ok(c);
}, true);
route("GET", "/api/v1/cases/:id/events", ({ s, url, params }) => {
  getCase(s, params[0]);
  const items = s.events.filter((e) => e.case_id === params[0]).sort((a, b) => cmp(a.event_date, b.event_date) || cmp(a.id, b.id));
  return paginate(items, url);
});
route("POST", "/api/v1/cases/:id/events", async ({ s, req, params }) => {
  const c = getCase(s, params[0]);
  const b = await body(req);
  only(b, ["event_date", "note", "attachment_document_ids"], ["event_date", "note", "attachment_document_ids"]);
  if (!isDateTime(b.event_date)) throw invalid("event_date must be ISO 8601.");
  if (typeof b.note !== "string" || !b.note.trim()) throw invalid("note must not be empty.");
  uuidArray(b.attachment_document_ids, "attachment_document_ids");
  const ev: CaseEvent = {
    id: uuid(), case_id: c.id, type: "note", event_date: b.event_date as string, note: b.note as string,
    attachment_document_ids: b.attachment_document_ids as string[], new_status: null, reply_analysis: null,
  };
  s.events.push(ev);
  return ok(ev, 201);
}, true);
route("POST", "/api/v1/cases/:id/replies", async ({ s, req, params }) => {
  const c = getCase(s, params[0]);
  const b = await body(req);
  only(b, ["reply_text", "document_ids"], ["reply_text", "document_ids"]);
  if (typeof b.reply_text !== "string") throw invalid("reply_text must be a string.");
  uuidArray(b.document_ids, "document_ids");
  if (!b.reply_text.trim() && !(b.document_ids as string[]).length) throw invalid("Paste the reply text or choose a document.");
  for (const id of b.document_ids as string[]) getDoc(s, id);
  requireAi();
  return ok(newJob(s, "analyze_reply", { caseId: c.id, replyText: b.reply_text, replyDocs: b.document_ids as string[] }), 202);
}, true);
route("GET", "/api/v1/cases/:id/drafts", ({ s, url, params }) => {
  getCase(s, params[0]);
  const items = s.drafts.filter((d) => d.case_id === params[0]).sort((a, b) => cmp(b.updated_at, a.updated_at) || cmp(a.id, b.id));
  return paginate(items, url);
});
route("POST", "/api/v1/cases/:id/drafts", async ({ s, req, params }) => {
  const c = getCase(s, params[0]);
  const b = await body(req);
  only(b, ["kind"], ["kind"]);
  if (b.kind !== "initial" && b.kind !== "follow_up") throw invalid("kind must be initial or follow_up.");
  requireAi();
  return ok(newJob(s, b.kind === "follow_up" ? "draft_follow_up" : "draft", { caseId: c.id, caseContentVersion: s.caseContentVersion[c.id] ?? 1, draftKind: b.kind }), 202);
}, true);
route("PATCH", "/api/v1/drafts/:id", async ({ s, req, params }) => {
  const d = s.drafts.find((x) => x.id === params[0]);
  if (!d) throw notFound("Draft");
  const b = await body(req);
  only(b, ["subject", "body", "expected_input_version"], ["subject", "body", "expected_input_version"]);
  if (typeof b.subject !== "string" || typeof b.body !== "string") throw invalid("subject and body are required.");
  if (typeof b.expected_input_version !== "number") throw invalid("expected_input_version is required.");
  if (b.expected_input_version !== d.input_version) throw conflict("This draft was regenerated. Reload it before saving your edits.");
  d.content = { ...d.content, subject: b.subject, body: b.body };
  d.user_edited = true;
  d.updated_at = nowIso();
  return ok(d);
});
route("GET", "/api/v1/cases/:id/outcome", ({ s, params }) => {
  getCase(s, params[0]);
  const o = s.outcomes[params[0]];
  if (!o) throw notFound("Outcome");
  return ok(o);
});
route("PUT", "/api/v1/cases/:id/outcome", async ({ s, req, params }) => {
  const c = getCase(s, params[0]);
  const b = await body(req);
  const keys = ["benefit_id", "kind", "cash_amount_cents", "estimated_value_cents", "value_origin", "quantity", "currency", "confirmation_source", "confirmed_at", "evidence_refs", "note"];
  only(b, keys, keys);
  if (!OUTCOME_KINDS.includes(b.kind as string)) throw invalid("Unknown outcome kind.");
  for (const k of ["cash_amount_cents", "estimated_value_cents", "quantity"]) if (b[k] !== null && !(Number.isInteger(b[k]) && (b[k] as number) >= 0)) throw invalid(`${k} must be a non-negative integer or null.`);
  if (b.currency !== "USD") throw invalid("currency must be USD.");
  if (!["document", "user_estimate", "not_known"].includes(b.value_origin as string)) throw invalid("Invalid value_origin.");
  if (!["user_reported", "document_supported"].includes(b.confirmation_source as string)) throw invalid("Invalid confirmation_source.");
  if (!isDateTime(b.confirmed_at)) throw invalid("confirmed_at must be ISO 8601.");
  if (b.benefit_id !== null && !isUuid(b.benefit_id)) throw invalid("benefit_id must be a UUID or null.");
  const prev = s.outcomes[c.id];
  const o: Outcome = { id: prev?.id ?? uuid(), case_id: c.id, ...(b as Omit<Outcome, "id" | "case_id">) };
  // Usage sync without double counting: apply only the delta versus the previous outcome.
  const usageKinds = ["service_used", "voucher_used"];
  const prevQty = prev && usageKinds.includes(prev.kind) && prev.benefit_id === o.benefit_id ? prev.quantity ?? 0 : 0;
  const newQty = usageKinds.includes(o.kind) ? o.quantity ?? 0 : 0;
  if (o.benefit_id && newQty !== prevQty) {
    const bn = s.benefits.find((x) => x.id === o.benefit_id);
    if (bn) {
      let used = (bn.used_units ?? 0) + (newQty - prevQty);
      used = Math.max(0, bn.units_total !== null ? Math.min(bn.units_total, used) : used);
      applyUsage(bn, used);
    }
  }
  s.outcomes[c.id] = o;
  s.events.push({ id: uuid(), case_id: c.id, type: "outcome", event_date: o.confirmed_at, note: o.note || `Outcome: ${o.kind.replace(/_/g, " ")}`, attachment_document_ids: [], new_status: null, reply_analysis: null });
  touchCase(s, c);
  return ok(o);
}, true);

// reminders & notifications
function validateReminderFields(s: Space, b: Record<string, unknown>) {
  if ("date" in b && !isDate(b.date)) throw invalid("date must be YYYY-MM-DD.");
  if ("timezone" in b && !isTz(b.timezone)) throw invalid("timezone must be an IANA time zone.");
  if ("local_time" in b && !isTime(b.local_time)) throw invalid("local_time must be HH:MM.");
  if ("offset_days" in b && (!Array.isArray(b.offset_days) || !b.offset_days.every((x) => OFFSETS.includes(x as ReminderOffset)))) throw invalid("offset_days must contain 30, 14, 7, 1 or 0.");
  if ("channels" in b) {
    if (!Array.isArray(b.channels) || !b.channels.every((x) => x === "in_app" || x === "email")) throw invalid("channels must be in_app or email.");
    if (b.channels.includes("email") && !s.profile.email_configured) throw invalid("Email delivery is not configured on this server.");
  }
  if ("status" in b && !["active", "done", "cancelled", "needs_review"].includes(b.status as string)) throw invalid("Unknown status.");
}
route("GET", "/api/v1/reminders", ({ s, url }) => {
  const from = url.searchParams.get("from_date");
  const to = url.searchParams.get("to_date");
  const bId = url.searchParams.get("benefit_id");
  const cId = url.searchParams.get("case_id");
  const items = s.reminders
    .filter((r) => (!from || r.date >= from) && (!to || r.date <= to) && (!bId || r.benefit_id === bId) && (!cId || r.case_id === cId))
    .sort((a, b) => cmp(a.date, b.date) || cmp(a.local_time, b.local_time) || cmp(a.id, b.id));
  return paginate(items, url);
});
route("POST", "/api/v1/reminders", async ({ s, req }) => {
  const b = await body(req);
  const keys = ["benefit_id", "case_id", "title", "date", "timezone", "local_time", "origin", "offset_days", "channels", "status", "evidence_refs"];
  only(b, keys, keys);
  if (typeof b.title !== "string" || !b.title.trim()) throw invalid("title is required.");
  if (!["document", "user", "claimly_suggestion"].includes(b.origin as string)) throw invalid("Invalid origin.");
  validateReminderFields(s, b);
  if (b.benefit_id) getBenefit(s, b.benefit_id as string);
  if (b.case_id) getCase(s, b.case_id as string);
  const r = { id: uuid(), ...(b as Omit<Reminder, "id">) } as Reminder;
  s.reminders.push(r);
  regenerateNotifications(s, r);
  return ok(r, 201);
}, true);
route("PATCH", "/api/v1/reminders/:id", async ({ s, req, params }) => {
  const r = s.reminders.find((x) => x.id === params[0]);
  if (!r) throw notFound("Reminder");
  const b = await body(req);
  only(b, ["date", "timezone", "local_time", "offset_days", "channels", "status"]);
  validateReminderFields(s, b);
  Object.assign(r, b);
  regenerateNotifications(s, r); // old pending notifications are cancelled
  return ok(r);
});
route("GET", "/api/v1/notifications", ({ s, url }) => {
  const items = s.notifications.filter((n) => n.status !== "cancelled").sort((a, b) => cmp(b.scheduled_at, a.scheduled_at) || cmp(a.id, b.id));
  return paginate(items, url);
});

// jobs
route("GET", "/api/v1/jobs/:id", ({ s, params }) => {
  const j = s.jobs.find((x) => x.id === params[0]);
  if (!j) throw notFound("Job");
  return ok(j);
});

// ───────────────────────── entry point ─────────────────────────

function newSpace(): Space {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") + "mock";
  return {
    id: uuid(), token, expires_at: new Date(opts.now() + 7 * 24 * 3600 * 1000).toISOString(),
    profile: { timezone: "America/New_York", email_notification_opt_in: false, email_configured: false, reminder_offsets: [7, 1, 0], local_notification_time: "09:00", notification_email: null },
    entries: [], documents: [], benefits: [], benefitKeys: {}, benefitCreated: {}, threads: [], messages: [], cases: [], caseContentVersion: {},
    events: [], drafts: [], outcomes: {}, reminders: [], notifications: [], jobs: [], jobMeta: {}, idem: {}, docPages: {},
  };
}

/** Returns null for URLs outside the mocked backend (let them pass through). */
export async function handleMockRequest(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  if (!req.url.startsWith(opts.baseUrl + "/")) return null;
  const path = url.pathname.replace(/\/+$/, "");
  const method = req.method.toUpperCase();
  // Re-read persisted state so several tabs of the same demo space stay consistent (like one backend).
  const d = load(true);

  try {
    if (path === "/health" && method === "GET") return ok({ status: "ok", service: "backend", contract_version: CONTRACT_VERSION });
    if (path === "/api/v1/demo/sessions" && method === "POST") {
      const sp = newSpace();
      d.spaces[sp.token] = sp;
      save();
      return ok({ id: sp.id, session_token: sp.token, expires_at: sp.expires_at }, 201);
    }
    if (!path.startsWith("/api/v1/")) return null;

    const token = req.headers.get("X-Demo-Session");
    if (!token) throw new HttpErr(401, "DEMO_SESSION_REQUIRED", "A demo session is required.");
    const s = d.spaces[token];
    if (!s || s.revoked || Date.parse(s.expires_at) <= opts.now()) throw new HttpErr(401, "DEMO_SESSION_EXPIRED", "The demo session has expired.");

    let matched: { r: Route; params: string[] } | null = null;
    let pathMatched = false;
    for (const r of routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (r.method === method) {
        matched = { r, params: m.slice(1) };
        break;
      }
    }
    if (!matched) throw pathMatched ? new HttpErr(405, "VALIDATION_ERROR", "Method not allowed.") : notFound("Route");

    if (tick(s)) save();

    let idemKey: string | null = null;
    let fp = "";
    if (matched.r.idem) {
      idemKey = req.headers.get("Idempotency-Key");
      if (!idemKey || idemKey.length < 8 || idemKey.length > 128) throw invalid("Idempotency-Key header (8–128 chars) is required.");
      fp = `${method} ${path} ${await fingerprint(req)}`;
      const prev = s.idem[idemKey];
      if (prev) {
        if (prev.fp !== fp) throw conflict("This Idempotency-Key was already used with a different request.");
        return json(prev.status, prev.body);
      }
    }

    const res = await matched.r.h({ s, url, req, params: matched.params });
    if (idemKey && res.status < 500) {
      const text = await res.clone().text();
      s.idem[idemKey] = { fp, status: res.status, body: text ? JSON.parse(text) : null };
    }
    if (method !== "GET" || res.status >= 400) save();
    return res;
  } catch (e) {
    if (e instanceof HttpErr) return errorResponse(e);
    return errorResponse(new HttpErr(500, "INTERNAL_ERROR", (e as Error)?.message ?? "Mock error", true));
  }
}

async function fingerprint(req: Request): Promise<string> {
  const ct = req.headers.get("Content-Type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const f = await req.clone().formData();
    const file = f.get("file");
    return `${f.get("entry_id")}|${file && typeof file !== "string" ? `${(file as File).name}:${(file as File).size}` : ""}`;
  }
  const text = await req.clone().text();
  if (!text) return "";
  try {
    return stable(JSON.parse(text));
  } catch {
    return text;
  }
}
