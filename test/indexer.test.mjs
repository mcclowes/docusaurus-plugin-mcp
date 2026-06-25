import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSnapshot, resolveOptions } from "../dist/index.js";
import { makeSite, FULL_OPENAPI } from "./helpers.mjs";

function build(extra = {}) {
  const dir = makeSite();
  return buildSnapshot({
    siteDir: dir,
    baseUrl: extra.baseUrl ?? "/",
    siteTitle: "Test docs",
    options: resolveOptions({
      routeBasePath: extra.routeBasePath ?? "/",
      openapi: extra.openapi ?? FULL_OPENAPI,
      exclude: extra.exclude ?? ["_internal"],
    }),
  });
}

const byTitle = (snap, t) => snap.docs.find((d) => d.title === t);
const byId = (snap, id) => snap.docs.find((d) => d.id === id);

test("excludes matching docs", () => {
  const snap = build();
  assert.equal(byTitle(snap, "Secret"), undefined, "_internal excluded");
  // intro, no-title, sidebar-only, guides/auth, guides/index, reference/api
  assert.equal(snap.docs.length, 6);
});

test("title falls back to heading, then sidebar_label", () => {
  const snap = build();
  assert.ok(byTitle(snap, "Derived Heading"), "heading fallback");
  assert.ok(byTitle(snap, "Side Label"), "sidebar_label fallback");
});

test("captures description frontmatter", () => {
  const snap = build();
  assert.equal(byId(snap, "intro").description, "The start.");
});

test("derives URLs: slug, index, plain, nested", () => {
  const snap = build();
  assert.equal(byTitle(snap, "Authentication").url, "/guides/authentication", "absolute slug");
  assert.equal(byTitle(snap, "Guides").url, "/guides", "index.md -> dir");
  assert.equal(byId(snap, "intro").url, "/intro");
  assert.equal(byId(snap, "reference/api").url, "/reference/api", "mdx nested");
});

test("honors routeBasePath and baseUrl in URLs", () => {
  const snap = build({ routeBasePath: "/docs", baseUrl: "/" });
  assert.equal(byId(snap, "intro").url, "/docs/intro");

  const snap2 = build({ routeBasePath: "/docs", baseUrl: "/proj/" });
  assert.equal(byId(snap2, "intro").url, "/proj/docs/intro");
});

test("strips MDX imports/JSX/code fences from search text", () => {
  const snap = build();
  const ref = byId(snap, "reference/api");
  assert.ok(!ref.text.includes("import"), "no import line");
  assert.ok(!ref.text.includes("<Foo"), "no JSX tag");
  assert.ok(ref.text.includes("quokka endpoint"), "keeps prose");
});

test("categories are counted and sorted", () => {
  const snap = build();
  const names = snap.meta.categories.map((c) => c.name);
  assert.deepEqual(names, [...names].sort(), "sorted");
  const guides = snap.meta.categories.find((c) => c.name === "guides");
  assert.equal(guides.count, 2, "auth + index");
});

test("indexes JSON and YAML specs with metadata", () => {
  const snap = build();
  const names = snap.meta.specs.map((s) => s.name).sort();
  assert.deepEqual(names, ["admin", "petstore"]);
  const petstore = snap.meta.specs.find((s) => s.name === "petstore");
  assert.equal(petstore.version, "1.2.3");
  assert.equal(petstore.description, "Pets API.", "first line only");
  const admin = snap.meta.specs.find((s) => s.name === "admin");
  assert.equal(admin.version, "9.9.9", "YAML parsed");
});

test("separates operations from webhooks and maps tag groups", () => {
  const snap = build();
  const create = snap.operations.find((o) => o.operationId === "createPet");
  assert.equal(create.kind, "operation");
  assert.equal(create.tagGroup, "Store", "x-tagGroups mapping");
  const hook = snap.operations.find((o) => o.operationId === "petStatusEvent");
  assert.equal(hook.kind, "webhook");
  const petstore = snap.meta.specs.find((s) => s.name === "petstore");
  assert.equal(petstore.webhookCount, 1);
});

test("flags deprecated operations", () => {
  const snap = build();
  assert.equal(snap.operations.find((o) => o.operationId === "getPet").deprecated, true);
  assert.equal(snap.operations.find((o) => o.operationId === "createPet").deprecated, false);
});

test("works with no OpenAPI configured", () => {
  const snap = build({ openapi: [] });
  assert.equal(snap.operations.length, 0);
  assert.equal(snap.meta.specs.length, 0);
});

test("throws a clear error for a missing spec file", () => {
  const dir = makeSite();
  assert.throws(
    () =>
      buildSnapshot({
        siteDir: dir,
        options: resolveOptions({ openapi: [{ name: "nope", spec: "openapi/nope.json" }] }),
      }),
    /not found/,
  );
});
