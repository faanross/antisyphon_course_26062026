// Deterministic projection of a DetectionFinding into Knowledge-Graph nodes + edges, plus the
// Cypher that produces them. This is the *deterministic write path* — NO model call. MERGE is
// idempotent: an entity another finding already created is REUSED, never duplicated — which is
// exactly how the graph connects independent findings through their shared entities.

export type ProjNodeType = "finding" | "host" | "user" | "candidate" | "technique";

export interface ProjNode {
  readonly id: string;
  readonly label: string;
  readonly type: ProjNodeType;
}

export interface ProjEdge {
  readonly source: string;
  readonly target: string;
  readonly label: string;
}

/** Only the finding fields the graph projection needs. */
export interface ProjectableFinding {
  readonly findingId: string;
  readonly skillName: string;
  readonly verdict: string;
  readonly compositeScore: number;
  readonly scope: { host?: string; user?: string };
  readonly evidenceRefs: { candidateIds: string[] };
  readonly mitreTechniques: string[];
}

export interface CypherProjection {
  /** One Cypher statement per node/edge pair the finding MERGEs (1:1 with `nodes`). */
  readonly cypher: string[];
  readonly nodes: ProjNode[];
  readonly edges: ProjEdge[];
}

export function findingToCypher(f: ProjectableFinding): CypherProjection {
  const nodes: ProjNode[] = [];
  const edges: ProjEdge[] = [];
  const cypher: string[] = [];
  const fid = `finding:${f.findingId}`;

  nodes.push({ id: fid, label: f.findingId, type: "finding" });
  cypher.push(`MERGE (f:Finding {id:'${f.findingId}'}) SET f.skill='${f.skillName}', f.verdict='${f.verdict}', f.score=${f.compositeScore}`);

  // Each related entity is one MERGE (the node) + one MERGE (the edge from the finding to it).
  const link = (id: string, label: string, type: ProjNodeType, varDecl: string, rel: string) => {
    nodes.push({ id, label, type });
    edges.push({ source: fid, target: id, label: rel });
    const v = varDecl.split(":")[0];
    cypher.push(`MERGE (${varDecl} {id:'${label}'})\nMERGE (f)-[:${rel}]->(${v})`);
  };

  if (f.scope.host) link(`host:${f.scope.host}`, f.scope.host, "host", "h:Host", "TARGETS");
  if (f.scope.user) link(`user:${f.scope.user}`, f.scope.user, "user", "u:User", "INVOLVES");
  for (const c of f.evidenceRefs.candidateIds) link(`candidate:${c}`, c, "candidate", "c:Candidate", "BASED_ON");
  for (const t of f.mitreTechniques) link(`technique:${t}`, t, "technique", "t:Technique", "USES_TECHNIQUE");

  return { cypher, nodes, edges };
}

// The two findings the KG lab projects — both confirmed (TP) on the same host/user, so the graph
// links them through the shared Host and User nodes (a connection neither finding states).
export const EXAMPLE_FINDINGS: ProjectableFinding[] = [
  {
    findingId: "df-a",
    skillName: "hunt-c2-over-https",
    verdict: "true_positive",
    compositeScore: 0.95,
    scope: { host: "DEV-WS03", user: "NORTHWIND\\jane.roberts" },
    evidenceRefs: { candidateIds: ["BEA-001"] },
    mitreTechniques: ["T1071.001"],
  },
  {
    findingId: "df-b",
    skillName: "hunt-malicious-powershell-payload",
    verdict: "true_positive",
    compositeScore: 0.93,
    scope: { host: "DEV-WS03", user: "NORTHWIND\\jane.roberts" },
    evidenceRefs: { candidateIds: ["PSI-001"] },
    mitreTechniques: ["T1059.001"],
  },
];
