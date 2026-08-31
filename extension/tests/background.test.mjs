import assert from "node:assert/strict";
import test from "node:test";

test("通信で検出したHLS候補をPopup向けメッセージへ返す", async () => {
  let observeRequest;
  let commitNavigation;
  let removeTab;
  let receiveMessage;
  let connectNative;
  let nativeConnectionCount = 0;
  let nativeMessage;
  let nativeDisconnect;
  let postedNativeMessage;
  let throwPostMessage = false;
  const nativePorts = [];

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
        nativeConnectionCount += 1;
        const nativePort = { disconnectCalls: 0 };
        nativePorts.push(nativePort);
        return {
          onMessage: {
            addListener(listener) {
              nativeMessage = listener;
              nativePort.message = listener;
            },
          },
          onDisconnect: {
            addListener(listener) {
              nativeDisconnect = listener;
              nativePort.disconnect = listener;
            },
          },
          postMessage(message) {
            postedNativeMessage = message;
            nativePort.postedMessage = message;
            if (throwPostMessage) {
              throwPostMessage = false;
              throw new Error("native port is unavailable");
            }
          },
          disconnect() {
            nativePort.disconnectCalls += 1;
          },
        };
      },
    },
  };

  await import("../build/extension/src/background/background.js");

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
  assert.deepEqual(await receiveMessage({ type: "save:status", tabId: 7 }), {
    ok: true,
    job: null,
  });

  const saving = receiveMessage({
    type: "save:start",
    tabId: 7,
    hlsUrl: "https://example.com/master.m3u8",
  });
  assert.equal(connectNative, "com.media_stream_bridge");
  assert.equal(nativeConnectionCount, 1);
  assert.deepEqual(postedNativeMessage, {
    version: 1,
    type: "save:start",
    hlsUrl: "https://example.com/master.m3u8",
  });
  assert.deepEqual(await receiveMessage({ type: "save:status", tabId: 7 }), {
    ok: true,
    job: { state: "starting" },
  });
  assert.deepEqual(
    await receiveMessage({
      type: "save:start",
      tabId: 7,
      hlsUrl: "https://example.com/duplicate-while-starting.m3u8",
    }),
    { ok: false, error: "save-already-running" },
  );
  assert.equal(nativeConnectionCount, 1);
  assert.deepEqual(await receiveMessage({ type: "save:status", tabId: 7 }), {
    ok: true,
    job: { state: "starting" },
  });
  commitNavigation({ tabId: 7, frameId: 0, url: "https://example.com/after-save" });
  nativeMessage({ version: 1, type: "save:started", saveId: "save-1" });
  assert.deepEqual(await saving, {
    ok: true,
    response: { version: 1, type: "save:started", saveId: "save-1" },
  });
  assert.equal(nativePorts[0].disconnectCalls, 0);
  assert.deepEqual(await receiveMessage({ type: "save:status", tabId: 7 }), {
    ok: true,
    job: { state: "running", saveId: "save-1" },
  });
  assert.deepEqual(
    await receiveMessage({
      type: "save:start",
      tabId: 7,
      hlsUrl: "https://example.com/duplicate-while-running.m3u8",
    }),
    { ok: false, error: "save-already-running" },
  );
  assert.equal(nativeConnectionCount, 1);
  nativeMessage({
    version: 1,
    type: "save:completed",
    saveId: "save-1",
    outputFile: "/tmp/saved.mp4",
  });
  assert.equal(nativePorts[0].disconnectCalls, 1);
  assert.equal(typeof nativeDisconnect, "function");
  assert.deepEqual(await receiveMessage({ type: "save:status", tabId: 7 }), {
    ok: true,
    job: { state: "completed", saveId: "save-1", outputFile: "/tmp/saved.mp4" },
  });
  nativePorts[0].disconnect();
  assert.deepEqual(await receiveMessage({ type: "save:status", tabId: 7 }), {
    ok: true,
    job: { state: "completed", saveId: "save-1", outputFile: "/tmp/saved.mp4" },
  });

  const disconnectedSave = receiveMessage({
    type: "save:start",
    tabId: 8,
    hlsUrl: "https://example.com/disconnected.m3u8",
  });
  nativeMessage({ version: 1, type: "save:started", saveId: "save-2" });
  assert.deepEqual(await disconnectedSave, {
    ok: true,
    response: { version: 1, type: "save:started", saveId: "save-2" },
  });
  removeTab(8);
  assert.deepEqual(await receiveMessage({ type: "save:status", tabId: 8 }), {
    ok: true,
    job: { state: "running", saveId: "save-2" },
  });
  nativeDisconnect();
  assert.deepEqual(await receiveMessage({ type: "save:status", tabId: 8 }), {
    ok: true,
    job: { state: "failed", error: "native-host-unavailable", saveId: "save-2" },
  });

  const outOfOrderSave = receiveMessage({
    type: "save:start",
    tabId: 9,
    hlsUrl: "https://example.com/out-of-order.m3u8",
  });
  nativeMessage({
    version: 1,
    type: "save:completed",
    saveId: "save-3",
    outputFile: "/tmp/out-of-order.mp4",
  });
  assert.deepEqual(await outOfOrderSave, { ok: false, error: "native-host-invalid-response" });
  assert.deepEqual(await receiveMessage({ type: "save:status", tabId: 9 }), {
    ok: true,
    job: { state: "failed", error: "native-host-invalid-response" },
  });

  const mismatchedCompletionSave = receiveMessage({
    type: "save:start",
    tabId: 10,
    hlsUrl: "https://example.com/mismatched-save-id.m3u8",
  });
  nativeMessage({ version: 1, type: "save:started", saveId: "save-4" });
  assert.deepEqual(await mismatchedCompletionSave, {
    ok: true,
    response: { version: 1, type: "save:started", saveId: "save-4" },
  });
  nativeMessage({
    version: 1,
    type: "save:completed",
    saveId: "other-save",
    outputFile: "/tmp/mismatched.mp4",
  });
  assert.deepEqual(await receiveMessage({ type: "save:status", tabId: 10 }), {
    ok: true,
    job: { state: "failed", error: "native-host-invalid-response", saveId: "save-4" },
  });

  const firstAttempt = receiveMessage({
    type: "save:start",
    tabId: 11,
    hlsUrl: "https://example.com/first-attempt.m3u8",
  });
  const firstPort = nativePorts.at(-1);
  firstPort.message({ version: 1, type: "save:started", saveId: "save-5" });
  firstPort.message({
    version: 1,
    type: "save:completed",
    saveId: "save-5",
    outputFile: "/tmp/first-attempt.mp4",
  });
  await firstAttempt;

  const secondAttempt = receiveMessage({
    type: "save:start",
    tabId: 11,
    hlsUrl: "https://example.com/second-attempt.m3u8",
  });
  const secondPort = nativePorts.at(-1);
  assert.notEqual(secondPort, firstPort);
  firstPort.disconnect();
  firstPort.message({ version: 1, type: "save:started", saveId: "stale-save" });
  assert.deepEqual(await receiveMessage({ type: "save:status", tabId: 11 }), {
    ok: true,
    job: { state: "starting" },
  });
  secondPort.message({ version: 1, type: "save:started", saveId: "save-6" });
  assert.deepEqual(await receiveMessage({ type: "save:status", tabId: 11 }), {
    ok: true,
    job: { state: "running", saveId: "save-6" },
  });
  secondPort.message({
    version: 1,
    type: "save:completed",
    saveId: "save-6",
    outputFile: "/tmp/second-attempt.mp4",
  });
  await secondAttempt;

  throwPostMessage = true;
  assert.deepEqual(
    await receiveMessage({
      type: "save:start",
      tabId: 12,
      hlsUrl: "https://example.com/post-message-throws.m3u8",
    }),
    { ok: false, error: "native-host-unavailable" },
  );
  assert.deepEqual(await receiveMessage({ type: "save:status", tabId: 12 }), {
    ok: true,
    job: { state: "failed", error: "native-host-unavailable" },
  });

  assert.deepEqual(
    await receiveMessage({
      type: "save:start",
      tabId: "invalid",
      hlsUrl: "https://example.com/master.m3u8",
    }),
    { ok: false, error: "invalid-tab-id" },
  );
  assert.deepEqual(await receiveMessage({ type: "save:status", tabId: "invalid" }), {
    ok: false,
    error: "invalid-tab-id",
  });
});
