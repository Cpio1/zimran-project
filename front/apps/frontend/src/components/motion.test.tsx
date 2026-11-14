import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
