import { Button } from "@/components/ui/button";
import { AccountTab } from "@/components/widget/settings/account-tab";
import { AiModelsTab } from "@/components/widget/settings/ai-models-tab";
import { ApiKeysTab } from "@/components/widget/settings/api-keys-tab";
import { DeveloperTab } from "@/components/widget/settings/developer-tab";
import { GeneralTab } from "@/components/widget/settings/general-tab";
import { PermissionsTab } from "@/components/widget/settings/permissions-tab";
import { PreferencesTab } from "@/components/widget/settings/preferences-tab";
import { TuningTab } from "@/components/widget/settings/tuning-tab";
import { useDarwinConfig } from "@/hooks/use-darwin-config";
import { tauriAPI } from "@/ipc/api";
import { modelForProvider } from "@/lib/providers/ai-models";
import { resolveOpenAiCompatibleProvider } from "@/lib/providers/ai-provider-validation";
import {
  createVerifiedApiKeyHandler,
  verifyOpenaiApiKey,
  verifyOpenrouterApiKey,
  type ApiKeyStatus,
} from "@/lib/providers/api-key-verification";
import { cn } from "@/lib/utils";
import { refreshHostsSnapshot } from "@/viewmodel/preferences";
import { useViewModel, type SettingsTab } from "@nixmac/state";
import { useForm } from "@tanstack/react-form";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { nav } from "@/router";
import {
  Bot,
  FolderOpen,
  Key,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  UserCircle2,
  Wrench,
} from "lucide-react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";

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
  const settingsActiveTab = useSearch({ from: "/settings" }).tab;
  const navigate = useNavigate({ from: "/settings" });
  const configDir = useViewModel((s) => s.preferences?.configDir ?? "");
  const hosts = useViewModel((s) => s.hosts);
  const host = useViewModel((s) => s.preferences?.hostAttr ?? "");
  const developerMode = useViewModel((s) => s.preferences?.developerMode ?? false);
  const activeTab: SettingsTab = settingsActiveTab ?? "general";

  // If developer mode is turned off while the developer tab is active, fall back to General.
  useEffect(() => {
    if (!developerMode && activeTab === "developer") {
      navigate({ search: { tab: "general" } });
    }
  }, [developerMode, activeTab, navigate]);

  const setActiveTab = (tab: SettingsTab) => navigate({ search: { tab } });
  const [openrouterKeyStatus, setOpenrouterKeyStatus] = useState<ApiKeyStatus>("idle");
  const [openaiKeyStatus, setOpenaiKeyStatus] = useState<ApiKeyStatus>("idle");
  const openrouterTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const openaiTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { saveHost } = useDarwinConfig();

  const verifyOpenrouterKey = useMemo(
    () =>
      createVerifiedApiKeyHandler({
        saveKey: async (key) => {
          // deprecated(orpc): replace with client/orpc from @/lib/orpc
          await tauriAPI.ui.setPrefs({ openrouterApiKey: key });
        },
        setStatus: setOpenrouterKeyStatus,
        verifyKey: verifyOpenrouterApiKey,
      }),
    [],
  );

  const verifyOpenaiKey = useMemo(
    () =>
      createVerifiedApiKeyHandler({
        saveKey: async (key) => {
          // deprecated(orpc): replace with client/orpc from @/lib/orpc
          await tauriAPI.ui.setPrefs({ openaiApiKey: key });
        },
        setStatus: setOpenaiKeyStatus,
        verifyKey: verifyOpenaiApiKey,
      }),
    [],
  );

  const saveOllamaUrl = async (url: string) => {
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    await tauriAPI.ui.setPrefs({ ollamaApiBaseUrl: url });
    // Clear cached Ollama models when the base URL changes
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    await tauriAPI.models.clearCached("ollama");
  };

  const saveOpenaiCompatibleUrl = async (url: string) => {
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    await tauriAPI.ui.setPrefs({ openaiCompatibleApiBaseUrl: url });
    // Clear cached OpenAI-compatible models when the endpoint changes.
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    await tauriAPI.models.clearCached("vllm");
  };

  const saveOpenaiCompatibleKey = async (key: string) => {
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    await tauriAPI.ui.setPrefs({ openaiCompatibleApiKey: key });
    // Clear cached OpenAI-compatible models because auth can change visible models.
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    await tauriAPI.models.clearCached("vllm");
  };

  const form = useForm({
    defaultValues: {
      openrouterApiKey: "",
      openaiApiKey: "",
      ollamaApiBaseUrl: "",
      openaiCompatibleApiBaseUrl: "",
      openaiCompatibleApiKey: "",
      summaryProvider: "openrouter",
      summaryModel: "",
      evolveProvider: "openrouter",
      evolveModel: "",
      sendDiagnostics: false,
    },
  });

  // Load initial values when the settings route is active (mounts the component)
  // biome-ignore lint/correctness/useExhaustiveDependencies: initial load only
  useEffect(() => {
    const loadPrefs = async () => {
      try {
        // deprecated(orpc): replace with client/orpc from @/lib/orpc
        const prefs = await tauriAPI.ui.getPrefs();
        if (prefs) {
          const summaryProvider = resolveOpenAiCompatibleProvider(prefs.summaryProvider, prefs);
          const evolveProvider = resolveOpenAiCompatibleProvider(prefs.evolveProvider, prefs);

          form.setFieldValue("openrouterApiKey", prefs.openrouterApiKey ?? "");
          form.setFieldValue("openaiApiKey", prefs.openaiApiKey ?? "");
          form.setFieldValue("ollamaApiBaseUrl", prefs.ollamaApiBaseUrl ?? "");
          form.setFieldValue("openaiCompatibleApiBaseUrl", prefs.openaiCompatibleApiBaseUrl ?? "");
          form.setFieldValue("openaiCompatibleApiKey", prefs.openaiCompatibleApiKey ?? "");
          form.setFieldValue("summaryProvider", summaryProvider);
          // Empty model is a real state (track the provider default) — don't
          // dress it up as a concrete value.
          form.setFieldValue(
            "summaryModel",
            modelForProvider(prefs.summaryModels, prefs.summaryProvider),
          );
          form.setFieldValue("evolveProvider", evolveProvider);
          form.setFieldValue(
            "evolveModel",
            modelForProvider(prefs.evolveModels, prefs.evolveProvider),
          );
          form.setFieldValue("sendDiagnostics", prefs.sendDiagnostics ?? false);

          setOpenrouterKeyStatus(prefs.openrouterApiKey ? "valid" : "idle");
          setOpenaiKeyStatus(prefs.openaiApiKey ? "valid" : "idle");
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      }
    };
    loadPrefs();
  }, [form]);

  const handleRefreshHosts = async () => {
    await refreshHostsSnapshot();
  };

  const hasFlake = hosts.length > 0;

  return (
    <Suspense fallback={<div>loading...</div>}>
      <div className="fixed inset-0 z-40 flex items-center justify-center" data-tauri-no-drag>
        <button
          aria-label="Close settings"
          className="absolute inset-0 bg-black/40"
          onClick={() => nav.closeSettings()}
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
                active={activeTab === "account"}
                icon={<UserCircle2 className="h-4 w-4" />}
                label="Account"
                onClick={() => setActiveTab("account")}
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
              <NavItem
                active={activeTab === "permissions"}
                icon={<ShieldCheck className="h-4 w-4" />}
                label="Permissions"
                onClick={() => setActiveTab("permissions")}
              />
              <NavItem
                active={activeTab === "tuning"}
                icon={<SlidersHorizontal className="h-4 w-4" />}
                label="Tuning"
                onClick={() => setActiveTab("tuning")}
              />
              {developerMode && (
                <NavItem
                  active={activeTab === "developer"}
                  icon={<Wrench className="h-4 w-4" />}
                  label="Developer"
                  onClick={() => setActiveTab("developer")}
                />
              )}
            </nav>
            <div className="mt-auto">
              <Button
                className="w-full"
                onClick={() => nav.closeSettings()}
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
                    setSettingsOpen={(open: boolean) => {
                      if (!open) nav.closeSettings();
                    }}
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
                          <form.Field name="openaiCompatibleApiBaseUrl">
                            {(openaiCompatibleApiBaseUrlField) => (
                              <form.Field name="openaiCompatibleApiKey">
                                {(openaiCompatibleApiKeyField) => (
                                  <ApiKeysTab
                                    form={form}
                                    ollamaApiBaseUrlField={ollamaApiBaseUrlField}
                                    openaiKeyStatus={openaiKeyStatus}
                                    openaiTimeoutRef={openaiTimeoutRef}
                                    onSaveOllamaUrl={saveOllamaUrl}
                                    onSaveOpenaiCompatibleKey={saveOpenaiCompatibleKey}
                                    onSaveOpenaiCompatibleUrl={saveOpenaiCompatibleUrl}
                                    openaiApiKeyField={openaiApiKeyField}
                                    openrouterApiKeyField={openrouterApiKeyField}
                                    openrouterKeyStatus={openrouterKeyStatus}
                                    openrouterTimeoutRef={openrouterTimeoutRef}
                                    verifyOpenaiKey={verifyOpenaiKey}
                                    verifyOpenrouterKey={verifyOpenrouterKey}
                                    openaiCompatibleApiBaseUrlField={openaiCompatibleApiBaseUrlField}
                                    openaiCompatibleApiKeyField={openaiCompatibleApiKeyField}
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

            {activeTab === "account" && <AccountTab />}

            {activeTab === "preferences" && <PreferencesTab />}

            {activeTab === "permissions" && <PermissionsTab />}

            {activeTab === "tuning" && <TuningTab />}

            {activeTab === "developer" && developerMode && <DeveloperTab />}

            {activeTab === "ai-models" && (
              <form.Field name="evolveProvider">
                {(evolveProviderField) => (
                  <form.Field name="evolveModel">
                    {(evolveModelField) => (
                      <form.Field name="summaryProvider">
                        {(summaryProviderField) => (
                          <form.Field name="summaryModel">
                            {(summaryModelField) => (
                              <AiModelsTab
                                evolveModelField={evolveModelField}
                                evolveProviderField={evolveProviderField}
                                form={form}
                                summaryModelField={summaryModelField}
                                summaryProviderField={summaryProviderField}
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
          </div>
        </div>
      </div>
    </Suspense>
  );
}
