import path from "node:path";
import { buildSnapshot, writeSnapshot } from "./indexer.js";
import { resolveOptions, type PluginOptions } from "./options.js";
import type { Snapshot } from "./types.js";

// Re-exports for programmatic use (CLI, serverless functions, custom servers).
export { buildSnapshot, writeSnapshot } from "./indexer.js";
export { resolveOptions } from "./options.js";
export type { PluginOptions, OpenApiSource } from "./options.js";
export type { Snapshot, DocRecord, OperationRecord, Meta, SpecMeta } from "./types.js";

// Loose Docusaurus context shape, kept minimal to avoid a hard type dependency.
interface LoadContext {
  siteDir: string;
  siteConfig: { baseUrl?: string; url?: string; title?: string };
}

interface Plugin {
  name: string;
  loadContent(): Promise<Snapshot>;
  contentLoaded(args: {
    content: Snapshot;
    actions: { setGlobalData(data: unknown): void };
  }): Promise<void>;
  postBuild(args: { outDir: string; content: Snapshot }): Promise<void>;
}

export default function pluginMcp(context: LoadContext, rawOptions: PluginOptions = {}): Plugin {
  const { siteDir, siteConfig } = context;
  const options = resolveOptions(rawOptions, siteConfig.title);

  return {
    name: "docusaurus-plugin-mcp",

    async loadContent() {
      return buildSnapshot({
        siteDir,
        baseUrl: siteConfig.baseUrl ?? "/",
        siteTitle: siteConfig.title,
        options,
      });
    },

    async contentLoaded({ content, actions }) {
      // Expose the lightweight meta to theme components (e.g. an install button).
      actions.setGlobalData({ meta: content.meta, endpoint: options.endpoint });
    },

    async postBuild({ outDir, content }) {
      writeSnapshot(content, path.join(outDir, options.outputDir));
    },
  };
}
