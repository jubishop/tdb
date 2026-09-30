import assert from "node:assert/strict";
import test from "node:test";
import { browser, element } from "./helpers/browser.mjs";
import { domContainer } from "./helpers/dom.mjs";

function click(listeners, action, extra = {}) {
  const target = { dataset: { action, ...extra } };
  return listeners.get("click")({ target: { closest: () => target }, preventDefault() {} });
}

async function draftDialog(t) {
  const app = await browser(t);
  await click(app.listeners, "new-board");
  const modal = app.node("#modal");
  assert.match(modal.innerHTML, /name="query"/);
  const query = { tagName: "TEXTAREA", value: "priority <= P1", defaultValue: "" };
  modal.querySelectorAll = () => [query];
  return { ...app, modal, query };
}

for (const dismiss of ["Cancel", "Escape"]) {
  test(`${dismiss} preserves changed dialog fields until discard is confirmed`, async (t) => {
    const { modal, listeners, dialogs, query } = await draftDialog(t);
    async function close() {
      if (dismiss === "Cancel") await click(listeners, "close-modal");
      else {
        const event = new Event("cancel", { cancelable: true });
        modal.listeners.get("cancel")(event);
        if (!event.defaultPrevented) modal.close();
      }
    }
    await close();
    assert.equal(modal.open, true);
    assert.equal(query.value, "priority <= P1");
    dialogs.confirm = true;
    await close();
    assert.equal(modal.open, false);
  });
}

test("page navigation protects dialog drafts and accepted navigation dismisses the dialog", async (t) => {
  const { modal, windowListeners, dialogs, node } = await draftDialog(t);
  const unload = new Event("beforeunload", { cancelable: true });
  windowListeners.get("beforeunload")(unload);
  assert.equal(unload.defaultPrevented, true);
  location.hash = "#list";
  await windowListeners.get("hashchange")();
  assert.equal(location.hash, "#board");
  assert.equal(modal.open, true);
  dialogs.confirm = true;
  location.hash = "#list";
  await windowListeners.get("hashchange")();
  assert.equal(modal.open, false);
  assert.equal(node("#breadcrumb-view").textContent, "List");
});

test("unchanged and restored dialog fields close without confirmation", async (t) => {
  const { modal, listeners, query } = await draftDialog(t);
  query.value = query.defaultValue;
  const confirm = t.mock.method(globalThis, "confirm", () => { throw new Error("Unexpected discard prompt"); });
  await click(listeners, "close-modal");
  assert.equal(modal.open, false);
  assert.equal(confirm.mock.callCount(), 0);
});

test("a pending dialog save also blocks browser history navigation", async (t) => {
  const { modal, windowListeners } = await draftDialog(t);
  modal.querySelector = () => ({ inert: true });
  location.hash = "#list";
  await windowListeners.get("hashchange")();
  assert.equal(location.hash, "#board");
  assert.equal(modal.open, true);
});

test("a pending dialog action warns before reload even without changed fields", async (t) => {
  const { modal, windowListeners, query } = await draftDialog(t);
  query.value = query.defaultValue;
  const form = { inert: true };
  modal.querySelector = () => form;
  const pending = new Event("beforeunload", { cancelable: true });
  windowListeners.get("beforeunload")(pending);
  assert.equal(pending.defaultPrevented, true);
  form.inert = false;
  const idle = new Event("beforeunload", { cancelable: true });
  windowListeners.get("beforeunload")(idle);
  assert.equal(idle.defaultPrevented, false);
});

test("review attribution changes count as drafts, including implicit default selections", async (t) => {
  const { modal, windowListeners, query } = await draftDialog(t);
  query.value = query.defaultValue;
  const selection = {
    tagName: "SELECT", value: "independent",
    options: [{ value: "independent", defaultSelected: false }, { value: "self", defaultSelected: false }],
  };
  modal.querySelectorAll = () => [selection];
  const unchanged = new Event("beforeunload", { cancelable: true });
  windowListeners.get("beforeunload")(unchanged);
  assert.equal(unchanged.defaultPrevented, false);
  selection.value = "self";
  const changed = new Event("beforeunload", { cancelable: true });
  windowListeners.get("beforeunload")(changed);
  assert.equal(changed.defaultPrevented, true);
});

test("confirmed task deletion closes its drawer and dialog without another discard prompt", async (t) => {
  const { node, listeners, network, issues } = await browser(t);
  const drawer = domContainer(node("#drawer"));
  network.handler = async (path, options) => path === "/v1/issues/td-first" ? {
    ok: true, json: async () => ({ ok: true, data: options.method === "DELETE" ? {} : {
      issue: issues[0], dependencies: [], blocked_by: [], comments: [], logs: [],
    } }),
  } : undefined;
  await click(listeners, "task", { id: "td-first" });
  drawer.querySelector('[name="comment"]').value = "No longer needed";
  await click(listeners, "delete-task");
  const button = element();
  const form = { id: "modal-form", querySelector: () => button, querySelectorAll: () => [] };
  node("#modal").querySelector = () => form;
  t.mock.method(globalThis, "confirm", () => { throw new Error("Unexpected discard prompt"); });
  await listeners.get("submit")({ target: form, preventDefault() {} });
  assert.equal(drawer.hidden, true);
  assert.equal(node("#modal").open, false);
  assert.equal(node("#toast").textContent, "Task deleted");
});
