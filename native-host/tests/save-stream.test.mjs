import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  createFfmpegSpawner,
  createOutputFileExists,
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
  let removedOutputFile;
  const started = await startSaveStream("https://example.com/master.m3u8", {
    makeDirectory: async () => {},
    outputFileExists: async () => false,
    removeFile: async (file) => {
      removedOutputFile = file;
    },
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
  assert.equal(removedOutputFile, undefined);
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

test("Hostは出力ファイルの不存在だけを削除可能と判断する", async () => {
  const missing = createOutputFileExists(async () => {
    const error = new Error("missing");
    error.code = "ENOENT";
    throw error;
  });
  assert.equal(await missing("/safe/output/media-stream-unique-id.mp4"), false);

  const inaccessible = createOutputFileExists(async () => {
    const error = new Error("inaccessible");
    error.code = "EACCES";
    throw error;
  });
  await assert.rejects(inaccessible("/safe/output/media-stream-unique-id.mp4"), { code: "EACCES" });
});

test("Hostは出力ファイルを確認できない場合にffmpegを起動しない", async () => {
  let spawned = false;
  await assert.rejects(
    startSaveStream("https://example.com/master.m3u8", {
      makeDirectory: async () => {},
      outputFileExists: async () => {
        const error = new Error("inaccessible");
        error.code = "EACCES";
        throw error;
      },
      removeFile: async () => {},
      spawnFfmpeg: () => {
        spawned = true;
        return new EventEmitter();
      },
      createSaveId: () => "unique-id",
      outputDirectory: "/safe/output",
    }),
    { code: "EACCES" },
  );
  assert.equal(spawned, false);
});

test("Hostはffmpegの同期的な起動失敗後に出力ファイルを削除する", async () => {
  const calls = [];
  await assert.rejects(
    startSaveStream("https://example.com/master.m3u8", {
      makeDirectory: async () => calls.push("make-directory"),
      outputFileExists: async () => {
        calls.push("exists");
        return false;
      },
      removeFile: async (file) => calls.push(`remove:${file}`),
      spawnFfmpeg: () => {
        calls.push("spawn");
        throw new Error("missing");
      },
      createSaveId: () => "unique-id",
      outputDirectory: "/safe/output",
    }),
    { code: "ffmpeg-start-failed" },
  );
  assert.deepEqual(calls, [
    "make-directory",
    "exists",
    "spawn",
    "remove:/safe/output/media-stream-unique-id.mp4",
  ]);
});

test("Hostは非同期の失敗後に一度だけ後始末してから完了Promiseを失敗させる", async () => {
  const child = new EventEmitter();
  let releaseCleanup;
  let removeCount = 0;
  const cleanup = new Promise((resolve) => {
    releaseCleanup = resolve;
  });
  const started = await startSaveStream("https://example.com/master.m3u8", {
    makeDirectory: async () => {},
    outputFileExists: async () => false,
    removeFile: async () => {
      removeCount += 1;
      await cleanup;
    },
    spawnFfmpeg: () => child,
    createSaveId: () => "unique-id",
    outputDirectory: "/safe/output",
  });

  child.emit("error");
  child.emit("close", 1);
  assert.equal(removeCount, 1);

  let completed = false;
  void started.completed.catch(() => {
    completed = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completed, false);

  releaseCleanup();
  await assert.rejects(started.completed, { code: "ffmpeg-start-failed" });
  assert.equal(removeCount, 1);
});

test("Hostは非0終了後に出力ファイルを削除する", async () => {
  const child = new EventEmitter();
  let removedOutputFile;
  const started = await startSaveStream("https://example.com/master.m3u8", {
    makeDirectory: async () => {},
    outputFileExists: async () => false,
    removeFile: async (file) => {
      removedOutputFile = file;
    },
    spawnFfmpeg: () => child,
    createSaveId: () => "unique-id",
    outputDirectory: "/safe/output",
  });

  child.emit("close", 1);
  await assert.rejects(started.completed, { code: "ffmpeg-exit" });
  assert.equal(removedOutputFile, "/safe/output/media-stream-unique-id.mp4");
});

test("Hostは既存の同名出力ファイルを削除しない", async () => {
  const child = new EventEmitter();
  let removeCount = 0;
  const started = await startSaveStream("https://example.com/master.m3u8", {
    makeDirectory: async () => {},
    outputFileExists: async () => true,
    removeFile: async () => {
      removeCount += 1;
    },
    spawnFfmpeg: () => child,
    createSaveId: () => "unique-id",
    outputDirectory: "/safe/output",
  });

  child.emit("close", 1);
  await assert.rejects(started.completed, { code: "ffmpeg-exit" });
  assert.equal(removeCount, 0);
});

test("Hostは後始末に失敗した場合に内部エラーとして失敗させる", async () => {
  const child = new EventEmitter();
  const started = await startSaveStream("https://example.com/master.m3u8", {
    makeDirectory: async () => {},
    outputFileExists: async () => false,
    removeFile: async () => {
      throw new Error("cannot remove");
    },
    spawnFfmpeg: () => child,
    createSaveId: () => "unique-id",
    outputDirectory: "/safe/output",
  });

  child.emit("close", null);
  await assert.rejects(started.completed, { code: "internal-error" });
});
