import { APP_NAME } from "../lib/constants";

/** Text wordmark. No logo asset yet — the design agent replaces this. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-semibold tracking-tight ${className}`}>
      <span className="text-primary">Open</span>
      <span className="text-foreground">{APP_NAME.slice("Open".length)}</span>
    </span>
  );
}
