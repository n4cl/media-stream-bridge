import { isAbsolute } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { isSaveStreamRequest, NATIVE_MESSAGE_VERSION } from "../../contracts/native-messages.js";
import { readNativeMessage, writeNativeMessage } from "./framing.js";
import {
  createDefaultDependencies,
  isAllowedHlsUrl,
  SaveStreamError,
  type StartedSave,
  startSaveStream,
} from "./save-stream.js";

export interface NativeHostDependencies {
  readMessage(): Promise<unknown | undefined>;
  writeMessage(value: unknown): Promise<void>;
  startSave(hlsUrl: string, ffmpegPath: string): Promise<StartedSave>;
}

function defaultDependencies(): NativeHostDependencies {
  return {
    readMessage: () => readNativeMessage(process.stdin),
    writeMessage: (value) => writeNativeMessage(process.stdout, value),
    startSave: (hlsUrl, ffmpegPath) =>
      startSaveStream(hlsUrl, createDefaultDependencies(ffmpegPath)),
  };
}

export async function runNativeHost(
  ffmpegPath = process.argv[2],
  dependencies: NativeHostDependencies = defaultDependencies(),
): Promise<void> {
  let request: unknown;
  try {
    request = await dependencies.readMessage();
  } catch {
    await dependencies.writeMessage({
      version: NATIVE_MESSAGE_VERSION,
      type: "save:failed",
      code: "invalid-request",
    });
    return;
  }

  if (!isSaveStreamRequest(request) || !isAllowedHlsUrl(request.hlsUrl)) {
    await dependencies.writeMessage({
      version: NATIVE_MESSAGE_VERSION,
      type: "save:failed",
      code: "invalid-request",
    });
    return;
  }

  if (typeof ffmpegPath !== "string" || !isAbsolute(ffmpegPath)) {
    await dependencies.writeMessage({
      version: NATIVE_MESSAGE_VERSION,
      type: "save:failed",
      code: "internal-error",
    });
    return;
  }

  try {
    const started = await dependencies.startSave(request.hlsUrl, ffmpegPath);
    await dependencies.writeMessage({
      version: NATIVE_MESSAGE_VERSION,
      type: "save:started",
      saveId: started.saveId,
    });
    await started.completed;
    await dependencies.writeMessage({
      version: NATIVE_MESSAGE_VERSION,
      type: "save:completed",
      saveId: started.saveId,
      outputFile: started.outputFile,
    });
  } catch (error) {
    const code = error instanceof SaveStreamError ? error.code : "internal-error";
    await dependencies.writeMessage({
      version: NATIVE_MESSAGE_VERSION,
      type: "save:failed",
      code,
    });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runNativeHost();
}
