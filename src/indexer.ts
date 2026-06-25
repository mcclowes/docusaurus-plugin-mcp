import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { parse as parseYaml } from "yaml";
import type {
  DocRecord,
  Meta,
  OpenApiSpec,
  OperationRecord,
  Snapshot,
  SpecMeta,
} from "./types.js";
import type { OpenApiSource, ResolvedOptions } from "./options.js";

const HTTP_METHODS = ["get", "put", "post", "delete", "patch", "options", "head"];

// ---------------------------------------------------------------------------
// Docs
// ---------------------------------------------------------------------------

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.mdx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function toPlainText(md: string): string {
  return md
    .replace(/^import\s.+$/gm, "")
    .replace(/^export\s.+$/gm, "")
    .replace(/<\/?[A-Za-z][^>]*>/g, " ")
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, " "))
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_~|]/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractHeadings(md: string): string[] {
  const headings: string[] = [];
  for (const line of md.split("\n")) {
    const m = /^#{1,4}\s+(.+?)\s*#*$/.exec(line);
    if (m) headings.push(m[1].replace(/[`*_]/g, "").trim());
  }
  return headings;
}

function joinUrl(...parts: string[]): string {
  const joined = parts
    .filter(Boolean)
    .join("/")
    .replace(/\/{2,}/g, "/");
  return joined.startsWith("/") ? joined : `/${joined}`;
}

// Derive the published URL the way Docusaurus does for the common cases: honor a
// `slug` frontmatter (absolute or relative), otherwise use the file path with
// the extension stripped and trailing /index removed.
function docUrl(
  relPath: string,
  slug: unknown,
  baseUrl: string,
  routeBasePath: string,
): string {
  let urlPath: string;
  if (typeof slug === "string" && slug.startsWith("/")) {
    return joinUrl(baseUrl, routeBasePath, slug);
  }
  if (typeof slug === "string") {
    const dir = path.dirname(relPath);
    urlPath = path.join(dir === "." ? "" : dir, slug);
  } else {
    urlPath = relPath.replace(/\.mdx?$/, "").replace(/\/index$/, "");
  }
  return joinUrl(baseUrl, routeBasePath, urlPath.split(path.sep).join("/"));
}

function buildDocs(
  docsAbs: string,
  baseUrl: string,
  routeBasePath: string,
  exclude: string[],
): { docs: DocRecord[]; categories: { name: string; count: number }[] } {
  const docs: DocRecord[] = [];
  const categoryCounts: Record<string, number> = {};

  for (const file of walk(docsAbs)) {
    const rel = path.relative(docsAbs, file).split(path.sep).join("/");
    if (exclude.some((e) => rel.includes(e))) continue;

    const raw = fs.readFileSync(file, "utf8");
    const { data: fm, content } = matter(raw);
    const id = rel.replace(/\.mdx?$/, "");
    const category = id.includes("/") ? id.split("/")[0] : "root";
    const title = String(
      fm.title || fm.sidebar_label || extractHeadings(content)[0] || path.basename(id),
    );

    categoryCounts[category] = (categoryCounts[category] || 0) + 1;

    docs.push({
      id,
      url: docUrl(rel, fm.slug, baseUrl, routeBasePath),
      file: rel,
      title,
      description: fm.description ? String(fm.description) : undefined,
      category,
      headings: extractHeadings(content),
      text: toPlainText(content),
      raw,
    });
  }

  docs.sort((a, b) => a.id.localeCompare(b.id));
  const categories = Object.entries(categoryCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { docs, categories };
}

// ---------------------------------------------------------------------------
// OpenAPI
// ---------------------------------------------------------------------------

function loadSpec(file: string): OpenApiSpec {
  const raw = fs.readFileSync(file, "utf8");
  return /\.ya?ml$/i.test(file) ? parseYaml(raw) : JSON.parse(raw);
}

function summarise(op: Record<string, unknown>, fallback: string): string {
  if (typeof op.summary === "string" && op.summary) return op.summary;
  if (typeof op.description === "string" && op.description) {
    return op.description.split("\n")[0].slice(0, 140);
  }
  return fallback;
}

function indexSpec(name: string, spec: OpenApiSpec): OperationRecord[] {
  const operations: OperationRecord[] = [];
  const tagGroupByTag: Record<string, string> = {};
  for (const group of spec["x-tagGroups"] || []) {
    for (const tag of group.tags || []) tagGroupByTag[tag] = group.name;
  }

  const collect = (container: Record<string, unknown> | undefined, kind: OperationRecord["kind"]) => {
    for (const [route, item] of Object.entries(container || {})) {
      if (!item || typeof item !== "object") continue;
      const methods = item as Record<string, Record<string, unknown>>;
      for (const method of HTTP_METHODS) {
        const op = methods[method];
        if (!op) continue;
        const tags = (op.tags as string[]) || [];
        operations.push({
          id: `${name}:${kind}:${method}:${route}`,
          spec: name,
          kind,
          method: method.toUpperCase(),
          path: route,
          operationId: (op.operationId as string) || undefined,
          summary: summarise(op, `${method.toUpperCase()} ${route}`),
          description: (op.description as string) || undefined,
          tags,
          tagGroup: tags.map((t) => tagGroupByTag[t]).find(Boolean) || undefined,
          searchText: [op.operationId, route, op.summary, op.description, tags.join(" ")]
            .filter(Boolean)
            .join(" "),
          deprecated: !!op.deprecated,
        });
      }
    }
  };

  collect(spec.paths, "operation");
  collect(spec.webhooks, "webhook");
  return operations;
}

function buildOpenApi(
  siteDir: string,
  sources: OpenApiSource[],
): { operations: OperationRecord[]; specs: Record<string, OpenApiSpec>; specMeta: SpecMeta[] } {
  const operations: OperationRecord[] = [];
  const specs: Record<string, OpenApiSpec> = {};
  const specMeta: SpecMeta[] = [];

  for (const source of sources) {
    const file = path.resolve(siteDir, source.spec);
    if (!fs.existsSync(file)) {
      throw new Error(
        `[docusaurus-plugin-mcp] OpenAPI spec "${source.name}" not found at ${file}`,
      );
    }
    const spec = loadSpec(file);
    const ops = indexSpec(source.name, spec);
    operations.push(...ops);
    specs[source.name] = spec;
    specMeta.push({
      name: source.name,
      title: spec.info?.title || source.name,
      version: spec.info?.version || "",
      description: spec.info?.description
        ? String(spec.info.description).split("\n")[0].slice(0, 240)
        : "",
      operationCount: ops.filter((o) => o.kind === "operation").length,
      webhookCount: ops.filter((o) => o.kind === "webhook").length,
      servers: (spec.servers || []).map((s: { url: string }) => s.url),
    });
  }

  return { operations, specs, specMeta };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BuildSnapshotInput {
  siteDir: string;
  baseUrl?: string;
  siteTitle?: string;
  /** Override the generated-at stamp (keeps builds deterministic). */
  generatedAt?: string;
  options: ResolvedOptions;
}

export function buildSnapshot(input: BuildSnapshotInput): Snapshot {
  const { siteDir, baseUrl = "/", siteTitle, generatedAt = "", options } = input;
  const docsAbs = path.resolve(siteDir, options.docsDir);

  const { docs, categories } = buildDocs(
    docsAbs,
    baseUrl,
    options.routeBasePath,
    options.exclude,
  );
  const { operations, specs, specMeta } = buildOpenApi(siteDir, options.openapi);

  const meta: Meta = {
    generatedAt,
    siteTitle,
    docCount: docs.length,
    categories,
    specs: specMeta,
  };

  return { meta, docs, operations, specs };
}

export function writeSnapshot(snapshot: Snapshot, dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "snapshot.json"), JSON.stringify(snapshot));
  // A lightweight meta file for discovery / health checks / theme components.
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(snapshot.meta));
}
