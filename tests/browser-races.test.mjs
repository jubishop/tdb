import assert from "node:assert/strict";
import test from "node:test";
import { browser, element } from "./helpers/browser.mjs";

function click(listeners, action) {
  const target = { dataset: { action } };
  return listeners.get("click")({
    target: { closest: () => target },
    preventDefault() {},
  });
}

test("a refresh started before a drag cannot replace the dragged cards", async (t) => {
  const { node, listeners, network, issues } = await browser(t);
  const entered = Promise.withResolvers();
  const response = Promise.withResolvers();
  network.handler = async (path) => {
    if (!path.startsWith("/v1/boards/bd-test?")) return;
    entered.resolve();
    return response.promise;
  };
  const refresh = click(listeners, "refresh");
  await entered.promise;
  const before = node("#content").innerHTML;
  const card = element();
  card.dataset.id = "td-last";
  listeners.get("dragstart")({
    target: { closest: () => card },
    dataTransfer: { setData() {} },
  });
  issues[0].title = "Updated while dragging";
  response.resolve({
    ok: true,
    json: async () => ({ ok: true, data: { issues: issues.map((issue) => ({ issue })) } }),
  });
  await refresh;
  assert.equal(node("#content").innerHTML, before);

  network.handler = null;
  listeners.get("dragend")();
  await new Promise(setImmediate);
  assert.match(node("#content").innerHTML, /Updated while dragging/);
});

test("Escape cannot dismiss a dialog while its save is pending", async (t) => {
  const { node, listeners, network } = await browser(t);
  const entered = Promise.withResolvers();
  const response = Promise.withResolvers();
  network.handler = async (path, options) => {
    if (path !== "/v1/boards" || options.method !== "POST") return;
    entered.resolve();
    return response.promise;
  };
  await click(listeners, "new-board");
  const modal = node("#modal");
  const button = element();
  const form = {
    id: "modal-form",
    elements: { name: { value: "New board" }, query: { value: "" } },
    querySelector: () => button,
    querySelectorAll: () => [],
  };
  modal.querySelector = () => form;
  const save = listeners.get("submit")({ target: form, preventDefault() {} });
  await entered.promise;
  assert.equal(form.inert, true);
  const cancel = new Event("cancel", { cancelable: true });
  modal.listeners.get("cancel")?.(cancel);
  if (!cancel.defaultPrevented) modal.close();
  // Release the request even if the assertions fail, so tests leave no work pending.
  response.resolve({ ok: true, json: async () => ({ ok: true, data: { board: { id: "bd-test" } } }) });
  const stayedOpen = modal.open;
  await save;
  assert.equal(stayedOpen, true);
  assert.equal(modal.open, false);
  assert.equal(form.inert, false);

  await click(listeners, "new-board");
  const idleCancel = new Event("cancel", { cancelable: true });
  modal.listeners.get("cancel")?.(idleCancel);
  assert.equal(idleCancel.defaultPrevented, false);
});

test("a pending board replacement cannot redirect a drag to another board", async (t) => {
  const { listeners, network, requests } = await browser(t);
  const entered = Promise.withResolvers();
  const response = Promise.withResolvers();
  network.handler = async (path) => {
    if (path === "/v1/boards")
      return { ok: true, json: async () => ({ ok: true, data: { boards: [{ id: "bd-new", name: "Replacement", is_builtin: true }] } }) };
    if (path.startsWith("/v1/boards/bd-new?")) {
      entered.resolve();
      return response.promise;
    }
    if (path.endsWith("/move"))
      return { ok: true, json: async () => ({ ok: true, data: {} }) };
  };
  const refresh = click(listeners, "refresh");
  await entered.promise;
  const card = element();
  card.dataset.id = "td-last";
  listeners.get("dragstart")({
    target: { closest: () => card },
    dataTransfer: { setData() {} },
  });
  const column = element();
  column.dataset.status = "open";
  response.resolve({ ok: true, json: async () => ({ ok: true, data: { issues: [] } }) });
  const drop = listeners.get("drop")({
    target: { closest: (selector) => selector === ".column" ? column : null },
    preventDefault() {},
  });
  await Promise.all([refresh, drop]);
  assert.equal(requests.findLast((r) => r.path.endsWith("/move")).path, "/v1/boards/bd-test/move");
});
