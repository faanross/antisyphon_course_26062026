---
name: hunt-c2-over-https
version: 2.0
layer: detection
model: frontier
description: "Detect likely C2 beaconing over HTTPS by fusing beacon, TLS, intel, and outbound-transfer (exfil) candidates"
mitreTechniques: [T1071.001, T1573.002, T1041]
invocationTriggerCandidate: beacon
invocationGate:
  observedService: ssl
correlatingCandidates:
  - type: tls_anomaly
    scope: same_network_tuple
  - type: intel_match
    scope: destination
  - type: data_transfer
    scope: same_network_tuple
---

# Objective

Determine whether an HTTPS beacon candidate represents command-and-control rather than benign regular traffic — and **explain that judgment in grounded prose**. Reason **only** from candidate evidence — do not read asset records, threat-intel RAG, or compliance / business-impact context. Those belong to assessment skills, not detection.

**Where the value is.** The candidates arrive already scored; fusing them into a composite is near-mechanical (a `max()`, defined at the bottom). What this skill exists to do is the part a deterministic rule cannot: read every field across the four candidates, decide what the pattern *means*, rule out the benign explanations, write the narrative, and state honestly what the evidence does **not** establish. The score is a byproduct of that reasoning — not the point of it.

# Procedure

Load the trigger beacon candidate first and read it in full — beacon score, destination rarity, LOTS status, threat-intel fields, process attribution. Then read the correlating TLS anomaly, intel match, and data transfer candidates on their declared scopes. You are assembling one picture, not collecting four numbers: how do the interval regularity, the TLS fingerprint, the destination reputation, and the outbound volume fit together into a single story — or fail to?

Treat an absent correlating candidate as **absent evidence — score 0 on its dimension** — not as execution failure. Never phantom-score an absent candidate.

# The interpretation — the actual output

This is the work. Everything here must trace to a candidate field or a skill-derived observation — **no unsourced claims**.

- **`attackNarrative`** — the grounded story: what is talking to what, over which channel, why it reads as C2 (or doesn't), and which dimension is decisive. Name the corroboration — a beacon *and* a SSLBL JA3 match *and* outbound volume on the same tuple is a far stronger finding than a lone periodic beacon, and the narrative should say which one you have.
- **`uncertainty`** — state what the evidence cannot establish. If **only the beacon fired** and every correlator was absent, flag it explicitly as *single-signal / uncorroborated*: the score may be high on one dimension, but nothing independent confirms it. Note any benign cause you could not confidently rule out.
- **`benignFallbackRuledOut`** — rule out benign causes by matching observed evidence against each shape: EDR / monitoring-agent check-in, OS update or telemetry polling, Microsoft 365 keepalive, backup agent, browser / SaaS polling, human browsing. Record each one you rule out and *why*; leave the ones you can't in `uncertainty`. (Most false positives are already dampened upstream by candidate-layer enrichments such as `destination_rarity` and `ja3_rarity`.)
- **`evidence` per dimension** — for each fired dimension, cite the **decisive observation**, not just the number (e.g. *"tls_anomaly 0.95 — JA3 matches SSLBL; self-signed cert"*).

# MITRE techniques — asserted per fired dimension

Assert the **union** of techniques for the dimensions that fired; do not hardcode a static list.

| Fired dimension | Asserts |
|---|---|
| `statistical_beacon_pattern` (beacon) | **T1071.001** (Web Protocols) + **T1573.002** (Encrypted Channel) — the base C2-over-HTTPS assertion |
| `tls_anomaly_signature` | T1071.001 + T1573.002 — the TLS structural anomaly is itself HTTPS-channel C2 evidence |
| `infrastructure_reputation` (intel match only) | inherits the base set — intel-matched HTTPS traffic to known-bad infra is still C2 |
| `exfil_volume_anomaly` (same-tuple data_transfer) | **append T1041** (Exfiltration Over C2 Channel) |

# Scoring — the mechanical part

You do not re-derive these. Each dimension is a **passthrough of a candidate's own composite** — you select and fuse, nothing more:

- `statistical_beacon_pattern` = `beacon.compositeScore`
- `infrastructure_reputation`  = `intel_match.compositeScore`   (0.0 if absent)
- `tls_anomaly_signature`      = `tls_anomaly.compositeScore`    (0.0 if absent)
- `exfil_volume_anomaly`       = `data_transfer.compositeScore`  (0.0 if absent) — anomalous outbound volume to the **same src_ip + dest_ip tuple as the beacon**, i.e. exfiltration over the C2 channel.

`compositeScore = max(statistical_beacon_pattern, infrastructure_reputation, tls_anomaly_signature, exfil_volume_anomaly)` — the **maximum decisive malicious dimension, never an average** that washes out strong evidence. That one line is the entire scoring model; the interpretation above is the work.

The `exfil_volume_anomaly` dimension counts **only on the same tuple** as the beacon. If the host moved data to a *different* endpoint, it is 0 — correct, because that transfer is not evidence about *this* channel; it belongs to its own finding.

# Output Contract

Return a `DetectionFinding` with `compositeScore`, `dimensions`, `evidenceSummary`, `attackNarrative`, `uncertainty`, `benignFallbackRuledOut`, `mitreTechniques`, and `evidenceRefs` (the candidate IDs that fired plus their constituent event IDs).

# Anti-patterns — do not do

- **Treating the score as the deliverable** — a high `compositeScore` with a thin, one-line narrative is a failed finding. The number is mechanical; the reasoned interpretation is the output.
- Re-scoring JA3 / certificate / SNI from raw `ssl.log` or `x509.log` — the `tls_anomaly` candidate already scores these; consume its composite, not the underlying events.
- Treating an absent correlating candidate as 1.0 via phantom scoring — absent is 0 on that dimension; the other dimensions still carry the composite via `max()`.
- Letting a `data_transfer` to a **different** destination raise this finding — exfil only counts on the **same tuple** as the beacon (same channel). Off-tuple transfer scores 0 here; it belongs to its own finding.
