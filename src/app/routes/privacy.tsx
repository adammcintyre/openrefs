/**
 * Public privacy policy at /privacy.
 *
 * Two audiences at once, which is why the page marks its lines:
 *
 *  - **Google's OAuth reviewers.** Verifying a Search Console client requires a
 *    published policy that names the scope requested, says what is done with
 *    the data, and includes the Limited Use disclosure. Those parts are not
 *    decoration; leaving them out fails verification.
 *  - **Self-hosters.** Most people running OpenRefs run it for themselves, and
 *    a policy that talks about "our servers" would be simply false for them.
 *    Anything that is only true of the operator-hosted instance is wrapped in
 *    `<HostedOnly>` and visibly labelled, so a fork can delete those blocks and
 *    still have an accurate document.
 *
 * Every factual claim here is checkable against the code, and should be
 * re-checked when the code changes:
 *   users.password_hash          src/worker/lib/crypto.ts (PBKDF2-SHA256)
 *   sessions                     src/worker/lib/sessions.ts (30d, httpOnly)
 *   workspaces.dfs_*_enc         src/worker/routes/workspaces.ts (AES-256-GCM)
 *   gsc_connections              src/db/schema.ts + src/worker/gsc/
 *   api_usage                    src/worker/dataforseo/client.ts
 *   request logging              src/worker/middleware/logger.ts
 *   deletion cascade             src/worker/lib/deletion.ts
 *
 * OPERATOR TODO before hosted launch: `CONTACT_HREF` below points at the
 * repository's issue tracker, which is honest but impersonal. Replace it with a
 * real contact address for the hosted service — Google's consent screen review
 * expects one, and so do data-subject requests.
 */
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { ThemeToggle } from "../components/theme-toggle";
import { Wordmark } from "../components/wordmark";
import { GITHUB_URL } from "../lib/constants";

/** The scope OpenRefs requests, named in full because reviewers look for it. */
const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

/** See the OPERATOR TODO above. */
const CONTACT_HREF = `${GITHUB_URL}/issues`;

/** Last substantive revision. Update when the text changes, not on redeploys. */
const LAST_UPDATED = "29 August 2026";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2
        id={id}
        className="text-lg font-semibold tracking-tight text-foreground"
      >
        {title}
      </h2>
      <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

function List({ children }: { children: ReactNode }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5 marker:text-border">
      {children}
    </ul>
  );
}

/**
 * A claim that is only true of the instance the OpenRefs maintainers operate.
 * Labelled rather than merely styled, so it survives being read aloud, copied
 * into a plain-text document, or seen by someone who cannot distinguish the
 * background tint.
 */
function HostedOnly({ children }: { children: ReactNode }) {
  return (
    <aside className="rounded-app border border-border bg-surface-muted px-4 py-3">
      <p className="text-xs font-medium tracking-wide text-tint-foreground uppercase">
        Hosted service only
      </p>
      <div className="mt-2 flex flex-col gap-2 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </aside>
  );
}

/** The mirror image: what changes if you run OpenRefs yourself. */
function SelfHostNote({ children }: { children: ReactNode }) {
  return (
    <aside className="rounded-app border border-dashed border-border px-4 py-3">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        If you self-host
      </p>
      <div className="mt-2 flex flex-col gap-2 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </aside>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-app bg-surface-muted px-1.5 py-0.5 font-mono text-[0.8125rem] break-all text-foreground">
      {children}
    </code>
  );
}

