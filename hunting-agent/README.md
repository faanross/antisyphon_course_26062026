# AntiSyphon Workshop Reference App

This is the tested SvelteKit reference implementation for the June 2026 AntiSyphon workshop labs.

It includes:

- Lab 01 walkthrough — streaming agent state end-to-end
- Lab 02 distillation pipeline over generated connection-pair data
- Lab 03 context window — what the agent actually sees
- Lab 04 TAO candidate triage with an in-process tool surface
- Lab 05 real Google Threat Intelligence MCP connection/discovery/call flow
- Lab 06 detection skills — structure-first DetectionFinding (model emits typed JSON, gated)
- Lab 07 assessment context — structure-first AssessmentFinding, enriches the detection finding
- Lab 08 prior-investigation RAG over the generated vector store
- Lab 09 fan-out / fan-in orchestration
- Lab 10 knowledge graph shared state
- Lab 11 graph-grounded narrative synthesis
- Lab 12 feedback + final report + notification hook
- Lab 13 complete hunt capstone (the whole pipeline in one run)
- Lab 14 further learning and production extension paths
- Bonus — give the agent a real shell, gated by a deny/ask/allow policy

The app defaults to `LLM_PROVIDER=mock` when no `.env` file is present, so it can be checked, built, and smoke-tested without API keys.

## Setup

**Requires Node 22.12+** (or 20.19+ / 24+ — Vite 8 is unstable on older Node and the dev server will crash). `npm ci` and `npm run dev` both refuse to run on an unsupported version and print how to switch. Easiest path: run `./setup.sh` (macOS/Linux) or `powershell -ExecutionPolicy Bypass -File setup.ps1` (Windows) — it installs the right Node + dependencies. With nvm/fnm, `nvm use` in this folder picks up the pinned `.nvmrc` (22.12.0).

```bash
npm ci
npm run check
npm run build
npm run dev -- --host 127.0.0.1 --port 5174
```

Open `http://127.0.0.1:5174/` and navigate to any lab.

### Lab 08 (RAG) — local embedding model

Lab 08 embeds text with a real local model, separate from your chat `LLM_PROVIDER`. Install [Ollama](https://ollama.com) and pull the model once:

```bash
ollama pull nomic-embed-text
```

Defaults to `http://localhost:11434` (`nomic-embed-text`); override with `EMBED_BASE_URL` / `EMBED_MODEL`. The vector index `data/rag/vectors.bin` is committed; regenerate it with `npm run rag:build` (needs Ollama). The clean, pre-chunk corpus the browser displays, `data/rag/reports.json`, is rebuilt from `data/rag/corpus/*.md` with `npm run rag:corpus` (no Ollama).

## Data

The app consumes the generated workshop artifacts in:

- `data/candidates_enriched.json`
- `data/events_enriched.json`
- `data/rag/chunks.json`
- `data/rag/vectors.bin`
- `data/rag/reports.json`
- `skills/`
- `context/`
- `graph/`

The same client-safe candidate/chunk data is mirrored under `src/lib/data/workshop/` for Svelte pages that render static summaries.
