import { getProvider } from "./providers/index.js";
import type { LLMProvider } from "./providers/types.js";
import { addAnalysis, addInput } from "./state.js";
import type { Candidate } from "./loaders.js";
import type { PipelineState } from "./types.js";
import { buildRagContext, embedQuery, queryPriorInvestigations, type RagHit } from "./rag.js";
import { embedConfig, EMBED_DIMENSIONS } from "./embeddings.js";
import {
  executeAgentToolCall,
  isAgentToolName,
  LAB03_TOOL_DEFINITIONS,
  queryCandidates,
  renderToolCatalog,
  summarizeToolResults,
  type AgentToolCall,
  type AgentToolName,
  type ToolTrace,
} from "./tools.js";
import {
  buildMemoryCompactionPrompt,
  buildFinalTriagePrompt,
  buildToolDecisionPrompt,
  MEMORY_COMPACTION_SYSTEM_PROMPT,
  TRIAGE_SYSTEM_PROMPT,
} from "./prompts/triage.js";
import { CHAT_SYSTEM_PROMPT, buildChatPrompt, MEMORY_LAB_COMPACTION_PROMPT } from "./prompts/chat.js";
import { buildMemoryBudget, buildMemoryText, memTriggerRatio, planMemory } from "./memory-lab.js";
import { loadContextDocuments, renderContextBlock } from "./context.js";
import {
  applyCompactionSummary,
  buildContextBundle,
  estimateTokens,
  getOrCreateSession,
  planSessionCompaction,
  saveSession,
  type ChatSession,
  type ContextBudgetReport,
  type ContextCompactionReport,
  type ConversationTurn,
  type SessionCompactionPlan,
  withTurnTokenEstimates,
} from "./session.js";

export interface ChatTurnResult {
  readonly message: string;
  readonly state: PipelineState;
  readonly candidates: readonly Candidate[];
  readonly toolTraces: readonly ToolTrace[];
  readonly contextBudget: ContextBudgetReport;
  readonly availableTools: typeof LAB03_TOOL_DEFINITIONS;
}

export type ChatTurnStreamEvent =
  | { readonly type: "status"; readonly message: string }
  | {
      readonly type: "metadata";
      readonly candidates: readonly Candidate[];
      readonly toolTraces: readonly ToolTrace[];
      readonly contextBudget: ContextBudgetReport;
      readonly availableTools: typeof LAB03_TOOL_DEFINITIONS;
    }
  | { readonly type: "token"; readonly token: string }
  | { readonly type: "done"; readonly result: ChatTurnResult }
  | { readonly type: "error"; readonly message: string };

export type ChatTurnStreamSink = (event: ChatTurnStreamEvent) => void;

interface ToolDecision {
  readonly thought: string;
  readonly action: "call_tool" | "finish";
  readonly tool?: AgentToolName;
  readonly args?: Record<string, unknown>;
  readonly finalAnswer?: string;
}

interface TaoLoopResult {
  readonly traces: readonly ToolTrace[];
  readonly candidates: readonly Candidate[];
  readonly observations: readonly string[];
  readonly promptTokens: number;
  readonly finalDraft?: string;
}

const MAX_TAO_STEPS = 4;

interface SessionCompactionResult {
  readonly session: ChatSession;
  readonly report: ContextCompactionReport;
}

function compactionReason(plan: SessionCompactionPlan): string {
  if (plan.estimatedTokens < plan.triggerTokens) {
    return `Below trigger: ${plan.estimatedTokens}/${plan.triggerTokens} estimated retained-context tokens.`;
  }
  if (plan.turnsToCompact.length < 2) {
    return "At or above trigger, but there are not enough older middle turns to compact yet.";
  }
  return "Eligible for compaction.";
}

