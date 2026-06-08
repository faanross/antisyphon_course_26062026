import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { resolvePermission } from "../../../../../framework/shell-lab.js";

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as { id?: string; decision?: "allow" | "deny" };
  if (!body.id || (body.decision !== "allow" && body.decision !== "deny")) {
    return json({ ok: false, error: "id and decision (allow|deny) are required" }, { status: 400 });
  }
  const resolved = resolvePermission(body.id, body.decision);
  return json({ ok: resolved });
};
