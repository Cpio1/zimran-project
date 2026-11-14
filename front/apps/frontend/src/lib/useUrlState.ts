"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A filter or search value kept in the URL (Jakob's law): Back from a detail page returns to the
 * same view, a refresh keeps it and the link can be shared.
 *
 * The URL is written with the native, synchronous `history.replaceState`, which the Next.js
 * router mirrors into useSearchParams. It replaces the current entry instead of pushing, so
 * history isn't flooded, and being synchronous it can't race a link clicked right after.
 * `debounceMs` is for free text: the field updates at once, the URL after a short pause
 * (frequency of use: typing stays calm). Discrete choices (tabs, selects) use 0.
 * Callers must sit inside <Suspense> (useSearchParams).
 */
export function useUrlState(key: string, fallback = "", debounceMs = 0): [string, (v: string) => void] {
  const params = useSearchParams();
  const fromUrl = params.get(key) ?? fallback;
  const [value, setValue] = useState(fromUrl);
  const own = useRef(fromUrl);
  const timer = useRef<number | undefined>(undefined);

  // Follow the URL when it changes from outside (Back/Forward, a link with ?filter=…).
  useEffect(() => {
    if (fromUrl !== own.current) {
      own.current = fromUrl;
      setValue(fromUrl);
    }
  }, [fromUrl]);
  // A pending write is dropped on unmount: by then the URL belongs to the next page.
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const set = useCallback(
    (v: string) => {
      setValue(v);
      own.current = v;
      const write = () => {
        const url = new URL(window.location.href);
        if (v && v !== fallback) url.searchParams.set(key, v);
        else url.searchParams.delete(key);
        if (url.href !== window.location.href) window.history.replaceState(null, "", url);
      };
      window.clearTimeout(timer.current);
      if (debounceMs > 0) timer.current = window.setTimeout(write, debounceMs);
      else write();
    },
    [key, fallback, debounceMs],
  );
  return [value, set];
}
