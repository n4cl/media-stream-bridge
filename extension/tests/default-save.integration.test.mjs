import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { startSaveStream } from "../../native-host/build/native-host/src/save-stream.js";
import { isSaveStreamRequest } from "../build/contracts/native-messages.js";
import { createNativeSaveStartRequest } from "../build/extension/src/background/native-save-request.js";
import { createDefaultOutputFileName } from "../build/extension/src/popup/default-output-file-name.js";
import { createSaveRequest } from "../build/extension/src/popup/save-request.js";

test("ページタイトル由来の既定名をNative Hostの最終出力パスまで引き継ぐ", async () => {
  const hlsUrl = "https://example.com/master.m3u8";
  const outputFileName = createDefaultOutputFileName(
    "Season/1 Episode",
    new Date(2026, 8, 3, 9, 5, 7),
  );
  const popupRequest = createSaveRequest(7, hlsUrl, outputFileName);
  const nativeRequest = createNativeSaveStartRequest(
    popupRequest.hlsUrl,
    popupRequest.outputFileName,
    popupRequest.destination,
  );

  assert.equal(isSaveStreamRequest(nativeRequest), true);

  const dependencies = {
    makeDirectory: async () => {},
    outputFileExists: async () => false,
    removeFile: async () => {},
    publishFile: async () => {},
    spawnFfmpeg: () => new EventEmitter(),
    createSaveId: () => "save-id",
    outputDirectoryForDestination: (destination) => `/safe/${destination}`,
  };
  const started = await startSaveStream(
    nativeRequest.hlsUrl,
    dependencies,
    nativeRequest.outputFileName,
    nativeRequest.destination,
  );
  assert.equal(started.outputFile, "/safe/downloads/Season_1 Episode_20260903090507.mp4");

  await assert.rejects(
    startSaveStream(
      nativeRequest.hlsUrl,
      {
        ...dependencies,
        outputFileExists: async (file) => file === started.outputFile,
      },
      nativeRequest.outputFileName,
      nativeRequest.destination,
    ),
    { code: "output-file-exists" },
  );
});
