import assert from "node:assert/strict";
import test from "node:test";
import { browser, element } from "./helpers/browser.mjs";

// Model the DOM boundary: replacing markup detaches controls and drops focus.
function focusContainer(root) {
  let markup = root.innerHTML || "";
  let controls = [];
  const parse = () => {
    controls = [...markup.matchAll(/<(button|input|textarea|div)\b([^>]*)>/g)].map((match) => {
      const attributes = Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map((entry) => [entry[1], entry[2]]));
      const control = {
        ...element(),
        tagName: match[1].toUpperCase(),
        id: attributes.id || "",
        value: "",
        isConnected: true,
        attributes,
        dataset: Object.fromEntries(Object.entries(attributes).filter(([key]) => key.startsWith("data-")).map(([key, value]) => [key.slice(5), value])),
        getAttribute: (key) => attributes[key] ?? null,
        focus() { document.activeElement = this; },
      };
      return control;
    });
  };
  parse();
  root.contains = (node) => controls.includes(node);
  root.focus = () => { document.activeElement = root; };
  root.querySelector = (selector) => controls.find((control) => {
    if (selector.startsWith("#")) return control.id === selector.slice(1);
    if (selector.startsWith(".")) return control.attributes.class?.split(" ").includes(selector.slice(1));
    const tag = selector.match(/^[a-z]+/i)?.[0];
    const attributes = [...selector.matchAll(/\[([\w-]+)="([^"]*)"\]/g)];
    return (!tag || control.tagName.toLowerCase() === tag) && attributes.length &&
      attributes.every(([, key, value]) => control.getAttribute(key) === value);
  });
  Object.defineProperty(root, "innerHTML", {
    get: () => markup,
    set(value) {
      if (root.contains(document.activeElement)) document.activeElement = document.body;
      for (const control of controls) control.isConnected = false;
      markup = value;
      parse();
    },
  });
  return root;
}

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
    const root = focusContainer(node(container));
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
  const root = focusContainer(node("#content"));
  root.querySelector('[data-action="task"][data-id="td-first"]').focus();
  issues.shift();
  await click(listeners, "refresh");
  assert.equal(document.activeElement, root);
});
