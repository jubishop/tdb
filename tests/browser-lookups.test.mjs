import assert from "node:assert/strict";
import test from "node:test";
import { browser, element } from "./helpers/browser.mjs";

for (const obsolete of ["closed", "changed", "current"]) {
  test(`task lookup errors only appear for the current input (${obsolete})`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const app = await browser(t);
    const response = Promise.withResolvers();
    app.network.handler = (path) => path.includes("search=old") ? response.promise : undefined;
    const input = { ...element(), dataset: { issueSearch: "dependency-options" }, value: "old", isConnected: true };
    app.listeners.get("input")({ target: input });
    t.mock.timers.tick(200);
    await new Promise(setImmediate);
    if (obsolete === "closed") input.isConnected = false;
    if (obsolete === "changed") input.value = "new";
    response.resolve({ ok: false, status: 503, json: async () => ({ ok: false, error: { message: "Lookup unavailable" } }) });
    await new Promise(setImmediate);
    assert.equal(app.node("#error-banner").hidden, obsolete !== "current");
    if (obsolete === "current") assert.equal(app.node("#error-banner").textContent, "Lookup unavailable");
  });
}

test("closing a lookup field before its debounce finishes skips the request", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const app = await browser(t);
  const input = { ...element(), dataset: { issueSearch: "parent-options" }, value: "obsolete", isConnected: true };
  app.listeners.get("input")({ target: input });
  input.isConnected = false;
  t.mock.timers.tick(200);
  await new Promise(setImmediate);
  assert.equal(app.requests.some((request) => request.path.includes("search=obsolete")), false);
});
