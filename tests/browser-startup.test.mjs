import assert from "node:assert/strict";
import test from "node:test";
import { browser } from "./helpers/browser.mjs";

for (const recovery of ["automatic retry", "Refresh button"]) {
  test(`project loading recovers through ${recovery} after an initial API failure`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let unavailable = true;
    const app = await browser(t, {
      networkHandler: async (path) => path === "/v1/project" && unavailable ? {
        ok: false, status: 502,
        json: async () => ({ ok: false, error: { message: "td API is unavailable" } }),
      } : undefined,
    });
    assert.equal(app.streams.length, 0);
    assert.equal(app.node("#error-banner").hidden, false);
    unavailable = false;
    if (recovery === "automatic retry") t.mock.timers.tick(2000);
    else {
      const target = { dataset: { action: "refresh" } };
      await app.listeners.get("click")({ target: { closest: () => target }, preventDefault() {} });
    }
    await new Promise(setImmediate);
    assert.equal(app.node("#project-name").textContent, "Test");
    assert.equal(app.node("#error-banner").hidden, true);
    assert.match(app.node("#content").innerHTML, /td-first/);
    assert.equal(app.streams.length, 1);
    t.mock.timers.tick(2000);
    await new Promise(setImmediate);
    assert.equal(app.streams.length, 1, "manual recovery cancels the scheduled startup retry");
  });
}
