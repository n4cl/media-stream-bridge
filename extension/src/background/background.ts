import {
  isNativeHostResponse,
  NATIVE_MESSAGE_VERSION,
} from "../../../contracts/native-messages.js";
import { CandidateStore, isHlsPlaylistUrl } from "../shared/candidates.js";
import {
  isListCandidatesMessage,
  isSaveCancelMessage,
  isSaveCandidateMessage,
  isSaveStatusMessage,
  type ListCandidatesResponse,
  type SaveCancelResponse,
  type SaveCandidateResponse,
  type SaveJobStatus,
  type SaveStatusResponse,
} from "../shared/messages.js";

const candidates = new CandidateStore();
interface SaveJobAttempt {
  status: SaveJobStatus;
  port?: browser.runtime.Port;
}

const saveJobAttemptsByTab = new Map<number, SaveJobAttempt>();
const NATIVE_HOST_NAME = "com.media_stream_bridge";

function isValidTabId(tabId: unknown): tabId is number {
  return typeof tabId === "number" && Number.isInteger(tabId) && tabId >= 0;
}

function isTerminalJob(job: SaveJobStatus): boolean {
  return job.state === "completed" || job.state === "cancelled" || job.state === "failed";
}

function isCurrentAttempt(tabId: number, attempt: SaveJobAttempt): boolean {
  return saveJobAttemptsByTab.get(tabId) === attempt;
}

function isCurrentAttemptPort(
  tabId: number,
  attempt: SaveJobAttempt,
  port: browser.runtime.Port,
): boolean {
  return isCurrentAttempt(tabId, attempt) && attempt.port === port;
}

function failAttemptUnlessTerminal(
  tabId: number,
  attempt: SaveJobAttempt,
  error: Extract<SaveJobStatus, { state: "failed" }>["error"],
): void {
  if (!isCurrentAttempt(tabId, attempt) || isTerminalJob(attempt.status)) {
    return;
  }
  attempt.status =
    attempt.status.state === "running" || attempt.status.state === "cancelling"
      ? { state: "failed", error, saveId: attempt.status.saveId }
      : { state: "failed", error };
}

function disconnectAttemptPort(attempt: SaveJobAttempt, port: browser.runtime.Port): void {
  if (attempt.port === port) {
    delete attempt.port;
  }
  try {
    port.disconnect();
  } catch {
    // 既に切断済みのPortでも終端状態は維持する。
  }
}

function saveWithNativeHost(
  tabId: number,
  attempt: SaveJobAttempt,
  hlsUrl: string,
  outputFileName?: string,
  destination?: string,
): Promise<SaveCandidateResponse> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (response: SaveCandidateResponse): void => {
      if (!settled) {
        settled = true;
        resolve(response);
      }
    };
    let port: browser.runtime.Port;
    try {
      port = browser.runtime.connectNative(NATIVE_HOST_NAME);
    } catch {
      failAttemptUnlessTerminal(tabId, attempt, "native-host-unavailable");
      settle({ ok: false, error: "native-host-unavailable" });
      return;
    }
    attempt.port = port;

    port.onMessage.addListener((message: unknown) => {
      if (!isCurrentAttemptPort(tabId, attempt, port)) {
        return;
      }
      if (!isNativeHostResponse(message)) {
        failAttemptUnlessTerminal(tabId, attempt, "native-host-invalid-response");
        settle({ ok: false, error: "native-host-invalid-response" });
        disconnectAttemptPort(attempt, port);
        return;
      }
      if (message.type === "save:started") {
        if (attempt.status.state !== "starting") {
          failAttemptUnlessTerminal(tabId, attempt, "native-host-invalid-response");
          settle({ ok: false, error: "native-host-invalid-response" });
          disconnectAttemptPort(attempt, port);
          return;
        }
        attempt.status = { state: "running", saveId: message.saveId };
        settle({ ok: true, response: message });
        return;
      }
      if (message.type === "save:cancel-rejected") {
        if (attempt.status.state !== "cancelling" || attempt.status.saveId !== message.saveId) {
          failAttemptUnlessTerminal(tabId, attempt, "native-host-invalid-response");
          settle({ ok: false, error: "native-host-invalid-response" });
          disconnectAttemptPort(attempt, port);
          return;
        }
        attempt.status = {
          state: "running",
          saveId: message.saveId,
          cancelError: message.code,
        };
        return;
      }
      if (message.type === "save:completed") {
        if (
          (attempt.status.state !== "running" && attempt.status.state !== "cancelling") ||
          attempt.status.saveId !== message.saveId
        ) {
          failAttemptUnlessTerminal(tabId, attempt, "native-host-invalid-response");
          settle({ ok: false, error: "native-host-invalid-response" });
          disconnectAttemptPort(attempt, port);
          return;
        }
        attempt.status = {
          state: "completed",
          saveId: message.saveId,
          outputFile: message.outputFile,
        };
      } else if (message.type === "save:cancelled") {
        if (attempt.status.state !== "cancelling" || attempt.status.saveId !== message.saveId) {
          failAttemptUnlessTerminal(tabId, attempt, "native-host-invalid-response");
          settle({ ok: false, error: "native-host-invalid-response" });
          disconnectAttemptPort(attempt, port);
          return;
        }
        attempt.status = { state: "cancelled", saveId: message.saveId };
      } else if (message.type === "save:failed") {
        failAttemptUnlessTerminal(tabId, attempt, message.code);
      } else {
        failAttemptUnlessTerminal(tabId, attempt, "native-host-invalid-response");
      }
      settle({ ok: true, response: message });
      disconnectAttemptPort(attempt, port);
    });
    port.onDisconnect.addListener(() => {
      if (!isCurrentAttemptPort(tabId, attempt, port)) {
        return;
      }
      delete attempt.port;
      failAttemptUnlessTerminal(tabId, attempt, "native-host-unavailable");
      settle({ ok: false, error: "native-host-unavailable" });
    });
    try {
      port.postMessage({
        version: NATIVE_MESSAGE_VERSION,
        type: "save:start",
        hlsUrl,
        ...(outputFileName === undefined ? {} : { outputFileName }),
        ...(destination === undefined ? {} : { destination }),
      });
    } catch {
      failAttemptUnlessTerminal(tabId, attempt, "native-host-unavailable");
      settle({ ok: false, error: "native-host-unavailable" });
      disconnectAttemptPort(attempt, port);
    }
  });
}

