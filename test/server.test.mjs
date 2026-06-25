import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import pluginMcp, { buildSnapshot, resolveOptions } from "../dist/index.js";
import { createMcpServer, createNodeServer, loadSnapshot } from "../dist/adapters.js";
import { makeSite, FULL_OPENAPI } from "./helpers.mjs";

function snapshot(openapi = FULL_OPENAPI) {
  return buildSnapshot({
    siteDir: makeSite(),
    siteTitle: "Test docs",
    options: resolveOptions({ openapi, exclude: ["_internal"] }),
  });
}

async function connectInMemory(server) {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

// Tool registration ---------------------------------------------------

test("registers all six tools when OpenAPI is configured", async () => {
  const client = await connectInMemory(createMcpServer(snapshot()));
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "get_endpoint",
    "list_apis",
    "list_doc_categories",
    "read_doc",
    "search_api",
    "search_docs",
  ]);
  await client.close();
});

test("registers only the doc tools when no OpenAPI is configured", async () => {
  const client = await connectInMemory(createMcpServer(snapshot([])));
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["list_doc_categories", "read_doc", "search_docs"]);
  await client.close();
});

test("reports server identity and instructions", async () => {
  const server = createMcpServer(snapshot(), {
    name: "my-docs",
    version: "2.0.0",
    instructions: "Use search_api.",
  });
  const client = await connectInMemory(server);
  assert.deepEqual(client.getServerVersion(), { name: "my-docs", version: "2.0.0" });
  assert.match(client.getInstructions() ?? "", /search_api/);
  await client.close();
});

// Tool calls ----------------------------------------------------------

test("tool calls return text and structuredContent", async () => {
  const client = await connectInMemory(createMcpServer(snapshot()));

  const docs = await client.callTool({ name: "search_docs", arguments: { query: "token" } });
  assert.ok(docs.content[0].text.length > 0, "human text");
  assert.ok(Array.isArray(docs.structuredContent.data), "structured array");

  const ep = await client.callTool({
    name: "get_endpoint",
    arguments: { operationId: "createPet" },
  });
  const props =
    ep.structuredContent.data.requestBody.content["application/json"].schema.allOf[0].properties;
  assert.ok(props.name, "$ref resolved over the wire");

  await client.close();
});

test("read_doc miss returns suggestions, not an error", async () => {
  const client = await connectInMemory(createMcpServer(snapshot()));
  const res = await client.callTool({ name: "read_doc", arguments: { url: "/nope" } });
  assert.equal(res.structuredContent.data.found, false);
  await client.close();
});

// Plugin lifecycle ----------------------------------------------------

test("plugin emits a snapshot in postBuild", async () => {
  const dir = makeSite();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "dpm-out-"));
  const plugin = pluginMcp(
    { siteDir: dir, siteConfig: { baseUrl: "/", title: "Test docs" } },
    { openapi: FULL_OPENAPI, exclude: ["_internal"] },
  );
  assert.equal(plugin.name, "docusaurus-plugin-mcp");

  const globals = [];
  const content = await plugin.loadContent();
  await plugin.contentLoaded({ content, actions: { setGlobalData: (d) => globals.push(d) } });
  await plugin.postBuild({ outDir, content });

  const file = path.join(outDir, "mcp", "snapshot.json");
  const written = loadSnapshot(file);
  assert.equal(written.docs.length, 6);
  assert.equal(written.meta.siteTitle, "Test docs");
  assert.equal(globals[0].meta.docCount, 6, "global data exposed");
  assert.ok(fs.existsSync(path.join(outDir, "mcp", "meta.json")), "meta.json written");
});

// HTTP adapter --------------------------------------------------------

test("createNodeServer serves MCP over streamable HTTP", async () => {
  const server = createNodeServer(snapshot(), { name: "http-docs", version: "1.0.0" });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  try {
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`)));
    assert.equal((await client.listTools()).tools.length, 6);
    await client.close();
  } finally {
    server.close();
  }
});

test("HTTP adapter handles CORS preflight and unknown paths", async () => {
  const server = createNodeServer(snapshot());
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  try {
    const opt = await fetch(`http://localhost:${port}/mcp`, { method: "OPTIONS" });
    assert.equal(opt.status, 204);
    assert.equal(opt.headers.get("access-control-allow-origin"), "*");

    const miss = await fetch(`http://localhost:${port}/elsewhere`);
    assert.equal(miss.status, 404);
  } finally {
    server.close();
  }
});
