import { ComingSoon } from "../../components/coming-soon";

/**
 * Owned wholesale by the Keyword Research UI agent — replace this placeholder
 * with the module root (internal routes for search, results, collections) per
 * docs/specs/PHASE1.md. The route tree mounts it at /app/keyword-research/*
 * so all sub-routing happens inside this module.
 */
export function KeywordResearchModule() {
  return (
    <ComingSoon
      title="Keyword Research"
      description="Search any keyword to see volume, difficulty, intent, and who ranks for it — then save winners to collections."
      phase={1}
    />
  );
}
