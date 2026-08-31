import { Check, ExternalLink, Server, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { ThemeToggle } from "../components/theme-toggle";
import { Badge } from "../components/ui/badge";
import { Card } from "../components/ui/card";
import { Wordmark } from "../components/wordmark";
import { GITHUB_URL } from "../lib/constants";
import { NAV_GROUPS } from "./nav";

/**
 * Public landing page.
 *
 * Two standing constraints, both from CLAUDE.md:
 *   - Module names come from NAV_GROUPS rather than being retyped here, so the
 *     page can only ever use our own vocabulary. The banned Ahrefs/Moz marks
 *     have no way in.
 *   - Nothing on this page claims a user count, a customer, or a result. No
 *     testimonials, no metrics, no competitor logos or screenshots. Each
 *     module is badged Live or with the phase that ships it (from
 *     NavItem.live), so the page never overstates what exists today.
 */
const MODULES = NAV_GROUPS.flatMap((group) =>
  group.items.map((item) => ({ ...item, group: group.label })),
);

function CheckItem({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm leading-relaxed text-muted-foreground">
      <Check
        className="mt-0.5 size-4 shrink-0 text-primary"
        aria-hidden="true"
      />
      <span>{children}</span>
    </li>
  );
}

export function Landing() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-6">
        <Wordmark className="text-lg" />
        <div className="flex items-center gap-1 sm:gap-3">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="hidden items-center gap-1.5 rounded-app px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
          >
            GitHub
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
          <ThemeToggle />
          <Link
            to="/login"
            className="rounded-app px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-6 pt-16 pb-20 text-center sm:pt-24">
          <Badge variant="brand" className="mb-6">
            AGPL-3.0 · self-hostable
          </Badge>
          <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-6xl">
            Open-source SEO intelligence
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">
            Keyword research, domain and backlink analysis, rank tracking and
            site audits — running on a DataForSEO key you own. You buy API
            credits directly at cost; we never resell them or mark them up.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/register"
              className="rounded-app bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              Create an account
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-2 rounded-app border border-border bg-surface px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted"
            >
              Read the source
              <ExternalLink className="size-4" aria-hidden="true" />
            </a>
          </div>

          <p className="mt-5 text-sm text-muted-foreground">
            Runs on Cloudflare&rsquo;s free plan. No Queues, no Durable Objects,
            no paid-only services.
          </p>
        </section>

        {/* Modules */}
        <section className="mx-auto max-w-6xl px-6 pb-20">
          <div className="mb-9 text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Nine modules, one workspace
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Five research tools you can point at any domain, and four that
              track a site you own. All nine are live.
            </p>
          </div>

          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.map((module) => {
              const Icon = module.icon;
              return (
                <li key={module.segment}>
                  <Card className="flex h-full flex-col gap-3 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex size-9 items-center justify-center rounded-app bg-tint">
                        <Icon
                          className="size-4 text-tint-foreground"
                          aria-hidden="true"
                        />
                      </span>
                      {module.live ? (
                        <Badge variant="success">Live</Badge>
                      ) : (
                        <Badge variant="info">
                          Arrives in Phase {module.phase}
                        </Badge>
                      )}
                    </div>
                    <h3 className="text-sm font-semibold text-foreground">
                      {module.label}
                    </h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {module.description}
                    </p>
                    <span className="mt-auto pt-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      {module.group}
                    </span>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Self-host vs hosted */}
        <section className="border-y border-border bg-surface-muted">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="mb-9 text-center">
              <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                Run it yourself, or let us run it
              </h2>
              <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Identical features either way. The hosted plan buys you not
                having to operate it — never access to the data, and never your
                API credits.
              </p>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <Card className="flex flex-col gap-5 p-6">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-app bg-tint">
                    <Server
                      className="size-4 text-tint-foreground"
                      aria-hidden="true"
                    />
                  </span>
                  <div>
                    <h3 className="text-base font-semibold text-foreground">
                      Self-host
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Free, forever
                    </p>
                  </div>
                </div>
                <ul className="flex flex-col gap-2.5">
                  <CheckItem>
                    Deploys into your own Cloudflare account
                  </CheckItem>
                  <CheckItem>
                    Fits the free Workers plan — D1, KV and R2 only
                  </CheckItem>
                  <CheckItem>
                    AGPL-3.0: read it, change it, run your fork
                  </CheckItem>
                  <CheckItem>
                    Your database, your keys, your DataForSEO bill
                  </CheckItem>
                </ul>
              </Card>

              <Card className="flex flex-col gap-5 border-primary/40 p-6">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-app bg-tint">
                    <ShieldCheck
                      className="size-4 text-tint-foreground"
                      aria-hidden="true"
                    />
                  </span>
                  <div>
                    <h3 className="text-base font-semibold text-foreground">
                      Hosted
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Around $10 a month per workspace
                    </p>
                  </div>
                </div>
                <ul className="flex flex-col gap-2.5">
                  <CheckItem>Managed updates, backups and uptime</CheckItem>
                  <CheckItem>Unlimited members per workspace</CheckItem>
                  <CheckItem>
                    Still your own DataForSEO key — credits are never resold
                  </CheckItem>
                  <CheckItem>
                    Same codebase as the self-hosted build
                  </CheckItem>
                </ul>
              </Card>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <Wordmark className="text-sm" markSize={18} />
          <p className="text-xs text-muted-foreground">
            Licensed under AGPL-3.0. Bring your own DataForSEO key.
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            GitHub
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
          {/*
            Linked from here on purpose: Google's OAuth consent-screen review
            expects the privacy policy to be reachable from the app's home page,
            not only from a URL typed into the console.
          */}
          <Link
            to="/privacy"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Privacy
          </Link>
          <Link
            to="/login"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign in
          </Link>
        </div>
      </footer>
    </div>
  );
}