function createCompactionReport(input: {
  readonly plan: SessionCompactionPlan;
  readonly occurred: boolean;
  readonly reason: string;
  readonly afterTokens?: number;
}): ContextCompactionReport {
  return {
    checked: true,
    occurred: input.occurred,
    beforeTokens: input.plan.estimatedTokens,
    afterTokens: input.afterTokens ?? input.plan.estimatedTokens,
    triggerTokens: input.plan.triggerTokens,
    ratio: input.plan.triggerRatio,
    compactedTurns: input.occurred ? input.plan.turnsToCompact.length : 0,
    compactedToolTraces: input.occurred ? input.plan.toolTracesToCompact.length : 0,
    retainedTurns: input.plan.retainedTurns.length,
    retainedToolTraces: input.plan.retainedToolTraces.length,
    reason: input.reason,
  };
}

function addHarnessBudgetDetails(
  budget: ContextBudgetReport,
  report: ContextCompactionReport,
): ContextBudgetReport {
  const systemPromptTokens = estimateTokens(TRIAGE_SYSTEM_PROMPT);
  const toolCatalogTokens = estimateTokens(renderToolCatalog());
  return {
    ...budget,
    systemPromptTokens,
    toolCatalogTokens,
    contextSections: [
      {
        id: "system-prompt",
        label: "System prompt",
        tokens: systemPromptTokens,
        description: "Stable analyst and safety instructions included in model calls.",
      },
      {
        id: "tool-catalog",
        label: "Tool catalog",
        tokens: toolCatalogTokens,
        description: "Names, arguments, and return shapes exposed during tool selection.",
      },
      ...budget.contextSections,
    ],
    compaction: {
      ...report,
      afterTokens: budget.retainedContextTokens,
    },
  };
}

async function compactSessionIfNeeded(
  provider: LLMProvider,
  session: ChatSession,
  currentMessage: string,
  onStatus?: (message: string) => void,
): Promise<SessionCompactionResult> {
  const plan = planSessionCompaction(session, currentMessage);
  if (!plan.shouldCompact) {
    return {
      session,
      report: createCompactionReport({
        plan,
        occurred: false,
        reason: compactionReason(plan),
      }),
    };
  }

  onStatus?.(`Compacting memory (${plan.turnsToCompact.length} older turns)`);

  try {
    const result = await provider.invoke({
      systemPrompt: MEMORY_COMPACTION_SYSTEM_PROMPT,
      userPrompt: buildMemoryCompactionPrompt({
        existingSummary: session.memorySummary,
        turnsToCompact: plan.turnsToCompact,
        toolTracesToCompact: plan.toolTracesToCompact,
      }),
    });
    const compacted = saveSession(applyCompactionSummary(session, plan, result.text));
    return {
      session: compacted,
      report: createCompactionReport({
        plan,
        occurred: true,
        reason: `Compacted ${plan.turnsToCompact.length} older middle turns into ChatSession.memorySummary.`,
      }),
    };
  } catch {
    return {
      session,
      report: createCompactionReport({
        plan,
        occurred: false,
        reason: "Compaction was needed, but the summarizer call failed. The harness continued without compacting.",
      }),
    };
  }
}

// Return the balanced JSON object starting at `start` (string/escape aware),
// or undefined if it never balances (truncated).
function balancedObjectFrom(text: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

function looksLikeDecision(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return "action" in obj || "tool" in obj || "thought" in obj || "finalAnswer" in obj;
}

// Find the first JSON object in the text that BOTH parses as JSON AND looks like
// a tool decision. Scanning every "{" (not just the first) and requiring a valid
// parse means stray braces in prose — e.g. GUIDs like {DEV-WS03-7219-648f1980} —
// are skipped, so a plain-text final answer is never mistaken for broken JSON.
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

// True when the model answered in prose (no parseable tool decision) after it
// already gathered evidence — that prose IS the final answer, not an error.
function isTextFinalAnswer(text: string, observationCount: number): boolean {
  return observationCount > 0
    && text.trim().length > 0
    && parseDecisionObject(text) === undefined;
}

function parseToolDecision(text: string): ToolDecision {
  const parsed = parseDecisionObject(text);
  if (!parsed) {
    throw new Error(`Model did not return a tool decision. Raw response: ${text.slice(0, 240)}`);
  }

  const thought = typeof parsed.thought === "string" && parsed.thought.trim()
    ? parsed.thought.trim()
    : "No rationale provided.";
  const action = parsed.action === "finish" ? "finish" : "call_tool";

  if (action === "finish") {
    return {
      thought,
      action,
      finalAnswer: typeof parsed.finalAnswer === "string" ? parsed.finalAnswer : undefined,
    };
  }

  const tool = typeof parsed.tool === "string" ? parsed.tool : "";
  if (!isAgentToolName(tool)) {
    throw new Error(`Model selected unavailable tool: ${tool || "(missing)"}`);
  }

  const args = parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args)
    ? parsed.args as Record<string, unknown>
    : {};

  return { thought, action, tool, args };
}

