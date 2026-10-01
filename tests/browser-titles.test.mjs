import assert from "node:assert/strict";
import test from "node:test";
import { browser } from "./helpers/browser.mjs";
import { domContainer } from "./helpers/dom.mjs";

const success = (data) => ({ ok: true, json: async () => ({ ok: true, data }) });
function click(app, action, extra = {}) {
  const target = { dataset: { action, ...extra } };
  return app.listeners.get("click")({ target: { closest: () => target }, preventDefault() {} });
}

for (const editing of [false, true]) {
  test(`${editing ? "editing" : "creating"} a task permits the full Unicode title limit`, async (t) => {
    const title = "😀".repeat(200);
    const app = await browser(t, { networkHandler: async (path) =>
      path === "/v1/project" ? success({
        name: "Test", path: "/test", title_min_length: 15, title_max_length: 200,
      }) : undefined });
    const drawer = domContainer(app.node("#drawer"));
    app.network.handler = async (path) => path === "/v1/issues/td-first" ? success({
      issue: { ...app.issues[0], title }, dependencies: [], blocked_by: [], comments: [], logs: [],
    }) : undefined;
    if (editing) {
      await click(app, "task", { id: "td-first" });
      await click(app, "edit-task");
    } else await click(app, "new-task");

    const input = drawer.querySelector('[name="title"]');
    // Native text inputs apply maxlength to UTF-16 units, unlike td's character count.
    const limit = input.getAttribute("maxlength");
    assert.ok(limit === null || title.length <= Number(limit),
      "the browser must not truncate a title accepted by td");
    assert.match(drawer.innerHTML, /15–200 characters/);
  });
}
