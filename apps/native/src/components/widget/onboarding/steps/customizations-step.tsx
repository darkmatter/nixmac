"use client";

import { ButtonGlow } from "@/components/button-glow";
import { Button } from "@/components/ui/button";
import { DottedGlowBackground } from "@/components/ui/dotted-glow-background";
import {
  buildCustomizationGroups,
  MOCK_CUSTOMIZATION_GROUPS,
  totalCustomizations,
  type CustomizationGroup,
  type CustomizationItem,
  type CustomizationSource,
} from "@/components/widget/onboarding/lib/customizations";
import { stepEyebrow } from "@/components/widget/onboarding/lib/onboarding";
import { StepShell } from "@/components/widget/onboarding/step-shell";
import { tauriAPI } from "@/ipc/api";
import { getTelemetry } from "@/lib/telemetry/instance";
import { cn } from "@/lib/utils";
import { Checkbox } from "@nixmac/ui/components/ui/checkbox.js";
import {
  ArrowRight,
  Braces,
  Check,
  ChevronDown,
  Loader2,
  Plus,
  Radar,
  SkipForward,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

type ScanState = "idle" | "scanning" | "done";

/** What the scanner inspects, surfaced as live progress lines. */
const SCAN_TARGETS = [
  { label: "macOS preferences", command: "defaults read" },
  { label: "Homebrew casks", command: "brew list --cask" },
  { label: "Homebrew taps", command: "brew tap" },
  { label: "Launch agents", command: "launchctl list" },
];

interface CustomizationsStepProps {
  tracked: string[];
  trackedSources: Record<string, CustomizationSource>;
  onSetTracked: (ids: string[], sources: Record<string, CustomizationSource>) => void;
  onContinue: () => void;
}

/** Run the real read-only scanners and assemble customization groups. */
async function runScan(): Promise<CustomizationGroup[]> {
  const [defaults, homebrew, launchd] = await Promise.all([
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    tauriAPI.scanner.scanDefaults().catch(() => ({ defaults: [], totalScanned: 0 })),
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    tauriAPI.homebrew.getStateDiff().catch(() => ({
      isInstalled: false,
      casks: [],
      brews: [],
      taps: [],
      source: null,
      lastChecked: 0,
    })),
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    tauriAPI.launchd.scanLaunchdItems().catch(() => []),
  ]);
  return buildCustomizationGroups({ defaults, homebrew, launchd });
}

export function CustomizationsStep({
  tracked,
  trackedSources,
  onSetTracked,
  onContinue,
}: CustomizationsStepProps) {
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [groups, setGroups] = useState<CustomizationGroup[] | null>(null);
  const [animationDone, setAnimationDone] = useState(false);
  const trackedSet = new Set(tracked);

  function sourceMapForItems(items: CustomizationItem[]): Record<string, CustomizationSource> {
    return Object.fromEntries(items.map((item) => [item.id, item.source]));
  }

  function track(items: CustomizationItem[]) {
    const ids = items.map((item) => item.id);
    const nextSources = { ...trackedSources, ...sourceMapForItems(items) };
    const nextTracked = [...new Set([...tracked, ...ids])];
    onSetTracked(nextTracked, nextSources);
  }

  function untrack(ids: string[]) {
    const remove = new Set(ids);
    const nextTracked = tracked.filter((id) => !remove.has(id));
    const nextSources = Object.fromEntries(
      Object.entries(trackedSources).filter(([id]) => !remove.has(id)),
    );
    onSetTracked(nextTracked, nextSources);
  }

  const trackedCount = tracked.length;

  // Kick off the real scan when entering the scanning state.
  useEffect(() => {
    if (scanState !== "scanning") return;
    let active = true;
    runScan()
      .then((result) => {
        if (active) setGroups(result);
      })
      .catch(() => {
        if (active) setGroups([]);
      });
    return () => {
      active = false;
    };
  }, [scanState]);

  // Show results once both the animation and the real scan have finished.
  useEffect(() => {
    if (scanState === "scanning" && animationDone && groups !== null) {
      setScanState("done");
    }
  }, [scanState, animationDone, groups]);

  function startScan() {
    setGroups(null);
    setAnimationDone(false);
    onSetTracked([], {});
    getTelemetry().captureEvent({ name: "customizations_scanned" });
    setScanState("scanning");
  }

  // ---- Pre-scan empty state ----
  if (scanState === "idle") {
    return (
      <StepShell
        eyebrow={stepEyebrow("customizations")}
        title="Import your customizations"
        description="Already set this Mac up by hand? nixmac can scan for tweaks that aren't in your flake yet — macOS preferences, Homebrew casks and taps, launch agents — and turn them into code."
      >
        <div className="relative flex flex-col overflow-hidden rounded-2xl rounded-tl-3xl rounded-br-3xl rounded-bl-3xl border border-transparent shadow ring-1 shadow-black/10 ring-white/5">
          <DottedGlowBackground
            className="pointer-events-none mask-radial-to-90% mask-radial-at-center"
            opacity={0.5}
            gap={10}
            radius={1.6}
            color="rgba(115, 115, 115, 0.55)"
            darkColor="rgba(115, 115, 115, 0.55)"
            glowColor="rgba(115, 115, 115, 0.85)"
            darkGlowColor="rgba(45, 212, 191, 0.85)"
            backgroundOpacity={1}
            speedMin={0.1}
            speedMax={1}
            speedScale={.8}
          />



          <span
            className="relative z-20 mx-auto mt-8 flex size-16 items-center justify-center rounded-2xl bg-brand/10 text-brand ring-1 ring-brand/30"
            aria-hidden="true"
          >
            <Radar className="size-8" />
          </span>

          <div className="relative z-20 flex flex-1 flex-col items-center px-6 pt-6 pb-8 text-center">
            <h3 className="text-balance font-semibold text-xl">
              Scan this Mac for untracked settings
            </h3>
            <p className="mt-2 max-w-md text-pretty text-muted-foreground text-sm leading-relaxed">
              Already set this Mac up by hand? We&apos;ll run a few read-only commands to detect what
              you&apos;ve customized and turn it into code. Nothing changes on your system — you
              choose what to track afterward.
            </p>

            <div className="relative z-20 mt-7">
              <ButtonGlow className="bg-slate-900" active onClick={startScan}>
                <Radar className="size-4" aria-hidden="true" />
                Scan this Mac
              </ButtonGlow>
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end">
          <Button variant="ghost" onClick={onContinue}>
            <SkipForward className="size-4" aria-hidden="true" />
            Skip — I&apos;ll import later
          </Button>
        </div>
      </StepShell>
    );
  }

  // ---- In-progress scan ----
  if (scanState === "scanning") {
    return (
      <StepShell
        eyebrow={stepEyebrow("customizations")}
        title="Scanning this Mac…"
        description="Reading your current configuration. This usually takes a few seconds."
      >
        <ScanProgress onDone={() => setAnimationDone(true)} />
      </StepShell>
    );
  }

  // ---- Results ----
  const resolved = groups ?? [];
  const total = totalCustomizations(resolved);

  if (resolved.length === 0) {
    return (
      <StepShell
        eyebrow={stepEyebrow("customizations")}
        title="Nothing to import"
        description="Nice — this Mac is already clean. We didn't find untracked macOS settings, Homebrew packages, or launch agents to capture."
      >
        <div className="flex flex-col items-center rounded-2xl border border-success/30 bg-success/5 px-6 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-success/15 text-success">
            <Check className="size-6" aria-hidden="true" />
          </span>
          <p className="mt-4 font-medium text-sm">No untracked customizations detected</p>
          <p className="mt-1 max-w-sm text-pretty text-muted-foreground text-sm">
            You can always import tweaks later from the Untracked tab.
          </p>
        </div>
        <div className="mt-6 flex items-center justify-end">
          <Button onClick={onContinue}>
            Continue
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </StepShell>
    );
  }

  return (
    <StepShell
      eyebrow={stepEyebrow("customizations")}
      title="Import your customizations"
      description="nixmac scanned this Mac and found tweaks that aren't in your flake yet. Track the ones you want and we'll write them into your config."
    >
      <div className="mb-4 flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
        <p className="text-muted-foreground text-sm">
          <span className="font-semibold text-foreground">{total} customizations</span> detected
          across {resolved.length} categories
        </p>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 font-semibold text-xs",
            trackedCount > 0 ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
          )}
        >
          {trackedCount} tracked
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {resolved.map((group) => (
          <GroupCard
            key={group.id}
            group={group}
            trackedSet={trackedSet}
            onTrack={track}
            onUntrack={untrack}
          />
        ))}
      </div>

      <p className="mt-5 text-muted-foreground/70 text-xs leading-relaxed">
        Use these as starting points — every change still goes through the standard plan → review →
        save flow. You can also skip and import them later from the Untracked tab.
      </p>

      <div className="mt-6 flex items-center justify-end gap-3">
        <Button variant="ghost" onClick={onContinue}>
          Skip for now
        </Button>
        <Button
          onClick={() => {
            if (trackedCount > 0) {
              getTelemetry().captureEvent({
                name: "customizations_tracked",
                props: { count: trackedCount },
              });
            }
            onContinue();
          }}
        >
          {trackedCount > 0 ? `Continue with ${trackedCount} tracked` : "Continue"}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </StepShell>
  );
}

