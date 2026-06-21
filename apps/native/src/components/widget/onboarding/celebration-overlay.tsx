"use client";

import { useEffect, useState } from "react";
import Lottie from "lottie-react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CelebrationOverlayProps {
  host: string;
  onDismiss: () => void;
}

/**
 * Full-window congratulations moment shown once the first build succeeds.
 * Loads the bundled Lottie animations from /public at runtime so they stay
 * out of the main JS bundle.
 */
export function CelebrationOverlay({ host, onDismiss }: CelebrationOverlayProps) {
  const [trophy, setTrophy] = useState<unknown>(null);
  const [confetti, setConfetti] = useState<unknown>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    setReducedMotion(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/lottie/celebrate.json").then((r) => r.json()),
      fetch("/lottie/confetti.json").then((r) => r.json()),
    ])
      .then(([t, c]) => {
        if (!active) return;
        setTrophy(t);
        setConfetti(c);
      })
      .catch(() => {
        /* Animation is decorative — fall back to the static layout silently. */
      });
    return () => {
      active = false;
    };
  }, []);

  // Allow Escape to dismiss.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Setup complete"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-background/95 backdrop-blur-sm"
    >
      {/* Confetti layer */}
      {confetti && !reducedMotion ? (
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <Lottie animationData={confetti} loop className="h-full w-full object-cover" />
        </div>
      ) : null}

      <div className="relative flex flex-col items-center px-6 text-center">
        {trophy ? (
          <div className="size-44 sm:size-52" aria-hidden="true">
            <Lottie animationData={trophy} loop={!reducedMotion} />
          </div>
        ) : null}

        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 font-semibold text-brand text-xs">
          Setup complete
        </span>

        <h1 className="mt-4 text-balance font-semibold text-3xl sm:text-4xl">Welcome to nixmac</h1>
        <p className="mt-3 max-w-md text-pretty text-muted-foreground leading-relaxed">
          <span className="font-mono text-foreground">{host}</span> is now fully managed. Every
          change from here runs through a safe build — describe what you want and nixmac writes the
          Nix for you.
        </p>

        <Button size="lg" className="mt-8" onClick={onDismiss}>
          Open nixmac
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