function invalidToolTrace(step: number, rawText: string, error: unknown): ToolTrace {
  return {
    id: `tool-${Date.now()}-${step}-invalid`,
    step,
    thought: "The model produced an invalid tool request.",
    tool: "invalid_tool_decision",
    args: {},
    status: "error",
    resultCount: 0,
    elapsedMs: 0,
    observation: error instanceof Error
      ? `${error.message}. Raw model response: ${rawText.slice(0, 180)}`
      : `Invalid tool request. Raw model response: ${rawText.slice(0, 180)}`,
  };
}

async function runTaoLoop(
  provider: LLMProvider,
  userMessage: string,
  contextText: string,
): Promise<TaoLoopResult> {
  const traces: ToolTrace[] = [];
  const observations: string[] = [];
  const candidateMap = new Map<string, Candidate>();
  let promptTokens = 0;
  let finalDraft: string | undefined;

  for (let step = 1; step <= MAX_TAO_STEPS; step += 1) {
    const decisionPrompt = buildToolDecisionPrompt({ userMessage, contextText, observations });
    promptTokens += estimateTokens(`${TRIAGE_SYSTEM_PROMPT}\n\n${decisionPrompt}`);
    const decisionResult = await provider.invoke({
      systemPrompt: TRIAGE_SYSTEM_PROMPT,
      userPrompt: decisionPrompt,
    });

    let decision: ToolDecision;
    try {
      decision = parseToolDecision(decisionResult.text);
    } catch (error) {
      if (isTextFinalAnswer(decisionResult.text, observations.length)) {
        finalDraft = decisionResult.text.trim();
        break;
      }
      const trace = invalidToolTrace(step, decisionResult.text, error);
      traces.push(trace);
      observations.push(`Observation ${step}: ${trace.observation}`);
      break;
    }

    if (decision.action === "finish") {
      finalDraft = decision.finalAnswer;
      break;
    }

    const execution = await executeAgentToolCall(
      {
        tool: decision.tool,
        args: decision.args ?? {},
      } as AgentToolCall,
      step,
      decision.thought,
    );
    traces.push(execution.trace);
    for (const candidate of execution.candidates) candidateMap.set(candidate.candidate_id, candidate);

    observations.push([
      `Observation ${step}:`,
      `Tool: ${execution.trace.tool}`,
      `Args: ${JSON.stringify(execution.trace.args)}`,
      `Result count: ${execution.trace.resultCount}`,
      `Summary: ${execution.trace.observation}`,
      `Returned data: ${summarizeToolResults(execution.results)}`,
    ].join("\n"));

    if (execution.trace.status === "error") break;
  }

  return {
    traces,
    candidates: [...candidateMap.values()],
    observations,
    promptTokens,
    finalDraft,
  };
}

function buildFinalPromptAndBudget(input: {
  readonly userMessage: string;
  readonly contextText: string;
  readonly observations: readonly string[];
  readonly finalDraft?: string;
  readonly taoPromptTokens: number;
}): { finalPrompt: string; promptTokens: number } {
  const finalPrompt = buildFinalTriagePrompt({
    userMessage: input.userMessage,
    contextText: input.contextText,
    observations: input.observations,
    finalDraft: input.finalDraft,
  });
  return {
    finalPrompt,
    promptTokens: input.taoPromptTokens + estimateTokens(`${TRIAGE_SYSTEM_PROMPT}\n\n${finalPrompt}`),
  };
}

