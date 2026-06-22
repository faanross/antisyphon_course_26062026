// Context resolution for Lab 07 assessment — extracted from the Lab 07 route so the
// assessment tools and the route share ONE source of truth for the entity -> file mapping.
// Behavior is identical to the prior in-route implementation.
import { error } from "@sveltejs/kit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SkillDocument, SkillMetadata } from "./skill-loader.js";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function asString(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

export const FIELD_GUIDE_PATH = "context/schema/candidate-field-guide.md";

export type ContextRequirement = {
  id: string;
  mode: "static" | "resolve" | "retrieval" | string;
  path: string; // mode:static — a fixed, org-wide file (e.g. an escalation policy)
  entity?: string; // mode:resolve — which finding entity to key off (host | user | subnet)
  layer?: string; // mode:resolve — the context layer directory to look in
  suffix?: string; // mode:resolve — optional filename suffix (e.g. "-history")
  reason: string;
};

export type ResolvedContext = ContextRequirement & {
  content: string;
  approxTokens: number;
  resolvedFrom?: string; // mode:resolve — the entity value it resolved to (e.g. "host=dev-ws03")
};

export async function readTextFile(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), "utf8");
}

function normalizeContextPath(contextPath: string): string {
  const normalized = path.normalize(contextPath).replaceAll("\\", "/");
  if ((!normalized.startsWith("context/") && !normalized.startsWith("data/")) || normalized.includes("../")) {
    throw error(400, "Context path must point to a workshop context or data file.");
  }
  return normalized;
}

export function contextRequirements(metadata: SkillMetadata): ContextRequirement[] {
  return asArray(metadata.contextRequirements).map((item, index) => {
    const record = asRecord(item);
    return {
      id: asString(record.id || `context-${index + 1}`),
      mode: asString(record.mode || "static"),
      path: asString(record.path),
      entity: record.entity ? asString(record.entity) : undefined,
      layer: record.layer ? asString(record.layer) : undefined,
      suffix: record.suffix ? asString(record.suffix) : undefined,
      reason: asString(record.reason || "Required by skill frontmatter."),
    };
  });
}

function approxTokens(content: string): number {
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * 1.35));
}

// Deterministically derive the entity keys the resolver uses, from the finding's trigger candidate.
// host "DEV-WS03" -> "dev-ws03"; user "NORTHWIND\jane.roberts" -> "jane-roberts"; src_ip -> a subnet slug.
function slugifyEntity(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[^\\]*\\/, "") // strip a leading DOMAIN\ from a user principal
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function findingEntities(candidate: Record<string, unknown>): Record<string, string> {
  const ip = asString(candidate.src_ip);
  const subnet = ip ? `subnet-${ip.split(".").slice(0, 3).join("-")}` : "";
  return {
    host: slugifyEntity(asString(candidate.host)),
    user: slugifyEntity(asString(candidate.user)),
    subnet,
  };
}

export async function resolveContextRequirement(
  requirement: ContextRequirement,
  entities: Record<string, string>,
): Promise<ResolvedContext> {
  // Entity-scoped context: pick the file for the FINDING'S entity — deterministic, never hardcoded.
  if (requirement.mode === "resolve") {
    const entityKey = requirement.entity ?? "";
    const entityValue = entities[entityKey] ?? "";
    if (!entityValue) {
      throw error(400, `Could not resolve entity '${entityKey}' from the finding for context '${requirement.id}'.`);
    }
    const builtPath = `context/layers/${requirement.layer ?? "layer_1_assets"}/${entityValue}${requirement.suffix ?? ""}.md`;
    const normalizedPath = normalizeContextPath(builtPath);
    const content = await readTextFile(normalizedPath);
    return {
      ...requirement,
      path: normalizedPath,
      content,
      approxTokens: approxTokens(content),
      resolvedFrom: `${entityKey}=${entityValue}`,
    };
  }

  if (requirement.mode !== "static") {
    throw error(400, `Lab 07 cannot resolve ${requirement.mode} context. Use Lab 08 for retrieval-backed context.`);
  }

  const normalizedPath = normalizeContextPath(requirement.path);
  const content = await readTextFile(normalizedPath);
  return {
    ...requirement,
    path: normalizedPath,
    content,
    approxTokens: approxTokens(content),
  };
}

export async function resolveContextBundle(skill: SkillDocument, entities: Record<string, string>) {
  const schema = await resolveContextRequirement(
    {
      id: "schema.candidate-field-guide",
      mode: "static",
      path: FIELD_GUIDE_PATH,
      reason: "Shared candidate field definitions used by all assessment skills.",
    },
    entities,
  );

  const requirements = await Promise.all(
    contextRequirements(skill.metadata).map((requirement) => resolveContextRequirement(requirement, entities)),
  );
  return { schema, requirements };
}
