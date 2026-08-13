// XPHERE brand assets from the official partner logo SVG.
// Bird glyph keeps its fixed red gradient; the wordmark follows the text
// color (currentColor) so it stays legible in both themes.

const BIRD_PATH =
  "M79.06,65.97c-.4-8.8-11.22-21.85-17.12-28.33-4.1-4.5-9.03-9.33-14.13-13.75,2.58-1.75,5.05-3.23,7.33-4.4,3.83,3.69,6.34,8.8,6.79,14.3,3.4-3.73,6.65-7.64,9.55-11.74,2.66-3.81,5.15-7.78,6.69-12.18C79.83,5.13,79.62.08,73.43,0c-2.11-.02-4.19.46-6.21,1.08-2.44.76-4.8,1.76-7.11,2.87-2.49,1.21-4.9,2.54-7.29,3.98-2.96,1.78-5.82,3.69-8.66,5.72-1.53,1.09-3.07,2.24-4.63,3.44-1.56-1.2-3.1-2.35-4.63-3.44-2.84-2.03-5.7-3.93-8.66-5.72-2.39-1.44-4.8-2.77-7.29-3.98-2.31-1.11-4.67-2.11-7.11-2.87C9.83.46,7.75-.02,5.63,0-.56.08-.77,5.13.9,9.86c1.54,4.4,4.03,8.37,6.69,12.18,2.9,4.11,6.14,8.01,9.55,11.74.46-5.5,2.97-10.61,6.79-14.3,2.28,1.17,4.75,2.65,7.33,4.4-5.09,4.42-10.02,9.25-14.13,13.75-5.52,6.12-10.79,12.59-14.55,19.95-1.54,3.18-3.89,8.55-1.68,11.82,2.61,3.53,9.01,1.62,12.48.42,7.75-2.85,14.79-7.3,21.53-12.05-5.39-1.13-10.14-4.24-13.33-8.5,3.73-5.66,11.03-13.43,17.96-19.12,6.94,5.7,14.22,13.46,17.96,19.12-3.19,4.26-7.94,7.38-13.33,8.5,6.29,4.46,12.85,8.59,20,11.48,4.72,1.93,15,4.9,14.9-3.28h0Z";

function BirdGradient({ id }: { id: string }) {
  return (
    <linearGradient
      id={id}
      x1="77.22"
      y1="-1.17"
      x2="-1.54"
      y2="75.93"
      gradientUnits="userSpaceOnUse"
    >
      <stop offset="0" stopColor="#a8011f" />
      <stop offset="1" stopColor="#bb0022" />
    </linearGradient>
  );
}

/** Bird glyph only — for square icon slots. */
export function XphereMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size * (79.83 / 71.43)}
      height={size}
      viewBox="0 0 79.83 71.43"
      aria-hidden="true"
      className="shrink-0"
    >
      <defs>
        <BirdGradient id="xphere-mark-grad" />
      </defs>
      <path fill="url(#xphere-mark-grad)" d={BIRD_PATH} />
    </svg>
  );
}

/** Full lockup — bird glyph + XPHERE wordmark (wordmark inherits text color).
 *  The wordmark group is shifted +14 units for breathing room after the bird. */
export function XphereLockup({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size * (346.88 / 71.43)}
      height={size}
      viewBox="0 0 346.88 71.43"
      role="img"
      aria-label="Xphere"
      className="shrink-0"
    >
      <defs>
        <BirdGradient id="xphere-lockup-grad" />
      </defs>
      <path fill="url(#xphere-lockup-grad)" d={BIRD_PATH} />
      <g fill="currentColor" transform="translate(14 0)">
        <polygon points="129.53 12.43 121.55 12.43 107.55 35.15 90.85 59.77 98.76 59.77 111.48 41.46 122.9 59.77 130.81 59.77 115.12 35.15 129.53 12.43" />
        <polygon points="100.11 12.43 92.2 12.43 107.55 35.15 111.01 29.54 100.11 12.43" />
        <path d="M154.28,12.43h-17.72v6.42h17.72c5.75,0,8.79,4.26,8.79,8.86s-3.11,8.79-8.79,8.79h-17.72v23.26h6.42v-16.84h11.29c9.54,0,15.49-6.83,15.49-15.22s-5.82-15.28-15.49-15.28Z" />
        <polygon points="206.35 32.92 182.95 32.92 182.95 12.43 176.53 12.43 176.53 37.01 176.53 39.21 176.53 59.77 182.95 59.77 182.95 39.21 206.35 39.21 206.35 59.77 212.84 59.77 212.84 34.52 212.84 32.92 212.84 12.43 206.35 12.43 206.35 32.92" />
        <rect x="221.64" y="12.43" width="31.04" height="6.42" />
        <rect x="221.64" y="53.28" width="31.45" height="6.49" />
        <rect x="221.64" y="32.92" width="28.94" height="6.29" />
        <path d="M293.65,27.71c0-8.45-5.88-15.28-15.49-15.28h-17.72v6.42h17.72c5.68,0,8.86,4.26,8.86,8.86s-3.18,8.79-8.86,8.79h-17.72v23.26h6.49v-16.84h11.16l9.53,16.84h7.37l-10.21-18.12c5.61-2.37,8.86-7.71,8.86-13.93Z" />
        <rect x="301.43" y="12.43" width="31.04" height="6.42" />
        <rect x="301.43" y="32.92" width="31.04" height="6.29" />
        <rect x="301.43" y="53.28" width="31.45" height="6.49" />
      </g>
    </svg>
  );
}
