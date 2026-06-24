<script lang="ts">
  // The corpus browser shows each report PRE-CHUNK — the whole, original case a human analyst
  // wrote (one Findings, one Verdict, no mid-sentence cuts). Chunking is what the RETRIEVER does;
  // that is shown in the Retrieved Chunks panel and the Code tab, not here. reports.json is built
  // from data/rag/corpus/*.md by scripts/build-corpus-reports.mjs.
  let { reports = [] }: {
    reports?: Array<{
      id: string;
      title: string;
      verdict: string;
      tags: string[];
      sections: Array<{ heading: string; text: string }>;
    }>;
  } = $props();
</script>

<details class="corpus" open>
  <summary class="corpus-head">
    <span class="chevron" aria-hidden="true">▸</span>
    <h2>Prior Investigation Corpus</h2>
    <span class="count">{reports.length} reports</span>
  </summary>

  <div class="corpus-body">
    <p class="hint">This is the library RAG searches — each is a complete prior investigation. Click any report to read its full, original text. (The retriever doesn't embed whole reports; it splits each into ~150-token chunks, so a search returns the relevant <em>passage</em> — run a query above to see which chunks surface.)</p>
    {#each reports as report}
      <details class="report">
        <summary class="report-head">
          <span class="chevron" aria-hidden="true">▸</span>
          <span class="report-id">{report.id}</span>
          <span class="report-title">{report.title}</span>
          <small class="report-meta">{report.verdict} | {report.tags.slice(0, 5).join(", ")}</small>
        </summary>
        <div class="report-body">
          {#each report.sections as sec}
            <div class="sec">
              <span class="sec-label">{sec.heading}</span>
              <p class="sec-text">{sec.text}</p>
            </div>
          {/each}
        </div>
      </details>
    {/each}
  </div>
</details>

<style>
  .corpus {
    border: 1px solid rgba(98, 114, 164, 0.55);
    border-radius: 8px;
    background: rgba(33, 34, 44, 0.9);
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.22);
  }

  .corpus-head {
    display: flex;
    align-items: center;
    gap: .6rem;
    padding: 1rem;
    cursor: pointer;
    list-style: none;
    user-select: none;
  }
  .corpus-head::-webkit-details-marker { display: none; }
  .corpus[open] > .corpus-head { border-bottom: 1px solid rgba(98, 114, 164, 0.45); }
  .corpus-head h2 {
    margin: 0;
    color: var(--dracula-pink);
    font-family: var(--font-heading);
    font-size: 1rem;
  }
  .count {
    margin-left: auto;
    color: var(--dracula-muted);
    font-family: var(--font-heading);
    font-size: .78rem;
  }

  .chevron {
    display: inline-block;
    flex: none;
    color: var(--dracula-purple);
    font-size: .8rem;
    transition: transform .15s ease;
  }
  details[open] > summary > .chevron { transform: rotate(90deg); }

  .corpus-body {
    max-height: 34rem;
    overflow: auto;
    padding: 1rem;
    display: grid;
    gap: .6rem;
  }
  .hint {
    margin: 0 0 .25rem;
    color: var(--dracula-comment);
    font-size: .82rem;
    line-height: 1.5;
  }

  .report {
    border: 1px solid rgba(68, 71, 90, 0.88);
    border-radius: 8px;
    background: rgba(25, 26, 33, 0.58);
    transition: border-color .15s ease;
  }
  .report:hover { border-color: rgba(189, 147, 249, 0.5); }
  .report-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: .35rem .55rem;
    padding: .85rem;
    cursor: pointer;
    list-style: none;
    user-select: none;
  }
  .report-head::-webkit-details-marker { display: none; }
  .report-id {
    color: var(--dracula-yellow);
    font-family: var(--font-heading);
    font-size: .82rem;
  }
  .report-title {
    color: var(--dracula-fg);
    font-weight: 650;
  }
  .report-meta {
    flex-basis: 100%;
    margin: 0;
    color: var(--dracula-muted);
    line-height: 1.45;
  }

  .report-body {
    display: grid;
    gap: .85rem;
    padding: .8rem .85rem .9rem;
    border-top: 1px solid rgba(68, 71, 90, 0.6);
  }
  .sec { display: grid; gap: .25rem; }
  .sec-label {
    font-family: var(--font-heading);
    font-size: .7rem;
    text-transform: uppercase;
    letter-spacing: .04em;
    color: var(--dracula-purple);
  }
  .sec-text {
    margin: 0;
    color: var(--dracula-fg);
    font-size: .85rem;
    line-height: 1.6;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
</style>
