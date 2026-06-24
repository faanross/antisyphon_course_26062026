// Build a CLEAN, pre-chunk reports.json for Lab 08's CorpusBrowser, parsed straight from the
// data/rag/corpus/*.md source reports. The corpus browser shows the WHOLE report a human reads
// (pre-chunk) — chunking is a separate concept the lab teaches in the Retrieved Chunks panel and
// the Code tab. Title / verdict / tags are taken from chunks.json so the corpus metadata stays
// identical to the retrieval index.
//
//   npm run rag:corpus
//
// Pure markdown parsing — no Ollama, unlike rag:build (which embeds the chunks).

import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

const RAG_DIR = path.join(process.cwd(), "data", "rag");
const CORPUS_DIR = path.join(RAG_DIR, "corpus");
const OUT_SOURCE = path.join(RAG_DIR, "reports.json");
const OUT_BUNDLE = path.join(process.cwd(), "src", "lib", "data", "workshop", "rag", "reports.json");

// Split a report's markdown into its `## Heading` sections, with light cleanup (strip bold
// markers, collapse runs of blank lines). The `# Investigation Report:` H1 is intentionally
// dropped — the report id/title are shown in the card head.
function parseSections(raw) {
  const sections = [];
  let cur = null;
  for (const line of raw.split("\n")) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      if (cur) sections.push(cur);
      cur = { heading: m[1], text: "" };
    } else if (cur) {
      cur.text += `${line}\n`;
    }
  }
  if (cur) sections.push(cur);
  return sections
    .map((s) => ({ heading: s.heading, text: s.text.replace(/\*\*/g, "").replace(/\n{3,}/g, "\n\n").trim() }))
    .filter((s) => s.text.length > 0);
}

async function main() {
  const chunks = JSON.parse(await readFile(path.join(RAG_DIR, "chunks.json"), "utf8"));
  const meta = new Map();
  for (const c of chunks) {
    if (!meta.has(c.source_report)) meta.set(c.source_report, { title: c.report_title, verdict: c.verdict, tags: c.tags });
  }

  const files = (await readdir(CORPUS_DIR)).filter((f) => f.endsWith(".md")).sort();
  const reports = [];
  for (const f of files) {
    const id = f.replace(/\.md$/, "");
    const raw = await readFile(path.join(CORPUS_DIR, f), "utf8");
    const m = meta.get(id) ?? { title: id, verdict: "", tags: [] };
    reports.push({ id, title: m.title, verdict: m.verdict, tags: m.tags, sections: parseSections(raw) });
  }

  const json = `${JSON.stringify(reports, null, 2)}\n`;
  await writeFile(OUT_SOURCE, json);
  await writeFile(OUT_BUNDLE, json);
  console.log(`Wrote ${reports.length} clean reports to data/rag/reports.json and src/lib/data/workshop/rag/reports.json`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
