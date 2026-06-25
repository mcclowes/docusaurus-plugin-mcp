#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import { buildSnapshot, writeSnapshot } from "./indexer.js";
import { resolveOptions, type OpenApiSource } from "./options.js";
import { createNodeServer, loadSnapshot } from "./adapters.js";

function parseArgs(argv: string[]): { _: string[]; flags: Record<string, string[]> } {
  const _: string[] = [];
  const flags: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[(i += 1)] : "true";
      (flags[key] ??= []).push(val);
    } else {
      _.push(a);
    }
  }
  return { _, flags };
}

const one = (flags: Record<string, string[]>, key: string, fallback?: string) =>
  flags[key]?.[0] ?? fallback;

function parseOpenapi(values: string[] = []): OpenApiSource[] {
  return values.map((v) => {
    const eq = v.indexOf("=");
    if (eq === -1) throw new Error(`--openapi expects name=path, got "${v}"`);
    return { name: v.slice(0, eq), spec: v.slice(eq + 1) };
  });
}

const HELP = `docusaurus-plugin-mcp

Usage:
  docusaurus-plugin-mcp build [options]   Build a snapshot from a site dir
  docusaurus-plugin-mcp serve [options]   Serve an MCP endpoint over HTTP

build options:
  --site <dir>             Site dir (default ".")
  --docs <dir>             Docs dir, relative to site (default "docs")
  --route-base-path <p>    Docs route base path (default "/")
  --base-url <p>           Site base URL (default "/")
  --openapi <name=path>    OpenAPI spec to index (repeatable)
  --out <dir>              Output dir (default "build/mcp")

serve options:
  --snapshot <file>        Snapshot file (default "build/mcp/snapshot.json")
  --port <n>               Port (default 3100)
  --endpoint <p>           Endpoint path (default "/mcp")
  --name <s>               Server name reported to clients
  --version <s>            Server version reported to clients
  ...plus all build options, to build and serve in one step`;

function buildFromFlags(flags: Record<string, string[]>) {
  const site = path.resolve(one(flags, "site", ".")!);
  const options = resolveOptions({
    docsDir: one(flags, "docs"),
    routeBasePath: one(flags, "route-base-path"),
    openapi: parseOpenapi(flags.openapi),
    outputDir: one(flags, "out"),
  });
  return buildSnapshot({ siteDir: site, baseUrl: one(flags, "base-url", "/"), options });
}

async function main() {
  const { _, flags } = parseArgs(process.argv.slice(2));
  const cmd = _[0];

  if (!cmd || flags.help) {
    console.log(HELP);
    return;
  }

  if (cmd === "build") {
    const snapshot = buildFromFlags(flags);
    const out = path.resolve(one(flags, "out", "build/mcp")!);
    writeSnapshot(snapshot, out);
    console.log(
      `✔ ${snapshot.docs.length} docs, ${snapshot.operations.length} operations → ${out}/snapshot.json`,
    );
    return;
  }

  if (cmd === "serve") {
    const snapshotFile = one(flags, "snapshot", "build/mcp/snapshot.json")!;
    const hasBuildFlags = flags.openapi || flags.docs || flags.site;
    const snapshot =
      hasBuildFlags && !flags.snapshot
        ? buildFromFlags(flags)
        : fs.existsSync(path.resolve(snapshotFile))
          ? loadSnapshot(path.resolve(snapshotFile))
          : (() => {
              throw new Error(
                `Snapshot not found at ${snapshotFile}. Run a build first, or pass --site/--openapi to build on the fly.`,
              );
            })();

    const port = Number(one(flags, "port", "3100"));
    const endpoint = one(flags, "endpoint", "/mcp")!;
    const server = createNodeServer(snapshot, {
      endpoint,
      name: one(flags, "name"),
      version: one(flags, "version"),
    });
    server.listen(port, () => {
      console.log(`MCP server on http://localhost:${port}${endpoint}`);
      console.log(
        `${snapshot.docs.length} docs, ${snapshot.operations.length} operations, ${snapshot.meta.specs.length} specs`,
      );
    });
    return;
  }

  console.error(`Unknown command "${cmd}".\n\n${HELP}`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
