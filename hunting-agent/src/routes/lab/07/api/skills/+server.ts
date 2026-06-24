import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  listSkills,
  loadSkill,
  type SkillDocument,
  type SkillMetadata,
} from "../../../../../framework/skill-loader.js";
import { selectProvider } from "$lib/server/provider.js";
import { runAssessmentAgentLoop, ASSESSMENT_DECISION_FORMAT } from "../../../../../framework/assessment-agent-loop.js";
import { renderAssessmentToolCatalog, makeAssessmentTrace } from "../../../../../framework/assessment-tools.js";

type JsonRecord = Record<string, unknown>;

type Candidate = JsonRecord & {
  candidate_id?: string;
  type?: string;
  host?: string;
  user?: string;
  src_ip?: string;
  dest_ip?: string;
  dest_port?: number;
  matched_value?: string;
  process_guid?: string;
  process_name?: string;
  image?: string;
  parent_image?: string;
  compositeScore?: number;
  constituent_event_ids?: string[];
};

type EventRecord = JsonRecord & {
  event_id?: string;
  event_type?: string;
  host?: string;
  timestamp?: string;
  raw?: JsonRecord;
};

type CorrelationSpec = {
  type?: string;
  scope?: string;
};

type ContextRequirement = {
  id: string;
  mode: "static" | "resolve" | "retrieval" | string;
  path: string; // mode:static — a fixed, org-wide file (e.g. an escalation policy)
  entity?: string; // mode:resolve — which finding entity to key off (host | user | subnet)
  layer?: string; // mode:resolve — the context layer directory to look in
  suffix?: string; // mode:resolve — optional filename suffix (e.g. "-history")
  reason: string;
};

type ResolvedContext = ContextRequirement & {
  content: string;
  approxTokens: number;
  resolvedFrom?: string; // mode:resolve — the entity value it resolved to (e.g. "host=dev-ws03")
};

type TraceStep = {
  step: number;
  phase: "discover" | "inspect" | "context" | "query" | "execute";
  title: string;
  status: "ok" | "warning";
  detail: string;
  result: string;
};

const DATA_PATH = "src/lib/data/workshop/candidates_enriched.json";
const EVENT_PATH = "src/lib/data/workshop/events_enriched.json";
const FIELD_GUIDE_PATH = "context/schema/candidate-field-guide.md";

const ASSESSMENT_CORRELATIONS: CorrelationSpec[] = [
  { type: "tls_anomaly", scope: "same_network_tuple" },
  { type: "intel_match", scope: "destination" },
  { type: "data_transfer", scope: "same_process_secondary_flow" },
  { type: "powershell_invocation_anomaly", scope: "same_host" },
  { type: "unusual_parent_child_anomaly", scope: "same_host" },
];

// Human-readable meaning of each correlation scope (logic lives in matchesScope()).
const SCOPE_DESCRIPTIONS: Record<string, string> = {
  same_network_tuple: "Same source IP + destination IP pair as the upstream finding.",
  destination: "Same destination IP / domain as the upstream finding.",
  same_process_secondary_flow: "Emitted by the same process (or same host + process name) as the upstream finding.",
  same_host: "Observed on the same host as the upstream finding.",
};

type CandidateTypeDoc = { description: string; fields: string[]; scoreNote?: string };

type CandidateRef = CandidateTypeDoc & {
  type: string;
  role: "trigger" | "correlating";
  scope?: string;
  scopeDescription?: string;
};

