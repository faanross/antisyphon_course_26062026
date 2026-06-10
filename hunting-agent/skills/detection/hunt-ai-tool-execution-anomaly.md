---
name: hunt-ai-tool-execution-anomaly
version: 2.0
layer: detection
model: frontier
description: "Detect a coding / AI assistant spawning a rare child process — the initial-access foothold of an AI-assisted intrusion (poisoned coding assistant)"
mitreTechniques: [T1059.001, T1027, T1204.002]
invocationTriggerCandidate: unusual_parent_child_anomaly
invocationGate:
  minParentChildRarity: 0.85
correlatingCandidates:
  - type: powershell_invocation_anomaly
    scope: same_process_secondary_flow
---

# Objective

Determine whether a **rare parent→child process spawn** represents adversary execution riding on a developer's AI coding assistant, rather than benign tooling. Reason **only** from candidate evidence — process lineage, command line, and the correlating PowerShell payload candidate. Do not read asset records, threat-intel RAG, or business-impact context; those belong to assessment skills.

This detector is the **entry point of the kill chain**: a coding/AI tool (or a process it spawned) launches something it has essentially never launched before. Downstream, that child often carries an encoded PowerShell payload (`hunt-malicious-powershell-payload`) and ultimately a masquerading implant that beacons to C2 (`hunt-c2-over-https`).

# Procedure

Load the trigger `unusual_parent_child_anomaly` candidate first. Inspect:

- `parent_process_name` / `parent_image` — **is the parent a known coding / AI assistant?** (see `AI_TOOL_PARENTS` below)
- `process_name` / `image` — the spawned child; note `process_rarity` (1.0 = never-seen-before binary, e.g. a masquerading `svchost-health.exe` running from a user `\Temp` path)
- `parent_child_pair_rarity` (and `parent_child_pair_frequency`) — how unusual this lineage is across the fleet
- `command_line` — encoded / hidden / download indicators on the child invocation

Then inspect the correlating `powershell_invocation_anomaly` candidate on the `same_process_secondary_flow` scope (same `process_guid` as the spawned child). Treat an absent correlating candidate as **absent evidence — score 0 on its dimension** — never phantom-score it.

# Scoring

The dimensions are **passthroughs of the candidates' own composite scores** — you select and fuse them, you do not re-derive lineage rarity from raw Sysmon EID 1 events:

- `lineage_rarity`     = `unusual_parent_child_anomaly.compositeScore` — the rare parent→child spawn itself
- `payload_amplifier`  = `powershell_invocation_anomaly.compositeScore` (0.0 if absent) — an encoded payload on the spawned child sharply raises confidence that the spawn is malicious

`compositeScore = max(lineage_rarity, payload_amplifier)` — the **maximum decisive malicious dimension, never an average** that washes out strong evidence.

**High-fidelity amplifier — AI-tool parentage.** When `parent_image` is one of the recognised coding / AI assistants, this is a high-fidelity *initial-access* signal (a developer's trusted tool was the launch point) and you should assert **T1204.002 (User Execution)** and lead the narrative with it:

```
AI_TOOL_PARENTS = Code.exe, Cursor.exe, cline.exe, claude-code, windsurf.exe, cody.exe, continue.exe
```

This list is an evidence amplifier, **not** the gate — the candidate also fires when the parent is an already-compromised process (e.g. `powershell.exe` spawning a masquerading implant), caught by the high `parent_child_pair_rarity`.

For each fired dimension, write an `evidence` string citing the **decisive observation** (e.g. *"Code.exe → powershell.exe, pair_rarity 0.95 — never seen on 200-host fleet"*), not just the score.

# Benign fallbacks

Rule out benign causes by matching the observed evidence against each cause's shape: an IDE's integrated terminal or task runner launching `powershell` for a build / lint / test, a package manager (npm/pip/choco) post-install script, an extension host, or a one-off developer command. A coding tool spawning PowerShell is **common and usually benign** — what makes *this* malicious is the combination of rare lineage **and** an encoded/hidden payload or a never-seen child binary in a `\Temp` path. List ruled-out causes in `benignFallbackRuledOut`; if a cause cannot be confidently ruled out, say so in the narrative.

# Output Contract

Return a `DetectionFinding` with `compositeScore`, `dimensions`, `evidenceSummary`, `attackNarrative`, `uncertainty`, `benignFallbackRuledOut`, `mitreTechniques`, and `evidenceRefs` (the candidate IDs that fired plus their constituent event IDs). Every assertion must trace to a candidate field or a skill-derived observation — **no unsourced claims**.

# Anti-patterns — do not do

- Flagging **every** `Code.exe → powershell.exe` as malicious — developers do this constantly; require rare lineage plus payload/binary evidence.
- Re-deriving the parent→child rarity from raw `sysmon_eid1_process_create` events — the candidate already scored it; consume its composite.
- Treating an absent correlating PowerShell candidate as 1.0 via phantom scoring — absent is 0 on `payload_amplifier`; `lineage_rarity` still carries the composite via `max()`.
