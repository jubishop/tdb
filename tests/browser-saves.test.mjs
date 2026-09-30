import assert from "node:assert/strict";
import test from "node:test";
import { browser, element } from "./helpers/browser.mjs";
import { domContainer } from "./helpers/dom.mjs";

function click(listeners, action, extra = {}) {
  const target = { dataset: { action, ...extra } };
  return listeners.get("click")({ target: { closest: () => target }, preventDefault() {} });
}

const success = (data) => ({ ok: true, json: async () => ({ ok: true, data }) });
const readFailure = () => ({
  ok: false, status: 503,
  json: async () => ({ ok: false, error: { message: "Detail reload unavailable" } }),
});

async function workspace(t) {
  const app = await browser(t);
  const drawer = domContainer(app.node("#drawer"));
  const issue = app.issues[0];
  Object.assign(issue, {
    revision: "original", description: "", acceptance: "", parent_id: null,
    points: 0, sprint: "", minor: false, due_date: null, defer_until: null,
  });
  let failReads = false;
  app.network.handler = async (path, options) => {
    if (options.method !== "GET") {
      failReads = true;
      return success({ issue });
    }
    if (path === `/v1/issues/${issue.id}`) return failReads ? readFailure() : success({
      issue, dependencies: [], blocked_by: [], comments: [], logs: [],
    });
  };
  await click(app.listeners, "task", { id: issue.id });
  return { ...app, drawer, issue };
}

async function editTask(t, app) {
  await click(app.listeners, "edit-task");
  const query = app.drawer.querySelector;
  const values = {
    title: "Updated task title", description: "", acceptance: "", type: "task",
    priority: "P2", labels: "", parent_id: "", points: "0", sprint: "",
    due_date: "", defer_until: "",
  };
  const button = element();
  const error = query("#editor-error");
  const form = {
    id: "issue-form", values, elements: { minor: { checked: false } },
    get isConnected() { return app.drawer.innerHTML.includes('id="issue-form"'); },
    querySelector: (selector) => selector === ".form-error" ? error : button,
    querySelectorAll: () => [error],
  };
  app.drawer.querySelector = (selector) => selector === "#issue-form"
    ? (form.isConnected ? form : null)
    : selector === "form[inert]" ? (form.isConnected && form.inert ? form : null) : query(selector);
  t.mock.method(globalThis, "FormData", function (form) { return new Map(Object.entries(form.values)); });
  return form;
}

for (const kind of ["issue", "comment", "dependency"]) {
  test(`pending ${kind} saves retain the panel across navigation and live refresh`, async (t) => {
    const app = await workspace(t);
    const entered = Promise.withResolvers();
    const response = Promise.withResolvers();
    const handle = app.network.handler;
    app.network.handler = async (path, options) => {
      if (options.method !== "GET") {
        entered.resolve();
        return response.promise;
      }
      return handle(path, options);
    };
    let form;
    if (kind === "issue") form = await editTask(t, app);
    else {
      const field = kind === "comment" ? "comment" : "depends_on";
      const button = element();
      form = {
        id: `${kind}-form`, isConnected: true,
        elements: { [field]: { value: kind === "comment" ? "Review note" : "td-second" } },
        querySelector: (selector) => selector === ".form-error" ? null : button,
        querySelectorAll: () => [],
      };
      const query = app.drawer.querySelector;
      app.drawer.querySelector = (selector) => selector === "form[inert]"
        ? (form.inert ? form : null) : query(selector);
    }
    const saving = app.listeners.get("submit")({ target: form, preventDefault() {} });
    await entered.promise;
    const original = app.drawer.innerHTML;
    app.dialogs.confirm = true;
    await click(app.listeners, "view", { view: "list" });
    await click(app.listeners, "new-board");
    await click(app.listeners, "refresh");
    const unload = new Event("beforeunload", { cancelable: true });
    app.windowListeners.get("beforeunload")(unload);
    const preserved = app.drawer.innerHTML === original && !app.drawer.hidden && !app.node("#modal").open;
    // Release the write even if an assertion fails.
    response.resolve({ ok: false, status: 503, json: async () => ({ ok: false, error: { message: "Save unavailable" } }) });
    await saving;
    assert.equal(preserved, true, "navigation and refresh must not replace the saving form");
    assert.equal(unload.defaultPrevented, true);
    assert.equal(form.inert, false);
    assert.equal(location.hash, "#board?issue=td-first");
    assert.equal(app.requests.filter((r) => r.method !== "GET").length, 1);
    await click(app.listeners, "view", { view: "list" });
    assert.equal(app.drawer.hidden, true, "a finished request releases navigation");
  });
}