export async function processChatTurn(
  message: string,
  sessionId = "lab03-session",
): Promise<ChatTurnResult> {
  const provider = getProvider();
  const compaction = await compactSessionIfNeeded(provider, getOrCreateSession(sessionId), message);
  const session = compaction.session;
  const input = {
    id: `input-${Date.now()}`,
    value: message,
    timestamp: new Date().toISOString(),
  };
  let state = addInput(session.state, input);

  const context = buildContextBundle(session, message);
  const contextBudgetBase = addHarnessBudgetDetails(context.budget, compaction.report);
  const tao = await runTaoLoop(provider, message, context.text);
  const visibleCandidates = tao.candidates.length > 0
    ? tao.candidates
    : await queryCandidates({ type: "beacon", limit: 5 });
  const finalTurn = buildFinalPromptAndBudget({
    userMessage: message,
    contextText: context.text,
    observations: tao.observations,
    finalDraft: tao.finalDraft,
    taoPromptTokens: tao.promptTokens,
  });

  const modelResult = await provider.invoke({
    systemPrompt: TRIAGE_SYSTEM_PROMPT,
    userPrompt: finalTurn.finalPrompt,
  });

  const response = modelResult.text;
  const contextBudget = withTurnTokenEstimates(
    contextBudgetBase,
    finalTurn.promptTokens,
    estimateTokens(response),
  );
  state = addAnalysis(state, {
    id: `analysis-${Date.now()}`,
    insight: response,
    basedOnId: input.id,
    model: modelResult.model,
    timestamp: new Date().toISOString(),
  });
  const turns: ConversationTurn[] = [
    ...session.turns,
    { role: "user", content: message, timestamp: input.timestamp },
    { role: "assistant", content: response, timestamp: new Date().toISOString() },
  ];
  const toolTraces = [...session.toolTraces, ...tao.traces];
  saveSession({
    ...session,
    state,
    turns,
    toolTraces,
  });

  return {
    message: response,
    state,
    candidates: visibleCandidates,
    toolTraces: tao.traces,
    contextBudget,
    availableTools: LAB03_TOOL_DEFINITIONS,
  };
}

export async function processChatTurnStreaming(
  message: string,
  sessionId = "lab03-session",
  onEvent: ChatTurnStreamSink,
): Promise<ChatTurnResult> {
  const provider = getProvider();
  const compaction = await compactSessionIfNeeded(
    provider,
    getOrCreateSession(sessionId),
    message,
    (status) => onEvent({ type: "status", message: status }),
  );
  const session = compaction.session;
  const input = {
    id: `input-${Date.now()}`,
    value: message,
    timestamp: new Date().toISOString(),
  };
  let state = addInput(session.state, input);

  const context = buildContextBundle(session, message);
  const contextBudgetBase = addHarnessBudgetDetails(context.budget, compaction.report);
  onEvent({ type: "status", message: "Selecting tools" });
  const tao = await runTaoLoop(provider, message, context.text);
  const visibleCandidates = tao.candidates.length > 0
    ? tao.candidates
    : await queryCandidates({ type: "beacon", limit: 5 });
  const toolTraces = [...session.toolTraces, ...tao.traces];
  const finalTurn = buildFinalPromptAndBudget({
    userMessage: message,
    contextText: context.text,
    observations: tao.observations,
    finalDraft: tao.finalDraft,
    taoPromptTokens: tao.promptTokens,
  });
  const promptOnlyBudget = withTurnTokenEstimates(contextBudgetBase, finalTurn.promptTokens, 0);

  onEvent({
    type: "metadata",
    candidates: visibleCandidates,
    // Display only THIS turn's tool steps; the session keeps the cumulative
    // trace (below) for context, but the UI renders one turn at a time.
    toolTraces: tao.traces,
    contextBudget: promptOnlyBudget,
    availableTools: LAB03_TOOL_DEFINITIONS,
  });
  onEvent({ type: "status", message: "Streaming response" });

  let streamedResponse = "";
  const modelResult = await provider.invoke({
    systemPrompt: TRIAGE_SYSTEM_PROMPT,
    userPrompt: finalTurn.finalPrompt,
    onToken: (token) => {
      streamedResponse += token;
      onEvent({ type: "token", token });
    },
  });

  const response = streamedResponse || modelResult.text;
  if (!streamedResponse && response) {
    onEvent({ type: "token", token: response });
  }
  const contextBudget = withTurnTokenEstimates(
    contextBudgetBase,
    finalTurn.promptTokens,
    estimateTokens(response),
  );

  state = addAnalysis(state, {
    id: `analysis-${Date.now()}`,
    insight: response,
    basedOnId: input.id,
    model: modelResult.model,
    timestamp: new Date().toISOString(),
  });
  const turns: ConversationTurn[] = [
    ...session.turns,
    { role: "user", content: message, timestamp: input.timestamp },
    { role: "assistant", content: response, timestamp: new Date().toISOString() },
  ];
  saveSession({
    ...session,
    state,
    turns,
    toolTraces,
  });

  const result = {
    message: response,
    state,
    candidates: visibleCandidates,
    toolTraces: tao.traces,
    contextBudget,
    availableTools: LAB03_TOOL_DEFINITIONS,
  };
  onEvent({ type: "done", result });
  return result;
}

