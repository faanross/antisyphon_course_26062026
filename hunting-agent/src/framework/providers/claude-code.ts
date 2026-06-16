import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { LLMProvider, LLMResult } from "./types.js";

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
      ];

      if (process.env.CLAUDE_CODE_BARE === "1") {
        args.push("--bare");
      }

      // Pass the prompt via stdin, not argv: Windows caps the command line at
      // ~32K chars, and tool-heavy prompts (e.g. Lab 05's decide step) exceed it.
      const child = spawn(binary, args, {
        stdio: ["pipe", "pipe", "pipe"],
        // Detection/assessment/narrative are structured-extraction + rubric tasks, not open-ended
        // reasoning. Sonnet's adaptive extended thinking adds ~75s per call here and is never shown
        // to the student (only text_delta is forwarded below) — pure hidden latency. Disable it by
        // default; override by setting MAX_THINKING_TOKENS in the environment if a lab wants it.
        env: { ...process.env, MAX_THINKING_TOKENS: process.env.MAX_THINKING_TOKENS ?? "0" },
      });
      child.stdin.write(combined);
      child.stdin.end();
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-4000);
      });

      const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });

      for await (const line of rl) {
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

      await new Promise<void>((resolve, reject) => {
        child.on("close", (code) => {
          if (code === 0) resolve();
          else {
            const detail = stderr.trim() ? `: ${stderr.trim()}` : "";
            reject(new Error(`Claude Code exited with code ${code}${detail}`));
          }
        });
        child.on("error", reject);
      });
    },
  };
}
