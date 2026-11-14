import type { Benefit, DeadlineRule } from "@/api/types";

export interface TemplateFact {
  value: string | number | boolean | null;
  quote: string;
  needs_review: boolean;
}
export interface BenefitCandidateT
  extends Omit<Benefit, "id" | "entry_id" | "usage_state" | "used_units" | "remaining_units" | "deadline_date" | "deadline_status" | "data_version" | "evidence_refs" | "deadline_rule"> {
  candidate_key: string;
  quote: string;
  deadline_rule: (Omit<DeadlineRule, "evidence_refs"> & { quote: string }) | null;
}
export interface ExtractionTemplate {
  provider: string | null;
  subject: string | null;
  pageText: string;
  facts: Record<string, TemplateFact>;
  review_flags: string[];
  benefits: BenefitCandidateT[];
}
