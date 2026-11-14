/**
 * Idempotency-Key bookkeeping. A key is created when a user operation starts and is kept
 * (in localStorage) until the operation completes, so a retry of the same operation with the
 * same payload re-sends the same key. A new user request after success gets a new key.
 */
const STORAGE_KEY = "claimly.idempotency";

type Store = Record<string, { key: string; at: number }>;

function load(): Store {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Store;
  } catch {
    return {};
  }
}
function persist(s: Store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: keys still live for this page via memory */
  }
}

const memory: Store = {};

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "undefined";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (typeof File !== "undefined" && v instanceof File) return `file:${v.name}:${v.size}:${v.lastModified}`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}

function hash(str: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
}

export function newKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function slot(scope: string, payload: unknown) {
  return `${scope}|${hash(stableStringify(payload))}`;
}

/** Same scope + same payload while unfinished → same key. */
export function acquireKey(scope: string, payload: unknown): string {
  const id = slot(scope, payload);
  const store = { ...load(), ...memory };
  const hit = store[id];
  if (hit && Date.now() - hit.at < 24 * 3600 * 1000) return hit.key;
  const key = newKey();
  memory[id] = { key, at: Date.now() };
  const s = load();
  s[id] = memory[id];
  persist(s);
  return key;
}

/** Call after the operation finished (success or a non-retryable failure). */
export function releaseKey(scope: string, payload: unknown) {
  const id = slot(scope, payload);
  delete memory[id];
  const s = load();
  delete s[id];
  persist(s);
}

export function clearAllKeys() {
  for (const k of Object.keys(memory)) delete memory[k];
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
