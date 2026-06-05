import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { getProvider } from "./providers/index.js";

export type McpLifecycleStep = "connect" | "discover" | "decide" | "call" | "done";
export type McpLifecycleStatus = "start" | "ok" | "error";

// The agent's choice of which discovered MCP tool to call, and with what args.
export interface GtiAgentDecision {
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly thought: string;
  readonly source: "model" | "fallback";
  readonly model?: string;
}

export interface McpLifecycleEvent {
  readonly step: McpLifecycleStep;
  readonly status: McpLifecycleStatus;
  readonly message: string;
  readonly durationMs?: number;
  readonly details?: unknown;
}

export interface GtiToolSummary {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly relevant: boolean;
}

export interface GtiToolSelection {
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly reason: string;
  readonly indicatorType: "ip" | "domain" | "url" | "search";
}

export interface GtiMcpConfig {
  readonly command: string;
  readonly args: readonly string[];
  readonly serverDirectory: string;
  readonly transport: "stdio";
  readonly apiKeyPresent: boolean;
}

type EnvLike = Record<string, string | undefined>;
type EmitLifecycleEvent = (event: McpLifecycleEvent) => void;

const RELEVANT_GTI_TOOLS = new Set([
  "get_ip_address_report",
  "get_domain_report",
  "get_url_report",
  "search_iocs",
]);

function envStringMap(extra: EnvLike): Record<string, string> {
  const merged = { ...process.env, ...extra };
  return Object.fromEntries(
    Object.entries(merged).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function defaultGtiMcpDir(): string {
  return path.resolve(process.cwd(), "../mcp-security/server/gti/gti_mcp");
}

export function getGtiMcpConfig(env: EnvLike): GtiMcpConfig {
  const command = env.GTI_MCP_COMMAND ?? "uv";
  const serverDirectory = env.GTI_MCP_DIR ?? defaultGtiMcpDir();
  const args = ["--directory", serverDirectory, "run", "server.py"];

  return {
    command,
    args,
    serverDirectory,
    transport: "stdio",
    apiKeyPresent: Boolean(env.VT_APIKEY),
  };
}

function isIpAddress(value: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value.trim());
}

function hostnameFromInput(input: string): string {
  const trimmed = input.trim();

  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return parsed.hostname;
  } catch {
    return trimmed.replace(/^https?:\/\//i, "").split(/[/?#:]/)[0];
  }
}

export function selectGtiTool(indicator: string): GtiToolSelection {
  const trimmed = indicator.trim();

  if (trimmed.includes("://")) {
    return {
      toolName: "get_url_report",
      args: { url: trimmed },
      reason: "The input is a full URL, so GTI URL reporting is the most specific lookup.",
      indicatorType: "url",
    };
  }

  const hostname = hostnameFromInput(trimmed);

  if (isIpAddress(hostname)) {
    return {
      toolName: "get_ip_address_report",
      args: { ip_address: hostname },
      reason: "The input is an IPv4 address, so GTI IP reporting is the most direct lookup.",
      indicatorType: "ip",
    };
  }

  if (hostname.includes(".")) {
    return {
      toolName: "get_domain_report",
      args: { domain: hostname },
      reason: "The input looks like a domain, so GTI domain reporting is the most direct lookup.",
      indicatorType: "domain",
    };
  }

  return {
    toolName: "search_iocs",
    args: { query: trimmed, limit: 10 },
    reason: "The input is not a URL, IP, or domain, so the harness falls back to GTI IOC search.",
    indicatorType: "search",
  };
}

function summarizeTools(tools: Array<{ name: string; description?: string; inputSchema?: unknown }>): GtiToolSummary[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    inputSchema: tool.inputSchema ?? {},
    relevant: RELEVANT_GTI_TOOLS.has(tool.name),
  }));
}

function parseMcpTextResult(result: unknown): { text: string; json: unknown | null } {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  const text = content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");

  if (!text) {
    return { text: "", json: null };
  }

  try {
    return { text, json: JSON.parse(text) };
  } catch {
    return { text, json: null };
  }
}

// Pull the most likely indicator token out of a natural-language request, so the
// deterministic FALLBACK still works if the model is unavailable.
function extractIndicator(query: string): string {
  const url = query.match(/https?:\/\/\S+/i)?.[0];
  if (url) return url;
  const ip = query.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/)?.[0];
  if (ip) return ip;
  const domain = query.match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/i)?.[0];
  if (domain) return domain;
  return query.trim();
}

function buildToolDecisionPrompt(
  query: string,
  tools: readonly GtiToolSummary[],
): { system: string; user: string } {
  const system = [
    "You are a security analyst agent with access to Google Threat Intelligence tools that were discovered live over MCP.",
    "Choose the SINGLE best tool to answer the user's request, and build its arguments from the request and the tool's input schema.",
    'Respond with ONLY a JSON object of the form {"thought": string, "tool": string, "args": object}.',
    "No prose, no markdown, no code fences — just the JSON object.",
  ].join("\n");
  const toolList = tools
    .map((t) => `- ${t.name}: ${t.description || "(no description)"}\n  input schema: ${JSON.stringify(t.inputSchema)}`)
    .join("\n");
  const user = `Available tools (${tools.length}):\n${toolList}\n\nUser request: ${query}`;
  return { system, user };
}

