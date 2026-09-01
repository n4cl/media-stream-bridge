import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, link, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import type { SaveDestination } from "../../contracts/native-messages.js";

export interface SpawnedProcess {
  once(event: "error", listener: () => void): ChildProcess;
  once(event: "close", listener: (code: number | null) => void): ChildProcess;
  kill(): boolean;
}

export interface SaveStreamDependencies {
  makeDirectory(path: string): Promise<void>;
  outputFileExists(path: string): Promise<boolean>;
  removeFile(path: string): Promise<void>;
  publishFile(temporaryFile: string, outputFile: string): Promise<void>;
  spawnFfmpeg(args: string[]): SpawnedProcess;
  createSaveId(): string;
  outputDirectory?: string;
  outputDirectoryForDestination?: (destination: SaveDestination) => string;
}

export class SaveStreamError extends Error {
  constructor(
    readonly code:
      | "invalid-output-file-name"
      | "invalid-save-destination"
      | "output-directory-unavailable"
      | "output-file-exists"
      | "ffmpeg-start-failed"
      | "ffmpeg-exit"
      | "internal-error",
    message: string,
  ) {
    super(message);
  }
}

export function isAllowedSaveDestination(value: string): value is SaveDestination {
  return value === "movies" || value === "downloads";
}

export function resolveOutputDirectory(
  destination: SaveDestination,
  homeDirectory = homedir(),
): string {
  return join(
    homeDirectory,
    destination === "movies" ? "Movies" : "Downloads",
    "Media Stream Bridge",
  );
}

export type SpawnProcess = (
  command: string,
  args: string[],
  options: { shell: false; stdio: ["ignore", "ignore", "ignore"] },
) => SpawnedProcess;

type FileAccess = (path: string, mode: number) => Promise<void>;
type MakeDirectory = (path: string) => Promise<void>;

export function createOutputDirectoryPreparer(
  makeDirectory: MakeDirectory = async (directory) => {
    await mkdir(directory, { recursive: true });
  },
  directoryAccess: FileAccess = access,
): MakeDirectory {
  return async (directory) => {
    await makeDirectory(directory);
    await directoryAccess(directory, constants.W_OK);
  };
}

export function createFfmpegSpawner(
  ffmpegPath: string,
  spawnProcess: SpawnProcess = spawn,
): (args: string[]) => SpawnedProcess {
  if (!isAbsolute(ffmpegPath)) {
    throw new Error("ffmpeg path must be absolute");
  }
  return (args) =>
    spawnProcess(ffmpegPath, args, { shell: false, stdio: ["ignore", "ignore", "ignore"] });
}

export function createOutputFileExists(
  fileAccess: FileAccess = access,
): (file: string) => Promise<boolean> {
  return async (file) => {
    try {
      await fileAccess(file, constants.F_OK);
      return true;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return false;
      }
      throw error;
    }
  };
}

export function createDefaultDependencies(ffmpegPath: string): SaveStreamDependencies {
  return {
    makeDirectory: createOutputDirectoryPreparer(),
    outputFileExists: createOutputFileExists(),
    removeFile: async (file) => {
      await rm(file, { force: true });
    },
    // link(2) is an exclusive publish operation: it fails with EEXIST instead of
    // replacing an existing final file. Both paths are in outputDirectory.
    publishFile: link,
    spawnFfmpeg: createFfmpegSpawner(ffmpegPath),
    createSaveId: randomUUID,
    outputDirectoryForDestination: (destination) => resolveOutputDirectory(destination),
  };
}

export function isAllowedHlsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.pathname.toLowerCase().endsWith(".m3u8")
    );
  } catch {
    return false;
  }
}

// macOS allows a 255-byte path component. Leave room below that limit so the
// same contract remains usable on filesystems with a slightly smaller limit.
export const MAX_OUTPUT_FILE_NAME_BYTES = 240;

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

export function isAllowedOutputFileName(value: string): boolean {
  const byteLength = Buffer.byteLength(value, "utf8");
  return (
    value.length > 0 &&
    byteLength <= MAX_OUTPUT_FILE_NAME_BYTES &&
    value.trim() === value &&
    !value.startsWith(".") &&
    value.toLowerCase().endsWith(".mp4") &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !hasControlCharacter(value) &&
    !isAbsolute(value)
  );
}

export interface StartedSave {
  saveId: string;
  outputFile: string;
  completed: Promise<"completed" | "cancelled">;
  cancel(): { ok: true } | { ok: false; code: "save-not-cancellable" | "cancel-failed" };
}

async function cleanupTemporarySave(
  temporaryFile: string,
  error: SaveStreamError,
  dependencies: SaveStreamDependencies,
): Promise<SaveStreamError> {
  try {
    await dependencies.removeFile(temporaryFile);
    return error;
  } catch {
    return new SaveStreamError("internal-error", "failed to remove incomplete output file");
  }
}

