# docusaurus-plugin-mcp

Expose your Docusaurus docs **and OpenAPI specs** as an [MCP](https://modelcontextprotocol.io) server, so AI agents like Claude, Cursor, and VS Code can search your docs and inspect API endpoints from the editor.

Most docs-MCP tools index prose only. This one treats your OpenAPI specs as a first-class source: it resolves `$ref`s and serves full request and response schemas, so an agent gets the real shape of an endpoint instead of guessing field names.

## How it works

The plugin runs at build time. It reads your docs and OpenAPI files and writes a single snapshot (`build/<outputDir>/snapshot.json`) alongside your site. A small, host-agnostic handler then serves MCP over HTTP from that snapshot.

Docusaurus sites usually deploy as static files, which can't serve a live endpoint. So serving is split out: a CLI for local dev, and a tiny serverless function for production. The plugin's only job is producing the snapshot.

## Install

```bash
npm install docusaurus-plugin-mcp
```

## Configure

```js
// docusaurus.config.js
export default {
  plugins: [
    [
      'docusaurus-plugin-mcp',
      {
        server: { name: 'my-docs', version: '1.0.0' },
        // OpenAPI specs to index, paths relative to the site dir. Optional.
        openapi: [
          { name: 'api', spec: 'openapi/api.json' },
          { name: 'admin', spec: 'openapi/admin.yaml' },
        ],
      },
    ],
  ],
};
```

Run `docusaurus build` and you'll get `build/mcp/snapshot.json`.

### Options

| Option | Default | Description |
| --- | --- | --- |
| `server.name` / `server.version` | site title / `0.0.0` | Identity reported to MCP clients. |
| `instructions` | — | One-line steer shown to the model on connect. |
| `docsDir` | `docs` | Docs source dir, relative to the site. |
| `routeBasePath` | `/` | Route base path your docs are served under. Used to build real page URLs. |
| `openapi` | `[]` | `{ name, spec }[]`. `spec` is a JSON or YAML path relative to the site. |
| `exclude` | `[]` | Substrings; any source-relative doc path containing one is skipped. |
| `outputDir` | `mcp` | Snapshot location, relative to the build `outDir`. |
| `endpoint` | `/mcp` | Default endpoint path for the CLI server. |

## Tools

| Tool | Description |
| --- | --- |
| `search_docs` | Full-text search the docs. Returns URL, title, category, snippet. |
| `read_doc` | Full markdown of a page by URL. |
| `list_doc_categories` | Categories with page counts. |
| `list_apis` | The indexed OpenAPI specs with versions and counts. |
| `search_api` | Search operations and webhook events by path, name, summary, or tag. |
| `get_endpoint` | Full detail of one operation: params, request body, responses, `$ref`s resolved. |

The three `*_api` tools only appear when you configure `openapi`. Everything is read-only.

## Serve it

### Local dev

After a build, serve the snapshot:

```bash
npx docusaurus-plugin-mcp serve            # reads build/mcp/snapshot.json on :3100
```

Or build and serve in one step, without a full Docusaurus build:

```bash
npx docusaurus-plugin-mcp serve --site . --openapi api=openapi/api.json
```

Then point a client at `http://localhost:3100/mcp`, or inspect it:

```bash
npx @modelcontextprotocol/inspector   # connect via Streamable HTTP
```

### Production

Static hosting can't serve a live endpoint, so add one serverless function that imports the snapshot. The handler is a standard Node `(req, res)`. Vercel example:

```ts
// api/mcp.ts
import { createNodeHandler } from 'docusaurus-plugin-mcp/server';
import snapshot from '../build/mcp/snapshot.json' with { type: 'json' };

export default createNodeHandler(snapshot, { name: 'my-docs', version: '1.0.0' });
```

It's stateless: a fresh server is created per request, so it scales horizontally with no session store. The same handler works in any Node serverless runtime or an Express route. See [`examples/vercel`](./examples/vercel).

### Connect a client

```bash
# Claude Code
claude mcp add --transport http my-docs https://docs.example.com/mcp
```

```json
// Cursor / VS Code: .cursor/mcp.json or .vscode/mcp.json
{ "mcpServers": { "my-docs": { "url": "https://docs.example.com/mcp" } } }
```

## Programmatic use

```ts
import { buildSnapshot, resolveOptions } from 'docusaurus-plugin-mcp';
import { createMcpServer, createNodeHandler, loadSnapshot } from 'docusaurus-plugin-mcp/server';
```

- `buildSnapshot({ siteDir, baseUrl, options })` — build a snapshot in memory.
- `createMcpServer(snapshot, opts)` — a configured `McpServer` from the SDK.
- `createNodeHandler(snapshot, opts)` — a stateless Node request handler.
- `loadSnapshot(file)` — read a snapshot from disk.

## Limitations

- **Doc URLs** are derived from `routeBasePath` plus the file path or `slug` frontmatter. That covers the common cases; exotic routing or path aliases may not match exactly.
- **Refreshing** happens at build. Rebuild to pick up doc changes. The CLI's build-on-the-fly mode is for dev.
- **Runtime** targets Node. Web-standard/edge runtimes aren't supported yet.

## License

MIT