// Parse the candidate field guide (## type → description, "Key fields:", "Score interpretation:")
// into a per-type map so the lab can show students what each candidate type actually is.
function parseFieldGuide(text: string): Record<string, CandidateTypeDoc> {
  const docs: Record<string, CandidateTypeDoc> = {};
  for (const section of text.split(/^##\s+/m).slice(1)) {
    const lines = section.split("\n");
    const type = (lines[0] ?? "").trim();
    if (!type) continue;
    const body = lines.slice(1);
    const descriptionLines: string[] = [];
    for (const line of body) {
      const trimmedLine = line.trim();
      if (/^(Key fields|Score interpretation)/.test(trimmedLine)) break;
      if (trimmedLine) descriptionLines.push(trimmedLine);
    }
    const description = descriptionLines.join(" ");
    const fieldsLine = body.find((line) => line.trim().startsWith("Key fields:")) ?? "";
    const fields = [...fieldsLine.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    const scoreLine = body.find((line) => line.trim().startsWith("Score interpretation:"));
    const scoreNote = scoreLine ? scoreLine.replace(/^Score interpretation:\s*/, "").trim() : undefined;
    docs[type] = { description, fields, scoreNote };
  }
  return docs;
}

// The assessment skill consumes an upstream DetectionFinding plus the correlating candidate
// types in ASSESSMENT_CORRELATIONS. The reference explains each so the evidence is not a black box.
function buildAssessmentCandidateReference(guide: Record<string, CandidateTypeDoc>): CandidateRef[] {
  const fallback: CandidateTypeDoc = { description: "No field-guide entry for this candidate type.", fields: [] };
  return ASSESSMENT_CORRELATIONS.map((spec) => {
    const type = spec.type ?? "";
    return {
      type,
      role: "correlating" as const,
      scope: spec.scope || undefined,
      scopeDescription: spec.scope ? SCOPE_DESCRIPTIONS[spec.scope] ?? "Custom correlation scope." : undefined,
      ...(guide[type] ?? fallback),
    };
  });
}

async function readJsonFile<T>(relativePath: string): Promise<T> {
  const content = await readFile(path.join(process.cwd(), relativePath), "utf8");
  return JSON.parse(content) as T;
}

async function readTextFile(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), "utf8");
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function candidateScore(candidate: Candidate): number {
  return Math.max(
    numberValue(candidate.compositeScore),
    numberValue(candidate.beacon_score),
    numberValue(candidate.tls_anomaly_score),
    numberValue(candidate.data_transfer_score),
    numberValue(candidate.unusual_parent_child_anomaly_score),
    numberValue(candidate.powershell_invocation_anomaly_score),
    numberValue(candidate.cert_anomaly_score),
  );
}

function candidateId(candidate: Candidate): string {
  return asString(candidate.candidate_id || "unknown-candidate");
}

function candidateType(candidate: Candidate): string {
  return asString(candidate.type || "unknown");
}

function processName(candidate: Candidate): string {
  return asString(candidate.process_name || candidate.image || candidate.process || "unknown-process")
    .split("\\")
    .at(-1) ?? "unknown-process";
}

function candidateLots(candidate: Candidate): string {
  const lotsMatch = candidate.lots_match;
  const enrichment = asRecord(candidate.enrichment);
  const lots = asString(
    candidate.lots_service ||
      candidate.lots_name ||
      candidate.service_name ||
      enrichment.lots_service ||
      enrichment.owner ||
      enrichment.service,
  );

  if (lots) return lots;
  if (lotsMatch === false) return "false";
  if (lotsMatch === true) return "true";
  return "none";
}

function eventIds(candidate: Candidate): string[] {
  return asArray(candidate.constituent_event_ids).map(String);
}

// Drop the bare event-ID arrays before a candidate is serialized into a MODEL prompt: the model
// cites behavioural candidate fields, not opaque event IDs, and the events it reasons over are
// supplied separately as rawEvents. Re-sent on every loop step, these arrays otherwise dominate
// the prompt. collectEvents has already run against the FULL candidates, so event resolution is
// unaffected — this only slims the copy that goes to the model.
function slimCandidateForModel(candidate: Candidate): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...candidate };
  delete copy.constituent_event_ids;
  const ev = copy.evidence;
  if (ev && typeof ev === "object" && !Array.isArray(ev)) {
    const evCopy = { ...(ev as Record<string, unknown>) };
    delete evCopy.constituent_event_ids;
    copy.evidence = evCopy;
  }
  return copy;
}

function compactCandidate(candidate: Candidate) {
  return {
    id: candidateId(candidate),
    type: candidateType(candidate),
    host: asString(candidate.host),
    srcIp: asString(candidate.src_ip),
    destIp: asString(candidate.dest_ip || candidate.matched_value),
    destPort: candidate.dest_port ?? "",
    processName: processName(candidate),
    processGuid: asString(candidate.process_guid),
    score: Number(candidateScore(candidate).toFixed(2)),
    lots: candidateLots(candidate),
    eventCount: eventIds(candidate).length,
  };
}

function summarizeCandidate(candidate: Candidate): string {
  const compact = compactCandidate(candidate);
  const destination = compact.destIp ? ` -> ${compact.destIp}` : "";
  return `${compact.id} (${compact.type}) on ${compact.host}${destination} via ${compact.processName}, score ${compact.score}`;
}

