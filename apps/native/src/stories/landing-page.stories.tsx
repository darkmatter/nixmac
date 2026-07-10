// @ts-nocheck - Marketing stories compose typed app fixtures and partial store state.
import preview from "#storybook/preview";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DriftDiffPreview } from "@/components/widget/drift/drift-diff-preview";
import { EvolveProgress } from "@/components/widget/overlays/evolve-progress";
import { SummaryItems } from "@/components/widget/summaries/summary-items";
import { DarwinWidget } from "@/components/widget/widget";
import type { EvolveEvent, EvolveState, GitStatus, SemanticChangeMap } from "@/ipc/types";
import { cn } from "@/lib/utils";
import { nav, RouterProvider, router } from "@/router";
import {
  makeGlobalPreferences,
  makeGrantedPermissions,
  makeNixInstallState,
  makeRebuildStatus,
} from "@/utils/test-fixtures";
import { uiActions, viewModelActions } from "@nixmac/state";
import {
  ArrowRight,
  Blocks,
  CheckCircle2,
  FileCode2,
  GitBranch,
  Monitor,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
} from "lucide-react";
import type React from "react";

type WidgetPreset = "ready" | "generating" | "review";

const DEMO_FILES = [
  { path: "modules/darwin/defaults.nix", changeType: "edited" },
  { path: "modules/darwin/homebrew.nix", changeType: "edited" },
  { path: "modules/home/programs/git.nix", changeType: "new" },
];

const SAMPLE_DIFF = `diff --git a/modules/darwin/defaults.nix b/modules/darwin/defaults.nix
@@ -12,8 +12,12 @@
   system.defaults = {
     dock = {
+      autohide = true;
       show-recents = false;
     };
     finder = {
+      AppleShowAllExtensions = true;
+      ShowPathbar = true;
       FXPreferredViewStyle = "Nlsv";
     };
   };`;

const EVOLVE_EVENTS: EvolveEvent[] = [
  {
    eventType: "start",
    summary: "Starting AI evolution",
    raw: "Starting evolution with model ~anthropic/claude-sonnet-latest",
    iteration: null,
    timestampMs: 0,
  },
  {
    eventType: "thinking",
    summary: "Planning Finder and Dock changes",
    raw: "Reading the current nix-darwin module layout before editing defaults.",
    iteration: 1,
    timestampMs: 800,
  },
  {
    eventType: "reading",
    summary: "Reading modules/darwin/defaults.nix",
    raw: "read_file modules/darwin/defaults.nix",
    iteration: 1,
    timestampMs: 1_600,
  },
  {
    eventType: "editing",
    summary: "Editing macOS defaults",
    raw: "edit_file modules/darwin/defaults.nix",
    iteration: 2,
    timestampMs: 3_900,
  },
  {
    eventType: "buildCheck",
    summary: "Running darwin-rebuild check",
    raw: "build_check host=Demo-MacBook-Pro",
    iteration: 3,
    timestampMs: 7_100,
  },
  {
    eventType: "buildPass",
    summary: "Build check passed",
    raw: "Build check passed after evaluating the generated module changes.",
    iteration: 3,
    timestampMs: 14_200,
  },
];

const CHANGE_MAP: SemanticChangeMap = {
  groups: [
    {
      summary: {
        id: 1,
        title: "Finder and Dock polish",
        description: "Shows file extensions, path bar, and keeps the Dock out of the way.",
        status: "DONE",
        createdAt: 0,
      },
      changes: [
        {
          id: 1,
          hash: "dock-autohide",
          filename: "modules/darwin/defaults.nix",
          diff: "",
          lineCount: 2,
          createdAt: 0,
          ownSummaryId: null,
          title: "Dock autohide enabled",
          description: "dock.autohide = true",
        },
        {
          id: 2,
          hash: "finder-pathbar",
          filename: "modules/darwin/defaults.nix",
          diff: "",
          lineCount: 3,
          createdAt: 0,
          ownSummaryId: null,
          title: "Finder path bar enabled",
          description: "finder.ShowPathbar = true",
        },
      ],
    },
  ],
  singles: [
    {
      id: 3,
      hash: "git-module",
      filename: "modules/home/programs/git.nix",
      diff: "",
      lineCount: 7,
      createdAt: 0,
      ownSummaryId: null,
      title: "Git identity module added",
      description: "Creates a dedicated Home Manager module for user.name and user.email.",
    },
  ],
  unsummarizedHashes: [],
};

