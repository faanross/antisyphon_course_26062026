<script lang="ts">
  import chunks from "$lib/data/workshop/rag/chunks.json";
  import CorpusBrowser from "$lib/components/lab07/CorpusBrowser.svelte";
  import RAGResultsPanel from "$lib/components/lab07/RAGResultsPanel.svelte";
  import MarkdownView from "$lib/components/MarkdownView.svelte";
  import CursorClickIcon from "phosphor-svelte/lib/CursorClickIcon";
  import VectorThreeIcon from "phosphor-svelte/lib/VectorThreeIcon";
  import MagnifyingGlassIcon from "phosphor-svelte/lib/MagnifyingGlassIcon";
  import RobotIcon from "phosphor-svelte/lib/RobotIcon";
  import BooksIcon from "phosphor-svelte/lib/BooksIcon";
  import ScissorsIcon from "phosphor-svelte/lib/ScissorsIcon";
  import DatabaseIcon from "phosphor-svelte/lib/DatabaseIcon";
  import ScalesIcon from "phosphor-svelte/lib/ScalesIcon";
  import FunnelIcon from "phosphor-svelte/lib/FunnelIcon";
  import ArrowRightIcon from "phosphor-svelte/lib/ArrowRightIcon";

  type Hit = {
    chunk_id: string;
    source_report: string;
    report_title: string;
    verdict: string;
    section: string;
    score: number;
    text: string;
  };

  let activeTab = $state<"instructions" | "lab" | "code">("instructions");
  let query = $state("previous cases where HTTPS beaconing was used");
  let busy = $state(false);
  let errorMsg = $state("");

  // Staged RAG pipeline state — filled in as the NDJSON stream arrives.
  type Stage = "idle" | "embedding" | "retrieving" | "augmenting" | "generating" | "done";
  const STAGE_ORDER: Stage[] = ["idle", "embedding", "retrieving", "augmenting", "generating", "done"];
  let stage = $state<Stage>("idle");
  let embedModel = $state("");
  let hits = $state<Hit[]>([]);
  let contextText = $state("");
  let synthesis = $state("");
  let synthModel = $state("");

  let started = $derived(stage !== "idle");
  const isActive = (s: Stage) => stage === s;
  const isDone = (s: Stage) => STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf(s);

  async function run(value: string) {
    busy = true;
    errorMsg = "";
    hits = [];
    contextText = "";
    synthesis = "";
    synthModel = "";
    stage = "embedding";
    try {
      const response = await fetch("/api/lab07/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: value }),
      });
      if (!response.ok || !response.body) throw new Error(`Request failed (HTTP ${response.status}).`);

      // Read the NDJSON stream line by line and drive the pipeline stages.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value: chunk, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "embed") { embedModel = ev.model; stage = "retrieving"; }
          else if (ev.type === "retrieved") { hits = ev.hits; stage = "augmenting"; }
          else if (ev.type === "context") { contextText = ev.context; stage = "generating"; }
          else if (ev.type === "model-start") { stage = "generating"; }
          else if (ev.type === "token") { synthesis += ev.value; }
          else if (ev.type === "done") { synthesis = ev.synthesis || synthesis; synthModel = ev.model; stage = "done"; }
          else if (ev.type === "error") { errorMsg = ev.message; }
        }
      }
    } catch (error) {
      errorMsg = error instanceof Error ? error.message : "Could not reach the RAG endpoint.";
    } finally {
      busy = false;
      if (errorMsg) stage = "idle";
    }
  }
</script>

<svelte:head><title>Lab 08 | RAG</title></svelte:head>