// ── Lab 03 (Context Window): memory-only turn — no tools, single model call ──

export interface ChatMemoryResult {
  readonly message: string;
  readonly state: PipelineState;
  readonly contextBudget: ContextBudgetReport;
}

export type ChatMemoryStreamEvent =
  | { readonly type: "status"; readonly message: string }
  | { readonly type: "metadata"; readonly contextBudget: ContextBudgetReport }
  | { readonly type: "token"; readonly token: string }
  | { readonly type: "done"; readonly result: ChatMemoryResult }
  | { readonly type: "error"; readonly message: string };

export type ChatMemoryStreamSink = (event: ChatMemoryStreamEvent) => void;

// Keep the whole conversation verbatim; only compaction shrinks it. When the
// conversation crosses the trigger, summarize the oldest turns into memory and
// drop them — so the bar fills, then visibly falls.
async function compactMemoryIfNeeded(
  provider: LLMProvider,
  session: ChatSession,
  message: string,
  onStatus?: (status: string) => void,
): Promise<SessionCompactionResult> {
  const plan = planMemory(session, message);
  if (!plan.shouldCompact) {
    return {
      session,
      report: {
        checked: true,
        occurred: false,
        beforeTokens: plan.retainedTokens,
        afterTokens: plan.retainedTokens,
        triggerTokens: plan.triggerTokens,
        ratio: memTriggerRatio(),
        compactedTurns: 0,
        compactedToolTraces: 0,
        retainedTurns: session.turns.length,
        retainedToolTraces: 0,
        reason: plan.retainedTokens < plan.triggerTokens
          ? `Below trigger: ${plan.retainedTokens}/${plan.triggerTokens} tokens — still room, no compaction.`
          : `At the ${plan.triggerTokens} trigger, but only ${plan.olderTurns.length} older turn(s) — need 2 to compact.`,
      },
    };
  }

  onStatus?.(`Compacting ${plan.olderTurns.length} older turns into memory`);
  try {
    const result = await provider.invoke({
      systemPrompt: MEMORY_LAB_COMPACTION_PROMPT,
      userPrompt: buildMemoryCompactionPrompt({
        existingSummary: session.memorySummary,
        turnsToCompact: plan.olderTurns,
        toolTracesToCompact: [],
      }),
    });
    // Hard cap so the running memory can't balloon — keeps retained context
    // collapsing to a small floor after each compaction.
    const summary = result.text.trim().slice(0, 500);
    const compacted = saveSession({
      ...session,
      turns: [...plan.retainedTurns],
      memorySummary: summary,
      compactedTurnCount: session.compactedTurnCount + plan.olderTurns.length,
      compactionCount: session.compactionCount + 1,
      lastCompactedAt: new Date().toISOString(),
    });
    const afterTokens = estimateTokens(buildMemoryText(compacted, message));
    return {
      session: compacted,
      report: {
        checked: true,
        occurred: true,
        beforeTokens: plan.retainedTokens,
        afterTokens,
        triggerTokens: plan.triggerTokens,
        ratio: memTriggerRatio(),
        compactedTurns: plan.olderTurns.length,
        compactedToolTraces: 0,
        retainedTurns: compacted.turns.length,
        retainedToolTraces: 0,
        reason: `Conversation reached ${plan.retainedTokens} tokens, over the ${plan.triggerTokens} trigger. Summarized ${plan.olderTurns.length} older turns into a ${estimateTokens(summary)}-token memory and dropped them.`,
      },
    };
  } catch {
    return {
      session,
      report: {
        checked: true,
        occurred: false,
        beforeTokens: plan.retainedTokens,
        afterTokens: plan.retainedTokens,
        triggerTokens: plan.triggerTokens,
        ratio: memTriggerRatio(),
        compactedTurns: 0,
        compactedToolTraces: 0,
        retainedTurns: session.turns.length,
        retainedToolTraces: 0,
        reason: "Compaction was needed, but the summarizer call failed; continued without compacting.",
      },
    };
  }
}

