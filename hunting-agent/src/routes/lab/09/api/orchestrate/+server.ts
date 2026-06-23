import type { RequestHandler } from "./$types";
import { runDetectionFanOut, reduceFindingsToTriage } from "../../../../../framework/orchestrator.js";

// Streams the map-reduce as NDJSON so the lab shows each stage live:
//   trace… (load -> fan-out -> worker× -> fan-in) -> findings -> reduce-start -> reduce-token… -> reduce-done -> done
export const POST: RequestHandler = async () => {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      async start(controller) {
        const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        try {
          // MAP + collect: workers fire concurrently; each progress event streams as it happens.
          const { findings } = await runDetectionFanOut((event) => send({ type: "trace", event }));
          send({ type: "findings", findings });

          // REDUCE: one synthesis call over the whole batch, streamed token by token.
          send({ type: "reduce-start" });
          const triage = await reduceFindingsToTriage(findings, (token) => send({ type: "reduce-token", value: token }));
          send({ type: "reduce-done", triage });

          send({ type: "done" });
        } catch (error) {
          send({ type: "error", message: error instanceof Error ? error.message : "Orchestration error" });
        } finally {
          controller.close();
        }
      },
    }),
    { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache" } },
  );
};
