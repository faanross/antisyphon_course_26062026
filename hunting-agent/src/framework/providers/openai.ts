import OpenAI from "openai";
import type { LLMProvider, LLMResult } from "./types.js";

export function createOpenAIProvider(
  apiKey: string,
  model: string,
  baseURL?: string,
): LLMProvider {
  // baseURL lets you point at ANY OpenAI-compatible endpoint — a local model
  // server (Ollama, LM Studio, llama.cpp, vLLM) on localhost or a LAN host, or
  // a proxy like LiteLLM. Leave it unset to use the real OpenAI API.
  const client = new OpenAI({ apiKey, baseURL });

  return {
    async invoke({ systemPrompt, userPrompt, onToken }): Promise<LLMResult> {
      if (onToken) {
        let accumulated = "";
        for await (const token of this.streamInvoke({ systemPrompt, userPrompt })) {
          accumulated += token;
          onToken(token);
        }
        return { text: accumulated, model };
      }

      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      return {
        text: response.choices[0]?.message?.content ?? "",
        model,
        usage: response.usage
          ? {
              inputTokens: response.usage.prompt_tokens,
              outputTokens: response.usage.completion_tokens ?? 0,
            }
          : undefined,
      };
    },

    async *streamInvoke({ systemPrompt, userPrompt }): AsyncIterable<string> {
      const stream = await client.chat.completions.create({
        model,
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) {
          yield text;
        }
      }
    },
  };
}
