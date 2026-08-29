export const NATIVE_MESSAGE_VERSION = 1;

export interface SaveStreamRequest {
  version: typeof NATIVE_MESSAGE_VERSION;
  type: "save:start";
  hlsUrl: string;
}

export interface SaveStartedResponse {
  version: typeof NATIVE_MESSAGE_VERSION;
  type: "save:started";
  saveId: string;
}

export interface SaveCompletedResponse {
  version: typeof NATIVE_MESSAGE_VERSION;
  type: "save:completed";
  saveId: string;
  outputFile: string;
}

export interface SaveFailedResponse {
  version: typeof NATIVE_MESSAGE_VERSION;
  type: "save:failed";
  code: "invalid-request" | "ffmpeg-start-failed" | "ffmpeg-exit" | "internal-error";
}

export type NativeHostResponse = SaveStartedResponse | SaveCompletedResponse | SaveFailedResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isSaveStreamRequest(value: unknown): value is SaveStreamRequest {
  return (
    isRecord(value) &&
    value.version === NATIVE_MESSAGE_VERSION &&
    value.type === "save:start" &&
    typeof value.hlsUrl === "string"
  );
}

export function isNativeHostResponse(value: unknown): value is NativeHostResponse {
  if (!isRecord(value) || value.version !== NATIVE_MESSAGE_VERSION) {
    return false;
  }

  if (value.type === "save:started") {
    return typeof value.saveId === "string" && value.saveId.length > 0;
  }

  if (value.type === "save:completed") {
    return (
      typeof value.saveId === "string" &&
      value.saveId.length > 0 &&
      typeof value.outputFile === "string" &&
      value.outputFile.length > 0
    );
  }

  return (
    value.type === "save:failed" &&
    (value.code === "invalid-request" ||
      value.code === "ffmpeg-start-failed" ||
      value.code === "ffmpeg-exit" ||
      value.code === "internal-error")
  );
}
