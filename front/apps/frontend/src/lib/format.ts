import type { Benefit, CaseStatus, CaseType, EntryCategory, JobStatus, DocumentStatus, DeadlineRule } from "@/api/types";

export function formatCents(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined) return null;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}
/** "$12.50" → 1250; returns null for empty, NaN for invalid */
/**
 * Lenient input (Postel's law): accept reasonable formatting, normalise what is unambiguous,
 * and ask about what isn't. Every parser returns one of:
 *   ok        → the normalised value (plus `display` to show what will be saved);
 *   empty     → nothing typed;
 *   invalid   → a short explanation to show next to the field (the typed text is kept);
 *   ambiguous → two or more readings to offer as choices.
 */
export type Parsed<T> =
  | { kind: "ok"; value: T; display: string }
  | { kind: "empty" }
  | { kind: "invalid"; message: string }
  | { kind: "ambiguous"; message: string; options: { value: T; display: string }[] };

const usd = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

/** "$1,299.99", " 1 299.99 USD", "1299", "12.5", "12,50" (asks), "1.299" (asks). */
export function parseMoney(input: string): Parsed<number> {
  let t = input.trim().replace(/^usd\s*/i, "").replace(/\s*(usd|dollars?)$/i, "").replace(/^\$\s*/, "").replace(/\s*\$$/, "");
  t = t.replace(/[\s\u00a0\u202f']/g, ""); // spaces, no-break spaces, Swiss apostrophes
  if (!t) return { kind: "empty" };
  if (t.startsWith("-")) return { kind: "invalid", message: "Enter an amount of 0 or more." };
  const ok = (v: number): Parsed<number> => ({ kind: "ok", value: Math.round(v * 100), display: usd(Math.round(v * 100)) });
  // 1,234,567.89 · 1234.5 · .5 · 12.
  if (/^(\d{1,3}(,\d{3})+|\d*)(\.\d{0,2})?$/.test(t) && /\d/.test(t)) return ok(parseFloat(t.replace(/,/g, "") || "0"));
  // 1.234.567,89 (dot thousands, comma cents) — unambiguous because both separators appear.
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(t)) return ok(parseFloat(t.replace(/\./g, "").replace(",", ".")));
  // 12,50 — a comma followed by 1–2 digits reads as cents elsewhere: ask.
  if (/^\d+,\d{1,2}$/.test(t)) {
    const asCents = Math.round(parseFloat(t.replace(",", ".")) * 100);
    const asWhole = Math.round(parseFloat(t.replace(",", "")) * 100);
    return { kind: "ambiguous", message: "Which amount do you mean?", options: [asCents, asWhole].map((v) => ({ value: v, display: usd(v) })) };
  }
  // 1.299 — three digits after a dot reads as a thousands separator in many places; cents take
  // two digits, so the only sensible reading is offered as a one-tap fix (never a silent rounding).
  if (/^\d{1,3}\.\d{3}$/.test(t)) {
    const whole = Math.round(parseFloat(t.replace(".", "")) * 100);
    return { kind: "ambiguous", message: "Cents take two digits. Did you mean", options: [{ value: whole, display: usd(whole) }] };
  }
  if (/\.\d{3,}$/.test(t)) return { kind: "invalid", message: "Use at most two digits for cents, e.g. 129.99." };
  return { kind: "invalid", message: "Enter an amount like 129.99." };
}

/** Kept for existing callers: null = empty, NaN = not a single clear amount. */
export function parseDollarsToCents(input: string): number | null {
  const r = parseMoney(input);
  return r.kind === "ok" ? r.value : r.kind === "empty" ? null : NaN;
}

/** Whole counts: " 2 ", "1,000", "1 000", "2.0". */
export function parseCount(input: string, max?: number | null): Parsed<number> {
  const t = input.trim().replace(/[\s\u00a0\u202f]/g, "");
  if (!t) return { kind: "empty" };
  const n = /^\d{1,3}(,\d{3})+$/.test(t) ? Number(t.replace(/,/g, "")) : /^\d+(\.0+)?$/.test(t) ? Number(t) : NaN;
  if (!Number.isInteger(n) || n < 0) return { kind: "invalid", message: max != null ? `Enter a whole number from 0 to ${max}.` : "Enter a whole number, 0 or more." };
  if (max != null && n > max) return { kind: "invalid", message: `Enter a whole number from 0 to ${max}.` };
  return { kind: "ok", value: n, display: String(n) };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const isoOf = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
};
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

/** Dates: "2026-1-5", "2026/01/05", "Jan 5, 2026", "5 January 2026", "12/31/2026"; "01/05/2026" asks. */
export function parseLooseDate(input: string): Parsed<string> {
  const t = input.trim().replace(/\s+/g, " ").replace(/(\d)(st|nd|rd|th)\b/gi, "$1");
  if (!t) return { kind: "empty" };
  const ok = (iso: string | null): Parsed<string> => (iso ? { kind: "ok", value: iso, display: formatDate(iso)! } : { kind: "invalid", message: "That date doesn't exist." });
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return ok(isoOf(+m[1], +m[2], +m[3]));
  m = t.match(/^([a-z]{3,})\.? (\d{1,2}),? (\d{4})$/i) ?? null;
  if (m && MONTHS.includes(m[1].slice(0, 3).toLowerCase())) return ok(isoOf(+m[3], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2]));
  m = t.match(/^(\d{1,2}) ([a-z]{3,})\.?,? (\d{4})$/i);
  if (m && MONTHS.includes(m[2].slice(0, 3).toLowerCase())) return ok(isoOf(+m[3], MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, +m[1]));
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    const a = +m[1], b = +m[2], y = fullYear(+m[3]);
    const us = isoOf(y, a, b), eu = isoOf(y, b, a);
    if (us && eu && us !== eu) {
      return { kind: "ambiguous", message: "Which date do you mean?", options: [us, eu].map((v) => ({ value: v, display: formatDate(v)! })) };
    }
    return ok(us ?? eu);
  }
  return { kind: "invalid", message: "Enter a date like 2026-12-31 or Dec 31, 2026." };
}

