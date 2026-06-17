import { readFile } from "node:fs/promises";
import path from "node:path";
import { listSkills, type SkillDocument, type SkillMetadata } from "./skill-loader.js";
import type { Candidate } from "./loaders.js";
import type { DetectionFinding } from "./types.js";
import type { LLMProvider } from "./providers/types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Assessment fan-out execution (the orchestrated, framework version of Lab 07).
// Each SIGNIFICANT (true_positive) detection finding fans out into one isolated,
// REAL model call per assessment skill (severity, behavioural-context). The model
// emits JSON; a deterministic gate validates it into a typed AssessmentFinding and
// stamps `basedOn`. Cardinal isolation: a behavioural skill never carries a severity.
// (Mirrors the Lab 07 route logic; kept in the framework so the capstone can run it.)
// ─────────────────────────────────────────────────────────────────────────────

const FIELD_GUIDE_PATH = "context/schema/candidate-field-guide.md";

export interface AssessmentFinding {
  readonly layer: "assessment";
  readonly skillName: string;
  readonly assessmentType: "severity" | "behavioral_context";
  readonly basedOn: string;
  readonly severity: "Low" | "Medium" | "High" | "Critical" | null;
  readonly fields: { key: string; value: string }[];
}

export interface AssessmentInvocation {
  readonly skill: SkillDocument;
  readonly finding: DetectionFinding;
  readonly candidate: Candidate | null;
}

export interface AssessmentExecResult {
  readonly assessment: AssessmentFinding | null;
  readonly pass: boolean;
  readonly errors: string[];
  readonly model: string;
}

// ── small helpers (local, to keep this module self-contained) ───────────────
function asString(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

// ── entity resolution (host "DEV-WS03"->dev-ws03; user "NORTHWIND\jane.roberts"->jane-roberts) ──
function slugifyEntity(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[^\\]*\\/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function findingEntities(candidate: Candidate | null): Record<string, string> {
  const ip = asString(candidate?.src_ip);
  return {
    host: slugifyEntity(asString(candidate?.host)),
    user: slugifyEntity(asString(candidate?.user)),
    subnet: ip ? `subnet-${ip.split(".").slice(0, 3).join("-")}` : "",
  };
}

function contextRequirements(metadata: SkillMetadata): Array<Record<string, string>> {
  return asArray(metadata.contextRequirements).map((item) => {
    const r = asRecord(item);
    return {
      id: asString(r.id),
      mode: asString(r.mode || "static"),
      path: asString(r.path),
      entity: asString(r.entity),
      layer: asString(r.layer),
      suffix: asString(r.suffix),
    };
  });
}

async function readRel(rel: string): Promise<string> {
  const clean = rel.replace(/^(\.\/)+/, "").replace(/\.\.(\/|\\)/g, "");
  return readFile(path.join(process.cwd(), clean), "utf8");
}

// Resolve the skill's declared context into one injected text block (entity-scoped from the finding).
async function resolveContextText(skill: SkillDocument, entities: Record<string, string>): Promise<string> {
  const parts: string[] = [];
  const guide = await readRel(FIELD_GUIDE_PATH).catch(() => "");
  if (guide) parts.push(`### schema.candidate-field-guide\n${guide}`);

  for (const req of contextRequirements(skill.metadata)) {
    let rel = req.path;
    if (req.mode === "resolve") {
      const entityVal = entities[req.entity] ?? "";
      if (!entityVal) continue;
      rel = `context/layers/${req.layer || "layer_1_assets"}/${entityVal}${req.suffix || ""}.md`;
    }
    if (!rel) continue;
    const content = await readRel(rel).catch(() => "");
    if (content) parts.push(`### ${req.id || rel}\n${content}`);
  }
  return parts.join("\n\n");
}

function systemPrompt(skill: SkillDocument): string {
  return [
    "You are a security analyst executing a loaded assessment skill.",
    `Skill name: ${skill.metadata.name}`,
    "An upstream detection skill already produced the DetectionFinding in the user message. Your job is the assessment layer: judge severity / behavioural context using the injected organization context — do NOT re-run detection scoring.",
    "Reason ONLY from the supplied DetectionFinding, the injected context, and the candidate evidence. Every contextual claim must trace to a line in the injected context.",
    "Output a STRUCTURED OBJECT, not a report — a single JSON object in the exact shape the user message specifies. No prose, no markdown, no fences.",
    "",
    "## Loaded skill procedure",
    skill.body,
  ].join("\n");
}

function isBehavioral(skill: SkillDocument): boolean {
  return skill.metadata.name === "assess-behavioral-context";
}

function userPrompt(skill: SkillDocument, finding: DetectionFinding, contextText: string, candidate: Candidate | null): string {
  const sections = isBehavioral(skill)
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
    "Run the loaded assessment skill against the upstream DetectionFinding using the injected context.",
    "Return ONLY a single JSON object — no prose, no markdown, no fences — with EXACTLY these keys:",
    ...sections,
    "",
    "## Upstream DetectionFinding",
    JSON.stringify(finding, null, 2),
    "",
    "## Injected Context (resolved from the skill's contextRequirements)",
    contextText,
    "",
    "## Supporting Candidate Evidence",
    JSON.stringify(candidate ?? {}, null, 2),
  ].join("\n");
}

function extractJsonObject(text: string): string | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return undefined;
  return candidate.slice(start, end + 1);
}

