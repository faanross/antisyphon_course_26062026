<script lang="ts">
  import PipelineStepper from "$lib/components/lab02/PipelineStepper.svelte";
  import StepControls from "$lib/components/lab02/StepControls.svelte";
  import RawWallPanel from "$lib/components/lab02/RawWallPanel.svelte";
  import HousekeepingPanel from "$lib/components/lab02/HousekeepingPanel.svelte";
  import EventEnrichmentPanel from "$lib/components/lab02/EventEnrichmentPanel.svelte";
  import RarityPanel from "$lib/components/lab02/RarityPanel.svelte";
  import ProcessCorrelationPanel from "$lib/components/lab02/ProcessCorrelationPanel.svelte";
  import ScoringBreakdownPanel from "$lib/components/lab02/ScoringBreakdownPanel.svelte";
  import GraphsPanel from "$lib/components/lab02/GraphsPanel.svelte";
  import EnrichmentPanel from "$lib/components/lab02/EnrichmentPanel.svelte";
  import CandidateCardPanel from "$lib/components/lab02/CandidateCardPanel.svelte";

  import { connectionPairs } from "$lib/data/lab02/connection-pairs";
  import { PIPELINE_STEPS, FINAL_STEP, EVENT_COUNT, CANDIDATE_COUNT } from "$lib/data/lab02/steps";

  import StepsIcon from "phosphor-svelte/lib/StepsIcon";
  import FunnelIcon from "phosphor-svelte/lib/FunnelIcon";
  import CursorClickIcon from "phosphor-svelte/lib/CursorClickIcon";
  import InfoIcon from "phosphor-svelte/lib/InfoIcon";
  import FolderOpenIcon from "phosphor-svelte/lib/FolderOpenIcon";
  import TerminalWindowIcon from "phosphor-svelte/lib/TerminalWindowIcon";
  import ListMagnifyingGlassIcon from "phosphor-svelte/lib/ListMagnifyingGlassIcon";
  import FileCodeIcon from "phosphor-svelte/lib/FileCodeIcon";
  import DownloadSimpleIcon from "phosphor-svelte/lib/DownloadSimpleIcon";

  // This lab follows a single candidate end to end: the C2 beacon, BEA-001.
  const pair = connectionPairs["c2-beacon"];
  const heroLabel = "BEA-001";

  let activeTab = $state<"instructions" | "pipeline">("instructions");
  let currentStep = $state(0);
  // Step 2 sub-view (Correlation vs Event Enrichment) and Step 5 sub-view (Enrichment vs Candidate).
  let corrView = $state<"correlation" | "enrichment">("correlation");
  let finalView = $state<"main" | "candidate">("main");

  let candidateBorn = $derived(currentStep >= 3);
  let nf = new Intl.NumberFormat("en-US");

  function resetSub() {
    corrView = "correlation";
    finalView = "main";
  }
  function next() {
    if (currentStep < FINAL_STEP) currentStep += 1;
    resetSub();
  }
  function back() {
    if (currentStep > 0) currentStep -= 1;
    resetSub();
  }
  function replay() {
    currentStep = 0;
    resetSub();
  }
  function goTo(step: number) {
    currentStep = step;
    resetSub();
  }
  function onKey(event: KeyboardEvent) {
    if (event.key === "ArrowRight") next();
    else if (event.key === "ArrowLeft") back();
  }
</script>

<svelte:head><title>Lab 02 | Distillation Pipeline</title></svelte:head>
<svelte:window onkeydown={onKey} />

