import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export interface SpawnedProcess {
  once(event: "error", listener: () => void): ChildProcess;
  once(event: "close", listener: (code: number | null) => void): ChildProcess;
}

export interface SaveStreamDependencies {
  makeDirectory(path: string): Promise<void>;
  spawnFfmpeg(args: string[]): SpawnedProcess;
  createSaveId(): string;
  outputDirectory: string;
}

export class SaveStreamError extends Error {
  constructor(
    readonly code: "ffmpeg-start-failed" | "ffmpeg-exit",
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

export function createDefaultDependencies(ffmpegPath: string): SaveStreamDependencies {
  return {
    makeDirectory: async (directory) => {
      await mkdir(directory, { recursive: true });
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

  const args = ["-nostdin", "-i", hlsUrl, "-c", "copy", "-n", outputFile];
  let child: SpawnedProcess;
  try {
    child = dependencies.spawnFfmpeg(args);
  } catch {
    throw new SaveStreamError("ffmpeg-start-failed", "ffmpeg could not be started");
  }
  const completed = new Promise<void>((resolve, reject) => {
    child.once("error", () =>
      reject(new SaveStreamError("ffmpeg-start-failed", "ffmpeg could not be started")),
    );
    child.once("close", (code: number | null) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new SaveStreamError("ffmpeg-exit", "ffmpeg exited unsuccessfully"));
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
