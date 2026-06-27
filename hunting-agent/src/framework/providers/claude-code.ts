import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { LLMProvider, LLMResult } from "./types.js";

function resolveCliBinary(binary: string): string {
  return process.platform === "win32" && !/\.(cmd|exe|bat)$/i.test(binary)
    ? `${binary}.cmd`
    : binary;
}

function quoteCmdArg(arg: string): string {
  return /[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

function resolveSpawn(binary: string, args: string[]): { command: string; args: string[] } {
  if (process.platform !== "win32") return { command: binary, args };

  const commandLine = [resolveCliBinary(binary), ...args].map(quoteCmdArg).join(" ");
  return {
    command: process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/s", "/c", commandLine],
  };
}

export function createClaudeCodeProvider(
  binary: string,
  model: string,
): LLMProvider {
  return {
    async invoke({ systemPrompt, userPrompt, onToken }): Promise<LLMResult> {
      let accumulated = "";
      for await (const token of this.streamInvoke({
        systemPrompt,
        userPrompt,
      })) {
        accumulated += token;
        onToken?.(token);
      }
      return {
        text: accumulated,
        model: `claude-code-cli:${model}`,
      };
    },

    async *streamInvoke({ systemPrompt, userPrompt }): AsyncIterable<string> {
      const combined = `${systemPrompt}\n\n---\n\n${userPrompt}`;
      const args = [
        "--print",
        "--model",
        model,
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--tools",
        "",
        "--disable-slash-commands",
        "--no-session-persistence",
        // Spawn a CLEAN completion. Without these, the host's user settings load SessionStart
        // hooks (e.g. superpowers) that inject "you must use skills" context — which derails the
        // model into emitting tool-call scaffolding instead of an answer — and MCP servers start
        // up on every call (pure latency). --setting-sources excludes user settings (auth via
        // OAuth/credentials is unaffected); --strict-mcp-config loads no MCP servers.
        "--strict-mcp-config",
        "--setting-sources",
        "project,local",
      ];

      if (process.env.CLAUDE_CODE_BARE === "1") {
        args.push("--bare");
      }

      // Pass the prompt via stdin, not argv: Windows caps the command line at
      // ~32K chars, and tool-heavy prompts (e.g. Lab 05's decide step) exceed it.
      const resolved = resolveSpawn(binary, args);
      const child = spawn(resolved.command, resolved.args, {
        stdio: ["pipe", "pipe", "pipe"],
        // Detection/assessment/narrative are structured-extraction + rubric tasks, not open-ended
        // reasoning. Sonnet's adaptive extended thinking adds ~75s per call here and is never shown
        // to the student (only text_delta is forwarded below) — pure hidden latency. Disable it by
        // default; override by setting MAX_THINKING_TOKENS in the environment if a lab wants it.
        env: { ...process.env, MAX_THINKING_TOKENS: process.env.MAX_THINKING_TOKENS ?? "0" },
      });
      // A subprocess that dies early — bad spawn, an overloaded machine, or the idle watchdog
      // below killing it — makes writes to its stdin emit EPIPE and can emit 'error' on its
      // pipes. Unhandled, those 'error' events crash the WHOLE dev server. Swallow pipe-level
      // errors here; the real outcome is reported via the child 'close'/'error' settlement below.
      child.stdin.on("error", () => {});
      child.stdout.on("error", () => {});
      child.stderr.on("error", () => {});

      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-4000);
      });

      // Idle watchdog: kill the subprocess if it emits nothing for this long, so a stalled model
      // call (wedged auth refresh, network black-hole, an overloaded machine) fails fast with a
      // clear error instead of hanging the lab forever on "No output yet". The timer resets on
      // every stream line (including thinking deltas), so a slow-but-progressing call is never
      // killed. Override with LLM_CALL_TIMEOUT_MS.
      const idleTimeoutMs = Number(process.env.LLM_CALL_TIMEOUT_MS ?? "120000");
      let timedOut = false;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const pokeWatchdog = () => {
        if (watchdog) clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, idleTimeoutMs);
      };

      // Settle on exit. Registered BEFORE we write stdin or consume stdout, so a fast death can't
      // fire 'close' before we are listening (which would hang the await forever). The extra
      // no-op .catch keeps an early for-await throw from surfacing as an unhandled rejection.
      const settled = new Promise<void>((resolve, reject) => {
        child.on("error", (err) => reject(err));
        child.on("close", (code) => {
          if (timedOut) {
            reject(
              new Error(
                `Claude Code call stalled (no output for ${Math.round(idleTimeoutMs / 1000)}s) and was terminated — re-run the lab. Set LLM_CALL_TIMEOUT_MS to adjust.`,
              ),
            );
            return;
          }
          if (code === 0) resolve();
          else {
            const detail = stderr.trim() ? `: ${stderr.trim()}` : "";
            reject(new Error(`Claude Code exited with code ${code}${detail}`));
          }
        });
      });
      settled.catch(() => {});

      child.stdin.write(combined);
      child.stdin.end();
      pokeWatchdog();

      try {
        const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });

        for await (const line of rl) {
          pokeWatchdog();
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (
              ev.type === "stream_event" &&
              ev.event?.type === "content_block_delta" &&
              ev.event?.delta?.type === "text_delta"
            ) {
              yield ev.event.delta.text;
            }
          } catch {
            // skip malformed lines
          }
        }

        await settled;
      } finally {
        if (watchdog) clearTimeout(watchdog);
      }
    },
  };
}
