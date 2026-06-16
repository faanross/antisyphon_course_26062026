import { buildCandidateSubgraph, type Subgraph } from "./graph.js";
import { loadCandidates } from "./loaders.js";
import { synthesizeNarrative } from "./narrative.js";
import { getProvider } from "./providers/index.js";
import {
  executeDetectionInvocation,
  planDetectionInvocations,
} from "./skill-execution.js";
import { addAnalysis, addInput, createPipelineState } from "./state.js";
import { recordSkillFinding, recordVerdict } from "./feedback.js";
import type { DetectionFinding, PipelineState } from "./types.js";

export interface ProgressEvent {
  readonly stage: string;
  readonly message: string;
  /** Optional structured payload for visualisations (the capstone orchestration graph). */
  readonly data?: Record<string, unknown>;
}

// Fan-out / fan-in: load detection skills, pair each with every candidate that
// passes its invocation gate, then run all of those skill executions CONCURRENTLY
// as real model calls. Each worker returns a structured DetectionFinding; the
// orchestrator collects them (fan-in). A worker whose model output cannot be
// parsed is reported and dropped — never replaced with a fabricated finding.
export async function runDetectionFanOut(
  onProgress: (event: ProgressEvent) => void = () => {},
): Promise<{ findings: DetectionFinding[]; model: string }> {
  onProgress({ stage: "load", message: "Loading candidates" });
  const candidates = await loadCandidates();

  const invocations = await planDetectionInvocations(candidates);
  onProgress({
    stage: "fan-out",
    message: `Dispatching ${invocations.length} detection skill execution(s) concurrently: ${invocations
      .map((invocation) => `${invocation.skill.metadata.name} → ${invocation.trigger.candidate_id}`)
      .join(", ")}`,
    // Structured plan so a visualiser can pre-create one node per worker before any completes.
    data: {
      invocations: invocations.map((invocation) => ({
        id: `${invocation.skill.metadata.name}::${invocation.trigger.candidate_id}`,
        skill: invocation.skill.metadata.name,
        candidateId: invocation.trigger.candidate_id,
      })),
    },
  });

  const provider = getProvider();
  // Emit each worker's result the moment IT resolves (not after the whole batch), so the graph
  // animates real concurrency — nodes light up as their model call returns.
  const settled = await Promise.allSettled(
    invocations.map(async (invocation) => {
      const id = `${invocation.skill.metadata.name}::${invocation.trigger.candidate_id}`;
      try {
        const value = await executeDetectionInvocation(provider, invocation);
        onProgress({
          stage: "worker",
          message: `${invocation.skill.metadata.name} on ${invocation.trigger.candidate_id} → ${value.finding.verdict} (${value.finding.compositeScore.toFixed(2)})`,
          data: {
            id,
            skill: invocation.skill.metadata.name,
            candidateId: invocation.trigger.candidate_id,
            verdict: value.finding.verdict,
            score: Number(value.finding.compositeScore.toFixed(2)),
          },
        });
        return value;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        onProgress({
          stage: "worker-error",
          message: `${invocation.skill.metadata.name} on ${invocation.trigger.candidate_id} failed: ${reason}`,
          data: { id, skill: invocation.skill.metadata.name, candidateId: invocation.trigger.candidate_id, error: true },
        });
        throw err;
      }
    }),
  );

  const findings: DetectionFinding[] = [];
  let model = "";
  settled.forEach((outcome) => {
    if (outcome.status === "fulfilled") {
      findings.push(outcome.value.finding);
      model = outcome.value.model || model;
    }
  });

  onProgress({ stage: "fan-in", message: `Collected ${findings.length} detection finding(s)`, data: { count: findings.length } });
  return { findings, model };
}

export async function runInvestigation(
  onProgress: (event: ProgressEvent) => void = () => {},
): Promise<{ findings: DetectionFinding[]; narrative: string; model: string }> {
  const { findings, model } = await runDetectionFanOut(onProgress);
  onProgress({ stage: "graph", message: "Building shared entity graph" });
  const graph = buildCandidateSubgraph(await loadCandidates());
  onProgress({ stage: "narrative", message: "Synthesizing campaign narrative" });
  const narrative = await synthesizeNarrative(findings, graph);
  return { findings, narrative, model };
}

// Runs the real investigation and folds its REAL findings + narrative into a
// PipelineState, recording each verdict as structured feedback. This is what the
// downstream labs (feedback/report, capstone) consume — real model
// output, never a hand-seeded mock analysis.
export async function runInvestigationState(
  sessionId: string,
  onProgress: (event: ProgressEvent) => void = () => {},
): Promise<{
  state: PipelineState;
  findings: DetectionFinding[];
  narrative: string;
  graph: Subgraph;
  model: string;
}> {
  const { findings, narrative, model } = await runInvestigation(onProgress);
  const timestamp = new Date().toISOString();
  const inputId = `input-${sessionId}`;
  const analysisModel = model || "unknown-model";

  let state = createPipelineState(sessionId);
  state = addInput(state, {
    id: inputId,
    value: "Run the full Poisoned Coding Assistant investigation",
    timestamp,
  });

  for (const finding of findings) {
    state = addAnalysis(state, {
      id: `analysis-${finding.candidateId}-${finding.skillName}`,
      basedOnId: inputId,
      insight: `${finding.candidateId} via ${finding.skillName}: ${finding.verdict} (compositeScore ${finding.compositeScore}). ${finding.evidenceSummary} ${finding.attackNarrative} Uncertainty: ${finding.uncertainty}`.trim(),
      model: analysisModel || "unknown-model",
      timestamp,
    });
    recordVerdict({
      candidateId: finding.candidateId,
      verdict: finding.verdict,
      rationale: finding.evidenceSummary,
    });
    recordSkillFinding(finding.skillName, finding.verdict);
  }

  state = addAnalysis(state, {
    id: "analysis-campaign-narrative",
    basedOnId: inputId,
    insight: narrative,
    model: analysisModel || "unknown-model",
    timestamp,
  });

  const graph = buildCandidateSubgraph(await loadCandidates());
  return { state: { ...state, findings }, findings, narrative, graph, model };
}