function summarizeEvent(event: EventRecord): string {
  const raw = asRecord(event.raw);
  const image = raw.Image || raw.image || raw.ProcessName || "";
  const dest = raw.DestinationIp || raw.dest_ip || event.dest_ip || "";
  const extra = image ? ` | ${image}` : dest ? ` | ${dest}` : "";
  return `${event.event_id ?? "event"} (${event.event_type ?? "unknown"})${extra}`;
}

function normalizeSkillPath(skillPath: string): string {
  const normalized = path.normalize(skillPath).replaceAll("\\", "/");
  if (!normalized.startsWith("skills/") || normalized.includes("../")) {
    throw error(400, "Skill path must point to a workshop skill under skills/.");
  }
  return normalized;
}

function normalizeContextPath(contextPath: string): string {
  const normalized = path.normalize(contextPath).replaceAll("\\", "/");
  if ((!normalized.startsWith("context/") && !normalized.startsWith("data/")) || normalized.includes("../")) {
    throw error(400, "Context path must point to a workshop context or data file.");
  }
  return normalized;
}

// An assessment skill for Lab 07 declares the tools it may call (allowedTools) — it retrieves
// its own entity context agentically, the canonical aionsec_HUNT mechanism — plus the static
// context sources to inject (contextSources).
function isLab06AssessmentSkill(skill: SkillDocument): boolean {
  const allowedTools = Array.isArray(skill.metadata.allowedTools) ? skill.metadata.allowedTools : [];
  return (
    skill.metadata.layer === "assessment" &&
    skill.path.startsWith("skills/assessment/") &&
    allowedTools.length > 0
  );
}

function assertLab06AssessmentSkill(skill: SkillDocument) {
  if (skill.metadata.layer !== "assessment") {
    throw error(400, "Lab 07 only executes assessment skills.");
  }
  if (!isLab06AssessmentSkill(skill)) {
    throw error(400, "Lab 07 runs assessment skills that declare allowedTools (agentic context retrieval).");
  }
}

function approxTokens(content: string): number {
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * 1.35));
}

// Deterministically derive the entity keys the resolver uses, from the finding's trigger candidate.
// host "DEV-WS03" -> "dev-ws03"; user "NORTHWIND\\jane.roberts" -> "jane-roberts"; src_ip -> a subnet slug.
function slugifyEntity(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[^\\]*\\/, "") // strip a leading DOMAIN\ from a user principal
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function findingEntities(candidate: Candidate): Record<string, string> {
  const ip = asString(candidate.src_ip);
  const subnet = ip ? `subnet-${ip.split(".").slice(0, 3).join("-")}` : "";
  return {
    host: slugifyEntity(asString(candidate.host)),
    user: slugifyEntity(asString(candidate.user)),
    subnet,
  };
}

async function resolveContextRequirement(
  requirement: ContextRequirement,
  entities: Record<string, string>,
): Promise<ResolvedContext> {
  // Entity-scoped context: pick the file for the FINDING'S entity — deterministic, never hardcoded.
  if (requirement.mode === "resolve") {
    const entityKey = requirement.entity ?? "";
    const entityValue = entities[entityKey] ?? "";
    if (!entityValue) {
      throw error(400, `Could not resolve entity '${entityKey}' from the finding for context '${requirement.id}'.`);
    }
    const builtPath = `context/layers/${requirement.layer ?? "layer_1_assets"}/${entityValue}${requirement.suffix ?? ""}.md`;
    const normalizedPath = normalizeContextPath(builtPath);
    const content = await readTextFile(normalizedPath);
    return {
      ...requirement,
      path: normalizedPath,
      content,
      approxTokens: approxTokens(content),
      resolvedFrom: `${entityKey}=${entityValue}`,
    };
  }

  if (requirement.mode !== "static") {
    throw error(400, `Lab 07 cannot resolve ${requirement.mode} context. Use Lab 08 for retrieval-backed context.`);
  }

  const normalizedPath = normalizeContextPath(requirement.path);
  const content = await readTextFile(normalizedPath);
  return {
    ...requirement,
    path: normalizedPath,
    content,
    approxTokens: approxTokens(content),
  };
}

function skillSummary(skill: SkillDocument) {
  return {
    path: skill.path,
    metadata: {
      ...skill.metadata,
    },
    frontmatter: skill.frontmatter,
    bodyPreview: skill.body.slice(0, 520),
    body: skill.body,
  };
}

function metadataArray(metadata: SkillMetadata, key: string): string[] {
  return asArray(metadata[key]).map(String);
}

