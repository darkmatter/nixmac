"use client";

import { ConfigEditOverlayPanel } from "@/components/widget/overlays/config-edit-overlay-panel";
import { EditorPanel } from "@/components/widget/overlays/editor-panel";
import { EtcClobberWarningDialog } from "@/components/widget/overlays/etc-clobber-warning-dialog";
import { EvolveOverlayPanel } from "@/components/widget/overlays/evolve-overlay-panel";
import { RebuildOverlayPanel } from "@/components/widget/overlays/rebuild-overlay-panel";
import { Console } from "@/components/widget/layout/console";
import { ErrorMessage } from "@/components/widget/layout/error-message";
import { FeedbackDialog } from "@/components/widget/feedback/feedback-dialog";
import { Header } from "@/components/widget/layout/header";
import { ReportIssueButton } from "@/components/widget/feedback/report-issue-button";
import { StepContentWrapper } from "@/components/widget/layout/step-content-wrapper";
import { Stepper } from "@/components/widget/layout/stepper";
import { SecretsManagementRoute } from "@/components/widget/secrets/secrets-management";
import { OnboardingFlow } from "@/components/widget/onboarding/onboarding-flow";
import { useOnboardingFlow } from "@/components/widget/onboarding/use-onboarding-flow";
import {
  RepairBanners,
  RepairBlockingCard,
  useRepair,
} from "@/components/widget/repair/repair";
import { uiActions } from "@nixmac/state";
import {
  BeginStep,
  CommitStep,
  FilesystemStep,
  HistoryStep,
  ReviewStep,
} from "@/components/widget/steps";
import { surfaceRecoveryReport } from "@/hooks/use-feedback-on-recovery";
import { useGitOperations } from "@/hooks/use-git-operations";
import { useNixInstall } from "@/hooks/use-nix-install";
import { usePanicHandler } from "@/hooks/use-panic-handler";
import { usePermissions } from "@/hooks/use-permissions";
import { useTrayEvents } from "@/hooks/use-tray-events";
import { markBootRenderStage, markBootStage } from "@/lib/boot-diagnostics";
import { SplashScreen, type SplashStage } from "@/components/widget/layout/splash-screen";
import { useEvolveMascot } from "@/hooks/use-evolve-mascot";
import { useHostedModelAuthGuard } from "@/hooks/use-hosted-model-auth-guard";
import { useUiState, useViewModel } from "@nixmac/state";
import { useCurrentStep } from "@/hooks/use-current-step";
import { UpdateBanner } from "@/components/widget/layout/update-banner";
import { markViewModelHydrated, startViewModelSync } from "@/viewmodel";
import { setupErrorTestHelpers } from "@/utils/error-test-helpers";
import { setupWidgetTestHelpers } from "@/utils/widget-test-helpers";
import { useEffect, useRef, useState } from "react";
import { nav, useIsOverlayActive } from "@/router";
import { ipcRenderer } from "@/ipc/api";
import {
  acknowledgeMainWindowClose,
  dismissMainWindowPopover,
  isMainWindowPopover,
} from "@/lib/main-window";
import {
  dispatchSyntheticDocumentEscape,
  ESCAPE_OWNER_PRIORITY,
  registerEscapeOwner,
  routeEscapeToOwner,
} from "@/lib/escape-owner";

/**
 * Main nixmac window / widget component.
 */

