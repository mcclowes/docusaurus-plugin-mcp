// Vercel serverless function that serves the MCP endpoint from the build snapshot.
// Place this in your Docusaurus site repo, deploy to Vercel, and your docs will
// have a live /api/mcp endpoint. Rebuild to refresh the snapshot.
import { createNodeHandler } from "docusaurus-plugin-mcp/server";
// Adjust the path to wherever your build emits the snapshot.
import snapshot from "../build/mcp/snapshot.json" with { type: "json" };

export const config = { maxDuration: 60 };

export default createNodeHandler(snapshot, {
  name: "my-docs",
  version: "1.0.0",
});