export async function processChatMemoryTurn(
  message: string,
  sessionId = "lab03-context-session",
): Promise<ChatMemoryResult> {
  const provider = getProvider();
  const compaction = await compactMemoryIfNeeded(provider, getOrCreateSession(sessionId), message);
  const session = compaction.session;
  const input = { id: `input-${Date.now()}`, value: message, timestamp: new Date().toISOString() };
  let state = addInput(session.state, input);

  const contextText = buildMemoryText(session, message);
  const userPrompt = buildChatPrompt({ userMessage: message, contextText });
  const promptTokens = estimateTokens(CHAT_SYSTEM_PROMPT) + estimateTokens(userPrompt);

  const modelResult = await provider.invoke({ systemPrompt: CHAT_SYSTEM_PROMPT, userPrompt });
  const response = modelResult.text;

  state = addAnalysis(state, {
    id: `analysis-${Date.now()}`,
    insight: response,
    basedOnId: input.id,
    model: modelResult.model,
    timestamp: new Date().toISOString(),
  });
  const turns: ConversationTurn[] = [
    ...session.turns,
    { role: "user", content: message, timestamp: input.timestamp },
    { role: "assistant", content: response, timestamp: new Date().toISOString() },
  ];
  const saved = saveSession({ ...session, state, turns });

  // Budget reflects the POST-TURN conversation (question + answer now held).
  const budgetBase = buildMemoryBudget({ session: saved, compaction: compaction.report });
  const contextBudget = {
    ...withTurnTokenEstimates(budgetBase, promptTokens, estimateTokens(response)),
    currentMessageTokens: estimateTokens(message),
  };
  return { message: response, state, contextBudget };
}

export async function processChatMemoryTurnStreaming(
  message: string,
  sessionId = "lab03-context-session",
  onEvent: ChatMemoryStreamSink,
): Promise<ChatMemoryResult> {
  const provider = getProvider();
  const compaction = await compactMemoryIfNeeded(
    provider,
    getOrCreateSession(sessionId),
    message,
    (status) => onEvent({ type: "status", message: status }),
  );
  const session = compaction.session;
  const input = { id: `input-${Date.now()}`, value: message, timestamp: new Date().toISOString() };
  let state = addInput(session.state, input);

  const contextText = buildMemoryText(session, message);
  const userPrompt = buildChatPrompt({ userMessage: message, contextText });
  const promptTokens = estimateTokens(CHAT_SYSTEM_PROMPT) + estimateTokens(userPrompt);

  // Preliminary budget: conversation including the new user turn (answer not known yet).
  const preTurnSession: ChatSession = {
    ...session,
    turns: [...session.turns, { role: "user", content: message, timestamp: input.timestamp }],
  };
  onEvent({
    type: "metadata",
    contextBudget: {
      ...withTurnTokenEstimates(
        buildMemoryBudget({ session: preTurnSession, compaction: compaction.report }),
        promptTokens,
        0,
      ),
      currentMessageTokens: estimateTokens(message),
    },
  });
  onEvent({ type: "status", message: "Streaming response" });

  let streamedResponse = "";
  const modelResult = await provider.invoke({
    systemPrompt: CHAT_SYSTEM_PROMPT,
    userPrompt,
    onToken: (token) => {
      streamedResponse += token;
      onEvent({ type: "token", token });
    },
  });
  const response = streamedResponse || modelResult.text;
  if (!streamedResponse && response) onEvent({ type: "token", token: response });

  state = addAnalysis(state, {
    id: `analysis-${Date.now()}`,
    insight: response,
    basedOnId: input.id,
    model: modelResult.model,
    timestamp: new Date().toISOString(),
  });
  const turns: ConversationTurn[] = [
    ...session.turns,
    { role: "user", content: message, timestamp: input.timestamp },
    { role: "assistant", content: response, timestamp: new Date().toISOString() },
  ];
  const saved = saveSession({ ...session, state, turns });

  // Final budget reflects the POST-TURN conversation (question + answer now held).
  const contextBudget = {
    ...withTurnTokenEstimates(
      buildMemoryBudget({ session: saved, compaction: compaction.report }),
      promptTokens,
      estimateTokens(response),
    ),
    currentMessageTokens: estimateTokens(message),
  };
  const result: ChatMemoryResult = { message: response, state, contextBudget };
  onEvent({ type: "done", result });
  return result;
}

