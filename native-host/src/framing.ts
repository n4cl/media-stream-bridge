import { Buffer } from "node:buffer";
import { endianness } from "node:os";
import type { Readable, Writable } from "node:stream";

const HEADER_BYTES = 4;
// MDN permits up to 4 GB to the application. This Host accepts only small control
// messages (including a stream URL), so it applies a much smaller defensive limit
// before allocating a body buffer.
const MAX_INPUT_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;

// Firefox specifies native byte order, so read it from the runtime architecture.
const NATIVE_ENDIANNESS = endianness();

function readLength(header: Buffer): number {
  return NATIVE_ENDIANNESS === "LE" ? header.readUInt32LE() : header.readUInt32BE();
}

function writeLength(length: number): Buffer {
  const header = Buffer.alloc(HEADER_BYTES);
  if (NATIVE_ENDIANNESS === "LE") {
    header.writeUInt32LE(length);
  } else {
    header.writeUInt32BE(length);
  }
  return header;
}

function abortError(): Error {
  const error = new Error("Native message read was aborted");
  error.name = "AbortError";
  return error;
}

async function waitForReadable(input: Readable, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw abortError();
  }
  await new Promise<void>((resolve, reject) => {
    const onReadable = (): void => finish(resolve);
    const onEnd = (): void => finish(resolve);
    const onError = (error: Error): void => finish(() => reject(error));
    const onAbort = (): void => finish(() => reject(abortError()));
    const finish = (callback: () => void): void => {
      input.off("readable", onReadable);
      input.off("end", onEnd);
      input.off("error", onError);
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    input.once("readable", onReadable);
    input.once("end", onEnd);
    input.once("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function readExactly(
  input: Readable,
  byteLength: number,
  signal?: AbortSignal,
): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let total = 0;

  while (total < byteLength) {
    const chunk = input.read(byteLength - total) as Buffer | null;
    if (chunk) {
      chunks.push(chunk);
      total += chunk.length;
      continue;
    }

    if (input.readableEnded) {
      return undefined;
    }
    await waitForReadable(input, signal);
  }

  return Buffer.concat(chunks, total);
}

export async function readNativeMessage(
  input: Readable,
  signal?: AbortSignal,
): Promise<unknown | undefined> {
  const header = await readExactly(input, HEADER_BYTES, signal);
  if (!header) {
    return undefined;
  }

  const byteLength = readLength(header);
  if (byteLength > MAX_INPUT_BYTES) {
    throw new RangeError("Native request exceeds Host input limit");
  }

  const body = await readExactly(input, byteLength, signal);
  if (!body) {
    throw new Error("Native message ended before its declared length");
  }

  return JSON.parse(body.toString("utf8")) as unknown;
}

export async function writeNativeMessage(output: Writable, value: unknown): Promise<void> {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  if (body.length > MAX_OUTPUT_BYTES) {
    throw new RangeError("Native response exceeds Firefox output limit");
  }

  await new Promise<void>((resolve, reject) => {
    output.write(Buffer.concat([writeLength(body.length), body]), (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
