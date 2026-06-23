<script lang="ts">
  import DatabaseIcon from "phosphor-svelte/lib/DatabaseIcon";
  import ListChecksIcon from "phosphor-svelte/lib/ListChecksIcon";
  import ArrowsOutIcon from "phosphor-svelte/lib/ArrowsOutIcon";
  import ArrowsInIcon from "phosphor-svelte/lib/ArrowsInIcon";
  import LightningIcon from "phosphor-svelte/lib/LightningIcon";
  import RobotIcon from "phosphor-svelte/lib/RobotIcon";
  import ShieldCheckIcon from "phosphor-svelte/lib/ShieldCheckIcon";
  import RepeatIcon from "phosphor-svelte/lib/RepeatIcon";
  import GitForkIcon from "phosphor-svelte/lib/GitForkIcon";
  import WarningIcon from "phosphor-svelte/lib/WarningIcon";
  import ArrowRightIcon from "phosphor-svelte/lib/ArrowRightIcon";
  import MarkdownView from "$lib/components/MarkdownView.svelte";

  type Finding = {
    id: string;
    candidateId: string;
    skillName: string;
    verdict: string;
    compositeScore: number;
    evidenceSummary: string;
    attackNarrative: string;
    uncertainty: string;
  };

  type ProgressEvent = { stage: string; message: string };

  let activeTab = $state<"instructions" | "lab" | "code">("instructions");
  let busy = $state(false);
  let errorMsg = $state("");
  let phase = $state<"idle" | "running" | "reducing" | "done" | "error">("idle");
  let trace = $state<ProgressEvent[]>([]);
  let findings = $state<Finding[]>([]);
  let triage = $state("");
  let started = $derived(phase !== "idle");

  // Distinct colour per orchestration stage so the trace teaches instead of being one grey wall.
  function stageColor(stage: string): string {
    if (stage.includes("error")) return "#ff5555";
    if (stage.includes("fan-out")) return "#bd93f9";
    if (stage.includes("worker")) return "#50fa7b";
    if (stage.includes("fan-in")) return "#f1fa8c";
    if (stage === "load") return "#6272a4";
    return "#8be9fd";
  }

  async function run() {
    busy = true;
    errorMsg = "";
    trace = [];
    findings = [];
    triage = "";
    phase = "running";
    try {
      const response = await fetch("/lab/09/api/orchestrate", { method: "POST" });
      if (!response.ok || !response.body) throw new Error(`Request failed (HTTP ${response.status}).`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "trace") trace = [...trace, ev.event];
          else if (ev.type === "findings") findings = ev.findings;
          else if (ev.type === "reduce-start") phase = "reducing";
          else if (ev.type === "reduce-token") triage += ev.value;
          else if (ev.type === "reduce-done") { triage = ev.triage || triage; phase = "done"; }
          else if (ev.type === "error") errorMsg = ev.message;
        }
      }
    } catch (error) {
      errorMsg = error instanceof Error ? error.message : "Could not reach the orchestrator.";
    } finally {
      busy = false;
      if (errorMsg) phase = "error";
      else if (phase === "running" || phase === "reducing") phase = "done";
    }
  }
</script>

<svelte:head><title>Lab 09 | Fan-Out / Fan-In</title></svelte:head>

