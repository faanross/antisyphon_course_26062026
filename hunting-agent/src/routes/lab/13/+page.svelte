<script lang="ts">
  import { onMount } from "svelte";
  import RocketLaunchIcon from "phosphor-svelte/lib/RocketLaunchIcon";
  import ListChecksIcon from "phosphor-svelte/lib/ListChecksIcon";
  import GaugeIcon from "phosphor-svelte/lib/GaugeIcon";
  import ScalesIcon from "phosphor-svelte/lib/ScalesIcon";
  import ShieldCheckIcon from "phosphor-svelte/lib/ShieldCheckIcon";
  import CheckCircleIcon from "phosphor-svelte/lib/CheckCircleIcon";

  type EvalRow = { id: string; category: string; description: string; expected: string; passed: boolean; detail: string };

  let activeTab = $state<"instructions" | "lab" | "code">("instructions");
  let evals = $state<EvalRow[]>([]);
  let busy = $state(false);
  let hasRun = $state(false);

  onMount(async () => {
    // Load the check definitions (not-yet-run) so the dashboard lists what will be evaluated.
    const response = await fetch("/lab/13/api/evals");
    const data = await response.json();
    evals = data.evals;
  });

  async function run() {
    busy = true;
    try {
      // POST runs the real investigation, then evaluates its live output.
      const response = await fetch("/lab/13/api/evals", { method: "POST" });
      const data = await response.json();
      evals = data.evals;
      hasRun = true;
    } finally {
      busy = false;
    }
  }

  const passed = $derived(evals.filter((row) => row.passed).length);
</script>

<svelte:head><title>Lab 13 | Eval Harness</title></svelte:head>

