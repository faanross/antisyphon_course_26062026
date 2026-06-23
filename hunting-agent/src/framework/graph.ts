import { loadCandidates, type Candidate } from "./loaders.js";

export interface GraphNode {
  readonly id: string;
  readonly label: string;
  readonly type: "host" | "user" | "process" | "ip" | "candidate" | "finding";
}

export interface GraphEdge {
  readonly source: string;
  readonly target: string;
  readonly label: string;
}

export interface Subgraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

function addNode(nodes: Map<string, GraphNode>, node: GraphNode): void {
  if (!nodes.has(node.id)) nodes.set(node.id, node);
}

export function buildCandidateSubgraph(candidates: readonly Candidate[]): Subgraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  for (const candidate of candidates) {
    const candidateId = `candidate:${candidate.candidate_id}`;
    addNode(nodes, { id: candidateId, label: candidate.candidate_id, type: "candidate" });
    if (candidate.host) {
      const hostId = `host:${candidate.host}`;
      addNode(nodes, { id: hostId, label: candidate.host, type: "host" });
      edges.push({ source: candidateId, target: hostId, label: "ON_HOST" });
    }
    if (candidate.user) {
      const userId = `user:${candidate.user}`;
      addNode(nodes, { id: userId, label: candidate.user, type: "user" });
      edges.push({ source: candidateId, target: userId, label: "ATTRIBUTED_TO" });
    }
    if (candidate.process_name) {
      const processId = `process:${String(candidate.process_guid ?? candidate.process_name)}`;
      addNode(nodes, { id: processId, label: candidate.process_name, type: "process" });
      edges.push({ source: candidateId, target: processId, label: "FROM_PROCESS" });
    }
    if (candidate.dest_ip) {
      const ipId = `ip:${candidate.dest_ip}`;
      addNode(nodes, { id: ipId, label: candidate.dest_ip, type: "ip" });
      edges.push({ source: candidateId, target: ipId, label: "CONNECTS_TO" });
    }
  }

  return { nodes: [...nodes.values()], edges };
}

export async function loadWorkshopGraph(): Promise<Subgraph> {
  return buildCandidateSubgraph(await loadCandidates());
}

// Scope the graph to the TRUE-POSITIVE campaign: only the candidates that produced a
// true-positive finding, plus the host/user/process/ip entities they touch. Shared
// entities (referenced by >=2 findings) dedupe into one node, so the campaign's
// connections become the visible centre instead of being lost in false-positive noise.
// The narrative is grounded in THIS graph, so what is displayed === what the story can name.
export function buildCampaignSubgraph(
  candidates: readonly Candidate[],
  findings: readonly { candidateId: string; verdict: string }[],
): Subgraph {
  const keep = new Set(
    findings.filter((f) => f.verdict === "true_positive").map((f) => f.candidateId),
  );
  const base = buildCandidateSubgraph(candidates.filter((c) => keep.has(c.candidate_id)));
  // Present each kept candidate node AS a finding: in this lab every one of these IS a
  // true-positive DetectionFinding (Lab 10's "a finding is its own node"), linked to the
  // shared host/user/process/ip entities. The candidate is the finding's subject, so the id
  // is unchanged — only the node type flips, which keeps the graph, the narrative, and the
  // "findings cited" count all using the same word.
  const nodes = base.nodes.map((n) => (n.type === "candidate" ? { ...n, type: "finding" as const } : n));
  return { nodes, edges: base.edges };
}

if (process.argv.includes("--test")) {
  const graph = await loadWorkshopGraph();
  console.log(`nodes=${graph.nodes.length} edges=${graph.edges.length}`);
}
