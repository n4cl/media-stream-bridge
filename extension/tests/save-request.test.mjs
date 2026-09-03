import assert from "node:assert/strict";
import test from "node:test";

import { createSaveRequest } from "../build/extension/src/popup/save-request.js";

test("通常保存では既定名を送り、設定して保存では編集された名前と保存先を送る", () => {
  assert.deepEqual(
    createSaveRequest(1, "https://example.com/master.m3u8", "Example_20260903123456.mp4"),
    {
      type: "save:start",
      tabId: 1,
      hlsUrl: "https://example.com/master.m3u8",
      outputFileName: "Example_20260903123456.mp4",
    },
  );
  assert.deepEqual(createSaveRequest(1, "https://example.com/master.m3u8", undefined), {
    type: "save:start",
    tabId: 1,
    hlsUrl: "https://example.com/master.m3u8",
  });
  assert.deepEqual(
    createSaveRequest(1, "https://example.com/master.m3u8", "episode.mp4", "downloads"),
    {
      type: "save:start",
      tabId: 1,
      hlsUrl: "https://example.com/master.m3u8",
      outputFileName: "episode.mp4",
      destination: "downloads",
    },
  );
  assert.deepEqual(createSaveRequest(1, "https://example.com/master.m3u8", "test", "downloads"), {
    type: "save:start",
    tabId: 1,
    hlsUrl: "https://example.com/master.m3u8",
    outputFileName: "test",
    destination: "downloads",
  });
  assert.deepEqual(
    createSaveRequest(1, "https://example.com/master.m3u8", " episode.mp4 ", "movies"),
    {
      type: "save:start",
      tabId: 1,
      hlsUrl: "https://example.com/master.m3u8",
      outputFileName: " episode.mp4 ",
      destination: "movies",
    },
  );
  assert.deepEqual(createSaveRequest(1, "https://example.com/master.m3u8", "", "downloads"), {
    type: "save:start",
    tabId: 1,
    hlsUrl: "https://example.com/master.m3u8",
    destination: "downloads",
  });
});