function makeEvolveState(overrides: Partial<EvolveState> = {}): EvolveState {
  return {
    evolutionId: null,
    currentChangesetId: null,
    committable: false,
    backupBranch: null,
    rollbackBranch: null,
    rollbackStorePath: null,
    rollbackChangesetId: null,
    step: "begin",
    lastEvolutionState: null,
    ...overrides,
  };
}

function makeGitStatus(files = DEMO_FILES): GitStatus {
  return {
    files,
    branch: "main",
    diff: SAMPLE_DIFF,
    additions: 18,
    deletions: 3,
    headCommitHash: "d34db33",
    cleanHead: false,
    changes: files.map((file, i) => ({
      id: i + 1,
      hash: `landing-change-${i}`,
      filename: file.path,
      diff: SAMPLE_DIFF,
      lineCount: 12,
      createdAt: 0,
      ownSummaryId: null,
    })),
  };
}

function seedWidgetState(preset: WidgetPreset) {
  const isGenerating = preset === "generating";
  const isReview = preset === "review";

  viewModelActions.setState({
    preferences: makeGlobalPreferences({
      configDir: "/Users/demo/.darwin",
      hostAttr: "Demo-MacBook-Pro",
      repoRoot: "/Users/demo/.darwin",
      evolveProvider: "openrouter",
      evolveModel: "~anthropic/claude-sonnet-latest",
      onboardingMacScannedAt: 1_767_200_000,
      onboardingLoginDecided: true,
      onboardingLastBuildAt: 1_767_200_300,
    }),
    hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
    permissions: makeGrantedPermissions(),
    permissionsHydrated: true,
    nixInstall: makeNixInstallState(),
    evolve: makeEvolveState({
      step: isReview ? "commit" : "begin",
      committable: isReview,
    }),
    git: isReview ? makeGitStatus() : null,
    build: { externalBuildDetected: false },
    changeMap: isReview ? CHANGE_MAP : null,
    evolveEvents: isGenerating ? EVOLVE_EVENTS.slice(0, 5) : [],
    promptHistory: [],
    rebuildStatus: makeRebuildStatus(),
    rebuildLog: { lines: [], rawLines: [], notices: [] },
    history: [],
  });

  uiActions.setShowHistory(false);
  uiActions.setShowFilesystem(false);
  uiActions.setFeedbackOpen(false);
  uiActions.setBootstrapping(false);
  uiActions.setEvolvePrompt(
    isGenerating ? "Tune Finder, Dock, and Git defaults for this Mac" : "",
  );
  uiActions.setError(null);
  uiActions.setGenerating(isGenerating);
  uiActions.setSummarizing(false);
  uiActions.setProcessing(isGenerating, isGenerating ? "evolve" : null);
  uiActions.clearLogs();
  if (isGenerating) {
    uiActions.appendLog('> Evolving: "Tune Finder, Dock, and Git defaults for this Mac"');
  }
  if (isReview) {
    uiActions.appendLog("> darwin-rebuild check passed\nChanges are ready to commit.");
  }
  void nav.goHome();
}

function WidgetScreenshot({ preset = "review" }: { preset?: WidgetPreset }) {
  seedWidgetState(preset);
  return (
    <div className="h-full min-h-0 w-full overflow-hidden rounded-lg border border-white/12 bg-background shadow-2xl">
      <RouterProvider router={router}>
        <DarwinWidget />
      </RouterProvider>
    </div>
  );
}

