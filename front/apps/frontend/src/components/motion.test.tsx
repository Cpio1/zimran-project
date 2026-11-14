import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { ToastProvider, useToast } from "./Toast";
import { useStageCue } from "./motion";

function Pusher({ messages }: { messages: string[] }) {
  const toast = useToast();
  useEffect(() => {
    for (const m of messages) toast(m);
  }, [messages, toast]);
  return null;
}

describe("toasts are staged one at a time", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the next toast only after the current one has left", () => {
    render(<ToastProvider><Pusher messages={["Draft saved.", "Copied."]} /></ToastProvider>);
    expect(screen.getByText("Draft saved.")).toBeInTheDocument();
    expect(screen.queryByText("Copied.")).toBeNull();
    expect(screen.getByText("+1")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(3500)); // steady pose ends → exit pose
    expect(screen.getByText("Draft saved.").closest(".toast-out")).not.toBeNull();
    act(() => vi.advanceTimersByTime(160)); // exit done → next enters
    expect(screen.queryByText("Draft saved.")).toBeNull();
    expect(screen.getByText("Copied.").closest(".toast-in")).not.toBeNull();
  });

  it("pauses while hovered and skips to the exit when dismissed", () => {
    render(<ToastProvider><Pusher messages={["Saved."]} /></ToastProvider>);
    const toast = screen.getByText("Saved.").parentElement!;
    fireEvent.mouseEnter(toast);
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText("Saved.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    act(() => vi.advanceTimersByTime(160));
    expect(screen.queryByText("Saved.")).toBeNull();
  });

  it("does not stack the same message twice", () => {
    render(<ToastProvider><Pusher messages={["Saved.", "Saved."]} /></ToastProvider>);
    expect(screen.queryByText("+1")).toBeNull();
  });
});

function Cue({ active, id }: { active: boolean; id: string }) {
  const play = useStageCue(active);
  return <span data-testid={id} data-play={play || undefined} />;
}
function Pair() {
  const [on, setOn] = useState(false);
  return (
    <>
      <button onClick={() => setOn(true)}>go</button>
      <Cue id="a" active={on} />
      <Cue id="b" active={on} />
    </>
  );
}

describe("staging cue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("never plays on mount", () => {
    render(<Cue id="a" active />);
    act(() => vi.advanceTimersByTime(10));
    expect(screen.getByTestId("a")).not.toHaveAttribute("data-play");
  });

  it("plays once on a real transition, and only one element at a time", () => {
    act(() => vi.advanceTimersByTime(2000)); // let any earlier cue lock expire
    render(<Pair />);
    fireEvent.click(screen.getByText("go"));
    act(() => vi.advanceTimersByTime(1));
    const playing = ["a", "b"].filter((id) => screen.getByTestId(id).hasAttribute("data-play"));
    expect(playing).toHaveLength(1);
    act(() => vi.advanceTimersByTime(900));
    expect(screen.getByTestId(playing[0])).not.toHaveAttribute("data-play");
  });
});

describe("motion timing stays snappy", () => {
  const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
  const token = (name: string) => {
    const m = css.match(new RegExp(`--${name}:\\s*(\\d+)ms`));
    if (!m) throw new Error(`--${name} missing`);
    return Number(m[1]);
  };

  it("keeps each phase in its range", () => {
    expect(token("dur-press")).toBeGreaterThanOrEqual(80);
    expect(token("dur-release")).toBeLessThanOrEqual(140);
    expect(token("dur-press") + token("dur-release")).toBeLessThanOrEqual(300);
    expect(token("dur-state")).toBeGreaterThanOrEqual(140);
    expect(token("dur-state")).toBeLessThanOrEqual(220);
    expect(token("dur-enter")).toBeGreaterThanOrEqual(180);
    expect(token("dur-enter")).toBeLessThanOrEqual(280);
  });

  it("never lets a whole sequence run past 300 ms", () => {
    for (const m of css.matchAll(/--(dur-[a-z-]+):\s*(\d+)ms/g)) expect(Number(m[2]), m[1]).toBeLessThanOrEqual(300);
    // No hard-coded duration above the limit. Endless waiting indicators (spinner, progress loop)
    // aren't sequences and are exempt.
    for (const [decl] of css.matchAll(/(?:animation|transition)\s*:[^;]*;/g)) {
      if (decl.includes("infinite")) continue;
      for (const m of decl.matchAll(/(\d+(?:\.\d+)?)(m?s)\b/g)) {
        expect(m[2] === "s" ? Number(m[1]) * 1000 : Number(m[1]), decl).toBeLessThanOrEqual(300);
      }
    }
  });
});

describe("lenient input (Postel)", async () => {
  const { parseMoney, parseCount, parseLooseDate } = await import("@/lib/format");
  it("normalises unambiguous amounts and asks about the rest", () => {
    expect(parseMoney(" $1,299.99 ")).toMatchObject({ kind: "ok", value: 129999 });
    expect(parseMoney("1 299.5 USD")).toMatchObject({ kind: "ok", value: 129950 });
    expect(parseMoney("1.234,56")).toMatchObject({ kind: "ok", value: 123456 });
    expect(parseMoney("12,50")).toMatchObject({ kind: "ambiguous" });
    expect(parseMoney("1.299")).toMatchObject({ kind: "ambiguous" });
    expect(parseMoney("12.345")).toMatchObject({ kind: "ambiguous", options: [{ value: 1234500, display: "$12,345.00" }] });
    expect(parseMoney("12,50")).toMatchObject({ options: [{ display: "$12.50" }, { display: "$1,250.00" }] });
    expect(parseMoney("12.3456")).toMatchObject({ kind: "invalid" });
    expect(parseMoney("-5")).toMatchObject({ kind: "invalid" });
    expect(parseMoney("  ")).toEqual({ kind: "empty" });
  });
  it("accepts counts with spaces and separators", () => {
    expect(parseCount(" 2 ")).toMatchObject({ kind: "ok", value: 2 });
    expect(parseCount("1,000")).toMatchObject({ kind: "ok", value: 1000 });
    expect(parseCount("2.0")).toMatchObject({ kind: "ok", value: 2 });
    expect(parseCount("9", 4)).toMatchObject({ kind: "invalid", message: "Enter a whole number from 0 to 4." });
    expect(parseCount("1.5")).toMatchObject({ kind: "invalid" });
  });
  it("reads common date formats and asks when day and month could swap", () => {
    expect(parseLooseDate("2026-1-5")).toMatchObject({ kind: "ok", value: "2026-01-05" });
    expect(parseLooseDate("Dec 31st, 2026")).toMatchObject({ kind: "ok", value: "2026-12-31" });
    expect(parseLooseDate("5 January 2026")).toMatchObject({ kind: "ok", value: "2026-01-05" });
    expect(parseLooseDate("12/31/2026")).toMatchObject({ kind: "ok", value: "2026-12-31" });
    expect(parseLooseDate("31/12/2026")).toMatchObject({ kind: "ok", value: "2026-12-31" });
    expect(parseLooseDate("01/05/2026")).toMatchObject({ kind: "ambiguous" });
    expect(parseLooseDate("2026-02-30")).toMatchObject({ kind: "invalid" });
  });
});
