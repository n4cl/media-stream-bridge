import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { constants } from "node:fs";
import test from "node:test";

import {
  createFfmpegSpawner,
  createOutputDirectoryPreparer,
  createOutputFileExists,
  isAllowedHlsUrl,
  isAllowedOutputFileName,
  isAllowedSaveDestination,
  MAX_OUTPUT_FILE_NAME_BYTES,
  normalizeOutputFileName,
  resolveOutputDirectory,
  startSaveStream,
} from "../build/native-host/src/save-stream.js";

test("HostはHTTP(S) HLS URLだけを許可する", () => {
  assert.equal(isAllowedHlsUrl("https://example.com/master.m3u8?token=secret"), true);
  assert.equal(isAllowedHlsUrl("file:///tmp/master.m3u8"), false);
  assert.equal(isAllowedHlsUrl("https://example.com/video.mp4"), false);
});

test("Hostは入力名をmp4のbasenameへ正規化して制限する", () => {
  assert.equal(normalizeOutputFileName("episode-01"), "episode-01.mp4");
  assert.equal(normalizeOutputFileName("episode-01.mp4"), "episode-01.mp4");
  assert.equal(normalizeOutputFileName("episode.mkv"), "episode.mkv.mp4");
  assert.equal(isAllowedOutputFileName("episode-01"), true);
  assert.equal(isAllowedOutputFileName("episode-01.mp4"), true);
  assert.equal(isAllowedOutputFileName("episode.mkv"), true);
  for (const value of [
    "",
    " episode.mp4",
    "episode.mp4 ",
    ".episode.mp4",
    "dir/episode.mp4",
    "dir\\episode.mp4",
    "episode\u0001.mp4",
    `${"a".repeat(MAX_OUTPUT_FILE_NAME_BYTES)}.mp4`,
    "a".repeat(MAX_OUTPUT_FILE_NAME_BYTES),
  ]) {
    assert.equal(isAllowedOutputFileName(value), false, value);
  }
});

test("Hostは許可した保存先IDだけをホームディレクトリ基準の保存先へ解決する", () => {
  assert.equal(isAllowedSaveDestination("movies"), true);
  assert.equal(isAllowedSaveDestination("downloads"), true);
  assert.equal(isAllowedSaveDestination("/tmp"), false);
  assert.equal(
    resolveOutputDirectory("movies", "/Users/test"),
    "/Users/test/Movies/Media Stream Bridge",
  );
  assert.equal(
    resolveOutputDirectory("downloads", "/Users/test"),
    "/Users/test/Downloads/Media Stream Bridge",
  );
});

test("Hostは保存先を作成後に書込み可能か確認する", async () => {
  const calls = [];
  const prepareDirectory = createOutputDirectoryPreparer(
    async (directory) => calls.push(`mkdir:${directory}`),
    async (directory, mode) => calls.push(`access:${directory}:${mode}`),
  );
  await prepareDirectory("/safe/output");
  assert.deepEqual(calls, ["mkdir:/safe/output", `access:/safe/output:${constants.W_OK}`]);

  const unavailableDirectory = createOutputDirectoryPreparer(
    async () => {},
    async () => {
      throw new Error("not writable");
    },
  );
  await assert.rejects(unavailableDirectory("/safe/output"));
});

test("Hostは選択した保存先内で途中ファイルを公開し、保存先の準備失敗を構造化する", async () => {
  const child = new EventEmitter();
  const calls = [];
  const started = await startSaveStream(
    "https://example.com/master.m3u8",
    {
      makeDirectory: async (directory) => calls.push(`mkdir:${directory}`),
      outputFileExists: async () => false,
      removeFile: async (file) => calls.push(`remove:${file}`),
      publishFile: async (temporaryFile, outputFile) =>
        calls.push(`publish:${temporaryFile}:${outputFile}`),
      spawnFfmpeg: (args) => {
        calls.push(`spawn:${args.at(-1)}`);
        return child;
      },
      createSaveId: () => "unique-id",
      outputDirectoryForDestination: (destination) => `/safe/${destination}`,
    },
    undefined,
    "downloads",
  );
  child.emit("close", 0);
  await started.completed;
  assert.deepEqual(calls, [
    "mkdir:/safe/downloads",
    "spawn:/safe/downloads/.media-stream-unique-id.partial.mp4",
    "publish:/safe/downloads/.media-stream-unique-id.partial.mp4:/safe/downloads/media-stream-unique-id.mp4",
    "remove:/safe/downloads/.media-stream-unique-id.partial.mp4",
  ]);

  await assert.rejects(
    startSaveStream(
      "https://example.com/master.m3u8",
      {
        makeDirectory: async () => {
          throw new Error("permission denied");
        },
        outputFileExists: async () => false,
        removeFile: async () => {},
        publishFile: async () => {},
        spawnFfmpeg: () => new EventEmitter(),
        createSaveId: () => "unique-id",
        outputDirectoryForDestination: () => "/safe/downloads",
      },
      undefined,
      "downloads",
    ),
    { code: "output-directory-unavailable" },
  );
});

