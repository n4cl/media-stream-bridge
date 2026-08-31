import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  createFfmpegSpawner,
  isAllowedHlsUrl,
  startSaveStream,
} from "../build/native-host/src/save-stream.js";

test("HostはHTTP(S) HLS URLだけを許可する", () => {
  assert.equal(isAllowedHlsUrl("https://example.com/master.m3u8?token=secret"), true);
  assert.equal(isAllowedHlsUrl("file:///tmp/master.m3u8"), false);
  assert.equal(isAllowedHlsUrl("https://example.com/video.mp4"), false);
});

test("Hostは固定したffmpeg引数と一意な出力名で保存を開始する", async () => {
  const child = new EventEmitter();
  let receivedArgs;
  const started = await startSaveStream("https://example.com/master.m3u8", {
    makeDirectory: async () => {},
    spawnFfmpeg: (args) => {
      receivedArgs = args;
      return child;
    },
    createSaveId: () => "unique-id",
    outputDirectory: "/safe/output",
  });

  assert.deepEqual(receivedArgs, [
    "-nostdin",
    "-i",
    "https://example.com/master.m3u8",
    "-c",
    "copy",
    "-n",
    "/safe/output/media-stream-unique-id.mp4",
  ]);
  child.emit("close", 0);
  await started.completed;
});

test("Hostはインストーラが確定したffmpeg絶対パスをshellなしで起動する", () => {
  const child = new EventEmitter();
  let command;
  let options;
  const spawnFfmpeg = createFfmpegSpawner(
    "/opt/homebrew/bin/ffmpeg",
    (receivedCommand, _args, receivedOptions) => {
      command = receivedCommand;
      options = receivedOptions;
      return child;
    },
  );
  spawnFfmpeg(["-version"]);
  assert.equal(command, "/opt/homebrew/bin/ffmpeg");
  assert.deepEqual(options, { shell: false, stdio: ["ignore", "ignore", "ignore"] });
  assert.throws(() => createFfmpegSpawner("ffmpeg"), /must be absolute/);
});

test("Hostはffmpeg起動失敗を構造化できるエラーへ変換する", async () => {
  await assert.rejects(
    startSaveStream("https://example.com/master.m3u8", {
      makeDirectory: async () => {},
      spawnFfmpeg: () => {
        throw new Error("missing");
      },
      createSaveId: () => "unique-id",
      outputDirectory: "/safe/output",
    }),
    { code: "ffmpeg-start-failed" },
  );
});
