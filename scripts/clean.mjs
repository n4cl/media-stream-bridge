import { rm } from "node:fs/promises";

await rm(new URL("../extension/generated", import.meta.url), {
  recursive: true,
  force: true,
});