browser.webRequest.onBeforeRequest.addListener(
  (request) => {
    if (request.tabId < 0 || !isHlsPlaylistUrl(request.url)) {
      return;
    }

    candidates.add(request.tabId, request.url);
  },
  { urls: ["<all_urls>"] },
);

browser.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) {
    candidates.clearTab(details.tabId);
  }
});

browser.tabs.onRemoved.addListener((tabId) => {
  candidates.clearTab(tabId);
});

browser.runtime.onMessage.addListener((message: unknown) => {
  if (isSaveCandidateMessage(message)) {
    if (!isValidTabId(message.tabId)) {
      const response: SaveCandidateResponse = { ok: false, error: "invalid-tab-id" };
      return Promise.resolve(response);
    }
    const existingAttempt = saveJobAttemptsByTab.get(message.tabId);
    if (
      existingAttempt?.status.state === "starting" ||
      existingAttempt?.status.state === "running" ||
      existingAttempt?.status.state === "cancelling"
    ) {
      const response: SaveCandidateResponse = { ok: false, error: "save-already-running" };
      return Promise.resolve(response);
    }
    if (typeof message.hlsUrl !== "string" || !isHlsPlaylistUrl(message.hlsUrl)) {
      saveJobAttemptsByTab.set(message.tabId, {
        status: { state: "failed", error: "invalid-hls-url" },
      });
      const response: SaveCandidateResponse = { ok: false, error: "invalid-hls-url" };
      return Promise.resolve(response);
    }
    if (message.outputFileName !== undefined && typeof message.outputFileName !== "string") {
      saveJobAttemptsByTab.set(message.tabId, {
        status: { state: "failed", error: "invalid-output-file-name" },
      });
      const response: SaveCandidateResponse = { ok: false, error: "invalid-output-file-name" };
      return Promise.resolve(response);
    }
    if (message.destination !== undefined && typeof message.destination !== "string") {
      saveJobAttemptsByTab.set(message.tabId, {
        status: { state: "failed", error: "invalid-save-destination" },
      });
      const response: SaveCandidateResponse = { ok: false, error: "invalid-save-destination" };
      return Promise.resolve(response);
    }
    const attempt: SaveJobAttempt = { status: { state: "starting" } };
    saveJobAttemptsByTab.set(message.tabId, attempt);
    return saveWithNativeHost(
      message.tabId,
      attempt,
      message.hlsUrl,
      message.outputFileName,
      message.destination,
    );
  }

  if (isSaveCancelMessage(message)) {
    if (!isValidTabId(message.tabId)) {
      const response: SaveCancelResponse = { ok: false, error: "invalid-tab-id" };
      return Promise.resolve(response);
    }
    if (typeof message.saveId !== "string" || message.saveId.length === 0) {
      const response: SaveCancelResponse = { ok: false, error: "invalid-save-id" };
      return Promise.resolve(response);
    }
    const attempt = saveJobAttemptsByTab.get(message.tabId);
    if (attempt?.status.state !== "running" || !attempt?.port) {
      const response: SaveCancelResponse = { ok: false, error: "save-not-running" };
      return Promise.resolve(response);
    }
    if (attempt.status.saveId !== message.saveId) {
      const response: SaveCancelResponse = { ok: false, error: "save-id-mismatch" };
      return Promise.resolve(response);
    }

    const port = attempt.port;
    attempt.status = { state: "cancelling", saveId: message.saveId };
    try {
      port.postMessage({
        version: NATIVE_MESSAGE_VERSION,
        type: "save:cancel",
        saveId: message.saveId,
      });
    } catch {
      failAttemptUnlessTerminal(message.tabId, attempt, "native-host-unavailable");
      disconnectAttemptPort(attempt, port);
      const response: SaveCancelResponse = { ok: false, error: "native-host-unavailable" };
      return Promise.resolve(response);
    }
    const response: SaveCancelResponse = { ok: true };
    return Promise.resolve(response);
  }

  if (isSaveStatusMessage(message)) {
    if (!isValidTabId(message.tabId)) {
      const response: SaveStatusResponse = { ok: false, error: "invalid-tab-id" };
      return Promise.resolve(response);
    }
    const response: SaveStatusResponse = {
      ok: true,
      job: saveJobAttemptsByTab.get(message.tabId)?.status ?? null,
    };
    return Promise.resolve(response);
  }

  if (!isListCandidatesMessage(message)) {
    return undefined;
  }

  if (!isValidTabId(message.tabId)) {
    const response: ListCandidatesResponse = { ok: false, error: "invalid-tab-id" };
    return Promise.resolve(response);
  }

  const response: ListCandidatesResponse = {
    ok: true,
    candidates: candidates.list(message.tabId),
  };
  return Promise.resolve(response);
});