<main>
  <header>
    <p class="eyebrow">Lab 08</p>
    <h1>RAG Prior Investigations</h1>
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
          <span class="cv-eyebrow">Lab 08 · Walkthrough</span>
          <h2>Hunt with precedent — let past cases inform this one</h2>
          <p>
            This lab gives the agent a memory of <strong>prior investigations</strong>. Instead of
            naming the context files yourself, you describe the situation in plain language; the
            system searches a library of past reports by <strong>meaning</strong>, pulls the closest
            matches, and hands them to the model as precedent. Your job is to run a query, see which
            past cases surface, and watch how they shape the answer.
          </p>
        </header>

        <ol class="flow">
          <!-- Step 1 -->
          <li class="flow-step" style="--d: 0ms">
            <span class="flow-rail"><BooksIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">1 · Browse the prior-investigation corpus</span>
                <span class="flow-where">Lab tab · Prior Investigation Corpus</span>
              </div>
              <p>
                Go to the <strong>Lab</strong> tab. At the top, the
                <strong>Prior Investigation Corpus</strong> lists the past reports the agent can draw
                on — each with its verdict and tags. This is the library RAG searches:
                <strong>expand any report</strong> to read its full text (the same content the retriever
                embeds and returns), so you know what precedent is available.
              </p>
            </div>
          </li>

          <!-- Step 2 -->
          <li class="flow-step" style="--d: 110ms">
            <span class="flow-rail"><MagnifyingGlassIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">2 · Describe your situation and run a query</span>
                <span class="flow-where">Ask the corpus · Run RAG query</span>
              </div>
              <p>
                In the <strong>Ask the corpus</strong> box, describe what you're investigating in plain
                language — symptoms, hosts, behaviour — then hit <strong>Run RAG query</strong>. You're not
                typing keywords or filenames; you're describing the case, and the system finds the
                most similar past work by meaning.
              </p>
              <div class="gd-egs">
                <span class="gd-eg">CrowdFalcon EDR heartbeat beacon false positive 10.42.10.0/24</span>
                <span class="gd-eg">regular HTTPS beacon to an unfamiliar domain, no known business use</span>
              </div>
            </div>
          </li>

          <!-- Step 3 -->
          <li class="flow-step" style="--d: 220ms">
            <span class="flow-rail"><FunnelIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">3 · Read the retrieved chunks</span>
                <span class="flow-where">Retrieved Chunks</span>
              </div>
              <p>
                The <strong>Retrieved Chunks</strong> panel shows the top matches — the closest prior
                cases the search surfaced. Each lists its <strong>source report</strong>, the section,
                a similarity <strong>score</strong>, and the past <strong>verdict</strong>. Higher
                scores mean a closer match in meaning. This is the precedent the model is about to see.
              </p>
            </div>
          </li>

          <!-- Step 4 -->
          <li class="flow-step" style="--d: 330ms">
            <span class="flow-rail"><RobotIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">4 · Read the synthesis</span>
                <span class="flow-where">Generate — grounded answer</span>
              </div>
              <p>
                Stage 4 (<strong>Generate — grounded answer</strong>) is the model's answer — a real model call, written
                <em>using the retrieved cases as precedent</em>. Notice how it references the prior
                investigations rather than reasoning from scratch: that's retrieval feeding generation.
              </p>
            </div>
          </li>

          <!-- Step 5 -->
          <li class="flow-step" style="--d: 440ms">
            <span class="flow-rail"><ScalesIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">5 · Compare evidence, then go deeper</span>
                <span class="flow-where">Code tab</span>
              </div>
              <p>
                Precedent is not a verdict — try a query whose details <em>differ</em> from the closest
                case and watch the synthesis weigh the evidence rather than blindly copy the old
                conclusion. When you're ready, the <strong>Code</strong> tab walks how embeddings,
                cosine search, and injection actually work.
              </p>
            </div>
          </li>
        </ol>

        <aside class="cv-callout">
          <BooksIcon size={22} weight="duotone" />
          <p>
            <strong>Why retrieval helps here:</strong> often you don't know in advance which past
            case is relevant. RAG lets the agent find precedent by relevance across a large, growing
            body of prior work — so its judgement is grounded in what the team has already learned,
            not invented fresh each time.
          </p>
        </aside>
      </div>
    </div>
  {:else if activeTab === "lab"}
  <div class="lab-stack">
    <CorpusBrowser chunks={chunks} />

    <!-- Query input only — the answer renders in stage 4 of the pipeline below. -->
    <section class="ask-card">
      <h2>Ask the corpus</h2>
      <p class="ask-note">Ask in plain language. RAG finds the most relevant prior cases and answers grounded in them — watch it work in stages below.</p>
      <textarea bind:value={query} rows="2" placeholder="e.g. previous cases where HTTPS beaconing was used"></textarea>
      <button class="ask-btn" onclick={() => run(query)} disabled={busy || !query.trim()}>
        {busy ? "Running…" : "Run RAG query"}
      </button>
    </section>

    {#if errorMsg}
      <p class="rag-error">{errorMsg}</p>
    {/if}

    {#if started}
      <ol class="pipeline">
        <!-- 1 · EMBED -->
        <li class="stage" class:active={isActive("embedding")} class:done={isDone("embedding")}>
          <div class="stage-head"><span class="stage-n">1</span> Embed — your question becomes a vector</div>
          <p class="stage-note">The query is encoded into a 768-number vector with <code>{embedModel || "nomic-embed-text"}</code> — the same model the corpus was indexed with. Meaning is compared as distance in this shared space.</p>
          <div class="embed-viz">
            <code class="q">"{query}"</code>
            <ArrowRightIcon size={16} weight="bold" />
            <span class="vec">[ 0.02, -0.14, 0.08, … ] · 768 dims</span>
          </div>
        </li>

        <!-- 2 · RETRIEVE -->
        <li class="stage" class:active={isActive("retrieving")} class:done={isDone("retrieving")}>
          <div class="stage-head"><span class="stage-n">2</span> Retrieve — the nearest prior cases</div>
          <p class="stage-note">Cosine similarity scores the query vector against all 96 chunks; the top 5 (higher score = closer) are kept. This is the <strong>R</strong> in RAG — pure vector math, no model yet. (We scan a flat in-memory index here, not a vector database — the <strong>Code tab → E</strong> explains why, and when you'd use a real one.)</p>
          {#if hits.length}
            <RAGResultsPanel {hits} />
          {:else}
            <p class="stage-wait">Searching…</p>
          {/if}
        </li>

        <!-- 3 · AUGMENT -->
        <li class="stage" class:active={isActive("augmenting")} class:done={isDone("augmenting")}>
          <div class="stage-head"><span class="stage-n">3</span> Augment — build the prompt</div>
          <p class="stage-note">The retrieved snippets are pasted into the prompt alongside the case's standing context (asset, user, policy and prior-incident layers). The model sees <strong>these</strong> — not all 96 corpus chunks — which is what keeps the answer grounded.</p>
          {#if contextText}
            <details class="ctx">
              <summary>Show the injected context ({contextText.length.toLocaleString()} chars)</summary>
              <pre>{contextText}</pre>
            </details>
          {:else}
            <p class="stage-wait">Assembling…</p>
          {/if}
        </li>

        <!-- 4 · GENERATE -->
        <li class="stage" class:active={isActive("generating")} class:done={isDone("generating")}>
          <div class="stage-head">
            <span class="stage-n">4</span> Generate — grounded answer
            {#if synthModel}<span class="model-tag">{synthModel}</span>{/if}
          </div>
          <p class="stage-note">The model writes the answer grounded in the retrieved precedent — the <strong>G</strong>. It streams in as it's generated.</p>
          {#if synthesis}
            <div class="answer"><MarkdownView source={synthesis} /></div>
          {:else if isActive("generating")}
            <p class="stage-wait">Generating… <span class="hint">the model is reading the retrieved cases — this can take a few seconds</span></p>
          {:else}
            <p class="stage-wait">Waiting for retrieval…</p>
          {/if}
        </li>
      </ol>
    {/if}
  </div>
  {:else}
    <!-- ═══════════════════════════════════════════════════ -->
    <!-- CODE VIEW  (architectural reference, non-interactive)-->
    <!-- ═══════════════════════════════════════════════════ -->
    <div class="code-view">
      <div class="code-inner">
        <!-- Intro -->
        <header class="cv-hero">
          <span class="cv-eyebrow">Under the Hood</span>
          <h2>How the agent recalls prior investigations</h2>
          <p>
            Optional reading for the curious. In Lab 07 the skill named the exact context files it
            needed. But often you <em>don't know in advance</em> which past case is relevant. RAG —
            Retrieval-Augmented Generation — fixes that: it searches a library of prior
            investigations by <strong>meaning</strong>, pulls the closest matches, and injects them
            so the model can answer with precedent. This is a real model call.
          </p>
          <div class="cv-mental-model">
            <MagnifyingGlassIcon size={20} weight="duotone" />
            <span>your query</span>
            <span class="cv-mm-sep">→</span>
            <BooksIcon size={20} weight="duotone" />
            <span>find similar past cases</span>
            <span class="cv-mm-sep">→</span>
            <RobotIcon size={20} weight="duotone" />
            <span>synthesize with precedent</span>
          </div>
        </header>

        <!-- A · Journey -->
        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">A</span> The journey of one query<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">
            The library was indexed once, ahead of time. Each query then embeds, searches, and
            synthesizes — only the last step calls the model.
          </p>

          <ol class="flow">
            <li class="flow-step" style="--d: 0ms">
              <span class="flow-rail"><CursorClickIcon size={22} weight="duotone" /></span>
              <div class="flow-body">
                <div class="flow-top"><span class="flow-title">You ask a question</span><span class="flow-where">browser</span></div>
                <p>A free-text query — describing the situation you're investigating — is posted to the server.</p>
              </div>
            </li>
            <li class="flow-step" style="--d: 90ms">
              <span class="flow-rail"><VectorThreeIcon size={22} weight="duotone" /></span>
              <div class="flow-body">
                <div class="flow-top"><span class="flow-title">Embed the query</span><span class="flow-where">server · rag.ts → embeddings.ts</span></div>
                <p>The query text is turned into a <strong>768-number vector</strong> — a point in "meaning space" — using the <strong>same embedding model the library was built with</strong> (<code>nomic-embed-text</code>, served locally by Ollama).</p>
              </div>
            </li>
            <li class="flow-step" style="--d: 180ms">
              <span class="flow-rail"><MagnifyingGlassIcon size={22} weight="duotone" /></span>
              <div class="flow-body">
                <div class="flow-top"><span class="flow-title">Search the store</span><span class="flow-badge">the retrieval</span><span class="flow-where">server · rag.ts</span></div>
                <p><code>queryPriorInvestigations()</code> compares the query vector against all <strong>96 stored chunks</strong> by cosine similarity and keeps the <strong>top 5</strong> — the closest precedent.</p>
              </div>
            </li>
            <li class="flow-step" style="--d: 270ms">
              <span class="flow-rail"><RobotIcon size={22} weight="duotone" /></span>
              <div class="flow-body">
                <div class="flow-top"><span class="flow-title">Inject &amp; synthesize</span><span class="flow-where">server · demo.ts · providers/*</span></div>
                <p>The retrieved chunks are injected into the prompt and the model synthesizes an answer — instructed to use the prior cases as precedent, but to <em>compare evidence before borrowing a verdict</em>.</p>
              </div>
            </li>
          </ol>
        </details>

        <!-- B · How retrieval works -->
        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">B</span> How retrieval works<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">
            Two timelines: the library is embedded <em>once</em>; every query is matched against it.
          </p>

          <div class="rag">
            <div class="rag-lane">
              <span class="rag-when">indexed once</span>
              <div class="rag-flow">
                <span class="rag-node"><BooksIcon size={16} weight="duotone" />12 reports</span>
                <ArrowRightIcon size={13} weight="bold" />
                <span class="rag-node"><ScissorsIcon size={16} weight="duotone" />96 chunks</span>
                <ArrowRightIcon size={13} weight="bold" />
                <span class="rag-node"><VectorThreeIcon size={16} weight="duotone" />768-d vectors</span>
                <ArrowRightIcon size={13} weight="bold" />
                <span class="rag-node"><DatabaseIcon size={16} weight="duotone" />vectors.bin</span>
              </div>
            </div>
            <div class="rag-lane rag-live">
              <span class="rag-when">every query</span>
              <div class="rag-flow">
                <span class="rag-node"><MagnifyingGlassIcon size={16} weight="duotone" />query → vector</span>
                <ArrowRightIcon size={13} weight="bold" />
                <span class="rag-node">cosine vs 96</span>
                <ArrowRightIcon size={13} weight="bold" />
                <span class="rag-node rag-hit"><FunnelIcon size={16} weight="duotone" />top 5</span>
              </div>
            </div>
          </div>
          <p class="cv-note">
            "Closest by cosine" means most similar in meaning — so a query about an EDR heartbeat
            false positive surfaces the past report about that exact pattern, even if it shares no
            keywords.
          </p>
        </details>

        <!-- C · Four ideas -->
        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">C</span> Four ideas worth understanding<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <div class="cv-cards">
            <article class="cv-card">
              <div class="cv-card-head"><MagnifyingGlassIcon size={26} weight="duotone" /><h4>Retrieve, then generate</h4></div>
              <p>RAG is two moves: <em>search</em> a knowledge store for relevant pieces, then let the model <em>generate</em> grounded in them. Lab 07 you named the files; here the system finds them by meaning.</p>
            </article>
            <article class="cv-card">
              <div class="cv-card-head"><VectorThreeIcon size={26} weight="duotone" /><h4>Embeddings turn text into geometry</h4></div>
              <p>Each chunk becomes a 768-number vector; similar meaning lands nearby. Similarity is just the cosine angle between two vectors. This lab runs a <strong>real local embedding model</strong> (<code>nomic-embed-text</code> via Ollama) — no external API, but you run it yourself.</p>
            </article>
            <article class="cv-card">
              <div class="cv-card-head"><ScissorsIcon size={26} weight="duotone" /><h4>Chunking makes retrieval precise</h4></div>
              <p>Reports are split into ~150-token overlapping chunks, so a search returns the <em>relevant paragraph</em>, not a whole document — tighter, more useful context.</p>
            </article>
            <article class="cv-card">
              <div class="cv-card-head"><ScalesIcon size={26} weight="duotone" /><h4>Precedent is not a verdict</h4></div>
              <p>The model is told to use prior cases as precedent but compare the actual evidence before borrowing a conclusion. Retrieval <em>informs</em> the judgement; it doesn't replace it.</p>
            </article>
          </div>
        </details>

        <!-- D · File tree -->
        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">D</span> Where each piece lives<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">The prebuilt index is data; the retrieval logic is one small framework file.</p>
          <pre class="cv-tree"><code><span class="tr-dir">hunting-agent/</span>
│
├─ <span class="tr-dir">data/rag/</span>                     <span class="tr-cm">← the prebuilt index (loaded at query time)</span>
│  ├─ <span class="tr-dir">corpus/</span>                    <span class="tr-cm">← the 12 prior-investigation reports</span>
│  ├─ <span class="tr-file">chunks.json</span>              <span class="tr-cm">← 96 chunks + metadata (source, verdict, tags)</span>
│  ├─ <span class="tr-file">vectors.bin</span>              <span class="tr-cm">← 96 × 768 float32 vectors (row-major)</span>
│  └─ <span class="tr-file">store-meta.json</span>          <span class="tr-cm">← model, dimensions, chunk counts</span>
│
└─ <span class="tr-dir">src/</span>
   ├─ <span class="tr-dir">routes/api/lab07/query/</span>
   │  └─ <span class="tr-file">+server.ts</span>           <span class="tr-cm">← endpoint → runRagInvestigation()</span>
   └─ <span class="tr-dir">framework/</span>
      ├─ <span class="tr-file">demo.ts</span>              <span class="tr-cm">← runRagInvestigation(): embed → retrieve → augment → stream</span>
      ├─ <span class="tr-file">rag.ts</span>               <span class="tr-cm">← cosine search over the index · build context</span>
      └─ <span class="tr-file">embeddings.ts</span>        <span class="tr-cm">← real nomic-embed-text call (Ollama), 768-d, L2-normalized</span></code></pre>
        </details>

        <!-- E · The vector store: workshop vs production -->
        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">E</span> The vector store: workshop vs. production<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">
            In the slides we teach RAG with a <strong>vector database</strong> (e.g. ChromaDB) — but this lab
            deliberately doesn't use one. The retrieval you watched is a <strong>flat in-memory scan</strong>:
            load <code>vectors.bin</code>, compute cosine against all 96 vectors, keep the top 5. No DB, no index.
          </p>
          <div class="cv-cards">
            <article class="cv-card">
              <div class="cv-card-head"><DatabaseIcon size={26} weight="duotone" /><h4>Why a flat scan here</h4></div>
              <p><strong>Nothing extra to install</strong> beyond Ollama. <strong>Exact</strong> — it compares every vector, so results are ground truth, not approximate. And it keeps the lesson <strong>honest</strong>: you can see retrieval is just cosine math (Stage 2), not magic behind a DB API. At 96 vectors a full scan is sub-millisecond.</p>
            </article>
            <article class="cv-card">
              <div class="cv-card-head"><VectorThreeIcon size={26} weight="duotone" /><h4>Why production uses a vector DB</h4></div>
              <p>A flat scan is <em>O(n)</em> per query — fine for hundreds, hopeless for millions. A vector DB (ChromaDB, pgvector, Qdrant, FAISS) builds an <strong>approximate-nearest-neighbour index</strong> (e.g. HNSW) that finds close matches without scanning everything — and adds what a living corpus needs.</p>
            </article>
          </div>
          <p class="cv-note"><strong>When to reach for a real vector DB in your own RAG:</strong></p>
          <ul class="cv-list">
            <li><strong>Scale</strong> — tens of thousands of vectors and up, where scanning every query gets too slow. Below that, a flat scan (or <code>sqlite-vec</code>) is often plenty.</li>
            <li><strong>Live updates</strong> — add / update / delete documents without rebuilding the whole index file.</li>
            <li><strong>Metadata filtering &amp; hybrid search</strong> — "nearest vectors <em>where</em> verdict = malicious", or blend keyword + semantic ranking.</li>
            <li><strong>Persistence &amp; serving</strong> — a durable store many processes/users query concurrently, not a file loaded into one process.</li>
          </ul>
          <p class="cv-note">
            The trade is approximate-but-fast vs. exact-but-linear, plus a service to run. For 96 chunks the flat
            scan wins on every axis except the one that doesn't apply yet — scale. The <strong>concepts are
            identical</strong>: embed, measure cosine similarity, take the top matches.
          </p>
        </details>

        <!-- Callout -->
        <aside class="cv-callout">
          <BooksIcon size={22} weight="duotone" />
          <p>
            <strong>Static injection or retrieval?</strong> Use Lab 07's explicit injection when you
            know exactly which context applies (this host's record, this policy). Reach for RAG when
            you don't — when the useful precedent is somewhere in a large, growing body of past work
            and has to be <em>found</em> by relevance. Most real agents use both.
          </p>
        </aside>
      </div>
    </div>
  {/if}
</main>

<style>
  main {
    width: min(1440px, calc(100% - 2rem));
    min-height: 100vh;
    margin: 0 auto;
    padding: 2rem 0 3rem;
    color: var(--dracula-fg);
  }

  header {
    margin-bottom: 1rem;
    padding: 1rem;
    border: 1px solid rgba(98, 114, 164, 0.5);
    border-radius: 8px;
    background: rgba(33, 34, 44, 0.84);
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.28);
  }

  .eyebrow {
    margin: 0 0 .35rem;
    color: var(--dracula-purple);
    font-family: var(--font-heading);
    font-size: .78rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    color: var(--brand-yellow);
    font-family: var(--font-heading);
    font-size: clamp(2.1rem, 4vw, 4rem);
    line-height: 1.02;
  }

  .lab-stack {
    display: grid;
    gap: 1rem;
  }

  .rag-error {
    margin: 0 0 1rem;
    padding: .75rem .9rem;
    border-radius: 8px;
    border: 1px solid rgba(255, 85, 85, .5);
    background: rgba(255, 85, 85, .08);
    color: var(--dracula-red, #ff5555);
    font-size: .9rem;
    line-height: 1.5;
  }

  /* Ask card — query input only */
  .ask-card {
    display: grid; gap: .6rem;
    border: 1px solid rgba(98, 114, 164, 0.55); border-radius: 8px;
    padding: 1rem; background: rgba(33, 34, 44, 0.9);
  }
  .ask-card h2 { margin: 0; color: var(--dracula-pink); font-family: var(--font-heading); font-size: 1rem; }
  .ask-note { margin: 0; color: var(--dracula-muted); font-size: .85rem; line-height: 1.5; }
  .ask-card textarea {
    width: 100%; box-sizing: border-box; resize: vertical; min-height: 3rem;
    padding: .7rem .85rem; border-radius: 8px;
    border: 1px solid rgba(98, 114, 164, 0.5); background: rgba(25, 26, 33, 0.72);
    color: var(--dracula-fg); font-family: var(--font-mono); font-size: .92rem; line-height: 1.5;
  }
  .ask-btn {
    justify-self: start; padding: .55rem 1.4rem; border-radius: 8px; cursor: pointer;
    border: 1px solid rgba(189, 147, 249, .5); background: rgba(189, 147, 249, .16);
    color: var(--dracula-fg); font-family: var(--font-heading); font-size: .9rem;
    transition: background .15s ease, transform .15s ease;
  }
  .ask-btn:hover:not(:disabled) { background: rgba(189, 147, 249, .28); transform: translateY(-1px); }
  .ask-btn:disabled { opacity: .55; cursor: not-allowed; }

  /* Deconstructed RAG pipeline */
  .pipeline { list-style: none; margin: 0; padding: 0; display: grid; gap: 1rem; }
  .stage {
    border: 1px solid rgba(68, 71, 90, 0.9);
    border-left: 3px solid rgba(98, 114, 164, .45);
    border-radius: 8px; padding: 1rem; background: rgba(33, 34, 44, 0.72);
    opacity: .55; transition: border-color .2s ease, opacity .2s ease;
  }
  .stage.active, .stage.done { opacity: 1; }
  .stage.active { border-left-color: var(--dracula-purple); }
  .stage.done { border-left-color: var(--dracula-green, #50fa7b); }
  .stage-head {
    display: flex; align-items: center; gap: .55rem;
    font-family: var(--font-heading); font-size: .95rem; color: var(--dracula-fg);
  }
  .stage-n {
    display: inline-flex; align-items: center; justify-content: center; flex: none;
    width: 1.5rem; height: 1.5rem; border-radius: 50%;
    background: rgba(189, 147, 249, .16); border: 1px solid rgba(189, 147, 249, .5);
    color: var(--dracula-purple); font-size: .8rem;
  }
  .stage.done .stage-n {
    background: rgba(80, 250, 123, .14); border-color: rgba(80, 250, 123, .5);
    color: var(--dracula-green, #50fa7b);
  }
  .stage-note { margin: .55rem 0 .75rem; color: var(--dracula-muted); font-size: .85rem; line-height: 1.55; }
  .stage-note code { color: var(--dracula-cyan); }
  .stage-wait { margin: 0; color: var(--dracula-comment); font-size: .85rem; font-family: var(--font-heading); }
  .stage-wait .hint { color: var(--dracula-muted); font-family: var(--font-mono); font-size: .8rem; }

  .embed-viz {
    display: flex; flex-wrap: wrap; align-items: center; gap: .6rem;
    padding: .7rem .85rem; border-radius: 8px;
    background: rgba(25, 26, 33, 0.7); border: 1px solid rgba(98, 114, 164, .42);
  }
  .embed-viz .q { color: var(--dracula-yellow, #f1fa8c); font-family: var(--font-mono); font-size: .85rem; }
  .embed-viz .vec { color: var(--dracula-cyan); font-family: var(--font-mono); font-size: .85rem; }

  .ctx summary {
    cursor: pointer; color: var(--dracula-purple); font-family: var(--font-heading);
    font-size: .8rem; padding: .25rem 0;
  }
  .ctx pre {
    margin: .5rem 0 0; padding: .75rem .85rem; border-radius: 8px; max-height: 16rem; overflow: auto;
    background: rgba(25, 26, 33, 0.82); border: 1px solid rgba(98, 114, 164, .42);
    color: var(--dracula-muted); font-size: .78rem; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere;
  }

  .model-tag {
    margin-left: auto; padding: .15rem .5rem; border-radius: 6px;
    background: rgba(139, 233, 253, .1); border: 1px solid rgba(139, 233, 253, .35);
    color: var(--dracula-cyan); font-family: var(--font-heading); font-size: .7rem;
  }
  .answer {
    padding: .9rem 1rem; border-radius: 8px;
    background: rgba(189, 147, 249, 0.05); border: 1px solid rgba(189, 147, 249, .34);
  }

  /* ═══ Top tab bar ══════════════════════════════════════ */
  .tab-bar-top {
    display: flex;
    gap: 0;
    border-bottom: 1px solid #1a1a2e;
    margin-bottom: 1rem;
  }
  .tab-btn-top {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    padding: 0.85rem 1.5rem;
    font-family: "JetBrains Mono", monospace;
    font-size: 1rem;
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

  /* RAG retrieval diagram */
  .rag {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    border: 1px solid #1c1c30;
    border-radius: 10px;
    background: rgba(18, 18, 26, 0.6);
    padding: 1.1rem 1.2rem;
  }
  .rag-lane {
    border: 1px solid #2a2a40;
    border-radius: 8px;
    background: #0d0d14;
    padding: 0.6rem 0.8rem;
  }
  .rag-live { border-left: 3px solid #50fa7b; }
  .rag-when {
    display: block;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #7d7d92;
    margin-bottom: 0.5rem;
  }
  .rag-live .rag-when { color: #50fa7b; }
  .rag-flow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }
  .rag-flow :global(svg) { color: #6f6f86; flex-shrink: 0; }
  .rag-node {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.8rem;
    color: #cfcfe0;
    background: #12121a;
    border: 1px solid #2a2a40;
    border-radius: 5px;
    padding: 0.25rem 0.55rem;
  }
  .rag-node :global(svg) { color: #8be9fd; }
  .rag-hit {
    color: #f5e663;
    border-color: rgba(245, 230, 99, 0.5);
  }
  .rag-hit :global(svg) { color: #f5e663; }
  .cv-note {
    margin: 1rem 0 0;
    color: #aeaebe;
    font-size: 0.9rem;
    line-height: 1.7;
  }

  /* Concept cards */
  .cv-cards { display: flex; flex-direction: column; gap: 1rem; }
  .cv-card {
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

  .cv-list { margin: .5rem 0 0; padding-left: 1.25rem; display: grid; gap: .45rem; }
  .cv-list li { color: #c9c9d6; font-size: .9rem; line-height: 1.55; }

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

  .gd-egs {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-top: 0.8rem;
  }
  .gd-eg {
    align-self: flex-start;
    font-size: 0.84rem;
    color: #d0d0da;
    background: rgba(80, 250, 123, 0.07);
    border: 1px solid rgba(80, 250, 123, 0.22);
    border-radius: 999px;
    padding: 0.3rem 0.75rem;
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
