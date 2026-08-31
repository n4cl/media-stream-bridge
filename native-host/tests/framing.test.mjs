import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";

import { readNativeMessage, writeNativeMessage } from "../build/native-host/src/framing.js";

test("Native Messagingはlittle-endianの32-bit長さprefixとUTF-8 JSONで送受信する", async () => {
  const output = new PassThrough();
  const chunks = [];
  output.on("data", (chunk) => chunks.push(chunk));

  await writeNativeMessage(output, { message: "保存" });
  const encoded = Buffer.concat(chunks);
  assert.equal(encoded.readUInt32LE(0), Buffer.byteLength('{"message":"保存"}'));
  const input = new PassThrough();
  input.end(encoded);
  assert.deepEqual(await readNativeMessage(input), { message: "保存" });
});

test("Native Messagingは途中で切れたメッセージを拒否する", async () => {
  const input = new PassThrough();
  input.end(Buffer.from([5, 0, 0, 0, 123]));
  await assert.rejects(readNativeMessage(input));
});

test("Native MessagingはURL用途の64KiB上限を超える本文を読む前に拒否する", async () => {
  const input = new PassThrough();
  const header = Buffer.alloc(4);
  header.writeUInt32LE(64 * 1024 + 1);
  input.end(header);
  await assert.rejects(readNativeMessage(input), /exceeds Host input limit/);
});

test("Native Messagingの入力待機は中断時にlistenerを解除する", async () => {
  const input = new PassThrough();
  const controller = new AbortController();
  const reading = readNativeMessage(input, controller.signal);

  assert.equal(input.listenerCount("readable"), 1);
  assert.equal(input.listenerCount("end"), 1);
  assert.equal(input.listenerCount("error"), 1);

  controller.abort();
  await assert.rejects(reading, { name: "AbortError" });
  assert.equal(input.listenerCount("readable"), 0);
  assert.equal(input.listenerCount("end"), 0);
  assert.equal(input.listenerCount("error"), 0);
});
