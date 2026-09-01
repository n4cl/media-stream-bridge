import { isAbsolute } from "node:path";
import process from "node:process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  isNativeHostRequest,
  isSaveStreamRequest,
  NATIVE_MESSAGE_VERSION,
} from "../../contracts/native-messages.js";
import { readNativeMessage, writeNativeMessage } from "./framing.js";
import {
  createDefaultDependencies,
  isAllowedHlsUrl,
  isAllowedOutputFileName,
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
  readMessage(signal?: AbortSignal): Promise<unknown | undefined>;
  writeMessage(value: unknown): Promise<void>;
  startSave(hlsUrl: string, ffmpegPath: string, outputFileName?: string): Promise<StartedSave>;
  waitForDisconnect(): Promise<void>;
}

function defaultDependencies(): NativeHostDependencies {
  return {
    readMessage: (signal) => readNativeMessage(process.stdin, signal),
    writeMessage: (value) => writeNativeMessage(process.stdout, value),
    startSave: (hlsUrl, ffmpegPath, outputFileName) =>
      startSaveStream(hlsUrl, createDefaultDependencies(ffmpegPath), outputFileName),
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
        type: "save:cancelled";
        saveId: string;
      }
    | {
        version: typeof NATIVE_MESSAGE_VERSION;
        type: "save:failed";
        code:
          | "invalid-request"
          | "invalid-output-file-name"
          | "output-file-exists"
          | "ffmpeg-start-failed"
          | "ffmpeg-exit"
          | "internal-error";
      },
): Promise<void> {
  await dependencies.writeMessage(response);
  await dependencies.waitForDisconnect();
}

type NativeInputResult = { kind: "message"; value: unknown | undefined } | { kind: "error" };

function readNextMessage(
  dependencies: NativeHostDependencies,
  signal: AbortSignal,
): Promise<NativeInputResult> {
  return dependencies.readMessage(signal).then(
    (value) => ({ kind: "message", value }),
    () => ({ kind: "error" }),
  );
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

  if (request.outputFileName !== undefined && !isAllowedOutputFileName(request.outputFileName)) {
    await writeTerminalResponse(dependencies, {
      version: NATIVE_MESSAGE_VERSION,
      type: "save:failed",
      code: "invalid-output-file-name",
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
    started = await dependencies.startSave(request.hlsUrl, ffmpegPath, request.outputFileName);
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
  const inputAbortController = new AbortController();
  let input = readNextMessage(dependencies, inputAbortController.signal);
  const completion = started.completed.then(
    (outcome) => ({ kind: "completed" as const, outcome }),
    (error) => ({ kind: "failed" as const, error }),
  );
  let boundaryViolation = false;

  while (true) {
    const next = await Promise.race([completion, input]);
    if (next.kind === "completed" || next.kind === "failed") {
      inputAbortController.abort();
      await input;

      if (boundaryViolation) {
        await writeTerminalResponse(dependencies, {
          version: NATIVE_MESSAGE_VERSION,
          type: "save:failed",
          code: "internal-error",
        });
        return;
      }

      if (next.kind === "failed") {
        const code = next.error instanceof SaveStreamError ? next.error.code : "internal-error";
        await writeTerminalResponse(dependencies, {
          version: NATIVE_MESSAGE_VERSION,
          type: "save:failed",
          code,
        });
        return;
      }

      if (next.outcome === "cancelled") {
        await writeTerminalResponse(dependencies, {
          version: NATIVE_MESSAGE_VERSION,
          type: "save:cancelled",
          saveId: started.saveId,
        });
        return;
      }

      await writeTerminalResponse(dependencies, {
        version: NATIVE_MESSAGE_VERSION,
        type: "save:completed",
        saveId: started.saveId,
        outputFile: started.outputFile,
      });
      return;
    }

    if (
      next.kind === "error" ||
      !isNativeHostRequest(next.value) ||
      next.value.type !== "save:cancel"
    ) {
      boundaryViolation = true;
      started.cancel();
      const terminal = await completion;
      inputAbortController.abort();
      await input;

      await writeTerminalResponse(dependencies, {
        version: NATIVE_MESSAGE_VERSION,
        type: "save:failed",
        code:
          terminal.kind === "failed" && terminal.error instanceof SaveStreamError
            ? terminal.error.code
            : "internal-error",
      });
      return;
    }

    if (next.value.saveId !== started.saveId) {
      await dependencies.writeMessage({
        version: NATIVE_MESSAGE_VERSION,
        type: "save:cancel-rejected",
        saveId: next.value.saveId,
        code: "save-id-mismatch",
      });
      input = readNextMessage(dependencies, inputAbortController.signal);
      continue;
    }

    const cancellation = started.cancel();
    if (!cancellation.ok) {
      await dependencies.writeMessage({
        version: NATIVE_MESSAGE_VERSION,
        type: "save:cancel-rejected",
        saveId: started.saveId,
        code: cancellation.code,
      });
    }
    input = readNextMessage(dependencies, inputAbortController.signal);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runNativeHost();
}
