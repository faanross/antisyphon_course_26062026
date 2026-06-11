<script lang="ts">
  import TerminalWindowIcon from "phosphor-svelte/lib/TerminalWindowIcon";
  import ShieldCheckIcon from "phosphor-svelte/lib/ShieldCheckIcon";
  import LockKeyIcon from "phosphor-svelte/lib/LockKeyIcon";
  import RobotIcon from "phosphor-svelte/lib/RobotIcon";
  import CursorClickIcon from "phosphor-svelte/lib/CursorClickIcon";
  import ArrowsClockwiseIcon from "phosphor-svelte/lib/ArrowsClockwiseIcon";
  import EyeIcon from "phosphor-svelte/lib/EyeIcon";
  import WrenchIcon from "phosphor-svelte/lib/WrenchIcon";
  import CheckCircleIcon from "phosphor-svelte/lib/CheckCircleIcon";
  import ProhibitIcon from "phosphor-svelte/lib/ProhibitIcon";
  import QuestionIcon from "phosphor-svelte/lib/QuestionIcon";
  import CodeIcon from "phosphor-svelte/lib/CodeIcon";
  import ChatCircleTextIcon from "phosphor-svelte/lib/ChatCircleTextIcon";
  import GearIcon from "phosphor-svelte/lib/GearIcon";

  type Decision = "allow" | "ask" | "deny";

  interface Step {
    step: number;
    thought?: string;
    command?: string;
    decision?: Decision;
    matchedRule?: string;
    permission?: { id: string; status: "pending" | "allow" | "deny" };
    ran?: boolean;
    blockedReason?: string;
    exitCode?: number | null;
    stdout?: string;
    stderr?: string;
    timedOut?: boolean;
    elapsedMs?: number;
  }

  let activeTab = $state<"lesson" | "instructions" | "live" | "trace" | "code">("lesson");

  let goal = $state("Look through the sandbox logs and tell me which host looks most suspicious, and why.");
  let busy = $state(false);
  let status = $state("");
  let error = $state("");

  let steps = $state<Step[]>([]);
  let answer = $state("");
  let policy = $state<{ deny: string[]; ask: string[] } | null>(null);
  let pending = $state<{ id: string; step: number; command: string; matchedRule?: string } | null>(null);

  function upsert(step: number, patch: Partial<Step>) {
    const i = steps.findIndex((s) => s.step === step);
    if (i === -1) steps = [...steps, { step, ...patch }];
    else steps[i] = { ...steps[i], ...patch };
  }

  async function run() {
    if (!goal.trim() || busy) return;
    busy = true;
    error = "";
    status = "Starting…";
    steps = [];
    answer = "";
    pending = null;

    try {
      const res = await fetch("/lab/shell/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal: goal.trim() }),
      });
      if (!res.body) throw new Error("No response stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          handle(JSON.parse(line));
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : "Run failed";
    } finally {
      busy = false;
      status = "";
      pending = null;
    }
  }

  function handle(evt: any) {
    switch (evt.type) {
      case "status": status = evt.message; break;
      case "policy": policy = { deny: evt.deny, ask: evt.ask }; break;
      case "think": upsert(evt.step, { thought: evt.thought }); break;
      case "command": upsert(evt.step, { command: evt.command, decision: evt.decision, matchedRule: evt.matchedRule }); break;
      case "permission_request":
        upsert(evt.step, { permission: { id: evt.id, status: "pending" } });
        pending = { id: evt.id, step: evt.step, command: evt.command, matchedRule: evt.matchedRule };
        break;
      case "permission_resolved":
        pending = null;
        steps = steps.map((s) => s.permission?.id === evt.id ? { ...s, permission: { id: evt.id, status: evt.decision } } : s);
        break;
      case "observation":
        upsert(evt.step, {
          ran: evt.ran, blockedReason: evt.blockedReason, exitCode: evt.exitCode,
          stdout: evt.stdout, stderr: evt.stderr, timedOut: evt.timedOut, elapsedMs: evt.elapsedMs,
        });
        break;
      case "token": answer += evt.token; break;
      case "done": answer = evt.answer || answer; break;
      case "error": error = evt.message; break;
    }
  }

  async function decide(decision: "allow" | "deny") {
    if (!pending) return;
    const id = pending.id;
    await fetch("/lab/shell/api/permission", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, decision }),
    });
  }

  function badge(d?: Decision): string {
    return d === "deny" ? "deny" : d === "ask" ? "ask" : "allow";
  }
</script>

<svelte:head><title>Bonus | Give the Agent a Shell</title></svelte:head>

