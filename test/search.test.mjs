import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSnapshot, resolveOptions } from "../dist/index.js";
import { DocsIndex } from "../dist/adapters.js";
import { makeSite, FULL_OPENAPI } from "./helpers.mjs";

function index() {
  const dir = makeSite();
  const snap = buildSnapshot({
    siteDir: dir,
    options: resolveOptions({ openapi: FULL_OPENAPI, exclude: ["_internal"] }),
  });
  return new DocsIndex(snap);
}

// Docs ----------------------------------------------------------------

test("searchDocs ranks, snippets, and respects limit", () => {
  const i = index();
  const hits = i.searchDocs("authenticate", 5);
  assert.ok(hits.some((h) => h.title === "Authentication"));
  assert.ok(hits[0].snippet.length > 0, "has snippet");
  assert.ok(i.searchDocs("a", 2).length <= 2, "limit honored");
});

test("searchDocs filters by category", () => {
  const i = index();
  const hits = i.searchDocs("token", 10, "guides");
  assert.ok(hits.every((h) => h.category === "guides"));
});

test("readDoc resolves by URL, by id, and loose path", () => {
  const i = index();
  assert.equal(i.readDoc("/guides/authentication").ok, true, "by url");
  assert.equal(i.readDoc("intro").ok, true, "by id");
  assert.equal(i.readDoc("/intro/").ok, true, "trailing slash");
  const doc = i.readDoc("intro");
  assert.ok(doc.doc.raw.includes("Welcome"), "returns raw markdown");
});

test("readDoc miss returns suggestions", () => {
  const i = index();
  const res = i.readDoc("guid");
  assert.equal(res.ok, false);
  assert.ok(res.suggestions.length > 0, "offers suggestions");
});

test("listCategories and listApis expose meta", () => {
  const i = index();
  assert.ok(i.listCategories().length > 0);
  assert.equal(i.listApis().length, 2);
});

// API search ----------------------------------------------------------

test("searchApi returns tags as an array and a boolean deprecated flag", () => {
  const i = index();
  const hits = i.searchApi("create pet", 5);
  const create = hits.find((h) => h.operationId === "createPet");
  assert.ok(Array.isArray(create.tags), "tags is an array");
  assert.equal(typeof create.deprecated, "boolean");
});

test("searchApi filters by spec, method, and kind", () => {
  const i = index();
  assert.ok(i.searchApi("login", 10, { spec: "admin" }).every((h) => h.spec === "admin"));
  assert.ok(i.searchApi("pet", 10, { method: "post" }).every((h) => h.method === "POST"));
  const hooks = i.searchApi("pet", 10, { kind: "webhook" });
  assert.ok(hooks.every((h) => h.kind === "webhook"));
});

// get_endpoint + $ref resolution --------------------------------------

test("getEndpoint inlines $refs and arrays, merges siblings", () => {
  const i = index();
  const ep = i.getEndpoint({ operationId: "createPet" });
  assert.ok(!("error" in ep));
  const schema = ep.requestBody.content["application/json"].schema;
  // allOf[0] is the inlined Pet, plus the sibling `description` is preserved.
  assert.equal(schema.description, "the pet", "sibling key kept");
  assert.deepEqual(Object.keys(schema.allOf[0].properties), ["name", "tag", "friend"]);
});

test("getEndpoint breaks circular $refs with a marker", () => {
  const i = index();
  const ep = i.getEndpoint({ operationId: "createPet" });
  const pet = ep.requestBody.content["application/json"].schema.allOf[0];
  assert.equal(pet.properties.friend.circular, true, "circular marked, no infinite loop");
});

test("getEndpoint marks unresolved $refs", () => {
  const i = index();
  const ep = i.getEndpoint({ operationId: "createPet" });
  const bad = ep.responses["400"].content["application/json"].schema;
  assert.equal(bad.unresolved, true);
});

test("getEndpoint finds by path + method and surfaces deprecation", () => {
  const i = index();
  const ep = i.getEndpoint({ path: "/pets/{id}", method: "get" });
  assert.equal(ep.operationId, "getPet");
  assert.equal(ep.deprecated, true);
});

test("getEndpoint reports ambiguity across specs, resolved by spec", () => {
  const i = index();
  const amb = i.getEndpoint({ operationId: "ping" });
  assert.ok("error" in amb && /[Aa]mbiguous/.test(amb.error), "ambiguous across specs");
  assert.ok(amb.suggestions.length >= 2);
  const ok = i.getEndpoint({ operationId: "ping", spec: "admin" });
  assert.equal(ok.spec, "admin", "spec disambiguates");
});

test("getEndpoint suggests near matches when not found", () => {
  const i = index();
  const res = i.getEndpoint({ operationId: "createPe" });
  assert.ok("error" in res);
  assert.ok(res.suggestions.some((s) => s.includes("createPet")));
});

test("getEndpoint errors without operationId or path", () => {
  const i = index();
  assert.ok("error" in i.getEndpoint({}));
});