<main class="lab-shell">
  <a class="back" href="/">Labs</a>

  <header class="hero">
    <span>Lab 09</span>
    <h1>Fan-Out / Fan-In Orchestration</h1>
    <p>Run independent detection jobs, collect structured findings, and inspect the orchestration trace before adding shared graph state.</p>
    {#if activeTab === "lab"}
      <button onclick={run} disabled={busy}>{busy ? "Running" : "Run Orchestration"}</button>
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
          <span class="cv-eyebrow">Lab 09 · Walkthrough</span>
          <h2>Fan one task out to many workers, then fan the results back in</h2>
          <p>
            Every lab so far ran <em>one</em> detection at a time. Here one run <strong>fans out</strong>
            into many independent detection jobs at once (the <strong>map</strong>), collects their
            findings, then <strong>reduces</strong> the whole batch into one synthesized triage. Hit Run
            and watch each stage <strong>stream</strong> live.
          </p>
        </header>

        <ol class="flow">
          <!-- Step 1 -->
          <li class="flow-step" style="--d: 0ms">
            <span class="flow-rail"><LightningIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">1 · Kick off the run</span>
                <span class="flow-where">Lab tab · Run Orchestration</span>
              </div>
              <p>
                Go to the <strong>Lab</strong> tab and press <strong>Run Orchestration</strong>. One
                click loads the full candidate set and plans a job for every <em>(skill × candidate)</em>
                pair that passes its invocation gate — a flat batch of independent detections.
              </p>
            </div>
          </li>

          <!-- Step 2 -->
          <li class="flow-step" style="--d: 110ms">
            <span class="flow-rail"><ArrowsOutIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">2 · Watch it fan OUT</span>
                <span class="flow-where">Orchestration Trace</span>
              </div>
              <p>
                The orchestrator dispatches every job <strong>concurrently</strong> — each worker is a
                real detection model call (the same unit from Lab 06). Follow the
                <strong>Orchestration Trace</strong> panel: each stage event marks a job firing in the
                parallel wave rather than one-after-another.
              </p>
            </div>
          </li>

          <!-- Step 3 -->
          <li class="flow-step" style="--d: 220ms">
            <span class="flow-rail"><RobotIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">3 · Each worker produces a finding</span>
                <span class="flow-where">independent workers</span>
              </div>
              <p>
                Every worker reasons over its own evidence and returns one structured
                <code>DetectionFinding</code>. Jobs share no state, so one failing or returning
                unparseable output is logged and <strong>dropped</strong> — never faked — without
                sinking the rest of the batch.
              </p>
            </div>
          </li>

          <!-- Step 4 -->
          <li class="flow-step" style="--d: 330ms">
            <span class="flow-rail"><ArrowsInIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">4 · Fan in — collect</span>
                <span class="flow-where">Map · Fan-In Findings</span>
              </div>
              <p>
                The fulfilled workers converge into the <strong>Map · Fan-In Findings</strong> panel —
                one card per finding (candidate, skill, verdict, score). This is the <em>collection</em>
                step: independent results gathered into one list. No worker has seen the others yet.
              </p>
            </div>
          </li>

          <!-- Step 5 · Reduce -->
          <li class="flow-step" style="--d: 440ms">
            <span class="flow-rail"><ListChecksIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">5 · Reduce — synthesize the batch</span>
                <span class="flow-where">Reduce · Batch Synthesis</span>
              </div>
              <p>
                Now the <strong>reduce</strong>: one model call reads <em>all</em> the collected findings
                at once and writes a prioritized triage — the overall picture, what to look at first, and
                which findings are the same incident. That cross-finding view is something no single
                worker could produce. <strong>This</strong> is the synthesis.
              </p>
            </div>
          </li>

          <!-- Step 6 -->
          <li class="flow-step" style="--d: 550ms">
            <span class="flow-rail"><GitForkIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">6 · See the shape behind it</span>
                <span class="flow-where">Code tab</span>
              </div>
              <p>
                When you're ready, open the <strong>Code</strong> tab. It walks the plan → fan-out
                (<code>Promise.allSettled</code>) → fan-in → reduce journey and shows where the
                orchestrator and the reused worker live.
              </p>
            </div>
          </li>
        </ol>

        <aside class="cv-callout">
          <GitForkIcon size={22} weight="duotone" />
          <p>
            <strong>Your whole detection library, run at once.</strong> The plan no longer fans out a
            single skill — it fans out <em>every</em> detection skill across the candidate set. Three
            skills now cover three candidate types: <code>hunt-c2-over-https</code> (HTTPS beacons),
            <code>hunt-ai-tool-execution-anomaly</code> (a coding / AI assistant spawning a rare child),
            and <code>hunt-malicious-powershell-payload</code> (encoded PowerShell). So the findings
            come back as a <em>mix of types</em> that line up into one kill chain — AI&nbsp;tool →
            encoded&nbsp;PowerShell → C2&nbsp;beacon — not three copies of the same finding.
          </p>
        </aside>

        <aside class="cv-callout">
          <ArrowsOutIcon size={22} weight="duotone" />
          <p>
            <strong>Why fan-out / fan-in:</strong> a single agent call answers one question, but real
            investigations ask hundreds in parallel. Keep the worker small and proven, run a whole
            batch of them at once, and fan the results back into one collection — scale comes from
            composition, not new magic.
          </p>
        </aside>

        <aside class="cv-callout">
          <ArrowsInIcon size={22} weight="duotone" />
          <p>
            <strong>This is map-reduce — and where it goes next.</strong> The reduce here is a
            <em>transient</em> batch synthesis: read N findings, emit one triage, with no shared state
            between them. <strong>Lab 10</strong> makes that synthesis <em>durable and connected</em> —
            findings that touch the same host, user, or domain become linked nodes in a knowledge graph —
            and <strong>Lab 11</strong> turns that graph into a campaign narrative.
          </p>
        </aside>
      </div>
    </div>
  {:else if activeTab === "lab"}
  {#if errorMsg}
    <p class="orch-error">{errorMsg}</p>
  {/if}
  {#if started}
    <!-- Live MAP trace -->
    <section class="panel">
      <div class="panel-head">
        <h2>Orchestration Trace</h2>
        <span>{trace.length} events</span>
      </div>
      <ol class="trace">
        {#each trace as event}
          <li class="trace-row" style="border-left: 3px solid {stageColor(event.stage)}">
            <strong style="color: {stageColor(event.stage)}">{event.stage}</strong>
            <p>{event.message}</p>
          </li>
        {/each}
        {#if phase === "running"}
          <li class="trace-row trace-pending"><strong>…</strong><p>workers running</p></li>
        {/if}
      </ol>
    </section>

    <!-- MAP output: collected findings -->
    <section class="panel">
      <div class="panel-head">
        <h2>Map · Fan-In Findings</h2>
        <span>{findings.length} findings</span>
      </div>
      <p class="panel-note">Each worker independently produced one finding — collected here as a flat list. No worker sees the others.</p>
      <div class="findings">
        {#each findings as finding}
          <article>
            <div>
              <strong>{finding.candidateId}</strong>
              <span>{finding.skillName}</span>
            </div>
            <p>{finding.evidenceSummary}</p>
            <small>{finding.verdict} | score {finding.compositeScore.toFixed(2)}</small>
          </article>
        {:else}
          <p class="empty">Workers running…</p>
        {/each}
      </div>
    </section>

    <!-- REDUCE: synthesized batch triage -->
    <section class="panel">
      <div class="panel-head">
        <h2>Reduce · Batch Synthesis</h2>
        <span>{phase === "reducing" ? "synthesizing…" : triage ? "1 triage" : "waiting"}</span>
      </div>
      <p class="panel-note">The fan-in <strong>reduce</strong>: one model call reads all {findings.length} findings at once and synthesizes a prioritized triage — the cross-finding view no single worker had.</p>
      {#if triage}
        <div class="reduce-body"><MarkdownView source={triage} /></div>
      {:else if phase === "reducing"}
        <p class="empty">Synthesizing the batch…</p>
      {:else}
        <p class="empty">Waiting for the workers to finish…</p>
      {/if}
    </section>
  {:else}
    <section class="panel">
      <h2>Press Run Orchestration</h2>
      <p>This lab runs the full <strong>map-reduce</strong>: fan the detection library out across the candidates (<strong>map</strong>), collect the findings, then <strong>reduce</strong> them into one synthesized triage. Hit <strong>Run Orchestration</strong> above to watch it stream.</p>
    </section>
  {/if}
  {:else}
    <!-- ═══════════════════════════════════════════════════ -->
    <!-- CODE VIEW  (architectural reference, non-interactive)-->
    <!-- ═══════════════════════════════════════════════════ -->
    <div class="code-view">
      <div class="code-inner">
        <!-- Intro -->
        <header class="cv-hero">
          <span class="cv-eyebrow">Under the Hood</span>
          <h2>How the agent runs many jobs at once</h2>
          <p>
            Optional reading for the curious. Every lab so far ran <em>one</em> skill at a time.
            Real hunting needs many detections run across many candidates. This lab introduces
            <strong>fan-out / fan-in</strong>: dispatch all the independent jobs concurrently, then
            gather their structured findings. Each job is a real detection model call — the same
            unit from Lab 06, just run at scale.
          </p>
          <div class="cv-mental-model">
            <ListChecksIcon size={20} weight="duotone" />
            <span>many detection jobs</span>
            <span class="cv-mm-sep">→</span>
            <LightningIcon size={20} weight="duotone" />
            <span>run in parallel</span>
            <span class="cv-mm-sep">→</span>
            <ArrowsInIcon size={20} weight="duotone" />
            <span>collect findings</span>
          </div>
        </header>

        <!-- A · Journey -->
        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">A</span> The journey of one batch<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">
            One "Run" turns the whole candidate set into a batch of independent detection jobs,
            runs them together, and collects what comes back.
          </p>

          <ol class="flow">
            <li class="flow-step" style="--d: 0ms">
              <span class="flow-rail"><DatabaseIcon size={22} weight="duotone" /></span>
              <div class="flow-body">
                <div class="flow-top"><span class="flow-title">Load the candidates</span><span class="flow-where">server · orchestrator.ts</span></div>
                <p>The full set of scored candidates is loaded — the pool every detection skill will be tested against.</p>
              </div>
            </li>
            <li class="flow-step" style="--d: 90ms">
              <span class="flow-rail"><ListChecksIcon size={22} weight="duotone" /></span>
              <div class="flow-body">
                <div class="flow-top"><span class="flow-title">Plan the jobs</span><span class="flow-where">server · skill-execution.ts</span></div>
                <p><code>planDetectionInvocations()</code> pairs each detection skill with every candidate that passes its invocation gate. The result is a flat list of independent <em>(skill × candidate)</em> jobs.</p>
              </div>
            </li>
            <li class="flow-step" style="--d: 180ms">
              <span class="flow-rail"><ArrowsOutIcon size={22} weight="duotone" /></span>
              <div class="flow-body">
                <div class="flow-top"><span class="flow-title">Fan out — dispatch concurrently</span><span class="flow-badge">the key step</span><span class="flow-where">server · orchestrator.ts</span></div>
                <p><code>Promise.allSettled()</code> launches every job at once. Because the jobs don't depend on each other, they run in parallel instead of one-after-another.</p>
              </div>
            </li>
            <li class="flow-step" style="--d: 270ms">
              <span class="flow-rail"><RobotIcon size={22} weight="duotone" /></span>
              <div class="flow-body">
                <div class="flow-top"><span class="flow-title">Each worker runs a detection</span><span class="flow-where">server · providers/*</span></div>
                <p>Every job is a real detection-skill execution — exactly what you saw in Lab 06 — producing one structured <code>DetectionFinding</code>. Each emits its own progress event.</p>
              </div>
            </li>
            <li class="flow-step" style="--d: 360ms">
              <span class="flow-rail"><ArrowsInIcon size={22} weight="duotone" /></span>
              <div class="flow-body">
                <div class="flow-top"><span class="flow-title">Fan in — collect the findings</span><span class="flow-where">server · orchestrator.ts</span></div>
                <p>Fulfilled jobs contribute their finding; failed or unparseable ones are reported and <strong>dropped</strong>, never faked. The trace plus the collected findings stream back to the UI.</p>
              </div>
            </li>
          </ol>
        </details>

        <!-- B · The shape -->
        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">B</span> The fan-out / fan-in shape<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">
            One planner explodes into many concurrent workers, which converge back into one list.
            This is the basic shape of parallel agent work.
          </p>

          <div class="fan">
            <div class="fan-node fan-plan"><GitForkIcon size={20} weight="duotone" /><strong>Plan</strong><small>N jobs</small></div>
            <ArrowRightIcon class="fan-arrow" size={16} weight="bold" />
            <div class="fan-mid">
              <span class="fan-tag">run concurrently</span>
              <span class="fan-worker">skill × candidate → finding</span>
              <span class="fan-worker">skill × candidate → finding</span>
              <span class="fan-worker fan-drop"><WarningIcon size={13} weight="bold" /> unparseable → dropped</span>
            </div>
            <ArrowRightIcon class="fan-arrow" size={16} weight="bold" />
            <div class="fan-node fan-in"><ArrowsInIcon size={20} weight="duotone" /><strong>Fan-in</strong><small>findings[]</small></div>
          </div>
          <p class="cv-note">
            <code>Promise.allSettled</code> (not <code>Promise.all</code>) is deliberate: it waits for
            every job and never short-circuits, so one worker's failure can't sink the whole batch.
          </p>
          <p class="cv-note">
            <strong>Fan-out is the map; fan-in is the reduce.</strong> The workers collect into a list
            (<code>findings[]</code>), then one <strong>reduce</strong> call synthesizes the whole batch
            into a triage — the cross-finding view no single worker had. That reduce is transient and
            stateless; <strong>Lab 10</strong> makes the synthesis <strong>durable and connected</strong>
            (findings sharing a host / user / domain become linked nodes in a knowledge graph), and
            <strong>Lab 11</strong> turns that into a campaign narrative.
          </p>
        </details>

        <!-- C · Four ideas -->
        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">C</span> Four ideas worth understanding<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <div class="cv-cards">
            <article class="cv-card">
              <div class="cv-card-head"><ArrowsOutIcon size={26} weight="duotone" /><h4>Fan-out, then fan-in</h4></div>
              <p>Dispatch many independent jobs (fan-out, the <em>map</em>), gather their results (fan-in), then <em>reduce</em> the batch into one synthesis. The fundamental pattern for doing lots of agent work in one pass.</p>
            </article>
            <article class="cv-card">
              <div class="cv-card-head"><LightningIcon size={26} weight="duotone" /><h4>Independent ⇒ concurrent</h4></div>
              <p>The jobs share no state and don't feed each other, so there's no reason to run them in sequence. Running them together turns minutes of serial model calls into one parallel wave.</p>
            </article>
            <article class="cv-card">
              <div class="cv-card-head"><ShieldCheckIcon size={26} weight="duotone" /><h4>Isolated failure, honest collection</h4></div>
              <p>One job erroring or returning unparseable output doesn't abort the batch — it's logged and dropped. A finding is only ever a real, parsed worker result, never a fabricated stand-in.</p>
            </article>
            <article class="cv-card">
              <div class="cv-card-head"><RepeatIcon size={26} weight="duotone" /><h4>It's Lab 06, multiplied</h4></div>
              <p>Each worker is the exact detection-skill execution from Lab 06. Orchestration adds nothing to the unit of work — it just composes many of them. Scale comes from composition, not new magic.</p>
            </article>
          </div>
        </details>

        <!-- D · File tree -->
        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">D</span> Where each piece lives<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">The orchestrator is the new piece; the worker is reused from Lab 06.</p>
          <pre class="cv-tree"><code><span class="tr-dir">hunting-agent/src/</span>
│
├─ <span class="tr-dir">routes/lab/09/api/orchestrate/</span>
│  └─ <span class="tr-file">+server.ts</span>             <span class="tr-cm">← endpoint → runDetectionFanOut()</span>
│
└─ <span class="tr-dir">framework/</span>
   ├─ <span class="tr-file">orchestrator.ts</span>        <span class="tr-cm">← plan · fan-out (allSettled) · fan-in</span>
   └─ <span class="tr-file">skill-execution.ts</span>     <span class="tr-cm">← plan invocations · run one detection (the worker)</span></code></pre>
        </details>

        <!-- Callout -->
        <aside class="cv-callout">
          <ArrowsOutIcon size={22} weight="duotone" />
          <p>
            <strong>Why orchestrate at all?</strong> A single agent call answers one question. Real
            investigations ask hundreds in parallel — every skill against every candidate. Fan-out /
            fan-in is how you get there without rewriting the work: keep the worker small and proven,
            then run a thousand of them and collect what they find.
          </p>
        </aside>
      </div>
    </div>
  {/if}
</main>

<style>
  :global(body) { background: #07070a; }
  .lab-shell {
    min-height: 100vh;
    padding: 2.5rem max(1rem, calc((100vw - 1120px) / 2));
    background:
      linear-gradient(135deg, rgba(189, 147, 249, 0.06), transparent 34%),
      #07070a;
    color: rgba(255, 255, 255, 0.9);
    font-family: var(--font-heading);
  }
  .back {
    display: inline-flex;
    margin-bottom: 1rem;
    color: #f5e663;
    font-size: .75rem;
    font-weight: 800;
    text-decoration: none;
    text-transform: uppercase;
  }
  .hero, .panel {
    border: 1px solid rgba(189, 147, 249, 0.24);
    border-radius: 4px;
    background: rgba(22, 22, 31, 0.92);
    padding: 1.4rem;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.32);
  }
  .hero { display: grid; gap: .8rem; margin-bottom: 1rem; }
  .hero span, .panel-head span { color: #bd93f9; text-transform: uppercase; font-weight: 800; }
  h1, h2, p { margin: 0; }
  h1 { color: #f5e663; font-size: clamp(2.5rem, 7vw, 5rem); line-height: .98; }
  h2 { color: #f5e663; }
  p, small { color: rgba(255, 255, 255, 0.62); line-height: 1.55; }
  button {
    width: fit-content;
    border: 1px solid rgba(245, 230, 99, 0.42);
    border-radius: 3px;
    padding: .7rem .95rem;
    background: rgba(245, 230, 99, 0.1);
    color: #f5e663;
    font: inherit;
    font-weight: 800;
  }
  button:disabled { opacity: .58; }
  .panel { margin-top: 1rem; }
  .panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
  .trace, .findings { display: grid; gap: .75rem; margin: 0; padding: 0; }
  .trace { list-style: none; }
  .trace li, article {
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    padding: .9rem;
    background: rgba(255, 255, 255, 0.025);
  }
  .trace strong, article strong { color: #8be9fd; }
  article { display: grid; gap: .45rem; }
  article div { display: flex; justify-content: space-between; gap: 1rem; }
  article span { color: rgba(255, 255, 255, 0.54); }
  .panel-note { margin: 0 0 .85rem; color: rgba(255, 255, 255, 0.6); font-size: .9rem; line-height: 1.55; }
  .empty { margin: 0; color: rgba(255, 255, 255, 0.5); }
  .trace-pending { opacity: .6; }
  .orch-error {
    margin: 1rem 0 0; padding: .75rem .9rem; border-radius: 6px;
    border: 1px solid rgba(255, 85, 85, .5); background: rgba(255, 85, 85, .08); color: #ff7b7b;
  }
  .reduce-body {
    border: 1px solid rgba(189, 147, 249, .3); border-radius: 6px;
    padding: .9rem 1rem; background: rgba(189, 147, 249, .05);
  }

  /* ═══ Top tab bar ══════════════════════════════════════ */
  .tab-bar-top {
    display: flex;
    gap: 0;
    border-bottom: 1px solid #1a1a2e;
    margin-bottom: 1rem;
  }
  .tab-btn-top {
    width: auto;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    padding: 0.85rem 1.5rem;
    font-family: "JetBrains Mono", monospace;
    font-size: 1rem;
    font-weight: 600;
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
    box-shadow: 0 0 0 4px #07070a;
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
    justify-content: flex-start;
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

  /* Fan-out / fan-in diagram */
  .fan {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.7rem;
    border: 1px solid #1c1c30;
    border-radius: 10px;
    background: rgba(18, 18, 26, 0.6);
    padding: 1.1rem 1.2rem;
  }
  .fan > :global(svg) { color: #6f6f86; flex-shrink: 0; }
  .fan-node {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    border: 1px solid #2a2a40;
    border-radius: 8px;
    background: #0d0d14;
    padding: 0.7rem 0.9rem;
    min-width: 96px;
    text-align: center;
  }
  .fan-node :global(svg) { color: #bd93f9; }
  .fan-in :global(svg) { color: #50fa7b; }
  .fan-node strong { color: #e8e8f0; font-size: 0.85rem; }
  .fan-node small { color: #7d7d92; font-size: 0.72rem; }
  .fan-mid { display: flex; flex-direction: column; gap: 0.35rem; flex: 1; min-width: 220px; }
  .fan-tag {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #50fa7b;
    margin-bottom: 0.1rem;
  }
  .fan-worker {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.8rem;
    color: #cfcfe0;
    background: #12121a;
    border: 1px solid #2a2a40;
    border-radius: 6px;
    padding: 0.35rem 0.6rem;
  }
  .fan-worker :global(svg) { color: #ff5555; }
  .fan-drop { color: #8a8a9a; border-style: dashed; }
  .cv-note {
    margin: 1rem 0 0;
    color: #aeaebe;
    font-size: 0.9rem;
    line-height: 1.7;
  }

  /* Concept cards (override lab09's global article rules) */
  .cv-cards { display: flex; flex-direction: column; gap: 1rem; }
  .cv-card {
    display: block;
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
    justify-content: flex-start;
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
</style>
