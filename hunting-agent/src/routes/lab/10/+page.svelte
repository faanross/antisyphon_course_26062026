<script lang="ts">
  import { scale, fade } from "svelte/transition";
  import GraphIcon from "phosphor-svelte/lib/GraphIcon";
  import ShareNetworkIcon from "phosphor-svelte/lib/ShareNetworkIcon";
  import DatabaseIcon from "phosphor-svelte/lib/DatabaseIcon";
  import ArrowRightIcon from "phosphor-svelte/lib/ArrowRightIcon";
  import ArrowCounterClockwiseIcon from "phosphor-svelte/lib/ArrowCounterClockwiseIcon";
  import {
    findingToCypher,
    EXAMPLE_FINDINGS,
    type ProjNode,
  } from "../../../framework/finding-cypher.js";

  let activeTab = $state<"instructions" | "lab" | "code">("instructions");

  // Project both findings once (deterministic, no model). We reveal them step by step.
  const projA = findingToCypher(EXAMPLE_FINDINGS[0]);
  const projB = findingToCypher(EXAMPLE_FINDINGS[1]);
  const aIds = new Set(projA.nodes.map((n) => n.id));
  const sharedIds = new Set(projB.nodes.filter((n) => aIds.has(n.id)).map((n) => n.id));

  // step: 0 nothing · 1 finding A projected · 2 finding B projected · 3 connection revealed
  let step = $state(0);

  const visibleNodes = $derived.by(() => {
    const map = new Map<string, ProjNode>();
    if (step >= 1) projA.nodes.forEach((n) => map.set(n.id, n));
    if (step >= 2) projB.nodes.forEach((n) => map.set(n.id, n));
    return [...map.values()];
  });
  const visibleEdges = $derived.by(() => {
    const e: { source: string; target: string; label: string }[] = [];
    if (step >= 1) e.push(...projA.edges);
    if (step >= 2) e.push(...projB.edges);
    return e;
  });
  const cypherLog = $derived.by(() => {
    const lines: { text: string; finding: string; reused: boolean }[] = [];
    if (step >= 1) projA.cypher.forEach((t) => lines.push({ text: t, finding: "df-a", reused: false }));
    if (step >= 2)
      projB.cypher.forEach((t, i) =>
        lines.push({ text: t, finding: "df-b", reused: i > 0 && aIds.has(projB.nodes[i].id) }),
      );
    return lines;
  });

  // Fixed, legible layout (viewBox 880 × 500) — findings top L/R, shared host+user bottom-centre.
  const POS: Record<string, { x: number; y: number }> = {
    "finding:df-a": { x: 210, y: 72 },
    "candidate:BEA-001": { x: 74, y: 182 },
    "technique:T1071.001": { x: 252, y: 196 },
    "finding:df-b": { x: 670, y: 72 },
    "candidate:PSI-001": { x: 806, y: 182 },
    "technique:T1059.001": { x: 628, y: 196 },
    "host:DEV-WS03": { x: 388, y: 362 },
    "user:NORTHWIND\\jane.roberts": { x: 498, y: 436 },
  };

  function display(node: ProjNode): string {
    if (node.type === "user") return node.label.replace(/^[^\\]*\\/, "");
    return node.label;
  }
  function skillOf(id: string): string {
    return id === "finding:df-a" ? EXAMPLE_FINDINGS[0].skillName : id === "finding:df-b" ? EXAMPLE_FINDINGS[1].skillName : "";
  }
  function nodeStyle(id: string): string {
    const p = POS[id];
    return p ? `left:${((p.x / 880) * 100).toFixed(2)}%;top:${((p.y / 500) * 100).toFixed(2)}%` : "";
  }
  function isBridgeEdge(e: { target: string }): boolean {
    return step >= 3 && sharedIds.has(e.target);
  }

  const STEP_META = [
    { label: "Project Finding A (df-a) into the graph", caption: "Press to project the first detection finding — its typed object becomes Cypher, and the Cypher becomes nodes + edges." },
    { label: "Project Finding B (df-b) into the graph", caption: "A second, independent finding. Watch its own subgraph appear — but notice the host and user it MERGEs already exist." },
    { label: "Reveal the shared-entity connection", caption: "Because MERGE is idempotent, both findings' Host and User collapse to one node each — so df-a and df-b are now linked through them." },
  ];
  const caption = $derived(step < 3 ? STEP_META[step].caption : "Done. Two independent findings, one compromised host and user — a connection the graph discovered that neither finding stated.");