// Deterministic gate (no LLM): parse the model JSON → typed AssessmentFinding, stamp basedOn,
// enforce cardinal isolation (a behavioural skill must not set severity).
function gateAssessment(rawText: string, skill: SkillDocument, finding: DetectionFinding): { pass: boolean; errors: string[]; finding: AssessmentFinding | null } {
  const errors: string[] = [];
  const behavioral = isBehavioral(skill);
  const assessmentType: AssessmentFinding["assessmentType"] = behavioral ? "behavioral_context" : "severity";

  const jsonText = extractJsonObject(rawText);
  if (!jsonText) return { pass: false, errors: ["Model did not return a JSON object."], finding: null };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    return { pass: false, errors: ["Model output was not valid JSON."], finding: null };
  }

  const basedOn = finding.id || finding.candidateId;
  if (!basedOn) errors.push("could not link to an upstream detection finding (basedOn is empty).");

  const orderedKeys = behavioral
    ? ["behavioralVerdict", "baselineConsistent", "materialDeviation", "contextJudgement", "uncertainty"]
    : ["severityReasoning", "operationalBottomLine", "businessImpact", "escalationRationale", "recommendedResponse", "uncertainty"];
  const fields = orderedKeys.map((key) => ({ key, value: asString(parsed[key]) }));
  for (const f of fields) if (!f.value) errors.push(`${f.key} is missing.`);

  let severity: AssessmentFinding["severity"] = null;
  if (!behavioral) {
    const allowed = ["Low", "Medium", "High", "Critical"];
    const raw = asString(parsed.severity);
    if (!allowed.includes(raw)) errors.push(`severity "${raw}" is not one of ${allowed.join(", ")}.`);
    severity = (allowed.includes(raw) ? raw : null) as AssessmentFinding["severity"];
  } else if (asString(parsed.severity)) {
    errors.push("a behavioral-context assessment must not set severity (cardinal isolation).");
  }

  return {
    pass: errors.length === 0,
    errors,
    finding: { layer: "assessment", skillName: skill.metadata.name, assessmentType, basedOn, severity, fields },
  };
}

// Pair every SIGNIFICANT (true_positive) finding with each assessment skill → one invocation each.
export async function planAssessmentInvocations(
  findings: readonly DetectionFinding[],
  candidates: readonly Candidate[],
): Promise<AssessmentInvocation[]> {
  // Only the static/resolve-context assessment skills (severity, behavioural) — NOT the
  // retrieval-backed campaign-match (skills/retrieval/, Lab 08), which needs RAG context.
  const skills = (await listSkills()).filter(
    (s) => s.metadata.layer === "assessment" && s.path.startsWith("skills/assessment/"),
  );
  const byId = new Map(candidates.map((c) => [asString(c.candidate_id), c]));
  const invocations: AssessmentInvocation[] = [];
  for (const finding of findings) {
    if (finding.verdict !== "true_positive") continue; // assess only confirmed findings
    const candidate = byId.get(finding.candidateId) ?? null;
    for (const skill of skills) invocations.push({ skill, finding, candidate });
  }
  return invocations;
}

export async function executeAssessmentInvocation(
  provider: LLMProvider,
  inv: AssessmentInvocation,
): Promise<AssessmentExecResult> {
  const entities = findingEntities(inv.candidate);
  const contextText = await resolveContextText(inv.skill, entities);
  const result = await provider.invoke({
    systemPrompt: systemPrompt(inv.skill),
    userPrompt: userPrompt(inv.skill, inv.finding, contextText, inv.candidate),
  });
  const gate = gateAssessment(result.text, inv.skill, inv.finding);
  return { assessment: gate.finding, pass: gate.pass, errors: gate.errors, model: result.model };
}
