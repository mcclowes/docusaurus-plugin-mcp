import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DocsIndex } from "./search.js";
import type { Snapshot } from "./types.js";

export interface McpServerOptions {
  name?: string;
  version?: string;
  instructions?: string;
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

function result(data: unknown, summary?: string) {
  const text = summary ? `${summary}\n\n${JSON.stringify(data, null, 2)}` : JSON.stringify(data, null, 2);
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: { data },
  };
}

/** Build a configured MCP server exposing docs (and OpenAPI, if present) tools. */
export function createMcpServer(snapshot: Snapshot, options: McpServerOptions = {}): McpServer {
  const index = new DocsIndex(snapshot);
  const specNames = snapshot.meta.specs.map((s) => s.name);
  const hasApi = specNames.length > 0;

  const server = new McpServer(
    {
      name: options.name ?? snapshot.meta.siteTitle ?? "docs",
      version: options.version ?? "0.0.0",
    },
    { instructions: options.instructions },
  );

  server.registerTool(
    "search_docs",
    {
      title: "Search docs",
      description:
        "Full-text search across the documentation. Returns ranked matches with a URL, title, category, and snippet. Use read_doc with a returned URL to get the full page.",
      inputSchema: {
        query: z.string().min(1).describe("Search terms."),
        limit: z.number().int().min(1).max(25).optional().describe("Max results (default 8)."),
        category: z.string().optional().describe("Restrict to a category (see list_doc_categories)."),
      },
      annotations: READ_ONLY,
    },
    async ({ query, limit, category }) => {
      const hits = index.searchDocs(query, limit ?? 8, category);
      return result(
        hits,
        hits.length ? `Found ${hits.length} doc(s) for "${query}".` : `No docs matched "${query}".`,
      );
    },
  );

  server.registerTool(
    "read_doc",
    {
      title: "Read a doc",
      description:
        "Return the full markdown of a documentation page. Accepts the URL from search_docs (or a source path).",
      inputSchema: {
        url: z.string().min(1).describe("Page URL or path from search_docs."),
      },
      annotations: READ_ONLY,
    },
    async ({ url }) => {
      const res = index.readDoc(url);
      if (!res.ok) {
        return result(
          { found: false, suggestions: res.suggestions },
          `No doc at "${url}".${res.suggestions.length ? " See suggestions." : ""}`,
        );
      }
      const { doc } = res;
      return {
        content: [
          {
            type: "text" as const,
            text: `# ${doc.title}\nURL: ${doc.url} | Category: ${doc.category}\n\n---\n\n${doc.raw}`,
          },
        ],
        structuredContent: {
          data: { url: doc.url, title: doc.title, category: doc.category, content: doc.raw },
        },
      };
    },
  );

  server.registerTool(
    "list_doc_categories",
    {
      title: "List doc categories",
      description: "List the documentation categories with a page count for each.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const cats = index.listCategories();
      return result(cats, `${cats.length} categories.`);
    },
  );

  if (hasApi) {
    const specEnum = z.enum(specNames as [string, ...string[]]);

    server.registerTool(
      "list_apis",
      {
        title: "List API specs",
        description:
          "List the indexed OpenAPI specs with title, version, server URLs, and operation/webhook counts.",
        inputSchema: {},
        annotations: READ_ONLY,
      },
      async () => {
        const apis = index.listApis();
        return result(apis, `${apis.length} OpenAPI spec(s).`);
      },
    );

    server.registerTool(
      "search_api",
      {
        title: "Search API operations",
        description:
          "Search API endpoints and webhook events across the OpenAPI specs by path, operationId, summary, or tag. Use get_endpoint for full detail of a match.",
        inputSchema: {
          query: z.string().min(1).describe("Search terms."),
          limit: z.number().int().min(1).max(25).optional().describe("Max results (default 10)."),
          spec: specEnum.optional().describe("Restrict to one spec."),
          method: z.string().optional().describe("Restrict to an HTTP method."),
          kind: z.enum(["operation", "webhook"]).optional().describe("Restrict to operations or webhooks."),
        },
        annotations: READ_ONLY,
      },
      async ({ query, limit, spec, method, kind }) => {
        const hits = index.searchApi(query, limit ?? 10, { spec, method, kind });
        return result(
          hits,
          hits.length ? `Found ${hits.length} operation(s) for "${query}".` : `No operations matched "${query}".`,
        );
      },
    );

    server.registerTool(
      "get_endpoint",
      {
        title: "Get API endpoint detail",
        description:
          "Full detail of one API operation or webhook: parameters, request body, and responses with $refs resolved. Identify by operationId, or path (+ optional method). Pass spec to disambiguate when it exists in multiple specs.",
        inputSchema: {
          operationId: z.string().optional(),
          path: z.string().optional().describe("Required if operationId is omitted."),
          method: z.string().optional().describe("Disambiguate a path with multiple verbs."),
          spec: specEnum.optional(),
        },
        annotations: READ_ONLY,
      },
      async ({ operationId, path, method, spec }) => {
        const res = index.getEndpoint({ operationId, path, method, spec });
        if ("error" in res) return result({ error: res.error, suggestions: res.suggestions }, res.error);
        return result(res, `${res.method} ${res.path} — ${res.summary} [${res.spec}]`);
      },
    );
  }

  return server;
}
