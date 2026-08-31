import assert from "node:assert/strict";
import test from "node:test";
import {
  cancellableSaveId,
  SAVE_STATUS_POLL_INTERVAL_MS,
  SaveStatusPoller,
  saveJobStatusText,
} from "../build/extension/src/popup/save-status.js";

function createScheduler() {
  let nextTimerId = 1;
  const timers = new Map();
  return {
    clearTimeout(timerId) {
      timers.delete(timerId);
    },
    runNext() {
      const [timerId, callback] = timers.entries().next().value;
      timers.delete(timerId);
      callback();
    },
    setTimeout(callback, delayMs) {
      const timerId = nextTimerId;
      nextTimerId += 1;
      timers.set(timerId, callback);
      assert.equal(delayMs, SAVE_STATUS_POLL_INTERVAL_MS);
      return timerId;
    },
    get size() {
      return timers.size;
    },
  };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("保存ジョブ状態をPopup向け文言へ変換する", () => {
  assert.equal(saveJobStatusText(null), null);
  assert.equal(saveJobStatusText({ state: "starting" }), "保存を開始しています…");
  assert.equal(saveJobStatusText({ state: "running", saveId: "save-1" }), "保存しています…");
  assert.equal(
    saveJobStatusText({ state: "running", saveId: "save-1", cancelError: "cancel-failed" }),
    "キャンセルできませんでした。保存を継続しています。",
  );
  assert.equal(
    saveJobStatusText({ state: "cancelling", saveId: "save-1" }),
    "キャンセルしています…",
  );
  assert.equal(
    saveJobStatusText({ state: "cancelled", saveId: "save-1" }),
    "保存をキャンセルしました。",
  );
  assert.equal(
    saveJobStatusText({ state: "completed", saveId: "save-1", outputFile: "/tmp/saved.mp4" }),
    "保存しました: /tmp/saved.mp4",
  );
  assert.equal(
    saveJobStatusText({ state: "failed", error: "ffmpeg-exit", saveId: "save-1" }),
    "保存に失敗しました。",
  );
});

test("キャンセル対象は実行中の保存だけに限定する", () => {
  assert.equal(cancellableSaveId(null), null);
  assert.equal(cancellableSaveId({ state: "starting" }), null);
  assert.equal(cancellableSaveId({ state: "running", saveId: "save-1" }), "save-1");
  assert.equal(cancellableSaveId({ state: "cancelling", saveId: "save-1" }), null);
  assert.equal(cancellableSaveId({ state: "cancelled", saveId: "save-1" }), null);
  assert.equal(
    cancellableSaveId({ state: "completed", saveId: "save-1", outputFile: "/tmp/saved.mp4" }),
    null,
  );
  assert.equal(cancellableSaveId({ state: "failed", error: "ffmpeg-exit" }), null);
});

test("Popupを開き直した状態照会は実行中から完了までポーリングする", async () => {
  const scheduler = createScheduler();
  const updates = [];
  const statuses = [
    { state: "running", saveId: "save-1" },
    { state: "completed", saveId: "save-1", outputFile: "/tmp/saved.mp4" },
  ];
  const poller = new SaveStatusPoller(
    async () => statuses.shift() ?? null,
    (status) => updates.push(status),
    () => assert.fail("status query should not fail"),
    scheduler,
  );

  poller.start();
  await flush();
  assert.deepEqual(updates, [{ state: "running", saveId: "save-1" }]);
  assert.equal(scheduler.size, 1);

  scheduler.runNext();
  await flush();
  assert.deepEqual(updates, [
    { state: "running", saveId: "save-1" },
    { state: "completed", saveId: "save-1", outputFile: "/tmp/saved.mp4" },
  ]);
  assert.equal(scheduler.size, 0);
});

test("Popupを開き直した状態照会はキャンセル中も終端までポーリングする", async () => {
  const scheduler = createScheduler();
  const updates = [];
  const statuses = [
    { state: "cancelling", saveId: "save-1" },
    { state: "cancelled", saveId: "save-1" },
  ];
  const poller = new SaveStatusPoller(
    async () => statuses.shift() ?? null,
    (status) => updates.push(status),
    () => assert.fail("status query should not fail"),
    scheduler,
  );

  poller.start();
  await flush();
  assert.deepEqual(updates, [{ state: "cancelling", saveId: "save-1" }]);
  assert.equal(scheduler.size, 1);

  scheduler.runNext();
  await flush();
  assert.deepEqual(updates.at(-1), { state: "cancelled", saveId: "save-1" });
  assert.equal(scheduler.size, 0);
});

test("ポーリングは重複要求を作らず、Popup終了時に次回要求を取り消す", async () => {
  const scheduler = createScheduler();
  let resolveStatus;
  let requests = 0;
  const updates = [];
  const poller = new SaveStatusPoller(
    () => {
      requests += 1;
      return new Promise((resolve) => {
        resolveStatus = resolve;
      });
    },
    (status) => updates.push(status),
    () => assert.fail("status query should not fail"),
    scheduler,
  );

  poller.start();
  poller.start();
  assert.equal(requests, 1);
  poller.stop();
  resolveStatus({ state: "running", saveId: "save-1" });
  await flush();
  assert.deepEqual(updates, []);
  assert.equal(scheduler.size, 0);
});
