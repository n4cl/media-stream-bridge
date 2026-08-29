import { rm } from "node:fs/promises";

await rm(new URL("../extension/build", import.meta.url), {
  recursive: true,
  force: true,
});

await rm(new URL("../native-host/build", import.meta.url), {
  recursive: true,
  force: true,
});
