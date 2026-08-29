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

export function isListCandidatesMessage(value: unknown): value is UnvalidatedListCandidatesMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const message = value as Record<string, unknown>;
  return message.type === "candidates:list";
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
