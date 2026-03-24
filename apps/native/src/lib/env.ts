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
