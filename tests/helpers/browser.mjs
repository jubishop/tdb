export function element() {
  const classes = new Set();
  return {
    dataset: {},
    textContent: "",
    hidden: true,
    open: false,
    showModal() { this.open = true; },
    close() { this.open = false; },
    focus() { document.activeElement = this; },
    scrollIntoView() {},
    elements: { include_closed: {} },
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle(name, force) {
        if (force ?? !classes.has(name)) classes.add(name);
        else classes.delete(name);
      },
    },
    listeners: new Map(),
    addEventListener(name, listener) { this.listeners.set(name, listener); },
    contains: () => false,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

let sequence = 0;

// Run the application with only browser and HTTP boundaries faked.
export async function browser(t, { includeClosed = false, hash = "#board", networkHandler } = {}) {
  const network = { handler: networkHandler };
  const nodes = new Map();
  const listeners = new Map();
  const windowListeners = new Map();
  const dialogs = { confirm: false };
  const requests = [];
  const streams = [];
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
      body: element(),
      documentElement: element(),
      querySelector: (selector) => selector === "#drawer:not([hidden]) #detail-error"
        ? (node("#drawer").hidden ? null : node("#drawer").querySelector("#detail-error"))
        : node(selector),
      querySelectorAll: () => [],
      addEventListener: (name, listener) => listeners.set(name, listener),
    },
    window: { addEventListener: (name, listener) => windowListeners.set(name, listener) },
    history: {
      replaceState(_state, _title, url) { location.hash = url; },
      pushState(_state, _title, url) { location.hash = url; },
    },
    confirm: () => dialogs.confirm,
    CSS: { escape: (value) => value },
    location: { hash },
    localStorage: {
      getItem: () => JSON.stringify({ filters: { include_closed: includeClosed } }),
      setItem() {},
    },
    EventSource: class {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;
      readyState = 0;
      listeners = new Map();
      constructor() { streams.push(this); }
      addEventListener(name, listener) { this.listeners.set(name, listener); }
    },
    fetch: async (path, options) => {
      requests.push({ path, ...options });
      let data;
      const intercepted = await network.handler?.(path, options);
      if (intercepted) return intercepted;
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
  t.mock.method(globalThis, "setTimeout", (...args) => {
    const timer = setTimer(...args);
    timer.unref?.();
    return timer;
  });
  await import(`../../internal/web/assets/app.js?test=${sequence++}`);
  await new Promise(setImmediate);
  return { node, listeners, windowListeners, dialogs, requests, issues, network, streams };
}
