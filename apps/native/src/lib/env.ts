// Helper to resolve the public website URL used by the native/web apps.
// Prefers the Vite env var `VITE_SERVER_URL` when available, otherwise
// falls back to a localhost URL for local development.
// TODO: Update the fallback to the main nixmac website before release.
export function getWebSiteUrl(): string {
  return (
    // Vite exposes env vars via `import.meta.env` and VITE_ prefix
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    import.meta.env?.VITE_SERVER_URL || "http://localhost:3001"
  );
}


// Feedback ingestion endpoint with a simple DSN-like component for basic
// authentication. Sentry-inspired, e.g. no auth required but
// the DSN has to be known to the client to post feedback. This allows the native client
// to post feedback without needing a full auth flow.
export const FEEDBACK_DSN = "dsn_6f4b9a5e8c2d4f1a9b3c7e2d5a1f0b4c";

export function getFeedbackUrl(): string {
  return `${getWebSiteUrl()}/api/feedback/${FEEDBACK_DSN}`;
}
