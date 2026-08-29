import { delimiter, isAbsolute, join } from "node:path";

const DEFAULT_FFMPEG_PATHS = [
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "/usr/bin/ffmpeg",
];

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function requireAbsolutePath(value: string, name: string): void {
  if (!isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path`);
  }
}

export function createNativeHostLauncher(
  nodePath: string,
  hostPath: string,
  ffmpegPath: string,
): string {
  requireAbsolutePath(nodePath, "Node.js executable");
  requireAbsolutePath(hostPath, "Native Host module");
  requireAbsolutePath(ffmpegPath, "ffmpeg executable");
  return `#!/bin/sh\nexec ${shellQuote(nodePath)} ${shellQuote(hostPath)} ${shellQuote(ffmpegPath)}\n`;
}

export function createNativeHostManifest(template: string, launcherPath: string): string {
  requireAbsolutePath(launcherPath, "Native Host launcher");
  const manifest: unknown = JSON.parse(template);
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    throw new Error("Native Host manifest template must be a JSON object");
  }
  const result = manifest as Record<string, unknown>;
  result.path = launcherPath;
  return `${JSON.stringify(result, null, 2)}\n`;
}

export async function resolveFfmpegPath(
  pathValue: string | undefined,
  exists: (path: string) => Promise<boolean>,
): Promise<string | undefined> {
  const pathCandidates = pathValue
    ?.split(delimiter)
    .filter((directory) => directory.length > 0)
    .map((directory) => join(directory, "ffmpeg"));
  for (const candidate of [...(pathCandidates ?? []), ...DEFAULT_FFMPEG_PATHS]) {
    if (await exists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}
