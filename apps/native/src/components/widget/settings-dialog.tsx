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
import { DirectoryPicker } from "@/components/widget/directory-picker";
import { useDarwinConfig } from "@/hooks/use-darwin-config";
import { cn } from "@/lib/utils";
import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { Bot, Check, FolderOpen, Key, Loader2, Palette, Settings2, X } from "lucide-react";
import { useState, useEffect } from "react";

type SettingsTab = "general" | "appearance" | "api-keys" | "ai-models";

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
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
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

/**
 * Settings dialog component - manages all settings internally.
 * Loads and saves preferences via Tauri API.
 */
export function SettingsDialog() {
  const isOpen = useWidgetStore((state) => state.settingsOpen);
  const setSettingsOpen = useWidgetStore((state) => state.setSettingsOpen);

  const configDir = useWidgetStore((state) => state.configDir);
  const hosts = useWidgetStore((state) => state.hosts);
  const host = useWidgetStore((state) => state.host);
  const setHosts = useWidgetStore((state) => state.setHosts);

  const { saveHost } = useDarwinConfig();

  const [prefFloatingFooter, setPrefFloatingFooter] = useState(false);
  const [prefWindowShadow, setPrefWindowShadow] = useState(false);
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [summaryProvider, setSummaryProvider] = useState("openai");
  const [summaryModel, setSummaryModel] = useState("");
  const [evolveProvider, setEvolveProvider] = useState("openai");
  const [evolveModel, setEvolveModel] = useState("");

  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus>("idle");
  const [apiKeyInput, setApiKeyInput] = useState("");

  // Load preferences when dialog opens
  useEffect(() => {
    if (isOpen) {
      (async () => {
        try {
          const prefs = await darwinAPI.ui.getPrefs();
          if (prefs) {
            setPrefFloatingFooter(prefs.floatingFooter ?? false);
            setPrefWindowShadow(prefs.windowShadow ?? false);
            const apiKey = prefs.openaiApiKey ?? "";
            setOpenaiApiKey(apiKey);
            setApiKeyInput(apiKey);
            setApiKeyStatus(apiKey ? "valid" : "idle");
            setSummaryProvider(prefs.summaryProvider ?? "openai");
            setSummaryModel(prefs.summaryModel ?? "");
            setEvolveProvider(prefs.evolveProvider ?? "openai");
            setEvolveModel(prefs.evolveModel ?? "");
          }
        } catch {
          // Ignore errors loading preferences
        }
      })();
    }
  }, [isOpen]);

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
    <div className="fixed inset-0 z-[40] flex items-center justify-center" data-tauri-no-drag>
      <button
        aria-label="Close settings"
        className="absolute inset-0 bg-black/40"
        onClick={() => setSettingsOpen(false)}
        type="button"
      />
      <div className="relative z-10 flex h-[460px] w-[620px] max-w-[90vw] overflow-hidden rounded-xl border border-border bg-card/95 shadow-2xl backdrop-blur-xl">
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
              active={activeTab === "ai-models"}
              icon={<Bot className="h-4 w-4" />}
              label="AI Models"
              onClick={() => setActiveTab("ai-models")}
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
              onClick={() => setSettingsOpen(false)}
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
                  <DirectoryPicker
                    label="Configuration Directory"
                    subLabel="Holds your nix-darwin flake"
                  />

                  {/* Host Selection or Bootstrap */}
                  {hasFlake ? (
                    <div className="space-y-2">
                      <label className="font-medium text-sm">Host</label>
                      <div className="flex items-center gap-2">
                        <Select onValueChange={saveHost} value={host || undefined}>
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
                        <Button onClick={handleRefreshHosts} size="sm" variant="outline">
                          Refresh
                        </Button>
                      </div>
                      <p className="text-muted-foreground text-xs">
                        The darwin configuration to use for this machine
                      </p>
                    </div>
                  ) : (
                    configDir && (
                      <BootstrapConfig
                        label="Configuration"
                        onSuccess={() => setSettingsOpen(false)}
                      />
                    )
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
                    <label className="font-medium text-sm">OpenRouter API Key</label>
                    <div className="relative">
                      <input
                        className={cn(
                          "w-full rounded-md border bg-background px-3 py-2 pr-10 font-mono text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50",
                          apiKeyStatus === "valid"
                            ? "border-green-500"
                            : apiKeyStatus === "invalid"
                              ? "border-red-500"
                              : "border-border",
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
                      Required for AI features like code evolution and summaries.{" "}
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

          {activeTab === "ai-models" && (
            <div className="space-y-6">
              <div>
                <h2 className="mb-4 font-semibold text-base">AI Models</h2>
                <div className="space-y-6">
                  {/* Evolution Model */}
                  <div className="space-y-4">
                    <h3 className="font-medium text-sm">Evolution Model</h3>
                    <p className="text-muted-foreground text-xs">
                      Model used to plan and apply configuration changes in Nix
                    </p>
                    <div className="grid gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">
                          Provider
                        </label>
                        <Select
                          onValueChange={async (value) => {
                            setEvolveProvider(value);
                            await darwinAPI.ui.setPrefs({ evolveProvider: value });
                          }}
                          value={evolveProvider}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select provider" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="openai">OpenAI / OpenRouter</SelectItem>
                            <SelectItem value="ollama">Ollama</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">
                          Model Name
                        </label>
                        <input
                          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                          onBlur={async () => {
                            await darwinAPI.ui.setPrefs({ evolveModel });
                          }}
                          onChange={(e) => setEvolveModel(e.target.value)}
                          placeholder={
                            evolveProvider === "ollama"
                              ? "qwen3-coder:30b"
                              : "anthropic/claude-sonnet-4"
                          }
                          value={evolveModel}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Summary Model */}
                  <div className="space-y-4 pt-4 border-t border-border">
                    <h3 className="font-medium text-sm">Summary Model</h3>
                    <p className="text-muted-foreground text-xs">
                      Model used to explain and summarize changes
                    </p>
                    <div className="grid gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">
                          Provider
                        </label>
                        <Select
                          onValueChange={async (value) => {
                            setSummaryProvider(value);
                            await darwinAPI.ui.setPrefs({ summaryProvider: value });
                          }}
                          value={summaryProvider}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select provider" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="openai">OpenAI / OpenRouter</SelectItem>
                            <SelectItem value="ollama">Ollama</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">
                          Model Name
                        </label>
                        <input
                          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                          onBlur={async () => {
                            await darwinAPI.ui.setPrefs({ summaryModel });
                          }}
                          onChange={(e) => setSummaryModel(e.target.value)}
                          placeholder={
                            summaryProvider === "ollama" ? "llama3.1" : "openai/gpt-4o-mini"
                          }
                          value={summaryModel}
                        />
                      </div>
                    </div>
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
