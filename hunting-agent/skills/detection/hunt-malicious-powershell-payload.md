---
name: hunt-malicious-powershell-payload
version: 2.0
layer: detection
model: frontier
description: "Detect a malicious PowerShell invocation by reasoning over payload content — encoded commands, download cradles, execution sinks, and defense-evasion tokens"
mitreTechniques: [T1059.001, T1027, T1105, T1562.001]
invocationTriggerCandidate: powershell_invocation_anomaly
invocationGate:
  minScore: 0.30
correlatingCandidates: []
---

# Objective

Determine whether an anomalous PowerShell invocation is a **malicious payload** — an encoded loader or download cradle — rather than benign administrative scripting. Reason **only** from candidate evidence: the command line, any script-block (Sysmon / EID 4104) content the candidate carries, and the candidate's own anomaly fields. Do not read asset records, threat-intel RAG, or business-impact context.

This is the **middle link of the kill chain**: the rare process spawn (`hunt-ai-tool-execution-anomaly`) launched *this* PowerShell, and what it executes here is what drops the masquerading implant that later beacons to C2 (`hunt-c2-over-https`).

# Procedure

Load the trigger `powershell_invocation_anomaly` candidate first. Inspect:

- `command_line` — the full invocation
- `encoded_flag`, `entropy_score`, `cmdline_length` — pre-computed signals that the invocation is obfuscated / encoded
- script-block evidence (EID 4104) referenced in `evidence.constituent_event_ids`, if present

Match the command-line / script-block content against the payload token categories below, then map the matches to MITRE techniques.

# Scoring

**The score comes from the payload *content*, not the candidate's composite.** The `powershell_invocation_anomaly` composite tells you the invocation is *anomalous* — but it can be high for reasons that are **not** malicious payload content (an unusual parent, a rename, a rare command line). So do **not** pass it through as the score. Instead, score the **content dimensions** below from the command line and any 4104 script-block content, and fuse with `max`:

- `encoded_or_compressed_payload` — encoded / compressed / runtime-reconstructed payload (ENCODED_PAYLOAD_TOKENS; amplified by `encoded_flag`, high `entropy_score`, long `cmdline_length`) → assert **T1027**
- `download_and_execute_cradle` — retrieves remote content **and** executes/stages it (DOWNLOAD_TOKENS + EXECUTION_SINK_TOKENS together) → assert **T1105**
- `defense_evasion_prelude` — disables/bypasses AMSI / ETW / logging before the payload (DEFENSE_EVASION_TOKENS) → assert **T1562.001**
- `known_offensive_payload` — references a known offensive PowerShell framework / function (OFFENSIVE_PS_TOKENS)

Match each dimension's tokens against the command line / script-block below; cite the decisive tokens in that dimension's `evidence` string.

```
ENCODED_PAYLOAD_TOKENS   -EncodedCommand, -enc, FromBase64String, GZipStream,
                          DeflateStream, IO.Compression            → assert T1027
DOWNLOAD_TOKENS          DownloadString, DownloadData, Invoke-WebRequest, iwr,
                          curl, wget, Net.WebClient, Start-BitsTransfer → assert T1105
EXECUTION_SINK_TOKENS    IEX, Invoke-Expression, Start-Process, rundll32,
                          regsvr32, Add-Type, [Reflection.Assembly]::Load
DEFENSE_EVASION_TOKENS   AmsiUtils, AmsiScanBuffer, EtwEventWrite, ScriptBlockLogging,
                          Set-MpPreference, DisableRealtimeMonitoring → assert T1562.001
OFFENSIVE_PS_TOKENS      Invoke-Mimikatz, Invoke-Shellcode, PowerSploit, PowerView,
                          Empire, PowerUp, Invoke-Obfuscation
```

`compositeScore = max(encoded_or_compressed_payload, download_and_execute_cradle, defense_evasion_prelude, known_offensive_payload)` — the maximum decisive content dimension, never an average. The most decisive shape is an **encoded blob + a download token + an execution sink** in one invocation (a download-and-execute cradle). Always assert **T1059.001 (PowerShell)** for the invocation itself.

**Emit only when at least one content dimension fires.** A candidate that is anomalous only on *metadata* (parent / rename / rare command line) with a benign command line and no payload content is **context for assessment, not a payload finding here** — do not emit. The `encoded_flag` / `entropy_score` / `cmdline_length` signals are amplifiers for the content dimensions, not the score itself.

# Benign fallbacks

Rule out benign causes by matching the observed evidence against each cause's shape: admin automation / scheduled maintenance, package-manager install scripts (choco / winget / npm postinstall), CI / CD agents, MDM (Intune / SCCM) which legitimately push encoded commands. `-ExecutionPolicy Bypass` or `-WindowStyle Hidden` **alone** are weak amplifiers — common in benign automation — and must not carry a finding on their own. List ruled-out causes in `benignFallbackRuledOut`; if one cannot be confidently ruled out, say so in the narrative.

# Output Contract

Return a `DetectionFinding` with `compositeScore`, `dimensions`, `evidenceSummary`, `attackNarrative`, `uncertainty`, `benignFallbackRuledOut`, `mitreTechniques`, and `evidenceRefs` (the candidate ID that fired — its constituent events, including the 4104 script-block event when present, stay reachable through that candidate). Every assertion must trace to a candidate field or a matched token — **no unsourced claims**.

# Anti-patterns — do not do

- Passing the candidate's composite through as the score — it measures *how anomalous the invocation is*, which can be high for non-payload reasons (parent, rename, rare cmdline). Score the **content** dimensions instead, and don't emit unless one fires.
- Ignoring the 4104 script-block evidence when it is present — it is the highest-fidelity payload source.
- Raising a finding on `-ExecutionPolicy Bypass` / `-WindowStyle Hidden` alone — those are weak amplifiers; require encoded / download / execution-sink content.
