"use client";

import { useEffect, useMemo, useState } from "react";

import { useWidgetStore } from "@/stores/widget-store";

import { Detail } from "./detail";
import { FILES, HOSTS, SECTIONS, type Host, type SectionId } from "./data";
import { FileList } from "./file-list";
import { HostsCombobox } from "./hosts-combobox";
import { ModeToggle, type FsMode } from "./mode-toggle";
import { SectionTabs } from "./section-tabs";

export function FilesystemStep() {
  const currentHost = useWidgetStore((s) => s.host);

  // Seed hosts: keep the prototype's mocked fleet, but mark the real current host
  // (if known) so the combobox state matches the rest of the app.
  const hosts = useMemo<Host[]>(() => {
    if (!currentHost) return HOSTS;
    return HOSTS.map((h) => ({ ...h, current: h.name === currentHost || h.current }));
  }, [currentHost]);

  const [selected, setSelected] = useState<Set<string>>(() => new Set(hosts.map((h) => h.id)));
  const [activeSection, setActiveSection] = useState<SectionId>("darwin");
  const [mode, setMode] = useState<FsMode>("plain");

  const files = FILES[activeSection] ?? [];
  const [selectedId, setSelectedId] = useState<string | undefined>(files[0]?.id);

  useEffect(() => {
    setSelectedId(FILES[activeSection]?.[0]?.id);
  }, [activeSection]);

  const selectedFile = files.find((f) => f.id === selectedId) ?? files[0];

  const inScope = hosts.filter((h) => selected.has(h.id));
  const anyDirty = inScope.some((h) => h.state === "dirty");
  const buildableLocally = inScope.length === 1 && inScope[0]?.current;

  const sectionLabel =
    SECTIONS.find((s) => s.id === activeSection)?.[mode === "plain" ? "plain" : "nix"] ?? "";

  const footerCmd =
    mode === "plain"
      ? `Plain mode · ${inScope.length} host${inScope.length === 1 ? "" : "s"} in scope`
      : buildableLocally
        ? `darwin-rebuild switch --flake .#${inScope[0].name}`
        : inScope.length === 0
          ? "no hosts in scope"
          : `nixmac plan --flake . ${inScope.map((h) => `--host ${h.name}`).join(" ")}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar: hosts combobox + mode toggle */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-border/50 border-b bg-card/30 px-3 py-2">
        <HostsCombobox hosts={hosts} selected={selected} setSelected={setSelected} />
        <ModeToggle mode={mode} setMode={setMode} />
      </div>

      {/* Section tabs */}
      <SectionTabs
        sections={SECTIONS}
        active={activeSection}
        setActive={setActiveSection}
        mode={mode}
        files={FILES}
      />

      {/* Body: 2-pane file list + detail */}
      <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr] overflow-hidden">
        <FileList
          files={files}
          selectedId={selectedFile?.id}
          setSelected={setSelectedId}
          mode={mode}
        />
        <Detail file={selectedFile} mode={mode} setMode={setMode} />
      </div>

      {/* Footer status */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-border/50 border-t bg-card/40 px-3 py-1.5 text-[10.5px] text-muted-foreground">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${anyDirty ? "bg-amber-400" : "bg-teal-400"}`}
            />
            {anyDirty ? "Uncommitted changes" : "Clean"}
          </span>
          <span>·</span>
          <span>{sectionLabel}</span>
          <span>·</span>
          <span className="truncate font-mono">{footerCmd}</span>
        </div>
      </div>
    </div>
  );
}
