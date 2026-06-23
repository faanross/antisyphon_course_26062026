// Build the RAG vector index for Lab 08 from the existing chunks, using the REAL embedding
// model (nomic-embed-text via Ollama). Run once whenever the corpus or the embedding model
// changes, then commit the regenerated data/rag/vectors.bin:
//
//   npm run rag:build
//
// Plain ESM JS (no TS toolchain) so it runs on every Node version this repo supports.
// The embed call MUST stay in sync with src/framework/embeddings.ts (the query path):
// same model, base URL, 768 dims, and L2-normalization. Only the nomic task prefix differs —
// "search_document:" here, "search_query:" at search time.
//
// Output: data/rag/vectors.bin — raw float32 LE, row-major (chunk i, dim j at (i*dims+j)*4),
// exactly the layout src/framework/rag.ts reads back.

import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = (process.env.EMBED_BASE_URL ?? "http://localhost:11434").replace(/\/+$/, "");
const MODEL = process.env.EMBED_MODEL ?? "nomic-embed-text";
const DIMENSIONS = 768;

const RAG_DIR = path.join(process.cwd(), "data", "rag");
const DISPLAY_META = path.join(process.cwd(), "src", "lib", "data", "workshop", "rag", "store-meta.json");

async function embedDocument(text) {
  const response = await fetch(`${BASE_URL}/api/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt: `search_document: ${text}` }),
  });
  if (!response.ok) {
    throw new Error(`Ollama ${BASE_URL} returned HTTP ${response.status}. Is '${MODEL}' pulled?  (ollama pull ${MODEL})`);
  }
  const { embedding } = await response.json();
  if (!Array.isArray(embedding) || embedding.length !== DIMENSIONS) {
    const got = Array.isArray(embedding) ? embedding.length : typeof embedding;
    throw new Error(`Expected a ${DIMENSIONS}-dim embedding from '${MODEL}', got ${got}.`);
  }
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0)) || 1;
  return embedding.map((v) => v / norm);
}

async function updateMeta(file, chunkCount) {
  const meta = JSON.parse(await readFile(file, "utf8"));
  meta.embedding_model = MODEL;
  meta.dimensions = DIMENSIONS;
  meta.chunk_count = chunkCount;
  meta.index_format = "raw-float32-row-major-cosine";
  meta.build_tool = "build-rag-index.mjs (ollama)";
  meta.build_date = new Date().toISOString();
  await writeFile(file, `${JSON.stringify(meta, null, 2)}\n`);
}

async function main() {
  const chunks = JSON.parse(await readFile(path.join(RAG_DIR, "chunks.json"), "utf8"));
  console.log(`Embedding ${chunks.length} chunks with '${MODEL}' @ ${BASE_URL} ...`);

  const buffer = Buffer.alloc(chunks.length * DIMENSIONS * 4);
  for (let i = 0; i < chunks.length; i += 1) {
    const vector = await embedDocument(chunks[i].text);
    for (let col = 0; col < DIMENSIONS; col += 1) {
      buffer.writeFloatLE(vector[col], (i * DIMENSIONS + col) * 4);
    }
    if ((i + 1) % 16 === 0 || i === chunks.length - 1) console.log(`  embedded ${i + 1}/${chunks.length}`);
  }

  await writeFile(path.join(RAG_DIR, "vectors.bin"), buffer);
  await updateMeta(path.join(RAG_DIR, "store-meta.json"), chunks.length);
  await updateMeta(DISPLAY_META, chunks.length).catch(() => {
    /* display copy is best-effort; data/rag/store-meta.json is the source of truth */
  });

  console.log(`Wrote data/rag/vectors.bin (${chunks.length} x ${DIMENSIONS} float32) and updated store-meta.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
