<script lang="ts">
  import RocketLaunchIcon from "phosphor-svelte/lib/RocketLaunchIcon";
  import ArrowsOutIcon from "phosphor-svelte/lib/ArrowsOutIcon";
  import GraphIcon from "phosphor-svelte/lib/GraphIcon";
  import ScrollIcon from "phosphor-svelte/lib/ScrollIcon";
  import FileTextIcon from "phosphor-svelte/lib/FileTextIcon";
  import BellRingingIcon from "phosphor-svelte/lib/BellRingingIcon";
  import FlagCheckeredIcon from "phosphor-svelte/lib/FlagCheckeredIcon";
  import PuzzlePieceIcon from "phosphor-svelte/lib/PuzzlePieceIcon";
  import StackIcon from "phosphor-svelte/lib/StackIcon";
  import CpuIcon from "phosphor-svelte/lib/CpuIcon";
  import ArrowRightIcon from "phosphor-svelte/lib/ArrowRightIcon";

  type Result = {
    graph: { nodes: unknown[]; edges: unknown[] };
    findings: unknown[];
    assessments?: unknown[];
    narrative: string;
    report: { fileName: string; path: string };
    notification: { channel: string; delivered: boolean; detail: string };
  };

  type ProgressLine = { stage: string; message: string };
  type StreamEvent =
    | { type: "progress"; stage: string; message: string; data?: Record<string, unknown> }
    | { type: "result"; result: Result }
    | { type: "error"; message: string }
    | { type: "done" };

  // ── Live flow model (driven by the progress stream) ───────────
  type StageKey = "initiate" | "detect" | "assess" | "store" | "kg" | "narrative" | "report" | "analyst";
  type StageState = "idle" | "active" | "done";
  type Worker = {
    id: string; skill: string; candidateId: string;
    state: "running" | "done" | "error"; verdict?: string; score?: number;
  };
  type AssessWorker = {
    id: string; skill: string; candidateId: string;
    state: "running" | "done" | "error"; assessmentType?: string; severity?: string | null;
  };
  const IDLE_STAGES: Record<StageKey, StageState> = {
    initiate: "idle", detect: "idle", assess: "idle", store: "idle", kg: "idle", narrative: "idle", report: "idle", analyst: "idle",
  };

  let activeTab = $state<"instructions" | "lab" | "code">("instructions");
  let result = $state<Result | null>(null);
  let progress = $state<ProgressLine[]>([]);
  let runError = $state("");
  let busy = $state(false);
  let stages = $state<Record<StageKey, StageState>>({ ...IDLE_STAGES });
  let workers = $state<Worker[]>([]);
  let assessWorkers = $state<AssessWorker[]>([]);

  function setStage(key: StageKey, s: StageState) { stages = { ...stages, [key]: s }; }

  function applyEvent(event: StreamEvent) {
    if (event.type === "progress") {
      progress = [...progress, { stage: event.stage, message: event.message }];
      driveGraph(event.stage, event.data);
    } else if (event.type === "result") {
      result = event.result;
      (["store", "kg", "narrative", "report", "analyst"] as StageKey[]).forEach((k) => setStage(k, "done"));
    } else if (event.type === "error") {
      runError = event.message;
    }
  }

  // Translate each progress event into a state transition on the flow map(s).
  function driveGraph(stage: string, data?: Record<string, unknown>) {
    switch (stage) {
      case "load": setStage("initiate", "active"); break;
      case "fan-out": {
        setStage("initiate", "done");
        setStage("detect", "active");
        const inv = (data?.invocations as Array<{ id: string; skill: string; candidateId: string }>) ?? [];
        workers = inv.map((i) => ({ id: i.id, skill: i.skill, candidateId: i.candidateId, state: "running" }));
        break;
      }
      case "worker":
        workers = workers.map((w) => w.id === String(data?.id)
          ? { ...w, state: "done", verdict: String(data?.verdict ?? ""), score: Number(data?.score ?? 0) } : w);
        break;
      case "worker-error":
        workers = workers.map((w) => w.id === String(data?.id) ? { ...w, state: "error" } : w);
        break;
      case "fan-in": setStage("detect", "done"); setStage("store", "active"); break;
      case "assess-fan-out": {
        setStage("assess", "active");
        const inv = (data?.invocations as Array<{ id: string; skill: string; candidateId: string }>) ?? [];
        assessWorkers = inv.map((i) => ({ id: i.id, skill: i.skill, candidateId: i.candidateId, state: "running" }));
        break;
      }
      case "assess-worker":
        assessWorkers = assessWorkers.map((w) => w.id === String(data?.id)
          ? { ...w, state: "done", assessmentType: String(data?.assessmentType ?? ""), severity: (data?.severity as string) ?? null } : w);
        break;
      case "assess-worker-error":
        assessWorkers = assessWorkers.map((w) => w.id === String(data?.id) ? { ...w, state: "error" } : w);
        break;
      case "assess-fan-in": setStage("assess", "done"); setStage("store", "done"); break;
      case "graph": setStage("kg", "active"); break;
      case "narrative": setStage("kg", "done"); setStage("narrative", "active"); break;
      case "report": setStage("narrative", "done"); setStage("report", "active"); break;
      case "done": setStage("report", "done"); setStage("analyst", "done"); break;
    }
  }

  async function run() {
    busy = true;
    result = null;
    progress = [];
    runError = "";
    stages = { ...IDLE_STAGES };
    workers = [];
    try {
      const response = await fetch("/lab/13/api/capstone", { method: "POST" });
      if (!response.ok) throw new Error(`Capstone API returned HTTP ${response.status}`);
      if (!response.body) throw new Error("Capstone API returned an empty stream.");

      // Read the NDJSON stream: split on newlines, parse each complete line, buffer the partial tail.
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
          if (line) applyEvent(JSON.parse(line) as StreamEvent);
          newlineIndex = buffer.indexOf("\n");
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

<svelte:head><title>Lab 13 | Complete Hunt Capstone</title></svelte:head>

<main class="lab-shell">
  <a class="back" href="/">Labs</a>

  <header class="hero">
    <span>Lab 13</span>
    <h1>Complete Hunt Capstone</h1>
    <p>Run the integrated flow from fan-out detection through graph state, narrative, report, and notification.</p>
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
          <span class="cv-eyebrow">Lab 13 · Walkthrough</span>
          <h2>Run the whole hunt, start to finish</h2>
          <p>
            This is the capstone. One click runs the <strong>entire pipeline</strong> you built up
            across Labs 09–12 — fan-out detection, the shared graph, the narrative, and
            the saved report with its notification. Nothing here is new; the goal is to watch every
            stage you learned in isolation execute <strong>in sequence</strong>, and recognise the
            primitives composing into one system.
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
                <span class="flow-title">2 · Read the integrated result</span>
                <span class="flow-where">Integrated Result panel</span>
              </div>
              <p>
                When it finishes, the <strong>Integrated Result</strong> panel shows the headline
                numbers: how many <strong>findings</strong> fan-out detection produced, and the
                <strong>graph nodes</strong> and <strong>edges</strong> that linked them.
              </p>
            </div>
          </li>

          <!-- Step 3 -->
          <li class="flow-step" style="--d: 220ms">
            <span class="flow-rail"><ScrollIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">3 · Read the narrative</span>
                <span class="flow-where">Narrative panel</span>
              </div>
              <p>
                The <strong>Narrative</strong> panel holds the campaign story the model wrote —
                grounded strictly in the graph's entities and edges (Lab 11). This is the
                human-readable account stitched together from the structured findings.
              </p>
            </div>
          </li>

          <!-- Step 4 -->
          <li class="flow-step" style="--d: 330ms">
            <span class="flow-rail"><FileTextIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">4 · Check the report &amp; notification</span>
                <span class="flow-where">Report + Notification panel</span>
              </div>
              <p>
                The <strong>Report + Notification</strong> panel closes the loop: the saved Markdown
                report's file name and path (Lab 12), plus the notification channel and whether it
                was delivered. This is the shippable artifact the whole hunt was building toward.
              </p>
            </div>
          </li>

          <!-- Step 5 -->
          <li class="flow-step" style="--d: 440ms">
            <span class="flow-rail"><PuzzlePieceIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">5 · Spot the labs, composed</span>
                <span class="flow-where">Code tab · optional</span>
              </div>
              <p>
                Every number on screen traces back to a lab you already ran: detect (09) → connect
                (10) → narrate (11) → report &amp; notify (12). The optional
                <strong>Code</strong> tab walks the exact ordering and which stages call the model.
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

  {#if busy || progress.length || result}
    <section class="panel">
      <h2>System overview</h2>
      <p class="flow-caption">The whole hunt as a map — each node lights up as it runs. Detection &amp; assessment findings persist <em>up</em> to the Knowledge Graph and <em>down</em> to the Findings Store; the narrative then reads connections from the graph and reasoning from the store.</p>

      <div class="archmap">
        <!-- top band -->
        <div class="band {stages.kg}">
          <div class="band-title">Knowledge Graph</div>
          <div class="band-sub">structural index (lossy) · ids · scores · edges · {result ? `${result.graph.nodes.length} nodes · ${result.graph.edges.length} edges` : "persisted"}</div>
        </div>
        <div class="rail up" aria-hidden="true"><span>↑ persist (lossy structural index) ↑</span></div>

        <!-- pipeline -->
        <div class="pipe">
          <div class="anode {stages.initiate}"><span class="anode-dot"></span><div class="anode-txt"><strong>Initiation</strong><small>one hunt request</small></div></div>
          <span class="sep {stages.detect !== 'idle' ? 'lit' : ''}">▸</span>

          <div class="anode wide {stages.detect}">
            <div class="anode-head"><span class="anode-dot"></span><strong>Detection</strong><small>fan-out / fan-in</small></div>
            <div class="mini-chips">
              {#each workers as w}
                <span class="mini {w.state} {w.verdict ? 'v-' + w.verdict : ''}" title="{w.skill} · {w.candidateId}">{w.candidateId}{#if w.state === 'done'} · {w.verdict === 'true_positive' ? 'TP' : w.verdict === 'false_positive' ? 'FP' : '?'}{/if}</span>
              {/each}
            </div>
          </div>
          <span class="sep {stages.assess !== 'idle' ? 'lit' : ''}">▸</span>

          <div class="anode wide {stages.assess}">
            <div class="anode-head"><span class="anode-dot"></span><strong>Assessment</strong><small>per-TP-finding fan-out · live</small></div>
            <div class="mini-chips">
              {#each assessWorkers as a}
                <span class="mini {a.state} sev-{(a.severity ?? '').toLowerCase()}" title="{a.skill} · {a.candidateId}">{a.candidateId} · {a.state === 'done' ? (a.assessmentType === 'severity' ? (a.severity ?? 'sev') : 'beh') : '…'}</span>
              {/each}
            </div>
          </div>
          <span class="sep {stages.narrative !== 'idle' ? 'lit' : ''}">▸</span>

          <div class="anode narr {stages.narrative}">
            <div class="anode-line"><span class="anode-dot"></span><div class="anode-txt"><strong>Narrative P1</strong><small>read graph connections</small></div></div>
            <div class="anode-line"><span class="anode-dot"></span><div class="anode-txt"><strong>Narrative P2</strong><small>read store reasoning</small></div></div>
          </div>
          <span class="sep {stages.report !== 'idle' ? 'lit' : ''}">▸</span>

          <div class="anode {stages.report}"><span class="anode-dot"></span><div class="anode-txt"><strong>Report</strong><small>{result ? result.report.fileName : "single artifact"}</small></div></div>
          <span class="sep {stages.analyst === 'done' ? 'lit' : ''}">▸</span>

          <div class="anode {stages.analyst}"><span class="anode-dot"></span><div class="anode-txt"><strong>Analyst</strong><small>human review</small></div></div>
        </div>

        <div class="rail down" aria-hidden="true"><span>↓ persist (lossless source of truth) ↓</span></div>
        <!-- bottom band -->
        <div class="band {stages.store}">
          <div class="band-title">Findings Store</div>
          <div class="band-sub">source of truth (lossless) · full objects, incl. prose · {result ? `${result.findings.length} findings · ${result.assessments?.length ?? 0} assessments` : "persisted"}</div>
        </div>
      </div>
    </section>
  {/if}

  {#if progress.length}
    <section class="panel">
      <h2>Pipeline Progress</h2>
      <ol class="progress-log">
        {#each progress as line}
          <li class:done={line.stage === "done"}>
            <span class="stage">{line.stage}</span>
            <span class="msg">{line.message}</span>
          </li>
        {/each}
        {#if busy}
          <li class="running"><span class="stage">…</span><span class="msg">running</span></li>
        {/if}
      </ol>
    </section>
  {/if}
  {#if result}
    <section class="panel">
      <h2>Integrated Result</h2>
      <div class="stats">
        <article><strong>{result.findings.length}</strong><span>findings</span></article>
        <article><strong>{result.graph.nodes.length}</strong><span>graph nodes</span></article>
        <article><strong>{result.graph.edges.length}</strong><span>graph edges</span></article>
      </div>
    </section>
    <section class="panel">
      <h2>Narrative</h2>
      <pre>{result.narrative}</pre>
    </section>
    <section class="panel">
      <h2>Report + Notification</h2>
      <p>{result.report.fileName}</p>
      <p class="path">{result.report.path}</p>
      <p>{result.notification.channel} | {result.notification.delivered ? "delivered" : "not delivered"} | {result.notification.detail}</p>
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
            connect, narrate, report, notify. There's nothing new here: it's the earlier labs
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
            <span>report + alert</span>
          </div>
        </header>

        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">A</span> The full pipeline, stage by stage<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">
            One endpoint chains the stages. The first three are produced inside
            <code>runInvestigationState()</code>; the rest are assembled from that real output.
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
                <p>The model writes a campaign story, grounded strictly in the graph's entities and edges.</p>
              </div>
            </li>
            <li class="flow-step" style="--d: 450ms">
              <span class="flow-rail"><FileTextIcon size={22} weight="duotone" /></span>
              <div class="flow-body">
                <div class="flow-top"><span class="flow-title">Report &amp; notify</span><span class="flow-badge">closes the loop</span><span class="flow-where">Lab 12 · report.ts · notifications.ts</span></div>
                <p>Verdicts and narrative are assembled into a saved Markdown report, and a notification fires through the configured adapter.</p>
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
            <span class="cap-stage"><GraphIcon size={15} weight="duotone" />connect<small>Lab 10</small></span>
            <ArrowRightIcon size={14} weight="bold" />
            <span class="cap-stage"><ScrollIcon size={15} weight="duotone" />narrate<small>Lab 11</small></span>
            <ArrowRightIcon size={14} weight="bold" />
            <span class="cap-stage"><BellRingingIcon size={15} weight="duotone" />report<small>Lab 12</small></span>
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
              <p><code>runInvestigationState()</code> already chains detect → assess → connect → narrate. The endpoint just adds report and notify around it — the same functions from Labs 11 and 12.</p>
            </article>
            <article class="cv-card">
              <div class="cv-card-head"><CpuIcon size={26} weight="duotone" /><h4>A deterministic shell around model steps</h4></div>
              <p>The model is called only where judgement is needed — detection, assessment, and narrative synthesis. Everything else — fan-out/fan-in, the graph, report, notify — is deterministic code. The agent is a thin layer of judgement inside a sturdy machine.</p>
            </article>
            <article class="cv-card">
              <div class="cv-card-head"><FlagCheckeredIcon size={26} weight="duotone" /><h4>This is the real shape of an agent</h4></div>
              <p>Not one clever prompt, but a pipeline: gather, reason where it helps, structure, verify, and ship an artifact. That's what every earlier lab was building toward.</p>
            </article>
          </div>
        </details>

        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">D</span> Where each piece lives<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">The capstone endpoint is thin — it calls into the framework files from every prior lab.</p>
          <pre class="cv-tree"><code><span class="tr-dir">hunting-agent/src/</span>
│
├─ <span class="tr-dir">routes/lab/13/api/capstone/</span>
│  └─ <span class="tr-file">+server.ts</span>             <span class="tr-cm">← chains the whole pipeline in one handler</span>
│
└─ <span class="tr-dir">framework/</span>
   ├─ <span class="tr-file">orchestrator.ts</span>        <span class="tr-cm">← runInvestigationState: detect + assess + graph + narrative</span>
   ├─ <span class="tr-file">report.ts</span>             <span class="tr-cm">← assemble + save the report</span>
   └─ <span class="tr-file">notifications.ts</span>       <span class="tr-cm">← fire the notification</span></code></pre>
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
  p, .path { color: rgba(255,255,255,.62); line-height: 1.55; }
  button { width: fit-content; border: 1px solid rgba(245,230,99,.42); border-radius: 3px; padding: .7rem .95rem; background: rgba(245,230,99,.1); color: #f5e663; font: inherit; font-weight: 800; }
  .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .75rem; }
  article { border: 1px solid rgba(255,255,255,.12); border-radius: 4px; padding: .9rem; display: grid; gap: .25rem; }
  article strong { color: #8be9fd; font-size: 2rem; }
  article span { color: rgba(255,255,255,.58); }
  pre { white-space: pre-wrap; color: rgba(255,255,255,.76); }
  .panel.error { border-color: rgba(255,85,85,.5); }
  .panel.error p { color: #ff8b8b; }
  .progress-log { list-style: none; margin: 0; padding: 0; display: grid; gap: .35rem; font-family: var(--font-mono, ui-monospace, monospace); }
  .progress-log li { display: grid; grid-template-columns: 7.5rem 1fr; gap: .75rem; align-items: baseline; padding: .4rem .6rem; border: 1px solid rgba(255,255,255,.08); border-radius: 4px; background: rgba(255,255,255,.02); }
  .progress-log .stage { color: #bd93f9; font-size: .76rem; text-transform: uppercase; letter-spacing: .03em; }
  .progress-log .msg { color: rgba(255,255,255,.78); font-size: .86rem; }
  .progress-log li.done { border-color: rgba(80,250,123,.4); }
  .progress-log li.done .stage { color: #50fa7b; }
  .progress-log li.running .stage, .progress-log li.running .msg { color: #f5e663; }

  /* ═══ Orchestration flow map ═══════════════════════════ */
  .flow-caption { color: rgba(255,255,255,.6); font-size: .9rem; line-height: 1.55; margin-bottom: 1.1rem; }
  .flow-caption em { color: rgba(255,255,255,.85); font-style: normal; font-weight: 700; }

  /* ── architectural overview map ── */
  .archmap { display: grid; gap: .5rem; }
  .band { border: 1.5px dashed rgba(255,255,255,.22); border-radius: 8px; padding: .7rem 1rem; text-align: center; opacity: .5; transition: opacity .4s, border-color .4s; }
  .band-title { font-weight: 800; letter-spacing: .02em; }
  .band-sub { font-size: .74rem; color: rgba(255,255,255,.55); margin-top: .12rem; font-family: var(--font-mono, ui-monospace, monospace); }
  .archmap .band:first-of-type { border-color: rgba(245,230,99,.4); }
  .archmap .band:first-of-type .band-title { color: #f5e663; }
  .archmap .band:last-of-type { border-color: rgba(255,121,198,.4); }
  .archmap .band:last-of-type .band-title { color: #ff79c6; }
  .band.active, .band.done { opacity: 1; }
  .band.done { border-style: solid; }

  .rail { text-align: center; line-height: 1; }
  .rail span { font-size: .66rem; color: rgba(255,255,255,.32); font-family: var(--font-mono, ui-monospace, monospace); }

  .pipe { display: flex; flex-wrap: wrap; align-items: stretch; justify-content: center; gap: .4rem; padding: .4rem 0; }
  .anode { display: flex; align-items: center; gap: .55rem; padding: .6rem .8rem; border: 1px solid rgba(255,255,255,.12); border-radius: 8px; background: rgba(255,255,255,.02); opacity: .5; transition: opacity .4s, border-color .4s, background .4s; min-width: 0; }
  .anode.wide { flex-direction: column; align-items: flex-start; gap: .45rem; min-width: 11rem; }
  .anode.narr { flex-direction: column; align-items: flex-start; gap: .4rem; }
  .anode-dot { width: .9rem; height: .9rem; border-radius: 50%; background: #2c2c3c; border: 2px solid #44445a; flex-shrink: 0; transition: all .4s; }
  .anode-head { display: flex; align-items: baseline; gap: .45rem; }
  .anode-txt strong, .anode-head strong { display: block; font-size: .88rem; color: rgba(255,255,255,.92); }
  .anode-txt small, .anode-head small { display: block; font-size: .7rem; color: rgba(255,255,255,.5); }
  .anode-line { display: flex; align-items: center; gap: .5rem; }
  .anode.active { opacity: 1; border-color: rgba(245,230,99,.5); background: rgba(245,230,99,.05); }
  .anode.active .anode-dot { background: #f5e663; border-color: #f5e663; animation: pulse 1.4s infinite; }
  .anode.done { opacity: 1; border-color: rgba(80,250,123,.4); }
  .anode.done .anode-dot { background: #50fa7b; border-color: #50fa7b; }

  .sep { align-self: center; color: rgba(255,255,255,.25); font-size: 1.05rem; transition: color .4s; }
  .sep.lit { color: #50fa7b; }

  .mini-chips { display: flex; flex-wrap: wrap; gap: .3rem; }
  .mini { font-size: .66rem; font-family: var(--font-mono, ui-monospace, monospace); padding: .12rem .4rem; border-radius: 5px; border: 1px solid rgba(255,255,255,.15); color: rgba(255,255,255,.7); white-space: nowrap; transition: all .3s; }
  .mini.running { border-color: rgba(245,230,99,.4); color: #f5e663; animation: pulse-soft 1.4s infinite; }
  .mini.error { border-color: rgba(255,85,85,.5); color: #ff5555; }
  .mini.v-true_positive { border-color: rgba(255,121,198,.5); color: #ff79c6; }
  .mini.v-false_positive { border-color: rgba(80,250,123,.45); color: #50fa7b; }
  .mini.sev-critical { border-color: rgba(255,85,85,.55); color: #ff6b6b; }
  .mini.sev-high { border-color: rgba(255,184,108,.55); color: #ffb86c; }
  .mini.sev-medium { border-color: rgba(245,230,99,.5); color: #f5e663; }
  .mini.sev-low { border-color: rgba(80,250,123,.45); color: #50fa7b; }

  @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(245,230,99,.55); } 70% { box-shadow: 0 0 0 7px rgba(245,230,99,0); } 100% { box-shadow: 0 0 0 0 rgba(245,230,99,0); } }
  @keyframes pulse-soft { 0%,100% { opacity: 1; } 50% { opacity: .55; } }
  @media (prefers-reduced-motion: reduce) { .anode.active .anode-dot, .mini.running { animation: none; } }

  @media (max-width: 850px) { .stats { grid-template-columns: 1fr 1fr; } }
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
  .flow-badge { font-size: 0.68rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #f5e663; border: 1px solid rgba(245, 230, 99, 0.5); border-radius: 999px; padding: 0.1rem 0.5rem; }
  .flow-body p { margin: 0; color: #aeaebe; font-size: 0.9rem; line-height: 1.65; }

  /* Capstone chain */
  .cap-chain { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; border: 1px solid #1c1c30; border-radius: 10px; background: rgba(18, 18, 26, 0.6); padding: 1.1rem 1.2rem; }
  .cap-chain > :global(svg) { color: #6f6f86; flex-shrink: 0; }
  .cap-stage { display: inline-flex; flex-direction: column; align-items: center; gap: 0.1rem; font-size: 0.82rem; color: #cfcfe0; background: #0d0d14; border: 1px solid #2a2a40; border-radius: 7px; padding: 0.5rem 0.7rem; min-width: 78px; text-align: center; }
  .cap-stage :global(svg) { color: #bd93f9; }
  .cap-stage small { color: #7d7d92; font-size: 0.66rem; }
  .cv-note { margin: 1rem 0 0; color: #aeaebe; font-size: 0.9rem; line-height: 1.7; }

  /* Concept cards (override lab14 global article) */
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
