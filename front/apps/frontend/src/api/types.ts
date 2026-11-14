/**
 * Thin aliases over types generated from contracts/backend.openapi.json (v2.0.0).
 * Regenerate with `npm run gen:api`. Never rename fields here.
 */
import type { components, paths } from "./schema.gen";

type S = components["schemas"];
export type { paths };

export const CONTRACT_VERSION = "2.0.0" as const;

export type EvidenceRef = S["EvidenceRef"];
export type Fact = S["Fact"];
export type DeadlineRule = S["DeadlineRule"];
export type Entry = S["Entry"];
export type EntryCategory = Entry["category"];
export type Document = S["Document"];
export type DocumentStatus = Document["status"];
export type Benefit = S["Benefit"];
export type BenefitType = Benefit["type"];
export type UsageState = Benefit["usage_state"];
export type NextAction = S["NextAction"];
export type Assessment = S["Assessment"];
export type DraftContent = S["DraftContent"];
export type Draft = S["Draft"];
export type Case = S["Case"];
export type CaseType = Case["type"];
export type CaseStatus = Case["status"];
export type Thread = S["Thread"];
export type ChatMessage = S["ChatMessage"];
export type ReplyAnalysis = S["ReplyAnalysis"];
export type CaseEvent = S["CaseEvent"];
export type Outcome = S["Outcome"];
export type Reminder = S["Reminder"];
export type ReminderOffset = Reminder["offset_days"][number];
export type Notification = S["Notification"];
export type Profile = S["Profile"];
export type Dashboard = S["Dashboard"];
export type Job = S["Job"];
export type JobStatus = Job["status"];
export type JobKind = Job["kind"];
export type ExtractJobResult = S["ExtractJobResult"];
export type AnswerJobResult = S["AnswerJobResult"];
export type AssessmentJobResult = S["AssessmentJobResult"];
export type DraftJobResult = S["DraftJobResult"];
export type ReplyJobResult = S["ReplyJobResult"];
export type ApiErrorBody = S["ApiError"];
export type ErrorCode = ApiErrorBody["code"];
export type Health = S["Health"];
export type DemoSession = S["DemoSession"];
export type UploadAccepted = S["UploadAccepted"];
export type MessageAccepted = S["MessageAccepted"];

export type EntryCreate = S["EntryCreate"];
export type EntryPatch = S["EntryPatch"];
export type BenefitPatch = S["BenefitPatch"];
export type UsagePut = S["UsagePut"];
export type ThreadCreate = S["ThreadCreate"];
export type MessageCreate = S["MessageCreate"];
export type CaseCreate = S["CaseCreate"];
export type CasePatch = S["CasePatch"];
export type StatusChange = S["StatusChange"];
export type EventCreate = S["EventCreate"];
export type ReplyCreate = S["ReplyCreate"];
export type DraftCreate = S["DraftCreate"];
export type DraftPatch = S["DraftPatch"];
export type OutcomePut = S["OutcomePut"];
export type ReminderCreate = S["ReminderCreate"];
export type ReminderPatch = S["ReminderPatch"];
export type ProfilePatch = S["ProfilePatch"];
export type AnalyzeRequest = S["AnalyzeRequest"];

export interface Envelope<T> {
  data: T;
  request_id: string;
}
export interface ListEnvelope<T> {
  data: T[];
  next_cursor: string | null;
  request_id: string;
}
export interface ErrorEnvelope {
  error: ApiErrorBody;
  request_id: string;
}

export const ENTRY_CATEGORIES: EntryCategory[] = [
  "receipt", "warranty", "insurance", "service_agreement", "service_contract",
  "gift_certificate", "subscription", "membership", "refund_confirmation", "correspondence", "other",
];
export const CASE_TYPES: CaseType[] = [
  "benefit_use", "warranty", "insurance_question", "product_return", "refund_delay", "follow_up",
];
export const CASE_STATUSES: CaseStatus[] = [
  "draft", "prepared", "submitted", "awaiting_response", "approved", "denied", "resolved",
];
export const REMINDER_OFFSETS: ReminderOffset[] = [30, 14, 7, 1, 0];
export const TERMINAL_JOB_STATUSES: JobStatus[] = ["succeeded", "failed", "cancelled", "stale"];
export const NEXT_ACTION_TYPES: NextAction["type"][] = ["open_benefit", "open_case", "add_document", "ask_question"];
export const ACCEPTED_MIME = ["application/pdf", "image/jpeg", "image/png"] as const;
