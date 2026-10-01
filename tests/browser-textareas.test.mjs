import assert from "node:assert/strict";
import test from "node:test";
import { browser } from "./helpers/browser.mjs";
import { domContainer } from "./helpers/dom.mjs";

const success = (data) => ({ ok: true, json: async () => ({ ok: true, data }) });
function click(app, action, extra = {}) {
  const target = { dataset: { action, ...extra } };
  return app.listeners.get("click")({ target: { closest: () => target }, preventDefault() {} });
}

test("opening task editors preserves empty text, leading blank lines, and escaped Markdown", async (t) => {
  const app = await browser(t);
  const drawer = domContainer(app.node("#drawer"));
  const issue = app.issues[0];
  app.network.handler = async (path) => {
    if (path === `/v1/issues/${issue.id}`) return success({
      issue, dependencies: [], blocked_by: [], comments: [], logs: [],
    });
    if (path === "/v1/markdown") return success({ html: "<p>Rendered Markdown</p>" });
  };
  for (const text of ["", "Plain text", "\nFirst paragraph", "\n\n<example> & </textarea>\nLast line"]) {
    issue.description = text;
    issue.acceptance = text;
    await click(app, "task", { id: issue.id });
    await click(app, "edit-task");
    assert.equal(drawer.querySelector('[name="description"]').value, text);
    assert.equal(drawer.querySelector('[name="acceptance"]').value, text);
  }
});

test("opening a saved board preserves leading blank lines in its query", async (t) => {
  const board = { id: "bd-test", name: "Saved board", query: '\n\npriority <= P1 AND title ~ "<task>"' };
  const app = await browser(t, { networkHandler: async (path) =>
    path === "/v1/boards" ? success({ boards: [board] }) : undefined });
  const modal = domContainer(app.node("#modal"));
  await click(app, "edit-board", { id: board.id });
  assert.equal(modal.querySelector('[name="query"]').value, board.query);
});
