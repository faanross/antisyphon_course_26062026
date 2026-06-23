import type { RequestHandler } from "./$types";
import { buildCampaignSubgraph } from "../../../../../framework/graph.js";
import { loadCandidates } from "../../../../../framework/loaders.js";
import { runDetectionFanOut } from "../../../../../framework/orchestrator.js";
import { synthesizeNarrative } from "../../../../../framework/narrative.js";

// Streams the narrative stage as NDJSON so the lab shows live progress instead of a
// frozen button. The flow is exactly what the lab teaches (the read side of the graph):
//   1. detection fan-out (Lab 09) to gather REAL findings, streaming each stage
//   2. scope the graph to the TRUE-POSITIVE campaign + the entities those findings touch
//      (false-positive noise is dropped, so the graph stays legible and on-message)
//   3. ONE grounded model call over that scoped graph, streamed token-by-token
// The graph sent to the client is the SAME graph the narrative is grounded in, so every
// entity the story names is a node on screen. Assessment is intentionally NOT run here.
export const POST: RequestHandler = async () => {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      async start(controller) {
        const send = (event: unknown) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };

        try {
          const candidates = await loadCandidates();

          // 1 · Real findings via the Lab 09 fan-out, streaming each stage as it happens.
          const { findings } = await runDetectionFanOut((ev) =>
            send({ type: "progress", stage: ev.stage, message: ev.message, data: ev.data }),
          );
          const campaign = findings.filter((f) => f.verdict === "true_positive");

          // 2 · Scope the graph to the true-positive campaign (display === grounding).
          const graph = buildCampaignSubgraph(candidates, findings);
          send({ type: "graph", graph });
          send({ type: "findings", count: campaign.length });

          // 3 · One grounded call over the scoped graph, streamed token-by-token.
          send({ type: "progress", stage: "narrative", message: "Synthesizing grounded narrative" });
          const narrative = await synthesizeNarrative(campaign, graph, (token) =>
            send({ type: "narrative-token", value: token }),
          );
          send({ type: "narrative-done", narrative });
          send({ type: "done" });
        } catch (err) {
          send({ type: "error", message: err instanceof Error ? err.message : "Narrative run failed" });
        } finally {
          controller.close();
        }
      },
    }),
    {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-cache",
      },
    },
  );
};
