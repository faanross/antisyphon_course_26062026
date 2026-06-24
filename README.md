# AntiSyphon Course — Agentic Threat Hunting

An interactive, browser-based course where you build an agentic threat-hunting system one
piece at a time — from a first model-backed pipeline, through detection and assessment
skills, retrieval (RAG), fan-out / fan-in orchestration, a knowledge graph and a
graph-grounded narrative, to a full end-to-end capstone hunt.

> **The lab instructions live inside the app.** Each lab is a page with its own
> walkthrough plus explainer tabs (**Code**, and lab-specific ones like **Targeting**,
> **Execution Trace**, **Handoff**, **At Scale**) that show what's happening behind the
> scenes. There's nothing extra to read here — get it running and follow along on screen.

Covers **Labs 01–12**, plus two **bonus** labs (further learning, and giving the agent a shell).

---

## What's in here

| Folder | What it is |
|---|---|
| `hunting-agent/` | The lab app (SvelteKit). **This is what you run.** |
| `mcp-security/` | Google's GTI MCP server, vendored — used by Lab 05. No separate clone needed. |
| `docs/` | Full step-by-step setup guide (`docs/setup-guide.html`) — open it if you want detail. |

---

## Setup

You only need **Node** to run the labs — the setup script handles the rest.

**1. Install dependencies** (from `hunting-agent/`):

- macOS / Linux:
  ```bash
  cd hunting-agent && bash ./setup.sh
  ```
- Windows (PowerShell):
  ```powershell
  cd hunting-agent
  powershell -ExecutionPolicy Bypass -File setup.ps1
  ```

**2. Choose a model provider:**

```bash
cp .env.example .env     # Windows: copy .env.example .env
```

Open `.env` and set `LLM_PROVIDER`. No API key? **Google AI Studio** gives a free one for
`gemini-2.5-flash`. CLI providers (`claude-code`, `codex-cli`) work too if you have them installed.

**3. Set up the GTI lab (MCP) — Lab 05:**

Lab 05 makes a **real** call to Google Threat Intelligence over MCP. Two prerequisites:

- **`uv`** (installs Python automatically — a single binary):
  - macOS / Linux: `curl -LsSf https://astral.sh/uv/install.sh | sh`
  - Windows: see `docs/setup-guide.html`.
- A free **VirusTotal API key** in your `.env` (`VT_APIKEY=…`) — get one at
  [virustotal.com/gui/my-apikey](https://www.virustotal.com/gui/my-apikey).

The MCP server is bundled (`mcp-security/`) — no separate download. The first Lab 05 run
pauses a few seconds while `uv` fetches its Python deps; that's normal, once only.

**4. Run the lab server** — from a **fresh terminal** (so it picks up Node and `uv` on your `PATH`):

```bash
cd hunting-agent && npm run dev
```

Open the URL it prints (usually **http://localhost:5173**) and start at Lab 01.

---

Happy hunting!