<div class="page-wrapper">
  <div class="tab-bar">
    <button class="tab-btn" class:active={activeTab === "lesson"} onclick={() => (activeTab = "lesson")}>Lesson</button>
    <button class="tab-btn" class:active={activeTab === "instructions"} onclick={() => (activeTab = "instructions")}>Instructions</button>
    <button class="tab-btn" class:active={activeTab === "live"} onclick={() => (activeTab = "live")}>Live</button>
    <button class="tab-btn" class:active={activeTab === "trace"} onclick={() => (activeTab = "trace")}>Trace</button>
    <button class="tab-btn" class:active={activeTab === "code"} onclick={() => (activeTab = "code")}>Code</button>
  </div>

  {#if activeTab === "lesson"}
    <!-- ═══ LESSON ═══ -->
    <div class="code-view">
      <div class="code-inner">
        <header class="cv-hero">
          <span class="cv-eyebrow">Bonus Lab · Lesson</span>
          <h2>Giving an agent a real shell</h2>
          <p>
            This is the most powerful — and most dangerous — tool you can hand an agent: the
            command line. Once an agent can run shell commands, it can investigate, pivot, and
            act on a machine the way a human analyst does. The mechanics are simple; the
            <strong>safety</strong> is the real lesson. This lab runs on <strong>your own
            machine</strong>, so treat it as a home exercise.
          </p>
          <div class="cv-mental-model">
            <RobotIcon size={20} weight="duotone" />
            <span>model proposes a command</span>
            <span class="cv-mm-sep">→</span>
            <ShieldCheckIcon size={20} weight="duotone" />
            <span>policy gate</span>
            <span class="cv-mm-sep">→</span>
            <TerminalWindowIcon size={20} weight="duotone" />
            <span>harness runs it</span>
          </div>
        </header>

        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">A</span> A shell is just another tool<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">
            Nothing new happens on the model's side. This is the exact think → act → observe loop
            from Lab 04 — the only difference is that the "act" is a shell command instead of a
            built-in function. The model <em>chooses</em> a command; the <strong>harness</strong>
            runs it and feeds the output back.
          </p>
          <div class="tao">
            <div class="tao-cycle">
              <span class="tao-node tao-t">Thought</span>
              <span class="tao-sep">→</span>
              <span class="tao-node tao-a">Action — propose a command</span>
              <span class="tao-sep">→</span>
              <span class="tao-node tao-o">Observation — stdout / exit code</span>
              <span class="tao-loop">↺</span>
            </div>
          </div>
        </details>

        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">B</span> The danger, and the guardrail<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">
            The model now decides what runs on your box. So the harness never just runs whatever it
            says — every proposed command passes through a <strong>policy</strong> first. There are
            three outcomes, and this is exactly how production agent frameworks (Claude Code, the
            Claude Agent SDK) model permissions too:
          </p>
          <div class="cv-cards">
            <article class="cv-card">
              <div class="cv-card-head"><CheckCircleIcon size={24} weight="duotone" /><h4>allow</h4></div>
              <p>Not on either list → runs immediately. The default for ordinary, read-only work like <code>ls</code> or <code>grep</code>.</p>
            </article>
            <article class="cv-card">
              <div class="cv-card-head"><QuestionIcon size={24} weight="duotone" /><h4>ask</h4></div>
              <p>Matches the <code>ask</code> list → the loop <strong>pauses</strong> and you click Allow or Deny. For commands with side-effects: <code>git push</code>, <code>curl</code>, <code>npm install</code>.</p>
            </article>
            <article class="cv-card">
              <div class="cv-card-head"><ProhibitIcon size={24} weight="duotone" /><h4>deny</h4></div>
              <p>Matches the <code>deny</code> list → <strong>never runs</strong>; the agent is told and adapts. A backstop for the dangerous stuff (<code>rm</code>, <code>sudo</code>) — note a safety-trained model often refuses to even propose these first. Defense in depth.</p>
            </article>
          </div>
          <aside class="cv-callout">
            <LockKeyIcon size={22} weight="duotone" />
            <p>
              The rules live in a plain file — <code>command-policy.json</code> at the project root —
              with a <code>deny</code> list and an <code>ask</code> list. You edit it and re-run; no
              restart. That's the whole permission system: the model can <em>propose</em> anything,
              but a human-authored policy decides what's allowed to actually happen.
            </p>
          </aside>
        </details>

        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">C</span> How you'd build this for real<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">
            You don't have to hand-roll much. Three common routes, easiest to most managed:
          </p>
          <ol class="flow">
            <li class="flow-step" style="--d: 0ms">
              <span class="flow-rail"><WrenchIcon size={22} weight="duotone" /></span>
              <div class="flow-body">
                <div class="flow-top"><span class="flow-title">A <code>run_command</code> tool you execute</span><span class="flow-where">any provider</span></div>
                <p>The standard-library route: register it like any function tool and run it with Node's <code>child_process</code> — ~10 lines on the Lab 04 loop. Works with <strong>any</strong> model provider, and you keep full control of the loop and the policy (it's just a file you can read). That's why this lab uses it.</p>
              </div>
            </li>
            <li class="flow-step" style="--d: 100ms">
              <span class="flow-rail"><TerminalWindowIcon size={22} weight="duotone" /></span>
              <div class="flow-body">
                <div class="flow-top"><span class="flow-title">An MCP shell / filesystem server</span><span class="flow-where">possible, not ideal</span></div>
                <p>You <em>can</em> wrap a shell / filesystem MCP server and let the agent discover command + file tools at runtime. But for your <em>own local</em> machine it's backwards — an extra process and protocol hop that buys nothing over calling <code>child_process</code> directly. Only worth it if you already have a hardened shell/FS server to reuse across many agents or clients.</p>
              </div>
            </li>
            <li class="flow-step" style="--d: 200ms">
              <span class="flow-rail"><RobotIcon size={22} weight="duotone" /></span>
              <div class="flow-body">
                <div class="flow-top"><span class="flow-title">The Claude Agent SDK</span><span class="flow-where">batteries included</span></div>
                <p>Ships <code>Bash</code> + file tools and an <code>allow</code> / <code>deny</code> / <code>ask</code> permission system built in — the same shape as our policy file, but managed for you. The trade-off: it's <strong>Claude-only</strong>, so you give up the provider-agnosticism of the first route.</p>
              </div>
            </li>
          </ol>
          <p class="cv-note">
            Rule of thumb: own the loop with <strong>standard libraries</strong> when you want to stay provider-agnostic or keep full control — that's this lab. Reach for the <strong>SDK</strong> when you're all-in on Claude and happy to take its harness (shell, gating, sessions) off the shelf.
          </p>
        </details>
      </div>
    </div>
  {:else if activeTab === "instructions"}
    <!-- ═══ INSTRUCTIONS ═══ -->
    <div class="code-view">
      <div class="code-inner">
        <header class="cv-hero">
          <span class="cv-eyebrow">Bonus Lab · Walkthrough</span>
          <h2>Hand it a goal and watch it work the shell</h2>
          <p>
            You give the agent a goal in plain language; it figures out which shell commands to
            run, runs them on your machine (through the policy gate), and reports back. The agent
            starts in a small <code>shell-sandbox/</code> folder with some sample hunt files, but
            it has a real shell — it can roam.
          </p>
        </header>

        <div class="gd-note">
          <TerminalWindowIcon size={18} weight="duotone" />
          <span>
            <strong>Home lab — runs real commands on your own machine.</strong> It's gated by
            <code>command-policy.json</code> (deny / ask / allow), but you're still executing
            model-chosen commands. Read the policy before you start, and only run this on a machine
            you're comfortable with.
          </span>
        </div>

        <ol class="flow">
          <li class="flow-step" style="--d: 0ms">
            <span class="flow-rail"><ChatCircleTextIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top"><span class="flow-title">1 · Give it a goal</span><span class="flow-where">Live tab</span></div>
              <p>On the <strong>Live</strong> tab, describe what you want — not which command to run. Some suggestions:</p>
              <div class="gd-egs">
                <span class="gd-eg">Which host in the sandbox logs looks most suspicious, and why?</span>
                <span class="gd-eg">Summarise what's in this folder.</span>
                <span class="gd-eg">Fetch github.com with curl and report the status. <em>(triggers an "ask")</em></span>
                <span class="gd-eg">Delete the log files. <em>(deny backstop — the model often refuses first)</em></span>
              </div>
            </div>
          </li>
          <li class="flow-step" style="--d: 110ms">
            <span class="flow-rail"><ArrowsClockwiseIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top"><span class="flow-title">2 · Watch it loop</span><span class="flow-where">Live tab</span></div>
              <p>Each step shows the agent's <strong>thought</strong>, the <strong>command</strong> it proposed with its policy verdict (<span class="pill allow">allow</span> <span class="pill ask">ask</span> <span class="pill deny">deny</span>), and the command's output fed back as the next observation.</p>
            </div>
          </li>
          <li class="flow-step" style="--d: 220ms">
            <span class="flow-rail"><ShieldCheckIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top"><span class="flow-title">3 · Handle a permission prompt</span><span class="flow-where">when it hits an "ask"</span></div>
              <p>If the agent proposes an <code>ask</code> command, everything pauses and an <strong>Allow / Deny</strong> prompt appears. Nothing runs until you choose — exactly like Claude Code asking before a risky action.</p>
            </div>
          </li>
          <li class="flow-step" style="--d: 330ms">
            <span class="flow-rail"><EyeIcon size={22} weight="duotone" /></span>
            <div class="flow-body">
              <div class="flow-top"><span class="flow-title">4 · Deconstruct it in Trace</span><span class="flow-where">Trace tab</span></div>
              <p>The <strong>Trace</strong> tab is the full ledger: every step's thought, exact command, policy verdict, exit code, and raw stdout/stderr. Then tweak <code>command-policy.json</code> and re-run to see the gate change.</p>
            </div>
          </li>
        </ol>
      </div>
    </div>
  {:else if activeTab === "live"}
    <!-- ═══ LIVE ═══ -->
    <div class="live">
      <div class="ask-box">
        <label for="goal">Give the agent a goal</label>
        <textarea id="goal" bind:value={goal} rows="2" disabled={busy} placeholder="e.g. Which host looks most suspicious in the sandbox logs?"></textarea>
        <div class="actions">
          <button onclick={run} disabled={busy || !goal.trim()}>{busy ? "Working…" : "Run agent"}</button>
          {#if status}<span class="status">{status}</span>{/if}
        </div>
        {#if error}<p class="error">{error}</p>{/if}
      </div>

      {#if pending}
        <div class="perm">
          <div class="perm-head"><ShieldCheckIcon size={20} weight="fill" /><strong>Permission needed</strong></div>
          <p>The agent wants to run a command that matches the <code>ask</code> rule <code>{pending.matchedRule}</code>:</p>
          <pre class="cmd">{pending.command}</pre>
          <div class="perm-actions">
            <button class="allow" onclick={() => decide("allow")}>Allow</button>
            <button class="deny" onclick={() => decide("deny")}>Deny</button>
          </div>
        </div>
      {/if}

      {#if steps.length === 0 && !answer}
        <p class="empty">Give the agent a goal and it'll start running commands here.</p>
      {/if}

      <div class="feed">
        {#each steps as s (s.step)}
          <article class="step">
            {#if s.thought}<p class="thought"><RobotIcon size={15} weight="duotone" /> {s.thought}</p>{/if}
            {#if s.command}
              <div class="cmd-row">
                <span class="pill {badge(s.decision)}">{s.decision}</span>
                <code class="cmd-inline">{s.command}</code>
              </div>
            {/if}
            {#if s.ran === false}
              <p class="blocked">⛔ {s.blockedReason}</p>
            {:else if s.ran}
              <pre class="out">{s.stdout || s.stderr || "(no output)"}{#if s.timedOut} ⏱ timed out{/if}</pre>
            {/if}
          </article>
        {/each}
      </div>

      {#if answer}
        <div class="answer">
          <span class="answer-label">Answer</span>
          <div class="answer-body">{answer}</div>
        </div>
      {/if}
    </div>
  {:else if activeTab === "trace"}
    <!-- ═══ TRACE ═══ -->
    <div class="trace">
      {#if policy}
        <div class="policy-chip">
          <GearIcon size={16} weight="duotone" />
          <span><strong>policy</strong> · deny: {policy.deny.length} · ask: {policy.ask.length} (edit <code>command-policy.json</code>)</span>
        </div>
      {/if}
      {#if steps.length === 0}
        <p class="empty">Run the agent on the Live tab — the full step-by-step ledger appears here.</p>
      {/if}
      {#each steps as s (s.step)}
        <article class="trace-step">
          <div class="ts-head"><strong>Step {s.step}</strong>{#if s.elapsedMs !== undefined}<span>{s.elapsedMs}ms</span>{/if}</div>
          {#if s.thought}
            <div class="ts-row"><span class="ts-label">Thought</span><p>{s.thought}</p></div>
          {/if}
          {#if s.command}
            <div class="ts-row">
              <span class="ts-label">Action</span>
              <div><code class="cmd-inline">{s.command}</code> <span class="pill {badge(s.decision)}">{s.decision}{#if s.matchedRule} · {s.matchedRule}{/if}</span></div>
            </div>
          {/if}
          {#if s.permission}
            <div class="ts-row"><span class="ts-label">Permission</span><p>{s.permission.status === "pending" ? "waiting…" : s.permission.status === "allow" ? "you allowed it" : "you denied it"}</p></div>
          {/if}
          <div class="ts-row">
            <span class="ts-label">Observation</span>
            {#if s.ran === false}
              <p class="blocked">{s.blockedReason}</p>
            {:else if s.ran}
              <div>
                <p class="exit">exit code: {s.exitCode}{#if s.timedOut} · timed out{/if}</p>
                {#if s.stdout}<pre class="out">{s.stdout}</pre>{/if}
                {#if s.stderr}<pre class="out err">{s.stderr}</pre>{/if}
                {#if !s.stdout && !s.stderr}<p class="muted">(no output)</p>{/if}
              </div>
            {:else}
              <p class="muted">…</p>
            {/if}
          </div>
        </article>
      {/each}
    </div>
  {:else}
    <!-- ═══ CODE ═══ -->
    <div class="code-view">
      <div class="code-inner">
        <header class="cv-hero">
          <span class="cv-eyebrow">Under the Hood</span>
          <h2>How the shell tool is wired</h2>
          <p>
            Optional reading. The whole thing is one agent loop plus a policy check before each
            command. The model never touches your machine directly — it returns a JSON decision,
            and the harness is what runs the command.
          </p>
        </header>

        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">A</span> The decision contract<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">Each step, the model returns one JSON object — run a command, or finish:</p>
          <pre class="cv-code"><code>&#123; <span class="c-key">"thought"</span>: <span class="c-str">"check what's in the folder"</span>,
  <span class="c-key">"action"</span>: <span class="c-str">"run"</span>,
  <span class="c-key">"command"</span>: <span class="c-str">"ls -la"</span> &#125;</code></pre>
        </details>

        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">B</span> The gate, then the executor<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <p class="cv-lead">The harness classifies the command, and only then maybe runs it:</p>
          <pre class="cv-code"><code><span class="c-cm">// deny → never runs · ask → pause for user · else → execFile/spawn</span>
<span class="c-key">const</span> verdict = classifyCommand(command, policy);
<span class="c-key">if</span> (verdict.decision === <span class="c-str">"deny"</span>) observe(<span class="c-str">"blocked by policy"</span>);
<span class="c-key">else if</span> (verdict.decision === <span class="c-str">"ask"</span>) <span class="c-key">await</span> awaitPermission(id);
<span class="c-key">const</span> result = <span class="c-key">await</span> execCommand(command, sandboxDir); <span class="c-cm">// real shell</span></code></pre>
          <p class="cv-note">Execution uses Node's <code>child_process.spawn</code> with a timeout and an output cap. The permission pause is an in-memory promise the <code>/permission</code> endpoint resolves when you click.</p>
        </details>

        <details class="cv-section" open>
          <summary class="cv-h3"><span class="cv-num">C</span> Where it lives<span class="cv-chev" aria-hidden="true">▸</span></summary>
          <pre class="cv-tree"><code><span class="tr-dir">hunting-agent/</span>
├─ <span class="tr-file">command-policy.json</span>          <span class="tr-cm">← the deny / ask lists you edit</span>
├─ <span class="tr-dir">shell-sandbox/</span>               <span class="tr-cm">← where the agent starts (sample files)</span>
└─ <span class="tr-dir">src/</span>
   ├─ <span class="tr-dir">framework/</span>
   │  └─ <span class="tr-file">shell-lab.ts</span>           <span class="tr-cm">← policy, executor, the agent loop</span>
   └─ <span class="tr-dir">routes/lab/shell/api/</span>
      ├─ <span class="tr-file">run/+server.ts</span>        <span class="tr-cm">← streams the loop</span>
      └─ <span class="tr-file">permission/+server.ts</span> <span class="tr-cm">← resolves Allow / Deny</span></code></pre>
        </details>
      </div>
    </div>
  {/if}
</div>

<style>
  .page-wrapper { display: flex; flex-direction: column; min-height: 100vh; background: #0a0a0f; }

  .tab-bar { display: flex; gap: 0; background: #0a0a0f; border-bottom: 1px solid #1a1a2e; padding: 0 1rem; flex-shrink: 0; }
  .tab-btn { background: none; border: none; border-bottom: 2px solid transparent; border-radius: 0; padding: 0.85rem 1.3rem; font-family: "JetBrains Mono", monospace; font-size: 1rem; color: #8a8a9a; cursor: pointer; transition: all 0.2s; }
  .tab-btn:hover { color: #c0c0d0; }
  .tab-btn.active { color: #f5e663; border-bottom-color: #f5e663; }

  /* ── shared reading view (lesson/instructions/code) ── */
  .code-view { flex: 1; overflow-y: auto; background: radial-gradient(1200px 400px at 50% -120px, rgba(189,147,249,0.08), transparent), #0a0a0f; }
  .code-inner { max-width: 900px; margin: 0 auto; padding: 2.2rem 1.75rem 4rem; font-family: "JetBrains Mono", monospace; }
  .code-view p code { font-size: 0.86em; color: #f1fa8c; background: rgba(241,250,140,0.07); border: 1px solid rgba(241,250,140,0.12); border-radius: 3px; padding: 0.05em 0.35em; }
  .code-view strong { color: #e8e8f0; font-weight: 700; }
  .code-view em { color: #bd93f9; font-style: normal; }

  .cv-hero { animation: cvRise 0.5s ease both; }
  .cv-eyebrow { display: inline-block; color: #bd93f9; font-size: 0.74rem; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; margin-bottom: 0.6rem; }
  .cv-hero h2 { margin: 0; font-size: clamp(1.7rem, 3.5vw, 2.5rem); line-height: 1.05; color: #f5f5fa; font-weight: 700; }
  .cv-hero p { max-width: 64ch; margin: 1rem 0 0; color: #b6b6c6; font-size: 0.98rem; line-height: 1.75; }
  .cv-mental-model { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-top: 1.4rem; padding: 0.7rem 1rem; border: 1px solid #1f1f33; border-radius: 8px; background: rgba(18,18,26,0.7); color: #cfcfe0; font-size: 0.9rem; }
  .cv-mental-model :global(svg) { color: #8be9fd; flex-shrink: 0; }
  .cv-mm-sep { color: #50fa7b; font-size: 1.05rem; }

  .cv-section { margin-top: 2.6rem; }
  .cv-h3 { display: flex; align-items: center; gap: 0.6rem; margin: 0 0 0.5rem; font-size: 1.25rem; color: #f5f5fa; font-weight: 700; }
  summary.cv-h3 { cursor: pointer; list-style: none; user-select: none; padding: 0.2rem 0; }
  summary.cv-h3::-webkit-details-marker { display: none; }
  .cv-chev { margin-left: auto; color: #6f6f86; font-size: 0.85rem; transition: transform 0.2s ease, color 0.2s ease; }
  summary.cv-h3:hover .cv-chev { color: #bd93f9; }
  details[open] > summary .cv-chev { transform: rotate(90deg); }
  .cv-num { display: inline-flex; align-items: center; justify-content: center; width: 1.7rem; height: 1.7rem; border-radius: 6px; background: rgba(189,147,249,0.14); border: 1px solid rgba(189,147,249,0.4); color: #bd93f9; font-size: 0.9rem; font-weight: 800; flex-shrink: 0; }
  .cv-lead { max-width: 64ch; margin: 0 0 1.4rem; color: #9a9aaa; font-size: 0.94rem; line-height: 1.7; }

  .flow { list-style: none; margin: 0; padding: 0.4rem 0 0; }
  .flow-step { position: relative; display: grid; grid-template-columns: 44px 1fr; gap: 1.1rem; padding-bottom: 1.5rem; opacity: 0; animation: cvRise 0.55s ease forwards; animation-delay: var(--d, 0ms); }
  .flow-step:last-child { padding-bottom: 0; }
  .flow-step::before { content: ""; position: absolute; left: 21px; top: 48px; bottom: -2px; width: 2px; background: linear-gradient(180deg, #bd93f9, #50fa7b, #bd93f9); background-size: 100% 140px; opacity: 0.45; animation: cvFlow 2.4s linear infinite; }
  .flow-step:last-child::before { display: none; }
  .flow-rail { position: relative; z-index: 1; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: #12121a; border: 1px solid rgba(189,147,249,0.45); color: #bd93f9; box-shadow: 0 0 0 4px #0a0a0f; }
  .flow-body { border: 1px solid #1c1c30; border-radius: 8px; background: rgba(18,18,26,0.6); padding: 0.85rem 1.05rem; transition: border-color 0.2s, transform 0.2s; }
  .flow-body:hover { border-color: #2e2e4e; transform: translateX(2px); }
  .flow-top { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0.4rem 1rem; margin-bottom: 0.35rem; }
  .flow-title { color: #e8e8f0; font-weight: 700; font-size: 1rem; }
  .flow-where { color: #6f6f86; font-size: 0.76rem; }
  .flow-body p { margin: 0; color: #aeaebe; font-size: 0.9rem; line-height: 1.65; }

  .cv-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.8rem; }
  .cv-card { border: 1px solid #1c1c30; border-radius: 10px; background: rgba(18,18,26,0.6); padding: 0.9rem 1rem; }
  .cv-card-head { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; color: #bd93f9; }
  .cv-card-head h4 { margin: 0; font-size: 1rem; color: #f0f0f6; font-weight: 700; font-family: "JetBrains Mono", monospace; }
  .cv-card p { margin: 0; color: #aeaebe; font-size: 0.86rem; line-height: 1.6; }

  .cv-callout { display: flex; gap: 0.75rem; align-items: flex-start; margin-top: 1.6rem; padding: 1rem 1.15rem; border: 1px solid rgba(189,147,249,0.28); border-left: 3px solid #bd93f9; border-radius: 8px; background: rgba(189,147,249,0.06); }
  .cv-callout :global(svg) { color: #bd93f9; flex-shrink: 0; margin-top: 2px; }
  .cv-callout p { margin: 0; color: #c2c2d2; font-size: 0.92rem; line-height: 1.7; }
  .cv-note { margin: 0.85rem 0 0; color: #9a9aaa; font-size: 0.86rem; line-height: 1.65; }

  .cv-code { margin: 0; padding: 0.85rem 1rem; background: #0d0d14; border: 1px solid #1a1a2e; border-radius: 8px; overflow-x: auto; font-size: 0.84rem; line-height: 1.6; }
  .cv-code code { color: #d6d6e2; white-space: pre; }
  .cv-code .c-key { color: #ff79c6; } .cv-code .c-str { color: #f1fa8c; } .cv-code .c-cm { color: #6272a4; }
  .cv-tree { margin: 0; padding: 1rem 1.15rem; background: #0d0d14; border: 1px solid #1a1a2e; border-radius: 9px; overflow-x: auto; color: #5f6075; font-size: 0.82rem; line-height: 1.7; }
  .cv-tree code { color: inherit; white-space: pre; }
  .cv-tree .tr-dir { color: #8be9fd; } .cv-tree .tr-file { color: #f1fa8c; } .cv-tree .tr-cm { color: #6f6f86; }

  .tao { display: flex; justify-content: center; padding: 0.6rem 0; }
  .tao-cycle { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
  .tao-node { font-size: 0.84rem; padding: 0.35rem 0.7rem; border-radius: 6px; border: 1px solid #2a2a40; background: #0d0d14; color: #cfcfe0; }
  .tao-t { border-color: rgba(189,147,249,0.5); color: #bd93f9; }
  .tao-a { border-color: rgba(245,230,99,0.5); color: #f5e663; }
  .tao-o { border-color: rgba(80,250,123,0.5); color: #50fa7b; }
  .tao-sep { color: #6f6f86; }
  .tao-loop { color: #6f6f86; font-size: 0.9rem; }

  .gd-note { display: flex; gap: 0.55rem; align-items: flex-start; margin-top: 1.4rem; padding: 0.75rem 0.95rem; border: 1px solid rgba(245,230,99,0.28); border-left: 3px solid #f5e663; border-radius: 6px; background: rgba(245,230,99,0.05); }
  .gd-note :global(svg) { color: #f5e663; flex-shrink: 0; margin-top: 1px; }
  .gd-note span { color: #c2c2d2; font-size: 0.88rem; line-height: 1.65; }
  .gd-egs { display: flex; flex-direction: column; gap: 0.4rem; margin-top: 0.8rem; }
  .gd-eg { align-self: flex-start; font-size: 0.84rem; color: #d0d0da; background: rgba(80,250,123,0.07); border: 1px solid rgba(80,250,123,0.22); border-radius: 999px; padding: 0.3rem 0.75rem; }
  .gd-eg :global(em) { color: #f5e663; font-style: normal; }

  /* ── policy pills ── */
  .pill { font-family: "JetBrains Mono", monospace; font-size: 0.72rem; font-weight: 700; padding: 0.12rem 0.45rem; border-radius: 4px; }
  .pill.allow { color: #50fa7b; background: rgba(80,250,123,0.1); border: 1px solid rgba(80,250,123,0.35); }
  .pill.ask { color: #f5e663; background: rgba(245,230,99,0.1); border: 1px solid rgba(245,230,99,0.35); }
  .pill.deny { color: #ff6b6b; background: rgba(255,107,107,0.1); border: 1px solid rgba(255,107,107,0.35); }

  /* ── Live ── */
  .live { flex: 1; overflow-y: auto; max-width: 880px; width: 100%; margin: 0 auto; padding: 1.5rem 1.5rem 4rem; }
  .ask-box { border: 1px solid #1c1c30; border-radius: 10px; background: rgba(18,18,26,0.6); padding: 1rem 1.1rem; }
  .ask-box label { display: block; color: #b6b6c6; font-size: 0.85rem; margin-bottom: 0.5rem; }
  .ask-box textarea { width: 100%; box-sizing: border-box; background: #12121a; border: 1px solid #2a2a3e; color: #e0e0ea; padding: 0.7rem; font-family: inherit; font-size: 0.95rem; border-radius: 6px; resize: vertical; }
  .ask-box textarea:focus { outline: none; border-color: #bd93f9; }
  .actions { display: flex; align-items: center; gap: 0.8rem; margin-top: 0.6rem; }
  .actions button { background: #bd93f9; color: #0a0a0f; border: none; padding: 0.55rem 1.3rem; font-family: inherit; font-weight: 700; border-radius: 6px; cursor: pointer; }
  .actions button:disabled { background: #2a2a3e; color: #6a6a7a; cursor: not-allowed; }
  .status { color: #8be9fd; font-size: 0.85rem; }
  .error { color: #ff6b6b; margin: 0.6rem 0 0; font-size: 0.88rem; }
  .empty { color: #7a7a8a; text-align: center; padding: 2.5rem 1rem; }

  .perm { margin-top: 1rem; border: 1px solid rgba(245,230,99,0.45); border-radius: 10px; background: rgba(245,230,99,0.06); padding: 1rem 1.1rem; box-shadow: 0 0 22px rgba(245,230,99,0.12); }
  .perm-head { display: flex; align-items: center; gap: 0.5rem; color: #f5e663; margin-bottom: 0.5rem; }
  .perm p { margin: 0 0 0.5rem; color: #c2c2d2; font-size: 0.9rem; }
  .perm code { color: #f5e663; }
  .perm-actions { display: flex; gap: 0.6rem; margin-top: 0.7rem; }
  .perm-actions button { border: none; padding: 0.5rem 1.4rem; border-radius: 6px; font-family: inherit; font-weight: 700; cursor: pointer; }
  .perm-actions .allow { background: #50fa7b; color: #0a0a0f; }
  .perm-actions .deny { background: #ff6b6b; color: #0a0a0f; }

  .feed { display: flex; flex-direction: column; gap: 0.7rem; margin-top: 1rem; }
  .step { border: 1px solid #1c1c30; border-radius: 8px; background: rgba(18,18,26,0.5); padding: 0.7rem 0.85rem; }
  .thought { display: flex; align-items: center; gap: 0.4rem; margin: 0 0 0.5rem; color: #b6b6c6; font-size: 0.88rem; }
  .thought :global(svg) { color: #bd93f9; flex-shrink: 0; }
  .cmd-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem; }
  .cmd-inline { font-family: "JetBrains Mono", monospace; font-size: 0.85rem; color: #f1fa8c; background: rgba(241,250,140,0.07); border: 1px solid rgba(241,250,140,0.14); border-radius: 4px; padding: 0.15rem 0.5rem; word-break: break-all; }
  .blocked { color: #ff8585; font-size: 0.85rem; margin: 0.3rem 0 0; }
  .out { margin: 0.3rem 0 0; padding: 0.6rem 0.75rem; background: #0d0d14; border: 1px solid #1a1a2e; border-radius: 6px; color: #c6c6d2; font-family: "JetBrains Mono", monospace; font-size: 0.8rem; line-height: 1.5; white-space: pre-wrap; word-break: break-word; max-height: 280px; overflow: auto; }
  .out.err { color: #ff9b9b; }

  .answer { margin-top: 1.2rem; border: 1px solid rgba(80,250,123,0.35); border-radius: 10px; background: rgba(80,250,123,0.04); padding: 1rem 1.1rem; }
  .answer-label { display: inline-block; color: #50fa7b; font-family: "JetBrains Mono", monospace; font-size: 0.74rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 0.5rem; }
  .answer-body { color: #d6d6e2; font-size: 0.96rem; line-height: 1.7; white-space: pre-wrap; }

  /* ── Trace ── */
  .trace { flex: 1; overflow-y: auto; max-width: 900px; width: 100%; margin: 0 auto; padding: 1.5rem 1.5rem 4rem; }
  .policy-chip { display: inline-flex; align-items: center; gap: 0.5rem; color: #9a9aaa; font-size: 0.82rem; border: 1px solid #1c1c30; border-radius: 999px; padding: 0.35rem 0.8rem; margin-bottom: 1rem; }
  .policy-chip :global(svg) { color: #bd93f9; }
  .policy-chip code { color: #f1fa8c; }
  .trace-step { border: 1px solid #1c1c30; border-radius: 9px; background: rgba(18,18,26,0.5); padding: 0.85rem 1rem; margin-bottom: 0.8rem; }
  .ts-head { display: flex; justify-content: space-between; align-items: center; color: #bd93f9; font-family: "JetBrains Mono", monospace; margin-bottom: 0.5rem; }
  .ts-head span { color: #6f6f86; font-size: 0.78rem; }
  .ts-row { display: grid; grid-template-columns: 96px 1fr; gap: 0.6rem; padding: 0.35rem 0; border-top: 1px solid #15151f; }
  .ts-row:first-of-type { border-top: none; }
  .ts-label { color: #6aaa6a; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; padding-top: 0.15rem; }
  .ts-row p { margin: 0; color: #b6b6c6; font-size: 0.86rem; line-height: 1.5; }
  .exit { color: #8be9fd; font-size: 0.8rem; margin: 0 0 0.35rem; }
  .muted { color: #6a6a7a; }

  @keyframes cvRise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes cvFlow { from { background-position: 0 0; } to { background-position: 0 140px; } }
  @media (prefers-reduced-motion: reduce) { .flow-step, .cv-hero { animation: none; opacity: 1; } .flow-step::before { animation: none; } }
  @media (max-width: 720px) { .cv-cards { grid-template-columns: 1fr; } }
</style>
