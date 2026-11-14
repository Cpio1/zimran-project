// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/node";
import { api, listAll, __setFetch } from "./client";
import { ApiError, SessionReplacedError } from "./errors";
import { __resetSessionModule, onSessionChange, readSession, startNewDemo } from "./session";
import { waitForJob } from "./jobs";
import { expireMockSession, setMockFlags } from "@/mocks/core";
import { API_BASE_URL } from "./config";
import { assertSchema, readFixture } from "@/test/contract";
import type { Benefit } from "./types";

const fastPoll = { delay: () => 1 };

function countRequests(match: (r: Request) => boolean) {
  const seen: Request[] = [];
  const fn = ({ request }: { request: Request }) => {
    if (match(request)) seen.push(request);
  };
  server.events.on("request:start", fn);
  return { seen, stop: () => server.events.removeListener("request:start", fn) };
}

async function uploadSample(category: "gift_certificate" | "service_agreement" = "gift_certificate") {
  const entry = await api.createEntry({ title: "Sample dental certificate", category, provider: null, subject: null });
  const file = new File([new Uint8Array([37, 80, 68, 70])], "sample-dental.pdf", { type: "application/pdf" });
  const accepted = await api.uploadDocument(entry.id, file);
  const job = await waitForJob(accepted.job.id, fastPoll);
  return { entry, accepted, job };
}

describe("demo session", () => {
  it("parallel first requests share one POST /demo/sessions and send X-Demo-Session", async () => {
    const c = countRequests((r) => r.url.endsWith("/api/v1/demo/sessions"));
    const data = countRequests((r) => r.url.includes("/api/v1/") && !r.url.endsWith("/demo/sessions"));
    await Promise.all([api.getDashboard(), api.listEntries(), api.getProfile(), api.listCases()]);
    c.stop();
    data.stop();
    expect(c.seen).toHaveLength(1);
    expect(c.seen[0].headers.get("X-Demo-Session")).toBeNull();
    const token = readSession()!.session_token;
    expect(data.seen.every((r) => r.headers.get("X-Demo-Session") === token)).toBe(true);
    expect(JSON.parse(localStorage.getItem("claimly.demo_session")!).session_token).toBe(token);
  });

  it("health and session creation work without a token; responses carry contract version", async () => {
    const res = await fetch(`${API_BASE_URL}/health`);
    expect(res.headers.get("X-Contract-Version")).toBe("2.0.0");
    const body = await res.json();
    assertSchema("HealthEnvelope", body);
    expect(readSession()).toBeNull();
    const s = await api.createDemoSession();
    assertSchema("DemoSession", s);
  });

  it("after refresh reuses the stored token and keeps data", async () => {
    const e = await api.createEntry({ title: "Warranty", category: "warranty", provider: null, subject: null });
    const token = readSession()!.session_token;
    __resetSessionModule(); // simulates page reload (memory gone, localStorage kept)
    const c = countRequests((r) => r.url.endsWith("/demo/sessions"));
    const list = await api.listEntries();
    c.stop();
    expect(c.seen).toHaveLength(0);
    expect(readSession()!.session_token).toBe(token);
    expect(list.data.map((x) => x.id)).toContain(e.id);
  });

  it("expired session on GET: creates a new session once, retries the GET, reports it", async () => {
    await api.createEntry({ title: "Old", category: "other", provider: null, subject: null });
    const old = readSession()!.session_token;
    const reasons: string[] = [];
    onSessionChange((r) => reasons.push(r));
    expireMockSession(old);
    const list = await api.listEntries();
    expect(readSession()!.session_token).not.toBe(old);
    expect(list.data).toHaveLength(0); // new, isolated space
    expect(reasons).toContain("expired");
  });

  it("expired session on a mutation: new session, mutation NOT replayed", async () => {
    await api.getProfile();
    expireMockSession(readSession()!.session_token);
    const posts = countRequests((r) => r.method === "POST" && r.url.endsWith("/api/v1/entries"));
    await expect(api.createEntry({ title: "X", category: "other", provider: null, subject: null })).rejects.toBeInstanceOf(SessionReplacedError);
    posts.stop();
    expect(posts.seen).toHaveLength(1);
    expect((await api.listEntries()).data).toHaveLength(0);
  });

  it("a stored token whose expires_at passed is discarded before use", async () => {
    localStorage.setItem("claimly.demo_session", JSON.stringify({ id: crypto.randomUUID(), session_token: "x".repeat(43), expires_at: "2000-01-01T00:00:00Z" }));
    __resetSessionModule();
    const reasons: string[] = [];
    onSessionChange((r) => reasons.push(r));
    await api.getProfile();
    expect(readSession()!.session_token).not.toBe("x".repeat(43));
    expect(reasons).toEqual(["expired"]);
  });

  it("Start new demo creates a separate space", async () => {
    await api.createEntry({ title: "Mine", category: "other", provider: null, subject: null });
    const before = readSession()!.session_token;
    await startNewDemo();
    expect(readSession()!.session_token).not.toBe(before);
    expect((await api.listEntries()).data).toHaveLength(0);
  });

  it("missing session header → 401 DEMO_SESSION_REQUIRED envelope", async () => {
    const res = await fetch(`${API_BASE_URL}/api/v1/entries`);
    expect(res.status).toBe(401);
    const body = await res.json();
    assertSchema("ErrorEnvelope", body);
    expect(body.error.code).toBe("DEMO_SESSION_REQUIRED");
  });
});

