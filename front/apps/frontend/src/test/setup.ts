import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { server } from "@/mocks/node";
import { configureMock, resetMockDb, setMockFlags } from "@/mocks/core";
import { __resetSessionModule } from "@/api/session";

// Node >= 25 exposes its own (file-less, unusable) global localStorage that shadows jsdom's.
class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
}
for (const name of ["localStorage", "sessionStorage"] as const) {
  Object.defineProperty(globalThis, name, { value: new MemoryStorage(), configurable: true, writable: true });
  if (typeof window !== "undefined") Object.defineProperty(window, name, { value: (globalThis as Record<string, unknown>)[name], configurable: true });
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  localStorage.clear();
  configureMock({ jobDelays: { queued: 0, running: 0 }, now: () => Date.now(), persist: true });
  resetMockDb();
  setMockFlags({});
  __resetSessionModule();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
