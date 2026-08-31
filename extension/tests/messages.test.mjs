import assert from "node:assert/strict";
import test from "node:test";

import {
  isListCandidatesMessage,
  isListCandidatesResponse,
  isSaveCancelMessage,
  isSaveCancelResponse,
  isSaveCandidateResponse,
  isSaveStatusMessage,
  isSaveStatusResponse,
} from "../build/extension/src/shared/messages.js";

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

test("保存状態メッセージとレスポンスを検証する", () => {
  assert.equal(isSaveStatusMessage({ type: "save:status", tabId: 1 }), true);
  assert.equal(isSaveStatusMessage({ type: "save:status", tabId: "invalid" }), true);
  assert.equal(isSaveStatusMessage({ type: "save:start", tabId: 1 }), false);
  assert.equal(isSaveStatusResponse({ ok: true, job: null }), true);
  assert.equal(isSaveStatusResponse({ ok: true, job: { state: "starting" } }), true);
  assert.equal(
    isSaveStatusResponse({ ok: true, job: { state: "running", saveId: "save-1" } }),
    true,
  );
  assert.equal(
    isSaveStatusResponse({
      ok: true,
      job: { state: "running", saveId: "save-1", cancelError: "cancel-failed" },
    }),
    true,
  );
  assert.equal(
    isSaveStatusResponse({ ok: true, job: { state: "cancelling", saveId: "save-1" } }),
    true,
  );
  assert.equal(
    isSaveStatusResponse({ ok: true, job: { state: "cancelled", saveId: "save-1" } }),
    true,
  );
  assert.equal(
    isSaveStatusResponse({
      ok: true,
      job: { state: "completed", saveId: "save-1", outputFile: "/tmp/saved.mp4" },
    }),
    true,
  );
  assert.equal(
    isSaveStatusResponse({
      ok: true,
      job: { state: "failed", error: "ffmpeg-exit", saveId: "save-1" },
    }),
    true,
  );
  assert.equal(
    isSaveStatusResponse({ ok: true, job: { state: "failed", error: "invalid-request" } }),
    true,
  );
  assert.equal(isSaveStatusResponse({ ok: true, job: { state: "running" } }), false);
  assert.equal(isSaveStatusResponse({ ok: true, job: { state: "completed" } }), false);
  assert.equal(
    isSaveStatusResponse({ ok: true, job: { state: "completed", saveId: "", outputFile: "" } }),
    false,
  );
  assert.equal(
    isSaveStatusResponse({ ok: true, job: { state: "failed", error: "ffmpeg-exit", saveId: "" } }),
    false,
  );
  assert.equal(isSaveStatusResponse({ ok: false, error: "invalid-tab-id" }), true);
});

test("保存キャンセルメッセージは種別だけを判定し、値の検証は受信側に委ねる", () => {
  assert.equal(isSaveCancelMessage({ type: "save:cancel", tabId: 1, saveId: "save-1" }), true);
  assert.equal(isSaveCancelMessage({ type: "save:cancel", tabId: "invalid", saveId: 1 }), true);
  assert.equal(isSaveCancelMessage({ type: "save:start", tabId: 1, saveId: "save-1" }), false);
  assert.equal(isSaveCancelResponse({ ok: true }), true);
  assert.equal(isSaveCancelResponse({ ok: false, error: "save-id-mismatch" }), true);
  assert.equal(isSaveCancelResponse({ ok: false, error: "unknown" }), false);
});

test("重複保存開始エラーを保存開始レスポンスとして検証する", () => {
  assert.equal(isSaveCandidateResponse({ ok: false, error: "save-already-running" }), true);
});
