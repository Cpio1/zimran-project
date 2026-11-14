import type { Benefit, CaseStatus, CaseType, EntryCategory, JobStatus, DocumentStatus, DeadlineRule } from "@/api/types";

export function formatCents(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined) return null;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}
/** "$12.50" → 1250; returns null for empty, NaN for invalid */
export function parseDollarsToCents(input: string): number | null {
  const t = input.replace(/[$,\s]/g, "");
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
  return Math.round(parseFloat(t) * 100);
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