<main class="lab-shell">
  <a class="back" href="/">Labs</a>

  <header class="hero">
    <span>Lab 13</span>
    <h1>Eval Harness</h1>
    <p>Deterministic checks graded against a live investigation — so improvement is measured instead of guessed. The checks are fixed (a test oracle should not be probabilistic); the investigation they grade is real model output.</p>
    {#if activeTab === "lab"}
      <button onclick={run} disabled={busy}>{busy ? "Running investigation + evals" : "Run Eval Harness"}</button>
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
          <h2>Measure the agent before you change it</h2>
          <p>
            This lab runs a fixed set of <strong>deterministic checks</strong> over a live, real-model
            investigation and reports one number: how many passed. The checks never change, so the
            pass-rate is a real signal — it tells you whether a tweak to a prompt, tool, or skill
            actually helped, instead of guessing. This is the seatbelt for iterating on the system.
          </p>
        </header>

        <ol class="flow">
          <!-- Step 1 -->
          <li class="flow-step" style="--d: 0ms">
            <span class="flow-rail"><RocketLaunchIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">1 · Run the harness</span>
                <span class="flow-where">Lab tab · Run Eval Harness</span>
              </div>
              <p>
                Go to the <strong>Lab</strong> tab and hit <strong>Run Eval Harness</strong>. It runs
                the real investigation once — actual model output — then grades that output against
                every check. This takes a moment because the investigation is live, not a fixture.
              </p>
            </div>
          </li>

          <!-- Step 2 -->
          <li class="flow-step" style="--d: 110ms">
            <span class="flow-rail"><ListChecksIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">2 · Read the per-check results</span>
                <span class="flow-where">Eval Dashboard</span>
              </div>
              <p>
                The <strong>Eval Dashboard</strong> lists each check (EVAL-001 …) as
                <strong>PASS</strong> or <strong>FAIL</strong>, with its category, what it expected,
                and a human-readable detail saying why. Green means the investigation satisfied that
                assertion; red means it didn't.
              </p>
            </div>
          </li>

          <!-- Step 3 -->
          <li class="flow-step" style="--d: 220ms">
            <span class="flow-rail"><GaugeIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">3 · Read the headline score</span>
                <span class="flow-where">Dashboard header</span>
              </div>
              <p>
                The header shows the pass-rate — something like <code>6 / 8 passing</code>. That one
                number is the thing you watch over time: it's how "is the agent better?" becomes a
                measurement instead of a vibe.
              </p>
            </div>
          </li>

          <!-- Step 4 -->
          <li class="flow-step" style="--d: 330ms">
            <span class="flow-rail"><ScalesIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">4 · Understand task · dataset · scorer</span>
                <span class="flow-where">the three parts of an eval</span>
              </div>
              <p>
                An eval has three pieces: the <strong>task</strong> (run the investigation), the
                <strong>dataset</strong> (the curated workshop telemetry it runs over), and the
                <strong>scorers</strong> (the fixed checks). The investigation may vary run to run;
                the dataset and scorers never do — that's what makes a score change attributable.
              </p>
            </div>
          </li>

          <!-- Step 5 -->
          <li class="flow-step" style="--d: 440ms">
            <span class="flow-rail"><ShieldCheckIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top">
                <span class="flow-title">5 · Why evals gate changes</span>
                <span class="flow-where">Code tab · go deeper</span>
              </div>
              <p>
                Before you change a prompt, tool, or skill, run the harness to get a baseline. After
                the change, run it again: a higher pass-rate confirms a real improvement, a lower one
                catches a regression a "harmless" tweak slipped in. The <strong>Code</strong> tab
                shows how the grader stays deterministic.
              </p>
            </div>
          </li>
        </ol>

        <aside class="cv-callout">
          <GaugeIcon size={22} weight="duotone" />
          <p>
            <strong>Pin the grader, let the agent vary.</strong> If both the agent and the checks
            drift, a score tells you nothing. Holding the checks constant is the whole trick — it
            turns "I think this helped" into a number you can defend, and turns iterating on the
            agent into engineering rather than hoping.
          </p>
        </aside>
      </div>
    </div>
  {:else if activeTab === "lab"}
  <section class="panel">
    <div class="panel-head">
      <h2>Eval Dashboard</h2>
      <span>{hasRun ? `${passed} / ${evals.length} passing` : "not run"}</span>
    </div>
    <div class="evals">
      {#each evals as row}
        <article class:pass={row.passed}>
          <strong>{row.id} {row.passed ? "PASS" : "FAIL"}</strong>
          <span>{row.category}</span>
          <p>{row.description}</p>
          <small>Expected: {row.expected}</small>
          <small>{row.detail}</small>
        </article>
      {/each}
    </div>
  </section>
  {:else}
    <!-- ═══════════════════════════════════════════════════ -->
    <!-- CODE VIEW  (architectural reference, non-interactive)-->
    <!-- ═══════════════════════════════════════════════════ -->
    <div class="code-view">
      <div class="code-inner">
        <header class="cv-hero">
          <span class="cv-eyebrow">Under the Hood</span>
          <h2>How you measure an agent</h2>
          <p>
            Optional reading for the curious. You can't improve what you don't measure — and you
            can't measure a changing agent with a changing grader. An <strong>eval harness</strong>
            is a fixed set of <strong>deterministic checks</strong> graded against the live, real-model
            investigation. The agent's output may vary run to run; the checks never do, so the
            pass-rate tells you whether a change actually helped.
          </p>
          <div class="cv-mental-model">
            <RocketLaunchIcon size={20} weight="duotone" />
            <span>real investigation</span>
            <span class="cv-mm-sep">→</span>
            <ListChecksIcon size={20} weight="duotone" />
            <span>fixed checks</span>
            <span class="cv-mm-sep">→</span>
            <GaugeIcon size={20} weight="duotone" />
            <span>pass-rate</span>
          </div>
        </header>

        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">A</span> How a run is graded<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">Run the real investigation once, then grade its output against every check.</p>
          <ol class="flow">
            <li class="flow-step" style="--d: 0ms">
              <span class="flow-rail"><RocketLaunchIcon size={22} weight="duotone" /></span>
              <div class="flow-body">
                <div class="flow-top"><span class="flow-title">Run the real investigation</span><span class="flow-where">server · orchestrator.ts</span></div>
                <p><code>runInvestigationState()</code> produces the live findings, graph, narrative, and verdicts — actual model output, not a fixture.</p>
              </div>
            </li>
            <li class="flow-step" style="--d: 90ms">
              <span class="flow-rail"><CheckCircleIcon size={22} weight="duotone" /></span>
              <div class="flow-body">
                <div class="flow-top"><span class="flow-title">Grade every check</span><span class="flow-badge">deterministic</span><span class="flow-where">server · evals.ts</span></div>
                <p><code>runWorkshopEvals(state)</code> runs each <code>EVAL_CHECK</code> as a plain assertion over that state — no model in the grader — returning <code>passed</code> plus a human-readable detail.</p>
              </div>
            </li>
            <li class="flow-step" style="--d: 180ms">
              <span class="flow-rail"><GaugeIcon size={22} weight="duotone" /></span>
              <div class="flow-body">
                <div class="flow-top"><span class="flow-title">Report the pass-rate</span><span class="flow-where">server → browser</span></div>
                <p>The dashboard shows each check as PASS/FAIL and a headline score like <code>6 / 8 passing</code> — one number you can watch as you tune skills and prompts.</p>
              </div>
            </li>
          </ol>
        </details>

        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">B</span> What the harness checks<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">Eight fixed checks, each a single assertion over the investigation state:</p>
          <div class="ev-list">
            <div class="ev-row"><code>EVAL-001</code><span>C2 beacon 185.225.73.217 is the top-priority candidate</span></div>
            <div class="ev-row"><code>EVAL-002</code><span>the EDR heartbeat is triaged as likely benign</span></div>
            <div class="ev-row"><code>EVAL-003</code><span>hunt-c2-over-https produced a finding with compositeScore &gt; 0.8</span></div>
            <div class="ev-row"><code>EVAL-004</code><span>assessment flagged high/critical given the CI/CD asset</span></div>
            <div class="ev-row"><code>EVAL-005</code><span>narrative connected the AI-tool anomaly and C2 via shared entities</span></div>
            <div class="ev-row"><code>EVAL-006</code><span>uncertainty was preserved where evidence was partial</span></div>
            <div class="ev-row"><code>EVAL-007</code><span>at least one verdict was recorded</span></div>
            <div class="ev-row"><code>EVAL-008</code><span>skill-performance tracking is active</span></div>
          </div>
          <p class="cv-note">Each check reads the real state and returns true/false — a test oracle, deliberately boring and repeatable.</p>
        </details>

        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">C</span> Four ideas worth understanding<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <div class="cv-cards">
            <article class="cv-card">
              <div class="cv-card-head"><ScalesIcon size={26} weight="duotone" /><h4>A fixed oracle grades variable work</h4></div>
              <p>The investigation is probabilistic; the grader must not be. Holding the checks constant is what makes a score change attributable to the agent, not the test.</p>
            </article>
            <article class="cv-card">
              <div class="cv-card-head"><CheckCircleIcon size={26} weight="duotone" /><h4>Each check is one assertion over state</h4></div>
              <p>A check is just code that inspects the findings, narrative, or verdicts and returns a boolean plus a detail. No cleverness — exactly the point.</p>
            </article>
            <article class="cv-card">
              <div class="cv-card-head"><GaugeIcon size={26} weight="duotone" /><h4>Measured, not guessed</h4></div>
              <p>"Is it better?" becomes a number — 6/8 today, 7/8 after a fix. Without that, prompt and skill changes are vibes.</p>
            </article>
            <article class="cv-card">
              <div class="cv-card-head"><ShieldCheckIcon size={26} weight="duotone" /><h4>Regression safety</h4></div>
              <p>Evals catch the day a "harmless" tweak quietly breaks a detection that used to pass. They're the seatbelt for iterating on an agent.</p>
            </article>
          </div>
        </details>

        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">D</span> Where each piece lives<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">The checks and the runner are one file.</p>
          <pre class="cv-tree"><code><span class="tr-dir">hunting-agent/src/</span>
│
├─ <span class="tr-dir">routes/lab/13/api/evals/</span>
│  └─ <span class="tr-file">+server.ts</span>             <span class="tr-cm">← run investigation → runWorkshopEvals</span>
│
└─ <span class="tr-dir">framework/</span>
   └─ <span class="tr-file">evals.ts</span>              <span class="tr-cm">← EVAL_CHECKS + the deterministic grader</span></code></pre>
        </details>

        <aside class="cv-callout">
          <GaugeIcon size={22} weight="duotone" />
          <p>
            <strong>Why deterministic grading?</strong> If both the agent and the grader drift, a score
            tells you nothing. Pin the grader, let the agent vary, and the pass-rate becomes a real
            signal — the difference between engineering an agent and hoping it got better.
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
  .hero { display: grid; gap: .8rem; }
  button { width: fit-content; border: 1px solid rgba(245,230,99,.42); border-radius: 3px; padding: .7rem .95rem; background: rgba(245,230,99,.1); color: #f5e663; font: inherit; font-weight: 800; }
  button:disabled { opacity: .58; }
  .panel { margin-top: 1rem; }
  .hero span, .panel-head span { color: #bd93f9; text-transform: uppercase; font-weight: 800; }
  h1, h2, p { margin: 0; }
  h1 { color: #f5e663; font-size: clamp(2.5rem, 7vw, 5rem); line-height: .98; }
  h2 { color: #f5e663; }
  p, small { color: rgba(255,255,255,.62); line-height: 1.55; }
  .panel-head { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; margin-bottom: 1rem; }
  .evals { display: grid; gap: .75rem; }
  article { border: 1px solid rgba(255,85,85,.36); border-radius: 4px; padding: .9rem; display: grid; gap: .3rem; background: rgba(255,85,85,.05); }
  article.pass { border-color: rgba(80,250,123,.42); background: rgba(80,250,123,.05); }
  article strong { color: #8be9fd; }
  article span { color: #bd93f9; }
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

  /* Eval list */
  .ev-list { display: flex; flex-direction: column; gap: 0.4rem; }
  .ev-row { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0.6rem; border: 1px solid #1c1c30; border-radius: 8px; background: rgba(18, 18, 26, 0.6); padding: 0.5rem 0.8rem; }
  .ev-row code { flex-shrink: 0; }
  .ev-row span { color: #aeaebe; font-size: 0.86rem; }
  .cv-note { margin: 1rem 0 0; color: #aeaebe; font-size: 0.9rem; line-height: 1.7; }

  /* Concept cards (override lab13 global article) */
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
