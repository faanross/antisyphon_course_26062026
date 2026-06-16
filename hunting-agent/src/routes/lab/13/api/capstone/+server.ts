import { env } from "$env/dynamic/private";
import type { RequestHandler } from "./$types";
import { runInvestigationState } from "../../../../../framework/orchestrator.js";
import { getVerdictTable } from "../../../../../framework/feedback.js";
import { buildVerdictNotification, createNotifier } from "../../../../../framework/notifications.js";
import { buildFinalReport, saveFinalReport } from "../../../../../framework/report.js";

// Streams the full hunt as NDJSON: one { type: "progress", stage, message } per pipeline
// stage as it happens, then a single { type: "result", ... } at the end. Only stage/step
// STATUS is streamed — never an individual finding object — so no intermediate finding
// shape is rendered to the student; the capstone just shows the stages running, then output.
export const POST: RequestHandler = async () => {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      async start(controller) {
        const send = (event: unknown) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };

        try {
          // The full hunt, end to end, on REAL model output: fan-out detection findings,
          // shared entity graph, graph-grounded narrative, and the assembled report + notification.
          const { findings, narrative, graph } = await runInvestigationState("capstone", (ev) =>
            send({ type: "progress", stage: ev.stage, message: ev.message, data: ev.data }),
          );

          send({ stage: "report", type: "progress", message: "Assembling final report and notification" });
          const verdicts = getVerdictTable();
          const report = await saveFinalReport(buildFinalReport({ verdicts, narrative }));
          const notificationEvent = buildVerdictNotification({ verdicts, report });
          const notification = await createNotifier({
            NOTIFIER: env.NOTIFIER,
            SLACK_WEBHOOK_URL: env.SLACK_WEBHOOK_URL,
            NOTIFICATION_WEBHOOK_URL: env.NOTIFICATION_WEBHOOK_URL,
          }).notify(notificationEvent);

          send({ stage: "done", type: "progress", message: "Hunt complete" });
          send({
            type: "result",
            result: { graph, findings, narrative, report, event: notificationEvent, notification, verdicts },
          });
          send({ type: "done" });
        } catch (err) {
          send({ type: "error", message: err instanceof Error ? err.message : "Capstone run failed" });
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