export async function startSaveStream(
  hlsUrl: string,
  dependencies: SaveStreamDependencies,
  outputFileName?: string,
  destination?: string,
): Promise<StartedSave> {
  if (!isAllowedHlsUrl(hlsUrl)) {
    throw new SaveStreamError("ffmpeg-exit", "The stream URL is not an HTTP(S) HLS playlist");
  }

  const saveId = dependencies.createSaveId();
  if (outputFileName !== undefined && !isAllowedOutputFileName(outputFileName)) {
    throw new SaveStreamError("invalid-output-file-name", "invalid output file name");
  }
  if (destination !== undefined && !isAllowedSaveDestination(destination)) {
    throw new SaveStreamError("invalid-save-destination", "invalid save destination");
  }
  const outputDirectory =
    dependencies.outputDirectoryForDestination?.(destination ?? "movies") ??
    dependencies.outputDirectory;
  if (outputDirectory === undefined) {
    throw new SaveStreamError("internal-error", "output directory is not configured");
  }
  const outputFile = join(outputDirectory, outputFileName ?? `media-stream-${saveId}.mp4`);
  const temporaryFile = join(outputDirectory, `.media-stream-${saveId}.partial.mp4`);
  try {
    await dependencies.makeDirectory(outputDirectory);
  } catch {
    throw new SaveStreamError("output-directory-unavailable", "output directory is unavailable");
  }
  let outputFileExists: boolean;
  try {
    outputFileExists = await dependencies.outputFileExists(outputFile);
  } catch {
    throw new SaveStreamError("output-directory-unavailable", "output directory is unavailable");
  }
  if (outputFileExists) {
    throw new SaveStreamError("output-file-exists", "output file already exists");
  }
  let temporaryFileExisted: boolean;
  try {
    temporaryFileExisted = await dependencies.outputFileExists(temporaryFile);
  } catch {
    throw new SaveStreamError("output-directory-unavailable", "output directory is unavailable");
  }
  if (temporaryFileExisted) {
    throw new SaveStreamError("internal-error", "temporary output file already exists");
  }

  const args = ["-nostdin", "-i", hlsUrl, "-c", "copy", "-n", temporaryFile];
  let child: SpawnedProcess;
  try {
    child = dependencies.spawnFfmpeg(args);
  } catch {
    throw await cleanupTemporarySave(
      temporaryFile,
      new SaveStreamError("ffmpeg-start-failed", "ffmpeg could not be started"),
      dependencies,
    );
  }
  let settled = false;
  let cancellationRequested = false;
  const completed = new Promise<"completed" | "cancelled">((resolve, reject) => {
    const fail = (error: SaveStreamError): void => {
      if (settled) {
        return;
      }
      settled = true;
      void cleanupTemporarySave(temporaryFile, error, dependencies).then(reject);
    };
    const cancel = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      void cleanupTemporarySave(
        temporaryFile,
        new SaveStreamError("ffmpeg-exit", "ffmpeg was cancelled"),
        dependencies,
      ).then(() => resolve("cancelled"), reject);
    };

    child.once("error", () => {
      if (cancellationRequested) {
        return;
      }
      fail(new SaveStreamError("ffmpeg-start-failed", "ffmpeg could not be started"));
    });
    child.once("close", (code: number | null) => {
      if (settled) {
        return;
      }
      if (code === 0) {
        settled = true;
        void dependencies.publishFile(temporaryFile, outputFile).then(
          async () => {
            try {
              await dependencies.removeFile(temporaryFile);
              resolve("completed");
            } catch {
              reject(
                new SaveStreamError("internal-error", "failed to remove temporary output file"),
              );
            }
          },
          async (error: unknown) => {
            const saveError =
              typeof error === "object" &&
              error !== null &&
              "code" in error &&
              error.code === "EEXIST"
                ? new SaveStreamError("output-file-exists", "output file already exists")
                : new SaveStreamError("internal-error", "failed to publish output file");
            reject(await cleanupTemporarySave(temporaryFile, saveError, dependencies));
          },
        );
        return;
      }
      if (cancellationRequested) {
        cancel();
        return;
      }
      fail(new SaveStreamError("ffmpeg-exit", "ffmpeg exited unsuccessfully"));
    });
  });

  const cancel = ():
    | { ok: true }
    | { ok: false; code: "save-not-cancellable" | "cancel-failed" } => {
    if (settled || cancellationRequested) {
      return { ok: false, code: "save-not-cancellable" };
    }
    cancellationRequested = true;
    try {
      if (!child.kill()) {
        if (!settled) {
          cancellationRequested = false;
        }
        return { ok: false, code: "save-not-cancellable" };
      }
    } catch {
      if (!settled) {
        cancellationRequested = false;
      }
      return { ok: false, code: "cancel-failed" };
    }
    return { ok: true };
  };

  return { saveId, outputFile, completed, cancel };
}

export async function saveStream(
  hlsUrl: string,
  dependencies: SaveStreamDependencies,
  outputFileName?: string,
  destination?: string,
): Promise<{ saveId: string; outputFile: string }> {
  const started = await startSaveStream(hlsUrl, dependencies, outputFileName, destination);
  await started.completed;
  return { saveId: started.saveId, outputFile: started.outputFile };
}
