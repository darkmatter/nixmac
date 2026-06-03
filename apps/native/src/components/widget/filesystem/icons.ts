import {
  AlertTriangle,
  AppWindow,
  Cable,
  FlaskConical,
  Layers,
  Lock,
  type LucideIcon,
  ScrollText,
  Settings2,
  Shield,
  Square,
  Terminal,
  TerminalSquare,
  Variable,
} from "lucide-react";

import type { FsIconName } from "./data";

const ICON_MAP: Record<FsIconName, LucideIcon> = {
  wiring: Cable,
  lock: Lock,
  terminal: Terminal,
  app: AppWindow,
  dock: Square,
  service: Settings2,
  shield: Shield,
  shell: TerminalSquare,
  preferences: Variable,
  secret: ScrollText,
  overlay: Layers,
  settings: Settings2,
  warn: AlertTriangle,
};

export function resolveIcon(name: FsIconName): LucideIcon {
  return ICON_MAP[name] ?? FlaskConical;
}
