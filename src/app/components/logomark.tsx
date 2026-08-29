/**
 * OpenRefs logomark — three nested leaf outlines, read either as a leaf or as
 * growth rings in cross-section ("references accumulating over time").
 *
 * Drawn as filled concentric shapes rather than strokes so it survives being
 * scaled to 16px: at that size a 1px stroke would alias away, whereas nested
 * fills keep three distinct bands. Geometry is a symmetric vesica (pointed top
 * and bottom) tilted 14 degrees so it reads as foliage rather than an eye.
 *
 * Colours come from --logo-1..3, which invert in dark mode so the outermost
 * ring — the one carrying the silhouette — always contrasts with the page.
 */
export function Logomark({
  size = 24,
  className = "",
  title,
}: {
  size?: number;
  className?: string;
  /** Supply only when the mark is the sole label; otherwise it stays decorative. */
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <g transform="rotate(-14 16 16)">
        <path
          d="M16 4C23.4 10 23.4 22 16 28C8.6 22 8.6 10 16 4Z"
          fill="var(--logo-1)"
        />
        <path
          d="M16 9.3C20.2 12.6 20.2 19.4 16 22.7C11.8 19.4 11.8 12.6 16 9.3Z"
          fill="var(--logo-2)"
        />
        <path
          d="M16 13.1C17.8 14.6 17.8 17.4 16 18.9C14.2 17.4 14.2 14.6 16 13.1Z"
          fill="var(--logo-3)"
        />
      </g>
    </svg>
  );
}
