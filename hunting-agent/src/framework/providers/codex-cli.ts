import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { LLMProvider, LLMResult } from "./types.js";

const DEFAULT_DISPLAY_CHUNK_DELAY_MS = 5;

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

function chunkTextForDisplay(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function displayChunkDelayMs(): number {
  const raw = process.env.CODEX_CLI_DISPLAY_CHUNK_DELAY_MS;
  if (!raw) return DEFAULT_DISPLAY_CHUNK_DELAY_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_DISPLAY_CHUNK_DELAY_MS;
}

async function* streamFinalTextForDisplay(text: string): AsyncIterable<string> {
  const delayMs = displayChunkDelayMs();
  for (const chunk of chunkTextForDisplay(text)) {
    yield chunk;
    if (delayMs > 0) await sleep(delayMs);
  }
}

export function createCodexCliProvider(
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
        model: `codex-cli:${model}`,
      };
    },

    async *streamInvoke({ systemPrompt, userPrompt }): AsyncIterable<string> {
      const prompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

      // codex exec --json exposes the final assistant message, but not token
      // deltas. The adapter still returns AsyncIterable chunks so the UI can
      // consume the same stream contract as the API-backed providers.
      // Pass the prompt via stdin, not argv: Windows caps the command line at
      // ~32K chars, and tool-heavy prompts (e.g. Lab 05's decide step) exceed it.
      // `codex exec` reads instructions from stdin when no positional prompt is given.
      const resolved = resolveSpawn(binary, [
          "exec",
          "--json",
          "--ignore-user-config",
          "--ignore-rules",
          "--ephemeral",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          "--color",
          "never",
          "--disable",
          "plugins",
          "--disable",
          "apps",
          "--disable",
          "shell_snapshot",
          "--model",
          model,
      ]);
      const child = spawn(resolved.command, resolved.args, {
        stdio: ["pipe", "pipe", "pipe"],
      });
      // Swallow pipe-level errors: if the subprocess dies early, writing its stdin emits EPIPE as
      // an unhandled 'error' event that would crash the whole dev server. The real outcome is still
      // reported via the 'close'/'error' handlers below. (Mirrors the claude-code provider.)
      child.stdin.on("error", () => {});
      child.stdout.on("error", () => {});
      child.stderr.on("error", () => {});
      child.stdin.write(prompt);
      child.stdin.end();
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-4000);
      });

      const settled = new Promise<void>((resolve, reject) => {
        child.on("close", (code) => {
          if (code === 0) resolve();
          else {
            const detail = stderr.trim() ? `: ${stderr.trim()}` : "";
            reject(new Error(`Codex CLI exited with code ${code}${detail}`));
          }
        });
        child.on("error", reject);
      });
      settled.catch(() => {});

      const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });

      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          if (
            ev.type === "item.completed" &&
            ev.item?.type === "agent_message" &&
            ev.item?.text
          ) {
            yield* streamFinalTextForDisplay(ev.item.text);
          }
        } catch {
          // skip malformed lines
        }
      }

      await settled;
    },
  };
}
