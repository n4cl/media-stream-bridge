import assert from "node:assert/strict";
import test from "node:test";

import { runNativeHost, waitForStdinDisconnect } from "../build/native-host/src/host.js";

function readStartThenWait(request) {
  let readCount = 0;
  return (signal) => {
    readCount += 1;
    if (readCount === 1) {
      return Promise.resolve(request);
    }
    return new Promise((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        },
        { once: true },
      );
    });
  };
}

function createMessageQueue(firstMessage) {
  const messages = [firstMessage];
  let waiting;
  return {
    read(signal) {
      if (messages.length > 0) {
        return Promise.resolve(messages.shift());
      }
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          waiting = undefined;
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        };
        waiting = (message) => {
          signal.removeEventListener("abort", onAbort);
          waiting = undefined;
          resolve(message);
        };
        signal.addEventListener("abort", onAbort, { once: true });
      });
    },
    send(message) {
      if (waiting) {
        waiting(message);
      } else {
        messages.push(message);
      }
    },
  };
}

test("Native Hostは保存開始と完了を契約順に返す", async () => {
  const responses = [];
  let receivedUrl;
  let receivedFfmpegPath;
  let startWaiting;
  const waitingForDisconnect = new Promise((resolve) => {
    startWaiting = resolve;
  });
  let releaseDisconnect;
  const disconnected = new Promise((resolve) => {
    releaseDisconnect = resolve;
  });

  const running = runNativeHost("/opt/homebrew/bin/ffmpeg", {
    readMessage: readStartThenWait({
      version: 1,
      type: "save:start",
      hlsUrl: "https://example.com/master.m3u8",
    }),
    writeMessage: async (response) => responses.push(response),
    startSave: async (hlsUrl, ffmpegPath) => {
      receivedUrl = hlsUrl;
      receivedFfmpegPath = ffmpegPath;
      return {
        saveId: "save-1",
        outputFile: "/safe/output/media-stream-save-1.mp4",
        completed: Promise.resolve("completed"),
        cancel: () => assert.fail("normal completion must not be cancelled"),
      };
    },
    waitForDisconnect: async () => {
      startWaiting();
      await disconnected;
    },
  });

  await waitingForDisconnect;

  assert.equal(receivedUrl, "https://example.com/master.m3u8");
  assert.equal(receivedFfmpegPath, "/opt/homebrew/bin/ffmpeg");
  assert.deepEqual(responses, [
    { version: 1, type: "save:started", saveId: "save-1" },
    {
      version: 1,
      type: "save:completed",
      saveId: "save-1",
      outputFile: "/safe/output/media-stream-save-1.mp4",
    },
  ]);
  releaseDisconnect();
  await running;
});

test("Native Hostは不正な要求をffmpegへ渡さず拒否する", async () => {
  const responses = [];
  let started = false;
  let waited = false;

  await runNativeHost("/opt/homebrew/bin/ffmpeg", {
    readMessage: async () => ({ version: 1, type: "save:start", hlsUrl: "file:///tmp/a.m3u8" }),
    writeMessage: async (response) => responses.push(response),
    startSave: async () => {
      started = true;
      throw new Error("must not start");
    },
    waitForDisconnect: async () => {
      waited = true;
    },
  });

  assert.equal(started, false);
  assert.equal(waited, true);
  assert.deepEqual(responses, [{ version: 1, type: "save:failed", code: "invalid-request" }]);
});

test("Native Hostは要求読み取り失敗の終端応答後に切断を待つ", async () => {
  const responses = [];
  let startWaiting;
  const waitingForDisconnect = new Promise((resolve) => {
    startWaiting = resolve;
  });
  let releaseDisconnect;
  const disconnected = new Promise((resolve) => {
    releaseDisconnect = resolve;
  });

  const running = runNativeHost("/opt/homebrew/bin/ffmpeg", {
    readMessage: async () => {
      throw new Error("malformed frame");
    },
    writeMessage: async (response) => responses.push(response),
    startSave: async () => {
      throw new Error("must not start");
    },
    waitForDisconnect: async () => {
      startWaiting();
      await disconnected;
    },
  });

  await waitingForDisconnect;
  assert.deepEqual(responses, [{ version: 1, type: "save:failed", code: "invalid-request" }]);
  releaseDisconnect();
  await running;
});

test("Native Hostは不正なffmpegパスの終端応答後に切断を待つ", async () => {
  const responses = [];
  let started = false;
  let waited = false;

  await runNativeHost("relative/ffmpeg", {
    readMessage: readStartThenWait({
      version: 1,
      type: "save:start",
      hlsUrl: "https://example.com/master.m3u8",
    }),
    writeMessage: async (response) => responses.push(response),
    startSave: async () => {
      started = true;
      throw new Error("must not start");
    },
    waitForDisconnect: async () => {
      waited = true;
    },
  });

  assert.equal(started, false);
  assert.equal(waited, true);
  assert.deepEqual(responses, [{ version: 1, type: "save:failed", code: "internal-error" }]);
});

