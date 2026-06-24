// Bounded agentic assessment loop for Lab 07 — the model retrieves its own entity context
// via tools (the canonical aionsec_HUNT mechanism), max 4 steps, text-parsed so it is
// provider-agnostic (works across all six providers exactly like Lab 04's triage loop).
//
// The decision parser is a Lab-07-local copy of the provider-agnostic parser in demo.ts,
// kept local to avoid editing Lab 04's working file (DRY-ing the two is a post-course task).
import type { LLMProvider } from "./providers/types.js";
import {
  executeAssessmentTool,
  isAssessmentToolName,
  makeAssessmentTrace,
  type AssessmentToolName,
  type AssessmentToolTrace,
} from "./assessment-tools.js";

export const MAX_ASSESSMENT_STEPS = 4;

// The tool-call format the model is given each retrieval step. Exported so the lab UI can show
// it next to the catalog — the same "here's how to call a tool" the Lab 04 prompt shows.
export const ASSESSMENT_DECISION_FORMAT = `Decide your next step. Reply with ONE JSON object: {"thought": string, "action": "call_tool" | "finish", "tool"?: string, "args"?: object}.
Call a tool to retrieve entity context you still need; reply {"action":"finish"} once you have enough context to judge. Do NOT write the assessment yet.`;

// ── decision parser (local copy of demo.ts's provider-agnostic parser) ─────────────────────

interface ToolDecision {
  readonly thought: string;
  readonly action: "call_tool" | "finish";
  readonly tool?: AssessmentToolName;
  readonly args?: Record<string, unknown>;
}

function balancedObjectFrom(text: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth += 1;
    else if (ch === "}") { depth -= 1; if (depth === 0) return text.slice(start, i + 1); }
  }
  return undefined;
}

function looksLikeDecision(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return "action" in obj || "tool" in obj || "thought" in obj || "finalAnswer" in obj;
}

function parseDecisionObject(text: string): Record<string, unknown> | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const sources = fenced?.[1] ? [fenced[1], text] : [text];
  for (const source of sources) {
    for (let i = 0; i < source.length; i += 1) {
      if (source[i] !== "{") continue;
      const slice = balancedObjectFrom(source, i);
      if (!slice) continue;
      try {
        const parsed = JSON.parse(slice);
        if (looksLikeDecision(parsed)) return parsed;
      } catch {
        // not valid JSON from this brace — keep scanning
      }
    }
  }
  return undefined;
}

function isTextFinalAnswer(text: string, observationCount: number): boolean {
  return observationCount > 0 && text.trim().length > 0 && parseDecisionObject(text) === undefined;
}

function parseToolDecision(text: string): ToolDecision {
  const parsed = parseDecisionObject(text);
  if (!parsed) throw new Error(`Model did not return a tool decision. Raw: ${text.slice(0, 240)}`);
  const thought = typeof parsed.thought === "string" && parsed.thought.trim() ? parsed.thought.trim() : "No rationale provided.";
  const action = parsed.action === "finish" ? "finish" : "call_tool";
  if (action === "finish") return { thought, action };
  const tool = typeof parsed.tool === "string" ? parsed.tool : "";
  if (!isAssessmentToolName(tool)) throw new Error(`Model selected unavailable tool: ${tool || "(missing)"}`);
  const args = parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args) ? (parsed.args as Record<string, unknown>) : {};
  return { thought, action, tool, args };
}

// ── the bounded loop ───────────────────────────────────────────────────────────────────────

export interface RetrievedContext {
  readonly tool: string;
  readonly content: string;
}

export interface AssessmentLoopResult {
  readonly traces: AssessmentToolTrace[];
  readonly observations: string[];
  readonly retrievedContext: RetrievedContext[];
  readonly assetFetched: boolean;
}

export async function runAssessmentAgentLoop(opts: {
  provider: LLMProvider;
  systemPrompt: string;
  toolCatalog: string;
  baseUserPrompt: string;
  entities: Record<string, string>;
  onToolStep?: (trace: AssessmentToolTrace) => void;
}): Promise<AssessmentLoopResult> {
  const traces: AssessmentToolTrace[] = [];
  const observations: string[] = [];
  const retrievedContext: RetrievedContext[] = [];
  let assetFetched = false;

  for (let step = 1; step <= MAX_ASSESSMENT_STEPS; step += 1) {
    const decisionPrompt = [
      opts.baseUserPrompt,
      "",
      "## Tools you may call",
      opts.toolCatalog,
      "",
      observations.length ? `## Observations so far\n${observations.join("\n\n")}` : "## Observations so far\n(none yet)",
      "",
      ASSESSMENT_DECISION_FORMAT,
    ].join("\n");

    const result = await opts.provider.invoke({ systemPrompt: opts.systemPrompt, userPrompt: decisionPrompt });

    let decision: ToolDecision;
    try {
      decision = parseToolDecision(result.text);
    } catch {
      // No parseable decision, or an unavailable tool. If the model already gathered context
      // and just wrote prose, treat it as "done gathering". Otherwise record an invalid step.
      if (!isTextFinalAnswer(result.text, observations.length)) {
        const trace = makeAssessmentTrace({
          step, thought: "The model produced an invalid tool request.", tool: "invalid_tool_decision",
          args: {}, status: "error", resultCount: 0, elapsedMs: 0,
          observation: `Could not parse a valid tool decision. Raw: ${result.text.slice(0, 180)}`,
        });
        traces.push(trace);
        opts.onToolStep?.(trace);
      }
      break;
    }

    if (decision.action === "finish" || !decision.tool) break;

    const { trace, content } = await executeAssessmentTool(
      { tool: decision.tool, args: decision.args ?? {} },
      opts.entities,
      step,
      decision.thought,
    );
    traces.push(trace);
    opts.onToolStep?.(trace);
    if (trace.status === "error") break;

    if (decision.tool === "get_asset_record") assetFetched = true;
    retrievedContext.push({ tool: decision.tool, content });
    observations.push(`Observation ${step} — ${decision.tool}: ${trace.observation}`);
  }

  return { traces, observations, retrievedContext, assetFetched };
}