// The staged RAG pipeline, emitted as events so Lab 08 can teach each step as it happens.
export type RagStreamEvent =
  | { type: "embed"; query: string; model: string; dimensions: number; preview: number[] }
  | { type: "retrieved"; hits: RagHit[] }
  | { type: "context"; context: string }
  | { type: "model-start" }
  | { type: "token"; value: string }
  | { type: "done"; synthesis: string; model: string };

const RAG_SYNTH_SYSTEM_PROMPT =
  "You are a SOC analyst's assistant. Using ONLY the prior investigations in the provided context, " +
  "answer the analyst's question. Compare the evidence before borrowing a verdict, and cite the report " +
  "IDs you rely on (e.g. INV-2026-0087). Be concise. Format the answer in Markdown.";

export async function runRagInvestigation(
  query: string,
  onEvent?: (event: RagStreamEvent) => void,
): Promise<{ hits: RagHit[]; context: string; synthesis: string }> {
  const emit = (event: RagStreamEvent) => onEvent?.(event);

  // 1 · Embed — the query becomes a vector (throws EmbeddingUnavailableError if Ollama is down).
  // Embed once here so the stream can show the query's REAL first dims, then reuse it for retrieval.
  const queryVector = await embedQuery(query);
  emit({
    type: "embed",
    query,
    model: embedConfig().model,
    dimensions: EMBED_DIMENSIONS,
    preview: queryVector.slice(0, 3).map((v) => Number(v.toFixed(4))),
  });

  // 2 · Retrieve — cosine similarity over the corpus, top-5 nearest chunks (reusing the vector above).
  const hits = await queryPriorInvestigations(query, 5, queryVector);
  emit({ type: "retrieved", hits });

  // 3 · Augment — assemble the retrieved text into the prompt the model will see.
  const contextDocs = await loadContextDocuments();
  const context = `${renderContextBlock(contextDocs)}\n\n${buildRagContext(hits)}`;
  emit({ type: "context", context });

  // 4 · Generate — stream the grounded answer. Default model, or RAG_SYNTH_MODEL if set.
  const provider = getProvider(process.env.RAG_SYNTH_MODEL || undefined);
  emit({ type: "model-start" });
  let synthesis = "";
  const response = await provider.invoke({
    systemPrompt: RAG_SYNTH_SYSTEM_PROMPT,
    userPrompt: `${query}\n\n${context}`,
    onToken: (token) => {
      synthesis += token;
      emit({ type: "token", value: token });
    },
  });
  const finalText = synthesis || response.text;
  emit({ type: "done", synthesis: finalText, model: response.model });
  return { hits, context, synthesis: finalText };
}

if (process.argv[1]?.endsWith("demo.ts")) {
  processChatTurn("Show me the beacon candidates above 0.7 and triage them.")
    .then((result) => console.log(result.message))
    .catch((error: unknown) => console.error(error));
}
