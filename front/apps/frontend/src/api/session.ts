import type { DemoSession } from "./types";

const STORAGE_KEY = "claimly.demo_session";

export type SessionChangeReason = "created" | "expired" | "reset";
type Listener = (reason: SessionChangeReason, session: DemoSession | null) => void;

const listeners = new Set<Listener>();
let memorySession: DemoSession | null = null;
let pending: Promise<DemoSession> | null = null;
let creator: (() => Promise<DemoSession>) | null = null;
let pendingExpiredNotice = false;

function storage(): Storage | null {
  try {
    return typeof globalThis.localStorage !== "undefined" ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

export function onSessionChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(reason: SessionChangeReason, s: DemoSession | null) {
  for (const l of listeners) l(reason, s);
}

/** The client registers how to create a session (POST /api/v1/demo/sessions). */
export function setSessionCreator(fn: () => Promise<DemoSession>) {
  creator = fn;
}

function isExpired(s: DemoSession, now = Date.now()) {
  const t = Date.parse(s.expires_at);
  return Number.isFinite(t) && t <= now;
}

/** Reads the stored session. Expired ones are discarded (and reported). */
export function readSession(): DemoSession | null {
  if (memorySession && !isExpired(memorySession)) return memorySession;
  const st = storage();
  const raw = st?.getItem(STORAGE_KEY);
  if (!raw) return memorySession && !isExpired(memorySession) ? memorySession : null;
  try {
    const s = JSON.parse(raw) as DemoSession;
    if (!s?.session_token || !s.expires_at) throw new Error("bad");
    if (isExpired(s)) {
      st?.removeItem(STORAGE_KEY);
      memorySession = null;
      pendingExpiredNotice = true;
      return null;
    }
    memorySession = s;
    return s;
  } catch {
    st?.removeItem(STORAGE_KEY);
    return null;
  }
}


function save(s: DemoSession) {
  memorySession = s;
  storage()?.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function clearSession(reason: Exclude<SessionChangeReason, "created">) {
  memorySession = null;
  storage()?.removeItem(STORAGE_KEY);
  if (reason === "expired") pendingExpiredNotice = true;
  emit(reason, null);
}

/**
 * Returns a valid session, creating one if needed. All concurrent callers share
 * one in-flight promise so parallel components never create separate spaces.
 */
export function ensureSession(): Promise<DemoSession> {
  const existing = readSession();
  if (existing) return Promise.resolve(existing);
  if (pending) return pending;
  if (!creator) return Promise.reject(new Error("Session creator not registered"));
  const expired = pendingExpiredNotice;
  pending = creator()
    .then((s) => {
      save(s);
      pendingExpiredNotice = false;
      emit(expired ? "expired" : "created", s);
      return s;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

export function currentToken(): string | null {
  return readSession()?.session_token ?? null;
}

/** "Start new demo": drop the local token only; other sessions are untouched. */
export async function startNewDemo(): Promise<DemoSession> {
  clearSession("reset");
  pendingExpiredNotice = false;
  return ensureSession();
}

/** test helper */
export function __resetSessionModule() {
  memorySession = null;
  pending = null;
  pendingExpiredNotice = false;
  listeners.clear();
}
