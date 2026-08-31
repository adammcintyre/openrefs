import {
  ChartLine,
  ClipboardCheck,
  Compass,
  GitCompareArrows,
  Globe,
  LayoutDashboard,
  Link2,
  Search,
  Settings,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The sidebar, and the source of truth for which routes exist inside /app.
 * Order follows docs/ARCHITECTURE.md "Product structure": ad-hoc research
 * tools first, then the project-scoped modules.
 *
 * Adding a module means adding an entry here and a real element in
 * routes/index.tsx — nothing else needs to change.
 */
export interface NavItem {
  /** Path segment below /app. Empty string is the index route (Dashboard). */
  segment: string;
  label: string;
  /** Shown on the module's placeholder screen. */
  description: string;
  /** Which docs/PLAN.md phase builds it. */
  phase: number;
  /** Has a real route today, rather than the ComingSoon placeholder. */
  live: boolean;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Sits above the grouped sections, on its own. */
export const DASHBOARD_ITEM: NavItem = {
  segment: "",
  label: "Dashboard",
  description: "Workspace activity, recent research and spend at a glance.",
  phase: 1,
  live: true,
  icon: LayoutDashboard,
};

/** Sits below them, pinned to the bottom of the sidebar. */
export const SETTINGS_ITEM: NavItem = {
  segment: "settings",
  label: "Settings",
  description:
    "Members and roles, API keys, your DataForSEO credentials and the workspace spend cap.",
  phase: 0,
  live: true,
  icon: Settings,
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Research",
    items: [
      {
        segment: "keyword-research",
        label: "Keyword Research",
        description:
          "Search volume, history, difficulty, intent and CPC, plus ideas, related terms and suggestions.",
        phase: 1,
        live: true,
        icon: Search,
      },
      {
        segment: "domain-overview",
        label: "Domain Overview",
        description:
          "Traffic estimate, Domain Score, top organic keywords, top pages and competitors for any domain.",
        phase: 1,
        live: true,
        icon: Globe,
      },
      {
        segment: "backlinks",
        label: "Backlinks",
        description:
          "Referring domains, anchors, new and lost links, and history for any target.",
        phase: 2,
        live: true,
        icon: Link2,
      },
      {
        segment: "gap-analysis",
        label: "Gap Analysis",
        description:
          "Keywords your competitors rank for and you do not, across multiple domains.",
        phase: 2,
        live: true,
        icon: GitCompareArrows,
      },
      {
        segment: "content-discovery",
        label: "Content Discovery",
        description:
          "Topic search enriched with traffic estimates and referring domains, filtered for low competition.",
        phase: 7,
        live: true,
        icon: Compass,
      },
    ],
  },
  {
    label: "Projects",
    items: [
      {
        segment: "rank-tracking",
        label: "Rank Tracking",
        description:
          "Daily positions for tracked keywords by device and location, with movers and SERP features.",
        phase: 3,
        live: true,
        icon: TrendingUp,
      },
      {
        segment: "site-audit",
        label: "Site Audit",
        description:
          "Crawl your site for speed, indexability, metadata, duplicates, links and structured data issues.",
        phase: 4,
        live: true,
        icon: ClipboardCheck,
      },
      {
        segment: "search-console",
        label: "Search Console",
        description:
          "Bind a Google property and surface striking-distance, low-CTR and cannibalisation reports.",
        phase: 5,
        live: true,
        icon: ChartLine,
      },
      {
        segment: "ai-visibility",
        label: "AI Visibility",
        description:
          "Track whether AI engines mention and cite your site across a set of prompts.",
        phase: 6,
        live: true,
        icon: Sparkles,
      },
    ],
  },
];

/**
 * Flattened, for route generation. Order matters only in that every routable
 * screen must appear exactly once — routes/index.tsx maps over this.
 */
export const NAV_ITEMS: NavItem[] = [
  DASHBOARD_ITEM,
  ...NAV_GROUPS.flatMap((group) => group.items),
  SETTINGS_ITEM,
];
