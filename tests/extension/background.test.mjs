import assert from "node:assert/strict";
import test from "node:test";

test("通信で検出したHLS候補をPopup向けメッセージへ返す", async () => {
  let observeRequest;
  let removeTab;
  let receiveMessage;

  globalThis.browser = {
    webRequest: {
      onBeforeRequest: {
        addListener(listener, filter) {
          observeRequest = listener;
          assert.deepEqual(filter, { urls: ["<all_urls>"] });
        },
      },
    },
    tabs: {
      onRemoved: {
        addListener(listener) {
          removeTab = listener;
        },
      },
    },
    runtime: {
      onMessage: {
        addListener(listener) {
          receiveMessage = listener;
        },
      },
    },
  };

  await import("../../extension/generated/background/background.js");

  assert.equal(typeof observeRequest, "function");
  assert.equal(typeof removeTab, "function");
  assert.equal(typeof receiveMessage, "function");

  observeRequest({ tabId: 7, url: "https://example.com/master.m3u8" });
  observeRequest({ tabId: 7, url: "https://example.com/segment.ts" });
  observeRequest({ tabId: -1, url: "https://example.com/other.m3u8" });

  const response = await receiveMessage({ type: "candidates:list", tabId: 7 });
  assert.equal(response.ok, true);
  assert.equal(response.candidates.length, 1);
  assert.equal(response.candidates[0].url, "https://example.com/master.m3u8");
  assert.equal(typeof response.candidates[0].detectedAt, "number");

  removeTab(7);
  assert.deepEqual(await receiveMessage({ type: "candidates:list", tabId: 7 }), {
    ok: true,
    candidates: [],
  });
});