test("Hostは未知の保存先をffmpeg起動前に拒否する", async () => {
  let spawned = false;
  await assert.rejects(
    startSaveStream(
      "https://example.com/master.m3u8",
      {
        makeDirectory: async () => {},
        outputFileExists: async () => false,
        removeFile: async () => {},
        publishFile: async () => {},
        spawnFfmpeg: () => {
          spawned = true;
          return new EventEmitter();
        },
        createSaveId: () => "unique-id",
        outputDirectory: "/safe/output",
      },
      undefined,
      "elsewhere",
    ),
    { code: "invalid-save-destination" },
  );
  assert.equal(spawned, false);
});

test("Hostは入力名へmp4を付与し、未指定時はDownloadsを使う", async () => {
  const destinations = [];
  const dependencies = {
    makeDirectory: async () => {},
    outputFileExists: async () => false,
    removeFile: async () => {},
    publishFile: async () => {},
    spawnFfmpeg: () => new EventEmitter(),
    createSaveId: () => "unique-id",
    outputDirectoryForDestination: (destination) => {
      destinations.push(destination);
      return `/safe/${destination}`;
    },
  };
  const hlsUrl = "https://example.com/master.m3u8";
  assert.equal(
    (await startSaveStream(hlsUrl, dependencies, "test")).outputFile,
    "/safe/downloads/test.mp4",
  );
  assert.equal(
    (await startSaveStream(hlsUrl, dependencies, "test.mp4")).outputFile,
    "/safe/downloads/test.mp4",
  );
  assert.equal(
    (await startSaveStream(hlsUrl, dependencies, "foo.mkv")).outputFile,
    "/safe/downloads/foo.mkv.mp4",
  );
  assert.equal(
    (await startSaveStream(hlsUrl, dependencies)).outputFile,
    "/safe/downloads/media-stream-unique-id.mp4",
  );
  assert.equal(
    (await startSaveStream(hlsUrl, dependencies, undefined, "movies")).outputFile,
    "/safe/movies/media-stream-unique-id.mp4",
  );
  assert.deepEqual(destinations, ["downloads", "downloads", "downloads", "downloads", "movies"]);
});

test("Hostは指定名へ排他的に公開してから途中ファイルを削除する", async () => {
  const child = new EventEmitter();
  const calls = [];
  const started = await startSaveStream(
    "https://example.com/master.m3u8",
    {
      makeDirectory: async () => {},
      outputFileExists: async () => false,
      removeFile: async (file) => calls.push(`remove:${file}`),
      publishFile: async (temporaryFile, outputFile) =>
        calls.push(`publish:${temporaryFile}:${outputFile}`),
      spawnFfmpeg: (args) => {
        calls.push(`spawn:${args.at(-1)}`);
        return child;
      },
      createSaveId: () => "unique-id",
      outputDirectory: "/safe/output",
    },
    "episode-01.mp4",
  );
  assert.equal(started.outputFile, "/safe/output/episode-01.mp4");
  child.emit("close", 0);
  await started.completed;
  assert.deepEqual(calls, [
    "spawn:/safe/output/.media-stream-unique-id.partial.mp4",
    "publish:/safe/output/.media-stream-unique-id.partial.mp4:/safe/output/episode-01.mp4",
    "remove:/safe/output/.media-stream-unique-id.partial.mp4",
  ]);
});

test("Hostは既存の最終ファイルをffmpeg起動前に拒否する", async () => {
  const calls = [];
  await assert.rejects(
    startSaveStream(
      "https://example.com/master.m3u8",
      {
        makeDirectory: async (directory) => calls.push(`mkdir:${directory}`),
        outputFileExists: async (file) => {
          calls.push(`exists:${file}`);
          return true;
        },
        removeFile: async (file) => calls.push(`remove:${file}`),
        publishFile: async () => calls.push("publish"),
        spawnFfmpeg: () => {
          calls.push("spawn");
          return new EventEmitter();
        },
        createSaveId: () => "unique-id",
        outputDirectory: "/safe/output",
      },
      "episode-01.mp4",
    ),
    { code: "output-file-exists" },
  );
  assert.deepEqual(calls, ["mkdir:/safe/output", "exists:/safe/output/episode-01.mp4"]);
});

