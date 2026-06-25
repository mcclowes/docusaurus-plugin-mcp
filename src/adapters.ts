import http from "node:http";
import fs from "node:fs";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer, type McpServerOptions } from "./server.js";
import type { Snapshot } from "./types.js";

export { createMcpServer } from "./server.js";
export { DocsIndex } from "./search.js";
export type { McpServerOptions } from "./server.js";
export type { Snapshot } from "./types.js";

/** Load a snapshot emitted by the plugin (build/<outputDir>/snapshot.json). */
export function loadSnapshot(file: string): Snapshot {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Snapshot;
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      if (!chunks.length) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve(undefined);
      }
    });
    req.on("error", () => resolve(undefined));
  });
}

type NodeHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) => Promise<void>;

/**
 * A stateless Node request handler implementing MCP over streamable HTTP.
 * Works in Express, Vercel/Netlify Node functions, and the Docusaurus dev server.
 * A fresh server and transport are created per request, so it scales horizontally
 * with no shared session state.
 */
export function createNodeHandler(snapshot: Snapshot, options: McpServerOptions = {}): NodeHandler {
  return async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, mcp-protocol-version");
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    const body = req.method === "POST" ? await readBody(req) : undefined;
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = createMcpServer(snapshot, options);

    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          }),
        );
      }
      // eslint-disable-next-line no-console
      console.error("[docusaurus-plugin-mcp] request failed:", err);
    }
  };
}

/** Convenience standalone server, handy for local serving and the dev middleware. */
export function createNodeServer(
  snapshot: Snapshot,
  options: McpServerOptions & { endpoint?: string } = {},
): http.Server {
  const endpoint = options.endpoint ?? "/mcp";
  const handler = createNodeHandler(snapshot, options);
  return http.createServer((req, res) => {
    const url = (req.url ?? "").split("?")[0];
    if (url === endpoint || url === `${endpoint}/`) {
      void handler(req, res);
    } else {
      res.writeHead(404, { "Content-Type": "application/json" }).end(
        JSON.stringify({ error: `Not found. MCP endpoint is ${endpoint}.` }),
      );
    }
  });
}
