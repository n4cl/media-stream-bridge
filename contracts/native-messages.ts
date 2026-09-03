export const NATIVE_MESSAGE_VERSION = 4;
// macOS allows a 255-byte path component. Leave room below that limit so the
// same contract remains usable on filesystems with a slightly smaller limit.
export const MAX_OUTPUT_FILE_NAME_BYTES = 240;

export type SaveDestination = "movies" | "downloads";

export interface SaveStreamRequest {
  version: typeof NATIVE_MESSAGE_VERSION;
  type: "save:start";
  hlsUrl: string;
  outputFileName?: string;
  destination?: SaveDestination;
}

export interface SaveStreamRequestBase {
  version: typeof NATIVE_MESSAGE_VERSION;
  type: "save:start";
  hlsUrl: string;
  outputFileName?: string;
  destination?: unknown;
}

export interface SaveCancelRequest {
  version: typeof NATIVE_MESSAGE_VERSION;
  type: "save:cancel";
  saveId: string;
}

export type NativeHostRequest = SaveStreamRequest | SaveCancelRequest;

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

export interface SaveCancelledResponse {
  version: typeof NATIVE_MESSAGE_VERSION;
  type: "save:cancelled";
  saveId: string;
}

export interface SaveCancelRejectedResponse {
  version: typeof NATIVE_MESSAGE_VERSION;
  type: "save:cancel-rejected";
  saveId: string;
  code: "save-id-mismatch" | "save-not-cancellable" | "cancel-failed";
}

export interface SaveFailedResponse {
  version: typeof NATIVE_MESSAGE_VERSION;
  type: "save:failed";
  code:
    | "invalid-request"
    | "invalid-output-file-name"
    | "invalid-save-destination"
    | "output-directory-unavailable"
    | "output-file-exists"
    | "ffmpeg-start-failed"
    | "ffmpeg-exit"
    | "internal-error";
}

export type NativeHostResponse =
  | SaveStartedResponse
  | SaveCompletedResponse
  | SaveCancelledResponse
  | SaveCancelRejectedResponse
  | SaveFailedResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isSaveStreamRequestBase(value: unknown): value is SaveStreamRequestBase {
  return (
    isRecord(value) &&
    value.version === NATIVE_MESSAGE_VERSION &&
    value.type === "save:start" &&
    typeof value.hlsUrl === "string" &&
    (value.outputFileName === undefined || typeof value.outputFileName === "string")
  );
}

export function isSaveStreamRequest(value: unknown): value is SaveStreamRequest {
  return (
    isSaveStreamRequestBase(value) &&
    (value.destination === undefined ||
      value.destination === "movies" ||
      value.destination === "downloads")
  );
}

export function isSaveCancelRequest(value: unknown): value is SaveCancelRequest {
  return (
    isRecord(value) &&
    value.version === NATIVE_MESSAGE_VERSION &&
    value.type === "save:cancel" &&
    typeof value.saveId === "string" &&
    value.saveId.length > 0
  );
}

export function isNativeHostRequest(value: unknown): value is NativeHostRequest {
  return isSaveStreamRequest(value) || isSaveCancelRequest(value);
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

  if (value.type === "save:cancelled") {
    return typeof value.saveId === "string" && value.saveId.length > 0;
  }

  if (value.type === "save:cancel-rejected") {
    return (
      typeof value.saveId === "string" &&
      value.saveId.length > 0 &&
      (value.code === "save-id-mismatch" ||
        value.code === "save-not-cancellable" ||
        value.code === "cancel-failed")
    );
  }

  return (
    value.type === "save:failed" &&
    (value.code === "invalid-request" ||
      value.code === "invalid-output-file-name" ||
      value.code === "invalid-save-destination" ||
      value.code === "output-directory-unavailable" ||
      value.code === "output-file-exists" ||
      value.code === "ffmpeg-start-failed" ||
      value.code === "ffmpeg-exit" ||
      value.code === "internal-error")
  );
}
