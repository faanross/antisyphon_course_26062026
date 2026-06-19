<script lang="ts">
  import { onMount } from "svelte";
  import { parseMarkdown, renderInline, type MarkdownBlock } from "$lib/markdown.js";
  import FileMdIcon from "phosphor-svelte/lib/FileMdIcon";
  import BracketsCurlyIcon from "phosphor-svelte/lib/BracketsCurlyIcon";
  import FunnelIcon from "phosphor-svelte/lib/FunnelIcon";
  import StackIcon from "phosphor-svelte/lib/StackIcon";
  import RobotIcon from "phosphor-svelte/lib/RobotIcon";
  import ScalesIcon from "phosphor-svelte/lib/ScalesIcon";
  import ListMagnifyingGlassIcon from "phosphor-svelte/lib/ListMagnifyingGlassIcon";
  import CheckCircleIcon from "phosphor-svelte/lib/CheckCircleIcon";
  import ArrowRightIcon from "phosphor-svelte/lib/ArrowRightIcon";
  import TargetIcon from "phosphor-svelte/lib/TargetIcon";
  import WarningIcon from "phosphor-svelte/lib/WarningIcon";
  import ArrowsInIcon from "phosphor-svelte/lib/ArrowsInIcon";
  import FoldersIcon from "phosphor-svelte/lib/FoldersIcon";
  import ArrowsClockwiseIcon from "phosphor-svelte/lib/ArrowsClockwiseIcon";
  import CertificateIcon from "phosphor-svelte/lib/CertificateIcon";
  import FingerprintIcon from "phosphor-svelte/lib/FingerprintIcon";
  import ShieldCheckIcon from "phosphor-svelte/lib/ShieldCheckIcon";
  import GlobeHemisphereWestIcon from "phosphor-svelte/lib/GlobeHemisphereWestIcon";
  import UploadSimpleIcon from "phosphor-svelte/lib/UploadSimpleIcon";
  import GaugeIcon from "phosphor-svelte/lib/GaugeIcon";
  import PlusIcon from "phosphor-svelte/lib/PlusIcon";

  type SkillMetadata = {
    name: string;
    version?: string;
    layer?: "detection" | "assessment" | string;
    model?: string;
    description?: string;
    invocationTriggerCandidate?: string;
    invocationGate?: Record<string, unknown>;
    correlatingCandidates?: Array<{ type?: string; scope?: string }>;
    mitreTechniques?: string[];
    [key: string]: unknown;
  };

  type CandidateRef = {
    type: string;
    role: "trigger" | "correlating";
    scope?: string;
    scopeDescription?: string;
    description: string;
    fields: string[];
    scoreNote?: string;
  };

  type SkillSummary = {
    path: string;
    metadata: SkillMetadata;
    frontmatter: string;
    bodyPreview: string;
    body: string;
    candidateReference?: CandidateRef[];
  };

  type CompactCandidate = {
    id: string;
    type: string;
    host: string;
    srcIp: string;
    destIp: string;
    destPort: number | string;
    processName: string;
    processGuid: string;
    score: number;
    lots: string;
    eventIds: string[];
  };

  type TraceStep = {
    step: number;
    phase: "discover" | "inspect" | "query" | "bundle" | "execute";
    title: string;
    status: "ok" | "warning";
    detail: string;
    result: string;
  };

  type EvidenceBundle = {
    trigger: CompactCandidate;
    related: CompactCandidate[];
    querySummary: Record<string, number>;
  };

  type LabPayload = {
    skills: SkillSummary[];
    candidateStats: {
      total: number;
      byType: Record<string, number>;
      topCandidates: CompactCandidate[];
    };
  };

  // NDJSON event contract emitted by the POST endpoint, one object per line.
  // The typed object the detection skill emits. The model produces this as JSON; the harness
  // gate validates it. The readable view in the UI is rendered FROM this — it is NOT the model's
  // output and NOT what the harness persists (the harness persists this typed object).
  type DetectionFindingObject = {
    layer: "detection";
    skillName: string;
    candidateId: string;
    verdict: "true_positive" | "false_positive" | "inconclusive";
    compositeScore: number;
    dimensions: { name: string; score: number; evidence: string }[];
    evidenceSummary: string;
    attackNarrative: string;
    uncertainty: string;
    benignFallbackRuledOut: { fallback: string; ruledOutBecause: string }[];
    mitreTechniques: string[];
    evidenceRefs: { candidateIds: string[]; eventIds: string[] };
    scope: { host: string };
  };

  type StreamEvent =
    | { type: "skill"; skill: SkillSummary }
    | { type: "trace"; step: TraceStep }
    | { type: "evidence"; evidenceBundle: EvidenceBundle }
    | { type: "prompt"; systemPrompt: string; userPrompt: string }
    | { type: "model-start"; message: string }
    | { type: "token"; value: string }
    | {
        type: "finding";
        raw: string;
        finding: DetectionFindingObject | null;
        gate: { pass: boolean; errors: string[] };
        model: string;
        usage: Record<string, unknown> | null;
      }
    | { type: "done" }
    | { type: "error"; message: string };

  let skills = $state<SkillSummary[]>([]);
  let candidateStats = $state<LabPayload["candidateStats"] | null>(null);
  let detectionSkillPath = $state("");
  let loading = $state(true);
  let busy = $state(false);
  let error = $state("");

  // Streaming execution state. Each field is populated by a distinct NDJSON event.
  let executedSkill = $state<SkillSummary | null>(null);
  let traceSteps = $state<TraceStep[]>([]);
  let evidenceBundle = $state<EvidenceBundle | null>(null);
  let systemPrompt = $state("");
  let userPrompt = $state("");
  let modelStreaming = $state(false);
  let findingText = $state(""); // the RAW model output (streamed tokens) — JSON, the model's actual output
  let finding = $state<DetectionFindingObject | null>(null); // the typed object after the gate
  let gate = $state<{ pass: boolean; errors: string[] } | null>(null); // schema-gate result
  let findingModel = $state("");
  let findingUsage = $state<Record<string, unknown> | null>(null);

  // The typed object a detection skill emits — shown verbatim in the Code tab. Held as a string so
  // the braces aren't parsed as Svelte interpolation.
  const DETECTION_FINDING_TYPE = `type DetectionFinding = {
  layer: "detection";
  skillName: string;            // which skill judged
  candidateId: string;          // which candidate it judged
  verdict: "true_positive" | "false_positive" | "inconclusive";
  compositeScore: number;       // = max(dimensions[].score), never an average
  dimensions: { name: string; score: number; evidence: string }[];
  evidenceSummary: string;      // ┐
  attackNarrative: string;      // │ the reasoning the model adds —
  uncertainty: string;          // │ each in its own named field
  benignFallbackRuledOut: { fallback: string; ruledOutBecause: string }[];  // ┘
  mitreTechniques: string[];    // ATT&CK techniques asserted, with basis
  evidenceRefs: { candidateIds: string[]; eventIds: string[] };  // back to the evidence
  scope: { host: string };      // where it happened
};`;

  // Active tab within the glass cards that hold more than one peer view.
  let activeTab = $state<"instructions" | "lab" | "targeting" | "scoring" | "code">("instructions");
  let skillTab = $state<"frontmatter" | "procedure" | "reference">("frontmatter");
  let scoringTab = $state<"tls" | "intel" | "data">("tls");
  let promptTab = $state<"system" | "user">("system");

  const hasExecution = $derived(Boolean(executedSkill));

  const LAB06_HANDOFF_KEY = "antisiphon.lab06.detectionFinding";

  const detectionSkills = $derived(skills.filter((skill) => skill.metadata.layer === "detection"));
  // This lab scopes the picker to the one skill the seeded hypothesis targets.
  const pickerSkills = $derived(
    detectionSkills.filter((skill) => skill.metadata.name === "hunt-c2-over-https"),
  );
  const selectedDetectionSkill = $derived(
    detectionSkills.find((skill) => skill.path === detectionSkillPath) ?? null,
  );

  // Default the selection to hunt-c2-over-https once the catalog loads.
  $effect(() => {
    if (!detectionSkillPath) {
      const c2 = pickerSkills[0];
      if (c2) detectionSkillPath = c2.path;
    }
  });

  onMount(async () => {
    await loadCatalog();
  });

  async function loadCatalog() {
    loading = true;
    error = "";

    try {
      const response = await fetch("/lab/06/api/skills");
      if (!response.ok) throw new Error(`Skill API returned HTTP ${response.status}`);
      const payload = (await response.json()) as LabPayload;
      skills = payload.skills;
      candidateStats = payload.candidateStats;
      detectionSkillPath = "";
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to load skill catalog";
    } finally {
      loading = false;
    }
  }

  function resetExecutionState() {
    executedSkill = null;
    traceSteps = [];
    evidenceBundle = null;
    systemPrompt = "";
    userPrompt = "";
    modelStreaming = false;
    findingText = "";
    finding = null;
    gate = null;
    findingModel = "";
    findingUsage = null;
  }

  function applyStreamEvent(event: StreamEvent) {
    switch (event.type) {
      case "skill":
        executedSkill = event.skill;
        break;
      case "trace":
        traceSteps = [...traceSteps, event.step];
        break;
      case "evidence":
        evidenceBundle = event.evidenceBundle;
        break;
      case "prompt":
        systemPrompt = event.systemPrompt;
        userPrompt = event.userPrompt;
        break;
      case "model-start":
        modelStreaming = true;
        break;
      case "token":
        findingText += event.value;
        break;
      case "finding":
        findingText = event.raw;
        finding = event.finding;
        gate = event.gate;
        findingModel = event.model;
        findingUsage = event.usage;
        break;
      case "done":
        modelStreaming = false;
        break;
      case "error":
        modelStreaming = false;
        error = event.message;
        break;
    }
  }

  async function executeDetection() {
    if (!selectedDetectionSkill || busy) return;
    busy = true;
    error = "";
    resetExecutionState();

    try {
      const response = await fetch("/lab/06/api/skills", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skillPath: selectedDetectionSkill.path }),
      });

      if (!response.ok) throw new Error(`Execution API returned HTTP ${response.status}`);
      if (!response.body) throw new Error("Execution API returned an empty stream.");

      // Read the NDJSON stream: split on newlines, parse each complete line, keep
      // a buffer for the trailing partial line until more bytes arrive.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line) applyStreamEvent(JSON.parse(line) as StreamEvent);
          newlineIndex = buffer.indexOf("\n");
        }
      }

      const tail = buffer.trim();
      if (tail) applyStreamEvent(JSON.parse(tail) as StreamEvent);

      persistDetectionFinding();
    } catch (err) {
      error = err instanceof Error ? err.message : "Detection execution failed";
    } finally {
      modelStreaming = false;
      busy = false;
    }
  }

  // Lab 07 (Assessment) reads the upstream DetectionFinding from this handoff key. We persist the
  // REAL typed object the gate produced (compositeScore = max(dimensions), per-dimension evidence,
  // narrative, uncertainty, benign-fallbacks) — not a synthesized stand-in. The raw model JSON is
  // carried alongside for display only.
  function persistDetectionFinding() {
    if (typeof localStorage === "undefined") return;
    if (!executedSkill || !finding) return;

    const handoffFinding = {
      ...finding,
      kind: "DetectionFinding",
      skill: executedSkill.metadata.name,
      model: findingModel,
      // The typed object above is the source of truth; triggerCandidate is carried only so
      // Lab 07's upstream-display can show the trigger line. It is not part of the finding.
      triggerCandidate: evidenceBundle?.trigger ?? null,
    };

    localStorage.setItem(
      LAB06_HANDOFF_KEY,
      JSON.stringify({
        version: 2,
        source: "lab06",
        generatedAt: new Date().toISOString(),
        execution: { skill: executedSkill, finding: handoffFinding },
        finding: handoffFinding,
        raw: findingText,
      }),
    );
  }

  function json(value: unknown): string {
    return JSON.stringify(value, null, 2);
  }

  function typeLabel(type: string): string {
    return type.replaceAll("_", " ");
  }

</script>

<svelte:head><title>Lab 06 | Detection Skills</title></svelte:head>