</script>

<svelte:head><title>Lab 10 | Knowledge Graph — Finding → Cypher → Connection</title></svelte:head>

<main class="lab-shell">
  <a class="back" href="/">Labs</a>

  <header class="hero">
    <span>Lab 10</span>
    <h1>Knowledge Graph — a finding becomes Cypher</h1>
    <p>Each detection finding projects, deterministically, into graph nodes and edges. Project two findings and watch the graph link them through the entities they share.</p>
  </header>

  <div class="tab-bar-top">
    <button class="tab-btn-top" class:active={activeTab === "instructions"} onclick={() => (activeTab = "instructions")}>Instructions</button>
    <button class="tab-btn-top" class:active={activeTab === "lab"} onclick={() => (activeTab = "lab")}>Lab</button>
    <button class="tab-btn-top" class:active={activeTab === "code"} onclick={() => (activeTab = "code")}>Code</button>
  </div>

  {#if activeTab === "instructions"}
    <section class="panel prose">
      <h2>What this lab shows</h2>
      <p>You already watched detection produce a structured <code>DetectionFinding</code>. That object is the source of truth — but on its own it can't tell you that <em>this</em> finding and <em>that</em> one are the same compromise. That is the knowledge graph's job, and it does it through one mechanism: <strong>shared entities</strong>.</p>
      <ol class="steps-list">
        <li><strong>A finding becomes Cypher.</strong> A deterministic projection (no model) turns the finding's entities — host, user, candidates, techniques — into <code>MERGE</code> statements: one node per entity, one edge from the finding to each.</li>
        <li><strong>A second finding projects the same way.</strong> It builds its own nodes — but the host and user it touches were already created by the first finding.</li>
        <li><strong>The graph connects them.</strong> <code>MERGE</code> is idempotent: an entity that already exists is reused, not duplicated. So the two findings end up wired to the <em>same</em> host and user node — and that shared node is the connection.</li>
      </ol>
      <p class="hint">Go to the <strong>Lab</strong> tab and step through it. The <strong>Code</strong> tab shows the projection function and why <code>MERGE</code> is the whole trick.</p>
    </section>

  {:else if activeTab === "lab"}
    <section class="panel">
      <div class="lab-head">
        <div class="step-dots">
          {#each [1, 2, 3] as n}
            <span class="dot" class:done={step >= n} class:current={step === n - 1}>{n}</span>
          {/each}
        </div>
        <div class="lab-actions">
          {#if step < 3}
            <button class="primary" onclick={() => (step += 1)}>{STEP_META[step].label}<ArrowRightIcon size={16} weight="bold" /></button>
          {/if}
          <button class="ghost" onclick={() => (step = 0)} disabled={step === 0}><ArrowCounterClockwiseIcon size={15} weight="bold" /> Reset</button>
        </div>
      </div>
      <p class="caption">{caption}</p>

      <div class="lab-grid">
        <!-- Cypher panel -->
        <div class="cypher">
          <div class="cypher-head"><DatabaseIcon size={15} weight="duotone" /> Cypher emitted (deterministic — no model)</div>
          {#if cypherLog.length === 0}
            <p class="cypher-empty">Project a finding to see its Cypher.</p>
          {:else}
            <ol class="cypher-lines">
              {#each cypherLog as line}
                <li class="cy-{line.finding}" class:reused={line.reused} transition:fade>
                  <code>{line.text}</code>
                  {#if line.reused}<span class="reused-tag">↺ reused</span>{/if}
                </li>
              {/each}
            </ol>
          {/if}
        </div>

        <!-- Graph panel -->
        <div class="graphwrap">
          <div class="graph">
            <svg viewBox="0 0 880 500" class="edges" aria-hidden="true">
              {#each visibleEdges as e (e.source + e.target + e.label)}
                {@const s = POS[e.source]}
                {@const t = POS[e.target]}
                {#if s && t}
                  <line x1={s.x} y1={s.y} x2={t.x} y2={t.y} class:bridge={isBridgeEdge(e)} transition:fade />
                  <text x={s.x + (t.x - s.x) * 0.36} y={s.y + (t.y - s.y) * 0.36 - 4} class="edge-label" class:bridge={isBridgeEdge(e)}>{e.label}</text>
                {/if}
              {/each}
            </svg>
            {#each visibleNodes as n (n.id)}
              <div class="node n-{n.type}" class:hot={step >= 3 && sharedIds.has(n.id)} style={nodeStyle(n.id)} transition:scale={{ duration: 350, start: 0.4 }}>
                <span class="node-circle"></span>
                <span class="node-label">{display(n)}</span>
                {#if skillOf(n.id)}<span class="node-sub">{skillOf(n.id)}</span>{/if}
              </div>
            {/each}
          </div>

          {#if step >= 3}
            <div class="connect-callout" transition:fade>
              <ShareNetworkIcon size={18} weight="duotone" />
              <span><strong>df-a</strong> and <strong>df-b</strong> are connected through <strong>DEV-WS03</strong> and <strong>jane.roberts</strong> — the graph found a link neither finding stated.</span>
            </div>
          {/if}

          <div class="legend">
            <span class="lg n-finding">finding</span>
            <span class="lg n-host">host</span>
            <span class="lg n-user">user</span>
            <span class="lg n-candidate">candidate</span>
            <span class="lg n-technique">technique</span>
          </div>
        </div>
      </div>
    </section>

  {:else}
    <section class="panel prose">
      <h2>How the projection works</h2>
      <p>When a finding clears the gate, the deterministic write path projects it into the graph. There is <strong>no model</strong> here — it's pure code reading the finding's typed fields.</p>

      <h3>The projection</h3>
      <pre class="code"><code>{`function findingToCypher(f: DetectionFinding) {
  // 1 · the finding itself
  MERGE (f:Finding {id: f.findingId}) SET f.skill=…, f.score=…
  // 2 · one node + one edge per entity it touches
  MERGE (h:Host {id: f.scope.host})            MERGE (f)-[:TARGETS]->(h)
  MERGE (u:User {id: f.scope.user})            MERGE (f)-[:ATTRIBUTED_TO]->(u)
  for each candidateId:  MERGE (c:Candidate …) MERGE (f)-[:BASED_ON]->(c)
  for each technique:    MERGE (t:Technique …) MERGE (f)-[:USES]->(t)
}`}</code></pre>
      <p class="filehint">Real source: <code>src/framework/finding-cypher.ts</code></p>

      <h3>Why <code>MERGE</code> is the whole trick</h3>
      <p><code>MERGE</code> means <em>“match if it exists, else create.”</em> It is <strong>idempotent</strong> and keyed by <code>id</code>. So when Finding B does <code>MERGE (h:Host &#123;id:'DEV-WS03'&#125;)</code>, it does <strong>not</strong> create a second host — it <em>reuses</em> the one Finding A already created. Both findings end up pointing at the <strong>same</strong> node. That shared node <em>is</em> the connection — discovered structurally, asserted by no one.</p>

      <h3>The graph is an index, not the record</h3>
      <p>Notice what the graph stores: ids, a skill, a score, typed edges. <strong>Not</strong> the finding's reasoning (its narrative, its ruled-out benign causes). That lossless detail lives in the <strong>findings store</strong> (DuckDB). The graph is a deliberately <strong>lossy structural index</strong> over it — lean and fast for one job: discovering which findings connect. The narrative phase reads the graph to find the connected set, then reads the <em>store</em> for the reasoning.</p>
    </section>
  {/if}
</main>

<style>
  :global(body) { background: #07070a; }
  .lab-shell {
    min-height: 100vh; padding: 2.5rem max(1rem, calc((100vw - 1120px) / 2));
    background: linear-gradient(135deg, rgba(189,147,249,.06), transparent 34%), #07070a;
    color: rgba(255,255,255,.9); font-family: var(--font-heading, ui-sans-serif);
  }
  .back { color: rgba(255,255,255,.55); text-decoration: none; font-size: .85rem; }
  .hero, .panel { border: 1px solid rgba(189,147,249,.24); border-radius: 6px; background: rgba(22,22,31,.92); }
  .hero { padding: 1.6rem 1.5rem 1.4rem; margin-top: .8rem; }
  .hero span { color: #bd93f9; font-weight: 800; font-size: .9rem; }
  .hero h1 { margin: .35rem 0 .5rem; font-size: clamp(1.6rem, 4vw, 2.5rem); color: #f5e663; }
  .hero p { color: rgba(255,255,255,.62); max-width: 60rem; line-height: 1.55; }
  .panel { margin-top: 1rem; padding: 1.4rem 1.5rem; }
  h2 { color: #ff79c6; font-size: 1.25rem; margin: 0 0 .8rem; }
  h3 { color: #bd93f9; font-size: .95rem; text-transform: uppercase; letter-spacing: .03em; margin: 1.4rem 0 .5rem; }
  .prose p { color: rgba(255,255,255,.72); line-height: 1.65; margin: .6rem 0; max-width: 64rem; }
  code { font-family: var(--font-mono, ui-monospace, monospace); color: #8be9fd; background: rgba(139,233,253,.08); padding: .05rem .3rem; border-radius: 4px; font-size: .9em; }
  .steps-list { margin: .9rem 0; padding-left: 1.3rem; display: grid; gap: .7rem; color: rgba(255,255,255,.78); line-height: 1.6; max-width: 64rem; }
  .steps-list strong { color: #fff; }
  .hint, .filehint { color: rgba(255,255,255,.5); font-size: .9rem; }

  .tab-bar-top { display: flex; gap: 0; border-bottom: 1px solid #1a1a2e; margin: 1rem 0; }
  .tab-btn-top { background: none; border: none; border-bottom: 2px solid transparent; color: rgba(255,255,255,.5); padding: .6rem 1rem; font-weight: 700; cursor: pointer; font-family: inherit; }
  .tab-btn-top.active { color: #f5e663; border-bottom-color: #f5e663; }

  /* ── Lab head / controls ── */
  .lab-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
  .step-dots { display: flex; gap: .5rem; }
  .step-dots .dot { width: 1.6rem; height: 1.6rem; border-radius: 50%; display: grid; place-items: center; font-size: .8rem; font-weight: 800; color: rgba(255,255,255,.5); border: 1px solid rgba(255,255,255,.2); }
  .step-dots .dot.current { border-color: #f5e663; color: #f5e663; }
  .step-dots .dot.done { background: #50fa7b; border-color: #50fa7b; color: #07070a; }
  .lab-actions { display: flex; gap: .6rem; align-items: center; }
  button.primary { display: inline-flex; align-items: center; gap: .45rem; background: rgba(245,230,99,.14); color: #f5e663; border: 1px solid rgba(245,230,99,.5); border-radius: 6px; padding: .55rem .9rem; font-weight: 700; cursor: pointer; font-family: inherit; }
  button.primary:hover { background: rgba(245,230,99,.22); }
  button.ghost { display: inline-flex; align-items: center; gap: .35rem; background: none; color: rgba(255,255,255,.6); border: 1px solid rgba(255,255,255,.18); border-radius: 6px; padding: .5rem .8rem; cursor: pointer; font-family: inherit; }
  button.ghost:disabled { opacity: .35; cursor: default; }
  .caption { color: rgba(255,255,255,.7); line-height: 1.55; margin: .9rem 0 1.1rem; min-height: 2.6rem; }

  .lab-grid { display: grid; grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.25fr); gap: 1.1rem; align-items: start; }
  @media (max-width: 900px) { .lab-grid { grid-template-columns: 1fr; } }

  /* ── Cypher panel ── */
  .cypher { border: 1px solid rgba(98,114,164,.4); border-radius: 8px; background: rgba(18,18,26,.7); overflow: hidden; }
  .cypher-head { display: flex; align-items: center; gap: .4rem; padding: .55rem .8rem; font-size: .76rem; color: #8be9fd; border-bottom: 1px solid rgba(98,114,164,.3); }
  .cypher-empty { color: rgba(255,255,255,.4); padding: 1.2rem .9rem; font-size: .85rem; }
  .cypher-lines { list-style: none; margin: 0; padding: .6rem; display: grid; gap: .4rem; }
  .cypher-lines li { display: flex; align-items: center; gap: .5rem; padding-left: .6rem; border-left: 2px solid transparent; }
  .cypher-lines code { background: none; color: rgba(255,255,255,.85); font-size: .73rem; line-height: 1.4; word-break: break-word; }
  .cy-df-a { border-left-color: #ff79c6; }
  .cy-df-b { border-left-color: #f5e663; }
  .cypher-lines li.reused code { color: rgba(255,255,255,.45); }
  .reused-tag { flex-shrink: 0; font-size: .64rem; font-weight: 800; color: #50fa7b; border: 1px solid rgba(80,250,123,.5); border-radius: 999px; padding: .04rem .4rem; }

  /* ── Graph ── */
  .graph { position: relative; width: 100%; aspect-ratio: 880 / 500; border: 1px solid rgba(98,114,164,.35); border-radius: 8px; background: radial-gradient(circle at 50% 60%, rgba(189,147,249,.05), transparent 60%), rgba(12,12,18,.6); }
  .edges { position: absolute; inset: 0; width: 100%; height: 100%; }
  .edges line { stroke: rgba(139,233,253,.32); stroke-width: 1.5; transition: stroke .35s; }
  .edges line.bridge { stroke: #50fa7b; stroke-width: 3; filter: drop-shadow(0 0 4px rgba(80,250,123,.6)); }
  .edge-label { fill: rgba(255,255,255,.4); font-size: 11px; font-family: var(--font-mono, monospace); }
  .edge-label.bridge { fill: #50fa7b; font-weight: 700; }

  .node { position: absolute; transform: translate(-50%, -50%); display: grid; justify-items: center; gap: .15rem; width: 0; }
  .node-circle { width: 2.1rem; height: 2.1rem; border-radius: 50%; border: 2.5px solid; }
  .node-label { white-space: nowrap; font-size: .72rem; font-weight: 700; color: rgba(255,255,255,.92); font-family: var(--font-mono, monospace); }
  .node-sub { white-space: nowrap; font-size: .62rem; color: rgba(255,255,255,.5); }
  .node.hot .node-circle { box-shadow: 0 0 0 4px rgba(80,250,123,.25); animation: hot 1.5s infinite; }
  @keyframes hot { 0%,100% { box-shadow: 0 0 0 4px rgba(80,250,123,.25);} 50% { box-shadow: 0 0 0 9px rgba(80,250,123,0);} }
  .n-finding .node-circle { border-color: #ff79c6; background: rgba(255,121,198,.16); }
  .n-host .node-circle { border-color: #8be9fd; background: rgba(139,233,253,.16); }
  .n-user .node-circle { border-color: #bd93f9; background: rgba(189,147,249,.16); }
  .n-candidate .node-circle { border-color: #f5e663; background: rgba(245,230,99,.14); }
  .n-technique .node-circle { border-color: #50fa7b; background: rgba(80,250,123,.14); }

  .connect-callout { display: flex; align-items: center; gap: .6rem; margin-top: .9rem; padding: .7rem .9rem; border: 1px solid rgba(80,250,123,.45); border-radius: 8px; background: rgba(80,250,123,.07); color: rgba(255,255,255,.85); font-size: .88rem; line-height: 1.45; }
  .connect-callout :global(svg) { color: #50fa7b; flex-shrink: 0; }
  .legend { display: flex; flex-wrap: wrap; gap: .9rem; margin-top: .9rem; }
  .lg { font-size: .72rem; color: rgba(255,255,255,.6); display: inline-flex; align-items: center; gap: .35rem; }
  .lg::before { content: ""; width: .7rem; height: .7rem; border-radius: 50%; border: 2px solid; }
  .lg.n-finding::before { border-color: #ff79c6; } .lg.n-host::before { border-color: #8be9fd; }
  .lg.n-user::before { border-color: #bd93f9; } .lg.n-candidate::before { border-color: #f5e663; } .lg.n-technique::before { border-color: #50fa7b; }

  pre.code { background: rgba(12,12,18,.7); border: 1px solid rgba(98,114,164,.35); border-radius: 8px; padding: 1rem; overflow-x: auto; }
  pre.code code { background: none; color: rgba(255,255,255,.82); font-size: .82rem; line-height: 1.6; }
</style>
