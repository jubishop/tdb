import assert from "node:assert/strict";
import test from "node:test";
import { browser } from "./helpers/browser.mjs";

function click(app, action, extra = {}) {
  const target = { dataset: { action, ...extra } };
  return app.listeners.get("click")({ target: { closest: () => target }, preventDefault() {} });
}

function response(issues, hasMore = false) {
  return { ok: true, json: async () => ({ ok: true, data: { issues, has_more: hasMore } }) };
}

for (const view of ["board", "list", "reviews"]) {
  test(`text search finds label matches in ${view} and retains its filters`, async (t) => {
    const app = await browser(t);
    const match = { ...app.issues[0], labels: ["Release-ready"], type: "bug", priority: "P1", status: "in_review" };
    app.issues[0] = match;
    const expectedQuery = 'id ~ "release" OR title ~ "release" OR description ~ "release" OR labels ~ "release"';
    app.network.handler = async (path) => {
      if (!path.startsWith("/v1/issues?")) return;
      const query = new URL(path, "http://tdb.test").searchParams;
      if (!query.has("search")) return response([match]);
      if (query.get("search_mode") === "text") return response([]);
      assert.equal(query.get("search"), expectedQuery);
      assert.equal(query.get("search_mode"), "tdq");
      assert.equal(query.get("type"), "bug");
      assert.equal(query.get("priority"), "P1");
      assert.equal(query.get("include_closed"), "true");
      assert.equal(query.get("status"), view === "reviews" ? "in_review" : null);
      return response([match]);
    };
    const filters = new Map([
      ["search", "release"], ["search_mode", "text"], ["type", "bug"], ["priority", "P1"],
    ]);
    t.mock.method(globalThis, "FormData", function () { return filters; });
    app.node("#filters").elements.include_closed.checked = true;
    app.node("#filters").listeners.get("change")();
    await click(app, "view", { view });
    assert.equal(app.node("#error-banner").hidden, true);
    assert.match(app.node("#content").innerHTML, /td-first/);
    assert.doesNotMatch(app.node("#content").innerHTML, /td-second/);
    assert.equal(app.node("#result-count").textContent.split(" tasks")[0], "1");
  });
}

test("text searches quote literal input and preserve matches across pages", async (t) => {
  const app = await browser(t, { hash: "#list" });
  const search = 'a"b\\c OR status = closed';
  const expectedQuery = 'id ~ "a\\"b\\\\c OR status = closed" OR title ~ "a\\"b\\\\c OR status = closed" OR description ~ "a\\"b\\\\c OR status = closed" OR labels ~ "a\\"b\\\\c OR status = closed"';
  const pages = [];
  app.network.handler = async (path) => {
    if (!path.startsWith("/v1/issues?")) return;
    const query = new URL(path, "http://tdb.test").searchParams;
    if (!query.has("search")) return response([]);
    assert.equal(query.get("search_mode"), "tdq");
    assert.equal(query.get("search"), expectedQuery);
    assert.equal(query.get("include_closed"), null);
    const offset = Number(query.get("offset"));
    assert.equal(query.get("limit"), "200");
    pages.push(offset);
    return response(offset === 0 ? [app.issues[0]] : [app.issues[1]], offset === 0);
  };
  t.mock.method(globalThis, "FormData", function () { return new Map([["search", search], ["search_mode", "text"]]); });
  app.node("#filters").listeners.get("change")();
  await new Promise(setImmediate);
  assert.equal(app.node("#error-banner").hidden, true);
  assert.deepEqual(pages, [0, 200]);
  assert.match(app.node("#content").innerHTML, /td-first/);
  assert.match(app.node("#content").innerHTML, /td-second/);
});

test("explicit TDQ searches retain the user's expression", async (t) => {
  const app = await browser(t, { hash: "#list" });
  const search = "labels ~ release AND priority <= P1";
  app.network.handler = async (path) => {
    if (!path.startsWith("/v1/issues?")) return;
    const query = new URL(path, "http://tdb.test").searchParams;
    if (!query.has("search")) return response([]);
    assert.equal(query.get("search_mode"), "tdq");
    assert.equal(query.get("search"), search);
    return response([app.issues[0]]);
  };
  t.mock.method(globalThis, "FormData", function () { return new Map([["search", search], ["search_mode", "tdq"]]); });
  app.node("#filters").listeners.get("change")();
  await new Promise(setImmediate);
  assert.equal(app.node("#error-banner").hidden, true);
  assert.match(app.node("#content").innerHTML, /td-first/);
});
