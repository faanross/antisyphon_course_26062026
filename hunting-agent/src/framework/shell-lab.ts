/**
 * Bonus lab — "Give the agent a shell".
 *
 * A real agent loop (real model calls) where the single tool is the command
 * line. The model proposes a shell command; the harness checks it against a
 * policy file (deny / ask / allow), optionally pauses for the user's
 * permission, then executes it for real and feeds the output back as an
 * observation. This is the think → act → observe loop from Lab 04, but the
 * "act" is a live shell command on the student's own machine.
 *
 * Safety is the lesson: the MODEL only chooses; the HARNESS decides whether to
 * run, and runs it itself, gated by command-policy.json.
 */

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { getProvider } from "./providers/index.js";

// ── Policy ──────────────────────────────────────────────────

export type PolicyDecision = "allow" | "ask" | "deny";

export interface CommandPolicy {
  readonly deny: readonly string[];
  readonly ask: readonly string[];
}

const DEFAULT_POLICY: CommandPolicy = {
  deny: ["rm", "rmdir", "del", "sudo", "shutdown", "reboot", "mkfs", "dd"],
  ask: ["git push", "npm install", "curl", "wget", "ssh", "kill"],
};

function policyPath(): string {
  return path.join(process.cwd(), "command-policy.json");
}

export async function loadPolicy(): Promise<CommandPolicy> {
  try {
    const raw = await readFile(policyPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<CommandPolicy>;
    return {
      deny: Array.isArray(parsed.deny) ? parsed.deny.filter((r) => typeof r === "string") : [],
      ask: Array.isArray(parsed.ask) ? parsed.ask.filter((r) => typeof r === "string") : [],
    };
  } catch {
    return DEFAULT_POLICY;
  }
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/** Does a single policy rule match this command? See command-policy.json for the rules. */
function ruleMatches(rule: string, command: string): boolean {
  const r = rule.trim().toLowerCase();
  const cmd = command.trim().toLowerCase();
  if (!r) return false;
  if (r.includes("*")) return globToRegExp(r).test(cmd);
  if (r.includes(" ")) return cmd === r || cmd.startsWith(`${r} `);
  // bare word → match the first token (the binary), basename-aware
  const firstToken = cmd.split(/\s+/)[0] ?? "";
  const base = firstToken.split(/[\\/]/).pop() ?? firstToken;
  return base === r || firstToken === r;
}

export interface PolicyVerdict {
  readonly decision: PolicyDecision;
  readonly matchedRule?: string;
}

export function classifyCommand(command: string, policy: CommandPolicy): PolicyVerdict {
  for (const rule of policy.deny) {
    if (ruleMatches(rule, command)) return { decision: "deny", matchedRule: rule };
  }
  for (const rule of policy.ask) {
    if (ruleMatches(rule, command)) return { decision: "ask", matchedRule: rule };
  }
  return { decision: "allow" };
}

// ── Sandbox (the agent's default working directory) ─────────

function sandboxDir(): string {
  return path.join(process.cwd(), "shell-sandbox");
}

const SANDBOX_SEED: Record<string, string> = {
  "README.txt":
    "This is the sandbox the shell agent starts in.\n" +
    "It's a normal folder on your machine — the agent has a REAL shell, so it can\n" +
    "cd elsewhere too. These sample files just give it something to look at.\n",
  "conn.log":
    "ts\tsrc_ip\tdest_ip\tdest_port\tbytes\n" +
    "00:00:01\t10.42.10.45\t185.225.73.217\t443\t512\n" +
    "00:01:01\t10.42.10.45\t185.225.73.217\t443\t508\n" +
    "00:02:01\t10.42.10.45\t185.225.73.217\t443\t514\n" +
    "00:02:05\t10.42.10.7\t142.250.80.46\t443\t8044\n",
  "processes.txt":
    "pid\tname\tparent\n" +
    "4832\tsvchost-health.exe\tpowershell.exe\n" +
    "3001\tpowershell.exe\tCode.exe\n" +
    "1200\tchrome.exe\texplorer.exe\n",
  "notes.md":
    "# Analyst notes\n- 10.42.10.45 keeps talking to 185.225.73.217 on a tight interval.\n- svchost-health.exe looks off (Temp path, odd parent).\n",
};

async function ensureSandbox(): Promise<string> {
  const dir = sandboxDir();
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(SANDBOX_SEED)) {
    const file = path.join(dir, name);
    try {
      await access(file);
    } catch {
      await writeFile(file, content, "utf8");
    }
  }
  return dir;
}

// ── Executor (real shell) ───────────────────────────────────

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly elapsedMs: number;
}

const EXEC_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_CHARS = 12_000;

