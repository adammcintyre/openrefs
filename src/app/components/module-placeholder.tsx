import type { LucideIcon } from "lucide-react";

import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import { PageHeader } from "./ui/page-header";

/**
 * The screen every unbuilt module renders.
 *
 * Says what the module will do and which docs/PLAN.md phase builds it, so the
 * sidebar is explorable before the features exist and nobody has to guess
 * whether a blank screen is a bug.
 */
export function ModulePlaceholder({
  icon: Icon,
  title,
  description,
  phase,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  phase: number;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={title}
        description={description}
        actions={<Badge variant="info">Arrives in Phase {phase}</Badge>}
      />

      <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-tint">
          <Icon className="size-5 text-tint-foreground" aria-hidden="true" />
        </span>
        <p className="text-sm font-semibold text-foreground">
          Not built yet
        </p>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          This module is scheduled for phase {phase} of the build plan. The
          navigation entry is here already so the shape of the product is
          visible while it is assembled.
        </p>
      </Card>
    </div>
  );
}