// First balanced JSON object that parses; tolerant of stray prose around it.
function firstJsonObject(text: string): Record<string, unknown> | undefined {
  for (let s = 0; s < text.length; s += 1) {
    if (text[s] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = s; i < text.length; i += 1) {
      const ch = text[i];
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(text.slice(s, i + 1));
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              return parsed as Record<string, unknown>;
            }
          } catch {
            // not valid JSON from this brace; keep scanning
          }
          break;
        }
      }
    }
  }
  return undefined;
}

function parseAgentDecision(
  text: string,
  available: ReadonlySet<string>,
): { thought: string; tool: string; args: Record<string, unknown> } | undefined {
  const parsed = firstJsonObject(text);
  if (!parsed) return undefined;
  const tool = typeof parsed.tool === "string" ? parsed.tool : "";
  if (!available.has(tool)) return undefined;
  const args = parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args)
    ? (parsed.args as Record<string, unknown>)
    : {};
  const thought = typeof parsed.thought === "string" && parsed.thought.trim()
    ? parsed.thought.trim()
    : "No rationale provided.";
  return { thought, tool, args };
}

// The agent step: hand the discovered tools + the user's request to the model and
// let IT choose the tool and arguments. Falls back to a deterministic rule only if
// the model is unavailable or returns something unusable, so the lab always runs.
async function decideTool(
  query: string,
  tools: readonly GtiToolSummary[],
): Promise<GtiAgentDecision> {
  try {
    const provider = getProvider();
    const { system, user } = buildToolDecisionPrompt(query, tools);
    const result = await provider.invoke({ systemPrompt: system, userPrompt: user });
    const available = new Set(tools.map((t) => t.name));
    const parsed = parseAgentDecision(result.text, available);
    if (!parsed) throw new Error("Model did not return a valid tool decision.");
    return {
      toolName: parsed.tool,
      args: parsed.args,
      thought: parsed.thought,
      source: "model",
      model: result.model,
    };
  } catch (error) {
    const fallback = selectGtiTool(extractIndicator(query));
    const reason = error instanceof Error ? error.message : String(error);
    return {
      toolName: fallback.toolName,
      args: fallback.args,
      thought: `Model selection unavailable (${reason}); fell back to a deterministic rule — ${fallback.reason}`,
      source: "fallback",
    };
  }
}

export async function runGtiMcpLifecycle(options: {
  readonly query: string;
  readonly env: EnvLike;
  readonly emit: EmitLifecycleEvent;
}): Promise<void> {
  const config = getGtiMcpConfig(options.env);
  let client: Client | null = null;

  const connectStart = Date.now();
  options.emit({
    step: "connect",
    status: "start",
    message: "Starting Google GTI MCP server over stdio.",
    details: config,
  });

  try {
    if (!config.apiKeyPresent) {
      throw new Error("VT_APIKEY is not configured.");
    }

    const transport = new StdioClientTransport({
      command: config.command,
      args: [...config.args],
      env: envStringMap(options.env),
    });

    client = new Client(
      { name: "antisiphon-lab04-gti", version: "1.0.0" },
      { capabilities: {} },
    );

    await client.connect(transport);

    options.emit({
      step: "connect",
      status: "ok",
      message: "Connected to GTI MCP server.",
      durationMs: Date.now() - connectStart,
      details: config,
    });

    const discoverStart = Date.now();
    options.emit({
      step: "discover",
      status: "start",
      message: "Calling listTools() against the MCP server.",
    });

    const listToolsResult = await client.listTools();
    const tools = summarizeTools(listToolsResult.tools);

    options.emit({
      step: "discover",
      status: "ok",
      message: `Discovered ${tools.length} GTI MCP tools.`,
      durationMs: Date.now() - discoverStart,
      details: {
        toolCount: tools.length,
        tools,
      },
    });

    // DECIDE — hand the discovered tools to the agent and let IT choose.
    const decideStart = Date.now();
    options.emit({
      step: "decide",
      status: "start",
      message: "Asking the agent to choose a tool from the discovered set.",
      details: { query: options.query },
    });

    const decision = await decideTool(options.query, tools);

    options.emit({
      step: "decide",
      status: "ok",
      message: `Agent chose ${decision.toolName}${decision.source === "fallback" ? " (deterministic fallback)" : ""}.`,
      durationMs: Date.now() - decideStart,
      details: { decision, query: options.query },
    });

    const callStart = Date.now();
    options.emit({
      step: "call",
      status: "start",
      message: `Calling ${decision.toolName}.`,
      details: decision,
    });

    const callResult = await client.callTool({
      name: decision.toolName,
      arguments: decision.args,
    });
    const parsed = parseMcpTextResult(callResult);

    options.emit({
      step: "call",
      status: "ok",
      message: "GTI MCP tool call completed.",
      durationMs: Date.now() - callStart,
      details: {
        decision,
        rawResult: callResult,
        textResult: parsed.text,
        parsedJson: parsed.json,
      },
    });

    options.emit({
      step: "done",
      status: "ok",
      message: "MCP lifecycle completed.",
    });
  } catch (error) {
    options.emit({
      step: "done",
      status: "error",
      message: error instanceof Error ? error.message : "Unknown MCP lifecycle failure.",
    });
  } finally {
    await client?.close();
  }
}