function cap(text: string): string {
  return text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n…[truncated ${text.length - MAX_OUTPUT_CHARS} chars]`
    : text;
}

export async function execCommand(command: string, cwd: string): Promise<CommandResult> {
  const startedAt = Date.now();
  return new Promise<CommandResult>((resolve) => {
    const child = spawn(command, { shell: true, cwd });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, EXEC_TIMEOUT_MS);

    child.stdout?.on("data", (d) => {
      if (stdout.length < MAX_OUTPUT_CHARS + 1) stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      if (stderr.length < MAX_OUTPUT_CHARS + 1) stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout: cap(stdout), stderr: cap(`${stderr}\n${err.message}`), exitCode: null, timedOut, elapsedMs: Date.now() - startedAt });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout: cap(stdout), stderr: cap(stderr), exitCode: code, timedOut, elapsedMs: Date.now() - startedAt });
    });
  });
}

// ── Permission round-trip (paused mid-loop) ─────────────────

type PermissionResolver = (decision: "allow" | "deny") => void;
const pendingPermissions = new Map<string, PermissionResolver>();
const PERMISSION_TIMEOUT_MS = 120_000;

/** Called by the /permission endpoint when the user clicks Allow or Deny. */
export function resolvePermission(id: string, decision: "allow" | "deny"): boolean {
  const resolver = pendingPermissions.get(id);
  if (!resolver) return false;
  pendingPermissions.delete(id);
  resolver(decision);
  return true;
}

function awaitPermission(id: string): Promise<"allow" | "deny"> {
  return new Promise<"allow" | "deny">((resolve) => {
    pendingPermissions.set(id, resolve);
    setTimeout(() => {
      if (pendingPermissions.has(id)) {
        pendingPermissions.delete(id);
        resolve("deny");
      }
    }, PERMISSION_TIMEOUT_MS);
  });
}

// ── The agent loop ──────────────────────────────────────────

export type ShellRunEvent =
  | { readonly type: "status"; readonly message: string }
  | { readonly type: "policy"; readonly deny: readonly string[]; readonly ask: readonly string[] }
  | { readonly type: "think"; readonly step: number; readonly thought: string }
  | { readonly type: "command"; readonly step: number; readonly command: string; readonly decision: PolicyDecision; readonly matchedRule?: string }
  | { readonly type: "permission_request"; readonly id: string; readonly step: number; readonly command: string; readonly matchedRule?: string }
  | { readonly type: "permission_resolved"; readonly id: string; readonly decision: "allow" | "deny" }
  | {
      readonly type: "observation";
      readonly step: number;
      readonly command: string;
      readonly ran: boolean;
      readonly blockedReason?: string;
      readonly exitCode?: number | null;
      readonly stdout?: string;
      readonly stderr?: string;
      readonly timedOut?: boolean;
      readonly elapsedMs?: number;
    }
  | { readonly type: "token"; readonly token: string }
  | { readonly type: "done"; readonly answer: string }
  | { readonly type: "error"; readonly message: string };

export type ShellRunSink = (event: ShellRunEvent) => void;

const MAX_STEPS = 6;

const SHELL_SYSTEM_PROMPT = [
  "You are the planning step of an agentic threat-hunting harness that operates a machine through the command line.",
  "You do NOT run commands yourself. You choose ONE command at a time; the harness validates it against a policy, executes it, and returns its output to you as an Observation.",
  "Respond with ONE JSON object and nothing else. Do not wrap it in markdown, and do not add any prose.",
  "",
  "To have the harness run a command:",
  '{"thought":"brief reason","action":"run","command":"ls -la"}',
  "",
  "To stop once you have enough to answer the user:",
  '{"thought":"brief reason","action":"finish","finalAnswer":"brief draft conclusion"}',
  "",
  "Guidance:",
  "- One command per step. Prefer simple, read-only commands (ls, cat, grep, head, wc, find, pwd, whoami).",
  "- The harness starts you in a sandbox folder; it is a real shell on the user's machine.",
  "- Each step you will see the previous command's stdout, stderr, and exit code, then choose the next command.",
  "- If a command was blocked by policy, adapt and try another approach.",
  "- Keep it to a few steps.",
].join("\n");

const SHELL_ANSWER_SYSTEM_PROMPT = [
  "You are a threat-hunting assistant.",
  "Summarize findings for the user based ONLY on the command outputs provided below.",
  "Be concise and concrete, and reference what the commands actually showed.",
  "If commands were blocked or returned nothing useful, say so plainly.",
].join("\n");

function buildDecisionPrompt(goal: string, observations: readonly string[]): string {
  return [
    "COMMAND_SELECTION_REQUEST",
    "",
    "Choose the next command for the harness to run, or finish.",
    "Return ONLY one JSON object. Do not wrap it in markdown.",
    "",
    "User's goal:",
    goal,
    "",
    "Observations so far:",
    observations.length ? observations.join("\n\n") : "None yet — no commands have run.",
    "",
    "Return your next JSON decision now.",
  ].join("\n");
}

function buildFinalPrompt(goal: string, observations: readonly string[], draft?: string): string {
  return [
    "FINAL_ANSWER_REQUEST",
    "",
    "Write the final answer for the user in plain prose, using only what the commands showed.",
    "",
    "User's goal:",
    goal,
    "",
    "Command outputs from this run:",
    observations.length ? observations.join("\n\n") : "No commands were run.",
    "",
    draft ? `Your draft conclusion:\n${draft}` : "",
  ].filter(Boolean).join("\n");
}

// ── decision JSON parsing (string/escape aware) ──
function balancedObjectFrom(text: string, start: number): string | undefined {
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth += 1;
    else if (ch === "}") { depth -= 1; if (depth === 0) return text.slice(start, i + 1); }
  }
  return undefined;
}

interface ShellDecision {
  readonly thought: string;
  readonly action: "run" | "finish";
  readonly command?: string;
  readonly finalAnswer?: string;
}

function parseDecision(text: string): ShellDecision | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const sources = fenced?.[1] ? [fenced[1], text] : [text];
  for (const source of sources) {
    for (let i = 0; i < source.length; i += 1) {
      if (source[i] !== "{") continue;
      const slice = balancedObjectFrom(source, i);
      if (!slice) continue;
      try {
        const parsed = JSON.parse(slice) as Record<string, unknown>;
        if (!("action" in parsed) && !("command" in parsed) && !("finalAnswer" in parsed)) continue;
        const action = parsed.action === "finish" ? "finish" : "run";
        return {
          thought: typeof parsed.thought === "string" ? parsed.thought.trim() : "",
          action,
          command: typeof parsed.command === "string" ? parsed.command.trim() : undefined,
          finalAnswer: typeof parsed.finalAnswer === "string" ? parsed.finalAnswer : undefined,
        };
      } catch {
        // keep scanning
      }
    }
  }
  return undefined;
}

let permissionCounter = 0;

export async function runShellAgentStreaming(goal: string, onEvent: ShellRunSink): Promise<string> {
  const provider = getProvider();
  const policy = await loadPolicy();
  const cwd = await ensureSandbox();
  onEvent({ type: "policy", deny: policy.deny, ask: policy.ask });

  const observations: string[] = [];
  let draft: string | undefined;

  for (let step = 1; step <= MAX_STEPS; step += 1) {
    onEvent({ type: "status", message: `Thinking (step ${step})` });
    const decisionResult = await provider.invoke({
      systemPrompt: SHELL_SYSTEM_PROMPT,
      userPrompt: buildDecisionPrompt(goal, observations),
    });
    const decision = parseDecision(decisionResult.text);

    if (!decision) {
      // Treat prose as the answer if we already have evidence; otherwise stop.
      if (observations.length > 0) { draft = decisionResult.text.trim(); }
      break;
    }
    if (decision.thought) onEvent({ type: "think", step, thought: decision.thought });

    if (decision.action === "finish" || !decision.command) {
      draft = decision.finalAnswer ?? draft;
      break;
    }

    const command = decision.command;
    const verdict = classifyCommand(command, policy);
    onEvent({ type: "command", step, command, decision: verdict.decision, matchedRule: verdict.matchedRule });

    // deny → never run
    if (verdict.decision === "deny") {
      const reason = `Blocked by policy (matched deny rule: "${verdict.matchedRule}").`;
      observations.push(`Observation ${step}: command "${command}" was NOT run. ${reason}`);
      onEvent({ type: "observation", step, command, ran: false, blockedReason: reason });
      continue;
    }

    // ask → pause for the user
    if (verdict.decision === "ask") {
      permissionCounter += 1;
      const id = `perm-${step}-${permissionCounter}`;
      onEvent({ type: "permission_request", id, step, command, matchedRule: verdict.matchedRule });
      onEvent({ type: "status", message: "Waiting for your permission…" });
      const userDecision = await awaitPermission(id);
      onEvent({ type: "permission_resolved", id, decision: userDecision });
      if (userDecision === "deny") {
        const reason = "You denied permission to run this command.";
        observations.push(`Observation ${step}: command "${command}" was NOT run. ${reason}`);
        onEvent({ type: "observation", step, command, ran: false, blockedReason: reason });
        continue;
      }
    }

    // allow (or approved ask) → run for real
    onEvent({ type: "status", message: `Running: ${command}` });
    const result = await execCommand(command, cwd);
    observations.push([
      `Observation ${step}: ran "${command}"`,
      `exit code: ${result.exitCode}${result.timedOut ? " (timed out)" : ""}`,
      result.stdout ? `stdout:\n${result.stdout}` : "stdout: (empty)",
      result.stderr ? `stderr:\n${result.stderr}` : "",
    ].filter(Boolean).join("\n"));
    onEvent({
      type: "observation",
      step,
      command,
      ran: true,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
      elapsedMs: result.elapsedMs,
    });
  }

  // Compose the final answer (real model call, streamed)
  onEvent({ type: "status", message: "Writing the answer" });
  let streamed = "";
  const finalResult = await provider.invoke({
    systemPrompt: SHELL_ANSWER_SYSTEM_PROMPT,
    userPrompt: buildFinalPrompt(goal, observations, draft),
    onToken: (token) => {
      streamed += token;
      onEvent({ type: "token", token });
    },
  });
  const answer = streamed || finalResult.text || draft || "(no answer produced)";
  if (!streamed && answer) onEvent({ type: "token", token: answer });
  onEvent({ type: "done", answer });
  return answer;
}
