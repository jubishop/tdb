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
