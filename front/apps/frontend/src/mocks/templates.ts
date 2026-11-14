/**
 * Sample extraction templates for MOCK MODE ONLY. They are not an analysis of the uploaded file;
 * the UI labels everything in mock mode as "Sample mode".
 * The gift_certificate template mirrors fixtures/llm_extraction.json.
 */
import type { BenefitCandidateT, ExtractionTemplate } from "./types";

const DENTAL_QUOTE = "This certificate includes four dental cleaning services. Valid through December 31, 2026.";

const dental: ExtractionTemplate = {
  provider: "Sample Dental",
  subject: "Cleaning services",
  pageText: DENTAL_QUOTE,
  facts: {
    valid_through: { value: "2026-12-31", quote: DENTAL_QUOTE, needs_review: true },
    services_included: { value: 4, quote: DENTAL_QUOTE, needs_review: false },
  },
  review_flags: ["Confirm prior usage and the meaning of the printed date."],
  benefits: [
    {
      candidate_key: "dental-cleaning",
      title: "Four dental cleaning services",
      type: "voucher",
      description: "The certificate lists four cleaning services. Prior usage is unknown.",
      conditions: ["Confirm prior usage with the provider."],
      units_total: 4,
      stated_value_cents: null,
      currency: null,
      deadline_rule: {
        kind: "absolute", semantics: "service_use_by", date: "2026-12-31", anchor_field: null,
        duration_value: null, duration_unit: null, last_day_inclusion: "unknown", quote: DENTAL_QUOTE,
      },
      instructions: ["Contact the provider to confirm booking and certificate terms."],
      quote: DENTAL_QUOTE,
      needs_review: true,
    },
  ],
};

const SERVICE_Q1 = "This plan includes two complimentary oil changes within 12 months of the purchase date.";
const SERVICE_Q2 = "One annual vehicle safety inspection is included at no additional charge.";
const service: ExtractionTemplate = {
  provider: "Sample AutoCare",
  subject: "Vehicle service plan",
  pageText: `Sample AutoCare service agreement. Purchase date: March 2, 2026. ${SERVICE_Q1} ${SERVICE_Q2} Book through the service desk.`,
  facts: {
    purchase_date: { value: "2026-03-02", quote: "Purchase date: March 2, 2026.", needs_review: false },
  },
  review_flags: [],
  benefits: [
    {
      candidate_key: "oil-change", title: "Two oil changes", type: "service",
      description: "The plan lists two complimentary oil changes.", conditions: ["Within 12 months of the purchase date."],
      units_total: 2, stated_value_cents: null, currency: null,
      deadline_rule: { kind: "relative", semantics: "service_use_by", date: null, anchor_field: "purchase_date", duration_value: 12, duration_unit: "calendar_months", last_day_inclusion: "unknown", quote: SERVICE_Q1 },
      instructions: ["Book through the service desk."], quote: SERVICE_Q1, needs_review: false,
    },
    {
      candidate_key: "vehicle-inspection", title: "Annual vehicle safety inspection", type: "service",
      description: "One annual safety inspection is included.", conditions: ["One per year."],
      units_total: 1, stated_value_cents: null, currency: null, deadline_rule: null,
      instructions: ["Book through the service desk."], quote: SERVICE_Q2, needs_review: false,
    },
  ],
};

const WARRANTY_Q = "Covers manufacturing defects for 1 year from the date of purchase. Accidental damage is not covered.";
const warranty: ExtractionTemplate = {
  provider: "Sample Electronics",
  subject: "Laptop",
  pageText: `Limited warranty. Purchased on March 2, 2026. ${WARRANTY_Q} Contact support with your receipt to open a claim.`,
  facts: { purchase_date: { value: "2026-03-02", quote: "Purchased on March 2, 2026.", needs_review: false } },
  review_flags: [],
  benefits: [
    {
      candidate_key: "limited-warranty", title: "Manufacturing defect coverage", type: "warranty_coverage",
      description: "Repair or replacement for manufacturing defects.", conditions: ["Accidental damage is not covered.", "Receipt required."],
      units_total: null, stated_value_cents: null, currency: null,
      deadline_rule: { kind: "relative", semantics: "coverage_end", date: null, anchor_field: "purchase_date", duration_value: 12, duration_unit: "calendar_months", last_day_inclusion: "unknown", quote: WARRANTY_Q },
      instructions: ["Contact support with your receipt to open a claim."], quote: WARRANTY_Q, needs_review: true,
    },
  ],
};

