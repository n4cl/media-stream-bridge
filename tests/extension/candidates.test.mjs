import assert from "node:assert/strict";
import test from "node:test";

import { CandidateStore, isHlsPlaylistUrl } from "../../extension/shared/candidates.mjs";

test("m3u8で終わるURLをHLS候補として判定する", () => {
  assert.equal(isHlsPlaylistUrl("https://example.com/video/master.m3u8"), true);
  assert.equal(isHlsPlaylistUrl("https://example.com/video/MASTER.M3U8?token=secret"), true);
});

test("m3u8で終わらないパスと不正なURLを除外する", () => {
  assert.equal(isHlsPlaylistUrl("https://example.com/video/master.m3u8.ts"), false);
  assert.equal(isHlsPlaylistUrl("not-a-url"), false);
});

test("候補をタブごとに分離し、同じURLを重複させない", () => {
  const store = new CandidateStore();

  store.add(1, "https://example.com/one.m3u8", 1);
  store.add(1, "https://example.com/one.m3u8", 2);
  store.add(2, "https://example.com/two.m3u8", 3);

  assert.deepEqual(store.list(1), [{ url: "https://example.com/one.m3u8", detectedAt: 2 }]);
  assert.deepEqual(store.list(2), [{ url: "https://example.com/two.m3u8", detectedAt: 3 }]);
});

test("上限を超えた場合は最も古く追加した候補を除く", () => {
  const store = new CandidateStore(2);

  store.add(1, "https://example.com/one.m3u8", 1);
  store.add(1, "https://example.com/two.m3u8", 2);
  store.add(1, "https://example.com/three.m3u8", 3);

  assert.deepEqual(store.list(1), [
    { url: "https://example.com/two.m3u8", detectedAt: 2 },
    { url: "https://example.com/three.m3u8", detectedAt: 3 },
  ]);
});

test("タブを閉じた場合は候補を削除する", () => {
  const store = new CandidateStore();
  store.add(1, "https://example.com/one.m3u8");

  store.deleteTab(1);

  assert.deepEqual(store.list(1), []);
});
