import assert from "node:assert/strict";
import test from "node:test";

test("通信で検出したHLS候補をPopup向けメッセージへ返す", async () => {
  let observeRequest;
  let commitNavigation;
  let removeTab;
  let receiveMessage;
  let connectNative;
  let nativeMessage;
  let nativeDisconnect;
  let postedNativeMessage;

  globalThis.browser = {
    webRequest: {
      onBeforeRequest: {
        addListener(listener, filter) {
          observeRequest = listener;
          assert.deepEqual(filter, { urls: ["<all_urls>"] });
        },
      },
    },
    webNavigation: {
      onCommitted: {
        addListener(listener) {
          commitNavigation = listener;
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
      connectNative(name) {
        connectNative = name;
        return {
          onMessage: {
            addListener(listener) {
              nativeMessage = listener;
            },
          },
          onDisconnect: {
            addListener(listener) {
              nativeDisconnect = listener;
            },
          },
          postMessage(message) {
            postedNativeMessage = message;
          },
          disconnect() {
            nativeDisconnect();
          },
        };
      },
    },
  };

  await import("../../extension/build/extension/src/background/background.js");

  assert.equal(typeof observeRequest, "function");
  assert.equal(typeof commitNavigation, "function");
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

  observeRequest({ tabId: 7, type: "main_frame", url: "https://example.com/not-committed" });
  assert.equal((await receiveMessage({ type: "candidates:list", tabId: 7 })).candidates.length, 1);

  commitNavigation({ tabId: 7, frameId: 0, url: "https://example.com/next-page" });
  assert.deepEqual(await receiveMessage({ type: "candidates:list", tabId: 7 }), {
    ok: true,
    candidates: [],
  });

  observeRequest({ tabId: 7, url: "https://example.com/next-page.m3u8" });
  const nextPageResponse = await receiveMessage({ type: "candidates:list", tabId: 7 });
  assert.equal(nextPageResponse.ok, true);
  assert.equal(nextPageResponse.candidates.length, 1);
  assert.equal(nextPageResponse.candidates[0].url, "https://example.com/next-page.m3u8");
  assert.equal(typeof nextPageResponse.candidates[0].detectedAt, "number");

  commitNavigation({ tabId: 7, frameId: 1, url: "https://example.com/embedded-page" });
  assert.equal((await receiveMessage({ type: "candidates:list", tabId: 7 })).candidates.length, 1);

  removeTab(7);
  assert.deepEqual(await receiveMessage({ type: "candidates:list", tabId: 7 }), {
    ok: true,
    candidates: [],
  });

  const saving = receiveMessage({ type: "save:start", hlsUrl: "https://example.com/master.m3u8" });
  assert.equal(connectNative, "com.media_stream_bridge");
  assert.deepEqual(postedNativeMessage, {
    version: 1,
    type: "save:start",
    hlsUrl: "https://example.com/master.m3u8",
  });
  commitNavigation({ tabId: 7, frameId: 0, url: "https://example.com/after-save" });
  nativeMessage({ version: 1, type: "save:started", saveId: "save-1" });
  nativeMessage({
    version: 1,
    type: "save:completed",
    saveId: "save-1",
    outputFile: "/tmp/saved.mp4",
  });
  assert.deepEqual(await saving, {
    ok: true,
    response: {
      version: 1,
      type: "save:completed",
      saveId: "save-1",
      outputFile: "/tmp/saved.mp4",
    },
  });
  assert.equal(typeof nativeDisconnect, "function");
});