<main>
  <header class="hero">
    <h1>Lab 06: Detection Skill Discovery + Execution</h1>
  </header>

  <div class="tab-bar-top">
    <button class="tab-btn-top" class:active={activeTab === "instructions"} onclick={() => (activeTab = "instructions")}>Instructions</button>
    <button class="tab-btn-top" class:active={activeTab === "lab"} onclick={() => (activeTab = "lab")}>Lab</button>
    <button class="tab-btn-top" class:active={activeTab === "targeting"} onclick={() => (activeTab = "targeting")}>Targeting</button>
    <button class="tab-btn-top" class:active={activeTab === "scoring"} onclick={() => (activeTab = "scoring")}>Scoring</button>
    <button class="tab-btn-top" class:active={activeTab === "code"} onclick={() => (activeTab = "code")}>Code</button>
  </div>

  {#if activeTab === "instructions"}
    <!-- ═══════════════════════════════════════════════════ -->
    <!-- INSTRUCTIONS VIEW  (the workshop walkthrough)        -->
    <!-- ═══════════════════════════════════════════════════ -->
    <div class="code-view">
      <div class="code-inner">
        <header class="cv-hero">
          <p>
            Upstream, <strong>initiation</strong> has already run (we've simulated it), and the
            <strong>hypothesis</strong> it produced is waiting on the <strong>Lab</strong> tab. This
            lab takes that hypothesis, runs <em>one</em> detection skill against the candidates it
            scopes, and shows you every step. Below is <strong>what's happening and what to do</strong>
            — the concepts are in the slides; this is the operating manual.
          </p>
        </header>

        <ol class="flow">
          <!-- Step 1 -->
          <li class="flow-step" style="--d: 0ms">
            <span class="flow-rail"><FileMdIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">1 · What you're looking at — the hypothesis</span>
                <span class="flow-where">Lab tab</span>
              </div>
              <p>
                Initiation already ran upstream (simulated) and handed detection a
                <strong>hypothesis</strong>: hunt <code>C2-over-HTTPS</code> scoped to the developer
                subnet <code>10.42.10.0/24</code>. You'll see it in the <strong>Hypothesis received</strong>
                card. The skill is already selected for you — <code>hunt-c2-over-https</code>, a real
                <code>.md</code> file the harness found on disk.
              </p>
            </div>
          </li>

          <!-- Step 2 -->
          <li class="flow-step" style="--d: 110ms">
            <span class="flow-rail"><BracketsCurlyIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">2 · Read the skill contract</span>
                <span class="flow-where">Frontmatter · Procedure · Reference</span>
              </div>
              <p>
                Inspect the three sub-tabs. <strong>Frontmatter</strong> is the YAML header — what
                the skill targets and how it scores. <strong>Procedure</strong> is the actual
                step-by-step the model is told to follow. <strong>Reference</strong> is supporting
                detail. This <em>is</em> the detection logic, in plain text.
              </p>
            </div>
          </li>

          <!-- Step 3 -->
          <li class="flow-step" style="--d: 220ms">
            <span class="flow-rail"><RobotIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">3 · Run it</span>
                <span class="flow-where">Run Detection Skill</span>
              </div>
              <p>
                Hit <strong>Run Detection Skill</strong>. The harness first <strong>scopes</strong> the
                beacons to the hypothesis (only sources in <code>10.42.10.0/24</code> — others drop
                out), then picks the target automatically and parses the skill into a
                <strong>system + user prompt</strong>. The scope decided <em>which</em> candidate is
                judged — it is <strong>not</strong> in the prompt; the model judges on the candidate's
                own evidence. Watch the <strong>DetectionFinding</strong> stream out in step 03.
              </p>
            </div>
          </li>

          <!-- Step 4 -->
          <li class="flow-step" style="--d: 330ms">
            <span class="flow-rail"><CheckCircleIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">4 · Read the finding (and the receipts)</span>
                <span class="flow-where">DetectionFinding · Execution Detail</span>
              </div>
              <p>
                Step 03 shows three things in order: <strong>(1)</strong> the model's real output — a
                <strong>JSON DetectionFinding</strong> (the reasoning in named fields, not a prose
                blob); <strong>(2)</strong> the deterministic <strong>schema gate</strong> validating
                it into the typed object; and <strong>(3)</strong> a readable card
                <em>rendered from</em> that object. The pretty view is a rendering for humans — the
                model's output is the JSON, and the typed object is what the harness persists (never
                the prose). Expand <strong>Execution Detail</strong> for the trace and evidence bundle.
              </p>
            </div>
          </li>

          <!-- Step 5 -->
          <li class="flow-step" style="--d: 440ms">
            <span class="flow-rail"><TargetIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">5 · Go deeper</span>
                <span class="flow-where">Targeting · Code</span>
              </div>
              <p>
                Two more tabs when you're ready: <strong>Targeting</strong> shows how the
                candidate gets chosen (you never pick it — the skill and harness do), and
                <strong>Code</strong> covers the architecture.
              </p>
            </div>
          </li>
        </ol>

        <aside class="cv-callout">
          <FileMdIcon size={22} weight="duotone" />
          <p>
            <strong>What you're watching:</strong> the single unit the real system runs many of, in
            parallel — one skill judging one candidate. We've slowed it to one, on rails, so each
            step is visible.
          </p>
        </aside>
      </div>
    </div>
  {:else if activeTab === "lab"}
  {#if error}
    <section class="error-panel">{error}</section>
  {/if}

  <section class="flow-grid" aria-label="Lab 06 detection workflow">
    <section class="flow-card skill-stage detection">
      <div class="flow-header">
        <span>01</span>
        <h2>Detection Skill</h2>
      </div>

      <section class="hyp-card">
        <div class="hyp-head">
          <TargetIcon size={16} weight="duotone" />
          <span>HYPOTHESIS (received from initiation)</span>
        </div>
        <p class="hyp-text">
          Hunt C2-over-HTTPS originating from the developer subnet <code>10.42.10.0/24</code>.
        </p>
        <pre class="hyp-scope"><code><span class="c-key">entityScope</span>: &#123; subnets: ["10.42.10.0/24"], axis: "source" &#125;</code></pre>
        <p class="hyp-note">
          This entity scope is a <strong>selection filter</strong> applied <em>before</em> the skill
          runs — it scopes <em>which</em> beacon candidates are judged (subnet
          <code>10.42.10.0/24</code> in scope; beacons on other subnets are filtered out). It
          <strong>never enters the model prompt</strong>, so the verdict on any selected candidate
          stays hypothesis-agnostic.
        </p>
      </section>

      <section class="picker">
        <h3>Detection Skills</h3>
        {#if loading}
          <p class="empty">Loading catalog.</p>
        {:else}
          <div class="skill-list horizontal">
            {#each pickerSkills as skill}
              <button
                class="skill-card"
                class:active={detectionSkillPath === skill.path}
                onclick={() => {
                  detectionSkillPath = skill.path;
                  resetExecutionState();
                }}
              >
                <strong>{skill.metadata.name}</strong>
                <span>{skill.metadata.invocationTriggerCandidate ?? "candidate"}</span>
              </button>
            {/each}
          </div>
        {/if}
      </section>

      {#if selectedDetectionSkill}
        {@render SkillContract({ skill: selectedDetectionSkill })}
      {/if}

      <div class="stage-actions">
        <button onclick={executeDetection} disabled={!selectedDetectionSkill || busy}>
          {busy ? "Running Detection" : "Run Detection Skill"}
        </button>
      </div>
    </section>

    <section class="flow-card prompt-stage">
      <div class="flow-header">
        <span>02</span>
        <h2>Model Prompts</h2>
      </div>

      {#if systemPrompt || userPrompt}
        {@render PromptView()}
      {:else}
        <p class="empty">Run a detection skill to see how it parsed into the system and user prompts.</p>
      {/if}
    </section>

    <section class="flow-card finding-step" class:ready={Boolean(findingText) && !modelStreaming}>
      <div class="flow-header">
        <span>03</span>
        <h2>DetectionFinding</h2>
      </div>

      {#if hasExecution}
        {@render FindingStream()}
      {:else}
        <p class="empty">Run a detection skill to produce this finding.</p>
      {/if}
    </section>
  </section>

  <section class="utility-grid">
    <details class="panel">
      <summary>
        <span>Execution Detail</span>
        <small>{traceSteps.length ? `${traceSteps.length} trace steps` : "no trace yet"}</small>
      </summary>

      {#if hasExecution}
        {@render TraceView({ trace: traceSteps })}
        {#if evidenceBundle}
          {@render EvidenceView({ bundle: evidenceBundle })}
        {/if}
      {:else}
        <p class="empty">Run the detection stage to populate the trace and evidence bundle.</p>
      {/if}
    </details>

    <details class="panel">
      <summary>
        <span>Candidate Inputs</span>
        <small>{candidateStats?.total ?? 0} candidates</small>
      </summary>

      <div class="context-grid">
        <article>
          <h3>Candidate Types</h3>
          <div class="stat-list">
            {#each Object.entries(candidateStats?.byType ?? {}) as [type, count]}
              <span><strong>{typeLabel(type)}</strong><em>{count}</em></span>
            {/each}
          </div>
        </article>

        <article>
          <h3>Top Inputs</h3>
          <div class="mini-candidates">
            {#each candidateStats?.topCandidates ?? [] as candidate}
              <span>{candidate.id} | {candidate.type} | score {candidate.score}</span>
            {/each}
          </div>
        </article>
      </div>
    </details>
  </section>
  {:else if activeTab === "targeting"}
    <!-- ═══════════════════════════════════════════════════ -->
    <!-- TARGETING VIEW — how the candidate is chosen          -->
    <!-- ═══════════════════════════════════════════════════ -->
    <div class="code-view">
      <div class="code-inner">
        <header class="cv-hero">
          <span class="cv-eyebrow">Behind the Pick</span>
          <h2>How the candidate is chosen</h2>
          <p>
            You never tell the agent which candidate to hunt. The <strong>skill</strong> declares its
            own target in frontmatter, and the harness selects <strong>deterministically</strong>.
            Here's exactly why it landed on <strong>BEA-001</strong> — even though it's only the
            <em>second</em>-highest score.
          </p>
          <div class="cv-mental-model">
            <BracketsCurlyIcon size={20} weight="duotone" />
            <span>skill declares target</span>
            <span class="cv-mm-sep">→</span>
            <FunnelIcon size={20} weight="duotone" />
            <span>entity-scope filter (from hypothesis)</span>
            <span class="cv-mm-sep">→</span>
            <FunnelIcon size={20} weight="duotone" />
            <span>gate</span>
            <span class="cv-mm-sep">→</span>
            <ScalesIcon size={20} weight="duotone" />
            <span>rank</span>
            <span class="cv-mm-sep">→</span>
            <TargetIcon size={20} weight="duotone" />
            <span>BEA-001</span>
          </div>
          <p class="cv-note">
            Before the gate runs, the hypothesis's <strong>entity scope</strong> filters the candidate
            pool <em>first</em> — here it keeps only beacons whose source is in
            <code>10.42.10.0/24</code>, so beacons on other subnets (FIN-WS11
            <code>10.42.12.88</code>, DB-SVR02 <code>10.42.11.22</code>) drop out before scoring. The
            gate and corroboration ranking then pick <strong>BEA-001</strong> (host DEV-WS03,
            <code>10.42.10.45</code>) from the survivors. This is <strong>selection, not judgment</strong>:
            the scope shapes <em>which</em> candidates are considered, but the verdict on a selected
            candidate is unchanged — and the scope <strong>never enters the prompt</strong>.
          </p>
        </header>

        <!-- A · The skill targets -->
        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">A</span> The skill targets, not you<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">
            Three lines of frontmatter decide what this skill goes after — the candidate type, the
            gate it must clear, and the corroborating evidence to look for:
          </p>
          <pre class="cv-code"><code><span class="c-key">invocationTriggerCandidate</span>: beacon            <span class="c-cm"># only consider beacons</span>
<span class="c-key">invocationGate</span>:
  observedService: ssl
  minBeaconScore: 0.85                       <span class="c-cm"># must clear the gate</span>
<span class="c-key">correlatingCandidates</span>:                        <span class="c-cm"># what corroboration to seek</span>
  - type: tls_anomaly    scope: same_network_tuple
  - type: intel_match    scope: destination
  - type: data_transfer  scope: same_network_tuple</code></pre>
        </details>

        <!-- B · The funnel -->
        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">B</span> The selection funnel<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">Every candidate runs through three deterministic stages. The pool shrinks at each one.</p>
          <div class="funnel-stages">
            <div class="funnel-stage">
              <div class="fs-left"><ListMagnifyingGlassIcon size={20} weight="duotone" /><span class="fs-tag">1 · Filter by type</span></div>
              <div class="fs-detail">keep only <code>beacon</code> candidates</div>
              <div class="fs-num">5</div>
            </div>
            <div class="fs-arrow"><ArrowRightIcon size={16} weight="bold" /></div>
            <div class="funnel-stage">
              <div class="fs-left"><FunnelIcon size={20} weight="duotone" /><span class="fs-tag">2 · Gate</span></div>
              <div class="fs-detail"><code>ssl</code> + <code>score ≥ 0.85</code> · drops BEA-005 (0.81), BEA-004 (0.72)</div>
              <div class="fs-num">3</div>
            </div>
            <div class="fs-arrow"><ArrowRightIcon size={16} weight="bold" /></div>
            <div class="funnel-stage win">
              <div class="fs-left"><ScalesIcon size={20} weight="duotone" /><span class="fs-tag">3 · Rank</span></div>
              <div class="fs-detail">highest-ranked of the survivors</div>
              <div class="fs-num fs-winner">BEA-001</div>
            </div>
          </div>
        </details>

        <!-- C · The formula -->
        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">C</span> The ranking formula<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">Among the gate survivors, each is scored — and it is <strong>not</strong> just the beacon score:</p>
          <div class="formula">
            <div class="formula-eq">
              <span class="f-term f-corr">corroboration × 2</span>
              <span class="f-op">+</span>
              <span class="f-term f-score">beacon&nbsp;score</span>
            </div>
          </div>
          <div class="formula-legend">
            <div class="fl-row"><span class="fl-dot f-corr"></span><strong>corroboration × 2</strong> — how many independent correlated candidates fire (TLS / intel / data-transfer). Weighted heaviest: <em>converging evidence wins</em>.</div>
            <div class="fl-row"><span class="fl-dot f-score"></span><strong>beacon score</strong> — the raw statistical regularity score.</div>
          </div>
          <p class="cv-note">
            Note on <code>lots_match</code>: LOTS (<em>Living Off Trusted Sites</em>) flags traffic to
            trusted infrastructure — but that is the very infrastructure attackers <strong>abuse</strong>
            to blend in (Dropbox, pastebin, a CDN). It is an <strong>informative signal, not an
            exculpatory one</strong>, so it does <em>not</em> lower a candidate's rank. Whether a trusted
            destination is legitimate is an <em>assessment</em>-layer judgement — never a detection-time
            penalty.
          </p>
        </details>

        <!-- D · Head to head -->
        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">D</span> Why 0.90 beats 0.93<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">The three gate survivors, scored. The highest beacon score still loses — on corroboration alone:</p>
          <div class="versus">
            <article class="vs-card win">
              <div class="vs-top"><span class="vs-id"><TargetIcon size={16} weight="duotone" /> BEA-001</span><span class="vs-badge win">chosen</span></div>
              <div class="vs-math">
                <div class="vs-line"><span>corroboration 3 × 2</span><b class="pos">+6.00</b></div>
                <div class="vs-line"><span>beacon score</span><b class="pos">+0.90</b></div>
                <div class="vs-total"><span>rank</span><b class="pos">6.90</b></div>
              </div>
              <p class="vs-note">TLS anomaly, threat-intel hit, and data transfer all converge on the same activity — three independent signals.</p>
            </article>
            <article class="vs-card lose">
              <div class="vs-top"><span class="vs-id">BEA-002</span><span class="vs-badge lose">no corroboration</span></div>
              <div class="vs-math">
                <div class="vs-line"><span>corroboration 0 × 2</span><b>+0.00</b></div>
                <div class="vs-line"><span>beacon score</span><b class="pos">+0.93</b></div>
                <div class="vs-total"><span>rank</span><b class="neg">0.93</b></div>
              </div>
              <p class="vs-note">The <em>highest</em> raw score — a very regular beacon to a CDN — but not one other candidate points at it. A lone signal.</p>
            </article>
            <article class="vs-card lose">
              <div class="vs-top"><span class="vs-id">BEA-003</span><span class="vs-badge lose">no corroboration</span></div>
              <div class="vs-math">
                <div class="vs-line"><span>corroboration 0 × 2</span><b>+0.00</b></div>
                <div class="vs-line"><span>beacon score</span><b class="pos">+0.88</b></div>
                <div class="vs-total"><span>rank</span><b class="neg">0.88</b></div>
              </div>
              <p class="vs-note">A regular keep-alive to Microsoft 365 — again, high regularity but zero corroborating evidence.</p>
            </article>
          </div>

          <p class="cv-note">What makes BEA-001 win is the corroboration converging on it:</p>
          <div class="converge">
            <div class="cvg-items">
              <span class="cvg-item"><code>TLS-001</code> same source→dest</span>
              <span class="cvg-item"><code>INTEL-001</code> same destination</span>
              <span class="cvg-item"><code>DT-001</code> same process</span>
            </div>
            <ArrowsInIcon class="cvg-arrow" size={22} weight="bold" />
            <span class="cvg-target"><TargetIcon size={16} weight="duotone" /> BEA-001</span>
          </div>
        </details>

        <!-- Callout -->
        <aside class="cv-callout">
          <ScalesIcon size={22} weight="duotone" />
          <p>
            <strong>Raw score is not priority — corroboration is.</strong> A lone high-regularity beacon
            is exactly what a benign service (a CDN, an EDR heartbeat, an M365 keep-alive) produces. The
            real threat is the beacon where <em>independent evidence converges</em> — BEA-001 at 0.90 with
            three corroborating signals, not the lone 0.93 beacon. The harness targets and gathers; the
            model then judges, and the <em>assessment</em> layer later decides legitimacy.
          </p>
        </aside>
      </div>
    </div>
  {:else if activeTab === "scoring"}
    <!-- ═══════════════════════════════════════════════════ -->
    <!-- SCORING VIEW  (how the 3 correlating candidates score)-->
    <!-- ═══════════════════════════════════════════════════ -->
    <div class="code-view">
      <div class="code-inner">
        <header class="cv-hero">
          <span class="cv-eyebrow">Lab 06 · Candidate Scoring</span>
          <h2>How the other three dimensions are scored</h2>
          <p>
            The detection skill fuses four candidate scores:
            <code>max(beacon, intel, tls, exfil)</code>. You saw <strong>beacon</strong> scoring in
            Lab 02. Here's the gist of the other three. Each is produced by a deterministic scorer in
            the distillation pipeline — the workshop hardcodes the results, but this is the real logic.
            Notice each one <em>fuses its signals a different way</em>.
          </p>
          <div class="cv-mental-model">
            <FingerprintIcon size={18} weight="duotone" /><span>TLS · max-of-3</span>
            <span class="cv-mm-sep">·</span>
            <GlobeHemisphereWestIcon size={18} weight="duotone" /><span>Intel · multiply → corroborate</span>
            <span class="cv-mm-sep">·</span>
            <UploadSimpleIcon size={18} weight="duotone" /><span>Data · 50 / 50 blend</span>
          </div>
        </header>

        <div class="sc-subtabs" role="tablist">
          <button role="tab" class:active={scoringTab === "tls"} onclick={() => (scoringTab = "tls")}><FingerprintIcon size={16} weight="duotone" /> TLS Anomaly</button>
          <button role="tab" class:active={scoringTab === "intel"} onclick={() => (scoringTab = "intel")}><GlobeHemisphereWestIcon size={16} weight="duotone" /> Intel Match</button>
          <button role="tab" class:active={scoringTab === "data"} onclick={() => (scoringTab = "data")}><UploadSimpleIcon size={16} weight="duotone" /> Data Transfer</button>
        </div>

        {#if scoringTab === "tls"}
          <p class="sc-gist"><strong>tls_anomaly_signature</strong> = the strongest of three independent red-flag dimensions. The worst signal wins — no averaging.</p>
          <div class="sc-dims">
            <article class="sc-card">
              <div class="sc-card-head"><CertificateIcon size={22} weight="duotone" /><h4>Certificate</h4></div>
              <p class="sc-sub">Red flags <em>add up</em> (cap 1.0):</p>
              <ul class="sc-list">
                <li><span>self-signed</span><b>+0.40</b></li>
                <li><span>expired</span><b>+0.20</b></li>
                <li><span>validity &lt; 7 days</span><b>+0.15</b></li>
                <li><span>validity &gt; 10 years</span><b>+0.15</b></li>
                <li><span>serial &lt; 4 bytes</span><b>+0.10</b></li>
              </ul>
              <p class="sc-note">self-signed → an internal IP is excluded (that's normal).</p>
            </article>
            <article class="sc-card">
              <div class="sc-card-head"><FingerprintIcon size={22} weight="duotone" /><h4>Fingerprint</h4></div>
              <p class="sc-sub">Known-bad JA3/JA4 lookup — <em>best hit wins</em>:</p>
              <ul class="sc-list">
                <li><span>JA3 + JA3S pair</span><b>0.95</b></li>
                <li><span>JA4X</span><b>0.95</b></li>
                <li><span>JA3</span><b>0.90</b></li>
                <li><span>JA3S</span><b>0.80</b></li>
              </ul>
              <p class="sc-note">matched against SSLBL-style feeds.</p>
            </article>
            <article class="sc-card">
              <div class="sc-card-head"><ShieldCheckIcon size={22} weight="duotone" /><h4>SNI</h4></div>
              <p class="sc-sub"><em>Best of</em>:</p>
              <ul class="sc-list">
                <li><span>SNI ≠ certificate</span><b>0.70</b></li>
                <li><span>SNI but raw-IP dial</span><b>0.60</b></li>
                <li><span>missing SNI</span><b>0.50</b></li>
              </ul>
              <p class="sc-note">handshake says one thing, the cert/DNS another.</p>
            </article>
          </div>
          <div class="sc-combine">
            <span class="sc-op">max(</span><span class="sc-chip">cert</span><span class="sc-chip">fingerprint</span><span class="sc-chip">sni</span><span class="sc-op">)</span>
            <ArrowRightIcon size={16} weight="bold" />
            <span class="sc-result">tls_anomaly_signature</span>
          </div>
          <p class="sc-foot">Grouped per (src, dst, port); each dimension takes its max across all handshakes in the group. Must clear 0.30 to emit a candidate.</p>

        {:else if scoringTab === "intel"}
          <p class="sc-gist"><strong>infrastructure_reputation</strong> = is the destination in a threat-intel feed? Each feed's confidence is a <em>chain of multipliers</em>; then independent feeds reinforce one another.</p>
          <div class="sc-chain">
            <span class="sc-factor"><b>precision</b><small>hash &gt; IP &gt; domain &gt; ASN</small></span>
            <span class="sc-mul">×</span>
            <span class="sc-factor"><b>reliability</b><small>feed confidence / source tier</small></span>
            <span class="sc-mul">×</span>
            <span class="sc-factor"><b>freshness</b><small>decays as the IoC ages</small></span>
            <span class="sc-mul">×</span>
            <span class="sc-factor"><b>anti-signal</b><small>warninglist / GreyNoise dampening</small></span>
            <ArrowRightIcon size={16} weight="bold" />
            <span class="sc-result">source fidelity</span>
          </div>
          <p class="sc-why">A whole-ASN "match" is weak; an exact file hash is strong. Stale intel counts less. If the indicator is also on a known-good list, it's dampened — that's what kills false positives on popular infrastructure.</p>
          <article class="sc-corro">
            <div class="sc-card-head"><StackIcon size={22} weight="duotone" /><h4>Corroboration — independent feeds reinforce</h4></div>
            <p>Multiple <em>independent</em> sources flagging the same indicator combine (noisy-OR):</p>
            <pre class="cv-code"><code>score = 1 − Π(1 − fidelityᵢ)</code></pre>
            <p class="sc-example">two independent 0.7 feeds → 1 − (0.3 × 0.3) = <b>0.91</b>. Same-provenance duplicates don't double-count.</p>
          </article>
          <div class="sc-combine">
            <span class="sc-result">corroborated_fidelity</span>
            <ArrowRightIcon size={16} weight="bold" />
            <span class="sc-chip">routing tier: immediate · standard · low</span>
          </div>

        {:else}
          <p class="sc-gist"><strong>exfil_volume_anomaly</strong> = lots of bytes going <em>out</em> vs coming <em>in</em>. Shape + size, half and half. Gated at ≥ 1 MB outbound.</p>
          <div class="sc-dims sc-two">
            <article class="sc-card">
              <div class="sc-card-head"><ScalesIcon size={22} weight="duotone" /><h4>PCR — the shape</h4></div>
              <pre class="cv-code"><code>(bytes_out − bytes_in) / total</code></pre>
              <p class="sc-sub">≈ 1.0 = almost pure upload (exfil shape); ≈ 0 = balanced. Clamped ≥ 0.</p>
              <span class="sc-weight">weight 0.50</span>
            </article>
            <article class="sc-card">
              <div class="sc-card-head"><GaugeIcon size={22} weight="duotone" /><h4>Volume — the size</h4></div>
              <pre class="cv-code"><code>min(bytes_out / 100 MB, 1.0)</code></pre>
              <p class="sc-sub">How much actually left, normalised and capped.</p>
              <span class="sc-weight">weight 0.50</span>
            </article>
          </div>
          <div class="sc-combine">
            <span class="sc-result">exfil_volume_anomaly</span>
            <span class="sc-op">=</span> <span class="sc-chip">0.5 · PCR</span> <PlusIcon size={14} weight="bold" /> <span class="sc-chip">0.5 · Volume</span>
          </div>
          <p class="sc-foot">Burstiness, PCR-consistency and transfer-rate are computed too — but as context in the record, not part of the score.</p>
        {/if}

        <aside class="cv-callout">
          <ScalesIcon size={22} weight="duotone" />
          <p>
            <strong>Three different fusion styles, on purpose.</strong> TLS takes the <em>max</em> (any one red
            flag is decisive). Data transfer <em>blends</em> two signals 50/50 (you need both shape and size).
            Intel <em>multiplies</em> factors then corroborates across feeds. The detection skill then takes the
            <em>max</em> of all four candidate composites — the strongest decisive signal carries the finding.
          </p>
        </aside>
      </div>
    </div>
  {:else if activeTab === "code"}
    <!-- ═══════════════════════════════════════════════════ -->
    <!-- CODE VIEW  (architectural reference, non-interactive)-->
    <!-- ═══════════════════════════════════════════════════ -->
    <div class="code-view">
      <div class="code-inner">
        <!-- Intro -->
        <header class="cv-hero">
          <span class="cv-eyebrow">Under the Hood</span>
          <h2>How a detection skill runs</h2>
          <p>
            Optional reading for the curious. A "skill" here is just a <strong>Markdown file</strong>.
            Its frontmatter tells the harness what evidence to gather; its body is the procedure the
            <strong>model</strong> executes. The harness does the deterministic gathering, the model
            does the judgement — and the result is a <code>DetectionFinding</code>. This is a real
            model call.
          </p>
          <div class="cv-mental-model">
            <FileMdIcon size={20} weight="duotone" />
            <span>a Markdown skill</span>
            <span class="cv-mm-sep">→</span>
            <FunnelIcon size={20} weight="duotone" />
            <span>harness gathers evidence</span>
            <span class="cv-mm-sep">→</span>
            <RobotIcon size={20} weight="duotone" />
            <span>model judges</span>
          </div>
        </header>

        <!-- A · Journey -->
        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">A</span> The journey of one detection<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">
            Five phases turn a skill file plus a pile of candidates into one finding. The first four
            are deterministic harness work; only the last calls the model.
          </p>

          <ol class="flow">
            <li class="flow-step" style="--d: 0ms">
              <span class="flow-rail"><ListMagnifyingGlassIcon size={22} weight="duotone" /></span>
              <div class="flow-body">
                <div class="flow-top"><span class="flow-title">Discover the skill catalog</span><span class="flow-where">server · skill-loader.ts</span></div>
                <p><code>listSkills()</code> walks the <code>skills/</code> folder and parses each file's YAML frontmatter. Detection skills are the ones marked <code>layer: detection</code>.</p>
              </div>
            </li>
            <li class="flow-step" style="--d: 90ms">
              <span class="flow-rail"><BracketsCurlyIcon size={22} weight="duotone" /></span>
              <div class="flow-body">
                <div class="flow-top"><span class="flow-title">Inspect the invocation metadata</span><span class="flow-where">server · api/skills</span></div>
                <p>The frontmatter declares which candidate type <em>triggers</em> the skill, an <code>invocationGate</code> it must pass, and the related candidate types to correlate.</p>
              </div>
            </li>
            <li class="flow-step" style="--d: 180ms">
              <span class="flow-rail"><FunnelIcon size={22} weight="duotone" /></span>
              <div class="flow-body">
                <div class="flow-top"><span class="flow-title">Query &amp; gate the trigger</span><span class="flow-where">server · api/skills</span></div>
                <p><code>chooseTrigger()</code> finds candidates of the trigger type, applies the gate (e.g. <code>minBeaconScore ≥ 0.85</code>), and ranks them to pick the one that fired.</p>
              </div>
            </li>
            <li class="flow-step" style="--d: 270ms">
              <span class="flow-rail"><StackIcon size={22} weight="duotone" /></span>
              <div class="flow-body">
                <div class="flow-top"><span class="flow-title">Assemble the evidence bundle</span><span class="flow-badge">the key step</span><span class="flow-where">server · api/skills</span></div>
                <p>For each correlation rule, the harness pulls related candidates by <em>scope</em> (same network tuple, same destination, same process, same host) and bundles them with the trigger.</p>
              </div>
            </li>
            <li class="flow-step" style="--d: 360ms">
              <span class="flow-rail"><RobotIcon size={22} weight="duotone" /></span>
              <div class="flow-body">
                <div class="flow-top"><span class="flow-title">Execute — the model runs the procedure</span><span class="flow-where">server · providers/*</span></div>
                <p>The skill's body becomes the <strong>system prompt</strong>; the evidence bundle becomes the <strong>user prompt</strong>. The model reasons over the evidence and streams back a <code>DetectionFinding</code> — scored dimensions, the reasoning in named fields (narrative, uncertainty, benign-fallbacks), and evidence refs.</p>
              </div>
            </li>
          </ol>
        </details>

        <!-- B · Anatomy of a skill -->
        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">B</span> Anatomy of a skill file<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">
            Every skill is one Markdown file in two halves. The harness reads the top; the model
            reads the bottom.
          </p>

          <div class="skillfile">
            <div class="sf-zone sf-front">
              <div class="sf-tag"><BracketsCurlyIcon size={14} weight="bold" /> frontmatter — the contract (the harness reads this)</div>
              <pre><code>name: hunt-c2-over-https
layer: detection
invocationTriggerCandidate: beacon
invocationGate:
  observedService: ssl
  minBeaconScore: 0.85
correlatingCandidates:
  - type: tls_anomaly   scope: same_network_tuple
  - type: intel_match   scope: destination
mitreTechniques: [T1071.001, T1573.002]</code></pre>
            </div>
            <div class="sf-zone sf-body">
              <div class="sf-tag"><FileMdIcon size={14} weight="bold" /> body — the procedure (the model reads this)</div>
              <pre><code># Objective
Determine whether an HTTPS beacon is C2…

# Procedure
Load the trigger beacon, inspect its score,
rarity, intel, and process attribution…

# Scoring
compositeScore = max(beacon, intel, tls)</code></pre>
            </div>
          </div>
          <p class="cv-note">
            The split is the whole idea: machine-readable frontmatter drives the deterministic
            gathering, human-readable body drives the model's judgement.
          </p>
        </details>

        <!-- C · The finding it emits -->
        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">C</span> The finding it emits — the <code>DetectionFinding</code> shape<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">
            Detection's output is one typed object. The reasoning lives in <strong>named fields</strong>,
            not a prose blob: the model fills them in, the deterministic schema gate validates the shape,
            and the readable card in step 03 is rendered <em>from</em> this object — never the other way
            round.
          </p>

          <div class="sf-zone sf-body cv-typeblock">
            <div class="sf-tag"><BracketsCurlyIcon size={14} weight="bold" /> the typed shape the model fills in</div>
            <pre><code>{DETECTION_FINDING_TYPE}</code></pre>
          </div>

          <table class="cv-fieldtable">
            <tbody>
              <tr><td class="hd">Field</td><td class="hd">What it carries</td></tr>
              <tr><td class="fld"><code>layer</code> · <code>skillName</code> · <code>candidateId</code></td><td>Identity — which detection skill judged which candidate.</td></tr>
              <tr><td class="fld"><code>verdict</code></td><td>The call: <code>true_positive</code>, <code>false_positive</code>, or <code>inconclusive</code> (still human-confirmed downstream).</td></tr>
              <tr><td class="fld"><code>compositeScore</code></td><td>The single rankable number — <code>= max(dimensions[].score)</code>, never an average. On its own, the <em>least</em> informative field.</td></tr>
              <tr><td class="fld"><code>dimensions[]</code></td><td>Per-signal <code>score</code> plus the <strong>decisive evidence string</strong> behind it — the agent's selection and sourcing, not bare numbers.</td></tr>
              <tr><td class="fld"><code>evidenceSummary</code></td><td>A tight one-line synopsis of what fired.</td></tr>
              <tr><td class="fld"><code>attackNarrative</code></td><td>The story a human reads — process lineage → behaviour → channel.</td></tr>
              <tr><td class="fld"><code>uncertainty</code></td><td>What is <em>not</em> confirmed, plus alternative explanations.</td></tr>
              <tr><td class="fld"><code>benignFallbackRuledOut[]</code></td><td>The malicious-vs-benign work — <em>why</em> it isn't EDR, an update service, or ordinary browsing.</td></tr>
              <tr><td class="fld"><code>mitreTechniques[]</code></td><td>ATT&amp;CK techniques asserted, with their basis cited in <code>dimensions[].evidence</code>.</td></tr>
              <tr><td class="fld"><code>evidenceRefs</code></td><td>Pointers back to the candidates and raw events the finding rests on.</td></tr>
              <tr><td class="fld"><code>scope</code></td><td>The host the activity is bound to.</td></tr>
            </tbody>
          </table>

          <p class="cv-note">
            This is the contract: every claim sits in a named field, so the finding is auditable and the
            later stages (connect, narrate, report) read it directly — never by re-parsing prose.
          </p>
        </details>

        <!-- D · Four ideas -->
        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">D</span> Four ideas worth understanding<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <div class="cv-cards">
            <article class="cv-card">
              <div class="cv-card-head"><FileMdIcon size={26} weight="duotone" /><h4>Skills are data, not code</h4></div>
              <p>A detection is a Markdown file. To add one, you drop a <code>.md</code> into <code>skills/detection/</code> — no code change, no redeploy of logic. The harness discovers it automatically.</p>
            </article>
            <article class="cv-card">
              <div class="cv-card-head"><BracketsCurlyIcon size={26} weight="duotone" /><h4>Frontmatter is the contract; body is the procedure</h4></div>
              <p>The YAML is machine-read: trigger type, gate, correlation scopes, MITRE techniques. The prose body is model-read: the actual detection reasoning. One file, two audiences.</p>
            </article>
            <article class="cv-card">
              <div class="cv-card-head"><ScalesIcon size={26} weight="duotone" /><h4>The harness gathers; the model judges</h4></div>
              <p>Gating, correlation, and bundling are deterministic code — repeatable and auditable. Only the final judgement is the model's. Evidence selection never depends on the model's mood.</p>
            </article>
            <article class="cv-card">
              <div class="cv-card-head"><RobotIcon size={26} weight="duotone" /><h4>The body becomes the system prompt</h4></div>
              <p>At runtime the skill's procedure is handed to the model verbatim as its system prompt, with the evidence bundle as the user prompt. The Markdown you wrote <em>is</em> the instructions.</p>
            </article>
          </div>
        </details>

        <!-- D · File tree -->
        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">E</span> Where each piece lives<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">Skills are content; the loader and endpoint are the machinery that runs them.</p>
          <pre class="cv-tree"><code><span class="tr-dir">hunting-agent/</span>
│
├─ <span class="tr-dir">skills/detection/</span>             <span class="tr-cm">← the detection skill (Markdown + YAML)</span>
│  └─ <span class="tr-file">hunt-c2-over-https.md</span>
│
└─ <span class="tr-dir">src/</span>
   ├─ <span class="tr-dir">routes/lab/06/api/skills/</span>
   │  └─ <span class="tr-file">+server.ts</span>          <span class="tr-cm">← gate · correlate · bundle · call the model</span>
   └─ <span class="tr-dir">framework/</span>
      └─ <span class="tr-file">skill-loader.ts</span>     <span class="tr-cm">← walk skills/, split frontmatter from body</span></code></pre>
        </details>

        <!-- Callout -->
        <aside class="cv-callout">
          <FileMdIcon size={22} weight="duotone" />
          <p>
            <strong>Why skills as files?</strong> A detection team can author, review, and version
            detections as plain Markdown — like documentation — and the agent picks them up with no
            code change. The frontmatter keeps the gathering deterministic; the body lets an expert
            write the reasoning in prose. That's how you scale an agent's capabilities safely.
          </p>
        </aside>
      </div>
    </div>
  {/if}
</main>

{#snippet SkillContract({ skill }: { skill: SkillSummary })}
  <section class="contract">
    <div class="tab-bar" role="tablist" aria-label="Skill detail views">
      <button class="tab" class:active={skillTab === "frontmatter"} role="tab" aria-selected={skillTab === "frontmatter"} onclick={() => (skillTab = "frontmatter")}>
        YAML Frontmatter
      </button>
      <button class="tab" class:active={skillTab === "procedure"} role="tab" aria-selected={skillTab === "procedure"} onclick={() => (skillTab = "procedure")}>
        Procedure
      </button>
      <button class="tab" class:active={skillTab === "reference"} role="tab" aria-selected={skillTab === "reference"} onclick={() => (skillTab = "reference")}>
        Reference
      </button>
    </div>

    {#if skillTab === "frontmatter"}
      <div class="tab-panel">
        <p class="tab-note">{skill.path}</p>
        <pre class="yaml-block">---
{skill.frontmatter}
---</pre>
      </div>
    {:else if skillTab === "procedure"}
      <div class="tab-panel">
        <div class="markdown-body">
          {@render MarkdownView({ blocks: parseMarkdown(skill.body) })}
        </div>
      </div>
    {:else}
      <div class="tab-panel">
        {@render ReferenceView({ refs: skill.candidateReference ?? [] })}
      </div>
    {/if}
  </section>
{/snippet}

{#snippet ReferenceView({ refs }: { refs: CandidateRef[] })}
  {#if refs.length === 0}
    <p class="empty">This skill declares no candidate types.</p>
  {:else}
    <p class="tab-note">The candidate types this skill reads — its trigger plus the correlating evidence it fuses. Scores are illustrative values from the curated workshop dataset (not computed by a live engine here); the full dimension-by-dimension math is worked through for the beacon example in Lab 02.</p>
    <div class="ref-list">
      {#each refs as ref}
        <article class="candidate-ref" class:trigger={ref.role === "trigger"}>
          <div class="ref-head">
            <strong>{ref.type}</strong>
            <span class="ref-role">{ref.role === "trigger" ? "trigger" : `correlating · ${ref.scope ?? "any"}`}</span>
          </div>
          <p>{@html renderInline(ref.description)}</p>
          {#if ref.scopeDescription}
            <p class="ref-meta"><em>scope</em> {ref.scopeDescription}</p>
          {/if}
          {#if ref.fields.length}
            <div class="ref-fields">
              {#each ref.fields as field}
                <code>{field}</code>
              {/each}
            </div>
          {/if}
          {#if ref.scoreNote}
            <p class="ref-meta"><em>score</em> {@html renderInline(ref.scoreNote)}</p>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet MarkdownView({ blocks }: { blocks: MarkdownBlock[] })}
  {#each blocks as block}
    {#if block.kind === "heading"}
      <h4 class:major={block.level <= 2}>{@html renderInline(block.text)}</h4>
    {:else if block.kind === "paragraph"}
      <p>{@html renderInline(block.text)}</p>
    {:else if block.kind === "list"}
      <ul>
        {#each block.items as item}
          <li>{@html renderInline(item)}</li>
        {/each}
      </ul>
    {:else if block.kind === "code"}
      <pre class="code-block"><code>{block.text}</code></pre>
    {:else if block.kind === "table"}
      <table>
        <thead>
          <tr>
            {#each block.headers as header}
              <th>{@html renderInline(header)}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each block.rows as row}
            <tr>
              {#each row as cell}
                <td>{@html renderInline(cell)}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/each}
{/snippet}

{#snippet FindingStream()}
  <article class="finding-summary">
    <div class="finding-head">
      <span>DetectionFinding</span>
      <div class="finding-badges">
        {#if findingModel}
          <span class="model-badge">model: {findingModel}</span>
        {/if}
        {#if modelStreaming}
          <span class="streaming-badge">streaming.</span>
        {/if}
      </div>
    </div>

    <p class="real-call-note">
      The model's real output is the <strong>structured JSON object</strong> below — the reasoning
      lives in named fields, never a prose blob. The harness then <strong>validates it (the schema
      gate)</strong>, and the readable card at the bottom is a <strong>deterministic rendering of the
      typed object</strong> — <em>not</em> the model's output, and <em>not</em> what the harness
      persists (it persists the object, not the prose).
    </p>

    <!-- 1 · the model's real output: the JSON DetectionFinding (streams live) -->
    <div class="finding-stage">
      <span class="stage-label">1 · Model output — JSON <code>DetectionFinding</code></span>
      {#if findingText}
        <pre class="finding-json">{findingText}</pre>
      {:else if modelStreaming}
        <p class="empty">Waiting for the first tokens from the model.</p>
      {:else}
        <p class="empty">No output yet.</p>
      {/if}
    </div>

    <!-- 2 · the deterministic schema gate -->
    {#if gate}
      <div class="finding-stage">
        <span class="stage-label">2 · Schema gate — deterministic, no LLM</span>
        {#if gate.pass}
          <p class="gate-pass">PASS — the JSON validates into the typed DetectionFinding.</p>
        {:else}
          <p class="gate-fail">
            REJECTED — {gate.errors.length} issue(s). In the real framework this triggers a correction retry:
          </p>
          <ul class="gate-errors">
            {#each gate.errors as err}
              <li>{err}</li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}

    <!-- 3 · the readable rendering, FROM the typed object -->
    {#if finding}
      <div class="finding-stage">
        <span class="stage-label">
          3 · Rendered for reading — a deterministic view of the typed object (not the model output)
        </span>
        {@render RenderedFinding({ finding })}
      </div>
    {/if}

    {#if findingUsage}
      <details>
        <summary>Token usage</summary>
        <pre>{json(findingUsage)}</pre>
      </details>
    {/if}
  </article>
{/snippet}

{#snippet RenderedFinding({ finding }: { finding: DetectionFindingObject })}
  <div class="rendered-finding">
    <div class="rf-row">
      <span class="rf-verdict rf-{finding.verdict}">{finding.verdict.replace("_", " ")}</span>
      <span class="rf-score">compositeScore <strong>{finding.compositeScore.toFixed(2)}</strong> = max(dimensions)</span>
    </div>

    {#if finding.evidenceSummary}
      <p class="rf-summary">{finding.evidenceSummary}</p>
    {/if}

    {#if finding.dimensions.length}
      <table class="rf-dimensions">
        <thead><tr><th>dimension</th><th>score</th><th>decisive evidence</th></tr></thead>
        <tbody>
          {#each finding.dimensions as dim}
            <tr>
              <td><code>{dim.name}</code></td>
              <td>{dim.score.toFixed(2)}</td>
              <td>{dim.evidence}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}

    {#if finding.attackNarrative}
      <p class="rf-field"><span class="rf-key">Attack narrative</span> {finding.attackNarrative}</p>
    {/if}
    {#if finding.uncertainty}
      <p class="rf-field"><span class="rf-key">Uncertainty</span> {finding.uncertainty}</p>
    {/if}

    {#if finding.benignFallbackRuledOut.length}
      <div class="rf-field">
        <span class="rf-key">Benign fallbacks ruled out</span>
        <ul class="rf-fallbacks">
          {#each finding.benignFallbackRuledOut as bf}
            <li><strong>{bf.fallback}</strong> — {bf.ruledOutBecause}</li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if finding.mitreTechniques.length}
      <p class="rf-field"><span class="rf-key">MITRE techniques</span> {finding.mitreTechniques.join(", ")}</p>
    {/if}
  </div>
{/snippet}

{#snippet PromptView()}
  <p class="prompt-caption">
    How the loaded skill was parsed and assembled into the two prompts sent to the model.
  </p>
  <div class="tab-bar" role="tablist" aria-label="Prompt views">
    <button class="tab" class:active={promptTab === "system"} role="tab" aria-selected={promptTab === "system"} onclick={() => (promptTab = "system")}>
      System prompt
    </button>
    <button class="tab" class:active={promptTab === "user"} role="tab" aria-selected={promptTab === "user"} onclick={() => (promptTab = "user")}>
      User prompt
    </button>
  </div>
  {#if promptTab === "system"}
    <div class="tab-panel">
      <p class="tab-note">the wrapped skill procedure</p>
      <pre>{systemPrompt}</pre>
    </div>
  {:else}
    <div class="tab-panel">
      <p class="tab-note">output instructions + evidence bundle</p>
      <pre>{userPrompt}</pre>
    </div>
  {/if}
{/snippet}

{#snippet TraceView({ trace }: { trace: TraceStep[] })}
  <div class="trace">
    {#each trace as step}
      <article class:warning={step.status === "warning"}>
        <span>{step.step}</span>
        <div>
          <strong>{step.title}</strong>
          <p>{step.detail}</p>
          <code>{step.result}</code>
        </div>
      </article>
    {/each}
  </div>
{/snippet}

{#snippet EvidenceView({ bundle }: { bundle: EvidenceBundle })}
  <div class="evidence">
    <article class="candidate trigger">
      <span>trigger</span>
      <strong>{bundle.trigger.id}</strong>
      <p>
        {typeLabel(bundle.trigger.type)} | {bundle.trigger.host} |
        {bundle.trigger.destIp}
      </p>
      <small>
        {bundle.trigger.processName} | score {bundle.trigger.score} | LOTS
        {bundle.trigger.lots}
      </small>
    </article>

    <div class="candidate-list">
      {#each bundle.related as candidate}
        <article class="candidate">
          <span>{typeLabel(candidate.type)}</span>
          <strong>{candidate.id}</strong>
          <p>{candidate.host} | {candidate.destIp || candidate.srcIp || "no network observable"}</p>
          <small>{candidate.processName} | score {candidate.score} | {candidate.eventIds.length} event refs</small>
        </article>
      {/each}
    </div>

    <div class="query-summary">
      <h4>Query summary</h4>
      <div class="stat-list">
        {#each Object.entries(bundle.querySummary) as [type, count]}
          <span><strong>{typeLabel(type)}</strong><em>{count}</em></span>
        {/each}
      </div>
    </div>
  </div>
{/snippet}

<style>
  main {
    width: min(1500px, calc(100% - 2rem));
    margin: 0 auto;
    padding: 2rem 0 4rem;
  }

  .hero { margin-bottom: 1rem; }

  h1, h2, h3, h4, p { margin: 0; }

  h1 {
    color: var(--dracula-cyan);
    font-size: clamp(2rem, 4vw, 3.4rem);
    line-height: 1;
  }

  h2 {
    color: var(--dracula-pink);
    font-size: 1.25rem;
  }

  h3, h4, .flow-header span, summary, .skill-card, button {
    font-family: var(--font-heading);
    font-weight: 800;
  }

  h3, h4 {
    color: var(--dracula-purple);
    text-transform: uppercase;
  }

  h3 { font-size: .82rem; }
  h4 { font-size: .9rem; }

  p, .empty, small, td, .candidate small {
    color: var(--dracula-muted);
    line-height: 1.5;
  }

  .flow-grid, .contract, .utility-grid, .context-grid, .skill-list, .trace, .candidate-list, .stat-list, .mini-candidates {
    display: grid;
    gap: .85rem;
  }

  .flow-card, .panel, .picker, .candidate, .trace article, .context-grid article {
    min-width: 0;
    border: 1px solid rgba(98, 114, 164, 0.62);
    border-radius: 8px;
    background: rgba(33, 34, 44, 0.82);
  }

  .flow-card, .panel {
    padding: 1rem;
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.22);
  }

  .flow-card.detection { border-color: rgba(245, 230, 99, 0.72); }
  .finding-step { border-color: rgba(245, 230, 99, 0.62); background: rgba(245, 230, 99, 0.06); }
  .finding-step.ready { border-color: rgba(80, 250, 123, .68); background: rgba(80, 250, 123, 0.07); }

  .flow-header {
    display: flex;
    gap: .75rem;
    align-items: baseline;
    margin-bottom: .9rem;
  }

  .flow-header span {
    color: var(--dracula-comment);
    font-size: .9rem;
  }

  .picker {
    padding: .85rem;
    background: rgba(25, 26, 33, 0.38);
  }

  .skill-list { margin-top: .65rem; }
  .skill-list.horizontal { grid-template-columns: repeat(4, minmax(0, 1fr)); }

  .skill-card {
    width: 100%;
    min-height: 5.25rem;
    display: grid;
    align-content: start;
    gap: .45rem;
    padding: .75rem;
    text-align: left;
    background: rgba(25, 26, 33, 0.7);
    overflow: hidden;
  }

  .skill-card.active {
    border-color: rgba(245, 230, 99, 0.78);
    background: rgba(245, 230, 99, 0.09);
  }

  .skill-card strong {
    color: var(--dracula-fg);
    font-size: clamp(.86rem, 1.4vw, 1rem);
    line-height: 1.15;
    overflow-wrap: anywhere;
  }

  .skill-card span {
    color: var(--dracula-muted);
    font-size: .78rem;
    text-transform: uppercase;
    overflow-wrap: anywhere;
  }

  .contract { margin-top: .85rem; }
  .tab-bar { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .65rem; border-bottom: 1px solid rgba(98, 114, 164, .4); padding-bottom: .55rem; }
  .tab-bar .tab { border: 1px solid rgba(98, 114, 164, .5); border-radius: 7px; padding: .4rem .8rem; background: rgba(25, 26, 33, .6); color: var(--dracula-muted); font-size: .8rem; cursor: pointer; }
  .tab-bar .tab.active { border-color: rgba(189, 147, 249, .8); background: rgba(189, 147, 249, .12); color: var(--dracula-fg); }
  .tab-panel { margin-top: .85rem; }
  .tab-note { margin: 0 0 .5rem; font-size: .76rem; color: var(--dracula-comment); font-family: var(--font-heading); overflow-wrap: anywhere; }
  .ref-list { display: grid; gap: .7rem; }
  .candidate-ref { border: 1px solid rgba(98, 114, 164, .5); border-radius: 8px; padding: .8rem; background: rgba(25, 26, 33, .46); display: grid; gap: .4rem; }
  .candidate-ref.trigger { border-color: rgba(245, 230, 99, .6); background: rgba(245, 230, 99, .06); }
  .ref-head { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; }
  .ref-head strong { color: var(--dracula-cyan); font-family: var(--font-heading); font-size: 1rem; }
  .ref-role { color: var(--dracula-purple); font-family: var(--font-heading); font-weight: 800; font-size: .72rem; text-transform: uppercase; }
  .ref-meta { font-size: .82rem; }
  .ref-meta em { color: var(--dracula-yellow); font-style: normal; font-family: var(--font-heading); margin-right: .35rem; }
  .ref-fields { display: flex; flex-wrap: wrap; gap: .35rem; }
  .ref-fields code { background: rgba(25, 26, 33, .8); border: 1px solid rgba(98, 114, 164, .4); border-radius: 5px; padding: .12rem .4rem; color: var(--dracula-green); font-size: .76rem; }
  .candidate-ref p :global(code) { background: rgba(25, 26, 33, .8); border: 1px solid rgba(98, 114, 164, .35); border-radius: 5px; padding: .03rem .3rem; color: var(--dracula-green); font-size: .85em; }
  .candidate-ref p :global(strong) { color: var(--dracula-fg); font-weight: 800; }

  summary {
    cursor: pointer;
    color: var(--dracula-cyan);
  }

  summary span { color: var(--dracula-cyan); }

  summary small {
    float: right;
    max-width: 52%;
    color: var(--dracula-comment);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .markdown-body {
    display: grid;
    gap: .75rem;
    margin-top: .85rem;
  }

  .markdown-body h4 {
    color: var(--dracula-cyan);
    font-size: .98rem;
    text-transform: none;
  }

  .markdown-body h4.major {
    color: var(--dracula-pink);
    font-size: 1.05rem;
  }

  .markdown-body :global(strong) { color: var(--dracula-fg); font-weight: 800; }
  .markdown-body :global(em) { color: var(--dracula-fg); font-style: italic; }
  .markdown-body :global(code) {
    background: rgba(25, 26, 33, .8);
    border: 1px solid rgba(98, 114, 164, .4);
    border-radius: 5px;
    padding: .05rem .35rem;
    color: var(--dracula-green);
    font-size: .86em;
  }
  .code-block {
    margin: 0;
    border: 1px solid rgba(98, 114, 164, .5);
    border-radius: 8px;
    background: rgba(25, 26, 33, .82);
    padding: .75rem .85rem;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .code-block code { color: var(--dracula-green); font-size: .82rem; line-height: 1.5; }

  ul {
    display: grid;
    gap: .4rem;
    margin: 0;
    padding-left: 1.1rem;
  }

  li { color: var(--dracula-muted); }

  table {
    width: 100%;
    border-collapse: collapse;
    overflow: hidden;
    border: 1px solid rgba(98, 114, 164, .45);
    border-radius: 8px;
  }

  th, td {
    border-bottom: 1px solid rgba(98, 114, 164, .38);
    padding: .55rem;
    text-align: left;
    vertical-align: top;
  }

  tr:last-child td { border-bottom: 0; }

  th {
    display: block;
    margin-bottom: .25rem;
    color: var(--dracula-purple);
    font-family: var(--font-heading);
    font-size: .72rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  .cv-typeblock { margin-top: .9rem; }

  .cv-fieldtable { margin-top: .9rem; }
  .cv-fieldtable td { font-size: .86rem; line-height: 1.5; }
  .cv-fieldtable td.hd {
    color: var(--dracula-purple);
    font-family: var(--font-heading);
    font-size: .72rem;
    font-weight: 800;
    text-transform: uppercase;
  }
  .cv-fieldtable td.fld {
    width: 32%;
    color: var(--dracula-pink);
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .cv-fieldtable td.fld code { color: inherit; background: none; padding: 0; }

  .stage-actions { margin-top: .85rem; }
  button { min-height: 2.35rem; padding: .35rem .85rem; }

  .finding-summary { display: grid; gap: .85rem; }

  .finding-summary span, .candidate span {
    color: var(--dracula-comment);
    font-family: var(--font-heading);
    font-weight: 800;
    text-transform: uppercase;
  }

  .finding-head {
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
  }

  .finding-badges { display: flex; gap: .5rem; flex-wrap: wrap; }

  .model-badge, .streaming-badge {
    border: 1px solid rgba(98, 114, 164, .55);
    border-radius: 999px;
    padding: .15rem .6rem;
    font-family: var(--font-heading);
    font-size: .72rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  .model-badge { color: var(--dracula-cyan); border-color: rgba(139, 233, 253, .5); }

  .streaming-badge {
    color: var(--dracula-yellow);
    border-color: rgba(245, 230, 99, .55);
    background: rgba(245, 230, 99, .08);
  }

  .real-call-note {
    border-left: 3px solid rgba(139, 233, 253, .6);
    padding-left: .65rem;
    font-size: .82rem;
  }

  .finding-markdown { margin-top: 0; }

  .tab-panel pre { margin: 0; max-height: 360px; overflow: auto; white-space: pre-wrap; word-break: break-word; font-size: .76rem; line-height: 1.45; }
  .prompt-caption { margin: 0 0 .3rem; font-size: .82rem; color: rgba(248, 248, 242, .62); }
  .query-summary { margin-top: .85rem; }

  .stat-list span, .mini-candidates span {
    min-width: 0;
    border: 1px solid rgba(98, 114, 164, 0.45);
    border-radius: 8px;
    background: rgba(25, 26, 33, 0.55);
    padding: .65rem;
  }
  .utility-grid { margin-top: 1rem; }

  .panel > summary {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
  }

  .trace article {
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr);
    gap: .85rem;
    padding: .85rem;
    background: rgba(25, 26, 33, 0.48);
  }

  .trace article.warning { border-color: rgba(245, 230, 99, .64); }

  .trace article > span {
    width: 2rem;
    height: 2rem;
    display: inline-grid;
    place-items: center;
    border-radius: 999px;
    background: rgba(80, 250, 123, 0.12);
    color: var(--dracula-green);
    font-family: var(--font-heading);
    font-weight: 800;
  }

  .trace strong, .candidate strong, .stat-list strong {
    color: var(--dracula-cyan);
    overflow-wrap: anywhere;
  }

  .trace code {
    display: block;
    color: var(--dracula-yellow);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .evidence { margin-top: .85rem; }
  .candidate { display: grid; gap: .3rem; padding: .75rem; }
  .candidate.trigger { margin-bottom: .75rem; border-color: rgba(80, 250, 123, .65); background: rgba(80, 250, 123, .08); }
  .candidate span { color: var(--dracula-purple); font-size: .72rem; }

  .context-grid {
    grid-template-columns: .75fr 1fr;
    margin-top: .85rem;
  }

  .context-grid article { padding: .85rem; background: rgba(25, 26, 33, .48); }
  .stat-list, .mini-candidates { margin-top: .65rem; }
  .stat-list span { display: flex; justify-content: space-between; gap: 1rem; }
  .stat-list em { color: var(--dracula-green); font-style: normal; overflow-wrap: anywhere; }
  .mini-candidates span { color: var(--dracula-muted); font-family: var(--font-heading); font-size: .85rem; }

  pre {
    max-height: 28rem;
    overflow: auto;
    margin: .75rem 0 0;
    border: 1px solid rgba(98, 114, 164, 0.5);
    border-radius: 8px;
    background: rgba(25, 26, 33, 0.82);
    color: var(--dracula-fg);
    padding: .85rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .empty {
    border: 1px dashed rgba(98, 114, 164, .55);
    border-radius: 8px;
    padding: .85rem;
  }

  .error-panel {
    margin-bottom: 1rem;
    border: 1px solid rgba(255, 85, 85, 0.65);
    border-radius: 8px;
    background: rgba(255, 85, 85, 0.1);
    color: var(--dracula-red);
    padding: 1rem;
  }

  @media (max-width: 1150px) {
    .skill-list.horizontal { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .context-grid { grid-template-columns: 1fr; }
  }

  @media (max-width: 720px) {
    main { width: min(100% - 1rem, 1500px); padding-top: 1rem; }
    .skill-list.horizontal { grid-template-columns: 1fr; }
    summary small { float: none; display: block; max-width: 100%; margin-top: .25rem; }
  }

  /* ═══ Top tab bar ══════════════════════════════════════ */
  .tab-bar-top {
    display: flex;
    gap: 0;
    border-bottom: 1px solid #1a1a2e;
    margin-bottom: 1rem;
  }
  .tab-btn-top {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    padding: 0.85rem 1.5rem;
    font-family: "JetBrains Mono", monospace;
    font-size: 1rem;
    color: #8a8a9a;
    cursor: pointer;
    transition: all 0.2s;
  }
  .tab-btn-top:hover { color: #c0c0d0; }
  .tab-btn-top.active { color: #f5e663; border-bottom-color: #f5e663; }

  /* ═══ CODE VIEW (architectural reference) ══════════════ */
  .code-view { padding: 0.25rem 0 0; }
  .code-inner {
    max-width: 940px;
    margin: 0 auto;
    padding: 0.5rem 0.25rem 2rem;
    font-family: "JetBrains Mono", monospace;
  }
  .code-view code {
    font-family: "JetBrains Mono", monospace;
    font-size: 0.86em;
    color: #f1fa8c;
    background: rgba(241, 250, 140, 0.07);
    border: 1px solid rgba(241, 250, 140, 0.12);
    border-radius: 3px;
    padding: 0.05em 0.35em;
    word-break: break-word;
  }
  .code-view strong { color: #e8e8f0; font-weight: 700; }
  .code-view em { color: #bd93f9; font-style: normal; }

  .cv-hero { animation: cvRise 0.5s ease both; }
  .cv-eyebrow {
    display: inline-block;
    color: #bd93f9;
    font-size: 0.74rem;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    margin-bottom: 0.6rem;
  }
  .cv-hero h2 {
    margin: 0;
    font-size: clamp(1.7rem, 4vw, 2.5rem);
    line-height: 1.05;
    color: #f5f5fa;
    font-weight: 700;
  }
  .cv-hero p {
    max-width: 64ch;
    margin: 1rem 0 0;
    color: #b6b6c6;
    font-size: 0.98rem;
    line-height: 1.75;
  }
  .cv-mental-model {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-top: 1.4rem;
    padding: 0.7rem 1rem;
    border: 1px solid #1f1f33;
    border-radius: 8px;
    background: rgba(18, 18, 26, 0.7);
    color: #cfcfe0;
    font-size: 0.92rem;
  }
  .cv-mental-model :global(svg) { color: #8be9fd; flex-shrink: 0; }
  .cv-mm-sep { color: #50fa7b; font-size: 1.05rem; margin: 0 0.15rem; }

  .cv-section { margin-top: 1.8rem; }
  .cv-h3 {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin: 0 0 0.5rem;
    font-size: 1.25rem;
    color: #f5f5fa;
    font-weight: 700;
  }
  summary.cv-h3 {
    cursor: pointer;
    list-style: none;
    user-select: none;
    padding: 0.2rem 0;
  }
  summary.cv-h3::-webkit-details-marker { display: none; }
  .cv-chev {
    margin-left: auto;
    color: #6f6f86;
    font-size: 0.85rem;
    transition: transform 0.2s ease, color 0.2s ease;
  }
  summary.cv-h3:hover .cv-chev { color: #bd93f9; }
  details[open] > summary .cv-chev { transform: rotate(90deg); }
  details.cv-section:not([open]) > summary.cv-h3 { margin-bottom: 0; }
  .cv-num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.7rem;
    height: 1.7rem;
    border-radius: 6px;
    background: rgba(189, 147, 249, 0.14);
    border: 1px solid rgba(189, 147, 249, 0.4);
    color: #bd93f9;
    font-size: 0.9rem;
    font-weight: 800;
  }
  .cv-lead {
    max-width: 64ch;
    margin: 0 0 1.4rem;
    color: #9a9aaa;
    font-size: 0.94rem;
    line-height: 1.7;
  }

  /* Vertical flow */
  .flow { list-style: none; margin: 0; padding: 0.4rem 0 0; }
  .flow-step {
    position: relative;
    display: grid;
    grid-template-columns: 44px 1fr;
    gap: 1.1rem;
    padding-bottom: 1.5rem;
    opacity: 0;
    animation: cvRise 0.55s ease forwards;
    animation-delay: var(--d, 0ms);
  }
  .flow-step:last-child { padding-bottom: 0; }
  .flow-step::before {
    content: "";
    position: absolute;
    left: 21px;
    top: 48px;
    bottom: -2px;
    width: 2px;
    background: linear-gradient(180deg, #bd93f9, #50fa7b, #bd93f9);
    background-size: 100% 140px;
    opacity: 0.45;
    animation: cvFlow 2.4s linear infinite;
  }
  .flow-step:last-child::before { display: none; }
  .flow-rail {
    position: relative;
    z-index: 1;
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: #12121a;
    border: 1px solid rgba(189, 147, 249, 0.45);
    color: #bd93f9;
    box-shadow: 0 0 0 4px #0a0a0f;
  }
  .flow-body {
    border: 1px solid #1c1c30;
    border-radius: 8px;
    background: rgba(18, 18, 26, 0.6);
    padding: 0.85rem 1.05rem;
    transition: border-color 0.2s, transform 0.2s;
  }
  .flow-body:hover { border-color: #2e2e4e; transform: translateX(2px); }
  .flow-top {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem 0.7rem;
    margin-bottom: 0.35rem;
  }
  .flow-title { color: #e8e8f0; font-weight: 700; font-size: 1rem; }
  .flow-where {
    color: #6f6f86;
    font-size: 0.76rem;
    letter-spacing: 0.03em;
    margin-left: auto;
  }
  .flow-badge {
    font-size: 0.68rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #f5e663;
    border: 1px solid rgba(245, 230, 99, 0.5);
    border-radius: 999px;
    padding: 0.1rem 0.5rem;
  }
  .flow-body p {
    margin: 0;
    color: #aeaebe;
    font-size: 0.9rem;
    line-height: 1.65;
  }

  /* Skill-file anatomy */
  .skillfile { display: grid; gap: 0.6rem; }
  .sf-zone {
    border: 1px solid #1c1c30;
    border-radius: 10px;
    background: rgba(18, 18, 26, 0.6);
    padding: 0.7rem 0.9rem 0.85rem;
  }
  .sf-front { border-left: 3px solid #8be9fd; }
  .sf-body { border-left: 3px solid #50fa7b; }
  .sf-tag {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 0.5rem;
  }
  .sf-front .sf-tag { color: #8be9fd; }
  .sf-body .sf-tag { color: #50fa7b; }
  .sf-zone pre {
    margin: 0;
    overflow-x: auto;
    font-size: 0.8rem;
    line-height: 1.6;
    color: #c8c8d6;
  }
  .sf-zone pre code {
    background: none;
    border: none;
    padding: 0;
    color: inherit;
    font-size: inherit;
  }
  .cv-note {
    margin: 1rem 0 0;
    color: #aeaebe;
    font-size: 0.9rem;
    line-height: 1.7;
  }

  /* Concept cards */
  .cv-cards { display: flex; flex-direction: column; gap: 1rem; }
  .cv-card {
    border: 1px solid #1c1c30;
    border-radius: 10px;
    background: rgba(18, 18, 26, 0.6);
    padding: 1.1rem 1.2rem 1.25rem;
    transition: border-color 0.2s, transform 0.2s;
  }
  .cv-card:hover { border-color: #33335a; transform: translateY(-2px); }
  .cv-card-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.6rem;
    color: #bd93f9;
  }
  .cv-card-head h4 {
    margin: 0;
    font-size: 1.02rem;
    color: #f0f0f6;
    font-weight: 700;
  }
  .cv-card p {
    margin: 0;
    color: #aeaebe;
    font-size: 0.9rem;
    line-height: 1.65;
  }

  .cv-tree {
    margin: 0;
    padding: 1rem 1.15rem;
    background: #0d0d14;
    border: 1px solid #1a1a2e;
    border-radius: 9px;
    overflow-x: auto;
    color: #5f6075;
    font-size: 0.82rem;
    line-height: 1.7;
  }
  .cv-tree code {
    background: none;
    border: none;
    padding: 0;
    color: inherit;
    font-size: inherit;
  }
  .cv-tree .tr-dir { color: #8be9fd; }
  .cv-tree .tr-file { color: #f1fa8c; }
  .cv-tree .tr-cm { color: #6f6f86; }

  .cv-callout {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
    margin-top: 1.8rem;
    padding: 1rem 1.15rem;
    border: 1px solid rgba(189, 147, 249, 0.28);
    border-left: 3px solid #bd93f9;
    border-radius: 8px;
    background: rgba(189, 147, 249, 0.06);
  }
  .cv-callout :global(svg) { color: #bd93f9; flex-shrink: 0; margin-top: 2px; }
  .cv-callout p {
    margin: 0;
    color: #c2c2d2;
    font-size: 0.92rem;
    line-height: 1.7;
  }

  /* ── Hypothesis card (Lab view) ── */
  .hyp-card {
    margin-bottom: 1rem;
    padding: 0.9rem 1rem;
    border: 1px solid rgba(189, 147, 249, 0.28);
    border-left: 3px solid #bd93f9;
    border-radius: 8px;
    background: rgba(189, 147, 249, 0.06);
  }
  .hyp-head {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    color: #bd93f9;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .hyp-head :global(svg) { flex-shrink: 0; }
  .hyp-text {
    margin: 0.55rem 0 0;
    color: #f0f0f5;
    font-size: 0.95rem;
    line-height: 1.6;
  }
  .hyp-text code,
  .hyp-note code {
    background: rgba(139, 233, 253, 0.1);
    border-radius: 4px;
    padding: 0.05rem 0.3rem;
    font-size: 0.86em;
    color: #8be9fd;
  }
  .hyp-scope {
    margin: 0.6rem 0;
    padding: 0.5rem 0.7rem;
    border: 1px solid rgba(98, 114, 164, 0.35);
    border-radius: 6px;
    background: rgba(13, 14, 22, 0.6);
    overflow-x: auto;
    font-size: 0.82rem;
  }
  .hyp-scope code { background: none; border: none; padding: 0; color: #c2c2d2; }
  .hyp-scope .c-key { color: #8be9fd; }
  .hyp-note {
    margin: 0;
    color: #c2c2d2;
    font-size: 0.86rem;
    line-height: 1.65;
  }

  /* ── Scoring tab ── */
  .sc-subtabs { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 1.6rem 0 1.4rem; }
  .sc-subtabs button {
    display: inline-flex; align-items: center; gap: 0.4rem;
    padding: 0.45rem 0.9rem;
    border: 1px solid rgba(189, 147, 249, 0.24);
    border-radius: 999px;
    background: rgba(28, 29, 39, 0.7);
    color: var(--brand-muted);
    font-family: var(--font-heading); font-size: 0.85rem; font-weight: 800;
    cursor: pointer; transition: border-color 0.2s, background 0.2s, color 0.2s;
  }
  .sc-subtabs button:hover { border-color: rgba(245, 230, 99, 0.4); color: #c0c0d0; }
  .sc-subtabs button.active { border-color: rgba(245, 230, 99, 0.7); background: rgba(245, 230, 99, 0.1); color: var(--brand-yellow); }
  .sc-subtabs button :global(svg) { color: #8be9fd; }

  .sc-gist { margin: 0 0 1.2rem; max-width: 80ch; color: #b6b6c6; font-size: 0.96rem; line-height: 1.65; }
  .sc-gist strong { color: #f5e663; font-family: "JetBrains Mono", monospace; font-weight: 700; }
  .sc-gist em { color: #bd93f9; font-style: normal; }

  .sc-dims { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.8rem; }
  .sc-dims.sc-two { grid-template-columns: repeat(2, 1fr); }
  .sc-card { border: 1px solid #1c1c30; border-radius: 10px; background: rgba(18, 18, 26, 0.6); padding: 0.95rem 1rem; }
  .sc-card-head { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.6rem; color: #bd93f9; }
  .sc-card-head :global(svg) { color: #8be9fd; flex-shrink: 0; }
  .sc-card-head h4 { margin: 0; font-size: 1rem; color: #f0f0f6; font-weight: 700; }
  .sc-sub { margin: 0 0 0.5rem; color: #9a9aaa; font-size: 0.84rem; line-height: 1.5; }
  .sc-sub em { color: #bd93f9; font-style: normal; }
  .sc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.28rem; }
  .sc-list li { display: flex; justify-content: space-between; align-items: baseline; gap: 0.6rem; font-size: 0.84rem; color: #c6c6d2; border-bottom: 1px solid #15151f; padding-bottom: 0.28rem; }
  .sc-list li:last-child { border-bottom: none; }
  .sc-list b { color: #f5e663; font-family: "JetBrains Mono", monospace; font-size: 0.82rem; }
  .sc-note { margin: 0.6rem 0 0; color: #6f6f86; font-size: 0.76rem; line-height: 1.45; }
  .sc-weight { display: inline-block; margin-top: 0.6rem; font-family: "JetBrains Mono", monospace; font-size: 0.74rem; color: #50fa7b; background: rgba(80, 250, 123, 0.1); border: 1px solid rgba(80, 250, 123, 0.3); border-radius: 999px; padding: 0.15rem 0.55rem; }

  .sc-combine { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin: 1.1rem 0 0; padding: 0.85rem 1rem; border: 1px solid rgba(80, 250, 123, 0.28); border-radius: 9px; background: rgba(80, 250, 123, 0.05); font-family: "JetBrains Mono", monospace; }
  .sc-combine :global(svg) { color: #50fa7b; }
  .sc-op { color: #ff79c6; font-size: 0.95rem; }
  .sc-chip { font-size: 0.8rem; color: #cfcfe0; background: #0d0d14; border: 1px solid #2a2a40; border-radius: 5px; padding: 0.22rem 0.55rem; }
  .sc-result { font-size: 0.84rem; font-weight: 700; color: #50fa7b; background: rgba(80, 250, 123, 0.1); border: 1px solid rgba(80, 250, 123, 0.4); border-radius: 5px; padding: 0.22rem 0.6rem; }
  .sc-foot { margin: 0.85rem 0 0; color: #8a8a9a; font-size: 0.82rem; line-height: 1.55; }

  /* Intel chain */
  .sc-chain { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; padding: 0.4rem 0 0.2rem; }
  .sc-chain :global(svg) { color: #50fa7b; flex-shrink: 0; }
  .sc-factor { display: flex; flex-direction: column; gap: 0.15rem; padding: 0.5rem 0.7rem; border: 1px solid #1c1c30; border-radius: 8px; background: rgba(18, 18, 26, 0.6); }
  .sc-factor b { color: #bd93f9; font-size: 0.86rem; }
  .sc-factor small { color: #8a8a9a; font-size: 0.72rem; }
  .sc-mul { color: #ff79c6; font-family: "JetBrains Mono", monospace; font-size: 1.05rem; }
  .sc-why { margin: 1rem 0 0; max-width: 80ch; color: #aeaebe; font-size: 0.86rem; line-height: 1.6; }
  .sc-corro { margin: 1.1rem 0 0; border: 1px solid #1c1c30; border-radius: 10px; background: rgba(18, 18, 26, 0.6); padding: 0.95rem 1rem; }
  .sc-corro p { margin: 0.5rem 0 0; color: #aeaebe; font-size: 0.86rem; line-height: 1.6; }
  .sc-corro em { color: #bd93f9; font-style: normal; }
  .sc-corro .cv-code { margin: 0.7rem 0; }
  .sc-example { color: #c6c6d2 !important; }
  .sc-example b { color: #50fa7b; }

  @media (max-width: 820px) {
    .sc-dims, .sc-dims.sc-two { grid-template-columns: 1fr; }
    .sc-chain { flex-direction: column; align-items: stretch; }
  }

  /* Targeting tab: code snippet */
  .cv-code {
    margin: 0;
    padding: 0.85rem 1rem;
    background: #0d0d14;
    border: 1px solid #1a1a2e;
    border-radius: 8px;
    overflow-x: auto;
    white-space: pre;
    color: #d6d6e2;
    font-size: 0.82rem;
    line-height: 1.6;
  }
  .cv-code code { background: none; border: none; padding: 0; color: inherit; font-size: inherit; }
  .cv-code .c-key { color: #8be9fd; }
  .cv-code .c-cm { color: #6272a4; }

  /* Targeting tab: selection funnel */
  .funnel-stages {
    display: flex;
    flex-wrap: wrap;
    align-items: stretch;
    gap: 0.5rem;
  }
  .funnel-stage {
    flex: 1;
    min-width: 200px;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    border: 1px solid #1c1c30;
    border-radius: 10px;
    background: rgba(18, 18, 26, 0.6);
    padding: 0.9rem 1rem;
  }
  .funnel-stage.win { border-color: rgba(80, 250, 123, 0.45); background: rgba(80, 250, 123, 0.06); }
  .fs-left { display: flex; align-items: center; gap: 0.45rem; color: #bd93f9; }
  .fs-tag { font-size: 0.78rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #cfcfe0; }
  .fs-detail { font-size: 0.82rem; color: #9a9aaa; line-height: 1.5; }
  .fs-num { margin-top: auto; font-size: 2rem; font-weight: 800; color: #f5e663; line-height: 1; }
  .fs-winner { font-size: 1.25rem; color: #50fa7b; }
  .fs-arrow { display: flex; align-items: center; color: #6f6f86; }

  /* Targeting tab: ranking formula */
  .formula {
    border: 1px solid #2a2a40;
    border-radius: 10px;
    background: #0d0d14;
    padding: 1.1rem 1rem;
    text-align: center;
  }
  .formula-eq { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 0.5rem; font-size: 1rem; }
  .f-term { border-radius: 6px; padding: 0.35rem 0.7rem; font-weight: 700; }
  .f-op { color: #8a8a9a; font-weight: 700; }
  .f-corr { color: #50fa7b; background: rgba(80, 250, 123, 0.1); border: 1px solid rgba(80, 250, 123, 0.4); }
  .f-score { color: #f5e663; background: rgba(245, 230, 99, 0.1); border: 1px solid rgba(245, 230, 99, 0.4); }
  .formula-legend { display: flex; flex-direction: column; gap: 0.55rem; margin-top: 0.9rem; }
  .fl-row { display: flex; align-items: baseline; gap: 0.55rem; font-size: 0.86rem; color: #aeaebe; line-height: 1.55; }
  .fl-row strong { color: #e8e8f0; }
  .fl-dot { flex-shrink: 0; width: 0.7rem; height: 0.7rem; border-radius: 3px; align-self: center; }
  .fl-dot.f-corr { background: #50fa7b; }
  .fl-dot.f-score { background: #f5e663; }

  /* Targeting tab: head-to-head */
  .versus { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.8rem; }
  .vs-card {
    border: 1px solid #1c1c30;
    border-radius: 10px;
    background: rgba(18, 18, 26, 0.6);
    padding: 0.9rem 1rem 1rem;
  }
  .vs-card.win { border-color: rgba(80, 250, 123, 0.5); box-shadow: 0 0 16px rgba(80, 250, 123, 0.1); }
  .vs-card.lose { opacity: 0.82; }
  .vs-top { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.6rem; }
  .vs-id { display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 800; color: #e8e8f0; }
  .vs-card.win .vs-id { color: #50fa7b; }
  .vs-card.win .vs-id :global(svg) { color: #50fa7b; }
  .vs-badge { font-size: 0.68rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; border-radius: 999px; padding: 0.12rem 0.55rem; }
  .vs-badge.win { color: #50fa7b; border: 1px solid rgba(80, 250, 123, 0.5); background: rgba(80, 250, 123, 0.08); }
  .vs-badge.lose { color: #ff79c6; border: 1px solid rgba(255, 121, 198, 0.45); background: rgba(255, 121, 198, 0.07); }
  .vs-math { display: flex; flex-direction: column; gap: 0.25rem; }
  .vs-line { display: flex; justify-content: space-between; gap: 1rem; font-size: 0.84rem; color: #9a9aaa; }
  .vs-line b { color: #c0c0ca; font-variant-numeric: tabular-nums; }
  .vs-line b.pos { color: #8be9fd; }
  .vs-total { display: flex; justify-content: space-between; gap: 1rem; margin-top: 0.35rem; padding-top: 0.4rem; border-top: 1px solid #2a2a40; font-size: 0.92rem; color: #cfcfe0; font-weight: 800; }
  .vs-total b { font-variant-numeric: tabular-nums; }
  .vs-total b.pos { color: #50fa7b; }
  .vs-total b.neg { color: #ff79c6; }
  .vs-note { margin: 0.65rem 0 0; font-size: 0.82rem; color: #9a9aaa; line-height: 1.55; }

  /* Targeting tab: converging evidence */
  .converge {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.7rem;
    border: 1px solid #1c1c30;
    border-radius: 10px;
    background: rgba(18, 18, 26, 0.6);
    padding: 1rem;
  }
  .converge > :global(svg) { color: #6f6f86; flex-shrink: 0; }
  .cvg-items { display: flex; flex-direction: column; gap: 0.4rem; flex: 1; min-width: 220px; }
  .cvg-item {
    font-size: 0.84rem;
    color: #aeaebe;
    background: #0d0d14;
    border: 1px solid #2a2a40;
    border-radius: 6px;
    padding: 0.4rem 0.6rem;
  }
  .cvg-target {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-weight: 800;
    color: #50fa7b;
    background: #0d0d14;
    border: 1px solid rgba(80, 250, 123, 0.5);
    border-radius: 8px;
    padding: 0.55rem 0.9rem;
  }
  .cvg-target :global(svg) { color: #50fa7b; }

  /* Author tab: supported-value chip groups */
  .auth-group { margin-bottom: 0.95rem; }
  .auth-group:last-child { margin-bottom: 0; }
  .auth-group-label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.76rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #8be9fd;
    margin-bottom: 0.5rem;
  }
  .auth-group-label :global(svg) { color: #8be9fd; }
  .auth-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .auth-chip {
    font-family: "JetBrains Mono", monospace;
    font-size: 0.8rem;
    color: #f1fa8c;
    background: rgba(241, 250, 140, 0.07);
    border: 1px solid rgba(241, 250, 140, 0.18);
    border-radius: 5px;
    padding: 0.25rem 0.55rem;
  }

  @keyframes cvRise {
    from { opacity: 0; transform: translateY(14px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes cvFlow {
    from { background-position: 0 0; }
    to { background-position: 0 140px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .flow-step,
    .cv-hero { animation: none; opacity: 1; }
    .flow-step::before { animation: none; }
  }

  /* structure-first finding: model JSON -> gate -> rendered view */
  .finding-stage { display: grid; gap: .45rem; margin-top: .7rem; }
  .stage-label { font-family: var(--font-heading); font-size: .72rem; letter-spacing: .02em; color: var(--dracula-comment); }
  .stage-label code { color: var(--dracula-cyan); }
  .finding-json {
    margin: 0; padding: .75rem .85rem; border-radius: 8px;
    background: rgba(25, 26, 33, .82); border: 1px solid rgba(98, 114, 164, .42);
    color: var(--dracula-fg); font-size: .76rem; line-height: 1.5; overflow-x: auto; white-space: pre-wrap; overflow-wrap: anywhere;
  }
  .gate-pass { margin: 0; font-size: .8rem; color: var(--dracula-green, #50fa7b); font-family: var(--font-heading); }
  .gate-fail { margin: 0; font-size: .8rem; color: var(--dracula-pink); font-family: var(--font-heading); }
  .gate-errors { margin: .3rem 0 0; padding-left: 1.1rem; display: grid; gap: .2rem; }
  .gate-errors li { font-size: .76rem; color: var(--dracula-muted); }

  .rendered-finding {
    display: grid; gap: 1.35rem; padding: 1.4rem 1.5rem; border-radius: 9px;
    background: rgba(80, 250, 123, 0.05); border: 1px solid rgba(80, 250, 123, .34);
  }
  .rf-row { display: flex; flex-wrap: wrap; align-items: center; gap: .85rem; }
  .rf-verdict { font-family: var(--font-heading); font-size: .82rem; padding: .3rem .75rem; border-radius: 6px; text-transform: uppercase; letter-spacing: .04em; border: 1px solid rgba(98, 114, 164, .5); }
  .rf-true_positive { color: var(--dracula-pink); border-color: rgba(255, 121, 198, .6); }
  .rf-false_positive { color: var(--dracula-green, #50fa7b); border-color: rgba(80, 250, 123, .6); }
  .rf-inconclusive { color: var(--dracula-comment); }
  .rendered-finding .rf-score { font-size: .92rem; color: var(--dracula-muted); text-transform: none; font-weight: 400; letter-spacing: 0; }
  .rf-score strong { color: var(--dracula-fg); font-weight: 700; }
  .rf-summary { margin: 0; font-size: 1.02rem; line-height: 1.65; color: var(--dracula-fg); }
  .rf-dimensions { width: 100%; border-collapse: collapse; font-size: .95rem; }
  .rf-dimensions th { display: table-cell; text-align: left; padding: .55rem .65rem; color: var(--dracula-comment); border-bottom: 1px solid rgba(98, 114, 164, .4); font-weight: 700; font-size: .76rem; text-transform: uppercase; letter-spacing: .05em; white-space: nowrap; }
  .rf-dimensions td { padding: .7rem .65rem; vertical-align: top; border-bottom: 1px solid rgba(98, 114, 164, .18); color: var(--dracula-fg); line-height: 1.6; }
  .rf-dimensions td:nth-child(2) { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .rf-dimensions code { color: var(--dracula-cyan); }
  .rf-field { margin: 0; font-size: 1.02rem; line-height: 1.65; color: var(--dracula-fg); }
  .rendered-finding .rf-key { display: block; font-family: var(--font-heading); font-size: .76rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--dracula-purple); margin: 0 0 .5rem; }
  .rf-fallbacks { margin: .6rem 0 0; padding-left: 1.3rem; display: grid; gap: .65rem; font-size: 1rem; line-height: 1.6; color: var(--dracula-muted); }
  .rf-fallbacks strong { color: var(--dracula-fg); }
</style>
