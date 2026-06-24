<script lang="ts">
  import RocketLaunchIcon from "phosphor-svelte/lib/RocketLaunchIcon";
  import ArrowsOutIcon from "phosphor-svelte/lib/ArrowsOutIcon";
  import GraphIcon from "phosphor-svelte/lib/GraphIcon";
  import ScrollIcon from "phosphor-svelte/lib/ScrollIcon";
  import FlagCheckeredIcon from "phosphor-svelte/lib/FlagCheckeredIcon";
  import PuzzlePieceIcon from "phosphor-svelte/lib/PuzzlePieceIcon";
  import StackIcon from "phosphor-svelte/lib/StackIcon";
  import CpuIcon from "phosphor-svelte/lib/CpuIcon";
  import ArrowRightIcon from "phosphor-svelte/lib/ArrowRightIcon";
  import MarkdownView from "$lib/components/MarkdownView.svelte";

  type Result = {
    findings: unknown[];
    assessments?: unknown[];
    narrative: string;
    report?: { fileName: string; path: string };
  };
  type Worker = { id: string; skill: string; candidateId: string; state: "running" | "done" | "error"; verdict?: string; score?: number };
  type AssessWorker = { id: string; skill: string; candidateId: string; state: "running" | "done" | "error"; assessmentType?: string; severity?: string | null };
  type StageKey = "det" | "assess" | "graph" | "narrative" | "report";
  type StageState = "idle" | "active" | "done";
  type StreamEvent =
    | { type: "progress"; stage: string; message: string; data?: Record<string, unknown> }
    | { type: "narrative-token"; value: string }
    | { type: "result"; result: Result }
    | { type: "error"; message: string }
    | { type: "done" };

  const STAGES: { key: StageKey; label: string; lab: string }[] = [
    { key: "det", label: "Detection", lab: "Lab 09" },
    { key: "assess", label: "Assessment", lab: "Lab 07" },
    { key: "graph", label: "Graph", lab: "Lab 10" },
    { key: "narrative", label: "Narrative", lab: "Lab 11" },
    { key: "report", label: "Report", lab: "artifact" },
  ];
  const IDLE: Record<StageKey, StageState> = { det: "idle", assess: "idle", graph: "idle", narrative: "idle", report: "idle" };

  let activeTab = $state<"instructions" | "lab" | "code">("instructions");
  let busy = $state(false);
  let started = $state(false);
  let runError = $state("");
  let stages = $state<Record<StageKey, StageState>>({ ...IDLE });
  let workers = $state<Worker[]>([]);
  let assessWorkers = $state<AssessWorker[]>([]);
  let narrativeText = $state("");
  let result = $state<Result | null>(null);

  function setStage(key: StageKey, s: StageState) { stages = { ...stages, [key]: s }; }

  function applyEvent(event: StreamEvent) {
    if (event.type === "progress") drive(event.stage, event.data);
    else if (event.type === "narrative-token") narrativeText += event.value;
    else if (event.type === "result") { result = event.result; setStage("report", "done"); }
    else if (event.type === "error") runError = event.message;
  }

  // Each progress event advances the 5-stage pipeline and fills the matching card.
  function drive(stage: string, data?: Record<string, unknown>) {
    switch (stage) {
      case "fan-out":
        setStage("det", "active");
        workers = ((data?.invocations as Array<{ id: string; skill: string; candidateId: string }>) ?? [])
          .map((i) => ({ id: i.id, skill: i.skill, candidateId: i.candidateId, state: "running" }));
        break;
      case "worker":
        workers = workers.map((w) => w.id === String(data?.id)
          ? { ...w, state: "done", verdict: String(data?.verdict ?? ""), score: Number(data?.score ?? 0) } : w);
        break;
      case "worker-error":
        workers = workers.map((w) => w.id === String(data?.id) ? { ...w, state: "error" } : w);
        break;
      case "fan-in": setStage("det", "done"); break;
      case "assess-fan-out":
        setStage("assess", "active");
        assessWorkers = ((data?.invocations as Array<{ id: string; skill: string; candidateId: string }>) ?? [])
          .map((i) => ({ id: i.id, skill: i.skill, candidateId: i.candidateId, state: "running" }));
        break;
      case "assess-worker":
        assessWorkers = assessWorkers.map((w) => w.id === String(data?.id)
          ? { ...w, state: "done", assessmentType: String(data?.assessmentType ?? ""), severity: (data?.severity as string | null) ?? null } : w);
        break;
      case "assess-worker-error":
        assessWorkers = assessWorkers.map((w) => w.id === String(data?.id) ? { ...w, state: "error" } : w);
        break;
      case "assess-fan-in": setStage("assess", "done"); break;
      case "graph":
        // The graph still runs (it grounds the narrative), but we don't re-draw it here —
        // Lab 10 built it and Lab 11 drew the campaign. In the capstone it is just a step.
        setStage("graph", "active");
        break;
      case "narrative": setStage("graph", "done"); setStage("narrative", "active"); break;
      case "report": setStage("narrative", "done"); setStage("report", "active"); break;
      case "done": setStage("report", "done"); break;
    }
  }

  async function run() {
    busy = true; started = true; runError = "";
    stages = { ...IDLE };
    workers = []; assessWorkers = []; narrativeText = ""; result = null;
    try {
      const response = await fetch("/lab/12/api/capstone", { method: "POST" });
      if (!response.ok || !response.body) throw new Error(`Capstone API returned HTTP ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl = buffer.indexOf("\n");
        while (nl !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) applyEvent(JSON.parse(line) as StreamEvent);
          nl = buffer.indexOf("\n");
        }
      }
      const tail = buffer.trim();
      if (tail) applyEvent(JSON.parse(tail) as StreamEvent);
    } catch (err) {
      runError = err instanceof Error ? err.message : "Capstone run failed";
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Lab 12 | Complete Hunt Capstone</title></svelte:head>

<main class="lab-shell">
  <a class="back" href="/">Labs</a>

  <header class="hero">
    <span>Lab 12</span>
    <h1>Complete Hunt Capstone</h1>
    <p>Run the integrated flow from fan-out detection through graph state and narrative.</p>
    {#if activeTab === "lab"}
      <button onclick={run} disabled={busy}>{busy ? "Running" : "Run Complete Hunt"}</button>
    {/if}
  </header>

  <div class="tab-bar-top">
    <button class="tab-btn-top" class:active={activeTab === "instructions"} onclick={() => (activeTab = "instructions")}>Instructions</button>
    <button class="tab-btn-top" class:active={activeTab === "lab"} onclick={() => (activeTab = "lab")}>Lab</button>
    <button class="tab-btn-top" class:active={activeTab === "code"} onclick={() => (activeTab = "code")}>Code</button>
  </div>

  {#if activeTab === "instructions"}
    <!-- ═══════════════════════════════════════════════════ -->
    <!-- INSTRUCTIONS VIEW  (the workshop walkthrough)        -->
    <!-- ═══════════════════════════════════════════════════ -->
    <div class="code-view">
      <div class="code-inner">
        <header class="cv-hero">
          <span class="cv-eyebrow">Lab 12 · Walkthrough</span>
          <h2>Run the whole hunt, start to finish</h2>
          <p>
            This is the capstone. One click runs the <strong>entire pipeline</strong> you built up
            across Labs 07 and 09–11 — fan-out detection, per-true-positive assessment, the shared
            graph, and the narrative. Nothing here is new; the goal is to watch every stage you
            learned in isolation execute <strong>in sequence</strong>, and recognise the primitives
            composing into one system.
          </p>
        </header>

        <ol class="flow">
          <!-- Step 1 -->
          <li class="flow-step" style="--d: 0ms">
            <span class="flow-rail"><RocketLaunchIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">1 · Run the complete hunt</span>
                <span class="flow-where">Lab tab · Run Complete Hunt</span>
              </div>
              <p>
                Switch to the <strong>Lab</strong> tab and press <strong>Run Complete Hunt</strong>.
                That single click fires one request that chains every stage of the pipeline on the
                server — no per-stage clicking like the earlier labs.
              </p>
            </div>
          </li>

          <!-- Step 2 -->
          <li class="flow-step" style="--d: 110ms">
            <span class="flow-rail"><StackIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">2 · Watch the stages stream</span>
                <span class="flow-where">pipeline stepper + stage cards</span>
              </div>
              <p>
                A five-step stepper — <strong>Detection → Assessment → Graph → Narrative →
                Report</strong> — lights up as each stage runs. The Detection and Assessment cards
                show one box per worker, flipping to <strong>TP</strong> / <strong>FP</strong> as the
                real model calls return — no per-stage clicking like the earlier labs.
              </p>
            </div>
          </li>

          <!-- Step 3 -->
          <li class="flow-step" style="--d: 220ms">
            <span class="flow-rail"><ScrollIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">3 · Read the narrative</span>
                <span class="flow-where">Narrative card</span>
              </div>
              <p>
                The <strong>Narrative</strong> card streams the campaign story the model wrote —
                grounded strictly in the graph's entities and edges (Lab 11). Like detection and
                assessment, narrative is driven by a <strong>loadable skill file</strong>
                (<code>skills/narrative/narrate-host-activity.md</code>), not a hardcoded prompt. The
                hunt then saves that narrative as a final <strong>Markdown report</strong> — the
                single human-readable artifact (see the <strong>Report</strong> card).
              </p>
            </div>
          </li>

          <!-- Step 4 -->
          <li class="flow-step" style="--d: 330ms">
            <span class="flow-rail"><PuzzlePieceIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">4 · Spot the labs, composed</span>
                <span class="flow-where">Code tab · optional</span>
              </div>
              <p>
                Every stage on screen traces back to a lab you already ran: detect (09) → assess (07)
                → connect (10) → narrate (11). The optional <strong>Code</strong> tab walks the exact
                ordering and which stages call the model.
              </p>
            </div>
          </li>
        </ol>

        <aside class="cv-callout">
          <FlagCheckeredIcon size={22} weight="duotone" />
          <p>
            <strong>The whole workshop, in one click.</strong> Each earlier lab isolated a single
            mechanism so it would be understandable. The capstone is the payoff: snap those
            mechanisms together in order and you have a real agentic hunting system — auditable,
            measurable, and built entirely from parts you now understand.
          </p>
        </aside>
      </div>
    </div>
  {:else if activeTab === "lab"}
  {#if runError}
    <section class="panel error"><h2>Run failed</h2><p>{runError}</p></section>
  {/if}

  {#if !started}
    <section class="panel">
      <h2>The capstone is the labs, composed</h2>
      <p class="lead">One run threads every stage you built: detection (Lab 09) → assessment (Lab 07) → the shared graph (Lab 10) → the grounded narrative (Lab 11) → a saved report. The model is called <strong>only where judgment is needed</strong> — everything between is deterministic glue. Press <strong>Run Complete Hunt</strong> above and watch each stage stream in.</p>
    </section>
  {:else}
    <!-- Pipeline stepper -->
    <ol class="stepper">
      {#each STAGES as s, i}
        <li class="step" class:active={stages[s.key] === "active"} class:done={stages[s.key] === "done"}>
          <span class="step-n">{i + 1}</span>
          <span class="step-label">{s.label}<small>{s.lab}</small></span>
        </li>
      {/each}
    </ol>

    <!-- 1 · Detection -->
    <section class="panel stage-card" class:active={stages.det === "active"} class:done={stages.det === "done"}>
      <div class="stage-head"><span class="stage-num">1</span><h2>Detection — fan-out / fan-in</h2><span class="stage-lab">Lab 09</span></div>
      <p class="stage-note">The detection library fans out across the candidates as concurrent <strong>real model calls</strong>, then the findings fan in. Exactly the Lab 09 pattern.</p>
      {#if workers.length}
        <div class="wave">
          {#each workers as w}
            <span class="chip" class:running={w.state === "running"} class:done={w.state === "done"} class:error={w.state === "error"} class:tp={w.verdict === "true_positive"} class:fp={w.verdict === "false_positive"} title="{w.skill} · {w.candidateId}">
              {w.candidateId}{#if w.state === "done"} · {w.verdict === "true_positive" ? "TP" : w.verdict === "false_positive" ? "FP" : "?"}{/if}
            </span>
          {/each}
        </div>
      {:else}
        <p class="stage-wait">dispatching workers…</p>
      {/if}
    </section>

    <!-- 2 · Assessment -->
    <section class="panel stage-card" class:active={stages.assess === "active"} class:done={stages.assess === "done"}>
      <div class="stage-head"><span class="stage-num">2</span><h2>Assessment — fan-out per true-positive</h2><span class="stage-lab">Lab 07</span></div>
      <p class="stage-note">Each <strong>true-positive</strong> finding fans out to the assessment skills (severity, behavioral-context) — more concurrent real calls. False-positives aren't assessed.</p>
      {#if assessWorkers.length}
        <div class="wave">
          {#each assessWorkers as a}
            <span class="chip" class:running={a.state === "running"} class:done={a.state === "done"} class:error={a.state === "error"} title="{a.skill} · {a.candidateId}">
              {a.candidateId} · {a.state === "done" ? (a.assessmentType === "severity" ? (a.severity ?? "sev") : "behavioral") : "…"}
            </span>
          {/each}
        </div>
      {:else if stages.assess !== "idle"}
        <p class="stage-wait">dispatching assessors…</p>
      {:else}
        <p class="stage-wait">waiting for detection…</p>
      {/if}
    </section>

    <!-- 3 · Graph -->
    <section class="panel stage-card" class:active={stages.graph === "active"} class:done={stages.graph === "done"}>
      <div class="stage-head"><span class="stage-num">3</span><h2>Graph — shared entity graph</h2><span class="stage-lab">Lab 10</span></div>
      <p class="stage-note">Findings project into a shared entity graph — <strong>deterministic, no model</strong>. Entities that recur (a host, a user) become the one node that links findings together.</p>
      {#if stages.graph !== "idle"}
        <p class="stage-ref">You built this graph in <strong>Lab 10</strong> and saw the campaign drawn in <strong>Lab 11</strong>. In the capstone it runs as one silent step in the chain — the narrative below is grounded in it, so there's no need to redraw it here.</p>
      {:else}
        <p class="stage-wait">waiting for assessment…</p>
      {/if}
    </section>

    <!-- 4 · Narrative -->
    <section class="panel stage-card" class:active={stages.narrative === "active"} class:done={stages.narrative === "done"}>
      <div class="stage-head"><span class="stage-num">4</span><h2>Narrative — one grounded call</h2><span class="stage-lab">Lab 11</span></div>
      <p class="stage-note">One <strong>real model call</strong> writes the campaign story, grounded strictly in the graph's entities (a loadable skill, not a hardcoded prompt). It streams in as it's written.</p>
      {#if narrativeText}
        <div class="narrative-body"><MarkdownView source={narrativeText} /></div>
      {:else if stages.narrative === "active"}
        <p class="stage-wait">synthesizing…</p>
      {:else}
        <p class="stage-wait">waiting for the graph…</p>
      {/if}
    </section>

    <!-- 5 · Report -->
    <section class="panel stage-card" class:active={stages.report === "active"} class:done={stages.report === "done"}>
      <div class="stage-head"><span class="stage-num">5</span><h2>Report — the saved artifact</h2><span class="stage-lab">artifact</span></div>
      <p class="stage-note">The narrative is written to disk as a Markdown report — the hunt's single human-readable output.</p>
      {#if result?.report}
        <p class="report-path">{result.report.path}</p>
        <p class="report-note">A fuller report (verdict table, timeline, recommended actions) and a notification hook (UI / Slack / webhook) are built in a later course; here the capstone saves the narrative.</p>
      {:else}
        <p class="stage-wait">waiting for the narrative…</p>
      {/if}
    </section>
  {/if}
  {:else}
    <!-- ═══════════════════════════════════════════════════ -->
    <!-- CODE VIEW  (architectural reference, non-interactive)-->
    <!-- ═══════════════════════════════════════════════════ -->
    <div class="code-view">
      <div class="code-inner">
        <header class="cv-hero">
          <span class="cv-eyebrow">Under the Hood</span>
          <h2>The whole pipeline, end to end</h2>
          <p>
            Optional reading for the curious. Every lab before this one isolated a single stage. The
            capstone runs them <strong>all in sequence</strong> on one click — detect, assess,
            connect, narrate. There's nothing new here: it's the earlier labs
            <strong>composed</strong>. That composition is the real shape of an agent system.
          </p>
          <div class="cv-mental-model">
            <RocketLaunchIcon size={20} weight="duotone" />
            <span>one run</span>
            <span class="cv-mm-sep">→</span>
            <StackIcon size={20} weight="duotone" />
            <span>every stage in order</span>
            <span class="cv-mm-sep">→</span>
            <FlagCheckeredIcon size={20} weight="duotone" />
            <span>grounded narrative</span>
          </div>
        </header>

        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">A</span> The full pipeline, stage by stage<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">
            One endpoint chains the stages — all of them produced inside
            <code>runInvestigationState()</code>, then streamed to the page as they run.
          </p>
          <ol class="flow">
            <li class="flow-step" style="--d: 0ms">
              <span class="flow-rail"><ArrowsOutIcon size={22} weight="duotone" /></span>
              <div class="flow-body">
                <div class="flow-top"><span class="flow-title">Fan-out detection</span><span class="flow-where">Lab 09 · orchestrator.ts</span></div>
                <p>Every detection skill runs against every gated candidate, concurrently, producing the structured findings.</p>
              </div>
            </li>
            <li class="flow-step" style="--d: 90ms">
              <span class="flow-rail"><StackIcon size={22} weight="duotone" /></span>
              <div class="flow-body">
                <div class="flow-top"><span class="flow-title">Assess the true-positive findings</span><span class="flow-where">assessment skill</span></div>
                <p>Each true-positive detection finding is enriched by an assessment skill — a per-finding model call that judges severity or behavioral context, emitted as a typed <code>AssessmentFinding</code> referencing the detection by <code>basedOn</code>.</p>
              </div>
            </li>
            <li class="flow-step" style="--d: 180ms">
              <span class="flow-rail"><GraphIcon size={22} weight="duotone" /></span>
              <div class="flow-body">
                <div class="flow-top"><span class="flow-title">Build the shared graph</span><span class="flow-where">Lab 10 · graph.ts</span></div>
                <p>Candidates and their entities become deduplicated nodes and edges — the shared state that links findings.</p>
              </div>
            </li>
            <li class="flow-step" style="--d: 270ms">
              <span class="flow-rail"><ScrollIcon size={22} weight="duotone" /></span>
              <div class="flow-body">
                <div class="flow-top"><span class="flow-title">Synthesize the narrative</span><span class="flow-where">Lab 11 · narrative.ts</span></div>
                <p>The model writes a campaign story, grounded strictly in the graph's entities and edges. Its system prompt is a <strong>loadable skill</strong> (<code>skills/narrative/narrate-host-activity.md</code>) — the same pattern as detection and assessment, not a hardcoded prompt. The narrative is then written to disk as a final Markdown report.</p>
              </div>
            </li>
          </ol>
        </details>

        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">B</span> The capstone is the labs, composed<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">Each stage is a thing you already built. The capstone just runs them in order:</p>
          <div class="cap-chain">
            <span class="cap-stage"><ArrowsOutIcon size={15} weight="duotone" />detect<small>Lab 09</small></span>
            <ArrowRightIcon size={14} weight="bold" />
            <span class="cap-stage"><CpuIcon size={15} weight="duotone" />assess<small>Lab 07</small></span>
            <ArrowRightIcon size={14} weight="bold" />
            <span class="cap-stage"><GraphIcon size={15} weight="duotone" />connect<small>Lab 10</small></span>
            <ArrowRightIcon size={14} weight="bold" />
            <span class="cap-stage"><ScrollIcon size={15} weight="duotone" />narrate<small>Lab 11</small></span>
          </div>
          <p class="cv-note">
            No stage knows it's part of a capstone — each is the same small, tested unit from its own
            lab. The power is entirely in the ordering.
          </p>
        </details>

        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">C</span> Four ideas worth understanding<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <div class="cv-cards">
            <article class="cv-card">
              <div class="cv-card-head"><PuzzlePieceIcon size={26} weight="duotone" /><h4>Composition over monoliths</h4></div>
              <p>The full hunt isn't one giant function — it's small, independently-built stages snapped together. Each stayed testable on its own, which is why the whole thing is trustworthy.</p>
            </article>
            <article class="cv-card">
              <div class="cv-card-head"><StackIcon size={26} weight="duotone" /><h4>One call wires the core</h4></div>
              <p><code>runInvestigationState()</code> chains detect → assess → connect → narrate in one call. The endpoint just streams those stages to the page as they run.</p>
            </article>
            <article class="cv-card">
              <div class="cv-card-head"><CpuIcon size={26} weight="duotone" /><h4>A deterministic shell around model steps</h4></div>
              <p>The model is called only where judgement is needed — detection, assessment, and narrative synthesis. Everything else — fan-out/fan-in and the graph — is deterministic code. The agent is a thin layer of judgement inside a sturdy machine.</p>
            </article>
            <article class="cv-card">
              <div class="cv-card-head"><FlagCheckeredIcon size={26} weight="duotone" /><h4>This is the real shape of an agent</h4></div>
              <p>Not one clever prompt, but a pipeline: gather, reason where it helps, structure, verify, and ship an artifact. That's what every earlier lab was building toward.</p>
            </article>
          </div>
        </details>

        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">D</span> Where each piece lives<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">The capstone endpoint is thin — it calls into the skill files and framework files from every prior lab.</p>
          <pre class="cv-tree"><code><span class="tr-dir">hunting-agent/</span>
│
├─ <span class="tr-dir">skills/narrative/</span>
│  └─ <span class="tr-file">narrate-host-activity.md</span>  <span class="tr-cm">← the narrative skill — the system prompt</span>
│
└─ <span class="tr-dir">src/</span>
   ├─ <span class="tr-dir">routes/lab/12/api/capstone/</span>
   │  └─ <span class="tr-file">+server.ts</span>          <span class="tr-cm">← chains the pipeline + writes the final .md report</span>
   └─ <span class="tr-dir">framework/</span>
      ├─ <span class="tr-file">orchestrator.ts</span>     <span class="tr-cm">← runInvestigationState: detect + assess + graph + narrative</span>
      └─ <span class="tr-file">narrative.ts</span>       <span class="tr-cm">← loadSkill(narrate-host-activity.md) → one graph-grounded call</span></code></pre>
        </details>

        <aside class="cv-callout">
          <PuzzlePieceIcon size={22} weight="duotone" />
          <p>
            <strong>The whole point of the workshop, in one screen.</strong> Each lab taught one
            mechanism in isolation so it would be understandable. The capstone shows the payoff: snap
            those mechanisms together in order and you have a real agentic hunting system — auditable,
            measurable, and built from parts you now understand.
          </p>
        </aside>
      </div>
    </div>
  {/if}
</main>

<style>
  :global(body) { background: #07070a; }
  .lab-shell { min-height: 100vh; padding: 2.5rem max(1rem, calc((100vw - 1120px) / 2)); background: linear-gradient(135deg, rgba(189,147,249,.06), transparent 34%), #07070a; color: rgba(255,255,255,.9); font-family: var(--font-heading); }
  .back { display: inline-flex; margin-bottom: 1rem; color: #f5e663; font-size: .75rem; font-weight: 800; text-decoration: none; text-transform: uppercase; }
  .hero, .panel { border: 1px solid rgba(189,147,249,.24); border-radius: 4px; background: rgba(22,22,31,.92); padding: 1.4rem; box-shadow: 0 24px 80px rgba(0,0,0,.32); }
  .panel { margin-top: 1rem; }
  .hero { display: grid; gap: .8rem; }
  .hero span { color: #bd93f9; text-transform: uppercase; font-weight: 800; }
  h1, h2, p { margin: 0; }
  h1 { color: #f5e663; font-size: clamp(2.5rem, 7vw, 5rem); line-height: .98; }
  h2 { color: #f5e663; margin-bottom: 1rem; }
  p { color: rgba(255,255,255,.62); line-height: 1.55; }
  button { width: fit-content; border: 1px solid rgba(245,230,99,.42); border-radius: 3px; padding: .7rem .95rem; background: rgba(245,230,99,.1); color: #f5e663; font: inherit; font-weight: 800; }
  .lead { color: rgba(255,255,255,.72); line-height: 1.65; max-width: 64rem; }

  /* ── Pipeline stepper ── */
  .stepper { list-style: none; display: flex; flex-wrap: wrap; gap: .5rem; margin: 0 0 1.2rem; padding: 0; }
  .step { display: flex; align-items: center; gap: .5rem; padding: .45rem .8rem; border-radius: 999px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.02); opacity: .5; transition: opacity .3s, border-color .3s; }
  .step.active, .step.done { opacity: 1; }
  .step.active { border-color: rgba(245,230,99,.55); }
  .step.done { border-color: rgba(80,250,123,.45); }
  .step-n { display: inline-flex; align-items: center; justify-content: center; width: 1.4rem; height: 1.4rem; border-radius: 50%; font-size: .72rem; font-weight: 800; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.2); color: rgba(255,255,255,.7); flex: none; }
  .step.active .step-n { background: rgba(245,230,99,.16); border-color: #f5e663; color: #f5e663; }
  .step.done .step-n { background: rgba(80,250,123,.16); border-color: #50fa7b; color: #50fa7b; }
  .step-label { display: flex; flex-direction: column; line-height: 1.1; font-size: .82rem; color: rgba(255,255,255,.85); }
  .step-label small { font-size: .64rem; color: rgba(255,255,255,.45); }

  /* ── Stage cards ── */
  .stage-card { border-left: 3px solid rgba(255,255,255,.14); opacity: .62; transition: opacity .3s, border-color .3s; }
  .stage-card.active, .stage-card.done { opacity: 1; }
  .stage-card.active { border-left-color: #f5e663; }
  .stage-card.done { border-left-color: #50fa7b; }
  .stage-head { display: flex; align-items: center; gap: .6rem; margin-bottom: .2rem; }
  .stage-head h2 { margin: 0; font-size: 1.05rem; }
  .stage-num { display: inline-flex; align-items: center; justify-content: center; width: 1.6rem; height: 1.6rem; border-radius: 50%; font-size: .8rem; font-weight: 800; background: rgba(189,147,249,.16); border: 1px solid rgba(189,147,249,.5); color: #bd93f9; flex: none; }
  .stage-lab { margin-left: auto; font-size: .7rem; font-family: var(--font-mono, ui-monospace, monospace); color: rgba(255,255,255,.45); border: 1px solid rgba(255,255,255,.16); border-radius: 5px; padding: .1rem .45rem; }
  .stage-note { color: rgba(255,255,255,.62); font-size: .9rem; line-height: 1.55; margin: 0 0 .85rem; }
  .stage-wait { color: rgba(255,255,255,.5); font-size: .85rem; font-family: var(--font-mono, ui-monospace, monospace); margin: 0; }

  /* ── Worker wave ── */
  .wave { display: flex; flex-wrap: wrap; gap: .4rem; }
  .chip { font-size: .72rem; font-family: var(--font-mono, ui-monospace, monospace); padding: .2rem .5rem; border-radius: 6px; border: 1px solid rgba(255,255,255,.15); color: rgba(255,255,255,.7); white-space: nowrap; transition: all .25s; }
  .chip.running { border-color: rgba(245,230,99,.45); color: #f5e663; }
  .chip.error { border-color: rgba(255,85,85,.5); color: #ff7b7b; }
  .chip.done.tp { border-color: rgba(255,121,198,.55); color: #ff79c6; }
  .chip.done.fp { border-color: rgba(80,250,123,.45); color: #50fa7b; }
  @media (prefers-reduced-motion: no-preference) { .chip.running { animation: cpulse 1.3s ease-in-out infinite; } }
  @keyframes cpulse { 0%,100% { opacity: 1; } 50% { opacity: .55; } }

  /* ── Graph reference (no re-draw; pointer back to Lab 10/11) ── */
  .stage-ref { color: rgba(255,255,255,.6); font-size: .86rem; line-height: 1.5; border-left: 2px solid rgba(139,233,253,.4); padding-left: .7rem; margin: 0; }

  /* ── Narrative + report ── */
  .narrative-body { border: 1px solid rgba(189,147,249,.3); border-radius: 8px; padding: 1rem 1.1rem; background: rgba(189,147,249,.05); }
  .report-path { font-family: var(--font-mono, ui-monospace, monospace); color: #8be9fd; font-size: .9rem; }
  .report-note { color: rgba(255,255,255,.5); font-size: .82rem; line-height: 1.5; margin-top: .5rem; }
  pre { white-space: pre-wrap; color: rgba(255,255,255,.76); }
  .panel.error { border-color: rgba(255,85,85,.5); }
  .panel.error p { color: #ff8b8b; }
  /* ═══ Top tab bar ══════════════════════════════════════ */
  .tab-bar-top { display: flex; gap: 0; border-bottom: 1px solid #1a1a2e; margin-bottom: 1rem; }
  .tab-btn-top {
    width: auto; background: none; border: none; border-bottom: 2px solid transparent;
    border-radius: 0; padding: 0.85rem 1.5rem; font-family: "JetBrains Mono", monospace;
    font-size: 1rem; font-weight: 600; color: #8a8a9a; cursor: pointer; transition: all 0.2s;
  }
  .tab-btn-top:hover { color: #c0c0d0; }
  .tab-btn-top.active { color: #f5e663; border-bottom-color: #f5e663; }

  /* ═══ CODE VIEW (architectural reference) ══════════════ */
  .code-view { padding: 0.25rem 0 0; }
  .code-inner { max-width: 940px; margin: 0 auto; padding: 0.5rem 0.25rem 2rem; font-family: "JetBrains Mono", monospace; }
  .code-view code {
    font-family: "JetBrains Mono", monospace; font-size: 0.86em; color: #f1fa8c;
    background: rgba(241, 250, 140, 0.07); border: 1px solid rgba(241, 250, 140, 0.12);
    border-radius: 3px; padding: 0.05em 0.35em; word-break: break-word;
  }
  .code-view strong { color: #e8e8f0; font-weight: 700; }

  .cv-hero { animation: cvRise 0.5s ease both; }
  .cv-eyebrow { display: inline-block; color: #bd93f9; font-size: 0.74rem; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; margin-bottom: 0.6rem; }
  .cv-hero h2 { margin: 0; font-size: clamp(1.7rem, 4vw, 2.5rem); line-height: 1.05; color: #f5f5fa; font-weight: 700; }
  .cv-hero p { max-width: 64ch; margin: 1rem 0 0; color: #b6b6c6; font-size: 0.98rem; line-height: 1.75; }
  .cv-mental-model { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-top: 1.4rem; padding: 0.7rem 1rem; border: 1px solid #1f1f33; border-radius: 8px; background: rgba(18, 18, 26, 0.7); color: #cfcfe0; font-size: 0.92rem; }
  .cv-mental-model :global(svg) { color: #8be9fd; flex-shrink: 0; }
  .cv-mm-sep { color: #50fa7b; font-size: 1.05rem; margin: 0 0.15rem; }

  .cv-section { margin-top: 1.8rem; }
  .cv-h3 { display: flex; align-items: center; gap: 0.6rem; margin: 0 0 0.5rem; font-size: 1.25rem; color: #f5f5fa; font-weight: 700; }
  summary.cv-h3 { cursor: pointer; list-style: none; user-select: none; padding: 0.2rem 0; }
  summary.cv-h3::-webkit-details-marker { display: none; }
  .cv-chev { margin-left: auto; color: #6f6f86; font-size: 0.85rem; transition: transform 0.2s ease, color 0.2s ease; }
  summary.cv-h3:hover .cv-chev { color: #bd93f9; }
  details[open] > summary .cv-chev { transform: rotate(90deg); }
  details.cv-section:not([open]) > summary.cv-h3 { margin-bottom: 0; }
  .cv-num { display: inline-flex; align-items: center; justify-content: center; width: 1.7rem; height: 1.7rem; border-radius: 6px; background: rgba(189, 147, 249, 0.14); border: 1px solid rgba(189, 147, 249, 0.4); color: #bd93f9; font-size: 0.9rem; font-weight: 800; }
  .cv-lead { max-width: 64ch; margin: 0 0 1.4rem; color: #9a9aaa; font-size: 0.94rem; line-height: 1.7; }

  .flow { list-style: none; margin: 0; padding: 0.4rem 0 0; }
  .flow-step { position: relative; display: grid; grid-template-columns: 44px 1fr; gap: 1.1rem; padding-bottom: 1.5rem; opacity: 0; animation: cvRise 0.55s ease forwards; animation-delay: var(--d, 0ms); }
  .flow-step:last-child { padding-bottom: 0; }
  .flow-step::before { content: ""; position: absolute; left: 21px; top: 48px; bottom: -2px; width: 2px; background: linear-gradient(180deg, #bd93f9, #50fa7b, #bd93f9); background-size: 100% 140px; opacity: 0.45; animation: cvFlow 2.4s linear infinite; }
  .flow-step:last-child::before { display: none; }
  .flow-rail { position: relative; z-index: 1; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: #12121a; border: 1px solid rgba(189, 147, 249, 0.45); color: #bd93f9; box-shadow: 0 0 0 4px #07070a; }
  .flow-body { border: 1px solid #1c1c30; border-radius: 8px; background: rgba(18, 18, 26, 0.6); padding: 0.85rem 1.05rem; transition: border-color 0.2s, transform 0.2s; }
  .flow-body:hover { border-color: #2e2e4e; transform: translateX(2px); }
  .flow-top { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.4rem 0.7rem; margin-bottom: 0.35rem; }
  .flow-title { color: #e8e8f0; font-weight: 700; font-size: 1rem; }
  .flow-where { color: #6f6f86; font-size: 0.76rem; letter-spacing: 0.03em; margin-left: auto; }
  .flow-body p { margin: 0; color: #aeaebe; font-size: 0.9rem; line-height: 1.65; }

  /* Capstone chain */
  .cap-chain { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; border: 1px solid #1c1c30; border-radius: 10px; background: rgba(18, 18, 26, 0.6); padding: 1.1rem 1.2rem; }
  .cap-chain > :global(svg) { color: #6f6f86; flex-shrink: 0; }
  .cap-stage { display: inline-flex; flex-direction: column; align-items: center; gap: 0.1rem; font-size: 0.82rem; color: #cfcfe0; background: #0d0d14; border: 1px solid #2a2a40; border-radius: 7px; padding: 0.5rem 0.7rem; min-width: 78px; text-align: center; }
  .cap-stage :global(svg) { color: #bd93f9; }
  .cap-stage small { color: #7d7d92; font-size: 0.66rem; }
  .cv-note { margin: 1rem 0 0; color: #aeaebe; font-size: 0.9rem; line-height: 1.7; }

  /* Concept cards (override the global article style) */
  .cv-cards { display: flex; flex-direction: column; gap: 1rem; }
  .cv-card { display: block; border: 1px solid #1c1c30; border-radius: 10px; background: rgba(18, 18, 26, 0.6); padding: 1.1rem 1.2rem 1.25rem; transition: border-color 0.2s, transform 0.2s; }
  .cv-card:hover { border-color: #33335a; transform: translateY(-2px); }
  .cv-card-head { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.6rem; color: #bd93f9; }
  .cv-card-head h4 { margin: 0; font-size: 1.02rem; color: #f0f0f6; font-weight: 700; }
  .cv-card p { margin: 0; color: #aeaebe; font-size: 0.9rem; line-height: 1.65; }

  .cv-tree { margin: 0; padding: 1rem 1.15rem; background: #0d0d14; border: 1px solid #1a1a2e; border-radius: 9px; overflow-x: auto; white-space: pre; color: #5f6075; font-size: 0.82rem; line-height: 1.7; }
  .cv-tree code { background: none; border: none; padding: 0; color: inherit; font-size: inherit; }
  .cv-tree .tr-dir { color: #8be9fd; }
  .cv-tree .tr-file { color: #f1fa8c; }
  .cv-tree .tr-cm { color: #6f6f86; }

  .cv-callout { display: flex; gap: 0.75rem; align-items: flex-start; margin-top: 1.8rem; padding: 1rem 1.15rem; border: 1px solid rgba(189, 147, 249, 0.28); border-left: 3px solid #bd93f9; border-radius: 8px; background: rgba(189, 147, 249, 0.06); }
  .cv-callout :global(svg) { color: #bd93f9; flex-shrink: 0; margin-top: 2px; }
  .cv-callout p { margin: 0; color: #c2c2d2; font-size: 0.92rem; line-height: 1.7; }

  @keyframes cvRise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes cvFlow { from { background-position: 0 0; } to { background-position: 0 140px; } }
  @media (prefers-reduced-motion: reduce) { .flow-step, .cv-hero { animation: none; opacity: 1; } .flow-step::before { animation: none; } }
</style>
