import { SpanStatusCode, type Tracer } from "@opentelemetry/api";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import posthog from "posthog-js";
import { ForwardingSpanProcessor } from "./forwarding-processor";
import {
  preparePostHogEvent,
  sanitizeProps,
  sanitizeTelemetryAttributes,
} from "./sanitize";
import type { TelemetryEvent, TelemetryProvider } from "./types";

export interface TelemetryConfig {
  key: string;
  host: string;
  release: string;
  environment: string;
}

export interface TelemetryInitialState {
  diagnosticsEnabled: boolean;
  productAnalyticsEnabled: boolean;
}

const SERVICE_NAME = "nixmac";
const PRIVACY_SUPER_PROPERTIES = {
  $geoip_disable: true,
  $ip: null,
  $process_person_profile: false,
} as const;
const PRODUCT_ANALYTICS_DISTINCT_ID = "nixmac-product-analytics";

const registerPostHogSuperProperties = (config: TelemetryConfig) => {
  posthog.register({
    ...PRIVACY_SUPER_PROPERTIES,
    environment: config.environment,
    release: config.release,
  });
};

const optInPostHogCapturing = (
  ph: Pick<typeof posthog, "opt_in_capturing">,
) => {
  ph.opt_in_capturing({ captureEventName: false });
};

const postHogCaptureUrl = (host: string) => `${host.replace(/\/$/, "")}/capture/`;

const sendPostHogProductEvent = (
  config: TelemetryConfig,
  name: string,
  props: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
) =>
  fetchImpl(postHogCaptureUrl(config.host), {
    body: JSON.stringify({
      api_key: config.key,
      event: name,
      properties: {
        ...PRIVACY_SUPER_PROPERTIES,
        distinct_id: PRODUCT_ANALYTICS_DISTINCT_ID,
        environment: config.environment,
        release: config.release,
        token: config.key,
        ...props,
      },
    }),
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    method: "POST",
  }).catch(() => undefined);

// OTEL span attributes accept primitives only; coerce everything else to a
// JSON string after sanitization so structured props survive the boundary.
const toAttributeValue = (
  value: unknown,
): string | number | boolean | undefined => {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value === null || value === undefined) {
    return undefined;
  }
  return JSON.stringify(value);
};

const toSpanAttributes = (
  record: Record<string, unknown>,
): Record<string, string | number | boolean> => {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(record)) {
    const coerced = toAttributeValue(v);
    if (coerced !== undefined) {
      out[k] = coerced;
    }
  }
  return out;
};

/**
 * Create the unified telemetry provider.
 *
 * Pipeline:
 * - PostHog (direct): product events, opt-in/out honoured at SDK + flag level
 *   and filtered through an event/property allowlist.
 * - OTEL (WebTracerProvider → ForwardingSpanProcessor → Rust IPC): diagnostics
 *   errors are recorded as ERROR-status spans with recordException(). The Rust
 *   IPC bridge currently scrubs and logs forwarded spans; full span
 *   reconstruction/export is a follow-up.
 *
 * Sanitization runs at the boundary for defense in depth, layered on top of the
 * constrained event taxonomy.
 */
export function createTelemetryProvider(
  config: TelemetryConfig,
  initialState: TelemetryInitialState,
): TelemetryProvider {
  let diagnosticsEnabled = initialState.diagnosticsEnabled;
  let productAnalyticsEnabled = initialState.productAnalyticsEnabled;
  let posthogStarted = false;

  const tracerProvider = new WebTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: SERVICE_NAME,
      [ATTR_SERVICE_VERSION]: config.release,
      "deployment.environment": config.environment,
    }),
    spanProcessors: [new ForwardingSpanProcessor()],
  });

  const tracer: Tracer = tracerProvider.getTracer(SERVICE_NAME, config.release);

  posthog.init(config.key, {
    api_host: config.host,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    ip: false,
    persistence: "localStorage",
    opt_out_capturing_by_default: !productAnalyticsEnabled,
    sanitize_properties: (props) => sanitizeProps(props),
    loaded: (ph) => {
      if (productAnalyticsEnabled) {
        optInPostHogCapturing(ph);
      } else {
        ph.opt_out_capturing();
      }
    },
  });
  registerPostHogSuperProperties(config);
  posthogStarted = true;

  return {
    get diagnosticsEnabled() {
      return diagnosticsEnabled;
    },

    get productAnalyticsEnabled() {
      return productAnalyticsEnabled;
    },

    captureEvent(event: TelemetryEvent) {
      if (!productAnalyticsEnabled) return;
      const prepared = preparePostHogEvent(event);
      void sendPostHogProductEvent(config, prepared.name, prepared.props);
    },

    captureError(error: Error, context?: Record<string, unknown>) {
      if (!diagnosticsEnabled) return;
      const span = tracer.startSpan(`error.${error.name || "Error"}`);
      if (context) {
        const sanitized = sanitizeTelemetryAttributes(context);
        if (sanitized && typeof sanitized === "object") {
          span.setAttributes(
            toSpanAttributes(sanitized as Record<string, unknown>),
          );
        }
      }
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
      span.end();
    },

    setDiagnosticsEnabled(next: boolean) {
      diagnosticsEnabled = next;
    },

    setProductAnalyticsEnabled(next: boolean) {
      productAnalyticsEnabled = next;
      if (!posthogStarted) return;
      if (next) {
        registerPostHogSuperProperties(config);
        optInPostHogCapturing(posthog);
      } else {
        posthog.opt_out_capturing();
        posthog.reset();
        registerPostHogSuperProperties(config);
      }
    },

    reset() {
      if (posthogStarted) posthog.reset();
    },
  };
}
