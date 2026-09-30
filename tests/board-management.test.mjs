import assert from "node:assert/strict";
import test from "node:test";
import { browser, element } from "./helpers/browser.mjs";
import { domContainer } from "./helpers/dom.mjs";

function click(listeners, target) {
  return listeners.get("click")({ target: { closest: () => target }, preventDefault() {} });
}

test("Edit board targets the visible board while another board loads", async (t) => {
  const boards = [
    { id: "bd-test", name: "Original board" },
    { id: "bd-other", name: "Other board" },
  ];
  const app = await browser(t, { networkHandler: async (path) => path === "/v1/boards" ? {
    ok: true, json: async () => ({ ok: true, data: { boards } }),
  } : undefined });
  const content = domContainer(app.node("#content"));
  const entered = Promise.withResolvers();
  const response = Promise.withResolvers();
  const handle = app.network.handler;
  app.network.handler = async (path) => {
    if (path.startsWith("/v1/boards/bd-other?")) {
      entered.resolve();
      return response.promise;
    }
    return handle(path);
  };
  const navigation = click(app.listeners, { dataset: { action: "board", id: "bd-other" } });
  await entered.promise;
  await click(app.listeners, content.querySelector('[data-action="edit-board"]'));
  const markup = app.node("#modal").innerHTML;
  response.resolve({ ok: true, json: async () => ({ ok: true, data: { issues: [] } }) });
  await navigation;
  assert.match(markup, /value="Original board"/);
  assert.doesNotMatch(markup, /value="Other board"/);
});

test("Delete board keeps the dialog target when a refresh changes the selected board", async (t) => {
  const boards = [{ id: "bd-test", name: "Original board" }];
  const app = await browser(t, { networkHandler: async (path, options) => {
    if (path === "/v1/boards") return { ok: true, json: async () => ({ ok: true, data: { boards } }) };
    if (path === "/v1/boards/bd-other?include_closed=false")
      return { ok: true, json: async () => ({ ok: true, data: { issues: [] } }) };
    if (options.method === "DELETE") return { ok: true, json: async () => ({ ok: true, data: {} }) };
  } });
  const content = domContainer(app.node("#content"));
  const modal = domContainer(app.node("#modal"));
  await click(app.listeners, content.querySelector('[data-action="edit-board"]'));
  boards.splice(0, 1, { id: "bd-other", name: "Replacement board" });
  await click(app.listeners, { dataset: { action: "refresh" } });
  await click(app.listeners, modal.querySelector('[data-action="delete-board"]'));
  // A disappeared board must not turn into a deletion of its replacement.
  assert.doesNotMatch(modal.innerHTML, /Delete <strong>Replacement board/);
  assert.equal(app.requests.filter((request) => request.method === "DELETE").length, 0);
  const error = modal.querySelector("#modal-error");
  assert.equal(error.hidden, false);
  assert.match(error.textContent, /no longer available/i);
});

for (const [draft, editing, view] of [
  ["comment", false, "list"],
  ["depends_on", true, "board"],
  ["existing task", true, "board"],
  ["new task", false, "list"],
]) {
  test(`saving a board preserves the ${draft} draft from ${view}`, async (t) => {
    const success = (data) => ({ ok: true, json: async () => ({ ok: true, data }) });
    const boards = [{ id: "bd-test", name: "Original board" }];
    const app = await browser(t, { hash: `#${view}`, networkHandler: async (path) =>
      path === "/v1/boards" ? success({ boards }) : undefined });
    const drawer = domContainer(app.node("#drawer"));
    const issue = app.issues[0];
    let saved = false;
    app.network.handler = async (path, options) => {
      if (path === "/v1/boards" || path === "/v1/boards/bd-test") {
        if (options.method !== "GET") {
          saved = true;
          boards[0] = { id: "bd-test", ...JSON.parse(options.body) };
          return success({ board: boards[0] });
        }
        return success({ boards });
      }
      if (path.startsWith("/v1/boards/bd-test?") && saved) return success({ issues: [] });
      if (path === `/v1/issues/${issue.id}`) return success({
        issue, dependencies: [], blocked_by: [], comments: [], logs: [],
      });
    };
    if (draft === "new task") await click(app.listeners, { dataset: { action: "new-task" } });
    else await click(app.listeners, { dataset: { action: "task", id: issue.id } });
    if (draft === "existing task") await click(app.listeners, { dataset: { action: "edit-task" } });
    let input;
    if (draft.endsWith("task")) {
      input = drawer.querySelector('[name="title"]');
      input.value = "Keep my unfinished task title";
      const form = { elements: { minor: { checked: false } } };
      const query = drawer.querySelector;
      drawer.querySelector = (selector) => selector === "#issue-form" ? form : query(selector);
      t.mock.method(globalThis, "FormData", function () { return new Map([["title", input.value]]); });
    } else {
      input = drawer.querySelector(`[name="${draft}"]`);
      input.value = draft === "comment" ? "Keep my review notes" : "td-second";
    }
    const originalValue = input.value;
    // Hash assignment emits navigation; history replacement does not.
    let hash = location.hash;
    let hashChanged = false;
    Object.defineProperty(location, "hash", {
      get: () => hash,
      set(value) {
        const next = value.startsWith("#") ? value : `#${value}`;
        hashChanged ||= next !== hash;
        hash = next;
      },
    });
    t.mock.method(history, "replaceState", (_state, _title, url) => { hash = url; });
    const confirm = t.mock.method(globalThis, "confirm", () => true);
    await click(app.listeners, { dataset: { action: editing ? "edit-board" : "new-board", id: "bd-test" } });
    const modal = app.node("#modal");
    const button = element();
    const form = {
      id: "modal-form",
      elements: { name: { value: "Saved board" }, query: { value: "type = bug" } },
      querySelector: () => button, querySelectorAll: () => [],
    };
    modal.querySelector = () => form;
    await app.listeners.get("submit")({ target: form, preventDefault() {} });
    if (hashChanged) await app.windowListeners.get("hashchange")();
    assert.equal(confirm.mock.callCount(), 0, "saving the board must not offer to discard the task draft");
    assert.equal(drawer.hidden, false);
    assert.equal(input.isConnected, true);
    assert.equal(input.value, originalValue);
    assert.equal(location.hash, draft === "new task" ? "#board" : `#board?issue=${issue.id}`);
    assert.equal(app.node("#view-title").textContent, "Saved board");
    assert.equal(modal.open, false);
    assert.equal(app.requests.filter((request) => request.method !== "GET").length, 1);
  });
}
