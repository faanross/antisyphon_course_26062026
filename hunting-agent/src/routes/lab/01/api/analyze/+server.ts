import { getProvider } from "../../../../../framework/providers/index.js";
import {
  addAnalysis,
  addInput,
  createPipelineState,
} from "../../../../../framework/state.js";
import type { RequestHandler } from "./$types";

function selectedModel(): string {
  const provider = process.env.LLM_PROVIDER ?? "mock";
  const modelByProvider: Record<string, string | undefined> = {
    mock: process.env.MOCK_MODEL,
    gemini: process.env.GEMINI_MODEL,
    anthropic: process.env.ANTHROPIC_MODEL,
    openai: process.env.OPENAI_MODEL,
    "claude-code": process.env.CLAUDE_CODE_MODEL,
    "codex-cli": process.env.CODEX_MODEL,
  };
  return modelByProvider[provider] ?? "mock-workshop-model";
}

const SYSTEM_PROMPT =
  "You are a concise security analyst. Given an observation, respond with a short initial analysis ONLY. " +
  "Begin directly with the analysis — do not narrate your process, do not mention checking or reading memory, " +
  "files, tools, skills, or project context, and add no preamble, meta-commentary, or sign-off.";

export const POST: RequestHandler = async ({ request }) => {
  const { text, sessionId } = (await request.json()) as {
    text?: string;
    sessionId?: string;
  };

  if (!text) {
    return new Response(JSON.stringify({ error: "text is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const provider = getProvider();
  const state0 = createPipelineState(sessionId ?? "session-ui");
  const state1 = addInput(state0, {
    id: `inp-${Date.now()}`,
    value: text,
    timestamp: new Date().toISOString(),
  });
  const input = state1.inputs[0]!;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (data: unknown) =>
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
        );

      emit({
        type: "meta",
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: text,
      });

      emit({ type: "stage", stage: "start" });
      emit({ type: "state", state: state0 });

      emit({ type: "stage", stage: "input-added" });
      emit({ type: "state", state: state1 });

      emit({ type: "stage", stage: "analyzing" });

      let accumulated = "";
      try {
        for await (const token of provider.streamInvoke({
          systemPrompt: SYSTEM_PROMPT,
          userPrompt: input.value,
        })) {
          accumulated += token;
          emit({ type: "token", token });
        }

        emit({ type: "stage", stage: "analysis-complete" });

        const state2 = addAnalysis(state1, {
          id: `an-${Date.now()}`,
          insight: accumulated,
          basedOnId: input.id,
          model: selectedModel(),
          timestamp: new Date().toISOString(),
        });

        emit({ type: "state", state: state2 });
        emit({ type: "stage", stage: "done" });
        emit({ type: "done" });
      } catch (err) {
        emit({
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};
