import assert from "node:assert/strict";
import test from "node:test";

import { runNativeHost } from "../../native-host/build/native-host/src/host.js";

test("Native Hostは保存開始と完了を契約順に返す", async () => {
  const responses = [];
  let receivedUrl;
  let receivedFfmpegPath;

  await runNativeHost("/opt/homebrew/bin/ffmpeg", {
    readMessage: async () => ({
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
        completed: Promise.resolve(),
      };
    },
  });

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
});

test("Native Hostは不正な要求をffmpegへ渡さず拒否する", async () => {
  const responses = [];
  let started = false;

  await runNativeHost("/opt/homebrew/bin/ffmpeg", {
    readMessage: async () => ({ version: 1, type: "save:start", hlsUrl: "file:///tmp/a.m3u8" }),
    writeMessage: async (response) => responses.push(response),
    startSave: async () => {
      started = true;
      throw new Error("must not start");
    },
  });

  assert.equal(started, false);
  assert.deepEqual(responses, [{ version: 1, type: "save:failed", code: "invalid-request" }]);
});