function matchesScope(trigger: Candidate, candidate: Candidate, scope = ""): boolean {
  if (candidateId(trigger) === candidateId(candidate)) return false;

  if (scope === "same_network_tuple") {
    return Boolean(
      trigger.src_ip &&
        candidate.src_ip === trigger.src_ip &&
        trigger.dest_ip &&
        candidate.dest_ip === trigger.dest_ip,
    );
  }

  if (scope === "destination") {
    return Boolean(
      trigger.dest_ip &&
        (candidate.dest_ip === trigger.dest_ip || candidate.matched_value === trigger.dest_ip),
    );
  }

  if (scope === "same_process_secondary_flow") {
    return Boolean(
      (trigger.process_guid && candidate.process_guid === trigger.process_guid) ||
        (trigger.host && candidate.host === trigger.host && processName(candidate) === processName(trigger)),
    );
  }

  if (scope === "same_host") {
    return Boolean(trigger.host && candidate.host === trigger.host);
  }

  return true;
}

function collectRelated(trigger: Candidate, specs: CorrelationSpec[], candidates: Candidate[]) {
  return specs.map((spec) => {
    const matches = candidates
      .filter((candidate) => candidateType(candidate) === spec.type)
      .filter((candidate) => matchesScope(trigger, candidate, spec.scope))
      .sort((a, b) => candidateScore(b) - candidateScore(a));

    return {
      spec,
      matches,
    };
  });
}

function uniqueCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const id = candidateId(candidate);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function collectEvents(bundle: Candidate[], events: EventRecord[]) {
  const ids = new Set(bundle.flatMap(eventIds));
  return events.filter((event) => event.event_id && ids.has(event.event_id));
}

function upstreamCandidateId(upstreamFinding: JsonRecord): string {
  const trigger = asRecord(upstreamFinding.triggerCandidate);
  return asString(trigger.id || trigger.candidate_id || upstreamFinding.candidateId);
}

function upstreamRelatedIds(upstreamFinding: JsonRecord): string[] {
  const refs = asRecord(upstreamFinding.evidenceRefs);
  // New typed shape uses `candidateIds`; older handoffs used `relatedCandidateIds`.
  const ids = asArray(refs.candidateIds).length ? asArray(refs.candidateIds) : asArray(refs.relatedCandidateIds);
  return ids.map(String);
}

function chooseAssessmentEvidence(upstreamFinding: JsonRecord, candidates: Candidate[]) {
  const requestedId = upstreamCandidateId(upstreamFinding);
  const trigger =
    candidates.find((candidate) => candidateId(candidate) === requestedId) ??
    candidates.find((candidate) => candidateId(candidate) === "BEA-001") ??
    candidates[0];

  if (!trigger) {
    throw error(500, "No candidates are available for assessment.");
  }

  const relatedGroups = collectRelated(trigger, ASSESSMENT_CORRELATIONS, candidates);
  const relatedFromRefs = upstreamRelatedIds(upstreamFinding)
    .map((id) => candidates.find((candidate) => candidateId(candidate) === id))
    .filter((candidate): candidate is Candidate => Boolean(candidate));

  return {
    trigger,
    relatedGroups,
    related: uniqueCandidates([...relatedFromRefs, ...relatedGroups.flatMap((group) => group.matches)]),
    resolutionNote: requestedId
      ? `Resolved upstream trigger ${requestedId} to ${candidateId(trigger)}.`
      : `No upstream trigger id was present; fallback generated from ${candidateId(trigger)}.`,
  };
}

// Static, org-wide context sources (compliance) are INJECTED deterministically — identical for
// every finding. Entity-scoped sources (assets, incidents) are retrieved by the model via tools.
// This mirrors canonical aionsec_HUNT's hybrid: coarse inject + agentic tool retrieval.
const STATIC_CONTEXT_SOURCES: Record<string, string[]> = {
  compliance: [
    "context/layers/layer_2_compliance/escalation-policy.md",
    "context/layers/layer_2_compliance/evidence-preservation.md",
  ],
};

type ContextSection = { id: string; content: string };

async function resolveStaticContext(skill: SkillDocument): Promise<ContextSection[]> {
  const sources = Array.isArray(skill.metadata.contextSources) ? skill.metadata.contextSources : [];
  const sections: ContextSection[] = [];
  for (const source of sources) {
    const files = STATIC_CONTEXT_SOURCES[String(source)];
    if (!files) continue; // assets / incidents are tool-fetched, not injected
    for (const file of files) {
      sections.push({ id: file.split("/").pop() ?? file, content: await readTextFile(file) });
    }
  }
  return sections;
}

