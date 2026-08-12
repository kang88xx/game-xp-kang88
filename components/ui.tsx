// Shared IOI / Pharos design-system primitives.

type DotColor = "blue" | "red" | "yellow" | "orange" | "cyan" | "purple";

/** Small sentence-case section label with a leading colored square dot. */
export function Eyebrow({
  children,
  dot = "blue",
  className = "",
}: {
  children: React.ReactNode;
  dot?: DotColor;
  className?: string;
}) {
  return (
    <div className={`eyebrow ${className}`}>
      <span className={`bdot ${dot !== "blue" ? `bdot--${dot}` : ""}`} />
      {children}
    </div>
  );
}

/**
 * The signature arrow chip — a small square attached to pill buttons.
 * `variant` controls the chip fill so it reads on light, dark, or blue buttons.
 */
export function ArrowChip({
  variant = "onLight",
}: {
  variant?: "onLight" | "onAccent";
}) {
  const cls =
    variant === "onAccent"
      ? "bg-black/15 text-[var(--on-accent)] group-hover:bg-black/25"
      : "bg-[var(--accent)] text-[var(--on-accent)] group-hover:bg-[var(--accent-hover)]";
  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded-[7px] transition-colors duration-150 ${cls}`}
    >
      <svg
        className="transition-transform duration-150 ease-out group-hover:translate-x-[1.5px] group-hover:-translate-y-[1.5px]"
        width="15"
        height="15"
        viewBox="0 0 16 16"
        fill="none"
      >
        <path
          d="M5 11 L11 5 M6 5 H11 V10"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="square"
        />
      </svg>
    </span>
  );
}
