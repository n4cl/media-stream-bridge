import assert from "node:assert/strict";
import test from "node:test";

import {
  isNativeHostResponse,
  isSaveStreamRequest,
  NATIVE_MESSAGE_VERSION,
} from "../../extension/generated/shared/native-messages.js";

test("Native Host契約はバージョン付きの保存開始要求だけを受け入れる", () => {
  assert.equal(
    isSaveStreamRequest({
      version: NATIVE_MESSAGE_VERSION,
      type: "save:start",
      hlsUrl: "https://example.com/master.m3u8",
    }),
    true,
  );
  assert.equal(
    isSaveStreamRequest({ version: 2, type: "save:start", hlsUrl: "https://example.com/a.m3u8" }),
    false,
  );
  assert.equal(isSaveStreamRequest({ version: 1, type: "save:start", hlsUrl: 1 }), false);
});

test("Native Host契約は開始、完了、構造化失敗レスポンスを検証する", () => {
  assert.equal(isNativeHostResponse({ version: 1, type: "save:started", saveId: "id" }), true);
  assert.equal(
    isNativeHostResponse({
      version: 1,
      type: "save:completed",
      saveId: "id",
      outputFile: "/tmp/a.mp4",
    }),
    true,
  );
  assert.equal(
    isNativeHostResponse({ version: 1, type: "save:failed", code: "ffmpeg-exit" }),
    true,
  );
  assert.equal(isNativeHostResponse({ version: 1, type: "save:failed", code: "unknown" }), false);
});
