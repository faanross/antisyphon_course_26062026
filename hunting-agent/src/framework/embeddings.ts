// Real text embeddings for the RAG lab (Lab 08), served by a local Ollama instance.
//
// This is the ONE source of truth for turning text into a vector, shared by both
// the index builder (scripts/build-rag-index.ts) and query-time retrieval (rag.ts).
// Build-time and query-time MUST embed the same way or cosine similarity is meaningless.
//
// Model: nomic-embed-text (768-dim). nomic expects a task prefix on every input:
//   "search_query: ..."     for the user's question
//   "search_document: ..."  for the corpus chunks
// Ollama returns un-normalized vectors, so we L2-normalize here — that makes cosine
// similarity a plain dot product (see `dot()` in rag.ts).
//
// NOTE: scripts/build-rag-index.mjs mirrors this logic to build the index offline (plain JS,
// so it runs without a TS toolchain on any supported Node). Keep model / dimensions /
// normalization in sync between the two.

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_MODEL = "nomic-embed-text";

// nomic-embed-text is fixed at 768 dimensions; the shipped vectors.bin is built to match.
// Pointing EMBED_MODEL at a different-sized model would silently break retrieval, so we
// validate against this and fail loudly instead.
export const EMBED_DIMENSIONS = 768;

export type EmbedKind = "query" | "document";

// Read lazily so a student's .env (EMBED_BASE_URL / EMBED_MODEL) is honored at call time.
function baseUrl(): string {
  return (process.env.EMBED_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}
function modelName(): string {
  return process.env.EMBED_MODEL ?? DEFAULT_MODEL;
}

export function embedConfig(): { baseUrl: string; model: string } {
  return { baseUrl: baseUrl(), model: modelName() };
}

// Thrown when the embedding model can't be reached or returns an unusable result.
// The Lab 08 route turns this into a friendly 503 so students see "start Ollama",
// not a stack trace.
export class EmbeddingUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EmbeddingUnavailableError";
  }
}

function setupHint(): string {
  return (
    `Could not reach the embedding model '${modelName()}' at ${baseUrl()}. ` +
    `The RAG lab needs Ollama running with the model pulled:  ollama pull ${DEFAULT_MODEL}  ` +
    `(or set EMBED_BASE_URL / EMBED_MODEL). See docs/setup-guide.html.`
  );
}

function prefixed(text: string, kind: EmbedKind): string {
  return `${kind === "query" ? "search_query" : "search_document"}: ${text}`;
}

function l2normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm || !Number.isFinite(norm)) {
    throw new EmbeddingUnavailableError(`Embedding model '${modelName()}' returned a zero/invalid vector.`);
  }
  return vector.map((value) => value / norm);
}

// Turn one piece of text into a normalized embedding vector.
export async function embedText(text: string, kind: EmbedKind): Promise<number[]> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}/api/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: modelName(), prompt: prefixed(text, kind) }),
    });
  } catch (cause) {
    throw new EmbeddingUnavailableError(setupHint(), { cause });
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new EmbeddingUnavailableError(
      `${setupHint()} (HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""})`,
    );
  }

  const data = (await response.json().catch(() => ({}))) as { embedding?: unknown };
  const embedding = data.embedding;
  if (
    !Array.isArray(embedding) ||
    embedding.length !== EMBED_DIMENSIONS ||
    !embedding.every((value) => typeof value === "number")
  ) {
    const got = Array.isArray(embedding) ? `${embedding.length} numbers` : typeof embedding;
    throw new EmbeddingUnavailableError(
      `Embedding model '${modelName()}' returned an unexpected shape (want ${EMBED_DIMENSIONS} numbers, got ${got}). ` +
        `Is EMBED_MODEL a 768-dim embedding model?`,
    );
  }

  return l2normalize(embedding as number[]);
}
