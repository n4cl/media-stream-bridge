import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export interface SpawnedProcess {
  once(event: "error", listener: () => void): ChildProcess;
  once(event: "close", listener: (code: number | null) => void): ChildProcess;
}

export interface SaveStreamDependencies {
  makeDirectory(path: string): Promise<void>;
  outputFileExists(path: string): Promise<boolean>;
  removeFile(path: string): Promise<void>;
  spawnFfmpeg(args: string[]): SpawnedProcess;
  createSaveId(): string;
  outputDirectory: string;
}

export class SaveStreamError extends Error {
  constructor(
    readonly code: "ffmpeg-start-failed" | "ffmpeg-exit" | "internal-error",
    message: string,
  ) {
    super(message);
  }
}

export type SpawnProcess = (
  command: string,
  args: string[],
  options: { shell: false; stdio: ["ignore", "ignore", "ignore"] },
) => SpawnedProcess;

type FileAccess = (path: string, mode: number) => Promise<void>;

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
    makeDirectory: async (directory) => {
      await mkdir(directory, { recursive: true });
    },
    outputFileExists: createOutputFileExists(),
    removeFile: async (file) => {
      await rm(file, { force: true });
    },
    spawnFfmpeg: createFfmpegSpawner(ffmpegPath),
    createSaveId: randomUUID,
    outputDirectory: join(homedir(), "Movies", "Media Stream Bridge"),
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

export interface StartedSave {
  saveId: string;
  outputFile: string;
  completed: Promise<void>;
}

async function cleanupFailedSave(
  outputFile: string,
  outputFileExisted: boolean,
  error: SaveStreamError,
  dependencies: SaveStreamDependencies,
): Promise<SaveStreamError> {
  if (outputFileExisted) {
    return error;
  }
  try {
    await dependencies.removeFile(outputFile);
    return error;
  } catch {
    return new SaveStreamError("internal-error", "failed to remove incomplete output file");
  }
}

export async function startSaveStream(
  hlsUrl: string,
  dependencies: SaveStreamDependencies,
): Promise<StartedSave> {
  if (!isAllowedHlsUrl(hlsUrl)) {
    throw new SaveStreamError("ffmpeg-exit", "The stream URL is not an HTTP(S) HLS playlist");
  }

  const saveId = dependencies.createSaveId();
  const outputFile = join(dependencies.outputDirectory, `media-stream-${saveId}.mp4`);
  await dependencies.makeDirectory(dependencies.outputDirectory);
  const outputFileExisted = await dependencies.outputFileExists(outputFile);

  const args = ["-nostdin", "-i", hlsUrl, "-c", "copy", "-n", outputFile];
  let child: SpawnedProcess;
  try {
    child = dependencies.spawnFfmpeg(args);
  } catch {
    throw await cleanupFailedSave(
      outputFile,
      outputFileExisted,
      new SaveStreamError("ffmpeg-start-failed", "ffmpeg could not be started"),
      dependencies,
    );
  }
  const completed = new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (error: SaveStreamError): void => {
      if (settled) {
        return;
      }
      settled = true;
      void cleanupFailedSave(outputFile, outputFileExisted, error, dependencies).then(reject);
    };

    child.once("error", () => {
      fail(new SaveStreamError("ffmpeg-start-failed", "ffmpeg could not be started"));
    });
    child.once("close", (code: number | null) => {
      if (settled) {
        return;
      }
      if (code === 0) {
        settled = true;
        resolve();
        return;
      }
      fail(new SaveStreamError("ffmpeg-exit", "ffmpeg exited unsuccessfully"));
    });
  });

  return { saveId, outputFile, completed };
}

export async function saveStream(
  hlsUrl: string,
  dependencies: SaveStreamDependencies,
): Promise<{ saveId: string; outputFile: string }> {
  const started = await startSaveStream(hlsUrl, dependencies);
  await started.completed;
  return { saveId: started.saveId, outputFile: started.outputFile };
}