export function Privacy() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between gap-4 px-6">
        <Link to="/" className="rounded-app">
          <Wordmark className="text-base" markSize={20} />
        </Link>
        <div className="flex items-center gap-1 sm:gap-3">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-app px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Home
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pt-6 pb-20">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Privacy policy
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Last updated {LAST_UPDATED}
        </p>

        <div className="mt-8 rounded-app border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-foreground">
            The short version
          </h2>
          <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
            <p>
              OpenRefs stores your email address, the API credentials you give
              it (encrypted), and the SEO data you ask it to fetch. It has no
              analytics, no tracking pixels, no advertising and no third-party
              scripts of any kind. It never sells or shares your data, and
              deleting your account deletes all of it.
            </p>
            <p>
              If you connect Google Search Console, OpenRefs requests read-only
              access and uses it for one thing: showing you your own search
              performance inside OpenRefs. Nothing else, ever.
            </p>
          </div>
        </div>

        <Section id="who" title="Who this policy is about">
          <p>
            OpenRefs is open-source software licensed under AGPL-3.0. Anyone can
            run their own copy, and most people do. That makes &ldquo;who is
            responsible for your data&rdquo; depend on whose copy you are using.
          </p>
          <HostedOnly>
            <p>
              On the instance the OpenRefs maintainers operate, the maintainers
              are the data controller. The infrastructure is a Cloudflare
              account they own, and they are the only people with access to it.
            </p>
          </HostedOnly>
          <SelfHostNote>
            <p>
              You are the controller of your own deployment. Your data lives in
              your Cloudflare account, under your own D1 database, KV namespace
              and R2 bucket. The maintainers have no access to it, cannot see
              it, and receive nothing from it &mdash; OpenRefs makes no
              &ldquo;phone home&rdquo; requests. Everything below that is not
              marked &ldquo;hosted service only&rdquo; describes what the
              software itself does, so you can adapt this page for your users.
            </p>
          </SelfHostNote>
        </Section>

        <Section id="stored" title="What OpenRefs stores">
          <p>Everything it keeps, and why:</p>
          <List>
            <li>
              <strong className="font-medium text-foreground">
                Your email address and password.
              </strong>{" "}
              Needed to sign you in and to send workspace invitations. The
              password is never stored &mdash; only a PBKDF2-SHA256 hash of it,
              which cannot be reversed back into your password.
            </li>
            <li>
              <strong className="font-medium text-foreground">
                Session cookies.
              </strong>{" "}
              One <Code>httpOnly</Code>, <Code>Secure</Code>,{" "}
              <Code>SameSite=Lax</Code> cookie that keeps you signed in for 30
              days. The database stores only a hash of it, so a database copy
              cannot be used to impersonate you.
            </li>
            <li>
              <strong className="font-medium text-foreground">
                Your DataForSEO credentials.
              </strong>{" "}
              OpenRefs runs on your own DataForSEO key. Those credentials are
              encrypted with AES-256-GCM before they touch the database and are
              decrypted only in memory, at the moment a request you asked for is
              made. They are never logged, never shown back to you in full, and
              never sent anywhere except DataForSEO.
            </li>
            <li>
              <strong className="font-medium text-foreground">
                Your Google Search Console connection, if you create one.
              </strong>{" "}
              Covered in its own section below.
            </li>
            <li>
              <strong className="font-medium text-foreground">
                The work you do in the product.
              </strong>{" "}
              Workspaces, projects, the domains and keywords you track,
              collections you save, site audits you run, and the results
              returned for them. This is the product; without it there is
              nothing to show you.
            </li>
            <li>
              <strong className="font-medium text-foreground">
                Cached API responses.
              </strong>{" "}
              Results from DataForSEO and Google are cached so that repeating a
              query does not cost you money again. Every cache entry is keyed to
              your workspace and is never shared with another one, even for an
              identical query.
            </li>
            <li>
              <strong className="font-medium text-foreground">
                Usage metering.
              </strong>{" "}
              For each API call: which endpoint, what it cost, whether it was
              served from cache, and when. This is what powers your spend
              reporting and your monthly spend cap. It records the shape of the
              call, not the contents of the answer.
            </li>
            <li>
              <strong className="font-medium text-foreground">
                Operational logs.
              </strong>{" "}
              One line per request containing a random request id, the HTTP
              method, the URL path, the response status and how long it took.
              Deliberately not headers, cookies, query strings or bodies &mdash;
              credentials travel in those.
            </li>
          </List>
        </Section>

        <Section id="google" title="Google Search Console data">
          <p>
            Connecting Search Console is entirely optional. OpenRefs works
            without it, and you can disconnect at any time.
          </p>
          <p>
            When you connect, OpenRefs asks Google for exactly one scope:
          </p>
          <p>
            <Code>{GSC_SCOPE}</Code>
          </p>
          <p>
            That scope is read-only. OpenRefs is technically incapable of
            changing anything in your Search Console account &mdash; it cannot
            submit or delete sitemaps, cannot request indexing, cannot add or
            remove users, and cannot modify a property.
          </p>
          <List>
            <li>
              <strong className="font-medium text-foreground">
                What is stored.
              </strong>{" "}
              The refresh token Google issues, encrypted with AES-256-GCM before
              it reaches the database, plus the property you chose and which
              user connected it. Short-lived access tokens are held in cache for
              under an hour and are never written to the database.
            </li>
            <li>
              <strong className="font-medium text-foreground">
                What is read.
              </strong>{" "}
              The list of properties your Google account can see (so you can
              pick one), and Search Console performance data for the property
              you picked: queries, pages, clicks, impressions, click-through
              rate and average position.
            </li>
            <li>
              <strong className="font-medium text-foreground">
                What it is used for.
              </strong>{" "}
              Displaying that data back to you, and computing the suggestions on
              the Opportunities tab &mdash; which happens inside your own
              workspace, from your own data.
            </li>
            <li>
              <strong className="font-medium text-foreground">
                What it is never used for.
              </strong>{" "}
              It is not combined with other users&rsquo; data, not used to build
              any aggregate, benchmark or dataset, not used for advertising, not
              sold or transferred to anyone, and not used to train machine
              learning or AI models.
            </li>
            <li>
              <strong className="font-medium text-foreground">
                Disconnecting.
              </strong>{" "}
              Disconnecting asks Google to revoke the token and deletes the
              stored connection. You can also revoke OpenRefs&rsquo; access
              yourself at any time from your Google account&rsquo;s{" "}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noreferrer noopener"
                className="text-primary underline underline-offset-2 hover:text-primary-hover"
              >
                third-party access settings
              </a>
              .
            </li>
          </List>
          <p>
            OpenRefs&rsquo; use of information received from Google APIs adheres
            to the{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary underline underline-offset-2 hover:text-primary-hover"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
        </Section>

        <Section id="where" title="Where the data lives">
          <p>
            OpenRefs runs entirely on Cloudflare: a Worker for the application,
            D1 for the database, Workers KV for the response cache, and R2 for
            larger stored files such as raw site-audit crawl data. There is no
            other hosting provider and no separate analytics platform.
          </p>
          <HostedOnly>
            <p>
              For the hosted instance those resources sit in a Cloudflare
              account controlled by the OpenRefs maintainers. Cloudflare
              processes the data on their behalf as an infrastructure provider,
              and distributes storage across its network; see Cloudflare&rsquo;s
              own documentation for where D1, KV and R2 data is held.
            </p>
          </HostedOnly>
        </Section>

        <Section id="sharing" title="Who else sees it">
          <p>
            Your data is sent to exactly two kinds of destination, both because
            you asked:
          </p>
          <List>
            <li>
              <strong className="font-medium text-foreground">
                DataForSEO
              </strong>{" "}
              receives the queries you run &mdash; the keyword, domain or URL
              you typed &mdash; because that is who answers them, using your own
              account.
            </li>
            <li>
              <strong className="font-medium text-foreground">Google</strong>{" "}
              receives requests for your Search Console data, if you connected
              it.
            </li>
          </List>
          <p>
            Beyond those, nothing. Your data is not sold, rented, licensed,
            shared with advertisers or data brokers, or handed to anyone for
            their own purposes. Other members of a workspace you belong to can
            see that workspace&rsquo;s data &mdash; that is what a shared
            workspace is for &mdash; and nobody else can.
          </p>
          <HostedOnly>
            <p>
              The maintainers do not read your workspace data. Access to the
              production database exists for operating the service (migrations,
              investigating a fault you report) and is not used to browse
              customer content. Encrypted credentials stay encrypted regardless:
              they are unreadable without the deployment&rsquo;s master key.
            </p>
          </HostedOnly>
        </Section>

        <Section id="tracking" title="Tracking, cookies and analytics">
          <p>
            There are none. The pages load no third-party scripts, no fonts from
            external hosts, no tracking pixels, no session recorders, no
            advertising and no analytics product. There is no cookie banner
            because there is nothing to consent to.
          </p>
          <p>
            The only cookie is the session cookie described above, which is
            strictly necessary to keep you signed in. Your browser&rsquo;s local
            storage also holds two preferences &mdash; your light/dark theme
            choice and the last market you searched in &mdash; which stay on
            your device and are never sent anywhere.
          </p>
        </Section>

        <Section id="retention" title="How long it is kept">
          <p>
            Account and workspace data is kept until you delete it. Cached API
            responses expire on their own, between a day and a month depending
            on how quickly the underlying data changes. Operational logs are
            retained by Cloudflare&rsquo;s Workers observability for its
            standard retention window and then discarded.
          </p>
        </Section>

        <Section id="deletion" title="Deleting your data">
          <p>
            Deletion is a feature, not a support request. Two controls, both in
            the product:
          </p>
          <List>
            <li>
              <strong className="font-medium text-foreground">
                Delete a workspace
              </strong>{" "}
              removes every row belonging to it &mdash; projects, tracked
              keywords, rank history, audits, collections, API keys, invitations
              and usage records &mdash; along with every cached response and
              every stored file for that workspace, and revokes any Google
              Search Console tokens it held.
            </li>
            <li>
              <strong className="font-medium text-foreground">
                Delete your account
              </strong>{" "}
              does all of the above for every workspace you are the sole owner
              of, removes you from any workspaces you shared with others, and
              deletes your user record.
            </li>
          </List>
          <p>
            Both are immediate and irreversible. There is no soft-delete, no
            recycle bin and no thirty-day grace period during which the data is
            still sitting there.
          </p>
          <HostedOnly>
            <p>
              Deleted data can persist for a short time in Cloudflare&rsquo;s
              own infrastructure backups before those roll over. The maintainers
              keep no separate copies, exports or archives of customer data.
            </p>
          </HostedOnly>
        </Section>

        <Section id="rights" title="Your rights">
          <p>
            Depending on where you live you may have rights to access, correct,
            export or erase your personal data, and to object to its processing.
            OpenRefs is built so you can exercise the important ones yourself:
            your account data is visible in the product, tables export to CSV,
            and deletion is a button. For anything the product does not cover,
            get in touch.
          </p>
        </Section>

        <Section id="security" title="Security">
          <p>
            Passwords are hashed with PBKDF2-SHA256. API credentials and Google
            refresh tokens are encrypted at rest with AES-256-GCM using a key
            held as a deployment secret, separate from the database. Session and
            API-key tokens are stored only as hashes. Traffic is HTTPS-only.
            Secrets are never written to logs.
          </p>
          <p>
            No system is perfectly secure, and OpenRefs is provided without
            warranty under its licence. The source is public, so you can verify
            every claim on this page rather than take it on trust.
          </p>
        </Section>

        <Section id="children" title="Children">
          <p>
            OpenRefs is a professional tool and is not directed at children. It
            is not intended for anyone under 16.
          </p>
        </Section>

        <Section id="changes" title="Changes to this policy">
          <p>
            When this policy changes, the date at the top changes with it, and
            the change itself is visible in the repository&rsquo;s history along
            with the code it describes.
          </p>
        </Section>

        <Section id="contact" title="Contact">
          <p>
            Questions about this policy, or about data OpenRefs holds, can be
            raised at{" "}
            <a
              href={CONTACT_HREF}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary underline underline-offset-2 hover:text-primary-hover"
            >
              the project&rsquo;s issue tracker
            </a>
            . Please do not include credentials or personal data in a public
            issue.
          </p>
        </Section>
      </main>

      <footer className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 border-t border-border px-6 py-8 text-sm">
        <p className="text-xs text-muted-foreground">
          Licensed under AGPL-3.0.
        </p>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          Source
        </a>
      </footer>
    </div>
  );
}
