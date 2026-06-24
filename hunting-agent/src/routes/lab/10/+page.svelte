<script lang="ts">
  import { fade } from "svelte/transition";
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

  // step: 0 nothing · 1 finding A projected · 2 finding B projected (connection visible)
  let step = $state(0);
  let cyError = $state("");

  const cypherLog = $derived.by(() => {
    const lines: { text: string; finding: string; reused: boolean }[] = [];
    if (step >= 1) projA.cypher.forEach((t) => lines.push({ text: t, finding: "df-a", reused: false }));
    if (step >= 2)
      projB.cypher.forEach((t, i) =>
        lines.push({ text: t, finding: "df-b", reused: i > 0 && aIds.has(projB.nodes[i].id) }),
      );
    return lines;
  });

  function display(node: ProjNode): string {
    if (node.type === "user") return node.label.replace(/^[^\\]*\\/, "");
    return node.label;
  }
  function skillOf(id: string): string {
    return id === "finding:df-a" ? EXAMPLE_FINDINGS[0].skillName : id === "finding:df-b" ? EXAMPLE_FINDINGS[1].skillName : "";
  }

  // Light Cypher syntax highlight. Input is deterministic (no user data); HTML-escaped first,
  // then keyword + string-literal spans — so the only tags reaching {@html} are ours.
  function highlightCypher(text: string): string {
    const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return esc
      .replace(/\b(MERGE|SET)\b/g, '<span class="cy-kw">$1</span>')
      .replace(/'[^']*'/g, (m) => `<span class="cy-str">${m}</span>`);
  }

  // ── Knowledge-graph rendering via Cytoscape.js (accurate edge routing + labels) ──
  const NODE_COLORS: Record<string, string> = {
    finding: "#ff79c6", host: "#8be9fd", user: "#bd93f9", candidate: "#f5e663", technique: "#50fa7b",
  };

  const cyStyle: unknown[] = [
    {
      selector: "node",
      style: {
        "background-color": "data(color)",
        label: "data(disp)",
        width: 36, height: 36,
        "border-width": 2, "border-color": "rgba(7,7,10,0.85)",
        color: "#f3f3f8",
        "font-family": "ui-monospace, monospace", "font-size": 12, "font-weight": 700,
        "text-valign": "bottom", "text-halign": "center", "text-margin-y": 8,
        "text-wrap": "wrap", "text-max-width": 180, "line-height": 1.3,
        "text-outline-width": 3, "text-outline-color": "#07070a",
      },
    },
    {
      selector: "edge",
      style: {
        width: 1.6,
        "line-color": "rgba(139,233,253,0.42)",
        "target-arrow-color": "rgba(139,233,253,0.6)",
        "target-arrow-shape": "triangle", "arrow-scale": 0.9,
        "curve-style": "bezier",
        label: "data(label)",
        "font-family": "ui-monospace, monospace", "font-size": 10,
        color: "rgba(255,255,255,0.72)",
        "text-background-color": "#07070a", "text-background-opacity": 0.9, "text-background-padding": 3,
        "text-rotation": "autorotate",
      },
    },
    // On hover, reveal the fuller label (findings show their skill) and draw above everything
    // so it never sits behind an edge label.
    { selector: "node.hover", style: { label: "data(full)", "z-index": 99, "border-color": "rgba(255,255,255,0.95)" } },
  ];

  // Build the FULL element set once (both findings, deduped), tagged with the step each appears at.
  function buildElements(): unknown[] {
    const seen = new Set<string>();
    const nodes: unknown[] = [];
    const addNodes = (proj: typeof projA, minStep: number) =>
      proj.nodes.forEach((n) => {
        if (seen.has(n.id)) return;
        seen.add(n.id);
        nodes.push({
          data: {
            id: n.id,
            disp: display(n),
            full: n.type === "finding" ? `${display(n)}\n${skillOf(n.id)}` : display(n),
            color: NODE_COLORS[n.type],
            minStep,
            shared: sharedIds.has(n.id) ? 1 : 0,
          },
        });
      });
    addNodes(projA, 1);
    addNodes(projB, 2);
    const edges: unknown[] = [];
    const addEdges = (proj: typeof projA, minStep: number) =>
      proj.edges.forEach((e) => {
        edges.push({
          data: {
            id: `${e.source}->${e.target}:${e.label}`,
            source: e.source, target: e.target, label: e.label,
            minStep, bridge: minStep === 2 && sharedIds.has(e.target) ? 1 : 0,
          },
        });
      });
    addEdges(projA, 1);
    addEdges(projB, 2);
    return [...nodes, ...edges];
  }

  // Reveal elements up to the current step, then reframe to the visible subset.
  function applyStep(cy: any, current: number) {
    cy.batch(() => {
      cy.elements().forEach((ele: any) => ele.style("display", ele.data("minStep") <= current ? "element" : "none"));
    });
    const vis = cy.elements(":visible");
    if (vis.length) cy.animate({ fit: { eles: vis, padding: 70 } }, { duration: 380 });
  }

  // Svelte action: mount Cytoscape into the container, react to `step`, clean up on unmount.
  function cyto(node: HTMLElement, current: number) {
    let cy: any;
    let latest = current;
    (async () => {
      try {
        const cytoscape: any = (await import("cytoscape")).default;
        const fcose: any = (await import("cytoscape-fcose")).default;
        cytoscape.use(fcose);
        cy = cytoscape({
          container: node,
          elements: buildElements(),
          style: cyStyle,
          layout: { name: "fcose", animate: false, randomize: true, quality: "proof", nodeRepulsion: 17000, idealEdgeLength: 200, gravity: 0.07, gravityRange: 4, nodeSeparation: 230, padding: 56 },
          minZoom: 0.25, maxZoom: 1.35, wheelSensitivity: 0.3,
        });
        cy.on("mouseover", "node", (e: any) => e.target.addClass("hover"));
        cy.on("mouseout", "node", (e: any) => e.target.removeClass("hover"));
        applyStep(cy, latest);
      } catch (err) {
        cyError = err instanceof Error ? err.message : String(err);
      }
    })();
    return {
      update(next: number) { latest = next; if (cy) applyStep(cy, next); },
      destroy() { cy?.destroy?.(); },
    };
  }

  const STEP_META = [
    { label: "Project Finding A (df-a) into the graph", caption: "Press to project the first detection finding — its typed object becomes Cypher, and the Cypher becomes nodes + edges." },
    { label: "Project Finding B (df-b) into the graph", caption: "A second, independent finding. Watch its own subgraph appear — but notice the host and user it MERGEs already exist." },
  ];
  const caption = $derived(step < 2 ? STEP_META[step].caption : "Both findings projected — MERGE reused the same Host and User, so df-a and df-b hang off the same two nodes.");
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
          {#each [1, 2] as n}
            <span class="dot" class:done={step >= n} class:current={step === n - 1}>{n}</span>
          {/each}
        </div>
        <div class="lab-actions">
          {#if step < 2}
            <button class="primary" onclick={() => (step += 1)}>{STEP_META[step].label}<ArrowRightIcon size={16} weight="bold" /></button>
          {/if}
          <button class="ghost" onclick={() => (step = 0)} disabled={step === 0}><ArrowCounterClockwiseIcon size={15} weight="bold" /> Reset</button>
        </div>
      </div>
      <p class="caption">{caption}</p>

      <div class="lab-stack">
        <!-- Graph on top — Cytoscape canvas (accurate edges + labels) -->
        <div class="graphwrap">
          <div class="graph" use:cyto={step}></div>
          {#if cyError}
            <p class="cy-error">Graph failed to render: {cyError}</p>
          {/if}
          <div class="legend">
            <span class="lg n-finding">finding</span>
            <span class="lg n-host">host</span>
            <span class="lg n-user">user</span>
            <span class="lg n-candidate">candidate</span>
            <span class="lg n-technique">technique</span>
            <span class="lg-hint">· hover a finding to see its skill</span>
          </div>
        </div>

        <!-- Cypher below -->
        <div class="cypher">
          <div class="cypher-head"><DatabaseIcon size={15} weight="duotone" /> Cypher emitted (deterministic — no model)</div>
          {#if cypherLog.length === 0}
            <p class="cypher-empty">Project a finding to see its Cypher.</p>
          {:else}
            <ol class="cypher-lines">
              {#each cypherLog as line}
                <li class="cy-{line.finding}" class:reused={line.reused} transition:fade>
                  <code>{@html highlightCypher(line.text)}</code>
                  {#if line.reused}<span class="reused-tag">↺ reused</span>{/if}
                </li>
              {/each}
            </ol>
          {/if}
        </div>
      </div>
    </section>

  {:else}
    <section class="panel prose">
      <h2>How the projection works</h2>
      <p>When a finding clears the gate, the deterministic write path projects it into the graph. There is <strong>no model</strong> here — it's pure code reading the finding's typed fields.</p>

      <h3>The projection</h3>
      <pre class="code"><code>{`function projectDetectionFinding(f: DetectionFinding) {
  // 1 · the finding itself
  MERGE (f:Finding {id: f.findingId}) SET f.skill=…, f.score=…
  // 2 · one node + one edge per entity it touches
  MERGE (h:Host {id: f.scope.host})            MERGE (f)-[:TARGETS]->(h)
  MERGE (u:User {id: f.scope.user})            MERGE (f)-[:INVOLVES]->(u)
  for each candidateId:  MERGE (c:Candidate …) MERGE (f)-[:BASED_ON]->(c)
  for each technique:    MERGE (t:Technique …) MERGE (f)-[:USES_TECHNIQUE]->(t)
}`}</code></pre>
      <p class="filehint">In the production engine this is <code>graph-projection.ts</code> (<code>projectDetectionFinding</code>); this lab ships a trimmed <code>finding-cypher.ts</code> shim with the same shape.</p>
      <p>One detail the labels above gloss for readability: the real engine does <strong>not</strong> create a Neo4j label per entity type. Every node is a generic <code>:Entity</code> and every edge a generic <code>:REL</code>; the semantic type is a <em>property</em> — <code>(:Entity &#123;type:'host'&#125;)</code>, <code>[:REL &#123;type:'targets'&#125;]</code>. The five canonical edge types are <code>targets</code>, <code>involves</code>, <code>based_on</code>, <code>uses_technique</code>, and <code>matches_campaign</code>. Pretty <code>:Host</code> / <code>:TARGETS</code> labels are a teaching aid only.</p>
      <p>And writes flow through this one deterministic path. Ad-hoc Cypher against the graph is <strong>read-only</strong> — conclusions enter the graph only as projected findings, never by hand-written <code>MERGE</code>.</p>

      <h3>Why <code>MERGE</code> is the whole trick</h3>
      <p><code>MERGE</code> means <em>“match if it exists, else create.”</em> It is <strong>idempotent</strong> and keyed by <code>id</code>. So when Finding B does <code>MERGE (h:Host &#123;id:'DEV-WS03'&#125;)</code>, it does <strong>not</strong> create a second host — it <em>reuses</em> the one Finding A already created. Both findings end up pointing at the <strong>same</strong> node. That shared node <em>is</em> the connection — discovered structurally, asserted by no one.</p>

      <h3>Why <code>SET</code> — and not just more braces</h3>
      <p>The <code>&#123;…&#125;</code> inside <code>MERGE</code> is the node's <strong>identity key</strong> — the property <code>MERGE</code> matches on. <code>SET</code> then writes the node's <strong>other attributes</strong> (<code>skill</code>, <code>verdict</code>, <code>score</code>). They are <em>not</em> interchangeable: fold those attributes into the braces and <code>MERGE</code> would have to match on <em>all</em> of them — so a finding whose score later changed would fail to match and <strong>create a duplicate</strong> node, breaking the very reuse this lab relies on. Keying <code>MERGE</code> on the stable <code>id</code> alone, then <code>SET</code>-ing the rest, is what lets the shared host/user be <em>reused</em> above; <code>SET</code> also means re-projecting a finding simply <strong>updates</strong> its attributes (last write wins). The idiom: <strong><code>MERGE</code> on the key, <code>SET</code> the rest.</strong></p>

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

  .lab-stack { display: grid; gap: 1.1rem; }

  /* ── Cypher panel ── */
  .cypher { border: 1px solid rgba(98,114,164,.4); border-radius: 8px; background: rgba(18,18,26,.7); overflow: hidden; }
  .cypher-head { display: flex; align-items: center; gap: .4rem; padding: .7rem .9rem; font-size: .85rem; color: #8be9fd; border-bottom: 1px solid rgba(98,114,164,.3); }
  .cypher-empty { color: rgba(255,255,255,.4); padding: 1.2rem .9rem; font-size: .85rem; }
  .cypher-lines { list-style: none; margin: 0; padding: .8rem; display: grid; gap: .75rem; }
  .cypher-lines li { display: flex; align-items: flex-start; gap: .6rem; padding-left: .7rem; border-left: 2px solid transparent; }
  .cypher-lines code { background: none; color: rgba(255,255,255,.88); font-size: .92rem; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
  .cy-df-a { border-left-color: #ff79c6; }
  .cy-df-b { border-left-color: #f5e663; }
  .cypher-lines li.reused { opacity: .5; }
  .cypher-lines :global(.cy-kw) { color: #ff79c6; font-weight: 700; }
  .cypher-lines :global(.cy-str) { color: #f1fa8c; }
  .reused-tag { flex-shrink: 0; font-size: .64rem; font-weight: 800; color: #50fa7b; border: 1px solid rgba(80,250,123,.5); border-radius: 999px; padding: .04rem .4rem; }

  /* ── Graph (Cytoscape canvas) ── */
  .graph { width: 100%; height: 560px; border: 1px solid rgba(98,114,164,.35); border-radius: 8px; background: radial-gradient(circle at 50% 55%, rgba(189,147,249,.06), transparent 62%), rgba(12,12,18,.6); }
  .cy-error { margin: .7rem 0 0; padding: .6rem .8rem; border: 1px solid rgba(255,85,85,.5); border-radius: 6px; background: rgba(255,85,85,.08); color: #ff7b7b; font-size: .85rem; }

  .legend { display: flex; flex-wrap: wrap; gap: .9rem; margin-top: .9rem; }
  .lg { font-size: .72rem; color: rgba(255,255,255,.6); display: inline-flex; align-items: center; gap: .35rem; }
  .lg::before { content: ""; width: .7rem; height: .7rem; border-radius: 50%; border: 2px solid; }
  .lg.n-finding::before { border-color: #ff79c6; } .lg.n-host::before { border-color: #8be9fd; }
  .lg.n-user::before { border-color: #bd93f9; } .lg.n-candidate::before { border-color: #f5e663; } .lg.n-technique::before { border-color: #50fa7b; }
  .lg-hint { font-size: .72rem; color: rgba(255,255,255,.4); }

  pre.code { background: rgba(12,12,18,.7); border: 1px solid rgba(98,114,164,.35); border-radius: 8px; padding: 1rem; overflow-x: auto; }
  pre.code code { background: none; color: rgba(255,255,255,.82); font-size: .82rem; line-height: 1.6; }
</style>
