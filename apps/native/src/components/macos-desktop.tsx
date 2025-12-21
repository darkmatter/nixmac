"use client";

import { Battery, Wifi } from "lucide-react";
import { APP_NAME } from "../../shared/constants";

export function MacOSDesktop() {
  const dockPlaceholders = [
    "finder",
    "safari",
    "mail",
    "calendar",
    "photos",
    "notes",
    "app-store",
  ];

  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#1a1a1a]">
      {/* macOS Menu Bar */}
      <div className="absolute top-0 right-0 left-0 z-40 flex h-7 items-center justify-between border-white/[0.08] border-b bg-[#1c1c1e]/95 px-4 backdrop-blur-xl">
        {/* Left side */}
        <div className="flex items-center gap-6">
          <svg
            className="h-3.5 w-3.5 text-white/90"
            fill="currentColor"
            viewBox="0 0 16 16"
          >
            <title>Back</title>
            <path d="M11.182 3.818c.74-.74.74-1.939 0-2.678-.74-.74-1.939-.74-2.678 0L3.818 5.826c-.74.74-.74 1.939 0 2.678l4.686 4.686c.74.74 1.939.74 2.678 0 .74-.74.74-1.939 0-2.678L7.496 7.165l3.686-3.347z" />
          </svg>
          <div className="flex items-center gap-4 font-medium text-[11px]">
            <span className="text-white/90">{APP_NAME}</span>
            <span className="text-white/70">File</span>
            <span className="text-white/70">Edit</span>
            <span className="text-white/70">View</span>
            <span className="text-white/70">Go</span>
            <span className="text-white/70">Window</span>
            <span className="text-white/70">Help</span>
          </div>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          <Battery className="h-4 w-4 text-white/70" />
          <Wifi className="h-4 w-4 text-white/70" />
          <span className="font-medium text-[11px] text-white/90">
            Fri Nov 22 2:30 PM
          </span>
        </div>
      </div>

      {/* Desktop Wallpaper - Dark gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0f0f10] via-[#1a1625] to-[#0a0a12]" />

      {/* Terminal Window */}
      <div className="fade-in slide-in-from-bottom-4 absolute top-20 left-12 w-[600px] animate-in overflow-hidden rounded-lg border border-white/[0.08] bg-[#1c1c1e]/95 shadow-2xl backdrop-blur-xl duration-500">
        {/* Terminal Title Bar */}
        <div className="flex h-11 items-center justify-between border-white/[0.08] border-b bg-[#28282a]/95 px-4">
          <div className="flex items-center">
            <span className="font-medium text-[11px] text-white/60">
              darwinian-config — zsh
            </span>
          </div>
        </div>

        {/* Terminal Content */}
        <div className="space-y-2 p-4 font-mono text-[13px] leading-relaxed">
          <div className="text-[#00ff00]">
            <span className="text-[#5ac8fa]">darwinian</span>
            <span className="text-white/60"> ❯ </span>
            <span className="text-white/90">darwin-rebuild switch</span>
          </div>
          <div className="text-white/70">
            building the system configuration...
          </div>
          <div className="flex items-center gap-2 text-white/70">
            <span className="text-[#00ff00]">✓</span> vim installed successfully
          </div>
          <div className="flex items-center gap-2 text-white/70">
            <span className="text-[#00ff00]">✓</span> natural scroll disabled
          </div>
          <div className="flex items-center gap-2 text-white/70">
            <span className="text-[#00ff00]">✓</span> system packages updated
          </div>
          <div className="mt-2 text-[#5ac8fa]">
            Build succeeded! Your system has evolved.
          </div>
        </div>
      </div>

      {/* Dock */}
      <div className="-translate-x-1/2 absolute bottom-2 left-1/2 z-30">
        <div className="rounded-2xl border border-white/20 bg-white/10 px-3 py-2 shadow-2xl backdrop-blur-2xl">
          <div className="flex items-center gap-2">
            {dockPlaceholders.map((appName) => (
              <div
                className="h-12 w-12 cursor-pointer rounded-xl border border-white/10 bg-gradient-to-br from-white/20 to-white/5 transition-transform hover:scale-110"
                key={appName}
              />
            ))}
            <div className="mx-1 h-12 w-px bg-white/20" />
            <div className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-xl border border-primary/30 bg-gradient-to-br from-primary/40 to-primary/20 transition-transform hover:scale-110">
              <span className="text-xl">🧬</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
