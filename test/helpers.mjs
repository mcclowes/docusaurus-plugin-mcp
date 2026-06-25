import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A richer site fixture exercising URL derivation, MDX/text extraction, excludes,
// JSON + YAML specs, webhooks, x-tagGroups, deprecation, and circular/unresolved
// /sibling/array $refs.
export function makeSite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dpm-"));
  const w = (rel, content) => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };

  // Docs ---------------------------------------------------------------
  w("docs/intro.md", "---\ntitle: Intro\ndescription: The start.\n---\n\nWelcome.\n");
  // No title frontmatter -> falls back to first heading.
  w("docs/no-title.md", "## Derived Heading\n\nBody text about widgets.\n");
  // Only sidebar_label -> used as title.
  w("docs/sidebar-only.md", "---\nsidebar_label: Side Label\n---\n\nContent.\n");
  // Absolute slug wins over file path.
  w(
    "docs/guides/auth.md",
    "---\ntitle: Authentication\nslug: /guides/authentication\n---\n\n## Logging in\n\nUse a token to authenticate requests.\n",
  );
  // index.md -> directory URL.
  w("docs/guides/index.md", "---\ntitle: Guides\n---\n\nOverview.\n");
  // MDX with imports/JSX/code fence -> text extraction must strip the noise.
  w(
    "docs/reference/api.mdx",
    "---\ntitle: Reference\n---\n\nimport Foo from '@site/x';\n\n<Foo bar='baz' />\n\nThe quokka endpoint returns data.\n\n```js\nconst x = 1;\n```\n",
  );
  // Excluded via exclude option.
  w("docs/_internal/secret.md", "---\ntitle: Secret\n---\n\nHidden.\n");

  // JSON spec ----------------------------------------------------------
  w(
    "openapi/petstore.json",
    JSON.stringify({
      openapi: "3.0.0",
      info: { title: "Petstore", version: "1.2.3", description: "Pets API.\nSecond line." },
      servers: [{ url: "https://api.example.com" }],
      "x-tagGroups": [{ name: "Store", tags: ["Pets"] }],
      paths: {
        "/pets": {
          post: {
            operationId: "createPet",
            summary: "Create a pet",
            tags: ["Pets"],
            requestBody: {
              content: {
                "application/json": {
                  // array (allOf) + sibling key beside $ref + nested + circular + unresolved
                  schema: {
                    allOf: [{ $ref: "#/components/schemas/Pet" }],
                    description: "the pet",
                  },
                },
              },
            },
            responses: {
              "201": { description: "created" },
              "400": {
                description: "bad",
                content: { "application/json": { schema: { $ref: "#/components/schemas/Missing" } } },
              },
            },
          },
          get: { operationId: "ping", summary: "Ping pets", responses: { "200": { description: "ok" } } },
        },
        "/pets/{id}": {
          get: {
            operationId: "getPet",
            summary: "Get a pet",
            deprecated: true,
            tags: ["Pets"],
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            responses: { "200": { description: "ok" } },
          },
        },
      },
      webhooks: {
        petStatus: {
          post: { operationId: "petStatusEvent", summary: "Pet status changed", responses: { "200": { description: "ok" } } },
        },
      },
      components: {
        schemas: {
          Pet: {
            type: "object",
            required: ["name"],
            properties: {
              name: { type: "string" },
              tag: { type: "string" },
              friend: { $ref: "#/components/schemas/Pet" }, // circular
            },
          },
        },
      },
    }),
  );

  // YAML spec ----------------------------------------------------------
  w(
    "openapi/admin.yaml",
    [
      "openapi: 3.0.0",
      "info:",
      "  title: Admin",
      "  version: 9.9.9",
      "servers:",
      "  - url: https://admin.example.com",
      "paths:",
      "  /login:",
      "    post:",
      "      operationId: adminLogin",
      "      summary: Admin login",
      "      responses:",
      "        '200':",
      "          description: ok",
      "  /ping:",
      "    get:",
      "      operationId: ping", // duplicate operationId across specs -> ambiguity
      "      summary: Admin ping",
      "      responses:",
      "        '200':",
      "          description: ok",
      "",
    ].join("\n"),
  );

  return dir;
}

export const FULL_OPENAPI = [
  { name: "petstore", spec: "openapi/petstore.json" },
  { name: "admin", spec: "openapi/admin.yaml" },
];
