import { Button } from "@/components/ui/button";
import { useDarwinConfig } from "@/hooks/use-darwin-config";
import { cn } from "@/lib/utils";
import { type SettingsTab, useWidgetStore } from "@/stores/widget-store";
import { darwinAPI, DEFAULT_MAX_ITERATIONS } from "@/tauri-api";
import { useForm } from "@tanstack/react-form";
import { Bot, FolderOpen, Key, Settings2, SlidersHorizontal } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { AiModelsTab } from "./settings/ai-models-tab";
import { ApiKeysTab } from "./settings/api-keys-tab";
import { GeneralTab } from "./settings/general-tab";
import { PreferencesTab } from "./settings/preferences-tab";
type ApiKeyStatus = "idle" | "verifying" | "valid" | "invalid";

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
      <span>{label}</span>
    </button>
  );
}

export function SettingsDialog() {
  const {
    settingsOpen: isOpen,
    settingsActiveTab,
    setSettingsOpen,
    configDir,
    hosts,
    host,
    setHosts,
  } = useWidgetStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  // Deep-link to a specific tab when requested, otherwise reset to general
  useEffect(() => {
    if (isOpen) {
      setActiveTab(settingsActiveTab ?? "general");
    }
  }, [isOpen, settingsActiveTab]);
  const [openrouterKeyStatus, setOpenrouterKeyStatus] = useState<ApiKeyStatus>("idle");
  const [openaiKeyStatus, setOpenaiKeyStatus] = useState<ApiKeyStatus>("idle");
  const openrouterTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const openaiTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { saveHost } = useDarwinConfig();

  const verifyOpenrouterKey = async (key: string) => {
    if (!key) {
      setOpenrouterKeyStatus("idle");
      await darwinAPI.ui.setPrefs({ openrouterApiKey: "" });
      return;
    }

    setOpenrouterKeyStatus("verifying");
    try {
      const response = await fetch("https://openrouter.ai/api/v1/auth/key", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${key}`,
        },
      });

      if (response.ok) {
        setOpenrouterKeyStatus("valid");
        await darwinAPI.ui.setPrefs({ openrouterApiKey: key });
      } else {
        setOpenrouterKeyStatus("invalid");
      }
    } catch (error) {
      console.error("Error verifying OpenRouter API key:", error);
      setOpenrouterKeyStatus("invalid");
    }
  };

  const verifyOpenaiKey = async (key: string) => {
    if (!key) {
      setOpenaiKeyStatus("idle");
      await darwinAPI.ui.setPrefs({ openaiApiKey: "" });
      return;
    }

    setOpenaiKeyStatus("verifying");
    try {
      const response = await fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${key}`,
        },
      });

      if (response.ok) {
        setOpenaiKeyStatus("valid");
        await darwinAPI.ui.setPrefs({ openaiApiKey: key });
      } else {
        setOpenaiKeyStatus("invalid");
      }
    } catch (error) {
      console.error("Error verifying OpenAI API key:", error);
      setOpenaiKeyStatus("invalid");
    }
  };

  const saveOllamaUrl = async (url: string) => {
    await darwinAPI.ui.setPrefs({ ollamaApiBaseUrl: url });
    // Clear cached Ollama models when the base URL changes
    await darwinAPI.models.clearCached("ollama");
  };

  const saveVllmUrl = async (url: string) => {
    await darwinAPI.ui.setPrefs({ vllmApiBaseUrl: url });
  };

  const saveVllmKey = async (key: string) => {
    await darwinAPI.ui.setPrefs({ vllmApiKey: key });
  };

  const form = useForm({
    defaultValues: {
      openrouterApiKey: "",
      openaiApiKey: "",
      ollamaApiBaseUrl: "",
      vllmApiBaseUrl: "",
      vllmApiKey: "",
      summaryProvider: "openai",
      summaryModel: "openai/gpt-4o-mini",
      evolveProvider: "openai",
      evolveModel: "anthropic/claude-sonnet-4",
      maxIterations: DEFAULT_MAX_ITERATIONS,
      maxBuildAttempts: 5,
      sendDiagnostics: false,
    },
  });

  // Load initial values
  // biome-ignore lint/correctness/useExhaustiveDependencies: initial load only
  useEffect(() => {
    const loadPrefs = async () => {
      try {
        const prefs = await darwinAPI.ui.getPrefs();
        if (prefs) {
          form.setFieldValue("openrouterApiKey", prefs.openrouterApiKey ?? "");
          form.setFieldValue("openaiApiKey", prefs.openaiApiKey ?? "");
          form.setFieldValue("ollamaApiBaseUrl", prefs.ollamaApiBaseUrl ?? "");
          form.setFieldValue("vllmApiBaseUrl", prefs.vllmApiBaseUrl ?? "");
          form.setFieldValue("vllmApiKey", prefs.vllmApiKey ?? "");
          form.setFieldValue("summaryProvider", prefs.summaryProvider ?? "openai");
          form.setFieldValue("summaryModel", prefs.summaryModel ?? "openai/gpt-4o-mini");
          form.setFieldValue("evolveProvider", prefs.evolveProvider ?? "openai");
          form.setFieldValue("evolveModel", prefs.evolveModel ?? "anthropic/claude-sonnet-4");
          form.setFieldValue("maxIterations", prefs.maxIterations ?? DEFAULT_MAX_ITERATIONS);
          form.setFieldValue("maxBuildAttempts", prefs.maxBuildAttempts ?? 5);
          form.setFieldValue("sendDiagnostics", prefs.sendDiagnostics ?? false);

          setOpenrouterKeyStatus(prefs.openrouterApiKey ? "valid" : "idle");
          setOpenaiKeyStatus(prefs.openaiApiKey ? "valid" : "idle");
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      }
    };
    if (isOpen) {
      loadPrefs();
    }
  }, [isOpen, form]);

  const handleRefreshHosts = async () => {
    try {
      const hs = await darwinAPI.flake.listHosts();
      setHosts(hs);
    } catch (e) {
      console.error("Failed to refresh hosts:", e);
    }
  };

  const hasFlake = hosts.length > 0;

  if (!isOpen) return null;

  return (
    <Suspense fallback={<div>loading...</div>}>
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
                active={activeTab === "api-keys"}
                icon={<Key className="h-4 w-4" />}
                label="API Keys"
                onClick={() => setActiveTab("api-keys")}
              />
              <NavItem
                active={activeTab === "preferences"}
                icon={<SlidersHorizontal className="h-4 w-4" />}
                label="Preferences"
                onClick={() => setActiveTab("preferences")}
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
              <form.Field name="sendDiagnostics">
                {(sendDiagnosticsField) => (
                  <GeneralTab
                    configDir={configDir}
                    handleRefreshHosts={handleRefreshHosts}
                    hasFlake={hasFlake}
                    host={host}
                    hosts={hosts}
                    saveHost={saveHost}
                    sendDiagnosticsField={sendDiagnosticsField}
                    setSettingsOpen={setSettingsOpen}
                  />
                )}
              </form.Field>
            )}

            {activeTab === "api-keys" && (
              <form.Field name="openrouterApiKey">
                {(openrouterApiKeyField) => (
                  <form.Field name="openaiApiKey">
                    {(openaiApiKeyField) => (
                      <form.Field name="ollamaApiBaseUrl">
                        {(ollamaApiBaseUrlField) => (
                          <form.Field name="vllmApiBaseUrl">
                            {(vllmApiBaseUrlField) => (
                              <form.Field name="vllmApiKey">
                                {(vllmApiKeyField) => (
                                  <ApiKeysTab
                                    openrouterApiKeyField={openrouterApiKeyField}
                                    openrouterKeyStatus={openrouterKeyStatus}
                                    verifyOpenrouterKey={verifyOpenrouterKey}
                                    openrouterTimeoutRef={openrouterTimeoutRef}
                                    openaiApiKeyField={openaiApiKeyField}
                                    openaiKeyStatus={openaiKeyStatus}
                                    verifyOpenaiKey={verifyOpenaiKey}
                                    openaiTimeoutRef={openaiTimeoutRef}
                                    ollamaApiBaseUrlField={ollamaApiBaseUrlField}
                                    onSaveOllamaUrl={saveOllamaUrl}
                                    vllmApiBaseUrlField={vllmApiBaseUrlField}
                                    vllmApiKeyField={vllmApiKeyField}
                                    onSaveVllmUrl={saveVllmUrl}
                                    onSaveVllmKey={saveVllmKey}
                                    form={form}
                                  />
                                )}
                              </form.Field>
                            )}
                          </form.Field>
                        )}
                      </form.Field>
                    )}
                  </form.Field>
                )}
              </form.Field>
            )}

            {activeTab === "preferences" && <PreferencesTab />}

            {activeTab === "ai-models" && (
              <form.Field name="evolveProvider">
                {(evolveProviderField) => (
                  <form.Field name="evolveModel">
                    {(evolveModelField) => (
                      <form.Field name="summaryProvider">
                        {(summaryProviderField) => (
                          <form.Field name="summaryModel">
                            {(summaryModelField) => (
                              <form.Field name="maxIterations">
                                {(maxIterationsField) => (
                                  <form.Field name="maxBuildAttempts">
                                    {(maxBuildAttemptsField) => (
                                      <AiModelsTab
                                        evolveModelField={evolveModelField}
                                        evolveProviderField={evolveProviderField}
                                        form={form}
                                        summaryModelField={summaryModelField}
                                        summaryProviderField={summaryProviderField}
                                        maxIterationsField={maxIterationsField}
                                        maxBuildAttemptsField={maxBuildAttemptsField}
                                      />
                                    )}
                                  </form.Field>
                                )}
                              </form.Field>
                            )}
                          </form.Field>
                        )}
                      </form.Field>
                    )}
                  </form.Field>
                )}
              </form.Field>
            )}
          </div>
        </div>
      </div>
    </Suspense>
  );
}