test("Hostは公開失敗を同名競合と内部エラーに区別し、途中ファイルだけを後始末する", async () => {
  const run = async (publishError, removeError) => {
    const child = new EventEmitter();
    const removed = [];
    const started = await startSaveStream("https://example.com/master.m3u8", {
      makeDirectory: async () => {},
      outputFileExists: async () => false,
      removeFile: async (file) => {
        removed.push(file);
        if (removeError) {
          throw removeError;
        }
      },
      publishFile: async () => {
        throw publishError;
      },
      spawnFfmpeg: () => child,
      createSaveId: () => "unique-id",
      outputDirectory: "/safe/output",
    });
    child.emit("close", 0);
    return { completed: started.completed, removed };
  };

  const existsError = new Error("exists");
  existsError.code = "EEXIST";
  const existing = await run(existsError);
  await assert.rejects(existing.completed, { code: "output-file-exists" });
  assert.deepEqual(existing.removed, ["/safe/output/.media-stream-unique-id.partial.mp4"]);

  const failedPublish = await run(new Error("publish failed"));
  await assert.rejects(failedPublish.completed, { code: "internal-error" });
  assert.deepEqual(failedPublish.removed, ["/safe/output/.media-stream-unique-id.partial.mp4"]);

  const failedCleanup = await run(new Error("publish failed"), new Error("cleanup failed"));
  await assert.rejects(failedCleanup.completed, { code: "internal-error" });
  assert.deepEqual(failedCleanup.removed, ["/safe/output/.media-stream-unique-id.partial.mp4"]);
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
    publishFile: async () => {},
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
    "/safe/output/.media-stream-unique-id.partial.mp4",
  ]);
  child.emit("close", 0);
  await started.completed;
  assert.equal(removedOutputFile, "/safe/output/.media-stream-unique-id.partial.mp4");
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
  assert.equal(await missing("/safe/output/.media-stream-unique-id.partial.mp4"), false);

  const inaccessible = createOutputFileExists(async () => {
    const error = new Error("inaccessible");
    error.code = "EACCES";
    throw error;
  });
  await assert.rejects(inaccessible("/safe/output/.media-stream-unique-id.partial.mp4"), {
    code: "EACCES",
  });
});

test("Hostは最終ファイルを確認できない場合にffmpegを起動しない", async () => {
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
    { code: "output-directory-unavailable" },
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
    "exists",
    "spawn",
    "remove:/safe/output/.media-stream-unique-id.partial.mp4",
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
    publishFile: async () => {
      const error = new Error("already exists");
      error.code = "EEXIST";
      throw error;
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
    publishFile: async () => {},
    spawnFfmpeg: () => child,
    createSaveId: () => "unique-id",
    outputDirectory: "/safe/output",
  });

  child.emit("close", 1);
  await assert.rejects(started.completed, { code: "ffmpeg-exit" });
  assert.equal(removedOutputFile, "/safe/output/.media-stream-unique-id.partial.mp4");
});

test("Hostは同名競合で既存ファイルを上書きせず、今回の途中ファイルだけを削除する", async () => {
  const child = new EventEmitter();
  const removed = [];
  const started = await startSaveStream("https://example.com/master.m3u8", {
    makeDirectory: async () => {},
    outputFileExists: async () => false,
    removeFile: async (file) => {
      removed.push(file);
    },
    publishFile: async () => {
      const error = new Error("already exists");
      error.code = "EEXIST";
      throw error;
    },
    spawnFfmpeg: () => child,
    createSaveId: () => "unique-id",
    outputDirectory: "/safe/output",
  });

  child.emit("close", 0);
  await assert.rejects(started.completed, { code: "output-file-exists" });
  assert.deepEqual(removed, ["/safe/output/.media-stream-unique-id.partial.mp4"]);
});

test("Hostは後始末に失敗した場合に内部エラーとして失敗させる", async () => {
  const child = new EventEmitter();
  const started = await startSaveStream("https://example.com/master.m3u8", {
    makeDirectory: async () => {},
    outputFileExists: async () => false,
    removeFile: async () => {
      throw new Error("cannot remove");
    },
    publishFile: async () => {},
    spawnFfmpeg: () => child,
    createSaveId: () => "unique-id",
    outputDirectory: "/safe/output",
  });

  child.emit("close", null);
  await assert.rejects(started.completed, { code: "internal-error" });
});

