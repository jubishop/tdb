import assert from "node:assert/strict";
import test from "node:test";
import { browser } from "./helpers/browser.mjs";

test("live updates recover after terminal event-stream failures", async (t) => {
  const { node, streams, issues } = await browser(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (let attempt = 0; attempt < 2; attempt++) {
    const stream = streams.at(-1);
    stream.readyState = EventSource.CLOSED;
    stream.onerror();
    assert.equal(node("#connection").classList.contains("offline"), true);
    t.mock.timers.tick(1999);
    assert.equal(streams.length, attempt + 1, "retry is delayed");
    t.mock.timers.tick(1);
    assert.equal(streams.length, attempt + 2, "closed stream is replaced");
  }
  const recovered = streams.at(-1);
  issues[0].title = "Changed during outage";
  recovered.readyState = EventSource.OPEN;
  recovered.onopen();
  await new Promise(setImmediate);
  assert.equal(node("#connection").classList.contains("offline"), false);
  assert.match(node("#content").innerHTML, /Changed during outage/);

  issues[0].title = "Changed after recovery";
  recovered.listeners.get("refresh")({ data: JSON.stringify({ change_token: "new" }) });
  t.mock.timers.tick(150);
  await new Promise(setImmediate);
  assert.match(node("#content").innerHTML, /Changed after recovery/);
});

test("transient event-stream failures retain the browser's existing retry", async (t) => {
  const { streams } = await browser(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  streams[0].readyState = EventSource.CONNECTING;
  streams[0].onerror();
  t.mock.timers.tick(2000);
  assert.equal(streams.length, 1);
});
