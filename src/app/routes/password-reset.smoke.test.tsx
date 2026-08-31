/**
 * Render checks for the two password-reset screens and the way into them.
 *
 * The load-bearing assertion is the confirmation copy on /forgot: it must
 * promise nothing about whether the address exists. The API answers 202 to
 * every address precisely so it discloses no membership, and a page that said
 * "we could not find that account" would give back the enumeration oracle in
 * the one place a user is guaranteed to read.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../lib/theme";
import { ForgotPassword } from "./forgot";
import { Login } from "./login";
import { ResetPassword } from "./reset";

/*
 * ThemeProvider reads `document.documentElement` on first render to match the
 * class index.html's inline script already set. This suite runs in plain node
 * with no jsdom (vitest.config.ts), so the minimum it needs is stubbed here.
 */
(globalThis as { document?: unknown }).document = {
  documentElement: { classList: { contains: () => false } },
};

/*
 * The toast host is stubbed, and it has to be: it renders its viewport through
 * a portal, which the server renderer cannot do — hence its own
 * `typeof document === "undefined"` guard. Defining `document` above for
 * ThemeProvider's sake switches that guard off, so the two cannot both be real
 * in one pass. These are the first auth-card screens to raise a toast, which
 * is why no existing suite has had to choose. What a toast looks like is
 * toast.tsx's business; this file is about the pages.
 */
vi.mock("../components/ui/toast", () => ({
  ToastProvider: ({ children }: { children: ReactNode }) => children,
  useToast: () => ({ toast: () => 0, dismiss: () => undefined }),
}));

/**
 * Copy as a reader sees it. The server renderer separates interpolated values
 * from their surrounding text with empty comments, so `At least {N} characters`
 * arrives as `At least <!-- -->10<!-- --> characters` and a naive `toContain`
 * on the sentence fails for a reason that has nothing to do with the page.
 */
function visibleText(html: string): string {
  return html.replaceAll("<!-- -->", "");
}

/** main.tsx's provider order, minus the host stubbed out above. */
function render(path: string, children: ReactNode): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return renderToString(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe("/forgot", () => {
  const html = render(
    "/forgot",
    <Routes>
      <Route path="/forgot" element={<ForgotPassword />} />
    </Routes>,
  );

  it("mounts with an email form", () => {
    expect(html).toContain("Reset your password");
    expect(html).toContain('name="email"');
    expect(html).toContain("Send reset link");
  });

  it("labels the field, so the input is reachable without sight of it", () => {
    expect(html).toContain('for="email"');
  });

  it("offers the way back to sign in", () => {
    expect(html).toContain('href="/login"');
  });
});

describe("/reset/:token", () => {
  const html = render(
    "/reset/a-token-from-an-email",
    <Routes>
      <Route path="/reset/:token" element={<ResetPassword />} />
    </Routes>,
  );

  it("asks for a new password twice", () => {
    expect(html).toContain("Choose a new password");
    expect(html).toContain('name="password"');
    expect(html).toContain('name="confirm"');
  });

  it("states the strength rule registration uses", () => {
    expect(visibleText(html)).toContain("At least 10 characters");
  });

  it("warns that this ends every other session", () => {
    // The server deletes them all; a user should not discover that on their
    // phone twenty minutes later.
    expect(html).toContain("signs you out on every other device");
  });

  it("asks the browser not to autofill the old password, in both fields", () => {
    // A password manager offering the *current* password here would have the
    // user "reset" to what they already had.
    expect(html.split('autoComplete="new-password"')).toHaveLength(3);
  });

  it("shows the dead-link page, with a way to get a fresh link, when the token is missing", () => {
    // No matching route, so `useParams` yields no token — the same state as a
    // link mangled in transit, and the same fix.
    const dead = render("/reset", <ResetPassword />);
    expect(dead).toContain("This link has expired");
    expect(dead).toContain('href="/forgot"');
  });
});

describe("/login", () => {
  it("links to the reset flow", () => {
    const html = render(
      "/login",
      <Routes>
        <Route path="/login" element={<Login />} />
      </Routes>,
    );

    expect(html).toContain('href="/forgot"');
    expect(html).toContain("Forgot password?");
  });
});
