import MiniSearch from "minisearch";
import { deref, findEndpoint } from "./openapi.js";
import type { DocRecord, OperationRecord, Snapshot } from "./types.js";

function extractField<T extends object>(document: T, field: string): string {
  const value = (document as Record<string, unknown>)[field];
  if (Array.isArray(value)) return value.join(" ");
  return value == null ? "" : String(value);
}

function snippet(doc: DocRecord, query: string): string {
  const term = query.split(/\s+/).filter(Boolean)[0]?.toLowerCase() ?? "";
  const idx = term ? doc.text.toLowerCase().indexOf(term) : -1;
  const start = idx > 80 ? idx - 80 : 0;
  const slice = doc.text.slice(start, start + 240).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + slice + (start + 240 < doc.text.length ? "…" : "");
}

/** Holds a snapshot and its lazily-built search indices. One per process. */
export class DocsIndex {
  private docById = new Map<string, DocRecord>();
  private docByUrl = new Map<string, DocRecord>();
  private opById = new Map<string, OperationRecord>();
  private docIndex: MiniSearch<DocRecord> | null = null;
  private opIndex: MiniSearch<OperationRecord> | null = null;

  constructor(private snapshot: Snapshot) {
    for (const d of snapshot.docs) {
      this.docById.set(d.id, d);
      this.docByUrl.set(d.url, d);
    }
    for (const o of snapshot.operations) this.opById.set(o.id, o);
  }

  get meta() {
    return this.snapshot.meta;
  }

  private getDocIndex(): MiniSearch<DocRecord> {
    if (this.docIndex) return this.docIndex;
    const idx = new MiniSearch<DocRecord>({
      idField: "id",
      fields: ["title", "headings", "text", "url", "category", "description"],
      searchOptions: {
        boost: { title: 4, headings: 2, url: 2 },
        prefix: true,
        fuzzy: 0.2,
        combineWith: "AND",
      },
      extractField,
    });
    idx.addAll(this.snapshot.docs);
    this.docIndex = idx;
    return idx;
  }

  private getOpIndex(): MiniSearch<OperationRecord> {
    if (this.opIndex) return this.opIndex;
    const idx = new MiniSearch<OperationRecord>({
      idField: "id",
      fields: ["operationId", "path", "summary", "description", "tags", "searchText"],
      searchOptions: {
        boost: { operationId: 4, path: 3, summary: 2, tags: 2 },
        prefix: true,
        fuzzy: 0.2,
        combineWith: "AND",
      },
      extractField,
    });
    idx.addAll(this.snapshot.operations);
    this.opIndex = idx;
    return idx;
  }

  searchDocs(query: string, limit: number, category?: string) {
    const out = [];
    for (const r of this.getDocIndex().search(query)) {
      const doc = this.docById.get(String(r.id));
      if (!doc) continue;
      if (category && doc.category !== category) continue;
      out.push({
        url: doc.url,
        title: doc.title,
        category: doc.category,
        score: Math.round(r.score * 100) / 100,
        snippet: snippet(doc, query),
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  // Accept the published URL, the source id, or a loose path; degrade to suggestions.
  readDoc(ref: string) {
    const direct = this.docByUrl.get(ref) || this.docById.get(ref);
    if (direct) return { ok: true as const, doc: direct };

    const cleaned = ref.replace(/^\/+/, "").replace(/\.mdx?$/, "").replace(/\/$/, "");
    const byId = this.docById.get(cleaned);
    if (byId) return { ok: true as const, doc: byId };

    const needle = cleaned.toLowerCase();
    const suggestions = this.snapshot.docs
      .filter(
        (d) =>
          d.url.toLowerCase().includes(needle) ||
          d.id.toLowerCase().includes(needle) ||
          d.title.toLowerCase().includes(needle),
      )
      .slice(0, 8)
      .map((d) => d.url);
    return { ok: false as const, suggestions };
  }

  listCategories() {
    return this.snapshot.meta.categories;
  }

  listApis() {
    return this.snapshot.meta.specs;
  }

  searchApi(
    query: string,
    limit: number,
    opts: { spec?: string; method?: string; kind?: "operation" | "webhook" } = {},
  ) {
    const method = opts.method?.toUpperCase();
    const out = [];
    for (const r of this.getOpIndex().search(query)) {
      const op = this.opById.get(String(r.id));
      if (!op) continue;
      if (opts.spec && op.spec !== opts.spec) continue;
      if (method && op.method !== method) continue;
      if (opts.kind && op.kind !== opts.kind) continue;
      out.push({
        spec: op.spec,
        kind: op.kind,
        method: op.method,
        path: op.path,
        operationId: op.operationId ?? null,
        summary: op.summary,
        tags: op.tags,
        tagGroup: op.tagGroup ?? null,
        deprecated: op.deprecated,
        score: Math.round(r.score * 100) / 100,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  getEndpoint(opts: { operationId?: string; method?: string; path?: string; spec?: string }) {
    const match = findEndpoint(this.snapshot, opts);
    if ("error" in match) return match;

    const { record, spec, raw } = match;
    const resolved = deref(raw, spec) as Record<string, unknown>;
    return {
      spec: record.spec,
      kind: record.kind,
      method: record.method,
      path: record.path,
      operationId: record.operationId ?? null,
      summary: resolved.summary ?? record.summary,
      description: resolved.description ?? null,
      tags: record.tags,
      tagGroup: record.tagGroup ?? null,
      deprecated: record.deprecated,
      servers: spec.servers?.map((s: { url: string }) => s.url) ?? [],
      security: resolved.security ?? spec.security ?? null,
      parameters: resolved.parameters ?? [],
      requestBody: resolved.requestBody ?? null,
      responses: resolved.responses ?? null,
    };
  }
}
