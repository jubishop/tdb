import assert from "node:assert/strict";
import test from "node:test";
import { browser, element } from "./helpers/browser.mjs";
import { domContainer } from "./helpers/dom.mjs";

const success = (data) => ({ ok: true, json: async () => ({ ok: true, data }) });

function click(app, action, extra = {}) {
  const target = typeof action === "string" ? { dataset: { action, ...extra } } : action;
  assert.ok(target, "the requested control must exist");
  return app.listeners.get("click")({ target: { closest: () => target }, preventDefault() {} });
}

async function workspace(t, options) {
  const app = await browser(t, options);
  app.drawer = domContainer(app.node("#drawer"));
  app.network.handler = async (path, options) => {
    const issue = app.issues.find((issue) => path === `/v1/issues/${issue.id}`);
    if (issue) return success({ issue, dependencies: [], blocked_by: [], comments: [], logs: [] });
    if (path.endsWith("/move")) {
      const { issue_id, before_id } = JSON.parse(options.body);
      const index = app.issues.findIndex((issue) => issue.id === issue_id);
      const [moving] = app.issues.splice(index, 1);
      const before = before_id ? app.issues.findIndex((issue) => issue.id === before_id) : app.issues.length;
      app.issues.splice(before, 0, moving);
      return success({ positioned: true });
    }
  };
  return app;
}

const control = (app, direction) => app.drawer.querySelector(`[data-action="move-${direction}"]`);
const moves = (app) => app.requests.filter((request) => request.path.endsWith("/move"));

test("keyboard controls reorder within a column and retain focus after refresh", async (t) => {
  const app = await workspace(t);
  await click(app, "task", { id: "td-second" });
  for (const direction of ["up", "down"]) {
    const button = control(app, direction);
    assert.ok(button, `Move ${direction} is available in the task panel`);
    button.focus();
    await click(app, button);
    assert.equal(document.activeElement, control(app, direction));
    assert.equal(app.node("#error-banner").hidden, true);
  }
  assert.deepEqual(moves(app).map((request) => JSON.parse(request.body)), [
    { issue_id: "td-second", before_id: "td-first", include_closed: false },
    { issue_id: "td-second", before_id: "td-third", include_closed: false },
  ]);
  assert.deepEqual(app.issues.map((issue) => issue.status), ["open", "open", "open", "open"]);
  assert.equal(app.requests.filter((request) => request.method !== "GET").length, 2);
});

test("column boundaries prevent moves and other views omit board controls", async (t) => {
  const app = await workspace(t);
  app.issues[1].status = "blocked";
  await click(app, "refresh");
  for (const [id, direction] of [["td-first", "up"], ["td-last", "down"], ["td-second", "up"], ["td-second", "down"]]) {
    await click(app, "task", { id });
    const button = control(app, direction);
    assert.ok(button);
    assert.equal(button.getAttribute("aria-disabled"), "true");
    await click(app, button);
  }
  assert.equal(moves(app).length, 0);
  await click(app, "view", { view: "list" });
  await click(app, "task", { id: "td-first" });
  assert.equal(control(app, "up"), undefined);
  assert.equal(control(app, "down"), undefined);
});

test("moves cross only visible neighbors while preserving hidden task order", async (t) => {
  const app = await workspace(t);
  app.issues[1].type = "bug";
  const form = app.node("#filters");
  form.values = { search: "", search_mode: "text", type: "task", priority: "" };
  form.elements.include_closed.checked = false;
  t.mock.method(globalThis, "FormData", function (form) { return new Map(Object.entries(form.values)); });
  await click(app, "task", { id: "td-first" });
  app.node("#filters").listeners.get("change")();
  await new Promise(setImmediate);
  assert.doesNotMatch(app.node("#content").innerHTML, /td-second/);
  await click(app, control(app, "down"));
  assert.deepEqual(JSON.parse(moves(app)[0].body), {
    issue_id: "td-first", before_id: "td-last", include_closed: false,
  });
  assert.deepEqual(app.issues.map((issue) => issue.id), ["td-second", "td-third", "td-first", "td-last"]);
});

