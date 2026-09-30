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