describe("transport details", () => {
  it("multipart upload: no manual Content-Type, FormData body, Idempotency-Key present", async () => {
    const entry = await api.createEntry({ title: "T", category: "gift_certificate", provider: null, subject: null });
    const spy = vi.fn(fetch);
    __setFetch(spy as typeof fetch);
    try {
      await api.uploadDocument(entry.id, new File(["%PDF"], "a.pdf", { type: "application/pdf" }));
    } finally {
      __setFetch((...a) => fetch(...a));
    }
    const [, init] = spy.mock.calls[0];
    const h = init!.headers as Record<string, string>;
    expect(h["Content-Type"]).toBeUndefined();
    expect(init!.body).toBeInstanceOf(FormData);
    expect(h["Idempotency-Key"]).toMatch(/.{8,}/);
  });

  it("retry after a network failure re-sends the same Idempotency-Key and does not duplicate", async () => {
    await api.getProfile();
    const keys: string[] = [];
    let fail = true;
    server.use(
      http.post(`${API_BASE_URL}/api/v1/entries`, ({ request }) => {
        keys.push(request.headers.get("Idempotency-Key")!);
        if (fail) {
          fail = false;
          return HttpResponse.error();
        }
        return undefined; // fall through to the stateful mock
      }),
    );
    const body = { title: "Laptop", category: "warranty" as const, provider: null, subject: null };
    await expect(api.createEntry(body)).rejects.toMatchObject({ code: "NETWORK_ERROR", retryable: true });
    const created = await api.createEntry(body);
    expect(keys[0]).toBe(keys[1]);
    // A new user request after success gets a fresh key.
    const again = await api.createEntry(body);
    expect(keys[2]).not.toBe(keys[1]);
    expect(again.id).not.toBe(created.id);
  });

  it("same key + different payload → 409 CONFLICT; same payload → same result", async () => {
    const s = await api.getProfile().then(() => readSession()!);
    const send = (title: string) =>
      fetch(`${API_BASE_URL}/api/v1/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Demo-Session": s.session_token, "Idempotency-Key": "fixed-key-123" },
        body: JSON.stringify({ title, category: "other" }),
      });
    const a = await (await send("A")).json();
    const b = await (await send("A")).json();
    expect(b.data.id).toBe(a.data.id);
    const c = await send("B");
    expect(c.status).toBe(409);
    expect((await c.json()).error.code).toBe("CONFLICT");
  });

  it("strips a trailing /api/v1 from the configured base URL", async () => {
    const { normalizeBaseUrl } = await import("./config");
    expect(normalizeBaseUrl("http://x:8000/api/v1/")).toBe("http://x:8000");
    expect(normalizeBaseUrl("https://api.example.com")).toBe("https://api.example.com");
  });
});

describe("contract-shaped flows (mock backend)", () => {
  it("upload → job → document/entry/benefit refreshed; benefit matches fixture shape", async () => {
    const { entry, accepted, job } = await uploadSample();
    assertSchema("UploadAccepted", accepted);
    expect(accepted.job.status).toBe("queued");
    expect(accepted.job.progress).toBeNull();
    assertSchema("Job", job);
    expect(job.status).toBe("succeeded");
    expect(job.result).toMatchObject({ type: "extract", review_required: true });
    const doc = await api.getDocument(accepted.document.id);
    assertSchema("Document", doc);
    expect(doc.status).toBe("needs_review");
    const fresh = await api.getEntry(entry.id);
    assertSchema("Entry", fresh);
    expect(fresh.benefit_ids).toHaveLength(1);
    const b = await api.getBenefit(fresh.benefit_ids[0]);
    assertSchema("Benefit", b);
    const fx = readFixture("benefit_unknown.json").data as Benefit;
    const shape = (x: Benefit) => ({ ...x, id: "-", entry_id: "-", evidence_refs: x.evidence_refs.map((r) => r.quote), deadline_rule: { ...x.deadline_rule!, evidence_refs: [] } });
    expect(shape(b)).toEqual(shape(fx));
    const blob = await api.getDocumentContent(doc.id);
    expect(blob.type).toBe("application/pdf");
  });

  it("certificate usage 4 → used 1 → remaining 3; repeat does not deduct twice; stale version → 409", async () => {
    const { entry } = await uploadSample();
    const id = (await api.getEntry(entry.id)).benefit_ids[0];
    const b0 = await api.getBenefit(id);
    expect([b0.units_total, b0.used_units, b0.remaining_units, b0.usage_state]).toEqual([4, null, null, "unknown"]);
    const put = { used_units: 1, confirmed_at: new Date().toISOString(), note: "", expected_version: b0.data_version };
    const b1 = await api.setBenefitUsage(id, put);
    expect([b1.units_total, b1.used_units, b1.remaining_units, b1.usage_state]).toEqual([4, 1, 3, "partial"]);
    const fx = readFixture("benefit_after_one_use.json").data as Benefit;
    expect([b1.usage_state, b1.used_units, b1.remaining_units, b1.data_version]).toEqual([fx.usage_state, fx.used_units, fx.remaining_units, fx.data_version]);
    // Stale expected_version: conflict, nothing changes.
    const err = await api.setBenefitUsage(id, { ...put, used_units: 2 }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).isConflict).toBe(true);
    expect((await api.getBenefit(id)).remaining_units).toBe(3);
  });

  it("unknown total: no invented remainder", async () => {
    const { entry } = await uploadSample("service_agreement");
    const all = await api.listBenefits({ entry_id: entry.id });
    assertSchema("BenefitList", all);
    expect(all.data.length).toBeGreaterThan(0);
    for (const b of all.data) expect(b.remaining_units).toBeNull();
  });

  it("chat: user message persisted immediately, assistant message from job, no duplicates in history", async () => {
    await uploadSample();
    const t = await api.createThread({ scope: "vault", entry_id: null, case_id: null, document_ids: [] });
    assertSchema("Thread", t);
    const acc = await api.sendMessage(t.id, { content: "I need a dental cleaning", purpose: "match_need" }, "n1");
    assertSchema("MessageAccepted", acc);
    expect(acc.message.role).toBe("user");
    const job = await waitForJob(acc.job.id, fastPoll);
    expect(job.result?.type).toBe("match_need");
    const reply = (job.result as { assistant_message: { matched_benefit_ids: string[]; evidence_refs: unknown[] } }).assistant_message;
    expect(reply.matched_benefit_ids.length).toBe(1);
    expect(reply.evidence_refs.length).toBeGreaterThan(0);
    await waitForJob(acc.job.id, fastPoll); // polling again changes nothing
    const msgs = await api.listMessages(t.id);
    assertSchema("ChatMessageList", msgs);
    expect(msgs.data.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("AI not configured → 503 AI_NOT_CONFIGURED (honest state)", async () => {
    setMockFlags({ ai_off: true });
    const t = await api.createThread({ scope: "vault", entry_id: null, case_id: null, document_ids: [] });
    const err = await api.sendMessage(t.id, { content: "hi", purpose: "answer" }, "n2").catch((e) => e);
    expect(err).toMatchObject({ status: 503, code: "AI_NOT_CONFIGURED", retryable: false });
    const fx = readFixture("error_ai_not_configured.json");
    expect(err.code).toBe(fx.error.code);
  });

  it("case: draft → edit (409 on stale input) → submitted → reply analysis → follow-up → outcome without double usage", async () => {
    const { entry } = await uploadSample();
    const benefitId = (await api.getEntry(entry.id)).benefit_ids[0];
    let b = await api.getBenefit(benefitId);
    b = await api.setBenefitUsage(benefitId, { used_units: 1, confirmed_at: new Date().toISOString(), note: "", expected_version: b.data_version });

    const c = await api.createCase({
      title: "Plan certificate use", type: "benefit_use", entry_ids: [entry.id], document_ids: entry.document_ids, benefit_id: benefitId,
      situation: "I would like to book a cleaning.", incident_date: null, desired_result: "Confirm remaining services and arrange use.",
    });
    assertSchema("Case", c);
    const threads = await api.listThreads({ case_id: c.id });
    expect(threads.data[0].id).toBe(c.thread_id);

    const aJob = await waitForJob((await api.assessCase(c.id, c.data_version)).id, fastPoll);
    assertSchema("Job", aJob);
    expect(aJob.result?.type).toBe("assess");

    const dJob = await waitForJob((await api.createDraft(c.id, { kind: "initial" }, c.data_version)).id, fastPoll);
    assertSchema("Job", dJob);
    const draft = (dJob.result as { draft: { id: string; input_version: number } }).draft;
    const edited = await api.editDraft(draft.id, { subject: "Hello", body: "Edited", expected_input_version: draft.input_version });
    assertSchema("Draft", edited);
    expect(edited.user_edited).toBe(true);
    const stale = await api.editDraft(draft.id, { subject: "x", body: "y", expected_input_version: draft.input_version + 5 }).catch((e) => e);
    expect(stale.isConflict).toBe(true);

    let cur = await api.getCase(c.id);
    cur = await api.setCaseStatus(c.id, { status: "submitted", event_date: new Date().toISOString(), note: "Sent by email", approved_amount_cents: null, expected_version: cur.data_version });
    expect(cur.status).toBe("submitted");

    const rJob = await waitForJob((await api.analyzeReply(c.id, { reply_text: "We need more information about your certificate.", document_ids: [] })).id, fastPoll);
    assertSchema("Job", rJob);
    const ev = (rJob.result as { event: { type: string; reply_analysis: unknown } }).event;
    expect(ev.type).toBe("company_reply");
    expect(ev.reply_analysis).not.toBeNull();

    const fJob = await waitForJob((await api.createDraft(c.id, { kind: "follow_up" }, cur.data_version)).id, fastPoll);
    expect(fJob.result?.type).toBe("draft_follow_up");
    const drafts = await api.listDrafts(c.id);
    assertSchema("DraftList", drafts);
    expect(drafts.data).toHaveLength(2);

    const outcome = {
      benefit_id: benefitId, kind: "service_used" as const, cash_amount_cents: null, estimated_value_cents: null, value_origin: "not_known" as const,
      quantity: 1, currency: "USD" as const, confirmation_source: "user_reported" as const, confirmed_at: new Date().toISOString(), evidence_refs: [], note: "",
    };
    const o1 = await api.setOutcome(c.id, outcome);
    assertSchema("Outcome", o1);
    await api.setOutcome(c.id, { ...outcome, note: "same result, edited note" });
    const after = await api.getBenefit(benefitId);
    expect([after.used_units, after.remaining_units]).toEqual([2, 2]); // +1 once, not twice

    const events = await listAll((cursor) => api.listCaseEvents(c.id, { cursor }));
    for (const e of events) assertSchema("CaseEvent", e);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["draft_created", "status_change", "company_reply", "outcome"]));
    const dash = await api.getDashboard();
    assertSchema("Dashboard", dash);
    expect(dash.services_used_units).toBe(2);
  });

  it("stale job when the case changes during assessment", async () => {
    const { configureMock } = await import("@/mocks/core");
    configureMock({ jobDelays: { queued: 0, running: 50 } });
    const c = await api.createCase({ title: "T", type: "warranty", entry_ids: [], document_ids: [], benefit_id: null, situation: "s", incident_date: null, desired_result: null });
    const job = await api.assessCase(c.id, c.data_version);
    await api.patchCase(c.id, { situation: "changed", expected_version: c.data_version });
    await new Promise((r) => setTimeout(r, 60));
    const done = await waitForJob(job.id, fastPoll);
    expect(done.status).toBe("stale");
  });

  it("reminders: date change cancels old notifications; pagination is stable", async () => {
    const r = await api.createReminder({
      benefit_id: null, case_id: null, title: "Use cleaning", date: "2099-01-10", timezone: "America/New_York", local_time: "09:00",
      origin: "user", offset_days: [7, 1], channels: ["in_app"], status: "active", evidence_refs: [],
    });
    assertSchema("Reminder", r);
    const n1 = await api.listNotifications();
    assertSchema("NotificationList", n1);
    expect(n1.data).toHaveLength(2);
    await api.patchReminder(r.id, { date: "2099-02-10" });
    const n2 = await api.listNotifications();
    expect(n2.data).toHaveLength(2);
    expect(n2.data.every((n) => n.scheduled_at.startsWith("2099-02"))).toBe(true);

    const emailErr = await api.patchReminder(r.id, { channels: ["email"] }).catch((e) => e);
    expect(emailErr.code).toBe("VALIDATION_ERROR"); // email not configured

    for (let i = 0; i < 5; i++) await api.createEntry({ title: `E${i}`, category: "other", provider: null, subject: null });
    const p1 = await api.listEntries({ limit: 2 });
    assertSchema("EntryList", p1);
    const all = await listAll((cursor) => api.listEntries({ cursor, limit: 2 }));
    expect(all.map((e) => e.title).sort()).toEqual(["E0", "E1", "E2", "E3", "E4"]);
    expect(new Set(all.map((e) => e.id)).size).toBe(5);
  });

  it("profile: guest defaults match fixture and voluntary email is validated", async () => {
    const p = await api.getProfile();
    expect(p).toEqual(readFixture("guest_profile.json").data);
    const bad = await api.patchProfile({ notification_email: "nope" }).catch((e) => e);
    expect(bad.code).toBe("VALIDATION_ERROR");
    const good = await api.patchProfile({ notification_email: "me@example.com", email_notification_opt_in: true });
    expect(good.email_configured).toBe(false);
  });

  it("deleting a document cancels its job and makes the source unavailable", async () => {
    const { configureMock } = await import("@/mocks/core");
    configureMock({ jobDelays: { queued: 10_000, running: 10_000 } });
    const entry = await api.createEntry({ title: "T", category: "warranty", provider: null, subject: null });
    const acc = await api.uploadDocument(entry.id, new File(["%PDF"], "w.pdf", { type: "application/pdf" }));
    await api.deleteDocument(acc.document.id);
    expect((await api.getJob(acc.job.id)).status).toBe("cancelled");
    const err = await api.getDocumentContent(acc.document.id).catch((e) => e);
    expect(err.isNotFound).toBe(true);
  });

  it("fixtures themselves satisfy the schemas the adapter relies on", () => {
    const manifest = readFixture("manifest.json") as { file: string; schema: string }[];
    for (const m of manifest) {
      if (["ExtractionResponse", "AnswerRequest", "AnswerResponse"].includes(m.schema)) continue; // LLM-internal
      assertSchema(m.schema, readFixture(m.file));
    }
  });
});
