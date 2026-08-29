/**
 * The themed empty state every unbuilt module renders. Feature agents replace
 * the whole screen, so nothing here is worth preserving except the tokens it
 * demonstrates.
 */
export function ComingSoon({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: number;
}) {
  return (
    <section className="mx-auto flex max-w-xl flex-col items-start gap-4 rounded-app border border-border bg-surface p-8">
      <span className="rounded-full bg-tint px-3 py-1 text-xs font-medium text-tint-foreground">
        Phase {phase}
      </span>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        {title}
      </h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
      <p className="text-sm text-muted-foreground">
        Not built yet. This screen is a placeholder from the Phase 0 scaffold.
      </p>
    </section>
  );
}
