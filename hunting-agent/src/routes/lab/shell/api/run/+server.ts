import type { RequestHandler } from "./$types";
import { runShellAgentStreaming } from "../../../../../framework/shell-lab.js";

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as { goal?: string };
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      async start(controller) {
        const send = (event: unknown) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };
        try {
          await runShellAgentStreaming(body.goal ?? "", send);
        } catch (error) {
          send({ type: "error", message: error instanceof Error ? error.message : "Shell agent failed" });
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
