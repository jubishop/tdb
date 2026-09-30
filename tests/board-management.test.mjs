import assert from "node:assert/strict";
import test from "node:test";
import { browser } from "./helpers/browser.mjs";
import { domContainer } from "./helpers/dom.mjs";

function click(listeners, target) {
  return listeners.get("click")({ target: { closest: () => target }, preventDefault() {} });
}

test("Edit board targets the visible board while another board loads", async (t) => {
  const boards = [
    { id: "bd-test", name: "Original board" },
    { id: "bd-other", name: "Other board" },
  ];
  const app = await browser(t, { networkHandler: async (path) => path === "/v1/boards" ? {
    ok: true, json: async () => ({ ok: true, data: { boards } }),
  } : undefined });
  const content = domContainer(app.node("#content"));
  const entered = Promise.withResolvers();
  const response = Promise.withResolvers();
  const handle = app.network.handler;
  app.network.handler = async (path) => {
    if (path.startsWith("/v1/boards/bd-other?")) {
      entered.resolve();
      return response.promise;
    }
    return handle(path);
  };
  const navigation = click(app.listeners, { dataset: { action: "board", id: "bd-other" } });
  await entered.promise;
  await click(app.listeners, content.querySelector('[data-action="edit-board"]'));
  const markup = app.node("#modal").innerHTML;
  response.resolve({ ok: true, json: async () => ({ ok: true, data: { issues: [] } }) });
  await navigation;
  assert.match(markup, /value="Original board"/);
  assert.doesNotMatch(markup, /value="Other board"/);
});

test("Delete board keeps the dialog target when a refresh changes the selected board", async (t) => {
  const boards = [{ id: "bd-test", name: "Original board" }];
  const app = await browser(t, { networkHandler: async (path, options) => {
    if (path === "/v1/boards") return { ok: true, json: async () => ({ ok: true, data: { boards } }) };
    if (path === "/v1/boards/bd-other?include_closed=false")
      return { ok: true, json: async () => ({ ok: true, data: { issues: [] } }) };
    if (options.method === "DELETE") return { ok: true, json: async () => ({ ok: true, data: {} }) };
  } });
  const content = domContainer(app.node("#content"));
  const modal = domContainer(app.node("#modal"));
  await click(app.listeners, content.querySelector('[data-action="edit-board"]'));
  boards.splice(0, 1, { id: "bd-other", name: "Replacement board" });
  await click(app.listeners, { dataset: { action: "refresh" } });
  await click(app.listeners, modal.querySelector('[data-action="delete-board"]'));
  // A disappeared board must not turn into a deletion of its replacement.
  assert.doesNotMatch(modal.innerHTML, /Delete <strong>Replacement board/);
  assert.equal(app.requests.filter((request) => request.method === "DELETE").length, 0);
  const error = modal.querySelector("#modal-error");
  assert.equal(error.hidden, false);
  assert.match(error.textContent, /no longer available/i);
});
