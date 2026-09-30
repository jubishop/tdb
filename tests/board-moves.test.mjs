import assert from "node:assert/strict";
import test from "node:test";

function element() {
  const classes = new Set();
  return {
    dataset: {},
    textContent: "",
    hidden: true,
    elements: { include_closed: {} },
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    },
    addEventListener() {},
    contains: () => false,
    querySelector: () => null,
  };
}

// Run the real application and API client with browser and HTTP boundaries faked.
for (const includeClosed of [false, true]) {
  test(`board drag uses the displayed closed filter (${includeClosed})`, async (t) => {
    const nodes = new Map();
    const listeners = new Map();
    const requests = [];
    const ready = Promise.withResolvers();
    const board = { id: "bd-test", name: "Test board", is_builtin: true };
    const issues = ["first", "second", "third", "last"].map((name) => ({
      id: `td-${name}`,
      title: name,
      status: includeClosed ? "closed" : "open",
      priority: "P2",
      type: "task",
      labels: [],
    }));
    function node(selector) {
      if (!nodes.has(selector)) nodes.set(selector, element());
      return nodes.get(selector);
    }
    const globals = {
      document: {
        documentElement: element(),
        querySelector: node,
        querySelectorAll: () => [],
        addEventListener: (name, listener) => listeners.set(name, listener),
      },
      window: { addEventListener() {} },
      location: { hash: "#board" },
      localStorage: {
        getItem: () => JSON.stringify({ filters: { include_closed: includeClosed } }),
        setItem() {},
      },
      EventSource: class {
        constructor() { ready.resolve(); }
        addEventListener() {}
      },
      fetch: async (path, options) => {
        requests.push({ path, ...options });
        let data;
        if (path === "/v1/project") {
          data = { name: "Test", path: "/test" };
        } else if (path === "/v1/boards") {
          data = { boards: [board] };
        } else if (path === "/v1/monitor") {
          data = { monitor: {} };
        } else if (path === "/v1/sessions") {
          data = { sessions: [] };
        } else if (path.startsWith("/v1/issues?")) {
          data = { issues: [], has_more: false };
        } else if (path.startsWith("/v1/boards/bd-test?")) {
          data = { issues: issues.map((issue) => ({ issue })) };
        } else if (path === "/v1/boards/bd-test/move") {
          data = { positioned: true };
        } else {
          throw new Error(`Unexpected request: ${path}`);
        }
        return { ok: true, json: async () => ({ ok: true, data }) };
      },
    };
    for (const [key, value] of Object.entries(globals)) {
      const previous = Object.getOwnPropertyDescriptor(globalThis, key);
      Object.defineProperty(globalThis, key, { configurable: true, value });
      t.after(() => {
        if (previous) Object.defineProperty(globalThis, key, previous);
        else delete globalThis[key];
      });
    }
    const setTimer = globalThis.setTimeout;
    t.mock.method(globalThis, "setTimeout", (...args) => setTimer(...args).unref());
    await import(`../internal/web/assets/app.js?closed=${includeClosed}`);
    await ready.promise;
    assert.equal(node("#error-banner").hidden, true);
    assert.ok(requests.some((r) => r.path === `/v1/boards/bd-test?include_closed=${includeClosed}`));

    const source = element();
    source.dataset.id = "td-last";
    const target = element();
    target.dataset.id = "td-second";
    const column = element();
    column.dataset.status = issues[0].status;
    for (const [destination, after, beforeID] of [
      [target, false, "td-second"],
      [target, true, "td-third"],
      [null, false, ""],
    ]) {
      if (after) target.classList.add("drop-after");
      else target.classList.remove("drop-after");
      listeners.get("dragstart")({
        target: { closest: () => source },
        dataTransfer: { setData() {} },
      });
      await listeners.get("drop")({
        target: { closest: (selector) => selector === ".column" ? column : destination },
        preventDefault() {},
      });
      const request = requests.findLast((r) => r.path.endsWith("/move"));
      assert.equal(request.method, "POST");
      assert.deepEqual(JSON.parse(request.body), {
        issue_id: "td-last",
        before_id: beforeID,
        include_closed: includeClosed,
      });
      assert.equal(node("#error-banner").hidden, true);
    }
  });
}
