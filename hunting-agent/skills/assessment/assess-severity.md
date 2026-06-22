---
name: assess-severity
version: 2.0
layer: assessment
allowedTools:
  - get_asset_record
  - get_incident_history
inputs:
  - "DetectionFinding (primary — passed by framework)"
contextSources:
  - assets
  - compliance
  - incidents
---

# Objective

Assign an operational severity to the detection finding, given the affected entities and the organization's context.

# Procedure

1. Read the DetectionFinding — verdict, compositeScore, MITRE techniques, the host/user it scopes, attack narrative, and uncertainty.
2. Retrieve the entity context yourself with the available tools:
   - `get_asset_record` for the finding's host (and user, if present) — role, criticality, blast radius, owner team.
   - `get_incident_history` for the host — prior true/false-positive precedent on this pattern.
   Call a tool while you still need that context; finish once you have enough to judge.
3. Apply the **injected** compliance context (escalation policy, evidence-preservation). It is already in your prompt — do not fetch it.
4. Separate technical confidence (established upstream) from business impact. Weigh host role, privilege, blast radius, compliance scope, active-exfiltration indicators, and uncertainty. Recommend evidence-preserving response before cleanup.

# Output

Emit the single JSON AssessmentFinding the user message specifies. Tie every business-impact and escalation claim to a retrieved asset record, the incident history, or the injected compliance context — name the source.
