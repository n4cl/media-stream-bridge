import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createNativeHostLauncher,
  createNativeHostManifest,
  resolveFfmpegPath,
} from "../native-host/build/native-host/src/installation.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const template = join(repositoryRoot, "native-host", "com.media_stream_bridge.json.template");
const hostModule = join(repositoryRoot, "native-host", "build", "native-host", "src", "host.js");
const applicationSupport = join(homedir(), "Library", "Application Support", "Media Stream Bridge");
const launcher = join(applicationSupport, "native-host-launcher.sh");
const destination = join(
  homedir(),
  "Library",
  "Application Support",
  "Mozilla",
  "NativeMessagingHosts",
  "com.media_stream_bridge.json",
);

await access(hostModule, constants.R_OK);
const ffmpegPath = await resolveFfmpegPath(process.env.PATH, async (path) => {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
});
if (!ffmpegPath) {
  throw new Error("ffmpeg was not found in PATH or standard Homebrew locations");
}

const manifest = createNativeHostManifest(await readFile(template, "utf8"), launcher);
const launcherContents = createNativeHostLauncher(process.execPath, hostModule, ffmpegPath);
await mkdir(dirname(destination), { recursive: true });
await mkdir(applicationSupport, { recursive: true });
await writeFile(launcher, launcherContents, "utf8");
await chmod(launcher, 0o755);
await writeFile(destination, manifest, "utf8");
console.log(`Installed Native Host manifest at ${destination}`);
