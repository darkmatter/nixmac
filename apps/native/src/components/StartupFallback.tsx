export function StartupFallback() {
  return (
    <div
      style={{
        alignItems: "center",
        background: "#0a0a0a",
        color: "#f4f4f5",
        display: "flex",
        height: "100vh",
        justifyContent: "center",
        width: "100vw",
      }}
    >
      <div
        role="alert"
        style={{
          background: "#27272a",
          border: "1px solid #52525b",
          borderRadius: 12,
          boxShadow: "0 18px 50px rgba(0, 0, 0, 0.45)",
          maxWidth: 460,
          padding: "24px 28px",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>nixmac could not render</div>
        <div style={{ color: "#d4d4d8", fontSize: 13, lineHeight: 1.5 }}>
          The app shell hit a startup error. Diagnostic breadcrumbs were recorded for this run.
        </div>
      </div>
    </div>
  );
}
