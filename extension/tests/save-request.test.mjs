import assert from "node:assert/strict";
import test from "node:test";

import { createSaveRequest } from "../build/extension/src/popup/save-request.js";

test("通常保存では設定項目を送らず、設定して保存では保存先を送る", () => {
  assert.deepEqual(createSaveRequest(1, "https://example.com/master.m3u8"), {
    type: "save:start",
    tabId: 1,
    hlsUrl: "https://example.com/master.m3u8",
  });
  assert.deepEqual(
    createSaveRequest(1, "https://example.com/master.m3u8", {
      outputFileName: "episode.mp4",
      destination: "downloads",
    }),
    {
      type: "save:start",
      tabId: 1,
      hlsUrl: "https://example.com/master.m3u8",
      outputFileName: "episode.mp4",
      destination: "downloads",
    },
  );
  assert.deepEqual(
    createSaveRequest(1, "https://example.com/master.m3u8", {
      outputFileName: " episode.mp4 ",
      destination: "movies",
    }),
    {
      type: "save:start",
      tabId: 1,
      hlsUrl: "https://example.com/master.m3u8",
      outputFileName: " episode.mp4 ",
      destination: "movies",
    },
  );
  assert.deepEqual(
    createSaveRequest(1, "https://example.com/master.m3u8", {
      outputFileName: "",
      destination: "movies",
    }),
    {
      type: "save:start",
      tabId: 1,
      hlsUrl: "https://example.com/master.m3u8",
      destination: "movies",
    },
  );
});
