/**
 * Acting on the OAuth callback's landing parameters.
 *
 * The classification is pure and lives in `components/gsc/callback.ts`; this is
 * the thin layer that performs its consequences — a toast, a status refetch, a
 * notice to render, and cleaning the parameters out of the URL.
 *
 * **It runs exactly once per arrival.** The effect clears the parameters it
 * consumed, so the re-render it triggers finds nothing left to do. The failure
 * notice therefore lives in state rather than being derived from the URL: it
 * has to outlive the parameter that produced it, or it would flash and vanish
 * in the same frame.
 *
 * That state is *seeded* from the first render's query string rather than only
 * being filled in by the effect. Effects run after paint, so deriving it in the
 * effect alone would show the user a page that looks like an ordinary failed
 * connection attempt for a frame before the explanation arrived — and would
 * make the notice invisible to a server render, which is how this module's
 * states are tested.
 *
 * **A cancellation produces nothing at all** — no toast, no notice, no state.
 * `access_denied` means the user read Google's consent screen and said no. They
 * know what happened; the Connect button is still on screen if they change
 * their mind, and explaining their own decision back to them would be the app
 * arguing with the user.
 */
import { useQueryClient } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import {
  clearedGscCallbackParams,
  hasGscCallbackParams,
  readGscCallback,
} from "../../components/gsc/callback";
import { gscKeys } from "../../components/gsc/queries";
import { useToast } from "../../components/ui";

interface CallbackNotice {
  title: string;
  body: string;
}

/** The notice a query string deserves, if any. Shared by the seed and the effect. */
function noticeFor(search: string): CallbackNotice | null {
  const outcome = readGscCallback(search);
  return outcome.kind === "failed"
    ? { title: outcome.title, body: outcome.body }
    : null;
}

export function useGscCallback({
  workspaceId,
  projectId,
}: {
  workspaceId: string | null;
  projectId: string | null;
}): React.ReactNode {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const search = searchParams.toString();

  // Seeded from the first render, then maintained by the effect below.
  const [notice, setNotice] = useState<CallbackNotice | null>(() =>
    noticeFor(search),
  );

  useEffect(() => {
    if (!hasGscCallbackParams(search)) return;

    const outcome = readGscCallback(search);

    if (outcome.kind === "connected") {
      toast({
        title: "Google Search Console connected",
        description:
          "Now choose which Search Console property this project should read.",
        tone: "success",
      });
      /*
       * The status this page switched on was fetched before the round trip to
       * Google, so it still says "not connected". Invalidating the whole
       * `["gsc"]` tree is coarse but correct: the connection changed, and any
       * cached report under it describes a state that no longer exists.
       */
      void queryClient.invalidateQueries({ queryKey: gscKeys.all });
    }

    // "cancelled" resolves to null here, which is the whole point: the user
    // said no and does not need telling.
    setNotice(noticeFor(search));

    // Consume the parameters. Left in place, a reload would re-announce a
    // success that already happened or a failure that has since been fixed.
    setSearchParams((current) => clearedGscCallbackParams(current), {
      replace: true,
    });
  }, [search, setSearchParams, queryClient, toast, workspaceId, projectId]);

  if (notice === null) return null;

  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-app border border-danger-subtle bg-danger-subtle p-4 text-danger-on-subtle sm:flex-row sm:items-start"
    >
      <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm font-semibold">{notice.title}</p>
        <p className="text-sm leading-relaxed">{notice.body}</p>
      </div>
      <button
        type="button"
        onClick={() => setNotice(null)}
        className="shrink-0 rounded-app border border-current px-3 py-1 text-xs font-medium hover:underline"
      >
        Dismiss
      </button>
    </div>
  );
}
