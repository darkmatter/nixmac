"use client";

import { useEffect, useState } from "react";

import { tauriAPI } from "@/ipc/api";
import { useWidgetStore } from "@/stores/widget-store";
import { mirrorChangeMapState } from "@/viewmodel/change-map";
import { mirrorEvolveState } from "@/viewmodel/evolve";
import { mirrorGitState } from "@/viewmodel/git";

import type { HomebrewItem, HomebrewState } from "@/ipc/types";

import {
  FILES,
  SECTIONS,
  homebrewFilesFromDiff,
  replaceHomebrewPlaceholders,
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

  const filesBySection = {
    ...FILES,
    manage: replaceHomebrewPlaceholders(
      FILES.manage,
      homebrewFilesFromDiff(homebrewDiff, homebrewError),
    ),
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

  const onEditWithPrompt = (file: FsFile) => seed(seedForFile(file));
  const onTrack = (text: string) => seed(text);
  // Add future direct managed-edit trackers here (for example, system defaults)
  // and pass them down alongside the fallback prompt seeding handler.
  const onTrackHomebrewItems = async (items: CandidateItem[]) => {
    const store = useWidgetStore.getState();
    store.setProcessing(true, "apply");
    try {
      const homebrewItems: HomebrewItem[] = items.map((item) => {
        if (!item.kind) {
          throw new Error(`Cannot track ${item.name}: missing Homebrew item type.`);
        }
        return {
          name: item.name,
          version: item.version ?? null,
          itemType: item.kind,
        };
      });
      const result = await tauriAPI.homebrew.addItems(
        homebrewItems,
      );
      mirrorEvolveState(result.evolveState);
      mirrorChangeMapState(result.changeMap);
      mirrorGitState(result.gitStatus);
      store.setRecommendedPrompt(undefined);
      setShowFilesystem(false);
      setHomebrewDiff(null);
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
        onTrack={onTrack}
        onTrackHomebrewItems={onTrackHomebrewItems}
      />
      <div className="shrink-0 border-border/50 border-t bg-card/40 px-3 py-1.5 text-[10.5px] text-muted-foreground">
        Use these as starting points — every change goes through the standard plan → review → save flow.
      </div>
    </div>
  );
}