test("a saved task reports success and offers a retry when detail reload fails", async (t) => {
  const app = await workspace(t);
  const form = await editTask(t, app);
  await app.listeners.get("submit")({ target: form, preventDefault() {} });
  assert.equal(app.requests.filter((r) => r.method === "PATCH").length, 1);
  assert.equal(app.node("#toast").textContent, "Task updated");
  assert.equal(app.drawer.querySelector("#detail-error").hidden, false);
  assert.match(app.drawer.innerHTML, /Detail reload unavailable/);
  assert.match(app.drawer.innerHTML, /Retry loading task/);
  app.network.handler = async (path) => path === `/v1/issues/${app.issue.id}` ? success({
    issue: { ...app.issue, title: form.values.title }, dependencies: [], blocked_by: [], comments: [], logs: [],
  }) : undefined;
  await click(app.listeners, "task", { id: app.issue.id });
  assert.match(app.drawer.innerHTML, /<h2 class="task-heading">Updated task title<\/h2>/);
  assert.equal(app.requests.filter((r) => r.method === "PATCH").length, 1, "retry only reloads the task");
});

test("a rejected conditional save keeps the draft and opens the conflict comparison", async (t) => {
  const app = await workspace(t);
  const form = await editTask(t, app);
  const handle = app.network.handler;
  app.network.handler = async (path, options) => {
    if (options.method === "PATCH") return {
      ok: false, status: 409,
      json: async () => ({ ok: false, error: { message: "Task changed" } }),
    };
    if (path === `/v1/issues/${app.issue.id}`) return success({
      issue: { ...app.issue, revision: "current", title: "Another writer's title" },
    });
    return handle(path, options);
  };
  await app.listeners.get("submit")({ target: form, preventDefault() {} });
  assert.equal(app.node("#modal").open, true);
  assert.match(app.node("#modal").innerHTML, /This task changed/);
  assert.match(app.node("#modal").innerHTML, /Another writer&#39;s title/);
  assert.match(app.node("#modal").innerHTML, /Updated task title/);
  assert.equal(form.inert, false);
  assert.equal(form.isConnected, true);
  assert.equal(form.values.title, "Updated task title");
  assert.equal(app.node("#toast").textContent, "");
});

test("a confirmed transition closes its dialog even when detail reload fails", async (t) => {
  const { listeners, node, drawer, requests } = await workspace(t);
  await click(listeners, "transition", { transition: "block" });
  const modal = node("#modal");
  const button = element();
  const localError = element();
  const form = {
    id: "modal-form", isConnected: true,
    elements: { reason: { value: "Blocked by another task" } },
    querySelector: (selector) => selector === ".form-error" ? localError : button,
    querySelectorAll: () => [],
  };
  modal.querySelector = (selector) => selector === ".form-error" ? localError : form;
  await listeners.get("submit")({ target: form, preventDefault() {} });
  assert.equal(requests.filter((r) => r.path.endsWith("/block")).length, 1);
  assert.equal(modal.open, false, "the committed action must not remain available for resubmission");
  assert.equal(drawer.querySelector("#detail-error").textContent, "Detail reload unavailable");
  assert.equal(drawer.querySelector("#detail-error").hidden, false);
  assert.equal(node("#toast").textContent, "Block task");
});

for (const [formID, field, value, endpoint, message] of [
  ["comment-form", "comment", "Review note", "comments", "Comment added"],
  ["dependency-form", "depends_on", "td-second", "dependencies", "Dependency added"],
]) {
  test(`a confirmed ${formID} write reports success when detail reload fails`, async (t) => {
    const { listeners, node, drawer, requests } = await workspace(t);
    const button = element();
    const form = {
      id: formID, isConnected: true,
      elements: { [field]: { value } },
      querySelector: (selector) => selector === ".form-error" ? null : button,
      querySelectorAll: () => [],
      reset() { this.elements[field].value = ""; },
    };
    await listeners.get("submit")({ target: form, preventDefault() {} });
    assert.equal(requests.filter((r) => r.path.endsWith(`/${endpoint}`)).length, 1);
    assert.equal(node("#toast").textContent, message);
    assert.equal(form.elements[field].value, "");
    assert.equal(drawer.querySelector("#detail-error").textContent, "Detail reload unavailable");
  });
}

for (const moveFocus of [false, true]) {
  test(`failed submission restores keyboard focus unless it moved elsewhere (${moveFocus})`, async (t) => {
    const app = await workspace(t);
    const input = app.drawer.querySelector('[name="depends_on"]');
    input.value = "td-missing";
    input.focus();
    const button = element();
    let inert = false;
    const form = {
      id: "dependency-form", isConnected: true,
      elements: { depends_on: input },
      contains: (control) => control === input || control === button,
      querySelector: (selector) => selector === ".form-error" ? null : button,
      querySelectorAll: () => [],
      get inert() { return inert; },
      set inert(value) {
        inert = value;
        if (value && this.contains(document.activeElement)) document.activeElement = document.body;
      },
    };
    input.form = form;
    const other = app.node("#search");
    app.network.handler = async () => {
      if (moveFocus) other.focus();
      return { ok: false, status: 404, json: async () => ({ ok: false, error: { message: "Dependency not found" } }) };
    };
    await app.listeners.get("submit")({ target: form, preventDefault() {} });
    assert.equal(document.activeElement, moveFocus ? other : input);
    assert.equal(input.value, "td-missing");
    assert.equal(form.inert, false);
    assert.equal(app.drawer.querySelector("#detail-error").textContent, "Dependency not found");
  });
}
