import type { OpenApiSpec, OperationRecord, Snapshot } from "./types.js";

function resolvePointer(spec: OpenApiSpec, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  const parts = ref
    .slice(2)
    .split("/")
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let node: unknown = spec;
  for (const part of parts) {
    if (node && typeof node === "object" && part in (node as object)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return node;
}

const MAX_DEPTH = 12;

// Inline $ref-s so agents see concrete schemas. Cycles are broken with a marker
// when a pointer is already on the current path, plus a hard depth cap.
export function deref(
  node: unknown,
  spec: OpenApiSpec,
  onPath: Set<string> = new Set(),
  depth = 0,
): unknown {
  if (node === null || typeof node !== "object") return node;
  if (depth > MAX_DEPTH) return node;
  if (Array.isArray(node)) return node.map((item) => deref(item, spec, onPath, depth + 1));

  const obj = node as Record<string, unknown>;
  if (typeof obj.$ref === "string") {
    const ref = obj.$ref;
    if (onPath.has(ref)) return { $ref: ref, circular: true };
    const target = resolvePointer(spec, ref);
    if (target === undefined) return { $ref: ref, unresolved: true };
    const next = new Set(onPath);
    next.add(ref);
    const resolved = deref(target, spec, next, depth + 1);
    const siblings = Object.fromEntries(Object.entries(obj).filter(([k]) => k !== "$ref"));
    if (!Object.keys(siblings).length) return resolved;
    if (resolved === null || typeof resolved !== "object") return resolved;
    return {
      ...(resolved as Record<string, unknown>),
      ...(deref(siblings, spec, onPath, depth + 1) as Record<string, unknown>),
    };
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) out[key] = deref(value, spec, onPath, depth + 1);
  return out;
}

export interface EndpointMatch {
  record: OperationRecord;
  spec: OpenApiSpec;
  raw: Record<string, unknown>;
}

export interface LookupError {
  error: string;
  suggestions?: string[];
}

function rawOperation(
  spec: OpenApiSpec,
  rec: OperationRecord,
): Record<string, unknown> | undefined {
  const container = rec.kind === "webhook" ? spec.webhooks : spec.paths;
  return container?.[rec.path]?.[rec.method.toLowerCase()];
}

export function findEndpoint(
  snapshot: Snapshot,
  opts: { operationId?: string; method?: string; path?: string; spec?: string },
): EndpointMatch | LookupError {
  const { operationId, method, path, spec: specName } = opts;
  let candidates = snapshot.operations;
  if (specName) candidates = candidates.filter((o) => o.spec === specName);

  let matches: OperationRecord[] = [];
  if (operationId) {
    matches = candidates.filter((o) => o.operationId === operationId);
  } else if (path) {
    const m = method?.toUpperCase();
    matches = candidates.filter((o) => o.path === path && (!m || o.method === m));
  } else {
    return { error: "Provide either operationId, or path (with optional method)." };
  }

  if (matches.length === 0) {
    const needle = (operationId || path || "").toLowerCase();
    const suggestions = candidates
      .filter(
        (o) =>
          o.operationId?.toLowerCase().includes(needle) ||
          o.path.toLowerCase().includes(needle),
      )
      .slice(0, 8)
      .map((o) => `${o.method} ${o.path} (${o.operationId ?? "—"}) [${o.spec}]`);
    return {
      error: `No endpoint found for ${operationId ? `operationId "${operationId}"` : `${method ?? ""} ${path}`}${specName ? ` in spec "${specName}"` : ""}.`,
      suggestions: suggestions.length ? suggestions : undefined,
    };
  }

  if (matches.length > 1 && !specName) {
    return {
      error: `Ambiguous: ${matches.length} matches across specs. Re-call with the "spec" argument.`,
      suggestions: matches.map(
        (o) => `${o.method} ${o.path} (${o.operationId ?? "—"}) [${o.spec}]`,
      ),
    };
  }

  const rec = matches[0];
  const spec = snapshot.specs[rec.spec];
  const raw = rawOperation(spec, rec);
  if (!raw) return { error: `Operation present in index but missing in spec ${rec.spec}.` };
  return { record: rec, spec, raw };
}
