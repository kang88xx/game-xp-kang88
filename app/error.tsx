"use client";

// Route-level error boundary — wallet/provider/render failures land here
// instead of the unbranded Next.js crash screen.
export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-2xl">
        ⚠
      </span>
      <h1 className="mt-5 text-xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        The page hit an unexpected error. Your funds and on-chain state are
        unaffected — try again, or refresh the page.
      </p>
      <button
        onClick={reset}
        className="mt-6 min-h-11 rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
      >
        Try again
      </button>
    </div>
  );
}