function contextSectionsText(sections: readonly ContextSection[]): string {
  if (sections.length === 0) return "(no statically-injected context for this skill)";
  return sections.map((section) => `# ${section.id}\n${section.content}`).join("\n\n");
}

// The harness wraps the loaded assessment skill body as the model's SYSTEM prompt. The model —
// not this code — executes the procedure. This mirrors how assessment skills run in the real
// framework, and matches the detection-skill execution students saw in Lab 06.
function renderAssessmentSkillSystemPrompt(skill: SkillDocument): string {
  return [
    "You are a security analyst executing a loaded assessment skill.",
    `Skill name: ${skill.metadata.name}`,
    `Skill layer: ${skill.metadata.layer ?? "assessment"}`,
    "",
    "## Workshop execution constraints",
    "An upstream detection skill (Lab 06) already produced the DetectionFinding in the user message. Your job is the assessment layer: judge severity / behavioral context using the injected organization context — do NOT re-run detection scoring.",
    "Reason ONLY from the supplied DetectionFinding, the injected context files, and the supporting candidate evidence. Do not invent assets, owners, policies, prior incidents, or threat-intel beyond what the context and candidates carry.",
    "Every claim about business impact, baseline, or history must trace to a line in the injected context — quote or name the source. If the context does not establish something, say so rather than assuming.",
    "Your output is a STRUCTURED OBJECT, not a report. Emit the AssessmentFinding as a single JSON object in the exact shape the user message specifies — no prose, no markdown, no fences. Each judgement is its own named field.",
    "",
    "## Loaded skill procedure",
    skill.body,
  ].join("\n");
}

// The upstream DetectionFinding + the resolved (injected) context bundle + the supporting
// candidate evidence become the model's USER prompt, alongside the output instructions.
// The base user prompt for the AGENTIC loop's decision calls: the DetectionFinding + the
// injected static context + the supporting evidence. The model reads this, then decides which
// tools to call to retrieve the entity context it still needs.
function buildLoopBaseUserPrompt(
  upstreamFinding: JsonRecord,
  injectedSections: readonly ContextSection[],
  evidenceBundle: unknown,
): string {
  return [
    "You are assessing this DetectionFinding. First gather any entity context you still need by calling tools.",
    "",
    "## Upstream DetectionFinding",
    JSON.stringify(upstreamFinding, null, 2),
    "",
    "## Injected Organization Context (static — already provided; do not fetch it)",
    contextSectionsText(injectedSections),
    "",
    "## Supporting Candidate Evidence",
    JSON.stringify(evidenceBundle, null, 2),
  ].join("\n");
}

// The FINAL finding prompt: DetectionFinding + all context (injected static + tool-retrieved
// entity records) + evidence + the exact AssessmentFinding key contract. One streamed call.
function buildAssessmentUserPrompt(
  skill: SkillDocument,
  upstreamFinding: JsonRecord,
  contextSections: readonly ContextSection[],
  evidenceBundle: unknown,
): string {
  const isBehavioral = skill.metadata.name === "assess-behavioral-context";
  // Cardinal isolation: a behavioral-context skill judges baseline/anomaly and does NOT set
  // severity; a severity skill sets severity. Each emits its own JSON shape.
  const sections = isBehavioral
    ? [
        '  "behavioralVerdict": string — e.g. "Baseline plausible" or "Materially anomalous"',
        '  "baselineConsistent": string — what is baseline-consistent (cite the user/host context line)',
        '  "materialDeviation": string — what is a material deviation from the established baseline',
        '  "contextJudgement": string — does the context strengthen or weaken the detection, and why',
        '  "uncertainty": string — what the local context cannot establish on its own',
      ]
    : [
        '  "severity": "Low" | "Medium" | "High" | "Critical"',
        '  "severityReasoning": string — why this severity',
        '  "operationalBottomLine": string — the one-line decision this drives',
        '  "businessImpact": string — cite the asset/owner/role context lines',
        '  "escalationRationale": string — cite the escalation / evidence-preservation policy',
        '  "recommendedResponse": string — evidence-preserving actions before cleanup',
        '  "uncertainty": string — what the workshop dataset cannot establish',
      ];

  return [
    "Run the loaded assessment skill against the upstream DetectionFinding using the context below.",
    "Separate technical confidence (already established upstream) from business/behavioral judgement (your job here).",
    "Return ONLY a single JSON object — no prose, no markdown, no fences — an AssessmentFinding with EXACTLY these keys:",
    ...sections,
    "Name the context file behind each contextual claim (inside the relevant field) so the grounding is visible.",
    "",
    "## Upstream DetectionFinding",
    JSON.stringify(upstreamFinding, null, 2),
    "",
    "## Context (injected compliance + tool-retrieved entity records)",
    contextSectionsText(contextSections),
    "",
    "## Supporting Candidate Evidence",
    JSON.stringify(evidenceBundle, null, 2),
  ].join("\n");
}

