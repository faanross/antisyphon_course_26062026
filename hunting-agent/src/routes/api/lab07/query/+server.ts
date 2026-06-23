import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { runRagInvestigation } from "../../../../framework/demo.js";
import { EmbeddingUnavailableError } from "../../../../framework/embeddings.js";

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as { query?: string };
  try {
    return json(await runRagInvestigation(body.query ?? ""));
  } catch (error) {
    // The embedding model is a hard dependency for this lab — surface a clear,
    // actionable message instead of a 500/stack trace when Ollama isn't running.
    if (error instanceof EmbeddingUnavailableError) {
      return json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
};
