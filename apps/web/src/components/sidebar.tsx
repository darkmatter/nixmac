import { ChevronLeft, ChevronRight, Home, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({
  activeView,
  onViewChange,
  isCollapsed,
  onToggleCollapse,
}: SidebarProps) {
  const navItems = [
    { id: "landing", label: "Landing Page", icon: Home },
    { id: "onboarding", label: "Onboarding Flow", icon: Rocket },
  ];

  return (
    <aside
      className={`fixed top-0 left-0 z-40 h-screen border-zinc-800 border-r bg-zinc-950 transition-all duration-300 ${
        isCollapsed ? "w-16" : "w-64"
      }`}
    >
      {/* Header */}
      <div className="flex h-16 items-center justify-between border-zinc-800 border-b px-4">
        {!isCollapsed && (
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-blue-600/20 text-blue-400">
              <span className="font-bold text-sm">N</span>
            </div>
            <div>
              <h2 className="font-semibold text-sm text-zinc-100">nixmac</h2>
              <p className="text-xs text-zinc-500">System Manager</p>
            </div>
          </div>
        )}
        {isCollapsed && (
          <div className="flex h-8 w-8 items-center justify-center rounded bg-blue-600/20 text-blue-400">
            <span className="font-bold text-sm">N</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;

          return (
            <button
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                isActive
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
              key={item.id}
              onClick={() => onViewChange(item.id)}
              title={isCollapsed ? item.label : undefined}
            >
              <Icon className="h-5 w-5 flex-shrink-0" />
              {!isCollapsed && (
                <span className="font-medium">{item.label}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Toggle Button */}
      <div className="border-zinc-800 border-t p-3">
        <Button
          className="w-full justify-center text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          onClick={onToggleCollapse}
          size="sm"
          variant="ghost"
        >
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <>
              <ChevronLeft className="mr-2 h-4 w-4" />
              <span className="text-xs">Collapse</span>
            </>
          )}
        </Button>
      </div>
    </aside>
  );
}