// ── The schema gate (workshop-scale, DETERMINISTIC, no LLM) ─────────────────────────────
// Assessment ENRICHES the upstream detection finding. The model emits JSON; this gate validates
// it into a typed AssessmentFinding and stamps `basedOn` deterministically (the link to the
// detection finding is not left to the model). Cardinal isolation is enforced here: a
// behavioral-context skill never carries a severity. In the real framework this is an Ajv check
// with a correction retry; here we surface pass/fail so students see why the gate exists.
type GatedAssessment = {
  layer: "assessment";
  skillName: string;
  assessmentType: "severity" | "behavioral_context";
  basedOn: string;
  severity: "Low" | "Medium" | "High" | "Critical" | null;
  fields: { key: string; value: string }[];
};
type AssessmentGateResult = { pass: boolean; errors: string[]; finding: GatedAssessment | null };

function extractJsonObject(text: string): string | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return undefined;
  return candidate.slice(start, end + 1);
}

function gateAssessmentFinding(rawText: string, skill: SkillDocument, upstreamFinding: JsonRecord): AssessmentGateResult {
  const errors: string[] = [];
  const isBehavioral = skill.metadata.name === "assess-behavioral-context";
  const assessmentType: GatedAssessment["assessmentType"] = isBehavioral ? "behavioral_context" : "severity";

  const jsonText = extractJsonObject(rawText);
  if (!jsonText) return { pass: false, errors: ["Model did not return a JSON object — output was prose/empty."], finding: null };

  let parsed: JsonRecord;
  try {
    parsed = JSON.parse(jsonText) as JsonRecord;
  } catch {
    return { pass: false, errors: ["Model output was not valid JSON and could not be parsed."], finding: null };
  }

  // basedOn is stamped deterministically from the upstream finding (not trusted to the model).
  const basedOn = upstreamCandidateId(upstreamFinding) || asString(upstreamFinding.candidateId);
  if (!basedOn) errors.push("could not link to an upstream detection finding (basedOn is empty).");

  const orderedKeys = isBehavioral
    ? ["behavioralVerdict", "baselineConsistent", "materialDeviation", "contextJudgement", "uncertainty"]
    : ["severityReasoning", "operationalBottomLine", "businessImpact", "escalationRationale", "recommendedResponse", "uncertainty"];
  const fields = orderedKeys.map((key) => ({ key, value: asString(parsed[key]) }));
  for (const field of fields) {
    if (!field.value) errors.push(`${field.key} is missing.`);
  }

  let severity: GatedAssessment["severity"] = null;
  if (!isBehavioral) {
    const allowed = ["Low", "Medium", "High", "Critical"];
    const severityRaw = asString(parsed.severity);
    if (!allowed.includes(severityRaw)) errors.push(`severity "${severityRaw}" is not one of ${allowed.join(", ")}.`);
    severity = (allowed.includes(severityRaw) ? severityRaw : null) as GatedAssessment["severity"];
  } else if (asString(parsed.severity)) {
    // cardinal isolation: a behavioral skill must NOT assign severity.
    errors.push("a behavioral-context assessment must not set severity (cardinal isolation).");
  }

  const finding: GatedAssessment = {
    layer: "assessment",
    skillName: skill.metadata.name,
    assessmentType,
    basedOn,
    severity,
    fields,
  };
  return { pass: errors.length === 0, errors, finding };
}

