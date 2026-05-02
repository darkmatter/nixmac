"use client";

import { useEffect, useState } from "react";

import { useWidgetStore } from "@/stores/widget-store";

import { FILES, SECTIONS, type FsFile, type SectionId } from "./data";
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

  const [activeSection, setActiveSection] = useState<SectionId>("darwin");

  const files = FILES[activeSection] ?? [];

  useEffect(() => {
    // Reset peek state by virtue of remounting list when section changes.
    // FileList is keyed by section below.
  }, [activeSection]);

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

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="filesystem-step">
      <SectionTabs sections={SECTIONS} active={activeSection} setActive={setActiveSection} files={FILES} />
      <FileList
        key={activeSection}
        files={files}
        onEditWithPrompt={onEditWithPrompt}
        onTrack={onTrack}
      />
      <div className="shrink-0 border-border/50 border-t bg-card/40 px-3 py-1.5 text-[10.5px] text-muted-foreground">
        Use these as starting points — every change goes through the standard plan → review → save flow.
      </div>
    </div>
  );
}
