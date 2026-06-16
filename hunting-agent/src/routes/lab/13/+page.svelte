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
    narrative: string;
    report: { fileName: string; path: string };
    notification: { channel: string; delivered: boolean; detail: string };
  };

  type ProgressLine = { stage: string; message: string };
  type StreamEvent =
    | { type: "progress"; stage: string; message: string }
    | { type: "result"; result: Result }
    | { type: "error"; message: string }
    | { type: "done" };

  let activeTab = $state<"instructions" | "lab" | "code">("instructions");
  let result = $state<Result | null>(null);
  let progress = $state<ProgressLine[]>([]);
  let runError = $state("");
  let busy = $state(false);

  function applyEvent(event: StreamEvent) {
    if (event.type === "progress") progress = [...progress, { stage: event.stage, message: event.message }];
    else if (event.type === "result") result = event.result;
    else if (event.type === "error") runError = event.message;
  }

  async function run() {
    busy = true;
    result = null;
    progress = [];
    runError = "";
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
            capstone runs them <strong>all in sequence</strong> on one click — detect, connect,
            narrate, grade, report, notify. There's nothing new here: it's the earlier labs
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
              <span class="flow-rail"><GraphIcon size={22} weight="duotone" /></span>
              <div class="flow-body">
                <div class="flow-top"><span class="flow-title">Build the shared graph</span><span class="flow-where">Lab 10 · graph.ts</span></div>
                <p>Candidates and their entities become deduplicated nodes and edges — the shared state that links findings.</p>
              </div>
            </li>
            <li class="flow-step" style="--d: 180ms">
              <span class="flow-rail"><ScrollIcon size={22} weight="duotone" /></span>
              <div class="flow-body">
                <div class="flow-top"><span class="flow-title">Synthesize the narrative</span><span class="flow-where">Lab 11 · narrative.ts</span></div>
                <p>The model writes a campaign story, grounded strictly in the graph's entities and edges.</p>
              </div>
            </li>
            <li class="flow-step" style="--d: 360ms">
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
              <p><code>runInvestigationState()</code> already chains detect → connect → narrate. The endpoint just adds report and notify around it — the same functions from Labs 11 and 12.</p>
            </article>
            <article class="cv-card">
              <div class="cv-card-head"><CpuIcon size={26} weight="duotone" /><h4>A deterministic shell around model steps</h4></div>
              <p>Only detection and narrative call the model. Everything else — fan-out, graph, report, notify — is deterministic code. The agent is a thin layer of judgement inside a sturdy machine.</p>
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
   ├─ <span class="tr-file">orchestrator.ts</span>        <span class="tr-cm">← runInvestigationState: detect + graph + narrative</span>
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
