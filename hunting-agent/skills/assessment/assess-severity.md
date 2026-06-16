---
name: assess-severity
version: 1.0
layer: assessment
description: "Assess operational severity of a DetectionFinding using business and asset context"
inputs:
  - "DetectionFinding (primary)"
contextRequirements:
  - id: asset.host
    mode: resolve
    entity: host
    layer: layer_1_assets
    reason: "Host role, criticality, owner team, and blast radius, for the host named in the finding."
  - id: compliance.escalation-policy
    mode: static
    path: context/layers/layer_2_compliance/escalation-policy.md
    reason: "Severity-to-response mapping and escalation deadlines (org-wide)."
  - id: compliance.evidence-preservation
    mode: static
    path: context/layers/layer_2_compliance/evidence-preservation.md
    reason: "Evidence handling constraints before containment (org-wide)."
  - id: incidents.host-history
    mode: resolve
    entity: host
    layer: layer_5_incidents
    suffix: "-history"
    reason: "Prior investigation history for the host named in the finding."
---

# Objective

Assign an operational severity to a detection finding using the supplied organization context.

# Procedure

Separate technical confidence from business impact. Consider host role, user privileges, blast radius, compliance scope, active exfiltration indicators, and uncertainty. Recommend evidence-preserving response actions before cleanup.

# Output Contract

Return severity, operational bottom line, business impact, escalation rationale, recommended response, and uncertainty.
