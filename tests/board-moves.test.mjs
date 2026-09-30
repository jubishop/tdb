import assert from "node:assert/strict";
import test from "node:test";

import { browser, element } from "./helpers/browser.mjs";

// Run the real application and API client with browser and HTTP boundaries faked.
for (const includeClosed of [false, true]) {
  test(`board drag uses the displayed closed filter (${includeClosed})`, async (t) => {
    const { node, listeners, requests, issues } = await browser(t, { includeClosed });
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

for (const remainsOnBoard of [false, true]) {
  test(`status-changing drag handles board membership (${remainsOnBoard})`, async (t) => {
    const app = await browser(t);
    let transitioned = false;
    app.network.handler = async (path, options) => {
      if (path === "/v1/issues/td-last/start") {
        transitioned = true;
        app.issues.at(-1).status = "in_progress";
        return { ok: true, json: async () => ({ ok: true, data: { issue: app.issues.at(-1) } }) };
      }
      if (path.startsWith("/v1/boards/bd-test?")) return {
        ok: true, json: async () => ({ ok: true, data: {
          issues: app.issues.filter((issue) => !transitioned || remainsOnBoard || issue.id !== "td-last").map((issue) => ({ issue })),
        } }),
      };
      if (path.endsWith("/move") && !remainsOnBoard) return {
        ok: false, status: 409,
        json: async () => ({ ok: false, error: { message: "The task is no longer on this board." } }),
      };
    };
    const source = element();
    source.dataset.id = "td-last";
    const column = element();
    column.dataset.status = "in_progress";
    app.listeners.get("dragstart")({ target: { closest: () => source }, dataTransfer: { setData() {} } });
    await app.listeners.get("drop")({ target: { closest: (selector) => selector === ".column" ? column : null }, preventDefault() {} });
    assert.equal(transitioned, true);
    assert.equal(app.requests.filter((request) => request.path.endsWith("/move")).length, remainsOnBoard ? 1 : 0);
    assert.equal(app.node("#error-banner").hidden, true);
    assert.match(app.node("#toast").textContent, remainsOnBoard ? /Board updated/ : /no longer matches/i);
  });
}

for (const failure of ["transition", "reorder"]) {
  test(`a ${failure} failure reports whether the status changed`, async (t) => {
    const app = await browser(t);
    app.network.handler = async (path) => {
      if (path === "/v1/issues/td-last/start" && failure !== "transition") {
        app.issues.at(-1).status = "in_progress";
        return { ok: true, json: async () => ({ ok: true, data: {} }) };
      }
      if (path === "/v1/issues/td-last/start" || path.endsWith("/move")) return {
        ok: false, status: 409,
        json: async () => ({ ok: false, error: { message: "Changed by another session. Refresh and try again." } }),
      };
    };
    const source = element();
    source.dataset.id = "td-last";
    const column = element();
    column.dataset.status = "in_progress";
    app.listeners.get("dragstart")({ target: { closest: () => source }, dataTransfer: { setData() {} } });
    await app.listeners.get("drop")({ target: { closest: (selector) => selector === ".column" ? column : null }, preventDefault() {} });
    const error = app.node("#error-banner");
    assert.equal(error.hidden, false);
    assert.match(error.textContent, /Changed by another session/);
    assert.equal(error.textContent.includes("Task status changed"), failure === "reorder");
    assert.equal(app.issues.at(-1).status, failure === "reorder" ? "in_progress" : "open");
    assert.equal(app.requests.filter((request) => request.path.endsWith("/move")).length, failure === "reorder" ? 1 : 0);
  });
}