test("Native Hostは保存失敗の終端応答後に切断を待つ", async () => {
  const responses = [];
  let startWaiting;
  const waitingForDisconnect = new Promise((resolve) => {
    startWaiting = resolve;
  });
  let releaseDisconnect;
  const disconnected = new Promise((resolve) => {
    releaseDisconnect = resolve;
  });

  const running = runNativeHost("/opt/homebrew/bin/ffmpeg", {
    readMessage: readStartThenWait({
      version: 1,
      type: "save:start",
      hlsUrl: "https://example.com/master.m3u8",
    }),
    writeMessage: async (response) => responses.push(response),
    startSave: async () => {
      throw new Error("save failed");
    },
    waitForDisconnect: async () => {
      startWaiting();
      await disconnected;
    },
  });

  await waitingForDisconnect;
  assert.deepEqual(responses, [{ version: 1, type: "save:failed", code: "internal-error" }]);
  releaseDisconnect();
  await running;
});

test("Native Hostは開始後の保存失敗を通知してから切断を待つ", async () => {
  const responses = [];
  let startWaiting;
  const waitingForDisconnect = new Promise((resolve) => {
    startWaiting = resolve;
  });
  let releaseDisconnect;
  const disconnected = new Promise((resolve) => {
    releaseDisconnect = resolve;
  });

  const running = runNativeHost("/opt/homebrew/bin/ffmpeg", {
    readMessage: readStartThenWait({
      version: 1,
      type: "save:start",
      hlsUrl: "https://example.com/master.m3u8",
    }),
    writeMessage: async (response) => responses.push(response),
    startSave: async () => ({
      saveId: "save-1",
      outputFile: "/safe/output/media-stream-save-1.mp4",
      completed: Promise.reject(new Error("ffmpeg exited")),
      cancel: () => assert.fail("failed save must not be cancelled"),
    }),
    waitForDisconnect: async () => {
      startWaiting();
      await disconnected;
    },
  });

  await waitingForDisconnect;
  assert.deepEqual(responses, [
    { version: 1, type: "save:started", saveId: "save-1" },
    { version: 1, type: "save:failed", code: "internal-error" },
  ]);
  releaseDisconnect();
  await running;
});

test("Native Hostは後始末完了前に保存失敗を通知しない", async () => {
  const responses = [];
  let notifyStarted;
  const startedWritten = new Promise((resolve) => {
    notifyStarted = resolve;
  });
  let finishCleanup;
  const completed = new Promise((_resolve, reject) => {
    finishCleanup = () => reject(new Error("ffmpeg exited after cleanup"));
  });

  const running = runNativeHost("/opt/homebrew/bin/ffmpeg", {
    readMessage: readStartThenWait({
      version: 1,
      type: "save:start",
      hlsUrl: "https://example.com/master.m3u8",
    }),
    writeMessage: async (response) => {
      responses.push(response);
      if (response.type === "save:started") {
        notifyStarted();
      }
    },
    startSave: async () => ({
      saveId: "save-1",
      outputFile: "/safe/output/media-stream-save-1.mp4",
      completed,
      cancel: () => assert.fail("failed save must not be cancelled"),
    }),
    waitForDisconnect: async () => {},
  });

  await startedWritten;
  assert.deepEqual(responses, [{ version: 1, type: "save:started", saveId: "save-1" }]);

  finishCleanup();
  await running;
  assert.deepEqual(responses, [
    { version: 1, type: "save:started", saveId: "save-1" },
    { version: 1, type: "save:failed", code: "internal-error" },
  ]);
});

test("Native Hostはキャンセル後の後始末完了を待ってcancelledを返す", async () => {
  const queue = createMessageQueue({
    version: 1,
    type: "save:start",
    hlsUrl: "https://example.com/master.m3u8",
  });
  const responses = [];
  let cancelCalled;
  const cancelStarted = new Promise((resolve) => {
    cancelCalled = resolve;
  });
  let finishSave;
  const completed = new Promise((resolve) => {
    finishSave = resolve;
  });

  const running = runNativeHost("/opt/homebrew/bin/ffmpeg", {
    readMessage: queue.read,
    writeMessage: async (response) => responses.push(response),
    startSave: async () => ({
      saveId: "save-1",
      outputFile: "/safe/output/media-stream-save-1.mp4",
      completed,
      cancel: () => {
        cancelCalled();
        return { ok: true };
      },
    }),
    waitForDisconnect: async () => {},
  });

  queue.send({ version: 1, type: "save:cancel", saveId: "save-1" });
  await cancelStarted;
  assert.deepEqual(responses, [{ version: 1, type: "save:started", saveId: "save-1" }]);

  finishSave("cancelled");
  await running;
  assert.deepEqual(responses, [
    { version: 1, type: "save:started", saveId: "save-1" },
    { version: 1, type: "save:cancelled", saveId: "save-1" },
  ]);
});

