import { QueryClient } from "@tanstack/react-query";

/**
 * Defaults tuned for an app whose data costs real money to fetch: DataForSEO
 * results are already cached server-side per workspace, so refetching on focus
 * buys nothing and can burn credits on a cache miss.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
