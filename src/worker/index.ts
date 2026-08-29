import { createApp } from "./app";
import { sweepJobs } from "./cron";

const app = createApp();

export default {
  fetch: app.fetch,

  scheduled: async (controller, env, ctx) => {
    // waitUntil so a slow sweep cannot stall the cron invocation itself.
    ctx.waitUntil(
      sweepJobs(env)
        .then((result) => {
          console.log(
            JSON.stringify({ event: "cron.sweep", cron: controller.cron, ...result }),
          );
        })
        .catch((err: unknown) => {
          console.error(
            JSON.stringify({
              event: "cron.sweep.failed",
              cron: controller.cron,
              message: err instanceof Error ? err.message : String(err),
            }),
          );
        }),
    );
  },
} satisfies ExportedHandler<Env>;
