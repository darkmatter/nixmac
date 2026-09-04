"use client";

import { NixmacMascotCube } from "@/components/nixmac-mascot/NixmacMascotCube";
import type { CSSProperties } from "react";
import { useState } from "react";
import "./splash.css";

/**
 * Launch splash. Fills the window while the ViewModel hydrates and the launch
 * probes (permissions, Nix, git) run — the stretch that otherwise shows an
 * empty pane for a second or two.
 *
 * The markup and classes match the boot splash in index.html, which covers the
 * stretch before this component exists; both are styled by splash.css. Only two
 * things change at the handover: the static mark becomes the animated cube, and
 * the scanning bar becomes real probe progress.
 *
 * Deliberately the CSS-3D cube and not <NixmacMascot3D>: three.js must stay out
 * of the main bundle (it would add to the very startup cost this screen exists
 * to cover). The cube is pure CSS and honours prefers-reduced-motion.
 */

/** Launch probes, in the order `DarwinWidget` runs them. Drives the progress bar. */
export const SPLASH_STAGES = ["starting", "state", "permissions", "nix", "repository"] as const;

export type SplashStage = (typeof SPLASH_STAGES)[number];

const STAGE_LABEL: Record<SplashStage, string> = {
  starting: "Starting up",
  state: "Loading configuration",
  permissions: "Checking permissions",
  nix: "Checking Nix",
  repository: "Reading repository",
};

/**
 * Boots that finish faster than this never show the splash: a sub-blink flash of
 * mascot reads as a glitch, not as feedback. Kept in sync with the `--splash-delay`
 * default in splash.css, which is what index.html's copy uses.
 */
const APPEAR_DELAY_MS = 400;

/** Matches `.nixmac-splash__mark` once perspective scales the cube up. */
const CUBE_SIZE_PX = 128;

/** The mascot's idle cadence (8s) would hop maybe once per launch — hurry it up. */
const SPLASH_HOP_PERIOD = "2.6s";

interface SplashScreenProps {
  stage: SplashStage;
  /** Delay before fading in. 0 renders immediately (stories, tests). */
  appearDelayMs?: number;
}

export function SplashScreen({ stage, appearDelayMs = APPEAR_DELAY_MS }: SplashScreenProps) {
  // Measured from page load, not from mount: if index.html's copy already faded
  // in, this one must appear at once rather than restart the countdown. The
  // result is deliberately allowed to go negative — a negative `animation-delay`
  // starts the fade at the progress it would already have reached, so a handoff
  // mid-fade continues it and a handoff after it finished lands straight on
  // opacity 1 (clamping to 0 would blank the splash and replay the fade). A
  // delay of 0 (stories, tests) opts out of the measurement entirely, so the
  // rendered value stays deterministic. Frozen on first render — re-resolving
  // `animation-delay` restarts the fade, and this component re-renders on every
  // stage change.
  const [delayMs] = useState(() => (appearDelayMs > 0 ? appearDelayMs - performance.now() : 0));

  const stageIndex = Math.max(SPLASH_STAGES.indexOf(stage), 0);
  const progress = ((stageIndex + 1) / SPLASH_STAGES.length) * 100;

  return (
    <div
      className="nixmac-splash"
      style={{ "--splash-delay": `${delayMs}ms` } as CSSProperties}
      data-testid="splash-screen"
      data-splash-stage={stage}
      aria-busy="true"
    >
      <div className="nixmac-splash__mark">
        <NixmacMascotCube
          size={CUBE_SIZE_PX}
          style={{ "--hop-period": SPLASH_HOP_PERIOD } as CSSProperties}
        />
      </div>

      <div className="nixmac-splash__text">
        <span className="nixmac-splash__name">nixmac</span>

        <div
          className="nixmac-splash__track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          aria-label="Starting nixmac"
        >
          <div className="nixmac-splash__bar" style={{ width: `${progress}%` }} />
        </div>

        {/* Keyed on the stage so each label fades in as its probe starts. */}
        <span key={stage} className="nixmac-splash__stage" role="status">
          {STAGE_LABEL[stage]}…
        </span>
      </div>
    </div>
  );
}
