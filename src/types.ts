export interface DocRecord {
  /** Stable id, the source-relative slug without extension (e.g. "guides/auth"). */
  id: string;
  /** Published URL path (e.g. "/docs/guides/auth"). */
  url: string;
  /** Source file, relative to the docs dir. */
  file: string;
  title: string;
  description?: string;
  category: string;
  headings: string[];
  /** Plain-text body, used for search and snippets. */
  text: string;
  /** Original markdown, returned by read_doc. */
  raw: string;
}

export interface OperationRecord {
  id: string;
  spec: string;
  kind: "operation" | "webhook";
  method: string;
  path: string;
  operationId?: string;
  summary: string;
  description?: string;
  tags: string[];
  tagGroup?: string;
  searchText: string;
  deprecated: boolean;
}

export interface SpecMeta {
  name: string;
  title: string;
  version: string;
  description: string;
  operationCount: number;
  webhookCount: number;
  servers: string[];
}

export interface Meta {
  generatedAt: string;
  siteTitle?: string;
  docCount: number;
  categories: { name: string; count: number }[];
  specs: SpecMeta[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OpenApiSpec = any;

/** Everything the MCP server needs at runtime. Emitted as build/mcp/snapshot.json. */
export interface Snapshot {
  meta: Meta;
  docs: DocRecord[];
  operations: OperationRecord[];
  /** Full specs, keyed by name. Needed for $ref resolution in get_endpoint. */
  specs: Record<string, OpenApiSpec>;
}
