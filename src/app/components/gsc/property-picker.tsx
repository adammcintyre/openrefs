/**
 * Connected, no property chosen yet — the last step of the connect flow.
 *
 * A Google account can see many properties, and OpenRefs cannot guess which one
 * belongs to this project: the domains often differ (a staging host, an agency
 * account holding thirty clients), and binding the wrong one would silently
 * report someone else's numbers under this project's name. So the choice is
 * always explicit, even when the account can see exactly one property.
 *
 * The project's own domain is used to *suggest*, never to decide. A matching
 * property is marked and sorted first; nothing is auto-selected.
 *
 * **Unverified properties are shown and blocked.** Google's `sites.list`
 * returns them, but they hold no data. Hiding them would leave someone hunting
 * for a property they can see in Search Console; offering them would end in an
 * empty report with no explanation. They are listed, labelled, and not
 * selectable.
 */
import { CheckCircle2, Globe, SearchX } from "lucide-react";
import { useMemo, useState } from "react";

import type { GscSite } from "../../../shared/gsc";
import type { Project } from "../../../shared/projects";
import { errorMessage } from "../../lib/api";
import { ApiErrorNotice } from "../domains/api-error-notice";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Skeleton,
  cn,
  useToast,
} from "../ui";
import {
  formatGscPermission,
  formatGscProperty,
  gscPropertyKind,
  isReadableGscSite,
} from "./format";
import { useGscSites, useSetGscProperty } from "./queries";

/**
 * Does this property plausibly cover the project's domain?
 *
 * Deliberately loose — it only drives an ordering hint and a "looks like this
 * one" badge, never a selection. A domain property covers every subdomain, so a
 * suffix match is right there; a URL-prefix property is compared on host alone.
 */
export function looksLikeProjectProperty(
  siteUrl: string,
  domain: string,
): boolean {
  const target = domain.trim().toLowerCase().replace(/^www\./, "");
  if (target === "") return false;

  if (siteUrl.startsWith("sc-domain:")) {
    const property = siteUrl.slice("sc-domain:".length).toLowerCase();
    return property === target || target.endsWith(`.${property}`);
  }

  try {
    const host = new URL(siteUrl).hostname.toLowerCase().replace(/^www\./, "");
    return host === target || host.endsWith(`.${target}`);
  } catch {
    return false;
  }
}

/** Suggested matches first, then alphabetically. Unverified always last. */
export function orderGscSites(
  sites: ReadonlyArray<GscSite>,
  domain: string,
): GscSite[] {
  return [...sites].sort((a, b) => {
    const readable = Number(isReadableGscSite(b.permissionLevel)) -
      Number(isReadableGscSite(a.permissionLevel));
    if (readable !== 0) return readable;

    const matched =
      Number(looksLikeProjectProperty(b.siteUrl, domain)) -
      Number(looksLikeProjectProperty(a.siteUrl, domain));
    if (matched !== 0) return matched;

    return a.siteUrl.localeCompare(b.siteUrl);
  });
}

