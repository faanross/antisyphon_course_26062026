import type { RequestHandler } from "./$types";
import { runRagInvestigation } from "../../../../framework/demo.js";
import { EmbeddingUnavailableError } from "../../../../framework/embeddings.js";

// NOTE: this route lives under /api/lab07/ for historical reasons but is owned and
// used EXCLUSIVELY by Lab 08 (src/routes/lab/08/+page.svelte). Lab 07's own page does
// not call it. Do not remove it as part of any "Lab 07 routes" cleanup.
//
// Streams the RAG pipeline as NDJSON so Lab 08 can show each stage as it happens:
//   embed -> retrieved -> context -> model-start -> token… -> done   (or: error)
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as { query?: string };
  const query = body.query ?? "";
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      async start(controller) {
        const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        try {
          await runRagInvestigation(query, send);
        } catch (error) {
          // Embedding model down is the common, actionable failure — surface its message
          // (the lab renders it instead of crashing).
          const message =
            error instanceof EmbeddingUnavailableError
              ? error.message
              : error instanceof Error
                ? error.message
                : "Unknown RAG error";
          send({ type: "error", message });
        } finally {
          controller.close();
        }
      },
    }),
    { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache" } },
  );
};
