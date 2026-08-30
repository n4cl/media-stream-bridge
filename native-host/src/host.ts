import { isAbsolute } from "node:path";
import process from "node:process";
import type { Readable } from "node:stream";
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

export const TERMINAL_DISCONNECT_GRACE_MS = 5_000;

export interface DisconnectWaitScheduler {
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(timeout: ReturnType<typeof setTimeout>): void;
}

export interface DisconnectInput {
  readonly readableEnded: boolean;
  once(event: "end" | "close" | "error", listener: () => void): unknown;
  off(event: "end" | "close" | "error", listener: () => void): unknown;
}

const defaultDisconnectWaitScheduler: DisconnectWaitScheduler = {
  setTimeout,
  clearTimeout,
};

export function waitForStdinDisconnect(
  input: DisconnectInput,
  timeoutMs = TERMINAL_DISCONNECT_GRACE_MS,
  scheduler: DisconnectWaitScheduler = defaultDisconnectWaitScheduler,
): Promise<void> {
  if (input.readableEnded) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      if (timeout !== undefined) {
        scheduler.clearTimeout(timeout);
      }
      input.off("end", finish);
      input.off("close", finish);
      input.off("error", finish);
      resolve();
    };

    input.once("end", finish);
    input.once("close", finish);
    input.once("error", finish);
    timeout = scheduler.setTimeout(finish, timeoutMs);
  });
}

export interface NativeHostDependencies {
  readMessage(): Promise<unknown | undefined>;
  writeMessage(value: unknown): Promise<void>;
  startSave(hlsUrl: string, ffmpegPath: string): Promise<StartedSave>;
  waitForDisconnect(): Promise<void>;
}

function defaultDependencies(): NativeHostDependencies {
  return {
    readMessage: () => readNativeMessage(process.stdin),
    writeMessage: (value) => writeNativeMessage(process.stdout, value),
    startSave: (hlsUrl, ffmpegPath) =>
      startSaveStream(hlsUrl, createDefaultDependencies(ffmpegPath)),
    waitForDisconnect: () => waitForStdinDisconnect(process.stdin as Readable),
  };
}

async function writeTerminalResponse(
  dependencies: NativeHostDependencies,
  response:
    | {
        version: typeof NATIVE_MESSAGE_VERSION;
        type: "save:completed";
        saveId: string;
        outputFile: string;
      }
    | {
        version: typeof NATIVE_MESSAGE_VERSION;
        type: "save:failed";
        code: "invalid-request" | "ffmpeg-start-failed" | "ffmpeg-exit" | "internal-error";
      },
): Promise<void> {
  await dependencies.writeMessage(response);
  await dependencies.waitForDisconnect();
}

export async function runNativeHost(
  ffmpegPath = process.argv[2],
  dependencies: NativeHostDependencies = defaultDependencies(),
): Promise<void> {
  let request: unknown;
  try {
    request = await dependencies.readMessage();
  } catch {
    await writeTerminalResponse(dependencies, {
      version: NATIVE_MESSAGE_VERSION,
      type: "save:failed",
      code: "invalid-request",
    });
    return;
  }

  if (!isSaveStreamRequest(request) || !isAllowedHlsUrl(request.hlsUrl)) {
    await writeTerminalResponse(dependencies, {
      version: NATIVE_MESSAGE_VERSION,
      type: "save:failed",
      code: "invalid-request",
    });
    return;
  }

  if (typeof ffmpegPath !== "string" || !isAbsolute(ffmpegPath)) {
    await writeTerminalResponse(dependencies, {
      version: NATIVE_MESSAGE_VERSION,
      type: "save:failed",
      code: "internal-error",
    });
    return;
  }

  let started: StartedSave;
  try {
    started = await dependencies.startSave(request.hlsUrl, ffmpegPath);
  } catch (error) {
    const code = error instanceof SaveStreamError ? error.code : "internal-error";
    await writeTerminalResponse(dependencies, {
      version: NATIVE_MESSAGE_VERSION,
      type: "save:failed",
      code,
    });
    return;
  }

  await dependencies.writeMessage({
    version: NATIVE_MESSAGE_VERSION,
    type: "save:started",
    saveId: started.saveId,
  });
  try {
    await started.completed;
  } catch (error) {
    const code = error instanceof SaveStreamError ? error.code : "internal-error";
    await writeTerminalResponse(dependencies, {
      version: NATIVE_MESSAGE_VERSION,
      type: "save:failed",
      code,
    });
    return;
  }

  await writeTerminalResponse(dependencies, {
    version: NATIVE_MESSAGE_VERSION,
    type: "save:completed",
    saveId: started.saveId,
    outputFile: started.outputFile,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runNativeHost();
}
