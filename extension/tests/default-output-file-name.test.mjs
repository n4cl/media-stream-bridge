import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultOutputFileName } from "../build/extension/src/popup/default-output-file-name.js";

test("ページタイトルとローカル日時から既定のファイル名を生成する", () => {
  const savedAt = new Date(2026, 8, 3, 9, 5, 7);
  assert.equal(createDefaultOutputFileName("Episode 1", savedAt), "Episode 1_20260903090507.mp4");
});

test("使用できない文字を置換し、前後の空白と先頭のピリオドを除く", () => {
  const savedAt = new Date(2026, 8, 3, 9, 5, 7);
  const fileName = createDefaultOutputFileName("  ../Season\\Episode\n1  ", savedAt);
  assert.equal(fileName, "_Season_Episode_1_20260903090507.mp4");
});

test("UTF-8で最終名が240 byte以下になるよう長いタイトルを切り詰める", () => {
  const fileName = createDefaultOutputFileName("動画".repeat(100), new Date(2026, 8, 3));
  assert.ok(fileName);
  assert.ok(Buffer.byteLength(fileName, "utf8") <= 240);
  assert.match(fileName, /_20260903000000\.mp4$/);
});

test("タイトルを取得できない、または安全な名前が残らない場合は名前を生成しない", () => {
  const savedAt = new Date(2026, 8, 3);
  assert.equal(createDefaultOutputFileName(undefined, savedAt), undefined);
  assert.equal(createDefaultOutputFileName("  ...  ", savedAt), undefined);
  assert.equal(createDefaultOutputFileName("Title", new Date(Number.NaN)), undefined);
});