export function GscPropertyPicker({
  workspaceId,
  project,
  canAdminister,
  /** Rendered inside an already-surfaced container (the change-property flow). */
  bare = false,
}: {
  workspaceId: string | null;
  project: Project;
  canAdminister: boolean;
  bare?: boolean;
}) {
  const { toast } = useToast();
  const query = useGscSites(workspaceId, project.id, canAdminister);
  const setProperty = useSetGscProperty(workspaceId, project.id);

  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sites = useMemo(
    () => orderGscSites(query.data?.sites ?? [], project.domain),
    [query.data, project.domain],
  );
  const current = query.data?.property ?? null;

  async function save() {
    if (selected === null || setProperty.isPending) return;
    setError(null);
    try {
      await setProperty.mutateAsync({ property: selected });
      toast({
        title: "Property connected",
        description: `${project.name} now reads Search Console data from ${formatGscProperty(selected)}.`,
        tone: "success",
      });
    } catch (caught) {
      // Kept on the panel: the user is still here and the alternative choices
      // are on screen in front of them.
      setError(errorMessage(caught, "Could not save that property."));
    }
  }

  if (!canAdminister) {
    return (
      <Frame bare={bare}>
        <Heading
          title="This project has no Search Console property yet"
          description="The Google account is connected, but nobody has chosen which property this project should read."
        />
        <p
          role="status"
          className="mt-4 rounded-app border border-info-subtle bg-info-subtle p-3 text-sm leading-relaxed text-info-on-subtle"
        >
          Choosing the property is an admin action. Ask a workspace owner or
          admin to pick one, and the reports will appear here.
        </p>
      </Frame>
    );
  }

  return (
    <Frame bare={bare}>
      <Heading
        title={
          current === null
            ? "Choose a Search Console property"
            : "Change the Search Console property"
        }
        description={
          current === null
            ? `Google is connected. Pick the property this project reads from — the reports below will describe whichever one you choose, so it should be the one that covers ${project.domain}.`
            : `This project currently reads ${formatGscProperty(current)}. Choosing a different property replaces every number in this module.`
        }
      />

      <div className="mt-5 flex flex-col gap-4">
        {query.isPending ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-14 w-full rounded-app" />
            <Skeleton className="h-14 w-full rounded-app" />
            <Skeleton className="h-14 w-full rounded-app" />
          </div>
        ) : query.isError ? (
          <ApiErrorNotice
            error={query.error}
            onRetry={() => void query.refetch()}
            fallback="Could not list the properties this Google account can see."
          />
        ) : sites.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="This Google account has no properties"
            description="Search Console shows no verified properties for the account you connected. Add and verify the site in Search Console first, or reconnect using a different Google account."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {sites.map((site) => {
              const readable = isReadableGscSite(site.permissionLevel);
              const suggested = looksLikeProjectProperty(
                site.siteUrl,
                project.domain,
              );
              const isSelected = selected === site.siteUrl;
              const isCurrent = current === site.siteUrl;

              return (
                <li key={site.siteUrl}>
                  <button
                    type="button"
                    disabled={!readable || setProperty.isPending}
                    onClick={() => setSelected(site.siteUrl)}
                    aria-current={isCurrent ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-app border p-3 text-left transition-colors",
                      "disabled:cursor-not-allowed disabled:opacity-60",
                      isSelected
                        ? "border-primary bg-tint"
                        : "border-border bg-surface enabled:hover:bg-surface-muted",
                    )}
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-app bg-surface-muted">
                      {isSelected ? (
                        <CheckCircle2
                          className="size-4 text-primary"
                          aria-hidden="true"
                        />
                      ) : (
                        <Globe
                          className="size-4 text-muted-foreground"
                          aria-hidden="true"
                        />
                      )}
                    </span>

                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span
                        className={cn(
                          "truncate text-sm font-medium",
                          isSelected ? "text-tint-foreground" : "text-foreground",
                        )}
                      >
                        {formatGscProperty(site.siteUrl)}
                      </span>
                      <span
                        className={cn(
                          "truncate text-xs",
                          isSelected
                            ? "text-tint-foreground/80"
                            : "text-muted-foreground",
                        )}
                      >
                        {`${gscPropertyKind(site.siteUrl)} · ${formatGscPermission(site.permissionLevel)}`}
                        {readable
                          ? ""
                          : " · no data available on an unverified property"}
                      </span>
                    </span>

                    <span className="flex shrink-0 items-center gap-1.5">
                      {isCurrent ? (
                        <Badge variant="brand">In use</Badge>
                      ) : null}
                      {suggested && readable ? (
                        <Badge variant="success">Matches this project</Badge>
                      ) : null}
                      {readable ? null : (
                        <Badge variant="warning">Unverified</Badge>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {error === null ? null : (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        {sites.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => void save()}
              loading={setProperty.isPending}
              disabled={selected === null || selected === current}
            >
              Use this property
            </Button>
            <p className="text-xs text-muted-foreground">
              {selected === null
                ? "Nothing is chosen for you — pick the property that covers this project."
                : selected === current
                  ? "That is the property already in use."
                  : `Reports will describe ${formatGscProperty(selected)}.`}
            </p>
          </div>
        ) : null}
      </div>
    </Frame>
  );
}

/* --------------------------------- chrome ---------------------------------- */

function Frame({
  bare,
  children,
}: {
  bare: boolean;
  children: React.ReactNode;
}) {
  if (bare) return <div>{children}</div>;
  return <Card className="p-6">{children}</Card>;
}

function Heading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <h2 className="text-base font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