export function formatDate(d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) {
  if (!d) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T12:00:00Z") : new Date(d);
  if (Number.isNaN(date.getTime())) return d;
  return date.toLocaleDateString("en-US", { ...opts, timeZone: /^\d{4}-\d{2}-\d{2}$/.test(d) ? "UTC" : undefined });
}
export function formatDateTime(d: string | null | undefined) {
  if (!d) return null;
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? d : date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
export function todayISO(tz?: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
export function addDaysISO(date: string, n: number) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysUntil(date: string, from = todayISO()) {
  return Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);
}

export const CATEGORY_LABEL: Record<EntryCategory, string> = {
  receipt: "Receipt", warranty: "Warranty", insurance: "Insurance", service_agreement: "Service agreement",
  service_contract: "Service contract", gift_certificate: "Gift certificate", subscription: "Subscription",
  membership: "Membership", refund_confirmation: "Refund confirmation", correspondence: "Correspondence", other: "Other",
};
export const BENEFIT_TYPE_LABEL: Record<Benefit["type"], string> = {
  service: "Service", warranty_coverage: "Warranty coverage", insurance_coverage: "Insurance coverage",
  voucher: "Certificate", membership_benefit: "Membership", return_option: "Return option", other: "Other",
};
export const CASE_TYPE_LABEL: Record<CaseType, string> = {
  benefit_use: "Use a benefit", warranty: "Warranty claim", insurance_question: "Insurance question",
  product_return: "Product return", refund_delay: "Delayed refund", follow_up: "Follow-up",
};
export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  draft: "Draft", prepared: "Prepared", submitted: "Sent", awaiting_response: "Awaiting reply",
  approved: "Approved", denied: "Denied", resolved: "Resolved",
};
export const CASE_NEXT_STEP: Record<CaseStatus, string> = {
  draft: "Check the assessment and prepare a request",
  prepared: "Review the draft, send it yourself, then mark it sent",
  submitted: "Wait for the company's reply",
  awaiting_response: "Add the company's reply when it arrives",
  approved: "Record what you actually received",
  denied: "Review the reply and consider a follow-up",
  resolved: "Done",
};
export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Waiting to start", running: "Processing", succeeded: "Done", failed: "Failed",
  cancelled: "Cancelled", stale: "Out of date",
};
export const DOC_STATUS_LABEL: Record<DocumentStatus, string> = {
  uploaded: "Uploaded", processing: "Analyzing", needs_review: "Needs review", ready: "Ready", failed: "Failed",
};
const SEMANTICS: Record<DeadlineRule["semantics"], string> = {
  coverage_end: "Coverage ends", document_expiry: "Document expires", claim_deadline: "Claim deadline",
  refund_expected_by: "Refund expected by", follow_up: "Follow up by", service_use_by: "Use by",
};
export const semanticsLabel = (s: DeadlineRule["semantics"]) => SEMANTICS[s];

export function describeRule(r: DeadlineRule | null): string | null {
  if (!r || r.kind === "unknown") return null;
  if (r.kind === "absolute") return r.date ? `${semanticsLabel(r.semantics)} ${formatDate(r.date)} (printed date)` : null;
  const unit = r.duration_unit?.replace("calendar_", "").replace("business_days", "business days") ?? "";
  return r.duration_value ? `${semanticsLabel(r.semantics)}: ${r.duration_value} ${unit} after ${r.anchor_field?.replace(/_/g, " ") ?? "start"}` : null;
}

/** Usage line that never invents a remainder. */
export function usageSummary(b: Pick<Benefit, "units_total" | "used_units" | "remaining_units" | "usage_state">): string {
  if (b.usage_state === "unknown") return b.units_total !== null ? `${b.units_total} listed · usage not confirmed` : "Usage not confirmed";
  if (b.units_total !== null && b.remaining_units !== null) return `${b.remaining_units} of ${b.units_total} left`;
  if (b.used_units !== null) return b.used_units === 0 ? "Not used yet" : `Used ${b.used_units} · total not stated`;
  return "Usage not confirmed";
}
export const USAGE_LABEL: Record<Benefit["usage_state"], string> = {
  unknown: "Usage unknown", unused: "Not used", partial: "Partly used", used: "Used",
};