const INS_Q = "Personal property is covered up to $15,000 per claim with a $500 deductible. Flood damage is excluded.";
const insurance: ExtractionTemplate = {
  provider: "Sample Mutual",
  subject: "Renters insurance",
  pageText: `Renters policy. Policy period: January 1, 2026 to December 31, 2026. ${INS_Q}`,
  facts: {
    coverage_limit: { value: "$15,000 per claim", quote: INS_Q, needs_review: false },
    deductible: { value: "$500", quote: INS_Q, needs_review: false },
    policy_end: { value: "2026-12-31", quote: "Policy period: January 1, 2026 to December 31, 2026.", needs_review: false },
  },
  review_flags: [],
  benefits: [
    {
      candidate_key: "personal-property", title: "Personal property coverage", type: "insurance_coverage",
      description: "Listed coverage for personal property. Coverage in a policy is not approval of a specific claim.",
      conditions: ["$500 deductible.", "Flood damage is excluded."], units_total: null, stated_value_cents: null, currency: null,
      deadline_rule: { kind: "absolute", semantics: "coverage_end", date: "2026-12-31", anchor_field: null, duration_value: null, duration_unit: null, last_day_inclusion: "inclusive", quote: "Policy period: January 1, 2026 to December 31, 2026." },
      instructions: ["File a claim with the insurer."], quote: INS_Q, needs_review: false,
    },
  ],
};

const RET_Q = "Returns are accepted within 30 days of purchase with this receipt.";
const receipt: ExtractionTemplate = {
  provider: "Sample Store",
  subject: "Purchase",
  pageText: `Receipt. Date: November 10, 2026. Total: $129.99. ${RET_Q}`,
  facts: {
    purchase_date: { value: "2026-11-10", quote: "Date: November 10, 2026.", needs_review: false },
    total_cents: { value: 12999, quote: "Total: $129.99.", needs_review: false },
  },
  review_flags: [],
  benefits: [
    {
      candidate_key: "return-window", title: "30-day return", type: "return_option",
      description: "The receipt lists a 30-day return window.", conditions: ["Receipt required."],
      units_total: null, stated_value_cents: null, currency: null,
      deadline_rule: { kind: "absolute", semantics: "claim_deadline", date: "2026-12-10", anchor_field: "purchase_date", duration_value: 30, duration_unit: "calendar_days", last_day_inclusion: "inclusive", quote: RET_Q },
      instructions: ["Bring the item and receipt to the store."], quote: RET_Q, needs_review: false,
    },
  ],
};

const MEMBER_Q = "Members receive one free tire rotation every 6 months.";
const membership: ExtractionTemplate = {
  provider: "Sample Club",
  subject: "Membership",
  pageText: `Membership terms. ${MEMBER_Q} Show your member card at the tire center.`,
  facts: {},
  review_flags: ["The membership end date was not found."],
  benefits: [
    {
      candidate_key: "tire-rotation", title: "Tire rotation", type: "membership_benefit",
      description: "One free tire rotation every 6 months.", conditions: ["Every 6 months."], units_total: null,
      stated_value_cents: null, currency: null, deadline_rule: null, instructions: ["Show your member card at the tire center."],
      quote: MEMBER_Q, needs_review: false,
    },
  ],
};

const correspondence: ExtractionTemplate = {
  provider: null, subject: null, pageText: "Correspondence. No benefits are described in this document.",
  facts: {}, review_flags: ["No benefits were found in this document."], benefits: [],
};

export function templateFor(category: string): ExtractionTemplate {
  switch (category) {
    case "service_agreement":
    case "service_contract":
      return service;
    case "warranty":
      return warranty;
    case "insurance":
      return insurance;
    case "receipt":
    case "refund_confirmation":
      return receipt;
    case "membership":
    case "subscription":
      return membership;
    case "correspondence":
      return correspondence;
    default:
      return dental;
  }
}

export type { BenefitCandidateT };
