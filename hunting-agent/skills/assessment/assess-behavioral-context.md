---
name: assess-behavioral-context
version: 1.0
layer: assessment
description: "Assess whether detected activity deviates from the entity's established behavioral baseline"
inputs:
  - "DetectionFinding (primary)"
contextRequirements:
  - id: asset.host
    mode: resolve
    entity: host
    layer: layer_1_assets
    reason: "Host role and expected development activity, for the host named in the finding."
  - id: profile.user
    mode: resolve
    entity: user
    layer: layer_1_assets
    reason: "User role, normal tools, and privilege baseline, for the user named in the finding."
  - id: incidents.host-history
    mode: resolve
    entity: host
    layer: layer_5_incidents
    suffix: "-history"
    reason: "Prior investigation history for the host named in the finding."
  - id: incidents.subnet-history
    mode: resolve
    entity: subnet
    layer: layer_5_incidents
    suffix: "-history"
    reason: "Known false-positive patterns for the finding's source subnet."
---

Evaluate whether the detection finding is normal or anomalous for the specific user and host. Consult host role, user group membership, normal tools, prior incident history, and known false-positive patterns. Call out what is baseline-consistent and what is materially different.
