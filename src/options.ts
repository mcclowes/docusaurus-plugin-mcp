export interface OpenApiSource {
  /** Short, unique name used to scope operations (e.g. "multi", "admin"). */
  name: string;
  /** Path to the spec file, relative to the site dir. JSON or YAML. */
  spec: string;
}

export interface ServerInfo {
  name: string;
  version: string;
}

export interface PluginOptions {
  /** MCP server identity reported to clients. */
  server?: Partial<ServerInfo>;
  /** One-line steer shown to the model on connect. */
  instructions?: string;
  /** Docs source dir, relative to the site dir. Default "docs". */
  docsDir?: string;
  /** Route base path the docs are served under. Default "/". */
  routeBasePath?: string;
  /** OpenAPI specs to index. Default none. */
  openapi?: OpenApiSource[];
  /** Glob-free substring excludes applied to source-relative doc paths. */
  exclude?: string[];
  /** Where to emit the snapshot, relative to the build outDir. Default "mcp". */
  outputDir?: string;
  /** Default mount path for the CLI/standalone MCP endpoint. Default "/mcp". */
  endpoint?: string;
}

export interface ResolvedOptions extends Required<Omit<PluginOptions, "server" | "openapi" | "instructions">> {
  server: ServerInfo;
  instructions?: string;
  openapi: OpenApiSource[];
}

export function resolveOptions(
  options: PluginOptions = {},
  siteTitle = "docs",
): ResolvedOptions {
  return {
    server: {
      name: options.server?.name ?? "docs",
      version: options.server?.version ?? "0.0.0",
    },
    instructions: options.instructions,
    docsDir: options.docsDir ?? "docs",
    routeBasePath: options.routeBasePath ?? "/",
    openapi: options.openapi ?? [],
    exclude: options.exclude ?? [],
    outputDir: options.outputDir ?? "mcp",
    endpoint: options.endpoint ?? "/mcp",
  };
}
