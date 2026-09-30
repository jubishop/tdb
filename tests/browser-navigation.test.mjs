import assert from "node:assert/strict";
import test from "node:test";
import { browser } from "./helpers/browser.mjs";
import { domContainer } from "./helpers/dom.mjs";

function click(listeners, action, extra = {}) {
  const target = { dataset: { action, ...extra } };
  return listeners.get("click")({ target: { closest: () => target }, preventDefault() {} });
}

async function workspace(t) {
  const app = await browser(t);
  const drawer = domContainer(app.node("#drawer"));
  app.network.handler = async (path) => {
    const issue = app.issues.find((issue) => path === `/v1/issues/${issue.id}`);
    if (issue) return {
      ok: true,
      json: async () => ({ ok: true, data: {
        issue, dependencies: [], blocked_by: [], comments: [], logs: [],
      } }),
    };
  };
  return { ...app, drawer };
}

for (const target of ["#list?issue=td-second", "#list"]) {
  test(`declining navigation to ${target} keeps the task, view, address, and draft`, async (t) => {
    const { drawer, listeners, windowListeners, node } = await workspace(t);
    await click(listeners, "task", { id: "td-first" });
    const draft = drawer.querySelector('[name="comment"]');
    draft.value = "Unsaved review notes";
    location.hash = target;
    await windowListeners.get("hashchange")();
    assert.equal(location.hash, "#board?issue=td-first");
    assert.equal(node("#breadcrumb-view").textContent, "Board");
    assert.equal(drawer.hidden, false);
    assert.equal(drawer.querySelector('[name="comment"]'), draft);
    assert.equal(draft.value, "Unsaved review notes");
  });
}

test("accepting draft discard completes task navigation", async (t) => {
  const { drawer, listeners, windowListeners, dialogs, node } = await workspace(t);
  await click(listeners, "task", { id: "td-first" });
  drawer.querySelector('[name="comment"]').value = "Discard this draft";
  dialogs.confirm = true;
  location.hash = "#list?issue=td-second";
  await windowListeners.get("hashchange")();
  assert.equal(location.hash, "#list?issue=td-second");
  assert.equal(node("#breadcrumb-view").textContent, "List");
  assert.match(drawer.innerHTML, /<h2 class="task-heading">second<\/h2>/);
});

test("a failed older route cannot close a newer task", async (t) => {
  const { drawer, network, windowListeners } = await workspace(t);
  const entered = Promise.withResolvers();
  const response = Promise.withResolvers();
  const handle = network.handler;
  network.handler = async (path, options) => {
    if (path !== "/v1/issues/td-first") return handle(path, options);
    entered.resolve();
    return response.promise;
  };
  location.hash = "#board?issue=td-first";
  const previous = windowListeners.get("hashchange")();
  await entered.promise;
  location.hash = "#list?issue=td-second";
  await windowListeners.get("hashchange")();
  response.resolve({ ok: false, status: 404, json: async () => ({ ok: false, error: { message: "Task deleted" } }) });
  await previous;
  assert.equal(location.hash, "#list?issue=td-second");
  assert.equal(drawer.hidden, false);
  assert.match(drawer.innerHTML, /<h2 class="task-heading">second<\/h2>/);
});

test("the skip-to-tasks fragment does not close task details", async (t) => {
  const { drawer, listeners, windowListeners } = await workspace(t);
  await click(listeners, "task", { id: "td-first" });
  location.hash = "#content";
  await windowListeners.get("hashchange")();
  assert.equal(drawer.hidden, false);
  assert.match(drawer.innerHTML, /<h2 class="task-heading">first<\/h2>/);
});

test("opening the workspace at the skip-link fragment loads tasks", async (t) => {
  const { node } = await browser(t, { hash: "#content" });
  assert.match(node("#content").innerHTML, /td-first/);
});

test("closing task details during dependency removal does not report a false failure", async (t) => {
  const { drawer, network, listeners, node } = await workspace(t);
  await click(listeners, "task", { id: "td-first" });
  const entered = Promise.withResolvers();
  const response = Promise.withResolvers();
  const handle = network.handler;
  network.handler = async (path, options) => {
    if (path !== "/v1/issues/td-first/dependencies/dep-one") return handle(path, options);
    entered.resolve();
    return response.promise;
  };
  const removal = click(listeners, "remove-dependency", { id: "dep-one" });
  await entered.promise;
  await click(listeners, "close-task");
  response.resolve({ ok: true, json: async () => ({ ok: true, data: {} }) });
  await removal;
  assert.equal(drawer.hidden, true);
  assert.equal(node("#error-banner").hidden, true);
  assert.equal(node("#toast").textContent, "Dependency removed");
});
