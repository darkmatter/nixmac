import type { TelemetryProvider } from "./types";

interface BootstrapWithTelemetryOptions {
  initTelemetry: () => Promise<TelemetryProvider>;
  getTelemetry: () => TelemetryProvider;
  render: (telemetry: TelemetryProvider) => void | Promise<void>;
  environment: string;
  onTelemetryError?: (phase: "initialize" | "capture", error: unknown) => void;
}

export async function bootstrapWithTelemetry({
  initTelemetry,
  getTelemetry,
  render,
  environment,
  onTelemetryError = () => {},
}: BootstrapWithTelemetryOptions): Promise<void> {
  let telemetry: TelemetryProvider;
  try {
    telemetry = await initTelemetry();
  } catch (error) {
    onTelemetryError("initialize", error);
    telemetry = getTelemetry();
  }

  try {
    telemetry.captureEvent({
      name: "app_launched",
      props: { environment },
    });
  } catch (error) {
    onTelemetryError("capture", error);
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
    onTelemetryError("render-error", reportingError);
  }
}
