<script lang="ts">
  import { parseMarkdown, renderInline } from "$lib/markdown";

  let { source = "" }: { source?: string } = $props();
  // parseMarkdown + renderInline HTML-escape first, so {@html} only emits tags this util generates.
  let blocks = $derived(parseMarkdown(source));
</script>

<div class="markdown-body">
  {#each blocks as block}
    {#if block.kind === "heading"}
      {#if block.level <= 2}
        <h3>{@html renderInline(block.text)}</h3>
      {:else}
        <h4>{@html renderInline(block.text)}</h4>
      {/if}
    {:else if block.kind === "paragraph"}
      <p>{@html renderInline(block.text)}</p>
    {:else if block.kind === "list"}
      <ul>
        {#each block.items as item}<li>{@html renderInline(item)}</li>{/each}
      </ul>
    {:else if block.kind === "table"}
      <table>
        <thead><tr>{#each block.headers as h}<th>{@html renderInline(h)}</th>{/each}</tr></thead>
        <tbody>
          {#each block.rows as row}<tr>{#each row as cell}<td>{@html renderInline(cell)}</td>{/each}</tr>{/each}
        </tbody>
      </table>
    {:else if block.kind === "code"}
      <pre><code>{block.text}</code></pre>
    {/if}
  {/each}
</div>

<style>
  .markdown-body { display: grid; gap: .7rem; color: var(--dracula-fg); font-size: .92rem; line-height: 1.65; }
  .markdown-body :global(strong) { color: var(--dracula-fg); font-weight: 800; }
  .markdown-body :global(em) { color: var(--dracula-yellow, #f1fa8c); font-style: normal; }
  .markdown-body :global(code) {
    font-family: var(--font-mono);
    font-size: .85em;
    color: var(--dracula-cyan);
    background: rgba(139, 233, 253, .08);
    padding: .05rem .3rem;
    border-radius: 4px;
  }
  h3 { margin: .2rem 0 0; color: var(--dracula-purple); font-family: var(--font-heading); font-size: 1rem; }
  h4 { margin: .2rem 0 0; color: var(--dracula-purple); font-family: var(--font-heading); font-size: .88rem; }
  p { margin: 0; }
  ul { margin: 0; padding-left: 1.2rem; display: grid; gap: .3rem; }
  li { color: var(--dracula-fg); }
  table { border-collapse: collapse; width: 100%; font-size: .85rem; }
  th, td { border: 1px solid rgba(98, 114, 164, .4); padding: .4rem .55rem; text-align: left; }
  th { color: var(--dracula-purple); font-family: var(--font-heading); }
  pre {
    margin: 0; padding: .7rem .85rem; border-radius: 8px; overflow-x: auto;
    background: rgba(25, 26, 33, .82); border: 1px solid rgba(98, 114, 164, .42);
  }
  pre code { background: none; color: var(--dracula-fg); padding: 0; }
</style>
