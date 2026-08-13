"use client";

// Root error boundary — catches failures in the root layout itself, where
// app/error.tsx can't render. Must supply its own <html>/<body>.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#000",
          color: "#f5f0e8",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: "24px",
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, opacity: 0.7, marginBottom: 20 }}>
            The app hit an unexpected error. Your funds and on-chain state are
            unaffected.
          </p>
          <button
            onClick={reset}
            style={{
              background: "#e7453a",
              color: "#fff",
              border: 0,
              borderRadius: 999,
              padding: "12px 24px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
