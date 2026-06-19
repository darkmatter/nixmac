"use client";

import { useEffect, useState } from "react";

import { tauriAPI } from "@/ipc/api";
import { useLaunchdItems } from "@/hooks/use-launchd-items";
import { useSystemDefaultsScan } from "@/hooks/use-system-defaults-scan";
import { useWidgetStore } from "@/stores/widget-store";
import { mirrorChangeMapState } from "@/viewmodel/change-map";
import { mirrorEvolveState } from "@/viewmodel/evolve";
import { mirrorGitState } from "@/viewmodel/git";

import type {
  ConfigEditApplyResult,
  HomebrewItem,
  HomebrewState,
  LaunchdItem,
  SystemDefault,
} from "@/ipc/types";

import {
  FILES,
  SECTIONS,
  homebrewFilesFromDiff,
  launchdItemsFileFromScan,
  replaceHomebrewPlaceholders,
  replaceLaunchdPlaceholder,
  replaceSystemDefaultsPlaceholder,
  systemDefaultsFileFromScan,
  type CandidateItem,
  type FsFile,
  type SectionId,
} from "./data";
import { FileList } from "./file-list";
import { SectionTabs } from "./section-tabs";
import { seedForFile } from "./seed-prompt";

interface FilesystemStepProps {
  /**
   * Override the seed-and-close behavior for stories or tests. Default
   * implementation pushes the seed into the widget store and closes
   * the Filesystem view, which routes the user back to BeginStep with
   * the prompt textarea pre-filled.
   */
  onSeedPrompt?: (seed: string) => void;
}

export function FilesystemStep({ onSeedPrompt }: FilesystemStepProps = {}) {
  const setEvolvePrompt = useWidgetStore((s) => s.setEvolvePrompt);
  const setShowFilesystem = useWidgetStore((s) => s.setShowFilesystem);
  const targetSection = useWidgetStore((s) => s.filesystemTargetSection);

  // Honor an upstream "open at section X" intent (e.g. the Untracked
  // banner's View button passes "manage"). Default to System.
  const initialSection: SectionId =
    targetSection && SECTIONS.some((s) => s.id === targetSection)
      ? (targetSection as SectionId)
      : "darwin";

  const [activeSection, setActiveSection] = useState<SectionId>(initialSection);
  const [homebrewDiff, setHomebrewDiff] = useState<HomebrewState | null>(null);
  const [homebrewError, setHomebrewError] = useState<string | null>(null);
  const {
    scan: systemDefaultsScan,
    error: systemDefaultsError,
    refresh: refreshSystemDefaults,
  } = useSystemDefaultsScan();
  const {
    items: launchdItems,
    error: launchdError,
    refresh: refreshLaunchdItems,
  } = useLaunchdItems();

  // Clear the target on mount so a subsequent toggle from the header
  // (which passes no section) returns to the user's last view.
  useEffect(() => {
    if (targetSection) {
      useWidgetStore.setState({ filesystemTargetSection: null });
    }
  }, [targetSection]);

  useEffect(() => {
    let cancelled = false;
    tauriAPI.homebrew
      .getStateDiff()
      .then((diff) => {
        if (!cancelled) {
          setHomebrewDiff(diff);
          setHomebrewError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setHomebrewError(String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const manageFiles = replaceLaunchdPlaceholder(
    replaceSystemDefaultsPlaceholder(
      replaceHomebrewPlaceholders(
        FILES.manage,
        homebrewFilesFromDiff(homebrewDiff, homebrewError),
      ),
      systemDefaultsFileFromScan(systemDefaultsScan, systemDefaultsError),
    ),
    launchdItemsFileFromScan(launchdItems, launchdError),
  );

  const filesBySection = {
    ...FILES,
    manage: manageFiles,
  };

  const files = filesBySection[activeSection] ?? [];

  const seed = (text: string) => {
    if (onSeedPrompt) {
      onSeedPrompt(text);
      return;
    }
    setEvolvePrompt(text);
    setShowFilesystem(false);
  };

  const mirrorApplyResult = (result: ConfigEditApplyResult) => {
    const store = useWidgetStore.getState();
    mirrorEvolveState(result.evolveState);
    mirrorChangeMapState(result.changeMap);
    mirrorGitState(result.gitStatus);
    store.setRecommendedPrompt(undefined);
  };

  const onEditWithPrompt = (file: FsFile) => seed(seedForFile(file));
  const onTrackHomebrewItems = async (items: CandidateItem[]) => {
    const store = useWidgetStore.getState();
    store.setProcessing(true, "apply");
    try {
      const homebrewItems: HomebrewItem[] = items.map((item) => {
        if (item.source !== "homebrew" || !item.itemType) {
          throw new Error(`Cannot track ${item.name}: missing Homebrew item type.`);
        }
        return {
          name: item.name,
          version: item.version ?? null,
          itemType: item.itemType,
        };
      });
      const result = await tauriAPI.homebrew.addItems(
        homebrewItems,
      );
      mirrorApplyResult(result);
      setShowFilesystem(false);
      setHomebrewDiff(null);
    } finally {
      store.setProcessing(false);
    }
  };

  const onTrackSystemDefaults = async (items: CandidateItem[]) => {
    const store = useWidgetStore.getState();
    store.setProcessing(true, "apply");
    try {
      const defaults: SystemDefault[] = items.map((item) => {
        if (item.source !== "system") {
          throw new Error(`Cannot track ${item.name}: missing system default payload.`);
        }
        return item.systemDefault;
      });
      const result = await tauriAPI.scanner.applyDefaults(defaults);
      mirrorApplyResult(result);
      await refreshSystemDefaults();
      setShowFilesystem(false);
    } finally {
      store.setProcessing(false);
    }
  };

  const onTrackLaunchdItems = async (items: CandidateItem[]) => {
    const store = useWidgetStore.getState();
    store.setProcessing(true, "apply");
    try {
      const launchdItemsToApply: LaunchdItem[] = items.map((item) => {
        if (item.source !== "launchd") {
          throw new Error(`Cannot track ${item.name}: missing launchd payload.`);
        }
        return item.launchdItem;
      });
      const result = await tauriAPI.launchd.applyLaunchdItems(launchdItemsToApply);
      mirrorApplyResult(result);
      await refreshLaunchdItems();
      setShowFilesystem(false);
    } finally {
      store.setProcessing(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="filesystem-step">
      <SectionTabs
        sections={SECTIONS}
        active={activeSection}
        setActive={setActiveSection}
        files={filesBySection}
      />
      <FileList
        key={activeSection}
        files={files}
        onEditWithPrompt={onEditWithPrompt}
        onTrackHomebrewItems={onTrackHomebrewItems}
        onTrackSystemDefaults={onTrackSystemDefaults}
        onTrackLaunchdItems={onTrackLaunchdItems}
      />
      <div className="shrink-0 border-border/50 border-t bg-card/40 px-3 py-1.5 text-[10.5px] text-muted-foreground">
        Use these as starting points — every change goes through the standard plan → review → save flow.
      </div>
    </div>
  );
}
