import type { Candidate } from "./candidates.js";
import { isNativeHostResponse, type NativeHostResponse } from "./native-messages.js";

export interface ListCandidatesMessage {
  type: "candidates:list";
  tabId: number;
}

export interface UnvalidatedListCandidatesMessage {
  type: "candidates:list";
  tabId?: unknown;
}

export type ListCandidatesResponse =
  | { ok: true; candidates: Candidate[] }
  | { ok: false; error: "invalid-tab-id" };

export interface SaveCandidateMessage {
  type: "save:start";
  hlsUrl?: unknown;
}

export type SaveCandidateResponse =
  | { ok: true; response: NativeHostResponse }
  | {
      ok: false;
      error: "invalid-hls-url" | "native-host-unavailable" | "native-host-invalid-response";
    };

export function isListCandidatesMessage(value: unknown): value is UnvalidatedListCandidatesMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const message = value as Record<string, unknown>;
  return message.type === "candidates:list";
}

export function isSaveCandidateMessage(value: unknown): value is SaveCandidateMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).type === "save:start"
  );
}

export function isSaveCandidateResponse(value: unknown): value is SaveCandidateResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const response = value as Record<string, unknown>;
  if (response.ok === true) {
    return isNativeHostResponse(response.response);
  }
  return (
    response.ok === false &&
    (response.error === "invalid-hls-url" ||
      response.error === "native-host-unavailable" ||
      response.error === "native-host-invalid-response")
  );
}

export function isListCandidatesResponse(value: unknown): value is ListCandidatesResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const response = value as Record<string, unknown>;
  if (response.ok === false) {
    return response.error === "invalid-tab-id";
  }

  return (
    response.ok === true &&
    Array.isArray(response.candidates) &&
    response.candidates.every(
      (candidate: unknown) =>
        typeof candidate === "object" &&
        candidate !== null &&
        typeof (candidate as Record<string, unknown>).url === "string" &&
        typeof (candidate as Record<string, unknown>).detectedAt === "number",
    )
  );
}
