<script lang="ts">
  // Renders a Subgraph with Cytoscape + fcose — the same engine as Lab 10, so edges
  // actually connect and labels don't pile up. The graph is expected to be SCOPED by the
  // caller (Lab 11 passes the true-positive campaign), so the layout stays legible.
  let { graph = { nodes: [], edges: [] } }: {
    graph?: {
      nodes: Array<{ id: string; label: string; type: string }>;
      edges: Array<{ source: string; target: string; label: string }>;
    };
  } = $props();

  let cyError = $state("");

  const NODE_COLORS: Record<string, string> = {
    finding: "#ff79c6", candidate: "#ff79c6", host: "#8be9fd", user: "#bd93f9", process: "#ffb86c", ip: "#50fa7b",
  };

  const cyStyle: unknown[] = [
    {
      selector: "node",
      style: {
        "background-color": "data(color)",
        label: "data(disp)",
        width: 38, height: 38,
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
    // On hover, reveal the fuller "type: label" and draw above everything so it never sits
    // behind an edge label.
    { selector: "node.hover", style: { label: "data(full)", "z-index": 99, "border-color": "rgba(255,255,255,0.95)" } },
  ];

  const LAYOUT = {
    name: "fcose", animate: false, randomize: true, quality: "proof",
    nodeRepulsion: 26000, idealEdgeLength: 200, gravity: 0.05, gravityRange: 5,
    nodeSeparation: 300, numIter: 4000, padding: 60,
  };

  function buildElements(g: typeof graph): unknown[] {
    const ids = new Set(g.nodes.map((n) => n.id));
    const nodes = g.nodes.map((n) => ({
      data: {
        // Strip a "DOMAIN\" prefix for the on-canvas label (e.g. NORTHWIND\jane.roberts ->
        // jane.roberts) so the widest label stops colliding with edge labels in the centre.
        // The full value is kept on hover.
        id: n.id,
        disp: n.label.includes("\\") ? n.label.slice(n.label.lastIndexOf("\\") + 1) : n.label,
        full: `${n.type}: ${n.label}`,
        color: NODE_COLORS[n.type] ?? "#b6b6c6",
      },
    }));
    const edges = g.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ data: { id: `${e.source}->${e.target}:${e.label}`, source: e.source, target: e.target, label: e.label } }));
    return [...nodes, ...edges];
  }

  // Svelte action: mount Cytoscape, rebuild + relayout when the graph prop changes.
  function cyto(node: HTMLElement, g: typeof graph) {
    let cy: any;
    const refit = () => { const els = cy.elements(); if (els.length) cy.fit(els, 60); };
    (async () => {
      try {
        const cytoscape: any = (await import("cytoscape")).default;
        const fcose: any = (await import("cytoscape-fcose")).default;
        cytoscape.use(fcose);
        cy = cytoscape({
          container: node,
          elements: buildElements(g),
          style: cyStyle,
          layout: LAYOUT,
          minZoom: 0.25, maxZoom: 1.6, wheelSensitivity: 0.3,
        });
        cy.on("mouseover", "node", (e: any) => e.target.addClass("hover"));
        cy.on("mouseout", "node", (e: any) => e.target.removeClass("hover"));
        refit();
      } catch (err) {
        cyError = err instanceof Error ? err.message : String(err);
      }
    })();
    return {
      update(next: typeof graph) {
        if (!cy) return;
        cy.elements().remove();
        cy.add(buildElements(next));
        cy.layout(LAYOUT).run();
        refit();
      },
      destroy() { cy?.destroy?.(); },
    };
  }
</script>

<div class="graphwrap">
  <div class="graph" use:cyto={graph}></div>
  {#if cyError}<p class="cy-error">Graph failed to render: {cyError}</p>{/if}
</div>

<style>
  .graphwrap { position: relative; }
  .graph {
    width: 100%; height: 620px;
    border: 1px solid rgba(98,114,164,.35); border-radius: 8px;
    background: radial-gradient(circle at 50% 55%, rgba(189,147,249,.06), transparent 62%), rgba(12,12,18,.6);
  }
  .cy-error { color: #ff8b8b; font-family: ui-monospace, monospace; font-size: .85rem; margin-top: .5rem; }
</style>
