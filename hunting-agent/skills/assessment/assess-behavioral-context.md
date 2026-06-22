---
name: assess-behavioral-context
version: 2.0
layer: assessment
allowedTools:
  - get_asset_record
  - get_incident_history
inputs:
  - "DetectionFinding (primary — passed by framework)"
contextSources:
  - assets
  - incidents
---

# Objective

Judge whether the detected activity is normal or anomalous for the specific user and host — the behavioral baseline. You do NOT set severity (that is the severity skill's job).

# Procedure

1. Read the DetectionFinding — the host and user it scopes, the technique, and what the upstream evidence shows.
2. Retrieve the entity context yourself with the available tools:
   - `get_asset_record` for the finding's host (role, expected development activity) and for the user (role, normal tools, privilege baseline).
   - `get_incident_history` for the host (prior investigations) and for the source subnet (known false-positive patterns).
   Call a tool while you still need that context; finish once you have enough to judge.
3. Call out what is baseline-consistent and what is a material deviation from the established baseline.

# Output

Emit the single JSON AssessmentFinding the user message specifies. Do NOT emit a severity field (cardinal isolation). Tie every baseline / anomaly claim to a retrieved asset record or incident-history file — name the source.