function ScreenshotStage({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "dark flex min-h-screen w-full items-center justify-center bg-[#0b0d0e] p-8 text-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

function EvolveTimelinePanel() {
  return (
    <div className="h-full rounded-lg border border-white/10 bg-card/95 shadow-2xl">
      <div className="flex items-center justify-between border-white/10 border-b px-4 py-3">
        <div>
          <p className="font-medium text-sm">Agent run</p>
          <p className="text-muted-foreground text-xs">Live build-aware evolution</p>
        </div>
        <Badge variant="secondary" className="gap-1">
          <Sparkles className="h-3 w-3" />
          active
        </Badge>
      </div>
      <EvolveProgress events={EVOLVE_EVENTS} isGenerating={false} className="border-0" />
    </div>
  );
}

function ReviewDiffPanel() {
  return (
    <div className="grid h-full min-h-0 grid-cols-[0.86fr_1.14fr] overflow-hidden rounded-lg border border-white/10 bg-card/95 shadow-2xl">
      <div className="flex min-h-0 flex-col border-white/10 border-r px-4 py-4">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <p className="font-medium text-sm">Review</p>
            <p className="text-muted-foreground text-xs">Semantic summary from real UI</p>
          </div>
          <Badge variant="outline" className="border-emerald-400/30 text-emerald-300">
            3 changes
          </Badge>
        </div>
        <SummaryItems map={CHANGE_MAP} unsummarized={[]} />
      </div>
      <div className="flex min-h-0 flex-col">
        <div className="flex items-center gap-2 border-white/10 border-b px-4 py-3">
          <FileCode2 className="h-4 w-4 text-sky-300" />
          <span className="font-mono text-muted-foreground text-xs">
            modules/darwin/defaults.nix
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <DriftDiffPreview diff={SAMPLE_DIFF} />
        </div>
      </div>
    </div>
  );
}

function ProofTile({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
      <Icon className="mb-3 h-5 w-5 text-brand" />
      <h3 className="font-medium text-sm text-white">{title}</h3>
      <p className="mt-2 text-muted-foreground text-sm leading-6">{body}</p>
    </div>
  );
}

function MiniStoryFrame({
  label,
  storyId,
  captureClassName,
  children,
}: {
  label: string;
  storyId: string;
  captureClassName: string;
  children: React.ReactNode;
}) {
  return (
    <a
      className="group block min-h-0 rounded-lg border border-white/10 bg-[#101315] p-3 transition-colors hover:border-brand/45"
      href={`?path=/story/${storyId}`}
      data-story-id={storyId}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="font-medium text-muted-foreground text-xs">{label}</span>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
      </div>
      <div className="relative h-64 overflow-hidden rounded border border-white/8 bg-background">
        <div className={cn("absolute top-0 left-0 pointer-events-none", captureClassName)}>
          {children}
        </div>
      </div>
    </a>
  );
}

function LandingPage() {
  return (
    <main className="dark min-h-screen bg-[#090b0c] text-foreground">
      <section className="mx-auto grid min-h-[min(760px,calc(100vh-24px))] max-w-7xl grid-cols-[0.9fr_1.1fr] items-center gap-10 px-8 py-10">
        <div className="max-w-xl">
          <Badge variant="outline" className="mb-5 border-brand/40 text-brand">
            nix-darwin, but visible
          </Badge>
          <h1 className="text-balance font-semibold text-6xl leading-[1.02] tracking-normal text-white">
            nixmac
          </h1>
          <p className="mt-5 text-lg text-muted-foreground leading-8">
            Prompt, review, apply, and commit Mac configuration changes through the same UI that
            renders in the desktop app.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button size="lg" className="gap-2">
              <Sparkles className="h-4 w-4" />
              Evolve this Mac
            </Button>
            <Button size="lg" variant="outline" className="gap-2">
              <GitBranch className="h-4 w-4" />
              Review changes
            </Button>
          </div>
          <div className="mt-9 flex max-w-lg flex-wrap gap-x-8 gap-y-5">
            <div className="min-w-28">
              <p className="text-xl font-semibold leading-tight text-white">1 prompt</p>
              <p className="mt-1 text-muted-foreground text-xs">to a checked diff</p>
            </div>
            <div className="min-w-32">
              <p className="text-xl font-semibold leading-tight text-white">0 guesswork</p>
              <p className="mt-1 text-muted-foreground text-xs">before rebuild</p>
            </div>
            <div className="min-w-28">
              <p className="text-xl font-semibold leading-tight text-white">git native</p>
              <p className="mt-1 text-muted-foreground text-xs">commit or discard</p>
            </div>
          </div>
        </div>

        <div className="relative min-h-0">
          <div className="h-[560px] overflow-hidden rounded-lg border border-white/12 bg-[#101315] p-3 shadow-2xl">
            <WidgetScreenshot preset="review" />
          </div>
        </div>
      </section>

      <section className="border-white/10 border-t bg-[#0d1011] px-8 py-12">
        <div className="mx-auto grid max-w-7xl grid-cols-3 gap-4">
          <ProofTile
            icon={Monitor}
            title="Desktop-first workflow"
            body="The app sees selected hosts, config paths, rebuild state, and local git changes before it suggests an edit."
          />
          <ProofTile
            icon={ShieldCheck}
            title="Checks before apply"
            body="Generated edits move through preview and build checks before they become active on the machine."
          />
          <ProofTile
            icon={TerminalSquare}
            title="Terminal facts included"
            body="Logs, diffs, and commit state stay visible so every automation run remains inspectable."
          />
        </div>
      </section>

      <section className="px-8 py-14">
        <div className="mx-auto max-w-7xl">
          <div className="mb-6 flex items-end justify-between gap-6">
            <div>
              <p className="font-medium text-brand text-sm">Screenshot sources</p>
              <h2 className="mt-2 font-semibold text-3xl text-white">Rendered from stories</h2>
            </div>
            <p className="max-w-md text-muted-foreground text-sm leading-6">
              These frames are the same React components the app uses, exposed as standalone
              Storybook capture targets.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <MiniStoryFrame
              label="Hero app frame"
              storyId="marketing-landing-page--hero-app-screenshot"
              captureClassName="h-[680px] w-[1080px]"
            >
              <WidgetScreenshot preset="review" />
            </MiniStoryFrame>
            <MiniStoryFrame
              label="Agent timeline"
              storyId="marketing-landing-page--evolve-timeline-screenshot"
              captureClassName="h-[620px] w-[760px]"
            >
              <EvolveTimelinePanel />
            </MiniStoryFrame>
            <MiniStoryFrame
              label="Review and diff"
              storyId="marketing-landing-page--review-and-diff-screenshot"
              captureClassName="h-[620px] w-[980px]"
            >
              <ReviewDiffPanel />
            </MiniStoryFrame>
          </div>
        </div>
      </section>

      <section className="border-white/10 border-t px-8 py-12">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8">
          <div>
            <div className="flex items-center gap-2 text-brand">
              <Blocks className="h-4 w-4" />
              <span className="font-medium text-sm">Composable app states</span>
            </div>
            <h2 className="mt-3 font-semibold text-3xl text-white">From prompt to committed config</h2>
          </div>
          <div className="grid max-w-xl grid-cols-3 gap-3">
            {["Prompt", "Preview", "Commit"].map((label) => (
              <div key={label} className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
                <CheckCircle2 className="mb-3 h-4 w-4 text-emerald-300" />
                <p className="font-medium text-sm text-white">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

const meta = preview.meta({
  title: "Marketing/Landing Page",
  component: LandingPage,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
});

export default meta;

export const Default = meta.story({
  render: () => <LandingPage />,
});

export const HeroAppScreenshot = meta.story({
  parameters: { layout: "fullscreen" },
  render: () => (
    <ScreenshotStage>
      <div className="h-[680px] w-[1080px]">
        <WidgetScreenshot preset="review" />
      </div>
    </ScreenshotStage>
  ),
});

export const EvolveTimelineScreenshot = meta.story({
  parameters: { layout: "fullscreen" },
  render: () => (
    <ScreenshotStage>
      <div className="h-[620px] w-[760px]">
        <EvolveTimelinePanel />
      </div>
    </ScreenshotStage>
  ),
});

export const ReviewAndDiffScreenshot = meta.story({
  parameters: { layout: "fullscreen" },
  render: () => (
    <ScreenshotStage>
      <div className="h-[620px] w-[980px]">
        <ReviewDiffPanel />
      </div>
    </ScreenshotStage>
  ),
});
