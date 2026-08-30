import {
  isNativeHostResponse,
  type NativeHostResponse,
} from "../../../contracts/native-messages.js";
import type { Candidate } from "./candidates.js";

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
  tabId?: unknown;
}

export type SaveCandidateResponse =
  | { ok: true; response: NativeHostResponse }
  | {
      ok: false;
      error:
        | "invalid-tab-id"
        | "invalid-hls-url"
        | "save-already-running"
        | "native-host-unavailable"
        | "native-host-invalid-response";
    };

export type SaveJobStatus =
  | { state: "starting" }
  | { state: "running"; saveId: string }
  | { state: "completed"; saveId: string; outputFile: string }
  | {
      state: "failed";
      error:
        | "invalid-hls-url"
        | "native-host-unavailable"
        | "native-host-invalid-response"
        | "invalid-request"
        | "ffmpeg-start-failed"
        | "ffmpeg-exit"
        | "internal-error";
      saveId?: string;
    };

export interface SaveStatusMessage {
  type: "save:status";
  tabId?: unknown;
}

export type SaveStatusResponse =
  | { ok: true; job: SaveJobStatus | null }
  | { ok: false; error: "invalid-tab-id" };

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
    (response.error === "invalid-tab-id" ||
      response.error === "invalid-hls-url" ||
      response.error === "save-already-running" ||
      response.error === "native-host-unavailable" ||
      response.error === "native-host-invalid-response")
  );
}

export function isSaveStatusMessage(value: unknown): value is SaveStatusMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).type === "save:status"
  );
}

function isSaveJobStatus(value: unknown): value is SaveJobStatus {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const job = value as Record<string, unknown>;
  if (job.state === "starting") {
    return true;
  }
  if (job.state === "running") {
    return typeof job.saveId === "string" && job.saveId.length > 0;
  }
  if (job.state === "completed") {
    return (
      typeof job.saveId === "string" &&
      job.saveId.length > 0 &&
      typeof job.outputFile === "string" &&
      job.outputFile.length > 0
    );
  }
  return (
    job.state === "failed" &&
    (job.error === "invalid-hls-url" ||
      job.error === "native-host-unavailable" ||
      job.error === "native-host-invalid-response" ||
      job.error === "invalid-request" ||
      job.error === "ffmpeg-start-failed" ||
      job.error === "ffmpeg-exit" ||
      job.error === "internal-error") &&
    (job.saveId === undefined || (typeof job.saveId === "string" && job.saveId.length > 0))
  );
}

export function isSaveStatusResponse(value: unknown): value is SaveStatusResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const response = value as Record<string, unknown>;
  if (response.ok === false) {
    return response.error === "invalid-tab-id";
  }
  return response.ok === true && (response.job === null || isSaveJobStatus(response.job));
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
