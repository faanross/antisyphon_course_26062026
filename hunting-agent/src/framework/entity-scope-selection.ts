// ---------------------------------------------------------------------------
// Entity-scope candidate selection (PoC — ported from aionsec_HUNT)
//
// A hypothesis's *entity scope* filters which candidates a detection skill is
// allowed to judge, BEFORE selection / ranking. It is a pure pre-selection
// predicate over immutable candidate fields — it NEVER enters any skill prompt
// (selection ≠ judgment). The verdict for an in-scope candidate is identical
// with or without the scope.
//
// Course-simplified mirror of src/framework/entity-scope-selection.ts in
// ~/repos/aionsec_HUNT. Uses the Node `net` primitives (BlockList + isIP) for
// exact-IP and CIDR matching across IPv4 and IPv6.
//
// Semantics (locked PoC contract):
//   - selectors are a UNION: a candidate is in scope if ANY host, exact IP, or
//     subnet selector matches an eligible endpoint;
//   - axis defaults to "source":
//       source      -> host + src_ip are eligible
//       destination -> dest_ip only (beacons carry no destination-host field)
//       both        -> host + src_ip + dest_ip
//   - host match is exact (after whitespace normalization); IP match is address
//     equality; CIDR match is network containment;
//   - invalid scope config (bad IP / CIDR / axis / unknown field) FAILS CLOSED
//     at construction (throws);
//   - missing / invalid candidate-side fields do NOT throw — they simply cannot
//     prove a match.
// ---------------------------------------------------------------------------

import { BlockList, isIP } from "node:net";

export type EntityScopeAxis = "source" | "destination" | "both";

export interface EntityScope {
  hosts?: string[];
  ips?: string[];
  subnets?: string[];
  axis?: EntityScopeAxis;
}

const ENTITY_SCOPE_KEYS = new Set(["hosts", "ips", "subnets", "axis"]);

export function normalizeEntityScope(value: unknown): EntityScope {
  if (!isRecord(value)) throw new Error("entityScope must be an object");
  for (const key of Object.keys(value)) {
    if (!ENTITY_SCOPE_KEYS.has(key)) {
      throw new Error(`entityScope contains unsupported field ${key}`);
    }
  }

  const axis = normalizeAxis(value.axis);
  const hosts = normalizeStrings(value.hosts, "entityScope.hosts");
  const ips = normalizeStrings(value.ips, "entityScope.ips");
  const subnets = normalizeStrings(value.subnets, "entityScope.subnets");
  for (const ip of ips) {
    if (isIP(ip) === 0) throw new Error(`entityScope.ips contains invalid IP ${ip}`);
  }
  for (const subnet of subnets) parseSubnet(subnet);

  if (hosts.length + ips.length + subnets.length === 0) return {};
  return {
    ...(hosts.length > 0 ? { hosts } : {}),
    ...(ips.length > 0 ? { ips } : {}),
    ...(subnets.length > 0 ? { subnets } : {}),
    axis,
  };
}

/**
 * Build a pure predicate that returns true when a candidate is within the given
 * entity scope. An undefined scope (or one that normalizes to no selectors) is a
 * no-op that matches every candidate.
 */
export function createEntityScopeMatcher(
  scope: EntityScope | undefined,
): (candidate: Record<string, unknown>) => boolean {
  if (scope === undefined) return () => true;
  const normalized = normalizeEntityScope(scope);
  const hosts = new Set(normalized.hosts ?? []);
  if (!normalizedScopeHasSelectors(normalized)) return () => true;

  const addresses = new BlockList();
  for (const ip of normalized.ips ?? []) {
    addresses.addAddress(ip, addressFamily(ip));
  }
  for (const subnet of normalized.subnets ?? []) {
    const parsed = parseSubnet(subnet);
    addresses.addSubnet(parsed.address, parsed.prefix, parsed.family);
  }
  const axis = normalized.axis ?? "source";

  return (candidate) => {
    if (
      axis !== "destination" &&
      typeof candidate.host === "string" &&
      hosts.has(candidate.host)
    ) {
      return true;
    }

    const endpointIps = [
      ...(axis !== "destination" ? [candidate.src_ip] : []),
      ...(axis !== "source" ? [candidate.dest_ip] : []),
    ];
    return endpointIps.some((value) => {
      if (typeof value !== "string") return false;
      const family = isIP(value);
      return family !== 0 && addresses.check(value, familyName(family));
    });
  };
}

export function entityScopeHasSelectors(scope: EntityScope | undefined): boolean {
  return scope !== undefined && normalizedScopeHasSelectors(normalizeEntityScope(scope));
}

function normalizedScopeHasSelectors(scope: EntityScope): boolean {
  return (
    (scope.hosts?.length ?? 0) > 0 ||
    (scope.ips?.length ?? 0) > 0 ||
    (scope.subnets?.length ?? 0) > 0
  );
}

function normalizeAxis(value: unknown): EntityScopeAxis {
  if (value === undefined) return "source";
  if (value === "source" || value === "destination" || value === "both") {
    return value;
  }
  throw new Error("entityScope.axis must be source, destination, or both");
}

function normalizeStrings(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  const normalized = value.map((entry) => {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new Error(`${name} must contain non-empty strings`);
    }
    return entry.trim();
  });
  return [...new Set(normalized)].sort();
}

function parseSubnet(value: string): {
  address: string;
  prefix: number;
  family: "ipv4" | "ipv6";
} {
  const parts = value.split("/");
  if (parts.length !== 2) {
    throw new Error(`entityScope.subnets contains invalid CIDR ${value}`);
  }
  const [address, prefixText] = parts;
  const version = isIP(address);
  const prefix = Number(prefixText);
  const maximum = version === 4 ? 32 : version === 6 ? 128 : -1;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maximum) {
    throw new Error(`entityScope.subnets contains invalid CIDR ${value}`);
  }
  return { address, prefix, family: familyName(version) };
}

function addressFamily(value: string): "ipv4" | "ipv6" {
  return familyName(isIP(value));
}

function familyName(version: number): "ipv4" | "ipv6" {
  if (version === 4) return "ipv4";
  if (version === 6) return "ipv6";
  throw new Error("IP address family is unsupported");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
