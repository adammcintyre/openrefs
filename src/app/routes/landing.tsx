import { Link } from "react-router";

import { ThemeToggle } from "../components/theme-toggle";
import { Wordmark } from "../components/wordmark";
import { APP_TAGLINE, GITHUB_URL } from "../lib/constants";

/**
 * Public landing placeholder. Deliberately plain — Phase 8 builds the real
 * marketing page. It exists now so `/` is not a blank document and so the
 * theme tokens get exercised outside the app shell.
 */
export function Landing() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-14 items-center justify-between px-6">
        <Wordmark className="text-lg" />
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link
            to="/login"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-6">
        <div className="max-w-2xl text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            {APP_TAGLINE}
          </h1>
          <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-muted-foreground">
            Keyword research, domain and backlink analysis, rank tracking and
            site audits — self-hosted on Cloudflare&rsquo;s free plan, running
            on API credits you buy directly.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/login"
              className="rounded-app bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              Sign in
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-app border border-border bg-surface px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted"
            >
              View on GitHub
            </a>
          </div>

          <p className="mt-6 text-sm text-muted-foreground">
            New here?{" "}
            <Link to="/register" className="text-primary hover:underline">
              Create an account
            </Link>
          </p>
        </div>
      </main>

      <footer className="px-6 py-6 text-center text-xs text-muted-foreground">
        AGPL-3.0. Bring your own DataForSEO key.
      </footer>
    </div>
  );
}
