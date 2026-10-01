import assert from "node:assert/strict";
import test from "node:test";
import { browser } from "./helpers/browser.mjs";
import { domContainer } from "./helpers/dom.mjs";

function click(app, action, extra = {}) {
  const target = { dataset: { action, ...extra } };
  return app.listeners.get("click")({ target: { closest: () => target }, preventDefault() {} });
}

for (const outcome of ["success", "failure"]) {
  for (const state of ["unchanged", "edited", "closed"]) {
    test(`a preview ${outcome} only affects its current draft (${state})`, async (t) => {
      const app = await browser(t);
      const drawer = domContainer(app.node("#drawer"));
      await click(app, "new-task");
      const textarea = drawer.querySelector('[name="description"]');
      const preview = drawer.querySelector("#preview-description");
      textarea.value = `Preview ${outcome} ${state}`;
      const entered = Promise.withResolvers();
      const response = Promise.withResolvers();
      app.network.handler = (path) => {
        if (path !== "/v1/markdown") return;
        entered.resolve();
        return response.promise;
      };
      const pending = click(app, "preview", { field: "description" });
      await entered.promise;
      if (state === "edited") textarea.value = "Newer text still being written";
      if (state === "closed") await click(app, "close-task");
      response.resolve({
        ok: outcome === "success", status: outcome === "success" ? 200 : 503,
        json: async () => outcome === "success"
          ? { ok: true, data: { html: "<p>Preview response</p>" } }
          : { ok: false, error: { message: "Preview unavailable" } },
      });
      await pending;
      const displayed = outcome === "success" && state === "unchanged";
      if (state !== "closed") {
        assert.equal(preview.hidden, !displayed);
        assert.equal(textarea.hidden, displayed);
      }
      if (displayed) assert.equal(preview.innerHTML, "<p>Preview response</p>");
      if (state === "edited") assert.equal(textarea.value, "Newer text still being written");
      if (state === "closed") assert.equal(drawer.hidden, true);
      assert.equal(app.node("#error-banner").hidden, outcome !== "failure" || state !== "unchanged");
    });
  }
}
