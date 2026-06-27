import { useEffect, useRef, useState } from "react";

/**
 * Typewriter animation for an input placeholder.
 *
 * Cycles through `examples`, typing one out a character at a time, holding it,
 * then advancing to the next. Pass `paused` (e.g. while the user has typed
 * something, or in a non-empty step) to freeze it and release the timers.
 *
 * Returns the text typed so far and whether it is mid-type, so callers can
 * append a blinking caret.
 */
export function useTypewriterPlaceholder(
  examples: string[],
  {
    charMs = 45,
    holdMs = 3200,
    paused = false,
  }: { charMs?: number; holdMs?: number; paused?: boolean } = {},
): { text: string; isTyping: boolean } {
  const [idx, setIdx] = useState(0);
  const [typed, setTyped] = useState("");
  const charRef = useRef(0);

  useEffect(() => {
    if (paused || examples.length === 0) return;
    const full = examples[idx % examples.length] ?? "";
    charRef.current = 0;
    setTyped("");
    const typer = setInterval(() => {
      charRef.current += 1;
      setTyped(full.slice(0, charRef.current));
      if (charRef.current >= full.length) clearInterval(typer);
    }, charMs);
    const next = setTimeout(() => setIdx((i) => (i + 1) % examples.length), holdMs);
    return () => {
      clearInterval(typer);
      clearTimeout(next);
    };
  }, [idx, paused, charMs, holdMs, examples]);

  const full = examples[idx % examples.length] ?? "";
  return { text: typed, isTyping: typed.length < full.length };
}