function ScanProgress({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    SCAN_TARGETS.forEach((_, i) => {
      timers.push(setTimeout(() => setCurrent(i + 1), (i + 1) * 700));
    });
    timers.push(setTimeout(() => onDoneRef.current(), SCAN_TARGETS.length * 700 + 500));
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <ul className="flex flex-col gap-1">
        {SCAN_TARGETS.map((t, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li
              key={t.label}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 font-mono text-sm transition-colors",
                active && "bg-background/60",
              )}
            >
              <span className="shrink-0" aria-hidden="true">
                {done ? (
                  <Check className="size-4 text-success" />
                ) : active ? (
                  <Loader2 className="size-4 animate-spin text-brand" />
                ) : (
                  <span className="block size-4 rounded-full border border-border" />
                )}
              </span>
              <span className={cn(done || active ? "text-foreground" : "text-muted-foreground/60")}>
                $ {t.command}
              </span>
              <span
                className={cn(
                  "ml-auto text-xs",
                  done ? "text-success" : "text-muted-foreground/50",
                )}
              >
                {done ? "done" : active ? "scanning…" : "queued"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function GroupCard({
  group,
  trackedSet,
  onTrack,
  onUntrack,
}: {
  group: CustomizationGroup;
  trackedSet: Set<string>;
  onTrack: (items: CustomizationItem[]) => void;
  onUntrack: (ids: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(group.severity === "info");
  const [showPreview, setShowPreview] = useState(false);

  const ids = group.items.map((i) => i.id);
  const trackedIds = ids.filter((id) => trackedSet.has(id));
  const allTracked = trackedIds.length === ids.length;
  const someTracked = trackedIds.length > 0;
  const isWarning = group.severity === "warning";

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-card",
        isWarning ? "border-warning/30" : "border-border",
      )}
    >
      <div className="flex w-full items-start gap-3 p-4 text-left">
        <Checkbox
          checked={allTracked}
          onCheckedChange={(checked) => {
            if (checked === true) {
              onTrack(group.items);
            } else {
              onUntrack(ids);
            }
          }}
          className={cn("size-4 border-none", allTracked ? "bg-white" : "bg-zinc-700")}
        />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 font-semibold text-sm">
              {group.items.length} {group.title}
              {allTracked ? <Check className="size-4 text-success" aria-hidden="true" /> : null}
            </span>
            <span className="mt-1 block text-pretty text-muted-foreground text-xs leading-relaxed">
              {group.description}
            </span>
            <span className="mt-2 block font-mono text-muted-foreground/80 text-xs">
              <span className="text-muted-foreground">$ {group.command}</span>
              {group.commandNote ? ` (${group.commandNote})` : ""} · scanned just now · would land
              in <span className="text-foreground">{group.landingPath}</span>
            </span>
          </span>
          <ChevronDown
            className={cn(
              "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>
      </div>

      {expanded ? (
        <>
          <div className="flex flex-wrap items-center gap-2 border-border border-t bg-background/40 px-4 py-3">
            {allTracked ? (
              <Button size="sm" variant="secondary" onClick={() => onUntrack(ids)}>
                <Check className="size-4 text-success" aria-hidden="true" />
                Tracking all {ids.length}
              </Button>
            ) : (
              <Button size="sm" onClick={() => onTrack(group.items)}>
                <Plus className="size-4" aria-hidden="true" />
                Track{" "}
                {someTracked
                  ? `remaining ${ids.length - trackedIds.length}`
                  : `these ${ids.length}`}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setShowPreview((v) => !v)}>
              <Braces className="size-4" aria-hidden="true" />
              {showPreview ? "Hide additions" : "Preview additions"}
            </Button>
          </div>

          <p className="px-4 pt-3 font-mono text-[11px] text-muted-foreground/70 uppercase tracking-wider">
            · Found · {group.items.length}
          </p>
          <ul className="divide-y divide-border/60">
            {group.items.map((item) => {
              const isTracked = trackedSet.has(item.id);
              return (
                <li key={item.id} className="flex items-start justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-pretty font-medium text-sm">{item.label}</p>
                    <p className="mt-0.5 break-all font-mono text-muted-foreground text-xs">
                      {item.detail}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="hidden font-mono text-muted-foreground/70 text-xs sm:inline">
                      {item.meta}
                    </span>
                    {isTracked ? (
                      <button
                        type="button"
                        onClick={() => onUntrack([item.id])}
                        className="inline-flex items-center gap-1 font-medium text-success text-xs hover:underline"
                      >
                        <Check className="size-3.5" aria-hidden="true" />
                        Tracked
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onTrack([item])}
                        className="font-medium text-primary text-xs hover:underline"
                      >
                        Track
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {showPreview ? (
            <div className="border-border border-t bg-background/60 p-4">
              <pre className="overflow-x-auto font-mono text-xs leading-relaxed">
                {group.items.map((item) => (
                  <div key={item.id} className="flex gap-2">
                    <span className="select-none text-success">+</span>
                    <span className="text-success/90">{item.nixLine}</span>
                  </div>
                ))}
              </pre>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

// Exposed for Storybook/fallback wiring.
export { MOCK_CUSTOMIZATION_GROUPS };
