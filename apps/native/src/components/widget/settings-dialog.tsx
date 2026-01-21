import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { BootstrapConfig } from "@/components/widget/bootstrap-config";
import { useDarwinConfig } from "@/hooks/use-darwin-config";
import { cn } from "@/lib/utils";
import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import {
  Check,
  FolderOpen,
  Key,
  Loader2,
  Palette,
  Settings2,
  X,
} from "lucide-react";
import { useState } from "react";

type SettingsTab = "general" | "appearance" | "api-keys";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  prefFloatingFooter: boolean;
  setPrefFloatingFooter: (enabled: boolean) => void;
  prefWindowShadow: boolean;
  setPrefWindowShadow: (enabled: boolean) => void;
  openaiApiKey: string;
  setOpenaiApiKey: (key: string) => void;
}

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

function NavItem({ icon, label, active, onClick }: NavItemProps) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

type ApiKeyStatus = "idle" | "verifying" | "valid" | "invalid";

export function SettingsDialog(props: SettingsDialogProps) {
  const {
    isOpen,
    onClose,
    prefFloatingFooter,
    setPrefFloatingFooter,
    prefWindowShadow,
    setPrefWindowShadow,
    openaiApiKey,
    setOpenaiApiKey,
  } = props;

  const configDir = useWidgetStore((state) => state.configDir);
  const hosts = useWidgetStore((state) => state.hosts);
  const host = useWidgetStore((state) => state.host);
  const setHosts = useWidgetStore((state) => state.setHosts);

  const { pickDir, saveHost } = useDarwinConfig();

  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus>(
    openaiApiKey ? "valid" : "idle"
  );
  const [apiKeyInput, setApiKeyInput] = useState(openaiApiKey);

  if (!isOpen) {
    return null;
  }

  const verifyApiKey = async (key: string) => {
    // Always save the key first, regardless of verification
    if (key && key.length > 10) {
      setOpenaiApiKey(key);
      await darwinAPI.ui.setPrefs({ openaiApiKey: key });
    }

    // If no key or too short, just clear status
    if (!key || key.length < 10) {
      setApiKeyStatus("idle");
      return;
    }

    setApiKeyStatus("verifying");

    try {
      // Make a simple API request to verify the key via OpenRouter
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${key}`,
        },
      });

      if (response.ok) {
        setApiKeyStatus("valid");
      } else {
        // Key is saved but might be invalid - show warning but don't block
        setApiKeyStatus("invalid");
      }
    } catch {
      // Network error - key is saved, show as unverified
      setApiKeyStatus("idle");
      console.warn("Could not verify API key - network error");
    }
  };

  const handleApiKeyChange = (value: string) => {
    setApiKeyInput(value);
    setApiKeyStatus("idle");
  };

  const handleApiKeyBlur = () => {
    if (apiKeyInput !== openaiApiKey) {
      verifyApiKey(apiKeyInput);
    }
  };

  const handleRefreshHosts = async () => {
    try {
      const hs = await darwinAPI.flake.listHosts();
      if (Array.isArray(hs)) {
        setHosts(hs);
      }
    } catch {
      // Ignore errors when refreshing hosts
    }
  };

  const hasFlake = hosts.length > 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      data-tauri-no-drag
    >
      <button
        aria-label="Close settings"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        type="button"
      />
      <div className="relative z-10 flex h-[400px] w-[600px] max-w-[90vw] overflow-hidden rounded-xl border border-border bg-card/95 shadow-2xl backdrop-blur-xl">
        {/* Sidebar */}
        <div className="flex w-[180px] flex-col border-border border-r bg-muted/30 p-3">
          <div className="mb-4 flex items-center gap-2 px-2">
            <Settings2 className="h-4 w-4" />
            <span className="font-semibold text-sm">Settings</span>
          </div>
          <nav className="space-y-1">
            <NavItem
              active={activeTab === "general"}
              icon={<FolderOpen className="h-4 w-4" />}
              label="General"
              onClick={() => setActiveTab("general")}
            />
            <NavItem
              active={activeTab === "appearance"}
              icon={<Palette className="h-4 w-4" />}
              label="Appearance"
              onClick={() => setActiveTab("appearance")}
            />
            <NavItem
              active={activeTab === "api-keys"}
              icon={<Key className="h-4 w-4" />}
              label="API Keys"
              onClick={() => setActiveTab("api-keys")}
            />
          </nav>
          <div className="mt-auto">
            <Button
              className="w-full"
              onClick={onClose}
              size="sm"
              variant="secondary"
            >
              Close
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === "general" && (
            <div className="space-y-6">
              <div>
                <h2 className="mb-4 font-semibold text-base">General</h2>
                <div className="space-y-4">
                  {/* Config Directory */}
                  <div className="space-y-2">
                    <label className="font-medium text-sm">
                      Nix Configuration Directory
                    </label>
                    <div className="flex items-center gap-2">
                      <div
                        className="flex-1 truncate rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs"
                        title={configDir}
                      >
                        {configDir || "Not set"}
                      </div>
                      <Button onClick={pickDir} size="sm" variant="secondary">
                        <FolderOpen className="mr-1 h-3 w-3" />
                        Browse
                      </Button>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      The directory containing your nix-darwin flake
                    </p>
                  </div>

                  {/* Host Selection or Bootstrap */}
                  {hasFlake ? (
                    <div className="space-y-2">
                      <label className="font-medium text-sm">Host</label>
                      <div className="flex items-center gap-2">
                        <Select
                          onValueChange={saveHost}
                          value={host || undefined}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select a host" />
                          </SelectTrigger>
                          <SelectContent>
                            {hosts.map((h) => (
                              <SelectItem key={h} value={h}>
                                {h}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          onClick={handleRefreshHosts}
                          size="sm"
                          variant="outline"
                        >
                          Refresh
                        </Button>
                      </div>
                      <p className="text-muted-foreground text-xs">
                        The darwin configuration to use for this machine
                      </p>
                    </div>
                  ) : (
                    configDir && <BootstrapConfig onSuccess={onClose} />
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === "appearance" && (
            <div className="space-y-6">
              <div>
                <h2 className="mb-4 font-semibold text-base">Appearance</h2>
                <div className="space-y-4">
                  {/* Floating Footer */}
                  <div className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div className="space-y-0.5">
                      <div className="font-medium text-sm">Floating Footer</div>
                      <div className="text-muted-foreground text-xs">
                        Show the footer floating above content
                      </div>
                    </div>
                    <Switch
                      checked={prefFloatingFooter}
                      onCheckedChange={async (checked) => {
                        setPrefFloatingFooter(checked);
                        try {
                          await darwinAPI.ui.setPrefs({
                            floatingFooter: checked,
                          });
                        } catch {
                          // Ignore errors
                        }
                      }}
                    />
                  </div>

                  {/* Window Shadow */}
                  <div className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div className="space-y-0.5">
                      <div className="font-medium text-sm">Window Shadow</div>
                      <div className="text-muted-foreground text-xs">
                        Add a shadow around the widget window
                      </div>
                    </div>
                    <Switch
                      checked={prefWindowShadow}
                      onCheckedChange={async (checked) => {
                        setPrefWindowShadow(checked);
                        try {
                          await darwinAPI.ui.setWindowShadow(checked);
                          await darwinAPI.ui.setPrefs({
                            windowShadow: checked,
                          });
                        } catch {
                          // Ignore errors
                        }
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "api-keys" && (
            <div className="space-y-6">
              <div>
                <h2 className="mb-4 font-semibold text-base">API Keys</h2>
                <div className="space-y-4">
                  {/* OpenRouter API Key */}
                  <div className="space-y-2">
                    <label className="font-medium text-sm">
                      OpenRouter API Key
                    </label>
                    <div className="relative">
                      <input
                        className={cn(
                          "w-full rounded-md border bg-background px-3 py-2 pr-10 font-mono text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50",
                          apiKeyStatus === "valid"
                            ? "border-green-500"
                            : apiKeyStatus === "invalid"
                              ? "border-red-500"
                              : "border-border"
                        )}
                        onBlur={handleApiKeyBlur}
                        onChange={(e) => handleApiKeyChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            verifyApiKey(apiKeyInput);
                          }
                        }}
                        placeholder="sk-or-..."
                        type="password"
                        value={apiKeyInput}
                      />
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                        {apiKeyStatus === "verifying" && (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        )}
                        {apiKeyStatus === "valid" && (
                          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500">
                            <Check className="h-3 w-3 text-white" />
                          </div>
                        )}
                        {apiKeyStatus === "invalid" && (
                          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500">
                            <X className="h-3 w-3 text-white" />
                          </div>
                        )}
                      </div>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      Required for AI features like code evolution and
                      summaries.{" "}
                      <a
                        className="text-primary underline hover:no-underline"
                        href="https://openrouter.ai/keys"
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        Get an API key →
                      </a>
                    </p>
                    {apiKeyStatus === "invalid" && (
                      <p className="text-red-500 text-xs">
                        Invalid API key. Please check and try again.
                      </p>
                    )}
                    {apiKeyStatus === "valid" && (
                      <p className="text-green-600 text-xs">
                        API key verified and saved successfully.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