function buildTrace(
  skill: SkillDocument,
  trigger: Candidate,
  relatedGroups: ReturnType<typeof collectRelated>,
  bundle: Candidate[],
  events: EventRecord[],
  resolutionNote: string,
  injectedCount: number,
): TraceStep[] {
  return [
    {
      step: 1,
      phase: "discover",
      title: "Discover assessment catalog",
      status: "ok",
      detail: "The harness loaded Markdown skills and filtered to assessment skills that declare allowedTools.",
      result: `Selected ${skill.metadata.name}.`,
    },
    {
      step: 2,
      phase: "inspect",
      title: "Inspect upstream DetectionFinding",
      status: "ok",
      detail: "The selected assessment skill consumes the DetectionFinding produced by Lab 06.",
      result: resolutionNote,
    },
    {
      step: 3,
      phase: "context",
      title: "Assemble context",
      status: "ok",
      detail: "Static org-wide context (compliance) is injected deterministically; entity-scoped context (asset record, incident history) is retrieved by the model itself via tools.",
      result: `${injectedCount} static file(s) injected. Entity context is retrieved agentically for ${trigger.host ?? "?"} / ${trigger.user ?? "?"} — see the Agentic Context Retrieval panel.`,
    },
    {
      step: 4,
      phase: "query",
      title: "Load supporting candidate evidence",
      status: bundle.length > 1 ? "ok" : "warning",
      detail: relatedGroups
        .map((group) => `${group.spec.type ?? "unknown"} via ${group.spec.scope ?? "any"}: ${group.matches.length}`)
        .join("; "),
      result: `${summarizeCandidate(trigger)}; ${bundle.length} candidate(s), ${events.length} raw event(s) available.`,
    },
    {
      step: 5,
      phase: "execute",
      title: "Agentic retrieval, then write the finding",
      status: "ok",
      detail: "The model runs a bounded tool loop to gather the entity context it needs, then writes the AssessmentFinding from the retrieved context plus the injected compliance baseline.",
      result: "Streaming the model's AssessmentFinding below.",
    },
  ];
}

async function loadWorkshopState() {
  const [allSkills, candidates, events] = await Promise.all([
    listSkills(),
    readJsonFile<Candidate[]>(DATA_PATH),
    readJsonFile<EventRecord[]>(EVENT_PATH),
  ]);
  const skills = allSkills.filter(isLab06AssessmentSkill);
  return { skills, candidates, events };
}

export const GET: RequestHandler = async () => {
  const { skills, candidates } = await loadWorkshopState();
  const schema = await resolveContextRequirement(
    {
      id: "schema.candidate-field-guide",
      mode: "static",
      path: FIELD_GUIDE_PATH,
      reason: "Shared candidate field definitions used by all assessment skills.",
    },
    {},
  );
  const guide = parseFieldGuide(await readTextFile(FIELD_GUIDE_PATH));
  const candidateReference = buildAssessmentCandidateReference(guide);
  const byType = candidates.reduce<Record<string, number>>((counts, candidate) => {
    const type = candidateType(candidate);
    counts[type] = (counts[type] ?? 0) + 1;
    return counts;
  }, {});

  return json({
    skills: skills.map((skill) => ({ ...skillSummary(skill), candidateReference })),
    schemaContext: schema,
    candidateStats: {
      total: candidates.length,
      byType,
      topCandidates: candidates
        .slice()
        .sort((a, b) => candidateScore(b) - candidateScore(a))
        .slice(0, 6)
        .map(compactCandidate),
    },
  });
};