test("pending moves cannot overlap or be replaced by live refresh", async (t) => {
  const app = await workspace(t);
  await click(app, "task", { id: "td-second" });
  const entered = Promise.withResolvers();
  const response = Promise.withResolvers();
  const handle = app.network.handler;
  app.network.handler = async (path, options) => {
    if (path.endsWith("/move")) {
      entered.resolve();
      return response.promise;
    }
    return handle(path, options);
  };
  const up = control(app, "up");
  assert.ok(up);
  up.focus();
  const moving = click(app, up);
  await entered.promise;
  await click(app, control(app, "down"));
  await click(app, "refresh");
  const retained = control(app, "up") === up;
  response.resolve({ ok: false, status: 409, json: async () => ({ ok: false, error: { message: "Board changed; try again" } }) });
  await moving;
  assert.equal(retained, true);
  assert.equal(moves(app).length, 1);
  assert.equal(document.activeElement, control(app, "up"));
  assert.equal(app.drawer.querySelector("#detail-error").textContent, "Board changed; try again");
  assert.equal(control(app, "up").getAttribute("aria-disabled"), "false");
});

test("a pending filter refresh cannot change the displayed move context", async (t) => {
  const app = await workspace(t, { includeClosed: true });
  await click(app, "task", { id: "td-second" });
  const entered = Promise.withResolvers();
  const response = Promise.withResolvers();
  const handle = app.network.handler;
  let held = false;
  app.network.handler = async (path, options) => {
    if (path === "/v1/boards" && !held) {
      held = true;
      entered.resolve();
      return response.promise;
    }
    return handle(path, options);
  };
  const form = app.node("#filters");
  form.elements.include_closed.checked = false;
  t.mock.method(globalThis, "FormData", function () { return new Map(); });
  form.listeners.get("change")();
  await entered.promise;
  await click(app, control(app, "up"));
  response.resolve(success({ boards: [{ id: "bd-test", name: "Test board", is_builtin: true }] }));
  await new Promise(setImmediate);
  assert.equal(JSON.parse(moves(app)[0].body).include_closed, true);
  assert.equal(app.node("#error-banner").hidden, true);
});

test("filter changes update ordering controls without discarding a comment draft", async (t) => {
  const app = await workspace(t);
  await click(app, "task", { id: "td-second" });
  // Model the independently replaceable DOM region inside the task panel.
  const order = domContainer(element());
  order.innerHTML = app.drawer.innerHTML.match(/<div id="board-order">(<section[\s\S]*?<\/section>)<\/div>/)[1];
  const query = app.drawer.querySelector;
  app.drawer.querySelector = (selector) => selector === "#board-order" ? order
    : selector.startsWith('[data-action="move-') ? order.querySelector(selector) : query(selector);
  const comment = app.drawer.querySelector('[name="comment"]');
  comment.value = "Keep these review notes";
  app.issues[0].type = "bug";
  const form = app.node("#filters");
  form.elements.include_closed.checked = false;
  t.mock.method(globalThis, "FormData", function () { return new Map([["type", "task"]]); });
  form.listeners.get("change")();
  await new Promise(setImmediate);
  assert.equal(control(app, "up").getAttribute("aria-disabled"), "true");
  control(app, "down").focus();
  await click(app, control(app, "down"));
  assert.equal(document.activeElement, control(app, "down"));
  assert.equal(comment.value, "Keep these review notes");
  assert.equal(app.drawer.querySelector('[name="comment"]'), comment);
  assert.deepEqual(app.issues.map((issue) => issue.id), ["td-first", "td-third", "td-second", "td-last"]);
  app.issues.find((issue) => issue.id === "td-second").type = "bug";
  await click(app, "refresh");
  assert.equal(control(app, "up"), undefined, "a task excluded by filters has no ordering controls");
  assert.equal(comment.value, "Keep these review notes");
});
