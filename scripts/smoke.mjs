import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MCP_URL || "http://localhost:3100/mcp";
const c = new Client({ name: "smoke", version: "1.0.0" });
await c.connect(new StreamableHTTPClientTransport(new URL(url)));

console.log("serverInfo:", JSON.stringify(c.getServerVersion()));
const tools = (await c.listTools()).tools;
console.log("tools:", tools.map((t) => t.name).join(", "));

async function call(name, args) {
  const r = await c.callTool({ name, arguments: args });
  console.log(`\n=== ${name}(${JSON.stringify(args)}) ===`);
  console.log((r.content?.[0]?.text ?? "").slice(0, 360));
  return r;
}

await call("search_docs", { query: "managed account", limit: 2 });
const api = await call("search_api", { query: "login password", limit: 2 });
await call("get_endpoint", { operationId: "loginWithPassword", spec: "multi" });
const ep = await c.callTool({
  name: "get_endpoint",
  arguments: { operationId: "loginWithPassword", spec: "multi" },
});
const body = ep.structuredContent?.data?.requestBody;
const props = body?.content?.["application/json"]?.schema?.properties;
console.log("\n$ref resolved?", props ? `yes — body props: ${Object.keys(props).join(", ")}` : "NO");

// docs URL round-trip: read_doc using a URL returned by search_docs
const sd = await c.callTool({ name: "search_docs", arguments: { query: "managed account", limit: 1 } });
const firstUrl = sd.structuredContent?.data?.[0]?.url;
const rd = await c.callTool({ name: "read_doc", arguments: { url: firstUrl } });
console.log("\nread_doc by URL", firstUrl, "->", rd.structuredContent?.data?.title ? "ok" : "FAILED");

await c.close();
console.log("\n✓ smoke test complete");
