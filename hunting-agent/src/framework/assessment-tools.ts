// Assessment tool registry for Lab 07 — the entity-scoped context the assessment agent
// retrieves ITSELF in a bounded tool loop (the canonical aionsec_HUNT mechanism). Backed by
// the shared context-resolver, so the entity -> file mapping has one source of truth.
//
// We define our own AssessmentToolTrace / makeAssessmentTrace rather than reuse tools.ts's
// ToolTrace: that type's `tool` field is the closed Lab-04 `ToolTraceName` union, which does
// not include these assessment tool names. The shape is otherwise identical, so the Lab-04
// windowed-insight markup ports over unchanged.
import { resolveContextRequirement } from "./context-resolver.js";

export type AssessmentToolName = "get_asset_record" | "get_incident_history";
export type AssessmentToolTraceName = AssessmentToolName | "invalid_tool_decision";

export interface AssessmentToolDefinition {
  readonly name: AssessmentToolName;
  readonly purpose: string;
  readonly args: readonly string[];
  readonly returns: string;
}

export interface AssessmentToolTrace {
  readonly id: string;
  readonly step: number;
  readonly thought: string;
  readonly tool: AssessmentToolTraceName;
  readonly args: Record<string, unknown>;
  readonly status: "ok" | "error";
  readonly resultCount: number;
  readonly elapsedMs: number;
  readonly observation: string;
}

export const ASSESSMENT_TOOL_DEFINITIONS: readonly AssessmentToolDefinition[] = [
  {
    name: "get_asset_record",
    purpose: "Fetch the Layer-1 asset record for the host and/or user named in the finding (role, criticality, blast radius, owner team).",
    args: ["host?", "user?"],
    returns: "Asset-record markdown for every entity named in the call — pass host and user together to get both in one call.",
  },
  {
    name: "get_incident_history",
    purpose: "Fetch the Layer-5 prior-incident history for a host or subnet named in the finding (precedent TP / FP verdicts).",
    args: ["host?", "subnet?"],
    returns: "Incident-history markdown for the named entity.",
  },
];

export function isAssessmentToolName(name: string): name is AssessmentToolName {
  return ASSESSMENT_TOOL_DEFINITIONS.some((definition) => definition.name === name);
}

export function renderAssessmentToolCatalog(allowed: readonly string[]): string {
  const tools = ASSESSMENT_TOOL_DEFINITIONS.filter((definition) => allowed.includes(definition.name));
  if (tools.length === 0) return "(no tools available)";
  return tools
    .map((definition) => `- ${definition.name}(${definition.args.join(", ")}) — ${definition.purpose} Returns: ${definition.returns}`)
    .join("\n");
}

export function makeAssessmentTrace(input: {
  readonly step: number;
  readonly thought: string;
  readonly tool: AssessmentToolTraceName;
  readonly args: Record<string, unknown>;
  readonly status: "ok" | "error";
  readonly resultCount: number;
  readonly elapsedMs: number;
  readonly observation: string;
}): AssessmentToolTrace {
  return { id: `atool-${Date.now()}-${input.step}-${Math.random().toString(36).slice(2)}`, ...input };
}

function pickEntityKey(args: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return key;
  }
  return undefined;
}

function truncate(text: string, max = 600): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}\n... [truncated]`;
}

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "body" in err) {
    const body = (err as { body?: unknown }).body;
    if (body && typeof body === "object" && "message" in body) {
      return String((body as { message?: unknown }).message);
    }
  }
  return err instanceof Error ? err.message : String(err);
}

export interface AssessmentToolResult {
  readonly trace: AssessmentToolTrace;
  readonly content: string;
}

// Execute one assessment tool call. Maps the tool to a resolve-requirement and reuses the
// shared resolver to read the per-entity markdown file. Errors become an error trace (the
// loop surfaces them and stops) — never a fabricated result.
export async function executeAssessmentTool(
  call: { tool: AssessmentToolName; args: Record<string, unknown> },
  entities: Record<string, string>,
  step: number,
  thought: string,
): Promise<AssessmentToolResult> {
  const startedAt = Date.now();
  try {
    let content = "";
    let resolvedFrom = "";
    let observationBody = "";
    let resultCount = 1;
    if (call.tool === "get_asset_record") {
      // The finding can name both a host and a user, and the agent often asks for both in
      // one call. Resolve EVERY entity key it requested (host, user) so a single call returns
      // every record asked for — otherwise the first key would win and the rest would be
      // silently dropped, forcing a redundant follow-up call for the same finding.
      const requested = (["host", "user"] as const).filter(
        (key) => typeof call.args[key] === "string" && (call.args[key] as string).trim() !== "" && Boolean(entities[key]),
      );
      const keys: readonly ("host" | "user")[] = requested.length > 0 ? requested : (["host"] as const);
      const fullSections: string[] = [];
      const shownSections: string[] = [];
      const labels: string[] = [];
      for (const key of keys) {
        const resolved = await resolveContextRequirement(
          { id: "asset", mode: "resolve", path: "", entity: key, layer: "layer_1_assets", reason: "asset record" },
          entities,
        );
        if (resolved.content.trim() !== "") {
          fullSections.push(resolved.content);
          shownSections.push(truncate(resolved.content));
          labels.push(`${key}=${entities[key] ?? "?"}`);
        }
      }
      content = fullSections.join("\n\n");
      observationBody = shownSections.join("\n\n");
      resolvedFrom = labels.join(", ");
      resultCount = Math.max(fullSections.length, 1);
    } else {
      const entityKey = pickEntityKey(call.args, ["host", "subnet"]) ?? "host";
      const resolved = await resolveContextRequirement(
        { id: "history", mode: "resolve", path: "", entity: entityKey, layer: "layer_5_incidents", suffix: "-history", reason: "incident history" },
        entities,
      );
      content = resolved.content;
      observationBody = truncate(content);
      resolvedFrom = `${entityKey}=${entities[entityKey] ?? "?"}`;
    }
    const observation = `${resolvedFrom} retrieved (${content.length} chars):\n${observationBody}`;
    const trace = makeAssessmentTrace({
      step, thought, tool: call.tool, args: call.args, status: "ok", resultCount, elapsedMs: Date.now() - startedAt, observation,
    });
    return { trace, content };
  } catch (err) {
    const trace = makeAssessmentTrace({
      step, thought, tool: call.tool, args: call.args, status: "error", resultCount: 0, elapsedMs: Date.now() - startedAt,
      observation: `Tool error: ${errorMessage(err)}`,
    });
    return { trace, content: "" };
  }
}
