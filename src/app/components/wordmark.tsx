import { APP_NAME } from "../lib/constants";
import { Logomark } from "./logomark";

/**
 * Logomark + name lock-up. The mark is decorative here because the name is
 * right beside it — screen readers would otherwise announce "OpenRefs" twice.
 *
 * `markSize` is in px rather than an em-relative unit: the mark's inner rings
 * are tuned for a small pixel range, and letting it scale freely with the type
 * size blurs them.
 */
export function Wordmark({
  className = "",
  showMark = true,
  markSize = 22,
}: {
  className?: string;
  showMark?: boolean;
  markSize?: number;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {showMark ? <Logomark size={markSize} /> : null}
      <span className="font-semibold tracking-tight">
        <span className="text-primary">Open</span>
        <span className="text-foreground">{APP_NAME.slice("Open".length)}</span>
      </span>
    </span>
  );
}
