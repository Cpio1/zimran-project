"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, type LucideIcon } from "lucide-react";

/**
 * Squash & stretch press feedback.
 *
 * Any element marked with `data-squish` gets a `data-pressed` attribute while it is held
 * (pointer, touch or Enter/Space). Styles in globals.css decide what moves:
 *   - `.squish-surface` — the background layer of Button/ButtonLink flattens, the label stays put;
 *   - `.squish-icon`    — the direct <svg> child of an icon control squashes, the hit area does not.
 *
 * One delegated listener serves the whole app, so no per-button state or re-renders.
 * A short minimum hold keeps very fast taps visible, and a press that arrives while the
 * previous one is still releasing simply continues from the current transform (CSS
 * transitions retarget from the in-flight value), so rapid repeated taps never jump.
 */
const SELECTOR = "[data-squish]";
const MIN_PRESS_MS = 90;
/** Longest anticipation keyframe (globals.css) plus slack; the play flag is cleared after it. */
const ANTICIPATE_MS = 340;

/**
 * Anticipation: icons marked `data-anticipate="left|right|up"` inside a pressable control play a
 * one-shot "step back, then go" nudge (~75 ms wind-up, ~215 ms main move). It only decorates the
 * action — the click handler, request or navigation runs at once and is never delayed.
 * A nudge that is still playing is not restarted, so rapid taps don't make the arrow jitter.
 */
function anticipate(el: HTMLElement) {
  const targets = el.matches("[data-anticipate]") ? [el] : Array.from(el.querySelectorAll<HTMLElement>("[data-anticipate]"));
  for (const t of targets) {
    if (t.hasAttribute("data-anticipate-play")) continue;
    t.setAttribute("data-anticipate-play", "");
    window.setTimeout(() => t.removeAttribute("data-anticipate-play"), ANTICIPATE_MS);
  }
}

export function PressFeedback() {
  useEffect(() => {
    const state = new WeakMap<HTMLElement, { at: number; timer?: number }>();
    let pointerTarget: HTMLElement | null = null;
    let keyTarget: HTMLElement | null = null;
    // Touch presses may turn into a scroll, so their nudge waits for a confirmed tap (pointerup).
    let touchTarget: HTMLElement | null = null;

    const pressable = (t: EventTarget | null) => {
      const el = t instanceof Element ? t.closest<HTMLElement>(SELECTOR) : null;
      if (!el || el.matches(":disabled, [aria-disabled='true']")) return null;
      return el;
    };
    const press = (el: HTMLElement) => {
      const s = state.get(el);
      if (s?.timer) window.clearTimeout(s.timer);
      state.set(el, { at: performance.now() });
      el.setAttribute("data-pressed", "");
    };
    const release = (el: HTMLElement | null) => {
      if (!el) return;
      const s = state.get(el);
      const wait = s ? MIN_PRESS_MS - (performance.now() - s.at) : 0;
      if (wait <= 0) {
        el.removeAttribute("data-pressed");
        state.delete(el);
        return;
      }
      const timer = window.setTimeout(() => {
        el.removeAttribute("data-pressed");
        state.delete(el);
      }, wait);
      state.set(el, { at: s!.at, timer });
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const el = pressable(e.target);
      if (!el) return;
      release(pointerTarget);
      pointerTarget = el;
      press(el);
      if (e.pointerType === "touch") touchTarget = el;
      else anticipate(el);
    };
    const onPointerEnd = () => {
      release(pointerTarget);
      pointerTarget = null;
      touchTarget = null;
    };
    const onPointerUp = (e: PointerEvent) => {
      if (touchTarget && e.pointerType === "touch") anticipate(touchTarget);
      onPointerEnd();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || (e.key !== "Enter" && e.key !== " ")) return;
      const el = pressable(e.target);
      if (!el || el !== e.target) return; // only the focused control itself, not its container
      release(keyTarget);
      keyTarget = el;
      press(el);
      anticipate(el);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      release(keyTarget);
      keyTarget = null;
    };
    const releaseAll = () => {
      onPointerEnd();
      release(keyTarget);
      keyTarget = null;
    };

    const opts = { capture: true, passive: true } as const;
    window.addEventListener("pointerdown", onPointerDown, opts);
    window.addEventListener("pointerup", onPointerUp, opts);
    window.addEventListener("pointercancel", onPointerEnd, opts);
    window.addEventListener("dragstart", onPointerEnd, opts);
    window.addEventListener("keydown", onKeyDown, opts);
    window.addEventListener("keyup", onKeyUp, opts);
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, opts);
      window.removeEventListener("pointerup", onPointerUp, opts);
      window.removeEventListener("pointercancel", onPointerEnd, opts);
      window.removeEventListener("dragstart", onPointerEnd, opts);
      window.removeEventListener("keydown", onKeyDown, opts);
      window.removeEventListener("keyup", onKeyUp, opts);
      window.removeEventListener("blur", releaseAll);
    };
  }, []);
  return null;
}

/**
 * Success check: smaller → slightly past full size → settle (.squish-pop). Render it only once
 * the operation is confirmed; the sequence plays when the icon mounts, so a new success (a new
 * mount) restarts it. `afterMs` holds the first pose until a surrounding entrance has finished,
 * keeping one movement at a time.
 */
export function SuccessIcon({ icon: Icon = CheckCircle2, className, afterMs }: { icon?: LucideIcon; className?: string; afterMs?: number }) {
  return <Icon className={clsx("squish-pop shrink-0", className)} style={afterMs ? { animationDelay: `${afterMs}ms` } : undefined} aria-hidden />;
}

/**
 * Staging cue: one short attention pose for the element that just became the next action.
 *
 * Returns true while the cue plays; callers put it on `data-stage-cue` (see globals.css).
 *   - It fires only on a real state transition false → true, never on mount, so revisiting a
 *     page doesn't make things jump.
 *   - One cue at a time app-wide: if another cue is already playing, this one is skipped, so a
 *     context never has two elements competing for attention.
 *   - `delayMs` lets a cue wait for an earlier pose to finish (e.g. a success check popping in).
 */
const CUE_MS = 900;
let cueBusyUntil = 0;
export function useStageCue(active: boolean, delayMs = 0) {
  const [play, setPlay] = useState(false);
  const prev = useRef(active);
  useEffect(() => {
    const was = prev.current;
    prev.current = active;
    if (!active) {
      setPlay(false);
      return;
    }
    if (was) return;
    const t = window.setTimeout(() => {
      const now = performance.now();
      if (now < cueBusyUntil) return;
      cueBusyUntil = now + CUE_MS;
      setPlay(true);
    }, delayMs);
    return () => window.clearTimeout(t);
  }, [active, delayMs]);
  useEffect(() => {
    if (!play) return;
    const t = window.setTimeout(() => setPlay(false), CUE_MS);
    return () => window.clearTimeout(t);
  }, [play]);
  return play;
}
