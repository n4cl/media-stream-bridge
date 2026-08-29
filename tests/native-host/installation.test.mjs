import assert from "node:assert/strict";
import test from "node:test";

import {
  createNativeHostLauncher,
  createNativeHostManifest,
  resolveFfmpegPath,
} from "../../native-host/build/native-host/src/installation.js";

test("インストーラは絶対パスを安全にquoteした固定ランチャーを生成する", () => {
  const launcher = createNativeHostLauncher(
    "/opt/node's/bin/node",
    "/repo/host.js",
    "/opt/homebrew/bin/ffmpeg",
  );
  assert.equal(
    launcher,
    "#!/bin/sh\nexec '/opt/node'\"'\"'s/bin/node' '/repo/host.js' '/opt/homebrew/bin/ffmpeg'\n",
  );
  assert.throws(() => createNativeHostLauncher("node", "/repo/host.js", "/ffmpeg"), /absolute/);
});

test("インストーラはJSONとしてmanifestを生成し、引用符を含むパスでも壊さない", () => {
  const manifest = createNativeHostManifest(
    '{"name":"com.media_stream_bridge","path":"placeholder"}',
    '/Users/a"b/launcher',
  );
  assert.equal(JSON.parse(manifest).path, '/Users/a"b/launcher');
});

test("インストーラはPATHを優先し、その後にHomebrew候補を確認する", async () => {
  const found = await resolveFfmpegPath(
    "/custom/bin:/other/bin",
    async (path) => path === "/custom/bin/ffmpeg",
  );
  assert.equal(found, "/custom/bin/ffmpeg");
  const fallback = await resolveFfmpegPath(
    "/missing",
    async (path) => path === "/opt/homebrew/bin/ffmpeg",
  );
  assert.equal(fallback, "/opt/homebrew/bin/ffmpeg");
});
