import { readFile } from "node:fs/promises";
import path from "node:path";
import { embedText } from "./embeddings.js";

export interface RagChunk {
  readonly chunk_id: string;
  readonly source_report: string;
  readonly report_title: string;
  readonly verdict: string;
  readonly tags: readonly string[];
  readonly section: string;
  readonly text: string;
  readonly token_count: number;
}

export interface RagHit extends RagChunk {
  readonly score: number;
}

export interface RagStoreMeta {
  readonly embedding_model: string;
  readonly dimensions: number;
  readonly chunk_count: number;
  readonly index_format: string;
}

function dot(a: readonly number[], b: readonly number[]): number {
  let score = 0;
  for (let i = 0; i < a.length; i += 1) score += a[i] * b[i];
  return score;
}

function readVector(buffer: Buffer, row: number, dimensions: number): number[] {
  const vector: number[] = [];
  for (let col = 0; col < dimensions; col += 1) {
    vector.push(buffer.readFloatLE((row * dimensions + col) * 4));
  }
  return vector;
}

export async function loadRagStore(root = "data/rag"): Promise<{
  chunks: RagChunk[];
  meta: RagStoreMeta;
  vectors: Buffer;
}> {
  const base = path.join(process.cwd(), root);
  const [chunksRaw, metaRaw, vectors] = await Promise.all([
    readFile(path.join(base, "chunks.json"), "utf8"),
    readFile(path.join(base, "store-meta.json"), "utf8"),
    readFile(path.join(base, "vectors.bin")),
  ]);
  const chunks = JSON.parse(chunksRaw) as RagChunk[];
  const meta = JSON.parse(metaRaw) as RagStoreMeta;
  if (vectors.byteLength !== chunks.length * meta.dimensions * 4) {
    throw new Error("RAG vector file size does not match chunk metadata");
  }
  return { chunks, meta, vectors };
}

// Embed a query string into a vector (the "query" task-prefix variant). Exposed so a caller that
// also wants to SHOW the vector (e.g. Lab 08's embed-stage preview) can embed once and reuse it.
export async function embedQuery(query: string): Promise<number[]> {
  return embedText(query, "query");
}

// Pass `precomputed` to reuse a vector you already embedded and skip a second embed call.
export async function queryPriorInvestigations(query: string, k = 5, precomputed?: number[]): Promise<RagHit[]> {
  const { chunks, meta, vectors } = await loadRagStore();
  const queryVector = precomputed ?? (await embedText(query, "query"));
  if (queryVector.length !== meta.dimensions) {
    throw new Error(
      `Query embedding has ${queryVector.length} dims but the index expects ${meta.dimensions}. ` +
        `Rebuild data/rag/vectors.bin with: npm run rag:build`,
    );
  }
  return chunks
    .map((chunk, index) => {
      const score = dot(queryVector, readVector(vectors, index, meta.dimensions));
      return { ...chunk, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export function buildRagContext(hits: readonly RagHit[]): string {
  return hits
    .map((hit) => `[${hit.source_report} ${hit.section} score=${hit.score.toFixed(3)}]\n${hit.text}`)
    .join("\n\n");
}
