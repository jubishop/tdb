import assert from "node:assert/strict";
import test from "node:test";
import { browser } from "./helpers/browser.mjs";
import { domContainer } from "./helpers/dom.mjs";

test("creating a task waits for project metadata and works after startup recovers", async (t) => {
  const response = Promise.withResolvers();
  const app = await browser(t, {
    networkHandler: (path) => path === "/v1/project" ? response.promise : undefined,
  });
  const drawer = domContainer(app.node("#drawer"));
  const target = { dataset: { action: "new-task" } };
  await app.listeners.get("click")({ target: { closest: () => target }, preventDefault() {} });
  const message = app.node("#error-banner").textContent;
  const stayedClosed = drawer.hidden;
  response.resolve({ ok: true, json: async () => ({ ok: true, data: {
    name: "Test", path: "/test", title_min_length: 15, title_max_length: 200,
  } }) });
  await new Promise(setImmediate);
  assert.match(message, /still connecting/i);
  assert.equal(stayedClosed, true);
  await app.listeners.get("click")({ target: { closest: () => target }, preventDefault() {} });
  assert.equal(drawer.hidden, false);
  assert.match(drawer.innerHTML, /Create a task/);
  assert.equal(document.activeElement, drawer.querySelector('[name="title"]'));
});

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
