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

Judge whether an HTTPS beacon candidate is command-and-control rather than benign regular traffic. Reason only from candidate evidence. Do not read asset records, threat-intel RAG, or compliance / business context — those are assessment's job.

# Procedure

1. Load the trigger `beacon` candidate. Read every field: beacon score, destination rarity, LOTS status, threat-intel fields, process attribution.
2. Load the correlating candidates on their scopes: `tls_anomaly` and `data_transfer` on the same `src_ip`+`dest_ip` tuple as the beacon; `intel_match` on the destination. An absent correlator is absent evidence — its dimension scores 0. Never phantom-score one.
3. Set each dimension from its source candidate's composite (passthrough — do not re-derive):
   - `statistical_beacon_pattern` = `beacon.compositeScore`
   - `infrastructure_reputation` = `intel_match.compositeScore` (0 if absent)
   - `tls_anomaly_signature` = `tls_anomaly.compositeScore` (0 if absent)
   - `exfil_volume_anomaly` = `data_transfer.compositeScore` (0 if absent; same-tuple only)
4. `compositeScore` = max of the four dimensions. Never an average.
5. For each fired dimension, write its `evidence` string citing the decisive observation from the source candidate — not the score (e.g. `tls_anomaly 0.95 — JA3 matches SSLBL; self-signed cert`).
6. Walk the benign fallbacks below. Record each one ruled out in `benignFallbackRuledOut`; put any you cannot rule out in `uncertainty`.
7. Assert `mitreTechniques` per fired dimension (mapping below).
8. Write `attackNarrative` and `uncertainty`. Every claim traces to a candidate field or a stated observation.
9. Return the `DetectionFinding`.

# Dimension → MITRE

| Fired dimension | Assert |
|---|---|
| `statistical_beacon_pattern` (beacon) | T1071.001 + T1573.002 — base C2-over-HTTPS |
| `tls_anomaly_signature` | T1071.001 + T1573.002 |
| `infrastructure_reputation` (intel only) | inherit the base set |
| `exfil_volume_anomaly` (same-tuple data_transfer) | append T1041 |

Assert the union over fired dimensions. Do not hardcode a static list.

# Benign fallbacks

Match observed evidence against each shape and rule it out where it fits: EDR / monitoring-agent check-in, OS update or telemetry polling, Microsoft 365 keepalive, backup agent, browser / SaaS polling, human browsing. Most false positives are already dampened upstream by candidate enrichments (`destination_rarity`, `ja3_rarity`).

# Uncertainty

State what the evidence cannot establish. If only the beacon fired and every correlator was absent, flag it as single-signal / uncorroborated.

# Output

Return a `DetectionFinding`: `compositeScore`, `dimensions`, `evidenceSummary`, `attackNarrative`, `uncertainty`, `benignFallbackRuledOut`, `mitreTechniques`, `evidenceRefs` (the candidate IDs that fired — their constituent events stay reachable through those candidates, so the finding does not inline them).

# Do not

- Re-score JA3 / cert / SNI from `ssl.log` or `x509.log` — consume `tls_anomaly`'s composite.
- Score an absent correlator as anything but 0.
- Average the dimensions — the composite is the max.
- Count an off-tuple `data_transfer` — exfil is same-tuple only; off-tuple belongs to its own finding.
- Return a high score behind a one-line narrative — the reasoning fields are the finding, not the number.