test("Native Hostは不一致のキャンセルを拒否して正常保存を継続する", async () => {
  const queue = createMessageQueue({
    version: 1,
    type: "save:start",
    hlsUrl: "https://example.com/master.m3u8",
  });
  const responses = [];
  let finishSave;
  const completed = new Promise((resolve) => {
    finishSave = resolve;
  });
  const running = runNativeHost("/opt/homebrew/bin/ffmpeg", {
    readMessage: queue.read,
    writeMessage: async (response) => responses.push(response),
    startSave: async () => ({
      saveId: "save-1",
      outputFile: "/safe/output/media-stream-save-1.mp4",
      completed,
      cancel: () => assert.fail("mismatched save must not be cancelled"),
    }),
    waitForDisconnect: async () => {},
  });

  queue.send({ version: 1, type: "save:cancel", saveId: "other-save" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(responses, [
    { version: 1, type: "save:started", saveId: "save-1" },
    {
      version: 1,
      type: "save:cancel-rejected",
      saveId: "other-save",
      code: "save-id-mismatch",
    },
  ]);

  finishSave("completed");
  await running;
  assert.deepEqual(responses.at(-1), {
    version: 1,
    type: "save:completed",
    saveId: "save-1",
    outputFile: "/safe/output/media-stream-save-1.mp4",
  });
});

test("Native Hostは終了要求を出せない場合に拒否して正常終了を維持する", async () => {
  const queue = createMessageQueue({
    version: 1,
    type: "save:start",
    hlsUrl: "https://example.com/master.m3u8",
  });
  const responses = [];
  let finishSave;
  const completed = new Promise((resolve) => {
    finishSave = resolve;
  });
  const running = runNativeHost("/opt/homebrew/bin/ffmpeg", {
    readMessage: queue.read,
    writeMessage: async (response) => responses.push(response),
    startSave: async () => ({
      saveId: "save-1",
      outputFile: "/safe/output/media-stream-save-1.mp4",
      completed,
      cancel: () => ({ ok: false, code: "save-not-cancellable" }),
    }),
    waitForDisconnect: async () => {},
  });

  queue.send({ version: 1, type: "save:cancel", saveId: "save-1" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(responses.at(-1), {
    version: 1,
    type: "save:cancel-rejected",
    saveId: "save-1",
    code: "save-not-cancellable",
  });

  finishSave("completed");
  await running;
  assert.equal(responses.at(-1).type, "save:completed");
});

test("Native Hostは保存中の壊れた要求で対象を終了して構造化失敗を返す", async () => {
  const queue = createMessageQueue({
    version: 1,
    type: "save:start",
    hlsUrl: "https://example.com/master.m3u8",
  });
  const responses = [];
  let cancelCalled;
  const cancellationStarted = new Promise((resolve) => {
    cancelCalled = resolve;
  });
  let finishSave;
  const completed = new Promise((resolve) => {
    finishSave = resolve;
  });
  const running = runNativeHost("/opt/homebrew/bin/ffmpeg", {
    readMessage: queue.read,
    writeMessage: async (response) => responses.push(response),
    startSave: async () => ({
      saveId: "save-1",
      outputFile: "/safe/output/media-stream-save-1.mp4",
      completed,
      cancel: () => {
        cancelCalled();
        return { ok: true };
      },
    }),
    waitForDisconnect: async () => {},
  });

  queue.send({ version: 1, type: "unknown" });
  await cancellationStarted;
  finishSave("cancelled");
  await running;
  assert.deepEqual(responses, [
    { version: 1, type: "save:started", saveId: "save-1" },
    { version: 1, type: "save:failed", code: "internal-error" },
  ]);
});

test("stdin切断待機はEOFとタイムアウトでlistenerとtimerを解除する", async () => {
  const listeners = new Map();
  const input = {
    readableEnded: false,
    once(event, listener) {
      listeners.set(event, listener);
    },
    off(event, listener) {
      assert.equal(listeners.get(event), listener);
      listeners.delete(event);
    },
  };
  let timer;
  let clearedTimer;
  const scheduler = {
    setTimeout(callback, delayMs) {
      assert.equal(delayMs, 5_000);
      timer = callback;
      return "timer";
    },
    clearTimeout(timeout) {
      clearedTimer = timeout;
    },
  };

  const eofWait = waitForStdinDisconnect(input, 5_000, scheduler);
  listeners.get("end")();
  await eofWait;
  assert.equal(clearedTimer, "timer");
  assert.equal(listeners.size, 0);

  const timeoutWait = waitForStdinDisconnect(input, 5_000, scheduler);
  timer();
  await timeoutWait;
  assert.equal(clearedTimer, "timer");
  assert.equal(listeners.size, 0);

  const endedInput = {
    readableEnded: true,
    once() {
      assert.fail("EOF済み入力へlistenerを登録してはならない");
    },
    off() {
      assert.fail("EOF済み入力からlistenerを解除してはならない");
    },
  };
  const endedScheduler = {
    setTimeout() {
      assert.fail("EOF済み入力へtimerを登録してはならない");
    },
    clearTimeout() {
      assert.fail("EOF済み入力のtimerを解除してはならない");
    },
  };
  await waitForStdinDisconnect(endedInput, 5_000, endedScheduler);
});
