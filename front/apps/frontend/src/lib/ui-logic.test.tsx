import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { resolveAction } from "@/components/Chat";
import { UsageNumbers } from "@/components/Benefit";
import { ProgressBar } from "@/components/JobStatus";
import { parseDollarsToCents, usageSummary, formatCents } from "./format";
import { pollDelay } from "@/api/jobs";
import { readFixture } from "@/test/contract";
import type { Benefit } from "@/api/types";

const B = "10000000-0000-4000-8000-000000000003";
const C = "10000000-0000-4000-8000-000000000006";
const ctx = { knownBenefitIds: new Set([B]), knownCaseIds: new Set([C]), entryId: null };

describe("model next_actions are whitelisted", () => {
  it("links only known IDs for allowed types", () => {
    expect(resolveAction({ type: "open_benefit", label: "View", target_id: B }, ctx)?.href).toBe(`/benefits/${B}`);
    expect(resolveAction({ type: "open_case", label: "Case", target_id: C }, ctx)?.href).toBe(`/cases/${C}`);
    expect(resolveAction({ type: "open_benefit", label: "View", target_id: "20000000-0000-4000-8000-000000000000" }, ctx)).toBeNull();
    expect(resolveAction({ type: "open_case", label: "x", target_id: null }, ctx)).toBeNull();
  });
  it("drops unknown types and never executes URLs", () => {
    expect(resolveAction({ type: "open_url" as never, label: "Pay", target_id: null }, ctx)).toBeNull();
    expect(resolveAction({ type: "open_benefit", label: "x", target_id: "https://evil.example" }, ctx)).toBeNull();
    expect(resolveAction({ type: "add_document", label: "Add", target_id: "javascript:alert(1)" }, ctx)?.href).toBe("/upload");
    expect(resolveAction({ type: "ask_question", label: "How many?", target_id: null }, ctx)?.href).toBeUndefined();
  });
});

describe("usage display never invents a remainder", () => {
  it("fixture unknown → total 4, used/remaining not confirmed", () => {
    const b = readFixture("benefit_unknown.json").data as Benefit;
    expect(usageSummary(b)).toBe("4 listed · usage not confirmed");
    render(<UsageNumbers b={b} />);
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("Not confirmed")).toBeInTheDocument();
    expect(screen.getByText("Confirm usage")).toBeInTheDocument();
    expect(screen.queryByText("0")).toBeNull();
  });
  it("fixture after one use → 4 / 1 / 3", () => {
    const b = readFixture("benefit_after_one_use.json").data as Benefit;
    expect(usageSummary(b)).toBe("3 of 4 left");
    render(<UsageNumbers b={b} />);
    const dl = screen.getByLabelText("Usage");
    expect(dl.textContent).toBe("Total4Used1Remaining3");
  });
  it("unknown total with confirmed usage → no remainder", () => {
    const b = { ...(readFixture("benefit_unknown.json").data as Benefit), units_total: null, used_units: 2, remaining_units: null, usage_state: "partial" as const };
    expect(usageSummary(b)).toBe("Used 2 · total not stated");
  });
});

describe("misc", () => {
  it("progress=null renders an indeterminate bar (no percentage)", () => {
    render(<ProgressBar value={null} label="Analysis" />);
    const bar = screen.getByRole("progressbar");
    expect(bar).not.toHaveAttribute("aria-valuenow");
  });
  it("money is integer cents", () => {
    expect(parseDollarsToCents("$1,234.5")).toBe(123450);
    expect(parseDollarsToCents("")).toBeNull();
    expect(Number.isNaN(parseDollarsToCents("12.345"))).toBe(true);
    expect(formatCents(12999)).toBe("$129.99");
  });
  it("polling backs off and caps", () => {
    expect(pollDelay(0)).toBe(1000);
    expect(pollDelay(2)).toBeGreaterThan(pollDelay(1));
    expect(pollDelay(50)).toBe(6000);
  });
});