export function DarwinWidget() {
  markBootRenderStage("darwin-widget-render");

  const step = useCurrentStep();
  const { getInitialStatus } = useGitOperations();
  const { checkNix } = useNixInstall();
  const { checkPermissions } = usePermissions();

  // Experimental: spin the mascot in a corner indicator while evolving/building
  useEvolveMascot();

  // Hosted inference cannot run without the device credential. Check this
  // after startup hydration so a logged-out user is sent to the choice in
  // Settings before they discover the problem by submitting a prompt.
  useHostedModelAuthGuard();

  // Set up panic handler to catch Rust crashes and show feedback dialog
  usePanicHandler();

  // Listen for tray menu events (Send Feedback, Settings)
  useTrayEvents();

  useEffect(() => {
    markBootStage("darwin-widget-committed");
  }, []);

  // Set up test helpers for error handlers and widget store (development only)
  useEffect(() => {
    if (import.meta.env.DEV) {
      setupErrorTestHelpers();
      setupWidgetTestHelpers();
    }
  }, []);

  // Esc and Cmd+W share one topmost-overlay owner. In popover mode, native Esc
  // events are bridged here when the webview is not first responder; DOM Esc
  // handles the normal webview path. Nested Radix layers and IME composition
  // keep first refusal through defaultPrevented/isComposing.
  const isOverlayActive = useIsOverlayActive();
  const isOverlayActiveRef = useRef(isOverlayActive);
  isOverlayActiveRef.current = isOverlayActive;

  useEffect(() => {
    let disposed = false;
    let unlistenNativeEscape: (() => void) | undefined;
    let unlistenNativeCloseRequested: (() => void) | undefined;
    let isPopoverMode = false;
    let nativePopoverModeIsAuthoritative = false;

    void isMainWindowPopover()
      .then((enabled) => {
        if (!nativePopoverModeIsAuthoritative) {
          isPopoverMode = enabled;
        }
      })
      .catch((error) => {
        if (import.meta.env.PROD) {
          console.error("Failed to read main-window mode:", error);
        }
      });

    type EscapeDisposition = "closed" | "unhandled";

    // The file editor stays mounted across dismissal: its unsaved Monaco
    // buffer is local to the component and closing it would discard that text.
    const closeTopmostOverlay = (): EscapeDisposition => {
      // Settings is route-backed and visually above every widget-owned layer.
      if (isOverlayActiveRef.current) {
        void nav.goHome();
        return "closed";
      }

      const {
        showHistory,
        showFilesystem,
        showSecretsManagement,
        isProcessing,
        isGenerating,
      } = useUiState.getState();

      // Keep active work mounted; popover Escape/Cmd+W can hide the window
      // without changing the operation's state. Rebuild was not part of the
      // existing control-window gate, so only popover mode treats it as work
      // that outranks widget overlays.
      const rebuildRunning = useViewModel.getState().rebuildStatus?.isRunning ?? false;
      if (isProcessing || isGenerating || (isPopoverMode && rebuildRunning)) {
        return "unhandled";
      }

      if (showSecretsManagement) {
        uiActions.setShowSecretsManagement(false);
        return "closed";
      }
      if (showHistory) {
        uiActions.setShowHistory(false);
        return "closed";
      }
      if (showFilesystem) {
        uiActions.setShowFilesystem(false);
        return "closed";
      }

      return "unhandled";
    };

    const unregisterWidgetOverlayOwner = registerEscapeOwner({
      name: "widget-overlay",
      priority: ESCAPE_OWNER_PRIORITY.widgetOverlay,
      handle: () => closeTopmostOverlay() === "closed",
    });
    const unregisterPopoverOwner = registerEscapeOwner({
      name: "main-window-popover",
      priority: ESCAPE_OWNER_PRIORITY.popover,
      handle: () => {
        if (!isPopoverMode) return false;
        void dismissMainWindowPopover().catch((error) => {
          if (import.meta.env.PROD) {
            console.error("Failed to dismiss menu-bar popover:", error);
          }
        });
        return true;
      },
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      const cmdOnly = e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
      // Cmd+, opens settings (standard macOS shortcut).
      if (e.key === "," && cmdOnly) {
        e.preventDefault();
        nav.openSettings();
        return;
      }
      // Popover Cmd+W becomes Escape so Radix layers receive first refusal.
      // Control mode keeps its established native-window behavior.
      if (e.key === "w" && cmdOnly) {
        if (isPopoverMode) {
          e.preventDefault();
          dispatchSyntheticDocumentEscape();
          return;
        }
        if (closeTopmostOverlay() !== "unhandled") e.preventDefault();
        return;
      }
      if (e.key !== "Escape") return;
      routeEscapeToOwner(e);
    };

    window.addEventListener("keydown", handleKeyDown);
    void ipcRenderer
      .on("window:escape", () => {
        // Only the native popover monitor emits this event. Treat receipt as
        // authoritative so a transient launch-mode probe failure cannot drop Escape.
        nativePopoverModeIsAuthoritative = true;
        isPopoverMode = true;
        dispatchSyntheticDocumentEscape();
      })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          unlistenNativeEscape = unlisten;
        }
      })
      .catch((error) => {
        if (import.meta.env.PROD) {
          console.error("Failed to listen for native Escape events:", error);
        }
      });
    void ipcRenderer
      .on<{ token: number }>("window:close-requested", (event) => {
        // Native close ownership is popover-only. Route the request through a
        // bubbling DOM Escape so Radix Dialog/AlertDialog layers run before
        // the widget owner, then acknowledge only after dispatch completes.
        nativePopoverModeIsAuthoritative = true;
        isPopoverMode = true;
        dispatchSyntheticDocumentEscape();
        void acknowledgeMainWindowClose(event.payload.token).catch((error) => {
          if (import.meta.env.PROD) {
            console.error("Failed to acknowledge native close request:", error);
          }
        });
      })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          unlistenNativeCloseRequested = unlisten;
        }
      })
      .catch((error) => {
        if (import.meta.env.PROD) {
          console.error("Failed to listen for native close requests:", error);
        }
      });

    return () => {
      disposed = true;
      window.removeEventListener("keydown", handleKeyDown);
      unregisterWidgetOverlayOwner();
      unregisterPopoverOwner();
      unlistenNativeEscape?.();
      unlistenNativeCloseRequested?.();
    };
  }, []);

  // Which launch probe is running, so the splash can say so instead of showing
  // a blank pane. Only read while `hydrated` is false.
  const [splashStage, setSplashStage] = useState<SplashStage>("starting");

  // Load initial data once on mount, then start watching for changes
  useEffect(() => {
    let cancelled = false;
    let stopViewModelSync: (() => void) | null = null;
    const enterStage = (stage: SplashStage) => {
      if (!cancelled) setSplashStage(stage);
    };

    (async () => {
      try {
        // Hydrate every mirrored slice (preferences/hosts, permissions,
        // prompt history, evolve, git, change map) before anything that
        // depends on config being available.
        enterStage("state");
        const stop = await startViewModelSync();
        if (cancelled) {
          stop();
        } else {
          stopViewModelSync = stop;
        }

        // Explicit probes: permissions (writes the backend cell, which
        // round-trips through `permissions_changed`), Nix availability, and
        // the cached git status snapshot.
        enterStage("permissions");
        await checkPermissions();
        enterStage("nix");
        await checkNix();
        enterStage("repository");
        await getInitialStatus();
      } catch (e: unknown) {
        uiActions.setError((e as Error)?.message || String(e));
      }

      // Mark hydration complete only after the explicit probes (nix check,
      // permissions, git status) have written their real values. The nix
      // install cell is NOT persisted — it defaults to null on every launch —
      // so flipping `hydrated` before checkNix runs would let the onboarding
      // gate see a stale null and flash OnboardingFlow for a frame.
      markViewModelHydrated();

      if (cancelled) return;
      surfaceRecoveryReport();
    })();

    return () => {
      cancelled = true;
      stopViewModelSync?.();
    };
  }, []);

  // Onboarding (permissions → nix → flake import → customizations → inference →
  // first build) takes over the whole window via OnboardingFlow. Whether to
  // show it is gated by the backend completion latch (mirrored as
  // `onboardingState`): the wizard appears on first launch and after an
  // explicit "Restart setup", never because a preference fact regressed
  // mid-session. In-flow step routing still derives from durable facts.
  const { showFlow: showOnboarding } = useOnboardingFlow();
  // Post-completion prerequisite regressions surface as repair cards/banners,
  // never by re-entering the wizard. Evaluated from a launch snapshot; the
  // unattended sync helper's banner is the one part that follows live state,
  // because that row is expected to settle after the launch probe.
  const repair = useRepair();
  // Suppress the boot flash: before the ViewModel hydrates, every gate input
  // is a default (null preferences/nixInstall), so both OnboardingFlow and the
  // main widget would render against stale state for a frame. Hold the splash
  // until hydration completes, then render the correct path directly.
  const hydrated = useViewModel((s) => s.hydrated);

  // permissions/nix-setup/setup are owned by OnboardingFlow. Reaching one of
  // them while OnboardingFlow considers setup complete means the two gate
  // derivations (useOnboardingFlow vs useCurrentStep) disagree — a programming
  // error a user should never see. Surface it through the standard error
  // banner (with its Report Error flow) instead of letting the BeginStep
  // fallback below mask it. "setup" is excluded while a bootstrap is running:
  // computeCurrentStep legitimately returns it then, whatever the gates say.
  const isBootstrapping = useUiState((s) => s.isBootstrapping);
  useEffect(() => {
    const gateMismatch =
      step === "permissions" || step === "nix-setup" || (step === "setup" && !isBootstrapping);
    if (hydrated && !showOnboarding && gateMismatch) {
      uiActions.setError(
        `Internal error: onboarding step "${step}" was reached outside onboarding. This is a nixmac bug — please use "Report Error" to let us know.`,
      );
    }
  }, [step, hydrated, showOnboarding, isBootstrapping]);

  if (!hydrated) {
    return <SplashScreen stage={splashStage} />;
  }

  // Routing mechanism
  const getActiveStepComponent = () => {
    switch (step) {
      case "begin":
        return <BeginStep />;

      // The AI evolve step and the manual-drift step share one review surface.
      case "evolve":
      case "manualEvolve":
        return <ReviewStep />;

      case "commit":
        return <CommitStep />;

      case "manualCommit":
        return <CommitStep isManual />;

      case "history":
        return <HistoryStep />;

      case "filesystem":
        return <FilesystemStep />;

      case "secrets":
        return <SecretsManagementRoute />;

      // Defensive fallback: permissions/nix-setup/setup are owned by
      // OnboardingFlow, which takes over the window via showOnboarding when
      // those gates are unsatisfied. If a gate mismatch ever routes here
      // anyway, fall back to the prompt step instead of rendering nothing.
      default:
        return <BeginStep />;
    }
  };

  // Filesystem renders edge-to-edge with its own internal scrollers, so it skips
  // the StepContentWrapper's padding & overflow handling.
  const isEdgeToEdgeStep = step === "filesystem" || step === "secrets";

  if (showOnboarding) {
    return (
      <div className="flex min-h-[600px] min-w-[800px] h-full w-full flex-col bg-background/60">
        <OnboardingFlow />
        <EtcClobberWarningDialog />
        <FeedbackDialog />
        <Console />
      </div>
    );
  }

  // The configured flake is gone: the main surfaces have nothing to operate
  // on, so a repair card replaces the step content until the user fixes the
  // folder, restarts setup, or a recheck passes.
  if (repair.plan.blocking) {
    return (
      <div className="flex min-w-[800px] min-h-[600px] h-full w-full flex-col bg-background/60">
        <Header />
        <RepairBlockingCard issue={repair.plan.blocking} onRecheck={repair.recheck} />
        <FeedbackDialog />
        <Console />
      </div>
    );
  }

  return (
    <div className="flex min-w-[800px] min-h-[600px]  h-full w-full flex-col bg-background/60">
      <Header />
      <Stepper />
      <UpdateBanner />
      <RepairBanners
        banners={repair.plan.banners}
        onDismiss={repair.dismissBanner}
        onRecheck={repair.recheck}
      />

      {/* The evolve and rebuild overlays cover only this content region, so
          the header/stepper above and the console below stay visible while a
          run is in progress. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {isEdgeToEdgeStep ? (
          <div className="relative flex min-h-0 flex-1 flex-col">
            <ErrorMessage />
            {getActiveStepComponent()}
          </div>
        ) : (
          <StepContentWrapper>
            <ErrorMessage />
            {getActiveStepComponent()}
            <ReportIssueButton />
          </StepContentWrapper>
        )}

        <EvolveOverlayPanel />
        <RebuildOverlayPanel />
      </div>

      <ConfigEditOverlayPanel />
      <EditorPanel />
      <EtcClobberWarningDialog />

      <FeedbackDialog />

      <Console />
    </div>
  );
}
