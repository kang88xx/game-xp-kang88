// Stub for optional dependencies that are dynamically imported but unused.
// `@wagmi/core`'s Tempo wallet connector does `await import('accounts')`
// behind a runtime .catch() — Turbopack treats the unresolved specifier as a
// hard error, so we alias it here. We never use the Tempo connector (BSC only).
export {};
