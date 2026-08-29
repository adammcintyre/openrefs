import { useTheme } from "../lib/theme";

/**
 * Light/dark switch. Placeholder glyphs — the design-system agent owns the
 * icon set; this only needs to be legible and accessible until then.
 */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const nextLabel = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${nextLabel} mode`}
      title={`Switch to ${nextLabel} mode`}
      className="inline-flex h-9 w-9 items-center justify-center rounded-app border border-border bg-surface text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
    >
      <span aria-hidden="true" className="text-sm leading-none">
        {theme === "dark" ? "☾" : "☀"}
      </span>
    </button>
  );
}
