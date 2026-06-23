import "dotenv/config";
import type { LLMProvider } from "./types.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createGeminiProvider } from "./gemini.js";
import { createOpenAIProvider } from "./openai.js";
import { createClaudeCodeProvider } from "./claude-code.js";
import { createCodexCliProvider } from "./codex-cli.js";
import { createMockProvider } from "./mock.js";

function env(name: string): string | undefined {
  return process.env[name];
}

function requireEnv(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`${name} not set`);
  return value;
}

// modelOverride (optional): use a specific model for this call instead of the provider's
// configured default — e.g. Lab 08 runs its synthesis on RAG_SYNTH_MODEL when set.
export function getProvider(modelOverride?: string): LLMProvider {
  const providerName = env("LLM_PROVIDER") ?? "mock";

  switch (providerName) {
    case "mock":
      return createMockProvider(modelOverride ?? env("MOCK_MODEL") ?? "mock-workshop-model");
    case "gemini":
      return createGeminiProvider(
        requireEnv("GEMINI_API_KEY"),
        modelOverride ?? requireEnv("GEMINI_MODEL"),
      );
    case "openai":
      return createOpenAIProvider(
        requireEnv("OPENAI_API_KEY"),
        modelOverride ?? requireEnv("OPENAI_MODEL"),
        env("OPENAI_BASE_URL"), // optional: point at a local/LAN OpenAI-compatible server
      );
    case "anthropic":
      return createAnthropicProvider(
        requireEnv("ANTHROPIC_API_KEY"),
        modelOverride ?? requireEnv("ANTHROPIC_MODEL"),
      );
    case "claude-code":
      return createClaudeCodeProvider(
        "claude",
        modelOverride ?? requireEnv("CLAUDE_CODE_MODEL"),
      );
    case "codex-cli":
      return createCodexCliProvider(
        "codex",
        modelOverride ?? requireEnv("CODEX_MODEL"),
      );
    default:
      throw new Error(`Unknown LLM_PROVIDER: ${providerName}`);
  }
}
