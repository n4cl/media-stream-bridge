import assert from "node:assert/strict";
import test from "node:test";

import {
  isListCandidatesMessage,
  isListCandidatesResponse,
} from "../../extension/generated/shared/messages.js";

test("候補一覧メッセージを種別で判定し、tabIdの検証は受信側に委ねる", () => {
  assert.equal(isListCandidatesMessage({ type: "candidates:list", tabId: 1 }), true);
  assert.equal(isListCandidatesMessage({ type: "candidates:list", tabId: "invalid" }), true);
  assert.equal(isListCandidatesMessage({ type: "unknown", tabId: 1 }), false);
});

test("候補一覧レスポンスの候補内容まで検証する", () => {
  assert.equal(
    isListCandidatesResponse({
      ok: true,
      candidates: [{ url: "https://example.com/master.m3u8", detectedAt: 1 }],
    }),
    true,
  );
  assert.equal(isListCandidatesResponse({ ok: true, candidates: [{ url: 1 }] }), false);
  assert.equal(isListCandidatesResponse({ ok: false, error: "invalid-tab-id" }), true);
});
