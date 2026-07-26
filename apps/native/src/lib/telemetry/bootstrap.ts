import type { TelemetryProvider } from "./types";

const TELEMETRY_INITIALIZATION_TIMEOUT_MS = 5_000;

interface BootstrapWithTelemetryOptions {
  initTelemetry: () => Promise<TelemetryProvider>;
  getTelemetry: () => TelemetryProvider;
  setTelemetry: (telemetry: TelemetryProvider) => void;
  render: (telemetry: TelemetryProvider) => void | Promise<void>;
  environment: string;
  onTelemetryError?: (phase: "initialize" | "capture", error: unknown) => void;
}

async function initializeTelemetryWithDeadline(
  initTelemetry: () => Promise<TelemetryProvider>,
): Promise<TelemetryProvider> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const initialization = Promise.resolve().then(initTelemetry);
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(
        new Error(
          `Telemetry initialization timed out after ${TELEMETRY_INITIALIZATION_TIMEOUT_MS}ms`,
        ),
      );
    }, TELEMETRY_INITIALIZATION_TIMEOUT_MS);
  });

  try {
    return await Promise.race([initialization, deadline]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function notifyTelemetryError<TPhase extends string>(
  callback: (phase: TPhase, error: unknown) => void,
  phase: TPhase,
  error: unknown,
): void {
  try {
    callback(phase, error);
  } catch {
    // Diagnostics must never become an application availability dependency.
  }
}

export async function bootstrapWithTelemetry({
  initTelemetry,
  getTelemetry,
  setTelemetry,
  render,
  environment,
  onTelemetryError = () => {},
}: BootstrapWithTelemetryOptions): Promise<void> {
  let telemetry: TelemetryProvider;
  try {
    telemetry = await initializeTelemetryWithDeadline(initTelemetry);
  } catch (error) {
    notifyTelemetryError(onTelemetryError, "initialize", error);
    telemetry = getTelemetry();
  }
  setTelemetry(telemetry);

  try {
    telemetry.captureEvent({
      name: "app_launched",
      props: { environment },
    });
  } catch (error) {
    notifyTelemetryError(onTelemetryError, "capture", error);
  }

  await render(telemetry);
}

interface CaptureBootstrapRenderErrorOptions {
  error: unknown;
  getTelemetry: () => TelemetryProvider;
  onTelemetryError?: (phase: "render-error", error: unknown) => void;
}

export function captureBootstrapRenderError({
  error,
  getTelemetry,
  onTelemetryError = () => {},
}: CaptureBootstrapRenderErrorOptions): void {
  try {
    getTelemetry().captureError(error instanceof Error ? error : new Error(String(error)), {
      name: "render-fatal",
    });
  } catch (reportingError) {
    notifyTelemetryError(onTelemetryError, "render-error", reportingError);
  }
}
