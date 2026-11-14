export type ApiMode = "mock" | "http";

/** NEXT_PUBLIC_* values are inlined at build time. */
export const API_MODE: ApiMode = process.env.NEXT_PUBLIC_API_MODE === "http" ? "http" : "mock";

/** Base URL without trailing slash and without /api/v1. */
export function normalizeBaseUrl(raw: string | undefined): string {
  let u = (raw ?? "http://localhost:8000").trim().replace(/\/+$/, "");
  if (u.endsWith("/api/v1")) u = u.slice(0, -"/api/v1".length);
  return u;
}
export const API_BASE_URL = normalizeBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL);

/** Upload limits shown before upload (product defaults). */
export const UPLOAD_LIMITS = { maxFileBytes: 10 * 1024 * 1024, maxFiles: 5, maxPages: 25 } as const;