<main>
  <header>
    <span class="eyebrow">Lab 02</span>
    <h1>Distillation Pipeline Walkthrough</h1>
  </header>

  <div class="lab-tabs" role="tablist" aria-label="Lab 02 views">
    <button type="button" role="tab" class:active={activeTab === "instructions"} aria-selected={activeTab === "instructions"} onclick={() => (activeTab = "instructions")}>Instructions</button>
    <button type="button" role="tab" class:active={activeTab === "pipeline"} aria-selected={activeTab === "pipeline"} onclick={() => (activeTab = "pipeline")}>Pipeline</button>
  </div>

  {#if activeTab === "instructions"}
    <!-- ═══════════════════════════════════════════════════ -->
    <!-- INSTRUCTIONS VIEW  (the workshop walkthrough)        -->
    <!-- ═══════════════════════════════════════════════════ -->
    <div class="guide">
      <div class="guide-inner">
        <header class="cv-hero">
          <span class="cv-eyebrow">Lab 02 · Walkthrough</span>
          <h2>Watch raw telemetry become one candidate</h2>
          <p>
            Distillation is the deterministic, math-only stage that boils a flood of raw
            events down to a short list of scored candidates — <em>before</em> any model is
            involved. There are two ways to explore it here: first step through it visually
            in the app, then (if you want) run the real pipeline yourself on the command line.
          </p>
        </header>

        <!-- ── PART 1 ── -->
        <h3 class="cv-part"><span class="cv-num">1</span> Explore the pipeline, in the app</h3>
        <p class="cv-lead">
          Switch to the <strong>Pipeline</strong> tab. The whole lab follows a single
          candidate — <strong>BEA-001</strong>, the C2 beacon — from raw telemetry all the
          way to a scored, enriched candidate. Don't rush; the point is to <em>see</em> what
          each stage changes.
        </p>

        <ol class="flow">
          <li class="flow-step" style="--d: 0ms">
            <span class="flow-rail"><StepsIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">1 · Step through, 0 → 5</span>
                <span class="flow-where">Next / Back · or ← → keys</span>
              </div>
              <p>
                Start at <strong>Step 0</strong> (the raw telemetry wall) and walk forward
                one stage at a time: Housekeeping → Correlation → Scoring → Least-Frequency
                Analysis → Enrichment. Use the <strong>Next/Back</strong> buttons, the
                numbered stepper, or your <strong>arrow keys</strong>. Step back and forth to
                compare a stage with the one before it.
              </p>
            </div>
          </li>

          <li class="flow-step" style="--d: 110ms">
            <span class="flow-rail"><FunnelIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">2 · Watch the funnel shrink</span>
                <span class="flow-where">top-right counter</span>
              </div>
              <p>
                Keep an eye on the scale readout: thousands of <strong>events</strong> →
                a handful of <strong>candidates</strong> → the <strong>1</strong> candidate
                we follow (BEA-001). Notice the candidate only "appears" partway through —
                it isn't born until scoring.
              </p>
            </div>
          </li>

          <li class="flow-step" style="--d: 220ms">
            <span class="flow-rail"><CursorClickIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">3 · Toggle the sub-views</span>
                <span class="flow-where">Step 2 &amp; final step</span>
              </div>
              <p>
                Some stages have two sides. At <strong>Step 2</strong> switch between
                <em>Correlation</em> and <em>Event Enrichment</em>; at the
                <strong>final step</strong> switch between <em>Enrichment</em> and the
                finished <em>Candidate</em> card. Both views are worth a look.
              </p>
            </div>
          </li>

          <li class="flow-step" style="--d: 330ms">
            <span class="flow-rail"><InfoIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">4 · Click every (i) you see</span>
                <span class="flow-where">scoring &amp; enrichment cards</span>
              </div>
              <p>
                Where a card shows a small <strong>(i)</strong> info button, click it. Each
                one opens a short explainer for that field — what it measures and why it
                moves the score. This is where the real learning is; take your time.
              </p>
            </div>
          </li>
        </ol>

        <!-- ── PART 2 ── -->
        <h3 class="cv-part cv-part-2"><span class="cv-num">2</span> Run the real pipeline yourself <span class="cv-tag-opt">take-home</span></h3>
        <p class="cv-lead">
          The view you just stepped through is a guided animation. The actual code that does
          this lives in <code>mini-distillation/</code> — a small, standalone command-line
          tool you can run on real data. Everything below happens in a terminal, from the
          repo root.
        </p>

        <ol class="flow">
          <li class="flow-step" style="--d: 0ms">
            <span class="flow-rail"><FolderOpenIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">Where the input data is</span>
                <span class="flow-where">mini-distillation/examples/</span>
              </div>
              <p>
                A ready-made sample of <strong>normalized Sysmon + Zeek</strong> telemetry
                ships with the tool — deliberately a <em>different</em> dataset from the one
                in this lab, so you're not just re-running BEA-001:
              </p>
              <pre class="cv-code"><code>mini-distillation/examples/events.sample.json   <span class="c-cm"># 805 events (802 Zeek + 3 Sysmon)</span></code></pre>
            </div>
          </li>

          <li class="flow-step" style="--d: 110ms">
            <span class="flow-rail"><TerminalWindowIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">Install &amp; run</span>
                <span class="flow-where">first time: npm install</span>
              </div>
              <p>
                <code>mini-distillation</code> has its own dependencies (the workshop setup
                script doesn't install them), so run <code>npm install</code> once. Then run
                the distiller — <code>all</code> runs every detector, or pick one
                (<code>beacon</code> / <code>tls</code> / <code>powershell</code>):
              </p>
              <pre class="cv-code"><code><span class="c-cm"># from the repo root</span>
cd mini-distillation
npm install                 <span class="c-cm"># first time only</span>
npx tsx src/distill.ts score all examples/events.sample.json</code></pre>
            </div>
          </li>

          <li class="flow-step" style="--d: 220ms">
            <span class="flow-rail"><ListMagnifyingGlassIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">Where the output is &amp; how to read it</span>
                <span class="flow-where">candidates.ndjson</span>
              </div>
              <p>
                It prints a summary and writes the scored candidates to
                <code>candidates.ndjson</code> (one JSON object per line). It's dense on one
                line — use <code>jq</code> to pretty-print it. The first command collapses the
                long event-id list to a count; the second is a one-line score summary:
              </p>
              <pre class="cv-code"><code><span class="c-cm"># readable, with the 361-id array collapsed to a count</span>
jq '.evidence.event_count = (.evidence.constituent_event_ids | length)
    | del(.evidence.constituent_event_ids)' candidates.ndjson

<span class="c-cm"># just the scores, one tidy line per candidate</span>
jq -r '"\(.type)\t\(.candidate_id)\tscore=\(.beacon_score // .tls_anomaly_score // .powershell_invocation_anomaly_score)"' candidates.ndjson</code></pre>
            </div>
          </li>

          <li class="flow-step" style="--d: 330ms">
            <span class="flow-rail"><FileCodeIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">Want to run it on your own data?</span>
                <span class="flow-where">SCHEMA.md</span>
              </div>
              <p>
                The tool reads a <strong>normalized</strong> event stream, not raw
                <code>conn.log</code> / <code>ssl.log</code> or Sysmon EVTX. The exact input
                contract — plus a Zeek/Sysmon field-mapping cheatsheet for writing a small
                adapter — is in <code>mini-distillation/SCHEMA.md</code>.
              </p>
            </div>
          </li>
        </ol>

        <aside class="cv-callout">
          <DownloadSimpleIcon size={22} weight="duotone" />
          <p>
            <strong>Why both?</strong> The in-app view shows you <em>what</em> distillation
            does, stage by stage. The CLI shows you that it's real, deterministic code you
            can run, inspect, and point at your own telemetry — no model, no magic.
          </p>
        </aside>
      </div>
    </div>
  {:else}
  <PipelineStepper steps={PIPELINE_STEPS} {currentStep} onSelect={goTo} />

  <div class="barrow">
    <div class="tabslot">
      {#if currentStep === 2}
        <div class="viewtabs" role="tablist" aria-label="Stage 2 views">
          <button type="button" role="tab" class:active={corrView === "correlation"} aria-selected={corrView === "correlation"} onclick={() => (corrView = "correlation")}>Correlation</button>
          <button type="button" role="tab" class:active={corrView === "enrichment"} aria-selected={corrView === "enrichment"} onclick={() => (corrView = "enrichment")}>Event Enrichment</button>
        </div>
      {:else if currentStep === FINAL_STEP}
        <div class="viewtabs" role="tablist" aria-label="Final views">
          <button type="button" role="tab" class:active={finalView === "main"} aria-selected={finalView === "main"} onclick={() => (finalView = "main")}>Enrichment</button>
          <button type="button" role="tab" class:active={finalView === "candidate"} aria-selected={finalView === "candidate"} onclick={() => (finalView = "candidate")}>Candidate</button>
        </div>
      {/if}
    </div>

    <div class="funnel" aria-label="Distillation scale">
      <strong>{nf.format(EVENT_COUNT)}</strong><span>events</span>
      <span class="sep">→</span>
      <strong class:dim={!candidateBorn}>{candidateBorn ? CANDIDATE_COUNT : "—"}</strong><span>candidates</span>
      <span class="sep">→</span>
      <strong class="hero" class:dim={!candidateBorn}>1</strong><span>{heroLabel}</span>
    </div>
  </div>

  <section class="panel-area">
    {#if currentStep === 0}
      <RawWallPanel {pair} />
    {:else if currentStep === 1}
      <HousekeepingPanel {pair} />
    {:else if currentStep === 2}
      {#if corrView === "correlation"}
        <ProcessCorrelationPanel {pair} />
      {:else}
        <EventEnrichmentPanel {pair} />
      {/if}
    {:else if currentStep === 3}
      <div class="stack">
        <ScoringBreakdownPanel {pair} />
        <GraphsPanel {pair} />
      </div>
    {:else if currentStep === 4}
      <RarityPanel {pair} />
    {:else if finalView === "candidate"}
      <CandidateCardPanel {pair} />
    {:else}
      <EnrichmentPanel {pair} />
    {/if}
  </section>

  <StepControls
    {currentStep}
    onBack={back}
    onNext={next}
    onReplay={replay}
  />
  {/if}
</main>

<style>
  main {
    width: min(1320px, calc(100% - 2rem));
    margin: 0 auto;
    padding: 2rem 0 3rem;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  header {
    padding: 1.15rem;
    border: 1px solid rgba(189, 147, 249, 0.26);
    border-radius: 8px;
    background: rgba(22, 22, 31, 0.88);
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.32);
    backdrop-filter: blur(10px);
  }
  .eyebrow {
    display: block;
    margin-bottom: 0.45rem;
    color: var(--brand-purple-light);
    font-family: var(--font-heading);
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  h1 {
    margin: 0;
    font-size: 2.25rem;
    line-height: 1.05;
    color: var(--brand-yellow);
  }

  .barrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.75rem;
    min-height: 2.4rem;
  }
  .tabslot {
    min-height: 2.4rem;
  }

  .viewtabs {
    display: flex;
    gap: 0.5rem;
  }
  .viewtabs button {
    min-height: 2.4rem;
    padding: 0.45rem 1.3rem;
    border: 1px solid rgba(189, 147, 249, 0.24);
    border-radius: 7px;
    background: rgba(28, 29, 39, 0.82);
    color: var(--brand-muted);
    font-family: var(--font-heading);
    font-size: 0.9rem;
    font-weight: 800;
    cursor: pointer;
    transition: border-color 0.2s ease, background 0.2s ease, color 0.2s ease;
  }
  .viewtabs button:hover {
    border-color: rgba(245, 230, 99, 0.45);
  }
  .viewtabs button.active {
    border-color: rgba(245, 230, 99, 0.72);
    background: rgba(245, 230, 99, 0.1);
    color: var(--brand-yellow);
    box-shadow: inset 0 -2px 0 var(--brand-yellow);
  }

  .funnel {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    margin-left: auto;
    font-family: var(--font-heading);
    font-size: 0.82rem;
    color: var(--brand-muted);
  }
  .funnel strong {
    color: var(--brand-yellow);
    font-size: 1.15rem;
  }
  .funnel strong.hero {
    color: var(--dracula-green);
  }
  .funnel strong.dim {
    color: var(--brand-muted);
    opacity: 0.5;
  }
  .funnel .sep {
    margin: 0 0.3rem;
    color: var(--brand-purple);
  }

  .panel-area {
    min-width: 0;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  /* ═══ Top-level lab tabs ═══════════════════════════════ */
  .lab-tabs {
    display: flex;
    gap: 1.5rem;
    border-bottom: 1px solid rgba(189, 147, 249, 0.22);
    padding: 0 0.25rem;
  }
  .lab-tabs button {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    padding: 0.65rem 0.25rem;
    font-family: var(--font-heading);
    font-size: 1rem;
    font-weight: 800;
    color: var(--brand-muted);
    cursor: pointer;
    transition: color 0.2s ease, border-color 0.2s ease;
  }
  .lab-tabs button:hover { color: #c0c0d0; }
  .lab-tabs button.active {
    color: var(--brand-yellow);
    border-bottom-color: var(--brand-yellow);
  }

  /* ═══ Instructions view ════════════════════════════════ */
  .guide {
    background:
      radial-gradient(1200px 400px at 50% -120px, rgba(189, 147, 249, 0.08), transparent),
      #0a0a0f;
    border: 1px solid #1c1c30;
    border-radius: 10px;
  }
  .guide-inner {
    max-width: 880px;
    margin: 0 auto;
    padding: 2.2rem 1.75rem 3rem;
    font-family: "JetBrains Mono", monospace;
  }
  .guide code {
    font-family: "JetBrains Mono", monospace;
    font-size: 0.86em;
    color: #f1fa8c;
    background: rgba(241, 250, 140, 0.07);
    border: 1px solid rgba(241, 250, 140, 0.12);
    border-radius: 3px;
    padding: 0.05em 0.35em;
    word-break: break-word;
  }
  .guide strong { color: #e8e8f0; font-weight: 700; }
  .guide em { color: #bd93f9; font-style: normal; }

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
    font-size: clamp(1.7rem, 3.5vw, 2.4rem);
    line-height: 1.06;
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

  .cv-part {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin: 2.8rem 0 0.4rem;
    font-size: 1.3rem;
    color: #f5f5fa;
    font-weight: 700;
  }
  .cv-part-2 { margin-top: 3.4rem; padding-top: 2.4rem; border-top: 1px solid #1c1c30; }
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
    flex-shrink: 0;
  }
  .cv-tag-opt {
    font-size: 0.68rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #50fa7b;
    background: rgba(80, 250, 123, 0.1);
    border: 1px solid rgba(80, 250, 123, 0.32);
    border-radius: 999px;
    padding: 0.2rem 0.6rem;
  }
  .cv-lead {
    max-width: 64ch;
    margin: 0.5rem 0 1.4rem;
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
    justify-content: space-between;
    gap: 0.4rem 1rem;
    margin-bottom: 0.35rem;
  }
  .flow-title { color: #e8e8f0; font-weight: 700; font-size: 1rem; }
  .flow-where { color: #6f6f86; font-size: 0.76rem; letter-spacing: 0.03em; }
  .flow-body p { margin: 0; color: #aeaebe; font-size: 0.9rem; line-height: 1.65; }

  /* Code blocks */
  .cv-code {
    margin: 0.85rem 0 0;
    padding: 0.75rem 0.9rem;
    background: #0d0d14;
    border: 1px solid #1a1a2e;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 0.82rem;
    line-height: 1.6;
  }
  .cv-code code {
    background: none;
    border: none;
    padding: 0;
    color: #d6d6e2;
    font-size: 0.82rem;
    white-space: pre;
  }
  .cv-code .c-cm { color: #6272a4; }

  /* Callout */
  .cv-callout {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
    margin-top: 2.4rem;
    padding: 1rem 1.15rem;
    border: 1px solid rgba(189, 147, 249, 0.28);
    border-left: 3px solid #bd93f9;
    border-radius: 8px;
    background: rgba(189, 147, 249, 0.06);
  }
  .cv-callout :global(svg) { color: #bd93f9; flex-shrink: 0; margin-top: 2px; }
  .cv-callout p { margin: 0; color: #c2c2d2; font-size: 0.92rem; line-height: 1.7; }

  @keyframes cvRise {
    from { opacity: 0; transform: translateY(14px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes cvFlow {
    from { background-position: 0 0; }
    to { background-position: 0 140px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .flow-step, .cv-hero { animation: none; opacity: 1; }
    .flow-step::before { animation: none; }
  }
</style>