// Streams the full assessment lifecycle as NDJSON: skill -> trace -> context -> evidence ->
// prompt -> live model tokens -> finding -> done. The AssessmentFinding is produced by a REAL
// model call (the assessment procedure executed against the injected context), not by code.
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as { skillPath?: string; upstreamFinding?: JsonRecord };
  const skillPath = normalizeSkillPath(body.skillPath ?? "");
  const [skill, candidates, events] = await Promise.all([
    loadSkill(skillPath),
    readJsonFile<Candidate[]>(DATA_PATH),
    readJsonFile<EventRecord[]>(EVENT_PATH),
  ]);
  assertLab06AssessmentSkill(skill);

  const upstreamFinding = asRecord(body.upstreamFinding);
  const { trigger, relatedGroups, related, resolutionNote } = chooseAssessmentEvidence(upstreamFinding, candidates);
  // Entity keys resolve from the FINDING's own entities — the tools key off these.
  const entities = findingEntities(trigger);
  // Static org-wide context (compliance) is injected deterministically; entity context is tool-fetched.
  const injectedContext = await resolveStaticContext(skill);
  const bundle = uniqueCandidates([trigger, ...related]);
  const rawEvents = collectEvents(bundle, events);
  const trace = buildTrace(skill, trigger, relatedGroups, bundle, rawEvents, resolutionNote, injectedContext.length);

  // Full candidate records (not the compact display view) so the model can cite real fields.
  const modelEvidenceBundle = {
    invocationCandidate: slimCandidateForModel(trigger),
    supportingCandidates: related.map(slimCandidateForModel),
    rawEvents: rawEvents.slice(0, 12),
    rawEventCount: rawEvents.length,
  };
  const displayEvidenceBundle = {
    trigger: compactCandidate(trigger),
    related: related.map(compactCandidate),
    candidates: bundle.map(compactCandidate),
    rawEvents: rawEvents.slice(0, 12).map((event) => ({
      id: event.event_id,
      type: event.event_type,
      host: event.host,
      timestamp: event.timestamp,
      summary: summarizeEvent(event),
    })),
    rawEventCount: rawEvents.length,
  };

  const systemPrompt = renderAssessmentSkillSystemPrompt(skill);
  const allowedTools = Array.isArray(skill.metadata.allowedTools) ? skill.metadata.allowedTools.map(String) : [];
  const toolCatalog = renderAssessmentToolCatalog(allowedTools);
  const loopBasePrompt = buildLoopBaseUserPrompt(upstreamFinding, injectedContext, modelEvidenceBundle);

  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      async start(controller) {
        const send = (event: unknown) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };

        try {
          send({ type: "skill", skill: skillSummary(skill) });
          send({ type: "tool-catalog", catalog: toolCatalog, callFormat: ASSESSMENT_DECISION_FORMAT });
          for (const step of trace) send({ type: "trace", step });
          send({ type: "context", injected: injectedContext });
          send({ type: "evidence", evidenceBundle: displayEvidenceBundle });

          // Show the assembled prompts immediately (panel 03), before the agentic loop runs. The user
          // prompt's context section then fills in with the records the agent retrieves (re-emitted
          // after the loop, below). The system prompt — the skill procedure — is final from the start.
          send({
            type: "prompt",
            systemPrompt,
            userPrompt: buildAssessmentUserPrompt(skill, upstreamFinding, injectedContext, modelEvidenceBundle),
          });

          const provider = selectProvider();

          // Agentic context retrieval: the model calls tools to fetch the entity context it needs.
          // Each step streams live to the windowed-insight panel.
          const loop = await runAssessmentAgentLoop({
            provider,
            systemPrompt,
            toolCatalog,
            baseUserPrompt: loopBasePrompt,
            entities,
            onToolStep: (toolTrace) => send({ type: "tool-step", trace: toolTrace }),
          });

          // Grounding fallback: never judge without the asset record. If the model did not fetch
          // it, the harness retrieves it deterministically before the finding is written.
          const retrieved = loop.retrievedContext.map((entry) => ({ id: entry.tool, content: entry.content }));
          if (!loop.assetFetched) {
            const asset = await resolveContextRequirement(
              { id: "asset", mode: "resolve", path: "", entity: "host", layer: "layer_1_assets", reason: "grounding fallback" },
              entities,
            );
            retrieved.push({ id: "get_asset_record (fallback)", content: asset.content });
            send({
              type: "tool-step",
              trace: makeAssessmentTrace({
                step: loop.traces.length + 1,
                thought: "The asset record was not retrieved by the model; the harness fetches it so the judgement stays grounded.",
                tool: "get_asset_record",
                args: { host: entities.host },
                status: "ok",
                resultCount: 1,
                elapsedMs: 0,
                observation: `host=${entities.host} retrieved as grounding fallback (${asset.content.length} chars).`,
              }),
            });
          }

          // Re-emit the prompt now that the agent's retrieved context is folded in (panel 03 updates),
          // then make the final finding call.
          const finalSections: ContextSection[] = [...injectedContext, ...retrieved];
          const userPrompt = buildAssessmentUserPrompt(skill, upstreamFinding, finalSections, modelEvidenceBundle);
          send({ type: "prompt", systemPrompt, userPrompt });
          send({ type: "model-start", message: "Writing the AssessmentFinding from the retrieved context..." });

          const result = await provider.invoke({
            systemPrompt,
            userPrompt,
            onToken: (token) => send({ type: "token", value: token }),
          });

          // Deterministic schema gate (no LLM): parse + validate the model's JSON into the typed
          // AssessmentFinding, stamping basedOn and enforcing cardinal isolation.
          const gate = gateAssessmentFinding(result.text, skill, upstreamFinding);
          send({
            type: "finding",
            raw: result.text,
            finding: gate.finding,
            gate: { pass: gate.pass, errors: gate.errors },
            model: result.model,
            usage: result.usage ?? null,
            assessmentType: gate.finding?.assessmentType ?? (skill.metadata.name === "assess-behavioral-context" ? "behavioral_context" : "severity"),
            skill: skill.metadata.name,
          });
          send({ type: "done" });
        } catch (err) {
          send({
            type: "error",
            message: err instanceof Error ? err.message : "Unknown assessment-execution error",
          });
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
