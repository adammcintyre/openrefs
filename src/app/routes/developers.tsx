/**
 * Public developer documentation at /developers.
 *
 * Deliberately self-contained: no Swagger UI, no Redoc, no external doc
 * renderer. Those are large dependencies that fetch fonts and scripts from
 * other origins, and this page has to work on a self-hosted deployment behind a
 * firewall with nothing but the Worker. Everything here is theme tokens and
 * text, plus one `navigator.clipboard` call.
 *
 * The examples are built against `window.location.origin`, so a self-hoster
 * copying the MCP config block gets their own URL rather than ours. That is the
 * one thing on this page that cannot be a static string.
 *
 * Every factual claim here is checkable against the code, and should be
 * re-checked when the code changes:
 *   `orf_` key prefix + role  src/worker/middleware/auth.ts, lib/authorization.ts
 *   the tool list             src/worker/mcp/tools.ts
 *   the MCP revision          src/worker/mcp/protocol.ts
 *   spend cap semantics       src/worker/dataforseo/client.ts
 *   the error envelope        src/shared/api.ts
 */
import { ArrowLeft, Check, Copy } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { ThemeToggle } from "../components/theme-toggle";
import { Wordmark } from "../components/wordmark";
import { GITHUB_URL } from "../lib/constants";

/**
 * The MCP revision `src/worker/mcp/protocol.ts` implements.
 *
 * Duplicated as a literal rather than imported: this is the only value the SPA
 * needs from the worker's MCP module, and importing it would pull the whole
 * protocol layer — and its zod tool schemas — into the client bundle to render
 * one string.
 */
const MCP_REVISION = "2026-07-28";

/** The deployment's own origin, so copied examples point at the right host. */
function origin(): string {
  return typeof window === "undefined" ? "https://openrefs.example" : window.location.origin;
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-12">
      <h2 id={id} className="text-lg font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-app bg-surface-muted px-1.5 py-0.5 font-mono text-[0.8125rem] break-all text-foreground">
      {children}
    </code>
  );
}

/**
 * A copyable block. The copy button is a convenience, not the only route to the
 * text: the `<pre>` selects normally, which matters when the Clipboard API is
 * unavailable (it needs a secure context, and a self-hoster may well be on
 * plain http on a LAN).
 */
function CodeBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    void navigator.clipboard
      ?.writeText(code)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // Clipboard denied or unavailable. The text is selectable; say nothing.
      });
  }, [code]);

  return (
    <figure className="mt-1 overflow-hidden rounded-app border border-border bg-surface-muted">
      <figcaption className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
        <span className="font-mono text-xs tracking-wide text-muted-foreground">
          {label}
        </span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-app px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {copied ? (
            <Check className="size-3.5" aria-hidden="true" />
          ) : (
            <Copy className="size-3.5" aria-hidden="true" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </figcaption>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[0.8125rem] leading-relaxed text-foreground">
        <code>{code}</code>
      </pre>
    </figure>
  );
}

/** One tool, as `tools/list` describes it. */
function Tool({ name, children }: { name: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <code className="shrink-0 font-mono text-[0.8125rem] text-foreground sm:w-56">
        {name}
      </code>
      <span>{children}</span>
    </li>
  );
}

export function DevelopersPage() {
  const base = origin();

  const restExample = `# Every workspace-scoped endpoint takes ?workspace=<id>.
# List the workspaces a key can see (a key sees exactly one):
curl -s "${base}/api/v1/workspaces" \\
  -H "Authorization: Bearer orf_YOUR_KEY_HERE"

# Look up a keyword in the UK market:
curl -s -G "${base}/api/v1/keywords/overview" \\
  -H "Authorization: Bearer orf_YOUR_KEY_HERE" \\
  --data-urlencode "workspace=YOUR_WORKSPACE_ID" \\
  --data-urlencode "keyword=seo tools" \\
  --data-urlencode "location=2826" \\
  --data-urlencode "language=en"`;

  const mcpConfig = `{
  "mcpServers": {
    "openrefs": {
      "type": "http",
      "url": "${base}/mcp",
      "headers": {
        "Authorization": "Bearer orf_YOUR_KEY_HERE"
      }
    }
  }
}`;

  const mcpCurl = `curl -s "${base}/mcp" \\
  -H "Authorization: Bearer orf_YOUR_KEY_HERE" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;

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
          Developers
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Everything the OpenRefs interface can do, it does through a public
          JSON API — and everything that API can do, an AI agent can do through
          the built-in MCP server. Both use the same key, the same permissions
          and the same spend controls.
        </p>

        <div className="mt-8 rounded-app border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-foreground">
            Before you start: this spends your own money
          </h2>
          <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
            <p>
              OpenRefs has no data of its own. Every keyword, domain, backlink
              and SERP request is forwarded to{" "}
              <strong className="font-medium text-foreground">
                your workspace&rsquo;s own DataForSEO account
              </strong>{" "}
              and billed to your balance there, whether it came from the web app,
              from curl, or from an agent. There is no separate API quota and no
              free tier hiding behind these endpoints &mdash; an automated script
              in a loop will spend real money exactly as fast as it runs.
            </p>
            <p>
              Your workspace spend cap is the backstop and it applies to every
              caller equally. Set it in{" "}
              <strong className="font-medium text-foreground">
                Settings &rarr; General
              </strong>{" "}
              before you point anything automated at this API.
            </p>
          </div>
        </div>

        <Section id="key" title="Get an API key">
          <p>
            Keys are minted per workspace, in{" "}
            <strong className="font-medium text-foreground">
              Settings &rarr; API Keys
            </strong>
            . Give the key a name you will recognise later, and copy it
            immediately: OpenRefs stores only a hash of it, so the full value is
            shown once and can never be retrieved again. Lost a key? Delete it
            and mint another.
          </p>
          <p>
            Every key starts with <Code>orf_</Code> and is bound to the one
            workspace it was created in. It carries the{" "}
            <Code>member</Code> role, which means it can read that workspace and
            run research, but cannot rotate DataForSEO credentials, change
            members, alter the spend cap, or delete anything structural. A leaked
            key can spend money; it cannot take the account.
          </p>
          <p>
            Send it as a bearer token. The API also accepts the browser session
            cookie, which is what the web app itself uses &mdash; but for scripts
            and agents, always use a key.
          </p>
          <CodeBlock label="REST, with curl" code={restExample} />
          <p>
            Endpoints that touch a workspace take it explicitly as{" "}
            <Code>?workspace=&lt;id&gt;</Code>. OpenRefs never infers &ldquo;the
            first workspace&rdquo; for you. If the workspace is not the one the
            key belongs to, the answer is <Code>403</Code> &mdash; the same
            answer you get for a workspace that does not exist, so a key cannot
            be used to probe for valid ids.
          </p>
        </Section>

        <Section id="mcp" title="Connect an AI agent (MCP)">
          <p>
            OpenRefs speaks the{" "}
            <a
              href="https://modelcontextprotocol.io/specification"
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary underline underline-offset-2 hover:text-primary-hover"
            >
              Model Context Protocol
            </a>{" "}
            over stateless Streamable HTTP at <Code>{base}/mcp</Code>, protocol
            revision <Code>{MCP_REVISION}</Code>. Clients that still open with
            the older <Code>initialize</Code> handshake are answered too, so
            current tooling works without configuration.
          </p>
          <p>
            There are no sessions to manage and nothing to install. Add the
            server to your MCP client&rsquo;s config with the same{" "}
            <Code>orf_</Code> key:
          </p>
          <CodeBlock label="MCP client configuration" code={mcpConfig} />
          <p>
            The key decides the workspace, so{" "}
            <strong className="font-medium text-foreground">
              no tool takes a workspace argument
            </strong>
            . One key, one workspace, one bill. To check the connection by hand:
          </p>
          <CodeBlock label="MCP, with curl" code={mcpCurl} />
        </Section>

        <Section id="tools" title="What an agent can do">
          <p>
            Twelve tools, each a thin wrapper over the same endpoint the web app
            uses. The eight marked <em>paid</em> spend DataForSEO credits; the
            other four only read your own database and are free.
          </p>
          <ul className="mt-2 flex flex-col gap-2.5">
            <Tool name="keyword_overview">
              Volume, CPC, difficulty, intent and 12 months of history for one
              keyword. <em>Paid.</em>
            </Tool>
            <Tool name="keyword_ideas">
              Related keywords with their metrics, filterable by volume and
              difficulty. <em>Paid.</em>
            </Tool>
            <Tool name="keyword_serp">
              The live Google results page for a query. <em>Paid.</em>
            </Tool>
            <Tool name="domain_overview">
              A domain&rsquo;s organic and paid footprint in one market.{" "}
              <em>Paid.</em>
            </Tool>
            <Tool name="domain_keywords">
              The keywords a domain ranks for, with position and traffic.{" "}
              <em>Paid.</em>
            </Tool>
            <Tool name="backlinks_summary">
              Domain Score, referring domains and the dofollow split for a domain
              or a single page. <em>Paid.</em>
            </Tool>
            <Tool name="gap_keywords">
              Keywords competitors rank for and you do not. Costs one upstream
              call per competitor. <em>Paid.</em>
            </Tool>
            <Tool name="content_discover">
              Pages winning traffic without much authority on a topic.{" "}
              <em>Paid</em> to build, then free to filter and page.
            </Tool>
            <Tool name="list_collections">Your saved keyword collections. Free.</Tool>
            <Tool name="add_keywords_to_collection">
              Save keywords into a collection. Idempotent, and free.
            </Tool>
            <Tool name="list_projects">The sites tracked in this workspace. Free.</Tool>
            <Tool name="tracked_keywords">
              Current rank, movement and a 30-day series for one project. Free.
            </Tool>
          </ul>
          <p className="mt-1">
            Every tool declares a JSON Schema, so an agent can call{" "}
            <Code>tools/list</Code> and discover the arguments itself. When a
            call is refused &mdash; spend cap reached, no credentials, unknown
            id &mdash; the tool returns <Code>isError: true</Code> with the same
            error code the REST API would have used, so the model can read what
            went wrong and act on it rather than seeing an opaque failure.
          </p>
        </Section>

        <Section id="cost" title="What it costs">
          <p>
            Every DataForSEO-backed response tells you what it cost:{" "}
            <Code>costUsd</Code> is the amount billed and <Code>cached</Code> is
            whether you paid it at all. Answers are cached per workspace, so
            asking the same question twice normally costs nothing &mdash; pass{" "}
            <Code>fresh=true</Code> only when you genuinely need current data,
            because it always buys a new answer. Your monthly cap is checked
            before every paid call and a request that would exceed it is refused
            with <Code>402 spend_cap_exceeded</Code> rather than being partially
            served.
          </p>
          <p>
            <Code>GET /api/v1/usage?workspace=&lt;id&gt;</Code> reports this
            month&rsquo;s spend broken down by endpoint, along with your cache
            hit rate &mdash; the fastest way to find a script that is buying the
            same thing repeatedly.
          </p>
        </Section>

        <Section id="errors" title="Errors">
          <p>
            Every non-2xx response has the same body, with a stable machine
            code:
          </p>
          <CodeBlock
            label="Error envelope"
            code={`{ "error": { "code": "spend_cap_exceeded", "message": "..." } }`}
          />
          <p>
            Switch on <Code>code</Code>, never on the message text. The full
            table of codes and the HTTP status each maps to is in the OpenAPI
            document below.
          </p>
        </Section>

        <Section id="openapi" title="The full reference">
          <p>
            The complete API is described by an OpenAPI 3.1 document, served
            without authentication and regenerated with every deployment:
          </p>
          <p>
            <a
              href="/api/v1/openapi.json"
              className="font-mono text-[0.8125rem] text-primary underline underline-offset-2 hover:text-primary-hover"
            >
              {base}/api/v1/openapi.json
            </a>
          </p>
          <p>
            Point any OpenAPI tool at it &mdash; a client generator, Postman,
            Bruno, an HTTP scratchpad &mdash; to get typed request and response
            shapes for every endpoint. The document is versioned with the app,
            so <Code>info.version</Code> tells you which deployment you are
            reading.
          </p>
          <p>
            OpenRefs is AGPL-3.0 and the API is part of the source:{" "}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary underline underline-offset-2 hover:text-primary-hover"
            >
              read it on GitHub
            </a>
            .
          </p>
        </Section>
      </main>
    </div>
  );
}
