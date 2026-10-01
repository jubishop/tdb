import assert from "node:assert/strict";
import test from "node:test";
import { browser, element } from "./helpers/browser.mjs";
import { domContainer } from "./helpers/dom.mjs";

function click(listeners, action, extra = {}) {
  const target = { dataset: { action, ...extra } };
  return listeners.get("click")({ target: { closest: () => target }, preventDefault() {} });
}

for (const [container, selector] of [
  ["#navigation", '[data-action="view"][data-view="reviews"]'],
  ["#boards", '[data-action="board"][data-id="bd-test"]'],
  ["#content", '[data-action="task"][data-id="td-first"]'],
  ["#drawer", '[name="comment"]'],
  ["#drawer", '[data-action="transition"][data-transition="start"]'],
]) {
  test(`refresh preserves focus on ${container} ${selector}`, async (t) => {
    const { node, listeners, network, issues } = await browser(t);
    document.body = element();
    document.activeElement = document.body;
    const root = domContainer(node(container));
    if (container === "#drawer") {
      network.handler = async (path) => path === "/v1/issues/td-first" ? {
        ok: true,
        json: async () => ({ ok: true, data: {
          issue: { ...issues[0], revision: "initial" },
          dependencies: [], blocked_by: [], comments: [], logs: [],
        } }),
      } : undefined;
      await click(listeners, "task", { id: "td-first" });
    }
    const original = root.querySelector(selector);
    assert.ok(original, "control is rendered");
    original.focus();
    await click(listeners, "refresh");
    assert.equal(node("#error-banner").hidden, true);
    assert.notEqual(root.querySelector(selector), original, "refresh rendered a new control");
    assert.equal(document.activeElement, root.querySelector(selector));
    if (selector === '[name="comment"]') {
      const draft = document.activeElement;
      draft.value = "An unsaved comment";
      await click(listeners, "refresh");
      assert.equal(document.activeElement, draft);
      assert.equal(draft.value, "An unsaved comment");
      assert.equal(draft.isConnected, true);
    }
  });
}

test("refresh keeps focus in the task region when the focused task disappears", async (t) => {
  const { node, listeners, issues } = await browser(t);
  document.body = element();
  document.activeElement = document.body;
  const root = domContainer(node("#content"));
  root.querySelector('[data-action="task"][data-id="td-first"]').focus();
  issues.shift();
  await click(listeners, "refresh");
  assert.equal(document.activeElement, root);
});

test("keyboard activation preserves navigation focus and ignores repeated pending actions", async (t) => {
  const { node, listeners, network, requests } = await browser(t);
  const root = domContainer(node("#navigation"));
  const selector = '[data-action="view"][data-view="activity"]';
  const target = root.querySelector(selector);
  target.focus();
  const entered = Promise.withResolvers();
  const response = Promise.withResolvers();
  network.handler = async (path) => {
    if (path === "/v1/boards") {
      entered.resolve();
      return response.promise;
    }
  };
  const activate = () => listeners.get("click")({ target: { closest: () => target }, preventDefault() {} });
  const pending = activate();
  await entered.promise;
  const count = requests.length;
  await activate();
  assert.equal(requests.length, count, "repeated activation must not start another refresh");
  response.resolve({ ok: true, json: async () => ({ ok: true, data: { boards: [] } }) });
  await pending;
  assert.equal(node("#breadcrumb-view").textContent, "Activity");
  assert.equal(document.activeElement, root.querySelector(selector));
});

for (const scenario of ["task action", "board action", "removed action", "closed drawer", "new focus"]) {
  test(`closing a dialog after live refresh restores the appropriate focus (${scenario})`, async (t) => {
    const app = await browser(t);
    document.activeElement = document.body;
    const root = domContainer(app.node(scenario === "board action" ? "#content" : "#drawer"));
    if (scenario !== "board action") {
      app.network.handler = async (path) => path === "/v1/issues/td-first" ? {
        ok: true, json: async () => ({ ok: true, data: {
          issue: app.issues[0], dependencies: [], blocked_by: [], comments: [], logs: [],
        } }),
      } : undefined;
      await click(app.listeners, "task", { id: "td-first" });
    }
    const selector = scenario === "board action"
      ? '[data-action="new-board"]'
      : '[data-action="transition"][data-transition="block"]';
    const opener = root.querySelector(selector);
    opener.focus();
    const modal = domContainer(app.node("#modal"));
    modal.showModal = () => {
      modal.open = true;
      modal.querySelector('[data-action="close-modal"]').focus();
    };
    modal.close = () => {
      modal.open = false;
      // A browser cannot return focus to an opener removed from the document.
      if (opener.isConnected) opener.focus();
      else document.activeElement = document.body;
    };
    await click(app.listeners, scenario === "board action" ? "new-board" : "transition", { transition: "block" });
    if (scenario === "removed action") app.issues[0].available_transitions = [];
    await click(app.listeners, "refresh");
    assert.equal(opener.isConnected, false);
    assert.equal(modal.open, true);
    assert.equal(document.activeElement, modal.querySelector('[data-action="close-modal"]'));
    if (scenario === "board action") {
      const cancel = new Event("cancel", { cancelable: true });
      modal.listeners.get("cancel")(cancel);
      if (!cancel.defaultPrevented) modal.close();
    } else await click(app.listeners, "close-modal");
    const other = app.node("#search");
    if (scenario === "closed drawer") {
      domContainer(app.node("#content"));
      await click(app.listeners, "view", { view: "list" });
    }
    if (scenario === "new focus") other.focus();
    modal.listeners.get("close")?.();
    assert.equal(document.activeElement, scenario === "new focus"
      ? other : scenario === "closed drawer" ? app.node("#content")
        : scenario === "removed action" ? root : root.querySelector(selector));
  });
}
