import { Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnyFieldApi, AnyFormApi } from "@tanstack/react-form";

type ApiKeyStatus = "idle" | "verifying" | "valid" | "invalid";

interface ApiKeysTabProps {
  // OpenRouter
  openrouterApiKeyField: AnyFieldApi;
  openrouterKeyStatus: ApiKeyStatus;
  verifyOpenrouterKey: (key: string) => Promise<void>;
  openrouterTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
  // OpenAI
  openaiApiKeyField: AnyFieldApi;
  openaiKeyStatus: ApiKeyStatus;
  verifyOpenaiKey: (key: string) => Promise<void>;
  openaiTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
  // Ollama
  ollamaApiBaseUrlField: AnyFieldApi;
  onSaveOllamaUrl: (url: string) => Promise<void>;
  // Form
  form: AnyFormApi;
}

function ApiKeyInput({
  id,
  label,
  description,
  linkText,
  linkHref,
  placeholder,
  field,
  status,
  verifyKey,
  timeoutRef,
  form,
}: {
  id: string;
  label: string;
  description: string;
  linkText: string;
  linkHref: string;
  placeholder: string;
  field: AnyFieldApi;
  status: ApiKeyStatus;
  verifyKey: (key: string) => Promise<void>;
  timeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
  form: AnyFormApi;
}) {
  return (
    <div className="space-y-2">
      <label className="font-medium text-sm" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          className={cn(
            "w-full rounded-md border bg-background px-3 py-2 pr-10 font-mono text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50",
            status === "valid"
              ? "border-green-500"
              : status === "invalid"
                ? "border-red-500"
                : "border-border",
          )}
          onBlur={field.handleBlur}
          onChange={(e) => {
            field.handleChange(e.target.value);
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
            }
            timeoutRef.current = setTimeout(() => verifyKey(e.target.value), 500);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              form.handleSubmit();
            }
          }}
          placeholder={placeholder}
          type="password"
          value={field.state.value}
        />
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
          {status === "verifying" && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
          {status === "valid" && (
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500">
              <Check className="h-3 w-3 text-white" />
            </div>
          )}
          {status === "invalid" && (
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500">
              <X className="h-3 w-3 text-white" />
            </div>
          )}
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        {description}{" "}
        <a
          className="text-primary underline hover:no-underline"
          href={linkHref}
          rel="noopener noreferrer"
          target="_blank"
        >
          {linkText}
        </a>
      </p>
      {status === "invalid" && (
        <p className="text-red-500 text-xs">Invalid API key. Please check and try again.</p>
      )}
      {status === "valid" && <p className="text-green-600 text-xs">API key verified and saved.</p>}
    </div>
  );
}

function UrlInput({
  id,
  label,
  description,
  placeholder,
  field,
  form,
  onSave,
}: {
  id: string;
  label: string;
  description: string;
  placeholder: string;
  field: AnyFieldApi;
  form: AnyFormApi;
  onSave: (value: string) => Promise<void>;
}) {
  return (
    <div className="space-y-2">
      <label className="font-medium text-sm" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={cn(
          "w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50",
        )}
        onBlur={(e) => {
          field.handleBlur();
          onSave(e.target.value);
        }}
        onChange={(e) => {
          field.handleChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            form.handleSubmit();
          }
        }}
        placeholder={placeholder}
        type="text"
        value={field.state.value}
      />
      <p className="text-muted-foreground text-xs">{description}</p>
    </div>
  );
}

export function ApiKeysTab({
  openrouterApiKeyField,
  openrouterKeyStatus,
  verifyOpenrouterKey,
  openrouterTimeoutRef,
  openaiApiKeyField,
  openaiKeyStatus,
  verifyOpenaiKey,
  openaiTimeoutRef,
  ollamaApiBaseUrlField,
  onSaveOllamaUrl,
  form,
}: ApiKeysTabProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-4 font-semibold text-base">API Keys</h2>
        <div className="space-y-6">
          {/* OpenRouter API Key */}
          <div className="rounded-lg border border-border p-4">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-purple-500 to-pink-500">
                <span className="font-bold text-white text-xs">OR</span>
              </div>
              <div>
                <h3 className="font-medium text-sm">OpenRouter</h3>
                <p className="text-muted-foreground text-xs">
                  Access 100+ models through a single API
                </p>
              </div>
            </div>
            <ApiKeyInput
              id="openrouterApiKey"
              label="API Key"
              description="Recommended for accessing multiple AI models."
              linkText="Get an API key →"
              linkHref="https://openrouter.ai/keys"
              placeholder="sk-or-..."
              field={openrouterApiKeyField}
              status={openrouterKeyStatus}
              verifyKey={verifyOpenrouterKey}
              timeoutRef={openrouterTimeoutRef}
              form={form}
            />
          </div>

          {/* OpenAI API Key */}
          <div className="rounded-lg border border-border p-4">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-black">
                <span className="font-bold text-white text-xs">AI</span>
              </div>
              <div>
                <h3 className="font-medium text-sm">OpenAI</h3>
                <p className="text-muted-foreground text-xs">
                  Direct access to OpenAI models (GPT-4, etc.)
                </p>
              </div>
            </div>
            <ApiKeyInput
              id="openaiApiKey"
              label="API Key"
              description="For direct OpenAI access without OpenRouter."
              linkText="Get an API key →"
              linkHref="https://platform.openai.com/api-keys"
              placeholder="sk-..."
              field={openaiApiKeyField}
              status={openaiKeyStatus}
              verifyKey={verifyOpenaiKey}
              timeoutRef={openaiTimeoutRef}
              form={form}
            />
          </div>

          {/* Ollama API Base URL */}
          <div className="rounded-lg border border-border p-4">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-amber-500 to-orange-500">
                <span className="font-bold text-white text-xs">OL</span>
              </div>
              <div>
                <h3 className="font-medium text-sm">Ollama</h3>
                <p className="text-muted-foreground text-xs">
                  Local AI models running on your machine
                </p>
              </div>
            </div>
            <UrlInput
              id="ollamaApiBaseUrl"
              label="API Base URL"
              description="The URL where your Ollama instance is running."
              placeholder="http://localhost:11434"
              field={ollamaApiBaseUrlField}
              form={form}
              onSave={onSaveOllamaUrl}
            />
          </div>

          {/* Info box */}
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-muted-foreground text-xs">
              <strong className="text-foreground">Tip:</strong> OpenRouter is recommended as it
              provides access to multiple AI providers (OpenAI, Anthropic, Google, etc.) through a
              single API key. If you have both keys configured, OpenRouter will be used by default.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