test("Hostはキャンセル時にffmpeg終了と後始末の完了後にcancelledとする", async () => {
  const child = new EventEmitter();
  let killed = false;
  child.kill = () => {
    killed = true;
    return true;
  };
  let finishCleanup;
  const cleanup = new Promise((resolve) => {
    finishCleanup = resolve;
  });
  const removed = [];
  const started = await startSaveStream("https://example.com/master.m3u8", {
    makeDirectory: async () => {},
    outputFileExists: async () => false,
    removeFile: async (file) => {
      removed.push(file);
      await cleanup;
    },
    publishFile: async () => {},
    spawnFfmpeg: () => child,
    createSaveId: () => "unique-id",
    outputDirectory: "/safe/output",
  });

  assert.deepEqual(started.cancel(), { ok: true });
  assert.equal(killed, true);
  child.emit("close", null);
  assert.deepEqual(removed, ["/safe/output/.media-stream-unique-id.partial.mp4"]);

  let completed = false;
  void started.completed.then(() => {
    completed = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completed, false);

  finishCleanup();
  assert.equal(await started.completed, "cancelled");
});

test("Hostは終了要求中に非0終了してもキャンセルとして後始末する", async () => {
  const child = new EventEmitter();
  child.kill = () => {
    child.emit("close", null);
    return true;
  };
  let cleanupCalls = 0;
  const started = await startSaveStream("https://example.com/master.m3u8", {
    makeDirectory: async () => {},
    outputFileExists: async () => false,
    removeFile: async () => {
      cleanupCalls += 1;
    },
    publishFile: async () => {},
    spawnFfmpeg: () => child,
    createSaveId: () => "unique-id",
    outputDirectory: "/safe/output",
  });

  assert.deepEqual(started.cancel(), { ok: true });
  assert.equal(await started.completed, "cancelled");
  assert.equal(cleanupCalls, 1);
});

test("Hostはキャンセルと正常終了が競合した場合に完成ファイルを維持する", async () => {
  const child = new EventEmitter();
  child.kill = () => true;
  let removed = false;
  const started = await startSaveStream("https://example.com/master.m3u8", {
    makeDirectory: async () => {},
    outputFileExists: async () => false,
    removeFile: async () => {
      removed = true;
    },
    publishFile: async () => {},
    spawnFfmpeg: () => child,
    createSaveId: () => "unique-id",
    outputDirectory: "/safe/output",
  });

  assert.deepEqual(started.cancel(), { ok: true });
  child.emit("close", 0);
  assert.equal(await started.completed, "completed");
  assert.equal(removed, true);
});

test("Hostは終了要求に失敗した場合に途中ファイルを削除せず元の終了を待つ", async () => {
  const child = new EventEmitter();
  child.kill = () => false;
  let removed = false;
  const started = await startSaveStream("https://example.com/master.m3u8", {
    makeDirectory: async () => {},
    outputFileExists: async () => false,
    removeFile: async () => {
      removed = true;
    },
    publishFile: async () => {},
    spawnFfmpeg: () => child,
    createSaveId: () => "unique-id",
    outputDirectory: "/safe/output",
  });

  assert.deepEqual(started.cancel(), { ok: false, code: "save-not-cancellable" });
  assert.equal(removed, false);
  child.emit("close", 0);
  assert.equal(await started.completed, "completed");
  assert.equal(removed, true);
});

test("Hostは終了要求が例外でも途中ファイルを削除せず元の終了を待つ", async () => {
  const child = new EventEmitter();
  child.kill = () => {
    throw new Error("kill failed");
  };
  let removed = false;
  const started = await startSaveStream("https://example.com/master.m3u8", {
    makeDirectory: async () => {},
    outputFileExists: async () => false,
    removeFile: async () => {
      removed = true;
    },
    publishFile: async () => {},
    spawnFfmpeg: () => child,
    createSaveId: () => "unique-id",
    outputDirectory: "/safe/output",
  });

  assert.deepEqual(started.cancel(), { ok: false, code: "cancel-failed" });
  assert.equal(removed, false);
  child.emit("close", 0);
  assert.equal(await started.completed, "completed");
  assert.equal(removed, true);
});

test("Hostはキャンセル後のerror終端も一度だけ後始末する", async () => {
  const child = new EventEmitter();
  child.kill = () => true;
  let removeCount = 0;
  const started = await startSaveStream("https://example.com/master.m3u8", {
    makeDirectory: async () => {},
    outputFileExists: async () => false,
    removeFile: async () => {
      removeCount += 1;
    },
    publishFile: async () => {},
    spawnFfmpeg: () => child,
    createSaveId: () => "unique-id",
    outputDirectory: "/safe/output",
  });

  assert.deepEqual(started.cancel(), { ok: true });
  child.emit("error");
  assert.equal(removeCount, 0);
  child.emit("close", 1);
  assert.equal(await started.completed, "cancelled");
  assert.equal(removeCount, 1);
});
